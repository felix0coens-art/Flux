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

  function renderAdvances() {
    const people = C.personList(state).sort((a, b) => b.stats.open - a.stats.open || a.name.localeCompare(b.name));
    const openPeople = people.filter(p => p.stats.open > 0);
    const done = people.filter(p => p.stats.open <= 0);
    const totalOpen = openPeople.reduce((a, p) => a + p.stats.open, 0);
    const openItemCount = openPeople.reduce((a, p) => a + p.stats.items.filter(it => it.amount - it.repaid > 0).length, 0);
    const itemTitle = it => it.title ? esc(it.title) : `<span class="adv-untitled">${esc(it.counterparty || it.note || 'Voorschot')}</span>`;
    const settledHow = it => it.forgiven >= it.amount ? '🎁 kwijtgescholden' : it.forgiven > 0 ? `✓ terug · ${money(it.forgiven)} kwijtgescholden` : '✓ terugbetaald';
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
        ${forgiven.length ? `<div class="adv-hist-block"><div class="small muted">Kwijtgescholden</div>${forgiven.map(f => `<div class="adv-hist-row"><span class="grow">🎁 ${esc(f.note || 'Kwijtgescholden')} <span class="small muted">${fmtDate(f.date)} → ${esc(catName(f.categoryId))}</span></span><span class="amount">${money(f.amount)}</span><button class="btn small ghost" data-action="forgive-undo" data-person="${esc(p.name)}" data-id="${esc(f.id)}" title="Ongedaan maken">✕</button></div>`).join('')}</div>` : ''}
      </details>`;
    };
    const openCard = p => {
      const st = p.stats;
      const ent = p.entity || {};
      const sugg = C.suggestRepayments(state, p.name, ent.ibans, today, 3);
      const items = st.items.filter(it => it.amount - it.repaid > 0).slice().sort((a, b) => b.date.localeCompare(a.date));
      return `<div class="card person-card">
        <div class="person-head"><span class="avatar" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
          <div class="grow"><strong class="person-name">${esc(p.name)}</strong><div class="small muted">${items.length} open voorschot${items.length === 1 ? '' : 'ten'}</div></div>
          <div class="person-open"><div class="small muted">nog terug te krijgen</div><strong>${money(st.open)}</strong></div></div>
        ${sugg.length ? `<div class="suggest">${sugg.map(x => `<div class="suggest-row">💡 <span class="grow">Terugbetaling? <strong>${money(x.tx.amount)}</strong> van ${esc(x.tx.title || x.tx.counterparty || '?')} op ${fmtDate(x.tx.date)} <span class="muted small">(${esc(x.why)})</span></span>
          <button class="btn small primary" data-action="adv-accept" data-id="${esc(x.tx.id)}" data-person="${esc(p.name)}">Ja, koppel</button></div>`).join('')}</div>` : ''}
        <div class="adv-items">${items.map(it => {
          const left = it.amount - it.repaid;
          const key = esc(advKey(it));
          return `<div class="adv-item">
            <div class="adv-item-top">
              <button class="adv-title" data-action="adv-title" data-key="${key}" title="Titel geven of wijzigen">${itemTitle(it)}${it.title ? '' : ' <span class="adv-addtitle">✎ titel</span>'}</button>
              <strong class="adv-amt">${money(left)}</strong>
            </div>
            <div class="small muted adv-sub">${fmtDate(it.date)}${it.repaid > 0 ? ` · al ${money(it.repaid)} terug van ${money(it.amount)}` : ''} · <a href="#" data-action="edit-tx" data-id="${esc(it.txId)}">details</a></div>
            <div class="adv-paid"><span class="small muted">Betaald?</span>
              <button class="btn small" data-action="adv-item-tx" data-key="${key}" data-person="${esc(p.name)}" title="Kies de terugbetaling bij je transacties">🔗 Met een transactie</button>
              <button class="btn small" data-action="adv-item-cash" data-key="${key}" data-person="${esc(p.name)}">💶 In cash</button>
              <button class="btn small" data-action="adv-item-forgive" data-key="${key}" data-person="${esc(p.name)}" title="Je vraagt het niet meer terug: het telt dan als uitgave">🎁 Kwijtschelden</button>
            </div>
          </div>`;
        }).join('')}</div>
        ${history(p)}
        <div class="card-tools">
          <button class="btn small" data-action="adv-pick" data-person="${esc(p.name)}" data-dir="out">+ Voorschot toevoegen</button>
          <button class="btn small" data-action="adv-ledger" data-person="${esc(p.name)}" title="Alle voorschotten en terugbetalingen, en wat welke terugbetaling vereffent">📒 Rekening-courant</button>
          <button class="btn small ghost" data-action="person-edit" data-person="${esc(p.name)}">✎ Bewerk</button></div>
      </div>`;
    };
    const doneCard = p => {
      const st = p.stats;
      const status = st.open < 0 ? `<span class="badge">${money(-st.open)} te veel terug</span>` : st.items.length ? '<span class="badge ok">✓ alles in orde</span>' : '<span class="badge">nog niets voorgeschoten</span>';
      return `<div class="card person-card done">
        <div class="person-head"><span class="avatar" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
          <div class="grow"><strong class="person-name">${esc(p.name)}</strong></div>${status}</div>
        ${st.open < 0 ? `<div class="notice small">${esc(p.name)} betaalde ${money(-st.open)} te veel terug. <button class="btn small" data-action="surplus-new" data-person="${esc(p.name)}">Rest inboeken als inkomst…</button></div>` : ''}
        ${history(p)}
        <div class="card-tools">
          <button class="btn small" data-action="adv-pick" data-person="${esc(p.name)}" data-dir="out">+ Voorschot toevoegen</button>
          <button class="btn small" data-action="adv-ledger" data-person="${esc(p.name)}">📒 Rekening-courant</button>
          <button class="btn small ghost" data-action="person-edit" data-person="${esc(p.name)}">✎ Bewerk</button></div>
      </div>`;
    };
    return `
      <div class="page-head"><h1>Voorschotten</h1><span class="spacer"></span>
        <button class="btn" data-action="person-new">+ Persoon</button>
        <button class="btn primary" data-action="adv-pick" data-dir="out">+ Voorschot toevoegen</button></div>
      <p class="muted">Betaalde je iets voor iemand anders, zoals de hele restaurantrekening? Dan is dat een <strong>voorschot</strong>, geen uitgave. Hier zie je wat je nog terug moet krijgen. Is het betaald, duid dan aan hoe: met een transactie, in cash, of kwijtgescholden.</p>
      <div class="adv-summary card">
        <div><div class="label">Nog terug te krijgen</div><div class="value">${money(totalOpen)}</div></div>
        <div class="small muted">${openItemCount} open voorschot${openItemCount === 1 ? '' : 'ten'} bij ${openPeople.length} ${openPeople.length === 1 ? 'persoon' : 'personen'}</div>
        <div class="small muted adv-tip">Tip: typ bij een transactie in <em>Gekoppeld aan</em> de naam, bv. <code>pieter</code>, en kies <strong>🤝 Voorgeschoten voor Pieter</strong>.</div>
      </div>
      ${openPeople.length ? `<h2 class="section-title">Nog open</h2><div class="grid cards people">${openPeople.map(openCard).join('')}</div>`
        : people.length ? '<div class="card empty-state"><p>🎉 Niemand is je nog iets schuldig.</p></div>' : ''}
      ${done.length ? `<h2 class="section-title">Alles in orde</h2><div class="grid cards people">${done.map(doneCard).join('')}</div>` : ''}
      ${!people.length ? `<div class="card empty-state"><p>Nog geen voorschotten. Klik op <strong>+ Voorschot toevoegen</strong> en kies de betaling die je voor iemand deed.</p></div>` : ''}`;
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

