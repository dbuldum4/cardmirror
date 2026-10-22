# CardMirror Advanced 2.0: changes and validation

This is an independently maintained, noncommercial fork. The editor layout,
shortcuts, and normal editing workflow remain familiar.

## Upstream and license

Merged original `main` through `fcc40ffe088ec7676077640bc8858706d1cb8c11`
(35 commits beyond the fork's original base), preserving both existing
fork-specific security commits. No original-repository branch, issue, pull
request, release, or setting was modified.

The original PolyForm Noncommercial 1.0.0 license and Required Notice are
byte-identical to that upstream revision. SHA-256:
`aaf45e40edf584a34523cee426ab4341649dd0541de9b219afe89c5fa9238d7f`.
The license permits modifications/distribution for its permitted noncommercial
purposes, requires its terms/notices to accompany copies, and does not authorize
general commercial use or relicensing the original software. Third-party
notices are retained; the new private formatting patch carries its original
BSD-3-Clause license. The downloadable standalone reader now embeds the license
and notices too.

## Confirmed defects patched

| Boundary | Change | Validation |
| --- | --- | --- |
| Document hyperlinks | Reject browser-normalized script/control-character schemes at rendering, footnote, and Open Link sinks; retain source text | Mark serialization, actual footnote popover, direct link-action tests |
| Electron navigation | Trust exact packaged editor/timer files, block other local HTML, guard redirects and webviews | Exact-file, query/fragment, encoded traversal, remote-host file URL regressions |
| File authorization | Compare canonical targets only; resolve existing ancestors for new paths; pin explicit symlink grants; close legacy import gate immediately | Escaping links, valid aliases/roots, missing descendants, retargeted grants, one-shot grant tests |
| Atomic document saves | Unique, exclusively created temporary files, private default permissions | Real-filesystem pre-planted staging-symlink test plus existing save/conflict/lock tests |
| ZIP/gzip | Bound actual expansion and entry count; require complete central directories, matching lengths, CRCs; reject duplicate/traversal parts | Forged sizes, every truncated ZIP prefix, corruption, concatenated native gzip, valid round trips |
| XML | Reject DTD/custom entity declarations and excessive nesting while retaining ordinary entities, comments, and CDATA | Malicious declarations, deep XML, thousands of standard/numeric references |
| Encrypted Word input | Validate CFB geometry/chains and bounded allocation, strict AES-CBC/SHA-512 metadata and KDF limits; support extended DIFAT | Real encrypted Word fixture, malformed sector shift, cyclic chain, invalid KDF metadata |
| Save compression | Reject failed fallback compression instead of leaving saves pending; terminate timed-out workers; ignore late callbacks | Timeout/failure/latch/late-callback regressions |
| Relay request bodies | Bound actual receipt per endpoint and aggregate gzip expansion; validate integrity/completion | Unit and ASGI HTTP tests, chunk-overflow termination, gzip truncation/corruption |
| Relay input/accounting | Strict Content-Encoding, bounded printable routing IDs, serialize room append capacity accounting | HTTP authentication/encoding/routing tests; row-lock source inspection |
| Plugin downloads | Bound actual response bytes and stalled bodies; honor empty allowlists as revocation | Byte-boundary, forged length, stalled stream and directory regressions |
| Desktop clipboard | Adapt atomic rich-text/plain-text copying and reading to Electron 45's asynchronous API | Clipboard snapshot, text-only, write failure, and race tests |

## Features and maintenance

- **Check Document** in the existing command palette: read-only checks for empty
  tags, missing citations, empty cards, repeated evidence, duplicate heading IDs,
  and blocked links, with click-to-jump results in an existing-style dialog.
- `npm run check:document -- file.cmir|file.docx [--json] [--fail-on-warning]`.
  Structured local reports and useful exit codes, without modifying the input.
- Updated XML parser, Vite, Vitest, Electron and dependency lockfiles; removed
  patch-package in favor of a small reproducible collaboration patch script.
- The patch installer normalizes Windows CRLF checkouts before exact matching
  against npm's LF files. Regression tests cover both line endings, Git's
  Windows checkout setting, repeat installation, and rejection of changed
  dependency contents/versions; CI runs them on Linux, macOS, and Windows.
- Fixed numeric XML reference decoding and retained original/fork window-title
  compatibility for collaboration and window switching.
- Fork-specific package names, application identity, executable, profile, update
  targets, and bridge records. Windows Open-With registration is distinct and
  uninstall does not remove another application's newer template registration.
- No default upstream production relay, inherited redirect deployment, or
  upstream release publishing. The inherited AUR recipe is clearly archived.
- CI checks fork identity/license, dependency audits, Python relay tests, builds,
  and the existing Linux/macOS/Windows test matrix.
- Migration and security documentation explicitly describe compatibility limits.

## Validation and practical limits

Validation was performed on Linux using Node 24.22.1 after clean root and desktop
`npm ci` installs. Both npm dependency audits and the Python environment audit
report no known advisories. Clean-install patch application and repeat invocation
were checked. The renderer, desktop main/services, standalone reader, Lite build,
and unpacked Linux desktop package build successfully. Lite's CSP/no-egress
verifier passes. The packaged Electron executable was probed directly.

The full CI-scope JavaScript run passed **4,107 tests in 415 files**, with
38 tests skipped across 10 fixture/optional suites. A later focused plugin
response-boundary run passed all 30 tests. CLI end-to-end checks exercised both
file formats and unchanged input hashes; CLI entry points are included in
typechecking. Three large collaboration fuzz suites are excluded by the
existing CI memory policy. Fixture-dependent suites skip when private Word
fixtures are absent. There was no real macOS/Windows installer test, GUI launch,
live PostgreSQL load test, hosted-service deployment, or arbitrary third-party
plugin validation. Finite tests do not establish that all defects are absent.

**Interim desktop mitigation:** Electron 45.0.0 embeds Node 24.22.0, whose direct
TLS hostname API still reproduces the October bypass examples. Application-owned
HTTP now uses isolated Chromium networking instead, preserving streaming,
downloads, cancellation, explicit authentication, and local integrations.
Cross-origin redirects strip credentials. The updater already uses Chromium.
The real Electron integration probe poisons Node fetch to catch fallbacks and
checks cookies, cache/ETags, redirects, gzip/Brotli, streams, aborts, and invalid
certificates. A Windows workflow supplies a portable preview artifact.

The earlier Brotli exposure claim based only on Node's version was too broad:
Electron links Chromium's already-fixed Brotli library. The complete embedded
Node update is still pending, and strict release checks still block publishing
until a patched Electron release is pinned. No installer release was published.

**Repository rename:** Application/package/release configuration is named
`cardmirror-advanced`. Renaming the GitHub repository slug requires repository
settings/API access; it is a separate operation from committing the source.
