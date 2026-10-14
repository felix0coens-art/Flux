  // ----- Prullenbak -----

  function trashCard() {
    const list = (state.deleted || []).filter(d => !d.hidden).slice().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    if (!list.length) return '';
    return `<details class="card trash" style="margin-top:24px" data-keep="trash" ${ui.keepOpen.trash ? 'open' : ''}>
      <summary><strong>🗑 Prullenbak</strong> <span class="small muted">· ${list.length} verwijderde transactie${list.length === 1 ? '' : 's'} — terug te zetten wanneer je wil</span></summary>
      <p class="small muted">Verwijderde transacties uit een bankbestand of de bankkoppeling worden bij een nieuwe import overgeslagen zolang ze hier staan. Zet je ze terug, dan staan ze weer gewoon in Helder.</p>
      <p class="btn-row"><button class="btn small" data-action="trash-restore-all">Alles terugzetten</button><button class="btn small ghost danger" data-action="trash-empty">Prullenbak leegmaken</button></p>
      <div class="table-wrap"><table><thead><tr><th>Datum</th><th>Omschrijving</th><th class="right">Bedrag</th><th>Verwijderd</th><th></th></tr></thead><tbody>
      ${list.slice(0, 300).map(d => `<tr><td class="nowrap">${fmtDate(d.date)}<div class="small muted">${esc(accName(d.accountId))}</div></td>
        <td>${esc((d.tx && d.tx.title) || d.counterparty || '—')}<div class="desc">${esc(d.description)}${d.tx ? '' : ' <span class="muted">(zonder koppeling teruggezet)</span>'}</div></td>
        <td class="amount ${amountClass(d.amount)}">${money(d.amount)}</td><td class="small nowrap">${esc(fmtDateTime(d.deletedAt))}</td>
        <td class="right"><button class="btn small" data-action="trash-restore" data-id="${esc(d.id)}">↩ Terugzetten</button></td></tr>`).join('')}
      </tbody></table></div></details>`;
  }

