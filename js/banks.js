/*
 * Helder — import van rekeninguittreksels (CSV) met vaste profielen per bank.
 *
 * Elk opgeladen bestand wordt een "import" met herkomst (bestandsnaam, bank, rekening, periode).
 * Dubbels worden op twee niveaus tegengehouden:
 *  1. hetzelfde bestand (zelfde inhoud) wordt geweigerd;
 *  2. rijen die al in Helder zitten (uit een overlappend bestand) worden overgeslagen, op basis
 *     van de bankreferentie (Argenta) of datum + bedrag + saldo (KBC) of, algemeen, een vingerafdruk.
 */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.FluxCore;

  function norm(h) {
    return String(h || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  }

  /*
   * Kolomnamen per bank. Elke veldnaam verwijst naar een lijst mogelijke kolomkoppen (eerste match wint);
   * bij `description` worden alle gevonden kolommen samengevoegd.
   */
  const PROFILES = [
    {
      id: 'kbc', name: 'KBC / CBC',
      detect: hs => hs.includes('rekeningnummer') && (hs.includes('afschriftnummer') || hs.includes('rubrieknaam')),
      fields: {
        account: ['rekeningnummer'],
        date: ['datum', 'uitvoeringsdatum'],
        amount: ['bedrag'],
        balance: ['saldo'],
        counterparty: ['naam tegenpartij'],
        counterpartyIban: ['rekeningnummer tegenpartij', 'tegenpartij'],
        description: ['vrije mededeling', 'gestructureerde mededeling', 'omschrijving'],
        statement: ['afschriftnummer']
      }
    },
    {
      id: 'argenta', name: 'Argenta',
      detect: hs => hs.includes('referentie') && (hs.includes('boekdatum') || hs.includes('verrichtingsdatum') || hs.includes('valutadatum')),
      fields: {
        account: ['rekening', 'rekeningnummer'],
        date: ['boekdatum', 'verrichtingsdatum', 'valutadatum'],
        amount: ['bedrag'],
        ref: ['referentie'],
        counterparty: ['naam tegenpartij', 'tegenpartij'],
        counterpartyIban: ['rekening tegenpartij', 'rekeningnummer tegenpartij'],
        description: ['mededeling', 'beschrijving', 'omschrijving']
      }
    }
  ];

  /**
   * Kaartbetalingen hebben vaak geen "naam tegenpartij"; haal de handelaar uit de omschrijving:
   * "BETALING VIA BANCONTACT 12-10 14.32 COLRUYT GENT 3412" → "COLRUYT GENT".
   */
  function merchantFromDescription(desc) {
    const m = String(desc || '').match(/(?:betaling|aankoop|uitgave|terugbetaling|paiement|achat)\s+(?:via\s+|met\s+|par\s+)?(?:bancontact|maestro|visa|mastercard|debetkaart|kaart|apple pay|google pay|payconiq)[^A-Za-z]*(?:\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?)?\s*(?:\d{1,2}[.:h]\d{2})?\s*(.+)$/i);
    if (!m) return '';
    return m[1].replace(/\s(kaart\S*|card\S*|nr\.?|n°)(\s.*)?$/i, '').replace(/\s+\d[\d\s*xX]*$/, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  function findCol(headers, names) {
    const hs = headers.map(norm);
    for (const n of names) { const i = hs.indexOf(n); if (i >= 0) return i; }
    for (const n of names) { const i = hs.findIndex(h => h.includes(n)); if (i >= 0) return i; }
    return -1;
  }

  /** Zoekt de kopregel (soms staan er eerst enkele infolijnen) en het bijhorende bankprofiel. */
  function detect(rows) {
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const hs = rows[i].map(norm);
      const profile = PROFILES.find(p => p.detect(hs));
      if (profile) return { profile, headerRow: i };
    }
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const m = C.guessMapping(rows[i]);
      if (m.date != null && (m.amount != null || m.debit != null || m.credit != null)) return { profile: null, headerRow: i, mapping: m };
    }
    return { profile: null, headerRow: 0, mapping: C.guessMapping(rows[0] || []) };
  }

  /** Eenvoudige, stabiele hash van de bestandsinhoud (cyrb53). */
  function hashText(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    const s = String(str).replace(/\r\n/g, '\n').trim();
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  /** Unieke sleutel van een banktransactie, om dezelfde rij uit een ander bestand te herkennen. */
  function rowKey(tx) {
    if (tx.bankRef) return 'ref|' + tx.bankRef;
    if (tx.balanceAfter != null) return ['bal', tx.date, tx.amount, tx.balanceAfter].join('|');
    return 'fp|' + C.fingerprint(Object.assign({}, tx, { accountId: '' }));
  }

  /**
   * Leest een CSV-bestand van de bank.
   * @returns {{ profile, headerRow, rows, accountIbans, transactions, errors, period, balance, mapping }}
   */
  function parse(text, opts) {
    opts = opts || {};
    const { rows, delimiter } = C.parseCSV(text);
    const det = opts.mapping ? { profile: null, headerRow: opts.headerRow || 0, mapping: opts.mapping } : detect(rows);
    const headers = rows[det.headerRow] || [];
    const data = rows.slice(det.headerRow + 1);
    const out = [], errors = [];
    const ibans = {};
    if (det.profile) {
      const f = det.profile.fields;
      const col = {};
      for (const k of Object.keys(f)) col[k] = k === 'description'
        ? f[k].map(n => findCol(headers, [n])).filter((v, i, a) => v >= 0 && a.indexOf(v) === i)
        : findCol(headers, f[k]);
      data.forEach((row, i) => {
        const cell = idx => idx >= 0 && row[idx] != null ? String(row[idx]).trim() : '';
        const date = C.parseDate(cell(col.date));
        const amount = C.parseAmount(cell(col.amount));
        if (!date || isNaN(amount)) { errors.push(det.headerRow + 2 + i); return; }
        const account = C.normalizeIban(cell(col.account));
        if (account) ibans[account] = (ibans[account] || 0) + 1;
        const descParts = [];
        for (const idx of col.description) { const v = cell(idx).replace(/\s+/g, ' '); if (v && !descParts.includes(v)) descParts.push(v); }
        const bal = col.balance >= 0 ? C.parseAmount(cell(col.balance)) : NaN;
        const description = descParts.join(' · ');
        out.push({
          date, amount,
          counterparty: cell(col.counterparty) || merchantFromDescription(descParts.find(d => merchantFromDescription(d)) || ''),
          counterpartyIban: C.normalizeIban(cell(col.counterpartyIban)),
          description,
          bankRef: col.ref >= 0 ? cell(col.ref) || null : null,
          balanceAfter: isNaN(bal) ? null : bal,
          accountIban: account || null,
          row: det.headerRow + 2 + i
        });
      });
    } else {
      const res = C.rowsToTransactions(data, det.mapping || {}, null);
      res.transactions.forEach(t => out.push({
        date: t.date, amount: t.amount, counterparty: t.counterparty, counterpartyIban: t.counterpartyIban,
        description: t.description, bankRef: null, balanceAfter: null, accountIban: null
      }));
      errors.push(...res.errors.map(i => det.headerRow + 2 + i));
    }
    const dates = out.map(t => t.date).sort();
    return {
      profile: det.profile, mapping: det.mapping || null, headerRow: det.headerRow, headers, delimiter,
      rowCount: data.filter(r => r.some(c => String(c).trim())).length,
      accountIbans: Object.keys(ibans).sort((a, b) => ibans[b] - ibans[a]),
      transactions: out, errors,
      period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      balance: endBalance(out)
    };
  }

  /**
   * Saldo op het einde van de laatste dag in het bestand. Werkt ongeacht of de bank de rijen
   * oplopend of aflopend sorteert: de laatste boeking van die dag is die waarna geen andere volgt.
   */
  function endBalance(txs) {
    const withBal = txs.filter(t => t.balanceAfter != null);
    if (!withBal.length) return null;
    const last = withBal.map(t => t.date).sort().pop();
    const day = withBal.filter(t => t.date === last);
    const final = day.find(r => !day.some(x => x !== r && x.balanceAfter - x.amount === r.balanceAfter)) || day[0];
    return { date: last, amount: final.balanceAfter };
  }

  /**
   * Bereidt een import voor: welke rijen zijn nieuw, welke zitten er al in (en uit welke import).
   */
  function plan(state, parsed, accountId, fileText, fileName) {
    const fileHash = hashText(fileText);
    const sameFile = (state.imports || []).find(i => i.fileHash === fileHash && i.accountId === accountId)
      || (state.imports || []).find(i => i.fileHash === fileHash);
    const existing = new Map();
    for (const t of state.transactions) if (t.accountId === accountId && t.source === 'import') existing.set(rowKey(t), t);
    // Ook manuele/oude transacties zonder bankreferentie herkennen via vingerafdruk
    const loose = new Map();
    for (const t of state.transactions) if (t.accountId === accountId) loose.set('fp|' + C.fingerprint(Object.assign({}, t, { accountId: '' })), t);
    // Transacties die via de bankkoppeling binnenkwamen hebben andere referenties: herkennen op bedrag en datum
    const gone = (state.deleted || []).filter(d => d.accountId === accountId && !d.manual);
    const goneKeys = new Map(gone.map(d => [d.key, d]));
    const linked = state.transactions.filter(t => t.accountId === accountId && isLinkedRef(t.bankRef))
      .concat(gone.filter(d => isLinkedRef(d.bankRef)));
    const usedLinked = new Set();
    const seen = new Set();
    const fresh = [], duplicates = [];
    const from = (state.settings && state.settings.dataFrom) || '';
    const tooOld = [];
    for (const t of parsed.transactions) {
      if (from && t.date < from) { tooOld.push(t); continue; }
      const key = rowKey(t);
      const fp = 'fp|' + C.fingerprint(Object.assign({}, t, { accountId: '' }));
      const dup = existing.get(key) || goneKeys.get(key) || (t.bankRef || t.balanceAfter != null ? null : loose.get(fp))
        || (seen.has(key) ? null : closestMatch(linked, t, usedLinked));
      if (dup || seen.has(key)) duplicates.push({ tx: t, existing: dup && !dup.deletedAt ? dup : null, deleted: !!(dup && dup.deletedAt) });
      else { fresh.push(t); seen.add(key); }
    }
    const fromImports = {};
    for (const d of duplicates) if (d.existing && d.existing.importId) fromImports[d.existing.importId] = (fromImports[d.existing.importId] || 0) + 1;
    return { fileHash, fileName, sameFile: sameFile || null, fresh, duplicates, fromImports, tooOld };
  }

  /** Voert een geplande import uit: maakt het importrecord en de transacties aan. */
  function apply(state, planned, parsed, accountId, now) {
    const imp = {
      id: C.uid('imp'), fileName: planned.fileName, fileHash: planned.fileHash,
      bank: parsed.profile ? parsed.profile.id : 'generic', bankName: parsed.profile ? parsed.profile.name : 'Andere bank',
      accountId, importedAt: new Date(now || Date.now()).toISOString(),
      period: parsed.period, count: planned.fresh.length, duplicates: planned.duplicates.length, errors: parsed.errors.length
    };
    state.imports = state.imports || [];
    state.imports.push(imp);
    const t0 = now || Date.now();
    planned.fresh.forEach((t, i) => {
      state.transactions.push({
        id: C.uid('tx'), accountId, date: t.date, amount: t.amount,
        counterparty: t.counterparty, counterpartyIban: t.counterpartyIban, description: t.description,
        bankRef: t.bankRef || undefined, balanceAfter: t.balanceAfter != null ? t.balanceAfter : undefined,
        categoryId: null, categorySource: null, splits: [], source: 'import', importId: imp.id,
        transferMode: 'auto', createdAt: t0 + i
      });
    });
    // Saldo van de rekening bijwerken als het bestand een saldokolom heeft
    const acc = state.accounts.find(a => a.id === accountId);
    if (acc && parsed.balance && (!acc.balance || parsed.balance.date >= acc.balance.date)) {
      acc.balance = { date: parsed.balance.date, amount: parsed.balance.amount, source: 'import' };
    }
    return imp;
  }

  /** Maakt een import volledig ongedaan. */
  function undo(state, importId) {
    const n = state.transactions.filter(t => t.importId === importId).length;
    state.transactions = state.transactions.filter(t => t.importId !== importId);
    state.imports = (state.imports || []).filter(i => i.id !== importId);
    return n;
  }

  // ---------- Bankkoppeling (Enable Banking / PSD2) ----------

  const LINK_PREFIX = 'eb:';
  function isLinkedRef(ref) { return typeof ref === 'string' && ref.indexOf(LINK_PREFIX) === 0; }

  /** Dichtstbijzijnde transactie met hetzelfde bedrag, hoogstens 4 dagen verschil, die nog niet gebruikt is. */
  function closestMatch(list, t, used) {
    const d0 = Date.parse(t.date);
    let best = null, bestDiff = Infinity;
    for (const x of list) {
      if (used.has(x.id) || x.amount !== t.amount) continue;
      const diff = Math.abs(Date.parse(x.date) - d0) / 86400000;
      if (diff <= 4 && diff < bestDiff) { best = x; bestDiff = diff; }
    }
    if (best) used.add(best.id);
    return best;
  }

  function ebAmount(a) {
    if (a == null) return NaN;
    const v = typeof a === 'object' ? (a.balance_amount ? a.balance_amount.amount : a.amount) : a;
    return parseFloat(String(v).replace(',', '.'));
  }

  /** Zet een transactie van Enable Banking om naar een rij zoals uit een bankbestand. Enkel geboekte transacties. */
  function fromEnableBanking(t) {
    if (!t || (t.status && t.status !== 'BOOK')) return null;
    const raw = ebAmount(t.transaction_amount);
    if (!isFinite(raw)) return null;
    const value = Math.round(Math.abs(raw) * 100);
    const out = t.credit_debit_indicator ? t.credit_debit_indicator === 'DBIT' : raw < 0;
    const party = (out ? t.creditor : t.debtor) || {};
    const partyAcc = (out ? t.creditor_account : t.debtor_account) || {};
    const remit = [];
    for (const r of t.remittance_information || []) { const v = String(r).replace(/\s+/g, ' ').trim(); if (v && !remit.includes(v)) remit.push(v); }
    const description = remit.join(' · ');
    const date = C.parseDate(String(t.booking_date || t.value_date || t.transaction_date || '').slice(0, 10));
    if (!date) return null;
    const bal = ebAmount(t.balance_after_transaction);
    return {
      date, amount: out ? -value : value,
      counterparty: String(party.name || '').trim() || merchantFromDescription(remit.find(d => merchantFromDescription(d)) || '') || '',
      counterpartyIban: C.normalizeIban(partyAcc.iban || ''),
      description,
      bankRef: t.entry_reference ? LINK_PREFIX + t.entry_reference : null,
      balanceAfter: isFinite(bal) ? Math.round(bal * 100) : null
    };
  }

  /** Beste saldo uit de lijst van de bank (afgesloten geboekt saldo eerst). */
  function balanceFromEnableBanking(balances, today) {
    const order = ['CLBD', 'ITBD', 'XPCD', 'ITAV', 'CLAV', 'OPBD', 'PRCD', 'INFO', 'OTHR'];
    const rank = b => { const i = order.indexOf(b.balance_type); return i < 0 ? order.length : i; };
    const list = (balances || []).filter(b => isFinite(ebAmount(b))).sort((a, b) => rank(a) - rank(b));
    if (!list.length) return null;
    const b = list[0];
    return { date: C.parseDate(String(b.reference_date || '').slice(0, 10)) || today, amount: Math.round(ebAmount(b) * 100) };
  }

  /**
   * Welke opgehaalde transacties zijn nieuw? Herkent dezelfde transactie via de referentie van de bank,
   * en transacties uit een CSV-bestand of manuele invoer via bedrag en datum (hoogstens 4 dagen verschil).
   */
  function planLinked(state, accountId, rows) {
    const gone = (state.deleted || []).filter(d => d.accountId === accountId && !d.manual);
    const inAcc = state.transactions.filter(t => t.accountId === accountId).concat(gone);
    const byRef = new Map(inAcc.filter(t => t.bankRef).map(t => [t.bankRef, t]));
    const pool = inAcc.filter(t => !isLinkedRef(t.bankRef));
    const used = new Set(), seen = new Set();
    const fresh = [], duplicates = [];
    const from = (state.settings && state.settings.dataFrom) || '';
    const tooOld = [];
    for (const t of rows.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      if (from && t.date < from) { tooOld.push(t); continue; }
      if (t.bankRef && (byRef.has(t.bankRef) || seen.has(t.bankRef))) { const x = byRef.get(t.bankRef) || null; duplicates.push({ tx: t, existing: x && !x.deletedAt ? x : null, deleted: !!(x && x.deletedAt) }); continue; }
      const m = closestMatch(pool, t, used);
      if (m) { duplicates.push({ tx: t, existing: m.deletedAt ? null : m, deleted: !!m.deletedAt }); continue; }
      if (t.bankRef) seen.add(t.bankRef);
      fresh.push(t);
    }
    return { fresh, duplicates, tooOld };
  }

  /** Voegt opgehaalde transacties toe als één import (zichtbaar en ongedaan te maken zoals een bestand). */
  function applyLinked(state, accountId, planned, info, now) {
    now = now || Date.now();
    const dates = planned.fresh.map(t => t.date).sort();
    const parsed = {
      profile: { id: 'bankkoppeling', name: info.bankName + ' (bankkoppeling)' },
      period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      errors: [], balance: info.balance || null
    };
    const d = new Date(now);
    const label = `Bankkoppeling ${info.bankName} · ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    if (!planned.fresh.length) {
      const acc = state.accounts.find(a => a.id === accountId);
      if (acc && parsed.balance && (!acc.balance || parsed.balance.date >= acc.balance.date)) acc.balance = { date: parsed.balance.date, amount: parsed.balance.amount, source: 'import' };
      return null;
    }
    return apply(state, { fileName: label, fileHash: 'link|' + accountId + '|' + now, fresh: planned.fresh, duplicates: planned.duplicates }, parsed, accountId, now);
  }

  /**
   * Verwijdert transacties. Kwamen ze uit een bestand of de bankkoppeling, dan onthoudt Helder ze,
   * zodat ze bij een volgende import of ophaalbeurt niet terugkomen.
   */
  function removeTransactions(state, ids, now) {
    const set = new Set(ids);
    const at = new Date(now || Date.now()).toISOString();
    const removed = state.transactions.filter(t => set.has(t.id));
    state.deleted = state.deleted || [];
    const entries = [];
    for (const t of removed) {
      // Volledige kopie bewaren, zodat je het altijd kan terugzetten (prullenbak)
      const e = { id: C.uid('del'), accountId: t.accountId, key: rowKey(t), bankRef: t.bankRef || null, date: t.date, amount: t.amount,
        counterparty: t.counterparty || '', description: String(t.description || '').slice(0, 120), importId: t.importId || null, deletedAt: at,
        manual: t.source !== 'import', tx: JSON.parse(JSON.stringify(t)) };
      state.deleted.push(e);
      entries.push(e.id);
    }
    state.transactions = state.transactions.filter(t => !set.has(t.id));
    return { count: removed.length, ids: entries };
  }

  /** Zet verwijderde transacties terug (uit de prullenbak). Geeft het aantal teruggezette transacties. */
  function restoreDeleted(state, ids) {
    const set = new Set(ids);
    let n = 0;
    const have = new Set(state.transactions.map(t => t.id));
    for (const d of (state.deleted || []).filter(x => set.has(x.id))) {
      // Oudere verwijderingen (zonder volledige kopie): opnieuw opbouwen uit wat bewaard werd
      const t = d.tx ? JSON.parse(JSON.stringify(d.tx)) : {
        id: C.uid('tx'), accountId: d.accountId, date: d.date, amount: d.amount, counterparty: d.counterparty || '', counterpartyIban: '',
        description: d.description || '', bankRef: d.bankRef || undefined, categoryId: null, categorySource: null, splits: [],
        source: 'import', importId: d.importId || undefined, transferMode: 'auto', createdAt: Date.parse(d.deletedAt) || Date.now()
      };
      if (!have.has(t.id)) { state.transactions.push(t); have.add(t.id); n++; }
    }
    state.deleted = (state.deleted || []).filter(x => !set.has(x.id));
    return n;
  }

  /** Een verwijderde transactie toch terugzetten bij de volgende import (vergeten). */
  function forgetDeleted(state, id) {
    state.deleted = (state.deleted || []).filter(d => d.id !== id);
  }

  /** Eerste datum met transacties per rekening (enkel rekeningen met transacties). */
  function accountStarts(state) {
    const out = {};
    for (const t of state.transactions) if (t.source === 'import' && (!out[t.accountId] || t.date < out[t.accountId])) out[t.accountId] = t.date;
    return out;
  }

  /** Transacties van vóór de startdatum weghalen (zonder ze te onthouden: zet je de datum vroeger, dan komen ze bij een import terug). */
  function trimBefore(state, from) {
    const before = state.transactions.length;
    state.transactions = state.transactions.filter(t => t.source !== 'import' || t.date >= from);
    return before - state.transactions.length;
  }

  /** Een KBC-export kan meerdere rekeningen bevatten: splits per IBAN. */
  function splitByAccount(parsed) {
    const ibans = parsed.accountIbans.length ? parsed.accountIbans : [null];
    return ibans.map(iban => {
      const txs = parsed.transactions.filter(t => (t.accountIban || null) === iban || (!iban && !t.accountIban));
      const dates = txs.map(t => t.date).sort();
      return Object.assign({}, parsed, {
        accountIban: iban, transactions: txs,
        period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
        balance: endBalance(txs)
      });
    });
  }

  const api = { PROFILES, merchantFromDescription, detect, parse, plan, apply, undo, hashText, rowKey, endBalance, splitByAccount,
    fromEnableBanking, balanceFromEnableBanking, planLinked, applyLinked, isLinkedRef, removeTransactions, restoreDeleted, forgetDeleted, accountStarts, trimBefore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FluxBanks = api;
})(typeof window !== 'undefined' ? window : globalThis);
