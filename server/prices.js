'use strict';
/*
 * Historische koersen voor je beleggingen, zodat Helder de waarde van je portefeuille op elk moment
 * kan reconstrueren uit je transacties (zonder maandelijks een export op te laden).
 *
 * Bron: Yahoo Finance (publieke koersgrafieken, geen sleutel nodig). Dit is geen officiële API en kan
 * wijzigen; lukt het niet, dan gebruikt Helder je eigen aankoopkoersen. Er worden enkel ISIN's/namen
 * van fondsen verstuurd, geen persoonsgegevens of bedragen.
 */

const UA = 'Mozilla/5.0 (Helder persoonlijke boekhouding; self-hosted)';
const EU_EXCHANGES = ['AMS', 'PAR', 'BRU', 'GER', 'FRA', 'MIL', 'EBS', 'MCE', 'LIS', 'VIE', 'HEL', 'DUB', 'IOB', 'LSE'];

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** Zoekt het Yahoo-symbool bij een ISIN (voorkeur voor een Europese beurs in EUR). */
async function findSymbol(fetchFn, isin, name, preferredCurrency) {
  const q = encodeURIComponent(isin || name);
  const r = await getJson(fetchFn, `https://query1.finance.yahoo.com/v1/finance/search?q=${q}&quotesCount=8&newsCount=0`);
  const quotes = (r.quotes || []).filter(x => x.symbol && ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'].includes(x.quoteType || 'EQUITY'));
  if (!quotes.length) return null;
  const score = x => (EU_EXCHANGES.includes(x.exchange) ? 2 : 0) + (preferredCurrency && preferredCurrency !== 'EUR' && !EU_EXCHANGES.includes(x.exchange) ? 3 : 0);
  return quotes.slice().sort((a, b) => score(b) - score(a))[0].symbol;
}

/** Wekelijkse slotkoersen sinds een datum: [{date, close}] + munt. */
async function history(fetchFn, symbol, fromDate) {
  const p1 = Math.floor(Date.parse(fromDate + 'T00:00:00Z') / 1000) - 7 * 86400;
  const p2 = Math.floor(Date.now() / 1000);
  const r = await getJson(fetchFn, `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1wk&events=div`);
  const res = r.chart && r.chart.result && r.chart.result[0];
  if (!res || !res.timestamp) return null;
  const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const points = [];
  res.timestamp.forEach((ts, i) => {
    const c = closes[i];
    if (c != null && isFinite(c) && c > 0) points.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: c });
  });
  // De koers van vandaag (de weekkoersen staan op de eerste dag van de week): als laatste punt
  const meta = res.meta || {};
  if (meta.regularMarketPrice > 0 && meta.regularMarketTime) {
    const d = new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10);
    const last = points[points.length - 1];
    if (!last || d > last.date) points.push({ date: d, close: meta.regularMarketPrice });
    else if (d === last.date) last.close = meta.regularMarketPrice;
  }
  return { currency: (res.meta && res.meta.currency) || 'EUR', points };
}

/** Koers in een vreemde munt omzetten naar euro (centen per stuk). */
async function toEur(fetchFn, series, fromDate, fxCache) {
  let cur = series.currency;
  let factor = 1;
  if (cur === 'GBp' || cur === 'GBX') { cur = 'GBP'; factor = 0.01; } // Londen noteert in pence
  if (cur === 'EUR') return series.points.map(p => ({ date: p.date, eur: Math.round(p.close * factor * 10000) / 100 }));
  if (!fxCache[cur]) fxCache[cur] = await history(fetchFn, `EUR${cur}=X`, fromDate); // aantal 'cur' per euro
  const fx = (fxCache[cur] && fxCache[cur].points) || [];
  if (!fx.length) return null;
  return series.points.map(p => {
    let rate = fx[0].close;
    for (const f of fx) { if (f.date <= p.date) rate = f.close; else break; }
    return { date: p.date, eur: Math.round(p.close * factor / rate * 10000) / 100 };
  });
}

/**
 * @param instruments [{ key, isin, name, currency, from }]
 * @returns { series: { [key]: { symbol, currency, points: [{date, eur}] } }, errors: { [key]: message } }
 */
async function fetchPrices(fetchFn, instruments, cache) {
  const out = { series: {}, errors: {} };
  const fxCache = {};
  for (const ins of instruments.slice(0, 40)) {
    const cacheKey = (ins.isin || ins.name) + '|' + ins.from + '|v2';
    const hit = cache && cache.get(cacheKey);
    if (hit) { out.series[ins.key] = hit; continue; }
    try {
      const symbol = await findSymbol(fetchFn, ins.isin, ins.name, ins.currency);
      if (!symbol) { out.errors[ins.key] = 'niet gevonden'; continue; }
      const h = await history(fetchFn, symbol, ins.from);
      if (!h || !h.points.length) { out.errors[ins.key] = 'geen koersen'; continue; }
      const points = await toEur(fetchFn, h, ins.from, fxCache);
      if (!points) { out.errors[ins.key] = 'wisselkoers ontbreekt'; continue; }
      out.series[ins.key] = { symbol, currency: h.currency, points };
      if (cache) cache.set(cacheKey, out.series[ins.key]);
    } catch (e) {
      out.errors[ins.key] = e.message;
    }
  }
  return out;
}

const TROY_OZ = 31.1034768;

/** Laatste koers van een Yahoo-symbool. */
async function lastPrice(fetchFn, symbol) {
  const r = await getJson(fetchFn, `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`);
  const res = r.chart && r.chart.result && r.chart.result[0];
  const p = res && res.meta && res.meta.regularMarketPrice;
  if (!(p > 0)) throw new Error('geen koers voor ' + symbol);
  return { price: p, at: new Date(((res.meta.regularMarketTime) || Date.now() / 1000) * 1000).toISOString() };
}

/**
 * Prijs van goud en zilver in eurocent per gram fijn metaal (goud- en zilverfutures in dollar per troy ounce,
 * omgerekend met de euro/dollar-koers). Er wordt niets over de gebruiker verstuurd.
 */
async function metalPrices(fetchFn) {
  const [g, s, fx] = await Promise.all([lastPrice(fetchFn, 'GC=F'), lastPrice(fetchFn, 'SI=F'), lastPrice(fetchFn, 'EURUSD=X')]);
  const perGram = usd => Math.round(usd / fx.price / TROY_OZ * 10000) / 100;
  return { gold: perGram(g.price), silver: perGram(s.price), at: g.at, source: 'Yahoo Finance' };
}

module.exports = { fetchPrices, findSymbol, history, toEur, metalPrices };
