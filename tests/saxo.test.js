'use strict';
/*
 * Saxo Bank: omzetten naar Helder, samen met Degiro in één portefeuille, en dezelfde servertests
 * tegen de Node- en de PHP-server met een nagebootste Saxo OpenAPI.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const Invest = require('../js/invest.js');
const Store = require('../js/store.js');
const C = require('../js/core.js');
const Saxo = require('../server/saxo.js');
const Fake = require('./fake-saxo.js');

function normalized() {
  const d = Fake.sample();
  return Saxo.normalize({ balance: d.balance, netPositions: d.netPositions, details: d.details.Stock.concat(d.details.Etf), trades: d.trades, bookings: d.bookings });
}

test('saxo: posities, transacties en boekingen omzetten naar Helder', () => {
  const r = normalized();
  assert.equal(r.cashEur, 123456);
  assert.equal(r.positions.length, 2, 'posities met 0 stuks vallen weg');
  assert.deepEqual(r.positions[0], { key: 'US0378331005', productId: '211', name: 'Apple Inc.', isin: 'US0378331005', symbol: 'AAPL:xnas', currency: 'USD', quantity: 10, price: 180.5, valueEur: 180500, costEur: 150000 });
  assert.equal(r.positions[1].costEur, null, 'zonder winstcijfer geen kostprijs');
  const [t1, t2] = r.trades;
  assert.deepEqual([t1.quantity, t1.totalEur, t1.feesEur, t1.date, t1.isin], [12, -151050, -1050, '2026-02-03', 'US0378331005']);
  assert.deepEqual([t2.quantity, t2.totalEur], [-2, 33000], 'verkoop: negatief aantal, geld komt binnen');
  const types = Object.fromEntries(r.movements.map(m => [m.id, m.type]));
  assert.deepEqual(types, { 'saxo|B1': 'deposit', 'saxo|B2': 'trade', 'saxo|B3': 'fee', 'saxo|B4': 'dividend', 'saxo|B5': 'dividend_tax', 'saxo|B6': 'fee', 'saxo|B7': 'withdrawal' });
  assert.match(r.movements.find(m => m.id === 'saxo|B3').description, /^Transactiekosten/, 'commissie telt niet dubbel met de transactie');
  assert.equal(r.movements.find(m => m.id === 'saxo|B4').isin, 'US0378331005');
});

test('saxo en degiro samen in één portefeuille', () => {
  const s = Store.defaultState();
  const degiro = { positions: [{ key: 'BE0003565737', name: 'KBC Groep', isin: 'BE0003565737', currency: 'EUR', quantity: 20, price: 70, valueEur: 140000 }], cashEur: 5000,
    trades: [{ id: 'api|1', date: '2025-03-01', isin: 'BE0003565737', name: 'KBC Groep', quantity: 20, price: 60, currency: 'EUR', totalEur: -120000, feesEur: -200 }],
    movements: [{ id: 'api|m1', date: '2025-02-20', type: 'deposit', amountEur: 125000, description: 'iDEAL storting', isin: '' }] };
  s.investments = Invest.mergeInvestments(null, degiro, 'degiro-api', '2026-10-01');
  assert.ok(!s.investments.brokers, 'met één broker blijft het formaat ongewijzigd');
  s.investments.market = { series: {}, fetchedAt: '2026-10-01T00:00:00Z' };
  s.investments = Invest.mergeInvestments(s.investments, normalized(), 'saxo-api', '2026-10-14');
  assert.deepEqual(Object.keys(s.investments.brokers).sort(), ['degiro', 'saxo']);
  assert.ok(s.investments.market, 'koersen blijven bewaard');
  const v = Invest.view(s.investments);
  assert.equal(Invest.view(s.investments), v, 'overzicht wordt hergebruikt');
  assert.equal(v.positions.length, 3);
  assert.deepEqual(v.positions.map(p => p.broker), ['degiro', 'saxo', 'saxo']);
  assert.equal(v.cashEur, 5000 + 123456);
  const sum = Invest.summary(v);
  assert.equal(sum.valueEur, 140000 + 5000 + 180500 + 319520 + 123456);
  assert.equal(sum.deposits, 125000 + 600000, 'stortingen bij beide brokers');
  assert.deepEqual(Invest.brokers(v).map(b => b.id), ['degiro', 'saxo']);
  // Waarde door de tijd: op de Saxo-datum telt ook Degiro mee
  const h = v.history.find(x => x.date === '2026-10-14');
  assert.ok(h.valueEur > 140000 + 5000 + 600000, 'beide brokers op de laatste datum');
  assert.ok(v.history.find(x => x.date === '2026-10-01').valueEur > 145000 + 300000, 'op de Degiro-datum is Saxo gereconstrueerd uit de transacties');
  assert.ok(Invest.performance(v), 'rendement over het geheel');
  assert.equal(Invest.realized(v).positions.find(p => p.isin === 'US0378331005').soldQty, 2);
  // Opnieuw ophalen bij Saxo vervangt enkel de Saxo-posities
  const again = Invest.mergeInvestments(s.investments, Object.assign(normalized(), { positions: [] }), 'saxo-api', '2026-10-15');
  assert.equal(Invest.view(again).positions.length, 1);
  assert.equal(Invest.view(again).positions[0].name, 'KBC Groep');
  // Eén broker wissen: terug naar het gewone formaat
  const onlyDegiro = Invest.removeBroker(s.investments, 'saxo');
  assert.ok(!onlyDegiro.brokers);
  assert.equal(onlyDegiro.positions.length, 1);
  assert.ok(onlyDegiro.market, 'koersen blijven');
  assert.ok(Invest.removeBroker(onlyDegiro, 'degiro').cleared);
});

test('overschrijvingen naar Saxo zijn een belegging', () => {
  assert.equal(Store.defaultState().settings.investPattern, 'degiro|flatex|saxo');
  const old = Store.migrate({ version: Store.VERSION, settings: { investPattern: 'degiro|flatex' }, transactions: [] });
  assert.equal(old.settings.investPattern, 'degiro|flatex|saxo');
  const own = Store.migrate({ version: Store.VERSION, settings: { investPattern: 'bolero' }, transactions: [] });
  assert.equal(own.settings.investPattern, 'bolero', 'een eigen patroon blijft');
  assert.ok(C);
});

// ---------- Op de server (Node en PHP) ----------

function freePort() {
  return new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function startNode(dir, fake) {
  Object.assign(process.env, { FLUX_DATA_DIR: dir, FLUX_SAXO_AUTH_URL: fake + '/auth', FLUX_SAXO_API_URL: fake + '/openapi', FLUX_USERNAME: 'tester', FLUX_PASSWORD: 'heel-geheim-1' });
  delete require.cache[require.resolve('../server/server.js')];
  const { createServer, initSetup } = require('../server/server.js');
  await initSetup();
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: 'http://127.0.0.1:' + server.address().port, stop: () => server.close() };
}

async function startPhp(dir, fake) {
  const port = await freePort();
  const env = Object.assign({}, process.env, { FLUX_DATA_DIR: dir, FLUX_SAXO_AUTH_URL: fake + '/auth', FLUX_SAXO_API_URL: fake + '/openapi', FLUX_USERNAME: 'tester', FLUX_PASSWORD: 'heel-geheim-1', HELDER_CONFIG: path.join(dir, 'geen.php') });
  const proc = spawn('php', ['-S', '127.0.0.1:' + port, path.join(__dirname, '..', 'php', 'router.php')], { env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { try { await fetch(base + '/api/session'); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); } }
  return { base, stop: () => proc.kill() };
}

const hasPhp = spawnSync('php', ['-v']).status === 0;

for (const [name, start] of [['node', startNode], ['php', startPhp]]) {
  test(`${name}: Saxo instellen, aanmelden, ophalen, vernieuwen en loskoppelen`, { skip: name === 'php' && !hasPhp ? 'php niet geïnstalleerd' : false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helder-saxo-' + name + '-'));
    const sx = await Fake.start({ expiresIn: 1 });
    const srv = await start(dir, sx.base);
    const call = async (method, p, body, cookie) => {
      const res = await fetch(srv.base + p, { method, redirect: 'manual', headers: Object.assign({ 'Content-Type': 'application/json', 'X-Flux': '1' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
      return { status: res.status, json, text, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
    };
    try {
      const cookie = (await call('POST', '/api/login', { username: 'tester', password: 'heel-geheim-1' })).cookie;
      assert.equal((await call('GET', '/api/saxo/status')).status, 401, 'enkel aangemeld');
      const ses = await call('GET', '/api/session', null, cookie);
      assert.equal(ses.json.features.saxo, true, 'de eigenaar mag Saxo koppelen');

      let st = await call('GET', '/api/saxo/status', null, cookie);
      assert.deepEqual([st.json.configured, st.json.connected], [false, false]);
      assert.match(st.json.redirectUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/saxo\/callback$/);
      assert.equal((await call('POST', '/api/saxo/connect', {}, cookie)).status, 400, 'eerst instellen');
      assert.equal((await call('POST', '/api/saxo/config', { appKey: 'kort', appSecret: Fake.APP_SECRET }, cookie)).status, 400);
      const ok = await call('POST', '/api/saxo/config', { appKey: Fake.APP_KEY, appSecret: Fake.APP_SECRET, env: 'live' }, cookie);
      assert.equal(ok.status, 200, ok.text);
      st = await call('GET', '/api/saxo/status', null, cookie);
      assert.equal(st.json.configured, true);
      assert.ok(!st.text.includes(Fake.APP_SECRET), 'het geheim gaat nooit terug naar de browser');

      // Aanmelden bij Saxo (zonder cookie terug, zoals vanuit Safari)
      const con = await call('POST', '/api/saxo/connect', {}, cookie);
      assert.equal(con.status, 200, con.text);
      const u = new URL(con.json.url);
      assert.equal(u.searchParams.get('client_id'), Fake.APP_KEY);
      assert.equal(u.searchParams.get('response_type'), 'code');
      assert.equal(u.searchParams.get('redirect_uri'), st.json.redirectUrl);
      const login = await fetch(con.json.url, { redirect: 'manual' });
      const back = new URL(login.headers.get('location'));
      const cb = await call('GET', back.pathname + back.search);
      assert.equal(cb.status, 200, cb.text);
      assert.match(cb.text, /Saxo Bank is gekoppeld/);
      assert.match(cb.text, /saxo=1#invest/);
      assert.equal((await call('GET', back.pathname + back.search)).status, 400, 'eenmalige link');
      st = await call('GET', '/api/saxo/status', null, cookie);
      assert.deepEqual([st.json.connected, st.json.expired], [true, false]);
      assert.ok(!st.text.includes('REFRESH-'), 'tokens blijven op de server');

      // Ophalen: de korte toegangssleutel wordt vernieuwd, alle pagina's, ISIN-codes erbij
      const f = await call('POST', '/api/saxo/fetch', {}, cookie);
      assert.equal(f.status, 200, f.text);
      assert.equal(f.json.positions.length, 2);
      assert.equal(f.json.cashEur, 123456);
      assert.equal(f.json.trades.length, 3);
      assert.equal(f.json.movements.length, 7);
      assert.equal(f.json.currency, 'EUR');
      assert.equal(f.json.partial, false);
      assert.deepEqual(f.json.positions.map(p => p.isin), ['US0378331005', 'IE00B4L5Y983']);
      assert.deepEqual(f.json, Object.assign(normalized(), { currency: 'EUR', partial: false }), 'zelfde resultaat als de omzetting in Node');
      assert.ok(sx.calls.some(c => c.path === '/auth/token' && /grant_type=refresh_token/.test(c.body)), 'toegangssleutel vernieuwd');
      assert.ok(sx.calls.some(c => c.query.$skip === '2'), 'volgende pagina gevolgd');
      assert.equal(sx.calls.filter(c => c.method !== 'GET' && c.path.startsWith('/openapi')).length, 0, 'Helder leest enkel');

      // Saxo trekt de toegang in: duidelijke melding om opnieuw aan te melden
      sx.expireAccess();
      const tokenFile = path.join(dir, 'saxo-' + Buffer.from('tester').toString('hex') + '.json');
      const t = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      t.accessExpires = Date.now() + 600000;
      fs.writeFileSync(tokenFile, JSON.stringify(t));
      const exp = await call('POST', '/api/saxo/fetch', {}, cookie);
      assert.equal(exp.status, 401);
      assert.equal(exp.json.code, 'expired');
      // Vernieuwingssleutel verlopen
      t.accessExpires = 0; t.refreshExpires = Date.now() - 1000;
      fs.writeFileSync(tokenFile, JSON.stringify(t));
      assert.equal((await call('GET', '/api/saxo/status', null, cookie)).json.expired, true);
      assert.equal((await call('POST', '/api/saxo/fetch', {}, cookie)).json.code, 'expired');

      // Loskoppelen en instelling verwijderen
      assert.equal((await call('POST', '/api/saxo/disconnect', {}, cookie)).status, 200);
      assert.ok(!fs.existsSync(tokenFile));
      assert.equal((await call('GET', '/api/saxo/status', null, cookie)).json.connected, false);
      await call('POST', '/api/saxo/config', { remove: true }, cookie);
      assert.equal((await call('GET', '/api/saxo/status', null, cookie)).json.configured, false);
    } finally {
      srv.stop(); sx.stop();
      fs.rmSync(dir, { recursive: true, force: true });
      delete process.env.FLUX_SAXO_AUTH_URL; delete process.env.FLUX_SAXO_API_URL;
    }
  });
}
