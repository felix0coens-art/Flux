/*
 * Helder — kernlogica (zonder DOM).
 * Alle bedragen worden intern als gehele centen opgeslagen: negatief = uitgave, positief = inkomst.
 * Werkt in de browser (window.FluxCore) en in Node (module.exports) voor de tests.
 */
(function (root) {
  'use strict';

  // ---------- Hulpfuncties ----------

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** "1.234,56", "-12,50", "€ 12.50", "+3,4" -> centen (integer) of NaN */
  function parseAmount(input) {
    if (typeof input === 'number') return Math.round(input * 100);
    let s = String(input == null ? '' : input).trim();
    if (!s) return NaN;
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    s = s.replace(/[€\s ]|EUR/gi, '');
    if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); }
    if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
    else if (s.startsWith('+')) s = s.slice(1);
    if (!/^[0-9.,]+$/.test(s)) return NaN;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    let normalized;
    if (lastComma >= 0 && lastDot >= 0) {
      const decSep = lastComma > lastDot ? ',' : '.';
      const thouSep = decSep === ',' ? '.' : ',';
      normalized = s.split(thouSep).join('').replace(decSep, '.');
    } else if (lastComma >= 0) {
      // Belgische notatie: komma is decimaalteken
      normalized = (s.match(/,/g).length > 1) ? s.split(',').join('') : s.replace(',', '.');
    } else if (lastDot >= 0) {
      const parts = s.split('.');
      // "1.234" of "1.234.567" -> duizendtallen; "12.5" / "12.50" -> decimaal
      if (parts.length > 2 || (parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0')) {
        normalized = parts.join('');
      } else normalized = s;
    } else normalized = s;
    const value = Number(normalized);
    if (!isFinite(value)) return NaN;
    const cents = Math.round(value * 100);
    return negative ? -cents : cents;
  }

  const moneyFmt = (typeof Intl !== 'undefined')
    ? new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' })
    : null;

  function formatMoney(cents) {
    const v = (cents || 0) / 100;
    return moneyFmt ? moneyFmt.format(v) : '€ ' + v.toFixed(2).replace('.', ',');
  }

  /** centen -> "12,50" (voor invoervelden) */
  function centsToInput(cents) {
    return (Math.abs(cents || 0) / 100).toFixed(2).replace('.', ',');
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  /** Diverse datumformaten -> "YYYY-MM-DD" of null */
  function parseDate(input) {
    if (!input) return null;
    const s = String(input).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let y = +m[3];
      if (y < 100) y += 2000;
      return valid(y, +m[2], +m[1]);
    }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    return null;
    function valid(y, mo, d) {
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCMonth() !== mo - 1) return null;
      return y + '-' + pad(mo) + '-' + pad(d);
    }
  }

  function toUTC(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function fromUTC(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function daysBetween(a, b) {
    return Math.round((toUTC(b) - toUTC(a)) / 86400000);
  }

  function addDays(dateStr, n) {
    return fromUTC(toUTC(dateStr) + n * 86400000);
  }

  /** Maanden optellen; dag wordt afgekapt op het einde van de maand (31 jan + 1 = 28/29 feb). */
  function addMonths(dateStr, n, preferredDay) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const total = (y * 12 + (m - 1)) + n;
    const ny = Math.floor(total / 12);
    const nm = total % 12;
    const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return ny + '-' + pad(nm + 1) + '-' + pad(Math.min(preferredDay || d, lastDay));
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function normalizeIban(iban) {
    return String(iban || '').replace(/\s+/g, '').toUpperCase();
  }

  function formatIban(iban) {
    return normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim();
  }

  /** Tekst opschonen: kleine letters, zonder accenten, cijfers, leestekens en ruiswoorden. */
  function normalizeText(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2 && !STOP_WORDS.has(t))
      .join(' ');
  }

  /** Naam opschonen om verwante transacties te groeperen ("NETFLIX.COM 8812" -> "netflix"). */
  function normalizeName(str) {
    return normalizeText(str).split(' ').slice(0, 3).join(' ');
  }
  const STOP_WORDS = new Set(['nv', 'bv', 'bvba', 'sa', 'srl', 'sprl', 'vzw', 'the', 'betaling', 'via', 'met', 'kaart',
    'bancontact', 'maestro', 'visa', 'debit', 'europese', 'domiciliering', 'overschrijving', 'naar', 'van',
    'mededeling', 'ref', 'referentie', 'datum', 'uur', 'be', 'nl', 'com', 'www']);

  function median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

  /** Verdeel `total` centen proportioneel over `weights`, zonder afrondingsverlies. */
  function distribute(total, weights) {
    const wsum = sum(weights.map(Math.abs));
    if (!wsum) {
      const out = weights.map(() => 0);
      if (out.length) out[0] = total;
      return out;
    }
    const raw = weights.map(w => total * Math.abs(w) / wsum);
    const floored = raw.map(v => Math.trunc(v));
    let rest = total - sum(floored);
    const order = raw.map((v, i) => [Math.abs(v - floored[i]), i]).sort((a, b) => b[0] - a[0]);
    const step = rest > 0 ? 1 : -1;
    for (let k = 0; rest !== 0 && k < order.length * 2; k++) {
      floored[order[k % order.length][1]] += step;
      rest -= step;
    }
    return floored;
  }

  // ---------- Categorisatieregels ----------

  const RULE_FIELDS = {
    title: 'Eigen titel',
    counterparty: 'Tegenpartij',
    description: 'Mededeling',
    counterpartyIban: 'IBAN tegenpartij',
    any: 'Eender welk veld'
  };
  const RULE_OPERATORS = {
    contains: 'bevat',
    equals: 'is gelijk aan',
    startsWith: 'begint met',
    name: 'naam bevat (ongevoelig voor leestekens)',
    regex: 'komt overeen met (regex)'
  };

  function matchText(operator, haystack, needle, isIban) {
    let h = String(haystack || '');
    let n = String(needle || '');
    if (!n) return false;
    if (isIban) { h = normalizeIban(h); n = normalizeIban(n); }
    if (operator === 'regex') {
      try { return new RegExp(n, 'i').test(h); } catch (e) { return false; }
    }
    if (operator === 'name') {
      const nn = normalizeText(n);
      return !!nn && (' ' + normalizeText(h) + ' ').includes(' ' + nn + ' ');
    }
    h = h.toLowerCase(); n = n.toLowerCase();
    if (operator === 'equals') return h.trim() === n.trim();
    if (operator === 'startsWith') return h.trim().startsWith(n.trim());
    return h.includes(n);
  }

  function ruleMatches(rule, tx) {
    if (!rule || rule.enabled === false) return false;
    if (rule.direction === 'out' && tx.amount >= 0) return false;
    if (rule.direction === 'in' && tx.amount <= 0) return false;
    if (rule.accountId && rule.accountId !== tx.accountId) return false;
    const fields = rule.field === 'any' ? ['title', 'counterparty', 'description', 'counterpartyIban'] : [rule.field];
    return fields.some(f => matchText(rule.operator, tx[f], rule.value, f === 'counterpartyIban'));
  }

  function sortedRules(rules) {
    return (rules || []).slice().sort((a, b) => (a.priority || 0) - (b.priority || 0));
  }

  function findRule(rules, tx) {
    return sortedRules(rules).find(r => ruleMatches(r, tx)) || null;
  }

  /**
   * Past regels toe op alle transacties die niet manueel gecategoriseerd zijn,
   * niet opgesplitst zijn en geen interne overschrijving of terugbetaling zijn.
   * Geeft het aantal gewijzigde transacties terug.
   */
  /** Deel dat een regel als voorschot boekt (zelfde teken als de transactie), of 0. */
  function ruleSharePart(share, amount) {
    if (!share || !String(share.person || '').trim() || !(Number(share.value) > 0)) return 0;
    const abs = Math.abs(amount);
    const part = share.mode === 'amount' ? Math.min(abs, Math.round(Number(share.value))) : Math.round(abs * Math.min(100, Number(share.value)) / 100);
    return part > 0 ? Math.sign(amount) * part : 0;
  }

  function applyRules(state) {
    let changed = 0;
    const rules = sortedRules(state.rules);
    for (const tx of state.transactions) {
      // Een splitsing die een regel maakte, mag die regel ook bijwerken; een eigen splitsing niet
      if (tx.categorySource === 'manual' || tx.categorySource === 'system' || (tx.splits && tx.splits.length && !tx.splitByRule) || tx.isTransfer || tx.refundOf) continue;
      const rule = rules.find(r => (r.categoryId || r.share) && ruleMatches(r, tx));
      const newCat = rule ? rule.categoryId || null : null;
      const newSrc = rule ? 'rule' : null;
      const newRule = rule ? rule.id : null;
      if (tx.categoryId !== newCat || tx.categorySource !== newSrc || tx.ruleId !== newRule) {
        tx.categoryId = newCat;
        tx.categorySource = newSrc;
        tx.ruleId = newRule;
        changed++;
      }
      // Deel als voorschot voor iemand (bv. de helft van Telenet voor je huisgenoot): de rest blijft in de categorie
      const part = rule ? ruleSharePart(rule.share, tx.amount) : 0;
      if (part) {
        const sp = [{ categoryId: SYS_ADVANCE, amount: part, person: String(rule.share.person).trim(), note: rule.share.note || '' }];
        if (JSON.stringify(tx.splits || []) !== JSON.stringify(sp) || tx.splitByRule !== rule.id) { tx.splits = sp; tx.splitByRule = rule.id; changed++; }
      } else if (tx.splitByRule) { tx.splits = []; delete tx.splitByRule; changed++; }
      // Voorschot-regels kunnen ook zeggen voor wie (anders: "Onbekend")
      const person = rule && rule.categoryId === SYS_ADVANCE && rule.person ? String(rule.person).trim() : '';
      if (person) {
        if (tx.person !== person) { tx.person = person; tx.personByRule = true; changed++; }
        else if (!tx.personByRule) tx.personByRule = true;
      } else if (tx.personByRule) { delete tx.person; delete tx.personByRule; changed++; }
    }
    return changed;
  }

  /**
   * Regels die een transactie ook aan een actie koppelen (bv. "Telenet terugvragen", elke maand opnieuw).
   * De actie krijgt een vaste id (per regel, en per maand als je dat koos), zodat elk toestel dezelfde maakt.
   * Wat een regel al eens koppelde, wordt onthouden (ruleActions): haal je het er zelf uit, dan blijft het eruit.
   */
  function applyRuleActions(state) {
    state.actions = state.actions || [];
    let changed = 0;
    for (const rule of state.rules || []) {
      const ra = rule && rule.enabled !== false && rule.action;
      if (!ra || !String(ra.name || '').trim()) continue;
      for (const tx of state.transactions) {
        if (tx.isTransfer || (ra.since && tx.date < ra.since) || (tx.ruleActions || []).includes(rule.id) || !ruleMatches(rule, tx)) continue;
        const month = tx.date.slice(0, 7);
        const id = 'act_r_' + rule.id + (ra.perMonth ? '_' + month : '');
        if (!state.actions.some(a => a.id === id)) {
          const label = MONTH_NAMES[Number(month.slice(5)) - 1] + ' ' + month.slice(0, 4);
          state.actions.push({ id, name: String(ra.name).trim() + (ra.perMonth ? ' — ' + label : ''), expectBack: !!ra.expectBack, person: ra.person || '', note: '', ruleId: rule.id, createdAt: tx.date + 'T00:00:00.000Z' });
        }
        tx.actions = Array.from(new Set((tx.actions || []).concat(id)));
        tx.ruleActions = (tx.ruleActions || []).concat(rule.id);
        changed++;
      }
    }
    return changed;
  }

  // ---------- Interne overschrijvingen ----------

  const TRANSFER_WINDOW_DAYS = 4;

  /**
   * Herkent overschrijvingen tussen eigen rekeningen:
   *  1. IBAN van de tegenpartij is één van je eigen rekeningen;
   *  2. koppelt de twee kanten (zelfde bedrag, tegengesteld teken, andere eigen rekening, binnen enkele dagen).
   * Transacties met transferMode 'yes'/'no' (manueel) worden gerespecteerd.
   */
  function detectTransfers(state) {
    const ownIbans = new Set(state.accounts.map(a => normalizeIban(a.iban)).filter(Boolean));
    const txs = state.transactions;
    for (const tx of txs) {
      const mode = tx.transferMode || 'auto';
      if (mode === 'yes') tx.isTransfer = true;
      else if (mode === 'no') tx.isTransfer = false;
      else tx.isTransfer = ownIbans.has(normalizeIban(tx.counterpartyIban));
      if (!tx.isTransfer) tx.transferPairId = null;
    }
    // Koppel beide kanten
    const byId = new Map(txs.map(t => [t.id, t]));
    for (const tx of txs) {
      if (tx.transferPairId && (!byId.has(tx.transferPairId) || !byId.get(tx.transferPairId).isTransfer)) {
        tx.transferPairId = null;
      }
    }
    const unpaired = txs.filter(t => !t.transferPairId && (t.transferMode || 'auto') !== 'no');
    for (const tx of unpaired) {
      if (tx.transferPairId || !tx.isTransfer) continue;
      const acc = state.accounts.find(a => a.id === tx.accountId);
      const target = state.accounts.find(a => normalizeIban(a.iban) && normalizeIban(a.iban) === normalizeIban(tx.counterpartyIban));
      const match = unpaired.find(o =>
        o !== tx && !o.transferPairId && o.accountId !== tx.accountId &&
        o.amount === -tx.amount &&
        Math.abs(daysBetween(tx.date, o.date)) <= TRANSFER_WINDOW_DAYS &&
        (!target || o.accountId === target.id) &&
        (o.isTransfer || !o.counterpartyIban || (acc && normalizeIban(o.counterpartyIban) === normalizeIban(acc.iban)))
      );
      if (match) {
        if ((match.transferMode || 'auto') === 'auto') match.isTransfer = true;
        tx.transferPairId = match.id;
        match.transferPairId = tx.id;
      }
    }
  }

  // ---------- Opsplitsen en terugbetalingen ----------

  /** Categorielijnen van één transactie (rekening houdend met splitsingen). */
  function splitLines(tx) {
    if (tx.splits && tx.splits.length) {
      const lines = tx.splits.map(s => ({ categoryId: s.categoryId || null, amount: s.amount, note: s.note || '', person: s.person || '' }));
      const rest = tx.amount - sum(lines.map(l => l.amount));
      if (rest !== 0) lines.push({ categoryId: tx.categoryId || null, amount: rest, note: 'rest', person: tx.person || '' });
      return lines;
    }
    return [{ categoryId: tx.categoryId || null, amount: tx.amount, note: '', person: tx.person || '' }];
  }

  /**
   * Splitsingen hebben normaal hetzelfde teken als de transactie. Een lijn met tegengesteld teken
   * mag (bv. € 900 ontvangen = € 1.000 honorarium − € 100 commissie), zolang het totaal niet
   * voorbij het transactiebedrag gaat.
   */
  function validateSplits(tx, splits) {
    const errors = [];
    for (const s of splits) {
      if (!s.categoryId) errors.push('Elke splitsing heeft een categorie nodig.');
      if (!s.amount) errors.push('Elke splitsing heeft een bedrag nodig.');
    }
    const rest = tx.amount - sum(splits.map(s => s.amount));
    if (rest !== 0 && Math.sign(rest) !== Math.sign(tx.amount)) errors.push('Het totaal van de splitsingen is groter dan het transactiebedrag.');
    return Array.from(new Set(errors));
  }

  /**
   * Zet alle transacties om in boekingslijnen per categorie.
   * - Interne overschrijvingen worden weggelaten.
   * - Terugbetalingen worden op de categorie(ën) én de datum van de oorspronkelijke uitgave geboekt,
   *   zodat ze de uitgave verminderen in plaats van als inkomen te tellen.
   */
  /**
   * Hoe elke terugbetaling (refundOf) over de lijnen van de oorspronkelijke uitgave verdeeld wordt.
   * Had je een deel als voorschot geboekt (bv. een cadeau van € 100 waarvan € 85,71 voor de anderen),
   * dan gaat een terugbetaling eerst naar dat voorschot (oudste terugbetaling eerst); enkel wat daarboven
   * komt, vermindert je eigen deel. @returns Map(refundTxId -> [{ categoryId, amount, person, advance, key }])
   */
  function refundAllocation(state) {
    const byId = new Map(state.transactions.map(t => [t.id, t]));
    const groups = new Map();
    for (const tx of state.transactions) {
      if (tx.isTransfer || !tx.refundOf) continue;
      const orig = byId.get(tx.refundOf);
      if (!orig || orig.isTransfer) continue;
      if (!groups.has(orig.id)) groups.set(orig.id, { orig, refunds: [] });
      groups.get(orig.id).refunds.push(tx);
    }
    const out = new Map();
    for (const { orig, refunds } of groups.values()) {
      const lines = splitLines(orig);
      const nSplits = orig.splits && orig.splits.length ? orig.splits.length : 0;
      const keyOfLine = i => orig.id + (i < nSplits ? ':' + i : '');
      const advIdx = lines.map((l, i) => i).filter(i => lines[i].categoryId === SYS_ADVANCE && Math.sign(lines[i].amount) === Math.sign(orig.amount));
      const cap = advIdx.map(i => Math.abs(lines[i].amount));
      const others = lines.map((l, i) => i).filter(i => !advIdx.includes(i));
      refunds.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
      for (const r of refunds) {
        let left = Math.abs(r.amount);
        const sign = Math.sign(r.amount) || 1;
        const res = [];
        advIdx.forEach((i, j) => {
          const take = Math.min(left, cap[j]);
          if (take > 0) { cap[j] -= take; left -= take; res.push({ categoryId: SYS_ADVANCE, amount: sign * take, person: lines[i].person || orig.person || '', advance: true, key: keyOfLine(i) }); }
        });
        if (left > 0) {
          const base = others.length ? others : lines.map((l, i) => i);
          const parts = distribute(sign * left, base.map(i => lines[i].amount));
          base.forEach((i, k) => { if (parts[k]) res.push({ categoryId: lines[i].categoryId, amount: parts[k], person: lines[i].person || '', advance: lines[i].categoryId === SYS_ADVANCE, key: keyOfLine(i) }); });
        }
        out.set(r.id, res);
      }
    }
    return out;
  }

  function allocations(state) {
    const byId = new Map(state.transactions.map(t => [t.id, t]));
    const refunds = refundAllocation(state);
    const lines = [];
    for (const tx of state.transactions) {
      if (tx.isTransfer) continue;
      const orig = tx.refundOf ? byId.get(tx.refundOf) : null;
      if (orig && !orig.isTransfer) {
        for (const p of (refunds.get(tx.id) || [])) lines.push({ txId: tx.id, date: orig.date, categoryId: p.categoryId, amount: p.amount, refund: true, accountId: tx.accountId, person: p.person || undefined });
        continue;
      }
      for (const l of splitLines(tx)) {
        lines.push({ txId: tx.id, date: tx.date, categoryId: l.categoryId, amount: l.amount, refund: false, accountId: tx.accountId, person: l.person });
      }
    }
    // Verrekende of kwijtgescholden voorschotten (niet in geld terugbetaald): het voorschot is "terugbetaald" door een uitgave in de gekozen categorie
    // Te veel terugbetaald: dat deel wordt een inkomst in de gekozen categorie
    for (const x of surplusList(state)) {
      lines.push({ txId: null, surplusId: x.id, date: x.date, categoryId: SYS_ADVANCE, amount: -x.amount, refund: false, person: x.person, surplus: true });
      lines.push({ txId: null, surplusId: x.id, date: x.date, categoryId: x.categoryId || null, amount: x.amount, refund: false, person: x.person, surplus: true });
    }
    for (const f of forgivenList(state)) {
      lines.push({ txId: null, forgiveId: f.id, date: f.date, categoryId: SYS_ADVANCE, amount: f.amount, refund: false, person: f.person, forgiven: true });
      lines.push({ txId: null, forgiveId: f.id, date: f.date, categoryId: f.categoryId || null, amount: -f.amount, refund: false, person: f.person, forgiven: true });
    }
    return lines;
  }

  /** Alle kwijtgescholden bedragen (bewaard bij de persoon): [{ id, person, date, amount (centen, +), categoryId, note }] */
  function forgivenList(state) {
    const out = [];
    for (const p of state.people || []) {
      for (const f of p.forgiven || []) {
        if (f && f.amount > 0 && parseDate(f.date)) out.push(Object.assign({}, f, { person: p.name }));
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Totale terugbetaald bedrag per oorspronkelijke transactie-id. */
  function refundTotals(state) {
    const out = {};
    for (const tx of state.transactions) {
      if (tx.refundOf && !tx.isTransfer) out[tx.refundOf] = (out[tx.refundOf] || 0) + tx.amount;
    }
    return out;
  }

  const REFUND_KEYWORDS = /tikkie|payconiq|terugbetal|terugstort|refund|retour|remboursement|wero|lydia|splitwise|delen|deel van/i;

  /** Stelt originele uitgaven voor waaraan een inkomende betaling als terugbetaling gekoppeld kan worden. */
  function suggestRefundTargets(state, tx, limit) {
    if (!tx || tx.amount <= 0) return [];
    const refunded = refundTotals(state);
    const keyword = REFUND_KEYWORDS.test((tx.description || '') + ' ' + (tx.counterparty || ''));
    const txName = normalizeName(tx.counterparty);
    return state.transactions
      .filter(o => o.id !== tx.id && o.amount < 0 && !o.isTransfer && !o.refundOf)
      .map(o => {
        const age = daysBetween(o.date, tx.date);
        if (age < -3 || age > 90) return null;
        const openAmount = -o.amount - Math.max(0, (refunded[o.id] || 0) - (tx.refundOf === o.id ? tx.amount : 0));
        if (openAmount < tx.amount) return null;
        let score = 100 - age;
        if (keyword) score += 30;
        if (txName && normalizeName(o.counterparty) === txName) score += 40;
        if (-o.amount === tx.amount) score += 50; // exact hetzelfde bedrag: wellicht een annulering
        const ratio = tx.amount / -o.amount;
        if (ratio > 0.2 && ratio < 0.9) score += 15; // typisch "deel" van een rekening
        return { tx: o, score, openAmount };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit || 8);
  }

  /**
   * Inkomsten met exact hetzelfde bedrag als een eerdere uitgave: meestal een geannuleerde bestelling
   * of een terugstorting. Elke uitgave en inkomst hoogstens één keer; zelfde tegenpartij eerst.
   */
  function cancellationPairs(state) {
    const refunded = refundTotals(state);
    const special = t => t.isTransfer || (t.splits && t.splits.length) || t.categoryId === SYS_ADVANCE || t.categoryId === SYS_INVEST;
    const byAmount = new Map();
    for (const o of state.transactions) {
      if (o.amount >= 0 || o.refundOf || refunded[o.id] || special(o)) continue;
      if (!byAmount.has(-o.amount)) byAmount.set(-o.amount, []);
      byAmount.get(-o.amount).push(o);
    }
    const cands = [];
    for (const t of state.transactions) {
      if (t.amount <= 0 || t.refundOf || special(t) || (t.categoryId && t.categorySource === 'manual')) continue;
      const name = normalizeName(t.counterparty);
      for (const o of byAmount.get(t.amount) || []) {
        if ((t.notRefundOf || []).includes(o.id)) continue;
        const days = daysBetween(o.date, t.date);
        const sameName = !!name && normalizeName(o.counterparty) === name;
        if (days < 0 || days > (sameName ? 60 : 7)) continue;
        cands.push({ income: t, expense: o, days, sameName, score: (sameName ? 100 : 0) + (o.accountId === t.accountId ? 10 : 0) - days });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const used = new Set();
    const out = [];
    for (const c of cands) {
      if (used.has(c.income.id) || used.has(c.expense.id)) continue;
      used.add(c.income.id); used.add(c.expense.id);
      out.push({ income: c.income, expense: c.expense, days: c.days, sameName: c.sameName });
    }
    return out.sort((a, b) => b.income.date.localeCompare(a.income.date));
  }

  function looksLikeRefund(tx) {
    return tx.amount > 0 && !tx.refundOf && !tx.isTransfer && REFUND_KEYWORDS.test((tx.description || '') + ' ' + (tx.counterparty || ''));
  }

  // ---------- Periodes en overzichten ----------

  function periodRange(period, refDate) {
    const [y, m] = refDate.split('-').map(Number);
    if (period === 'yearly') return { start: y + '-01-01', end: y + '-12-31', label: String(y) };
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { start: y + '-' + pad(m) + '-01', end: y + '-' + pad(m) + '-' + pad(last), label: y + '-' + pad(m) };
  }

  function inRange(date, range) { return date >= range.start && date <= range.end; }

  /**
   * Inkomsten, kosten op inkomsten, uitgaven en saldo voor een periode.
   * - Categorie van soort 'income' = inkomstenbron (bruto).
   * - Uitgavecategorie met `incomeId` = kost die van die inkomstenbron wordt afgetrokken.
   * - Netto inkomen = bruto − kosten op inkomsten; saldo = netto inkomen − gewone uitgaven.
   */
  function summarize(state, range, lines) {
    lines = lines || allocations(state);
    const cats = new Map(state.categories.map(c => [c.id, c]));
    const byCategory = {};
    const byIncome = {};
    const expenseBy = {}; // effectieve uitgaven per categorie (na terugbetalingen), zelfde telling als 'expenses'
    const src = id => (byIncome[id] = byIncome[id] || { gross: 0, costs: 0, net: 0, costsByCategory: {} });
    let income = 0, incomeCosts = 0, expenses = 0, advanced = 0, repaid = 0, invested = 0;
    for (const l of lines) {
      if (!inRange(l.date, range)) continue;
      const key = l.categoryId || '__none__';
      byCategory[key] = (byCategory[key] || 0) + l.amount;
      const c = l.categoryId ? cats.get(l.categoryId) : null;
      const kind = c ? c.kind : (l.amount > 0 ? 'income' : 'expense');
      if (kind === 'advance') {
        // Voorgeschoten voor iemand anders / terugbetaald: geen inkomen, geen uitgave
        if (l.amount < 0) advanced -= l.amount; else repaid += l.amount;
      } else if (kind === 'investment') {
        invested -= l.amount;
      } else if (kind === 'income') {
        income += l.amount;
        src(c ? c.id : '__none__').gross += l.amount;
      } else if (c && c.incomeId && cats.has(c.incomeId)) {
        incomeCosts -= l.amount;
        const s = src(c.incomeId);
        s.costs -= l.amount;
        s.costsByCategory[c.id] = (s.costsByCategory[c.id] || 0) - l.amount;
      } else {
        expenses -= l.amount;
        expenseBy[key] = (expenseBy[key] || 0) - l.amount;
      }
    }
    for (const k of Object.keys(byIncome)) byIncome[k].net = byIncome[k].gross - byIncome[k].costs;
    let transfers = 0;
    for (const tx of state.transactions) {
      if (tx.isTransfer && tx.amount < 0 && inRange(tx.date, range)) transfers -= tx.amount;
    }
    const netIncome = income - incomeCosts;
    return { income, incomeCosts, netIncome, expenses, net: netIncome - expenses, byCategory, expenseBy, byIncome, transfers, advanced, repaid, invested };
  }

  // ---------- Budgetten ----------

  function budgetStatus(state, budget, refDate, lines) {
    lines = lines || allocations(state);
    const range = periodRange(budget.period, refDate);
    let spent = 0;
    for (const l of lines) {
      if (l.categoryId === budget.categoryId && inRange(l.date, range)) spent -= l.amount;
    }
    const limit = budget.limit;
    const pct = limit > 0 ? spent / limit : 0;
    const warnAt = budget.warnAt != null ? budget.warnAt : 0.8;
    const totalDays = daysBetween(range.start, range.end) + 1;
    const today = todayStr();
    let elapsedDays;
    if (today < range.start) elapsedDays = 0;
    else if (today > range.end) elapsedDays = totalDays;
    else elapsedDays = daysBetween(range.start, today) + 1;
    const elapsed = elapsedDays / totalDays;
    const daysLeft = totalDays - elapsedDays;
    const remaining = limit - spent;
    let status = 'ok';
    if (spent > limit) status = 'over';
    else if (pct >= warnAt) status = 'warn';
    const projected = elapsed > 0 ? Math.round(spent / elapsed) : spent;
    return {
      budget, range, spent, limit, remaining, pct, status, elapsed, daysLeft,
      projected,
      onPace: elapsed > 0 ? pct <= elapsed + 0.05 : true,
      perDayLeft: daysLeft > 0 && remaining > 0 ? Math.floor(remaining / daysLeft) : 0
    };
  }

  // ---------- Terugkerende kosten ----------

  const FREQUENCIES = [
    { id: 'weekly', label: 'Wekelijks', days: 7, min: 5, max: 9, months: 12 / 52 },
    { id: 'monthly', label: 'Maandelijks', days: 30.4, min: 25, max: 36, months: 1 },
    { id: 'bimonthly', label: 'Tweemaandelijks', days: 61, min: 54, max: 70, months: 2 },
    { id: 'quarterly', label: 'Per kwartaal', days: 91, min: 80, max: 105, months: 3 },
    { id: 'halfyearly', label: 'Halfjaarlijks', days: 182, min: 165, max: 200, months: 6 },
    { id: 'yearly', label: 'Jaarlijks', days: 365, min: 330, max: 400, months: 12 }
  ];

  const MONTH_NAMES = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

  function recurringKey(tx) {
    const name = normalizeName(tx.counterparty) || normalizeName(tx.description);
    const iban = normalizeIban(tx.counterpartyIban);
    return name || iban || null;
  }

  /**
   * Detecteert vaste lasten en abonnementen uit de transactiegeschiedenis.
   * Groepeert uitgaven per tegenpartij, zoekt een regelmatig interval en berekent
   * volgende vervaldatum, vaste/variabele bedragen en seizoenspatronen.
   */
  function detectRecurring(state, today, options) {
    today = today || todayStr();
    const incoming = !!(options && options.direction === 'in');
    const overrides = state.subscriptions || {};
    const groups = new Map();
    for (const tx of state.transactions) {
      if (tx.isTransfer || tx.excludeRecurring || tx.refundOf) continue;
      if (tx.categoryId === 'sys_belegging' || tx.categoryId === 'sys_voorschot') continue; // geen vaste last of inkomen
      if (incoming ? tx.amount <= 0 : tx.amount >= 0) continue;
      const base = recurringKey(tx);
      if (!base) continue;
      const key = incoming ? 'in:' + base : base;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tx);
    }
    const results = [];
    for (const [key, txsRaw] of groups) {
      const txs = txsRaw.slice().sort((a, b) => a.date.localeCompare(b.date));
      // Meerdere betalingen op dezelfde dag samenvoegen
      const events = [];
      for (const t of txs) {
        const last = events[events.length - 1];
        const amt = Math.abs(t.amount);
        if (last && last.date === t.date) { last.amount += amt; last.txs.push(t); }
        else events.push({ date: t.date, amount: amt, txs: [t] });
      }
      if (events.length < 2) continue;
      const intervals = [];
      for (let i = 1; i < events.length; i++) intervals.push(daysBetween(events[i - 1].date, events[i].date));
      const med = median(intervals);
      const freq = FREQUENCIES.find(f => med >= f.min && med <= f.max);
      if (!freq) continue;
      const minEvents = freq.months >= 6 ? 2 : 3;
      if (events.length < minEvents) continue;
      const regular = intervals.filter(d => d >= freq.min * 0.85 && d <= freq.max * 1.15).length / intervals.length;
      if (regular < 0.7) continue;

      const amounts = events.map(e => e.amount);
      const avg = sum(amounts) / amounts.length;
      const sd = Math.sqrt(sum(amounts.map(a => (a - avg) ** 2)) / amounts.length);
      const cv = avg ? sd / avg : 0;
      // Te variabele bedragen bij hoge frequentie = gewoon vaak winkelen, geen vaste last
      if (freq.id === 'weekly' && cv > 0.25) continue;
      if (freq.id === 'monthly' && cv > 0.6 && events.length < 6) continue;
      if (incoming && cv > 0.6) continue;

      const last = events[events.length - 1];
      const dayOfMonth = events.length >= 3
        ? median(events.slice(-6).map(e => Number(e.date.slice(8, 10))))
        : Number(last.date.slice(8, 10));
      let nextDue;
      if (freq.id === 'weekly') nextDue = addDays(last.date, 7);
      else nextDue = addMonths(last.date, freq.months, Math.round(dayOfMonth));
      // Ingehaalde vervaldagen doorschuiven (bv. als de import achterloopt is dit "gemist")
      const grace = freq.id === 'weekly' ? 3 : freq.id === 'monthly' ? 7 : 20;
      const daysUntil = daysBetween(today, nextDue);
      let status = 'actief';
      if (daysUntil < -grace) status = daysUntil < -(freq.days * 2) ? 'gestopt' : 'gemist';
      else if (daysUntil <= 7) status = 'binnenkort';

      // Seizoenspatroon: bedrag per kalendermaand vergelijken (winter = nov-mrt, zomer = mei-sep)
      const byMonth = Array.from({ length: 12 }, () => []);
      for (const e of events) byMonth[Number(e.date.slice(5, 7)) - 1].push(e.amount);
      const monthAvg = byMonth.map(a => a.length ? sum(a) / a.length : null);
      let seasonal = null;
      const winter = [10, 11, 0, 1, 2].map(i => monthAvg[i]).filter(v => v != null);
      const summer = [4, 5, 6, 7, 8].map(i => monthAvg[i]).filter(v => v != null);
      if (freq.months <= 3 && winter.length >= 2 && summer.length >= 2) {
        const w = sum(winter) / winter.length, s = sum(summer) / summer.length;
        if (w > s * 1.35) seasonal = { label: 'Hoger in de winter', ratio: w / s };
        else if (s > w * 1.35) seasonal = { label: 'Hoger in de zomer', ratio: s / w };
      }
      if (freq.months === 12) {
        seasonal = { label: 'Jaarlijks in ' + MONTH_NAMES[Number(last.date.slice(5, 7)) - 1], ratio: 1 };
      }
      const nextMonthIdx = Number(nextDue.slice(5, 7)) - 1;
      let expected = cv < 0.05 ? last.amount : Math.round(avg);
      if (seasonal && seasonal.ratio > 1 && monthAvg[nextMonthIdx] != null) expected = Math.round(monthAvg[nextMonthIdx]);

      // Meest voorkomende categorie
      const catCount = {};
      for (const t of txs) if (t.categoryId) catCount[t.categoryId] = (catCount[t.categoryId] || 0) + 1;
      const categoryId = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a])[0] || null;

      const ov = overrides[key] || {};
      results.push({
        key,
        name: ov.name || txs[txs.length - 1].counterparty || txs[txs.length - 1].description || key,
        frequency: freq,
        count: events.length,
        firstDate: events[0].date,
        lastDate: last.date,
        lastAmount: last.amount,
        avgAmount: Math.round(avg),
        minAmount: Math.min.apply(null, amounts),
        maxAmount: Math.max.apply(null, amounts),
        fixed: cv < 0.05,
        variation: cv,
        nextDue,
        daysUntil,
        expected,
        status,
        seasonal,
        monthProfile: monthAvg.map(v => v == null ? null : Math.round(v)),
        monthlyCost: Math.round(avg / freq.months),
        categoryId,
        direction: incoming ? 'in' : 'out',
        userStatus: ov.status || 'detected', // detected | confirmed | ignored
        txIds: txs.map(t => t.id)
      });
    }
    return results.sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  }

  // ---------- CSV-import ----------

  /**
   * Scheidingsteken: het teken dat op één regel het vaakst voorkomt (de kopregel). Sommige banken
   * (bv. Belfius) zetten eerst enkele infolijnen met bedragen als "10.250,00" boven de tabel.
   */
  function detectDelimiter(text) {
    const best = { ';': 0, ',': 0, '\t': 0 };
    for (const line of text.split(/\r?\n/).slice(0, 30)) {
      const counts = { ';': 0, ',': 0, '\t': 0 };
      let inQ = false;
      for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        else if (!inQ && ch in counts) counts[ch]++;
      }
      for (const k of Object.keys(counts)) best[k] = Math.max(best[k], counts[k]);
    }
    return Object.keys(best).sort((a, b) => best[b] - best[a])[0];
  }

  function parseCSV(text, delimiter) {
    text = String(text || '').replace(/^﻿/, '');
    delimiter = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delimiter) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(c => c.trim() !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(c => c.trim() !== '')) rows.push(row);
    return { delimiter, rows };
  }

  const HEADER_HINTS = {
    date: [/^datum$/, /boekingsdatum/, /uitvoeringsdatum/, /^date$/, /transactiedatum/, /valutadatum/, /datum/],
    amount: [/^bedrag$/, /^amount$/, /bedrag/, /montant/],
    debit: [/^debet$/, /^debit$/, /af$/],
    credit: [/^credit$/, /^bij$/],
    counterparty: [/naam tegenpartij/, /^tegenpartij$/, /naam van de tegenpartij/, /begunstigde/, /naam/, /tegenpartij/, /counterparty/, /^name$/],
    counterpartyIban: [/rekening tegenpartij/, /rekeningnummer tegenpartij/, /iban tegenpartij/, /tegenrekening/, /rekening van de tegenpartij/, /counterparty account/],
    description: [/vrije mededeling/, /^mededeling$/, /mededeling/, /omschrijving/, /description/, /details/, /communicatie/],
    sign: [/^af\/bij$/, /af bij/, /debet\/credit/]
  };

  function guessMapping(headers) {
    const lower = headers.map(h => String(h || '').trim().toLowerCase());
    const mapping = {};
    const used = new Set();
    for (const field of ['counterpartyIban', 'date', 'amount', 'debit', 'credit', 'sign', 'counterparty', 'description']) {
      for (const re of HEADER_HINTS[field]) {
        const idx = lower.findIndex((h, i) => !used.has(i) && re.test(h));
        if (idx >= 0) { mapping[field] = idx; used.add(idx); break; }
      }
    }
    return mapping;
  }

  function cell(row, idx) { return idx == null || idx < 0 ? '' : String(row[idx] == null ? '' : row[idx]).trim(); }

  /** Zet CSV-rijen om in transacties volgens een kolomtoewijzing. */
  function rowsToTransactions(rows, mapping, accountId) {
    const out = [], errors = [];
    rows.forEach((row, i) => {
      const date = parseDate(cell(row, mapping.date));
      let amount = NaN;
      if (mapping.amount != null && mapping.amount >= 0) {
        amount = parseAmount(cell(row, mapping.amount));
        const sign = cell(row, mapping.sign).toLowerCase();
        if (sign && /^(af|d|debet|debit|-)/.test(sign) && amount > 0) amount = -amount;
      } else {
        const d = parseAmount(cell(row, mapping.debit));
        const c = parseAmount(cell(row, mapping.credit));
        if (!isNaN(d) && d !== 0) amount = -Math.abs(d);
        else if (!isNaN(c)) amount = Math.abs(c);
      }
      if (!date || isNaN(amount)) { errors.push(i); return; }
      out.push({
        id: uid('tx'),
        accountId,
        date,
        amount,
        counterparty: cell(row, mapping.counterparty),
        counterpartyIban: normalizeIban(cell(row, mapping.counterpartyIban)),
        description: cell(row, mapping.description).replace(/\s+/g, ' '),
        categoryId: null,
        categorySource: null,
        splits: [],
        source: 'import',
        transferMode: 'auto'
      });
    });
    return { transactions: out, errors };
  }

  function fingerprint(tx) {
    return [tx.accountId, tx.date, tx.amount, normalizeName(tx.description).slice(0, 30), normalizeIban(tx.counterpartyIban)].join('|');
  }

  /** Filtert dubbels weg (rekening houdend met échte identieke transacties op dezelfde dag). */
  function dedupe(existing, incoming) {
    const counts = new Map();
    for (const t of existing) counts.set(fingerprint(t), (counts.get(fingerprint(t)) || 0) + 1);
    const seen = new Map();
    const fresh = [], duplicates = [];
    for (const t of incoming) {
      const fp = fingerprint(t);
      const n = (seen.get(fp) || 0) + 1;
      seen.set(fp, n);
      if (n <= (counts.get(fp) || 0)) duplicates.push(t); else fresh.push(t);
    }
    return { fresh, duplicates };
  }

  // ---------- Symbolen per categorie ----------

  const CATEGORY_ICONS = {
    cat_boodschappen: '🛒', cat_huishouden: '🧺', cat_wonen: '🏠', cat_nuts: '💡', cat_abonnementen: '📺', cat_telecom: '📱',
    cat_uitgaan: '🍽️', cat_vervoer: '🚗', cat_gezondheid: '🩺', cat_kleding: '👕', cat_vrijetijd: '🎨', cat_verzekering: '🛡️',
    cat_belasting: '🏛️', cat_cadeaus: '🎁', cat_onderwijs: '🎓', cat_overig: '📦', sys_voorschot: '🤝', sys_belegging: '📈',
    cat_loon: '💼', cat_bijberoep: '🧾', cat_inkomsten: '💶', cat_kost_bijberoep: '🧰'
  };
  const ICON_WORDS = [
    [/huisdier|dieren|hond|kat\b|dierenarts/, '🐾'], [/sport|fitness|gym/, '🏋️'], [/reis|vakantie|hotel/, '✈️'], [/sparen|spaar/, '🐷'],
    [/boodschap|supermarkt|voeding|eten\b/, '🛒'], [/verhuur|huurinkomst/, '🔑'], [/huur|wonen|huis|lening|hypothe|renovatie/, '🏠'],
    [/loon|salaris|wedde|werkgever/, '💼'], [/bijberoep|freelance|factuur|zelfstandig/, '🧾'], [/dividend|rente|beleg|aandel/, '📈'],
    [/brandstof|tank|auto|wagen|parkeer/, '🚗'], [/trein|bus|tram|openbaar vervoer|fiets/, '🚆'], [/kind|school|opvang|onderwijs|studie/, '🎓'],
    [/gezond|dokter|apothe|tandarts|zieken/, '🩺'], [/kleding|kleren|schoen/, '👕'], [/abonnement|streaming|netflix/, '📺'],
    [/cadeau|gift|goede doel/, '🎁'], [/restaurant|uitgaan|cafe|café|bar\b|horeca|koffie/, '🍽️'], [/energie|elektri|gas\b|water|nuts/, '💡'],
    [/telefoon|internet|gsm|telecom/, '📱'], [/verzeker/, '🛡️'], [/belasting|overheid|boete/, '🏛️'], [/hobby|vrije tijd|ontspanning|muziek/, '🎨'],
    [/huishoud|meubel|tuin/, '🧺'], [/kapper|verzorging|beauty/, '💇'], [/boek|lezen/, '📚'], [/game|gaming/, '🎮'], [/kost/, '🧰']
  ];
  /** Symbool van een categorie: zelf gekozen, standaard, of geraden uit de naam. */
  function categoryIcon(c) {
    if (!c) return '❔';
    if (c.icon) return c.icon;
    if (CATEGORY_ICONS[c.id]) return CATEGORY_ICONS[c.id];
    const n = String(c.name || '').toLowerCase();
    for (const [re, icon] of ICON_WORDS) if (re.test(n)) return icon;
    return c.kind === 'income' ? '💶' : '🏷️';
  }
  const ICON_CHOICES = ['🛒', '🧺', '🏠', '🔑', '💡', '📺', '📱', '🍽️', '☕', '🚗', '🚆', '⛽', '✈️', '🩺', '💊', '👕', '🎨', '🎮', '📚', '🏋️', '🐾', '🛡️', '🏛️', '🎁',
    '🎓', '👶', '💇', '🐷', '📦', '🏷️', '💼', '🧾', '💶', '📈', '🧰', '🤝', '🎵', '🍺', '🌱', '🔧'];

  // ---------- Volledige herberekening ----------

  /** Na elke wijziging: transfers herkennen, ongeldige koppelingen opruimen en regels toepassen. */
  function recompute(state) {
    const ids = new Set(state.transactions.map(t => t.id));
    for (const tx of state.transactions) {
      if (tx.refundOf && !ids.has(tx.refundOf)) tx.refundOf = null;
      if (tx.advanceOf && !ids.has(String(tx.advanceOf).split(':')[0])) tx.advanceOf = null;
      if (tx.actions && tx.actions.length) {
        const known = new Set((state.actions || []).map(a => a.id));
        const keep = tx.actions.filter(id => known.has(id));
        if (keep.length !== tx.actions.length) { if (keep.length) tx.actions = keep; else delete tx.actions; }
      }
      if (tx.categoryId && !state.categories.some(c => c.id === tx.categoryId)) { tx.categoryId = null; tx.categorySource = null; }
      if (tx.splits) tx.splits = tx.splits.filter(s => state.categories.some(c => c.id === s.categoryId));
    }
    detectTransfers(state);
    detectInvestments(state);
    applyRules(state);
    applyRuleActions(state);
    return state;
  }

  // ---------- Beleggingen, voorschotten, saldo ----------

  const SYS_ADVANCE = 'sys_voorschot';
  const SYS_INVEST = 'sys_belegging';

  /**
   * Overschrijvingen naar/van je beleggingsrekening (standaard: Degiro / flatex) zijn geen
   * uitgave of inkomen maar een belegging. Manuele keuzes worden gerespecteerd.
   */
  function detectInvestments(state) {
    const pattern = (state.settings && state.settings.investPattern) || 'degiro|flatex|saxo';
    let re = null;
    try { re = new RegExp(pattern, 'i'); } catch (e) { re = null; }
    const hasCat = state.categories.some(c => c.id === SYS_INVEST);
    for (const tx of state.transactions) {
      if (tx.categorySource === 'manual' || (tx.splits && tx.splits.length) || tx.isTransfer || tx.refundOf) continue;
      const hit = hasCat && re && re.test((tx.counterparty || '') + ' ' + (tx.description || ''));
      if (hit) { tx.categoryId = SYS_INVEST; tx.categorySource = 'system'; tx.ruleId = null; }
      else if (tx.categorySource === 'system') { tx.categoryId = null; tx.categorySource = null; }
    }
  }

  /**
   * Soort van een transactie, voor een duidelijke weergave:
   * todo (nog te verwerken) | income | expense | transfer | investment | advance (voorgeschoten) |
   * repayment (terugbetaald voorschot) | refund (terugbetaling van een uitgave) | split
   */
  function txKind(tx, categories) {
    if (tx.isTransfer) return 'transfer';
    if (tx.refundOf) return 'refund';
    const cats = categories instanceof Map ? categories : new Map((categories || []).map(c => [c.id, c]));
    const kinds = new Set(splitLines(tx).map(l => {
      const c = l.categoryId ? cats.get(l.categoryId) : null;
      if (!c) return 'todo';
      if (c.kind === 'advance') return tx.amount < 0 ? 'advance' : 'repayment';
      if (c.kind === 'investment') return 'investment';
      return c.kind === 'income' ? 'income' : 'expense';
    }));
    if (kinds.size > 1) return kinds.has('todo') ? 'todo' : 'split';
    return kinds.values().next().value;
  }

  /**
   * Voorschotten: wat je voor iemand anders betaalde en wat je terugkreeg.
   * Een terugbetaling kan gekoppeld zijn aan een specifiek voorschot (advanceOf) of enkel aan een persoon;
   * in dat laatste geval wordt ze op de oudste openstaande voorschotten van die persoon afgeboekt.
   */
  function advancesOverview(state) {
    const items = [];
    const repayments = [];
    const keyOf = it => it.txId + (it.split != null ? ':' + it.split : '');
    for (const tx of state.transactions) {
      if (tx.isTransfer) continue;
      splitLines(tx).forEach((l, splitIndex) => {
        if (l.categoryId !== SYS_ADVANCE) return;
        const person = (l.person || tx.person || '').trim() || 'Onbekend';
        const split = !!(tx.splits && tx.splits.length) && splitIndex < tx.splits.length ? splitIndex : null;
        // Titel: wat je zelf gaf (titel van de transactie of notitie van de splitsing)
        const title = (split != null ? (l.note || '') : (tx.title || '')).trim();
        if (l.amount < 0) {
          const it = { txId: tx.id, split, date: tx.date, person, amount: -l.amount, repaid: 0, forgiven: 0, title, note: l.note || tx.description || tx.counterparty || '', counterparty: tx.counterparty || '', settledBy: [] };
          it.key = keyOf(it);
          items.push(it);
        } else repayments.push({ kind: 'repayment', txId: tx.id, ref: tx.id, date: tx.date, person, amount: l.amount, advanceOf: tx.advanceOf || null, title: (tx.title || '').trim(), counterparty: tx.counterparty || '', settles: [] });
      });
    }
    // Terugbetalingen gekoppeld aan een uitgave met een voorschot-deel: vereffenen dat voorschot
    const refundAlloc = refundAllocation(state);
    for (const tx of state.transactions) {
      for (const p of (refundAlloc.get(tx.id) || [])) {
        if (!p.advance || !(p.amount > 0)) continue;
        repayments.push({ kind: 'repayment', txId: tx.id, ref: tx.id, date: tx.date, person: (p.person || '').trim() || 'Onbekend', amount: p.amount, advanceOf: p.key, title: (tx.title || '').trim(), counterparty: tx.counterparty || '', settles: [], viaRefund: true });
      }
    }
    // Kwijtschelden telt als terugbetaling (zonder geld)
    const forgivenBy = {};
    for (const f of forgivenList(state)) {
      repayments.push({ kind: 'forgiven', reason: f.reason === 'settled' ? 'settled' : 'gift', txId: null, ref: 'fg:' + f.id, forgiveId: f.id, date: f.date, person: f.person, amount: f.amount, advanceOf: f.advanceOf || null, forgiven: true, title: f.note || '', categoryId: f.categoryId, settles: [] });
      const k = f.person.toLowerCase();
      forgivenBy[k] = (forgivenBy[k] || 0) + f.amount;
    }
    items.sort((a, b) => a.date.localeCompare(b.date));
    repayments.sort((a, b) => a.date.localeCompare(b.date));
    const settle = (r, it, take) => {
      it.repaid += take;
      if (r.forgiven) it.forgiven += take;
      it.settledBy.push({ ref: r.ref, kind: r.kind, reason: r.reason, date: r.date, amount: take, title: r.title || r.counterparty || '' });
      r.settles.push({ key: it.key, amount: take, title: it.title || it.counterparty || '' });
    };
    // Eerst wat je zelf koppelde aan een voorschot, dan de rest per persoon (oudste voorschot eerst)
    const unassigned = [];
    for (const r of repayments) {
      let left = r.amount;
      if (r.advanceOf) {
        // "txId" of "txId:splitnummer" (één voorschotlijn in een gesplitste betaling)
        const [id, sp] = String(r.advanceOf).split(':');
        for (const it of items.filter(i => i.txId === id && (sp == null || String(i.split) === sp))) {
          const take = Math.min(left, it.amount - it.repaid);
          if (take > 0) { settle(r, it, take); left -= take; }
        }
      }
      if (left > 0) unassigned.push({ r, left });
    }
    // Exact hetzelfde bedrag als een open voorschot van die persoon? Dan hoort het daar bijna zeker bij
    // (bv. € 900 terug voor het voorschot van € 900), ook als er oudere voorschotten open staan.
    for (const u of unassigned) {
      if (u.r.kind !== 'repayment') continue;
      const cands = items.filter(i => i.person.toLowerCase() === u.r.person.toLowerCase() && i.repaid === 0 && i.amount === u.left);
      if (!cands.length) continue;
      const best = cands.sort((a, b) => Math.abs(daysBetween(a.date, u.r.date)) - Math.abs(daysBetween(b.date, u.r.date)))[0];
      settle(u.r, best, u.left);
      u.left = 0;
    }
    const credit = {};
    for (const u of unassigned) {
      let left = u.left;
      if (left <= 0) continue;
      for (const it of items.filter(i => i.person.toLowerCase() === u.r.person.toLowerCase())) {
        if (left <= 0) break;
        const take = Math.min(left, it.amount - it.repaid);
        if (take > 0) { settle(u.r, it, take); left -= take; }
      }
      if (left > 0) { u.r.surplus = left; credit[u.r.person] = (credit[u.r.person] || 0) + left; } // meer terug dan voorgeschoten
    }
    const people = {};
    const personOf = name => {
      const k = Object.keys(people).find(n => n.toLowerCase() === name.toLowerCase()) || name;
      return people[k] = people[k] || { person: k, advanced: 0, repaid: 0, open: 0, items: [], booked: 0 };
    };
    for (const it of items) {
      const p = personOf(it.person);
      p.advanced += it.amount; p.repaid += it.repaid; p.open += it.amount - it.repaid; p.items.push(it);
    }
    for (const [person, amount] of Object.entries(credit)) {
      const p = personOf(person);
      p.repaid += amount; p.open -= amount;
    }
    // Te veel terugbetaald en als inkomst ingeboekt: staat niet meer open
    for (const x of surplusList(state)) { const p = personOf(x.person); p.booked += x.amount; p.open += x.amount; }
    // "terugbetaald" = echt geld terug; wat je kwijtschold staat apart
    for (const p of Object.values(people)) {
      p.forgiven = forgivenBy[p.person.toLowerCase()] || 0;
      p.repaid -= p.forgiven;
      // Rekening-courant: alle bewegingen op datum, met lopend saldo (wat de persoon je nog schuldig is)
      const lc = p.person.toLowerCase();
      const rows = p.items.map(it => ({ kind: 'advance', date: it.date, amount: it.amount, item: it }))
        .concat(repayments.filter(r => r.person.toLowerCase() === lc).map(r => ({ kind: r.kind, date: r.date, amount: -r.amount, repayment: r })))
        .concat(surplusList(state).filter(x => x.person.toLowerCase() === lc).map(x => ({ kind: 'surplus', date: x.date, amount: x.amount, surplus: x })))
        .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'advance' ? -1 : 1));
      let bal = 0;
      for (const row of rows) { bal += row.amount; row.balance = bal; }
      p.ledger = rows;
    }
    const list = Object.values(people).sort((a, b) => b.open - a.open);
    // totalPrepaid: wat anderen je vooruit (of te veel) betaalden en jij nog voor hen moet uitgeven
    return { items, repayments, people: list, totalOpen: sum(list.map(p => Math.max(0, p.open))), totalPrepaid: sum(list.map(p => Math.max(0, -p.open))) };
  }

  /**
   * Gespaard in een periode: wat naar je beleggingsrekening ging (stortingen − opnames) plus wat netto
   * van je eigen rekeningen naar je spaarrekeningen ging.
   */
  function savingsIn(state, range, lines) {
    lines = lines || allocations(state);
    let invested = 0;
    for (const l of lines) if (l.categoryId === SYS_INVEST && inRange(l.date, range)) invested -= l.amount;
    const spaar = new Set(state.accounts.filter(a => a.type === 'spaar').map(a => a.id));
    let toSavings = 0;
    for (const t of state.transactions) {
      if (t.isTransfer && spaar.has(t.accountId) && inRange(t.date, range)) toSavings += t.amount;
    }
    return { invested, toSavings, total: invested + toSavings };
  }

  /**
   * Een actie bundelt transacties die bij elkaar horen (bv. "kleren voor mama, moet ze terugbetalen").
   * Anders dan een voorschot blijven het gewone uitgaven en inkomsten; de actie toont enkel het geheel:
   * wat je uitgaf, wat er terugkwam en wat je nog terug moet krijgen.
   */
  function actionSummary(state, action) {
    const txs = state.transactions.filter(t => (t.actions || []).includes(action.id)).sort((a, b) => b.date.localeCompare(a.date));
    const out = txs.filter(t => t.amount < 0).reduce((a, t) => a - t.amount, 0);
    const back = txs.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0);
    return { txs, out, back, net: out - back, open: action.expectBack ? Math.max(0, out - back) : 0 };
  }

  /** Te veel terugbetaald en ingeboekt als (andere) inkomst: [{ id, person, date, amount (+), categoryId, note }] */
  function surplusList(state) {
    const out = [];
    for (const p of state.people || []) {
      for (const x of p.surplus || []) if (x && x.amount > 0 && parseDate(x.date)) out.push(Object.assign({}, x, { person: p.name }));
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Alle personen: wie je aanmaakte (state.people) plus namen die in voorschotten voorkomen. */
  function personList(state) {
    const out = new Map();
    for (const p of state.people || []) if (p.name) out.set(p.name.trim().toLowerCase(), { name: p.name.trim(), entity: p });
    const ov = advancesOverview(state);
    for (const p of ov.people) { const k = p.person.toLowerCase(); if (!out.has(k)) out.set(k, { name: p.person, entity: null }); }
    return Array.from(out.values()).map(x => Object.assign(x, { stats: ov.people.find(p => p.person.toLowerCase() === x.name.toLowerCase()) || { person: x.name, advanced: 0, repaid: 0, forgiven: 0, open: 0, items: [] } }));
  }

  /**
   * Inkomende betalingen die waarschijnlijk een terugbetaling van deze persoon zijn: de naam van de
   * tegenpartij bevat (een deel van) de naam van de persoon, of de IBAN is gekend.
   */
  function suggestRepayments(state, name, ibans, today, limit) {
    const words = String(name || '').toLowerCase().split(/[^a-zà-ÿ]+/).filter(w => w.length >= 3);
    const known = new Set((ibans || []).map(normalizeIban).filter(Boolean));
    const from = addDays(today || todayStr(), -365);
    return state.transactions.filter(t => t.amount > 0 && t.date >= from && !t.isTransfer && !t.refundOf && !(t.splits && t.splits.length)
      && t.categoryId !== SYS_ADVANCE && (!t.categoryId || t.categorySource !== 'manual'))
      .map(t => {
        const cp = String(t.counterparty || '').toLowerCase();
        const byIban = t.counterpartyIban && known.has(normalizeIban(t.counterpartyIban));
        const byName = words.length && words.some(w => new RegExp('(^|[^a-zà-ÿ])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-zà-ÿ]|$)').test(cp));
        return byIban || byName ? { tx: t, why: byIban ? 'gekende IBAN' : 'naam' } : null;
      }).filter(Boolean).sort((a, b) => b.tx.date.localeCompare(a.tx.date)).slice(0, limit || 5);
  }

  /**
   * Saldo van een rekening: vertrekt van een gekend saldo (bv. de saldokolom van een KBC-export
   * of manueel ingegeven) en telt de latere transacties erbij.
   */
  /**
   * Saldo van een rekening op het einde van een datum, teruggerekend vanaf het gekende saldo:
   * transacties na die datum worden er afgetrokken, transacties ervoor (na het ankerpunt) erbij geteld.
   * Geeft null als er voor deze rekening geen gekend saldo is.
   */
  function balanceAt(state, accountId, date, txs) {
    const acc = state.accounts.find(a => a.id === accountId);
    if (!acc || !acc.balance || acc.balance.amount == null) return null;
    let bal = acc.balance.amount;
    const anchor = acc.balance.date;
    for (const t of txs || state.transactions) {
      if (t.accountId !== accountId) continue;
      if (t.date > date && t.date <= anchor) bal -= t.amount;
      else if (t.date <= date && t.date > anchor) bal += t.amount;
    }
    return bal;
  }

  /** Eerste datum met een transactie op deze rekening (of null). */
  function accountStart(state, accountId) {
    let first = null;
    for (const t of state.transactions) if (t.accountId === accountId && (!first || t.date < first)) first = t.date;
    return first;
  }

  function accountBalance(state, accountId) {
    const acc = state.accounts.find(a => a.id === accountId);
    if (!acc || !acc.balance || acc.balance.amount == null) return null;
    let bal = acc.balance.amount;
    for (const t of state.transactions) if (t.accountId === accountId && t.date > acc.balance.date) bal += t.amount;
    return { amount: bal, since: acc.balance.date };
  }

  // ---------- Synchronisatie tussen toestellen ----------
  //
  // Elk object (transactie, regel, budget, ...) krijgt `updatedAt` wanneer het wijzigt. Verwijderde
  // objecten worden bijgehouden als "tombstones". Samenvoegen houdt per object de nieuwste versie,
  // zodat wijzigingen op verschillende toestellen (ook offline) samengevoegd worden in plaats van
  // elkaar te overschrijven. Afgeleide velden (transfers, categorie via regel) tellen niet als
  // wijziging; die worden na het samenvoegen opnieuw berekend.

  const SYNC_COLLECTIONS = ['accounts', 'categories', 'rules', 'budgets', 'transactions', 'imports', 'deleted', 'people', 'actions', 'metals', 'watchlist'];
  const SYNC_SINGLETONS = ['settings', 'investments'];
  const TOMBSTONE_TTL = 400 * 86400000;

  function entityHash(item) {
    const copy = Object.assign({}, item);
    delete copy.updatedAt; delete copy.isTransfer; delete copy.transferPairId; delete copy.ruleId;
    if (copy.categorySource === 'rule' || copy.categorySource === 'system') { delete copy.categoryId; delete copy.categorySource; }
    if (copy.splitByRule) { delete copy.splits; delete copy.splitByRule; } // wordt op elk toestel uit de regel berekend
    if (copy.categorySource == null) delete copy.categorySource;
    if (copy.categoryId == null) delete copy.categoryId;
    return stableJson(copy);
  }

  /**
   * JSON met gesorteerde sleutels op elk niveau. (Een sleutellijst als tweede argument van
   * JSON.stringify geldt ook voor geneste objecten en liet daar velden weg, waardoor wijzigingen
   * binnenin, zoals een andere goudprijs of weergave, niet als wijziging werden gezien.)
   */
  function stableJson(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(x => x === undefined || typeof x === 'function' ? 'null' : stableJson(x)).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined && typeof v[k] !== 'function').map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
  }

  /** Momentopname van alle objecten (id -> hash) om wijzigingen te herkennen. */
  function snapshot(state) {
    const snap = {};
    for (const c of SYNC_COLLECTIONS) {
      snap[c] = {};
      for (const it of state[c] || []) snap[c][it.id] = entityHash(it);
    }
    snap.subscriptions = {};
    for (const [k, v] of Object.entries(state.subscriptions || {})) snap.subscriptions[k] = entityHash(v);
    for (const k of SYNC_SINGLETONS) snap[k] = entityHash(state[k] || {});
    return snap;
  }

  /**
   * Vergelijkt met de vorige momentopname, zet `updatedAt` op gewijzigde objecten en maakt
   * tombstones voor verwijderde. Geeft de lijst van gewijzigde sleutels ("collectie:id") terug.
   */
  function stampChanges(prev, state, now) {
    now = now || Date.now();
    state.tombstones = state.tombstones || {};
    const changed = [];
    for (const c of SYNC_COLLECTIONS) {
      const before = (prev && prev[c]) || {};
      const ids = new Set();
      for (const it of state[c] || []) {
        ids.add(it.id);
        if (before[it.id] !== entityHash(it)) { it.updatedAt = now; changed.push(c + ':' + it.id); }
      }
      for (const id of Object.keys(before)) {
        if (!ids.has(id)) { state.tombstones[c + ':' + id] = now; changed.push(c + ':' + id); }
      }
    }
    const subsBefore = (prev && prev.subscriptions) || {};
    for (const [k, v] of Object.entries(state.subscriptions || {})) {
      if (subsBefore[k] !== entityHash(v)) { v.updatedAt = now; changed.push('subscriptions:' + k); }
    }
    for (const k of SYNC_SINGLETONS) {
      if (!state[k]) continue;
      if (!prev || prev[k] !== entityHash(state[k])) {
        state[k] = Object.assign({}, state[k], { updatedAt: now });
        changed.push(k + ':');
      }
    }
    return changed;
  }

  /** Haalt de objecten op voor een lijst sleutels (voor een gedeeltelijke upload). */
  function extractChanges(state, keys) {
    const out = { tombstones: {} };
    for (const c of SYNC_COLLECTIONS) out[c] = [];
    out.subscriptions = {};
    for (const key of new Set(keys)) {
      const i = key.indexOf(':');
      const c = key.slice(0, i), id = key.slice(i + 1);
      if (SYNC_SINGLETONS.includes(c)) { if (state[c]) out[c] = state[c]; continue; }
      if (c === 'subscriptions') { if (state.subscriptions && state.subscriptions[id]) out.subscriptions[id] = state.subscriptions[id]; continue; }
      const it = (state[c] || []).find(x => x.id === id);
      if (it) out[c].push(it);
      else if (state.tombstones && state.tombstones[key]) out.tombstones[key] = state.tombstones[key];
    }
    return out;
  }

  /** Voegt `incoming` (volledig of gedeeltelijk) samen met `base`. Afwezigheid betekent nooit verwijderen. */
  function mergeStates(base, incoming, now) {
    now = now || Date.now();
    base = base || {};
    incoming = incoming || {};
    const out = Object.assign({}, base);
    const tomb = Object.assign({}, base.tombstones || {});
    for (const [k, t] of Object.entries(incoming.tombstones || {})) tomb[k] = Math.max(tomb[k] || 0, t);
    for (const k of Object.keys(tomb)) if (now - tomb[k] > TOMBSTONE_TTL) delete tomb[k];
    for (const c of SYNC_COLLECTIONS) {
      const map = new Map((base[c] || []).map(it => [it.id, it]));
      for (const it of incoming[c] || []) {
        const cur = map.get(it.id);
        if (!cur || (it.updatedAt || 0) >= (cur.updatedAt || 0)) map.set(it.id, it);
      }
      out[c] = Array.from(map.values()).filter(it => !(tomb[c + ':' + it.id] >= (it.updatedAt || 0)));
    }
    const subs = Object.assign({}, base.subscriptions || {});
    for (const [k, v] of Object.entries(incoming.subscriptions || {})) {
      if (!subs[k] || (v.updatedAt || 0) >= (subs[k].updatedAt || 0)) subs[k] = v;
    }
    out.subscriptions = subs;
    for (const k of SYNC_SINGLETONS) {
      const b = base[k], i = incoming[k];
      out[k] = i && (!b || (i.updatedAt || 0) >= (b.updatedAt || 0)) ? i : (b || (k === 'settings' ? {} : undefined));
      if (out[k] === undefined) delete out[k];
    }
    if (incoming.schema && (!out.schema || incoming.schema > out.schema)) out.schema = incoming.schema;
    out.tombstones = tomb;
    if (incoming.version && (!out.version || incoming.version > out.version)) out.version = incoming.version;
    return out;
  }

  // ---------- Categorie voorstellen op basis van online info ----------

  /** Splitst de zoekwoorden van een categorie ("supermarkt, bakkerij, fast food"). */
  function categoryTags(cat) {
    return String(cat.lookupTags || '').split(/[,;\n]/).map(t => t.trim().toLowerCase()).filter(Boolean);
  }

  /**
   * Kiest de categorie die het best past bij de tekst die online gevonden werd
   * (beschrijving, type van zaak, OpenStreetMap-tags, ...). Zoekwoorden per categorie zijn instelbaar.
   */
  function matchCategory(text, categories, direction) {
    const hay = ' ' + String(text || '').toLowerCase().replace(/[_/|()]/g, ' ').replace(/\s+/g, ' ') + ' ';
    let best = null;
    for (const c of categories) {
      if (direction === 'out' && c.kind === 'income') continue;
      if (direction === 'in' && c.kind !== 'income') continue;
      let score = 0;
      const hits = [];
      for (const tag of categoryTags(c)) {
        const t = tag.replace(/[_/|()]/g, ' ');
        // korte woorden enkel als volledig woord, langere ook als deel van een samenstelling
        const found = t.length <= 4 ? hay.includes(' ' + t + ' ') : hay.includes(t);
        if (found) { score += t.length; hits.push(tag); }
      }
      if (score && (!best || score > best.score)) best = { categoryId: c.id, score, hits };
    }
    if (!best) return null;
    best.confidence = best.score >= 12 ? 'hoog' : best.score >= 7 ? 'middel' : 'laag';
    return best;
  }

  /** Groepeert transacties zonder categorie per tegenpartij, als kandidaten om online op te zoeken. */
  function lookupCandidates(state) {
    const groups = new Map();
    for (const t of state.transactions) {
      if (t.categoryId || t.isTransfer || t.refundOf || (t.splits && t.splits.length) || looksLikeRefund(t)) continue;
      const key = normalizeName(t.counterparty) || normalizeName(t.description);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { key, txs: [], names: {} });
      const g = groups.get(key);
      g.txs.push(t);
      const n = t.counterparty || t.description;
      g.names[n] = (g.names[n] || 0) + 1;
    }
    return Array.from(groups.values()).map(g => {
      const name = Object.keys(g.names).sort((a, b) => g.names[b] - g.names[a])[0];
      const last = g.txs[g.txs.length - 1];
      return {
        key: g.key, name, count: g.txs.length,
        total: sum(g.txs.map(t => t.amount)),
        direction: sum(g.txs.map(t => t.amount)) >= 0 ? 'in' : 'out',
        description: last.description || '',
        field: g.txs.every(t => normalizeName(t.counterparty) === g.key) ? 'counterparty' : 'any',
        txIds: g.txs.map(t => t.id)
      };
    }).sort((a, b) => b.count - a.count || Math.abs(b.total) - Math.abs(a.total));
  }

  // ---------- Fysiek goud en zilver ----------

  /**
   * Munten en baren met hun gewicht en zuiverheid. Bekende munten vullen gewicht en zuiverheid in;
   * 'fine' = gram fijn metaal per stuk.
   */
  const OZ = 31.1035;
  const METAL_PRESETS = [];
  const preset = (group, metal, list) => list.forEach(([id, name, weight, purity, extra]) => METAL_PRESETS.push(Object.assign({ id, name, group, metal, weight, purity }, extra || {})));
  preset('Beleggingsmunten goud', 'gold', [
    ['krugerrand', 'Krugerrand 1 oz', 33.93, 916.7], ['krugerrand-eq', 'Krugerrand-equivalent (schatting)', 33.93, 916.7, { estimated: true }],
    ['krugerrand-12', 'Krugerrand 1/2 oz', 16.97, 916.7], ['krugerrand-14', 'Krugerrand 1/4 oz', 8.48, 916.7], ['krugerrand-110', 'Krugerrand 1/10 oz', 3.39, 916.7],
    ['maple', 'Maple Leaf 1 oz', OZ, 999.9], ['maple-12', 'Maple Leaf 1/2 oz', OZ / 2, 999.9], ['maple-14', 'Maple Leaf 1/4 oz', OZ / 4, 999.9], ['maple-110', 'Maple Leaf 1/10 oz', OZ / 10, 999.9],
    ['philharmoniker', 'Wiener Philharmoniker 1 oz', OZ, 999.9], ['philharmoniker-12', 'Wiener Philharmoniker 1/2 oz', OZ / 2, 999.9], ['philharmoniker-14', 'Wiener Philharmoniker 1/4 oz', OZ / 4, 999.9], ['philharmoniker-110', 'Wiener Philharmoniker 1/10 oz', OZ / 10, 999.9],
    ['britannia', 'Britannia 1 oz', OZ, 999.9], ['britannia-14', 'Britannia 1/4 oz', OZ / 4, 999.9],
    ['eagle', 'American Eagle 1 oz', 33.93, 916.7], ['eagle-110', 'American Eagle 1/10 oz', 3.39, 916.7], ['buffalo', 'American Buffalo 1 oz', OZ, 999.9],
    ['kangaroo', 'Kangaroo / Nugget 1 oz', OZ, 999.9], ['panda30', 'Panda 30 g', 30, 999], ['libertad', 'Libertad 1 oz', OZ, 999], ['lunar', 'Lunar (Perth Mint) 1 oz', OZ, 999.9]
  ]);
  preset('Historische goudmunten', 'gold', [
    ['fr5', '5 frank (Napoleon III / Leopold II)', 1.613, 900], ['fr10', '10 frank (halve Napoleon)', 3.226, 900],
    ['napoleon', '20 frank (Napoleon / Leopold / Albert / Marianne)', 6.452, 900], ['fr40', '40 frank (dubbele Napoleon)', 12.903, 900],
    ['fr50', '50 frank (Napoleon III)', 16.129, 900], ['fr100', '100 frank (Napoleon III / Genius)', 32.258, 900],
    ['vreneli', 'Vreneli 20 Zwitserse frank', 6.452, 900], ['vreneli10', 'Vreneli 10 Zwitserse frank', 3.226, 900],
    ['lire20', '20 lire (Italië)', 6.452, 900], ['ptas20', '20 pesetas (Spanje)', 6.452, 900], ['drachme20', '20 drachmen (Griekenland)', 6.452, 900],
    ['sovereign', 'Sovereign', 7.988, 916.7], ['halfsovereign', 'Halve Sovereign', 3.994, 916.7],
    ['gulden10', '10 gulden (Nederland, Tientje)', 6.729, 900], ['gulden5', '5 gulden (Nederland)', 3.365, 900],
    ['dukaat', '1 dukaat (Nederland / Oostenrijk)', 3.494, 983], ['ducaat4', '4 dukaten (Oostenrijk)', 13.964, 986],
    ['mark20', '20 Mark (Duitse keizerrijk)', 7.965, 900], ['mark10', '10 Mark (Duitse keizerrijk)', 3.982, 900],
    ['kronen100', '100 kronen (Oostenrijk)', 33.875, 900], ['kronen20', '20 kronen (Oostenrijk)', 6.775, 900], ['kronen10', '10 kronen (Oostenrijk)', 3.388, 900],
    ['florin8', '8 florijn / 20 frank (Oostenrijk)', 6.452, 900], ['florin4', '4 florijn / 10 frank (Oostenrijk)', 3.226, 900],
    ['roebel10', '10 roebel (Rusland, Nicolaas II)', 8.603, 900], ['roebel5', '5 roebel (Rusland, Nicolaas II)', 4.301, 900],
    ['pesos50', '50 pesos (Mexico, Centenario)', 41.667, 900], ['pesos20', '20 pesos (Mexico)', 16.667, 900],
    ['eagle-hist20', '20 dollar Double Eagle (VS, historisch)', 33.436, 900], ['eagle-hist10', '10 dollar Eagle (VS, historisch)', 16.718, 900]
  ]);
  preset('Goudbaren', 'gold', [
    ['bar1', 'Goudbaar 1 g', 1, 999.9], ['bar2', 'Goudbaar 2,5 g', 2.5, 999.9], ['bar5', 'Goudbaar 5 g', 5, 999.9], ['bar10', 'Goudbaar 10 g', 10, 999.9],
    ['bar20', 'Goudbaar 20 g', 20, 999.9], ['baroz', 'Goudbaar 1 oz', OZ, 999.9], ['bar50', 'Goudbaar 50 g', 50, 999.9], ['bar100', 'Goudbaar 100 g', 100, 999.9],
    ['bar250', 'Goudbaar 250 g', 250, 999.9], ['bar500', 'Goudbaar 500 g', 500, 999.9], ['bar1k', 'Goudbaar 1 kg', 1000, 999.9]
  ]);
  preset('Zilver', 'silver', [
    ['silver-maple', 'Zilveren Maple Leaf 1 oz', OZ, 999.9], ['silver-phil', 'Zilveren Philharmoniker 1 oz', OZ, 999], ['silver-krugerrand', 'Zilveren Krugerrand 1 oz', OZ, 999],
    ['silver-britannia', 'Zilveren Britannia 1 oz', OZ, 999], ['silver-eagle', 'Zilveren American Eagle 1 oz', OZ, 999], ['silver-kangaroo', 'Zilveren Kangaroo 1 oz', OZ, 999.9],
    ['silver-fr5', '5 frank zilver (Latijnse Muntunie)', 25, 900], ['silver-fr50be', '50 frank zilver (België, 1948–1954)', 12.5, 835], ['silver-fr100be', '100 frank zilver (België, 1948–1954)', 18, 835],
    ['silver-fr250be', '250 frank zilver (België, 1976)', 25, 835], ['silver-gulden', '1 gulden zilver (Nederland, vóór 1967)', 10, 720],
    ['silver-bar100', 'Zilverbaar 100 g', 100, 999], ['silver-bar250', 'Zilverbaar 250 g', 250, 999], ['silver-bar500', 'Zilverbaar 500 g', 500, 999], ['silver-bar1k', 'Zilverbaar 1 kg', 1000, 999]
  ]);

  /** Laatste eigen waardering per stuk (verzamelwaarde): de jongste in valuations, anders sellValue (oud veld). */
  function metalMarketValue(m) {
    const list = (m.valuations || []).filter(v => v && v.value > 0 && parseDate(v.date)).sort((a, b) => a.date.localeCompare(b.date));
    if (list.length) return list[list.length - 1];
    return Number.isFinite(m.sellValue) && m.sellValue > 0 ? { value: m.sellValue, date: null, source: '' } : null;
  }

  /**
   * Waarde van je munten en baren. Per stuk: een eigen verkoopwaarde (als je die invulde) gaat vóór de
   * prijs per gram fijn metaal. Cadeaus (origin 'gift') tellen als vermogen, maar niet als aankoop of
   * inleg, en dus ook niet in winst/verlies.
   * @param prices { gold, silver } in eurocent per gram fijn metaal (mag ontbreken)
   */
  function metalsSummary(state, prices) {
    prices = prices || {};
    const items = (state.metals || []).filter(m => m && Number(m.count) > 0).map(m => {
      const count = Number(m.count) || 0;
      const fine = (Number(m.weight) || 0) * (Number(m.purity) || 0) / 1000;
      const perGram = Number(prices[m.metal === 'silver' ? 'silver' : 'gold']) || 0;
      const metalUnit = perGram && fine ? Math.round(fine * perGram) : null;
      const market = metalMarketValue(m);
      const unitValue = market ? market.value : metalUnit;
      const value = unitValue != null ? Math.round(unitValue * count) : null;
      const gift = m.origin === 'gift';
      const cost = !gift && Number.isFinite(m.buyPrice) && m.buyPrice > 0 ? m.buyPrice : null;
      return Object.assign({}, m, {
        count, fine, fineTotal: fine * count, metalUnit, metalValue: metalUnit != null ? Math.round(metalUnit * count) : null,
        market, unitValue, value, valueSource: market ? 'manual' : unitValue != null ? 'price' : 'none',
        premium: market && metalUnit ? market.value - metalUnit : null,
        gift, cost, gain: cost != null && value != null ? value - cost : null
      });
    });
    const sum = (list, f) => list.reduce((a, x) => a + (f(x) || 0), 0);
    const bought = items.filter(x => !x.gift);
    return {
      items,
      value: sum(items, x => x.value),
      giftValue: sum(items.filter(x => x.gift), x => x.value),
      boughtValue: sum(bought, x => x.value),
      cost: sum(bought, x => x.cost),
      gain: bought.some(x => x.gain != null) ? sum(bought.filter(x => x.gain != null), x => x.gain) : null,
      goldGrams: sum(items.filter(x => x.metal !== 'silver'), x => x.fineTotal),
      silverGrams: sum(items.filter(x => x.metal === 'silver'), x => x.fineTotal),
      missing: items.filter(x => x.value == null).length,
      premium: sum(items.filter(x => x.premium != null), x => x.premium * x.count)
    };
  }

  const api = {
    uid, parseAmount, formatMoney, centsToInput, parseDate, daysBetween, addDays, addMonths, todayStr,
    normalizeIban, formatIban, normalizeName, normalizeText, median, distribute,
    RULE_FIELDS, RULE_OPERATORS, ruleMatches, findRule, applyRules, applyRuleActions, ruleSharePart, sortedRules,
    detectTransfers, splitLines, validateSplits, refundAllocation, allocations, forgivenList, surplusList, savingsIn, actionSummary, refundTotals, suggestRefundTargets, cancellationPairs, looksLikeRefund,
    periodRange, inRange, summarize, budgetStatus,
    FREQUENCIES, MONTH_NAMES, detectRecurring, recurringKey,
    detectDelimiter, parseCSV, guessMapping, rowsToTransactions, fingerprint, dedupe,
    recompute, detectInvestments, txKind, advancesOverview, accountBalance, balanceAt, accountStart, SYS_ADVANCE, SYS_INVEST,
    categoryIcon, ICON_CHOICES, personList, suggestRepayments,
    SYNC_COLLECTIONS, SYNC_SINGLETONS, snapshot, stampChanges, extractChanges, mergeStates, entityHash,
    categoryTags, matchCategory, lookupCandidates, METAL_PRESETS, metalsSummary, metalMarketValue
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FluxCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
