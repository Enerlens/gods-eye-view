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

test('a disc four times the capacity is twice as wide, above the floor', () => {
  const small = plantPixelSize(100) - PLANT_PIXEL_MIN;
  const large = plantPixelSize(400) - PLANT_PIXEL_MIN;
  assert.ok(Math.abs(large - small * 2) < 1e-9, 'radius must follow the square root');
});

test('the smallest plant is still visible and the largest still fits', () => {
  // Grandval, 74.1 MW, is the smallest plant the hydro file publishes.
  assert.ok(plantPixelSize(74.1) > PLANT_PIXEL_MIN);
  assert.ok(plantPixelSize(74.1) < 12);
  // Gravelines, 5 460 MW, saturates rather than growing without bound.
  assert.equal(plantPixelSize(5460), PLANT_PIXEL_MAX);
  // A site with no published capacity gets the floor, never a guess.
  assert.equal(plantPixelSize(null), PLANT_PIXEL_MIN);
  assert.equal(plantPixelSize(0), PLANT_PIXEL_MIN);
  assert.equal(plantPixelSize(-5), PLANT_PIXEL_MIN);
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
  assert.equal(plantLabelText(record('nucleaire:GRAVELINES')), 'GRAVELINES · 5 460 MW · 6 × REP 900');
  assert.equal(plantLabelText(record('hydraulique:GRAND-MAISON')), 'GRAND-MAISON · 1 714 MW · Pompage mixte');
  assert.equal(plantLabelText(record('thermique:CORDEMAIS')), 'CORDEMAIS · 1 160 MW · 2 × Charbon');
  assert.equal(plantLabelText(record('thermique:BOUCHAIN')), 'BOUCHAIN · 585 MW · Gaz naturel');
  assert.equal(plantLabelText(record('hydraulique:RANCE')), 'RANCE · 240 MW · Marémotrice');
});

test('a hydro plant is never labelled with an invented unit count', () => {
  // The file publishes no turbine count, so the label carries the regime alone.
  assert.equal(plantKindText(record('hydraulique:BATHIE (LA)')), 'Lac');
  assert.equal(plantKindText({ filiere: 'nucleaire', kind: 'REP 1450', units: 2 }), '2 × REP 1450');
  // A single unit is stated once, not as "1 ×".
  assert.equal(plantKindText({ filiere: 'thermique', kind: 'Gaz naturel', units: 1 }), 'Gaz naturel');
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
  assert.doesNotMatch(legend[1].blurb, /réacteur|tranche/);
  assert.match(legend[2].blurb, /5 tranches/);
  // A filière with nothing drawn gets no legend entry at all.
  assert.deepEqual(filiereLegend(summarizePlants([])), []);
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

test('every site is drawn once, sized by its own installed capacity', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);

    assert.equal(h.primitives.length, 1);
    assert.equal(h.primitives[0].length, 11, 'one disc per site, not per published row');
    const drawn = new Map();
    for (let i = 0; i < h.primitives[0].length; i += 1) {
      const point = h.primitives[0].get(i);
      drawn.set(point.id, point);
    }
    assert.equal(drawn.get('edf-plants:nucleaire:GRAVELINES').pixelSize, PLANT_PIXEL_MAX);
    assert.ok(
      drawn.get('edf-plants:hydraulique:GRAND-MAISON').pixelSize
      > drawn.get('edf-plants:hydraulique:GRANDVAL').pixelSize,
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
      'GRAVELINES · 5 460 MW · 6 × REP 900',
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
  assert.match(body, /5 460 MW installés · 6 × REP 900/);
  // secondaryReserveMw reached the client record at buildPlantRecords and was
  // rendered by nothing at all before this card existed.
  assert.match(body, /150 MW de réserve secondaire/);
  assert.match(body, /Gravelines · Nord · Hauts-de-France/);
  assert.match(body, /1980–1985/);
  assert.match(body, /situation au 2025-12-31/);
});

test('the card never claims live output', () => {
  // The join to RTE is exact and already shipped, and is still wrong here: the
  // layer is auth:'none', only 42 of the 69 joinable sites have a reporting
  // unit at any moment, and Flamanville's live 3 583 MW against EDF's 2 660 MW
  // nameplate would print as 135 %. `Groupes de prod` owns that number.
  const body = buildEdfPlantCard(GRAVELINES);
  assert.doesNotMatch(body, /produit|production actuelle|en ce moment|%/i);
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
  assert.match(lines[1], /— MW installés/);
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
