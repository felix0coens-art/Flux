  // ----- Online opzoeken -----

  const localNominatimQueue = Lookup ? Lookup.createQueue(1100) : null;
  async function lookupBatch(items) {
    const st = state.settings;
    if (Sync && Sync.mode === 'server') {
      const r = await Sync.lookup({ items: items.map(i => ({ name: i.name, description: i.description, direction: i.direction })), categories: state.categories.filter(c => c.kind === 'income' || c.kind === 'expense').map(c => ({ id: c.id, name: c.name, kind: c.kind })), provider: st.lookupProvider || 'auto', countries: st.lookupCountries || 'be' });
      return r.results;
    }
    if (Sync && Sync.mode === 'offline') throw new Error('Geen verbinding met je Helder-server');
    return Promise.all(items.map(i => Lookup.lookupFree({ name: i.name, description: i.description }, { countries: st.lookupCountries || 'be', nominatimQueue: localNominatimQueue })));
  }
  function suggestionFor(result, direction) {
    if (!result) return null;
    if (result.ai && result.ai.categoryId && cat(result.ai.categoryId)) return { categoryId: result.ai.categoryId, confidence: result.ai.confidence, why: [result.ai.businessType, result.ai.explanation].filter(Boolean).join(' — ') };
    const m = C.matchCategory(result.text, state.categories.filter(c => c.kind === 'income' || c.kind === 'expense'), direction);
    return m ? { categoryId: m.categoryId, confidence: m.confidence, why: 'herkend aan: ' + m.hits.slice(0, 3).join(', ') } : null;
  }
  function hitsHtml(result) {
    if (!result) return '';
    const parts = [];
    if (result.ai) parts.push(`<div><strong>AI:</strong> ${esc(result.ai.businessType)} <span class="muted">${esc(result.ai.explanation || '')}</span></div>`);
    for (const h of result.hits || []) parts.push(`<div><a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">${esc(h.label)}</a> <span class="muted">(${esc(h.source)})</span> — ${esc(h.description)}</div>`);
    return parts.join('') || '<span class="muted">Niets gevonden</span>';
  }
  function openLookup(candidates) {
    openModal({ type: 'lookup', rows: candidates.map(c => ({ cand: c, status: 'pending', result: null, sugg: null, categoryId: '', makeRule: true })), running: true });
    runLookup(modal);
  }
  async function runLookup(m) {
    const chunk = Sync && Sync.mode === 'server' ? 5 : 3;
    for (let i = 0; i < m.rows.length; i += chunk) {
      if (modal !== m) return;
      const part = m.rows.slice(i, i + chunk);
      try {
        const results = await lookupBatch(part.map(r => r.cand));
        part.forEach((r, j) => { r.result = results[j]; r.sugg = suggestionFor(results[j], r.cand.direction); r.status = 'done'; if (r.sugg && !r.touched) r.categoryId = r.sugg.categoryId; });
      } catch (e) {
        part.forEach(r => { r.status = 'error'; });
        m.error = e.message;
        if (/verbinding|offline|Failed to fetch|NetworkError/i.test(e.message)) break;
      }
      if (modal === m) renderModal();
    }
    m.running = false;
    m.rows.forEach(r => { if (r.status === 'pending') r.status = 'error'; });
    if (modal === m) renderModal();
  }
  function lookupModal() {
    const m = modal;
    const done = m.rows.filter(r => r.status !== 'pending').length;
    const conf = { hoog: 'ok', middel: 'warn', laag: 'over' };
    const chosen = m.rows.filter(r => r.categoryId).length;
    return modalShell('Tegenpartijen online opzoeken', `
      <p class="small muted">Kijk de voorstellen na. Met <em>regel</em> aangevinkt worden ook toekomstige transacties van die tegenpartij vanzelf gekoppeld.</p>
      ${m.running ? `<div class="progress"><div class="bar" style="width:${(done / Math.max(1, m.rows.length) * 100).toFixed(0)}%"></div></div><p class="small muted">${done} / ${m.rows.length}…</p>` : ''}
      ${m.error ? `<div class="notice">Opzoeken lukte niet volledig: ${esc(m.error)}</div>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Tegenpartij</th><th>Gevonden</th><th>Koppelen aan</th><th>Regel</th></tr></thead>
        <tbody>${m.rows.map((r, i) => `<tr><td><strong>${esc(r.cand.name)}</strong><div class="small muted">${r.cand.count}× · ${money(r.cand.total)}</div></td>
          <td class="small lookup-hits">${r.status === 'pending' ? '<span class="muted">bezig…</span>' : r.status === 'error' ? '<span class="muted">mislukt</span>' : hitsHtml(r.result)}
            ${r.sugg ? `<div><span class="badge ${conf[r.sugg.confidence] || ''}">zekerheid ${esc(r.sugg.confidence)}</span> <span class="muted">${esc(r.sugg.why)}</span></div>` : ''}</td>
          <td><select data-lookup-cat="${i}">${categoryOptions(r.categoryId, { emptyLabel: '— Overslaan —', kind: r.cand.direction === 'in' ? 'income' : 'expense' })}</select></td>
          <td><input type="checkbox" data-lookup-rule="${i}" ${r.makeRule ? 'checked' : ''} aria-label="Regel maken"></td></tr>`).join('')}</tbody></table></div>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button><button class="btn primary" data-action="lookup-apply" ${chosen ? '' : 'disabled'}>${chosen} toepassen</button>`, true);
  }
  function ruleForCandidate(r) {
    let value = r.cand.key;
    for (const o of [r.result && r.result.query].concat(((r.result && r.result.hits) || []).map(h => h.label))) {
      const q = o ? C.normalizeText(o) : '';
      if (q.length >= 3 && q.length < value.length && (' ' + r.cand.key + ' ').startsWith(' ' + q + ' ')) value = q;
    }
    return { id: C.uid('rule'), name: r.cand.name, field: r.cand.field === 'counterparty' ? 'counterparty' : 'any', operator: 'name', value, categoryId: r.categoryId, direction: r.cand.direction, enabled: true, priority: Math.max(0, ...state.rules.map(x => x.priority || 0)) + 10, origin: 'lookup' };
  }
  function applyLookup() {
    let rules = 0, txs = 0;
    for (const r of modal.rows) {
      if (!r.categoryId) continue;
      if (r.makeRule) { state.rules.push(ruleForCandidate(r)); rules++; }
      else for (const id of r.cand.txIds) { const t = txById(id); if (t && !t.categoryId) { t.categoryId = r.categoryId; t.categorySource = 'manual'; txs++; } }
    }
    closeModal();
    commit(`${rules} regel(s) aangemaakt${txs ? `, ${txs} transactie(s) gekoppeld` : ''}`);
  }
  /** Voorstel op basis van je eigen titel: eerst de zoekwoorden van je categorieën, daarna (optioneel) AI. */
  function updateTitleSuggestion() {
    const el = $('#tx-title-sugg');
    if (!el) return;
    const title = $('#tx-title').value.trim();
    if (!title) { el.innerHTML = ''; return; }
    const direction = C.parseAmount($('#tx-amount').value) > 0 ? 'in' : 'out';
    const m = C.matchCategory(title, state.categories.filter(c => c.kind === 'income' || c.kind === 'expense'), direction);
    const current = $('#tx-category').value;
    const aiOn = Sync && Sync.mode === 'server' && Sync.features && Sync.features.ai;
    el.innerHTML = (m && m.categoryId !== current ? `→ Voorstel uit je titel: <strong>${esc(catLabel(m.categoryId))}</strong> <span class="muted">(${esc(m.hits.slice(0, 2).join(', '))})</span> <button class="btn small" type="button" data-action="apply-sugg" data-id="${esc(m.categoryId)}">Toepassen</button> ` : '')
      + (aiOn ? `<button class="btn small ghost" type="button" data-action="ai-title">🤖 Laat AI de categorie kiezen</button>` : (!m ? '<span class="muted">Geen categorie herkend in je titel. Tip: voeg zoekwoorden toe aan je categorieën (Instellingen).</span>' : ''));
  }

  async function aiFromTitle() {
    const el = $('#tx-title-sugg');
    const item = { title: $('#tx-title').value.trim(), name: $('#tx-counterparty').value.trim(), description: $('#tx-description').value.trim(), direction: C.parseAmount($('#tx-amount').value) > 0 ? 'in' : 'out' };
    el.innerHTML = '<span class="muted">AI denkt na…</span>';
    try {
      const r = await Sync.lookup({ items: [item], categories: state.categories.filter(c => c.kind === 'income' || c.kind === 'expense').map(c => ({ id: c.id, name: c.name, kind: c.kind })), provider: 'ai', countries: state.settings.lookupCountries || 'be' });
      const a = r.results[0] && r.results[0].ai;
      if (a && a.categoryId) {
        $('#tx-category').value = a.categoryId;
        updateSplitRemaining(); updateTxSections();
        el.innerHTML = `🤖 Gekozen: <strong>${esc(catLabel(a.categoryId))}</strong> <span class="muted">— ${esc(a.explanation || a.businessType || '')} (zekerheid ${esc(a.confidence)})</span>`;
      } else el.innerHTML = `<span class="muted">AI vond geen passende categorie${a && a.explanation ? ': ' + esc(a.explanation) : ''}.</span>`;
    } catch (e) { el.innerHTML = `<span style="color:var(--red)">AI lukte niet: ${esc(e.message)}</span>`; }
  }

  async function lookupOne() {
    const el = $('#tx-lookup-result');
    const item = { name: $('#tx-counterparty').value.trim(), description: $('#tx-description').value.trim() };
    if (!item.name && !item.description) { el.textContent = 'Vul eerst een tegenpartij of mededeling in.'; return; }
    item.direction = C.parseAmount($('#tx-amount').value) > 0 ? 'in' : 'out';
    el.innerHTML = '<span class="muted">Bezig met opzoeken…</span>';
    try {
      const [res] = await lookupBatch([item]);
      const sg = suggestionFor(res, item.direction);
      el.innerHTML = `<div class="section lookup-hits">${hitsHtml(res)}${sg ? `<div>→ voorstel: <strong>${esc(catLabel(sg.categoryId))}</strong> <span class="muted">(${esc(sg.why)})</span></div>` : '<div class="muted">Geen passende categorie gevonden.</div>'}</div>`;
      if (sg && !$('#tx-category').value) { $('#tx-category').value = sg.categoryId; updateSplitRemaining(); }
    } catch (e) { el.innerHTML = `<span style="color:var(--red)">Opzoeken mislukt: ${esc(e.message)}</span>`; }
  }

