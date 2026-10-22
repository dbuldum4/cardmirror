import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const root = JSON.parse(read('package.json'));
const desktop = JSON.parse(read('apps/desktop/package.json'));
const expected = 'https://github.com/dbuldum4/cardmirror-advanced';
assert.equal(root.name, 'cardmirror-advanced');
assert.equal(root.version, desktop.version);
assert.equal(root.homepage, expected);
assert.equal(desktop.homepage, expected);
assert.equal(root.bugs.url, `${expected}/issues`);
assert.equal(desktop.build.publish.owner, 'dbuldum4');
assert.equal(desktop.build.publish.repo, 'cardmirror-advanced');
assert.equal(desktop.build.electronVersion, desktop.devDependencies.electron);
assert.equal(desktop.build.appId, 'io.github.dbuldum4.cardmirror-advanced');
// The original license and Required Notice must remain byte-for-byte intact.
assert.equal(createHash('sha256').update(read('LICENSE')).digest('hex'), 'aaf45e40edf584a34523cee426ab4341649dd0541de9b219afe89c5fa9238d7f');
for (const file of ['package.json', 'apps/desktop/package.json', 'src/editor/web-download.ts', 'apps/desktop/src/main.ts', 'src/editor/settings-ui.ts']) {
  assert.ok(!read(file).includes('github.com/ant981228/cardmirror'), `Upstream action/update target in ${file}`);
}
console.log('Fork identity, release targets, runtime pins, and original license verified.');
