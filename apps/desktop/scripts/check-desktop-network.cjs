// Integration probe for the actual Chromium transport. Test-only Linux sandbox
// override is opt-in for containers; it never changes the application launch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cardmirror-network-probe-'));
  const env = { ...process.env, XDG_CACHE_HOME: path.join(profile, 'cache') };
  delete env.ELECTRON_RUN_AS_NODE;
  const flags = process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu'] : [];
  if (process.env.CARDMIRROR_TEST_NO_SANDBOX === '1') flags.push('--no-sandbox');
  try {
    const result = spawnSync(require('electron'), [...flags, '--user-data-dir=' + profile, __filename], {
      env, stdio: 'inherit', timeout: 60_000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Chromium transport integration probe failed');
  } finally {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
} else {
  const { app, session } = require('electron');
  const http = require('node:http');
  const https = require('node:https');
  const zlib = require('node:zlib');
  const { desktopFetch } = require('../dist/desktop-fetch.js');
  const servers = [];
  const checks = [];
  let cacheHits = 0;
  function listen(server) {
    servers.push(server);
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port));
    });
  }
  app.whenReady().then(async () => {
    // Any accidental Node fetch fallback fails every legitimate control below.
    globalThis.fetch = async () => { throw new Error('Node fetch is forbidden in desktop HTTP paths'); };
    const handler = (req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/inspect' }).end();
      } else if (req.url === '/cross-origin') {
        res.writeHead(302, { Location: other + '/inspect' }).end();
      } else if (req.url === '/cross-to-file') {
        res.writeHead(302, { Location: 'file:///private.txt' }).end();
      } else if (req.url === '/inspect') {
        res.setHeader('Set-Cookie', 'remote-cookie=secret; Path=/');
        res.end(JSON.stringify(req.headers));
      } else if (req.url === '/cache') {
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.end(String(++cacheHits));
      } else if (req.url === '/conditional') {
        assert.equal(req.headers['if-none-match'], '"relay-etag"');
        res.writeHead(304).end();
      } else if (req.url === '/upload') {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          assert.equal(req.headers['content-encoding'], 'gzip');
          res.end(zlib.gunzipSync(Buffer.concat(chunks)));
        });
      } else if (req.url === '/brotli') {
        res.setHeader('Content-Encoding', 'br');
        res.end(zlib.brotliCompressSync(Buffer.from('compressed control')));
      } else if (req.url === '/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: hello\ndata: {}\n\n');
      } else if (req.url === '/slow') {
        // Intentionally leave headers pending until cancellation.
      } else {
        res.writeHead(404).end('missing');
      }
    };
    const other = await listen(http.createServer(handler));
    const base = await listen(http.createServer(handler));
    await session.defaultSession.cookies.set({ url: base, name: 'renderer-cookie', value: 'secret' });
    const partition = 'cardmirror-advanced-network-' + require('node:crypto').createHash('sha256').update(base).digest('hex');
    const isolated = session.fromPartition(partition, { cache: false });
    await isolated.cookies.set({ url: base, name: 'network-cookie', value: 'secret' });

    for (const protocol of ['file:///private.txt', 'data:text/plain,secret', 'custom://local']) {
      await assert.rejects(desktopFetch(protocol), /HTTP\(S\)/);
    }
    checks.push('non-HTTP protocols rejected');
    const inspect = await desktopFetch(base + '/inspect', {
      credentials: 'include',
      headers: { Authorization: 'Bearer test', 'X-Bridge-Token': 'bridge-token', 'User-Agent': 'cardmirror-probe' },
    });
    const headers = await inspect.json();
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.authorization, 'Bearer test');
    assert.equal(headers['x-bridge-token'], 'bridge-token');
    assert.equal(headers['user-agent'], 'cardmirror-probe');
    assert.equal((await isolated.cookies.get({ name: 'remote-cookie' })).length, 0);
    checks.push('cookies excluded; explicit authentication and user agent preserved');
    assert.equal(await (await desktopFetch(base + '/cache')).text(), '1');
    assert.equal(await (await desktopFetch(base + '/cache', { cache: 'force-cache' })).text(), '2');
    assert.equal((await desktopFetch(base + '/conditional', { headers: { 'If-None-Match': '"relay-etag"' } })).status, 304);
    checks.push('no browser cache; explicit relay ETags preserved');
    const redirected = await desktopFetch(base + '/redirect', { headers: { Authorization: 'Bearer test' } });
    assert.equal((await redirected.json()).authorization, 'Bearer test');
    const crossed = await desktopFetch(base + '/cross-origin', { headers: { Authorization: 'Bearer test' } });
    assert.equal((await crossed.json()).authorization, undefined);
    checks.push('redirects stay in Chromium; cross-origin credentials stripped');
    const upload = await desktopFetch(base + '/upload', {
      method: 'POST', headers: { 'Content-Encoding': 'gzip' }, body: zlib.gzipSync('encrypted relay payload'),
    });
    assert.equal(await upload.text(), 'encrypted relay payload');
    assert.equal(await (await desktopFetch(base + '/brotli')).text(), 'compressed control');
    assert.equal((await desktopFetch(base + '/missing')).status, 404);
    checks.push('binary gzip uploads, Brotli downloads, and HTTP errors preserved');
    const ctl = new AbortController();
    const stream = await desktopFetch(base + '/stream', { signal: ctl.signal });
    const reader = stream.body.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /event: hello/);
    const pendingRead = reader.read();
    ctl.abort();
    await assert.rejects(pendingRead);
    const earlyAbort = new AbortController();
    const pending = desktopFetch(base + '/slow', { signal: earlyAbort.signal });
    setTimeout(() => earlyAbort.abort(), 20);
    await assert.rejects(pending);
    checks.push('SSE arrives incrementally; abort works before and after headers');
    const fixture = path.join(__dirname, '../../../tests/desktop/fixtures/network');
    const secureBase = (await listen(https.createServer({
      key: fs.readFileSync(path.join(fixture, 'test-key.pem')),
      cert: fs.readFileSync(path.join(fixture, 'test-cert.pem')),
    }, handler))).replace('http:', 'https:');
    await assert.rejects(desktopFetch(secureBase + '/inspect'), /ERR_CERT|certificate/i);
    await assert.rejects(desktopFetch(base + '/cross-to-file'));
    checks.push('untrusted HTTPS certificate and HTTP-to-file redirect rejected');
    console.log(JSON.stringify({ electron: process.versions.electron, node: process.versions.node, checks }, null, 2));
    app.exit(0);
  }).catch((err) => {
    console.error(err);
    app.exit(1);
  }).finally(() => {
    for (const server of servers) { server.closeAllConnections(); server.close(); }
  });
}
