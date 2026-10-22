import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import type { QuickCard } from '../../src/editor/quick-cards-store.js';

vi.mock('../../src/editor/host/index.js', () => ({ getElectronHost: () => null }));
vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

const legacyKey = 'pmd-quick-cards';
const migratedKey = `${legacyKey}:migrated-to-idb`;
let localValues: Map<string, string>;

function card(id: string): QuickCard {
  return { id, name: id, nameLower: id, tags: [], tagsLower: [], textLower: '',
    contentJson: {}, sourceName: '', createdAt: 1, updatedAt: 1 };
}

async function newTab() {
  // Separate module instances model independent renderer tabs while sharing
  // the IndexedDB factory, which serializes actual readwrite transactions.
  vi.resetModules();
  return (await import('../../src/editor/quick-cards-store.js')).quickCardsStore;
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('navigator', {}); // No Web Locks fallback to hide races.
  localValues = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => localValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localValues.set(key, value); },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Quick Cards atomic web persistence', () => {
  it('merges simultaneous writes from independent tabs without Web Locks', async () => {
    const left = await newTab();
    const right = await newTab();
    await Promise.all([left.init(), right.init()]);
    await Promise.all([left.upsert(card('left')), right.upsert(card('right'))]);
    const reopened = await newTab();
    await reopened.init();
    expect(reopened.list().map((c) => c.id).sort()).toEqual(['left', 'right']);
  });

  it('serializes import and removal instead of replacing another tab\'s edit', async () => {
    const left = await newTab();
    const right = await newTab();
    await left.importMany([card('remove'), card('keep')]);
    await Promise.all([left.remove('remove'), right.importMany([card('imported')])]);
    const reopened = await newTab();
    await reopened.init();
    expect(reopened.list().map((c) => c.id).sort()).toEqual(['imported', 'keep']);
  });

  it('commits migration with initialization before a concurrent clear', async () => {
    localValues.set(legacyKey, JSON.stringify([card('legacy')]));
    const loading = await newTab();
    const clearing = await newTab();
    await Promise.all([loading.init(), clearing.clear()]);
    const reopened = await newTab();
    await reopened.init();
    expect(reopened.list()).toEqual([]);
    // The old localStorage data remains, but is never resurrected.
    expect(localValues.has(legacyKey)).toBe(true);
  });

  it('does not let pending initialization restore cards after clear in the same tab', async () => {
    localValues.set(legacyKey, JSON.stringify([card('legacy')]));
    const store = await newTab();
    await Promise.all([store.init(), store.clear()]);
    expect(store.list()).toEqual([]);
    await store.upsert(card('after-clear'));
    expect(store.list().map((c) => c.id)).toEqual(['after-clear']);
  });

  it('rolls back both migration data and its marker when the marker write fails', async () => {
    localValues.set(legacyKey, JSON.stringify([card('original')]));
    const store = await newTab();
    const put = IDBObjectStore.prototype.put;
    const failure = new DOMException('Storage full', 'QuotaExceededError');
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (key === migratedKey) throw failure;
      return put.call(this, value, key);
    });
    await expect(store.init()).rejects.toBe(failure);
    expect(store.list()).toEqual([]);
    expect(localValues.get(migratedKey)).toBeUndefined();
    spy.mockRestore();
    localValues.set(legacyKey, JSON.stringify([card('retry')]));
    await store.init();
    expect(store.list().map((c) => c.id)).toEqual(['retry']);
    const reopened = await newTab();
    await reopened.init();
    expect(reopened.list().map((c) => c.id)).toEqual(['retry']);
  });

  it('rejects a failed mutation without changing the committed cache or notifying success', async () => {
    const store = await newTab();
    await store.upsert(card('saved'));
    const changed = vi.fn();
    store.subscribe(changed);
    const failure = new DOMException('Storage full', 'QuotaExceededError');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw failure; });
    await expect(store.remove('saved')).rejects.toBe(failure);
    expect(store.list().map((c) => c.id)).toEqual(['saved']);
    expect(changed).not.toHaveBeenCalled();
    const reopened = await newTab();
    await reopened.init();
    expect(reopened.list().map((c) => c.id)).toEqual(['saved']);
  });

  it('waits for transaction completion rather than treating successful puts as a commit', async () => {
    const store = await newTab();
    await store.upsert(card('saved'));
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key);
      // A browser can abort after a put was enqueued (quota/I/O failure).
      const tx = this.transaction;
      queueMicrotask(() => tx.abort());
      return request;
    });
    await expect(store.upsert(card('uncommitted'))).rejects.toThrow();
    spy.mockRestore();
    expect(store.list().map((c) => c.id)).toEqual(['saved']);
    const reopened = await newTab();
    await reopened.init();
    expect(reopened.list().map((c) => c.id)).toEqual(['saved']);
  });

  it('loads an existing committed library and subscribes when writes are refused', async () => {
    const channels: Array<{ listeners: Set<() => void> }> = [];
    vi.stubGlobal('BroadcastChannel', class {
      listeners = new Set<() => void>();
      constructor() { channels.push(this); }
      postMessage(): void {}
      addEventListener(_name: string, listener: () => void): void { this.listeners.add(listener); }
      removeEventListener(_name: string, listener: () => void): void { this.listeners.delete(listener); }
    });
    const writer = await newTab();
    await writer.upsert(card('saved'));
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    const reader = await newTab();
    await reader.init();
    expect(reader.list().map((c) => c.id)).toEqual(['saved']);
    expect(put).not.toHaveBeenCalled();
    const readerChannel = channels.at(-1)!;
    expect(readerChannel.listeners.size).toBe(1);
    put.mockRestore();
    await writer.upsert(card('later'));
    for (const listener of readerChannel.listeners) listener();
    await vi.waitFor(() => expect(reader.list().map((c) => c.id)).toEqual(['saved', 'later']));
  });

  it('honors the previous migration marker when upgrading an already-cleared library', async () => {
    localValues.set(legacyKey, JSON.stringify([card('legacy')]));
    localValues.set(migratedKey, '1');
    const store = await newTab();
    await store.init();
    expect(store.list()).toEqual([]);
  });

  it('preserves earlier cards in memory without IndexedDB, including migration and clear', async () => {
    vi.stubGlobal('indexedDB', undefined);
    localValues.set(legacyKey, JSON.stringify([card('legacy')]));
    const store = await newTab();
    await store.init();
    await store.upsert(card('added'));
    await store.importMany([card('imported')]);
    expect(store.list().map((c) => c.id)).toEqual(['legacy', 'added', 'imported']);
    await store.remove('added');
    expect(store.list().map((c) => c.id)).toEqual(['legacy', 'imported']);
    await store.clear();
    await store.upsert(card('fresh'));
    expect(store.list().map((c) => c.id)).toEqual(['fresh']);
    expect(localValues.get(migratedKey)).toBeUndefined();
  });
});
