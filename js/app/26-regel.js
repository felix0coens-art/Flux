  // ----- Regel -----

  function ruleModal() {
    const r = modal.rule;
    const body = `
      <div class="form-grid">
        <label class="field full"><span>Naam</span><input type="text" id="rule-name" value="${esc(r.name)}"></label>
        <label class="field"><span>Als</span><select id="rule-field">${Object.entries(C.RULE_FIELDS).map(([k, v]) => `<option value="${k}" ${r.field === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Voorwaarde</span><select id="rule-operator">${Object.entries(C.RULE_OPERATORS).map(([k, v]) => `<option value="${k}" ${r.operator === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field full"><span>Waarde</span><input type="text" id="rule-value" value="${esc(r.value)}"></label>
        <label class="field"><span>Dan koppelen aan</span><select id="rule-category">${categoryOptions(r.categoryId, { special: true })}</select></label>
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
      person: $('#rule-category').value === C.SYS_ADVANCE ? ($('#rule-person').value.trim() || null) : null
    });
  }
  function updateRulePreview() {
    const el = $('#rule-preview');
    if (!el) return;
    const pf = $('#rule-person-field');
    if (pf) pf.hidden = $('#rule-category').value !== C.SYS_ADVANCE;
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
    if (!r.categoryId) errors.push('Kies waaraan te koppelen.');
    if (r.operator === 'regex') { try { new RegExp(r.value); } catch (e) { errors.push('Ongeldige reguliere expressie.'); } }
    if (errors.length) { $('#rule-errors').innerHTML = errors.join('<br>'); return; }
    const idx = state.rules.findIndex(x => x.id === r.id);
    if (idx >= 0) state.rules[idx] = r;
    else { r.priority = Math.max(0, ...state.rules.map(x => x.priority || 0)) + 10; state.rules.push(r); }
    if (r.person) ensurePerson(r.person);
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

