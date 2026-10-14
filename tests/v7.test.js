'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');
const Store = require('../js/store.js');

const tx = (id, date, amount, counterparty, extra) => Object.assign({ id, accountId: 'acc_cash', date, amount, counterparty, description: '', splits: [], source: 'import' }, extra || {});

test('annuleringen: inkomst met hetzelfde bedrag als een eerdere uitgave wordt voorgesteld', () => {
  const s = Store.defaultState();
  s.transactions.push(
    tx('o1', '2026-10-01', -4999, 'BOL.COM'),
    tx('i1', '2026-10-06', 4999, 'bol.com'),          // annulering, zelfde winkel
    tx('o2', '2026-09-01', -2500, 'Zalando'),
    tx('i2', '2026-09-03', 2500, 'Jan Peeters'),      // andere naam, maar binnen 7 dagen
    tx('o3', '2026-06-01', -1000, 'Fnac'),
    tx('i3', '2026-08-15', 1000, 'Iemand'),           // andere naam en te lang geleden
    tx('i4', '2026-09-20', 1000, 'Fnac'),             // vóór... nee: na de uitgave, zelfde naam maar > 60 dagen
    tx('o5', '2026-10-10', -800, 'Shop'),
    tx('i5', '2026-10-08', 800, 'Shop'),              // inkomst vóór de uitgave: geen annulering
    tx('o6', '2026-10-02', -3000, 'Coolblue'),
    tx('o7', '2026-10-03', -3000, 'Coolblue'),
    tx('i6', '2026-10-09', 3000, 'Coolblue'),         // twee kandidaten, maar maar één keer koppelen
    tx('i7', '2026-10-09', 3000, 'Werkgever', { categoryId: 'cat_boodschappen', categorySource: 'manual' }) // zelf ingedeeld
  );
  const pairs = C.cancellationPairs(s);
  const ids = pairs.map(p => p.income.id + '>' + p.expense.id);
  assert.deepEqual(ids, ['i6>o7', 'i1>o1', 'i2>o2']);
  assert.equal(pairs.find(p => p.income.id === 'i1').sameName, true);
  // Koppelen = terugbetaling: niet meer voorgesteld, en netto geen uitgave
  s.transactions.find(t => t.id === 'i1').refundOf = 'o1';
  C.recompute(s);
  assert.ok(!C.cancellationPairs(s).some(p => p.income.id === 'i1'));
  // "Nee": dit paar niet meer voorstellen
  s.transactions.find(t => t.id === 'i6').notRefundOf = ['o7'];
  assert.deepEqual(C.cancellationPairs(s).map(p => p.income.id + '>' + p.expense.id), ['i6>o6', 'i2>o2']);
  // In het venster van een transactie staat de uitgave met hetzelfde bedrag bovenaan
  assert.equal(C.suggestRefundTargets(s, s.transactions.find(t => t.id === 'i2'))[0].tx.id, 'o2');
});

test('regels voor voorschotten zeggen ook voor wie', () => {
  const s = Store.defaultState();
  s.rules.push({ id: 'r1', name: 'Jan', field: 'counterparty', operator: 'name', value: 'jan peeters', categoryId: C.SYS_ADVANCE, person: 'Jan', direction: null, enabled: true, priority: 10 });
  s.transactions.push(tx('t1', '2026-10-01', -2000, 'Jan Peeters'), tx('t2', '2026-10-05', 2000, 'Jan Peeters'));
  C.recompute(s);
  assert.deepEqual(s.transactions.map(t => [t.categoryId, t.person]), [[C.SYS_ADVANCE, 'Jan'], [C.SYS_ADVANCE, 'Jan']]);
  const ov = C.advancesOverview(s);
  assert.ok(ov.people.some(p => p.person === 'Jan'), 'niet meer bij "Onbekend"');
  assert.ok(!ov.people.some(p => p.person === 'Onbekend'));
  // Regel aangepast naar een andere persoon: volgt mee
  s.rules[0].person = 'Jan P.';
  C.recompute(s);
  assert.equal(s.transactions[0].person, 'Jan P.');
  // Regel weg: de persoon van de regel verdwijnt ook
  s.rules = [];
  C.recompute(s);
  assert.equal(s.transactions[0].person, undefined);
  // Een zelf ingevulde persoon wordt nooit door een regel overschreven
  s.transactions[0] = Object.assign(s.transactions[0], { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Mieke' });
  s.rules.push({ id: 'r2', name: 'x', field: 'any', operator: 'name', value: 'jan peeters', categoryId: C.SYS_ADVANCE, person: 'Jan', enabled: true, priority: 10 });
  C.recompute(s);
  assert.equal(s.transactions[0].person, 'Mieke');
});

test('terugbetalingen van vrienden: de uitgave van dezelfde dag staat bovenaan', () => {
  const s = Store.defaultState();
  s.transactions.push(tx('old', '2026-07-20', -1000, 'Colruyt'), tx('o1', '2026-08-06', -2429, 'Takeaway.com AMSTERDAM'),
    tx('i1', '2026-08-06', 850, 'COENS VICTOR'), tx('i2', '2026-08-06', 750, 'VAN HOUCKE HELEEN'));
  assert.equal(C.suggestRefundTargets(s, s.transactions[2])[0].tx.id, 'o1');
  s.transactions[2].refundOf = 'o1';
  const second = C.suggestRefundTargets(s, s.transactions[3])[0];
  assert.equal(second.tx.id, 'o1', 'ook nadat de eerste terugbetaling gekoppeld is');
  assert.equal(second.openAmount, 2429 - 850);
});

test('Belfius-CSV (ook spaarrekening) wordt herkend', () => {
  const Banks = require('../js/banks.js');
  const fs = require('fs'); const path = require('path');
  const r = Banks.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'belfius.csv'), 'utf8'));
  assert.equal(r.profile.id, 'belfius');
  assert.deepEqual(r.accountIbans, ['BE68068200000034']);
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.transactions.map(t => [t.date, t.amount, t.counterparty]), [
    ['2026-09-30', 1234, ''], ['2026-09-15', 50000, 'FELIX COENS'], ['2026-09-02', -100000, 'FELIX COENS']]);
  assert.equal(r.transactions[1].counterpartyIban, 'BE71096123456769');
  assert.match(r.transactions[0].description, /Basisrente · RENTE SPAARREKENING/);
  assert.deepEqual(r.period, { from: '2026-09-02', to: '2026-09-30' });
});
