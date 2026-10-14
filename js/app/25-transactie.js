  // ----- Transactie -----

  function txModal() {
    const t = modal.tx;
    const isNew = !txById(t.id);
    const imported = t.source === 'import';
    const i = imported ? imp(t.importId) : null;
    const suggestions = t.amount > 0 ? C.suggestRefundTargets(state, t, 10) : [];
    if (t.refundOf && !suggestions.some(s => s.tx.id === t.refundOf) && txById(t.refundOf)) suggestions.unshift({ tx: txById(t.refundOf) });
    const adv = C.advancesOverview(state);
    const openAdv = adv.items.filter(it => it.amount - it.repaid > 0 || it.txId === t.advanceOf);
    const refundedBy = state.transactions.filter(o => o.refundOf === t.id);
    const splitRows = (t.splits || []).map(s => splitRow(Object.assign({}, s, { opposite: Math.sign(s.amount) !== Math.sign(t.amount) }))).join('');
    const people = Array.from(new Set(adv.items.map(x => x.person))).sort();

    const body = `
      <div class="provenance small">${imported ? `📄 Uit bestand <strong>${esc(i ? i.fileName : '?')}</strong>${i ? ` (${esc(i.bankName || '')}, opgeladen ${esc(fmtDateTime(i.importedAt))})` : ''}. Correcties blijven bewaard.` : isNew ? '✎ Nieuwe manuele transactie' : '✎ Manueel ingevoerd'}</div>
      <label class="field"><span>Eigen titel <span class="muted">(optioneel — waarvoor was dit?)</span></span>
        <input type="text" id="tx-title" value="${esc(t.title || '')}" placeholder="bv. Verjaardagscadeau mama, Treinticket Brussel, Etentje met collega's"></label>
      <div class="small" id="tx-title-sugg"></div>
      <div class="form-grid">
        <label class="field"><span>Datum</span><input type="date" id="tx-date" value="${esc(t.date)}" required></label>
        <label class="field"><span>Bedrag (− = uitgave)</span><input type="text" inputmode="decimal" id="tx-amount" value="${t.amount ? esc((t.amount < 0 ? '-' : '') + C.centsToInput(t.amount)) : ''}" placeholder="-12,50"></label>
        <label class="field"><span>Rekening</span><select id="tx-account">${accountOptions(t.accountId)}</select></label>
        <label class="field"><span>Tegenpartij${imported ? ' <span class="muted">(van de bank)</span>' : ''}</span><input type="text" id="tx-counterparty" value="${esc(t.counterparty)}"></label>
        <label class="field full"><span>Mededeling${imported ? ' <span class="muted">(van de bank)</span>' : ''}</span><input type="text" id="tx-description" value="${esc(t.description)}"></label>
        <label class="field"><span>IBAN tegenpartij</span><input type="text" id="tx-iban" value="${esc(C.formatIban(t.counterpartyIban))}"></label>
        <label class="field"><span>Gekoppeld aan${t.categorySource === 'rule' ? ' <span class="muted">(via regel)</span>' : t.categorySource === 'system' ? ' <span class="muted">(automatisch)</span>' : ''}</span>
          <span class="input-row"><select id="tx-category">${categoryOptions(t.categoryId, { emptyLabel: '— Te verwerken —', special: true })}</select>
          <button class="btn small" type="button" data-action="lookup-one" title="Zoek online wat voor zaak dit is" aria-label="Online opzoeken">🔎</button></span></label>
        <div class="full small" id="tx-lookup-result"></div>
      </div>

      <div class="section" id="sec-advance" hidden>
        <h3 id="adv-title">Voorschot</h3>
        <div class="form-grid">
          <label class="field"><span id="adv-person-label">Voor wie?</span><input type="text" id="tx-person" list="people" value="${esc(t.person || '')}" placeholder="bv. Pieter"></label>
          <datalist id="people">${people.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
          <label class="field" id="adv-link-field"><span>Terugbetaling van welk voorschot?</span><select id="tx-advance-of"><option value="">— Op naam (oudste openstaande eerst) —</option>
            ${openAdv.map(it => `<option value="${esc(it.txId)}" ${t.advanceOf === it.txId ? 'selected' : ''}>${fmtDate(it.date)} · ${esc(it.person)} · ${money(it.amount)} (open ${money(it.amount - it.repaid)})</option>`).join('')}</select></label>
        </div>
        <p class="small muted" id="adv-help"></p>
      </div>

      <div class="section">
        <h3>Opsplitsen <button class="btn small" data-action="add-split" type="button">+ Splitsing</button></h3>
        <p class="small muted" style="margin:0 0 8px">Bv. een etentje van € 150: € 50 <em>Restaurant</em> (jouw deel) + 2 × € 50 <em>Voorschot</em> voor je vrienden. Een minteken telt in de andere richting (bv. afgehouden commissie).</p>
        <div id="splits">${splitRows}</div>
        <div class="small" id="split-remaining"></div>
      </div>

      <div class="section">
        <h3>Eigen rekening</h3>
        <select id="tx-transfer">
          <option value="auto" ${t.transferMode === 'auto' ? 'selected' : ''}>Automatisch herkennen (op IBAN)</option>
          <option value="yes" ${t.transferMode === 'yes' ? 'selected' : ''}>Ja: overschrijving tussen mijn eigen rekeningen</option>
          <option value="no" ${t.transferMode === 'no' ? 'selected' : ''}>Nee</option>
        </select>
      </div>

      ${t.amount > 0 || t.refundOf ? `<div class="section">
        <h3>Terugbetaling van een uitgave</h3>
        <p class="small muted" style="margin:0 0 8px">Boekte je de hele rekening als jouw uitgave en betaalt een vriend zijn deel terug? Koppel het hier: die uitgave wordt verminderd.</p>
        <select id="tx-refund" style="width:100%"><option value="">— Nee —</option>
          ${suggestions.map(s => `<option value="${esc(s.tx.id)}" ${t.refundOf === s.tx.id ? 'selected' : ''}>${fmtDate(s.tx.date)} · ${esc(s.tx.title || s.tx.counterparty || s.tx.description)} · ${money(s.tx.amount)}</option>`).join('')}
        </select></div>` : ''}

      ${refundedBy.length ? `<div class="section"><h3>Terugbetaald door</h3>${refundedBy.map(r => `<div class="small">${fmtDate(r.date)} · ${esc(r.counterparty || r.description)} · <span class="pos">${money(r.amount)}</span></div>`).join('')}
        <div class="small">Netto kost: <strong>${money(t.amount + refundedBy.reduce((s, r) => s + r.amount, 0))}</strong></div></div>` : ''}

      <div class="field"><span>Acties <span class="muted small">(bv. “Kleren — terug te krijgen van mama”)</span></span>
        <div class="tx-actions">${(t.actions || []).map(id => actionById(id)).filter(Boolean).map(a => `<span class="badge action-badge">🏷 ${esc(a.name)} <button type="button" class="chip-x" data-action="tx-action-remove" data-id="${esc(a.id)}" aria-label="Uit actie halen">✕</button></span>`).join('')}
          <select id="tx-action-add" aria-label="Aan een actie toevoegen"><option value="">+ Aan actie toevoegen…</option>${(state.actions || []).filter(a => !a.closed && !(t.actions || []).includes(a.id)).map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}<option value="__new__">+ Nieuwe actie…</option></select></div></div>
      <label class="field"><span>Notitie</span><textarea id="tx-note" rows="2">${esc(t.note || '')}</textarea></label>
      ${filesAvailable() ? `<div class="field"><span>📎 Bonnetjes <span class="muted small">(foto of pdf, bv. voor de garantie)</span></span>
        <div class="tx-files" id="tx-files">${(t.attachments || []).map(attachmentChip).join('')}</div>
        <label class="btn small file-add">+ Bonnetje toevoegen<input type="file" id="tx-file" accept="image/*,application/pdf" hidden></label>
        <span class="small muted" id="tx-file-status"></span></div>` : ''}
      <div class="errors" id="tx-errors"></div>`;
    const foot = `${!isNew ? '<button class="btn danger" data-action="delete-tx">Verwijderen</button>' : ''}
      ${!isNew && (t.counterparty || t.description) ? '<button class="btn" data-action="rule-from-tx">Regel maken…</button>' : ''}
      <span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>
      <button class="btn primary" data-action="save-tx">${isNew ? 'Toevoegen' : 'Opslaan'}</button>`;
    return modalShell(isNew ? 'Manuele transactie' : 'Transactie', body, foot);
  }

  function updateTxSections() {
    const sec = $('#sec-advance');
    if (!sec) return;
    const amount = C.parseAmount($('#tx-amount').value);
    sec.hidden = $('#tx-category').value !== C.SYS_ADVANCE;
    const incoming = amount > 0;
    $('#adv-title').textContent = incoming ? 'Terugbetaling van een voorschot' : 'Voorgeschoten voor iemand anders';
    $('#adv-person-label').textContent = incoming ? 'Van wie?' : 'Voor wie?';
    $('#adv-link-field').hidden = !incoming;
    $('#adv-help').textContent = incoming
      ? 'Telt niet als inkomen: het verkleint wat deze persoon je nog schuldig is.'
      : 'Telt niet als uitgave: het komt bij wat deze persoon je nog schuldig is. Betaalde je ook voor jezelf? Splits de betaling dan.';
    $$('#splits .split-row').forEach(row => { $('.split-person', row).hidden = $('.split-cat', row).value !== C.SYS_ADVANCE; });
  }

  function splitRow(s) {
    s = s || {};
    return `<div class="split-row">
      <select class="split-cat">${categoryOptions(s.categoryId, { emptyLabel: '— Categorie —', special: true })}</select>
      <input type="text" inputmode="decimal" class="split-amount" placeholder="0,00" value="${s.amount ? esc((s.opposite ? '-' : '') + C.centsToInput(s.amount)) : ''}">
      <input type="text" class="split-person" placeholder="voor wie?" list="people" value="${esc(s.person || '')}" ${s.categoryId === C.SYS_ADVANCE ? '' : 'hidden'}>
      <input type="text" class="split-note note" placeholder="notitie" value="${esc(s.note || '')}">
      <button class="btn small ghost" type="button" data-action="remove-split" aria-label="Verwijder splitsing">✕</button></div>`;
  }

  function readSplits(sign) {
    const dir = sign < 0 ? -1 : 1;
    return $$('#splits .split-row').map(row => {
      const amt = C.parseAmount($('.split-amount', row).value);
      const categoryId = $('.split-cat', row).value || null;
      const out = { categoryId, amount: isNaN(amt) ? 0 : amt * dir, note: $('.split-note', row).value.trim() };
      if (categoryId === C.SYS_ADVANCE) out.person = $('.split-person', row).value.trim();
      return out;
    }).filter(s => s.categoryId || s.amount);
  }

  function updateSplitRemaining() {
    const el = $('#split-remaining');
    if (!el) return;
    const amount = C.parseAmount($('#tx-amount').value);
    const splits = readSplits(amount);
    if (!splits.length || isNaN(amount)) { el.textContent = ''; return; }
    const used = Math.abs(splits.reduce((s, x) => s + x.amount, 0));
    const rest = Math.abs(amount) - used;
    el.innerHTML = rest < 0 ? `<span style="color:var(--red)">${money(-rest)} te veel verdeeld</span>`
      : `Verdeeld: ${money(used)} · rest ${money(rest)}${rest > 0 ? ' → ' + esc($('#tx-category').value ? catName($('#tx-category').value) : 'te verwerken') : ' ✓'}`;
  }

  function saveTx() {
    const t = modal.tx;
    const errors = [];
    const date = $('#tx-date').value;
    const amount = C.parseAmount($('#tx-amount').value);
    if (!C.parseDate(date)) errors.push('Geef een geldige datum.');
    if (isNaN(amount) || amount === 0) errors.push('Geef een geldig bedrag (bv. -12,50 voor een uitgave).');
    const splits = isNaN(amount) ? [] : readSplits(amount);
    const refundOf = $('#tx-refund') ? $('#tx-refund').value || null : null;
    const newCat = $('#tx-category').value || null;
    const person = $('#tx-person').value.trim();
    const advanceOf = newCat === C.SYS_ADVANCE && amount > 0 ? $('#tx-advance-of').value || null : null;
    if (refundOf && amount < 0) errors.push('Een terugbetaling moet een inkomend bedrag zijn.');
    if (newCat === C.SYS_ADVANCE && !splits.length && !person && !advanceOf) errors.push(amount < 0 ? 'Voor wie schoot je dit voor?' : 'Van wie kreeg je dit terug?');
    if (splits.some(s => s.categoryId === C.SYS_ADVANCE && !s.person)) errors.push('Geef bij elke voorschot-splitsing aan voor wie.');
    if (splits.length) errors.push(...C.validateSplits({ amount }, splits));
    if (errors.length) { $('#tx-errors').innerHTML = errors.map(esc).join('<br>'); return; }
    const linked = advanceOf ? C.advancesOverview(state).items.find(i => i.txId === advanceOf) : null;
    Object.assign(t, {
      date, amount, accountId: $('#tx-account').value,
      counterparty: $('#tx-counterparty').value.trim(), description: $('#tx-description').value.trim(),
      counterpartyIban: C.normalizeIban($('#tx-iban').value), transferMode: $('#tx-transfer').value,
      refundOf, splits, note: $('#tx-note').value.trim()
    });
    const title = $('#tx-title').value.trim();
    if (title) t.title = title; else delete t.title;
    if (newCat === C.SYS_ADVANCE) { t.person = person || (linked ? linked.person : ''); ensurePerson(t.person, t.amount > 0 ? t.counterpartyIban : ''); } else delete t.person;
    delete t.personByRule;
    for (const sp of t.splits || []) if (sp.person) ensurePerson(sp.person);
    if (advanceOf) t.advanceOf = advanceOf; else delete t.advanceOf;
    if (newCat !== t.categoryId || splits.length || t.categorySource !== 'manual') {
      t.categoryId = newCat;
      t.categorySource = newCat || splits.length ? 'manual' : null;
      t.ruleId = null;
    }
    if (newCat && t.isTransfer && t.transferMode === 'auto') t.transferMode = 'no';
    if (t.actions && !t.actions.length) delete t.actions;
    if (t.attachments && !t.attachments.length) delete t.attachments;
    const idx = state.transactions.findIndex(x => x.id === t.id);
    if (idx >= 0) state.transactions[idx] = t;
    else { t.createdAt = Date.now(); state.transactions.push(t); }
    closeModal();
    commit('Transactie opgeslagen');
  }

  function newTx(accountId) {
    return {
      id: C.uid('tx'), accountId: accountId || (state.accounts.find(a => a.type === 'cash') || state.accounts[0] || {}).id,
      date: today, amount: 0, counterparty: '', counterpartyIban: '', description: '',
      categoryId: null, categorySource: null, splits: [], source: 'manual', transferMode: 'auto', refundOf: null
    };
  }

  /** Inline koppeling vanuit een lijst. */
  function assignTx(id, value) {
    const t = txById(id);
    if (!t) return;
    if (value === 'new-cat') {
      render();
      openModal({ type: 'category', assignTo: t.id, category: { id: C.uid('cat'), name: '', kind: t.amount > 0 ? 'income' : 'expense', color: t.amount > 0 ? '#37b24d' : '#3b5bdb', lookupTags: '' } });
      return;
    }
    if (value === 'split' || value === 'refund' || value === 'cat:' + C.SYS_ADVANCE) {
      const copy = JSON.parse(JSON.stringify(t));
      if (value === 'cat:' + C.SYS_ADVANCE) { copy.categoryId = C.SYS_ADVANCE; if (copy.isTransfer) copy.transferMode = 'no'; }
      render(); // keuzelijst terugzetten tot er bewaard wordt
      openModal({ type: 'tx', tx: copy });
      if (value === 'split' && !copy.splits.length) actions['add-split']();
      if (value === 'cat:' + C.SYS_ADVANCE) { const p = $('#tx-person'); if (p) p.focus(); }
      if (value === 'refund') { const r = $('#tx-refund'); if (r) r.focus(); }
      return;
    }
    ui.ruleHint = null;
    if (value === 'whatis') { render(); openModal({ type: 'whatIs', txId: t.id, choice: null }); return; }
    if (value.startsWith('refund:')) { linkRefunds([t], value.slice(7)); return; }
    if (value.startsWith('adv:')) {
      markAdvance(t, value.slice(4));
      commit((t.amount > 0 ? 'Terugbetaling van ' : 'Voorschot voor ') + value.slice(4));
      return;
    }
    if (value === 'transfer') { t.transferMode = 'yes'; t.categoryId = null; t.categorySource = null; }
    else if (value === '') { t.categoryId = null; t.categorySource = null; if (t.transferMode === 'yes') t.transferMode = 'auto'; }
    else {
      t.categoryId = value.slice(4); t.categorySource = 'manual'; t.ruleId = null;
      if (t.isTransfer) t.transferMode = 'no';
      const hasRule = state.rules.some(r => r.categoryId === t.categoryId && C.ruleMatches(r, t));
      if (!hasRule && !t.categoryId.startsWith('sys_')) ui.ruleHint = { txId: t.id, categoryId: t.categoryId };
    }
    commit();
  }

  function ruleFromHint(id) {
    const t = txById(id);
    if (!t) return;
    const key = C.normalizeName(t.counterparty) || C.normalizeName(t.description);
    if (!key) return;
    state.rules.push({
      id: C.uid('rule'), name: t.counterparty || t.description.slice(0, 30), field: C.normalizeName(t.counterparty) ? 'counterparty' : 'any',
      operator: 'name', value: key, categoryId: t.categoryId, direction: t.amount < 0 ? 'out' : 'in', enabled: true,
      person: t.categoryId === C.SYS_ADVANCE && t.person && t.person !== 'Onbekend' ? t.person : null,
      priority: Math.max(0, ...state.rules.map(x => x.priority || 0)) + 10
    });
    ui.ruleHint = null;
    commit('Regel gemaakt: “' + (t.counterparty || t.description).slice(0, 30) + '” wordt voortaan vanzelf gekoppeld');
  }

