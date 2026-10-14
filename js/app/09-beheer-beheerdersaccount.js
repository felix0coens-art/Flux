  // ----- Beheer (beheerdersaccount) -----

  async function loadAdmin() {
    try { ui.admin.data = await Sync.admin.overview(); ui.admin.error = ''; }
    catch (e) { ui.admin.error = e.message; }
    if (ui.admin && !modal) render();
  }

  function shortUa(ua) {
    ua = String(ua || '');
    const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return [dev, br].filter(Boolean).join(' · ') || ua.slice(0, 30) || '—';
  }

  function renderAdmin() {
    const a = ui.admin;
    const d = a.data;
    const head = `<div class="page-head"><h1>🛡️ Beheer</h1><span class="spacer"></span><span class="small muted">Aangemeld als ${esc(a.me.displayName || a.me.user)}</span>
      <button class="btn small" data-action="admin-refresh">Vernieuwen</button></div>`;
    if (!d) return head + `<p class="muted">${a.error ? esc(a.error) : 'Laden…'}</p>`;
    const now = Date.now();
    const day = 86400000;
    const active30 = d.users.filter(u => u.lastLogin && now - Date.parse(u.lastLogin) < 30 * day).length;
    const loginsToday = d.logins.filter(l => l.ok && l.at.slice(0, 10) === today).length;
    const failed24 = d.logins.filter(l => !l.ok && now - Date.parse(l.at) < day).length;
    const kind = u => u.role === 'admin' ? '🛡️ beheerder' : u.role === 'owner' ? '🔑 eigenaar' : u.email ? 'Google' : '👤 gebruikersnaam';
    const size = b => b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB';
    const open = d.site.registration === 'open';
    return head + `
      <p class="muted">Hier zie je wie Helder gebruikt en wanneer er aangemeld werd. De financiële gegevens van gebruikers zie je hier bewust niet.</p>
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Gebruikers</div><div class="value">${d.users.filter(u => u.role !== 'admin').length}</div><div class="hint">${d.users.filter(u => u.email).length} via Google</div></div>
        <div class="card kpi"><div class="label">Actief (30 dagen)</div><div class="value">${active30}</div></div>
        <div class="card kpi"><div class="label">Aanmeldingen vandaag</div><div class="value">${loginsToday}</div></div>
        <div class="card kpi"><div class="label">Mislukt (24 uur)</div><div class="value ${failed24 ? 'negv' : ''}">${failed24}</div></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <h2>Nieuwe accounts</h2>
        <div class="reg-state">
          <span class="badge ${open ? 'ok' : 'over'} reg-badge">${open ? '● Open' : '● Gesloten'}</span>
          <span class="grow">${open ? 'Nieuwe mensen kunnen een account aanmaken, op de manieren die hieronder aan staan.' : 'Enkel bestaande gebruikers kunnen aanmelden. Nieuwe mensen krijgen de melding dat registratie gesloten is.'}</span>
          <button class="btn ${open ? '' : 'primary'}" data-action="admin-reg" data-open="${open ? '0' : '1'}">${open ? 'Nieuwe accounts sluiten' : 'Nieuwe accounts toelaten'}</button>
        </div>
        ${[['signupPassword', '👤 Met gebruikersnaam en wachtwoord', true], ['signupGoogle', 'Met Google', d.google]].map(([key, label, avail]) => {
          const on = d.site[key] !== false;
          return `<div class="reg-state reg-method">
            <span class="badge ${on && avail ? 'ok' : 'over'} reg-badge">${on ? '● Aan' : '● Uit'}</span>
            <span class="grow"><strong>${label}</strong><div class="small muted">${!avail ? 'Google staat niet ingesteld op deze server.' : on ? (open ? 'Nieuwe mensen kunnen zo een account aanmaken.' : 'Aan, maar nieuwe accounts zijn nu gesloten.') : 'Nieuwe accounts op deze manier kunnen niet. Bestaande gebruikers kunnen gewoon aanmelden.'}</div></span>
            <button class="btn small" data-action="admin-signup" data-key="${key}" data-on="${on ? '0' : '1'}">${on ? 'Uitzetten' : 'Aanzetten'}</button>
          </div>`;
        }).join('')}
        ${d.google ? `<p class="small muted">Redirect URI in Google Cloud: <code>${esc(d.googleRedirect)}</code></p>`
          : `<p class="small muted" style="margin-top:10px">Aanmelden met Google staat niet aan (optioneel): zet daarvoor <code>HELDER_GOOGLE_CLIENT_ID</code> en <code>HELDER_GOOGLE_CLIENT_SECRET</code> als secrets in GitHub. Redirect URI: <code>${esc(d.googleRedirect)}</code></p>`}
      </div>
      <div class="card" style="margin-bottom:16px"><h2>Gebruikers</h2>
        <div class="table-wrap"><table><thead><tr><th>Gebruiker</th><th>Soort</th><th>Aangemaakt</th><th>Laatst aangemeld</th><th class="right">Aanmeldingen</th><th class="right">Transacties</th><th class="right">Opslag</th><th>AI</th><th></th></tr></thead>
        <tbody>${d.users.map(u => `<tr class="${u.disabled ? 'is-disabled' : ''}">
          <td><strong>${esc(u.displayName)}</strong><div class="small muted">${esc(u.email || u.user)}</div></td>
          <td class="small">${kind(u)}${u.disabled ? ' <span class="badge over">geblokkeerd</span>' : ''}</td>
          <td class="small nowrap">${u.created ? esc(fmtDateTime(u.created)) : '—'}</td>
          <td class="small nowrap">${u.lastLogin ? esc(fmtDateTime(u.lastLogin)) : 'nooit'}</td>
          <td class="right">${u.logins}</td>
          <td class="right">${u.transactions == null ? '—' : u.transactions}</td>
          <td class="right small">${u.dataSize ? size(u.dataSize) : '—'}</td>
          <td class="small">${u.role === 'member' ? `${u.ownAi ? '<div>✓ eigen sleutel</div>' : ''}<label title="AI op kosten van de sleutel van deze server"><input type="checkbox" data-admin-ai="${esc(u.user)}" ${u.ai ? 'checked' : ''}> jouw sleutel</label>` : u.role === 'owner' ? 'ja' : '—'}</td>
          <td class="nowrap right">${u.role === 'member' ? `<button class="btn small" data-action="admin-user" data-user="${esc(u.user)}" data-op="${u.disabled ? 'enable' : 'disable'}">${u.disabled ? 'Deblokkeren' : 'Blokkeren'}</button>
            <button class="btn small danger" data-action="admin-user" data-user="${esc(u.user)}" data-op="delete">Verwijderen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted"><strong>AI:</strong> gebruikers kunnen in Instellingen hun eigen Anthropic API-sleutel invullen; dan betalen ze zelf. Vink “jouw sleutel” enkel aan als iemand AI mag gebruiken op jouw kosten (de sleutel van deze server).</p></div>
      <div class="card" style="margin-bottom:16px"><h2>Bankkoppeling</h2>
        <div class="reg-state">
          <span class="badge ${d.site.bankShared ? 'ok' : 'muted'} reg-badge">${d.site.bankShared ? '● Gedeeld' : '● Eigen app'}</span>
          <span class="grow">${d.site.bankShared ? 'Alle gebruikers gebruiken de Enable Banking-app van de eigenaar (enkel toegelaten met een contract bij Enable Banking). Wie een eigen app instelt, gebruikt die.' : 'Elke gebruiker stelt zijn eigen, gratis Enable Banking-app in (Bank → Bankkoppeling instellen). Zo’n app werkt enkel voor de eigen rekeningen van die gebruiker; dat is hoe Enable Banking het gratis toelaat. Saxo werkt op dezelfde manier met een eigen Saxo-app.'}</span>
          <button class="btn small" data-action="admin-bank-shared" data-on="${d.site.bankShared ? '0' : '1'}">${d.site.bankShared ? 'Niet meer delen' : 'App van de eigenaar delen'}</button>
        </div></div>
      <div class="card"><h2>Laatste aanmeldingen</h2>
        <div class="table-wrap"><table><thead><tr><th>Wanneer</th><th>Gebruiker</th><th>Hoe</th><th>Resultaat</th><th>IP-adres</th><th>Toestel</th></tr></thead>
        <tbody>${d.logins.slice(0, 150).map(l => { const u = d.users.find(x => x.user === l.user); return `<tr>
          <td class="small nowrap">${esc(fmtDateTime(l.at))}</td><td>${esc(u ? u.displayName : l.user)}${u && u.email ? `<div class="small muted">${esc(u.email)}</div>` : ''}</td>
          <td class="small">${esc(l.method)}</td><td class="small">${l.ok ? '<span class="pos">✓ gelukt</span>' : '<span class="negv">✗ ' + esc(l.detail || 'mislukt') + '</span>'}${l.ok && l.detail ? ' <span class="muted">(' + esc(l.detail) + ')</span>' : ''}</td>
          <td class="small">${esc(l.ip)}</td><td class="small">${esc(shortUa(l.ua))}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">Nog geen aanmeldingen.</td></tr>'}</tbody></table></div></div>`;
  }

