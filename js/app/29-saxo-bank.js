  // ----- Saxo Bank -----

  const saxoLink = { status: null, error: '', busy: false };
  function saxoAvailable() { return !!(Sync && Sync.mode === 'server' && !demo && !(Sync.features && Sync.features.saxo === false)); }

  async function loadSaxo(opts) {
    if (!saxoAvailable()) return;
    try { saxoLink.status = await Sync.saxo.status(); saxoLink.error = ''; }
    catch (e) { saxoLink.error = e.message; }
    if (ui.view === 'invest' && !modal) render();
    if (opts && opts.auto) {
      const st = saxoLink.status;
      const sub = Invest.brokers(inv()).find(b => b.id === 'saxo');
      const stale = !sub || !sub.syncedAt || Date.now() - Date.parse(sub.syncedAt) > 6 * 3600000;
      if (st && st.connected && !st.expired && (opts.force || stale)) await saxoFetch({ quiet: !opts.force });
    }
  }

  function saxoCard() {
    if (!(Sync && Sync.mode === 'server') || demo) return '';
    if (Sync.features && Sync.features.saxo === false) return '';
    const st = saxoLink.status;
    const sub = Invest.brokers(inv()).find(b => b.id === 'saxo');
    let body;
    if (!st) body = `<p class="small muted">${saxoLink.error ? esc(saxoLink.error) : 'Laden…'}</p>`;
    else if (!st.configured) body = `<p class="small muted">Haal je posities, transacties, dividenden en stortingen rechtstreeks op uit Saxo. Je meldt je aan op de website van Saxo zelf; Helder ziet je wachtwoord nooit en kan geen orders plaatsen.</p>
        <button class="btn primary" data-action="saxo-setup">Saxo-koppeling instellen…</button>`;
    else body = `<p class="small muted">${st.connected && !st.expired ? '✓ Aangemeld bij Saxo' : st.connected ? 'Je Saxo-aanmelding is verlopen (Saxo laat dat maar kort toe). Klik op Vernieuwen en meld je opnieuw aan.' : 'Nog niet aangemeld bij Saxo.'}${st.env === 'sim' ? ' · <strong>simulatie-omgeving</strong>' : ''}${sub ? ' · laatst opgehaald ' + esc(fmtDateTime(sub.syncedAt)) : ''}</p>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn primary" data-action="saxo-fetch" ${saxoLink.busy ? 'disabled' : ''}>${saxoLink.busy ? 'Bezig met ophalen…' : sub ? 'Vernieuwen' : 'Ophalen uit Saxo'}</button>
          ${st.connected ? '<button class="btn" data-action="saxo-disconnect">Loskoppelen</button>' : ''}
          <button class="btn" data-action="saxo-setup">Instelling</button>
        </div>`;
    return `<div class="card" style="margin-top:16px"><h2>Saxo Bank</h2>${body}</div>`;
  }

  function saxoSetupModal() {
    const m = modal;
    const st = saxoLink.status || {};
    const redirect = st.redirectUrl || (location.origin + '/api/saxo/callback');
    return modalShell('Saxo-koppeling instellen', `
      ${st.configured ? `<div class="notice info small">✓ Ingesteld (${st.env === 'sim' ? 'simulatie' : 'echte rekening'}). Vul opnieuw in om te wijzigen.</div>` : ''}
      <p>Helder gebruikt de officiële <strong>Saxo OpenAPI</strong>. Je stelt dit één keer in:</p>
      <div class="notice small">Let op: de ontwikkelaarssite van Saxo werkt <strong>eerst met een apart, gratis test-account</strong> (simulatie), niet met je gewone Saxo-login. Met je gewone login zie je daar meestal niets.</div>
      <ol class="steps">
        <li><strong>Gratis test-account maken:</strong> ga naar <a href="https://www.developer.saxo/accounts/sim/signup" target="_blank" rel="noopener">developer.saxo → simulatie-account aanmaken</a>. Je krijgt per e-mail een <strong>gebruikersnummer</strong> en wachtwoord.</li>
        <li>Meld je met <strong>dat gebruikersnummer</strong> aan op <a href="https://www.developer.saxo" target="_blank" rel="noopener">developer.saxo</a> en open <strong>Application management</strong> (of <em>Apps</em>). Maak een nieuwe app:
          <ul><li>Naam: <em>Helder</em></li>
            <li>Redirect URL: <code>${esc(redirect)}</code> <button class="btn small" data-action="copy" data-copy="${esc(redirect)}">Kopieer</button></li>
            <li>Grant type: <strong>Code</strong> (Authorization Code)</li>
            <li>Trading toelaten: <strong>nee</strong> — Helder leest enkel.</li></ul></li>
        <li>Kopieer de <strong>App Key</strong> en <strong>App Secret</strong>, kies hieronder <strong>Simulatie</strong> en sla op. Test met <em>Ophalen uit Saxo</em> (je meldt je dan aan met je test-account; je ziet verzonnen gegevens).</li>
        <li><strong>Voor je echte rekening:</strong> pas als je een simulatie-app hebt, kan je op dezelfde site een <strong>live</strong>-app aanvragen voor persoonlijk gebruik (je echte rekening moet geld bevatten). Saxo keurt dat meestal automatisch goed. Maak de live-app met dezelfde gegevens, vul hier de nieuwe App Key en Secret in en kies <strong>Echte rekening</strong>.</li>
      </ol>
      <p class="small muted">Lukt de live-aanvraag niet (dat kan per land of per Saxo-dochter verschillen, bv. een rekening bij Saxo Bank België via SaxoInvestor), vraag het dan aan <a href="mailto:openapisupport@saxobank.com">openapisupport@saxobank.com</a>: “Ik wil als particuliere klant een OpenAPI-app voor persoonlijk gebruik op mijn eigen rekening.”</p>
      <form data-form="saxo-setup" class="form-stack" autocomplete="off">
        <label class="field"><span>Omgeving</span><select name="env">
          <option value="sim" ${m.env !== 'live' ? 'selected' : ''}>Simulatie (test-account, om te testen)</option>
          <option value="live" ${m.env === 'live' ? 'selected' : ''}>Echte rekening (live)</option></select></label>
        <label class="field"><span>App Key</span><input type="text" name="appKey" autocapitalize="none" spellcheck="false" required></label>
        <label class="field"><span>App Secret</span><input type="password" name="appSecret" autocomplete="off" required></label>
        <div class="errors">${esc(m.error || '')}</div>
        <button class="btn primary" type="submit" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Opslaan…' : 'Opslaan'}</button>
      </form>
      <p class="small muted">App Key en Secret worden enkel op je Helder-server bewaard (map helder-data, niet via het web bereikbaar) en nooit naar je toestellen gestuurd. Je Saxo-wachtwoord gaat nooit via Helder.</p>`,
      `${st.configured ? '<button class="btn danger" data-action="saxo-remove-config">Instelling verwijderen</button>' : ''}<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>`, true);
  }

  async function saxoSetupSubmit(form) {
    const f = new FormData(form);
    const m = modal;
    m.env = String(f.get('env'));
    m.busy = true; m.error = '';
    renderModal();
    try {
      await Sync.saxo.saveConfig(String(f.get('appKey') || '').trim(), String(f.get('appSecret') || '').trim(), m.env);
      await loadSaxo();
      closeModal();
      toast('Saxo-koppeling ingesteld. Klik op “Ophalen uit Saxo” en meld je aan bij Saxo.');
      render();
    } catch (e) {
      if (modal !== m) return;
      m.busy = false; m.error = e.message; renderModal();
    }
  }

  /** Naar de aanmeldpagina van Saxo; daarna komt je terug in Helder en wordt alles opgehaald. */
  async function saxoLogin() {
    try { const r = await Sync.saxo.connect(); location.href = r.url; }
    catch (e) { toast('Saxo: ' + e.message); }
  }

  async function saxoFetch(opts) {
    if (saxoLink.busy) return;
    const st = saxoLink.status;
    if (st && (!st.connected || st.expired)) { if (!(opts && opts.quiet)) await saxoLogin(); return; }
    saxoLink.busy = true;
    if (ui.view === 'invest' && !modal) render();
    try {
      const data = await Sync.saxo.fetch();
      state.investments = Invest.mergeInvestments(state.investments, data, 'saxo-api', today);
      commit(`Saxo opgehaald: ${data.positions.length} posities, ${data.trades.length} transacties, ${data.movements.length} kasbewegingen`
        + (data.currency && data.currency !== 'EUR' ? ` (bedragen in ${data.currency})` : '')
        + (data.partial ? ' — kasbewegingen konden niet opgehaald worden' : ''));
    } catch (e) {
      if (e.code === 'expired') { await loadSaxo(); if (!(opts && opts.quiet)) await saxoLogin(); }
      else if (!(opts && opts.quiet)) toast('Saxo: ' + e.message);
    } finally {
      saxoLink.busy = false;
      if (ui.view === 'invest' && !modal) render();
    }
  }

