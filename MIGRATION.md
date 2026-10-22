# Migrating to CardMirror Advanced 2.0

The interface and editing workflow remain familiar. This is an independent fork,
with several deliberate compatibility and security changes.

## Documents and profiles

Existing `.cmir` and `.docx` documents still open, and new documents retain the
same format identifiers and extensions. Keep backups before moving a working
installation. Opening a file does not move or overwrite it.

The application is named **CardMirror Advanced**, its Linux executable is
`cardmirror-advanced`, and its application ID is
`io.github.dbuldum4.cardmirror-advanced`. It uses its own user-data directory so
it can coexist with the original application. Existing preferences, journals,
keys, installed plugins, and learned annotations are not silently copied.
Open your existing documents explicitly. Keep the old profile until you have
verified your documents and any unsaved recovery journals.

Cross-application bridge records use `cardmirror-advanced.json` and
`cardmirror-advanced.session.json` in the existing shared discovery directory.
They do not replace the original application's records. Clients that hardcode
the original application ID need to select the Advanced ID.

Builds and updates point to `dbuldum4/cardmirror-advanced`. The original
maintainer's installers are not installers for this fork. The repository itself
must also be renamed in GitHub Settings for the new release URL to work.

## Sharing

Configure a custom relay URL and token before enabling collaboration. This fork
does not automatically connect to the upstream production relay. Set the URL
and token first, then enable the master toggle. The existing relay protocol and
header names are retained for interoperability.

## Safer input handling

Unsafe links display their text without an actionable address. The document
checker can help find them. Reading or writing through a symlink that escapes
an authorized folder is refused; explicitly open or pick the real target if
that file is intended to be in scope.

Oversized or damaged files now fail with a descriptive error:

- Compressed input: 128 MiB.
- Expanded document total: 256 MiB; individual ZIP parts: 128 MiB.
- ZIP entries: 10,000; XML nesting: 256 levels.
- XML DTDs and custom entity declarations are refused.
- Gzip native documents must contain one member with a valid checksum.
- Office encryption metadata must use supported AES-CBC/SHA-512 parameters and
  no more than 1,000,000 password-derivation iterations.

These limits do not change the normal document format. Split exceptionally
large evidence libraries or re-save damaged exports in Word before importing.

## Developers

Install both dependency trees with `npm ci` and `npm --prefix apps/desktop ci`.
The XML parser, Vite, Vitest, and Electron have been updated; Electron clipboard
access now uses the asynchronous API. The collaboration patch still applies to
the pinned `loro-prosemirror` 0.4.3, through a small Git-based postinstall script.
A private BSD-licensed formatting dependency patch is vendored under
`apps/desktop/vendor/sprintf-js` until an upstream fix is available.

The release gate intentionally rejects Electron's currently unpatched embedded
Node runtime. Pin a release embedding a patched Node version, update the
lockfile/build pin together, then run the runtime probe before publishing.
