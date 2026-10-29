  // ----- Instellingen -----

  // Eigen Anthropic API-sleutel: de sleutel zelf staat enkel op de server
  const aiKeyUi = { status: null, error: '', busy: false };
  async function loadAiKey() {
    if (!(Sync && Sync.mode === 'server') || demo) return;
    try { aiKeyUi.status = await Sync.aiKey.status(); aiKeyUi.error = ''; } catch (e) { aiKeyUi.error = e.message; }
    if (ui.view === 'settings' && !modal) render();
  }

  function aiKeyBlock() {
    if (!(Sync && Sync.mode === 'server') || demo || ui.admin) return '';
    const k = aiKeyUi.status;
    if (!k) { if (!aiKeyUi.error) setTimeout(loadAiKey, 0); return `<div class="section ai-key"><h3>AI (Claude)</h3><p class="small muted">${esc(aiKeyUi.error || 'Laden…')}</p></div>`; }
    if (k.set) return `<div class="section ai-key"><h3>AI (Claude) met je eigen sleutel</h3>
      <p class="small">✓ Je eigen API-sleutel (eindigt op <code>${esc(k.hint || '')}</code>) is ingesteld. De kosten lopen via je eigen Anthropic-account.</p>
      <button class="btn small danger" data-action="ai-key-remove">Sleutel verwijderen</button></div>`;
    return `<div class="section ai-key"><h3>AI (Claude)</h3>
      <p class="small muted">${k.server ? 'AI werkt nu met de sleutel van deze Helder. Je kan ook je eigen sleutel gebruiken.' : 'Wil je dat Claude je tegenpartijen indeelt? Gebruik je eigen API-sleutel van Anthropic: je betaalt dan zelf het (kleine) gebruik.'}</p>
      <details${k.server ? '' : ' open'}><summary class="small"><strong>Hoe kom ik aan een sleutel?</strong></summary>
        <ol class="steps small">
          <li>Ga naar <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> en maak een account.</li>
          <li>Zet bij <strong>Billing</strong> wat tegoed op je account (bv. € 5; dat is genoeg voor heel wat transacties).</li>
          <li>Ga naar <strong>API Keys</strong> → <strong>Create Key</strong>, geef ze de naam <em>Helder</em> en kopieer de sleutel (begint met <code>sk-ant-</code>).</li>
          <li>Plak ze hieronder en klik op <strong>Opslaan</strong>.</li>
        </ol></details>
      <form data-form="ai-key" class="input-row" autocomplete="off" style="margin-top:8px">
        <input type="password" name="apiKey" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" required>
        <button class="btn primary" type="submit" ${aiKeyUi.busy ? 'disabled' : ''}>${aiKeyUi.busy ? 'Controleren…' : 'Opslaan'}</button>
      </form>
      ${aiKeyUi.error ? `<div class="errors">${esc(aiKeyUi.error)}</div>` : ''}
      <p class="small muted">De sleutel wordt enkel op de Helder-server bewaard en nooit terug naar je toestellen gestuurd. Een limiet instellen kan in de Anthropic Console (Limits).</p></div>`;
  }

  async function aiKeySubmit(form) {
    aiKeyUi.busy = true; aiKeyUi.error = ''; render();
    try {
      await Sync.aiKey.save(String(new FormData(form).get('apiKey') || '').trim());
      await Sync.refreshFeatures();
      aiKeyUi.status = await Sync.aiKey.status();
      toast('Je eigen API-sleutel is ingesteld. AI-classificatie staat aan.');
    } catch (e) { aiKeyUi.error = e.message; }
    aiKeyUi.busy = false; render();
  }

  function renderSettings() {
    const sy = ui.sync;
    const st = state.settings;
    const aiOn = !!(Sync && Sync.features && Sync.features.ai);
    const catCount = {};
    for (const t of state.transactions) for (const l of C.splitLines(t)) if (l.categoryId) catCount[l.categoryId] = (catCount[l.categoryId] || 0) + 1;
    const catKind = c => c.kind === 'income' ? 'inkomstenbron' : isIncomeCost(c) ? 'kost op ' + catName(c.incomeId) : c.kind === 'advance' ? 'systeem: voorschotten' : c.kind === 'investment' ? 'systeem: beleggingen' : 'uitgaven';
    const order = c => c.kind === 'income' ? 0 : isIncomeCost(c) ? 1 : c.kind === 'expense' ? 2 : 3;
    const manual = state.transactions.filter(t => t.source !== 'import').length;
    const tabs = [
      ['accounts', '🏦', 'Rekeningen', 'Je rekeningen en vanaf welke datum Helder transacties bijhoudt.'],
      ['categories', '🏷️', 'Categorieën', 'Waarin je uitgaven en inkomsten worden ingedeeld.'],
      ['auto', '✨', 'Automatisch indelen', 'Hoe Helder onbekende tegenpartijen herkent. De regels zelf staan bij Bank.'],
      ['account', '👤', 'Account', 'Aanmelden, synchroniseren tussen je toestellen en je account.'],
      ['data', '💾', 'Gegevens & back-up', 'Wat er in Helder zit, back-ups, exporteren, de voorbeeldmodus en alles wissen.']
    ];
    const tab = tabs.some(t => t[0] === ui.settingsTab) ? ui.settingsTab : 'accounts';
    const cur = tabs.find(t => t[0] === tab);
    const sections = {
      accounts: () => `
        <div class="card">
          <h2>Rekeningen</h2>
          <div class="list">${state.accounts.map(a => `<div class="list-row"><div class="grow"><strong>${esc(a.name)}</strong><div class="small muted">${a.iban ? esc(C.formatIban(a.iban)) : 'geen IBAN'} · ${state.transactions.filter(t => t.accountId === a.id).length} transacties</div></div>
            <button class="btn small" data-action="edit-account" data-id="${esc(a.id)}">Bewerk</button><button class="btn small danger" data-action="delete-account" data-id="${esc(a.id)}" aria-label="Verwijder">✕</button></div>`).join('')}</div>
          <p class="btn-row"><button class="btn" data-action="new-account">+ Rekening</button></p>
          <p class="small muted">Bankrekeningen worden automatisch aangemaakt bij de eerste import (IBAN uit het bestand). Overschrijvingen tussen je eigen rekeningen tellen nooit als inkomen of uitgave.</p>
        </div>
        ${dataFromRow()}`,
      categories: () => `
        <div class="card">
          <h2>Categorieën</h2>
          <div class="list scroll">${state.categories.slice().sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map(c => `<div class="list-row">
            <span class="badge"><span class="dot" style="background:${esc(c.color)}"></span>${esc(C.categoryIcon(c) + ' ' + c.name)}</span>
            <span class="grow small muted">${esc(catKind(c))} · ${catCount[c.id] || 0}</span>
            ${c.id.startsWith('sys_') ? '' : `<button class="btn small" data-action="edit-category" data-id="${esc(c.id)}">Bewerk</button><button class="btn small danger" data-action="delete-category" data-id="${esc(c.id)}" aria-label="Verwijder">✕</button>`}</div>`).join('')}</div>
          <p class="btn-row"><button class="btn" data-action="new-category">+ Uitgavencategorie</button><button class="btn" data-action="new-category" data-kind="income">+ Inkomstenbron</button></p>
        </div>
`,
      auto: () => `
        <div class="card">
          <h2>Regels</h2>
          ${rulesConfirmToggle()}
          <p class="small muted">De regels zelf beheer je bij <a href="#bank" data-view-link="bank">Bank</a>, onderaan.</p>
        </div>
        <div class="card" style="margin-top:16px">
          <h2>Online opzoeken</h2>
          <p class="small muted">Onbekende tegenpartijen worden online opgezocht (Wikidata, OpenStreetMap${aiOn ? ', AI' : ''}) en via de zoekwoorden van je categorieën gekoppeld. Jij keurt elk voorstel goed.</p>
          <div class="form-grid">
            <label class="field"><span>Bron</span><select data-setting="lookupProvider">
              <option value="auto" ${st.lookupProvider === 'auto' ? 'selected' : ''}>Automatisch</option>
              <option value="free" ${st.lookupProvider === 'free' ? 'selected' : ''}>Wikidata + OpenStreetMap</option>
              <option value="ai" ${st.lookupProvider === 'ai' ? 'selected' : ''} ${aiOn ? '' : 'disabled'}>AI (Claude)${aiOn ? '' : ' — niet ingesteld'}</option></select></label>
            <label class="field"><span>Landen</span><input type="text" data-setting="lookupCountries" value="${esc(st.lookupCountries || 'be')}"></label>
            <label class="field full"><span>Herkenning beleggingsrekening (naam of mededeling, regex)</span><input type="text" data-setting="investPattern" value="${esc(st.investPattern || 'degiro|flatex|saxo')}"></label>
          </div>
          ${aiKeyBlock()}
        </div>
        <div class="card">
          <h2>Automatische regels</h2>
          <p class="small muted">Regels koppelen nieuwe transacties vanzelf aan een categorie of persoon. Je vindt ze op het tabblad <strong>Bank</strong>, onder de transacties.</p>
          <p class="btn-row"><button class="btn" data-action="goto-rules">Naar de regels</button></p>
        </div>`,
      account: () => `
        <div class="card">
          <h2>Account & synchronisatie</h2>
          ${sy.mode === 'local' ? `<p class="small muted">Helder draait nu <strong>lokaal</strong>: je gegevens staan enkel in deze browser. Om Helder op al je toestellen (ook je iPhone) te gebruiken, host je de Helder-server — zie README → <em>Hosten</em>.</p>`
          : `<p>Aangemeld als <strong>${esc((Sync.account && Sync.account.displayName) || sy.user || '')}</strong>${Sync.account && Sync.account.email ? ` <span class="small muted">(${esc(Sync.account.email)}, via Google)</span>` : ''}</p>
            <p class="small muted">${sy.lastSync ? 'Laatst gesynchroniseerd: ' + esc(new Date(sy.lastSync).toLocaleString('nl-BE')) : 'Nog niet gesynchroniseerd'}${sy.pending ? ' · ' + sy.pending + ' wijziging(en) wachten' : ''}</p>
            <p class="btn-row"><button class="btn" data-action="sync-now">Nu synchroniseren</button>${Sync.account && Sync.account.email ? '' : '<button class="btn" data-action="change-password">Wachtwoord wijzigen</button>'}
              <button class="btn" data-action="logout">Afmelden</button><button class="btn danger" data-action="logout-all">Overal afmelden</button></p>
            ${Sync.account && !Sync.account.email && Sync.auth && Sync.auth.google ? `<div class="section google-link">
              <h3>Aanmelden met Google</h3>
              ${Sync.account.googleLinked
                ? `<p class="small">✓ Gekoppeld met <strong>${esc(Sync.account.googleLinked)}</strong>. Je kan aanmelden met Google of met je gebruikersnaam en wachtwoord; je komt altijd in hetzelfde account.</p>
                   <button class="btn small" data-action="google-unlink">Loskoppelen van Google</button>`
                : `<p class="small muted">Koppel je account aan je Google-account. Daarna kan je ook aanmelden met één klik op <em>Aanmelden met Google</em>. Je gegevens, gebruikersnaam en wachtwoord blijven gewoon zoals ze zijn.</p>
                   <a class="btn google-btn small" href="/api/auth/google?link=1">${GOOGLE_ICON}Koppelen met Google</a>`}
            </div>` : ''}
            ${householdBlock()}
            <p class="small muted">iPhone: open Helder in Safari → deelknop → <em>Zet op beginscherm</em>.</p>
            ${Sync.account && Sync.account.role === 'member' ? `<details class="danger-zone"><summary class="small">Account verwijderen</summary>
              <p class="small">Je account en al je gegevens worden meteen en definitief gewist, ook de back-ups op de server. Download eerst een back-up als je je gegevens wil houden.</p>
              <p class="btn-row"><button class="btn small" data-action="export-json">Back-up downloaden</button><button class="btn small danger" data-action="delete-account">Mijn account verwijderen</button></p></details>` : ''}`}
          <p class="small muted" style="margin-top:12px"><a href="privacy.html" target="_blank" rel="noopener">Privacyverklaring</a> · <a href="voorwaarden.html" target="_blank" rel="noopener">Gebruiksvoorwaarden</a></p>
        </div>
`,
      data: () => `
        <div class="card">
          <h2>Gegevens</h2>
          <p class="btn-row"><button class="btn" data-action="export-json">Back-up downloaden</button><button class="btn" data-action="import-json">Back-up terugzetten</button><button class="btn" data-action="export-csv">Transacties exporteren (CSV)</button></p>
          <p class="btn-row">${demo ? '<button class="btn" data-action="exit-demo">Voorbeeldmodus afsluiten</button>' : '<button class="btn" data-action="enter-demo">Voorbeeldmodus openen</button>'}
            <button class="btn danger" data-action="reset">${demo ? 'Voorbeeld wissen' : 'Alles wissen' + (sy.mode !== 'local' ? ' (alle toestellen)' : '')}</button></p>
          <p class="small muted">De voorbeeldmodus is een aparte zandbak met verzonnen gegevens; je eigen gegevens worden er nooit door aangeraakt.</p>
        </div>
        <div class="card">
          <h2>Wat zit er in Helder?</h2>
          <div class="list">
            ${(state.imports || []).map(i => `<div class="list-row"><div class="grow">📄 ${esc(i.fileName)}<div class="small muted">${esc(accName(i.accountId))} · ${esc(fmtDateTime(i.importedAt))}</div></div><span>${state.transactions.filter(t => t.importId === i.id).length}</span></div>`).join('')}
            <div class="list-row"><div class="grow">✎ Manueel ingevoerd</div><span>${manual}</span></div>
            ${Invest.brokers(inv()).map(b => `<div class="list-row"><div class="grow">📈 ${esc(b.name)}</div><span class="small">${b.id === 'degiro' ? (inv().files || []).length + ' bestand(en)' : ''}${b.source === 'degiro-api' || b.source === 'saxo-api' ? ' · rechtstreeks' : ''}</span></div>`).join('')}
            <div class="list-row total"><div class="grow"><strong>Totaal transacties</strong></div><span>${state.transactions.length}</span></div>
          </div>
          <p class="small muted">Bestanden bekijken of ongedaan maken doe je in het tabblad Bank.</p>
        </div>
`
    };
    return `
      <div class="page-head"><h1>Instellingen</h1></div>
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Instellingen">${tabs.map(([id, icon, label]) => `<button class="${id === tab ? 'active' : ''}" data-action="settings-tab" data-tab="${id}"><span aria-hidden="true">${icon}</span> ${label}</button>`).join('')}</nav>
        <div class="settings-body">
          <div class="settings-intro"><h2>${cur[1]} ${cur[2]}</h2><p class="muted">${cur[3]}</p></div>
          <div class="settings-cards">${sections[tab]()}</div>
        </div>
      </div>`;
  }

