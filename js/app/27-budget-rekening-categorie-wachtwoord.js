  // ----- Budget, rekening, categorie, wachtwoord -----

  function budgetModal() {
    const b = modal.budget;
    const isNew = !state.budgets.some(x => x.id === b.id);
    const body = `<div class="form-grid">
        <label class="field full"><span>Categorie</span><select id="bud-category">${categoryOptions(b.categoryId, { kind: 'expense' })}</select></label>
        <label class="field"><span>Periode</span><select id="bud-period"><option value="monthly" ${b.period !== 'yearly' ? 'selected' : ''}>Per maand</option><option value="yearly" ${b.period === 'yearly' ? 'selected' : ''}>Per jaar</option></select></label>
        <label class="field"><span>Limiet (€)</span><input type="text" inputmode="decimal" id="bud-limit" value="${b.limit ? esc(C.centsToInput(b.limit)) : ''}"></label>
        <label class="field"><span>Waarschuwen vanaf (%)</span><input type="number" min="1" max="100" id="bud-warn" value="${Math.round((b.warnAt != null ? b.warnAt : 0.8) * 100)}"></label>
      </div><div class="errors" id="bud-errors"></div>`;
    return modalShell(isNew ? 'Nieuw budget' : 'Budget', body, `${!isNew ? '<button class="btn danger" data-action="delete-budget">Verwijderen</button>' : ''}<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="save-budget">Opslaan</button>`);
  }
  function saveBudget() {
    const b = modal.budget;
    const categoryId = $('#bud-category').value, period = $('#bud-period').value;
    const limit = Math.abs(C.parseAmount($('#bud-limit').value)), warn = Number($('#bud-warn').value);
    const errors = [];
    if (!categoryId) errors.push('Kies een categorie.');
    if (!limit || isNaN(limit)) errors.push('Geef een geldige limiet.');
    if (!(warn >= 1 && warn <= 100)) errors.push('Drempel tussen 1 en 100%.');
    if (state.budgets.some(x => x.id !== b.id && x.categoryId === categoryId && x.period === period)) errors.push('Er bestaat al zo een budget.');
    if (errors.length) { $('#bud-errors').innerHTML = errors.join('<br>'); return; }
    const updated = Object.assign({}, b, { categoryId, period, limit, warnAt: warn / 100 });
    const idx = state.budgets.findIndex(x => x.id === b.id);
    if (idx >= 0) state.budgets[idx] = updated; else state.budgets.push(updated);
    closeModal();
    commit('Budget opgeslagen');
  }

  function accountModal() {
    const a = modal.account;
    const bal = C.accountBalance(state, a.id);
    const body = `<div class="form-grid">
      <label class="field"><span>Naam</span><input type="text" id="acc-name" value="${esc(a.name)}"></label>
      <label class="field"><span>Soort</span><select id="acc-type">${[['zicht', 'Zichtrekening'], ['spaar', 'Spaarrekening'], ['cash', 'Cash'], ['krediet', 'Kredietkaart'], ['andere', 'Andere']].map(([v, l]) => `<option value="${v}" ${a.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field full"><span>IBAN</span><input type="text" id="acc-iban" value="${esc(C.formatIban(a.iban))}" placeholder="BE00 0000 0000 0000"></label>
      <label class="field"><span>Gekend saldo (€)</span><input type="text" inputmode="decimal" id="acc-bal" value="${a.balance ? esc((a.balance.amount < 0 ? '-' : '') + C.centsToInput(a.balance.amount)) : ''}" placeholder="bv. 1.250,00"></label>
      <label class="field"><span>op datum (na alle transacties van die dag)</span><input type="date" id="acc-bal-date" value="${esc(a.balance ? a.balance.date : today)}"></label>
      <p class="small muted full">${bal ? 'Huidig saldo volgens Helder: <strong>' + money(bal.amount) + '</strong>. ' : ''}Bij KBC-bestanden wordt het saldo automatisch uit de saldokolom gehaald; bij Argenta geef je het hier één keer in.</p>
      </div><div class="errors" id="acc-errors"></div>`;
    return modalShell(acc(a.id) ? 'Rekening' : 'Nieuwe rekening', body, `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="save-account">Opslaan</button>`);
  }
  function saveAccount() {
    const a = modal.account;
    const name = $('#acc-name').value.trim();
    const iban = C.normalizeIban($('#acc-iban').value);
    if (!name) { $('#acc-errors').textContent = 'Geef een naam.'; return; }
    if (iban && state.accounts.some(x => x.id !== a.id && C.normalizeIban(x.iban) === iban)) { $('#acc-errors').textContent = 'Deze IBAN hoort al bij een andere rekening.'; return; }
    const updated = Object.assign({}, a, { name, iban, type: $('#acc-type').value });
    const balText = $('#acc-bal').value.trim();
    if (balText) {
      const amt = C.parseAmount(balText);
      if (isNaN(amt)) { $('#acc-errors').textContent = 'Ongeldig saldo.'; return; }
      updated.balance = { amount: amt, date: $('#acc-bal-date').value || today, source: 'manual' };
    } else delete updated.balance;
    const idx = state.accounts.findIndex(x => x.id === a.id);
    if (idx >= 0) state.accounts[idx] = updated; else state.accounts.push(updated);
    closeModal();
    commit('Rekening opgeslagen');
  }

  function categoryModal() {
    const c = modal.category;
    const kind = c.kind === 'income' ? 'income' : c.incomeId ? 'incomeCost' : 'expense';
    const incomes = incomeSources().filter(x => x.id !== c.id);
    const body = `<div class="form-grid">
      <label class="field"><span>Naam</span><input type="text" id="cat-name" value="${esc(c.name)}"></label>
      <label class="field"><span>Kleur</span><input type="color" id="cat-color" value="${esc(c.color || '#3b5bdb')}"></label>
      <div class="field full"><span>Symbool</span>
        <div class="icon-pick"><input type="text" id="cat-icon" value="${esc(C.categoryIcon(c))}" maxlength="8" aria-label="Symbool" autocomplete="off">
          <div class="icon-choices">${C.ICON_CHOICES.map(i => `<button type="button" class="icon-choice ${C.categoryIcon(c) === i ? 'active' : ''}" data-action="pick-icon" data-icon="${i}" aria-label="${i}">${i}</button>`).join('')}</div></div>
        <span class="small muted" style="font-weight:normal">Kies er een, of typ zelf een emoji.</span></div>
      <label class="field full"><span>Soort</span><select id="cat-kind">
        <option value="expense" ${kind === 'expense' ? 'selected' : ''}>Uitgave</option>
        <option value="income" ${kind === 'income' ? 'selected' : ''}>Inkomstenbron</option>
        <option value="incomeCost" ${kind === 'incomeCost' ? 'selected' : ''} ${incomes.length ? '' : 'disabled'}>Kost die van een inkomstenbron wordt afgetrokken</option></select></label>
      <label class="field full" id="cat-income-field" ${kind === 'incomeCost' ? '' : 'hidden'}><span>Aftrekken van</span><select id="cat-income">${incomes.map(x => `<option value="${esc(x.id)}" ${c.incomeId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field full"><span>Zoekwoorden voor online opzoeken</span><textarea id="cat-tags" rows="3">${esc(c.lookupTags || '')}</textarea>
        <span class="small muted" style="font-weight:normal">Soort zaak, geen merknamen (bv. "supermarket, bakkerij").</span></label>
      </div><div class="errors" id="cat-errors"></div>`;
    return modalShell(cat(c.id) ? 'Categorie' : 'Nieuwe categorie', body, `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="save-category">Opslaan</button>`);
  }
  function saveCategory() {
    const c = modal.category;
    const name = $('#cat-name').value.trim();
    if (!name) { $('#cat-errors').textContent = 'Geef een naam.'; return; }
    if (state.categories.some(x => x.id !== c.id && x.name.toLowerCase() === name.toLowerCase())) { $('#cat-errors').textContent = 'Bestaat al.'; return; }
    const kind = $('#cat-kind').value;
    if (kind !== 'income' && state.categories.some(x => x.incomeId === c.id)) { $('#cat-errors').textContent = 'Er zijn kostcategorieën aan deze bron gekoppeld.'; return; }
    const updated = Object.assign({}, c, { name, color: $('#cat-color').value, kind: kind === 'income' ? 'income' : 'expense', lookupTags: $('#cat-tags').value.trim() });
    const icon = $('#cat-icon').value.trim();
    if (icon && icon !== C.categoryIcon(Object.assign({}, updated, { icon: '' }))) updated.icon = icon; else delete updated.icon;
    if (kind === 'incomeCost') updated.incomeId = $('#cat-income').value; else delete updated.incomeId;
    const idx = state.categories.findIndex(x => x.id === c.id);
    if (idx >= 0) state.categories[idx] = updated; else state.categories.push(updated);
    // Aangemaakt vanuit een transactie: die meteen koppelen
    const t = modal.assignTo ? txById(modal.assignTo) : null;
    if (t) { t.categoryId = updated.id; t.categorySource = 'manual'; t.ruleId = null; if (t.isTransfer) t.transferMode = 'no'; ui.ruleHint = { txId: t.id, categoryId: updated.id }; }
    closeModal();
    commit(idx < 0 ? (updated.kind === 'income' ? 'Inkomstenbron' : 'Categorie') + ' “' + updated.name + '” aangemaakt' : 'Opgeslagen');
  }

  function passwordModal() {
    return modalShell('Wachtwoord wijzigen', `<div class="form-stack">
      <label class="field"><span>Huidig wachtwoord</span><input type="password" id="pw-current" autocomplete="current-password"></label>
      <label class="field"><span>Nieuw (min. 8 tekens)</span><input type="password" id="pw-new" autocomplete="new-password"></label>
      <label class="field"><span>Herhaal</span><input type="password" id="pw-new2" autocomplete="new-password"></label>
      <div class="errors" id="pw-errors"></div></div>`, `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="save-password">Wijzigen</button>`);
  }
  async function savePassword() {
    const cur = $('#pw-current').value, a = $('#pw-new').value, b = $('#pw-new2').value;
    if (a !== b) { $('#pw-errors').textContent = 'De nieuwe wachtwoorden zijn niet gelijk.'; return; }
    try { await Sync.changePassword(cur, a); closeModal(); toast('Wachtwoord gewijzigd'); } catch (e) { $('#pw-errors').textContent = e.message; }
  }

