/*
 * Flux — gebruikersinterface.
 */
(function () {
  'use strict';
  const C = window.FluxCore;
  const Store = window.FluxStore;
  const Sync = window.FluxSync;
  const Lookup = window.FluxLookup;

  let state = Store.load();
  let snap = C.snapshot(state); // laatste momentopname, om wijzigingen te herkennen voor synchronisatie
  const today = C.todayStr();
  const ui = {
    view: (location.hash || '#dashboard').slice(1),
    month: today.slice(0, 7),
    year: today.slice(0, 4),
    tx: { search: '', account: '', category: '', type: '', month: '', limit: 150 },
    showIgnored: false,
    auth: null, // { setupRequired, previousUser, error } wanneer aanmelden nodig is
    sync: { mode: 'local', status: 'idle' }
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
  function isIncomeCost(c) { return !!(c && c.kind !== 'income' && c.incomeId && cat(c.incomeId)); }
  function categoryOptions(selected, opts) {
    opts = opts || {};
    const groups = [
      ['expense', 'Uitgaven', c => c.kind !== 'income' && !isIncomeCost(c)],
      ['incomeCost', 'Kosten op inkomsten', c => isIncomeCost(c)],
      ['income', 'Inkomsten', c => c.kind === 'income']
    ].filter(([k]) => !opts.kind || opts.kind === k || (opts.kind === 'expense' && k === 'incomeCost'));
    let html = opts.allowEmpty !== false ? `<option value="">${esc(opts.emptyLabel || '— Geen categorie —')}</option>` : '';
    for (const [, label, test] of groups) {
      const list = state.categories.filter(test).sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) continue;
      html += `<optgroup label="${label}">` + list
        .map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}${isIncomeCost(c) ? ' (− ' + esc(catName(c.incomeId)) + ')' : ''}</option>`).join('') + '</optgroup>';
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

  /** Na elke wijziging: herberekenen, wijzigingen markeren voor synchronisatie, opslaan, opnieuw tekenen. */
  function commit(msg) {
    C.recompute(state);
    const changed = C.stampChanges(snap, state);
    snap = C.snapshot(state);
    if (!Store.save(state)) toast('Opslaan mislukt — is de opslag van je browser vol?');
    else if (msg) toast(msg);
    if (Sync) Sync.noteChanges(changed);
    render();
  }

  /** Vervangt de volledige staat (bv. na synchronisatie of het laden van demodata). */
  function setState(newState, options) {
    state = C.recompute(Store.migrate(JSON.parse(JSON.stringify(newState))));
    if (options && options.stampAll) {
      const changed = C.stampChanges(null, state);
      if (Sync) Sync.noteChanges(changed);
    }
    snap = C.snapshot(state);
    Store.save(state);
    if (!modal) render();
  }

  /** Vervangt alles door een nieuwe staat en markeert verwijderingen (zodat andere toestellen volgen). */
  function replaceAll(newState, msg) {
    const fresh = Store.migrate(newState);
    fresh.tombstones = state.tombstones || {};
    state = fresh;
    commit(msg);
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
    renderSyncBadge();
    if (ui.auth) { $('#nav').hidden = true; $('#main').innerHTML = renderAuth(); return; }
    $('#nav').hidden = false;
    const views = { dashboard: renderDashboard, transactions: renderTransactions, income: renderIncome, rules: renderRules, budgets: renderBudgets, recurring: renderRecurring, settings: renderSettings };
    const fn = views[ui.view] || renderDashboard;
    $('#main').innerHTML = fn();
  }

  // ----- Overzicht -----

  function incomeSources() { return state.categories.filter(c => c.kind === 'income'); }

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
    const candidates = C.lookupCandidates(state).length;

    const cats = Object.entries(sumNow.byCategory)
      .filter(([id, v]) => v < 0 && (id === '__none__' || (cat(id) && cat(id).kind === 'expense' && !isIncomeCost(cat(id)))))
      .map(([id, v]) => ({ id: id === '__none__' ? null : id, v: -v }))
      .sort((a, b) => b.v - a.v);
    const maxCat = cats.length ? cats[0].v : 1;

    const diff = (a, b) => {
      if (!b) return '';
      const p = Math.round((a - b) / Math.abs(b) * 100);
      return `${p >= 0 ? '+' : ''}${p}% t.o.v. vorige maand`;
    };
    const sources = Object.entries(sumNow.byIncome).sort((a, b) => b[1].gross - a[1].gross);

    return `
      <div class="page-head"><h1>Overzicht</h1><span class="spacer"></span>${monthNav()}
        <button class="btn" data-action="new-tx">+ Manueel</button>
        <button class="btn primary" data-action="import">CSV importeren</button></div>
      ${uncategorized || maybeRefunds ? `<div class="notice info">
        ${uncategorized ? `<a href="#" data-action="goto-uncategorized">${uncategorized} transactie(s) zonder categorie</a>` : ''}
        ${candidates ? ` — <a href="#" data-action="lookup">🔎 ${candidates} tegenpartij(en) online opzoeken</a>` : ''}
        ${uncategorized && maybeRefunds ? ' · ' : ''}
        ${maybeRefunds ? `<a href="#" data-action="goto-maybe-refunds">${maybeRefunds} mogelijke terugbetaling(en) nog niet gekoppeld</a>` : ''}
      </div>` : ''}
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Netto inkomsten</div><div class="value pos">${money(sumNow.netIncome)}</div>
          <div class="hint">bruto ${money(sumNow.income)}${sumNow.incomeCosts ? ' − kosten ' + money(sumNow.incomeCosts) : ''}${sumPrev.netIncome ? ' · ' + diff(sumNow.netIncome, sumPrev.netIncome) : ''}</div></div>
        <div class="card kpi"><div class="label">Uitgaven</div><div class="value">${money(sumNow.expenses)}</div><div class="hint">${diff(sumNow.expenses, sumPrev.expenses)} · na terugbetalingen</div></div>
        <div class="card kpi"><div class="label">Saldo</div><div class="value ${sumNow.net >= 0 ? 'pos' : ''}">${money(sumNow.net)}</div><div class="hint">${sumNow.netIncome > 0 && sumNow.net > 0 ? Math.round(sumNow.net / sumNow.netIncome * 100) + '% van netto inkomen gespaard' : sumNow.net < 0 ? 'meer uitgegeven dan verdiend' : ''}</div></div>
        <div class="card kpi"><div class="label">Intern overgeschreven</div><div class="value">${money(sumNow.transfers)}</div><div class="hint">Niet meegeteld als in- of uitgave</div></div>
      </div>
      <div class="grid two">
        <div class="card">
          <h2>Inkomsten per bron</h2>
          ${sources.length ? '<div class="list">' + sources.map(([id, v]) => `<div class="list-row">
              <span class="dot-lg" style="background:${esc(catColor(id === '__none__' ? null : id))}"></span>
              <div class="grow"><div>${esc(id === '__none__' ? 'Niet gecategoriseerd' : catName(id))}</div>
                <div class="small muted">bruto ${money(v.gross)}${v.costs ? ' − kosten ' + money(v.costs) : ''}</div></div>
              <span class="amount ${v.net >= 0 ? 'pos' : ''}">${money(v.net)}</span></div>`).join('') + '</div>'
            : '<p class="muted">Geen inkomsten deze maand.</p>'}
          <p class="small"><a href="#income" data-action="goto-income">Details per bron →</a></p>
        </div>
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
      return { m, inc: s.netIncome, exp: s.expenses };
    });
    const max = Math.max(1, ...data.map(d => Math.max(d.inc, d.exp)));
    const W = 520, H = 180, pad = 22, bw = (W - pad) / data.length;
    const h = v => Math.max(0, v) / max * (H - 30);
    const bars = data.map((d, i) => {
      const x = pad + i * bw;
      const label = C.MONTH_NAMES[Number(d.m.slice(5)) - 1];
      return `<g><title>${monthLabel(d.m)}: netto inkomsten ${money(d.inc)}, uitgaven ${money(d.exp)}</title>
        <rect x="${x + 3}" y="${H - 18 - h(d.inc)}" width="${bw / 2 - 4}" height="${h(d.inc)}" rx="2" fill="var(--green)" opacity=".75"/>
        <rect x="${x + bw / 2}" y="${H - 18 - h(d.exp)}" width="${bw / 2 - 4}" height="${h(d.exp)}" rx="2" fill="var(--primary)" opacity=".8"/>
        <text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${label}</text></g>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Netto inkomsten en uitgaven per maand">${bars}</svg>
      <div class="small muted"><span style="color:var(--green)">■</span> netto inkomsten &nbsp; <span style="color:var(--primary)">■</span> uitgaven</div>`;
  }

  // ----- Inkomsten -----

  function renderIncome() {
    const lines = C.allocations(state);
    const year = ui.year;
    const months = Array.from({ length: 12 }, (_, i) => year + '-' + String(i + 1).padStart(2, '0'));
    const yearSum = C.summarize(state, C.periodRange('yearly', year + '-01-01'), lines);
    const monthSums = months.map(m => C.summarize(state, C.periodRange('monthly', m + '-01'), lines));
    const sources = incomeSources();
    const ids = sources.map(c => c.id).concat(yearSum.byIncome.__none__ ? ['__none__'] : []);
    const currentMonthIdx = year === today.slice(0, 4) ? Number(today.slice(5, 7)) : (year < today.slice(0, 4) ? 12 : 0);
    const expected = C.detectRecurring(state, today, { direction: 'in' }).filter(r => r.userStatus !== 'ignored' && r.status !== 'gestopt');
    const costCats = state.categories.filter(isIncomeCost);
    const name = id => id === '__none__' ? 'Niet gecategoriseerd' : catName(id);

    const cards = ids.map(id => {
      const v = yearSum.byIncome[id] || { gross: 0, costs: 0, net: 0, costsByCategory: {} };
      const linked = costCats.filter(c => c.incomeId === id);
      const exp = expected.filter(r => r.categoryId === id);
      return `<div class="card">
        <div class="budget-card"><div class="top"><span class="name"><span class="dot-lg" style="background:${esc(catColor(id === '__none__' ? null : id))}"></span> ${esc(name(id))}</span>
          <span class="amount ${v.net >= 0 ? 'pos' : ''}">${money(v.net)}</span></div></div>
        <table class="mini">
          <tr><td>Bruto</td><td class="amount">${money(v.gross)}</td></tr>
          ${Object.entries(v.costsByCategory).map(([cid, a]) => `<tr><td>− ${esc(catName(cid))}</td><td class="amount">${money(-a)}</td></tr>`).join('')}
          <tr class="total"><td>Netto</td><td class="amount">${money(v.net)}</td></tr>
        </table>
        <div class="small muted" style="margin-top:8px">
          ${v.gross ? `Kosten: ${Math.round(v.costs / v.gross * 100)}% van bruto · ` : ''}${currentMonthIdx ? 'gemiddeld ' + money(Math.round(v.net / currentMonthIdx)) + ' netto per maand' : ''}
        </div>
        ${exp.length ? `<div class="small" style="margin-top:6px">Verwacht: ${exp.map(r => `${money(r.expected)} op ${fmtDate(r.nextDue)} (${esc(r.name)})`).join(', ')}</div>` : ''}
        ${id !== '__none__' && !linked.length ? `<div class="small muted" style="margin-top:6px">Nog geen kostcategorie gekoppeld. <a href="#" data-action="new-cost-category" data-id="${esc(id)}">Kostcategorie toevoegen</a></div>` : ''}
        ${id === '__none__' ? `<div class="small" style="margin-top:6px"><a href="#" data-action="goto-uncategorized-income">Bekijk deze inkomsten</a></div>` : ''}
      </div>`;
    }).join('');

    const yearOptions = Array.from(new Set(state.transactions.map(t => t.date.slice(0, 4)).concat([today.slice(0, 4)]))).sort().reverse();
    return `
      <div class="page-head"><h1>Inkomsten</h1><span class="spacer"></span>
        <select data-ui="year">${yearOptions.map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <button class="btn" data-action="new-category" data-kind="income">+ Inkomstenbron</button></div>
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Bruto inkomsten ${esc(year)}</div><div class="value">${money(yearSum.income)}</div></div>
        <div class="card kpi"><div class="label">Kosten op inkomsten</div><div class="value">${money(yearSum.incomeCosts)}</div><div class="hint">Afgetrokken van de bron waaraan ze gekoppeld zijn</div></div>
        <div class="card kpi"><div class="label">Netto inkomsten</div><div class="value pos">${money(yearSum.netIncome)}</div></div>
        <div class="card kpi"><div class="label">Gewone uitgaven</div><div class="value">${money(yearSum.expenses)}</div><div class="hint">Saldo ${money(yearSum.net)}</div></div>
      </div>
      <p class="muted">Elke inkomstencategorie is een <strong>inkomstenbron</strong>. Kosten die bij een bron horen (bv. materiaal, software of een commissie voor je bijberoep)
        boek je op een <strong>kostcategorie</strong> die aan die bron gekoppeld is: ze worden dan van die inkomsten afgetrokken in plaats van bij je gewone uitgaven te tellen.
        Werd een kost al van een betaling afgehouden? Splits de ontvangst dan in bruto (+) en kost (−).</p>
      <div class="grid cards" style="margin-bottom:16px">${cards}</div>
      <div class="card">
        <h2>Netto per maand</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Maand</th>${ids.map(id => `<th class="right">${esc(name(id))}</th>`).join('')}<th class="right">Totaal netto</th></tr></thead>
          <tbody>${months.map((m, i) => {
            const ms = monthSums[i];
            if (!ms.income && !ms.incomeCosts) return '';
            return `<tr><td>${esc(monthLabel(m))}</td>${ids.map(id => {
              const v = ms.byIncome[id];
              return `<td class="amount" title="${v ? 'bruto ' + money(v.gross) + ' − kosten ' + money(v.costs) : ''}">${v ? money(v.net) : '—'}${v && v.costs ? `<div class="small muted">−${money(v.costs)}</div>` : ''}</td>`;
            }).join('')}<td class="amount">${money(ms.netIncome)}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;
  }

  // ----- Account / synchronisatie -----

  function renderSyncBadge() {
    const el = $('#sync-badge');
    if (!el) return;
    const s = ui.sync;
    let text = '', cls = '';
    if (s.mode === 'local') { text = 'Lokaal'; cls = 'muted'; }
    else if (s.mode === 'auth') { text = 'Niet aangemeld'; cls = 'warn'; }
    else if (s.status === 'syncing') { text = 'Synchroniseren…'; cls = 'muted'; }
    else if (s.mode === 'offline' || s.status === 'offline') { text = 'Offline' + (s.pending ? ` · ${s.pending} wacht` : ''); cls = 'warn'; }
    else if (s.status === 'error') { text = 'Synchronisatiefout'; cls = 'over'; }
    else { text = s.pending ? `${s.pending} wijziging(en) wachten` : '✓ Gesynchroniseerd'; cls = 'ok'; }
    el.className = 'badge sync ' + cls;
    el.textContent = text;
    el.title = s.mode === 'local' ? 'Gegevens staan enkel in deze browser. Host Flux op een server om ze op al je toestellen te gebruiken.'
      : (s.user ? 'Aangemeld als ' + s.user : '') + (s.lastSync ? ' · laatst gesynchroniseerd ' + new Date(s.lastSync).toLocaleTimeString('nl-BE') : '');
  }

  function renderAuth() {
    const a = ui.auth;
    if (a.setupRequired) {
      return `<div class="auth card">
        <h1>Flux instellen</h1>
        <p class="muted">Maak je account aan. De setupcode staat in de log van de server (bij het opstarten).</p>
        <form data-form="setup" class="form-stack">
          <label class="field"><span>Setupcode</span><input type="text" name="code" autocomplete="one-time-code" required autocapitalize="characters"></label>
          <label class="field"><span>Gebruikersnaam</span><input type="text" name="username" autocomplete="username" autocapitalize="none" required></label>
          <label class="field"><span>Wachtwoord (min. 8 tekens)</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
          <div class="errors">${esc(a.error || '')}</div>
          <button class="btn primary" type="submit">Account aanmaken</button>
        </form></div>`;
    }
    return `<div class="auth card">
      <h1><span class="logo">≈</span> Flux</h1>
      <p class="muted">${a.expired ? 'Je sessie is verlopen. Meld je opnieuw aan.' : 'Meld je aan om je boekhouding op dit toestel te openen.'}</p>
      <form data-form="login" class="form-stack">
        <label class="field"><span>Gebruikersnaam</span><input type="text" name="username" autocomplete="username" autocapitalize="none" value="${esc(a.previousUser || '')}" required></label>
        <label class="field"><span>Wachtwoord</span><input type="password" name="password" autocomplete="current-password" required></label>
        <div class="errors">${esc(a.error || '')}</div>
        <button class="btn primary" type="submit">Aanmelden</button>
      </form></div>`;
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
      if (f.type === 'income-cost' && !C.splitLines(t).some(l => isIncomeCost(cat(l.categoryId)))) return false;
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
        ${C.lookupCandidates(state).length ? `<button class="btn" data-action="lookup">🔎 Online opzoeken (${C.lookupCandidates(state).length})</button>` : ''}
        <button class="btn" data-action="new-tx">+ Manuele transactie</button>
        <button class="btn primary" data-action="import">CSV importeren</button></div>
      <div class="filters">
        <input type="search" placeholder="Zoeken in tegenpartij, mededeling, bedrag…" data-filter="search" value="${esc(f.search)}">
        <select data-filter="month"><option value="">Alle maanden</option>${months.map(m => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
        <select data-filter="account"><option value="">Alle rekeningen</option>${accountOptions(f.account)}</select>
        <select data-filter="category">${categoryOptions(f.category, { emptyLabel: 'Alle categorieën' }).replace('</option>', '</option><option value="__none__" ' + (f.category === '__none__' ? 'selected' : '') + '>Niet gecategoriseerd</option>')}</select>
        <select data-filter="type">
          ${[['', 'Alle types'], ['out', 'Uitgaven'], ['in', 'Inkomsten'], ['transfer', 'Interne overschrijvingen'], ['refund', 'Terugbetalingen'], ['maybe-refund', 'Mogelijke terugbetalingen'], ['split', 'Gesplitst'], ['income-cost', 'Kosten op inkomsten'], ['manual', 'Manueel ingevoerd']]
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
    const sy = ui.sync;
    const st = state.settings;
    const aiOn = !!(Sync && Sync.features && Sync.features.ai);
    const catKindLabel = c => c.kind === 'income' ? 'inkomstenbron' : isIncomeCost(c) ? 'kost op ' + catName(c.incomeId) : 'uitgaven';
    const catOrder = c => c.kind === 'income' ? 0 : isIncomeCost(c) ? 1 : 2;
    return `
      <div class="page-head"><h1>Instellingen</h1></div>
      <div class="grid two">
        <div class="card">
          <h2>Account & synchronisatie</h2>
          ${sy.mode === 'local' ? `<p class="small muted">Flux draait nu <strong>lokaal</strong>: je gegevens staan enkel in deze browser.
            Om Flux op al je toestellen (ook je iPhone) te gebruiken, host je de Flux-server en open je die in je browser — zie de README (sectie <em>Hosten</em>).
            Je kan je huidige gegevens daarna meenemen: bij het eerste aanmelden in dezelfde browser vraagt Flux of ze in je account mogen.</p>`
          : `<p>Aangemeld als <strong>${esc(sy.user || '')}</strong></p>
            <p class="small muted">${sy.lastSync ? 'Laatst gesynchroniseerd: ' + esc(new Date(sy.lastSync).toLocaleString('nl-BE')) : 'Nog niet gesynchroniseerd'}${sy.pending ? ' · ' + sy.pending + ' wijziging(en) wachten' : ''}</p>
            <p style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn" data-action="sync-now">Nu synchroniseren</button>
              <button class="btn" data-action="change-password">Wachtwoord wijzigen</button>
              <button class="btn" data-action="logout">Afmelden</button>
              <button class="btn danger" data-action="logout-all">Overal afmelden</button>
            </p>
            <p class="small muted">Op je iPhone: open Flux in Safari → deelknop → <em>Zet op beginscherm</em>. Flux werkt dan als app, ook even zonder verbinding; wijzigingen worden gesynchroniseerd zodra je weer online bent.</p>`}
        </div>
        <div class="card">
          <h2>Online opzoeken van tegenpartijen</h2>
          <p class="small muted">Flux gebruikt geen vaste lijst van winkels of bedrijven. Onbekende tegenpartijen worden online opgezocht en via de zoekwoorden van je categorieën aan een categorie gekoppeld. Wat jij goedkeurt wordt een regel, zodat volgende transacties vanzelf gecategoriseerd worden.</p>
          <div class="form-grid">
            <label class="field"><span>Bron</span><select data-setting="lookupProvider">
              <option value="auto" ${st.lookupProvider === 'auto' ? 'selected' : ''}>Automatisch${aiOn ? ' (AI + open bronnen)' : ' (open bronnen)'}</option>
              <option value="free" ${st.lookupProvider === 'free' ? 'selected' : ''}>Wikidata + OpenStreetMap (gratis)</option>
              <option value="ai" ${st.lookupProvider === 'ai' ? 'selected' : ''} ${aiOn ? '' : 'disabled'}>AI (Claude) met webzoekfunctie${aiOn ? '' : ' — niet ingesteld op de server'}</option>
            </select></label>
            <label class="field"><span>Landen (ISO-codes)</span><input type="text" data-setting="lookupCountries" value="${esc(st.lookupCountries || 'be')}" placeholder="be,nl"></label>
            <label class="check full"><input type="checkbox" data-setting="autoLookup" ${st.autoLookup !== false ? 'checked' : ''}> Na een import voorstellen om nieuwe tegenpartijen op te zoeken</label>
          </div>
          <p class="small muted">Privacy: enkel de naam van de tegenpartij wordt verstuurd naar Wikidata en OpenStreetMap${aiOn ? '; bij AI ook de eerste 120 tekens van de mededeling (naar Anthropic, via je eigen server)' : ''}. Geen bedragen, rekeningnummers of persoonsgegevens.</p>
        </div>
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
          <div class="list">${state.categories.slice().sort((a, b) => catOrder(a) - catOrder(b) || a.name.localeCompare(b.name)).map(c => `<div class="list-row">
            <span class="badge"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</span>
            <span class="grow small muted">${esc(catKindLabel(c))} · ${catCount[c.id] || 0} transacties${c.lookupTags ? '' : c.kind !== 'income' && !isIncomeCost(c) ? ' · <span title="Zonder zoekwoorden kan online opzoeken deze categorie niet voorstellen">geen zoekwoorden</span>' : ''}</span>
            <button class="btn small" data-action="edit-category" data-id="${esc(c.id)}">Bewerk</button>
            <button class="btn small danger" data-action="delete-category" data-id="${esc(c.id)}">✕</button></div>`).join('')}</div>
          <p style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-action="new-category">+ Categorie</button>
            <button class="btn" data-action="new-category" data-kind="income">+ Inkomstenbron</button></p>
        </div>
        <div class="card">
          <h2>Gegevens</h2>
          <p class="small muted">${sy.mode === 'local' ? 'Alles wordt enkel lokaal in deze browser bewaard. Maak regelmatig een back-up.' : 'Je gegevens staan op je Flux-server (en als kopie op dit toestel). Een extra back-up kan nooit kwaad.'}</p>
          <p style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-action="export-json">Back-up downloaden (JSON)</button>
            <button class="btn" data-action="import-json">Back-up terugzetten</button>
            <button class="btn" data-action="export-csv">Transacties exporteren (CSV)</button>
          </p>
          <p style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-action="load-demo">Demogegevens laden</button>
            <button class="btn danger" data-action="reset">Alles wissen${sy.mode !== 'local' ? ' (op alle toestellen)' : ''}</button>
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
    const fns = { tx: txModal, rule: ruleModal, budget: budgetModal, account: accountModal, category: categoryModal, import: importModal, lookup: lookupModal, password: passwordModal };
    const scroll = $('.modal-backdrop', root) ? $('.modal-backdrop', root).scrollTop : 0;
    root.innerHTML = fns[modal.type]();
    if (modal.focused) { $('.modal-backdrop', root).scrollTop = scroll; }
    else {
      modal.focused = true;
      const first = $('.modal-body input, .modal-body select', root);
      if (first && modal.type !== 'tx' && modal.type !== 'lookup') first.focus();
    }
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
    const splitRows = (t.splits || []).map(s => splitRow(Object.assign({}, s, { opposite: Math.sign(s.amount) !== Math.sign(t.amount) }))).join('');

    const body = `
      ${imported ? '<div class="notice info small">Geïmporteerde transactie. Je kan velden corrigeren; de wijzigingen blijven bewaard.</div>' : ''}
      <div class="form-grid">
        <label class="field"><span>Datum</span><input type="date" id="tx-date" value="${esc(t.date)}" required></label>
        <label class="field"><span>Bedrag (negatief = uitgave)</span><input type="text" inputmode="decimal" id="tx-amount" value="${t.amount ? esc((t.amount < 0 ? '-' : '') + C.centsToInput(t.amount)) : ''}" placeholder="-12,50"></label>
        <label class="field"><span>Rekening</span><select id="tx-account">${accountOptions(t.accountId)}</select></label>
        <label class="field"><span>Tegenpartij</span><input type="text" id="tx-counterparty" value="${esc(t.counterparty)}" placeholder="bv. Colruyt"></label>
        <label class="field full"><span>Mededeling / omschrijving</span><input type="text" id="tx-description" value="${esc(t.description)}"></label>
        <label class="field"><span>IBAN tegenpartij</span><input type="text" id="tx-iban" value="${esc(C.formatIban(t.counterpartyIban))}" placeholder="BE.."></label>
        <label class="field"><span>Categorie${t.categorySource === 'rule' ? ' <span class="muted">(via regel)</span>' : ''}</span>
          <span class="input-row"><select id="tx-category">${categoryOptions(t.categoryId)}</select>
          <button class="btn small" type="button" data-action="lookup-one" title="Zoek online wat voor zaak dit is">🔎 Zoek online</button></span></label>
        <div class="full small" id="tx-lookup-result"></div>
      </div>

      <div class="section">
        <h3>Opsplitsen over categorieën <button class="btn small" data-action="add-split" type="button">+ Splitsing</button></h3>
        <p class="small muted" style="margin:0 0 8px">Verdeel bv. een kasticket van € 55 in € 40 voeding en € 15 huishoudartikelen. Een eventuele rest gaat naar de categorie hierboven.
          Een bedrag met <strong>minteken</strong> telt in de andere richting: bv. € 900 ontvangen = € 1.000 honorarium en −100 commissie (kost op inkomsten).</p>
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
      <input type="text" inputmode="decimal" class="split-amount" placeholder="0,00" value="${s.amount ? esc((s.opposite ? '-' : '') + C.centsToInput(s.amount)) : ''}">
      <input type="text" class="split-note note" placeholder="notitie" value="${esc(s.note || '')}">
      <button class="btn small ghost" type="button" data-action="remove-split" aria-label="Verwijder splitsing">✕</button></div>`;
  }

  /** Splitsbedragen volgen het teken van de transactie; met een minteken ervoor de omgekeerde richting. */
  function readSplits(sign) {
    const dir = sign < 0 ? -1 : 1;
    return $$('#splits .split-row').map(row => {
      const amt = C.parseAmount($('.split-amount', row).value);
      return {
        categoryId: $('.split-cat', row).value || null,
        amount: isNaN(amt) ? 0 : amt * dir,
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
    const used = Math.abs(splits.reduce((s, x) => s + x.amount, 0));
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
    const updated = Object.assign({}, b, { categoryId, period, limit, warnAt: warn / 100 });
    const idx = state.budgets.findIndex(x => x.id === b.id);
    if (idx >= 0) state.budgets[idx] = updated; else state.budgets.push(updated);
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
    return modalShell(acc(a.id) ? 'Rekening bewerken' : 'Nieuwe rekening', body, foot);
  }

  function saveAccount() {
    const a = modal.account;
    const name = $('#acc-name').value.trim();
    const iban = C.normalizeIban($('#acc-iban').value);
    if (!name) { $('#acc-errors').textContent = 'Geef een naam.'; return; }
    if (iban && state.accounts.some(x => x.id !== a.id && C.normalizeIban(x.iban) === iban)) { $('#acc-errors').textContent = 'Deze IBAN is al gekoppeld aan een andere rekening.'; return; }
    const updated = Object.assign({}, a, { name, iban, type: $('#acc-type').value });
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
        <option value="incomeCost" ${kind === 'incomeCost' ? 'selected' : ''} ${incomes.length ? '' : 'disabled'}>Kost die van een inkomstenbron wordt afgetrokken</option>
      </select></label>
      <label class="field full" id="cat-income-field" ${kind === 'incomeCost' ? '' : 'hidden'}><span>Aftrekken van inkomstenbron</span>
        <select id="cat-income">${incomes.map(x => `<option value="${esc(x.id)}" ${c.incomeId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field full"><span>Zoekwoorden voor online opzoeken (komma's ertussen)</span>
        <textarea id="cat-tags" rows="3" placeholder="bv. supermarket, supermarkt, bakkerij">${esc(c.lookupTags || '')}</textarea>
        <span class="small muted" style="font-weight:normal">Woorden die beschrijven wat voor <em>soort</em> zaak in deze categorie hoort, in het Nederlands en/of Engels. Als een online opgezochte tegenpartij (via Wikidata of OpenStreetMap) zo omschreven wordt, stelt Flux deze categorie voor.</span></label>
      </div><div class="errors" id="cat-errors"></div>`;
    const isNew = !cat(c.id);
    const foot = `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="save-category">Opslaan</button>`;
    return modalShell(isNew ? 'Nieuwe categorie' : 'Categorie bewerken', body, foot);
  }

  function saveCategory() {
    const c = modal.category;
    const name = $('#cat-name').value.trim();
    if (!name) { $('#cat-errors').textContent = 'Geef een naam.'; return; }
    if (state.categories.some(x => x.id !== c.id && x.name.toLowerCase() === name.toLowerCase())) { $('#cat-errors').textContent = 'Deze categorie bestaat al.'; return; }
    const kind = $('#cat-kind').value;
    if (kind !== 'income' && state.categories.some(x => x.incomeId === c.id)) { $('#cat-errors').textContent = 'Er zijn kostcategorieën aan deze inkomstenbron gekoppeld; koppel die eerst los.'; return; }
    const updated = Object.assign({}, c, {
      name, color: $('#cat-color').value,
      kind: kind === 'income' ? 'income' : 'expense',
      lookupTags: $('#cat-tags').value.trim()
    });
    if (kind === 'incomeCost') updated.incomeId = $('#cat-income').value; else delete updated.incomeId;
    const idx = state.categories.findIndex(x => x.id === c.id);
    if (idx >= 0) state.categories[idx] = updated; else state.categories.push(updated);
    closeModal();
    commit('Categorie opgeslagen');
  }

  // ----- Wachtwoord -----

  function passwordModal() {
    const body = `<div class="form-stack">
      <label class="field"><span>Huidig wachtwoord</span><input type="password" id="pw-current" autocomplete="current-password"></label>
      <label class="field"><span>Nieuw wachtwoord (min. 8 tekens)</span><input type="password" id="pw-new" autocomplete="new-password"></label>
      <label class="field"><span>Herhaal nieuw wachtwoord</span><input type="password" id="pw-new2" autocomplete="new-password"></label>
      <div class="errors" id="pw-errors"></div></div>`;
    const foot = `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="save-password">Wijzigen</button>`;
    return modalShell('Wachtwoord wijzigen', body, foot);
  }

  async function savePassword() {
    const cur = $('#pw-current').value, a = $('#pw-new').value, b = $('#pw-new2').value;
    if (a !== b) { $('#pw-errors').textContent = 'De nieuwe wachtwoorden zijn niet gelijk.'; return; }
    try { await Sync.changePassword(cur, a); closeModal(); toast('Wachtwoord gewijzigd'); }
    catch (e) { $('#pw-errors').textContent = e.message; }
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
    const ids = new Set(preview.freshRaw.map(t => t.id));
    const cands = C.lookupCandidates(state).filter(c => c.txIds.some(id => ids.has(id)));
    if (cands.length && state.settings.autoLookup !== false &&
        confirm(`${cands.length} tegenpartij(en) hebben nog geen categorie. Nu online opzoeken?`)) openLookup(cands);
  }

  // ----- Online opzoeken -----

  const localNominatimQueue = Lookup ? Lookup.createQueue(1100) : null;

  /** Zoekt een reeks tegenpartijen op: via de eigen server indien beschikbaar, anders rechtstreeks vanuit de browser. */
  async function lookupBatch(items) {
    const st = state.settings;
    if (Sync && (Sync.mode === 'server')) {
      const r = await Sync.lookup({
        items: items.map(i => ({ name: i.name, description: i.description, direction: i.direction })),
        categories: state.categories.map(c => ({ id: c.id, name: c.name, kind: c.kind })),
        provider: st.lookupProvider || 'auto',
        countries: st.lookupCountries || 'be'
      });
      return r.results;
    }
    if (Sync && Sync.mode === 'offline') throw new Error('Geen verbinding met je Flux-server');
    return Promise.all(items.map(i => Lookup.lookupFree({ name: i.name, description: i.description }, { countries: st.lookupCountries || 'be', nominatimQueue: localNominatimQueue })));
  }

  /** Vertaalt een zoekresultaat naar een voorgestelde categorie. */
  function suggestionFor(result, direction) {
    if (!result) return null;
    if (result.ai && result.ai.categoryId && cat(result.ai.categoryId)) {
      return { categoryId: result.ai.categoryId, confidence: result.ai.confidence, why: [result.ai.businessType, result.ai.explanation].filter(Boolean).join(' — '), source: 'AI' };
    }
    const m = C.matchCategory(result.text, state.categories, direction);
    if (!m) return null;
    return { categoryId: m.categoryId, confidence: m.confidence, why: 'herkend aan: ' + m.hits.slice(0, 3).join(', '), source: (result.hits || []).map(h => h.source).join(' + ') };
  }

  function hitsHtml(result) {
    if (!result) return '';
    const parts = [];
    if (result.ai) parts.push(`<div><strong>AI:</strong> ${esc(result.ai.businessType)} <span class="muted">${esc(result.ai.explanation || '')}</span></div>`);
    for (const h of result.hits || []) {
      parts.push(`<div><a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">${esc(h.label)}</a> <span class="muted">(${esc(h.source)})</span> — ${esc(h.description)}${h.types && h.types.length ? ` <span class="muted">· ${esc(h.types.slice(0, 3).join(', '))}</span>` : ''}</div>`);
    }
    return parts.join('') || '<span class="muted">Niets gevonden</span>';
  }

  function openLookup(candidates) {
    const rows = candidates.map(c => ({ cand: c, status: 'pending', result: null, sugg: null, categoryId: '', makeRule: true }));
    openModal({ type: 'lookup', rows, running: true, error: null });
    runLookup(modal);
  }

  async function runLookup(m) {
    const chunk = Sync && Sync.mode === 'server' ? 5 : 3;
    for (let i = 0; i < m.rows.length; i += chunk) {
      if (modal !== m) return; // venster gesloten
      const part = m.rows.slice(i, i + chunk);
      try {
        const results = await lookupBatch(part.map(r => r.cand));
        part.forEach((r, j) => {
          r.result = results[j];
          r.sugg = suggestionFor(results[j], r.cand.direction);
          r.status = 'done';
          if (r.sugg && !r.touched) r.categoryId = r.sugg.categoryId;
        });
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
    const body = `
      <p class="small muted">Flux zoekt elke onbekende tegenpartij op ${Sync && Sync.mode === 'server' && Sync.features.ai && state.settings.lookupProvider !== 'free' ? 'met AI (Claude, met webzoekfunctie) en ' : 'in '}open bronnen (Wikidata, OpenStreetMap)
        en stelt een categorie voor. Kijk de voorstellen na; met <em>regel</em> aangevinkt wordt de categorie ook voor toekomstige transacties van die tegenpartij gebruikt.</p>
      ${m.running ? `<div class="progress"><div class="bar" style="width:${(done / Math.max(1, m.rows.length) * 100).toFixed(0)}%"></div></div><p class="small muted">${done} / ${m.rows.length} opgezocht…</p>` : ''}
      ${m.error ? `<div class="notice">Opzoeken lukte niet volledig: ${esc(m.error)}</div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Tegenpartij</th><th>Gevonden</th><th>Categorie</th><th>Regel</th></tr></thead>
        <tbody>${m.rows.map((r, i) => `<tr>
          <td><strong>${esc(r.cand.name)}</strong><div class="small muted">${r.cand.count}× · ${money(r.cand.total)}</div></td>
          <td class="small lookup-hits">${r.status === 'pending' ? '<span class="muted">bezig…</span>' : r.status === 'error' ? '<span class="muted">mislukt</span>' : hitsHtml(r.result)}
            ${r.sugg ? `<div style="margin-top:3px"><span class="badge ${conf[r.sugg.confidence] || ''}">zekerheid ${esc(r.sugg.confidence)}</span> <span class="muted">${esc(r.sugg.why)}</span></div>` : ''}</td>
          <td><select data-lookup-cat="${i}">${categoryOptions(r.categoryId, { emptyLabel: '— Overslaan —' })}</select></td>
          <td><input type="checkbox" data-lookup-rule="${i}" ${r.makeRule ? 'checked' : ''} aria-label="Regel maken"></td>
        </tr>`).join('')}</tbody></table></div>`;
    const chosen = m.rows.filter(r => r.categoryId).length;
    const foot = `<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>
      <button class="btn primary" data-action="lookup-apply" ${chosen ? '' : 'disabled'}>${chosen} toepassen</button>`;
    return modalShell('Tegenpartijen online opzoeken', body, foot, true);
  }

  /** Bouwt een regel die alle transacties van deze tegenpartij vangt (bv. "colruyt" voor alle Colruyt-winkels). */
  function ruleForCandidate(r) {
    // Kortste gevonden naam die het begin van de tegenpartij is: "kruidvat" i.p.v. "kruidvat gent"
    let value = r.cand.key;
    const options = [r.result && r.result.query].concat(((r.result && r.result.hits) || []).map(h => h.label));
    for (const o of options) {
      const q = o ? C.normalizeText(o) : '';
      if (q.length >= 3 && q.length < value.length && (' ' + r.cand.key + ' ').startsWith(' ' + q + ' ')) value = q;
    }
    return {
      id: C.uid('rule'), name: r.cand.name, field: r.cand.field === 'counterparty' ? 'counterparty' : 'any',
      operator: 'name', value, categoryId: r.categoryId, direction: r.cand.direction, enabled: true,
      priority: Math.max(0, ...state.rules.map(x => x.priority || 0)) + 10, origin: 'lookup'
    };
  }

  function applyLookup() {
    let rules = 0, txs = 0;
    for (const r of modal.rows) {
      if (!r.categoryId) continue;
      if (r.makeRule) { state.rules.push(ruleForCandidate(r)); rules++; }
      else {
        for (const id of r.cand.txIds) {
          const t = txById(id);
          if (t && !t.categoryId) { t.categoryId = r.categoryId; t.categorySource = 'manual'; txs++; }
        }
      }
    }
    closeModal();
    commit(`${rules} regel(s) aangemaakt${txs ? `, ${txs} transactie(s) gecategoriseerd` : ''}`);
  }

  async function lookupOne() {
    const el = $('#tx-lookup-result');
    const item = { name: $('#tx-counterparty').value.trim(), description: $('#tx-description').value.trim() };
    if (!item.name && !item.description) { el.textContent = 'Vul eerst een tegenpartij of mededeling in.'; return; }
    const amount = C.parseAmount($('#tx-amount').value);
    item.direction = amount > 0 ? 'in' : 'out';
    el.innerHTML = '<span class="muted">Bezig met opzoeken…</span>';
    try {
      const [res] = await lookupBatch([item]);
      const sg = suggestionFor(res, item.direction);
      el.innerHTML = `<div class="section lookup-hits">${hitsHtml(res)}${sg ? `<div style="margin-top:4px">→ voorstel: <strong>${esc(catName(sg.categoryId))}</strong> <span class="muted">(${esc(sg.why)})</span></div>` : '<div class="muted" style="margin-top:4px">Geen passende categorie gevonden. Tip: voeg zoekwoorden toe aan de juiste categorie bij Instellingen.</div>'}</div>`;
      if (sg && !$('#tx-category').value) { $('#tx-category').value = sg.categoryId; updateSplitRemaining(); }
    } catch (e) {
      el.innerHTML = `<span style="color:var(--red)">Opzoeken mislukt: ${esc(e.message)}</span>`;
    }
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
          if (!confirm('Alle huidige gegevens vervangen door deze back-up?' + (ui.sync.mode !== 'local' ? ' Dit geldt voor al je toestellen.' : ''))) return;
          replaceAll(data, 'Back-up teruggezet');
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
    'edit-budget': el => { const b = state.budgets.find(x => x.id === el.dataset.id); if (b) openModal({ type: 'budget', budget: Object.assign({}, b) }); },
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
    'edit-account': el => openModal({ type: 'account', account: Object.assign({}, acc(el.dataset.id)) }),
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
    'new-category': el => openModal({ type: 'category', category: { id: C.uid('cat'), name: '', kind: el.dataset.kind === 'income' ? 'income' : 'expense', color: '#3b5bdb', lookupTags: '' } }),
    'new-cost-category': el => openModal({ type: 'category', category: { id: C.uid('cat'), name: 'Kosten ' + catName(el.dataset.id).toLowerCase(), kind: 'expense', incomeId: el.dataset.id, color: '#94d82d', lookupTags: '' } }),
    'edit-category': el => openModal({ type: 'category', category: Object.assign({}, cat(el.dataset.id)) }),
    'save-category': saveCategory,
    'delete-category': el => {
      const id = el.dataset.id;
      if (!confirm('Categorie "' + catName(id) + '" verwijderen? Transacties worden niet-gecategoriseerd; bijhorende regels en budgetten worden verwijderd.')) return;
      state.categories = state.categories.filter(c => c.id !== id).map(c => c.incomeId === id ? Object.assign({}, c, { incomeId: undefined }) : c);
      state.categories.forEach(c => { if (c.incomeId === undefined) delete c.incomeId; });
      state.rules = state.rules.filter(r => r.categoryId !== id);
      state.budgets = state.budgets.filter(b => b.categoryId !== id);
      commit('Categorie verwijderd');
    },
    'export-json': () => download('flux-backup-' + today + '.json', JSON.stringify(state, null, 2), 'application/json'),
    'import-json': importJSON,
    'export-csv': exportCSV,
    'load-demo': () => {
      if (state.transactions.length && !confirm('Je huidige gegevens worden vervangen door demogegevens' + (ui.sync.mode !== 'local' ? ', op al je toestellen' : '') + '. Doorgaan?')) return;
      replaceAll(Store.demoState(today), 'Demogegevens geladen');
    },
    'reset': () => {
      if (!confirm('Alle gegevens definitief wissen' + (ui.sync.mode !== 'local' ? ' (ook op je andere toestellen en de server)' : '') + '? Maak eerst een back-up als je twijfelt.')) return;
      replaceAll(Store.defaultState(), 'Alle gegevens gewist');
    },
    'lookup': () => {
      const cands = C.lookupCandidates(state);
      if (!cands.length) { toast('Alle transacties hebben al een categorie.'); return; }
      openLookup(cands);
    },
    'lookup-one': lookupOne,
    'lookup-apply': applyLookup,
    'goto-income': () => go('income'),
    'goto-uncategorized-income': () => { Object.assign(ui.tx, { category: '__none__', type: 'in', month: '', search: '', account: '' }); go('transactions'); },
    'sync-now': () => Sync.syncNow(),
    'change-password': () => openModal({ type: 'password' }),
    'save-password': savePassword,
    'logout': () => doLogout(false),
    'logout-all': () => doLogout(true),
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
    if (el.dataset.ui === 'year') { ui.year = el.value; render(); return; }
    if (el.dataset.setting) {
      const key = el.dataset.setting;
      state.settings = Object.assign({}, state.settings, { [key]: el.type === 'checkbox' ? el.checked : el.value.trim() });
      commit('Instelling bewaard');
      return;
    }
    if (!modal) return;
    if (modal.type === 'category' && el.id === 'cat-kind') { $('#cat-income-field').hidden = el.value !== 'incomeCost'; return; }
    if (modal.type === 'lookup') {
      if (el.dataset.lookupCat != null) {
        const r = modal.rows[Number(el.dataset.lookupCat)];
        r.categoryId = el.value; r.touched = true;
        const btn = $('[data-action="lookup-apply"]');
        const n = modal.rows.filter(x => x.categoryId).length;
        btn.disabled = !n; btn.textContent = n + ' toepassen';
      }
      if (el.dataset.lookupRule != null) modal.rows[Number(el.dataset.lookupRule)].makeRule = el.checked;
      return;
    }
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

  // ---------- Aanmelden en synchronisatie ----------

  document.addEventListener('submit', async ev => {
    const form = ev.target.closest('[data-form]');
    if (!form) return;
    ev.preventDefault();
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
    // Geen gegevens van dit account achterlaten op het toestel
    Store.clear();
    state = Store.defaultState();
    snap = C.snapshot(state);
    ui.auth = { setupRequired: false };
    closeModal();
    render();
  }

  render();

  if (Sync) {
    Sync.init({
      getState: () => state,
      setState,
      freshState: () => Store.defaultState(),
      onStatus: s => { ui.sync = s; renderSyncBadge(); },
      onAuthRequired: info => {
        // Niets tonen zolang niemand aangemeld is; de lokale kopie blijft bewaard voor dezelfde gebruiker
        ui.auth = { setupRequired: !!info.setupRequired, previousUser: info.previousUser || null, expired: !!info.previousUser };
        closeModal();
        render();
      }
    }).then(() => { if (!ui.auth) render(); }).catch(e => console.error('Flux sync:', e));
  }

  // App installeerbaar maken en offline laten werken (enkel via http(s))
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && location.hostname !== '') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* geen probleem: werkt ook zonder */ });
  }
})();
