'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-test-'));
process.env.FLUX_DATA_DIR = dir;
process.env.FLUX_USERNAME = 'tester';
process.env.FLUX_PASSWORD = 'heel-geheim-1';
delete process.env.ANTHROPIC_API_KEY;
const { createServer, initSetup } = require('../server/server.js');
const C = require('../js/core.js');
const Store = require('../js/store.js');

let base, server;
test.before(async () => {
  await initSetup();
  server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

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

test('server: aanmelden, beveiliging en synchronisatie', async () => {
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
  const page = await call('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);

  // Wachtwoord wijzigen en afmelden
  assert.equal((await call('POST', '/api/password', { current: 'heel-geheim-1', password: 'nieuw-geheim-2' }, cookie)).status, 200);
  assert.equal((await call('POST', '/api/logout', {}, cookie)).status, 200);
  assert.equal((await call('GET', '/api/data', null, cookie)).status, 401, 'sessie ongeldig na afmelden');
  assert.equal((await call('POST', '/api/login', { username: 'tester', password: 'nieuw-geheim-2' })).status, 200);
});

test('server: gegevens van een oudere versie worden bij de update gewist, met back-up', async () => {
  const file = path.join(dir, 'user-' + Buffer.from('tester').toString('hex') + '.json');
  fs.writeFileSync(file, JSON.stringify({ rev: 7, state: { version: 2, transactions: [{ id: 'oud' }] } }));
  const login = await call('POST', '/api/login', { username: 'tester', password: 'nieuw-geheim-2' });
  const d = await call('GET', '/api/data', null, login.cookie);
  assert.equal(d.json.state.version, Store.VERSION);
  assert.equal(d.json.state.transactions.length, 0);
  assert.equal(d.json.rev, 8);
  assert.ok(fs.existsSync(file + '.v2.bak'), 'oude gegevens bewaard als back-up op de server');
});

test('server: te veel foute aanmeldpogingen worden geblokkeerd', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call('POST', '/api/login', { username: 'niemand', password: 'fout' + i });
  assert.equal(last.status, 429);
});
