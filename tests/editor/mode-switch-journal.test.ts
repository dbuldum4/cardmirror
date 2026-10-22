import { describe, expect, it, vi } from 'vitest';
import { createModeSwitchJournalHandler } from '../../src/editor/mode-switch.js';

describe('mode-switch renderer preservation', () => {
  it('reports a successful empty window so main can close it safely', async () => {
    const report = vi.fn().mockResolvedValue(true);
    const onError = vi.fn();
    const handle = createModeSwitchJournalHandler({ journal: async () => [], report, onError });
    await handle(4);
    expect(report).toHaveBeenCalledExactlyOnceWith([], 4);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports journal failure to abort the initiating switch and can service a retry', async () => {
    const error = new Error('disk full');
    const journal = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce([{ uid: 'saved', dirty: true }]);
    const report = vi.fn().mockResolvedValue(true);
    const onError = vi.fn();
    const handle = createModeSwitchJournalHandler({ journal, report, onError });
    await handle(1);
    expect(report).toHaveBeenCalledExactlyOnceWith(null, 1);
    expect(onError).toHaveBeenCalledWith(error);
    await handle(2);
    expect(report).toHaveBeenLastCalledWith([{ uid: 'saved', dirty: true }], 2);
  });

  it('keeps expired acknowledgments harmless without treating them as permission to close', async () => {
    const report = vi.fn().mockResolvedValue(false);
    const onError = vi.fn();
    await createModeSwitchJournalHandler({ journal: async () => [], report, onError })(5);
    expect(report).toHaveBeenCalledExactlyOnceWith([], 5);
    expect(onError).not.toHaveBeenCalled();
  });

  it('records transport failures and keeps its request queue usable', async () => {
    const error = new Error('IPC unavailable');
    const report = vi.fn().mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockResolvedValueOnce(true);
    const onError = vi.fn();
    const handle = createModeSwitchJournalHandler({ journal: async () => [], report, onError });
    await handle(1);
    expect(onError).toHaveBeenCalledTimes(2);
    await handle(2);
    expect(report).toHaveBeenLastCalledWith([], 2);
  });

  it('aborts instead of closing over edits made while the snapshot was written', async () => {
    const report = vi.fn().mockResolvedValue(false);
    const unlock = vi.fn();
    const onError = vi.fn();
    await createModeSwitchJournalHandler({
      journal: async () => [{ uid: 'snapshot', dirty: true }],
      report, onError, lock: () => unlock, captureUnchanged: () => () => false,
    })(3);
    expect(report).toHaveBeenCalledExactlyOnceWith(null, 3);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Documents changed') }));
    expect(unlock).toHaveBeenCalledOnce();
  });

  it.each([true, false])('holds the editing lock until main responds with %s, then restores editing', async (accepted) => {
    let respond!: (accepted: boolean) => void;
    const unlock = vi.fn();
    const report = vi.fn(() => new Promise<boolean>((resolve) => { respond = resolve; }));
    const handle = createModeSwitchJournalHandler({
      journal: async () => [], report, onError: vi.fn(), lock: () => unlock,
    });
    const work = handle(1);
    await vi.waitFor(() => expect(report).toHaveBeenCalled());
    expect(unlock).not.toHaveBeenCalled();
    respond(accepted);
    await work;
    expect(unlock).toHaveBeenCalledOnce();
  });

  it('releases a timed-out window immediately and ignores its later journal completion', async () => {
    let finish!: (docs: []) => void;
    const unlock = vi.fn();
    const report = vi.fn().mockResolvedValue(true);
    const handle = createModeSwitchJournalHandler({
      journal: () => new Promise<[]>((resolve) => { finish = resolve; }),
      report, onError: vi.fn(), lock: () => unlock,
    });
    const work = handle(1);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    handle.cancel(1);
    expect(unlock).toHaveBeenCalledOnce();
    finish([]);
    await work;
    expect(report).not.toHaveBeenCalled();
    expect(unlock).toHaveBeenCalledOnce();
  });

  it('does not start queued preservation after that round has already been cancelled', async () => {
    const journal = vi.fn().mockResolvedValue([]);
    const lock = vi.fn(() => vi.fn());
    const handle = createModeSwitchJournalHandler({ journal, report: vi.fn(), onError: vi.fn(), lock });
    const work = handle(2);
    handle.cancel(2);
    await work;
    expect(journal).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
  });
});
