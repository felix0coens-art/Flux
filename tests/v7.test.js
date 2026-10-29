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

test('fysiek goud: cadeaus tellen als vermogen zonder inleg, eigen verkoopwaarde gaat voor', () => {
  const kr = C.METAL_PRESETS.find(p => p.id === 'krugerrand');
  const eq = C.METAL_PRESETS.find(p => p.id === 'krugerrand-eq');
  const s = Store.defaultState();
  s.metals.push(
    { id: 'm1', name: kr.name, metal: 'gold', weight: kr.weight, purity: kr.purity, count: 2, origin: 'bought', buyPrice: 500000 },
    { id: 'm2', name: 'Extra munten', metal: 'gold', weight: eq.weight, purity: eq.purity, count: 1, origin: 'gift', estimated: true },
    { id: 'm3', name: '20 frank', metal: 'gold', weight: 6.45, purity: 900, count: 3, origin: 'gift', sellValue: 60000 }
  );
  const m = C.metalsSummary(s, { gold: 10000, silver: 100 }); // 100 euro per gram
  const [a, b, c] = m.items;
  assert.equal(Math.round(a.fine * 100) / 100, 31.1, 'Krugerrand: 1 troy ounce fijn goud');
  assert.equal(a.value, 2 * Math.round(a.fine * 10000));
  assert.equal(a.gain, a.value - 500000);
  assert.equal(b.value, Math.round(b.fine * 10000), 'schatting: één Krugerrand-equivalent');
  assert.equal(b.cost, null); assert.equal(b.gain, null);
  assert.equal(c.valueSource, 'manual'); assert.equal(c.value, 180000, 'eigen verkoopwaarde per munt gaat voor op de prijs per gram');
  assert.equal(m.cost, 500000, 'cadeaus zijn geen inleg');
  assert.equal(m.giftValue, b.value + c.value);
  assert.equal(m.value, a.value + b.value + c.value);
  // Zonder goudprijs: enkel wat een eigen waarde heeft
  const none = C.metalsSummary(s, null);
  assert.equal(none.value, 180000); assert.equal(none.missing, 2);
  // Cadeaus zijn geen transacties: geen uitgave en geen belegging
  const sum = C.summarize(C.recompute(s), { start: '2000-01-01', end: '2100-01-01' });
  assert.equal(sum.expenses, 0); assert.equal(sum.invested, 0);
  assert.ok(C.SYNC_COLLECTIONS.includes('metals'), 'munten worden gesynchroniseerd');
});

test('munten: meer soorten en een eigen waardegeschiedenis (verzamelwaarde) die voorgaat', () => {
  const P = id => C.METAL_PRESETS.find(p => p.id === id);
  for (const id of ['fr10', 'napoleon', 'fr40', 'fr50', 'fr100']) assert.ok(P(id), 'Napoleon-variant ' + id);
  assert.equal(Math.round(P('fr40').weight * P('fr40').purity / 10) / 100, 11.61, '40 frank: 11,61 g fijn goud');
  assert.ok(new Set(C.METAL_PRESETS.map(p => p.id)).size === C.METAL_PRESETS.length, 'unieke id\'s');
  const s = Store.defaultState();
  s.metals.push({ id: 'n', name: '20 frank 1870', metal: 'gold', weight: 6.452, purity: 900, count: 2, origin: 'gift', year: '1870', grade: 'PR',
    valuations: [{ id: 'v2', date: '2026-09-01', value: 70000, source: 'veiling' }, { id: 'v1', date: '2025-01-10', value: 50000, source: 'catalogus' }] });
  s.metals.push({ id: 'o', name: 'oud', metal: 'gold', weight: 6.452, purity: 900, count: 1, origin: 'gift', sellValue: 55000 });
  const m = C.metalsSummary(s, { gold: 10000 });
  const n = m.items[0];
  assert.equal(n.market.date, '2026-09-01', 'de jongste waardering geldt');
  assert.equal(n.value, 140000);
  assert.equal(n.metalUnit, Math.round(6.452 * 0.9 * 10000));
  assert.equal(n.premium, 70000 - n.metalUnit, 'meerwaarde boven het goud');
  assert.equal(m.items[1].value, 55000, 'oude eigen verkoopwaarde blijft gelden');
  assert.equal(m.premium, n.premium * 2 + (55000 - m.items[1].metalUnit));
});

test('verkochte aandelen tegenover vandaag, en favorieten met een eigen startkoers', () => {
  const Invest = require('../js/invest.js');
  const inv = {
    trades: [
      { id: 'b', date: '2023-01-10', isin: 'US0000000001', name: 'Voorbeeld NV', quantity: 10, totalEur: -100000, feesEur: 0 },
      { id: 's', date: '2024-06-01', isin: 'US0000000001', name: 'Voorbeeld NV', quantity: -10, totalEur: 150000, feesEur: 0 }
    ],
    market: { series: { US0000000001: { points: [{ date: '2024-06-03', eur: 15000 }, { date: '2026-10-12', eur: 20000 }] } } }
  };
  const [p] = Invest.soldVsToday(inv);
  assert.equal(p.sellPrice, 15000, 'verkocht à 150 euro');
  assert.equal(p.todayValue, 200000, '10 stuks à 200 euro vandaag');
  assert.equal(p.diff, 50000); assert.equal(p.diffPct, 50000 / 150000);
  assert.equal(p.lastDate, '2026-10-12');
  // Favorieten
  const list = [
    { id: 'a', name: 'A', startDate: '2025-01-15' },
    { id: 'b', name: 'B', startDate: '2025-01-15', startPrice: 9000 },
    { id: 'c', name: 'C', startDate: '2025-01-15', startPrice: 1000, nowPrice: 1500, nowDate: '2026-10-15' }
  ];
  const pts = { points: [{ date: '2025-01-13', eur: 10000 }, { date: '2026-10-12', eur: 12500 }], symbol: 'X' };
  const [a, b, c] = Invest.watchSummary(list, { a: pts, b: pts });
  assert.equal(a.start, 10000, 'zonder eigen startkoers: de koers rond de startdatum');
  assert.equal(a.now, 12500); assert.equal(a.changePct, 0.25);
  assert.equal(b.start, 9000, 'eigen startkoers gaat voor'); assert.equal(b.startSource, 'manual');
  assert.equal(Math.round(b.changePct * 1000) / 1000, 0.389);
  assert.equal(c.now, 1500); assert.equal(c.changePct, 0.5, 'zelf ingevulde koers van vandaag');
  assert.ok(C.SYNC_COLLECTIONS.includes('watchlist'));
});

test('synchronisatie ziet ook wijzigingen binnenin een object (bv. instellingen, bonnetjes)', () => {
  const s = Store.defaultState();
  s.settings.investLayout = { order: ['a', 'b'], hidden: ['a'] };
  s.transactions.push(tx('t1', '2026-10-01', -100, 'X', { attachments: [{ id: 'f1', name: 'bon.jpg', type: 'image/jpeg', size: 10 }] }));
  const snap = C.snapshot(s);
  s.settings = Object.assign({}, s.settings, { investLayout: { order: ['a', 'b'], hidden: [] } });
  s.transactions[0].attachments[0].name = 'kasticket.jpg';
  const changed = C.stampChanges(snap, s);
  assert.ok(changed.includes('settings:'), 'geneste instelling gewijzigd');
  assert.ok(changed.includes('transactions:t1'), 'naam van een bonnetje gewijzigd');
  // Zelfde inhoud in een andere volgorde = geen wijziging
  const snap2 = C.snapshot(s);
  s.settings = Object.assign({}, s.settings, { investLayout: { hidden: [], order: ['a', 'b'] } });
  assert.deepEqual(C.stampChanges(snap2, s), []);
});

test('beleggingen: verdeling per soort (aandelen, ETF, obligaties, goud, cash), met eigen indeling', () => {
  const Invest = require('../js/invest.js');
  const inv = { positionsDate: '2026-10-14', cashEur: 5000, movements: [], trades: [], positions: [
    { key: 'A', name: 'Apple Inc', valueEur: 30000 },
    { key: 'V', name: 'Vanguard FTSE All-World UCITS ETF (Acc)', valueEur: 50000 },
    { key: 'B', name: 'iShares Core Global Aggregate Bond UCITS ETF', valueEur: 15000 },
    { key: 'G', name: 'Xetra-Gold ETC', valueEur: 10000 },
    { key: 'M', name: 'Solvay', valueEur: 2000 }
  ] };
  const g = Object.fromEntries(Invest.allocation(inv, { metalsValue: 20000 }).map(x => [x.id, x.value]));
  assert.deepEqual(g, { stock: 32000, etf: 50000, bond: 15000, metal: 30000, cash: 5000 }, 'Solvay is een aandeel');
  const g2 = Object.fromEntries(Invest.allocation(inv, { overrides: { M: 'etf' } }).map(x => [x.id, x.value]));
  assert.equal(g2.etf, 52000, 'eigen indeling gaat voor'); assert.equal(g2.stock, 30000);
  assert.equal(g2.metal, 10000, 'zonder fysiek goud enkel de goud-ETC');
});

test('regels kunnen ook aan een actie koppelen (elke maand een nieuwe), en verrekenen telt als terugbetaald', () => {
  const s = Store.defaultState();
  s.rules.push({ id: 'rt', name: 'Telenet', field: 'counterparty', operator: 'name', value: 'telenet', categoryId: null, enabled: true, priority: 10,
    action: { name: 'Telenet terugvragen', perMonth: true, expectBack: true, person: 'huisgenoot', since: '2026-09-01' } });
  s.transactions.push(tx('t8', '2026-08-03', -6000, 'TELENET'), tx('t9', '2026-09-03', -6000, 'TELENET'), tx('t10', '2026-10-03', -6100, 'Telenet BV'), tx('x', '2026-10-04', -500, 'Bakker'));
  C.recompute(s);
  const ids = s.transactions.map(t => (t.actions || []).join(','));
  assert.deepEqual(ids, ['', 'act_r_rt_2026-09', 'act_r_rt_2026-10', ''], 'vanaf september, per maand');
  const a = s.actions.find(x => x.id === 'act_r_rt_2026-10');
  assert.equal(a.name, 'Telenet terugvragen — okt 2026'); assert.equal(a.expectBack, true); assert.equal(a.person, 'huisgenoot');
  assert.equal(C.actionSummary(s, a).open, 6100);
  assert.equal(s.transactions[2].categoryId, null, 'regel zonder categorie laat de categorie open');
  // Zelf uit de actie gehaald: niet opnieuw toegevoegd
  delete s.transactions[2].actions;
  C.recompute(s);
  assert.equal(s.transactions[2].actions, undefined);
  assert.equal(s.actions.filter(x => x.ruleId === 'rt').length, 2, 'geen dubbele acties');
  // Verrekenen (bv. via Tricount)
  s.transactions.push(tx('v', '2026-10-05', -3000, 'Restaurant', { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Jan' }));
  s.people.push({ id: 'pj', name: 'Jan', ibans: [], forgiven: [{ id: 'f1', date: '2026-10-06', amount: 3000, categoryId: 'cat_boodschappen', reason: 'settled', note: 'Tricount' }] });
  C.recompute(s);
  const it = C.advancesOverview(s).items.find(x => x.txId === 'v');
  assert.equal(it.repaid, 3000); assert.equal(it.settledBy[0].reason, 'settled');
});

test('regel: een deel van elke rekening is een voorschot (bv. de helft van Telenet voor je huisgenoot)', () => {
  const s = Store.defaultState();
  s.rules.push({ id: 'rs', name: 'Telenet', field: 'counterparty', operator: 'name', value: 'telenet', categoryId: 'cat_boodschappen', enabled: true, priority: 10, share: { person: 'Huisgenoot', mode: 'pct', value: 50 } });
  s.transactions.push(tx('a', '2026-09-03', -6001, 'TELENET'), tx('b', '2026-10-03', -6000, 'TELENET'));
  C.recompute(s);
  assert.deepEqual(C.splitLines(s.transactions[0]).map(l => [l.categoryId, l.amount, l.person]), [[C.SYS_ADVANCE, -3001, 'Huisgenoot'], ['cat_boodschappen', -3000, '']]);
  const ov = C.advancesOverview(s);
  assert.equal(ov.people.find(p => p.person === 'Huisgenoot').open, 6001);
  // Vast bedrag
  s.rules[0].share = { person: 'Huisgenoot', mode: 'amount', value: 2500 };
  C.recompute(s);
  assert.equal(s.transactions[1].splits[0].amount, -2500);
  // Zelf aangepast: de regel blijft eraf
  s.transactions[1].splits = [{ categoryId: C.SYS_ADVANCE, amount: -1000, person: 'Huisgenoot' }];
  s.transactions[1].categorySource = 'manual'; delete s.transactions[1].splitByRule;
  C.recompute(s);
  assert.equal(s.transactions[1].splits[0].amount, -1000);
  // Regel weg: de splitsing van de regel verdwijnt
  s.rules = [];
  C.recompute(s);
  assert.deepEqual(s.transactions[0].splits, []); assert.equal(s.transactions[0].categoryId, null);
  // Een splitsing door een regel telt niet als eigen wijziging voor de synchronisatie
  const t = Object.assign({}, s.transactions[1]);
  assert.ok(C.entityHash(t));
});

test('uitgaven: het diagram per categorie telt hetzelfde als het totaal (na terugbetalingen)', () => {
  const s = Store.demoState('2026-10-15');
  C.recompute(s);
  for (const r of [{ start: '2026-10-01', end: '2026-10-31' }, { start: '2025-01-01', end: '2026-12-31' }]) {
    const sum = C.summarize(s, r);
    const pos = Object.values(sum.expenseBy).reduce((a, v) => a + v, 0);
    assert.equal(pos, sum.expenses, 'som per categorie = totale uitgaven');
  }
  // Een terugbetaling maakt de categorie kleiner, en kosten op een inkomst tellen niet mee
  const t = Store.defaultState();
  t.transactions.push(tx('e', '2026-10-01', -9000, 'Restaurant', { categoryId: 'cat_boodschappen', categorySource: 'manual' }), tx('r', '2026-10-02', 3000, 'Jan', { refundOf: 'e' }));
  C.recompute(t);
  const sm = C.summarize(t, { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(sm.expenseBy.cat_boodschappen, 6000); assert.equal(sm.expenses, 6000);
});

test('samen een cadeau: terugbetalingen gaan eerst naar het voorschot-deel, en vooruitbetalen (Airbnb)', () => {
  const s = Store.defaultState();
  s.transactions.push(tx('g', '2026-09-04', -10000, 'Shop', { categoryId: 'cat_boodschappen', categorySource: 'manual', splits: [{ categoryId: C.SYS_ADVANCE, amount: -8571, person: 'THK', note: 'THK cadeau' }] }));
  ['A', 'B', 'C', 'D'].forEach((n, i) => s.transactions.push(tx('r' + i, '2026-09-0' + (5 + i), 1429, n, { refundOf: 'g' })));
  C.recompute(s);
  const it = C.advancesOverview(s).items[0];
  assert.equal(it.repaid, 5716, 'de 4 terugbetalingen vereffenen het voorschot');
  assert.equal(it.amount - it.repaid, 2855, 'nog 2 mensen open');
  const sum = C.summarize(s, { start: '2026-09-01', end: '2026-09-30' });
  assert.equal(sum.expenses, 1429, 'jouw deel blijft € 14,29');
  // Betaalt iemand meer dan het voorschot, dan gaat de rest naar jouw deel
  s.transactions.push(tx('r9', '2026-09-20', 4000, 'E', { refundOf: 'g' }));
  C.recompute(s);
  assert.equal(C.advancesOverview(s).items[0].amount - C.advancesOverview(s).items[0].repaid, 0);
  assert.equal(C.summarize(s, { start: '2026-09-01', end: '2026-09-30' }).expenses, 1429 - (4000 - 2855));
  // Vooruitbetaald: Jan stort € 120 voor de Airbnb, jij betaalt later € 400 waarvan € 120 voor Jan
  const a = Store.defaultState();
  a.transactions.push(tx('in', '2026-10-01', 12000, 'Jan', { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Jan' }));
  C.recompute(a);
  let ov = C.advancesOverview(a);
  assert.equal(ov.people[0].open, -12000); assert.equal(ov.totalPrepaid, 12000, 'nog voor Jan te betalen');
  assert.equal(C.summarize(a, { start: '2026-10-01', end: '2026-10-31' }).income, 0, 'geen inkomen');
  a.transactions.push(tx('bnb', '2026-10-10', -40000, 'Airbnb', { categoryId: 'cat_boodschappen', categorySource: 'manual', splits: [{ categoryId: C.SYS_ADVANCE, amount: -12000, person: 'Jan' }] }));
  C.recompute(a);
  ov = C.advancesOverview(a);
  assert.equal(ov.people[0].open, 0); assert.equal(ov.totalPrepaid, 0);
  assert.equal(C.summarize(a, { start: '2026-10-01', end: '2026-10-31' }).expenses, 28000, 'enkel jouw deel is een uitgave');
});

test('voorschotten: een terugbetaling met exact hetzelfde bedrag gaat naar dat voorschot, niet naar het oudste', () => {
  const s = Store.defaultState();
  const A = { categoryId: C.SYS_ADVANCE, categorySource: 'manual', person: 'Kristin' };
  s.transactions.push(tx('m1', '2026-08-12', -2300, 'Mediafin', A), tx('t', '2026-10-13', -4127, 'De tijd', A), tx('p', '2026-10-20', -90000, 'Pluxee', A),
    tx('r2', '2026-10-16', 90000, 'ADVOCATENKANTOOR', A), tx('r3', '2026-10-21', 1000, 'Kristin', A));
  C.recompute(s);
  const by = Object.fromEntries(C.advancesOverview(s).items.map(it => [it.txId, it.repaid]));
  assert.equal(by.p, 90000, '€ 900 terug = het voorschot van € 900');
  assert.equal(by.t, 0, 'De tijd staat nog open');
  assert.equal(by.m1, 1000, 'een ander bedrag gaat nog altijd naar het oudste voorschot');
  const r = C.advancesOverview(s).repayments.find(x => x.txId === 'r2');
  assert.deepEqual(r.settles.map(x => x.title), ['Pluxee'], 'je ziet waarvoor de terugbetaling diende');
});

test('js/app.js is geldig JavaScript', () => {
  const r = require('child_process').spawnSync(process.execPath, ['--check', require('path').join(__dirname, '..', 'js', 'app.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('js/app.js is exact de samenvoeging van de stukken in js/app/', () => {
  const { build } = require('../scripts/build-app.js');
  const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.equal(build() === app, true, 'voer "npm run build:app" uit na het wijzigen van een stuk in js/app/');
});

test('regels: nieuwe transacties krijgen een voorstel dat je bevestigt (uit te zetten)', () => {
  const s = Store.defaultState();
  const cat = s.categories.find(c => c.kind === 'expense');
  s.rules.push({ id: 'r1', name: 'Colruyt', field: 'counterparty', operator: 'name', value: 'colruyt', categoryId: cat.id, direction: 'out', enabled: true, priority: 10 });
  s.settings.rulesConfirmSince = Date.parse('2026-10-01T00:00:00Z');
  const oud = { id: 'oud', accountId: 'acc_cash', date: '2026-09-01', amount: -1000, counterparty: 'Colruyt', description: '', splits: [], source: 'import', createdAt: Date.parse('2026-09-02T00:00:00Z') };
  const nieuw = { id: 'nieuw', accountId: 'acc_cash', date: '2026-10-20', amount: -2000, counterparty: 'Colruyt', description: '', splits: [], source: 'import', createdAt: Date.parse('2026-10-21T00:00:00Z') };
  s.transactions.push(oud, nieuw);
  C.recompute(s);
  assert.equal(oud.categoryId, cat.id, 'wat er al was, blijft automatisch');
  assert.equal(nieuw.categoryId, null, 'nieuw blijft te verwerken');
  assert.equal(nieuw.ruleSuggest, 'r1');
  // Het voorstel synchroniseert niet als wijziging (het wordt op elk toestel berekend)
  assert.equal(C.entityHash(nieuw), C.entityHash(Object.assign({}, nieuw, { ruleSuggest: undefined })));
  // Bevestigen: een gewone koppeling die bewaard en gesynchroniseerd wordt
  assert.ok(C.confirmRuleSuggestion(s, nieuw));
  C.recompute(s);
  assert.deepEqual([nieuw.categoryId, nieuw.categorySource, nieuw.ruleConfirmed, nieuw.ruleSuggest], [cat.id, 'manual', 'r1', undefined]);
  // Instelling uit: regels verwerken weer vanzelf
  const t3 = Object.assign({}, nieuw, { id: 't3', categoryId: null, categorySource: null, ruleConfirmed: undefined });
  s.transactions.push(t3);
  C.recompute(s);
  assert.equal(t3.categoryId, null);
  s.settings.rulesConfirm = false;
  C.recompute(s);
  assert.equal(t3.categoryId, cat.id);
  assert.equal(t3.categorySource, 'rule');
  assert.equal(t3.ruleSuggest, undefined);
});
