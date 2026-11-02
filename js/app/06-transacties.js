  // ----- Transacties: één tabblad met Te verwerken, Alle transacties, Uitgaven, Inkomsten en Rekeningen -----

  // [sleutel, icoon, naam, korte naam (gsm)]
  const TX_TABS = [['verwerken', '📥', 'Te verwerken', 'Te doen'], ['alle', '📋', 'Alle transacties', 'Alle'], ['uitgaven', '🧾', 'Uitgaven', 'Uitgaven'], ['inkomsten', '💶', 'Inkomsten', 'Inkomsten'], ['rekeningen', '🏦', 'Rekeningen en import', 'Rekeningen']];
  function txTab() {
    if (TX_TABS.some(x => x[0] === ui.txTab)) return ui.txTab;
    return todoCount() ? 'verwerken' : 'alle';
  }

  function renderTransactions() {
    const tab = txTab();
    const todo = todoCount();
    const nav = `<div class="tx-tabs" role="tablist" aria-label="Transacties">${TX_TABS.map(([k, icon, l, short]) => `<button role="tab" class="${tab === k ? 'active' : ''}" aria-selected="${tab === k}" data-action="tx-tab" data-tab="${k}"><span class="tx-ico" aria-hidden="true">${icon}</span><span class="lbl-long">${l}</span><span class="lbl-short">${short}</span>${k === 'verwerken' && todo ? ` <span class="count">${todo}</span>` : ''}</button>`).join('')}</div>`;
    const body = { verwerken: renderInbox, alle: renderBankList, uitgaven: renderExpenses, inkomsten: renderIncome, rekeningen: renderAccounts }[tab]();
    return `<div class="page-head tx-head"><h1>Transacties</h1><span class="spacer"></span>
        <button class="btn" data-action="new-tx" title="Manuele transactie toevoegen">+ <span class="lbl-long">Manuele transactie</span><span class="lbl-short">Manueel</span></button>
        <button class="btn primary" data-action="import" title="Bankbestand opladen">⬆ <span class="lbl-long">Bankbestand opladen</span><span class="lbl-short">Bestand</span></button></div>
      ${nav}${body}`;
  }

  // ----- Te verwerken: één transactie tegelijk, met voorstellen en je vaakst gebruikte categorieën -----

  const inbox = { skipped: new Set(), rule: false };
  function inboxQueue() {
    const list = state.transactions.filter(t => kindOf(t) === 'todo').sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
    const rest = list.filter(t => !inbox.skipped.has(t.id));
    return { list, current: rest[0] || list[0] || null, left: list.length };
  }

  /** Hoe vaak elke categorie al gebruikt werd (meest gebruikte eerst), per richting. */
  function categoryUsage(incoming) {
    const n = {};
    for (const t of state.transactions) {
      if ((t.amount > 0) !== incoming) continue;
      for (const l of C.splitLines(t)) if (l.categoryId && !l.categoryId.startsWith('sys_')) n[l.categoryId] = (n[l.categoryId] || 0) + 1;
    }
    return state.categories.filter(c => incoming ? c.kind === 'income' : c.kind === 'expense')
      .sort((a, b) => (n[b.id] || 0) - (n[a.id] || 0) || a.name.localeCompare(b.name));
  }

  /** Voorstellen voor deze transactie: regel, vorige keer bij dezelfde tegenpartij, terugbetaling, zoekwoorden. */
  function inboxSuggestions(t) {
    const out = [];
    const add = (value, label, why) => { if (!out.some(x => x.value === value)) out.push({ value, label, why }); };
    const sg = ruleSuggestion(t);
    if (sg) add('rule-ok', sg.label, 'regel “' + sg.rule.name + '”');
    const key = C.normalizeName(t.counterparty);
    if (key) {
      const prev = state.transactions.filter(o => o.id !== t.id && (o.amount > 0) === (t.amount > 0) && C.normalizeName(o.counterparty) === key && o.categoryId && kindOf(o) !== 'todo')
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (prev) {
        if (prev.categoryId === C.SYS_ADVANCE && prev.person) add('adv:' + prev.person, (t.amount > 0 ? '🤝 Terugbetaling van ' : '🤝 Voorgeschoten voor ') + prev.person, 'zoals vorige keer');
        else if (!prev.categoryId.startsWith('sys_')) add('cat:' + prev.categoryId, catLabel(prev.categoryId), 'zoals vorige keer (' + fmtDate(prev.date) + ')');
      }
    }
    if (t.amount > 0) {
      const r = C.suggestRefundTargets(state, t, 1)[0];
      if (r && Math.abs(C.daysBetween(r.tx.date, t.date)) <= 30) add('refund:' + r.tx.id, '↩ Terugbetaling van ' + (r.tx.title || r.tx.counterparty || 'een uitgave') + ' (' + money(r.tx.amount) + ')', 'zelfde bedrag of naam');
    }
    const m = C.matchCategory([t.title, t.counterparty, t.description].filter(Boolean).join(' '), state.categories, t.amount > 0 ? 'in' : 'out');
    if (m && m.confidence !== 'laag') add('cat:' + m.categoryId, catLabel(m.categoryId), 'zoekwoord “' + m.hits[0] + '”');
    return out.slice(0, 4);
  }

  function renderInbox() {
    const q = inboxQueue();
    const t = q.current;
    if (!t) {
      return `<div class="card empty-state inbox-empty"><div class="inbox-big">🎉</div><h2>Alles is verwerkt</h2>
        <p class="muted">Nieuwe transacties van je bank komen hier vanzelf terecht. Laad een bankbestand op of koppel je bank bij <a href="#" data-action="tx-tab" data-tab="rekeningen">Rekeningen en import</a>.</p></div>`;
    }
    const incoming = t.amount > 0;
    const sugg = inboxSuggestions(t);
    const cats = categoryUsage(incoming);
    const top = cats.slice(0, 12), more = cats.slice(12);
    const chip = c => `<button class="inbox-cat" data-action="inbox-assign" data-id="${esc(t.id)}" data-value="cat:${esc(c.id)}"><span class="dot" style="background:${esc(c.color || '#999')}"></span>${esc(C.categoryIcon(c) + ' ' + c.name)}</button>`;
    const special = [
      ['cat:' + C.SYS_ADVANCE, incoming ? '🤝 Terugbetaling voorschot' : '🤝 Voorgeschoten voor iemand'],
      incoming ? ['whatis', '❓ Wat is dit geld?'] : null,
      incoming ? ['refund', '↩ Terugbetaling van een uitgave'] : null,
      ['split', '✂ Opsplitsen'],
      ['transfer', '↔ Naar/van eigen rekening'],
      ['cat:' + C.SYS_INVEST, '📈 Belegging'],
      groupsOn() && groupList().length ? ['group:' + groupList()[0].id, '👥 In een groep'] : null
    ].filter(Boolean);
    const cp = t.counterparty || t.description || '';
    const done = inbox.done || 0;
    return `<div class="inbox">
      <div class="inbox-progress small"><span><strong>${q.left}</strong> te verwerken${done ? ` · ${done} gedaan` : ''}</span>
        <span class="spacer"></span><a href="#" data-action="inbox-as-list">Als lijst tonen</a></div>
      <div class="card inbox-card">
        <div class="inbox-tx">
          <div class="grow">
            <div class="small muted">${fmtDate(t.date)} · ${esc(accName(t.accountId))}${t.source === 'import' ? '' : ' · manueel'}</div>
            <div class="inbox-who">${esc(t.title || cp || '—')}</div>
            ${t.title && cp ? `<div class="small muted">${esc(cp)}</div>` : ''}
            ${t.description && t.description !== cp ? `<div class="small muted inbox-desc">${esc(t.description)}</div>` : ''}
          </div>
          <div class="inbox-amount ${incoming ? 'pos' : ''}">${money(t.amount)}<div class="small muted">${incoming ? 'ontvangen' : 'betaald'}</div></div>
        </div>
        <h3 class="inbox-q">${incoming ? 'Wat is dit geld?' : 'Waarvoor was dit?'}</h3>
        ${sugg.length ? `<div class="inbox-sugg">${sugg.map((s, i) => `<button class="inbox-sugg-btn" data-action="inbox-assign" data-id="${esc(t.id)}" data-value="${esc(s.value)}"><kbd>${i + 1}</kbd><span class="grow"><strong>${esc(s.label)}</strong><span class="small muted">💡 ${esc(s.why)}</span></span></button>`).join('')}</div>` : ''}
        <div class="inbox-label small muted">${sugg.length ? 'Of kies een categorie' : 'Kies een categorie'}</div>
        <div class="inbox-cats">${top.map(chip).join('')}
          <button class="inbox-cat new" data-action="inbox-assign" data-id="${esc(t.id)}" data-value="new-cat">+ Nieuwe ${incoming ? 'inkomstenbron' : 'categorie'}</button></div>
        ${more.length ? `<details class="inbox-more"><summary class="small">Alle categorieën (${cats.length})</summary><div class="inbox-cats">${more.map(chip).join('')}</div></details>` : ''}
        <div class="inbox-search">${assignSelect(t)}<span class="small muted">Typ om te zoeken in alles: categorieën, personen, groepen, …</span></div>
        <div class="inbox-label small muted">Iets anders?</div>
        <div class="inbox-special">${special.map(([v, l]) => `<button class="btn small" data-action="inbox-assign" data-id="${esc(t.id)}" data-value="${esc(v)}">${l}</button>`).join('')}</div>
        <div class="inbox-foot">
          ${cp ? `<label class="check-row small"><input type="checkbox" data-inbox-rule ${inbox.rule ? 'checked' : ''}> <span>⚙ Voortaan altijd zo voor “${esc(cp.slice(0, 40))}”</span></label>` : ''}
          <span class="spacer"></span>
          <button class="btn small ghost" data-action="edit-tx" data-id="${esc(t.id)}">Details…</button>
          <button class="btn small" data-action="inbox-skip" data-id="${esc(t.id)}" title="Later (S)">Overslaan ⏭</button>
        </div>
      </div>
      <p class="small muted inbox-keys">Sneltoetsen: <kbd>1</kbd>–<kbd>4</kbd> voorstel kiezen · <kbd>S</kbd> overslaan · <kbd>/</kbd> zoeken</p>
    </div>`;
  }

  /** Een keuze uit de verwerker toepassen; daarna verschijnt vanzelf de volgende transactie. */
  function inboxAssign(id, value) {
    const t = txById(id);
    if (!t) return;
    const before = { categoryId: t.categoryId || null, categorySource: t.categorySource || null, ruleId: t.ruleId || null, transferMode: t.transferMode, person: t.person, refundOf: t.refundOf || null };
    const wantRule = inbox.rule && value.startsWith('cat:') && !value.startsWith('cat:sys_');
    assignTx(id, value);
    if (kindOf(t) === 'todo') return; // er ging een venster open (splitsen, voorschot, ...)
    inbox.done = (inbox.done || 0) + 1;
    inbox.skipped.delete(id);
    if (wantRule && ui.ruleHint && ui.ruleHint.txId === id) { ruleFromHint(id); return; }
    toast('✓ ' + (t.counterparty || t.title || 'Transactie') + ' → ' + (assignLabel(t) || 'verwerkt'), { label: 'Ongedaan maken', run: () => {
      const x = txById(id);
      if (!x) return;
      Object.assign(x, before);
      if (!before.person) delete x.person;
      inbox.done = Math.max(0, (inbox.done || 1) - 1);
      commit('Teruggezet');
    } });
  }

  function inboxKey(ev) {
    if (ui.view !== 'transactions' || txTab() !== 'verwerken' || modal || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
    const t = inboxQueue().current;
    if (!t) return false;
    if (/^[1-4]$/.test(ev.key)) {
      const s = inboxSuggestions(t)[Number(ev.key) - 1];
      if (s) { ev.preventDefault(); inboxAssign(t.id, s.value); return true; }
    }
    if (ev.key === 's' || ev.key === 'S') { ev.preventDefault(); inbox.skipped.add(t.id); render(); return true; }
    if (ev.key === '/') { const i = $('.inbox-search [data-assign-input]'); if (i) { ev.preventDefault(); i.focus(); return true; } }
    return false;
  }
