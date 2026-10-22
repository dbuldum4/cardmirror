import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// The standalone download must carry the upstream required notice/license too.
const notices = ['LICENSE', 'THIRD-PARTY-NOTICES.md'].map((name) => readFileSync(`${root}${name}`, 'utf8')).join('\n\n');
if (notices.includes('*/')) throw new Error('License comment needs escaping before bundling.');
const result = buildSync({
  entryPoints: [`${root}src/tools/cardmirror-read-cli.ts`],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'warning',
  banner: { js: `/*\n${notices}\n*/` },
});
writeFileSync(`${root}packaging/cardmirror-read/cardmirror-read.cjs`, result.outputFiles[0].text.replace(/[\t ]+$/gm, ''));
