'use strict';
/* Gedeelde boekhouding: uitnodigen, deelnemen, dezelfde gegevens, verlaten (Node en PHP). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const Store = require('../js/store.js');
const C = require('../js/core.js');

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
  test(`${name}: gedeelde boekhouding`, { skip: name === 'php' && !hasPhp ? 'php niet geïnstalleerd' : false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helder-house-' + name + '-'));
    fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify({ registration: 'open' }));
    const srv = await start(dir);
    const call = async (method, p, body, cookie) => {
      const res = await fetch(srv.base + p, { method, headers: Object.assign({ 'Content-Type': 'application/json', 'X-Flux': '1' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
      const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
      return { status: res.status, json, text, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
    };
    const push = async (cookie, st) => call('POST', '/api/sync', { changes: C.extractChanges(st, C.stampChanges(null, st)), rev: 0, schema: Store.VERSION }, cookie);
    const txOf = async cookie => ((await call('GET', '/api/data', null, cookie)).json.state || { transactions: [] }).transactions.map(t => t.id).sort();
    try {
      const owner = (await call('POST', '/api/login', { username: 'eigenaar', password: 'heel-geheim-1' })).cookie;
      const partner = (await call('POST', '/api/register', { username: 'partner', password: 'partner-geheim-1' })).cookie;
      const a = Store.defaultState(); a.transactions.push({ id: 'van-eigenaar', accountId: 'acc_cash', date: '2026-10-01', amount: -500, counterparty: 'Bakker', splits: [], source: 'manual' });
      const b = Store.defaultState(); b.transactions.push({ id: 'van-partner', accountId: 'acc_cash', date: '2026-10-02', amount: -700, counterparty: 'Slager', splits: [], source: 'manual' });
      assert.equal((await push(owner, a)).status, 200);
      assert.equal((await push(partner, b)).status, 200);

      assert.equal((await call('GET', '/api/household', null, owner)).json.role, 'none');
      const inv = await call('POST', '/api/household/invite', {}, owner);
      assert.match(inv.json.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      assert.equal((await call('POST', '/api/household/join', { code: 'FOUT-CODE' }, partner)).status, 400);
      const joined = await call('POST', '/api/household/join', { code: inv.json.code.toLowerCase() }, partner);
      assert.equal(joined.status, 200, joined.text);
      assert.equal(joined.json.role, 'member');
      assert.equal((await call('POST', '/api/household/join', { code: inv.json.code }, partner)).status, 400, 'code maar één keer bruikbaar');
      assert.equal((await call('GET', '/api/session', null, partner)).json.dataUser, 'eigenaar');
      assert.deepEqual(await txOf(partner), ['van-eigenaar'], 'de partner ziet de boekhouding van de eigenaar');
      // Wat de partner toevoegt, ziet de eigenaar
      const c = Store.defaultState(); c.transactions.push({ id: 'samen', accountId: 'acc_cash', date: '2026-10-03', amount: -900, counterparty: 'Ikea', splits: [], source: 'manual' });
      assert.equal((await call('POST', '/api/sync', { changes: C.extractChanges(c, ['transactions:samen']), rev: 0, schema: Store.VERSION }, partner)).status, 200);
      assert.deepEqual(await txOf(owner), ['samen', 'van-eigenaar']);
      const os1 = (await call('GET', '/api/household', null, owner)).json;
      assert.deepEqual([os1.role, os1.members.map(m => m.user)], ['owner', ['partner']]);
      // Verlaten: de eigen gegevens van de partner komen terug
      assert.equal((await call('POST', '/api/household/leave', {}, partner)).json.role, 'none');
      assert.deepEqual(await txOf(partner), ['van-partner']);
      assert.deepEqual(await txOf(owner), ['samen', 'van-eigenaar'], 'de gedeelde gegevens blijven bij de eigenaar');
      // Opnieuw uitnodigen, en nu haalt de eigenaar de partner eruit
      const inv2 = await call('POST', '/api/household/invite', {}, owner);
      await call('POST', '/api/household/join', { code: inv2.json.code }, partner);
      assert.equal((await call('POST', '/api/household/leave', { user: 'partner' }, owner)).json.role, 'none');
      assert.equal((await call('GET', '/api/session', null, partner)).json.dataUser, 'partner');
    } finally {
      srv.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
