import { afterEach, describe, expect, it, vi } from 'vitest';
import { app, session } from 'electron';
import { desktopFetch } from '../../apps/desktop/src/desktop-fetch.js';

afterEach(() => vi.restoreAllMocks());

describe('desktop Chromium transport boundary', () => {
  it('forwards requests through the isolated session without Node fetch or browser credentials', async () => {
    const response = new Response('ok');
    const chromiumFetch = vi.fn().mockResolvedValue(response);
    const redirectHeaders = vi.fn();
    const partition = vi.spyOn(session, 'fromPartition').mockReturnValue({
      fetch: chromiumFetch, webRequest: { onBeforeSendHeaders: redirectHeaders },
    } as any);
    const readiness = Promise.withResolvers<void>();
    const ready = vi.spyOn(app, 'whenReady').mockReturnValue(readiness.promise as any);
    const nodeFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Node transport must not run'));
    const signal = new AbortController().signal;
    const pending = desktopFetch(new URL('https://example.test/path'), {
      method: 'POST', body: 'payload', headers: { Authorization: 'Bearer test' }, signal,
      credentials: 'include', cache: 'force-cache',
    });
    expect(chromiumFetch).not.toHaveBeenCalled();
    readiness.resolve();
    const result = await pending;
    expect(result).toBe(response);
    expect(ready).toHaveBeenCalled();
    expect(partition).toHaveBeenCalledWith(expect.stringMatching(/^cardmirror-advanced-network-[a-f0-9]{64}$/), { cache: false });
    expect(chromiumFetch).toHaveBeenCalledWith('https://example.test/path', {
      method: 'POST', body: 'payload', headers: { Authorization: 'Bearer test' }, signal,
      credentials: 'omit', cache: 'no-store', bypassCustomProtocolHandlers: true,
    });
    expect(nodeFetch).not.toHaveBeenCalled();
    const filter = redirectHeaders.mock.calls[0]![0];
    const headers = { AUTHORIZATION: 'Bearer test', Cookie: 'secret', 'X-Bridge-Token': 'secret', Accept: 'application/json' };
    const callback = vi.fn();
    filter({ url: 'https://example.test/redirect', requestHeaders: headers }, callback);
    expect(callback).toHaveBeenLastCalledWith({ requestHeaders: headers });
    filter({ url: 'https://other.test/redirect', requestHeaders: headers }, callback);
    expect(callback).toHaveBeenLastCalledWith({ requestHeaders: { Accept: 'application/json' } });
  });

  it.each(['file:///private.txt', 'data:text/plain,secret', 'cardmirror://local', 'ftp://example.test/file'])(
    'refuses non-HTTP URL %s before creating a session',
    async (url) => {
      const partition = vi.spyOn(session, 'fromPartition');
      await expect(desktopFetch(url)).rejects.toThrow('HTTP(S)');
      expect(partition).not.toHaveBeenCalled();
    },
  );
});
