// The keyless search box's geocoder: /api/geocode maps OpenStreetMap (Nominatim)
// and IGN Géoplateforme answers onto the three things every framing decision in
// src/locations.js is made from — a location, a viewport, and Google-shaped
// `types`. Pure mapping tests against responses captured live on 2026-08-31.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import createViteConfig, {
  GEOCODE_BIAS_MAX_SPAN_DEG,
  GEOCODE_POINT_BOX_DEG,
  GEOCODE_SEARCH_CACHE_MS,
  GEOCODE_SEARCH_MISS_CACHE_MS,
  geocodeBiasIsUseful,
  geocodeSearchCacheKey,
  GEOCODE_GEOPLATEFORME_MIN_SCORE,
  GEOCODE_PROMINENCE_OVERRIDE,
  chooseGeocodeRow,
  geocodeSourceAttribution,
  geoplateformeSearchUrl,
  nominatimSearchUrl,
  nominatimViewport,
  normalizeGeoplateformeFeature,
  normalizeNominatimSearchResult,
  osmSearchTypes,
  parseGeocodeViewbox,
  shortenGeocodeLabel,
} from '../../vite.config.js';
import { geocodeNavigationMode } from '../locations.js';

/** The framing mode a live Nominatim row actually produces, end to end. */
const modeOf = (row) => geocodeNavigationMode(normalizeNominatimSearchResult(row).types);

test('the geocode proxy installs on both the dev and the preview server', () => {
  const plugin = createViteConfig({ mode: 'test' }).plugins
    .find((entry) => entry.name === 'keyless-geocode-proxy');
  assert.ok(plugin, 'keyless-geocode-proxy must be registered');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});

test('a viewbox is parsed only when it describes a real, expressible box', () => {
  assert.deepEqual(parseGeocodeViewbox('-97.95,30.10,-97.55,30.52'),
    { west: -97.95, south: 30.10, east: -97.55, north: 30.52 });
  assert.equal(parseGeocodeViewbox(''), null);
  assert.equal(parseGeocodeViewbox('-97.95,30.10,-97.55'), null);
  assert.equal(parseGeocodeViewbox('a,b,c,d'), null);
  assert.equal(parseGeocodeViewbox('-190,30,10,40'), null, 'out of range');
  assert.equal(parseGeocodeViewbox('10,30,10,40'), null, 'degenerate longitude span');
  // An antimeridian-crossing view: Nominatim's viewbox cannot say "the short way
  // round", and biasing a search to the wrong 350° is worse than not biasing it.
  assert.equal(parseGeocodeViewbox('172.3,30,-178.4,40'), null);
});

test('bias is only paid for when the view is tight enough to mean something', () => {
  assert.equal(geocodeBiasIsUseful(parseGeocodeViewbox('-97.95,30.10,-97.55,30.52')), true);
  assert.equal(geocodeBiasIsUseful(null), false);
  // A globe view names no neighbourhood; the bounded pass would only cost a request.
  const globe = { west: -180, south: -85, east: 180, north: 85 };
  assert.equal(geocodeBiasIsUseful(globe), false);
  const edge = { west: 0, south: 0, east: GEOCODE_BIAS_MAX_SPAN_DEG, north: GEOCODE_BIAS_MAX_SPAN_DEG };
  assert.equal(geocodeBiasIsUseful(edge), true);
});

test('a biased search is BOUNDED, because viewbox alone does not bias Nominatim', () => {
  // Measured 2026-08-31: "sixth street" with an Austin viewbox and limit=10
  // still answers Kampala; bounded=1 answers East 6th Street.
  const bounded = new URL(nominatimSearchUrl('sixth street', {
    viewbox: { west: -97.95, south: 30.1, east: -97.55, north: 30.52 },
  }));
  assert.equal(bounded.searchParams.get('bounded'), '1');
  assert.equal(bounded.searchParams.get('viewbox'), '-97.95,30.1,-97.55,30.52');
  assert.equal(bounded.searchParams.get('format'), 'jsonv2');
  const worldwide = new URL(nominatimSearchUrl('sixth street', { lang: 'fr' }));
  assert.equal(worldwide.searchParams.get('bounded'), null);
  assert.equal(worldwide.searchParams.get('viewbox'), null);
  assert.equal(worldwide.searchParams.get('accept-language'), 'fr');
  assert.equal(worldwide.searchParams.get('q'), 'sixth street');
});

test('the France backstop asks BAN and the IGN POI index together', () => {
  const url = new URL(geoplateformeSearchUrl('12 rue de Rivoli 75004 Paris'));
  assert.equal(url.host, 'data.geopf.fr');
  assert.equal(url.searchParams.get('index'), 'address,poi');
  assert.equal(url.searchParams.get('q'), '12 rue de Rivoli 75004 Paris');
});

test('OSM feature classes map onto the framing modes the camera already has', () => {
  // Roles: Toulouse is boundary/administrative by tagging, a city by role.
  assert.equal(modeOf({ lat: '43.60', lon: '1.44', category: 'boundary', type: 'administrative', addresstype: 'city' }), 'city-overview');
  assert.equal(modeOf({ lat: '46.60', lon: '1.88', category: 'boundary', type: 'administrative', addresstype: 'country' }), 'region-overview');
  assert.equal(modeOf({ lat: '0', lon: '0', category: 'boundary', type: 'administrative', addresstype: 'state' }), 'region-overview');
  assert.equal(modeOf({ lat: '0', lon: '0', category: 'place', type: 'suburb', addresstype: 'suburb' }), 'neighborhood-close');
  // Classes: a street is a corridor and a park is an area whatever the role says.
  assert.equal(modeOf({ lat: '48.86', lon: '2.33', category: 'highway', type: 'residential', addresstype: 'road' }), 'street-corridor');
  assert.equal(modeOf({ lat: '30.26', lon: '-97.76', category: 'leisure', type: 'park', addresstype: 'park' }), 'area-overview');
  assert.equal(modeOf({ lat: '45.83', lon: '6.86', category: 'natural', type: 'peak', addresstype: 'peak' }), 'area-overview');
  assert.equal(modeOf({ lat: '0', lon: '0', category: 'aeroway', type: 'aerodrome' }), 'area-overview');
  assert.equal(modeOf({ lat: '0', lon: '0', category: 'amenity', type: 'university' }), 'area-overview');
  // The Eiffel Tower is a man_made tower: no area type, so close building framing.
  assert.equal(modeOf({ lat: '48.85', lon: '2.29', category: 'man_made', type: 'tower', addresstype: 'man_made' }), 'precise-place');
  assert.deepEqual(osmSearchTypes({ category: 'man_made', type: 'tower' }), []);
  // Nominatim's older `class` spelling is read the same as `category`.
  assert.deepEqual(osmSearchTypes({ class: 'leisure', type: 'park' }), ['park']);
});

test('a hairline bounding box is a point, not an extent', () => {
  // Live: "Rocky Mountains" is a NODE — a 0.0001° box. Framing it would put the
  // camera ~10 km up over one arbitrary ridge in Wyoming.
  assert.equal(nominatimViewport(['43.3578032', '43.3579032', '-110.9175560', '-110.9174560']), null);
  assert.ok(GEOCODE_POINT_BOX_DEG > 0.0001 && GEOCODE_POINT_BOX_DEG < 0.01);
  assert.deepEqual(nominatimViewport(['43.5326969', '43.6687119', '1.3503311', '1.5153356']), {
    southwest: { lat: 43.5326969, lng: 1.3503311 },
    northeast: { lat: 43.6687119, lng: 1.5153356 },
  });
  assert.equal(nominatimViewport(undefined), null);
  assert.equal(nominatimViewport(['a', 'b', 'c', 'd']), null);
  assert.equal(nominatimViewport(['43.7', '43.5', '1.35', '1.51']), null, 'inverted latitudes');
});

test('a long display_name is cut to the feature and its country', () => {
  assert.equal(
    shortenGeocodeLabel('Toulouse, Haute-Garonne, Occitanie, France métropolitaine, France', 'Toulouse'),
    'Toulouse, France',
  );
  assert.equal(
    shortenGeocodeLabel('Zilker Park, Austin, Travis County, Texas, 78746, United States', 'Zilker Park'),
    'Zilker Park, United States',
  );
  assert.equal(shortenGeocodeLabel('France', 'France'), 'France');
  // A house number is not a place name: an address record has no `name`, and its
  // display_name opens with the number, so the street comes with it.
  assert.equal(shortenGeocodeLabel('12, Rue de Rivoli, Paris, France', ''), '12 Rue de Rivoli, France');
  assert.equal(shortenGeocodeLabel('42', ''), '42');
  assert.equal(shortenGeocodeLabel('', ''), null);
});

test('a Nominatim city row becomes a framed, credited geocode', () => {
  const row = {
    lat: '43.6044638',
    lon: '1.4442433',
    category: 'boundary',
    type: 'administrative',
    addresstype: 'city',
    name: 'Toulouse',
    display_name: 'Toulouse, Haute-Garonne, Occitanie, France métropolitaine, France',
    boundingbox: ['43.5326969', '43.6687119', '1.3503311', '1.5153356'],
  };
  assert.deepEqual(normalizeNominatimSearchResult(row), {
    lat: 43.6044638,
    lon: 1.4442433,
    label: 'Toulouse, France',
    types: ['locality'],
    viewport: {
      southwest: { lat: 43.5326969, lng: 1.3503311 },
      northeast: { lat: 43.6687119, lng: 1.5153356 },
    },
    source: 'nominatim',
  });
  assert.equal(normalizeNominatimSearchResult({ lat: 'nowhere', lon: '1' }), null);
  assert.equal(normalizeNominatimSearchResult(undefined), null);
});

test('a city with no published box still gets a city-sized one', () => {
  // BAN publishes a commune as a point and a name. Left boxless, a city result
  // falls through to the 250 m default range — a rooftop, not a city.
  const commune = normalizeGeoplateformeFeature({
    geometry: { coordinates: [1.433805, 43.604082] },
    properties: { _type: 'address', type: 'municipality', label: 'Toulouse', city: 'Toulouse' },
  });
  assert.deepEqual(commune.types, ['locality']);
  assert.ok(commune.viewport, 'a city result must carry a box');
  const spanKm = (commune.viewport.northeast.lat - commune.viewport.southwest.lat) * 111.32;
  assert.ok(spanKm > 30 && spanKm < 50, `metro box is ~40 km tall, got ${spanKm.toFixed(1)}`);
  // A precise place does NOT get one invented for it: 250 m framing is correct there.
  const address = normalizeGeoplateformeFeature({
    geometry: { coordinates: [2.35995, 48.855602] },
    properties: { _type: 'address', type: 'housenumber', label: '12 Rue de Rivoli 75004 Paris' },
  });
  assert.deepEqual(address, {
    lat: 48.855602,
    lon: 2.35995,
    label: '12 Rue de Rivoli 75004 Paris',
    types: [],
    viewport: null,
    source: 'geoplateforme',
  });
});

test('an IGN POI keeps its toponym and the commune it stands in', () => {
  const poi = normalizeGeoplateformeFeature({
    geometry: { coordinates: [2.29424, 48.858264] },
    properties: {
      _type: 'poi',
      name: ['Tour Eiffel'],
      toponym: 'Tour Eiffel',
      category: ['monument'],
      city: ['Paris', 'Paris 7e Arrondissement'],
    },
  });
  assert.equal(poi.label, 'Tour Eiffel, Paris');
  assert.deepEqual(poi.types, [], 'a monument is a precise place, not an area');
  assert.equal(normalizeGeoplateformeFeature({ geometry: { coordinates: ['x', 1] } }), null);
  assert.equal(normalizeGeoplateformeFeature({}), null);
});

test('both licences are named, and a miss expires long before a hit', () => {
  assert.match(geocodeSourceAttribution('nominatim'), /OpenStreetMap contributors.*ODbL/);
  assert.match(geocodeSourceAttribution('geoplateforme'), /IGN|Licence Ouverte/);
  assert.equal(geocodeSourceAttribution(null), null);
  assert.ok(GEOCODE_SEARCH_MISS_CACHE_MS < GEOCODE_SEARCH_CACHE_MS);
});

test('the cache key carries the bias the answer was found under', () => {
  const austin = parseGeocodeViewbox('-97.95,30.10,-97.55,30.52');
  const paris = parseGeocodeViewbox('2.20,48.80,2.45,48.92');
  assert.notEqual(
    geocodeSearchCacheKey('sixth street', austin, 'en'),
    geocodeSearchCacheKey('sixth street', paris, 'en'),
  );
  // A view too wide to bias is not a distinct answer — it shares the plain key.
  const globe = { west: -180, south: -85, east: 180, north: 85 };
  assert.equal(geocodeSearchCacheKey('Toulouse', globe, 'en'), geocodeSearchCacheKey('TOULOUSE', null, 'en'));
  assert.notEqual(geocodeSearchCacheKey('Toulouse', null, 'fr'), geocodeSearchCacheKey('Toulouse', null, 'en'));
});

test('the view wins, unless the world knows that name better', () => {
  // Live rows, 2026-08-31, both searched from a view of Austin.
  const austinBistro = { lat: '30.40', lon: '-97.72', importance: 0.0001, category: 'amenity', type: 'restaurant' };
  const toulouse = { lat: '43.60', lon: '1.44', importance: 0.7287, category: 'boundary', addresstype: 'city' };
  assert.equal(chooseGeocodeRow(austinBistro, toulouse), toulouse, '"Toulouse" is the city, not the bistro');

  const austinSixthStreet = { lat: '30.2677', lon: '-97.7417', importance: 0.0001, category: 'historic', type: 'memorial' };
  const kampalaSixthStreet = { lat: '0.316', lon: '32.60', importance: 0.1467, category: 'place', addresstype: 'village' };
  assert.equal(
    chooseGeocodeRow(austinSixthStreet, kampalaSixthStreet), austinSixthStreet,
    'an obscure village in Uganda does not outrank the street on screen',
  );

  assert.equal(chooseGeocodeRow(null, kampalaSixthStreet), kampalaSixthStreet);
  assert.equal(chooseGeocodeRow(austinSixthStreet, null), austinSixthStreet);
  assert.equal(chooseGeocodeRow(null, null), null);
  // The threshold sits between the two measured groups, not on top of either.
  assert.ok(GEOCODE_PROMINENCE_OVERRIDE > 0.1627 && GEOCODE_PROMINENCE_OVERRIDE < 0.4126);
});

test('the France backstop answers the address asked for, or nothing', () => {
  // BAN always answers with its nearest street rather than nothing. Live scores,
  // 2026-08-31: the real "12 Rue de Rivoli" 0.97; an invented "Chemin de Bel
  // Air" answered "Chemin de Bellevue" at 0.663.
  const nearMiss = normalizeGeoplateformeFeature({
    geometry: { coordinates: [0.152558, 44.860122] },
    properties: {
      _type: 'address', type: 'street', score: 0.663,
      label: 'Chemin de Bellevue 24230 Saint-Antoine-de-Breuilh',
    },
  });
  assert.equal(nearMiss, null, 'a different street is not an answer');
  const exact = normalizeGeoplateformeFeature({
    geometry: { coordinates: [2.35995, 48.855602] },
    properties: { _type: 'address', type: 'housenumber', score: 0.97, label: '12 Rue de Rivoli 75004 Paris' },
  });
  assert.equal(exact.label, '12 Rue de Rivoli 75004 Paris');
  // A record with no score at all is taken at face value rather than dropped.
  assert.ok(normalizeGeoplateformeFeature({
    geometry: { coordinates: [2.29424, 48.858264] },
    properties: { _type: 'poi', toponym: 'Tour Eiffel' },
  }));
  assert.ok(GEOCODE_GEOPLATEFORME_MIN_SCORE > 0.663 && GEOCODE_GEOPLATEFORME_MIN_SCORE < 0.909);
});
