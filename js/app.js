/*
 * Flux — gebruikersinterface.
 */
(function () {
  'use strict';
  const C = window.FluxCore;
  const Store = window.FluxStore;

  let state = Store.load();
  const today = C.todayStr();
  const ui = {
    view: (location.hash || '#dashboard').slice(1),
    month: today.slice(0, 7),
    tx: { search: '', account: '', category: '', type: '', month: '', limit: 150 },
    showIgnored: false
  };
  let modal = null; // { type, ... }

  // ---------- Hulpjes ----------

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const money = C.formatMoney;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function cat(id) { return state.categories.find(c => c.id === id); }
  function catName(id) { const c = cat(id); return c ? c.name : 'Niet gecategoriseerd'; }
  function catColor(id) { const c = cat(id); return c ? c.color : '#ced4da'; }
  function acc(id) { return state.accounts.find(a => a.id === id); }
  function accName(id) { const a = acc(id); return a ? a.name : '—'; }
  function txById(id) { return state.transactions.find(t => t.id === id); }
  function fmtDate(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return day + '/' + m + '/' + y;
  }
  function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'][m - 1] + ' ' + y;
  }
  function shiftMonth(ym, n) { return C.addMonths(ym + '-01', n).slice(0, 7); }
  function catBadge(id, suffix) {
    const extra = suffix ? ' ' + esc(suffix) : '';
    if (!id) return `<span class="badge none">Niet gecategoriseerd${extra}</span>`;
    return `<span class="badge"><span class="dot" style="background:${esc(catColor(id))}"></span>${esc(catName(id))}${extra}</span>`;
  }
  function categoryOptions(selected, opts) {
    opts = opts || {};
    const groups = [['expense', 'Uitgaven'], ['income', 'Inkomsten']].filter(([k]) => !opts.kind || opts.kind === k);
    let html = opts.allowEmpty !== false ? `<option value="">${esc(opts.emptyLabel || '— Geen categorie —')}</option>` : '';
    for (const [kind, label] of groups) {
      html += `<optgroup label="${label}">` + state.categories.filter(c => c.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + '</optgroup>';
    }
    return html;
  }
  function accountOptions(selected) {
    return state.accounts.map(a => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  }
  function amountClass(cents) { return cents > 0 ? 'pos' : 'neg'; }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /** Na elke wijziging: herberekenen, opslaan, opnieuw tekenen. */
  function commit(msg) {
    C.recompute(state);
    if (!Store.save(state)) toast('Opslaan mislukt — is de opslag van je browser vol?');
    else if (msg) toast(msg);
    render();
  }

  function monthNav() {
    return `<div class="month-nav">
      <button class="btn small" data-action="month" data-delta="-1" aria-label="Vorige maand">‹</button>
      <span class="label">${esc(monthLabel(ui.month))}</span>
      <button class="btn small" data-action="month" data-delta="1" aria-label="Volgende maand">›</button>
      ${ui.month !== today.slice(0, 7) ? '<button class="btn small ghost" data-action="month" data-delta="0">Vandaag</button>' : ''}
    </div>`;
  }

  // ---------- Rendering ----------

  function render() {
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
    const views = { dashboard: renderDashboard, transactions: renderTransactions, rules: renderRules, budgets: renderBudgets, recurring: renderRecurring, settings: renderSettings };
    const fn = views[ui.view] || renderDashboard;
    $('#main').innerHTML = fn();
  }

  // ----- Overzicht -----

  function renderDashboard() {
    if (!state.transactions.length) {
      return `<div class="page-head"><h1>Welkom bij Flux</h1></div>
        <div class="card empty-state">
          <p>Nog geen transacties. Importeer een CSV-export van je bank, voeg manueel een transactie toe of probeer Flux met demogegevens.</p>
          <button class="btn primary" data-action="import">CSV importeren</button>
          <button class="btn" data-action="new-tx">Manuele transactie</button>
          <button class="btn" data-action="load-demo">Demogegevens laden</button>
        </div>`;
    }
    const lines = C.allocations(state);
    const range = C.periodRange('monthly', ui.month + '-01');
    const sumNow = C.summarize(state, range, lines);
    const prevRange = C.periodRange('monthly', shiftMonth(ui.month, -1) + '-01');
    const sumPrev = C.summarize(state, prevRange, lines);
    const refDate = ui.month === today.slice(0, 7) ? today : range.end;

    const budgetRows = state.budgets.map(b => C.budgetStatus(state, b, refDate, lines))
      .sort((a, b) => b.pct - a.pct);
    const alerts = budgetRows.filter(b => b.status !== 'ok');

    const recurring = C.detectRecurring(state, today).filter(r => r.userStatus !== 'ignored' && r.status !== 'gestopt');
    const upcoming = recurring.filter(r => r.daysUntil >= -7 && r.daysUntil <= 30);

    const uncategorized = state.transactions.filter(t => !t.isTransfer && !t.refundOf && !t.categoryId && !(t.splits && t.splits.length)).length;
    const maybeRefunds = state.transactions.filter(C.looksLikeRefund).length;

    const cats = Object.entries(sumNow.byCategory)
      .filter(([id, v]) => v < 0 && (id === '__none__' || (cat(id) && cat(id).kind === 'expense')))
      .map(([id, v]) => ({ id: id === '__none__' ? null : id, v: -v }))
      .sort((a, b) => b.v - a.v);
    const maxCat = cats.length ? cats[0].v : 1;

    const diff = (a, b) => {
      if (!b) return '';
      const p = Math.round((a - b) / Math.abs(b) * 100);
      return `${p >= 0 ? '+' : ''}${p}% t.o.v. vorige maand`;
    };

    return `
      <div class="page-head"><h1>Overzicht</h1><span class="spacer"></span>${monthNav()}
        <button class="btn" data-action="new-tx">+ Manueel</button>
        <button class="btn primary" data-action="import">CSV importeren</button></div>
      ${uncategorized || maybeRefunds ? `<div class="notice info">
        ${uncategorized ? `<a href="#" data-action="goto-uncategorized">${uncategorized} transactie(s) zonder categorie</a>` : ''}
        ${uncategorized && maybeRefunds ? ' · ' : ''}
        ${maybeRefunds ? `<a href="#" data-action="goto-maybe-refunds">${maybeRefunds} mogelijke terugbetaling(en) nog niet gekoppeld</a>` : ''}
      </div>` : ''}
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Inkomsten</div><div class="value pos">${money(sumNow.income)}</div><div class="hint">${diff(sumNow.income, sumPrev.income)}</div></div>
        <div class="card kpi"><div class="label">Uitgaven</div><div class="value">${money(sumNow.expenses)}</div><div class="hint">${diff(sumNow.expenses, sumPrev.expenses)} · na terugbetalingen</div></div>
        <div class="card kpi"><div class="label">Saldo</div><div class="value ${sumNow.net >= 0 ? 'pos' : ''}">${money(sumNow.net)}</div><div class="hint">${sumNow.income ? Math.round(sumNow.net / sumNow.income * 100) + '% van inkomen' : ''}</div></div>
        <div class="card kpi"><div class="label">Intern overgeschreven</div><div class="value">${money(sumNow.transfers)}</div><div class="hint">Niet meegeteld als in- of uitgave</div></div>
      </div>
      <div class="grid two">
        <div class="card">
          <h2>Uitgaven per categorie</h2>
          ${cats.length ? cats.map(c => `<div class="catbar">
              <span class="name">${esc(catName(c.id))}</span>
              <span class="track"><span class="fill" style="display:block;width:${(c.v / maxCat * 100).toFixed(1)}%;background:${esc(catColor(c.id))}"></span></span>
              <span class="amount">${money(c.v)}</span></div>`).join('') : '<p class="muted">Geen uitgaven deze maand.</p>'}
        </div>
        <div class="card">
          <h2>Budgetten</h2>
          ${budgetRows.length ? budgetRows.slice(0, 6).map(miniBudget).join('') : '<p class="muted">Nog geen budgetten. <a href="#budgets">Stel er een in</a>.</p>'}
          ${alerts.length ? `<p class="small" style="margin-top:10px">⚠️ ${alerts.length} budget(ten) vragen aandacht.</p>` : ''}
        </div>
        <div class="card">
          <h2>Komende vaste lasten (30 dagen)</h2>
          ${upcoming.length ? '<div class="list">' + upcoming.map(r => `<div class="list-row">
              <div class="grow"><div>${esc(r.name)}</div><div class="small muted">${esc(r.frequency.label)} · ${r.daysUntil < 0 ? `<span class="badge over">${-r.daysUntil} d te laat</span>` : r.daysUntil === 0 ? 'vandaag' : 'over ' + r.daysUntil + ' d'} (${fmtDate(r.nextDue)})</div></div>
              <span class="amount">${r.fixed ? '' : '± '}${money(r.expected)}</span></div>`).join('') + '</div>'
            : '<p class="muted">Geen vervaldagen in de komende 30 dagen.</p>'}
          ${upcoming.length ? `<p class="small muted">Totaal verwacht: <strong>${money(upcoming.reduce((s, r) => s + r.expected, 0))}</strong></p>` : ''}
        </div>
        <div class="card">
          <h2>Laatste 12 maanden</h2>
          ${trendChart(lines)}
        </div>
      </div>`;
  }

  function miniBudget(st) {
    const pct = Math.min(st.pct, 1) * 100;
    return `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(catName(st.budget.categoryId))} <span class="small muted">${st.budget.period === 'yearly' ? 'jaar' : 'maand'}</span></span>
      <span class="small"><strong>${money(st.spent)}</strong> / ${money(st.limit)}</span></div>
      <div class="progress"><div class="bar ${st.status}" style="width:${pct.toFixed(1)}%"></div><div class="pace" style="left:${(st.elapsed * 100).toFixed(1)}%"></div></div>
    </div>`;
  }

  function trendChart(lines) {
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(shiftMonth(ui.month, -i));
    const data = months.map(m => {
      const s = C.summarize(state, C.periodRange('monthly', m + '-01'), lines);
      return { m, inc: s.income, exp: s.expenses };
    });
    const max = Math.max(1, ...data.map(d => Math.max(d.inc, d.exp)));
    const W = 520, H = 180, pad = 22, bw = (W - pad) / data.length;
    const h = v => Math.max(0, v) / max * (H - 30);
    const bars = data.map((d, i) => {
      const x = pad + i * bw;
      const label = C.MONTH_NAMES[Number(d.m.slice(5)) - 1];
      return `<g><title>${monthLabel(d.m)}: inkomsten ${money(d.inc)}, uitgaven ${money(d.exp)}</title>
        <rect x="${x + 3}" y="${H - 18 - h(d.inc)}" width="${bw / 2 - 4}" height="${h(d.inc)}" rx="2" fill="var(--green)" opacity=".75"/>
        <rect x="${x + bw / 2}" y="${H - 18 - h(d.exp)}" width="${bw / 2 - 4}" height="${h(d.exp)}" rx="2" fill="var(--primary)" opacity=".8"/>
        <text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${label}</text></g>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Inkomsten en uitgaven per maand">${bars}</svg>
      <div class="small muted"><span style="color:var(--green)">■</span> inkomsten &nbsp; <span style="color:var(--primary)">■</span> uitgaven</div>`;
  }

  // ----- Transacties -----

  function filteredTransactions() {
    const f = ui.tx;
    const q = f.search.trim().toLowerCase();
    return state.transactions.filter(t => {
      if (f.account && t.accountId !== f.account) return false;
      if (f.month && !t.date.startsWith(f.month)) return false;
      if (f.category === '__none__') {
        if (t.categoryId || t.isTransfer || t.refundOf || (t.splits && t.splits.length)) return false;
      } else if (f.category) {
        const cats = C.splitLines(t).map(l => l.categoryId);
        const refCat = t.refundOf && txById(t.refundOf) ? C.splitLines(txById(t.refundOf)).map(l => l.categoryId) : [];
        if (!cats.includes(f.category) && !refCat.includes(f.category)) return false;
      }
      if (f.type === 'out' && (t.amount >= 0 || t.isTransfer)) return false;
      if (f.type === 'in' && (t.amount <= 0 || t.isTransfer)) return false;
      if (f.type === 'transfer' && !t.isTransfer) return false;
      if (f.type === 'refund' && !t.refundOf) return false;
      if (f.type === 'maybe-refund' && !C.looksLikeRefund(t)) return false;
      if (f.type === 'split' && !(t.splits && t.splits.length)) return false;
      if (f.type === 'manual' && t.source !== 'manual') return false;
      if (q && !(`${t.counterparty} ${t.description} ${t.counterpartyIban} ${t.note || ''} ${C.centsToInput(t.amount)}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  }

  function renderTransactions() {
    const all = filteredTransactions();
    const list = all.slice(0, ui.tx.limit);
    const refunds = C.refundTotals(state);
    const total = all.filter(t => !t.isTransfer).reduce((s, t) => s + t.amount, 0);
    const months = Array.from(new Set(state.transactions.map(t => t.date.slice(0, 7)))).sort().reverse();
    const f = ui.tx;
    const rows = list.map(t => {
      const badges = [];
      if (t.isTransfer) badges.push('<span class="badge transfer">↔ Interne overschrijving</span>');
      else if (t.refundOf) {
        const o = txById(t.refundOf);
        badges.push(`<span class="badge refund">↩ Terugbetaling van ${esc(o ? (o.counterparty || o.description) : '?')}</span>`);
      } else if (t.splits && t.splits.length) {
        badges.push(`<span class="badge split">✂ Gesplitst</span>`);
        for (const l of C.splitLines(t)) badges.push(catBadge(l.categoryId, money(Math.abs(l.amount))));
      } else badges.push(catBadge(t.categoryId));
      if (C.looksLikeRefund(t)) badges.push('<span class="badge maybe">Mogelijke terugbetaling?</span>');
      if (t.source === 'manual') badges.push('<span class="badge">✎ Manueel</span>');
      if (t.categorySource === 'rule' && t.ruleId) {
        const r = state.rules.find(x => x.id === t.ruleId);
        if (r) badges.push(`<span class="badge small muted" title="Automatisch via regel">⚙ ${esc(r.name)}</span>`);
      }
      const refunded = refunds[t.id];
      return `<tr class="clickable ${t.isTransfer ? 'is-transfer' : ''}" data-action="edit-tx" data-id="${esc(t.id)}">
        <td class="nowrap">${fmtDate(t.date)}</td>
        <td class="hide-sm">${esc(accName(t.accountId))}</td>
        <td><div>${esc(t.counterparty || '—')}</div><div class="desc" title="${esc(t.description)}">${esc(t.description)}</div><div class="badge-row">${badges.join('')}</div></td>
        <td class="amount ${amountClass(t.amount)}">${money(t.amount)}${refunded ? `<div class="small pos">+${money(refunded)} terug<br><span class="muted">netto ${money(t.amount + refunded)}</span></div>` : ''}</td>
      </tr>`;
    }).join('');

    return `
      <div class="page-head"><h1>Transacties</h1><span class="spacer"></span>
        <button class="btn" data-action="new-tx">+ Manuele transactie</button>
        <button class="btn primary" data-action="import">CSV importeren</button></div>
      <div class="filters">
        <input type="search" placeholder="Zoeken in tegenpartij, mededeling, bedrag…" data-filter="search" value="${esc(f.search)}">
        <select data-filter="month"><option value="">Alle maanden</option>${months.map(m => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
        <select data-filter="account"><option value="">Alle rekeningen</option>${accountOptions(f.account)}</select>
        <select data-filter="category">${categoryOptions(f.category, { emptyLabel: 'Alle categorieën' }).replace('</option>', '</option><option value="__none__" ' + (f.category === '__none__' ? 'selected' : '') + '>Niet gecategoriseerd</option>')}</select>
        <select data-filter="type">
          ${[['', 'Alle types'], ['out', 'Uitgaven'], ['in', 'Inkomsten'], ['transfer', 'Interne overschrijvingen'], ['refund', 'Terugbetalingen'], ['maybe-refund', 'Mogelijke terugbetalingen'], ['split', 'Gesplitst'], ['manual', 'Manueel ingevoerd']]
            .map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <p class="small muted">${all.length} transactie(s) · netto ${money(total)} (zonder interne overschrijvingen)</p>
      ${list.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Datum</th><th class="hide-sm">Rekening</th><th>Omschrijving</th><th class="right">Bedrag</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<div class="card empty-state">Geen transacties gevonden.</div>'}
      ${all.length > list.length ? `<p style="text-align:center"><button class="btn" data-action="more-tx">Toon meer (${all.length - list.length} resterend)</button></p>` : ''}`;
  }

  // ----- Regels -----

  function renderRules() {
    const rules = C.sortedRules(state.rules);
    const counts = {};
    for (const t of state.transactions) if (t.ruleId) counts[t.ruleId] = (counts[t.ruleId] || 0) + 1;
    return `
      <div class="page-head"><h1>Categorisatieregels</h1><span class="spacer"></span>
        <button class="btn" data-action="apply-rules">Regels opnieuw toepassen</button>
        <button class="btn primary" data-action="new-rule">+ Nieuwe regel</button></div>
      <p class="muted">Regels worden van boven naar onder overlopen; de eerste regel die past bepaalt de categorie.
        Transacties die je manueel een categorie gaf, opsplitste of als terugbetaling koppelde worden niet overschreven.</p>
      ${rules.length ? `<div class="table-wrap"><table>
        <thead><tr><th style="width:70px">Volgorde</th><th>Regel</th><th>Voorwaarde</th><th>Categorie</th><th class="right">Treffers</th><th></th></tr></thead>
        <tbody>${rules.map((r, i) => `<tr style="${r.enabled === false ? 'opacity:.5' : ''}">
          <td class="nowrap"><button class="btn small ghost" data-action="rule-up" data-id="${esc(r.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Omhoog">▲</button><button class="btn small ghost" data-action="rule-down" data-id="${esc(r.id)}" ${i === rules.length - 1 ? 'disabled' : ''} aria-label="Omlaag">▼</button></td>
          <td><strong>${esc(r.name)}</strong></td>
          <td class="small">als <em>${esc(C.RULE_FIELDS[r.field])}</em> ${esc(C.RULE_OPERATORS[r.operator])} "<code>${esc(r.value)}</code>"
            ${r.direction === 'out' ? ' · enkel uitgaven' : r.direction === 'in' ? ' · enkel inkomsten' : ''}${r.accountId ? ' · rekening ' + esc(accName(r.accountId)) : ''}</td>
          <td>${catBadge(r.categoryId)}</td>
          <td class="right">${counts[r.id] || 0}</td>
          <td class="nowrap right">
            <button class="btn small" data-action="toggle-rule" data-id="${esc(r.id)}">${r.enabled === false ? 'Activeer' : 'Pauzeer'}</button>
            <button class="btn small" data-action="edit-rule" data-id="${esc(r.id)}">Bewerk</button>
            <button class="btn small danger" data-action="delete-rule" data-id="${esc(r.id)}" aria-label="Verwijder">✕</button></td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="card empty-state">Nog geen regels.</div>'}`;
  }

  // ----- Budgetten -----

  function renderBudgets() {
    const lines = C.allocations(state);
    const refDate = ui.month === today.slice(0, 7) ? today : C.periodRange('monthly', ui.month + '-01').end;
    const stats = state.budgets.map(b => C.budgetStatus(state, b, refDate, lines));
    const totalLimit = stats.filter(s => s.budget.period === 'monthly').reduce((a, s) => a + s.limit, 0);
    const totalSpent = stats.filter(s => s.budget.period === 'monthly').reduce((a, s) => a + s.spent, 0);
    const label = { ok: 'Op schema', warn: 'Bijna op', over: 'Overschreden' };
    return `
      <div class="page-head"><h1>Budgetten</h1><span class="spacer"></span>${monthNav()}
        <button class="btn primary" data-action="new-budget">+ Nieuw budget</button></div>
      ${stats.length ? `<p class="muted">Maandbudgetten samen: <strong>${money(totalSpent)}</strong> van ${money(totalLimit)} besteed.
        De verticale streep toont hoever de periode gevorderd is.</p>
      <div class="grid cards">${stats.map(st => {
        const b = st.budget;
        const pct = Math.min(st.pct, 1) * 100;
        let paceText;
        if (st.daysLeft <= 0) paceText = st.remaining >= 0 ? 'Periode afgesloten binnen budget' : 'Periode afgesloten boven budget';
        else if (st.remaining <= 0) paceText = 'Geen ruimte meer over';
        else paceText = `Nog ${money(st.perDayLeft)} per dag (${st.daysLeft} d)`;
        return `<div class="card budget-card">
          <div class="top"><span class="name">${esc(catName(b.categoryId))}</span><span class="badge ${st.status}">${label[st.status]}</span></div>
          <div class="small muted" style="margin-bottom:8px">${b.period === 'yearly' ? 'Jaarbudget ' + st.range.label : 'Maandbudget ' + esc(monthLabel(st.range.label))} · waarschuwing bij ${Math.round((b.warnAt != null ? b.warnAt : 0.8) * 100)}%</div>
          <div class="progress"><div class="bar ${st.status}" style="width:${pct.toFixed(1)}%"></div><div class="pace" style="left:${(st.elapsed * 100).toFixed(1)}%"></div></div>
          <div class="nums"><span><strong style="color:var(--text)">${money(st.spent)}</strong> van ${money(st.limit)} (${Math.round(st.pct * 100)}%)</span>
            <span>${st.remaining >= 0 ? 'Nog ' + money(st.remaining) : money(-st.remaining) + ' te veel'}</span></div>
          <div class="small muted" style="margin-top:6px">${paceText}${st.daysLeft > 0 && st.elapsed > 0 ? ` · prognose ${money(st.projected)}${!st.onPace ? ' <span class="badge warn">sneller dan gepland</span>' : ''}` : ''}</div>
          <div class="actions"><button class="btn small" data-action="edit-budget" data-id="${esc(b.id)}">Bewerk</button>
            <button class="btn small" data-action="budget-tx" data-id="${esc(b.id)}">Transacties</button>
            <button class="btn small danger" data-action="delete-budget" data-id="${esc(b.id)}">Verwijder</button></div>
        </div>`;
      }).join('')}</div>` : '<div class="card empty-state">Nog geen budgetten. Stel een maand- of jaarlimiet in per categorie.</div>'}`;
  }

  // ----- Vaste lasten -----

  function renderRecurring() {
    const all = C.detectRecurring(state, today);
    const active = all.filter(r => r.userStatus !== 'ignored');
    const ignored = all.filter(r => r.userStatus === 'ignored');
    const live = active.filter(r => r.status !== 'gestopt');
    const monthly = live.reduce((s, r) => s + r.monthlyCost, 0);
    const statusBadge = r => ({
      actief: '<span class="badge ok">Actief</span>',
      binnenkort: '<span class="badge warn">Binnenkort</span>',
      gemist: '<span class="badge over">Betaling gemist?</span>',
      gestopt: '<span class="badge">Gestopt?</span>'
    }[r.status]);
    const row = r => {
      const max = Math.max(1, ...r.monthProfile.filter(v => v != null));
      const spark = r.monthProfile.map((v, i) => v == null ? `<span class="empty" title="${C.MONTH_NAMES[i]}"></span>` : `<span style="height:${Math.max(3, v / max * 26)}px" title="${C.MONTH_NAMES[i]}: ${money(v)}"></span>`).join('');
      return `<tr>
        <td><strong>${esc(r.name)}</strong> ${r.userStatus === 'confirmed' ? '<span class="badge ok" title="Door jou bevestigd">✓</span>' : ''}
          <div class="badge-row">${catBadge(r.categoryId)}${r.seasonal ? `<span class="badge maybe">${esc(r.seasonal.label)}</span>` : ''}</div></td>
        <td>${esc(r.frequency.label)}<div class="small muted">${r.count}× sinds ${fmtDate(r.firstDate)}</div></td>
        <td class="amount">${r.fixed ? money(r.lastAmount) : `${money(r.minAmount)} – ${money(r.maxAmount)}`}
          <div class="small muted">${r.fixed ? 'vast bedrag' : 'variabel, gem. ' + money(r.avgAmount)}</div></td>
        <td class="hide-sm"><div class="spark" title="Gemiddeld bedrag per kalendermaand">${spark}</div></td>
        <td class="nowrap">${fmtDate(r.nextDue)}<div class="small muted">${r.daysUntil >= 0 ? 'over ' + r.daysUntil + ' d' : -r.daysUntil + ' d geleden'} · ± ${money(r.expected)}</div></td>
        <td>${statusBadge(r)}</td>
        <td class="nowrap right">
          ${r.userStatus === 'ignored'
            ? `<button class="btn small" data-action="sub-status" data-key="${esc(r.key)}" data-status="detected">Herstel</button>`
            : `${r.userStatus !== 'confirmed' ? `<button class="btn small" data-action="sub-status" data-key="${esc(r.key)}" data-status="confirmed">Bevestig</button>` : ''}
               <button class="btn small" data-action="sub-rename" data-key="${esc(r.key)}">Naam</button>
               <button class="btn small" data-action="sub-tx" data-key="${esc(r.key)}">Transacties</button>
               <button class="btn small danger" data-action="sub-status" data-key="${esc(r.key)}" data-status="ignored">Negeer</button>`}
        </td></tr>`;
    };
    const head = '<thead><tr><th>Naam</th><th>Frequentie</th><th class="right">Bedrag</th><th class="hide-sm">Seizoen</th><th>Volgende vervaldag</th><th>Status</th><th></th></tr></thead>';
    return `
      <div class="page-head"><h1>Vaste lasten & abonnementen</h1></div>
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Vaste lasten per maand</div><div class="value">${money(monthly)}</div><div class="hint">Omgerekend, ook jaarlijkse kosten</div></div>
        <div class="card kpi"><div class="label">Per jaar</div><div class="value">${money(monthly * 12)}</div></div>
        <div class="card kpi"><div class="label">Gedetecteerd</div><div class="value">${live.length}</div><div class="hint">${active.filter(r => r.status === 'gemist').length} mogelijk gemist</div></div>
      </div>
      <p class="muted">Flux zoekt automatisch naar betalingen aan dezelfde tegenpartij met een regelmatig interval (wekelijks tot jaarlijks)
        en schat de volgende vervaldag en het verwachte bedrag — rekening houdend met seizoenspatronen zoals hogere energievoorschotten in de winter.</p>
      ${active.length ? `<div class="table-wrap"><table>${head}<tbody>${active.map(row).join('')}</tbody></table></div>`
        : '<div class="card empty-state">Nog geen terugkerende kosten gevonden. Daarvoor zijn minstens 3 betalingen (of 2 bij jaarlijkse kosten) nodig.</div>'}
      ${ignored.length ? `<p><button class="btn small ghost" data-action="toggle-ignored">${ui.showIgnored ? '▾' : '▸'} Genegeerd (${ignored.length})</button></p>
        ${ui.showIgnored ? `<div class="table-wrap"><table>${head}<tbody>${ignored.map(row).join('')}</tbody></table></div>` : ''}` : ''}`;
  }

  // ----- Instellingen -----

  function renderSettings() {
    const txCount = {};
    for (const t of state.transactions) txCount[t.accountId] = (txCount[t.accountId] || 0) + 1;
    const catCount = {};
    for (const t of state.transactions) for (const l of C.splitLines(t)) if (l.categoryId) catCount[l.categoryId] = (catCount[l.categoryId] || 0) + 1;
    const types = { zicht: 'Zichtrekening', spaar: 'Spaarrekening', cash: 'Cash', krediet: 'Kredietkaart', andere: 'Andere' };
    return `
      <div class="page-head"><h1>Instellingen</h1></div>
      <div class="grid two">
        <div class="card">
          <h2>Eigen rekeningen</h2>
          <p class="small muted">Vul je IBAN's in: overschrijvingen tussen deze rekeningen worden automatisch als <em>interne overschrijving</em> herkend en tellen niet mee als inkomen of uitgave.</p>
          <div class="list">${state.accounts.map(a => `<div class="list-row">
            <div class="grow"><strong>${esc(a.name)}</strong> <span class="small muted">${esc(types[a.type] || a.type)}</span>
              <div class="small muted">${a.iban ? esc(C.formatIban(a.iban)) : 'geen IBAN'} · ${txCount[a.id] || 0} transacties</div></div>
            <button class="btn small" data-action="edit-account" data-id="${esc(a.id)}">Bewerk</button>
            <button class="btn small danger" data-action="delete-account" data-id="${esc(a.id)}">✕</button></div>`).join('')}</div>
          <p><button class="btn" data-action="new-account">+ Rekening toevoegen</button></p>
        </div>
        <div class="card">
          <h2>Categorieën</h2>
          <div class="list">${state.categories.slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).map(c => `<div class="list-row">
            <span class="badge"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</span>
            <span class="grow small muted">${c.kind === 'income' ? 'inkomsten' : 'uitgaven'} · ${catCount[c.id] || 0} transacties</span>
            <button class="btn small" data-action="edit-category" data-id="${esc(c.id)}">Bewerk</button>
            <button class="btn small danger" data-action="delete-category" data-id="${esc(c.id)}">✕</button></div>`).join('')}</div>
          <p><button class="btn" data-action="new-category">+ Categorie toevoegen</button></p>
        </div>
        <div class="card">
          <h2>Gegevens</h2>
          <p class="small muted">Alles wordt enkel lokaal in deze browser bewaard. Maak regelmatig een back-up.</p>
          <p style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-action="export-json">Back-up downloaden (JSON)</button>
            <button class="btn" data-action="import-json">Back-up terugzetten</button>
            <button class="btn" data-action="export-csv">Transacties exporteren (CSV)</button>
          </p>
          <p style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-action="load-demo">Demogegevens laden</button>
            <button class="btn danger" data-action="reset">Alles wissen</button>
          </p>
          <p class="small muted">${state.transactions.length} transacties · ${state.rules.length} regels · ${state.budgets.length} budgetten</p>
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
    const fns = { tx: txModal, rule: ruleModal, budget: budgetModal, account: accountModal, category: categoryModal, import: importModal };
    root.innerHTML = fns[modal.type]();
    const first = $('.modal-body input, .modal-body select', root);
    if (first && modal.type !== 'tx') first.focus();
    if (modal.type === 'tx') updateSplitRemaining();
    if (modal.type === 'rule') updateRulePreview();
  }

  // ----- Transactie -----

  function txModal() {
    const t = modal.tx;
    const isNew = !txById(t.id);
    const imported = t.source === 'import';
    const suggestions = t.amount > 0 ? C.suggestRefundTargets(state, t, 10) : [];
    if (t.refundOf && !suggestions.some(s => s.tx.id === t.refundOf) && txById(t.refundOf)) suggestions.unshift({ tx: txById(t.refundOf) });
    const pair = t.transferPairId ? txById(t.transferPairId) : null;
    const autoTransfer = (() => {
      const ownIbans = state.accounts.map(a => C.normalizeIban(a.iban)).filter(Boolean);
      return ownIbans.includes(C.normalizeIban(t.counterpartyIban));
    })();
    const refundedBy = state.transactions.filter(o => o.refundOf === t.id);
    const splitRows = (t.splits || []).map(s => splitRow(s)).join('');

    const body = `
      ${imported ? '<div class="notice info small">Geïmporteerde transactie. Je kan velden corrigeren; de wijzigingen blijven bewaard.</div>' : ''}
      <div class="form-grid">
        <label class="field"><span>Datum</span><input type="date" id="tx-date" value="${esc(t.date)}" required></label>
        <label class="field"><span>Bedrag (negatief = uitgave)</span><input type="text" inputmode="decimal" id="tx-amount" value="${t.amount ? esc((t.amount < 0 ? '-' : '') + C.centsToInput(t.amount)) : ''}" placeholder="-12,50"></label>
        <label class="field"><span>Rekening</span><select id="tx-account">${accountOptions(t.accountId)}</select></label>
        <label class="field"><span>Tegenpartij</span><input type="text" id="tx-counterparty" value="${esc(t.counterparty)}" placeholder="bv. Colruyt"></label>
        <label class="field full"><span>Mededeling / omschrijving</span><input type="text" id="tx-description" value="${esc(t.description)}"></label>
        <label class="field"><span>IBAN tegenpartij</span><input type="text" id="tx-iban" value="${esc(C.formatIban(t.counterpartyIban))}" placeholder="BE.."></label>
        <label class="field"><span>Categorie${t.categorySource === 'rule' ? ' <span class="muted">(via regel)</span>' : ''}</span><select id="tx-category">${categoryOptions(t.categoryId)}</select></label>
      </div>

      <div class="section">
        <h3>Opsplitsen over categorieën <button class="btn small" data-action="add-split" type="button">+ Splitsing</button></h3>
        <p class="small muted" style="margin:0 0 8px">Verdeel bv. een kasticket van € 55 in € 40 voeding en € 15 huishoudartikelen. Een eventuele rest gaat naar de categorie hierboven.</p>
        <div id="splits">${splitRows}</div>
        <div class="small" id="split-remaining"></div>
      </div>

      <div class="section">
        <h3>Interne overschrijving</h3>
        <select id="tx-transfer">
          <option value="auto" ${t.transferMode === 'auto' ? 'selected' : ''}>Automatisch (${autoTransfer ? 'herkend als eigen rekening' : 'niet herkend'})</option>
          <option value="yes" ${t.transferMode === 'yes' ? 'selected' : ''}>Ja, overschrijving tussen eigen rekeningen</option>
          <option value="no" ${t.transferMode === 'no' ? 'selected' : ''}>Nee, gewone transactie</option>
        </select>
        ${pair ? `<p class="small muted" style="margin:6px 0 0">Gekoppeld aan ${money(pair.amount)} op ${esc(accName(pair.accountId))} (${fmtDate(pair.date)}).</p>` : ''}
      </div>

      ${t.amount > 0 || t.refundOf ? `<div class="section">
        <h3>Terugbetaling van een uitgave</h3>
        <p class="small muted" style="margin:0 0 8px">Koppel bv. een Tikkie of Payconiq na een etentje aan de oorspronkelijke uitgave. Het bedrag vermindert dan die uitgave (in dezelfde categorie en maand) in plaats van als inkomen te tellen.</p>
        <select id="tx-refund" style="width:100%"><option value="">— Geen terugbetaling —</option>
          ${suggestions.map(s => `<option value="${esc(s.tx.id)}" ${t.refundOf === s.tx.id ? 'selected' : ''}>${fmtDate(s.tx.date)} · ${esc(s.tx.counterparty || s.tx.description)} · ${money(s.tx.amount)} (${esc(catName(C.splitLines(s.tx)[0].categoryId))})</option>`).join('')}
        </select>
        ${!suggestions.length ? '<p class="small muted">Geen passende uitgaven gevonden in de 90 dagen voor deze betaling.</p>' : ''}
      </div>` : ''}

      ${refundedBy.length ? `<div class="section"><h3>Terugbetalingen voor deze uitgave</h3>
        ${refundedBy.map(r => `<div class="small">${fmtDate(r.date)} · ${esc(r.counterparty || r.description)} · <span class="pos">${money(r.amount)}</span></div>`).join('')}
        <div class="small" style="margin-top:6px">Netto kost: <strong>${money(t.amount + refundedBy.reduce((s, r) => s + r.amount, 0))}</strong></div></div>` : ''}

      <label class="field"><span>Notitie</span><textarea id="tx-note" rows="2">${esc(t.note || '')}</textarea></label>
      <div class="errors" id="tx-errors"></div>`;
    const foot = `${!isNew ? '<button class="btn danger" data-action="delete-tx">Verwijderen</button>' : ''}
      ${!isNew && (t.counterparty || t.description) ? '<button class="btn" data-action="rule-from-tx">Regel maken…</button>' : ''}
      <span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>
      <button class="btn primary" data-action="save-tx">${isNew ? 'Toevoegen' : 'Opslaan'}</button>`;
    return modalShell(isNew ? 'Manuele transactie' : 'Transactie bewerken', body, foot);
  }

  function splitRow(s) {
    s = s || {};
    return `<div class="split-row">
      <select class="split-cat">${categoryOptions(s.categoryId, { emptyLabel: '— Categorie —' })}</select>
      <input type="text" inputmode="decimal" class="split-amount" placeholder="0,00" value="${s.amount ? esc(C.centsToInput(s.amount)) : ''}">
      <input type="text" class="split-note note" placeholder="notitie" value="${esc(s.note || '')}">
      <button class="btn small ghost" type="button" data-action="remove-split" aria-label="Verwijder splitsing">✕</button></div>`;
  }

  function readSplits(sign) {
    return $$('#splits .split-row').map(row => {
      const amt = C.parseAmount($('.split-amount', row).value);
      return {
        categoryId: $('.split-cat', row).value || null,
        amount: isNaN(amt) ? 0 : Math.abs(amt) * (sign < 0 ? -1 : 1),
        note: $('.split-note', row).value.trim()
      };
    }).filter(s => s.categoryId || s.amount);
  }

  function updateSplitRemaining() {
    const el = $('#split-remaining');
    if (!el) return;
    const amount = C.parseAmount($('#tx-amount').value);
    const splits = readSplits(amount);
    if (!splits.length || isNaN(amount)) { el.textContent = ''; return; }
    const used = splits.reduce((s, x) => s + Math.abs(x.amount), 0);
    const rest = Math.abs(amount) - used;
    el.innerHTML = rest < 0
      ? `<span style="color:var(--red)">${money(-rest)} te veel verdeeld</span>`
      : `Verdeeld: ${money(used)} · rest ${money(rest)}${rest > 0 ? ' → ' + esc(catName($('#tx-category').value || null)) : ' ✓'}`;
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
    if (refundOf && amount < 0) errors.push('Een terugbetaling moet een inkomend (positief) bedrag zijn.');
    if (splits.length) errors.push(...C.validateSplits({ amount }, splits));
    if (errors.length) { $('#tx-errors').innerHTML = errors.map(esc).join('<br>'); return; }

    const newCat = $('#tx-category').value || null;
    const catChanged = newCat !== t.categoryId;
    Object.assign(t, {
      date,
      amount,
      accountId: $('#tx-account').value,
      counterparty: $('#tx-counterparty').value.trim(),
      description: $('#tx-description').value.trim(),
      counterpartyIban: C.normalizeIban($('#tx-iban').value),
      transferMode: $('#tx-transfer').value,
      refundOf,
      splits,
      note: $('#tx-note').value.trim()
    });
    if (catChanged || splits.length) {
      t.categoryId = newCat;
      t.categorySource = newCat || splits.length ? 'manual' : null;
      t.ruleId = null;
    }
    // modal.tx is een kopie: vervang het origineel pas bij opslaan
    const idx = state.transactions.findIndex(x => x.id === t.id);
    if (idx >= 0) state.transactions[idx] = t;
    else {
      t.createdAt = Date.now();
      state.transactions.push(t);
    }
    closeModal();
    commit('Transactie opgeslagen');
  }

  function newTx() {
    return {
      id: C.uid('tx'), accountId: (state.accounts.find(a => a.type === 'cash') || state.accounts[0] || {}).id,
      date: today, amount: 0, counterparty: '', counterpartyIban: '', description: '',
      categoryId: null, categorySource: null, splits: [], source: 'manual', transferMode: 'auto', refundOf: null
    };
  }

  // ----- Regel -----

  function ruleModal() {
    const r = modal.rule;
    const body = `
      <div class="form-grid">
        <label class="field full"><span>Naam</span><input type="text" id="rule-name" value="${esc(r.name)}" placeholder="bv. Colruyt"></label>
        <label class="field"><span>Als</span><select id="rule-field">${Object.entries(C.RULE_FIELDS).map(([k, v]) => `<option value="${k}" ${r.field === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Voorwaarde</span><select id="rule-operator">${Object.entries(C.RULE_OPERATORS).map(([k, v]) => `<option value="${k}" ${r.operator === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field full"><span>Waarde</span><input type="text" id="rule-value" value="${esc(r.value)}" placeholder="bv. Colruyt of BE12 3456 7890 1234"></label>
        <label class="field"><span>Dan categorie</span><select id="rule-category">${categoryOptions(r.categoryId, { emptyLabel: '— Kies —' })}</select></label>
        <label class="field"><span>Enkel voor</span><select id="rule-direction">
          <option value="any" ${!r.direction || r.direction === 'any' ? 'selected' : ''}>In- en uitgaven</option>
          <option value="out" ${r.direction === 'out' ? 'selected' : ''}>Uitgaven</option>
          <option value="in" ${r.direction === 'in' ? 'selected' : ''}>Inkomsten</option></select></label>
        <label class="field"><span>Rekening</span><select id="rule-account"><option value="">Alle rekeningen</option>${accountOptions(r.accountId)}</select></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="rule-enabled" ${r.enabled !== false ? 'checked' : ''}> Actief</label>
        <label class="check full"><input type="checkbox" id="rule-override"> Ook toepassen op transacties die ik manueel een categorie gaf</label>
      </div>
      <div class="section"><h3>Voorbeeld</h3><div id="rule-preview" class="small"></div></div>
      <div class="errors" id="rule-errors"></div>`;
    const isNew = !state.rules.some(x => x.id === r.id);
    const foot = `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>
      <button class="btn primary" data-action="save-rule">${isNew ? 'Regel toevoegen' : 'Opslaan'}</button>`;
    return modalShell(isNew ? 'Nieuwe regel' : 'Regel bewerken', body, foot);
  }

  function readRuleForm() {
    const dir = $('#rule-direction').value;
    return Object.assign({}, modal.rule, {
      name: $('#rule-name').value.trim() || $('#rule-value').value.trim(),
      field: $('#rule-field').value,
      operator: $('#rule-operator').value,
      value: $('#rule-value').value.trim(),
      categoryId: $('#rule-category').value || null,
      direction: dir === 'any' ? null : dir,
      accountId: $('#rule-account').value || null,
      enabled: $('#rule-enabled').checked
    });
  }

  function updateRulePreview() {
    const el = $('#rule-preview');
    if (!el) return;
    const r = Object.assign(readRuleForm(), { enabled: true });
    if (!r.value) { el.innerHTML = '<span class="muted">Vul een waarde in om te zien welke transacties overeenkomen.</span>'; return; }
    if (r.operator === 'regex') { try { new RegExp(r.value); } catch (e) { el.innerHTML = '<span style="color:var(--red)">Ongeldige reguliere expressie.</span>'; return; } }
    const matches = state.transactions.filter(t => !t.isTransfer && C.ruleMatches(r, t));
    const earlier = matches.filter(t => t.categorySource === 'rule' && t.ruleId && t.ruleId !== r.id);
    el.innerHTML = `<strong>${matches.length}</strong> transactie(s) komen overeen${earlier.length ? ` (waarvan ${earlier.length} al door een andere regel gecategoriseerd — de volgorde bepaalt welke wint)` : ''}.
      ${matches.slice(0, 6).map(t => `<div class="muted">${fmtDate(t.date)} · ${esc(t.counterparty)} · ${esc(t.description).slice(0, 60)} · ${money(t.amount)}</div>`).join('')}`;
  }

  function saveRule() {
    const r = readRuleForm();
    const errors = [];
    if (!r.value) errors.push('Geef een waarde.');
    if (!r.categoryId) errors.push('Kies een categorie.');
    if (r.operator === 'regex') { try { new RegExp(r.value); } catch (e) { errors.push('Ongeldige reguliere expressie.'); } }
    if (errors.length) { $('#rule-errors').innerHTML = errors.join('<br>'); return; }
    const idx = state.rules.findIndex(x => x.id === r.id);
    if (idx >= 0) state.rules[idx] = r;
    else {
      r.priority = Math.max(0, ...state.rules.map(x => x.priority || 0)) + 10;
      state.rules.push(r);
    }
    if ($('#rule-override').checked) {
      for (const t of state.transactions) {
        if (t.categorySource === 'manual' && !(t.splits && t.splits.length) && C.ruleMatches(r, t)) t.categorySource = null;
      }
    }
    closeModal();
    commit('Regel opgeslagen en toegepast');
  }

  function moveRule(id, delta) {
    const rules = C.sortedRules(state.rules);
    rules.forEach((r, i) => { r.priority = (i + 1) * 10; });
    const i = rules.findIndex(r => r.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= rules.length) return;
    const p = rules[i].priority;
    rules[i].priority = rules[j].priority;
    rules[j].priority = p;
    commit();
  }

  // ----- Budget -----

  function budgetModal() {
    const b = modal.budget;
    const isNew = !state.budgets.some(x => x.id === b.id);
    const body = `<div class="form-grid">
        <label class="field full"><span>Categorie</span><select id="bud-category">${categoryOptions(b.categoryId, { kind: 'expense', emptyLabel: '— Kies —' })}</select></label>
        <label class="field"><span>Periode</span><select id="bud-period">
          <option value="monthly" ${b.period !== 'yearly' ? 'selected' : ''}>Maandelijks</option>
          <option value="yearly" ${b.period === 'yearly' ? 'selected' : ''}>Jaarlijks</option></select></label>
        <label class="field"><span>Limiet (€)</span><input type="text" inputmode="decimal" id="bud-limit" value="${b.limit ? esc(C.centsToInput(b.limit)) : ''}" placeholder="400,00"></label>
        <label class="field"><span>Waarschuwen vanaf (% van limiet)</span><input type="number" min="1" max="100" id="bud-warn" value="${Math.round((b.warnAt != null ? b.warnAt : 0.8) * 100)}"></label>
      </div><div class="errors" id="bud-errors"></div>`;
    const foot = `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>
      <button class="btn primary" data-action="save-budget">${isNew ? 'Toevoegen' : 'Opslaan'}</button>`;
    return modalShell(isNew ? 'Nieuw budget' : 'Budget bewerken', body, foot);
  }

  function saveBudget() {
    const b = modal.budget;
    const categoryId = $('#bud-category').value;
    const period = $('#bud-period').value;
    const limit = Math.abs(C.parseAmount($('#bud-limit').value));
    const warn = Number($('#bud-warn').value);
    const errors = [];
    if (!categoryId) errors.push('Kies een categorie.');
    if (!limit || isNaN(limit)) errors.push('Geef een geldige limiet.');
    if (!(warn >= 1 && warn <= 100)) errors.push('Waarschuwingsdrempel moet tussen 1 en 100% liggen.');
    if (state.budgets.some(x => x.id !== b.id && x.categoryId === categoryId && x.period === period)) errors.push('Er bestaat al een ' + (period === 'yearly' ? 'jaar' : 'maand') + 'budget voor deze categorie.');
    if (errors.length) { $('#bud-errors').innerHTML = errors.join('<br>'); return; }
    Object.assign(b, { categoryId, period, limit, warnAt: warn / 100 });
    if (!state.budgets.includes(b)) state.budgets.push(b);
    closeModal();
    commit('Budget opgeslagen');
  }

  // ----- Rekening & categorie -----

  function accountModal() {
    const a = modal.account;
    const body = `<div class="form-grid">
      <label class="field"><span>Naam</span><input type="text" id="acc-name" value="${esc(a.name)}"></label>
      <label class="field"><span>Type</span><select id="acc-type">${[['zicht', 'Zichtrekening'], ['spaar', 'Spaarrekening'], ['cash', 'Cash'], ['krediet', 'Kredietkaart'], ['andere', 'Andere']].map(([v, l]) => `<option value="${v}" ${a.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field full"><span>IBAN (voor herkenning van interne overschrijvingen)</span><input type="text" id="acc-iban" value="${esc(C.formatIban(a.iban))}" placeholder="BE00 0000 0000 0000"></label>
      </div><div class="errors" id="acc-errors"></div>`;
    const foot = `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="save-account">Opslaan</button>`;
    return modalShell(state.accounts.includes(a) ? 'Rekening bewerken' : 'Nieuwe rekening', body, foot);
  }

  function saveAccount() {
    const a = modal.account;
    const name = $('#acc-name').value.trim();
    const iban = C.normalizeIban($('#acc-iban').value);
    if (!name) { $('#acc-errors').textContent = 'Geef een naam.'; return; }
    if (iban && state.accounts.some(x => x !== a && C.normalizeIban(x.iban) === iban)) { $('#acc-errors').textContent = 'Deze IBAN is al gekoppeld aan een andere rekening.'; return; }
    Object.assign(a, { name, iban, type: $('#acc-type').value });
    if (!state.accounts.includes(a)) state.accounts.push(a);
    closeModal();
    commit('Rekening opgeslagen');
  }

  function categoryModal() {
    const c = modal.category;
    const body = `<div class="form-grid">
      <label class="field"><span>Naam</span><input type="text" id="cat-name" value="${esc(c.name)}"></label>
      <label class="field"><span>Soort</span><select id="cat-kind"><option value="expense" ${c.kind !== 'income' ? 'selected' : ''}>Uitgaven</option><option value="income" ${c.kind === 'income' ? 'selected' : ''}>Inkomsten</option></select></label>
      <label class="field"><span>Kleur</span><input type="color" id="cat-color" value="${esc(c.color || '#3b5bdb')}"></label>
      </div><div class="errors" id="cat-errors"></div>`;
    const foot = `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="save-category">Opslaan</button>`;
    return modalShell(state.categories.includes(c) ? 'Categorie bewerken' : 'Nieuwe categorie', body, foot);
  }

  function saveCategory() {
    const c = modal.category;
    const name = $('#cat-name').value.trim();
    if (!name) { $('#cat-errors').textContent = 'Geef een naam.'; return; }
    if (state.categories.some(x => x !== c && x.name.toLowerCase() === name.toLowerCase())) { $('#cat-errors').textContent = 'Deze categorie bestaat al.'; return; }
    Object.assign(c, { name, kind: $('#cat-kind').value, color: $('#cat-color').value });
    if (!state.categories.includes(c)) state.categories.push(c);
    closeModal();
    commit('Categorie opgeslagen');
  }

  // ----- CSV-import -----

  function importModal() {
    const m = modal;
    let body;
    if (!m.rows) {
      body = `<p>Exporteer je rekeninguittreksels als CSV vanuit je bank (KBC, BNP Paribas Fortis, Belfius, ING, Argenta, …) en kies het bestand hieronder.
        Flux herkent de kolommen automatisch; je kan ze nadien nog aanpassen.</p>
        <div class="form-grid">
          <label class="field"><span>Rekening</span><select id="imp-account">${accountOptions(m.accountId)}</select></label>
          <label class="field"><span>CSV-bestand</span><input type="file" id="imp-file" accept=".csv,.txt,text/csv"></label>
        </div><div class="errors" id="imp-errors"></div>`;
      return modalShell('Transacties importeren', body, '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>');
    }
    const headers = m.rows[m.headerRow] || [];
    const colOptions = sel => `<option value="">—</option>` + headers.map((h, i) => `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(h || 'Kolom ' + (i + 1))}</option>`).join('');
    const fields = [['date', 'Datum *'], ['amount', 'Bedrag'], ['debit', 'Debet (indien apart)'], ['credit', 'Credit (indien apart)'], ['sign', 'Af/Bij-kolom'], ['counterparty', 'Tegenpartij'], ['counterpartyIban', 'IBAN tegenpartij'], ['description', 'Mededeling']];
    const preview = previewImport();
    body = `
      <p class="small muted">${esc(m.fileName)} · ${m.rows.length - m.headerRow - 1} rijen · scheidingsteken "${m.delimiter === '\t' ? 'tab' : esc(m.delimiter)}"</p>
      <div class="form-grid">
        <label class="field"><span>Rekening</span><select id="imp-account">${accountOptions(m.accountId)}</select></label>
        <label class="field"><span>Kopregel staat op rij</span><input type="number" min="1" id="imp-header" value="${m.headerRow + 1}"></label>
        ${fields.map(([k, l]) => `<label class="field"><span>${l}</span><select data-map="${k}">${colOptions(m.mapping[k])}</select></label>`).join('')}
      </div>
      <div class="section"><h3>Voorbeeld</h3>
        ${preview.transactions.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Tegenpartij</th><th>Mededeling</th><th class="right">Bedrag</th><th>Categorie</th></tr></thead><tbody>
          ${preview.transactions.slice(0, 8).map(t => `<tr><td class="nowrap">${fmtDate(t.date)}</td><td>${esc(t.counterparty)}<div class="small muted">${esc(C.formatIban(t.counterpartyIban))}</div></td><td class="desc">${esc(t.description)}</td><td class="amount ${amountClass(t.amount)}">${money(t.amount)}</td><td>${t.isTransfer ? '<span class="badge transfer">Intern</span>' : catBadge(t.categoryId)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
        <p class="small">${preview.transactions.length} geldig · ${preview.duplicates} dubbel (worden overgeslagen) · ${preview.errors} ongeldige rij(en)</p>
      </div><div class="errors" id="imp-errors"></div>`;
    const foot = `<button class="btn" data-action="import-restart">Ander bestand</button><span class="spacer"></span>
      <button class="btn" data-action="close-modal">Annuleren</button>
      <button class="btn primary" data-action="do-import" ${preview.transactions.length ? '' : 'disabled'}>Importeer ${preview.transactions.length} transacties</button>`;
    return modalShell('Transacties importeren', body, foot, true);
  }

  function findHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const m = C.guessMapping(rows[i]);
      if (m.date != null && (m.amount != null || m.debit != null || m.credit != null)) return i;
    }
    return 0;
  }

  function loadImportFile(file) {
    const reader = new FileReader();
    const parse = (text, encoding) => {
      if (text.includes('�') && encoding === 'utf-8') {
        const r2 = new FileReader();
        r2.onload = () => parse(r2.result, 'windows-1252');
        r2.readAsText(file, 'windows-1252');
        return;
      }
      const { rows, delimiter } = C.parseCSV(text);
      if (rows.length < 2) { $('#imp-errors').textContent = 'Dit bestand bevat geen leesbare rijen.'; return; }
      const headerRow = findHeaderRow(rows);
      modal.accountId = $('#imp-account').value;
      Object.assign(modal, { rows, delimiter, headerRow, mapping: C.guessMapping(rows[headerRow]), fileName: file.name });
      renderModal();
    };
    reader.onload = () => parse(reader.result, 'utf-8');
    reader.readAsText(file, 'utf-8');
  }

  function previewImport() {
    const m = modal;
    const data = m.rows.slice(m.headerRow + 1);
    const res = C.rowsToTransactions(data, m.mapping, m.accountId);
    const { fresh, duplicates } = C.dedupe(state.transactions, res.transactions);
    // Voorbeeldcategorisatie zonder de echte gegevens te wijzigen
    const temp = { accounts: state.accounts, categories: state.categories, rules: state.rules, transactions: fresh.map(t => Object.assign({}, t)) };
    C.detectTransfers(temp);
    C.applyRules(temp);
    return { transactions: temp.transactions, freshRaw: fresh, duplicates: duplicates.length, errors: res.errors.length };
  }

  function doImport() {
    const preview = previewImport();
    const now = Date.now();
    preview.freshRaw.forEach((t, i) => { t.createdAt = now + i; state.transactions.push(t); });
    closeModal();
    ui.view = 'transactions';
    ui.tx = Object.assign(ui.tx, { search: '', category: '', type: '', month: '', account: '' });
    location.hash = 'transactions';
    commit(`${preview.freshRaw.length} transacties geïmporteerd${preview.duplicates ? `, ${preview.duplicates} dubbels overgeslagen` : ''}`);
  }

  // ---------- Gegevens ----------

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCSV() {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Datum', 'Rekening', 'Tegenpartij', 'IBAN tegenpartij', 'Mededeling', 'Bedrag', 'Categorie', 'Type', 'Notitie'].map(q).join(';')];
    for (const t of state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const type = t.isTransfer ? 'Interne overschrijving' : t.refundOf ? 'Terugbetaling' : t.splits && t.splits.length ? 'Gesplitst' : '';
      const cats = t.refundOf ? 'Terugbetaling' : C.splitLines(t).map(l => catName(l.categoryId) + (t.splits.length ? ' ' + C.centsToInput(l.amount) : '')).join(' + ');
      lines.push([fmtDate(t.date), accName(t.accountId), t.counterparty, C.formatIban(t.counterpartyIban), t.description,
        (t.amount < 0 ? '-' : '') + C.centsToInput(t.amount), cats, type, t.note || ''].map(q).join(';'));
    }
    download('flux-transacties-' + today + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(r.result);
          if (!data || !Array.isArray(data.transactions)) throw new Error('geen Flux-back-up');
          if (!confirm('Alle huidige gegevens vervangen door deze back-up?')) return;
          state = Store.migrate(data);
          commit('Back-up teruggezet');
        } catch (e) { toast('Ongeldig back-upbestand: ' + e.message); }
      };
      r.readAsText(file);
    };
    input.click();
  }

  // ---------- Events ----------

  const actions = {
    'month': el => { const d = Number(el.dataset.delta); ui.month = d === 0 ? today.slice(0, 7) : shiftMonth(ui.month, d); render(); },
    'import': () => openModal({ type: 'import', accountId: (state.accounts.find(a => a.type === 'zicht') || state.accounts[0] || {}).id }),
    'import-restart': () => openModal({ type: 'import', accountId: modal.accountId }),
    'do-import': doImport,
    'new-tx': () => openModal({ type: 'tx', tx: newTx() }),
    'edit-tx': el => { const t = txById(el.dataset.id); if (t) openModal({ type: 'tx', tx: JSON.parse(JSON.stringify(t)) }); },
    'save-tx': saveTx,
    'delete-tx': () => {
      const t = txById(modal.tx.id);
      if (!t || !confirm('Deze transactie verwijderen?')) return;
      state.transactions = state.transactions.filter(x => x.id !== t.id);
      closeModal();
      commit('Transactie verwijderd');
    },
    'add-split': () => {
      const container = $('#splits');
      if (!container.children.length) {
        // Eerste splitsing: begin met de huidige categorie en het volledige bedrag
        const amount = C.parseAmount($('#tx-amount').value);
        container.insertAdjacentHTML('beforeend', splitRow({ categoryId: $('#tx-category').value || null, amount: isNaN(amount) ? 0 : amount }));
      }
      container.insertAdjacentHTML('beforeend', splitRow());
      updateSplitRemaining();
    },
    'remove-split': el => { el.closest('.split-row').remove(); updateSplitRemaining(); },
    'rule-from-tx': () => {
      const t = modal.tx;
      const useCp = !!t.counterparty;
      const value = useCp ? t.counterparty.replace(/\s+\d.*$/, '') : t.description.split(/\s+/).slice(0, 2).join(' ');
      openModal({ type: 'rule', rule: { id: C.uid('rule'), name: value, field: useCp ? 'counterparty' : 'description', operator: 'contains', value, categoryId: $('#tx-category').value || t.categoryId, direction: t.amount < 0 ? 'out' : 'in', enabled: true } });
    },
    'new-rule': () => openModal({ type: 'rule', rule: { id: C.uid('rule'), name: '', field: 'any', operator: 'contains', value: '', categoryId: null, direction: 'out', enabled: true } }),
    'edit-rule': el => { const r = state.rules.find(x => x.id === el.dataset.id); if (r) openModal({ type: 'rule', rule: Object.assign({}, r) }); },
    'save-rule': saveRule,
    'delete-rule': el => { if (!confirm('Deze regel verwijderen?')) return; state.rules = state.rules.filter(r => r.id !== el.dataset.id); commit('Regel verwijderd'); },
    'toggle-rule': el => { const r = state.rules.find(x => x.id === el.dataset.id); r.enabled = r.enabled === false; commit(); },
    'rule-up': el => moveRule(el.dataset.id, -1),
    'rule-down': el => moveRule(el.dataset.id, 1),
    'apply-rules': () => {
      const before = JSON.stringify(state.transactions.map(t => t.categoryId));
      C.recompute(state);
      const after = state.transactions.map(t => t.categoryId);
      const changed = JSON.parse(before).filter((c, i) => c !== after[i]).length;
      commit(changed ? `${changed} transactie(s) aangepast` : 'Alles is al up-to-date');
    },
    'new-budget': () => openModal({ type: 'budget', budget: { id: C.uid('bud'), categoryId: null, period: 'monthly', limit: 0, warnAt: state.settings.warnAt } }),
    'edit-budget': el => { const b = state.budgets.find(x => x.id === el.dataset.id); if (b) openModal({ type: 'budget', budget: b }); },
    'save-budget': saveBudget,
    'delete-budget': el => { if (!confirm('Dit budget verwijderen?')) return; state.budgets = state.budgets.filter(b => b.id !== el.dataset.id); commit('Budget verwijderd'); },
    'budget-tx': el => {
      const b = state.budgets.find(x => x.id === el.dataset.id);
      Object.assign(ui.tx, { category: b.categoryId, month: b.period === 'monthly' ? ui.month : '', type: '', search: '', account: '' });
      go('transactions');
    },
    'sub-status': el => {
      const key = el.dataset.key;
      state.subscriptions[key] = Object.assign({}, state.subscriptions[key], { status: el.dataset.status });
      commit();
    },
    'sub-rename': el => {
      const key = el.dataset.key;
      const current = (state.subscriptions[key] || {}).name || '';
      const name = prompt('Naam voor deze vaste last:', current || key);
      if (name == null) return;
      state.subscriptions[key] = Object.assign({}, state.subscriptions[key], { name: name.trim() || undefined });
      commit();
    },
    'sub-tx': el => { Object.assign(ui.tx, { search: '', category: '', type: '', month: '', account: '' }); ui.tx.search = el.dataset.key; go('transactions'); },
    'toggle-ignored': () => { ui.showIgnored = !ui.showIgnored; render(); },
    'goto-uncategorized': () => { Object.assign(ui.tx, { category: '__none__', type: '', month: '', search: '', account: '' }); go('transactions'); },
    'goto-maybe-refunds': () => { Object.assign(ui.tx, { category: '', type: 'maybe-refund', month: '', search: '', account: '' }); go('transactions'); },
    'more-tx': () => { ui.tx.limit += 300; render(); },
    'new-account': () => openModal({ type: 'account', account: { id: C.uid('acc'), name: '', iban: '', type: 'zicht' } }),
    'edit-account': el => openModal({ type: 'account', account: acc(el.dataset.id) }),
    'save-account': saveAccount,
    'delete-account': el => {
      const id = el.dataset.id;
      const n = state.transactions.filter(t => t.accountId === id).length;
      if (state.accounts.length <= 1) { toast('Je hebt minstens één rekening nodig.'); return; }
      if (!confirm(n ? `Deze rekening en haar ${n} transacties verwijderen?` : 'Deze rekening verwijderen?')) return;
      state.accounts = state.accounts.filter(a => a.id !== id);
      state.transactions = state.transactions.filter(t => t.accountId !== id);
      commit('Rekening verwijderd');
    },
    'new-category': () => openModal({ type: 'category', category: { id: C.uid('cat'), name: '', kind: 'expense', color: '#3b5bdb' } }),
    'edit-category': el => openModal({ type: 'category', category: cat(el.dataset.id) }),
    'save-category': saveCategory,
    'delete-category': el => {
      const id = el.dataset.id;
      if (!confirm('Categorie "' + catName(id) + '" verwijderen? Transacties worden niet-gecategoriseerd; bijhorende regels en budgetten worden verwijderd.')) return;
      state.categories = state.categories.filter(c => c.id !== id);
      state.rules = state.rules.filter(r => r.categoryId !== id);
      state.budgets = state.budgets.filter(b => b.categoryId !== id);
      commit('Categorie verwijderd');
    },
    'export-json': () => download('flux-backup-' + today + '.json', JSON.stringify(state, null, 2), 'application/json'),
    'import-json': importJSON,
    'export-csv': exportCSV,
    'load-demo': () => {
      if (state.transactions.length && !confirm('Je huidige gegevens worden vervangen door demogegevens. Doorgaan?')) return;
      state = Store.demoState(today);
      commit('Demogegevens geladen');
    },
    'reset': () => {
      if (!confirm('Alle gegevens definitief wissen? Maak eerst een back-up als je twijfelt.')) return;
      Store.clear();
      state = Store.defaultState();
      commit('Alle gegevens gewist');
    },
    'close-modal': closeModal,
    'backdrop': (el, ev) => { if (ev.target === el) closeModal(); }
  };

  function go(view) {
    ui.view = view;
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    render();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', ev => {
    const nav = ev.target.closest('#nav button');
    if (nav) { go(nav.dataset.view); return; }
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') ev.preventDefault();
    fn(el, ev);
  });

  let searchTimer;
  document.addEventListener('input', ev => {
    const el = ev.target;
    if (el.dataset.filter === 'search') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        ui.tx.search = el.value; ui.tx.limit = 150;
        const pos = el.selectionStart;
        render();
        const s = $('[data-filter="search"]');
        s.focus(); s.setSelectionRange(pos, pos);
      }, 200);
    }
    if (modal && modal.type === 'tx' && (el.closest('#splits') || el.id === 'tx-amount')) updateSplitRemaining();
    if (modal && modal.type === 'rule') updateRulePreview();
  });

  document.addEventListener('change', ev => {
    const el = ev.target;
    if (el.dataset.filter && el.dataset.filter !== 'search') { ui.tx[el.dataset.filter] = el.value; ui.tx.limit = 150; render(); return; }
    if (!modal) return;
    if (modal.type === 'tx' && (el.closest('#splits') || el.id === 'tx-category')) updateSplitRemaining();
    if (modal.type === 'rule') updateRulePreview();
    if (modal.type === 'import') {
      if (el.id === 'imp-file' && el.files[0]) loadImportFile(el.files[0]);
      else if (el.id === 'imp-account') { modal.accountId = el.value; if (modal.rows) renderModal(); }
      else if (el.id === 'imp-header') {
        const n = Math.max(1, Math.min(modal.rows.length - 1, Number(el.value) || 1)) - 1;
        modal.headerRow = n;
        modal.mapping = C.guessMapping(modal.rows[n]);
        renderModal();
      } else if (el.dataset.map) {
        modal.mapping[el.dataset.map] = el.value === '' ? null : Number(el.value);
        renderModal();
      }
    }
  });

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && modal) closeModal();
  });

  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (v && v !== ui.view) { ui.view = v; render(); }
  });

  render();
})();
