/**
 * Web cross-tab store for a single JSON-serializable value (an array of items,
 * in practice), backed by IndexedDB — which, unlike `localStorage`'s ~5 MB cap,
 * gets a large disk-fraction quota, so image-heavy dropzone content and a
 * growing quick-cards library fit. Cross-tab live sync rides a BroadcastChannel,
 * since IndexedDB has no built-in cross-tab change event: after a write we ping
 * the channel and other tabs re-`load()`.
 *
 * WEB ONLY — the Electron editions keep their main-process backends. All ops are
 * Where IndexedDB is unavailable, values remain in memory for the current tab,
 * without persistence or cross-tab sync. save() is best-effort; mutate()
 * rejects refused transactions so callers can distinguish failed writes.
 */

import { showToast } from './toast.js';

const DB_NAME = 'cardmirror-web';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = (): void => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => resolve(null);
  });
  return dbPromise;
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' || err.code === 22)
  );
}

export class WebSharedStore<T> {
  private readonly channel: BroadcastChannel | null;
  private memoryValue: T | null = null;
  private readonly memoryMarkers = new Set<string>();

  /**
   * @param key         IndexedDB key the value lives under.
   * @param channelName BroadcastChannel name for cross-tab notifications.
   * @param label       Human name used in the quota toast (e.g. "dropzone shelf").
   */
  constructor(
    private readonly key: string,
    private readonly channelName: string,
    private readonly label: string,
  ) {
    this.channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(channelName)
        : null;
  }

  /** Load the stored value, or null if absent / storage unavailable. */
  async load(): Promise<T | null> {
    const db = await openDb();
    if (!db) return this.memoryValue;
    return new Promise((resolve) => {
      let req: IDBRequest;
      try {
        req = db.transaction(STORE, 'readonly').objectStore(STORE).get(this.key);
      } catch {
        resolve(null);
        return;
      }
      req.onsuccess = (): void => resolve((req.result as T | undefined) ?? null);
      req.onerror = (): void => resolve(null);
    });
  }

  /** Read, synchronously transform, and commit as one serialized transaction.
   * The optional migration seed and marker commit with the value, so a failed
   * first write remains retryable and a later clear cannot resurrect the seed.
   * Unlike best-effort save(), a refused transaction rejects its caller. */
  async mutate(
    apply: (current: T | null) => T,
    migration?: { markerKey: string; initialValue: () => T },
  ): Promise<T> {
    const db = await openDb();
    if (!db) {
      const initial = this.memoryValue === null && migration && !this.memoryMarkers.has(migration.markerKey)
        ? migration.initialValue() : this.memoryValue;
      const value = apply(initial);
      this.memoryValue = value;
      if (migration) this.memoryMarkers.add(migration.markerKey);
      return value;
    }
    try {
      const value = await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        let value: T;
        let failure: unknown;
        tx.oncomplete = (): void => resolve(value);
        tx.onerror = tx.onabort = (): void => reject(failure ?? tx.error ?? new Error('write aborted'));
        const current = store.get(this.key);
        const marker = migration ? store.get(migration.markerKey) : null;
        // Both requests run in this transaction; the last request's callback
        // may enqueue writes without yielding and making the transaction idle.
        const write = (): void => {
          try {
            const initial = current.result === undefined && migration && !marker?.result
              ? migration.initialValue() : (current.result as T | undefined) ?? null;
            value = apply(initial);
            store.put(value, this.key);
            if (migration) store.put(true, migration.markerKey);
          } catch (err) {
            failure = err;
            tx.abort();
          }
        };
        if (marker) marker.onsuccess = write;
        else current.onsuccess = write;
      });
      this.channel?.postMessage('changed');
      return value;
    } catch (err) {
      this.reportFailure(err);
      throw err;
    }
  }

  /** Persist `value` and ping other tabs. Best-effort; toasts on quota refusal. */
  async save(value: T): Promise<void> {
    const db = await openDb();
    if (!db) { this.memoryValue = value; return; }
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, this.key);
        tx.oncomplete = (): void => resolve();
        tx.onerror = (): void => reject(tx.error ?? new Error('write failed'));
        tx.onabort = (): void => reject(tx.error ?? new Error('write aborted'));
      });
      // BroadcastChannel doesn't echo to the sender, so only OTHER tabs reload.
      this.channel?.postMessage('changed');
    } catch (err) {
      this.reportFailure(err);
    }
  }

  private reportFailure(err: unknown): void {
    console.warn(`[cardmirror] ${this.label}: web persist failed`, err);
    if (isQuotaError(err)) {
      showToast(`Couldn't save the ${this.label} — browser storage is full.`);
    }
  }

  /** Run `fn` when another tab writes. Returns an unsubscribe. */
  onExternalChange(fn: () => void): () => void {
    if (!this.channel) return () => {};
    const handler = (): void => fn();
    this.channel.addEventListener('message', handler);
    return () => this.channel?.removeEventListener('message', handler);
  }
}
