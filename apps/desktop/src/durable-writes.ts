/** Flush file contents before publishing a replacement, then its directory entry.
 * These are OS durability requests, not a guarantee against every storage failure.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export async function writeSyncedFile(filePath: string, bytes: Uint8Array, flags: 'w' | 'wx', mode = 0o600): Promise<void> {
  const handle = await fs.open(filePath, flags, mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Directory handles/fsync are unavailable on Windows and some filesystems.
 * Only unsupported-operation errors are ignored; actual I/O failures surface.
 */
export async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await fs.open(dir, 'r');
    try { await handle.sync(); }
    finally { await handle.close(); }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EISDIR'].includes(code ?? '')) return;
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(code ?? '')) return;
    throw err;
  }
}

/** Build the finite parent walk before doing I/O. mkdir may return an
 * equivalent path with different separators, drive casing, or namespace form.
 */
export function directoryParentsToSync(
  dir: string,
  firstCreated: string,
  pathApi: Pick<typeof path, 'resolve' | 'dirname' | 'relative' | 'toNamespacedPath'> = path,
): string[] {
  const first = pathApi.resolve(firstCreated);
  const firstIdentity = pathApi.toNamespacedPath(first);
  const parents: string[] = [];
  for (let current = pathApi.resolve(dir); ; ) {
    const parent = pathApi.dirname(current);
    parents.push(parent);
    // Windows may report mkdir's result using an extended drive/UNC path.
    // Normalize identity only; keep the original parent paths for filesystem I/O.
    if (pathApi.relative(firstIdentity, pathApi.toNamespacedPath(current)) === '') return parents;
    // Fail instead of repeatedly syncing the root if mkdir ever returns
    // a path outside this ancestry (including another Windows volume).
    if (pathApi.relative(current, parent) === '') {
      throw new Error(`Created directory is not an ancestor of the destination: ${JSON.stringify({
        destination: dir,
        firstCreated,
        resolvedFirstCreated: first,
        stoppedAt: current,
      })}`);
    }
    current = parent;
  }
}

export async function makeDurableDirectory(dir: string): Promise<void> {
  const absolute = path.resolve(dir);
  const firstCreated = await fs.mkdir(absolute, { recursive: true });
  if (!firstCreated) return;
  // Each newly created directory is an entry in its parent. Flush from
  // deepest to shallowest so recursively created destination folders persist.
  for (const parent of directoryParentsToSync(absolute, firstCreated)) await syncDirectory(parent);
}

/** Return an exclusively created, fully written and synced sibling stage. */
export async function stageSyncedFile(filePath: string, bytes: Uint8Array, suffix = 'cmtmp', mode = 0o600): Promise<string> {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.${suffix}`);
  // Open outside cleanup: an exclusive-create failure does not own this path.
  const handle = await fs.open(tmp, 'wx', mode);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
  return tmp;
}

/** Journals do not use the document save pipeline's in-place fallback. */
export async function replaceDurably(filePath: string, bytes: Uint8Array): Promise<void> {
  const tmp = await stageSyncedFile(filePath, bytes, 'tmp');
  try {
    await fs.rename(tmp, filePath);
    await syncDirectory(path.dirname(filePath));
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}
