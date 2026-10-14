  // ---------- Gegevens ----------

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportCSV() {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Datum', 'Rekening', 'Eigen titel', 'Tegenpartij', 'IBAN tegenpartij', 'Mededeling', 'Bedrag', 'Soort', 'Gekoppeld aan', 'Persoon', 'Bron', 'Notitie'].map(q).join(';')];
    for (const t of state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const cats = C.splitLines(t).map(l => (l.categoryId ? catName(l.categoryId) : '') + (t.splits.length ? ' ' + C.centsToInput(l.amount) : '')).join(' + ');
      const persons = C.splitLines(t).map(l => l.person).filter(Boolean).join(', ');
      lines.push([fmtDate(t.date), accName(t.accountId), t.title || '', t.counterparty, C.formatIban(t.counterpartyIban), t.description, (t.amount < 0 ? '-' : '') + C.centsToInput(t.amount),
        (KIND_LABEL[kindOf(t)] || [])[1], cats, persons, t.source === 'import' ? (imp(t.importId) || {}).fileName : 'manueel', t.note || ''].map(q).join(';'));
    }
    download('helder-transacties-' + today + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }
  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await readFile(file));
        if (!data || !Array.isArray(data.transactions)) throw new Error('geen Helder-back-up');
        if (data.demo) throw new Error('dit is een back-up van de voorbeeldmodus');
        if ((data.version || 1) < Store.VERSION) throw new Error('back-up van een oudere Helder-versie; die wordt bewust niet teruggezet');
        if (!confirm('Al je huidige gegevens vervangen door deze back-up?')) return;
        replaceAll(data, 'Back-up teruggezet');
      } catch (e) { toast('Ongeldige back-up: ' + e.message); }
    };
    input.click();
  }
  /** Vervangt alle echte gegevens en markeert verwijderingen zodat andere toestellen volgen. */
  function replaceAll(newState, msg) {
    if (demo) exitDemo();
    const fresh = Store.migrate(newState);
    fresh.tombstones = realState.tombstones || {};
    realState = fresh;
    state = realState;
    commit(msg);
  }

