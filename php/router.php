<?php
/*
 * Voor lokaal testen zonder Apache:  php -S localhost:8080 php/router.php
 * Doet hetzelfde als .htaccess op de hosting: /api/... naar api.php, enkel app-bestanden tonen.
 */

$root = dirname(__DIR__);
$path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));

if (strpos($path, '/api/') === 0) { require $root . '/api.php'; return true; }

$static = ['/' => 'index.html', '/index.html' => 'index.html', '/g' => 'groep.html', '/g/' => 'groep.html', '/groep.html' => 'groep.html', '/sw.js' => 'sw.js', '/manifest.webmanifest' => 'manifest.webmanifest', '/privacy.html' => 'privacy.html', '/voorwaarden.html' => 'voorwaarden.html'];
if (preg_match('#^/(privacy|privacy-policy|privacybeleid|privacyverklaring)(\.html)?/?$#i', $path)) $path = '/privacy.html';
if (preg_match('#^/(voorwaarden|terms|gebruiksvoorwaarden|terms-of-service)(\.html)?/?$#i', $path)) $path = '/voorwaarden.html';
$rel = $static[$path] ?? null;
$p = ltrim($path, '/');
if (!$rel && preg_match('#^(css|js|icons|fonts)/[a-zA-Z0-9/_.-]+$#', $p) && strpos($p, '..') === false) $rel = $p;

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");

if (!$rel || !is_file($root . '/' . $rel)) { http_response_code(404); header('Content-Type: text/plain; charset=utf-8'); echo 'Niet gevonden'; return true; }
$mime = ['html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'png' => 'image/png', 'svg' => 'image/svg+xml',
    'webmanifest' => 'application/manifest+json', 'json' => 'application/json', 'woff2' => 'font/woff2', 'txt' => 'text/plain; charset=utf-8'];
header('Content-Type: ' . ($mime[pathinfo($rel, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
header('Cache-Control: no-cache');
readfile($root . '/' . $rel);
return true;
