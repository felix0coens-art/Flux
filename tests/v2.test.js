'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');
const Store = require('../js/store.js');
const Lookup = require('../js/lookup.js');

function state(transactions) {
  const s = Store.defaultState();
  s.transactions = transactions.map((t, i) => Object.assign({ id: 't' + i, accountId: 'acc_zicht', counterparty: '', counterpartyIban: '', description: '', splits: [], transferMode: 'auto' }, t));
  return C.recompute(s);
}

test('standaardgegevens bevatten geen merkenregels', () => {
  const s = Store.defaultState();
  assert.equal(s.rules.length, 0);
  assert.equal(s.categories.filter(c => c.kind === 'income').length, 3);
  assert.ok(s.categories.find(c => c.id === 'cat_kost_bijberoep').incomeId === 'cat_bijberoep');
});

test('kosten op inkomsten worden van de inkomstenbron afgetrokken, niet bij de uitgaven geteld', () => {
  const s = state([
    { date: '2026-10-15', amount: 100000, categoryId: 'cat_bijberoep', categorySource: 'manual' },
    { date: '2026-10-03', amount: -2419, categoryId: 'cat_kost_bijberoep', categorySource: 'manual' },
    { date: '2026-10-25', amount: 285000, categoryId: 'cat_loon', categorySource: 'manual' },
    { date: '2026-10-05', amount: -5000, categoryId: 'cat_boodschappen', categorySource: 'manual' }
  ]);
  const sum = C.summarize(s, C.periodRange('monthly', '2026-10-01'));
  assert.equal(sum.income, 385000);
  assert.equal(sum.incomeCosts, 2419);
  assert.equal(sum.netIncome, 382581);
  assert.equal(sum.expenses, 5000);
  assert.equal(sum.net, 377581);
  assert.equal(sum.byIncome.cat_bijberoep.net, 97581);
  assert.equal(sum.byIncome.cat_loon.net, 285000);
});

test('ontvangst gesplitst in bruto honorarium en afgehouden commissie', () => {
  const tx = { date: '2026-10-20', amount: 40500, splits: [{ categoryId: 'cat_bijberoep', amount: 45000 }, { categoryId: 'cat_kost_bijberoep', amount: -4500 }] };
  assert.deepEqual(C.validateSplits(tx, tx.splits), []);
  const s = state([tx]);
  const sum = C.summarize(s, C.periodRange('monthly', '2026-10-01'));
  assert.equal(sum.byIncome.cat_bijberoep.gross, 45000);
  assert.equal(sum.byIncome.cat_bijberoep.costs, 4500);
  assert.equal(sum.netIncome, 40500);
  assert.equal(sum.expenses, 0);
  assert.equal(C.validateSplits(tx, [{ categoryId: 'cat_bijberoep', amount: 50000 }]).length, 1, 'meer dan ontvangen kan niet');
});

test('terugkerende inkomsten worden herkend', () => {
  const txs = [];
  for (let m = 0; m < 6; m++) txs.push({ date: C.addMonths('2026-04-25', m), amount: 285000, counterparty: 'Werkgever NV', categoryId: 'cat_loon', categorySource: 'manual' });
  const rec = C.detectRecurring(state(txs), '2026-10-01', { direction: 'in' });
  assert.equal(rec.length, 1);
  assert.equal(rec[0].key, 'in:werkgever');
  assert.equal(rec[0].nextDue, '2026-10-25');
  assert.equal(C.detectRecurring(state(txs), '2026-10-01').length, 0, 'niet bij de vaste lasten');
});

test('regeloperator "naam bevat" negeert leestekens en plaatsnamen', () => {
  const rule = { field: 'counterparty', operator: 'name', value: 'kruidvat', categoryId: 'cat_huishouden', enabled: true };
  assert.ok(C.ruleMatches(rule, { amount: -100, counterparty: 'KRUIDVAT-BRUGGE 0123' }));
  assert.ok(!C.ruleMatches(rule, { amount: -100, counterparty: 'KRUIDVATEN BV' }));
});

test('categorie kiezen op basis van online gevonden beschrijving', () => {
  const cats = Store.defaultState().categories;
  const pick = t => (C.matchCategory(t, cats, 'out') || {}).categoryId;
  assert.equal(pick('Colruyt | Belgische supermarktketen | supermarket chain'), 'cat_boodschappen');
  assert.equal(pick('De Lijn | Vlaamse vervoersmaatschappij | public transport company'), 'cat_vervoer');
  assert.equal(pick('Apotheek | amenity = pharmacy | pharmacy amenity'), 'cat_gezondheid');
  assert.equal(pick('Netflix | Amerikaanse streamingdienst | video on demand'), 'cat_abonnementen');
  assert.equal(pick('Mutualiteit | Belgisch ziekenfonds | health insurance'), 'cat_gezondheid');
  assert.equal(pick('Jan Peeters | familienaam'), undefined);
});

test('zoektermen opschonen', () => {
  assert.deepEqual(Lookup.searchTerms('BETALING BANCONTACT COLRUYT 3412 GENT 12/10'), ['COLRUYT GENT', 'COLRUYT']);
  assert.deepEqual(Lookup.searchTerms('', 'Europese domiciliering NETFLIX.COM ref 88'), ['NETFLIX']);
});

test('lookupFree combineert Wikidata en OpenStreetMap (nagebootste API)', async () => {
  const calls = [];
  const fakeFetch = async url => {
    calls.push(url);
    const u = new URL(url);
    let body;
    if (u.host === 'nominatim.openstreetmap.org') body = [{ category: 'shop', type: 'supermarket', name: 'Colruyt', osm_type: 'node', osm_id: 1 }, { category: 'place', type: 'city', name: 'x' }];
    else if (u.searchParams.get('action') === 'wbsearchentities') body = { search: [{ id: 'Q1', label: 'Colruyt', description: 'Belgische supermarktketen' }] };
    else if (u.searchParams.get('props').includes('claims')) body = { entities: { Q1: { descriptions: { nl: { value: 'Belgische supermarktketen' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q180846' } } } }] } } } };
    else body = { entities: { Q180846: { labels: { nl: { value: 'supermarktketen' }, en: { value: 'supermarket chain' } } } } };
    return { ok: true, json: async () => body };
  };
  const r = await Lookup.lookupFree({ name: 'COLRUYT GENT' }, { fetch: fakeFetch });
  assert.equal(r.hits.length, 2);
  assert.match(r.text, /supermarket/);
  assert.equal(C.matchCategory(r.text, Store.defaultState().categories, 'out').categoryId, 'cat_boodschappen');
  assert.ok(calls.some(c => c.includes('countrycodes=be')));
});

test('synchronisatie: wijzigingen op twee toestellen worden samengevoegd', () => {
  const server = Store.demoState('2026-10-13');
  const T = Date.now();
  C.stampChanges(null, server, T);
  const a = JSON.parse(JSON.stringify(server)), b = JSON.parse(JSON.stringify(server));
  const snapA = C.snapshot(a), snapB = C.snapshot(b);
  // A wijzigt een budget en verwijdert een transactie; B voegt een transactie toe
  a.budgets[0].limit = 45000;
  const removed = a.transactions.shift().id;
  const keysA = C.stampChanges(snapA, a, T + 2);
  b.transactions.push({ id: 'nieuw', accountId: 'acc_cash', date: '2026-10-13', amount: -450, counterparty: 'Koffie', description: '', splits: [], transferMode: 'auto' });
  const keysB = C.stampChanges(snapB, b, T + 3);
  assert.deepEqual(keysA.sort(), ['budgets:bud_1', 'transactions:' + removed].sort());
  assert.deepEqual(keysB, ['transactions:nieuw']);
  let merged = C.mergeStates(server, C.extractChanges(a, keysA), T + 4);
  merged = C.mergeStates(merged, C.extractChanges(b, keysB), T + 4);
  assert.equal(merged.budgets.find(x => x.id === 'bud_1').limit, 45000);
  assert.ok(!merged.transactions.some(t => t.id === removed));
  assert.ok(merged.transactions.some(t => t.id === 'nieuw'));
  assert.equal(merged.transactions.length, server.transactions.length);
});

test('synchronisatie: herberekende velden tellen niet als wijziging', () => {
  const s = Store.demoState('2026-10-13');
  const snap = C.snapshot(s);
  s.rules.push({ id: 'r', name: 'x', field: 'any', operator: 'name', value: 'de lijn', categoryId: 'cat_vervoer', enabled: true, priority: 10 });
  C.recompute(s);
  assert.equal(s.transactions.find(t => t.counterparty === 'De Lijn').categoryId, 'cat_vervoer');
  assert.deepEqual(C.stampChanges(snap, s, 5), ['rules:r']);
});

test('synchronisatie: nieuwste versie van hetzelfde object wint', () => {
  const base = { transactions: [{ id: 'x', amount: -100, updatedAt: 10 }] };
  const merged = C.mergeStates(base, { transactions: [{ id: 'x', amount: -200, updatedAt: 5 }] });
  assert.equal(merged.transactions[0].amount, -100);
  const merged2 = C.mergeStates(base, { transactions: [{ id: 'x', amount: -300, updatedAt: 20 }] });
  assert.equal(merged2.transactions[0].amount, -300);
});

test('migratie van versie 1 voegt zoekwoorden toe', () => {
  const old = { version: 1, categories: [{ id: 'cat_boodschappen', name: 'Boodschappen', kind: 'expense' }], transactions: [] };
  const m = Store.migrate(old);
  assert.match(m.categories[0].lookupTags, /supermarket/);
});
