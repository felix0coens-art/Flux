/*
 * Helder — gedeelde groep (zoals Tricount). Deze pagina werkt zonder aanmelden:
 * de geheime token staat achter het #-teken in de link en komt dus nooit in serverlogs terecht.
 * Bezoekers kiezen wie ze zijn (bewaard op hun toestel) en kunnen uitgaven en terugbetalingen toevoegen.
 */
(function () {
  'use strict';
  const C = window.FluxCore;
  const G = window.FluxGroups;
  const $ = s => document.querySelector(s);
  const app = $('#gp-app');
  const sheetEl = $('#gp-sheet');
  const S = { token: '', group: null, me: null, tab: 'uitgaven', error: '', sheet: null, adding: false, busy: false };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = c => C.formatMoney(c);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* geen opslag */ } }
  };
  const meKey = () => 'helder-groep-' + S.group.id;
  const member = id => (S.group.members || []).find(m => m.id === id);
  const nameOf = id => { const m = member(id); return m ? m.name : 'iemand die er niet meer bij is'; };
  const who = id => id === S.me ? 'jij' : nameOf(id);
  const Who = id => { const w = who(id); return w.charAt(0).toUpperCase() + w.slice(1); };
  const DAY = new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const dayLabel = d => { if (d === C.todayStr()) return 'Vandaag'; const s = DAY.format(new Date(d + 'T00:00:00Z')); return s.charAt(0).toUpperCase() + s.slice(1); };

  function toast(msg) {
    const t = $('#gp-toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  async function call(path, body) {
    let res;
    try {
      res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Flux': '1' }, body: JSON.stringify(body), cache: 'no-store' });
    } catch (e) { throw new Error('Geen verbinding. Controleer je internet en probeer opnieuw.'); }
    let json = null;
    try { json = await res.json(); } catch (e) { /* geen JSON */ }
    if (!res.ok) { const err = new Error((json && json.error) || 'Er ging iets mis (' + res.status + ').'); err.status = res.status; throw err; }
    return json;
  }

  async function load(quiet) {
    try {
      const g = await call('/api/g/load', { t: S.token });
      const changed = !S.group || g.rev !== S.group.rev;
      S.group = g;
      S.error = '';
      const saved = store.get(meKey());
      S.me = saved && member(saved) ? saved : null;
      if (!quiet || changed) render();
    } catch (e) {
      if (!quiet || e.status === 404) { S.error = e.message; S.group = e.status === 404 ? null : S.group; render(); }
    }
  }

  /** Eén wijziging bewaren. Geeft het resultaat (bv. een nieuwe id) terug, of null als het mislukte. */
  async function op(name, data, actor) {
    if (S.busy) return null;
    S.busy = true;
    try {
      const r = await call('/api/g/op', { t: S.token, actor: actor === undefined ? S.me : actor, op: name, data });
      S.group = r.group;
      return r.result || true;
    } catch (e) {
      const box = (sheetEl.hidden ? app : sheetEl).querySelector('.gp-err');
      if (box) box.textContent = e.message; else toast(e.message);
      return null;
    } finally { S.busy = false; }
  }

  // ---------- Weergave ----------

  function render() {
    const g = S.group;
    $('#gp-name').textContent = g ? g.name : 'Gedeelde groep';
    $('#gp-sub').textContent = g ? g.members.length + ' personen · ' + (S.me ? 'je bent ' + nameOf(S.me) : 'samen uitgaven bijhouden') : 'Samen uitgaven bijhouden';
    if (g) document.title = g.name + ' — Helder';
    if (!g) {
      app.innerHTML = `<div class="card gp-center"><div class="gp-big-icon">🔗</div><h2>Deze groep kan niet geopend worden</h2>
        <p class="muted">${esc(S.error || 'Deze link is niet volledig. Vraag wie je de link stuurde om ze opnieuw te delen.')}</p></div>`;
      return;
    }
    app.innerHTML = S.me ? mainView() : whoView();
    const input = app.querySelector('[data-autofocus]');
    if (input) input.focus();
  }

  function whoView() {
    const g = S.group;
    return `<section class="card gp-who">
      <h2>Wie ben jij?</h2>
      <p class="muted">Je hoeft geen account te maken. Kies je naam, zodat de anderen zien wie wat toevoegde. Helder onthoudt dit op dit toestel.</p>
      <div class="gp-who-list">${g.members.map(m => `<button class="gp-who-btn" data-a="pick" data-id="${esc(m.id)}"><span class="gp-avatar">${esc(initial(m.name))}</span>${esc(m.name)}</button>`).join('')}</div>
      ${S.adding ? `<form class="gp-add-me" data-f="add-me">
          <label class="field"><span>Je naam</span><input name="name" maxlength="40" autocomplete="given-name" required data-autofocus></label>
          <div class="gp-err errors"></div>
          <div class="gp-row"><button class="btn primary" type="submit">Toevoegen en verdergaan</button><button class="btn ghost" type="button" data-a="add-me-cancel">Annuleren</button></div>
        </form>` : `<button class="btn ghost gp-not-listed" data-a="add-me">Ik sta er niet bij</button>`}
    </section>`;
  }

  const initial = n => (String(n).trim().charAt(0) || '?').toUpperCase();

  function myCard() {
    const g = S.group;
    const bal = G.balances(g)[S.me] || { net: 0, paid: 0, owed: 0, sent: 0, received: 0 };
    const plan = G.settle(g);
    const mine = plan.filter(p => p.from === S.me || p.to === S.me);
    let head;
    if (bal.net > 0) head = `<div class="gp-state pos">Je krijgt nog <strong class="money">${money(bal.net)}</strong> terug</div>`;
    else if (bal.net < 0) head = `<div class="gp-state owe">Je moet nog <strong class="money">${money(-bal.net)}</strong> betalen</div>`;
    else head = `<div class="gp-state even">Je staat gelijk ✓</div>`;
    const steps = mine.map(p => p.from === S.me
      ? `<div class="gp-step"><div class="grow">Betaal <strong class="money">${money(p.amount)}</strong> aan <strong>${esc(nameOf(p.to))}</strong></div><button class="btn small primary" data-a="pay" data-from="${esc(p.from)}" data-to="${esc(p.to)}" data-amount="${p.amount}">Ik heb betaald</button></div>`
      : `<div class="gp-step"><div class="grow"><strong>${esc(nameOf(p.from))}</strong> betaalt jou <strong class="money">${money(p.amount)}</strong></div><button class="btn small" data-a="pay" data-from="${esc(p.from)}" data-to="${esc(p.to)}" data-amount="${p.amount}">Ontvangen</button></div>`).join('');
    return `<section class="card gp-me">
      ${head}
      <div class="gp-me-sub muted small">Jij betaalde <span class="money">${money(bal.paid)}</span> · jouw deel is <span class="money">${money(bal.owed)}</span>${bal.sent ? ' · jij betaalde terug <span class="money">' + money(bal.sent) + '</span>' : ''}${bal.received ? ' · jij kreeg terug <span class="money">' + money(bal.received) + '</span>' : ''}</div>
      ${steps ? `<div class="gp-steps">${steps}</div>` : ''}
      <button class="btn primary gp-add" data-a="new-expense">＋ Uitgave toevoegen</button>
    </section>`;
  }

  function forText(e) {
    const sh = G.shares(e);
    const ids = Object.keys(sh);
    if (e.split.mode === 'amounts') return 'verdeeld: ' + ids.map(id => who(id) + ' ' + money(sh[id])).join(', ');
    if (ids.length === S.group.members.length && S.group.members.length > 2) return 'voor iedereen';
    const names = ids.map(who);
    return 'voor ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' en ' + names[names.length - 1] : names[0]);
  }

  function listView() {
    const g = S.group;
    const items = g.expenses.map(e => ({ kind: 'e', date: e.date, at: e.createdAt || 0, e }))
      .concat(g.payments.map(p => ({ kind: 'p', date: p.date, at: p.createdAt || 0, p })))
      .sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
    if (!items.length) {
      return `<div class="gp-empty"><div class="gp-big-icon">🧾</div><p><strong>Nog geen uitgaven.</strong></p><p class="muted small">Betaalde iemand iets voor de groep? Tik op <strong>＋ Uitgave toevoegen</strong>. Helder rekent uit wie wie hoeveel moet.</p></div>`;
    }
    let last = '';
    const rows = items.map(it => {
      const head = it.date !== last ? `<div class="gp-day">${esc(dayLabel(it.date))}</div>` : '';
      last = it.date;
      if (it.kind === 'p') {
        const p = it.p;
        return head + `<button class="gp-item gp-pay" data-a="open-payment" data-id="${esc(p.id)}">
          <span class="gp-ico">💸</span>
          <span class="grow"><span class="gp-item-title">${esc(Who(p.from))} betaalde ${esc(who(p.to))} terug</span>${p.note ? `<span class="gp-item-sub">${esc(p.note)}</span>` : ''}</span>
          <span class="gp-amt money">${money(p.amount)}</span></button>`;
      }
      const e = it.e;
      const my = G.shares(e)[S.me] || 0;
      return head + `<button class="gp-item" data-a="open-expense" data-id="${esc(e.id)}">
        <span class="gp-ico">🧾</span>
        <span class="grow"><span class="gp-item-title">${esc(e.title)}</span>
          <span class="gp-item-sub">${esc(Who(e.paidBy))} betaalde · ${esc(forText(e))}</span></span>
        <span class="gp-amt"><span class="money">${money(e.amount)}</span><span class="gp-item-sub">${my ? 'jouw deel <span class="money">' + money(my) + '</span>' : 'niet voor jou'}</span></span></button>`;
    }).join('');
    const total = g.expenses.reduce((s, e) => s + e.amount, 0);
    return `<div class="gp-list">${rows}</div><p class="muted small gp-center">Samen uitgegeven: <span class="money">${money(total)}</span></p>`;
  }

  function balanceView() {
    const g = S.group;
    const bal = G.balances(g);
    const max = Math.max(1, ...g.members.map(m => Math.abs((bal[m.id] || {}).net || 0)));
    const plan = G.settle(g);
    const rows = g.members.map(m => {
      const n = (bal[m.id] || {}).net || 0;
      const w = Math.round(Math.abs(n) / max * 100);
      return `<div class="gp-bal">
        <div class="gp-bal-name">${esc(m.name)}${m.id === S.me ? ' <span class="muted small">(jij)</span>' : ''}</div>
        <div class="gp-bal-bar"><span class="${n >= 0 ? 'plus' : 'min'}" style="width:${w / 2}%"></span></div>
        <div class="gp-bal-amt ${n > 0 ? 'pos' : n < 0 ? 'owe' : 'muted'}">${n > 0 ? 'krijgt ' : n < 0 ? 'moet ' : ''}<span class="money">${money(Math.abs(n))}</span></div></div>`;
    }).join('');
    const steps = plan.length ? plan.map(p => `<div class="gp-step"><div class="grow"><strong>${esc(Who(p.from))}</strong> → <strong>${esc(who(p.to))}</strong> <span class="money">${money(p.amount)}</span></div>
        <button class="btn small" data-a="pay" data-from="${esc(p.from)}" data-to="${esc(p.to)}" data-amount="${p.amount}">Gedaan</button></div>`).join('')
      : '<p class="muted small">Iedereen staat gelijk. Niemand moet nog iets betalen. 🎉</p>';
    return `<section class="card"><h3>Saldo per persoon</h3><p class="muted small">Groen krijgt nog geld, oranje moet nog betalen.</p>${rows}</section>
      <section class="card"><h3>Zo staat iedereen gelijk</h3><p class="muted small">Zo weinig mogelijk overschrijvingen. Tik op <strong>Gedaan</strong> zodra het geld overgeschreven is.</p><div class="gp-steps">${steps}</div>
        <p class="gp-row"><button class="btn small ghost" data-a="new-payment">＋ Andere terugbetaling</button></p></section>
      <section class="card"><h3>Wie zit erin?</h3>
        <div class="gp-members">${g.members.map(m => `<div class="gp-member"><span class="gp-avatar">${esc(initial(m.name))}</span><span class="grow">${esc(m.name)}${m.id === S.me ? ' <span class="muted small">(jij)</span>' : ''}</span><button class="btn small ghost" data-a="edit-member" data-id="${esc(m.id)}">Aanpassen</button></div>`).join('')}</div>
        <p class="gp-row"><button class="btn small" data-a="new-member">＋ Persoon toevoegen</button><button class="btn small ghost" data-a="share">🔗 Link delen</button></p>
        <p class="muted small">Iedereen met de link kan uitgaven toevoegen en aanpassen. Deel ze dus enkel met de groep.</p></section>`;
  }

  function mainView() {
    return `${myCard()}
      <div class="gp-tabs" role="tablist">
        <button role="tab" aria-selected="${S.tab === 'uitgaven'}" data-a="tab" data-tab="uitgaven">Uitgaven</button>
        <button role="tab" aria-selected="${S.tab === 'saldo'}" data-a="tab" data-tab="saldo">Saldo's</button>
      </div>
      ${S.tab === 'saldo' ? balanceView() : listView()}
      <p class="gp-foot small muted">Je bent <strong>${esc(nameOf(S.me))}</strong> · <button class="linklike" data-a="switch">niet jij?</button> · <button class="linklike" data-a="share">link delen</button></p>`;
  }

  // ---------- Formulieren (onderaan schuivend venster) ----------

  function openSheet(kind, html) {
    S.sheet = kind;
    $('#gp-toast').hidden = true;
    sheetEl.innerHTML = `<div class="gp-sheet-bg" data-a="close"></div><div class="gp-sheet" role="dialog" aria-modal="true">${html}</div>`;
    sheetEl.hidden = false;
    document.body.classList.add('gp-noscroll');
    const f = sheetEl.querySelector('[data-autofocus]');
    if (f && !matchMedia('(pointer: coarse)').matches) f.focus();
  }
  function closeSheet() {
    S.sheet = null;
    sheetEl.hidden = true;
    sheetEl.innerHTML = '';
    document.body.classList.remove('gp-noscroll');
  }

  const memberOptions = sel => S.group.members.map(m => `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${esc(m.id === S.me ? m.name + ' (jij)' : m.name)}</option>`).join('');

  function expenseSheet(e) {
    const g = S.group;
    const isNew = !e;
    e = e || { title: '', amount: 0, date: C.todayStr(), paidBy: S.me, split: { mode: 'equal', among: g.members.map(m => m.id) } };
    const sh = G.shares(e);
    const mode = e.split.mode;
    const by = !isNew ? `<p class="muted small">Toegevoegd door ${esc(e.createdBy ? nameOf(e.createdBy) : 'onbekend')}${e.updatedBy && e.updatedBy !== e.createdBy ? ', aangepast door ' + esc(nameOf(e.updatedBy)) : ''}</p>` : '';
    openSheet('expense', `<form data-f="expense" data-id="${esc(e.id || '')}" novalidate>
      <div class="gp-sheet-head"><h2>${isNew ? 'Nieuwe uitgave' : 'Uitgave'}</h2><button type="button" class="btn ghost" data-a="close" aria-label="Sluiten">✕</button></div>
      ${by}
      <label class="field"><span>Waarvoor?</span><input name="title" maxlength="80" value="${esc(e.title)}" placeholder="bv. Boodschappen, tankbeurt, pizza" required data-autofocus></label>
      <div class="gp-two">
        <label class="field"><span>Bedrag</span><input name="amount" class="gp-amount" inputmode="decimal" autocomplete="off" value="${e.amount ? esc(C.centsToInput(e.amount)) : ''}" placeholder="0,00" required></label>
        <label class="field"><span>Datum</span><input name="date" type="date" value="${esc(e.date)}" required></label>
      </div>
      <label class="field"><span>Wie betaalde?</span><select name="paidBy">${memberOptions(e.paidBy)}</select></label>
      <div class="field"><span>Voor wie?</span>
        <div class="gp-seg" role="radiogroup">
          <label><input type="radio" name="mode" value="equal" ${mode !== 'amounts' ? 'checked' : ''}><span>Gelijk verdelen</span></label>
          <label><input type="radio" name="mode" value="amounts" ${mode === 'amounts' ? 'checked' : ''}><span>Eigen bedragen</span></label>
        </div>
        <div class="gp-for">${g.members.map(m => `<label class="gp-for-row">
            <input type="checkbox" name="for" value="${esc(m.id)}" ${sh[m.id] || (mode === 'equal' && e.split.among.includes(m.id)) ? 'checked' : ''}>
            <span class="grow">${esc(m.name)}${m.id === S.me ? ' <span class="muted small">(jij)</span>' : ''}</span>
            <span class="gp-share money" data-share="${esc(m.id)}"></span>
            <input class="gp-part" data-part="${esc(m.id)}" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${mode === 'amounts' && sh[m.id] ? esc(C.centsToInput(sh[m.id])) : ''}" aria-label="Deel van ${esc(m.name)}">
          </label>`).join('')}</div>
        <div class="gp-split-info small" aria-live="polite"></div>
      </div>
      <div class="gp-err errors"></div>
      <div class="gp-row gp-actions"><button class="btn primary" type="submit">${isNew ? 'Toevoegen' : 'Bewaren'}</button>
        ${isNew ? '' : '<button class="btn ghost danger" type="button" data-a="delete-expense">Verwijderen</button>'}</div>
    </form>`);
    updateSplit();
  }

  /** Leest het uitgaveformulier. Geeft { expense } of { error } terug. */
  function readExpense(form) {
    const amount = C.parseAmount(form.amount.value);
    const mode = form.querySelector('[name=mode]:checked').value;
    const checked = [...form.querySelectorAll('[name=for]:checked')].map(i => i.value);
    const e = { title: form.title.value, amount: Math.abs(amount) || 0, date: form.date.value, paidBy: form.paidBy.value };
    if (form.dataset.id) e.id = form.dataset.id;
    if (mode === 'amounts') {
      const amounts = {};
      form.querySelectorAll('[data-part]').forEach(i => { const v = C.parseAmount(i.value); if (v > 0) amounts[i.dataset.part] = v; });
      e.split = { mode: 'amounts', amounts };
    } else e.split = { mode: 'equal', among: checked };
    return e;
  }

  function updateSplit() {
    const form = sheetEl.querySelector('form[data-f=expense]');
    if (!form) return;
    const e = readExpense(form);
    const mode = e.split.mode;
    form.classList.toggle('mode-amounts', mode === 'amounts');
    const info = form.querySelector('.gp-split-info');
    if (mode === 'equal') {
      const sh = e.amount > 0 && e.split.among.length ? G.shares(e) : {};
      form.querySelectorAll('[data-share]').forEach(s => { s.textContent = sh[s.dataset.share] ? money(sh[s.dataset.share]) : ''; });
      const n = e.split.among.length;
      info.className = 'gp-split-info small ' + (n ? 'muted' : 'owe');
      info.textContent = !n ? 'Duid minstens één persoon aan.' : e.amount > 0 ? (n === 1 ? 'Eén persoon draagt alles.' : n + ' personen, elk ongeveer ' + money(Math.floor(e.amount / n)) + '.') : '';
    } else {
      const sum = Object.values(e.split.amounts).reduce((s, v) => s + v, 0);
      const left = e.amount - sum;
      info.className = 'gp-split-info small ' + (left === 0 && sum > 0 ? 'pos' : 'owe');
      info.textContent = !e.amount ? 'Vul eerst het bedrag in.' : left === 0 ? '✓ Klopt: alles is verdeeld.' : left > 0 ? 'Nog te verdelen: ' + money(left) : 'Te veel verdeeld: ' + money(-left);
    }
  }

  /** In 'eigen bedragen': vult het laatste lege vakje automatisch aan met wat overblijft. */
  function autoFillParts(changed) {
    const form = changed.form;
    const amount = Math.abs(C.parseAmount(form.amount.value)) || 0;
    if (!amount) return;
    const parts = [...form.querySelectorAll('[data-part]')];
    const empty = parts.filter(p => p !== changed && (!p.value.trim() || p.dataset.auto === '1') && p.closest('.gp-for-row').querySelector('[name=for]').checked);
    if (empty.length !== 1) return;
    const sum = parts.filter(p => p !== empty[0]).reduce((s, p) => s + (C.parseAmount(p.value) > 0 ? C.parseAmount(p.value) : 0), 0);
    const left = amount - sum;
    empty[0].value = left > 0 ? C.centsToInput(left) : '';
    empty[0].dataset.auto = '1';
  }

  function paymentSheet(p, opts) {
    const isNew = !p || !p.id;
    p = Object.assign({ from: S.me, to: (S.group.members.find(m => m.id !== S.me) || {}).id, amount: 0, date: C.todayStr(), note: '' }, p || {});
    const title = opts && opts.suggested
      ? (p.from === S.me ? 'Betaalde je ' + esc(nameOf(p.to)) + ' terug?' : p.to === S.me ? 'Kreeg je geld van ' + esc(nameOf(p.from)) + '?' : 'Betaalde ' + esc(nameOf(p.from)) + ' ' + esc(nameOf(p.to)) + ' terug?')
      : isNew ? 'Terugbetaling' : 'Terugbetaling';
    openSheet('payment', `<form data-f="payment" data-id="${esc(p.id || '')}" novalidate>
      <div class="gp-sheet-head"><h2>${title}</h2><button type="button" class="btn ghost" data-a="close" aria-label="Sluiten">✕</button></div>
      ${!isNew ? `<p class="muted small">Toegevoegd door ${esc(p.createdBy ? nameOf(p.createdBy) : 'onbekend')}</p>` : '<p class="muted small">Noteer hier geld dat al overgeschreven of cash gegeven is. Dit is geen uitgave: het zet de saldo\'s recht.</p>'}
      <div class="gp-two">
        <label class="field"><span>Van</span><select name="from" ${isNew ? '' : 'disabled'}>${memberOptions(p.from)}</select></label>
        <label class="field"><span>Aan</span><select name="to" ${isNew ? '' : 'disabled'}>${memberOptions(p.to)}</select></label>
      </div>
      <div class="gp-two">
        <label class="field"><span>Bedrag</span><input name="amount" class="gp-amount" inputmode="decimal" autocomplete="off" value="${p.amount ? esc(C.centsToInput(p.amount)) : ''}" placeholder="0,00" ${isNew ? '' : 'disabled'} required></label>
        <label class="field"><span>Datum</span><input name="date" type="date" value="${esc(p.date)}" ${isNew ? '' : 'disabled'} required></label>
      </div>
      <label class="field"><span>Opmerking (mag leeg)</span><input name="note" maxlength="120" value="${esc(p.note || '')}" placeholder="bv. via Payconiq" ${isNew ? '' : 'disabled'}></label>
      <div class="gp-err errors"></div>
      <div class="gp-row gp-actions">${isNew ? `<button class="btn primary" type="submit">${opts && opts.suggested ? 'Ja, bewaren' : 'Bewaren'}</button>` : '<button class="btn ghost danger" type="button" data-a="delete-payment">Verwijderen</button><button class="btn" type="button" data-a="close">Sluiten</button>'}</div>
    </form>`);
  }

  function memberSheet(m) {
    openSheet('member', `<form data-f="member" data-id="${esc(m ? m.id : '')}">
      <div class="gp-sheet-head"><h2>${m ? 'Naam aanpassen' : 'Persoon toevoegen'}</h2><button type="button" class="btn ghost" data-a="close" aria-label="Sluiten">✕</button></div>
      <label class="field"><span>Naam</span><input name="name" maxlength="40" value="${esc(m ? m.name : '')}" required data-autofocus></label>
      <div class="gp-err errors"></div>
      <div class="gp-row gp-actions"><button class="btn primary" type="submit">Bewaren</button>
      ${m && m.id !== S.group.ownerMember && m.id !== S.me ? '<button class="btn ghost danger" type="button" data-a="delete-member">Uit de groep halen</button>' : ''}</div>
    </form>`);
  }

  async function share() {
    const url = location.href;
    const text = 'Voeg je uitgaven toe aan "' + S.group.name + '"';
    // De link staat achteraan in de tekst: sommige apps plakken anders de tekst achter de link (en breken die)
    if (navigator.share) { try { await navigator.share({ text: text + ': ' + url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Link gekopieerd. Plak hem in een bericht aan de groep.'); }
    catch (e) { window.prompt('Kopieer deze link:', url); }
  }

  // ---------- Acties ----------

  document.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-a]');
    if (!el) return;
    const a = el.dataset.a;
    const g = S.group;
    if (a === 'pick') { S.me = el.dataset.id; store.set(meKey(), S.me); S.adding = false; render(); window.scrollTo(0, 0); }
    else if (a === 'add-me') { S.adding = true; render(); }
    else if (a === 'add-me-cancel') { S.adding = false; render(); }
    else if (a === 'switch') { S.me = null; store.set(meKey(), null); render(); }
    else if (a === 'tab') { S.tab = el.dataset.tab; render(); }
    else if (a === 'share') share();
    else if (a === 'close') closeSheet();
    else if (a === 'new-expense') expenseSheet(null);
    else if (a === 'open-expense') { const e = g.expenses.find(x => x.id === el.dataset.id); if (e) expenseSheet(e); }
    else if (a === 'new-payment') paymentSheet(null);
    else if (a === 'open-payment') { const p = g.payments.find(x => x.id === el.dataset.id); if (p) paymentSheet(p); }
    else if (a === 'pay') paymentSheet({ from: el.dataset.from, to: el.dataset.to, amount: Number(el.dataset.amount) }, { suggested: true });
    else if (a === 'new-member') memberSheet(null);
    else if (a === 'edit-member') { const m = member(el.dataset.id); if (m) memberSheet(m); }
    else if (a === 'delete-expense') {
      const id = sheetEl.querySelector('form').dataset.id;
      const e = g.expenses.find(x => x.id === id);
      if (e && confirm('"' + e.title + '" (' + money(e.amount) + ') verwijderen? Dit geldt voor iedereen in de groep.') && await op('expense.delete', { id })) { closeSheet(); render(); toast('Uitgave verwijderd.'); }
    } else if (a === 'delete-payment') {
      const id = sheetEl.querySelector('form').dataset.id;
      if (confirm('Deze terugbetaling verwijderen? De saldo\'s worden opnieuw berekend.') && await op('payment.delete', { id })) { closeSheet(); render(); toast('Terugbetaling verwijderd.'); }
    } else if (a === 'delete-member') {
      const id = sheetEl.querySelector('form').dataset.id;
      if (confirm(nameOf(id) + ' uit de groep halen?') && await op('member.remove', { id })) { closeSheet(); render(); }
    }
  });

  document.addEventListener('input', ev => {
    const t = ev.target;
    if (!t.closest('form[data-f=expense]')) return;
    if (t.dataset.part) { delete t.dataset.auto; autoFillParts(t); const box = t.closest('.gp-for-row').querySelector('[name=for]'); if (C.parseAmount(t.value) > 0) box.checked = true; }
    updateSplit();
  });
  document.addEventListener('change', ev => {
    const t = ev.target;
    const form = t.closest('form[data-f=expense]');
    if (!form) return;
    if (t.name === 'for' && !t.checked) { const p = form.querySelector(`[data-part="${CSS.escape(t.value)}"]`); if (p) p.value = ''; }
    if (t.name === 'mode' && t.value === 'amounts') {
      // Begin met de gelijke verdeling als voorstel
      const e = readExpense(form);
      const sh = e.amount > 0 ? G.shares({ amount: e.amount, split: { mode: 'equal', among: [...form.querySelectorAll('[name=for]:checked')].map(i => i.value) } }) : {};
      form.querySelectorAll('[data-part]').forEach(p => { if (!p.value.trim()) p.value = sh[p.dataset.part] ? C.centsToInput(sh[p.dataset.part]) : ''; });
    }
    updateSplit();
  });

  document.addEventListener('submit', async ev => {
    const form = ev.target;
    if (!form.dataset.f) return;
    ev.preventDefault();
    const err = form.querySelector('.gp-err');
    const fail = msg => { if (err) err.textContent = msg; };
    if (err) err.textContent = '';
    const f = form.dataset.f;
    if (f === 'add-me') {
      const id = await op('member.add', { name: form.name.value }, null);
      if (id) { S.me = id; store.set(meKey(), id); S.adding = false; render(); toast('Welkom, ' + nameOf(id) + '!'); }
      return;
    }
    if (f === 'expense') {
      const e = readExpense(form);
      if (!(C.parseAmount(form.amount.value) > 0)) return fail('Vul een bedrag in, bv. 12,50.');
      try { G.normExpense(e, S.group); } catch (x) { return fail(x.message); }
      const isNew = !e.id;
      if (await op('expense.save', { expense: e })) { closeSheet(); if (isNew) S.tab = 'uitgaven'; render(); toast(isNew ? 'Toegevoegd. Iedereen in de groep ziet het nu.' : 'Bewaard.'); }
      return;
    }
    if (f === 'payment') {
      const p = { from: form.from.value, to: form.to.value, amount: Math.abs(C.parseAmount(form.amount.value)) || 0, date: form.date.value, note: form.note.value };
      try { G.normPayment(p, S.group); } catch (x) { return fail(x.message); }
      if (await op('payment.save', { payment: p })) { closeSheet(); render(); toast('Terugbetaling bewaard.'); }
      return;
    }
    if (f === 'member') {
      const id = form.dataset.id;
      const r = id ? await op('member.rename', { id, name: form.name.value }) : await op('member.add', { name: form.name.value });
      if (r) { closeSheet(); render(); }
    }
  });

  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.sheet) closeSheet(); });

  // Wijzigingen van de anderen ophalen
  setInterval(() => { if (!document.hidden && !S.sheet && S.token) load(true); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !S.sheet && S.token) load(true); });

  function start() {
    // Enkel de sleutel zelf: soms plakt een berichtenapp er tekst achter (bv. "#abc… Voeg je uitgaven toe")
    let raw = location.hash.replace(/^#/, '');
    try { raw = decodeURIComponent(raw); } catch (e) { /* ongeldige codering: gebruik zoals het is */ }
    const hit = raw.trim().match(/^[A-Za-z0-9_-]{32,64}/);
    S.token = hit ? hit[0] : '';
    if (hit && raw !== S.token) history.replaceState(null, '', location.pathname + '#' + S.token);
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(S.token)) { S.token = ''; S.error = ''; render(); return; }
    load(false);
  }
  window.addEventListener('hashchange', () => { S.group = null; S.me = null; start(); });
  start();
})();
