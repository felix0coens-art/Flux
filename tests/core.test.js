'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');
const Store = require('../js/store.js');

function baseState(transactions, extra) {
  return Object.assign({
    accounts: [
      { id: 'z', name: 'Zicht', iban: 'BE68 5390 0754 7034', type: 'zicht' },
      { id: 's', name: 'Spaar', iban: 'BE71096123456769', type: 'spaar' }
    ],
    categories: [
      { id: 'food', name: 'Boodschappen', kind: 'expense' },
      { id: 'home', name: 'Huishouden', kind: 'expense' },
      { id: 'resto', name: 'Restaurant', kind: 'expense' },
      { id: 'salary', name: 'Loon', kind: 'income' }
    ],
    rules: [],
    budgets: [],
    subscriptions: {},
    transactions: transactions.map((t, i) => Object.assign({ id: 't' + i, accountId: 'z', counterparty: '', counterpartyIban: '', description: '', splits: [], transferMode: 'auto' }, t))
  }, extra || {});
}

test('parseAmount begrijpt Belgische en internationale notaties', () => {
  assert.equal(C.parseAmount('-12,50'), -1250);
  assert.equal(C.parseAmount('1.234,56'), 123456);
  assert.equal(C.parseAmount('1,234.56'), 123456);
  assert.equal(C.parseAmount('€ 40'), 4000);
  assert.equal(C.parseAmount('+3,4'), 340);
  assert.equal(C.parseAmount('12.5'), 1250);
  assert.equal(C.parseAmount('2.500'), 250000);
  assert.equal(C.parseAmount('15,00-'), -1500);
  assert.ok(Number.isNaN(C.parseAmount('abc')));
});

test('parseDate en addMonths', () => {
  assert.equal(C.parseDate('13/10/2026'), '2026-10-13');
  assert.equal(C.parseDate('2026-01-05'), '2026-01-05');
  assert.equal(C.parseDate('31/02/2026'), null);
  assert.equal(C.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(C.addMonths('2026-11-15', 3), '2027-02-15');
});

test('categorisatieregels op mededeling, tegenpartij en IBAN', () => {
  const s = baseState([
    { date: '2026-10-01', amount: -4520, description: 'Betaling Bancontact COLRUYT Gent' },
    { date: '2026-10-02', amount: -1500, counterparty: 'Action Gent' },
    { date: '2026-10-03', amount: 285000, counterpartyIban: 'BE10 0000 0000 0404', description: 'Loon' },
    { date: '2026-10-04', amount: -2000, description: 'iets anders' }
  ], {
    rules: [
      { id: 'r1', name: 'Colruyt', field: 'description', operator: 'contains', value: 'colruyt', categoryId: 'food', priority: 10 },
      { id: 'r2', name: 'Action', field: 'counterparty', operator: 'startsWith', value: 'action', categoryId: 'home', priority: 20, direction: 'out' },
      { id: 'r3', name: 'Werkgever', field: 'counterpartyIban', operator: 'equals', value: 'BE10000000000404', categoryId: 'salary', priority: 30 }
    ]
  });
  C.recompute(s);
  assert.deepEqual(s.transactions.map(t => t.categoryId), ['food', 'home', 'salary', null]);
  assert.equal(s.transactions[0].categorySource, 'rule');
});

test('regels overschrijven geen manuele categorie', () => {
  const s = baseState([{ date: '2026-10-01', amount: -4520, description: 'COLRUYT', categoryId: 'home', categorySource: 'manual' }], {
    rules: [{ id: 'r1', name: 'Colruyt', field: 'any', operator: 'contains', value: 'colruyt', categoryId: 'food', priority: 10 }]
  });
  C.recompute(s);
  assert.equal(s.transactions[0].categoryId, 'home');
});

test('eerste passende regel wint volgens prioriteit', () => {
  const s = baseState([{ date: '2026-10-01', amount: -1000, description: 'Delhaize restaurant' }], {
    rules: [
      { id: 'b', name: 'Resto', field: 'any', operator: 'contains', value: 'restaurant', categoryId: 'resto', priority: 20 },
      { id: 'a', name: 'Delhaize', field: 'any', operator: 'regex', value: '^delhaize', categoryId: 'food', priority: 10 }
    ]
  });
  C.recompute(s);
  assert.equal(s.transactions[0].categoryId, 'food');
});

test('opgesplitste transacties worden over categorieën verdeeld', () => {
  const s = baseState([{
    date: '2026-10-05', amount: -5500, categoryId: 'food',
    splits: [{ categoryId: 'food', amount: -4000 }, { categoryId: 'home', amount: -1500 }]
  }]);
  const sum = C.summarize(s, C.periodRange('monthly', '2026-10-01'));
  assert.equal(sum.byCategory.food, -4000);
  assert.equal(sum.byCategory.home, -1500);
  assert.equal(sum.expenses, 5500);
  assert.deepEqual(C.validateSplits({ amount: -5500 }, [{ categoryId: 'food', amount: -6000 }]).length, 1);
});

test('interne overschrijvingen tellen niet als inkomen of uitgave', () => {
  const s = baseState([
    { date: '2026-10-02', amount: -30000, accountId: 'z', counterpartyIban: 'BE71096123456769' },
    { date: '2026-10-03', amount: 30000, accountId: 's', counterpartyIban: '' },
    { date: '2026-10-04', amount: -2000, categoryId: 'food' }
  ]);
  C.recompute(s);
  assert.equal(s.transactions[0].isTransfer, true);
  assert.equal(s.transactions[1].isTransfer, true, 'tegenboeking op spaarrekening wordt gekoppeld');
  assert.equal(s.transactions[0].transferPairId, 't1');
  const sum = C.summarize(s, C.periodRange('monthly', '2026-10-01'));
  assert.equal(sum.income, 0);
  assert.equal(sum.expenses, 2000);
  assert.equal(sum.transfers, 30000);
});

test('transfer kan manueel aan- of uitgezet worden', () => {
  const s = baseState([
    { date: '2026-10-02', amount: -30000, counterpartyIban: 'BE71096123456769', transferMode: 'no' },
    { date: '2026-10-02', amount: -5000, transferMode: 'yes' }
  ]);
  C.recompute(s);
  assert.equal(s.transactions[0].isTransfer, false);
  assert.equal(s.transactions[1].isTransfer, true);
});

test('terugbetaling vermindert de oorspronkelijke uitgave in plaats van inkomen te zijn', () => {
  const s = baseState([
    { date: '2026-09-29', amount: -12000, categoryId: 'resto', categorySource: 'manual' },
    { date: '2026-10-02', amount: 4000, description: 'Tikkie etentje', refundOf: 't0' }
  ]);
  C.recompute(s);
  const sep = C.summarize(s, C.periodRange('monthly', '2026-09-01'));
  const oct = C.summarize(s, C.periodRange('monthly', '2026-10-01'));
  assert.equal(sep.expenses, 8000, 'geboekt in de maand van de uitgave');
  assert.equal(oct.income, 0);
  assert.equal(C.refundTotals(s).t0, 4000);
});

test('terugbetaling op een gesplitste uitgave wordt proportioneel verdeeld', () => {
  const s = baseState([
    { date: '2026-10-01', amount: -10000, splits: [{ categoryId: 'food', amount: -7500 }, { categoryId: 'home', amount: -2500 }] },
    { date: '2026-10-03', amount: 1001, refundOf: 't0' }
  ]);
  const lines = C.allocations(s).filter(l => l.refund);
  assert.deepEqual(lines.map(l => [l.categoryId, l.amount]), [['food', 751], ['home', 250]]);
});

test('suggesties voor terugbetalingen', () => {
  const s = baseState([
    { date: '2026-09-19', amount: -14860, counterparty: 'Restaurant De Vitrine' },
    { date: '2026-09-01', amount: -2000, counterparty: 'Bakker' },
    { date: '2026-09-21', amount: 3715, counterparty: 'Payconiq', description: 'Payconiq etentje' }
  ]);
  const sugg = C.suggestRefundTargets(s, s.transactions[2]);
  assert.equal(sugg[0].tx.id, 't0');
  assert.ok(C.looksLikeRefund(s.transactions[2]));
});

test('budgetstatus: ok, waarschuwing, overschreden', () => {
  const s = baseState([
    { date: '2026-10-01', amount: -8500, categoryId: 'food' },
    { date: '2025-10-01', amount: -99999, categoryId: 'food' }
  ]);
  const st = b => C.budgetStatus(s, Object.assign({ categoryId: 'food', period: 'monthly', warnAt: 0.8 }, b), '2026-10-13').status;
  assert.equal(st({ limit: 20000 }), 'ok');
  assert.equal(st({ limit: 10000 }), 'warn');
  assert.equal(st({ limit: 8000 }), 'over');
  const yearly = C.budgetStatus(s, { categoryId: 'food', period: 'yearly', limit: 50000 }, '2026-10-13');
  assert.equal(yearly.spent, 8500);
  assert.equal(yearly.remaining, 41500);
});

test('detectie van terugkerende kosten met vervaldatum en seizoenspatroon', () => {
  const txs = [];
  for (let m = 0; m < 14; m++) {
    const d = C.addMonths('2025-08-05', m);
    const month = Number(d.slice(5, 7));
    txs.push({ date: d, amount: -1799, counterparty: 'NETFLIX.COM' });
    txs.push({ date: C.addMonths('2025-08-12', m), amount: [11, 12, 1, 2, 3].includes(month) ? -16500 : -7800, counterparty: 'ENGIE Electrabel' });
  }
  txs.push({ date: '2025-03-15', amount: -38500, counterparty: 'AG Insurance' });
  txs.push({ date: '2026-03-14', amount: -38500, counterparty: 'AG Insurance' });
  const s = baseState(txs);
  const rec = C.detectRecurring(s, '2026-10-01');
  const netflix = rec.find(r => r.key === 'netflix');
  assert.equal(netflix.frequency.id, 'monthly');
  assert.equal(netflix.fixed, true);
  assert.equal(netflix.nextDue, '2026-10-05');
  assert.equal(netflix.status, 'binnenkort');
  const engie = rec.find(r => r.key.startsWith('engie'));
  assert.equal(engie.seasonal.label, 'Hoger in de winter');
  const ag = rec.find(r => r.key.startsWith('ag insurance'));
  assert.equal(ag.frequency.id, 'yearly');
  assert.equal(ag.nextDue, '2027-03-14');
});

test('onregelmatige winkelbezoeken worden niet als abonnement gezien', () => {
  const days = ['2026-01-02', '2026-01-04', '2026-01-19', '2026-02-02', '2026-02-05', '2026-03-20', '2026-03-22'];
  const s = baseState(days.map((d, i) => ({ date: d, amount: -(2000 + i * 1500), counterparty: 'Delhaize' })));
  assert.equal(C.detectRecurring(s, '2026-04-01').length, 0);
});

test('CSV-import met kolomherkenning en dubbel-detectie', () => {
  const csv = '﻿Rekening;Boekingsdatum;Naam tegenpartij;Rekening tegenpartij;Vrije mededeling;Bedrag;Munt\n' +
    'BE68539007547034;01/10/2026;COLRUYT GENT;;"Betaling ""Bancontact"" Colruyt";-45,20;EUR\n' +
    'BE68539007547034;02/10/2026;Mijn spaar;BE71 0961 2345 6769;Sparen;-300,00;EUR\n' +
    'BE68539007547034;rommel;;;;;\n';
  const { rows, delimiter } = C.parseCSV(csv);
  assert.equal(delimiter, ';');
  const mapping = C.guessMapping(rows[0]);
  assert.equal(mapping.date, 1);
  assert.equal(mapping.counterparty, 2);
  assert.equal(mapping.counterpartyIban, 3);
  assert.equal(mapping.description, 4);
  assert.equal(mapping.amount, 5);
  const res = C.rowsToTransactions(rows.slice(1), mapping, 'z');
  assert.equal(res.transactions.length, 2);
  assert.equal(res.errors.length, 1);
  assert.equal(res.transactions[0].description, 'Betaling "Bancontact" Colruyt');
  assert.equal(res.transactions[0].amount, -4520);
  const again = C.rowsToTransactions(rows.slice(1), mapping, 'z');
  const d = C.dedupe(res.transactions, again.transactions);
  assert.equal(d.fresh.length, 0);
  assert.equal(d.duplicates.length, 2);
});

test('CSV met aparte debet/credit kolommen', () => {
  const { rows } = C.parseCSV('Datum,Omschrijving,Debet,Credit\n2026-10-01,Huur,925.00,\n2026-10-25,Loon,,2850.00\n');
  const m = C.guessMapping(rows[0]);
  const res = C.rowsToTransactions(rows.slice(1), m, 'z');
  assert.deepEqual(res.transactions.map(t => t.amount), [-92500, 285000]);
});

test('distribute verliest geen centen', () => {
  assert.deepEqual(C.distribute(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(C.distribute(-1001, [3, 7]).reduce((a, b) => a + b, 0), -1001);
});

test('demodata is consistent', () => {
  const s = Store.demoState('2026-10-13');
  assert.ok(s.transactions.length > 100);
  assert.ok(s.transactions.some(t => t.isTransfer && t.transferPairId));
  assert.ok(s.transactions.some(t => C.txKind(t, s.categories) === 'repayment'));
  assert.ok(s.demo, 'voorbeelddata is gemarkeerd');
  assert.ok(s.transactions.some(t => t.splits.length));
  const rec = C.detectRecurring(s, '2026-10-13');
  assert.ok(rec.some(r => r.key === 'netflix'));
  assert.ok(!rec.some(r => /colruyt|delhaize|aldi|lidl/.test(r.key)), 'boodschappen zijn geen abonnement');
});
