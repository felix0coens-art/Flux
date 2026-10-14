  // ----- Gemeenschappelijke startdatum -----

  /**
   * Datumvelden: Chrome meldt al een wijziging bij elk cijfer van het jaartal (2 → 0002, 20 → 0020 …).
   * Pas bewaren als de datum volledig en geloofwaardig is, na een korte pauze of bij het verlaten van het veld;
   * anders tekent Helder het veld opnieuw terwijl je nog typt.
   */
  let dateTimer = null;
  function dateWhenDone(el, apply) {
    if (dateTimer) clearTimeout(dateTimer.id);
    const run = () => {
      if (!dateTimer || dateTimer.el !== el) return;
      clearTimeout(dateTimer.id);
      dateTimer = null;
      // Werd het veld intussen opnieuw getekend? Dan staat de getypte waarde in het nieuwe veld
      const cur = el.isConnected ? el : (el.id && document.getElementById(el.id)) || el;
      const v = cur.value;
      const y = Number(v.slice(0, 4));
      if (v && (y < 1990 || y > Number(today.slice(0, 4)) + 1)) return; // nog aan het typen
      apply(v);
    };
    dateTimer = { el, run, id: setTimeout(run, 1500) };
  }

  function setDataFrom(value, quiet) {
    const v = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
    state.settings = Object.assign({}, state.settings, { dataFrom: v });
    commit(quiet ? null : v ? 'Startdatum ' + fmtDate(v) + ' voor alle banken' : 'Startdatum verwijderd');
  }

  function dataFromRow() {
    const from = state.settings.dataFrom || '';
    const starts = Banks.accountStarts(state);
    const list = Object.entries(starts).filter(([id]) => acc(id) && acc(id).type !== 'cash').map(([id, d]) => ({ id, d })).sort((a, b) => a.d.localeCompare(b.d));
    const older = from ? state.transactions.filter(t => t.source === 'import' && t.date < from).length : 0;
    const spread = list.length > 1 && C.daysBetween(list[0].d, list[list.length - 1].d) > 31;
    const suggestion = list.length ? list[list.length - 1].d.slice(0, 8) + '01' : '';
    return `<div class="card data-from">
      <h2>📅 Startdatum van je gegevens</h2>
      <div class="data-from-head"><label>Gegevens vanaf <input type="date" id="data-from" value="${esc(from)}" max="${today}"></label></div>
      <p class="small muted">Geldt voor al je banken: bankbestanden en de bankkoppeling slaan transacties van vóór deze datum over. Zo lopen je rekeningen gelijk. Leeg = alles.</p>
      ${older ? `<div class="notice small">Er zitten nog ${older} transacties van vóór ${fmtDate(from)} in Helder. <button class="btn small" data-action="trim-before">Die weghalen</button></div>` : ''}
      ${!from && spread ? `<div class="notice small">Je rekeningen beginnen niet op dezelfde datum: ${list.map(x => `${esc(accName(x.id))} vanaf ${fmtDate(x.d)}`).join(', ')}.
        <button class="btn small" data-action="align-start" data-date="${esc(suggestion)}">Allemaal vanaf ${fmtDate(suggestion)}</button></div>` : ''}
    </div>`;
  }

