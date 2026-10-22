// Apply the one audited collaboration patch without patch-package's glob stack.
// Git is already required to clone/build this source checkout.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const patch = 'patches/loro-prosemirror+0.4.3.patch';
const pkg = JSON.parse(readFileSync(new URL('../node_modules/loro-prosemirror/package.json', import.meta.url), 'utf8'));
if (pkg.version !== '0.4.3') throw new Error('Review the collaboration patch before upgrading loro-prosemirror.');
const apply = (...args) => {
  const result = spawnSync('git', ['apply', ...args, patch], { cwd: root, encoding: 'utf8' });
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
