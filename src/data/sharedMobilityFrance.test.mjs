// The French shared-mobility layer's presentation contract.
//
// The property this layer has to keep straight is that it draws an INVENTORY,
// not a track: GBFS never publishes a vehicle during a rental, so the card
// must say what it is looking at and must date the vehicle's own report rather
// than the poll. The rest is the usual honesty: an unknown count is not zero,
// and a viewport too wide to answer is refused rather than cropped.
//
// It also has to keep TWO CHANNELS straight, because a Paris street holds
// several operators running several kinds of vehicle at once: shape says what
// an object is, colour says who runs it, and a station's fill stays spent on
// the one number a person acts on — how full it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import sharedMobilityFranceLayer, {
  buildSharedMobilitySelectionLabel,
  cameraSharedMobilityBox,
  createSharedMobilitySelectedOverlayEntry,
  sharedMobilityOperator,
  stationColor,
  stationPointSize,
  vehicleKindLabel,
  vehicleKindPlural,
  matchesKindFilter,
  stationHoldsBikes,
  stationTitle,
  _clearSharedMobilitySelectionForTest,
  _reanchorSharedMobilityForTest,
  _selectSharedMobilityObjectForTest,
  _setSharedMobilityPayloadForTest,
  _setSharedMobilityStateForTest,
  SHARED_MOBILITY_KIND_FILTERS,
  SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID,
  SHARED_MOBILITY_FR_OVERLAY_SOURCE_OPTIONS,
} from './sharedMobilityFrance.js';
import { reportMeshFloorCell, setMeshFloorPreferred } from './groundFloor.js';
import { GBFS_MAX_BOX_DEG } from './gbfsFeeds.js';
import { resolveMobilityOperator } from './mobilityOperators.js';
import { sharedMobilityGlyph } from './sharedMobilityIcons.js';

function viewerWithView(degrees) {
  return {
    camera: {
      computeViewRectangle: () => (degrees ? Cesium.Rectangle.fromDegrees(
        degrees.west, degrees.south, degrees.east, degrees.north,
      ) : undefined),
    },
    entities: { remove() {} },
  };
}

function vehicleRecord(overrides = {}) {
  const object = {
    id: 'gbfs-84153:abc',
    system: 'gbfs-84153',
    lat: 48.8875,
    lon: 2.3042,
    kind: 'ebike',
    rangeMeters: 13102,
    lastReported: 1787812339,
    ...(overrides.object || {}),
  };
  const system = { id: 'gbfs-84153', name: 'Lime Paris', licence: 'Licence Ouverte 2.0', ...(overrides.system || {}) };
  const operator = resolveMobilityOperator(system.name);
  return {
    id: object.id,
    type: 'vehicle',
    object,
    system,
    operator,
    position: Cesium.Cartesian3.fromDegrees(object.lon, object.lat, 12),
    // A vehicle is a glyph, not a dot: the silhouette is what says "scooter".
    billboard: { color: null, width: 0, height: 0, show: true },
    baseColor: operator.color,
    baseSize: 17,
  };
}

function stationRecord(overrides = {}) {
  const object = {
    id: 'gbfs-1:42',
    system: 'gbfs-1',
    lat: 47.21,
    lon: -1.55,
    name: 'Commerce',
    available: 7,
    docks: 4,
    capacity: 11,
    renting: true,
    byKind: { bike: 5, ebike: 2 },
    ...(overrides.object || {}),
  };
  const system = { id: 'gbfs-1', name: 'Naolib Nantes', licence: 'ODbL 1.0', ...(overrides.system || {}) };
  return {
    id: object.id,
    type: 'station',
    object,
    system,
    operator: resolveMobilityOperator(system.name),
    position: Cesium.Cartesian3.fromDegrees(object.lon, object.lat, 12),
    point: { color: null, pixelSize: 0, show: true },
    baseColor: stationColor(object),
    baseSize: stationPointSize(object),
  };
}

test('the camera gate answers a city view and refuses a regional one', () => {
  const paris = { south: 48.84, west: 2.30, north: 48.88, east: 2.38 };
  const box = cameraSharedMobilityBox(viewerWithView(paris));
  assert.ok(Math.abs(box.south - paris.south) < 1e-6);
  assert.equal(cameraSharedMobilityBox(viewerWithView({ south: 43, west: -2, north: 50, east: 6 })), null);
  assert.equal(cameraSharedMobilityBox(viewerWithView(null)), null);
  assert.equal(cameraSharedMobilityBox(null), null);
  assert.ok(cameraSharedMobilityBox(viewerWithView({
    south: 44, west: 0, north: 44 + GBFS_MAX_BOX_DEG - 0.001, east: 1,
  })));
});

test('every vehicle kind draws a distinct silhouette and keeps a readable label', () => {
  // Colour is spent on the OPERATOR, so the kind has to survive on shape
  // alone. A shared glyph between two kinds would silently merge them.
  const kinds = ['bike', 'ebike', 'scooter', 'moped', 'car', 'other'];
  const glyphs = kinds.map((kind) => sharedMobilityGlyph(kind));
  assert.equal(new Set(glyphs).size, kinds.length);
  assert.ok(glyphs.every((glyph) => glyph.startsWith('data:image/svg+xml;base64,')));
  assert.equal(vehicleKindLabel('ebike'), 'VAE');
  // The false friend, pinned: GBFS `scooter` is the kick one — a trottinette —
  // and GBFS `moped` is the seated one a French reader calls a scooter.
  assert.equal(vehicleKindLabel('scooter'), 'Trottinette');
  assert.equal(vehicleKindLabel('moped'), 'Scooter');
  // Agreement, and the acronym that does not take an -s.
  assert.equal(vehicleKindPlural('bike', 4), 'Vélos');
  assert.equal(vehicleKindPlural('bike', 1), 'Vélo');
  assert.equal(vehicleKindPlural('ebike', 4), 'VAE');
  // An unmapped kind is shown verbatim, not silently relabelled.
  assert.equal(vehicleKindLabel('funicular'), 'funicular');
});

test('the operator is read from the system title, and shared with the bikeshare layer', () => {
  // The user-visible promise: Vélib' is not Voi is not Lime.
  const velib = resolveMobilityOperator("Vélib' Métropole");
  const voi = resolveMobilityOperator('Voi Paris');
  const lime = resolveMobilityOperator('Lime Paris');
  assert.equal(new Set([velib.color, voi.color, lime.color]).size, 3);
  assert.equal(lime.label, 'Lime');
  // Resolved off the record's own system, so a record built without a cached
  // operator still paints and still names the right one.
  assert.equal(sharedMobilityOperator(vehicleRecord()).id, 'lime');
  assert.equal(sharedMobilityOperator({ system: { name: 'Dott Paris' } }).id, 'dott');
  assert.equal(sharedMobilityOperator({}).id, 'unknown');
});

test('a station with no availability data is neutral, not empty', () => {
  // "We do not know" and "there are no bikes" are different facts, and only
  // the second one is actionable for someone deciding where to walk.
  const unknown = stationColor({ available: null, capacity: 20 });
  const empty = stationColor({ available: 0, capacity: 20 });
  assert.notEqual(unknown, empty);
  assert.equal(stationColor({ available: 18, capacity: 20 }), stationColor({ available: 20, capacity: 20 }));
  assert.notEqual(stationColor({ available: 1, capacity: 20 }), stationColor({ available: 18, capacity: 20 }));
  // A closed station reads closed whatever it holds.
  assert.equal(stationColor({ available: 18, capacity: 20, renting: false }),
    stationColor({ available: 0, capacity: 20, renting: false }));
  // Size never collapses to nothing when capacity is missing.
  assert.ok(stationPointSize({ capacity: null }) > 0);
  assert.ok(stationPointSize({ capacity: 60 }) > stationPointSize({ capacity: 5 }));
});

test('a vehicle card dates the operator\'s own report and says what it is looking at', () => {
  const record = vehicleRecord();
  const lines = buildSharedMobilitySelectionLabel(record, 1787812399000).split('\n');
  // Whose it is leads the card: the glyph on screen is Lime-coloured, and
  // this is where that hue gets a name.
  assert.equal(lines[0], 'VAE Lime');
  assert.equal(lines[1], '🔋 13,1 km d’autonomie');
  // 60 s after the vehicle reported — not 60 s after the layer polled.
  assert.equal(lines[2], '⏱ position il y a 60 s');
  assert.equal(lines[3], '🅿️ Lime Paris');
  // The card stops there. « Garé et disponible » is true of every glyph on
  // screen, so it belongs to the legend once and not to each card; the licence
  // of the FEED is not a fact about this scooter at all.
  assert.equal(lines.length, 4);
});

test('a station card prints the counts and the per-kind split it was given', () => {
  const lines = buildSharedMobilitySelectionLabel(stationRecord()).split('\n');
  assert.equal(lines[0], 'Commerce');
  assert.equal(lines[1], '🚲 7 vélos disponibles sur 11 places · 4 bornes libres');
  assert.equal(lines[2], 'dont 5 mécaniques et 2 VAE');
  assert.equal(lines[3], '🅿️ Naolib Nantes');
  assert.equal(lines.length, 4);

  // One kind that accounts for the whole count names itself on the first line,
  // and the split disappears — printing « 1 VAE » twice was the card spending
  // two lines on one fact.
  const solo = buildSharedMobilitySelectionLabel(stationRecord({
    object: {
      name: null, virtual: true, available: 1, docks: null, capacity: null, byKind: { ebike: 1 },
    },
    system: { name: 'Pony Pays Basque' },
  })).split('\n');
  assert.deepEqual(solo, ['Aire Pony', '🚲 1 VAE disponible', '🅿️ Pony Pays Basque']);

  // A car-share station gets the car badge: a bike over a Citiz dock would be
  // a picture of the wrong vehicle.
  const cars = buildSharedMobilitySelectionLabel(stationRecord({
    object: { name: 'Gare', available: 2, docks: null, capacity: null, byKind: { car: 2 } },
    system: { name: 'Citiz Nantes' },
  })).split('\n');
  assert.equal(cars[1], '🚗 2 voitures disponibles');

  // A painted bay has no dock to lock into: what is free there is a place.
  const bay = buildSharedMobilitySelectionLabel(stationRecord({
    object: { name: 'Mairie', virtual: true, available: 2, docks: 3, capacity: 5, byKind: { bike: 2 } },
  })).split('\n');
  assert.equal(bay[1], '🚲 2 vélos disponibles sur 5 places · 3 places libres');

  // A network name that only echoes the operator already in the title costs a
  // line and says nothing, so it is dropped.
  const echo = buildSharedMobilitySelectionLabel(stationRecord({
    object: { name: null, virtual: true, available: 1, docks: null, capacity: null, byKind: { bike: 1 } },
    system: { name: 'Pony' },
  })).split('\n');
  assert.deepEqual(echo, ['Aire Pony', '🚲 1 vélo disponible']);
});

test('a nameless bay is called by its operator, never by its primary key', () => {
  // Pony publishes `station_id` in the `name` field, so `gbfsFeeds.js` drops
  // the echo and the dot arrives here nameless. What is still KNOWN is who
  // runs it and that it is a painted bay, not a dock — so that is what the
  // card and the HUD label say.
  const bay = stationRecord({
    object: { name: null, virtual: true, available: 3 },
    system: { name: 'Pony Pays Basque' },
  });
  assert.equal(stationTitle(bay), 'Aire Pony');
  assert.equal(buildSharedMobilitySelectionLabel(bay).split('\n')[0], 'Aire Pony');

  // A nameless PHYSICAL dock is a station, and says so.
  const dock = stationRecord({ object: { name: null, virtual: false }, system: { name: 'Pony Pays Basque' } });
  assert.equal(stationTitle(dock), 'Station Pony');

  // A network name the PAN publishes is a fact too, curated brand or not.
  assert.equal(stationTitle(stationRecord({ object: { name: null }, system: { name: 'Naolib Nantes' } })), 'Station Naolib');
  // With no operator to name either, the bare noun — never an invented brand.
  assert.equal(stationTitle(stationRecord({ object: { name: null }, system: { name: null } })), 'Station');

  // A published name always wins — refusing the echo must not cost a toponym.
  assert.equal(stationTitle(stationRecord({ object: { name: 'Gare de Bayonne', virtual: true } })), 'Gare de Bayonne');
});

test('missing values are omitted rather than filled in', () => {
  const bare = vehicleRecord({
    object: { kind: 'bike', rangeMeters: null, lastReported: null },
    system: { name: null, licence: null },
  });
  const lines = buildSharedMobilitySelectionLabel(bare).split('\n');
  assert.deepEqual(lines, ['Vélo']);

  const closed = stationRecord({
    object: { name: null, available: null, docks: null, capacity: null, byKind: null, renting: false },
    system: { name: null },
  });
  const closedLines = buildSharedMobilitySelectionLabel(closed).split('\n');
  assert.equal(closedLines[0], 'Station');
  assert.ok(closedLines.includes('⚠️ Location suspendue'));
  // « on ne sait pas » and « il n'y a rien » are different facts, and the card
  // states the first rather than printing a zero it was never given.
  assert.ok(closedLines.includes('Inventaire non publié'));
});

test('the selected entry takes the protected lane, and the source is a static one', () => {
  const record = vehicleRecord();
  const entry = createSharedMobilitySelectedOverlayEntry(record, 1787812399000);
  assert.equal(entry.id, record.id);
  assert.equal(entry.position, record.position);
  assert.equal(entry.title, 'VAE Lime');
  assert.equal(entry.protected, true);
  assert.equal(entry.paintLane, 'selected');
  assert.equal(entry.horizonCull, true);
  assert.equal(createSharedMobilitySelectedOverlayEntry({ id: 'x' }), null);
  // A parked vehicle does not move, so the host may cache its screen rect.
  assert.equal(SHARED_MOBILITY_FR_OVERLAY_SOURCE_OPTIONS.moving, false);
  assert.equal(SHARED_MOBILITY_FR_OVERLAY_SOURCE_OPTIONS.cohortLimit, 1);
});

test('selecting and clearing drives the real host seam and restores the point', () => {
  const record = vehicleRecord();
  const calls = [];
  const host = {
    setEntries: (...args) => calls.push(['set', ...args]),
    setVisible: (...args) => calls.push(['visible', ...args]),
    clearSource: (...args) => calls.push(['clear', ...args]),
  };
  _setSharedMobilityStateForTest({ viewer: viewerWithView(null), records: [record], overlayHost: host });

  _selectSharedMobilityObjectForTest(record.id);
  const set = calls.find((call) => call[0] === 'set');
  assert.equal(set[1], SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID);
  assert.equal(set[2][0].id, record.id);
  assert.equal(record.billboard.color.toCssHexString(), '#00ffff');
  assert.ok(record.billboard.width > record.baseSize);

  _clearSharedMobilitySelectionForTest();
  assert.ok(calls.some((call) => call[0] === 'clear' && call[1] === SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID));
  // Restored to the OPERATOR's colour — the channel survives a selection.
  assert.equal(record.billboard.color.toCssHexString(), resolveMobilityOperator('Lime Paris').color);
  assert.equal(record.billboard.width, record.baseSize);
});

test('the row legend carries both channels — shapes, then the operators in view', () => {
  _setSharedMobilityStateForTest({
    viewer: viewerWithView(null),
    records: [
      vehicleRecord({ object: { id: 'a', kind: 'ebike' } }),
      vehicleRecord({ object: { id: 'b', kind: 'ebike' } }),
      vehicleRecord({ object: { id: 'c', kind: 'scooter' } }),
      vehicleRecord({ object: { id: 'e', kind: 'scooter' }, system: { name: 'Dott Paris' } }),
      stationRecord({ object: { id: 'd' } }),
    ],
  });
  const { legend, chips } = sharedMobilityFranceLayer.getRowControls();
  // The strip carries the two halves of the fleet and nothing else; what each
  // one holds is pinned by the filter tests below.
  assert.deepEqual(chips.map((chip) => chip.id), ['velo', 'autres']);
  assert.deepEqual(legend.map((item) => [item.label, item.count]), [
    // What is on screen, by kind...
    ['VAE', 2], ['Trottinette', 2], ['Stations', 1],
    // ...then who is running it.
    ['Lime', 3], ['Dott', 1], ['Naolib', 1],
  ]);
  assert.ok(legend.every((item) => item.count > 0), 'a kind with nothing in view is omitted');

  // The shape rows carry the map's own glyph and a neutral tint — they answer
  // "what", so painting them an operator hue would claim something false.
  const kindRows = legend.slice(0, 3);
  assert.equal(new Set(kindRows.map((item) => item.glyph)).size, 3);
  assert.equal(new Set(kindRows.map((item) => item.color)).size, 1);
  assert.equal(kindRows.find((item) => item.label === 'Trottinette').glyph, sharedMobilityGlyph('scooter', 32));

  // The operator rows carry the exact colour their objects are drawn in, and
  // no glyph — they answer "who".
  const operatorRows = legend.slice(3);
  assert.equal(operatorRows.find((item) => item.label === 'Lime').color, resolveMobilityOperator('Lime Paris').color);
  assert.ok(operatorRows.every((item) => item.glyph === undefined));
  assert.equal(new Set(operatorRows.map((item) => item.color)).size, 3, 'three operators, three hues');

  // The two caveats a colour cannot carry.
  assert.match(legend.find((item) => item.label === 'Stations').blurb, /places municipales que tous republient/);
  assert.match(legend.find((item) => item.label === 'VAE').blurb, /jamais un véhicule pendant une location/);
  // A derived hue says it is derived rather than passing itself off as livery.
  assert.match(operatorRows.find((item) => item.label === 'Naolib').blurb, /aucun flux français ne publie sa couleur de marque/);
  // A CURATED hue carries no per-row sentence at all: "one hue nationwide" is
  // true of the whole channel and would print once per operator in view.
  assert.equal(operatorRows.find((item) => item.label === 'Lime').blurb, null);

  // Each entry names the CHANNEL it answers, so two counts of the same 84
  // objects cannot be read as 168.
  assert.deepEqual([...new Set(kindRows.map((item) => item.channel))], ['forme = quoi']);
  assert.deepEqual([...new Set(operatorRows.map((item) => item.channel))], ['couleur = qui']);

  _setSharedMobilityStateForTest({ viewer: null, records: [] });
  assert.deepEqual(sharedMobilityFranceLayer.getRowControls().legend, []);
});

test('a crowded viewport names six operators and declares the tail it did not name', () => {
  // Silently dropping the seventh would read as "these are the operators here".
  const names = ['Lime Paris', 'Dott Paris', 'Voi Paris', 'Pony Paris', 'Bird Paris',
    'Citiz Paris', 'Cityscoot Paris', 'YEGO Paris'];
  _setSharedMobilityStateForTest({
    viewer: viewerWithView(null),
    records: names.flatMap((name, index) => Array.from(
      { length: names.length - index },
      (unused, copy) => vehicleRecord({ object: { id: `${index}:${copy}` }, system: { name } }),
    )),
  });
  const operatorRows = sharedMobilityFranceLayer.getRowControls().legend
    .filter((item) => item.glyph === undefined);
  assert.equal(operatorRows.length, 7, 'six named operators plus one tail row');
  assert.deepEqual(operatorRows.slice(0, 6).map((item) => item.label),
    ['Lime', 'Dott', 'Voi', 'Pony', 'Bird', 'Citiz']);
  const tail = operatorRows[6];
  assert.equal(tail.label, '+2 exploitants');
  assert.equal(tail.count, 2 + 1, 'the tail counts the objects it stands for');
  assert.match(tail.blurb, /Cityscoot/);
  assert.match(tail.blurb, /YEGO/);

  _setSharedMobilityStateForTest({ viewer: null, records: [] });
});

// --- The two halves of the fleet --------------------------------------------

/** Puts the layer back on the whole fleet, whatever a test before it pressed. */
function clearKindFilter() {
  _setSharedMobilityPayloadForTest(null);
  sharedMobilityFranceLayer.setParams({ kinds: 'all' });
  _setSharedMobilityStateForTest({ viewer: null, records: [] });
}

test('the two chips PARTITION the fleet — every kind lands on exactly one side', () => {
  const kinds = ['bike', 'ebike', 'scooter', 'moped', 'car', 'other'];
  for (const kind of kinds) {
    const sides = SHARED_MOBILITY_KIND_FILTERS
      .filter((filter) => matchesKindFilter(filter.id, 'vehicle', { kind }));
    assert.equal(sides.length, 1, `${kind} belongs to exactly one chip`);
  }
  assert.deepEqual(
    kinds.filter((kind) => matchesKindFilter('velo', 'vehicle', { kind })),
    ['bike', 'ebike'],
    'a VAE is a bike: the chip named "Vélos" cannot hide half of them',
  );
  // No filter is not a third state to test for — it keeps everything.
  assert.ok(matchesKindFilter(null, 'vehicle', { kind: 'car' }));
  assert.ok(matchesKindFilter(null, 'station', { byKind: { car: 3 } }));
});

test('a station is filed by what it holds, and an unreadable inventory reads as bikes', () => {
  assert.equal(stationHoldsBikes({ byKind: { bike: 5, ebike: 2 } }), true);
  assert.equal(stationHoldsBikes({ byKind: { ebike: 4 } }), true);
  assert.equal(stationHoldsBikes({ byKind: { car: 3 } }), false);
  assert.equal(stationHoldsBikes({ byKind: { scooter: 2, moped: 1 } }), false);
  // A dock whose bike count is zero still HOLDS bikes — it is empty, not a
  // car park, and the split is about what a place is for.
  assert.equal(stationHoldsBikes({ byKind: { bike: 0, car: 2 } }), false,
    'nothing recognisable AND a car declared: the car wins');
  // GBFS 3.0 publishes the system\'s own opaque vehicle_type_ids here, which
  // this layer cannot resolve — so does a feed with no breakdown at all. Both
  // fall back to the spec default: a system with no vehicle types runs bikes.
  assert.equal(stationHoldsBikes({ byKind: { 'vt-9f3a': 12 } }), true);
  assert.equal(stationHoldsBikes({ byKind: null }), true);
  assert.equal(stationHoldsBikes({}), true);
});

test('pressing a chip lights it, pressing it again releases the filter', () => {
  clearKindFilter();
  assert.deepEqual(
    sharedMobilityFranceLayer.getRowControls().chips.map((chip) => chip.active),
    [false, false],
    'neither lit is how an unfiltered row reads',
  );

  assert.equal(sharedMobilityFranceLayer.setParams({ kinds: 'velo' }), true);
  assert.deepEqual(sharedMobilityFranceLayer.getParams(), { kinds: 'velo' });
  const lit = sharedMobilityFranceLayer.getRowControls().chips;
  assert.deepEqual(lit.map((chip) => chip.active), [true, false]);
  assert.equal(lit[0].state, 'active');
  assert.match(lit[0].title, /Appuyer à nouveau/, 'the way back is written on the chip');
  assert.equal(lit[0].disabled, false, 'the lit chip is never the one refused');
  // The release is a VALUE, not a repeat: re-applying `velo` (a replayed
  // params intent, a lazy stub flushing its buffer) must not flip the filter
  // off behind the reader.
  assert.deepEqual(lit[0].params, { kinds: 'all' });
  assert.equal(sharedMobilityFranceLayer.setParams({ kinds: 'velo' }), false);
  assert.deepEqual(sharedMobilityFranceLayer.getParams(), { kinds: 'velo' });

  assert.equal(sharedMobilityFranceLayer.setParams(lit[0].params), true);
  assert.deepEqual(sharedMobilityFranceLayer.getParams(), { kinds: null });

  assert.equal(sharedMobilityFranceLayer.setParams({ kinds: 'trottinettes' }), false,
    'an id no chip publishes changes nothing');
  assert.equal(sharedMobilityFranceLayer.setParams({}), false);
  assert.deepEqual(sharedMobilityFranceLayer.getParams(), { kinds: null });
  clearKindFilter();
});

test('a chip counts the half it would hide, and refuses to blank the map', () => {
  clearKindFilter();
  _setSharedMobilityPayloadForTest({
    stations: [{ id: 's1', byKind: { bike: 4 } }, { id: 's2', byKind: { bike: 1 } }],
    vehicles: [{ id: 'v1', kind: 'ebike' }, { id: 'v2', kind: 'bike' }, { id: 'v3', kind: 'bike' }],
    systems: [],
  });
  const [velo, autres] = sharedMobilityFranceLayer.getRowControls().chips;
  assert.match(velo.title, /5 objets sur 5/);
  assert.equal(velo.disabled, false);
  // Nothing on the other side: the chip would leave an empty globe, so it is
  // refused rather than allowed to look broken.
  assert.match(autres.title, /0 objet sur 5/);
  assert.equal(autres.disabled, true);
  clearKindFilter();
});

// --- Staying on the ground when the map moves --------------------------------

test('a point placed before its floor landed is re-placed, not left on the ellipsoid', () => {
  // The bug this pins: a cold cell anchored the object at ellipsoid 0, which
  // under a French city is tens to hundreds of metres below the street. Depth
  // testing is off, so it is painted anyway — and its screen position then
  // follows the camera, sliding over the rooftops on every pan.
  setMeshFloorPreferred(true);
  const record = vehicleRecord({ object: { id: 'anchor:1', lat: 45.1881, lon: 5.7245 } });
  _setSharedMobilityStateForTest({ viewer: viewerWithView(null), records: [record] });

  const buried = Cesium.Cartographic.fromCartesian(record.position);
  assert.ok(Math.abs(buried.height - 12) < 0.001, 'seeded where the pre-fix code left it');

  reportMeshFloorCell(45.1881, 5.7245, 213.4);
  assert.equal(_reanchorSharedMobilityForTest(), 1, 'the floor landed, so the point moves');

  const placed = Cesium.Cartographic.fromCartesian(record.position);
  assert.ok(Math.abs(placed.height - (213.4 + 2.5)) < 0.05,
    `expected the Grenoble floor plus the lift, got ${placed.height}`);
  // The primitive is what is actually drawn — a record that agrees with the
  // floor while its billboard does not is the same bug with a passing test.
  assert.ok(Cesium.Cartesian3.equals(record.billboard.position, record.position));

  // Idempotent: a pass with nothing new to say must not dirty the collection.
  assert.equal(_reanchorSharedMobilityForTest(), 0);

  setMeshFloorPreferred(false);
  _setSharedMobilityStateForTest({ viewer: null, records: [] });
});
