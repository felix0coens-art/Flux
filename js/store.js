/*
 * Helder — lokale opslag (localStorage), standaardgegevens en demodata.
 */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.FluxCore;

  const STORAGE_KEY = 'flux-data-v1';
  const DEMO_KEY = 'flux-demo-v1';
  /*
   * Schemaversie 3 = de eenmalige "proper starten"-versie: gegevens van vóór versie 3 werden bij die
   * update gewist (op vraag van de gebruiker). BELANGRIJK: dit getal NIET meer verhogen om gegevens te
   * wissen. Nieuwe velden worden voortaan in migrate() toegevoegd, zodat je gegevens elke update overleven.
   */
  const VERSION = 3;

  /*
   * Standaardcategorieën. Er staan bewust GEEN merknamen in: onbekende tegenpartijen worden
   * online opgezocht (Wikidata / OpenStreetMap / optioneel AI) en via de zoekwoorden hieronder,
   * die een *soort* zaak beschrijven, aan een categorie gekoppeld. Je kan ze aanpassen bij Instellingen.
   */
  const DEFAULT_CATEGORIES = [
    ['cat_boodschappen', 'Boodschappen', 'expense', '#2f9e44', 'supermarket, supermarkt, supermarktketen, grocery, kruidenier, levensmiddelen, food retail, retail chain, convenience, bakery, bakkerij, bakker, butcher, slager, slagerij, greengrocer, groenten, cheese, kaas, deli, marketplace, markt, hypermarkt, discount'],
    ['cat_huishouden', 'Huishouden', 'expense', '#66a80f', 'doityourself, doe-het-zelf, bouwmarkt, hardware, houseware, huishoud, variety store, department store, warenhuis, furniture, meubel, interior, interieur, drugstore, drogist, chemist, garden centre, tuincentrum, laundry, wasserette, dry cleaning'],
    ['cat_wonen', 'Huur & wonen', 'expense', '#1971c2', 'real estate, vastgoed, immobili, verhuurder, housing, huisvesting, woning, sociale huisvesting, syndicus, property management'],
    ['cat_nuts', 'Nutsvoorzieningen', 'expense', '#0c8599', 'energy company, energiebedrijf, energieleverancier, energy, energie, electricity, elektriciteit, natural gas, aardgas, electric utility, utility, nutsbedrijf, water supply, waterbedrijf, drinkwater, watermaatschappij, distribution system operator, netbeheerder, stookolie, heating oil'],
    ['cat_abonnementen', 'Abonnementen', 'expense', '#7048e8', 'streaming, video on demand, streamingdienst, music streaming, muziekdienst, subscription, abonnement, software, cloud, online service, webdienst, newspaper, krant, magazine, tijdschrift'],
    ['cat_telecom', 'Telecom & internet', 'expense', '#5f3dc4', 'telecom, telecommunication, telecommunicatie, mobile network, mobile phone operator, mobiele operator, internet service provider, internetprovider, telefonie, cable television, kabel'],
    ['cat_uitgaan', 'Restaurant & uitgaan', 'expense', '#e8590c', 'restaurant, fast food, fast-food, fastfoodketen, cafe, café, bar, pub, brasserie, bistro, horeca, ice cream, ijs, food court, frituur, snackbar, takeaway, food delivery, maaltijdbezorging, nightclub, coffee, koffie, tearoom'],
    ['cat_vervoer', 'Vervoer', 'expense', '#f08c00', 'fuel, tankstation, petrol, gas station, filling station, brandstof, charging station, laadpaal, public transport, openbaar vervoer, openbaarvervoerbedrijf, vervoersmaatschappij, railway, spoorweg, train, trein, treinticket, busticket, vliegticket, vervoerbewijs, bus, tram, parking, parkeer, taxi, car rental, autoverhuur, car repair, garage, car wash, airline, luchtvaartmaatschappij, bicycle, fiets, toll, tol'],
    ['cat_gezondheid', 'Gezondheid', 'expense', '#c2255c', 'pharmacy, apotheek, doctor, dokter, huisarts, arts, dentist, tandarts, hospital, ziekenhuis, clinic, kliniek, health, gezondheid, health insurance, ziekenfonds, mutualiteit, ziekenkas, optician, opticien, physiotherapist, kinesitherapeut, kinesist, laboratory, labo'],
    ['cat_kleding', 'Kleding', 'expense', '#d6336c', 'clothes, kleding, kledingwinkel, fashion, mode, modeketen, shoes, schoenen, schoenwinkel, apparel, textile, lingerie, sportswear'],
    ['cat_vrijetijd', 'Vrije tijd & hobby', 'expense', '#ae3ec9', 'cinema, bioscoop, theatre, theater, sports, sport, sportwinkel, sporting goods, fitness, fitnesscentrum, swimming, zwembad, museum, leisure, recreatie, books, boekhandel, toys, speelgoed, electronics, elektronica, video game, concert, concertticket, festival, hobby, travel agency, reisbureau, hotel, camping, amusement park, pretpark, zoo, dierentuin'],
    ['cat_verzekering', 'Verzekeringen', 'expense', '#495057', 'insurance, verzekering, verzekeraar, assurance, insurance company, verzekeringsmaatschappij, bank, bankassurance'],
    ['cat_belasting', 'Belastingen & overheid', 'expense', '#868e96', 'tax, belasting, belastingdienst, government, overheid, overheidsdienst, government agency, municipality, gemeente, stad, city, federale overheidsdienst, public service, provincie, police, politie'],
    ['cat_cadeaus', 'Cadeaus & goede doelen', 'expense', '#f76707', 'gift, cadeau, geschenk, florist, bloemen, bloemist, charity, liefdadigheid, goede doel, non-profit, ngo, foundation, stichting'],
    ['cat_onderwijs', 'Kinderen & onderwijs', 'expense', '#1098ad', 'school, onderwijs, education, university, universiteit, hogeschool, childcare, kinderopvang, crèche, daycare, kindergarten, jeugdbeweging, youth organization'],
    ['cat_overig', 'Overige uitgaven', 'expense', '#adb5bd', ''],
    // Systeemcategorieën: tellen niet als inkomen of uitgave
    ['sys_voorschot', 'Voorschot voor iemand anders', 'advance', '#15aabf', ''],
    ['sys_belegging', 'Beleggingen (storting / opname)', 'investment', '#4c6ef5', '']
  ].map(toCategory);

  function toCategory([id, name, kind, color, lookupTags, incomeId]) {
    return Object.assign({ id, name, kind, color, lookupTags }, incomeId ? { incomeId } : {});
  }

  /*
   * Inkomstenbronnen kies je volledig zelf (tabblad Inkomsten). Deze voorbeeldbronnen worden
   * enkel in de voorbeeldmodus gebruikt.
   */
  const DEMO_INCOME_CATEGORIES = [
    ['cat_loon', 'Loon', 'income', '#37b24d', 'employer, werkgever, salary, loon, wedde, payroll, sociaal secretariaat'],
    ['cat_bijberoep', 'Bijberoep / zelfstandige', 'income', '#74b816', 'invoice, factuur, honorarium, freelance'],
    ['cat_inkomsten', 'Andere inkomsten', 'income', '#a9e34b', 'child benefit, groeipakket, kinderbijslag, uitkering'],
    ['cat_kost_bijberoep', 'Kosten bijberoep', 'expense', '#94d82d', '', 'cat_bijberoep']
  ].map(toCategory);

  function defaultState() {
    return {
      version: VERSION,
      // Bankrekeningen worden aangemaakt bij de eerste import (op basis van de IBAN in het bestand)
      accounts: [
        { id: 'acc_cash', name: 'Cash', iban: '', type: 'cash' }
      ],
      imports: [],
      people: [], // personen voor voorschotten (naam, IBAN's om terugbetalingen te herkennen)
      deleted: [], // verwijderde transacties uit bestanden/bankkoppeling: worden bij een volgende import overgeslagen
      categories: DEFAULT_CATEGORIES.map(c => Object.assign({}, c)),
      rules: [],
      budgets: [],
      transactions: [],
      subscriptions: {},
      tombstones: {},
      settings: { warnAt: 0.8, lookupProvider: 'auto', lookupCountries: 'be', autoLookup: true, investPattern: 'degiro|flatex' }
    };
  }

  function migrate(data) {
    // Gegevens van vóór versie 3: proper opnieuw beginnen
    if (!data || (data.version || 1) < VERSION) {
      const fresh = defaultState();
      fresh.tombstones = {};
      return fresh;
    }
    const base = defaultState();
    const s = Object.assign(base, data);
    for (const k of ['accounts', 'categories', 'rules', 'budgets', 'transactions', 'imports', 'deleted', 'people']) if (!Array.isArray(s[k])) s[k] = [];
    if (!s.subscriptions || typeof s.subscriptions !== 'object') s.subscriptions = {};
    if (!s.tombstones || typeof s.tombstones !== 'object') s.tombstones = {};
    s.settings = Object.assign({ warnAt: 0.8, lookupProvider: 'auto', lookupCountries: 'be', autoLookup: true, investPattern: 'degiro|flatex' }, s.settings || {});
    // Systeemcategorieën zijn altijd aanwezig
    for (const id of ['sys_voorschot', 'sys_belegging']) {
      if (!s.categories.some(c => c.id === id)) s.categories.push(Object.assign({}, DEFAULT_CATEGORIES.find(c => c.id === id)));
    }
    for (const t of s.transactions) {
      if (!Array.isArray(t.splits)) t.splits = [];
      if (!t.transferMode) t.transferMode = 'auto';
    }
    s.version = VERSION;
    return s;
  }

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  function load(key) {
    try {
      const ls = storage();
      const raw = ls && ls.getItem(key || STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        const state = C.recompute(migrate(data));
        // Gegevens van een oudere versie: meteen ook uit de opslag wissen
        if ((data.version || 1) < VERSION) ls.setItem(key || STORAGE_KEY, JSON.stringify(state));
        return state;
      }
    } catch (e) {
      console.error('Helder: kon gegevens niet laden', e);
    }
    return defaultState();
  }

  function save(state, key) {
    try {
      storage().setItem(key || STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('Helder: kon gegevens niet opslaan', e);
      return false;
    }
  }

  function clear(key) {
    try { storage().removeItem(key || STORAGE_KEY); } catch (e) { /* negeren */ }
  }

  // ---------- Voorbeeldgegevens (enkel voor de zandbak) ----------

  /**
   * Genereert ±14 maanden voorbeeldgegevens. Deze worden NOOIT met je echte gegevens gemengd:
   * de app toont ze in een aparte voorbeeldmodus die niet gesynchroniseerd wordt.
   */
  function demoState(today) {
    today = today || C.todayStr();
    let seed = 42;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const pick = arr => arr[Math.floor(rnd() * arr.length)];

    const s = defaultState();
    s.demo = true;
    s.categories = s.categories.concat(DEMO_INCOME_CATEGORIES.map(c => Object.assign({}, c)));
    s.accounts = [
      { id: 'acc_kbc', name: 'KBC zichtrekening', iban: 'BE68539007547034', type: 'zicht', bank: 'kbc' },
      { id: 'acc_argenta', name: 'Argenta spaarrekening', iban: 'BE12973000000092', type: 'spaar', bank: 'argenta' },
      { id: 'acc_cash', name: 'Cash', iban: '', type: 'cash' }
    ];
    const K = 'acc_kbc', A = 'acc_argenta', CASH = 'acc_cash';
    const imports = {
      [K]: { id: 'imp_demo_kbc', fileName: 'voorbeeld-kbc.csv', fileHash: 'demo1', bank: 'kbc', bankName: 'KBC / CBC', accountId: K, importedAt: today + 'T08:00:00.000Z', count: 0, duplicates: 0, errors: 0 },
      [A]: { id: 'imp_demo_argenta', fileName: 'voorbeeld-argenta.csv', fileHash: 'demo2', bank: 'argenta', bankName: 'Argenta', accountId: A, importedAt: today + 'T08:00:00.000Z', count: 0, duplicates: 0, errors: 0 }
    };
    const txs = [];
    const add = (accountId, date, euro, counterparty, description, categoryId, extra) => {
      if (date > today) return null;
      const imp = imports[accountId];
      const tx = Object.assign({
        id: C.uid('tx'), accountId, date, amount: Math.round(euro * 100), counterparty,
        counterpartyIban: '', description, categoryId: categoryId || null, categorySource: categoryId ? 'manual' : null, splits: [],
        source: imp ? 'import' : 'manual', importId: imp ? imp.id : undefined, transferMode: 'auto'
      }, extra || {});
      if (imp) imp.count++;
      txs.push(tx);
      return tx;
    };

    const start = C.addMonths(today.slice(0, 8) + '01', -13);
    for (let m = 0; m <= 13; m++) {
      const first = C.addMonths(start, m);
      const ym = first.slice(0, 8);
      const month = Number(first.slice(5, 7));
      const rday = () => String(2 + Math.floor(rnd() * 26)).padStart(2, '0');
      // Inkomsten
      add(K, ym + '25', 2850 + Math.round(rnd() * 40), 'Werkgever NV', 'Loon ' + C.MONTH_NAMES[month - 1], 'cat_loon', { counterpartyIban: 'BE10000000000404' });
      add(K, ym + '08', 163.2, 'Groeipakket Fons', 'Groeipakket ' + C.MONTH_NAMES[month - 1], 'cat_inkomsten');
      if (m % 2 === 0) add(K, ym + '15', 900 + Math.round(rnd() * 600), 'Klant Studio BV', 'Factuur 2026-' + String(m + 10).padStart(3, '0'), 'cat_bijberoep');
      if (m % 3 === 1) {
        const p = add(K, ym + '20', 405, 'Freelance Platform', 'Uitbetaling opdracht', 'cat_bijberoep');
        if (p) p.splits = [{ categoryId: 'cat_bijberoep', amount: 45000, note: 'honorarium' }, { categoryId: 'cat_kost_bijberoep', amount: -4500, note: 'commissie platform' }];
      }
      add(K, ym + '03', -24.19, 'Adobe Systems', 'Creative Cloud abonnement', 'cat_kost_bijberoep');
      // Vaste lasten
      add(K, ym + '01', -925, 'Immo Verhuur BV', 'Huur appartement', 'cat_wonen', { counterpartyIban: 'BE43068999999501' });
      const winter = [11, 12, 1, 2, 3].includes(month);
      add(K, ym + '12', -(winter ? 165 : [10, 4].includes(month) ? 120 : 78) - Math.round(rnd() * 10), 'ENGIE Electrabel', 'Domiciliering voorschot energie', 'cat_nuts');
      add(K, ym + '05', -17.99, 'NETFLIX.COM', 'Europese domiciliering Netflix', 'cat_abonnementen');
      add(K, ym + '16', -64, 'Proximus', 'Factuur internet + mobiel', 'cat_telecom');
      // Sparen en beleggen
      add(K, ym + '02', -300, 'Argenta spaarrekening', 'Maandelijkse spaaropdracht', null, { counterpartyIban: 'BE12973000000092' });
      add(A, ym + '02', 300, 'KBC zichtrekening', 'Maandelijkse spaaropdracht', null, { counterpartyIban: 'BE68539007547034' });
      add(K, ym + '04', -200, 'flatexDEGIRO Bank', 'Storting beleggingsrekening', null);
      // Variabele uitgaven
      for (let w = 0; w < 4; w++) {
        const shop = pick(['Colruyt', 'Delhaize', 'Aldi', 'Lidl']);
        add(K, ym + String(3 + w * 7 + Math.floor(rnd() * 3)).padStart(2, '0'), -(35 + Math.round(rnd() * 7000) / 100), '', 'BETALING VIA BANCONTACT ' + shop.toUpperCase() + ' GENT', 'cat_boodschappen');
      }
      add(K, ym + rday(), -(25 + Math.round(rnd() * 40)), 'TotalEnergies', 'Tankstation Gent', 'cat_vervoer');
      if (rnd() > 0.5) add(K, ym + '22', -(30 + Math.round(rnd() * 60)), 'Zalando', 'Bestelling kleding', 'cat_kleding');
      add(CASH, ym + rday(), -(5 + Math.round(rnd() * 15)), 'Bakker', 'Cash bakker / markt', 'cat_boodschappen');
    }

    // Etentje: deels eigen uitgave, deels voorgeschoten voor twee vrienden
    const last = C.addMonths(today.slice(0, 8) + '01', -1).slice(0, 8);
    const dinner = add(K, last + '19', -148.5, 'Restaurant De Vitrine', 'BETALING VIA BANCONTACT RESTAURANT DE VITRINE', null);
    dinner.splits = [
      { categoryId: 'cat_uitgaan', amount: -4950, note: 'mijn deel' },
      { categoryId: 'sys_voorschot', amount: -4950, person: 'Pieter', note: 'etentje' },
      { categoryId: 'sys_voorschot', amount: -4950, person: 'Sofie', note: 'etentje' }
    ];
    dinner.categorySource = 'manual';
    add(K, last + '21', 49.5, 'Tikkie', 'Tikkie Pieter etentje', 'sys_voorschot', { person: 'Pieter', advanceOf: dinner.id });
    add(K, last + '23', 25, 'Sofie Janssens', 'Deel etentje', null); // nog te koppelen
    // Concertticket voorgeschoten
    add(K, today.slice(0, 8) + '02', -65, 'Ticketmaster', 'Ticket concert voor Lotte', 'sys_voorschot', { person: 'Lotte' });
    // Nog onbekende tegenpartijen
    const day = String(Math.min(Number(today.slice(8, 10)), 6)).padStart(2, '0');
    add(K, today.slice(0, 8) + day, -12.4, 'KRUIDVAT GENT', 'Betaling Bancontact Kruidvat');
    add(K, today.slice(0, 8) + day, -34.99, 'DECATHLON GENT', 'Betaling Bancontact Decathlon');

    s.transactions = txs.sort((a, b) => b.date.localeCompare(a.date));
    s.imports = Object.values(imports).map(i => Object.assign(i, {
      period: (() => { const d = txs.filter(t => t.importId === i.id).map(t => t.date).sort(); return d.length ? { from: d[0], to: d[d.length - 1] } : null; })()
    }));
    // Gekend beginsaldo vóór de eerste transactie; Helder rekent de rest uit de transacties
    const before = C.addDays(start, -1);
    s.accounts[0].balance = { date: before, amount: 350000, source: 'manual' };
    s.accounts[1].balance = { date: before, amount: 800000, source: 'manual' };
    s.budgets = [
      { id: 'bud_1', categoryId: 'cat_boodschappen', period: 'monthly', limit: 40000, warnAt: 0.8 },
      { id: 'bud_2', categoryId: 'cat_uitgaan', period: 'monthly', limit: 15000, warnAt: 0.8 },
      { id: 'bud_3', categoryId: 'cat_kleding', period: 'yearly', limit: 60000, warnAt: 0.8 }
    ];
    // Beleggingen (Degiro)
    const months = [];
    for (let m = 0; m <= 13; m++) months.push(C.addMonths(start, m).slice(0, 8) + '05');
    s.investments = {
      source: 'demo', syncedAt: today + 'T08:00:00.000Z', positionsDate: today, cashEur: 1230,
      positions: [
        { key: 'IE00BK5BQT80', name: 'Vanguard FTSE All-World UCITS ETF (Acc)', isin: 'IE00BK5BQT80', currency: 'EUR', quantity: 18, price: 128.4, valueEur: 231120 },
        { key: 'IE00B4L5Y983', name: 'iShares Core MSCI World UCITS ETF', isin: 'IE00B4L5Y983', currency: 'EUR', quantity: 6, price: 104.1, valueEur: 62460 }
      ],
      trades: months.filter(d => d <= today).map((d, i) => ({ id: 'demo|' + d, date: d, isin: i % 3 === 2 ? 'IE00B4L5Y983' : 'IE00BK5BQT80', name: i % 3 === 2 ? 'iShares Core MSCI World UCITS ETF' : 'Vanguard FTSE All-World UCITS ETF (Acc)', quantity: i % 3 === 2 ? 2 : 1.5, price: 0, currency: 'EUR', totalEur: -19900, feesEur: -100 })),
      movements: months.filter(d => d <= today).flatMap(d => [
        { id: 'demo|dep|' + d, date: d.slice(0, 8) + '04', type: 'deposit', amountEur: 20000, description: 'flatex Storting' },
        { id: 'demo|fee|' + d, date: d, type: 'fee', amountEur: -100, description: 'DEGIRO Transactiekosten' }
      ]).concat([{ id: 'demo|div', date: last + '15', type: 'dividend', amountEur: 1840, description: 'Dividend', isin: 'IE00B4L5Y983' }, { id: 'demo|divtax', date: last + '15', type: 'dividend_tax', amountEur: -276, description: 'Dividendbelasting', isin: 'IE00B4L5Y983' }]),
      // Waardering op elk maandeinde (zoals een portefeuille-export per maand)
      history: months.map(d => C.addDays(C.addMonths(d.slice(0, 8) + '01', 1), -1)).filter(d => d <= today)
        .map((d, i) => ({ date: d, valueEur: Math.round((i + 1) * 20000 * (1 + 0.011 * i + (i % 4 === 3 ? -0.03 : 0))), source: 'demo' }))
        .concat([{ date: today, valueEur: 294810, source: 'demo' }])
    };
    return C.recompute(s);
  }

  const api = { STORAGE_KEY, DEMO_KEY, VERSION, DEFAULT_CATEGORIES, DEMO_INCOME_CATEGORIES, defaultState, migrate, load, save, clear, demoState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FluxStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
