'use strict';
/*
 * Nagebootste Saxo OpenAPI voor de tests: aanmelden (OAuth authorization code), tokens vernieuwen
 * (de vernieuwingssleutel verandert telkens) en de rapporten met posities, transacties en boekingen.
 */
const http = require('http');

const APP_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const APP_SECRET = '0f9e8d7c6b5a49382716f5e4d3c2b1a0';

function sample() {
  return {
    client: { ClientKey: 'CK|7', DefaultCurrency: 'EUR' },
    balance: { CashBalance: 1234.56, Currency: 'EUR', TotalValue: 6234.56 },
    netPositions: [
      { NetPositionId: '211__Stock', NetPositionBase: { Amount: 10, AssetType: 'Stock', Uic: 211 }, NetPositionView: { CurrentPrice: 180.5, MarketValueInBaseCurrency: 1805, ProfitLossOnTradeInBaseCurrency: 305 }, DisplayAndFormat: { Description: 'Apple Inc.', Symbol: 'AAPL:xnas', Currency: 'USD' } },
      { NetPositionId: '3646__Etf', NetPositionBase: { Amount: 40, AssetType: 'Etf', Uic: 3646 }, NetPositionView: { CurrentPrice: 79.88, MarketValueInBaseCurrency: 3195.2 }, DisplayAndFormat: { Description: 'iShares Core MSCI World', Symbol: 'IWDA:xams', Currency: 'EUR' } },
      { NetPositionId: '99__Stock', NetPositionBase: { Amount: 0, AssetType: 'Stock', Uic: 99 }, NetPositionView: {}, DisplayAndFormat: { Description: 'Gesloten' } }
    ],
    details: { Stock: [{ Uic: 211, AssetType: 'Stock', IsinCode: 'US0378331005' }], Etf: [{ Uic: 3646, AssetType: 'Etf', IsinCode: 'IE00B4L5Y983' }] },
    trades: [
      { TradeId: 'T1', TradeDate: '2026-02-03T00:00:00Z', Uic: 211, AssetType: 'Stock', InstrumentDescription: 'Apple Inc.', BuySell: 'Bought', Amount: 12, Price: 150, InstrumentCurrency: 'USD', BookedAmountClientCurrency: -1510.5, TotalCommission: 10.5 },
      { TradeId: 'T2', TradeDate: '2026-05-04', Uic: 211, AssetType: 'Stock', InstrumentDescription: 'Apple Inc.', BuySell: 'Sold', Amount: 2, Price: 170, InstrumentCurrency: 'USD', BookedAmountClientCurrency: 330 },
      { TradeId: 'T3', TradeDate: '2026-03-01', Uic: 3646, AssetType: 'Etf', InstrumentDescription: 'iShares Core MSCI World', BuySell: 'Bought', Amount: 40, Price: 75, InstrumentCurrency: 'EUR', BookedAmountClientCurrency: -3000 }
    ],
    bookings: [
      { BookingId: 'B1', Date: '2026-02-01', AmountType: 'Cash Amount', Event: 'Cash Transfer', AmountClientCurrency: 6000 },
      { BookingId: 'B2', Date: '2026-02-03', AmountType: 'Share Amount', Event: 'Bought', AmountClientCurrency: -1500, Uic: 211, InstrumentDescription: 'Apple Inc.' },
      { BookingId: 'B3', Date: '2026-02-03', AmountType: 'Commission', Event: 'Bought', AmountClientCurrency: -10.5, Uic: 211 },
      { BookingId: 'B4', Date: '2026-08-14', AmountType: 'Corporate Actions - Cash Dividends', Event: 'Cash Dividend', AmountClientCurrency: 2.4, Uic: 211, InstrumentDescription: 'Apple Inc.' },
      { BookingId: 'B5', Date: '2026-08-14', AmountType: 'Corporate Actions - Withholding Tax', Event: 'Cash Dividend', AmountClientCurrency: -0.36, Uic: 211 },
      { BookingId: 'B6', Date: '2026-09-30', AmountType: 'Custody Fee', AmountClientCurrency: -2.5 },
      { BookingId: 'B7', Date: '2026-10-01', AmountType: 'Cash Amount', Event: 'Cash Transfer', AmountClientCurrency: -250 }
    ]
  };
}

function start(opts) {
  opts = opts || {};
  const data = sample();
  const calls = [];
  let access = null, refresh = null, codeIssued = null, n = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const base = 'http://127.0.0.1:' + server.address().port;
      calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, auth: req.headers.authorization || '' });
      const json = (status, d) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      // Aanmeldpagina van Saxo: stuurt meteen terug naar Helder
      if (url.pathname === '/auth/authorize') {
        if (url.searchParams.get('client_id') !== APP_KEY) return json(400, { error: 'invalid_client' });
        codeIssued = 'CODE-' + (++n);
        res.writeHead(302, { Location: url.searchParams.get('redirect_uri') + '?code=' + codeIssued + '&state=' + encodeURIComponent(url.searchParams.get('state')) });
        return res.end();
      }
      if (url.pathname === '/auth/token' && req.method === 'POST') {
        const f = Object.fromEntries(new URLSearchParams(body));
        if (f.client_id !== APP_KEY || f.client_secret !== APP_SECRET) return json(401, { error: 'invalid_client' });
        const ok = (f.grant_type === 'authorization_code' && f.code && f.code === codeIssued) || (f.grant_type === 'refresh_token' && f.refresh_token && f.refresh_token === refresh);
        if (!ok) return json(400, { error: 'invalid_grant', error_description: 'Ongeldige code' });
        codeIssued = null;
        access = 'ACCESS-' + (++n); refresh = 'REFRESH-' + n;
        return json(201, { access_token: access, token_type: 'Bearer', expires_in: opts.expiresIn || 1200, refresh_token: refresh, refresh_token_expires_in: 2400 });
      }
      if (!url.pathname.startsWith('/openapi/')) return json(404, {});
      if (req.headers.authorization !== 'Bearer ' + access) return json(401, { Message: 'Unauthorized' });
      const p = url.pathname.slice('/openapi'.length);
      if (p === '/port/v1/clients/me') return json(200, data.client);
      if (p === '/port/v1/balances/me') return json(200, data.balance);
      if (p === '/port/v1/netpositions/me') {
        if (url.searchParams.get('$skip') === '2') return json(200, { Data: data.netPositions.slice(2) });
        return json(200, { Data: data.netPositions.slice(0, 2), __next: base + '/openapi/port/v1/netpositions/me?$skip=2&$top=2' });
      }
      if (p === '/cs/v1/reports/trades/CK%7C7' || p === '/cs/v1/reports/trades/CK|7') return json(200, { Data: data.trades });
      if (p === '/cs/v1/reports/bookings/CK%7C7' || p === '/cs/v1/reports/bookings/CK|7') return opts.noBookings ? json(500, { Message: 'Fout' }) : json(200, { Data: data.bookings });
      if (p === '/ref/v1/instruments/details') return json(200, { Data: data.details[url.searchParams.get('AssetTypes')] || [] });
      return json(404, { Message: 'Onbekend: ' + p });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    base: 'http://127.0.0.1:' + server.address().port, calls, stop: () => server.close(),
    expireAccess: () => { access = 'VERLOPEN'; }
  })));
}

module.exports = { start, sample, APP_KEY, APP_SECRET };
