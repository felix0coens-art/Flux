  // ---------- Hulpjes ----------

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const money = C.formatMoney;
  const pct = v => v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1).replace('.', ',') + '%';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function cat(id) { return state.categories.find(c => c.id === id); }
  function catName(id) { const c = cat(id); return c ? c.name : 'Niet gekoppeld'; }
  function catIcon(id) { return id ? C.categoryIcon(cat(id)) : '❔'; }
  function catLabel(id) { return id ? catIcon(id) + ' ' + catName(id) : 'Nog niet gekoppeld'; }
  function catColor(id) { const c = cat(id); return c ? c.color : '#ced4da'; }
  function acc(id) { return state.accounts.find(a => a.id === id); }
  function accName(id) { const a = acc(id); return a ? a.name : '—'; }
  function txById(id) { return state.transactions.find(t => t.id === id); }
  function imp(id) { return (state.imports || []).find(i => i.id === id); }
  function fmtDate(d) { if (!d) return ''; const [y, m, day] = d.split('-'); return day + '/' + m + '/' + y; }
  function fmtDateTime(iso) { try { return new Date(iso).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso; } }
  function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'][m - 1] + ' ' + y;
  }
  function shiftMonth(ym, n) { return C.addMonths(ym + '-01', n).slice(0, 7); }
  function isIncomeCost(c) { return !!(c && c.kind === 'expense' && c.incomeId && cat(c.incomeId)); }
  function incomeSources() { return state.categories.filter(c => c.kind === 'income'); }
  function kindOf(t) { return C.txKind(t, state.categories); }
  /** Beleggingsgegevens (null als er geen zijn of als ze gewist werden). */
  function inv() { return state.investments && !state.investments.cleared ? Invest.view(state.investments) : null; }

  function catBadge(id, suffix) {
    const extra = suffix ? ' ' + esc(suffix) : '';
    if (!id) return `<span class="badge none">Niet gekoppeld${extra}</span>`;
    return `<span class="badge cat-link" data-action="cat-view" data-cat="${esc(id)}" title="Transacties in ${esc(catName(id))}"><span class="dot" style="background:${esc(catColor(id))}"></span>${esc(catLabel(id))}${extra}</span>`;
  }

  const KIND_LABEL = {
    todo: ['none', 'Te verwerken'], income: ['ok', 'Inkomst'], expense: ['', 'Uitgave'], transfer: ['transfer', '↔ Eigen rekening'],
    investment: ['invest', '📈 Belegging'], advance: ['advance', '↗ Voorgeschoten'], repayment: ['advance', '↙ Terugbetaald voorschot'],
    refund: ['refund', '↩ Terugbetaling uitgave'], split: ['split', '✂ Gesplitst']
  };
  function kindBadge(k) { const [cls, label] = KIND_LABEL[k] || ['', k]; return `<span class="badge ${cls}">${label}</span>`; }

  function sourceBadge(t) {
    if (t.source === 'import') {
      const i = imp(t.importId);
      if (i && i.bank === 'bankkoppeling') return `<span class="badge src" title="${esc('Opgehaald via de bankkoppeling op ' + fmtDateTime(i.importedAt))}">🔗 ${esc(String(i.bankName || '').replace(/ \(bankkoppeling\)$/, ''))}</span>`;
      return `<span class="badge src" title="${i ? esc('Opgeladen op ' + fmtDateTime(i.importedAt)) : ''}">📄 ${esc(i ? i.fileName : 'import')}</span>`;
    }
    return '<span class="badge src">✎ Manueel</span>';
  }

  /** Categoriekeuze, gegroepeerd. kind: 'income' | 'expense' | 'budget' | null (alles). */
  function categoryOptions(selected, opts) {
    opts = opts || {};
    const groups = [
      ['income', 'Inkomsten', c => c.kind === 'income'],
      ['expense', 'Uitgaven', c => c.kind === 'expense' && !isIncomeCost(c)],
      ['incomeCost', 'Kosten op inkomsten', c => isIncomeCost(c)],
      ['special', 'Speciaal', c => c.kind === 'advance' || c.kind === 'investment']
    ].filter(([k]) => {
      if (k === 'special') return !!opts.special;
      if (!opts.kind) return true;
      if (opts.kind === 'income') return k === 'income';
      return k === 'expense' || k === 'incomeCost';
    });
    let html = opts.allowEmpty !== false ? `<option value="">${esc(opts.emptyLabel || '— Kies —')}</option>` : '';
    for (const [, label, test] of groups) {
      const list = state.categories.filter(test).sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) continue;
      html += `<optgroup label="${label}">` + list.map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(C.categoryIcon(c) + ' ' + c.name)}${isIncomeCost(c) ? ' (− ' + esc(catName(c.incomeId)) + ')' : ''}</option>`).join('') + '</optgroup>';
    }
    return html;
  }
  function accountOptions(selected, filter) {
    return state.accounts.filter(filter || (() => true)).map(a => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  }
  function amountClass(c) { return c > 0 ? 'pos' : 'neg'; }

  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast');
    el.textContent = msg;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'toast-action'; b.textContent = action.label;
      b.addEventListener('click', () => { el.classList.remove('show'); action.run(); });
      el.appendChild(b);
    }
    el.classList.toggle('has-action', !!action);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 9000 : 3500);
  }

  /** Verwijderen met een knop om het meteen terug te draaien. */
  function deleteWithUndo(ids) {
    const r = Banks.removeTransactions(state, ids);
    ui.selected.clear();
    commit();
    toast(r.count === 1 ? '1 transactie verwijderd' : r.count + ' transacties verwijderd', { label: 'Ongedaan maken', run: () => {
      const n = Banks.restoreDeleted(state, r.ids);
      commit(n === 1 ? '1 transactie teruggezet' : n + ' transacties teruggezet');
    } });
  }

