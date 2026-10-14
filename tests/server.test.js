'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const C = require('../js/core.js');
const Store = require('../js/store.js');

/*
 * Dezelfde tests draaien tegen beide servers: de Node-server (server/server.js, voor Docker/VPS)
 * en de PHP-server (api.php, voor gewone webhosting zoals Vimexx).
 */

async function startNode(dir) {
  process.env.FLUX_DATA_DIR = dir;
  process.env.FLUX_USERNAME = 'tester';
  process.env.FLUX_PASSWORD = 'heel-geheim-1';
  delete process.env.ANTHROPIC_API_KEY;
  const { createServer, initSetup } = require('../server/server.js');
  await initSetup();
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: 'http://127.0.0.1:' + server.address().port, stop: () => server.close() };
}

function freePort() {
  return new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function startPhp(dir) {
  const port = await freePort();
  const env = Object.assign({}, process.env, { FLUX_DATA_DIR: dir, FLUX_USERNAME: 'tester', FLUX_PASSWORD: 'heel-geheim-1', HELDER_CONFIG: path.join(dir, 'geen-config.php'), ANTHROPIC_API_KEY: '' });
  const proc = spawn('php', ['-S', '127.0.0.1:' + port, path.join(__dirname, '..', 'php', 'router.php')], { env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try { await fetch(base + '/api/session'); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); }
  }
  return { base, stop: () => proc.kill() };
}

const hasPhp = spawnSync('php', ['-v']).status === 0;

for (const [name, start] of [['node', startNode], ['php', startPhp]]) {
  const skip = name === 'php' && !hasPhp ? 'php niet geïnstalleerd' : false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helder-' + name + '-'));
  let base, srv;
  test.before(async () => { if (!skip) { srv = await start(dir); base = srv.base; } });
  test.after(() => { if (srv) srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  async function call(method, p, body, cookie, headers) {
    const res = await fetch(base + p, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json', 'X-Flux': '1' }, cookie ? { Cookie: cookie } : {}, headers || {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* geen json */ }
    return { status: res.status, json, text, cookie: (res.headers.get('set-cookie') || '').split(';')[0], headers: res.headers };
  }

  test(`${name}: aanmelden, beveiliging en synchronisatie`, { skip }, async () => {
    const s0 = await call('GET', '/api/session');
    assert.equal(s0.json.user, null);
    assert.equal(s0.json.setupRequired, false);

    assert.equal((await call('GET', '/api/data')).status, 401, 'zonder sessie geen gegevens');
    assert.equal((await call('POST', '/api/login', { username: 'tester', password: 'fout' })).status, 401);
    assert.equal((await call('POST', '/api/login', { username: 'tester', password: 'heel-geheim-1' }, null, { 'X-Flux': '' })).status, 403, 'CSRF-header verplicht');

    const login = await call('POST', '/api/login', { username: 'tester', password: 'heel-geheim-1' });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    const cookie = login.cookie;

    // Een verouderde app (zonder schemaversie) mag niets meer terugzetten
    assert.equal((await call('POST', '/api/sync', { changes: { transactions: [{ id: 'oud' }] }, rev: 0 }, cookie)).status, 409);

    // Toestel A uploadt alles
    const a = Store.demoState('2026-10-13');
    const T = Date.now();
    const keys = C.stampChanges(null, a, T);
    const up = await call('POST', '/api/sync', { changes: C.extractChanges(a, keys), rev: 0, schema: Store.VERSION }, cookie);
    assert.equal(up.status, 200);
    assert.equal(up.json.rev, 1);
    assert.equal(up.json.state.transactions.length, a.transactions.length);

    // Toestel B met verouderde rev krijgt de volledige staat; up-to-date krijgt enkel rev
    const b = await call('POST', '/api/sync', { changes: null, rev: 0, schema: Store.VERSION }, cookie);
    assert.equal(b.json.state.transactions.length, a.transactions.length);
    const same = await call('POST', '/api/sync', { changes: null, rev: 1, schema: Store.VERSION }, cookie);
    assert.deepEqual(same.json, { rev: 1 });

    // Gedeeltelijke wijziging + verwijdering
    const removed = a.transactions[0].id;
    const delta = { tombstones: { ['transactions:' + removed]: T + 5 }, budgets: [Object.assign({}, a.budgets[0], { limit: 1, updatedAt: T + 5 })] };
    const d = await call('POST', '/api/sync', { changes: delta, rev: 1, schema: Store.VERSION }, cookie);
    assert.equal(d.json.rev, 2);
    assert.ok(!d.json.state.transactions.some(t => t.id === removed));
    assert.equal(d.json.state.budgets.find(x => x.id === a.budgets[0].id).limit, 1);

    // Bestanden buiten de app worden niet geserveerd
    assert.equal((await call('GET', '/server/server.js')).status, 404);
    assert.equal((await call('GET', '/js/../data/users.json')).status, 404);
    assert.equal((await call('GET', '/js/%2e%2e/server/ai.js')).status, 404);
    for (const lp of ['/privacy.html', '/voorwaarden.html']) {
      const r = await call('GET', lp);
      assert.equal(r.status, 200, lp);
      assert.match(r.text, /Felix Coens/);
    }
    const page = await call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);

    // Wachtwoord wijzigen en afmelden
    assert.equal((await call('POST', '/api/password', { current: 'heel-geheim-1', password: 'nieuw-geheim-2' }, cookie)).status, 200);
    assert.equal((await call('POST', '/api/logout', {}, cookie)).status, 200);
    assert.equal((await call('GET', '/api/data', null, cookie)).status, 401, 'sessie ongeldig na afmelden');
    assert.equal((await call('POST', '/api/login', { username: 'tester', password: 'nieuw-geheim-2' })).status, 200);
  });

  test(`${name}: gegevens van een oudere versie worden bij de update gewist, met back-up`, { skip }, async () => {
    const file = path.join(dir, 'user-' + Buffer.from('tester').toString('hex') + '.json');
    fs.writeFileSync(file, JSON.stringify({ rev: 7, state: { version: 2, transactions: [{ id: 'oud' }] } }));
    const login = await call('POST', '/api/login', { username: 'tester', password: 'nieuw-geheim-2' });
    const d = await call('GET', '/api/data', null, login.cookie);
    assert.equal(d.json.state.version, Store.VERSION);
    assert.equal(d.json.state.transactions.length, 0);
    assert.equal(d.json.rev, 8);
    assert.ok(fs.existsSync(file + '.v2.bak'), 'oude gegevens bewaard als back-up op de server');
  });

  test(`${name}: dagelijkse automatische back-up bij wijzigingen`, { skip }, async () => {
    const files = fs.readdirSync(path.join(dir, 'backups'));
    assert.ok(files.some(f => f.endsWith(new Date().toISOString().slice(0, 10) + '.json')), 'back-up van vandaag aanwezig');
  });

  test(`${name}: samenvoegen geeft exact hetzelfde als FluxCore.mergeStates`, { skip }, async () => {
    const login = await call('POST', '/api/login', { username: 'tester', password: 'nieuw-geheim-2' });
    const cookie = login.cookie;
    const cur = await call('GET', '/api/data', null, cookie);
    const T = Date.now();
    const a = Store.demoState('2026-10-13');
    a.subscriptions = { netflix: { status: 'confirmed' } };
    a.settings.lookupCountries = 'be,nl';
    const k1 = C.stampChanges(null, a, T);
    const ch1 = C.extractChanges(a, k1);
    const r1 = await call('POST', '/api/sync', { changes: ch1, rev: cur.json.rev, schema: Store.VERSION }, cookie);
    // Tweede toestel: oudere en nieuwere versies door elkaar, verwijdering en een lege categorie-lijst
    const ch2 = {
      transactions: [Object.assign({}, a.transactions[1], { note: 'nieuwer', updatedAt: T + 10 }), Object.assign({}, a.transactions[2], { note: 'ouder', updatedAt: T - 10 })],
      tombstones: { ['transactions:' + a.transactions[3].id]: T + 10, ['budgets:bestaat-niet']: T },
      subscriptions: { netflix: { status: 'ignored', updatedAt: T + 20 } },
      settings: Object.assign({}, a.settings, { warnAt: 0.9, updatedAt: T - 5 }),
      categories: []
    };
    const r2 = await call('POST', '/api/sync', { changes: ch2, rev: r1.json.rev, schema: Store.VERSION }, cookie);
    const expected = C.mergeStates(C.mergeStates(cur.json.state, ch1, T), ch2, T);
    const strip = st => { const o = JSON.parse(JSON.stringify(st)); delete o.version; for (const c of C.SYNC_COLLECTIONS) o[c] = (o[c] || []).map(x => { const y = Object.assign({}, x); for (const f of ['isTransfer', 'transferPairId', 'ruleId', 'categoryId', 'categorySource']) delete y[f]; return y; }).sort((p, q) => String(p.id).localeCompare(String(q.id))); return o; };
    assert.deepEqual(strip(r2.json.state), strip(expected));
    assert.equal(r2.json.state.transactions.find(t => t.id === a.transactions[1].id).note, 'nieuwer');
    assert.notEqual(r2.json.state.transactions.find(t => t.id === a.transactions[2].id).note, 'ouder');
    assert.equal(r2.json.state.subscriptions.netflix.status, 'ignored');
    assert.equal(r2.json.state.version, Store.VERSION, 'versie altijd ingevuld (anders wist de app de gegevens)');
    assert.equal(typeof r2.json.state.tombstones, 'object');
    assert.ok(!Array.isArray(r2.json.state.tombstones) && !Array.isArray(r2.json.state.subscriptions), 'lege objecten blijven objecten');
  });

  test(`${name}: te veel foute aanmeldpogingen worden geblokkeerd`, { skip }, async () => {
    let last;
    for (let i = 0; i < 12; i++) last = await call('POST', '/api/login', { username: 'niemand', password: 'fout' + i });
    assert.equal(last.status, 429);
  });
}
