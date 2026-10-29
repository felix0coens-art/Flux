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
const GOOD_KEY = 'sk-ant-api03-' + 'a'.repeat(40);

/** Nagebootst Google-tokenendpoint: geeft een ID-token met de nonce die Helder meegaf. */
function fakeGoogle() {
  const codes = {};
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      // Nagebootste Anthropic-API om een eigen API-sleutel te controleren
      if (req.url.startsWith('/v1/models')) { res.writeHead(req.headers['x-api-key'] === GOOD_KEY ? 200 : 401, { 'Content-Type': 'application/json' }); return res.end('{"data":[]}'); }
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
  FLUX_GOOGLE_CLIENT_ID: CLIENT_ID, FLUX_GOOGLE_CLIENT_SECRET: 'geheim', FLUX_GOOGLE_TOKEN_URL: tokenUrl, ANTHROPIC_BASE_URL: tokenUrl.replace(/\/token$/, ''), ANTHROPIC_API_KEY: '' });

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
      const startRes = await call('GET', '/api/auth/google' + (opts && opts.link ? '?link=1' : ''), null, opts && opts.cookie);
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
      assert.deepEqual(s0.json.auth, { google: true, registration: 'closed', signupGoogle: false, signupPassword: false });

      assert.equal((await call('POST', '/api/register', { username: 'vroeg', password: 'vroeg-geheim-1' })).status, 403, 'registratie gesloten');
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
      assert.equal(me.json.features.bank, true, 'bankkoppeling voor iedereen, met een eigen Enable Banking-app');
      assert.equal(me.json.features.saxo, true);
      assert.equal((await call('GET', '/api/bank/status', null, an)).json.configured, false);
      // De app van de eigenaar is niet zomaar voor iedereen; enkel als de beheerder ze deelt
      fs.writeFileSync(path.join(dir, 'enablebanking.json'), JSON.stringify({ appId: 'eigenaar-app-1234', privateKey: '-----BEGIN PRIVATE KEY-----x' }));
      assert.equal((await call('GET', '/api/bank/status', null, an)).json.configured, false);
      await call('POST', '/api/admin/site', { bankShared: true }, ac);
      const shared = (await call('GET', '/api/bank/status', null, an)).json;
      assert.deepEqual([shared.configured, shared.shared], [true, true], 'gedeelde app van deze Helder');
      await call('POST', '/api/admin/site', { bankShared: false }, ac);
      // Eigen Saxo-app: enkel voor An, niet voor de eigenaar
      assert.equal((await call('POST', '/api/saxo/config', { appKey: 'b'.repeat(32), appSecret: 'c'.repeat(32), env: 'sim' }, an)).status, 200);
      assert.equal((await call('GET', '/api/saxo/status', null, an)).json.configured, true);
      // Eigen Anthropic API-sleutel
      assert.equal((await call('GET', '/api/ai/key', null, an)).json.set, false);
      assert.equal((await call('POST', '/api/ai/key', { apiKey: 'geen-sleutel' }, an)).status, 400);
      assert.equal((await call('POST', '/api/ai/key', { apiKey: 'sk-ant-api03-' + 'z'.repeat(40) }, an)).status, 400, 'Anthropic weigert de sleutel');
      const setKey = await call('POST', '/api/ai/key', { apiKey: GOOD_KEY }, an);
      assert.equal(setKey.status, 200, setKey.text);
      assert.deepEqual(setKey.json, { set: true, hint: 'aaaa' });
      const keyStatus = await call('GET', '/api/ai/key', null, an);
      assert.equal(keyStatus.json.set, true);
      assert.ok(!keyStatus.text.includes(GOOD_KEY), 'de sleutel gaat nooit terug naar de browser');
      assert.equal((await call('GET', '/api/session', null, an)).json.features.aiOwnKey, true);
      assert.ok(fs.readFileSync(path.join(dir, 'keys-' + Buffer.from('g_1001').toString('hex') + '.json'), 'utf8').includes(GOOD_KEY));
      assert.equal((await call('POST', '/api/ai/key', { remove: true }, an)).json.set, false);
      // An heeft een eigen, aparte boekhouding
      const st = Store.defaultState();
      st.transactions.push({ id: 'an1', accountId: 'acc_cash', date: '2026-10-01', amount: -500, counterparty: 'Bakker', splits: [], source: 'manual' });
      const keys = C.stampChanges(null, st);
      assert.equal((await call('POST', '/api/sync', { changes: C.extractChanges(st, keys), rev: 0, schema: Store.VERSION }, an)).status, 200);
      const owner = await call('POST', '/api/login', { username: 'eigenaar', password: 'heel-geheim-1' });
      assert.equal(owner.json.role, 'owner');
      assert.equal((await call('GET', '/api/data', null, owner.cookie)).json.state, null, 'de eigenaar ziet de gegevens van An niet');

      // De eigenaar koppelt zijn bestaande account aan Google en kan daarna ook zo aanmelden
      assert.equal((await call('GET', '/api/auth/google?link=1')).headers.get('location'), '/#settings', 'koppelen enkel als je aangemeld bent');
      const taken = await googleLogin({ sub: '1001', email: 'an@example.com', name: 'An Peeters' }, { link: true, cookie: owner.cookie });
      assert.equal(taken.status, 400, 'een Google-account met een eigen Helder-account kan niet');
      assert.match(taken.text, /al een eigen Helder-account/);
      const linked = await googleLogin({ sub: '2001', email: 'felix@example.com', name: 'Felix' }, { link: true, cookie: owner.cookie });
      assert.equal(linked.status, 302, linked.text);
      assert.equal(linked.headers.get('location'), '/?google=gekoppeld#settings');
      const ownerMe = await call('GET', '/api/session', null, owner.cookie);
      assert.equal(ownerMe.json.role, 'owner', 'blijft eigenaar');
      assert.equal(ownerMe.json.googleLinked, 'felix@example.com');
      const viaGoogle = await googleLogin({ sub: '2001', email: 'felix@example.com', name: 'Felix' });
      assert.equal(viaGoogle.status, 302);
      const vg = await call('GET', '/api/session', null, viaGoogle.cookie);
      assert.deepEqual([vg.json.user, vg.json.role], ['eigenaar', 'owner'], 'met Google in hetzelfde account');
      assert.equal((await call('POST', '/api/login', { username: 'eigenaar', password: 'heel-geheim-1' })).status, 200, 'wachtwoord werkt nog');
      assert.equal((await call('POST', '/api/account/google-unlink', {}, owner.cookie)).status, 200);
      assert.equal((await call('GET', '/api/session', null, owner.cookie)).json.googleLinked, null);

      // Tweede keer aanmelden: hetzelfde account, geen welkom
      const again = await googleLogin({ sub: '1001', email: 'an@example.com', name: 'An Peeters' });
      assert.equal(again.headers.get('location'), '/');
      // Vervalste nonce wordt geweigerd
      const bad = await googleLogin({ sub: '1002', email: 'x@example.com', name: 'X' }, { nonce: 'verzonnen' });
      assert.equal(bad.status, 400);
      // Hergebruik van de state mag niet
      assert.equal((await call('GET', '/api/auth/google/callback?code=x&state=verzonnen')).status, 400);

      // De beheerder zet nieuwe accounts per manier uit (en weer aan)
      const offPw = await call('POST', '/api/admin/site', { signupPassword: false }, ac);
      assert.deepEqual(offPw.json, { registration: 'open', signupGoogle: true, signupPassword: false, bankShared: false }, 'enkel de gevraagde instelling wijzigt');
      assert.deepEqual((await call('GET', '/api/session')).json.auth, { google: true, registration: 'open', signupGoogle: true, signupPassword: false });
      assert.equal((await call('POST', '/api/register', { username: 'dirk', password: 'dirk-geheim-1' })).status, 403, 'zonder Google kan niet meer');
      await call('POST', '/api/admin/site', { signupPassword: true, signupGoogle: false }, ac);
      const noG = await googleLogin({ sub: '1004', email: 'nieuw@example.com', name: 'Nieuw' });
      assert.equal(noG.status, 400, 'nieuwe Google-accounts staan uit');
      assert.equal((await googleLogin({ sub: '1001', email: 'an@example.com', name: 'An Peeters' })).status, 302, 'bestaande Google-gebruikers kunnen wel nog aanmelden');
      assert.equal((await call('POST', '/api/admin/site', { signupGoogle: true }, ac)).json.signupGoogle, true);
      assert.equal((await call('POST', '/api/admin/site', { signupGoogle: true }, an)).status, 403, 'enkel de beheerder');

      // Zonder Google: zelf een account met gebruikersnaam en wachtwoord
      const reg = await call('POST', '/api/register', { username: 'carla', password: 'carla-geheim-1', displayName: 'Carla V.' });
      assert.equal(reg.status, 200, reg.text);
      assert.equal(reg.json.role, 'member');
      assert.equal(reg.json.displayName, 'Carla V.');
      assert.equal((await call('POST', '/api/register', { username: 'CARLA', password: 'nog-een-wachtwoord' })).status, 409, 'naam al in gebruik (hoofdletters tellen niet)');
      assert.equal((await call('POST', '/api/register', { username: 'g_123', password: 'nog-een-wachtwoord' })).status, 400);
      assert.equal((await call('POST', '/api/register', { username: 'kort', password: '123' })).status, 400);
      assert.equal((await call('GET', '/api/bank/status', null, reg.cookie)).json.configured, false, 'ook bankkoppeling, met een eigen app');
      const carla = await call('POST', '/api/login', { username: 'carla', password: 'carla-geheim-1' });
      assert.equal(carla.json.role, 'member');
      assert.equal((await call('POST', '/api/password', { current: 'carla-geheim-1', password: 'carla-nieuw-22' }, carla.cookie)).status, 200);
      // Een nieuw wachtwoord verandert niets anders aan het account (rol, naam, ...)
      const after = (await call('GET', '/api/session', null, carla.cookie)).json;
      assert.deepEqual([after.role, after.displayName], ['member', 'Carla V.']);
      assert.equal((await call('POST', '/api/login', { username: 'carla', password: 'carla-nieuw-22' })).json.role, 'member');

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
      assert.equal(anRow.logins, 3);
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
