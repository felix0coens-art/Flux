'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');
const Store = require('../js/store.js');
const Banks = require('../js/banks.js');
const Invest = require('../js/invest.js');

test('symbolen: standaard, geraden uit de naam, of zelf gekozen', () => {
  const cats = Store.defaultState().categories;
  assert.equal(C.categoryIcon(cats.find(c => c.id === 'cat_boodschappen')), '🛒');
  assert.equal(C.categoryIcon({ id: 'x', name: 'Huisdieren', kind: 'expense' }), '🐾');
  assert.equal(C.categoryIcon({ id: 'x', name: 'Loon bij Werkgever NV', kind: 'income' }), '💼');
  assert.equal(C.categoryIcon({ id: 'x', name: 'Iets vreemds', kind: 'income' }), '💶');
  assert.equal(C.categoryIcon({ id: 'cat_boodschappen', name: 'Boodschappen', icon: '🥦' }), '🥦');
});

test('verkochte aandelen: gerealiseerde winst met gemiddelde aankoopprijs', () => {
  const inv = { trades: [
    { id: '1', date: '2024-01-10', isin: 'A', name: 'Aandeel A', quantity: 10, totalEur: -100200, feesEur: -200 }, // 10 × € 100 + € 2 kosten
    { id: '2', date: '2024-06-10', isin: 'A', name: 'Aandeel A', quantity: 10, totalEur: -120200, feesEur: -200 }, // 10 × € 120 + € 2
    { id: '3', date: '2025-03-01', isin: 'A', name: 'Aandeel A', quantity: -5, totalEur: 69800, feesEur: -200 },   // 5 × € 140 − € 2
    { id: '4', date: '2025-01-01', isin: 'B', name: 'Aandeel B', quantity: 4, totalEur: -40000, feesEur: 0 },
    { id: '5', date: '2025-09-01', isin: 'B', name: 'Aandeel B', quantity: -4, totalEur: 30000, feesEur: 0 },
    { id: '6', date: '2025-02-01', isin: 'C', name: 'Nooit verkocht', quantity: 1, totalEur: -5000, feesEur: 0 }
  ], movements: [{ id: 'd', date: '2025-05-01', type: 'dividend', amountEur: 1234, isin: 'A' }] };
  const r = Invest.realized(inv);
  assert.deepEqual(r.positions.map(p => p.key), ['B', 'A'], 'enkel verkochte, recentste verkoop eerst');
  const a = r.positions.find(p => p.key === 'A');
  assert.equal(a.costSold, 55100, 'gemiddelde aankoopprijs € 110,20 × 5');
  assert.equal(a.proceeds, 69800);
  assert.equal(a.result, 14700);
  assert.equal(a.closed, false);
  assert.equal(a.qty, 15);
  assert.equal(a.dividends, 1234);
  const b = r.positions.find(p => p.key === 'B');
  assert.equal(b.result, -10000);
  assert.equal(b.closed, true);
  assert.equal(r.total, 4700);
  // Rendement op wat verkocht is: € 47 winst op € 951 aankoopprijs van de verkochte stuks
  assert.equal(r.costSold, 95100);
  assert.equal(r.proceeds, 99800);
  assert.deepEqual([r.gains, r.losses], [14700, -10000]);
  assert.ok(Math.abs(r.pct - 4700 / 95100) < 1e-12);
});

test('effectieve winst: verkocht + op papier + dividend + rest = waarde − netto inleg', () => {
  const inv = {
    trades: [
      { id: '1', date: '2024-01-10', isin: 'A', name: 'A', quantity: 10, totalEur: -100000, feesEur: 0 },
      { id: '2', date: '2025-03-01', isin: 'A', name: 'A', quantity: -5, totalEur: 70000, feesEur: 0 }
    ],
    positions: [{ isin: 'A', name: 'A', quantity: 5, valueEur: 80000, currency: 'EUR' }],
    cashEur: 71000,
    movements: [
      { id: 'd', date: '2024-01-01', type: 'deposit', amountEur: 100000 },
      { id: 'v', date: '2025-05-01', type: 'dividend', amountEur: 1500, isin: 'A' },
      { id: 'k', date: '2025-06-01', type: 'fee', amountEur: -500 }
    ]
  };
  const p = Invest.profit(inv);
  assert.equal(p.total, 80000 + 71000 - 100000);
  assert.equal(p.realized, 20000, 'verkocht voor € 700, gekocht voor € 500');
  assert.equal(p.unrealized, 30000, 'nog 5 stuks: € 800 waard, gekocht voor € 500');
  assert.equal(p.dividends, 1500);
  assert.equal(p.realized + p.unrealized + p.dividends + p.other, p.total);
  assert.equal(p.byYear['2025'], 20000);
  assert.equal(p.realizedUntil('2025-02-28'), 0);
  assert.equal(p.realizedUntil('2025-03-01'), 20000);
  assert.ok(Math.abs(p.pct - 0.51) < 1e-12);
});

test('startdatum: oudere transacties worden bij elke bank overgeslagen', () => {
  const s = Store.defaultState();
  s.accounts.push({ id: 'k', name: 'KBC', iban: 'BE1', type: 'zicht' }, { id: 'a', name: 'Argenta', iban: 'BE2', type: 'zicht' });
  s.settings.dataFrom = '2026-01-01';
  const parsed = { transactions: [
    { date: '2025-12-31', amount: -100, counterparty: 'Oud', description: '', bankRef: 'R1', balanceAfter: null },
    { date: '2026-01-02', amount: -200, counterparty: 'Nieuw', description: '', bankRef: 'R2', balanceAfter: null }
  ], errors: [], period: null, balance: null, profile: null };
  const p = Banks.plan(s, parsed, 'k', 'x', 'k.csv');
  assert.deepEqual(p.fresh.map(t => t.counterparty), ['Nieuw']);
  assert.equal(p.tooOld.length, 1);
  const l = Banks.planLinked(s, 'a', parsed.transactions.map(t => Object.assign({}, t, { bankRef: 'eb:' + t.bankRef })));
  assert.deepEqual(l.fresh.map(t => t.counterparty), ['Nieuw'], 'ook voor de bankkoppeling');
  // Oudere transacties die er al in zitten weghalen
  s.transactions.push({ id: 'o', accountId: 'k', date: '2025-06-01', amount: -1, source: 'import', splits: [] }, { id: 'm', accountId: 'acc_cash', date: '2025-06-01', amount: -1, source: 'manual', splits: [] });
  assert.equal(Banks.trimBefore(s, '2026-01-01'), 1);
  assert.ok(s.transactions.some(t => t.id === 'm'), 'manuele transacties blijven');
  assert.deepEqual(Banks.accountStarts(s), {});
});

test('voorschotten: personen en voorstellen voor terugbetalingen', () => {
  const s = Store.defaultState();
  s.people = [{ id: 'p1', name: 'Pieter', ibans: ['BE71096123456769'] }];
  s.transactions.push(
    { id: 'v1', accountId: 'acc_cash', date: '2026-09-01', amount: -6000, categoryId: C.SYS_ADVANCE, person: 'Pieter', splits: [], source: 'manual' },
    { id: 'v2', accountId: 'acc_cash', date: '2026-09-02', amount: -1500, categoryId: C.SYS_ADVANCE, person: 'Sofie', splits: [], source: 'manual' },
    { id: 'i1', accountId: 'acc_cash', date: '2026-09-10', amount: 3000, counterparty: 'P. JANSSENS', counterpartyIban: 'BE71 0961 2345 6769', splits: [], source: 'manual' },
    { id: 'i2', accountId: 'acc_cash', date: '2026-09-11', amount: 1500, counterparty: 'SOFIE DE SMET', splits: [], source: 'manual' },
    { id: 'i3', accountId: 'acc_cash', date: '2026-09-12', amount: 9999, counterparty: 'WERKGEVER', splits: [], source: 'manual' }
  );
  const list = C.personList(s);
  assert.deepEqual(list.map(p => p.name).sort(), ['Pieter', 'Sofie'], 'aangemaakt + uit voorschotten');
  assert.equal(list.find(p => p.name === 'Pieter').stats.open, 6000);
  assert.deepEqual(C.suggestRepayments(s, 'Pieter', ['BE71096123456769'], '2026-10-14').map(x => [x.tx.id, x.why]), [['i1', 'gekende IBAN']]);
  assert.deepEqual(C.suggestRepayments(s, 'Sofie', [], '2026-10-14').map(x => x.tx.id), ['i2'], 'op naam');
  assert.deepEqual(C.suggestRepayments(s, 'Jan', [], '2026-10-14'), []);
  assert.deepEqual(C.suggestRepayments(s, 'O.K. (test)', [], '2026-10-14'), [], 'speciale tekens in een naam breken niets');
});

test('personen en verwijderde transacties worden gesynchroniseerd', () => {
  assert.ok(C.SYNC_COLLECTIONS.includes('people'));
  assert.deepEqual(Store.migrate({ version: 3 }).people, []);
});
