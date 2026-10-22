import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const patchName = 'loro-prosemirror+0.4.3.patch';
const targets = ['index.cjs', 'index.js'];
const original = 'const origin = "upstream";\nexported(origin);\n';
const patched = 'const origin = "cardmirror";\nexported(origin);\n';
const patch = targets.map((name) => [
  'diff --git a/node_modules/loro-prosemirror/dist/' + name + ' b/node_modules/loro-prosemirror/dist/' + name,
  '--- a/node_modules/loro-prosemirror/dist/' + name,
  '+++ b/node_modules/loro-prosemirror/dist/' + name,
  '@@ -1,2 +1,2 @@',
  '-const origin = "upstream";',
  '+const origin = "cardmirror";',
  ' exported(origin);',
  '',
].join('\n')).join('');

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 10_000 });
  if (result.error) throw result.error;
  return result;
}

function fixture(t, endings, autocrlf) {
  const temp = mkdtempSync(join(tmpdir(), 'cardmirror-patch-'));
  t.after(() => rmSync(temp, { recursive: true, force: true, maxRetries: 3 }));
  const root = join(temp, 'checkout with spaces');
  const dist = join(root, 'node_modules/loro-prosemirror/dist');
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'patches'));
  copyFileSync(new URL('./apply-dependency-patches.mjs', import.meta.url), join(root, 'scripts/apply-dependency-patches.mjs'));
  writeFileSync(join(root, 'node_modules/loro-prosemirror/package.json'), '{"version":"0.4.3"}\n');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(root, 'patches', patchName), endings === 'CRLF' ? patch.replace(/\n/g, '\r\n') : patch);
  for (const name of targets) writeFileSync(join(dist, name), original);
  for (const args of [['init', '--quiet'], ['config', 'core.autocrlf', autocrlf]]) {
    const result = run('git', args, root);
    assert.equal(result.status, 0, result.stderr);
  }
  return {
    root,
    dist,
    apply: () => run(process.execPath, ['scripts/apply-dependency-patches.mjs'], root),
  };
}

for (const autocrlf of ['false', 'true']) {
  for (const endings of ['LF', 'CRLF']) {
    test('applies ' + endings + ' patch with core.autocrlf=' + autocrlf + ' and is idempotent', (t) => {
      const { apply, dist } = fixture(t, endings, autocrlf);
      const first = apply();
      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stdout, /Applied collaboration patch/);
      for (const name of targets) assert.equal(readFileSync(join(dist, name), 'utf8'), patched);
      const second = apply();
      assert.equal(second.status, 0, second.stderr);
      assert.match(second.stdout, /already applied/);
      for (const name of targets) assert.equal(readFileSync(join(dist, name), 'utf8'), patched);
    });
  }
}

test('rejects genuine dependency drift without partially patching files', (t) => {
  const { apply, dist } = fixture(t, 'CRLF', 'true');
  const changed = 'const origin = "different release";\nexported(origin);\n';
  writeFileSync(join(dist, 'index.js'), changed);
  const result = apply();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Collaboration patch does not apply/);
  assert.equal(readFileSync(join(dist, 'index.cjs'), 'utf8'), original);
  assert.equal(readFileSync(join(dist, 'index.js'), 'utf8'), changed);
});

test('requires review when the pinned dependency version changes', (t) => {
  const { apply, root, dist } = fixture(t, 'CRLF', 'true');
  writeFileSync(join(root, 'node_modules/loro-prosemirror/package.json'), '{"version":"0.4.4"}\n');
  const result = apply();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Review the collaboration patch/);
  for (const name of targets) assert.equal(readFileSync(join(dist, name), 'utf8'), original);
});
