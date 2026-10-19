  // ----- Wat is dit geld? -----

  /**
   * Eén vraag voor inkomend geld. Elke keuze leidt naar het juiste mechanisme in Helder
   * (inkomen, terugbetaling van een uitgave, terugbetaling van een voorschot, actie, eigen rekening).
   */
  function whatIsModal() {
    const m = modal;
    const t = txById(m.txId);
    if (!t) return modalShell('Wat is dit geld?', '<p class="muted">Deze transactie bestaat niet meer.</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
    const choices = [
      ['income', '💶', 'Inkomen', 'Loon, een cadeau, iets dat je verkocht, rente, …'],
      ['refund', '↩', 'Ik krijg geld terug van een uitgave', 'Iemand betaalt zijn deel van iets dat jij betaalde, of een bestelling werd geannuleerd of teruggestort. De uitgave wordt dan kleiner.'],
      ['advance', '🤝', 'Iemand betaalt een voorschot terug', 'Je had iets voorgeschoten voor iemand (dat telde niet als jouw uitgave).'],
      ['prepaid', '📥', 'Vooruitbetaald voor iets dat ik nog betaal', 'Bv. vrienden storten hun deel van de Airbnb en jij betaalt die later. Geen inkomen: je moet het nog voor hen uitgeven.'],
      ['action', '✅', 'Het hoort bij een actie', 'Bv. het geld van een retour, of mama die de kleren terugbetaalt.'],
      ['transfer', '↔', 'Van een eigen rekening', 'Je zette zelf geld over, bv. van je spaarrekening.']
    ];
    const c = m.choice;
    let detail = '';
    if (c === 'income') {
      detail = `<label class="field"><span>Welk soort inkomen?</span><select id="wi-cat">${categoryOptions(t.categoryId && cat(t.categoryId) && cat(t.categoryId).kind === 'income' ? t.categoryId : null, { kind: 'income' })}</select></label>
        <p class="btn-row"><button class="btn primary" data-action="wi-apply">Opslaan</button><button class="btn ghost" data-action="wi-newcat">+ Nieuwe inkomstenbron</button></p>`;
    } else if (c === 'refund') {
      const sugg = C.suggestRefundTargets(state, t, 6);
      detail = sugg.length ? `<p class="small muted">Van welke uitgave? Helder stelt de waarschijnlijkste voor:</p><div class="wi-list">${sugg.map(x => `<button class="wi-pick" data-action="wi-refund" data-id="${esc(x.tx.id)}"><span class="grow"><strong>${esc(x.tx.title || x.tx.counterparty || x.tx.description || 'uitgave')}</strong><span class="small muted">${fmtDate(x.tx.date)}${x.tx.categoryId ? ' · ' + esc(catLabel(x.tx.categoryId)) : ''}</span></span><span class="amount">${money(x.tx.amount)}</span></button>`).join('')}</div>
        <p class="small"><a href="#" data-action="wi-refund-other">Een andere uitgave zoeken…</a></p>`
        : `<p class="small muted">Helder vindt geen passende uitgave in de laatste 3 maanden.</p><p><button class="btn" data-action="wi-refund-other">Uitgave zelf kiezen…</button></p>`;
    } else if (c === 'prepaid') {
      detail = `<label class="field"><span>Van wie?</span><input type="text" id="wi-person" list="wi-people" value="${esc(t.counterparty && !/\d{4}/.test(t.counterparty) ? t.counterparty.split(/\s+/).slice(0, 2).join(' ') : '')}" placeholder="naam">
          <datalist id="wi-people">${C.personList(state).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></label>
        <label class="field"><span>Waarvoor? <span class="muted small">(optioneel)</span></span><input type="text" id="wi-prepaid-title" maxlength="60" placeholder="bv. Airbnb Ardennen"></label>
        <p class="btn-row"><button class="btn primary" data-action="wi-prepaid">Opslaan</button></p>
        <p class="small muted">Betaal je later de Airbnb, koppel die uitgave dan als voorschot voor deze persoon (Opvolgen → 🔗 Uitgave koppelen). Betaalde je ook voor jezelf, splits ze dan.</p>`;
    } else if (c === 'advance') {
      const people = C.personList(state).filter(p => p.stats.open > 0).sort((a, b) => b.stats.open - a.stats.open);
      detail = `<label class="field"><span>Wie betaalt terug?</span><input type="text" id="wi-person" list="wi-people" value="${esc(people[0] ? people[0].name : '')}" placeholder="naam">
          <datalist id="wi-people">${C.personList(state).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></label>
        ${people.length ? `<p class="small muted">Open: ${people.slice(0, 5).map(p => `${esc(p.name)} ${money(p.stats.open)}`).join(' · ')}</p>` : ''}
        <p class="btn-row"><button class="btn primary" data-action="wi-advance">Koppelen</button></p>
        <p class="small muted">Wil je kiezen welk voorschot precies terugbetaald is? Dat kan daarna in Terug te krijgen → 📒 Rekening-courant.</p>`;
    } else if (c === 'action') {
      const acts = (state.actions || []).filter(a => !a.closed);
      detail = `<label class="field"><span>Welke actie?</span><select id="wi-action">${acts.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}<option value="__new__">+ Nieuwe actie…</option></select></label>
        <label class="field"><span>Telt als inkomen in <span class="muted small">(optioneel)</span></span><select id="wi-action-cat">${categoryOptions(null, { kind: 'income', emptyLabel: '— Niet indelen —' })}</select></label>
        <p class="btn-row"><button class="btn primary" data-action="wi-action">Toevoegen</button></p>`;
    } else if (c === 'transfer') {
      detail = `<p class="small muted">Dan telt het niet als inkomen. Staat die andere rekening ook in Helder, dan herkent Helder de overschrijving meestal vanzelf.</p><p><button class="btn primary" data-action="wi-transfer">Ja, van een eigen rekening</button></p>`;
    }
    return modalShell('Wat is dit geld?', `
      <div class="wi-tx"><div><strong>${esc(t.title || t.counterparty || t.description || '—')}</strong><div class="small muted">${fmtDate(t.date)} · ${esc(accName(t.accountId))}${t.description && (t.title || t.counterparty) ? ' · ' + esc(t.description.slice(0, 60)) : ''}</div></div><span class="amount pos">${money(t.amount)}</span></div>
      <div class="wi-choices">${choices.map(([id, icon, title, help]) => `<button class="wi-choice ${c === id ? 'active' : ''}" data-action="wi-choose" data-choice="${id}"><span class="wi-icon">${icon}</span><span class="grow"><strong>${title}</strong><span class="small muted">${help}</span></span></button>${c === id ? `<div class="wi-detail">${detail}</div>` : ''}`).join('')}</div>`,
      '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>', true);
  }

  function whatIsDone(msg) { closeModal(); commit(msg); }

