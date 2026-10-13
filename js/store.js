/*
 * Flux — lokale opslag (localStorage), standaardgegevens en demodata.
 */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.FluxCore;

  const STORAGE_KEY = 'flux-data-v1';
  const VERSION = 2;

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
    ['cat_vervoer', 'Vervoer', 'expense', '#f08c00', 'fuel, tankstation, petrol, gas station, filling station, brandstof, charging station, laadpaal, public transport, openbaar vervoer, openbaarvervoerbedrijf, vervoersmaatschappij, railway, spoorweg, train, trein, bus, tram, parking, parkeer, taxi, car rental, autoverhuur, car repair, garage, car wash, airline, luchtvaartmaatschappij, bicycle, fiets, toll, tol'],
    ['cat_gezondheid', 'Gezondheid', 'expense', '#c2255c', 'pharmacy, apotheek, doctor, dokter, huisarts, arts, dentist, tandarts, hospital, ziekenhuis, clinic, kliniek, health, gezondheid, health insurance, ziekenfonds, mutualiteit, ziekenkas, optician, opticien, physiotherapist, kinesitherapeut, kinesist, laboratory, labo'],
    ['cat_kleding', 'Kleding', 'expense', '#d6336c', 'clothes, kleding, kledingwinkel, fashion, mode, modeketen, shoes, schoenen, schoenwinkel, apparel, textile, lingerie, sportswear'],
    ['cat_vrijetijd', 'Vrije tijd & hobby', 'expense', '#ae3ec9', 'cinema, bioscoop, theatre, theater, sports, sport, sportwinkel, sporting goods, fitness, fitnesscentrum, swimming, zwembad, museum, leisure, recreatie, books, boekhandel, toys, speelgoed, electronics, elektronica, video game, concert, ticket, hobby, travel agency, reisbureau, hotel, camping, amusement park, pretpark, zoo, dierentuin'],
    ['cat_verzekering', 'Verzekeringen', 'expense', '#495057', 'insurance, verzekering, verzekeraar, assurance, insurance company, verzekeringsmaatschappij, bank, bankassurance'],
    ['cat_belasting', 'Belastingen & overheid', 'expense', '#868e96', 'tax, belasting, belastingdienst, government, overheid, overheidsdienst, government agency, municipality, gemeente, stad, city, federale overheidsdienst, public service, provincie, police, politie'],
    ['cat_cadeaus', 'Cadeaus & goede doelen', 'expense', '#f76707', 'gift, cadeau, geschenk, florist, bloemen, bloemist, charity, liefdadigheid, goede doel, non-profit, ngo, foundation, stichting'],
    ['cat_onderwijs', 'Kinderen & onderwijs', 'expense', '#1098ad', 'school, onderwijs, education, university, universiteit, hogeschool, childcare, kinderopvang, crèche, daycare, kindergarten, jeugdbeweging, youth organization'],
    ['cat_overig', 'Overige uitgaven', 'expense', '#adb5bd', ''],
    // Inkomstenbronnen — hernoem ze naar je eigen drie bronnen
    ['cat_loon', 'Loon', 'income', '#37b24d', 'employer, werkgever, salary, loon, wedde, payroll, sociaal secretariaat, payroll company'],
    ['cat_bijberoep', 'Bijberoep / zelfstandige', 'income', '#74b816', 'invoice, factuur, honorarium, client, klant, freelance'],
    ['cat_inkomsten', 'Andere inkomsten', 'income', '#a9e34b', 'child benefit, groeipakket, kinderbijslag, uitkering, benefit, rva, social security, sociale zekerheid, pension, pensioen, tax refund, rent income, huurinkomsten'],
    // Kosten die van een inkomstenbron worden afgetrokken (incomeId)
    ['cat_kost_bijberoep', 'Kosten bijberoep', 'expense', '#94d82d', '', 'cat_bijberoep']
  ].map(([id, name, kind, color, lookupTags, incomeId]) => Object.assign({ id, name, kind, color, lookupTags }, incomeId ? { incomeId } : {}));

  function defaultState() {
    return {
      version: VERSION,
      accounts: [
        { id: 'acc_zicht', name: 'Zichtrekening', iban: '', type: 'zicht' },
        { id: 'acc_spaar', name: 'Spaarrekening', iban: '', type: 'spaar' },
        { id: 'acc_cash', name: 'Cash', iban: '', type: 'cash' }
      ],
      categories: DEFAULT_CATEGORIES.map(c => Object.assign({}, c)),
      rules: [],
      budgets: [],
      transactions: [],
      subscriptions: {},
      tombstones: {},
      settings: { warnAt: 0.8, lookupProvider: 'auto', lookupCountries: 'be', autoLookup: true }
    };
  }

  function migrate(data) {
    const base = defaultState();
    const s = Object.assign(base, data || {});
    for (const k of ['accounts', 'categories', 'rules', 'budgets', 'transactions']) if (!Array.isArray(s[k])) s[k] = [];
    if (!s.subscriptions || typeof s.subscriptions !== 'object') s.subscriptions = {};
    if (!s.tombstones || typeof s.tombstones !== 'object') s.tombstones = {};
    s.settings = Object.assign({ warnAt: 0.8, lookupProvider: 'auto', lookupCountries: 'be', autoLookup: true }, s.settings || {});
    for (const t of s.transactions) {
      if (!Array.isArray(t.splits)) t.splits = [];
      if (!t.transferMode) t.transferMode = 'auto';
    }
    // Van versie 1: zoekwoorden toevoegen aan bestaande standaardcategorieën
    if ((data && data.version || 1) < 2) {
      for (const c of s.categories) {
        const def = DEFAULT_CATEGORIES.find(d => d.id === c.id);
        if (def && c.lookupTags == null) c.lookupTags = def.lookupTags;
      }
    }
    s.version = VERSION;
    return s;
  }

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  function load() {
    try {
      const ls = storage();
      const raw = ls && ls.getItem(STORAGE_KEY);
      if (raw) return C.recompute(migrate(JSON.parse(raw)));
    } catch (e) {
      console.error('Flux: kon gegevens niet laden', e);
    }
    return defaultState();
  }

  function save(state) {
    try {
      storage().setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('Flux: kon gegevens niet opslaan', e);
      return false;
    }
  }

  function clear() {
    try { storage().removeItem(STORAGE_KEY); } catch (e) { /* negeren */ }
  }

  // ---------- Demodata ----------

  /**
   * Genereert ±14 maanden voorbeeldtransacties om Flux uit te proberen: drie inkomstenbronnen
   * (loon, bijberoep met kosten en een afgehouden commissie, groeipakket), vaste lasten, spaaropdrachten,
   * een gesplitst kasticket en een terugbetaling. De categorieën zijn toegewezen alsof je ze al eens
   * bevestigde; een paar recente tegenpartijen zijn nog onbekend zodat je het online opzoeken kan proberen.
   */
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
    const add = (accountId, date, euro, counterparty, description, categoryId, extra) => {
      if (date > today) return null;
      const tx = Object.assign({
        id: C.uid('tx'), accountId, date, amount: Math.round(euro * 100), counterparty,
        counterpartyIban: '', description, categoryId: categoryId || null, categorySource: categoryId ? 'manual' : null, splits: [],
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
      const rday = () => String(2 + Math.floor(rnd() * 26)).padStart(2, '0');
      // Inkomsten
      add(Z, ym + '25', 2850 + Math.round(rnd() * 40), 'Werkgever NV', 'Loon ' + C.MONTH_NAMES[month - 1], 'cat_loon', { counterpartyIban: 'BE10000000000404' });
      add(Z, ym + '08', 163.2, 'Groeipakket Fons', 'Groeipakket ' + C.MONTH_NAMES[month - 1], 'cat_inkomsten');
      if (m % 2 === 0) {
        const fee = 900 + Math.round(rnd() * 600);
        const inv = add(Z, ym + '15', fee, 'Klant Studio BV', 'Factuur 2026-' + String(m + 10).padStart(3, '0'), 'cat_bijberoep');
        if (inv) inv.categorySource = 'manual';
      }
      // Platform dat een commissie afhoudt: ontvangen netto = bruto − commissie (gesplitst)
      if (m % 3 === 1) {
        const p = add(Z, ym + '20', 405, 'Freelance Platform', 'Uitbetaling opdracht', 'cat_bijberoep');
        if (p) p.splits = [{ categoryId: 'cat_bijberoep', amount: 45000, note: 'honorarium' }, { categoryId: 'cat_kost_bijberoep', amount: -4500, note: 'commissie platform' }];
      }
      add(Z, ym + '03', -24.19, 'Adobe Systems', 'Creative Cloud abonnement', 'cat_kost_bijberoep');
      // Vaste lasten
      add(Z, ym + '01', -925, 'Immo Verhuur BV', 'Huur appartement', 'cat_wonen', { counterpartyIban: 'BE43068999999501' });
      const winter = [11, 12, 1, 2, 3].includes(month);
      const autumn = [10, 4].includes(month);
      add(Z, ym + '12', -(winter ? 165 : autumn ? 120 : 78) - Math.round(rnd() * 10), 'ENGIE Electrabel', 'Domiciliering voorschot energie', 'cat_nuts', { counterpartyIban: 'BE46000325448336' });
      if (month % 2 === 0) add(Z, ym + '20', -(52 + Math.round(rnd() * 6)), 'De Watergroep', 'Voorschotfactuur water', 'cat_nuts');
      add(Z, ym + '05', -17.99, 'NETFLIX.COM', 'Europese domiciliering Netflix', 'cat_abonnementen');
      add(Z, ym + '09', -11.99, 'Spotify AB', 'Spotify Premium', 'cat_abonnementen');
      add(Z, ym + '16', -64, 'Proximus', 'Factuur internet + mobiel', 'cat_telecom', { counterpartyIban: 'BE82210000000044' });
      add(Z, ym + '02', -300, 'Mijn Spaarrekening', 'Maandelijkse spaaropdracht', null, { counterpartyIban: s.accounts[1].iban });
      add(S, ym + '02', 300, 'Mijn Zichtrekening', 'Maandelijkse spaaropdracht', null, { counterpartyIban: s.accounts[0].iban });
      if (month === 3) add(Z, ym + '15', -385, 'AG Insurance', 'Jaarpremie brandverzekering', 'cat_verzekering');
      if (month === 6) add(Z, ym + '28', -129, 'Stad Gent', 'Afvalbelasting', 'cat_belasting');
      // Variabele uitgaven
      for (let w = 0; w < 4; w++) {
        const day = 3 + w * 7 + Math.floor(rnd() * 3);
        const shop = pick(['Colruyt', 'Delhaize', 'Aldi', 'Lidl']);
        add(Z, ym + String(day).padStart(2, '0'), -(35 + Math.round(rnd() * 70 * 100) / 100), shop.toUpperCase() + ' GENT', 'Betaling Bancontact ' + shop + ' Gent', 'cat_boodschappen');
      }
      add(Z, ym + rday(), -(25 + Math.round(rnd() * 40)), 'TotalEnergies', 'Tankstation Total Gent', 'cat_vervoer');
      if (rnd() > 0.5) add(Z, ym + rday(), -(30 + Math.round(rnd() * 30)), 'TotalEnergies', 'Tankstation Total Gent', 'cat_vervoer');
      if (rnd() > 0.4) add(Z, ym + '18', -(9 + Math.round(rnd() * 30)), 'Apotheek De Linde', 'Betaling apotheek', 'cat_gezondheid');
      if (rnd() > 0.5) add(Z, ym + '22', -(30 + Math.round(rnd() * 60)), 'Zalando', 'Bestelling kleding', 'cat_kleding');
      add(K, ym + rday(), -(5 + Math.round(rnd() * 15)), 'Bakker', 'Cash bakker / markt', 'cat_boodschappen');
    }

    // Etentje met Tikkie-terugbetaling
    const last = C.addMonths(today.slice(0, 8) + '01', -1).slice(0, 8);
    const dinner = add(Z, last + '19', -148.6, 'Restaurant De Vitrine', 'Betaling Bancontact Restaurant De Vitrine', 'cat_uitgaan');
    add(Z, last + '21', 37.15, 'Tikkie', 'Tikkie terugbetaling etentje Pieter', null, { refundOf: dinner.id });
    add(Z, last + '22', 37.15, 'Payconiq', 'Payconiq Sofie etentje');
    // Gesplitst winkelbezoek
    const thisMonth = today.slice(0, 8);
    const day = String(Math.min(Number(today.slice(8, 10)), 6)).padStart(2, '0');
    const split = add(Z, thisMonth + day, -55, 'COLRUYT GENT', 'Betaling Bancontact Colruyt Gent', 'cat_boodschappen');
    if (split) split.splits = [
      { categoryId: 'cat_boodschappen', amount: -4000, note: 'voeding' },
      { categoryId: 'cat_huishouden', amount: -1500, note: 'schoonmaakproducten' }
    ];
    // Nog onbekende tegenpartijen: probeer "Online opzoeken"
    add(Z, thisMonth + day, -12.4, 'KRUIDVAT GENT', 'Betaling Bancontact Kruidvat');
    add(Z, thisMonth + day, -34.99, 'DECATHLON GENT', 'Betaling Bancontact Decathlon');
    add(Z, thisMonth + day, -3, 'De Lijn', 'Ticket De Lijn app');

    s.transactions = txs.sort((a, b) => b.date.localeCompare(a.date));
    s.budgets = [
      { id: 'bud_1', categoryId: 'cat_boodschappen', period: 'monthly', limit: 40000, warnAt: 0.8 },
      { id: 'bud_2', categoryId: 'cat_uitgaan', period: 'monthly', limit: 15000, warnAt: 0.8 },
      { id: 'bud_3', categoryId: 'cat_vervoer', period: 'monthly', limit: 8000, warnAt: 0.8 },
      { id: 'bud_4', categoryId: 'cat_kleding', period: 'yearly', limit: 60000, warnAt: 0.8 }
    ];
    return C.recompute(s);
  }

  const api = { STORAGE_KEY, VERSION, DEFAULT_CATEGORIES, defaultState, migrate, load, save, clear, demoState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FluxStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
