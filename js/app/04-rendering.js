  // ---------- Rendering ----------

  /** Volgt de app het donkere thema (zelf gekozen, of via het toestel)? */
  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function renderTopButtons() {
    const th = $('#topbar-theme');
    if (th) { const d = isDark(); th.textContent = d ? '☀️' : '🌙'; th.title = d ? 'Lichte modus' : 'Donkere modus'; th.setAttribute('aria-label', th.title); }
    const pv = $('#topbar-privacy');
    if (pv) {
      const on = document.documentElement.classList.contains('privacy');
      pv.textContent = on ? '🙈' : '👁';
      pv.title = on ? 'Bedragen weer tonen' : 'Bedragen verbergen voor meekijkers';
      pv.setAttribute('aria-label', pv.title); pv.setAttribute('aria-pressed', String(on));
      pv.hidden = !!ui.auth;
    }
  }

  function render() {
    renderSyncBadge();
    renderTopButtons();
    $$('#nav button, #tabbar [data-view], #tab-more [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
    const more = $('#tabbar [data-tab-more]');
    if (more) more.classList.toggle('active', ['income', 'invest', 'settings'].includes(ui.view));
    const tb = $('#tabbar');
    if (tb) tb.hidden = !!(ui.auth || ui.admin);
    const ts = $('#topbar-search');
    if (ts) ts.hidden = !!(ui.auth || ui.admin);
    const todo = todoCount();
    const bankBtn = $('#nav [data-view=bank]');
    if (bankBtn) bankBtn.innerHTML = 'Bank' + (todo ? ` <span class="count">${todo}</span>` : '');
    const acts = (state.actions || []).filter(a => !a.closed).length;
    const folBtn = $('#nav [data-view=advances]');
    if (folBtn) folBtn.innerHTML = 'Opvolgen' + (acts ? ` <span class="count soft">${acts}</span>` : '');
    const actCount = $('#tabbar .act-count');
    if (actCount) { actCount.hidden = !acts; actCount.textContent = acts > 99 ? '99+' : String(acts); }
    const tabCount = $('#tabbar [data-view=bank] .tab-count');
    if (tabCount) { tabCount.hidden = !todo; tabCount.textContent = todo > 99 ? '99+' : String(todo); }
    if (ui.auth) { $('#nav').hidden = true; $('#main').innerHTML = renderAuth(); return; }
    if (ui.admin) { $('#nav').hidden = true; $('#main').innerHTML = renderAdmin() + appFooter(); return; }
    $('#nav').hidden = false;
    const views = { dashboard: renderDashboard, bank: renderBank, income: renderIncome, expenses: renderExpenses, advances: renderAdvances, invest: renderInvest, settings: renderSettings };
    const banner = demo ? `<div class="demo-banner">🧪 <strong>Voorbeeldmodus.</strong> Verzonnen gegevens om Helder te leren kennen — volledig los van je eigen gegevens, niet gesynchroniseerd.
      <button class="btn small" data-action="exit-demo">Voorbeeld afsluiten</button></div>` : '';
    // Wie aan het typen is in een koppelveld, blijft daar (ook als de synchronisatie de pagina ververst)
    const act = document.activeElement;
    // In een datumveld onthoudt de browser in welk deel (dag/maand/jaar) je typt; opnieuw tekenen breekt dat.
    // Dan pas tekenen zodra je het veld verlaat.
    if (act && act.tagName === 'INPUT' && act.type === 'date' && $('#main').contains(act)) { ui.renderLater = true; return; }
    ui.renderLater = false;
    const keep = act && act.dataset && act.dataset.assignInput && $('#main').contains(act)
      ? { id: act.dataset.assignInput, value: act.value, typed: picker.typed && picker.input === act, start: act.selectionStart, end: act.selectionEnd } : null;
    // Idem voor andere velden met een id (bv. een datum die je aan het typen bent)
    const field = !keep && act && act.id && /^(INPUT|TEXTAREA)$/.test(act.tagName) && /^(text|search|number|email|password|textarea)$/.test(act.type) && $('#main').contains(act)
      ? { id: act.id, value: act.value, start: act.selectionStart, end: act.selectionEnd } : null;
    closePicker(false);
    for (const id of ui.selected) if (!txById(id)) ui.selected.delete(id);
    $('#main').innerHTML = banner + (views[ui.view] || renderDashboard)() + appFooter();
    afterRender();
    if (keep) {
      const el = $$('[data-assign-input]').find(x => x.dataset.assignInput === keep.id);
      if (el) { el.value = keep.value; el.focus(); try { el.setSelectionRange(keep.start, keep.end); } catch (e) { /* niet erg */ } openPicker(el, keep.typed); }
    }
    if (field) {
      const el = document.getElementById(field.id);
      if (el && $('#main').contains(el)) {
        el.value = field.value; el.focus();
        try { el.setSelectionRange(field.start, field.end); } catch (e) { /* niet erg */ }
      }
    }
  }

  function appFooter() {
    return `<footer class="app-footer small muted">
      <a href="privacy.html" target="_blank" rel="noopener">Privacyverklaring</a> · <a href="voorwaarden.html" target="_blank" rel="noopener">Gebruiksvoorwaarden</a> · <a href="mailto:privacy@helderfin.be">Contact</a>
    </footer>`;
  }

  function todoCount() { return state.transactions.filter(t => kindOf(t) === 'todo').length; }

