'use strict';
/*
 * Nagebootste Enable Banking-API voor de tests. Controleert de JWT-handtekening met de publieke sleutel,
 * en speelt de bank na: /auth geeft een link die meteen terugstuurt naar de redirect_url met code en state.
 */
const http = require('http');
const crypto = require('crypto');

function makeKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey };
}

function start(opts) {
  const { publicKey, appId } = opts;
  const calls = [];
  const sessions = {};
  const pendingAuth = {};
  const accountTx = opts.transactions || {};
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      // De "bank": stuurt terug naar Helder
      if (url.pathname === '/bank-login') {
        const p = pendingAuth[url.searchParams.get('id')];
        res.writeHead(302, { Location: p.redirect_url + '?code=CODE-' + url.searchParams.get('id') + '&state=' + encodeURIComponent(p.state) });
        return res.end();
      }
      // JWT controleren
      const auth = String(req.headers.authorization || '');
      const [h, c, sig] = auth.replace(/^Bearer /, '').split('.');
      let ok = false, head = {}, claims = {};
      try {
        head = JSON.parse(Buffer.from(h, 'base64url'));
        claims = JSON.parse(Buffer.from(c, 'base64url'));
        ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), publicKey, Buffer.from(sig, 'base64url'))
          && head.alg === 'RS256' && head.kid === appId && claims.iss === 'enablebanking.com' && claims.aud === 'api.enablebanking.com' && claims.exp > Date.now() / 1000;
      } catch (e) { ok = false; }
      calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: body ? JSON.parse(body) : null, jwtOk: ok });
      if (!ok) return json(401, { error: 'UNAUTHORIZED', message: 'Invalid JWT' });

      if (url.pathname === '/application' && req.method === 'GET') return json(200, { name: 'Helder test', environment: 'PRODUCTION', active: true, redirect_urls: [] });
      if (url.pathname === '/aspsps' && req.method === 'GET') {
        return json(200, { aspsps: [
          { name: 'KBC', country: 'BE', psu_types: ['personal', 'business'], maximum_consent_validity: 180 * 86400 },
          { name: 'Argenta', country: 'BE', psu_types: ['personal'], maximum_consent_validity: 180 * 86400 },
          { name: 'Zakenbank', country: 'BE', psu_types: ['business'] },
          { name: 'Belfius', country: 'BE', psu_types: ['personal'] }
        ] });
      }
      if (url.pathname === '/auth' && req.method === 'POST') {
        const b = JSON.parse(body);
        const id = crypto.randomBytes(6).toString('hex');
        pendingAuth[id] = b;
        return json(200, { url: 'http://' + req.headers.host + '/bank-login?id=' + id, authorization_id: id });
      }
      if (url.pathname === '/sessions' && req.method === 'POST') {
        const b = JSON.parse(body);
        const id = String(b.code).replace('CODE-', '');
        const p = pendingAuth[id];
        if (!p) return json(400, { error: 'WRONG_CODE', message: 'Unknown code' });
        const sid = 'sess-' + id;
        sessions[sid] = p;
        return json(200, {
          session_id: sid,
          accounts: [{ uid: 'acc-zicht-' + id, account_id: { iban: 'BE68 5390 0754 7034' }, name: 'Zichtrekening', currency: 'EUR' }],
          aspsp: p.aspsp, psu_type: 'personal', access: { valid_until: p.access.valid_until }
        });
      }
      const m = url.pathname.match(/^\/accounts\/([^/]+)\/(transactions|balances)$/);
      if (m && req.method === 'GET') {
        const all = accountTx.list || [];
        if (m[2] === 'balances') return json(200, { balances: [{ name: 'Beschikbaar', balance_amount: { currency: 'EUR', amount: '1500.00' }, balance_type: 'ITAV', reference_date: '2026-10-14' }, { name: 'Geboekt', balance_amount: { currency: 'EUR', amount: '1234.56' }, balance_type: 'CLBD', reference_date: '2026-10-13' }] });
        if (opts.maxHistoryDays && url.searchParams.get('date_from') < new Date(Date.now() - opts.maxHistoryDays * 86400000).toISOString().slice(0, 10)) return json(422, { error: 'WRONG_TRANSACTIONS_PERIOD', message: 'Wrong period' });
        const page = Number(url.searchParams.get('continuation_key') || 0);
        const size = 2;
        const slice = all.slice(page * size, page * size + size);
        return json(200, Object.assign({ transactions: slice }, page * size + size < all.length ? { continuation_key: String(page + 1) } : {}));
      }
      if (url.pathname.startsWith('/sessions/') && req.method === 'DELETE') { delete sessions[url.pathname.slice(10)]; return json(200, {}); }
      return json(404, { error: 'NOT_FOUND' });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    base: 'http://127.0.0.1:' + server.address().port, calls, sessions, stop: () => server.close()
  })));
}

/** Voorbeeldtransacties zoals een Belgische bank ze via PSD2 teruggeeft. */
function sampleTransactions() {
  return [
    { entry_reference: 'E1', transaction_amount: { currency: 'EUR', amount: '45.20' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-01', value_date: '2026-10-01',
      creditor: { name: 'COLRUYT GENT' }, remittance_information: ['Betaling Bancontact COLRUYT GENT 01/10'] },
    { entry_reference: 'E2', transaction_amount: { currency: 'EUR', amount: '2500.00' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-10-02',
      debtor: { name: 'WERKGEVER NV' }, debtor_account: { iban: 'BE71 0961 2345 6769' }, remittance_information: ['Loon september'] },
    { entry_reference: 'E3', transaction_amount: { currency: 'EUR', amount: '12.99' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-05',
      creditor: { name: 'Netflix' }, remittance_information: ['NETFLIX.COM'] },
    { entry_reference: 'E4', transaction_amount: { currency: 'EUR', amount: '9.00' }, credit_debit_indicator: 'DBIT', status: 'PDNG', booking_date: '2026-10-06',
      creditor: { name: 'Nog niet geboekt' } },
    { transaction_amount: { currency: 'EUR', amount: '3.50' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-07',
      creditor: { name: 'Bakkerij' }, remittance_information: ['Bakker'] }
  ];
}

module.exports = { makeKeys, start, sampleTransactions };
