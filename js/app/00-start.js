/*
 * Helder — gebruikersinterface.
 *
 * Tabbladen: Overzicht · Bank · Inkomsten · Uitgaven · Beleggingen · Instellingen.
 * Principe: het moet altijd duidelijk zijn wat je aan Helder gaf. Elke transactie heeft een herkomst
 * (een import met bestandsnaam, of "manueel"), elk bestand kan maar één keer opgeladen worden en een
 * import kan volledig ongedaan gemaakt worden. Voorbeeldgegevens leven in een aparte zandbak.
 */
(function () {
  'use strict';
  const C = window.FluxCore;
  const Store = window.FluxStore;
  const Sync = window.FluxSync;
  const Lookup = window.FluxLookup;
  const Banks = window.FluxBanks;
  const Invest = window.FluxInvest;

  const today = C.todayStr();
  let realState = Store.load();
  let demo = null; // voorbeeldgegevens (zandbak), nooit gesynchroniseerd
  try { if (localStorage.getItem('flux-demo-active') === '1') demo = Store.load(Store.DEMO_KEY); } catch (e) { /* geen opslag */ }
  if (demo && !demo.demo) demo = null;
  let state = demo || realState;
  let snap = C.snapshot(realState);

  const LOGO = '<svg class="logo-icon" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="currentColor"/><text x="32" y="47" text-anchor="middle" font-family="Rethink Sans, system-ui, sans-serif" font-weight="800" font-size="44" fill="#fff">€</text></svg>';
  const VIEWS = ['dashboard', 'bank', 'income', 'expenses', 'advances', 'invest', 'settings'];
  // Oude adressen: Acties staat nu samen met Voorschotten onder "Terug te krijgen".
  const viewOf = v => v === 'actions' ? 'advances' : v;
  const ui = {
    view: VIEWS.includes(viewOf((location.hash || '').slice(1))) ? viewOf(location.hash.slice(1)) : 'dashboard',
    owed: (location.hash || '') === '#actions' ? 'act' : 'all', // filter op "Terug te krijgen": all | adv | act
    range: { from: today.slice(0, 7), to: today.slice(0, 7) }, // gekozen periode (maanden), gedeeld door Overzicht/Inkomsten/Uitgaven
    bank: { account: '', category: '', status: 'todo', search: '', limit: 150 },
    list: { status: '', limit: 150 },
    ruleHint: null, // { txId, categoryId } na een inline koppeling: "altijd zo?"
    auth: null,
    sync: { mode: 'local', status: 'idle' },
    keepOpen: {} // uitklapbare blokken die open moeten blijven bij het verversen
  };
  let modal = null;

