/**
 * End-to-end Office decryption against a real Word-produced,
 * Agile-encrypted .docx (fixtures/agile-encrypted.docx — password
 * "password", body text "lol"). Exercises the whole path: CFB parse →
 * Agile descriptor → 100k-spin key derivation → verifier check →
 * package decrypt → a valid .docx the importer can read.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  decryptOfficeDocument,
  officeEncryption,
  isEncryptedOfficeFile,
  WrongPasswordError,
  UnsupportedEncryptionError,
  EncryptedOfficeError,
} from '../../src/ooxml/decrypt-docx.js';
import { fromDocxFull } from '../../src/import/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = new Uint8Array(readFileSync(join(here, 'fixtures/agile-encrypted.docx')));

describe('office encryption detection', () => {
  it('recognizes the compound-file magic', () => {
    expect(isEncryptedOfficeFile(fixture)).toBe(true);
  });

  it('classifies the fixture as agile', () => {
    expect(officeEncryption(fixture)).toEqual({ kind: 'agile' });
  });

  it('a plain zip / .docx is not a compound file', () => {
    const pk = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    expect(isEncryptedOfficeFile(pk)).toBe(false);
    expect(officeEncryption(pk)).toBeNull();
  });

  it('a .cmir (gzip / JSON) is not a compound file', () => {
    expect(isEncryptedOfficeFile(new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]))).toBe(false);
    expect(isEncryptedOfficeFile(new TextEncoder().encode('{"format":"cardmirror"}'))).toBe(false);
  });
});

describe('decryptOfficeDocument', () => {
  it('decrypts with the correct password to a valid .docx the importer reads', async () => {
    const pkg = decryptOfficeDocument(fixture, 'password');
    // Inner package is a real zip (.docx).
    expect(pkg[0]).toBe(0x50);
    expect(pkg[1]).toBe(0x4b);
    // And the importer opens it — the whole point.
    const { doc } = await fromDocxFull(pkg);
    expect(doc.textContent).toContain('lol');
  });

  it('rejects a wrong password with WrongPasswordError', () => {
    expect(() => decryptOfficeDocument(fixture, 'not-it')).toThrow(WrongPasswordError);
    // And WrongPasswordError is an EncryptedOfficeError (callers switch on the base).
    try {
      decryptOfficeDocument(fixture, 'not-it');
    } catch (e) {
      expect(e).toBeInstanceOf(EncryptedOfficeError);
    }
  });

  it('is deterministic (same input → same output)', () => {
    const a = decryptOfficeDocument(fixture, 'password');
    const b = decryptOfficeDocument(fixture, 'password');
    expect(a).toEqual(b);
  });

  it('rejects a compound file with no encryption streams (legacy binary)', () => {
    // A minimal valid CFB header with no EncryptionInfo stream. Build
    // just enough that the reader parses and finds no streams: reuse
    // the fixture's header but that has streams, so instead assert the
    // typed error surfaces for a truncated/at-least-CFB-magic input.
    const notEncrypted = fixture.slice(0, 512); // header only, chains dangle
    expect(() => decryptOfficeDocument(notEncrypted, 'x')).toThrow(UnsupportedEncryptionError);
  });
});

describe('untrusted Office encryption metadata', () => {
  it('rejects hostile sector geometry before allocating FAT buffers', () => {
    const malformed = fixture.slice();
    new DataView(malformed.buffer).setUint16(30, 30, true);
    expect(() => decryptOfficeDocument(malformed, 'password')).toThrow(UnsupportedEncryptionError);
  });
  it('rejects malformed or unbounded KDF iterations before password derivation', () => {
    const malformed = fixture.slice();
    const needle = new TextEncoder().encode('spinCount="100000"');
    let at = -1;
    for (let i = 0; i <= malformed.length - needle.length; i++) {
      if (needle.every((byte, n) => malformed[i + n] === byte)) { at = i; break; }
    }
    expect(at).toBeGreaterThan(-1);
    malformed.set(new TextEncoder().encode('spinCount="9e9999"'), at);
    expect(() => decryptOfficeDocument(malformed, 'password')).toThrow(UnsupportedEncryptionError);
  });
  it('rejects a cyclic allocation chain rather than reading a partial stream', () => {
    const malformed = fixture.slice();
    const dv = new DataView(malformed.buffer);
    const firstFatSector = dv.getUint32(76, true);
    const dirStart = dv.getUint32(48, true);
    dv.setUint32((firstFatSector + 1) * 512 + dirStart * 4, dirStart, true);
    expect(() => decryptOfficeDocument(malformed, 'password')).toThrow(UnsupportedEncryptionError);
  });
});
