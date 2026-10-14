  // ----- Gedeelde boekhouding (huishouden) -----

  const houseUi = { status: null, error: '', code: null, busy: false };
  async function loadHouse() {
    try { houseUi.status = await Sync.household.status(); houseUi.error = ''; } catch (e) { houseUi.error = e.message; }
    if (ui.view === 'settings' && !modal) render();
  }

  function householdBlock() {
    if (!(Sync && Sync.mode === 'server') || demo) return '';
    const h = houseUi.status;
    if (!h) { if (!houseUi.error) setTimeout(loadHouse, 0); return `<div class="section household"><h3>👪 Gedeelde boekhouding</h3><p class="small muted">${esc(houseUi.error || 'Laden…')}</p></div>`; }
    const invite = houseUi.code ? `<div class="notice small">Geef deze code aan wie mee wil werken (7 dagen geldig, één keer te gebruiken):
        <div class="invite-code">${esc(houseUi.code)} <button class="btn small" data-action="copy" data-copy="${esc(houseUi.code)}">Kopieer</button></div>
        Die persoon maakt een eigen Helder-account, gaat naar Instellingen → Account en vult de code in.</div>` : '';
    if (h.role === 'member') {
      return `<div class="section household"><h3>👪 Gedeelde boekhouding</h3>
        <p class="small">Je werkt in de boekhouding van <strong>${esc(h.owner.name)}</strong>${h.members.length > 1 ? ', samen met ' + h.members.filter(m => m.user !== (Sync.account && Sync.account.user)).map(m => esc(m.name)).join(', ') : ''}. Alles wat jullie toevoegen of aanpassen, zien jullie allebei.</p>
        <p class="small muted">Je eigen, vroegere gegevens zijn bewaard en komen terug als je het huishouden verlaat. Je bankkoppelingen en sleutels blijven van jou.</p>
        <button class="btn small danger" data-action="house-leave" ${houseUi.busy ? 'disabled' : ''}>Huishouden verlaten</button></div>`;
    }
    return `<div class="section household"><h3>👪 Gedeelde boekhouding</h3>
      <p class="small muted">Werk samen met je partner of huisgenoot in één boekhouding. Ieder meldt zich aan met een eigen account; jullie zien dezelfde transacties, categorieën, voorschotten en bonnetjes.</p>
      ${h.members.length ? `<div class="list">${h.members.map(m => `<div class="list-row"><div class="grow">👤 ${esc(m.name)}<div class="small muted">werkt mee in jouw boekhouding</div></div><button class="btn small ghost danger" data-action="house-remove" data-user="${esc(m.user)}">Verwijderen</button></div>`).join('')}</div>` : ''}
      ${invite}
      <p class="btn-row"><button class="btn small" data-action="house-invite" ${houseUi.busy ? 'disabled' : ''}>+ Iemand uitnodigen</button></p>
      ${h.members.length ? '' : `<details class="small"><summary>Ik kreeg een code van iemand anders</summary>
        <form data-form="house-join" class="input-row" style="margin-top:8px"><input type="text" name="code" placeholder="bv. ABCD-EF23" autocapitalize="characters" autocomplete="off" required><button class="btn primary" type="submit" ${houseUi.busy ? 'disabled' : ''}>Deelnemen</button></form>
        <p class="small muted">Je werkt daarna in de boekhouding van wie je uitnodigde. Je eigen gegevens worden niet gewist: ze komen terug als je het huishouden verlaat.</p></details>`}
      ${houseUi.error ? `<div class="errors">${esc(houseUi.error)}</div>` : ''}
    </div>`;
  }

