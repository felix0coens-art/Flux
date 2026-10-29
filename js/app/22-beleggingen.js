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
    const pf = iv ? Invest.profit(iv) : null;
    const files = iv ? iv.files || [] : [];
    const blocks = {
      kpis: () => !iv ? '' : `
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Waarde</div><div class="value">${money(s.valueEur)}</div><div class="hint">${iv.liveDate ? 'aan de koers van ' + fmtDate(iv.liveDate) : 'stand ' + fmtDate(iv.positionsDate)} · waarvan cash ${money(s.cashEur)}</div></div>
        <div class="card kpi"><div class="label">Netto ingelegd</div><div class="value">${s.hasDeposits ? money(s.netDeposits) : '—'}</div><div class="hint">${s.hasDeposits ? 'stortingen ' + money(s.deposits) + (s.withdrawals ? ' − opnames ' + money(s.withdrawals) : '') : 'laad het rekeningoverzicht op'}</div></div>
        ${profitKpi(pf)}
        ${(() => {
          const r = Invest.realized(iv);
          if (!r.positions.length) return '';
          return `<div class="card kpi" title="Enkel wat je effectief verkocht: opbrengst − aankoopprijs van die stuks (kosten inbegrepen)">
          <div class="label">Gerealiseerde winst</div><div class="value ${r.total >= 0 ? 'pos' : 'negv'}">${money(r.total)} <span class="small">${r.pct != null ? pct(r.pct) : ''}</span></div>
          <div class="hint">op wat je verkocht: gekocht ${money(r.costSold)} → verkocht ${money(r.proceeds)}${r.losses ? ' · winst ' + money(r.gains) + ', verlies ' + money(r.losses) : ''}</div></div>`;
        })()}
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
      ${pf && pf.total != null ? `<p class="small effective-line">In euro: <strong class="${pf.total >= 0 ? 'pos' : 'negv'}">${signMoney(pf.total)}</strong> effectieve winst op ${money(pf.netDeposits)} netto inleg${pf.pct != null ? ' (' + pct(pf.pct) + ')' : ''}${pf.realized ? ` · waarvan ${signMoney(pf.realized)} al verkocht` : ''}.</p>` : ''}
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
          <thead><tr><th>Jaar</th><th class="right">Begin</th><th class="right">Stortingen</th><th class="right">Opnames</th><th class="right">Einde</th><th class="right">Winst</th><th class="right">Waarvan verkocht</th><th class="right">TWR</th><th class="right">MWR</th><th class="right">Dividend</th></tr></thead>
          <tbody>${perf.years.map(y => `<tr>
            <td><strong>${y.year}</strong>${y.partial ? ` <span class="small muted">t.e.m. ${fmtDate(y.endDate)}</span>` : ''}${y.estimated ? ' <span class="badge small" title="Begin- of eindwaarde gereconstrueerd uit je transacties">geschat</span>' : ''}</td>
            <td class="amount">${y.startValue != null ? money(y.startValue) : '—'}</td>
            <td class="amount">${money(y.deposits)}</td>
            <td class="amount">${y.withdrawals ? money(y.withdrawals) : '—'}</td>
            <td class="amount">${y.endValue != null ? money(y.endValue) : '—'}</td>
            ${y.missing.length ? `<td class="small muted">ontbreekt: portefeuille op ${y.missing.map(fmtDate).join(' en ')}</td><td class="amount">${pf.byYear[y.year] ? signMoney(pf.byYear[y.year]) : '—'}</td><td colspan="2"></td>`
              : `<td class="amount ${y.result >= 0 ? 'pos' : 'negv'}"><strong>${signMoney(y.result)}</strong></td><td class="amount ${(pf.byYear[y.year] || 0) >= 0 ? '' : 'negv'}">${pf.byYear[y.year] ? signMoney(pf.byYear[y.year]) : '—'}</td><td class="amount">${pct(y.twr)}</td><td class="amount">${pct(y.mwr)}</td>`}
            <td class="amount">${money(y.dividends)}</td></tr>`).join('')}</tbody>
          ${(() => { const ok = perf.years.filter(y => !y.missing.length); const tot = ok.reduce((a, y) => a + y.result, 0); const rz = Object.values(pf.byYear).reduce((a, v) => a + v, 0); return ok.length > 1 ? `<tfoot><tr><td colspan="5"><strong>Samen</strong>${ok.length < perf.years.length ? ' <span class="small muted">(jaren met volledige gegevens)</span>' : ''}</td><td class="amount ${tot >= 0 ? 'pos' : 'negv'}"><strong>${signMoney(tot)}</strong></td><td class="amount">${rz ? signMoney(rz) : '—'}</td><td colspan="2"></td><td class="amount">${money(perf.years.reduce((a, y) => a + y.dividends, 0))}</td></tr></tfoot>` : ''; })()}</table></div>
        <p class="small muted"><strong>Winst</strong> = eindwaarde − beginwaarde − netto stortingen: wat je dat jaar effectief bijwon (of verloor), dividend en kosten inbegrepen. <strong>Waarvan verkocht</strong> = winst die je dat jaar vastzette door te verkopen. <strong>TWR</strong> meet hoe goed je beleggingen het deden (vergelijk met een index).
          <strong>MWR</strong> is jouw eigen rendement: stortte je vlak voor een daling, dan is je MWR lager dan je TWR. Voor het lopende jaar: rendement tot nu, niet op jaarbasis.</p>
      </div>`,
      positions: () => !iv ? '' : `
      <div class="card" style="margin-bottom:16px">
        <h2>Posities</h2>
        ${s.positions.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Product</th><th class="right">Aantal</th><th class="right">Waarde</th><th class="right">Aankoop</th><th class="right" title="Waarde − aankoopprijs van wat je nog hebt">Winst op papier</th><th class="right" title="Wat je van dit product al verkocht, met winst of verlies">Al verkocht</th><th>Aandeel</th></tr></thead>
          <tbody>${s.positions.map(p => `<tr>
            <td><strong>${esc(p.name)}</strong><div class="small muted">${esc(p.isin || p.symbol || '')}${p.currency !== 'EUR' ? ' · ' + esc(p.currency) : ''}${iv.brokers ? ' · ' + esc(p.broker === 'saxo' ? 'Saxo' : 'Degiro') : ''}</div></td>
            <td class="right">${String(p.quantity).replace('.', ',')}</td>
            <td class="amount">${money(p.valueEur)}${p.priceDate ? `<div class="small muted" title="Koers van ${fmtDate(p.priceDate)}">à ${money(Math.round(p.priceEur))}</div>` : iv.liveDate ? `<div class="small muted" title="Geen koers gevonden: waarde van je laatste stand">stand</div>${noPriceWhy(iv, p.isin || p.key || p.name)}` : ''}</td>
            <td class="amount">${p.costEur != null ? money(p.costEur) : '—'}</td>
            <td class="amount ${p.gainEur >= 0 ? 'pos' : 'negv'}">${p.gainEur != null ? signMoney(p.gainEur) + `<div class="small">${p.costEur ? pct(p.gainEur / p.costEur) : ''}</div>` : '—'}</td>
            <td class="amount">${(() => { const v = pf.realizedByKey[p.isin] ?? pf.realizedByKey[p.key] ?? pf.realizedByKey[p.name]; return v != null ? `<span class="${v >= 0 ? 'pos' : 'negv'}">${signMoney(v)}</span>` : '—'; })()}</td>
            <td style="min-width:90px"><div class="track"><span class="fill" style="display:block;width:${(p.share * 100).toFixed(1)}%;background:var(--series-1)"></span></div><span class="small muted">${(p.share * 100).toFixed(1).replace('.', ',')}%</span></td>
          </tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="2"><strong>Totaal</strong></td><td class="amount"><strong>${money(s.positionsValue)}</strong></td><td class="amount">${pf.openCost ? money(pf.openCost) : '—'}</td>
            <td class="amount ${pf.unrealized >= 0 ? 'pos' : 'negv'}"><strong>${signMoney(pf.unrealized)}</strong><div class="small">${pf.unrealizedPct != null ? pct(pf.unrealizedPct) : ''}</div></td>
            <td class="amount">${pf.realized ? `<span class="${pf.realized >= 0 ? 'pos' : 'negv'}">${signMoney(pf.realized)}</span>` : '—'}</td><td></td></tr></tfoot></table></div>
        <p class="small muted"><strong>Winst op papier</strong> heb je pas echt als je verkoopt; <strong>al verkocht</strong> is winst die je al vastzette.${pf.unknownValue ? ` Voor ${money(pf.unknownValue)} aan posities kent Helder de aankoopprijs niet (laad je transacties op).` : ''}</p>` : '<p class="muted">Geen posities.</p>'}
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
      ${iv ? liveNotice(iv) : ''}
      <div class="iv-grid ${edit ? 'iv-editing' : ''}">${body}</div>
      ${!edit && hiddenList.length ? `<div class="iv-hidden-note small muted">Verborgen: ${hiddenList.map(id => `<button class="chip" data-action="invest-show" data-id="${id}" title="Terug tonen">+ ${meta(id).icon} ${esc(meta(id).label)}</button>`).join(' ')} <a href="#" data-action="invest-edit">Weergave aanpassen</a></div>` : ''}`;
  }

  const CLASS_COLORS = { stock: 'var(--series-1)', etf: 'var(--series-2)', bond: 'var(--series-3)', metal: 'var(--series-4)', cash: 'var(--series-5)', other: 'var(--muted-mark)' };

  /** Ronde diagram: waarin je beleggingsgeld zit, met de indeling per product die je zelf kan aanpassen. */
  function allocationCard(iv) {
    const overrides = (state.settings && state.settings.assetClasses) || {};
    const ms = metals();
    const groups = Invest.allocation(iv, { overrides, metalsValue: ms.value, metalsGain: ms.gain, metalsCost: ms.cost });
    if (!groups.length) return '';
    const total = groups.reduce((a, g) => a + g.value, 0);
    const products = groups.flatMap(g => g.items.filter(x => !x.fixed));
    return `<div class="card" style="margin-bottom:16px">
      <h2>Waarin zit je geld</h2>
      ${donutChart([], { segs: groups.map(g => ({ label: g.icon + ' ' + g.label, color: CLASS_COLORS[g.id], v: g.value })), totalLabel: 'Belegd', aria: 'Verdeling van je beleggingen per soort' })}
      <div class="alloc-groups small">${groups.map(g => `<div class="alloc-group"><span class="sw" style="background:${CLASS_COLORS[g.id]}"></span><strong>${g.icon} ${esc(g.label)}</strong>${g.cost ? ` <span class="${g.gain >= 0 ? 'pos' : 'negv'}">${signMoney(g.gain)} (${pct(g.gain / g.cost)})</span>` : ''}
        <div class="muted">${g.items.slice(0, 4).map(x => esc(x.name)).join(' · ')}${g.items.length > 4 ? ' · +' + (g.items.length - 4) : ''}</div></div>`).join('')}</div>
      ${products.length ? `<details class="alloc-edit" data-keep="allocEdit" ${ui.keepOpen.allocEdit ? 'open' : ''}><summary class="small"><strong>Klopt de indeling niet?</strong> <span class="muted">Kies per product zelf de soort</span></summary>
        <div class="list">${products.sort((a, b) => b.value - a.value).map(x => `<div class="list-row"><div class="grow">${esc(x.name)}<div class="small muted"><span class="amount">${money(x.value)}</span>${x.manual ? ' · zelf gekozen' : ' · automatisch herkend'}</div></div>
          <select data-asset-class="${esc(x.key)}" aria-label="Soort voor ${esc(x.name)}">${Invest.ASSET_CLASSES.map(c => `<option value="${c.id}" ${x.cls === c.id ? 'selected' : ''}>${c.icon} ${esc(c.label)}${c.id === x.auto && !x.manual ? '' : c.id === x.auto ? ' (automatisch)' : ''}</option>`).join('')}</select></div>`).join('')}</div></details>` : ''}
      <p class="small muted">Posities volgens je laatste stand, plus de cash op je beleggingsrekening${ms.value ? ' en je fysiek goud en zilver' : ''}. Bankrekeningen tellen hier niet mee.</p>
    </div>`;
  }

  /** Waarom er geen koers is voor een product (zoals de server het meldde). */
  function noPriceWhy(iv, key) {
    const e = iv.market && iv.market.errors && iv.market.errors[key];
    if (!e) return '';
    const why = e === 'niet gevonden' ? 'niet gevonden bij Yahoo Finance' : e === 'geen koersen' ? 'geen koersen gevonden' : e === 'wisselkoers ontbreekt' ? 'wisselkoers ontbreekt' : 'ophalen mislukt';
    return `<div class="small muted" title="${esc(e)}">geen koers: ${esc(why)}</div>`;
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
        <span class="badge ${r.total >= 0 ? 'ok' : 'over'}">${r.total >= 0 ? '▲' : '▼'} gerealiseerd ${money(r.total)}${r.pct != null ? ' (' + pct(r.pct) + ')' : ''}</span></div>
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
          <td class="amount">${p.todayValue != null ? money(p.todayValue) + `<div class="small muted">à ${money(Math.round(p.lastPrice))} · ${fmtDate(p.lastDate)}</div>` : `—${noPriceWhy(iv, p.key)}`}</td>
          <td class="amount ${p.diff == null ? '' : p.diff >= 0 ? 'pos' : 'negv'}">${p.diff != null ? `<strong>${p.diff >= 0 ? '▲ ' : '▼ '}${money(p.diff)}</strong><div class="small">${pct(p.diffPct)}</div>` : '—'}</td>
          <td><button class="btn small ghost" data-action="watch-from-sold" data-key="${esc(p.key)}" title="Volgen bij je favorieten, met je verkoopkoers als start">⭐</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3"><strong>Totaal</strong></td><td class="amount">${money(r.costSold)}</td><td class="amount">${money(r.proceeds)}</td><td class="amount ${r.total >= 0 ? 'pos' : 'negv'}"><strong>${money(r.total)}</strong><div class="small">${r.pct != null ? pct(r.pct) : ''}</div></td>
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

  const signMoney = v => (v > 0 ? '+' : '') + money(v);

  /** De effectieve winst (waarde − netto inleg) met waar ze vandaan komt. */
  function profitKpi(pf) {
    if (!pf) return '';
    if (pf.total == null) return `<div class="card kpi"><div class="label">Effectieve winst</div><div class="value">—</div><div class="hint">laad het rekeningoverzicht op (stortingen)</div></div>`;
    const parts = [
      ['💸 Verkocht', pf.realized, 'opbrengst − aankoopprijs van wat je verkocht'],
      ['📋 Nog in bezit', pf.unrealized, 'op papier: waarde − aankoopprijs van wat je nog hebt'],
      ['🪙 Dividend', pf.dividends, 'netto, na roerende voorheffing'],
      ['🧾 Kosten en overige', pf.other, 'kosten, wisselkoers, interest en wat niet per product toe te wijzen is']
    ].filter(x => x[1]);
    const max = Math.max(1, ...parts.map(x => Math.abs(x[1])));
    return `<div class="card kpi profit-kpi" title="Waarde nu − alles wat je netto stortte">
      <div class="label">Effectieve winst</div>
      <div class="value ${pf.total >= 0 ? 'pos' : 'negv'}">${signMoney(pf.total)} <span class="small">${pf.pct != null ? pct(pf.pct) : ''}</span></div>
      <div class="hint">waarde − netto inleg</div>
      ${parts.length ? `<div class="profit-parts">${parts.map(([l, v, t]) => `<div class="pp-row" title="${esc(t)}"><span class="pp-l">${l}</span><span class="pp-bar"><i class="${v >= 0 ? 'up' : 'down'}" style="width:${Math.max(3, Math.round(Math.abs(v) / max * 100))}%"></i></span><span class="pp-v ${v >= 0 ? 'pos' : 'negv'}">${signMoney(v)}</span></div>`).join('')}</div>` : ''}
    </div>`;
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
    // Inleg als trap: [x, y]-punten (ook gebruikt om de winstzone af te bakenen)
    const stepPts = [];
    steps.forEach((d, i) => {
      const px = x(d.date);
      if (i) stepPts.push([px, y(steps[i - 1].value)]);
      stepPts.push([px, y(d.value)]);
    });
    stepPts.push([x(end), y(cum)]);
    const pt = p => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    const stepPath = stepPts.map((p, i) => (i ? 'L' : 'M') + pt(p)).join(' ');
    // Winstzone: tussen de waarde en de inleg; groen waar de waarde erboven ligt, rood eronder
    const valPts = [{ date: start, value: 0 }].concat(vals).map(v => [x(v.date), y(v.value)]);
    const zone = 'M' + valPts.map(pt).join(' L') + ' L' + stepPts.slice().reverse().map(pt).join(' L') + ' Z';
    const above = 'M' + stepPts.map(pt).join(' L') + ` L${x(end).toFixed(1)} ${T} L${x(start).toFixed(1)} ${T} Z`;
    const below = 'M' + stepPts.map(pt).join(' L') + ` L${x(end).toFixed(1)} ${H - B} L${x(start).toFixed(1)} ${H - B} Z`;
    // Verkopen op de waardelijn, met hun gerealiseerde winst
    const pf = Invest.profit(inv());
    const valueAt = d => { let best = vals[0]; for (const v of vals) if (Math.abs(C.daysBetween(v.date, d)) < Math.abs(C.daysBetween(best.date, d))) best = v; return best.value; };
    const sells = (pf ? pf.sells : []).filter(s => s.date >= start && s.date <= end);
    // Rasterlijnen op mooie stappen
    const raw = top / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const stepV = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
    const ticks = [];
    for (let v = 0; v <= top; v += stepV) ticks.push(v);
    const years = [];
    for (let yr = Number(start.slice(0, 4)) + 1; yr <= Number(end.slice(0, 4)); yr++) years.push(yr + '-01-01');
    const lastVal = vals[vals.length - 1];
    chartData = { start, span, W, vals, flows: flows.filter(f => f.date <= end), x0: L, x1: W - R, realizedUntil: pf ? pf.realizedUntil : () => 0, sells };
    const compact = v => Math.abs(v) >= 100000000 ? '€ ' + (v / 100000000).toFixed(1).replace('.', ',') + ' mln' : Math.abs(v) >= 1000000 || (narrow && Math.abs(v) >= 100000) ? '€ ' + (Math.round(v / 10000) / 10).toString().replace('.', ',') + 'k' : money(v);
    const yLast = y(lastVal.value), yCum = y(cum);
    const apart = Math.abs(yLast - yCum) < 16;
    return `
      <div class="legend"><span><i class="sw line s1"></i>Waarde portefeuille</span>
        <span><i class="sw line s2"></i>Totale inleg (netto stortingen)</span>
        <span><i class="sw area up"></i>Winst</span><span><i class="sw area down"></i>Verlies</span>${sells.length ? '<span><i class="sw sell"></i>Verkoop</span>' : ''}
        <span><i class="sw dot s2"></i>Bijstorting</span><span><i class="sw dot hollow"></i>Opname</span><span><i class="sw dot s1"></i>Werkelijke stand</span></div>
      <div class="chart-wrap" id="invest-chart">
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Waarde van je portefeuille en je totale inleg door de tijd">
          ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`).join('')}
          ${years.map(d => `<line x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${H - B}" class="grid-line"/><text x="${x(d)}" y="${H - 10}" text-anchor="middle">${d.slice(0, 4)}</text>`).join('')}
          <defs><clipPath id="iv-above"><path d="${above}"/></clipPath><clipPath id="iv-below"><path d="${below}"/></clipPath></defs>
          <path d="${zone}" class="gain-zone up" clip-path="url(#iv-above)"/>
          <path d="${zone}" class="gain-zone down" clip-path="url(#iv-below)"/>
          <path d="${stepPath}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round"/>
          <path d="${valuePath}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round"/>
          ${steps.slice(1).map(d => `<circle cx="${x(d.date)}" cy="${y(d.value)}" r="4" class="${d.flow > 0 ? 'dep' : 'wd'}"><title>${fmtDate(d.date)}: ${d.flow > 0 ? 'storting' : 'opname'} ${money(Math.abs(d.flow))}</title></circle>`).join('')}
          ${vals.filter(v => v.actual).map(v => `<circle cx="${x(v.date)}" cy="${y(v.value)}" r="3" class="actual"><title>${fmtDate(v.date)}: werkelijke stand ${money(v.value)}</title></circle>`).join('')}
          ${sells.map(sl => { const cx = x(sl.date), cy = y(valueAt(sl.date)) - 9; return `<path d="M${(cx - 5).toFixed(1)} ${(cy - 4).toFixed(1)} L${(cx + 5).toFixed(1)} ${(cy - 4).toFixed(1)} L${cx.toFixed(1)} ${(cy + 4).toFixed(1)} Z" class="sell-mark ${sl.result >= 0 ? 'up' : 'down'}"><title>${fmtDate(sl.date)}: ${esc(sl.name)} verkocht voor ${money(sl.proceeds)} · ${sl.result >= 0 ? 'winst' : 'verlies'} ${money(Math.abs(sl.result))}</title></path>`; }).join('')}
          <text x="${W - R + 8}" y="${(apart && yLast > yCum ? yLast + 10 : yLast) + 4}" class="direct">${compact(lastVal.value)}</text>
          <text x="${W - R + 8}" y="${(apart && yCum >= yLast ? yCum + 10 : yCum) + 4}" class="direct muted-fill">${compact(cum)}${narrow ? '' : ' inleg'}</text>
          ${apart ? '' : `<text x="${W - R + 8}" y="${((yLast + yCum) / 2 + 4).toFixed(1)}" class="direct ${lastVal.value - cum >= 0 ? 'gain-up' : 'gain-down'}">${lastVal.value - cum >= 0 ? '+' : '−'}${compact(Math.abs(lastVal.value - cum)).replace('€ ', '€')}</text>`}
          <line class="crosshair" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>
        </svg>
        <div class="chart-tip" hidden></div>
      </div>
      <details><summary class="small">Toon als tabel</summary>
        <div class="table-wrap"><table><thead><tr><th>Datum</th><th class="right">Waarde</th><th class="right">Inleg tot dan</th><th class="right">Effectieve winst</th><th class="right">Waarvan verkocht</th></tr></thead>
        <tbody>${vals.map(v => { const inl = inlegOn(v.date); const g = v.value - inl; const rz = pf ? pf.realizedUntil(v.date) : 0; return `<tr><td>${fmtDate(v.date)}${v.actual ? '' : ' <span class="muted small">(geschat)</span>'}</td><td class="amount">${money(v.value)}</td><td class="amount">${money(inl)}</td><td class="amount ${g >= 0 ? 'pos' : 'negv'}">${signMoney(g)}${inl > 0 ? `<div class="small">${pct(g / inl)}</div>` : ''}</td><td class="amount">${rz ? signMoney(rz) : '—'}</td></tr>`; }).join('')}</tbody></table></div>
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
    const g = best.value - inl;
    const rz = chartData.realizedUntil(best.date);
    const sold = chartData.sells.filter(sl => Math.abs(C.daysBetween(sl.date, date)) <= Math.max(3, chartData.span / 120));
    tip.innerHTML = `<strong>${fmtDate(best.date)}</strong>${best.actual ? '' : ' <span class="muted">(gereconstrueerd)</span>'}<br>Waarde: ${money(best.value)}<br>Inleg: ${money(inl)}<br><strong class="${g >= 0 ? 'pos' : 'negv'}">${g >= 0 ? 'Winst' : 'Verlies'}: ${signMoney(g)}${inl > 0 ? ' (' + pct(g / inl) + ')' : ''}</strong>${rz ? '<br><span class="muted">waarvan al verkocht: ' + signMoney(rz) + '</span>' : ''}${sold.length ? '<hr>' + sold.map(sl => 'Verkoop ' + esc(sl.name) + ': ' + signMoney(sl.result)).join('<br>') : ''}${near.length ? '<hr>' + near.map(f => (f.amount > 0 ? 'Storting ' : 'Opname ') + money(Math.abs(f.amount)) + ' · ' + fmtDate(f.date)).join('<br>') : ''}`;
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

  /** Van wanneer zijn de koersen en de aantallen? En wanneer moet je opnieuw aanmelden bij je broker? */
  function liveNotice(iv) {
    const server = Sync && Sync.mode === 'server' && !demo;
    const m = iv.market || {};
    const broker = Invest.brokers(iv).map(b => b.name).join(' of ') || 'Degiro';
    const fresh = m.fetchedAt ? ' · bijgewerkt ' + esc(fmtDateTime(m.fetchedAt)) : '';
    const missing = iv.liveDate ? (iv.positions || []).filter(p => p.quantity > 0 && !p.priceDate).length : 0;
    if (!server && !iv.liveDate) return `<p class="small muted live-note">📈 Koersen van de beurs ophalen kan enkel als Helder op je server draait. Je ziet de waarde van je laatste stand (${fmtDate(iv.positionsDate)}).</p>`;
    if (!iv.liveDate) return `<p class="small muted live-note">📈 ${pricesBusy ? 'Koersen van vandaag ophalen…' : `Waarde van je laatste stand (${fmtDate(iv.positionsDate)})${m.fetchedAt ? '; geen nieuwere koersen gevonden' + fresh : ''}.`} <a href="#" data-action="fetch-prices">Koersen nu ophalen</a></p>`;
    return `<div class="live-note card small">📈 <strong>Up-to-date met de beurs:</strong> koersen van ${fmtDate(iv.liveDate)}${fresh}${server ? ' · <a href="#" data-action="fetch-prices">vernieuwen</a>' : ''}<br>
      <span class="muted">Je aantallen en je cash komen van je laatste stand bij ${esc(broker)} (${fmtDate(iv.standDate)}). Kocht of verkocht je sindsdien iets, of kwam er dividend? Meld je dan opnieuw aan bij ${esc(broker)}: de rest volgt vanzelf de beurs.${missing ? ` Voor ${missing} ${missing === 1 ? 'positie' : 'posities'} vond Helder geen koers; daar telt de waarde van je laatste stand.` : ''}</span></div>`;
  }

  /** Haalt koersen op via de server (historiek + koers van vandaag) als die ontbreken of ouder zijn dan 4 uur. */
  let pricesBusy = false;
  async function maybeFetchPrices(force) {
    const data = inv();
    if (!data || demo || pricesBusy || !(Sync && Sync.mode === 'server')) return;
    const fetchedAt = data.market && data.market.fetchedAt;
    if (!force && fetchedAt && Date.now() - Date.parse(fetchedAt) < 4 * 3600000) return;
    if (!force && data.market && data.market.failedAt && Date.now() - Date.parse(data.market.failedAt) < 3 * 3600000) return;
    const keys = {};
    for (const t of data.trades || []) { const k = t.isin || t.name; if (!keys[k] || t.date < keys[k].from) keys[k] = { key: k, isin: t.isin, name: t.name, currency: t.currency, from: t.date }; }
    for (const p of data.positions || []) { const k = p.isin || p.key || p.name; if (!keys[k]) keys[k] = { key: k, isin: p.isin, name: p.name, currency: p.currency, from: data.positionsDate || today }; }
    // Eerst wat je nu hebt (nodig voor je waarde), dan wat je verkocht (recentste eerst); per 40 tegelijk
    const held = new Set((data.positions || []).filter(p => p.quantity > 0).map(p => p.isin || p.key || p.name));
    const lastTrade = {};
    for (const t of data.trades || []) { const k = t.isin || t.name; if (!lastTrade[k] || t.date > lastTrade[k]) lastTrade[k] = t.date; }
    const instruments = Object.values(keys).sort((a, b) => (held.has(b.key) - held.has(a.key)) || String(lastTrade[b.key] || '').localeCompare(String(lastTrade[a.key] || '')));
    if (!instruments.length) return;
    pricesBusy = true;
    try {
      const r = { series: {}, errors: {} };
      for (let i = 0; i < instruments.length; i += 40) {
        const part = await Sync.prices(instruments.slice(i, i + 40));
        Object.assign(r.series, part.series || {});
        Object.assign(r.errors, part.errors || {});
      }
      const okCount = Object.keys(r.series).length;
      // Wat nu niet lukte, houdt zijn vorige koersen
      const old = (data.market && data.market.series) || {};
      const series = Object.assign({}, old, r.series);
      for (const k of Object.keys(r.series)) delete r.errors[k];
      state.investments = Object.assign({}, state.investments, { market: okCount ? { series, errors: r.errors, fetchedAt: new Date().toISOString() } : Object.assign({}, data.market || {}, { failedAt: new Date().toISOString(), errors: r.errors }) });
      const failed = Object.keys(r.errors).length;
      commit(force ? (okCount ? `Koersen opgehaald voor ${okCount} product(en)${failed ? `, voor ${failed} niet gevonden` : ''}` : 'Geen koersen gevonden') : undefined);
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
