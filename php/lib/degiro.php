<?php
/*
 * Rechtstreekse koppeling met Degiro (PHP-versie van server/degiro.js).
 *
 * Degiro heeft geen officiële API; dit gebruikt dezelfde webdiensten als de Degiro-website.
 * Gebruikersnaam, wachtwoord en 2FA-code worden enkel gebruikt om in te loggen en worden NIET
 * bewaard of gelogd; na het ophalen wordt de Degiro-sessie afgesloten.
 */

declare(strict_types=1);

const DEGIRO_BASE = 'https://trader.degiro.nl';
const DEGIRO_UA = 'Mozilla/5.0 (Helder persoonlijke boekhouding; self-hosted)';

final class DegiroError extends Exception {
    public string $kind;
    public function __construct(string $message, string $kind) { parent::__construct($message); $this->kind = $kind; }
}

function dg_cents($v): int { return is_numeric($v) ? (int) round((float) $v * 100) : 0; }
function dg_ddmmyyyy(string $d): string { [$y, $m, $dd] = explode('-', $d); return "$dd/$m/$y"; }
function dg_day($v): string { return substr((string) $v, 0, 10); }

function dg_request(callable $fetch, string $url, array $opts = [], ?string $sessionId = null): array {
    $headers = ['User-Agent' => DEGIRO_UA, 'Accept' => 'application/json'] + ($opts['headers'] ?? []);
    if ($sessionId) $headers['Cookie'] = 'JSESSIONID=' . $sessionId;
    $r = $fetch($url, ['method' => $opts['method'] ?? 'GET', 'headers' => $headers, 'body' => $opts['body'] ?? null, 'timeout' => 30]);
    $json = $r['body'] !== '' ? json_decode($r['body'], true) : null;
    return ['status' => $r['status'], 'ok' => $r['status'] >= 200 && $r['status'] < 300, 'json' => $json];
}

function dg_login(callable $fetch, string $username, string $password, string $otp): string {
    $body = ['username' => $username, 'password' => $password, 'isPassCodeReset' => false, 'isRedirectToMobile' => false, 'queryParams' => new stdClass()];
    $post = fn($url, $b) => dg_request($fetch, $url, ['method' => 'POST', 'headers' => ['Content-Type' => 'application/json'], 'body' => json_encode($b)]);
    $r = $post(DEGIRO_BASE . '/login/secure/login', $body);
    $needsOtp = fn($j) => is_array($j) && (($j['status'] ?? null) === 6 || preg_match('/totp/i', (string) ($j['statusText'] ?? '')));
    $usedOtp = false;
    if ($needsOtp($r['json'])) {
        if ($otp === '') throw new DegiroError('Geef de 2FA-code uit je authenticator-app', 'otp');
        $usedOtp = true;
        $r = $post(DEGIRO_BASE . '/login/secure/login/totp', $body + ['oneTimePassword' => trim($otp)]);
    }
    if (empty($r['json']['sessionId'])) {
        if ($usedOtp || $needsOtp($r['json'])) throw new DegiroError('De 2FA-code klopt niet of is verlopen. Probeer met een nieuwe code.', 'otp');
        $reason = !empty($r['json']['statusText']) ? ' (' . $r['json']['statusText'] . ')' : '';
        throw new DegiroError('Inloggen bij Degiro mislukt: controleer gebruikersnaam en wachtwoord' . $reason, 'auth');
    }
    return (string) $r['json']['sessionId'];
}

function dg_config(callable $fetch, string $sessionId): array {
    $cfg = dg_request($fetch, DEGIRO_BASE . '/login/secure/config', [], $sessionId);
    $data = $cfg['json']['data'] ?? null;
    if (!$data || empty($data['tradingUrl'])) throw new DegiroError('Degiro gaf geen configuratie terug (sessie geweigerd?)', 'api');
    $client = dg_request($fetch, $data['paUrl'] . 'client?sessionId=' . $sessionId, [], $sessionId);
    $intAccount = $client['json']['data']['intAccount'] ?? null;
    if (!$intAccount) throw new DegiroError('Kon je Degiro-rekeningnummer niet ophalen', 'api');
    return $data + ['intAccount' => $intAccount];
}

function dg_row_values($row): array {
    $out = [];
    foreach ((is_array($row) ? ($row['value'] ?? []) : []) as $f) if (isset($f['name'])) $out[$f['name']] = $f['value'] ?? null;
    return $out;
}

/** Zelfde indeling als FluxInvest.movementType (js/invest.js). */
function dg_movement_type(string $d): string {
    if (preg_match('/geldrekening|cash sweep|money market|geldmarktfonds/i', $d)) return 'internal';
    if (preg_match('/terugstorting|opname|withdrawal/i', $d)) return 'withdrawal';
    $types = [
        'dividend_tax' => '/dividendbelasting|dividend tax|withholding|bronheffing/i',
        'dividend' => '/dividend|coupon|kapitaalteruggave|capital return/i',
        'deposit' => '/storting|deposit|ideal|bancontact|sofort/i',
        'withdrawal' => '/terugstorting|opname|withdrawal|uitbetaling/i',
        'fee' => '/kosten|transactiekosten|aansluitingskosten|connection fee|fee|commissie|beurstaks|belasting op beursverrichtingen|tob/i',
        'interest' => '/rente|interest/i',
        'trade' => '/^koop |^verkoop |^buy |^sell /i',
        'fx' => '/valuta (creditering|debitering)|fx (credit|debit)|wisselkoers/i',
        'cashfund' => '/geldmarktfonds|money market|cash fund|fund (compensation|conversion)/i',
    ];
    foreach ($types as $type => $re) if (preg_match($re, $d)) return $type;
    return 'other';
}

/** Haalt portefeuille, transacties en kasbewegingen op in het Helder-formaat. */
function degiro_fetch_all(callable $fetch, string $username, string $password, string $otp, ?string $fromDate = null, ?string $today = null): array {
    $today = $today ?: gmdate('Y-m-d');
    $from = $fromDate && preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromDate) ? $fromDate : '2010-01-01';
    $sessionId = dg_login($fetch, $username, $password, $otp);
    try {
        $cfg = dg_config($fetch, $sessionId);
        $acct = 'intAccount=' . $cfg['intAccount'] . '&sessionId=' . $sessionId;
        $postIds = fn(array $ids) => dg_request($fetch, $cfg['productSearchUrl'] . 'v5/products/info?' . $acct,
            ['method' => 'POST', 'headers' => ['Content-Type' => 'application/json'], 'body' => json_encode(array_values($ids))], $sessionId);

        // Portefeuille
        $pf = dg_request($fetch, $cfg['tradingUrl'] . 'v5/update/' . $cfg['intAccount'] . ';jsessionid=' . $sessionId . '?portfolio=0&totalPortfolio=0', [], $sessionId);
        if (empty($pf['json']['portfolio'])) throw new DegiroError('Kon de portefeuille niet ophalen', 'api');
        $rows = array_map('dg_row_values', $pf['json']['portfolio']['value'] ?? []);
        $products = array_values(array_filter($rows, fn($r) => ($r['positionType'] ?? '') === 'PRODUCT' && (float) ($r['size'] ?? 0) != 0));
        $total = dg_row_values(['value' => $pf['json']['totalPortfolio']['value'] ?? []]);
        $cashEur = dg_cents($total['totalCash'] ?? $total['cash'] ?? 0);

        // Productinfo (naam, ISIN, munt)
        $info = [];
        $ids = array_values(array_unique(array_map(fn($r) => (string) $r['id'], $products)));
        if ($ids) $info = $postIds($ids)['json']['data'] ?? [];
        $positions = array_map(function ($r) use (&$info) {
            $p = $info[(string) $r['id']] ?? [];
            $plBase = is_array($r['plBase'] ?? null) ? ($r['plBase']['EUR'] ?? null) : null;
            return [
                'key' => ($p['isin'] ?? '') ?: (string) $r['id'], 'productId' => (string) $r['id'], 'name' => $p['name'] ?? ('Product ' . $r['id']), 'isin' => $p['isin'] ?? '',
                'symbol' => $p['symbol'] ?? '', 'currency' => $p['currency'] ?? 'EUR',
                'quantity' => (float) ($r['size'] ?? 0), 'price' => (float) ($r['price'] ?? 0),
                'valueEur' => dg_cents($r['value'] ?? 0),
                'costEur' => $plBase !== null ? -dg_cents($plBase) : null,
            ];
        }, $products);

        // Transacties
        $tr = dg_request($fetch, $cfg['reportingUrl'] . 'v4/transactions?fromDate=' . dg_ddmmyyyy($from) . '&toDate=' . dg_ddmmyyyy($today) . '&groupTransactionsByOrder=false&' . $acct, [], $sessionId);
        $tlist = $tr['json']['data'] ?? [];
        $missing = array_values(array_unique(array_filter(array_map(fn($t) => (string) ($t['productId'] ?? ''), $tlist), fn($id) => $id !== '' && !isset($info[$id]))));
        if ($missing) $info += ($postIds($missing)['json']['data'] ?? []);
        $trades = array_map(function ($t) use ($info) {
            $p = $info[(string) ($t['productId'] ?? '')] ?? [];
            $qty = abs((float) ($t['quantity'] ?? 0)) * (($t['buysell'] ?? '') === 'S' ? -1 : 1);
            return [
                'id' => 'api|' . ($t['id'] ?? ''), 'date' => dg_day($t['date'] ?? ''), 'isin' => $p['isin'] ?? '', 'name' => $p['name'] ?? ('Product ' . ($t['productId'] ?? '')),
                'quantity' => $qty, 'price' => (float) ($t['price'] ?? 0), 'currency' => $p['currency'] ?? 'EUR',
                'totalEur' => dg_cents($t['totalPlusFeeInBaseCurrency'] ?? $t['totalInBaseCurrency'] ?? 0),
                'feesEur' => dg_cents($t['totalFeesInBaseCurrency'] ?? 0),
            ];
        }, $tlist);

        // Kasbewegingen (stortingen, dividenden, kosten, ...)
        $ao = dg_request($fetch, $cfg['reportingUrl'] . 'v6/accountoverview?fromDate=' . dg_ddmmyyyy($from) . '&toDate=' . dg_ddmmyyyy($today) . '&' . $acct, [], $sessionId);
        $movements = [];
        $cm = array_values(array_filter($ao['json']['data']['cashMovements'] ?? [], fn($m) => ($m['currency'] ?? 'EUR') === 'EUR' && isset($m['change'])));
        foreach ($cm as $i => $m) {
            $movements[] = [
                'id' => 'api|' . ($m['id'] ?? implode('|', [$m['date'] ?? '', $m['description'] ?? '', $m['change'], $i])),
                'date' => dg_day($m['date'] ?? ''), 'type' => dg_movement_type((string) ($m['description'] ?? '')),
                'amountEur' => dg_cents($m['change']), 'description' => $m['description'] ?? '',
                'isin' => $info[(string) ($m['productId'] ?? '')]['isin'] ?? '',
            ];
        }
        return ['positions' => $positions, 'cashEur' => $cashEur, 'trades' => $trades, 'movements' => $movements];
    } finally {
        // Sessie afsluiten (niet erg als dit mislukt)
        try { dg_request($fetch, DEGIRO_BASE . '/trading/secure/logout;jsessionid=' . $sessionId, [], $sessionId); } catch (Throwable $e) { /* negeren */ }
    }
}
