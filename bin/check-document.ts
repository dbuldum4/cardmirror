/** Local evidence linting for a single document. Never modifies the input. */
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseNative } from '../src/native/index.js';
import { fromDocx } from '../src/import/index.js';
import { checkDocument, formatDocumentCheck } from '../src/editor/document-check.js';
import { checkDocumentSize, MAX_ARCHIVE_BYTES } from '../src/safe-containers.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const files = args.filter((arg) => !arg.startsWith('--'));
if (files.length !== 1 || [...flags].some((flag) => !['--json', '--fail-on-warning'].includes(flag))) {
  console.error('Usage: npm run check:document -- file.cmir|file.docx [--json] [--fail-on-warning]');
  process.exitCode = 2;
} else {
  try {
    const file = files[0]!;
    const ext = extname(file).toLowerCase();
    if (!['.cmir', '.docx'].includes(ext)) throw new Error('Expected a .cmir or .docx document.');
    const metadata = await stat(file);
    if (!metadata.isFile()) throw new Error('Expected a regular document file.');
    checkDocumentSize(metadata.size, ext === '.docx' ? MAX_ARCHIVE_BYTES : undefined);
    const bytes = await readFile(file);
    const doc = ext === '.cmir' ? parseNative(bytes).doc : await fromDocx(bytes);
    const report = checkDocument(doc);
    console.log(flags.has('--json') ? JSON.stringify(report, null, 2) : formatDocumentCheck(report));
    if (flags.has('--fail-on-warning') && report.issues.some((issue) => issue.severity === 'warning')) process.exitCode = 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  }
}
