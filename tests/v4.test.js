'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');
const Store = require('../js/store.js');
const Invest = require('../js/invest.js');
const Prices = require('../server/prices.js');

const fixture = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

function degiro() {
  let inv = Invest.mergeInvestments(null, { movements: Invest.parseAccountCsv(fixture('degiro-account.csv')) }, 'degiro-csv');
  inv = Invest.mergeInvestments(inv, { trades: Invest.parseTransactionsCsv(fixture('degiro-transactions.csv')) }, 'degiro-csv');
  return Invest.mergeInvestments(inv, Invest.parsePortfolioCsv(fixture('degiro-portfolio.csv')), 'degiro-csv', '2026-10-13');
}

test('saldo van een rekening op elke datum, teruggerekend uit transacties', () => {
  const s = Store.defaultState();
  s.accounts.push({ id: 'k', name: 'KBC', type: 'zicht', balance: { date: '2026-10-12', amount: 120480 } });
  s.transactions = [
    { id: '1', accountId: 'k', date: '2026-10-01', amount: -92500 },
    { id: '2', accountId: 'k', date: '2026-10-12', amount: -1799 },
    { id: '3', accountId: 'k', date: '2026-10-20', amount: 200000 }
  ];
  assert.equal(C.balanceAt(s, 'k', '2026-09-30'), 214779);
  assert.equal(C.balanceAt(s, 'k', '2026-10-01'), 122279);
  assert.equal(C.balanceAt(s, 'k', '2026-10-12'), 120480);
  assert.equal(C.balanceAt(s, 'k', '2026-10-25'), 320480);
  assert.equal(C.balanceAt(s, 'acc_cash', '2026-10-25'), null, 'zonder gekend saldo geen bedrag');
});

test('Degiro: aantallen en cash op elke datum uit de transacties', () => {
  const inv = degiro();
  assert.deepEqual(Invest.holdingsAt(inv, '2026-01-04'), {});
  assert.deepEqual(Invest.holdingsAt(inv, '2026-01-05'), { IE00B3RBWM25: 10 });
  assert.deepEqual(Invest.holdingsAt(inv, '2026-03-01'), { IE00B3RBWM25: 10, US0378331005: 2 });
  assert.ok(Math.abs(Invest.cashAt(inv, '2026-01-03') - 150000) < 300, 'na de storting van € 1.500');
  assert.equal(Invest.cashAt(inv, '2026-10-13'), 1230, 'verankerd aan de gekende stand');
  const now = Invest.estimateAt(inv, '2026-10-13');
  assert.equal(now.valueEur, 154740, 'reconstructie op de stand-datum = de echte stand');
  const jan = Invest.estimateAt(inv, '2026-01-05');
  assert.ok(Math.abs(jan.positionsEur - 110500) < 10, 'aankoopkoers gebruikt als koers op de aankoopdag');
  assert.equal(jan.quality, 'trades');
});

test('Degiro: marktkoersen gaan voor op aankoopkoersen', () => {
  const inv = degiro();
  inv.market = { series: {
    IE00B3RBWM25: { points: [{ date: '2026-06-26', eur: 12000 }] },
    US0378331005: { points: [{ date: '2026-06-26', eur: 16000 }] }
  } };
  const e = Invest.estimateAt(inv, '2026-06-30');
  assert.equal(e.quality, 'market');
  assert.equal(e.positionsEur, 10 * 12000 + 2 * 16000);
});

test('rendement per jaar zonder jaarexport: geschat uit transacties', () => {
  const inv = {
    movements: [{ id: 'd', date: '2025-03-01', type: 'deposit', amountEur: 100000 }],
    trades: [{ id: 't', date: '2025-03-02', isin: 'X', name: 'X', quantity: 10, totalEur: -100000, feesEur: 0 }],
    history: [{ date: '2026-06-30', valueEur: 130000 }],
    snapshots: [{ date: '2026-06-30', cashEur: 0, positions: [{ key: 'X', quantity: 10, valueEur: 130000 }] }],
    positionsDate: '2026-06-30', positions: [{ key: 'X', isin: 'X', quantity: 10, valueEur: 130000 }], cashEur: 0
  };
  const p = Invest.performance(inv);
  assert.deepEqual(p.missingYearEnds, []);
  assert.deepEqual(p.estimatedYears, [2025, 2026]);
  const y2025 = p.years.find(y => y.year === 2025);
  assert.ok(y2025.endValue > 100000 && y2025.endValue < 130000, 'waarde op 31/12/2025 geïnterpoleerd tussen aankoop en stand');
});

test('reeks: echte waarderingen hebben voorrang op schattingen', () => {
  const inv = degiro();
  const ser = Invest.valueSeries(inv, ['2026-03-31', '2026-10-13']);
  assert.equal(ser[1].actual, true);
  assert.equal(ser[1].valueEur, 154740);
  assert.equal(ser[0].actual, false);
});

test('historische koersen: ISIN opzoeken, omrekenen naar euro (nagebootste Yahoo)', async () => {
  const fake = async url => {
    const u = String(url);
    const j = body => ({ ok: true, json: async () => body });
    if (u.includes('/search?q=US0378331005')) return j({ quotes: [{ symbol: 'AAPL', exchange: 'NMS', quoteType: 'EQUITY' }, { symbol: 'APC.F', exchange: 'FRA', quoteType: 'EQUITY' }] });
    if (u.includes('/search?q=IE00B3RBWM25')) return j({ quotes: [{ symbol: 'VWRL.AS', exchange: 'AMS', quoteType: 'ETF' }] });
    const ts = [Date.parse('2026-01-05T00:00:00Z') / 1000, Date.parse('2026-01-12T00:00:00Z') / 1000];
    if (u.includes('/chart/AAPL')) return j({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: ts, indicators: { quote: [{ close: [200, 210] }] } }] } });
    if (u.includes('/chart/EURUSD%3DX')) return j({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: ts, indicators: { quote: [{ close: [1.25, 1.05] }] } }] } });
    if (u.includes('/chart/VWRL.AS')) return j({ chart: { result: [{ meta: { currency: 'EUR' }, timestamp: ts, indicators: { quote: [{ close: [110.5, null] }] } }] } });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const r = await Prices.fetchPrices(fake, [
    { key: 'US0378331005', isin: 'US0378331005', currency: 'USD', from: '2026-01-01' },
    { key: 'IE00B3RBWM25', isin: 'IE00B3RBWM25', currency: 'EUR', from: '2026-01-01' }
  ]);
  assert.deepEqual(r.errors, {});
  assert.equal(r.series.US0378331005.symbol, 'AAPL', 'USD-aandeel: thuisbeurs in USD verkozen');
  assert.deepEqual(r.series.US0378331005.points.map(p => p.eur), [16000, 20000], 'USD omgerekend met EUR/USD');
  assert.deepEqual(r.series.IE00B3RBWM25.points, [{ date: '2026-01-05', eur: 11050 }], 'lege koersen overgeslagen');
});

test('eigen titel: regels en categorie uit de titel', () => {
  const rule = { field: 'title', operator: 'contains', value: 'cadeau', categoryId: 'cat_cadeaus', enabled: true };
  assert.ok(C.ruleMatches(rule, { amount: -2500, title: 'Verjaardagscadeau mama', counterparty: 'BOL.COM' }));
  assert.ok(C.ruleMatches(Object.assign({}, rule, { field: 'any' }), { amount: -2500, title: 'Cadeau', counterparty: '' }));
  const cats = Store.defaultState().categories;
  assert.equal(C.matchCategory('Verjaardagscadeau mama', cats, 'out').categoryId, 'cat_cadeaus');
  assert.equal(C.matchCategory('Treinticket Brussel', cats, 'out').categoryId, 'cat_vervoer');
  assert.equal(C.matchCategory('Etentje restaurant met collega\'s', cats, 'out').categoryId, 'cat_uitgaan');
});
