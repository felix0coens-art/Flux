'use strict';
/*
 * De PHP-server (voor webhosting zonder Node.js) moet hetzelfde doen als de Node-server.
 * Deze tests voeren beide versies uit met hetzelfde nagebootste internet en vergelijken.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const Lookup = require('../js/lookup.js');
const Degiro = require('../server/degiro.js');
const Prices = require('../server/prices.js');

const hasPhp = spawnSync('php', ['-v']).status === 0;
const skip = hasPhp ? false : 'php niet geïnstalleerd';
const HARNESS = path.join(__dirname, 'php', 'harness.php');

function php(fn, args, fake, env) {
  return new Promise((resolve, reject) => {
    const p = spawn('php', [HARNESS], { env: Object.assign({}, process.env, { HELDER_CONFIG: '/nonexistent', FLUX_DATA_DIR: require('os').tmpdir() + '/helder-php-harness' }, env || {}) });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', () => { try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('PHP: ' + out + err)); } });
    p.stdin.end(JSON.stringify({ fn, args, fake }));
  });
}

/** Nagebootste fetch voor de Node-versie, met dezelfde tabel [urlDeel, status, body]. */
function nodeFetch(fake) {
  return async url => {
    const hit = fake.find(([part]) => String(url).includes(part));
    const [, status, body] = hit || [null, 404, {}];
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) };
  };
}

test('php: zoektermen voor tegenpartijen zoals js/lookup.js', { skip }, async () => {
  const cases = [
    ['BETALING BANCONTACT COLRUYT 3412 GENT 12/10', ''],
    ['', 'EUROPESE DOMICILIERING PROXIMUS NV BE12 3456 7890 1234'],
    ['Café Ölümcü*Brussel', ''],
    ['DE LIJN', 'Aankoop via apple pay 03/04/2026'],
    ['bol.com b.v.', ''],
    ['X', '']
  ];
  const r = await php('search_terms', cases);
  assert.deepEqual(r.result, cases.map(([n, d]) => Lookup.searchTerms(n, d)));
});

test('php: goud- en zilverprijs zoals server/prices.js', { skip }, async () => {
  const t = Date.parse('2026-10-14T20:00:00Z') / 1000;
  const fake = [
    ['/chart/GC%3DF', 200, { chart: { result: [{ meta: { regularMarketPrice: 4000, regularMarketTime: t } }] } }],
    ['/chart/SI%3DF', 200, { chart: { result: [{ meta: { regularMarketPrice: 50, regularMarketTime: t } }] } }],
    ['/chart/EURUSD%3DX', 200, { chart: { result: [{ meta: { regularMarketPrice: 1.25, regularMarketTime: t } }] } }]
  ];
  const r = await php('metal_prices', [], fake);
  const expected = await Prices.metalPrices(nodeFetch(fake));
  assert.deepEqual(r.result, expected);
  // 4000 dollar per troy ounce / 1,25 = 3200 euro per 31,1035 g = 102,88 euro per gram
  assert.equal(expected.gold, 10288.24);
  assert.equal(expected.at, '2026-10-14T20:00:00.000Z');
});

test('php: historische koersen zoals server/prices.js', { skip }, async () => {
  const ts = [Date.parse('2026-01-05T00:00:00Z') / 1000, Date.parse('2026-01-12T00:00:00Z') / 1000];
  const fake = [
    ['/search?q=US0378331005', 200, { quotes: [{ symbol: 'AAPL', exchange: 'NMS', quoteType: 'EQUITY' }, { symbol: 'APC.F', exchange: 'FRA', quoteType: 'EQUITY' }] }],
    ['/search?q=IE00B3RBWM25', 200, { quotes: [{ symbol: 'VWRL.AS', exchange: 'AMS', quoteType: 'ETF' }] }],
    ['/search?q=LU0171310443', 200, { quotes: [] }],
    ['/search?q=BGF%20World%20Technology', 200, { quotes: [{ symbol: '0P00000SMQ.F', exchange: 'FRA', quoteType: 'MUTUALFUND' }] }],
    ['/chart/0P00000SMQ.F', 200, { chart: { result: [{ meta: { currency: 'EUR', regularMarketPrice: 95.5, regularMarketTime: Date.parse('2026-01-15T10:00:00Z') / 1000 }, timestamp: ts, indicators: { quote: [{ close: [90, 92] }] } }] } }],
    ['/chart/AAPL', 200, { chart: { result: [{ meta: { currency: 'USD' }, timestamp: ts, indicators: { quote: [{ close: [200, 210] }] } }] } }],
    ['/chart/EURUSD%3DX', 200, { chart: { result: [{ meta: { currency: 'USD' }, timestamp: ts, indicators: { quote: [{ close: [1.25, 1.05] }] } }] } }],
    ['/chart/VWRL.AS', 200, { chart: { result: [{ meta: { currency: 'EUR', regularMarketPrice: 112.25, regularMarketTime: Date.parse('2026-01-14T16:30:00Z') / 1000 }, timestamp: ts, indicators: { quote: [{ close: [110.5, null] }] } }] } }]
  ];
  const list = [
    { key: 'US0378331005', isin: 'US0378331005', name: '', currency: 'USD', from: '2026-01-01' },
    { key: 'IE00B3RBWM25', isin: 'IE00B3RBWM25', name: '', currency: 'EUR', from: '2026-01-01' },
    { key: 'ONBEKEND', isin: 'XS0000000000', name: '', currency: 'EUR', from: '2026-01-01' },
    { key: 'LU0171310443', isin: 'LU0171310443', name: 'BGF World Technology Fund A2 USD', currency: 'USD', from: '2026-01-01' }
  ];
  const r = await php('fetch_prices', [list], fake);
  const expected = await Prices.fetchPrices(nodeFetch(fake), list);
  assert.deepEqual(r.result, JSON.parse(JSON.stringify(expected)));
  assert.deepEqual(r.result.series.US0378331005.points.map(p => p.eur), [16000, 20000]);
  // De koers van vandaag komt er als laatste punt bij (de weekkoersen staan op maandag)
  assert.deepEqual(r.result.series.IE00B3RBWM25.points.map(p => [p.date, p.eur]), [['2026-01-05', 11050], ['2026-01-14', 11225]]);
  // Fonds dat niet op ISIN gevonden wordt: op naam, met de koers van vandaag als laatste punt
  assert.equal(r.result.series.LU0171310443.symbol, '0P00000SMQ.F');
  assert.deepEqual(r.result.series.LU0171310443.points.map(p => [p.date, p.eur]), [['2026-01-05', 9000], ['2026-01-12', 9200], ['2026-01-15', 9550]]);
});

function degiroFake(withOtp) {
  return [
    ['/login/secure/login/totp', 200, { sessionId: 'SESS1', status: 0 }],
    ['/login/secure/login', 200, withOtp ? { status: 6, statusText: 'totpNeeded' } : { sessionId: 'SESS1', status: 0 }],
    ['/login/secure/config', 200, { data: { tradingUrl: 'https://t.example/trading/', paUrl: 'https://t.example/pa/', productSearchUrl: 'https://t.example/ps/', reportingUrl: 'https://t.example/rep/' } }],
    ['/pa/client', 200, { data: { intAccount: 12345 } }],
    ['/trading/v5/update/', 200, {
      portfolio: { value: [
        { value: [{ name: 'id', value: '111' }, { name: 'positionType', value: 'PRODUCT' }, { name: 'size', value: 10 }, { name: 'price', value: 112.3 }, { name: 'value', value: 1123.0 }, { name: 'plBase', value: { EUR: -1050.5 } }] },
        { value: [{ name: 'id', value: 'EUR' }, { name: 'positionType', value: 'CASH' }, { name: 'size', value: 12.3 }] },
        { value: [{ name: 'id', value: '222' }, { name: 'positionType', value: 'PRODUCT' }, { name: 'size', value: 0 }] }
      ] },
      totalPortfolio: { value: [{ name: 'totalCash', value: 12.3 }] }
    }],
    ['/ps/v5/products/info', 200, { data: {
      111: { name: 'Vanguard FTSE All-World', isin: 'IE00B3RBWM25', symbol: 'VWRL', currency: 'EUR' },
      333: { name: 'Apple', isin: 'US0378331005', symbol: 'AAPL', currency: 'USD' }
    } }],
    ['/rep/v4/transactions', 200, { data: [
      { id: 9, productId: 111, date: '2026-01-05T10:00:00+01:00', buysell: 'B', quantity: 10, price: 110.5, totalPlusFeeInBaseCurrency: -1107.0, totalFeesInBaseCurrency: -2 },
      { id: 10, productId: 333, date: '2026-02-03T15:30:00+01:00', buysell: 'S', quantity: -1, price: 230, totalInBaseCurrency: 210.4 }
    ] }],
    ['/rep/v6/accountoverview', 200, { data: { cashMovements: [
      { id: 1, date: '2026-01-02T09:00:00+01:00', description: 'iDEAL storting', change: 1500, currency: 'EUR' },
      { date: '2026-03-01T09:00:00+01:00', description: 'Dividend', change: 4.12, currency: 'EUR', productId: 111 },
      { date: '2026-03-01T09:00:00+01:00', description: 'Dividendbelasting', change: -1.24, currency: 'EUR', productId: 111 },
      { date: '2026-03-02T09:00:00+01:00', description: 'Valuta Debitering', change: -3, currency: 'USD' },
      { date: '2026-04-02T09:00:00+01:00', description: 'Terugstorting', change: -100, currency: 'EUR' }
    ] } }],
    ['/logout', 200, '']
  ];
}

test('php: Degiro-koppeling geeft hetzelfde resultaat als server/degiro.js', { skip }, async () => {
  const fake = degiroFake(true);
  const opts = { fromDate: '2025-01-01', today: '2026-10-14' };
  const expected = await Degiro.fetchAll(nodeFetch(fake), { username: 'u', password: 'p', otp: '123456' }, opts);
  const r = await php('degiro', ['u', 'p', '123456', '2025-01-01', '2026-10-14'], fake);
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual(r.result, JSON.parse(JSON.stringify(expected)));
  assert.ok(r.requests.some(q => q[1].includes('/login/secure/login/totp')), '2FA-code gebruikt');
  assert.ok(r.requests.some(q => q[1].includes('/logout')), 'Degiro-sessie afgesloten');
  assert.ok(!JSON.stringify(r.result).includes('123456'), 'geen inloggegevens in het resultaat');
});

test('php: Degiro zonder 2FA-code vraagt om de code', { skip }, async () => {
  const r = await php('degiro', ['u', 'p', ''], degiroFake(true));
  assert.equal(r.kind, 'otp');
  const bad = await php('degiro', ['u', 'p', ''], [['/login/secure/login', 200, { status: 3, statusText: 'badCredentials' }]]);
  assert.equal(bad.kind, 'auth');
});

test('php: online opzoeken (Wikidata + OpenStreetMap) zoals js/lookup.js', { skip }, async () => {
  const fake = [
    ['wbsearchentities', 200, { search: [{ id: 'Q1', label: 'Colruyt', description: 'Belgische supermarktketen' }] }],
    ['props=claims', 200, { entities: { Q1: { descriptions: { nl: { value: 'Belgische supermarktketen' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q180846' } } } }] } } } }],
    ['languages=nl|en&ids=Q180846', 200, { entities: { Q180846: { labels: { nl: { value: 'supermarktketen' } } } } }],
    ['languages=en&ids=Q180846', 200, { entities: { Q180846: { labels: { en: { value: 'supermarket chain' } } } } }],
    ['nominatim', 200, [{ category: 'shop', type: 'supermarket', name: 'Colruyt Gent', osm_type: 'node', osm_id: 5 }, { category: 'place', type: 'city' }]]
  ];
  const item = { name: 'COLRUYT GENT', description: '' };
  const r = await php('lookup_free', [item], fake);
  const expected = await Lookup.lookupFree(item, { fetch: nodeFetch(fake), countries: 'be' });
  assert.deepEqual(r.result, expected);
  assert.match(r.result.text, /supermarket/);
});

test('php: AI-classificatie via de officiële Anthropic PHP SDK', { skip: skip || (spawnSync('php', ['-r', 'exit(is_file("' + path.join(__dirname, '..', 'php', 'vendor', 'autoload.php') + '") ? 0 : 1);']).status !== 0 && 'composer install niet uitgevoerd in php/') }, async () => {
  let seen = null, calls = 0, second = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      calls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (calls === 1) {
        seen = { url: req.url, headers: req.headers, body: JSON.parse(body) };
        // Eerst een gepauzeerde zoekbeurt: moet ongewijzigd teruggestuurd worden
        return res.end(JSON.stringify({
          id: 'msg_0', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'pause_turn', stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
          content: [
            { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Colruyt' } },
            { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://colruyt.be', title: 'Colruyt', encrypted_content: 'abc', page_age: null }] }
          ]
        }));
      }
      second = JSON.parse(body);
      res.end(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
        content: [{ type: 'tool_use', id: 'tu_1', name: 'record_classifications', input: { results: [
          { index: 0, categoryId: 'cat_boodschappen', businessType: 'Supermarktketen', confidence: 'hoog', explanation: 'Colruyt is een supermarkt.' },
          { index: 1, categoryId: 'verzonnen', businessType: '?', confidence: 'laag', explanation: '?' },
          { index: 7, categoryId: 'cat_boodschappen', businessType: '?', confidence: 'laag', explanation: '?' }
        ] } }]
      }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const items = [{ title: 'Weekboodschappen', name: 'COLRUYT GENT', description: '', direction: 'out' }, { name: 'J. JANSSENS', description: 'terugbetaling', direction: 'in' }];
    const cats = [{ id: 'cat_boodschappen', name: 'Boodschappen', kind: 'expense' }, { id: 'inc_1', name: 'Loon', kind: 'income' }];
    const r = await php('ai_classify', [items, cats], [], { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.address().port });
    assert.equal(r.error, undefined, r.error);
    assert.deepEqual(r.result.map(x => [x.index, x.categoryId]), [[0, 'cat_boodschappen'], [1, '']], 'onbekende categorie en index gefilterd');
    // Het verzoek zelf
    assert.match(seen.url, /\/v1\/messages/);
    assert.equal(seen.headers['x-api-key'], 'sk-test');
    assert.match(seen.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    const b = seen.body;
    assert.equal(b.model, 'claude-opus-5-5');
    assert.equal(b.fallbacks, 'default');
    assert.deepEqual(b.output_config, { effort: 'low' });
    assert.equal(b.max_tokens, 16000);
    assert.deepEqual(b.tools[0], { type: 'web_search_20260209', name: 'web_search', max_uses: 4 });
    assert.equal(b.tools[1].name, 'record_classifications');
    assert.equal(b.tools[1].strict, true);
    assert.deepEqual(b.tools[1].input_schema.properties.results.items.properties.categoryId.enum, ['cat_boodschappen', 'inc_1', '']);
    assert.match(b.messages[0].content, /"titel":"Weekboodschappen"/);
    // Na pause_turn: de assistent-beurt terugsturen, zonder extra gebruikersbericht
    assert.equal(calls, 2);
    assert.equal(second.messages.length, 2);
    assert.equal(second.messages[1].role, 'assistant');
    assert.deepEqual(second.messages[1].content.map(c => c.type), ['server_tool_use', 'web_search_tool_result']);
    assert.equal(second.messages[1].content[1].content[0].encrypted_content, 'abc');
  } finally {
    server.close();
  }
});
