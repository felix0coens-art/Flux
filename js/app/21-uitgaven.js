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
    return `<div class="donut" data-total="${esc(money(total))}" data-total-label="${esc(opts.totalLabel || 'Totaal')}">
      <svg viewBox="0 0 180 180" role="img" aria-label="${esc(opts.aria || 'Verdeling per categorie')}">${arcs}
        <text x="90" y="84" text-anchor="middle" class="donut-label" id="donut-label">${esc(opts.totalLabel || 'Totaal')}</text>
        <text x="90" y="104" text-anchor="middle" class="donut-value" id="donut-value">${esc(money(total))}</text></svg>
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
          ${cats.length ? cats.map(c => `<div class="catbar cat-link" data-action="cat-view" data-cat="${esc(c.id || '__none__')}" title="Bekijk de transacties"><span class="name">${esc(c.id ? catLabel(c.id) : 'Nog niet gekoppeld')}</span>
            <span class="track"><span class="fill" style="display:block;width:${(c.v / maxCat * 100).toFixed(1)}%;background:${esc(catColor(c.id))}"></span></span>
            <span class="amount">${money(c.v)}</span></div>`).join('') : '<p class="muted">Geen uitgaven in deze periode.</p>'}
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

