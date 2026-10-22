import { afterEach, expect, it, vi } from 'vitest';
import { session } from 'electron';
import { desktopFetch } from '../../apps/desktop/src/desktop-fetch.js';

vi.mock('../../apps/desktop/src/lite-build.js', () => ({ LITE_BUILD: true }));
afterEach(() => vi.restoreAllMocks());

it('Lite refuses internet requests before creating a networking session', async () => {
  const partition = vi.spyOn(session, 'fromPartition');
  for (const url of ['https://example.test/', 'http://example.test/', 'http://localhost/']) {
    await expect(desktopFetch(url)).rejects.toThrow('Internet requests are disabled');
  }
  expect(partition).not.toHaveBeenCalled();
});

it('Lite keeps loopback Flow requests but blocks redirects to the internet', async () => {
  const beforeRequest = vi.fn();
  const chromiumFetch = vi.fn().mockResolvedValue(new Response('flow control'));
  vi.spyOn(session, 'fromPartition').mockReturnValue({
    fetch: chromiumFetch,
    webRequest: { onBeforeSendHeaders: vi.fn(), onBeforeRequest: beforeRequest },
  } as any);
  expect(await (await desktopFetch('http://127.0.0.1:17699/ping')).text()).toBe('flow control');
  const filter = beforeRequest.mock.calls[0]![0];
  const callback = vi.fn();
  filter({ url: 'http://127.0.0.1:17699/ping' }, callback);
  expect(callback).toHaveBeenLastCalledWith({ cancel: false });
  for (const url of ['https://example.test/', 'http://example.test/', 'file:///private.txt']) {
    filter({ url }, callback);
    expect(callback).toHaveBeenLastCalledWith({ cancel: true });
  }
});
