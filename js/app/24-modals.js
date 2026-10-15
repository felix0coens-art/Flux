  // ---------- Modals ----------

  function openModal(m) { modal = m; renderModal(); }
  function closeModal() { modal = null; $('#modal-root').innerHTML = ''; }

  function modalShell(title, body, foot, wide) {
    return `<div class="modal-backdrop" data-action="backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost" data-action="close-modal" aria-label="Sluiten">✕</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${foot}</div></div></div>`;
  }

  function renderModal() {
    const root = $('#modal-root');
    if (!modal) { root.innerHTML = ''; return; }
    const fns = { watch: watchModal, metal: metalModal, metalPrice: metalPriceModal, taxYear: taxYearModal, search: searchModal, whatIs: whatIsModal, action: actionModal, actionPick: actionPickModal, actionView: m => modalShell('Actie', actionCard(actionById(m.id) || { id: '', name: '?' }, true), '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>', true), advLedger: advLedgerModal, surplus: surplusModal, catTx: catTxModal, advTitle: advTitleModal, forgive: forgiveModal, saxoSetup: saxoSetupModal, tx: txModal, rule: ruleModal, budget: budgetModal, account: accountModal, category: categoryModal, import: importModal, lookup: lookupModal, password: passwordModal, degiro: degiroModal, degiroFiles: degiroFilesModal, importView: importViewModal, bankSetup: bankSetupModal, bankConnect: bankConnectModal, person: personModal, advPick: advPickModal };
    const bd = $('.modal-backdrop', root);
    const scroll = bd ? bd.scrollTop : 0;
    root.innerHTML = fns[modal.type]();
    if (modal.focused) { const b = $('.modal-backdrop', root); if (b) b.scrollTop = scroll; }
    else {
      modal.focused = true;
      const first = $('.modal-body input:not([type=file]), .modal-body select', root);
      if (first && !['tx', 'lookup', 'importView', 'import'].includes(modal.type)) first.focus();
    }
    if (modal.type === 'tx') { updateSplitRemaining(); updateTxSections(); updateTitleSuggestion(); }
    if (modal.type === 'rule') updateRulePreview();
  }

