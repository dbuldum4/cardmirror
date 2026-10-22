/** Atomic HTML/plain-text clipboard IPC for Electron 45's asynchronous API. */
export interface ClipboardReadItem {
  readonly types: readonly string[];
  getType(type: string): Promise<unknown>;
}
export interface ClipboardPort<T> {
  read(): Promise<ClipboardReadItem[]>;
  readText(): Promise<string>;
  write(items: T[]): Promise<void>;
}

async function asText(value: unknown): Promise<string> {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'function') return value.text();
  return '';
}

export function createClipboardBridge<T>(clipboard: ClipboardPort<T>, makeItem: (data: Record<string, string>) => T) {
  return {
    async readRich(): Promise<{ html: string; text: string }> {
      const items = await clipboard.read();
      let html = '';
      let text = '';
      for (const item of items) {
        if (!html && item.types.includes('text/html')) html = await asText(await item.getType('text/html'));
        if (!text && item.types.includes('text/plain')) text = await asText(await item.getType('text/plain'));
      }
      return { html, text };
    },
    async writeRich(payload?: { html?: unknown; text?: unknown }): Promise<boolean> {
      const html = typeof payload?.html === 'string' ? payload.html : '';
      const text = typeof payload?.text === 'string' ? payload.text : '';
      if (!html && !text) return false;
      const data: Record<string, string> = {};
      // An empty HTML flavor would make Word paste nothing for a text-only copy.
      if (html) data['text/html'] = html;
      if (text) data['text/plain'] = text;
      await clipboard.write([makeItem(data)]);
      if (!text) return true;
      const actual = await clipboard.readText();
      return actual.length === text.length && actual.slice(0, 4096) === text.slice(0, 4096);
    },
  };
}
