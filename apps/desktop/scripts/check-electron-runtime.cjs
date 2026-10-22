const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.versions.electron) {
  const electron = require('electron');
  const result = spawnSync(electron, [__filename, ...process.argv.slice(2)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Electron runtime probe failed');
} else {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(process.versions.electron, pkg.devDependencies.electron);
  if (pkg.build?.electronVersion) {
    assert.equal(process.versions.electron, pkg.build.electronVersion);
  }
  // This is a conservative full-Node-update gate, not a per-CVE exposure test.
  // Electron 45 uses Chromium 156's already-fixed Brotli implementation even
  // though its Node version predates the security release. Application HTTP
  // now uses Chromium too; the embedded Node TLS API remains affected below.
  const patchedNode = { 22: [23, 4], 24: [22, 1], 26: [12, 1] };
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  const floor = patchedNode[major];
  const nodeHasOctoberFixes = Boolean(floor) && (minor > floor[0] || (minor === floor[0] && patch >= floor[1]));
  if (!nodeHasOctoberFixes) {
    // Development checks disclose exposure; publishing must use the strict gate.
    console.log(`::warning::Electron ${process.versions.electron} embeds Node ${process.versions.node}, which predates the 2026-10-21 Node security release (application HTTP mitigated via Chromium; embedded Node APIs remain unpatched). Upgrade Electron once a release embeds Node 24.22.1 or later.`);
  }
  if (process.argv.includes('--require-patched-node')) {
    assert.ok(nodeHasOctoberFixes, 'Publishing blocked: Electron embeds a Node version missing the October 2026 security fixes.');
  }
  const zlib = require('node:zlib');
  const input = Buffer.from(Array.from({ length: 131072 }, (_, i) => i % 251));
  assert.deepEqual(zlib.brotliDecompressSync(zlib.brotliCompressSync(input)), input);
  assert.throws(() => zlib.brotliDecompressSync(Buffer.from([255])));
  const tls = require('node:tls');
  const cert = { subjectaltname: 'DNS:expected.test, IP Address:127.0.0.1' };
  assert.equal(tls.checkServerIdentity('expected.test', cert), undefined);
  assert.equal(tls.checkServerIdentity('127.0.0.1', cert), undefined);
  assert.ok(tls.checkServerIdentity('other.test', cert) instanceof Error);
  const numericCert = { subjectaltname: 'DNS:127.0.0.1, DNS:87.0.0.1' };
  const tlsRejectsNonCanonicalIPs = ['１２７.0.0.1', '127.1', '0127.0.0.1'].every(
    (host) => tls.checkServerIdentity(host, numericCert) instanceof Error,
  );
  console.log(JSON.stringify({
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    nodeHasOctoberFixes,
    tlsRejectsNonCanonicalIPs,
    brotli: 'smoke test passed (does not detect CVE-2026-111497)',
    tls: 'basic controls passed; non-canonical IP bypass cases measured separately above',
  }));
}
