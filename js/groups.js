/*
 * Helder — groepen (zoals Tricount): gedeelde uitgaven, saldo's en wie wie terugbetaalt.
 * Zonder DOM, gebruikt door de deelpagina (groep.html), de app en de Node-server.
 * php/lib/groups.php controleert de invoer op exact dezelfde manier.
 * Bedragen in gehele centen, altijd positief.
 */
(function (root) {
  'use strict';

  const LIMITS = { members: 50, expenses: 3000, payments: 3000, name: 40, title: 80, groupName: 60, note: 120, amount: 100000000 };
  const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;

  function newId(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
  const validAmount = a => Number.isInteger(a) && a >= 1 && a <= LIMITS.amount;

  /** Wat elk lid van een uitgave draagt: { lidId: centen }. Gelijk verdeeld: de overschietende centen gaan naar de eersten. */
  function shares(expense) {
    const out = {};
    const sp = expense.split || {};
    if (sp.mode === 'amounts') {
      for (const [id, v] of Object.entries(sp.amounts || {})) if (v > 0) out[id] = v;
      return out;
    }
    const among = sp.among || [];
    if (!among.length) return out;
    const base = Math.floor(expense.amount / among.length);
    let rest = expense.amount - base * among.length;
    for (const id of among) { out[id] = base + (rest > 0 ? 1 : 0); if (rest > 0) rest--; }
    return out;
  }

  /** Per lid: betaald, eigen deel, terugbetaald en ontvangen. saldo > 0: de anderen moeten jou nog geld geven. */
  function balances(group) {
    const out = {};
    for (const m of group.members || []) out[m.id] = { paid: 0, owed: 0, sent: 0, received: 0, net: 0 };
    const row = id => out[id] || (out[id] = { paid: 0, owed: 0, sent: 0, received: 0, net: 0 });
    for (const e of group.expenses || []) {
      row(e.paidBy).paid += e.amount;
      for (const [id, v] of Object.entries(shares(e))) row(id).owed += v;
    }
    for (const p of group.payments || []) { row(p.from).sent += p.amount; row(p.to).received += p.amount; }
    for (const b of Object.values(out)) b.net = b.paid - b.owed + b.sent - b.received;
    return out;
  }

  /** Zo weinig mogelijk overschrijvingen om iedereen gelijk te zetten: [{ from, to, amount }]. */
  function settle(group) {
    const bal = balances(group);
    const order = (group.members || []).map(m => m.id);
    const pos = id => { const i = order.indexOf(id); return i < 0 ? 1e9 : i; };
    const debt = Object.entries(bal).filter(([, b]) => b.net < 0).map(([id, b]) => ({ id, left: -b.net }));
    const cred = Object.entries(bal).filter(([, b]) => b.net > 0).map(([id, b]) => ({ id, left: b.net }));
    const sort = list => list.sort((a, b) => b.left - a.left || pos(a.id) - pos(b.id));
    const out = [];
    sort(debt); sort(cred);
    while (debt.length && cred.length) {
      const d = debt[0], c = cred[0];
      const amount = Math.min(d.left, c.left);
      out.push({ from: d.id, to: c.id, amount });
      d.left -= amount; c.left -= amount;
      if (!d.left) debt.shift();
      if (!c.left) cred.shift();
      sort(debt); sort(cred);
    }
    return out;
  }

  // ---------- Controle van wijzigingen (zelfde regels als php/lib/groups.php) ----------

  class GroupError extends Error {}
  const fail = msg => { throw new GroupError(msg); };
  const memberIds = g => new Set((g.members || []).map(m => m.id));

  function normMemberName(name, group, exceptId) {
    const n = clean(name, LIMITS.name);
    if (!n) fail('Geef een naam.');
    if ((group.members || []).some(m => m.id !== exceptId && m.name.toLowerCase() === n.toLowerCase())) fail('Er is al iemand met de naam ' + n + '.');
    return n;
  }

  function normExpense(raw, group) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const ids = memberIds(group);
    const title = clean(raw.title, LIMITS.title);
    if (!title) fail('Waarvoor was het? Vul een omschrijving in.');
    const amount = raw.amount;
    if (!validAmount(amount)) fail('Vul een geldig bedrag in.');
    if (!validDate(raw.date)) fail('Kies een geldige datum.');
    if (!ids.has(raw.paidBy)) fail('Kies wie betaald heeft.');
    const sp = raw.split && typeof raw.split === 'object' ? raw.split : {};
    let split;
    if (sp.mode === 'amounts') {
      const amounts = {};
      let sum = 0;
      for (const [id, v] of Object.entries(sp.amounts && typeof sp.amounts === 'object' ? sp.amounts : {})) {
        if (!ids.has(id)) fail('Onbekend lid in de verdeling.');
        if (!Number.isInteger(v) || v < 0 || v > LIMITS.amount) fail('Ongeldig bedrag in de verdeling.');
        if (v > 0) { amounts[id] = v; sum += v; }
      }
      if (!Object.keys(amounts).length) fail('Duid aan voor wie het was.');
      if (sum !== amount) fail('De verdeling (' + (sum / 100).toFixed(2).replace('.', ',') + ') is niet gelijk aan het bedrag (' + (amount / 100).toFixed(2).replace('.', ',') + ').');
      split = { mode: 'amounts', amounts };
    } else {
      const among = [];
      for (const id of Array.isArray(sp.among) ? sp.among : []) {
        if (!ids.has(id)) fail('Onbekend lid in de verdeling.');
        if (!among.includes(id)) among.push(id);
      }
      if (!among.length) fail('Duid aan voor wie het was.');
      split = { mode: 'equal', among };
    }
    const out = { title, amount, date: raw.date, paidBy: raw.paidBy, split };
    const note = clean(raw.note, LIMITS.note);
    if (note) out.note = note;
    if (typeof raw.txId === 'string' && ID_RE.test(raw.txId)) out.txId = raw.txId;
    return out;
  }

  function normPayment(raw, group) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const ids = memberIds(group);
    if (!ids.has(raw.from) || !ids.has(raw.to)) fail('Kies wie betaalde en wie het geld kreeg.');
    if (raw.from === raw.to) fail('Iemand kan zichzelf niet terugbetalen.');
    if (!validAmount(raw.amount)) fail('Vul een geldig bedrag in.');
    if (!validDate(raw.date)) fail('Kies een geldige datum.');
    const out = { from: raw.from, to: raw.to, amount: raw.amount, date: raw.date };
    const note = clean(raw.note, LIMITS.note);
    if (note) out.note = note;
    return out;
  }

  const inUse = (g, id) => (g.expenses || []).some(e => e.paidBy === id || shares(e)[id] || (e.split.among || []).includes(id)) || (g.payments || []).some(p => p.from === id || p.to === id);

  /**
   * Voert één wijziging uit op een groep (de server roept dit op binnen een slot).
   * actor: het lid dat de wijziging doet (bij 'member.add' mag dat nog leeg zijn: iemand die er nog niet bij stond).
   * Geeft { group, result } terug; gooit GroupError bij ongeldige invoer.
   */
  function applyOp(group, op, data, actor, now) {
    data = data && typeof data === 'object' ? data : {};
    const g = JSON.parse(JSON.stringify(group));
    const ids = memberIds(g);
    if (op !== 'member.add' && !ids.has(actor)) fail('Kies eerst wie je bent.');
    if (actor != null && actor !== '' && !ids.has(actor)) fail('Kies eerst wie je bent.');
    const by = ids.has(actor) ? actor : null;
    const pickId = (prefix, list) => {
      const id = typeof data.id === 'string' && ID_RE.test(data.id) ? data.id : null;
      return id && !list.some(x => x.id === id) ? id : newId(prefix);
    };
    let result = null;
    if (op === 'member.add') {
      if (g.members.length >= LIMITS.members) fail('Deze groep is vol.');
      const name = normMemberName(data.name, g, null);
      const m = { id: pickId('m', g.members), name, createdAt: now };
      g.members.push(m);
      result = m.id;
    } else if (op === 'member.rename') {
      const m = g.members.find(x => x.id === data.id);
      if (!m) fail('Dit lid bestaat niet meer.');
      m.name = normMemberName(data.name, g, m.id);
    } else if (op === 'member.remove') {
      const m = g.members.find(x => x.id === data.id);
      if (!m) fail('Dit lid bestaat niet meer.');
      if (m.id === g.ownerMember) fail('Wie de groep maakte, kan niet verwijderd worden.');
      if (inUse(g, m.id)) fail(m.name + ' staat nog in uitgaven of terugbetalingen. Pas die eerst aan.');
      g.members = g.members.filter(x => x.id !== m.id);
    } else if (op === 'expense.save') {
      const e = normExpense(data.expense, g);
      const old = data.expense && typeof data.expense.id === 'string' ? g.expenses.find(x => x.id === data.expense.id) : null;
      if (old) {
        if (old.txId && !e.txId && data.expense.unlinkTx !== true) e.txId = old.txId;
        Object.keys(old).forEach(k => { if (!['id', 'createdBy', 'createdAt'].includes(k)) delete old[k]; });
        Object.assign(old, e, { updatedBy: by, updatedAt: now });
        result = old.id;
      } else {
        if (g.expenses.length >= LIMITS.expenses) fail('Deze groep heeft te veel uitgaven.');
        const id = pickId('e', g.expenses);
        g.expenses.push(Object.assign({ id }, e, { createdBy: by, createdAt: now, updatedAt: now }));
        result = id;
      }
    } else if (op === 'expense.delete') {
      if (!g.expenses.some(x => x.id === data.id)) fail('Deze uitgave bestaat niet meer.');
      g.expenses = g.expenses.filter(x => x.id !== data.id);
    } else if (op === 'payment.save') {
      if (g.payments.length >= LIMITS.payments) fail('Deze groep heeft te veel terugbetalingen.');
      const id = pickId('p', g.payments);
      g.payments.push(Object.assign({ id }, normPayment(data.payment, g), { createdBy: by, createdAt: now }));
      result = id;
    } else if (op === 'payment.delete') {
      if (!g.payments.some(x => x.id === data.id)) fail('Deze terugbetaling bestaat niet meer.');
      g.payments = g.payments.filter(x => x.id !== data.id);
    } else if (op === 'group.rename') {
      const n = clean(data.name, LIMITS.groupName);
      if (!n) fail('Geef de groep een naam.');
      g.name = n;
    } else fail('Onbekende wijziging.');
    g.rev = (g.rev || 0) + 1;
    g.updatedAt = now;
    return { group: g, result };
  }

  /** Nieuwe groep: jij (de maker) en de anderen. */
  function createGroup(raw, now) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const name = clean(raw.name, LIMITS.groupName);
    if (!name) fail('Geef de groep een naam.');
    const g = { id: newId('g'), name, members: [], expenses: [], payments: [], rev: 1, createdAt: now, updatedAt: now };
    const me = normMemberName(raw.me, g, null);
    g.members.push({ id: newId('m'), name: me, createdAt: now });
    g.ownerMember = g.members[0].id;
    for (const o of Array.isArray(raw.others) ? raw.others.slice(0, LIMITS.members - 1) : []) {
      if (!clean(o, LIMITS.name)) continue;
      g.members.push({ id: newId('m'), name: normMemberName(o, g, null), createdAt: now });
    }
    return g;
  }

  /** Wat een bezoeker te zien krijgt (zonder de eigenaar van het account). */
  function publicGroup(g) {
    const out = Object.assign({}, g);
    delete out.owner;
    return out;
  }

  const api = { LIMITS, shares, balances, settle, applyOp, createGroup, publicGroup, normExpense, normPayment, GroupError, validDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FluxGroups = api;
})(typeof window !== 'undefined' ? window : globalThis);
