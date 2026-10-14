<?php
/*
 * Bonnetjes en documenten bij transacties (foto of pdf). Zelfde gedrag als server/files.js.
 * Bestanden staan per gebruiker in helder-data/files-<gebruiker>/ en zijn enkel bereikbaar via de API,
 * voor wie aangemeld is als die gebruiker.
 */

declare(strict_types=1);

const FILE_TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'application/pdf' => 'pdf'];
const FILE_MAX = 6 * 1024 * 1024;
const FILE_QUOTA = 300 * 1024 * 1024;

function files_dir(string $user, bool $create = true): string {
    $d = data_dir() . '/files-' . bin2hex($user);
    if ($create && !is_dir($d)) @mkdir($d, 0700, true);
    return $d;
}

/** Klopt de inhoud met het type? (geen html of scripts die zich als foto voordoen) */
function file_magic_ok(string $type, string $bin): bool {
    if ($type === 'image/jpeg') return substr($bin, 0, 3) === "\xFF\xD8\xFF";
    if ($type === 'image/png') return substr($bin, 0, 8) === "\x89PNG\r\n\x1a\n";
    if ($type === 'image/webp') return substr($bin, 0, 4) === 'RIFF' && substr($bin, 8, 4) === 'WEBP';
    if ($type === 'application/pdf') return substr($bin, 0, 5) === '%PDF-';
    return false;
}

function file_upload(string $user, array $b): array {
    $type = (string) ($b['type'] ?? '');
    if (!isset(FILE_TYPES[$type])) throw new HttpError(400, 'Enkel foto’s (jpg, png, webp) en pdf-bestanden');
    $bin = base64_decode((string) ($b['data'] ?? ''), true);
    if ($bin === false || $bin === '') throw new HttpError(400, 'Ongeldig bestand');
    if (strlen($bin) > FILE_MAX) throw new HttpError(413, 'Bestand te groot (max. 6 MB)');
    if (!file_magic_ok($type, $bin)) throw new HttpError(400, 'De inhoud van het bestand klopt niet met het type');
    $dir = files_dir($user);
    $used = 0;
    foreach (glob($dir . '/*') ?: [] as $f) $used += (int) @filesize($f);
    if ($used + strlen($bin) > FILE_QUOTA) throw new HttpError(413, 'Je opslag voor bonnetjes is vol (300 MB)');
    $id = b64url(random_bytes(12));
    $name = mb_substr(trim(preg_replace('/[\x00-\x1f\/\\\\]/u', '', (string) ($b['name'] ?? 'bestand'))), 0, 80) ?: 'bestand';
    $meta = ['id' => $id, 'name' => $name, 'type' => $type, 'size' => strlen($bin), 'created' => gmdate('c')];
    file_put_contents($dir . '/' . $id . '.' . FILE_TYPES[$type], $bin, LOCK_EX);
    file_put_contents($dir . '/' . $id . '.json', json_encode($meta), LOCK_EX);
    return $meta;
}

function file_meta(string $user, string $id): ?array {
    if (!preg_match('/^[A-Za-z0-9_-]{8,40}$/', $id)) return null;
    $m = @file_get_contents(files_dir($user, false) . '/' . $id . '.json');
    $meta = $m ? json_decode($m, true) : null;
    return is_array($meta) && isset(FILE_TYPES[$meta['type'] ?? '']) ? $meta : null;
}

function file_send(string $user, string $id): void {
    $meta = file_meta($user, $id);
    $path = $meta ? files_dir($user, false) . '/' . $id . '.' . FILE_TYPES[$meta['type']] : '';
    if (!$meta || !is_file($path)) throw new HttpError(404, 'Bestand niet gevonden');
    http_response_code(200);
    header('Content-Type: ' . $meta['type']);
    header('Content-Length: ' . filesize($path));
    header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode($meta['name']));
    header('Cache-Control: private, max-age=86400');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    readfile($path);
}

function file_delete(string $user, string $id): array {
    $meta = file_meta($user, $id);
    if ($meta) {
        @unlink(files_dir($user, false) . '/' . $id . '.' . FILE_TYPES[$meta['type']]);
        @unlink(files_dir($user, false) . '/' . $id . '.json');
    }
    return ['ok' => true];
}

/** Alle bestanden van een gebruiker wissen (account verwijderd). */
function files_remove_all(string $user): void {
    $d = files_dir($user, false);
    if (!is_dir($d)) return;
    foreach (glob($d . '/*') ?: [] as $f) @unlink($f);
    @rmdir($d);
}
