'use strict';
/*
 * Koppeling met Saxo Bank via de officiële Saxo OpenAPI. Zelfde gedrag als php/lib/saxo.php.
 *
 * - Je meldt je aan op de website van Saxo zelf (OAuth); Helder ziet je Saxo-wachtwoord nooit.
 * - App Key en App Secret van je Saxo-app staan enkel op de server (datamap/saxo.json) en worden
 *   nooit naar de browser gestuurd. De toegangssleutels (tokens) staan per gebruiker op de server.
 * - Helder leest enkel: posities, saldo, transacties en kasbewegingen. Er worden nooit orders geplaatst.
 * - Saxo-tokens zijn kort geldig: is de sleutel verlopen, dan meld je je opnieuw aan bij Saxo.
 */

const crypto = require('crypto');

class SaxoError extends Error {
  constructor(message, status, kind) { super(message); this.status = status || 502; this.kind = kind || 'api'; }
}

const ENVS = {
  live: { auth: 'https://live.logonvalidation.net', api: 'https://gateway.saxobank.com/openapi' },
  sim: { auth: 'https://sim.logonvalidation.net', api: 'https://gateway.saxobank.com/sim/openapi' }
};

function cents(v) { const n = Number(v); return isFinite(n) ? Math.round(n * 100) : 0; }
function isoDay(v) { return String(v || '').slice(0, 10); }
const first = (...vals) => vals.find(v => v != null && v !== '');

/** Soort kasbeweging uit de omschrijving van een Saxo-boeking. */
function movementType(text, amount) {
  const t = String(text || '');
  if (/withholding|bronheffing|dividend ?tax|roerende voorheffing/i.test(t)) return 'dividend_tax';
  if (/dividend|coupon/i.test(t)) return 'dividend';
  if (isTradeFee(t)) return 'fee';
  if (/share amount|bought|sold|trade|aandelenbedrag|koop|verkoop/i.test(t)) return 'trade';
  if (/interest|rente/i.test(t)) return 'interest';
  if (/commission|exchange fee|stamp|beurstaks|financial transaction tax|\btob\b|custody|fee|kosten|charge/i.test(t)) return 'fee';
  if (/fx|conversion|currency|valuta/i.test(t)) return 'fx';
  if (/cash transfer|deposit|withdraw|transfer|storting|opname|cash amount/i.test(t)) return amount >= 0 ? 'deposit' : 'withdrawal';
  return 'other';
}

const isTradeFee = text => /commission|exchange fee|stamp|beurstaks|financial transaction tax|\btob\b/i.test(String(text || ''));

/**
 * Zet de antwoorden van Saxo om naar het Helder-formaat (zie js/invest.js).
 * Veldnamen verschillen soms per rapport of versie: er wordt naar de gangbare namen gekeken.
 */
function normalize({ balance, netPositions, details, trades, bookings }) {
  const isinOf = {};
  for (const d of details || []) {
    const isin = first(d.IsinCode, d.Isin, d.ISIN);
    if (d.Uic != null && isin) isinOf[String(d.Uic)] = String(isin);
  }
  const positions = (netPositions || []).map(p => {
    const b = p.NetPositionBase || {};
    const v = p.NetPositionView || {};
    const f = p.DisplayAndFormat || {};
    const uic = String(first(b.Uic, p.Uic, ''));
    const isin = isinOf[uic] || String(first(f.Isin, b.IsinCode, '') || '');
    const valueEur = cents(first(v.MarketValueInBaseCurrency, v.MarketValue, v.Exposure, 0));
    const pl = first(v.ProfitLossOnTradeInBaseCurrency, v.ProfitLossOnTrade);
    return {
      key: isin || 'saxo:' + uic, productId: uic, name: String(first(f.Description, f.Symbol, 'Product ' + uic)), isin,
      symbol: String(f.Symbol || ''), currency: String(f.Currency || 'EUR'),
      quantity: Number(first(b.Amount, 0)) || 0, price: Number(first(v.CurrentPrice, v.MarketPrice, 0)) || 0,
      valueEur, costEur: pl != null ? valueEur - cents(pl) : null
    };
  }).filter(p => p.quantity !== 0);
  const cashEur = cents(first(balance && balance.CashBalance, balance && balance.CashAvailableForTrading, 0));

  const tradeList = (trades || []).map((t, i) => {
    const uic = String(first(t.Uic, ''));
    const dir = String(first(t.BuySell, t.Direction, t.TradeEventType, ''));
    let qty = Number(first(t.Amount, t.Quantity, t.TradedAmount, 0)) || 0;
    if (/sell|sold|verkoop/i.test(dir)) qty = -Math.abs(qty);
    else if (/buy|bought|koop/i.test(dir)) qty = Math.abs(qty);
    const booked = Math.abs(cents(first(t.BookedAmountClientCurrency, t.BookedAmountAccountCurrency, t.TradedValue, 0)));
    const fee = Math.abs(cents(first(t.TotalCommission, t.ClientCommission, t.Commission, 0)));
    return {
      id: 'saxo|' + String(first(t.TradeId, t.OrderId, [t.TradeDate, uic, qty, i].join('|'))),
      date: isoDay(first(t.TradeDate, t.ExecutionTime, t.ValueDate)),
      isin: String(first(t.IsinCode, t.Isin, isinOf[uic], '') || ''),
      name: String(first(t.InstrumentDescription, t.Description, t.InstrumentSymbol, 'Product ' + uic)),
      quantity: qty, price: Number(first(t.Price, t.TradePrice, 0)) || 0,
      currency: String(first(t.InstrumentCurrency, t.Currency, 'EUR')),
      totalEur: (qty > 0 ? -booked : booked) || 0, feesEur: -fee || 0
    };
  }).filter(t => t.date && t.quantity !== 0);

  const movements = (bookings || []).map((m, i) => {
    const amount = cents(first(m.AmountClientCurrency, m.AmountAccountCurrency, m.Amount, 0));
    const label = [m.AmountType, m.BkAmountType, m.Category, m.Event, m.CostType, m.Description].filter(Boolean).join(' · ');
    const type = movementType(label, amount);
    const uic = String(first(m.Uic, ''));
    return {
      id: 'saxo|' + String(first(m.BookingId, [m.Date, label, amount, i].join('|'))),
      date: isoDay(first(m.Date, m.ValueDate, m.BookingDate)), type, amountEur: amount,
      description: (type === 'fee' && isTradeFee(label) ? 'Transactiekosten: ' : '') + (label || 'Saxo-boeking') + (m.InstrumentDescription ? ' — ' + m.InstrumentDescription : ''),
      isin: String(first(m.IsinCode, isinOf[uic], '') || '')
    };
  }).filter(m => m.date && m.amountEur !== 0);

  return { positions, cashEur, trades: tradeList, movements };
}

/**
 * @param store { readJson, writeJson, withLock, remove, publicUrl(req), userKeys(user), setUserKey(user, name, value), isOwner(user) }
 */
function create(store) {
  /** De Saxo-app van een gebruiker: zijn eigen app, of voor de eigenaar die in saxo.json. */
  async function config(user) {
    const own = (await store.userKeys(user)).saxo;
    if (own && own.appKey && own.appSecret) return own;
    if (!await store.isOwner(user)) return null;
    const c = await store.readJson('saxo.json', null);
    return c && c.appKey && c.appSecret ? c : null;
  }
  const env = c => ENVS[c && c.env === 'sim' ? 'sim' : 'live'];
  const authBase = c => (process.env.FLUX_SAXO_AUTH_URL || env(c).auth).replace(/\/+$/, '');
  const apiBase = c => (process.env.FLUX_SAXO_API_URL || env(c).api).replace(/\/+$/, '');
  const redirectUrl = req => store.publicUrl(req) + '/api/saxo/callback';
  const tokenFile = user => 'saxo-' + Buffer.from(user).toString('hex') + '.json';

  async function requireSaxo(user) {
    const c = await config(user);
    if (!c) throw new SaxoError('De Saxo-koppeling is nog niet ingesteld', 400, 'config');
    return c;
  }

  async function status(req, user) {
    const c = await config(user);
    const t = await store.readJson(tokenFile(user), null);
    const connected = !!(t && t.refreshToken);
    return {
      configured: !!c, env: c ? (c.env === 'sim' ? 'sim' : 'live') : null, redirectUrl: redirectUrl(req),
      connected, connectedAt: connected ? t.connectedAt || null : null,
      validUntil: connected ? new Date(t.refreshExpires).toISOString() : null,
      expired: connected ? t.refreshExpires <= Date.now() : false
    };
  }

  async function saveConfig(user, b) {
    const owner = await store.isOwner(user);
    if (b.remove) {
      if (owner) await store.remove('saxo.json'); else await store.setUserKey(user, 'saxo', null);
      return { configured: false };
    }
    const appKey = String(b.appKey || '').trim();
    const appSecret = String(b.appSecret || '').trim();
    if (!/^[A-Za-z0-9-]{16,100}$/.test(appKey)) throw new SaxoError('Vul de App Key in (staat bij je app op het Saxo Developer Portal)', 400, 'config');
    if (!/^[A-Za-z0-9-]{16,100}$/.test(appSecret)) throw new SaxoError('Vul de App Secret in (bij je app op het Saxo Developer Portal; klik op “show”)', 400, 'config');
    const c = { appKey, appSecret, env: b.env === 'sim' ? 'sim' : 'live', savedAt: new Date().toISOString() };
    if (owner) await store.writeJson('saxo.json', c); else await store.setUserKey(user, 'saxo', c);
    return { configured: true, env: c.env };
  }

  async function connect(req, user) {
    const c = await requireSaxo(user);
    const state = crypto.randomBytes(24).toString('base64url');
    await store.withLock('saxo-pending', async () => {
      const p = await store.readJson('saxo-pending.json', {});
      const now = Math.floor(Date.now() / 1000);
      for (const k of Object.keys(p)) if (now - (p[k].at || 0) > 3600) delete p[k];
      p[crypto.createHash('sha256').update(state).digest('hex')] = { user, at: now };
      await store.writeJson('saxo-pending.json', p);
    });
    const qs = new URLSearchParams({ response_type: 'code', client_id: c.appKey, state, redirect_uri: redirectUrl(req) });
    return { url: authBase(c) + '/authorize?' + qs.toString() };
  }

  async function tokenCall(fetchFn, c, params) {
    const body = new URLSearchParams(Object.assign({}, params, { client_id: c.appKey, client_secret: c.appSecret })).toString();
    const res = await fetchFn(authBase(c) + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
    const text = await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch (e) { /* geen json */ }
    if (res.ok && j && j.access_token) return j;
    const msg = j ? String(j.error_description || j.error || '') : '';
    if (res.status === 400 || res.status === 401) throw new SaxoError('Saxo weigerde de aanmelding' + (msg ? ' (' + msg + ')' : '') + '. Meld je opnieuw aan bij Saxo.', 401, 'expired');
    throw new SaxoError('Saxo is niet bereikbaar (HTTP ' + res.status + ')', 502, 'api');
  }

  function tokenRecord(j, old) {
    const now = Date.now();
    return {
      accessToken: j.access_token, accessExpires: now + (Number(j.expires_in) || 1200) * 1000 - 30000,
      refreshToken: j.refresh_token || (old && old.refreshToken) || null,
      refreshExpires: now + (Number(j.refresh_token_expires_in) || 2400) * 1000 - 30000,
      connectedAt: (old && old.connectedAt) || new Date(now).toISOString()
    };
  }

  /** Terugkeer van Saxo na het aanmelden. De eenmalige 'state' bepaalt voor welke gebruiker het is. */
  async function callback(fetchFn, req, q) {
    const state = String(q.state || '');
    const hash = crypto.createHash('sha256').update(state).digest('hex');
    const pending = await store.withLock('saxo-pending', async () => {
      const p = await store.readJson('saxo-pending.json', {});
      const hit = p[hash] || null;
      delete p[hash];
      await store.writeJson('saxo-pending.json', p);
      return hit && Math.floor(Date.now() / 1000) - hit.at <= 3600 ? hit : null;
    });
    if (!state || !pending) return { ok: false, message: 'Deze koppeling is verlopen of al gebruikt. Start opnieuw vanuit Helder.' };
    if (q.error) return { ok: false, message: 'Saxo gaf geen toestemming' + (q.error_description ? ': ' + q.error_description : '.') };
    if (!q.code) return { ok: false, message: 'Geen code ontvangen van Saxo.' };
    const c = await requireSaxo(pending.user);
    const j = await tokenCall(fetchFn, c, { grant_type: 'authorization_code', code: String(q.code), redirect_uri: redirectUrl(req) });
    await store.withLock('saxo:' + pending.user, () => store.writeJson(tokenFile(pending.user), tokenRecord(j, null)));
    return { ok: true, message: 'Saxo Bank is gekoppeld. Helder haalt nu je portefeuille op.' };
  }

  /** Geldige toegangssleutel, zo nodig vernieuwd (de vernieuwingssleutel verandert telkens). */
  async function accessToken(fetchFn, req, c, user) {
    return store.withLock('saxo:' + user, async () => {
      const t = await store.readJson(tokenFile(user), null);
      if (!t || !t.refreshToken) throw new SaxoError('Saxo is nog niet gekoppeld', 401, 'expired');
      if (t.accessExpires > Date.now()) return t.accessToken;
      if (t.refreshExpires <= Date.now()) throw new SaxoError('Je Saxo-aanmelding is verlopen. Meld je opnieuw aan bij Saxo.', 401, 'expired');
      const j = await tokenCall(fetchFn, c, { grant_type: 'refresh_token', refresh_token: t.refreshToken, redirect_uri: redirectUrl(req) });
      const nt = tokenRecord(j, t);
      await store.writeJson(tokenFile(user), nt);
      return nt.accessToken;
    });
  }

  async function get(fetchFn, c, token, pathOrUrl) {
    const url = /^https?:/.test(pathOrUrl) ? pathOrUrl : apiBase(c) + pathOrUrl;
    const res = await fetchFn(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    const text = await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch (e) { /* geen json */ }
    if (res.ok) return j || {};
    if (res.status === 401) throw new SaxoError('Je Saxo-aanmelding is verlopen. Meld je opnieuw aan bij Saxo.', 401, 'expired');
    if (res.status === 403) throw new SaxoError('Saxo geeft geen toegang tot deze gegevens (is je app voor je live-rekening goedgekeurd?)', 403, 'config');
    if (res.status === 429) throw new SaxoError('Saxo laat even geen nieuwe verzoeken toe (limiet bereikt). Probeer over een minuut opnieuw.', 429, 'limit');
    const msg = j ? String(j.Message || j.message || j.ErrorCode || '') : '';
    throw new SaxoError('Saxo: ' + (msg || 'HTTP ' + res.status), 502, 'api');
  }

  /** Alle pagina's van een lijst (Saxo geeft een "__next"-link zolang er meer is). */
  async function list(fetchFn, c, token, path) {
    const out = [];
    let next = path;
    for (let i = 0; next && i < 50; i++) {
      const j = await get(fetchFn, c, token, next);
      for (const x of j.Data || []) out.push(x);
      next = j.__next || null;
    }
    return out;
  }

  /** Haalt portefeuille, saldo, transacties en kasbewegingen op, in het Helder-formaat. */
  async function fetchAll(fetchFn, req, user, b) {
    const c = await requireSaxo(user);
    const token = await accessToken(fetchFn, req, c, user);
    const today = new Date().toISOString().slice(0, 10);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String((b && b.fromDate) || '')) ? b.fromDate : '2010-01-01';
    const client = await get(fetchFn, c, token, '/port/v1/clients/me');
    const ck = encodeURIComponent(client.ClientKey || '');
    if (!ck) throw new SaxoError('Saxo gaf geen klantnummer terug', 502, 'api');
    const balance = await get(fetchFn, c, token, '/port/v1/balances/me');
    const netPositions = await list(fetchFn, c, token, '/port/v1/netpositions/me?FieldGroups=NetPositionBase,NetPositionView,DisplayAndFormat&$top=500');
    const range = `FromDate=${from}&ToDate=${today}`;
    const trades = await list(fetchFn, c, token, `/cs/v1/reports/trades/${ck}?${range}`);
    let bookings = [];
    let partial = false;
    try { bookings = await list(fetchFn, c, token, `/cs/v1/reports/bookings/${ck}?${range}`); }
    catch (e) { if (e.kind === 'expired') throw e; partial = true; }
    // ISIN-codes opzoeken (handig om koersen te vinden); niet erg als het niet lukt
    const byType = {};
    for (const p of netPositions) { const nb = p.NetPositionBase || {}; if (nb.Uic != null) (byType[nb.AssetType || 'Stock'] = byType[nb.AssetType || 'Stock'] || new Set()).add(String(nb.Uic)); }
    for (const t of trades) if (t.Uic != null) (byType[t.AssetType || 'Stock'] = byType[t.AssetType || 'Stock'] || new Set()).add(String(t.Uic));
    const details = [];
    for (const [type, uics] of Object.entries(byType)) {
      try { details.push(...await list(fetchFn, c, token, `/ref/v1/instruments/details?Uics=${Array.from(uics).slice(0, 200).join(',')}&AssetTypes=${encodeURIComponent(type)}`)); }
      catch (e) { if (e.kind === 'expired') throw e; }
    }
    const out = normalize({ balance, netPositions, details, trades, bookings });
    out.currency = String(client.DefaultCurrency || balance.Currency || 'EUR');
    out.partial = partial;
    return out;
  }

  async function disconnect(user) {
    await store.withLock('saxo:' + user, () => store.remove(tokenFile(user)));
    return { ok: true };
  }

  return { status, saveConfig, connect, callback, fetchAll, disconnect, redirectUrl };
}

function callbackPage(r) {
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
  const title = r.ok ? 'Saxo gekoppeld' : 'Koppeling niet gelukt';
  const color = r.ok ? '#1baf7a' : '#d9480f';
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Helder</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f5f7fb;color:#14284b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.c{background:#fff;border-radius:14px;padding:28px;max-width:420px;box-shadow:0 2px 12px rgba(20,40,75,.1);text-align:center}.i{width:56px;height:56px;border-radius:50%;background:${color};color:#fff;font-size:30px;line-height:56px;margin:0 auto 12px}
a{display:inline-block;margin-top:16px;background:#14284b;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none}p.s{color:#5c6b85;font-size:14px}</style></head>
<body><div class="c"><div class="i">${r.ok ? '✓' : '!'}</div><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p>${esc(r.message)}</p>
<p class="s">Gebruik je Helder als app op je iPhone? Sluit dit venster en open Helder opnieuw.</p><a href="/?saxo=1#invest">Naar Helder</a></div></body></html>`;
}

module.exports = { create, callbackPage, normalize, movementType, SaxoError };
