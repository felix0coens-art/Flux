  // ----- Acties -----

  function actionById(id) { return (state.actions || []).find(a => a.id === id) || null; }

  /** Eén actie: wat je uitgaf, wat er terugkwam, wat nog open staat, en alle transacties. */
  function actionCard(a, inModal) {
    const s = C.actionSummary(state, a);
    const pct = a.expectBack && s.out ? Math.min(1, s.back / s.out) : 0;
    const name = t => esc(t.title || t.counterparty || t.description || '—');
    return `<div class="${inModal ? '' : 'card '}action-card ${a.closed ? 'closed' : ''}" id="action-${esc(a.id)}">
      <div class="action-head">
        <div class="grow"><strong class="action-name">🏷 ${esc(a.name)}</strong>${a.closed ? ' <span class="badge">afgerond</span>' : ''}
          ${a.note ? `<div class="small muted">${esc(a.note)}</div>` : ''}</div>
        ${a.expectBack ? `<div class="action-open"><div class="small muted">${s.open > 0 ? 'nog terug te krijgen' + (a.person ? ' van ' + esc(a.person) : '') : 'terugbetaald'}</div><strong class="${s.open > 0 ? '' : 'pos'}">${s.open > 0 ? money(s.open) : '✓'}</strong></div>` : ''}
      </div>
      <div class="action-totals small">
        <span>Uitgegeven <strong>${money(s.out)}</strong></span>
        ${s.back ? `<span>Teruggekregen <strong class="pos">${money(s.back)}</strong></span>` : ''}
        <span>${s.txs.length} transactie${s.txs.length === 1 ? '' : 's'}</span>
      </div>
      ${a.expectBack && s.out ? `<div class="progress"><div class="bar ok" style="width:${(pct * 100).toFixed(1)}%"></div></div>` : ''}
      ${s.txs.length ? `<div class="action-txs">${s.txs.map(t => `<div class="action-tx">
          <div class="at-main"><a href="#" data-action="edit-tx" data-id="${esc(t.id)}">${name(t)}</a>
            <div class="small muted">${fmtDate(t.date)}${t.title && t.counterparty ? ' · ' + esc(t.counterparty) : ''}${t.categoryId ? ' · ' + esc(catLabel(t.categoryId)) : ''}</div></div>
          <span class="amount ${amountClass(t.amount)}">${money(t.amount)}</span>
          <button class="btn small ghost" data-action="action-tx-remove" data-action-id="${esc(a.id)}" data-id="${esc(t.id)}" title="Uit deze actie halen">✕</button></div>`).join('')}</div>`
        : '<p class="small muted">Nog geen transacties. Voeg ze toe met de knop hieronder, of kies de actie bij een transactie.</p>'}
      <div class="card-tools">
        <button class="btn small" data-action="action-add-tx" data-id="${esc(a.id)}">+ Transacties toevoegen</button>
        ${a.closed ? `<button class="btn small" data-action="action-close" data-id="${esc(a.id)}" data-closed="0">Heropenen</button>` : `<button class="btn small" data-action="action-close" data-id="${esc(a.id)}" data-closed="1">✓ Afronden</button>`}
        <button class="btn small ghost" data-action="action-edit" data-id="${esc(a.id)}">✎ Bewerk</button>
      </div>
    </div>`;
  }

  function renderActions() {
    const list = (state.actions || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const open = list.filter(a => !a.closed), closed = list.filter(a => a.closed);
    const toGet = open.reduce((t, a) => t + C.actionSummary(state, a).open, 0);
    return `
      <div class="page-head"><h1>Acties</h1><span class="spacer"></span><button class="btn primary" data-action="action-new">+ Nieuwe actie</button></div>
      <p class="muted">Een actie bundelt transacties die bij elkaar horen, bv. <em>“Kleren — mama betaalt terug”</em> of <em>“Verbouwing badkamer”</em>. Anders dan een voorschot blijven het gewoon <strong>jouw uitgaven</strong> (in hun categorie); de actie toont het geheel: wat je uitgaf, wat er terugkwam en wat je nog moet terugkrijgen.</p>
      ${open.some(a => a.expectBack) ? `<div class="adv-summary card"><div><div class="label">Nog terug te krijgen via acties</div><div class="value">${money(toGet)}</div></div><div class="small muted">${open.filter(a => a.expectBack && C.actionSummary(state, a).open > 0).length} open actie(s)</div></div>` : ''}
      ${open.length ? `<div class="grid cards actions-grid">${open.map(a => actionCard(a)).join('')}</div>`
        : `<div class="card empty-state"><p>Nog geen acties. Maak er een met <strong>+ Nieuwe actie</strong>, of selecteer transacties bij Bank en kies <strong>🏷 Aan actie toevoegen</strong>.</p></div>`}
      ${closed.length ? `<details class="card" style="margin-top:16px"><summary><strong>Afgeronde acties</strong> <span class="small muted">(${closed.length})</span></summary><div class="grid cards actions-grid" style="margin-top:12px">${closed.map(a => actionCard(a)).join('')}</div></details>` : ''}`;
  }

  function actionModal() {
    const m = modal;
    const a = m.edit;
    return modalShell(m.isNew ? 'Nieuwe actie' : 'Actie bewerken', `
      <div class="form-stack">
        <label class="field"><span>Naam</span><input type="text" id="act-name" maxlength="60" value="${esc(a.name || '')}" placeholder="bv. Kleren voor mama"></label>
        <label class="check"><input type="checkbox" id="act-back" ${a.expectBack ? 'checked' : ''}> Ik moet dit (deels) terugkrijgen</label>
        <label class="field"><span>Van wie? <span class="muted small">(optioneel)</span></span><input type="text" id="act-person" maxlength="40" list="act-people" value="${esc(a.person || '')}" placeholder="bv. mama">
          <datalist id="act-people">${C.personList(state).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></label>
        <label class="field"><span>Notitie <span class="muted small">(optioneel)</span></span><input type="text" id="act-note" maxlength="120" value="${esc(a.note || '')}"></label>
        <div class="errors" id="act-errors"></div>
      </div>`,
      `${m.isNew ? '' : '<button class="btn danger" data-action="action-delete">Verwijderen</button>'}<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="action-save">Opslaan</button>`);
  }

  function saveAction() {
    const m = modal;
    const name = $('#act-name').value.trim();
    if (!name) { $('#act-errors').textContent = 'Geef de actie een naam.'; return; }
    const a = Object.assign({}, m.edit, { name, expectBack: $('#act-back').checked, person: $('#act-person').value.trim(), note: $('#act-note').value.trim() });
    state.actions = state.actions || [];
    const i = state.actions.findIndex(x => x.id === a.id);
    if (i >= 0) state.actions[i] = a; else state.actions.push(Object.assign(a, { createdAt: new Date().toISOString() }));
    // Kwamen we hier vanuit transacties? Die meteen toevoegen
    for (const id of m.addTx || []) { const t = txById(id); if (t && !(t.actions || []).includes(a.id)) t.actions = (t.actions || []).concat([a.id]); }
    if (m.addTx && m.addTx.length) ui.selected.clear();
    const back = m.back;
    closeModal();
    commit(m.isNew ? `Actie “${name}” gemaakt` : 'Actie bewaard');
    if (back) openModal(back);
  }

  /** Transacties kiezen om aan een actie toe te voegen (uitgaven én inkomende terugbetalingen). */
  function actionPickModal() {
    const m = modal;
    const a = actionById(m.id);
    const q = (m.search || '').toLowerCase();
    const list = state.transactions.filter(t => !(t.actions || []).includes(m.id) && !t.isTransfer)
      .filter(t => !q || `${t.title || ''} ${t.counterparty} ${t.description} ${C.centsToInput(t.amount)}`.toLowerCase().includes(q))
      .sort((x, y) => y.date.localeCompare(x.date)).slice(0, 120);
    return modalShell(`Toevoegen aan “${a ? a.name : ''}”`, `
      <p class="small muted">Vink de uitgaven aan die bij deze actie horen, en ook de terugbetalingen${a && a.person ? ' van ' + esc(a.person) : ''} als die al binnenkwamen.</p>
      <input type="search" id="act-search" placeholder="Zoeken…" value="${esc(m.search || '')}">
      <div class="table-wrap" style="margin-top:8px"><table class="tx-table"><tbody>${list.map(t => `<tr class="${m.chosen.has(t.id) ? 'is-selected' : ''}">
        <td class="sel-cell"><input type="checkbox" data-act-pick="${esc(t.id)}" ${m.chosen.has(t.id) ? 'checked' : ''}></td>
        <td class="nowrap">${fmtDate(t.date)}</td><td>${t.title ? `<strong>${esc(t.title)}</strong> <span class="small muted">${esc(t.counterparty)}</span>` : esc(t.counterparty || '—')}<div class="desc">${esc(t.description)}</div></td>
        <td class="amount ${amountClass(t.amount)}">${money(t.amount)}</td><td class="small muted">${esc(t.categoryId ? catLabel(t.categoryId) : 'te verwerken')}</td></tr>`).join('') || '<tr><td class="muted">Geen transacties gevonden.</td></tr>'}</tbody></table></div>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="action-pick-apply" ${m.chosen.size ? '' : 'disabled'}>${m.chosen.size} toevoegen</button>`, true);
  }

  /** In het transactievenster: actie toevoegen zonder het venster opnieuw te tekenen (getypte velden blijven). */
  function txAddAction(sel) {
    const t = modal.tx;
    let id = sel.value;
    if (!id) return;
    if (id === '__new__') {
      const name = (prompt('Naam van de nieuwe actie (bv. “Kleren voor mama”)') || '').trim();
      if (!name) { sel.value = ''; return; }
      const a = { id: C.uid('act'), name, expectBack: true, person: '', note: '', createdAt: new Date().toISOString() };
      state.actions = (state.actions || []).concat([a]);
      id = a.id;
    }
    const a = actionById(id);
    t.actions = (t.actions || []).filter(x => x !== id).concat([id]);
    sel.insertAdjacentHTML('beforebegin', `<span class="badge action-badge">🏷 ${esc(a.name)} <button type="button" class="chip-x" data-action="tx-action-remove" data-id="${esc(a.id)}" aria-label="Uit actie halen">✕</button></span>`);
    const opt = Array.from(sel.options).find(o => o.value === id);
    if (opt) opt.remove();
    sel.value = '';
  }

  function addToAction(ids, actionId) {
    let n = 0;
    for (const id of ids) { const t = txById(id); if (t && !(t.actions || []).includes(actionId)) { t.actions = (t.actions || []).concat([actionId]); n++; } }
    return n;
  }

  /**
   * Rekening-courant van één persoon: alle voorschotten en terugbetalingen op datum, met het lopend saldo.
   * Per terugbetaling kies je zelf welk voorschot ze vereffent (of automatisch: het oudste eerst).
   */
  function advLedgerModal() {
    const m = modal;
    const pl = C.personList(state).find(x => x.name.toLowerCase() === m.person.toLowerCase());
    const st = pl ? pl.stats : { ledger: [], open: 0, items: [] };
    const rows = (st.ledger || []).slice().reverse();
    const items = st.items || [];
    const itemName = it => (it.title || it.counterparty || 'Voorschot') + ' · ' + fmtDate(it.date) + ' · ' + money(it.amount);
    const settleSelect = r => {
      const target = r.advanceOf || '';
      return `<select class="settle-select" data-settle="${esc(r.ref)}" aria-label="Welk voorschot vereffent dit?">
        <option value="">Automatisch (oudste open voorschot)</option>
        ${items.map(it => `<option value="${esc(it.key)}" ${target === it.key || (target && target === it.txId && it.split == null) ? 'selected' : ''}>${esc(itemName(it))}${it.amount - it.repaid > 0 ? ' — nog ' + money(it.amount - it.repaid) + ' open' : ''}</option>`).join('')}
      </select>`;
    };
    const line = row => {
      if (row.kind === 'advance') {
        const it = row.item;
        const left = it.amount - it.repaid;
        return `<tr class="lg-adv">
          <td class="nowrap">${fmtDate(row.date)}</td>
          <td><button class="linklike adv-title-sm" data-action="adv-title" data-key="${esc(it.key)}"><strong>${esc(it.title || it.counterparty || 'Voorschot')}</strong>${it.title ? '' : ' <span class="adv-addtitle">✎ titel</span>'}</button>
            <div class="small muted">${left <= 0 ? (it.forgiven >= it.amount ? '🎁 kwijtgescholden' : '✓ vereffend') : left < it.amount ? `deels vereffend · nog ${money(left)} open` : '<span class="warn-text">nog open</span>'}${it.settledBy.length ? ' · door ' + it.settledBy.map(b => esc((b.kind === 'forgiven' ? '🎁 ' : '') + (b.title || 'terugbetaling')) + ' (' + money(b.amount) + ')').join(', ') : ''}</div></td>
          <td class="amount">${money(it.amount)}</td><td></td>
          <td class="amount lg-bal">${money(row.balance)}</td></tr>`;
      }
      if (row.kind === 'surplus') {
        const x = row.surplus;
        return `<tr class="lg-surplus"><td class="nowrap">${fmtDate(row.date)}</td>
          <td><strong>Rest ingeboekt als inkomst</strong> → ${catBadge(x.categoryId)}${x.note ? ` <span class="small muted">${esc(x.note)}</span>` : ''}</td>
          <td class="amount">${money(x.amount)}</td><td></td><td class="amount lg-bal">${money(row.balance)}</td>
          <td><button class="btn small ghost" data-action="surplus-undo" data-person="${esc(m.person)}" data-id="${esc(x.id)}" title="Ongedaan maken">✕</button></td></tr>`;
      }
      const r = row.repayment;
      const t = r.txId ? txById(r.txId) : null;
      const label = r.kind === 'forgiven' ? '🎁 Kwijtgescholden' + (r.title ? ': ' + r.title : '') : (r.title || r.counterparty || 'Terugbetaling');
      return `<tr class="lg-rep">
        <td class="nowrap">${fmtDate(row.date)}</td>
        <td>${t ? `<a href="#" data-action="edit-tx" data-id="${esc(t.id)}">${esc(label)}</a>` : esc(label)}
          <div class="lg-settle"><span class="small muted">vereffent:</span> ${settleSelect(r)}</div>
          ${r.surplus ? `<div class="small warn-text">${money(r.surplus)} meer dan er open stond</div>` : ''}</td>
        <td></td><td class="amount pos">${money(r.amount)}</td>
        <td class="amount lg-bal">${money(row.balance)}</td></tr>`;
    };
    const over = st.open < 0 ? -st.open : 0;
    return modalShell(`Rekening-courant — ${m.person}`, `
      <div class="lg-head">
        <div><div class="small muted">${st.open > 0 ? m.person + ' is je nog schuldig' : st.open < 0 ? 'Te veel terugbetaald' : 'Saldo'}</div><div class="cat-total ${st.open < 0 ? 'pos' : ''}">${money(Math.abs(st.open))}</div></div>
        <p class="small muted">Zoals een rekening: een voorschot zet geld op de rekening van ${esc(m.person)}, een terugbetaling haalt het eraf. Kies bij elke terugbetaling welk voorschot ze vereffent; laat je “Automatisch” staan, dan gaat ze naar het oudste open voorschot.</p>
      </div>
      ${over ? `<div class="notice small">${esc(m.person)} betaalde <strong>${money(over)}</strong> meer terug dan er open stond. Hoort dat bij een voorschot dat nog niet in Helder staat? Voeg het dan toe. Anders kan je de rest inboeken als inkomst.
        <div style="margin-top:6px"><button class="btn small primary" data-action="surplus-new" data-person="${esc(m.person)}">Rest inboeken als inkomst…</button></div></div>` : ''}
      ${rows.length ? `<div class="table-wrap"><table class="ledger"><thead><tr><th>Datum</th><th>Omschrijving</th><th class="right">Voorschot</th><th class="right">Terug</th><th class="right">Saldo</th><th></th></tr></thead><tbody>${rows.map(line).join('')}</tbody></table></div>`
        : '<p class="muted">Nog geen bewegingen.</p>'}`,
      `<button class="btn" data-action="adv-pick" data-person="${esc(m.person)}" data-dir="out">+ Voorschot</button><button class="btn" data-action="adv-pick" data-person="${esc(m.person)}" data-dir="in">+ Terugbetaling</button><span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>`, true);
  }

  /** Te veel terugbetaald: de rest inboeken als (andere) inkomst. */
  function surplusModal() {
    const m = modal;
    const pl = C.personList(state).find(x => x.name.toLowerCase() === m.person.toLowerCase());
    const over = pl && pl.stats.open < 0 ? -pl.stats.open : 0;
    return modalShell('Rest inboeken als inkomst — ' + m.person, `
      <p class="small muted">${esc(m.person)} betaalde ${money(over)} meer terug dan er open stond. Dat deel telt dan als inkomst in de categorie die je kiest, en de rekening van ${esc(m.person)} staat weer op nul.</p>
      <div class="form-grid">
        <label class="field"><span>Bedrag</span><input type="text" id="sp-amount" inputmode="decimal" value="${esc((over / 100).toFixed(2).replace('.', ','))}"></label>
        <label class="field"><span>Datum</span><input type="date" id="sp-date" value="${esc(today)}" max="${today}"></label>
        <label class="field full"><span>Telt als inkomst in</span><select id="sp-category">${categoryOptions(null, { kind: 'income' })}</select></label>
        <label class="field full"><span>Notitie <span class="muted small">(optioneel)</span></span><input type="text" id="sp-note" maxlength="80" placeholder="bv. fooi, rente, extra bijdrage"></label>
      </div>
      <div class="errors" id="sp-errors"></div>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="surplus-save">Inboeken</button>`);
  }

  function saveSurplus() {
    const m = modal;
    const pl = C.personList(state).find(x => x.name.toLowerCase() === m.person.toLowerCase());
    const over = pl && pl.stats.open < 0 ? -pl.stats.open : 0;
    const amount = C.parseAmount($('#sp-amount').value);
    const date = $('#sp-date').value;
    const categoryId = $('#sp-category').value || null;
    const errors = [];
    if (isNaN(amount) || amount <= 0) errors.push('Geef een bedrag groter dan 0.');
    else if (amount > over) errors.push('Dat is meer dan het overschot (' + money(over) + ').');
    if (!C.parseDate(date)) errors.push('Geef een geldige datum.');
    if (!categoryId || !cat(categoryId) || cat(categoryId).kind !== 'income') errors.push('Kies een inkomstencategorie (maak er eventueel een bij Instellingen → Categorieën).');
    if (errors.length) { $('#sp-errors').innerHTML = errors.map(esc).join('<br>'); return; }
    const p = ensurePerson(m.person);
    if (!p) return;
    const entry = { id: C.uid('sp'), date, amount, categoryId, note: $('#sp-note').value.trim() };
    p.surplus = (p.surplus || []).concat([entry]);
    openModal({ type: 'advLedger', person: p.name });
    commit();
    toast(`${money(amount)} ingeboekt als ${catName(categoryId)}`, { label: 'Ongedaan maken', run: () => removeSurplus(p.name, entry.id) });
  }

  function removeSurplus(person, id) {
    const p = personEntity(person);
    if (!p) return;
    p.surplus = (p.surplus || []).filter(x => x.id !== id);
    commit('Inboeking ongedaan gemaakt');
  }

  /** Terugbetaling (of kwijtschelding) aan een ander voorschot koppelen, vanuit de rekening-courant. */
  function setSettle(ref, key) {
    if (ref.startsWith('fg:')) {
      const id = ref.slice(3);
      for (const p of state.people || []) for (const f of p.forgiven || []) if (f.id === id) { if (key) f.advanceOf = key; else delete f.advanceOf; }
    } else {
      const t = txById(ref);
      if (!t) return;
      if (key) t.advanceOf = key; else delete t.advanceOf;
    }
    commit();
    if (modal && modal.type === 'advLedger') renderModal();
  }

  /** Titel van één voorschot (bij een gesplitste betaling: de notitie van die splitsing). */
  function advTitleModal() {
    const m = modal;
    const it = advItem(m.key);
    if (!it) return modalShell('Titel', '<p class="muted">Dit voorschot bestaat niet meer.</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
    const t = txById(it.txId);
    return modalShell('Titel van het voorschot', `
      <p class="small muted">Waarvoor schoot je ${money(it.amount)} voor aan ${esc(it.person)} op ${fmtDate(it.date)}? Bv. <em>Concertticket</em>, <em>Etentje Gent</em>.</p>
      <label class="field"><span>Titel</span><input type="text" id="adv-title-input" maxlength="80" value="${esc(it.title)}" placeholder="bv. Concertticket"></label>
      <p class="small muted">Transactie: ${esc((t && (t.counterparty || t.description)) || '')} · ${money(t ? t.amount : -it.amount)}</p>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="adv-title-save">Opslaan</button>`);
  }

  function saveAdvTitle() {
    const it = advItem(modal.key);
    const t = it && txById(it.txId);
    if (!t) { closeModal(); return; }
    const v = $('#adv-title-input').value.trim();
    if (it.split != null && t.splits && t.splits[it.split]) t.splits[it.split].note = v;
    else if (v) t.title = v; else delete t.title;
    closeModal();
    commit(v ? 'Titel bewaard' : 'Titel verwijderd');
  }

  /** Een openstaand voorschot kwijtschelden: het wordt een uitgave in een categorie naar keuze. */
  function forgiveModal() {
    const m = modal;
    const st = (C.personList(state).find(x => x.name.toLowerCase() === m.person.toLowerCase()) || { stats: { open: 0 } }).stats;
    const max = m.max != null ? m.max : st.open;
    return modalShell('Kwijtschelden — ' + (m.title ? m.title + ' (' + m.person + ')' : m.person), `
      <p class="small muted">Je vraagt dit geld niet meer terug van <strong>${esc(m.person)}</strong> (bv. je trakteerde, of het was een cadeau). Dan is het geen voorschot meer maar een <strong>uitgave</strong>: kies in welke categorie het moet tellen.</p>
      <div class="form-grid">
        <label class="field"><span>Bedrag <span class="muted small">(nog open: ${money(max)})</span></span><input type="text" id="fg-amount" inputmode="decimal" value="${esc((Math.max(0, max) / 100).toFixed(2).replace('.', ','))}"></label>
        <label class="field"><span>Datum</span><input type="date" id="fg-date" value="${esc(today)}" max="${today}"></label>
        <label class="field full"><span>Telt als uitgave in</span><select id="fg-category">${categoryOptions(m.categoryId || null, { kind: 'expense' })}</select></label>
        <label class="field full"><span>Notitie <span class="muted small">(optioneel)</span></span><input type="text" id="fg-note" maxlength="80" placeholder="bv. verjaardagscadeau" value="${esc(m.title || '')}"></label>
      </div>
      <div class="errors" id="fg-errors"></div>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="forgive-save">Kwijtschelden</button>`);
  }

  function saveForgive() {
    const m = modal;
    const st = (C.personList(state).find(x => x.name.toLowerCase() === m.person.toLowerCase()) || { stats: { open: 0 } }).stats;
    const max = m.max != null ? m.max : st.open;
    const amount = C.parseAmount($('#fg-amount').value);
    const date = $('#fg-date').value;
    const categoryId = $('#fg-category').value || null;
    const errors = [];
    if (isNaN(amount) || amount <= 0) errors.push('Geef een bedrag groter dan 0.');
    else if (amount > max) errors.push('Dat is meer dan wat nog open staat (' + money(max) + ').');
    if (!C.parseDate(date)) errors.push('Geef een geldige datum.');
    if (!categoryId) errors.push('Kies in welke categorie het als uitgave telt.');
    else if (C.SYS_ADVANCE === categoryId || (cat(categoryId) && cat(categoryId).kind !== 'expense')) errors.push('Kies een uitgavencategorie.');
    if (errors.length) { $('#fg-errors').innerHTML = errors.map(esc).join('<br>'); return; }
    const p = ensurePerson(m.person);
    if (!p) { $('#fg-errors').textContent = 'Kies eerst een naam voor deze persoon (Bewerk).'; return; }
    const entry = Object.assign({ id: C.uid('fg'), date, amount, categoryId, note: $('#fg-note').value.trim() }, m.advanceOf ? { advanceOf: m.advanceOf } : {});
    p.forgiven = (p.forgiven || []).concat([entry]);
    closeModal();
    commit();
    toast(`${money(amount)} kwijtgescholden aan ${p.name} → ${catName(categoryId)}`, { label: 'Ongedaan maken', run: () => removeForgive(p.name, entry.id) });
  }

  function removeForgive(person, id) {
    const p = personEntity(person);
    if (!p) return;
    p.forgiven = (p.forgiven || []).filter(f => f.id !== id);
    commit('Kwijtschelding ongedaan gemaakt');
  }

  function personModal() {
    const m = modal;
    const p = m.person;
    return modalShell(m.original ? 'Persoon bewerken' : 'Nieuwe persoon', `
      <div class="form-stack">
        <label class="field"><span>Naam</span><input type="text" id="per-name" value="${esc(p.name || '')}" placeholder="bv. Pieter"></label>
        <label class="field"><span>IBAN(s) van deze persoon <span class="muted small">(optioneel, één per lijn)</span></span><textarea id="per-ibans" rows="2" placeholder="BE.. ....">${esc((p.ibans || []).map(C.formatIban).join('\n'))}</textarea>
          <span class="small muted" style="font-weight:normal">Helder herkent dan betalingen van deze persoon als mogelijke terugbetaling. Wordt ook vanzelf onthouden als je een terugbetaling koppelt.</span></label>
        <div class="errors" id="per-errors"></div></div>`,
      `${m.original && !C.personList(state).find(x => x.name.toLowerCase() === m.original.toLowerCase()).stats.items.length ? '<button class="btn danger" data-action="person-delete">Verwijderen</button>' : ''}<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="person-save">Opslaan</button>`);
  }

  function savePerson() {
    const m = modal;
    const name = $('#per-name').value.trim();
    if (!name) { $('#per-errors').textContent = 'Geef een naam.'; return; }
    const clash = personEntity(name);
    if (clash && (!m.original || clash.name.toLowerCase() !== m.original.toLowerCase())) { $('#per-errors').textContent = 'Die persoon bestaat al.'; return; }
    const ibans = $('#per-ibans').value.split(/[\n,;]+/).map(v => C.normalizeIban(v)).filter(Boolean);
    let p = m.original ? personEntity(m.original) : null;
    if (!p) { p = { id: C.uid('per'), name, ibans: [] }; state.people = (state.people || []).concat(p); }
    if (m.original && m.original !== name) {
      // Naam overal aanpassen
      const old = m.original.toLowerCase();
      for (const t of state.transactions) {
        if (t.person && t.person.toLowerCase() === old) t.person = name;
        for (const sp of t.splits || []) if (sp.person && sp.person.toLowerCase() === old) sp.person = name;
      }
    }
    p.name = name; p.ibans = Array.from(new Set(ibans));
    closeModal();
    commit('Persoon bewaard');
  }

  function advPickModal() {
    const m = modal;
    const out = m.dir === 'out';
    const q = (m.search || '').toLowerCase();
    const from = C.addDays(today, -180);
    const list = state.transactions.filter(t => (out ? t.amount < 0 : t.amount > 0) && t.date >= from && !t.isTransfer && !t.refundOf && !(t.splits && t.splits.length) && t.categoryId !== C.SYS_ADVANCE && t.categoryId !== C.SYS_INVEST)
      .filter(t => !q || `${t.title || ''} ${t.counterparty} ${t.description} ${C.centsToInput(t.amount)}`.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);
    const sugg = new Set(out ? [] : C.suggestRepayments(state, m.person, (personEntity(m.person) || {}).ibans, today, 20).map(x => x.tx.id));
    list.sort((a, b) => (sugg.has(b.id) ? 1 : 0) - (sugg.has(a.id) ? 1 : 0));
    const who = m.person || 'iemand';
    return modalShell(m.forItem ? `Terugbetaling van ${m.forItem}` : out ? `Voorschot toevoegen${m.person ? ' voor ' + m.person : ''}` : `Terugbetaling van ${m.person}`, `
      ${m.askPerson ? `<label class="field"><span>Voor wie schoot je het voor?</span><input type="text" id="adv-person" list="adv-people" value="${esc(m.person || '')}" placeholder="bv. Pieter">
        <datalist id="adv-people">${C.personList(state).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></label>` : ''}
      ${m.forItem ? `<p class="small">Kies de betaling waarmee ${esc(m.person)} <strong>${esc(m.forItem)}</strong> terugbetaalde (nog ${money(m.left || 0)} open).</p>` : ''}
      <p class="small muted">${m.forItem ? '' : out ? 'Vink de betalingen aan die je voor ' + esc(who) + ' deed. Betaalde je ook voor jezelf? Open dan de transactie en splits ze.' : 'Vink de betalingen aan waarmee ' + esc(m.person) + ' je terugbetaalde. Ze worden afgeboekt op de oudste open voorschotten.'}</p>
      <input type="search" id="adv-search" placeholder="Zoeken…" value="${esc(m.search || '')}">
      <div class="table-wrap" style="margin-top:8px"><table class="tx-table"><tbody>${list.map(t => `<tr class="${m.chosen.has(t.id) ? 'is-selected' : ''}">
        <td class="sel-cell"><input type="checkbox" data-adv-pick="${esc(t.id)}" ${m.chosen.has(t.id) ? 'checked' : ''}></td>
        <td class="nowrap">${fmtDate(t.date)}</td><td>${sugg.has(t.id) ? '💡 ' : ''}${esc(t.title || t.counterparty || '—')}<div class="desc">${esc(t.description)}</div></td>
        <td class="amount ${amountClass(t.amount)}">${money(t.amount)}</td><td class="small muted">${esc(t.categoryId ? catLabel(t.categoryId) : 'te verwerken')}</td></tr>`).join('') || '<tr><td class="muted">Geen betalingen gevonden in de laatste 6 maanden.</td></tr>'}</tbody></table></div>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="adv-pick-apply" ${m.chosen.size ? '' : 'disabled'}>${m.chosen.size} koppelen</button>`, true);
  }

