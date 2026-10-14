/*
 * Helder — beleggingen (Degiro).
 *
 * Gegevens komen van de rechtstreekse Degiro-koppeling (via de Helder-server) of van de
 * exportbestanden die Degiro zelf aanbiedt (Portefeuille.csv, Transacties.csv, Rekeningoverzicht.csv).
 * Beide worden omgezet naar hetzelfde formaat:
 *
 *   state.investments = {
 *     source: 'degiro-api' | 'degiro-csv', syncedAt,
 *     positions: [{ key, name, isin, symbol, currency, quantity, price, valueEur }],
 *     cashEur,
 *     trades:    [{ id, date, isin, name, quantity (+ koop / − verkoop), price, currency, totalEur, feesEur }],
 *     movements: [{ id, date, type, amountEur, description, isin }],   // storting, dividend, kosten, ...
 *     history:   [{ date, valueEur, investedEur }]                     // één punt per synchronisatie
 *   }
 */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.FluxCore;

  const MOVEMENT_TYPES = [
    ['dividend_tax', /dividendbelasting|dividend tax|withholding|bronheffing/i],
    ['dividend', /dividend|coupon|kapitaalteruggave|capital return/i],
    ['deposit', /storting|deposit|ideal|bancontact|sofort/i],
    ['withdrawal', /terugstorting|opname|withdrawal|uitbetaling/i],
    ['fee', /kosten|transactiekosten|aansluitingskosten|connection fee|fee|commissie|beurstaks|belasting op beursverrichtingen|tob/i],
    ['interest', /rente|interest/i],
    ['trade', /^koop |^verkoop |^buy |^sell /i],
    ['fx', /valuta (creditering|debitering)|fx (credit|debit)|wisselkoers/i],
    ['cashfund', /geldmarktfonds|money market|cash fund|fund (compensation|conversion)/i]
  ];

  function movementType(description) {
    // Interne verschuivingen met de flatex-geldrekening zijn geen storting of opname
    if (/geldrekening|cash sweep|money market|geldmarktfonds/i.test(description)) return 'internal';
    // "Terugstorting" bevat "storting": opname eerst controleren
    if (/terugstorting|opname|withdrawal/i.test(description)) return 'withdrawal';
    for (const [type, re] of MOVEMENT_TYPES) if (re.test(description)) return type;
    return 'other';
  }

  function norm(h) { return String(h || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  /** Degiro zet bij bedragen de munt in een naburige kolom; geef {amount, currency} voor de kolom met kop `name`. */
  function moneyAt(headers, row, names) {
    const hs = headers.map(norm);
    let i = -1;
    for (const n of names) { i = hs.findIndex(h => h === n || h.startsWith(n)); if (i >= 0) break; }
    if (i < 0) return { amount: NaN, currency: '' };
    const a = String(row[i] || '').trim(), b = String(row[i + 1] || '').trim();
    const isCur = v => /^[A-Z]{3}$/.test(v);
    if (isCur(a) && !isNaN(C.parseAmount(b))) return { amount: C.parseAmount(b), currency: a };
    if (!isNaN(C.parseAmount(a))) return { amount: C.parseAmount(a), currency: isCur(b) ? b : '' };
    return { amount: NaN, currency: '' };
  }
  function textAt(headers, row, names) {
    const hs = headers.map(norm);
    for (const n of names) { const i = hs.findIndex(h => h === n || h.startsWith(n)); if (i >= 0) return String(row[i] || '').trim(); }
    return '';
  }
  function num(v) { const n = C.parseAmount(v); return isNaN(n) ? NaN : n / 100; }

  /** Welk Degiro-exportbestand is dit? */
  function detectCsv(text) {
    const { rows } = C.parseCSV(text);
    const hs = (rows[0] || []).map(norm);
    if (hs.includes('mutatie') || hs.includes('change') || (hs.includes('omschrijving') && hs.includes('saldo'))) return 'account';
    if (hs.includes('beurs') || hs.includes('exchange') || (hs.includes('order id') && hs.includes('aantal'))) return 'transactions';
    if ((hs.includes('product') && (hs.some(h => h.startsWith('symbool')) || hs.some(h => h.startsWith('symbol')))) || hs.some(h => h.startsWith('waarde in'))) return 'portfolio';
    return null;
  }

  function parsePortfolioCsv(text) {
    const { rows } = C.parseCSV(text);
    const [headers, ...data] = rows;
    const positions = [];
    let cashEur = 0;
    for (const r of data) {
      const name = textAt(headers, r, ['product']);
      const valueEur = moneyAt(headers, r, ['waarde in eur', 'value in eur', 'waarde']).amount;
      if (!name || isNaN(valueEur)) continue;
      if (/cash|geldmarkt/i.test(name) && !textAt(headers, r, ['aantal', 'amount', 'quantity'])) { cashEur += valueEur; continue; }
      const isin = textAt(headers, r, ['symbool/isin', 'symbol/isin', 'isin']);
      const local = moneyAt(headers, r, ['lokale waarde', 'local value']);
      positions.push({
        key: isin || name, name, isin, symbol: '',
        currency: local.currency || 'EUR',
        quantity: num(textAt(headers, r, ['aantal', 'amount', 'quantity'])) || 0,
        price: num(textAt(headers, r, ['slotkoers', 'closing', 'koers'])) || 0,
        valueEur
      });
    }
    return { positions, cashEur };
  }

  function parseTransactionsCsv(text) {
    const { rows } = C.parseCSV(text);
    const [headers, ...data] = rows;
    const trades = [];
    for (const r of data) {
      const date = C.parseDate(textAt(headers, r, ['datum', 'date']));
      const qty = num(textAt(headers, r, ['aantal', 'quantity', 'number']));
      if (!date || isNaN(qty)) continue;
      const total = moneyAt(headers, r, ['totaal', 'total']);
      const value = moneyAt(headers, r, ['waarde', 'value']);
      const fees = moneyAt(headers, r, ['transactiekosten', 'transaction', 'kosten']);
      const price = moneyAt(headers, r, ['koers', 'price']);
      const orderId = textAt(headers, r, ['order id', 'order']);
      trades.push({
        id: orderId ? orderId + '|' + date + '|' + qty : [date, textAt(headers, r, ['isin']), qty, total.amount].join('|'),
        date, isin: textAt(headers, r, ['isin']), name: textAt(headers, r, ['product']),
        quantity: qty, price: isNaN(price.amount) ? 0 : price.amount / 100, currency: price.currency || 'EUR',
        totalEur: isNaN(total.amount) ? (isNaN(value.amount) ? 0 : value.amount) : total.amount,
        feesEur: isNaN(fees.amount) ? 0 : fees.amount
      });
    }
    return trades;
  }

  function parseAccountCsv(text) {
    const { rows } = C.parseCSV(text);
    const [headers, ...data] = rows;
    const movements = [];
    for (const r of data) {
      const date = C.parseDate(textAt(headers, r, ['datum', 'date']));
      const desc = textAt(headers, r, ['omschrijving', 'description']);
      const m = moneyAt(headers, r, ['mutatie', 'change']);
      if (!date || !desc || isNaN(m.amount)) continue;
      if (m.currency && m.currency !== 'EUR') continue; // vreemde munt: de EUR-tegenboeking telt
      const time = textAt(headers, r, ['tijd', 'time']);
      movements.push({
        id: [date, time, desc, m.amount].join('|'), date, type: movementType(desc),
        amountEur: m.amount, description: desc, isin: textAt(headers, r, ['isin'])
      });
    }
    return movements;
  }

  /** Voegt nieuwe gegevens toe aan de bestaande beleggingen (zonder dubbels). */
  function mergeInvestments(current, incoming, source, today) {
    const cur = current ? JSON.parse(JSON.stringify(current)) : { positions: [], trades: [], movements: [], history: [], cashEur: 0 };
    const out = Object.assign(cur, { source, syncedAt: new Date().toISOString() });
    const day = today || C.todayStr();
    // Een export van een vroegere datum voegt enkel een waarderingspunt toe; de huidige posities blijven
    const newest = !out.positionsDate || day >= out.positionsDate;
    const incomingValue = incoming.positions ? incoming.positions.reduce((s, p) => s + (p.valueEur || 0), 0) + (incoming.cashEur || 0) : 0;
    if (incoming.positions && newest) { out.positions = incoming.positions; out.cashEur = incoming.cashEur || 0; out.positionsDate = day; }
    const byId = (list, add) => {
      const m = new Map((list || []).map(x => [x.id, x]));
      for (const x of add || []) m.set(x.id, x);
      return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date));
    };
    if (incoming.trades) out.trades = byId(out.trades, incoming.trades);
    if (incoming.movements) out.movements = byId(out.movements, incoming.movements);
    if (incoming.positions) {
      out.history = (out.history || []).filter(h => h.date !== day)
        .concat([{ date: day, valueEur: incomingValue, source }])
        .sort((a, b) => a.date.localeCompare(b.date));
      // Elke stand bewaren: aantallen en koersen op die datum helpen de reconstructie
      out.snapshots = (out.snapshots || []).filter(x => x.date !== day)
        .concat([{ date: day, cashEur: incoming.cashEur || 0, positions: incoming.positions.map(p => ({ key: p.isin || p.key || p.name, name: p.name, isin: p.isin || '', quantity: p.quantity || 0, valueEur: p.valueEur || 0 })) }])
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    return out;
  }

  // ---------- Reconstructie van de portefeuille op elke datum ----------
  //
  // Uit je transacties (aan- en verkopen) en kasbewegingen weet Helder hoeveel stuks en hoeveel cash
  // je op elk moment had. Dat wordt verankerd aan de laatst gekende stand (Degiro-koppeling of
  // portefeuille-export). De koers per datum komt uit:
  //   1. historische marktkoersen (indien opgehaald via de server, zie server/prices.js), anders
  //   2. je eigen aankoopkoersen en gekende standen, lineair geïnterpoleerd.

  function keyOf(x) { return x.isin || x.key || x.name; }

  function snapshotsOf(inv) {
    const list = (inv.snapshots || []).slice();
    if (inv.positionsDate && !list.some(x => x.date === inv.positionsDate)) {
      list.push({ date: inv.positionsDate, cashEur: inv.cashEur || 0, positions: (inv.positions || []).map(p => ({ key: keyOf(p), quantity: p.quantity || 0, valueEur: p.valueEur || 0 })) });
    }
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Gekende koerspunten (EUR-centen per stuk) per product. */
  function pricePoints(inv) {
    const pts = {};
    const add = (k, date, eur) => { if (k && date && isFinite(eur) && eur > 0) (pts[k] = pts[k] || []).push({ date, eur }); };
    for (const t of inv.trades || []) {
      if (!t.quantity) continue;
      add(keyOf(t), t.date, (Math.abs(t.totalEur || 0) - Math.abs(t.feesEur || 0)) / Math.abs(t.quantity));
    }
    for (const snap of snapshotsOf(inv)) for (const p of snap.positions || []) if (p.quantity) add(keyOf(p), snap.date, p.valueEur / p.quantity);
    for (const k of Object.keys(pts)) pts[k].sort((a, b) => a.date.localeCompare(b.date));
    return pts;
  }

  function interpolate(points, date) {
    if (!points || !points.length) return null;
    if (date <= points[0].date) return points[0].eur;
    const last = points[points.length - 1];
    if (date >= last.date) return last.eur;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (date <= b.date) {
        const span = C.daysBetween(a.date, b.date) || 1;
        return a.eur + (b.eur - a.eur) * C.daysBetween(a.date, date) / span;
      }
    }
    return last.eur;
  }

  /** Laatste marktkoers op of vóór de datum (max. 45 dagen oud). */
  function marketPrice(inv, key, date) {
    const m = inv.market && inv.market.series && inv.market.series[key];
    if (!m || !m.points || !m.points.length) return null;
    let best = null;
    for (const p of m.points) { if (p.date <= date) best = p; else break; }
    return best && C.daysBetween(best.date, date) <= 45 ? best.eur : null;
  }

  /** Aantal stuks per product op een datum. */
  function holdingsAt(inv, date) {
    const snaps = snapshotsOf(inv);
    const anchor = snaps[snaps.length - 1] || null;
    const q = {};
    if (anchor) for (const p of anchor.positions || []) q[keyOf(p)] = (q[keyOf(p)] || 0) + (p.quantity || 0);
    for (const t of inv.trades || []) {
      const k = keyOf(t);
      if (!anchor) { if (t.date <= date) q[k] = (q[k] || 0) + t.quantity; continue; }
      if (t.date > date && t.date <= anchor.date) q[k] = (q[k] || 0) - t.quantity;
      else if (t.date <= date && t.date > anchor.date) q[k] = (q[k] || 0) + t.quantity;
    }
    for (const k of Object.keys(q)) if (Math.abs(q[k]) < 1e-9) delete q[k];
    return q;
  }

  /** Kaswijzigingen op de beleggingsrekening (in centen). */
  function cashChanges(inv) {
    const hasTrades = (inv.trades || []).length > 0;
    const out = [];
    for (const m of inv.movements || []) {
      if (['deposit', 'withdrawal', 'dividend', 'dividend_tax', 'interest'].includes(m.type)) out.push({ date: m.date, amount: m.amountEur });
      else if (m.type === 'fee' && !(hasTrades && /transactie|transaction/i.test(m.description || ''))) out.push({ date: m.date, amount: m.amountEur });
    }
    for (const t of inv.trades || []) out.push({ date: t.date, amount: t.totalEur || 0 });
    return out;
  }

  function cashAt(inv, date, changes) {
    changes = changes || cashChanges(inv);
    const snaps = snapshotsOf(inv);
    const anchor = snaps[snaps.length - 1] || null;
    let cash = anchor ? anchor.cashEur || 0 : 0;
    for (const c of changes) {
      if (!anchor) { if (c.date <= date) cash += c.amount; }
      else if (c.date > date && c.date <= anchor.date) cash -= c.amount;
      else if (c.date <= date && c.date > anchor.date) cash += c.amount;
    }
    return Math.max(0, cash);
  }

  /** Geschatte waarde van de beleggingsrekening op een datum. */
  function estimateAt(inv, date, cache) {
    cache = cache || {};
    const pts = cache.pts || (cache.pts = pricePoints(inv));
    const changes = cache.changes || (cache.changes = cashChanges(inv));
    const q = holdingsAt(inv, date);
    let positionsEur = 0, market = 0, total = 0;
    for (const [k, qty] of Object.entries(q)) {
      if (qty <= 0) continue;
      total++;
      let price = marketPrice(inv, k, date);
      if (price != null) market++; else price = interpolate(pts[k], date);
      if (price != null) positionsEur += qty * price;
    }
    const cashEur = cashAt(inv, date, changes);
    return { date, positionsEur: Math.round(positionsEur), cashEur: Math.round(cashEur), valueEur: Math.round(positionsEur + cashEur), quality: total && market === total ? 'market' : 'trades' };
  }

  /** Kan Helder de waarde reconstrueren? (transacties en/of een gekende stand nodig) */
  function canEstimate(inv) { return !!inv && ((inv.trades || []).length > 0 || snapshotsOf(inv).length > 0); }

  /** Reeks waarden op de gegeven datums; echte waarderingen hebben voorrang. */
  function valueSeries(inv, dates) {
    const actual = new Map(valuations(inv).map(v => [v.date, v.value]));
    const cache = {};
    return dates.map(d => actual.has(d) ? { date: d, valueEur: actual.get(d), actual: true } : Object.assign(estimateAt(inv, d, cache), { actual: false }));
  }

  /** Kerncijfers van de portefeuille. Alle bedragen in centen (EUR). */
  function summary(inv) {
    if (!inv) return null;
    const positionsValue = (inv.positions || []).reduce((s, p) => s + (p.valueEur || 0), 0);
    const valueEur = positionsValue + (inv.cashEur || 0);
    const mv = inv.movements || [];
    const total = type => mv.filter(m => m.type === type).reduce((s, m) => s + m.amountEur, 0);
    const deposits = total('deposit');
    const withdrawals = -total('withdrawal');
    const netDeposits = deposits - withdrawals;
    const dividends = total('dividend');
    const dividendTax = -total('dividend_tax');
    const tradeFees = -(inv.trades || []).reduce((s, t) => s + (t.feesEur || 0), 0);
    const otherFees = -total('fee');
    const fees = otherFees || tradeFees; // rekeningoverzicht bevat de transactiekosten al; anders uit de trades
    const hasDeposits = mv.some(m => m.type === 'deposit');
    // Kostprijs per positie (gemiddelde aankoopprijs) uit de transacties
    const cost = {};
    for (const t of (inv.trades || []).slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const k = t.isin || t.name;
      const c = cost[k] = cost[k] || { qty: 0, cost: 0 };
      if (t.quantity > 0) { c.qty += t.quantity; c.cost += -(t.totalEur || 0); }
      else if (c.qty > 0) { const part = Math.min(1, -t.quantity / c.qty); c.cost -= c.cost * part; c.qty += t.quantity; }
    }
    const positions = (inv.positions || []).map(p => {
      const c = cost[p.isin] || cost[p.name];
      const costEur = p.costEur != null ? p.costEur : c ? Math.round(c.cost) : null;
      return Object.assign({}, p, { costEur, gainEur: costEur != null ? p.valueEur - costEur : null, share: positionsValue ? p.valueEur / positionsValue : 0 });
    }).sort((a, b) => b.valueEur - a.valueEur);
    return {
      valueEur, positionsValue, cashEur: inv.cashEur || 0, positions,
      deposits, withdrawals, netDeposits, hasDeposits,
      gainEur: hasDeposits ? valueEur - netDeposits : null,
      dividends, dividendTax, netDividends: dividends - dividendTax, fees
    };
  }

  /** Inkomsten uit beleggingen per periode (netto dividend), voor het tabblad Inkomsten. */
  function dividendsIn(inv, range) {
    if (!inv) return 0;
    return (inv.movements || []).filter(m => (m.type === 'dividend' || m.type === 'dividend_tax') && C.inRange(m.date, range)).reduce((s, m) => s + m.amountEur, 0);
  }

  // ---------- Rendement: MWR (XIRR) en TWR (Modified Dietz, geketend) ----------

  /** Externe geldstromen van de portefeuille: + storting, − opname (in centen). Dividend en kosten zijn intern. */
  function cashFlows(inv) {
    return ((inv && inv.movements) || [])
      .filter(m => m.type === 'deposit' || m.type === 'withdrawal')
      .map(m => ({ date: m.date, amount: m.amountEur }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Waarderingen (datum → waarde), één per dag. */
  function valuations(inv) {
    const map = new Map();
    for (const h of (inv && inv.history) || []) if (h.valueEur != null) map.set(h.date, h.valueEur);
    return Array.from(map.entries()).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Interne opbrengstvoet (jaarbasis) van geldstromen [{date, amount}] vanuit de belegger (− = inleg). */
  function xirr(cfs) {
    if (cfs.length < 2 || !cfs.some(c => c.amount > 0) || !cfs.some(c => c.amount < 0)) return null;
    const t0 = cfs[0].date;
    const f = r => cfs.reduce((s, c) => s + c.amount / Math.pow(1 + r, C.daysBetween(t0, c.date) / 365), 0);
    let lo = -0.9999, hi = 10;
    let flo = f(lo), fhi = f(hi);
    if (flo * fhi > 0) return null;
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2, fm = f(mid);
      if (Math.abs(fm) < 1e-7) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  /** Rendement over één periode met tussentijdse stortingen (Modified Dietz). */
  function modifiedDietz(v0, v1, flows, from, to) {
    const T = C.daysBetween(from, to);
    if (T <= 0) return null;
    const F = flows.reduce((s, f) => s + f.amount, 0);
    const weighted = flows.reduce((s, f) => s + f.amount * (C.daysBetween(f.date, to) / T), 0);
    const denom = v0 + weighted;
    if (denom <= 0) return null;
    return (v1 - v0 - F) / denom;
  }

  /** Waardering vlak rond een datum (exporteer bij voorkeur exact op 31/12). */
  function valuationNear(vals, date, tolerance) {
    let best = null;
    for (const v of vals) {
      const d = Math.abs(C.daysBetween(v.date, date));
      if (d <= (tolerance == null ? 4 : tolerance) && (!best || d < best.d)) best = { d, v };
    }
    return best ? best.v : null;
  }

  /** TWR over [from, to] door subperiodes tussen opeenvolgende waarderingen te ketenen. */
  function chainedTwr(points, flows, from, to) {
    const pts = points.filter(p => p.date >= from && p.date <= to);
    if (pts.length < 2) return null;
    let g = 1;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      // Stortingen op de startdag van de allereerste periode horen bij die periode
      const fl = flows.filter(f => (f.date > a.date || (i === 1 && a.value === 0 && f.date === a.date)) && f.date <= b.date);
      const r = modifiedDietz(a.value, b.value, fl, a.date, b.date);
      if (r == null) { if (a.value === 0 && b.value === 0) continue; return null; }
      g *= 1 + r;
    }
    return g - 1;
  }

  /**
   * Volledige rendementsanalyse.
   * - MWR (money-weighted, XIRR): houdt rekening met wanneer en hoeveel je stortte; exact.
   * - TWR (time-weighted): het rendement van de beleggingen zelf, los van je stortingen. Wordt per
   *   periode tussen twee waarderingen berekend (Modified Dietz) en geketend; hoe meer waarderingen
   *   (bv. een portefeuille-export per 31/12), hoe nauwkeuriger.
   */
  function performance(inv) {
    const flows = cashFlows(inv);
    const vals = valuations(inv);
    if (!flows.length || !vals.length) return null;
    const first = flows[0].date;
    const last = vals[vals.length - 1];
    const start = first;
    const points = [{ date: start, value: 0 }].concat(vals.filter(v => v.date > start));
    const used = flows.filter(f => f.date <= last.date);
    const ignoredFlows = flows.filter(f => f.date > last.date);
    const days = Math.max(1, C.daysBetween(start, last.date));

    // Met marktkoersen: ook een geschatte waarde op elk maandeinde, voor een nauwkeurigere TWR
    if (canEstimate(inv) && inv.market && inv.market.series) {
      const have = new Set(points.map(p => p.date));
      const cache = {};
      for (let d = C.addDays(C.addMonths(start.slice(0, 8) + '01', 1), -1); d < last.date; d = C.addDays(C.addMonths(C.addDays(d, 1), 1), -1)) {
        if (have.has(d)) continue;
        const e = estimateAt(inv, d, cache);
        if (e.quality === 'market') points.push({ date: d, value: e.valueEur });
      }
      points.sort((a, b) => a.date.localeCompare(b.date));
    }
    const twr = chainedTwr(points, used, start, last.date);
    const mwr = xirr(used.map(f => ({ date: f.date, amount: -f.amount })).concat([{ date: last.date, amount: last.value }]));
    const netDeposits = used.reduce((s, f) => s + f.amount, 0);

    // Per jaar
    const years = [];
    const estimable = canEstimate(inv);
    const estCache = {};
    const y0 = Number(first.slice(0, 4)), y1 = Number(last.date.slice(0, 4));
    const moves = (inv.movements || []);
    for (let y = y0; y <= y1; y++) {
      const ys = (y - 1) + '-12-31', ye = y + '-12-31';
      let startV = y === y0 ? { date: start, value: 0 } : valuationNear(vals, ys);
      let endV = y === y1 ? (valuationNear(vals, ye) || last) : valuationNear(vals, ye);
      let estimated = false;
      // Geen export op 31/12? Reconstrueer de waarde uit je transacties
      if (!startV && estimable) { startV = { date: ys, value: estimateAt(inv, ys, estCache).valueEur }; estimated = true; }
      if (!endV && estimable) { endV = { date: ye, value: estimateAt(inv, ye, estCache).valueEur }; estimated = true; }
      const partial = y === y1 && endV.date < ye && Math.abs(C.daysBetween(endV.date, ye)) > 4;
      const from = startV ? startV.date : ys;
      const yFlows = used.filter(f => (f.date > from || (y === y0 && f.date === from)) && f.date <= (endV ? endV.date : ye));
      const inYear = d => d.slice(0, 4) === String(y);
      const row = {
        year: y, partial, estimated,
        deposits: used.filter(f => inYear(f.date) && f.amount > 0).reduce((s, f) => s + f.amount, 0),
        withdrawals: -used.filter(f => inYear(f.date) && f.amount < 0).reduce((s, f) => s + f.amount, 0),
        dividends: moves.filter(m => inYear(m.date) && (m.type === 'dividend' || m.type === 'dividend_tax')).reduce((s, m) => s + m.amountEur, 0),
        fees: -moves.filter(m => inYear(m.date) && m.type === 'fee').reduce((s, m) => s + m.amountEur, 0),
        startValue: startV ? startV.value : null, endValue: endV ? endV.value : null,
        startDate: startV ? startV.date : null, endDate: endV ? endV.date : null,
        missing: []
      };
      if (!startV) row.missing.push(ys);
      if (!endV) row.missing.push(ye);
      if (!row.missing.length) {
        const net = yFlows.reduce((s, f) => s + f.amount, 0);
        row.result = row.endValue - row.startValue - net;
        const inner = [startV].concat(vals.filter(v => v.date > startV.date && v.date < endV.date)).concat([endV]);
        row.twr = chainedTwr(inner, yFlows, startV.date, endV.date);
        const r = xirr([{ date: startV.date, amount: -row.startValue }].filter(c => c.amount).concat(yFlows.map(f => ({ date: f.date, amount: -f.amount }))).concat([{ date: endV.date, amount: row.endValue }]));
        const d = C.daysBetween(startV.date, endV.date);
        // Voor een onvolledig jaar: rendement over de periode, niet op jaarbasis
        row.mwr = r == null ? null : partial ? Math.pow(1 + r, d / 365) - 1 : r;
      }
      years.push(row);
    }
    return {
      start: first, end: last.date, value: last.value, netDeposits, gain: last.value - netDeposits,
      twr, twrAnnual: twr == null ? null : Math.pow(1 + twr, 365 / days) - 1,
      mwr, valuations: vals.length, flows, ignoredFlows, years,
      missingYearEnds: years.flatMap(y => y.missing),
      estimatedYears: years.filter(y => y.estimated).map(y => y.year)
    };
  }

  /**
   * Gerealiseerde winst/verlies per product, uit je aan- en verkopen (methode: gemiddelde aankoopprijs,
   * kosten inbegrepen). Verkochte (of deels verkochte) producten, met dividenden die ze opbrachten.
   */
  function realized(inv) {
    const by = {};
    const trades = (inv && inv.trades || []).slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
    for (const t of trades) {
      const k = keyOf(t);
      const p = by[k] || (by[k] = { key: k, isin: t.isin || '', name: t.name || k, qty: 0, cost: 0, bought: 0, boughtQty: 0, soldQty: 0, proceeds: 0, costSold: 0, result: 0, fees: 0, firstBuy: null, lastSell: null, sells: [] });
      p.fees += Math.abs(t.feesEur || 0);
      if (t.quantity > 0) {
        const paid = Math.abs(t.totalEur || 0);
        p.qty += t.quantity; p.cost += paid; p.bought += paid; p.boughtQty += t.quantity;
        if (!p.firstBuy) p.firstBuy = t.date;
      } else if (t.quantity < 0) {
        const q = Math.min(-t.quantity, p.qty > 0 ? p.qty : -t.quantity);
        const avg = p.qty > 0 ? p.cost / p.qty : 0;
        const costSold = Math.round(avg * q);
        const got = Math.abs(t.totalEur || 0);
        p.qty = Math.max(0, p.qty + t.quantity); p.cost = p.qty > 1e-9 ? p.cost - costSold : 0;
        p.soldQty += -t.quantity; p.proceeds += got; p.costSold += costSold; p.result += got - costSold; p.lastSell = t.date;
        p.sells.push({ date: t.date, quantity: -t.quantity, proceeds: got, cost: costSold, result: got - costSold });
      }
    }
    const div = {};
    for (const m of (inv && inv.movements) || []) if ((m.type === 'dividend' || m.type === 'dividend_tax') && m.isin) div[m.isin] = (div[m.isin] || 0) + m.amountEur;
    const list = Object.values(by).filter(p => p.soldQty > 0).map(p => Object.assign(p, {
      closed: p.qty < 1e-6, dividends: div[p.isin] || 0,
      pct: p.costSold ? p.result / p.costSold : null
    })).sort((a, b) => (b.lastSell || '').localeCompare(a.lastSell || ''));
    return {
      positions: list,
      total: list.reduce((s, p) => s + p.result, 0),
      totalDividends: list.reduce((s, p) => s + p.dividends, 0)
    };
  }

  const api = { realized, snapshotsOf, pricePoints, holdingsAt, cashAt, estimateAt, canEstimate, valueSeries, cashFlows, valuations, xirr, modifiedDietz, performance, detectCsv, parsePortfolioCsv, parseTransactionsCsv, parseAccountCsv, movementType, mergeInvestments, summary, dividendsIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FluxInvest = api;
})(typeof window !== 'undefined' ? window : globalThis);
