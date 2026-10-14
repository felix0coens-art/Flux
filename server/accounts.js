'use strict';
/*
 * Accounts voor een publieke Helder: aanmelden met Google, een aparte beheerder en een logboek van
 * aanmeldingen. Zelfde gedrag als php/lib/accounts.php.
 *
 *   FLUX_GOOGLE_CLIENT_ID / FLUX_GOOGLE_CLIENT_SECRET   OAuth-client uit Google Cloud Console
 *   FLUX_ADMIN_USERNAME / FLUX_ADMIN_PASSWORD           de beheerder (los van je gewone account)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = process.env.FLUX_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';

function userRole(u) {
  if (!u) return 'none';
  if (u.role === 'admin') return 'admin';
  return u.google || u.role === 'member' ? 'member' : 'owner';
}

function userPublic(name, u) {
  return { user: name, role: userRole(u), displayName: u.displayName || (u.google && u.google.name) || name, email: (u.google && u.google.email) || null, picture: (u.google && u.google.picture) || null };
}

const mayAi = u => !!u && (userRole(u) === 'owner' || !!u.ai);
const b64url = buf => Buffer.from(buf).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function create(store) {
  const { readJson, writeJson, withLock, getUsers, hashPassword, verifyPassword, userFile, dataDir } = store;
  const googleConfigured = () => !!(process.env.FLUX_GOOGLE_CLIENT_ID && process.env.FLUX_GOOGLE_CLIENT_SECRET);

  async function siteSettings() { const s = await readJson('site.json', {}); return { registration: s.registration === 'open' ? 'open' : 'closed' }; }
  async function saveSite(changes) {
    return withLock('site', async () => { const s = Object.assign(await readJson('site.json', {}), changes); await writeJson('site.json', s); return siteSettings(); });
  }

  async function logLogin(req, username, method, ok, detail) {
    await withLock('logins', async () => {
      const list = await readJson('logins.json', []);
      const cut = new Date(Date.now() - 183 * 86400000).toISOString().replace(/\.\d{3}Z$/, '+00:00'); // logboek: maximaal 6 maanden
      for (let i = list.length - 1; i >= 0; i--) if (String(list[i].at || '') < cut) list.splice(i, 1);
      list.push({ at: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'), user: username, method, ok, detail: detail || '', ip: store.clientIp(req), ua: String(req.headers['user-agent'] || '').slice(0, 160) });
      await writeJson('logins.json', list.slice(-2000));
    });
    await purgeOldBackups();
    if (ok) {
      await withLock('users', async () => {
        const users = await getUsers();
        if (!users[username]) return;
        users[username].lastLogin = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
        users[username].logins = (users[username].logins || 0) + 1;
        await writeJson('users.json', users);
      });
    }
  }

  /** Gegevens van verwijderde accounts en back-ups van gebruikers die niet meer bestaan: na 30 dagen gewist. */
  async function purgeOldBackups() {
    const dir = path.join(dataDir, 'backups');
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) { return; }
    const known = Object.keys(await getUsers()).map(n => userFile(n).replace(/\.json$/, ''));
    const limit = Date.now() - 30 * 86400000;
    for (const f of files) {
      let mt = Infinity;
      try { mt = fs.statSync(path.join(dir, f)).mtimeMs; } catch (e) { continue; }
      if (f.startsWith('.') || mt > limit) continue;
      const orphan = f.startsWith('user-') && !known.some(k => f.startsWith(k + '-'));
      if (f.startsWith('verwijderd-') || orphan) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* al weg */ } }
    }
  }

  /** Een gebruiker verwijdert zijn eigen account: alles meteen weg, ook de back-ups. */
  async function deleteOwn(req, username) {
    await withLock('users', async () => { const users = await getUsers(); delete users[username]; await writeJson('users.json', users); });
    const base = userFile(username).replace(/\.json$/, '');
    for (const f of [userFile(username), 'bank-' + Buffer.from(username).toString('hex') + '.json']) { try { fs.unlinkSync(path.join(dataDir, f)); } catch (e) { /* geen */ } }
    let files = [];
    try { files = fs.readdirSync(path.join(dataDir, 'backups')); } catch (e) { files = []; }
    for (const f of files) if (f.startsWith(base + '-') || f.includes(base + '.json')) { try { fs.unlinkSync(path.join(dataDir, 'backups', f)); } catch (e) { /* al weg */ } }
    await withLock('sessions', async () => {
      const s = await readJson('sessions.json', {});
      for (const [k, v] of Object.entries(s)) if (v.username === username) delete s[k];
      await writeJson('sessions.json', s);
    });
    await logLogin(req, username, 'account', true, 'account verwijderd door gebruiker');
  }

  /** Zelf een account aanmaken met gebruikersnaam en wachtwoord (enkel als nieuwe accounts open staan). */
  async function register(req, b) {
    if ((await siteSettings()).registration !== 'open') throw store.httpError(403, 'Nieuwe accounts kunnen op dit moment niet aangemaakt worden');
    const name = String(b.username || '').trim(), pw = String(b.password || '');
    if (!/^[a-zA-Z0-9._-]{2,40}$/.test(name)) throw store.httpError(400, 'Gebruikersnaam: 2-40 tekens (letters, cijfers, . _ -)');
    if (name.startsWith('g_')) throw store.httpError(400, 'Deze gebruikersnaam is niet toegelaten');
    if (pw.length < 8 || pw.length > 200) throw store.httpError(400, 'Wachtwoord: minstens 8 tekens');
    const display = String(b.displayName || '').trim().slice(0, 60);
    await withLock('users', async () => {
      const users = await getUsers();
      if (Object.keys(users).some(n => n.toLowerCase() === name.toLowerCase())) throw store.httpError(409, 'Deze gebruikersnaam is al in gebruik');
      users[name] = Object.assign(hashPassword(pw), { created: new Date().toISOString(), role: 'member', displayName: display || name });
      await writeJson('users.json', users);
    });
    await logLogin(req, name, 'wachtwoord', true, 'nieuw account');
    return name;
  }

  async function ensureAdmin(username) {
    const name = process.env.FLUX_ADMIN_USERNAME || '', pw = process.env.FLUX_ADMIN_PASSWORD || '';
    if (!name || pw.length < 8 || username !== name) return;
    await withLock('users', async () => {
      const users = await getUsers();
      const u = users[name];
      if (u && userRole(u) !== 'admin') return;
      if (!u || !verifyPassword(pw, u)) {
        users[name] = Object.assign(u || { created: new Date().toISOString() }, hashPassword(pw), { role: 'admin', displayName: 'Beheerder' });
        await writeJson('users.json', users);
      }
    });
  }

  const redirectUri = req => store.publicUrl(req) + '/api/auth/google/callback';

  async function googleStart(req) {
    const state = b64url(crypto.randomBytes(24)), nonce = b64url(crypto.randomBytes(16));
    await withLock('google-pending', async () => {
      const p = await readJson('google-pending.json', {});
      const now = Math.floor(Date.now() / 1000);
      for (const k of Object.keys(p)) if (now - p[k].at > 900) delete p[k];
      p[sha(state)] = { nonce, at: now };
      await writeJson('google-pending.json', p);
    });
    const q = new URLSearchParams({ client_id: process.env.FLUX_GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: 'code', scope: 'openid email profile', state, nonce, prompt: 'select_account' });
    return GOOGLE_AUTH + '?' + q.toString();
  }

  async function googleCallback(fetchFn, req, q) {
    const state = String(q.state || '');
    const pending = await withLock('google-pending', async () => {
      const p = await readJson('google-pending.json', {});
      const hit = p[sha(state)] || null;
      delete p[sha(state)];
      await writeJson('google-pending.json', p);
      return hit && Math.floor(Date.now() / 1000) - hit.at <= 900 ? hit : null;
    });
    if (!state || !pending) return { ok: false, message: 'Deze aanmelding is verlopen. Probeer opnieuw.' };
    if (q.error) return { ok: false, message: 'Aanmelden bij Google werd geannuleerd.' };
    const res = await fetchFn(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ code: String(q.code || ''), client_id: process.env.FLUX_GOOGLE_CLIENT_ID, client_secret: process.env.FLUX_GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: 'authorization_code' }).toString() });
    let tok = null;
    try { tok = JSON.parse(await res.text()); } catch (e) { tok = null; }
    if (res.status !== 200 || !tok || !tok.id_token) return { ok: false, message: 'Google weigerde de aanmelding.' };
    let claims = null;
    try { claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8')); } catch (e) { claims = null; }
    if (!claims) return { ok: false, message: 'Ongeldig antwoord van Google.' };
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) || claims.aud !== process.env.FLUX_GOOGLE_CLIENT_ID || !(claims.exp > Date.now() / 1000) || claims.nonce !== pending.nonce || !claims.sub) {
      return { ok: false, message: 'Het antwoord van Google kon niet bevestigd worden.' };
    }
    if (!claims.email_verified) return { ok: false, message: 'Je e-mailadres bij Google is niet bevestigd.' };
    const sub = String(claims.sub).replace(/[^0-9a-zA-Z]/g, '');
    const username = 'g_' + sub.slice(0, 37);
    const profile = { sub, email: String(claims.email || ''), name: String(claims.name || ''), picture: String(claims.picture || '') };
    const result = await withLock('users', async () => {
      const users = await getUsers();
      if (users[username]) {
        if (users[username].disabled) return 'disabled';
        users[username].google = profile;
        await writeJson('users.json', users);
        return 'existing';
      }
      if ((await siteSettings()).registration !== 'open') return 'closed';
      users[username] = { created: new Date().toISOString(), google: profile, displayName: profile.name || profile.email };
      await writeJson('users.json', users);
      return 'new';
    });
    if (result === 'closed') { await logLogin(req, username, 'google', false, 'registratie gesloten: ' + profile.email); return { ok: false, message: 'Nieuwe accounts kunnen op dit moment niet aangemaakt worden.' }; }
    if (result === 'disabled') { await logLogin(req, username, 'google', false, 'account geblokkeerd'); return { ok: false, message: 'Dit account is geblokkeerd.' }; }
    await logLogin(req, username, 'google', true, result === 'new' ? 'nieuw account' : '');
    return { ok: true, user: username, new: result === 'new' };
  }

  async function overview(req) {
    const users = await getUsers();
    const list = [];
    for (const [name, u] of Object.entries(users)) {
      const file = path.join(dataDir, userFile(name));
      let size = 0, tx = null, updated = null;
      try { size = fs.statSync(file).size; } catch (e) { size = 0; }
      if (size) { const d = await readJson(userFile(name), null); tx = d && d.state && Array.isArray(d.state.transactions) ? d.state.transactions.length : 0; updated = d && d.updated || null; }
      list.push(Object.assign(userPublic(name, u), { created: u.created || null, lastLogin: u.lastLogin || null, logins: u.logins || 0, disabled: !!u.disabled, ai: mayAi(u), dataSize: size, transactions: tx, lastSync: updated }));
    }
    list.sort((a, b) => String(b.lastLogin || '').localeCompare(String(a.lastLogin || '')));
    const logins = (await readJson('logins.json', [])).slice().reverse().slice(0, 300);
    return { users: list, logins, site: await siteSettings(), google: googleConfigured(), googleRedirect: redirectUri(req), origin: store.publicUrl(req) };
  }

  async function userAction(admin, b) {
    const name = String(b.username || ''), action = String(b.action || '');
    if (name === admin) throw store.httpError(400, 'Je kan je eigen beheerdersaccount niet wijzigen');
    await withLock('users', async () => {
      const users = await getUsers();
      if (!users[name]) throw store.httpError(404, 'Onbekende gebruiker');
      if (action === 'disable' || action === 'enable') users[name].disabled = action === 'disable';
      else if (action === 'ai-on' || action === 'ai-off') users[name].ai = action === 'ai-on';
      else if (action === 'delete') {
        if (userRole(users[name]) === 'owner') throw store.httpError(400, 'Het eigenaarsaccount kan je hier niet verwijderen');
        const file = path.join(dataDir, userFile(name));
        try { fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true }); fs.renameSync(file, path.join(dataDir, 'backups', 'verwijderd-' + Date.now() + '-' + userFile(name))); } catch (e) { /* geen gegevens */ }
        delete users[name];
      } else throw store.httpError(400, 'Onbekende actie');
      await writeJson('users.json', users);
    });
    if (action === 'disable' || action === 'delete') {
      await withLock('sessions', async () => {
        const s = await readJson('sessions.json', {});
        for (const [k, v] of Object.entries(s)) if (v.username === name) delete s[k];
        await writeJson('sessions.json', s);
      });
    }
    return { ok: true };
  }

  return { googleConfigured, siteSettings, saveSite, logLogin, ensureAdmin, register, deleteOwn, purgeOldBackups, googleStart, googleCallback, overview, userAction };
}

function authPage(r) {
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aanmelden — Helder</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f5f7fb;color:#14284b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.c{background:#fff;border-radius:14px;padding:28px;max-width:420px;box-shadow:0 2px 12px rgba(20,40,75,.1);text-align:center}a{display:inline-block;margin-top:16px;background:#14284b;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none}</style></head>
<body><div class="c"><h1 style="font-size:20px;margin:0 0 8px">Aanmelden niet gelukt</h1><p>${esc(r.message)}</p><a href="/">Terug naar Helder</a></div></body></html>`;
}

module.exports = { create, userRole, userPublic, mayAi, authPage };
