// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { sprintf, vsprintf } = require('../../apps/desktop/vendor/sprintf-js/index.cjs') as {
  sprintf: (format: string, ...args: unknown[]) => string;
  vsprintf: (format: string, args: unknown[]) => string;
};
describe('bounded desktop packaging formatter', () => {
  it('preserves named, positional, width, precision, and array formatting', () => {
    expect(sprintf('%04d %.2f %s', 7, 1.25, 'file')).toBe('0007 1.25 file');
    expect(sprintf('%(file.name)s', { file: { name: 'output.dmg' } })).toBe('output.dmg');
    expect(vsprintf('%2$s %1$s', ['one', 'two'])).toBe('two one');
  });
  it('rejects malicious precision and width before allocating output', () => {
    for (const format of ['%999999999999s', '%.999999999999s', '%.999999999999f']) expect(() => sprintf(format, 'x')).toThrow(/safety limit/);
    expect(() => sprintf('x'.repeat(65537))).toThrow(/safety limit/);
  });
});
