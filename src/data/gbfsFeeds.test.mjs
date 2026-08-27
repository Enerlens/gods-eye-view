// French shared-mobility GBFS: the parsing quirks that fail SILENTLY, and the
// redundancy rules that decide what gets drawn.
//
// Every redundancy case below is a real one, measured against the live catalog
// on 2026-08-27. They are pinned because each was found by looking, not by
// reasoning — and because the failure mode of getting one wrong is either a
// fleet drawn twice or a whole city quietly missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  containment,
  coordSignature,
  findRedundantSystems,
  freeVehicleFeedUrl,
  gbfsAreaLabel,
  gbfsLicenceLabel,
  gbfsSystemName,
  gbfsSystemsFromCatalog,
  localizedText,
  normalizedSystemName,
  parseGbfsStationStatus,
  parseGbfsStations,
  parseGbfsVehicles,
  registrableDomain,
  resolveGbfsDiscovery,
  selectSystemsForBox,
  setsEqual,
  snapGbfsBox,
  validGbfsBox,
  vehicleKindFromType,
  vehicleKindLookup,
  GBFS_MAX_BOX_DEG,
} from './gbfsFeeds.js';

// --- Parsing ---------------------------------------------------------------

test('auto-discovery resolves both the 2.x language nesting and the 3.0 shape', () => {
  // 150 of the 172 French catalog entries point at one of these documents
  // rather than at a data file — which is exactly what the pre-existing GBFS
  // proxy, accepting only `station_*.json` paths, could not follow.
  const v2 = {
    data: { fr: { feeds: [{ name: 'station_status', url: 'https://x/station_status.json' }] } },
  };
  assert.deepEqual(resolveGbfsDiscovery(v2), { station_status: 'https://x/station_status.json' });

  const v3 = { data: { feeds: [{ name: 'vehicle_status.json', url: 'https://y/vehicle_status.json' }] } };
  assert.deepEqual(resolveGbfsDiscovery(v3), { vehicle_status: 'https://y/vehicle_status.json' });

  // A feed with no French block still resolves through its first language.
  const en = { data: { en: { feeds: [{ name: 'station_status', url: 'https://z/s.json' }] } } };
  assert.deepEqual(resolveGbfsDiscovery(en), { station_status: 'https://z/s.json' });

  assert.equal(resolveGbfsDiscovery({ data: {} }), null);
  assert.equal(resolveGbfsDiscovery(null), null);
});

test('the free-floating feed is found under either of its two spec names', () => {
  assert.equal(freeVehicleFeedUrl({ vehicle_status: 'https://a' }), 'https://a');
  assert.equal(freeVehicleFeedUrl({ free_bike_status: 'https://b' }), 'https://b');
  // 3.0 wins when a feed advertises both.
  assert.equal(freeVehicleFeedUrl({ vehicle_status: 'https://a', free_bike_status: 'https://b' }), 'https://a');
  assert.equal(freeVehicleFeedUrl({}), null);
});

test('a 3.0 localized name is read as text, not as "[object Object]"', () => {
  // This is the failure that renders every station label as [object Object] —
  // a silent one, because String() on an array of objects still "works".
  assert.equal(localizedText([{ language: 'en', text: 'Bay 12' }, { language: 'fr', text: 'Borne 12' }]), 'Borne 12');
  assert.equal(localizedText([{ language: 'en', text: 'Bay 12' }]), 'Bay 12');
  assert.equal(localizedText('Borne 12'), 'Borne 12');
  assert.equal(localizedText(''), null);
  assert.equal(localizedText(undefined), null);
});

test('station availability reads both the 2.x and the 3.0 count field', () => {
  // A reader that knows only `num_bikes_available` reports every station on a
  // 3.0 feed as empty — which looks like a dead system, not a parse error.
  const status = parseGbfsStationStatus({
    data: {
      stations: [
        { station_id: 'a', num_bikes_available: 7, num_docks_available: 4 },
        { station_id: 'b', num_vehicles_available: 5, num_docks_available: 1 },
        {
          station_id: 'c',
          num_bikes_available: 3,
          num_bikes_available_types: [{ mechanical: 1 }, { ebike: 2 }],
          is_renting: 0,
        },
      ],
    },
  });
  assert.equal(status.get('a').available, 7);
  assert.equal(status.get('b').available, 5);
  assert.deepEqual(status.get('c').byKind, { bike: 1, ebike: 2 });
  assert.equal(status.get('c').renting, false, 'is_renting: 0 is false, not truthy-by-default');
});

test('stations without a usable position are dropped rather than placed at Null Island', () => {
  const stations = parseGbfsStations({
    data: {
      stations: [
        { station_id: 'ok', name: 'Quai', lat: 44.84, lon: -0.58, capacity: 20 },
        { station_id: 'null-island', name: 'x', lat: 0, lon: 0 },
        { station_id: 'no-coords', name: 'x' },
        { station_id: '', lat: 44.8, lon: -0.5 },
        { station_id: 'out-of-range', lat: 130, lon: -0.5 },
      ],
    },
  });
  assert.deepEqual(stations.map((s) => s.id), ['ok']);
  assert.equal(stations[0].name, 'Quai');
  assert.equal(stations[0].capacity, 20);
});

test('a vehicle already counted at a station is not drawn a second time', () => {
  const vehicles = parseGbfsVehicles({
    data: {
      bikes: [
        { bike_id: 'free', lat: 48.86, lon: 2.35 },
        // Docked: its availability is already part of that station's count.
        { bike_id: 'docked', lat: 48.87, lon: 2.36, station_id: 'st-1' },
        { bike_id: 'broken', lat: 48.88, lon: 2.37, is_disabled: true },
        { bike_id: 'held', lat: 48.89, lon: 2.38, is_reserved: true },
      ],
    },
  });
  assert.deepEqual(vehicles.map((v) => v.id), ['free']);
});

test('vehicle kind follows form factor and propulsion, with the spec default', () => {
  assert.equal(vehicleKindFromType({ form_factor: 'bicycle', propulsion_type: 'human' }), 'bike');
  assert.equal(vehicleKindFromType({ form_factor: 'bicycle', propulsion_type: 'electric_assist' }), 'ebike');
  assert.equal(vehicleKindFromType({ form_factor: 'cargo_bicycle', propulsion_type: 'electric_assist' }), 'ebike');
  assert.equal(vehicleKindFromType({ form_factor: 'scooter_standing' }), 'scooter');
  assert.equal(vehicleKindFromType({ form_factor: 'car', propulsion_type: 'combustion' }), 'car');
  assert.equal(vehicleKindFromType({ form_factor: 'moped' }), 'moped');

  // "If this file is not included, then all vehicles in the feed are assumed
  // to be non-motorized bicycles" — GBFS spec.
  const noTypes = parseGbfsVehicles({ data: { bikes: [{ bike_id: 'a', lat: 1, lon: 1 }] } }, {});
  assert.equal(noTypes[0].kind, 'bike');

  const lookup = vehicleKindLookup({ data: { vehicle_types: [{ vehicle_type_id: '3', form_factor: 'scooter_standing' }] } });
  const typed = parseGbfsVehicles({ data: { bikes: [{ bike_id: 'a', lat: 1, lon: 1, vehicle_type_id: '3' }] } }, lookup);
  assert.equal(typed[0].kind, 'scooter');
});

// --- Identity and redundancy -----------------------------------------------

const places = (...pairs) => coordSignature(pairs.map(([lat, lon]) => ({ lat, lon })));
/** A ten-point network, offset so two calls can be made to overlap or not. */
const network = (offset = 0) => coordSignature(
  Array.from({ length: 10 }, (_, i) => ({ lat: 45 + offset + i * 0.01, lon: 4 + i * 0.01 })),
);

test('containment scores the smaller set, so a national feed matches its city feeds', () => {
  const national = network();
  const city = places([45, 4], [45.01, 4.01], [45.02, 4.02], [45.03, 4.03], [45.04, 4.04], [45.05, 4.05]);
  assert.equal(containment(city, national), 1);
  // Jaccard would score this pair 0.6 and miss it.
  assert.ok(containment(national, network(10)) < 0.2);
  // Too few points to judge is 0, not a coincidental 1.
  assert.equal(containment(places([1, 1]), places([1, 1])), 0);
  assert.equal(setsEqual(places([1, 1]), places([1, 1])), true);
});

test('registrable domain collapses a publisher\'s version subdomains', () => {
  // Ecovelo serves one system from two subdomains; a raw hostname comparison
  // would treat two versions of one network as two networks.
  assert.equal(registrableDomain('api.gbfs.v2.2.ecovelo.mobi'), 'ecovelo.mobi');
  assert.equal(registrableDomain('api.gbfs.v3.0.ecovelo.mobi'), 'ecovelo.mobi');
  assert.equal(registrableDomain('api.cyclocity.fr'), 'cyclocity.fr');
  assert.equal(registrableDomain('data.example.gouv.fr'), 'example.gouv.fr');
  assert.equal(registrableDomain(''), null);
});

test('an identical resolved URL is proof of duplication whatever the names', () => {
  // Dott publishes one feed as "France", "Paris", "Lyon", "Bordeaux",
  // "OL Vallée" and "Bourgoin-Jaillieu" — six catalog rows, one system.
  const url = 'https://gbfs.api.ridedott.com/public/v2/paris/station_status.json';
  const rows = ['france', 'paris', 'lyon'].map((slug) => ({
    id: `gbfs-${slug}`, statusUrl: url, domain: 'ridedott.com',
    places: network(), fleet: network(5), stationCount: 10,
    normalizedName: `dott ${slug}`,
  }));
  const verdicts = findRedundantSystems(rows);
  assert.equal(verdicts.size, 2, 'one survivor, two duplicates');
  for (const verdict of verdicts.values()) assert.equal(verdict.reason, 'identical-url');
});

test('one dock network on two publisher hosts is recognised as one system', () => {
  // Vélo'v Lyon is served by JCDecaux AND by the Métropole: different hosts,
  // different domains, 464 identical stations. No URL comparison catches this.
  const shared = network();
  const jcdecaux = {
    id: 'gbfs-velov', statusUrl: 'https://api.cyclocity.fr/contracts/lyon/gbfs/v2/station_status.json',
    domain: 'cyclocity.fr', docked: true, places: shared, fleet: new Set(),
    stationCount: 10, normalizedName: 'velo v lyon',
  };
  const metropole = {
    id: 'bikeshare:lyon-velov', statusUrl: 'https://download.data.grandlyon.com/files/rdata/x/station_status.json',
    domain: 'grandlyon.com', docked: true, places: shared, fleet: new Set(),
    stationCount: 10, normalizedName: 'velo v',
  };
  const verdicts = findRedundantSystems([jcdecaux], { alreadyCovered: [metropole] });
  assert.equal(verdicts.get('gbfs-velov').with, 'bikeshare:lyon-velov');
  assert.equal(verdicts.get('gbfs-velov').reason, 'same-places');
});

test('two free-floating operators sharing municipal bays are NOT one system', () => {
  // Paris makes free-floating operators park in city bays, and each operator
  // republishes that one set as its own `station_information`. Voi and Dott
  // share 96.6% of their station positions while running different fleets —
  // the first build of this index marked one as a duplicate of the other.
  const cityBays = network();
  const voi = {
    id: 'gbfs-voi', statusUrl: 'https://api.voiapp.io/…/station_status.json',
    domain: 'voiapp.io', docked: false, places: cityBays, fleet: network(3),
    stationCount: 10, normalizedName: 'voi paris',
  };
  const dott = {
    id: 'gbfs-dott', statusUrl: 'https://gbfs.api.ridedott.com/…/station_status.json',
    domain: 'ridedott.com', docked: false, places: cityBays, fleet: network(20),
    stationCount: 10, normalizedName: 'dott paris',
  };
  const verdicts = findRedundantSystems([voi, dott]);
  assert.equal(verdicts.size, 0, 'different operators, different fleets — both are drawn');
});

test('an aggregator mirroring a small network is caught on name and shape', () => {
  // Okina republishes Ecovelo systems from an unrelated domain. Positions
  // alone cannot prove it (shared bays look the same), and the networks are
  // too small for a statistical containment verdict — so the rule is narrow:
  // identical operator name, identical station count, identical places.
  const tiny = places([45.18, 0.72], [45.19, 0.73], [45.20, 0.74]);
  const ecovelo = {
    id: 'gbfs-ecovelo', statusUrl: 'https://api.gbfs.v3.0.ecovelo.mobi/perivelo/station_status.json',
    domain: 'ecovelo.mobi', docked: false, places: tiny, fleet: network(),
    stationCount: 3, normalizedName: 'perivelo grand perigueux',
  };
  const okina = {
    id: 'gbfs-okina', statusUrl: 'https://api.okina.fr/gateway/nam/gbfs/gbfs/v2/perivelo_ecovelo/station_status',
    domain: 'okina.fr', docked: false, places: tiny, fleet: network(4),
    stationCount: 3, normalizedName: 'perivelo grand perigueux',
  };
  const verdicts = findRedundantSystems([ecovelo, okina]);
  assert.equal(verdicts.size, 1);
  assert.equal([...verdicts.values()][0].reason, 'mirrored-system');
});

test('two city feeds sharing an operator name are kept apart', () => {
  // Dott's per-city feeds all carry the dataset title "Dott France". They are
  // genuinely different cities, and the mirror rule must not collapse them.
  const lyon = {
    id: 'gbfs-lyon', statusUrl: 'https://gbfs.api.ridedott.com/public/v2/lyon/station_status.json',
    domain: 'ridedott.com', docked: false, places: network(), fleet: network(),
    stationCount: 1417, normalizedName: 'dott france',
  };
  const bordeaux = {
    id: 'gbfs-bordeaux', statusUrl: 'https://gbfs.api.ridedott.com/public/v2/bordeaux/station_status.json',
    domain: 'ridedott.com', docked: false, places: network(30), fleet: network(30),
    stationCount: 3460, normalizedName: 'dott france',
  };
  assert.equal(findRedundantSystems([lyon, bordeaux]).size, 0);
});

test('the survivor of a duplicate group is the most complete feed', () => {
  const url = 'https://x/station_status.json';
  const big = { id: 'gbfs-big', statusUrl: url, places: network(), fleet: network(2), stationCount: 10, normalizedName: 'n' };
  const small = { id: 'gbfs-small', statusUrl: url, places: places([45, 4], [45.01, 4.01]), fleet: new Set(), stationCount: 2, normalizedName: 'n' };
  const verdicts = findRedundantSystems([small, big]);
  assert.equal(verdicts.has('gbfs-small'), true, 'the smaller feed is the duplicate');
  assert.equal(verdicts.has('gbfs-big'), false);
});

// --- Catalog and viewport ---------------------------------------------------

test('catalog selection keeps available GBFS resources and names them for riders', () => {
  const datasets = [{
    title: 'VLS Vélam Amiens',
    licence: 'lov2',
    page_url: 'https://transport.data.gouv.fr/datasets/velam',
    publisher: { name: 'Amiens Métropole' },
    covered_area: [{ nom: 'Amiens Métropole' }],
    resources: [
      { id: 11, format: 'gbfs', is_available: true, original_url: 'https://a/gbfs.json', page_url: 'https://p/11' },
      { id: 12, format: 'gbfs', is_available: false, original_url: 'https://b/gbfs.json' },
      { id: 13, format: 'GTFS', is_available: true, original_url: 'https://c.zip' },
    ],
  }];
  const systems = gbfsSystemsFromCatalog(datasets);
  assert.deepEqual(systems.map((s) => s.id), ['gbfs-11']);
  assert.equal(systems[0].name, 'Vélam Amiens', 'the "VLS" category prefix is noise');
  assert.equal(systems[0].licenceLabel, 'Licence Ouverte 2.0');
  assert.equal(systems[0].area, 'Amiens Métropole');
  assert.equal(gbfsSystemName({ title: 'Vélos et trottinettes Dott Paris' }), 'Dott Paris');
  assert.equal(gbfsSystemName({ title: 'Autopartage Citiz Grand Est' }), 'Citiz Grand Est');
  assert.equal(gbfsAreaLabel({ covered_area: [{ nom: 'A' }, { nom: 'B' }] }), 'A · B');
  assert.equal(gbfsLicenceLabel('odc-odbl'), 'ODbL 1.0');
  assert.equal(normalizedSystemName("Vélo'v Lyon"), 'velo v lyon');
});

test('a viewport wider than the ceiling is refused, and the grid only grows', () => {
  const city = { south: 48.84, west: 2.30, north: 48.88, east: 2.38 };
  assert.deepEqual(validGbfsBox(city), city);
  assert.equal(validGbfsBox({ south: 42, west: -2, north: 51, east: 8 }), null);
  const snapped = snapGbfsBox(city);
  assert.ok(snapped.south <= city.south && snapped.north >= city.north);
  assert.ok(validGbfsBox({ south: 40, west: 0, north: 40 + GBFS_MAX_BOX_DEG, east: 1 }));
});

test('viewport selection ranks by how much of a system is on screen, and skips duplicates', () => {
  const city = { id: 'a', bbox: { south: 48.84, west: 2.30, north: 48.88, east: 2.38 }, objectSample: 400 };
  const national = { id: 'b', bbox: { south: 43, west: -2, north: 51, east: 8 }, objectSample: 9000 };
  const dupe = { id: 'c', bbox: { south: 48.84, west: 2.30, north: 48.88, east: 2.38 }, objectSample: 9999, redundant: { with: 'a', reason: 'identical-url' } };
  const elsewhere = { id: 'd', bbox: { south: 44, west: -1, north: 45, east: 0 }, objectSample: 50 };
  const box = { south: 48.85, west: 2.32, north: 48.87, east: 2.36 };

  const result = selectSystemsForBox([national, city, dupe, elsewhere], box, { maxSystems: 5 });
  assert.deepEqual(result.selected.map((s) => s.id), ['a', 'b']);
  assert.equal(result.matched, 2, 'the duplicate never competes and the far system never matches');

  const capped = selectSystemsForBox([national, city], box, { maxSystems: 1 });
  assert.deepEqual(capped.selected.map((s) => s.id), ['a']);
  assert.equal(capped.truncated, true);
});
