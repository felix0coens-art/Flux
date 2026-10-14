'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');
const Store = require('../js/store.js');
const Banks = require('../js/banks.js');

const fixture = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

function importKbc(s) {
  const text = fixture('kbc.csv');
  const part = Banks.splitByAccount(Banks.parse(text))[0];
  s.accounts.push({ id: 'k', name: 'KBC', iban: part.accountIban, type: 'zicht' });
  const planned = Banks.plan(s, part, 'k', text, 'kbc.csv');
  Banks.apply(s, planned, part, 'k');
  return { text, part };
}

test('verwijderen: transacties uit een bestand komen bij een nieuwe import niet terug', () => {
  const s = Store.defaultState();
  const { text, part } = importKbc(s);
  const before = s.transactions.length;
  const victims = s.transactions.slice(0, 2);
  assert.equal(Banks.removeTransactions(s, victims.map(t => t.id)).count, 2);
  assert.equal(s.transactions.length, before - 2);
  assert.equal(s.deleted.length, 2, 'Helder onthoudt wat verwijderd werd');
  assert.equal(s.deleted[0].amount, victims[0].amount);
  // Hetzelfde bestand nog eens (met andere naam / iets gewijzigd): de verwijderde rijen blijven weg
  const again = Banks.plan(s, part, 'k', text + '\n', 'kbc-opnieuw.csv');
  assert.equal(again.fresh.length, 0);
  assert.equal(again.duplicates.filter(d => d.deleted).length, 2, 'als eerder verwijderd gemarkeerd');
  // Toch terugzetten: vergeten en opnieuw importeren
  Banks.forgetDeleted(s, s.deleted[0].id);
  assert.equal(Banks.plan(s, part, 'k', text + '\n\n', 'kbc-3.csv').fresh.length, 1);
});

test('verwijderen: ook voor de bankkoppeling en manuele transacties', () => {
  const s = Store.defaultState();
  s.accounts.push({ id: 'k', name: 'KBC', iban: 'BE68539007547034', type: 'zicht' });
  const rows = [
    { date: '2026-10-01', amount: -4520, counterparty: 'COLRUYT', description: '', bankRef: 'eb:E1', balanceAfter: null },
    { date: '2026-10-07', amount: -350, counterparty: 'Bakkerij', description: '', bankRef: null, balanceAfter: null }
  ];
  Banks.applyLinked(s, 'k', Banks.planLinked(s, 'k', rows), { bankName: 'KBC' });
  Banks.removeTransactions(s, s.transactions.map(t => t.id));
  assert.equal(Banks.planLinked(s, 'k', rows).fresh.length, 0, 'opnieuw ophalen brengt ze niet terug');
  // Een CSV met dezelfde transactie wordt ook herkend als verwijderd
  const csv = { transactions: [{ date: '2026-10-02', amount: -4520, counterparty: 'COLRUYT', description: '', bankRef: 'KBC-1', balanceAfter: null }], errors: [], period: null, balance: null, profile: null };
  assert.equal(Banks.plan(s, csv, 'k', 'x', 'x.csv').fresh.length, 0);
  // Manuele transacties gaan ook naar de prullenbak, maar blokkeren nooit een import
  s.transactions.push({ id: 'm1', accountId: 'k', date: '2026-10-03', amount: -500, counterparty: 'Cash', source: 'manual', splits: [] });
  const n = s.deleted.length;
  Banks.removeTransactions(s, ['m1']);
  assert.equal(s.deleted.length, n + 1);
  assert.ok(s.deleted[n].manual);
  assert.ok(!s.transactions.some(t => t.id === 'm1'));
  const same = { date: '2026-10-03', amount: -500, counterparty: 'Cash', description: '', bankRef: 'eb:X9', balanceAfter: null };
  assert.equal(Banks.planLinked(s, 'k', [same]).fresh.length, 1, 'een gelijkaardige banktransactie komt wel binnen');
});

test('verwijderen: koppelingen naar verwijderde transacties worden opgeruimd', () => {
  const s = Store.defaultState();
  s.transactions.push(
    { id: 'a', accountId: 'acc_cash', date: '2026-10-01', amount: -2000, categoryId: C.SYS_ADVANCE, splits: [], source: 'manual', person: 'Jan' },
    { id: 'b', accountId: 'acc_cash', date: '2026-10-05', amount: 2000, categoryId: C.SYS_ADVANCE, splits: [], source: 'manual', person: 'Jan', advanceOf: 'a' },
    { id: 'c', accountId: 'acc_cash', date: '2026-10-06', amount: 500, refundOf: 'a', splits: [], source: 'manual' }
  );
  Banks.removeTransactions(s, ['a']);
  C.recompute(s);
  assert.equal(s.transactions.find(t => t.id === 'b').advanceOf, null);
  assert.equal(s.transactions.find(t => t.id === 'c').refundOf, null);
});

test('verwijderde transacties worden gesynchroniseerd tussen toestellen', () => {
  assert.ok(C.SYNC_COLLECTIONS.includes('deleted'));
  const php = fs.readFileSync(path.join(__dirname, '..', 'php', 'lib', 'helder.php'), 'utf8');
  assert.match(php, /const SYNC_COLLECTIONS = \[[^\]]*'deleted'/, 'ook de PHP-server kent de lijst');
  const s = Store.migrate({ version: 3, transactions: [] });
  assert.deepEqual(s.deleted, []);
});

test('verwijderen is altijd ongedaan te maken (prullenbak)', () => {
  const s = Store.defaultState();
  const { text, part } = importKbc(s);
  const before = JSON.parse(JSON.stringify(s.transactions));
  const r = Banks.removeTransactions(s, s.transactions.map(t => t.id));
  assert.equal(r.count, before.length);
  assert.equal(s.transactions.length, 0);
  assert.equal(Banks.restoreDeleted(s, r.ids), before.length);
  assert.deepEqual(s.transactions.map(t => t.id).sort(), before.map(t => t.id).sort());
  assert.deepEqual(s.transactions.find(t => t.id === before[0].id), before[0], 'alles exact terug, ook categorie en titel');
  assert.equal(s.deleted.length, 0, 'prullenbak leeg');
  // Na terugzetten worden ze bij een nieuwe import weer gewoon herkend als "zat er al in"
  assert.equal(Banks.plan(s, part, 'k', text + '\n', 'opnieuw.csv').fresh.length, 0);
});

test('ook oudere verwijderingen (zonder kopie) kunnen terug', () => {
  const s = Store.defaultState();
  s.accounts.push({ id: 'k', name: 'KBC', iban: 'BE1', type: 'zicht' });
  s.deleted = [{ id: 'd1', accountId: 'k', key: 'ref|R1', bankRef: 'R1', date: '2026-10-01', amount: -1234, counterparty: 'COLRUYT', description: 'Bancontact', importId: 'i1', deletedAt: '2026-10-14T10:00:00.000Z' }];
  assert.equal(Banks.restoreDeleted(s, ['d1']), 1);
  const t = s.transactions[0];
  assert.deepEqual([t.accountId, t.date, t.amount, t.counterparty, t.bankRef, t.source], ['k', '2026-10-01', -1234, 'COLRUYT', 'R1', 'import']);
  assert.equal(s.deleted.length, 0);
});
