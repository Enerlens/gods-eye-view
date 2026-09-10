// src/data/roadEventsFrance.test.mjs
// Covers the Événements routiers LAYER: what it draws, what it refuses to
// draw, what a card is allowed to claim, and its lifecycle. The upstream DATEX
// II shape is pinned separately in bisonFuteFeed.test.mjs.
//
// The proxy payload used here is produced by running the REAL projection over
// the REAL captured DATEX II document, so a drift in either the feed or the
// projection surfaces here too rather than being mocked away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  ROAD_EVENTS_FR_LAYER_ID,
  ROAD_EVENTS_FR_OVERLAY_COHORT_LIMIT,
  ROAD_EVENT_CATEGORIES,
  ROAD_EVENT_DEFAULT_SCOPE,
  ROAD_EVENT_INK,
  ROAD_EVENT_LONG_CHORD_KM,
  ROAD_EVENT_SCOPES,
  ROAD_EVENT_UNKNOWN_CATEGORY,
  createRoadEventOverlayEntry,
  createRoadEventSelectedEntry,
  createRoadEventsFranceLayer,
  formatRoadEventWindow,
  mapRoadEventAnalystRecord,
  roadEventAlpha,
  roadEventAnchor,
  roadEventCategory,
  roadEventChordKm,
  roadEventClassificationForScene,
  roadEventClassificationForStack,
  roadEventDetails,
  roadEventLegend,
  roadEventPixelSize,
  roadEventScopeAllows,
  roadEventStrokeWidth,
  roadEventTitle,
  selectRoadEventOverlayCohort,
  summarizeRoadEvents,
} from './roadEventsFrance.js';
import { BISON_FUTE_EVENT_CATEGORIES, projectRoadEvents } from './bisonFuteFeed.js';
import { ROAD_EVENT_CATEGORY_SYMBOLS, _roadEventGlyphBodyForTest } from './roadEventGlyphs.js';
import { ROAD_STATUS_LEVELS } from './datexRoadStatus.js';
import { COMPTAGES_RHYTHM_COLORS } from './comptagesRhythm.js';

/** CIE76 dE between two sRGB hexes — the separation figure the module quotes. */
function deltaE(a, b) {
  const lab = (hex) => {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [r, g, bl] = [0, 2, 4].map((i) => lin(parseInt(hex.slice(1 + i, 3 + i), 16) / 255));
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const [fx, fy, fz] = [f(X), f(Y), f(Z)];
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  const A = lab(a);
  const B = lab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}
import { LAYER_STATE_REGISTRY } from './layerState.js';

const EVENTS_XML = readFileSync(
  new URL('./fixtures/bison-fute-evenementiel-sample.xml', import.meta.url),
  'utf8',
);
/** The captured snapshot's own publication instant. */
const CAPTURE_MS = Date.parse('2026-08-31T21:13:26.825+02:00');

/** Build the payload the proxy would serve from the captured document. */
function proxyPayload() {
  const projected = projectRoadEvents(EVENTS_XML, { nowMs: CAPTURE_MS });
  return {
    fetchedAt: CAPTURE_MS,
    stale: false,
    ttlMs: 300_000,
    source: 'Bison Futé / Tipi (tipi.bison-fute.gouv.fr)',
    publishedAt: projected.publishedAt,
    publishedAtMs: projected.publishedAtMs,
    supplier: projected.supplier,
    counts: projected.counts,
    events: projected.events,
  };
}

const PAYLOAD = proxyPayload();
const byId = (id) => PAYLOAD.events.find((event) => event.id === id);

// ── Classification and presentation ─────────────────────────────────────────

test('every category the feed can produce has a drawing', () => {
  // The two tables are written in two files and must not drift: a category the
  // projection can emit and the layer cannot DRAW would fall to the unknown
  // mark, which reads as "we do not know" for something perfectly well known.
  for (const category of BISON_FUTE_EVENT_CATEGORIES) {
    const presentation = ROAD_EVENT_CATEGORIES[category];
    assert.ok(presentation, `no presentation for category ${category}`);
    assert.ok(presentation.label && presentation.blurb);
    // A category is a NOMINAL variable, so it travels on SHAPE, never on hue
    // (B5). Eight hues here collided with the congestion ladder, the rhythm
    // wheel and each other — `accident` was byte-for-byte `traffic`'s `Route
    // fermée`. There is no colour field left to collide.
    assert.equal(presentation.color, undefined, 'a category must not carry a hue');
    assert.ok(ROAD_EVENT_CATEGORY_SYMBOLS[category], `no symbol for category ${category}`);
  }
  assert.equal(Object.keys(ROAD_EVENT_CATEGORIES).length, BISON_FUTE_EVENT_CATEGORIES.length);
  // Distinct SHAPES, or the map is decoration. Nine, counting the unknown mark.
  const bodies = [...BISON_FUTE_EVENT_CATEGORIES, ROAD_EVENT_UNKNOWN_CATEGORY.id]
    .map(_roadEventGlyphBodyForTest);
  assert.equal(new Set(bodies).size, bodies.length);
  // And one ink for all of them, clear of everything drawn over the same road.
  assert.match(ROAD_EVENT_INK, /^#[0-9a-f]{6}$/i);
  const nearest = Math.min(...[
    ...Object.values(ROAD_STATUS_LEVELS).map((level) => level.color),
    ...Object.values(COMPTAGES_RHYTHM_COLORS),
    '#ffffff', '#ff3b30',
  ].map((other) => deltaE(ROAD_EVENT_INK, other)));
  assert.ok(nearest > 20, `the event ink is ΔE ${nearest.toFixed(1)} from its nearest neighbour`);
});

test('an unrecognised category is drawn as unknown, not as a real one', () => {
  const unknown = roadEventCategory('quelque-chose-de-2030');
  assert.equal(unknown, ROAD_EVENT_UNKNOWN_CATEGORY);
  assert.ok(!Object.values(ROAD_EVENT_CATEGORIES).some((entry) => entry.id === unknown.id));
  assert.ok(!Object.values(ROAD_EVENT_CATEGORIES).some(
    (entry) => _roadEventGlyphBodyForTest(entry.id) === _roadEventGlyphBodyForTest(unknown.id),
  ), 'the unknown mark is not one of the eight');
  // And it is tallied and LABELLED as itself: folding it into a real category
  // would put a grey marker under a blue legend row.
  const summary = summarizeRoadEvents([{ category: 'quelque-chose-de-2030' }, { category: 'restriction' }]);
  assert.deepEqual(summary.byCategory, { inconnu: 1, restriction: 1 });
  const legend = roadEventLegend(summary.byCategory);
  assert.deepEqual(legend.map((row) => row.label), ['Restriction', 'Non classé']);
  assert.equal(legend.reduce((total, row) => total + row.count, 0), summary.total);
});

test('a consequence tally is written in French, plurals included', () => {
  const line = roadEventDetails({
    category: 'travaux',
    also: { travaux: 2, fermeture: 1, deviation: 3, accident: 1 },
  }).find((entry) => entry.startsWith('Conséquences'));
  // "2 travauxs" is not a word: `travaux` is already plural.
  assert.equal(line, 'Conséquences déclarées : 2 travaux, 1 fermeture, 3 déviations, 1 accident');
});

test('the title says what happened and where, without repeating itself', () => {
  // `accidentType: accident` inside category `Accident` — one of them is noise.
  assert.equal(roadEventTitle(byId('260830-002035')), 'Accident — N94');
  // A subtype that adds meaning is kept.
  assert.equal(roadEventTitle(byId('260131-000090')), 'Obstacle · chutes de pierres — N20');
  // No road published: the title still says what it is.
  assert.equal(roadEventTitle({ category: 'travaux', subtype: 'fauchage' }), 'Travaux · fauchage');
  // An unmapped subtype code is shown as the code, never dropped.
  assert.equal(roadEventTitle({ category: 'travaux', subtype: 'bridgeJacking' }), 'Travaux · bridgeJacking');
});

test('a card states the operator, the place, the PR and the window', () => {
  const lines = roadEventDetails(byId('260830-002035'), CAPTURE_MS);
  assert.ok(lines.some((line) => line.includes("situé 6920 m à l'ouest de Le Sauze")));
  assert.ok(lines.some((line) => line === 'PR 05PR91U + 941 m'));
  assert.ok(lines.some((line) => line === 'Source : DIR Méditerranée'));
  assert.ok(lines.some((line) => line.includes('2 voies neutralisées sur 2')));
  assert.ok(lines.some((line) => line === 'Message lié à la sécurité'));
  assert.ok(lines.some((line) => line.includes('dans les deux sens')));
});

test('a forecast is never presented as a fact', () => {
  const probable = { ...byId('260122-001698'), probability: 'probable' };
  assert.ok(roadEventDetails(probable, CAPTURE_MS).includes('Prévision — non confirmé'));
  const risk = { ...probable, probability: 'riskOf' };
  assert.ok(roadEventDetails(risk, CAPTURE_MS).includes('Risque signalé — non confirmé'));
  // `certain` says nothing, because there is nothing to warn about.
  const certain = { ...probable, probability: 'certain' };
  assert.ok(!roadEventDetails(certain, CAPTURE_MS).some((line) => line.includes('non confirmé')));
});

test('the consequences a situation declares are counted on its card', () => {
  const lines = roadEventDetails(byId('260122-001698'), CAPTURE_MS);
  const line = lines.find((entry) => entry.startsWith('Conséquences déclarées'));
  assert.ok(line, 'a situation with consequences must say so');
  assert.ok(line.includes('fermeture'));
  assert.ok(line.includes('déviation'));
  // A situation with none says nothing rather than "0 conséquence".
  assert.ok(!roadEventDetails(byId('260831-001970'), CAPTURE_MS)
    .some((entry) => entry.startsWith('Conséquences')));
});

test('a long chord admits it is not the road', () => {
  const short = { category: 'travaux', geometry: { kind: 'segment', coordinates: [2.0, 48.0, 2.01, 48.0] } };
  const shortLine = roadEventDetails(short).find((line) => line.startsWith('Section'));
  assert.match(shortLine, /^Section de \d+ m$/);
  assert.ok(!shortLine.includes('tracé non fourni'));

  const long = { category: 'travaux', geometry: { kind: 'segment', coordinates: [2.0, 48.0, 2.0, 48.5] } };
  const longLine = roadEventDetails(long).find((line) => line.startsWith('Section'));
  assert.ok(roadEventChordKm(long.geometry.coordinates) > ROAD_EVENT_LONG_CHORD_KM);
  assert.ok(longLine.includes('extrémités publiées, tracé non fourni'));

  // A point never claims an extent at all.
  assert.ok(!roadEventDetails(byId('260830-002035')).some((line) => line.startsWith('Section')));
});

test('the time window is phrased for the state it describes', () => {
  const planned = byId('260122-001698');
  assert.equal(planned.state, 'planned');
  assert.match(formatRoadEventWindow(planned, CAPTURE_MS), /^Prévu à partir du /);
  const ended = byId('260830-002035');
  assert.match(formatRoadEventWindow(ended, CAPTURE_MS), /^Terminé le /);
  const active = byId('260831-001970');
  assert.match(formatRoadEventWindow(active, CAPTURE_MS), /^Depuis /);
  // An event the operator closed with no end time still reads as over.
  assert.equal(
    formatRoadEventWindow({ state: 'ended', start: CAPTURE_MS, end: null }, CAPTURE_MS),
    'Clôturé par l’exploitant',
  );
});

// ── Scope ───────────────────────────────────────────────────────────────────

test('the default scope is what is happening now', () => {
  assert.equal(ROAD_EVENT_DEFAULT_SCOPE, 'active');
  assert.equal(roadEventScopeAllows('active', 'active'), true);
  assert.equal(roadEventScopeAllows('active', 'planned'), false);
  assert.equal(roadEventScopeAllows('active', 'ended'), false);
  assert.equal(roadEventScopeAllows('upcoming', 'planned'), true);
  assert.equal(roadEventScopeAllows('upcoming', 'ended'), false);
  assert.equal(roadEventScopeAllows('all', 'ended'), true);
  // An unknown scope falls back to the default rather than showing everything.
  assert.equal(roadEventScopeAllows('bidon', 'ended'), false);
  assert.equal(roadEventScopeAllows('bidon', 'active'), true);
  // The scopes nest, so a chip can only ever add.
  const sizes = ROAD_EVENT_SCOPES.map((scope) => scope.states.length);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
});

test('a planned event is drawn as a ghost, and the mark size encodes NOTHING', () => {
  assert.ok(roadEventAlpha('planned') < roadEventAlpha('active'));
  assert.ok(roadEventAlpha('ended') < roadEventAlpha('planned'));

  // ONE diameter, for every event. It used to compose severity (5 steps), a
  // safety flag (+2 px) and the planned state (x0.8) into a single number: 20
  // reachable combinations inside 5.6-15.4 px, 14 neighbouring pairs under
  // 0.75 px apart, 4 of them 0.12 px apart. A planned major closure and an
  // active medium restriction landed on the same size, and the key mentioned
  // none of it (D1). On the live feed of 2026-09-10, 312 of 386 situations
  // were `medium` anyway — and `medium` is also the fallback for a severity
  // nobody declared, so a measured value and a default drew alike (A1).
  const sizes = [
    { severity: 'medium', state: 'active' },
    { severity: 'medium', state: 'planned' },
    { severity: 'highest', state: 'active' },
    { severity: 'low', state: 'active' },
    { severity: 'medium', state: 'active', safety: true },
    {},
  ].map(roadEventPixelSize);
  assert.equal(new Set(sizes).size, 1, 'the mark size is one value');
  // Big enough for a filled pictogram to survive orthophoto underneath it.
  assert.ok(sizes[0] >= 16, `${sizes[0]} px`);

  // Severity DOES still move a segment's stroke, and that is not the same
  // channel: a line is long, so three widths on it are readable.
  assert.ok(roadEventStrokeWidth({ severity: 'highest', state: 'active' })
    > roadEventStrokeWidth({ severity: 'low', state: 'active' }));
  assert.ok(roadEventStrokeWidth({ severity: 'medium', state: 'planned' })
    < roadEventStrokeWidth({ severity: 'medium', state: 'active' }));
});

// ── Summary, legend, overlay ────────────────────────────────────────────────

test('the legend counts what is drawn, in severity order, with no empty rows', () => {
  const summary = summarizeRoadEvents(PAYLOAD.events);
  assert.equal(summary.total, PAYLOAD.events.length);
  const legend = roadEventLegend(summary.byCategory);
  assert.ok(legend.length >= 4);
  for (const row of legend) assert.ok(row.count > 0, 'no zero-count legend rows');
  const priorities = legend.map((row) => Object.values(ROAD_EVENT_CATEGORIES)
    .find((category) => category.label === row.label).priority);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => b - a));
  assert.equal(legend.reduce((total, row) => total + row.count, 0), summary.total);
});

test('an anchor is the point, or the midpoint of a chord', () => {
  assert.deepEqual(roadEventAnchor({ kind: 'point', coordinates: [2.5, 48.5] }), [2.5, 48.5]);
  assert.deepEqual(roadEventAnchor({ kind: 'segment', coordinates: [2, 48, 4, 50] }), [3, 49]);
  assert.equal(roadEventAnchor(null), null);
  assert.equal(roadEventAnchor({ kind: 'point', coordinates: [] }), null);
});

test('the label cohort is bounded and stable between identical polls', () => {
  const position = Cesium.Cartesian3.fromDegrees(2.3, 48.8);
  const entries = PAYLOAD.events.map((event) => createRoadEventOverlayEntry({
    id: event.id, position, event,
  }));
  const cohort = selectRoadEventOverlayCohort(entries, 3);
  assert.equal(cohort.length, 3);
  assert.deepEqual(
    cohort.map((entry) => entry.id),
    selectRoadEventOverlayCohort(entries.slice().reverse(), 3).map((entry) => entry.id),
    'the cohort must not depend on input order',
  );
  // An accident outranks roadworks whatever its severity.
  const accident = entries.find((entry) => entry.title.startsWith('Accident'));
  const works = entries.find((entry) => entry.title.startsWith('Travaux'));
  assert.ok(accident.priority > works.priority);
  assert.ok(selectRoadEventOverlayCohort(entries, 999).length <= ROAD_EVENTS_FR_OVERLAY_COHORT_LIMIT);
  assert.equal(selectRoadEventOverlayCohort(entries, 0).length, 0);
});

test('the selected card carries the event, not a summary of it', () => {
  const entry = createRoadEventSelectedEntry({
    id: 'x',
    position: Cesium.Cartesian3.fromDegrees(2.3, 48.8),
    event: byId('260830-002035'),
    nowMs: CAPTURE_MS,
  });
  assert.equal(entry.variant, 'selected');
  assert.equal(entry.priority, Number.MAX_SAFE_INTEGER);
  assert.equal(entry.accent, ROAD_EVENT_INK);
  assert.ok(entry.details.length >= 4);
  assert.equal(createRoadEventSelectedEntry({ id: null, position: null, event: {} }), null);
});

test('the analyst record is JSON-safe and never NaN', () => {
  for (const [index, event] of PAYLOAD.events.entries()) {
    const record = mapRoadEventAnalystRecord(event, index);
    assert.equal(JSON.parse(JSON.stringify(record)).id, record.id);
    for (const [key, value] of Object.entries(record)) {
      assert.ok(!Number.isNaN(value), `${key} is NaN`);
      assert.notEqual(value, undefined, `${key} is undefined`);
    }
    assert.ok(record.lat > 41 && record.lat < 52);
  }
  const empty = mapRoadEventAnalystRecord(null, 7);
  assert.equal(empty.id, 'EVT-0007');
  assert.equal(empty.lat, null);
});

// ── Surface classification ──────────────────────────────────────────────────

test('ground lines classify against the active surface, and fall back to BOTH', () => {
  assert.equal(roadEventClassificationForStack('photoreal'), Cesium.ClassificationType.CESIUM_3D_TILE);
  assert.equal(roadEventClassificationForStack('ign-ortho'), Cesium.ClassificationType.TERRAIN);
  assert.equal(roadEventClassificationForStack('a-stack-from-2030'), Cesium.ClassificationType.BOTH);
  assert.equal(roadEventClassificationForScene({ globe: { show: false } }), Cesium.ClassificationType.CESIUM_3D_TILE);
  assert.equal(roadEventClassificationForScene({ globe: { show: true } }), Cesium.ClassificationType.TERRAIN);
  assert.equal(roadEventClassificationForScene(null), Cesium.ClassificationType.BOTH);
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * @param {Array<object|Error|{status:number}>} responses Served in order; the
 *   last one repeats.
 */
function createHarness(responses = [PAYLOAD]) {
  const dataSources = [];
  const hostCalls = [];
  let poll = 0;
  const overlayHost = {
    setEntries: (...args) => hostCalls.push(['entries', ...args]),
    setVisible: (...args) => hostCalls.push(['visible', ...args]),
    clearSource: (...args) => hostCalls.push(['clear', ...args]),
  };
  const viewer = {
    scene: { globe: { show: true }, requestRender() {} },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };
  const fetchImpl = async () => {
    const payload = responses[Math.min(poll++, responses.length - 1)];
    if (payload instanceof Error) throw payload;
    if (typeof payload?.status === 'number') return { ok: false, status: payload.status };
    return { ok: true, status: 200, json: async () => payload };
  };
  const layer = createRoadEventsFranceLayer({
    overlayHost,
    fetchImpl,
    mapStackEventTarget: new EventTarget(),
  });
  return { layer, viewer, dataSources, hostCalls, entities: () => dataSources[0]?.entities.values ?? [] };
}

test('lifecycle draws one clamped primitive per in-scope event', async () => {
  const h = createHarness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(), true);

  const active = PAYLOAD.events.filter((event) => event.state === 'active');
  assert.equal(h.entities().length, active.length, 'the default scope draws only what is happening');
  assert.ok(active.length < PAYLOAD.events.length, 'the fixture must hold out-of-scope events');

  for (const entity of h.entities()) {
    if (entity.polyline) {
      assert.equal(entity.polyline.clampToGround.getValue(), true);
      // Static positions and a static material: a CallbackProperty here
      // re-tessellates clamped ground geometry every frame.
      assert.ok(entity.polyline.positions instanceof Cesium.ConstantProperty);
      assert.ok(entity.polyline.material instanceof Cesium.ColorMaterialProperty);
    } else {
      // A BILLBOARD, not a point: the category rides the shape channel now.
      assert.equal(entity.point, undefined, 'a point cannot carry a shape');
      assert.equal(
        entity.billboard.heightReference.getValue(), Cesium.HeightReference.CLAMP_TO_GROUND,
      );
      // The image is one of nine shared data URIs, so Cesium's texture atlas
      // holds nine entries however many events are drawn — the whole reason
      // the artwork is never a per-event canvas.
      assert.match(entity.billboard.image.getValue(), /^data:image\/svg\+xml;base64,/);
    }
  }
  // Exactly that: at most one atlas entry per category on screen.
  const images = new Set(h.entities()
    .filter((entity) => entity.billboard)
    .map((entity) => entity.billboard.image.getValue()));
  assert.ok(images.size <= Object.keys(ROAD_EVENT_CATEGORY_SYMBOLS).length,
    `${images.size} distinct textures for ${Object.keys(ROAD_EVENT_CATEGORY_SYMBOLS).length} categories`);

  const stats = h.layer.getStats();
  assert.equal(stats.count, active.length);
  assert.equal(stats.published, PAYLOAD.events.length);
  assert.equal(stats.publishedAt, PAYLOAD.publishedAtMs);
  assert.equal(stats.coverage, 'RRN non concédé');
  assert.equal(stats.error, null);
  h.layer.destroy(h.viewer);
});

test('a scope chip widens the drawn set and repaints the legend', async () => {
  const h = createHarness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update();
  const activeCount = h.entities().length;

  let repaints = 0;
  h.layer.setRowControlsListener(() => { repaints += 1; });
  assert.equal(h.layer.setParams({ scope: 'all' }), true);
  assert.equal(repaints, 1);
  assert.equal(h.entities().length, PAYLOAD.events.length);
  assert.ok(h.entities().length > activeCount);
  assert.equal(h.layer.getStats().scope, 'all');

  // An unchanged or unknown scope is refused, so the manager does not rebuild.
  assert.equal(h.layer.setParams({ scope: 'all' }), false);
  assert.equal(h.layer.setParams({ scope: 'inventé' }), false);
  assert.equal(h.layer.setParams({}), false);
  assert.equal(h.entities().length, PAYLOAD.events.length);

  const { chips } = h.layer.getRowControls();
  assert.deepEqual(chips.map((chip) => chip.id), ROAD_EVENT_SCOPES.map((scope) => scope.id));
  assert.equal(chips.filter((chip) => chip.active).length, 1);
  h.layer.destroy(h.viewer);
});

test('a failed poll keeps the last good map', async () => {
  const h = createHarness([PAYLOAD, { status: 503 }, new Error('offline')]);
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(), true);
  const drawn = h.entities().length;
  assert.ok(drawn > 0);

  assert.equal(await h.layer.update(), false);
  assert.equal(h.entities().length, drawn, 'an HTTP failure must not blank the map');
  assert.match(h.layer.getStats().error, /HTTP 503/);

  assert.equal(await h.layer.update(), false);
  assert.equal(h.entities().length, drawn, 'a network failure must not blank the map either');
  h.layer.destroy(h.viewer);
});

test('a malformed payload is refused rather than drawn as an empty France', async () => {
  const h = createHarness([{ ...PAYLOAD, events: 'beaucoup' }]);
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(), false);
  assert.equal(h.entities().length, 0);
  assert.equal(h.layer.getStats().error, 'Réponse Bison Futé malformée');
  h.layer.destroy(h.viewer);
});

test('the proxy serving its cache past TTL is reported as stale, not as fresh', async () => {
  const h = createHarness([{ ...PAYLOAD, stale: true }]);
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update();
  assert.equal(h.layer.getStats().stale, true);
  h.layer.destroy(h.viewer);
});

test('a disabled layer draws nothing, answers nothing, and polls nothing', async () => {
  const h = createHarness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update();
  assert.ok(h.layer.getAnalystRecords().length > 0);

  h.layer.disable();
  assert.equal(h.dataSources[0].show, false);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  assert.equal(await h.layer.update(), false, 'a disabled layer must not poll');
  assert.ok(h.hostCalls.some(([kind, source]) => kind === 'clear' && source === ROAD_EVENTS_FR_LAYER_ID));

  h.layer.destroy(h.viewer);
  assert.equal(h.dataSources.length, 0, 'destroy releases the data source');
});

test('the layer is registered with exactly one share disposition', () => {
  const entries = LAYER_STATE_REGISTRY.filter((entry) => entry.id === ROAD_EVENTS_FR_LAYER_ID);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].disposition, 'enabled-only');
});
