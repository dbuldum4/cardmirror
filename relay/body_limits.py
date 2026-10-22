"""Bounded body readers, independent of the database and web framework."""

import zlib
from collections.abc import AsyncIterable


class PayloadTooLarge(ValueError):
    """The encoded or decoded body exceeds its configured limit."""


class InvalidGzip(ValueError):
    """The body is not a complete, valid gzip stream."""


async def read_bounded_body(chunks: AsyncIterable[bytes], max_bytes: int) -> bytes:
    """Stop receiving as soon as a chunk would exceed the cap.

    Do not rely on Content-Length: chunked requests have none, and the actual
    received length is what bounds memory. Reject before copying an oversized
    chunk into our buffer. The ASGI server owns the incoming chunk itself.
    """
    body = bytearray()
    async for chunk in chunks:
        if len(chunk) > max_bytes - len(body):
            raise PayloadTooLarge("payload too large")
        body.extend(chunk)
    return bytes(body)


def gunzip_bounded(raw: bytes, max_bytes: int) -> bytes:
    """Decode complete gzip members with one shared output limit.

    Each member must reach its trailer (which zlib checks for CRC and length).
    Concatenated members are valid gzip and count toward the same cap; trailing
    garbage and truncated members are rejected. Never call unbounded flush().
    """
    out = bytearray()
    decoder = None
    view = memoryview(raw)
    step = 256 * 1024
    try:
        for offset in range(0, len(view), step):
            pending = view[offset:offset + step]
            while pending:
                if decoder is None:
                    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
                decoded = decoder.decompress(pending, max_bytes + 1 - len(out))
                if len(decoded) > max_bytes - len(out):
                    raise PayloadTooLarge("decompressed payload too large")
                out.extend(decoded)
                if decoder.eof:
                    pending = decoder.unused_data
                    decoder = None
                else:
                    # With one byte beyond the remaining budget requested,
                    # an output-limited call would already have raised above.
                    pending = decoder.unconsumed_tail
    except zlib.error as exc:
        raise InvalidGzip("invalid gzip body") from exc
    if not raw or decoder is not None:
        raise InvalidGzip("incomplete gzip body")
    return bytes(out)
