const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { once } = require('node:events');
// Exercise the built frontend's real middleware rewrite with a slow local API.
// No authentication, provider calls or production writes are involved.
(async () => {
  let calls = 0;
  const upstream = http.createServer((req, res) => {
    if (req.url !== '/api/drama/generate/stage') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ready":true}'); return; }
    calls++;
    req.resume();
    const timer = setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: { brief: 'A complete delayed creative brief.' } })); }, 32000);
    res.on('close', () => clearTimeout(timer));
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3112', '-H', '127.0.0.1'], { cwd: process.cwd(), env: { ...process.env, APP_SURFACE: 'frontend', API_SERVICE_URL: `http://127.0.0.1:${upstream.address().port}` }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) { try { const r = await fetch('http://127.0.0.1:3112/api/fixture-ready'); if (r.ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 200)); }
    assert(ready, 'Split frontend did not start');
    const started = Date.now();
    const response = await fetch('http://127.0.0.1:3112/api/drama/generate/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetStage: 1 }), signal: AbortSignal.timeout(45000) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.brief, 'A complete delayed creative brief.');
    assert.equal(calls, 1);
    assert(Date.now() - started >= 32000);
    console.log(`PASS built split-surface middleware: delayed brief HTTP200 after ${Date.now() - started}ms; one local upstream request, no paid provider call`);
  } finally { child.kill(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
