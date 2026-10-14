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

