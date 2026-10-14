  // ----- Voorschotten en personen -----

  function personEntity(name) {
    const k = String(name || '').trim().toLowerCase();
    return (state.people || []).find(p => p.name.trim().toLowerCase() === k) || null;
  }

  /** Zorgt dat de persoon bestaat; onthoudt een IBAN om volgende terugbetalingen te herkennen. */
  function ensurePerson(name, iban) {
    name = String(name || '').trim();
    if (!name || name === 'Onbekend') return null;
    state.people = state.people || [];
    let p = personEntity(name);
    if (!p) { p = { id: C.uid('per'), name, ibans: [] }; state.people.push(p); }
    const ib = C.normalizeIban(iban || '');
    if (ib && !(p.ibans || []).includes(ib)) p.ibans = (p.ibans || []).concat(ib);
    return p;
  }

  function markAdvance(t, name) {
    t.categoryId = C.SYS_ADVANCE; t.categorySource = 'manual'; t.ruleId = null; t.person = name;
    if (t.isTransfer) t.transferMode = 'no';
    ensurePerson(name, t.amount > 0 ? t.counterpartyIban : '');
  }

  /** Sleutel van één voorschot: de transactie, of "transactie:splitsing" bij een gesplitste betaling. */
  const advKey = it => it.txId + (it.split != null ? ':' + it.split : '');
  function advItem(key) {
    const ov = C.advancesOverview(state);
    return ov.items.find(it => advKey(it) === key) || null;
  }

  /**
   * "Terug te krijgen": voorschotten (je betaalde voor iemand anders, telt niet als jouw uitgave) en
   * acties (jouw eigen uitgaven gebundeld, telt wel als uitgave) op één plek. Een actie met een persoon
   * staat mee op de kaart van die persoon, zodat je per persoon ziet wat er in totaal nog open staat.
   */
  function renderAdvances() {
    const f = ['adv', 'act'].includes(ui.owed) ? ui.owed : 'all';
    const showAdv = f !== 'act', showAct = f !== 'adv';
    const lc = s => String(s || '').trim().toLowerCase();
    const actions = (state.actions || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const sumOf = new Map(actions.map(a => [a.id, C.actionSummary(state, a)]));
    const actOpen = a => a.expectBack && !a.closed ? Math.max(0, sumOf.get(a.id).open) : 0;
    const people = C.personList(state);
    // Personen die enkel in een actie voorkomen, krijgen ook een kaart
    for (const a of actions) if (a.person && !a.closed && !people.some(p => lc(p.name) === lc(a.person)))
      people.push({ name: a.person.trim(), entity: null, stats: { person: a.person.trim(), advanced: 0, repaid: 0, forgiven: 0, open: 0, items: [], ledger: [] } });
    const actsOf = p => f === 'all' ? actions.filter(a => !a.closed && lc(a.person) === lc(p.name)) : [];
    const totalOf = p => (showAdv ? Math.max(0, p.stats.open) : 0) + actsOf(p).reduce((t, a) => t + actOpen(a), 0);
    const isOpen = p => (showAdv && p.stats.open > 0) || actsOf(p).length > 0;
    const shown = f === 'act' ? [] : people.filter(p => f === 'all' || p.stats.items.length || p.entity || p.stats.open);
    const openPeople = shown.filter(isOpen).sort((a, b) => totalOf(b) - totalOf(a) || a.name.localeCompare(b.name));
    const done = shown.filter(p => !isOpen(p)).sort((a, b) => a.name.localeCompare(b.name));
    const looseActs = !showAct ? [] : actions.filter(a => !a.closed && (f === 'act' || !a.person || !shown.some(p => lc(p.name) === lc(a.person))));
    const closedActs = showAct ? actions.filter(a => a.closed) : [];

    const advTotal = people.reduce((t, p) => t + Math.max(0, p.stats.open), 0);
    const actTotal = actions.reduce((t, a) => t + actOpen(a), 0);
    const itemTitle = it => it.title ? esc(it.title) : `<span class="adv-untitled">${esc(it.counterparty || it.note || 'Voorschot')}</span>`;
    const settledHow = it => it.forgiven >= it.amount ? '🎁 kwijtgescholden' : it.forgiven > 0 ? `✓ terug · ${money(it.forgiven)} kwijtgescholden` : '✓ terugbetaald';
    const plural = (n, one, more) => n + ' ' + (n === 1 ? one : more);
    const history = (p) => {
      const st = p.stats;
      const ent = p.entity || {};
      const closed = st.items.filter(it => it.amount - it.repaid <= 0).slice().reverse();
      const reps = state.transactions.filter(t => C.splitLines(t).some(l => l.categoryId === C.SYS_ADVANCE && l.amount > 0 && String(l.person || t.person || '').toLowerCase() === p.name.toLowerCase()))
        .sort((a, b) => b.date.localeCompare(a.date));
      const forgiven = (ent.forgiven || []).slice().sort((a, b) => b.date.localeCompare(a.date));
      if (!closed.length && !reps.length && !forgiven.length) return '';
      return `<details class="adv-history"><summary class="small">Afgehandeld en terugbetalingen <span class="muted">(${closed.length + reps.length + forgiven.length})</span></summary>
        ${closed.length ? `<div class="adv-hist-block"><div class="small muted">Afgehandelde voorschotten</div>${closed.map(it => `<div class="adv-hist-row"><span class="grow"><button class="linklike" data-action="adv-title" data-key="${esc(advKey(it))}">${itemTitle(it)}</button> <span class="small muted">${fmtDate(it.date)}</span></span><span class="amount">${money(it.amount)}</span><span class="small">${settledHow(it)}</span></div>`).join('')}</div>` : ''}
        ${reps.length ? `<div class="adv-hist-block"><div class="small muted">Terugbetalingen</div>${reps.map(t => `<div class="adv-hist-row"><span class="grow"><a href="#" data-action="edit-tx" data-id="${esc(t.id)}">${esc(t.title || (t.source === 'manual' && /cash/i.test(t.description || '') ? 'In cash' : t.counterparty || 'Terugbetaling'))}</a> <span class="small muted">${fmtDate(t.date)}</span></span><span class="amount pos">${money(C.splitLines(t).filter(l => l.categoryId === C.SYS_ADVANCE).reduce((a, l) => a + l.amount, 0))}</span><span></span></div>`).join('')}</div>` : ''}
        ${forgiven.length ? `<div class="adv-hist-block"><div class="small muted">Kwijtgescholden</div>${forgiven.map(fg => `<div class="adv-hist-row"><span class="grow">🎁 ${esc(fg.note || 'Kwijtgescholden')} <span class="small muted">${fmtDate(fg.date)} → ${esc(catName(fg.categoryId))}</span></span><span class="amount">${money(fg.amount)}</span><button class="btn small ghost" data-action="forgive-undo" data-person="${esc(p.name)}" data-id="${esc(fg.id)}" title="Ongedaan maken">✕</button></div>`).join('')}</div>` : ''}
      </details>`;
    };
    const advLine = (p, it) => {
      const left = it.amount - it.repaid;
      const key = esc(advKey(it));
      return `<div class="adv-item kind-adv">
        <div class="adv-item-top">
          <button class="adv-title" data-action="adv-title" data-key="${key}" title="Titel geven of wijzigen">${itemTitle(it)}${it.title ? '' : ' <span class="adv-addtitle">✎ titel</span>'}</button>
          <strong class="adv-amt">${money(left)}</strong>
        </div>
        <div class="small muted adv-sub"><span class="kind-tag adv">🤝 voorschot</span> ${fmtDate(it.date)}${it.repaid > 0 ? ` · al ${money(it.repaid)} terug van ${money(it.amount)}` : ''} · <a href="#" data-action="edit-tx" data-id="${esc(it.txId)}">details</a></div>
        <div class="adv-paid"><span class="small muted">Betaald?</span>
          <button class="btn small" data-action="adv-item-tx" data-key="${key}" data-person="${esc(p.name)}" title="Kies de terugbetaling bij je transacties">🔗 Transactie</button>
          <button class="btn small" data-action="adv-item-cash" data-key="${key}" data-person="${esc(p.name)}">💶 Cash</button>
          <button class="btn small" data-action="adv-item-forgive" data-key="${key}" data-person="${esc(p.name)}" title="Je vraagt het niet meer terug: het telt dan als uitgave">🎁 Kwijtschelden</button>
        </div>
      </div>`;
    };
    const actLine = a => {
      const s = sumOf.get(a.id);
      const open = actOpen(a);
      return `<div class="adv-item kind-act">
        <div class="adv-item-top">
          <button class="adv-title" data-action="action-view" data-id="${esc(a.id)}" title="Alle transacties van deze actie">${esc(a.name)}</button>
          <strong class="adv-amt">${a.expectBack ? (open > 0 ? money(open) : '✓') : ''}</strong>
        </div>
        <div class="small muted adv-sub"><span class="kind-tag act">🏷 actie</span> eigen uitgave ${money(s.out)}${s.back ? ` · al ${money(s.back)} terug` : ''} · ${plural(s.txs.length, 'transactie', 'transacties')}</div>
        <div class="adv-paid">
          <button class="btn small" data-action="action-add-tx" data-id="${esc(a.id)}" title="Uitgaven of terugbetalingen toevoegen">+ Transacties</button>
          <button class="btn small" data-action="action-close" data-id="${esc(a.id)}" data-closed="1">✓ Afronden</button>
          <button class="btn small ghost" data-action="action-edit" data-id="${esc(a.id)}">✎</button>
        </div>
      </div>`;
    };
    const personTools = p => `<div class="card-tools">
        <button class="btn small" data-action="adv-pick" data-person="${esc(p.name)}" data-dir="out">+ Voorschot</button>
        ${p.stats.items.length ? `<button class="btn small" data-action="adv-ledger" data-person="${esc(p.name)}" title="Alle voorschotten en terugbetalingen, en wat welke terugbetaling vereffent">📒 Rekening-courant</button>` : ''}
        ${p.entity ? `<button class="btn small ghost" data-action="person-edit" data-person="${esc(p.name)}">✎ Bewerk</button>` : ''}</div>`;
    const openCard = p => {
      const st = p.stats;
      const sugg = showAdv && st.open > 0 ? C.suggestRepayments(state, p.name, (p.entity || {}).ibans, today, 3) : [];
      const items = showAdv ? st.items.filter(it => it.amount - it.repaid > 0).slice().sort((a, b) => b.date.localeCompare(a.date)) : [];
      const acts = actsOf(p);
      const count = [items.length ? plural(items.length, 'voorschot', 'voorschotten') : '', acts.length ? plural(acts.length, 'actie', 'acties') : ''].filter(Boolean).join(' · ');
      return `<div class="card person-card">
        <div class="person-head"><span class="avatar" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
          <div class="grow"><strong class="person-name">${esc(p.name)}</strong><div class="small muted">${count}</div></div>
          <div class="person-open"><div class="small muted">nog terug te krijgen</div><strong>${money(totalOf(p))}</strong></div></div>
        ${sugg.length ? `<div class="suggest">${sugg.map(x => `<div class="suggest-row">💡 <span class="grow">Terugbetaling? <strong>${money(x.tx.amount)}</strong> van ${esc(x.tx.title || x.tx.counterparty || '?')} op ${fmtDate(x.tx.date)} <span class="muted small">(${esc(x.why)})</span></span>
          <button class="btn small primary" data-action="adv-accept" data-id="${esc(x.tx.id)}" data-person="${esc(p.name)}">Ja, koppel</button></div>`).join('')}</div>` : ''}
        <div class="adv-items">${items.map(it => advLine(p, it)).join('')}${acts.map(actLine).join('')}</div>
        ${showAdv ? history(p) : ''}
        ${personTools(p)}
      </div>`;
    };
    const doneCard = p => {
      const st = p.stats;
      const status = st.open < 0 ? `<span class="badge">${money(-st.open)} te veel terug</span>` : st.items.length ? '<span class="badge ok">✓ alles in orde</span>' : '<span class="badge">nog niets open</span>';
      return `<div class="card person-card done">
        <div class="person-head"><span class="avatar" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
          <div class="grow"><strong class="person-name">${esc(p.name)}</strong></div>${status}</div>
        ${st.open < 0 ? `<div class="notice small">${esc(p.name)} betaalde ${money(-st.open)} te veel terug. <button class="btn small" data-action="surplus-new" data-person="${esc(p.name)}">Rest inboeken als inkomst…</button></div>` : ''}
        ${history(p)}
        ${personTools(p)}
      </div>`;
    };
    const seg = (k, label) => `<button class="${f === k ? 'active' : ''}" data-action="owed-filter" data-f="${k}">${label}</button>`;
    const total = (showAdv ? advTotal : 0) + (showAct ? actTotal : 0);
    const nothing = !openPeople.length && !looseActs.length;
    return `
      <div class="page-head"><h1>Terug te krijgen</h1><span class="spacer"></span>
        <button class="btn primary" data-action="owed-new">+ Toevoegen</button></div>
      <details class="owed-help" data-keep="owedHelp" ${(ui.keepOpen.owedHelp != null ? ui.keepOpen.owedHelp : !people.length && !actions.length) ? 'open' : ''}>
        <summary><span class="kind-tag adv">🤝 voorschot</span> of <span class="kind-tag act">🏷 actie</span>? <span class="small muted">Wat is het verschil</span></summary>
        <div class="owed-kinds">
          <div class="owed-kind adv"><strong>🤝 Voorschot</strong><span>Je betaalde voor iemand anders. Het is <b>niet jouw uitgave</b> en telt nergens mee.</span></div>
          <div class="owed-kind act"><strong>🏷 Actie</strong><span>Je eigen uitgaven, gebundeld (bv. <em>kleren voor mama</em>). Ze <b>tellen wel als uitgave</b>; wat terugkomt, maakt ze kleiner.</span></div>
        </div>
      </details>
      <div class="adv-summary card">
        <div><div class="label">Nog terug te krijgen</div><div class="value">${money(total)}</div></div>
        <div class="small muted">${f === 'all' && advTotal && actTotal ? `${money(advTotal)} aan voorschotten · ${money(actTotal)} via acties` : f === 'act' ? 'via acties' : f === 'adv' ? 'aan voorschotten' : ''}</div>
        <div class="seg owed-seg">${seg('all', 'Alles')}${seg('adv', '🤝 Voorschotten')}${seg('act', '🏷 Acties')}</div>
      </div>
      ${openPeople.length ? `<h2 class="section-title">Per persoon</h2><div class="grid cards people">${openPeople.map(openCard).join('')}</div>` : ''}
      ${looseActs.length ? `<h2 class="section-title">${f === 'act' ? 'Open acties' : 'Acties zonder persoon'}</h2><div class="grid cards actions-grid">${looseActs.map(a => actionCard(a)).join('')}</div>` : ''}
      ${nothing ? `<div class="card empty-state"><p>${people.length || actions.length ? '🎉 Niets meer open.' : 'Nog niets. Klik op <strong>+ Toevoegen</strong>, of typ bij een transactie in <em>Gekoppeld aan</em> een naam, bv. <code>pieter</code>, en kies <strong>🤝 Voorgeschoten voor Pieter</strong>.'}</p></div>` : ''}
      ${done.length || closedActs.length ? `<details class="card owed-done" ${ui.keepOpen.owedDone ? 'open' : ''} data-keep="owedDone"><summary><strong>Afgehandeld</strong> <span class="small muted">(${[done.length ? plural(done.length, 'persoon', 'personen') : '', closedActs.length ? plural(closedActs.length, 'afgeronde actie', 'afgeronde acties') : ''].filter(Boolean).join(' · ')})</span></summary>
        ${done.length ? `<div class="grid cards people" style="margin-top:12px">${done.map(doneCard).join('')}</div>` : ''}
        ${closedActs.length ? `<div class="grid cards actions-grid" style="margin-top:12px">${closedActs.map(a => actionCard(a)).join('')}</div>` : ''}
      </details>` : ''}`;
  }

  /** Eén knop "+ Toevoegen": eerst kiezen wat het is, met het verschil erbij. */
  function owedNewModal() {
    return modalShell('Wat wil je toevoegen?', `
      <div class="owed-choice">
        <button class="owed-opt adv" data-action="adv-pick" data-dir="out"><strong>🤝 Voorschot</strong>
          <span>Ik betaalde (een deel) <b>voor iemand anders</b>, bv. de hele restaurantrekening. Dat deel is niet mijn uitgave.</span></button>
        <button class="owed-opt act" data-action="action-new"><strong>🏷 Actie</strong>
          <span>Een <b>eigen uitgave</b> (of meerdere) die ik wil bundelen en eventueel (deels) terugkrijg, bv. <em>kleren — mama betaalt terug</em>.</span></button>
      </div>
      <p class="small muted">Twijfel? Moet de uitgave meetellen in je eigen uitgaven? Kies dan <strong>actie</strong>. Anders <strong>voorschot</strong>.</p>`,
      `<button class="btn ghost" data-action="person-new">+ Enkel een persoon</button><span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>`);
  }

  /**
   * Alle transacties in één categorie (klik op een categorie, eender waar). Standaard de gekozen periode,
   * met een knop voor alles. Telt zoals de rest van Helder: terugbetalingen en kwijtscheldingen inbegrepen.
   */
  function catTxModal() {
    const m = modal;
    const none = m.cat === '__none__';
    const range = m.all ? null : currentRange();
    const lines = C.allocations(state).filter(l => (none ? !l.categoryId : l.categoryId === m.cat) && (!range || C.inRange(l.date, range)));
    const groups = new Map();
    for (const l of lines) {
      const k = l.txId || ('fg:' + l.forgiveId);
      const g = groups.get(k) || { key: k, txId: l.txId, date: l.date, amount: 0, refund: l.refund, forgiven: l.forgiven, person: l.person };
      g.amount += l.amount;
      groups.set(k, g);
    }
    const rows = Array.from(groups.values()).sort((a, b) => b.date.localeCompare(a.date));
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const c = none ? null : cat(m.cat);
    const label = none ? 'Nog niet gekoppeld' : catLabel(m.cat);
    const row = r => {
      const t = r.txId ? txById(r.txId) : null;
      const what = r.forgiven ? `🎁 Kwijtgescholden aan ${esc(r.person || '')}` : t ? esc(t.title || t.counterparty || t.description || '—') : '—';
      const sub = r.forgiven ? 'voorschot dat een uitgave werd' : t ? esc([r.refund ? '↩ terugbetaling' : '', t.title ? t.counterparty : '', accName(t.accountId)].filter(Boolean).join(' · ')) : '';
      return `<tr ${t ? `class="clickable" data-action="edit-tx" data-id="${esc(t.id)}"` : ''}>
        <td class="nowrap">${fmtDate(r.date)}</td><td>${what}<div class="desc">${sub}</div></td>
        <td class="amount ${amountClass(r.amount)}">${money(r.amount)}</td></tr>`;
    };
    return modalShell(label, `
      <div class="cat-modal-head">
        <div><div class="small muted">${m.all ? 'Altijd' : rangeLabel()}${c && c.kind === 'income' ? ' · inkomsten' : ''}</div><div class="cat-total">${money(Math.abs(total))}</div><div class="small muted">${rows.length} transactie${rows.length === 1 ? '' : 's'}</div></div>
        <div class="seg"><button class="${m.all ? '' : 'active'}" data-action="cat-range" data-all="0">Gekozen periode</button><button class="${m.all ? 'active' : ''}" data-action="cat-range" data-all="1">Altijd</button></div>
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="tx-table"><tbody>${rows.slice(0, 500).map(row).join('')}</tbody></table></div>${rows.length > 500 ? `<p class="small muted">De eerste 500 van ${rows.length}.</p>` : ''}`
        : '<p class="muted">Geen transacties in deze periode.</p>'}`,
      `${c && !c.id.startsWith('sys_') ? `<button class="btn" data-action="edit-category" data-id="${esc(c.id)}">Categorie bewerken</button>` : ''}<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>`, true);
  }

