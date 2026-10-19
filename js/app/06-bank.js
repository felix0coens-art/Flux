  // ----- Bank -----

  function bankTxFilter(t) {
    const f = ui.bank;
    if (f.account && t.accountId !== f.account) return false;
    // Categorie: ook gesplitste transacties en terugbetalingen die (deels) in die categorie vallen
    if (f.category) {
      const ids = C.splitLines(t).map(l => l.categoryId || '__none__');
      const orig = t.refundOf ? txById(t.refundOf) : null;
      if (orig) ids.push(...C.splitLines(orig).map(l => l.categoryId || '__none__'));
      if (t.isTransfer ? f.category !== '__transfer__' : !ids.includes(f.category)) return false;
    }
    const k = kindOf(t);
    if (f.status === 'todo' && k !== 'todo') return false;
    if (f.status === 'done' && k === 'todo') return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!`${t.title || ''} ${t.counterparty} ${t.description} ${t.note || ''} ${C.centsToInput(t.amount)}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  /** Eén keuzelijst om een transactie te koppelen aan wat ze is. */
  /** Keuzes om een transactie te koppelen (zelfde opties als vroeger in de keuzelijst). */
  function assignOptions(t, bulk) {
    const incoming = t ? t.amount > 0 : false;
    const out = [];
    const add = (value, label, group, hint) => out.push({ value, label, group, hint: hint || '' });
    const cats = (kind, group) => state.categories.filter(c => c.kind === kind).sort((a, b) => a.name.localeCompare(b.name))
      .forEach(c => add('cat:' + c.id, C.categoryIcon(c) + ' ' + c.name, group, isIncomeCost(c) ? '− ' + catName(c.incomeId) : ''));
    if (bulk) {
      cats('expense', 'Uitgave'); cats('income', 'Inkomst');
      add('cat:' + C.SYS_INVEST, '📈 Belegging (storting/opname)', 'Speciaal');
      add('transfer', '↔ Naar/van eigen rekening', 'Speciaal');
      add('', '— Terug naar te verwerken —', 'Speciaal');
      return out;
    }
    // Inkomend geld: past het bij een uitgave (iemand betaalt je terug, een annulering)? Dan meteen voorstellen.
    const refunds = incoming ? C.suggestRefundTargets(state, t, 4) : [];
    const refundGroup = '↩ Terugbetaling van een uitgave';
    const addRefunds = () => refunds.forEach(r => add('refund:' + r.tx.id, '↩ ' + (r.tx.title || r.tx.counterparty || r.tx.description || 'uitgave') + ' ' + money(r.tx.amount), refundGroup, fmtDate(r.tx.date) + (r.openAmount < -r.tx.amount ? ' · nog ' + money(r.openAmount) + ' open' : '')));
    const strong = refunds.length && Math.abs(C.daysBetween(refunds[0].tx.date, t.date)) <= 7;
    if (incoming) add('whatis', '❓ Wat is dit geld? — ik help je kiezen', 'Hulp');
    if (strong) addRefunds();
    cats(incoming ? 'income' : 'expense', incoming ? 'Inkomst' : 'Uitgave');
    add('new-cat', incoming ? '+ Nieuwe inkomstenbron…' : '+ Nieuwe categorie…', incoming ? 'Inkomst' : 'Uitgave');
    for (const p of C.personList(state).sort((a, b) => a.name.localeCompare(b.name))) {
      add('adv:' + p.name, incoming ? '🤝 Terugbetaling van ' + p.name : '🤝 Voorgeschoten voor ' + p.name, 'Voorschot', incoming && p.stats.open > 0 ? 'nog ' + money(p.stats.open) + ' open' : '');
    }
    add('cat:' + C.SYS_ADVANCE, incoming ? '↙ Terugbetaling van iemand anders…' : '↗ Voorgeschoten voor iemand anders…', 'Voorschot');
    if (incoming) add('whatis:prepaid', '📥 Vooruitbetaald voor iets dat ik nog betaal (bv. Airbnb)…', 'Voorschot');
    if (incoming && !strong) addRefunds();
    if (incoming) add('refund', '↩ Terugbetaling van een andere uitgave…', 'Speciaal');
    add('cat:' + C.SYS_INVEST, '📈 Belegging (storting/opname)', 'Speciaal');
    add('transfer', '↔ Naar/van eigen rekening', 'Speciaal');
    add('split', '✂ Opsplitsen…', 'Speciaal');
    if (t && (t.categoryId || t.isTransfer)) add('', '— Terug naar te verwerken —', 'Speciaal');
    cats(incoming ? 'expense' : 'income', incoming ? 'Toch een uitgave' : 'Toch een inkomst');
    return out;
  }

  function assignLabel(t) {
    if (t.isTransfer) return '↔ Eigen rekening';
    if (t.categoryId === C.SYS_ADVANCE) return t.amount > 0 ? '↙ Terugbetaling voorschot' : '↗ Voorgeschoten';
    if (t.categoryId === C.SYS_INVEST) return '📈 Belegging';
    return t.categoryId ? catLabel(t.categoryId) : '';
  }

  function assignSelect(t) {
    const k = kindOf(t);
    if (k === 'split' || k === 'refund' || (t.splits && t.splits.length)) return `<button class="btn small" data-action="edit-tx" data-id="${esc(t.id)}">${k === 'refund' ? '↩ Terugbetaling' : '✂ Gesplitst'} — bekijk</button>`;
    const label = assignLabel(t);
    return `<div class="assign-box ${label ? '' : 'todo'}"><input type="text" class="assign-input" data-assign-input="${esc(t.id)}" value="${esc(label)}" data-label="${esc(label)}"
      placeholder="Te verwerken — typ…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="Koppelen"><span class="assign-caret" aria-hidden="true">▾</span></div>`;
  }

