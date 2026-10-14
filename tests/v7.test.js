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

test('voorschot kwijtschelden: telt als uitgave in de gekozen categorie en staat niet meer open', () => {
  const s = Store.defaultState();
  s.transactions.push(tx('a1', '2026-09-01', -3000, 'Restaurant', { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Jan' }),
    tx('a2', '2026-09-10', 1000, 'Jan', { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Jan' }));
  s.people.push({ id: 'p1', name: 'Jan', ibans: [], forgiven: [{ id: 'f1', date: '2026-10-01', amount: 2000, categoryId: 'cat_boodschappen', note: 'cadeau' }] });
  C.recompute(s);
  const jan = C.advancesOverview(s).people.find(p => p.person === 'Jan');
  assert.deepEqual([jan.advanced, jan.repaid, jan.forgiven, jan.open], [3000, 1000, 2000, 0]);
  assert.equal(jan.items[0].forgiven, 2000);
  const oct = C.summarize(s, { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(oct.expenses, 2000, 'kwijtschelding is een uitgave op de datum van het kwijtschelden');
  assert.equal(oct.byCategory.cat_boodschappen, -2000);
  const sep = C.summarize(s, { start: '2026-09-01', end: '2026-09-30' });
  assert.equal(sep.expenses, 0, 'het voorschot zelf blijft geen uitgave');
  // Ongedaan maken: weer open
  s.people[0].forgiven = [];
  assert.equal(C.advancesOverview(s).people.find(p => p.person === 'Jan').open, 2000);
});

test('voorschotten: titel, en per voorschot afhandelen (transactie, kwijtschelden, gesplitste betaling)', () => {
  const s = Store.defaultState();
  s.transactions.push(
    tx('a1', '2026-09-01', -3000, 'Ticketmaster', { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Jan', title: 'Concertticket' }),
    tx('a2', '2026-09-05', -5000, 'Restaurant', { splits: [{ categoryId: C.SYS_ADVANCE, amount: -2000, person: 'Jan', note: 'Etentje' }, { categoryId: 'cat_boodschappen', amount: -3000 }] }),
    // Terugbetaling specifiek voor het etentje (niet voor het oudere ticket)
    tx('r1', '2026-09-10', 2000, 'Jan', { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Jan', advanceOf: 'a2:0' }));
  s.people.push({ id: 'p1', name: 'Jan', ibans: [], forgiven: [{ id: 'f1', date: '2026-10-01', amount: 1000, categoryId: 'cat_boodschappen', advanceOf: 'a1' }] });
  C.recompute(s);
  assert.equal(s.transactions.find(t => t.id === 'r1').advanceOf, 'a2:0', 'koppeling aan een splitsing blijft bewaard');
  const items = C.advancesOverview(s).items;
  const ticket = items.find(i => i.txId === 'a1'), meal = items.find(i => i.txId === 'a2');
  assert.deepEqual([ticket.title, meal.title, meal.split], ['Concertticket', 'Etentje', 0]);
  assert.deepEqual([meal.repaid, meal.amount], [2000, 2000], 'etentje terugbetaald');
  assert.deepEqual([ticket.repaid, ticket.forgiven], [1000, 1000], 'deel van het ticket kwijtgescholden');
  assert.equal(C.advancesOverview(s).people[0].open, 2000);
});

test('voorschotten als rekening-courant: zelf kiezen wat vereffend is, en een overschot als inkomst', () => {
  const s = Store.defaultState();
  s.categories.push({ id: 'cat_ander_inkomen', name: 'Andere inkomsten', kind: 'income', color: '#888' });
  s.transactions.push(
    tx('a1', '2026-09-01', -3000, 'Ticket', { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Jan', title: 'Oud' }),
    tx('a2', '2026-09-20', -2000, 'Resto', { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Jan', title: 'Nieuw' }),
    // Jan betaalt het nieuwe voorschot terug, plus 500 te veel
    tx('r1', '2026-09-25', 2500, 'Jan', { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Jan', advanceOf: 'a2' }));
  C.recompute(s);
  let ov = C.advancesOverview(s);
  const oud = ov.items.find(i => i.txId === 'a1'), nieuw = ov.items.find(i => i.txId === 'a2');
  assert.equal(nieuw.repaid, 2000, 'het nieuwe voorschot is vereffend');
  assert.equal(oud.repaid, 500, 'de rest gaat naar het oudste open voorschot');
  assert.deepEqual(nieuw.settledBy.map(b => b.ref), ['r1']);
  const jan = ov.people.find(p => p.person === 'Jan');
  assert.deepEqual(jan.ledger.map(r => [r.kind, r.balance]), [['advance', 3000], ['advance', 5000], ['repayment', 2500]]);
  // Te veel terugbetaald → rest als inkomst
  s.transactions.push(tx('r2', '2026-10-01', 3000, 'Jan', { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Jan' }));
  C.recompute(s);
  assert.equal(C.advancesOverview(s).people[0].open, -500, '500 te veel terug');
  s.people.push({ id: 'p1', name: 'Jan', ibans: [], surplus: [{ id: 'x1', date: '2026-10-02', amount: 500, categoryId: 'cat_ander_inkomen' }] });
  ov = C.advancesOverview(s);
  assert.equal(ov.people[0].open, 0, 'na het inboeken staat alles op nul');
  const oct = C.summarize(s, { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(oct.income, 500, 'het overschot is een inkomst');
});

test('acties: transacties bundelen, blijven gewone uitgaven, met wat nog terug moet komen', () => {
  const s = Store.defaultState();
  assert.ok(C.SYNC_COLLECTIONS.includes('actions'));
  const php = require('fs').readFileSync(require('path').join(__dirname, '..', 'php', 'lib', 'helder.php'), 'utf8');
  assert.match(php, /const SYNC_COLLECTIONS = \[[^\]]*'actions'/);
  s.actions.push({ id: 'act1', name: 'Kleren voor mama', expectBack: true, person: 'mama' });
  s.transactions.push(
    tx('k1', '2026-10-01', -6000, 'Zara', { categoryId: 'cat_boodschappen', categorySource: 'manual', actions: ['act1'] }),
    tx('k2', '2026-10-03', -4000, 'H&M', { categoryId: 'cat_boodschappen', categorySource: 'manual', actions: ['act1'] }),
    tx('m1', '2026-10-10', 7000, 'Mama', { actions: ['act1'] }),
    tx('x', '2026-10-04', -1000, 'Colruyt', { categoryId: 'cat_boodschappen', categorySource: 'manual' }));
  C.recompute(s);
  const sum = C.actionSummary(s, s.actions[0]);
  assert.deepEqual([sum.txs.length, sum.out, sum.back, sum.open], [3, 10000, 7000, 3000]);
  assert.equal(C.summarize(s, { start: '2026-10-01', end: '2026-10-31' }).byCategory.cat_boodschappen, -11000, 'de kleren blijven gewone uitgaven');
  assert.equal(C.advancesOverview(s).people.length, 0, 'en zijn geen voorschot');
  // Actie verwijderd: de koppeling verdwijnt, de transacties blijven
  s.actions = [];
  C.recompute(s);
  assert.equal(s.transactions.find(t => t.id === 'k1').actions, undefined);
  assert.equal(s.transactions.length, 4);
});

test('terug naar te verwerken: een regel vult de categorie niet meteen opnieuw in', () => {
  const s = Store.defaultState();
  s.rules.push({ id: 'r1', name: 'Eni', field: 'counterparty', operator: 'name', value: 'eni', categoryId: 'cat_boodschappen', enabled: true, priority: 10 });
  s.transactions.push(tx('t1', '2026-10-01', -5000, 'ENI'));
  C.recompute(s);
  assert.equal(s.transactions[0].categoryId, 'cat_boodschappen');
  // Zo zet de knop "Terug naar te verwerken" de transactie terug (resetToTodo in js/app/25-transactie.js)
  Object.assign(s.transactions[0], { categoryId: null, categorySource: 'manual', ruleId: null });
  C.recompute(s);
  assert.equal(s.transactions[0].categoryId, null);
  assert.equal(C.txKind(s.transactions[0], s.categories), 'todo');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(src, /function resetToTodo\(t\) \{\s*t\.categoryId = null; t\.categorySource = 'manual'/);
  assert.equal((src.match(/value === ''\) \{?\s*resetToTodo\(t\)/g) || []).length, 2, 'lijst en selectie gebruiken allebei resetToTodo');
});

test('js/app.js is exact de samenvoeging van de stukken in js/app/', () => {
  const { build } = require('../scripts/build-app.js');
  const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.equal(build() === app, true, 'voer "npm run build:app" uit na het wijzigen van een stuk in js/app/');
});
