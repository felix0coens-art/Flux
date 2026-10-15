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
    maybeAutoFetchMetals();
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
        ${metalsCard()}
        <p class="muted">Koppel je Degiro- of Saxo-rekening om je portefeuille, je stortingen en je rendement (TWR en MWR) te zien. Overschrijvingen van je bank naar je broker tellen in Helder als <em>belegging</em>, niet als uitgave.</p>
        ${connect}
        <div class="card" style="margin-top:16px"><h2>Wat moet ik exporteren uit Degiro?</h2>${DEGIRO_EXPORT_HELP}</div>`;
    }
    const s = Invest.summary(iv);
    const perf = Invest.performance(iv);
    const files = iv.files || [];
    return `
      <div class="page-head"><h1>Beleggingen</h1><span class="spacer"></span>
        <button class="btn" data-action="tax-open" title="Bedragen voor je belastingaangifte">🧾 Jaaroverzicht aangifte</button>
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
      ${metalsCard()}
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
    const row = x => `<tr class="clickable" data-action="metal-edit" data-id="${esc(x.id)}">
        <td><strong>${x.estimated ? '≈ ' : ''}${esc(x.name || 'Munt')}</strong>
          <div class="small muted">${x.gift ? '🎁 cadeau' : '🛒 gekocht' + (x.buyDate ? ' ' + fmtDate(x.buyDate) : '')}${x.estimated ? ' · schatting' : ''}${x.note ? ' · ' + esc(x.note) : ''}</div></td>
        <td class="right">${x.estimated ? '≈ ' : ''}${countFmt(x.count)}</td>
        <td class="right">${grams(x.fineTotal)}<div class="small muted">${x.metal === 'silver' ? 'zilver' : 'goud'}</div></td>
        <td class="amount">${x.unitValue != null ? money(x.unitValue) : '—'}${x.valueSource === 'manual' ? '<div class="small muted" title="Je eigen verkoopwaarde gaat voor op de prijs per gram">✎ eigen waarde</div>' : ''}</td>
        <td class="amount"><strong>${x.value != null ? money(x.value) : '—'}</strong></td>
        <td class="amount">${x.gift ? '<span class="small muted">geen inleg</span>' : x.cost != null ? money(x.cost) + (x.gain != null ? `<div class="small ${x.gain >= 0 ? 'pos' : 'negv'}">${x.gain >= 0 ? '+' : ''}${money(x.gain)}</div>` : '') : '—'}</td>
      </tr>`;
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
        ${s.giftValue ? `<div><div class="label">Cadeaus</div><div class="value">${money(s.giftValue)}</div><div class="small muted">telt als vermogen, niet als inleg of uitgave</div></div>` : ''}
      </div>
      ${s.missing ? `<div class="notice small">Voor ${s.missing} lijn${s.missing === 1 ? '' : 'en'} is er nog geen waarde: ${p && p.gold ? 'vul het gewicht en de zuiverheid in' : 'haal de goudprijs op of vul hem zelf in'}, of geef een eigen verkoopwaarde.</div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Wat</th><th class="right">Aantal</th><th class="right">Fijn metaal</th><th class="right">Per stuk</th><th class="right">Waarde</th><th class="right">Aankoop</th></tr></thead>
        <tbody>${s.items.map(row).join('')}</tbody></table></div>
      <p class="small muted">Waarde = gram fijn metaal × prijs per gram, tenzij je per munt een eigen verkoopwaarde invulde (die gaat voor). Een munthandelaar betaalt meestal iets minder dan de goudprijs.</p>`
      : `<p class="muted">Heb je gouden of zilveren munten of baren thuis (gekocht of gekregen)? Voeg ze toe: Helder rekent hun waarde uit met de actuele goudprijs en telt ze mee in je vermogen.</p>`}
    </div>`;
  }

  function metalModal() {
    const m = modal;
    const x = m.edit;
    const presets = C.METAL_PRESETS;
    return modalShell(m.isNew ? 'Munt of baar toevoegen' : 'Bewerken', `
      <div class="form-grid">
        <label class="field full"><span>Soort</span><select id="mt-preset">
          <option value="">— Kies een bekende munt of baar (vult gewicht en zuiverheid in) —</option>
          ${presets.map(p => `<option value="${esc(p.id)}" ${x.preset === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          <option value="other" ${x.preset === 'other' ? 'selected' : ''}>Iets anders…</option></select></label>
        <label class="field full"><span>Naam</span><input type="text" id="mt-name" maxlength="60" value="${esc(x.name || '')}" placeholder="bv. Krugerrand 1 oz"></label>
        <label class="field"><span>Aantal</span><input type="text" id="mt-count" inputmode="decimal" value="${esc(x.count != null ? countFmt(x.count) : '1')}"></label>
        <label class="field"><span>Metaal</span><select id="mt-metal"><option value="gold" ${x.metal !== 'silver' ? 'selected' : ''}>Goud</option><option value="silver" ${x.metal === 'silver' ? 'selected' : ''}>Zilver</option></select></label>
        <label class="field"><span>Gewicht per stuk (gram)</span><input type="text" id="mt-weight" inputmode="decimal" value="${esc(x.weight != null ? String(x.weight).replace('.', ',') : '')}"></label>
        <label class="field"><span>Zuiverheid (‰)</span><input type="text" id="mt-purity" inputmode="decimal" value="${esc(x.purity != null ? String(x.purity).replace('.', ',') : '')}" placeholder="bv. 916,7 of 999,9"></label>
        <label class="check full"><input type="checkbox" id="mt-est" ${x.estimated ? 'checked' : ''}> Dit is een schatting <span class="muted small">(bv. de extra munten samen als één Krugerrand-equivalent)</span></label>
        <div class="field full"><span>Hoe kreeg je het?</span>
          <div class="seg"><button type="button" class="${x.origin !== 'gift' ? 'active' : ''}" data-action="metal-origin" data-v="bought">🛒 Gekocht</button><button type="button" class="${x.origin === 'gift' ? 'active' : ''}" data-action="metal-origin" data-v="gift">🎁 Cadeau gekregen</button></div>
          <span class="small muted">${x.origin === 'gift' ? 'Een cadeau telt als vermogen, maar niet als uitgave of als eigen inleg (dus ook niet in winst of verlies).' : 'Je aankoopprijs is je inleg; Helder toont dan je winst of verlies.'}</span></div>
        ${x.origin !== 'gift' ? `<label class="field"><span>Aankoopprijs (samen)</span><input type="text" id="mt-buy" inputmode="decimal" value="${esc(x.buyPrice ? C.centsToInput(x.buyPrice) : '')}" placeholder="bv. 2450,00"></label>
        <label class="field"><span>Aankoopdatum</span><input type="date" id="mt-date" value="${esc(x.buyDate || '')}" max="${today}"></label>` : ''}
        <label class="field full"><span>Eigen verkoopwaarde per stuk <span class="muted small">(optioneel — gaat voor op de goudprijs)</span></span><input type="text" id="mt-sell" inputmode="decimal" value="${esc(x.sellValue ? C.centsToInput(x.sellValue) : '')}" placeholder="bv. wat de munthandelaar biedt"></label>
        <label class="field full"><span>Notitie <span class="muted small">(optioneel)</span></span><input type="text" id="mt-note" maxlength="100" value="${esc(x.note || '')}" placeholder="bv. van oma, ligt in de kluis"></label>
      </div>
      <div class="errors" id="mt-errors"></div>`,
      `${m.isNew ? '' : '<button class="btn danger" data-action="metal-delete">Verwijderen</button>'}<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="metal-save">Opslaan</button>`);
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
    x.sellValue = money_('#mt-sell');
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
    if (!x.sellValue && !(x.weight > 0 && x.purity > 0 && x.purity <= 1000)) errors.push('Vul gewicht en zuiverheid in (zuiverheid in ‰, max. 1000), of een eigen verkoopwaarde.');
    if (errors.length) { $('#mt-errors').innerHTML = errors.map(esc).join('<br>'); return; }
    const item = { id: x.id, name: x.name, metal: x.metal === 'silver' ? 'silver' : 'gold', count: x.count, weight: x.weight || 0, purity: x.purity || 0,
      origin: x.origin === 'gift' ? 'gift' : 'bought', estimated: !!x.estimated, note: x.note || '', preset: x.preset || '' };
    if (item.origin === 'bought' && x.buyPrice) item.buyPrice = Math.round(x.buyPrice);
    if (item.origin === 'bought' && x.buyDate) item.buyDate = x.buyDate;
    if (x.sellValue) item.sellValue = Math.round(x.sellValue);
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
