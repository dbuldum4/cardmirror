// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createClipboardBridge } from '../../apps/desktop/src/clipboard-bridge.js';

function setup() {
  let stored: Record<string, string> = {};
  const port = {
    read: vi.fn(async () => [{ types: Object.keys(stored), getType: async (type: string) => new Blob([stored[type] ?? '']) }]),
    readText: vi.fn(async () => stored['text/plain'] ?? ''),
    write: vi.fn(async (items: Record<string, string>[]) => { stored = items[0]!; }),
  };
  return { port, bridge: createClipboardBridge(port, (data) => data) };
}
describe('Electron asynchronous rich clipboard bridge', () => {
  it('writes both flavors atomically, awaits completion, and reads a consistent snapshot', async () => {
    const { port, bridge } = setup();
    expect(await bridge.writeRich({ html: '<b>card</b>', text: 'card' })).toBe(true);
    expect(port.write).toHaveBeenCalledWith([{ 'text/html': '<b>card</b>', 'text/plain': 'card' }]);
    expect(await bridge.readRich()).toEqual({ html: '<b>card</b>', text: 'card' });
  });
  it('does not register empty rich flavors for text-only copy', async () => {
    const { port, bridge } = setup();
    expect(await bridge.writeRich({ text: 'plain' })).toBe(true);
    expect(port.write).toHaveBeenCalledWith([{ 'text/plain': 'plain' }]);
    expect(await bridge.readRich()).toEqual({ html: '', text: 'plain' });
  });
  it('rejects empty input, reports races, and propagates write failures', async () => {
    const { port, bridge } = setup();
    expect(await bridge.writeRich({ html: 5 })).toBe(false);
    expect(port.write).not.toHaveBeenCalled();
    port.readText.mockResolvedValueOnce('replaced');
    expect(await bridge.writeRich({ text: 'card' })).toBe(false);
    port.write.mockRejectedValueOnce(new Error('clipboard unavailable'));
    await expect(bridge.writeRich({ text: 'card' })).rejects.toThrow('clipboard unavailable');
  });
});
