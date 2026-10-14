<?php
/*
 * Accounts voor een publieke Helder: aanmelden met Google, een aparte beheerder, en een logboek van
 * aanmeldingen. Zelfde gedrag als server/accounts.js.
 *
 * Instellingen (helder-config.php of omgevingsvariabelen):
 *   FLUX_GOOGLE_CLIENT_ID / FLUX_GOOGLE_CLIENT_SECRET   OAuth-client uit Google Cloud Console
 *   FLUX_ADMIN_USERNAME / FLUX_ADMIN_PASSWORD           de beheerder (los van je gewone account)
 *
 * De beheerder ziet wie er een account heeft en wanneer er aangemeld werd, maar nooit iemands
 * financiële gegevens.
 */

declare(strict_types=1);

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
function google_token_url(): string { return (string) cfg('FLUX_GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'); }

function google_configured(): bool { return cfg('FLUX_GOOGLE_CLIENT_ID', '') !== '' && cfg('FLUX_GOOGLE_CLIENT_SECRET', '') !== ''; }

function site_settings(): array {
    $s = read_json('site.json', []);
    return ['registration' => ($s['registration'] ?? 'closed') === 'open' ? 'open' : 'closed'];
}

function save_site_settings(array $changes): array {
    return with_lock('site', function () use ($changes) {
        $s = array_merge(read_json('site.json', []), $changes);
        write_json('site.json', $s);
        return site_settings();
    });
}

function user_role(?array $u): string {
    if (!$u) return 'none';
    if (($u['role'] ?? '') === 'admin') return 'admin';
    return isset($u['google']) ? 'member' : 'owner';
}

function user_public(string $username, array $u): array {
    return [
        'user' => $username,
        'role' => user_role($u),
        'displayName' => $u['displayName'] ?? ($u['google']['name'] ?? $username),
        'email' => $u['google']['email'] ?? null,
        'picture' => $u['google']['picture'] ?? null,
    ];
}

/** Mag deze gebruiker de AI-functie gebruiken? Eigenaar altijd; Google-gebruikers enkel als de beheerder het toelaat. */
function user_may_ai(?array $u): bool { return $u && (user_role($u) === 'owner' || !empty($u['ai'])); }

/** Logboek van aanmeldingen (laatste 2000). Bewaart geen wachtwoorden. */
function log_login(string $username, string $method, bool $ok, string $detail = ''): void {
    with_lock('logins', function () use ($username, $method, $ok, $detail) {
        $list = read_json('logins.json', []);
        $list[] = ['at' => gmdate('c'), 'user' => $username, 'method' => $method, 'ok' => $ok, 'detail' => $detail,
            'ip' => client_ip(), 'ua' => substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 160)];
        if (count($list) > 2000) $list = array_slice($list, -2000);
        write_json('logins.json', $list);
    });
    if ($ok) {
        with_lock('users', function () use ($username) {
            $users = get_users();
            if (!isset($users[$username])) return;
            $users[$username]['lastLogin'] = gmdate('c');
            $users[$username]['logins'] = (int) ($users[$username]['logins'] ?? 0) + 1;
            write_json('users.json', $users);
        });
    }
}

/** De beheerder uit de instellingen aanmaken of zijn wachtwoord bijwerken (gebeurt bij het aanmelden). */
function ensure_admin(string $username): void {
    $name = (string) cfg('FLUX_ADMIN_USERNAME', '');
    $pw = (string) cfg('FLUX_ADMIN_PASSWORD', '');
    if ($name === '' || $pw === '' || $username !== $name || !valid_username($name) || !valid_password($pw)) return;
    with_lock('users', function () use ($name, $pw) {
        $users = get_users();
        $u = $users[$name] ?? null;
        if ($u && user_role($u) !== 'admin') return; // bestaat al als gewone gebruiker: niet overnemen
        if (!$u || !password_verify($pw, $u['pw'] ?? '')) {
            $users[$name] = array_merge($u ?? ['created' => gmdate('c')], ['pw' => password_hash($pw, PASSWORD_DEFAULT), 'role' => 'admin', 'displayName' => 'Beheerder']);
            write_json('users.json', $users);
        }
    });
}

// ---------- Google ----------

function google_redirect_uri(): string { return public_url() . '/api/auth/google/callback'; }

function google_start(): string {
    if (!google_configured()) throw new HttpError(400, 'Aanmelden met Google is niet ingesteld');
    $state = b64url(random_bytes(24));
    $nonce = b64url(random_bytes(16));
    with_lock('google-pending', function () use ($state, $nonce) {
        $p = read_json('google-pending.json', []);
        foreach ($p as $k => $v) if (time() - ($v['at'] ?? 0) > 900) unset($p[$k]);
        $p[hash('sha256', $state)] = ['nonce' => $nonce, 'at' => time()];
        write_json('google-pending.json', $p);
    });
    return GOOGLE_AUTH . '?' . http_build_query([
        'client_id' => cfg('FLUX_GOOGLE_CLIENT_ID'), 'redirect_uri' => google_redirect_uri(), 'response_type' => 'code',
        'scope' => 'openid email profile', 'state' => $state, 'nonce' => $nonce, 'prompt' => 'select_account',
    ]);
}

function b64url_decode(string $s): string { return (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

/**
 * Terugkeer van Google. Wisselt de code in voor een ID-token. Dat token komt rechtstreeks van Google
 * over HTTPS (met ons client secret), dus volstaat het om de inhoud te controleren (OpenID Connect §3.1.3.7).
 * @return array ['ok' => bool, 'user' => ?string, 'message' => string]
 */
function google_callback(callable $fetch, array $q): array {
    $state = (string) ($q['state'] ?? '');
    $pending = with_lock('google-pending', function () use ($state) {
        $p = read_json('google-pending.json', []);
        $k = hash('sha256', $state);
        $hit = $p[$k] ?? null;
        unset($p[$k]);
        write_json('google-pending.json', $p);
        return $hit && time() - $hit['at'] <= 900 ? $hit : null;
    });
    if ($state === '' || !$pending) return ['ok' => false, 'message' => 'Deze aanmelding is verlopen. Probeer opnieuw.'];
    if (!empty($q['error'])) return ['ok' => false, 'message' => 'Aanmelden bij Google werd geannuleerd.'];
    $r = $fetch(google_token_url(), ['method' => 'POST', 'headers' => ['Content-Type' => 'application/x-www-form-urlencoded', 'Accept' => 'application/json'],
        'body' => http_build_query(['code' => (string) ($q['code'] ?? ''), 'client_id' => cfg('FLUX_GOOGLE_CLIENT_ID'), 'client_secret' => cfg('FLUX_GOOGLE_CLIENT_SECRET'),
            'redirect_uri' => google_redirect_uri(), 'grant_type' => 'authorization_code']), 'timeout' => 20]);
    $tok = json_decode($r['body'], true);
    if ($r['status'] !== 200 || empty($tok['id_token'])) return ['ok' => false, 'message' => 'Google weigerde de aanmelding.'];
    $parts = explode('.', $tok['id_token']);
    $claims = count($parts) === 3 ? json_decode(b64url_decode($parts[1]), true) : null;
    if (!is_array($claims)) return ['ok' => false, 'message' => 'Ongeldig antwoord van Google.'];
    $issOk = in_array($claims['iss'] ?? '', ['https://accounts.google.com', 'accounts.google.com'], true);
    $audOk = ($claims['aud'] ?? '') === cfg('FLUX_GOOGLE_CLIENT_ID');
    if (!$issOk || !$audOk || ($claims['exp'] ?? 0) < time() || ($claims['nonce'] ?? '') !== $pending['nonce'] || empty($claims['sub'])) {
        return ['ok' => false, 'message' => 'Het antwoord van Google kon niet bevestigd worden.'];
    }
    if (empty($claims['email_verified'])) return ['ok' => false, 'message' => 'Je e-mailadres bij Google is niet bevestigd.'];
    $sub = preg_replace('/[^0-9a-zA-Z]/', '', (string) $claims['sub']);
    $username = 'g_' . substr($sub, 0, 37);
    $profile = ['sub' => $sub, 'email' => (string) ($claims['email'] ?? ''), 'name' => (string) ($claims['name'] ?? ''), 'picture' => (string) ($claims['picture'] ?? '')];
    $result = with_lock('users', function () use ($username, $profile) {
        $users = get_users();
        if (isset($users[$username])) {
            if (!empty($users[$username]['disabled'])) return 'disabled';
            $users[$username]['google'] = $profile;
            write_json('users.json', $users);
            return 'existing';
        }
        if (site_settings()['registration'] !== 'open') return 'closed';
        $users[$username] = ['created' => gmdate('c'), 'google' => $profile, 'displayName' => $profile['name'] ?: $profile['email']];
        write_json('users.json', $users);
        return 'new';
    });
    if ($result === 'closed') { log_login($username, 'google', false, 'registratie gesloten: ' . $profile['email']); return ['ok' => false, 'message' => 'Nieuwe accounts kunnen op dit moment niet aangemaakt worden.']; }
    if ($result === 'disabled') { log_login($username, 'google', false, 'account geblokkeerd'); return ['ok' => false, 'message' => 'Dit account is geblokkeerd.']; }
    log_login($username, 'google', true, $result === 'new' ? 'nieuw account' : '');
    return ['ok' => true, 'user' => $username, 'new' => $result === 'new', 'message' => ''];
}

// ---------- Beheer ----------

function admin_overview(): array {
    $users = get_users();
    $list = [];
    foreach ($users as $name => $u) {
        $file = data_dir() . '/' . user_file($name);
        $size = is_file($file) ? filesize($file) : 0;
        $tx = null;
        $updated = null;
        if ($size) {
            $d = read_json(user_file($name), null);
            $tx = is_array($d['state']['transactions'] ?? null) ? count($d['state']['transactions']) : 0;
            $updated = $d['updated'] ?? null;
        }
        $list[] = array_merge(user_public($name, $u), [
            'created' => $u['created'] ?? null, 'lastLogin' => $u['lastLogin'] ?? null, 'logins' => (int) ($u['logins'] ?? 0),
            'disabled' => !empty($u['disabled']), 'ai' => user_may_ai($u), 'dataSize' => $size, 'transactions' => $tx, 'lastSync' => $updated,
        ]);
    }
    usort($list, fn($a, $b) => strcmp((string) $b['lastLogin'], (string) $a['lastLogin']));
    $logins = array_reverse(read_json('logins.json', []));
    return ['users' => $list, 'logins' => array_slice($logins, 0, 300), 'site' => site_settings(), 'google' => google_configured(),
        'googleRedirect' => google_redirect_uri(), 'origin' => public_url()];
}

function admin_user_action(string $admin, array $b): array {
    $name = (string) ($b['username'] ?? '');
    $action = (string) ($b['action'] ?? '');
    if ($name === $admin) throw new HttpError(400, 'Je kan je eigen beheerdersaccount niet wijzigen');
    return with_lock('users', function () use ($name, $action) {
        $users = get_users();
        if (!isset($users[$name])) throw new HttpError(404, 'Onbekende gebruiker');
        if ($action === 'disable' || $action === 'enable') $users[$name]['disabled'] = $action === 'disable';
        elseif ($action === 'ai-on' || $action === 'ai-off') $users[$name]['ai'] = $action === 'ai-on';
        elseif ($action === 'delete') {
            if (user_role($users[$name]) === 'owner') throw new HttpError(400, 'Het eigenaarsaccount kan je hier niet verwijderen');
            $file = data_dir() . '/' . user_file($name);
            if (is_file($file)) { @mkdir(data_dir() . '/backups', 0700, true); @rename($file, data_dir() . '/backups/verwijderd-' . gmdate('Ymd-His') . '-' . user_file($name)); }
            unset($users[$name]);
        } else throw new HttpError(400, 'Onbekende actie');
        write_json('users.json', $users);
        if ($action === 'disable' || $action === 'delete') {
            with_lock('sessions', function () use ($name) {
                $s = read_json('sessions.json', []);
                foreach ($s as $k => $v) if (($v['username'] ?? '') === $name) unset($s[$k]);
                write_json('sessions.json', $s);
            });
        }
        return ['ok' => true];
    });
}

function auth_page(array $r): string {
    $msg = htmlspecialchars($r['message'], ENT_QUOTES, 'UTF-8');
    return <<<HTML
<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aanmelden — Helder</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f5f7fb;color:#14284b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.c{background:#fff;border-radius:14px;padding:28px;max-width:420px;box-shadow:0 2px 12px rgba(20,40,75,.1);text-align:center}a{display:inline-block;margin-top:16px;background:#14284b;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none}</style></head>
<body><div class="c"><h1 style="font-size:20px;margin:0 0 8px">Aanmelden niet gelukt</h1><p>$msg</p><a href="/">Terug naar Helder</a></div></body></html>
HTML;
}
