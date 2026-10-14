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
  const ui = {
    view: VIEWS.includes((location.hash || '').slice(1)) ? location.hash.slice(1) : 'dashboard',
    range: { from: today.slice(0, 7), to: today.slice(0, 7) }, // gekozen periode (maanden), gedeeld door Overzicht/Inkomsten/Uitgaven
    bank: { account: '', status: 'todo', search: '', limit: 150 },
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
    return `<span class="badge"><span class="dot" style="background:${esc(catColor(id))}"></span>${esc(catLabel(id))}${extra}</span>`;
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
      <div class="tl-axis">${months.map((m, i) => m.slice(5) === '01' || i === 0 ? `<span style="left:${((i + 0.5) / n * 100).toFixed(2)}%">${m.slice(5) === '01' ? m.slice(0, 4) : shortMonth(m)}</span>` : '').join('')}</div>
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
  }

  // ---------- Rendering ----------

  function render() {
    renderSyncBadge();
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
    const todo = todoCount();
    const bankBtn = $('#nav [data-view=bank]');
    if (bankBtn) bankBtn.innerHTML = 'Bank' + (todo ? ` <span class="count">${todo}</span>` : '');
    if (ui.auth) { $('#nav').hidden = true; $('#main').innerHTML = renderAuth(); return; }
    if (ui.admin) { $('#nav').hidden = true; $('#main').innerHTML = renderAdmin(); return; }
    $('#nav').hidden = false;
    const views = { dashboard: renderDashboard, bank: renderBank, income: renderIncome, expenses: renderExpenses, advances: renderAdvances, invest: renderInvest, settings: renderSettings };
    const banner = demo ? `<div class="demo-banner">🧪 <strong>Voorbeeldmodus.</strong> Verzonnen gegevens om Helder te leren kennen — volledig los van je eigen gegevens, niet gesynchroniseerd.
      <button class="btn small" data-action="exit-demo">Voorbeeld afsluiten</button></div>` : '';
    // Wie aan het typen is in een koppelveld, blijft daar (ook als de synchronisatie de pagina ververst)
    const act = document.activeElement;
    const keep = act && act.dataset && act.dataset.assignInput && $('#main').contains(act)
      ? { id: act.dataset.assignInput, value: act.value, typed: picker.typed && picker.input === act, start: act.selectionStart, end: act.selectionEnd } : null;
    closePicker(false);
    for (const id of ui.selected) if (!txById(id)) ui.selected.delete(id);
    $('#main').innerHTML = banner + (views[ui.view] || renderDashboard)();
    afterRender();
    if (keep) {
      const el = $$('[data-assign-input]').find(x => x.dataset.assignInput === keep.id);
      if (el) { el.value = keep.value; el.focus(); try { el.setSelectionRange(keep.start, keep.end); } catch (e) { /* niet erg */ } openPicker(el, keep.typed); }
    }
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

    return `
      <div class="page-head"><h1>Overzicht</h1></div>
      ${timeline()}
      ${(() => { const n = C.cancellationPairs(state).length; return n ? `<div class="notice info"><a href="#" data-action="goto" data-view="bank">↩ ${n} mogelijke annulering${n === 1 ? '' : 'en'} gevonden</a>: een inkomst met hetzelfde bedrag als een eerdere uitgave.</div>` : ''; })()}
      ${todo ? `<div class="notice info"><a href="#" data-action="goto" data-view="bank">📥 ${todo} transactie(s) wachten om gekoppeld te worden</a> aan een inkomst, uitgave, voorschot, belegging of eigen rekening.</div>` : ''}
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Netto inkomsten</div><div class="value pos">${money(sum.netIncome)}</div>
          <div class="hint">bruto ${money(sum.income)}${sum.incomeCosts ? ' − kosten ' + money(sum.incomeCosts) : ''}</div></div>
        <div class="card kpi"><div class="label">Uitgaven</div><div class="value">${money(sum.expenses)}</div><div class="hint">na terugbetalingen</div></div>
        <div class="card kpi"><div class="label">Over in deze periode</div><div class="value ${sum.net >= 0 ? 'pos' : ''}">${money(sum.net)}</div>
          <div class="hint">${sum.net < 0 ? 'meer uitgegeven dan verdiend' : sum.netIncome ? Math.round(sum.net / sum.netIncome * 100) + '% van je netto inkomen' : ''}</div></div>
        <div class="card kpi"><div class="label">Belegd</div><div class="value">${money(sum.invested)}</div><div class="hint">naar je beleggingsrekening</div></div>
      </div>
      <div class="card" style="margin-bottom:16px"><h2>Vermogen door de tijd</h2>${netWorthChart(range)}</div>
      ${multi ? `<div class="card" style="margin-bottom:16px"><h2>Inkomsten en uitgaven per maand</h2>${monthBars(lines)}</div>` : ''}
      <div class="grid two">
        <div class="card">
          <h2>Vermogen</h2>
          <div class="list">
            ${balances.map(x => `<div class="list-row"><div class="grow">${esc(x.a.name)}<div class="small muted">gekend saldo van ${fmtDate(x.b.since)} + latere transacties</div></div><span class="amount">${money(x.b.amount)}</span></div>`).join('')}
            ${invSum ? `<div class="list-row"><div class="grow">Beleggingen (Degiro)<div class="small muted">stand ${fmtDate(inv().positionsDate)}</div></div><span class="amount">${money(invSum.valueEur)}</span></div>` : ''}
            ${adv.totalOpen > 0 ? `<div class="list-row"><div class="grow">Nog terug te krijgen van vrienden</div><span class="amount">${money(adv.totalOpen)}</span></div>` : ''}
            <div class="list-row total"><div class="grow"><strong>Totaal</strong></div><span class="amount">${money(bankTotal + (invSum ? invSum.valueEur : 0) + Math.max(0, adv.totalOpen))}</span></div>
          </div>
          ${state.accounts.some(a => a.type !== 'cash' && !C.accountBalance(state, a.id)) ? '<p class="small muted">Niet voor elke rekening is een saldo gekend. Geef het in bij Bank → rekening → Bewerk.</p>' : ''}
        </div>
        <div class="card">
          <h2>Inkomsten per bron</h2>
          ${Object.keys(sum.byIncome).length ? '<div class="list">' + Object.entries(sum.byIncome).sort((a, b) => b[1].gross - a[1].gross).map(([id, v]) => `<div class="list-row">
              <span class="dot-lg" style="background:${esc(catColor(id === '__none__' ? null : id))}"></span>
              <div class="grow">${esc(id === '__none__' ? 'Nog niet gekoppeld' : catLabel(id))}<div class="small muted">bruto ${money(v.gross)}${v.costs ? ' − kosten ' + money(v.costs) : ''}</div></div>
              <span class="amount">${money(v.net)}</span></div>`).join('') + '</div>' : '<p class="muted">Geen inkomsten in deze periode.</p>'}
        </div>
        <div class="card">
          <h2>Voorschotten</h2>
          ${open.length ? '<div class="list">' + open.map(p => `<div class="list-row"><div class="grow"><a href="#advances" data-view-link="advances">${esc(p.person)}</a><div class="small muted">voorgeschoten ${money(p.advanced)} · terug ${money(p.repaid)}</div></div><span class="amount">${p.open > 0 ? money(p.open) + ' open' : money(-p.open) + ' te veel'}</span></div>`).join('') + '</div>'
            : '<p class="muted">Niemand is je nog iets schuldig.</p>'}
        </div>
        <div class="card">
          <h2>Aandacht</h2>
          <div class="list">
            ${budgets.map(b => `<div class="list-row"><div class="grow">Budget ${esc(catLabel(b.budget.categoryId))}<div class="small muted">${b.budget.period === 'yearly' ? esc(b.range.label) : esc(monthLabel(b.range.label))}</div></div><span class="badge ${b.status}">${b.status === 'over' ? 'overschreden' : 'bijna op'} · ${Math.round(b.pct * 100)}%</span></div>`).join('')}
            ${upcoming.map(r => `<div class="list-row"><div class="grow">🔁 ${esc(r.name)}<div class="small muted">${esc(r.frequency.label)} · ${r.daysUntil < 0 ? -r.daysUntil + ' d te laat' : r.daysUntil === 0 ? 'vandaag' : 'over ' + r.daysUntil + ' d'}</div></div><span class="amount">${r.fixed ? '' : '± '}${money(r.expected)}</span></div>`).join('')}
            ${!budgets.length && !upcoming.length ? '<p class="muted">Niets bijzonders.</p>' : ''}
          </div>
        </div>
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

  /** Netto inkomsten en uitgaven per maand in de gekozen periode. */
  function monthBars(lines) {
    const months = [];
    for (let m = ui.range.from; m <= ui.range.to; m = shiftMonth(m, 1)) months.push(m);
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
    cats(incoming ? 'income' : 'expense', incoming ? 'Inkomst' : 'Uitgave');
    add('new-cat', incoming ? '+ Nieuwe inkomstenbron…' : '+ Nieuwe categorie…', incoming ? 'Inkomst' : 'Uitgave');
    for (const p of C.personList(state).sort((a, b) => a.name.localeCompare(b.name))) {
      add('adv:' + p.name, incoming ? '🤝 Terugbetaling van ' + p.name : '🤝 Voorgeschoten voor ' + p.name, 'Voorschot', incoming && p.stats.open > 0 ? 'nog ' + money(p.stats.open) + ' open' : '');
    }
    add('cat:' + C.SYS_ADVANCE, incoming ? '↙ Terugbetaling van iemand anders…' : '↗ Voorgeschoten voor iemand anders…', 'Voorschot');
    if (incoming) add('refund', '↩ Terugbetaling van een uitgave…', 'Speciaal');
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
      <button class="btn small danger" data-action="bulk-delete">🗑 Verwijderen</button>
      <button class="btn small ghost" data-action="bulk-clear">Selectie wissen</button></div>`;
  }

  function bulkAssign(value) {
    const ids = Array.from(ui.selected);
    let n = 0;
    for (const id of ids) {
      const t = txById(id);
      if (!t || (t.splits && t.splits.length) || t.refundOf) continue;
      if (value === 'transfer') { t.transferMode = 'yes'; t.categoryId = null; t.categorySource = null; }
      else if (value === '') { t.categoryId = null; t.categorySource = null; if (t.transferMode === 'yes') t.transferMode = 'auto'; }
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
    const hint = ui.ruleHint && ui.ruleHint.txId === t.id && t.categoryId === ui.ruleHint.categoryId && (t.counterparty || t.description);
    const sel = ui.selected.has(t.id);
    return `<tr class="${k === 'todo' ? 'is-todo' : ''} ${t.isTransfer ? 'is-transfer' : ''} ${sel ? 'is-selected' : ''}">
      <td class="sel-cell"><input type="checkbox" data-select="${esc(t.id)}" ${sel ? 'checked' : ''} aria-label="Selecteer"></td>
      <td class="nowrap">${fmtDate(t.date)}${opts.showAccount ? `<div class="small muted">${esc(accName(t.accountId))}</div>` : ''}</td>
      <td class="clickable" data-action="edit-tx" data-id="${esc(t.id)}">${t.title ? `<div class="tx-title">${esc(t.title)}</div><div class="desc">${esc([t.counterparty, t.description].filter(Boolean).join(' · '))}</div>` : `<div>${esc(t.counterparty || '—')}</div><div class="desc" title="${esc(t.description)}">${esc(t.description)}</div>`}
        <div class="badge-row">${opts.showKind ? kindBadge(k) : ''}${extra.join('')}${opts.showSource ? sourceBadge(t) : ''}</div></td>
      <td class="amount ${amountClass(t.amount)}">${money(t.amount)}</td>
      <td class="assign-cell">${assignSelect(t)}${hint ? `<div><button class="btn small ghost" data-action="rule-hint" data-id="${esc(t.id)}">⚙ Altijd zo voor “${esc((t.counterparty || t.description).slice(0, 28))}”</button></div>` : ''}</td>
    </tr>`;
  }

  function txTable(list, opts) {
    if (!list.length) return `<div class="card empty-state">${opts && opts.empty || 'Geen transacties.'}</div>`;
    const lim = (opts && opts.limit) || 150;
    const shown = list.slice(0, lim);
    const allSel = shown.length && shown.every(t => ui.selected.has(t.id));
    return `${selectionBar()}<div class="table-wrap"><table class="tx-table">
      <thead><tr><th class="sel-cell"><input type="checkbox" data-select-all="${esc(shown.map(t => t.id).join(','))}" ${allSel ? 'checked' : ''} aria-label="Alles selecteren"></th><th>Datum</th><th>Omschrijving</th><th class="right">Bedrag</th><th>Gekoppeld aan</th></tr></thead>
      <tbody>${list.slice(0, lim).map(t => txRow(t, opts)).join('')}</tbody></table></div>
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
            <div class="grow"><strong>${esc(r.name)}</strong> → ${catBadge(r.categoryId)}${r.categoryId === C.SYS_ADVANCE ? ` <span class="small">${r.person ? 'voor ' + esc(r.person) : '<span class="warn-text">voor wie?</span>'}</span>` : ''}<div class="small muted">${esc(C.RULE_FIELDS[r.field])} ${esc(C.RULE_OPERATORS[r.operator])} “${esc(r.value)}” · ${ruleCount[r.id] || 0} treffers</div></div>
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
      <p class="muted">Koppel je bank om transacties automatisch op te halen, of laad de CSV-export van je bank op (KBC/CBC en Argenta worden automatisch herkend).
        Elk bestand kan maar één keer opgeladen worden, en transacties die al in Helder zitten worden overgeslagen. Koppel daarna elke transactie aan wat ze is.</p>
      ${bankLinkCard()}
      ${cancelCard()}
      <div class="grid cards" style="margin-bottom:16px">${cards}</div>

      <h2>Transacties${f.account ? ' — ' + esc(accName(f.account)) : ''}</h2>
      <div class="filters">
        <div class="seg">
          ${[['todo', `Te verwerken (${todo})`], ['done', 'Verwerkt'], ['', 'Alles']].map(([v, l]) => `<button class="${f.status === v ? 'active' : ''}" data-action="bank-status" data-status="${v}">${l}</button>`).join('')}
        </div>
        <select data-filter="bank.account"><option value="">Alle rekeningen</option>${accountOptions(f.account)}</select>
        <input type="search" placeholder="Zoeken…" data-filter="bank.search" value="${esc(f.search)}">
      </div>
      ${txTable(all, { showKind: true, showSource: true, showAccount: !f.account, limit: f.limit, moreKey: 'bank', empty: f.status === 'todo' ? '🎉 Alles is verwerkt.' : 'Geen transacties.' })}
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

  function renderAdvances() {
    const people = C.personList(state).sort((a, b) => b.stats.open - a.stats.open || a.name.localeCompare(b.name));
    const ov = C.advancesOverview(state);
    const open = people.filter(p => p.stats.open > 0);
    const everAdvanced = ov.items.reduce((sum, i) => sum + i.amount, 0);
    const card = p => {
      const st = p.stats;
      const ent = p.entity || {};
      const sugg = C.suggestRepayments(state, p.name, ent.ibans, today, 3);
      const reps = state.transactions.filter(t => C.splitLines(t).some(l => l.categoryId === C.SYS_ADVANCE && l.amount > 0 && String(l.person || t.person || '').toLowerCase() === p.name.toLowerCase()))
        .sort((a, b) => b.date.localeCompare(a.date));
      const pctRepaid = st.advanced ? Math.min(1, st.repaid / st.advanced) : 0;
      const status = st.open > 0 ? `<span class="badge warn">nog ${money(st.open)} open</span>` : st.open < 0 ? `<span class="badge">${money(-st.open)} te veel terug</span>` : st.advanced ? '<span class="badge ok">✓ alles terugbetaald</span>' : '<span class="badge">nog niets voorgeschoten</span>';
      return `<div class="card person-card">
        <div class="person-head"><span class="avatar" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
          <div class="grow"><strong>${esc(p.name)}</strong><div class="small muted">voorgeschoten ${money(st.advanced)} · terugbetaald ${money(st.repaid)}</div></div>${status}</div>
        ${st.advanced ? `<div class="progress"><div class="bar ok" style="width:${(pctRepaid * 100).toFixed(1)}%"></div></div>` : ''}
        ${sugg.length ? `<div class="suggest">${sugg.map(x => `<div class="suggest-row">💡 <span class="grow">Terugbetaling? <strong>${money(x.tx.amount)}</strong> van ${esc(x.tx.counterparty || '?')} op ${fmtDate(x.tx.date)} <span class="muted small">(${esc(x.why)})</span></span>
          <button class="btn small primary" data-action="adv-accept" data-id="${esc(x.tx.id)}" data-person="${esc(p.name)}">Ja, koppel</button></div>`).join('')}</div>` : ''}
        ${st.items.length ? `<table class="mini adv-table"><thead><tr><th>Voorgeschoten</th><th class="right">Bedrag</th><th class="right">Status</th></tr></thead><tbody>${st.items.slice().reverse().map(it => `<tr>
            <td><a href="#" data-action="edit-tx" data-id="${esc(it.txId)}">${fmtDate(it.date)}</a> <span class="small muted">${esc((it.note || '').slice(0, 40))}</span></td>
            <td class="amount">${money(it.amount)}</td>
            <td class="right small">${it.repaid >= it.amount ? '<span class="pos">✓ terug</span>' : it.repaid > 0 ? 'nog ' + money(it.amount - it.repaid) : '<span class="warn-text">open</span>'}</td></tr>`).join('')}</tbody></table>` : ''}
        ${reps.length ? `<details><summary class="small">${reps.length} terugbetaling${reps.length === 1 ? '' : 'en'}</summary><table class="mini"><tbody>${reps.map(t => `<tr><td><a href="#" data-action="edit-tx" data-id="${esc(t.id)}">${fmtDate(t.date)}</a> <span class="small muted">${esc(t.counterparty || (t.source === 'manual' ? 'cash' : ''))}</span></td><td class="amount pos">${money(C.splitLines(t).filter(l => l.categoryId === C.SYS_ADVANCE).reduce((a, l) => a + l.amount, 0))}</td></tr>`).join('')}</tbody></table></details>` : ''}
        <div class="card-tools">
          <button class="btn small" data-action="adv-pick" data-person="${esc(p.name)}" data-dir="out">↗ Betaling aanduiden als voorschot</button>
          <button class="btn small" data-action="adv-pick" data-person="${esc(p.name)}" data-dir="in">↙ Terugbetaling aanduiden</button>
          ${st.open > 0 ? `<button class="btn small" data-action="adv-cash" data-person="${esc(p.name)}">💶 Terugbetaald in cash</button>` : ''}
          <button class="btn small ghost" data-action="person-edit" data-person="${esc(p.name)}">✎ Bewerk</button></div>
      </div>`;
    };
    return `
      <div class="page-head"><h1>Voorschotten</h1><span class="spacer"></span>
        <button class="btn primary" data-action="person-new">+ Persoon</button></div>
      <p class="muted">Betaalde je iets voor iemand anders (bv. de hele restaurantrekening, concerttickets)? Dan is dat geen uitgave maar een <strong>voorschot</strong>.
        Koppel die betaling aan de persoon, en later de terugbetaling ook. Zo zie je altijd wie je nog wat schuldig is, en tellen voorschotten nooit mee als uitgave of inkomen.</p>
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Nog terug te krijgen</div><div class="value">${money(Math.max(0, open.reduce((a, p) => a + p.stats.open, 0)))}</div><div class="hint">${open.length} ${open.length === 1 ? 'persoon' : 'personen'}</div></div>
        <div class="card kpi"><div class="label">Ooit voorgeschoten</div><div class="value">${money(everAdvanced)}</div><div class="hint">${ov.items.length} voorschotten</div></div>
        <div class="card kpi"><div class="label">Hoe koppel ik snel?</div><div class="hint" style="margin-top:6px">Typ in <em>Gekoppeld aan</em> de naam, bv. <code>pieter</code>, en kies <strong>🤝 Voorgeschoten voor Pieter</strong> of <strong>🤝 Terugbetaling van Pieter</strong>.</div></div>
      </div>
      ${people.length ? `<div class="grid cards people">${people.map(card).join('')}</div>` : `<div class="card empty-state"><p>Nog geen personen. Maak er een aan met <strong>+ Persoon</strong>, of duid een betaling aan als voorschot.</p></div>`}`;
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
    return modalShell(out ? `Voorgeschoten voor ${m.person}` : `Terugbetaling van ${m.person}`, `
      <p class="small muted">${out ? 'Vink de betalingen aan die je voor ' + esc(m.person) + ' deed. Betaalde je ook voor jezelf? Open dan de transactie en splits ze.' : 'Vink de betalingen aan waarmee ' + esc(m.person) + ' je terugbetaalde. Ze worden afgeboekt op de oudste open voorschotten.'}</p>
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
      const bank = /kbc|cbc/i.test(conn.aspsp) ? 'kbc' : /argenta/i.test(conn.aspsp) ? 'argenta' : undefined;
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
      <p class="small muted">Helder haalt vanzelf nieuwe transacties op telkens je de app opent (hoogstens om de 6 uur). Wil je meteen bijwerken, klik dan op ↻ Vernieuwen. Wat al in Helder zat, wordt overgeslagen.</p></div>`;
  }

  function bankSetupModal() {
    const m = modal;
    const st = bankLink.status || {};
    return modalShell('Bankkoppeling instellen', `
      ${st.shared ? `<div class="notice info small">✓ Je gebruikt de bankapp van deze Helder (gedeeld door de beheerder). Je hoeft niets in te stellen; wil je toch je eigen app gebruiken, vul ze dan hieronder in.</div>`
        : st.configured ? `<div class="notice info small">✓ Ingesteld met app <strong>${esc(st.appName || st.appId)}</strong> (${esc(st.appId)}).</div>` : ''}
      <p>Helder gebruikt <strong>Enable Banking</strong> om je rekeningen bij KBC, CBC, Argenta en andere banken te lezen. Je stelt dit één keer in:</p>
      <ol class="steps">
        <li>Maak een account op <a href="https://enablebanking.com" target="_blank" rel="noopener">enablebanking.com</a> en open het <strong>Control Panel</strong>.</li>
        <li>Registreer een nieuwe <strong>application</strong>:
          <ul><li>Environment: <strong>Production</strong></li>
            <li>Naam: <em>Helder</em></li>
            <li>Allowed redirect URLs: <code id="eb-redirect">${esc(st.redirectUrl || '')}</code> <button class="btn small" data-action="copy" data-copy="${esc(st.redirectUrl || '')}">Kopieer</button></li>
            <li>Laat de sleutel <strong>in je browser genereren</strong>. Je krijgt een <code>.pem</code>-bestand: bewaar het goed.</li></ul></li>
        <li>Activeer de app door <strong>je eigen rekeningen te koppelen</strong> (in het Control Panel bij de app). Zo werkt ze enkel voor jouw rekeningen ("restricted" modus).</li>
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
      toast('Bankkoppeling ingesteld' + (r.appName ? ' (' + r.appName + ')' : '') + '. Koppel nu je bank.');
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
      ${m.error ? `<div class="errors">${esc(m.error)}</div>` : ''}
      ${!m.aspsps ? '<p class="muted">Banken laden…</p>' : `
        ${popular.length ? `<div class="bank-choices">${popular.map(btn).join('')}</div>` : ''}
        ${rest.length ? `<details ${q ? 'open' : ''}><summary class="small">Andere banken (${rest.length})</summary><div class="bank-choices">${rest.map(btn).join('')}</div></details>` : ''}
        ${!list.length ? '<p class="muted">Geen bank gevonden.</p>' : ''}`}
      ${m.busy ? '<p><strong>Doorsturen naar je bank…</strong></p>' : ''}`,
      '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>', true);
  }

  async function loadAspsps() {
    const m = modal;
    m.aspsps = null; m.error = '';
    renderModal();
    try { const r = await Sync.bank.aspsps(m.country); if (modal === m) { m.aspsps = r.aspsps; renderModal(); } }
    catch (e) { if (modal === m) { m.aspsps = []; m.error = e.message; renderModal(); } }
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
        <div class="budget-card"><div class="top"><span class="name"><span class="dot-lg" style="background:${esc(catColor(id === '__none__' ? null : id))}"></span> ${esc(id === '__none__' ? 'Nog niet gekoppeld' : catLabel(id))}</span>
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
    const total = items.reduce((a, x) => a + x.v, 0);
    if (!total) return '';
    const top = items.slice(0, 5);
    const rest = items.slice(5).reduce((a, x) => a + x.v, 0);
    const segs = top.map(x => ({ label: x.id ? catLabel(x.id) : '❔ Nog niet gekoppeld', color: catColor(x.id), v: x.v }));
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
      return `<path d="${d}" fill="${esc(sg.color)}" data-donut="${i}" class="donut-seg"><title>${esc(sg.label)}: ${money(sg.v)} (${(frac * 100).toFixed(0)}%)</title></path>`;
    }).join('');
    const pctTxt = v => (v / total * 100).toFixed(v / total < 0.1 ? 1 : 0).replace('.', ',') + '%';
    return `<div class="donut" data-total="${esc(money(total))}" data-total-label="${esc(opts.totalLabel || 'Totaal')}">
      <svg viewBox="0 0 180 180" role="img" aria-label="Verdeling per categorie">${arcs}
        <text x="90" y="84" text-anchor="middle" class="donut-label" id="donut-label">${esc(opts.totalLabel || 'Totaal')}</text>
        <text x="90" y="104" text-anchor="middle" class="donut-value" id="donut-value">${esc(money(total))}</text></svg>
      <ul class="donut-legend">${segs.map((sg, i) => `<li data-donut="${i}" data-label="${esc(sg.label.replace(/\s*\(\d+\)$/, ''))}" data-value="${esc(money(sg.v) + ' · ' + pctTxt(sg.v))}"><span class="sw" style="background:${esc(sg.color)}"></span><span class="name">${esc(sg.label)}</span><span class="pct">${pctTxt(sg.v)}</span><span class="amt">${money(sg.v)}</span></li>`).join('')}</ul></div>`;
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
    const cats = Object.entries(sum.byCategory)
      .filter(([id, v]) => v < 0 && (id === '__none__' || (cat(id) && cat(id).kind === 'expense')))
      .map(([id, v]) => ({ id: id === '__none__' ? null : id, v: -v })).sort((a, b) => b.v - a.v);
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
          ${donutChart(cats, { totalLabel: 'Uitgaven' })}
          ${cats.length ? cats.map(c => `<div class="catbar"><span class="name">${esc(c.id ? catLabel(c.id) : 'Nog niet gekoppeld')}</span>
            <span class="track"><span class="fill" style="display:block;width:${(c.v / maxCat * 100).toFixed(1)}%;background:${esc(catColor(c.id))}"></span></span>
            <span class="amount">${money(c.v)}</span></div>`).join('') : '<p class="muted">Geen uitgaven in deze periode.</p>'}
        </div>
        <div class="card">
          <div class="card-head"><h2>Budgetten</h2><button class="btn small" data-action="new-budget">+ Budget</button></div>
          ${budgets.length ? budgets.map(st => {
            const p = Math.min(st.pct, 1) * 100;
            return `<div class="budget-line"><div class="row"><span>${esc(catLabel(st.budget.categoryId))} <span class="small muted">${st.budget.period === 'yearly' ? 'jaar' : 'maand'}</span></span>
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

  function renderInvest() {
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
    if (!iv) {
      return `<div class="page-head"><h1>Beleggingen</h1></div>
        <p class="muted">Koppel je Degiro- of Saxo-rekening om je portefeuille, je stortingen en je rendement (TWR en MWR) te zien. Overschrijvingen van je bank naar je broker tellen in Helder als <em>belegging</em>, niet als uitgave.</p>
        ${connect}
        <div class="card" style="margin-top:16px"><h2>Wat moet ik exporteren uit Degiro?</h2>${DEGIRO_EXPORT_HELP}</div>`;
    }
    const s = Invest.summary(iv);
    const perf = Invest.performance(iv);
    const files = iv.files || [];
    return `
      <div class="page-head"><h1>Beleggingen</h1><span class="spacer"></span>
        <span class="small muted">Bron: ${Invest.brokers(iv).map(b => esc(b.source === 'demo' ? 'voorbeeld' : b.source === 'degiro-csv' ? 'Degiro-exports' : b.name + ' (rechtstreeks)') + ' · bijgewerkt ' + esc(fmtDateTime(b.syncedAt))).join(' — ')}</span></div>
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Waarde</div><div class="value">${money(s.valueEur)}</div><div class="hint">stand ${fmtDate(iv.positionsDate)} · waarvan cash ${money(s.cashEur)}</div></div>
        <div class="card kpi"><div class="label">Netto ingelegd</div><div class="value">${s.hasDeposits ? money(s.netDeposits) : '—'}</div><div class="hint">${s.hasDeposits ? 'stortingen ' + money(s.deposits) + (s.withdrawals ? ' − opnames ' + money(s.withdrawals) : '') : 'laad het rekeningoverzicht op'}</div></div>
        <div class="card kpi"><div class="label">Winst / verlies</div><div class="value ${s.gainEur >= 0 ? 'pos' : 'negv'}">${s.gainEur != null ? money(s.gainEur) : '—'}</div><div class="hint">waarde − netto inleg</div></div>
        <div class="card kpi"><div class="label">Dividend (netto)</div><div class="value">${money(s.netDividends)}</div><div class="hint">kosten: ${money(s.fees)}</div></div>
      </div>
      ${perf ? `<div class="grid kpis">
        <div class="card kpi" title="Time-weighted return">
          <div class="label">TWR — tijdgewogen</div><div class="value">${pct(perf.twrAnnual)} <span class="small muted">per jaar</span></div>
          <div class="hint">${pct(perf.twr)} in totaal sinds ${fmtDate(perf.start)}. Het rendement van je beleggingen zelf, los van wanneer en hoeveel je stortte — vergelijkbaar met een fonds of index.</div></div>
        <div class="card kpi" title="Money-weighted return (XIRR)">
          <div class="label">MWR / MWRR — geldgewogen</div><div class="value">${pct(perf.mwr)} <span class="small muted">per jaar</span></div>
          <div class="hint">Jouw persoonlijke rendement (XIRR): houdt rekening met het moment en de grootte van elke storting.</div></div>
      </div>
      ${perf.missingYearEnds.length ? `<div class="notice">Voor een rendement per jaar ontbreekt de portefeuillewaarde op <strong>${Array.from(new Set(perf.missingYearEnds)).map(fmtDate).join(', ')}</strong>, en er zijn geen transacties om ze uit te reconstrueren.</div>` : ''}
      ${perf.estimatedYears.length ? `<div class="notice info">Begin- en eindwaarden van ${perf.estimatedYears.join(', ')} zijn <strong>gereconstrueerd uit je transacties</strong>${iv.market && iv.market.series ? ' met historische marktkoersen' : ' met je aankoopkoersen (historische marktkoersen worden gebruikt zodra Helder ze kan ophalen)'}. Je hoeft daarvoor geen maandelijkse export op te laden.</div>` : ''}
      ${perf.ignoredFlows.length ? `<div class="notice info">${perf.ignoredFlows.length} storting(en) na ${fmtDate(perf.end)} tellen nog niet mee, omdat er nog geen recentere waardering is.</div>` : ''}
      <div class="card" style="margin-bottom:16px">
        <h2>Portefeuille door de jaren</h2>
        ${investChart(perf)}
      </div>
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
      </div>` : `<div class="notice info">Voor TWR en MWR heeft Helder je stortingen (Rekeningoverzicht) en minstens één portefeuillewaarde nodig.</div>`}
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
      ${soldCard(iv)}
      ${connect}
      ${files.length ? `<div class="card" style="margin-top:16px"><h2>Opgeladen Degiro-bestanden</h2><div class="list">${files.slice().reverse().map(f => `<div class="list-row"><div class="grow">📄 ${esc(f.name)}<div class="small muted">${esc({ portfolio: 'Portefeuille', transactions: 'Transacties', account: 'Rekeningoverzicht' }[f.type] || f.type)}${f.date ? ' — stand op ' + fmtDate(f.date) : ''} · opgeladen ${esc(fmtDateTime(f.importedAt))}</div></div></div>`).join('')}</div></div>` : ''}
      <p style="margin-top:16px">${iv.brokers ? Invest.brokers(iv).map(b => `<button class="btn small danger" data-action="invest-remove-broker" data-id="${esc(b.id)}">Gegevens van ${esc(b.name)} wissen</button> `).join('') : ''}<button class="btn small danger" data-action="degiro-clear">Alle beleggingsgegevens wissen</button></p>`;
  }

  /** Grafiek: portefeuillewaarde (lijn) en totale inleg (trap), met elke bijstorting als punt. */
  let chartData = null;
  /** Verkochte (of deels verkochte) aandelen met gerealiseerde winst of verlies. */
  function soldCard(iv) {
    const r = Invest.realized(iv);
    if (!r.positions.length) {
      return (iv.trades || []).length ? `<div class="card" style="margin-bottom:16px"><h2>Verkochte aandelen</h2><p class="muted">Je hebt nog niets verkocht.</p></div>` : '';
    }
    const qty = v => String(Math.round(v * 10000) / 10000).replace('.', ',');
    return `<div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>Verkochte aandelen</h2>
        <span class="badge ${r.total >= 0 ? 'ok' : 'over'}">${r.total >= 0 ? '▲' : '▼'} gerealiseerd ${money(r.total)}</span></div>
      <p class="small muted">Wat je ooit kocht en (deels) verkocht, met het resultaat van die verkoop: verkoopopbrengst − aankoopprijs, telkens met de transactiekosten inbegrepen. Bij aankopen in schijven rekent Helder met je gemiddelde aankoopprijs.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Periode</th><th class="right">Verkocht</th><th class="right">Aankoopprijs</th><th class="right">Opbrengst</th><th class="right">Winst / verlies</th><th class="right">Dividend</th></tr></thead>
        <tbody>${r.positions.map(p => `<tr>
          <td><strong>${esc(p.name)}</strong><div class="small muted">${esc(p.isin)}${p.closed ? ' · volledig verkocht' : ' · nog ' + qty(p.qty) + ' in bezit'}</div></td>
          <td class="nowrap small">${p.firstBuy ? fmtDate(p.firstBuy) : '?'} → ${fmtDate(p.lastSell)}</td>
          <td class="right">${qty(p.soldQty)}</td>
          <td class="amount">${money(p.costSold)}</td>
          <td class="amount">${money(p.proceeds)}</td>
          <td class="amount ${p.result >= 0 ? 'pos' : 'negv'}"><strong>${p.result >= 0 ? '▲ ' : '▼ '}${money(p.result)}</strong><div class="small">${p.pct != null ? pct(p.pct) : ''}</div></td>
          <td class="amount small">${p.dividends ? money(p.dividends) : '—'}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="5"><strong>Totaal gerealiseerd</strong></td><td class="amount ${r.total >= 0 ? 'pos' : 'negv'}"><strong>${money(r.total)}</strong></td><td class="amount small">${r.totalDividends ? money(r.totalDividends) : '—'}</td></tr></tfoot>
      </table></div></div>`;
  }

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
    return `
      <div class="page-head"><h1>Instellingen</h1></div>
      <div class="grid two">
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
        ${dataFromRow()}
        <div class="card">
          <h2>Account & synchronisatie</h2>
          ${sy.mode === 'local' ? `<p class="small muted">Helder draait nu <strong>lokaal</strong>: je gegevens staan enkel in deze browser. Om Helder op al je toestellen (ook je iPhone) te gebruiken, host je de Helder-server — zie README → <em>Hosten</em>.</p>`
          : `<p>Aangemeld als <strong>${esc((Sync.account && Sync.account.displayName) || sy.user || '')}</strong>${Sync.account && Sync.account.email ? ` <span class="small muted">(${esc(Sync.account.email)}, via Google)</span>` : ''}</p>
            <p class="small muted">${sy.lastSync ? 'Laatst gesynchroniseerd: ' + esc(new Date(sy.lastSync).toLocaleString('nl-BE')) : 'Nog niet gesynchroniseerd'}${sy.pending ? ' · ' + sy.pending + ' wijziging(en) wachten' : ''}</p>
            <p class="btn-row"><button class="btn" data-action="sync-now">Nu synchroniseren</button>${Sync.account && Sync.account.email ? '' : '<button class="btn" data-action="change-password">Wachtwoord wijzigen</button>'}
              <button class="btn" data-action="logout">Afmelden</button><button class="btn danger" data-action="logout-all">Overal afmelden</button></p>
            <p class="small muted">iPhone: open Helder in Safari → deelknop → <em>Zet op beginscherm</em>.</p>
            ${Sync.account && Sync.account.role === 'member' ? `<details class="danger-zone"><summary class="small">Account verwijderen</summary>
              <p class="small">Je account en al je gegevens worden meteen en definitief gewist, ook de back-ups op de server. Download eerst een back-up als je je gegevens wil houden.</p>
              <p class="btn-row"><button class="btn small" data-action="export-json">Back-up downloaden</button><button class="btn small danger" data-action="delete-account">Mijn account verwijderen</button></p></details>` : ''}`}
          <p class="small muted" style="margin-top:12px"><a href="privacy.html" target="_blank" rel="noopener">Privacyverklaring</a> · <a href="voorwaarden.html" target="_blank" rel="noopener">Gebruiksvoorwaarden</a></p>
        </div>
        <div class="card">
          <h2>Rekeningen</h2>
          <div class="list">${state.accounts.map(a => `<div class="list-row"><div class="grow"><strong>${esc(a.name)}</strong><div class="small muted">${a.iban ? esc(C.formatIban(a.iban)) : 'geen IBAN'} · ${state.transactions.filter(t => t.accountId === a.id).length} transacties</div></div>
            <button class="btn small" data-action="edit-account" data-id="${esc(a.id)}">Bewerk</button><button class="btn small danger" data-action="delete-account" data-id="${esc(a.id)}" aria-label="Verwijder">✕</button></div>`).join('')}</div>
          <p class="btn-row"><button class="btn" data-action="new-account">+ Rekening</button></p>
          <p class="small muted">Bankrekeningen worden automatisch aangemaakt bij de eerste import (IBAN uit het bestand). Overschrijvingen tussen je eigen rekeningen tellen nooit als inkomen of uitgave.</p>
        </div>
        <div class="card">
          <h2>Categorieën</h2>
          <div class="list scroll">${state.categories.slice().sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map(c => `<div class="list-row">
            <span class="badge"><span class="dot" style="background:${esc(c.color)}"></span>${esc(C.categoryIcon(c) + ' ' + c.name)}</span>
            <span class="grow small muted">${esc(catKind(c))} · ${catCount[c.id] || 0}</span>
            ${c.id.startsWith('sys_') ? '' : `<button class="btn small" data-action="edit-category" data-id="${esc(c.id)}">Bewerk</button><button class="btn small danger" data-action="delete-category" data-id="${esc(c.id)}" aria-label="Verwijder">✕</button>`}</div>`).join('')}</div>
          <p class="btn-row"><button class="btn" data-action="new-category">+ Uitgavencategorie</button><button class="btn" data-action="new-category" data-kind="income">+ Inkomstenbron</button></p>
        </div>
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
          <h2>Gegevens</h2>
          <p class="btn-row"><button class="btn" data-action="export-json">Back-up downloaden</button><button class="btn" data-action="import-json">Back-up terugzetten</button><button class="btn" data-action="export-csv">Transacties exporteren (CSV)</button></p>
          <p class="btn-row">${demo ? '<button class="btn" data-action="exit-demo">Voorbeeldmodus afsluiten</button>' : '<button class="btn" data-action="enter-demo">Voorbeeldmodus openen</button>'}
            <button class="btn danger" data-action="reset">${demo ? 'Voorbeeld wissen' : 'Alles wissen' + (sy.mode !== 'local' ? ' (alle toestellen)' : '')}</button></p>
          <p class="small muted">De voorbeeldmodus is een aparte zandbak met verzonnen gegevens; je eigen gegevens worden er nooit door aangeraakt.</p>
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
    const fns = { saxoSetup: saxoSetupModal, tx: txModal, rule: ruleModal, budget: budgetModal, account: accountModal, category: categoryModal, import: importModal, lookup: lookupModal, password: passwordModal, degiro: degiroModal, degiroFiles: degiroFilesModal, importView: importViewModal, bankSetup: bankSetupModal, bankConnect: bankConnectModal, person: personModal, advPick: advPickModal };
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
          ${suggestions.map(s => `<option value="${esc(s.tx.id)}" ${t.refundOf === s.tx.id ? 'selected' : ''}>${fmtDate(s.tx.date)} · ${esc(s.tx.counterparty || s.tx.description)} · ${money(s.tx.amount)}</option>`).join('')}
        </select></div>` : ''}

      ${refundedBy.length ? `<div class="section"><h3>Terugbetaald door</h3>${refundedBy.map(r => `<div class="small">${fmtDate(r.date)} · ${esc(r.counterparty || r.description)} · <span class="pos">${money(r.amount)}</span></div>`).join('')}
        <div class="small">Netto kost: <strong>${money(t.amount + refundedBy.reduce((s, r) => s + r.amount, 0))}</strong></div></div>` : ''}

      <label class="field"><span>Notitie</span><textarea id="tx-note" rows="2">${esc(t.note || '')}</textarea></label>
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
    el.innerHTML = `<strong>${m.length}</strong> transactie(s) komen overeen. ` + m.slice(0, 6).map(t => `<div class="muted">${fmtDate(t.date)} · ${esc(t.counterparty)} · ${esc(t.description).slice(0, 50)} · ${money(t.amount)}</div>`).join('');
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
      <ol class="steps">
        <li>Ga naar <a href="https://www.developer.saxo" target="_blank" rel="noopener">developer.saxo</a> en meld je aan met je <strong>Saxo-account</strong>.</li>
        <li>Vraag toegang voor je <strong>echte rekening</strong> (live, persoonlijk gebruik). Saxo vraagt dat je rekening actief is (er staat geld op). Wil je eerst proberen? Kies dan hieronder <em>Simulatie</em> en gebruik een gratis simulatie-account.</li>
        <li>Maak bij <strong>Application management</strong> een nieuwe app:
          <ul><li>Naam: <em>Helder</em></li>
            <li>Redirect URL: <code>${esc(redirect)}</code> <button class="btn small" data-action="copy" data-copy="${esc(redirect)}">Kopieer</button></li>
            <li>Grant type: <strong>Code</strong> (Authorization Code)</li>
            <li>Trading toelaten: <strong>nee</strong> — Helder leest enkel.</li></ul></li>
        <li>Open de app en kopieer de <strong>App Key</strong> en de <strong>App Secret</strong> hieronder.</li>
      </ol>
      <form data-form="saxo-setup" class="form-stack" autocomplete="off">
        <label class="field"><span>Omgeving</span><select name="env">
          <option value="live" ${m.env !== 'sim' ? 'selected' : ''}>Echte rekening (live)</option>
          <option value="sim" ${m.env === 'sim' ? 'selected' : ''}>Simulatie (om te testen)</option></select></label>
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

  function renderAuth() {
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
    const google = g ? `<a class="btn google-btn" href="/api/auth/google">${GOOGLE_ICON}Aanmelden met Google</a>
      <div class="or"><span>of met gebruikersnaam</span></div>` : '';
    return `<div class="auth card"><div class="auth-logo">${LOGO}<span class="wordmark">H€lder</span></div>
      <p class="muted">${a.expired ? 'Je sessie is verlopen. Meld je opnieuw aan.' : 'Meld je aan.'}</p>
      ${google}
      <form data-form="login" class="form-stack">
        <label class="field"><span>Gebruikersnaam</span><input type="text" name="username" autocomplete="username" autocapitalize="none" value="${esc(a.previousUser || '')}" required></label>
        <label class="field"><span>Wachtwoord</span><input type="password" name="password" autocomplete="current-password" required></label>
        <div class="errors">${esc(a.error || '')}</div><button class="btn primary" type="submit">Aanmelden</button></form>
      ${open ? '<p class="small legal-links">Nog geen account? <a href="#" data-action="auth-register"><strong>Maak er een aan</strong></a></p>' : a.auth && a.auth.registration ? '<p class="small muted legal-links">Nieuwe accounts zijn momenteel gesloten.</p>' : ''}
      <p class="small muted app-about">Helder is een gratis app voor je persoonlijke boekhouding: je bankuitgaven en inkomsten overzichtelijk ingedeeld, voorschotten aan vrienden opvolgen en je beleggingen en vermogen door de tijd volgen. Elk account heeft een eigen, afgeschermde boekhouding.</p>
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
    'person-new': () => openModal({ type: 'person', person: { name: '', ibans: [] } }),
    'person-edit': el => { const e = personEntity(el.dataset.person); openModal({ type: 'person', original: el.dataset.person, person: e ? Object.assign({}, e) : { name: el.dataset.person, ibans: [] } }); },
    'person-save': savePerson,
    'person-delete': () => { state.people = (state.people || []).filter(p => p.name.toLowerCase() !== modal.original.toLowerCase()); closeModal(); commit('Persoon verwijderd'); },
    'adv-accept': el => { const t = txById(el.dataset.id); if (!t) return; markAdvance(t, el.dataset.person); commit('Terugbetaling van ' + el.dataset.person + ' gekoppeld'); },
    'adv-pick': el => openModal({ type: 'advPick', person: el.dataset.person, dir: el.dataset.dir, chosen: new Set(), search: '' }),
    'adv-pick-apply': () => {
      const m = modal;
      for (const id of m.chosen) { const t = txById(id); if (t) markAdvance(t, m.person); }
      closeModal();
      commit(`${m.chosen.size} ${m.dir === 'out' ? 'voorschot(ten) voor' : 'terugbetaling(en) van'} ${m.person} gekoppeld`);
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
    'saxo-setup': () => openModal({ type: 'saxoSetup', env: (saxoLink.status && saxoLink.status.env) || 'live' }),
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
    ui.view = VIEWS.includes(view) ? view : 'dashboard';
    ui.list.status = ''; ui.list.limit = 150;
    if (location.hash !== '#' + ui.view) history.replaceState(null, '', '#' + ui.view);
    if (ui.view === 'bank' && !bankLink.status && bankLinkAvailable()) loadBankLink();
    if (ui.view === 'invest' && !saxoLink.status && saxoAvailable()) loadSaxo();
    if (!silent) { render(); window.scrollTo(0, 0); }
  }

  document.addEventListener('click', ev => {
    const nav = ev.target.closest('#nav button, [data-view-link]');
    if (nav) { ev.preventDefault(); go(nav.dataset.view || nav.dataset.viewLink); return; }
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
    if (el.id === 'data-from') { setDataFrom(el.value); return; }
    if (el.dataset.setting) { state.settings = Object.assign({}, state.settings, { [el.dataset.setting]: el.type === 'checkbox' ? el.checked : el.value.trim() }); commit('Instelling bewaard'); return; }
    if (!modal) return;
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
      if (el.id === 'imp-from') { setDataFrom(el.value, true); planImport(); renderModal(); return; }
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
    if (modal.type === 'advPick' && el.dataset.advPick) { if (el.checked) modal.chosen.add(el.dataset.advPick); else modal.chosen.delete(el.dataset.advPick); renderModal(); return; }
    if (modal.type === 'bankConnect' && el.id === 'eb-country') { modal.country = el.value; loadAspsps(); return; }
    if (modal.type === 'degiroFiles') {
      if (el.id === 'dg-files' && el.files.length) loadDegiroFiles(el.files);
      if (el.dataset.dgDate != null) modal.files[Number(el.dataset.dgDate)].date = el.value;
    }
  });

  document.addEventListener('keydown', ev => {
    const el = ev.target;
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
    if (ev.target.dataset && ev.target.dataset.assignInput && picker.input === ev.target) setTimeout(() => { if (picker.input === ev.target && document.activeElement !== ev.target) closePicker(true); }, 120);
  });
  document.addEventListener('mousedown', ev => {
    const opt = ev.target.closest('[data-pick]');
    if (opt) { ev.preventDefault(); choosePick(Number(opt.dataset.pick), false); }
  });
  window.addEventListener('resize', () => { if (picker.input) renderPicker(); });
  window.addEventListener('scroll', () => { if (picker.input) renderPicker(); }, { passive: true });
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && v !== ui.view) { ui.view = v; render(); } });

  document.addEventListener('submit', async ev => {
    const form = ev.target.closest('[data-form]');
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.form === 'degiro') { degiroSubmit(form); return; }
    if (form.dataset.form === 'bank-setup') { bankSetupSubmit(form); return; }
    if (form.dataset.form === 'saxo-setup') { saxoSetupSubmit(form); return; }
    if (form.dataset.form === 'ai-key') { aiKeySubmit(form); return; }
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
