/**
 * Mode-switch marker — the handoff record carried across the reload
 * a `multiDocWorkspace` toggle triggers.
 *
 * Before reloading, the initiating window journals every open doc
 * and writes this marker to sessionStorage. After the reload, the
 * startup-recovery flow reads it back and auto-opens EXACTLY the
 * docs listed — and only those. Journals from other sessions (crash
 * leftovers) are left in the store for the recovery sidebar on the
 * next normal launch; sweeping them into the new layout would make
 * stale docs reappear on every toggle.
 *
 * Each entry also records whether the doc had unsaved changes when
 * the switch started. Clean docs already match their on-disk files,
 * so after they reopen their mode-switch journal is deleted — the
 * journal store keeps its journals-mean-unsaved-work invariant —
 * and they reopen clean (no spurious close prompts).
 *
 * Docs open in OTHER windows (single→multi closes them) can't reach
 * the surviving window's sessionStorage; those windows report their
 * entries to the main process instead, and the surviving window
 * collects them after the reload. This module only handles the
 * marker encoding shared by both channels.
 */

export interface ModeSwitchDoc {
  uid: string;
  dirty: boolean;
}

/** Serialize preservation requests so a timed-out write cannot overwrite a
 *  newer round's recovery copy. Main accepts reports only for its live round
 *  and owns the resulting close; the renderer never closes on failure. */
export function createModeSwitchJournalHandler(deps: {
  journal(): Promise<ModeSwitchDoc[]>;
  report(docs: ModeSwitchDoc[] | null, roundId: number): Promise<boolean>;
  onError(error: unknown): void;
  lock?(): () => void;
  captureUnchanged?(): () => boolean;
}): ((roundId: number) => Promise<void>) & { cancel(roundId: number): void } {
  let pending = Promise.resolve();
  let cancelledThrough = 0;
  let active: { roundId: number; unlock?: () => void } | null = null;
  const handle = (roundId: number): Promise<void> => {
    pending = pending.then(async () => {
      if (roundId <= cancelledThrough) return;
      const request: NonNullable<typeof active> = { roundId };
      active = request;
      try {
        request.unlock = deps.lock?.();
        const unchanged = deps.captureUnchanged?.();
        const docs = await deps.journal();
        if (roundId <= cancelledThrough) return;
        if (unchanged && !unchanged()) {
          throw new Error('Documents changed while their recovery copies were being written. Try switching again.');
        }
        await deps.report(docs, roundId);
      } catch (error) {
        deps.onError(error);
        try {
          await deps.report(null, roundId);
        } catch (reportError) {
          deps.onError(reportError);
        }
      } finally {
        request.unlock?.();
        if (active === request) active = null;
      }
    });
    return pending;
  };
  return Object.assign(handle, {
    cancel(roundId: number): void {
      cancelledThrough = Math.max(cancelledThrough, roundId);
      if (active && active.roundId <= cancelledThrough) {
        active.unlock?.();
        active.unlock = undefined;
      }
    },
  });
}

export function encodeModeSwitchMarker(docs: ModeSwitchDoc[]): string {
  return JSON.stringify({ docs });
}

/** Decode a marker read back from sessionStorage. `null` input means
 *  no mode switch happened (`null` out). A malformed marker still
 *  means a switch happened — return an empty list so the caller
 *  consumes the marker without sweeping in unrelated journals. */
export function decodeModeSwitchMarker(raw: string | null): ModeSwitchDoc[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { docs?: unknown };
    if (!Array.isArray(parsed.docs)) return [];
    return parsed.docs.filter(
      (d): d is ModeSwitchDoc =>
        typeof d === 'object' &&
        d !== null &&
        typeof (d as ModeSwitchDoc).uid === 'string' &&
        typeof (d as ModeSwitchDoc).dirty === 'boolean',
    );
  } catch {
    return [];
  }
}

/** uid → was-dirty-before-the-switch, for scoping + journal cleanup. */
export function modeSwitchDirtyMap(docs: ModeSwitchDoc[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const d of docs) {
    // A uid reported dirty by ANY channel stays dirty — losing an
    // unsaved-changes flag is worse than a redundant close prompt.
    map.set(d.uid, (map.get(d.uid) ?? false) || d.dirty);
  }
  return map;
}
