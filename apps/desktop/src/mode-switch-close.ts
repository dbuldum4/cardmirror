/** Journal acknowledgments authorize closes only within their live switch round. */
export interface ModeSwitchJournalDoc {
  uid: string;
  dirty: boolean;
}

export interface ModeSwitchParticipant {
  id: number;
  requestJournal(roundId: number): void;
  cancelJournal?(roundId: number): void;
  close(): void;
  onClosed(handler: () => void): () => void;
}

interface PendingParticipant {
  window: ModeSwitchParticipant;
  journaled: boolean;
  unsubscribe: () => void;
}

interface CloseRound {
  id: number;
  pending: Map<number, PendingParticipant>;
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class ModeSwitchCloseCoordinator {
  private nextRound = 0;
  private active: CloseRound | null = null;
  // Keep successful reports across aborted rounds: some preserved windows may
  // already have closed, and the next successful switch must still reopen them.
  private journaledDocs: ModeSwitchJournalDoc[] = [];

  constructor(private readonly timeoutMs: number) {}

  async closeOthers(windows: ModeSwitchParticipant[]): Promise<void> {
    if (this.active) throw new Error('Another workspace mode switch is already in progress');
    if (windows.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const round: CloseRound = {
        id: ++this.nextRound,
        pending: new Map(windows.map((window) => [window.id, {
          window, journaled: false, unsubscribe: () => {},
        }])),
        resolve,
        reject,
        timer: setTimeout(() => {
          this.abort(round, new Error('Another window did not finish preserving its documents. No unpreserved window was closed.'));
        }, this.timeoutMs),
      };
      this.active = round;
      try {
        for (const participant of round.pending.values()) {
          participant.unsubscribe = participant.window.onClosed(() => {
            if (this.active !== round) return;
            if (!participant.journaled) {
              this.abort(round, new Error('A window closed before confirming its recovery copy'));
              return;
            }
            participant.unsubscribe();
            round.pending.delete(participant.window.id);
            if (round.pending.size === 0) {
              this.finish(round);
              resolve();
            }
          });
        }
        for (const window of windows) {
          if (this.active !== round) break;
          window.requestJournal(round.id);
        }
      } catch (error) {
        this.abort(round, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  report(windowId: number, roundId: number, docs: unknown): boolean {
    const round = this.active;
    const participant = round?.pending.get(windowId);
    if (!round || round.id !== roundId || !participant || participant.journaled) return false;
    if (!Array.isArray(docs) || !docs.every((doc): doc is ModeSwitchJournalDoc =>
      doc !== null && typeof doc === 'object' &&
      typeof doc.uid === 'string' && doc.uid.length > 0 && typeof doc.dirty === 'boolean',
    )) {
      this.abort(round, new Error('Another window could not preserve its documents'));
      return false;
    }
    participant.journaled = true;
    this.journaledDocs.push(...docs);
    try {
      // Closing here makes acceptance and close one main-process operation.
      // A late renderer reply never gets permission to call generic closeSelf.
      participant.window.close();
      return true;
    } catch (error) {
      this.abort(round, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  takeJournaledDocs(): ModeSwitchJournalDoc[] {
    if (this.active) throw new Error('Workspace mode switch is still in progress');
    const docs = this.journaledDocs;
    this.journaledDocs = [];
    return docs;
  }

  private finish(round: CloseRound): void {
    clearTimeout(round.timer);
    for (const participant of round.pending.values()) participant.unsubscribe();
    if (this.active === round) this.active = null;
  }

  private abort(round: CloseRound, error: Error): void {
    if (this.active !== round) return;
    this.finish(round);
    for (const participant of round.pending.values()) {
      try {
        participant.window.cancelJournal?.(round.id);
      } catch {
        // A dead renderer cannot be notified; it is still never force-closed.
      }
    }
    round.reject(error);
  }
}
