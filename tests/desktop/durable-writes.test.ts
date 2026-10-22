// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { directoryParentsToSync, makeDurableDirectory, replaceDurably, syncDirectory } from '../../apps/desktop/src/durable-writes.js';
import { resetDocWritesForTests, saveNewDoc } from '../../apps/desktop/src/doc-writes.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-durable-'));
  resetDocWritesForTests();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

function ioError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`injected ${code}`), { code });
}

/** Instrument real handles: writes/renames still touch an isolated filesystem. */
function observeHandles(events: string[], failSync?: (file: string) => string | undefined): void {
  const realOpen = fs.open;
  vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
    const handle = await realOpen(file, flags, mode);
    const name = String(file);
    const kind = name === dir ? 'directory' : name.endsWith('.cmtmp') || name.endsWith('.tmp') ? 'stage' : 'target';
    events.push(`${kind}:open:${flags}`);
    const write = handle.writeFile.bind(handle);
    vi.spyOn(handle, 'writeFile').mockImplementation(async (...args) => {
      events.push(`${kind}:write`);
      return write(...args);
    });
    const sync = handle.sync.bind(handle);
    vi.spyOn(handle, 'sync').mockImplementation(async () => {
      events.push(`${kind}:sync`);
      const code = failSync?.(name);
      if (code) throw ioError(code);
      return sync();
    });
    const close = handle.close.bind(handle);
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      events.push(`${kind}:close`);
      return close();
    });
    return handle;
  });
}

describe('durable replacements (document and recovery-journal disk layer)', () => {
  it('syncs and closes the exclusive stage before rename, then syncs the directory', async () => {
    const target = path.join(dir, 'draft.cmir-journal');
    const events: string[] = [];
    observeHandles(events);
    const rename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      events.push('rename');
      return rename(from, to);
    });
    await replaceDurably(target, Buffer.from('recoverable'));
    expect(events.filter((event) => !event.startsWith('directory:'))).toEqual(['stage:open:wx', 'stage:write', 'stage:sync', 'stage:close', 'rename']);
    if (process.platform !== 'win32') expect(events.slice(-3)).toEqual(['directory:open:r', 'directory:sync', 'directory:close']);
    expect(await fs.readFile(target, 'utf8')).toBe('recoverable');
    expect(await fs.readdir(dir)).toEqual(['draft.cmir-journal']);
  });

  it('does not publish a stage that failed to sync, closes it, and removes only that stage', async () => {
    const target = path.join(dir, 'doc.cmir');
    await fs.writeFile(target, 'previous');
    const events: string[] = [];
    observeHandles(events, (file) => file.endsWith('.cmtmp') ? 'EIO' : undefined);
    const rename = vi.spyOn(fs, 'rename');
    await expect(saveNewDoc(target, Buffer.from('next'))).rejects.toThrow('injected EIO');
    expect(rename).not.toHaveBeenCalled();
    expect(events).toEqual(['stage:open:wx', 'stage:write', 'stage:sync', 'stage:close']);
    expect(await fs.readFile(target, 'utf8')).toBe('previous');
    expect(await fs.readdir(dir)).toEqual(['doc.cmir']);
  });

  it('removes a journal stage after rename failure and leaves the old journal intact', async () => {
    const target = path.join(dir, 'draft.cmir-journal');
    await fs.writeFile(target, 'previous');
    vi.spyOn(fs, 'rename').mockRejectedValue(ioError('EIO'));
    await expect(replaceDurably(target, Buffer.from('next'))).rejects.toThrow('injected EIO');
    expect(await fs.readFile(target, 'utf8')).toBe('previous');
    expect(await fs.readdir(dir)).toEqual(['draft.cmir-journal']);
  });

  it('closes and removes a partially written journal stage without replacing the prior journal', async () => {
    const target = path.join(dir, 'draft.cmir-journal');
    await fs.writeFile(target, 'previous');
    const realOpen = fs.open;
    let closed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await realOpen(file, flags, mode);
      const write = handle.writeFile.bind(handle);
      vi.spyOn(handle, 'writeFile').mockImplementation(async () => {
        await write(Buffer.from('partial'));
        throw ioError('ENOSPC');
      });
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => { closed = true; return close(); });
      return handle;
    });
    await expect(replaceDurably(target, Buffer.from('complete'))).rejects.toThrow('injected ENOSPC');
    expect(closed).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe('previous');
    expect(await fs.readdir(dir)).toEqual(['draft.cmir-journal']);
  });

  it.skipIf(process.platform === 'win32')('surfaces a directory flush failure after publication instead of reporting success', async () => {
    const target = path.join(dir, 'draft.cmir-journal');
    const events: string[] = [];
    observeHandles(events, (file) => file === dir ? 'EIO' : undefined);
    await expect(replaceDurably(target, Buffer.from('next'))).rejects.toThrow('injected EIO');
    expect(events.at(-1)).toBe('directory:close');
    expect(await fs.readFile(target, 'utf8')).toBe('next');
    expect(await fs.readdir(dir)).toEqual(['draft.cmir-journal']);
  });

  it.skipIf(process.platform === 'win32')('tolerates unsupported directory fsync, closes the directory, and still saves', async () => {
    const events: string[] = [];
    observeHandles(events, (file) => file === dir ? 'EINVAL' : undefined);
    await expect(replaceDurably(path.join(dir, 'doc.cmir'), Buffer.from('next'))).resolves.toBeUndefined();
    expect(events.slice(-2)).toEqual(['directory:sync', 'directory:close']);
  });

  it('syncs every new parent entry when creating nested destination folders', async () => {
    const opened: string[] = [];
    const realOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      opened.push(String(file));
      return realOpen(file, flags, mode);
    });
    await makeDurableDirectory(path.join(dir, 'new', 'deeper'));
    expect(opened).toEqual([path.join(dir, 'new'), dir]);
    opened.length = 0;
    await makeDurableDirectory(path.join(dir, 'new', 'deeper'));
    expect(opened).toEqual([]);
  });

  it('finishes the real parent sync when mkdir returns an equivalent normalized path', async () => {
    const realMkdir = fs.mkdir;
    vi.spyOn(fs, 'mkdir').mockImplementation((async (file, options) => {
      const first = await realMkdir(file, options as { recursive: true });
      if (!first) return first;
      return process.platform === 'win32'
        ? first.replace(/\\/g, '/').replace(/^[a-z]:/i, (drive) => drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase())
        : `${first}/.`;
    }) as typeof fs.mkdir);
    const opened: string[] = [];
    const realOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      opened.push(String(file));
      return realOpen(file, flags, mode);
    });
    await makeDurableDirectory(path.join(dir, 'new', 'deeper'));
    expect(opened).toEqual([path.join(dir, 'new'), dir]);
  });

  it('uses Windows path identity for drive casing and mixed separators on every test host', () => {
    expect(directoryParentsToSync('c:/Users/runner/work/new/deeper', 'C:\\Users\\runner\\work\\NEW\\.', path.win32)).toEqual([
      'c:\\Users\\runner\\work\\new',
      'c:\\Users\\runner\\work',
    ]);
  });

  it('stops at the root with an error when the created directory is not an ancestor', () => {
    expect(() => directoryParentsToSync('/work/new/deeper', '/elsewhere', path.posix)).toThrow(/not an ancestor/);
    expect(() => directoryParentsToSync('C:\\work\\new', 'D:\\work', path.win32)).toThrow(/not an ancestor/);
    expect(directoryParentsToSync('C:\\new', 'c:\\new\\', path.win32)).toEqual(['C:\\']);
  });

  it('does not silently ignore ordinary directory I/O errors', async () => {
    vi.spyOn(fs, 'open').mockRejectedValue(ioError('EIO'));
    await expect(syncDirectory(dir)).rejects.toThrow('injected EIO');
  });

  it('syncs the recovery stage directory before fallback and the target before removing its recovery copy', async () => {
    const target = path.join(dir, 'doc.cmir');
    const events: string[] = [];
    observeHandles(events);
    vi.spyOn(fs, 'rename').mockRejectedValue(ioError('EPERM'));
    const unlink = fs.unlink;
    vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
      events.push('unlink');
      return unlink(file);
    });
    await saveNewDoc(target, Buffer.from('next'));
    const targetOpen = events.indexOf('target:open:w');
    if (process.platform !== 'win32') expect(events.indexOf('directory:sync')).toBeLessThan(targetOpen);
    expect(events.indexOf('target:sync')).toBeGreaterThan(targetOpen);
    expect(events.indexOf('target:close')).toBeLessThan(events.indexOf('unlink'));
    if (process.platform !== 'win32') expect(events.lastIndexOf('directory:sync')).toBeGreaterThan(events.indexOf('unlink'));
    expect(await fs.readFile(target, 'utf8')).toBe('next');
    expect(await fs.readdir(dir)).toEqual(['doc.cmir']);
  });

  it('keeps the synced recovery copy and rejects when an in-place fallback cannot sync', async () => {
    const target = path.join(dir, 'doc.cmir');
    const events: string[] = [];
    observeHandles(events, (file) => file === target ? 'EIO' : undefined);
    vi.spyOn(fs, 'rename').mockRejectedValue(ioError('EPERM'));
    await expect(saveNewDoc(target, Buffer.from('next'))).rejects.toThrow('injected EIO');
    expect(events.at(-1)).toBe('target:close');
    const recovery = (await fs.readdir(dir)).filter((file) => file.endsWith('.cmtmp'));
    expect(recovery).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, recovery[0]!), 'utf8')).toBe('next');
  });
});
