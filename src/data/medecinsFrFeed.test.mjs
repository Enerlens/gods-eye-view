// Reading the doctor register — the rules that keep the map from claiming
// things the register never said.
//
// The load-bearing tests here are the two that read the SHIPPED PACK rather
// than a fixture: every specialty must have a family, and the mesh weight must
// be the distinct-name count. Both are the kind of thing a future edition of
// the register breaks silently, and a fixture would never notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import {
  APL_62,
  APL_65,
  APL_ALL,
  APL_DEP_65,
  APL_STANDING_LABELS,
  MEDECINS_MESH_BUDGETS,
  MEDECINS_NATIONAL_SPAN_DEG,
  MEDECIN_FAMILIES,
  MEDECIN_FAMILY_INDEX,
  MEDECIN_FAMILY_LABELS,
  MEDECIN_TARIFF_CAPPED,
  MESH_FAMILY,
  MESH_PRACTITIONERS,
  SITE_PRACTITIONERS,
  SITE_SPECIALTIES,
  aplDecile,
  aplStanding,
  familyCounts,
  mappedSpecialtyCodes,
  medecinFamily,
  medecinsMeshBudget,
  medecinsRegime,
  practitionerTariff,
  projectMedecinsMesh,
  retirementCliff,
  selectMedecinsMesh,
  siteSpecialtyList,
  sitePrimaryFamily,
  tariffMix,
} from './medecinsFrFeed.js';

/**
 * The pack ships gzipped — 3.67 MB against 16.18 MB — and `--plain` writes the
 * other. Read whichever is there, so a contributor who unpacked it locally
 * still runs the same assertions.
 */
function readPack() {
  const base = new URL('./local_data/medecins_fr/medecins.json', import.meta.url);
  try {
    return JSON.parse(gunzipSync(readFileSync(new URL(`${base.pathname}.gz`, base))).toString('utf8'));
  } catch {
    return JSON.parse(readFileSync(base, 'utf8'));
  }
}
const PACK = readPack();

const site = (specialties, practitioners = 1) => {
  const row = [46, 2, 0, '01053', '01000', 'BOURG', '1 RUE X', '', 'liberal', specialties, practitioners];
  return row;
};

test('every specialty the shipped pack publishes has an explicit family', () => {
  const mapped = new Set(mappedSpecialtyCodes());
  const published = Object.keys(PACK.specialites);
  const missing = published.filter((code) => !mapped.has(code));
  assert.deepEqual(
    missing,
    [],
    `unmapped specialty codes would silently render as "spécialité médicale": ${missing.join(', ')}`,
  );
  // And nothing mapped that the register no longer publishes — a stale entry is
  // a legend row for a colour no dot will ever wear.
  const stale = [...mapped].filter((code) => !PACK.specialites[code]);
  assert.deepEqual(stale, [], `family table names codes the pack does not: ${stale.join(', ')}`);
});

test('every family has a label, and the index covers the list', () => {
  for (const family of MEDECIN_FAMILIES) {
    assert.ok(MEDECIN_FAMILY_LABELS[family], `no label for ${family}`);
    assert.equal(typeof MEDECIN_FAMILY_INDEX[family], 'number');
  }
  assert.equal(Object.keys(MEDECIN_FAMILY_LABELS).length, MEDECIN_FAMILIES.length);
});

test('general practice wins the dot whenever it is present', () => {
  // A health centre with one GP and nine radiologists reads, to a person
  // looking for care, as "you can see a GP here". That is the scarcer fact.
  const centre = site([['06', 9], ['01', 1]], 10);
  assert.equal(sitePrimaryFamily(centre), 'generaliste');
  assert.equal(medecinFamily('06'), 'imagerie');
});

test('without a GP the largest family wins, and ties never flicker', () => {
  assert.equal(sitePrimaryFamily(site([['06', 4], ['03', 2]])), 'imagerie');
  // Equal counts resolve by the declared family order, so two renders of the
  // same site agree.
  const tied = site([['41', 3], ['12', 3]]);
  assert.equal(sitePrimaryFamily(tied), sitePrimaryFamily(tied));
  assert.equal(sitePrimaryFamily(tied), 'femme-enfant');
});

test('ORL is read as a specialty, maxillo-facial as surgery', () => {
  // Nobody looks up a surgeon when their ear hurts; and a dental-sounding name
  // does not make stomatology anything other than surgery.
  assert.equal(medecinFamily('11'), 'specialiste');
  assert.equal(medecinFamily('18'), 'chirurgie');
  assert.equal(medecinFamily('45'), 'chirurgie');
});

test('family counts sum the entries a site publishes', () => {
  assert.deepEqual(familyCounts(site([['01', 3], ['12', 2], ['07', 1]])), {
    generaliste: 3,
    'femme-enfant': 3,
  });
  assert.deepEqual(familyCounts(undefined), {});
});

test('the specialty list is richest-first and carries the label', () => {
  const list = siteSpecialtyList(site([['12', 1], ['01', 4]]), PACK.specialites);
  assert.equal(list[0].label, 'Médecin généraliste');
  assert.equal(list[0].count, 4);
  assert.equal(list[1].family, 'femme-enfant');
});

test('the mesh is weighted by PEOPLE, never by entries', () => {
  // The whole point: a radiologist is listed at every imaging site they cover,
  // 5.53 entries per name against 1.18 for a GP. Weighting on entries would
  // make radiology the second specialty of France.
  const rows = projectMedecinsMesh([site([['06', 40]], 7)]);
  assert.equal(rows[0][MESH_PRACTITIONERS], 7);
  assert.notEqual(rows[0][MESH_PRACTITIONERS], 40);
  assert.equal(rows[0][MESH_FAMILY], MEDECIN_FAMILY_INDEX.imagerie);
});

test('a site with no published practitioner count still gets a weight', () => {
  // Health centres publish no names. Weight 0 would delete them from the mesh,
  // which is a different statement from "no doctors here".
  const rows = projectMedecinsMesh([site([['01', 3]], 0)]);
  assert.equal(rows[0][MESH_PRACTITIONERS], 1);
});

test('the mesh thins to its budget and keeps the heaviest of a cell', () => {
  const rows = [];
  for (let i = 0; i < 4000; i += 1) {
    rows.push([43 + (i % 50) * 0.02, 1 + Math.floor(i / 50) * 0.02, 1 + (i % 9), i % 6]);
  }
  const box = { south: 42, west: 0, north: 46, east: 4 };
  const result = selectMedecinsMesh(rows, { box, budget: 300 });
  assert.ok(result.picked.length <= 300, `expected ≤ 300, got ${result.picked.length}`);
  assert.ok(result.picked.length > 0);
  assert.equal(result.inBox, rows.length);
  assert.equal(result.thinned, true);
  // The heaviest row of the whole set survives thinning — the cell
  // representative is picked by weight, so the busiest practice never
  // disappears behind a one-doctor neighbour.
  const heaviest = Math.max(...rows.map((row) => row[MESH_PRACTITIONERS]));
  assert.ok(result.picked.some((row) => row[MESH_PRACTITIONERS] === heaviest));
});

test('mesh budgets shrink as the view widens', () => {
  const budgets = MEDECINS_MESH_BUDGETS.map((tier) => tier.budget);
  for (let i = 1; i < budgets.length; i += 1) {
    assert.ok(budgets[i] <= budgets[i - 1], 'a wider view must never ask for more dots');
  }
  assert.ok(medecinsMeshBudget(0.5) >= medecinsMeshBudget(8));
});

test('the regime ladder is entered on latitude span', () => {
  assert.equal(medecinsRegime(12), 'national');
  assert.equal(medecinsRegime(MEDECINS_NATIONAL_SPAN_DEG), 'national');
  assert.equal(medecinsRegime(3), 'mesh');
  assert.equal(medecinsRegime(0.2), 'sites');
  // A missing span is the whole planet, not a close-up.
  assert.equal(medecinsRegime(undefined), 'national');
});

test('a tariff is said the way a patient meets it', () => {
  assert.equal(practitionerTariff('1', ''), 'tarif fixé (secteur 1)');
  assert.equal(practitionerTariff('3', '3'), MEDECIN_TARIFF_CAPPED);
  assert.equal(practitionerTariff('3', '4'), MEDECIN_TARIFF_CAPPED);
  assert.equal(practitionerTariff('3', ''), 'honoraires libres (secteur 2)');
  assert.equal(practitionerTariff('0', ''), 'non conventionné');
  // An unpublished sector says so instead of being assumed cheap.
  assert.equal(practitionerTariff('', ''), 'secteur non publié');
});

test('the tariff mix counts a site without judging it', () => {
  const mix = tariffMix([
    ['A', 'M', '01', '1', ''],
    ['B', 'F', '15', '3', ''],
    ['C', 'M', '15', '3', '3'],
    ['D', 'F', '12', '', ''],
  ]);
  assert.deepEqual(mix, { fixe: 1, plafonne: 1, libre: 1, autre: 1 });
  assert.deepEqual(tariffMix(undefined), { fixe: 0, plafonne: 0, libre: 0, autre: 0 });
});

test('an APL becomes a decile, and the pack carries the bounds to do it', () => {
  const { bornes } = PACK.apl;
  assert.equal(bornes.length, 10);
  assert.equal(aplDecile(0.1, bornes), 1);
  assert.equal(aplDecile(bornes[0], bornes), 1);
  assert.equal(aplDecile(bornes[0] + 1e-9, bornes), 2);
  assert.equal(aplDecile(999, bornes), 10);
  assert.equal(aplDecile(NaN, bornes), null);
  assert.equal(aplDecile(3, null), null);
});

test('the decile bounds rise, so a better APL never reads as a worse tenth', () => {
  const { bornes } = PACK.apl;
  for (let i = 1; i < bornes.length; i += 1) {
    assert.ok(bornes[i] >= bornes[i - 1], `bound ${i} goes backwards`);
  }
});

test('the ARS thresholds are policy, and stay separate from the deciles', () => {
  const { seuils } = PACK.apl;
  assert.equal(aplStanding(2.5, seuils), 'sous-dotee');
  assert.equal(aplStanding(2.51, seuils), 'moyennement-dotee');
  assert.equal(aplStanding(4, seuils), 'moyennement-dotee');
  assert.equal(aplStanding(4.01, seuils), 'bien-dotee');
  assert.equal(aplStanding(null, seuils), null);
  for (const key of Object.keys(APL_STANDING_LABELS)) assert.ok(APL_STANDING_LABELS[key]);
});

test('the retirement cliff is a drop, and refuses to invent one', () => {
  const cliff = retirementCliff([4, 3.5, 3, 2.8, 1000, 1010]);
  assert.equal(cliff.now, 4);
  assert.equal(cliff.at62, 3);
  assert.ok(Math.abs(cliff.dropAt62 + 0.25) < 1e-9);
  assert.equal(retirementCliff(null), null);
  assert.equal(retirementCliff([null, null, null, null, 10, 10]), null);
  // A zero APL cannot produce a percentage; it must not produce Infinity either.
  assert.equal(retirementCliff([0, 0, 0, 0, 10, 10]), null);
});

test('the shipped pack agrees with the DREES published figures', () => {
  const { apl } = PACK;
  assert.equal(apl.millesime, 2024);
  assert.equal(apl.champ, 'France hors Mayotte');
  // The DREES publishes 3,3 for 2024, on the "65 ans ou moins" series. Reading
  // the all-ages column instead answers 3,72 and disagrees with every
  // published figure — this is the assertion that keeps the headline honest.
  assert.ok(Math.abs(apl.national - 3.26) < 0.02, `national APL drifted to ${apl.national}`);
  assert.ok(Math.abs(apl.dixiemes[0] - 1.32) < 0.02);
  assert.ok(Math.abs(apl.dixiemes[9] - 5.65) < 0.05);
});

test('the department roll-up sums to the national headcount, exactly', () => {
  // 7.9 % of doctors practise in more than one department. Counting distinct
  // names per department and adding the columns answers 130 330 for a country
  // that holds 117 922 — this assertion is what stops that reappearing.
  const total = Object.values(PACK.departements).reduce((sum, row) => sum + row[0], 0);
  assert.equal(total, PACK.stats.medecinsNommes);
  assert.ok(PACK.stats.surcompteSommeDepartementale > 0);
});

test('every placed site carries a precision the legend can name', () => {
  assert.deepEqual(PACK.precision, ['numero', 'voie', 'lieu-dit', 'commune']);
  for (const row of PACK.sites.slice(0, 500)) {
    assert.ok(row[2] >= 0 && row[2] < PACK.precision.length);
    assert.equal(typeof row[SITE_PRACTITIONERS], 'number');
    assert.ok(Array.isArray(row[SITE_SPECIALTIES]));
  }
});

test('the APL series stays ordered: retiring doctors never improves access', () => {
  let checked = 0;
  for (const values of Object.values(PACK.apl.communes)) {
    if (values[APL_ALL] === null || values[APL_62] === null) continue;
    assert.ok(values[APL_ALL] >= values[APL_65] - 1e-9, 'apl65 above all-ages');
    assert.ok(values[APL_65] >= values[APL_62] - 1e-9, 'apl62 above apl65');
    checked += 1;
    if (checked > 5000) break;
  }
  assert.ok(checked > 1000);
  for (const row of Object.values(PACK.apl.departements)) {
    assert.ok(row[APL_DEP_65] <= row[0] + 1e-9);
  }
});
