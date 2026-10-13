/*
 * Flux — opslag (localStorage), standaardgegevens en demodata.
 */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.FluxCore;

  const STORAGE_KEY = 'flux-data-v1';
  const VERSION = 1;

  const DEFAULT_CATEGORIES = [
    ['cat_boodschappen', 'Boodschappen', 'expense', '#2f9e44'],
    ['cat_huishouden', 'Huishouden', 'expense', '#66a80f'],
    ['cat_wonen', 'Huur & wonen', 'expense', '#1971c2'],
    ['cat_nuts', 'Nutsvoorzieningen', 'expense', '#0c8599'],
    ['cat_abonnementen', 'Abonnementen', 'expense', '#7048e8'],
    ['cat_telecom', 'Telecom & internet', 'expense', '#5f3dc4'],
    ['cat_uitgaan', 'Restaurant & uitgaan', 'expense', '#e8590c'],
    ['cat_vervoer', 'Vervoer', 'expense', '#f08c00'],
    ['cat_gezondheid', 'Gezondheid', 'expense', '#c2255c'],
    ['cat_kleding', 'Kleding', 'expense', '#d6336c'],
    ['cat_vrijetijd', 'Vrije tijd & hobby', 'expense', '#ae3ec9'],
    ['cat_verzekering', 'Verzekeringen', 'expense', '#495057'],
    ['cat_belasting', 'Belastingen', 'expense', '#868e96'],
    ['cat_cadeaus', 'Cadeaus', 'expense', '#f76707'],
    ['cat_overig', 'Overige uitgaven', 'expense', '#adb5bd'],
    ['cat_loon', 'Loon', 'income', '#37b24d'],
    ['cat_inkomsten', 'Andere inkomsten', 'income', '#74b816']
  ].map(([id, name, kind, color]) => ({ id, name, kind, color }));

  const DEFAULT_RULES = [
    ['Colruyt', 'description', 'contains', 'colruyt', 'cat_boodschappen'],
    ['Delhaize', 'any', 'contains', 'delhaize', 'cat_boodschappen'],
    ['Aldi', 'any', 'contains', 'aldi', 'cat_boodschappen'],
    ['Lidl', 'any', 'contains', 'lidl', 'cat_boodschappen'],
    ['Carrefour', 'any', 'contains', 'carrefour', 'cat_boodschappen'],
    ['Albert Heijn', 'any', 'contains', 'albert heijn', 'cat_boodschappen'],
    ['Action', 'counterparty', 'contains', 'action', 'cat_huishouden'],
    ['Engie', 'any', 'contains', 'engie', 'cat_nuts'],
    ['Luminus', 'any', 'contains', 'luminus', 'cat_nuts'],
    ['Water', 'any', 'regex', 'de watergroep|farys|aquafin|pidpa', 'cat_nuts'],
    ['Netflix', 'any', 'contains', 'netflix', 'cat_abonnementen'],
    ['Spotify', 'any', 'contains', 'spotify', 'cat_abonnementen'],
    ['Disney+', 'any', 'contains', 'disney', 'cat_abonnementen'],
    ['Proximus', 'any', 'contains', 'proximus', 'cat_telecom'],
    ['Telenet', 'any', 'contains', 'telenet', 'cat_telecom'],
    ['NMBS', 'any', 'regex', 'nmbs|sncb', 'cat_vervoer'],
    ['De Lijn', 'any', 'contains', 'de lijn', 'cat_vervoer'],
    ['Tankstation', 'any', 'regex', 'total ?energies|q8|shell|esso|dats ?24', 'cat_vervoer'],
    ['Apotheek', 'any', 'contains', 'apotheek', 'cat_gezondheid'],
    ['Ziekenfonds', 'any', 'regex', 'mutualiteit|ziekenfonds|cm |helan|solidaris', 'cat_gezondheid'],
    ['Loon', 'description', 'regex', '\\bloon\\b|salaris|wedde', 'cat_loon']
  ].map(([name, field, operator, value, categoryId], i) => ({
    id: 'rule_' + (i + 1), name, field, operator, value, categoryId, direction: name === 'Loon' ? 'in' : 'out', priority: (i + 1) * 10, enabled: true
  }));

  function defaultState() {
    return {
      version: VERSION,
      accounts: [
        { id: 'acc_zicht', name: 'Zichtrekening', iban: '', type: 'zicht' },
        { id: 'acc_spaar', name: 'Spaarrekening', iban: '', type: 'spaar' },
        { id: 'acc_cash', name: 'Cash', iban: '', type: 'cash' }
      ],
      categories: DEFAULT_CATEGORIES.map(c => Object.assign({}, c)),
      rules: DEFAULT_RULES.map(r => Object.assign({}, r)),
      budgets: [],
      transactions: [],
      subscriptions: {},
      settings: { warnAt: 0.8 }
    };
  }

  function migrate(data) {
    const base = defaultState();
    const s = Object.assign(base, data || {});
    for (const k of ['accounts', 'categories', 'rules', 'budgets', 'transactions']) if (!Array.isArray(s[k])) s[k] = [];
    if (!s.subscriptions || typeof s.subscriptions !== 'object') s.subscriptions = {};
    s.settings = Object.assign({ warnAt: 0.8 }, s.settings || {});
    for (const t of s.transactions) {
      if (!Array.isArray(t.splits)) t.splits = [];
      if (!t.transferMode) t.transferMode = 'auto';
    }
    s.version = VERSION;
    return s;
  }

  function load() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      if (raw) return C.recompute(migrate(JSON.parse(raw)));
    } catch (e) {
      console.error('Flux: kon gegevens niet laden', e);
    }
    return defaultState();
  }

  function save(state) {
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('Flux: kon gegevens niet opslaan', e);
      return false;
    }
  }

  function clear() {
    try { root.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* negeren */ }
  }

  // ---------- Demodata ----------

  /** Genereert ±14 maanden realistische transacties om Flux uit te proberen. */
  function demoState(today) {
    today = today || C.todayStr();
    let seed = 42;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const pick = arr => arr[Math.floor(rnd() * arr.length)];

    const s = defaultState();
    s.accounts[0].iban = 'BE68539007547034';
    s.accounts[1].iban = 'BE71096123456769';
    const Z = 'acc_zicht', S = 'acc_spaar', K = 'acc_cash';
    const txs = [];
    const add = (accountId, date, euro, counterparty, description, extra) => {
      if (date > today) return null;
      const tx = Object.assign({
        id: C.uid('tx'), accountId, date, amount: Math.round(euro * 100), counterparty,
        counterpartyIban: '', description, categoryId: null, categorySource: null, splits: [],
        source: accountId === K ? 'manual' : 'import', transferMode: 'auto'
      }, extra || {});
      txs.push(tx);
      return tx;
    };

    const start = C.addMonths(today.slice(0, 8) + '01', -13);
    for (let m = 0; m <= 13; m++) {
      const first = C.addMonths(start, m);
      const ym = first.slice(0, 8);
      const month = Number(first.slice(5, 7));
      add(Z, ym + '25', 2850 + Math.round(rnd() * 40), 'Werkgever NV', 'Loon ' + C.MONTH_NAMES[month - 1], { counterpartyIban: 'BE10000000000404' });
      add(Z, ym + '01', -925, 'Immo Verhuur BV', 'Huur appartement', { counterpartyIban: 'BE43068999999501' });
      const winter = [11, 12, 1, 2, 3].includes(month);
      const autumn = [10, 4].includes(month);
      add(Z, ym + '12', -(winter ? 165 : autumn ? 120 : 78) - Math.round(rnd() * 10), 'ENGIE Electrabel', 'Domiciliering voorschot energie', { counterpartyIban: 'BE46000325448336' });
      if (month % 2 === 0) add(Z, ym + '20', -(52 + Math.round(rnd() * 6)), 'De Watergroep', 'Voorschotfactuur water');
      add(Z, ym + '05', -17.99, 'NETFLIX.COM', 'Europese domiciliering Netflix');
      add(Z, ym + '09', -11.99, 'Spotify AB', 'Spotify Premium');
      add(Z, ym + '16', -64, 'Proximus', 'Factuur internet + mobiel', { counterpartyIban: 'BE82210000000044' });
      add(Z, ym + '02', -300, 'Mijn Spaarrekening', 'Maandelijkse spaaropdracht', { counterpartyIban: s.accounts[1].iban });
      add(S, ym + '02', 300, 'Mijn Zichtrekening', 'Maandelijkse spaaropdracht', { counterpartyIban: s.accounts[0].iban });
      if (month === 3) add(Z, ym + '15', -385, 'AG Insurance', 'Jaarpremie brandverzekering');
      if (month === 6) add(Z, ym + '28', -129, 'Stad Gent', 'Afvalbelasting');

      for (let w = 0; w < 4; w++) {
        const day = 3 + w * 7 + Math.floor(rnd() * 3);
        const shop = pick(['Colruyt', 'Delhaize', 'Aldi', 'Lidl']);
        add(Z, ym + String(day).padStart(2, '0'), -(35 + Math.round(rnd() * 70 * 100) / 100), shop.toUpperCase() + ' GENT', 'Betaling Bancontact ' + shop + ' Gent');
      }
      const rday = () => String(2 + Math.floor(rnd() * 26)).padStart(2, '0');
      add(Z, ym + rday(), -(25 + Math.round(rnd() * 40)), 'TotalEnergies', 'Tankstation Total Gent');
      if (rnd() > 0.5) add(Z, ym + rday(), -(30 + Math.round(rnd() * 30)), 'TotalEnergies', 'Tankstation Total Gent');
      if (rnd() > 0.4) add(Z, ym + '18', -(9 + Math.round(rnd() * 30)), 'Apotheek De Linde', 'Betaling apotheek');
      if (rnd() > 0.5) add(Z, ym + '22', -(30 + Math.round(rnd() * 60)), 'Zalando', 'Bestelling kleding');
      add(K, ym + rday(), -(5 + Math.round(rnd() * 15)), 'Bakker', 'Cash bakker / markt');
    }

    // Etentje met Tikkie-terugbetaling
    const last = C.addMonths(today.slice(0, 8) + '01', -1).slice(0, 8);
    const dinner = add(Z, last + '19', -148.6, 'Restaurant De Vitrine', 'Betaling Bancontact Restaurant De Vitrine');
    add(Z, last + '21', 37.15, 'Tikkie', 'Tikkie terugbetaling etentje Pieter', { refundOf: dinner.id });
    add(Z, last + '22', 37.15, 'Payconiq', 'Payconiq Sofie etentje');
    // Opgesplitst winkelbezoek
    const thisMonth = today.slice(0, 8);
    const day = Math.min(Number(today.slice(8, 10)), 6);
    const split = add(Z, thisMonth + String(day).padStart(2, '0'), -55, 'COLRUYT GENT', 'Betaling Bancontact Colruyt Gent');
    if (split) {
      split.splits = [
        { categoryId: 'cat_boodschappen', amount: -4000, note: 'voeding' },
        { categoryId: 'cat_huishouden', amount: -1500, note: 'schoonmaakproducten' }
      ];
      split.categorySource = 'manual';
    }

    s.transactions = txs.sort((a, b) => b.date.localeCompare(a.date));
    s.budgets = [
      { id: 'bud_1', categoryId: 'cat_boodschappen', period: 'monthly', limit: 40000, warnAt: 0.8 },
      { id: 'bud_2', categoryId: 'cat_uitgaan', period: 'monthly', limit: 15000, warnAt: 0.8 },
      { id: 'bud_3', categoryId: 'cat_vervoer', period: 'monthly', limit: 8000, warnAt: 0.8 },
      { id: 'bud_4', categoryId: 'cat_kleding', period: 'yearly', limit: 60000, warnAt: 0.8 }
    ];
    s.rules.push({ id: 'rule_resto', name: 'Restaurants', field: 'counterparty', operator: 'regex', value: 'restaurant|brasserie|bistro', categoryId: 'cat_uitgaan', direction: 'out', priority: 300, enabled: true });
    s.rules.push({ id: 'rule_zalando', name: 'Zalando', field: 'counterparty', operator: 'contains', value: 'zalando', categoryId: 'cat_kleding', direction: 'out', priority: 310, enabled: true });
    s.rules.push({ id: 'rule_huur', name: 'Huur', field: 'counterpartyIban', operator: 'equals', value: 'BE43068999999501', categoryId: 'cat_wonen', direction: 'out', priority: 320, enabled: true });
    s.rules.push({ id: 'rule_bakker', name: 'Bakker', field: 'counterparty', operator: 'contains', value: 'bakker', categoryId: 'cat_boodschappen', direction: 'out', priority: 330, enabled: true });
    s.rules.push({ id: 'rule_verz', name: 'Verzekering', field: 'any', operator: 'regex', value: 'insurance|verzekering|ethias|baloise', categoryId: 'cat_verzekering', direction: 'out', priority: 340, enabled: true });
    s.rules.push({ id: 'rule_bel', name: 'Gemeentebelasting', field: 'description', operator: 'contains', value: 'belasting', categoryId: 'cat_belasting', direction: 'out', priority: 350, enabled: true });
    return C.recompute(s);
  }

  const api = { STORAGE_KEY, defaultState, migrate, load, save, clear, demoState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FluxStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
