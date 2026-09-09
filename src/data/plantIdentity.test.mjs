// Une centrale, une marque — the keys, and the ones that were refused.
//
// Three registers hold 56 of the same French power stations and drew them two
// and three times over. `docs/PLAN-CROISEMENTS.md` called the fix "une colonne
// vertébrale à écrire (choisir quelle source fait foi pour la position,
// laquelle pour la puissance)". The position question was already answered, by
// this repository's own build script, and recorded in the pack: these tests
// pin down that reading, the tolerance that decides when the two registers'
// megawatts are a disagreement rather than a rounding, and — measured against
// the SHIPPED packs — that the chain still resolves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PLANT_JOIN_KEYS,
  PLANT_MW_AGREEMENT,
  PLANT_REGISTER_ORDER,
  edfSiteIdForRteSite,
  plantCrossRegisterLine,
  plantPowerDiffers,
} from './plantIdentity.js';

/** The RTE units pack the layer actually ships. */
const RTE = JSON.parse(readFileSync(
  new URL('./local_data/rte_production_units/units.json', import.meta.url), 'utf8',
));
/** The hydro register pack the layer actually ships. */
const HYDRO = JSON.parse(readFileSync(
  new URL('./local_data/fr_hydro_plants/plants.json', import.meta.url), 'utf8',
));

test('the EDF reference is read out of the pack, not guessed at', () => {
  assert.equal(
    edfSiteIdForRteSite({ placementRef: 'edf:nucleaire:GRAVELINES' }),
    'nucleaire:GRAVELINES',
  );
  // A reference into ANOTHER register is not an EDF identity, and the prefix
  // is the whole of what says which.
  assert.equal(edfSiteIdForRteSite({ placementRef: 'INSEE:57606' }), null);
  assert.equal(edfSiteIdForRteSite({ placementRef: 'way/818615581' }), null);
  assert.equal(edfSiteIdForRteSite({ placementRef: 'edf:' }), null);
  assert.equal(edfSiteIdForRteSite({}), null);
  assert.equal(edfSiteIdForRteSite(null), null);
});

test('the shipped RTE pack still carries the EDF link, on the sites it says it does', () => {
  const placed = RTE.sites.filter((site) => site.placement === 'edf-published');
  assert.equal(placed.length, 69, `the pack now places ${placed.length} sites on EDF`);
  // Every one of them must resolve: a `placement` that says `edf-published`
  // with a reference this cannot read would withdraw nothing and say nothing.
  for (const site of placed) {
    assert.ok(edfSiteIdForRteSite(site), `${site.id} (${site.name}) has no readable EDF reference`);
  }
  // …and no OTHER placement may masquerade as one.
  for (const site of RTE.sites.filter((entry) => entry.placement !== 'edf-published')) {
    assert.equal(edfSiteIdForRteSite(site), null, `${site.id} claims an EDF reference`);
  }
});

test('the shipped packs still share the 55 EIC codes the dedup rests on', () => {
  const rteEic = new Set();
  for (const unit of RTE.units) if (unit?.eic) rteEic.add(unit.eic);
  const shared = HYDRO.plants.filter((plant) => plant?.eic && rteEic.has(plant.eic));
  assert.equal(shared.length, 55, `the packs now share ${shared.length} EIC codes`);
  // Grand-Maison is the site all three registers hold, and the one the whole
  // chain is checked against.
  const grandMaison = shared.find((plant) => /GRAND-MAISON/i.test(plant.name));
  assert.ok(grandMaison, 'Grand-Maison is no longer in both packs');
  const unit = RTE.units.find((entry) => entry.eic === grandMaison.eic);
  const site = RTE.sites.find((entry) => entry.id === unit.site);
  assert.equal(edfSiteIdForRteSite(site), 'hydraulique:GRAND-MAISON');
});

test('the chain from a hydro plant to an EDF site still resolves for 43 of them', () => {
  const siteByUnit = new Map(RTE.units.map((unit) => [unit.eic, unit.site]));
  const siteById = new Map(RTE.sites.map((site) => [site.id, site]));
  let chained = 0;
  for (const plant of HYDRO.plants) {
    const siteId = plant?.eic ? siteByUnit.get(plant.eic) : null;
    if (siteId && edfSiteIdForRteSite(siteById.get(siteId))) chained += 1;
  }
  assert.equal(chained, 43, `the chain now reaches ${chained} EDF sites`);
});

test('a rounding is not a disagreement, and a disagreement is not a rounding', () => {
  // 43 of the 69 pairs agree to the megawatt.
  assert.equal(plantPowerDiffers(5460, 5460), false);
  // Blénod: 427 against 450.5 is ×1.055 — over the cut, and it IS the two
  // registers counting different things.
  assert.equal(plantPowerDiffers(427, 450.5), true);
  // Flamanville: EDF's file predates the EPR, RTE counts it.
  assert.equal(plantPowerDiffers(2660, 4280), true);
  assert.equal(plantPowerDiffers(1000, 1000 * PLANT_MW_AGREEMENT * 0.999), false);
  // An ABSENT figure is not a disagreement.
  assert.equal(plantPowerDiffers(null, 500), false);
  assert.equal(plantPowerDiffers(500, 0), false);
  assert.equal(plantPowerDiffers(undefined, undefined), false);
});

test('the card stays quiet where the registers agree', () => {
  assert.equal(plantCrossRegisterLine('RTE', 5460, 5460), null);
  assert.equal(plantCrossRegisterLine('RTE', null, 5460), null);
  assert.equal(
    plantCrossRegisterLine('RTE', 4280, 2660),
    `⌁ RTE : ${(4280).toLocaleString('fr-FR')} MW`,
  );
  assert.equal(
    plantCrossRegisterLine('RTE', 1063, 585, 'somme de 4 groupes ≥ 100 MW'),
    `⌁ RTE : ${(1063).toLocaleString('fr-FR')} MW — somme de 4 groupes ≥ 100 MW`,
  );
});

test('the precedence is a list, and the keys are named once', () => {
  // EDF first because it is the fused row's primary AND the coordinate the
  // other two borrowed; the hydro register last because its subject is the
  // long tail the others do not hold.
  assert.deepEqual([...PLANT_REGISTER_ORDER], [
    'edf-power-plants', 'rte-generation', 'fr-hydro-plants',
  ]);
  assert.deepEqual(Object.values(PLANT_JOIN_KEYS).sort(), [
    'plants/edf', 'plants/eic', 'plants/rteByEdf',
  ]);
});
