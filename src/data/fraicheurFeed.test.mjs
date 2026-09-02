// What the three refuge registers are allowed to CLAIM, proved against real
// captured rows.
//
// One property runs through the whole file: **an absence must never be
// presentable as a measurement, and "we do not know" must never be presentable
// as "no".** Paris publishes this data with four different spellings of
// nothing — a `0` that means "not surveyed", a `null` that means "not
// published", a `-` that means "no hours for this day", and a `Fermé` that
// means "shut" — and every one of them has a distinct correct rendering. Each
// test below closes one door a fallback value could come through: the numeric
// readers, the three-state Oui/Non fields, the timetable parser, the validity
// window, the open/closed answer, the geometry projection, and the card copy.
//
// The second property is that the layer never invents a position. A row with no
// usable geometry is counted and named, never placed at an arrondissement
// centroid and drawn as if it had been surveyed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FRAICHEUR_CANOPY_BANDS,
  FRAICHEUR_CANOPY_UNKNOWN,
  FRAICHEUR_COVERAGE,
  FRAICHEUR_DAY_KEYS,
  FRAICHEUR_DECIMALS,
  FRAICHEUR_END_OF_DAY_MIN,
  FRAICHEUR_EQUIPMENT_DATASET,
  FRAICHEUR_EQUIPMENT_FIELDS,
  FRAICHEUR_FAMILIES,
  FRAICHEUR_FOUNTAIN_DATASET,
  FRAICHEUR_FOUNTAIN_FIELDS,
  FRAICHEUR_MISTING_MODELS,
  FRAICHEUR_PUBLISHERS,
  FRAICHEUR_SPACES_DATASET,
  FRAICHEUR_SPACE_FIELDS,
  countRefReuse,
  equipmentCardLines,
  finiteOrNull,
  formatAreaM2,
  formatShare,
  fountainCardLines,
  fraicheurCanopyBand,
  fraicheurFamily,
  fraicheurFountainLabel,
  fraicheurLoadingLabel,
  openStateAt,
  openingLines,
  ouiNonNull,
  parisClock,
  parseOpeningDay,
  projectFraicheurRefuges,
  projectSpaceGeometry,
  readPoint,
  roundRing,
  scheduleIsReadable,
  scheduleValidity,
  spaceCardLines,
  summarizeFraicheurRefuges,
} from './fraicheurFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
// `toLocaleString('fr-FR')` groups with U+202F NARROW NO-BREAK SPACE, so every
// assertion against French output normalises whitespace first.
const norm = (value) => String(value).replace(/[\s ]+/g, ' ');

const SPACES = read('fraicheur-espaces-verts-sample.json');
const EQUIPMENT = read('fraicheur-equipements-sample.json');
const FOUNTAINS = read('fraicheur-fontaines-sample.json');

/** A fixed instant so "expired", "open now" and the weekday never drift. */
const NOW = Date.parse('2026-09-02T12:00:00Z'); // 14 h 00 in Paris, a Wednesday.
const PACK = projectFraicheurRefuges({
  spaces: SPACES, equipment: EQUIPMENT, fountains: FOUNTAINS, now: NOW,
});
const CLOCK = parisClock(NOW);
const spaceNamed = (fragment) => PACK.spaces.find((row) => (row.name || '').includes(fragment));

test('the fixtures are the captured rows the traps were chosen for', () => {
  assert.equal(SPACES.features.length, 21);
  assert.equal(EQUIPMENT.features.length, 21);
  assert.equal(FOUNTAINS.features.length, 20);
  // Both polygon shapes are present: the register is 584 Polygon + 400
  // MultiPolygon upstream and a projection tested on one branch is untested.
  const shapes = new Set(SPACES.features.map((feature) => feature.geometry?.type));
  assert.deepEqual([...shapes].sort(), ['MultiPolygon', 'Polygon']);
  // No fixture may name its geo field: `exports/geojson` emits the geometry
  // regardless, and naming it ships the coordinates twice — measured at
  // 81 148 B against 61 794 B on the fountains, 24 % of the wire.
  for (const fields of [FRAICHEUR_EQUIPMENT_FIELDS, FRAICHEUR_SPACE_FIELDS, FRAICHEUR_FOUNTAIN_FIELDS]) {
    assert.equal(fields.includes('geo_point_2d'), false);
    assert.equal(fields.includes('geo_shape'), false);
  }
  // The fountains are Eau de Paris, not the Ville de Paris. Merging the credit
  // would drop an attribution the ODbL requires.
  assert.equal(FRAICHEUR_PUBLISHERS[FRAICHEUR_FOUNTAIN_DATASET], 'Eau de Paris');
  assert.notEqual(
    FRAICHEUR_PUBLISHERS[FRAICHEUR_FOUNTAIN_DATASET],
    FRAICHEUR_PUBLISHERS[FRAICHEUR_EQUIPMENT_DATASET],
  );
  assert.equal(FRAICHEUR_PUBLISHERS[FRAICHEUR_SPACES_DATASET],
    FRAICHEUR_PUBLISHERS[FRAICHEUR_EQUIPMENT_DATASET]);
});

test('a published zero, an empty string and a null are three different answers', () => {
  // `Number(null)` is 0 and `Number('')` is 0, so the obvious one-liner turns an
  // unpublished `surf_veget_sup8m_2024` — absent on 65 of the 984 spaces — into
  // a park that DECLARES zero square metres of canopy.
  assert.equal(finiteOrNull(null), null);
  assert.equal(finiteOrNull(undefined), null);
  assert.equal(finiteOrNull(''), null);
  assert.equal(finiteOrNull(true), null);
  assert.equal(finiteOrNull(false), null);
  assert.equal(finiteOrNull('abc'), null);
  assert.equal(finiteOrNull(0), 0);
  assert.equal(finiteOrNull('0'), 0);
  assert.equal(finiteOrNull(0.4), 0.4);
});

test('Oui / Non / anything else stays three-state and never collapses to a boolean', () => {
  // `canicule_ouverture` is Oui 23 / Non 949 / null 12 upstream, and `dispo` is
  // the strings OUI/NON. A null coerced to false would report 12 parks as
  // declining a heatwave arrangement they never answered about.
  assert.equal(ouiNonNull('Oui'), true);
  assert.equal(ouiNonNull('OUI'), true);
  assert.equal(ouiNonNull('Non'), false);
  assert.equal(ouiNonNull('NON'), false);
  assert.equal(ouiNonNull(null), null);
  assert.equal(ouiNonNull(''), null);
  assert.equal(ouiNonNull('Peut-être'), null);
  const unanswered = PACK.spaces.find((row) => row.canicule === null);
  assert.ok(unanswered, 'the fixture must carry a row that answered nothing');
  assert.notEqual(unanswered.canicule, false);
});

test('every published equipment type is folded onto a named mechanism', () => {
  // The 12 values, verbatim from the portal facet on 2026-09-02, with the
  // counts that make the finding: 127 ombrières pérennes, 125 lieux de culte,
  // 87 brumisateurs, 65 musées, 39 piscines, 19 mairies, 17 bains-douches,
  // 16 bibliothèques, 13 terrains de boules, 12 ombrières temporaires,
  // 11 baignades extérieures, 4 découverte et initiation.
  const published = {
    'Ombrière pérenne': 'ombre',
    'Ombrière temporaire': 'ombre',
    'Lieux de culte': 'pierre',
    'Musée': 'pierre',
    "Mairie d'arrondissement": 'pierre',
    'Bibliothèque': 'pierre',
    Brumisateur: 'brume',
    Piscine: 'bain',
    'Bains-douches': 'bain',
    'Baignade extérieure': 'bain',
    'Terrain de boules': 'plein-air',
    'Découverte et Initiation': 'plein-air',
  };
  for (const [type, family] of Object.entries(published)) {
    assert.equal(fraicheurFamily(type), family, `${type} must fold onto ${family}`);
    assert.ok(FRAICHEUR_FAMILIES.includes(family));
  }
  // The register spells the apostrophe both ways; a straight-quote-only table
  // would drop 19 town halls into the residual family.
  assert.equal(fraicheurFamily('Mairie d’arrondissement'), 'pierre');
  // A church is on this list because the stone is cold, and the fold has to say
  // so rather than filing it under "amenity".
  assert.equal(fraicheurFamily('Lieux de culte'), 'pierre');
  assert.equal(fraicheurFamily(null), 'plein-air');
});

test('a canopy of exactly zero is its own band and an unpublished one is grey', () => {
  // 66 of the 984 spaces publish exactly 0 and 1 publishes nothing at all.
  // "No tall vegetation was found here" and "nobody looked" are different
  // statements and the ramp must not merge them.
  assert.equal(fraicheurCanopyBand(0).id, 'nue');
  assert.equal(fraicheurCanopyBand(null).id, FRAICHEUR_CANOPY_UNKNOWN.id);
  assert.equal(fraicheurCanopyBand(undefined).id, FRAICHEUR_CANOPY_UNKNOWN.id);
  assert.equal(fraicheurCanopyBand('').id, FRAICHEUR_CANOPY_UNKNOWN.id);
  assert.notEqual(fraicheurCanopyBand(null).id, fraicheurCanopyBand(0).id);
  // Thresholds are the measured quartiles of the 983 spaces carrying the
  // metric: p25 0.1083, p50 0.3197, p75 0.5366.
  assert.equal(fraicheurCanopyBand(0.05).id, 'rare');
  assert.equal(fraicheurCanopyBand(0.10).id, 'clairsemee');
  assert.equal(fraicheurCanopyBand(0.25).id, 'moyenne');
  assert.equal(fraicheurCanopyBand(0.40).id, 'dense');
  assert.equal(fraicheurCanopyBand(0.55).id, 'couverte');
  assert.equal(fraicheurCanopyBand(1).id, 'couverte');
  // The grey band must not be a member of the ramp — a null would otherwise be
  // indistinguishable from a real measurement on screen.
  const ramp = new Set(FRAICHEUR_CANOPY_BANDS.map((band) => band.color.toLowerCase()));
  assert.equal(ramp.has(FRAICHEUR_CANOPY_UNKNOWN.color.toLowerCase()), false);
});

test('a day with no hours is null and a day that says Fermé is an empty list', () => {
  // 187 dashes are not 187 closures. Collapsing the two would turn "the city
  // published nothing for Monday" into "this park is shut on Mondays".
  assert.equal(parseOpeningDay(null), null);
  assert.equal(parseOpeningDay('-'), null);
  assert.equal(parseOpeningDay(''), null);
  assert.deepEqual(parseOpeningDay('Fermé'), []);
  assert.deepEqual(parseOpeningDay('fermé'), []);
  // One equipment row publishes the dataset's own prose disclaimer, cut to
  // exactly 50 characters, in a weekday column. It is an absence of hours, not
  // a closure — and it is read off the fixture rather than retyped, because the
  // point of the row is the exact string the portal emitted.
  const disclaimer = EQUIPMENT.features
    .map((feature) => feature.properties.horaires_lundi)
    .find((day) => typeof day === 'string' && /^Les horaires/.test(day));
  assert.ok(disclaimer, 'the fixture must carry the prose disclaimer in a weekday column');
  assert.equal(disclaimer.length, 50);
  assert.equal(parseOpeningDay(disclaimer), null,
    'prose in a weekday column is an absence of hours, not a closure');
});

test('every published time format in either register parses, and 23h59 means midnight', () => {
  assert.deepEqual(parseOpeningDay('10h00 - 18h00'), [[600, 1080]]);
  assert.deepEqual(parseOpeningDay('10h - 20h'), [[600, 1200]]);
  assert.deepEqual(parseOpeningDay('11:00 - 18:00'), [[660, 1080]]);
  assert.deepEqual(parseOpeningDay('12h-19h'), [[720, 1140]]);
  assert.deepEqual(parseOpeningDay('10h00 -18h30'), [[600, 1110]]);
  assert.deepEqual(parseOpeningDay('9H30 - 17H'), [[570, 1020]]);
  assert.deepEqual(parseOpeningDay('10h – 18h'), [[600, 1080]]); // EN DASH U+2013
  assert.deepEqual(parseOpeningDay('8h - 11h30'), [[480, 690]]);
  assert.deepEqual(parseOpeningDay('07h00 - 08h30 / 11h30 - 13h45 / 16h45 - 22h00'),
    [[420, 510], [690, 825], [1005, 1320]]);
  // `00h00 - 23h59` is how this publisher spells "all day" — the commonest
  // single value in the green-space register, on 2 072 day-cells. Read
  // literally against a half-open interval it would shut every park in Paris
  // for the last minute of every day.
  assert.deepEqual(parseOpeningDay('00h00 - 23h59'), [[0, FRAICHEUR_END_OF_DAY_MIN]]);
  assert.equal(FRAICHEUR_END_OF_DAY_MIN, 1440);
  // A close before its open is not a window that wraps midnight, it is a bad
  // row; it is dropped rather than inverted.
  assert.equal(parseOpeningDay('20h00 - 08h00'), null);
});

test('a validity window is read, and an expired one is reported as expired', () => {
  // 682 of the 984 green spaces published a window that had already ended on
  // the day this was measured, 638 of them the same `du 01/05/26 au 31/08/26`.
  const expired = scheduleValidity('du 01/05/26 au 31/08/26', NOW);
  assert.equal(expired.kind, 'window');
  assert.equal(expired.from, '2026-05-01');
  assert.equal(expired.to, '2026-08-31');
  assert.equal(expired.expired, true);
  assert.equal(expired.pending, false);

  const live = scheduleValidity('du 31/08/26 au 06/09/26', NOW);
  assert.equal(live.expired, false);
  assert.equal(live.pending, false);

  const pending = scheduleValidity('du 01/12/26 au 31/12/26', NOW);
  assert.equal(pending.pending, true);
  assert.equal(pending.expired, false);

  const openEnded = scheduleValidity('à partir du 01/02/26', NOW);
  assert.equal(openEnded.kind, 'open-ended');
  assert.equal(openEnded.to, null);
  assert.equal(openEnded.expired, false);

  // Free text is carried verbatim, not discarded: it is a real caveat on 124
  // equipment rows.
  const prose = scheduleValidity("Horaires d'ouvertures du parc", NOW);
  assert.equal(prose.kind, 'prose');
  assert.equal(prose.text, "Horaires d'ouvertures du parc");
  assert.equal(prose.expired, false);

  assert.equal(scheduleValidity(null, NOW).kind, 'none');
  assert.equal(scheduleValidity('', NOW).kind, 'none');
});

test('unknown is never dressed up as closed', () => {
  // 423 of the 535 equipment rows and 214 of the 984 green spaces publish no
  // readable weekday hours. "We do not know" and "it is shut" send an operator
  // to different places.
  const nothing = openStateAt({ days: [null, null, '-', null, null, null, null] }, CLOCK);
  assert.equal(nothing.state, 'unknown');
  assert.equal(nothing.interval, null);

  // Wednesday is index 2, Monday-first, and the clock is at 14 h 00.
  const days = [null, null, '10h00 - 18h00', null, null, null, null];
  const open = openStateAt({ days }, { dow: 2, minutes: 840 });
  assert.equal(open.state, 'open');
  assert.deepEqual(open.interval, [600, 1080]);

  const beforeOpening = openStateAt({ days }, { dow: 2, minutes: 400 });
  assert.equal(beforeOpening.state, 'closed');
  assert.equal(beforeOpening.opensAt, 600);
  assert.equal(beforeOpening.opensDay, 2);

  // A park shut today and open on Thursday says Thursday rather than just
  // "fermé": the next day that publishes anything at all, up to a week out.
  const afterClosing = openStateAt({ days: [null, null, '10h00 - 12h00', '09h00 - 17h00', null, null, null] },
    { dow: 2, minutes: 840 });
  assert.equal(afterClosing.state, 'closed');
  assert.equal(afterClosing.opensDay, 3);
  assert.equal(afterClosing.opensAt, 540);

  // `ouvert_24h` short-circuits the timetable, and that is a STATED choice: the
  // flag and the seven strings disagree on 244 of the 984 spaces.
  const always = openStateAt({ days: [null, null, 'Fermé', null, null, null, null] },
    { dow: 2, minutes: 840 }, { always: true });
  assert.equal(always.state, 'open');
});

test('Paris time is Europe/Paris, whatever the machine reading it is set to', () => {
  // This layer answers "what is open right now" about ONE city. An operator in
  // Denver reading a Paris timetable against Mountain Time would be shown a
  // park as open eight hours after it shut.
  const summer = parisClock(Date.parse('2026-07-01T12:00:00Z')); // CEST, UTC+2
  assert.equal(summer.hhmm.replace(/\s+/g, ''), '14h00');
  const winter = parisClock(Date.parse('2026-01-15T12:00:00Z')); // CET, UTC+1
  assert.equal(winter.hhmm.replace(/\s+/g, ''), '13h00');
  // Monday-first, because that is the order the register publishes its seven
  // weekday columns in; `Date#getDay()` is Sunday-first.
  assert.equal(parisClock(Date.parse('2026-08-31T10:00:00Z')).dow, 0); // Monday
  assert.equal(parisClock(Date.parse('2026-09-06T10:00:00Z')).dow, 6); // Sunday
  assert.equal(FRAICHEUR_DAY_KEYS[0], 'horaires_lundi');
  assert.equal(FRAICHEUR_DAY_KEYS[6], 'horaires_dimanche');
  // ICU builds that render midnight as `24` would put the clock at minute 1440
  // of the previous day.
  const midnight = parisClock(Date.parse('2026-07-01T22:00:00Z'));
  assert.equal(midnight.minutes, 0);
  assert.equal(midnight.hhmm.replace(/\s+/g, ''), '00h00');
});

test('rounding a ring to a metre keeps the shape and drops only the duplicates', () => {
  assert.equal(FRAICHEUR_DECIMALS, 5); // 1.11 m of latitude, 0.73 m of longitude at 48.86° N.
  const ring = roundRing([
    [2.3000000000000001, 48.860000000000001],
    [2.30000004, 48.86000004], // sub-millimetre noise: collapses onto its neighbour
    [2.31, 48.87],
    [null, 48.87],
    [2.32, 'x'],
  ]);
  assert.deepEqual(ring, [[2.3, 48.86], [2.31, 48.87]]);
  assert.deepEqual(roundRing(null), []);

  // Both geometry branches, because the register is 584 Polygon + 400
  // MultiPolygon and a projection tested on one is untested.
  const polygon = SPACES.features.find((feature) => feature.geometry.type === 'Polygon');
  const multi = SPACES.features.find((feature) => feature.geometry.type === 'MultiPolygon');
  assert.ok(projectSpaceGeometry(polygon.geometry).parts.length >= 1);
  assert.ok(projectSpaceGeometry(multi.geometry).parts.length >= 1);
  assert.deepEqual(projectSpaceGeometry(null).parts, []);
  assert.deepEqual(projectSpaceGeometry({ type: 'Point', coordinates: [2, 48] }).parts, []);

  // A ring that cannot make a triangle at one metre is a sliver under a metre
  // across. It is dropped and COUNTED — never silently.
  assert.ok(PACK.geometry.droppedRings > 0, 'the fixture must exercise the sliver path');
  assert.equal(PACK.geometry.sourceVertices, 2167);
  assert.equal(PACK.geometry.keptVertices, 1063);
  assert.ok(PACK.geometry.keptVertices < PACK.geometry.sourceVertices);
  // Interior rings are kept: 1 214 of them across 263 of the 984 spaces
  // upstream. A park drawn without its holes swallows what the city carved out.
  assert.ok(PACK.geometry.withHoles > 0);
  assert.ok(PACK.geometry.multipart > 0);
});

test('a coordinate is never invented, and null island is refused', () => {
  assert.deepEqual(readPoint({ type: 'Point', coordinates: [2.34567891, 48.85678912] }), [2.34568, 48.85679]);
  assert.equal(readPoint(null), null);
  assert.equal(readPoint({ type: 'Polygon', coordinates: [] }), null);
  assert.equal(readPoint({ type: 'Point', coordinates: [null, 48] }), null);
  // The one bad coordinate that draws silently and convincingly, in the Gulf
  // of Guinea.
  assert.equal(readPoint({ type: 'Point', coordinates: [0, 0] }), null);
  assert.equal(readPoint({ type: 'Point', coordinates: [2, 91] }), null);
  // All 535 equipment rows and all 1 323 fountains carry a real coordinate, so
  // nothing in the fixture is unplaced — and if that ever changes, it is
  // COUNTED rather than moved to a centroid.
  assert.deepEqual(PACK.unplaced, { spaces: 0, equipment: 0, fountains: 0 });
  for (const row of [...PACK.equipment, ...PACK.fountains]) {
    assert.ok(Number.isFinite(row.p[0]) && Number.isFinite(row.p[1]));
    assert.ok(row.p[0] >= FRAICHEUR_COVERAGE.west && row.p[0] <= FRAICHEUR_COVERAGE.east);
    assert.ok(row.p[1] >= FRAICHEUR_COVERAGE.south && row.p[1] <= FRAICHEUR_COVERAGE.north);
  }
});

test('a published identifier that is not a key does not merge two sites into one', () => {
  // `identifiant` is a key on neither register: MU75 is both the Maison
  // Européenne de la Photographie and Le CENTQUATRE, and the green spaces
  // publish 24 rows with no identifier at all.
  const ids = PACK.spaces.map((row) => row.id)
    .concat(PACK.equipment.map((row) => row.id), PACK.fountains.map((row) => row.id));
  assert.equal(new Set(ids).size, ids.length, 'every render id is unique');
  assert.equal(PACK.refReuse.equipment.values, 1);
  assert.equal(PACK.refReuse.equipment.rows, 2);
  assert.equal(PACK.refReuse.spaces.values, 1);
  assert.equal(PACK.refReuse.spaces.missing, 2, 'rows with no published identifier are counted');
  const mu75 = PACK.equipment.filter((row) => row.ref === 'MU75');
  assert.equal(mu75.length, 2, 'both MU75 rows survive');
  assert.notEqual(mu75[0].name, mu75[1].name);
  assert.notEqual(mu75[0].id, mu75[1].id);
  // The counter is a pure function of the rows and reports both halves.
  assert.deepEqual(countRefReuse([{ ref: 'a' }, { ref: 'a' }, { ref: null }]),
    { values: 1, rows: 2, missing: 1 });
  assert.deepEqual(countRefReuse(null), { values: 0, rows: 0, missing: 0 });
});

test('a missing register degrades the pack rather than failing it', () => {
  // Losing the fountains costs 1 323 taps and keeps 984 parks. The summary
  // says which of the three answered, so the row can say so too.
  const partial = projectFraicheurRefuges({ spaces: SPACES, equipment: null, fountains: null, now: NOW });
  assert.deepEqual(partial.available, { spaces: true, equipment: false, fountains: false });
  assert.equal(partial.equipment.length, 0);
  assert.equal(partial.fountains.length, 0);
  assert.equal(partial.spaces.length, 21);
  const nothing = projectFraicheurRefuges({ now: NOW });
  assert.deepEqual(nothing.available, { spaces: false, equipment: false, fountains: false });
  assert.equal(nothing.summary.spaces, 0);
  assert.equal(nothing.summary.canicule, 0);
});

test('the summary counts the heatwave asymmetry and the canopy behind it', () => {
  const summary = PACK.summary;
  assert.equal(summary.spaces, 21);
  assert.equal(summary.equipment, 21);
  assert.equal(summary.fountains, 20);
  // The finding, at fixture scale: two heatwave spaces, one of them with no
  // measured canopy at all. Upstream it is 23 of 984, eleven of them at zero.
  assert.equal(summary.canicule, 2);
  assert.equal(summary.caniculeWithoutCanopy, 1);
  assert.equal(summary.spacesExpired, 11);
  assert.equal(summary.spacesReadable, 12);
  assert.equal(summary.equipmentReadable, 11);
  assert.equal(summary.equipmentUnknownNow, 10);
  assert.equal(summary.fountainsAvailable, 15);
  assert.equal(summary.fountainsOut, 5);
  // An outage whose own end date has already passed while `dispo` still says
  // NON — the tap may well be running.
  assert.equal(summary.fountainsStaleOutage, 1);
  assert.equal(summary.misting, 3);
  assert.equal(summary.fountainsOutsideParis, 4);
  assert.equal(summary.canopyM2Missing, 4);
  // Bands and families are exhaustive: nothing may fall through unbanded.
  const banded = summary.canopyBands.reduce((sum, band) => sum + band.count, 0);
  assert.equal(banded, summary.spaces);
  const familied = summary.families.reduce((sum, family) => sum + family.count, 0);
  assert.equal(familied, summary.equipment);
});

test('the open-now answer moves with the clock rather than with the fetch', () => {
  const rows = { spaces: PACK.spaces, equipment: PACK.equipment, fountains: PACK.fountains };
  const afternoon = summarizeFraicheurRefuges(rows, { now: Date.parse('2026-09-02T12:00:00Z') });
  const night = summarizeFraicheurRefuges(rows, { now: Date.parse('2026-09-02T23:30:00Z') });
  assert.equal(afternoon.clock.hhmm.replace(/\s+/g, ''), '14h00');
  assert.equal(night.clock.hhmm.replace(/\s+/g, ''), '01h30');
  assert.ok(afternoon.spacesOpenNow > night.spacesOpenNow,
    'the count of open spaces must fall overnight, or the clock is not being read');
  assert.equal(night.equipmentOpenNow, 0);
  // "Unknown" is stable across the day — it is a property of the register, not
  // of the hour — so an answer that moved with the clock would be a bug.
  assert.equal(afternoon.equipmentUnknownNow, night.equipmentUnknownNow);
});

test('a card built from an expired timetable carries the expiry on the same line', () => {
  const space = spaceNamed('SQUARE D’ANVERS') || spaceNamed('ANVERS');
  assert.ok(space, 'the fixture must carry SQUARE D’ANVERS');
  const card = spaceCardLines(space, CLOCK, NOW);
  const text = norm(card.details.join(' | '));
  assert.match(text, /période expirée/);
  assert.match(text, /du 01\/05\/26 au 31\/08\/26/);
  // Both vegetation numbers, never one and never an average: the register
  // publishes 0.10921619 and 0.12799286 for this same park.
  assert.match(text, /Canopée > 8 m/);
  assert.match(text, /végétation haute/);
  assert.match(text, /pas une correction/);
});

test('a heatwave space with no measured canopy says both things at once', () => {
  const hot = PACK.spaces.find((row) => row.canicule === true && row.canopy === 0);
  assert.ok(hot, 'the fixture must carry a heatwave space with zero canopy');
  const text = norm(spaceCardLines(hot, CLOCK, NOW).details.join(' | '));
  assert.match(text, /Ouverture canicule déclarée/);
  assert.match(text, /0 % de canopée mesurée/);
});

test('a space that publishes no canopy index is not reported as bare ground', () => {
  const unknown = PACK.spaces.find((row) => row.canopy === null);
  assert.ok(unknown, 'the fixture must carry a space with no published index');
  assert.equal(unknown.band, FRAICHEUR_CANOPY_UNKNOWN.id);
  const text = norm(spaceCardLines(unknown, CLOCK, NOW).details.join(' | '));
  assert.match(text, /non mesurée au relevé 2024/);
  assert.equal(/0 % du sol/.test(text), false, 'an absent measurement is never printed as 0 %');
});

test('a site with no readable hours is never told it is closed', () => {
  const silent = PACK.equipment.find((row) => !scheduleIsReadable(row.schedule) && row.open24 !== true);
  assert.ok(silent, 'the fixture must carry a site with no readable hours');
  const text = norm(equipmentCardLines(silent, CLOCK, NOW).details.join(' | '));
  assert.match(text, /Aucun horaire hebdomadaire publié/);
  assert.equal(/Fermé maintenant/.test(text), false);
  // `statut_ouverture` is null on 508 of the 535 rows, so it is printed only
  // when it says something — and "Eteint" on a mister is worth a line.
  const mister = PACK.equipment.find((row) => row.status === 'Eteint');
  assert.ok(mister, 'the fixture must carry a mister with a published status');
  assert.match(norm(equipmentCardLines(mister, CLOCK, NOW).details.join(' | ')), /Statut publié : Eteint/);
});

test('a fountain outage that has outlived its own end date says so', () => {
  const stale = PACK.fountains.find((row) => row.available === false
    && row.to && Date.parse(row.to) < NOW);
  assert.ok(stale, 'the fixture must carry an outage whose end date has passed');
  const text = norm(fountainCardLines(stale, NOW).details.join(' | '));
  assert.match(text, /la fin d’indisponibilité publiée est déjà passée/);
  assert.match(text, /Eau de Paris/);
  const live = PACK.fountains.find((row) => row.available === false
    && row.to && Date.parse(row.to) > NOW);
  assert.ok(live);
  assert.match(norm(fountainCardLines(live, NOW).details.join(' | ')), /Hors service/);
});

test('the truncated fountain codes are mapped, never printed raw', () => {
  // `type_objet` is capped at 15 characters upstream and the long values are
  // ELIDED, not truncated: FONTAINE_WALLACE arrives as FONTNE_WALLACE.
  assert.equal(fraicheurFountainLabel('FONTNE_WALLACE'), 'Fontaine Wallace');
  assert.equal(fraicheurFountainLabel('FTNE_PETILLANTE'), 'Fontaine pétillante');
  assert.equal(fraicheurFountainLabel('FTNE_POING_EAU'), 'Fontaine « poing d’eau »');
  assert.equal(fraicheurFountainLabel('FTNE_MILLENAIRE'), 'Fontaine du Millénaire');
  assert.equal(fraicheurFountainLabel('FONTAINE_ALBIEN'), 'Puits de l’Albien');
  for (const fountain of PACK.fountains) {
    assert.equal(/_/.test(fountainCardLines(fountain, NOW).title), false,
      `${fountain.kind} must not reach a card as an upstream code`);
  }
  // An unknown code is printed as published rather than guessed at.
  assert.equal(fraicheurFountainLabel('FTNE_INCONNUE'), 'FTNE_INCONNUE');
  assert.equal(fraicheurFountainLabel(null), 'Fontaine');
  // The three misting models are named because the 72 fountains that carry
  // them are NOT among the 87 brumisateurs of the other register.
  assert.equal(FRAICHEUR_MISTING_MODELS.length, 3);
  assert.ok(PACK.fountains.some((row) => row.misting === true));
});

test('the opening line never claims a time it did not read', () => {
  const alwaysOpen = { schedule: { periode: null, days: [] }, open24: true };
  assert.match(norm(openingLines(alwaysOpen, CLOCK, NOW)[0]), /Ouvert 24 h\/24/);
  const unknown = { schedule: { periode: null, days: [null, null, null, null, null, null, null] } };
  assert.match(openingLines(unknown, CLOCK, NOW)[0], /Aucun horaire hebdomadaire publié/);
  const lines = openingLines(
    { schedule: { periode: 'du 01/05/26 au 31/08/26', days: [null, null, '10h00 - 18h00', null, null, null, null] } },
    { dow: 2, minutes: 840, day: 'mercredi' }, NOW,
  );
  assert.match(norm(lines[0]), /Ouvert maintenant/);
  assert.match(norm(lines[1]), /période expirée/);
});

test('the row label leads with the clock and always names what it cannot answer', () => {
  assert.equal(fraicheurLoadingLabel({ status: 'loading' }), 'lecture des trois registres parisiens…');
  assert.match(fraicheurLoadingLabel({ status: 'off-coverage' }), /Hors Paris/);
  assert.equal(fraicheurLoadingLabel({}), null);
  const label = norm(fraicheurLoadingLabel({
    status: 'ready', summary: PACK.summary, drawn: 62, treeStatus: 'too-dense', treeTotal: 10571,
  }));
  assert.match(label, /ouverts à \d{2} h \d{2} \(heure de Paris\)/);
  assert.match(label, /sans horaire lisible/);
  assert.match(label, /horaires expirés/);
  assert.match(label, /10 571 arbres ici — zoome/);
  assert.equal(/live|temps réel/i.test(label), false);
});

test('the French formatters round the way a card reads', () => {
  assert.equal(norm(formatAreaM2(4231)), '4 231 m²');
  assert.equal(norm(formatAreaM2(10000)), '1 ha');
  assert.equal(formatAreaM2(null), null);
  assert.equal(formatAreaM2(''), null);
  assert.equal(norm(formatShare(0.32)), '32 %');
  assert.equal(norm(formatShare(0)), '0 %');
  assert.equal(formatShare(null), null);
});
