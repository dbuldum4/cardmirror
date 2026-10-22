// Apply the one audited collaboration patch without patch-package's glob stack.
// Git is already required to clone/build this source checkout.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const patch = 'patches/loro-prosemirror+0.4.3.patch';
// Windows checkouts may convert tracked patches to CRLF; npm tarballs keep LF.
// Feed Git normalized patch bytes so matching stays exact on every platform.
const patchInput = readFileSync(new URL(`../${patch}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(readFileSync(new URL('../node_modules/loro-prosemirror/package.json', import.meta.url), 'utf8'));
if (pkg.version !== '0.4.3') throw new Error('Review the collaboration patch before upgrading loro-prosemirror.');
const apply = (...args) => {
  // Keep npm's LF files unchanged by Git's Windows checkout conversion too.
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', ...args, '-'], {
    cwd: root, encoding: 'utf8', input: patchInput,
  });
  if (result.error) throw result.error;
  return result;
};
if (apply('--reverse', '--check').status === 0) {
  console.log('Collaboration patch already applied.');
} else {
  const checked = apply('--check');
  if (checked.status !== 0) throw new Error(`Collaboration patch does not apply:\n${checked.stderr}`);
  const result = apply();
  if (result.status !== 0) throw new Error(`Collaboration patch failed:\n${result.stderr}`);
  console.log('Applied collaboration patch.');
}
