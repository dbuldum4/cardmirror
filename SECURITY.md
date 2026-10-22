# Security policy for CardMirror Advanced

This policy applies to this fork. Report concerns to its maintainer through
this fork's GitHub security reporting facilities when available. Avoid posting
private documents, credentials, or exploit details in public issues. Do not
send fork-specific findings to the original repository.

## Security boundaries

Treat documents, pasted HTML, imported Word XML, hyperlinks, ZIP/gzip input,
relay traffic, and plugin manifests as untrusted. Preserve source text when
blocking unsafe link actions. Do not execute document content as code or load
an arbitrary local/remote page with the privileged Electron preload.

Main-process file access must stay within user-authorized files/folders after
canonical path resolution. New document writes must not escape via symlinked
ancestors or pre-positioned staging symlinks. Document writes preserve existing
conflict detection, recovery copies, and atomic replacement where supported.

Bound compressed input, actual decompressed output, archive entry count, XML
nesting, encryption metadata, and relay request bodies before expensive work.
Never rely on a declared Content-Length, ZIP size, or gzip trailer alone.

## Trust model and limitations

Third-party plugins are full-trust application code. The renderer's settings
and explicit grants are not an isolation boundary against a deliberately
malicious installed plugin. Filesystem authorization reduces accidental or quiet
out-of-scope access; it is not a sandbox against another local process running
as the same operating-system user, including a process racing directory changes.

Collaboration uses the existing encrypted protocol. The self-hosted relay uses
a shared bearer and routing codes; deployments must protect that token and
configure appropriate transport security and operational limits. No hosted relay
is provided by this fork.

## Known embedded runtime exposure

The pinned Electron 45.0.0 embeds Node 24.22.0. Direct probes reproduce the
non-canonical IP hostname-check bypasses in its Node TLS API. That demonstrates
an affected embedded API, not an end-to-end exploit of CardMirror. The full
Node security update is available in 24.22.1 (or 22.23.4 / 26.12.1).

Correction to the original assessment: the Node version alone does not establish
Brotli CVE-2026-111497 exposure. Electron's
[Node build patch](https://github.com/electron/electron/blob/v45.0.0/patches/node/build_add_gn_build_files.patch)
links Chromium's Brotli, and
[Chromium 156's decoder](https://github.com/chromium/chromium/blob/156.0.8078.48/third_party/brotli/dec/decode.c)
already contains that fix. A Brotli round-trip remains only a smoke test.

As an interim mitigation, all application-owned desktop HTTP clients use
Chromium through `desktop-fetch.ts`, including relay/SSE, plugin and voice
downloads, and local Flow integration. The updater already uses Chromium.
Sessions are isolated in memory per source origin, omit cookies and caching,
strip authentication headers on cross-origin redirects, and accept only
HTTP(S) input. There is no fallback to Node fetch. Chromium uses system proxy
settings and OS certificate trust; custom relays need an appropriately trusted
certificate. Renderer sandboxing and disabled Node integration remain enabled.
This does not patch Node itself or sandbox full-trust plugins/native engines.

`check-electron-runtime.cjs` reports the actual Electron/Node/Chromium versions.
With `--require-patched-node` it requires the complete Node security update.
Release commands and release CI require that strict check before publishing.
Development CI reports the limitation while testing application changes.
The separate Windows preview workflow produces a portable test artifact without
creating a release or weakening that release gate.

## Validation

Run typechecking, focused adversarial and legitimate-input regressions, the full
CI test scope, renderer/desktop builds, both npm audits, and relay tests. CI runs
real filesystem tests on Linux, macOS, and Windows. CI also runs real PostgreSQL 15 and 18 concurrency/HTTP regressions in isolated
schemas; controlled tests verify locking, deletion, cleanup and storage limits.
Local Linux checks cannot establish platform-specific behavior on macOS or
Windows. Private Word fixtures, production load/deployment behavior, provider
services, and third-party plugins require their own validation.

A finite review and test suite cannot establish that all bugs or vulnerabilities
are absent. Keep the known limitations visible and add regression tests for
confirmed findings.
