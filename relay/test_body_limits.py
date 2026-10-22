"""Run with: python -m unittest discover -s relay -p 'test_*.py' -v."""

import gzip
import random
import tracemalloc
import unittest

from body_limits import InvalidGzip, PayloadTooLarge, gunzip_bounded, read_bounded_body


class BodyLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_body(self):
        async def chunks():
            if False:
                yield b""

        self.assertEqual(await read_bounded_body(chunks(), 0), b"")

    async def test_chunked_body_at_exact_limit(self):
        async def chunks():
            for chunk in (b"ab", b"", b"cd", b""):
                yield chunk

        self.assertEqual(await read_bounded_body(chunks(), 4), b"abcd")

    async def test_overflow_stops_receiving_immediately(self):
        received = []

        async def chunks():
            for chunk in (b"abc", b"de", b"never read"):
                received.append(chunk)
                yield chunk

        with self.assertRaises(PayloadTooLarge):
            await read_bounded_body(chunks(), 4)
        self.assertEqual(received, [b"abc", b"de"])

    async def test_single_oversized_chunk_is_rejected(self):
        async def chunks():
            yield b"x" * 1024
            self.fail("reader continued after rejecting an oversized chunk")

        with self.assertRaises(PayloadTooLarge):
            await read_bounded_body(chunks(), 3)

    async def test_disconnect_does_not_return_partial_body(self):
        async def chunks():
            yield b"partial"
            raise ConnectionError("client disconnected")

        with self.assertRaises(ConnectionError):
            await read_bounded_body(chunks(), 1024)


class GzipLimitTests(unittest.TestCase):
    def test_payload_at_exact_limit(self):
        raw = b'{"recipientCode":"unit-test","body":"ciphertext"}'
        self.assertEqual(gunzip_bounded(gzip.compress(raw), len(raw)), raw)

    def test_valid_empty_member_at_zero_limit(self):
        self.assertEqual(gunzip_bounded(gzip.compress(b""), 0), b"")

    def test_nonempty_member_at_zero_limit_is_rejected(self):
        with self.assertRaises(PayloadTooLarge):
            gunzip_bounded(gzip.compress(b"a"), 0)

    def test_large_incompressible_payload_crosses_input_chunks(self):
        raw = random.Random(42).randbytes(700_000)
        self.assertEqual(gunzip_bounded(gzip.compress(raw), len(raw)), raw)

    def test_concatenated_members_share_the_limit(self):
        raw = gzip.compress(b"first") + gzip.compress(b"") + gzip.compress(b"second")
        self.assertEqual(gunzip_bounded(raw, 11), b"firstsecond")
        with self.assertRaises(PayloadTooLarge):
            gunzip_bounded(raw, 10)

    def test_member_boundary_across_input_chunks(self):
        first = random.Random(7).randbytes(262_100)
        second = b"second member"
        raw = gzip.compress(first) + gzip.compress(second)
        self.assertEqual(gunzip_bounded(raw, len(first + second)), first + second)

    def test_every_truncated_prefix_is_rejected(self):
        raw = gzip.compress(b"complete payload")
        for length in range(len(raw)):
            with self.subTest(length=length), self.assertRaises(InvalidGzip):
                gunzip_bounded(raw[:length], 1024)

    def test_truncated_second_member_is_rejected(self):
        raw = gzip.compress(b"first") + gzip.compress(b"second")[:-1]
        with self.assertRaises(InvalidGzip):
            gunzip_bounded(raw, 1024)

    def test_corrupt_checksum_and_length_are_rejected(self):
        raw = gzip.compress(b"payload")
        for index in (-8, -4):
            corrupt = bytearray(raw)
            corrupt[index] ^= 1
            with self.subTest(index=index), self.assertRaises(InvalidGzip):
                gunzip_bounded(bytes(corrupt), 1024)

    def test_invalid_header_and_trailing_garbage_are_rejected(self):
        for raw in (b"not gzip", gzip.compress(b"payload") + b"junk"):
            with self.subTest(raw=raw), self.assertRaises(InvalidGzip):
                gunzip_bounded(raw, 1024)

    def test_gzip_bomb_does_not_inflate_before_limit_check(self):
        raw = gzip.compress(b"x" * (8 * 1024 * 1024))
        tracemalloc.start()
        try:
            with self.assertRaises(PayloadTooLarge):
                gunzip_bounded(raw, 1024)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertLess(peak, 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
