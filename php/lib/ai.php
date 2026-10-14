<?php
/*
 * Optionele AI-classificatie van tegenpartijen via Claude (met webzoekfunctie), via de officiële
 * Anthropic PHP SDK (php/vendor, wordt bij het uitrollen door GitHub geïnstalleerd).
 * Enkel actief als ANTHROPIC_API_KEY ingesteld is.
 */

declare(strict_types=1);

function ai_model(): string { return (string) cfg('FLUX_AI_MODEL', 'claude-opus-5-5'); }

function ai_sdk_loaded(): bool {
    static $ok = null;
    if ($ok === null) {
        $autoload = dirname(__DIR__) . '/vendor/autoload.php';
        $ok = is_file($autoload) && (require_once $autoload) !== false && class_exists('Anthropic\\Client');
    }
    return $ok;
}

function ai_available(): bool { return (string) cfg('ANTHROPIC_API_KEY', '') !== '' && ai_sdk_loaded(); }

const AI_SYSTEM = <<<TXT
Je helpt een Belgische particulier om banktransacties te categoriseren in een persoonlijke boekhouding.
Je krijgt de categorieën van de gebruiker en een lijst tegenpartijen (zoals ze op een rekeninguittreksel staan, vaak afgekort of met plaatsnaam).
Heeft de gebruiker zelf een titel gegeven ("titel"), dan beschrijft die het best waarvoor de betaling diende: baseer je categorie daar in de eerste plaats op.
Zoek anders voor elke tegenpartij uit wat voor zaak of organisatie het is. Gebruik de webzoekfunctie wanneer je een naam niet met zekerheid kent; zoek niet als het overduidelijk is.
Kies de best passende categorie-id uit de lijst, of "" als geen enkele past of als het om een privépersoon gaat.
Hou rekening met de richting: inkomende bedragen horen bij inkomstencategorieën (kind "income"), uitgaande bij uitgavencategorieën.
Roep op het einde precies één keer de tool record_classifications aan, met één resultaat per tegenpartij (index zoals gegeven).
TXT;

function ai_classify_tool(array $categoryIds): array {
    return [
        'name' => 'record_classifications',
        'description' => 'Registreert de categorie voor elke tegenpartij. Eén resultaat per gegeven index.',
        'strict' => true,
        'inputSchema' => [
            'type' => 'object',
            'properties' => [
                'results' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'index' => ['type' => 'integer', 'description' => 'Index van de tegenpartij in de invoerlijst'],
                            'categoryId' => ['type' => 'string', 'enum' => array_merge($categoryIds, ['']), 'description' => 'Gekozen categorie-id of "" als niets past'],
                            'businessType' => ['type' => 'string', 'description' => 'Korte omschrijving van de zaak, in het Nederlands (bv. "Supermarktketen")'],
                            'confidence' => ['type' => 'string', 'enum' => ['hoog', 'middel', 'laag']],
                            'explanation' => ['type' => 'string', 'description' => 'Eén korte zin waarom'],
                        ],
                        'required' => ['index', 'categoryId', 'businessType', 'confidence', 'explanation'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
            'required' => ['results'],
            'additionalProperties' => false,
        ],
    ];
}

/**
 * @param array $items [['title', 'name', 'description', 'direction' => 'in'|'out']]
 * @param array $categories [['id', 'name', 'kind']]
 * @return array [['index', 'categoryId', 'businessType', 'confidence', 'explanation']]
 */
function ai_classify(array $items, array $categories, string $countries): array {
    if (!ai_available()) throw new HttpError(400, 'AI is niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt)');
    $client = new Anthropic\Client(apiKey: (string) cfg('ANTHROPIC_API_KEY'), baseUrl: cfg('ANTHROPIC_BASE_URL') ?: null);
    $cats = array_map(fn($c) => ['id' => $c['id'], 'name' => $c['name'], 'kind' => $c['kind'] === 'income' ? 'income' : 'expense'], $categories);
    $input = [];
    foreach ($items as $index => $it) {
        $row = ['index' => $index];
        if (!empty($it['title'])) $row['titel'] = mb_substr((string) $it['title'], 0, 120);
        $row += [
            'tegenpartij' => mb_substr((string) ($it['name'] ?? ''), 0, 120),
            'mededeling' => mb_substr((string) ($it['description'] ?? ''), 0, 120),
            'richting' => ($it['direction'] ?? '') === 'in' ? 'inkomend' : 'uitgaand',
        ];
        $input[] = $row;
    }
    $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
    $messages = [[
        'role' => 'user',
        'content' => "Land(en): " . ($countries ?: 'be') . "\n\nCategorieën:\n" . json_encode($cats, $flags) . "\n\nTegenpartijen:\n" . json_encode($input, $flags),
    ]];
    $tools = [
        ['type' => 'web_search_20260209', 'name' => 'web_search', 'maxUses' => min(10, count($items) + 2)],
        ai_classify_tool(array_column($cats, 'id')),
    ];
    $valid = array_flip(array_column($cats, 'id'));

    for ($round = 0; $round < 4; $round++) {
        $response = $client->beta->messages->create(
            model: ai_model(),
            maxTokens: 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            outputConfig: ['effort' => 'low'],
            system: AI_SYSTEM,
            tools: $tools,
            messages: $messages,
        );
        if ($response->stopReason === 'refusal') throw new HttpError(502, 'Het model weigerde deze aanvraag');
        foreach ($response->content as $block) {
            if ($block->type === 'tool_use' && $block->name === 'record_classifications') {
                $in = json_decode(json_encode($block->input), true);
                $out = [];
                foreach ((is_array($in['results'] ?? null) ? $in['results'] : []) as $r) {
                    if (!is_int($r['index'] ?? null) || $r['index'] < 0 || $r['index'] >= count($items)) continue;
                    $r['categoryId'] = isset($valid[$r['categoryId'] ?? '']) ? $r['categoryId'] : '';
                    $out[] = $r;
                }
                return $out;
            }
        }
        $messages[] = ['role' => 'assistant', 'content' => $response->content];
        // pause_turn: de zoeklus op de server hervat vanzelf als we de beurt terugsturen
        if ($response->stopReason !== 'pause_turn') {
            $messages[] = ['role' => 'user', 'content' => 'Roep nu record_classifications aan met je resultaten.'];
        }
    }
    throw new HttpError(502, 'Geen classificatie ontvangen');
}
