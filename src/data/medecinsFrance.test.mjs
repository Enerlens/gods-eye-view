// The rendering decisions: what a dot claims, and what a card is allowed to
// say when the register has nothing to say.
//
// The recurring property under test is the layer's central honesty rule: this
// register carries no identifier and no appointment book, so a card may report
// who is listed at an address and what they charge, and must never imply
// availability, a headcount, or a precision BAN did not return.
import test from 'node:test';
import assert from 'node:assert/strict';

import medecinsFranceLayer, {
  APL_BINS,
  FAMILY_COLORS,
  MEDECINS_FR_LAYER_ID,
  aplBin,
  boxKey,
  buildDepartementCard,
  buildSiteCard,
  createMedecinsLayer,
  medecinPixelSize,
  selectLabelCohort,
  tariffLine,
} from './medecinsFrance.js';
import { MEDECIN_FAMILIES } from './medecinsFrFeed.js';

const SPECIALITES = { '01': 'Médecin généraliste', 15: 'Ophtalmologiste', '06': 'Radiologue' };
const PRECISION = ['numero', 'voie', 'lieu-dit', 'commune'];
const APL = {
  seuils: { sousDotee: 2.5, bienDotee: 4 },
  bornes: [1.76, 2.18, 2.54, 2.85, 3.19, 3.51, 3.83, 4.3, 4.87, 23.9],
  communes: { 12345: [2.4, 2.1, 1.8, 1.6, 5000, 5100] },
};

const site = ({
  precision = 0, insee = '12345', voie = '12 RUE DES LILAS', ville = 'Ambert',
  cp = '63600', tel = '0473000000', kind = 'liberal', specialties = [['01', 2]],
  practitioners = 2, registre = '',
} = {}) => [45, 3, precision, insee, cp, ville, voie, tel, kind, specialties, practitioners, registre];

test('the layer ships with the id every registry keys it on', () => {
  assert.equal(medecinsFranceLayer.id, MEDECINS_FR_LAYER_ID);
  assert.equal(MEDECINS_FR_LAYER_ID, 'medecins-fr');
  assert.equal(typeof medecinsFranceLayer.init, 'function');
  assert.equal(typeof medecinsFranceLayer.enable, 'function');
  assert.equal(typeof medecinsFranceLayer.disable, 'function');
  assert.equal(typeof medecinsFranceLayer.getStats, 'function');
});

test('every family has a colour, and no two share one', () => {
  const colors = MEDECIN_FAMILIES.map((family) => FAMILY_COLORS[family]);
  for (const [index, color] of colors.entries()) {
    assert.match(String(color), /^#[0-9a-f]{6}$/i, `${MEDECIN_FAMILIES[index]} has no colour`);
  }
  assert.equal(new Set(colors).size, colors.length, 'two families share a colour');
});

test('dot size grows with doctors and stays bounded', () => {
  assert.ok(medecinPixelSize(1) < medecinPixelSize(4));
  assert.ok(medecinPixelSize(4) < medecinPixelSize(30));
  assert.ok(medecinPixelSize(500) <= 15, 'a very large practice must not swallow its street');
  // A site with no published count is drawn, not deleted.
  assert.equal(medecinPixelSize(0), medecinPixelSize(1));
  assert.ok(Number.isFinite(medecinPixelSize(undefined)));
});

test('the APL ladder is anchored on the two thresholds that are policy', () => {
  const cuts = APL_BINS.map((bin) => bin.max);
  assert.ok(cuts.includes(2.5), 'the under-served threshold must be a bin edge');
  assert.ok(cuts.includes(4), 'the well-served threshold must be a bin edge');
  for (let i = 1; i < cuts.length; i += 1) assert.ok(cuts[i] > cuts[i - 1]);
  assert.equal(aplBin(1.2), 0);
  assert.equal(aplBin(2.5), 1);
  assert.equal(aplBin(2.51), 2);
  assert.equal(aplBin(9), APL_BINS.length - 1);
  // No value is a bin. A département with no APL row is drawn as absence.
  assert.equal(aplBin(null), null);
  assert.equal(aplBin(NaN), null);
});

test('a tariff line is refused when the register publishes no practitioner', () => {
  // "No tariff information" and "free" are not the same sentence, and a health
  // centre publishes specialties without names.
  assert.equal(tariffLine([]), null);
  assert.equal(tariffLine(undefined), null);
  assert.equal(tariffLine([['A', 'M', '01', '1', '']]), 'tarif fixé pour tous (secteur 1)');
  const mixed = tariffLine([['A', 'M', '01', '1', ''], ['B', 'F', '15', '3', '']]);
  assert.match(mixed, /honoraires libres/);
  assert.match(mixed, /tarif fixé/);
});

test('a card leads with where and who, and names the doctors', () => {
  const card = buildSiteCard(
    site(),
    [['MARTIN CLAIRE', 'F', '01', '1', ''], ['DURAND PAUL', 'M', '01', '1', '']],
    { specialites: SPECIALITES, precision: PRECISION, apl: APL },
  );
  const lines = card.split('\n');
  assert.equal(lines[0], '12 RUE DES LILAS');
  assert.ok(lines.includes('63600 Ambert'));
  assert.ok(lines.some((line) => line.startsWith('☎')));
  assert.ok(lines.includes('2 médecins'));
  assert.ok(lines.some((line) => line.includes('Dre MARTIN CLAIRE')));
  assert.ok(lines.some((line) => line.includes('Dr DURAND PAUL')));
});

test('a card never claims a precision BAN did not return', () => {
  const exact = buildSiteCard(site({ precision: 0 }), [], { precision: PRECISION });
  assert.ok(!exact.includes('⚠'), 'an exact address must not disclaim itself');

  const commune = buildSiteCard(site({ precision: 3 }), [], { precision: PRECISION });
  assert.match(commune, /centre de la commune, pas au cabinet/);

  const street = buildSiteCard(site({ precision: 1 }), [], { precision: PRECISION });
  assert.match(street, /pas au numéro/);
});

test('a health centre says its practitioners are unnamed, not that it has none', () => {
  const card = buildSiteCard(
    site({ kind: 'centre-de-sante', practitioners: 0, specialties: [['01', 3]] }),
    [],
    { specialites: SPECIALITES, precision: PRECISION },
  );
  assert.match(card, /Centre de santé/);
  assert.match(card, /Praticiens non nommés/);
  assert.ok(!card.includes('0 médecin'), 'never present an unnamed practice as an empty one');
  // The specialty tally still counts those rows — that is the whole point of
  // keeping it beside the name list.
  assert.match(card, /Médecin généraliste \(3\)/);
});

test('a card carries the local access as a POSITION, not a raw unit', () => {
  const card = buildSiteCard(site(), [], { specialites: SPECIALITES, precision: PRECISION, apl: APL });
  assert.match(card, /Accès local/);
  assert.match(card, /zone sous-dotée/);
  assert.match(card, /dixième de France/);
  // And the retirement cliff, as a percentage of what exists today.
  assert.match(card, /62 ans et plus/);
});

test('a commune with no APL row simply says nothing about access', () => {
  const card = buildSiteCard(site({ insee: '99999' }), [], { precision: PRECISION, apl: APL });
  assert.ok(!card.includes('Accès local'), 'absence must not be drawn as the bottom of the scale');
});

test('the register spelling is shown only when BAN disagrees', () => {
  const agreed = buildSiteCard(site(), [], { precision: PRECISION });
  assert.ok(!agreed.includes('Adresse publiée par le registre'));
  const diverged = buildSiteCard(site({ registre: '63601 AMBERT CEDEX' }), [], { precision: PRECISION });
  assert.match(diverged, /Adresse publiée par le registre : 63601 AMBERT CEDEX/);
});

test('a long practice lists a bounded number of names and says how many remain', () => {
  const many = Array.from({ length: 14 }, (_, i) => [`NOM${i}`, 'M', '01', '1', '']);
  const card = buildSiteCard(site({ practitioners: 14 }), many, { specialites: SPECIALITES, precision: PRECISION });
  const named = card.split('\n').filter((line) => line.startsWith('Dr '));
  assert.equal(named.length, 8);
  assert.match(card, /et 6 autres praticiens/);
});

test('a département card reports access before headcount', () => {
  const card = buildDepartementCard('63', 'Puy-de-Dôme', [1200, 700, 2100], [3.1, 2.8, 2.2, 640000, 464], {
    seuils: { sousDotee: 2.5, bienDotee: 4 },
  });
  const lines = card.split('\n');
  assert.equal(lines[0], 'Puy-de-Dôme');
  assert.match(lines[1], /^APL 2\.80/);
  assert.ok(lines.some((line) => line.includes('médecins')));
  assert.ok(lines.some((line) => line.includes('habitants')));
});

test('the label cohort is bounded and stable', () => {
  const entries = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, priority: i % 7 }));
  const picked = selectLabelCohort(entries);
  assert.ok(picked.length <= 14);
  assert.deepEqual(picked.map((e) => e.id), selectLabelCohort(entries).map((e) => e.id));
  assert.deepEqual(selectLabelCohort(entries, 0), []);
  assert.deepEqual(selectLabelCohort(null), []);
});

test('the paint chip switches what the choropleth carries, and reports it', () => {
  const layer = createMedecinsLayer({
    overlayHost: { setEntries() {}, clearSource() {}, setVisible() {} },
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(layer.getParams(), { paint: 'apl' });
  assert.equal(layer.setParams({}), false, 'an empty param set changes nothing');
  assert.equal(layer.setParams({ paint: 'medecins' }), true);
  assert.deepEqual(layer.getParams(), { paint: 'medecins' });
  assert.equal(layer.setParams({ paint: 'medecins' }), false, 'a no-op must report no change');
  // Anything unrecognised falls back to the honest default rather than a blank map.
  layer.setParams({ paint: 'nonsense' });
  assert.deepEqual(layer.getParams(), { paint: 'apl' });
  const { chips } = layer.getRowControls();
  assert.equal(chips.length, 2);
  assert.ok(chips.some((chip) => chip.active));
});

test('stats separate the headcount from the entry count, and never merge them', () => {
  const stats = medecinsFranceLayer.getStats();
  for (const key of ['count', 'medecins', 'entrees', 'adresses', 'aplMillesime']) {
    assert.ok(key in stats, `getStats() must publish ${key}`);
  }
  assert.equal(stats.loading, false);
});

test('two camera events on one gesture resolve to the same view', () => {
  // The real pair that sent an 800 kB box twice: `moveEnd` and `changed`
  // disagree in the twelfth decimal, which is nanometres.
  const a = { south: 48.777034637322785, west: 2.0973017726415866, north: 48.93942141340308, east: 2.31 };
  const b = { south: 48.77703463732277, west: 2.0973017726415644, north: 48.9394214134031, east: 2.31 };
  assert.equal(boxKey(a, 'sites'), boxKey(b, 'sites'));
});

test('but a view a reader could tell apart is never merged', () => {
  const a = { south: 48.7770, west: 2.0973, north: 48.9394, east: 2.31 };
  const b = { south: 48.7780, west: 2.0973, north: 48.9394, east: 2.31 };
  assert.notEqual(boxKey(a, 'sites'), boxKey(b, 'sites'));
  // 11 m is the quantum, and it must be finer than anything the site regime
  // draws — that regime caps at 0.6°, so the quantum is 1/6000th of a box.
  const c = { ...a, south: a.south + 0.0002 };
  assert.notEqual(boxKey(a, 'sites'), boxKey(c, 'sites'));
});

test('crossing a regime boundary always re-asks', () => {
  const box = { south: 45, west: 3, north: 46, east: 4 };
  assert.notEqual(boxKey(box, 'mesh'), boxKey(box, 'sites'));
  assert.notEqual(boxKey(box, 'national'), boxKey(box, 'mesh'));
});
