/*
 * Flux — gebruikersinterface.
 *
 * Tabbladen: Overzicht · Bank · Inkomsten · Uitgaven · Beleggingen · Instellingen.
 * Principe: het moet altijd duidelijk zijn wat je aan Flux gaf. Elke transactie heeft een herkomst
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

  const VIEWS = ['dashboard', 'bank', 'income', 'expenses', 'invest', 'settings'];
  const ui = {
    view: VIEWS.includes((location.hash || '').slice(1)) ? location.hash.slice(1) : 'dashboard',
    month: today.slice(0, 7),
    year: today.slice(0, 4),
    period: 'month',
    bank: { account: '', status: 'todo', search: '', limit: 150 },
    list: { status: '', limit: 150 },
    ruleHint: null, // { txId, categoryId } na een inline koppeling: "altijd zo?"
    auth: null,
    sync: { mode: 'local', status: 'idle' }
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
  function inv() { return state.investments && !state.investments.cleared ? state.investments : null; }

  function catBadge(id, suffix) {
    const extra = suffix ? ' ' + esc(suffix) : '';
    if (!id) return `<span class="badge none">Niet gekoppeld${extra}</span>`;
    return `<span class="badge"><span class="dot" style="background:${esc(catColor(id))}"></span>${esc(catName(id))}${extra}</span>`;
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
      html += `<optgroup label="${label}">` + list.map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}${isIncomeCost(c) ? ' (− ' + esc(catName(c.incomeId)) + ')' : ''}</option>`).join('') + '</optgroup>';
    }
    return html;
  }
  function accountOptions(selected, filter) {
    return state.accounts.filter(filter || (() => true)).map(a => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  }
  function amountClass(c) { return c > 0 ? 'pos' : 'neg'; }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
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

  function monthNav() {
    return `<div class="month-nav">
      <button class="btn small" data-action="month" data-delta="-1" aria-label="Vorige maand">‹</button>
      <span class="label">${esc(monthLabel(ui.month))}</span>
      <button class="btn small" data-action="month" data-delta="1" aria-label="Volgende maand">›</button>
      ${ui.month !== today.slice(0, 7) ? '<button class="btn small ghost" data-action="month" data-delta="0">Deze maand</button>' : ''}
    </div>`;
  }

  // ---------- Rendering ----------

  function render() {
    renderSyncBadge();
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
    const todo = todoCount();
    const bankBtn = $('#nav [data-view=bank]');
    if (bankBtn) bankBtn.innerHTML = 'Bank' + (todo ? ` <span class="count">${todo}</span>` : '');
    if (ui.auth) { $('#nav').hidden = true; $('#main').innerHTML = renderAuth(); return; }
    $('#nav').hidden = false;
    const views = { dashboard: renderDashboard, bank: renderBank, income: renderIncome, expenses: renderExpenses, invest: renderInvest, settings: renderSettings };
    const banner = demo ? `<div class="demo-banner">🧪 <strong>Voorbeeldmodus.</strong> Verzonnen gegevens om Flux te leren kennen — volledig los van je eigen gegevens, niet gesynchroniseerd.
      <button class="btn small" data-action="exit-demo">Voorbeeld afsluiten</button></div>` : '';
    $('#main').innerHTML = banner + (views[ui.view] || renderDashboard)();
    afterRender();
  }

  function todoCount() { return state.transactions.filter(t => kindOf(t) === 'todo').length; }

  // ----- Overzicht -----

  function renderDashboard() {
    if (!state.transactions.length && !inv()) {
      return `<div class="page-head"><h1>Welkom bij Flux</h1></div>
        <div class="card empty-state">
          <p><strong>Flux is leeg.</strong> Je begint door de rekeninguittreksels van je bank op te laden in het tabblad <strong>Bank</strong>.<br>
            Elk bestand wordt één keer opgeladen; je ziet altijd welk bestand welke transacties aanbracht.</p>
          <button class="btn primary" data-action="import">Bankbestand opladen</button>
          <button class="btn" data-action="new-tx">Manuele transactie (bv. cash)</button>
          <button class="btn" data-action="goto" data-view="invest">Degiro koppelen</button>
          <p class="small muted" style="margin-top:16px">Eerst eens rondkijken? <a href="#" data-action="enter-demo">Open de voorbeeldmodus</a> — die staat volledig los van je eigen gegevens.</p>
        </div>`;
    }
    const lines = C.allocations(state);
    const range = C.periodRange('monthly', ui.month + '-01');
    const sum = C.summarize(state, range, lines);
    const refDate = ui.month === today.slice(0, 7) ? today : range.end;
    const todo = todoCount();
    const adv = C.advancesOverview(state);
    const budgets = state.budgets.map(b => C.budgetStatus(state, b, refDate, lines)).filter(b => b.status !== 'ok');
    const upcoming = C.detectRecurring(state, today).filter(r => r.userStatus !== 'ignored' && r.status !== 'gestopt' && r.daysUntil >= -7 && r.daysUntil <= 30);
    const balances = state.accounts.map(a => ({ a, b: C.accountBalance(state, a.id) })).filter(x => x.b);
    const bankTotal = balances.reduce((s, x) => s + x.b.amount, 0);
    const invSum = inv() ? Invest.summary(inv()) : null;
    const open = adv.people.filter(p => p.open !== 0);

    return `
      <div class="page-head"><h1>Overzicht</h1><span class="spacer"></span>${monthNav()}</div>
      ${todo ? `<div class="notice info"><a href="#" data-action="goto" data-view="bank">📥 ${todo} transactie(s) wachten om gekoppeld te worden</a> aan een inkomst, uitgave, voorschot, belegging of eigen rekening.</div>` : ''}
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Netto inkomsten</div><div class="value pos">${money(sum.netIncome)}</div>
          <div class="hint">bruto ${money(sum.income)}${sum.incomeCosts ? ' − kosten ' + money(sum.incomeCosts) : ''}</div></div>
        <div class="card kpi"><div class="label">Uitgaven</div><div class="value">${money(sum.expenses)}</div><div class="hint">na terugbetalingen</div></div>
        <div class="card kpi"><div class="label">Over deze maand</div><div class="value ${sum.net >= 0 ? 'pos' : ''}">${money(sum.net)}</div>
          <div class="hint">${sum.net < 0 ? 'meer uitgegeven dan verdiend' : sum.netIncome ? Math.round(sum.net / sum.netIncome * 100) + '% van je netto inkomen' : ''}</div></div>
        <div class="card kpi"><div class="label">Belegd deze maand</div><div class="value">${money(sum.invested)}</div><div class="hint">naar je beleggingsrekening</div></div>
      </div>
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
              <div class="grow">${esc(id === '__none__' ? 'Nog niet gekoppeld' : catName(id))}<div class="small muted">bruto ${money(v.gross)}${v.costs ? ' − kosten ' + money(v.costs) : ''}</div></div>
              <span class="amount">${money(v.net)}</span></div>`).join('') + '</div>' : '<p class="muted">Geen inkomsten deze maand.</p>'}
        </div>
        <div class="card">
          <h2>Voorschotten</h2>
          ${open.length ? '<div class="list">' + open.map(p => `<div class="list-row"><div class="grow">${esc(p.person)}<div class="small muted">voorgeschoten ${money(p.advanced)} · terug ${money(p.repaid)}</div></div><span class="amount">${p.open > 0 ? money(p.open) + ' open' : money(-p.open) + ' te veel'}</span></div>`).join('') + '</div>'
            : '<p class="muted">Niemand is je nog iets schuldig.</p>'}
        </div>
        <div class="card">
          <h2>Aandacht</h2>
          <div class="list">
            ${budgets.map(b => `<div class="list-row"><div class="grow">Budget ${esc(catName(b.budget.categoryId))}</div><span class="badge ${b.status}">${b.status === 'over' ? 'overschreden' : 'bijna op'} · ${Math.round(b.pct * 100)}%</span></div>`).join('')}
            ${upcoming.map(r => `<div class="list-row"><div class="grow">🔁 ${esc(r.name)}<div class="small muted">${esc(r.frequency.label)} · ${r.daysUntil < 0 ? -r.daysUntil + ' d te laat' : r.daysUntil === 0 ? 'vandaag' : 'over ' + r.daysUntil + ' d'}</div></div><span class="amount">${r.fixed ? '' : '± '}${money(r.expected)}</span></div>`).join('')}
            ${!budgets.length && !upcoming.length ? '<p class="muted">Niets bijzonders.</p>' : ''}
          </div>
        </div>
      </div>`;
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
      if (!`${t.counterparty} ${t.description} ${t.note || ''} ${C.centsToInput(t.amount)}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  /** Eén keuzelijst om een transactie te koppelen aan wat ze is. */
  function assignSelect(t) {
    const k = kindOf(t);
    if (k === 'split' || k === 'refund' || (t.splits && t.splits.length)) return `<button class="btn small" data-action="edit-tx" data-id="${esc(t.id)}">${k === 'refund' ? '↩ Terugbetaling' : '✂ Gesplitst'} — bekijk</button>`;
    const val = t.isTransfer ? 'transfer' : t.categoryId ? 'cat:' + t.categoryId : '';
    const opt = (v, l) => `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`;
    const cats = kind => state.categories.filter(c => c.kind === kind).sort((a, b) => a.name.localeCompare(b.name))
      .map(c => opt('cat:' + c.id, esc(c.name) + (isIncomeCost(c) ? ' (− ' + esc(catName(c.incomeId)) + ')' : ''))).join('');
    const incoming = t.amount > 0;
    return `<select class="assign" data-assign="${esc(t.id)}" aria-label="Koppelen">
      ${opt('', '— Te verwerken —')}
      <optgroup label="${incoming ? 'Inkomst' : 'Uitgave'}">${cats(incoming ? 'income' : 'expense')}</optgroup>
      <optgroup label="Speciaal">
        ${opt('cat:' + C.SYS_ADVANCE, incoming ? '↙ Terugbetaling van een voorschot…' : '↗ Voorgeschoten voor iemand…')}
        ${incoming ? opt('refund', '↩ Terugbetaling van een uitgave…') : ''}
        ${opt('cat:' + C.SYS_INVEST, '📈 Belegging (storting/opname)')}
        ${opt('transfer', '↔ Naar/van eigen rekening')}
        ${opt('split', '✂ Opsplitsen…')}
      </optgroup>
      <optgroup label="${incoming ? 'Toch een uitgave (bv. teruggestort)' : 'Toch een inkomst'}">${cats(incoming ? 'expense' : 'income')}</optgroup>
    </select>`;
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
    return `<tr class="${k === 'todo' ? 'is-todo' : ''} ${t.isTransfer ? 'is-transfer' : ''}">
      <td class="nowrap">${fmtDate(t.date)}${opts.showAccount ? `<div class="small muted">${esc(accName(t.accountId))}</div>` : ''}</td>
      <td class="clickable" data-action="edit-tx" data-id="${esc(t.id)}"><div>${esc(t.counterparty || '—')}</div><div class="desc" title="${esc(t.description)}">${esc(t.description)}</div>
        <div class="badge-row">${opts.showKind ? kindBadge(k) : ''}${extra.join('')}${opts.showSource ? sourceBadge(t) : ''}</div></td>
      <td class="amount ${amountClass(t.amount)}">${money(t.amount)}</td>
      <td class="assign-cell">${assignSelect(t)}${hint ? `<div><button class="btn small ghost" data-action="rule-hint" data-id="${esc(t.id)}">⚙ Altijd zo voor “${esc((t.counterparty || t.description).slice(0, 28))}”</button></div>` : ''}</td>
    </tr>`;
  }

  function txTable(list, opts) {
    if (!list.length) return `<div class="card empty-state">${opts && opts.empty || 'Geen transacties.'}</div>`;
    const lim = (opts && opts.limit) || 150;
    return `<div class="table-wrap"><table class="tx-table">
      <thead><tr><th>Datum</th><th>Omschrijving</th><th class="right">Bedrag</th><th>Gekoppeld aan</th></tr></thead>
      <tbody>${list.slice(0, lim).map(t => txRow(t, opts)).join('')}</tbody></table></div>
      ${list.length > lim ? `<p style="text-align:center"><button class="btn" data-action="more" data-key="${opts && opts.moreKey || 'list'}">Toon meer (${list.length - lim})</button></p>` : ''}`;
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
      <p class="muted">Laad de CSV-export van je bank op (KBC/CBC en Argenta worden automatisch herkend). Elk bestand kan maar één keer opgeladen worden,
        en transacties die al in Flux zitten worden overgeslagen. Koppel daarna elke transactie aan wat ze is.</p>
      <div class="grid cards" style="margin-bottom:16px">${cards}</div>

      <div class="card" style="margin-bottom:16px">
        <h2>Opgeladen bestanden</h2>
        ${imports.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Bestand</th><th>Rekening</th><th>Periode</th><th class="right">Toegevoegd</th><th class="right">Overgeslagen</th><th>Opgeladen</th><th></th></tr></thead>
          <tbody>${imports.map(i => `<tr>
            <td>📄 <strong>${esc(i.fileName)}</strong><div class="small muted">${esc(i.bankName || i.bank)}</div></td>
            <td>${esc(accName(i.accountId))}</td>
            <td class="nowrap">${i.period ? fmtDate(i.period.from) + ' – ' + fmtDate(i.period.to) : '—'}</td>
            <td class="right">${state.transactions.filter(t => t.importId === i.id).length}</td>
            <td class="right small muted" title="Rijen die al in Flux zaten">${i.duplicates || 0} dubbel${i.errors ? ` · ${i.errors} ongeldig` : ''}</td>
            <td class="nowrap small">${esc(fmtDateTime(i.importedAt))}</td>
            <td class="nowrap right"><button class="btn small" data-action="show-import" data-id="${esc(i.id)}">Bekijk</button>
              <button class="btn small danger" data-action="undo-import" data-id="${esc(i.id)}">Ongedaan maken</button></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nog geen bestanden opgeladen.</p>'}
      </div>

      <h2>Transacties${f.account ? ' — ' + esc(accName(f.account)) : ''}</h2>
      <div class="filters">
        <div class="seg">
          ${[['todo', `Te verwerken (${todo})`], ['done', 'Verwerkt'], ['', 'Alles']].map(([v, l]) => `<button class="${f.status === v ? 'active' : ''}" data-action="bank-status" data-status="${v}">${l}</button>`).join('')}
        </div>
        <select data-filter="bank.account"><option value="">Alle rekeningen</option>${accountOptions(f.account)}</select>
        <input type="search" placeholder="Zoeken…" data-filter="bank.search" value="${esc(f.search)}">
      </div>
      ${txTable(all, { showKind: true, showSource: true, showAccount: !f.account, limit: f.limit, moreKey: 'bank', empty: f.status === 'todo' ? '🎉 Alles is verwerkt.' : 'Geen transacties.' })}`;
  }

  // ----- Inkomsten -----

  function recurringMap(direction) {
    const out = {};
    for (const r of C.detectRecurring(state, today, { direction }).filter(r => r.userStatus !== 'ignored')) for (const id of r.txIds) out[id] = r;
    return out;
  }
  function periodToggle() {
    return `<div class="seg">${[['month', 'Maand'], ['year', 'Jaar']].map(([v, l]) => `<button class="${ui.period === v ? 'active' : ''}" data-action="period" data-period="${v}">${l}</button>`).join('')}</div>`;
  }
  function currentRange() {
    return ui.period === 'year' ? C.periodRange('yearly', ui.year + '-01-01') : C.periodRange('monthly', ui.month + '-01');
  }
  function yearSelect() {
    const years = Array.from(new Set(state.transactions.map(t => t.date.slice(0, 4)).concat([today.slice(0, 4)]))).sort().reverse();
    return `<select data-ui="year">${years.map(y => `<option ${y === ui.year ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
  }
  function periodNav() { return (ui.period === 'year' ? yearSelect() : monthNav()) + periodToggle(); }

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
        <div class="budget-card"><div class="top"><span class="name"><span class="dot-lg" style="background:${esc(catColor(id === '__none__' ? null : id))}"></span> ${esc(id === '__none__' ? 'Nog niet gekoppeld' : catName(id))}</span>
          <span class="amount pos">${money(v.net)}</span></div></div>
        <table class="mini">
          <tr><td>Bruto</td><td class="amount">${money(v.gross)}</td></tr>
          ${Object.entries(v.costsByCategory).map(([cid, a]) => `<tr><td>− ${esc(catName(cid))}</td><td class="amount">${money(-a)}</td></tr>`).join('')}
          <tr class="total"><td>Netto</td><td class="amount">${money(v.net)}</td></tr>
        </table>
        ${exp.length ? `<div class="small" style="margin-top:6px">🔁 Verwacht: ${exp.map(r => `${money(r.expected)} op ${fmtDate(r.nextDue)}`).join(', ')}</div>` : ''}
        ${id !== '__none__' ? `<div class="small muted" style="margin-top:6px">${linked.length ? 'Kosten: ' + linked.map(c => esc(c.name)).join(', ') : `<a href="#" data-action="new-cost-category" data-id="${esc(id)}">+ kostcategorie voor deze bron</a>`}</div>` : ''}
      </div>`;
    }).join('');

    return `
      <div class="page-head"><h1>Inkomsten</h1><span class="spacer"></span>${periodNav()}
        <button class="btn" data-action="new-category" data-kind="income">+ Inkomstenbron</button></div>
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Bruto</div><div class="value">${money(sum.income)}</div></div>
        <div class="card kpi"><div class="label">Kosten op inkomsten</div><div class="value">${money(sum.incomeCosts)}</div><div class="hint">afgetrokken van de bron waar ze bij horen</div></div>
        <div class="card kpi"><div class="label">Netto</div><div class="value pos">${money(sum.netIncome)}</div></div>
        <div class="card kpi"><div class="label">Terug van vrienden</div><div class="value">${money(sum.repaid)}</div><div class="hint">telt niet als inkomen${adv.totalOpen > 0 ? ' · nog ' + money(adv.totalOpen) + ' open' : ''}</div></div>
      </div>
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
      <div class="page-head"><h1>Uitgaven</h1><span class="spacer"></span>${periodNav()}
        <button class="btn" data-action="new-tx">+ Cash-uitgave</button></div>
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Uitgaven</div><div class="value">${money(sum.expenses)}</div><div class="hint">na terugbetalingen</div></div>
        <div class="card kpi"><div class="label">Vaste lasten per maand</div><div class="value">${money(monthlyFixed)}</div><div class="hint">${recurring.length} automatisch herkend</div></div>
        <div class="card kpi"><div class="label">Voorgeschoten</div><div class="value">${money(sum.advanced)}</div><div class="hint">voor anderen — geen uitgave</div></div>
        <div class="card kpi"><div class="label">Kosten op inkomsten</div><div class="value">${money(sum.incomeCosts)}</div><div class="hint">zie Inkomsten</div></div>
      </div>
      <div class="grid two" style="margin-bottom:16px">
        <div class="card">
          <h2>Per categorie</h2>
          ${cats.length ? cats.map(c => `<div class="catbar"><span class="name">${esc(c.id ? catName(c.id) : 'Nog niet gekoppeld')}</span>
            <span class="track"><span class="fill" style="display:block;width:${(c.v / maxCat * 100).toFixed(1)}%;background:${esc(catColor(c.id))}"></span></span>
            <span class="amount">${money(c.v)}</span></div>`).join('') : '<p class="muted">Geen uitgaven in deze periode.</p>'}
        </div>
        <div class="card">
          <div class="card-head"><h2>Budgetten</h2><button class="btn small" data-action="new-budget">+ Budget</button></div>
          ${budgets.length ? budgets.map(st => {
            const p = Math.min(st.pct, 1) * 100;
            return `<div class="budget-line"><div class="row"><span>${esc(catName(st.budget.categoryId))} <span class="small muted">${st.budget.period === 'yearly' ? 'jaar' : 'maand'}</span></span>
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
    <p class="small muted">Menunamen kunnen licht verschillen per taal of app-versie. Flux herkent zelf welk soort bestand je oplaadt; hetzelfde bestand twee keer opladen voegt niets dubbel toe.</p>`;

  function renderInvest() {
    const iv = inv();
    const server = Sync && Sync.mode === 'server' && !demo;
    const connect = `<div class="card">
        <h2>Gegevens ophalen</h2>
        <div class="grid two" style="gap:12px">
          <div class="section">
            <h3>Rechtstreeks uit Degiro</h3>
            ${server ? `<p class="small muted">Log in met je Degiro-gegevens; Flux haalt portefeuille, transacties en rekeningoverzicht op. <strong>Wachtwoord en 2FA-code worden niet bewaard</strong> — je logt telkens opnieuw in.</p>
              <button class="btn primary" data-action="degiro-connect">Ophalen uit Degiro…</button>
              <p class="small muted">Elke keer ophalen voegt een waarderingspunt toe aan de grafiek. Historische standen levert Degiro niet via deze weg: gebruik voor vroegere jaren de portefeuille-export per 31/12.</p>`
              : `<p class="small muted">Kan enkel als Flux op je eigen server draait (zie README → Hosten)${demo ? ', en niet in de voorbeeldmodus' : ''}. Gebruik intussen de exportbestanden.</p>`}
          </div>
          <div class="section">
            <h3>Met exportbestanden</h3>
            <p class="small muted">Laad één of meer Degiro-exports op (CSV). Flux herkent zelf welk bestand het is.</p>
            <button class="btn" data-action="degiro-files">Exportbestanden opladen…</button>
            <details style="margin-top:8px"><summary class="small"><strong>Wat moet ik exact exporteren?</strong></summary>${DEGIRO_EXPORT_HELP}</details>
          </div>
        </div>
      </div>`;
    if (!iv) {
      return `<div class="page-head"><h1>Beleggingen</h1></div>
        <p class="muted">Koppel je Degiro-rekening om je portefeuille, je stortingen en je rendement (TWR en MWR) te zien. Overschrijvingen van je bank naar Degiro tellen in Flux als <em>belegging</em>, niet als uitgave.</p>
        ${connect}
        <div class="card" style="margin-top:16px"><h2>Wat moet ik exporteren uit Degiro?</h2>${DEGIRO_EXPORT_HELP}</div>`;
    }
    const s = Invest.summary(iv);
    const perf = Invest.performance(iv);
    const files = iv.files || [];
    return `
      <div class="page-head"><h1>Beleggingen</h1><span class="spacer"></span>
        <span class="small muted">Bron: ${iv.source === 'degiro-api' ? 'Degiro (rechtstreeks)' : iv.source === 'demo' ? 'voorbeeld' : 'Degiro-exports'} · bijgewerkt ${esc(fmtDateTime(iv.syncedAt))}</span></div>
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
      ${perf.missingYearEnds.length ? `<div class="notice">Voor een exact rendement per jaar ontbreekt de portefeuillewaarde op <strong>${Array.from(new Set(perf.missingYearEnds)).map(fmtDate).join(', ')}</strong>.
        Exporteer in Degiro je <em>Portefeuille</em> op die datum en laad ze op met die datum. Tot dan is de TWR over die periode benaderd.</div>` : ''}
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
            <td><strong>${y.year}</strong>${y.partial ? ` <span class="small muted">t.e.m. ${fmtDate(y.endDate)}</span>` : ''}</td>
            <td class="amount">${y.startValue != null ? money(y.startValue) : '—'}</td>
            <td class="amount">${money(y.deposits)}</td>
            <td class="amount">${y.withdrawals ? money(y.withdrawals) : '—'}</td>
            <td class="amount">${y.endValue != null ? money(y.endValue) : '—'}</td>
            ${y.missing.length ? `<td colspan="3" class="small muted">ontbreekt: portefeuille op ${y.missing.map(fmtDate).join(' en ')}</td>`
              : `<td class="amount ${y.result >= 0 ? 'pos' : 'negv'}">${money(y.result)}</td><td class="amount">${pct(y.twr)}</td><td class="amount">${pct(y.mwr)}</td>`}
            <td class="amount">${money(y.dividends)}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted"><strong>Resultaat</strong> = eindwaarde − beginwaarde − netto stortingen. <strong>TWR</strong> meet hoe goed je beleggingen het deden (vergelijk met een index).
          <strong>MWR</strong> is jouw eigen rendement: stortte je vlak voor een daling, dan is je MWR lager dan je TWR. Voor het lopende jaar: rendement tot nu, niet op jaarbasis.</p>
      </div>` : `<div class="notice info">Voor TWR en MWR heeft Flux je stortingen (Rekeningoverzicht) en minstens één portefeuillewaarde nodig.</div>`}
      <div class="card" style="margin-bottom:16px">
        <h2>Posities</h2>
        ${s.positions.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Product</th><th class="right">Aantal</th><th class="right">Waarde</th><th class="right">Aankoop</th><th class="right">Winst</th><th>Aandeel</th></tr></thead>
          <tbody>${s.positions.map(p => `<tr>
            <td><strong>${esc(p.name)}</strong><div class="small muted">${esc(p.isin)}${p.currency !== 'EUR' ? ' · ' + esc(p.currency) : ''}</div></td>
            <td class="right">${String(p.quantity).replace('.', ',')}</td>
            <td class="amount">${money(p.valueEur)}</td>
            <td class="amount">${p.costEur != null ? money(p.costEur) : '—'}</td>
            <td class="amount ${p.gainEur >= 0 ? 'pos' : 'negv'}">${p.gainEur != null ? money(p.gainEur) + `<div class="small">${p.costEur ? pct(p.gainEur / p.costEur) : ''}</div>` : '—'}</td>
            <td style="min-width:90px"><div class="track"><span class="fill" style="display:block;width:${(p.share * 100).toFixed(1)}%;background:var(--series-1)"></span></div><span class="small muted">${(p.share * 100).toFixed(1).replace('.', ',')}%</span></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Geen posities.</p>'}
      </div>
      ${connect}
      ${files.length ? `<div class="card" style="margin-top:16px"><h2>Opgeladen Degiro-bestanden</h2><div class="list">${files.slice().reverse().map(f => `<div class="list-row"><div class="grow">📄 ${esc(f.name)}<div class="small muted">${esc({ portfolio: 'Portefeuille', transactions: 'Transacties', account: 'Rekeningoverzicht' }[f.type] || f.type)}${f.date ? ' — stand op ' + fmtDate(f.date) : ''} · opgeladen ${esc(fmtDateTime(f.importedAt))}</div></div></div>`).join('')}</div></div>` : ''}
      <p style="margin-top:16px"><button class="btn small danger" data-action="degiro-clear">Alle beleggingsgegevens wissen</button></p>`;
  }

  /** Grafiek: portefeuillewaarde (lijn) en totale inleg (trap), met elke bijstorting als punt. */
  let chartData = null;
  function investChart(perf) {
    const vals = Invest.valuations(inv()).filter(v => v.date >= perf.start);
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
        <span><i class="sw dot s2"></i>Bijstorting</span><span><i class="sw dot hollow"></i>Opname</span></div>
      <div class="chart-wrap" id="invest-chart">
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Waarde van je portefeuille en je totale inleg door de tijd">
          ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`).join('')}
          ${years.map(d => `<line x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${H - B}" class="grid-line"/><text x="${x(d)}" y="${H - 10}" text-anchor="middle">${d.slice(0, 4)}</text>`).join('')}
          <path d="${stepPath}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round"/>
          <path d="${valuePath}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round"/>
          ${steps.slice(1).map(d => `<circle cx="${x(d.date)}" cy="${y(d.value)}" r="4" class="${d.flow > 0 ? 'dep' : 'wd'}"><title>${fmtDate(d.date)}: ${d.flow > 0 ? 'storting' : 'opname'} ${money(Math.abs(d.flow))}</title></circle>`).join('')}
          <text x="${W - R + 8}" y="${(apart && yLast > yCum ? yLast + 10 : yLast) + 4}" class="direct">${compact(lastVal.value)}</text>
          <text x="${W - R + 8}" y="${(apart && yCum >= yLast ? yCum + 10 : yCum) + 4}" class="direct muted-fill">${compact(cum)}${narrow ? '' : ' inleg'}</text>
          <line class="crosshair" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>
        </svg>
        <div class="chart-tip" hidden></div>
      </div>
      <details><summary class="small">Toon als tabel</summary>
        <div class="table-wrap"><table><thead><tr><th>Datum</th><th class="right">Waarde</th><th class="right">Inleg tot dan</th><th class="right">Winst</th></tr></thead>
        <tbody>${vals.map(v => { const inl = inlegOn(v.date); return `<tr><td>${fmtDate(v.date)}</td><td class="amount">${money(v.value)}</td><td class="amount">${money(inl)}</td><td class="amount">${money(v.value - inl)}</td></tr>`; }).join('')}</tbody></table></div>
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
    tip.innerHTML = `<strong>${fmtDate(best.date)}</strong><br>Waarde: ${money(best.value)}<br>Inleg: ${money(inl)}<br>Winst: ${money(best.value - inl)}${near.length ? '<hr>' + near.map(f => (f.amount > 0 ? 'Storting ' : 'Opname ') + money(Math.abs(f.amount)) + ' · ' + fmtDate(f.date)).join('<br>') : ''}`;
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
    const wrap = $('#invest-chart');
    if (wrap) {
      wrap.addEventListener('mousemove', onChartMove);
      wrap.addEventListener('mouseleave', onChartLeave);
      wrap.addEventListener('touchmove', e => { if (e.touches[0]) onChartMove(e.touches[0]); }, { passive: true });
      wrap.addEventListener('touchstart', e => { if (e.touches[0]) onChartMove(e.touches[0]); }, { passive: true });
    }
  }

  // ----- Instellingen -----

  function renderSettings() {
    const sy = ui.sync;
    const st = state.settings;
    const aiOn = !!(Sync && Sync.features && Sync.features.ai);
    const catCount = {};
    for (const t of state.transactions) for (const l of C.splitLines(t)) if (l.categoryId) catCount[l.categoryId] = (catCount[l.categoryId] || 0) + 1;
    const catKind = c => c.kind === 'income' ? 'inkomstenbron' : isIncomeCost(c) ? 'kost op ' + catName(c.incomeId) : c.kind === 'advance' ? 'systeem: voorschotten' : c.kind === 'investment' ? 'systeem: beleggingen' : 'uitgaven';
    const order = c => c.kind === 'income' ? 0 : isIncomeCost(c) ? 1 : c.kind === 'expense' ? 2 : 3;
    const manual = state.transactions.filter(t => t.source !== 'import').length;
    const rules = C.sortedRules(state.rules);
    const ruleCount = {};
    for (const t of state.transactions) if (t.ruleId) ruleCount[t.ruleId] = (ruleCount[t.ruleId] || 0) + 1;
    return `
      <div class="page-head"><h1>Instellingen</h1></div>
      <div class="grid two">
        <div class="card">
          <h2>Wat zit er in Flux?</h2>
          <div class="list">
            ${(state.imports || []).map(i => `<div class="list-row"><div class="grow">📄 ${esc(i.fileName)}<div class="small muted">${esc(accName(i.accountId))} · ${esc(fmtDateTime(i.importedAt))}</div></div><span>${state.transactions.filter(t => t.importId === i.id).length}</span></div>`).join('')}
            <div class="list-row"><div class="grow">✎ Manueel ingevoerd</div><span>${manual}</span></div>
            ${inv() ? `<div class="list-row"><div class="grow">📈 Degiro</div><span class="small">${(inv().files || []).length} bestand(en)${inv().source === 'degiro-api' ? ' · rechtstreeks' : ''}</span></div>` : ''}
            <div class="list-row total"><div class="grow"><strong>Totaal transacties</strong></div><span>${state.transactions.length}</span></div>
          </div>
          <p class="small muted">Bestanden bekijken of ongedaan maken doe je in het tabblad Bank.</p>
        </div>
        <div class="card">
          <h2>Account & synchronisatie</h2>
          ${sy.mode === 'local' ? `<p class="small muted">Flux draait nu <strong>lokaal</strong>: je gegevens staan enkel in deze browser. Om Flux op al je toestellen (ook je iPhone) te gebruiken, host je de Flux-server — zie README → <em>Hosten</em>.</p>`
          : `<p>Aangemeld als <strong>${esc(sy.user || '')}</strong></p>
            <p class="small muted">${sy.lastSync ? 'Laatst gesynchroniseerd: ' + esc(new Date(sy.lastSync).toLocaleString('nl-BE')) : 'Nog niet gesynchroniseerd'}${sy.pending ? ' · ' + sy.pending + ' wijziging(en) wachten' : ''}</p>
            <p class="btn-row"><button class="btn" data-action="sync-now">Nu synchroniseren</button><button class="btn" data-action="change-password">Wachtwoord wijzigen</button>
              <button class="btn" data-action="logout">Afmelden</button><button class="btn danger" data-action="logout-all">Overal afmelden</button></p>
            <p class="small muted">iPhone: open Flux in Safari → deelknop → <em>Zet op beginscherm</em>.</p>`}
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
            <span class="badge"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</span>
            <span class="grow small muted">${esc(catKind(c))} · ${catCount[c.id] || 0}</span>
            ${c.id.startsWith('sys_') ? '' : `<button class="btn small" data-action="edit-category" data-id="${esc(c.id)}">Bewerk</button><button class="btn small danger" data-action="delete-category" data-id="${esc(c.id)}" aria-label="Verwijder">✕</button>`}</div>`).join('')}</div>
          <p class="btn-row"><button class="btn" data-action="new-category">+ Uitgavencategorie</button><button class="btn" data-action="new-category" data-kind="income">+ Inkomstenbron</button></p>
        </div>
        <div class="card">
          <h2>Automatische regels</h2>
          <p class="small muted">Regels koppelen nieuwe transacties vanzelf. Je maakt ze het makkelijkst met <em>⚙ Altijd zo</em> nadat je een transactie koppelde. De bovenste regel die past wint; manuele koppelingen worden nooit overschreven.</p>
          ${rules.length ? `<div class="list scroll">${rules.map((r, i) => `<div class="list-row" style="${r.enabled === false ? 'opacity:.5' : ''}">
            <div class="grow"><strong>${esc(r.name)}</strong> → ${catBadge(r.categoryId)}<div class="small muted">${esc(C.RULE_FIELDS[r.field])} ${esc(C.RULE_OPERATORS[r.operator])} “${esc(r.value)}” · ${ruleCount[r.id] || 0} treffers</div></div>
            <button class="btn small ghost" data-action="rule-up" data-id="${esc(r.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Hoger">▲</button>
            <button class="btn small" data-action="edit-rule" data-id="${esc(r.id)}">Bewerk</button><button class="btn small danger" data-action="delete-rule" data-id="${esc(r.id)}" aria-label="Verwijder">✕</button></div>`).join('')}</div>` : '<p class="muted">Nog geen regels.</p>'}
          <p class="btn-row"><button class="btn" data-action="new-rule">+ Regel</button></p>
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
            <label class="field full"><span>Herkenning beleggingsrekening (naam of mededeling, regex)</span><input type="text" data-setting="investPattern" value="${esc(st.investPattern || 'degiro|flatex')}"></label>
          </div>
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
    const fns = { tx: txModal, rule: ruleModal, budget: budgetModal, account: accountModal, category: categoryModal, import: importModal, lookup: lookupModal, password: passwordModal, degiro: degiroModal, degiroFiles: degiroFilesModal, importView: importViewModal };
    const bd = $('.modal-backdrop', root);
    const scroll = bd ? bd.scrollTop : 0;
    root.innerHTML = fns[modal.type]();
    if (modal.focused) { const b = $('.modal-backdrop', root); if (b) b.scrollTop = scroll; }
    else {
      modal.focused = true;
      const first = $('.modal-body input:not([type=file]), .modal-body select', root);
      if (first && !['tx', 'lookup', 'importView', 'import'].includes(modal.type)) first.focus();
    }
    if (modal.type === 'tx') { updateSplitRemaining(); updateTxSections(); }
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
      <div class="form-grid">
        <label class="field"><span>Datum</span><input type="date" id="tx-date" value="${esc(t.date)}" required></label>
        <label class="field"><span>Bedrag (− = uitgave)</span><input type="text" inputmode="decimal" id="tx-amount" value="${t.amount ? esc((t.amount < 0 ? '-' : '') + C.centsToInput(t.amount)) : ''}" placeholder="-12,50"></label>
        <label class="field"><span>Rekening</span><select id="tx-account">${accountOptions(t.accountId)}</select></label>
        <label class="field"><span>Tegenpartij</span><input type="text" id="tx-counterparty" value="${esc(t.counterparty)}"></label>
        <label class="field full"><span>Mededeling</span><input type="text" id="tx-description" value="${esc(t.description)}"></label>
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
    if (newCat === C.SYS_ADVANCE) t.person = person || (linked ? linked.person : ''); else delete t.person;
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
      accountId: $('#rule-account').value || null, enabled: $('#rule-enabled').checked
    });
  }
  function updateRulePreview() {
    const el = $('#rule-preview');
    if (!el) return;
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
      <p class="small muted full">${bal ? 'Huidig saldo volgens Flux: <strong>' + money(bal.amount) + '</strong>. ' : ''}Bij KBC-bestanden wordt het saldo automatisch uit de saldokolom gehaald; bij Argenta geef je het hier één keer in.</p>
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
    if (kind === 'incomeCost') updated.incomeId = $('#cat-income').value; else delete updated.incomeId;
    const idx = state.categories.findIndex(x => x.id === c.id);
    if (idx >= 0) state.categories[idx] = updated; else state.categories.push(updated);
    closeModal();
    commit('Categorie opgeslagen');
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
          <p class="muted">Overlappende periodes zijn geen probleem: transacties die al in Flux zitten worden overgeslagen.</p></details>
        <label class="field"><span>Bestand</span><input type="file" id="imp-file" accept=".csv,.txt,text/csv"></label>
        <div class="errors" id="imp-errors"></div>`, '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>');
    }
    const blocked = m.parts.every(p => p.plan.sameFile);
    const body = `
      <p class="small muted">📄 <strong>${esc(m.fileName)}</strong> · ${m.parsed.profile ? 'herkend als <strong>' + esc(m.parsed.profile.name) + '</strong>' : '<strong>onbekend formaat</strong> — duid de kolommen aan'} · ${m.parsed.rowCount} rijen${m.parsed.errors.length ? ` · ${m.parsed.errors.length} ongeldige rij(en) (rij ${m.parsed.errors.slice(0, 5).join(', ')}${m.parsed.errors.length > 5 ? '…' : ''})` : ''}</p>
      ${!m.parsed.profile ? mappingFields() : ''}
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
              : `<label class="field full"><span>Rekening in Flux${a && p.accountIban ? ' (herkend op IBAN)' : ''}</span><select data-part-account="${i}" ${a && p.accountIban ? 'disabled' : ''}><option value="">— Kies —</option>${accountOptions(p.accountId, x => x.type !== 'cash')}<option value="__new__">+ Nieuwe rekening…</option></select></label>`}
          </div>
          <div class="import-summary">
            <div><strong>${p.plan.fresh.length}</strong><span>nieuw</span></div>
            <div><strong>${p.plan.duplicates.length}</strong><span>zat er al in</span></div>
            <div><strong>${p.parsed.period ? fmtDate(p.parsed.period.from) + ' – ' + fmtDate(p.parsed.period.to) : '—'}</strong><span>periode</span></div>
            <div><strong>${p.parsed.balance ? money(p.parsed.balance.amount) : '—'}</strong><span>${p.parsed.balance ? 'saldo op ' + fmtDate(p.parsed.balance.date) : 'geen saldo in bestand'}</span></div>
          </div>
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

  // ----- Degiro -----

  function degiroModal() {
    const m = modal;
    return modalShell('Ophalen uit Degiro', `
      <p class="small muted">Je gegevens gaan via je eigen Flux-server rechtstreeks naar Degiro. <strong>Wachtwoord en code worden niet bewaard.</strong></p>
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
      state.investments = Invest.mergeInvestments(inv(), data, 'degiro-api', today);
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
    let data = inv();
    const order = { account: 0, transactions: 1, portfolio: 2 };
    const list = m.files.filter(f => f.type && !f.duplicate).sort((a, b) => order[a.type] - order[b.type] || (a.date || '').localeCompare(b.date || ''));
    const keepSource = data && data.source === 'degiro-api';
    for (const f of list) {
      if (f.type === 'portfolio') data = Invest.mergeInvestments(data, Invest.parsePortfolioCsv(f.text), 'degiro-csv', f.date || today);
      if (f.type === 'transactions') data = Invest.mergeInvestments(data, { trades: Invest.parseTransactionsCsv(f.text) }, 'degiro-csv', data && data.positionsDate);
      if (f.type === 'account') data = Invest.mergeInvestments(data, { movements: Invest.parseAccountCsv(f.text) }, 'degiro-csv', data && data.positionsDate);
      data.files = (data.files || []).concat([{ name: f.name, hash: f.hash, type: f.type, date: f.type === 'portfolio' ? f.date : null, importedAt: new Date().toISOString() }]);
    }
    if (keepSource) data.source = 'degiro-api';
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
    if (Sync && Sync.mode === 'offline') throw new Error('Geen verbinding met je Flux-server');
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
  async function lookupOne() {
    const el = $('#tx-lookup-result');
    const item = { name: $('#tx-counterparty').value.trim(), description: $('#tx-description').value.trim() };
    if (!item.name && !item.description) { el.textContent = 'Vul eerst een tegenpartij of mededeling in.'; return; }
    item.direction = C.parseAmount($('#tx-amount').value) > 0 ? 'in' : 'out';
    el.innerHTML = '<span class="muted">Bezig met opzoeken…</span>';
    try {
      const [res] = await lookupBatch([item]);
      const sg = suggestionFor(res, item.direction);
      el.innerHTML = `<div class="section lookup-hits">${hitsHtml(res)}${sg ? `<div>→ voorstel: <strong>${esc(catName(sg.categoryId))}</strong> <span class="muted">(${esc(sg.why)})</span></div>` : '<div class="muted">Geen passende categorie gevonden.</div>'}</div>`;
      if (sg && !$('#tx-category').value) { $('#tx-category').value = sg.categoryId; updateSplitRemaining(); }
    } catch (e) { el.innerHTML = `<span style="color:var(--red)">Opzoeken mislukt: ${esc(e.message)}</span>`; }
  }

  // ---------- Aanmelden ----------

  function renderSyncBadge() {
    const el = $('#sync-badge');
    if (!el) return;
    const s = ui.sync;
    let text, cls;
    if (demo) { text = '🧪 Voorbeeld'; cls = 'warn'; }
    else if (s.mode === 'local') { text = 'Lokaal'; cls = 'muted'; }
    else if (s.mode === 'auth') { text = 'Niet aangemeld'; cls = 'warn'; }
    else if (s.status === 'syncing') { text = 'Synchroniseren…'; cls = 'muted'; }
    else if (s.mode === 'offline' || s.status === 'offline') { text = 'Offline' + (s.pending ? ` · ${s.pending} wacht` : ''); cls = 'warn'; }
    else if (s.status === 'error') { text = 'Synchronisatiefout'; cls = 'over'; }
    else { text = s.pending ? `${s.pending} wachten` : '✓ Gesynchroniseerd'; cls = 'ok'; }
    el.className = 'badge sync ' + cls;
    el.textContent = text;
    el.title = s.detail || (s.user ? 'Aangemeld als ' + s.user : '');
  }

  function renderAuth() {
    const a = ui.auth;
    if (a.setupRequired) {
      return `<div class="auth card"><h1>Flux instellen</h1>
        <p class="muted">Maak je account aan. De setupcode staat in de log van de server.</p>
        <form data-form="setup" class="form-stack">
          <label class="field"><span>Setupcode</span><input type="text" name="code" autocomplete="one-time-code" required autocapitalize="characters"></label>
          <label class="field"><span>Gebruikersnaam</span><input type="text" name="username" autocomplete="username" autocapitalize="none" required></label>
          <label class="field"><span>Wachtwoord (min. 8 tekens)</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
          <div class="errors">${esc(a.error || '')}</div><button class="btn primary" type="submit">Account aanmaken</button></form></div>`;
    }
    return `<div class="auth card"><h1><span class="logo">≈</span> Flux</h1>
      <p class="muted">${a.expired ? 'Je sessie is verlopen. Meld je opnieuw aan.' : 'Meld je aan.'}</p>
      <form data-form="login" class="form-stack">
        <label class="field"><span>Gebruikersnaam</span><input type="text" name="username" autocomplete="username" autocapitalize="none" value="${esc(a.previousUser || '')}" required></label>
        <label class="field"><span>Wachtwoord</span><input type="password" name="password" autocomplete="current-password" required></label>
        <div class="errors">${esc(a.error || '')}</div><button class="btn primary" type="submit">Aanmelden</button></form></div>`;
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
    const lines = [['Datum', 'Rekening', 'Tegenpartij', 'IBAN tegenpartij', 'Mededeling', 'Bedrag', 'Soort', 'Gekoppeld aan', 'Persoon', 'Bron', 'Notitie'].map(q).join(';')];
    for (const t of state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const cats = C.splitLines(t).map(l => (l.categoryId ? catName(l.categoryId) : '') + (t.splits.length ? ' ' + C.centsToInput(l.amount) : '')).join(' + ');
      const persons = C.splitLines(t).map(l => l.person).filter(Boolean).join(', ');
      lines.push([fmtDate(t.date), accName(t.accountId), t.counterparty, C.formatIban(t.counterpartyIban), t.description, (t.amount < 0 ? '-' : '') + C.centsToInput(t.amount),
        (KIND_LABEL[kindOf(t)] || [])[1], cats, persons, t.source === 'import' ? (imp(t.importId) || {}).fileName : 'manueel', t.note || ''].map(q).join(';'));
    }
    download('flux-transacties-' + today + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }
  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await readFile(file));
        if (!data || !Array.isArray(data.transactions)) throw new Error('geen Flux-back-up');
        if (data.demo) throw new Error('dit is een back-up van de voorbeeldmodus');
        if ((data.version || 1) < Store.VERSION) throw new Error('back-up van een oudere Flux-versie; die wordt bewust niet teruggezet');
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
    'month': el => { const d = Number(el.dataset.delta); ui.month = d === 0 ? today.slice(0, 7) : shiftMonth(ui.month, d); ui.year = ui.month.slice(0, 4); render(); },
    'period': el => { ui.period = el.dataset.period; render(); },
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
    'bank-filter': el => { ui.bank.account = ui.bank.account === el.dataset.id ? '' : el.dataset.id; ui.bank.status = ''; render(); },
    'bank-status': el => { ui.bank.status = el.dataset.status; ui.bank.limit = 150; render(); },
    'list-status': el => { ui.list.status = el.dataset.status; ui.list.limit = 150; render(); },
    'more': el => { (el.dataset.key === 'bank' ? ui.bank : ui.list).limit += 300; render(); },
    'new-tx': el => openModal({ type: 'tx', tx: newTx(el && el.dataset.account) }),
    'edit-tx': el => { const t = txById(el.dataset.id); if (t) openModal({ type: 'tx', tx: JSON.parse(JSON.stringify(t)) }); },
    'save-tx': saveTx,
    'delete-tx': () => {
      const t = txById(modal.tx.id);
      if (!t) return;
      const msg = t.source === 'import' ? 'Deze transactie verwijderen?\n\nLet op: laad je later een bestand op dat deze transactie bevat, dan komt ze terug. Om een volledig bestand te verwijderen gebruik je “Ongedaan maken” bij de import (tabblad Bank).' : 'Deze transactie verwijderen?';
      if (!confirm(msg)) return;
      state.transactions = state.transactions.filter(x => x.id !== t.id);
      closeModal();
      commit('Transactie verwijderd');
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
      const t = modal.tx;
      const key = C.normalizeName(t.counterparty) || C.normalizeName(t.description);
      openModal({ type: 'rule', rule: { id: C.uid('rule'), name: t.counterparty || key, field: t.counterparty ? 'counterparty' : 'any', operator: 'name', value: key, categoryId: $('#tx-category').value || t.categoryId, direction: t.amount < 0 ? 'out' : 'in', enabled: true } });
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
      if (!confirm('Categorie “' + catName(id) + '” verwijderen? Gekoppelde transacties worden weer “te verwerken”; bijhorende regels en budgetten verdwijnen.')) return;
      state.categories = state.categories.filter(c => c.id !== id).map(c => { if (c.incomeId === id) { const x = Object.assign({}, c); delete x.incomeId; return x; } return c; });
      state.rules = state.rules.filter(r => r.categoryId !== id);
      state.budgets = state.budgets.filter(b => b.categoryId !== id);
      commit('Categorie verwijderd');
    },
    'degiro-connect': () => openModal({ type: 'degiro' }),
    'degiro-files': () => openModal({ type: 'degiroFiles', files: [] }),
    'degiro-apply': applyDegiroFiles,
    'degiro-clear': () => { if (!confirm('Alle beleggingsgegevens (Degiro) wissen?')) return; state.investments = { cleared: true }; commit('Beleggingsgegevens gewist'); },
    'lookup': () => { const c = C.lookupCandidates(state); if (!c.length) toast('Alles is al gekoppeld.'); else openLookup(c); },
    'lookup-one': lookupOne,
    'lookup-apply': applyLookup,
    'sync-now': () => Sync.syncNow(),
    'change-password': () => openModal({ type: 'password' }),
    'save-password': savePassword,
    'logout': () => doLogout(false),
    'logout-all': () => doLogout(true),
    'export-json': () => download('flux-backup-' + today + (demo ? '-voorbeeld' : '') + '.json', JSON.stringify(state, null, 2), 'application/json'),
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
    if (!silent) { render(); window.scrollTo(0, 0); }
  }

  document.addEventListener('click', ev => {
    const nav = ev.target.closest('#nav button');
    if (nav) { go(nav.dataset.view); return; }
    const el = ev.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') ev.preventDefault();
    actions[el.dataset.action](el, ev);
  });

  let searchTimer;
  document.addEventListener('input', ev => {
    const el = ev.target;
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
    if (modal && modal.type === 'rule') updateRulePreview();
  });

  document.addEventListener('change', ev => {
    const el = ev.target;
    if (el.dataset.assign) { assignTx(el.dataset.assign, el.value); return; }
    if (el.dataset.filter === 'bank.account') { ui.bank.account = el.value; render(); return; }
    if (el.dataset.ui === 'year') { ui.year = el.value; render(); return; }
    if (el.dataset.setting) { state.settings = Object.assign({}, state.settings, { [el.dataset.setting]: el.type === 'checkbox' ? el.checked : el.value.trim() }); commit('Instelling bewaard'); return; }
    if (!modal) return;
    if (modal.type === 'tx') { updateSplitRemaining(); updateTxSections(); return; }
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
    if (modal.type === 'degiroFiles') {
      if (el.id === 'dg-files' && el.files.length) loadDegiroFiles(el.files);
      if (el.dataset.dgDate != null) modal.files[Number(el.dataset.dgDate)].date = el.value;
    }
  });

  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && modal) closeModal(); });
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && v !== ui.view) { ui.view = v; render(); } });

  document.addEventListener('submit', async ev => {
    const form = ev.target.closest('[data-form]');
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.form === 'degiro') { degiroSubmit(form); return; }
    const f = new FormData(form);
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      if (form.dataset.form === 'login') await Sync.login(String(f.get('username')).trim(), String(f.get('password')));
      else await Sync.setup(String(f.get('code')).trim(), String(f.get('username')).trim(), String(f.get('password')));
      ui.auth = null;
      render();
      toast('Aangemeld');
    } catch (e) {
      ui.auth = Object.assign({}, ui.auth, { error: e.message, previousUser: String(f.get('username') || '').trim() || ui.auth.previousUser });
      render();
    }
  });

  async function doLogout(everywhere) {
    if (!await Sync.logout(everywhere)) return;
    Store.clear();
    realState = Store.defaultState();
    if (!demo) state = realState;
    snap = C.snapshot(realState);
    ui.auth = { setupRequired: false };
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
      onAuthRequired: info => {
        ui.auth = { setupRequired: !!info.setupRequired, previousUser: info.previousUser || null, expired: !!info.previousUser };
        closeModal();
        render();
      }
    }).then(() => { if (!ui.auth) render(); }).catch(e => console.error('Flux sync:', e));
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* werkt ook zonder */ });
  }
})();
