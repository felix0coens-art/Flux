  // ---------- Aanmelden ----------

  function renderSyncBadge() {
    const el = $('#sync-badge');
    if (!el) return;
    const s = ui.sync;
    let text, cls;
    if (ui.admin) { text = '🛡️ Beheerder'; cls = 'ok'; }
    else if (demo) { text = '🧪 Voorbeeld'; cls = 'warn'; }
    else if (s.mode === 'local') { text = 'Lokaal'; cls = 'muted'; }
    else if (s.mode === 'auth') { text = 'Niet aangemeld'; cls = 'warn'; }
    else if (s.status === 'syncing') { text = 'Synchroniseren…'; cls = 'muted'; }
    else if (s.mode === 'offline' || s.status === 'offline') { text = 'Offline' + (s.pending ? ` · ${s.pending} wacht` : ''); cls = 'warn'; }
    else if (s.status === 'error') { text = 'Synchronisatiefout'; cls = 'over'; }
    else { text = s.pending ? `${s.pending} wachten` : '✓ Gesynchroniseerd'; cls = 'ok'; }
    el.className = 'badge sync ' + cls;
    el.textContent = text;
    el.title = s.detail || (s.user ? 'Aangemeld als ' + s.user : '');
    // Afmelden altijd rechtsboven, zodra je aangemeld bent
    const out = $('#topbar-logout');
    if (out) out.hidden = !(ui.admin || (!demo && !ui.auth && s.mode !== 'local' && s.mode !== 'auth'));
  }

  const GOOGLE_ICON = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-16.6z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';

  /**
   * Landingspagina voor wie niet aangemeld is: wat Helder is en doet, met het aanmeldvak er meteen bij.
   * (De eerste installatie met setupcode toont enkel het vak.)
   */
  function renderAuth() {
    const card = renderAuthCard();
    if (ui.auth.setupRequired) return card;
    const g = ui.auth.auth && ui.auth.auth.google;
    const features = [
      ['🏦', 'Al je rekeningen samen', 'Koppel KBC, Argenta, Belfius en andere banken rechtstreeks, of laad hun CSV-bestanden op. Wat al in Helder zit, wordt nooit dubbel geteld.'],
      ['✨', 'Vanzelf ingedeeld', 'Typ een paar letters en druk op Enter. Regels, online opzoeken en (als je wil) AI delen de rest automatisch in.'],
      ['🤝', 'Voorschotten aan vrienden', 'Betaalde je de hele rekening? Zie wie je nog wat schuldig is, koppel terugbetalingen en scheld kwijt wat een cadeau was.'],
      ['📈', 'Beleggingen', 'Degiro en Saxo in één portefeuille, met je echte rendement (TWR en MWR), dividenden en gerealiseerde winst.'],
      ['📊', 'Inkomsten tegenover uitgaven', 'Waar je geld vandaan komt, waar het naartoe gaat en wat er overblijft, per maand en over de jaren.'],
      ['🔒', 'Jouw gegevens blijven van jou', 'Geen reclame, geen verkoop van gegevens. Je bankwachtwoord gaat nooit via Helder en je kan alles downloaden of wissen.']
    ];
    return `<div class="landing">
      <section class="landing-hero">
        <div class="landing-pitch">
          <div class="auth-logo">${LOGO}<span class="wordmark">H€lder</span></div>
          <h1>Je geld, eindelijk <span class="accent">helder</span>.</h1>
          <p class="lead">Een gratis app voor je persoonlijke boekhouding. Al je rekeningen, uitgaven, voorschotten en beleggingen op één plek, zonder spreadsheets.</p>
          <ul class="landing-points">
            <li>✓ Rechtstreeks gekoppeld met je bank, of met CSV-bestanden</li>
            <li>✓ Op je computer en als app op je gsm</li>
            <li>✓ Gemaakt in België, in het Nederlands</li>
          </ul>
          ${g ? '' : '<p class="small muted">Al een account? Meld je aan in het vak hiernaast.</p>'}
        </div>
        <div class="landing-card">${card}</div>
      </section>
      <section class="landing-preview" aria-hidden="true">
        <div class="preview-card">
          <div class="preview-title">Inkomsten tegenover uitgaven <span class="muted">· oktober</span></div>
          <div class="preview-line"><span>Netto inkomsten</span><i class="pv s1" style="width:92%"></i><b>€ 2.480</b></div>
          <div class="preview-line"><span>Uitgaven</span><i class="pv s2" style="width:71%"></i><b>€ 1.915</b></div>
          <div class="preview-result">€ 565 over · 23% van je netto inkomen</div>
          <div class="preview-bars">${[62, 70, 58, 75, 66, 80, 72, 68, 77, 74, 79, 71].map((v, i) => `<span style="height:${v}%"></span><span class="o" style="height:${[48, 52, 50, 55, 47, 60, 51, 49, 58, 53, 56, 52][i]}%"></span>`).join('')}</div>
        </div>
      </section>
      <section class="landing-examples" aria-label="Voorbeelden">
        <h2>Zo ziet het eruit</h2>
        <div class="example-grid">
          <figure class="example">
            <div class="ex-card">
              <div class="ex-tx"><div><strong>COLRUYT GENT</strong><div class="small muted">Bancontact · 12/10</div></div><b>€ -45,20</b></div>
              <div class="ex-input">boo<span class="caret"></span></div>
              <div class="ex-menu"><div class="on">🛒 Boodschappen <span class="small muted">Enter ↵</span></div><div>📚 Boeken &amp; studie</div><div>🎁 Cadeaus</div></div>
            </div>
            <figcaption><strong>Typ en druk op Enter.</strong> Koppelen gaat zo snel als typen, en Helder onthoudt het voor de volgende keer.</figcaption>
          </figure>
          <figure class="example">
            <div class="ex-card">
              <div class="ex-person"><span class="avatar">P</span><strong>Pieter</strong><span class="ex-open">nog € 62,00</span></div>
              <div class="ex-item"><div><strong>Concertticket</strong><div class="small muted">03/10</div></div><b>€ 45,00</b></div>
              <div class="ex-item"><div><strong>Etentje Gent</strong><div class="small muted">09/10</div></div><b>€ 17,00</b></div>
              <div class="ex-buttons"><span>🔗 Met een transactie</span><span>💶 In cash</span><span>🔄 Verrekenen</span></div>
            </div>
            <figcaption><strong>Wie is je nog iets schuldig?</strong> Elk voorschot met een titel, en met één klik afgehandeld.</figcaption>
          </figure>
          <figure class="example">
            <div class="ex-card">
              <div class="ex-donut" style="background:conic-gradient(var(--series-1) 0 38%, var(--series-2) 38% 62%, var(--series-3) 62% 78%, var(--series-4) 78% 90%, var(--border) 90% 100%)"><span>€ 1.915</span></div>
              <ul class="ex-legend"><li><i style="background:var(--series-1)"></i>🏠 Huur &amp; wonen <b>38%</b></li><li><i style="background:var(--series-2)"></i>🛒 Boodschappen <b>24%</b></li><li><i style="background:var(--series-3)"></i>🚗 Vervoer <b>16%</b></li><li><i style="background:var(--series-4)"></i>🍽️ Horeca <b>12%</b></li><li><i style="background:var(--border)"></i>Andere <b>10%</b></li></ul>
            </div>
            <figcaption><strong>Waar gaat je geld naartoe?</strong> Je uitgaven per categorie, per maand of per jaar.</figcaption>
          </figure>
          <figure class="example">
            <div class="ex-card">
              <div class="ex-kpis"><div><div class="small muted">Portefeuille</div><strong>€ 12.480</strong></div><div><div class="small muted">Rendement</div><strong class="pos">+7,2% <span class="small muted">/jaar</span></strong></div></div>
              <svg viewBox="0 0 200 60" class="ex-spark" preserveAspectRatio="none"><polyline points="0,52 20,48 40,50 60,40 80,42 100,33 120,35 140,24 160,27 180,16 200,12" /><polyline class="dep" points="0,54 50,50 100,44 150,40 200,36" /></svg>
              <div class="small muted">Degiro + Saxo · stortingen <span style="color:var(--series-2)">━</span> waarde <span style="color:var(--series-1)">━</span></div>
            </div>
            <figcaption><strong>Je beleggingen erbij.</strong> Degiro en Saxo samen, met je echte rendement en dividenden.</figcaption>
          </figure>
          <figure class="example">
            <div class="ex-card">
              <div class="ex-tx"><div><strong>Takeaway.com</strong><div class="small muted">06/08 · ↩ € 16,00 terug (2×)</div></div><b>€ -8,29</b></div>
              <div class="ex-tx muted-row"><div>COENS VICTOR</div><b class="pos">€ 8,50</b></div>
              <div class="ex-tx muted-row"><div>VAN HOUCKE HELEEN</div><b class="pos">€ 7,50</b></div>
              <div class="ex-buttons"><span>↩ 2 terugbetalingen koppelen</span></div>
            </div>
            <figcaption><strong>Samen besteld, apart betaald?</strong> Koppel terugbetalingen aan de uitgave en zie wat je zelf betaalde.</figcaption>
          </figure>
          <figure class="example">
            <div class="ex-card">
              <div class="ex-bank"><span>🏦</span><div><strong>KBC</strong><div class="small muted">bijgewerkt vandaag 08:12</div></div><span class="ex-ok">✓ gekoppeld</span></div>
              <div class="ex-bank"><span>🏦</span><div><strong>Argenta</strong><div class="small muted">bijgewerkt vandaag 08:12</div></div><span class="ex-ok">✓ gekoppeld</span></div>
              <div class="ex-bank"><span>📄</span><div><strong>Belfius spaarrekening</strong><div class="small muted">CSV opgeladen · 14 transacties</div></div></div>
            </div>
            <figcaption><strong>Alle banken op één plek.</strong> Rechtstreeks gekoppeld of met een bestand, zonder dubbels.</figcaption>
          </figure>
        </div>
      </section>
      <section class="landing-features">
        <h2>Wat Helder voor je doet</h2>
        <div class="feature-grid">${features.map(([i, t, d]) => `<div class="feature"><div class="feature-icon" aria-hidden="true">${i}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>
      </section>
      <section class="landing-steps">
        <h2>In drie stappen</h2>
        <ol>
          <li><strong>Maak een account</strong>${g ? ' met je Google-account, in één klik' : ''}.</li>
          <li><strong>Koppel je bank</strong> of laad je rekeninguittreksels op.</li>
          <li><strong>Koppel je transacties</strong>: Helder onthoudt het en doet het de volgende keer zelf.</li>
        </ol>
        <p><a href="#" class="btn primary" data-action="landing-top">Begin nu, het is gratis</a></p>
      </section>
      <footer class="landing-footer small muted">
        <a href="privacy.html" target="_blank" rel="noopener">Privacyverklaring</a> · <a href="voorwaarden.html" target="_blank" rel="noopener">Gebruiksvoorwaarden</a> · <a href="mailto:privacy@helderfin.be">privacy@helderfin.be</a>
      </footer>
    </div>`;
  }

  function renderAuthCard() {
    const a = ui.auth;
    if (a.setupRequired) {
      return `<div class="auth card"><div class="auth-logo">${LOGO}<span class="wordmark">H€lder</span></div><h1>Account aanmaken</h1>
        <p class="muted">Maak je account aan. ${esc(a.setupHint || 'De setupcode staat in de log van de server.')}</p>
        <form data-form="setup" class="form-stack">
          <label class="field"><span>Setupcode</span><input type="text" name="code" autocomplete="one-time-code" required autocapitalize="characters"></label>
          <label class="field"><span>Gebruikersnaam</span><input type="text" name="username" autocomplete="username" autocapitalize="none" required></label>
          <label class="field"><span>Wachtwoord (min. 8 tekens)</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
          <div class="errors">${esc(a.error || '')}</div><button class="btn primary" type="submit">Account aanmaken</button></form></div>`;
    }
    const g = a.auth && a.auth.google;
    const regOpen = a.auth && a.auth.registration === 'open';
    // De beheerder kan nieuwe accounts per manier aan- of uitzetten
    const canPw = regOpen && a.auth.signupPassword !== false;
    const canG = regOpen && !!g && a.auth.signupGoogle !== false;
    const open = canPw || canG;
    if (a.register && open) {
      return `<div class="auth card"><div class="auth-logo">${LOGO}<span class="wordmark">H€lder</span></div><h1>Account aanmaken</h1>
        ${canG ? `<a class="btn google-btn" href="/api/auth/google">${GOOGLE_ICON}Verder met Google</a>${canPw ? '<div class="or"><span>of met gebruikersnaam en wachtwoord</span></div>' : ''}` : ''}
        ${canPw ? `<form data-form="register" class="form-stack">
          <label class="field"><span>Je naam <span class="muted small">(zoals je die in Helder wil zien)</span></span><input type="text" name="displayName" autocomplete="name" maxlength="60" value="${esc(a.displayName || '')}"></label>
          <label class="field"><span>Gebruikersnaam</span><input type="text" name="username" autocomplete="username" autocapitalize="none" required minlength="2" maxlength="40" pattern="[a-zA-Z0-9._\-]{2,40}" value="${esc(a.previousUser || '')}"></label>
          <label class="field"><span>Wachtwoord (min. 8 tekens)</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
          <label class="field"><span>Herhaal wachtwoord</span><input type="password" name="password2" autocomplete="new-password" minlength="8" required></label>
          <p class="small muted">Onthoud je wachtwoord goed: zonder e-mailadres kan Helder het niet voor je herstellen. Download af en toe een back-up (Instellingen).</p>
          <div class="errors">${esc(a.error || '')}</div><button class="btn primary" type="submit">Account aanmaken</button></form>` : '<p class="small muted">Nieuwe accounts kunnen enkel met een Google-account.</p>'}
        <p class="small legal-links">Al een account? <a href="#" data-action="auth-login">Meld je aan</a></p>
        <p class="small muted legal-links">Door een account aan te maken ga je akkoord met de <a href="voorwaarden.html" target="_blank" rel="noopener">gebruiksvoorwaarden</a> en de <a href="privacy.html" target="_blank" rel="noopener">privacyverklaring</a>.</p></div>`;
    }
    // Kan je enkel met Google een account maken? Dan staat Google centraal en zit aanmelden met
    // gebruikersnaam (voor wie al zo'n account heeft, bv. de beheerder) achter een klein linkje.
    const googleFirst = !!g && !canPw;
    const pwForm = `<form data-form="login" class="form-stack">
        <label class="field"><span>Gebruikersnaam</span><input type="text" name="username" autocomplete="username" autocapitalize="none" value="${esc(a.previousUser || '')}" required></label>
        <label class="field"><span>Wachtwoord</span><input type="password" name="password" autocomplete="current-password" required></label>
        <div class="errors">${esc(a.error || '')}</div><button class="btn ${googleFirst ? '' : 'primary'}" type="submit">Aanmelden</button></form>`;
    const showPw = !googleFirst || a.showPw || !!a.error || (a.previousUser && !/^g_/.test(a.previousUser));
    const signupLine = canG && !canPw ? '<p class="small muted legal-links">Nog geen account? Klik gewoon op <strong>Aanmelden met Google</strong>: je account wordt dan meteen aangemaakt.</p>'
      : open ? '<p class="small legal-links">Nog geen account? <a href="#" data-action="auth-register"><strong>Maak er een aan</strong></a></p>'
      : a.auth && a.auth.registration ? '<p class="small muted legal-links">Nieuwe accounts zijn momenteel gesloten.</p>' : '';
    return `<div class="auth card"><div class="auth-logo">${LOGO}<span class="wordmark">H€lder</span></div>
      <p class="muted">${a.expired ? 'Je sessie is verlopen. Meld je opnieuw aan.' : 'Meld je aan.'}</p>
      ${g ? `<a class="btn google-btn" href="/api/auth/google">${GOOGLE_ICON}Aanmelden met Google</a>` : ''}
      ${googleFirst
        ? (showPw ? `<div class="or"><span>of met gebruikersnaam</span></div>${pwForm}` : '<p class="small legal-links"><a href="#" data-action="auth-show-pw">Aanmelden met gebruikersnaam en wachtwoord</a></p>')
        : `${g ? '<div class="or"><span>of met gebruikersnaam</span></div>' : ''}${pwForm}`}
      ${signupLine}
      <p class="small muted legal-links">${g ? 'Door aan te melden ga je akkoord met de ' : ''}<a href="voorwaarden.html" target="_blank" rel="noopener">${g ? 'gebruiksvoorwaarden' : 'Gebruiksvoorwaarden'}</a>${g ? ' en de ' : ' · '}<a href="privacy.html" target="_blank" rel="noopener">${g ? 'privacyverklaring' : 'Privacyverklaring'}</a>.</p></div>`;
  }

