  // ----- Regel -----

  function ruleModal() {
    const r = modal.rule;
    const body = `
      <div class="form-grid">
        <label class="field full"><span>Naam</span><input type="text" id="rule-name" value="${esc(r.name)}"></label>
        <label class="field"><span>Als</span><select id="rule-field">${Object.entries(C.RULE_FIELDS).map(([k, v]) => `<option value="${k}" ${r.field === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Voorwaarde</span><select id="rule-operator">${Object.entries(C.RULE_OPERATORS).map(([k, v]) => `<option value="${k}" ${r.operator === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field full"><span>Waarde</span><input type="text" id="rule-value" value="${esc(r.value)}"></label>
        <label class="field"><span>Dan koppelen aan</span><select id="rule-category">${categoryOptions(r.categoryId, { special: true, emptyLabel: '— Geen categorie (enkel een actie) —' })}</select></label>
        <label class="field" id="rule-person-field" ${r.categoryId === C.SYS_ADVANCE ? '' : 'hidden'}><span>Voorschot voor / van wie?</span>
          <input type="text" id="rule-person" list="rule-people" value="${esc(r.person || '')}" placeholder="bv. Jan">
          <datalist id="rule-people">${C.personList(state).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></label>
        <label class="field"><span>Enkel voor</span><select id="rule-direction">
          <option value="any" ${!r.direction || r.direction === 'any' ? 'selected' : ''}>In- en uitgaand</option>
          <option value="out" ${r.direction === 'out' ? 'selected' : ''}>Uitgaand</option>
          <option value="in" ${r.direction === 'in' ? 'selected' : ''}>Inkomend</option></select></label>
        <label class="field"><span>Rekening</span><select id="rule-account"><option value="">Alle</option>${accountOptions(r.accountId)}</select></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="rule-enabled" ${r.enabled !== false ? 'checked' : ''}> Actief</label>
      </div>
      <div class="section rule-action">
        <label class="check"><input type="checkbox" id="rule-share-on" ${r.share ? 'checked' : ''}> <strong>🤝 Een deel is een voorschot voor iemand</strong> <span class="small muted">— bv. de helft van Telenet voor je huisgenoot; de rest blijft in de categorie hierboven</span></label>
        <div id="rule-share-fields" class="form-grid" ${r.share ? '' : 'hidden'} style="margin-top:8px">
          <label class="field"><span>Voor wie?</span><input type="text" id="rule-share-person" maxlength="40" list="rule-people" value="${esc((r.share && r.share.person) || '')}" placeholder="bv. huisgenoot"></label>
          <div class="field"><span>Welk deel?</span><span class="input-row"><input type="text" id="rule-share-value" inputmode="decimal" value="${esc(r.share ? String(r.share.mode === 'amount' ? (r.share.value / 100).toFixed(2) : r.share.value).replace('.', ',') : '50')}" style="max-width:110px">
            <select id="rule-share-mode"><option value="pct" ${!r.share || r.share.mode !== 'amount' ? 'selected' : ''}>% van het bedrag</option><option value="amount" ${r.share && r.share.mode === 'amount' ? 'selected' : ''}>€ vast bedrag</option></select></span></div>
        </div>
      </div>
      <div class="section rule-action">
        <label class="check"><input type="checkbox" id="rule-act-on" ${r.action ? 'checked' : ''}> <strong>✅ Ook aan een actie koppelen</strong> <span class="small muted">— bv. elke maand de Telenet-rekening terugvragen</span></label>
        <div id="rule-act-fields" class="form-grid" ${r.action ? '' : 'hidden'} style="margin-top:8px">
          <label class="field full"><span>Wat moet er gebeuren?</span><input type="text" id="rule-act-name" maxlength="60" value="${esc((r.action && r.action.name) || '')}" placeholder="bv. Telenet terugvragen"></label>
          <label class="check full"><input type="checkbox" id="rule-act-month" ${!r.action || r.action.perMonth ? 'checked' : ''}> Elke maand een nieuwe actie <span class="small muted">(bv. “Telenet terugvragen — okt 2026”), anders alles in één actie</span></label>
          <label class="check full"><input type="checkbox" id="rule-act-back" ${!r.action || r.action.expectBack ? 'checked' : ''}> Hier komt geld van terug <span class="small muted">— toon hoeveel nog open staat</span></label>
          <label class="field"><span>Van wie? <span class="muted small">(optioneel)</span></span><input type="text" id="rule-act-person" maxlength="40" list="rule-people" value="${esc((r.action && r.action.person) || '')}" placeholder="bv. werkgever, huisgenoot"></label>
          <label class="field"><span>Vanaf</span><select id="rule-act-since">
            ${(() => { const cur = r.action && r.action.since; const thisM = today.slice(0, 7) + '-01'; const prevM = C.addMonths(thisM, -1).slice(0, 10); return [[thisM, 'Deze maand'], [prevM, 'Vorige maand'], ['', 'Alle bestaande transacties']].map(([v, l]) => `<option value="${v}" ${(cur != null ? cur === v : v === prevM) ? 'selected' : ''}>${l}</option>`).join('') + (cur && cur !== thisM && cur !== prevM ? `<option value="${esc(cur)}" selected>Vanaf ${fmtDate(cur)}</option>` : ''); })()}</select></label>
        </div>
      </div>
      <div class="section"><h3>Voorbeeld</h3><div id="rule-preview" class="small"></div></div>
      <div class="errors" id="rule-errors"></div>`;
    const isNew = !state.rules.some(x => x.id === r.id);
    return modalShell(isNew ? 'Nieuwe regel' : 'Regel bewerken', body, `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="save-rule">Opslaan</button>`);
  }
  function readRuleForm() {
    const dir = $('#rule-direction').value;
    return Object.assign({}, modal.rule, {
      name: $('#rule-name').value.trim() || $('#rule-value').value.trim(), field: $('#rule-field').value, operator: $('#rule-operator').value,
      value: $('#rule-value').value.trim(), categoryId: $('#rule-category').value || null, direction: dir === 'any' ? null : dir,
      accountId: $('#rule-account').value || null, enabled: $('#rule-enabled').checked,
      person: $('#rule-category').value === C.SYS_ADVANCE ? ($('#rule-person').value.trim() || null) : null,
      share: $('#rule-share-on') && $('#rule-share-on').checked ? (() => {
        const mode = $('#rule-share-mode').value === 'amount' ? 'amount' : 'pct';
        const raw = mode === 'amount' ? C.parseAmount($('#rule-share-value').value) : parseFloat($('#rule-share-value').value.replace(',', '.'));
        return { person: $('#rule-share-person').value.trim(), mode, value: isFinite(raw) ? Math.abs(raw) : 0 };
      })() : null,
      action: $('#rule-act-on') && $('#rule-act-on').checked ? {
        name: $('#rule-act-name').value.trim(), perMonth: $('#rule-act-month').checked, expectBack: $('#rule-act-back').checked,
        person: $('#rule-act-person').value.trim(), since: $('#rule-act-since').value
      } : null
    });
  }
  function updateRulePreview() {
    const el = $('#rule-preview');
    if (!el) return;
    const pf = $('#rule-person-field');
    if (pf) pf.hidden = $('#rule-category').value !== C.SYS_ADVANCE;
    const sf = $('#rule-share-fields');
    if (sf) sf.hidden = !$('#rule-share-on').checked;
    const af = $('#rule-act-fields');
    if (af) af.hidden = !$('#rule-act-on').checked;
    const r = Object.assign(readRuleForm(), { enabled: true });
    if (!r.value) { el.innerHTML = '<span class="muted">Vul een waarde in.</span>'; return; }
    if (r.operator === 'regex') { try { new RegExp(r.value); } catch (e) { el.innerHTML = '<span style="color:var(--red)">Ongeldige reguliere expressie.</span>'; return; } }
    const m = state.transactions.filter(t => !t.isTransfer && C.ruleMatches(r, t));
    el.innerHTML = `<strong>${m.length}</strong> transactie(s) komen overeen. ` + m.slice(0, 6).map(t => `<div class="muted">${fmtDate(t.date)} · ${esc(t.title ? t.title + ' (' + t.counterparty + ')' : t.counterparty)} · ${esc(t.description).slice(0, 50)} · ${money(t.amount)}</div>`).join('');
  }
  function saveRule() {
    const r = readRuleForm();
    const errors = [];
    if (!r.value) errors.push('Geef een waarde.');
    if (!r.categoryId && !r.action && !r.share) errors.push('Kies waaraan te koppelen, of zet een voorschot of actie aan.');
    if (r.share && !r.share.person) errors.push('Zeg voor wie het voorschot is.');
    if (r.share && !(r.share.value > 0)) errors.push('Geef het deel dat een voorschot is (bv. 50 %).');
    if (r.share && r.share.mode !== 'amount' && r.share.value > 100) errors.push('Een deel kan hoogstens 100 % zijn.');
    if (r.share && r.categoryId === C.SYS_ADVANCE) errors.push('Kies voor de rest een gewone categorie (bv. Internet), of laat de categorie leeg.');
    if (!r.share) delete r.share;
    if (r.action && !r.action.name) errors.push('Schrijf wat er moet gebeuren (de naam van de actie).');
    if (!r.action) delete r.action;
    if (r.operator === 'regex') { try { new RegExp(r.value); } catch (e) { errors.push('Ongeldige reguliere expressie.'); } }
    if (errors.length) { $('#rule-errors').innerHTML = errors.join('<br>'); return; }
    const idx = state.rules.findIndex(x => x.id === r.id);
    if (idx >= 0) state.rules[idx] = r;
    else { r.priority = Math.max(0, ...state.rules.map(x => x.priority || 0)) + 10; state.rules.push(r); }
    if (r.person) ensurePerson(r.person);
    if (r.share) ensurePerson(r.share.person);
    // Een nieuwe of aangepaste regel mag ook de transacties invullen die eerder bewust leeg gemaakt werden.
    for (const t of state.transactions) if (t.categorySource === 'manual' && !t.categoryId && C.ruleMatches(r, t)) t.categorySource = null;
    // Transacties die je al zelf indeelde: enkel als je dat wil (bv. om ook de vorige Telenet-rekeningen te splitsen)
    if (r.categoryId || r.share) {
      const since = r.action && r.action.since ? r.action.since : '';
      const own = state.transactions.filter(t => t.categorySource === 'manual' && t.categoryId && !t.isTransfer && !t.refundOf && !(t.splits && t.splits.length) && t.date >= since && C.ruleMatches(r, t)
        && (t.categoryId !== r.categoryId || r.share));
      if (own.length && confirm(`${own.length} transactie${own.length === 1 ? '' : 's'} die bij deze regel past${own.length === 1 ? '' : 'sen'}, deelde je al zelf in${since ? ' (vanaf ' + fmtDate(since) + ')' : ''}.\n\nOok daarop deze regel toepassen${r.share ? ' (met het voorschot voor ' + r.share.person + ')' : ''}?`)) {
        for (const t of own) { t.categorySource = null; t.categoryId = null; t.ruleId = null; }
      }
    }
    closeModal();
    commit('Regel opgeslagen');
  }
  function moveRule(id) {
    const rules = C.sortedRules(state.rules);
    rules.forEach((r, i) => { r.priority = (i + 1) * 10; });
    const i = rules.findIndex(r => r.id === id);
    if (i <= 0) return;
    [rules[i].priority, rules[i - 1].priority] = [rules[i - 1].priority, rules[i].priority];
    commit();
  }

