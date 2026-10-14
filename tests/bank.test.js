'use strict';
/*
 * Bankkoppeling via Enable Banking: dezelfde tests tegen de Node- en de PHP-server, met een
 * nagebootste Enable Banking-API, plus het omzetten en ontdubbelen van transacties in de app.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const C = require('../js/core.js');
const Store = require('../js/store.js');
const Banks = require('../js/banks.js');
const Fake = require('./fake-enablebanking.js');

const APP_ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const keys = Fake.makeKeys();

// ---------- In de app: omzetten en ontdubbelen ----------

test('bankkoppeling: PSD2-transacties omzetten naar Helder', () => {
  const rows = Fake.sampleTransactions().map(Banks.fromEnableBanking);
  assert.equal(rows[3], null, 'nog niet geboekte transacties worden overgeslagen');
  assert.deepEqual(rows[0], { date: '2026-10-01', amount: -4520, counterparty: 'COLRUYT GENT', counterpartyIban: '', description: 'Betaling Bancontact COLRUYT GENT 01/10', bankRef: 'eb:E1', balanceAfter: null });
  assert.equal(rows[1].amount, 250000);
  assert.equal(rows[1].counterparty, 'WERKGEVER NV');
  assert.equal(rows[1].counterpartyIban, 'BE71096123456769');
  assert.equal(rows[4].bankRef, null, 'zonder referentie van de bank');
  assert.equal(Banks.fromEnableBanking({ transaction_amount: { amount: '-7.5' }, booking_date: '2026-10-08' }).amount, -750, 'teken uit het bedrag als de richting ontbreekt');
  const bal = Banks.balanceFromEnableBanking([{ balance_type: 'ITAV', balance_amount: { amount: '1500.00' }, reference_date: '2026-10-14' }, { balance_type: 'CLBD', balance_amount: { amount: '1234.56' }, reference_date: '2026-10-13' }], '2026-10-14');
  assert.deepEqual(bal, { date: '2026-10-13', amount: 123456 }, 'afgesloten geboekt saldo heeft voorrang');
});

test('bankkoppeling: geen dubbels met CSV-bestanden of een vorige keer ophalen', () => {
  const s = Store.defaultState();
  s.accounts.push({ id: 'k', name: 'KBC', iban: 'BE68539007547034', type: 'zicht' });
  // Eerst een CSV met de Colruyt-betaling (1 dag andere datum) en een bakker
  s.transactions.push(
    { id: 'csv1', accountId: 'k', date: '2026-10-02', amount: -4520, counterparty: 'COLRUYT', description: '', source: 'import', importId: 'i1', bankRef: 'KBC-REF-1' },
    { id: 'csv2', accountId: 'k', date: '2026-10-07', amount: -350, counterparty: 'BAKKERIJ', description: '', source: 'import', importId: 'i1' }
  );
  const rows = Fake.sampleTransactions().map(Banks.fromEnableBanking).filter(Boolean);
  const p1 = Banks.planLinked(s, 'k', rows);
  assert.deepEqual(p1.fresh.map(t => t.bankRef), ['eb:E2', 'eb:E3'], 'Colruyt en bakker zaten al in Helder via CSV');
  const imp = Banks.applyLinked(s, 'k', p1, { bankName: 'KBC', balance: { date: '2026-10-13', amount: 123456 } }, Date.parse('2026-10-14T10:00:00Z'));
  assert.equal(imp.bank, 'bankkoppeling');
  assert.match(imp.fileName, /^Bankkoppeling KBC · \d\d\/\d\d\/2026$/);
  assert.equal(s.accounts.find(a => a.id === 'k').balance.amount, 123456);
  // Opnieuw ophalen (overlappende periode): niets nieuws
  const p2 = Banks.planLinked(s, 'k', rows);
  assert.equal(p2.fresh.length, 0);
  assert.equal(Banks.applyLinked(s, 'k', p2, { bankName: 'KBC' }), null, 'geen lege import');
  // Twee identieke koffies op dezelfde dag zijn twee transacties
  const coffee = { date: '2026-10-09', amount: -250, counterparty: 'Koffie', description: '', bankRef: null, balanceAfter: null };
  assert.equal(Banks.planLinked(s, 'k', [coffee, Object.assign({}, coffee)]).fresh.length, 2);
  // Later toch een CSV-bestand opladen met dezelfde periode: wat via de koppeling binnenkwam, wordt herkend
  const csv = { profile: { id: 'kbc', name: 'KBC' }, transactions: [
    { date: '2026-10-02', amount: 250000, counterparty: 'WERKGEVER NV', description: 'Loon', bankRef: 'KBC-REF-2', balanceAfter: null },
    { date: '2026-10-05', amount: -1299, counterparty: 'NETFLIX', description: '', bankRef: 'KBC-REF-3', balanceAfter: null },
    { date: '2026-10-11', amount: -800, counterparty: 'NIEUW', description: '', bankRef: 'KBC-REF-4', balanceAfter: null }
  ], errors: [], period: null, balance: null };
  const p3 = Banks.plan(s, csv, 'k', 'csv-tekst', 'kbc.csv');
  assert.deepEqual(p3.fresh.map(t => t.counterparty), ['NIEUW']);
  assert.equal(p3.duplicates.length, 2);
});

// ---------- Op de server (Node en PHP) ----------

function freePort() {
  return new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function startNode(dir, ebBase) {
  process.env.FLUX_DATA_DIR = dir;
  process.env.FLUX_EB_BASE_URL = ebBase;
  process.env.FLUX_USERNAME = 'tester';
  process.env.FLUX_PASSWORD = 'heel-geheim-1';
  delete require.cache[require.resolve('../server/server.js')];
  const { createServer, initSetup } = require('../server/server.js');
  await initSetup();
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: 'http://127.0.0.1:' + server.address().port, stop: () => server.close() };
}

async function startPhp(dir, ebBase) {
  const port = await freePort();
  const env = Object.assign({}, process.env, { FLUX_DATA_DIR: dir, FLUX_EB_BASE_URL: ebBase, FLUX_USERNAME: 'tester', FLUX_PASSWORD: 'heel-geheim-1', HELDER_CONFIG: path.join(dir, 'geen.php') });
  const proc = spawn('php', ['-S', '127.0.0.1:' + port, path.join(__dirname, '..', 'php', 'router.php')], { env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { try { await fetch(base + '/api/session'); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); } }
  return { base, stop: () => proc.kill() };
}

const hasPhp = spawnSync('php', ['-v']).status === 0;

for (const [name, start] of [['node', startNode], ['php', startPhp]]) {
  test(`${name}: bankkoppeling instellen, bank koppelen, transacties ophalen en verbreken`, { skip: name === 'php' && !hasPhp ? 'php niet geïnstalleerd' : false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helder-bank-' + name + '-'));
    const eb = await Fake.start({ publicKey: keys.publicKey, appId: APP_ID, transactions: { list: Fake.sampleTransactions() }, maxHistoryDays: 400 });
    const srv = await start(dir, eb.base);
    const call = async (method, p, body, cookie, headers) => {
      const res = await fetch(srv.base + p, { method, redirect: 'manual', headers: Object.assign({ 'Content-Type': 'application/json', 'X-Flux': '1', 'User-Agent': 'HelderTest/1.0' }, cookie ? { Cookie: cookie } : {}, headers || {}), body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
      return { status: res.status, json, text, cookie: (res.headers.get('set-cookie') || '').split(';')[0], headers: res.headers };
    };
    try {
      const login = await call('POST', '/api/login', { username: 'tester', password: 'heel-geheim-1' });
      const cookie = login.cookie;
      assert.equal((await call('GET', '/api/bank/status')).status, 401, 'enkel aangemeld');

      let st = await call('GET', '/api/bank/status', null, cookie);
      assert.equal(st.json.configured, false);
      assert.match(st.json.redirectUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/bank\/callback$/);

      // Instellen: foute sleutel, foute app-ID, dan correct
      assert.equal((await call('POST', '/api/bank/config', { appId: APP_ID, privateKey: 'geen sleutel' }, cookie)).status, 400);
      const other = Fake.makeKeys();
      const wrong = await call('POST', '/api/bank/config', { appId: APP_ID, privateKey: other.privatePem }, cookie);
      assert.equal(wrong.status, 400, 'verkeerde sleutel wordt geweigerd door Enable Banking');
      assert.equal(wrong.json.code, 'config');
      const ok = await call('POST', '/api/bank/config', { appId: APP_ID, privateKey: keys.privatePem }, cookie);
      assert.equal(ok.status, 200, ok.text);
      assert.equal(ok.json.appName, 'Helder test');
      st = await call('GET', '/api/bank/status', null, cookie);
      assert.equal(st.json.configured, true);
      assert.ok(!st.text.includes('PRIVATE KEY'), 'de sleutel gaat nooit terug naar de browser');
      assert.ok(fs.existsSync(path.join(dir, 'enablebanking.json')), 'sleutel in de gegevensmap');

      const asp = await call('GET', '/api/bank/aspsps?country=BE', null, cookie);
      assert.deepEqual(asp.json.aspsps.map(a => a.name), ['Argenta', 'Belfius', 'KBC'], 'enkel banken voor particulieren, alfabetisch');
      assert.equal(asp.json.aspsps.find(a => a.name === 'KBC').maxDays, 180);

      // Koppelen: Helder geeft de link naar de bank
      const con = await call('POST', '/api/bank/connect', { aspsp: 'KBC', country: 'BE', maxDays: 180 }, cookie);
      assert.equal(con.status, 200, con.text);
      const authCall = eb.calls.find(c => c.path === '/auth');
      assert.equal(authCall.body.aspsp.name, 'KBC');
      assert.equal(authCall.body.psu_type, 'personal');
      assert.equal(authCall.body.redirect_url, st.json.redirectUrl);
      const days = (Date.parse(authCall.body.access.valid_until) - Date.now()) / 86400000;
      assert.ok(days > 179 && days < 180, 'toestemming voor 180 dagen');
      // De bank stuurt terug naar Helder (zonder cookie, zoals vanuit Safari op een iPhone)
      const bankRes = await fetch(con.json.url, { redirect: 'manual' });
      const back = new URL(bankRes.headers.get('location'));
      const cb = await call('GET', back.pathname + back.search);
      assert.equal(cb.status, 200, cb.text);
      assert.match(cb.text, /KBC is gekoppeld \(1 rekening\)/);
      assert.match(cb.headers.get('content-type'), /text\/html/);
      // Dezelfde link een tweede keer gebruiken mag niet
      const again = await call('GET', back.pathname + back.search);
      assert.equal(again.status, 400);
      assert.match(again.text, /verlopen of al gebruikt/);
      assert.equal((await call('GET', '/api/bank/callback?state=verzonnen&code=x')).status, 400);

      st = await call('GET', '/api/bank/status', null, cookie);
      assert.equal(st.json.connections.length, 1);
      const conn = st.json.connections[0];
      assert.equal(conn.aspsp, 'KBC');
      assert.deepEqual(conn.accounts.map(a => a.iban), ['BE68539007547034']);

      // Ophalen: alle pagina's, met PSU-headers (gebruiker aanwezig), plus saldo
      const f = await call('POST', '/api/bank/fetch', { connectionId: conn.id, accountUid: conn.accounts[0].uid, dateFrom: '2026-01-01' }, cookie);
      assert.equal(f.status, 200, f.text);
      assert.equal(f.json.transactions.length, 5);
      assert.equal(f.json.limited, false);
      assert.equal(f.json.balances.length, 2);
      const txCalls = eb.calls.filter(c => c.path.endsWith('/transactions'));
      assert.deepEqual(txCalls.map(c => c.query.continuation_key || ''), ['', '1', '2'], 'alle pagina’s opgehaald');
      assert.equal(txCalls[0].headers['psu-user-agent'], 'HelderTest/1.0');
      assert.ok(txCalls[0].headers['psu-ip-address']);
      assert.equal(eb.calls.filter(c => !c.jwtOk).length, 1, 'elke oproep correct ondertekend, behalve de test met de verkeerde sleutel');

      // Te ver terug: automatisch de laatste 90 dagen
      const far = await call('POST', '/api/bank/fetch', { connectionId: conn.id, accountUid: conn.accounts[0].uid, dateFrom: '2020-01-01' }, cookie);
      assert.equal(far.status, 200, far.text);
      assert.equal(far.json.limited, true);

      assert.equal((await call('POST', '/api/bank/fetch', { connectionId: conn.id, accountUid: 'andere', dateFrom: '2026-01-01' }, cookie)).status, 404, 'enkel eigen rekeningen');
      assert.equal((await call('POST', '/api/bank/fetch', { connectionId: 'verzonnen', accountUid: 'x' }, cookie)).status, 404);

      // Verbreken
      assert.equal((await call('POST', '/api/bank/disconnect', { connectionId: conn.id }, cookie)).status, 200);
      assert.ok(eb.calls.some(c => c.method === 'DELETE' && c.path === '/sessions/' + conn.id), 'toestemming ook bij Enable Banking ingetrokken');
      st = await call('GET', '/api/bank/status', null, cookie);
      assert.equal(st.json.connections.length, 0);

      // Instelling verwijderen
      await call('POST', '/api/bank/config', { remove: true }, cookie);
      assert.equal((await call('GET', '/api/bank/status', null, cookie)).json.configured, false);
    } finally {
      srv.stop(); eb.stop();
      fs.rmSync(dir, { recursive: true, force: true });
      delete process.env.FLUX_EB_BASE_URL;
    }
  });
}
