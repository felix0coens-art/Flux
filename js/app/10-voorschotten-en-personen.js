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
   * "Opvolgen": twee soorten dingen die nog niet af zijn.
   *  - Acties: iets dat jij nog moet dóén bij een of meer transacties (geld terugvragen, retour binnenbrengen,
   *    bonnetje indienen, …). Je vinkt ze af als het gedaan is. Ze veranderen niets aan de cijfers.
   *  - Voorschotten: geld dat iemand anders jou nog moet (je betaalde voor hen; telt niet als jouw uitgave).
   */
  /** Niet in geld terugbetaald: verrekend (bv. via Tricount) of kwijtgescholden (cadeau). */
  const fgLabel = (reason, cap) => reason === 'settled' ? (cap ? '🔄 Verrekend' : '🔄 verrekend') : (cap ? '🎁 Kwijtgescholden' : '🎁 kwijtgescholden');
  const fgReasonOf = it => { const r = (it.settledBy || []).filter(b => b.kind === 'forgiven'); return r.length && r.every(b => b.reason === 'settled') ? 'settled' : 'gift'; };

  /** "door ADVOCATENKANTOOR (16/10) + 🎁 kwijtgescholden": waarmee een voorschot (deels) betaald werd. */
  const paidByText = it => (it.settledBy || []).map(b => b.kind === 'forgiven' ? fgLabel(b.reason) + (b.amount !== it.amount ? ' ' + money(b.amount) : '') : esc(b.title || 'terugbetaling') + ' ' + fmtDate(b.date).slice(0, 5) + (b.amount !== it.amount ? ' (' + money(b.amount) + ')' : '')).join(' + ');

  function renderAdvances() {
    const f = ['adv', 'act', 'grp'].includes(ui.owed) ? ui.owed : 'all';
    const showAdv = f === 'all' || f === 'adv', showAct = f === 'all' || f === 'act', showGrp = f === 'all' || f === 'grp';
    // Groepen hebben hun eigen blok (met het saldo uit de groep)
    const people = C.personList(state).filter(p => !isGroupPerson(p.name)).sort((a, b) => b.stats.open - a.stats.open || a.name.localeCompare(b.name));
    const advOv = C.advancesOverview(state);
    const openPeople = people.filter(p => p.stats.open > 0);
    const done = people.filter(p => p.stats.open === 0);
    const prepaid = people.filter(p => p.stats.open < 0);
    const prepaidTotal = prepaid.reduce((a, p) => a - p.stats.open, 0);
    const advTotal = openPeople.reduce((a, p) => a + p.stats.open, 0);
    const { open: openActs, done: doneActs } = actionLists();
    const itemTitle = it => it.title ? esc(it.title) : `<span class="adv-untitled">${esc(it.counterparty || it.note || 'Voorschot')}</span>`;
    const settledHow = it => it.forgiven >= it.amount ? fgLabel(fgReasonOf(it)) : it.forgiven > 0 ? `✓ terug · ${money(it.forgiven)} ${fgLabel(fgReasonOf(it)).slice(3)}` : '✓ terugbetaald';
    const plural = (n, one, more) => n + ' ' + (n === 1 ? one : more);
    const history = (p) => {
      const st = p.stats;
      const ent = p.entity || {};
      const closed = st.items.filter(it => it.amount - it.repaid <= 0).slice().reverse();
      const reps = state.transactions.filter(t => C.splitLines(t).some(l => l.categoryId === C.SYS_ADVANCE && l.amount > 0 && String(l.person || t.person || '').toLowerCase() === p.name.toLowerCase()))
        .sort((a, b) => b.date.localeCompare(a.date));
      const settlesOf = id => (advOv.repayments.find(r => r.txId === id && r.kind === 'repayment') || { settles: [] });
      const forgiven = (ent.forgiven || []).slice().sort((a, b) => b.date.localeCompare(a.date));
      if (!closed.length && !reps.length && !forgiven.length) return '';
      return `<details class="adv-history"><summary class="small">Afgehandeld en terugbetalingen <span class="muted">(${closed.length + reps.length + forgiven.length})</span></summary>
        ${closed.length ? `<div class="adv-hist-block"><div class="small muted">Afgehandelde voorschotten</div>${closed.map(it => `<div class="adv-hist-row"><span class="grow"><button class="linklike" data-action="adv-title" data-key="${esc(advKey(it))}">${itemTitle(it)}</button> <span class="small muted">${fmtDate(it.date)}</span>
          <div class="small muted">${settledHow(it)} · ${paidByText(it)}</div></span><span class="amount">${money(it.amount)}</span><span></span></div>`).join('')}</div>` : ''}
        ${reps.length ? `<div class="adv-hist-block"><div class="small muted">Terugbetalingen</div>${reps.map(t => `<div class="adv-hist-row"><span class="grow"><a href="#" data-action="edit-tx" data-id="${esc(t.id)}">${esc(t.title || (t.source === 'manual' && /cash/i.test(t.description || '') ? 'In cash' : t.counterparty || 'Terugbetaling'))}</a> <span class="small muted">${fmtDate(t.date)}</span></span><span class="amount pos">${money(C.splitLines(t).filter(l => l.categoryId === C.SYS_ADVANCE).reduce((a, l) => a + l.amount, 0))}</span><span></span>
          ${(() => { const r = settlesOf(t.id); const parts = r.settles.map(x => esc(x.title || 'voorschot') + (r.settles.length > 1 ? ' (' + money(x.amount) + ')' : '')); return `<div class="small muted adv-hist-for">${parts.length ? 'voor: ' + parts.join(', ') : ''}${r.surplus ? (parts.length ? ' · ' : '') + money(r.surplus) + ' meer dan er open stond' : ''} · <button class="linklike" data-action="adv-ledger" data-person="${esc(p.name)}">anders koppelen</button></div>`; })()}</div>`).join('')}</div>` : ''}
        ${forgiven.length ? `<div class="adv-hist-block"><div class="small muted">Verrekend of kwijtgescholden</div>${forgiven.map(fg => `<div class="adv-hist-row"><span class="grow">${fgLabel(fg.reason, true).slice(0, 2)} ${esc(fg.note || fgLabel(fg.reason, true).slice(3))} <span class="small muted">${fmtDate(fg.date)} → ${esc(catName(fg.categoryId))}</span></span><span class="amount">${money(fg.amount)}</span><button class="btn small ghost" data-action="forgive-undo" data-person="${esc(p.name)}" data-id="${esc(fg.id)}" title="Ongedaan maken">✕</button></div>`).join('')}</div>` : ''}
      </details>`;
    };
    const personTools = p => `<div class="card-tools">
        <button class="btn small" data-action="adv-pick" data-person="${esc(p.name)}" data-dir="out">+ Voorschot</button>
        <button class="btn small" data-action="adv-ledger" data-person="${esc(p.name)}" title="Alle voorschotten en terugbetalingen, en wat welke terugbetaling vereffent">📒 Rekening-courant</button>
        <button class="btn small ghost" data-action="person-edit" data-person="${esc(p.name)}">✎ Bewerk</button></div>`;
    const openCard = p => {
      const st = p.stats;
      const sugg = C.suggestRepayments(state, p.name, (p.entity || {}).ibans, today, 3);
      const items = st.items.filter(it => it.amount - it.repaid > 0).slice().sort((a, b) => b.date.localeCompare(a.date));
      return `<div class="card person-card">
        <div class="person-head"><span class="avatar" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
          <div class="grow"><strong class="person-name">${esc(p.name)}</strong><div class="small muted">${plural(items.length, 'open voorschot', 'open voorschotten')}</div></div>
          <div class="person-open"><div class="small muted">nog terug te krijgen</div><strong>${money(st.open)}</strong></div></div>
        ${sugg.length ? `<div class="suggest">${sugg.map(x => `<div class="suggest-row">💡 <span class="grow">Terugbetaling? <strong>${money(x.tx.amount)}</strong> van ${esc(x.tx.title || x.tx.counterparty || '?')} op ${fmtDate(x.tx.date)} <span class="muted small">(${esc(x.why)})</span></span>
          <button class="btn small primary" data-action="adv-accept" data-id="${esc(x.tx.id)}" data-person="${esc(p.name)}">Ja, koppel</button></div>`).join('')}</div>` : ''}
        <div class="adv-items">${items.map(it => {
          const key = esc(advKey(it));
          return `<div class="adv-item">
            <div class="adv-item-top">
              <button class="adv-title" data-action="adv-title" data-key="${key}" title="Titel geven of wijzigen">${itemTitle(it)}${it.title ? '' : ' <span class="adv-addtitle">✎ titel</span>'}</button>
              <strong class="adv-amt">${money(it.amount - it.repaid)}</strong>
            </div>
            <div class="small muted adv-sub">${fmtDate(it.date)}${it.repaid > 0 ? ` · al ${money(it.repaid)} terug van ${money(it.amount)} (${paidByText(it)}) · <button class="linklike" data-action="adv-ledger" data-person="${esc(p.name)}">anders koppelen</button>` : ''} · <a href="#" data-action="edit-tx" data-id="${esc(it.txId)}">details</a></div>
            <div class="adv-paid"><span class="small muted">Betaald?</span>
              <button class="btn small" data-action="adv-item-tx" data-key="${key}" data-person="${esc(p.name)}" title="Kies de terugbetaling bij je transacties">🔗 Transactie</button>
              <button class="btn small" data-action="adv-item-cash" data-key="${key}" data-person="${esc(p.name)}">💶 Cash</button>
              <button class="btn small" data-action="adv-item-forgive" data-key="${key}" data-person="${esc(p.name)}" title="Niet in geld terugbetaald: verrekend (bv. via Tricount) of kwijtgescholden. Het telt dan als jouw uitgave in een categorie naar keuze.">🔄 Verrekenen</button>
            </div>
          </div>`;
        }).join('')}</div>
        ${history(p)}
        ${personTools(p)}
      </div>`;
    };
    /** Iemand betaalde je vooruit (bv. zijn deel van de Airbnb): dat geld moet je nog voor hem uitgeven. */
    const prepaidCard = p => {
      const st = p.stats;
      return `<div class="card person-card prepaid">
        <div class="person-head"><span class="avatar" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
          <div class="grow"><strong class="person-name">${esc(p.name)}</strong><div class="small muted">betaalde vooruit</div></div>
          <div class="person-open"><div class="small muted">nog voor ${esc(p.name)} te betalen</div><strong>${money(-st.open)}</strong></div></div>
        <p class="small muted">Betaal je de uitgave (bv. de Airbnb), koppel ze dan als voorschot voor ${esc(p.name)}: zo valt het tegen elkaar weg. Betaalde je ook voor jezelf? Splits dan de uitgave: jouw deel + voorschot voor ${esc(p.name)}.</p>
        <div class="adv-paid">
          <button class="btn small primary" data-action="adv-pick" data-person="${esc(p.name)}" data-dir="out">🔗 Uitgave koppelen</button>
          <button class="btn small" data-action="surplus-new" data-person="${esc(p.name)}" title="Het was gewoon te veel terugbetaald, of je houdt het">Toch inkomst…</button>
        </div>
        ${history(p)}
        ${personTools(p)}
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
        ${personTools(p)}
      </div>`;
    };
    const seg = (k, label) => `<button class="${f === k ? 'active' : ''}" data-action="owed-filter" data-f="${k}">${label}</button>`;
    const late = openActs.filter(a => a.due && a.due < today).length;
    const actSection = !showAct ? '' : `
      <section class="follow-block">
        <div class="follow-head"><h2 class="section-title">✅ Acties — nog te doen <span class="muted small">(${openActs.length})</span></h2></div>
        <form class="act-quick" data-form="action-quick">
          <input type="text" name="name" maxlength="60" placeholder="Nieuwe actie, bv. “Retour binnenbrengen”" aria-label="Nieuwe actie" autocomplete="off">
          <button class="btn primary" type="submit">+ Actie</button>
        </form>
        <div class="act-ideas small">${ACTION_IDEAS.map(x => `<button class="chip" data-action="action-idea" data-name="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        ${openActs.length ? `<div class="card act-list">${openActs.map(a => actionRow(a)).join('')}</div>`
          : '<div class="card empty-state"><p>🎉 Niets meer te doen. Tip: selecteer transacties bij <strong>Bank</strong> en kies <strong>✅ Actie toevoegen</strong>.</p></div>'}
        ${doneActs.length ? `<details class="act-done" data-keep="actDone" ${ui.keepOpen.actDone ? 'open' : ''}><summary class="small"><strong>Gedaan</strong> <span class="muted">(${doneActs.length})</span></summary>
          <div class="card act-list">${doneActs.map(a => actionRow(a)).join('')}</div></details>` : ''}
      </section>`;
    const advSection = !showAdv ? '' : `
      <section class="follow-block">
        <div class="follow-head"><h2 class="section-title">🤝 Voorschotten — nog terug te krijgen <span class="muted small">${advTotal ? money(advTotal) : ''}</span></h2><span class="spacer"></span>
          <button class="btn small" data-action="person-new">+ Persoon</button>
          <button class="btn small primary" data-action="adv-pick" data-dir="out">+ Voorschot</button></div>
        ${openPeople.length ? `<div class="grid cards people">${openPeople.map(openCard).join('')}</div>`
          : `<div class="card empty-state"><p>${people.length ? '🎉 Niemand is je nog iets schuldig.' : 'Betaalde je iets voor iemand anders, zoals de hele restaurantrekening? Typ bij die transactie in <em>Gekoppeld aan</em> de naam, bv. <code>pieter</code>, en kies <strong>🤝 Voorgeschoten voor Pieter</strong>.'}</p></div>`}
        ${prepaid.length ? `<h3 class="section-sub">📥 Vooruitbetaald — nog voor anderen te betalen <span class="muted small">${money(prepaidTotal)}</span></h3>
          <div class="grid cards people">${prepaid.map(prepaidCard).join('')}</div>` : ''}
        ${done.length ? `<details class="act-done" data-keep="advDone" ${ui.keepOpen.advDone ? 'open' : ''}><summary class="small"><strong>Alles in orde</strong> <span class="muted">(${plural(done.length, 'persoon', 'personen')})</span></summary>
          <div class="grid cards people" style="margin-top:10px">${done.map(doneCard).join('')}</div></details>` : ''}
      </section>`;
    return `
      <div class="page-head"><h1>Opvolgen</h1><span class="spacer"></span>
        <div class="seg owed-seg">${seg('all', 'Alles')}${seg('act', '✅ Acties')}${seg('adv', '🤝 Voorschotten')}${seg('grp', '👥 Groepen')}</div></div>
      <div class="follow-sum">
        <button class="follow-stat act" data-action="owed-filter" data-f="act"><span class="label">Acties te doen</span><strong>${openActs.length}</strong>${late ? `<span class="small warn-text">${late} te laat</span>` : ''}</button>
        <button class="follow-stat adv" data-action="owed-filter" data-f="adv"><span class="label">Nog terug te krijgen</span><strong>${money(advTotal)}</strong><span class="small muted">${plural(openPeople.length, 'persoon', 'personen')}${prepaidTotal ? ` · ${money(prepaidTotal)} vooruitbetaald` : ''}</span>${(() => { const gn = groupList().length ? groupsNet() : 0; return gn ? `<span class="small ${gn > 0 ? 'pos' : 'warn-text'}">👥 groepen: ${gn > 0 ? 'je krijgt nog ' + money(gn) : 'je moet nog ' + money(-gn)}</span>` : ''; })()}</button>
      </div>
      <p class="small muted follow-help"><strong>Actie</strong> = iets wat jij nog moet doen bij een transactie (geld terugvragen, retour binnenbrengen, bonnetje indienen); vink het af als het gedaan is.
        <strong>Voorschot</strong> = je betaalde voor iemand anders; dat is niet jouw uitgave en Helder houdt bij wat je nog terugkrijgt.
        <strong>Groep</strong> = samen uitgaven delen via een link, zoals Tricount.</p>
      ${actSection}${advSection}${showGrp ? groupsSection() : ''}`;
  }

  /**
   * Alle transacties in één categorie (klik op een categorie, eender waar). Standaard de gekozen periode,
   * met een knop voor alles. Telt zoals de rest van Helder: terugbetalingen en kwijtscheldingen inbegrepen.
   */
  function catTxModal() {
    const m = modal;
    const forgivenReason = Object.fromEntries(C.forgivenList(state).map(f => [f.id, f.reason]));
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
      const what = r.forgiven ? `${fgLabel((forgivenReason[r.forgiveId] || 'gift'), true)} met ${esc(r.person || '')}` : t ? esc(t.title || t.counterparty || t.description || '—') : '—';
      const sub = r.forgiven ? 'voorschot dat jouw uitgave werd' : t ? esc([r.refund ? '↩ terugbetaling' : '', t.title ? t.counterparty : '', accName(t.accountId)].filter(Boolean).join(' · ')) : '';
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

