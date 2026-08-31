import test from 'node:test';
import assert from 'node:assert/strict';

import { REGISTERED_LAYER_IDS } from './layerState.js';
import {
  LAYER_CATEGORIES,
  LAYER_TAXONOMY,
  groupLayerIdsByCategory,
  layerTaxonomyFor,
  validateLayerTaxonomy,
} from './layerTaxonomy.js';

test('the shipped taxonomy covers the registered layer set exactly', () => {
  assert.equal(validateLayerTaxonomy(), true);
  assert.equal(LAYER_TAXONOMY.length, REGISTERED_LAYER_IDS.length);
  const categorized = new Set(LAYER_TAXONOMY.map((entry) => entry.id));
  for (const id of REGISTERED_LAYER_IDS) assert.ok(categorized.has(id), `uncategorized: ${id}`);
});

test('a layer registered without a category fails validation', () => {
  assert.throws(
    () => validateLayerTaxonomy(LAYER_TAXONOMY, [...REGISTERED_LAYER_IDS, 'newly-added-layer']),
    /uncategorized: newly-added-layer/,
  );
});

test('a taxonomy entry for an unregistered layer fails validation', () => {
  assert.throws(
    () => validateLayerTaxonomy(LAYER_TAXONOMY, REGISTERED_LAYER_IDS.filter((id) => id !== 'radio')),
    /unknown: radio/,
  );
});

test('every entry names a declared category', () => {
  const declared = new Set(LAYER_CATEGORIES.map((category) => category.id));
  for (const entry of LAYER_TAXONOMY) {
    assert.ok(declared.has(entry.category), `${entry.id} → ${entry.category}`);
  }
  assert.throws(
    () => validateLayerTaxonomy(
      [{ ...LAYER_TAXONOMY[0], category: 'not-a-category' }],
      [LAYER_TAXONOMY[0].id],
    ),
    /Unknown category for layer/,
  );
});

test('facet values are constrained', () => {
  const [sample] = LAYER_TAXONOMY;
  for (const [field, bad] of [['kind', 'widget'], ['coverage', 'mars'], ['auth', 'free'], ['cadence', 'hourly']]) {
    assert.throws(
      () => validateLayerTaxonomy([{ ...sample, [field]: bad }], [sample.id]),
      new RegExp(`Invalid layer ${field}`),
      `${field} must reject ${bad}`,
    );
  }
});

test('duplicate ids are rejected rather than silently deduplicated', () => {
  const [sample] = LAYER_TAXONOMY;
  assert.throws(
    () => validateLayerTaxonomy([sample, sample], [sample.id]),
    /Duplicate layer taxonomy id/,
  );
});

test('every category label carries its French accents', () => {
  // `text-transform: uppercase` preserves accents but never adds them, so an
  // unaccented label here would render as a permanent typo in the panel.
  const byId = new Map(LAYER_CATEGORIES.map((entry) => [entry.id, entry.label]));
  assert.equal(byId.get('energy'), 'ÉNERGIE');
  assert.equal(byId.get('defence'), 'DÉFENSE');
  assert.equal(byId.get('ground-mobility'), 'MOBILITÉ TERRESTRE');
  assert.equal(byId.get('comms-sensors'), 'RÉSEAUX & CAPTEURS');
});

test('grouping preserves category order and drops coordinators', () => {
  const groups = groupLayerIdsByCategory();
  assert.deepEqual(groups.map((group) => group.id), LAYER_CATEGORIES.map((entry) => entry.id));

  // military-awareness loads nothing of its own — it orchestrates four other
  // layers behind the CONTACTS panel. It must never occupy a row or inflate a
  // group count, but it must still be categorized.
  const defence = groups.find((group) => group.id === 'defence');
  assert.ok(!defence.layerIds.includes('military-awareness'));
  assert.equal(layerTaxonomyFor('military-awareness').kind, 'coordinator');
  assert.equal(layerTaxonomyFor('military-awareness').category, 'defence');

  const grouped = groups.flatMap((group) => group.layerIds);
  const datasets = LAYER_TAXONOMY.filter((entry) => entry.kind === 'dataset');
  assert.equal(grouped.length, datasets.length);
  assert.equal(new Set(grouped).size, grouped.length, 'no layer appears in two groups');
});

test('no category is left empty', () => {
  for (const group of groupLayerIdsByCategory()) {
    assert.ok(group.layerIds.length > 0, `empty category: ${group.id}`);
  }
});

test('layerTaxonomyFor resolves registered ids and refuses unknown ones', () => {
  assert.equal(layerTaxonomyFor('cctv').category, 'comms-sensors');
  assert.equal(layerTaxonomyFor('cctv').label, 'Caméras publiques');
  assert.equal(layerTaxonomyFor('not-a-layer'), null);
});

test('the French display names are recorded but not yet consumed', () => {
  // Phase 3 flips the panel from `layer.name` to this field. Until it does, the
  // labels living here must not be mistaken for what the UI renders today.
  for (const entry of LAYER_TAXONOMY) {
    assert.equal(typeof entry.label, 'string');
    assert.ok(entry.label.length > 0, `${entry.id} has no label`);
    assert.ok(!/\(FR\)/.test(entry.label), `${entry.id} still carries a (FR) suffix`);
  }
  assert.equal(layerTaxonomyFor('ais-live-vessels').label, 'Navires en direct');
  assert.equal(layerTaxonomyFor('military-installations').label, 'Sites militaires');
  assert.equal(layerTaxonomyFor('shared-mobility-fr').label, 'Véhicules partagés');
  assert.equal(layerTaxonomyFor('local-datacenters').label, 'Datacenters');
});
