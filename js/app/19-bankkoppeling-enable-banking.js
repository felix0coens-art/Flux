  // ----- Bankkoppeling (Enable Banking) -----

  try { ui.settingsTab = localStorage.getItem('flux-settings-tab') || ''; } catch (e) { /* niet erg */ }
  const bankLink = { status: null, error: '', busy: {}, errors: {}, awaiting: false };
  const LINK_REFRESH_MS = 6 * 3600000;
  const POPULAR_BANKS = /^(kbc|cbc|kbc brussels|argenta|belfius|bnp paribas fortis|ing|crelan|keytrade)/i;

  function bankLinkAvailable() { return !!(Sync && Sync.mode === 'server' && !demo && !(Sync.features && Sync.features.bank === false)); }
  function daysLeft(iso) { return iso ? Math.ceil((Date.parse(iso) - Date.now()) / 86400000) : null; }

  async function loadBankLink(opts) {
    if (!bankLinkAvailable()) return;
    try { bankLink.status = await Sync.bank.status(); bankLink.error = ''; }
    catch (e) { bankLink.error = e.message; }
    if (ui.view === 'bank' && !modal) render();
    if (opts && opts.auto) await autoFetchLinked();
  }

  function linkedAccount(a) {
    return state.accounts.find(x => x.ebUid === a.uid) || (a.iban ? state.accounts.find(x => x.iban && C.normalizeIban(x.iban) === C.normalizeIban(a.iban)) : null);
  }

  function ensureLinkedAccount(conn, a) {
    let acct = linkedAccount(a);
    if (!acct) {
      const bank = /kbc|cbc/i.test(conn.aspsp) ? 'kbc' : /argenta/i.test(conn.aspsp) ? 'argenta' : /belfius/i.test(conn.aspsp) ? 'belfius' : undefined;
      acct = { id: C.uid('acc'), name: (conn.aspsp + ' ' + (a.name || (a.iban ? '…' + a.iban.slice(-4) : ''))).trim(), iban: a.iban || '', type: 'zicht', bank };
      state.accounts.push(acct);
    }
    acct.ebUid = a.uid;
    return acct;
  }

  /** Haalt nieuwe transacties en het saldo op voor alle rekeningen van één bankkoppeling. */
  async function fetchLinked(conn, opts) {
    opts = opts || {};
    if (!bankLinkAvailable() || bankLink.busy[conn.id]) return;
    bankLink.busy[conn.id] = true;
    bankLink.errors[conn.id] = '';
    if (ui.view === 'bank' && !modal) render();
    let added = 0, changed = false;
    const notes = [];
    try {
      for (const a of conn.accounts) {
        const acct = ensureLinkedAccount(conn, a);
        changed = true;
        const linkedDates = state.transactions.filter(t => t.accountId === acct.id && t.importId && (imp(t.importId) || {}).bank === 'bankkoppeling').map(t => t.date).sort();
        let from = linkedDates.length ? C.addDays(linkedDates[linkedDates.length - 1], -10) : C.addDays(today, -730);
        if (state.settings.dataFrom && from < state.settings.dataFrom) from = state.settings.dataFrom;
        const r = await Sync.bank.fetch(conn.id, a.uid, from);
        if (demo) return;
        const rows = (r.transactions || []).map(Banks.fromEnableBanking).filter(Boolean);
        const planned = Banks.planLinked(state, acct.id, rows);
        Banks.applyLinked(state, acct.id, planned, { bankName: conn.aspsp, balance: Banks.balanceFromEnableBanking(r.balances, today) });
        acct.ebFetchedAt = new Date().toISOString();
        added += planned.fresh.length;
        if (r.limited) notes.push('de bank gaf enkel de laatste 90 dagen');
      }
    } catch (e) {
      bankLink.errors[conn.id] = e.code === 'expired' ? 'De toestemming is verlopen. Geef opnieuw toestemming.' : e.message;
      if (!opts.quiet) toast(conn.aspsp + ': ' + bankLink.errors[conn.id]);
    } finally {
      bankLink.busy[conn.id] = false;
    }
    const msg = added ? `${conn.aspsp}: ${added} nieuwe transacties opgehaald${notes.length ? ' (' + notes[0] + ')' : ''}` : (opts.quiet || bankLink.errors[conn.id] ? null : `${conn.aspsp}: geen nieuwe transacties`);
    if (changed) commit(msg); else if (ui.view === 'bank' && !modal) render();
  }

  /** Bij het openen van Helder: rekeningen ophalen die langer dan 6 uur niet bijgewerkt werden. */
  async function autoFetchLinked() {
    const st = bankLink.status;
    if (!st || !st.configured) return;
    for (const conn of st.connections) {
      if (daysLeft(conn.validUntil) !== null && daysLeft(conn.validUntil) <= 0) continue;
      const stale = conn.accounts.some(a => { const x = linkedAccount(a); return !x || !x.ebFetchedAt || Date.now() - Date.parse(x.ebFetchedAt) > LINK_REFRESH_MS; });
      if (stale) await fetchLinked(conn, { quiet: true });
    }
  }

  function bankLinkCard() {
    if (demo) return '';
    const head = extra => `<div class="link-head"><h2>🔗 Bankkoppeling</h2><span class="spacer"></span>${extra || ''}</div>`;
    if (!Sync || Sync.mode !== 'server') {
      return `<div class="card link-card">${head()}<p class="small muted">Transacties automatisch ophalen bij KBC, Argenta en andere banken werkt via je Helder-server (bv. helderfin.be)${Sync && Sync.mode === 'offline' ? '. Je bent nu offline.' : '.'}</p></div>`;
    }
    if (Sync.features && Sync.features.bank === false) return '';
    const st = bankLink.status;
    if (!st) return `<div class="card link-card">${head()}<p class="small muted">${bankLink.error ? esc(bankLink.error) : 'Laden…'}</p></div>`;
    if (!st.configured) {
      return `<div class="card link-card">${head()}
        <p>Laat Helder je transacties rechtstreeks bij je bank ophalen, zonder CSV-bestanden. Dit loopt via <strong>Enable Banking</strong>, een erkende dienst onder de Europese PSD2-regels: je meldt je aan bij je eigen bank, Helder krijgt enkel <strong>leestoegang</strong>.</p>
        <button class="btn primary" data-action="bank-setup">Bankkoppeling instellen</button></div>`;
    }
    const conns = st.connections.map(conn => {
      const left = daysLeft(conn.validUntil);
      const expired = left !== null && left <= 0;
      const err = bankLink.errors[conn.id];
      const statusText = bankLink.busy[conn.id] ? '<span class="badge">Bezig met ophalen…</span>'
        : expired || /verlopen/.test(err || '') ? '<span class="badge over">Toestemming verlopen</span>'
        : left !== null && left <= 14 ? `<span class="badge warn">Nog ${left} dagen toestemming</span>`
        : left !== null ? `<span class="badge ok">Toestemming nog ${left} dagen</span>` : '';
      const accs = conn.accounts.map(a => {
        const x = linkedAccount(a);
        return `<li><strong>${esc(a.iban ? C.formatIban(a.iban) : a.name || a.uid)}</strong>${a.name ? ` <span class="muted">${esc(a.name)}</span>` : ''}
          <div class="small muted">→ ${x ? esc(x.name) + (x.ebFetchedAt ? ' · bijgewerkt ' + esc(fmtDateTime(x.ebFetchedAt)) : ' · nog niet opgehaald') : 'nieuwe rekening in Helder bij het eerste ophalen'}</div></li>`;
      }).join('');
      return `<div class="link-conn">
        <div class="link-conn-head"><strong>${esc(conn.aspsp)}</strong> ${statusText}<span class="spacer"></span>
          <button class="btn small primary" data-action="bank-fetch" data-id="${esc(conn.id)}" ${bankLink.busy[conn.id] || expired ? 'disabled' : ''}>↻ Vernieuwen</button>
          ${expired || (left !== null && left <= 30) || err ? `<button class="btn small" data-action="bank-renew" data-id="${esc(conn.id)}">Opnieuw toestemming geven</button>` : ''}
          <button class="btn small ghost danger" data-action="bank-disconnect" data-id="${esc(conn.id)}">Verbreken</button></div>
        ${err ? `<div class="notice small">${esc(err)}</div>` : ''}
        <ul class="link-accounts">${accs || '<li class="muted">Geen rekeningen gedeeld.</li>'}</ul></div>`;
    }).join('');
    return `<div class="card link-card">${head(`<button class="btn small" data-action="bank-connect">+ Bank koppelen</button><button class="btn small ghost" data-action="bank-setup">Instellingen</button>`)}
      ${conns || '<p class="muted">Nog geen bank gekoppeld. Klik op <strong>+ Bank koppelen</strong> en kies KBC, Argenta, …</p>'}
      <p class="small muted">Helder haalt vanzelf nieuwe transacties op telkens je de app opent (hoogstens om de 6 uur). Wil je meteen bijwerken, klik dan op ↻ Vernieuwen. Wat al in Helder zat, wordt overgeslagen.</p>
      <details class="small"><summary><strong>Je spaarrekening staat er niet bij?</strong></summary>
        <p>De bankkoppeling (PSD2) is wettelijk enkel verplicht voor <em>betaalrekeningen</em>. Veel banken, zoals Belfius, geven spaarrekeningen daarom niet door, ook al duid je ze aan. Dat ligt niet aan Helder en is niet op te lossen met een andere instelling.</p>
        <p>Oplossing: download in je bank-app of op de website van je bank de transacties van je spaarrekening als <strong>CSV</strong> en laad ze op met <strong>Bankbestand opladen</strong>. Bij Belfius: open de spaarrekening → <em>Rekeninginfo / Verrichtingen</em> → <em>Exporteren</em> → <strong>CSV</strong>. Helder herkent het bestand en maakt de spaarrekening zelf aan. Je hoeft dat maar af en toe te doen; rente en stortingen veranderen weinig.</p>
      </details></div>`;
  }

  function bankSetupModal() {
    const m = modal;
    const st = bankLink.status || {};
    return modalShell('Bankkoppeling instellen', `
      ${st.shared ? `<div class="notice info small">✓ Je gebruikt de bankapp van deze Helder (gedeeld door de beheerder). Je hoeft niets in te stellen; wil je toch je eigen app gebruiken, vul ze dan hieronder in.</div>`
        : st.configured ? `<div class="notice info small">✓ Ingesteld met app <strong>${esc(st.appName || st.appId)}</strong> (${esc(st.appId)}).</div>` : ''}
      <p>Helder gebruikt <strong>Enable Banking</strong> om je rekeningen bij KBC, CBC, Argenta en andere banken te lezen. Je stelt dit één keer in:</p>
      <ol class="steps">
        <li>Maak een account op <a href="https://enablebanking.com" target="_blank" rel="noopener">enablebanking.com</a> en open het <strong>Control Panel</strong>.</li>
        <li>Ga naar <strong>API applications</strong> en vul het formulier zo in:
          <ul class="eb-form">
            <li><strong>1.</strong> Environment: <strong>Production</strong></li>
            <li><strong>2.</strong> Kies <strong>Generate in the browser (using SubtleCrypto) and export private key</strong></li>
            <li><strong>3.</strong> De vakjes, van boven naar onder:
              <table class="mini eb-fields"><tbody>
                ${[['Application name', 'Helder'],
                   ['Allowed redirect URLs', st.redirectUrl || (location.origin + '/api/bank/callback')],
                   ['Application description', 'Persoonlijke boekhouding: leest het saldo en de transacties van mijn eigen rekeningen.'],
                   ['Email for data protection matters', (Sync && Sync.account && Sync.account.email) || 'je eigen e-mailadres'],
                   ['Privacy URL of the application', location.origin + '/privacy'],
                   ['Terms URL of the application', location.origin + '/voorwaarden']].map(([k, v]) => `<tr><td class="small muted">${esc(k)}</td><td><code>${esc(v)}</code></td><td>${v === 'je eigen e-mailadres' ? '' : `<button class="btn small" data-action="copy" data-copy="${esc(v)}">Kopieer</button>`}</td></tr>`).join('')}
              </tbody></table></li>
            <li>Klik op <strong>Register</strong>. Je browser downloadt een <code>.pem</code>-bestand (de sleutel): bewaar het goed.</li></ul></li>
        <li><strong>Belangrijk — activeer de app:</strong> klik in het Control Panel bij je app op <strong>Activate by linking accounts</strong>, meld je aan bij je bank en duid je rekeningen aan. Zonder deze stap krijg je de fout “Application is not active”. De app werkt daarna enkel voor de rekeningen die je daar aanduidde.</li>
        <li>Vul hieronder de <strong>Application ID</strong> in en kies het <code>.pem</code>-bestand.</li>
      </ol>
      <form data-form="bank-setup" class="form-stack" autocomplete="off">
        <label class="field"><span>Application ID</span><input type="text" name="appId" id="eb-appid" value="${esc(m.appId || '')}" placeholder="bv. 1a2b3c4d-…" autocapitalize="none" required></label>
        <label class="field"><span>Privésleutel (.pem-bestand)</span><input type="file" id="eb-pem" accept=".pem,.key,.txt,application/x-pem-file"></label>
        ${m.pemName ? `<div class="small muted">Gekozen: ${esc(m.pemName)}</div>` : ''}
        <div class="errors">${esc(m.error || '')}</div>
        <button class="btn primary" type="submit" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Controleren bij Enable Banking…' : 'Opslaan en testen'}</button>
      </form>
      <p class="small muted">De sleutel wordt enkel op je Helder-server bewaard (in de map helder-data, niet via het web bereikbaar) en nooit naar je toestellen gestuurd. Je bankwachtwoord gaat nooit via Helder.</p>`,
      `${st.configured && !st.shared ? '<button class="btn danger" data-action="bank-remove-config">Instelling verwijderen</button>' : ''}<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>`, true);
  }

  async function bankSetupSubmit(form) {
    const m = modal;
    m.appId = String(new FormData(form).get('appId') || '').trim();
    if (!m.pem) { m.error = 'Kies het .pem-bestand met de privésleutel.'; renderModal(); return; }
    m.busy = true; m.error = '';
    renderModal();
    try {
      const r = await Sync.bank.saveConfig(m.appId, m.pem);
      m.pem = null;
      await loadBankLink();
      closeModal();
      toast('Bankkoppeling ingesteld' + (r.appName ? ' (' + r.appName + ')' : '') + '. Koppel nu je bank.');
      render();
    } catch (e) {
      if (modal !== m) return;
      m.busy = false; m.error = e.message; renderModal();
    }
  }

  function bankConnectModal() {
    const m = modal;
    const q = (m.search || '').toLowerCase();
    const list = (m.aspsps || []).filter(a => !q || a.name.toLowerCase().includes(q));
    const popular = list.filter(a => POPULAR_BANKS.test(a.name));
    const rest = list.filter(a => !POPULAR_BANKS.test(a.name));
    const btn = a => `<button class="btn bank-choice" data-action="bank-start" data-name="${esc(a.name)}" data-days="${a.maxDays || ''}" ${m.busy ? 'disabled' : ''}>${esc(a.name)}</button>`;
    return modalShell('Bank koppelen', `
      <p class="small muted">Je gaat naar je eigen bank om aan te melden (itsme, kaartlezer of bank-app) en geeft Helder leestoegang tot je rekeningen. Daarna kom je vanzelf terug.</p>
      <div class="filters"><select id="eb-country">${[['BE', 'België'], ['NL', 'Nederland'], ['LU', 'Luxemburg'], ['FR', 'Frankrijk'], ['DE', 'Duitsland']].map(([v, l]) => `<option value="${v}" ${m.country === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="search" id="eb-search" placeholder="Zoek je bank…" value="${esc(m.search || '')}"></div>
      ${m.error && m.errorKind === 'inactive' ? `<div class="notice">
          <strong>Je Enable Banking-app moet nog geactiveerd worden.</strong>
          <ol class="steps small">
            <li>Ga naar <a href="https://enablebanking.com/cp/applications" target="_blank" rel="noopener">enablebanking.com → Control Panel → API applications</a>.</li>
            <li>Klik bij je app <em>Helder</em> op <strong>Activate by linking accounts</strong>.</li>
            <li>Kies je bank (bv. Belfius), meld je aan bij je bank en duid je rekeningen aan.</li>
            <li>Kom terug naar Helder en probeer opnieuw.</li>
          </ol>
          <p class="small muted">Zo werkt de gratis app enkel voor de rekeningen die je daar aanduidt. Wil je later nog een bank toevoegen, koppel die dan eerst ook daar.</p>
          <button class="btn small" data-action="bank-retry-aspsps">Opnieuw proberen</button></div>`
        : m.error ? `<div class="errors">${esc(m.error)}</div>` : ''}
      ${!m.aspsps ? '<p class="muted">Banken laden…</p>' : `
        ${popular.length ? `<div class="bank-choices">${popular.map(btn).join('')}</div>` : ''}
        ${rest.length ? `<details ${q ? 'open' : ''}><summary class="small">Andere banken (${rest.length})</summary><div class="bank-choices">${rest.map(btn).join('')}</div></details>` : ''}
        ${!list.length && !m.error ? '<p class="muted">Geen bank gevonden.</p>' : ''}`}
      ${m.busy ? '<p><strong>Doorsturen naar je bank…</strong></p>' : ''}`,
      '<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button>', true);
  }

  async function loadAspsps() {
    const m = modal;
    m.aspsps = null; m.error = '';
    renderModal();
    try { const r = await Sync.bank.aspsps(m.country); if (modal === m) { m.aspsps = r.aspsps; renderModal(); } }
    catch (e) { if (modal === m) { m.aspsps = []; m.error = e.message; m.errorKind = e.code || ''; renderModal(); } }
  }

  async function startBankConnect(name, country, maxDays) {
    const m = modal;
    if (m) { m.busy = true; renderModal(); }
    try {
      const r = await Sync.bank.connect(name, country, maxDays);
      bankLink.awaiting = true;
      location.href = r.url;
    } catch (e) {
      if (m && modal === m) { m.busy = false; m.error = e.message; renderModal(); } else toast(e.message);
    }
  }

