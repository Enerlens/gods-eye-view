// src/data/edfPowerPlants.test.mjs
// Covers the EDF fleet LAYER: the capacity→area size ramp, the label that says
// what each site is, the vintage range the layer must not collapse, and the
// lifecycle. The upstream dataset shape is pinned separately in
// edfPlantsFeed.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  EDF_PLANTS_OVERLAY_COHORT_LIMIT,
  EDF_PLANTS_OVERLAY_COLLISION_CAPACITY,
  FILIERE_STYLES,
  PLANT_PIXEL_MAX,
  PLANT_PIXEL_MIN,
  buildPlantRecords,
  createEdfPowerPlantsLayer,
  filiereLegend,
  filterPlants,
  normalizePlantFilter,
  plantFilterChips,
  plantKindBuckets,
  plantKindChip,
  formatMegawatts,
  mapAnalystRecord,
  plantColor,
  plantKindText,
  plantLabelText,
  plantPixelSize,
  referenceDateRange,
  selectPlantOverlayCohort,
  summarizePlants,
  EDF_PLANTS_LAYER_ID,
  EDF_PLANTS_SELECTED_OVERLAY_SOURCE_ID,
  EDF_PLANTS_SELECTED_OVERLAY_SOURCE_OPTIONS,
  EDF_SELECTED_COLOR,
  buildEdfPlantCard,
  createPlantOverlayEntry,
  commissioningText,
  createEdfSelectedOverlayEntry,
} from './edfPowerPlants.js';
import { projectEdfPlants } from './edfPlantsFeed.js';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`./fixtures/edf-plants-${name}.json`, import.meta.url),
  'utf8',
));

/**
 * The proxy's own output, built from the captured EDF bodies through the real
 * projection — so this suite cannot drift from what the proxy actually serves.
 */
const PROJECTED = projectEdfPlants({
  nucleaire: { meta: fixture('nucleaire-dataset'), lines: fixture('nucleaire-sample') },
  hydraulique: { meta: fixture('hydraulique-dataset'), lines: fixture('hydraulique-sample') },
  thermique: { meta: fixture('thermique-dataset'), lines: fixture('thermique-sample') },
}, 'test');

const PAYLOAD = {
  fetchedAt: 1_772_000_000_000,
  stale: false,
  ttlMs: 86_400_000,
  source: PROJECTED.source,
  sites: PROJECTED.sites,
  datasets: PROJECTED.datasets,
  totals: PROJECTED.totals,
};

const RECORDS = buildPlantRecords(PAYLOAD);
const record = (id) => RECORDS.find((entry) => entry.id === id);

// ── Capacity is carried by AREA ─────────────────────────────────────────────

test('a mark four times the capacity is twice as wide, above the floor', () => {
  const small = plantPixelSize(100) - PLANT_PIXEL_MIN;
  const large = plantPixelSize(400) - PLANT_PIXEL_MIN;
  assert.ok(Math.abs(large - small * 2) < 1e-9, 'the side must follow the square root');
});

test('the smallest plant is still visible and the largest still fits', () => {
  // Grandval, 74.1 MW, is the smallest plant the hydro file publishes.
  assert.ok(plantPixelSize(74.1) > PLANT_PIXEL_MIN);
  assert.ok(plantPixelSize(74.1) < 17);
  // Gravelines, 5 460 MW, saturates rather than growing without bound — and so
  // does Paluel at 5 320, which is what "the two largest sites in France both
  // draw at the cap" means: the ramp did not simply move under the new floor.
  assert.equal(plantPixelSize(5460), PLANT_PIXEL_MAX);
  assert.equal(plantPixelSize(5320), PLANT_PIXEL_MAX);
  assert.ok(plantPixelSize(4000) < PLANT_PIXEL_MAX, 'saturation must not swallow the fleet');
  // A site with no published capacity gets the floor, never a guess.
  assert.equal(plantPixelSize(null), PLANT_PIXEL_MIN);
  assert.equal(plantPixelSize(0), PLANT_PIXEL_MIN);
  assert.equal(plantPixelSize(-5), PLANT_PIXEL_MIN);
});

test('the floor is big enough for a silhouette, not just for a dot', () => {
  // The mark stopped being a disc and became a shape, and a shape has a size
  // below which it is a smudge. 13 px is that floor; the trefoil punched
  // through the nuclear cooling tower is the detail that sets it.
  assert.ok(PLANT_PIXEL_MIN >= 13, 'a silhouette needs a raster it can occupy');
  assert.ok(PLANT_PIXEL_MAX / PLANT_PIXEL_MIN > 2, 'the ramp must still be a ramp');
});

test('an unknown filière is drawn neutral rather than assigned a fuel', () => {
  assert.equal(
    plantColor('nucleaire').toCssColorString(),
    Cesium.Color.fromCssColorString(FILIERE_STYLES.nucleaire.color).toCssColorString(),
  );
  const unknown = plantColor('géothermie').toCssColorString();
  for (const style of Object.values(FILIERE_STYLES)) {
    assert.notEqual(unknown, Cesium.Color.fromCssColorString(style.color).toCssColorString());
  }
  assert.equal(plantColor(null).toCssColorString(), unknown);
});

// ── The label says what the object is ───────────────────────────────────────

test('a label names the site, its installed power and what it actually is', () => {
  // THE SHORT PLAIN REGISTER, not the publisher's part number: this string is
  // painted on the globe, and `6 × REP 900` is not something a reader can read.
  assert.equal(plantLabelText(record('nucleaire:GRAVELINES')), 'GRAVELINES · 5 460 MW · 6 réacteurs');
  assert.equal(plantLabelText(record('hydraulique:GRAND-MAISON')), 'GRAND-MAISON · 1 714 MW · pompage-turbinage mixte');
  assert.equal(plantLabelText(record('thermique:CORDEMAIS')), 'CORDEMAIS · 1 160 MW · 2 unités au charbon');
  assert.equal(plantLabelText(record('thermique:BOUCHAIN')), 'BOUCHAIN · 585 MW · unité au gaz');
  assert.equal(plantLabelText(record('hydraulique:RANCE')), 'RANCE · 240 MW · marémotrice');
});

test('the publisher’s own string survives, one argument away', () => {
  // Translating the vocabulary must not lose it: a data-quality reader still
  // has to be able to see what EDF actually wrote in the file.
  const gravelines = record('nucleaire:GRAVELINES');
  assert.equal(plantKindText(gravelines, { register: 'raw' }), '6 × REP 900');
  assert.equal(plantKindText(record('thermique:CORDEMAIS'), { register: 'raw' }), '2 × Charbon');
  assert.equal(plantKindText(record('hydraulique:GRAND-MAISON'), { register: 'raw' }), 'Pompage mixte');
  // An unknown code is passed through rather than dropped or guessed at — and
  // NOT inflected: `2 EPR2s` would be French grammar applied to a part number.
  assert.equal(plantKindText({ filiere: 'nucleaire', kind: 'EPR2', units: 2 }), '2 × EPR2');
  assert.equal(plantKindText({ filiere: 'nucleaire', kind: 'EPR2' }), 'EPR2');
});

test('a hydro plant is never labelled with an invented unit count', () => {
  // The file publishes no turbine count, so the label carries the regime alone.
  assert.equal(plantKindText(record('hydraulique:BATHIE (LA)')), 'retenue de lac');
  assert.equal(
    plantKindText({ filiere: 'nucleaire', kind: 'REP 1450', units: 2 }),
    '2 réacteurs à eau pressurisée de 1 450 MW',
  );
  // A single unit is stated once, not as "1 ×", and stays singular.
  assert.equal(plantKindText({ filiere: 'thermique', kind: 'Gaz naturel', units: 1 }), 'unité au gaz naturel');
  // A site whose file names no kind falls back to its filière, never to a guess.
  assert.equal(plantKindText({ filiere: 'thermique', kind: null }), 'Thermique à flamme');
  assert.equal(plantKindText({}), 'Centrale');
});

test('megawatts are grouped for reading and rounded only for display', () => {
  assert.equal(formatMegawatts(5460), '5 460 MW');
  assert.equal(formatMegawatts(132.27), '132 MW');
  assert.equal(formatMegawatts(80093.96), '80 094 MW');
  assert.equal(formatMegawatts(null), '— MW');
  assert.equal(formatMegawatts(Number.NaN), '— MW');
  // The grouping separator is a plain space, so the overlay can measure it.
  assert.ok(!/[\u00a0\u202f]/.test(formatMegawatts(5460)));
});

// ── What is drawn, and in what order ────────────────────────────────────────

test('a site with no usable position is dropped rather than placed anywhere', () => {
  const built = buildPlantRecords({
    sites: [
      { id: 'a:1', name: 'A', filiere: 'nucleaire', lat: 47, lon: 2, mw: 100 },
      { id: 'b:2', name: 'B', filiere: 'nucleaire', lat: null, lon: 2, mw: 100 },
      { id: 'c:3', name: '', filiere: 'nucleaire', lat: 47, lon: 2, mw: 100 },
      { id: '', name: 'D', filiere: 'nucleaire', lat: 47, lon: 2, mw: 100 },
    ],
  });
  assert.deepEqual(built.map((entry) => entry.id), ['a:1']);
  assert.deepEqual(buildPlantRecords(null), []);
  assert.deepEqual(buildPlantRecords({ sites: 'nope' }), []);
});

test('the biggest disc is drawn last, so it cannot hide under a smaller one', () => {
  const capacities = RECORDS.map((entry) => entry.mw);
  assert.deepEqual(capacities, [...capacities].sort((a, b) => a - b));
  assert.equal(RECORDS.at(-1).id, 'nucleaire:GRAVELINES');
});

test('the row totals are recomputed from what is on the globe', () => {
  const summary = summarizePlants(RECORDS);
  assert.equal(summary.sites, 11);
  assert.equal(summary.capacityMw, 13489.47);
  assert.equal(summary.byFiliere.nucleaire.capacityMw, 8450);
  assert.equal(summary.byFiliere.hydraulique.capacityMw, 2924.47);
  assert.equal(summary.byFiliere.thermique.capacityMw, 2115);
  // Hydro publishes no unit count, so the layer reports none for it.
  assert.equal(summary.byFiliere.hydraulique.units, null);
  assert.equal(summary.units, 13);
});

test('the operator is collected as a set, not read off one arbitrary site', () => {
  assert.deepEqual(summarizePlants(RECORDS).operators, ['EDF SA']);
  // A second operator widens the caveat rather than hiding behind the first.
  assert.deepEqual(
    summarizePlants([{ operator: 'EDF SA' }, { operator: 'CNR' }, { operator: 'EDF SA' }]).operators,
    ['EDF SA', 'CNR'],
  );
  assert.deepEqual(summarizePlants([{}]).operators, []);
});

test('the legend names each filière, its site count and its installed total', () => {
  const legend = filiereLegend(summarizePlants(RECORDS));
  assert.deepEqual(legend.map((entry) => entry.label), ['Nucléaire', 'Hydraulique', 'Thermique à flamme']);
  assert.deepEqual(legend.map((entry) => entry.count), [2, 6, 3]);
  assert.match(legend[0].blurb, /8 450 MW installés, 8 réacteurs/);
  // Hydro has no unit noun, so its blurb claims no unit count.
  assert.doesNotMatch(legend[1].blurb, /réacteur|unité/);
  // `unité` and not EDF's own `tranche`, which outside a control room is a
  // slice of bread — see the note on FILIERE_STYLES.
  assert.match(legend[2].blurb, /5 unités/);
  // A filière with nothing drawn gets no legend entry at all.
  assert.deepEqual(filiereLegend(summarizePlants([])), []);
});

// ── The filter: two levels, and the second one waits ────────────────────────

test('the sub-categories of one filière are derived, never hard-coded', () => {
  // Built from the RENDERED records, so a button can never offer a category
  // with nothing behind it, and a value EDF starts publishing tomorrow gets a
  // button without a code change.
  const hydro = plantKindBuckets(RECORDS, 'hydraulique');
  assert.deepEqual(hydro.map((bucket) => bucket.label),
    ['LAC', 'POMPAGE MIXTE', 'MARÉMOTRICE', 'FIL DE L’EAU']);
  // Biggest cohort first, then installed power: three lakes beat one 1 714 MW
  // pumped-storage plant, and the Rance's 240 MW beats Kembs' 162.
  assert.deepEqual(hydro.map((bucket) => bucket.sites), [3, 1, 1, 1]);
  assert.equal(hydro[0].capacityMw, 808.37);
  // One site each, so the tiebreak is installed power: Gravelines' 5 460 MW
  // puts the 900 MW palier ahead of Civaux's 2 990. The order is total, so the
  // strip cannot reshuffle itself between two repaints of the same fleet.
  assert.deepEqual(plantKindBuckets(RECORDS, 'nucleaire').map((b) => b.label),
    ['900 MW', '1 450 MW']);
  assert.deepEqual(plantKindBuckets(RECORDS, null), []);
  assert.deepEqual(plantKindBuckets(null, 'nucleaire'), []);
});

test('a published code with no plain word still gets a button', () => {
  // The same refusal to invent `plantKindPlain` makes one register up: an
  // unknown code is printed as EDF wrote it rather than dropped or guessed at.
  assert.equal(plantKindChip('REP 900'), '900 MW');
  assert.equal(plantKindChip('EPR2'), 'EPR2');
  // A site whose file names no kind buckets under a button that says so,
  // rather than falling out of its own filière.
  assert.equal(plantKindChip(null), 'NON PRÉCISÉ');
  assert.equal(plantKindChip('  '), 'NON PRÉCISÉ');
});

test('a kind means nothing without the filière whose column publishes it', () => {
  // `Charbon` and `Lac` are values of two DIFFERENT published columns. A kind
  // that arrived without a filière used to be applicable across the fleet,
  // which is a filter that can only ever match by coincidence.
  assert.deepEqual(normalizePlantFilter({ kind: 'Lac' }), { filiere: null, kind: null });
  assert.deepEqual(normalizePlantFilter({ filiere: 'géothermie', kind: 'Lac' }),
    { filiere: null, kind: null });
  assert.deepEqual(normalizePlantFilter({ filiere: 'hydraulique', kind: 'Lac' }),
    { filiere: 'hydraulique', kind: 'Lac' });
  assert.deepEqual(normalizePlantFilter(null), { filiere: null, kind: null });
});

test('a filter keeps its own cohort and nothing else', () => {
  assert.equal(filterPlants(RECORDS, null).length, RECORDS.length);
  assert.equal(filterPlants(RECORDS, { filiere: 'hydraulique' }).length, 6);
  const lakes = filterPlants(RECORDS, { filiere: 'hydraulique', kind: 'Lac' });
  assert.deepEqual(lakes.map((entry) => entry.name).sort(),
    ['BATHIE (LA)', 'GRANDVAL', 'SAINTE-CROIX']);
  // The fleet array is never mutated: the filter hands back a new list and the
  // whole register stays behind it, so clearing costs no refetch.
  assert.notEqual(filterPlants(RECORDS, null), RECORDS);
  assert.equal(RECORDS.length, 11);
});

test('the sub-categories are NOT offered until a filière has been chosen', () => {
  // THE WHOLE POINT OF THE SECOND LEVEL. Thirteen published kinds under three
  // filières is sixteen buttons on a row that is four lines tall before the
  // reader has asked anything — so the strip carries the filières, and a
  // filière's own categories appear once that filière is the one being read.
  const closed = plantFilterChips(RECORDS, { filiere: null, kind: null });
  assert.deepEqual(closed.map((chip) => chip.label),
    ['TOUTES', 'NUCLÉAIRE', 'HYDRAULIQUE', 'THERMIQUE']);
  assert.equal(closed.filter((chip) => chip.chipClass === 'chip-sub').length, 0);
  assert.equal(closed.find((chip) => chip.label === 'TOUTES').active, true);

  const open = plantFilterChips(RECORDS, { filiere: 'hydraulique', kind: null });
  assert.deepEqual(open.map((chip) => chip.label), [
    'TOUTES', 'NUCLÉAIRE', 'HYDRAULIQUE', 'THERMIQUE',
    'TOUS', 'LAC', 'POMPAGE MIXTE', 'MARÉMOTRICE', 'FIL DE L’EAU',
  ]);
  // Only the sub-categories of the filière that is open — never a second
  // filière's, which is what makes this a drill-down and not a longer strip.
  for (const chip of open.filter((entry) => entry.chipClass === 'chip-sub')) {
    assert.equal(chip.params.filiere, 'hydraulique');
  }
  assert.equal(open.find((chip) => chip.label === 'HYDRAULIQUE').active, true);
  assert.equal(open.find((chip) => chip.label === 'TOUTES').active, false);
  assert.equal(open.find((chip) => chip.label === 'TOUS').active, true);
});

test('a filière with one published kind is offered no choice at all', () => {
  // A single bucket is not a choice: the button could only ever reselect what
  // is already on screen, and it would still cost a line of the panel.
  const single = RECORDS.filter((entry) => entry.filiere === 'nucleaire' && entry.kind === 'REP 900');
  const chips = plantFilterChips(single, { filiere: 'nucleaire', kind: null });
  assert.equal(chips.filter((chip) => chip.chipClass === 'chip-sub').length, 0);
  // And a fleet that has not loaded yet offers nothing rather than an empty
  // strip of buttons that answer no question.
  assert.deepEqual(plantFilterChips([], { filiere: null, kind: null }), []);
});

test('a second click on the chip that is lit is the way back out', () => {
  // There is always an escape that does not require finding the reset — and at
  // the sub-category level there IS no reset except `TOUS`, which is one chip
  // away from four others that all look like it.
  const open = plantFilterChips(RECORDS, { filiere: 'hydraulique', kind: 'Lac' });
  const filiere = open.find((chip) => chip.label === 'HYDRAULIQUE');
  assert.deepEqual(filiere.params, { filiere: null, kind: null });
  const kind = open.find((chip) => chip.label === 'LAC');
  assert.equal(kind.active, true);
  assert.deepEqual(kind.params, { filiere: 'hydraulique', kind: null });
  // A chip that is NOT lit selects; only the lit one clears.
  const other = open.find((chip) => chip.label === 'MARÉMOTRICE');
  assert.deepEqual(other.params, { filiere: 'hydraulique', kind: 'Marémotrice' });
  // Choosing another filière drops the kind with it: it was a value of the old
  // filière's column and means nothing under the new one.
  assert.deepEqual(open.find((chip) => chip.label === 'THERMIQUE').params,
    { filiere: 'thermique', kind: null });
});

test('every chip says what it will do, and with how many sites', () => {
  // The title is where the honest sentence lives — `900 MW` on a button is the
  // reactor family's unit power and NOT the site's, and nothing on an 8 px chip
  // can say so.
  const chips = plantFilterChips(RECORDS, { filiere: 'nucleaire', kind: null });
  assert.match(chips[0].title, /Les 11 sites des trois filières — 13 489 MW/);
  assert.match(chips.find((chip) => chip.label === 'THERMIQUE').title,
    /Ne garder que thermique à flamme — 3 sites, 2 115 MW/);
  assert.match(chips.find((chip) => chip.label === 'NUCLÉAIRE').title,
    /Cliquer à nouveau pour revenir à la France entière/);
  assert.match(chips.find((chip) => chip.label === '900 MW').title,
    /réacteur à eau pressurisée de 900 MW — 1 site, 5 460 MW/);
});

// ── Three vintages, never collapsed into one ────────────────────────────────

test('the reference dates are reported as a range, not as one "as of"', () => {
  const range = referenceDateRange(PAYLOAD.datasets);
  assert.deepEqual(range.dates, ['2023-12-31', '2025-12-31']);
  assert.equal(range.from, '2023-12-31');
  assert.equal(range.to, '2025-12-31');
  // Aligned files would collapse to one date; that is the only case that may.
  const aligned = referenceDateRange([{ referenceDate: '2025-12-31' }, { referenceDate: '2025-12-31' }]);
  assert.deepEqual(aligned.dates, ['2025-12-31']);
  assert.deepEqual(referenceDateRange(null), { from: null, to: null, dates: [] });
});

// ── The overlay ─────────────────────────────────────────────────────────────

test('the label cohort keeps the largest sites and never claims to be clickable', () => {
  const entries = RECORDS.map((entry) => ({ id: entry.id, priority: entry.mw }));
  const cohort = selectPlantOverlayCohort(entries, 3);
  assert.deepEqual(cohort.map((entry) => entry.id), [
    'nucleaire:GRAVELINES', 'nucleaire:CIVAUX', 'hydraulique:GRAND-MAISON',
  ]);
  assert.equal(selectPlantOverlayCohort(entries, 0).length, 0);
  assert.equal(selectPlantOverlayCohort(null).length, 0);
  assert.equal(
    selectPlantOverlayCohort(entries, 1000).length,
    Math.min(entries.length, EDF_PLANTS_OVERLAY_COHORT_LIMIT),
  );
});

// ── The lifecycle ───────────────────────────────────────────────────────────

function createHarness(polls) {
  const primitives = [];
  const hostCalls = [];
  const fetchUrls = [];
  let poll = 0;
  const overlayHost = {
    setEntries: (...args) => hostCalls.push(['entries', ...args]),
    setVisible: (...args) => hostCalls.push(['visible', ...args]),
    clearSource: (...args) => hostCalls.push(['clear', ...args]),
  };
  const viewer = {
    scene: {
      requestRender() {},
      primitives: {
        add(primitive) { primitives.push(primitive); return primitive; },
        remove(primitive) {
          const index = primitives.indexOf(primitive);
          if (index >= 0) primitives.splice(index, 1);
          return index >= 0;
        },
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetchUrls.push(String(url));
    const payload = polls[Math.min(poll++, polls.length - 1)];
    if (payload instanceof Error) throw payload;
    if (typeof payload?.status === 'number') return { ok: false, status: payload.status };
    return { ok: true, status: 200, json: async () => payload };
  };
  return {
    layer: createEdfPowerPlantsLayer({ overlayHost }),
    viewer,
    primitives,
    hostCalls,
    fetchUrls,
    restore() { globalThis.fetch = originalFetch; },
  };
}

/** Every rendered mark of a harness, by its render id. */
function drawnMarks(collection) {
  const drawn = new Map();
  for (let i = 0; i < collection.length; i += 1) {
    const mark = collection.get(i);
    drawn.set(mark.id, mark);
  }
  return drawn;
}

test('every site is drawn once, sized by its own installed capacity', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);

    assert.equal(h.primitives.length, 1);
    assert.equal(h.primitives[0].length, 11, 'one mark per site, not per published row');
    const drawn = drawnMarks(h.primitives[0]);
    // The mark is a SQUARE raster, so the capacity ramp has to reach both
    // sides: a width that grew while the height stayed at the floor would
    // stretch the cooling tower instead of enlarging it.
    assert.equal(drawn.get('edf-plants:nucleaire:GRAVELINES').width, PLANT_PIXEL_MAX);
    assert.equal(drawn.get('edf-plants:nucleaire:GRAVELINES').height, PLANT_PIXEL_MAX);
    assert.ok(
      drawn.get('edf-plants:hydraulique:GRAND-MAISON').width
      > drawn.get('edf-plants:hydraulique:GRANDVAL').width,
    );
    assert.equal(
      drawn.get('edf-plants:thermique:CORDEMAIS').color.toCssColorString(),
      plantColor('thermique').toCssColorString(),
    );
  } finally {
    h.restore();
  }
});

test('the overlay publishes one label per drawn site, none of them interactive', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const [, sourceId, entries, options] = h.hostCalls.findLast((call) => call[0] === 'entries');
    assert.equal(sourceId, 'edf-power-plants');
    assert.equal(entries.length, 11);
    assert.equal(options.cohortLimit, EDF_PLANTS_OVERLAY_COHORT_LIMIT);
    assert.equal(options.collisionCapacity, EDF_PLANTS_OVERLAY_COLLISION_CAPACITY);
    assert.equal(options.moving, false);
    for (const entry of entries) {
      assert.equal(entry.interactive, false);
      assert.match(entry.id, /^edf-plants:/);
    }
    assert.equal(
      entries.find((entry) => entry.id === 'edf-plants:nucleaire:GRAVELINES').title,
      'GRAVELINES · 5 460 MW · 6 réacteurs',
    );
  } finally {
    h.restore();
  }
});

test('an unchanged snapshot repaints nothing', async () => {
  const h = createHarness([PAYLOAD, PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const painted = h.hostCalls.filter((call) => call[0] === 'entries').length;
    await h.layer.update(h.viewer);
    assert.equal(h.hostCalls.filter((call) => call[0] === 'entries').length, painted);
  } finally {
    h.restore();
  }
});

test('an HTTP error keeps the last good fleet instead of blanking the map', async () => {
  const h = createHarness([PAYLOAD, { status: 503 }]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const drawn = h.primitives[0].length;

    assert.equal(await h.layer.update(h.viewer), false);
    assert.equal(h.primitives[0].length, drawn, 'the last good snapshot survives');
    assert.match(h.layer.getStats().error, /503/);
  } finally {
    h.restore();
  }
});

test('a thrown fetch is reported, not swallowed as an empty country', async () => {
  const h = createHarness([new Error('offline')]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), false);
    assert.equal(h.layer.getStats().error, 'EDF Open Data network error');
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.layer.getStats().capacityMw, null);
  } finally {
    h.restore();
  }
});

test('a malformed body is refused rather than drawn as zero sites', async () => {
  const h = createHarness([{ fetchedAt: 1, source: 'test' }]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), false);
    assert.equal(h.layer.getStats().error, 'Malformed EDF plants response');
  } finally {
    h.restore();
  }
});

test('getStats reports installed capacity, the operator, and both vintages', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const stats = h.layer.getStats();
    // Sites, not the 19 published rows behind them.
    assert.equal(stats.count, 11);
    assert.equal(stats.capacityMw, 13489.47);
    assert.equal(stats.nuclearMw, 8450);
    assert.equal(stats.hydroMw, 2924.47);
    assert.equal(stats.thermalMw, 2115);
    // The layer's largest caveat, carried in the stats and not only in the docs.
    assert.equal(stats.operator, 'EDF SA');
    assert.deepEqual(stats.referenceDates, ['2023-12-31', '2025-12-31']);
    assert.equal(stats.updateTime, '2025-12-31');
    assert.equal(stats.datasets, 3);
    assert.equal(stats.feedSource, 'test');
    assert.equal(stats.stale, false);
  } finally {
    h.restore();
  }
});

test('a stale document is reported as stale rather than as fresh', async () => {
  const h = createHarness([{ ...PAYLOAD, stale: true }]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.layer.getStats().stale, true);
  } finally {
    h.restore();
  }
});

test('analyst records are gated on the layer being enabled, and largest first', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const records = h.layer.getAnalystRecords();
    assert.equal(records.length, 11);
    assert.equal(records[0].name, 'GRAVELINES');
    // Named for what the number IS, so an "output" question cannot be answered
    // off it by accident.
    assert.equal(records[0].capacityMw, 5460);
    assert.equal(records[0].referenceDate, '2025-12-31');
    assert.equal(records[0].operator, 'EDF SA');
    assert.equal(h.layer.getAnalystRecords(3).length, 3);

    h.layer.disable(h.viewer);
    assert.deepEqual(h.layer.getAnalystRecords(), []);
  } finally {
    h.restore();
  }
});

test('an analyst record invents nothing for a site the file left blank', () => {
  const mapped = mapAnalystRecord({ name: 'X' }, 4);
  assert.equal(mapped.id, 'PLANT-0004');
  assert.equal(mapped.capacityMw, null);
  assert.equal(mapped.units, null);
  assert.equal(mapped.region, null);
  assert.equal(mapped.referenceDate, null);
  assert.equal(mapAnalystRecord(null).name, null);
});

test('disable hides the fleet and drops its labels; destroy releases the collection', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.primitives[0].show, true);

    h.layer.disable(h.viewer);
    assert.equal(h.primitives[0].show, false);
    assert.ok(h.hostCalls.some((call) => call[0] === 'clear' && call[1] === 'edf-power-plants'));

    // Re-enabling republishes the labels the host dropped, without a refetch.
    const before = h.fetchUrls.length;
    h.layer.enable(h.viewer);
    assert.equal(h.fetchUrls.length, before);
    assert.ok(h.hostCalls.findLast((call) => call[0] === 'entries')[2].length > 0);

    h.layer.destroy(h.viewer);
    assert.equal(h.primitives.length, 0);
    assert.equal(h.layer.getStats().count, 0);
    assert.deepEqual(h.layer.getStats().referenceDates, []);
  } finally {
    h.restore();
  }
});

// ── The filter, on a live layer ─────────────────────────────────────────────

test('narrowing to a filière redraws the globe, the key and the row count', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.primitives[0].length, 11);

    assert.equal(h.layer.setParams({ filiere: 'hydraulique' }), true);
    assert.equal(h.primitives[0].length, 6, 'the globe keeps only the filière asked for');
    const drawn = drawnMarks(h.primitives[0]);
    assert.ok(drawn.has('edf-plants:hydraulique:GRANDVAL'));
    assert.ok(!drawn.has('edf-plants:nucleaire:GRAVELINES'));

    // The labels follow the marks: a name left painted over a site that is no
    // longer drawn is a label for nothing.
    const [, , entries] = h.hostCalls.findLast((call) => call[0] === 'entries');
    assert.equal(entries.length, 6);

    // The key describes what is DRAWN, not the fleet — a legend naming three
    // filières over a globe showing one is a key to somebody else's map.
    const controls = h.layer.getRowControls();
    assert.deepEqual(controls.legend.map((entry) => entry.label), ['Hydraulique']);
    assert.match(controls.legend[0].glyph, /^data:image\/svg\+xml;base64,/);

    const stats = h.layer.getStats();
    assert.equal(stats.count, 6, 'the row must report what is on the globe');
    assert.equal(stats.hidden, 5);
    assert.equal(stats.filiere, 'hydraulique');
    assert.equal(stats.kind, null);
    // THE FLEET's figures do not move because a reader narrowed their view.
    assert.equal(stats.fleetSites, 11);
    assert.equal(stats.capacityMw, 13489.47);
    assert.equal(stats.nuclearMw, 8450);
  } finally {
    h.restore();
  }
});

test('the sub-category narrows again, and clearing costs no refetch', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const fetches = h.fetchUrls.length;

    h.layer.setParams({ filiere: 'hydraulique', kind: 'Lac' });
    assert.equal(h.primitives[0].length, 3);
    assert.deepEqual(h.layer.getParams(), { filiere: 'hydraulique', kind: 'Lac' });
    // An analyst question is asked about the map that is on screen.
    assert.deepEqual(h.layer.getAnalystRecords().map((entry) => entry.name),
      ['BATHIE (LA)', 'SAINTE-CROIX', 'GRANDVAL']);

    // Nothing was thrown away: the whole register stayed behind the filter.
    h.layer.setParams({ filiere: null });
    assert.equal(h.primitives[0].length, 11);
    assert.deepEqual(h.layer.getParams(), { filiere: null, kind: null });
    assert.equal(h.fetchUrls.length, fetches, 'clearing a filter must not refetch');
  } finally {
    h.restore();
  }
});

test('re-applying the filter a row already shows is a success, not a rejection', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    // The manager turns a `false` into a params-failed and a console warning.
    // A button that did exactly what it said must not produce either.
    assert.equal(h.layer.setParams({ filiere: 'thermique' }), true);
    assert.equal(h.layer.setParams({ filiere: 'thermique' }), true);
    // A call that addresses neither level IS a rejection: nothing was asked.
    assert.equal(h.layer.setParams({}), false);
    assert.equal(h.layer.setParams({ floorKw: 12 }), false);
    // A filière this file does not publish falls back to the whole fleet
    // rather than emptying the globe.
    assert.equal(h.layer.setParams({ filiere: 'géothermie' }), true);
    assert.equal(h.primitives[0].length, 11);
  } finally {
    h.restore();
  }
});

test('the row repaints itself when a chip changes what it offers', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    // Without this the sub-categories would exist in the module and reach the
    // DOM only on the panel's next scheduled refresh — the defect
    // `gironde-megafire-2026` shipped with, on a strip that changes shape.
    let repaints = 0;
    h.layer.setRowControlsListener(() => { repaints += 1; });
    h.layer.setParams({ filiere: 'nucleaire' });
    assert.equal(repaints, 1);
    assert.equal(h.layer.getRowControls().chips.filter((chip) => chip.chipClass === 'chip-sub').length, 3);
    h.layer.setParams({ filiere: null });
    assert.equal(repaints, 2);
    assert.equal(h.layer.getRowControls().chips.filter((chip) => chip.chipClass === 'chip-sub').length, 0);
  } finally {
    h.restore();
  }
});

test('a filter left pointing at a category a republication dropped heals', async () => {
  // EDF republishes these files annually and the vocabulary is theirs to
  // change. A filter that survived a category that did not would be an empty
  // globe under a lit button, with no way back except a reload.
  const withoutLakes = {
    ...PAYLOAD,
    sites: PAYLOAD.sites.filter((site) => site.kind !== 'Lac'),
  };
  const h = createHarness([PAYLOAD, withoutLakes]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    h.layer.setParams({ filiere: 'hydraulique', kind: 'Lac' });
    assert.equal(h.primitives[0].length, 3);

    await h.layer.update(h.viewer);
    assert.deepEqual(h.layer.getParams(), { filiere: 'hydraulique', kind: null });
    assert.equal(h.primitives[0].length, 3, 'the filière survives; only the dead category is dropped');
  } finally {
    h.restore();
  }
});

test('a fresh scene starts on the whole country', async () => {
  // `init` is a new globe. A reader who reloads must not land on a France that
  // is missing three quarters of its power stations for a reason that is no
  // longer on screen anywhere — which is also why the filter is not in a share
  // link (`layerState.js` keeps this layer `enabled-only`).
  const h = createHarness([PAYLOAD, PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    h.layer.setParams({ filiere: 'thermique' });
    assert.equal(h.primitives[0].length, 3);

    h.layer.destroy(h.viewer);
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.deepEqual(h.layer.getParams(), { filiere: null, kind: null });
    assert.equal(h.primitives[h.primitives.length - 1].length, 11);
  } finally {
    h.restore();
  }
});

// ── Selection card ──────────────────────────────────────────────────────────

const GRAVELINES = Object.freeze({
  id: 'nucleaire:GRAVELINES',
  name: 'GRAVELINES',
  filiere: 'nucleaire',
  lat: 51.012846,
  lon: 2.139287,
  mw: 5460,
  units: 6,
  kind: 'REP 900',
  tech: 'REP',
  fuel: null,
  operator: 'EDF SA',
  commune: 'Gravelines',
  departement: 'Nord',
  region: 'Hauts-de-France',
  commissionedFrom: 1980,
  commissionedTo: 1985,
  secondaryReserveMw: 150,
  referenceDate: '2025-12-31',
});

test('a commissioning SPAN is a span, and a single year is a year', () => {
  // The two fields cover a site's units — Gravelines' six reactors came online
  // across five years — so collapsing them to one date would be a claim about
  // a different object.
  assert.equal(commissioningText(1980, 1985), '1980–1985');
  assert.equal(commissioningText(2012, 2012), '2012');
  assert.equal(commissioningText(1980, null), '1980');
  assert.equal(commissioningText(null, 1985), '1985');
  assert.equal(commissioningText(null, null), '');
  assert.equal(commissioningText(NaN, undefined), '');
});

test('the card publishes the fields that reached the browser and were never shown', () => {
  const lines = buildEdfPlantCard(GRAVELINES).split('\n');
  assert.equal(lines[0], 'GRAVELINES', 'the first line is the title');
  const body = lines.slice(1).join('\n');
  // WHAT IT IS, then what it can do. Every one of these lines used to carry a
  // code instead: `6 × REP 900`, `tranches couplées`, `réserve secondaire`.
  assert.match(body, /Centrale nucléaire · 6 réacteurs à eau pressurisée de 900 MW/);
  assert.match(body, /5 460 MW installés/);
  // secondaryReserveMw reached the client record at buildPlantRecords and was
  // rendered by nothing at all before this card existed.
  assert.match(body, /150 MW tenus en réserve/);
  assert.match(body, /Gravelines · Nord · Hauts-de-France/);
  assert.match(body, /entre 1980 et 1985/);
  assert.match(body, /arrêté au 31\/12\/2025/);
});

test('the card translates the register instead of reciting it', () => {
  // The four codes that were on screen and meant nothing outside the industry.
  const body = buildEdfPlantCard(GRAVELINES);
  for (const code of [/REP 900\b(?! MW)/, /tranche/, /couplée/, /réserve secondaire/]) {
    assert.doesNotMatch(body, code, String(code));
  }
  // A hydro regime is a word AND a sentence, the same pair the noise plans use.
  const grandMaison = buildEdfPlantCard(RECORDS.find((r) => r.name === 'GRAND-MAISON'));
  assert.match(grandMaison, /pompage-turbinage mixte/);
  assert.match(grandMaison, /remonte de l’eau aux heures creuses/);
  // TAC is the one technology string that says something the kind does not.
  const peaker = buildEdfPlantCard({
    name: 'TAC', filiere: 'thermique', kind: 'Fioul Domestique', tech: 'TAC', fuel: 'Fioul Domestique', mw: 185,
  });
  assert.match(peaker, /turbine à combustion/);
  // ...and the columns that merely repeat the kind earn no line at all.
  assert.equal(peaker.split('\n').filter((line) => /fioul/i.test(line)).length, 1);
});

test('the card never claims live output', () => {
  // The join to RTE is exact and already shipped, and is still wrong here: the
  // layer is auth:'none', only 42 of the 69 joinable sites have a reporting
  // unit at any moment, and Flamanville's live 3 583 MW against EDF's 2 660 MW
  // nameplate would print as 135 %. `Groupes de prod` owns that number.
  //
  // The test is on the FIGURE, not on the word: the card now says in so many
  // words that its megawatts are not what the site is producing, and a rule
  // that banned the verb would ban the disclaimer along with the claim.
  const body = buildEdfPlantCard(GRAVELINES);
  assert.doesNotMatch(body, /production actuelle|%/i);
  assert.match(body, /pas ce qu’il produit à cet instant/);
  // Every megawatt figure on the card is a nameplate or another register's
  // nameplate — never a reading.
  assert.doesNotMatch(body, /produit \d/);
});

test('EDF as the operator earns no line, because every row says EDF', () => {
  assert.doesNotMatch(buildEdfPlantCard(GRAVELINES), /exploitant/);
  const other = buildEdfPlantCard({ ...GRAVELINES, operator: 'CNR' });
  assert.match(other, /exploitant : CNR/);
});

test('a site with nothing but a name still yields a title and a power line', () => {
  const lines = buildEdfPlantCard({ name: 'INCONNUE' }).split('\n');
  assert.equal(lines[0], 'INCONNUE');
  // "— MW" rather than a silent omission: an unpublished power is a fact.
  assert.ok(lines.some((line) => /— MW installés/.test(line)), lines.join(' | '));
  for (const line of lines) assert.ok(!/undefined|null|NaN/.test(line), line);
  assert.equal(buildEdfPlantCard({}).split('\n')[0], 'Centrale');
  assert.ok(buildEdfPlantCard(null).length > 0);
});

test('the selected entry is protected, on its own source, and anchored to the disc', () => {
  const position = Cesium.Cartesian3.fromDegrees(GRAVELINES.lon, GRAVELINES.lat);
  const entry = createEdfSelectedOverlayEntry(GRAVELINES, position);
  assert.equal(entry.id, 'edf-plants:nucleaire:GRAVELINES');
  assert.equal(entry.position, position);
  assert.equal(entry.variant, 'selected');
  // Protected and MAX_SAFE_INTEGER priority: a card the visitor asked for by
  // clicking must not lose its slot to an ambient label.
  assert.equal(entry.protected, true);
  assert.equal(entry.priority, Number.MAX_SAFE_INTEGER);
  assert.equal(entry.paintLane, 'selected');
  assert.equal(entry.accent, EDF_SELECTED_COLOR);
  assert.equal(entry.interactive, false);
  assert.equal(entry.title, 'GRAVELINES');
  assert.ok(entry.details.length >= 4);
  assert.equal(createEdfSelectedOverlayEntry(null, position), null);
  assert.equal(createEdfSelectedOverlayEntry(GRAVELINES, null), null);
});

test('the selected source holds exactly one card and the layer id is the pick key', () => {
  assert.equal(EDF_PLANTS_SELECTED_OVERLAY_SOURCE_ID, 'edf-power-plants-selected');
  assert.deepEqual({ ...EDF_PLANTS_SELECTED_OVERLAY_SOURCE_OPTIONS }, {
    cohortLimit: 1,
    collisionCapacity: 1,
    moving: false,
  });
  assert.equal(EDF_PLANTS_LAYER_ID, 'edf-power-plants');
});

test('the ambient label steps aside for the selected card', () => {
  const position = Cesium.Cartesian3.fromDegrees(GRAVELINES.lon, GRAVELINES.lat);
  assert.equal(createPlantOverlayEntry(GRAVELINES, position).skipLabel, false);
  assert.equal(
    createPlantOverlayEntry(GRAVELINES, position, { skipLabel: true }).skipLabel,
    true,
    'a selected site must not compete with its own ambient label',
  );
});
