'use strict';
/* Bonnetjes: opladen, ophalen, weigeren van valse bestanden, enkel voor de eigen gebruiker (Node en PHP). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const ENV = { FLUX_USERNAME: 'eigenaar', FLUX_PASSWORD: 'heel-geheim-1' };

function freePort() { return new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }
async function startNode(dir) {
  Object.assign(process.env, ENV, { FLUX_DATA_DIR: dir });
  delete require.cache[require.resolve('../server/server.js')];
  const { createServer, initSetup } = require('../server/server.js');
  await initSetup();
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: 'http://127.0.0.1:' + server.address().port, stop: () => server.close() };
}
async function startPhp(dir) {
  const port = await freePort();
  const env = Object.assign({}, process.env, ENV, { FLUX_DATA_DIR: dir, HELDER_CONFIG: path.join(dir, 'geen.php') });
  const proc = spawn('php', ['-S', '127.0.0.1:' + port, path.join(__dirname, '..', 'php', 'router.php')], { env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { try { await fetch(base + '/api/session'); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); } }
  return { base, stop: () => proc.kill() };
}
const hasPhp = spawnSync('php', ['-v']).status === 0;

for (const [name, start] of [['node', startNode], ['php', startPhp]]) {
  test(`${name}: bonnetjes`, { skip: name === 'php' && !hasPhp ? 'php niet geïnstalleerd' : false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helder-files-' + name + '-'));
    const srv = await start(dir);
    const call = async (method, p, body, cookie) => {
      const res = await fetch(srv.base + p, { method, headers: Object.assign({ 'Content-Type': 'application/json', 'X-Flux': '1' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
      const buf = Buffer.from(await res.arrayBuffer());
      let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch (e) { /* bestand */ }
      return { status: res.status, json, buf, headers: res.headers, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
    };
    try {
      const me = (await call('POST', '/api/login', { username: 'eigenaar', password: 'heel-geheim-1' })).cookie;
      assert.equal((await call('POST', '/api/files', { name: 'x.png', type: 'image/png', data: PNG.toString('base64') })).status, 401, 'enkel aangemeld');
      assert.equal((await call('POST', '/api/files', { name: 'x.png', type: 'image/png', data: Buffer.from('<script>alert(1)</script>').toString('base64') }, me)).status, 400, 'html als png wordt geweigerd');
      assert.equal((await call('POST', '/api/files', { name: 'x.svg', type: 'image/svg+xml', data: PNG.toString('base64') }, me)).status, 400, 'svg niet toegelaten');
      const up = await call('POST', '/api/files', { name: 'kasticket.png', type: 'image/png', data: PNG.toString('base64') }, me);
      assert.equal(up.status, 200, up.buf.toString());
      assert.deepEqual([up.json.name, up.json.type, up.json.size], ['kasticket.png', 'image/png', PNG.length]);
      const got = await call('GET', '/api/files/' + up.json.id, null, me);
      assert.equal(got.status, 200);
      assert.ok(got.buf.equals(PNG), 'zelfde bestand terug');
      assert.equal(got.headers.get('content-type'), 'image/png');
      assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
      assert.equal((await call('GET', '/api/files/' + up.json.id)).status, 401, 'niet zonder aanmelden');
      assert.equal((await call('GET', '/api/files/bestaatniet123', null, me)).status, 404);
      assert.equal((await call('POST', '/api/files/delete', { id: up.json.id }, me)).status, 200);
      assert.equal((await call('GET', '/api/files/' + up.json.id, null, me)).status, 404, 'verwijderd');
    } finally {
      srv.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
