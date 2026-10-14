  // ----- Degiro -----

  function degiroModal() {
    const m = modal;
    return modalShell('Ophalen uit Degiro', `
      <p class="small muted">Je gegevens gaan via je eigen Helder-server rechtstreeks naar Degiro. <strong>Wachtwoord en code worden niet bewaard.</strong></p>
      <form data-form="degiro" class="form-stack" autocomplete="off">
        <label class="field"><span>Degiro-gebruikersnaam</span><input type="text" name="username" autocapitalize="none" value="${esc(m.username || '')}" required></label>
        <label class="field"><span>Wachtwoord</span><input type="password" name="password" autocomplete="off" required></label>
        <label class="field"><span>2FA-code (6 cijfers uit je authenticator-app${m.needOtp ? '' : ', als je 2FA gebruikt'})</span><input type="text" name="otp" inputmode="numeric" maxlength="8" ${m.needOtp ? 'required' : ''}></label>
        <div class="errors">${esc(m.error || '')}</div>
        <button class="btn primary" type="submit" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Bezig met ophalen…' : 'Ophalen'}</button>
      </form>
      <p class="small muted">Lukt het niet? Degiro wijzigt soms zijn website. De exportbestanden werken altijd.</p>`, '<span class="spacer"></span><button class="btn" data-action="close-modal">Sluiten</button>');
  }

  async function degiroSubmit(form) {
    const f = new FormData(form);
    const m = modal;
    m.username = String(f.get('username')).trim();
    m.busy = true; m.error = '';
    renderModal();
    try {
      const data = await Sync.degiro(m.username, String(f.get('password')), String(f.get('otp') || '').trim());
      state.investments = Invest.mergeInvestments(state.investments, data, 'degiro-api', today);
      closeModal();
      commit(`Degiro opgehaald: ${data.positions.length} posities, ${data.trades.length} transacties, ${data.movements.length} kasbewegingen`);
    } catch (e) {
      if (modal !== m) return;
      m.busy = false;
      m.needOtp = e.code === 'otp';
      m.error = e.message;
      renderModal();
    }
  }

  function degiroFilesModal() {
    const m = modal;
    return modalShell('Degiro-exportbestanden opladen', `
      <label class="field"><span>Bestanden (je mag er meerdere tegelijk kiezen)</span><input type="file" id="dg-files" accept=".csv,text/csv" multiple></label>
      ${m.files && m.files.length ? `<div class="table-wrap"><table><thead><tr><th>Bestand</th><th>Herkend als</th><th>Stand op datum</th><th></th></tr></thead><tbody>${m.files.map((f, i) => `<tr>
        <td>📄 ${esc(f.name)}</td>
        <td>${f.type ? `<strong>${esc({ portfolio: 'Portefeuille', transactions: 'Transacties', account: 'Rekeningoverzicht' }[f.type])}</strong>` : '<span style="color:var(--red)">niet herkend</span>'}</td>
        <td>${f.type === 'portfolio' ? `<input type="date" data-dg-date="${i}" value="${esc(f.date || today)}" max="${today}">` : '<span class="muted small">—</span>'}</td>
        <td class="small">${f.duplicate ? '<span class="badge over">al opgeladen</span>' : f.type ? esc(f.info) : ''}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">Geef bij elke portefeuille-export de datum op waarvan de stand is (bv. 31/12/2024). Exports van een vroegere datum gelden enkel als waarderingspunt voor rendement en grafiek.</p>` : ''}
      <details><summary class="small"><strong>Wat moet ik exact exporteren?</strong></summary>${DEGIRO_EXPORT_HELP}</details>
      <div class="errors" id="dg-errors"></div>`,
      `<span class="spacer"></span><button class="btn" data-action="close-modal">Annuleren</button><button class="btn primary" data-action="degiro-apply" ${m.files && m.files.some(f => f.type && !f.duplicate) ? '' : 'disabled'}>Toevoegen</button>`, true);
  }

  async function loadDegiroFiles(fileList) {
    const files = [];
    const known = new Set(((inv() && inv().files) || []).map(f => f.hash));
    for (const file of Array.from(fileList)) {
      const text = await readFile(file);
      const type = Invest.detectCsv(text);
      const hash = Banks.hashText(text);
      let info = '';
      if (type === 'portfolio') { const p = Invest.parsePortfolioCsv(text); info = p.positions.length + ' posities · ' + money(p.positions.reduce((s, x) => s + x.valueEur, 0) + p.cashEur); }
      if (type === 'transactions') info = Invest.parseTransactionsCsv(text).length + ' transacties';
      if (type === 'account') info = Invest.parseAccountCsv(text).length + ' kasbewegingen';
      const d = file.name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
      files.push({ name: file.name, text, type, hash, info, duplicate: known.has(hash) || files.some(x => x.hash === hash), date: (d && C.parseDate(d[1] + '-' + d[2] + '-' + d[3])) || today });
    }
    modal.files = files;
    renderModal();
  }

  function applyDegiroFiles() {
    const m = modal;
    let data = state.investments;
    const order = { account: 0, transactions: 1, portfolio: 2 };
    const list = m.files.filter(f => f.type && !f.duplicate).sort((a, b) => order[a.type] - order[b.type] || (a.date || '').localeCompare(b.date || ''));
    const dgDate = () => { const b = Invest.brokers(data).find(x => x.id === 'degiro'); return b ? b.positionsDate : null; };
    for (const f of list) {
      if (f.type === 'portfolio') data = Invest.mergeInvestments(data, Invest.parsePortfolioCsv(f.text), 'degiro-csv', f.date || today);
      if (f.type === 'transactions') data = Invest.mergeInvestments(data, { trades: Invest.parseTransactionsCsv(f.text) }, 'degiro-csv', dgDate());
      if (f.type === 'account') data = Invest.mergeInvestments(data, { movements: Invest.parseAccountCsv(f.text) }, 'degiro-csv', dgDate());
      data.files = (data.files || []).concat([{ name: f.name, hash: f.hash, type: f.type, date: f.type === 'portfolio' ? f.date : null, importedAt: new Date().toISOString() }]);
    }
    state.investments = data;
    closeModal();
    commit(`${list.length} Degiro-bestand(en) toegevoegd`);
  }

