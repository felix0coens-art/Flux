'use strict';
/*
 * Bankkoppeling via Enable Banking (PSD2), voor KBC/CBC, Argenta en andere Europese banken.
 * Zelfde gedrag als php/lib/enablebanking.php.
 *
 * - De sleutel van je Enable Banking-app staat enkel op de server (datamap/enablebanking.json)
 *   en wordt nooit naar de browser gestuurd.
 * - Je bankwachtwoord gaat nooit via Helder: je meldt je aan bij je eigen bank.
 * - Enkel leestoegang (saldo en transacties); na ± 180 dagen opnieuw toestemming geven.
 */

const crypto = require('crypto');

class BankError extends Error {
  constructor(message, status, kind) { super(message); this.status = status || 502; this.kind = kind || 'api'; }
}

const b64url = buf => Buffer.from(buf).toString('base64url');

function jwt(c) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: c.appId }));
  const claims = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  let sig;
  try { sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + claims), c.privateKey); }
  catch (e) { throw new BankError('De privésleutel van Enable Banking is ongeldig', 400, 'config'); }
  return head + '.' + claims + '.' + b64url(sig);
}

/**
 * @param store { readJson, writeJson, withLock, remove, publicUrl(req), userKeys(user), setUserKey(user, name, value), isOwner(user), bankShared() }
 */
function create(store) {
  const base = () => (process.env.FLUX_EB_BASE_URL || 'https://api.enablebanking.com').replace(/\/+$/, '');

  /**
   * De Enable Banking-app van een gebruiker: zijn eigen app, of (voor de eigenaar, of voor iedereen als de
   * beheerder dat toelaat) de app van deze Helder in enablebanking.json.
   */
  async function config(user) {
    const own = (await store.userKeys(user)).eb;
    if (own && own.appId && own.privateKey) return Object.assign({}, own, { own: true });
    const owner = await store.isOwner(user);
    if (!owner && !await store.bankShared()) return null;
    const c = await store.readJson('enablebanking.json', null);
    return c && c.appId && c.privateKey ? Object.assign({}, c, { own: owner, shared: !owner }) : null;
  }

  async function call(fetchFn, c, method, path, body, extraHeaders) {
    const headers = Object.assign({ Authorization: 'Bearer ' + jwt(c), Accept: 'application/json' }, extraHeaders || {});
    if (body != null) headers['Content-Type'] = 'application/json';
    const res = await fetchFn(base() + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch (e) { /* geen json */ }
    if (res.status >= 200 && res.status < 300) return j || {};
    let msg = j ? String(j.message || j.detail || j.error || '') : '';
    const code = j ? String(j.error || j.code || '') : '';
    if (j && j.detail && typeof j.detail === 'object') msg = JSON.stringify(j.detail);
    const full = 'Enable Banking: ' + (msg || 'HTTP ' + res.status);
    if (res.status === 401 && /session|expired|consent|revoked/i.test(code + ' ' + msg)) throw new BankError('De toestemming bij je bank is verlopen of ingetrokken. Koppel je bank opnieuw.', 401, 'expired');
    if (/not active|inactive|not activated/i.test(msg)) throw new BankError('Je Enable Banking-app is nog niet actief. Ga naar het Control Panel van Enable Banking, open je app en klik op “Activate by linking accounts”: meld je daar aan bij je bank en kies je rekeningen. Daarna werkt de koppeling in Helder.', 400, 'inactive');
    if (res.status === 401 || res.status === 403) throw new BankError(full + ' (klopt de app-ID en de sleutel? Is de app actief?)', 400, 'config');
    if (res.status === 429) throw new BankError('Je bank laat even geen nieuwe verzoeken toe (limiet bereikt). Probeer later opnieuw.', 429, 'limit');
    throw new BankError(full, res.status >= 500 ? 502 : 400, code === 'REDIRECT_URI_NOT_ALLOWED' ? 'redirect' : 'api');
  }

  async function requireEb(user) {
    const c = await config(user);
    if (!c) throw new BankError('De bankkoppeling is nog niet ingesteld', 400, 'config');
    return c;
  }

  const bankFile = user => 'bank-' + Buffer.from(user).toString('hex') + '.json';
  async function bankData(user) { const d = await store.readJson(bankFile(user), {}); return { connections: d.connections || [] }; }
  const redirectUrl = req => store.publicUrl(req) + '/api/bank/callback';
  const publicConnections = list => list.map(c => ({ id: c.id, aspsp: c.aspsp, country: c.country, validUntil: c.validUntil || null, createdAt: c.createdAt || null, accounts: c.accounts || [] }));

  async function status(req, user) {
    const c = await config(user);
    return { configured: !!c, shared: !!(c && c.shared), appId: c ? c.appId : null, appName: c ? c.appName || null : null, redirectUrl: redirectUrl(req), connections: publicConnections((await bankData(user)).connections) };
  }

  async function saveConfig(fetchFn, user, b) {
    const owner = await store.isOwner(user);
    if (b.remove) {
      if (owner) await store.remove('enablebanking.json'); else await store.setUserKey(user, 'eb', null);
      return { configured: !!await config(user) };
    }
    const appId = String(b.appId || '').trim();
    const pem = String(b.privateKey || '').trim();
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(appId)) throw new BankError('Vul de Application ID in (staat in het Control Panel van Enable Banking)', 400, 'config');
    if (!pem.includes('PRIVATE KEY')) throw new BankError('Kies het .pem-bestand met de privésleutel dat je bij het registreren van de app kreeg', 400, 'config');
    let key;
    try { key = crypto.createPrivateKey(pem); } catch (e) { key = null; }
    if (!key || key.asymmetricKeyType !== 'rsa') throw new BankError('Dit is geen geldige RSA-privésleutel', 400, 'config');
    const c = { appId, privateKey: pem };
    const app = await call(fetchFn, c, 'GET', '/application');
    c.appName = String(app.name || '');
    c.savedAt = new Date().toISOString();
    if (owner) await store.writeJson('enablebanking.json', c); else await store.setUserKey(user, 'eb', c);
    return { configured: true, appId, appName: c.appName, environment: app.environment == null ? null : app.environment, active: app.active == null ? null : app.active };
  }

  async function aspsps(fetchFn, user, country) {
    country = (String(country || 'BE').replace(/[^A-Za-z]/g, '') || 'BE').toUpperCase();
    const r = await call(fetchFn, await requireEb(user), 'GET', '/aspsps?country=' + encodeURIComponent(country));
    const out = (r.aspsps || [])
      .filter(a => !Array.isArray(a.psu_types) || a.psu_types.includes('personal'))
      .map(a => ({ name: String(a.name), country: String(a.country || country), logo: a.logo || null, maxDays: a.maximum_consent_validity != null ? Math.floor(a.maximum_consent_validity / 86400) : null }));
    out.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
    return { aspsps: out };
  }

  async function connect(fetchFn, req, user, b) {
    const c = await requireEb(user);
    const aspsp = String(b.aspsp || '').trim();
    const country = (String(b.country || 'BE').replace(/[^A-Za-z]/g, '') || 'BE').toUpperCase();
    if (!aspsp) throw new BankError('Kies je bank', 400, 'input');
    const days = Math.max(1, Math.min(180, Number(b.maxDays) || 180));
    const state = b64url(crypto.randomBytes(24));
    const validUntil = new Date(Date.now() + days * 86400000 - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const auth = await call(fetchFn, c, 'POST', '/auth', {
      access: { valid_until: validUntil },
      aspsp: { name: aspsp, country },
      state,
      redirect_url: redirectUrl(req),
      psu_type: 'personal'
    });
    if (!auth.url) throw new BankError('Enable Banking gaf geen aanmeldlink terug');
    await store.withLock('bank-pending', async () => {
      const p = await store.readJson('bank-pending.json', {});
      const now = Math.floor(Date.now() / 1000);
      for (const k of Object.keys(p)) if (now - (p[k].at || 0) > 3600) delete p[k];
      p[crypto.createHash('sha256').update(state).digest('hex')] = { user, aspsp, country, at: now };
      await store.writeJson('bank-pending.json', p);
    });
    return { url: auth.url };
  }

  /** Terugkeer van de bank; de eenmalige, geheime 'state' bepaalt de gebruiker (werkt ook zonder cookie). */
  async function callback(fetchFn, q) {
    const state = String(q.state || '');
    const pending = await store.withLock('bank-pending', async () => {
      const p = await store.readJson('bank-pending.json', {});
      const k = crypto.createHash('sha256').update(state).digest('hex');
      const hit = p[k] || null;
      delete p[k];
      await store.writeJson('bank-pending.json', p);
      return hit && Math.floor(Date.now() / 1000) - hit.at <= 3600 ? hit : null;
    });
    if (!state || !pending) return { ok: false, message: 'Deze koppeling is verlopen of al gebruikt. Start opnieuw vanuit Helder.' };
    if (q.error) return { ok: false, message: 'Je bank gaf geen toestemming' + (q.error_description ? ': ' + q.error_description : '.') };
    if (!q.code) return { ok: false, message: 'Geen code ontvangen van de bank.' };
    const s = await call(fetchFn, await requireEb(pending.user), 'POST', '/sessions', { code: String(q.code) });
    if (!s.session_id) return { ok: false, message: 'Enable Banking gaf geen sessie terug.' };
    const accounts = (s.accounts || []).map(a => {
      const id = a.account_id || {};
      const iban = id.iban || (id.other && id.other.identification) || '';
      return { uid: String(a.uid || ''), iban: String(iban).replace(/\s/g, '').toUpperCase(), name: String(a.name || a.product || ''), currency: String(a.currency || 'EUR') };
    });
    const conn = { id: String(s.session_id), aspsp: pending.aspsp, country: pending.country, validUntil: (s.access && s.access.valid_until) || null, createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'), accounts };
    await store.withLock('bank:' + pending.user, async () => {
      const d = await bankData(pending.user);
      d.connections = d.connections.filter(c => !(c.aspsp === conn.aspsp && c.country === conn.country));
      d.connections.push(conn);
      await store.writeJson(bankFile(pending.user), d);
    });
    return { ok: true, message: `${pending.aspsp} is gekoppeld (${accounts.length} rekening${accounts.length === 1 ? '' : 'en'}).` };
  }

  async function connection(user, id) {
    const c = (await bankData(user)).connections.find(x => x.id === id);
    if (!c) throw new BankError('Onbekende bankkoppeling', 404, 'input');
    return c;
  }

  const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

  async function fetchAccount(fetchFn, req, user, b) {
    const c = await requireEb(user);
    const conn = await connection(user, String(b.connectionId || ''));
    const uid = String(b.accountUid || '');
    if (!conn.accounts.some(a => a.uid === uid)) throw new BankError('Onbekende rekening', 404, 'input');
    const psu = {};
    const ip = req.socket && req.socket.remoteAddress;
    if (ip) psu['PSU-IP-Address'] = ip;
    if (req.headers['user-agent']) psu['PSU-User-Agent'] = String(req.headers['user-agent']).slice(0, 200);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(b.dateFrom || '') ? b.dateFrom : isoDay(Date.now() - 90 * 86400000);
    const path = '/accounts/' + encodeURIComponent(uid);
    const list = async fromDate => {
      const txs = [];
      let key = null;
      for (let page = 0; page < 60; page++) {
        const qs = 'date_from=' + fromDate + (key ? '&continuation_key=' + encodeURIComponent(key) : '');
        const r = await call(fetchFn, c, 'GET', `${path}/transactions?${qs}`, null, psu);
        for (const t of r.transactions || []) txs.push(t);
        key = r.continuation_key || null;
        if (!key) break;
      }
      return txs;
    };
    let txs, limited = false;
    const recent = isoDay(Date.now() - 89 * 86400000);
    try { txs = await list(from); }
    catch (e) {
      if (!(e instanceof BankError) || e.kind !== 'api' || from >= isoDay(Date.now() - 90 * 86400000)) throw e;
      txs = await list(recent);
      limited = true;
    }
    let balances = [];
    try { balances = (await call(fetchFn, c, 'GET', `${path}/balances`, null, psu)).balances || []; }
    catch (e) { if (e.kind === 'expired') throw e; }
    return { transactions: txs, balances, limited, dateFrom: limited ? recent : from };
  }

  async function disconnect(fetchFn, user, b) {
    const id = String(b.connectionId || '');
    const c = await config(user);
    if (c) { try { await call(fetchFn, c, 'DELETE', '/sessions/' + encodeURIComponent(id)); } catch (e) { /* toch lokaal verwijderen */ } }
    await store.withLock('bank:' + user, async () => {
      const d = await bankData(user);
      d.connections = d.connections.filter(x => x.id !== id);
      await store.writeJson(bankFile(user), d);
    });
    return { ok: true };
  }

  return { status, saveConfig, aspsps, connect, callback, fetchAccount, disconnect };
}

function callbackPage(r) {
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
  const title = r.ok ? 'Bank gekoppeld' : 'Koppeling niet gelukt';
  const color = r.ok ? '#1baf7a' : '#d9480f';
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Helder</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f5f7fb;color:#14284b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.c{background:#fff;border-radius:14px;padding:28px;max-width:420px;box-shadow:0 2px 12px rgba(20,40,75,.1);text-align:center}.i{width:56px;height:56px;border-radius:50%;background:${color};color:#fff;font-size:30px;line-height:56px;margin:0 auto 12px}
a{display:inline-block;margin-top:16px;background:#14284b;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none}p.s{color:#5c6b85;font-size:14px}</style></head>
<body><div class="c"><div class="i">${r.ok ? '✓' : '!'}</div><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p>${esc(r.message)}</p>
<p class="s">Gebruik je Helder als app op je iPhone? Sluit dit venster en open Helder opnieuw.</p><a href="/?koppeling=1#bank">Naar Helder</a></div></body></html>`;
}

module.exports = { create, callbackPage, BankError, jwt };
