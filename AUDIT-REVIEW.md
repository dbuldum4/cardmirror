# Review of the supplied 28 findings

Compared on 2026-10-22 against original `ant981228/cardmirror` main at
`fcc40ffe088ec7676077640bc8858706d1cb8c11` and this fork before these fixes at
`767b6583e6791bc1caf33d91a214ee308f61834b`. The supplied audit concerned
`e68c6e6` (1.15.0). Upstream was fetched and inspected read-only; no upstream
issues, PRs, comments or changes were created.

“Addressed” below means the reported path has a corresponding source fix;
it does not claim absence of every related bug. Original severity labels were
not independently adopted. Security findings 1–6 were triaged statically before
implementation: none required an additional fork security patch, because the
reported paths were already addressed. Item 6 remains partly open upstream;
items 3–4 have stronger defenses in the fork. Correctness review found remaining
gaps in items 9, 14, 15, 20 and 28, patched here. A subsequent live PostgreSQL
pass verified item 24 and exposed additional relay defects, also fixed here.

| # | Finding | Current original upstream | Fork after review; evidence |
| --- | --- | --- | --- |
| 1 | Clipboard paste XSS | Addressed | Already addressed: `paste-plugin.ts` parses in an inert HTML document; `paste-inert-parse.test.ts`. |
| 2 | Vulnerable ProseMirror paste parser | Addressed: lock 1.42.6 | Already addressed: lock 1.42.7, above reported fixed version 1.42.3. |
| 3 | Arbitrary-path IPC writes | Extension/folder restrictions added; symlink scope bypass remains in its lexical fallback | Already hardened: `read-scope.ts` resolves existing ancestors, pins grants and permits only authorized document/archive destinations; desktop scope regressions. Full-trust plugins remain outside the isolation guarantee. |
| 4 | Relay gzip allocation before limit | Bounded decompressor added | Already hardened: streamed request limits and strict bounded gzip decoding in `relay/body_limits.py`, tested by relay regressions. A bearer distributed to clients is not a private server credential. |
| 5 | Filename HTML injection | Addressed | Already addressed: `multi-pane-shell.ts` assigns the dialog heading with `textContent`. |
| 6 | Electron navigation and unsafe footnote URLs | Window guards added; footnote href still assigned without filtering, packaged navigation allows broad `file:` | Already hardened: safe link schemes in `footnote-popover.ts`; exact app-page, redirect and window-open guards in desktop main/navigation helper. |
| 7 | Save As commits identity to newly focused pane | Addressed | Already addressed: `commitSaveResultFor(sessionUid, …)` captures the originating document before awaits. |
| 8 | Journal content/identity mismatch on document switch | Addressed | Already addressed: single-document `runJournalWrite` captures identity with content and drops obsolete sessions. |
| 9 | Layout switch after failed preservation; 10-second forced close | Partly addressed: own journal failure aborts, but other windows can still close after failure or timeout | Fixed remaining paths: participant journal failures and timeouts abort the switch; round-scoped reports prevent late replies closing unrelated windows. Pending windows stay open. |
| 10 | DOCX history parsed as native | Addressed | Already addressed: `version-history.ts` sniffs ZIP/DOCX in previews; opening a copy also uses format detection. |
| 11 | Recovery and bulk DOCX export omit live views | Addressed | Already addressed: shared `nativeBytesToDocx` applies export transforms and `flattenSelfRefs`; real round-trip regressions. |
| 12 | DOCX inline wrappers, breaks, symbols and images dropped | Addressed in source | Already addressed: importer handles `smartTag`, `fldSimple`, `sdtContent`, `customXml`, `w:cr`, `w:sym`, AlternateContent drawings and VML image relationships. Symbol-font fidelity and unsupported drawing types remain format limitations. |
| 13 | Desktop overwrite during locked-file retries | Addressed | Already addressed: freshness checks before retry and in-place fallback in `doc-writes.ts`; fault-injection regressions. The OS provides no atomic compare-and-replace for unrelated writers. |
| 14 | Browser saves overwrite externally changed files | Baseline check added, but skipped read failures and did not repeat after retry delay | Fixed remaining gaps: freshness failures propagate; check after permission wait and before retry. Browser window handoff and journals preserve original baseline. Metadata checks still cannot detect every same-size/same-timestamp change, protect older handles without a recorded baseline, or make browser writes atomic. |
| 15 | Cross-tab Quick Cards lost updates | Web Lock added, unsafe fallback when unavailable | Fixed: mutations use one IndexedDB read/write transaction instead of separate reads and writes; cache updates follow commit. No Web Locks dependency. |
| 16 | Browser object handles excluded from pane autosave | Addressed | Already addressed: `runAutosaveForRecord` accepts any non-null handle. |
| 17 | PWA window handoff drops handles | Addressed | Already addressed: object handles cross IndexedDB structured clone and mount directly. Review additionally preserves freshness baseline; `web-spawn-baseline.test.ts`. Real installed-PWA window capture and permission behavior remain browser-dependent. |
| 18 | No browser unload warning or journal flush | Addressed | Already addressed: dirty `beforeunload` warning, visibility/pagehide journal flush. Browser shutdown does not guarantee async work completes. |
| 19 | Recovery bakes unread marker red | Addressed | Already addressed: shared native-to-DOCX helper applies working-copy policy; round-trip regression with marker setting enabled. |
| 20 | Saves and journals have no fsync | Open | Fixed: sync staged file before publication, sync destination directory where supported, sync in-place fallback, durable journal replacement and new directory entries. Fault tests verify ordering and failure propagation; physical power-loss durability depends on OS/filesystem/device. |
| 21 | Continuous edits postpone autosave/journal indefinitely | Addressed | Already addressed: pending-since timestamps force scheduling after 30 seconds in single/multiple panes. Event-loop stalls and slow writes can still delay completion. |
| 22 | AI body stalls after headers bypass timeout | Addressed | Already addressed: body is read under the request timer; added stalled-body regression alongside existing hung-connection test. |
| 23 | Highlight override styles leak across panes | Addressed | Already addressed: each view owns a scoped stylesheet and removes only its own on destroy. |
| 24 | Relay compaction and catch-up transaction races | Row locks added for compaction and catch-up | Verified with real PostgreSQL 15 and 18: concurrent compactions cannot roll back a newer snapshot, and catch-up snapshot/tail reads stay consistent. Fork also serializes appends/deletion/GC and fixes the related races listed below; `relay/test_postgres.py`. |
| 25 | Subscript/zoom shortcut collision | Addressed by unbinding subscript and updating manual | Already addressed: Mod-= remains Zoom In; subscript available through Format and user-configurable shortcuts. |
| 26 | Bulk conversion overwrites existing destination files | Addressed | Already addressed: all loose/ZIP output writes request `failIfExists`, collisions are reported/skipped. |
| 27 | Replace All cap silently replaces only some matches | Addressed | Already addressed: `find-replace-ui.ts` reports capped pass and remaining matches, inviting another pass. |
| 28 | Deleted Quick Cards reimported from legacy storage | Marker added, but set before asynchronous migration commit | Fixed: migration contents and marker share the same IndexedDB transaction; failed migration cannot permanently mark success or race normal mutations. |

## Validation and limits

Focused regressions cover browser retry conflicts and baseline handoff, paste
inertness, native-to-DOCX conversion, content controls, AI header/body timeouts,
Quick Cards concurrent mutations/migration, document write failures/durability,
and layout-switch failures/timeouts/late replies. Validation passed: root and desktop typechecking, renderer/service and Lite
builds, Lite boundary verification, fork/license checks, documentation links,
and workflow linting. The local CI-scope run passed 4,176 tests, with 38
platform/fixture-dependent tests skipped across 10 suites. Final focused runs also
covered later review refinements (28 mode-switch tests, 19 Quick Cards/matcher
tests, 37 browser/AI tests, and 48 disk-write tests). Windows CI exposed a
directory-parent walk that compared names literally; a follow-up normalizes
Windows path identity (including the extended paths returned by Node on the
Windows runner) and bounds the walk at the root. Regressions cover drive
casing, separators, normal/extended drive and UNC paths, equivalent mkdir
results and invalid ancestry.

Live relay validation now passes **44 tests on PostgreSQL 15 and 18** (29
existing unit/HTTP tests and 15 real-database regressions). Tests own a random
schema, use independent transactions, and verify actual blocking with
`pg_blocking_pids`, including first/existing snapshot compaction and catch-up.
Dedicated CI jobs require the database configuration instead of silently
skipping. This is controlled concurrency validation, not a production load test.

The live pass also reproduced and fixed successful uploads returning errors
when compaction deletes the row immediately after commit, mailbox sends failing
when the recipient immediately deletes a delivered message, room deletion
leaving updates behind an in-flight append, cleanup racing active rooms and
expiring tombstones early, future snapshot cursors dropping data, inconsistent
stored-byte accounting and missing snapshot-plus-tail limits, and SSE listener
reservations surviving a disconnect before response headers. Existing databases
repair old counters lazily under the room lock, without a schema migration.
These additional defects are still present in the read-only upstream revision
listed above; its locks already address the originally reported item 24.

The macOS preview workflow builds **only Apple Silicon** on every PR and push
to main. Linux, Windows and Intel Mac tests remain in ordinary CI. Preview
artifacts are ad-hoc signed, not notarized releases, and do not bypass the
strict publication gate for the embedded Node security update. See `SECURITY.md`
for the Chromium-network interim mitigation and remaining runtime limitations.
