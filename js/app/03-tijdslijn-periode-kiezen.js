  // ---------- Tijdslijn: periode kiezen ----------

  const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  function shortMonth(ym) { return MONTHS_SHORT[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4); }

  /** Alle maanden van de tijdslijn: van de eerste transactie (minstens 12 maanden terug) tot nu. */
  function timelineMonths() {
    let first = shiftMonth(today.slice(0, 7), -11), last = today.slice(0, 7);
    for (const t of state.transactions) { const m = t.date.slice(0, 7); if (m < first) first = m; if (m > last) last = m; }
    const out = [];
    for (let m = first; m <= last; m = shiftMonth(m, 1)) out.push(m);
    return out;
  }
  function currentRange() {
    const r = ui.range;
    return { start: r.from + '-01', end: C.periodRange('monthly', r.to + '-01').end };
  }
  function rangeLabel(r) {
    r = r || ui.range;
    if (r.from === r.to) return esc(monthLabel(r.from));
    if (r.from.slice(5) === '01' && r.to.slice(5) === '12' && r.from.slice(0, 4) === r.to.slice(0, 4)) return 'Heel ' + r.from.slice(0, 4);
    const n = (Number(r.to.slice(0, 4)) - Number(r.from.slice(0, 4))) * 12 + Number(r.to.slice(5)) - Number(r.from.slice(5)) + 1;
    return `${shortMonth(r.from)} – ${shortMonth(r.to)} <span class="muted">(${n} maanden)</span>`;
  }
  function presetRange(key, months) {
    const cur = today.slice(0, 7), y = Number(today.slice(0, 4));
    const map = {
      month: [cur, cur], prev: [shiftMonth(cur, -1), shiftMonth(cur, -1)], q: [shiftMonth(cur, -2), cur],
      ytd: [y + '-01', cur], lastyear: [(y - 1) + '-01', (y - 1) + '-12'], m12: [shiftMonth(cur, -11), cur], all: [months[0], months[months.length - 1]]
    };
    const [from, to] = map[key];
    return { from: from < months[0] ? months[0] : from, to };
  }

  /** Schuifbalk op een tijdslijn: sleep de twee handvatten om de periode te kiezen. */
  function timeline() {
    const months = timelineMonths();
    let i0 = months.indexOf(ui.range.from), i1 = months.indexOf(ui.range.to);
    if (i0 < 0) i0 = 0;
    if (i1 < i0) i1 = months.length - 1;
    const lines = C.allocations(state);
    const act = months.map(m => C.summarize(state, C.periodRange('monthly', m + '-01'), lines).expenses);
    const max = Math.max(1, ...act);
    const n = months.length;
    const presets = [['month', 'Deze maand'], ['prev', 'Vorige maand'], ['q', '3 maanden'], ['ytd', 'Dit jaar'], ['lastyear', 'Vorig jaar'], ['m12', '12 maanden'], ['all', 'Alles']];
    const activePreset = (presets.find(([k]) => { const r = presetRange(k, months); return r.from === ui.range.from && r.to === ui.range.to; }) || [])[0];
    return `<div class="card timeline" data-months="${esc(months.join(','))}">
      <div class="tl-head"><strong id="tl-label">${rangeLabel()}</strong><span class="spacer"></span>
        <div class="seg tl-presets">${presets.map(([k, l]) => `<button class="${activePreset === k ? 'active' : ''}" data-action="range-preset" data-preset="${k}">${l}</button>`).join('')}</div></div>
      <div class="tl-track"><div class="tl-inner">
        <div class="tl-bars">${months.map((m, i) => `<span class="${i >= i0 && i <= i1 ? 'in' : ''}" style="height:${Math.max(4, act[i] / max * 100).toFixed(0)}%" title="${esc(shortMonth(m))}: uitgaven ${esc(money(act[i]))}"></span>`).join('')}</div>
        <div class="tl-sel" style="left:${(i0 / n * 100).toFixed(2)}%;width:${((i1 - i0 + 1) / n * 100).toFixed(2)}%"></div></div>
        <input type="range" class="tl-range" data-tl="from" min="0" max="${n - 1}" step="1" value="${i0}" aria-label="Begin van de periode">
        <input type="range" class="tl-range" data-tl="to" min="0" max="${n - 1}" step="1" value="${i1}" aria-label="Einde van de periode">
      </div>
      <div class="tl-months">${months.map((m, i) => {
        // Elke maand een label: voluit als er plaats is, anders de beginletter (bij veel maanden enkel per kwartaal)
        const mm = Number(m.slice(5));
        const txt = n <= 18 ? MONTHS_SHORT[mm - 1] : n <= 40 ? MONTHS_SHORT[mm - 1].slice(0, 1).toUpperCase() : (mm % 3 === 1 ? MONTHS_SHORT[mm - 1].slice(0, 1).toUpperCase() : '');
        return `<span class="${i >= i0 && i <= i1 ? 'in' : ''}">${txt}</span>`;
      }).join('')}</div>
      <div class="tl-axis">${months.map((m, i) => m.slice(5) === '01' || i === 0 ? `<span style="left:${(i / n * 100).toFixed(2)}%">${m.slice(0, 4)}</span>` : '').join('')}</div>
      <p class="small muted tl-hint">Sleep de twee bolletjes om het begin en het einde van de periode te kiezen. De balkjes tonen je uitgaven per maand.</p>
    </div>`;
  }

  /** Tijdens het slepen: label en selectie meteen bijwerken (zonder alles opnieuw te tekenen). */
  function onTimelineInput(el) {
    const tl = el.closest('.timeline');
    const months = tl.dataset.months.split(',');
    const from = $('[data-tl=from]', tl), to = $('[data-tl=to]', tl);
    let a = Number(from.value), b = Number(to.value);
    if (a > b) { if (el === from) { b = a; to.value = b; } else { a = b; from.value = a; } }
    ui.range = { from: months[a], to: months[b] };
    $('#tl-label', tl).innerHTML = rangeLabel();
    const sel = $('.tl-sel', tl);
    sel.style.left = (a / months.length * 100).toFixed(2) + '%';
    sel.style.width = ((b - a + 1) / months.length * 100).toFixed(2) + '%';
    $$('.tl-bars span', tl).forEach((sp, i) => sp.classList.toggle('in', i >= a && i <= b));
    $$('.tl-months span', tl).forEach((sp, i) => sp.classList.toggle('in', i >= a && i <= b));
  }

