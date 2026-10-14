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

