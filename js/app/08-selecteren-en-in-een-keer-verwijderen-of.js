  // ----- Selecteren en in één keer verwijderen of koppelen -----

  ui.selected = new Set();

  function selectionBar() {
    const n = ui.selected.size;
    if (!n) return '';
    return `<div class="select-bar" role="region" aria-label="Selectie">
      <strong>${n} geselecteerd</strong>
      <div class="assign-box bulk"><input type="text" class="assign-input" data-assign-input="__bulk__" data-label="" value="" placeholder="Koppelen aan… (typ)" autocomplete="off" role="combobox" aria-expanded="false"><span class="assign-caret" aria-hidden="true">▾</span></div>
      ${(() => { const r = bulkRefundTarget(); return r ? `<button class="btn small primary" data-action="bulk-refund" title="De inkomende bedragen tellen als terugbetaling van deze uitgave">↩ ${r.incomes.length === 1 ? 'Terugbetaling' : r.incomes.length + ' terugbetalingen'} van ${esc((r.expense.title || r.expense.counterparty || 'de uitgave').slice(0, 24))} koppelen</button>` : ''; })()}
      <select class="bulk-action" data-bulk-action aria-label="Actie toevoegen"><option value="">✅ Actie toevoegen…</option>${ACTION_IDEAS.map(x => `<option value="idea:${esc(x)}">${esc(x)}</option>`).join('')}${(state.actions || []).some(a => !a.closed) ? `<optgroup label="Bij een open actie">${actionLists().open.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</optgroup>` : ''}<option value="__new__">+ Andere actie…</option></select>
      <button class="btn small danger" data-action="bulk-delete">🗑 Verwijderen</button>
      <button class="btn small ghost" data-action="bulk-clear">Selectie wissen</button></div>`;
  }

  /** Inkomende betalingen koppelen als terugbetaling van één uitgave (met ongedaan maken). */
  function linkRefunds(incomes, expenseId) {
    const o = txById(expenseId);
    if (!o) return;
    const before = incomes.map(t => ({ id: t.id, refundOf: t.refundOf || null, categoryId: t.categoryId || null, categorySource: t.categorySource || null, ruleId: t.ruleId || null, transferMode: t.transferMode }));
    for (const t of incomes) { t.refundOf = o.id; t.categoryId = null; t.categorySource = null; t.ruleId = null; if (t.isTransfer) t.transferMode = 'no'; }
    ui.selected.clear();
    commit();
    const name = o.title || o.counterparty || o.description || 'de uitgave';
    // Netto wat je zelf betaalde: de uitgave min alles wat erop terugbetaald werd
    toast(`Gekoppeld aan ${name}: zelf betaald ${money(-(o.amount + (C.refundTotals(state)[o.id] || 0)))}`, { label: 'Ongedaan maken', run: () => {
      for (const b of before) { const t = txById(b.id); if (t) Object.assign(t, b); }
      commit('Koppeling ongedaan gemaakt');
    } });
  }

  function bulkRefundTarget() {
    const sel = Array.from(ui.selected).map(txById).filter(Boolean);
    const out = sel.filter(t => t.amount < 0);
    const ins = sel.filter(t => t.amount > 0);
    if (out.length !== 1 || !ins.length || ins.length + 1 !== sel.length || ins.some(t => t.refundOf === out[0].id)) return null;
    return { expense: out[0], incomes: ins };
  }

  function bulkAssign(value) {
    const ids = Array.from(ui.selected);
    let n = 0;
    for (const id of ids) {
      const t = txById(id);
      if (!t || (t.splits && t.splits.length) || (t.refundOf && value !== '')) continue;
      if (value === 'transfer') { t.transferMode = 'yes'; t.categoryId = null; t.categorySource = null; }
      else if (value === '') resetToTodo(t);
      else { t.categoryId = value.slice(4); t.categorySource = 'manual'; t.ruleId = null; if (t.isTransfer) t.transferMode = 'no'; }
      n++;
    }
    ui.selected.clear();
    ui.ruleHint = null;
    commit(n === 1 ? '1 transactie gekoppeld' : n + ' transacties gekoppeld');
  }

  function bulkDelete() {
    const list = Array.from(ui.selected).map(txById).filter(Boolean);
    if (!list.length) return;
    const fromFile = list.filter(t => t.source === 'import').length;
    const total = list.reduce((sum, t) => sum + t.amount, 0);
    if (!confirm(`${list.length} transactie${list.length === 1 ? '' : 's'} verwijderen (samen ${C.formatMoney(total)})?`
      + (fromFile ? `\n\n${fromFile} ervan kwam${fromFile === 1 ? '' : 'en'} uit een bankbestand of de bankkoppeling. Helder onthoudt ze, zodat ze bij een volgende import niet terugkomen.` : '')
      + '\n\nJe kan ze altijd terugzetten via de prullenbak (onderaan in het tabblad Bank).')) return;
    deleteWithUndo(list.map(t => t.id));
  }

  function txRow(t, opts) {
    opts = opts || {};
    const k = kindOf(t);
    const extra = [];
    if (k === 'advance' || k === 'repayment') extra.push(`<span class="badge advance">👤 ${esc(C.splitLines(t).filter(l => l.categoryId === C.SYS_ADVANCE).map(l => l.person || t.person || '?').join(', '))}</span>`);
    if (opts.recurring && opts.recurring[t.id]) extra.push(`<span class="badge recurring" title="Automatisch herkend als terugkerend">🔁 ${esc(opts.recurring[t.id].frequency.label.toLowerCase())}</span>`);
    if (t.categorySource === 'rule') extra.push('<span class="badge small muted" title="Automatisch via een regel">⚙ regel</span>');
    if (t.categorySource === 'system') extra.push('<span class="badge small muted" title="Automatisch herkend">⚙ automatisch</span>');
    if (C.looksLikeRefund(t)) extra.push('<span class="badge maybe">Van een vriend?</span>');
    if ((t.attachments || []).length) extra.push(`<span class="badge small" title="${t.attachments.length} bonnetje(s)">📎 ${t.attachments.length}</span>`);
    for (const id of t.actions || []) { const a = actionById(id); if (a) extra.push(`<span class="badge action-badge ${a.closed ? 'done' : ''}" data-action="action-view" data-id="${esc(a.id)}" title="${a.closed ? 'Actie gedaan' : 'Actie nog te doen'}">${a.closed ? '✓' : '☐'} ${esc(a.name)}</span>`); }
    const hint = ui.ruleHint && ui.ruleHint.txId === t.id && t.categoryId === ui.ruleHint.categoryId && (t.counterparty || t.description);
    const sel = ui.selected.has(t.id);
    return `<tr class="${k === 'todo' ? 'is-todo' : ''} ${t.isTransfer ? 'is-transfer' : ''} ${sel ? 'is-selected' : ''}">
      <td class="sel-cell"><input type="checkbox" data-select="${esc(t.id)}" ${sel ? 'checked' : ''} aria-label="Selecteer"></td>
      <td class="nowrap">${fmtDate(t.date)}${opts.showAccount ? `<div class="small muted">${esc(accName(t.accountId))}</div>` : ''}</td>
      <td class="clickable" data-action="edit-tx" data-id="${esc(t.id)}">${t.title ? `<div class="tx-title" title="Je eigen titel">${esc(t.title)}</div><div class="desc tx-bankname">${esc([t.counterparty, t.description].filter(Boolean).join(' · '))}</div>` : `<div>${esc(t.counterparty || Banks.merchantFromDescription(t.description) || t.description || '—')}</div><div class="desc" title="${esc(t.description)}">${esc(t.description)}</div>`}
        <div class="badge-row">${opts.showKind ? kindBadge(k) : ''}${extra.join('')}${opts.showSource ? sourceBadge(t) : ''}</div></td>
      ${(() => {
        // Uitgave waarop terugbetaald werd (vrienden, annulering): toon wat je zelf betaalde
        const back = opts.refunds && t.amount < 0 ? opts.refunds[t.id] || 0 : 0;
        if (!back) return `<td class="amount ${amountClass(t.amount)}">${money(t.amount)}</td>`;
        const n = state.transactions.filter(x => x.refundOf === t.id).length;
        return `<td class="amount ${amountClass(t.amount + back)}" title="Netto: wat je zelf betaalde">${money(t.amount + back)}
          <div class="small muted refund-note"><s>${money(t.amount)}</s> · ↩ ${money(back)} terug${n > 1 ? ` (${n}×)` : ''}</div></td>`;
      })()}
      <td class="assign-cell">${assignSelect(t)}${t.amount > 0 && k === 'todo' ? `<div><button class="btn small ghost wi-help" data-action="what-is" data-id="${esc(t.id)}">❓ Wat is dit geld?</button></div>` : ''}${hint ? `<div><button class="btn small ghost" data-action="rule-hint" data-id="${esc(t.id)}">⚙ Altijd zo voor “${esc((t.counterparty || t.description).slice(0, 28))}”</button></div>` : ''}</td>
    </tr>`;
  }

  function txTable(list, opts) {
    if (!list.length) return `<div class="card empty-state">${opts && opts.empty || 'Geen transacties.'}</div>`;
    const lim = (opts && opts.limit) || 150;
    const shown = list.slice(0, lim);
    const allSel = shown.length && shown.every(t => ui.selected.has(t.id));
    return `${selectionBar()}<div class="table-wrap"><table class="tx-table">
      <thead><tr><th class="sel-cell"><input type="checkbox" data-select-all="${esc(shown.map(t => t.id).join(','))}" ${allSel ? 'checked' : ''} aria-label="Alles selecteren"></th><th>Datum</th><th>Omschrijving</th><th class="right">Bedrag</th><th>Gekoppeld aan</th></tr></thead>
      <tbody>${(() => { const o = Object.assign({ refunds: C.refundTotals(state) }, opts); return shown.map(t => txRow(t, o)).join(''); })()}</tbody></table></div>
      ${list.length > lim ? `<p style="text-align:center"><button class="btn" data-action="more" data-key="${opts && opts.moreKey || 'list'}">Toon meer (${list.length - lim})</button></p>` : ''}`;
  }

  /** Automatische regels (staan bij Bank, waar je ook de transacties koppelt). */
  function rulesCard() {
    const rules = C.sortedRules(state.rules);
    const ruleCount = {};
    for (const t of state.transactions) if (t.ruleId) ruleCount[t.ruleId] = (ruleCount[t.ruleId] || 0) + 1;
    return `        <div class="card rules-card" style="margin-top:24px">
          <h2>Automatische regels</h2>
          <p class="small muted">Regels koppelen nieuwe transacties vanzelf. Je maakt ze het makkelijkst met <em>⚙ Altijd zo</em> nadat je een transactie koppelde. De bovenste regel die past wint; manuele koppelingen worden nooit overschreven.</p>
          ${rules.length ? `<div class="list scroll">${rules.map((r, i) => `<div class="list-row" style="${r.enabled === false ? 'opacity:.5' : ''}">
            <div class="grow"><strong>${esc(r.name)}</strong> → ${r.categoryId ? catBadge(r.categoryId) : ''}${r.share ? ` <span class="badge" title="Deel als voorschot">🤝 ${r.share.mode === 'amount' ? money(r.share.value) : String(r.share.value).replace('.', ',') + '%'} voor ${esc(r.share.person)}</span>` : ''}${r.action ? ` <span class="badge action-badge" title="Koppelt ook aan een actie">✅ ${esc(r.action.name)}${r.action.perMonth ? ' · elke maand' : ''}</span>` : ''}${r.categoryId === C.SYS_ADVANCE ? ` <span class="small">${r.person ? 'voor ' + esc(r.person) : '<span class="warn-text">voor wie?</span>'}</span>` : ''}<div class="small muted">${esc(C.RULE_FIELDS[r.field])} ${esc(C.RULE_OPERATORS[r.operator])} “${esc(r.value)}” · ${ruleCount[r.id] || 0} treffers</div></div>
            <button class="btn small ghost" data-action="rule-up" data-id="${esc(r.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Hoger">▲</button>
            <button class="btn small" data-action="edit-rule" data-id="${esc(r.id)}">Bewerk</button><button class="btn small danger" data-action="delete-rule" data-id="${esc(r.id)}" aria-label="Verwijder">✕</button></div>`).join('')}</div>` : '<p class="muted">Nog geen regels.</p>'}
          <p class="btn-row"><button class="btn" data-action="new-rule">+ Regel</button></p>
        </div>`;
  }

  /** Voorstellen: inkomst met exact hetzelfde bedrag als een eerdere uitgave (annulering, terugstorting). */
  function cancelCard() {
    const pairs = C.cancellationPairs(state);
    if (!pairs.length) return '';
    const name = t => t.title || t.counterparty || t.description || '—';
    const shown = pairs.slice(0, 8);
    return `<div class="card cancel-card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">↩ Geannuleerd of teruggestort?</h2><span class="spacer"></span>
        ${pairs.length > 1 ? `<button class="btn small primary" data-action="cancel-link-all">Alle ${pairs.length} koppelen</button>` : ''}</div>
      <p class="small muted">Deze inkomsten hebben exact hetzelfde bedrag als een eerdere uitgave, bv. een geannuleerde bestelling. Koppel je ze, dan heffen ze elkaar op: ze tellen niet als inkomst en niet als uitgave.</p>
      <div class="list">${shown.map(p => `<div class="list-row cancel-pair">
        <div class="grow"><strong>${esc(name(p.expense))}</strong>${p.sameName ? '' : ` <span class="small muted">↔ ${esc(name(p.income))}</span>`}
          <div class="small muted">uitgave ${fmtDate(p.expense.date)} <span class="negv">${money(p.expense.amount)}</span> · terug ${fmtDate(p.income.date)} <span class="pos">${money(p.income.amount)}</span>${p.days ? ` · ${p.days} dag${p.days === 1 ? '' : 'en'} later` : ' · zelfde dag'}${state.accounts.length > 1 && p.income.accountId !== p.expense.accountId ? ' · andere rekening' : ''}</div></div>
        <button class="btn small primary" data-action="cancel-link" data-in="${esc(p.income.id)}" data-out="${esc(p.expense.id)}">Koppelen</button>
        <button class="btn small ghost" data-action="cancel-dismiss" data-in="${esc(p.income.id)}" data-out="${esc(p.expense.id)}" title="Dit is geen annulering">Nee</button>
      </div>`).join('')}</div>
      ${pairs.length > shown.length ? `<p class="small muted">… en nog ${pairs.length - shown.length}.</p>` : ''}
    </div>`;
  }

  function linkCancellations(list) {
    const before = list.map(p => ({ id: p.income.id, refundOf: p.income.refundOf || null }));
    for (const p of list) p.income.refundOf = p.expense.id;
    commit();
    toast(list.length === 1 ? 'Gekoppeld: uitgave en terugstorting heffen elkaar op' : list.length + ' annuleringen gekoppeld', { label: 'Ongedaan maken', run: () => {
      for (const b of before) { const t = txById(b.id); if (t) t.refundOf = b.refundOf; }
      commit('Koppeling ongedaan gemaakt');
    } });
  }

  function renderBank() {
    const imports = (state.imports || []).slice().sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    const all = state.transactions.filter(bankTxFilter).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
    const todo = todoCount();
    const f = ui.bank;
    const cards = state.accounts.map(a => {
      const n = state.transactions.filter(t => t.accountId === a.id).length;
      const nTodo = state.transactions.filter(t => t.accountId === a.id && kindOf(t) === 'todo').length;
      const bal = C.accountBalance(state, a.id);
      const last = imports.find(i => i.accountId === a.id);
      const bank = a.bank ? (Banks.PROFILES.find(p => p.id === a.bank) || {}).name || a.bank : '';
      return `<div class="card bank-card ${f.account === a.id ? 'selected' : ''}">
        <div class="top"><div><strong>${esc(a.name)}</strong><div class="small muted">${a.iban ? esc(C.formatIban(a.iban)) : a.type === 'cash' ? 'contant geld' : 'geen IBAN'}${bank ? ' · ' + esc(bank) : ''}</div></div>
          <div class="amount">${bal ? money(bal.amount) : '<span class="muted small">saldo ?</span>'}</div></div>
        <div class="small muted">${n} transacties${nTodo ? ` · <strong class="warn-text">${nTodo} te verwerken</strong>` : ''}${last && last.period ? ` · bestanden t.e.m. ${fmtDate(last.period.to)}` : ''}</div>
        <div class="actions">
          <button class="btn small" data-action="bank-filter" data-id="${esc(a.id)}">${f.account === a.id ? '✓ ' : ''}Transacties</button>
          ${a.type === 'cash' ? `<button class="btn small" data-action="new-tx" data-account="${esc(a.id)}">+ Cash-uitgave</button>` : `<button class="btn small" data-action="import" data-account="${esc(a.id)}">Bestand opladen</button>`}
          <button class="btn small ghost" data-action="edit-account" data-id="${esc(a.id)}">Bewerk</button>
        </div></div>`;
    }).join('');

    return `
      <div class="page-head"><h1>Bank</h1><span class="spacer"></span>
        <button class="btn" data-action="new-tx">+ Manuele transactie</button>
        <button class="btn primary" data-action="import">Bankbestand opladen</button></div>
      ${state.transactions.length ? '' : `<p class="muted">Koppel je bank om transacties automatisch op te halen, of laad de CSV-export van je bank op (KBC/CBC, Argenta en Belfius worden automatisch herkend).
        Elk bestand kan maar één keer opgeladen worden, en transacties die al in Helder zitten worden overgeslagen. Koppel daarna elke transactie aan wat ze is.</p>`}
      ${cancelCard()}
      <h2>Transacties${f.account ? ' — ' + esc(accName(f.account)) : ''}</h2>
      <div class="filters">
        <div class="seg">
          ${[['todo', `Te verwerken (${todo})`], ['done', 'Verwerkt'], ['', 'Alles']].map(([v, l]) => `<button class="${f.status === v ? 'active' : ''}" data-action="bank-status" data-status="${v}">${l}</button>`).join('')}
        </div>
        <select data-filter="bank.account"><option value="">Alle rekeningen</option>${accountOptions(f.account)}</select>
        <input type="search" placeholder="Zoeken…" data-filter="bank.search" value="${esc(f.search)}">
      </div>
      ${txTable(all, { showKind: true, showSource: true, showAccount: !f.account, limit: f.limit, moreKey: 'bank', empty: f.status === 'todo' ? '🎉 Alles is verwerkt.' : 'Geen transacties.' })}
      <h2 style="margin-top:28px">Rekeningen en bankkoppeling</h2>
      <div class="grid cards" style="margin-bottom:16px">${cards}</div>
      ${bankLinkCard()}
      ${rulesCard()}
      ${trashCard()}
      <details class="card import-history" style="margin-top:24px" data-keep="imports" ${ui.keepOpen.imports ? 'open' : ''}>
        <summary><strong>Geschiedenis van imports</strong> <span class="small muted">· ${imports.length} keer gegevens binnengehaald (bestanden en bankkoppeling) — hier kan je een import bekijken of ongedaan maken</span></summary>
        ${imports.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Bestand</th><th>Rekening</th><th>Periode</th><th class="right">Toegevoegd</th><th class="right">Overgeslagen</th><th>Opgeladen</th><th></th></tr></thead>
          <tbody>${imports.map(i => `<tr>
            <td>📄 <strong>${esc(i.fileName)}</strong><div class="small muted">${esc(i.bankName || i.bank)}</div></td>
            <td>${esc(accName(i.accountId))}</td>
            <td class="nowrap">${i.period ? fmtDate(i.period.from) + ' – ' + fmtDate(i.period.to) : '—'}</td>
            <td class="right">${state.transactions.filter(t => t.importId === i.id).length}</td>
            <td class="right small muted" title="Rijen die al in Helder zaten">${i.duplicates || 0} dubbel${i.errors ? ` · ${i.errors} ongeldig` : ''}</td>
            <td class="nowrap small">${esc(fmtDateTime(i.importedAt))}</td>
            <td class="nowrap right"><button class="btn small" data-action="show-import" data-id="${esc(i.id)}">Bekijk</button>
              <button class="btn small danger" data-action="undo-import" data-id="${esc(i.id)}">Ongedaan maken</button></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nog geen bestanden opgeladen.</p>'}
      </details>`;
  }

