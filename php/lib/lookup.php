<?php
/*
 * Tegenpartijen online opzoeken (PHP-versie van js/lookup.js):
 *  - Wikidata: wat voor organisatie het is
 *  - OpenStreetMap (Nominatim): wat voor zaak het is
 */

declare(strict_types=1);

const LOOKUP_NOISE = '/\b(betaling|bancontact|maestro|visa|mastercard|debit|debet|kaart(nummer)?|card|contactloos|contactless|apple ?pay|google ?pay|payconiq|europese|domiciliering|sepa|overschrijving|instant|aankoop|purchase|terminal|ref(erentie)?|mededeling|via|online|nv|bv|bvba|sa|srl|sprl|vzw|gmbh|ltd|inc|b\.v\.|n\.v\.)\b/i';

function lookup_clean(?string $s): string {
    $s = (string) $s;
    if (!mb_check_encoding($s, 'UTF-8')) $s = mb_convert_encoding($s, 'UTF-8', 'ISO-8859-1');
    $s = preg_replace('~\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?~', ' ', $s);
    $s = preg_replace('/\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}\b/', ' ', $s); // IBAN
    $s = preg_replace(LOOKUP_NOISE, ' ', $s);
    $s = preg_replace('/[*#_]/', ' ', $s);
    $s = preg_replace('/\d+/', ' ', $s);
    $s = preg_replace('/\.(com|be|nl|eu|net|org|fr|de)\b/i', ' ', $s);
    $s = preg_replace("/[^\\p{L}\\s&'-]/u", ' ', $s) ?? '';
    return trim(preg_replace('/\s+/u', ' ', $s) ?? '');
}

/** "BETALING BANCONTACT COLRUYT 3412 GENT 12/10" -> ["COLRUYT GENT", "COLRUYT"] */
function search_terms(?string $name, ?string $description): array {
    $base = lookup_clean($name);
    if ($base === '') $base = lookup_clean($description);
    $words = array_values(array_filter(explode(' ', $base), fn($w) => mb_strlen($w) > 1));
    $terms = [];
    $add = function (string $t) use (&$terms) {
        $t = trim($t);
        if (mb_strlen($t) < 3) return;
        foreach ($terms as $x) if (mb_strtolower($x) === mb_strtolower($t)) return;
        $terms[] = $t;
    };
    $add(implode(' ', array_slice($words, 0, 3)));
    $add(implode(' ', array_slice($words, 0, 2)));
    if (isset($words[0]) && mb_strlen($words[0]) >= 4) $add($words[0]);
    return array_slice($terms, 0, 3);
}

function pick_lang($obj, array $langs): string {
    if (!is_array($obj) || !$obj) return '';
    foreach ($langs as $l) if (!empty($obj[$l]['value'])) return $obj[$l]['value'];
    $any = reset($obj);
    return is_array($any) && !empty($any['value']) ? $any['value'] : '';
}

function wikidata_lookup(callable $fetch, string $term): ?array {
    $api = 'https://www.wikidata.org/w/api.php?format=json&origin=*';
    $hit = null;
    foreach (['nl', 'en'] as $lang) {
        $r = get_json($fetch, "$api&action=wbsearchentities&type=item&limit=5&language=$lang&uselang=nl&search=" . rawurlencode($term));
        foreach (($r['search'] ?? []) as $x) {
            // Personen en familienamen overslaan: die zeggen niets over een uitgave
            if (!empty($x['description']) && !preg_match('/familienaam|achternaam|voornaam|surname|given name|family name|disambiguation|doorverwijspagina|wikimedia/i', $x['description'])) { $hit = $x; break; }
        }
        if ($hit) break;
    }
    if (!$hit) return null;
    $id = $hit['id'];
    $ent = get_json($fetch, "$api&action=wbgetentities&props=claims|descriptions&languages=nl|en|fr&ids=" . rawurlencode($id));
    $e = $ent['entities'][$id] ?? null;
    if (!$e) return null;
    $ids = [];
    foreach (['P31', 'P452'] as $p) {
        foreach (($e['claims'][$p] ?? []) as $cl) {
            $v = $cl['mainsnak']['datavalue']['value'] ?? null;
            if (is_array($v) && !empty($v['id']) && count($ids) < 8) $ids[] = $v['id'];
        }
    }
    if (array_intersect($ids, ['Q5', 'Q101352', 'Q202444'])) return null; // mens / familienaam / voornaam
    $types = [];
    if ($ids) {
        $lab = get_json($fetch, "$api&action=wbgetentities&props=labels&languages=nl|en&ids=" . implode('|', $ids));
        foreach ($ids as $i) { $v = pick_lang($lab['entities'][$i]['labels'] ?? null, ['nl', 'en']); if ($v !== '') $types[] = $v; }
        try {
            $labEn = get_json($fetch, "$api&action=wbgetentities&props=labels&languages=en&ids=" . implode('|', $ids));
            foreach ($ids as $i) { $v = pick_lang($labEn['entities'][$i]['labels'] ?? null, ['en']); if ($v !== '' && !in_array($v, $types, true)) $types[] = $v; }
        } catch (Throwable $ex) { /* Engelse labels zijn optioneel */ }
    }
    return [
        'source' => 'Wikidata',
        'label' => $hit['label'] ?? $term,
        'description' => pick_lang($e['descriptions'] ?? null, ['nl', 'en', 'fr']) ?: ($hit['description'] ?? ''),
        'types' => $types,
        'url' => 'https://www.wikidata.org/wiki/' . $id,
    ];
}

function nominatim_lookup(callable $fetch, string $term, string $countries): ?array {
    // Gebruiksvoorwaarden van Nominatim: max. 1 verzoek per seconde
    static $last = 0.0;
    $wait = $last + 1.1 - microtime(true);
    if ($wait > 0) usleep((int) ($wait * 1e6));
    $last = microtime(true);
    $cc = rawurlencode(preg_replace('/\s/', '', $countries ?: 'be'));
    $r = get_json($fetch, "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=nl&countrycodes=$cc&q=" . rawurlencode($term));
    $skip = ['place', 'boundary', 'highway', 'landuse', 'natural', 'waterway', 'railway'];
    $useful = array_values(array_filter(is_array($r) ? $r : [], fn($x) => !empty($x['category']) && !in_array($x['category'], $skip, true) && ($x['type'] ?? '') !== 'yes'));
    if (!$useful) return null;
    $counts = [];
    foreach ($useful as $x) { $k = $x['category'] . '=' . $x['type']; $counts[$k] = ($counts[$k] ?? 0) + 1; }
    arsort($counts);
    $top = (string) array_key_first($counts);
    $first = null;
    foreach ($useful as $x) if ($x['category'] . '=' . $x['type'] === $top) { $first = $x; break; }
    [$category, $type] = explode('=', $top, 2);
    return [
        'source' => 'OpenStreetMap',
        'label' => ($first['name'] ?? '') ?: $term,
        'description' => "$category = $type",
        'types' => [$type, $category],
        'url' => 'https://www.openstreetmap.org/' . ($first['osm_type'] ?? '') . '/' . ($first['osm_id'] ?? ''),
    ];
}

function hits_text(array $hits): string {
    return implode(' | ', array_map(fn($h) => implode(' ', array_merge([$h['label'], $h['description']], $h['types'] ?? [])), $hits));
}

function lookup_free(callable $fetch, array $item, string $countries): array {
    $hits = [];
    $errors = [];
    $terms = search_terms($item['name'] ?? '', $item['description'] ?? '');
    foreach ($terms as $term) {
        try { $wd = wikidata_lookup($fetch, $term); } catch (Throwable $e) { $wd = null; $errors[] = 'Wikidata: ' . $e->getMessage(); }
        try { $osm = nominatim_lookup($fetch, $term, $countries); } catch (Throwable $e) { $osm = null; $errors[] = 'OpenStreetMap: ' . $e->getMessage(); }
        if ($wd) $hits[] = $wd;
        if ($osm) $hits[] = $osm;
        if ($hits) return ['query' => $term, 'hits' => $hits, 'text' => hits_text($hits), 'errors' => $errors];
    }
    return ['query' => $terms[0] ?? (string) ($item['name'] ?? ''), 'hits' => $hits, 'text' => '', 'errors' => $errors];
}

function cache_key_name(string $s): string {
    $s = mb_strtolower($s);
    $s = preg_replace('/[^a-z\s]/', ' ', $s);
    $stop = ['nv', 'bv', 'bvba', 'sa', 'srl', 'sprl', 'vzw', 'the', 'betaling', 'via', 'met', 'kaart', 'bancontact', 'maestro', 'visa', 'debit', 'europese', 'domiciliering', 'overschrijving', 'naar', 'van', 'mededeling', 'ref', 'referentie', 'datum', 'uur', 'be', 'nl', 'com', 'www'];
    $words = array_filter(preg_split('/\s+/', $s) ?: [], fn($w) => strlen($w) >= 2 && !in_array($w, $stop, true));
    return implode(' ', array_slice(array_values($words), 0, 3));
}

function lookup_items(array $body, callable $fetch, ?string $apiKey = null): array {
    if ($apiKey === null) $apiKey = ai_available() ? (string) cfg('ANTHROPIC_API_KEY') : '';
    $items = array_slice(is_array($body['items'] ?? null) ? $body['items'] : [], 0, 25);
    $categories = array_map(fn($c) => ['id' => (string) ($c['id'] ?? ''), 'name' => (string) ($c['name'] ?? ''), 'kind' => ($c['kind'] ?? '') === 'income' ? 'income' : 'expense'],
        array_slice(is_array($body['categories'] ?? null) ? $body['categories'] : [], 0, 200));
    $countries = substr(preg_replace('/[^a-z,]/i', '', (string) ($body['countries'] ?? 'be')), 0, 30) ?: 'be';
    $provider = in_array($body['provider'] ?? '', ['free', 'ai'], true) ? $body['provider'] : 'auto';
    if ($provider === 'auto') $provider = $apiKey !== '' ? 'ai' : 'free';
    if ($provider === 'ai' && $apiKey === '') throw new HttpError(400, 'AI is niet ingesteld op deze server');

    $cache = read_json('lookup-cache.json', []);
    $dirty = false;
    $free = [];
    foreach ($items as $it) {
        $name = (string) ($it['name'] ?? ''); $desc = (string) ($it['description'] ?? '');
        if ($name === '' && $desc === '') { $free[] = ['query' => '', 'hits' => [], 'text' => '', 'errors' => []]; continue; }
        $key = 'free:' . $countries . ':' . cache_key_name($name !== '' ? $name : $desc);
        $hit = $cache[$key] ?? null;
        if ($hit && now_ms() - $hit['at'] < 90 * 86400000) { $free[] = $hit['value']; continue; }
        $res = lookup_free($fetch, ['name' => $name, 'description' => $desc], $countries);
        if (!$res['errors'] || $res['hits']) { $cache[$key] = ['at' => now_ms(), 'value' => $res]; $dirty = true; }
        $free[] = $res;
    }
    if ($dirty) with_lock('lookup-cache', function () use ($cache) {
        $current = read_json('lookup-cache.json', []);
        write_json('lookup-cache.json', array_merge($current, $cache));
    });

    $ai = [];
    if ($provider === 'ai' && $items) {
        $ai = ai_classify(array_map(fn($it) => ['title' => $it['title'] ?? null, 'name' => $it['name'] ?? '', 'description' => $it['description'] ?? '', 'direction' => $it['direction'] ?? 'out'], $items), $categories, $countries, $apiKey);
    }
    $results = [];
    foreach ($items as $i => $it) {
        $r = array_merge(['name' => $it['name'] ?? ''], $free[$i]);
        foreach ($ai as $a) if ($a['index'] === $i) {
            $r['ai'] = ['categoryId' => $a['categoryId'], 'businessType' => $a['businessType'], 'confidence' => $a['confidence'], 'explanation' => $a['explanation']];
            break;
        }
        $results[] = $r;
    }
    return ['provider' => $provider, 'results' => $results];
}
