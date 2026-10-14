  // ---------- Events ----------

  const actions = {
    'goto': el => go(el.dataset.view),
    'range-preset': el => { ui.range = presetRange(el.dataset.preset, timelineMonths()); render(); },
    'import': el => openModal({ type: 'import', accountHint: (el && el.dataset.account) || '' }),
    'import-restart': () => openModal({ type: 'import', accountHint: modal.accountHint }),
    'do-import': doImport,
    'show-import': el => openModal({ type: 'importView', id: el.dataset.id }),
    'undo-import': el => {
      const i = imp(el.dataset.id);
      if (!i) return;
      const n = state.transactions.filter(t => t.importId === i.id).length;
      if (!confirm(`Import “${i.fileName}” ongedaan maken?\n\nDe ${n} transacties uit dit bestand worden verwijderd, ook als je ze al koppelde. Je kan het bestand daarna opnieuw opladen.`)) return;
      Banks.undo(state, i.id);
      closeModal();
      commit(`Import ongedaan gemaakt: ${n} transacties verwijderd`);
    },
    'cancel-link': el => {
      const p = C.cancellationPairs(state).find(x => x.income.id === el.dataset.in && x.expense.id === el.dataset.out);
      if (p) linkCancellations([p]);
    },
    'cancel-link-all': () => { const list = C.cancellationPairs(state); if (list.length && confirm(`${list.length} inkomsten koppelen aan de uitgave met hetzelfde bedrag?`)) linkCancellations(list); },
    'cancel-dismiss': el => {
      const t = txById(el.dataset.in);
      if (!t) return;
      t.notRefundOf = (t.notRefundOf || []).concat([el.dataset.out]);
      commit();
    },
    'bank-filter': el => { ui.bank.account = ui.bank.account === el.dataset.id ? '' : el.dataset.id; ui.bank.status = ''; render(); },
    'bank-status': el => { ui.bank.status = el.dataset.status; ui.bank.limit = 150; render(); },
    'list-status': el => { ui.list.status = el.dataset.status; ui.list.limit = 150; render(); },
    'more': el => { (el.dataset.key === 'bank' ? ui.bank : ui.list).limit += 300; render(); },
    'new-tx': el => openModal({ type: 'tx', tx: newTx(el && el.dataset.account) }),
    'bulk-delete': bulkDelete,
    'auth-register': () => { ui.auth = Object.assign({}, ui.auth, { register: true, error: '' }); render(); },
    'auth-login': () => { ui.auth = Object.assign({}, ui.auth, { register: false, error: '' }); render(); },
    'trash-restore': el => { const n = Banks.restoreDeleted(state, [el.dataset.id]); commit(n ? 'Transactie teruggezet' : 'Niets teruggezet'); },
    'trash-restore-all': () => { const ids = (state.deleted || []).filter(d => !d.hidden).map(d => d.id); const n = Banks.restoreDeleted(state, ids); commit(n + ' transacties teruggezet'); },
    'trash-empty': () => {
      const n = (state.deleted || []).filter(d => !d.hidden).length;
      if (!confirm(`Prullenbak leegmaken?\n\nDe ${n} transacties kan je daarna niet meer terugzetten. Wat uit een bankbestand kwam, blijft wel overgeslagen bij een nieuwe import.`)) return;
      // De herkenning blijft (zodat ze niet terugkomen), enkel de kopie verdwijnt
      state.deleted = (state.deleted || []).filter(d => !d.manual).map(d => { const c = Object.assign({}, d, { hidden: true }); delete c.tx; return c; });
      commit('Prullenbak leeggemaakt');
    },
    'delete-account': async () => {
      const t = prompt('Je account en al je gegevens worden definitief gewist. Typ VERWIJDER om te bevestigen.');
      if (t !== 'VERWIJDER') { if (t != null) toast('Niet verwijderd: typ VERWIJDER in hoofdletters.'); return; }
      try { await Sync.deleteAccount(); } catch (e) { toast(e.message); return; }
      Store.clear();
      realState = Store.defaultState();
      state = realState;
      snap = C.snapshot(realState);
      ui.auth = { setupRequired: false, auth: Sync.auth || {} };
      render();
      toast('Je account is verwijderd.');
    },
    'admin-refresh': () => loadAdmin(),
    'admin-reg': async el => {
      const open = el.dataset.open === '1';
      el.disabled = true;
      try { await Sync.admin.setRegistration(open); toast(open ? 'Nieuwe accounts zijn nu toegelaten' : 'Nieuwe accounts zijn nu gesloten'); }
      catch (e) { toast('Lukte niet: ' + e.message); }
      loadAdmin();
    },
    'ai-key-remove': async () => {
      if (!confirm('Je eigen API-sleutel verwijderen uit Helder?')) return;
      try { await Sync.aiKey.remove(); await Sync.refreshFeatures(); aiKeyUi.status = await Sync.aiKey.status(); toast('Sleutel verwijderd'); } catch (e) { toast(e.message); }
      render();
    },
    'admin-bank-shared': async el => {
      const on = el.dataset.on === '1';
      if (on && !confirm('De Enable Banking-app van de eigenaar delen met alle gebruikers?\n\nDoe dit enkel als je een contract met Enable Banking hebt om je app voor andere mensen te gebruiken. In de gratis "restricted" modus werkt de app enkel voor je eigen rekeningen.')) return;
      try { await Sync.admin.setSite({ bankShared: on }); toast(on ? 'Bankapp gedeeld met alle gebruikers' : 'Elke gebruiker gebruikt zijn eigen bankapp'); } catch (e) { toast('Lukte niet: ' + e.message); }
      loadAdmin();
    },
    'admin-signup': async el => {
      const on = el.dataset.on === '1';
      const what = el.dataset.key === 'signupGoogle' ? 'met Google' : 'met gebruikersnaam en wachtwoord';
      el.disabled = true;
      try { await Sync.admin.setSite({ [el.dataset.key]: on }); toast(`Nieuwe accounts ${what}: ${on ? 'aan' : 'uit'}`); }
      catch (e) { toast('Lukte niet: ' + e.message); }
      loadAdmin();
    },
    'admin-user': async el => {
      const u = ui.admin.data.users.find(x => x.user === el.dataset.user);
      const op = el.dataset.op;
      if (op === 'delete' && !confirm(`Account van ${u.displayName} (${u.email || u.user}) verwijderen?\n\nDe gegevens worden als back-up bewaard op de server (helder-data/backups), maar de gebruiker kan niet meer aanmelden.`)) return;
      if (op === 'disable' && !confirm(`${u.displayName} blokkeren? Die wordt meteen afgemeld en kan niet meer aanmelden tot je deblokkeert.`)) return;
      try { await Sync.admin.user(u.user, op); toast('Bijgewerkt'); } catch (e) { toast(e.message); }
      loadAdmin();
    },
    'person-new': () => openModal({ type: 'person', person: { name: '', ibans: [] } }),
    'owed-filter': el => { ui.owed = el.dataset.f; render(); },
    'owed-new': () => openModal({ type: 'owedNew' }),
    'person-edit': el => { const e = personEntity(el.dataset.person); openModal({ type: 'person', original: el.dataset.person, person: e ? Object.assign({}, e) : { name: el.dataset.person, ibans: [] } }); },
    'person-save': savePerson,
    'person-delete': () => { state.people = (state.people || []).filter(p => p.name.toLowerCase() !== modal.original.toLowerCase()); closeModal(); commit('Persoon verwijderd'); },
    'adv-accept': el => { const t = txById(el.dataset.id); if (!t) return; markAdvance(t, el.dataset.person); commit('Terugbetaling van ' + el.dataset.person + ' gekoppeld'); },
    'adv-pick': el => openModal({ type: 'advPick', person: el.dataset.person || '', askPerson: !el.dataset.person, dir: el.dataset.dir, chosen: new Set(), search: '' }),
    'adv-pick-apply': () => {
      const m = modal;
      if (m.askPerson) m.person = ($('#adv-person') ? $('#adv-person').value : m.person || '').trim();
      if (!m.person) { const i = $('#adv-person'); if (i) { i.focus(); i.classList.add('invalid'); } toast('Geef eerst de naam van de persoon.'); return; }
      for (const id of m.chosen) { const t = txById(id); if (t) { markAdvance(t, m.person); if (m.advanceOf) t.advanceOf = m.advanceOf; } }
      closeModal();
      commit(`${m.chosen.size} ${m.dir === 'out' ? 'voorschot(ten) voor' : 'terugbetaling(en) van'} ${m.person} gekoppeld`);
      // Eén nieuw voorschot zonder titel: meteen om een titel vragen
      const only = m.dir === 'out' && m.chosen.size === 1 ? txById(Array.from(m.chosen)[0]) : null;
      if (only && !only.title) openModal({ type: 'advTitle', key: only.id });
    },
    'adv-title': el => openModal({ type: 'advTitle', key: el.dataset.key }),
    'adv-title-save': saveAdvTitle,
    'adv-item-tx': el => {
      const it = advItem(el.dataset.key);
      if (!it) return;
      openModal({ type: 'advPick', person: it.person, dir: 'in', advanceOf: el.dataset.key, forItem: it.title || it.counterparty || 'dit voorschot', left: it.amount - it.repaid, chosen: new Set(), search: '' });
    },
    'adv-item-cash': el => {
      const it = advItem(el.dataset.key);
      if (!it) return;
      const left = it.amount - it.repaid;
      const name = it.title || it.counterparty || 'dit voorschot';
      const cash = state.accounts.find(a => a.type === 'cash');
      if (!confirm(`${it.person} betaalde ${money(left)} voor “${name}” terug in cash?\n\nHelder maakt een terugbetaling aan${cash ? ' op je rekening “' + cash.name + '”' : ''}.`)) return;
      const t = Object.assign(newTx(cash && cash.id), { amount: left, counterparty: it.person, description: 'Terugbetaald in cash', title: 'Cash: ' + name, advanceOf: el.dataset.key });
      markAdvance(t, it.person);
      state.transactions.push(t);
      commit(`“${name}” is terugbetaald in cash`);
    },
    'adv-item-forgive': el => {
      const it = advItem(el.dataset.key);
      if (!it) return;
      openModal({ type: 'forgive', person: it.person, advanceOf: el.dataset.key, max: it.amount - it.repaid, title: it.title || '' });
    },
    'adv-cash': el => {
      const p = C.personList(state).find(x => x.name === el.dataset.person);
      if (!p || p.stats.open <= 0) return;
      const cash = state.accounts.find(a => a.type === 'cash');
      if (!confirm(`${p.name} betaalde ${money(p.stats.open)} terug in cash?\n\nHelder maakt een terugbetaling aan${cash ? ' op je rekening “' + cash.name + '”' : ''}, zodat alles op nul staat.`)) return;
      const t = Object.assign(newTx(cash && cash.id), { amount: p.stats.open, counterparty: p.name, description: 'Terugbetaald in cash' });
      markAdvance(t, p.name);
      state.transactions.push(t);
      commit(p.name + ' heeft alles terugbetaald');
    },
    'trim-before': () => {
      const from = state.settings.dataFrom;
      const n = state.transactions.filter(t => t.source === 'import' && t.date < from).length;
      if (!from || !confirm(`${n} transacties van vóór ${fmtDate(from)} weghalen?

Zet je de startdatum later vroeger, dan komen ze bij een nieuwe import gewoon terug.`)) return;
      Banks.trimBefore(state, from);
      commit(n + ' oudere transacties weggehaald');
    },
    'align-start': el => {
      const d = el.dataset.date;
      const n = state.transactions.filter(t => t.source === 'import' && t.date < d).length;
      if (!confirm(`Alle banken laten starten op ${fmtDate(d)}?

${n} oudere transacties worden weggehaald (ze komen terug als je de startdatum later vroeger zet en opnieuw importeert).`)) return;
      state.settings = Object.assign({}, state.settings, { dataFrom: d });
      Banks.trimBefore(state, d);
      commit('Alle banken starten nu op ' + fmtDate(d));
    },
    'pick-icon': el => { $('#cat-icon').value = el.dataset.icon; $$('.icon-choice').forEach(b => b.classList.toggle('active', b === el)); },
    'bulk-clear': () => { ui.selected.clear(); render(); },
    'bank-setup': () => { openModal({ type: 'bankSetup', appId: (bankLink.status && bankLink.status.appId) || '' }); },
    'bank-connect': () => { openModal({ type: 'bankConnect', country: 'BE' }); loadAspsps(); },
    'bank-start': el => startBankConnect(el.dataset.name, modal.country, Number(el.dataset.days) || undefined),
    'bank-renew': el => { const c = bankLink.status.connections.find(x => x.id === el.dataset.id); if (c) startBankConnect(c.aspsp, c.country); },
    'bank-fetch': el => { const c = bankLink.status.connections.find(x => x.id === el.dataset.id); if (c) fetchLinked(c); },
    'bank-disconnect': async el => {
      const c = bankLink.status.connections.find(x => x.id === el.dataset.id);
      if (!c || !confirm(`Koppeling met ${c.aspsp} verbreken?\n\nHelder haalt dan geen nieuwe transacties meer op. Wat al in Helder zit, blijft staan.`)) return;
      try { await Sync.bank.disconnect(c.id); toast('Koppeling verbroken'); } catch (e) { toast(e.message); }
      loadBankLink();
    },
    'bank-remove-config': async () => {
      if (!confirm('De instelling van Enable Banking verwijderen? Je bankkoppelingen werken dan niet meer tot je ze opnieuw instelt.')) return;
      try { await Sync.bank.removeConfig(); closeModal(); toast('Instelling verwijderd'); } catch (e) { toast(e.message); }
      loadBankLink();
    },
    'bank-retry-aspsps': () => loadAspsps(),
    'house-invite': async () => { try { const r = await Sync.household.invite(); houseUi.code = r.code; houseUi.error = ''; } catch (e) { houseUi.error = e.message; } render(); },
    'house-leave': async () => {
      if (!confirm('Het huishouden verlaten? Je ziet dan weer je eigen gegevens. Wat in de gedeelde boekhouding staat, blijft daar.')) return;
      houseUi.busy = true; render();
      try { houseUi.status = await Sync.household.leave(); toast('Je werkt weer in je eigen boekhouding'); } catch (e) { houseUi.error = e.message; }
      houseUi.busy = false; render();
    },
    'house-remove': async el => {
      if (!confirm('Deze persoon uit je huishouden halen? Die ziet dan weer zijn eigen gegevens.')) return;
      try { houseUi.status = await Sync.household.leave(el.dataset.user); toast('Verwijderd uit je huishouden'); } catch (e) { toast(e.message); }
      render();
    },
    'tx-file-remove': async el => {
      const t = modal && modal.tx;
      if (!t || !confirm('Dit bonnetje verwijderen?')) return;
      const id = el.dataset.id;
      t.attachments = (t.attachments || []).filter(f => f.id !== id);
      el.closest('.file-chip').remove();
      // Was de transactie al bewaard met dit bonnetje? Dan meteen ook daar weghalen
      const saved = txById(t.id);
      if (saved && (saved.attachments || []).some(f => f.id === id)) { saved.attachments = saved.attachments.filter(f => f.id !== id); if (!saved.attachments.length) delete saved.attachments; commit(); }
      try { await Sync.files.remove(id); } catch (e) { /* bestand blijft op de server; niet erg */ }
    },
    'tax-open': () => openModal({ type: 'taxYear', year: '' }),
    'tax-csv': taxCsv,
    'search-open': () => { openModal({ type: 'search', q: '' }); const i = $('#global-search'); if (i) i.focus(); },
    'what-is': el => openModal({ type: 'whatIs', txId: el.dataset.id, choice: null }),
    'wi-choose': el => { modal.choice = modal.choice === el.dataset.choice ? null : el.dataset.choice; renderModal(); },
    'wi-apply': () => {
      const t = txById(modal.txId); const v = $('#wi-cat').value;
      if (!t || !v) { toast('Kies een soort inkomen.'); return; }
      t.categoryId = v; t.categorySource = 'manual'; t.ruleId = null; if (t.isTransfer) t.transferMode = 'no';
      whatIsDone('Ingedeeld als ' + catName(v));
    },
    'wi-newcat': () => { const t = txById(modal.txId); closeModal(); if (t) assignTx(t.id, 'new-cat'); },
    'wi-refund': el => { const t = txById(modal.txId); closeModal(); if (t) linkRefunds([t], el.dataset.id); },
    'wi-refund-other': () => { const t = txById(modal.txId); closeModal(); if (t) assignTx(t.id, 'refund'); },
    'wi-advance': () => {
      const t = txById(modal.txId); const name = $('#wi-person').value.trim();
      if (!t) return;
      if (!name) { toast('Geef de naam van wie terugbetaalt.'); return; }
      markAdvance(t, name);
      whatIsDone('Terugbetaling van ' + name + ' gekoppeld');
    },
    'wi-action': () => {
      const t = txById(modal.txId); if (!t) return;
      let id = $('#wi-action').value;
      const catId = $('#wi-action-cat').value;
      if (id === '__new__') {
        const name = (prompt('Naam van de nieuwe actie (bv. “Kleren voor mama”)') || '').trim();
        if (!name) return;
        const a = { id: C.uid('act'), name, expectBack: true, person: '', note: '', createdAt: new Date().toISOString() };
        state.actions = (state.actions || []).concat([a]); id = a.id;
      }
      addToAction([t.id], id);
      if (catId) { t.categoryId = catId; t.categorySource = 'manual'; t.ruleId = null; }
      whatIsDone('Toegevoegd aan “' + (actionById(id) || {}).name + '”');
    },
    'wi-transfer': () => { const t = txById(modal.txId); if (!t) return; t.transferMode = 'yes'; t.categoryId = null; t.categorySource = null; whatIsDone('Aangeduid als overschrijving van een eigen rekening'); },
    'action-new': () => openModal({ type: 'action', isNew: true, edit: { id: C.uid('act'), name: '', expectBack: true, person: '', note: '' } }),
    'action-edit': el => { const a = actionById(el.dataset.id); if (a) openModal({ type: 'action', edit: Object.assign({}, a) }); },
    'action-save': saveAction,
    'action-delete': () => {
      const a = modal.edit;
      if (!confirm(`De actie “${a.name}” verwijderen? De transacties zelf blijven gewoon staan.`)) return;
      state.actions = (state.actions || []).filter(x => x.id !== a.id);
      closeModal();
      commit('Actie verwijderd');
    },
    'action-close': el => { const a = actionById(el.dataset.id); if (!a) return; a.closed = el.dataset.closed === '1'; commit(a.closed ? `“${a.name}” afgerond` : `“${a.name}” heropend`); if (modal && modal.type === 'actionView') renderModal(); },
    'action-view': (el, ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); openModal({ type: 'actionView', id: el.dataset.id }); },
    'action-add-tx': el => openModal({ type: 'actionPick', id: el.dataset.id, chosen: new Set(), search: '' }),
    'action-pick-apply': () => { const m = modal; const n = addToAction(m.chosen, m.id); closeModal(); commit(`${n} transactie(s) toegevoegd aan “${(actionById(m.id) || {}).name}”`); },
    'action-tx-remove': el => {
      const t = txById(el.dataset.id);
      if (!t) return;
      t.actions = (t.actions || []).filter(id => id !== el.dataset.actionId);
      if (!t.actions.length) delete t.actions;
      commit('Uit de actie gehaald');
      if (modal && modal.type === 'actionView') renderModal();
    },
    'tx-action-remove': el => {
      const t = modal && modal.tx;
      if (!t) return;
      t.actions = (t.actions || []).filter(id => id !== el.dataset.id);
      const a = actionById(el.dataset.id);
      el.closest('.action-badge').remove();
      const sel = $('#tx-action-add');
      if (sel && a) sel.insertAdjacentHTML('afterbegin', '');
      if (sel && a) { const o = document.createElement('option'); o.value = a.id; o.textContent = a.name; sel.insertBefore(o, sel.options[1] || null); }
    },
    'goal-edit': () => { ui.editGoal = true; render(); },
    'goal-cancel': () => { ui.editGoal = false; render(); },
    'adv-ledger': el => openModal({ type: 'advLedger', person: el.dataset.person }),
    'surplus-new': el => openModal({ type: 'surplus', person: el.dataset.person }),
    'surplus-save': saveSurplus,
    'surplus-undo': el => { if (confirm('Deze inboeking ongedaan maken? Het overschot staat dan weer open.')) { removeSurplus(el.dataset.person, el.dataset.id); if (modal && modal.type === 'advLedger') renderModal(); } },
    'cat-view': (el, ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); if (el.dataset.cat) openModal({ type: 'catTx', cat: el.dataset.cat, all: false }); },
    'cat-range': el => { if (modal && modal.type === 'catTx') { modal.all = el.dataset.all === '1'; renderModal(); } },
    'month-select': el => { ui.range = { from: el.dataset.m, to: el.dataset.m }; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    'landing-top': () => { window.scrollTo({ top: 0, behavior: 'smooth' }); const c = $('.landing-card .google-btn') || $('.landing-card input'); if (c) setTimeout(() => c.focus(), 300); },
    'google-unlink': async () => {
      if (!confirm('Je account loskoppelen van Google? Je meldt je dan weer enkel aan met je gebruikersnaam en wachtwoord.')) return;
      try { await Sync.unlinkGoogle(); toast('Losgekoppeld van Google'); } catch (e) { toast(e.message); }
      render();
    },
    'auth-show-pw': () => { if (ui.auth) { ui.auth.showPw = true; render(); const u = $('[data-form=login] [name=username]'); if (u) u.focus(); } },
    'settings-tab': el => { ui.settingsTab = el.dataset.tab; try { localStorage.setItem('flux-settings-tab', ui.settingsTab); } catch (e) { /* niet erg */ } render(); window.scrollTo(0, 0); },
    'goto-rules': () => { go('bank'); requestAnimationFrame(() => { const r = $('.rules-card'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); },
    'forgive': el => openModal({ type: 'forgive', person: el.dataset.person }),
    'forgive-save': saveForgive,
    'forgive-undo': el => { if (confirm('Deze kwijtschelding ongedaan maken? Het bedrag staat dan weer open.')) removeForgive(el.dataset.person, el.dataset.id); },
    'bulk-refund': () => {
      const r = bulkRefundTarget();
      if (!r) return;
      const back = r.incomes.reduce((x, t) => x + t.amount, 0);
      if (back > -r.expense.amount && !confirm(`Je krijgt ${money(back)} terug op een uitgave van ${money(-r.expense.amount)}. Toch koppelen?`)) return;
      linkRefunds(r.incomes, r.expense.id);
    },
    'copy': el => { try { navigator.clipboard.writeText(el.dataset.copy); toast('Gekopieerd'); } catch (e) { toast('Kopiëren lukte niet: selecteer en kopieer de tekst zelf.'); } },
    'edit-tx': el => { const t = txById(el.dataset.id); if (t) openModal({ type: 'tx', tx: JSON.parse(JSON.stringify(t)) }); },
    'save-tx': saveTx,
    'delete-tx': () => {
      const t = txById(modal.tx.id);
      if (!t) return;
      closeModal();
      deleteWithUndo([t.id]);
    },
    'add-split': () => {
      const container = $('#splits');
      if (!container) return;
      if (!container.children.length) {
        const amount = C.parseAmount($('#tx-amount').value);
        container.insertAdjacentHTML('beforeend', splitRow({ categoryId: $('#tx-category').value || null, amount: isNaN(amount) ? 0 : amount }));
      }
      container.insertAdjacentHTML('beforeend', splitRow());
      updateSplitRemaining(); updateTxSections();
    },
    'remove-split': el => { el.closest('.split-row').remove(); updateSplitRemaining(); },
    'rule-from-tx': () => {
      const t = Object.assign({}, modal.tx, { counterparty: $('#tx-counterparty').value.trim(), description: $('#tx-description').value.trim() });
      const key = C.normalizeName(t.counterparty) || C.normalizeName(t.description);
      openModal({ type: 'rule', rule: { id: C.uid('rule'), name: t.counterparty || key, field: t.counterparty ? 'counterparty' : 'any', operator: 'name', value: key, categoryId: $('#tx-category').value || t.categoryId, direction: t.amount < 0 ? 'out' : 'in', enabled: true, person: ($('#tx-person') && $('#tx-person').value.trim()) || t.person || null } });
    },
    'rule-hint': el => ruleFromHint(el.dataset.id),
    'new-rule': () => openModal({ type: 'rule', rule: { id: C.uid('rule'), name: '', field: 'any', operator: 'name', value: '', categoryId: null, direction: 'out', enabled: true } }),
    'edit-rule': el => { const r = state.rules.find(x => x.id === el.dataset.id); if (r) openModal({ type: 'rule', rule: Object.assign({}, r) }); },
    'save-rule': saveRule,
    'delete-rule': el => { if (!confirm('Deze regel verwijderen?')) return; state.rules = state.rules.filter(r => r.id !== el.dataset.id); commit('Regel verwijderd'); },
    'rule-up': el => moveRule(el.dataset.id),
    'new-budget': () => openModal({ type: 'budget', budget: { id: C.uid('bud'), categoryId: null, period: 'monthly', limit: 0, warnAt: 0.8 } }),
    'edit-budget': el => { const b = state.budgets.find(x => x.id === el.dataset.id); if (b) openModal({ type: 'budget', budget: Object.assign({}, b) }); },
    'save-budget': saveBudget,
    'delete-budget': () => { if (!confirm('Dit budget verwijderen?')) return; state.budgets = state.budgets.filter(b => b.id !== modal.budget.id); closeModal(); commit('Budget verwijderd'); },
    'sub-ignore': el => { state.subscriptions[el.dataset.key] = Object.assign({}, state.subscriptions[el.dataset.key], { status: 'ignored' }); commit('Niet meer als vaste last getoond'); },
    'new-account': () => openModal({ type: 'account', account: { id: C.uid('acc'), name: '', iban: '', type: 'zicht' } }),
    'edit-account': el => openModal({ type: 'account', account: Object.assign({}, acc(el.dataset.id)) }),
    'save-account': saveAccount,
    'delete-account': el => {
      const id = el.dataset.id;
      const n = state.transactions.filter(t => t.accountId === id).length;
      if (state.accounts.length <= 1) { toast('Je hebt minstens één rekening nodig.'); return; }
      if (!confirm(n ? `Deze rekening, haar ${n} transacties en haar opgeladen bestanden verwijderen?` : 'Deze rekening verwijderen?')) return;
      state.accounts = state.accounts.filter(a => a.id !== id);
      state.transactions = state.transactions.filter(t => t.accountId !== id);
      state.imports = (state.imports || []).filter(i => i.accountId !== id);
      commit('Rekening verwijderd');
    },
    'new-category': el => openModal({ type: 'category', category: { id: C.uid('cat'), name: '', kind: el && el.dataset.kind === 'income' ? 'income' : 'expense', color: '#3b5bdb', lookupTags: '' } }),
    'new-cost-category': el => openModal({ type: 'category', category: { id: C.uid('cat'), name: 'Kosten ' + catName(el.dataset.id).toLowerCase(), kind: 'expense', incomeId: el.dataset.id, color: '#94d82d', lookupTags: '' } }),
    'edit-category': el => openModal({ type: 'category', category: Object.assign({}, cat(el.dataset.id)) }),
    'save-category': saveCategory,
    'delete-category': el => {
      const id = el.dataset.id;
      const n = state.transactions.filter(t => C.splitLines(t).some(l => l.categoryId === id)).length;
      const what = cat(id) && cat(id).kind === 'income' ? 'Inkomstenbron' : 'Categorie';
      if (!confirm(`${what} “${catName(id)}” verwijderen?\n\n${n ? n + ' gekoppelde transactie(s) worden weer “te verwerken”. ' : ''}Bijhorende regels en budgetten verdwijnen; gekoppelde kostcategorieën blijven bestaan als gewone uitgave.`)) return;
      state.categories = state.categories.filter(c => c.id !== id).map(c => { if (c.incomeId === id) { const x = Object.assign({}, c); delete x.incomeId; return x; } return c; });
      state.rules = state.rules.filter(r => r.categoryId !== id);
      state.budgets = state.budgets.filter(b => b.categoryId !== id);
      commit('Categorie verwijderd');
    },
    'degiro-connect': () => openModal({ type: 'degiro' }),
    'fetch-prices': () => maybeFetchPrices(true),
    'degiro-files': () => openModal({ type: 'degiroFiles', files: [] }),
    'degiro-apply': applyDegiroFiles,
    'degiro-clear': () => { if (!confirm('Alle beleggingsgegevens wissen?')) return; state.investments = { cleared: true }; commit('Beleggingsgegevens gewist'); },
    'invest-remove-broker': el => {
      const b = Invest.brokers(inv()).find(x => x.id === el.dataset.id);
      if (!b || !confirm(`Alle beleggingsgegevens van ${b.name} wissen? De andere broker(s) blijven.`)) return;
      state.investments = Invest.removeBroker(state.investments, b.id);
      commit(`Gegevens van ${b.name} gewist`);
    },
    'saxo-setup': () => openModal({ type: 'saxoSetup', env: (saxoLink.status && saxoLink.status.env) || 'sim' }),
    'saxo-remove-config': async () => {
      if (!confirm('De Saxo-instelling (App Key en Secret) verwijderen? Je beleggingsgegevens blijven.')) return;
      try { await Sync.saxo.removeConfig(); await loadSaxo(); closeModal(); render(); } catch (e) { toast(e.message); }
    },
    'saxo-login': () => saxoLogin(),
    'saxo-fetch': () => saxoFetch(),
    'saxo-disconnect': async () => {
      if (!confirm('Saxo loskoppelen? Je opgehaalde gegevens blijven in Helder.')) return;
      try { await Sync.saxo.disconnect(); await loadSaxo(); render(); toast('Saxo losgekoppeld'); } catch (e) { toast(e.message); }
    },
    'lookup': () => { const c = C.lookupCandidates(state); if (!c.length) toast('Alles is al gekoppeld.'); else openLookup(c); },
    'lookup-one': lookupOne,
    'apply-sugg': el => { $('#tx-category').value = el.dataset.id; updateSplitRemaining(); updateTxSections(); updateTitleSuggestion(); },
    'ai-title': aiFromTitle,
    'lookup-apply': applyLookup,
    'sync-now': () => Sync.syncNow(),
    'change-password': () => openModal({ type: 'password' }),
    'save-password': savePassword,
    'logout': () => doLogout(false),
    'logout-all': () => doLogout(true),
    'export-json': () => download('helder-backup-' + today + (demo ? '-voorbeeld' : '') + '.json', JSON.stringify(state, null, 2), 'application/json'),
    'import-json': importJSON,
    'export-csv': exportCSV,
    'enter-demo': enterDemo,
    'exit-demo': exitDemo,
    'reset': () => {
      if (demo) { exitDemo(); return; }
      if (!confirm('Al je gegevens definitief wissen' + (ui.sync.mode !== 'local' ? ' (ook op je andere toestellen en de server)' : '') + '?')) return;
      if (!confirm('Zeker? Dit kan niet ongedaan gemaakt worden. Maak eventueel eerst een back-up.')) return;
      replaceAll(Store.defaultState(), 'Alle gegevens gewist');
    },
    'close-modal': closeModal,
    'backdrop': (el, ev) => { if (ev.target === el) closeModal(); }
  };

  function go(view, silent) {
    if (view === 'actions') ui.owed = 'act';
    view = viewOf(view);
    ui.view = VIEWS.includes(view) ? view : 'dashboard';
    ui.list.status = ''; ui.list.limit = 150;
    if (location.hash !== '#' + ui.view) history.replaceState(null, '', '#' + ui.view);
    if (ui.view === 'bank' && !bankLink.status && bankLinkAvailable()) loadBankLink();
    if (ui.view === 'invest' && !saxoLink.status && saxoAvailable()) loadSaxo();
    if (!silent) { render(); window.scrollTo(0, 0); }
  }

  document.addEventListener('click', ev => {
    const moreBtn = ev.target.closest('[data-tab-more]');
    const sheet = $('#tab-more');
    if (moreBtn) { const open = sheet.hidden; sheet.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); return; }
    if (sheet && !sheet.hidden && !ev.target.closest('#tab-more')) sheet.hidden = true;
    const nav = ev.target.closest('#nav button, #tabbar [data-view], #tab-more [data-view], [data-view-link]');
    if (nav) { ev.preventDefault(); if (sheet) sheet.hidden = true; go(nav.dataset.view || nav.dataset.viewLink); return; }
    const el = ev.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') ev.preventDefault();
    actions[el.dataset.action](el, ev);
  });

  let searchTimer;
  document.addEventListener('input', ev => {
    const el = ev.target;
    if (el.dataset.tl) { onTimelineInput(el); return; }
    if (el.dataset.assignInput) { openPicker(el, true); return; }
    if (el.dataset.filter === 'bank.search') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        ui.bank.search = el.value;
        const pos = el.selectionStart;
        render();
        const s = $('[data-filter="bank.search"]'); s.focus(); s.setSelectionRange(pos, pos);
      }, 200);
    }
    if (modal && modal.type === 'tx' && (el.closest('#splits') || el.id === 'tx-amount')) { updateSplitRemaining(); updateTxSections(); }
    if (modal && modal.type === 'tx' && el.id === 'tx-title') { clearTimeout(searchTimer); searchTimer = setTimeout(updateTitleSuggestion, 250); }
    if (modal && modal.type === 'rule') updateRulePreview();
    if (modal && modal.type === 'advPick' && el.id === 'adv-person') { modal.person = el.value; return; }
    if (modal && modal.type === 'search' && el.id === 'global-search') {
      modal.q = el.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { const r = $('#search-results'); if (r) r.innerHTML = searchListHtml(modal.q); }, 120);
      return;
    }
    if (modal && modal.type === 'actionPick' && el.id === 'act-search') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { modal.search = el.value; const pos = el.selectionStart; renderModal(); const s2 = $('#act-search'); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); } }, 150);
    }
    if (modal && modal.type === 'advPick' && el.id === 'adv-search') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { modal.search = el.value; const pos = el.selectionStart; renderModal(); const s2 = $('#adv-search'); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); } }, 150);
    }
    if (modal && modal.type === 'bankConnect' && el.id === 'eb-search') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { modal.search = el.value; const pos = el.selectionStart; renderModal(); const s2 = $('#eb-search'); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); } }, 150);
    }
  });

  document.addEventListener('change', ev => {
    const el = ev.target;
    if (el.dataset.select) { if (el.checked) ui.selected.add(el.dataset.select); else ui.selected.delete(el.dataset.select); render(); return; }
    if (el.dataset.selectAll != null) { for (const id of el.dataset.selectAll.split(',').filter(Boolean)) { if (el.checked) ui.selected.add(id); else ui.selected.delete(id); } render(); return; }
    if (el.dataset.assignInput) return;
    if (el.dataset.filter === 'bank.account') { ui.bank.account = el.value; render(); return; }
    if (el.dataset.tl) { onTimelineInput(el); render(); return; }
    if (el.dataset.adminReg != null) { Sync.admin.setRegistration(el.checked).then(() => { toast(el.checked ? 'Nieuwe accounts: open' : 'Nieuwe accounts: gesloten'); loadAdmin(); }).catch(e => toast(e.message)); return; }
    if (el.dataset.adminAi) { Sync.admin.user(el.dataset.adminAi, el.checked ? 'ai-on' : 'ai-off').then(() => loadAdmin()).catch(e => toast(e.message)); return; }
    if (el.dataset.settle) { setSettle(el.dataset.settle, el.value); return; }
    if (el.id === 'tax-year' && modal && modal.type === 'taxYear') { modal.year = el.value; renderModal(); return; }
    if (el.dataset.bulkAction != null) {
      const ids = Array.from(ui.selected);
      if (el.value === '__new__') { openModal({ type: 'action', isNew: true, addTx: ids, edit: { id: C.uid('act'), name: '', expectBack: true, person: '', note: '' } }); return; }
      if (!el.value) return;
      const a = actionById(el.value);
      const n = addToAction(ids, el.value);
      ui.selected.clear();
      commit(`${n} transactie(s) toegevoegd aan “${a ? a.name : ''}”`);
      return;
    }
    if (el.id === 'data-from') { dateWhenDone(el, v => setDataFrom(v)); return; }
    if (el.dataset.setting) { state.settings = Object.assign({}, state.settings, { [el.dataset.setting]: el.type === 'checkbox' ? el.checked : el.value.trim() }); commit('Instelling bewaard'); return; }
    if (!modal) return;
    if (modal.type === 'tx' && el.id === 'tx-action-add') { txAddAction(el); return; }
    if (modal.type === 'tx' && el.id === 'tx-file') { uploadTxFile(el); return; }
    if (modal.type === 'tx') { updateSplitRemaining(); updateTxSections(); if (el.id === 'tx-category') updateTitleSuggestion(); return; }
    if (modal.type === 'rule') { updateRulePreview(); return; }
    if (modal.type === 'category' && el.id === 'cat-kind') { $('#cat-income-field').hidden = el.value !== 'incomeCost'; return; }
    if (modal.type === 'lookup') {
      if (el.dataset.lookupCat != null) {
        const r = modal.rows[Number(el.dataset.lookupCat)]; r.categoryId = el.value; r.touched = true;
        const n = modal.rows.filter(x => x.categoryId).length;
        const btn = $('[data-action="lookup-apply"]'); btn.disabled = !n; btn.textContent = n + ' toepassen';
      }
      if (el.dataset.lookupRule != null) modal.rows[Number(el.dataset.lookupRule)].makeRule = el.checked;
      return;
    }
    if (modal.type === 'import') {
      if (el.id === 'imp-file' && el.files[0]) { loadImportFile(el.files[0]); return; }
      if (el.id === 'imp-from') { dateWhenDone(el, v => { setDataFrom(v, true); planImport(); renderModal(); }); return; }
      if (el.dataset.map) { modal.mapping[el.dataset.map] = el.value === '' ? null : Number(el.value); planImport(); renderModal(); return; }
      if (el.dataset.partAccount != null) {
        const p = modal.parts[Number(el.dataset.partAccount)];
        if (el.value === '__new__') { p.accountId = null; p.wantNew = true; }
        else { p.accountId = el.value || null; p.wantNew = false; }
        p.plan = Banks.plan(state, p.parsed, p.accountId || '__nieuw__', modal.text, modal.fileName);
        renderModal();
        return;
      }
      if (el.dataset.partName != null) modal.parts[Number(el.dataset.partName)].newName = el.value;
      if (el.dataset.partType != null) modal.parts[Number(el.dataset.partType)].newType = el.value;
    }
    if (modal.type === 'bankSetup' && el.id === 'eb-pem' && el.files[0]) {
      const file = el.files[0];
      readFile(file).then(text => {
        modal.pem = text; modal.pemName = file.name;
        const id = file.name.replace(/\.(pem|key|txt)$/i, '');
        const typed = $('#eb-appid') ? $('#eb-appid').value.trim() : '';
        modal.appId = typed || (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : '');
        renderModal();
      });
      return;
    }
    if (modal.type === 'actionPick' && el.dataset.actPick) { if (el.checked) modal.chosen.add(el.dataset.actPick); else modal.chosen.delete(el.dataset.actPick); renderModal(); return; }
    if (modal.type === 'advPick' && el.dataset.advPick) { if (el.checked) modal.chosen.add(el.dataset.advPick); else modal.chosen.delete(el.dataset.advPick); renderModal(); return; }
    if (modal.type === 'bankConnect' && el.id === 'eb-country') { modal.country = el.value; loadAspsps(); return; }
    if (modal.type === 'degiroFiles') {
      if (el.id === 'dg-files' && el.files.length) loadDegiroFiles(el.files);
      if (el.dataset.dgDate != null) modal.files[Number(el.dataset.dgDate)].date = el.value;
    }
  });

  document.addEventListener('keydown', ev => {
    const el = ev.target;
    // "/" of Ctrl+K: zoeken (niet terwijl je in een veld typt)
    if (((ev.key === '/' && !ev.ctrlKey && !ev.metaKey) || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k')) && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !ui.auth && !ui.admin) {
      ev.preventDefault(); actions['search-open'](); return;
    }
    if (el && el.dataset && el.dataset.assignInput && picker.input === el) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const n = picker.items.length;
        if (n) picker.index = (picker.index + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n;
        renderPicker();
        return;
      }
      if (ev.key === 'Enter') { ev.preventDefault(); choosePick(picker.index, true); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); closePicker(true); el.blur(); return; }
      if (ev.key === 'Tab') { closePicker(true); return; }
    }
    if (ev.key === 'Escape' && modal) closeModal();
  });
  document.addEventListener('toggle', ev => { const d = ev.target; if (d.dataset && d.dataset.keep) ui.keepOpen[d.dataset.keep] = d.open; }, true);
  document.addEventListener('focusin', ev => {
    const el = ev.target;
    if (el.dataset && el.dataset.assignInput) { el.select(); openPicker(el, false); }
  });
  document.addEventListener('focusout', ev => {
    if (dateTimer && (dateTimer.el === ev.target || (ev.target.id && dateTimer.el.id === ev.target.id))) dateTimer.run();
    if (ui.renderLater && ev.target.type === 'date') setTimeout(() => { if (ui.renderLater && !(document.activeElement && document.activeElement.type === 'date')) render(); }, 0);
    if (ev.target.dataset && ev.target.dataset.assignInput && picker.input === ev.target) setTimeout(() => { if (picker.input === ev.target && document.activeElement !== ev.target) closePicker(true); }, 120);
  });
  document.addEventListener('mousedown', ev => {
    const opt = ev.target.closest('[data-pick]');
    if (opt) { ev.preventDefault(); choosePick(Number(opt.dataset.pick), false); }
  });
  window.addEventListener('resize', () => { if (picker.input) renderPicker(); });
  window.addEventListener('scroll', () => { if (picker.input) renderPicker(); }, { passive: true });
  window.addEventListener('hashchange', () => { const v = viewOf(location.hash.slice(1)); if (VIEWS.includes(v) && v !== ui.view) { ui.view = v; render(); } });

  document.addEventListener('submit', async ev => {
    const form = ev.target.closest('[data-form]');
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.form === 'degiro') { degiroSubmit(form); return; }
    if (form.dataset.form === 'bank-setup') { bankSetupSubmit(form); return; }
    if (form.dataset.form === 'saxo-setup') { saxoSetupSubmit(form); return; }
    if (form.dataset.form === 'ai-key') { aiKeySubmit(form); return; }
    if (form.dataset.form === 'house-join') {
      const code = String(new FormData(form).get('code') || '').trim();
      if (!confirm('Deelnemen aan deze gedeelde boekhouding?\n\nJe ziet en bewerkt daarna de gegevens van wie je uitnodigde. Je eigen gegevens blijven bewaard en komen terug als je het huishouden verlaat.')) return;
      houseUi.busy = true; houseUi.error = ''; render();
      Sync.household.join(code).then(st => { houseUi.status = st; toast('Je werkt nu in de gedeelde boekhouding van ' + st.owner.name); })
        .catch(e => { houseUi.error = e.message; }).finally(() => { houseUi.busy = false; render(); });
      return;
    }
    if (form.dataset.form === 'savings-goal') {
      const v = C.parseAmount(String(new FormData(form).get('goal') || ''));
      ui.editGoal = false;
      state.settings = Object.assign({}, state.settings, { savingsGoal: isNaN(v) || v <= 0 ? 0 : v });
      commit(isNaN(v) || v <= 0 ? 'Spaardoel verwijderd' : 'Spaardoel: ' + money(v) + ' per jaar');
      return;
    }
    if (form.dataset.form === 'new-income') {
      const name = String(new FormData(form).get('name') || '').trim();
      if (!name) return;
      if (state.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) { toast('Die naam bestaat al.'); return; }
      const colors = ['#37b24d', '#74b816', '#0ca678', '#1098ad', '#f59f00', '#ae3ec9'];
      state.categories.push({ id: C.uid('cat'), name, kind: 'income', color: colors[incomeSources().length % colors.length], lookupTags: '' });
      commit('Inkomstenbron “' + name + '” aangemaakt');
      return;
    }
    const f = new FormData(form);
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      if (form.dataset.form === 'register') {
        if (String(f.get('password')) !== String(f.get('password2'))) throw new Error('De twee wachtwoorden zijn niet gelijk.');
        await Sync.register(String(f.get('username')).trim(), String(f.get('password')), String(f.get('displayName') || '').trim());
      } else if (form.dataset.form === 'login') await Sync.login(String(f.get('username')).trim(), String(f.get('password')));
      else await Sync.setup(String(f.get('code')).trim(), String(f.get('username')).trim(), String(f.get('password')));
      ui.auth = null;
      render();
      toast('Aangemeld');
      if (!ui.admin) loadBankLink({ auto: true });
    } catch (e) {
      ui.auth = Object.assign({}, ui.auth, { error: e.message, previousUser: String(f.get('username') || '').trim() || ui.auth.previousUser, displayName: String(f.get('displayName') || '') });
      render();
    }
  });

  async function doLogout(everywhere) {
    const wasAdmin = !!ui.admin;
    if (!await Sync.logout(everywhere)) return;
    if (!wasAdmin) {
      Store.clear();
      realState = Store.defaultState();
      if (!demo) state = realState;
      snap = C.snapshot(realState);
    }
    ui.admin = null;
    ui.auth = { setupRequired: false, auth: Sync.auth || {} };
    closeModal();
    render();
  }

  render();

  if (Sync) {
    Sync.init({
      getState: () => realState,
      setState,
      freshState: () => Store.defaultState(),
      onStatus: s => { ui.sync = s; renderSyncBadge(); },
      onOutdated: msg => { toast(msg); setTimeout(() => location.reload(), 1500); },
      onAdmin: info => { ui.auth = null; ui.admin = { me: info, data: null }; closeModal(); render(); loadAdmin(); },
      onAuthRequired: info => {
        ui.auth = { setupRequired: !!info.setupRequired, setupHint: info.setupHint || '', previousUser: info.previousUser || null, expired: !!info.previousUser, auth: info.auth || {} };
        closeModal();
        render();
      }
    }).then(async () => {
      if (!ui.auth) render();
      if (/[?&]google=gekoppeld/.test(location.search)) { history.replaceState(null, '', location.pathname + '#settings'); ui.view = 'settings'; ui.settingsTab = 'account'; toast('Je account is gekoppeld met Google. Je kan nu ook met Google aanmelden.'); render(); }
      if (/[?&]welkom=1/.test(location.search)) { history.replaceState(null, '', location.pathname + location.hash); toast('Welkom bij Helder! Je account is aangemaakt.'); }
      const back = /[?&]koppeling=/.test(location.search);
      if (back) { history.replaceState(null, '', location.pathname + '#bank'); ui.view = 'bank'; render(); }
      // Terug van de aanmeldpagina van Saxo: meteen ophalen
      const saxoBack = /[?&]saxo=1/.test(location.search);
      if (saxoBack) { history.replaceState(null, '', location.pathname + '#invest'); ui.view = 'invest'; render(); }
      if (!ui.admin) { await loadBankLink({ auto: true }); await loadSaxo({ auto: true, force: saxoBack }); }
    }).catch(e => console.error('Helder sync:', e));
    // Terug in Helder na het aanmelden bij de bank (bv. vanuit Safari naar de iPhone-app)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && bankLink.awaiting) { bankLink.awaiting = false; loadBankLink({ auto: true }); } });
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* werkt ook zonder */ });
  }
})();
