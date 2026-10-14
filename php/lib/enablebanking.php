<?php
/*
 * Bankkoppeling via Enable Banking (PSD2), voor KBC/CBC, Argenta en andere Europese banken.
 * Zelfde gedrag als server/enablebanking.js.
 *
 * - De sleutel van je Enable Banking-app staat enkel op de server (helder-data/enablebanking.json),
 *   wordt nooit naar de browser gestuurd en is niet via het web bereikbaar.
 * - Je bankwachtwoord gaat nooit via Helder: je meldt je aan bij je eigen bank (itsme, kaartlezer, app).
 * - Helder vraagt enkel leestoegang (saldo en transacties). Na ± 180 dagen moet je opnieuw toestemming geven.
 */

declare(strict_types=1);

function eb_base(): string { return rtrim((string) cfg('FLUX_EB_BASE_URL', 'https://api.enablebanking.com'), '/'); }

final class BankError extends Exception {
    public int $status;
    public string $kind;
    public function __construct(string $message, int $status = 502, string $kind = 'api') { parent::__construct($message); $this->status = $status; $this->kind = $kind; }
}

function eb_config(): ?array {
    $c = read_json('enablebanking.json', null);
    return is_array($c) && !empty($c['appId']) && !empty($c['privateKey']) ? $c : null;
}

function eb_jwt(array $c): string {
    $now = time();
    $header = b64url(json_encode(['typ' => 'JWT', 'alg' => 'RS256', 'kid' => $c['appId']]));
    $claims = b64url(json_encode(['iss' => 'enablebanking.com', 'aud' => 'api.enablebanking.com', 'iat' => $now, 'exp' => $now + 3600]));
    $key = openssl_pkey_get_private($c['privateKey']);
    if (!$key || !openssl_sign("$header.$claims", $sig, $key, OPENSSL_ALGO_SHA256)) throw new BankError('De privésleutel van Enable Banking is ongeldig', 400, 'config');
    return "$header.$claims." . b64url($sig);
}

/** Verzoek naar Enable Banking. Geeft de JSON terug of gooit een BankError met de uitleg van de bank. */
function eb_call(callable $fetch, array $c, string $method, string $path, $body = null, array $extraHeaders = []) {
    $headers = ['Authorization' => 'Bearer ' . eb_jwt($c), 'Accept' => 'application/json'] + $extraHeaders;
    if ($body !== null) $headers['Content-Type'] = 'application/json';
    $r = $fetch(eb_base() . $path, ['method' => $method, 'headers' => $headers, 'body' => $body !== null ? json_encode($body, JSON_UNESCAPED_SLASHES) : null, 'timeout' => 60]);
    $j = $r['body'] !== '' ? json_decode($r['body'], true) : null;
    if ($r['status'] >= 200 && $r['status'] < 300) return $j ?? [];
    $msg = is_array($j) ? (string) ($j['message'] ?? $j['detail'] ?? $j['error'] ?? '') : '';
    $code = is_array($j) ? (string) ($j['error'] ?? $j['code'] ?? '') : '';
    if (is_array($j['detail'] ?? null)) $msg = json_encode($j['detail']);
    $text = 'Enable Banking: ' . ($msg !== '' ? $msg : 'HTTP ' . $r['status']);
    if ($r['status'] === 401 && preg_match('/session|expired|consent|revoked/i', $code . ' ' . $msg)) throw new BankError('De toestemming bij je bank is verlopen of ingetrokken. Koppel je bank opnieuw.', 401, 'expired');
    if ($r['status'] === 401 || $r['status'] === 403) throw new BankError($text . ' (klopt de app-ID en de sleutel? Is de app actief?)', 400, 'config');
    if ($r['status'] === 429) throw new BankError('Je bank laat even geen nieuwe verzoeken toe (limiet bereikt). Probeer later opnieuw.', 429, 'limit');
    throw new BankError($text, $r['status'] >= 500 ? 502 : 400, $code === 'REDIRECT_URI_NOT_ALLOWED' ? 'redirect' : 'api');
}

function bank_file(string $user): string { return 'bank-' . bin2hex($user) . '.json'; }

function bank_data(string $user): array {
    $d = read_json(bank_file($user), []);
    return ['connections' => $d['connections'] ?? []];
}

function public_url(): string {
    $u = (string) cfg('FLUX_PUBLIC_URL', '');
    if ($u !== '') return rtrim($u, '/');
    $host = preg_replace('/[^a-zA-Z0-9.:\[\]-]/', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
    return (is_secure() ? 'https' : 'http') . '://' . $host;
}

function redirect_url(): string { return public_url() . '/api/bank/callback'; }

/** Lijst van verbindingen zonder geheime gegevens. */
function bank_public_connections(array $connections): array {
    return array_map(fn($c) => [
        'id' => $c['id'], 'aspsp' => $c['aspsp'], 'country' => $c['country'], 'validUntil' => $c['validUntil'] ?? null,
        'createdAt' => $c['createdAt'] ?? null, 'accounts' => $c['accounts'] ?? [],
    ], $connections);
}

function bank_status(string $user): array {
    $c = eb_config();
    return [
        'configured' => $c !== null,
        'appId' => $c['appId'] ?? null,
        'appName' => $c['appName'] ?? null,
        'redirectUrl' => redirect_url(),
        'connections' => bank_public_connections(bank_data($user)['connections']),
    ];
}

function bank_save_config(callable $fetch, array $b): array {
    if (!empty($b['remove'])) { @unlink(data_dir() . '/enablebanking.json'); return ['configured' => false]; }
    $appId = trim((string) ($b['appId'] ?? ''));
    $pem = trim((string) ($b['privateKey'] ?? ''));
    if (!preg_match('/^[a-zA-Z0-9-]{8,80}$/', $appId)) throw new BankError('Vul de Application ID in (staat in het Control Panel van Enable Banking)', 400, 'config');
    if (strpos($pem, 'PRIVATE KEY') === false) throw new BankError('Kies het .pem-bestand met de privésleutel dat je bij het registreren van de app kreeg', 400, 'config');
    $key = openssl_pkey_get_private($pem);
    if (!$key || (openssl_pkey_get_details($key)['type'] ?? null) !== OPENSSL_KEYTYPE_RSA) throw new BankError('Dit is geen geldige RSA-privésleutel', 400, 'config');
    $c = ['appId' => $appId, 'privateKey' => $pem];
    $app = eb_call($fetch, $c, 'GET', '/application'); // controleert meteen of app-ID en sleutel kloppen
    $c['appName'] = (string) ($app['name'] ?? '');
    $c['savedAt'] = gmdate('c');
    write_json('enablebanking.json', $c);
    return ['configured' => true, 'appId' => $appId, 'appName' => $c['appName'], 'environment' => $app['environment'] ?? null, 'active' => $app['active'] ?? null];
}

function require_eb(): array {
    $c = eb_config();
    if (!$c) throw new BankError('De bankkoppeling is nog niet ingesteld', 400, 'config');
    return $c;
}

function bank_aspsps(callable $fetch, string $country): array {
    $country = strtoupper(preg_replace('/[^A-Za-z]/', '', $country) ?: 'BE');
    $r = eb_call($fetch, require_eb(), 'GET', '/aspsps?country=' . rawurlencode($country));
    $out = [];
    foreach (($r['aspsps'] ?? []) as $a) {
        if (isset($a['psu_types']) && is_array($a['psu_types']) && !in_array('personal', $a['psu_types'], true)) continue;
        $out[] = ['name' => (string) $a['name'], 'country' => (string) ($a['country'] ?? $country), 'logo' => $a['logo'] ?? null,
            'maxDays' => isset($a['maximum_consent_validity']) ? (int) floor($a['maximum_consent_validity'] / 86400) : null];
    }
    usort($out, fn($x, $y) => strcasecmp($x['name'], $y['name']));
    return ['aspsps' => $out];
}

function bank_connect(callable $fetch, string $user, array $b): array {
    $c = require_eb();
    $aspsp = trim((string) ($b['aspsp'] ?? ''));
    $country = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($b['country'] ?? 'BE')) ?: 'BE');
    if ($aspsp === '') throw new BankError('Kies je bank', 400, 'input');
    $days = max(1, min(180, (int) ($b['maxDays'] ?? 180)));
    $state = b64url(random_bytes(24));
    $auth = eb_call($fetch, $c, 'POST', '/auth', [
        'access' => ['valid_until' => gmdate('Y-m-d\TH:i:s\Z', time() + $days * 86400 - 3600)],
        'aspsp' => ['name' => $aspsp, 'country' => $country],
        'state' => $state,
        'redirect_url' => redirect_url(),
        'psu_type' => 'personal',
    ]);
    if (empty($auth['url'])) throw new BankError('Enable Banking gaf geen aanmeldlink terug');
    with_lock('bank-pending', function () use ($state, $user, $aspsp, $country) {
        $p = read_json('bank-pending.json', []);
        foreach ($p as $k => $v) if (time() - ($v['at'] ?? 0) > 3600) unset($p[$k]);
        $p[hash('sha256', $state)] = ['user' => $user, 'aspsp' => $aspsp, 'country' => $country, 'at' => time()];
        write_json('bank-pending.json', $p);
    });
    return ['url' => $auth['url']];
}

/**
 * Terugkeer van de bank. Werkt ook zonder sessiecookie (bv. een iPhone-app die de bank in Safari opent):
 * de eenmalige, geheime 'state' bepaalt voor welke gebruiker de koppeling is.
 */
function bank_callback(callable $fetch, array $q): array {
    $state = (string) ($q['state'] ?? '');
    $pending = with_lock('bank-pending', function () use ($state) {
        $p = read_json('bank-pending.json', []);
        $k = hash('sha256', $state);
        $hit = $p[$k] ?? null;
        unset($p[$k]);
        write_json('bank-pending.json', $p);
        return $hit && time() - $hit['at'] <= 3600 ? $hit : null;
    });
    if ($state === '' || !$pending) return ['ok' => false, 'message' => 'Deze koppeling is verlopen of al gebruikt. Start opnieuw vanuit Helder.'];
    if (!empty($q['error'])) return ['ok' => false, 'message' => 'Je bank gaf geen toestemming' . (!empty($q['error_description']) ? ': ' . $q['error_description'] : '.')];
    if (empty($q['code'])) return ['ok' => false, 'message' => 'Geen code ontvangen van de bank.'];
    $s = eb_call($fetch, require_eb(), 'POST', '/sessions', ['code' => (string) $q['code']]);
    if (empty($s['session_id'])) return ['ok' => false, 'message' => 'Enable Banking gaf geen sessie terug.'];
    $accounts = [];
    foreach (($s['accounts'] ?? []) as $a) {
        $iban = $a['account_id']['iban'] ?? ($a['account_id']['other']['identification'] ?? '');
        $accounts[] = ['uid' => (string) ($a['uid'] ?? ''), 'iban' => strtoupper(preg_replace('/\s/', '', (string) $iban)),
            'name' => (string) ($a['name'] ?? $a['product'] ?? ''), 'currency' => (string) ($a['currency'] ?? 'EUR')];
    }
    $conn = ['id' => (string) $s['session_id'], 'aspsp' => $pending['aspsp'], 'country' => $pending['country'],
        'validUntil' => $s['access']['valid_until'] ?? null, 'createdAt' => gmdate('c'), 'accounts' => $accounts];
    $user = $pending['user'];
    with_lock('bank:' . bin2hex($user), function () use ($user, $conn) {
        $d = bank_data($user);
        // Een nieuwe koppeling met dezelfde bank vervangt de oude (bv. na verlopen toestemming)
        $d['connections'] = array_values(array_filter($d['connections'], fn($c) => !($c['aspsp'] === $conn['aspsp'] && $c['country'] === $conn['country'])));
        $d['connections'][] = $conn;
        write_json(bank_file($user), $d);
    });
    return ['ok' => true, 'message' => $pending['aspsp'] . ' is gekoppeld (' . count($accounts) . ' rekening' . (count($accounts) === 1 ? '' : 'en') . ').'];
}

function bank_connection(string $user, string $id): array {
    foreach (bank_data($user)['connections'] as $c) if ($c['id'] === $id) return $c;
    throw new BankError('Onbekende bankkoppeling', 404, 'input');
}

/** Transacties en saldo van één rekening ophalen. De gebruiker is aanwezig: PSU-headers meesturen. */
function bank_fetch(callable $fetch, string $user, array $b): array {
    $c = require_eb();
    $conn = bank_connection($user, (string) ($b['connectionId'] ?? ''));
    $uid = (string) ($b['accountUid'] ?? '');
    if (!in_array($uid, array_column($conn['accounts'], 'uid'), true)) throw new BankError('Onbekende rekening', 404, 'input');
    $psu = array_filter(['PSU-IP-Address' => (string) ($_SERVER['REMOTE_ADDR'] ?? ''), 'PSU-User-Agent' => substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200)]);
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['dateFrom'] ?? '')) ? $b['dateFrom'] : gmdate('Y-m-d', time() - 90 * 86400);
    $path = '/accounts/' . rawurlencode($uid);
    $list = function (string $from) use ($fetch, $c, $path, $psu) {
        $txs = [];
        $key = null;
        for ($page = 0; $page < 60; $page++) {
            $qs = 'date_from=' . $from . ($key ? '&continuation_key=' . rawurlencode($key) : '');
            $r = eb_call($fetch, $c, 'GET', "$path/transactions?$qs", null, $psu);
            foreach (($r['transactions'] ?? []) as $t) $txs[] = $t;
            $key = $r['continuation_key'] ?? null;
            if (!$key) break;
        }
        return $txs;
    };
    $limited = false;
    try { $txs = $list($from); }
    catch (BankError $e) {
        // Sommige banken geven niet zo ver terug: dan de laatste 90 dagen
        if ($e->kind !== 'api' || $from >= gmdate('Y-m-d', time() - 90 * 86400)) throw $e;
        $txs = $list(gmdate('Y-m-d', time() - 89 * 86400));
        $limited = true;
    }
    $balances = [];
    try { $balances = eb_call($fetch, $c, 'GET', "$path/balances", null, $psu)['balances'] ?? []; }
    catch (BankError $e) { if ($e->kind === 'expired') throw $e; }
    return ['transactions' => $txs, 'balances' => $balances, 'limited' => $limited, 'dateFrom' => $limited ? gmdate('Y-m-d', time() - 89 * 86400) : $from];
}

function bank_disconnect(callable $fetch, string $user, array $b): array {
    $id = (string) ($b['connectionId'] ?? '');
    $c = eb_config();
    if ($c) { try { eb_call($fetch, $c, 'DELETE', '/sessions/' . rawurlencode($id)); } catch (Throwable $e) { /* toch lokaal verwijderen */ } }
    with_lock('bank:' . bin2hex($user), function () use ($user, $id) {
        $d = bank_data($user);
        $d['connections'] = array_values(array_filter($d['connections'], fn($x) => $x['id'] !== $id));
        write_json(bank_file($user), $d);
    });
    return ['ok' => true];
}

function bank_callback_page(array $r): string {
    $msg = htmlspecialchars($r['message'], ENT_QUOTES, 'UTF-8');
    $title = $r['ok'] ? 'Bank gekoppeld' : 'Koppeling niet gelukt';
    $icon = $r['ok'] ? '✓' : '!';
    $color = $r['ok'] ? '#1baf7a' : '#d9480f';
    return <<<HTML
<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>$title — Helder</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f5f7fb;color:#14284b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.c{background:#fff;border-radius:14px;padding:28px;max-width:420px;box-shadow:0 2px 12px rgba(20,40,75,.1);text-align:center}.i{width:56px;height:56px;border-radius:50%;background:$color;color:#fff;font-size:30px;line-height:56px;margin:0 auto 12px}
a{display:inline-block;margin-top:16px;background:#14284b;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none}p.s{color:#5c6b85;font-size:14px}</style></head>
<body><div class="c"><div class="i">$icon</div><h1 style="font-size:20px;margin:0 0 8px">$title</h1><p>$msg</p>
<p class="s">Gebruik je Helder als app op je iPhone? Sluit dit venster en open Helder opnieuw.</p><a href="/?koppeling=1#bank">Naar Helder</a></div></body></html>
HTML;
}
