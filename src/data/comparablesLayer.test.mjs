// src/data/comparablesLayer.test.mjs
// The layer: one request per point, a pool that declares its own cap, and two
// silhouettes that can never be confused for one another.
//
// The arithmetic is proved in `comparablesDossier.test.mjs` and the panel in
// the browser by `scripts/qa-comparables.mjs`. What is here is what the browser
// actually does — which URL is called and how often, what survives a silent
// register, and the two claims the module header makes about the picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import comparablesLayer, {
  ANNONCE_COLOR,
  CANDIDATE_RADIUS_M,
  COMPARABLES_LAYER_ID,
  OLDEST_ALPHA,
  OLDEST_DAYS,
  SUBJECT_ENTITY_ID,
  VENTE_COLOR,
  _comparablesDossierForTest,
  _resetComparablesForTest,
  ageAlpha,
  comparablesLegend,
  comparablesFetch,
  renderComparables,
} from './comparablesLayer.js';
import {
  CANDIDATE_LIMIT,
  comparableFromDvfSale,
  emptyDossier,
  normaliseComparable,
} from './comparablesDossier.js';

const LYON = { lat: 45.7578, lon: 4.8357 };

/** One DVF mutation as the proxy serves it. */
function sale(index, overrides = {}) {
  return {
    id: `m-${index}`,
    date: '2025-04-1'.concat(String(index % 10)),
    valeur: 350_000,
    commune: 'Lyon 2e',
    address: `${index} rue Test`,
    lat: LYON.lat + index * 0.0002,
    lon: LYON.lon,
    dwellingSurface: 70,
    dwellingCount: 1,
    rooms: 3,
    types: ['Appartement'],
    prixM2: 5000,
    ...overrides,
  };
}

/** A fetch that counts its calls and answers with `sales`. */
function dvfStub(sales, { fail = false } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (fail) return { ok: false, status: 502, json: async () => ({ error: 'down' }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        commune: { code: '69382', nom: 'Lyon 2e' },
        sales,
        summary: { count: sales.length, reference: { basis: 'commune', medianPrixM2: 5100 } },
      }),
    };
  };
  return { impl, calls };
}

/** A Cesium data source that only remembers what it was given. */
function fakeDataSource() {
  const added = [];
  return { added, entities: { add: (entity) => { added.push(entity); return entity; } } };
}

test('the layer is the one the registry knows about', () => {
  assert.equal(comparablesLayer.id, COMPARABLES_LAYER_ID);
  assert.equal(typeof comparablesLayer.setScanPin, 'function', 'the dossier pins the scan');
  assert.equal(typeof comparablesLayer.getRowControls, 'function');
});

test('one scan asks DVF once, and an edit re-joins without re-asking', async () => {
  _resetComparablesForTest();
  const { impl, calls } = dvfStub([sale(1), sale(2)]);
  const url = `gev:comparables?lat=${LYON.lat}&lon=${LYON.lon}&radius=${CANDIDATE_RADIUS_M}&rev=0`;
  const first = await comparablesFetch(url, {}, { impl });
  assert.equal(first.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/api\/dvf\?lat=/);
  assert.match(calls[0], new RegExp(`radius=${CANDIDATE_RADIUS_M}`));

  // The revision moved because the reader edited the dossier. The question to
  // the register did not, so the register is not asked again.
  const second = await comparablesFetch(url.replace('rev=0', 'rev=7'), {}, { impl });
  assert.equal(calls.length, 1, 'the DVF half is memoised per point and radius');
  assert.equal((await second.json()).candidates.length, 2);
});

test('a silent register costs the candidate list and nothing else', async () => {
  _resetComparablesForTest({
    ...emptyDossier(),
    subject: { label: 'Le bien', lat: LYON.lat, lon: LYON.lon, surface: 70 },
    comparables: [normaliseComparable({
      kind: 'annonce', label: 'Une annonce', price: 350_000, surface: 70, lat: 45.75, lon: 4.83,
    })],
  });
  const { impl } = dvfStub([], { fail: true });
  const response = await comparablesFetch(
    `gev:comparables?lat=${LYON.lat}&lon=${LYON.lon}&rev=1`, {}, { impl },
  );
  const payload = await response.json();
  assert.equal(payload.candidatesMissing, true);
  assert.deepEqual(payload.candidates, []);
  // The dossier is local and survives every outage there is.
  assert.equal(payload.dossier.comparables.length, 1);
  assert.equal(payload.dossier.subject.label, 'Le bien');
});

test('the pool declares its own cap, and the criterion that filled it (A5)', async () => {
  _resetComparablesForTest();
  const many = Array.from({ length: CANDIDATE_LIMIT + 9 }, (_unused, index) => sale(index));
  const { impl } = dvfStub(many);
  const response = await comparablesFetch(
    `gev:comparables?lat=${LYON.lat}&lon=${LYON.lon}&rev=0`, {}, { impl },
  );
  const payload = await response.json();
  assert.equal(payload.candidates.length, CANDIDATE_LIMIT);
  assert.equal(payload.candidateTotal, CANDIDATE_LIMIT + 9, 'the total found is reported beside it');
  // The proxy sorts by distance, so the cap keeps the nearest — which is the
  // criterion the panel prints.
  assert.ok(payload.candidates[0].distanceM <= payload.candidates.at(-1).distanceM);
});

test('a sale already in the dossier is offered as taken, not as new', async () => {
  const retained = comparableFromDvfSale(sale(1));
  _resetComparablesForTest({ ...emptyDossier(), comparables: [retained] });
  const { impl } = dvfStub([sale(1), sale(2)]);
  const payload = await (await comparablesFetch(
    `gev:comparables?lat=${LYON.lat}&lon=${LYON.lon}&rev=0`, {}, { impl },
  )).json();
  assert.equal(payload.candidates[0].already, true);
  assert.equal(payload.candidates[1].already, false);
});

test('the declared total is the population, not what the proxy served', async () => {
  // `/api/dvf` serves at most 400 of the sales it found and reports the real
  // count in its summary. Using `sales.length` turned 450 mutations into
  // « 24 des 400 », which is the exact sentence A5 exists to keep honest.
  _resetComparablesForTest();
  const served = Array.from({ length: 400 }, (_unused, index) => sale(index));
  const impl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      commune: { code: '69382', nom: 'Lyon 2e' },
      sales: served,
      summary: { count: 450, served: 400, truncated: true },
    }),
  });
  const payload = await (await comparablesFetch(
    `gev:comparables?lat=${LYON.lat}&lon=${LYON.lon}&rev=0`, {}, { impl },
  )).json();
  assert.equal(payload.candidateTotal, 450);
  assert.equal(payload.candidates.length, CANDIDATE_LIMIT);
});

test('an aborted scan keeps the pool it had, and does not report a silent register', async () => {
  _resetComparablesForTest();
  const { impl } = dvfStub([sale(1), sale(2)]);
  await comparablesFetch(`gev:comparables?lat=${LYON.lat}&lon=${LYON.lon}&rev=0`, {}, { impl });
  const abortImpl = async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  // A different point, so the memo cannot answer it.
  const payload = await (await comparablesFetch(
    'gev:comparables?lat=48.85&lon=2.35&rev=1', {}, { impl: abortImpl },
  )).json();
  assert.equal(payload.scanAborted, true);
  assert.equal(payload.candidatesMissing, false, 'a cancelled scan is not a mute register');
  assert.equal(payload.candidates.length, 2, 'the pool it had is the pool it keeps');
});

test('a scan with no coordinate is refused rather than answered about 0°N 0°E', async () => {
  _resetComparablesForTest();
  const { impl, calls } = dvfStub([]);
  const response = await comparablesFetch('gev:comparables?rev=0', {}, { impl });
  assert.equal(response.ok, false);
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('an intention and an observation never draw the same picture', () => {
  const dataSource = fakeDataSource();
  const payload = {
    dossier: {
      ...emptyDossier(),
      subject: { label: 'Le bien', lat: LYON.lat, lon: LYON.lon, surface: 70 },
      comparables: [
        comparableFromDvfSale(sale(1)),
        normaliseComparable({
          kind: 'annonce', label: 'Une annonce', price: 400_000, surface: 70,
          lat: LYON.lat + 0.001, lon: LYON.lon, date: '2026-09-01',
        }),
      ],
    },
  };
  const drawn = renderComparables({ payload, dataSource, viewer: null });
  // property + two markers + two connectors
  assert.equal(drawn, 5);
  const markers = dataSource.added.filter((entity) => entity.billboard);
  assert.equal(markers.length, 3);
  const images = new Set(markers.map((entity) => entity.billboard.image));
  assert.equal(images.size, 3, 'the property, the sale and the listing are three pictures');
  const colours = markers.map((entity) => entity.billboard.color.toCssHexString?.() ?? '');
  assert.ok(colours.some((hex) => hex.startsWith(VENTE_COLOR)));
  assert.ok(colours.some((hex) => hex.startsWith(ANNONCE_COLOR)));
});

test('an unknown date is a dashed connector, not a quiet fade', () => {
  const dataSource = fakeDataSource();
  const payload = {
    dossier: {
      ...emptyDossier(),
      subject: { label: 'Le bien', lat: LYON.lat, lon: LYON.lon, surface: 70 },
      comparables: [
        normaliseComparable({
          kind: 'annonce', label: 'Sans date', price: 400_000, surface: 70,
          lat: LYON.lat + 0.001, lon: LYON.lon,
        }),
        normaliseComparable({
          kind: 'annonce', label: 'Datée', price: 400_000, surface: 70,
          lat: LYON.lat + 0.002, lon: LYON.lon, date: '2026-09-01',
        }),
      ],
    },
  };
  renderComparables({ payload, dataSource, viewer: null });
  const links = dataSource.added.filter((entity) => entity.polyline);
  assert.equal(links.length, 2);
  const dashed = links.filter((entity) => 'dashLength' in entity.polyline.material);
  assert.equal(dashed.length, 1, 'exactly the one whose age nobody measured');
  const dateless = payload.dossier.comparables.find((entry) => entry.date === null);
  assert.equal(dashed[0].id, `comparables:l:${dateless.id}`);
});

test('an imported id cannot collide with the property marker', () => {
  // Cesium throws on a duplicate entity id, and the id of a comparable can come
  // straight out of an imported file. A row literally called `bien` used to
  // take the subject's entity id with it and leave half a dossier drawn.
  const dataSource = fakeDataSource();
  const hostile = normaliseComparable({
    id: 'bien', kind: 'annonce', label: 'Collision', price: 400_000, surface: 70,
    lat: LYON.lat + 0.001, lon: LYON.lon, date: '2026-09-01',
  });
  const drawn = renderComparables({
    payload: {
      dossier: {
        ...emptyDossier(),
        subject: { label: 'Le bien', lat: LYON.lat, lon: LYON.lon },
        comparables: [hostile],
      },
    },
    dataSource,
    viewer: null,
  });
  assert.equal(drawn, 3, 'the property, the marker and the connector all drew');
  const ids = dataSource.added.map((entity) => entity.id);
  assert.equal(new Set(ids).size, ids.length, 'no two entities share an id');
  assert.ok(ids.includes(SUBJECT_ENTITY_ID));
  assert.ok(ids.includes('comparables:c:bien'));
});

test('an unretained comparable leaves the map with the median', () => {
  const dataSource = fakeDataSource();
  const entry = normaliseComparable({
    kind: 'annonce', label: 'Sortie du calcul', price: 400_000, surface: 70,
    lat: LYON.lat + 0.001, lon: LYON.lon, date: '2026-09-01',
  });
  entry.retained = false;
  renderComparables({
    payload: {
      dossier: {
        ...emptyDossier(),
        subject: { label: 'Le bien', lat: LYON.lat, lon: LYON.lon },
        comparables: [entry],
      },
    },
    dataSource,
    viewer: null,
  });
  assert.equal(dataSource.added.length, 1, 'only the property is drawn');
});

test('a comparable with no position is not drawn, and takes no connector with it', () => {
  const dataSource = fakeDataSource();
  renderComparables({
    payload: {
      dossier: {
        ...emptyDossier(),
        subject: { label: 'Le bien', lat: LYON.lat, lon: LYON.lon },
        comparables: [normaliseComparable({
          kind: 'annonce', label: 'Import sans coordonnées', price: 400_000, surface: 70,
        })],
      },
    },
    dataSource,
    viewer: null,
  });
  assert.equal(dataSource.added.length, 1);
});

test('age is a visual variable, with a floor and a defined answer for the unknown', () => {
  assert.equal(ageAlpha(0), 1);
  assert.equal(ageAlpha(OLDEST_DAYS), OLDEST_ALPHA);
  assert.equal(ageAlpha(OLDEST_DAYS * 4), OLDEST_ALPHA, 'the floor holds, nothing vanishes');
  assert.equal(ageAlpha(null), OLDEST_ALPHA);
  assert.ok(ageAlpha(OLDEST_DAYS / 2) > OLDEST_ALPHA);
  assert.ok(ageAlpha(OLDEST_DAYS / 2) < 1);
});

test('the legend carries both samples, and never one without its size', () => {
  const legend = comparablesLegend({
    ventes: 4, ventesWithRatio: 3, medianVentes: 5200,
    annonces: 2, annoncesWithRatio: 2, medianAnnonces: 5900,
  });
  assert.equal(legend.length, 2);
  assert.equal(legend[0].color, VENTE_COLOR);
  assert.equal(legend[1].color, ANNONCE_COLOR);
  assert.match(legend[0].blurb, /5\s?200 €\/m² médian sur 3 comparables/);
  assert.match(legend[1].blurb, /5\s?900 €\/m² médian demandé sur 2 comparables/);
  // « sur 1 comparables » is the sentence that says nobody read the legend.
  assert.match(comparablesLegend({ annonces: 1, annoncesWithRatio: 1, medianAnnonces: 6000 })[1].blurb,
    /sur 1 comparable\./);
  // An empty dossier still says what each row WOULD mean, and claims no median.
  const empty = comparablesLegend({ ventes: 0, annonces: 0 });
  assert.ok(!/€\/m²/.test(empty[0].blurb));
  assert.match(empty[1].blurb, /jamais collectés/);
});

test('a row with no scan behind it stays quiet', () => {
  _resetComparablesForTest();
  // The shell publishes no summary before the first scan, and a legend built
  // from nothing would describe a dossier nobody has opened.
  assert.equal(comparablesLayer.getRowControls(), null);
});

test('the dossier a test installs is the one the module holds', () => {
  const dossier = { ...emptyDossier(), comparables: [comparableFromDvfSale(sale(3))] };
  _resetComparablesForTest(dossier);
  assert.equal(_comparablesDossierForTest().comparables.length, 1);
  _resetComparablesForTest();
  assert.equal(_comparablesDossierForTest().comparables.length, 0);
});
