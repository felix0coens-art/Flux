'use strict';
/*
 * Optionele AI-classificatie van tegenpartijen via Claude, met webzoekfunctie.
 * Wordt enkel gebruikt als ANTHROPIC_API_KEY ingesteld is op de server.
 */

const MODEL = process.env.FLUX_AI_MODEL || 'claude-opus-5-5';
let clientPromise = null;

function available() {
  return !!process.env.ANTHROPIC_API_KEY;
}

async function getClient() {
  if (!available()) return null;
  if (!clientPromise) {
    clientPromise = import('@anthropic-ai/sdk').then(mod => new mod.default());
  }
  return clientPromise;
}

const SYSTEM = `Je helpt een Belgische particulier om banktransacties te categoriseren in een persoonlijke boekhouding.
Je krijgt de categorieën van de gebruiker en een lijst tegenpartijen (zoals ze op een rekeninguittreksel staan, vaak afgekort of met plaatsnaam).
Heeft de gebruiker zelf een titel gegeven ("titel"), dan beschrijft die het best waarvoor de betaling diende: baseer je categorie daar in de eerste plaats op.
Zoek anders voor elke tegenpartij uit wat voor zaak of organisatie het is. Gebruik de webzoekfunctie wanneer je een naam niet met zekerheid kent; zoek niet als het overduidelijk is.
Kies de best passende categorie-id uit de lijst, of "" als geen enkele past of als het om een privépersoon gaat.
Hou rekening met de richting: inkomende bedragen horen bij inkomstencategorieën (kind "income"), uitgaande bij uitgavencategorieën.
Roep op het einde precies één keer de tool record_classifications aan, met één resultaat per tegenpartij (index zoals gegeven).`;

function classifyTool(categoryIds) {
  return {
    name: 'record_classifications',
    description: 'Registreert de categorie voor elke tegenpartij. Eén resultaat per gegeven index.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'integer', description: 'Index van de tegenpartij in de invoerlijst' },
              categoryId: { type: 'string', enum: categoryIds.concat(['']), description: 'Gekozen categorie-id of "" als niets past' },
              businessType: { type: 'string', description: 'Korte omschrijving van de zaak, in het Nederlands (bv. "Supermarktketen")' },
              confidence: { type: 'string', enum: ['hoog', 'middel', 'laag'] },
              explanation: { type: 'string', description: 'Eén korte zin waarom' }
            },
            required: ['index', 'categoryId', 'businessType', 'confidence', 'explanation'],
            additionalProperties: false
          }
        }
      },
      required: ['results'],
      additionalProperties: false
    }
  };
}

/**
 * @param items [{ name, description, direction: 'in'|'out' }]
 * @param categories [{ id, name, kind }]
 * @returns [{ index, categoryId, businessType, confidence, explanation }]
 */
async function classify(items, categories, countries) {
  const client = await getClient();
  if (!client) throw new Error('AI is niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt)');
  const cats = categories.map(c => ({ id: c.id, name: c.name, kind: c.kind === 'income' ? 'income' : 'expense' }));
  const input = items.map((it, index) => ({
    index,
    titel: it.title ? String(it.title).slice(0, 120) : undefined,
    tegenpartij: String(it.name || '').slice(0, 120),
    mededeling: String(it.description || '').slice(0, 120),
    richting: it.direction === 'in' ? 'inkomend' : 'uitgaand'
  }));
  const messages = [{
    role: 'user',
    content: `Land(en): ${countries || 'be'}\n\nCategorieën:\n${JSON.stringify(cats)}\n\nTegenpartijen:\n${JSON.stringify(input)}`
  }];
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: Math.min(10, items.length + 2) },
    classifyTool(cats.map(c => c.id))
  ];

  for (let round = 0; round < 4; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      tools,
      messages
    });
    if (response.stop_reason === 'refusal') throw new Error('Het model weigerde deze aanvraag');
    const call = response.content.find(b => b.type === 'tool_use' && b.name === 'record_classifications');
    if (call) {
      const results = Array.isArray(call.input && call.input.results) ? call.input.results : [];
      const valid = new Set(cats.map(c => c.id));
      return results
        .filter(r => Number.isInteger(r.index) && r.index >= 0 && r.index < items.length)
        .map(r => Object.assign({}, r, { categoryId: valid.has(r.categoryId) ? r.categoryId : '' }));
    }
    messages.push({ role: 'assistant', content: response.content });
    // pause_turn: de server-side zoeklus hervat vanzelf als we de beurt terugsturen
    if (response.stop_reason !== 'pause_turn') {
      messages.push({ role: 'user', content: 'Roep nu record_classifications aan met je resultaten.' });
    }
  }
  throw new Error('Geen classificatie ontvangen');
}

module.exports = { available, classify, MODEL };
