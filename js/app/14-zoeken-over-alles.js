  // ----- Zoeken over alles -----

  /** Zoekt in titel, tegenpartij, omschrijving, notitie, bedrag, categorie, persoon en acties. */
  function searchResults(q, catFilter) {
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2 && !catFilter) return [];
    const words = q.split(/\s+/);
    const amt = C.parseAmount(q);
    const out = [];
    for (const t of state.transactions) {
      const hay = [t.title, t.counterparty, t.description, t.note, t.person, t.categoryId ? catName(t.categoryId) : '', accName(t.accountId),
        C.centsToInput(t.amount), C.centsToInput(Math.abs(t.amount)), ...(t.actions || []).map(id => (actionById(id) || {}).name || ''),
        ...(t.splits || []).map(sp => (sp.note || '') + ' ' + (sp.categoryId ? catName(sp.categoryId) : ''))].join(' ').toLowerCase();
      if (catFilter && !C.splitLines(t).some(l => (l.categoryId || '__none__') === catFilter) && !(t.refundOf && txById(t.refundOf) && C.splitLines(txById(t.refundOf)).some(l => l.categoryId === catFilter))) continue;
      if (q.length < 2 || words.every(w => hay.includes(w)) || (!isNaN(amt) && amt !== 0 && Math.abs(t.amount) === Math.abs(amt))) out.push(t);
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  function searchListHtml(q, catFilter) {
    const res = searchResults(q, catFilter);
    if (String(q || '').trim().length < 2 && !catFilter) return '<p class="small muted">Typ minstens 2 tekens: een naam, een woord uit de omschrijving, een categorie of een bedrag (bv. <code>45,20</code>).</p>';
    if (!res.length) return '<p class="muted">Niets gevonden.</p>';
    const total = res.reduce((a, t) => a + t.amount, 0);
    return `<p class="small muted">${res.length} transactie${res.length === 1 ? '' : 's'} · samen ${money(total)}</p>
      <div class="search-list">${res.slice(0, 150).map(t => `<button class="search-hit" data-action="edit-tx" data-id="${esc(t.id)}">
        <span class="grow"><strong>${esc(t.title || t.counterparty || t.description || '—')}</strong><span class="small muted">${fmtDate(t.date)} · ${esc(accName(t.accountId))}${t.categoryId ? ' · ' + esc(catLabel(t.categoryId)) : ''}${t.title && t.counterparty ? ' · ' + esc(t.counterparty) : ''}</span></span>
        <span class="amount ${amountClass(t.amount)}">${money(t.amount)}</span></button>`).join('')}</div>
      ${res.length > 150 ? `<p class="small muted">De eerste 150 van ${res.length}. Maak je zoekopdracht specifieker.</p>` : ''}`;
  }

  function searchModal() {
    return modalShell('Zoeken', `<input type="search" id="global-search" placeholder="Zoek in al je transacties…" value="${esc(modal.q || '')}" autocomplete="off">
      <select id="global-search-cat" aria-label="Filter op categorie" style="margin-top:8px"><option value="">Alle categorieën</option><option value="__none__" ${modal.cat === '__none__' ? 'selected' : ''}>❔ Nog niet gekoppeld</option>${categoryOptions(modal.cat || null, { special: true, allowEmpty: false })}</select>
      <div id="search-results" style="margin-top:10px">${searchListHtml(modal.q, modal.cat)}</div>`, '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>', true);
  }

