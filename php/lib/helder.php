<?php
/*
 * Helder-server in PHP, voor gewone webhosting (zoals Vimexx/DirectAdmin) zonder Node.js.
 * Doet hetzelfde als server/server.js: login, synchronisatie tussen toestellen, online opzoeken,
 * koersen en de Degiro-koppeling. Geen database nodig: elke gebruiker heeft één JSON-bestand.
 *
 * Instellingen (omgevingsvariabelen of het bestand helder-config.php naast je webmap):
 *   FLUX_DATA_DIR       map voor gegevens (standaard: helder-data naast de webmap, dus NIET publiek)
 *   FLUX_USERNAME       + FLUX_PASSWORD: maakt bij de eerste start meteen deze gebruiker aan
 *   FLUX_BACKUP_DAYS    aantal dagelijkse back-ups dat bewaard blijft (standaard 30)
 *   ANTHROPIC_API_KEY   optioneel: tegenpartijen laten classificeren door Claude
 */

declare(strict_types=1);

const HELDER_VERSION = 3; // = Store.VERSION in js/store.js
const SESSION_DAYS = 120;
const MAX_BODY = 30 * 1024 * 1024;
const TOMBSTONE_TTL = 400 * 86400000;
const SYNC_COLLECTIONS = ['accounts', 'categories', 'rules', 'budgets', 'transactions', 'imports', 'deleted', 'people'];
const SYNC_SINGLETONS = ['settings', 'investments'];
const USER_AGENT = 'Helder-persoonlijke-boekhouding/2.0 (self-hosted)';

final class HttpError extends Exception {
    public int $status;
    public ?string $errorCode;
    public function __construct(int $status, string $message, ?string $code = null) {
        parent::__construct($message);
        $this->status = $status;
        $this->errorCode = $code;
    }
}

// ---------- Instellingen ----------

function helder_root(): string { return dirname(__DIR__, 2); }

function cfg(string $key, $default = null) {
    static $file = null;
    if ($file === null) {
        $file = [];
        $path = getenv('HELDER_CONFIG') ?: dirname(helder_root()) . '/helder-config.php';
        if (is_file($path)) { $r = include $path; if (is_array($r)) $file = $r; }
    }
    $v = getenv($key);
    if ($v !== false && $v !== '') return $v;
    return $file[$key] ?? $default;
}

function data_dir(): string {
    static $dir = null;
    if ($dir === null) {
        $dir = rtrim((string) cfg('FLUX_DATA_DIR', dirname(helder_root()) . '/helder-data'), '/');
        if (!is_dir($dir)) @mkdir($dir, 0700, true);
        if (!is_dir($dir)) throw new HttpError(500, 'Kan de gegevensmap niet aanmaken: ' . $dir);
        // Voor het geval de map toch in de webmap staat: nooit via het web tonen
        if (!is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    }
    return $dir;
}

// ---------- Opslag ----------

function json_out($data): string {
    return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
}

/** Leest een JSON-bestand. $assoc=false behoudt het verschil tussen {} en [] (nodig voor de gegevens). */
function read_json(string $file, $fallback, bool $assoc = true) {
    $path = data_dir() . '/' . $file;
    if (!is_file($path)) return $fallback;
    $raw = file_get_contents($path);
    if ($raw === false) throw new RuntimeException('Kan ' . $file . ' niet lezen');
    $data = json_decode($raw, $assoc);
    if ($data === null && trim($raw) !== 'null') throw new RuntimeException('Beschadigd bestand: ' . $file);
    return $data;
}

function write_json(string $file, $data): void {
    $path = data_dir() . '/' . $file;
    $tmp = $path . '.' . getmypid() . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $json = json_out($data);
    if ($json === false || file_put_contents($tmp, $json) === false) throw new RuntimeException('Kan ' . $file . ' niet bewaren');
    @chmod($tmp, 0600);
    if (!rename($tmp, $path)) { @unlink($tmp); throw new RuntimeException('Kan ' . $file . ' niet bewaren'); }
}

/** Voert $fn uit met een exclusief slot, zodat gelijktijdige verzoeken elkaar niet overschrijven. */
function with_lock(string $key, callable $fn) {
    $h = fopen(data_dir() . '/.lock-' . preg_replace('/[^a-z0-9_-]/i', '_', $key), 'c');
    if (!$h || !flock($h, LOCK_EX)) throw new RuntimeException('Kan geen slot nemen');
    try { return $fn(); }
    finally { flock($h, LOCK_UN); fclose($h); }
}

function user_file(string $username): string { return 'user-' . bin2hex($username) . '.json'; }

// ---------- Gebruikers en sessies ----------

function valid_username($u): bool { return is_string($u) && preg_match('/^[a-zA-Z0-9._-]{2,40}$/', $u) === 1; }
function valid_password($p): bool { return is_string($p) && strlen($p) >= 8 && strlen($p) <= 200; }

function get_users(): array { $u = read_json('users.json', []); return is_array($u) ? $u : []; }

function verify_password(string $password, ?array $user): bool {
    if (!$user) return false;
    if (isset($user['pw'])) return password_verify($password, $user['pw']);
    return false; // account van de Node-server (scrypt): stel opnieuw in via de setupcode
}

function create_user(string $username, string $password): void {
    with_lock('users', function () use ($username, $password) {
        $users = get_users();
        if (isset($users[$username])) throw new HttpError(409, 'Deze gebruikersnaam bestaat al');
        $users[$username] = ['pw' => password_hash($password, PASSWORD_DEFAULT), 'created' => gmdate('c')];
        write_json('users.json', $users);
    });
}

function set_password(string $username, string $password): void {
    with_lock('users', function () use ($username, $password) {
        $users = get_users();
        if (!isset($users[$username])) throw new HttpError(404, 'Onbekende gebruiker');
        $users[$username] = ['pw' => password_hash($password, PASSWORD_DEFAULT), 'created' => $users[$username]['created'] ?? gmdate('c')];
        write_json('users.json', $users);
    });
}

function now_ms(): int { return (int) floor(microtime(true) * 1000); }
function token_hash(string $t): string { return hash('sha256', $t); }
function b64url(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }

function create_session(string $username): string {
    $token = b64url(random_bytes(32));
    with_lock('sessions', function () use ($token, $username) {
        $sessions = read_json('sessions.json', []);
        $now = now_ms();
        foreach ($sessions as $k => $s) if (($s['expires'] ?? 0) < $now) unset($sessions[$k]);
        $sessions[token_hash($token)] = ['username' => $username, 'expires' => $now + SESSION_DAYS * 86400000];
        write_json('sessions.json', $sessions);
    });
    return $token;
}

function session_token(): string { return (string) ($_COOKIE['flux_session'] ?? ''); }

function session_user(): ?string {
    $token = session_token();
    if ($token === '') return null;
    $sessions = read_json('sessions.json', []);
    $s = $sessions[token_hash($token)] ?? null;
    if (!$s || ($s['expires'] ?? 0) < now_ms()) return null;
    return $s['username'];
}

function destroy_session(bool $everywhere): void {
    $token = session_token();
    if ($token === '') return;
    with_lock('sessions', function () use ($token, $everywhere) {
        $sessions = read_json('sessions.json', []);
        $own = $sessions[token_hash($token)] ?? null;
        if ($everywhere && $own) {
            foreach ($sessions as $k => $s) if (($s['username'] ?? '') === $own['username']) unset($sessions[$k]);
        } else unset($sessions[token_hash($token)]);
        write_json('sessions.json', $sessions);
    });
}

function is_secure(): bool {
    return cfg('FLUX_SECURE_COOKIES') === '1' || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function session_cookie(string $token, int $maxAge): string {
    return "flux_session=$token; Path=/; HttpOnly; SameSite=Lax; Max-Age=$maxAge" . (is_secure() ? '; Secure' : '');
}

// Max. 10 foute pogingen per 15 minuten per IP-adres
function client_ip(): string { return (string) ($_SERVER['REMOTE_ADDR'] ?? '?'); }

function rate_limited(): bool {
    $list = read_json('attempts.json', [])[client_ip()] ?? [];
    $now = now_ms();
    return count(array_filter($list, fn($t) => $now - $t < 15 * 60000)) >= 10;
}

function record_attempt(): void {
    with_lock('attempts', function () {
        $all = read_json('attempts.json', []);
        $now = now_ms();
        foreach ($all as $ip => $list) {
            $all[$ip] = array_values(array_filter($list, fn($t) => $now - $t < 15 * 60000));
            if (!$all[$ip]) unset($all[$ip]);
        }
        $all[client_ip()][] = $now;
        write_json('attempts.json', $all);
    });
}

/**
 * Nog geen account? Dan maakt Helder een eenmalige setupcode aan in helder-data/SETUPCODE.txt
 * (te bekijken via DirectAdmin → File Manager). Of: FLUX_USERNAME + FLUX_PASSWORD instellen.
 */
function setup_code(): ?string {
    // Enkel zolang er geen eigen account is (de beheerder en Google-gebruikers tellen niet mee)
    foreach (get_users() as $u) if (($u['role'] ?? '') !== 'admin' && !isset($u['google'])) return null;
    $u = cfg('FLUX_USERNAME');
    $p = cfg('FLUX_PASSWORD');
    if ($u && $p && valid_username($u) && valid_password($p)) {
        try { create_user($u, $p); } catch (HttpError $e) { /* bestaat al */ }
        return null;
    }
    return with_lock('setup', function () {
        $file = data_dir() . '/SETUPCODE.txt';
        if (is_file($file) && preg_match('/\b([0-9A-F]{8})\b/', (string) file_get_contents($file), $m)) return $m[1];
        $code = strtoupper(bin2hex(random_bytes(4)));
        file_put_contents($file, "Setupcode voor Helder: $code\n\nVul deze code in op het scherm 'Account aanmaken'.\nNa het aanmaken van je account wordt dit bestand automatisch verwijderd.\n");
        @chmod($file, 0600);
        return $code;
    });
}

// ---------- Gegevens ----------

function load_user_data(string $username): object {
    $d = read_json(user_file($username), null, false);
    if (!$d) return (object) ['rev' => 0, 'state' => null];
    // Gegevens van een oudere versie: proper opnieuw beginnen (zie Store.VERSION), met back-up
    if (isset($d->state) && $d->state && (int) ($d->state->version ?? 1) < HELDER_VERSION) {
        $old = (int) ($d->state->version ?? 1);
        write_json(user_file($username) . '.v' . $old . '.bak', $d);
        $fresh = (object) ['rev' => (int) ($d->rev ?? 0) + 1, 'state' => (object) ['version' => HELDER_VERSION, 'tombstones' => new stdClass()], 'updated' => gmdate('c'), 'resetFrom' => $old];
        foreach (SYNC_COLLECTIONS as $c) $fresh->state->$c = [];
        write_json(user_file($username), $fresh);
        return $fresh;
    }
    return $d;
}

/** Bij de eerste wijziging van elke dag wordt de vorige stand bewaard in helder-data/backups/. */
function daily_backup(string $username, object $data): void {
    if (empty($data->state)) return;
    $dir = data_dir() . '/backups';
    $base = preg_replace('/\.json$/', '', user_file($username));
    $file = "$dir/$base-" . gmdate('Y-m-d') . '.json';
    if (is_file($file)) return;
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    file_put_contents($file, json_out($data));
    @chmod($file, 0600);
    $old = array_values(array_filter(scandir($dir) ?: [], fn($f) => strpos($f, $base . '-') === 0));
    sort($old);
    $keep = (int) cfg('FLUX_BACKUP_DAYS', 30);
    foreach (array_slice($old, 0, max(0, count($old) - $keep)) as $f) @unlink("$dir/$f");
}

function upd($it) { return is_object($it) && isset($it->updatedAt) && is_numeric($it->updatedAt) ? $it->updatedAt : 0; }

/** Zelfde logica als FluxCore.mergeStates: per object de nieuwste versie, afwezigheid is nooit verwijderen. */
function merge_states(?object $base, ?object $incoming, ?int $now = null): object {
    $now = $now ?? now_ms();
    $base = $base ?: new stdClass();
    $incoming = $incoming ?: new stdClass();
    $out = clone $base;
    $tomb = (array) ($base->tombstones ?? []);
    foreach ((array) ($incoming->tombstones ?? []) as $k => $t) if (is_numeric($t)) $tomb[$k] = max($tomb[$k] ?? 0, $t);
    foreach ($tomb as $k => $t) if ($now - $t > TOMBSTONE_TTL) unset($tomb[$k]);
    foreach (SYNC_COLLECTIONS as $c) {
        $map = [];
        foreach ((is_array($base->$c ?? null) ? $base->$c : []) as $it) if (is_object($it) && isset($it->id)) $map['#' . $it->id] = $it;
        foreach ((is_array($incoming->$c ?? null) ? $incoming->$c : []) as $it) {
            if (!is_object($it) || !isset($it->id)) continue;
            $cur = $map['#' . $it->id] ?? null;
            if (!$cur || upd($it) >= upd($cur)) $map['#' . $it->id] = $it;
        }
        $out->$c = array_values(array_filter($map, function ($it) use ($tomb, $c) {
            $k = $c . ':' . $it->id;
            return !(isset($tomb[$k]) && $tomb[$k] >= upd($it));
        }));
    }
    $subs = (array) ($base->subscriptions ?? []);
    foreach ((array) ($incoming->subscriptions ?? []) as $k => $v) {
        if (!isset($subs[$k]) || upd($v) >= upd($subs[$k])) $subs[$k] = $v;
    }
    $out->subscriptions = (object) $subs;
    foreach (SYNC_SINGLETONS as $k) {
        $b = $base->$k ?? null;
        $i = $incoming->$k ?? null;
        if (is_object($i) && (!$b || upd($i) >= upd($b))) $out->$k = $i;
        elseif ($b) $out->$k = $b;
        elseif ($k === 'settings') $out->$k = new stdClass();
        else unset($out->$k);
    }
    if (isset($incoming->schema) && (!isset($out->schema) || $incoming->schema > $out->schema)) $out->schema = $incoming->schema;
    $out->tombstones = (object) $tomb;
    $out->version = max((int) ($out->version ?? 0), (int) ($incoming->version ?? 0), HELDER_VERSION);
    return $out;
}

function has_changes($changes): bool {
    if (!is_object($changes)) return false;
    foreach (get_object_vars($changes) as $v) {
        if (is_array($v) && count($v)) return true;
        if (is_object($v) && count(get_object_vars($v))) return true;
    }
    return false;
}

/** Voegt de wijzigingen van een toestel samen met wat op de server staat. */
function sync_user(string $username, $changes, $clientRev): array {
    return with_lock('u:' . bin2hex($username), function () use ($username, $changes, $clientRev) {
        $data = load_user_data($username);
        $state = $data->state ?? null;
        $rev = (int) ($data->rev ?? 0);
        $changed = has_changes($changes);
        if ($changed) {
            daily_backup($username, $data);
            $state = merge_states($state, $changes);
            $rev += 1;
            write_json(user_file($username), (object) ['rev' => $rev, 'state' => $state, 'updated' => gmdate('c')]);
        }
        return ($clientRev === $rev && !$changed) ? ['rev' => $rev] : ['rev' => $rev, 'state' => $state];
    });
}

// ---------- HTTP naar buiten ----------

/**
 * Eenvoudige HTTP-client (curl). Geeft ['status' => int, 'body' => string, 'headers' => [naam => waarde]].
 * Tests geven een eigen $fetch mee met dezelfde vorm.
 */
function http_fetch(string $url, array $opts = []): array {
    $ch = curl_init($url);
    $headers = [];
    foreach (($opts['headers'] ?? []) as $k => $v) $headers[] = "$k: $v";
    $respHeaders = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => (int) ($opts['timeout'] ?? 20),
        CURLOPT_CUSTOMREQUEST => $opts['method'] ?? 'GET',
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$respHeaders) {
            $p = strpos($line, ':');
            if ($p) $respHeaders[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
            return strlen($line);
        },
    ]);
    if (isset($opts['body'])) curl_setopt($ch, CURLOPT_POSTFIELDS, $opts['body']);
    $body = curl_exec($ch);
    if ($body === false) { $err = curl_error($ch); curl_close($ch); throw new RuntimeException($err ?: 'netwerkfout'); }
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return ['status' => $status, 'body' => (string) $body, 'headers' => $respHeaders];
}

/** GET + JSON; gooit een fout bij een HTTP-fout. */
function get_json(callable $fetch, string $url, array $headers = [], int $timeout = 8) {
    $r = $fetch($url, ['headers' => $headers + ['User-Agent' => USER_AGENT, 'Accept' => 'application/json'], 'timeout' => $timeout]);
    if ($r['status'] < 200 || $r['status'] >= 300) throw new RuntimeException('HTTP ' . $r['status']);
    $j = json_decode($r['body'], true);
    if ($j === null) throw new RuntimeException('Ongeldig antwoord');
    return $j;
}
