/** Bound remote metadata and plugin assets before decoding/JSON parsing. */
export async function readResponseTextBounded(response: Response, limit: number, timeoutMs = 10_000): Promise<string> {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid response size limit.');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw new Error('Response exceeds the size limit.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let out = '';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, timeoutMs);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (timedOut) throw new Error('Response body timed out.');
      if (done) return out + decoder.decode();
      size += value.byteLength;
      if (size > limit) throw new Error('Response exceeds the size limit.');
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
