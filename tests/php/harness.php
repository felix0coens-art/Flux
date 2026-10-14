<?php
/*
 * Testhulp: voert een functie van de PHP-server uit met een nagebootst internet.
 * Invoer (stdin, JSON): { "fn": "...", "args": [...], "fake": [[urlDeel, status, body], ...] }
 * Uitvoer: { "result": ..., "requests": [[methode, url, headers, body], ...] } of { "error": ... }
 */
declare(strict_types=1);
$root = dirname(__DIR__, 2);
foreach (['helder', 'lookup', 'prices', 'degiro', 'ai'] as $f) require "$root/php/lib/$f.php";

$in = json_decode(stream_get_contents(STDIN), true);
$requests = [];
$fake = function (string $url, array $opts = []) use ($in, &$requests) {
    $requests[] = [$opts['method'] ?? 'GET', $url, $opts['headers'] ?? [], $opts['body'] ?? null];
    foreach ($in['fake'] ?? [] as [$part, $status, $body]) {
        if (strpos($url, $part) !== false) return ['status' => $status, 'body' => is_string($body) ? $body : json_encode($body), 'headers' => []];
    }
    return ['status' => 404, 'body' => '{}', 'headers' => []];
};
try {
    $args = $in['args'] ?? [];
    switch ($in['fn']) {
        case 'search_terms': $result = array_map(fn($a) => search_terms($a[0], $a[1] ?? ''), $args); break;
        case 'fetch_prices': $result = fetch_prices($fake, $args[0], false); break;
        case 'degiro': $result = degiro_fetch_all($fake, ...$args); break;
        case 'lookup_free': $result = lookup_free($fake, $args[0], 'be'); break;
        case 'ai_classify': $result = ai_classify($args[0], $args[1], 'be'); break;
        default: throw new Exception('onbekende functie');
    }
    echo json_encode(['result' => $result, 'requests' => $requests]);
} catch (Throwable $e) {
    echo json_encode(['error' => $e->getMessage(), 'kind' => $e instanceof DegiroError ? $e->kind : null, 'requests' => $requests]);
}
