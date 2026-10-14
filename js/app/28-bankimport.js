  // ----- Bankimport -----

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        if (String(r.result).includes('�')) {
          const r2 = new FileReader();
          r2.onload = () => resolve(r2.result);
          r2.onerror = reject;
          r2.readAsText(file, 'windows-1252');
        } else resolve(r.result);
      };
      r.onerror = reject;
      r.readAsText(file, 'utf-8');
    });
  }

  function importModal() {
    const m = modal;
    if (!m.parts) {
      return modalShell('Bankbestand opladen', `
        <p>Kies de CSV-export van je bank. <strong>KBC/CBC</strong> en <strong>Argenta</strong> worden automatisch herkend, inclusief de rekening (IBAN).</p>
        <details class="small"><summary>Hoe exporteer ik dit?</summary>
          <p><strong>KBC/CBC</strong>: KBC Touch op de computer → <em>Rekeningen</em> → kies je rekening → <em>Verrichtingen</em> → kies de periode → <em>Exporteren</em> → <strong>CSV</strong>.</p>
          <p><strong>Argenta</strong>: internetbankieren → <em>Rekeningen</em> → je rekening → <em>Verrichtingen</em> → <em>Downloaden</em> → <strong>CSV</strong>.</p>
          <p class="muted">Overlappende periodes zijn geen probleem: transacties die al in Helder zitten worden overgeslagen.</p></details>
        <label class="field"><span>Bestand</span><input type="file" id="imp-file" accept=".csv,.txt,text/csv"></label>
        <div class="errors" id="imp-errors"></div>`, '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>');
    }
    const blocked = m.parts.every(p => p.plan.sameFile);
    const body = `
      <p class="small muted">📄 <strong>${esc(m.fileName)}</strong> · ${m.parsed.profile ? 'herkend als <strong>' + esc(m.parsed.profile.name) + '</strong>' : '<strong>onbekend formaat</strong> — duid de kolommen aan'} · ${m.parsed.rowCount} rijen${m.parsed.errors.length ? ` · ${m.parsed.errors.length} ongeldige rij(en) (rij ${m.parsed.errors.slice(0, 5).join(', ')}${m.parsed.errors.length > 5 ? '…' : ''})` : ''}</p>
      ${!m.parsed.profile ? mappingFields() : ''}
      <div class="data-from-row"><label class="field"><span>📅 Transacties vanaf <span class="muted small">(voor al je banken)</span></span><input type="date" id="imp-from" value="${esc(state.settings.dataFrom || '')}" max="${today}"></label>
        <p class="small muted">Kies dezelfde startdatum voor elke bank, dan lopen je rekeningen gelijk en zitten oudere transacties van één bank niet tussen de rest. Leeg = alles.</p></div>
      ${m.parts.map((p, i) => {
        const a = p.accountId ? acc(p.accountId) : null;
        const sf = p.plan.sameFile;
        const isNewAcc = !p.accountId && (p.accountIban || p.wantNew);
        return `<div class="section">
          <h3>${p.accountIban ? 'Rekening ' + esc(C.formatIban(p.accountIban)) : 'Rekening'}</h3>
          ${sf ? `<div class="notice danger">⛔ Dit bestand werd al opgeladen op ${esc(fmtDateTime(sf.importedAt))} (“${esc(sf.fileName)}”). Er wordt niets toegevoegd.</div>` : ''}
          <div class="form-grid">
            ${isNewAcc ? `<label class="field"><span>Nieuwe rekening — naam</span><input type="text" data-part-name="${i}" value="${esc(p.newName)}"></label>
              <label class="field"><span>Soort</span><select data-part-type="${i}">${[['zicht', 'Zichtrekening'], ['spaar', 'Spaarrekening'], ['andere', 'Andere']].map(([v, l]) => `<option value="${v}" ${p.newType === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
              : `<label class="field full"><span>Rekening in Helder${a && p.accountIban ? ' (herkend op IBAN)' : ''}</span><select data-part-account="${i}" ${a && p.accountIban ? 'disabled' : ''}><option value="">— Kies —</option>${accountOptions(p.accountId, x => x.type !== 'cash')}<option value="__new__">+ Nieuwe rekening…</option></select></label>`}
          </div>
          <div class="import-summary">
            <div><strong>${p.plan.fresh.length}</strong><span>nieuw</span></div>
            <div><strong>${p.plan.duplicates.length}</strong><span>zat er al in</span></div>
            <div><strong>${p.parsed.period ? fmtDate(p.parsed.period.from) + ' – ' + fmtDate(p.parsed.period.to) : '—'}</strong><span>periode</span></div>
            <div><strong>${p.parsed.balance ? money(p.parsed.balance.amount) : '—'}</strong><span>${p.parsed.balance ? 'saldo op ' + fmtDate(p.parsed.balance.date) : 'geen saldo in bestand'}</span></div>
          </div>
          ${p.plan.tooOld && p.plan.tooOld.length ? `<p class="small muted">${p.plan.tooOld.length} transacties van vóór ${fmtDate(state.settings.dataFrom)} worden overgeslagen (startdatum).</p>` : ''}
          ${p.plan.duplicates.some(d => d.deleted) ? `<p class="small muted">Waarvan ${p.plan.duplicates.filter(d => d.deleted).length} die je eerder verwijderde: die blijven weg.</p>` : ''}
          ${Object.keys(p.plan.fromImports).length ? `<p class="small muted">Al aanwezig uit: ${Object.entries(p.plan.fromImports).map(([id, n]) => `${esc(imp(id) ? imp(id).fileName : '?')} (${n})`).join(', ')}</p>` : ''}
          ${p.plan.fresh.length && !sf ? `<details><summary class="small">Bekijk de ${p.plan.fresh.length} nieuwe transacties</summary><div class="table-wrap"><table><tbody>${p.plan.fresh.slice(0, 50).map(t => `<tr><td class="nowrap">${fmtDate(t.date)}</td><td>${esc(t.counterparty)}<div class="desc">${esc(t.description)}</div></td><td class="amount ${amountClass(t.amount)}">${money(t.amount)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
        </div>`;
      }).join('')}
      <div class="errors" id="imp-errors"></div>`;
    const total = m.parts.filter(p => !p.plan.sameFile).reduce((s, p) => s + p.plan.fresh.length, 0);
    const foot = `<button class="btn" data-action="import-restart">Ander bestand</button><span class="spacer"></span><button class="btn" data-action="close-modal">${blocked ? 'Sluiten' : 'Annuleren'}</button>
      ${blocked ? '' : `<button class="btn primary" data-action="do-import" ${total ? '' : 'disabled'}>${total ? total + ' transacties toevoegen' : 'Niets nieuws'}</button>`}`;
    return modalShell('Bankbestand opladen', body, foot, true);
  }

  function mappingFields() {
    const headers = modal.parsed.headers;
    const map = modal.mapping || {};
    const opts = sel => '<option value="">—</option>' + headers.map((h, i) => `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(h || 'Kolom ' + (i + 1))}</option>`).join('');
    return `<div class="section"><h3>Kolommen</h3><div class="form-grid">${[['date', 'Datum *'], ['amount', 'Bedrag'], ['debit', 'Debet'], ['credit', 'Credit'], ['counterparty', 'Tegenpartij'], ['counterpartyIban', 'IBAN tegenpartij'], ['description', 'Mededeling']]
      .map(([k, l]) => `<label class="field"><span>${l}</span><select data-map="${k}">${opts(map[k])}</select></label>`).join('')}</div></div>`;
  }

  /** (Her)berekent per rekening in het bestand wat nieuw is en wat er al in zit. */
  function planImport() {
    const m = modal;
    if (!m.parsed.profile && !m.mapping) m.mapping = Object.assign({}, m.parsed.mapping || {});
    const parsed = m.parsed.profile ? m.parsed : Banks.parse(m.text, { mapping: m.mapping, headerRow: m.parsed.headerRow });
    const prevParts = m.parts || [];
    const bank = m.parsed.profile ? m.parsed.profile.name.split(' ')[0] : 'Bank';
    m.parts = Banks.splitByAccount(parsed).map((p, i) => {
      const prev = prevParts[i] || {};
      const existing = p.accountIban ? state.accounts.find(a => C.normalizeIban(a.iban) === p.accountIban) : null;
      const accountId = existing ? existing.id : prev.accountId !== undefined ? prev.accountId : (p.accountIban ? null : (m.accountHint || null));
      const part = { parsed: p, accountIban: p.accountIban, accountId, wantNew: prev.wantNew, newName: prev.newName || `${bank} ${p.accountIban ? '…' + p.accountIban.slice(-4) : 'rekening'}`, newType: prev.newType || 'zicht' };
      part.plan = Banks.plan(state, p, accountId || '__nieuw__', m.text, m.fileName);
      return part;
    });
  }

  async function loadImportFile(file) {
    try {
      const text = await readFile(file);
      const parsed = Banks.parse(text);
      if (!parsed.rowCount) { $('#imp-errors').textContent = 'Dit bestand bevat geen leesbare rijen.'; return; }
      Object.assign(modal, { text, fileName: file.name, parsed, mapping: null, parts: null });
      planImport();
      renderModal();
    } catch (e) { $('#imp-errors').textContent = 'Kon het bestand niet lezen: ' + e.message; }
  }

  function doImport() {
    const m = modal;
    const errs = [];
    m.parts.forEach((p, i) => {
      if (p.plan.sameFile) return;
      const nameEl = $(`[data-part-name="${i}"]`);
      if (!p.accountId && !nameEl) errs.push('Kies voor elke rekening in het bestand waar de transacties bij horen.');
      if (nameEl && !nameEl.value.trim()) errs.push('Geef de nieuwe rekening een naam.');
    });
    if (errs.length) { $('#imp-errors').innerHTML = Array.from(new Set(errs)).join('<br>'); return; }
    let added = 0, skipped = 0;
    m.parts.forEach((p, i) => {
      if (p.plan.sameFile) return;
      let accountId = p.accountId;
      if (!accountId) {
        accountId = C.uid('acc');
        const acct = { id: accountId, name: $(`[data-part-name="${i}"]`).value.trim(), iban: p.accountIban || '', type: $(`[data-part-type="${i}"]`).value };
        if (m.parsed.profile) acct.bank = m.parsed.profile.id;
        state.accounts.push(acct);
      }
      const planned = Banks.plan(state, p.parsed, accountId, m.text, m.fileName);
      if (planned.sameFile) return;
      Banks.apply(state, planned, p.parsed, accountId);
      added += planned.fresh.length; skipped += planned.duplicates.length;
    });
    closeModal();
    ui.bank = Object.assign(ui.bank, { status: 'todo', account: '' });
    go('bank', true);
    commit(`${added} transacties toegevoegd${skipped ? `, ${skipped} overgeslagen (zaten er al in)` : ''}`);
    const cands = C.lookupCandidates(state);
    if (added && cands.length && state.settings.autoLookup !== false && confirm(`${cands.length} tegenpartij(en) zijn nog onbekend. Online opzoeken om ze te koppelen?`)) openLookup(cands);
  }

  function importViewModal() {
    const i = imp(modal.id);
    if (!i) return modalShell('Import', '<p>Niet gevonden.</p>', '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
    const txs = state.transactions.filter(t => t.importId === i.id).sort((a, b) => b.date.localeCompare(a.date));
    return modalShell('📄 ' + i.fileName, `
      <p class="small muted">${esc(i.bankName || '')} · ${esc(accName(i.accountId))} · ${i.period ? fmtDate(i.period.from) + ' – ' + fmtDate(i.period.to) : ''} · opgeladen ${esc(fmtDateTime(i.importedAt))}<br>
        ${txs.length} transacties toegevoegd · ${i.duplicates || 0} overgeslagen omdat ze er al in zaten${i.errors ? ' · ' + i.errors + ' ongeldige rijen' : ''}</p>
      <div class="table-wrap"><table><tbody>${txs.map(t => `<tr><td class="nowrap">${fmtDate(t.date)}</td><td>${esc(t.counterparty)}<div class="desc">${esc(t.description)}</div></td><td class="amount ${amountClass(t.amount)}">${money(t.amount)}</td><td>${kindBadge(kindOf(t))}</td></tr>`).join('')}</tbody></table></div>`,
      `<button class="btn danger" data-action="undo-import" data-id="${esc(i.id)}">Deze import ongedaan maken</button><span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>`, true);
  }

