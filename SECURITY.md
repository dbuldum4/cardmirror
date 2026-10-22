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

The pinned Electron 45.0.0 was probed and embeds Node 24.22.0. It does not yet
include the October 2026 Node security fixes available in Node 24.22.1 (or
22.23.4 / 26.12.1), including Brotli CVE-2026-111497 and TLS hostname-check fixes.
A passing npm audit or Brotli smoke test does not demonstrate remediation.

`check-electron-runtime.cjs` reports the actual Electron/Node/Chromium versions.
With `--require-patched-node` it fails on an exposed embedded Node version.
Release commands and release CI require that strict check before publishing.
Development CI reports the limitation while testing application changes.

## Validation

Run typechecking, focused adversarial and legitimate-input regressions, the full
CI test scope, renderer/desktop builds, both npm audits, and relay tests. CI runs
real filesystem tests on Linux, macOS, and Windows. Local Linux checks cannot
establish platform-specific behavior on macOS or Windows. Private Word fixtures,
live PostgreSQL deployment behavior, provider services, and third-party plugins
require their own validation.

A finite review and test suite cannot establish that all bugs or vulnerabilities
are absent. Keep the known limitations visible and add regression tests for
confirmed findings.
