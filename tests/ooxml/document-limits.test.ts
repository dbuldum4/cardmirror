import { describe, expect, it } from 'vitest';
import { gzipSync, zipSync } from 'fflate';
import { gunzipBounded, unzipBounded, DocumentLimitError } from '../../src/safe-containers.js';
import { parseXml, textContent } from '../../src/ooxml/parse.js';
import { Docx } from '../../src/ooxml/docx.js';

const utf8 = new TextEncoder();

describe('untrusted compressed documents', () => {
  it('accepts gzip at the limit and rejects actual over-limit output even with a forged trailer', () => {
    const input = utf8.encode('evidence '.repeat(1000));
    const gzip = gzipSync(input);
    expect(gunzipBounded(gzip, input.length)).toEqual(input);
    expect(() => gunzipBounded(gzip, input.length - 1)).toThrow(DocumentLimitError);
    const forged = gzip.slice();
    new DataView(forged.buffer).setUint32(forged.length - 4, 1, true);
    expect(() => gunzipBounded(forged, 100)).toThrow(DocumentLimitError);
  });
  it('refuses damaged CRCs, truncation, and concatenated gzip members', () => {
    const gz = gzipSync(utf8.encode('hello'));
    const corrupt = gz.slice();
    corrupt[corrupt.length - 8]! ^= 1;
    expect(() => gunzipBounded(corrupt)).toThrow(/checksum/);
    expect(() => gunzipBounded(gz.subarray(0, gz.length - 3))).toThrow();
    const concat = new Uint8Array(gz.length * 2); concat.set(gz); concat.set(gz, gz.length);
    expect(() => gunzipBounded(concat)).toThrow(/Multiple gzip/);
  });
  it('bounds each ZIP part, total output, and entry count while retaining opaque parts', () => {
    const zip = zipSync({ 'word/document.xml': utf8.encode('abc'), 'word/media/image.png': new Uint8Array([1, 2, 3, 4]) });
    const parts = unzipBounded(zip, { maxPartBytes: 4, maxTotalBytes: 7, maxEntries: 2 });
    expect(parts.get('word/media/image.png')).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(() => unzipBounded(zip, { maxPartBytes: 3 })).toThrow(DocumentLimitError);
    expect(() => unzipBounded(zip, { maxTotalBytes: 6 })).toThrow(DocumentLimitError);
    expect(() => unzipBounded(zip, { maxEntries: 1 })).toThrow(DocumentLimitError);
  });
  it('refuses actual oversized ZIP output when local sizes lie', () => {
    const zip = zipSync({ 'word/document.xml': utf8.encode('x'.repeat(10_000)) });
    // Forge the local header's original length; stream accounting must still stop expansion.
    new DataView(zip.buffer).setUint32(22, 1, true);
    expect(() => unzipBounded(zip, { maxPartBytes: 100 })).toThrow(DocumentLimitError);
  });
  it('rejects every truncated ZIP prefix and corrupted stored bytes', () => {
    const zip = zipSync({ 'word/document.xml': utf8.encode('abc'), 'word/styles.xml': utf8.encode('styles') }, { level: 0 });
    for (let length = 0; length < zip.length; length++) expect(() => unzipBounded(zip.subarray(0, length))).toThrow();
    const corrupt = zip.slice();
    const dataStart = 30 + new DataView(zip.buffer).getUint16(26, true);
    corrupt[dataStart]! ^= 1;
    expect(() => unzipBounded(corrupt)).toThrow(/checksum/);
  });
  it('refuses traversal parts and preserves real docx round trips', async () => {
    expect(() => unzipBounded(zipSync({ '../escape': utf8.encode('x') }))).toThrow(/unsafe ZIP/);
    const doc = Docx.empty();
    const loaded = await Docx.load(await doc.toBuffer());
    expect(await loaded.readText('word/document.xml')).toEqual(await doc.readText('word/document.xml'));
  });
});

describe('OOXML parsing', () => {
  it('refuses custom entities and DTDs before expansion', () => {
    expect(() => parseXml('<!DOCTYPE r [<!ENTITY a "xxxxxxxxxx">]><r>&a;</r>')).toThrow(/DTD/);
    expect(() => parseXml('<!DOCTYPE r SYSTEM "file:///etc/passwd"><r/>')).toThrow(/DTD/);
  });
  it('retains thousands of ordinary entities, numeric references, comments, and CDATA', () => {
    expect(textContent(parseXml(`<r>${'&amp;&#65;'.repeat(2000)}</r>`))).toBe('&A'.repeat(2000));
    expect(() => parseXml('<r><!-- <!DOCTYPE x> --><![CDATA[<!ENTITY a>]]></r>')).not.toThrow();
  });
  it('bounds nesting while allowing ordinary OOXML', () => {
    expect(() => parseXml('<r>'.repeat(257) + '</r>'.repeat(257))).toThrow(/nesting/);
    expect(() => parseXml('<r a=">"><p>text</p></r>')).not.toThrow();
  });
});
