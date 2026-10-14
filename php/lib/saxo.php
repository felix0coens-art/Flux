<?php
/*
 * Koppeling met Saxo Bank via de officiële Saxo OpenAPI. Zelfde gedrag als server/saxo.js.
 *
 * - Je meldt je aan op de website van Saxo zelf (OAuth); Helder ziet je Saxo-wachtwoord nooit.
 * - App Key en App Secret van je Saxo-app staan enkel op de server (helder-data/saxo.json) en worden
 *   nooit naar de browser gestuurd. De toegangssleutels (tokens) staan per gebruiker op de server.
 * - Helder leest enkel: posities, saldo, transacties en kasbewegingen. Er worden nooit orders geplaatst.
 * - Saxo-tokens zijn kort geldig: is de sleutel verlopen, dan meld je je opnieuw aan bij Saxo.
 */

declare(strict_types=1);

final class SaxoError extends Exception {
    public int $status;
    public string $kind;
    public function __construct(string $message, int $status = 502, string $kind = 'api') { parent::__construct($message); $this->status = $status; $this->kind = $kind; }
}

const SAXO_ENVS = [
    'live' => ['auth' => 'https://live.logonvalidation.net', 'api' => 'https://gateway.saxobank.com/openapi'],
    'sim' => ['auth' => 'https://sim.logonvalidation.net', 'api' => 'https://gateway.saxobank.com/sim/openapi'],
];

function sx_first(...$vals) { foreach ($vals as $v) if ($v !== null && $v !== '') return $v; return null; }
function sx_cents($v): int { return is_numeric($v) ? (int) round((float) $v * 100) : 0; }
function sx_day($v): string { return substr((string) $v, 0, 10); }

function saxo_movement_type(string $t, int $amount): string {
    if (preg_match('/withholding|bronheffing|dividend ?tax|roerende voorheffing/i', $t)) return 'dividend_tax';
    if (preg_match('/dividend|coupon/i', $t)) return 'dividend';
    if (preg_match('/commission|exchange fee|stamp|beurstaks|financial transaction tax|\btob\b/i', $t)) return 'fee';
    if (preg_match('/share amount|bought|sold|trade|aandelenbedrag|koop|verkoop/i', $t)) return 'trade';
    if (preg_match('/interest|rente/i', $t)) return 'interest';
    if (preg_match('/commission|exchange fee|stamp|beurstaks|financial transaction tax|\btob\b|custody|fee|kosten|charge/i', $t)) return 'fee';
    if (preg_match('/fx|conversion|currency|valuta/i', $t)) return 'fx';
    if (preg_match('/cash transfer|deposit|withdraw|transfer|storting|opname|cash amount/i', $t)) return $amount >= 0 ? 'deposit' : 'withdrawal';
    return 'other';
}

/** Zet de antwoorden van Saxo om naar het Helder-formaat (zie js/invest.js). */
function saxo_normalize(array $in): array {
    $isinOf = [];
    foreach (($in['details'] ?? []) as $d) {
        $isin = sx_first($d['IsinCode'] ?? null, $d['Isin'] ?? null, $d['ISIN'] ?? null);
        if (isset($d['Uic']) && $isin) $isinOf[(string) $d['Uic']] = (string) $isin;
    }
    $positions = [];
    foreach (($in['netPositions'] ?? []) as $p) {
        $b = $p['NetPositionBase'] ?? []; $v = $p['NetPositionView'] ?? []; $f = $p['DisplayAndFormat'] ?? [];
        $uic = (string) sx_first($b['Uic'] ?? null, $p['Uic'] ?? null, '');
        $isin = $isinOf[$uic] ?? (string) (sx_first($f['Isin'] ?? null, $b['IsinCode'] ?? null, '') ?? '');
        $value = sx_cents(sx_first($v['MarketValueInBaseCurrency'] ?? null, $v['MarketValue'] ?? null, $v['Exposure'] ?? null, 0));
        $pl = sx_first($v['ProfitLossOnTradeInBaseCurrency'] ?? null, $v['ProfitLossOnTrade'] ?? null);
        $qty = (float) (sx_first($b['Amount'] ?? null, 0));
        if ($qty == 0) continue;
        $positions[] = [
            'key' => $isin !== '' ? $isin : 'saxo:' . $uic, 'productId' => $uic,
            'name' => (string) sx_first($f['Description'] ?? null, $f['Symbol'] ?? null, 'Product ' . $uic), 'isin' => $isin,
            'symbol' => (string) ($f['Symbol'] ?? ''), 'currency' => (string) ($f['Currency'] ?? 'EUR'),
            'quantity' => $qty + 0, 'price' => (float) sx_first($v['CurrentPrice'] ?? null, $v['MarketPrice'] ?? null, 0) + 0,
            'valueEur' => $value, 'costEur' => $pl !== null ? $value - sx_cents($pl) : null,
        ];
    }
    $bal = $in['balance'] ?? [];
    $cash = sx_cents(sx_first($bal['CashBalance'] ?? null, $bal['CashAvailableForTrading'] ?? null, 0));

    $trades = [];
    foreach (array_values($in['trades'] ?? []) as $i => $t) {
        $uic = (string) sx_first($t['Uic'] ?? null, '');
        $dir = (string) sx_first($t['BuySell'] ?? null, $t['Direction'] ?? null, $t['TradeEventType'] ?? null, '');
        $qty = (float) sx_first($t['Amount'] ?? null, $t['Quantity'] ?? null, $t['TradedAmount'] ?? null, 0);
        if (preg_match('/sell|sold|verkoop/i', $dir)) $qty = -abs($qty);
        elseif (preg_match('/buy|bought|koop/i', $dir)) $qty = abs($qty);
        $booked = abs(sx_cents(sx_first($t['BookedAmountClientCurrency'] ?? null, $t['BookedAmountAccountCurrency'] ?? null, $t['TradedValue'] ?? null, 0)));
        $fee = abs(sx_cents(sx_first($t['TotalCommission'] ?? null, $t['ClientCommission'] ?? null, $t['Commission'] ?? null, 0)));
        $date = sx_day(sx_first($t['TradeDate'] ?? null, $t['ExecutionTime'] ?? null, $t['ValueDate'] ?? null, ''));
        if ($date === '' || $qty == 0) continue;
        $qty = $qty + 0;
        $trades[] = [
            'id' => 'saxo|' . (string) sx_first($t['TradeId'] ?? null, $t['OrderId'] ?? null, implode('|', [$t['TradeDate'] ?? '', $uic, $qty, $i])),
            'date' => $date, 'isin' => (string) (sx_first($t['IsinCode'] ?? null, $t['Isin'] ?? null, $isinOf[$uic] ?? null, '') ?? ''),
            'name' => (string) sx_first($t['InstrumentDescription'] ?? null, $t['Description'] ?? null, $t['InstrumentSymbol'] ?? null, 'Product ' . $uic),
            'quantity' => $qty, 'price' => (float) sx_first($t['Price'] ?? null, $t['TradePrice'] ?? null, 0) + 0,
            'currency' => (string) sx_first($t['InstrumentCurrency'] ?? null, $t['Currency'] ?? null, 'EUR'),
            'totalEur' => $qty > 0 ? -$booked : $booked, 'feesEur' => -$fee,
        ];
    }

    $movements = [];
    foreach (array_values($in['bookings'] ?? []) as $i => $m) {
        $amount = sx_cents(sx_first($m['AmountClientCurrency'] ?? null, $m['AmountAccountCurrency'] ?? null, $m['Amount'] ?? null, 0));
        $label = implode(' · ', array_filter([$m['AmountType'] ?? null, $m['BkAmountType'] ?? null, $m['Category'] ?? null, $m['Event'] ?? null, $m['CostType'] ?? null, $m['Description'] ?? null], fn($x) => $x !== null && $x !== ''));
        $type = saxo_movement_type($label, $amount);
        $uic = (string) sx_first($m['Uic'] ?? null, '');
        $date = sx_day(sx_first($m['Date'] ?? null, $m['ValueDate'] ?? null, $m['BookingDate'] ?? null, ''));
        if ($date === '' || $amount === 0) continue;
        $fee = $type === 'fee' && preg_match('/commission|exchange fee|stamp|beurstaks|financial transaction tax|\btob\b/i', $label);
        $movements[] = [
            'id' => 'saxo|' . (string) sx_first($m['BookingId'] ?? null, implode('|', [$m['Date'] ?? '', $label, $amount, $i])),
            'date' => $date, 'type' => $type, 'amountEur' => $amount,
            'description' => ($fee ? 'Transactiekosten: ' : '') . ($label !== '' ? $label : 'Saxo-boeking') . (!empty($m['InstrumentDescription']) ? ' — ' . $m['InstrumentDescription'] : ''),
            'isin' => (string) (sx_first($m['IsinCode'] ?? null, $isinOf[$uic] ?? null, '') ?? ''),
        ];
    }
    return ['positions' => $positions, 'cashEur' => $cash, 'trades' => $trades, 'movements' => $movements];
}

function saxo_config(): ?array {
    $c = read_json('saxo.json', null);
    return is_array($c) && !empty($c['appKey']) && !empty($c['appSecret']) ? $c : null;
}

function saxo_env(?array $c): array { return SAXO_ENVS[($c['env'] ?? 'live') === 'sim' ? 'sim' : 'live']; }
function saxo_auth_base(?array $c): string { return rtrim((string) cfg('FLUX_SAXO_AUTH_URL', saxo_env($c)['auth']), '/'); }
function saxo_api_base(?array $c): string { return rtrim((string) cfg('FLUX_SAXO_API_URL', saxo_env($c)['api']), '/'); }
function saxo_redirect_url(): string { return public_url() . '/api/saxo/callback'; }
function saxo_token_file(string $user): string { return 'saxo-' . bin2hex($user) . '.json'; }

function require_saxo(): array {
    $c = saxo_config();
    if (!$c) throw new SaxoError('De Saxo-koppeling is nog niet ingesteld', 400, 'config');
    return $c;
}

function saxo_status(string $user): array {
    $c = saxo_config();
    $t = read_json(saxo_token_file($user), null);
    $connected = is_array($t) && !empty($t['refreshToken']);
    return [
        'configured' => $c !== null, 'env' => $c ? (($c['env'] ?? 'live') === 'sim' ? 'sim' : 'live') : null, 'redirectUrl' => saxo_redirect_url(),
        'connected' => $connected, 'connectedAt' => $connected ? ($t['connectedAt'] ?? null) : null,
        'validUntil' => $connected ? gmdate('Y-m-d\TH:i:s.000\Z', intdiv((int) $t['refreshExpires'], 1000)) : null,
        'expired' => $connected ? $t['refreshExpires'] <= now_ms() : false,
    ];
}

function saxo_save_config(array $b): array {
    if (!empty($b['remove'])) { @unlink(data_dir() . '/saxo.json'); return ['configured' => false]; }
    $key = trim((string) ($b['appKey'] ?? ''));
    $secret = trim((string) ($b['appSecret'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9-]{16,100}$/', $key)) throw new SaxoError('Vul de App Key in (staat bij je app op het Saxo Developer Portal)', 400, 'config');
    if (!preg_match('/^[A-Za-z0-9-]{16,100}$/', $secret)) throw new SaxoError('Vul de App Secret in (bij je app op het Saxo Developer Portal; klik op “show”)', 400, 'config');
    $c = ['appKey' => $key, 'appSecret' => $secret, 'env' => ($b['env'] ?? '') === 'sim' ? 'sim' : 'live', 'savedAt' => gmdate('c')];
    write_json('saxo.json', $c);
    return ['configured' => true, 'env' => $c['env']];
}

function saxo_connect(string $user): array {
    $c = require_saxo();
    $state = b64url(random_bytes(24));
    with_lock('saxo-pending', function () use ($state, $user) {
        $p = read_json('saxo-pending.json', []);
        foreach ($p as $k => $v) if (time() - ($v['at'] ?? 0) > 3600) unset($p[$k]);
        $p[hash('sha256', $state)] = ['user' => $user, 'at' => time()];
        write_json('saxo-pending.json', $p);
    });
    $qs = http_build_query(['response_type' => 'code', 'client_id' => $c['appKey'], 'state' => $state, 'redirect_uri' => saxo_redirect_url()], '', '&', PHP_QUERY_RFC3986);
    return ['url' => saxo_auth_base($c) . '/authorize?' . $qs];
}

function saxo_token_call(callable $fetch, array $c, array $params): array {
    $body = http_build_query($params + ['client_id' => $c['appKey'], 'client_secret' => $c['appSecret']], '', '&');
    $r = $fetch(saxo_auth_base($c) . '/token', ['method' => 'POST', 'headers' => ['Content-Type' => 'application/x-www-form-urlencoded', 'Accept' => 'application/json'], 'body' => $body, 'timeout' => 30]);
    $j = $r['body'] !== '' ? json_decode($r['body'], true) : null;
    if ($r['status'] >= 200 && $r['status'] < 300 && is_array($j) && !empty($j['access_token'])) return $j;
    $msg = is_array($j) ? (string) ($j['error_description'] ?? $j['error'] ?? '') : '';
    if ($r['status'] === 400 || $r['status'] === 401) throw new SaxoError('Saxo weigerde de aanmelding' . ($msg !== '' ? " ($msg)" : '') . '. Meld je opnieuw aan bij Saxo.', 401, 'expired');
    throw new SaxoError('Saxo is niet bereikbaar (HTTP ' . $r['status'] . ')', 502, 'api');
}

function saxo_token_record(array $j, ?array $old): array {
    $now = now_ms();
    return [
        'accessToken' => $j['access_token'], 'accessExpires' => $now + (int) (($j['expires_in'] ?? 0) ?: 1200) * 1000 - 30000,
        'refreshToken' => $j['refresh_token'] ?? ($old['refreshToken'] ?? null),
        'refreshExpires' => $now + (int) (($j['refresh_token_expires_in'] ?? 0) ?: 2400) * 1000 - 30000,
        'connectedAt' => $old['connectedAt'] ?? gmdate('Y-m-d\TH:i:s.000\Z'),
    ];
}

/** Terugkeer van Saxo na het aanmelden. De eenmalige 'state' bepaalt voor welke gebruiker het is. */
function saxo_callback(callable $fetch, array $q): array {
    $state = (string) ($q['state'] ?? '');
    $pending = with_lock('saxo-pending', function () use ($state) {
        $p = read_json('saxo-pending.json', []);
        $k = hash('sha256', $state);
        $hit = $p[$k] ?? null;
        unset($p[$k]);
        write_json('saxo-pending.json', $p);
        return $hit && time() - $hit['at'] <= 3600 ? $hit : null;
    });
    if ($state === '' || !$pending) return ['ok' => false, 'message' => 'Deze koppeling is verlopen of al gebruikt. Start opnieuw vanuit Helder.'];
    if (!empty($q['error'])) return ['ok' => false, 'message' => 'Saxo gaf geen toestemming' . (!empty($q['error_description']) ? ': ' . $q['error_description'] : '.')];
    if (empty($q['code'])) return ['ok' => false, 'message' => 'Geen code ontvangen van Saxo.'];
    $c = require_saxo();
    $j = saxo_token_call($fetch, $c, ['grant_type' => 'authorization_code', 'code' => (string) $q['code'], 'redirect_uri' => saxo_redirect_url()]);
    $user = $pending['user'];
    with_lock('saxo:' . bin2hex($user), fn() => write_json(saxo_token_file($user), saxo_token_record($j, null)));
    return ['ok' => true, 'message' => 'Saxo Bank is gekoppeld. Helder haalt nu je portefeuille op.'];
}

/** Geldige toegangssleutel, zo nodig vernieuwd (de vernieuwingssleutel verandert telkens). */
function saxo_access_token(callable $fetch, array $c, string $user): string {
    return with_lock('saxo:' . bin2hex($user), function () use ($fetch, $c, $user) {
        $t = read_json(saxo_token_file($user), null);
        if (!is_array($t) || empty($t['refreshToken'])) throw new SaxoError('Saxo is nog niet gekoppeld', 401, 'expired');
        if ($t['accessExpires'] > now_ms()) return (string) $t['accessToken'];
        if ($t['refreshExpires'] <= now_ms()) throw new SaxoError('Je Saxo-aanmelding is verlopen. Meld je opnieuw aan bij Saxo.', 401, 'expired');
        $j = saxo_token_call($fetch, $c, ['grant_type' => 'refresh_token', 'refresh_token' => $t['refreshToken'], 'redirect_uri' => saxo_redirect_url()]);
        $nt = saxo_token_record($j, $t);
        write_json(saxo_token_file($user), $nt);
        return (string) $nt['accessToken'];
    });
}

function saxo_get(callable $fetch, array $c, string $token, string $pathOrUrl): array {
    $url = preg_match('#^https?:#', $pathOrUrl) ? $pathOrUrl : saxo_api_base($c) . $pathOrUrl;
    $r = $fetch($url, ['method' => 'GET', 'headers' => ['Authorization' => 'Bearer ' . $token, 'Accept' => 'application/json'], 'timeout' => 30]);
    $j = $r['body'] !== '' ? json_decode($r['body'], true) : null;
    if ($r['status'] >= 200 && $r['status'] < 300) return is_array($j) ? $j : [];
    if ($r['status'] === 401) throw new SaxoError('Je Saxo-aanmelding is verlopen. Meld je opnieuw aan bij Saxo.', 401, 'expired');
    if ($r['status'] === 403) throw new SaxoError('Saxo geeft geen toegang tot deze gegevens (is je app voor je live-rekening goedgekeurd?)', 403, 'config');
    if ($r['status'] === 429) throw new SaxoError('Saxo laat even geen nieuwe verzoeken toe (limiet bereikt). Probeer over een minuut opnieuw.', 429, 'limit');
    $msg = is_array($j) ? (string) ($j['Message'] ?? $j['message'] ?? $j['ErrorCode'] ?? '') : '';
    throw new SaxoError('Saxo: ' . ($msg !== '' ? $msg : 'HTTP ' . $r['status']), 502, 'api');
}

/** Alle pagina's van een lijst (Saxo geeft een "__next"-link zolang er meer is). */
function saxo_list(callable $fetch, array $c, string $token, string $path): array {
    $out = [];
    $next = $path;
    for ($i = 0; $next && $i < 50; $i++) {
        $j = saxo_get($fetch, $c, $token, $next);
        foreach (($j['Data'] ?? []) as $x) $out[] = $x;
        $next = $j['__next'] ?? null;
    }
    return $out;
}

/** Haalt portefeuille, saldo, transacties en kasbewegingen op, in het Helder-formaat. */
function saxo_fetch_all(callable $fetch, string $user, array $b): array {
    @set_time_limit(120);
    $c = require_saxo();
    $token = saxo_access_token($fetch, $c, $user);
    $today = gmdate('Y-m-d');
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['fromDate'] ?? '')) ? $b['fromDate'] : '2010-01-01';
    $client = saxo_get($fetch, $c, $token, '/port/v1/clients/me');
    $ck = rawurlencode((string) ($client['ClientKey'] ?? ''));
    if ($ck === '') throw new SaxoError('Saxo gaf geen klantnummer terug', 502, 'api');
    $balance = saxo_get($fetch, $c, $token, '/port/v1/balances/me');
    $net = saxo_list($fetch, $c, $token, '/port/v1/netpositions/me?FieldGroups=NetPositionBase,NetPositionView,DisplayAndFormat&$top=500');
    $range = "FromDate=$from&ToDate=$today";
    $trades = saxo_list($fetch, $c, $token, "/cs/v1/reports/trades/$ck?$range");
    $bookings = [];
    $partial = false;
    try { $bookings = saxo_list($fetch, $c, $token, "/cs/v1/reports/bookings/$ck?$range"); }
    catch (SaxoError $e) { if ($e->kind === 'expired') throw $e; $partial = true; }
    $byType = [];
    foreach ($net as $p) { $nb = $p['NetPositionBase'] ?? []; if (isset($nb['Uic'])) $byType[$nb['AssetType'] ?? 'Stock'][(string) $nb['Uic']] = true; }
    foreach ($trades as $t) if (isset($t['Uic'])) $byType[$t['AssetType'] ?? 'Stock'][(string) $t['Uic']] = true;
    $details = [];
    foreach ($byType as $type => $uics) {
        try { $details = array_merge($details, saxo_list($fetch, $c, $token, '/ref/v1/instruments/details?Uics=' . implode(',', array_slice(array_keys($uics), 0, 200)) . '&AssetTypes=' . rawurlencode((string) $type))); }
        catch (SaxoError $e) { if ($e->kind === 'expired') throw $e; }
    }
    $out = saxo_normalize(['balance' => $balance, 'netPositions' => $net, 'details' => $details, 'trades' => $trades, 'bookings' => $bookings]);
    $out['currency'] = (string) ($client['DefaultCurrency'] ?? $balance['Currency'] ?? 'EUR');
    $out['partial'] = $partial;
    return $out;
}

function saxo_disconnect(string $user): array {
    with_lock('saxo:' . bin2hex($user), function () use ($user) { @unlink(data_dir() . '/' . saxo_token_file($user)); });
    return ['ok' => true];
}

function saxo_callback_page(array $r): string {
    $msg = htmlspecialchars($r['message'], ENT_QUOTES, 'UTF-8');
    $title = $r['ok'] ? 'Saxo gekoppeld' : 'Koppeling niet gelukt';
    $icon = $r['ok'] ? '✓' : '!';
    $color = $r['ok'] ? '#1baf7a' : '#d9480f';
    return <<<HTML
<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>$title — Helder</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f5f7fb;color:#14284b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.c{background:#fff;border-radius:14px;padding:28px;max-width:420px;box-shadow:0 2px 12px rgba(20,40,75,.1);text-align:center}.i{width:56px;height:56px;border-radius:50%;background:$color;color:#fff;font-size:30px;line-height:56px;margin:0 auto 12px}
a{display:inline-block;margin-top:16px;background:#14284b;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none}p.s{color:#5c6b85;font-size:14px}</style></head>
<body><div class="c"><div class="i">$icon</div><h1 style="font-size:20px;margin:0 0 8px">$title</h1><p>$msg</p>
<p class="s">Gebruik je Helder als app op je iPhone? Sluit dit venster en open Helder opnieuw.</p><a href="/?saxo=1#invest">Naar Helder</a></div></body></html>
HTML;
}
