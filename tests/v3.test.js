'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');
const Store = require('../js/store.js');
const Banks = require('../js/banks.js');
const Invest = require('../js/invest.js');
const Degiro = require('../server/degiro.js');

const fixture = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

function importFile(state, name, accountId) {
  const text = fixture(name);
  const parsed = Banks.parse(text);
  const part = Banks.splitByAccount(parsed)[0];
  const plan = Banks.plan(state, part, accountId, text, name);
  if (!plan.sameFile) Banks.apply(state, plan, part, accountId);
  C.recompute(state);
  return { parsed, plan };
}

test('KBC- en Argenta-bestanden worden herkend, met rekening en periode', () => {
  const kbc = Banks.parse(fixture('kbc.csv'));
  assert.equal(kbc.profile.id, 'kbc');
  assert.deepEqual(kbc.accountIbans, ['BE68539007547034']);
  assert.deepEqual(kbc.period, { from: '2026-10-01', to: '2026-10-12' });
  assert.deepEqual(kbc.balance, { date: '2026-10-12', amount: 120480 }, 'eindsaldo van de laatste dag, ongeacht sorteervolgorde');
  assert.equal(kbc.transactions.find(t => t.amount === -92500).counterparty, 'Immo Verhuur BV');
  const arg = Banks.parse(fixture('argenta.csv'));
  assert.equal(arg.profile.id, 'argenta');
  assert.equal(arg.transactions[0].bankRef, 'B6J14AH1LKA00001');
  assert.equal(arg.transactions[0].counterparty, 'KRUIDVAT GENT');
});

test('hetzelfde bestand kan geen tweede keer opgeladen worden', () => {
  const s = Store.defaultState();
  s.accounts.push({ id: 'k', name: 'KBC', iban: 'BE68539007547034', type: 'zicht' });
  const first = importFile(s, 'kbc.csv', 'k');
  assert.equal(first.plan.fresh.length, 3);
  const again = importFile(s, 'kbc.csv', 'k');
  assert.ok(again.plan.sameFile, 'zelfde inhoud wordt geweigerd');
  assert.equal(s.transactions.length, 3);
  assert.equal(s.imports.length, 1);
  assert.equal(s.accounts.find(a => a.id === 'k').balance.amount, 120480);
});

test('overlappend bestand: enkel nieuwe rijen worden toegevoegd', () => {
  const s = Store.defaultState();
  s.accounts.push({ id: 'k', name: 'KBC', iban: 'BE68539007547034', type: 'zicht' });
  importFile(s, 'kbc.csv', 'k');
  // Nieuw bestand met 1 overlappende en 1 nieuwe rij (andere inhoud → ander bestand)
  const text = fixture('kbc.csv').split('\n').slice(0, 2).join('\n') + '\n' +
    'BE68 5390 0754 7034;Zichtrekening;FELIX;EUR;2026010;13/10/2026;BETALING VIA BANCONTACT 13-10 DELHAIZE;13/10/2026;-20,00;1.184,80;;20,00;;;;;;\n';
  const parsed = Banks.parse(text);
  const plan = Banks.plan(s, Banks.splitByAccount(parsed)[0], 'k', text, 'kbc-2.csv');
  assert.ok(!plan.sameFile);
  assert.equal(plan.fresh.length, 1);
  assert.equal(plan.duplicates.length, 1);
  assert.deepEqual(Object.values(plan.fromImports), [1], 'toont uit welk bestand de dubbel komt');
});

test('import ongedaan maken verwijdert precies die transacties', () => {
  const s = Store.defaultState();
  s.accounts.push({ id: 'k', name: 'KBC', iban: 'BE68539007547034', type: 'zicht' }, { id: 'a', name: 'Argenta', iban: 'BE12973000000092', type: 'spaar' });
  importFile(s, 'kbc.csv', 'k');
  importFile(s, 'argenta.csv', 'a');
  assert.equal(s.transactions.length, 5);
  const kbcImport = s.imports.find(i => i.accountId === 'k');
  assert.equal(Banks.undo(s, kbcImport.id), 3);
  assert.equal(s.transactions.length, 2);
  assert.equal(s.imports.length, 1);
  // Na ongedaan maken mag het bestand opnieuw
  assert.equal(importFile(s, 'kbc.csv', 'k').plan.fresh.length, 3);
});

test('voorschotten: wie is je nog wat schuldig', () => {
  const s = Store.defaultState();
  const add = t => s.transactions.push(Object.assign({ id: 't' + s.transactions.length, accountId: 'acc_cash', counterparty: '', description: '', splits: [], transferMode: 'auto' }, t));
  add({ date: '2026-09-19', amount: -15000, categorySource: 'manual', splits: [
    { categoryId: 'cat_uitgaan', amount: -5000 }, { categoryId: 'sys_voorschot', amount: -5000, person: 'Pieter' }, { categoryId: 'sys_voorschot', amount: -5000, person: 'Sofie' }] });
  add({ date: '2026-09-21', amount: 5000, categoryId: 'sys_voorschot', categorySource: 'manual', person: 'Pieter', advanceOf: 't0' });
  add({ date: '2026-09-25', amount: 2000, categoryId: 'sys_voorschot', categorySource: 'manual', person: 'sofie' });
  C.recompute(s);
  const o = C.advancesOverview(s);
  const by = Object.fromEntries(o.people.map(p => [p.person, p.open]));
  assert.equal(by.Pieter, 0);
  assert.equal(by.Sofie, 3000, 'deelbetaling op naam (hoofdletterongevoelig)');
  assert.equal(o.totalOpen, 3000);
  const sum = C.summarize(s, C.periodRange('monthly', '2026-09-01'));
  assert.equal(sum.expenses, 5000, 'enkel je eigen deel is een uitgave');
  assert.equal(sum.income, 0, 'terugbetalingen van vrienden zijn geen inkomen');
  assert.equal(sum.advanced, 10000);
  assert.equal(sum.repaid, 7000);
  assert.equal(C.txKind(s.transactions[0], s.categories), 'split');
  assert.equal(C.txKind(s.transactions[1], s.categories), 'repayment');
});

test('overschrijvingen naar Degiro zijn een belegging, geen uitgave', () => {
  const s = Store.defaultState();
  s.transactions.push({ id: 'd', accountId: 'acc_cash', date: '2026-10-04', amount: -20000, counterparty: 'flatexDEGIRO Bank', description: 'Storting', splits: [], transferMode: 'auto' });
  C.recompute(s);
  assert.equal(s.transactions[0].categoryId, 'sys_belegging');
  assert.equal(C.txKind(s.transactions[0], s.categories), 'investment');
  const sum = C.summarize(s, C.periodRange('monthly', '2026-10-01'));
  assert.equal(sum.expenses, 0);
  assert.equal(sum.invested, 20000);
});

test('Degiro-exports: soort bestand, posities, transacties, kasbewegingen', () => {
  assert.equal(Invest.detectCsv(fixture('degiro-portfolio.csv')), 'portfolio');
  assert.equal(Invest.detectCsv(fixture('degiro-transactions.csv')), 'transactions');
  assert.equal(Invest.detectCsv(fixture('degiro-account.csv')), 'account');
  let inv = Invest.mergeInvestments(null, Invest.parsePortfolioCsv(fixture('degiro-portfolio.csv')), 'degiro-csv', '2026-10-13');
  inv = Invest.mergeInvestments(inv, { trades: Invest.parseTransactionsCsv(fixture('degiro-transactions.csv')) }, 'degiro-csv');
  inv = Invest.mergeInvestments(inv, { movements: Invest.parseAccountCsv(fixture('degiro-account.csv')) }, 'degiro-csv');
  inv = Invest.mergeInvestments(inv, { movements: Invest.parseAccountCsv(fixture('degiro-account.csv')) }, 'degiro-csv');
  assert.equal(inv.movements.length, 6, 'tweemaal hetzelfde rekeningoverzicht geeft geen dubbels; USD-dividend wordt niet dubbel geteld');
  const s = Invest.summary(inv);
  assert.equal(s.valueEur, 154740);
  assert.equal(s.netDeposits, 145000);
  assert.equal(s.netDividends, 348);
  const apple = s.positions.find(p => p.isin === 'US0378331005');
  assert.equal(apple.costEur, 33320);
});

test('portefeuille-export van een vroegere datum voegt enkel een waarderingspunt toe', () => {
  let inv = Invest.mergeInvestments(null, { positions: [{ key: 'A', name: 'A', valueEur: 120000 }], cashEur: 0 }, 'degiro-csv', '2026-10-13');
  inv = Invest.mergeInvestments(inv, { positions: [{ key: 'A', name: 'A', valueEur: 90000 }], cashEur: 0 }, 'degiro-csv', '2025-12-31');
  assert.equal(inv.positions[0].valueEur, 120000, 'huidige posities blijven');
  assert.deepEqual(inv.history.map(h => [h.date, h.valueEur]), [['2025-12-31', 90000], ['2026-10-13', 120000]]);
});

test('TWR en MWR: een bijstorting halverwege', () => {
  // 1000 in januari → 1200 eind juni (+20%); 1000 bijgestort; 2200 → 2160 eind december (−1,8%)
  const inv = {
    movements: [{ date: '2025-01-01', type: 'deposit', amountEur: 100000 }, { date: '2025-07-01', type: 'deposit', amountEur: 100000 }],
    history: [{ date: '2025-06-30', valueEur: 120000 }, { date: '2025-12-31', valueEur: 216000 }]
  };
  const p = Invest.performance(inv);
  assert.ok(Math.abs(p.twr - 0.1782) < 0.003, 'TWR ≈ 17,8% (timing van stortingen telt niet)');
  assert.ok(p.mwr > 0.09 && p.mwr < 0.12, 'MWR ≈ 10,8% (de bijstorting kwam vlak voor de daling)');
  assert.equal(p.years.length, 1);
  assert.equal(p.years[0].result, 16000);
  assert.deepEqual(p.missingYearEnds, []);
});

test('rendement per jaar en ontbrekende jaarwaarderingen', () => {
  const inv = {
    movements: [{ date: '2024-03-01', type: 'deposit', amountEur: 100000 }, { date: '2025-03-01', type: 'deposit', amountEur: 50000 }],
    history: [{ date: '2024-12-31', valueEur: 110000 }, { date: '2026-06-30', valueEur: 190000 }]
  };
  const p = Invest.performance(inv);
  assert.deepEqual(p.years.map(y => y.year), [2024, 2025, 2026]);
  assert.ok(Math.abs(p.years[0].twr - 0.10) < 0.001);
  assert.deepEqual(p.years[1].missing, ['2025-12-31'], 'vraagt om de portefeuille op 31/12/2025');
  assert.equal(p.years[2].partial, true);
  assert.ok(p.twr > 0 && p.mwr > 0);
  assert.equal(Invest.xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 110 }]).toFixed(3), '0.100');
});

test('Degiro-koppeling: aanmelden met 2FA en gegevens omzetten (nagebootste Degiro)', async () => {
  const calls = [];
  const fake = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body, cookie: opts.headers.Cookie });
    const j = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    const u = String(url);
    if (u.endsWith('/login/secure/login')) return j({ status: 6, statusText: 'totpNeeded' });
    if (u.endsWith('/login/secure/login/totp')) return JSON.parse(opts.body).oneTimePassword === '123456' ? j({ status: 0, sessionId: 'SID1' }) : j({ status: 3, statusText: 'badCredentials' });
    if (u.endsWith('/login/secure/config')) return j({ data: { tradingUrl: 'https://t/', paUrl: 'https://pa/', productSearchUrl: 'https://ps/', reportingUrl: 'https://r/' } });
    if (u.startsWith('https://pa/client')) return j({ data: { intAccount: 777 } });
    if (u.startsWith('https://t/v5/update/777')) return j({ portfolio: { value: [
      { name: 'positionrow', value: [{ name: 'id', value: '111' }, { name: 'positionType', value: 'PRODUCT' }, { name: 'size', value: 10 }, { name: 'price', value: 118.5 }, { name: 'value', value: 1185 }, { name: 'plBase', value: { EUR: -1106 } }] },
      { name: 'positionrow', value: [{ name: 'id', value: 'EUR' }, { name: 'positionType', value: 'CASH' }, { name: 'size', value: 12.3 }] }
    ] }, totalPortfolio: { value: [{ name: 'totalCash', value: 12.3 }] } });
    if (u.startsWith('https://ps/v5/products/info')) return j({ data: { 111: { name: 'Vanguard FTSE All-World', isin: 'IE00B3RBWM25', currency: 'EUR' } } });
    if (u.startsWith('https://r/v4/transactions')) return j({ data: [{ id: 9, productId: 111, date: '2026-01-05T09:04:00+01:00', buysell: 'B', price: 110.5, quantity: 10, totalPlusFeeInBaseCurrency: -1106, totalFeesInBaseCurrency: -1 }] });
    if (u.startsWith('https://r/v6/accountoverview')) return j({ data: { cashMovements: [
      { date: '2026-01-02T10:15:00+01:00', description: 'flatex Storting', currency: 'EUR', change: 1500 },
      { date: '2026-01-03T10:15:00+01:00', description: 'Overboeking naar uw geldrekening bij flatexDEGIRO Bank', currency: 'EUR', change: -1500 },
      { date: '2026-03-20T07:00:00+01:00', description: 'Dividend', currency: 'USD', change: 5.4 }
    ] } });
    return { ok: true, status: 200, text: async () => '{}' };
  };
  await assert.rejects(Degiro.fetchAll(fake, { username: 'u', password: 'p' }), e => e.code === 'otp');
  await assert.rejects(Degiro.fetchAll(fake, { username: 'u', password: 'p', otp: '000000' }), e => e.code === 'otp');
  const data = await Degiro.fetchAll(fake, { username: 'u', password: 'p', otp: '123456' }, { today: '2026-10-13' });
  assert.equal(data.positions.length, 1);
  assert.deepEqual([data.positions[0].isin, data.positions[0].valueEur, data.positions[0].costEur], ['IE00B3RBWM25', 118500, 110600]);
  assert.equal(data.cashEur, 1230);
  assert.equal(data.trades[0].quantity, 10);
  assert.deepEqual(data.movements.map(m => m.type), ['deposit', 'internal'], 'interne verschuiving is geen opname; USD genegeerd');
  assert.ok(calls.filter(c => c.url.includes('/v')).every(c => c.cookie === 'JSESSIONID=SID1'));
  assert.ok(!JSON.stringify(data).includes('"p"'), 'geen wachtwoord in het resultaat');
});

test('voorbeeldmodus: demodata staat los en is gemarkeerd', () => {
  const d = Store.demoState('2026-10-13');
  assert.equal(d.demo, true);
  assert.ok(d.imports.every(i => /voorbeeld/.test(i.fileName)));
  assert.ok(Invest.performance(d.investments).twr != null);
  assert.equal(Store.DEMO_KEY !== Store.STORAGE_KEY, true);
});
