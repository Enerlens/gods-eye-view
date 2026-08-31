// The PAN catalog rules: which resources become feeds, what a network is
// called, and which feeds a viewport is allowed to pull. The catalog publishes
// coverage as a NAME and never as geometry, so every selection decision here
// runs on OBSERVED bounds — which makes the ranking rule, the caps and the
// grow-only merge the things worth pinning.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boxContains,
  boxOverlapArea,
  boxesIntersect,
  isTripUpdateResource,
  isVehiclePositionResource,
  mergeObservedBounds,
  panGeoJsonConversionUrl,
  padTransitBox,
  panAreaLabel,
  panFeedDescriptor,
  panLicenceLabel,
  panModes,
  panNetworkName,
  selectFeedsForBox,
  snapTransitBox,
  transitBoxKey,
  validTransitBox,
  staticGtfsResources,
  vehiclePositionFeedsFromCatalog,
  PAN_BOX_STEP_DEG,
  PAN_MAX_BOX_DEG,
  PAN_UNKNOWN_FOOTPRINT_SLOTS,
  PAN_UNKNOWN_PROBE_MARGIN_DEG,
} from './panFeeds.js';

/** A catalog dataset shaped exactly like `GET /api/datasets` returns them. */
function dataset(overrides = {}) {
  return {
    id: '647148f898aadb3cec613674',
    title: 'Réseau urbain et scolaire TBM',
    slug: 'reseau-tbm',
    licence: 'lov2',
    type: 'public-transit',
    sub_types: ['urban', 'school'],
    page_url: 'https://transport.data.gouv.fr/datasets/reseau-tbm',
    publisher: { name: 'Bordeaux Métropole', type: 'organization' },
    covered_area: [{ type: 'epci', nom: 'Bordeaux Métropole', insee: '243300316' }],
    offers: [{ nom_commercial: 'TBM', identifiant_offre: 12, nom_aom: 'Bordeaux Métropole' }],
    resources: [
      {
        id: 84094,
        datagouv_id: '3a40f4e7-3068-43d2-9cd1-7b33cb0c2fe5',
        format: 'gtfs-rt',
        features: ['vehicle_positions', 'trip_updates'],
        is_available: true,
        url: 'https://www.data.gouv.fr/api/1/datasets/r/3a40f4e7',
        page_url: 'https://transport.data.gouv.fr/resources/84094',
      },
    ],
    ...overrides,
  };
}

test('only available gtfs-rt resources declaring vehicle positions become feeds', () => {
  const catalog = [dataset({
    resources: [
      // The one we want.
      { id: 1, format: 'gtfs-rt', features: ['vehicle_positions'], is_available: true, url: 'https://a' },
      // GTFS-RT, but it only carries trip updates — no positions to draw.
      { id: 2, format: 'gtfs-rt', features: ['trip_updates'], is_available: true, url: 'https://b' },
      // The catalog already knows this one is down; polling it is pure noise.
      { id: 3, format: 'gtfs-rt', features: ['vehicle_positions'], is_available: false, url: 'https://c' },
      // Static schedules, SIRI and GBFS are other formats entirely.
      { id: 4, format: 'GTFS', features: [], is_available: true, url: 'https://d' },
      { id: 5, format: 'SIRI', features: ['vehicle_positions'], is_available: true, url: 'https://e' },
      // No URL — nothing to fetch.
      { id: 6, format: 'gtfs-rt', features: ['vehicle_positions'], is_available: true, url: '' },
    ],
  })];
  const feeds = vehiclePositionFeedsFromCatalog(catalog);
  assert.deepEqual(feeds.map((feed) => feed.id), ['pan-1']);
  assert.equal(isVehiclePositionResource(catalog[0].resources[1]), false);
  assert.equal(isVehiclePositionResource(catalog[0].resources[2]), false);
});

test('two vehicle-position resources under one dataset stay two feeds', () => {
  // Montpellier's TaM splits bus and tram across two resources; collapsing on
  // the dataset id would silently drop half the city.
  const feeds = vehiclePositionFeedsFromCatalog([dataset({
    title: 'Réseau urbain TaM',
    resources: [
      { id: 300, format: 'gtfs-rt', features: ['vehicle_positions'], is_available: true, url: 'https://bus' },
      { id: 301, format: 'gtfs-rt', features: ['vehicle_positions'], is_available: true, url: 'https://tram' },
    ],
  })]);
  assert.deepEqual(feeds.map((feed) => feed.id), ['pan-300', 'pan-301']);
});

test('a single-offer dataset is named for the brand, an aggregate for the dataset', () => {
  assert.equal(panNetworkName(dataset()), 'TBM');

  // Normandy publishes 22 networks through one feed. Naming it after the first
  // offer would label every vehicle in the région "Astrobus".
  const aggregate = dataset({
    title: 'Agrégat des réseaux urbains et interurbains de Normandie',
    offers: [{ nom_commercial: 'Astrobus' }, { nom_commercial: 'Ficibus' }, { nom_commercial: 'Vikibus' }],
  });
  assert.equal(panNetworkName(aggregate), 'Agrégat des réseaux urbains et interurbains de Normandie');

  assert.equal(panNetworkName({ title: '', offers: [] }), 'Réseau sans nom');
});

test('a descriptor carries the provenance the card and the popover print', () => {
  const feed = panFeedDescriptor(dataset(), dataset().resources[0]);
  assert.equal(feed.id, 'pan-84094');
  assert.equal(feed.network, 'TBM');
  assert.equal(feed.area, 'Bordeaux Métropole');
  assert.deepEqual(feed.modes, ['urban', 'school']);
  assert.equal(feed.licence, 'lov2');
  assert.equal(feed.licenceLabel, 'Licence Ouverte 2.0');
  assert.equal(feed.publisher, 'Bordeaux Métropole');
  assert.equal(feed.pageUrl, 'https://transport.data.gouv.fr/resources/84094');
  assert.equal(feed.datasetUrl, 'https://transport.data.gouv.fr/datasets/reseau-tbm');
  assert.equal(feed.bbox, null, 'a fresh descriptor has no footprint until one is measured');
  assert.equal(panFeedDescriptor(dataset(), { id: null, url: 'https://x' }), null);
});

test('licence codes resolve to the label a human can act on', () => {
  assert.equal(panLicenceLabel('lov2'), 'Licence Ouverte 2.0');
  assert.equal(panLicenceLabel('odc-odbl'), 'ODbL 1.0');
  assert.equal(panLicenceLabel('fr-lo'), 'Licence Ouverte 1.0');
  assert.equal(panLicenceLabel(''), 'Licence non précisée');
  // An unknown code is surfaced verbatim rather than flattened into "open".
  assert.equal(panLicenceLabel('cc-by-sa-4.0'), 'cc-by-sa-4.0');
});

test('modes and area labels degrade to something true, never to something invented', () => {
  assert.deepEqual(panModes({ sub_types: [] }), ['urban']);
  assert.deepEqual(panModes({ sub_types: ['urban', 'urban', 'school'] }), ['urban', 'school']);
  assert.equal(panAreaLabel({ covered_area: [{ nom: 'Occitanie' }, { nom: 'Aude' }] }), 'Occitanie · Aude');
  assert.equal(panAreaLabel({}), '');
});

test('a viewport wider than the request ceiling is refused, not silently cropped', () => {
  const paris = { south: 48.80, west: 2.25, north: 48.92, east: 2.45 };
  assert.deepEqual(validTransitBox(paris), paris);

  // Half of France. Cropping this to a centred 6-degree box would answer a
  // question the operator did not ask and read as "this is everything".
  assert.equal(validTransitBox({ south: 42, west: -2, north: 51, east: 8 }), null);
  assert.equal(validTransitBox({ south: 48.9, west: 2.25, north: 48.8, east: 2.45 }), null);
  assert.equal(validTransitBox({ south: 48.8, west: 179, north: 48.9, east: -179 }), null);
  assert.equal(validTransitBox({ south: 'x', west: 2, north: 3, east: 4 }), null);
  assert.equal(
    validTransitBox({ south: 40, west: 0, north: 40 + PAN_MAX_BOX_DEG, east: 1 }).north,
    40 + PAN_MAX_BOX_DEG,
    'exactly at the ceiling is still answerable',
  );
});

test('the cache grid only ever grows a box, so a hit always covers the ask', () => {
  const requested = { south: 44.83, west: -0.72, north: 44.91, east: -0.51 };
  const snapped = snapTransitBox(requested);
  assert.ok(snapped.south <= requested.south);
  assert.ok(snapped.west <= requested.west);
  assert.ok(snapped.north >= requested.north);
  assert.ok(snapped.east >= requested.east);

  // Two viewports a few streets apart quantize onto one cache entry.
  const neighbour = snapTransitBox({ south: 44.84, west: -0.71, north: 44.92, east: -0.52 });
  assert.equal(transitBoxKey(snapped), transitBoxKey(snapTransitBox(requested)));
  assert.ok(Math.abs(neighbour.south - snapped.south) <= PAN_BOX_STEP_DEG);

  // A value already on a grid line must not jump a whole cell (binary rounding).
  const exact = snapTransitBox({ south: 44.8, west: -0.75, north: 44.95, east: -0.5 });
  assert.deepEqual(exact, { south: 44.8, west: -0.75, north: 44.95, east: -0.5 });
});

test('box geometry helpers agree on edges and disjoint pairs', () => {
  const a = { south: 0, west: 0, north: 2, east: 2 };
  assert.equal(boxesIntersect(a, { south: 1, west: 1, north: 3, east: 3 }), true);
  assert.equal(boxesIntersect(a, { south: 2, west: 2, north: 4, east: 4 }), true, 'edge contact counts');
  assert.equal(boxesIntersect(a, { south: 5, west: 5, north: 6, east: 6 }), false);
  assert.equal(boxOverlapArea(a, { south: 1, west: 1, north: 3, east: 3 }), 1);
  assert.equal(boxOverlapArea(a, { south: 5, west: 5, north: 6, east: 6 }), 0);
  assert.equal(boxContains(a, 1, 1), true);
  assert.equal(boxContains(a, 3, 1), false);
  assert.deepEqual(padTransitBox(a, 0.5), { south: -0.5, west: -0.5, north: 2.5, east: 2.5 });
  assert.deepEqual(padTransitBox({ south: -89.9, west: 0, north: 2, east: 179.9 }, 1).south, -90);
});

/**
 * Feed index entries with observed footprints, shaped like the real ones:
 * a métropole network inside one city, a région-wide coach network that
 * contains it, and a network 500 km away.
 */
const METRO = { id: 'pan-metro', url: 'https://metro', bbox: { south: 44.76, west: -0.80, north: 44.96, east: -0.46 }, vehicleSample: 321 };
const REGION = { id: 'pan-region', url: 'https://region', bbox: { south: 43.0, west: -1.80, north: 46.50, east: 1.50 }, vehicleSample: 128 };
const ELSEWHERE = { id: 'pan-elsewhere', url: 'https://elsewhere', bbox: { south: 50.3, west: 2.4, north: 50.6, east: 3.1 }, vehicleSample: 128 };
/** A viewport over the whole métropole — it contains METRO and clips REGION. */
const CITY_VIEW = { south: 44.70, west: -0.90, north: 45.00, east: -0.40 };
const UNKNOWN_A = { id: 'pan-unknown-a', url: 'https://ua', bbox: null };
const UNKNOWN_B = { id: 'pan-unknown-b', url: 'https://ub', bbox: null };
const UNKNOWN_C = { id: 'pan-unknown-c', url: 'https://uc', bbox: null };

test('a metro fully on screen outranks a région clipping the same corner', () => {
  // Raw overlap area ranks these the other way round: the région's slice of
  // this viewport (0.15 deg^2) is larger than the whole métropole (0.068), so
  // an area-ranked selection would fetch the coach network first and, under a
  // tight cap, instead of the city the operator is looking at.
  assert.ok(boxOverlapArea(REGION.bbox, CITY_VIEW) > boxOverlapArea(METRO.bbox, CITY_VIEW));
  const { selected } = selectFeedsForBox([REGION, METRO], CITY_VIEW, { maxFeeds: 2, unknownSlots: 0 });
  assert.deepEqual(selected.map((feed) => feed.id), ['pan-metro', 'pan-region']);
});

test('a confirmed duplicate never takes a feed slot from a live network', () => {
  // Kicéo publishes one body under two resource ids; measured 2026-08-31 both
  // returned the same 62 vehicles at the same 62 coordinates. The twin is
  // carried in the index (so a later build can revive it) and never fetched.
  const twin = { ...METRO, id: 'pan-metro-twin', duplicateOf: 'pan-metro' };
  const result = selectFeedsForBox([METRO, twin], CITY_VIEW, { maxFeeds: 8, unknownSlots: 0 });
  assert.deepEqual(result.selected.map((feed) => feed.id), ['pan-metro']);
  assert.equal(result.matched, 1, 'the twin does not even count as matched');
});

test('a quarantined feed is skipped, and a merely-failing one is not', () => {
  const dead = { ...REGION, id: 'pan-dead', health: { consecutiveFailures: 3, quarantined: true } };
  const flaky = { ...REGION, id: 'pan-flaky', health: { consecutiveFailures: 1, quarantined: false } };
  const result = selectFeedsForBox([METRO, dead, flaky], CITY_VIEW, { maxFeeds: 8, unknownSlots: 0 });
  assert.deepEqual(result.selected.map((feed) => feed.id).sort(), ['pan-flaky', 'pan-metro']);
});

test('disjoint feeds are never fetched, and truncation is reported honestly', () => {
  const result = selectFeedsForBox([METRO, REGION, ELSEWHERE], CITY_VIEW, { maxFeeds: 1, unknownSlots: 0 });
  assert.deepEqual(result.selected.map((feed) => feed.id), ['pan-metro']);
  assert.equal(result.matched, 2, 'two feeds intersect');
  assert.equal(result.truncated, true, 'and the caller is told one was left out');
});

test('feeds with no footprint keep a bounded, rotating chance to reveal themselves', () => {
  // A school network probed at night has no bbox. Selection is bbox-driven, so
  // without a reserved slot it could never be seen again.
  const feeds = [METRO, UNKNOWN_A, UNKNOWN_B, UNKNOWN_C];

  const first = selectFeedsForBox(feeds, CITY_VIEW, { maxFeeds: 8, rotation: 0 });
  assert.equal(first.unknown, PAN_UNKNOWN_FOOTPRINT_SLOTS);
  assert.equal(first.selected.length, 1 + PAN_UNKNOWN_FOOTPRINT_SLOTS);
  assert.equal(first.selected[0].id, 'pan-metro', 'known feeds always come first');

  // Successive polls cover the unknown set rather than probing the same two.
  const rounds = new Set();
  for (let rotation = 0; rotation < 3; rotation++) {
    for (const feed of selectFeedsForBox(feeds, CITY_VIEW, { maxFeeds: 8, rotation }).selected) {
      if (!feed.bbox) rounds.add(feed.id);
    }
  }
  assert.equal(rounds.size, 3, 'every unknown feed gets a turn');
});

test('the unknown allowance is not spent on a viewport nowhere near coverage', () => {
  // A feed with no bbox could be anywhere, which on its own would justify
  // polling French networks from a camera parked over Tokyo.
  const tokyo = { south: 35.6, west: 139.6, north: 35.8, east: 139.9 };
  const far = selectFeedsForBox([METRO, REGION, UNKNOWN_A, UNKNOWN_B], tokyo, { maxFeeds: 8 });
  assert.equal(far.nearKnownCoverage, false);
  assert.equal(far.unknown, 0);
  assert.deepEqual(far.selected, []);

  // Just outside every footprint but within the probe margin, the allowance
  // still applies — that is how a dormant network near real coverage is found.
  const nearby = {
    south: METRO.bbox.north + PAN_UNKNOWN_PROBE_MARGIN_DEG - 0.2,
    west: METRO.bbox.west,
    north: METRO.bbox.north + PAN_UNKNOWN_PROBE_MARGIN_DEG - 0.1,
    east: METRO.bbox.east,
  };
  const near = selectFeedsForBox([METRO, UNKNOWN_A, UNKNOWN_B], nearby, { maxFeeds: 8 });
  assert.equal(near.nearKnownCoverage, true);
  assert.equal(near.matched, 0, 'no footprint actually intersects');
  assert.equal(near.unknown, PAN_UNKNOWN_FOOTPRINT_SLOTS);
});

test('the unknown allowance never displaces a feed that is actually on screen', () => {
  const result = selectFeedsForBox([REGION, METRO, UNKNOWN_A, UNKNOWN_B], CITY_VIEW, { maxFeeds: 2 });
  assert.equal(result.selected.length, 2);
  assert.ok(result.selected.every((feed) => feed.bbox), 'the cap is spent on known coverage first');
});

test('observed footprints only ever grow', () => {
  const rushHour = { south: 44.70, west: -0.90, north: 45.00, east: -0.40 };
  const sundayNight = { south: 44.85, west: -0.60, north: 44.90, east: -0.50 };
  assert.deepEqual(mergeObservedBounds(rushHour, sundayNight), rushHour);
  assert.deepEqual(mergeObservedBounds(null, sundayNight), sundayNight);
  assert.deepEqual(mergeObservedBounds(rushHour, null), rushHour);
  assert.equal(mergeObservedBounds(null, null), null);
  assert.deepEqual(
    mergeObservedBounds(sundayNight, { south: 44.80, west: -0.70, north: 44.95, east: -0.45 }),
    { south: 44.80, west: -0.70, north: 44.95, east: -0.45 },
  );
});

// --- The companion resources a click needs --------------------------------
//
// A live position answers "a bus is here". The line under it lives in two
// sibling resources of the same dataset: the TripUpdates feed (this run's
// stops) and the static GTFS (the line's trace). Both are selected by the same
// declared-feature and availability rules the position feed is.

test('a trip-update resource is recognised by its declared feature, not its title', () => {
  assert.equal(isTripUpdateResource({
    format: 'gtfs-rt', id: 83025, url: 'https://example/tu', features: ['trip_updates'],
  }), true);
  // A resource TITLED "TripUpdates" that declares only positions is a position
  // feed; the catalog's own feature list is the contract.
  assert.equal(isTripUpdateResource({
    format: 'gtfs-rt', id: 1, url: 'https://example/x', title: 'GTFS-RT TripUpdates',
    features: ['vehicle_positions'],
  }), false);
  // The PAN's own "we could not reach this" flag is respected, exactly as it
  // is for positions: polling a resource the catalog knows is down is noise.
  assert.equal(isTripUpdateResource({
    format: 'gtfs-rt', id: 2, url: 'https://example/y', features: ['trip_updates'],
    is_available: false,
  }), false);
  assert.equal(isTripUpdateResource({ format: 'GTFS', id: 3, url: 'u' }), false);
  assert.equal(isTripUpdateResource(null), false);
});

test('static GTFS resources are kept as a list, in catalog order', () => {
  // STAR Rennes publishes "version en cours" and "version à venir"; reducing
  // them to a guess is how a checkout ends up reading the one that 404s.
  const dataset = {
    resources: [
      { format: 'gtfs-rt', id: 1, url: 'https://example/rt', features: ['vehicle_positions'] },
      { format: 'GTFS', id: 10, url: 'https://example/current', title: 'version en cours' },
      { format: 'GTFS', id: 11, url: 'https://example/next', title: 'version à venir' },
      { format: 'GTFS', id: 12, title: 'no url at all' },
      { format: 'NeTEx', id: 13, url: 'https://example/netex' },
    ],
  };
  assert.deepEqual(staticGtfsResources(dataset).map((resource) => resource.id), [10, 11]);
  assert.deepEqual(staticGtfsResources({}), []);
});

test('the GeoJSON conversion URL is derived from the resource id', () => {
  assert.equal(
    panGeoJsonConversionUrl(83024),
    'https://transport.data.gouv.fr/resources/conversions/83024/GeoJSON',
  );
});
