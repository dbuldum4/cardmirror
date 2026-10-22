/**
 * Window-open and navigation policy for every BrowserWindow.
 *
 * Without a `setWindowOpenHandler`, Electron answers a renderer's
 * `window.open` / `target="_blank"` click by creating a NEW BrowserWindow
 * that inherits the opener's webPreferences — preload included — so a
 * footnote link in a shared document would open an arbitrary website inside
 * the app with `window.electronAPI` (file writes and all) exposed to it.
 * Likewise an unguarded top-level navigation would swap the editor for a
 * remote page that keeps the preload. (Security report 2026-10-08.)
 *
 * Policy: the window itself may only navigate within the app's own origin
 * (the Vite dev server in development, exact file URLs in a packaged build). Every
 * other http(s)/mailto URL goes to the OS browser via `shell.openExternal`;
 * everything else (javascript:, data:, file: from a link, custom schemes) is
 * dropped. Pure decision function here so it's unit-testable; main.ts wires
 * it to the Electron events.
 */

export type NavDecision =
  | { kind: 'allow' }
  | { kind: 'external'; url: string }
  | { kind: 'deny' };

const EXTERNAL_OK = /^(https?:|mailto:)/i;

/** Decide what to do with a URL a renderer tried to open or navigate to.
 *  `ownOrigins` are the origins the app's own pages load from. */
export function decideNavigation(url: string, ownOrigins: readonly string[]): NavDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'deny' };
  }
  if (parsed.protocol === 'file:') {
    // file: URLs have the same opaque origin. Only the actual editor/timer
    // entry files may keep the privileged preload; never trust all local HTML.
    const sameEntry = ownOrigins.some((entry) => {
      try {
        const own = new URL(entry);
        return own.protocol === 'file:' && own.host === parsed.host && own.pathname === parsed.pathname;
      } catch { return false; }
    });
    return { kind: sameEntry ? 'allow' : 'deny' };
  }
  if (['http:', 'https:'].includes(parsed.protocol) && ownOrigins.includes(parsed.origin)) return { kind: 'allow' };
  if (EXTERNAL_OK.test(url)) return { kind: 'external', url };
  return { kind: 'deny' };
}

/** A new window request is never allowed to become an app window: the
 *  app opens its own windows through IPC, never `window.open`, so a request
 *  for our own origin is dropped rather than bounced to the OS browser.
 *  Other URLs follow the navigation policy: http(s)/mailto to the OS
 *  browser, the rest dropped. */
export function decideWindowOpen(url: string, ownOrigins: readonly string[]): Exclude<NavDecision, { kind: 'allow' }> {
  const d = decideNavigation(url, ownOrigins);
  return d.kind === 'allow' ? { kind: 'deny' } : d;
}
