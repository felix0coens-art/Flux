<?php
/*
 * Historische koersen (PHP-versie van server/prices.js), zodat Helder de waarde van je portefeuille
 * op elk moment kan reconstrueren. Bron: Yahoo Finance (publieke koersgrafieken, geen sleutel).
 * Er worden enkel ISIN's/namen van fondsen verstuurd, geen persoonsgegevens of bedragen.
 */

declare(strict_types=1);

const PRICES_UA = 'Mozilla/5.0 (Helder persoonlijke boekhouding; self-hosted)';
const EU_EXCHANGES = ['AMS', 'PAR', 'BRU', 'GER', 'FRA', 'MIL', 'EBS', 'MCE', 'LIS', 'VIE', 'HEL', 'DUB', 'IOB', 'LSE'];

function prices_json(callable $fetch, string $url) {
    return get_json($fetch, $url, ['User-Agent' => PRICES_UA], 15);
}

/** Yahoo-symbool bij een ISIN (voorkeur voor een Europese beurs in EUR). */
function find_symbol(callable $fetch, string $isin, string $name, string $preferredCurrency): ?string {
    $q = rawurlencode($isin !== '' ? $isin : $name);
    $r = prices_json($fetch, "https://query1.finance.yahoo.com/v1/finance/search?q=$q&quotesCount=8&newsCount=0");
    $quotes = array_values(array_filter($r['quotes'] ?? [], fn($x) => !empty($x['symbol']) && in_array($x['quoteType'] ?? 'EQUITY', ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'], true)));
    if (!$quotes) return null;
    $score = fn($x) => (in_array($x['exchange'] ?? '', EU_EXCHANGES, true) ? 2 : 0)
        + ($preferredCurrency !== '' && $preferredCurrency !== 'EUR' && !in_array($x['exchange'] ?? '', EU_EXCHANGES, true) ? 3 : 0);
    $best = $quotes[0];
    foreach ($quotes as $x) if ($score($x) > $score($best)) $best = $x;
    return $best['symbol'];
}

/** Wekelijkse slotkoersen sinds een datum: ['currency' => .., 'points' => [['date', 'close']]] */
function price_history(callable $fetch, string $symbol, string $fromDate): ?array {
    $p1 = strtotime($fromDate . 'T00:00:00Z') - 7 * 86400;
    $p2 = time();
    $r = prices_json($fetch, 'https://query1.finance.yahoo.com/v8/finance/chart/' . rawurlencode($symbol) . "?period1=$p1&period2=$p2&interval=1wk&events=div");
    $res = $r['chart']['result'][0] ?? null;
    if (!$res || empty($res['timestamp'])) return null;
    $closes = $res['indicators']['quote'][0]['close'] ?? [];
    $points = [];
    foreach ($res['timestamp'] as $i => $ts) {
        $c = $closes[$i] ?? null;
        if (is_numeric($c) && $c > 0) $points[] = ['date' => gmdate('Y-m-d', (int) $ts), 'close' => (float) $c];
    }
    return ['currency' => $res['meta']['currency'] ?? 'EUR', 'points' => $points];
}

function to_eur(callable $fetch, array $series, string $fromDate, array &$fxCache): ?array {
    $cur = $series['currency'];
    $factor = 1.0;
    if ($cur === 'GBp' || $cur === 'GBX') { $cur = 'GBP'; $factor = 0.01; } // Londen noteert in pence
    $round = fn($v) => round($v * 10000) / 100;
    if ($cur === 'EUR') return array_map(fn($p) => ['date' => $p['date'], 'eur' => $round($p['close'] * $factor)], $series['points']);
    if (!array_key_exists($cur, $fxCache)) $fxCache[$cur] = price_history($fetch, "EUR$cur=X", $fromDate); // aantal 'cur' per euro
    $fx = $fxCache[$cur]['points'] ?? [];
    if (!$fx) return null;
    return array_map(function ($p) use ($fx, $factor, $round) {
        $rate = $fx[0]['close'];
        foreach ($fx as $f) { if ($f['date'] <= $p['date']) $rate = $f['close']; else break; }
        return ['date' => $p['date'], 'eur' => $round($p['close'] * $factor / $rate)];
    }, $series['points']);
}

/** Koerscache: 12 uur, in de gegevensmap (geen persoonsgegevens). */
function price_cache_get(string $key): ?array {
    $c = read_json('price-cache.json', []);
    $hit = $c[$key] ?? null;
    return $hit && now_ms() - $hit['at'] < 12 * 3600000 ? $hit['value'] : null;
}

function price_cache_set(array $entries): void {
    if (!$entries) return;
    with_lock('price-cache', function () use ($entries) {
        $c = read_json('price-cache.json', []);
        foreach ($c as $k => $v) if (now_ms() - $v['at'] > 12 * 3600000) unset($c[$k]);
        foreach ($entries as $k => $v) $c[$k] = ['at' => now_ms(), 'value' => $v];
        write_json('price-cache.json', $c);
    });
}

function fetch_prices(callable $fetch, array $instruments, bool $useCache = true): array {
    $out = ['series' => new stdClass(), 'errors' => new stdClass()];
    $fxCache = [];
    $fresh = [];
    foreach (array_slice($instruments, 0, 40) as $ins) {
        $k = $ins['key'];
        $cacheKey = ($ins['isin'] !== '' ? $ins['isin'] : $ins['name']) . '|' . $ins['from'];
        $hit = $useCache ? price_cache_get($cacheKey) : null;
        if ($hit) { $out['series']->$k = $hit; continue; }
        try {
            $symbol = find_symbol($fetch, $ins['isin'], $ins['name'], $ins['currency']);
            if (!$symbol) { $out['errors']->$k = 'niet gevonden'; continue; }
            $h = price_history($fetch, $symbol, $ins['from']);
            if (!$h || !$h['points']) { $out['errors']->$k = 'geen koersen'; continue; }
            $points = to_eur($fetch, $h, $ins['from'], $fxCache);
            if ($points === null) { $out['errors']->$k = 'wisselkoers ontbreekt'; continue; }
            $out['series']->$k = ['symbol' => $symbol, 'currency' => $h['currency'], 'points' => $points];
            $fresh[$cacheKey] = $out['series']->$k;
        } catch (Throwable $e) {
            $out['errors']->$k = $e->getMessage();
        }
    }
    if ($useCache) price_cache_set($fresh);
    return $out;
}
