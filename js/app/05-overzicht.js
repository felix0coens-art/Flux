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
    const worth = bankTotal + (invSum ? invSum.valueEur : 0) + metalSum.value + Math.max(0, adv.totalOpen);
    const cancels = C.cancellationPairs(state).length;
    const actionsOpen = actionLists().open;
    const actionsLate = actionsOpen.filter(a => a.due && a.due < today).length;
    // Te doen: alles wat je aandacht vraagt, op één plek
    const todoItems = [
      todo ? `<a href="#" class="todo-row" data-action="goto" data-view="bank"><span class="todo-icon">📥</span><span class="grow"><strong>${todo} transactie${todo === 1 ? '' : 's'} te verwerken</strong><span class="small muted">Koppel ze aan een categorie, voorschot, …</span></span><span class="todo-go">›</span></a>` : '',
      cancels ? `<a href="#" class="todo-row" data-action="goto" data-view="bank"><span class="todo-icon">↩</span><span class="grow"><strong>${cancels} mogelijke annulering${cancels === 1 ? '' : 'en'}</strong><span class="small muted">Inkomst met hetzelfde bedrag als een eerdere uitgave</span></span><span class="todo-go">›</span></a>` : '',
      ...open.filter(p => p.open > 0).map(p => `<a href="#advances" class="todo-row" data-view-link="advances"><span class="todo-icon">🤝</span><span class="grow"><strong>${esc(p.person)} is je nog ${moneyHtml(p.open)} schuldig</strong><span class="small muted">${p.items.filter(i => i.amount - i.repaid > 0).length} open voorschot(ten)</span></span><span class="todo-go">›</span></a>`),
      ...open.filter(p => p.open < 0).map(p => `<a href="#advances" class="todo-row" data-view-link="advances"><span class="todo-icon">💶</span><span class="grow"><strong>${esc(p.person)} betaalde ${moneyHtml(-p.open)} te veel terug</strong><span class="small muted">Inboeken als inkomst?</span></span><span class="todo-go">›</span></a>`),
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

