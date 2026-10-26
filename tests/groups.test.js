'use strict';
/* Groepen (zoals Tricount): verdelen, saldo's, terugbetalen en de gedeelde link (Node en PHP). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const G = require('../js/groups.js');

const group = () => ({
  id: 'g1', name: 'Weekend', ownerMember: 'mA', rev: 1,
  members: [{ id: 'mA', name: 'Felix' }, { id: 'mB', name: 'Kristin' }, { id: 'mC', name: 'Jan' }],
  expenses: [], payments: []
});

test('groepen: gelijk verdelen geeft de overschietende centen aan de eersten', () => {
  assert.deepEqual(G.shares({ amount: 1000, split: { mode: 'equal', among: ['mA', 'mB', 'mC'] } }), { mA: 334, mB: 333, mC: 333 });
  assert.deepEqual(G.shares({ amount: 900, split: { mode: 'amounts', amounts: { mA: 0, mB: 900 } } }), { mB: 900 });
});

test('groepen: saldo en zo weinig mogelijk terugbetalingen', () => {
  const g = group();
  let r = G.applyOp(g, 'expense.save', { expense: { title: 'Huisje', amount: 30000, date: '2026-10-20', paidBy: 'mA', split: { mode: 'equal', among: ['mA', 'mB', 'mC'] } } }, 'mA', 1);
  r = G.applyOp(r.group, 'expense.save', { expense: { title: 'Pizza', amount: 6000, date: '2026-10-21', paidBy: 'mB', split: { mode: 'amounts', amounts: { mA: 2000, mB: 1000, mC: 3000 } } } }, 'mB', 2);
  const bal = G.balances(r.group);
  assert.deepEqual([bal.mA.net, bal.mB.net, bal.mC.net], [18000, -5000, -13000]);
  assert.deepEqual(G.settle(r.group), [{ from: 'mC', to: 'mA', amount: 13000 }, { from: 'mB', to: 'mA', amount: 5000 }]);
  r = G.applyOp(r.group, 'payment.save', { payment: { from: 'mC', to: 'mA', amount: 13000, date: '2026-10-22' } }, 'mC', 3);
  assert.deepEqual(G.settle(r.group), [{ from: 'mB', to: 'mA', amount: 5000 }]);
  assert.equal(r.group.rev, 4);
  assert.equal(r.group.expenses[1].createdBy, 'mB');
});

test('groepen: ongeldige invoer wordt duidelijk geweigerd', () => {
  const g = group();
  const bad = (op, data, actor, msg) => assert.throws(() => G.applyOp(g, op, data, actor, 1), e => e instanceof G.GroupError && msg.test(e.message));
  bad('expense.save', { expense: { title: 'x', amount: 100, date: '2026-10-20', paidBy: 'mA', split: { mode: 'equal', among: ['mA'] } } }, null, /wie je bent/);
  bad('expense.save', { expense: { title: '', amount: 100, date: '2026-10-20', paidBy: 'mA', split: { mode: 'equal', among: ['mA'] } } }, 'mA', /omschrijving/);
  bad('expense.save', { expense: { title: 'x', amount: 12.5, date: '2026-10-20', paidBy: 'mA', split: { mode: 'equal', among: ['mA'] } } }, 'mA', /bedrag/);
  bad('expense.save', { expense: { title: 'x', amount: 100, date: '2026-02-30', paidBy: 'mA', split: { mode: 'equal', among: ['mA'] } } }, 'mA', /datum/);
  bad('expense.save', { expense: { title: 'x', amount: 100, date: '2026-10-20', paidBy: 'mA', split: { mode: 'equal', among: [] } } }, 'mA', /voor wie/);
  bad('expense.save', { expense: { title: 'x', amount: 100, date: '2026-10-20', paidBy: 'mA', split: { mode: 'amounts', amounts: { mA: 60, mB: 30 } } } }, 'mA', /niet gelijk aan het bedrag \(1,00\)/);
  bad('payment.save', { payment: { from: 'mA', to: 'mA', amount: 100, date: '2026-10-20' } }, 'mA', /zichzelf/);
  bad('member.add', { name: 'kristin' }, null, /al iemand/);
  bad('member.remove', { id: 'mA' }, 'mB', /maakte/);
  // Iemand die er nog niet bij stond, mag zichzelf toevoegen
  assert.equal(G.applyOp(g, 'member.add', { name: 'Lien' }, null, 1).group.members.length, 4);
});

// ---------- Beide servers ----------

const ENV = { FLUX_USERNAME: 'felix', FLUX_PASSWORD: 'heel-geheim-1' };
function freePort() { return new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }
async function startNode(dir) {
  Object.assign(process.env, ENV, { FLUX_DATA_DIR: dir });
  delete require.cache[require.resolve('../server/server.js')];
  const { createServer, initSetup } = require('../server/server.js');
  await initSetup();
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: 'http://127.0.0.1:' + server.address().port, stop: () => server.close() };
}
async function startPhp(dir) {
  const port = await freePort();
  const env = Object.assign({}, process.env, ENV, { FLUX_DATA_DIR: dir, HELDER_CONFIG: path.join(dir, 'geen.php') });
  const proc = spawn('php', ['-S', '127.0.0.1:' + port, path.join(__dirname, '..', 'php', 'router.php')], { env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { try { await fetch(base + '/api/session'); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); } }
  return { base, stop: () => proc.kill() };
}
const hasPhp = spawnSync('php', ['-v']).status === 0;

/** Zonder ids en tijdstippen, om Node en PHP te vergelijken. */
function shape(g, ids) {
  const id = x => ids[x] || (ids[x] = '#' + Object.keys(ids).length);
  return {
    name: g.name, rev: g.rev, owner: g.owner, ownerMember: id(g.ownerMember),
    members: g.members.map(m => [id(m.id), m.name]),
    expenses: g.expenses.map(e => ({ id: id(e.id), title: e.title, amount: e.amount, date: e.date, paidBy: id(e.paidBy), note: e.note, txId: e.txId, createdBy: e.createdBy && id(e.createdBy), updatedBy: e.updatedBy && id(e.updatedBy),
      split: e.split.mode === 'equal' ? ['equal', e.split.among.map(id)] : ['amounts', Object.entries(e.split.amounts).map(([k, v]) => [id(k), v])] })),
    payments: g.payments.map(p => [id(p.id), id(p.from), id(p.to), p.amount, p.date, p.note, p.createdBy && id(p.createdBy)])
  };
}

const results = {};
for (const [name, start] of [['node', startNode], ['php', startPhp]]) {
  test(`${name}: groep delen via een link`, { skip: name === 'php' && !hasPhp ? 'php niet geïnstalleerd' : false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helder-groups-' + name + '-'));
    fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify({ registration: 'open' }));
    const srv = await start(dir);
    const call = async (p, body, cookie, csrf = true) => {
      const res = await fetch(srv.base + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, csrf ? { 'X-Flux': '1' } : {}, cookie ? { Cookie: cookie } : {}), body: JSON.stringify(body) });
      const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
      return { status: res.status, json, text, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
    };
    try {
      assert.equal((await call('/api/groups/create', { name: 'Weekend', me: 'Felix', others: ['Kristin'] })).status, 401, 'aanmaken enkel aangemeld');
      const me = (await call('/api/login', { username: 'felix', password: 'heel-geheim-1' })).cookie;
      assert.equal((await call('/api/groups/create', { name: '', me: 'Felix' }, me)).status, 400);
      const made = await call('/api/groups/create', { name: ' Weekend  Ardennen ', me: 'Felix', others: ['Kristin', '', 'Jan'] }, me);
      assert.equal(made.status, 200, made.text);
      const t = made.json.token;
      assert.match(t, /^[A-Za-z0-9_-]{32}$/);
      assert.equal(made.json.group.owner, undefined, 'het account van de eigenaar blijft geheim');
      assert.ok(fs.readdirSync(dir).some(f => /^group-[0-9a-f]{32}\.json$/.test(f)), 'bestandsnaam bevat enkel een hash');
      assert.ok(!fs.readdirSync(dir).some(f => f.includes(t)));

      // Een bezoeker zonder account
      const g0 = (await call('/api/g/load', { t })).json;
      assert.deepEqual(g0.members.map(m => m.name), ['Felix', 'Kristin', 'Jan']);
      assert.equal(g0.owner, undefined);
      assert.equal((await call('/api/g/load', { t: 'x'.repeat(32) })).status, 404);
      assert.equal((await call('/api/g/load', { t }, null, false)).status, 403, 'CSRF-header nodig');
      const [felix, kristin, jan] = g0.members.map(m => m.id);
      const op = (actor, o, data) => call('/api/g/op', { t, actor, op: o, data });
      assert.equal((await op(null, 'expense.save', { expense: { title: 'x', amount: 100, date: '2026-10-20', paidBy: kristin, split: { mode: 'equal', among: [kristin] } } })).status, 400);
      const lien = await op(null, 'member.add', { name: 'Lien' });
      assert.equal(lien.status, 200, lien.text);
      const lienId = lien.json.result;
      let r = await op(kristin, 'expense.save', { expense: { title: 'Boodschappen', amount: 4001, date: '2026-10-24', paidBy: kristin, split: { mode: 'equal', among: [felix, kristin, jan] }, note: 'Delhaize' } });
      assert.equal(r.status, 200, r.text);
      const e1 = r.json.result;
      r = await op(felix, 'expense.save', { expense: { title: 'Huisje', amount: 30000, date: '2026-10-23', paidBy: felix, txId: 'tx_abc123', split: { mode: 'amounts', amounts: { [felix]: 7500, [kristin]: 7500, [jan]: 7500, [lienId]: 7500 } } } });
      const e2 = r.json.result;
      // Aanpassen door iemand anders: wie het maakte blijft bewaard, de banktransactie ook
      r = await op(jan, 'expense.save', { expense: { id: e2, title: 'Huisje Durbuy', amount: 30000, date: '2026-10-23', paidBy: felix, split: { mode: 'equal', among: [felix, kristin, jan, lienId] } } });
      assert.equal(r.status, 200, r.text);
      assert.equal((await op(jan, 'expense.save', { expense: { title: 'x', amount: 500, date: '2026-10-23', paidBy: jan, split: { mode: 'amounts', amounts: { [jan]: 400 } } } })).json.error, 'De verdeling (4,00) is niet gelijk aan het bedrag (5,00).');
      r = await op(jan, 'payment.save', { payment: { from: jan, to: felix, amount: 8834, date: '2026-10-25', note: 'Payconiq' } });
      assert.equal(r.status, 200, r.text);
      assert.equal((await op(lienId, 'member.remove', { id: lienId })).status, 400, 'nog in gebruik');
      assert.equal((await op(kristin, 'expense.delete', { id: e1 })).status, 200);
      assert.equal((await op(kristin, 'expense.delete', { id: e1 })).status, 400);
      r = await op(kristin, 'member.rename', { id: jan, name: 'Jan V.' });
      const g = r.json.group;
      assert.equal(g.expenses[0].txId, 'tx_abc123');
      assert.equal(g.expenses[0].createdBy, felix);
      assert.equal(g.expenses[0].updatedBy, jan);
      const bal = G.balances(g);
      assert.deepEqual(g.members.map(m => bal[m.id].net), [30000 - 7500 - 8834, -7500, -7500 + 8834, -7500]);
      assert.equal((await op(kristin, 'nonsense', {})).status, 400);

      // Verwijderen: enkel de eigenaar
      const other = (await call('/api/register', { username: 'iemand', password: 'iemand-geheim-1' })).cookie;
      assert.ok(other);
      assert.equal((await call('/api/groups/delete', { token: t }, other)).status, 403);
      results[name] = shape(g, {});
      assert.equal((await call('/api/groups/delete', { token: t }, me)).status, 200);
      assert.equal((await call('/api/g/load', { t })).status, 404);
    } finally {
      srv.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('groepen: Node en PHP geven exact hetzelfde resultaat', { skip: !hasPhp ? 'php niet geïnstalleerd' : false }, () => {
  assert.ok(results.node && results.php, 'beide servertests liepen');
  assert.deepEqual(results.php, results.node);
});

test('groepen: in Helder geboekt is wat open staat gelijk aan het saldo in de groep', () => {
  const C = require('../js/core.js');
  const Store = require('../js/store.js');
  let g = group();
  // Felix betaalde het huisje (€ 300 voor 3), Kristin de pizza (€ 45 voor 3), Kristin betaalde € 50 terug
  g = G.applyOp(g, 'expense.save', { id: 'eHuis', expense: { title: 'Huisje', amount: 30000, date: '2026-10-20', paidBy: 'mA', split: { mode: 'equal', among: ['mA', 'mB', 'mC'] } } }, 'mA', 1).group;
  g = G.applyOp(g, 'expense.save', { expense: { title: 'Pizza', amount: 4500, date: '2026-10-21', paidBy: 'mB', split: { mode: 'equal', among: ['mA', 'mB', 'mC'] } } }, 'mB', 2).group;
  g = G.applyOp(g, 'payment.save', { payment: { from: 'mB', to: 'mA', amount: 5000, date: '2026-10-22' } }, 'mB', 3).group;
  const st = Store.defaultState();
  const person = '👥 Weekend';
  st.transactions.push({ id: 'tx1', accountId: 'acc_cash', date: '2026-10-20', amount: -30000, counterparty: 'Airbnb', categoryId: null, categorySource: 'manual', source: 'manual',
    splits: [{ categoryId: null, amount: -10000 }, { categoryId: C.SYS_ADVANCE, amount: -20000, person, note: 'Huisje' }], groupRef: { groupId: 'g1', expenseId: g.expenses[0].id } });
  st.transactions.push({ id: 'tx2', accountId: 'acc_cash', date: '2026-10-22', amount: 5000, counterparty: 'Kristin', categoryId: C.SYS_ADVANCE, person, categorySource: 'manual', source: 'manual', splits: [] });
  st.people = [{ id: 'p1', name: person, ibans: [], forgiven: [{ id: 'fg1', date: '2026-10-21', amount: G.shares(g.expenses[1]).mA, categoryId: null, reason: 'settled', note: 'Pizza', groupExpenseId: g.expenses[1].id }] }];
  C.recompute(st);
  const open = C.personList(st).find(p => p.name === person).stats.open;
  assert.equal(open, G.balances(g).mA.net);
  assert.equal(open, 20000 - 1500 - 5000);
});
