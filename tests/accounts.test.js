'use strict';
/*
 * Publieke Helder: aanmelden met Google (nagebootst), registratie open/dicht, en het beheerdersaccount.
 * Dezelfde tests tegen de Node- en de PHP-server.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const Store = require('../js/store.js');
const C = require('../js/core.js');

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

/** Nagebootst Google-tokenendpoint: geeft een ID-token met de nonce die Helder meegaf. */
function fakeGoogle() {
  const codes = {};
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const p = new URLSearchParams(body);
      const c = codes[p.get('code')];
      if (!c || p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== 'geheim' || p.get('grant_type') !== 'authorization_code') { res.writeHead(400); return res.end('{"error":"invalid_grant"}'); }
      const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      const claims = Object.assign({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true }, c);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'x', id_token: b64({ alg: 'RS256' }) + '.' + b64(claims) + '.handtekening' }));
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: 'http://127.0.0.1:' + server.address().port + '/token', codes, stop: () => server.close() })));
}

function freePort() {
  return new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

const ENV = tokenUrl => ({ FLUX_USERNAME: 'eigenaar', FLUX_PASSWORD: 'heel-geheim-1', FLUX_ADMIN_USERNAME: 'beheer', FLUX_ADMIN_PASSWORD: 'beheer-geheim-9',
  FLUX_GOOGLE_CLIENT_ID: CLIENT_ID, FLUX_GOOGLE_CLIENT_SECRET: 'geheim', FLUX_GOOGLE_TOKEN_URL: tokenUrl });

async function startNode(dir, tokenUrl) {
  Object.assign(process.env, ENV(tokenUrl), { FLUX_DATA_DIR: dir });
  delete require.cache[require.resolve('../server/server.js')];
  delete require.cache[require.resolve('../server/accounts.js')];
  const { createServer, initSetup } = require('../server/server.js');
  await initSetup();
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: 'http://127.0.0.1:' + server.address().port, stop: () => { server.close(); for (const k of Object.keys(ENV(''))) delete process.env[k]; } };
}

async function startPhp(dir, tokenUrl) {
  const port = await freePort();
  const env = Object.assign({}, process.env, ENV(tokenUrl), { FLUX_DATA_DIR: dir, HELDER_CONFIG: path.join(dir, 'geen.php') });
  const proc = spawn('php', ['-S', '127.0.0.1:' + port, path.join(__dirname, '..', 'php', 'router.php')], { env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { try { await fetch(base + '/api/session'); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); } }
  return { base, stop: () => proc.kill() };
}

const hasPhp = spawnSync('php', ['-v']).status === 0;

for (const [name, start] of [['node', startNode], ['php', startPhp]]) {
  test(`${name}: aanmelden met Google, registratie en beheerder`, { skip: name === 'php' && !hasPhp ? 'php niet geïnstalleerd' : false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helder-acc-' + name + '-'));
    const g = await fakeGoogle();
    const srv = await start(dir, g.url);
    const call = async (method, p, body, cookie) => {
      const res = await fetch(srv.base + p, { method, redirect: 'manual', headers: Object.assign({ 'Content-Type': 'application/json', 'X-Flux': '1', 'User-Agent': 'Mozilla/5.0 (iPhone) Safari/605' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
      return { status: res.status, json, text, cookie: (res.headers.get('set-cookie') || '').split(';')[0], headers: res.headers };
    };
    /** Volledige Google-aanmelding: Helder → Google (nagebootst) → terug naar Helder. */
    const googleLogin = async (profile, opts) => {
      const startRes = await call('GET', '/api/auth/google');
      assert.equal(startRes.status, 302);
      const to = new URL(startRes.headers.get('location'));
      assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
      assert.equal(to.searchParams.get('client_id'), CLIENT_ID);
      assert.equal(to.searchParams.get('scope'), 'openid email profile');
      assert.match(to.searchParams.get('redirect_uri'), /\/api\/auth\/google\/callback$/);
      const code = 'code-' + Math.random().toString(36).slice(2);
      g.codes[code] = Object.assign({ nonce: (opts && opts.nonce) || to.searchParams.get('nonce') }, profile);
      return call('GET', '/api/auth/google/callback?code=' + code + '&state=' + encodeURIComponent(to.searchParams.get('state')));
    };
    try {
      const s0 = await call('GET', '/api/session');
      assert.deepEqual(s0.json.auth, { google: true, registration: 'closed' });

      // Registratie gesloten: een nieuwe Google-gebruiker kan niet binnen
      const closed = await googleLogin({ sub: '1001', email: 'an@example.com', name: 'An Peeters' });
      assert.equal(closed.status, 400);
      assert.match(closed.text, /niet aangemaakt/);

      // De beheerder (uit de instellingen) meldt aan en zet registratie open
      const adm = await call('POST', '/api/login', { username: 'beheer', password: 'beheer-geheim-9' });
      assert.equal(adm.status, 200, adm.text);
      assert.equal(adm.json.role, 'admin');
      const ac = adm.cookie;
      assert.equal((await call('POST', '/api/sync', { changes: null, rev: 0, schema: Store.VERSION }, ac)).status, 403, 'beheerder heeft geen boekhouding');
      assert.equal((await call('POST', '/api/admin/site', { registrationOpen: true }, ac)).json.registration, 'open');

      // Nu kan An een account aanmaken met Google
      const ok = await googleLogin({ sub: '1001', email: 'an@example.com', name: 'An Peeters', picture: 'https://example.com/a.png' });
      assert.equal(ok.status, 302, ok.text);
      assert.equal(ok.headers.get('location'), '/?welkom=1');
      assert.match(ok.headers.get('set-cookie'), /flux_session=.+HttpOnly/);
      const an = ok.cookie;
      const me = await call('GET', '/api/session', null, an);
      assert.equal(me.json.role, 'member');
      assert.equal(me.json.displayName, 'An Peeters');
      assert.equal(me.json.email, 'an@example.com');
      assert.equal(me.json.features.bank, false, 'bankkoppeling enkel voor de eigenaar');
      assert.equal((await call('GET', '/api/bank/status', null, an)).status, 403);
      // An heeft een eigen, aparte boekhouding
      const st = Store.defaultState();
      st.transactions.push({ id: 'an1', accountId: 'acc_cash', date: '2026-10-01', amount: -500, counterparty: 'Bakker', splits: [], source: 'manual' });
      const keys = C.stampChanges(null, st);
      assert.equal((await call('POST', '/api/sync', { changes: C.extractChanges(st, keys), rev: 0, schema: Store.VERSION }, an)).status, 200);
      const owner = await call('POST', '/api/login', { username: 'eigenaar', password: 'heel-geheim-1' });
      assert.equal(owner.json.role, 'owner');
      assert.equal((await call('GET', '/api/data', null, owner.cookie)).json.state, null, 'de eigenaar ziet de gegevens van An niet');

      // Tweede keer aanmelden: hetzelfde account, geen welkom
      const again = await googleLogin({ sub: '1001', email: 'an@example.com', name: 'An Peeters' });
      assert.equal(again.headers.get('location'), '/');
      // Vervalste nonce wordt geweigerd
      const bad = await googleLogin({ sub: '1002', email: 'x@example.com', name: 'X' }, { nonce: 'verzonnen' });
      assert.equal(bad.status, 400);
      // Hergebruik van de state mag niet
      assert.equal((await call('GET', '/api/auth/google/callback?code=x&state=verzonnen')).status, 400);

      // Bert maakt een account en verwijdert het zelf weer: alles meteen weg
      const bert = (await googleLogin({ sub: '1003', email: 'bert@example.com', name: 'Bert' })).cookie;
      assert.equal((await call('POST', '/api/sync', { changes: C.extractChanges(st, keys), rev: 0, schema: Store.VERSION }, bert)).status, 200);
      const bertFile = path.join(dir, 'user-' + Buffer.from('g_1003').toString('hex') + '.json');
      assert.ok(fs.existsSync(bertFile));
      assert.equal((await call('POST', '/api/account/delete', { confirm: 'ja' }, bert)).status, 400, 'bevestiging nodig');
      assert.equal((await call('POST', '/api/account/delete', { confirm: 'VERWIJDER' }, owner.cookie)).status, 400, 'eigenaar niet via deze weg');
      const del = await call('POST', '/api/account/delete', { confirm: 'VERWIJDER' }, bert);
      assert.equal(del.status, 200);
      assert.ok(!fs.existsSync(bertFile), 'gegevens gewist');
      assert.ok(!(fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')) : []).some(f => f.startsWith('user-' + Buffer.from('g_1003').toString('hex'))), 'ook geen back-ups meer');
      assert.equal((await call('GET', '/api/data', null, bert)).status, 401);

      // Overzicht voor de beheerder: gebruikers en aanmeldingen, zonder financiële gegevens
      const ov = await call('GET', '/api/admin/overview', null, ac);
      assert.equal(ov.status, 200);
      const anRow = ov.json.users.find(u => u.email === 'an@example.com');
      assert.equal(anRow.role, 'member');
      assert.equal(anRow.logins, 2);
      assert.equal(anRow.transactions, 1);
      assert.equal(anRow.ai, false, 'AI standaard uit voor Google-gebruikers');
      assert.ok(!ov.text.includes('Bakker'), 'geen transacties zichtbaar voor de beheerder');
      assert.ok(ov.json.logins.some(l => l.method === 'google' && l.ok && l.detail === 'nieuw account'));
      assert.ok(!ov.json.users.some(u => u.email === 'bert@example.com'), 'verwijderd account staat niet meer in de lijst');
      assert.ok(ov.json.logins.some(l => l.detail === 'account verwijderd door gebruiker'));
      assert.ok(ov.json.logins.some(l => l.method === 'google' && !l.ok));
      assert.ok(ov.json.logins.some(l => l.method === 'wachtwoord' && l.user === 'eigenaar' && l.ok));
      assert.match(ov.json.logins[0].ua, /iPhone/);
      assert.equal((await call('GET', '/api/admin/overview', null, an)).status, 403, 'enkel de beheerder');

      // Blokkeren: An wordt meteen afgemeld en kan niet meer aanmelden
      assert.equal((await call('POST', '/api/admin/user', { username: anRow.user, action: 'disable' }, ac)).status, 200);
      assert.equal((await call('GET', '/api/data', null, an)).status, 401);
      assert.equal((await googleLogin({ sub: '1001', email: 'an@example.com', name: 'An Peeters' })).status, 400);
      await call('POST', '/api/admin/user', { username: anRow.user, action: 'enable' }, ac);
      await call('POST', '/api/admin/user', { username: anRow.user, action: 'ai-on' }, ac);
      assert.equal((await call('GET', '/api/admin/overview', null, ac)).json.users.find(u => u.email === 'an@example.com').ai, true);
      assert.equal((await call('POST', '/api/admin/user', { username: 'eigenaar', action: 'delete' }, ac)).status, 400, 'eigenaar niet te verwijderen');
      assert.equal((await call('POST', '/api/admin/user', { username: 'beheer', action: 'disable' }, ac)).status, 400, 'zichzelf niet');
      assert.equal((await call('POST', '/api/admin/user', { username: anRow.user, action: 'delete' }, ac)).status, 200);
      assert.ok(!(await call('GET', '/api/admin/overview', null, ac)).json.users.some(u => u.email === 'an@example.com'));
      assert.ok(fs.readdirSync(path.join(dir, 'backups')).some(f => f.startsWith('verwijderd-')), 'gegevens als back-up bewaard');
    } finally {
      srv.stop(); g.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
