# CardMirror Advanced

A noncommercial fork of [CardMirror](https://github.com/ant981228/cardmirror),
the cross-platform debate evidence editor built on ProseMirror. The familiar
editor, shortcuts, document organization, and Word-compatible `.docx` workflow
are retained. This fork adds input hardening, safer file access, dependency
updates, and evidence checks.

This project is independent of the original maintainer. Report fork issues to
[dbuldum4/cardmirror-advanced](https://github.com/dbuldum4/cardmirror-advanced/issues).
Do not send fork-specific reports or changes to the original repository.

## What changed

- Includes upstream `main` through `fcc40ffe088ec7676077640bc8858706d1cb8c11`,
  while preserving the fork's existing Electron security work.
- Blocks unsafe hyperlinks across imported, native, and collaborative documents.
- Restricts packaged navigation to the editor and timer entry files.
- Resolves symlink targets before authorizing document reads and new writes.
- Uses exclusive, unique staging files for atomic document saves.
- Bounds ZIP/gzip expansion, validates checksums and complete archives, and
  refuses XML DTDs, excessive nesting, and unsafe Office encryption metadata.
- Bounds relay uploads during receipt and fixes concurrent room capacity updates.
- Updates build/test dependencies, XML parsing, and Electron. The root and desktop
  npm dependency audits are clean at the time of this update.
- Adds **Check Document** to the existing command palette, plus a local CLI.

The UI layout and normal editing workflow are unchanged. Native `.cmir` format
identifiers, `.docx` compatibility, and collaboration protocol headers remain
compatible with CardMirror.

## Development

Use a patched Node.js release: **22.23.4+, 24.22.1+, or 26.12.1+** within those
supported release lines. `.node-version` selects Node 22.23.4. Git is required for
the reproducible collaboration dependency patch.

```sh
npm ci
npm --prefix apps/desktop ci
npm run dev
```

To run the desktop application:

```sh
npm run desktop:dev
```

To verify changes:

```sh
npm run typecheck
npm test
npm run build
npm --prefix apps/desktop run build:main
npm --prefix apps/desktop run build:service
npm run check:links
npm run check:fork
npm run audit:dependencies
# In a Python virtual environment:
python3 -m pip install -r relay/requirements-dev.txt
python3 -m unittest discover -s relay -p 'test_*.py' -v
```

The largest collaboration fuzz tests are omitted under `CI=1` to bound memory,
matching the existing CI policy. They can be run individually with Vitest. Some
round-trip tests require local Word fixtures and skip when those are absent.

## Check a document

Open the existing command palette, search for **Check Document**, and run it on
the active document. It reports empty tags, missing citations, empty cards,
repeated substantive evidence, duplicate heading IDs, and blocked links.
Selecting an item jumps to it. The command never edits the document and does not
verify whether a citation or claim is accurate.

For local scripts and batch pipelines:

```sh
npm run check:document -- evidence.cmir
npm run check:document -- evidence.docx --json --fail-on-warning
```

The CLI accepts one `.cmir` or `.docx` file and writes a report to stdout. It
returns 0 on success, 1 when `--fail-on-warning` finds warnings, and 2 for input
or parsing errors. It never writes to the input file.

## Installation and migration

See [MIGRATION.md](./MIGRATION.md). Desktop releases and updates target this
fork, with a separate application ID, executable, and user-data profile.
There are no installers for this fork until its first verified release.

For interim desktop use on Windows, the **Windows desktop preview** workflow in
your fork's Actions tab builds a portable executable. Download the
`cardmirror-advanced-windows-preview` artifact, extract the ZIP, and run its
`.exe`; no Node.js, Git, or npm setup is needed on that computer. It is an
unsigned preview, so Windows may show a publisher warning. It preserves the
editor UI and routes desktop HTTP through Chromium while the full embedded Node
update is pending. This is a test artifact, not a verified installer release.

**Desktop release gate:** Electron 45.0.0 currently embeds Node 24.22.0, below
the October 2026 Node security fixes. Development checks report this honestly;
release commands and workflows refuse to publish until a patched Electron
runtime is pinned. See [SECURITY.md](./SECURITY.md).
The preview mitigation avoids Node's HTTP client stack without claiming to
patch every embedded Node API.

## Collaboration and optional services

No production relay is configured by default for this fork. Configure a custom
relay URL and token in Settings before enabling collaboration. The server is
included in [relay/](./relay/README.md). Everyone sharing cards must use the same
relay. Editing, local files, and the document checker work offline.

AI, model downloads, account linking, and plugins remain optional networked
features. They have their existing settings and trust requirements; review
[PRIVACY.md](./PRIVACY.md) before enabling them. Third-party plugins execute with
full application access and are not a security sandbox.

## Documentation and license

- [User manual](./MANUAL.md)
- [Architecture](./ARCHITECTURE.md)
- [Security scope and known limitations](./SECURITY.md)
- [Fork changes and validation](./FORK-CHANGES.md)
- [Third-party notices](./THIRD-PARTY-NOTICES.md)

The original [PolyForm Noncommercial License 1.0.0](./LICENSE), its required
notice, and third-party attributions are preserved. It permits modification and
distribution for permitted noncommercial purposes; it does not grant general
commercial-use permission or rights to relicense the original software.
Original copyright: Anthony Trufanov. ProseMirror: Marijn Haverbeke and
contributors. See the license and notices for the full terms.

## Web app (Chromebook & browser)

Run the web editor with `npm run dev` or build static assets with `npm run build`.
No live fork deployment is provided yet. The original CardMirror website runs
the original project; it does not contain this fork's changes.
