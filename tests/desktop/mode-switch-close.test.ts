// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModeSwitchCloseCoordinator, type ModeSwitchParticipant } from '../../apps/desktop/src/mode-switch-close.js';
import { createModeSwitchJournalHandler } from '../../src/editor/mode-switch.js';

function participant(id: number, autoClose = true) {
  const events = new EventEmitter();
  const window: ModeSwitchParticipant = {
    id,
    requestJournal: vi.fn<(roundId: number) => void>(),
    cancelJournal: vi.fn<(roundId: number) => void>(),
    close: vi.fn(() => { if (autoClose) events.emit('closed'); }),
    onClosed: (handler) => {
      events.once('closed', handler);
      return () => { events.removeListener('closed', handler); };
    },
  };
  return { window, events, round: () => vi.mocked(window.requestJournal).mock.calls.at(-1)![0] };
}

describe('desktop mode-switch preservation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for every journal acknowledgment and close, including windows with no documents', async () => {
    const coordinator = new ModeSwitchCloseCoordinator(100);
    const first = participant(1);
    const second = participant(2);
    const result = coordinator.closeOthers([first.window, second.window]);
    expect(first.window.close).not.toHaveBeenCalled();
    expect(second.window.close).not.toHaveBeenCalled();
    const docs = [{ uid: 'draft', dirty: true }];
    expect(coordinator.report(1, first.round(), docs)).toBe(true);
    expect(first.window.close).toHaveBeenCalledOnce();
    expect(second.window.close).not.toHaveBeenCalled();
    expect(() => coordinator.takeJournaledDocs()).toThrow('still in progress');
    expect(coordinator.report(2, second.round(), [])).toBe(true);
    await result;
    expect(second.window.close).toHaveBeenCalledOnce();
    expect(coordinator.takeJournaledDocs()).toEqual(docs);
    expect(coordinator.takeJournaledDocs()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects on timeout without closing a window and ignores its late report', async () => {
    const coordinator = new ModeSwitchCloseCoordinator(100);
    const target = participant(1);
    const result = expect(coordinator.closeOthers([target.window])).rejects.toThrow('did not finish');
    const round = target.round();
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(target.window.close).not.toHaveBeenCalled();
    expect(target.events.listenerCount('closed')).toBe(0);
    expect(target.window.cancelJournal).toHaveBeenCalledExactlyOnceWith(round);
    expect(coordinator.report(1, round, [{ uid: 'late', dirty: true }])).toBe(false);
    expect(target.window.close).not.toHaveBeenCalled();
    expect(coordinator.takeJournaledDocs()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, [{ uid: 'draft', dirty: 'yes' }], [{ uid: '', dirty: true }]])(
    'aborts on a failed or malformed preservation report: %j', async (docs) => {
      const coordinator = new ModeSwitchCloseCoordinator(100);
      const target = participant(1);
      const result = expect(coordinator.closeOthers([target.window])).rejects.toThrow('could not preserve');
      expect(coordinator.report(1, target.round(), docs)).toBe(false);
      await result;
      expect(target.window.close).not.toHaveBeenCalled();
      expect(target.events.listenerCount('closed')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('rejects overlapping attempts instead of telling another initiator it succeeded', async () => {
    const coordinator = new ModeSwitchCloseCoordinator(100);
    const first = participant(1);
    const second = participant(2);
    const result = coordinator.closeOthers([first.window]);
    await expect(coordinator.closeOthers([second.window])).rejects.toThrow('already in progress');
    expect(second.window.requestJournal).not.toHaveBeenCalled();
    expect(second.window.close).not.toHaveBeenCalled();
    coordinator.report(1, first.round(), []);
    await result;
  });

  it('rejects reports from an unrelated window or a different round', async () => {
    const coordinator = new ModeSwitchCloseCoordinator(100);
    const target = participant(1);
    const result = coordinator.closeOthers([target.window]);
    expect(coordinator.report(999, target.round(), [])).toBe(false);
    expect(coordinator.report(1, target.round() + 1, [])).toBe(false);
    expect(target.window.close).not.toHaveBeenCalled();
    coordinator.report(1, target.round(), []);
    await result;
  });

  it('retains already preserved documents across an aborted round and retry', async () => {
    const coordinator = new ModeSwitchCloseCoordinator(100);
    const first = participant(1);
    const slow = participant(2);
    const result = expect(coordinator.closeOthers([first.window, slow.window])).rejects.toThrow('did not finish');
    const oldRound = slow.round();
    coordinator.report(1, first.round(), [{ uid: 'already-closed', dirty: true }]);
    await vi.advanceTimersByTimeAsync(100);
    await result;
    const retry = coordinator.closeOthers([slow.window]);
    expect(slow.round()).not.toBe(oldRound);
    expect(coordinator.report(2, oldRound, [{ uid: 'stale', dirty: true }])).toBe(false);
    expect(slow.window.close).not.toHaveBeenCalled();
    coordinator.report(2, slow.round(), [{ uid: 'current', dirty: false }]);
    await retry;
    expect(coordinator.takeJournaledDocs()).toEqual([
      { uid: 'already-closed', dirty: true }, { uid: 'current', dirty: false },
    ]);
  });

  it('cleans up a failed IPC send and permits a later attempt', async () => {
    const coordinator = new ModeSwitchCloseCoordinator(100);
    const target = participant(1);
    vi.mocked(target.window.requestJournal).mockImplementationOnce(() => { throw new Error('renderer gone'); });
    await expect(coordinator.closeOthers([target.window])).rejects.toThrow('renderer gone');
    expect(target.events.listenerCount('closed')).toBe(0);
    expect(target.window.close).not.toHaveBeenCalled();
    const retry = coordinator.closeOthers([target.window]);
    coordinator.report(1, target.round(), []);
    await retry;
  });

  it('does not discard the report when closing a preserved window throws', async () => {
    const coordinator = new ModeSwitchCloseCoordinator(100);
    const target = participant(1);
    vi.mocked(target.window.close).mockImplementation(() => { throw new Error('cannot close'); });
    const result = expect(coordinator.closeOthers([target.window])).rejects.toThrow('cannot close');
    expect(coordinator.report(1, target.round(), [{ uid: 'safe', dirty: true }])).toBe(false);
    await result;
    expect(coordinator.takeJournaledDocs()).toEqual([{ uid: 'safe', dirty: true }]);
    expect(target.events.listenerCount('closed')).toBe(0);
  });

  it('does not force a preserved window closed if its normal close is delayed', async () => {
    const coordinator = new ModeSwitchCloseCoordinator(100);
    const target = participant(1, false);
    const result = expect(coordinator.closeOthers([target.window])).rejects.toThrow('did not finish');
    expect(coordinator.report(1, target.round(), [])).toBe(true);
    expect(coordinator.report(1, target.round(), [])).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(target.window.close).toHaveBeenCalledOnce();
    expect(target.events.listenerCount('closed')).toBe(0);
  });

  it('aborts if a participant disappears before acknowledgment', async () => {
    const coordinator = new ModeSwitchCloseCoordinator(100);
    const target = participant(1);
    const other = participant(2);
    const result = expect(coordinator.closeOthers([target.window, other.window])).rejects.toThrow('before confirming');
    target.events.emit('closed');
    await result;
    expect(other.window.close).not.toHaveBeenCalled();
    expect(other.events.listenerCount('closed')).toBe(0);
    expect(coordinator.report(2, other.round(), [])).toBe(false);
  });

  it('keeps a late renderer completion from authorizing a newer round', async () => {
    const coordinator = new ModeSwitchCloseCoordinator(100);
    const target = participant(1);
    let finishFirst!: (docs: Array<{ uid: string; dirty: boolean }>) => void;
    const journal = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce([{ uid: 'current', dirty: true }]);
    const report = vi.fn((docs, roundId) => Promise.resolve(coordinator.report(1, roundId, docs)));
    const handle = createModeSwitchJournalHandler({ journal, report, onError: vi.fn() });
    const first = expect(coordinator.closeOthers([target.window])).rejects.toThrow('did not finish');
    const firstWork = handle(target.round());
    await vi.advanceTimersByTimeAsync(100);
    await first;
    const retry = coordinator.closeOthers([target.window]);
    const secondWork = handle(target.round());
    expect(journal).toHaveBeenCalledOnce();
    finishFirst([{ uid: 'outdated', dirty: true }]);
    await Promise.all([firstWork, secondWork, retry]);
    await expect(report.mock.results[0]!.value).resolves.toBe(false);
    expect(target.window.close).toHaveBeenCalledOnce();
    expect(coordinator.takeJournaledDocs()).toEqual([{ uid: 'current', dirty: true }]);
  });
});
