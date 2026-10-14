/*
 * Helder — tegenpartijen online opzoeken.
 *
 * In plaats van een vaste lijst merken zoekt Helder elke onbekende tegenpartij op in open bronnen:
 *  - Wikidata: wat voor organisatie het is ("Belgische supermarktketen", "openbaarvervoerbedrijf", ...)
 *  - OpenStreetMap (Nominatim): wat voor zaak het is (shop=supermarket, amenity=pharmacy, ...)
 * Het resultaat wordt via de zoekwoorden van je categorieën aan een categorie gekoppeld
 * (zie FluxCore.matchCategory). Werkt in de browser (window.FluxLookup) en in Node.
 */
(function (root) {
  'use strict';

  const NOISE = /\b(betaling|bancontact|maestro|visa|mastercard|debit|debet|kaart(nummer)?|card|contactloos|contactless|apple ?pay|google ?pay|payconiq|europese|domiciliering|sepa|overschrijving|instant|aankoop|purchase|terminal|ref(erentie)?|mededeling|via|online|nv|bv|bvba|sa|srl|sprl|vzw|gmbh|ltd|inc|b\.v\.|n\.v\.)\b/gi;

  /** Maakt van "BETALING BANCONTACT COLRUYT 3412 GENT 12/10" zoektermen: ["colruyt gent", "colruyt"]. */
  function searchTerms(name, description) {
    const clean = s => String(s || '')
      .replace(/\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?/g, ' ')
      .replace(/\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}\b/g, ' ') // IBAN
      .replace(NOISE, ' ')
      .replace(/[*#_]/g, ' ')
      .replace(/\d+/g, ' ')
      .replace(/\.(com|be|nl|eu|net|org|fr|de)\b/gi, ' ')
      .replace(/[^\p{L}\s&'-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const base = clean(name) || clean(description);
    const words = base.split(' ').filter(w => w.length > 1);
    const terms = [];
    const add = t => { t = t.trim(); if (t.length >= 3 && !terms.some(x => x.toLowerCase() === t.toLowerCase())) terms.push(t); };
    add(words.slice(0, 3).join(' '));
    add(words.slice(0, 2).join(' '));
    if (words[0] && words[0].length >= 4) add(words[0]);
    return terms.slice(0, 3);
  }

  async function getJson(url, fetchFn, headers, timeoutMs) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || 8000) : null;
    try {
      const res = await fetchFn(url, { headers: headers || {}, signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function pickLang(obj, langs) {
    if (!obj) return '';
    for (const l of langs) if (obj[l] && obj[l].value) return obj[l].value;
    const any = Object.values(obj)[0];
    return any && any.value ? any.value : '';
  }

  /** Wikidata: zoekt de organisatie en haalt "is een" (P31) en "sector" (P452) op. */
  async function wikidata(term, opts) {
    const f = opts.fetch, h = opts.headers;
    const langs = ['nl', 'en', 'fr'];
    const api = 'https://www.wikidata.org/w/api.php?format=json&origin=*';
    let hit = null;
    for (const lang of ['nl', 'en']) {
      const r = await getJson(`${api}&action=wbsearchentities&type=item&limit=5&language=${lang}&uselang=nl&search=${encodeURIComponent(term)}`, f, h);
      // Personen en familienamen overslaan: die zeggen niets over een uitgave
      hit = (r.search || []).find(x => x.description && !/familienaam|achternaam|voornaam|surname|given name|family name|disambiguation|doorverwijspagina|wikimedia/i.test(x.description));
      if (hit) break;
    }
    if (!hit) return null;
    const ent = await getJson(`${api}&action=wbgetentities&props=claims|descriptions&languages=nl|en|fr&ids=${hit.id}`, f, h);
    const e = ent.entities && ent.entities[hit.id];
    if (!e) return null;
    const ids = [];
    for (const p of ['P31', 'P452']) {
      for (const cl of (e.claims && e.claims[p]) || []) {
        const v = cl.mainsnak && cl.mainsnak.datavalue && cl.mainsnak.datavalue.value;
        if (v && v.id && ids.length < 8) ids.push(v.id);
      }
    }
    if (ids.some(id => id === 'Q5' || id === 'Q101352' || id === 'Q202444')) return null; // mens / familienaam / voornaam
    let types = [];
    if (ids.length) {
      const lab = await getJson(`${api}&action=wbgetentities&props=labels&languages=nl|en&ids=${ids.join('|')}`, f, h);
      types = ids.map(id => lab.entities && lab.entities[id] ? pickLang(lab.entities[id].labels, ['nl', 'en']) : '').filter(Boolean);
      // Engelse labels erbij: de zoekwoorden kunnen in beide talen staan
      const labEn = await getJson(`${api}&action=wbgetentities&props=labels&languages=en&ids=${ids.join('|')}`, f, h).catch(() => null);
      if (labEn) for (const id of ids) { const v = labEn.entities && labEn.entities[id] && pickLang(labEn.entities[id].labels, ['en']); if (v && !types.includes(v)) types.push(v); }
    }
    return {
      source: 'Wikidata',
      label: hit.label || term,
      description: pickLang(e.descriptions, langs) || hit.description || '',
      types,
      url: 'https://www.wikidata.org/wiki/' + hit.id
    };
  }

  /** OpenStreetMap: wat voor zaak (winkel, restaurant, apotheek, tankstation, ...). */
  async function nominatim(term, opts) {
    const cc = (opts.countries || 'be').replace(/\s/g, '');
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=nl&countrycodes=${encodeURIComponent(cc)}&q=${encodeURIComponent(term)}`;
    const r = await getJson(url, opts.fetch, opts.headers);
    const useful = (r || []).filter(x => x.category && !['place', 'boundary', 'highway', 'landuse', 'natural', 'waterway', 'railway'].includes(x.category) && x.type !== 'yes');
    if (!useful.length) return null;
    // meest voorkomende soort zaak onder de treffers
    const counts = {};
    for (const x of useful) { const k = x.category + '=' + x.type; counts[k] = (counts[k] || 0) + 1; }
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const first = useful.find(x => x.category + '=' + x.type === top);
    const [category, type] = top.split('=');
    return {
      source: 'OpenStreetMap',
      label: first.name || term,
      description: `${category} = ${type}`,
      types: [type, category],
      url: `https://www.openstreetmap.org/${first.osm_type}/${first.osm_id}`
    };
  }

  /**
   * Zoekt één tegenpartij op. Geeft { query, hits: [...], text } terug; `text` bundelt alle
   * gevonden beschrijvingen zodat FluxCore.matchCategory er een categorie bij kan zoeken.
   */
  async function lookupFree(item, opts) {
    opts = Object.assign({ fetch: root.fetch && root.fetch.bind(root), countries: 'be' }, opts || {});
    const hits = [];
    const errors = [];
    for (const term of searchTerms(item.name, item.description)) {
      const [wd, osm] = await Promise.all([
        wikidata(term, opts).catch(e => { errors.push('Wikidata: ' + e.message); return null; }),
        (opts.nominatimQueue ? opts.nominatimQueue(() => nominatim(term, opts)) : nominatim(term, opts)).catch(e => { errors.push('OpenStreetMap: ' + e.message); return null; })
      ]);
      if (wd) hits.push(wd);
      if (osm) hits.push(osm);
      if (hits.length) return { query: term, hits, text: hitsText(hits), errors };
    }
    return { query: searchTerms(item.name, item.description)[0] || item.name, hits, text: '', errors };
  }

  function hitsText(hits) {
    return hits.map(h => [h.label, h.description].concat(h.types || []).join(' ')).join(' | ');
  }

  /** Zorgt dat verzoeken aan Nominatim minstens `ms` uit elkaar liggen (gebruiksvoorwaarden: max. 1/s). */
  function createQueue(ms) {
    let last = 0, chain = Promise.resolve();
    return fn => {
      const run = chain.then(async () => {
        const wait = last + ms - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        last = Date.now();
        return fn();
      });
      chain = run.catch(() => {});
      return run;
    };
  }

  const api = { searchTerms, wikidata, nominatim, lookupFree, hitsText, createQueue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FluxLookup = api;
})(typeof window !== 'undefined' ? window : globalThis);
