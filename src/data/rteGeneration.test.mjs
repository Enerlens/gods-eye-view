// The presentation contract of the Groupes de prod (FR) layer.
//
// This layer draws two things that look identical if you are careless — a
// station nobody has published an output for, and a station measured at zero —
// and the whole point of the ring-and-disc grammar is that they never share a
// glyph. Most of the tests here are that distinction refusing to blur, plus the
// one other place a sign can silently flip: a machine that is CONSUMING.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import rteGenerationLayer, {
  RTE_GEN_LAYER_ID,
  RTE_GEN_OUTPUT_SUFFIX,
  RTE_GEN_RENDER_PREFIX,
  RTE_GEN_OVERLAY_COHORT_LIMIT,
  RTE_GEN_SELECTED_OVERLAY_SOURCE_ID,
  RTE_PLACEMENT_NOTES,
  RTE_PUMPING_COLOR,
  buildRteLegend,
  buildRteSelectionLabel,
  buildUnitRow,
  createRteSelectedOverlayEntry,
  createRteStationOverlayEntry,
  detectionTypeFor,
  formatGenMw,
  formatLoad,
  formatPublishedAge,
  generationErrorFor,
  mapRteAnalystRecord,
  resolveRtePickId,
  rteDiscSize,
  rteRingSize,
  rteRenderId,
  selectRteOverlayCohort,
  _clearRteSelectionForTest,
  _rteDetectablesForTest,
  _rteRowControlsForTest,
  _rteSelectedIdForTest,
  _rteStatsForTest,
  _selectRteObjectForTest,
  _setRteStateForTest,
} from './rteGeneration.js';
import { RTE_GENERATION_CLASSES } from './rteGenerationFeed.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { SPRITE_LAYER_ORDER } from './spriteOrder.js';

const POSITION = Cesium.Cartesian3.fromDegrees(2.13764, 51.01528, 12);

/** A joined station, of the shape `joinGenerationToRegistry` emits. */
function station(overrides = {}) {
  return {
    id: 'GRAV5',
    name: 'Centrale nucléaire de Gravelines',
    class: 'nuclear',
    commune: 'Gravelines',
    departement: 'Nord',
    region: 'Hauts-de-France',
    lat: 51.01528,
    lon: 2.13764,
    placement: 'osm-plant',
    placementRef: 'relation/20240158',
    anchorKm: 1.38,
    installedMw: 5460,
    mw: 4730,
    load: 4730 / 5460,
    reporting: 6,
    latestAt: Date.parse('2026-08-28T12:00:00+02:00'),
    units: [unit()],
    ...overrides,
  };
}

function unit(overrides = {}) {
  return {
    eic: '17W100P100P0130W',
    name: 'Groupe 01',
    code: 'GRAV5N01',
    class: 'nuclear',
    registryMw: 910,
    installedMw: 910,
    mw: 905,
    at: Date.parse('2026-08-28T12:00:00+02:00'),
    regime: 'En service',
    history: [880, 900, 905],
    reporting: true,
    ...overrides,
  };
}

function seed(sites, extra = {}) {
  const records = new Map(sites.map((site) => [rteRenderId(site.id), {
    id: rteRenderId(site.id),
    siteId: site.id,
    site,
    position: POSITION,
    ring: { show: true },
    disc: null,
    baseRingColor: Cesium.Color.WHITE,
    baseRingOutline: Cesium.Color.WHITE,
    baseRingSize: 20,
  }]));
  _setRteStateForTest({ sites, records, ...extra });
  return records;
}

test('the layer is registered everywhere a drawn layer has to be', () => {
  assert.equal(rteGenerationLayer.id, RTE_GEN_LAYER_ID);
  const entry = LAYER_STATE_REGISTRY.find((row) => row.id === RTE_GEN_LAYER_ID);
  assert.ok(entry, 'missing from the share-link registry');
  // Every letter a–y is taken and `z` is the canonical UNKNOWN token, so this
  // layer holds a digit — and not `2`, which the power-grid layer's open pull
  // request already claims.
  assert.equal(entry.token, '3');
  assert.ok(SPRITE_LAYER_ORDER.includes(RTE_GEN_LAYER_ID), 'missing from sprite order');
});

// --- The distinction the whole layer is built around ------------------------

test('a station with no published output is not a station producing zero', () => {
  const unmeasured = station({
    mw: null, load: null, reporting: 0, latestAt: null,
    units: [unit({ mw: null, at: null, history: null, reporting: false })],
  });
  const stopped = station({ mw: 0, load: 0, reporting: 6, units: [unit({ mw: 0, history: [0, 0] })] });

  // No disc for either — but for two different reasons, and the card says which.
  assert.equal(rteDiscSize(rteRingSize(5460), unmeasured.load), 0);
  assert.equal(rteDiscSize(rteRingSize(5460), stopped.load), 0);

  const unmeasuredCard = buildRteSelectionLabel(unmeasured);
  assert.match(unmeasuredCard, /RTE published no output/);
  assert.match(unmeasuredCard, /not the same as producing nothing/);
  // No output figure and no load at all — the card claims nothing it was not told.
  assert.doesNotMatch(unmeasuredCard, /of nameplate/);
  assert.doesNotMatch(unmeasuredCard, /hour of/);
  assert.match(unmeasuredCard, /not reported/);

  const stoppedCard = buildRteSelectionLabel(stopped);
  assert.match(stoppedCard, /0 MW \/ 5,460 MW installed/);
  assert.match(stoppedCard, /0% of nameplate/);
  assert.doesNotMatch(stoppedCard, /published no output/);
});

test('the legend leads with the ring-and-disc grammar, not with a filière', () => {
  seed([station()], { joinStats: { placedUnits: 6, placedMw: 4730 } });
  const { legend } = _rteRowControlsForTest();
  assert.match(legend[0].label, /Ring/);
  assert.match(legend[0].blurb, /faint empty ring/);
  assert.match(legend[0].blurb, /crisp empty ring/);
  assert.match(legend[0].blurb, /CONSUMING/);

  // With no key at all the first row says what to do about it instead.
  seed([station({ mw: null, load: null, reporting: 0 })], { joinStats: { placedUnits: 0 } });
  const keyless = _rteRowControlsForTest().legend;
  assert.match(keyless[0].blurb, /RTE_CLIENT_ID/);
  assert.doesNotMatch(keyless[0].blurb, /crisp empty ring/);
});

// --- Consumption ------------------------------------------------------------

test('a pumping station keeps its sign, its size and its own colour', () => {
  const pumping = station({
    id: 'VAUJA',
    name: 'Station de pompage de Grand-Maison',
    class: 'hydro-pumped',
    installedMw: 1690,
    mw: -1180,
    load: -1180 / 1690,
    reporting: 1,
    units: [unit({ name: 'Groupe 7', installedMw: 1690, registryMw: 1690, mw: -1180, history: [940, 0, -1180] })],
  });

  // The disc is as big as the same fraction of generation would be: pumping at
  // 70% is as big an event as generating at 70%.
  const ring = rteRingSize(1690);
  assert.equal(rteDiscSize(ring, pumping.load), rteDiscSize(ring, Math.abs(pumping.load)));

  const card = buildRteSelectionLabel(pumping);
  assert.match(card, /−1,180 MW/u);
  assert.match(card, /consuming/);
  assert.match(card, /−70% of nameplate/u);

  // And the ambient label paints in the consumption colour, not the filière's.
  const entry = createRteStationOverlayEntry(pumping, POSITION);
  assert.equal(entry.accent, RTE_PUMPING_COLOR);
  assert.notEqual(entry.accent, RTE_GENERATION_CLASSES['hydro-pumped'].color);
});

test('formatLoad and formatGenMw keep the minus sign that is the whole story', () => {
  assert.equal(formatLoad(-0.7), '−70%');
  assert.equal(formatLoad(0), '0%');
  assert.equal(formatLoad(null), '—');
  assert.equal(formatGenMw(-1180), '−1,180 MW');
  assert.equal(formatGenMw(0), '0 MW');
  assert.equal(formatGenMw(12_500), '12.5 GW');
  assert.equal(formatGenMw(-12_500), '−12.5 GW');
  assert.equal(formatGenMw(null), '—');
});

// --- Sizing -----------------------------------------------------------------

test('the ring is nameplate and the disc is output, on a √ ramp', () => {
  assert.ok(rteRingSize(5460) > rteRingSize(910));
  assert.ok(rteRingSize(910) > rteRingSize(100));
  // A station with no published power still draws, at the floor.
  assert.equal(rteRingSize(null), rteRingSize(0));
  assert.equal(rteRingSize(-5), rteRingSize(0));

  const ring = rteRingSize(5460);
  assert.equal(rteDiscSize(ring, 1), ring, 'full load fills the ring');
  assert.equal(rteDiscSize(ring, 0), 0);
  assert.equal(rteDiscSize(ring, null), 0);
  // Area tracks power, so a quarter-loaded station is a half-width disc.
  assert.equal(rteDiscSize(ring, 0.25), Math.round(ring * 0.5));
  // A station at 1% of nameplate is still visible rather than sub-pixel.
  assert.ok(rteDiscSize(ring, 0.0001) >= 3);
  // Above nameplate clamps rather than spilling outside its own ring.
  assert.equal(rteDiscSize(ring, 1.4), ring);
});

// --- The card ---------------------------------------------------------------

test('the card states where the ring came from, and how far that is', () => {
  for (const [placement, pattern] of [
    ['edf-published', /EDF’s own published coordinate/],
    ['osm-plant', /OpenStreetMap outline/],
    ['rte-switchyard', /switchyard/],
    ['commune-centre', /centre of its commune/],
  ]) {
    assert.ok(RTE_PLACEMENT_NOTES[placement], placement);
    assert.match(buildRteSelectionLabel(station({ placement })), pattern);
  }
  assert.match(buildRteSelectionLabel(station()), /1\.4 km from the commune centre/);
  // A commune anchor is zero kilometres from itself, so no distance is claimed.
  const commune = buildRteSelectionLabel(station({ placement: 'commune-centre', anchorKm: 0 }));
  assert.doesNotMatch(commune, /km from the commune centre/);
});

test('a unit row shows both nameplates when RTE and the register disagree', () => {
  // RTE says 595 for a machine the register publishes as 600.
  assert.match(buildUnitRow(unit({ installedMw: 595, registryMw: 600 })), /register: 600 MW/);
  // The register publishes tenths, so a sub-megawatt gap is this layer's own
  // rounding and is not worth two numbers on a card.
  assert.doesNotMatch(buildUnitRow(unit({ installedMw: 180, registryMw: 180.4 })), /register/);
  assert.doesNotMatch(buildUnitRow(unit()), /register/);
});

test('a silent unit says it was not reported rather than showing a zero', () => {
  assert.equal(buildUnitRow(unit({ mw: null, history: null })), 'Groupe 01 · 910 MW · not reported');
  // And a measured zero says zero, with a flat line behind it.
  assert.equal(buildUnitRow(unit({ mw: 0, history: [0, 0] })), 'Groupe 01 · 0/910 MW  ▁▁');
});

test('a long station lists a bounded number of groups and admits to the rest', () => {
  const many = station({ units: Array.from({ length: 12 }, (_, i) => unit({ eic: `EIC${i}`, name: `Groupe ${i}` })) });
  const card = buildRteSelectionLabel(many);
  assert.match(card, /── 12 groupes ──/);
  assert.match(card, /and 4 more/);
});

test('the card reports partial coverage of its own units', () => {
  const partial = station({ reporting: 1, units: [unit(), unit({ eic: 'B', mw: null })] });
  assert.match(buildRteSelectionLabel(partial), /1 of 2 groups reporting/);
  const full = station({ reporting: 1, units: [unit()] });
  assert.doesNotMatch(buildRteSelectionLabel(full), /groups reporting/);
});

test('published age is reported in the units a reader thinks in', () => {
  const now = Date.parse('2026-08-28T14:00:00+02:00');
  assert.equal(formatPublishedAge(Date.parse('2026-08-28T13:20:00+02:00'), now), '40 min ago');
  assert.equal(formatPublishedAge(Date.parse('2026-08-28T06:00:00+02:00'), now), '8 h ago');
  assert.equal(formatPublishedAge(Date.parse('2026-08-25T14:00:00+02:00'), now), '3 d ago');
  assert.equal(formatPublishedAge(null, now), null);
});

// --- Overlay, picking, detection --------------------------------------------

test('the selected card is protected and anchored on the station', () => {
  const records = seed([station()]);
  const entry = createRteSelectedOverlayEntry(records.get(rteRenderId('GRAV5')));
  assert.equal(entry.protected, true);
  assert.equal(entry.selected, true);
  assert.equal(entry.priority, Number.MAX_SAFE_INTEGER);
  assert.match(entry.title, /Gravelines/);
  assert.ok(entry.details.length > 3);
  assert.equal(createRteSelectedOverlayEntry({ id: 'x' }), null);
});

test('the ambient cohort keeps the biggest stations and is bounded', () => {
  const entries = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, priority: i }));
  const cohort = selectRteOverlayCohort(entries);
  assert.equal(cohort.length, RTE_GEN_OVERLAY_COHORT_LIMIT);
  assert.equal(cohort[0].id, 's39');
  assert.equal(selectRteOverlayCohort(entries, 0).length, 0);
  assert.equal(selectRteOverlayCohort(null).length, 0);
  // Asking for more than the cap does not get more than the cap.
  assert.equal(selectRteOverlayCohort(entries, 999).length, RTE_GEN_OVERLAY_COHORT_LIMIT);
});

test('the ambient label says installed capacity when there is no output to say', () => {
  assert.match(createRteStationOverlayEntry(station(), POSITION).title, /4,730 MW \/ 5,460 MW/);
  assert.match(
    createRteStationOverlayEntry(station({ mw: null }), POSITION).title,
    /5,460 MW installed$/,
  );
});

test('clicking the output disc selects the station it belongs to', () => {
  const id = rteRenderId('GRAV5');
  const has = (value) => value === id;
  assert.equal(id, 'rte-gen:GRAV5');
  assert.equal(resolveRtePickId({ primitive: { id } }, has), id);
  // The disc is not a separate object; it is the same station's reading.
  assert.equal(resolveRtePickId({ primitive: { id: id + RTE_GEN_OUTPUT_SUFFIX } }, has), id);
  assert.equal(resolveRtePickId({ id: id + RTE_GEN_OUTPUT_SUFFIX }, has), id);
  assert.equal(resolveRtePickId({ primitive: { id: 'rte-gen:OTHER:out' } }, has), null);
  // A station code is short and opaque; without the namespace a bare `GRAV5`
  // in another layer's collection would resolve into this one.
  assert.equal(resolveRtePickId({ primitive: { id: 'GRAV5' } }, () => true), null);
  assert.ok(RTE_GEN_RENDER_PREFIX.length > 0);
  assert.equal(resolveRtePickId(null, has), null);
});

test('selection round-trips and Escape clears it', () => {
  const records = seed([station()]);
  const published = [];
  _setRteStateForTest({
    sites: [station()],
    records,
    overlayHost: {
      setEntries: (id, entries) => published.push([id, entries.length]),
      setVisible: () => {},
      clearSource: (id) => published.push([id, 'clear']),
    },
  });
  _selectRteObjectForTest(rteRenderId('GRAV5'));
  assert.equal(_rteSelectedIdForTest(), rteRenderId('GRAV5'));
  assert.ok(published.some(([id, n]) => id === RTE_GEN_SELECTED_OVERLAY_SOURCE_ID && n === 1));
  _clearRteSelectionForTest();
  assert.equal(_rteSelectedIdForTest(), null);
});

test('detection tags a station by what it burns', () => {
  assert.equal(detectionTypeFor('nuclear'), 'NUC');
  assert.equal(detectionTypeFor('hydro-pumped'), 'HYD');
  assert.equal(detectionTypeFor('hydro-run-of-river'), 'HYD');
  assert.equal(detectionTypeFor('fossil-gas'), 'GAZ');
  assert.equal(detectionTypeFor('battery'), 'BAT');
  assert.equal(detectionTypeFor(undefined), 'GEN');

  seed([station(), station({ id: 'VAUJA', class: 'hydro-pumped' })]);
  const detectables = _rteDetectablesForTest({ maxCount: 2 });
  assert.equal(detectables.length, 2);
  assert.deepEqual(detectables.map((d) => d.type).sort(), ['HYD', 'NUC']);
});

test('the detection subsample is deterministic and bounded', () => {
  seed(Array.from({ length: 20 }, (_, i) => station({ id: `S${i}` })));
  const first = _rteDetectablesForTest({ maxCount: 5, seed: 3 });
  const again = _rteDetectablesForTest({ maxCount: 5, seed: 3 });
  assert.equal(first.length, 5);
  assert.deepEqual(first.map((d) => d.sourceId), again.map((d) => d.sourceId));
});

// --- Legend, stats, analyst --------------------------------------------------

test('the legend counts stations per filière and reports live against installed', () => {
  const legend = buildRteLegend([
    station(),
    station({ id: 'PALUE', mw: 3000, installedMw: 5320 }),
    station({ id: 'VAUJA', class: 'hydro-pumped', mw: null, installedMw: 1690 }),
  ]);
  const nuclear = legend.find((row) => row.label === RTE_GENERATION_CLASSES.nuclear.label);
  assert.equal(nuclear.count, 2);
  assert.match(nuclear.blurb, /7,730 MW of 10\.8 GW/);
  const pumped = legend.find((row) => row.label === RTE_GENERATION_CLASSES['hydro-pumped'].label);
  assert.match(pumped.blurb, /no output published/);
  // Legend order is the class order, not insertion order.
  assert.deepEqual(legend.map((row) => row.label), [
    RTE_GENERATION_CLASSES.nuclear.label,
    RTE_GENERATION_CLASSES['hydro-pumped'].label,
  ]);
});

test('the readout surfaces unplaced units rather than hiding them', () => {
  seed([station()], {
    auth: 'ok',
    joinStats: { placedUnits: 6, placedMw: 4730, unplacedUnits: 3, unplacedMw: 640, silentUnits: 12 },
    liveStats: { latestAt: 1, stepMinutes: 60, pumping: 1 },
    registry: { units: new Array(171), stats: { installedMw: 93502 } },
  });
  const stats = _rteStatsForTest();
  assert.equal(stats.stations, 1);
  assert.equal(stats.units, 171);
  assert.equal(stats.unplacedUnits, 3);
  assert.equal(stats.unplacedMw, 640);
  assert.equal(stats.silentUnits, 12);
  assert.equal(stats.installedMw, 93502);
  assert.match(stats.loadingLabel, /3 unplaced/);
});

test('with no credential the readout says so instead of reporting zero output', () => {
  seed([station({ mw: null, load: null, reporting: 0 })], {
    auth: 'missing',
    joinStats: { placedUnits: 0, placedMw: 0, unplacedUnits: 0, silentUnits: 171 },
  });
  const stats = _rteStatsForTest();
  assert.equal(stats.auth, 'missing');
  assert.match(stats.loadingLabel, /installed capacity only/);
  assert.equal(stats.outputMw, 0);

  // And it is not reported as an ERROR: having no account is the state every
  // reader starts in, and the layer is complete in it. A credential that
  // exists and does not work is a different thing.
  assert.equal(generationErrorFor('missing'), null);
  assert.equal(generationErrorFor('ok'), null);
  assert.equal(generationErrorFor('failed'), 'RTE output unavailable');
  assert.equal(generationErrorFor('unknown'), 'RTE output unavailable');
});

test('the analyst record is JSON-safe and carries the placement', () => {
  const record = mapRteAnalystRecord(station());
  assert.equal(record.kind, 'power-station');
  assert.equal(record.generationClass, 'nuclear');
  assert.equal(record.placement, 'osm-plant');
  assert.equal(record.units, 1);
  assert.equal(JSON.parse(JSON.stringify(record)).id, 'GRAV5');
  const empty = mapRteAnalystRecord(null, 4);
  assert.equal(empty.id, 'GEN-0004');
  assert.equal(empty.outputMw, null);
});
