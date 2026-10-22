import { app, session, type Session } from 'electron';
import { createHash } from 'node:crypto';
import { LITE_BUILD } from './lite-build.js';

const networkSessions = new Map<string, Session>();
const allowedInLite = (url: URL): boolean => url.protocol === 'http:' && url.hostname === '127.0.0.1';

/**
 * Main-process HTTP uses Chromium's networking/TLS implementation rather than
 * the embedded Node client stack. Keep it separate from renderer cookies,
 * authentication caches, protocol handlers, and persistent browser storage.
 */
export async function desktopFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Desktop network requests require an HTTP(S) URL.');
  }
  if (LITE_BUILD && !allowedInLite(url)) {
    throw new TypeError('Internet requests are disabled in CardMirror Advanced Lite.');
  }
  await app.whenReady();
  let networkSession = networkSessions.get(url.origin);
  if (!networkSession) {
    // Keep the original origin available on every redirect hop. Electron's
    // fetch currently retains explicitly supplied Authorization across origins.
    const partition = 'cardmirror-advanced-network-' + createHash('sha256').update(url.origin).digest('hex');
    networkSession = session.fromPartition(partition, { cache: false });
    const origin = url.origin;
    if (LITE_BUILD) {
      // The renderer's default-session blocker does not cover private sessions.
      // Keep local Flow integration, and block internet redirects as well.
      networkSession.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !allowedInLite(new URL(details.url)) });
      });
    }
    networkSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      if (new URL(details.url).origin !== origin) {
        for (const name of Object.keys(headers)) {
          if (['authorization', 'proxy-authorization', 'cookie', 'x-bridge-token'].includes(name.toLowerCase())) {
            delete headers[name];
          }
        }
      }
      callback({ requestHeaders: headers });
    });
    networkSessions.set(url.origin, networkSession);
  }
  return networkSession.fetch(url.href, {
    ...init,
    credentials: 'omit',
    cache: 'no-store',
    bypassCustomProtocolHandlers: true,
  });
}
