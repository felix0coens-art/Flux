/*
 * Helder — licht/donker en "bedragen verbergen", al toegepast vóór de pagina getekend wordt
 * (zodat ze niet even oplicht of bedragen toont). De keuze geldt per toestel.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  try {
    var t = localStorage.getItem('helder-theme');
    if (t === 'dark' || t === 'light') root.setAttribute('data-theme', t);
    if (localStorage.getItem('helder-privacy') === '1') root.classList.add('privacy');
  } catch (e) { /* geen opslag: volg het toestel */ }
})();
