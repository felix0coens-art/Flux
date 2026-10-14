<?php
/*
 * Toegangspunt van de Helder-API op PHP-hosting. .htaccess stuurt alle /api/...-verzoeken hierheen.
 * De rest van de code staat in php/lib (niet rechtstreeks bereikbaar via het web).
 */

declare(strict_types=1);

require __DIR__ . '/php/lib/helder.php';
require __DIR__ . '/php/lib/lookup.php';
require __DIR__ . '/php/lib/prices.php';
require __DIR__ . '/php/lib/degiro.php';
require __DIR__ . '/php/lib/ai.php';
require __DIR__ . '/php/lib/enablebanking.php';
require __DIR__ . '/php/lib/saxo.php';
require __DIR__ . '/php/lib/files.php';
require __DIR__ . '/php/lib/accounts.php';

@set_time_limit(300);
ini_set('display_errors', '0');

const SECURITY_HEADERS = [
    'X-Content-Type-Options' => 'nosniff',
    'Referrer-Policy' => 'same-origin',
    'X-Frame-Options' => 'DENY',
    'Content-Security-Policy' => "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
];

function send(int $status, $body, array $headers = []): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    foreach (SECURITY_HEADERS + $headers as $k => $v) header("$k: $v", true);
    echo json_out($body);
}

/** Leest de JSON-body. $assoc=false voor gegevens (behoudt {} versus []). */
function body(bool $assoc = true) {
    static $raw = null;
    if ($raw === null) {
        $raw = (string) file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
        if (strlen($raw) > MAX_BODY) throw new HttpError(413, 'Te groot');
    }
    if (trim($raw) === '') return $assoc ? [] : new stdClass();
    $data = json_decode($raw, $assoc);
    if ($data === null) throw new HttpError(400, 'Ongeldige JSON');
    return $data;
}

function handle(string $method, string $path): void {
    // CSRF-bescherming: wijzigende verzoeken moeten van de app zelf komen
    if ($method !== 'GET' && ($_SERVER['HTTP_X_FLUX'] ?? '') !== '1') throw new HttpError(403, 'Verboden');
    $user = session_user();
    $users = get_users();
    $me = $user ? ($users[$user] ?? null) : null;
    $role = user_role($me);
    $cookieAge = SESSION_DAYS * 86400;
    $aiKey = $user && $role !== 'admin' ? ai_key_for($user, $me) : '';
    $aiOk = $aiKey !== '';

    if ($path === '/api/session' && $method === 'GET') {
        $code = setup_code();
        send(200, array_merge($me ? user_public($user, $me) : ['user' => null, 'role' => 'none'], [
            'setupRequired' => $code !== null,
            'setupHint' => $code !== null ? 'De setupcode staat in het bestand SETUPCODE.txt in de map helder-data op je hosting (DirectAdmin → File Manager).' : null,
            'auth' => ['google' => google_configured(), 'registration' => site_settings()['registration'], 'signupGoogle' => google_configured() && signup_allowed('google'), 'signupPassword' => signup_allowed('password')],
            'features' => ['ai' => $aiOk, 'aiModel' => $aiOk ? ai_model() : null, 'aiOwnKey' => $user ? ai_user_key($user) !== '' : false,
                'aiServer' => ai_available() && user_may_ai($me), 'bank' => $me !== null && $role !== 'admin', 'saxo' => $me !== null && $role !== 'admin'],
        ]));
        return;
    }

    // Aanmelden met Google
    if ($path === '/api/auth/google' && $method === 'GET') {
        // ?link=1: de aangemelde gebruiker koppelt zijn bestaande account aan Google
        $link = null;
        if (!empty($_GET['link'])) {
            if (!$user || !$me || isset($me['google'])) { header('Location: /#settings', true, 302); return; }
            $link = $user;
        }
        header('Location: ' . google_start($link), true, 302);
        header('Cache-Control: no-store');
        return;
    }
    if ($path === '/api/auth/google/callback' && $method === 'GET') {
        try { $r = google_callback('http_fetch', $_GET); }
        catch (RuntimeException $e) { $r = ['ok' => false, 'message' => 'Google is niet bereikbaar. Probeer later opnieuw.']; }
        header('Cache-Control: no-store');
        foreach (SECURITY_HEADERS as $k => $v) header("$k: $v");
        if ($r['ok']) {
            $token = create_session($r['user']);
            header('Set-Cookie: ' . session_cookie($token, $cookieAge));
            header('Location: /' . (!empty($r['linked']) ? '?google=gekoppeld#settings' : (!empty($r['new']) ? '?welkom=1' : '')), true, 302);
            return;
        }
        http_response_code(400);
        header('Content-Type: text/html; charset=utf-8');
        echo auth_page($r);
        return;
    }

    if ($path === '/api/setup' && $method === 'POST') {
        $b = body();
        $code = setup_code();
        if ($code === null) throw new HttpError(400, 'Er bestaat al een account');
        if (rate_limited()) throw new HttpError(429, 'Te veel pogingen, probeer later opnieuw');
        record_attempt();
        if (strtoupper(trim((string) ($b['code'] ?? ''))) !== $code) throw new HttpError(401, 'Verkeerde setupcode (zie SETUPCODE.txt in helder-data)');
        if (!valid_username($b['username'] ?? null)) throw new HttpError(400, 'Gebruikersnaam: 2-40 tekens (letters, cijfers, . _ -)');
        if (!valid_password($b['password'] ?? null)) throw new HttpError(400, 'Wachtwoord: minstens 8 tekens');
        create_user($b['username'], $b['password']);
        @unlink(data_dir() . '/SETUPCODE.txt');
        $token = create_session($b['username']);
        send(200, ['user' => $b['username']], ['Set-Cookie' => session_cookie($token, $cookieAge)]);
        return;
    }

    if ($path === '/api/login' && $method === 'POST') {
        $b = body();
        if (rate_limited()) throw new HttpError(429, 'Te veel pogingen, probeer binnen 15 minuten opnieuw');
        $name = $b['username'] ?? null;
        if (valid_username($name)) ensure_admin($name);
        $users = get_users();
        $u = valid_username($name) ? ($users[$name] ?? null) : null;
        if (!$u || !verify_password((string) ($b['password'] ?? ''), $u)) {
            record_attempt();
            if ($u) log_login($name, 'wachtwoord', false, 'fout wachtwoord');
            throw new HttpError(401, 'Gebruikersnaam of wachtwoord klopt niet');
        }
        if (!empty($u['disabled'])) { log_login($name, 'wachtwoord', false, 'account geblokkeerd'); throw new HttpError(403, 'Dit account is geblokkeerd'); }
        log_login($name, 'wachtwoord', true);
        $token = create_session($name);
        send(200, user_public($name, $u), ['Set-Cookie' => session_cookie($token, $cookieAge)]);
        return;
    }

    if ($path === '/api/register' && $method === 'POST') {
        if (rate_limited()) throw new HttpError(429, 'Te veel pogingen, probeer later opnieuw');
        record_attempt(); // ook geslaagde registraties tellen mee, tegen massaal aanmaken
        $name = register_user(body());
        $token = create_session($name);
        send(200, user_public($name, get_users()[$name]), ['Set-Cookie' => session_cookie($token, $cookieAge)]);
        return;
    }

    if ($path === '/api/logout' && $method === 'POST') {
        $b = body();
        destroy_session(!empty($b['everywhere']));
        send(200, ['ok' => true], ['Set-Cookie' => session_cookie('', 0)]);
        return;
    }

    // Terugkeer van de bank na het aanmelden (gewone pagina, de 'state' bepaalt de gebruiker)
    if ($path === '/api/bank/callback' && $method === 'GET') {
        try { $r = bank_callback('http_fetch', $_GET); }
        catch (BankError $e) { $r = ['ok' => false, 'message' => $e->getMessage()]; }
        http_response_code($r['ok'] ? 200 : 400);
        header('Content-Type: text/html; charset=utf-8');
        header('Cache-Control: no-store');
        foreach (SECURITY_HEADERS as $k => $v) header("$k: $v");
        echo bank_callback_page($r);
        return;
    }

    // Terugkeer van Saxo na het aanmelden
    if ($path === '/api/saxo/callback' && $method === 'GET') {
        try { $r = saxo_callback('http_fetch', $_GET); }
        catch (SaxoError $e) { $r = ['ok' => false, 'message' => $e->getMessage()]; }
        catch (RuntimeException $e) { $r = ['ok' => false, 'message' => 'Saxo is niet bereikbaar.']; }
        http_response_code($r['ok'] ? 200 : 400);
        header('Content-Type: text/html; charset=utf-8');
        header('Cache-Control: no-store');
        foreach (SECURITY_HEADERS as $k => $v) header("$k: $v");
        echo saxo_callback_page($r);
        return;
    }

    if (!$user || !$me || !empty($me['disabled'])) throw new HttpError(401, 'Niet aangemeld');

    // Beheer: enkel voor de beheerder, die zelf geen financiële gegevens heeft
    if (strpos($path, '/api/admin/') === 0) {
        if ($role !== 'admin') throw new HttpError(403, 'Enkel voor de beheerder');
        if ($path === '/api/admin/overview' && $method === 'GET') { send(200, admin_overview()); return; }
        if ($path === '/api/admin/site' && $method === 'POST') { send(200, save_site_settings(site_changes(body()))); return; }
        if ($path === '/api/admin/user' && $method === 'POST') { send(200, admin_user_action($user, body())); return; }
        throw new HttpError(404, 'Onbekend');
    }
    if ($path === '/api/account/google-unlink' && $method === 'POST') { send(200, google_unlink($user)); return; }

    if ($role === 'admin' && $path !== '/api/password') throw new HttpError(403, 'Het beheerdersaccount heeft geen eigen boekhouding');

    // Bonnetjes bij transacties
    if ($path === '/api/files' && $method === 'POST') { send(200, file_upload($user, body())); return; }
    if ($path === '/api/files/delete' && $method === 'POST') { $b = body(); send(200, file_delete($user, (string) ($b['id'] ?? ''))); return; }
    if (preg_match('#^/api/files/([A-Za-z0-9_-]{8,40})$#', $path, $fm) && $method === 'GET') { file_send($user, $fm[1]); return; }

    if ($path === '/api/account/delete' && $method === 'POST') {
        $b = body();
        if ($role !== 'member') throw new HttpError(400, 'Dit account kan je hier niet verwijderen');
        if (($b['confirm'] ?? '') !== 'VERWIJDER') throw new HttpError(400, 'Typ VERWIJDER om te bevestigen');
        delete_own_account($user);
        send(200, ['ok' => true], ['Set-Cookie' => session_cookie('', 0)]);
        return;
    }

    // Eigen Anthropic API-sleutel (voor AI-classificatie)
    if ($path === '/api/ai/key' && $method === 'GET') {
        $k = user_keys($user)['ai'] ?? null;
        send(200, ['set' => is_array($k), 'hint' => $k['hint'] ?? null, 'server' => ai_available() && user_may_ai($me), 'sdk' => ai_sdk_loaded()]);
        return;
    }
    if ($path === '/api/ai/key' && $method === 'POST') { send(200, ai_save_key('http_fetch', $user, body())); return; }

    if (strpos($path, '/api/bank/') === 0) {
        try {
            if ($path === '/api/bank/status' && $method === 'GET') { send(200, bank_status($user)); return; }
            if ($path === '/api/bank/config' && $method === 'POST') { send(200, bank_save_config('http_fetch', $user, body())); return; }
            if ($path === '/api/bank/aspsps' && $method === 'GET') { send(200, bank_aspsps('http_fetch', $user, (string) ($_GET['country'] ?? 'BE'))); return; }
            if ($path === '/api/bank/connect' && $method === 'POST') { send(200, bank_connect('http_fetch', $user, body())); return; }
            if ($path === '/api/bank/fetch' && $method === 'POST') { send(200, bank_fetch('http_fetch', $user, body())); return; }
            if ($path === '/api/bank/disconnect' && $method === 'POST') { send(200, bank_disconnect('http_fetch', $user, body())); return; }
        } catch (BankError $e) {
            throw new HttpError($e->status, $e->getMessage(), $e->kind);
        } catch (RuntimeException $e) {
            throw new HttpError(502, 'Enable Banking is niet bereikbaar: ' . $e->getMessage());
        }
    }

    if (strpos($path, '/api/saxo/') === 0) {
        try {
            if ($path === '/api/saxo/status' && $method === 'GET') { send(200, saxo_status($user)); return; }
            if ($path === '/api/saxo/config' && $method === 'POST') { send(200, saxo_save_config($user, body())); return; }
            if ($path === '/api/saxo/connect' && $method === 'POST') { send(200, saxo_connect($user)); return; }
            if ($path === '/api/saxo/fetch' && $method === 'POST') { send(200, saxo_fetch_all('http_fetch', $user, body())); return; }
            if ($path === '/api/saxo/disconnect' && $method === 'POST') { send(200, saxo_disconnect($user)); return; }
        } catch (SaxoError $e) {
            throw new HttpError($e->status, $e->getMessage(), $e->kind);
        } catch (RuntimeException $e) {
            throw new HttpError(502, 'Saxo is niet bereikbaar: ' . $e->getMessage());
        }
    }

    if ($path === '/api/sync' && $method === 'POST') {
        $b = body(false);
        // Een verouderde app (uit de cache) mag geen oude gegevens terugzetten
        if (($b->schema ?? null) !== HELDER_VERSION) throw new HttpError(409, 'Er is een nieuwe versie van Helder. Herlaad de pagina.');
        $rev = isset($b->rev) && is_int($b->rev) ? $b->rev : null;
        send(200, sync_user($user, $b->changes ?? null, $rev));
        return;
    }

    if ($path === '/api/data' && $method === 'GET') {
        $d = load_user_data($user);
        send(200, ['rev' => (int) ($d->rev ?? 0), 'state' => $d->state ?? null]);
        return;
    }

    if ($path === '/api/password' && $method === 'POST') {
        $b = body();
        if (!verify_password((string) ($b['current'] ?? ''), get_users()[$user] ?? null)) throw new HttpError(401, 'Huidig wachtwoord klopt niet');
        if (!valid_password($b['password'] ?? null)) throw new HttpError(400, 'Nieuw wachtwoord: minstens 8 tekens');
        set_password($user, $b['password']);
        send(200, ['ok' => true]);
        return;
    }

    if ($path === '/api/lookup' && $method === 'POST') {
        $b = body();
        if (!$aiOk && ($b['provider'] ?? '') !== 'free') $b['provider'] = ($b['provider'] ?? '') === 'ai' ? 'none-ai' : 'free';
        if ($b['provider'] === 'none-ai') throw new HttpError(400, 'AI is niet beschikbaar voor jouw account');
        send(200, lookup_items($b, 'http_fetch', $aiKey));
        return;
    }

    if ($path === '/api/prices' && $method === 'POST') {
        $b = body();
        $list = [];
        foreach (array_slice(is_array($b['instruments'] ?? null) ? $b['instruments'] : [], 0, 40) as $i) {
            $ins = [
                'key' => substr((string) ($i['key'] ?? ''), 0, 60),
                'isin' => preg_match('/^[A-Z]{2}[A-Z0-9]{9}\d$/', (string) ($i['isin'] ?? '')) ? $i['isin'] : '',
                'name' => substr((string) ($i['name'] ?? ''), 0, 80),
                'currency' => substr((string) ($i['currency'] ?? 'EUR'), 0, 4),
                'from' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($i['from'] ?? '')) ? $i['from'] : '2015-01-01',
            ];
            if ($ins['key'] !== '' && ($ins['isin'] !== '' || $ins['name'] !== '')) $list[] = $ins;
        }
        send(200, fetch_prices('http_fetch', $list));
        return;
    }

    if ($path === '/api/degiro/sync' && $method === 'POST') {
        $b = body();
        if (rate_limited()) throw new HttpError(429, 'Te veel pogingen, probeer binnen 15 minuten opnieuw');
        if (empty($b['username']) || empty($b['password'])) throw new HttpError(400, 'Geef je Degiro-gebruikersnaam en wachtwoord');
        try {
            send(200, degiro_fetch_all('http_fetch', (string) $b['username'], (string) $b['password'], (string) ($b['otp'] ?? ''), $b['fromDate'] ?? null));
        } catch (DegiroError $e) {
            if ($e->kind === 'auth') record_attempt();
            throw new HttpError(in_array($e->kind, ['otp', 'auth'], true) ? 401 : 502, $e->getMessage(), $e->kind);
        } catch (HttpError $e) {
            throw $e;
        } catch (Throwable $e) {
            error_log('Helder Degiro: ' . $e->getMessage());
            throw new HttpError(502, 'Degiro is niet bereikbaar of antwoordde onverwacht. Probeer later opnieuw, of gebruik de exportbestanden.');
        }
        return;
    }

    throw new HttpError(404, 'Onbekend');
}

$path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
// Werkt ook als Helder in een submap staat (bv. /helder/api/sync)
$pos = strpos($path, '/api/');
$path = $pos === false ? $path : substr($path, $pos);
try {
    handle($_SERVER['REQUEST_METHOD'] ?? 'GET', $path);
} catch (HttpError $e) {
    send($e->status, array_filter(['error' => $e->getMessage(), 'code' => $e->errorCode], fn($v) => $v !== null));
} catch (Throwable $e) {
    error_log('Helder: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    send(500, ['error' => 'Interne fout']);
}
