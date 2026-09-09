/*
 * THE MÉDECINS TEST.
 *
 * On 2026-09-09 an operator asked the mic, in French, to show the doctors
 * layer. It answered that it did not have one. `medecins-fr` had been
 * registered for months — the model simply could not NAME it: the enum on
 * `set_layer_visibility` listed 17 ids inherited from upstream while the fork
 * had grown to 60 layers, and a model that respects an enum cannot emit a value
 * outside it.
 *
 * This file is the guard against that recurring. It asserts two things:
 *   1. the vocabulary resolves what people SAY, in French, without accents;
 *   2. the enums in vite.config.js are still the registry, not a copy of it
 *      that somebody forgot to update.
 *
 * (2) is the one that matters over time. The enum is a literal in the config on
 * purpose — the tool schema is byte-frozen and the bench slices it out as
 * source text — so nothing can compute it at module scope. A test is the only
 * mechanism that keeps two lists identical, and it is the same mechanism
 * src/locations.test.mjs uses for the fly_to_location presets.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ANALYST_LAYERS } from '../data/analystEngine.js';
import { LAYER_TAXONOMY } from '../data/layerTaxonomy.js';
import {
  ANALYST_QUERY_LAYER_IDS,
  ENTITY_CONTEXT_LAYER_IDS,
  VOICE_LAYER_IDS,
  describeVoiceLayers,
  normalizeVocabularyKey,
  resolveVoiceLayerId,
  suggestVoiceLayers,
} from './layerVocabulary.js';

const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');

/** Read one tool's enum out of the shipped schema, as data. */
function toolEnum(toolName, path) {
  const start = config.indexOf(`name: '${toolName}'`);
  assert.ok(start > 0, `${toolName} is missing from the tool schema`);
  const end = config.indexOf("\n  {\n    type: 'function'", start);
  const literal = config.slice(start, end > start ? end : start + 12000);
  const anchor = literal.indexOf(path);
  assert.ok(anchor > 0, `${toolName} has no ${path}`);
  const enumStart = literal.indexOf('enum: [', anchor);
  const enumEnd = literal.indexOf(']', enumStart);
  return [...literal.slice(enumStart, enumEnd).matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

test('every registered dataset is speakable, and only the coordinator is not', () => {
  const datasets = LAYER_TAXONOMY.filter((entry) => entry.kind === 'dataset').map((entry) => entry.id);
  assert.deepEqual([...VOICE_LAYER_IDS], datasets);
  // military-awareness loads nothing of its own and is entered through the
  // Contacts tab. A toggle for it would be a switch for a non-source.
  assert.ok(!VOICE_LAYER_IDS.includes('military-awareness'));
});

test('every layer resolves from its own id and from its panel label', () => {
  for (const entry of LAYER_TAXONOMY) {
    if (entry.kind !== 'dataset') continue;
    assert.equal(resolveVoiceLayerId(entry.id), entry.id, `${entry.id} does not resolve from its id`);
    assert.equal(
      resolveVoiceLayerId(entry.label),
      entry.id,
      `"${entry.label}" does not resolve to ${entry.id}`,
    );
  }
});

test('the French a person actually says resolves — accents optional', () => {
  const spoken = {
    // The report that started this.
    médecins: 'medecins-fr',
    medecins: 'medecins-fr',
    MÉDECINS: 'medecins-fr',
    docteurs: 'medecins-fr',
    généralistes: 'medecins-fr',
    // The rest of the list the plan named, one probe each.
    'bornes de recharge': 'irve-fr',
    bornes: 'irve-fr',
    crues: 'vigicrues',
    'vigilance météo': 'meteofrance-vigilance',
    écoles: 'schools-fr',
    'bâti 3d': 'bdtopo-buildings',
    parcelles: 'cadastre-fr',
    'ventes immobilières': 'dvf-sales',
    dpe: 'dpe-fr',
    bruit: 'bruit-fr',
    antennes: 'anfr-fr',
    crèches: 'petite-enfance-fr',
    délinquance: 'delinquance-fr',
    'îlots de fraîcheur': 'fraicheur-fr',
    pharmacies: 'amenities-fr',
    tram: 'transit-fr',
    trottinettes: 'shared-mobility-fr',
    'réseau électrique': 'power-grid',
    'centrales EDF': 'edf-power-plants',
    gaz: 'gas-fr',
    'stations météo': 'meteo-stations-fr',
    comptages: 'comptages-fr',
    'événements routiers': 'road-events-fr',
    'permis de construire': 'ads-fr',
    plu: 'urbanisme-gpu',
    risques: 'georisques',
    isochrone: 'isochrone-fr',
    comparables: 'comparables-fr',
    'avis de valeur': 'avis-valeur',
    universités: 'sup-fr',
    // The bike systems by their brand names, which is what people say.
    vélib: 'bikeshare',
    tbm: 'bikeshare',
    vélos: 'bikeshare',
    idfm: 'idfm-network',
  };
  for (const [said, expected] of Object.entries(spoken)) {
    assert.equal(resolveVoiceLayerId(said), expected, `"${said}" should resolve to ${expected}`);
  }
});

test('normalization folds accents, case and punctuation to one key', () => {
  assert.equal(normalizeVocabularyKey('Îlots de Fraîcheur'), 'ilots de fraicheur');
  assert.equal(normalizeVocabularyKey('medecins_fr'), 'medecins fr');
  assert.equal(normalizeVocabularyKey('  BORNES--DE  RECHARGE '), 'bornes de recharge');
  assert.equal(normalizeVocabularyKey(null), '');
});

test('a near miss gets suggestions and nonsense gets none', () => {
  assert.deepEqual(suggestVoiceLayers('bornes electriques').map((entry) => entry.id), ['irve-fr', 'power-grid']);
  assert.equal(suggestVoiceLayers('la couche medecin')[0].id, 'medecins-fr');
  // French grammar words must not manufacture a match: "des" appears in half
  // the labels, and three confident suggestions for a layer nobody has is
  // worse than admitting the miss.
  assert.deepEqual(suggestVoiceLayers('couche des licornes'), []);
  assert.deepEqual(suggestVoiceLayers('blockchain'), []);
  assert.deepEqual(suggestVoiceLayers(''), []);
});

test('describeVoiceLayers reports the registry, with live state when there is a manager', () => {
  const all = describeVoiceLayers();
  assert.equal(all.length, VOICE_LAYER_IDS.length);
  const doctors = all.find((row) => row.id === 'medecins-fr');
  assert.equal(doctors.label, 'Médecins');
  assert.equal(doctors.group, 'BÂTI & TERRITOIRE');
  assert.equal(doctors.enabled, null, 'no manager means no claim about state');

  const manager = {
    getAll: () => [{ id: 'medecins-fr', enabled: true, stats: { count: 128 } }],
  };
  const live = describeVoiceLayers({ dataManager: manager, query: 'docteurs' });
  assert.deepEqual(live, [{
    id: 'medecins-fr',
    label: 'Médecins',
    group: 'BÂTI & TERRITOIRE',
    coverage: 'fr',
    enabled: true,
    count: 128,
  }]);
  // A manager that throws is not a reason to withhold the registry.
  const broken = { getAll: () => { throw new Error('mid-teardown'); } };
  assert.equal(describeVoiceLayers({ dataManager: broken }).length, VOICE_LAYER_IDS.length);
});

test('the analyst enum is exactly what the engine will answer', () => {
  // A wider enum teaches the model to make calls the engine refuses by name;
  // a narrower one hides layers whose records are already loaded.
  assert.deepEqual(
    [...ANALYST_QUERY_LAYER_IDS].sort(),
    Object.keys(ANALYST_LAYERS).filter((id) => VOICE_LAYER_IDS.includes(id)).sort(),
  );
  for (const id of ANALYST_QUERY_LAYER_IDS) {
    assert.ok(VOICE_LAYER_IDS.includes(id), `${id} is queryable but not registered`);
  }
});

test('the four shipped enums are still the registry, not a stale copy', () => {
  const expectations = [
    ['set_layer_visibility', 'layerId: {', VOICE_LAYER_IDS],
    ['show_data_layers_menu', 'layerId: {', VOICE_LAYER_IDS],
    ['get_entity_context', 'layerId: {', ENTITY_CONTEXT_LAYER_IDS],
    ['analyst_query', 'layers: {', ANALYST_QUERY_LAYER_IDS],
  ];
  for (const [tool, path, expected] of expectations) {
    assert.deepEqual(
      toolEnum(tool, path).sort(),
      [...expected].sort(),
      `${tool}'s enum drifted from src/voice/layerVocabulary.js — regenerate it there and here`,
    );
  }
});

test('the schema tells the model the enum is the whole catalogue', () => {
  const start = config.indexOf("name: 'set_layer_visibility'");
  const description = config.slice(start, config.indexOf('enum: [', start));
  assert.match(description, /EVERY registered layer is in this enum/);
  assert.match(description, /médecins\/docteurs\/généralistes → medecins-fr/);
  assert.match(description, /bornes de recharge\/IRVE → irve-fr/);
  assert.ok(config.includes("name: 'list_layers'"), 'list_layers must be in the schema');
});
