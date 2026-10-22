// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readResponseTextBounded } from '../../apps/desktop/src/bounded-response.js';
describe('bounded remote plugin responses', () => {
  it('accepts exact byte limits and decodes split UTF-8 correctly', async () => {
    const bytes = new TextEncoder().encode('é');
    const stream = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 1)); c.enqueue(bytes.slice(1)); c.close(); } });
    expect(await readResponseTextBounded(new Response(stream), 2)).toBe('é');
  });
  it('rejects declared excess and counts actual bytes when the server lies', async () => {
    await expect(readResponseTextBounded(new Response('x', { headers: { 'content-length': '999' } }), 4)).rejects.toThrow(/size limit/);
    await expect(readResponseTextBounded(new Response('abcdef', { headers: { 'content-length': '1' } }), 4)).rejects.toThrow(/size limit/);
  });
  it('cancels oversized and stalled bodies instead of waiting indefinitely', async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } });
    await expect(readResponseTextBounded(new Response(stream), 4)).rejects.toThrow(/size limit/);
    expect(cancelled).toBe(true);
    const stalled = new ReadableStream();
    await expect(readResponseTextBounded(new Response(stalled), 4, 10)).rejects.toThrow(/timed out/);
  });
});
