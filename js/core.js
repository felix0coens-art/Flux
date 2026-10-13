/*
 * Flux — kernlogica (zonder DOM).
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

  /** Naam opschonen om verwante transacties te groeperen ("NETFLIX.COM 8812" -> "netflix com"). */
  function normalizeName(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2 && !STOP_WORDS.has(t))
      .slice(0, 3)
      .join(' ');
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
    counterparty: 'Tegenpartij',
    description: 'Mededeling',
    counterpartyIban: 'IBAN tegenpartij',
    any: 'Eender welk veld'
  };
  const RULE_OPERATORS = {
    contains: 'bevat',
    equals: 'is gelijk aan',
    startsWith: 'begint met',
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
    const fields = rule.field === 'any' ? ['counterparty', 'description', 'counterpartyIban'] : [rule.field];
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
  function applyRules(state) {
    let changed = 0;
    const rules = sortedRules(state.rules);
    for (const tx of state.transactions) {
      if (tx.categorySource === 'manual' || (tx.splits && tx.splits.length) || tx.isTransfer || tx.refundOf) continue;
      const rule = rules.find(r => ruleMatches(r, tx));
      const newCat = rule ? rule.categoryId : null;
      const newSrc = rule ? 'rule' : null;
      const newRule = rule ? rule.id : null;
      if (tx.categoryId !== newCat || tx.categorySource !== newSrc || tx.ruleId !== newRule) {
        tx.categoryId = newCat;
        tx.categorySource = newSrc;
        tx.ruleId = newRule;
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
      const lines = tx.splits.map(s => ({ categoryId: s.categoryId || null, amount: s.amount, note: s.note || '' }));
      const rest = tx.amount - sum(lines.map(l => l.amount));
      if (rest !== 0) lines.push({ categoryId: tx.categoryId || null, amount: rest, note: 'rest' });
      return lines;
    }
    return [{ categoryId: tx.categoryId || null, amount: tx.amount, note: '' }];
  }

  function validateSplits(tx, splits) {
    const errors = [];
    for (const s of splits) {
      if (!s.categoryId) errors.push('Elke splitsing heeft een categorie nodig.');
      if (!s.amount || Math.sign(s.amount) !== Math.sign(tx.amount)) errors.push('Splitsbedragen moeten hetzelfde teken hebben als de transactie.');
    }
    const total = sum(splits.map(s => s.amount));
    if (Math.abs(total) > Math.abs(tx.amount)) errors.push('Het totaal van de splitsingen is groter dan het transactiebedrag.');
    return Array.from(new Set(errors));
  }

  /**
   * Zet alle transacties om in boekingslijnen per categorie.
   * - Interne overschrijvingen worden weggelaten.
   * - Terugbetalingen worden op de categorie(ën) én de datum van de oorspronkelijke uitgave geboekt,
   *   zodat ze de uitgave verminderen in plaats van als inkomen te tellen.
   */
  function allocations(state) {
    const byId = new Map(state.transactions.map(t => [t.id, t]));
    const lines = [];
    for (const tx of state.transactions) {
      if (tx.isTransfer) continue;
      const orig = tx.refundOf ? byId.get(tx.refundOf) : null;
      if (orig && !orig.isTransfer) {
        const origLines = splitLines(orig);
        const parts = distribute(tx.amount, origLines.map(l => l.amount));
        origLines.forEach((l, i) => {
          if (parts[i]) lines.push({ txId: tx.id, date: orig.date, categoryId: l.categoryId, amount: parts[i], refund: true, accountId: tx.accountId });
        });
        continue;
      }
      for (const l of splitLines(tx)) {
        lines.push({ txId: tx.id, date: tx.date, categoryId: l.categoryId, amount: l.amount, refund: false, accountId: tx.accountId });
      }
    }
    return lines;
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
        const ratio = tx.amount / -o.amount;
        if (ratio > 0.2 && ratio < 0.9) score += 15; // typisch "deel" van een rekening
        return { tx: o, score, openAmount };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit || 8);
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

  /** Inkomsten, uitgaven en saldo voor een periode, met opsplitsing per categorie. */
  function summarize(state, range, lines) {
    lines = lines || allocations(state);
    const catKind = new Map(state.categories.map(c => [c.id, c.kind]));
    const byCategory = {};
    let income = 0, expenses = 0;
    for (const l of lines) {
      if (!inRange(l.date, range)) continue;
      const key = l.categoryId || '__none__';
      const kind = l.categoryId ? catKind.get(l.categoryId) : (l.amount > 0 ? 'income' : 'expense');
      if (kind === 'income') income += l.amount;
      else expenses -= l.amount;
      byCategory[key] = (byCategory[key] || 0) + l.amount;
    }
    let transfers = 0;
    for (const tx of state.transactions) {
      if (tx.isTransfer && tx.amount < 0 && inRange(tx.date, range)) transfers -= tx.amount;
    }
    return { income, expenses, net: income - expenses, byCategory, transfers };
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
  function detectRecurring(state, today) {
    today = today || todayStr();
    const overrides = state.subscriptions || {};
    const groups = new Map();
    for (const tx of state.transactions) {
      if (tx.amount >= 0 || tx.isTransfer || tx.excludeRecurring) continue;
      const key = recurringKey(tx);
      if (!key) continue;
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
        if (last && last.date === t.date) { last.amount += -t.amount; last.txs.push(t); }
        else events.push({ date: t.date, amount: -t.amount, txs: [t] });
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
        userStatus: ov.status || 'detected', // detected | confirmed | ignored
        txIds: txs.map(t => t.id)
      });
    }
    return results.sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  }

  // ---------- CSV-import ----------

  function detectDelimiter(text) {
    const firstLines = text.split(/\r?\n/).slice(0, 5).join('\n');
    const counts = { ';': 0, ',': 0, '\t': 0 };
    let inQ = false;
    for (const ch of firstLines) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch in counts) counts[ch]++;
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
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

  // ---------- Volledige herberekening ----------

  /** Na elke wijziging: transfers herkennen, ongeldige koppelingen opruimen en regels toepassen. */
  function recompute(state) {
    const ids = new Set(state.transactions.map(t => t.id));
    for (const tx of state.transactions) {
      if (tx.refundOf && !ids.has(tx.refundOf)) tx.refundOf = null;
      if (tx.categoryId && !state.categories.some(c => c.id === tx.categoryId)) { tx.categoryId = null; tx.categorySource = null; }
      if (tx.splits) tx.splits = tx.splits.filter(s => state.categories.some(c => c.id === s.categoryId));
    }
    detectTransfers(state);
    applyRules(state);
    return state;
  }

  const api = {
    uid, parseAmount, formatMoney, centsToInput, parseDate, daysBetween, addDays, addMonths, todayStr,
    normalizeIban, formatIban, normalizeName, median, distribute,
    RULE_FIELDS, RULE_OPERATORS, ruleMatches, findRule, applyRules, sortedRules,
    detectTransfers, splitLines, validateSplits, allocations, refundTotals, suggestRefundTargets, looksLikeRefund,
    periodRange, inRange, summarize, budgetStatus,
    FREQUENCIES, MONTH_NAMES, detectRecurring, recurringKey,
    detectDelimiter, parseCSV, guessMapping, rowsToTransactions, fingerprint, dedupe,
    recompute
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FluxCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
