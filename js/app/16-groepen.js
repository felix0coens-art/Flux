  // ----- Groepen (zoals Tricount) -----
  //
  // Een groep leeft op de server en is te openen met een geheime link (/g#token), zonder account.
  // In Helder is een groep één "persoon" voor de voorschotten (bv. "👥 Weekend"):
  //  - wat jij betaalde voor de anderen          → voorschot voor de groep (je bankbetaling wordt gesplitst)
  //  - jouw deel van wat anderen betaalden        → verrekend: jouw uitgave in een categorie (bv. Eten)
  //  - terugbetalingen die jij kreeg of deed      → terugbetaling van / voorschot voor de groep
  // Staat alles verwerkt, dan is wat Helder nog open ziet voor de groep exact je saldo in de groep.

  const GRP = window.FluxGroups;
  const groupUi = { data: {}, error: {}, loading: {}, at: {} };
  const groupsOn = () => !!(GRP && Sync && Sync.mode === 'server' && !demo);
  const groupList = () => state.groups || [];
  const groupById = id => groupList().find(g => g.id === id) || null;
  const groupPerson = g => g.person || '👥 ' + g.name;
  const isGroupPerson = name => { const k = String(name || '').trim().toLowerCase(); return !!k && groupList().some(g => groupPerson(g).toLowerCase() === k); };
  const groupLink = g => location.origin + '/g#' + g.token;
  const gMember = (pg, id) => (pg.members.find(m => m.id === id) || { name: '?' }).name;
  const gWho = (g, pg, id) => id === g.memberId ? 'jij' : gMember(pg, id);
  const myName = () => (Sync && Sync.account && (Sync.account.displayName || Sync.account.user)) || '';

  async function loadGroup(g, force) {
    if (!groupsOn() || groupUi.loading[g.id]) return;
    if (!force && groupUi.at[g.id] && Date.now() - groupUi.at[g.id] < 20000) return;
    groupUi.loading[g.id] = true;
    let changed = true;
    try {
      const pg = await Sync.groups.load(g.token);
      const old = groupUi.data[g.id];
      changed = !old || old.rev !== pg.rev || !!groupUi.error[g.id];
      groupUi.data[g.id] = pg;
      groupUi.error[g.id] = '';
      // Opent de eigenaar de deelpagina op dit toestel, dan weet die al wie hij is
      try { if (g.memberId) localStorage.setItem('helder-groep-' + pg.id, g.memberId); } catch (e) { /* geen opslag */ }
      if (pg.name !== g.name) { g.name = pg.name; Store.save(realState); }
    } catch (e) {
      groupUi.error[g.id] = e.status === 404 ? 'gone' : e.message;
    }
    groupUi.loading[g.id] = false;
    groupUi.at[g.id] = Date.now();
    if (modal && modal.wait === g.id) { delete modal.wait; renderModal(); } else if (changed && !modal && ui.view === 'advances') render();
  }

  async function groupOp(g, op, data) {
    const r = await Sync.groups.op(g.token, g.memberId, op, data);
    groupUi.data[g.id] = r.group;
    groupUi.at[g.id] = Date.now();
    return r.result;
  }

  /** Eigen deel (categorie) van een gesplitste groepsbetaling. */
  function ownCatOf(t) {
    const own = C.splitLines(t).find(l => l.categoryId !== C.SYS_ADVANCE);
    return own ? own.categoryId : null;
  }
  const advPart = t => C.splitLines(t).filter(l => l.categoryId === C.SYS_ADVANCE).reduce((s, l) => s + l.amount, 0);

  /** Splitst een eigen betaling: jouw deel in de categorie, de rest als voorschot voor de groep. */
  function applyGroupSplit(t, g, e, ownCat) {
    const share = GRP.shares(e)[g.memberId] || 0;
    const others = e.amount - share;
    const own = -t.amount - others; // wijkt het bedrag in de groep af, dan is jouw deel het verschil
    if (own < 0) return 'De anderen hun deel (' + money(others) + ') is groter dan deze betaling (' + money(-t.amount) + ').';
    delete t.splitByRule; delete t.personByRule; delete t.advanceOf;
    if (others > 0 && own > 0) {
      t.splits = [{ categoryId: ownCat || null, amount: -own, note: '', person: '' }, { categoryId: C.SYS_ADVANCE, amount: -others, person: groupPerson(g), note: e.title }];
      t.categoryId = ownCat || null;
      delete t.person;
    } else if (others > 0) {
      t.splits = []; t.categoryId = C.SYS_ADVANCE; t.person = groupPerson(g);
    } else {
      t.splits = []; t.categoryId = ownCat || null; delete t.person;
    }
    t.categorySource = 'manual'; t.ruleId = null;
    if (t.isTransfer || t.transferMode === 'yes') t.transferMode = 'no';
    t.groupRef = { groupId: g.id, expenseId: e.id };
    if (!t.title) t.title = e.title;
    ensurePerson(groupPerson(g));
    return '';
  }

  /** Een terugbetaling binnen de groep (jij kreeg of gaf geld) op een transactie zetten. */
  function applyGroupPayment(t, g, p) {
    const sign = p.to === g.memberId ? 1 : -1;
    if (Math.sign(t.amount) !== sign) return sign > 0 ? 'Kies een inkomende betaling.' : 'Kies een uitgaande betaling.';
    if (Math.abs(t.amount) < p.amount) return 'Deze betaling (' + money(Math.abs(t.amount)) + ') is kleiner dan de terugbetaling (' + money(p.amount) + ').';
    delete t.splitByRule; delete t.personByRule; delete t.advanceOf; t.refundOf = null;
    if (Math.abs(t.amount) === p.amount) { t.splits = []; t.categoryId = C.SYS_ADVANCE; t.person = groupPerson(g); }
    else { t.splits = [{ categoryId: C.SYS_ADVANCE, amount: sign * p.amount, person: groupPerson(g), note: 'groep ' + g.name }]; t.categoryId = null; delete t.person; }
    t.categorySource = 'manual'; t.ruleId = null;
    if (t.isTransfer || t.transferMode === 'yes') t.transferMode = 'no';
    t.groupRef = { groupId: g.id, paymentId: p.id };
    ensurePerson(groupPerson(g));
    return '';
  }

  /** Wat uit de groep nog niet (juist) in Helder staat. */
  function groupTodo(g, pg) {
    const me = g.memberId;
    const linked = state.transactions.filter(t => t.groupRef && t.groupRef.groupId === g.id);
    const fgs = ((personEntity(groupPerson(g)) || {}).forgiven || []).filter(f => f.groupExpenseId);
    const out = { others: [], ownUnlinked: [], payments: [], fix: [] };
    if (!me) return out;
    for (const e of pg.expenses) {
      const share = GRP.shares(e)[me] || 0;
      if (e.paidBy === me) {
        const t = linked.find(x => x.groupRef.expenseId === e.id);
        if (!t) out.ownUnlinked.push(e);
        else if (-advPart(t) !== e.amount - share) out.fix.push({ kind: 'tx', t, e, text: '“' + e.title + '” werd aangepast in de groep' });
      } else {
        const booked = fgs.filter(f => f.groupExpenseId === e.id).reduce((s, f) => s + f.amount, 0);
        if (share && !booked) out.others.push({ e, share });
        else if (booked !== share) out.fix.push({ kind: 'fg', e, share, text: '“' + e.title + '”: jouw deel is nu ' + money(share) + ' (was ' + money(booked) + ')' });
      }
    }
    for (const t of linked) {
      if (t.groupRef.expenseId && !pg.expenses.some(e => e.id === t.groupRef.expenseId && e.paidBy === me)) out.fix.push({ kind: 'tx-gone', t, text: '“' + (t.title || t.counterparty) + '” staat niet meer in de groep' });
      if (t.groupRef.paymentId && !pg.payments.some(p => p.id === t.groupRef.paymentId)) out.fix.push({ kind: 'tx-gone', t, text: 'Een terugbetaling werd uit de groep verwijderd' });
    }
    for (const f of fgs) if (!pg.expenses.some(e => e.id === f.groupExpenseId && e.paidBy !== me)) out.fix.push({ kind: 'fg-gone', f, text: '“' + f.note + '” staat niet meer in de groep' });
    for (const p of pg.payments) if ((p.from === me || p.to === me) && !linked.some(t => t.groupRef.paymentId === p.id)) out.payments.push(p);
    return out;
  }

  function groupFixAll(g) {
    const pg = groupUi.data[g.id];
    if (!pg) return;
    const todo = groupTodo(g, pg);
    const per = personEntity(groupPerson(g));
    for (const x of todo.fix) {
      if (x.kind === 'tx') applyGroupSplit(x.t, g, x.e, ownCatOf(x.t));
      else if (x.kind === 'tx-gone') { const own = ownCatOf(x.t); x.t.splits = []; delete x.t.person; delete x.t.groupRef; x.t.categoryId = x.t.amount < 0 ? own : null; x.t.categorySource = 'manual'; }
      else if (per && x.kind === 'fg') {
        const list = per.forgiven.filter(f => f.groupExpenseId === x.e.id);
        per.forgiven = per.forgiven.filter(f => f.groupExpenseId !== x.e.id || (x.share > 0 && f === list[0]));
        if (x.share > 0) list[0].amount = x.share;
      } else if (per && x.kind === 'fg-gone') per.forgiven = per.forgiven.filter(f => f !== x.f);
    }
    commit('Bijgewerkt met de groep');
  }

  // ---------- Opvolgen: blok met de groepen ----------

  function groupsSection() {
    if (!groupsOn()) {
      return `<section class="follow-block"><div class="follow-head"><h2 class="section-title">👥 Groepen</h2></div>
        <div class="card empty-state"><p class="small muted">${demo ? 'Groepen werken niet in de voorbeeldmodus.' : 'Groepen (zoals Tricount) werken met een Helder-account op de server: meld je aan om er een te maken.'}</p></div></section>`;
    }
    const list = groupList();
    const cards = list.map(groupCard).join('');
    return `<section class="follow-block">
      <div class="follow-head"><h2 class="section-title">👥 Groepen — samen uitgaven delen</h2><span class="spacer"></span>
        <button class="btn small primary" data-action="group-new">+ Groep</button></div>
      ${list.length ? `<div class="grid cards people">${cards}</div>` : `<div class="card empty-state group-intro">
        <p><strong>Op reis, weekend of met huisgenoten?</strong> Maak een groep en deel de link. Iedereen voegt zelf toe wat hij betaalde, zonder account. Helder rekent uit wie wie hoeveel moet.</p>
        <p class="small muted">Wat jij betaalde voor de anderen, komt automatisch bij je voorschotten. Jouw deel van wat de anderen betaalden, wordt jouw uitgave in de categorie die je kiest.</p>
        <p><button class="btn primary" data-action="group-new">+ Eerste groep maken</button></p></div>`}
    </section>`;
  }

  function groupCard(g) {
    const pg = groupUi.data[g.id];
    const err = groupUi.error[g.id];
    if (!pg && !err) setTimeout(() => loadGroup(g), 0);
    else if (pg) setTimeout(() => loadGroup(g), 0); // verversen (hoogstens om de 20 seconden)
    const tools = `<div class="card-tools">
        <button class="btn small" data-action="group-share" data-id="${esc(g.id)}">🔗 Link delen</button>
        <a class="btn small" href="${esc(groupLink(g))}" target="_blank" rel="noopener">Openen ↗</a>
        <button class="btn small ghost danger" data-action="group-remove" data-id="${esc(g.id)}">Verwijderen</button></div>`;
    if (err === 'gone') {
      return `<div class="card person-card"><div class="person-head"><span class="avatar" aria-hidden="true">👥</span><div class="grow"><strong class="person-name">${esc(g.name)}</strong></div></div>
        <p class="small muted">Deze groep bestaat niet meer op de server.</p>${tools}</div>`;
    }
    if (!pg) return `<div class="card person-card"><div class="person-head"><span class="avatar" aria-hidden="true">👥</span><div class="grow"><strong class="person-name">${esc(g.name)}</strong><div class="small muted">${esc(err || 'Laden…')}</div></div></div>${tools}</div>`;
    const bal = GRP.balances(pg)[g.memberId] || { net: 0 };
    const todo = groupTodo(g, pg);
    const plan = GRP.settle(pg).filter(p => p.from === g.memberId || p.to === g.memberId);
    const status = bal.net > 0 ? ['je krijgt nog', money(bal.net), 'pos'] : bal.net < 0 ? ['je moet nog', money(-bal.net), 'warn-text'] : ['', '✓ gelijk', ''];
    const n = todo.others.length + todo.ownUnlinked.length + todo.payments.length + todo.fix.length;
    const othersSum = todo.others.reduce((s, x) => s + x.share, 0);
    const rows = [];
    if (todo.others.length) rows.push(`<div class="grp-todo"><span class="grow">🧾 <strong>${todo.others.length}</strong> ${todo.others.length === 1 ? 'uitgave' : 'uitgaven'} van anderen waarin jij deelt · jouw deel <strong>${money(othersSum)}</strong></span>
        <button class="btn small primary" data-action="group-book" data-id="${esc(g.id)}">In Helder boeken…</button></div>`);
    for (const e of todo.ownUnlinked) rows.push(`<div class="grp-todo"><span class="grow">💳 Jij betaalde <strong>${esc(e.title)}</strong> ${money(e.amount)} <span class="small muted">${fmtDate(e.date)}</span><span class="small muted grp-why">Welke betaling bij je bank was dat?</span></span>
        <button class="btn small" data-action="group-pick-tx" data-id="${esc(g.id)}" data-expense="${esc(e.id)}">🔗 Koppelen</button><button class="btn small ghost" data-action="group-cash" data-id="${esc(g.id)}" data-expense="${esc(e.id)}">💶 Cash</button></div>`);
    for (const p of todo.payments) rows.push(`<div class="grp-todo"><span class="grow">💸 ${p.to === g.memberId ? `<strong>${esc(gMember(pg, p.from))}</strong> betaalde jou ${money(p.amount)} terug` : `Jij betaalde <strong>${esc(gMember(pg, p.to))}</strong> ${money(p.amount)} terug`} <span class="small muted">${fmtDate(p.date)}</span></span>
        <button class="btn small" data-action="group-pick-tx" data-id="${esc(g.id)}" data-payment="${esc(p.id)}">🔗 Koppelen</button><button class="btn small ghost" data-action="group-cash" data-id="${esc(g.id)}" data-payment="${esc(p.id)}">💶 Cash</button></div>`);
    if (todo.fix.length) rows.push(`<div class="grp-todo warn"><span class="grow">⚠ Veranderd in de groep: ${todo.fix.map(x => esc(x.text)).join(' · ')}</span><button class="btn small primary" data-action="group-fix" data-id="${esc(g.id)}">Bijwerken</button></div>`);
    const open = (C.personList(state).find(p => p.name.toLowerCase() === groupPerson(g).toLowerCase()) || { stats: { open: 0 } }).stats.open;
    const check = !n && !pg.expenses.length ? '<p class="small muted">Nog geen uitgaven. Deel de link, zodat iedereen kan toevoegen wat hij betaalde.</p>' : !n ? (open === bal.net ? '<p class="small grp-ok">✓ Alles uit de groep staat in Helder.</p>' : `<p class="small muted">In Helder staat voor deze groep ${money(open)} open, in de groep ${money(bal.net)}. Het verschil komt van iets dat je zelf als voorschot voor “${esc(groupPerson(g))}” boekte.</p>`) : '';
    return `<div class="card person-card group-card">
      <div class="person-head"><span class="avatar" aria-hidden="true">👥</span>
        <div class="grow"><strong class="person-name">${esc(pg.name)}</strong><div class="small muted">${pg.members.length} personen · jij bent ${esc(gMember(pg, g.memberId))}</div></div>
        <div class="person-open"><div class="small muted">${status[0]}</div><strong class="${status[2]}">${status[1]}</strong></div></div>
      ${plan.length ? `<div class="small grp-plan">${plan.map(p => p.from === g.memberId ? `Betaal ${money(p.amount)} aan <strong>${esc(gMember(pg, p.to))}</strong>` : `<strong>${esc(gMember(pg, p.from))}</strong> betaalt jou ${money(p.amount)}`).join(' · ')}</div>` : ''}
      ${n ? `<div class="grp-todos"><div class="small muted">Nog te verwerken in Helder (${n})</div>${rows.join('')}</div>` : check}
      <div class="small muted">${pg.expenses.length} ${pg.expenses.length === 1 ? 'uitgave' : 'uitgaven'} · samen ${money(pg.expenses.reduce((s, e) => s + e.amount, 0))}</div>
      ${tools}</div>`;
  }

  // ---------- Vensters ----------

  function groupNewModal() {
    const m = modal;
    return modalShell('Nieuwe groep', `
      <p class="small muted">Iedereen in de groep krijgt een link en kan zonder account uitgaven toevoegen. Helder rekent uit wie wie hoeveel moet.</p>
      <label class="field"><span>Naam van de groep</span><input type="text" id="grp-name" maxlength="60" placeholder="bv. Weekend Ardennen, Kot, Skireis" value="${esc(m.name || '')}"></label>
      <label class="field"><span>Jouw naam in de groep</span><input type="text" id="grp-me" maxlength="40" value="${esc(m.me != null ? m.me : myName())}"></label>
      <label class="field"><span>Wie doet er nog mee? <span class="muted">(één naam per lijn; mag later ook, of ze voegen zichzelf toe)</span></span>
        <textarea id="grp-others" rows="4" placeholder="Kristin&#10;Jan&#10;Lien">${esc(m.others || '')}</textarea></label>
      <div class="errors" id="grp-errors"></div>
      <details class="small"><summary>Kreeg je zelf een groepslink van iemand?</summary>
        <div class="input-row" style="margin-top:8px"><input type="text" id="grp-join-link" placeholder="Plak hier de link (…/g#…)"><button class="btn" data-action="group-join">Toevoegen</button></div>
        <p class="small muted">Zo zie je ook die groep in Helder en kan je je betalingen koppelen.</p></details>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="group-create" ${m.busy ? 'disabled' : ''}>Groep maken</button>`);
  }

  async function groupCreate() {
    const name = $('#grp-name').value.trim();
    const me = $('#grp-me').value.trim();
    const others = $('#grp-others').value.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    const err = $('#grp-errors');
    if (!name) { err.textContent = 'Geef de groep een naam.'; return; }
    if (!me) { err.textContent = 'Vul je eigen naam in, zoals de anderen je kennen.'; return; }
    Object.assign(modal, { name, me, others: others.join('\n'), busy: true });
    renderModal();
    try {
      const r = await Sync.groups.create(name, me, others);
      const g = { id: r.group.id, token: r.token, name: r.group.name, person: '👥 ' + r.group.name, memberId: r.group.ownerMember, owner: true, createdAt: Date.now() };
      state.groups = groupList().concat([g]);
      groupUi.data[g.id] = r.group;
      groupUi.at[g.id] = Date.now();
      try { localStorage.setItem('helder-groep-' + g.id, g.memberId); } catch (e) { /* geen opslag */ }
      const then = modal.then;
      commit();
      if (then && then.txId) openModal({ type: 'groupAssign', txId: then.txId, groupId: g.id });
      else openModal({ type: 'groupShare', id: g.id, fresh: true });
    } catch (e) {
      modal.busy = false;
      renderModal();
      $('#grp-errors').textContent = e.message;
    }
  }

  async function groupJoin() {
    const raw = ($('#grp-join-link').value || '').trim();
    const token = (raw.split('#')[1] || raw).trim();
    const err = $('#grp-errors');
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) { err.textContent = 'Dit lijkt geen groepslink. Ze ziet eruit als https://…/g#…'; return; }
    if (groupList().some(g => g.token === token)) { err.textContent = 'Deze groep staat al in Helder.'; return; }
    try {
      const pg = await Sync.groups.load(token);
      openModal({ type: 'groupWho', token, pg });
    } catch (e) { err.textContent = e.message; }
  }

  function groupWhoModal() {
    const m = modal;
    return modalShell('Wie ben jij in “' + m.pg.name + '”?', `
      <p class="small muted">Kies je naam, zodat Helder weet welke uitgaven van jou zijn.</p>
      <div class="grp-who">${m.pg.members.map(x => `<button class="btn" data-action="group-who" data-member="${esc(x.id)}">${esc(x.name)}</button>`).join('')}</div>`,
      '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>');
  }

  function groupShareModal() {
    const g = groupById(modal.id);
    if (!g) return modalShell('Groep', '<p class="muted">Deze groep bestaat niet meer.</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
    const link = groupLink(g);
    return modalShell(modal.fresh ? '✓ Groep “' + g.name + '” gemaakt' : 'Link delen — ' + g.name, `
      <p>Stuur deze link naar de groep, bv. via WhatsApp of mail:</p>
      <div class="grp-link"><input type="text" readonly value="${esc(link)}" id="grp-link" aria-label="Groepslink"><button class="btn primary" data-action="group-copy" data-id="${esc(g.id)}">Kopieer</button></div>
      <ol class="small grp-steps">
        <li>Wie de link opent, kiest eerst <strong>wie hij is</strong> (of voegt zichzelf toe). Een account is niet nodig.</li>
        <li>Iedereen voegt toe wat hij betaalde en voor wie. Helder rekent uit wie wie hoeveel moet.</li>
        <li>Hier in <strong>Opvolgen</strong> zie je wat er nog in je boekhouding moet: je eigen betalingen koppelen en jouw deel van wat anderen betaalden boeken.</li>
      </ol>
      <p class="small muted">Wie de link heeft, kan de groep bekijken en aanpassen. Deel ze enkel met de groep. Ze geeft geen toegang tot de rest van je Helder.</p>`,
      `${navigator.share ? `<button class="btn" data-action="group-share-native" data-id="${esc(g.id)}">Delen…</button>` : ''}<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Openen ↗</a><span class="spacer"></span><button class="btn primary" data-action="close-modal">Klaar</button>`);
  }

  /** Een banktransactie in een groep zetten (uitgave) of als terugbetaling binnen de groep (in of uit). */
  function groupAssignModal() {
    const m = modal;
    const t = txById(m.txId);
    const groups = groupList().filter(g => g.memberId);
    if (!t) return modalShell('Groep', '<p class="muted">Deze transactie bestaat niet meer.</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
    const g = groupById(m.groupId) || groups[0];
    if (!g) return modalShell('In een groep zetten', '<p>Je hebt nog geen groep.</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="group-new" data-tx="' + esc(t.id) + '">+ Groep maken</button>');
    m.groupId = g.id;
    const pg = groupUi.data[g.id];
    const pickGroup = groups.length > 1 ? `<label class="field"><span>Groep</span><select id="ga-group">${groups.map(x => `<option value="${esc(x.id)}" ${x.id === g.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : '';
    const head = `<div class="wi-tx"><div><strong>${esc(t.title || t.counterparty || t.description || '—')}</strong><div class="small muted">${fmtDate(t.date)} · ${esc(accName(t.accountId))}</div></div><span class="amount ${t.amount > 0 ? 'pos' : ''}">${money(t.amount)}</span></div>`;
    if (!pg) { m.wait = g.id; loadGroup(g, true); return modalShell('In groep “' + g.name + '”', head + pickGroup + '<p class="muted">Groep laden…</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>'); }
    const todo = groupTodo(g, pg);
    const others = pg.members.filter(x => x.id !== g.memberId);
    const out = t.amount < 0;
    const mode = m.mode || (out ? 'expense' : 'payment');
    const seg = (k, label) => `<label><input type="radio" name="ga-mode" value="${k}" ${mode === k ? 'checked' : ''}><span>${label}</span></label>`;
    let body = '';
    if (mode === 'expense') {
      const cand = todo.ownUnlinked.slice().sort((a, b) => Math.abs(a.amount + t.amount) - Math.abs(b.amount + t.amount) || Math.abs(C.daysBetween(a.date, t.date)) - Math.abs(C.daysBetween(b.date, t.date)));
      const among = m.among || pg.members.map(x => x.id);
      body = `${cand.length ? `<div class="field"><span>Staat deze uitgave al in de groep?</span>
          <div class="search-list">${cand.slice(0, 6).map(e => `<label class="grp-opt"><input type="radio" name="ga-existing" value="${esc(e.id)}" ${m.existing === e.id ? 'checked' : ''}><span class="grow"><strong>${esc(e.title)}</strong> <span class="small muted">${fmtDate(e.date)} · ${esc(gWho(g, pg, e.paidBy))} betaalde</span></span><span class="amount">${money(e.amount)}</span></label>`).join('')}
          <label class="grp-opt"><input type="radio" name="ga-existing" value="" ${!m.existing ? 'checked' : ''}><span class="grow"><strong>Nee, nieuw toevoegen</strong></span></label></div></div>` : ''}
        <div id="ga-new" ${m.existing ? 'hidden' : ''}>
          <label class="field"><span>Waarvoor? <span class="muted">(zo zien de anderen het)</span></span><input type="text" id="ga-title" maxlength="80" value="${esc(m.title != null ? m.title : (t.title || t.counterparty || ''))}"></label>
          <div class="field"><span>Voor wie? <span class="muted">(gelijk verdeeld)</span></span>
            <div class="grp-for">${pg.members.map(x => `<label class="grp-opt"><input type="checkbox" name="ga-for" value="${esc(x.id)}" ${among.includes(x.id) ? 'checked' : ''}><span class="grow">${esc(x.name)}${x.id === g.memberId ? ' <span class="muted small">(jij)</span>' : ''}</span></label>`).join('')}</div>
            <p class="small muted">Iets anders verdelen (bv. vaste bedragen)? Pas het daarna aan op de groepspagina.</p></div>
        </div>
        <label class="field"><span>Jouw deel is een uitgave voor…</span><select id="ga-cat">${categoryOptions(m.cat !== undefined ? m.cat : ownCatOf(t) === C.SYS_ADVANCE ? '' : ownCatOf(t), { kind: 'expense', emptyLabel: '— Te verwerken —' })}</select></label>
        <div class="small grp-preview" id="ga-preview">${groupPreviewHtml(m, t, g, pg)}</div>`;
    } else {
      const sign = out ? -1 : 1;
      const cand = todo.payments.filter(p => (sign > 0 ? p.to === g.memberId : p.from === g.memberId)).sort((a, b) => Math.abs(a.amount - Math.abs(t.amount)) - Math.abs(b.amount - Math.abs(t.amount)));
      const plan = GRP.settle(pg).filter(p => sign > 0 ? p.to === g.memberId : p.from === g.memberId);
      const sugg = plan.find(p => p.amount === Math.abs(t.amount)) || plan[0];
      // Eerst op naam (de tegenpartij bij de bank), dan wie volgens de groep dit bedrag moet
      const text = ((t.counterparty || '') + ' ' + (t.description || '') + ' ' + (t.title || '')).toLowerCase();
      const byName = others.find(x => x.name.length > 1 && text.includes(x.name.toLowerCase()));
      const whoDef = m.who || (byName ? byName.id : sugg ? (sign > 0 ? sugg.from : sugg.to) : (others[0] || {}).id);
      body = `${cand.length ? `<div class="field"><span>Staat deze terugbetaling al in de groep?</span><div class="search-list">${cand.map(p => `<label class="grp-opt"><input type="radio" name="ga-existing" value="${esc(p.id)}" ${m.existing === p.id ? 'checked' : ''}><span class="grow">${sign > 0 ? esc(gMember(pg, p.from)) + ' → jij' : 'jij → ' + esc(gMember(pg, p.to))} <span class="small muted">${fmtDate(p.date)}</span></span><span class="amount">${money(p.amount)}</span></label>`).join('')}
          <label class="grp-opt"><input type="radio" name="ga-existing" value="" ${!m.existing ? 'checked' : ''}><span class="grow"><strong>Nee, nieuw toevoegen</strong></span></label></div></div>` : ''}
        <div id="ga-new" ${m.existing ? 'hidden' : ''}>
          <label class="field"><span>${sign > 0 ? 'Van wie kreeg je dit?' : 'Aan wie betaalde je terug?'}</span><select id="ga-who">${others.map(x => `<option value="${esc(x.id)}" ${x.id === whoDef ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <p class="small muted">Komt in de groep als terugbetaling van ${money(Math.abs(t.amount))}, zodat iedereen het ziet.</p>
        </div>`;
    }
    return modalShell('In groep “' + g.name + '”', `${head}${pickGroup}
      ${out ? `<div class="gp-seg grp-seg" role="radiogroup">${seg('expense', '🧾 Uitgave voor de groep')}${seg('payment', '💸 Ik betaalde iemand terug')}</div>` : '<p class="small muted">Iemand uit de groep betaalde je terug.</p>'}
      ${body}<div class="errors" id="ga-errors"></div>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="group-assign-save" ${m.busy ? 'disabled' : ''}>Bewaren</button>`, true);
  }

  /** Bewaart wat er in het groepsvenster gekozen is (eerst de groep, dan Helder). */
  function readGroupAssign() {
    const m = modal;
    const ex = document.querySelector('input[name=ga-existing]:checked');
    m.existing = ex ? ex.value : '';
    if ($('#ga-title')) m.title = $('#ga-title').value;
    if ($('#ga-cat')) m.cat = $('#ga-cat').value;
    if ($('#ga-who')) m.who = $('#ga-who').value;
    if (document.querySelector('input[name=ga-for]')) m.among = [...document.querySelectorAll('input[name=ga-for]:checked')].map(i => i.value);
  }

  /** Wat er in Helder komt: jouw deel en het voorschot voor de groep. */
  function groupPreviewHtml(m, t, g, pg) {
    const e = m.existing ? pg.expenses.find(x => x.id === m.existing) : { amount: -t.amount, split: { mode: 'equal', among: m.among || pg.members.map(x => x.id) } };
    if (!e || !GRP.shares(e)[g.memberId] && !(e.split.among || Object.keys(e.split.amounts || {})).length) return 'Duid aan voor wie het was.';
    const share = GRP.shares(e)[g.memberId] || 0;
    const othersPart = e.amount - share;
    const own = -t.amount - othersPart;
    const cat = m.cat !== undefined ? m.cat : ownCatOf(t) === C.SYS_ADVANCE ? '' : ownCatOf(t);
    return own < 0 ? `<span class="warn-text">De anderen hun deel (${money(othersPart)}) is groter dan deze betaling.</span>`
      : `In Helder: <strong>jouw deel ${money(own)}</strong>${own ? ' als ' + esc(cat ? catName(cat) : 'uitgave (nog te verwerken)') : ''} + <strong>${money(othersPart)}</strong> voorgeschoten voor de groep.`;
  }

  function updateGroupPreview() {
    const box = $('#ga-preview');
    const m = modal;
    const t = txById(m.txId);
    const g = groupById(m.groupId);
    const pg = g && groupUi.data[g.id];
    if (!box || !t || !pg) return;
    readGroupAssign();
    box.innerHTML = groupPreviewHtml(m, t, g, pg);
  }

  async function groupAssignSave() {
    readGroupAssign();
    const m = modal;
    const t = txById(m.txId);
    const g = groupById(m.groupId);
    const pg = g && groupUi.data[g.id];
    const err = $('#ga-errors');
    if (!t || !pg) return;
    const out = t.amount < 0;
    const mode = (document.querySelector('input[name=ga-mode]:checked') || {}).value || (out ? 'expense' : 'payment');
    m.busy = true;
    try {
      if (mode === 'expense') {
        let e = m.existing ? pg.expenses.find(x => x.id === m.existing) : null;
        if (!e) {
          const exp = { title: (m.title || '').trim(), amount: -t.amount, date: t.date, paidBy: g.memberId, split: { mode: 'equal', among: m.among || [] }, txId: t.id };
          try { GRP.normExpense(exp, pg); } catch (x) { err.textContent = x.message; m.busy = false; return; }
          const id = await groupOp(g, 'expense.save', { expense: exp });
          e = groupUi.data[g.id].expenses.find(x => x.id === id);
        } else if (!e.txId) {
          await groupOp(g, 'expense.save', { expense: Object.assign({}, e, { txId: t.id }) });
        }
        const msg = applyGroupSplit(t, g, e, m.cat || null);
        if (msg) { err.textContent = msg; m.busy = false; return; }
        closeModal();
        commit('In groep “' + g.name + '” gezet');
      } else {
        let p = m.existing ? pg.payments.find(x => x.id === m.existing) : null;
        if (!p) {
          const pay = out ? { from: g.memberId, to: m.who, amount: -t.amount, date: t.date } : { from: m.who, to: g.memberId, amount: t.amount, date: t.date };
          try { GRP.normPayment(pay, pg); } catch (x) { err.textContent = x.message; m.busy = false; return; }
          const id = await groupOp(g, 'payment.save', { payment: pay });
          p = groupUi.data[g.id].payments.find(x => x.id === id);
        }
        const msg = applyGroupPayment(t, g, p);
        if (msg) { err.textContent = msg; m.busy = false; return; }
        closeModal();
        commit('Terugbetaling in groep “' + g.name + '” bewaard');
      }
    } catch (e) { err.textContent = e.message; m.busy = false; }
  }

  /** Jouw deel van wat anderen betaalden: als verrekend voorschot boeken, in een categorie per uitgave. */
  function groupBookModal() {
    const g = groupById(modal.id);
    const pg = g && groupUi.data[g.id];
    if (!pg) return modalShell('Boeken', '<p class="muted">Laden…</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
    const items = groupTodo(g, pg).others.sort((a, b) => a.e.date.localeCompare(b.e.date));
    const total = items.reduce((s, x) => s + x.share, 0);
    return modalShell('Jouw deel boeken — ' + pg.name, `
      <p class="small muted">Anderen betaalden dit, jij deelt erin. Dat is <strong>jouw uitgave</strong>, ook al ging er geen geld van je rekening. Kies per uitgave waarvoor het was; het wordt verrekend met wat je voor de groep voorschoot.</p>
      <label class="field"><span>Alles in dezelfde categorie</span><select id="gb-all">${categoryOptions(g.lastCat || '', { kind: 'expense', emptyLabel: '— per uitgave kiezen —' })}</select></label>
      <div class="grp-book">${items.map(x => `<div class="grp-book-row"><span class="grow"><strong>${esc(x.e.title)}</strong><span class="small muted">${fmtDate(x.e.date)} · ${esc(gMember(pg, x.e.paidBy))} betaalde ${money(x.e.amount)}</span></span>
          <span class="amount">${money(x.share)}</span>
          <select data-gb="${esc(x.e.id)}" aria-label="Categorie voor ${esc(x.e.title)}">${categoryOptions(g.lastCat || '', { kind: 'expense', emptyLabel: '— Kies —' })}</select></div>`).join('')}</div>
      <p class="small">Samen: <strong>${money(total)}</strong></p>
      <div class="errors" id="gb-errors"></div>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="group-book-save" data-id="${esc(g.id)}">In Helder boeken</button>`, true);
  }

  function groupBookSave(el) {
    const g = groupById(el.dataset.id);
    const pg = g && groupUi.data[g.id];
    if (!pg) return;
    const items = groupTodo(g, pg).others;
    const pick = new Map([...document.querySelectorAll('[data-gb]')].map(s => [s.dataset.gb, s.value]));
    const missing = items.filter(x => !pick.get(x.e.id));
    if (missing.length) { $('#gb-errors').textContent = 'Kies een categorie voor: ' + missing.map(x => x.e.title).join(', '); return; }
    const p = ensurePerson(groupPerson(g));
    p.forgiven = (p.forgiven || []).concat(items.map(x => ({ id: C.uid('fg'), date: x.e.date, amount: x.share, categoryId: pick.get(x.e.id), reason: 'settled',
      note: x.e.title + ' (betaald door ' + gMember(pg, x.e.paidBy) + ')', groupId: g.id, groupExpenseId: x.e.id })));
    g.lastCat = pick.get(items[items.length - 1].e.id);
    closeModal();
    commit(items.length + (items.length === 1 ? ' uitgave' : ' uitgaven') + ' geboekt: ' + money(items.reduce((s, x) => s + x.share, 0)));
  }

  /** Bij een uitgave of terugbetaling uit de groep de juiste banktransactie zoeken. */
  function groupTxPickModal() {
    const m = modal;
    const g = groupById(m.id);
    const pg = g && groupUi.data[g.id];
    if (!pg) return modalShell('Koppelen', '<p class="muted">Laden…</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
    const e = m.expense ? pg.expenses.find(x => x.id === m.expense) : null;
    const p = m.payment ? pg.payments.find(x => x.id === m.payment) : null;
    const it = e || p;
    if (!it) return modalShell('Koppelen', '<p class="muted">Dit staat niet meer in de groep.</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
    const sign = e ? -1 : p.to === g.memberId ? 1 : -1;
    const q = (m.search || '').trim().toLowerCase();
    const list = state.transactions.filter(t => Math.sign(t.amount) === sign && !t.isTransfer && !t.groupRef)
      .filter(t => !q || `${t.title || ''} ${t.counterparty} ${t.description} ${C.centsToInput(t.amount)}`.toLowerCase().includes(q))
      .map(t => ({ t, score: (Math.abs(t.amount) === it.amount ? 0 : 1e6 + Math.abs(Math.abs(t.amount) - it.amount)) + Math.abs(C.daysBetween(t.date, it.date)) * 100 }))
      .sort((a, b) => a.score - b.score).slice(0, 60);
    const what = e ? `Jij betaalde <strong>${esc(e.title)}</strong>` : p.to === g.memberId ? `<strong>${esc(gMember(pg, p.from))}</strong> betaalde jou terug` : `Jij betaalde <strong>${esc(gMember(pg, p.to))}</strong> terug`;
    return modalShell('Welke betaling was dat?', `
      <div class="wi-tx"><div>${what}<div class="small muted">${fmtDate(it.date)} · groep ${esc(pg.name)}</div></div><span class="amount">${money(sign * it.amount)}</span></div>
      <input type="search" id="gt-search" placeholder="Zoek op naam, omschrijving of bedrag…" value="${esc(m.search || '')}" autocomplete="off" style="margin-top:10px">
      <div class="search-list" style="margin-top:8px">${list.map(({ t }) => `<button class="search-hit" data-action="group-tx-pick" data-tx="${esc(t.id)}">
          <span class="grow"><strong>${Math.abs(t.amount) === it.amount ? '💡 ' : ''}${esc(t.title || t.counterparty || t.description || '—')}</strong><span class="small muted">${fmtDate(t.date)} · ${esc(accName(t.accountId))}${t.categoryId ? ' · ' + esc(catLabel(t.categoryId)) : ''}</span></span>
          <span class="amount">${money(t.amount)}</span></button>`).join('') || '<p class="muted">Geen betaling gevonden.</p>'}</div>
      <p class="small muted">💡 = zelfde bedrag. Niet via de bank betaald? Kies dan <strong>💶 Cash</strong>.</p>`,
      `<button class="btn" data-action="group-cash" data-id="${esc(g.id)}" ${e ? `data-expense="${esc(e.id)}"` : `data-payment="${esc(p.id)}"`}>💶 Cash</button><span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>`, true);
  }

  function groupLinkTx(g, m, t) {
    const pg = groupUi.data[g.id];
    const e = m.expense ? pg.expenses.find(x => x.id === m.expense) : null;
    const p = m.payment ? pg.payments.find(x => x.id === m.payment) : null;
    const msg = e ? applyGroupSplit(t, g, e, ownCatOf(t) === C.SYS_ADVANCE ? null : ownCatOf(t)) : p ? applyGroupPayment(t, g, p) : 'Niet gevonden';
    if (msg) { toast(msg); return false; }
    if (e && !e.txId) groupOp(g, 'expense.save', { expense: Object.assign({}, e, { txId: t.id }) }).catch(() => { /* enkel ter info */ });
    return true;
  }

  /** Cash betaald: een manuele transactie op de cash-rekening, meteen gekoppeld. */
  function groupCash(el) {
    const g = groupById(el.dataset.id);
    const pg = g && groupUi.data[g.id];
    if (!pg) return;
    const e = el.dataset.expense ? pg.expenses.find(x => x.id === el.dataset.expense) : null;
    const p = el.dataset.payment ? pg.payments.find(x => x.id === el.dataset.payment) : null;
    const it = e || p;
    if (!it) return;
    const cash = state.accounts.find(a => a.type === 'cash') || state.accounts[0];
    if (!cash) { toast('Maak eerst een rekening (bv. Cash) bij Instellingen.'); return; }
    const sign = e ? -1 : p.to === g.memberId ? 1 : -1;
    const t = Object.assign(newTx(cash.id), { date: it.date, amount: sign * it.amount, counterparty: e ? '' : gMember(pg, sign > 0 ? p.from : p.to), description: 'Cash · groep ' + pg.name, title: e ? e.title : 'Terugbetaling groep ' + pg.name });
    t.createdAt = Date.now();
    const msg = e ? applyGroupSplit(t, g, e, null) : applyGroupPayment(t, g, p);
    if (msg) { toast(msg); return; }
    state.transactions.push(t);
    if (modal) closeModal();
    commit(e ? 'Cash-uitgave toegevoegd' + (t.categoryId || (t.splits[0] || {}).categoryId ? '' : ' — kies nog de categorie van jouw deel') : 'Cash-terugbetaling toegevoegd');
  }

  async function groupRemove(el) {
    const g = groupById(el.dataset.id);
    if (!g) return;
    const gone = groupUi.error[g.id] === 'gone';
    if (!confirm(`Groep “${g.name}” verwijderen?\n\n${g.owner && !gone ? 'De groep en de link verdwijnen voor iedereen. ' : ''}Wat je al in Helder boekte, blijft staan; wat nog open staat, zie je daarna bij Voorschotten onder “${groupPerson(g)}”.`)) return;
    if (g.owner && !gone) {
      try { await Sync.groups.remove(g.token); } catch (e) { if (e.status !== 404 && e.status !== 403) { toast(e.message); return; } }
    }
    state.groups = groupList().filter(x => x.id !== g.id);
    delete groupUi.data[g.id];
    commit('Groep verwijderd');
  }

  async function groupShareNative(el) {
    const g = groupById(el.dataset.id);
    if (!g) return;
    try { await navigator.share({ title: g.name, text: 'Voeg je uitgaven toe aan "' + g.name + '"', url: groupLink(g) }); } catch (e) { /* geannuleerd */ }
  }

  /** Groepen opnieuw ophalen (bij het openen van Opvolgen of terugkeren naar de app). */
  function refreshGroups() { if (groupsOn()) groupList().forEach(g => loadGroup(g, true)); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ui.view === 'advances') refreshGroups(); });

  /** Je saldo over alle groepen (enkel wat geladen is). */
  function groupsNet() {
    return groupList().reduce((s, g) => { const pg = groupUi.data[g.id]; return s + (pg && g.memberId ? ((GRP.balances(pg)[g.memberId] || {}).net || 0) : 0); }, 0);
  }

  const groupActions = {
    'group-new': el => openModal({ type: 'groupNew', then: el && el.dataset.tx ? { txId: el.dataset.tx } : null }),
    'group-create': groupCreate,
    'group-join': groupJoin,
    'group-who': el => {
      const m = modal;
      const g = { id: m.pg.id, token: m.token, name: m.pg.name, person: '👥 ' + m.pg.name, memberId: el.dataset.member, createdAt: Date.now() };
      state.groups = groupList().concat([g]);
      groupUi.data[g.id] = m.pg;
      closeModal();
      commit('Groep “' + g.name + '” toegevoegd');
    },
    'group-share': el => openModal({ type: 'groupShare', id: el.dataset.id }),
    'group-share-native': groupShareNative,
    'group-copy': el => {
      const g = groupById(el.dataset.id);
      if (!g) return;
      const inp = $('#grp-link');
      Promise.resolve().then(() => navigator.clipboard.writeText(groupLink(g))).then(() => toast('Link gekopieerd'))
        .catch(() => { if (inp) { inp.select(); } toast('Selecteer en kopieer de link zelf.'); });
    },
    'group-remove': groupRemove,
    'group-book': el => openModal({ type: 'groupBook', id: el.dataset.id }),
    'group-book-save': groupBookSave,
    'group-fix': el => { const g = groupById(el.dataset.id); if (g) groupFixAll(g); },
    'group-pick-tx': el => openModal({ type: 'groupTxPick', id: el.dataset.id, expense: el.dataset.expense || '', payment: el.dataset.payment || '', search: '' }),
    'group-tx-pick': el => {
      const m = modal;
      const g = groupById(m.id);
      const t = txById(el.dataset.tx);
      if (!g || !t) return;
      if (groupLinkTx(g, m, t)) { closeModal(); commit('Gekoppeld aan “' + (t.title || t.counterparty || 'transactie') + '”'); }
    },
    'group-cash': groupCash,
    'group-assign': el => { const t = txById(el.dataset.id); if (t) openModal({ type: 'groupAssign', txId: t.id, groupId: el.dataset.group || (groupList()[0] || {}).id }); },
    'group-assign-save': groupAssignSave,
    'group-unlink': el => {
      const t = txById(el.dataset.id);
      if (!t || !t.groupRef) return;
      if (!confirm('Deze betaling loskoppelen van de groep? In de groep zelf verandert niets.')) return;
      const own = ownCatOf(t);
      t.splits = []; delete t.person; delete t.groupRef;
      t.categoryId = own === C.SYS_ADVANCE ? null : own; t.categorySource = 'manual';
      closeModal();
      commit('Losgekoppeld van de groep');
    }
  };

  /** Invoer in de groepsvensters. Geeft true als het hier afgehandeld werd. */
  function groupInput(el) {
    if (!modal) return false;
    if (modal.type === 'groupTxPick' && el.id === 'gt-search') {
      clearTimeout(groupInput.timer);
      groupInput.timer = setTimeout(() => { modal.search = el.value; const pos = el.selectionStart; renderModal(); const s = $('#gt-search'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } }, 150);
      return true;
    }
    if (modal.type === 'groupAssign') { updateGroupPreview(); return true; }
    return false;
  }

  function groupChange(el) {
    if (!modal) return false;
    if (modal.type === 'groupAssign') {
      if (el.id === 'ga-group') { readGroupAssign(); Object.assign(modal, { groupId: el.value, existing: '', among: null, who: null }); renderModal(); return true; }
      if (el.name === 'ga-mode') { readGroupAssign(); Object.assign(modal, { mode: el.value, existing: '' }); renderModal(); return true; }
      if (el.name === 'ga-existing') { const box = $('#ga-new'); if (box) box.hidden = !!el.value; }
      updateGroupPreview();
      return true;
    }
    if (modal.type === 'groupBook' && el.id === 'gb-all') { if (el.value) document.querySelectorAll('[data-gb]').forEach(s => { s.value = el.value; }); return true; }
    return false;
  }
