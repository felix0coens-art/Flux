'use strict';
/*
 * Rechtstreekse koppeling met Degiro.
 *
 * Degiro heeft geen officiële API; dit gebruikt dezelfde webdiensten als de Degiro-website
 * (zoals open-source bibliotheken als degiro-api doen). Gebruikersnaam, wachtwoord en 2FA-code
 * worden enkel gebruikt om in te loggen en worden NIET bewaard of gelogd; na het ophalen
 * wordt de Degiro-sessie afgesloten.
 *
 * Werkt Degiro zijn website bij, dan kan deze koppeling stoppen met werken. De export-bestanden
 * (Portefeuille / Transacties / Rekeningoverzicht) blijven dan altijd als alternatief bruikbaar.
 */

const BASE = 'https://trader.degiro.nl';
const UA = 'Mozilla/5.0 (Flux persoonlijke boekhouding; self-hosted)';

class DegiroError extends Error {
  constructor(message, code) { super(message); this.code = code; this.status = code === 'otp' || code === 'auth' ? 401 : 502; }
}

function cents(v) { const n = Number(v); return isFinite(n) ? Math.round(n * 100) : 0; }
function ddmmyyyy(d) { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; }
function isoDay(v) { return String(v || '').slice(0, 10); }

async function request(fetchFn, url, opts, sessionId) {
  const headers = Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, opts && opts.headers);
  if (sessionId) headers.Cookie = 'JSESSIONID=' + sessionId;
  const res = await fetchFn(url, Object.assign({}, opts, { headers }));
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* geen json */ }
  return { status: res.status, ok: res.ok, json };
}

async function login(fetchFn, { username, password, otp }) {
  const body = { username, password, isPassCodeReset: false, isRedirectToMobile: false, queryParams: {} };
  let r = await request(fetchFn, BASE + '/login/secure/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const needsOtp = j => j && (j.status === 6 || /totp/i.test(j.statusText || ''));
  let usedOtp = false;
  if (needsOtp(r.json)) {
    if (!otp) throw new DegiroError('Geef de 2FA-code uit je authenticator-app', 'otp');
    usedOtp = true;
    r = await request(fetchFn, BASE + '/login/secure/login/totp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign(body, { oneTimePassword: String(otp).trim() })) });
  }
  if (!r.json || !r.json.sessionId) {
    if (usedOtp || needsOtp(r.json)) throw new DegiroError('De 2FA-code klopt niet of is verlopen. Probeer met een nieuwe code.', 'otp');
    const reason = r.json && r.json.statusText ? ` (${r.json.statusText})` : '';
    throw new DegiroError('Inloggen bij Degiro mislukt: controleer gebruikersnaam en wachtwoord' + reason, 'auth');
  }
  return r.json.sessionId;
}

async function getConfig(fetchFn, sessionId) {
  const cfg = await request(fetchFn, BASE + '/login/secure/config', { method: 'GET' }, sessionId);
  const data = cfg.json && cfg.json.data;
  if (!data || !data.tradingUrl) throw new DegiroError('Degiro gaf geen configuratie terug (sessie geweigerd?)', 'api');
  const client = await request(fetchFn, `${data.paUrl}client?sessionId=${sessionId}`, { method: 'GET' }, sessionId);
  const intAccount = client.json && client.json.data && client.json.data.intAccount;
  if (!intAccount) throw new DegiroError('Kon je Degiro-rekeningnummer niet ophalen', 'api');
  return Object.assign({}, data, { intAccount });
}

function rowValues(row) {
  const out = {};
  for (const f of (row && row.value) || []) out[f.name] = f.value;
  return out;
}

/** Haalt portefeuille, transacties en kasbewegingen op en zet ze om naar het Flux-formaat. */
async function fetchAll(fetchFn, credentials, opts) {
  opts = opts || {};
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const from = opts.fromDate || '2010-01-01';
  const sessionId = await login(fetchFn, credentials);
  try {
    const cfg = await getConfig(fetchFn, sessionId);
    const acct = `intAccount=${cfg.intAccount}&sessionId=${sessionId}`;

    // Portefeuille
    const pf = await request(fetchFn, `${cfg.tradingUrl}v5/update/${cfg.intAccount};jsessionid=${sessionId}?portfolio=0&totalPortfolio=0`, { method: 'GET' }, sessionId);
    if (!pf.json || !pf.json.portfolio) throw new DegiroError('Kon de portefeuille niet ophalen', 'api');
    const rows = (pf.json.portfolio.value || []).map(rowValues);
    const products = rows.filter(r => r.positionType === 'PRODUCT' && Number(r.size) !== 0);
    const total = rowValues({ value: (pf.json.totalPortfolio && pf.json.totalPortfolio.value) || [] });
    const cashEur = cents(total.totalCash != null ? total.totalCash : total.cash != null ? total.cash : 0);

    // Productinfo (naam, ISIN, munt)
    const ids = Array.from(new Set(products.map(r => String(r.id))));
    let info = {};
    if (ids.length) {
      const pi = await request(fetchFn, `${cfg.productSearchUrl}v5/products/info?${acct}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids) }, sessionId);
      info = (pi.json && pi.json.data) || {};
    }
    const positions = products.map(r => {
      const p = info[String(r.id)] || {};
      const plBase = r.plBase && typeof r.plBase === 'object' ? r.plBase.EUR : null;
      return {
        key: p.isin || String(r.id), productId: String(r.id), name: p.name || ('Product ' + r.id), isin: p.isin || '',
        symbol: p.symbol || '', currency: p.currency || 'EUR',
        quantity: Number(r.size) || 0, price: Number(r.price) || 0,
        valueEur: cents(r.value),
        costEur: plBase != null ? -cents(plBase) : null
      };
    });

    // Transacties
    const tr = await request(fetchFn, `${cfg.reportingUrl}v4/transactions?fromDate=${ddmmyyyy(from)}&toDate=${ddmmyyyy(today)}&groupTransactionsByOrder=false&${acct}`, { method: 'GET' }, sessionId);
    const tlist = (tr.json && tr.json.data) || [];
    const missing = Array.from(new Set(tlist.map(t => String(t.productId)).filter(id => !info[id])));
    if (missing.length) {
      const pi = await request(fetchFn, `${cfg.productSearchUrl}v5/products/info?${acct}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(missing) }, sessionId);
      Object.assign(info, (pi.json && pi.json.data) || {});
    }
    const trades = tlist.map(t => {
      const p = info[String(t.productId)] || {};
      const qty = Math.abs(Number(t.quantity) || 0) * (t.buysell === 'S' ? -1 : 1);
      return {
        id: 'api|' + t.id, date: isoDay(t.date), isin: p.isin || '', name: p.name || ('Product ' + t.productId),
        quantity: qty, price: Number(t.price) || 0, currency: p.currency || 'EUR',
        totalEur: cents(t.totalPlusFeeInBaseCurrency != null ? t.totalPlusFeeInBaseCurrency : t.totalInBaseCurrency),
        feesEur: cents(t.totalFeesInBaseCurrency || 0)
      };
    });

    // Kasbewegingen (stortingen, dividenden, kosten, ...)
    const ao = await request(fetchFn, `${cfg.reportingUrl}v6/accountoverview?fromDate=${ddmmyyyy(from)}&toDate=${ddmmyyyy(today)}&${acct}`, { method: 'GET' }, sessionId);
    const cm = (ao.json && ao.json.data && ao.json.data.cashMovements) || [];
    const Invest = require('../js/invest.js');
    const movements = cm.filter(m => (m.currency || 'EUR') === 'EUR' && m.change != null).map((m, i) => ({
      id: 'api|' + (m.id || [m.date, m.description, m.change, i].join('|')),
      date: isoDay(m.date), type: Invest.movementType(m.description || ''),
      amountEur: cents(m.change), description: m.description || '', isin: (info[String(m.productId)] || {}).isin || ''
    }));
    return { positions, cashEur, trades, movements };
  } finally {
    // Sessie afsluiten (niet erg als dit mislukt)
    request(fetchFn, `${BASE}/trading/secure/logout;jsessionid=${sessionId}`, { method: 'GET' }, sessionId).catch(() => {});
  }
}

module.exports = { fetchAll, DegiroError };
