#!/usr/bin/env node
'use strict';
/*
 * Helder-server: serveert de app, beheert login en synchroniseert je gegevens tussen toestellen.
 * Geen database nodig: elke gebruiker heeft één JSON-bestand in de datamap.
 *
 * Omgevingsvariabelen:
 *   PORT                 poort (standaard 8080)
 *   FLUX_DATA_DIR        map voor gegevens (standaard ./data)
 *   FLUX_USERNAME        + FLUX_PASSWORD: maakt bij de eerste start meteen deze gebruiker aan
 *   FLUX_SECURE_COOKIES  "1" om cookies enkel via https te sturen (automatisch achter een https-proxy)
 *   ANTHROPIC_API_KEY    optioneel: tegenpartijen laten classificeren door Claude (met webzoekfunctie)
 *
 * Gebruikers beheren:  node server/server.js adduser <naam>   |   node server/server.js passwd <naam>
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const C = require('../js/core.js');
const Store = require('../js/store.js');
const Lookup = require('../js/lookup.js');
const AI = require('./ai.js');
const Degiro = require('./degiro.js');
const Prices = require('./prices.js');
const EnableBanking = require('./enablebanking.js');
const SaxoLink = require('./saxo.js');
const FilesLib = require('./files.js');
const HouseholdLib = require('./household.js');
const Accounts = require('./accounts.js');

// Koerscache in het geheugen (12 uur)
const priceCache = {
  map: new Map(),
  get(k) { const v = this.map.get(k); return v && Date.now() - v.at < 12 * 3600000 ? v.value : null; },
  set(k, value) { this.map.set(k, { at: Date.now(), value }); }
};

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.FLUX_DATA_DIR || path.join(ROOT, 'data'));
const PORT = Number(process.env.PORT || 8080);
const SESSION_DAYS = 120;
const MAX_BODY = 30 * 1024 * 1024;
const USER_AGENT = 'Helder-persoonlijke-boekhouding/2.0 (self-hosted)';

// ---------- Opslag ----------

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(path.join(DATA_DIR, file), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

async function writeJson(file, data) {
  const target = path.join(DATA_DIR, file);
  const tmp = target + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
  await fsp.rename(tmp, target);
}

// Schrijfacties per bestand na elkaar uitvoeren
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(key, run.catch(() => {}));
  return run;
}

function userFile(username) { return 'user-' + Buffer.from(username).toString('hex') + '.json'; }

// Eigen sleutels per gebruiker (Enable Banking-app, Saxo-app, Anthropic API-sleutel): enkel op de server
const keysFile = user => 'keys-' + Buffer.from(user).toString('hex') + '.json';
async function userKeys(user) { return (await readJson(keysFile(user), {})) || {}; }
function setUserKey(user, name, value) {
  return withLock('keys:' + user, async () => {
    const k = await userKeys(user);
    if (value == null) delete k[name]; else k[name] = value;
    if (Object.keys(k).length) await writeJson(keysFile(user), k); else await fsp.unlink(path.join(DATA_DIR, keysFile(user))).catch(() => {});
  });
}
async function isOwner(user) { return Accounts.userRole((await getUsers())[user]) === 'owner'; }
const keyStore = { userKeys, setUserKey, isOwner, bankShared: async () => !!(await Acc.siteSettings()).bankShared };

/** De AI-sleutel voor deze gebruiker: zijn eigen, anders die van de server als de beheerder dat toelaat. */
async function aiKeyFor(user, me) {
  const own = user ? ((await userKeys(user)).ai || {}).key : '';
  if (own) return own;
  return AI.available() && Accounts.mayAi(me) ? process.env.ANTHROPIC_API_KEY : '';
}

async function saveAiKey(user, b) {
  if (b.remove) { await setUserKey(user, 'ai', null); return { set: false }; }
  const key = String(b.apiKey || '').trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(key)) throw httpError(400, 'Dit lijkt geen Anthropic API-sleutel (die begint met sk-ant-)');
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  let status = 0;
  try { status = (await fetch(base + '/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', Accept: 'application/json' } })).status; } catch (e) { /* niet bereikbaar: toch bewaren */ }
  if (status === 401 || status === 403) throw httpError(400, 'Anthropic weigert deze sleutel. Controleer of je ze volledig kopieerde en of ze nog actief is.');
  await setUserKey(user, 'ai', { key, hint: key.slice(-4), savedAt: new Date().toISOString() });
  return { set: true, hint: key.slice(-4) };
}

// Bankkoppeling (Enable Banking)
const Bank = EnableBanking.create({
  readJson, writeJson, withLock, ...keyStore,
  remove: file => fsp.unlink(path.join(DATA_DIR, file)).catch(() => {}),
  publicUrl: req => (process.env.FLUX_PUBLIC_URL || ((isSecure(req) ? 'https' : 'http') + '://' + String(req.headers.host || 'localhost').replace(/[^a-zA-Z0-9.:[\]-]/g, ''))).replace(/\/+$/, '')
});

// Saxo Bank (OpenAPI)
const Saxo = SaxoLink.create({
  readJson, writeJson, withLock, ...keyStore,
  remove: file => fsp.unlink(path.join(DATA_DIR, file)).catch(() => {}),
  publicUrl: req => (process.env.FLUX_PUBLIC_URL || ((isSecure(req) ? 'https' : 'http') + '://' + String(req.headers.host || 'localhost').replace(/[^a-zA-Z0-9.:[\]-]/g, ''))).replace(/\/+$/, '')
});

// Bonnetjes (httpError is een function-declaratie, dus hier al bruikbaar)
const Files = FilesLib.create(DATA_DIR, (status, message) => httpError(status, message));

// Gedeelde boekhouding (huishouden)
const House = HouseholdLib.create({ readJson, writeJson, withLock, getUsers: () => getUsers(), httpError: (s, m) => httpError(s, m) });
/** Accountgegevens voor de browser, met wiens boekhouding gebruikt wordt. */
async function publicUser(name, u) { return Object.assign(Accounts.userPublic(name, u), { dataUser: House.dataUserSync(await getUsers(), name) }); }

const Acc = Accounts.create({
  readJson, writeJson, withLock, getUsers: () => getUsers(), hashPassword: (p) => hashPassword(p), verifyPassword: (p, u) => verifyPassword(p, u),
  userFile: n => userFile(n), dataDir: DATA_DIR, clientIp: req => clientIp(req), httpError: (st, m) => httpError(st, m),
  publicUrl: req => (process.env.FLUX_PUBLIC_URL || ((isSecure(req) ? 'https' : 'http') + '://' + String(req.headers.host || 'localhost').replace(/[^a-zA-Z0-9.:[\]-]/g, ''))).replace(/\/+$/, '')
});

// ---------- Gebruikers en sessies ----------

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function validUsername(u) { return typeof u === 'string' && /^[a-zA-Z0-9._-]{2,40}$/.test(u); }
function validPassword(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 200; }

async function getUsers() { return readJson('users.json', {}); }

async function createUser(username, password) {
  return withLock('users', async () => {
    const users = await getUsers();
    if (users[username]) throw httpError(409, 'Deze gebruikersnaam bestaat al');
    users[username] = Object.assign(hashPassword(password), { created: new Date().toISOString() });
    await writeJson('users.json', users);
  });
}

async function setPassword(username, password) {
  return withLock('users', async () => {
    const users = await getUsers();
    if (!users[username]) throw httpError(404, 'Onbekende gebruiker');
    Object.assign(users[username], hashPassword(password));
    await writeJson('users.json', users);
  });
}

// Sessies: enkel de hash van het token wordt bewaard
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

async function createSession(username) {
  const token = crypto.randomBytes(32).toString('base64url');
  await withLock('sessions', async () => {
    const sessions = await readJson('sessions.json', {});
    const now = Date.now();
    for (const [k, s] of Object.entries(sessions)) if (s.expires < now) delete sessions[k];
    sessions[tokenHash(token)] = { username, expires: now + SESSION_DAYS * 86400000 };
    await writeJson('sessions.json', sessions);
  });
  return token;
}

async function sessionUser(req) {
  const token = parseCookies(req.headers.cookie || '').flux_session;
  if (!token) return null;
  const sessions = await readJson('sessions.json', {});
  const s = sessions[tokenHash(token)];
  if (!s || s.expires < Date.now()) return null;
  return s.username;
}

async function destroySession(req, allForUser) {
  const token = parseCookies(req.headers.cookie || '').flux_session;
  if (!token) return;
  await withLock('sessions', async () => {
    const sessions = await readJson('sessions.json', {});
    const own = sessions[tokenHash(token)];
    if (allForUser && own) {
      for (const [k, s] of Object.entries(sessions)) if (s.username === own.username) delete sessions[k];
    } else delete sessions[tokenHash(token)];
    await writeJson('sessions.json', sessions);
  });
}

function parseCookies(header) {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecure(req) {
  return process.env.FLUX_SECURE_COOKIES === '1' || req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
}

function sessionCookie(req, token, maxAge) {
  return `flux_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;
}

// Eenvoudige bescherming tegen raden van wachtwoorden: max. 10 pogingen per 15 min per IP
const attempts = new Map();
function clientIp(req) {
  return (process.env.FLUX_TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
}
function rateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter(t => now - t < 15 * 60000);
  attempts.set(ip, list);
  return list.length >= 10;
}
function recordAttempt(req) { const ip = clientIp(req); attempts.set(ip, (attempts.get(ip) || []).concat(Date.now())); }

// Eerste gebruiker aanmaken via een eenmalige setupcode uit de serverlog
let setupCode = null;
async function initSetup() {
  const users = await getUsers();
  // Enkel zolang er geen eigen account is (de beheerder en Google-gebruikers tellen niet mee)
  if (Object.values(users).some(u => Accounts.userRole(u) === 'owner')) return;
  if (process.env.FLUX_USERNAME && process.env.FLUX_PASSWORD) {
    if (!validUsername(process.env.FLUX_USERNAME) || !validPassword(process.env.FLUX_PASSWORD)) {
      console.error('FLUX_USERNAME/FLUX_PASSWORD ongeldig (wachtwoord min. 8 tekens).');
    } else {
      await createUser(process.env.FLUX_USERNAME, process.env.FLUX_PASSWORD);
      console.log(`Gebruiker "${process.env.FLUX_USERNAME}" aangemaakt.`);
      return;
    }
  }
  setupCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  console.log('\n  Nog geen account. Open Helder in je browser en gebruik deze setupcode: ' + setupCode + '\n');
}

// ---------- Gegevens ----------

async function loadUserData(username) {
  const d = await readJson(userFile(username), null);
  if (!d) return { rev: 0, state: null };
  // Gegevens van een oudere versie: proper opnieuw beginnen (zie Store.VERSION)
  if (d.state && (d.state.version || 1) < Store.VERSION) {
    const fresh = { rev: (d.rev || 0) + 1, state: Store.defaultState(), updated: new Date().toISOString(), resetFrom: d.state.version || 1 };
    await writeJson(userFile(username) + '.v' + (d.state.version || 1) + '.bak', d);
    await writeJson(userFile(username), fresh);
    console.log(`Gegevens van "${username}" gewist bij de update naar versie ${Store.VERSION} (back-up bewaard).`);
    return fresh;
  }
  return d;
}

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = Number(process.env.FLUX_BACKUP_DAYS || 30);

/**
 * Automatische back-up: bij de eerste wijziging van elke dag wordt de vorige stand bewaard
 * (backups/<gebruiker>-JJJJ-MM-DD.json). De laatste FLUX_BACKUP_DAYS (standaard 30) blijven staan.
 */
async function dailyBackup(username, data) {
  if (!data || !data.state) return;
  const day = new Date().toISOString().slice(0, 10);
  const base = userFile(username).replace(/\.json$/, '');
  const file = path.join(BACKUP_DIR, `${base}-${day}.json`);
  try { await fsp.access(file); return; } catch (e) { /* nog geen back-up vandaag */ }
  await fsp.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  await fsp.writeFile(file, JSON.stringify(data), { mode: 0o600 });
  const old = (await fsp.readdir(BACKUP_DIR)).filter(f => f.startsWith(base + '-')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - BACKUP_KEEP))) await fsp.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
}

/** Voegt de wijzigingen van een toestel samen met wat op de server staat. */
async function syncUser(username, changes, clientRev) {
  return withLock('u:' + username, async () => {
    const data = await loadUserData(username);
    let state = data.state;
    let rev = data.rev || 0;
    const hasChanges = changes && Object.keys(changes).some(k => {
      const v = changes[k];
      return Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : false;
    });
    if (hasChanges) {
      await dailyBackup(username, data);
      state = C.mergeStates(state || Store.defaultState(), changes);
      state = C.recompute(Store.migrate(state));
      rev += 1;
      await writeJson(userFile(username), { rev, state, updated: new Date().toISOString() });
    }
    // Volledige staat enkel terugsturen als het toestel achterloopt
    return clientRev === rev && !hasChanges ? { rev } : { rev, state };
  });
}

// ---------- Online opzoeken ----------

const nominatimQueue = Lookup.createQueue(1100);
let lookupCache = null;
async function cacheGet(key) {
  if (!lookupCache) lookupCache = await readJson('lookup-cache.json', {});
  const hit = lookupCache[key];
  return hit && Date.now() - hit.at < 90 * 86400000 ? hit.value : null;
}
async function cacheSet(key, value) {
  lookupCache[key] = { at: Date.now(), value };
  await withLock('lookup-cache', () => writeJson('lookup-cache.json', lookupCache));
}

async function lookupItems(body, apiKey) {
  if (apiKey === undefined) apiKey = AI.available() ? process.env.ANTHROPIC_API_KEY : '';
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 25);
  const categories = (Array.isArray(body.categories) ? body.categories : []).slice(0, 200)
    .map(c => ({ id: String(c.id), name: String(c.name || ''), kind: c.kind === 'income' ? 'income' : 'expense' }));
  const countries = String(body.countries || 'be').replace(/[^a-z,]/gi, '').slice(0, 30) || 'be';
  let provider = body.provider === 'free' || body.provider === 'ai' ? body.provider : 'auto';
  if (provider === 'auto') provider = apiKey ? 'ai' : 'free';
  if (provider === 'ai' && !apiKey) throw httpError(400, 'AI is niet ingesteld op deze server');

  // Gratis bronnen: per tegenpartij (gecachet op de server)
  const free = await Promise.all(items.map(async it => {
    if (!it.name && !it.description) return { query: '', hits: [], text: '', errors: [] };
    const key = 'free:' + countries + ':' + C.normalizeName(it.name || it.description);
    const cached = await cacheGet(key);
    if (cached) return cached;
    const res = await Lookup.lookupFree({ name: it.name, description: it.description }, {
      fetch, headers: { 'User-Agent': USER_AGENT }, countries, nominatimQueue
    });
    if (!res.errors.length || res.hits.length) await cacheSet(key, res);
    return res;
  }));

  let ai = [];
  if (provider === 'ai' && items.length) {
    ai = await AI.classify(items.map(it => ({ title: it.title, name: it.name, description: it.description, direction: it.direction })), categories, countries, apiKey);
  }
  return {
    provider,
    results: items.map((it, i) => {
      const a = ai.find(r => r.index === i);
      return Object.assign({ name: it.name }, free[i], a ? { ai: { categoryId: a.categoryId, businessType: a.businessType, confidence: a.confidence, explanation: a.explanation } } : {});
    })
  };
}

// ---------- HTTP ----------

function httpError(status, message, code) { const e = new Error(message); e.status = status; if (code) e.code = code; return e; }

function send(res, status, body, headers) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': typeof body === 'string' || Buffer.isBuffer(body) ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, SECURITY_HEADERS, headers || {}));
  res.end(data);
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'Te groot')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(httpError(400, 'Ongeldige JSON')); }
    });
    req.on('error', reject);
  });
}

const STATIC = {
  '/': 'index.html', '/index.html': 'index.html', '/sw.js': 'sw.js', '/manifest.webmanifest': 'manifest.webmanifest', '/privacy.html': 'privacy.html', '/voorwaarden.html': 'voorwaarden.html'
};
const STATIC_DIRS = ['css/', 'js/', 'icons/', 'fonts/'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

async function serveStatic(req, res, pathname) {
  if (/^\/(privacy|privacy-policy|privacybeleid|privacyverklaring)(\.html)?\/?$/i.test(pathname)) pathname = '/privacy.html';
  if (/^\/(voorwaarden|terms|gebruiksvoorwaarden|terms-of-service)(\.html)?\/?$/i.test(pathname)) pathname = '/voorwaarden.html';
  let rel = STATIC[pathname];
  if (!rel) {
    const p = pathname.replace(/^\/+/, '');
    if (STATIC_DIRS.some(d => p.startsWith(d)) && !p.includes('..') && /^[a-zA-Z0-9/_.-]+$/.test(p)) rel = p;
  }
  if (!rel) return send(res, 404, 'Niet gevonden');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, 'Niet gevonden');
  try {
    const data = await fsp.readFile(file);
    const etag = '"' + crypto.createHash('sha1').update(data).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag
    }, SECURITY_HEADERS, rel === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}));
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (e) {
    send(res, 404, 'Niet gevonden');
  }
}

async function handleApi(req, res, pathname, query) {
  // CSRF-bescherming: wijzigende verzoeken moeten van de app zelf komen
  if (req.method !== 'GET' && req.headers['x-flux'] !== '1') throw httpError(403, 'Verboden');
  const user = await sessionUser(req);

  const users = await getUsers();
  const me = user ? users[user] || null : null;
  const role = Accounts.userRole(me);
  const aiKey = user && me && role !== 'admin' ? await aiKeyFor(user, me) : '';
  const aiOk = !!aiKey;

  if (pathname === '/api/session' && req.method === 'GET') {
    return send(res, 200, Object.assign(me ? await publicUser(user, me) : { user: null, role: 'none' }, {
      setupRequired: !!setupCode,
      auth: { google: Acc.googleConfigured(), registration: (await Acc.siteSettings()).registration, signupGoogle: Acc.googleConfigured() && await Acc.signupAllowed('google'), signupPassword: await Acc.signupAllowed('password') },
      features: { ai: aiOk, aiModel: aiOk ? AI.MODEL : null, aiOwnKey: !!(user && ((await userKeys(user)).ai || {}).key), aiServer: AI.available() && Accounts.mayAi(me), bank: !!me && role !== 'admin', saxo: !!me && role !== 'admin' }
    }));
  }

  if (pathname === '/api/auth/google' && req.method === 'GET') {
    if (!Acc.googleConfigured()) throw httpError(400, 'Aanmelden met Google is niet ingesteld');
    // ?link=1: de aangemelde gebruiker koppelt zijn bestaande account aan Google
    let link = null;
    if (query.get('link')) {
      if (!user || !me || me.google) { res.writeHead(302, { Location: '/#settings' }); return res.end(); }
      link = user;
    }
    res.writeHead(302, { Location: await Acc.googleStart(req, link), 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (pathname === '/api/auth/google/callback' && req.method === 'GET') {
    let r;
    try { r = await Acc.googleCallback(fetch, req, Object.fromEntries(query)); }
    catch (e) { console.error('Google:', e.message); r = { ok: false, message: 'Google is niet bereikbaar. Probeer later opnieuw.' }; }
    if (r.ok) {
      const token = await createSession(r.user);
      res.writeHead(302, Object.assign({ Location: '/' + (r.linked ? '?google=gekoppeld#settings' : r.new ? '?welkom=1' : ''), 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400), 'Cache-Control': 'no-store' }, SECURITY_HEADERS));
      return res.end();
    }
    res.writeHead(400, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY_HEADERS));
    return res.end(Accounts.authPage(r));
  }

  if (pathname === '/api/setup' && req.method === 'POST') {
    const b = await readBody(req);
    if (!setupCode) throw httpError(400, 'Er bestaat al een account');
    if (rateLimited(req)) throw httpError(429, 'Te veel pogingen, probeer later opnieuw');
    recordAttempt(req);
    if (String(b.code || '').trim().toUpperCase() !== setupCode) throw httpError(401, 'Verkeerde setupcode (zie de serverlog)');
    if (!validUsername(b.username)) throw httpError(400, 'Gebruikersnaam: 2-40 tekens (letters, cijfers, . _ -)');
    if (!validPassword(b.password)) throw httpError(400, 'Wachtwoord: minstens 8 tekens');
    await createUser(b.username, b.password);
    setupCode = null;
    const token = await createSession(b.username);
    return send(res, 200, { user: b.username }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    const b = await readBody(req);
    if (rateLimited(req)) throw httpError(429, 'Te veel pogingen, probeer binnen 15 minuten opnieuw');
    if (validUsername(b.username)) await Acc.ensureAdmin(b.username);
    const all = await getUsers();
    const u = validUsername(b.username) && all[b.username];
    if (!u || !u.hash || !verifyPassword(b.password || '', u)) {
      recordAttempt(req);
      if (u) await Acc.logLogin(req, b.username, 'wachtwoord', false, 'fout wachtwoord');
      throw httpError(401, 'Gebruikersnaam of wachtwoord klopt niet');
    }
    if (u.disabled) { await Acc.logLogin(req, b.username, 'wachtwoord', false, 'account geblokkeerd'); throw httpError(403, 'Dit account is geblokkeerd'); }
    await Acc.logLogin(req, b.username, 'wachtwoord', true);
    const token = await createSession(b.username);
    return send(res, 200, await publicUser(b.username, u), { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  }

  if (pathname === '/api/register' && req.method === 'POST') {
    if (rateLimited(req)) throw httpError(429, 'Te veel pogingen, probeer later opnieuw');
    recordAttempt(req); // ook geslaagde registraties tellen mee, tegen massaal aanmaken
    const name = await Acc.register(req, await readBody(req));
    const token = await createSession(name);
    return send(res, 200, await publicUser(name, (await getUsers())[name]), { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const b = await readBody(req);
    await destroySession(req, !!b.everywhere);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // Terugkeer van de bank na het aanmelden (gewone pagina, de 'state' bepaalt de gebruiker)
  if (pathname === '/api/bank/callback' && req.method === 'GET') {
    let r;
    try { r = await Bank.callback(fetch, Object.fromEntries(query)); }
    catch (e) { if (!(e instanceof EnableBanking.BankError)) console.error('Bank:', e.message); r = { ok: false, message: e instanceof EnableBanking.BankError ? e.message : 'Enable Banking is niet bereikbaar.' }; }
    res.writeHead(r.ok ? 200 : 400, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY_HEADERS));
    return res.end(EnableBanking.callbackPage(r));
  }

  // Terugkeer van Saxo na het aanmelden
  if (pathname === '/api/saxo/callback' && req.method === 'GET') {
    let r;
    try { r = await Saxo.callback(fetch, req, Object.fromEntries(query)); }
    catch (e) { if (!(e instanceof SaxoLink.SaxoError)) console.error('Saxo:', e.message); r = { ok: false, message: e instanceof SaxoLink.SaxoError ? e.message : 'Saxo is niet bereikbaar.' }; }
    res.writeHead(r.ok ? 200 : 400, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY_HEADERS));
    return res.end(SaxoLink.callbackPage(r));
  }

  if (!user || !me || me.disabled) throw httpError(401, 'Niet aangemeld');

  // Beheer: enkel voor de beheerder, die zelf geen financiële gegevens heeft
  if (pathname.startsWith('/api/admin/')) {
    if (role !== 'admin') throw httpError(403, 'Enkel voor de beheerder');
    if (pathname === '/api/admin/overview' && req.method === 'GET') return send(res, 200, await Acc.overview(req));
    if (pathname === '/api/admin/site' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, await Acc.saveSite(Acc.siteChanges(b))); }
    if (pathname === '/api/admin/user' && req.method === 'POST') return send(res, 200, await Acc.userAction(user, await readBody(req)));
    throw httpError(404, 'Onbekend');
  }
  if (pathname === '/api/account/google-unlink' && req.method === 'POST') return send(res, 200, await Acc.googleUnlink(req, user));
  if (role === 'admin' && pathname !== '/api/password') throw httpError(403, 'Het beheerdersaccount heeft geen eigen boekhouding');

  // Gedeelde boekhouding: gegevens, bonnetjes en synchronisatie van de eigenaar van het huishouden
  const dataUser = await House.dataUser(user);
  if (pathname === '/api/household' && req.method === 'GET') return send(res, 200, await House.status(user));
  if (pathname === '/api/household/invite' && req.method === 'POST') return send(res, 200, await House.invite(user));
  if (pathname === '/api/household/join' && req.method === 'POST') return send(res, 200, await House.join(user, await readBody(req)));
  if (pathname === '/api/household/leave' && req.method === 'POST') return send(res, 200, await House.leave(user, await readBody(req)));

  // Bonnetjes bij transacties
  if (pathname === '/api/files' && req.method === 'POST') return send(res, 200, await Files.upload(dataUser, await readBody(req)));
  if (pathname === '/api/files/delete' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, await Files.remove(dataUser, String(b.id || ''))); }
  const fileMatch = pathname.match(/^\/api\/files\/([A-Za-z0-9_-]{8,40})$/);
  if (fileMatch && req.method === 'GET') return Files.send(res, dataUser, fileMatch[1]);

  if (pathname === '/api/account/delete' && req.method === 'POST') {
    const b = await readBody(req);
    if (role !== 'member') throw httpError(400, 'Dit account kan je hier niet verwijderen');
    if (b.confirm !== 'VERWIJDER') throw httpError(400, 'Typ VERWIJDER om te bevestigen');
    await Acc.deleteOwn(req, user);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // Eigen Anthropic API-sleutel (voor AI-classificatie)
  if (pathname === '/api/ai/key' && req.method === 'GET') {
    const k = (await userKeys(user)).ai;
    return send(res, 200, { set: !!k, hint: k ? k.hint : null, server: AI.available() && Accounts.mayAi(me), sdk: true });
  }
  if (pathname === '/api/ai/key' && req.method === 'POST') return send(res, 200, await saveAiKey(user, await readBody(req)));

  if (pathname.startsWith('/api/bank/')) {
    try {
      if (pathname === '/api/bank/status' && req.method === 'GET') return send(res, 200, await Bank.status(req, user));
      if (pathname === '/api/bank/config' && req.method === 'POST') return send(res, 200, await Bank.saveConfig(fetch, user, await readBody(req)));
      if (pathname === '/api/bank/aspsps' && req.method === 'GET') return send(res, 200, await Bank.aspsps(fetch, user, query.get('country')));
      if (pathname === '/api/bank/connect' && req.method === 'POST') return send(res, 200, await Bank.connect(fetch, req, user, await readBody(req)));
      if (pathname === '/api/bank/fetch' && req.method === 'POST') return send(res, 200, await Bank.fetchAccount(fetch, req, user, await readBody(req)));
      if (pathname === '/api/bank/disconnect' && req.method === 'POST') return send(res, 200, await Bank.disconnect(fetch, user, await readBody(req)));
    } catch (e) {
      if (e instanceof EnableBanking.BankError) throw httpError(e.status, e.message, e.kind);
      if (e.status) throw e;
      console.error('Bank:', e.message);
      throw httpError(502, 'Enable Banking is niet bereikbaar: ' + e.message);
    }
  }

  if (pathname.startsWith('/api/saxo/')) {
    try {
      if (pathname === '/api/saxo/status' && req.method === 'GET') return send(res, 200, await Saxo.status(req, user));
      if (pathname === '/api/saxo/config' && req.method === 'POST') return send(res, 200, await Saxo.saveConfig(user, await readBody(req)));
      if (pathname === '/api/saxo/connect' && req.method === 'POST') return send(res, 200, await Saxo.connect(req, user));
      if (pathname === '/api/saxo/fetch' && req.method === 'POST') return send(res, 200, await Saxo.fetchAll(fetch, req, user, await readBody(req)));
      if (pathname === '/api/saxo/disconnect' && req.method === 'POST') return send(res, 200, await Saxo.disconnect(user));
    } catch (e) {
      if (e instanceof SaxoLink.SaxoError) throw httpError(e.status, e.message, e.kind);
      if (e.status) throw e;
      console.error('Saxo:', e.message);
      throw httpError(502, 'Saxo is niet bereikbaar: ' + e.message);
    }
  }

  if (pathname === '/api/sync' && req.method === 'POST') {
    const b = await readBody(req);
    // Een verouderde app (uit de cache) mag geen oude gegevens terugzetten
    if (b.schema !== Store.VERSION) throw httpError(409, 'Er is een nieuwe versie van Helder. Herlaad de pagina.');
    return send(res, 200, await syncUser(dataUser, b.changes || null, b.rev));
  }

  if (pathname === '/api/prices' && req.method === 'POST') {
    const b = await readBody(req);
    const list = (Array.isArray(b.instruments) ? b.instruments : []).slice(0, 40).map(i => ({
      key: String(i.key || '').slice(0, 60), isin: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(i.isin || '') ? i.isin : '',
      name: String(i.name || '').slice(0, 80), currency: String(i.currency || 'EUR').slice(0, 4),
      from: /^\d{4}-\d{2}-\d{2}$/.test(i.from || '') ? i.from : '2015-01-01'
    })).filter(i => i.key && (i.isin || i.name));
    return send(res, 200, await Prices.fetchPrices(fetch, list, priceCache));
  }

  if (pathname === '/api/degiro/sync' && req.method === 'POST') {
    const b = await readBody(req);
    if (rateLimited(req)) throw httpError(429, 'Te veel pogingen, probeer binnen 15 minuten opnieuw');
    if (!b.username || !b.password) throw httpError(400, 'Geef je Degiro-gebruikersnaam en wachtwoord');
    try {
      const data = await Degiro.fetchAll(fetch, { username: String(b.username), password: String(b.password), otp: b.otp ? String(b.otp) : '' }, { fromDate: b.fromDate });
      return send(res, 200, data);
    } catch (e) {
      if (e.code === 'auth') recordAttempt(req);
      if (e instanceof Degiro.DegiroError) throw httpError(e.code === 'otp' || e.code === 'auth' ? 401 : 502, e.message, e.code);
      console.error('Degiro:', e.message);
      throw httpError(502, 'Degiro is niet bereikbaar of antwoordde onverwacht. Probeer later opnieuw, of gebruik de exportbestanden.');
    }
  }

  if (pathname === '/api/data' && req.method === 'GET') {
    const d = await loadUserData(dataUser);
    return send(res, 200, { rev: d.rev || 0, state: d.state });
  }

  if (pathname === '/api/password' && req.method === 'POST') {
    const b = await readBody(req);
    const users = await getUsers();
    if (!verifyPassword(b.current || '', users[user])) throw httpError(401, 'Huidig wachtwoord klopt niet');
    if (!validPassword(b.password)) throw httpError(400, 'Nieuw wachtwoord: minstens 8 tekens');
    await setPassword(user, b.password);
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/lookup' && req.method === 'POST') {
    const b = await readBody(req);
    if (!aiOk) { if (b.provider === 'ai') throw httpError(400, 'AI is niet beschikbaar voor jouw account'); b.provider = 'free'; }
    return send(res, 200, await lookupItems(b, aiKey));
  }

  throw httpError(404, 'Onbekend');
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (pathname.startsWith('/api/')) await handleApi(req, res, pathname, url.searchParams);
      else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, pathname);
      else send(res, 405, 'Niet toegestaan');
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, Object.assign({ error: e.status ? e.message : 'Interne fout' }, e.code && e.status ? { code: e.code } : {}));
    }
  });
}

// ---------- CLI ----------

async function prompt(question) {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(a); }));
}

async function main() {
  const [cmd, name] = process.argv.slice(2);
  if (cmd === 'adduser' || cmd === 'passwd') {
    if (!validUsername(name)) { console.error('Gebruik: node server/server.js ' + cmd + ' <naam>'); process.exit(1); }
    const pw = process.env.FLUX_NEW_PASSWORD || await prompt('Wachtwoord (min. 8 tekens): ');
    if (!validPassword(pw)) { console.error('Wachtwoord te kort.'); process.exit(1); }
    if (cmd === 'adduser') await createUser(name, pw); else await setPassword(name, pw);
    console.log('OK');
    return;
  }
  await initSetup();
  createServer().listen(PORT, () => {
    console.log(`Helder draait op http://localhost:${PORT}  (gegevens: ${DATA_DIR})`);
    console.log(AI.available() ? `AI-classificatie actief (${AI.MODEL}).` : 'AI-classificatie uit; online opzoeken via Wikidata en OpenStreetMap.');
  });
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });

module.exports = { createServer, initSetup, syncUser };
