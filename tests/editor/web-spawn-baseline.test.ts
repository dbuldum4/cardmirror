// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

it('carries the original freshness baseline across the IndexedDB window handoff', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
  const { BrowserHost } = await import('../../src/editor/host/browser-host.js');
  const original = new BrowserHost();
  const handle = { name: 'draft.cmir' };
  // Browser native handles are structured-cloneable. fake-indexeddb cannot
  // clone native methods, so install the file API as non-enumerable properties.
  let writes = 0;
  Object.defineProperties(handle, {
    getFile: { value: async () => new File(['old'], handle.name, { lastModified: 10 }) },
    createWritable: { value: async () => ({ write: async () => { writes++; }, close: async () => {} }) },
  });
  await original.saveExisting(handle, new Uint8Array([1]));
  let opened = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    opened = this.href;
  });
  await original.spawnWindow({ filename: handle.name, handle: handle as FileSystemFileHandle,
    bytes: new Uint8Array([1]), uid: null, format: 'cmir' });
  expect(opened).toContain('?spawn=');
  window.history.replaceState({}, '', opened);
  vi.resetModules(); // a new window has a fresh BrowserHost and module state
  const { BrowserHost: SpawnedHost } = await import('../../src/editor/host/browser-host.js');
  const spawned = new SpawnedHost();
  const payload = await spawned.getInitialDoc();
  expect(payload?.browserFileBaseline).toEqual({ mtimeMs: 10, size: 3 });
  expect(payload?.handle).not.toBe(handle);
  const received = payload!.handle as object;
  Object.defineProperties(received, {
    getFile: { value: async () => new File(['newer remote edit'], handle.name, { lastModified: 20 }) },
    createWritable: { value: async () => { writes++; throw new Error('must not overwrite'); } },
  });
  await expect(spawned.saveExisting(received, payload!.bytes)).rejects.toThrow(/EMODIFIED/);
  expect(writes).toBe(1);
});

it('keeps the original baseline through browser journal recovery', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
  const { BrowserHost } = await import('../../src/editor/host/browser-host.js');
  const original = new BrowserHost();
  const handle = { name: 'recovery.cmir' };
  Object.defineProperties(handle, {
    getFile: { value: async () => new File(['old'], handle.name, { lastModified: 10 }) },
    createWritable: { value: async () => ({ write: async () => {}, close: async () => {} }) },
  });
  const bytes = new Uint8Array([1]);
  await original.saveExisting(handle, bytes);
  await original.writeJournal({ uid: 'recovered', filename: handle.name, handle,
    format: 'cmir', savedAt: new Date().toISOString(), bytes });
  const recovered = new BrowserHost();
  const [entry] = await recovered.readJournals();
  expect(entry!.diskBase).toEqual({ mtimeMs: 10, size: 3 });
  const received = entry!.handle as object;
  Object.defineProperties(received, {
    getFile: { value: async () => new File(['remote edit'], handle.name, { lastModified: 20 }) },
    createWritable: { value: async () => { throw new Error('must not overwrite'); } },
  });
  await expect(recovered.saveExisting(received, bytes)).rejects.toThrow(/EMODIFIED/);
});


it('rejects an aborted browser journal transaction instead of leaving preservation pending', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
  const { BrowserHost } = await import('../../src/editor/host/browser-host.js');
  const host = new BrowserHost();
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
    const request = put.call(this, value, key);
    queueMicrotask(() => this.transaction.abort());
    return request;
  });
  await expect(host.writeJournal({ uid: 'aborted', filename: 'draft.cmir', handle: null,
    format: 'cmir', savedAt: new Date().toISOString(), bytes: new Uint8Array([1]) })).rejects.toThrow();
  expect(await host.readJournals()).toEqual([]);
});
