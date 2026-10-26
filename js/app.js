/*
 * Helder — gebruikersinterface.
 *
 * Tabbladen: Overzicht · Bank · Inkomsten · Uitgaven · Beleggingen · Instellingen.
 * Principe: het moet altijd duidelijk zijn wat je aan Helder gaf. Elke transactie heeft een herkomst
 * (een import met bestandsnaam, of "manueel"), elk bestand kan maar één keer opgeladen worden en een
 * import kan volledig ongedaan gemaakt worden. Voorbeeldgegevens leven in een aparte zandbak.
 */
(function () {
  'use strict';
  const C = window.FluxCore;
  const Store = window.FluxStore;
  const Sync = window.FluxSync;
  const Lookup = window.FluxLookup;
  const Banks = window.FluxBanks;
  const Invest = window.FluxInvest;

  const today = C.todayStr();
  let realState = Store.load();
  let demo = null; // voorbeeldgegevens (zandbak), nooit gesynchroniseerd
  try { if (localStorage.getItem('flux-demo-active') === '1') demo = Store.load(Store.DEMO_KEY); } catch (e) { /* geen opslag */ }
  if (demo && !demo.demo) demo = null;
  let state = demo || realState;
  let snap = C.snapshot(realState);

  const LOGO = '<svg class="logo-icon" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="currentColor"/><text x="32" y="47" text-anchor="middle" font-family="Rethink Sans, system-ui, sans-serif" font-weight="800" font-size="44" fill="#fff">€</text></svg>';
  const VIEWS = ['dashboard', 'bank', 'income', 'expenses', 'advances', 'invest', 'settings'];
  // Oude adressen: Acties staat nu samen met Voorschotten onder "Terug te krijgen".
  const viewOf = v => v === 'actions' ? 'advances' : v;
  const ui = {
    view: VIEWS.includes(viewOf((location.hash || '').slice(1))) ? viewOf(location.hash.slice(1)) : 'dashboard',
    owed: (location.hash || '') === '#actions' ? 'act' : 'all', // filter op "Terug te krijgen": all | adv | act
    range: { from: today.slice(0, 7), to: today.slice(0, 7) }, // gekozen periode (maanden), gedeeld door Overzicht/Inkomsten/Uitgaven
    bank: { account: '', category: '', status: 'todo', search: '', limit: 150 },
    list: { status: '', limit: 150 },
    ruleHint: null, // { txId, categoryId } na een inline koppeling: "altijd zo?"
    auth: null,
    sync: { mode: 'local', status: 'idle' },
    keepOpen: {} // uitklapbare blokken die open moeten blijven bij het verversen
  };
  let modal = null;

  // ---------- Hulpjes ----------

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const money = C.formatMoney;
  /** Bedrag in een zin, zodat het mee vervaagt als je 👁 'bedragen verbergen' aanzet. Enkel in HTML gebruiken. */
  const moneyHtml = v => '<span class="money">' + money(v) + '</span>';
  const pct = v => v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1).replace('.', ',') + '%';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function cat(id) { return state.categories.find(c => c.id === id); }
  function catName(id) { const c = cat(id); return c ? c.name : 'Niet gekoppeld'; }
  function catIcon(id) { return id ? C.categoryIcon(cat(id)) : '❔'; }
  function catLabel(id) { return id ? catIcon(id) + ' ' + catName(id) : 'Nog niet gekoppeld'; }
  function catColor(id) { const c = cat(id); return c ? c.color : '#ced4da'; }
  function acc(id) { return state.accounts.find(a => a.id === id); }
  function accName(id) { const a = acc(id); return a ? a.name : '—'; }
  function txById(id) { return state.transactions.find(t => t.id === id); }
  function imp(id) { return (state.imports || []).find(i => i.id === id); }
  function fmtDate(d) { if (!d) return ''; const [y, m, day] = d.split('-'); return day + '/' + m + '/' + y; }
  function fmtDateTime(iso) { try { return new Date(iso).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso; } }
  function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'][m - 1] + ' ' + y;
  }
  function shiftMonth(ym, n) { return C.addMonths(ym + '-01', n).slice(0, 7); }
  function isIncomeCost(c) { return !!(c && c.kind === 'expense' && c.incomeId && cat(c.incomeId)); }
  function incomeSources() { return state.categories.filter(c => c.kind === 'income'); }
  function kindOf(t) { return C.txKind(t, state.categories); }
  /** Beleggingsgegevens (null als er geen zijn of als ze gewist werden). */
  function inv() { return state.investments && !state.investments.cleared ? Invest.view(state.investments) : null; }

  function catBadge(id, suffix) {
    const extra = suffix ? ' ' + esc(suffix) : '';
    if (!id) return `<span class="badge none">Niet gekoppeld${extra}</span>`;
    return `<span class="badge cat-link" data-action="cat-view" data-cat="${esc(id)}" title="Transacties in ${esc(catName(id))}"><span class="dot" style="background:${esc(catColor(id))}"></span>${esc(catLabel(id))}${extra}</span>`;
  }

  const KIND_LABEL = {
    todo: ['none', 'Te verwerken'], income: ['ok', 'Inkomst'], expense: ['', 'Uitgave'], transfer: ['transfer', '↔ Eigen rekening'],
    investment: ['invest', '📈 Belegging'], advance: ['advance', '↗ Voorgeschoten'], repayment: ['advance', '↙ Terugbetaald voorschot'],
    refund: ['refund', '↩ Terugbetaling uitgave'], split: ['split', '✂ Gesplitst']
  };
  function kindBadge(k) { const [cls, label] = KIND_LABEL[k] || ['', k]; return `<span class="badge ${cls}">${label}</span>`; }

  function sourceBadge(t) {
    if (t.source === 'import') {
      const i = imp(t.importId);
      if (i && i.bank === 'bankkoppeling') return `<span class="badge src" title="${esc('Opgehaald via de bankkoppeling op ' + fmtDateTime(i.importedAt))}">🔗 ${esc(String(i.bankName || '').replace(/ \(bankkoppeling\)$/, ''))}</span>`;
      return `<span class="badge src" title="${i ? esc('Opgeladen op ' + fmtDateTime(i.importedAt)) : ''}">📄 ${esc(i ? i.fileName : 'import')}</span>`;
    }
    return '<span class="badge src">✎ Manueel</span>';
  }

  /** Categoriekeuze, gegroepeerd. kind: 'income' | 'expense' | 'budget' | null (alles). */
  function categoryOptions(selected, opts) {
    opts = opts || {};
    const groups = [
      ['income', 'Inkomsten', c => c.kind === 'income'],
      ['expense', 'Uitgaven', c => c.kind === 'expense' && !isIncomeCost(c)],
      ['incomeCost', 'Kosten op inkomsten', c => isIncomeCost(c)],
      ['special', 'Speciaal', c => c.kind === 'advance' || c.kind === 'investment']
    ].filter(([k]) => {
      if (k === 'special') return !!opts.special;
      if (!opts.kind) return true;
      if (opts.kind === 'income') return k === 'income';
      return k === 'expense' || k === 'incomeCost';
    });
    let html = opts.allowEmpty !== false ? `<option value="">${esc(opts.emptyLabel || '— Kies —')}</option>` : '';
    for (const [, label, test] of groups) {
      const list = state.categories.filter(test).sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) continue;
      html += `<optgroup label="${label}">` + list.map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(C.categoryIcon(c) + ' ' + c.name)}${isIncomeCost(c) ? ' (− ' + esc(catName(c.incomeId)) + ')' : ''}</option>`).join('') + '</optgroup>';
    }
    return html;
  }
  function accountOptions(selected, filter) {
    return state.accounts.filter(filter || (() => true)).map(a => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  }
  function amountClass(c) { return c > 0 ? 'pos' : 'neg'; }

  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast');
    el.textContent = msg;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'toast-action'; b.textContent = action.label;
      b.addEventListener('click', () => { el.classList.remove('show'); action.run(); });
      el.appendChild(b);
    }
    el.classList.toggle('has-action', !!action);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 9000 : 3500);
  }

  /** Verwijderen met een knop om het meteen terug te draaien. */
  function deleteWithUndo(ids) {
    const r = Banks.removeTransactions(state, ids);
    ui.selected.clear();
    commit();
    toast(r.count === 1 ? '1 transactie verwijderd' : r.count + ' transacties verwijderd', { label: 'Ongedaan maken', run: () => {
      const n = Banks.restoreDeleted(state, r.ids);
      commit(n === 1 ? '1 transactie teruggezet' : n + ' transacties teruggezet');
    } });
  }

  // ---------- Staat bewaren ----------

  /** Na elke wijziging: herberekenen, bewaren, synchroniseren (niet in de voorbeeldmodus), tekenen. */
  function commit(msg) {
    C.recompute(state);
    if (demo) {
      Store.save(demo, Store.DEMO_KEY);
    } else {
      const changed = C.stampChanges(snap, realState);
      snap = C.snapshot(realState);
      if (!Store.save(realState)) toast('Opslaan mislukt — is de opslag van je browser vol?');
      if (Sync) Sync.noteChanges(changed);
    }
    if (msg) toast(msg);
    render();
  }

  /** Vervangt de echte gegevens (na synchronisatie). In de voorbeeldmodus blijft de zandbak zichtbaar. */
  function setState(newState, options) {
    realState = C.recompute(Store.migrate(JSON.parse(JSON.stringify(newState))));
    if (options && options.stampAll) {
      const changed = C.stampChanges(null, realState);
      if (Sync) Sync.noteChanges(changed);
    }
    snap = C.snapshot(realState);
    Store.save(realState);
    if (!demo) state = realState;
    if (!modal) render();
  }

  function enterDemo() {
    demo = Store.demoState(today);
    Store.save(demo, Store.DEMO_KEY);
    try { localStorage.setItem('flux-demo-active', '1'); } catch (e) { /* */ }
    state = demo;
    go('dashboard');
    toast('Voorbeeldmodus: verzonnen gegevens, volledig los van je eigen gegevens');
  }
  function exitDemo() {
    demo = null;
    Store.clear(Store.DEMO_KEY);
    try { localStorage.removeItem('flux-demo-active'); } catch (e) { /* */ }
    state = realState;
    go('dashboard');
    toast('Terug naar je eigen gegevens');
  }

  // ---------- Tijdslijn: periode kiezen ----------

  const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  function shortMonth(ym) { return MONTHS_SHORT[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4); }

  /** Alle maanden van de tijdslijn: van de eerste transactie (minstens 12 maanden terug) tot nu. */
  function timelineMonths() {
    let first = shiftMonth(today.slice(0, 7), -11), last = today.slice(0, 7);
    for (const t of state.transactions) { const m = t.date.slice(0, 7); if (m < first) first = m; if (m > last) last = m; }
    const out = [];
    for (let m = first; m <= last; m = shiftMonth(m, 1)) out.push(m);
    return out;
  }
  function currentRange() {
    const r = ui.range;
    return { start: r.from + '-01', end: C.periodRange('monthly', r.to + '-01').end };
  }
  function rangeLabel(r) {
    r = r || ui.range;
    if (r.from === r.to) return esc(monthLabel(r.from));
    if (r.from.slice(5) === '01' && r.to.slice(5) === '12' && r.from.slice(0, 4) === r.to.slice(0, 4)) return 'Heel ' + r.from.slice(0, 4);
    const n = (Number(r.to.slice(0, 4)) - Number(r.from.slice(0, 4))) * 12 + Number(r.to.slice(5)) - Number(r.from.slice(5)) + 1;
    return `${shortMonth(r.from)} – ${shortMonth(r.to)} <span class="muted">(${n} maanden)</span>`;
  }
  function presetRange(key, months) {
    const cur = today.slice(0, 7), y = Number(today.slice(0, 4));
    const map = {
      month: [cur, cur], prev: [shiftMonth(cur, -1), shiftMonth(cur, -1)], q: [shiftMonth(cur, -2), cur],
      ytd: [y + '-01', cur], lastyear: [(y - 1) + '-01', (y - 1) + '-12'], m12: [shiftMonth(cur, -11), cur], all: [months[0], months[months.length - 1]]
    };
    const [from, to] = map[key];
    return { from: from < months[0] ? months[0] : from, to };
  }

  /** Schuifbalk op een tijdslijn: sleep de twee handvatten om de periode te kiezen. */
  function timeline() {
    const months = timelineMonths();
    let i0 = months.indexOf(ui.range.from), i1 = months.indexOf(ui.range.to);
    if (i0 < 0) i0 = 0;
    if (i1 < i0) i1 = months.length - 1;
    const lines = C.allocations(state);
    const act = months.map(m => C.summarize(state, C.periodRange('monthly', m + '-01'), lines).expenses);
    const max = Math.max(1, ...act);
    const n = months.length;
    const presets = [['month', 'Deze maand'], ['prev', 'Vorige maand'], ['q', '3 maanden'], ['ytd', 'Dit jaar'], ['lastyear', 'Vorig jaar'], ['m12', '12 maanden'], ['all', 'Alles']];
    const activePreset = (presets.find(([k]) => { const r = presetRange(k, months); return r.from === ui.range.from && r.to === ui.range.to; }) || [])[0];
    return `<div class="card timeline" data-months="${esc(months.join(','))}">
      <div class="tl-head"><strong id="tl-label">${rangeLabel()}</strong><span class="spacer"></span>
        <div class="seg tl-presets">${presets.map(([k, l]) => `<button class="${activePreset === k ? 'active' : ''}" data-action="range-preset" data-preset="${k}">${l}</button>`).join('')}</div></div>
      <div class="tl-track"><div class="tl-inner">
        <div class="tl-bars">${months.map((m, i) => `<span class="${i >= i0 && i <= i1 ? 'in' : ''}" style="height:${Math.max(4, act[i] / max * 100).toFixed(0)}%" title="${esc(shortMonth(m))}: uitgaven ${esc(money(act[i]))}"></span>`).join('')}</div>
        <div class="tl-sel" style="left:${(i0 / n * 100).toFixed(2)}%;width:${((i1 - i0 + 1) / n * 100).toFixed(2)}%"></div></div>
        <input type="range" class="tl-range" data-tl="from" min="0" max="${n - 1}" step="1" value="${i0}" aria-label="Begin van de periode">
        <input type="range" class="tl-range" data-tl="to" min="0" max="${n - 1}" step="1" value="${i1}" aria-label="Einde van de periode">
      </div>
      <div class="tl-months">${months.map((m, i) => {
        // Elke maand een label: voluit als er plaats is, anders de beginletter (bij veel maanden enkel per kwartaal)
        const mm = Number(m.slice(5));
        const txt = n <= 18 ? MONTHS_SHORT[mm - 1] : n <= 40 ? MONTHS_SHORT[mm - 1].slice(0, 1).toUpperCase() : (mm % 3 === 1 ? MONTHS_SHORT[mm - 1].slice(0, 1).toUpperCase() : '');
        return `<span class="${i >= i0 && i <= i1 ? 'in' : ''}">${txt}</span>`;
      }).join('')}</div>
      <div class="tl-axis">${months.map((m, i) => m.slice(5) === '01' || i === 0 ? `<span style="left:${(i / n * 100).toFixed(2)}%">${m.slice(0, 4)}</span>` : '').join('')}</div>
      <p class="small muted tl-hint">Sleep de twee bolletjes om het begin en het einde van de periode te kiezen. De balkjes tonen je uitgaven per maand.</p>
    </div>`;
  }

  /** Tijdens het slepen: label en selectie meteen bijwerken (zonder alles opnieuw te tekenen). */
  function onTimelineInput(el) {
    const tl = el.closest('.timeline');
    const months = tl.dataset.months.split(',');
    const from = $('[data-tl=from]', tl), to = $('[data-tl=to]', tl);
    let a = Number(from.value), b = Number(to.value);
    if (a > b) { if (el === from) { b = a; to.value = b; } else { a = b; from.value = a; } }
    ui.range = { from: months[a], to: months[b] };
    $('#tl-label', tl).innerHTML = rangeLabel();
    const sel = $('.tl-sel', tl);
    sel.style.left = (a / months.length * 100).toFixed(2) + '%';
    sel.style.width = ((b - a + 1) / months.length * 100).toFixed(2) + '%';
    $$('.tl-bars span', tl).forEach((sp, i) => sp.classList.toggle('in', i >= a && i <= b));
    $$('.tl-months span', tl).forEach((sp, i) => sp.classList.toggle('in', i >= a && i <= b));
  }

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

  // ----- Overzicht -----

  function renderDashboard() {
    if (!state.transactions.length && !inv()) {
      return `<div class="page-head"><h1>Welkom bij Helder</h1></div>
        <div class="card empty-state">
          <p><strong>Helder is leeg.</strong> Je begint door de rekeninguittreksels van je bank op te laden in het tabblad <strong>Bank</strong>.<br>
            Elk bestand wordt één keer opgeladen; je ziet altijd welk bestand welke transacties aanbracht.</p>
          <button class="btn primary" data-action="import">Bankbestand opladen</button>
          <button class="btn" data-action="new-tx">Manuele transactie (bv. cash)</button>
          <button class="btn" data-action="goto" data-view="invest">Degiro koppelen</button>
          <p class="small muted" style="margin-top:16px">Eerst eens rondkijken? <a href="#" data-action="enter-demo">Open de voorbeeldmodus</a> — die staat volledig los van je eigen gegevens.</p>
        </div>`;
    }
    const lines = C.allocations(state);
    const range = currentRange();
    const sum = C.summarize(state, range, lines);
    const refDate = range.end > today ? today : range.end;
    const todo = todoCount();
    const multi = ui.range.from !== ui.range.to;
    const adv = C.advancesOverview(state);
    const budgets = state.budgets.map(b => C.budgetStatus(state, b, refDate, lines)).filter(b => b.status !== 'ok');
    const upcoming = C.detectRecurring(state, today).filter(r => r.userStatus !== 'ignored' && r.status !== 'gestopt' && r.daysUntil >= -7 && r.daysUntil <= 30);
    const balances = state.accounts.map(a => ({ a, b: C.accountBalance(state, a.id) })).filter(x => x.b);
    const bankTotal = balances.reduce((s, x) => s + x.b.amount, 0);
    const invSum = inv() ? Invest.summary(inv()) : null;
    const open = adv.people.filter(p => p.open !== 0);

    const metalSum = metals();
    const worth = bankTotal + (invSum ? invSum.valueEur : 0) + metalSum.value + Math.max(0, adv.totalOpen) - (adv.totalPrepaid || 0);
    const cancels = C.cancellationPairs(state).length;
    const actionsOpen = actionLists().open;
    const actionsLate = actionsOpen.filter(a => a.due && a.due < today).length;
    // Te doen: alles wat je aandacht vraagt, op één plek
    const todoItems = [
      todo ? `<a href="#" class="todo-row" data-action="goto" data-view="bank"><span class="todo-icon">📥</span><span class="grow"><strong>${todo} transactie${todo === 1 ? '' : 's'} te verwerken</strong><span class="small muted">Koppel ze aan een categorie, voorschot, …</span></span><span class="todo-go">›</span></a>` : '',
      cancels ? `<a href="#" class="todo-row" data-action="goto" data-view="bank"><span class="todo-icon">↩</span><span class="grow"><strong>${cancels} mogelijke annulering${cancels === 1 ? '' : 'en'}</strong><span class="small muted">Inkomst met hetzelfde bedrag als een eerdere uitgave</span></span><span class="todo-go">›</span></a>` : '',
      ...open.filter(p => p.open > 0).map(p => `<a href="#advances" class="todo-row" data-view-link="advances"><span class="todo-icon">🤝</span><span class="grow"><strong>${esc(p.person)} is je nog ${moneyHtml(p.open)} schuldig</strong><span class="small muted">${p.items.filter(i => i.amount - i.repaid > 0).length} open voorschot(ten)</span></span><span class="todo-go">›</span></a>`),
      ...open.filter(p => p.open < 0).map(p => `<a href="#advances" class="todo-row" data-view-link="advances"><span class="todo-icon">📥</span><span class="grow"><strong>${esc(p.person)} betaalde ${moneyHtml(-p.open)} vooruit</strong><span class="small muted">Nog voor ${esc(p.person)} te betalen (koppel die uitgave), of te veel terugbetaald</span></span><span class="todo-go">›</span></a>`),
      actionsOpen.length ? `<a href="#" class="todo-row" data-action="goto" data-view="actions"><span class="todo-icon">✅</span><span class="grow"><strong>${actionsOpen.length} actie${actionsOpen.length === 1 ? '' : 's'} te doen${actionsLate ? ` <span class="warn-text">· ${actionsLate} te laat</span>` : ''}</strong><span class="small muted">${esc(actionsOpen.slice(0, 3).map(a => a.name).join(' · '))}${actionsOpen.length > 3 ? ' · …' : ''}</span></span><span class="todo-go">›</span></a>` : '',
      ...budgets.map(b => `<div class="todo-row"><span class="todo-icon">${b.status === 'over' ? '⚠️' : '⏳'}</span><span class="grow"><strong>Budget ${esc(catLabel(b.budget.categoryId))} ${b.status === 'over' ? 'overschreden' : 'bijna op'}</strong><span class="small muted">${Math.round(b.pct * 100)}% · ${b.budget.period === 'yearly' ? esc(b.range.label) : esc(monthLabel(b.range.label))}</span></span></div>`),
      ...upcoming.slice(0, 4).map(r => `<div class="todo-row"><span class="todo-icon">🔁</span><span class="grow"><strong>${esc(r.name)}</strong><span class="small muted">${esc(r.frequency.label)} · ${r.daysUntil < 0 ? -r.daysUntil + ' d te laat' : r.daysUntil === 0 ? 'vandaag' : 'over ' + r.daysUntil + ' d'}</span></span><span class="amount">${r.fixed ? '' : '± '}${money(r.expected)}</span></div>`)
    ].filter(Boolean);

    return `
      <div class="page-head"><h1>Overzicht</h1></div>
      ${timeline()}
      <div class="card hero">
        <div class="hero-stat"><div class="label">Binnen</div><div class="value pos">${money(sum.netIncome)}</div><div class="hint">netto inkomsten${sum.incomeCosts ? ' (na ' + money(sum.incomeCosts) + ' kosten)' : ''}</div></div>
        <div class="hero-stat"><div class="label">Buiten</div><div class="value">${money(sum.expenses)}</div><div class="hint">uitgaven, na terugbetalingen</div></div>
        <div class="hero-stat main"><div class="label">${sum.net >= 0 ? 'Over' : 'Tekort'}</div><div class="value ${sum.net >= 0 ? 'pos' : 'negv'}">${money(Math.abs(sum.net))}</div><div class="hint">${sum.net >= 0 && sum.netIncome ? Math.round(sum.net / sum.netIncome * 100) + '% van je netto inkomen' : sum.net < 0 ? 'meer uitgegeven dan verdiend' : ''}</div></div>
        <div class="hero-stat"><div class="label">Vermogen</div><div class="value">${money(worth)}</div><div class="hint">rekeningen${invSum ? ' + beleggingen' : ''}${metalSum.value ? ' + goud' : ''}</div></div>
      </div>
      <div class="grid two dash-top">
        <div class="card todo-card"><h2>Te doen</h2>${todoItems.length ? `<div class="todo-list">${todoItems.join('')}</div>` : '<p class="muted">🎉 Niets te doen. Alles is verwerkt.</p>'}</div>
        ${savingsCard(lines)}
      </div>
      <details class="more-details" data-keep="dashMore" ${(ui.keepOpen.dashMore != null ? ui.keepOpen.dashMore : window.innerWidth > 700) ? 'open' : ''}>
        <summary><strong>Meer details</strong> <span class="small muted">· inkomsten tegenover uitgaven, per maand, vermogen door de tijd</span></summary>
        ${incomeVsExpenses(sum, lines, range, multi)}
        <div class="card" style="margin-bottom:16px"><h2>Vermogen door de tijd</h2>${netWorthChart(range)}</div>
        <div class="card">
          <h2>Vermogen</h2>
          <div class="list">
            ${balances.map(x => `<div class="list-row"><div class="grow">${esc(x.a.name)}<div class="small muted">gekend saldo van ${fmtDate(x.b.since)} + latere transacties</div></div><span class="amount">${money(x.b.amount)}</span></div>`).join('')}
            ${invSum ? `<div class="list-row"><div class="grow">Beleggingen<div class="small muted">stand ${fmtDate(inv().positionsDate)}</div></div><span class="amount">${money(invSum.valueEur)}</span></div>` : ''}
            ${metalSum.value ? `<div class="list-row"><div class="grow">Goud en zilver (fysiek)<div class="small muted">${metalSum.giftValue ? 'waarvan ' + money(metalSum.giftValue) + ' gekregen als cadeau' : 'aan de huidige goudprijs'}</div></div><span class="amount">${money(metalSum.value)}</span></div>` : ''}
            ${adv.totalOpen > 0 ? `<div class="list-row"><div class="grow">Nog terug te krijgen van vrienden</div><span class="amount">${money(adv.totalOpen)}</span></div>` : ''}
            ${adv.totalPrepaid > 0 ? `<div class="list-row"><div class="grow">Vooruitbetaald door anderen<div class="small muted">staat op je rekening, maar moet je nog voor hen uitgeven</div></div><span class="amount">${money(-adv.totalPrepaid)}</span></div>` : ''}
            <div class="list-row total"><div class="grow"><strong>Totaal</strong></div><span class="amount">${money(worth)}</span></div>
          </div>
          ${state.accounts.some(a => a.type !== 'cash' && !C.accountBalance(state, a.id)) ? '<p class="small muted">Niet voor elke rekening is een saldo gekend. Geef het in bij Bank → rekening → Bewerk.</p>' : ''}
        </div>
      </details>`;
  }

  /** Gespaard dit jaar (beleggingsrekening + spaarrekeningen), met een doel dat je zelf kiest. */
  function savingsCard(lines) {
    const y = today.slice(0, 4);
    const sv = C.savingsIn(state, { start: y + '-01-01', end: y + '-12-31' }, lines);
    const prev = C.savingsIn(state, { start: (y - 1) + '-01-01', end: (y - 1) + '-' + today.slice(5) }, lines);
    const goal = Number(state.settings.savingsGoal) || 0;
    const dayOfYear = C.daysBetween(y + '-01-01', today) + 1;
    const yearDays = C.daysBetween(y + '-01-01', y + '-12-31') + 1;
    const expected = goal ? Math.round(goal * dayOfYear / yearDays) : 0;
    const pct = goal ? Math.max(0, Math.min(1, sv.total / goal)) : 0;
    const editing = ui.editGoal || !goal;
    const parts = [sv.invested ? `${moneyHtml(sv.invested)} naar je beleggingsrekening` : '', sv.toSavings ? `${moneyHtml(sv.toSavings)} naar je spaarrekening${state.accounts.filter(a => a.type === 'spaar').length > 1 ? 'en' : ''}` : ''].filter(Boolean);
    const pace = !goal ? '' : sv.total >= goal ? '🎉 Doel gehaald!' : sv.total >= expected ? `✓ Je ligt op schema (verwacht tegen vandaag: ${money(expected)}).` : `Je ligt ${money(expected - sv.total)} achter op schema.`;
    return `<div class="card savings">
      <div class="sv-head"><h2>💰 Gespaard in ${y}</h2><span class="spacer"></span>${goal && !ui.editGoal ? '<button class="btn small ghost" data-action="goal-edit">Doel wijzigen</button>' : ''}</div>
      <div class="sv-main">
        <div><div class="sv-amount ${sv.total >= 0 ? '' : 'negv'}">${money(sv.total)}</div>
          <div class="small muted">${parts.length ? parts.join(' + ') : 'Nog niets naar je beleggings- of spaarrekening dit jaar.'}${prev.total ? ` · vorig jaar rond deze tijd: ${moneyHtml(prev.total)}` : ''}</div></div>
        ${goal ? `<div class="sv-goal"><div class="small muted">Doel: <strong>${moneyHtml(goal)}</strong> per jaar · ${Math.round(pct * 100)}%</div>
          <div class="sv-track"><span class="sv-fill" style="width:${(pct * 100).toFixed(1)}%"></span><span class="sv-pace" style="left:${(Math.min(1, dayOfYear / yearDays) * 100).toFixed(1)}%" title="Waar je vandaag zou moeten staan"></span></div>
          <div class="small">${pace}${sv.total < goal ? ` Nog ${money(goal - sv.total)} te gaan.` : ''}</div></div>` : ''}
      </div>
      ${editing ? `<form data-form="savings-goal" class="sv-form">
        <label class="field"><span>${goal ? 'Nieuw spaardoel' : 'Stel een spaardoel in'} <span class="muted small">(per jaar)</span></span><input type="text" name="goal" inputmode="decimal" placeholder="bv. 6.000" value="${goal ? esc((goal / 100).toFixed(0)) : ''}"></label>
        <button class="btn primary" type="submit">Opslaan</button>${goal ? '<button class="btn ghost" type="button" data-action="goal-cancel">Annuleren</button>' : ''}
      </form>` : ''}
      <p class="small muted">Telt als gespaard: stortingen op je beleggingsrekening (min opnames) en overschrijvingen naar je eigen spaarrekeningen (min wat je er weer afhaalt).</p>
    </div>`;
  }

  /**
   * Inkomsten tegenover uitgaven: één schaal voor beide kanten, zodat je meteen ziet wat er binnenkwam,
   * waar het naartoe ging en wat er overbleef. Daaronder het verloop per maand.
   */
  function incomeVsExpenses(sum, lines, range, multi) {
    const cats = new Map(state.categories.map(c => [c.id, c]));
    const exp = {};
    for (const l of lines) {
      if (!C.inRange(l.date, range)) continue;
      const c = l.categoryId ? cats.get(l.categoryId) : null;
      const kind = c ? c.kind : (l.amount > 0 ? 'income' : 'expense');
      if (kind !== 'expense' || (c && c.incomeId && cats.has(c.incomeId))) continue;
      const k = l.categoryId || '__none__';
      exp[k] = (exp[k] || 0) - l.amount;
    }
    const expList = Object.entries(exp).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const TOP = 6;
    const expRows = expList.slice(0, TOP).map(([id, v]) => ({ id, v }));
    const rest = expList.slice(TOP).reduce((a, [, v]) => a + v, 0);
    if (rest > 0) expRows.push({ id: '__rest__', v: rest, n: expList.length - TOP });
    const incRows = Object.entries(sum.byIncome).filter(([, v]) => v.net > 0).sort((a, b) => b[1].net - a[1].net).map(([id, v]) => ({ id, v: v.net, gross: v.gross, costs: v.costs }));
    const inc = sum.netIncome, out = sum.expenses, left = inc - out;
    const max = Math.max(1, inc, out);
    const pct = (v, t) => t > 0 ? Math.round(v / t * 100) + '%' : '';
    const name = id => id === '__none__' ? 'Nog niet gekoppeld' : id === '__rest__' ? 'Andere' : catLabel(id);
    const row = (r, cls, total) => `<div class="ive-row ${r.id !== '__rest__' ? 'cat-link' : ''}" ${r.id !== '__rest__' ? `data-action="cat-view" data-cat="${esc(r.id)}"` : ''} title="${esc(name(r.id))}: ${money(r.v)} (${pct(r.v, total)})${r.costs ? ' — bruto ' + money(r.gross) + ', kosten ' + money(r.costs) : ''}">
        <span class="ive-name">${r.id === '__rest__' ? `Andere <span class="muted small">(${r.n})</span>` : esc(name(r.id))}</span>
        <span class="ive-track"><span class="ive-fill ${cls}" style="width:${(r.v / max * 100).toFixed(2)}%"></span></span>
        <span class="ive-amt">${money(r.v)}<span class="muted small"> ${pct(r.v, total)}</span></span></div>`;
    const end = range.end > today ? today.slice(0, 7) : range.end.slice(0, 7);
    const from = multi ? ui.range.from : shiftMonth(end, -11);
    return `<div class="card ive" style="margin-bottom:16px">
      <h2>Inkomsten tegenover uitgaven</h2>
      <div class="ive-balance">
        <div class="ive-line"><span class="ive-label">Netto inkomsten</span><span class="ive-track big"><span class="ive-fill s1" style="width:${(Math.max(0, inc) / max * 100).toFixed(2)}%"></span></span><strong class="ive-amt">${money(inc)}</strong></div>
        <div class="ive-line"><span class="ive-label">Uitgaven</span><span class="ive-track big"><span class="ive-fill s2" style="width:${(Math.max(0, out) / max * 100).toFixed(2)}%"></span></span><strong class="ive-amt">${money(out)}</strong></div>
        <div class="ive-result ${left >= 0 ? 'pos' : 'negv'}">${left >= 0
          ? `<strong>${money(left)} over</strong> <span class="muted">· je hield ${pct(left, inc) || '—'} van je netto inkomen over</span>`
          : `<strong>${money(-left)} tekort</strong> <span class="muted">· je gaf meer uit dan er binnenkwam</span>`}</div>
      </div>
      <div class="ive-cols">
        <div><h3>Waar het vandaan kwam</h3>${incRows.length ? incRows.map(r => row(r, 's1', Math.max(inc, incRows.reduce((a, x) => a + x.v, 0)))).join('') : '<p class="muted small">Geen inkomsten in deze periode.</p>'}</div>
        <div><h3>Waar het naartoe ging</h3>${expRows.length ? expRows.map(r => row(r, 's2', Math.max(out, expRows.reduce((a, x) => a + x.v, 0)))).join('') : '<p class="muted small">Geen uitgaven in deze periode.</p>'}
          ${expRows.length ? '<p class="small"><a href="#expenses" data-view-link="expenses">Alle uitgaven bekijken →</a></p>' : ''}</div>
      </div>
      <p class="small muted">Alle balken gebruiken dezelfde schaal. Voorschotten, beleggingen en overschrijvingen tussen je eigen rekeningen tellen niet mee; terugbetalingen verminderen de uitgave.</p>
      <h3 style="margin-top:16px">Per maand${multi ? '' : ' <span class="muted small">(laatste 12 maanden · klik op een maand om ze te bekijken)</span>'}</h3>
      ${monthList(lines, from, end)}
    </div>`;
  }

  /** Datums voor een tijdreeks: per dag bij een korte periode, anders elk maandeinde (en vandaag). */
  function seriesDates(range) {
    const end = range.end > today ? today : range.end;
    const days = C.daysBetween(range.start, end);
    const out = [];
    if (days <= 100) {
      const step = days > 45 ? 2 : 1;
      for (let d = range.start; d <= end; d = C.addDays(d, step)) out.push(d);
    } else {
      for (let m = range.start.slice(0, 7); m <= end.slice(0, 7); m = shiftMonth(m, 1)) {
        const me = C.periodRange('monthly', m + '-01').end;
        out.push(me > end ? end : me);
      }
      if (out[0] !== range.start) out.unshift(C.addDays(range.start, -1));
    }
    if (out[out.length - 1] !== end) out.push(end);
    return out;
  }

  /** Vermogen per datum: banksaldi (teruggerekend uit transacties) + beleggingen (gereconstrueerd). */
  /**
   * Periode waarvoor Helder gegevens heeft over een rekening: vanaf de eerste transactie (of het gekende saldo)
   * tot de laatste import / ophaalbeurt. Daarbuiten is het saldo onbekend en tekent Helder niets.
   */
  function accountCoverage(a) {
    const txDates = state.transactions.filter(t => t.accountId === a.id).map(t => t.date).sort();
    let from = txDates[0] || null;
    if (a.balance && a.balance.date && (!from || a.balance.date < from)) from = a.balance.date;
    if (!from) return null;
    if (state.settings.dataFrom && from < state.settings.dataFrom) from = state.settings.dataFrom;
    let to = txDates[txDates.length - 1] || from;
    if (a.balance && a.balance.date > to) to = a.balance.date;
    for (const i of state.imports || []) if (i.accountId === a.id && i.period && i.period.to > to) to = i.period.to;
    if (a.ebFetchedAt && a.ebFetchedAt.slice(0, 10) > to) to = a.ebFetchedAt.slice(0, 10);
    if (a.type === 'cash' || !(state.imports || []).some(i => i.accountId === a.id)) to = today; // manuele rekening: tot vandaag
    return { from: C.addDays(from, -1), to };
  }

  function netWorthSeries(range) {
    const dates = seriesDates(range);
    const accounts = state.accounts.filter(a => a.balance && a.balance.amount != null);
    const iv = inv();
    const invest = iv && Invest.canEstimate(iv) ? Invest.valueSeries(iv, dates) : null;
    const comps = accounts.map(a => {
      const cov = accountCoverage(a);
      return { id: a.id, name: a.name, cov, values: dates.map(d => !cov || d < cov.from || d > cov.to ? null : C.balanceAt(state, a.id, d)) };
    });
    if (invest) {
      const first = (iv.trades || []).concat(iv.movements || []).map(x => x.date).sort()[0];
      comps.push({ id: '__invest', name: 'Beleggingen (Degiro)', cov: first ? { from: first, to: today } : null,
        values: invest.map((v, i) => !first || dates[i] < first ? null : v.valueEur), quality: invest.some(v => !v.actual && v.quality !== 'market') ? 'trades' : 'market' });
    }
    const known = dates.map((d, i) => comps.filter(c => c.values[i] != null).length);
    const totals = dates.map((d, i) => known[i] ? comps.reduce((sum, c) => sum + (c.values[i] || 0), 0) : null);
    return { dates, comps, totals, known };
  }

  /** Aaneengesloten stukken [i0, i1] waar f(i) waar is. */
  function runs(n, f) {
    const out = [];
    let s0 = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && f(i);
      if (on && s0 < 0) s0 = i;
      if (!on && s0 >= 0) { out.push([s0, i - 1]); s0 = -1; }
    }
    return out;
  }

  function netWorthChart(range) {
    const ser = netWorthSeries(range);
    const missing = state.accounts.filter(a => a.type !== 'cash' && !(a.balance && a.balance.amount != null) && state.transactions.some(t => t.accountId === a.id));
    if (!ser.comps.length) return `<p class="muted">Om je vermogen door de tijd te tonen heeft Helder voor minstens één rekening een gekend saldo nodig. Bij KBC gebeurt dat automatisch bij het opladen; bij Argenta geef je het één keer in (Bank → rekening → Bewerk).</p>`;
    const narrow = window.innerWidth < 700;
    const W = narrow ? 400 : 760, H = narrow ? 190 : 210, L = narrow ? 52 : 70, R = narrow ? 64 : 170, T = 14, B = 26;
    const n = ser.dates.length;
    // Gestapeld: positieve saldi naar boven, negatieve (bv. kredietkaart) naar onder
    const up = ser.comps.map(() => []), lo = ser.comps.map(() => []);
    for (let i = 0; i < n; i++) {
      let pos = 0, neg = 0;
      ser.comps.forEach((c, ci) => {
        const v = c.values[i];
        if (v == null) { up[ci][i] = lo[ci][i] = null; return; }
        if (v >= 0) { lo[ci][i] = pos; pos += v; up[ci][i] = pos; } else { up[ci][i] = neg; neg += v; lo[ci][i] = neg; }
      });
    }
    const flat = up.flat().concat(lo.flat()).filter(v => v != null);
    const maxV = Math.max(1, ...flat), minV = Math.min(0, ...flat);
    const top = maxV * 1.06, bottom = minV * 1.06;
    const x = i => L + (n <= 1 ? 0 : i / (n - 1)) * (W - L - R);
    const y = v => T + (top - v) / (top - bottom || 1) * (H - T - B);
    const half = n > 1 ? (W - L - R) / (n - 1) / 2 : 6;
    const band = (i0, i1) => [Math.max(L, x(i0) - (i0 ? half : 0)), Math.min(W - R, x(i1) + (i1 < n - 1 ? half : 0))];
    const slots = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
    // Een laag breekt waar de samenstelling verandert (een rekening begint of stopt), zodat er nooit een schuine sprong ontstaat
    const sig = i => ser.comps.map(c => c.values[i] == null ? 0 : 1).join('');
    const layerRuns = c => { const out = []; for (const [a, b] of runs(n, i => c.values[i] != null)) { let st = a; for (let i = a + 1; i <= b; i++) if (sig(i) !== sig(i - 1)) { out.push([st, i - 1]); st = i; } out.push([st, b]); } return out; };
    const layers = ser.comps.map((c, ci) => layerRuns(c).map(([i0, i1]) => {
      const idx = []; for (let i = i0; i <= i1; i++) idx.push(i);
      if (idx.length === 1) { const [a, b] = band(i0, i1); return `<rect x="${a}" width="${Math.max(2, b - a)}" y="${y(up[ci][i0])}" height="${Math.max(1, y(lo[ci][i0]) - y(up[ci][i0]))}" fill="${slots[ci % slots.length]}" class="nw-layer"/>`; }
      const d = 'M' + idx.map(i => x(i).toFixed(1) + ' ' + y(up[ci][i]).toFixed(1)).join(' L') + ' L' + idx.slice().reverse().map(i => x(i).toFixed(1) + ' ' + y(lo[ci][i]).toFixed(1)).join(' L') + ' Z';
      const edge = 'M' + idx.map(i => x(i).toFixed(1) + ' ' + y(c.values[i] >= 0 ? up[ci][i] : lo[ci][i]).toFixed(1)).join(' L');
      return `<path d="${d}" fill="${slots[ci % slots.length]}" class="nw-layer"/><path d="${edge}" stroke="${slots[ci % slots.length]}" class="nw-edge"/>`;
    }).join('')).join('');
    const complete = i => ser.totals[i] != null && ser.known[i] === ser.comps.length;
    // Geen of onvolledige gegevens: gearceerd
    const none = runs(n, i => !ser.known[i]);
    const partial = runs(n, i => ser.known[i] && ser.known[i] < ser.comps.length);
    const hatch = (rs, cls, label) => rs.map(([i0, i1]) => { const [a, b] = band(i0, i1); return `<rect x="${a}" y="${T}" width="${Math.max(2, b - a)}" height="${H - T - B}" class="${cls}"/>` + (label && b - a > 70 ? `<text x="${(a + b) / 2}" y="${T + (H - T - B) / 2}" text-anchor="middle" class="nodata-label">${label}</text>` : ''); }).join('');
    const raw = (top - bottom) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const stepV = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= raw) || mag * 10;
    const ticks = [];
    for (let v = Math.ceil(bottom / stepV) * stepV; v <= top; v += stepV) ticks.push(v);
    const compact = v => Math.abs(v) >= 100000 ? '€ ' + (Math.round(v / 10000) / 10).toString().replace('.', ',') + 'k' : money(v);
    const labelEvery = Math.ceil(n / (narrow ? 5 : 10));
    const xLabel = d => n > 100 || ser.dates[n - 1].slice(0, 4) !== ser.dates[0].slice(0, 4) ? MONTHS_SHORT[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(2, 4) : d.slice(8, 10) + '/' + d.slice(5, 7);
    // Eindlabels (in het midden van elke laag), zonder overlap
    const lastKnown = (() => { for (let i = n - 1; i >= 0; i--) if (complete(i)) return i; for (let i = n - 1; i >= 0; i--) if (ser.totals[i] != null) return i; return -1; })();
    const ends = lastKnown < 0 ? [] : ser.comps.map((c, ci) => ({ ci, v: c.values[lastKnown], y: up[ci][lastKnown] == null ? null : y((up[ci][lastKnown] + lo[ci][lastKnown]) / 2) }))
      .filter(e => e.y != null);
    if (lastKnown >= 0) {
      ends.push({ total: true, y: y(ser.totals[lastKnown]) - 6 });
    }
    ends.sort((a, b) => a.y - b.y || (a.total ? -1 : a.when ? (b.total ? 1 : -1) : 1));
    if (ends.length) ends[0].y = Math.max(12, ends[0].y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    nwData = { ser, x0: L, x1: W - R, W, n };
    const invComp = ser.comps.find(c => c.id === '__invest');
    const noneAll = !ser.known.some(Boolean);
    const gapComps = ser.comps.filter(c => c.values.some(v => v == null));
    return `
      <div class="legend">
        ${ser.comps.map((c, ci) => `<span><i class="sw" style="background:${slots[ci % slots.length]}"></i>${esc(c.name)}</span>`).join('')}
        ${none.length || partial.length ? '<span><i class="sw nodata-sw"></i>geen gegevens</span>' : ''}
      </div>
      <div class="chart-wrap" id="nw-chart">
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Evolutie van je totale vermogen, gestapeld per rekening">
          <defs><pattern id="nodata-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" class="hatch-line"/></pattern></defs>
          ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`).join('')}
          ${ser.dates.map((d, i) => i % labelEvery === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${xLabel(d)}</text>` : '').join('')}
          ${hatch(none, 'nodata', 'Geen gegevens')}${hatch(partial, 'nodata partial', '')}
          ${layers}
          ${ends.map(e => { if (e.total) return `<text x="${W - R + 8}" y="${e.y + 4}" class="direct">${compact(ser.totals[lastKnown])}${narrow ? '' : ' totaal'}${lastKnown < n - 1 && !narrow ? `<tspan class="muted-fill small-label"> · ${fmtDate(ser.dates[lastKnown]).slice(0, 5)}</tspan>` : ''}</text>`;
            if (e.when) return `<text x="${W - R + 8}" y="${e.y + 4}" class="direct muted-fill small-label">op ${fmtDate(ser.dates[lastKnown])}</text>`;
            const nm = ser.comps[e.ci].name; return `<text x="${W - R + 8}" y="${e.y + 4}" class="direct muted-fill"><title>${esc(nm)}</title>${narrow ? '' : esc(nm.length > 11 ? nm.slice(0, 10) + '…' : nm) + ' '}${compact(e.v || 0)}</text>`; }).join('')}
          <line class="crosshair" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>
        </svg>
        <div class="chart-tip" hidden></div>
      </div>
      ${noneAll ? '<p class="small muted">Voor deze periode heeft Helder geen gegevens. Kies een andere periode, of laad oudere bankbestanden op.</p>'
        : gapComps.length ? `<p class="small muted">Gearceerd = geen (volledige) gegevens. ${gapComps.map(c => `<strong>${esc(c.name)}</strong>${c.cov ? ': gegevens van ' + fmtDate(C.addDays(c.cov.from, 1)) + ' tot ' + fmtDate(c.cov.to) : ': geen gegevens'}`).join(' · ')}. Het totaal staat er enkel waar alles gekend is. Laad een recenter bankbestand op of koppel je bank om de grafiek bij te werken.</p>` : ''}
      ${missing.length ? `<p class="small muted">Niet meegeteld omdat het saldo niet gekend is: ${missing.map(a => `<a href="#" data-action="edit-account" data-id="${esc(a.id)}">${esc(a.name)}</a>`).join(', ')}. Geef het saldo één keer in, dan rekent Helder de rest uit je transacties.</p>` : ''}
      ${invComp ? `<p class="small muted">Beleggingen: ${invComp.quality === 'market' ? 'gereconstrueerd uit je transacties met historische marktkoersen.' : 'gereconstrueerd uit je transacties; tussen je aankopen geschat met je aankoopkoersen' + (Sync && Sync.mode === 'server' ? ' (historische koersen worden opgehaald zodra mogelijk).' : '. Met Helder op je server worden historische marktkoersen gebruikt.')}</p>` : ''}
      <details><summary class="small">Toon als tabel</summary><div class="table-wrap"><table><thead><tr><th>Datum</th>${ser.comps.map(c => `<th class="right">${esc(c.name)}</th>`).join('')}<th class="right">Totaal</th></tr></thead>
        <tbody>${ser.dates.map((d, i) => `<tr><td>${fmtDate(d)}</td>${ser.comps.map(c => `<td class="amount">${c.values[i] == null ? '<span class="muted">geen gegevens</span>' : money(c.values[i])}</td>`).join('')}<td class="amount"><strong>${ser.totals[i] == null ? '—' : money(ser.totals[i])}</strong></td></tr>`).reverse().join('')}</tbody></table></div></details>`;
  }

  let nwData = null;
  function onNwMove(ev) {
    const wrap = $('#nw-chart');
    if (!wrap || !nwData) return;
    const svg = $('svg', wrap);
    const rect = svg.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) / rect.width * nwData.W;
    const i = Math.max(0, Math.min(nwData.n - 1, Math.round((sx - nwData.x0) / (nwData.x1 - nwData.x0) * (nwData.n - 1))));
    const bx = nwData.x0 + (nwData.n <= 1 ? 0 : i / (nwData.n - 1)) * (nwData.x1 - nwData.x0);
    const line = $('.crosshair', svg);
    line.setAttribute('x1', bx); line.setAttribute('x2', bx); line.style.display = '';
    const tip = $('.chart-tip', wrap);
    tip.hidden = false;
    const s = nwData.ser;
    tip.innerHTML = `<strong>${fmtDate(s.dates[i])}</strong><br>` + s.comps.map(c => `${esc(c.name)}: ${c.values[i] == null ? '<em>geen gegevens</em>' : money(c.values[i])}`).join('<br>') + `<hr><strong>Totaal: ${s.totals[i] == null ? 'geen gegevens' : money(s.totals[i]) + (s.known[i] < s.comps.length ? ' (onvolledig)' : '')}</strong>`;
    const left = (bx / nwData.W) * rect.width;
    tip.style.left = Math.min(rect.width - 220, Math.max(0, left + 12)) + 'px';
  }

  /** Heeft Helder gegevens voor deze maand? 'full', 'partial' (niet voor alle bankrekeningen) of 'none'. */
  function monthCoverage(m) {
    const r = C.periodRange('monthly', m + '-01');
    if (r.start > today) return { status: 'none', missing: [] };
    const banks = state.accounts.filter(a => a.type !== 'cash').map(a => ({ a, cov: accountCoverage(a) })).filter(x => x.cov);
    const covered = banks.filter(x => x.cov.from < r.end && x.cov.to >= r.start);
    const anyTx = state.transactions.some(t => t.date >= r.start && t.date <= r.end);
    if (!covered.length && !anyTx) return { status: 'none', missing: [] };
    const missing = banks.filter(x => !covered.includes(x)).map(x => x.a.name);
    return { status: missing.length ? 'partial' : 'full', missing };
  }

  /**
   * Maand per maand als lijst: nieuwste bovenaan, per maand wat binnenkwam, wat buitenging en wat overbleef.
   * Eén schaal voor alle balken; klik op een maand om ze te bekijken.
   */
  function monthList(lines, from, to) {
    const months = [];
    for (let m = from; m <= to; m = shiftMonth(m, 1)) months.push(m);
    const data = months.map(m => { const x = C.summarize(state, C.periodRange('monthly', m + '-01'), lines); return Object.assign({ m, inc: x.netIncome, exp: x.expenses }, monthCoverage(m)); }).reverse();
    const known = data.filter(d => d.status !== 'none');
    const max = Math.max(1, ...known.map(d => Math.max(d.inc, d.exp)));
    const full = data.filter(d => d.status === 'full' && d.m < today.slice(0, 7));
    const avg = full.length ? { inc: Math.round(full.reduce((a, d) => a + d.inc, 0) / full.length), exp: Math.round(full.reduce((a, d) => a + d.exp, 0) / full.length) } : null;
    const sel = ui.range.from === ui.range.to ? ui.range.from : null;
    const w = v => (Math.max(0, v) / max * 100).toFixed(2);
    const name = m => MONTHS_SHORT[Number(m.slice(5)) - 1] + ' ' + m.slice(0, 4);
    return `<div class="month-list" role="table" aria-label="Inkomsten en uitgaven per maand">
      <div class="ml-head" role="row"><span>Maand</span><span><i class="sw s1"></i>Netto inkomsten <i class="sw s2" style="margin-left:10px"></i>Uitgaven</span><span class="right">Over</span></div>
      ${data.map(d => d.status === 'none'
        ? `<div class="ml-row none" role="row"><span class="ml-month">${name(d.m)}</span><span class="muted small">geen gegevens</span><span></span></div>`
        : `<button class="ml-row ${d.m === sel ? 'active' : ''}" role="row" data-action="month-select" data-m="${d.m}" title="${esc(monthLabel(d.m))} bekijken">
          <span class="ml-month">${name(d.m)}${d.m === today.slice(0, 7) ? ' <span class="badge small">lopend</span>' : ''}${d.status === 'partial' ? ` <span class="small muted" title="Geen gegevens voor ${esc(d.missing.join(', '))}">onvolledig</span>` : ''}</span>
          <span class="ml-bars">
            <span class="ml-bar"><span class="ml-track"><i class="s1" style="width:${w(d.inc)}%"></i></span><b>${money(d.inc)}</b></span>
            <span class="ml-bar"><span class="ml-track"><i class="s2" style="width:${w(d.exp)}%"></i></span><b>${money(d.exp)}</b></span>
          </span>
          <span class="ml-net ${d.inc - d.exp >= 0 ? 'pos' : 'negv'}">${d.inc - d.exp >= 0 ? '+' : '−'}${money(Math.abs(d.inc - d.exp))}</span>
        </button>`).join('')}
      ${avg ? `<div class="ml-row avg" role="row"><span class="ml-month">Gemiddeld</span><span class="small muted">per volledige maand: ${money(avg.inc)} binnen, ${money(avg.exp)} buiten</span><span class="ml-net ${avg.inc - avg.exp >= 0 ? 'pos' : 'negv'}">${avg.inc - avg.exp >= 0 ? '+' : '−'}${money(Math.abs(avg.inc - avg.exp))}</span></div>` : ''}
    </div>`;
  }

  /** Netto inkomsten en uitgaven per maand in de gekozen periode. */
  function monthBars(lines, from, to) {
    const months = [];
    for (let m = from || ui.range.from; m <= (to || ui.range.to); m = shiftMonth(m, 1)) months.push(m);
    const data = months.map(m => { const x = C.summarize(state, C.periodRange('monthly', m + '-01'), lines); return Object.assign({ m, inc: x.netIncome, exp: x.expenses }, monthCoverage(m)); });
    const max = Math.max(1, ...data.map(d => Math.max(d.inc, d.exp)));
    const narrow = window.innerWidth < 700;
    const W = narrow ? 400 : 760, H = 200, L = 8, T = 10, B = 24, bw = (W - L * 2) / data.length;
    const h = v => Math.max(0, v) / max * (H - T - B);
    const gap = 2, w = Math.max(2, Math.min(28, bw / 2 - gap - 2));
    const labelEvery = Math.ceil(data.length / (narrow ? 6 : 12));
    const gaps = data.some(d => d.status !== 'full');
    return `<div class="legend"><span><i class="sw line s1"></i>Netto inkomsten</span><span><i class="sw line s2"></i>Uitgaven</span>${gaps ? '<span><i class="sw nodata-sw"></i>geen / onvolledige gegevens</span>' : ''}</div>
      <div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Netto inkomsten en uitgaven per maand" class="bars">
        <defs><pattern id="nodata-hatch-b" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" class="hatch-line"/></pattern></defs>
        <line x1="${L}" x2="${W - L}" y1="${H - B}" y2="${H - B}" class="grid-line"/>
        ${data.map((d, i) => { const cx = L + i * bw + bw / 2; return `<g class="bar-group"><title>${monthLabel(d.m)} — ${d.status === 'none' ? 'geen gegevens' : `netto inkomsten ${money(d.inc)}, uitgaven ${money(d.exp)}, over ${money(d.inc - d.exp)}${d.status === 'partial' ? ' (onvolledig: geen gegevens voor ' + d.missing.join(', ') + ')' : ''}`}</title>
          <rect x="${cx - bw / 2}" y="${T}" width="${bw}" height="${H - T - B}" class="hit"/>
          ${d.status === 'none' ? `<rect x="${cx - bw / 2 + 1}" y="${T}" width="${Math.max(1, bw - 2)}" height="${H - T - B}" class="nodata"/>${bw > 34 ? `<text x="${cx}" y="${(H - B + T) / 2}" text-anchor="middle" class="nodata-label small-label">geen</text><text x="${cx}" y="${(H - B + T) / 2 + 13}" text-anchor="middle" class="nodata-label small-label">gegevens</text>` : ''}` : ''}
          ${d.status === 'partial' ? `<rect x="${cx - bw / 2 + 1}" y="${T}" width="${Math.max(1, bw - 2)}" height="${H - T - B}" class="nodata partial"/>` : ''}
          <rect x="${cx - w - gap / 2}" y="${H - B - h(d.inc)}" width="${w}" height="${h(d.inc)}" rx="3" class="b1"/>
          <rect x="${cx + gap / 2}" y="${H - B - h(d.exp)}" width="${w}" height="${h(d.exp)}" rx="3" class="b2"/>
          ${i % labelEvery === 0 ? `<text x="${cx}" y="${H - 6}" text-anchor="middle">${MONTHS_SHORT[Number(d.m.slice(5)) - 1]}${d.m.slice(5) === '01' || i === 0 ? ' ' + d.m.slice(2, 4) : ''}</text>` : ''}</g>`; }).join('')}
      </svg></div>
      <details><summary class="small">Toon als tabel</summary><div class="table-wrap"><table><thead><tr><th>Maand</th><th class="right">Netto inkomsten</th><th class="right">Uitgaven</th><th class="right">Over</th></tr></thead>
        <tbody>${data.map(d => d.status === 'none' ? `<tr><td>${esc(monthLabel(d.m))}</td><td colspan="3" class="muted">geen gegevens</td></tr>` : `<tr><td>${esc(monthLabel(d.m))}${d.status === 'partial' ? ' <span class="small muted">(onvolledig)</span>' : ''}</td><td class="amount">${money(d.inc)}</td><td class="amount">${money(d.exp)}</td><td class="amount ${d.inc - d.exp >= 0 ? 'pos' : 'negv'}">${money(d.inc - d.exp)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }

  // ----- Bank -----

  function bankTxFilter(t) {
    const f = ui.bank;
    if (f.account && t.accountId !== f.account) return false;
    // Categorie: ook gesplitste transacties en terugbetalingen die (deels) in die categorie vallen
    if (f.category) {
      const ids = C.splitLines(t).map(l => l.categoryId || '__none__');
      const orig = t.refundOf ? txById(t.refundOf) : null;
      if (orig) ids.push(...C.splitLines(orig).map(l => l.categoryId || '__none__'));
      if (t.isTransfer ? f.category !== '__transfer__' : !ids.includes(f.category)) return false;
    }
    const k = kindOf(t);
    if (f.status === 'todo' && k !== 'todo') return false;
    if (f.status === 'done' && k === 'todo') return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!`${t.title || ''} ${t.counterparty} ${t.description} ${t.note || ''} ${C.centsToInput(t.amount)}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  /** Eén keuzelijst om een transactie te koppelen aan wat ze is. */
  /** Keuzes om een transactie te koppelen (zelfde opties als vroeger in de keuzelijst). */
  function assignOptions(t, bulk) {
    const incoming = t ? t.amount > 0 : false;
    const out = [];
    const add = (value, label, group, hint) => out.push({ value, label, group, hint: hint || '' });
    const cats = (kind, group) => state.categories.filter(c => c.kind === kind).sort((a, b) => a.name.localeCompare(b.name))
      .forEach(c => add('cat:' + c.id, C.categoryIcon(c) + ' ' + c.name, group, isIncomeCost(c) ? '− ' + catName(c.incomeId) : ''));
    if (bulk) {
      cats('expense', 'Uitgave'); cats('income', 'Inkomst');
      add('cat:' + C.SYS_INVEST, '📈 Belegging (storting/opname)', 'Speciaal');
      add('transfer', '↔ Naar/van eigen rekening', 'Speciaal');
      add('', '— Terug naar te verwerken —', 'Speciaal');
      return out;
    }
    // Inkomend geld: past het bij een uitgave (iemand betaalt je terug, een annulering)? Dan meteen voorstellen.
    const refunds = incoming ? C.suggestRefundTargets(state, t, 4) : [];
    const refundGroup = '↩ Terugbetaling van een uitgave';
    const addRefunds = () => refunds.forEach(r => add('refund:' + r.tx.id, '↩ ' + (r.tx.title || r.tx.counterparty || r.tx.description || 'uitgave') + ' ' + money(r.tx.amount), refundGroup, fmtDate(r.tx.date) + (r.openAmount < -r.tx.amount ? ' · nog ' + money(r.openAmount) + ' open' : '')));
    const strong = refunds.length && Math.abs(C.daysBetween(refunds[0].tx.date, t.date)) <= 7;
    if (incoming) add('whatis', '❓ Wat is dit geld? — ik help je kiezen', 'Hulp');
    if (strong) addRefunds();
    cats(incoming ? 'income' : 'expense', incoming ? 'Inkomst' : 'Uitgave');
    add('new-cat', incoming ? '+ Nieuwe inkomstenbron…' : '+ Nieuwe categorie…', incoming ? 'Inkomst' : 'Uitgave');
    for (const p of C.personList(state).sort((a, b) => a.name.localeCompare(b.name))) {
      add('adv:' + p.name, incoming ? '🤝 Terugbetaling van ' + p.name : '🤝 Voorgeschoten voor ' + p.name, 'Voorschot', incoming && p.stats.open > 0 ? 'nog ' + money(p.stats.open) + ' open' : '');
    }
    add('cat:' + C.SYS_ADVANCE, incoming ? '↙ Terugbetaling van iemand anders…' : '↗ Voorgeschoten voor iemand anders…', 'Voorschot');
    if (incoming) add('whatis:prepaid', '📥 Vooruitbetaald voor iets dat ik nog betaal (bv. Airbnb)…', 'Voorschot');
    if (incoming && !strong) addRefunds();
    if (incoming) add('refund', '↩ Terugbetaling van een andere uitgave…', 'Speciaal');
    add('cat:' + C.SYS_INVEST, '📈 Belegging (storting/opname)', 'Speciaal');
    add('transfer', '↔ Naar/van eigen rekening', 'Speciaal');
    add('split', '✂ Opsplitsen…', 'Speciaal');
    if (t && (t.categoryId || t.isTransfer)) add('', '— Terug naar te verwerken —', 'Speciaal');
    cats(incoming ? 'expense' : 'income', incoming ? 'Toch een uitgave' : 'Toch een inkomst');
    return out;
  }

  function assignLabel(t) {
    if (t.isTransfer) return '↔ Eigen rekening';
    if (t.categoryId === C.SYS_ADVANCE) return t.amount > 0 ? '↙ Terugbetaling voorschot' : '↗ Voorgeschoten';
    if (t.categoryId === C.SYS_INVEST) return '📈 Belegging';
    return t.categoryId ? catLabel(t.categoryId) : '';
  }

  function assignSelect(t) {
    const k = kindOf(t);
    if (k === 'split' || k === 'refund' || (t.splits && t.splits.length)) return `<button class="btn small" data-action="edit-tx" data-id="${esc(t.id)}">${k === 'refund' ? '↩ Terugbetaling' : '✂ Gesplitst'} — bekijk</button>`;
    const label = assignLabel(t);
    return `<div class="assign-box ${label ? '' : 'todo'}"><input type="text" class="assign-input" data-assign-input="${esc(t.id)}" value="${esc(label)}" data-label="${esc(label)}"
      placeholder="Te verwerken — typ…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="Koppelen"><span class="assign-caret" aria-hidden="true">▾</span></div>`;
  }

  // ----- Snel koppelen: typen, pijltjes en Enter -----

  const picker = { input: null, id: null, items: [], index: 0, typed: false };
  const normQ = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  function pickerItems(id, query) {
    const bulk = id === '__bulk__';
    const opts = assignOptions(bulk ? null : txById(id), bulk);
    const q = normQ(query);
    if (!q) return opts;
    const words = q.split(' ');
    return opts.map(o => {
      const n = normQ(o.label + ' ' + o.hint);
      if (!words.every(w => n.includes(w))) return null;
      const name = normQ(o.label);
      const score = name.startsWith(q) ? 0 : name.split(' ').some(w => w.startsWith(words[0])) ? 1 : 2;
      return Object.assign({ score }, o);
    }).filter(Boolean).sort((a, b) => a.score - b.score);
  }

  function openPicker(input, typed) {
    picker.input = input;
    picker.id = input.dataset.assignInput;
    picker.typed = !!typed;
    picker.items = pickerItems(picker.id, typed ? input.value : '');
    picker.index = typed ? 0 : Math.max(0, picker.items.findIndex(o => o.label === input.dataset.label));
    renderPicker();
  }

  function renderPicker() {
    let pop = $('#assign-pop');
    if (!pop) { pop = document.createElement('div'); pop.id = 'assign-pop'; pop.className = 'assign-pop'; pop.setAttribute('role', 'listbox'); document.body.appendChild(pop); }
    if (!picker.input || !document.body.contains(picker.input)) { pop.hidden = true; return; }
    let last = null;
    pop.innerHTML = picker.items.length ? picker.items.map((o, i) => {
      const head = !picker.typed && o.group !== last ? `<div class="assign-group">${esc(o.group)}</div>` : '';
      last = o.group;
      return `${head}<div class="assign-opt ${i === picker.index ? 'active' : ''}" role="option" data-pick="${i}">${esc(o.label)}${o.hint ? ` <span class="muted small">${esc(o.hint)}</span>` : ''}</div>`;
    }).join('') : '<div class="assign-empty">Niets gevonden. <span class="muted">Enter = nieuwe categorie</span></div>';
    const r = picker.input.getBoundingClientRect();
    const width = Math.max(r.width, 240);
    pop.style.width = width + 'px';
    pop.style.left = Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - width - 8)) + 'px';
    const below = window.innerHeight - r.bottom;
    pop.style.maxHeight = Math.max(160, Math.min(320, Math.max(below, r.top) - 16)) + 'px';
    pop.hidden = false;
    if (below < 200 && r.top > below) { pop.style.top = (r.top + window.scrollY - pop.offsetHeight - 4) + 'px'; }
    else pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    picker.input.setAttribute('aria-expanded', 'true');
    const act = $('.assign-opt.active', pop);
    if (act) act.scrollIntoView({ block: 'nearest' });
  }

  function closePicker(restore) {
    const pop = $('#assign-pop');
    if (pop) pop.hidden = true;
    if (picker.input) {
      picker.input.setAttribute('aria-expanded', 'false');
      if (restore) picker.input.value = picker.input.dataset.label || '';
    }
    picker.input = null;
  }

  /** Kiest een optie; met Enter springt Helder meteen naar de volgende transactie. */
  function choosePick(i, viaKeyboard) {
    const input = picker.input;
    if (!input) return;
    const item = picker.items[i];
    const id = picker.id;
    if (!item) {
      if (picker.typed && input.value.trim() && id !== '__bulk__') { closePicker(true); newCategoryFor(id, input.value.trim()); }
      return;
    }
    const all = $$('[data-assign-input]').filter(x => x.dataset.assignInput !== '__bulk__');
    const pos = all.indexOf(input);
    closePicker(false);
    input.blur();
    if (id === '__bulk__') { bulkAssign(item.value); return; }
    assignTx(id, item.value);
    if (viaKeyboard && !modal) {
      requestAnimationFrame(() => {
        const next = $$('[data-assign-input]').filter(x => x.dataset.assignInput !== '__bulk__');
        const stillThere = next.findIndex(x => x.dataset.assignInput === id);
        const target = next[stillThere >= 0 ? stillThere + 1 : pos];
        if (target) { target.focus(); target.select(); }
      });
    }
  }

  function newCategoryFor(id, name) {
    const t = txById(id);
    if (!t) return;
    openModal({ type: 'category', assignTo: t.id, category: { id: C.uid('cat'), name, kind: t.amount > 0 ? 'income' : 'expense', color: t.amount > 0 ? '#37b24d' : '#3b5bdb', lookupTags: '' } });
  }

  // ----- Selecteren en in één keer verwijderen of koppelen -----

  ui.selected = new Set();

  function selectionBar() {
    const n = ui.selected.size;
    if (!n) return '';
    return `<div class="select-bar" role="region" aria-label="Selectie">
      <strong>${n} geselecteerd</strong>
      <div class="assign-box bulk"><input type="text" class="assign-input" data-assign-input="__bulk__" data-label="" value="" placeholder="Koppelen aan… (typ)" autocomplete="off" role="combobox" aria-expanded="false"><span class="assign-caret" aria-hidden="true">▾</span></div>
      ${(() => { const r = bulkRefundTarget(); return r ? `<button class="btn small primary" data-action="bulk-refund" title="De inkomende bedragen tellen als terugbetaling van deze uitgave">↩ ${r.incomes.length === 1 ? 'Terugbetaling' : r.incomes.length + ' terugbetalingen'} van ${esc((r.expense.title || r.expense.counterparty || 'de uitgave').slice(0, 24))} koppelen</button>` : ''; })()}
      <select class="bulk-action" data-bulk-action aria-label="Actie toevoegen"><option value="">✅ Actie toevoegen…</option>${ACTION_IDEAS.map(x => `<option value="idea:${esc(x)}">${esc(x)}</option>`).join('')}${(state.actions || []).some(a => !a.closed) ? `<optgroup label="Bij een open actie">${actionLists().open.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</optgroup>` : ''}<option value="__new__">+ Andere actie…</option></select>
      <button class="btn small danger" data-action="bulk-delete">🗑 Verwijderen</button>
      <button class="btn small ghost" data-action="bulk-clear">Selectie wissen</button></div>`;
  }

  /** Inkomende betalingen koppelen als terugbetaling van één uitgave (met ongedaan maken). */
  function linkRefunds(incomes, expenseId) {
    const o = txById(expenseId);
    if (!o) return;
    const before = incomes.map(t => ({ id: t.id, refundOf: t.refundOf || null, categoryId: t.categoryId || null, categorySource: t.categorySource || null, ruleId: t.ruleId || null, transferMode: t.transferMode }));
    for (const t of incomes) { t.refundOf = o.id; t.categoryId = null; t.categorySource = null; t.ruleId = null; if (t.isTransfer) t.transferMode = 'no'; }
    ui.selected.clear();
    commit();
    const name = o.title || o.counterparty || o.description || 'de uitgave';
    // Netto wat je zelf betaalde: de uitgave min alles wat erop terugbetaald werd
    toast(`Gekoppeld aan ${name}: zelf betaald ${money(-(o.amount + (C.refundTotals(state)[o.id] || 0)))}`, { label: 'Ongedaan maken', run: () => {
      for (const b of before) { const t = txById(b.id); if (t) Object.assign(t, b); }
      commit('Koppeling ongedaan gemaakt');
    } });
  }

  /**
   * Een uitgave kiezen om een terugbetaling aan te koppelen: alle uitgaven (elke datum, elk bedrag),
   * de waarschijnlijkste bovenaan, met zoeken op naam, omschrijving, categorie of bedrag.
   */
  function refundPickModal() {
    const m = modal;
    const t = txById(m.txId) || (m.back && m.back.tx);
    if (!t) return modalShell('Uitgave kiezen', '<p class="muted">Deze transactie bestaat niet meer.</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
    const q = (m.search || '').trim().toLowerCase();
    const refunded = C.refundTotals(state);
    const sugg = new Map(C.suggestRefundTargets(state, t, 8).map((s, i) => [s.tx.id, i]));
    const list = state.transactions.filter(o => o.id !== t.id && o.amount < 0 && !o.isTransfer && !o.refundOf)
      .filter(o => !q || `${o.title || ''} ${o.counterparty} ${o.description} ${o.note || ''} ${o.categoryId ? catName(o.categoryId) : ''} ${C.centsToInput(o.amount)} ${C.centsToInput(-o.amount)}`.toLowerCase().includes(q))
      .sort((a, b) => (sugg.has(a.id) ? sugg.get(a.id) : 1e9) - (sugg.has(b.id) ? sugg.get(b.id) : 1e9) || b.date.localeCompare(a.date))
      .slice(0, 150);
    return modalShell('Bij welke uitgave hoort deze terugbetaling?', `
      <div class="wi-tx"><div><strong>${esc(t.title || t.counterparty || t.description || '—')}</strong><div class="small muted">${fmtDate(t.date)}</div></div><span class="amount pos">${money(t.amount)}</span></div>
      <input type="search" id="rp-search" placeholder="Zoek op naam, omschrijving, categorie of bedrag…" value="${esc(m.search || '')}" autocomplete="off" style="margin-top:10px">
      <div class="search-list" style="margin-top:8px">${list.map(o => {
        const open = -o.amount - (refunded[o.id] || 0);
        return `<button class="search-hit" data-action="refund-pick" data-id="${esc(o.id)}">
          <span class="grow"><strong>${sugg.has(o.id) ? '💡 ' : ''}${esc(o.title || o.counterparty || o.description || '—')}</strong>
            <span class="small muted">${fmtDate(o.date)}${o.categoryId ? ' · ' + esc(catLabel(o.categoryId)) : ''}${refunded[o.id] ? ` · al ${money(refunded[o.id])} terug, nog ${money(open)} open` : ''}${open < t.amount ? ' · <span class="warn-text">kleiner dan deze terugbetaling</span>' : ''}</span></span>
          <span class="amount">${money(o.amount)}</span></button>`;
      }).join('') || '<p class="muted">Geen uitgave gevonden.</p>'}</div>
      <p class="small muted">💡 = waarschijnlijk. Je kan elke uitgave kiezen, ook een oudere. Een terugbetaling op een uitgave met een voorschot-deel gaat eerst naar dat voorschot.</p>`,
      `<span class="spacer"></span><button class="btn" data-action="${m.back ? 'refund-back' : 'close-modal'}">${m.back ? 'Terug' : 'Annuleren'}</button>`, true);
  }

  function chooseRefundTarget(id) {
    const m = modal;
    if (m.back) { m.back.tx.refundOf = id; if (m.back.tx.isTransfer) m.back.tx.transferMode = 'no'; openModal(m.back); return; }
    const t = txById(m.txId);
    closeModal();
    if (t) linkRefunds([t], id);
  }

  function bulkRefundTarget() {
    const sel = Array.from(ui.selected).map(txById).filter(Boolean);
    const out = sel.filter(t => t.amount < 0);
    const ins = sel.filter(t => t.amount > 0);
    if (out.length !== 1 || !ins.length || ins.length + 1 !== sel.length || ins.some(t => t.refundOf === out[0].id)) return null;
    return { expense: out[0], incomes: ins };
  }

  function bulkAssign(value) {
    const ids = Array.from(ui.selected);
    let n = 0;
    for (const id of ids) {
      const t = txById(id);
      if (!t || (t.splits && t.splits.length) || (t.refundOf && value !== '')) continue;
      if (value === 'transfer') { t.transferMode = 'yes'; t.categoryId = null; t.categorySource = null; }
      else if (value === '') resetToTodo(t);
      else { t.categoryId = value.slice(4); t.categorySource = 'manual'; t.ruleId = null; if (t.isTransfer) t.transferMode = 'no'; }
      n++;
    }
    ui.selected.clear();
    ui.ruleHint = null;
    commit(n === 1 ? '1 transactie gekoppeld' : n + ' transacties gekoppeld');
  }

  function bulkDelete() {
    const list = Array.from(ui.selected).map(txById).filter(Boolean);
    if (!list.length) return;
    const fromFile = list.filter(t => t.source === 'import').length;
    const total = list.reduce((sum, t) => sum + t.amount, 0);
    if (!confirm(`${list.length} transactie${list.length === 1 ? '' : 's'} verwijderen (samen ${C.formatMoney(total)})?`
      + (fromFile ? `\n\n${fromFile} ervan kwam${fromFile === 1 ? '' : 'en'} uit een bankbestand of de bankkoppeling. Helder onthoudt ze, zodat ze bij een volgende import niet terugkomen.` : '')
      + '\n\nJe kan ze altijd terugzetten via de prullenbak (onderaan in het tabblad Bank).')) return;
    deleteWithUndo(list.map(t => t.id));
  }

  function txRow(t, opts) {
    opts = opts || {};
    const k = kindOf(t);
    const extra = [];
    if (k === 'advance' || k === 'repayment') extra.push(`<span class="badge advance">👤 ${esc(C.splitLines(t).filter(l => l.categoryId === C.SYS_ADVANCE).map(l => l.person || t.person || '?').join(', '))}</span>`);
    if (opts.recurring && opts.recurring[t.id]) extra.push(`<span class="badge recurring" title="Automatisch herkend als terugkerend">🔁 ${esc(opts.recurring[t.id].frequency.label.toLowerCase())}</span>`);
    if (t.categorySource === 'rule') extra.push('<span class="badge small muted" title="Automatisch via een regel">⚙ regel</span>');
    if (t.categorySource === 'system') extra.push('<span class="badge small muted" title="Automatisch herkend">⚙ automatisch</span>');
    if (C.looksLikeRefund(t)) extra.push('<span class="badge maybe">Van een vriend?</span>');
    if ((t.attachments || []).length) extra.push(`<span class="badge small" title="${t.attachments.length} bonnetje(s)">📎 ${t.attachments.length}</span>`);
    for (const id of t.actions || []) { const a = actionById(id); if (a) extra.push(`<span class="badge action-badge ${a.closed ? 'done' : ''}" data-action="action-view" data-id="${esc(a.id)}" title="${a.closed ? 'Actie gedaan' : 'Actie nog te doen'}">${a.closed ? '✓' : '☐'} ${esc(a.name)}</span>`); }
    const hint = ui.ruleHint && ui.ruleHint.txId === t.id && t.categoryId === ui.ruleHint.categoryId && (t.counterparty || t.description);
    const sel = ui.selected.has(t.id);
    return `<tr class="${k === 'todo' ? 'is-todo' : ''} ${t.isTransfer ? 'is-transfer' : ''} ${sel ? 'is-selected' : ''}">
      <td class="sel-cell"><input type="checkbox" data-select="${esc(t.id)}" ${sel ? 'checked' : ''} aria-label="Selecteer"></td>
      <td class="nowrap">${fmtDate(t.date)}${opts.showAccount ? `<div class="small muted">${esc(accName(t.accountId))}</div>` : ''}</td>
      <td class="clickable" data-action="edit-tx" data-id="${esc(t.id)}">${t.title ? `<div class="tx-title" title="Je eigen titel">${esc(t.title)}</div><div class="desc tx-bankname">${esc([t.counterparty, t.description].filter(Boolean).join(' · '))}</div>` : `<div>${esc(t.counterparty || Banks.merchantFromDescription(t.description) || t.description || '—')}</div><div class="desc" title="${esc(t.description)}">${esc(t.description)}</div>`}
        <div class="badge-row">${opts.showKind ? kindBadge(k) : ''}${extra.join('')}${opts.showSource ? sourceBadge(t) : ''}</div></td>
      ${(() => {
        // Uitgave waarop terugbetaald werd (vrienden, annulering): toon wat je zelf betaalde
        const back = opts.refunds && t.amount < 0 ? opts.refunds[t.id] || 0 : 0;
        if (!back) return `<td class="amount ${amountClass(t.amount)}">${money(t.amount)}</td>`;
        const n = state.transactions.filter(x => x.refundOf === t.id).length;
        return `<td class="amount ${amountClass(t.amount + back)}" title="Netto: wat je zelf betaalde">${money(t.amount + back)}
          <div class="small muted refund-note"><s>${money(t.amount)}</s> · ↩ ${money(back)} terug${n > 1 ? ` (${n}×)` : ''}</div></td>`;
      })()}
      <td class="assign-cell">${assignSelect(t)}${t.amount > 0 && k === 'todo' ? `<div><button class="btn small ghost wi-help" data-action="what-is" data-id="${esc(t.id)}">❓ Wat is dit geld?</button></div>` : ''}${hint ? `<div><button class="btn small ghost" data-action="rule-hint" data-id="${esc(t.id)}">⚙ Altijd zo voor “${esc((t.counterparty || t.description).slice(0, 28))}”</button></div>` : ''}</td>
    </tr>`;
  }

  function txTable(list, opts) {
    if (!list.length) return `<div class="card empty-state">${opts && opts.empty || 'Geen transacties.'}</div>`;
    const lim = (opts && opts.limit) || 150;
    const shown = list.slice(0, lim);
    const allSel = shown.length && shown.every(t => ui.selected.has(t.id));
    return `${selectionBar()}<div class="table-wrap"><table class="tx-table">
      <thead><tr><th class="sel-cell"><input type="checkbox" data-select-all="${esc(shown.map(t => t.id).join(','))}" ${allSel ? 'checked' : ''} aria-label="Alles selecteren"></th><th>Datum</th><th>Omschrijving</th><th class="right">Bedrag</th><th>Gekoppeld aan</th></tr></thead>
      <tbody>${(() => { const o = Object.assign({ refunds: C.refundTotals(state) }, opts); return shown.map(t => txRow(t, o)).join(''); })()}</tbody></table></div>
      ${list.length > lim ? `<p style="text-align:center"><button class="btn" data-action="more" data-key="${opts && opts.moreKey || 'list'}">Toon meer (${list.length - lim})</button></p>` : ''}`;
  }

  /** Automatische regels (staan bij Bank, waar je ook de transacties koppelt). */
  function rulesCard() {
    const rules = C.sortedRules(state.rules);
    const ruleCount = {};
    for (const t of state.transactions) if (t.ruleId) ruleCount[t.ruleId] = (ruleCount[t.ruleId] || 0) + 1;
    return `        <div class="card rules-card" style="margin-top:24px">
          <h2>Automatische regels</h2>
          <p class="small muted">Regels koppelen nieuwe transacties vanzelf. Je maakt ze het makkelijkst met <em>⚙ Altijd zo</em> nadat je een transactie koppelde. De bovenste regel die past wint; manuele koppelingen worden nooit overschreven.</p>
          ${rules.length ? `<div class="list scroll">${rules.map((r, i) => `<div class="list-row" style="${r.enabled === false ? 'opacity:.5' : ''}">
            <div class="grow"><strong>${esc(r.name)}</strong> → ${r.categoryId ? catBadge(r.categoryId) : ''}${r.share ? ` <span class="badge" title="Deel als voorschot">🤝 ${r.share.mode === 'amount' ? money(r.share.value) : String(r.share.value).replace('.', ',') + '%'} voor ${esc(r.share.person)}</span>` : ''}${r.action ? ` <span class="badge action-badge" title="Koppelt ook aan een actie">✅ ${esc(r.action.name)}${r.action.perMonth ? ' · elke maand' : ''}</span>` : ''}${r.categoryId === C.SYS_ADVANCE ? ` <span class="small">${r.person ? 'voor ' + esc(r.person) : '<span class="warn-text">voor wie?</span>'}</span>` : ''}<div class="small muted">${esc(C.RULE_FIELDS[r.field])} ${esc(C.RULE_OPERATORS[r.operator])} “${esc(r.value)}” · ${ruleCount[r.id] || 0} treffers</div></div>
            <button class="btn small ghost" data-action="rule-up" data-id="${esc(r.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Hoger">▲</button>
            <button class="btn small" data-action="edit-rule" data-id="${esc(r.id)}">Bewerk</button><button class="btn small danger" data-action="delete-rule" data-id="${esc(r.id)}" aria-label="Verwijder">✕</button></div>`).join('')}</div>` : '<p class="muted">Nog geen regels.</p>'}
          <p class="btn-row"><button class="btn" data-action="new-rule">+ Regel</button></p>
        </div>`;
  }

  /** Voorstellen: inkomst met exact hetzelfde bedrag als een eerdere uitgave (annulering, terugstorting). */
  function cancelCard() {
    const pairs = C.cancellationPairs(state);
    if (!pairs.length) return '';
    const name = t => t.title || t.counterparty || t.description || '—';
    const shown = pairs.slice(0, 8);
    return `<div class="card cancel-card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">↩ Geannuleerd of teruggestort?</h2><span class="spacer"></span>
        ${pairs.length > 1 ? `<button class="btn small primary" data-action="cancel-link-all">Alle ${pairs.length} koppelen</button>` : ''}</div>
      <p class="small muted">Deze inkomsten hebben exact hetzelfde bedrag als een eerdere uitgave, bv. een geannuleerde bestelling. Koppel je ze, dan heffen ze elkaar op: ze tellen niet als inkomst en niet als uitgave.</p>
      <div class="list">${shown.map(p => `<div class="list-row cancel-pair">
        <div class="grow"><strong>${esc(name(p.expense))}</strong>${p.sameName ? '' : ` <span class="small muted">↔ ${esc(name(p.income))}</span>`}
          <div class="small muted">uitgave ${fmtDate(p.expense.date)} <span class="negv">${money(p.expense.amount)}</span> · terug ${fmtDate(p.income.date)} <span class="pos">${money(p.income.amount)}</span>${p.days ? ` · ${p.days} dag${p.days === 1 ? '' : 'en'} later` : ' · zelfde dag'}${state.accounts.length > 1 && p.income.accountId !== p.expense.accountId ? ' · andere rekening' : ''}</div></div>
        <button class="btn small primary" data-action="cancel-link" data-in="${esc(p.income.id)}" data-out="${esc(p.expense.id)}">Koppelen</button>
        <button class="btn small ghost" data-action="cancel-dismiss" data-in="${esc(p.income.id)}" data-out="${esc(p.expense.id)}" title="Dit is geen annulering">Nee</button>
      </div>`).join('')}</div>
      ${pairs.length > shown.length ? `<p class="small muted">… en nog ${pairs.length - shown.length}.</p>` : ''}
    </div>`;
  }

  function linkCancellations(list) {
    const before = list.map(p => ({ id: p.income.id, refundOf: p.income.refundOf || null }));
    for (const p of list) p.income.refundOf = p.expense.id;
    commit();
    toast(list.length === 1 ? 'Gekoppeld: uitgave en terugstorting heffen elkaar op' : list.length + ' annuleringen gekoppeld', { label: 'Ongedaan maken', run: () => {
      for (const b of before) { const t = txById(b.id); if (t) t.refundOf = b.refundOf; }
      commit('Koppeling ongedaan gemaakt');
    } });
  }

  function renderBank() {
    const imports = (state.imports || []).slice().sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    const all = state.transactions.filter(bankTxFilter).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
    const todo = todoCount();
    const f = ui.bank;
    const cards = state.accounts.map(a => {
      const n = state.transactions.filter(t => t.accountId === a.id).length;
      const nTodo = state.transactions.filter(t => t.accountId === a.id && kindOf(t) === 'todo').length;
      const bal = C.accountBalance(state, a.id);
      const last = imports.find(i => i.accountId === a.id);
      const bank = a.bank ? (Banks.PROFILES.find(p => p.id === a.bank) || {}).name || a.bank : '';
      return `<div class="card bank-card ${f.account === a.id ? 'selected' : ''}">
        <div class="top"><div><strong>${esc(a.name)}</strong><div class="small muted">${a.iban ? esc(C.formatIban(a.iban)) : a.type === 'cash' ? 'contant geld' : 'geen IBAN'}${bank ? ' · ' + esc(bank) : ''}</div></div>
          <div class="amount">${bal ? money(bal.amount) : '<span class="muted small">saldo ?</span>'}</div></div>
        <div class="small muted">${n} transacties${nTodo ? ` · <strong class="warn-text">${nTodo} te verwerken</strong>` : ''}${last && last.period ? ` · bestanden t.e.m. ${fmtDate(last.period.to)}` : ''}</div>
        <div class="actions">
          <button class="btn small" data-action="bank-filter" data-id="${esc(a.id)}">${f.account === a.id ? '✓ ' : ''}Transacties</button>
          ${a.type === 'cash' ? `<button class="btn small" data-action="new-tx" data-account="${esc(a.id)}">+ Cash-uitgave</button>` : `<button class="btn small" data-action="import" data-account="${esc(a.id)}">Bestand opladen</button>`}
          <button class="btn small ghost" data-action="edit-account" data-id="${esc(a.id)}">Bewerk</button>
        </div></div>`;
    }).join('');

    return `
      <div class="page-head"><h1>Bank</h1><span class="spacer"></span>
        <button class="btn" data-action="new-tx">+ Manuele transactie</button>
        <button class="btn primary" data-action="import">Bankbestand opladen</button></div>
      ${state.transactions.length ? '' : `<p class="muted">Koppel je bank om transacties automatisch op te halen, of laad de CSV-export van je bank op (KBC/CBC, Argenta en Belfius worden automatisch herkend).
        Elk bestand kan maar één keer opgeladen worden, en transacties die al in Helder zitten worden overgeslagen. Koppel daarna elke transactie aan wat ze is.</p>`}
      ${cancelCard()}
      <h2>Transacties${f.account ? ' — ' + esc(accName(f.account)) : ''}</h2>
      <div class="filters">
        <div class="seg">
          ${[['todo', `Te verwerken (${todo})`], ['done', 'Verwerkt'], ['', 'Alles']].map(([v, l]) => `<button class="${f.status === v ? 'active' : ''}" data-action="bank-status" data-status="${v}">${l}</button>`).join('')}
        </div>
        <select data-filter="bank.account"><option value="">Alle rekeningen</option>${accountOptions(f.account)}</select>
        <select data-filter="bank.category" aria-label="Filter op categorie"><option value="">Alle categorieën</option><option value="__none__" ${f.category === '__none__' ? 'selected' : ''}>❔ Nog niet gekoppeld</option>${categoryOptions(f.category || null, { special: true, allowEmpty: false })}</select>
        <input type="search" placeholder="Zoeken…" data-filter="bank.search" value="${esc(f.search)}">
      </div>
      ${txTable(all, { showKind: true, showSource: true, showAccount: !f.account, limit: f.limit, moreKey: 'bank', empty: f.status === 'todo' ? '🎉 Alles is verwerkt.' : 'Geen transacties.' })}
      <h2 style="margin-top:28px">Rekeningen en bankkoppeling</h2>
      <div class="grid cards" style="margin-bottom:16px">${cards}</div>
      ${bankLinkCard()}
      ${rulesCard()}
      ${trashCard()}
      <details class="card import-history" style="margin-top:24px" data-keep="imports" ${ui.keepOpen.imports ? 'open' : ''}>
        <summary><strong>Geschiedenis van imports</strong> <span class="small muted">· ${imports.length} keer gegevens binnengehaald (bestanden en bankkoppeling) — hier kan je een import bekijken of ongedaan maken</span></summary>
        ${imports.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Bestand</th><th>Rekening</th><th>Periode</th><th class="right">Toegevoegd</th><th class="right">Overgeslagen</th><th>Opgeladen</th><th></th></tr></thead>
          <tbody>${imports.map(i => `<tr>
            <td>📄 <strong>${esc(i.fileName)}</strong><div class="small muted">${esc(i.bankName || i.bank)}</div></td>
            <td>${esc(accName(i.accountId))}</td>
            <td class="nowrap">${i.period ? fmtDate(i.period.from) + ' – ' + fmtDate(i.period.to) : '—'}</td>
            <td class="right">${state.transactions.filter(t => t.importId === i.id).length}</td>
            <td class="right small muted" title="Rijen die al in Helder zaten">${i.duplicates || 0} dubbel${i.errors ? ` · ${i.errors} ongeldig` : ''}</td>
            <td class="nowrap small">${esc(fmtDateTime(i.importedAt))}</td>
            <td class="nowrap right"><button class="btn small" data-action="show-import" data-id="${esc(i.id)}">Bekijk</button>
              <button class="btn small danger" data-action="undo-import" data-id="${esc(i.id)}">Ongedaan maken</button></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nog geen bestanden opgeladen.</p>'}
      </details>`;
  }

  // ----- Beheer (beheerdersaccount) -----

  async function loadAdmin() {
    try { ui.admin.data = await Sync.admin.overview(); ui.admin.error = ''; }
    catch (e) { ui.admin.error = e.message; }
    if (ui.admin && !modal) render();
  }

  function shortUa(ua) {
    ua = String(ua || '');
    const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return [dev, br].filter(Boolean).join(' · ') || ua.slice(0, 30) || '—';
  }

  function renderAdmin() {
    const a = ui.admin;
    const d = a.data;
    const head = `<div class="page-head"><h1>🛡️ Beheer</h1><span class="spacer"></span><span class="small muted">Aangemeld als ${esc(a.me.displayName || a.me.user)}</span>
      <button class="btn small" data-action="admin-refresh">Vernieuwen</button></div>`;
    if (!d) return head + `<p class="muted">${a.error ? esc(a.error) : 'Laden…'}</p>`;
    const now = Date.now();
    const day = 86400000;
    const active30 = d.users.filter(u => u.lastLogin && now - Date.parse(u.lastLogin) < 30 * day).length;
    const loginsToday = d.logins.filter(l => l.ok && l.at.slice(0, 10) === today).length;
    const failed24 = d.logins.filter(l => !l.ok && now - Date.parse(l.at) < day).length;
    const kind = u => u.role === 'admin' ? '🛡️ beheerder' : u.role === 'owner' ? '🔑 eigenaar' : u.email ? 'Google' : '👤 gebruikersnaam';
    const size = b => b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB';
    const open = d.site.registration === 'open';
    return head + `
      <p class="muted">Hier zie je wie Helder gebruikt en wanneer er aangemeld werd. De financiële gegevens van gebruikers zie je hier bewust niet.</p>
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Gebruikers</div><div class="value">${d.users.filter(u => u.role !== 'admin').length}</div><div class="hint">${d.users.filter(u => u.email).length} via Google</div></div>
        <div class="card kpi"><div class="label">Actief (30 dagen)</div><div class="value">${active30}</div></div>
        <div class="card kpi"><div class="label">Aanmeldingen vandaag</div><div class="value">${loginsToday}</div></div>
        <div class="card kpi"><div class="label">Mislukt (24 uur)</div><div class="value ${failed24 ? 'negv' : ''}">${failed24}</div></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <h2>Nieuwe accounts</h2>
        <div class="reg-state">
          <span class="badge ${open ? 'ok' : 'over'} reg-badge">${open ? '● Open' : '● Gesloten'}</span>
          <span class="grow">${open ? 'Nieuwe mensen kunnen een account aanmaken, op de manieren die hieronder aan staan.' : 'Enkel bestaande gebruikers kunnen aanmelden. Nieuwe mensen krijgen de melding dat registratie gesloten is.'}</span>
          <button class="btn ${open ? '' : 'primary'}" data-action="admin-reg" data-open="${open ? '0' : '1'}">${open ? 'Nieuwe accounts sluiten' : 'Nieuwe accounts toelaten'}</button>
        </div>
        ${[['signupPassword', '👤 Met gebruikersnaam en wachtwoord', true], ['signupGoogle', 'Met Google', d.google]].map(([key, label, avail]) => {
          const on = d.site[key] !== false;
          return `<div class="reg-state reg-method">
            <span class="badge ${on && avail ? 'ok' : 'over'} reg-badge">${on ? '● Aan' : '● Uit'}</span>
            <span class="grow"><strong>${label}</strong><div class="small muted">${!avail ? 'Google staat niet ingesteld op deze server.' : on ? (open ? 'Nieuwe mensen kunnen zo een account aanmaken.' : 'Aan, maar nieuwe accounts zijn nu gesloten.') : 'Nieuwe accounts op deze manier kunnen niet. Bestaande gebruikers kunnen gewoon aanmelden.'}</div></span>
            <button class="btn small" data-action="admin-signup" data-key="${key}" data-on="${on ? '0' : '1'}">${on ? 'Uitzetten' : 'Aanzetten'}</button>
          </div>`;
        }).join('')}
        ${d.google ? `<p class="small muted">Redirect URI in Google Cloud: <code>${esc(d.googleRedirect)}</code></p>`
          : `<p class="small muted" style="margin-top:10px">Aanmelden met Google staat niet aan (optioneel): zet daarvoor <code>HELDER_GOOGLE_CLIENT_ID</code> en <code>HELDER_GOOGLE_CLIENT_SECRET</code> als secrets in GitHub. Redirect URI: <code>${esc(d.googleRedirect)}</code></p>`}
      </div>
      <div class="card" style="margin-bottom:16px"><h2>Gebruikers</h2>
        <div class="table-wrap"><table><thead><tr><th>Gebruiker</th><th>Soort</th><th>Aangemaakt</th><th>Laatst aangemeld</th><th class="right">Aanmeldingen</th><th class="right">Transacties</th><th class="right">Opslag</th><th>AI</th><th></th></tr></thead>
        <tbody>${d.users.map(u => `<tr class="${u.disabled ? 'is-disabled' : ''}">
          <td><strong>${esc(u.displayName)}</strong><div class="small muted">${esc(u.email || u.user)}</div></td>
          <td class="small">${kind(u)}${u.disabled ? ' <span class="badge over">geblokkeerd</span>' : ''}</td>
          <td class="small nowrap">${u.created ? esc(fmtDateTime(u.created)) : '—'}</td>
          <td class="small nowrap">${u.lastLogin ? esc(fmtDateTime(u.lastLogin)) : 'nooit'}</td>
          <td class="right">${u.logins}</td>
          <td class="right">${u.transactions == null ? '—' : u.transactions}</td>
          <td class="right small">${u.dataSize ? size(u.dataSize) : '—'}</td>
          <td class="small">${u.role === 'member' ? `${u.ownAi ? '<div>✓ eigen sleutel</div>' : ''}<label title="AI op kosten van de sleutel van deze server"><input type="checkbox" data-admin-ai="${esc(u.user)}" ${u.ai ? 'checked' : ''}> jouw sleutel</label>` : u.role === 'owner' ? 'ja' : '—'}</td>
          <td class="nowrap right">${u.role === 'member' ? `<button class="btn small" data-action="admin-user" data-user="${esc(u.user)}" data-op="${u.disabled ? 'enable' : 'disable'}">${u.disabled ? 'Deblokkeren' : 'Blokkeren'}</button>
            <button class="btn small danger" data-action="admin-user" data-user="${esc(u.user)}" data-op="delete">Verwijderen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted"><strong>AI:</strong> gebruikers kunnen in Instellingen hun eigen Anthropic API-sleutel invullen; dan betalen ze zelf. Vink “jouw sleutel” enkel aan als iemand AI mag gebruiken op jouw kosten (de sleutel van deze server).</p></div>
      <div class="card" style="margin-bottom:16px"><h2>Bankkoppeling</h2>
        <div class="reg-state">
          <span class="badge ${d.site.bankShared ? 'ok' : 'muted'} reg-badge">${d.site.bankShared ? '● Gedeeld' : '● Eigen app'}</span>
          <span class="grow">${d.site.bankShared ? 'Alle gebruikers gebruiken de Enable Banking-app van de eigenaar (enkel toegelaten met een contract bij Enable Banking). Wie een eigen app instelt, gebruikt die.' : 'Elke gebruiker stelt zijn eigen, gratis Enable Banking-app in (Bank → Bankkoppeling instellen). Zo’n app werkt enkel voor de eigen rekeningen van die gebruiker; dat is hoe Enable Banking het gratis toelaat. Saxo werkt op dezelfde manier met een eigen Saxo-app.'}</span>
          <button class="btn small" data-action="admin-bank-shared" data-on="${d.site.bankShared ? '0' : '1'}">${d.site.bankShared ? 'Niet meer delen' : 'App van de eigenaar delen'}</button>
        </div></div>
      <div class="card"><h2>Laatste aanmeldingen</h2>
        <div class="table-wrap"><table><thead><tr><th>Wanneer</th><th>Gebruiker</th><th>Hoe</th><th>Resultaat</th><th>IP-adres</th><th>Toestel</th></tr></thead>
        <tbody>${d.logins.slice(0, 150).map(l => { const u = d.users.find(x => x.user === l.user); return `<tr>
          <td class="small nowrap">${esc(fmtDateTime(l.at))}</td><td>${esc(u ? u.displayName : l.user)}${u && u.email ? `<div class="small muted">${esc(u.email)}</div>` : ''}</td>
          <td class="small">${esc(l.method)}</td><td class="small">${l.ok ? '<span class="pos">✓ gelukt</span>' : '<span class="negv">✗ ' + esc(l.detail || 'mislukt') + '</span>'}${l.ok && l.detail ? ' <span class="muted">(' + esc(l.detail) + ')</span>' : ''}</td>
          <td class="small">${esc(l.ip)}</td><td class="small">${esc(shortUa(l.ua))}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">Nog geen aanmeldingen.</td></tr>'}</tbody></table></div></div>`;
  }

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
    const f = ['adv', 'act'].includes(ui.owed) ? ui.owed : 'all';
    const showAdv = f !== 'act', showAct = f !== 'adv';
    const people = C.personList(state).sort((a, b) => b.stats.open - a.stats.open || a.name.localeCompare(b.name));
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
        <div class="seg owed-seg">${seg('all', 'Alles')}${seg('act', '✅ Acties')}${seg('adv', '🤝 Voorschotten')}</div></div>
      <div class="follow-sum">
        <button class="follow-stat act" data-action="owed-filter" data-f="act"><span class="label">Acties te doen</span><strong>${openActs.length}</strong>${late ? `<span class="small warn-text">${late} te laat</span>` : ''}</button>
        <button class="follow-stat adv" data-action="owed-filter" data-f="adv"><span class="label">Nog terug te krijgen</span><strong>${money(advTotal)}</strong><span class="small muted">${plural(openPeople.length, 'persoon', 'personen')}${prepaidTotal ? ` · ${money(prepaidTotal)} vooruitbetaald` : ''}</span></button>
      </div>
      <p class="small muted follow-help"><strong>Actie</strong> = iets wat jij nog moet doen bij een transactie (geld terugvragen, retour binnenbrengen, bonnetje indienen); vink het af als het gedaan is.
        <strong>Voorschot</strong> = je betaalde voor iemand anders; dat is niet jouw uitgave en Helder houdt bij wat je nog terugkrijgt.</p>
      ${actSection}${advSection}`;
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

  // ----- Gedeelde boekhouding (huishouden) -----

  const houseUi = { status: null, error: '', code: null, busy: false };
  async function loadHouse() {
    try { houseUi.status = await Sync.household.status(); houseUi.error = ''; } catch (e) { houseUi.error = e.message; }
    if (ui.view === 'settings' && !modal) render();
  }

  function householdBlock() {
    if (!(Sync && Sync.mode === 'server') || demo) return '';
    const h = houseUi.status;
    if (!h) { if (!houseUi.error) setTimeout(loadHouse, 0); return `<div class="section household"><h3>👪 Gedeelde boekhouding</h3><p class="small muted">${esc(houseUi.error || 'Laden…')}</p></div>`; }
    const invite = houseUi.code ? `<div class="notice small">Geef deze code aan wie mee wil werken (7 dagen geldig, één keer te gebruiken):
        <div class="invite-code">${esc(houseUi.code)} <button class="btn small" data-action="copy" data-copy="${esc(houseUi.code)}">Kopieer</button></div>
        Die persoon maakt een eigen Helder-account, gaat naar Instellingen → Account en vult de code in.</div>` : '';
    if (h.role === 'member') {
      return `<div class="section household"><h3>👪 Gedeelde boekhouding</h3>
        <p class="small">Je werkt in de boekhouding van <strong>${esc(h.owner.name)}</strong>${h.members.length > 1 ? ', samen met ' + h.members.filter(m => m.user !== (Sync.account && Sync.account.user)).map(m => esc(m.name)).join(', ') : ''}. Alles wat jullie toevoegen of aanpassen, zien jullie allebei.</p>
        <p class="small muted">Je eigen, vroegere gegevens zijn bewaard en komen terug als je het huishouden verlaat. Je bankkoppelingen en sleutels blijven van jou.</p>
        <button class="btn small danger" data-action="house-leave" ${houseUi.busy ? 'disabled' : ''}>Huishouden verlaten</button></div>`;
    }
    return `<div class="section household"><h3>👪 Gedeelde boekhouding</h3>
      <p class="small muted">Werk samen met je partner of huisgenoot in één boekhouding. Ieder meldt zich aan met een eigen account; jullie zien dezelfde transacties, categorieën, voorschotten en bonnetjes.</p>
      ${h.members.length ? `<div class="list">${h.members.map(m => `<div class="list-row"><div class="grow">👤 ${esc(m.name)}<div class="small muted">werkt mee in jouw boekhouding</div></div><button class="btn small ghost danger" data-action="house-remove" data-user="${esc(m.user)}">Verwijderen</button></div>`).join('')}</div>` : ''}
      ${invite}
      <p class="btn-row"><button class="btn small" data-action="house-invite" ${houseUi.busy ? 'disabled' : ''}>+ Iemand uitnodigen</button></p>
      ${h.members.length ? '' : `<details class="small"><summary>Ik kreeg een code van iemand anders</summary>
        <form data-form="house-join" class="input-row" style="margin-top:8px"><input type="text" name="code" placeholder="bv. ABCD-EF23" autocapitalize="characters" autocomplete="off" required><button class="btn primary" type="submit" ${houseUi.busy ? 'disabled' : ''}>Deelnemen</button></form>
        <p class="small muted">Je werkt daarna in de boekhouding van wie je uitnodigde. Je eigen gegevens worden niet gewist: ze komen terug als je het huishouden verlaat.</p></details>`}
      ${houseUi.error ? `<div class="errors">${esc(houseUi.error)}</div>` : ''}
    </div>`;
  }

  // ----- Bonnetjes -----

  function filesAvailable() { return !!(Sync && Sync.mode === 'server' && !demo); }

  function attachmentChip(f) {
    const url = Sync.files.url(f.id);
    const isImg = /^image\//.test(f.type);
    return `<span class="file-chip" data-file="${esc(f.id)}">
      <a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(f.name)}">${isImg ? `<img src="${esc(url)}" alt="" loading="lazy">` : '<span class="file-pdf">PDF</span>'}<span class="file-name">${esc(f.name)}</span></a>
      <button type="button" class="chip-x" data-action="tx-file-remove" data-id="${esc(f.id)}" aria-label="Bonnetje verwijderen">✕</button></span>`;
  }

  /** Foto verkleinen (max. 1800 px, jpg) zodat ze snel oplaadt; pdf's gaan ongewijzigd. */
  function prepareFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Kon het bestand niet lezen'));
      if (file.type === 'application/pdf' || !/^image\//.test(file.type)) {
        reader.onload = () => resolve({ name: file.name, type: file.type || 'application/pdf', data: String(reader.result).split(',')[1] });
        reader.readAsDataURL(file);
        return;
      }
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Dit beeld kan niet geopend worden (bv. HEIC): kies een jpg of png'));
        img.onload = () => {
          const k = Math.min(1, 1800 / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve({ name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.82).split(',')[1] });
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadTxFile(input) {
    const file = input.files && input.files[0];
    const t = modal && modal.tx;
    if (!file || !t) return;
    const status = $('#tx-file-status');
    if (status) status.textContent = 'Bezig met opladen…';
    try {
      const p = await prepareFile(file);
      const meta = await Sync.files.upload(p.name, p.type, p.data);
      t.attachments = (t.attachments || []).concat([{ id: meta.id, name: meta.name, type: meta.type, size: meta.size }]);
      const box = $('#tx-files');
      if (box) box.insertAdjacentHTML('beforeend', attachmentChip(meta));
      if (status) status.textContent = 'Opgeladen. Vergeet niet op Opslaan te klikken.';
    } catch (e) {
      if (status) status.textContent = e.message;
    }
    input.value = '';
  }

  // ----- Jaaroverzicht voor de belastingaangifte -----

  /**
   * Bedragen die je nodig hebt voor je aangifte (personenbelasting, België), per kalenderjaar.
   * Helder rekent niets uit voor de fiscus: het verzamelt wat in je gegevens staat, met de bron erbij.
   */
  function taxYearData(year) {
    const y = String(year);
    const inYear = d => String(d || '').slice(0, 4) === y;
    const iv = inv();
    const mv = ((iv && iv.movements) || []).filter(m => inYear(m.date));
    const brokerOf = m => m.broker === 'saxo' ? 'Saxo' : 'Degiro';
    const dividends = mv.filter(m => m.type === 'dividend').reduce((a, m) => a + m.amountEur, 0);
    const withholding = -mv.filter(m => m.type === 'dividend_tax').reduce((a, m) => a + m.amountEur, 0);
    const brokerInterest = mv.filter(m => m.type === 'interest').reduce((a, m) => a + m.amountEur, 0);
    const tobPaid = -mv.filter(m => m.type === 'fee' && /beurstaks|\btob\b|financial transaction tax|taks op beursverrichtingen/i.test(m.description || '')).reduce((a, m) => a + m.amountEur, 0);
    const trades = ((iv && iv.trades) || []).filter(t => inYear(t.date));
    const tradeVolume = trades.reduce((a, t) => a + Math.abs(t.totalEur || 0), 0);
    const realized = iv ? Invest.realized(iv).positions.flatMap(p => p.sells.filter(x => inYear(x.date)).map(x => Object.assign({ name: p.name, isin: p.isin }, x))) : [];
    const realizedTotal = realized.reduce((a, x) => a + x.result, 0);
    // Rente op spaarrekeningen: inkomende bedragen op een spaarrekening of in een categorie met "rente"
    const spaar = new Set(state.accounts.filter(a => a.type === 'spaar').map(a => a.id));
    const savingsInterest = state.transactions.filter(t => inYear(t.date) && t.amount > 0 && !t.isTransfer && (
      (t.categoryId && /rente|interest/i.test(catName(t.categoryId))) || (spaar.has(t.accountId) && /rente|interest|getrouwheidspremie|basisrente/i.test((t.description || '') + ' ' + (t.counterparty || '')))));
    const interestTotal = savingsInterest.reduce((a, t) => a + t.amount, 0);
    const brokers = Array.from(new Set(mv.map(brokerOf).concat(trades.map(t => t.broker === 'saxo' ? 'Saxo' : 'Degiro'))));
    return { year: y, dividends, withholding, brokerInterest, tobPaid, trades, tradeVolume, realized, realizedTotal, savingsInterest, interestTotal, brokers };
  }

  function taxYearModal() {
    const m = modal;
    const years = Array.from(new Set(state.transactions.map(t => t.date.slice(0, 4)).concat(((inv() && inv().movements) || []).map(x => x.date.slice(0, 4))))).sort().reverse();
    if (!years.includes(m.year)) m.year = years.includes(String(Number(today.slice(0, 4)) - 1)) ? String(Number(today.slice(0, 4)) - 1) : years[0] || today.slice(0, 4);
    const d = taxYearData(m.year);
    const row = (label, value, help) => `<tr><td>${label}${help ? `<div class="small muted">${help}</div>` : ''}</td><td class="amount"><strong>${money(value)}</strong></td></tr>`;
    return modalShell('Jaaroverzicht voor je aangifte', `
      <div class="tax-head"><label class="field"><span>Inkomstenjaar</span><select id="tax-year">${years.map(y => `<option value="${y}" ${y === m.year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        <p class="small muted">Alles wat Helder kent over ${esc(m.year)}, samengezet voor je belastingaangifte. Dit is <strong>geen fiscaal advies</strong>: controleer de bedragen met de jaaroverzichten van je bank en broker.</p></div>
      <h3>Beleggingen${d.brokers.length ? ' <span class="small muted">(' + esc(d.brokers.join(', ')) + ')</span>' : ''}</h3>
      <table class="mini tax-table"><tbody>
        ${row('Dividenden (bruto)', d.dividends, 'zoals ze op je beleggingsrekening binnenkwamen')}
        ${row('Ingehouden bronbelasting op dividenden', d.withholding, 'buitenlandse en/of Belgische voorheffing die de broker inhield')}
        ${row('Rente op je beleggingsrekening', d.brokerInterest)}
        ${row('Gerealiseerde winst/verlies op verkopen', d.realizedTotal, `${d.realized.length} verko${d.realized.length === 1 ? 'op' : 'pen'} · gemiddelde aankoopprijs, kosten inbegrepen`)}
        ${row('Volume aan- en verkopen', d.tradeVolume, `${d.trades.length} transactie${d.trades.length === 1 ? '' : 's'} · basis voor de beurstaks (TOB)`)}
        ${row('Beurstaks (TOB) betaald via de broker', d.tobPaid, d.tobPaid ? '' : 'geen gevonden: bij een buitenlandse broker moet je de TOB vaak zelf aangeven en betalen')}
      </tbody></table>
      <div class="notice small">Een <strong>buitenlandse effectenrekening</strong> (bv. Degiro of Saxo) moet je melden aan het Centraal Aanspreekpunt van de Nationale Bank, en aankruisen in je aangifte. Controleer bij je broker of de Belgische roerende voorheffing al ingehouden werd; zo niet, dan geef je de dividenden zelf aan.</div>
      <h3>Rente op spaarrekeningen</h3>
      <table class="mini tax-table"><tbody>${row('Rente', d.interestTotal, d.savingsInterest.length ? d.savingsInterest.length + ' bedrag(en), herkend op spaarrekeningen of in een categorie met “rente”' : 'niets gevonden')}</tbody></table>
      ${d.realized.length ? `<details style="margin-top:10px"><summary class="small">Verkopen in ${esc(m.year)} bekijken</summary><table class="mini"><tbody>${d.realized.map(x => `<tr><td>${fmtDate(x.date)} · ${esc(x.name)}<div class="small muted">${esc(x.isin || '')} · ${String(x.quantity).replace('.', ',')} stuks</div></td><td class="amount">${money(x.proceeds)}</td><td class="amount ${x.result >= 0 ? 'pos' : 'negv'}">${money(x.result)}</td></tr>`).join('')}</tbody></table></details>` : ''}`,
      '<button class="btn" data-action="tax-csv">⬇ Downloaden (CSV)</button><span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>', true);
  }

  function taxCsv() {
    const d = taxYearData(modal.year);
    const n = v => (v / 100).toFixed(2).replace('.', ',');
    const lines = [['Rubriek', 'Bedrag (EUR)', 'Toelichting'],
      ['Dividenden (bruto)', n(d.dividends), ''], ['Ingehouden bronbelasting', n(d.withholding), ''], ['Rente beleggingsrekening', n(d.brokerInterest), ''],
      ['Gerealiseerde winst/verlies', n(d.realizedTotal), d.realized.length + ' verkopen'], ['Volume aan- en verkopen (TOB-basis)', n(d.tradeVolume), d.trades.length + ' transacties'],
      ['Beurstaks betaald via broker', n(d.tobPaid), ''], ['Rente spaarrekeningen', n(d.interestTotal), d.savingsInterest.length + ' bedragen'], [],
      ['Verkopen'], ['Datum', 'Product', 'ISIN', 'Aantal', 'Opbrengst', 'Resultaat'],
      ...d.realized.map(x => [x.date, x.name, x.isin || '', String(x.quantity).replace('.', ','), n(x.proceeds), n(x.result)]), [],
      ['Aan- en verkopen'], ['Datum', 'Product', 'ISIN', 'Aantal', 'Bedrag'],
      ...d.trades.map(t => [t.date, t.name, t.isin || '', String(t.quantity).replace('.', ','), n(t.totalEur || 0)])];
    const csv = '\ufeff' + lines.map(r => r.map(c => /[;"\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c).join(';')).join('\r\n');
    download('helder-jaaroverzicht-' + d.year + '.csv', csv, 'text/csv;charset=utf-8');
  }

  // ----- Zoeken over alles -----

  /** Zoekt in titel, tegenpartij, omschrijving, notitie, bedrag, categorie, persoon en acties. */
  function searchResults(q, catFilter) {
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2 && !catFilter) return [];
    const words = q.split(/\s+/);
    const amt = C.parseAmount(q);
    const out = [];
    for (const t of state.transactions) {
      const hay = [t.title, t.counterparty, t.description, t.note, t.person, t.categoryId ? catName(t.categoryId) : '', accName(t.accountId),
        C.centsToInput(t.amount), C.centsToInput(Math.abs(t.amount)), ...(t.actions || []).map(id => (actionById(id) || {}).name || ''),
        ...(t.splits || []).map(sp => (sp.note || '') + ' ' + (sp.categoryId ? catName(sp.categoryId) : ''))].join(' ').toLowerCase();
      if (catFilter && !C.splitLines(t).some(l => (l.categoryId || '__none__') === catFilter) && !(t.refundOf && txById(t.refundOf) && C.splitLines(txById(t.refundOf)).some(l => l.categoryId === catFilter))) continue;
      if (q.length < 2 || words.every(w => hay.includes(w)) || (!isNaN(amt) && amt !== 0 && Math.abs(t.amount) === Math.abs(amt))) out.push(t);
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  function searchListHtml(q, catFilter) {
    const res = searchResults(q, catFilter);
    if (String(q || '').trim().length < 2 && !catFilter) return '<p class="small muted">Typ minstens 2 tekens: een naam, een woord uit de omschrijving, een categorie of een bedrag (bv. <code>45,20</code>).</p>';
    if (!res.length) return '<p class="muted">Niets gevonden.</p>';
    const total = res.reduce((a, t) => a + t.amount, 0);
    return `<p class="small muted">${res.length} transactie${res.length === 1 ? '' : 's'} · samen ${money(total)}</p>
      <div class="search-list">${res.slice(0, 150).map(t => `<button class="search-hit" data-action="edit-tx" data-id="${esc(t.id)}">
        <span class="grow"><strong>${esc(t.title || t.counterparty || t.description || '—')}</strong><span class="small muted">${fmtDate(t.date)} · ${esc(accName(t.accountId))}${t.categoryId ? ' · ' + esc(catLabel(t.categoryId)) : ''}${t.title && t.counterparty ? ' · ' + esc(t.counterparty) : ''}</span></span>
        <span class="amount ${amountClass(t.amount)}">${money(t.amount)}</span></button>`).join('')}</div>
      ${res.length > 150 ? `<p class="small muted">De eerste 150 van ${res.length}. Maak je zoekopdracht specifieker.</p>` : ''}`;
  }

  function searchModal() {
    return modalShell('Zoeken', `<input type="search" id="global-search" placeholder="Zoek in al je transacties…" value="${esc(modal.q || '')}" autocomplete="off">
      <select id="global-search-cat" aria-label="Filter op categorie" style="margin-top:8px"><option value="">Alle categorieën</option><option value="__none__" ${modal.cat === '__none__' ? 'selected' : ''}>❔ Nog niet gekoppeld</option>${categoryOptions(modal.cat || null, { special: true, allowEmpty: false })}</select>
      <div id="search-results" style="margin-top:10px">${searchListHtml(modal.q, modal.cat)}</div>`, '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>', true);
  }

  // ----- Wat is dit geld? -----

  /**
   * Eén vraag voor inkomend geld. Elke keuze leidt naar het juiste mechanisme in Helder
   * (inkomen, terugbetaling van een uitgave, terugbetaling van een voorschot, actie, eigen rekening).
   */
  function whatIsModal() {
    const m = modal;
    const t = txById(m.txId);
    if (!t) return modalShell('Wat is dit geld?', '<p class="muted">Deze transactie bestaat niet meer.</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
    const choices = [
      ['income', '💶', 'Inkomen', 'Loon, een cadeau, iets dat je verkocht, rente, …'],
      ['refund', '↩', 'Ik krijg geld terug van een uitgave', 'Iemand betaalt zijn deel van iets dat jij betaalde, of een bestelling werd geannuleerd of teruggestort. De uitgave wordt dan kleiner.'],
      ['advance', '🤝', 'Iemand betaalt een voorschot terug', 'Je had iets voorgeschoten voor iemand (dat telde niet als jouw uitgave).'],
      ['prepaid', '📥', 'Vooruitbetaald voor iets dat ik nog betaal', 'Bv. vrienden storten hun deel van de Airbnb en jij betaalt die later. Geen inkomen: je moet het nog voor hen uitgeven.'],
      ['action', '✅', 'Het hoort bij een actie', 'Bv. het geld van een retour, of mama die de kleren terugbetaalt.'],
      ['transfer', '↔', 'Van een eigen rekening', 'Je zette zelf geld over, bv. van je spaarrekening.']
    ];
    const c = m.choice;
    let detail = '';
    if (c === 'income') {
      detail = `<label class="field"><span>Welk soort inkomen?</span><select id="wi-cat">${categoryOptions(t.categoryId && cat(t.categoryId) && cat(t.categoryId).kind === 'income' ? t.categoryId : null, { kind: 'income' })}</select></label>
        <p class="btn-row"><button class="btn primary" data-action="wi-apply">Opslaan</button><button class="btn ghost" data-action="wi-newcat">+ Nieuwe inkomstenbron</button></p>`;
    } else if (c === 'refund') {
      const sugg = C.suggestRefundTargets(state, t, 6);
      detail = sugg.length ? `<p class="small muted">Van welke uitgave? Helder stelt de waarschijnlijkste voor:</p><div class="wi-list">${sugg.map(x => `<button class="wi-pick" data-action="wi-refund" data-id="${esc(x.tx.id)}"><span class="grow"><strong>${esc(x.tx.title || x.tx.counterparty || x.tx.description || 'uitgave')}</strong><span class="small muted">${fmtDate(x.tx.date)}${x.tx.categoryId ? ' · ' + esc(catLabel(x.tx.categoryId)) : ''}</span></span><span class="amount">${money(x.tx.amount)}</span></button>`).join('')}</div>
        <p class="small"><a href="#" data-action="wi-refund-other">Een andere uitgave zoeken…</a></p>`
        : `<p class="small muted">Helder vindt geen passende uitgave in de laatste 3 maanden.</p><p><button class="btn" data-action="wi-refund-other">Uitgave zelf kiezen…</button></p>`;
    } else if (c === 'prepaid') {
      detail = `<label class="field"><span>Van wie?</span><input type="text" id="wi-person" list="wi-people" value="${esc(t.counterparty && !/\d{4}/.test(t.counterparty) ? t.counterparty.split(/\s+/).slice(0, 2).join(' ') : '')}" placeholder="naam">
          <datalist id="wi-people">${C.personList(state).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></label>
        <label class="field"><span>Waarvoor? <span class="muted small">(optioneel)</span></span><input type="text" id="wi-prepaid-title" maxlength="60" placeholder="bv. Airbnb Ardennen"></label>
        <p class="btn-row"><button class="btn primary" data-action="wi-prepaid">Opslaan</button></p>
        <p class="small muted">Betaal je later de Airbnb, koppel die uitgave dan als voorschot voor deze persoon (Opvolgen → 🔗 Uitgave koppelen). Betaalde je ook voor jezelf, splits ze dan.</p>`;
    } else if (c === 'advance') {
      const people = C.personList(state).filter(p => p.stats.open > 0).sort((a, b) => b.stats.open - a.stats.open);
      detail = `<label class="field"><span>Wie betaalt terug?</span><input type="text" id="wi-person" list="wi-people" value="${esc(people[0] ? people[0].name : '')}" placeholder="naam">
          <datalist id="wi-people">${C.personList(state).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></label>
        ${people.length ? `<p class="small muted">Open: ${people.slice(0, 5).map(p => `${esc(p.name)} ${money(p.stats.open)}`).join(' · ')}</p>` : ''}
        <p class="btn-row"><button class="btn primary" data-action="wi-advance">Koppelen</button></p>
        <p class="small muted">Wil je kiezen welk voorschot precies terugbetaald is? Dat kan daarna in Terug te krijgen → 📒 Rekening-courant.</p>`;
    } else if (c === 'action') {
      const acts = (state.actions || []).filter(a => !a.closed);
      detail = `<label class="field"><span>Welke actie?</span><select id="wi-action">${acts.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}<option value="__new__">+ Nieuwe actie…</option></select></label>
        <label class="field"><span>Telt als inkomen in <span class="muted small">(optioneel)</span></span><select id="wi-action-cat">${categoryOptions(null, { kind: 'income', emptyLabel: '— Niet indelen —' })}</select></label>
        <p class="btn-row"><button class="btn primary" data-action="wi-action">Toevoegen</button></p>`;
    } else if (c === 'transfer') {
      detail = `<p class="small muted">Dan telt het niet als inkomen. Staat die andere rekening ook in Helder, dan herkent Helder de overschrijving meestal vanzelf.</p><p><button class="btn primary" data-action="wi-transfer">Ja, van een eigen rekening</button></p>`;
    }
    return modalShell('Wat is dit geld?', `
      <div class="wi-tx"><div><strong>${esc(t.title || t.counterparty || t.description || '—')}</strong><div class="small muted">${fmtDate(t.date)} · ${esc(accName(t.accountId))}${t.description && (t.title || t.counterparty) ? ' · ' + esc(t.description.slice(0, 60)) : ''}</div></div><span class="amount pos">${money(t.amount)}</span></div>
      <div class="wi-choices">${choices.map(([id, icon, title, help]) => `<button class="wi-choice ${c === id ? 'active' : ''}" data-action="wi-choose" data-choice="${id}"><span class="wi-icon">${icon}</span><span class="grow"><strong>${title}</strong><span class="small muted">${help}</span></span></button>${c === id ? `<div class="wi-detail">${detail}</div>` : ''}`).join('')}</div>`,
      '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>', true);
  }

  function whatIsDone(msg) { closeModal(); commit(msg); }

  // ----- Acties -----

  function actionById(id) { return (state.actions || []).find(a => a.id === id) || null; }

  /** Voorbeelden om snel een actie te maken. */
  const ACTION_IDEAS = ['Geld terugvragen', 'Retour binnenbrengen', 'Bonnetje indienen', 'Garantie aanvragen', 'Factuur nakijken'];

  /** Open acties (te laat en vroegste datum eerst) en gedane acties (laatst gedaan eerst). */
  function actionLists() {
    const all = state.actions || [];
    const open = all.filter(a => !a.closed).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.createdAt || '').localeCompare(b.createdAt || ''));
    const done = all.filter(a => a.closed).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    return { open, done };
  }

  function dueLabel(a) {
    if (!a.due || a.closed) return '';
    const d = C.daysBetween(today, a.due);
    const txt = d < 0 ? (-d === 1 ? '1 dag te laat' : -d + ' dagen te laat') : d === 0 ? 'vandaag' : d === 1 ? 'morgen' : 'tegen ' + fmtDate(a.due);
    return `<span class="act-due ${d < 0 ? 'late' : d <= 2 ? 'soon' : ''}">📅 ${txt}</span>`;
  }

  /** Eén actie als lijn om af te vinken, met de transacties eronder als lijstje en hun optelsom. */
  function actionRow(a) {
    const s = C.actionSummary(state, a);
    const total = s.txs.reduce((t, x) => t + x.amount, 0);
    const name = t => esc(t.title || t.counterparty || t.description || '—');
    const line = t => `<a href="#" class="act-tx" data-action="edit-tx" data-id="${esc(t.id)}"><span class="at-date">${fmtDate(t.date)}</span><span class="at-name">${name(t)}</span><span class="amount ${amountClass(t.amount)}">${money(t.amount)}</span></a>`;
    const SHOW = 3;
    const key = 'act-' + a.id;
    return `<div class="act-row ${a.closed ? 'is-done' : ''}">
      <button class="act-check" data-action="action-done" data-id="${esc(a.id)}" aria-pressed="${a.closed ? 'true' : 'false'}" title="${a.closed ? 'Toch nog niet gedaan' : 'Afvinken: gedaan'}">${a.closed ? '✓' : ''}</button>
      <div class="grow">
        <div class="act-top">
          <div class="act-title"><button class="linklike act-name" data-action="action-view" data-id="${esc(a.id)}">${esc(a.name)}</button>${dueLabel(a)}${a.closed && a.doneAt ? `<span class="small muted">gedaan op ${fmtDate(a.doneAt)}</span>` : ''}</div>
          ${s.txs.length ? `<div class="act-sum"><strong class="${amountClass(total)}">${money(total)}</strong><span class="small muted">${s.txs.length === 1 ? '1 transactie' : 'samen, ' + s.txs.length + ' transacties'}</span>${s.out && s.back ? `<span class="small muted">${money(-s.out)} uit · ${money(s.back)} in</span>` : ''}</div>` : ''}
          <button class="btn small ghost" data-action="action-edit" data-id="${esc(a.id)}" title="Bewerken" aria-label="Bewerken">✎</button>
        </div>
        ${a.note ? `<div class="small muted">${esc(a.note)}</div>` : ''}
        ${s.txs.length ? `<div class="act-txs">${s.txs.slice(0, SHOW).map(line).join('')}
          ${s.txs.length > SHOW ? `<details class="act-more" data-keep="${esc(key)}" ${ui.keepOpen[key] ? 'open' : ''}><summary class="small">Nog ${s.txs.length - SHOW} tonen</summary>${s.txs.slice(SHOW).map(line).join('')}</details>` : ''}</div>` : ''}
        <div class="act-foot small">
          ${a.expectBack && s.out ? `<span class="${s.open > 0 ? '' : 'pos'}">${s.open > 0 ? `nog <strong>${money(s.open)}</strong> terug te krijgen${a.person ? ' van ' + esc(a.person) : ''}${s.back ? ` · al ${money(s.back)} terug` : ''}` : '✓ terugbetaald'}</span>` : ''}
          ${a.closed ? '' : `<button class="linklike" data-action="action-add-tx" data-id="${esc(a.id)}">${s.txs.length ? '+ transactie toevoegen' : '+ Kies de transactie(s)'}</button>`}
        </div>
      </div>
    </div>`;
  }

  /** Eén actie in detail: alle transacties, en wat er (eventueel) terugkwam. */
  function actionCard(a, inModal) {
    const s = C.actionSummary(state, a);
    const name = t => esc(t.title || t.counterparty || t.description || '—');
    return `<div class="${inModal ? '' : 'card '}action-card ${a.closed ? 'closed' : ''}" id="action-${esc(a.id)}">
      <div class="action-head">
        <button class="act-check" data-action="action-done" data-id="${esc(a.id)}" aria-pressed="${a.closed ? 'true' : 'false'}" title="${a.closed ? 'Toch nog niet gedaan' : 'Afvinken: gedaan'}">${a.closed ? '✓' : ''}</button>
        <div class="grow"><strong class="action-name">${esc(a.name)}</strong> ${a.closed ? '<span class="badge ok">gedaan</span>' : dueLabel(a)}
          ${a.note ? `<div class="small muted">${esc(a.note)}</div>` : ''}</div>
        ${a.expectBack ? `<div class="action-open"><div class="small muted">${s.open > 0 ? 'nog terug te krijgen' + (a.person ? ' van ' + esc(a.person) : '') : 'terugbetaald'}</div><strong class="${s.open > 0 ? '' : 'pos'}">${s.open > 0 ? money(s.open) : '✓'}</strong></div>` : ''}
      </div>
      ${s.txs.length ? `<div class="action-txs">${s.txs.map(t => `<div class="action-tx">
          <div class="at-main"><a href="#" data-action="edit-tx" data-id="${esc(t.id)}">${name(t)}</a>
            <div class="small muted">${fmtDate(t.date)}${t.title && t.counterparty ? ' · ' + esc(t.counterparty) : ''}${t.categoryId ? ' · ' + esc(catLabel(t.categoryId)) : ''}</div></div>
          <span class="amount ${amountClass(t.amount)}">${money(t.amount)}</span>
          <button class="btn small ghost" data-action="action-tx-remove" data-action-id="${esc(a.id)}" data-id="${esc(t.id)}" title="Uit deze actie halen">✕</button></div>`).join('')}</div>`
        : '<p class="small muted">Nog geen transacties gekoppeld.</p>'}
      <div class="card-tools">
        <button class="btn small" data-action="action-add-tx" data-id="${esc(a.id)}">+ Transacties</button>
        <button class="btn small ghost" data-action="action-edit" data-id="${esc(a.id)}">✎ Bewerk</button>
      </div>
    </div>`;
  }

  /** Actie afvinken (of terug openzetten), met een knop om het meteen terug te draaien. */
  function toggleActionDone(id) {
    const a = actionById(id);
    if (!a) return;
    a.closed = !a.closed;
    if (a.closed) a.doneAt = today; else delete a.doneAt;
    commit();
    if (modal && modal.type === 'actionView') renderModal();
    if (a.closed) toast(`✓ “${a.name}” gedaan`, { label: 'Ongedaan maken', run: () => toggleActionDone(id) });
  }

  /** Nieuwe actie met enkel een naam, en meteen de transactie(s) kiezen. */
  function quickAction(name, txIds) {
    name = String(name || '').trim();
    if (!name) return;
    const a = { id: C.uid('act'), name, expectBack: false, person: '', note: '', createdAt: new Date().toISOString() };
    state.actions = (state.actions || []).concat([a]);
    if (txIds && txIds.length) { addToAction(txIds, a.id); commit(`Actie “${name}” toegevoegd`); return; }
    commit();
    openModal({ type: 'actionPick', id: a.id, chosen: new Set(), search: '' });
  }

  function actionModal() {
    const m = modal;
    const a = m.edit;
    return modalShell(m.isNew ? 'Nieuwe actie' : 'Actie bewerken', `
      <div class="form-stack">
        <label class="field"><span>Wat moet er gebeuren?</span><input type="text" id="act-name" maxlength="60" value="${esc(a.name || '')}" placeholder="bv. Retour binnenbrengen, Geld terugvragen aan mama" list="act-ideas">
          <datalist id="act-ideas">${ACTION_IDEAS.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label class="field"><span>Tegen wanneer? <span class="muted small">(optioneel)</span></span><input type="date" id="act-due" value="${esc(a.due || '')}"></label>
        <label class="field"><span>Notitie <span class="muted small">(optioneel)</span></span><input type="text" id="act-note" maxlength="120" value="${esc(a.note || '')}" placeholder="bv. retourlabel zit in de mail"></label>
        <label class="check"><input type="checkbox" id="act-back" ${a.expectBack ? 'checked' : ''}> Hier komt geld van terug — toon hoeveel nog open staat</label>
        <label class="field"><span>Van wie? <span class="muted small">(optioneel)</span></span><input type="text" id="act-person" maxlength="40" list="act-people" value="${esc(a.person || '')}" placeholder="bv. mama, of de winkel">
          <datalist id="act-people">${C.personList(state).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></label>
        ${m.isNew ? '' : `<label class="check"><input type="checkbox" id="act-closed" ${a.closed ? 'checked' : ''}> Gedaan</label>`}
        <div class="errors" id="act-errors"></div>
      </div>`,
      `${m.isNew ? '' : '<button class="btn danger" data-action="action-delete">Verwijderen</button>'}<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="action-save">Opslaan</button>`);
  }

  function saveAction() {
    const m = modal;
    const name = $('#act-name').value.trim();
    if (!name) { $('#act-errors').textContent = 'Schrijf wat er moet gebeuren.'; return; }
    const a = Object.assign({}, m.edit, { name, expectBack: $('#act-back').checked, person: $('#act-person').value.trim(), note: $('#act-note').value.trim() });
    const due = $('#act-due').value;
    if (C.parseDate(due)) a.due = due; else delete a.due;
    const closed = $('#act-closed') ? $('#act-closed').checked : !!a.closed;
    if (closed && !a.closed) a.doneAt = today;
    if (!closed) delete a.doneAt;
    a.closed = closed;
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
      <p class="small muted">Vink de transactie(s) aan waar deze actie over gaat${a && a.expectBack ? ', en ook de terugbetalingen als die al binnenkwamen' : ''}.</p>
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
      const name = (prompt('Wat moet er gebeuren? (bv. “Retour binnenbrengen”)') || '').trim();
      if (!name) { sel.value = ''; return; }
      const a = { id: C.uid('act'), name, expectBack: false, person: '', note: '', createdAt: new Date().toISOString() };
      state.actions = (state.actions || []).concat([a]);
      id = a.id;
    }
    const a = actionById(id);
    t.actions = (t.actions || []).filter(x => x !== id).concat([id]);
    sel.insertAdjacentHTML('beforebegin', `<span class="badge action-badge">✅ ${esc(a.name)} <button type="button" class="chip-x" data-action="tx-action-remove" data-id="${esc(a.id)}" aria-label="Uit actie halen">✕</button></span>`);
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
            <div class="small muted">${left <= 0 ? (it.forgiven >= it.amount ? fgLabel(fgReasonOf(it)) : '✓ vereffend') : left < it.amount ? `deels vereffend · nog ${money(left)} open` : '<span class="warn-text">nog open</span>'}${it.settledBy.length ? ' · door ' + it.settledBy.map(b => esc((b.kind === 'forgiven' ? fgLabel(b.reason).slice(0, 2) + ' ' : '') + (b.title || 'terugbetaling')) + ' (' + money(b.amount) + ')').join(', ') : ''}</div></td>
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
      const label = r.kind === 'forgiven' ? fgLabel(r.reason, true) + (r.title ? ': ' + r.title : '') : (r.title || r.counterparty || 'Terugbetaling');
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
        <div><div class="small muted">${st.open > 0 ? m.person + ' is je nog schuldig' : st.open < 0 ? 'Vooruitbetaald (nog voor ' + m.person + ' te betalen)' : 'Saldo'}</div><div class="cat-total ${st.open < 0 ? 'pos' : ''}">${money(Math.abs(st.open))}</div></div>
        <p class="small muted">Zoals een rekening: een voorschot zet geld op de rekening van ${esc(m.person)}, een terugbetaling haalt het eraf. Kies bij elke terugbetaling welk voorschot ze vereffent; laat je “Automatisch” staan, dan gaat ze naar het oudste open voorschot.</p>
      </div>
      ${over ? `<div class="notice small">${esc(m.person)} betaalde <strong>${money(over)}</strong> meer dan er open stond. Betaalde ${esc(m.person)} vooruit voor iets dat jij nog betaalt (bv. de Airbnb)? Koppel die uitgave dan als voorschot voor ${esc(m.person)}. Anders kan je de rest inboeken als inkomst.
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

  /**
   * Een openstaand voorschot dat niet in geld terugkomt: verrekend (bv. via Tricount, of zij betaalden iets
   * voor jou) of kwijtgescholden (cadeau). In beide gevallen wordt het jouw uitgave in een categorie naar keuze.
   */
  function forgiveModal() {
    const m = modal;
    const st = (C.personList(state).find(x => x.name.toLowerCase() === m.person.toLowerCase()) || { stats: { open: 0 } }).stats;
    const max = m.max != null ? m.max : st.open;
    return modalShell('Verrekenen — ' + (m.title ? m.title + ' (' + m.person + ')' : m.person), `
      <p class="small muted"><strong>${esc(m.person)}</strong> betaalt dit niet in geld terug. Dan is het geen voorschot meer maar <strong>jouw uitgave</strong>, in de categorie die je hieronder kiest.</p>
      <div class="fg-reasons">
        <label class="fg-reason"><input type="radio" name="fg-reason" value="settled" ${m.reason !== 'gift' ? 'checked' : ''}><span><strong>🔄 Verrekend</strong><span class="small muted">bv. via Tricount, of ${esc(m.person)} betaalde iets voor jou (zoals je eten)</span></span></label>
        <label class="fg-reason"><input type="radio" name="fg-reason" value="gift" ${m.reason === 'gift' ? 'checked' : ''}><span><strong>🎁 Kwijtgescholden</strong><span class="small muted">je vraagt het niet meer terug, bv. een cadeau of je trakteerde</span></span></label>
      </div>
      <div class="form-grid">
        <label class="field"><span>Bedrag <span class="muted small">(nog open: ${money(max)})</span></span><input type="text" id="fg-amount" inputmode="decimal" value="${esc((Math.max(0, max) / 100).toFixed(2).replace('.', ','))}"></label>
        <label class="field"><span>Datum</span><input type="date" id="fg-date" value="${esc(today)}" max="${today}"></label>
        <label class="field full fg-cat"><span id="fg-cat-label">${m.reason === 'gift' ? 'Telt als uitgave in (bv. Cadeaus)' : 'Waarvoor was het? Dit wordt je uitgave (bv. 🍽️ Eten)'}</span><select id="fg-category" required>${categoryOptions(m.categoryId || null, { kind: 'expense', emptyLabel: '— Kies de uitgave —' })}</select></label>
        <label class="field full"><span>Notitie <span class="muted small">(optioneel)</span></span><input type="text" id="fg-note" maxlength="80" placeholder="bv. Tricount weekend Ardennen, of verjaardagscadeau" value="${esc(m.title || '')}"></label>
      </div>
      <div class="errors" id="fg-errors"></div>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="forgive-save">Opslaan</button>`);
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
    if (!categoryId) errors.push(($('input[name=fg-reason]:checked') || {}).value === 'gift' ? 'Kies in welke categorie het als uitgave telt.' : 'Kies waarvoor het was (bv. Eten): dat wordt je uitgave.');
    else if (C.SYS_ADVANCE === categoryId || (cat(categoryId) && cat(categoryId).kind !== 'expense')) errors.push('Kies een uitgavencategorie.');
    if (errors.length) { $('#fg-errors').innerHTML = errors.map(esc).join('<br>'); return; }
    const p = ensurePerson(m.person);
    if (!p) { $('#fg-errors').textContent = 'Kies eerst een naam voor deze persoon (Bewerk).'; return; }
    const reason = ($('input[name=fg-reason]:checked') || {}).value === 'gift' ? 'gift' : 'settled';
    const entry = Object.assign({ id: C.uid('fg'), date, amount, categoryId, reason, note: $('#fg-note').value.trim() }, m.advanceOf ? { advanceOf: m.advanceOf } : {});
    p.forgiven = (p.forgiven || []).concat([entry]);
    closeModal();
    commit();
    toast(`${money(amount)} ${reason === 'gift' ? 'kwijtgescholden aan' : 'verrekend met'} ${p.name} → ${catName(categoryId)}`, { label: 'Ongedaan maken', run: () => removeForgive(p.name, entry.id) });
  }

  function removeForgive(person, id) {
    const p = personEntity(person);
    if (!p) return;
    p.forgiven = (p.forgiven || []).filter(f => f.id !== id);
    commit('Ongedaan gemaakt: het bedrag staat weer open');
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

  // ----- Prullenbak -----

  function trashCard() {
    const list = (state.deleted || []).filter(d => !d.hidden).slice().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    if (!list.length) return '';
    return `<details class="card trash" style="margin-top:24px" data-keep="trash" ${ui.keepOpen.trash ? 'open' : ''}>
      <summary><strong>🗑 Prullenbak</strong> <span class="small muted">· ${list.length} verwijderde transactie${list.length === 1 ? '' : 's'} — terug te zetten wanneer je wil</span></summary>
      <p class="small muted">Verwijderde transacties uit een bankbestand of de bankkoppeling worden bij een nieuwe import overgeslagen zolang ze hier staan. Zet je ze terug, dan staan ze weer gewoon in Helder.</p>
      <p class="btn-row"><button class="btn small" data-action="trash-restore-all">Alles terugzetten</button><button class="btn small ghost danger" data-action="trash-empty">Prullenbak leegmaken</button></p>
      <div class="table-wrap"><table><thead><tr><th>Datum</th><th>Omschrijving</th><th class="right">Bedrag</th><th>Verwijderd</th><th></th></tr></thead><tbody>
      ${list.slice(0, 300).map(d => `<tr><td class="nowrap">${fmtDate(d.date)}<div class="small muted">${esc(accName(d.accountId))}</div></td>
        <td>${esc((d.tx && d.tx.title) || d.counterparty || '—')}<div class="desc">${esc(d.description)}${d.tx ? '' : ' <span class="muted">(zonder koppeling teruggezet)</span>'}</div></td>
        <td class="amount ${amountClass(d.amount)}">${money(d.amount)}</td><td class="small nowrap">${esc(fmtDateTime(d.deletedAt))}</td>
        <td class="right"><button class="btn small" data-action="trash-restore" data-id="${esc(d.id)}">↩ Terugzetten</button></td></tr>`).join('')}
      </tbody></table></div></details>`;
  }

  // ----- Gemeenschappelijke startdatum -----

  /**
   * Datumvelden: Chrome meldt al een wijziging bij elk cijfer van het jaartal (2 → 0002, 20 → 0020 …).
   * Pas bewaren als de datum volledig en geloofwaardig is, na een korte pauze of bij het verlaten van het veld;
   * anders tekent Helder het veld opnieuw terwijl je nog typt.
   */
  let dateTimer = null;
  function dateWhenDone(el, apply) {
    if (dateTimer) clearTimeout(dateTimer.id);
    const run = () => {
      if (!dateTimer || dateTimer.el !== el) return;
      clearTimeout(dateTimer.id);
      dateTimer = null;
      // Werd het veld intussen opnieuw getekend? Dan staat de getypte waarde in het nieuwe veld
      const cur = el.isConnected ? el : (el.id && document.getElementById(el.id)) || el;
      const v = cur.value;
      const y = Number(v.slice(0, 4));
      if (v && (y < 1990 || y > Number(today.slice(0, 4)) + 1)) return; // nog aan het typen
      apply(v);
    };
    dateTimer = { el, run, id: setTimeout(run, 1500) };
  }

  function setDataFrom(value, quiet) {
    const v = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
    state.settings = Object.assign({}, state.settings, { dataFrom: v });
    commit(quiet ? null : v ? 'Startdatum ' + fmtDate(v) + ' voor alle banken' : 'Startdatum verwijderd');
  }

  function dataFromRow() {
    const from = state.settings.dataFrom || '';
    const starts = Banks.accountStarts(state);
    const list = Object.entries(starts).filter(([id]) => acc(id) && acc(id).type !== 'cash').map(([id, d]) => ({ id, d })).sort((a, b) => a.d.localeCompare(b.d));
    const older = from ? state.transactions.filter(t => t.source === 'import' && t.date < from).length : 0;
    const spread = list.length > 1 && C.daysBetween(list[0].d, list[list.length - 1].d) > 31;
    const suggestion = list.length ? list[list.length - 1].d.slice(0, 8) + '01' : '';
    return `<div class="card data-from">
      <h2>📅 Startdatum van je gegevens</h2>
      <div class="data-from-head"><label>Gegevens vanaf <input type="date" id="data-from" value="${esc(from)}" max="${today}"></label></div>
      <p class="small muted">Geldt voor al je banken: bankbestanden en de bankkoppeling slaan transacties van vóór deze datum over. Zo lopen je rekeningen gelijk. Leeg = alles.</p>
      ${older ? `<div class="notice small">Er zitten nog ${older} transacties van vóór ${fmtDate(from)} in Helder. <button class="btn small" data-action="trim-before">Die weghalen</button></div>` : ''}
      ${!from && spread ? `<div class="notice small">Je rekeningen beginnen niet op dezelfde datum: ${list.map(x => `${esc(accName(x.id))} vanaf ${fmtDate(x.d)}`).join(', ')}.
        <button class="btn small" data-action="align-start" data-date="${esc(suggestion)}">Allemaal vanaf ${fmtDate(suggestion)}</button></div>` : ''}
    </div>`;
  }

  // ----- Bankkoppeling (Enable Banking) -----

  try { ui.settingsTab = localStorage.getItem('flux-settings-tab') || ''; } catch (e) { /* niet erg */ }
  const bankLink = { status: null, error: '', busy: {}, errors: {}, awaiting: false };
  const LINK_REFRESH_MS = 6 * 3600000;
  const POPULAR_BANKS = /^(kbc|cbc|kbc brussels|argenta|belfius|bnp paribas fortis|ing|crelan|keytrade)/i;

  function bankLinkAvailable() { return !!(Sync && Sync.mode === 'server' && !demo && !(Sync.features && Sync.features.bank === false)); }
  function daysLeft(iso) { return iso ? Math.ceil((Date.parse(iso) - Date.now()) / 86400000) : null; }

  async function loadBankLink(opts) {
    if (!bankLinkAvailable()) return;
    try { bankLink.status = await Sync.bank.status(); bankLink.error = ''; }
    catch (e) { bankLink.error = e.message; }
    if (ui.view === 'bank' && !modal) render();
    if (opts && opts.auto) await autoFetchLinked();
  }

  function linkedAccount(a) {
    return state.accounts.find(x => x.ebUid === a.uid) || (a.iban ? state.accounts.find(x => x.iban && C.normalizeIban(x.iban) === C.normalizeIban(a.iban)) : null);
  }

  function ensureLinkedAccount(conn, a) {
    let acct = linkedAccount(a);
    if (!acct) {
      const bank = /kbc|cbc/i.test(conn.aspsp) ? 'kbc' : /argenta/i.test(conn.aspsp) ? 'argenta' : /belfius/i.test(conn.aspsp) ? 'belfius' : undefined;
      acct = { id: C.uid('acc'), name: (conn.aspsp + ' ' + (a.name || (a.iban ? '…' + a.iban.slice(-4) : ''))).trim(), iban: a.iban || '', type: 'zicht', bank };
      state.accounts.push(acct);
    }
    acct.ebUid = a.uid;
    return acct;
  }

  /** Haalt nieuwe transacties en het saldo op voor alle rekeningen van één bankkoppeling. */
  async function fetchLinked(conn, opts) {
    opts = opts || {};
    if (!bankLinkAvailable() || bankLink.busy[conn.id]) return;
    bankLink.busy[conn.id] = true;
    bankLink.errors[conn.id] = '';
    if (ui.view === 'bank' && !modal) render();
    let added = 0, changed = false;
    const notes = [];
    try {
      for (const a of conn.accounts) {
        const acct = ensureLinkedAccount(conn, a);
        changed = true;
        const linkedDates = state.transactions.filter(t => t.accountId === acct.id && t.importId && (imp(t.importId) || {}).bank === 'bankkoppeling').map(t => t.date).sort();
        let from = linkedDates.length ? C.addDays(linkedDates[linkedDates.length - 1], -10) : C.addDays(today, -730);
        if (state.settings.dataFrom && from < state.settings.dataFrom) from = state.settings.dataFrom;
        const r = await Sync.bank.fetch(conn.id, a.uid, from);
        if (demo) return;
        const rows = (r.transactions || []).map(Banks.fromEnableBanking).filter(Boolean);
        const planned = Banks.planLinked(state, acct.id, rows);
        Banks.applyLinked(state, acct.id, planned, { bankName: conn.aspsp, balance: Banks.balanceFromEnableBanking(r.balances, today) });
        acct.ebFetchedAt = new Date().toISOString();
        added += planned.fresh.length;
        if (r.limited) notes.push('de bank gaf enkel de laatste 90 dagen');
      }
    } catch (e) {
      bankLink.errors[conn.id] = e.code === 'expired' ? 'De toestemming is verlopen. Geef opnieuw toestemming.' : e.message;
      if (!opts.quiet) toast(conn.aspsp + ': ' + bankLink.errors[conn.id]);
    } finally {
      bankLink.busy[conn.id] = false;
    }
    const msg = added ? `${conn.aspsp}: ${added} nieuwe transacties opgehaald${notes.length ? ' (' + notes[0] + ')' : ''}` : (opts.quiet || bankLink.errors[conn.id] ? null : `${conn.aspsp}: geen nieuwe transacties`);
    if (changed) commit(msg); else if (ui.view === 'bank' && !modal) render();
  }

  /** Bij het openen van Helder: rekeningen ophalen die langer dan 6 uur niet bijgewerkt werden. */
  async function autoFetchLinked() {
    const st = bankLink.status;
    if (!st || !st.configured) return;
    for (const conn of st.connections) {
      if (daysLeft(conn.validUntil) !== null && daysLeft(conn.validUntil) <= 0) continue;
      const stale = conn.accounts.some(a => { const x = linkedAccount(a); return !x || !x.ebFetchedAt || Date.now() - Date.parse(x.ebFetchedAt) > LINK_REFRESH_MS; });
      if (stale) await fetchLinked(conn, { quiet: true });
    }
  }

  function bankLinkCard() {
    if (demo) return '';
    const head = extra => `<div class="link-head"><h2>🔗 Bankkoppeling</h2><span class="spacer"></span>${extra || ''}</div>`;
    if (!Sync || Sync.mode !== 'server') {
      return `<div class="card link-card">${head()}<p class="small muted">Transacties automatisch ophalen bij KBC, Argenta en andere banken werkt via je Helder-server (bv. helderfin.be)${Sync && Sync.mode === 'offline' ? '. Je bent nu offline.' : '.'}</p></div>`;
    }
    if (Sync.features && Sync.features.bank === false) return '';
    const st = bankLink.status;
    if (!st) return `<div class="card link-card">${head()}<p class="small muted">${bankLink.error ? esc(bankLink.error) : 'Laden…'}</p></div>`;
    if (!st.configured) {
      return `<div class="card link-card">${head()}
        <p>Laat Helder je transacties rechtstreeks bij je bank ophalen, zonder CSV-bestanden. Dit loopt via <strong>Enable Banking</strong>, een erkende dienst onder de Europese PSD2-regels: je meldt je aan bij je eigen bank, Helder krijgt enkel <strong>leestoegang</strong>.</p>
        <button class="btn primary" data-action="bank-setup">Bankkoppeling instellen</button></div>`;
    }
    const conns = st.connections.map(conn => {
      const left = daysLeft(conn.validUntil);
      const expired = left !== null && left <= 0;
      const err = bankLink.errors[conn.id];
      const statusText = bankLink.busy[conn.id] ? '<span class="badge">Bezig met ophalen…</span>'
        : expired || /verlopen/.test(err || '') ? '<span class="badge over">Toestemming verlopen</span>'
        : left !== null && left <= 14 ? `<span class="badge warn">Nog ${left} dagen toestemming</span>`
        : left !== null ? `<span class="badge ok">Toestemming nog ${left} dagen</span>` : '';
      const accs = conn.accounts.map(a => {
        const x = linkedAccount(a);
        return `<li><strong>${esc(a.iban ? C.formatIban(a.iban) : a.name || a.uid)}</strong>${a.name ? ` <span class="muted">${esc(a.name)}</span>` : ''}
          <div class="small muted">→ ${x ? esc(x.name) + (x.ebFetchedAt ? ' · bijgewerkt ' + esc(fmtDateTime(x.ebFetchedAt)) : ' · nog niet opgehaald') : 'nieuwe rekening in Helder bij het eerste ophalen'}</div></li>`;
      }).join('');
      return `<div class="link-conn">
        <div class="link-conn-head"><strong>${esc(conn.aspsp)}</strong> ${statusText}<span class="spacer"></span>
          <button class="btn small primary" data-action="bank-fetch" data-id="${esc(conn.id)}" ${bankLink.busy[conn.id] || expired ? 'disabled' : ''}>↻ Vernieuwen</button>
          ${expired || (left !== null && left <= 30) || err ? `<button class="btn small" data-action="bank-renew" data-id="${esc(conn.id)}">Opnieuw toestemming geven</button>` : ''}
          <button class="btn small ghost danger" data-action="bank-disconnect" data-id="${esc(conn.id)}">Verbreken</button></div>
        ${err ? `<div class="notice small">${esc(err)}</div>` : ''}
        <ul class="link-accounts">${accs || '<li class="muted">Geen rekeningen gedeeld.</li>'}</ul></div>`;
    }).join('');
    return `<div class="card link-card">${head(`<button class="btn small" data-action="bank-connect">+ Bank koppelen</button><button class="btn small ghost" data-action="bank-setup">Instellingen</button>`)}
      ${conns || '<p class="muted">Nog geen bank gekoppeld. Klik op <strong>+ Bank koppelen</strong> en kies KBC, Argenta, …</p>'}
      <p class="small muted">Helder haalt vanzelf nieuwe transacties op telkens je de app opent (hoogstens om de 6 uur). Wil je meteen bijwerken, klik dan op ↻ Vernieuwen. Wat al in Helder zat, wordt overgeslagen.</p>
      <details class="small"><summary><strong>Je spaarrekening staat er niet bij?</strong></summary>
        <p>De bankkoppeling (PSD2) is wettelijk enkel verplicht voor <em>betaalrekeningen</em>. Veel banken, zoals Belfius, geven spaarrekeningen daarom niet door, ook al duid je ze aan. Dat ligt niet aan Helder en is niet op te lossen met een andere instelling.</p>
        <p>Oplossing: download in je bank-app of op de website van je bank de transacties van je spaarrekening als <strong>CSV</strong> en laad ze op met <strong>Bankbestand opladen</strong>. Bij Belfius: open de spaarrekening → <em>Rekeninginfo / Verrichtingen</em> → <em>Exporteren</em> → <strong>CSV</strong>. Helder herkent het bestand en maakt de spaarrekening zelf aan. Je hoeft dat maar af en toe te doen; rente en stortingen veranderen weinig.</p>
      </details></div>`;
  }

  function bankSetupModal() {
    const m = modal;
    const st = bankLink.status || {};
    return modalShell('Bankkoppeling instellen', `
      ${st.shared ? `<div class="notice info small">✓ Je gebruikt de bankapp van deze Helder (gedeeld door de beheerder). Je hoeft niets in te stellen; wil je toch je eigen app gebruiken, vul ze dan hieronder in.</div>`
        : st.configured ? `<div class="notice info small">✓ Ingesteld met app <strong>${esc(st.appName || st.appId)}</strong> (${esc(st.appId)})${st.environment ? ' · ' + (st.environment === 'SANDBOX' ? '<span class="warn-text">testapp (Sandbox): enkel nepbanken — maak een Production-app voor je echte bank</span>' : esc(st.environment.toLowerCase())) : ''}.</div>` : ''}
      <p>Helder gebruikt <strong>Enable Banking</strong> om je rekeningen bij KBC, CBC, Argenta en andere banken te lezen. Je stelt dit één keer in:</p>
      <ol class="steps">
        <li>Maak een account op <a href="https://enablebanking.com" target="_blank" rel="noopener">enablebanking.com</a> en open het <strong>Control Panel</strong>.</li>
        <li>Ga naar <strong>API applications</strong> en vul het formulier zo in:
          <ul class="eb-form">
            <li><strong>1.</strong> Environment: <strong>Production</strong></li>
            <li><strong>2.</strong> Kies <strong>Generate in the browser (using SubtleCrypto) and export private key</strong></li>
            <li><strong>3.</strong> De vakjes, van boven naar onder:
              <table class="mini eb-fields"><tbody>
                ${[['Application name', 'Helder'],
                   ['Allowed redirect URLs', st.redirectUrl || (location.origin + '/api/bank/callback')],
                   ['Application description', 'Persoonlijke boekhouding: leest het saldo en de transacties van mijn eigen rekeningen.'],
                   ['Email for data protection matters', (Sync && Sync.account && Sync.account.email) || 'je eigen e-mailadres'],
                   ['Privacy URL of the application', location.origin + '/privacy'],
                   ['Terms URL of the application', location.origin + '/voorwaarden']].map(([k, v]) => `<tr><td class="small muted">${esc(k)}</td><td><code>${esc(v)}</code></td><td>${v === 'je eigen e-mailadres' ? '' : `<button class="btn small" data-action="copy" data-copy="${esc(v)}">Kopieer</button>`}</td></tr>`).join('')}
              </tbody></table></li>
            <li>Klik op <strong>Register</strong>. Je browser downloadt een <code>.pem</code>-bestand (de sleutel): bewaar het goed.</li></ul></li>
        <li><strong>Belangrijk — activeer de app:</strong> klik in het Control Panel bij je app op <strong>Activate by linking accounts</strong>, meld je aan bij je bank en duid je rekeningen aan. Zonder deze stap krijg je de fout “Application is not active”. De app werkt daarna enkel voor de rekeningen die je daar aanduidde.</li>
        <li>Vul hieronder de <strong>Application ID</strong> in en kies het <code>.pem</code>-bestand.</li>
      </ol>
      <form data-form="bank-setup" class="form-stack" autocomplete="off">
        <label class="field"><span>Application ID</span><input type="text" name="appId" id="eb-appid" value="${esc(m.appId || '')}" placeholder="bv. 1a2b3c4d-…" autocapitalize="none" required></label>
        <label class="field"><span>Privésleutel (.pem-bestand)</span><input type="file" id="eb-pem" accept=".pem,.key,.txt,application/x-pem-file"></label>
        ${m.pemName ? `<div class="small muted">Gekozen: ${esc(m.pemName)}</div>` : ''}
        <div class="errors">${esc(m.error || '')}</div>
        <button class="btn primary" type="submit" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Controleren bij Enable Banking…' : 'Opslaan en testen'}</button>
      </form>
      <p class="small muted">De sleutel wordt enkel op je Helder-server bewaard (in de map helder-data, niet via het web bereikbaar) en nooit naar je toestellen gestuurd. Je bankwachtwoord gaat nooit via Helder.</p>`,
      `${st.configured && !st.shared ? '<button class="btn danger" data-action="bank-remove-config">Instelling verwijderen</button>' : ''}<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>`, true);
  }

  async function bankSetupSubmit(form) {
    const m = modal;
    m.appId = String(new FormData(form).get('appId') || '').trim();
    if (!m.pem) { m.error = 'Kies het .pem-bestand met de privésleutel.'; renderModal(); return; }
    m.busy = true; m.error = '';
    renderModal();
    try {
      const r = await Sync.bank.saveConfig(m.appId, m.pem);
      m.pem = null;
      await loadBankLink();
      closeModal();
      toast(r.environment === 'SANDBOX' ? '⚠️ Dit is een testapp (Sandbox): enkel nepbanken. Maak in Enable Banking een Production-app voor je echte bank.' : 'Bankkoppeling ingesteld' + (r.appName ? ' (' + r.appName + ')' : '') + '. Koppel nu je bank.');
      render();
    } catch (e) {
      if (modal !== m) return;
      m.busy = false; m.error = e.message; renderModal();
    }
  }

  function bankConnectModal() {
    const m = modal;
    const q = (m.search || '').toLowerCase();
    const list = (m.aspsps || []).filter(a => !q || a.name.toLowerCase().includes(q));
    const popular = list.filter(a => POPULAR_BANKS.test(a.name));
    const rest = list.filter(a => !POPULAR_BANKS.test(a.name));
    const btn = a => `<button class="btn bank-choice" data-action="bank-start" data-name="${esc(a.name)}" data-days="${a.maxDays || ''}" ${m.busy ? 'disabled' : ''}>${esc(a.name)}</button>`;
    return modalShell('Bank koppelen', `
      <p class="small muted">Je gaat naar je eigen bank om aan te melden (itsme, kaartlezer of bank-app) en geeft Helder leestoegang tot je rekeningen. Daarna kom je vanzelf terug.</p>
      <div class="filters"><select id="eb-country">${[['BE', 'België'], ['NL', 'Nederland'], ['LU', 'Luxemburg'], ['FR', 'Frankrijk'], ['DE', 'Duitsland']].map(([v, l]) => `<option value="${v}" ${m.country === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="search" id="eb-search" placeholder="Zoek je bank…" value="${esc(m.search || '')}"></div>
      ${m.environment === 'SANDBOX' ? `<div class="notice">
          <strong>⚠️ Je Enable Banking-app is een testapp (Sandbox).</strong> Daarmee kan je enkel <em>nepbanken</em> koppelen (zoals “Mock ASPSP”), geen echte bank zoals KBC of Belfius.
          <ol class="steps small">
            <li>Ga naar <a href="https://enablebanking.com/cp/applications" target="_blank" rel="noopener">enablebanking.com → Control Panel → API applications</a> en kies bij <em>Add a new application</em> voor <strong>Production</strong>.</li>
            <li>Vul dezelfde gegevens in, met als redirect URL <code>${esc((bankLink.status && bankLink.status.redirectUrl) || location.origin + '/api/bank/callback')}</code>, en bewaar het nieuwe <code>.pem</code>-bestand.</li>
            <li>Klik bij die nieuwe app op <strong>Activate by linking accounts</strong> en duid je eigen rekeningen aan.</li>
            <li>In Helder: <strong>Bank → Instellingen</strong> → laad het nieuwe <code>.pem</code>-bestand op (het app-ID wordt vanzelf ingevuld).</li>
          </ol></div>` : ''}
      ${m.error && m.errorKind === 'inactive' ? `<div class="notice">
          <strong>Je Enable Banking-app moet nog geactiveerd worden.</strong>
          <ol class="steps small">
            <li>Ga naar <a href="https://enablebanking.com/cp/applications" target="_blank" rel="noopener">enablebanking.com → Control Panel → API applications</a>.</li>
            <li>Klik bij je app <em>Helder</em> op <strong>Activate by linking accounts</strong>.</li>
            <li>Kies je bank (bv. Belfius), meld je aan bij je bank en duid je rekeningen aan.</li>
            <li>Kom terug naar Helder en probeer opnieuw.</li>
          </ol>
          <p class="small muted">Zo werkt de gratis app enkel voor de rekeningen die je daar aanduidt. Wil je later nog een bank toevoegen, koppel die dan eerst ook daar.</p>
          <button class="btn small" data-action="bank-retry-aspsps">Opnieuw proberen</button></div>`
        : m.error ? `<div class="errors">${esc(m.error)}</div>` : ''}
      ${!m.aspsps ? '<p class="muted">Banken laden…</p>' : `
        ${popular.length ? `<div class="bank-choices">${popular.map(btn).join('')}</div>` : ''}
        ${rest.length ? `<details ${q ? 'open' : ''}><summary class="small">Andere banken (${rest.length})</summary><div class="bank-choices">${rest.map(btn).join('')}</div></details>` : ''}
        ${!list.length && !m.error ? '<p class="muted">Geen bank gevonden.</p>' : ''}`}
      ${m.busy ? '<p><strong>Doorsturen naar je bank…</strong></p>' : ''}`,
      '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>', true);
  }

  async function loadAspsps() {
    const m = modal;
    m.aspsps = null; m.error = '';
    renderModal();
    try { const r = await Sync.bank.aspsps(m.country); if (modal === m) { m.aspsps = r.aspsps; m.environment = r.environment || null; renderModal(); } }
    catch (e) { if (modal === m) { m.aspsps = []; m.error = e.message; m.errorKind = e.code || ''; renderModal(); } }
  }

  async function startBankConnect(name, country, maxDays) {
    const m = modal;
    if (m) { m.busy = true; renderModal(); }
    try {
      const r = await Sync.bank.connect(name, country, maxDays);
      bankLink.awaiting = true;
      location.href = r.url;
    } catch (e) {
      if (m && modal === m) { m.busy = false; m.error = e.message; renderModal(); } else toast(e.message);
    }
  }

  // ----- Inkomsten -----

  function recurringMap(direction) {
    const out = {};
    for (const r of C.detectRecurring(state, today, { direction }).filter(r => r.userStatus !== 'ignored')) for (const id of r.txIds) out[id] = r;
    return out;
  }
  function renderIncome() {
    const lines = C.allocations(state);
    const range = currentRange();
    const sum = C.summarize(state, range, lines);
    const rec = recurringMap('in');
    const expected = C.detectRecurring(state, today, { direction: 'in' }).filter(r => r.userStatus !== 'ignored' && r.status !== 'gestopt');
    const adv = C.advancesOverview(state);
    const divs = inv() ? Invest.dividendsIn(inv(), range) : 0;
    const list = state.transactions.filter(t => t.amount > 0 && C.inRange(t.date, range) && ['todo', 'income', 'split', 'repayment', 'refund'].includes(kindOf(t)))
      .filter(t => !ui.list.status || kindOf(t) === ui.list.status)
      .sort((a, b) => b.date.localeCompare(a.date));
    const costCats = state.categories.filter(isIncomeCost);
    const ids = incomeSources().map(c => c.id).concat(sum.byIncome.__none__ ? ['__none__'] : []);
    const cards = ids.map(id => {
      const v = sum.byIncome[id] || { gross: 0, costs: 0, net: 0, costsByCategory: {} };
      const exp = expected.filter(r => r.categoryId === id && r.daysUntil >= -5).slice(0, 2);
      const linked = costCats.filter(c => c.incomeId === id);
      return `<div class="card">
        <div class="budget-card"><div class="top"><span class="name cat-link" data-action="cat-view" data-cat="${esc(id)}"><span class="dot-lg" style="background:${esc(catColor(id === '__none__' ? null : id))}"></span> ${esc(id === '__none__' ? 'Nog niet gekoppeld' : catLabel(id))}</span>
          <span class="amount pos">${money(v.net)}</span></div></div>
        ${id !== '__none__' ? `<div class="card-tools"><button class="btn small ghost" data-action="edit-category" data-id="${esc(id)}">✎ Naam / bewerken</button><button class="btn small ghost danger" data-action="delete-category" data-id="${esc(id)}">Verwijderen</button></div>` : ''}
        <table class="mini">
          <tr><td>Bruto</td><td class="amount">${money(v.gross)}</td></tr>
          ${Object.entries(v.costsByCategory).map(([cid, a]) => `<tr><td>− ${esc(catLabel(cid))}</td><td class="amount">${money(-a)}</td></tr>`).join('')}
          <tr class="total"><td>Netto</td><td class="amount">${money(v.net)}</td></tr>
        </table>
        ${exp.length ? `<div class="small" style="margin-top:6px">🔁 Verwacht: ${exp.map(r => `${money(r.expected)} op ${fmtDate(r.nextDue)}`).join(', ')}</div>` : ''}
        ${id !== '__none__' ? `<div class="small muted" style="margin-top:6px">${linked.length ? 'Kosten: ' + linked.map(c => esc(c.name)).join(', ') : `<a href="#" data-action="new-cost-category" data-id="${esc(id)}">+ kostcategorie voor deze bron</a>`}</div>` : ''}
      </div>`;
    }).join('');

    return `
      <div class="page-head"><h1>Inkomsten</h1><span class="spacer"></span>
        <button class="btn" data-action="tax-open" title="Bedragen voor je belastingaangifte">🧾 Jaaroverzicht aangifte</button>
        <button class="btn" data-action="new-category" data-kind="income">+ Inkomstenbron</button></div>
      ${timeline()}
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Bruto</div><div class="value">${money(sum.income)}</div></div>
        <div class="card kpi"><div class="label">Kosten op inkomsten</div><div class="value">${money(sum.incomeCosts)}</div><div class="hint">afgetrokken van de bron waar ze bij horen</div></div>
        <div class="card kpi"><div class="label">Netto</div><div class="value pos">${money(sum.netIncome)}</div></div>
        <div class="card kpi"><div class="label">Terug van vrienden</div><div class="value">${money(sum.repaid)}</div><div class="hint">telt niet als inkomen${adv.totalOpen > 0 ? ' · nog ' + money(adv.totalOpen) + ' open' : ''}</div></div>
      </div>
      ${!incomeSources().length ? `<div class="card onboarding" style="margin-bottom:16px">
        <h2>Welke inkomsten heb jij?</h2>
        <p class="muted">Maak je eigen inkomstenbronnen aan, met de naam die jij wil (bv. “Loon bij Werkgever NV”, “Freelance webdesign”, “Huur appartement Gent”).
          Kosten die bij een bron horen kan je er daarna aan koppelen, zodat je ook het netto-inkomen per bron ziet.</p>
        <form data-form="new-income" class="input-row" style="max-width:520px"><input type="text" name="name" placeholder="Naam van je inkomstenbron" required><button class="btn primary" type="submit">Toevoegen</button></form>
      </div>` : ''}
      <div class="grid cards" style="margin-bottom:16px">${cards}
        ${inv() ? `<div class="card"><div class="budget-card"><div class="top"><span class="name">📈 Dividenden (Degiro)</span><span class="amount pos">${money(divs)}</span></div></div>
          <p class="small muted">Netto dividend (na bronheffing). Blijft op je beleggingsrekening en telt daarom niet mee in je netto inkomsten hierboven.</p></div>` : ''}
      </div>
      <div class="filters"><h2 style="margin:0">Ontvangen bedragen</h2><span class="spacer"></span>
        <div class="seg">${[['', 'Alles'], ['todo', 'Te koppelen'], ['income', 'Inkomsten'], ['repayment', 'Van vrienden']].map(([v, l]) => `<button class="${ui.list.status === v ? 'active' : ''}" data-action="list-status" data-status="${v}">${l}</button>`).join('')}</div></div>
      <p class="small muted">Geld van vrienden? Kies <em>Terugbetaling van een voorschot</em> (je schoot iets voor) of <em>van een uitgave</em> (je boekte de hele rekening als uitgave) — dan telt het niet als inkomen.</p>
      ${txTable(list, { recurring: rec, limit: ui.list.limit, empty: 'Geen inkomsten in deze periode.' })}`;
  }

  // ----- Uitgaven -----

  /**
   * Ronde diagram (donut) voor verhoudingen: hoogstens 5 categorieën + "Andere", zodat het leesbaar blijft.
   * Bewegen over een stuk (of de legende) toont naam, bedrag en aandeel in het midden.
   */
  function donutChart(items, opts) {
    opts = opts || {};
    const total = (opts.segs || items).reduce((a, x) => a + (x.v > 0 ? x.v : 0), 0);
    if (!total) return '';
    // Eigen stukken (opts.segs: { label, color, v }), of categorieën: hoogstens 5 + "Andere"
    const segs = opts.segs ? opts.segs.filter(x => x.v > 0) : items.slice(0, 5).map(x => ({ id: x.id || '__none__', label: x.id ? catLabel(x.id) : '❔ Nog niet gekoppeld', color: catColor(x.id), v: x.v }));
    const rest = opts.segs ? 0 : items.slice(5).reduce((a, x) => a + x.v, 0);
    if (rest > 0) segs.push({ label: '⋯ Andere (' + (items.length - 5) + ')', color: 'var(--muted-mark)', v: rest });
    const R = 80, r = 52, cx = 90, cy = 90;
    let a0 = -Math.PI / 2;
    const gap = segs.length > 1 ? 0.025 : 0; // 2px-gat tussen de stukken
    const arcs = segs.map((sg, i) => {
      const frac = sg.v / total;
      const a1 = a0 + frac * Math.PI * 2;
      const s0 = a0 + gap / 2, s1 = Math.max(s0 + 0.001, a1 - gap / 2);
      const large = s1 - s0 > Math.PI ? 1 : 0;
      const pt = (rad, ang) => (cx + rad * Math.cos(ang)).toFixed(2) + ' ' + (cy + rad * Math.sin(ang)).toFixed(2);
      const d = frac >= 0.9999
        ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} L ${cx - 0.01} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z`
        : `M ${pt(R, s0)} A ${R} ${R} 0 ${large} 1 ${pt(R, s1)} L ${pt(r, s1)} A ${r} ${r} 0 ${large} 0 ${pt(r, s0)} Z`;
      a0 = a1;
      return `<path d="${d}" fill="${esc(sg.color)}" data-donut="${i}" class="donut-seg" ${sg.id ? `data-action="cat-view" data-cat="${esc(sg.id)}"` : ''}><title>${esc(sg.label)}: ${money(sg.v)} (${(frac * 100).toFixed(0)}%)</title></path>`;
    }).join('');
    const pctTxt = v => (v / total * 100).toFixed(v / total < 0.1 || v / total > 0.9 && v < total ? 1 : 0).replace('.', ',') + '%';
    return `<div class="donut" data-total="${esc(money(opts.centerTotal != null ? opts.centerTotal : total))}" data-total-label="${esc(opts.totalLabel || 'Totaal')}">
      <svg viewBox="0 0 180 180" role="img" aria-label="${esc(opts.aria || 'Verdeling per categorie')}">${arcs}
        <text x="90" y="84" text-anchor="middle" class="donut-label" id="donut-label">${esc(opts.totalLabel || 'Totaal')}</text>
        <text x="90" y="104" text-anchor="middle" class="donut-value" id="donut-value">${esc(money(opts.centerTotal != null ? opts.centerTotal : total))}</text></svg>
 <ul class="donut-legend">${segs.map((sg, i) => `<li data-donut="${i}" ${sg.id ? `data-action="cat-view" data-cat="${esc(sg.id)}"` : ''} data-label="${esc(sg.label.replace(/\s*\(\d+\)$/, ''))}" data-value="${esc(money(sg.v) + ' · ' + pctTxt(sg.v))}"><span class="sw" style="background:${esc(sg.color)}"></span><span class="name">${esc(sg.label)}</span><span class="pct">${pctTxt(sg.v)}</span><span class="amt">${money(sg.v)}</span></li>`).join('')}</ul></div>`;
  }

  function onDonutHover(ev) {
    const box = ev.target.closest('.donut');
    if (!box) return;
    const el = ev.target.closest('[data-donut]');
    const i = el ? Number(el.dataset.donut) : -1;
    const info = i >= 0 ? $(`li[data-donut="${i}"]`, box) : null;
    $$('[data-donut]', box).forEach(x => x.classList.toggle('dim', i >= 0 && Number(x.dataset.donut) !== i));
    $('#donut-label', box).textContent = info ? info.dataset.label : box.dataset.totalLabel;
    $('#donut-value', box).textContent = info ? info.dataset.value : box.dataset.total;
  }

  function renderExpenses() {
    const lines = C.allocations(state);
    const range = currentRange();
    const sum = C.summarize(state, range, lines);
    const rec = recurringMap('out');
    const recurring = C.detectRecurring(state, today).filter(r => r.userStatus !== 'ignored' && r.status !== 'gestopt');
    const refDate = range.end > today ? today : range.end;
    const budgets = state.budgets.map(b => C.budgetStatus(state, b, refDate, lines)).sort((a, b) => b.pct - a.pct);
    const list = state.transactions.filter(t => t.amount < 0 && C.inRange(t.date, range) && ['todo', 'expense', 'split', 'advance'].includes(kindOf(t)))
      .filter(t => !ui.list.status || kindOf(t) === ui.list.status)
      .sort((a, b) => b.date.localeCompare(a.date));
    // Zelfde telling als het kader "Uitgaven": effectieve uitgaven per categorie, na terugbetalingen
    const cats = Object.entries(sum.expenseBy)
      .filter(([, v]) => v > 0)
      .map(([id, v]) => ({ id: id === '__none__' ? null : id, v })).sort((a, b) => b.v - a.v);
    const negCats = Object.entries(sum.expenseBy).filter(([id, v]) => v < 0 && id !== '__none__').map(([id, v]) => ({ id, v }));
    const refundSurplus = Object.values(sum.expenseBy).filter(v => v < 0).reduce((a, v) => a - v, 0);
    const maxCat = cats.length ? cats[0].v : 1;
    const monthlyFixed = recurring.reduce((s, r) => s + r.monthlyCost, 0);
    const cands = C.lookupCandidates(state).filter(c => c.direction === 'out').length;

    return `
      <div class="page-head"><h1>Uitgaven</h1><span class="spacer"></span>
        <button class="btn" data-action="new-tx">+ Cash-uitgave</button></div>
      ${timeline()}
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Uitgaven</div><div class="value">${money(sum.expenses)}</div><div class="hint">na terugbetalingen</div></div>
        <div class="card kpi"><div class="label">Vaste lasten per maand</div><div class="value">${money(monthlyFixed)}</div><div class="hint">${recurring.length} automatisch herkend</div></div>
        <div class="card kpi"><div class="label">Voorgeschoten</div><div class="value">${money(sum.advanced)}</div><div class="hint">voor anderen — geen uitgave</div></div>
        <div class="card kpi"><div class="label">Kosten op inkomsten</div><div class="value">${money(sum.incomeCosts)}</div><div class="hint">zie Inkomsten</div></div>
      </div>
      <div class="grid two" style="margin-bottom:16px">
        <div class="card">
          <h2>Per categorie</h2>
          ${donutChart(cats, { totalLabel: 'Uitgaven', centerTotal: sum.expenses })}
          ${refundSurplus ? `<p class="small muted">↩ In ${negCats.map(c => esc(catLabel(c.id))).join(', ')} kwam ${money(refundSurplus)} meer terug dan je in deze periode uitgaf. Dat is al afgetrokken van het totaal (${money(sum.expenses)}).</p>` : ''}
          ${cats.length ? cats.map(c => `<div class="catbar cat-link" data-action="cat-view" data-cat="${esc(c.id || '__none__')}" title="Bekijk de transacties"><span class="name">${esc(c.id ? catLabel(c.id) : 'Nog niet gekoppeld')}</span>
            <span class="track"><span class="fill" style="display:block;width:${(c.v / maxCat * 100).toFixed(1)}%;background:${esc(catColor(c.id))}"></span></span>
            <span class="amount">${money(c.v)}</span></div>`).join('') + negCats.map(c => `<div class="catbar cat-link" data-action="cat-view" data-cat="${esc(c.id)}" title="Meer terugbetaald dan uitgegeven in deze periode"><span class="name">${esc(catLabel(c.id))} <span class="small muted">↩ terugbetaling</span></span>
            <span class="track"></span><span class="amount pos">${money(c.v)}</span></div>`).join('') + (cats.length > 1 || negCats.length ? `<div class="catbar total"><span class="name"><strong>Totaal</strong></span><span class="track"></span><span class="amount"><strong>${money(sum.expenses)}</strong></span></div>` : '') : '<p class="muted">Geen uitgaven in deze periode.</p>'}
        </div>
        <div class="card">
          <div class="card-head"><h2>Budgetten</h2><button class="btn small" data-action="new-budget">+ Budget</button></div>
          ${budgets.length ? budgets.map(st => {
            const p = Math.min(st.pct, 1) * 100;
            return `<div class="budget-line"><div class="row"><span class="cat-link" data-action="cat-view" data-cat="${esc(st.budget.categoryId)}">${esc(catLabel(st.budget.categoryId))} <span class="small muted">${st.budget.period === 'yearly' ? 'jaar' : 'maand'}</span></span>
              <span class="small"><strong>${money(st.spent)}</strong> / ${money(st.limit)} <span class="badge ${st.status}">${st.status === 'ok' ? 'ok' : st.status === 'warn' ? 'bijna op' : 'over'}</span></span></div>
              <div class="progress"><div class="bar ${st.status}" style="width:${p.toFixed(1)}%"></div><div class="pace" style="left:${(st.elapsed * 100).toFixed(1)}%"></div></div>
              <div class="small muted row"><span>${st.remaining >= 0 ? 'nog ' + money(st.remaining) + (st.daysLeft > 0 ? ` · ${money(st.perDayLeft)}/dag` : '') : money(-st.remaining) + ' te veel'}</span>
                <a href="#" data-action="edit-budget" data-id="${esc(st.budget.id)}">bewerk</a></div></div>`;
          }).join('') : '<p class="muted">Nog geen budgetten. Stel een maand- of jaarlimiet in per categorie.</p>'}
        </div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <h2>Vaste lasten <span class="small muted" style="font-weight:normal">— automatisch herkend in je uitgaven</span></h2>
        ${recurring.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Tegenpartij</th><th>Ritme</th><th class="right">Bedrag</th><th>Volgende</th><th></th></tr></thead>
          <tbody>${recurring.map(r => `<tr>
            <td><strong>${esc(r.name)}</strong> ${r.categoryId ? catBadge(r.categoryId) : ''}${r.seasonal ? ` <span class="badge maybe">${esc(r.seasonal.label)}</span>` : ''}</td>
            <td>${esc(r.frequency.label)}</td>
            <td class="amount">${r.fixed ? money(r.lastAmount) : '± ' + money(r.expected)}</td>
            <td class="nowrap">${fmtDate(r.nextDue)} ${r.status === 'gemist' ? '<span class="badge over">gemist?</span>' : r.status === 'binnenkort' ? '<span class="badge warn">binnenkort</span>' : ''}</td>
            <td class="right"><button class="btn small ghost" data-action="sub-ignore" data-key="${esc(r.key)}">Geen vaste last</button></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nog niets herkend — daarvoor zijn minstens drie betalingen aan dezelfde tegenpartij met een vast ritme nodig.</p>'}
      </div>
      <div class="filters"><h2 style="margin:0">Betalingen</h2><span class="spacer"></span>
        ${cands ? `<button class="btn small" data-action="lookup">🔎 ${cands} onbekende tegenpartij(en) online opzoeken</button>` : ''}
        <div class="seg">${[['', 'Alles'], ['todo', 'Te koppelen'], ['expense', 'Uitgaven'], ['advance', 'Voorgeschoten']].map(([v, l]) => `<button class="${ui.list.status === v ? 'active' : ''}" data-action="list-status" data-status="${v}">${l}</button>`).join('')}</div></div>
      ${txTable(list, { recurring: rec, limit: ui.list.limit, empty: 'Geen uitgaven in deze periode.' })}`;
  }

  // ----- Beleggingen -----

  const DEGIRO_EXPORT_HELP = `
    <ol class="steps">
      <li><strong>Rekeningoverzicht</strong> — nodig voor stortingen, dividend, kosten en het rendement<br>
        Degiro-website → menu <em>Inbox</em> → <em>Rekeningoverzicht</em>. Kies als periode <strong>van de dag van je allereerste storting tot vandaag</strong> → <em>Exporteren</em> → <strong>CSV</strong>.
        <span class="muted">(bestand <code>Account.csv</code>)</span></li>
      <li><strong>Transacties</strong> — je aan- en verkopen, voor de aankoopprijs per positie<br>
        <em>Inbox</em> → <em>Transacties</em> → dezelfde volledige periode → <em>Exporteren</em> → <strong>CSV</strong>.
        <span class="muted">(bestand <code>Transactions.csv</code>)</span></li>
      <li><strong>Portefeuille van vandaag</strong> — je huidige posities en waarde<br>
        Menu <em>Portefeuille</em> → <em>Exporteren</em> → <strong>CSV</strong>. <span class="muted">(bestand <code>Portfolio.csv</code>; kies bij het opladen de datum <strong>vandaag</strong>)</span></li>
      <li><strong>Portefeuille op elke 31 december</strong> — voor een correct rendement per jaar en een precieze TWR<br>
        Bij het exporteren van je <em>Portefeuille</em> kan je een <strong>datum</strong> kiezen: exporteer de stand op <strong>31/12</strong> van elk jaar sinds je begon, en geef bij het opladen telkens die datum op.
        Wil je een fijnere grafiek, exporteer dan ook per kwartaal of per maand.</li>
    </ol>
    <p class="small muted">Menunamen kunnen licht verschillen per taal of app-versie. Helder herkent zelf welk soort bestand je oplaadt; hetzelfde bestand twee keer opladen voegt niets dubbel toe.</p>`;

  /** Blokken op de pagina Beleggingen; je kiest zelf welke je ziet en in welke volgorde. */
  const INVEST_SECTIONS = [
    { id: 'kpis', icon: '💶', label: 'Kerncijfers', hint: 'waarde, inleg, winst, dividend' },
    { id: 'alloc', icon: '🍩', label: 'Waarin zit je geld', hint: 'aandelen, ETF\'s, obligaties, goud, cash' },
    { id: 'returns', icon: '📈', label: 'Rendement', hint: 'TWR en MWR' },
    { id: 'chart', icon: '📉', label: 'Grafiek door de jaren' },
    { id: 'years', icon: '🗓', label: 'Rendement per jaar' },
    { id: 'positions', icon: '📋', label: 'Posities' },
    { id: 'sold', icon: '💸', label: 'Verkochte aandelen', hint: 'en wat ze vandaag waard zijn' },
    { id: 'watch', icon: '⭐', label: 'Favoriete aandelen' },
    { id: 'metals', icon: '🪙', label: 'Goud en zilver' },
    { id: 'connect', icon: '🔗', label: 'Gegevens ophalen', hint: 'Degiro, Saxo, exportbestanden' }
  ];

  /** Breedte per blok: volle breedte, of enkel de linker- of rechterhelft (naast elkaar op een groot scherm). */
  const INVEST_WIDTH_DEFAULT = { watch: 'left', metals: 'right' };
  const WIDTHS = [['full', '▭', 'Volle breedte'], ['left', '◧', 'Links'], ['right', '◨', 'Rechts']];

  function investLayout() {
    const l = (state.settings && state.settings.investLayout) || {};
    const ids = INVEST_SECTIONS.map(x => x.id);
    const order = (l.order || []).filter(id => ids.includes(id));
    for (const id of ids) if (!order.includes(id)) order.splice(Math.min(ids.indexOf(id), order.length), 0, id);
    const width = Object.assign({}, INVEST_WIDTH_DEFAULT, l.width || {});
    for (const k of Object.keys(width)) if (!ids.includes(k) || !['full', 'left', 'right'].includes(width[k])) delete width[k];
    return { order, hidden: (l.hidden || []).filter(id => ids.includes(id)), width };
  }
  function setInvestLayout(l, msg) {
    state.settings = Object.assign({}, state.settings, { investLayout: { order: l.order, hidden: l.hidden, width: l.width || {} } });
    commit(msg);
  }
  function setInvestWidth(id, w) {
    const l = investLayout();
    l.width[id] = w;
    setInvestLayout(l);
  }
  function toggleInvestSection(id, show) {
    const l = investLayout();
    l.hidden = show ? l.hidden.filter(x => x !== id) : Array.from(new Set(l.hidden.concat(id)));
    setInvestLayout(l);
  }
  function moveInvestSection(id, dir) {
    const l = investLayout();
    const i = l.order.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= l.order.length) return;
    [l.order[i], l.order[j]] = [l.order[j], l.order[i]];
    setInvestLayout(l);
  }

  function renderInvest() {
    maybeAutoFetchMetals();
    maybeFetchWatch();
    const iv = inv();
    const server = Sync && Sync.mode === 'server' && !demo;
    const connect = `<div class="card">
        <h2>Gegevens ophalen</h2>
        <div class="grid two" style="gap:12px">
          <div class="section">
            <h3>Rechtstreeks uit Degiro</h3>
            ${server ? `<p class="small muted">Log in met je Degiro-gegevens; Helder haalt portefeuille, transacties en rekeningoverzicht op. <strong>Wachtwoord en 2FA-code worden niet bewaard</strong> — je logt telkens opnieuw in.</p>
              <button class="btn primary" data-action="degiro-connect">Ophalen uit Degiro…</button>
              <p class="small muted">Elke keer ophalen voegt een waarderingspunt toe aan de grafiek. Historische standen levert Degiro niet via deze weg: gebruik voor vroegere jaren de portefeuille-export per 31/12.</p>`
              : `<p class="small muted">Kan enkel als Helder op je eigen server draait (zie README → Hosten)${demo ? ', en niet in de voorbeeldmodus' : ''}. Gebruik intussen de exportbestanden.</p>`}
          </div>
          <div class="section">
            <h3>Met exportbestanden</h3>
            <p class="small muted">Laad één of meer Degiro-exports op (CSV). Helder herkent zelf welk bestand het is.</p>
            <button class="btn" data-action="degiro-files">Exportbestanden opladen…</button>
            ${iv && server ? `<p class="small muted" style="margin-top:8px">Historische koersen: ${iv.market && iv.market.fetchedAt ? 'opgehaald ' + esc(fmtDateTime(iv.market.fetchedAt)) + ' (' + Object.keys(iv.market.series || {}).length + ' product(en))' : 'nog niet opgehaald'} · <a href="#" data-action="fetch-prices">nu ophalen</a></p>` : ''}
            <details style="margin-top:8px"><summary class="small"><strong>Wat moet ik exact exporteren?</strong></summary>${DEGIRO_EXPORT_HELP}</details>
          </div>
        </div>
      </div>
      ${saxoCard()}`;
    const s = iv ? Invest.summary(iv) : null;
    const perf = iv ? Invest.performance(iv) : null;
    const files = iv ? iv.files || [] : [];
    const blocks = {
      kpis: () => !iv ? '' : `
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Waarde</div><div class="value">${money(s.valueEur)}</div><div class="hint">stand ${fmtDate(iv.positionsDate)} · waarvan cash ${money(s.cashEur)}</div></div>
        <div class="card kpi"><div class="label">Netto ingelegd</div><div class="value">${s.hasDeposits ? money(s.netDeposits) : '—'}</div><div class="hint">${s.hasDeposits ? 'stortingen ' + money(s.deposits) + (s.withdrawals ? ' − opnames ' + money(s.withdrawals) : '') : 'laad het rekeningoverzicht op'}</div></div>
        <div class="card kpi"><div class="label">Winst / verlies</div><div class="value ${s.gainEur >= 0 ? 'pos' : 'negv'}">${s.gainEur != null ? money(s.gainEur) : '—'}</div><div class="hint">waarde − netto inleg</div></div>
        <div class="card kpi"><div class="label">Dividend (netto)</div><div class="value">${money(s.netDividends)}</div><div class="hint">kosten: ${money(s.fees)}</div></div>
      </div>
`,
      returns: () => !iv ? '' : !perf ? `<div class="notice info">Voor TWR en MWR heeft Helder je stortingen (Rekeningoverzicht) en minstens één portefeuillewaarde nodig.</div>` : `
      <div class="grid kpis">
        <div class="card kpi" title="Time-weighted return">
          <div class="label">TWR — tijdgewogen</div><div class="value">${pct(perf.twrAnnual)} <span class="small muted">per jaar</span></div>
          <div class="hint">${pct(perf.twr)} in totaal sinds ${fmtDate(perf.start)}. Het rendement van je beleggingen zelf, los van wanneer en hoeveel je stortte — vergelijkbaar met een fonds of index.</div></div>
        <div class="card kpi" title="Money-weighted return (XIRR)">
          <div class="label">MWR / MWRR — geldgewogen</div><div class="value">${pct(perf.mwr)} <span class="small muted">per jaar</span></div>
          <div class="hint">Jouw persoonlijke rendement (XIRR): houdt rekening met het moment en de grootte van elke storting.</div></div>
      </div>
      ${perf.missingYearEnds.length ? `<div class="notice">Voor een rendement per jaar ontbreekt de portefeuillewaarde op <strong>${Array.from(new Set(perf.missingYearEnds)).map(fmtDate).join(', ')}</strong>, en er zijn geen transacties om ze uit te reconstrueren.</div>` : ''}
      ${perf.ignoredFlows.length ? `<div class="notice info">${perf.ignoredFlows.length} storting(en) na ${fmtDate(perf.end)} tellen nog niet mee, omdat er nog geen recentere waardering is.</div>` : ''}
`,
      chart: () => !perf ? '' : `
      <div class="card" style="margin-bottom:16px">
        <h2>Portefeuille door de jaren</h2>
        ${investChart(perf)}
      </div>
`,
      years: () => !perf ? '' : `
      <div class="card" style="margin-bottom:16px">
        <h2>Rendement per jaar</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Jaar</th><th class="right">Begin</th><th class="right">Stortingen</th><th class="right">Opnames</th><th class="right">Einde</th><th class="right">Resultaat</th><th class="right">TWR</th><th class="right">MWR</th><th class="right">Dividend</th></tr></thead>
          <tbody>${perf.years.map(y => `<tr>
            <td><strong>${y.year}</strong>${y.partial ? ` <span class="small muted">t.e.m. ${fmtDate(y.endDate)}</span>` : ''}${y.estimated ? ' <span class="badge small" title="Begin- of eindwaarde gereconstrueerd uit je transacties">geschat</span>' : ''}</td>
            <td class="amount">${y.startValue != null ? money(y.startValue) : '—'}</td>
            <td class="amount">${money(y.deposits)}</td>
            <td class="amount">${y.withdrawals ? money(y.withdrawals) : '—'}</td>
            <td class="amount">${y.endValue != null ? money(y.endValue) : '—'}</td>
            ${y.missing.length ? `<td colspan="3" class="small muted">ontbreekt: portefeuille op ${y.missing.map(fmtDate).join(' en ')}</td>`
              : `<td class="amount ${y.result >= 0 ? 'pos' : 'negv'}">${money(y.result)}</td><td class="amount">${pct(y.twr)}</td><td class="amount">${pct(y.mwr)}</td>`}
            <td class="amount">${money(y.dividends)}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted"><strong>Resultaat</strong> = eindwaarde − beginwaarde − netto stortingen. <strong>TWR</strong> meet hoe goed je beleggingen het deden (vergelijk met een index).
          <strong>MWR</strong> is jouw eigen rendement: stortte je vlak voor een daling, dan is je MWR lager dan je TWR. Voor het lopende jaar: rendement tot nu, niet op jaarbasis.</p>
      </div>`,
      positions: () => !iv ? '' : `
      <div class="card" style="margin-bottom:16px">
        <h2>Posities</h2>
        ${s.positions.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Product</th><th class="right">Aantal</th><th class="right">Waarde</th><th class="right">Aankoop</th><th class="right">Winst</th><th>Aandeel</th></tr></thead>
          <tbody>${s.positions.map(p => `<tr>
            <td><strong>${esc(p.name)}</strong><div class="small muted">${esc(p.isin || p.symbol || '')}${p.currency !== 'EUR' ? ' · ' + esc(p.currency) : ''}${iv.brokers ? ' · ' + esc(p.broker === 'saxo' ? 'Saxo' : 'Degiro') : ''}</div></td>
            <td class="right">${String(p.quantity).replace('.', ',')}</td>
            <td class="amount">${money(p.valueEur)}</td>
            <td class="amount">${p.costEur != null ? money(p.costEur) : '—'}</td>
            <td class="amount ${p.gainEur >= 0 ? 'pos' : 'negv'}">${p.gainEur != null ? money(p.gainEur) + `<div class="small">${p.costEur ? pct(p.gainEur / p.costEur) : ''}</div>` : '—'}</td>
            <td style="min-width:90px"><div class="track"><span class="fill" style="display:block;width:${(p.share * 100).toFixed(1)}%;background:var(--series-1)"></span></div><span class="small muted">${(p.share * 100).toFixed(1).replace('.', ',')}%</span></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Geen posities.</p>'}
      </div>
`,
      alloc: () => allocationCard(iv),
      sold: () => iv ? soldCard(iv) : '',
      watch: () => watchCard(),
      metals: () => metalsCard(),
      connect: () => iv ? `${connect}
      ${files.length ? `<div class="card" style="margin-top:16px"><h2>Opgeladen Degiro-bestanden</h2><div class="list">${files.slice().reverse().map(f => `<div class="list-row"><div class="grow">📄 ${esc(f.name)}<div class="small muted">${esc({ portfolio: 'Portefeuille', transactions: 'Transacties', account: 'Rekeningoverzicht' }[f.type] || f.type)}${f.date ? ' — stand op ' + fmtDate(f.date) : ''} · opgeladen ${esc(fmtDateTime(f.importedAt))}</div></div></div>`).join('')}</div></div>` : ''}
      <p style="margin-top:16px">${iv.brokers ? Invest.brokers(iv).map(b => `<button class="btn small danger" data-action="invest-remove-broker" data-id="${esc(b.id)}">Gegevens van ${esc(b.name)} wissen</button> `).join('') : ''}<button class="btn small danger" data-action="degiro-clear">Alle beleggingsgegevens wissen</button></p>` : `<p class="muted">Koppel je Degiro- of Saxo-rekening om je portefeuille, je stortingen en je rendement (TWR en MWR) te zien. Overschrijvingen van je bank naar je broker tellen in Helder als <em>belegging</em>, niet als uitgave.</p>
        ${connect}
        <div class="card" style="margin-top:16px"><h2>Wat moet ik exporteren uit Degiro?</h2>${DEGIRO_EXPORT_HELP}</div>`
    };
    const l = investLayout();
    const edit = !!ui.investEdit;
    const meta = id => INVEST_SECTIONS.find(x => x.id === id);
    const hiddenList = l.order.filter(id => l.hidden.includes(id));
    const body = l.order.map((id, i) => {
      const m = meta(id);
      const hidden = l.hidden.includes(id);
      const w = l.width[id] || 'full';
      if (!edit) { const html = hidden ? '' : blocks[id](); return html.trim() ? `<div class="iv-cell w-${w}">${html}</div>` : ''; }
      const html = hidden ? '' : blocks[id]();
      return `<section class="iv-sec iv-cell w-${hidden ? 'full' : w} ${hidden ? 'is-hidden' : ''}">
        <div class="iv-bar">
          <label class="switch" title="${hidden ? 'Tonen' : 'Verbergen'}"><input type="checkbox" data-invest-show="${id}" ${hidden ? '' : 'checked'}><span></span></label>
          <span class="grow"><strong>${m.icon} ${esc(m.label)}</strong>${m.hint ? ` <span class="small muted">${esc(m.hint)}</span>` : ''}${!hidden && !html.trim() ? ' <span class="small muted">· nog geen gegevens</span>' : ''}</span>
          ${hidden ? '' : `<div class="seg iv-width" role="group" aria-label="Breedte">${WIDTHS.map(([k, icon, label]) => `<button class="${w === k ? 'active' : ''}" data-action="invest-width" data-id="${id}" data-w="${k}" title="${label}" aria-pressed="${w === k}">${icon}<span class="iv-wlabel"> ${label}</span></button>`).join('')}</div>`}
          <button class="btn small ghost" data-action="invest-move" data-id="${id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Hoger" aria-label="Hoger">↑</button>
          <button class="btn small ghost" data-action="invest-move" data-id="${id}" data-dir="1" ${i === l.order.length - 1 ? 'disabled' : ''} title="Lager" aria-label="Lager">↓</button>
        </div>
        ${hidden ? '' : `<div class="iv-preview">${html}</div>`}
      </section>`;
    }).join('');
    return `
      <div class="page-head"><h1>Beleggingen</h1><span class="spacer"></span>
        ${iv ? `<button class="btn" data-action="tax-open" title="Bedragen voor je belastingaangifte">🧾 Jaaroverzicht aangifte</button>` : ''}
        <button class="btn ${edit ? 'primary' : ''}" data-action="invest-edit">${edit ? '✓ Klaar' : '⚙ Weergave aanpassen'}</button>
        ${iv ? `<span class="small muted">Bron: ${Invest.brokers(iv).map(b => esc(b.source === 'demo' ? 'voorbeeld' : b.source === 'degiro-csv' ? 'Degiro-exports' : b.name + ' (rechtstreeks)') + ' · bijgewerkt ' + esc(fmtDateTime(b.syncedAt))).join(' — ')}</span>` : ''}</div>
      ${edit ? `<div class="iv-edit-help">Zet aan wat je wil zien, kies met ↑ ↓ de volgorde en met ▭ ◧ ◨ of een blok de volle breedte krijgt of enkel links of rechts staat (twee halve blokken komen naast elkaar). Je keuze wordt bewaard (ook op je andere toestellen). <span class="spacer"></span>
        <button class="btn small ghost" data-action="invest-reset">Standaard herstellen</button><button class="btn small primary" data-action="invest-edit">✓ Klaar</button></div>` : ''}
      <div class="iv-grid ${edit ? 'iv-editing' : ''}">${body}</div>
      ${!edit && hiddenList.length ? `<div class="iv-hidden-note small muted">Verborgen: ${hiddenList.map(id => `<button class="chip" data-action="invest-show" data-id="${id}" title="Terug tonen">+ ${meta(id).icon} ${esc(meta(id).label)}</button>`).join(' ')} <a href="#" data-action="invest-edit">Weergave aanpassen</a></div>` : ''}`;
  }

  const CLASS_COLORS = { stock: 'var(--series-1)', etf: 'var(--series-2)', bond: 'var(--series-3)', metal: 'var(--series-4)', cash: 'var(--series-5)', other: 'var(--muted-mark)' };

  /** Ronde diagram: waarin je beleggingsgeld zit, met de indeling per product die je zelf kan aanpassen. */
  function allocationCard(iv) {
    const overrides = (state.settings && state.settings.assetClasses) || {};
    const ms = metals();
    const groups = Invest.allocation(iv, { overrides, metalsValue: ms.value });
    if (!groups.length) return '';
    const total = groups.reduce((a, g) => a + g.value, 0);
    const products = groups.flatMap(g => g.items.filter(x => !x.fixed));
    return `<div class="card" style="margin-bottom:16px">
      <h2>Waarin zit je geld</h2>
      ${donutChart([], { segs: groups.map(g => ({ label: g.icon + ' ' + g.label, color: CLASS_COLORS[g.id], v: g.value })), totalLabel: 'Belegd', aria: 'Verdeling van je beleggingen per soort' })}
      <div class="alloc-groups small">${groups.map(g => `<div class="alloc-group"><span class="sw" style="background:${CLASS_COLORS[g.id]}"></span><strong>${g.icon} ${esc(g.label)}</strong>
        <div class="muted">${g.items.slice(0, 4).map(x => esc(x.name)).join(' · ')}${g.items.length > 4 ? ' · +' + (g.items.length - 4) : ''}</div></div>`).join('')}</div>
      ${products.length ? `<details class="alloc-edit" data-keep="allocEdit" ${ui.keepOpen.allocEdit ? 'open' : ''}><summary class="small"><strong>Klopt de indeling niet?</strong> <span class="muted">Kies per product zelf de soort</span></summary>
        <div class="list">${products.sort((a, b) => b.value - a.value).map(x => `<div class="list-row"><div class="grow">${esc(x.name)}<div class="small muted"><span class="amount">${money(x.value)}</span>${x.manual ? ' · zelf gekozen' : ' · automatisch herkend'}</div></div>
          <select data-asset-class="${esc(x.key)}" aria-label="Soort voor ${esc(x.name)}">${Invest.ASSET_CLASSES.map(c => `<option value="${c.id}" ${x.cls === c.id ? 'selected' : ''}>${c.icon} ${esc(c.label)}${c.id === x.auto && !x.manual ? '' : c.id === x.auto ? ' (automatisch)' : ''}</option>`).join('')}</select></div>`).join('')}</div></details>` : ''}
      <p class="small muted">Posities volgens je laatste stand, plus de cash op je beleggingsrekening${ms.value ? ' en je fysiek goud en zilver' : ''}. Bankrekeningen tellen hier niet mee.</p>
    </div>`;
  }

  function soldCard(iv) {
    const r = Invest.realized(iv);
    if (!r.positions.length) {
      return (iv.trades || []).length ? `<div class="card" style="margin-bottom:16px"><h2>Verkochte aandelen</h2><p class="muted">Je hebt nog niets verkocht.</p></div>` : '';
    }
    const list = Invest.soldVsToday(iv);
    const qty = v => String(Math.round(v * 10000) / 10000).replace('.', ',');
    const known = list.filter(p => p.todayValue != null);
    const proceedsKnown = known.reduce((a, p) => a + p.proceeds, 0);
    const todayTotal = known.reduce((a, p) => a + p.todayValue, 0);
    const diffTotal = todayTotal - proceedsKnown;
    const server = Sync && Sync.mode === 'server' && !demo;
    return `<div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>Verkochte aandelen</h2>
        <span class="badge ${r.total >= 0 ? 'ok' : 'over'}">${r.total >= 0 ? '▲' : '▼'} gerealiseerd ${money(r.total)}</span></div>
      <p class="small muted">Wat je ooit kocht en (deels) verkocht, met het resultaat van die verkoop (opbrengst − aankoopprijs, kosten inbegrepen; bij aankopen in schijven met je gemiddelde aankoopprijs).
        En wat diezelfde stuks <strong>vandaag</strong> waard zouden zijn, tegenover wat je bij de verkoop kreeg.</p>
      ${known.length ? ''
        : `<p class="small muted">${server ? 'Nog geen koers van vandaag. <a href="#" data-action="fetch-prices">Koersen ophalen</a>' : 'De koers van vandaag kan Helder enkel ophalen als het op je eigen server draait.'}</p>`}
      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Periode</th><th class="right">Verkocht</th><th class="right">Aankoopprijs</th><th class="right">Opbrengst</th><th class="right">Winst / verlies</th><th class="right">Vandaag waard</th><th class="right">Sinds verkoop</th><th></th></tr></thead>
        <tbody>${list.map(p => `<tr>
          <td><strong>${esc(p.name)}</strong><div class="small muted">${esc(p.isin)}${p.closed ? ' · volledig verkocht' : ' · nog ' + qty(p.qty) + ' in bezit'}${p.dividends ? ' · dividend ' + money(p.dividends) : ''}</div></td>
          <td class="nowrap small">${p.firstBuy ? fmtDate(p.firstBuy) : '?'} → ${fmtDate(p.lastSell)}</td>
          <td class="right">${qty(p.soldQty)}${p.sellPrice ? `<div class="small muted">à ${money(Math.round(p.sellPrice))}</div>` : ''}</td>
          <td class="amount">${money(p.costSold)}</td>
          <td class="amount">${money(p.proceeds)}</td>
          <td class="amount ${p.result >= 0 ? 'pos' : 'negv'}"><strong>${p.result >= 0 ? '▲ ' : '▼ '}${money(p.result)}</strong><div class="small">${p.pct != null ? pct(p.pct) : ''}</div></td>
          <td class="amount">${p.todayValue != null ? money(p.todayValue) + `<div class="small muted">à ${money(Math.round(p.lastPrice))} · ${fmtDate(p.lastDate)}</div>` : '—'}</td>
          <td class="amount ${p.diff == null ? '' : p.diff >= 0 ? 'pos' : 'negv'}">${p.diff != null ? `<strong>${p.diff >= 0 ? '▲ ' : '▼ '}${money(p.diff)}</strong><div class="small">${pct(p.diffPct)}</div>` : '—'}</td>
          <td><button class="btn small ghost" data-action="watch-from-sold" data-key="${esc(p.key)}" title="Volgen bij je favorieten, met je verkoopkoers als start">⭐</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="5"><strong>Totaal</strong></td><td class="amount ${r.total >= 0 ? 'pos' : 'negv'}"><strong>${money(r.total)}</strong></td>
          <td class="amount">${known.length ? money(todayTotal) : '—'}</td><td class="amount ${diffTotal >= 0 ? 'pos' : 'negv'}">${known.length ? `<strong>${money(diffTotal)}</strong>` : '—'}</td><td></td></tr></tfoot>
      </table></div>
      <p class="small muted">“Sinds verkoop” = wat de verkochte stuks vandaag waard zijn − wat je ervoor kreeg. Dividenden die je sindsdien gemist hebt en kosten zitten er niet in.</p></div>`;
  }

  // ----- Favoriete aandelen -----

  const watchQuotes = () => (state.settings && state.settings.watchQuotes) || {};
  let watchBusy = false, watchAuto = false;

  /** Koersen voor je favorieten ophalen (sinds hun startdatum) via de server. */
  async function fetchWatchQuotes(force, onlyIds) {
    const list = (state.watchlist || []).filter(w => !onlyIds || onlyIds.includes(w.id));
    if (!list.length || watchBusy || demo || !(Sync && Sync.mode === 'server')) { if (force && !(Sync && Sync.mode === 'server' && !demo)) toast('Koersen ophalen kan enkel als Helder op je eigen server draait. Vul de koers van vandaag dan zelf in.'); return; }
    watchBusy = true;
    try {
      const isIsin = v => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(String(v || '').trim().toUpperCase());
      const r = await Sync.prices(list.map(w => ({ key: w.id, isin: isIsin(w.query) ? w.query.trim().toUpperCase() : '', name: w.query || w.name, currency: 'EUR', from: w.startDate })));
      const q = Object.assign({}, watchQuotes());
      for (const w of list) {
        const sr = r.series && r.series[w.id];
        if (sr) {
          // Enkel bewaren wat nodig is: de koers rond de startdatum en de laatste
          const pts = sr.points.filter(p => p.eur > 0);
          let atStart = null;
          for (const p of pts) { if (p.date <= w.startDate) atStart = p; else break; }
          const keep = [atStart || pts[0], pts[pts.length - 1]].filter(Boolean);
          q[w.id] = { symbol: sr.symbol, currency: sr.currency, points: keep.filter((p, i) => keep.findIndex(x => x.date === p.date) === i), startDate: w.startDate, at: new Date().toISOString() };
        } else q[w.id] = { error: (r.errors && r.errors[w.id]) || 'niet gevonden', at: new Date().toISOString() };
      }
      for (const id of Object.keys(q)) if (!(state.watchlist || []).some(w => w.id === id)) delete q[id];
      state.settings = Object.assign({}, state.settings, { watchQuotes: q });
      commit(force ? 'Koersen van je favorieten bijgewerkt' : undefined);
    } catch (e) {
      if (force) toast('Koersen ophalen lukte niet: ' + e.message);
    } finally { watchBusy = false; }
  }

  function maybeFetchWatch() {
    if (watchAuto || !(state.watchlist || []).length) return;
    const q = watchQuotes();
    const stale = (state.watchlist || []).some(w => !q[w.id] || q[w.id].startDate !== w.startDate || Date.now() - Date.parse(q[w.id].at || 0) > 12 * 3600000);
    if (!stale) return;
    watchAuto = true;
    fetchWatchQuotes(false);
  }

  function watchCard() {
    const rows = Invest.watchSummary(state.watchlist || [], watchQuotes()).sort((a, b) => (b.changePct ?? -1e9) - (a.changePct ?? -1e9));
    const server = Sync && Sync.mode === 'server' && !demo;
    const lastAt = Object.values(watchQuotes()).map(x => x.at).filter(Boolean).sort().pop();
    return `<div class="card" style="margin-bottom:16px">
      <div class="metals-head">
        <div><h2>⭐ Favoriete aandelen</h2>
          <div class="small muted">Volg aandelen of fondsen vanaf een startkoers die je zelf kiest${lastAt ? ` · koersen van ${esc(fmtDateTime(lastAt))}` : ''}${server && rows.length ? ' · <a href="#" data-action="watch-refresh">bijwerken</a>' : ''}</div></div>
        <span class="spacer"></span>
        <button class="btn primary" data-action="watch-new">+ Aandeel volgen</button>
      </div>
      ${rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Aandeel</th><th class="right">Start</th><th class="right">Vandaag</th><th class="right">Wijziging</th></tr></thead>
        <tbody>${rows.map(w => `<tr class="clickable" data-action="watch-edit" data-id="${esc(w.id)}">
          <td><strong>${esc(w.name)}</strong><div class="small muted">${esc([w.symbol || w.query, w.note].filter(Boolean).join(' · '))}${w.error ? ` · <span class="warn-text">${esc(w.error)}</span>` : ''}</div></td>
          <td class="amount">${w.start != null ? money(Math.round(w.start)) : '—'}<div class="small muted">${fmtDate(w.startDate)}${w.startSource === 'manual' ? ' · zelf gekozen' : ''}</div></td>
          <td class="amount">${w.now != null ? money(Math.round(w.now)) : '—'}<div class="small muted">${w.nowDate ? fmtDate(w.nowDate) : ''}${w.nowSource === 'manual' ? ' · zelf ingevuld' : ''}</div></td>
          <td class="amount ${w.change == null ? '' : w.change >= 0 ? 'pos' : 'negv'}">${w.change != null ? `<strong>${w.change >= 0 ? '▲ ' : '▼ '}${pct(w.changePct)}</strong><div class="small">${w.change >= 0 ? '+' : ''}${money(Math.round(w.change))} per stuk</div>` : '—'}</td>
        </tr>`).join('')}</tbody></table></div>
        <p class="small muted">Koersen in euro (weekkoersen van Yahoo Finance; aandelen in een andere munt worden omgerekend). Een eigen startkoers gaat voor op de koers van die datum.</p>`
        : `<p class="muted">Hou aandelen in het oog die je niet (meer) hebt: kies een startdatum en eventueel een eigen startkoers, en Helder toont hoeveel ze sindsdien stegen of daalden.</p>`}
    </div>`;
  }

  function watchModal() {
    const m = modal;
    const w = m.edit;
    const server = Sync && Sync.mode === 'server' && !demo;
    const v = c => c ? (c / 100).toFixed(2).replace('.', ',') : '';
    return modalShell(m.isNew ? 'Aandeel volgen' : 'Favoriet bewerken', `
      <div class="form-grid">
        <label class="field full"><span>Naam</span><input type="text" id="wl-name" maxlength="60" value="${esc(w.name || '')}" placeholder="bv. Apple"></label>
        <label class="field full"><span>ISIN, ticker of naam om de koers te zoeken</span><input type="text" id="wl-query" maxlength="60" value="${esc(w.query || '')}" placeholder="bv. US0378331005, AAPL of Apple"></label>
        <label class="field"><span>Startdatum</span><input type="date" id="wl-date" value="${esc(w.startDate || today)}" max="${today}"></label>
        <label class="field"><span>Startkoers per stuk in € <span class="muted small">(optioneel)</span></span><input type="text" id="wl-start" inputmode="decimal" value="${esc(v(w.startPrice))}" placeholder="leeg = koers op die datum"></label>
        ${server ? '' : `<label class="field full"><span>Koers vandaag in € <span class="muted small">(zelf invullen — online ophalen kan enkel op je eigen server)</span></span><input type="text" id="wl-now" inputmode="decimal" value="${esc(v(w.nowPrice))}"></label>`}
        <label class="field full"><span>Notitie <span class="muted small">(optioneel)</span></span><input type="text" id="wl-note" maxlength="100" value="${esc(w.note || '')}" placeholder="bv. verkocht in 2021, of: wil ik kopen onder € 150"></label>
      </div>
      <div class="errors" id="wl-errors"></div>`,
      `${m.isNew ? '' : '<button class="btn danger" data-action="watch-delete">Niet meer volgen</button>'}<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="watch-save">Opslaan</button>`);
  }

  function saveWatch() {
    const w = Object.assign({}, modal.edit);
    w.name = $('#wl-name').value.trim();
    w.query = $('#wl-query').value.trim() || w.name;
    w.startDate = $('#wl-date').value;
    const sp = C.parseAmount($('#wl-start').value);
    const errors = [];
    if (!w.name) errors.push('Geef een naam.');
    if (!C.parseDate(w.startDate)) errors.push('Kies een startdatum.');
    if ($('#wl-start').value.trim() && (isNaN(sp) || sp <= 0)) errors.push('De startkoers is geen geldig bedrag.');
    if (errors.length) { $('#wl-errors').innerHTML = errors.map(esc).join('<br>'); return; }
    if ($('#wl-start').value.trim()) w.startPrice = Math.abs(sp); else delete w.startPrice;
    if ($('#wl-now')) { const np = C.parseAmount($('#wl-now').value); if ($('#wl-now').value.trim() && np > 0) { w.nowPrice = np; w.nowDate = today; } else { delete w.nowPrice; delete w.nowDate; } }
    w.note = $('#wl-note').value.trim();
    state.watchlist = state.watchlist || [];
    const i = state.watchlist.findIndex(x => x.id === w.id);
    if (i >= 0) state.watchlist[i] = w; else state.watchlist.push(Object.assign(w, { createdAt: new Date().toISOString() }));
    closeModal();
    commit(i >= 0 ? 'Bewaard' : `${w.name} wordt gevolgd`);
    fetchWatchQuotes(false, [w.id]);
  }

  /** Grafiek: portefeuillewaarde (lijn) en totale inleg (trap), met elke bijstorting als punt. */
  let chartData = null;
  function investChart(perf) {
    // Echte waarderingen + reconstructie op elk maandeinde (of per week bij een korte historiek)
    const actualVals = Invest.valuations(inv()).filter(v => v.date >= perf.start);
    const lastActual = actualVals.length ? actualVals[actualVals.length - 1].date : perf.end;
    const spanDays = C.daysBetween(perf.start, lastActual);
    const extra = [];
    if (Invest.canEstimate(inv())) {
      for (let d = perf.start; d < lastActual; d = spanDays > 200 ? C.addDays(C.addMonths(C.addDays(d, 1).slice(0, 8) + '01', 1), -1) : C.addDays(d, 7)) if (d > perf.start) extra.push(d);
    }
    const est = Invest.valueSeries(inv(), extra);
    const vals = actualVals.map(v => ({ date: v.date, value: v.value, actual: true })).concat(est.filter(e => !actualVals.some(v => v.date === e.date)).map(e => ({ date: e.date, value: e.valueEur, actual: false })))
      .sort((a, b) => a.date.localeCompare(b.date));
    const flows = perf.flows;
    if (!vals.length) return '<p class="muted">Nog geen waarderingen.</p>';
    const start = perf.start, end = vals[vals.length - 1].date;
    const span = Math.max(1, C.daysBetween(start, end));
    let cum = 0;
    const steps = [{ date: start, value: 0 }];
    for (const f of flows.filter(f => f.date <= end)) { cum += f.amount; steps.push({ date: f.date, value: cum, flow: f.amount }); }
    const maxV = Math.max(1, ...vals.map(v => v.value), ...steps.map(d => d.value));
    // Op een smal scherm (iPhone) een smallere tekening, zodat de tekst leesbaar blijft
    const narrow = window.innerWidth < 700;
    const W = narrow ? 400 : 760, H = narrow ? 260 : 300, L = narrow ? 58 : 70, R = narrow ? 64 : 96, T = 16, B = 30;
    const x = d => L + (C.daysBetween(start, d) / span) * (W - L - R);
    const top = maxV * 1.08;
    const y = v => T + (1 - Math.max(0, v) / top) * (H - T - B);
    const valuePath = [{ date: start, value: 0 }].concat(vals).map((v, i) => (i ? 'L' : 'M') + x(v.date).toFixed(1) + ' ' + y(v.value).toFixed(1)).join(' ');
    let stepPath = '';
    steps.forEach((d, i) => {
      const px = x(d.date).toFixed(1);
      stepPath += i ? ` L${px} ${y(steps[i - 1].value).toFixed(1)} L${px} ${y(d.value).toFixed(1)}` : `M${px} ${y(d.value).toFixed(1)}`;
    });
    stepPath += ` L${x(end).toFixed(1)} ${y(cum).toFixed(1)}`;
    // Rasterlijnen op mooie stappen
    const raw = top / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const stepV = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
    const ticks = [];
    for (let v = 0; v <= top; v += stepV) ticks.push(v);
    const years = [];
    for (let yr = Number(start.slice(0, 4)) + 1; yr <= Number(end.slice(0, 4)); yr++) years.push(yr + '-01-01');
    const lastVal = vals[vals.length - 1];
    chartData = { start, span, W, vals, flows: flows.filter(f => f.date <= end), x0: L, x1: W - R };
    const compact = v => Math.abs(v) >= 100000000 ? '€ ' + (v / 100000000).toFixed(1).replace('.', ',') + ' mln' : Math.abs(v) >= 1000000 || (narrow && Math.abs(v) >= 100000) ? '€ ' + (Math.round(v / 10000) / 10).toString().replace('.', ',') + 'k' : money(v);
    const yLast = y(lastVal.value), yCum = y(cum);
    const apart = Math.abs(yLast - yCum) < 16;
    return `
      <div class="legend"><span><i class="sw line s1"></i>Waarde portefeuille</span>
        <span><i class="sw line s2"></i>Totale inleg (netto stortingen)</span>
        <span><i class="sw dot s2"></i>Bijstorting</span><span><i class="sw dot hollow"></i>Opname</span><span><i class="sw dot s1"></i>Werkelijke stand</span></div>
      <div class="chart-wrap" id="invest-chart">
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Waarde van je portefeuille en je totale inleg door de tijd">
          ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`).join('')}
          ${years.map(d => `<line x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${H - B}" class="grid-line"/><text x="${x(d)}" y="${H - 10}" text-anchor="middle">${d.slice(0, 4)}</text>`).join('')}
          <path d="${stepPath}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round"/>
          <path d="${valuePath}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round"/>
          ${steps.slice(1).map(d => `<circle cx="${x(d.date)}" cy="${y(d.value)}" r="4" class="${d.flow > 0 ? 'dep' : 'wd'}"><title>${fmtDate(d.date)}: ${d.flow > 0 ? 'storting' : 'opname'} ${money(Math.abs(d.flow))}</title></circle>`).join('')}
          ${vals.filter(v => v.actual).map(v => `<circle cx="${x(v.date)}" cy="${y(v.value)}" r="3" class="actual"><title>${fmtDate(v.date)}: werkelijke stand ${money(v.value)}</title></circle>`).join('')}
          <text x="${W - R + 8}" y="${(apart && yLast > yCum ? yLast + 10 : yLast) + 4}" class="direct">${compact(lastVal.value)}</text>
          <text x="${W - R + 8}" y="${(apart && yCum >= yLast ? yCum + 10 : yCum) + 4}" class="direct muted-fill">${compact(cum)}${narrow ? '' : ' inleg'}</text>
          <line class="crosshair" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>
        </svg>
        <div class="chart-tip" hidden></div>
      </div>
      <details><summary class="small">Toon als tabel</summary>
        <div class="table-wrap"><table><thead><tr><th>Datum</th><th class="right">Waarde</th><th class="right">Inleg tot dan</th><th class="right">Winst</th></tr></thead>
        <tbody>${vals.map(v => { const inl = inlegOn(v.date); return `<tr><td>${fmtDate(v.date)}${v.actual ? '' : ' <span class="muted small">(geschat)</span>'}</td><td class="amount">${money(v.value)}</td><td class="amount">${money(inl)}</td><td class="amount">${money(v.value - inl)}</td></tr>`; }).join('')}</tbody></table></div>
      </details>`;
  }
  function inlegOn(date) { return (chartData ? chartData.flows : []).filter(f => f.date <= date).reduce((s, f) => s + f.amount, 0); }

  function onChartMove(ev) {
    const wrap = $('#invest-chart');
    if (!wrap || !chartData) return;
    const svg = $('svg', wrap);
    const rect = svg.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) / rect.width * chartData.W;
    if (sx < chartData.x0 - 10 || sx > chartData.x1 + 10) return;
    const dayOff = Math.round(Math.min(1, Math.max(0, (sx - chartData.x0) / (chartData.x1 - chartData.x0))) * chartData.span);
    const date = C.addDays(chartData.start, dayOff);
    let best = chartData.vals[0];
    for (const v of chartData.vals) if (Math.abs(C.daysBetween(v.date, date)) < Math.abs(C.daysBetween(best.date, date))) best = v;
    const inl = inlegOn(best.date);
    const near = chartData.flows.filter(f => Math.abs(C.daysBetween(f.date, date)) <= Math.max(3, chartData.span / 120));
    const bx = chartData.x0 + C.daysBetween(chartData.start, best.date) / chartData.span * (chartData.x1 - chartData.x0);
    const line = $('.crosshair', svg);
    line.setAttribute('x1', bx); line.setAttribute('x2', bx); line.style.display = '';
    const tip = $('.chart-tip', wrap);
    tip.hidden = false;
    tip.innerHTML = `<strong>${fmtDate(best.date)}</strong>${best.actual ? '' : ' <span class="muted">(gereconstrueerd)</span>'}<br>Waarde: ${money(best.value)}<br>Inleg: ${money(inl)}<br>Winst: ${money(best.value - inl)}${near.length ? '<hr>' + near.map(f => (f.amount > 0 ? 'Storting ' : 'Opname ') + money(Math.abs(f.amount)) + ' · ' + fmtDate(f.date)).join('<br>') : ''}`;
    const left = (bx / chartData.W) * rect.width;
    tip.style.left = Math.min(rect.width - 200, Math.max(0, left + 12)) + 'px';
  }
  function onChartLeave() {
    const wrap = $('#invest-chart');
    if (!wrap) return;
    $('.chart-tip', wrap).hidden = true;
    $('.crosshair', wrap).style.display = 'none';
  }
  function afterRender() {
    for (const d of $$('.donut')) {
      d.addEventListener('mouseover', onDonutHover);
      d.addEventListener('mouseleave', () => onDonutHover({ target: d }));
      d.addEventListener('click', onDonutHover);
    }
    const nw = $('#nw-chart');
    if (nw) {
      nw.addEventListener('mousemove', onNwMove);
      nw.addEventListener('mouseleave', () => { $('.chart-tip', nw).hidden = true; $('.crosshair', nw).style.display = 'none'; });
      nw.addEventListener('touchmove', e => { if (e.touches[0]) onNwMove(e.touches[0]); }, { passive: true });
      nw.addEventListener('touchstart', e => { if (e.touches[0]) onNwMove(e.touches[0]); }, { passive: true });
    }
    maybeFetchPrices();
    const wrap = $('#invest-chart');
    if (wrap) {
      wrap.addEventListener('mousemove', onChartMove);
      wrap.addEventListener('mouseleave', onChartLeave);
      wrap.addEventListener('touchmove', e => { if (e.touches[0]) onChartMove(e.touches[0]); }, { passive: true });
      wrap.addEventListener('touchstart', e => { if (e.touches[0]) onChartMove(e.touches[0]); }, { passive: true });
    }
  }

  /** Haalt historische koersen op via de server als die ontbreken of ouder zijn dan 3 dagen. */
  let pricesBusy = false;
  async function maybeFetchPrices(force) {
    const data = inv();
    if (!data || demo || pricesBusy || !(Sync && Sync.mode === 'server')) return;
    const fetchedAt = data.market && data.market.fetchedAt;
    if (!force && fetchedAt && Date.now() - Date.parse(fetchedAt) < 3 * 86400000) return;
    if (!force && data.market && data.market.failedAt && Date.now() - Date.parse(data.market.failedAt) < 86400000) return;
    const keys = {};
    for (const t of data.trades || []) { const k = t.isin || t.name; if (!keys[k] || t.date < keys[k].from) keys[k] = { key: k, isin: t.isin, name: t.name, currency: t.currency, from: t.date }; }
    for (const p of data.positions || []) { const k = p.isin || p.key || p.name; if (!keys[k]) keys[k] = { key: k, isin: p.isin, name: p.name, currency: p.currency, from: data.positionsDate || today }; }
    const instruments = Object.values(keys);
    if (!instruments.length) return;
    pricesBusy = true;
    try {
      const r = await Sync.prices(instruments);
      const okCount = Object.keys(r.series || {}).length;
      state.investments = Object.assign({}, state.investments, { market: okCount ? { series: r.series, errors: r.errors, fetchedAt: new Date().toISOString() } : Object.assign({}, data.market || {}, { failedAt: new Date().toISOString(), errors: r.errors }) });
      commit(force ? (okCount ? `Koersen opgehaald voor ${okCount} product(en)` : 'Geen koersen gevonden') : undefined);
    } catch (e) {
      if (force) toast('Koersen ophalen lukte niet: ' + e.message);
    } finally { pricesBusy = false; }
  }


  // ----- Fysiek goud en zilver -----

  const metalPrice = () => (state.settings && state.settings.metalPrice) || null;
  const metals = () => C.metalsSummary(state, metalPrice());
  const grams = g => (Math.round(g * 100) / 100).toLocaleString('nl-BE', { maximumFractionDigits: 2 }) + ' g';
  const countFmt = n => String(Math.round(n * 100) / 100).replace('.', ',');
  let metalAutoFetched = false;

  /** Goud- en zilverprijs ophalen (via de server; één keer per sessie vanzelf als ze ouder is dan 12 uur). */
  function fetchMetalPrice(silent) {
    if (!(Sync && Sync.mode === 'server' && !demo)) { if (!silent) openModal({ type: 'metalPrice' }); return; }
    Sync.metals().then(p => {
      state.settings = Object.assign({}, state.settings, { metalPrice: { gold: p.gold, silver: p.silver, at: p.at || new Date().toISOString(), source: p.source || 'online' } });
      commit(silent ? undefined : 'Goudprijs bijgewerkt: ' + money(Math.round(p.gold)) + ' per gram');
    }).catch(e => { if (!silent) toast(e.message); });
  }

  function maybeAutoFetchMetals() {
    const p = metalPrice();
    if (metalAutoFetched || !(state.metals || []).length || (p && p.source === 'manual')) return;
    if (p && p.at && Date.now() - Date.parse(p.at) < 12 * 3600000) return;
    metalAutoFetched = true;
    fetchMetalPrice(true);
  }

  function metalsCard() {
    const s = metals();
    const p = metalPrice();
    const priceLine = p && p.gold
      ? `Goud ${money(Math.round(p.gold))}/g · zilver ${money(Math.round(p.silver || 0))}/g <span class="muted">· ${p.source === 'manual' ? 'zelf ingevuld' : 'koers van ' + fmtDateTime(p.at)}</span>`
      : '<span class="warn-text">Nog geen goudprijs</span>';
    const row = x => {
      const facts = [x.year, x.mint, COIN_GRADES[x.grade] ? COIN_GRADES[x.grade].split(' — ')[0] : ''].filter(Boolean).map(esc).join(' · ');
      return `<tr class="clickable" data-action="metal-edit" data-id="${esc(x.id)}">
        <td><strong>${x.estimated ? '≈ ' : ''}${esc(x.name || 'Munt')}</strong>${facts ? ` <span class="small">${facts}</span>` : ''}
          <div class="small muted">${x.gift ? '🎁 cadeau' : '🛒 gekocht' + (x.buyDate ? ' ' + fmtDate(x.buyDate) : '')}${x.estimated ? ' · schatting' : ''}${x.note ? ' · ' + esc(x.note) : ''}</div></td>
        <td class="right">${x.estimated ? '≈ ' : ''}${countFmt(x.count)}</td>
        <td class="right">${grams(x.fineTotal)}<div class="small muted">${x.metal === 'silver' ? 'zilver' : 'goud'}</div></td>
        <td class="amount">${x.unitValue != null ? money(x.unitValue) : '—'}
          ${x.market ? `<div class="small muted" title="Je eigen waardering (verzamelwaarde) gaat voor op de prijs per gram">✎ ${x.market.date ? fmtDate(x.market.date) : 'eigen waarde'}${x.market.source ? ' · ' + esc(x.market.source) : ''}</div>` : ''}
          ${x.premium != null ? `<div class="small ${x.premium >= 0 ? 'pos' : 'negv'}" title="Verschil met de waarde van het goud zelf (${money(x.metalUnit)})">${x.premium >= 0 ? '+' : ''}${x.metalUnit ? Math.round(x.premium / x.metalUnit * 100) : 0}% t.o.v. goud</div>` : ''}</td>
        <td class="amount"><strong>${x.value != null ? money(x.value) : '—'}</strong></td>
        <td class="amount">${x.gift ? '<span class="small muted">geen inleg</span>' : x.cost != null ? money(x.cost) + (x.gain != null ? `<div class="small ${x.gain >= 0 ? 'pos' : 'negv'}">${x.gain >= 0 ? '+' : ''}${money(x.gain)}</div>` : '') : '—'}</td>
      </tr>`;
    };
    return `<div class="card metals-card" style="margin-bottom:16px">
      <div class="metals-head">
        <div><h2>🪙 Goud en zilver <span class="muted small">(fysiek)</span></h2>
          <div class="small">${priceLine} · <a href="#" data-action="metal-price-fetch">${Sync && Sync.mode === 'server' && !demo ? 'nu ophalen' : 'prijs invullen'}</a>${Sync && Sync.mode === 'server' && !demo ? ' · <a href="#" data-action="metal-price-manual">zelf invullen</a>' : ''}</div></div>
        <span class="spacer"></span>
        <button class="btn primary" data-action="metal-new">+ Munt of baar</button>
      </div>
      ${s.items.length ? `
      <div class="metals-kpis">
        <div><div class="label">Waarde</div><div class="value">${money(s.value)}</div><div class="small muted">${grams(s.goldGrams)} fijn goud${s.silverGrams ? ' · ' + grams(s.silverGrams) + ' zilver' : ''}</div></div>
        ${s.cost ? `<div><div class="label">Gekocht</div><div class="value">${money(s.boughtValue)}</div><div class="small muted">ingelegd ${money(s.cost)}${s.gain != null ? ` · <span class="${s.gain >= 0 ? 'pos' : 'negv'}">${s.gain >= 0 ? '+' : ''}${money(s.gain)}</span>` : ''}</div></div>` : ''}
        ${s.premium ? `<div><div class="label">Verzamelwaarde</div><div class="value ${s.premium >= 0 ? 'pos' : 'negv'}">${s.premium >= 0 ? '+' : ''}${money(s.premium)}</div><div class="small muted">boven de waarde van het goud zelf</div></div>` : ''}
        ${s.giftValue ? `<div><div class="label">Cadeaus</div><div class="value">${money(s.giftValue)}</div><div class="small muted">telt als vermogen, niet als inleg of uitgave</div></div>` : ''}
      </div>
      ${s.missing ? `<div class="notice small">Voor ${s.missing} lijn${s.missing === 1 ? '' : 'en'} is er nog geen waarde: ${p && p.gold ? 'vul het gewicht en de zuiverheid in' : 'haal de goudprijs op of vul hem zelf in'}, of geef een eigen verkoopwaarde.</div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Wat</th><th class="right">Aantal</th><th class="right">Fijn metaal</th><th class="right">Per stuk</th><th class="right">Waarde</th><th class="right">Aankoop</th></tr></thead>
        <tbody>${s.items.map(row).join('')}</tbody></table></div>
      <p class="small muted">Waarde = gram fijn metaal × prijs per gram. Is een munt meer waard door haar jaar, zeldzaamheid of staat, geef ze dan een eigen waardering (bv. van een veiling, catalogus of handelaar): die gaat voor, en Helder houdt de geschiedenis bij.</p>`
      : `<p class="muted">Heb je gouden of zilveren munten of baren thuis (gekocht of gekregen)? Voeg ze toe: Helder rekent hun waarde uit met de actuele goudprijs en telt ze mee in je vermogen.</p>`}
    </div>`;
  }

  const COIN_GRADES = {
    '': '—', ZG: 'ZG — zeer goed (sterk gesleten)', F: 'F — fraai', ZF: 'ZF — zeer fraai', PR: 'PR — prachtig',
    FDC: 'FDC / UNC — ongecirculeerd', PP: 'PP — proof (spiegelglans)'
  };

  function metalModal() {
    const m = modal;
    const x = m.edit;
    const groups = Array.from(new Set(C.METAL_PRESETS.map(p => p.group)));
    const fine = (x.weight || 0) * (x.purity || 0) / 1000;
    const pr = metalPrice();
    const perGram = pr ? (x.metal === 'silver' ? pr.silver : pr.gold) : 0;
    const metalUnit = fine && perGram ? Math.round(fine * perGram) : null;
    const vals = (x.valuations || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    return modalShell(m.isNew ? 'Munt of baar toevoegen' : 'Bewerken', `
      <div class="form-grid">
        <label class="field full"><span>Soort</span><select id="mt-preset">
          <option value="">— Kies een munt of baar (vult gewicht en zuiverheid in) —</option>
          ${groups.map(g => `<optgroup label="${esc(g)}">${C.METAL_PRESETS.filter(p => p.group === g).map(p => `<option value="${esc(p.id)}" ${x.preset === p.id ? 'selected' : ''}>${esc(p.name)} · ${String(Math.round(p.weight * 100) / 100).replace('.', ',')} g</option>`).join('')}</optgroup>`).join('')}
          <option value="other" ${x.preset === 'other' ? 'selected' : ''}>Iets anders (zelf invullen)…</option></select></label>
        <label class="field full"><span>Naam</span><input type="text" id="mt-name" maxlength="60" value="${esc(x.name || '')}" placeholder="bv. 20 frank Leopold II"></label>
        <label class="field"><span>Aantal</span><input type="text" id="mt-count" inputmode="decimal" value="${esc(x.count != null ? countFmt(x.count) : '1')}"></label>
        <label class="field"><span>Metaal</span><select id="mt-metal"><option value="gold" ${x.metal !== 'silver' ? 'selected' : ''}>Goud</option><option value="silver" ${x.metal === 'silver' ? 'selected' : ''}>Zilver</option></select></label>
        <label class="field"><span>Gewicht per stuk (gram)</span><input type="text" id="mt-weight" inputmode="decimal" value="${esc(x.weight != null ? String(Math.round(x.weight * 1000) / 1000).replace('.', ',') : '')}"></label>
        <label class="field"><span>Zuiverheid (‰)</span><input type="text" id="mt-purity" inputmode="decimal" value="${esc(x.purity != null ? String(x.purity).replace('.', ',') : '')}" placeholder="bv. 900 of 999,9"></label>
        <label class="field"><span>Jaar <span class="muted small">(optioneel)</span></span><input type="text" id="mt-year" maxlength="12" value="${esc(x.year || '')}" placeholder="bv. 1870"></label>
        <label class="field"><span>Staat <span class="muted small">(optioneel)</span></span><select id="mt-grade">${Object.entries(COIN_GRADES).map(([k, v]) => `<option value="${k}" ${(x.grade || '') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field full"><span>Land, vorst of muntteken <span class="muted small">(optioneel)</span></span><input type="text" id="mt-mint" maxlength="60" value="${esc(x.mint || '')}" placeholder="bv. België, Leopold II, Brussel"></label>
        <label class="check full"><input type="checkbox" id="mt-est" ${x.estimated ? 'checked' : ''}> Dit is een schatting <span class="muted small">(bv. de extra munten samen als één Krugerrand-equivalent)</span></label>
        <div class="field full"><span>Hoe kreeg je het?</span>
          <div class="seg"><button type="button" class="${x.origin !== 'gift' ? 'active' : ''}" data-action="metal-origin" data-v="bought">🛒 Gekocht</button><button type="button" class="${x.origin === 'gift' ? 'active' : ''}" data-action="metal-origin" data-v="gift">🎁 Cadeau gekregen</button></div>
          <span class="small muted">${x.origin === 'gift' ? 'Een cadeau telt als vermogen, maar niet als uitgave of als eigen inleg (dus ook niet in winst of verlies).' : 'Je aankoopprijs is je inleg; Helder toont dan je winst of verlies.'}</span></div>
        ${x.origin !== 'gift' ? `<label class="field"><span>Aankoopprijs (samen)</span><input type="text" id="mt-buy" inputmode="decimal" value="${esc(x.buyPrice ? C.centsToInput(x.buyPrice) : '')}" placeholder="bv. 2450,00"></label>
        <label class="field"><span>Aankoopdatum</span><input type="date" id="mt-date" value="${esc(x.buyDate || '')}" max="${today}"></label>` : ''}
        <div class="field full metal-vals"><span>Waarde van de munt zelf <span class="muted small">(verzamelwaarde per stuk — gaat voor op de goudprijs)</span></span>
          <div class="small muted">Waarde van het ${x.metal === 'silver' ? 'zilver' : 'goud'} alleen: <strong>${metalUnit != null ? money(metalUnit) : '—'}</strong> per stuk${fine ? ` (${String(Math.round(fine * 100) / 100).replace('.', ',')} g fijn)` : ''}. Is de munt meer waard door het jaar, de zeldzaamheid of de staat? Noteer dan wat ze waard is, telkens met datum en bron.</div>
          ${vals.length ? `<div class="mv-list">${vals.map((v, i) => `<div class="mv-row ${i === 0 ? 'latest' : ''}"><span>${fmtDate(v.date)}</span><strong>${money(v.value)}</strong>${metalUnit ? `<span class="small ${v.value >= metalUnit ? 'pos' : 'negv'}">${v.value >= metalUnit ? '+' : ''}${Math.round((v.value - metalUnit) / metalUnit * 100)}% t.o.v. goud</span>` : '<span></span>'}<span class="small muted grow">${esc(v.source || '')}${i === 0 ? ' · <b>geldt nu</b>' : ''}</span><button type="button" class="btn small ghost" data-action="metal-val-remove" data-id="${esc(v.id)}" aria-label="Verwijderen">✕</button></div>`).join('')}</div>` : ''}
          <div class="mv-add"><input type="date" id="mv-date" value="${today}" max="${today}" aria-label="Datum"><input type="text" id="mv-value" inputmode="decimal" placeholder="Waarde per stuk, bv. 650" aria-label="Waarde per stuk">
            <input type="text" id="mv-source" maxlength="60" placeholder="Bron, bv. veiling, catalogus, handelaar" aria-label="Bron"><button type="button" class="btn small" data-action="metal-val-add">+ Waardering</button></div>
          ${vals.length ? '<span class="small muted">Wil je terug naar de goudprijs? Verwijder dan alle waarderingen.</span>' : ''}</div>
        <label class="field full"><span>Notitie <span class="muted small">(optioneel)</span></span><input type="text" id="mt-note" maxlength="100" value="${esc(x.note || '')}" placeholder="bv. van oma, ligt in de kluis"></label>
      </div>
      <div class="errors" id="mt-errors"></div>`,
      `${m.isNew ? '' : '<button class="btn danger" data-action="metal-delete">Verwijderen</button>'}<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="metal-save">Opslaan</button>`);
  }

  /** Waardering toevoegen of verwijderen in het venster (pas bewaard bij Opslaan). */
  function metalValAdd() {
    readMetalForm();
    const v = C.parseAmount($('#mv-value').value);
    const date = $('#mv-date').value;
    if (isNaN(v) || v <= 0 || !C.parseDate(date)) { $('#mt-errors').textContent = 'Geef een datum en een waarde per stuk.'; return; }
    const x = modal.edit;
    x.valuations = (x.valuations || []).concat([{ id: C.uid('mv'), date, value: Math.abs(v), source: $('#mv-source').value.trim() }]);
    renderModal();
  }
  function metalValRemove(id) {
    readMetalForm();
    modal.edit.valuations = (modal.edit.valuations || []).filter(v => v.id !== id);
    renderModal();
  }

  /** Velden van het venster in modal.edit bewaren (voor we het venster opnieuw tekenen). */
  function readMetalForm() {
    const x = modal.edit;
    const num = id => { const el = $(id); if (!el) return undefined; const v = parseFloat(el.value.replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? v : null; };
    const money_ = id => { const el = $(id); if (!el) return undefined; const v = C.parseAmount(el.value); return el.value.trim() && !isNaN(v) ? Math.abs(v) : null; };
    x.preset = $('#mt-preset').value || x.preset;
    x.name = $('#mt-name').value.trim();
    x.count = num('#mt-count');
    x.metal = $('#mt-metal').value;
    x.weight = num('#mt-weight');
    x.purity = num('#mt-purity');
    x.estimated = $('#mt-est').checked;
    if ($('#mt-buy')) { x.buyPrice = money_('#mt-buy'); x.buyDate = $('#mt-date').value || ''; }
    x.year = $('#mt-year').value.trim();
    x.mint = $('#mt-mint').value.trim();
    x.grade = $('#mt-grade').value;
    x.note = $('#mt-note').value.trim();
    return x;
  }

  function metalPresetChosen(id) {
    const p = C.METAL_PRESETS.find(x => x.id === id);
    const x = readMetalForm();
    x.preset = id;
    if (p) {
      Object.assign(x, { name: p.name, metal: p.metal, weight: p.weight, purity: p.purity, estimated: !!p.estimated });
      if (p.estimated) { x.count = 1; x.origin = x.origin || 'gift'; }
    }
    renderModal();
  }

  function saveMetal() {
    const x = readMetalForm();
    const errors = [];
    if (!x.name) errors.push('Geef een naam.');
    if (!(x.count > 0)) errors.push('Geef een aantal groter dan 0.');
    if (!(x.valuations || []).length && !(x.weight > 0 && x.purity > 0 && x.purity <= 1000)) errors.push('Vul gewicht en zuiverheid in (zuiverheid in ‰, max. 1000), of geef een waardering.');
    if (errors.length) { $('#mt-errors').innerHTML = errors.map(esc).join('<br>'); return; }
    const item = { id: x.id, name: x.name, metal: x.metal === 'silver' ? 'silver' : 'gold', count: x.count, weight: x.weight || 0, purity: x.purity || 0,
      origin: x.origin === 'gift' ? 'gift' : 'bought', estimated: !!x.estimated, note: x.note || '', preset: x.preset || '' };
    if (item.origin === 'bought' && x.buyPrice) item.buyPrice = Math.round(x.buyPrice);
    if (item.origin === 'bought' && x.buyDate) item.buyDate = x.buyDate;
    for (const k of ['year', 'mint', 'grade']) if (x[k]) item[k] = x[k];
    if ((x.valuations || []).length) item.valuations = x.valuations.map(v => ({ id: v.id, date: v.date, value: Math.round(v.value), source: v.source || '' }));
    state.metals = state.metals || [];
    const i = state.metals.findIndex(m => m.id === item.id);
    if (i >= 0) state.metals[i] = Object.assign(item, { createdAt: state.metals[i].createdAt });
    else state.metals.push(Object.assign(item, { createdAt: new Date().toISOString() }));
    closeModal();
    commit(i >= 0 ? 'Bewaard' : 'Toegevoegd');
    maybeAutoFetchMetals();
  }

  function metalPriceModal() {
    const p = metalPrice() || {};
    const v = c => c ? (c / 100).toFixed(2).replace('.', ',') : '';
    return modalShell('Goud- en zilverprijs', `
      <p class="small muted">Prijs per gram <strong>fijn</strong> metaal, in euro. Je vindt de actuele prijs bij elke munthandelaar of op een site met goudkoersen.${Sync && Sync.mode === 'server' && !demo ? ' Of laat Helder hem ophalen.' : ''}</p>
      <div class="form-grid">
        <label class="field"><span>Goud (€ per gram)</span><input type="text" id="mp-gold" inputmode="decimal" value="${esc(v(p.gold))}" placeholder="bv. 118,50"></label>
        <label class="field"><span>Zilver (€ per gram)</span><input type="text" id="mp-silver" inputmode="decimal" value="${esc(v(p.silver))}" placeholder="bv. 1,35"></label>
      </div>
      <div class="errors" id="mp-errors"></div>`,
      `${Sync && Sync.mode === 'server' && !demo ? '<button class="btn" data-action="metal-price-online">Online ophalen</button>' : ''}<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="metal-price-save">Opslaan</button>`);
  }

  function saveMetalPrice() {
    const g = C.parseAmount($('#mp-gold').value), s = C.parseAmount($('#mp-silver').value || '0');
    if (isNaN(g) || g <= 0) { $('#mp-errors').textContent = 'Geef een goudprijs per gram.'; return; }
    state.settings = Object.assign({}, state.settings, { metalPrice: { gold: g, silver: isNaN(s) ? 0 : Math.max(0, s), at: new Date().toISOString(), source: 'manual' } });
    closeModal();
    commit('Goudprijs bewaard');
  }
  // ----- Instellingen -----

  // Eigen Anthropic API-sleutel: de sleutel zelf staat enkel op de server
  const aiKeyUi = { status: null, error: '', busy: false };
  async function loadAiKey() {
    if (!(Sync && Sync.mode === 'server') || demo) return;
    try { aiKeyUi.status = await Sync.aiKey.status(); aiKeyUi.error = ''; } catch (e) { aiKeyUi.error = e.message; }
    if (ui.view === 'settings' && !modal) render();
  }

  function aiKeyBlock() {
    if (!(Sync && Sync.mode === 'server') || demo || ui.admin) return '';
    const k = aiKeyUi.status;
    if (!k) { if (!aiKeyUi.error) setTimeout(loadAiKey, 0); return `<div class="section ai-key"><h3>AI (Claude)</h3><p class="small muted">${esc(aiKeyUi.error || 'Laden…')}</p></div>`; }
    if (k.set) return `<div class="section ai-key"><h3>AI (Claude) met je eigen sleutel</h3>
      <p class="small">✓ Je eigen API-sleutel (eindigt op <code>${esc(k.hint || '')}</code>) is ingesteld. De kosten lopen via je eigen Anthropic-account.</p>
      <button class="btn small danger" data-action="ai-key-remove">Sleutel verwijderen</button></div>`;
    return `<div class="section ai-key"><h3>AI (Claude)</h3>
      <p class="small muted">${k.server ? 'AI werkt nu met de sleutel van deze Helder. Je kan ook je eigen sleutel gebruiken.' : 'Wil je dat Claude je tegenpartijen indeelt? Gebruik je eigen API-sleutel van Anthropic: je betaalt dan zelf het (kleine) gebruik.'}</p>
      <details${k.server ? '' : ' open'}><summary class="small"><strong>Hoe kom ik aan een sleutel?</strong></summary>
        <ol class="steps small">
          <li>Ga naar <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> en maak een account.</li>
          <li>Zet bij <strong>Billing</strong> wat tegoed op je account (bv. € 5; dat is genoeg voor heel wat transacties).</li>
          <li>Ga naar <strong>API Keys</strong> → <strong>Create Key</strong>, geef ze de naam <em>Helder</em> en kopieer de sleutel (begint met <code>sk-ant-</code>).</li>
          <li>Plak ze hieronder en klik op <strong>Opslaan</strong>.</li>
        </ol></details>
      <form data-form="ai-key" class="input-row" autocomplete="off" style="margin-top:8px">
        <input type="password" name="apiKey" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" required>
        <button class="btn primary" type="submit" ${aiKeyUi.busy ? 'disabled' : ''}>${aiKeyUi.busy ? 'Controleren…' : 'Opslaan'}</button>
      </form>
      ${aiKeyUi.error ? `<div class="errors">${esc(aiKeyUi.error)}</div>` : ''}
      <p class="small muted">De sleutel wordt enkel op de Helder-server bewaard en nooit terug naar je toestellen gestuurd. Een limiet instellen kan in de Anthropic Console (Limits).</p></div>`;
  }

  async function aiKeySubmit(form) {
    aiKeyUi.busy = true; aiKeyUi.error = ''; render();
    try {
      await Sync.aiKey.save(String(new FormData(form).get('apiKey') || '').trim());
      await Sync.refreshFeatures();
      aiKeyUi.status = await Sync.aiKey.status();
      toast('Je eigen API-sleutel is ingesteld. AI-classificatie staat aan.');
    } catch (e) { aiKeyUi.error = e.message; }
    aiKeyUi.busy = false; render();
  }

  function renderSettings() {
    const sy = ui.sync;
    const st = state.settings;
    const aiOn = !!(Sync && Sync.features && Sync.features.ai);
    const catCount = {};
    for (const t of state.transactions) for (const l of C.splitLines(t)) if (l.categoryId) catCount[l.categoryId] = (catCount[l.categoryId] || 0) + 1;
    const catKind = c => c.kind === 'income' ? 'inkomstenbron' : isIncomeCost(c) ? 'kost op ' + catName(c.incomeId) : c.kind === 'advance' ? 'systeem: voorschotten' : c.kind === 'investment' ? 'systeem: beleggingen' : 'uitgaven';
    const order = c => c.kind === 'income' ? 0 : isIncomeCost(c) ? 1 : c.kind === 'expense' ? 2 : 3;
    const manual = state.transactions.filter(t => t.source !== 'import').length;
    const tabs = [
      ['accounts', '🏦', 'Rekeningen', 'Je rekeningen en vanaf welke datum Helder transacties bijhoudt.'],
      ['categories', '🏷️', 'Categorieën', 'Waarin je uitgaven en inkomsten worden ingedeeld.'],
      ['auto', '✨', 'Automatisch indelen', 'Hoe Helder onbekende tegenpartijen herkent. De regels zelf staan bij Bank.'],
      ['account', '👤', 'Account', 'Aanmelden, synchroniseren tussen je toestellen en je account.'],
      ['data', '💾', 'Gegevens & back-up', 'Wat er in Helder zit, back-ups, exporteren, de voorbeeldmodus en alles wissen.']
    ];
    const tab = tabs.some(t => t[0] === ui.settingsTab) ? ui.settingsTab : 'accounts';
    const cur = tabs.find(t => t[0] === tab);
    const sections = {
      accounts: () => `
        <div class="card">
          <h2>Rekeningen</h2>
          <div class="list">${state.accounts.map(a => `<div class="list-row"><div class="grow"><strong>${esc(a.name)}</strong><div class="small muted">${a.iban ? esc(C.formatIban(a.iban)) : 'geen IBAN'} · ${state.transactions.filter(t => t.accountId === a.id).length} transacties</div></div>
            <button class="btn small" data-action="edit-account" data-id="${esc(a.id)}">Bewerk</button><button class="btn small danger" data-action="delete-account" data-id="${esc(a.id)}" aria-label="Verwijder">✕</button></div>`).join('')}</div>
          <p class="btn-row"><button class="btn" data-action="new-account">+ Rekening</button></p>
          <p class="small muted">Bankrekeningen worden automatisch aangemaakt bij de eerste import (IBAN uit het bestand). Overschrijvingen tussen je eigen rekeningen tellen nooit als inkomen of uitgave.</p>
        </div>
        ${dataFromRow()}`,
      categories: () => `
        <div class="card">
          <h2>Categorieën</h2>
          <div class="list scroll">${state.categories.slice().sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map(c => `<div class="list-row">
            <span class="badge"><span class="dot" style="background:${esc(c.color)}"></span>${esc(C.categoryIcon(c) + ' ' + c.name)}</span>
            <span class="grow small muted">${esc(catKind(c))} · ${catCount[c.id] || 0}</span>
            ${c.id.startsWith('sys_') ? '' : `<button class="btn small" data-action="edit-category" data-id="${esc(c.id)}">Bewerk</button><button class="btn small danger" data-action="delete-category" data-id="${esc(c.id)}" aria-label="Verwijder">✕</button>`}</div>`).join('')}</div>
          <p class="btn-row"><button class="btn" data-action="new-category">+ Uitgavencategorie</button><button class="btn" data-action="new-category" data-kind="income">+ Inkomstenbron</button></p>
        </div>
`,
      auto: () => `
        <div class="card">
          <h2>Online opzoeken</h2>
          <p class="small muted">Onbekende tegenpartijen worden online opgezocht (Wikidata, OpenStreetMap${aiOn ? ', AI' : ''}) en via de zoekwoorden van je categorieën gekoppeld. Jij keurt elk voorstel goed.</p>
          <div class="form-grid">
            <label class="field"><span>Bron</span><select data-setting="lookupProvider">
              <option value="auto" ${st.lookupProvider === 'auto' ? 'selected' : ''}>Automatisch</option>
              <option value="free" ${st.lookupProvider === 'free' ? 'selected' : ''}>Wikidata + OpenStreetMap</option>
              <option value="ai" ${st.lookupProvider === 'ai' ? 'selected' : ''} ${aiOn ? '' : 'disabled'}>AI (Claude)${aiOn ? '' : ' — niet ingesteld'}</option></select></label>
            <label class="field"><span>Landen</span><input type="text" data-setting="lookupCountries" value="${esc(st.lookupCountries || 'be')}"></label>
            <label class="field full"><span>Herkenning beleggingsrekening (naam of mededeling, regex)</span><input type="text" data-setting="investPattern" value="${esc(st.investPattern || 'degiro|flatex|saxo')}"></label>
          </div>
          ${aiKeyBlock()}
        </div>
        <div class="card">
          <h2>Automatische regels</h2>
          <p class="small muted">Regels koppelen nieuwe transacties vanzelf aan een categorie of persoon. Je vindt ze op het tabblad <strong>Bank</strong>, onder de transacties.</p>
          <p class="btn-row"><button class="btn" data-action="goto-rules">Naar de regels</button></p>
        </div>`,
      account: () => `
        <div class="card">
          <h2>Account & synchronisatie</h2>
          ${sy.mode === 'local' ? `<p class="small muted">Helder draait nu <strong>lokaal</strong>: je gegevens staan enkel in deze browser. Om Helder op al je toestellen (ook je iPhone) te gebruiken, host je de Helder-server — zie README → <em>Hosten</em>.</p>`
          : `<p>Aangemeld als <strong>${esc((Sync.account && Sync.account.displayName) || sy.user || '')}</strong>${Sync.account && Sync.account.email ? ` <span class="small muted">(${esc(Sync.account.email)}, via Google)</span>` : ''}</p>
            <p class="small muted">${sy.lastSync ? 'Laatst gesynchroniseerd: ' + esc(new Date(sy.lastSync).toLocaleString('nl-BE')) : 'Nog niet gesynchroniseerd'}${sy.pending ? ' · ' + sy.pending + ' wijziging(en) wachten' : ''}</p>
            <p class="btn-row"><button class="btn" data-action="sync-now">Nu synchroniseren</button>${Sync.account && Sync.account.email ? '' : '<button class="btn" data-action="change-password">Wachtwoord wijzigen</button>'}
              <button class="btn" data-action="logout">Afmelden</button><button class="btn danger" data-action="logout-all">Overal afmelden</button></p>
            ${Sync.account && !Sync.account.email && Sync.auth && Sync.auth.google ? `<div class="section google-link">
              <h3>Aanmelden met Google</h3>
              ${Sync.account.googleLinked
                ? `<p class="small">✓ Gekoppeld met <strong>${esc(Sync.account.googleLinked)}</strong>. Je kan aanmelden met Google of met je gebruikersnaam en wachtwoord; je komt altijd in hetzelfde account.</p>
                   <button class="btn small" data-action="google-unlink">Loskoppelen van Google</button>`
                : `<p class="small muted">Koppel je account aan je Google-account. Daarna kan je ook aanmelden met één klik op <em>Aanmelden met Google</em>. Je gegevens, gebruikersnaam en wachtwoord blijven gewoon zoals ze zijn.</p>
                   <a class="btn google-btn small" href="/api/auth/google?link=1">${GOOGLE_ICON}Koppelen met Google</a>`}
            </div>` : ''}
            ${householdBlock()}
            <p class="small muted">iPhone: open Helder in Safari → deelknop → <em>Zet op beginscherm</em>.</p>
            ${Sync.account && Sync.account.role === 'member' ? `<details class="danger-zone"><summary class="small">Account verwijderen</summary>
              <p class="small">Je account en al je gegevens worden meteen en definitief gewist, ook de back-ups op de server. Download eerst een back-up als je je gegevens wil houden.</p>
              <p class="btn-row"><button class="btn small" data-action="export-json">Back-up downloaden</button><button class="btn small danger" data-action="delete-account">Mijn account verwijderen</button></p></details>` : ''}`}
          <p class="small muted" style="margin-top:12px"><a href="privacy.html" target="_blank" rel="noopener">Privacyverklaring</a> · <a href="voorwaarden.html" target="_blank" rel="noopener">Gebruiksvoorwaarden</a></p>
        </div>
`,
      data: () => `
        <div class="card">
          <h2>Gegevens</h2>
          <p class="btn-row"><button class="btn" data-action="export-json">Back-up downloaden</button><button class="btn" data-action="import-json">Back-up terugzetten</button><button class="btn" data-action="export-csv">Transacties exporteren (CSV)</button></p>
          <p class="btn-row">${demo ? '<button class="btn" data-action="exit-demo">Voorbeeldmodus afsluiten</button>' : '<button class="btn" data-action="enter-demo">Voorbeeldmodus openen</button>'}
            <button class="btn danger" data-action="reset">${demo ? 'Voorbeeld wissen' : 'Alles wissen' + (sy.mode !== 'local' ? ' (alle toestellen)' : '')}</button></p>
          <p class="small muted">De voorbeeldmodus is een aparte zandbak met verzonnen gegevens; je eigen gegevens worden er nooit door aangeraakt.</p>
        </div>
        <div class="card">
          <h2>Wat zit er in Helder?</h2>
          <div class="list">
            ${(state.imports || []).map(i => `<div class="list-row"><div class="grow">📄 ${esc(i.fileName)}<div class="small muted">${esc(accName(i.accountId))} · ${esc(fmtDateTime(i.importedAt))}</div></div><span>${state.transactions.filter(t => t.importId === i.id).length}</span></div>`).join('')}
            <div class="list-row"><div class="grow">✎ Manueel ingevoerd</div><span>${manual}</span></div>
            ${Invest.brokers(inv()).map(b => `<div class="list-row"><div class="grow">📈 ${esc(b.name)}</div><span class="small">${b.id === 'degiro' ? (inv().files || []).length + ' bestand(en)' : ''}${b.source === 'degiro-api' || b.source === 'saxo-api' ? ' · rechtstreeks' : ''}</span></div>`).join('')}
            <div class="list-row total"><div class="grow"><strong>Totaal transacties</strong></div><span>${state.transactions.length}</span></div>
          </div>
          <p class="small muted">Bestanden bekijken of ongedaan maken doe je in het tabblad Bank.</p>
        </div>
`
    };
    return `
      <div class="page-head"><h1>Instellingen</h1></div>
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Instellingen">${tabs.map(([id, icon, label]) => `<button class="${id === tab ? 'active' : ''}" data-action="settings-tab" data-tab="${id}"><span aria-hidden="true">${icon}</span> ${label}</button>`).join('')}</nav>
        <div class="settings-body">
          <div class="settings-intro"><h2>${cur[1]} ${cur[2]}</h2><p class="muted">${cur[3]}</p></div>
          <div class="settings-cards">${sections[tab]()}</div>
        </div>
      </div>`;
  }

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
    const fns = { refundPick: refundPickModal, watch: watchModal, metal: metalModal, metalPrice: metalPriceModal, taxYear: taxYearModal, search: searchModal, whatIs: whatIsModal, action: actionModal, actionPick: actionPickModal, actionView: m => modalShell('Actie', actionCard(actionById(m.id) || { id: '', name: '?' }, true), '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>', true), advLedger: advLedgerModal, surplus: surplusModal, catTx: catTxModal, advTitle: advTitleModal, forgive: forgiveModal, saxoSetup: saxoSetupModal, tx: txModal, rule: ruleModal, budget: budgetModal, account: accountModal, category: categoryModal, import: importModal, lookup: lookupModal, password: passwordModal, degiro: degiroModal, degiroFiles: degiroFilesModal, importView: importViewModal, bankSetup: bankSetupModal, bankConnect: bankConnectModal, person: personModal, advPick: advPickModal };
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
    const splitRows = (t.splits || []).map(s => splitRow(Object.assign({}, s, { opposite: Math.sign(s.amount) !== Math.sign(t.amount) }), false, t.amount)).join('');
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
        <p class="small muted" style="margin:0 0 8px">Bv. een etentje van € 150: € 50 <em>Restaurant</em> (jouw deel) + 2 × € 50 <em>Voorschot</em> voor je vrienden. Typ een bedrag of een %; het laatste lege vakje krijgt vanzelf de rest. Een minteken telt in de andere richting (bv. afgehouden commissie).</p>
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
          ${(() => { const cur = t.refundOf && !suggestions.some(s => s.tx.id === t.refundOf) ? txById(t.refundOf) : null; return cur ? `<option value="${esc(cur.id)}" selected>${fmtDate(cur.date)} · ${esc(cur.title || cur.counterparty || cur.description)} · ${money(cur.amount)}</option>` : ''; })()}
          ${suggestions.map(s => `<option value="${esc(s.tx.id)}" ${t.refundOf === s.tx.id ? 'selected' : ''}>${fmtDate(s.tx.date)} · ${esc(s.tx.title || s.tx.counterparty || s.tx.description)} · ${money(s.tx.amount)}</option>`).join('')}
          <option value="__search__">🔎 Andere uitgave zoeken…</option>
        </select></div>` : ''}

      ${refundedBy.length ? `<div class="section"><h3>Terugbetaald door</h3>${refundedBy.map(r => `<div class="small">${fmtDate(r.date)} · ${esc(r.counterparty || r.description)} · <span class="pos">${money(r.amount)}</span></div>`).join('')}
        ${(() => {
          const ra = C.refundAllocation(state);
          const parts = refundedBy.flatMap(r => ra.get(r.id) || []);
          const toAdv = parts.filter(p => p.advance).reduce((s, p) => s + p.amount, 0);
          const advTotal = C.splitLines(t).filter(l => l.categoryId === C.SYS_ADVANCE && l.amount < 0).reduce((s, l) => s - l.amount, 0);
          const own = C.splitLines(t).filter(l => l.categoryId !== C.SYS_ADVANCE).reduce((s, l) => s + l.amount, 0) + parts.filter(p => !p.advance).reduce((s, p) => s + p.amount, 0);
          return advTotal
            ? `<div class="small">Jouw deel: <strong>${money(own)}</strong> · voorschot ${money(advTotal)}: ${money(toAdv)} terug${advTotal - toAdv > 0 ? `, <span class="warn-text">nog ${money(advTotal - toAdv)} open</span>` : ' ✓'}</div>
               <div class="small muted">Terugbetalingen gaan eerst naar het voorschot; wat daarboven komt, maakt jouw deel kleiner.</div>`
            : `<div class="small">Netto kost: <strong>${money(t.amount + refundedBy.reduce((s, r) => s + r.amount, 0))}</strong></div>`;
        })()}</div>` : ''}

      <div class="field"><span>Acties <span class="muted small">(iets wat je nog moet doen, bv. “Retour binnenbrengen”)</span></span>
        <div class="tx-actions">${(t.actions || []).map(id => actionById(id)).filter(Boolean).map(a => `<span class="badge action-badge ${a.closed ? 'done' : ''}">${a.closed ? '✓' : '☐'} ${esc(a.name)} <button type="button" class="chip-x" data-action="tx-action-remove" data-id="${esc(a.id)}" aria-label="Uit actie halen">✕</button></span>`).join('')}
          <select id="tx-action-add" aria-label="Aan een actie toevoegen"><option value="">+ Actie toevoegen…</option>${(state.actions || []).filter(a => !a.closed && !(t.actions || []).includes(a.id)).map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}<option value="__new__">+ Nieuwe actie…</option></select></div></div>
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

  function splitRow(s, auto, txTotal) {
    s = s || {};
    const total = txTotal != null ? Math.abs(txTotal) : Math.abs(C.parseAmount(($('#tx-amount') || {}).value || '') || 0);
    const pctVal = s.amount && total ? Math.round(Math.abs(s.amount) / total * 1000) / 10 : null;
    return `<div class="split-row" ${auto ? 'data-auto="1"' : ''}>
      <select class="split-cat">${categoryOptions(s.categoryId, { emptyLabel: '— Categorie —', special: true })}</select>
      <input type="text" inputmode="decimal" class="split-amount" placeholder="€ 0,00" aria-label="Bedrag" value="${s.amount ? esc((s.opposite ? '-' : '') + C.centsToInput(s.amount)) : ''}">
      <span class="split-pct-wrap"><input type="text" inputmode="decimal" class="split-pct" placeholder="%" aria-label="Percent van het totaal" value="${pctVal != null ? String(pctVal).replace('.', ',') : ''}"><span class="small muted">%</span></span>
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

  /**
   * Bij typen in een splitsing: % ↔ bedrag omrekenen, en de rest automatisch invullen in het enige
   * andere vakje dat nog leeg is (of dat Helder zelf invulde). Bv. € 20, je typt 15 → het andere wordt 5.
   */
  function onSplitInput(el) {
    const row = el.closest('.split-row');
    if (!row) return;
    const total = Math.abs(C.parseAmount($('#tx-amount').value));
    if (!total) return;
    const fmtPct = v => String(Math.round(v * 10) / 10).replace('.', ',');
    if (el.classList.contains('split-pct')) {
      const p = parseFloat(el.value.replace(',', '.'));
      $('.split-amount', row).value = isFinite(p) ? C.centsToInput(Math.round(total * p / 100)) : '';
    } else if (el.classList.contains('split-amount')) {
      const a = C.parseAmount(el.value);
      $('.split-pct', row).value = !isNaN(a) && el.value.trim() ? fmtPct(Math.abs(a) / total * 100) : '';
    } else return;
    row.removeAttribute('data-auto');
    const rows = $$('#splits .split-row');
    const open = rows.filter(r => r !== row && (r.dataset.auto === '1' || !$('.split-amount', r).value.trim()));
    if (open.length !== 1) return;
    const target = open[0];
    const others = rows.filter(r => r !== target).reduce((s, r) => { const v = C.parseAmount($('.split-amount', r).value); return s + (isNaN(v) ? 0 : v); }, 0);
    const rest = total - others;
    $('.split-amount', target).value = rest > 0 ? C.centsToInput(rest) : '';
    $('.split-pct', target).value = rest > 0 ? fmtPct(rest / total * 100) : '';
    target.dataset.auto = '1';
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
    const refundOf = $('#tx-refund') && $('#tx-refund').value !== '__search__' ? $('#tx-refund').value || null : t.refundOf || null;
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
    delete t.splitByRule; // zelf bewaard: de regel past de splitsing niet meer aan
    const title = $('#tx-title').value.trim();
    if (title) t.title = title; else delete t.title;
    if (newCat === C.SYS_ADVANCE) { t.person = person || (linked ? linked.person : ''); ensurePerson(t.person, t.amount > 0 ? t.counterpartyIban : ''); } else delete t.person;
    delete t.personByRule;
    for (const sp of t.splits || []) if (sp.person) ensurePerson(sp.person);
    if (advanceOf) t.advanceOf = advanceOf; else delete t.advanceOf;
    if (newCat !== t.categoryId || splits.length || t.categorySource !== 'manual') {
      // Leeg gemaakt = bewust "te verwerken": 'manual' zodat een regel het niet meteen opnieuw invult.
      t.categorySource = newCat || splits.length || t.categoryId || t.categorySource === 'manual' ? 'manual' : null;
      t.categoryId = newCat;
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

  /**
   * Terug naar "te verwerken". De bron blijft 'manual', anders vult een regel of de beleggingsherkenning
   * de categorie bij de volgende herberekening meteen terug in.
   */
  function resetToTodo(t) {
    t.categoryId = null; t.categorySource = 'manual'; t.ruleId = null;
    if (t.splitByRule) { t.splits = []; delete t.splitByRule; }
    delete t.person; delete t.personByRule; delete t.advanceOf;
    if (t.refundOf) t.refundOf = null;
    if (t.isTransfer || t.transferMode === 'yes') t.transferMode = 'no';
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
    if (value === 'refund') { render(); openModal({ type: 'refundPick', txId: t.id, search: '' }); return; }
    if (value === 'split' || value === 'cat:' + C.SYS_ADVANCE) {
      const copy = JSON.parse(JSON.stringify(t));
      if (value === 'cat:' + C.SYS_ADVANCE) { copy.categoryId = C.SYS_ADVANCE; if (copy.isTransfer) copy.transferMode = 'no'; }
      render(); // keuzelijst terugzetten tot er bewaard wordt
      openModal({ type: 'tx', tx: copy });
      if (value === 'split' && !copy.splits.length) actions['add-split']();
      if (value === 'cat:' + C.SYS_ADVANCE) { const p = $('#tx-person'); if (p) p.focus(); }
      return;
    }
    ui.ruleHint = null;
    if (value === 'whatis' || value.startsWith('whatis:')) { render(); openModal({ type: 'whatIs', txId: t.id, choice: value.slice(7) || null }); return; }
    if (value.startsWith('refund:')) { linkRefunds([t], value.slice(7)); return; }
    if (value.startsWith('adv:')) {
      markAdvance(t, value.slice(4));
      commit((t.amount > 0 ? 'Terugbetaling van ' : 'Voorschot voor ') + value.slice(4));
      return;
    }
    if (value === 'transfer') { t.transferMode = 'yes'; t.categoryId = null; t.categorySource = null; }
    else if (value === '') { resetToTodo(t); commit('Teruggezet naar te verwerken'); return; }
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

  // ----- Bankimport -----

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        if (String(r.result).includes('�')) {
          const r2 = new FileReader();
          r2.onload = () => resolve(r2.result);
          r2.onerror = reject;
          r2.readAsText(file, 'windows-1252');
        } else resolve(r.result);
      };
      r.onerror = reject;
      r.readAsText(file, 'utf-8');
    });
  }

  function importModal() {
    const m = modal;
    if (!m.parts) {
      return modalShell('Bankbestand opladen', `
        <p>Kies de CSV-export van je bank. <strong>KBC/CBC</strong> en <strong>Argenta</strong> worden automatisch herkend, inclusief de rekening (IBAN).</p>
        <details class="small"><summary>Hoe exporteer ik dit?</summary>
          <p><strong>KBC/CBC</strong>: KBC Touch op de computer → <em>Rekeningen</em> → kies je rekening → <em>Verrichtingen</em> → kies de periode → <em>Exporteren</em> → <strong>CSV</strong>.</p>
          <p><strong>Argenta</strong>: internetbankieren → <em>Rekeningen</em> → je rekening → <em>Verrichtingen</em> → <em>Downloaden</em> → <strong>CSV</strong>.</p>
          <p class="muted">Overlappende periodes zijn geen probleem: transacties die al in Helder zitten worden overgeslagen.</p></details>
        <label class="field"><span>Bestand</span><input type="file" id="imp-file" accept=".csv,.txt,text/csv"></label>
        <div class="errors" id="imp-errors"></div>`, '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>');
    }
    const blocked = m.parts.every(p => p.plan.sameFile);
    const body = `
      <p class="small muted">📄 <strong>${esc(m.fileName)}</strong> · ${m.parsed.profile ? 'herkend als <strong>' + esc(m.parsed.profile.name) + '</strong>' : '<strong>onbekend formaat</strong> — duid de kolommen aan'} · ${m.parsed.rowCount} rijen${m.parsed.errors.length ? ` · ${m.parsed.errors.length} ongeldige rij(en) (rij ${m.parsed.errors.slice(0, 5).join(', ')}${m.parsed.errors.length > 5 ? '…' : ''})` : ''}</p>
      ${!m.parsed.profile ? mappingFields() : ''}
      <div class="data-from-row"><label class="field"><span>📅 Transacties vanaf <span class="muted small">(voor al je banken)</span></span><input type="date" id="imp-from" value="${esc(state.settings.dataFrom || '')}" max="${today}"></label>
        <p class="small muted">Kies dezelfde startdatum voor elke bank, dan lopen je rekeningen gelijk en zitten oudere transacties van één bank niet tussen de rest. Leeg = alles.</p></div>
      ${m.parts.map((p, i) => {
        const a = p.accountId ? acc(p.accountId) : null;
        const sf = p.plan.sameFile;
        const isNewAcc = !p.accountId && (p.accountIban || p.wantNew);
        return `<div class="section">
          <h3>${p.accountIban ? 'Rekening ' + esc(C.formatIban(p.accountIban)) : 'Rekening'}</h3>
          ${sf ? `<div class="notice danger">⛔ Dit bestand werd al opgeladen op ${esc(fmtDateTime(sf.importedAt))} (“${esc(sf.fileName)}”). Er wordt niets toegevoegd.</div>` : ''}
          <div class="form-grid">
            ${isNewAcc ? `<label class="field"><span>Nieuwe rekening — naam</span><input type="text" data-part-name="${i}" value="${esc(p.newName)}"></label>
              <label class="field"><span>Soort</span><select data-part-type="${i}">${[['zicht', 'Zichtrekening'], ['spaar', 'Spaarrekening'], ['andere', 'Andere']].map(([v, l]) => `<option value="${v}" ${p.newType === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
              : `<label class="field full"><span>Rekening in Helder${a && p.accountIban ? ' (herkend op IBAN)' : ''}</span><select data-part-account="${i}" ${a && p.accountIban ? 'disabled' : ''}><option value="">— Kies —</option>${accountOptions(p.accountId, x => x.type !== 'cash')}<option value="__new__">+ Nieuwe rekening…</option></select></label>`}
          </div>
          <div class="import-summary">
            <div><strong>${p.plan.fresh.length}</strong><span>nieuw</span></div>
            <div><strong>${p.plan.duplicates.length}</strong><span>zat er al in</span></div>
            <div><strong>${p.parsed.period ? fmtDate(p.parsed.period.from) + ' – ' + fmtDate(p.parsed.period.to) : '—'}</strong><span>periode</span></div>
            <div><strong>${p.parsed.balance ? money(p.parsed.balance.amount) : '—'}</strong><span>${p.parsed.balance ? 'saldo op ' + fmtDate(p.parsed.balance.date) : 'geen saldo in bestand'}</span></div>
          </div>
          ${p.plan.tooOld && p.plan.tooOld.length ? `<p class="small muted">${p.plan.tooOld.length} transacties van vóór ${fmtDate(state.settings.dataFrom)} worden overgeslagen (startdatum).</p>` : ''}
          ${p.plan.duplicates.some(d => d.deleted) ? `<p class="small muted">Waarvan ${p.plan.duplicates.filter(d => d.deleted).length} die je eerder verwijderde: die blijven weg.</p>` : ''}
          ${Object.keys(p.plan.fromImports).length ? `<p class="small muted">Al aanwezig uit: ${Object.entries(p.plan.fromImports).map(([id, n]) => `${esc(imp(id) ? imp(id).fileName : '?')} (${n})`).join(', ')}</p>` : ''}
          ${p.plan.fresh.length && !sf ? `<details><summary class="small">Bekijk de ${p.plan.fresh.length} nieuwe transacties</summary><div class="table-wrap"><table><tbody>${p.plan.fresh.slice(0, 50).map(t => `<tr><td class="nowrap">${fmtDate(t.date)}</td><td>${esc(t.counterparty)}<div class="desc">${esc(t.description)}</div></td><td class="amount ${amountClass(t.amount)}">${money(t.amount)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
        </div>`;
      }).join('')}
      <div class="errors" id="imp-errors"></div>`;
    const total = m.parts.filter(p => !p.plan.sameFile).reduce((s, p) => s + p.plan.fresh.length, 0);
    const foot = `<button class="btn" data-action="import-restart">Ander bestand</button><span class="spacer"></span><button class="btn" data-action="close-modal">${blocked ? 'Sluiten' : 'Annuleren'}</button>
      ${blocked ? '' : `<button class="btn primary" data-action="do-import" ${total ? '' : 'disabled'}>${total ? total + ' transacties toevoegen' : 'Niets nieuws'}</button>`}`;
    return modalShell('Bankbestand opladen', body, foot, true);
  }

  function mappingFields() {
    const headers = modal.parsed.headers;
    const map = modal.mapping || {};
    const opts = sel => '<option value="">—</option>' + headers.map((h, i) => `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(h || 'Kolom ' + (i + 1))}</option>`).join('');
    return `<div class="section"><h3>Kolommen</h3><div class="form-grid">${[['date', 'Datum *'], ['amount', 'Bedrag'], ['debit', 'Debet'], ['credit', 'Credit'], ['counterparty', 'Tegenpartij'], ['counterpartyIban', 'IBAN tegenpartij'], ['description', 'Mededeling']]
      .map(([k, l]) => `<label class="field"><span>${l}</span><select data-map="${k}">${opts(map[k])}</select></label>`).join('')}</div></div>`;
  }

  /** (Her)berekent per rekening in het bestand wat nieuw is en wat er al in zit. */
  function planImport() {
    const m = modal;
    if (!m.parsed.profile && !m.mapping) m.mapping = Object.assign({}, m.parsed.mapping || {});
    const parsed = m.parsed.profile ? m.parsed : Banks.parse(m.text, { mapping: m.mapping, headerRow: m.parsed.headerRow });
    const prevParts = m.parts || [];
    const bank = m.parsed.profile ? m.parsed.profile.name.split(' ')[0] : 'Bank';
    m.parts = Banks.splitByAccount(parsed).map((p, i) => {
      const prev = prevParts[i] || {};
      const existing = p.accountIban ? state.accounts.find(a => C.normalizeIban(a.iban) === p.accountIban) : null;
      const accountId = existing ? existing.id : prev.accountId !== undefined ? prev.accountId : (p.accountIban ? null : (m.accountHint || null));
      const part = { parsed: p, accountIban: p.accountIban, accountId, wantNew: prev.wantNew, newName: prev.newName || `${bank} ${p.accountIban ? '…' + p.accountIban.slice(-4) : 'rekening'}`, newType: prev.newType || 'zicht' };
      part.plan = Banks.plan(state, p, accountId || '__nieuw__', m.text, m.fileName);
      return part;
    });
  }

  async function loadImportFile(file) {
    try {
      const text = await readFile(file);
      const parsed = Banks.parse(text);
      if (!parsed.rowCount) { $('#imp-errors').textContent = 'Dit bestand bevat geen leesbare rijen.'; return; }
      Object.assign(modal, { text, fileName: file.name, parsed, mapping: null, parts: null });
      planImport();
      renderModal();
    } catch (e) { $('#imp-errors').textContent = 'Kon het bestand niet lezen: ' + e.message; }
  }

  function doImport() {
    const m = modal;
    const errs = [];
    m.parts.forEach((p, i) => {
      if (p.plan.sameFile) return;
      const nameEl = $(`[data-part-name="${i}"]`);
      if (!p.accountId && !nameEl) errs.push('Kies voor elke rekening in het bestand waar de transacties bij horen.');
      if (nameEl && !nameEl.value.trim()) errs.push('Geef de nieuwe rekening een naam.');
    });
    if (errs.length) { $('#imp-errors').innerHTML = Array.from(new Set(errs)).join('<br>'); return; }
    let added = 0, skipped = 0;
    m.parts.forEach((p, i) => {
      if (p.plan.sameFile) return;
      let accountId = p.accountId;
      if (!accountId) {
        accountId = C.uid('acc');
        const acct = { id: accountId, name: $(`[data-part-name="${i}"]`).value.trim(), iban: p.accountIban || '', type: $(`[data-part-type="${i}"]`).value };
        if (m.parsed.profile) acct.bank = m.parsed.profile.id;
        state.accounts.push(acct);
      }
      const planned = Banks.plan(state, p.parsed, accountId, m.text, m.fileName);
      if (planned.sameFile) return;
      Banks.apply(state, planned, p.parsed, accountId);
      added += planned.fresh.length; skipped += planned.duplicates.length;
    });
    closeModal();
    ui.bank = Object.assign(ui.bank, { status: 'todo', account: '' });
    go('bank', true);
    commit(`${added} transacties toegevoegd${skipped ? `, ${skipped} overgeslagen (zaten er al in)` : ''}`);
    const cands = C.lookupCandidates(state);
    if (added && cands.length && state.settings.autoLookup !== false && confirm(`${cands.length} tegenpartij(en) zijn nog onbekend. Online opzoeken om ze te koppelen?`)) openLookup(cands);
  }

  function importViewModal() {
    const i = imp(modal.id);
    if (!i) return modalShell('Import', '<p>Niet gevonden.</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
    const txs = state.transactions.filter(t => t.importId === i.id).sort((a, b) => b.date.localeCompare(a.date));
    return modalShell('📄 ' + i.fileName, `
      <p class="small muted">${esc(i.bankName || '')} · ${esc(accName(i.accountId))} · ${i.period ? fmtDate(i.period.from) + ' – ' + fmtDate(i.period.to) : ''} · opgeladen ${esc(fmtDateTime(i.importedAt))}<br>
        ${txs.length} transacties toegevoegd · ${i.duplicates || 0} overgeslagen omdat ze er al in zaten${i.errors ? ' · ' + i.errors + ' ongeldige rijen' : ''}</p>
      <div class="table-wrap"><table><tbody>${txs.map(t => `<tr><td class="nowrap">${fmtDate(t.date)}</td><td>${esc(t.counterparty)}<div class="desc">${esc(t.description)}</div></td><td class="amount ${amountClass(t.amount)}">${money(t.amount)}</td><td>${kindBadge(kindOf(t))}</td></tr>`).join('')}</tbody></table></div>`,
      `<button class="btn danger" data-action="undo-import" data-id="${esc(i.id)}">Deze import ongedaan maken</button><span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>`, true);
  }

  // ----- Saxo Bank -----

  const saxoLink = { status: null, error: '', busy: false };
  function saxoAvailable() { return !!(Sync && Sync.mode === 'server' && !demo && !(Sync.features && Sync.features.saxo === false)); }

  async function loadSaxo(opts) {
    if (!saxoAvailable()) return;
    try { saxoLink.status = await Sync.saxo.status(); saxoLink.error = ''; }
    catch (e) { saxoLink.error = e.message; }
    if (ui.view === 'invest' && !modal) render();
    if (opts && opts.auto) {
      const st = saxoLink.status;
      const sub = Invest.brokers(inv()).find(b => b.id === 'saxo');
      const stale = !sub || !sub.syncedAt || Date.now() - Date.parse(sub.syncedAt) > 6 * 3600000;
      if (st && st.connected && !st.expired && (opts.force || stale)) await saxoFetch({ quiet: !opts.force });
    }
  }

  function saxoCard() {
    if (!(Sync && Sync.mode === 'server') || demo) return '';
    if (Sync.features && Sync.features.saxo === false) return '';
    const st = saxoLink.status;
    const sub = Invest.brokers(inv()).find(b => b.id === 'saxo');
    let body;
    if (!st) body = `<p class="small muted">${saxoLink.error ? esc(saxoLink.error) : 'Laden…'}</p>`;
    else if (!st.configured) body = `<p class="small muted">Haal je posities, transacties, dividenden en stortingen rechtstreeks op uit Saxo. Je meldt je aan op de website van Saxo zelf; Helder ziet je wachtwoord nooit en kan geen orders plaatsen.</p>
        <button class="btn primary" data-action="saxo-setup">Saxo-koppeling instellen…</button>`;
    else body = `<p class="small muted">${st.connected && !st.expired ? '✓ Aangemeld bij Saxo' : st.connected ? 'Je Saxo-aanmelding is verlopen (Saxo laat dat maar kort toe). Klik op Vernieuwen en meld je opnieuw aan.' : 'Nog niet aangemeld bij Saxo.'}${st.env === 'sim' ? ' · <strong>simulatie-omgeving</strong>' : ''}${sub ? ' · laatst opgehaald ' + esc(fmtDateTime(sub.syncedAt)) : ''}</p>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn primary" data-action="saxo-fetch" ${saxoLink.busy ? 'disabled' : ''}>${saxoLink.busy ? 'Bezig met ophalen…' : sub ? 'Vernieuwen' : 'Ophalen uit Saxo'}</button>
          ${st.connected ? '<button class="btn" data-action="saxo-disconnect">Loskoppelen</button>' : ''}
          <button class="btn" data-action="saxo-setup">Instelling</button>
        </div>`;
    return `<div class="card" style="margin-top:16px"><h2>Saxo Bank</h2>${body}</div>`;
  }

  function saxoSetupModal() {
    const m = modal;
    const st = saxoLink.status || {};
    const redirect = st.redirectUrl || (location.origin + '/api/saxo/callback');
    return modalShell('Saxo-koppeling instellen', `
      ${st.configured ? `<div class="notice info small">✓ Ingesteld (${st.env === 'sim' ? 'simulatie' : 'echte rekening'}). Vul opnieuw in om te wijzigen.</div>` : ''}
      <p>Helder gebruikt de officiële <strong>Saxo OpenAPI</strong>. Je stelt dit één keer in:</p>
      <div class="notice small">Let op: de ontwikkelaarssite van Saxo werkt <strong>eerst met een apart, gratis test-account</strong> (simulatie), niet met je gewone Saxo-login. Met je gewone login zie je daar meestal niets.</div>
      <ol class="steps">
        <li><strong>Gratis test-account maken:</strong> ga naar <a href="https://www.developer.saxo/accounts/sim/signup" target="_blank" rel="noopener">developer.saxo → simulatie-account aanmaken</a>. Je krijgt per e-mail een <strong>gebruikersnummer</strong> en wachtwoord.</li>
        <li>Meld je met <strong>dat gebruikersnummer</strong> aan op <a href="https://www.developer.saxo" target="_blank" rel="noopener">developer.saxo</a> en open <strong>Application management</strong> (of <em>Apps</em>). Maak een nieuwe app:
          <ul><li>Naam: <em>Helder</em></li>
            <li>Redirect URL: <code>${esc(redirect)}</code> <button class="btn small" data-action="copy" data-copy="${esc(redirect)}">Kopieer</button></li>
            <li>Grant type: <strong>Code</strong> (Authorization Code)</li>
            <li>Trading toelaten: <strong>nee</strong> — Helder leest enkel.</li></ul></li>
        <li>Kopieer de <strong>App Key</strong> en <strong>App Secret</strong>, kies hieronder <strong>Simulatie</strong> en sla op. Test met <em>Ophalen uit Saxo</em> (je meldt je dan aan met je test-account; je ziet verzonnen gegevens).</li>
        <li><strong>Voor je echte rekening:</strong> pas als je een simulatie-app hebt, kan je op dezelfde site een <strong>live</strong>-app aanvragen voor persoonlijk gebruik (je echte rekening moet geld bevatten). Saxo keurt dat meestal automatisch goed. Maak de live-app met dezelfde gegevens, vul hier de nieuwe App Key en Secret in en kies <strong>Echte rekening</strong>.</li>
      </ol>
      <p class="small muted">Lukt de live-aanvraag niet (dat kan per land of per Saxo-dochter verschillen, bv. een rekening bij Saxo Bank België via SaxoInvestor), vraag het dan aan <a href="mailto:openapisupport@saxobank.com">openapisupport@saxobank.com</a>: “Ik wil als particuliere klant een OpenAPI-app voor persoonlijk gebruik op mijn eigen rekening.”</p>
      <form data-form="saxo-setup" class="form-stack" autocomplete="off">
        <label class="field"><span>Omgeving</span><select name="env">
          <option value="sim" ${m.env !== 'live' ? 'selected' : ''}>Simulatie (test-account, om te testen)</option>
          <option value="live" ${m.env === 'live' ? 'selected' : ''}>Echte rekening (live)</option></select></label>
        <label class="field"><span>App Key</span><input type="text" name="appKey" autocapitalize="none" spellcheck="false" required></label>
        <label class="field"><span>App Secret</span><input type="password" name="appSecret" autocomplete="off" required></label>
        <div class="errors">${esc(m.error || '')}</div>
        <button class="btn primary" type="submit" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Opslaan…' : 'Opslaan'}</button>
      </form>
      <p class="small muted">App Key en Secret worden enkel op je Helder-server bewaard (map helder-data, niet via het web bereikbaar) en nooit naar je toestellen gestuurd. Je Saxo-wachtwoord gaat nooit via Helder.</p>`,
      `${st.configured ? '<button class="btn danger" data-action="saxo-remove-config">Instelling verwijderen</button>' : ''}<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>`, true);
  }

  async function saxoSetupSubmit(form) {
    const f = new FormData(form);
    const m = modal;
    m.env = String(f.get('env'));
    m.busy = true; m.error = '';
    renderModal();
    try {
      await Sync.saxo.saveConfig(String(f.get('appKey') || '').trim(), String(f.get('appSecret') || '').trim(), m.env);
      await loadSaxo();
      closeModal();
      toast('Saxo-koppeling ingesteld. Klik op “Ophalen uit Saxo” en meld je aan bij Saxo.');
      render();
    } catch (e) {
      if (modal !== m) return;
      m.busy = false; m.error = e.message; renderModal();
    }
  }

  /** Naar de aanmeldpagina van Saxo; daarna komt je terug in Helder en wordt alles opgehaald. */
  async function saxoLogin() {
    try { const r = await Sync.saxo.connect(); location.href = r.url; }
    catch (e) { toast('Saxo: ' + e.message); }
  }

  async function saxoFetch(opts) {
    if (saxoLink.busy) return;
    const st = saxoLink.status;
    if (st && (!st.connected || st.expired)) { if (!(opts && opts.quiet)) await saxoLogin(); return; }
    saxoLink.busy = true;
    if (ui.view === 'invest' && !modal) render();
    try {
      const data = await Sync.saxo.fetch();
      state.investments = Invest.mergeInvestments(state.investments, data, 'saxo-api', today);
      commit(`Saxo opgehaald: ${data.positions.length} posities, ${data.trades.length} transacties, ${data.movements.length} kasbewegingen`
        + (data.currency && data.currency !== 'EUR' ? ` (bedragen in ${data.currency})` : '')
        + (data.partial ? ' — kasbewegingen konden niet opgehaald worden' : ''));
    } catch (e) {
      if (e.code === 'expired') { await loadSaxo(); if (!(opts && opts.quiet)) await saxoLogin(); }
      else if (!(opts && opts.quiet)) toast('Saxo: ' + e.message);
    } finally {
      saxoLink.busy = false;
      if (ui.view === 'invest' && !modal) render();
    }
  }

  // ----- Degiro -----

  function degiroModal() {
    const m = modal;
    return modalShell('Ophalen uit Degiro', `
      <p class="small muted">Je gegevens gaan via je eigen Helder-server rechtstreeks naar Degiro. <strong>Wachtwoord en code worden niet bewaard.</strong></p>
      <form data-form="degiro" class="form-stack" autocomplete="off">
        <label class="field"><span>Degiro-gebruikersnaam</span><input type="text" name="username" autocapitalize="none" value="${esc(m.username || '')}" required></label>
        <label class="field"><span>Wachtwoord</span><input type="password" name="password" autocomplete="off" required></label>
        <label class="field"><span>2FA-code (6 cijfers uit je authenticator-app${m.needOtp ? '' : ', als je 2FA gebruikt'})</span><input type="text" name="otp" inputmode="numeric" maxlength="8" ${m.needOtp ? 'required' : ''}></label>
        <div class="errors">${esc(m.error || '')}</div>
        <button class="btn primary" type="submit" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Bezig met ophalen…' : 'Ophalen'}</button>
      </form>
      <p class="small muted">Lukt het niet? Degiro wijzigt soms zijn website. De exportbestanden werken altijd.</p>`, '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
  }

  async function degiroSubmit(form) {
    const f = new FormData(form);
    const m = modal;
    m.username = String(f.get('username')).trim();
    m.busy = true; m.error = '';
    renderModal();
    try {
      const data = await Sync.degiro(m.username, String(f.get('password')), String(f.get('otp') || '').trim());
      state.investments = Invest.mergeInvestments(state.investments, data, 'degiro-api', today);
      closeModal();
      commit(`Degiro opgehaald: ${data.positions.length} posities, ${data.trades.length} transacties, ${data.movements.length} kasbewegingen`);
    } catch (e) {
      if (modal !== m) return;
      m.busy = false;
      m.needOtp = e.code === 'otp';
      m.error = e.message;
      renderModal();
    }
  }

  function degiroFilesModal() {
    const m = modal;
    return modalShell('Degiro-exportbestanden opladen', `
      <label class="field"><span>Bestanden (je mag er meerdere tegelijk kiezen)</span><input type="file" id="dg-files" accept=".csv,text/csv" multiple></label>
      ${m.files && m.files.length ? `<div class="table-wrap"><table><thead><tr><th>Bestand</th><th>Herkend als</th><th>Stand op datum</th><th></th></tr></thead><tbody>${m.files.map((f, i) => `<tr>
        <td>📄 ${esc(f.name)}</td>
        <td>${f.type ? `<strong>${esc({ portfolio: 'Portefeuille', transactions: 'Transacties', account: 'Rekeningoverzicht' }[f.type])}</strong>` : '<span style="color:var(--red)">niet herkend</span>'}</td>
        <td>${f.type === 'portfolio' ? `<input type="date" data-dg-date="${i}" value="${esc(f.date || today)}" max="${today}">` : '<span class="muted small">—</span>'}</td>
        <td class="small">${f.duplicate ? '<span class="badge over">al opgeladen</span>' : f.type ? esc(f.info) : ''}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">Geef bij elke portefeuille-export de datum op waarvan de stand is (bv. 31/12/2024). Exports van een vroegere datum gelden enkel als waarderingspunt voor rendement en grafiek.</p>` : ''}
      <details><summary class="small"><strong>Wat moet ik exact exporteren?</strong></summary>${DEGIRO_EXPORT_HELP}</details>
      <div class="errors" id="dg-errors"></div>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="degiro-apply" ${m.files && m.files.some(f => f.type && !f.duplicate) ? '' : 'disabled'}>Toevoegen</button>`, true);
  }

  async function loadDegiroFiles(fileList) {
    const files = [];
    const known = new Set(((inv() && inv().files) || []).map(f => f.hash));
    for (const file of Array.from(fileList)) {
      const text = await readFile(file);
      const type = Invest.detectCsv(text);
      const hash = Banks.hashText(text);
      let info = '';
      if (type === 'portfolio') { const p = Invest.parsePortfolioCsv(text); info = p.positions.length + ' posities · ' + money(p.positions.reduce((s, x) => s + x.valueEur, 0) + p.cashEur); }
      if (type === 'transactions') info = Invest.parseTransactionsCsv(text).length + ' transacties';
      if (type === 'account') info = Invest.parseAccountCsv(text).length + ' kasbewegingen';
      const d = file.name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
      files.push({ name: file.name, text, type, hash, info, duplicate: known.has(hash) || files.some(x => x.hash === hash), date: (d && C.parseDate(d[1] + '-' + d[2] + '-' + d[3])) || today });
    }
    modal.files = files;
    renderModal();
  }

  function applyDegiroFiles() {
    const m = modal;
    let data = state.investments;
    const order = { account: 0, transactions: 1, portfolio: 2 };
    const list = m.files.filter(f => f.type && !f.duplicate).sort((a, b) => order[a.type] - order[b.type] || (a.date || '').localeCompare(b.date || ''));
    const dgDate = () => { const b = Invest.brokers(data).find(x => x.id === 'degiro'); return b ? b.positionsDate : null; };
    for (const f of list) {
      if (f.type === 'portfolio') data = Invest.mergeInvestments(data, Invest.parsePortfolioCsv(f.text), 'degiro-csv', f.date || today);
      if (f.type === 'transactions') data = Invest.mergeInvestments(data, { trades: Invest.parseTransactionsCsv(f.text) }, 'degiro-csv', dgDate());
      if (f.type === 'account') data = Invest.mergeInvestments(data, { movements: Invest.parseAccountCsv(f.text) }, 'degiro-csv', dgDate());
      data.files = (data.files || []).concat([{ name: f.name, hash: f.hash, type: f.type, date: f.type === 'portfolio' ? f.date : null, importedAt: new Date().toISOString() }]);
    }
    state.investments = data;
    closeModal();
    commit(`${list.length} Degiro-bestand(en) toegevoegd`);
  }

  // ----- Online opzoeken -----

  const localNominatimQueue = Lookup ? Lookup.createQueue(1100) : null;
  async function lookupBatch(items) {
    const st = state.settings;
    if (Sync && Sync.mode === 'server') {
      const r = await Sync.lookup({ items: items.map(i => ({ name: i.name, description: i.description, direction: i.direction })), categories: state.categories.filter(c => c.kind === 'income' || c.kind === 'expense').map(c => ({ id: c.id, name: c.name, kind: c.kind })), provider: st.lookupProvider || 'auto', countries: st.lookupCountries || 'be' });
      return r.results;
    }
    if (Sync && Sync.mode === 'offline') throw new Error('Geen verbinding met je Helder-server');
    return Promise.all(items.map(i => Lookup.lookupFree({ name: i.name, description: i.description }, { countries: st.lookupCountries || 'be', nominatimQueue: localNominatimQueue })));
  }
  function suggestionFor(result, direction) {
    if (!result) return null;
    if (result.ai && result.ai.categoryId && cat(result.ai.categoryId)) return { categoryId: result.ai.categoryId, confidence: result.ai.confidence, why: [result.ai.businessType, result.ai.explanation].filter(Boolean).join(' — ') };
    const m = C.matchCategory(result.text, state.categories.filter(c => c.kind === 'income' || c.kind === 'expense'), direction);
    return m ? { categoryId: m.categoryId, confidence: m.confidence, why: 'herkend aan: ' + m.hits.slice(0, 3).join(', ') } : null;
  }
  function hitsHtml(result) {
    if (!result) return '';
    const parts = [];
    if (result.ai) parts.push(`<div><strong>AI:</strong> ${esc(result.ai.businessType)} <span class="muted">${esc(result.ai.explanation || '')}</span></div>`);
    for (const h of result.hits || []) parts.push(`<div><a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">${esc(h.label)}</a> <span class="muted">(${esc(h.source)})</span> — ${esc(h.description)}</div>`);
    return parts.join('') || '<span class="muted">Niets gevonden</span>';
  }
  function openLookup(candidates) {
    openModal({ type: 'lookup', rows: candidates.map(c => ({ cand: c, status: 'pending', result: null, sugg: null, categoryId: '', makeRule: true })), running: true });
    runLookup(modal);
  }
  async function runLookup(m) {
    const chunk = Sync && Sync.mode === 'server' ? 5 : 3;
    for (let i = 0; i < m.rows.length; i += chunk) {
      if (modal !== m) return;
      const part = m.rows.slice(i, i + chunk);
      try {
        const results = await lookupBatch(part.map(r => r.cand));
        part.forEach((r, j) => { r.result = results[j]; r.sugg = suggestionFor(results[j], r.cand.direction); r.status = 'done'; if (r.sugg && !r.touched) r.categoryId = r.sugg.categoryId; });
      } catch (e) {
        part.forEach(r => { r.status = 'error'; });
        m.error = e.message;
        if (/verbinding|offline|Failed to fetch|NetworkError/i.test(e.message)) break;
      }
      if (modal === m) renderModal();
    }
    m.running = false;
    m.rows.forEach(r => { if (r.status === 'pending') r.status = 'error'; });
    if (modal === m) renderModal();
  }
  function lookupModal() {
    const m = modal;
    const done = m.rows.filter(r => r.status !== 'pending').length;
    const conf = { hoog: 'ok', middel: 'warn', laag: 'over' };
    const chosen = m.rows.filter(r => r.categoryId).length;
    return modalShell('Tegenpartijen online opzoeken', `
      <p class="small muted">Kijk de voorstellen na. Met <em>regel</em> aangevinkt worden ook toekomstige transacties van die tegenpartij vanzelf gekoppeld.</p>
      ${m.running ? `<div class="progress"><div class="bar" style="width:${(done / Math.max(1, m.rows.length) * 100).toFixed(0)}%"></div></div><p class="small muted">${done} / ${m.rows.length}…</p>` : ''}
      ${m.error ? `<div class="notice">Opzoeken lukte niet volledig: ${esc(m.error)}</div>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Tegenpartij</th><th>Gevonden</th><th>Koppelen aan</th><th>Regel</th></tr></thead>
        <tbody>${m.rows.map((r, i) => `<tr><td><strong>${esc(r.cand.name)}</strong><div class="small muted">${r.cand.count}× · ${money(r.cand.total)}</div></td>
          <td class="small lookup-hits">${r.status === 'pending' ? '<span class="muted">bezig…</span>' : r.status === 'error' ? '<span class="muted">mislukt</span>' : hitsHtml(r.result)}
            ${r.sugg ? `<div><span class="badge ${conf[r.sugg.confidence] || ''}">zekerheid ${esc(r.sugg.confidence)}</span> <span class="muted">${esc(r.sugg.why)}</span></div>` : ''}</td>
          <td><select data-lookup-cat="${i}">${categoryOptions(r.categoryId, { emptyLabel: '— Overslaan —', kind: r.cand.direction === 'in' ? 'income' : 'expense' })}</select></td>
          <td><input type="checkbox" data-lookup-rule="${i}" ${r.makeRule ? 'checked' : ''} aria-label="Regel maken"></td></tr>`).join('')}</tbody></table></div>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button><button class="btn primary" data-action="lookup-apply" ${chosen ? '' : 'disabled'}>${chosen} toepassen</button>`, true);
  }
  function ruleForCandidate(r) {
    let value = r.cand.key;
    for (const o of [r.result && r.result.query].concat(((r.result && r.result.hits) || []).map(h => h.label))) {
      const q = o ? C.normalizeText(o) : '';
      if (q.length >= 3 && q.length < value.length && (' ' + r.cand.key + ' ').startsWith(' ' + q + ' ')) value = q;
    }
    return { id: C.uid('rule'), name: r.cand.name, field: r.cand.field === 'counterparty' ? 'counterparty' : 'any', operator: 'name', value, categoryId: r.categoryId, direction: r.cand.direction, enabled: true, priority: Math.max(0, ...state.rules.map(x => x.priority || 0)) + 10, origin: 'lookup' };
  }
  function applyLookup() {
    let rules = 0, txs = 0;
    for (const r of modal.rows) {
      if (!r.categoryId) continue;
      if (r.makeRule) { state.rules.push(ruleForCandidate(r)); rules++; }
      else for (const id of r.cand.txIds) { const t = txById(id); if (t && !t.categoryId) { t.categoryId = r.categoryId; t.categorySource = 'manual'; txs++; } }
    }
    closeModal();
    commit(`${rules} regel(s) aangemaakt${txs ? `, ${txs} transactie(s) gekoppeld` : ''}`);
  }
  /** Voorstel op basis van je eigen titel: eerst de zoekwoorden van je categorieën, daarna (optioneel) AI. */
  function updateTitleSuggestion() {
    const el = $('#tx-title-sugg');
    if (!el) return;
    const title = $('#tx-title').value.trim();
    if (!title) { el.innerHTML = ''; return; }
    const direction = C.parseAmount($('#tx-amount').value) > 0 ? 'in' : 'out';
    const m = C.matchCategory(title, state.categories.filter(c => c.kind === 'income' || c.kind === 'expense'), direction);
    const current = $('#tx-category').value;
    const aiOn = Sync && Sync.mode === 'server' && Sync.features && Sync.features.ai;
    el.innerHTML = (m && m.categoryId !== current ? `→ Voorstel uit je titel: <strong>${esc(catLabel(m.categoryId))}</strong> <span class="muted">(${esc(m.hits.slice(0, 2).join(', '))})</span> <button class="btn small" type="button" data-action="apply-sugg" data-id="${esc(m.categoryId)}">Toepassen</button> ` : '')
      + (aiOn ? `<button class="btn small ghost" type="button" data-action="ai-title">🤖 Laat AI de categorie kiezen</button>` : (!m ? '<span class="muted">Geen categorie herkend in je titel. Tip: voeg zoekwoorden toe aan je categorieën (Instellingen).</span>' : ''));
  }

  async function aiFromTitle() {
    const el = $('#tx-title-sugg');
    const item = { title: $('#tx-title').value.trim(), name: $('#tx-counterparty').value.trim(), description: $('#tx-description').value.trim(), direction: C.parseAmount($('#tx-amount').value) > 0 ? 'in' : 'out' };
    el.innerHTML = '<span class="muted">AI denkt na…</span>';
    try {
      const r = await Sync.lookup({ items: [item], categories: state.categories.filter(c => c.kind === 'income' || c.kind === 'expense').map(c => ({ id: c.id, name: c.name, kind: c.kind })), provider: 'ai', countries: state.settings.lookupCountries || 'be' });
      const a = r.results[0] && r.results[0].ai;
      if (a && a.categoryId) {
        $('#tx-category').value = a.categoryId;
        updateSplitRemaining(); updateTxSections();
        el.innerHTML = `🤖 Gekozen: <strong>${esc(catLabel(a.categoryId))}</strong> <span class="muted">— ${esc(a.explanation || a.businessType || '')} (zekerheid ${esc(a.confidence)})</span>`;
      } else el.innerHTML = `<span class="muted">AI vond geen passende categorie${a && a.explanation ? ': ' + esc(a.explanation) : ''}.</span>`;
    } catch (e) { el.innerHTML = `<span style="color:var(--red)">AI lukte niet: ${esc(e.message)}</span>`; }
  }

  async function lookupOne() {
    const el = $('#tx-lookup-result');
    const item = { name: $('#tx-counterparty').value.trim(), description: $('#tx-description').value.trim() };
    if (!item.name && !item.description) { el.textContent = 'Vul eerst een tegenpartij of mededeling in.'; return; }
    item.direction = C.parseAmount($('#tx-amount').value) > 0 ? 'in' : 'out';
    el.innerHTML = '<span class="muted">Bezig met opzoeken…</span>';
    try {
      const [res] = await lookupBatch([item]);
      const sg = suggestionFor(res, item.direction);
      el.innerHTML = `<div class="section lookup-hits">${hitsHtml(res)}${sg ? `<div>→ voorstel: <strong>${esc(catLabel(sg.categoryId))}</strong> <span class="muted">(${esc(sg.why)})</span></div>` : '<div class="muted">Geen passende categorie gevonden.</div>'}</div>`;
      if (sg && !$('#tx-category').value) { $('#tx-category').value = sg.categoryId; updateSplitRemaining(); }
    } catch (e) { el.innerHTML = `<span style="color:var(--red)">Opzoeken mislukt: ${esc(e.message)}</span>`; }
  }

  // ---------- Aanmelden ----------

  function renderSyncBadge() {
    const el = $('#sync-badge');
    if (!el) return;
    const s = ui.sync;
    let text, cls;
    if (ui.admin) { text = '🛡️ Beheerder'; cls = 'ok'; }
    else if (demo) { text = '🧪 Voorbeeld'; cls = 'warn'; }
    else if (s.mode === 'local') { text = 'Lokaal'; cls = 'muted'; }
    else if (s.mode === 'auth') { text = 'Niet aangemeld'; cls = 'warn'; }
    else if (s.status === 'syncing') { text = 'Synchroniseren…'; cls = 'muted'; }
    else if (s.mode === 'offline' || s.status === 'offline') { text = 'Offline' + (s.pending ? ` · ${s.pending} wacht` : ''); cls = 'warn'; }
    else if (s.status === 'error') { text = 'Synchronisatiefout'; cls = 'over'; }
    else { text = s.pending ? `${s.pending} wachten` : '✓ Gesynchroniseerd'; cls = 'ok'; }
    el.className = 'badge sync ' + cls;
    el.textContent = text;
    el.title = s.detail || (s.user ? 'Aangemeld als ' + s.user : '');
    // Afmelden altijd rechtsboven, zodra je aangemeld bent
    const out = $('#topbar-logout');
    if (out) out.hidden = !(ui.admin || (!demo && !ui.auth && s.mode !== 'local' && s.mode !== 'auth'));
  }

  const GOOGLE_ICON = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-16.6z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';

  /**
   * Landingspagina voor wie niet aangemeld is: wat Helder is en doet, met het aanmeldvak er meteen bij.
   * (De eerste installatie met setupcode toont enkel het vak.)
   */
  function renderAuth() {
    const card = renderAuthCard();
    if (ui.auth.setupRequired) return card;
    const g = ui.auth.auth && ui.auth.auth.google;
    const features = [
      ['🏦', 'Al je rekeningen samen', 'Koppel KBC, Argenta, Belfius en andere banken rechtstreeks, of laad hun CSV-bestanden op. Wat al in Helder zit, wordt nooit dubbel geteld.'],
      ['✨', 'Vanzelf ingedeeld', 'Typ een paar letters en druk op Enter. Regels, online opzoeken en (als je wil) AI delen de rest automatisch in.'],
      ['🤝', 'Voorschotten aan vrienden', 'Betaalde je de hele rekening? Zie wie je nog wat schuldig is, koppel terugbetalingen en scheld kwijt wat een cadeau was.'],
      ['📈', 'Beleggingen', 'Degiro en Saxo in één portefeuille, met je echte rendement (TWR en MWR), dividenden en gerealiseerde winst.'],
      ['📊', 'Inkomsten tegenover uitgaven', 'Waar je geld vandaan komt, waar het naartoe gaat en wat er overblijft, per maand en over de jaren.'],
      ['🔒', 'Jouw gegevens blijven van jou', 'Geen reclame, geen verkoop van gegevens. Je bankwachtwoord gaat nooit via Helder en je kan alles downloaden of wissen.']
    ];
    return `<div class="landing">
      <section class="landing-hero">
        <div class="landing-pitch">
          <div class="auth-logo">${LOGO}<span class="wordmark">H€lder</span></div>
          <h1>Je geld, eindelijk <span class="accent">helder</span>.</h1>
          <p class="lead">Een gratis app voor je persoonlijke boekhouding. Al je rekeningen, uitgaven, voorschotten en beleggingen op één plek, zonder spreadsheets.</p>
          <ul class="landing-points">
            <li>✓ Rechtstreeks gekoppeld met je bank, of met CSV-bestanden</li>
            <li>✓ Op je computer en als app op je gsm</li>
            <li>✓ Gemaakt in België, in het Nederlands</li>
          </ul>
          ${g ? '' : '<p class="small muted">Al een account? Meld je aan in het vak hiernaast.</p>'}
        </div>
        <div class="landing-card">${card}</div>
      </section>
      <section class="landing-preview" aria-hidden="true">
        <div class="preview-card">
          <div class="preview-title">Inkomsten tegenover uitgaven <span class="muted">· oktober</span></div>
          <div class="preview-line"><span>Netto inkomsten</span><i class="pv s1" style="width:92%"></i><b>€ 2.480</b></div>
          <div class="preview-line"><span>Uitgaven</span><i class="pv s2" style="width:71%"></i><b>€ 1.915</b></div>
          <div class="preview-result">€ 565 over · 23% van je netto inkomen</div>
          <div class="preview-bars">${[62, 70, 58, 75, 66, 80, 72, 68, 77, 74, 79, 71].map((v, i) => `<span style="height:${v}%"></span><span class="o" style="height:${[48, 52, 50, 55, 47, 60, 51, 49, 58, 53, 56, 52][i]}%"></span>`).join('')}</div>
        </div>
      </section>
      <section class="landing-examples" aria-label="Voorbeelden">
        <h2>Zo ziet het eruit</h2>
        <div class="example-grid">
          <figure class="example">
            <div class="ex-card">
              <div class="ex-tx"><div><strong>COLRUYT GENT</strong><div class="small muted">Bancontact · 12/10</div></div><b>€ -45,20</b></div>
              <div class="ex-input">boo<span class="caret"></span></div>
              <div class="ex-menu"><div class="on">🛒 Boodschappen <span class="small muted">Enter ↵</span></div><div>📚 Boeken &amp; studie</div><div>🎁 Cadeaus</div></div>
            </div>
            <figcaption><strong>Typ en druk op Enter.</strong> Koppelen gaat zo snel als typen, en Helder onthoudt het voor de volgende keer.</figcaption>
          </figure>
          <figure class="example">
            <div class="ex-card">
              <div class="ex-person"><span class="avatar">P</span><strong>Pieter</strong><span class="ex-open">nog € 62,00</span></div>
              <div class="ex-item"><div><strong>Concertticket</strong><div class="small muted">03/10</div></div><b>€ 45,00</b></div>
              <div class="ex-item"><div><strong>Etentje Gent</strong><div class="small muted">09/10</div></div><b>€ 17,00</b></div>
              <div class="ex-buttons"><span>🔗 Met een transactie</span><span>💶 In cash</span><span>🔄 Verrekenen</span></div>
            </div>
            <figcaption><strong>Wie is je nog iets schuldig?</strong> Elk voorschot met een titel, en met één klik afgehandeld.</figcaption>
          </figure>
          <figure class="example">
            <div class="ex-card">
              <div class="ex-donut" style="background:conic-gradient(var(--series-1) 0 38%, var(--series-2) 38% 62%, var(--series-3) 62% 78%, var(--series-4) 78% 90%, var(--border) 90% 100%)"><span>€ 1.915</span></div>
              <ul class="ex-legend"><li><i style="background:var(--series-1)"></i>🏠 Huur &amp; wonen <b>38%</b></li><li><i style="background:var(--series-2)"></i>🛒 Boodschappen <b>24%</b></li><li><i style="background:var(--series-3)"></i>🚗 Vervoer <b>16%</b></li><li><i style="background:var(--series-4)"></i>🍽️ Horeca <b>12%</b></li><li><i style="background:var(--border)"></i>Andere <b>10%</b></li></ul>
            </div>
            <figcaption><strong>Waar gaat je geld naartoe?</strong> Je uitgaven per categorie, per maand of per jaar.</figcaption>
          </figure>
          <figure class="example">
            <div class="ex-card">
              <div class="ex-kpis"><div><div class="small muted">Portefeuille</div><strong>€ 12.480</strong></div><div><div class="small muted">Rendement</div><strong class="pos">+7,2% <span class="small muted">/jaar</span></strong></div></div>
              <svg viewBox="0 0 200 60" class="ex-spark" preserveAspectRatio="none"><polyline points="0,52 20,48 40,50 60,40 80,42 100,33 120,35 140,24 160,27 180,16 200,12" /><polyline class="dep" points="0,54 50,50 100,44 150,40 200,36" /></svg>
              <div class="small muted">Degiro + Saxo · stortingen <span style="color:var(--series-2)">━</span> waarde <span style="color:var(--series-1)">━</span></div>
            </div>
            <figcaption><strong>Je beleggingen erbij.</strong> Degiro en Saxo samen, met je echte rendement en dividenden.</figcaption>
          </figure>
          <figure class="example">
            <div class="ex-card">
              <div class="ex-tx"><div><strong>Takeaway.com</strong><div class="small muted">06/08 · ↩ € 16,00 terug (2×)</div></div><b>€ -8,29</b></div>
              <div class="ex-tx muted-row"><div>COENS VICTOR</div><b class="pos">€ 8,50</b></div>
              <div class="ex-tx muted-row"><div>VAN HOUCKE HELEEN</div><b class="pos">€ 7,50</b></div>
              <div class="ex-buttons"><span>↩ 2 terugbetalingen koppelen</span></div>
            </div>
            <figcaption><strong>Samen besteld, apart betaald?</strong> Koppel terugbetalingen aan de uitgave en zie wat je zelf betaalde.</figcaption>
          </figure>
          <figure class="example">
            <div class="ex-card">
              <div class="ex-bank"><span>🏦</span><div><strong>KBC</strong><div class="small muted">bijgewerkt vandaag 08:12</div></div><span class="ex-ok">✓ gekoppeld</span></div>
              <div class="ex-bank"><span>🏦</span><div><strong>Argenta</strong><div class="small muted">bijgewerkt vandaag 08:12</div></div><span class="ex-ok">✓ gekoppeld</span></div>
              <div class="ex-bank"><span>📄</span><div><strong>Belfius spaarrekening</strong><div class="small muted">CSV opgeladen · 14 transacties</div></div></div>
            </div>
            <figcaption><strong>Alle banken op één plek.</strong> Rechtstreeks gekoppeld of met een bestand, zonder dubbels.</figcaption>
          </figure>
        </div>
      </section>
      <section class="landing-features">
        <h2>Wat Helder voor je doet</h2>
        <div class="feature-grid">${features.map(([i, t, d]) => `<div class="feature"><div class="feature-icon" aria-hidden="true">${i}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>
      </section>
      <section class="landing-steps">
        <h2>In drie stappen</h2>
        <ol>
          <li><strong>Maak een account</strong>${g ? ' met je Google-account, in één klik' : ''}.</li>
          <li><strong>Koppel je bank</strong> of laad je rekeninguittreksels op.</li>
          <li><strong>Koppel je transacties</strong>: Helder onthoudt het en doet het de volgende keer zelf.</li>
        </ol>
        <p><a href="#" class="btn primary" data-action="landing-top">Begin nu, het is gratis</a></p>
      </section>
      <footer class="landing-footer small muted">
        <a href="privacy.html" target="_blank" rel="noopener">Privacyverklaring</a> · <a href="voorwaarden.html" target="_blank" rel="noopener">Gebruiksvoorwaarden</a> · <a href="mailto:privacy@helderfin.be">privacy@helderfin.be</a>
      </footer>
    </div>`;
  }

  function renderAuthCard() {
    const a = ui.auth;
    if (a.setupRequired) {
      return `<div class="auth card"><div class="auth-logo">${LOGO}<span class="wordmark">H€lder</span></div><h1>Account aanmaken</h1>
        <p class="muted">Maak je account aan. ${esc(a.setupHint || 'De setupcode staat in de log van de server.')}</p>
        <form data-form="setup" class="form-stack">
          <label class="field"><span>Setupcode</span><input type="text" name="code" autocomplete="one-time-code" required autocapitalize="characters"></label>
          <label class="field"><span>Gebruikersnaam</span><input type="text" name="username" autocomplete="username" autocapitalize="none" required></label>
          <label class="field"><span>Wachtwoord (min. 8 tekens)</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
          <div class="errors">${esc(a.error || '')}</div><button class="btn primary" type="submit">Account aanmaken</button></form></div>`;
    }
    const g = a.auth && a.auth.google;
    const regOpen = a.auth && a.auth.registration === 'open';
    // De beheerder kan nieuwe accounts per manier aan- of uitzetten
    const canPw = regOpen && a.auth.signupPassword !== false;
    const canG = regOpen && !!g && a.auth.signupGoogle !== false;
    const open = canPw || canG;
    if (a.register && open) {
      return `<div class="auth card"><div class="auth-logo">${LOGO}<span class="wordmark">H€lder</span></div><h1>Account aanmaken</h1>
        ${canG ? `<a class="btn google-btn" href="/api/auth/google">${GOOGLE_ICON}Verder met Google</a>${canPw ? '<div class="or"><span>of met gebruikersnaam en wachtwoord</span></div>' : ''}` : ''}
        ${canPw ? `<form data-form="register" class="form-stack">
          <label class="field"><span>Je naam <span class="muted small">(zoals je die in Helder wil zien)</span></span><input type="text" name="displayName" autocomplete="name" maxlength="60" value="${esc(a.displayName || '')}"></label>
          <label class="field"><span>Gebruikersnaam</span><input type="text" name="username" autocomplete="username" autocapitalize="none" required minlength="2" maxlength="40" pattern="[a-zA-Z0-9._\-]{2,40}" value="${esc(a.previousUser || '')}"></label>
          <label class="field"><span>Wachtwoord (min. 8 tekens)</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
          <label class="field"><span>Herhaal wachtwoord</span><input type="password" name="password2" autocomplete="new-password" minlength="8" required></label>
          <p class="small muted">Onthoud je wachtwoord goed: zonder e-mailadres kan Helder het niet voor je herstellen. Download af en toe een back-up (Instellingen).</p>
          <div class="errors">${esc(a.error || '')}</div><button class="btn primary" type="submit">Account aanmaken</button></form>` : '<p class="small muted">Nieuwe accounts kunnen enkel met een Google-account.</p>'}
        <p class="small legal-links">Al een account? <a href="#" data-action="auth-login">Meld je aan</a></p>
        <p class="small muted legal-links">Door een account aan te maken ga je akkoord met de <a href="voorwaarden.html" target="_blank" rel="noopener">gebruiksvoorwaarden</a> en de <a href="privacy.html" target="_blank" rel="noopener">privacyverklaring</a>.</p></div>`;
    }
    // Kan je enkel met Google een account maken? Dan staat Google centraal en zit aanmelden met
    // gebruikersnaam (voor wie al zo'n account heeft, bv. de beheerder) achter een klein linkje.
    const googleFirst = !!g && !canPw;
    const pwForm = `<form data-form="login" class="form-stack">
        <label class="field"><span>Gebruikersnaam</span><input type="text" name="username" autocomplete="username" autocapitalize="none" value="${esc(a.previousUser || '')}" required></label>
        <label class="field"><span>Wachtwoord</span><input type="password" name="password" autocomplete="current-password" required></label>
        <div class="errors">${esc(a.error || '')}</div><button class="btn ${googleFirst ? '' : 'primary'}" type="submit">Aanmelden</button></form>`;
    const showPw = !googleFirst || a.showPw || !!a.error || (a.previousUser && !/^g_/.test(a.previousUser));
    const signupLine = canG && !canPw ? '<p class="small muted legal-links">Nog geen account? Klik gewoon op <strong>Aanmelden met Google</strong>: je account wordt dan meteen aangemaakt.</p>'
      : open ? '<p class="small legal-links">Nog geen account? <a href="#" data-action="auth-register"><strong>Maak er een aan</strong></a></p>'
      : a.auth && a.auth.registration ? '<p class="small muted legal-links">Nieuwe accounts zijn momenteel gesloten.</p>' : '';
    return `<div class="auth card"><div class="auth-logo">${LOGO}<span class="wordmark">H€lder</span></div>
      <p class="muted">${a.expired ? 'Je sessie is verlopen. Meld je opnieuw aan.' : 'Meld je aan.'}</p>
      ${g ? `<a class="btn google-btn" href="/api/auth/google">${GOOGLE_ICON}Aanmelden met Google</a>` : ''}
      ${googleFirst
        ? (showPw ? `<div class="or"><span>of met gebruikersnaam</span></div>${pwForm}` : '<p class="small legal-links"><a href="#" data-action="auth-show-pw">Aanmelden met gebruikersnaam en wachtwoord</a></p>')
        : `${g ? '<div class="or"><span>of met gebruikersnaam</span></div>' : ''}${pwForm}`}
      ${signupLine}
      <p class="small muted legal-links">${g ? 'Door aan te melden ga je akkoord met de ' : ''}<a href="voorwaarden.html" target="_blank" rel="noopener">${g ? 'gebruiksvoorwaarden' : 'Gebruiksvoorwaarden'}</a>${g ? ' en de ' : ' · '}<a href="privacy.html" target="_blank" rel="noopener">${g ? 'privacyverklaring' : 'Privacyverklaring'}</a>.</p></div>`;
  }

  // ---------- Gegevens ----------

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportCSV() {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Datum', 'Rekening', 'Eigen titel', 'Tegenpartij', 'IBAN tegenpartij', 'Mededeling', 'Bedrag', 'Soort', 'Gekoppeld aan', 'Persoon', 'Bron', 'Notitie'].map(q).join(';')];
    for (const t of state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const cats = C.splitLines(t).map(l => (l.categoryId ? catName(l.categoryId) : '') + (t.splits.length ? ' ' + C.centsToInput(l.amount) : '')).join(' + ');
      const persons = C.splitLines(t).map(l => l.person).filter(Boolean).join(', ');
      lines.push([fmtDate(t.date), accName(t.accountId), t.title || '', t.counterparty, C.formatIban(t.counterpartyIban), t.description, (t.amount < 0 ? '-' : '') + C.centsToInput(t.amount),
        (KIND_LABEL[kindOf(t)] || [])[1], cats, persons, t.source === 'import' ? (imp(t.importId) || {}).fileName : 'manueel', t.note || ''].map(q).join(';'));
    }
    download('helder-transacties-' + today + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }
  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await readFile(file));
        if (!data || !Array.isArray(data.transactions)) throw new Error('geen Helder-back-up');
        if (data.demo) throw new Error('dit is een back-up van de voorbeeldmodus');
        if ((data.version || 1) < Store.VERSION) throw new Error('back-up van een oudere Helder-versie; die wordt bewust niet teruggezet');
        if (!confirm('Al je huidige gegevens vervangen door deze back-up?')) return;
        replaceAll(data, 'Back-up teruggezet');
      } catch (e) { toast('Ongeldige back-up: ' + e.message); }
    };
    input.click();
  }
  /** Vervangt alle echte gegevens en markeert verwijderingen zodat andere toestellen volgen. */
  function replaceAll(newState, msg) {
    if (demo) exitDemo();
    const fresh = Store.migrate(newState);
    fresh.tombstones = realState.tombstones || {};
    realState = fresh;
    state = realState;
    commit(msg);
  }

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
    'toggle-theme': () => {
      const dark = !isDark();
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      try { localStorage.setItem('helder-theme', dark ? 'dark' : 'light'); } catch (e) { /* enkel voor deze keer */ }
      renderTopButtons();
    },
    'toggle-privacy': () => {
      const on = document.documentElement.classList.toggle('privacy');
      try { localStorage.setItem('helder-privacy', on ? '1' : '0'); } catch (e) { /* enkel voor deze keer */ }
      renderTopButtons();
      toast(on ? '👁 Bedragen verborgen voor meekijkers' : 'Bedragen weer zichtbaar');
    },
    'invest-edit': () => { ui.investEdit = !ui.investEdit; render(); },
    'invest-move': el => moveInvestSection(el.dataset.id, Number(el.dataset.dir)),
    'invest-show': el => toggleInvestSection(el.dataset.id, true),
    'invest-reset': () => setInvestLayout({ order: INVEST_SECTIONS.map(x => x.id), hidden: [], width: Object.assign({}, INVEST_WIDTH_DEFAULT) }, 'Standaardweergave hersteld'),
    'invest-width': el => setInvestWidth(el.dataset.id, el.dataset.w),
    'watch-new': () => openModal({ type: 'watch', isNew: true, edit: { id: C.uid('wl'), name: '', query: '', startDate: today } }),
    'watch-edit': el => { const w = (state.watchlist || []).find(x => x.id === el.dataset.id); if (w) openModal({ type: 'watch', edit: Object.assign({}, w) }); },
    'watch-save': saveWatch,
    'watch-delete': () => {
      const w = modal.edit;
      if (!confirm(`${w.name} niet meer volgen?`)) return;
      state.watchlist = (state.watchlist || []).filter(x => x.id !== w.id);
      closeModal();
      commit('Niet meer gevolgd');
    },
    'watch-refresh': () => fetchWatchQuotes(true),
    'watch-from-sold': el => {
      const p = Invest.soldVsToday(inv()).find(x => x.key === el.dataset.key);
      if (!p) return;
      openModal({ type: 'watch', isNew: true, edit: { id: C.uid('wl'), name: p.name, query: p.isin || p.name, startDate: p.lastSell, startPrice: p.sellPrice ? Math.round(p.sellPrice) : undefined, note: 'verkocht op ' + fmtDate(p.lastSell) } });
    },
    'metal-new': () => openModal({ type: 'metal', isNew: true, edit: { id: C.uid('mt'), origin: 'bought', metal: 'gold', count: 1 } }),
    'metal-edit': el => {
      const x = (state.metals || []).find(m => m.id === el.dataset.id);
      if (!x) return;
      const edit = Object.assign({}, x, { valuations: (x.valuations || []).slice() });
      // Oude "eigen verkoopwaarde" wordt een gewone waardering
      if (edit.sellValue && !edit.valuations.length) edit.valuations.push({ id: C.uid('mv'), date: (edit.createdAt || today).slice(0, 10), value: edit.sellValue, source: 'eigen verkoopwaarde' });
      delete edit.sellValue;
      openModal({ type: 'metal', edit });
    },
    'metal-val-add': metalValAdd,
    'metal-val-remove': el => metalValRemove(el.dataset.id),
    'metal-origin': el => { readMetalForm(); modal.edit.origin = el.dataset.v; renderModal(); },
    'metal-save': saveMetal,
    'metal-delete': () => {
      const x = modal.edit;
      if (!confirm(`“${x.name || 'Deze lijn'}” verwijderen?`)) return;
      state.metals = (state.metals || []).filter(m => m.id !== x.id);
      closeModal();
      commit('Verwijderd');
    },
    'metal-price-fetch': () => fetchMetalPrice(false),
    'metal-price-manual': () => openModal({ type: 'metalPrice' }),
    'metal-price-online': () => { closeModal(); fetchMetalPrice(false); },
    'metal-price-save': saveMetalPrice,
    'person-new': () => openModal({ type: 'person', person: { name: '', ibans: [] } }),
    'owed-filter': el => { ui.owed = el.dataset.f; render(); },
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
    'wi-refund-other': () => { const t = txById(modal.txId); if (t) openModal({ type: 'refundPick', txId: t.id, search: '' }); },
    'refund-pick': el => chooseRefundTarget(el.dataset.id),
    'refund-back': () => openModal(modal.back),
    'wi-advance': () => {
      const t = txById(modal.txId); const name = $('#wi-person').value.trim();
      if (!t) return;
      if (!name) { toast('Geef de naam van wie terugbetaalt.'); return; }
      markAdvance(t, name);
      whatIsDone('Terugbetaling van ' + name + ' gekoppeld');
    },
    'wi-prepaid': () => {
      const t = txById(modal.txId); const name = $('#wi-person').value.trim();
      if (!t) return;
      if (!name) { toast('Geef de naam van wie vooruitbetaalde.'); return; }
      markAdvance(t, name);
      const title = $('#wi-prepaid-title').value.trim();
      if (title) t.title = title;
      whatIsDone(name + ' betaalde vooruit: nog voor ' + name + ' te betalen');
    },
    'wi-action': () => {
      const t = txById(modal.txId); if (!t) return;
      let id = $('#wi-action').value;
      const catId = $('#wi-action-cat').value;
      if (id === '__new__') {
        const name = (prompt('Wat moet er gebeuren? (bv. “Geld terugvragen aan mama”)') || '').trim();
        if (!name) return;
        const a = { id: C.uid('act'), name, expectBack: true, person: '', note: '', createdAt: new Date().toISOString() };
        state.actions = (state.actions || []).concat([a]); id = a.id;
      }
      addToAction([t.id], id);
      if (catId) { t.categoryId = catId; t.categorySource = 'manual'; t.ruleId = null; }
      whatIsDone('Toegevoegd aan “' + (actionById(id) || {}).name + '”');
    },
    'wi-transfer': () => { const t = txById(modal.txId); if (!t) return; t.transferMode = 'yes'; t.categoryId = null; t.categorySource = null; whatIsDone('Aangeduid als overschrijving van een eigen rekening'); },
    'action-new': () => openModal({ type: 'action', isNew: true, edit: { id: C.uid('act'), name: '', expectBack: false, person: '', note: '' } }),
    'action-done': (el, ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); toggleActionDone(el.dataset.id); },
    'action-idea': el => quickAction(el.dataset.name),
    'action-edit': el => { const a = actionById(el.dataset.id); if (a) openModal({ type: 'action', edit: Object.assign({}, a) }); },
    'action-save': saveAction,
    'action-delete': () => {
      const a = modal.edit;
      if (!confirm(`De actie “${a.name}” verwijderen? De transacties zelf blijven gewoon staan.`)) return;
      state.actions = (state.actions || []).filter(x => x.id !== a.id);
      closeModal();
      commit('Actie verwijderd');
    },
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
    'forgive-undo': el => { if (confirm('Dit ongedaan maken? Het bedrag staat dan weer open.')) removeForgive(el.dataset.person, el.dataset.id); },
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
        container.insertAdjacentHTML('beforeend', splitRow({ categoryId: $('#tx-category').value || null, amount: isNaN(amount) ? 0 : Math.abs(amount) }, true));
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
    if (modal && modal.type === 'tx' && el.closest('#splits')) onSplitInput(el);
    if (modal && modal.type === 'tx' && (el.closest('#splits') || el.id === 'tx-amount')) { updateSplitRemaining(); updateTxSections(); }
    if (modal && modal.type === 'tx' && el.id === 'tx-title') { clearTimeout(searchTimer); searchTimer = setTimeout(updateTitleSuggestion, 250); }
    if (modal && modal.type === 'rule') updateRulePreview();
    if (modal && modal.type === 'advPick' && el.id === 'adv-person') { modal.person = el.value; return; }
    if (modal && modal.type === 'search' && el.id === 'global-search') {
      modal.q = el.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { const r = $('#search-results'); if (r) r.innerHTML = searchListHtml(modal.q, modal.cat); }, 120);
      return;
    }
    if (modal && modal.type === 'refundPick' && el.id === 'rp-search') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { modal.search = el.value; const pos = el.selectionStart; renderModal(); const s2 = $('#rp-search'); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); } }, 150);
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
    if (modal && modal.type === 'search' && el.id === 'global-search-cat') { modal.cat = el.value; const r = $('#search-results'); if (r) r.innerHTML = searchListHtml(modal.q, modal.cat); return; }
    if (el.dataset.filter === 'bank.category') { ui.bank.category = el.value; if (el.value && ui.bank.status === 'todo' && el.value !== '__none__') ui.bank.status = ''; render(); return; }
    if (el.dataset.tl) { onTimelineInput(el); render(); return; }
    if (el.dataset.adminReg != null) { Sync.admin.setRegistration(el.checked).then(() => { toast(el.checked ? 'Nieuwe accounts: open' : 'Nieuwe accounts: gesloten'); loadAdmin(); }).catch(e => toast(e.message)); return; }
    if (el.dataset.adminAi) { Sync.admin.user(el.dataset.adminAi, el.checked ? 'ai-on' : 'ai-off').then(() => loadAdmin()).catch(e => toast(e.message)); return; }
    if (el.dataset.assetClass) {
      const iv = inv();
      const p = iv && Invest.summary(iv).positions.find(x => (x.key || x.isin || x.name) === el.dataset.assetClass);
      const cur = Object.assign({}, (state.settings && state.settings.assetClasses) || {});
      if (p && Invest.assetClassOf(p, null) === el.value) delete cur[el.dataset.assetClass]; else cur[el.dataset.assetClass] = el.value;
      state.settings = Object.assign({}, state.settings, { assetClasses: cur });
      commit('Indeling bewaard');
      return;
    }
    if (el.name === 'fg-reason') {
      const l = $('#fg-cat-label');
      if (l) l.textContent = el.value === 'gift' ? 'Telt als uitgave in (bv. Cadeaus)' : 'Waarvoor was het? Dit wordt je uitgave (bv. 🍽️ Eten)';
      return;
    }
    if (el.dataset.investShow) { toggleInvestSection(el.dataset.investShow, el.checked); return; }
    if (el.dataset.settle) { setSettle(el.dataset.settle, el.value); return; }
    if (el.id === 'tax-year' && modal && modal.type === 'taxYear') { modal.year = el.value; renderModal(); return; }
    if (el.dataset.bulkAction != null) {
      const ids = Array.from(ui.selected);
      if (el.value === '__new__') { openModal({ type: 'action', isNew: true, addTx: ids, edit: { id: C.uid('act'), name: '', expectBack: false, person: '', note: '' } }); return; }
      if (el.value.startsWith('idea:')) { ui.selected.clear(); quickAction(el.value.slice(5), ids); return; }
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
    if (modal.type === 'tx' && el.id === 'tx-refund' && el.value === '__search__') { const back = modal; openModal({ type: 'refundPick', txId: back.tx.id, back, search: '' }); return; }
    if (modal.type === 'tx' && el.id === 'tx-action-add') { txAddAction(el); return; }
    if (modal.type === 'metal' && el.id === 'mt-preset') { metalPresetChosen(el.value); return; }
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
    if (form.dataset.form === 'action-quick') { quickAction(new FormData(form).get('name')); return; }
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
