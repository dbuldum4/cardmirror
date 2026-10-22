/** Limits apply to untrusted documents before their contents reach parsers. */
import { Gunzip, Unzip, UnzipInflate, strFromU8 } from 'fflate';

export const MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_PART_BYTES = 128 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 10_000;
// A DEFLATE chunk can expand roughly 1032:1; small input chunks bound the
// allocation made inside fflate before our output callback can reject it.
const INPUT_CHUNK_BYTES = 1024;

export class DocumentLimitError extends Error {
  override name = 'DocumentLimitError';
}

export function checkDocumentSize(size: number, limit = MAX_DOCUMENT_BYTES): void {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid document size limit.');
  if (size > limit) throw new DocumentLimitError(`Document exceeds the ${limit / 1024 / 1024} MiB safety limit.`);
}

function joinChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});

/** Bounded, single-member gzip, with CRC/length verification for damaged saves.
 * The trailer is untrusted: enforce limits against actual output as well. */
export function gunzipBounded(bytes: Uint8Array, limit = MAX_DOCUMENT_BYTES): Uint8Array {
  checkDocumentSize(bytes.length, MAX_ARCHIVE_BYTES);
  if (bytes.length < 18) throw new Error('Truncated gzip document.');
  const trailer = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8);
  checkDocumentSize(trailer.getUint32(4, true), limit);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let crc = 0xffffffff;
  let complete = false;
  const stream = new Gunzip((chunk, final) => {
    size += chunk.length;
    checkDocumentSize(size, limit);
    for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
    chunks.push(chunk);
    complete = final;
  });
  stream.onmember = () => { throw new Error('Multiple gzip members are not supported in a document.'); };
  for (let i = 0; i < bytes.length; i += INPUT_CHUNK_BYTES) {
    stream.push(bytes.subarray(i, i + INPUT_CHUNK_BYTES), i + INPUT_CHUNK_BYTES >= bytes.length);
  }
  if (!complete || size !== trailer.getUint32(4, true) || ((crc ^ 0xffffffff) >>> 0) !== trailer.getUint32(0, true)) {
    throw new Error('Gzip document checksum or length mismatch. The file may be damaged.');
  }
  return joinChunks(chunks, size);
}

export interface ArchiveLimits {
  maxInputBytes: number;
  maxPartBytes: number;
  maxTotalBytes: number;
  maxEntries: number;
}
const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxInputBytes: MAX_ARCHIVE_BYTES,
  maxPartBytes: MAX_PART_BYTES,
  maxTotalBytes: MAX_DOCUMENT_BYTES,
  maxEntries: MAX_ARCHIVE_ENTRIES,
};

interface ZipEntry { size: number; crc: number; }

/** Require a complete central directory, not just a prefix of local records.
 * Streaming ZIP readers alone can accept a file cut between two entries. */
function zipDirectory(bytes: Uint8Array, limits: ArchiveLimits): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = (): never => { throw new Error('Incomplete or invalid ZIP central directory.'); };
  const u64 = (offset: number): number => {
    if (offset < 0 || offset + 8 > bytes.length) return invalid();
    const n = view.getBigUint64(offset, true);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) return invalid();
    return Number(n);
  };
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  }
  if (end < Math.max(0, bytes.length - 65557)) return invalid();
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) return invalid();
  let count = view.getUint16(end + 10, true);
  let size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  let directoryEnd = end;
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || view.getUint32(locator, true) !== 0x07064b50 || view.getUint32(locator + 4, true) || view.getUint32(locator + 16, true) !== 1) return invalid();
    const zip64 = u64(locator + 8);
    if (zip64 + 56 > locator || view.getUint32(zip64, true) !== 0x06064b50 || zip64 + 12 + u64(zip64 + 4) !== locator) return invalid();
    if (view.getUint32(zip64 + 16, true) || view.getUint32(zip64 + 20, true) || u64(zip64 + 24) !== u64(zip64 + 32)) return invalid();
    count = u64(zip64 + 32); size = u64(zip64 + 40); offset = u64(zip64 + 48);
    directoryEnd = zip64;
  } else if (view.getUint16(end + 8, true) !== count) return invalid();
  if (count > limits.maxEntries) throw new DocumentLimitError('Document contains too many ZIP entries.');
  if (offset + size !== directoryEnd) return invalid();
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50) return invalid();
    const flags = view.getUint16(offset + 8, true);
    if (flags & 1) throw new Error('Encrypted ZIP entries are not supported.');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const next = offset + 46 + nameLength + extraLength + view.getUint16(offset + 32, true);
    if (next > directoryEnd) return invalid();
    const name = strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength), !(flags & 2048));
    let originalSize = view.getUint32(offset + 24, true);
    if (originalSize === 0xffffffff) {
      let extra = offset + 46 + nameLength;
      const extraEnd = extra + extraLength;
      let found = false;
      while (extra + 4 <= extraEnd) {
        const length = view.getUint16(extra + 2, true);
        if (extra + 4 + length > extraEnd) return invalid();
        if (view.getUint16(extra, true) === 1) {
          if (length < 8) return invalid();
          originalSize = u64(extra + 4); found = true; break;
        }
        extra += 4 + length;
      }
      if (!found) return invalid();
    }
    checkDocumentSize(originalSize, limits.maxPartBytes);
    if (entries.has(name)) throw new Error('Document contains duplicate ZIP entries.');
    entries.set(name, { size: originalSize, crc: view.getUint32(offset + 16, true) });
    offset = next;
  }
  if (offset !== directoryEnd) return invalid();
  return entries;
}

/** Stream each ZIP part with both declared and actual size checks. Using
 * unzipSync's metadata-sized output buffer can silently truncate forged sizes. */
export function unzipBounded(bytes: Uint8Array, overrides: Partial<ArchiveLimits> = {}): Map<string, Uint8Array> {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...overrides };
  for (const value of Object.values(limits)) checkDocumentSize(0, value);
  checkDocumentSize(bytes.length, limits.maxInputBytes);
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Invalid ZIP document.');
  const directory = zipDirectory(bytes, limits);
  const parts = new Map<string, Uint8Array>();
  const names = new Set<string>();
  let total = 0;
  let unfinished = 0;
  const stream = new Unzip((file) => {
    if (names.size >= limits.maxEntries) throw new DocumentLimitError('Document contains too many ZIP entries.');
    if (names.has(file.name)) throw new Error('Document contains duplicate ZIP entries.');
    if (!file.name || file.name.includes('\\') || file.name.startsWith('/') || file.name.split('/').includes('..') || /[\u0000-\u001f]/.test(file.name)) {
      throw new Error('Document contains an unsafe ZIP entry path.');
    }
    const expected = directory.get(file.name);
    if (!expected) throw new Error('ZIP entry is missing from the central directory.');
    names.add(file.name);
    if (file.originalSize !== undefined) checkDocumentSize(file.originalSize, limits.maxPartBytes);
    let size = 0;
    let crc = 0xffffffff;
    const chunks: Uint8Array[] = [];
    unfinished++;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      size += chunk.length;
      total += chunk.length;
      checkDocumentSize(size, limits.maxPartBytes);
      checkDocumentSize(total, limits.maxTotalBytes);
      for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
      chunks.push(chunk);
      if (final) {
        if (size !== expected.size || (file.originalSize !== undefined && size !== file.originalSize)) throw new Error('ZIP entry length mismatch.');
        if (((crc ^ 0xffffffff) >>> 0) !== expected.crc) throw new Error('ZIP entry checksum mismatch.');
        unfinished--;
        if (!file.name.endsWith('/')) parts.set(file.name, joinChunks(chunks, size));
      }
    };
    file.start();
  });
  stream.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += INPUT_CHUNK_BYTES) {
    stream.push(bytes.subarray(i, i + INPUT_CHUNK_BYTES), i + INPUT_CHUNK_BYTES >= bytes.length);
  }
  if (unfinished !== 0 || names.size !== directory.size) throw new Error('Truncated ZIP document.');
  return parts;
}
