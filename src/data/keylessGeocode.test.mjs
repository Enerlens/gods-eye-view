// The client half of the keyless search box: it builds one /api/geocode request
// from the current view, bounds how long a search may hang, and refuses a
// malformed answer rather than flying the camera to NaN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  keylessGeocode,
  normalizeKeylessGeocodeResponse,
  viewboxFromBias,
} from './keylessGeocode.js';

/** Run one geocode against a stubbed proxy, returning the answer and the URL asked for. */
async function withStubbedProxy(respond, run) {
  const priorFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return respond(String(url), init);
  };
  try {
    return { value: await run(), calls };
  } finally {
    globalThis.fetch = priorFetch;
  }
}

const okResponse = (body) => ({ ok: true, json: async () => body });

const TOULOUSE = {
  result: {
    lat: 43.6044638,
    lon: 1.4442433,
    label: 'Toulouse, France',
    types: ['locality'],
    viewport: {
      southwest: { lat: 43.5326969, lng: 1.3503311 },
      northeast: { lat: 43.6687119, lng: 1.5153356 },
    },
    source: 'nominatim',
  },
  source: 'nominatim',
  attribution: '© OpenStreetMap contributors (ODbL 1.0), via Nominatim',
};

test('the view bias is rewritten into the corner order Nominatim speaks', () => {
  // viewportBias() writes Google bounds: "swLat,swLng|neLat,neLng".
  assert.equal(viewboxFromBias('30.1000,-97.9500|30.5200,-97.5500'), '-97.95,30.1,-97.55,30.52');
  assert.equal(viewboxFromBias(null), null);
  assert.equal(viewboxFromBias('30.1,-97.95'), null);
  assert.equal(viewboxFromBias('NaN,-97.95|30.52,-97.55'), null);
  // An inverted or antimeridian-crossing box is dropped here too, so the proxy
  // never has to guess which way round the caller meant it.
  assert.equal(viewboxFromBias('30.52,-97.55|30.10,-97.95'), null);
});

test('a search asks the proxy once, with the query and the current view', async () => {
  const { value, calls } = await withStubbedProxy(
    () => okResponse(TOULOUSE),
    () => keylessGeocode('Toulouse', { bias: '30.1000,-97.9500|30.5200,-97.5500' }),
  );
  assert.equal(calls.length, 1);
  const url = new URL(calls[0], 'http://localhost');
  assert.equal(url.pathname, '/api/geocode');
  assert.equal(url.searchParams.get('q'), 'Toulouse');
  assert.equal(url.searchParams.get('viewbox'), '-97.95,30.1,-97.55,30.52');
  assert.deepEqual(value, {
    lat: 43.6044638,
    lng: 1.4442433,
    label: 'Toulouse, France',
    types: ['locality'],
    viewport: TOULOUSE.result.viewport,
    source: 'nominatim',
  });
});

test('an unusable view is simply not sent, and an empty query is not asked at all', async () => {
  const { calls } = await withStubbedProxy(
    () => okResponse(TOULOUSE),
    () => keylessGeocode('Toulouse', { bias: null }),
  );
  assert.equal(new URL(calls[0], 'http://localhost').searchParams.get('viewbox'), null);

  const blank = await withStubbedProxy(
    () => { throw new Error('the proxy must not be asked for an empty query'); },
    () => keylessGeocode('   '),
  );
  assert.equal(blank.value, null);
  assert.equal(blank.calls.length, 0);
});

test('a not-found, a refused proxy and a dead network all read as "no destination"', async () => {
  const notFound = await withStubbedProxy(
    () => okResponse({ result: null, source: null, attribution: null }),
    () => keylessGeocode('zzzqqxxnotaplace'),
  );
  assert.equal(notFound.value, null);

  const refused = await withStubbedProxy(
    () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream', result: null }) }),
    () => keylessGeocode('Toulouse'),
  );
  assert.equal(refused.value, null);

  const dead = await withStubbedProxy(
    () => { throw new TypeError('Failed to fetch'); },
    () => keylessGeocode('Toulouse'),
  );
  assert.equal(dead.value, null);
});

test('a caller that aborts stops the search', async () => {
  const controller = new AbortController();
  const { value } = await withStubbedProxy(
    (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      controller.abort();
    }),
    () => keylessGeocode('Toulouse', { signal: controller.signal }),
  );
  assert.equal(value, null);
});

test('a malformed answer is refused before it can steer the camera', () => {
  assert.equal(normalizeKeylessGeocodeResponse({ result: { lat: 'north-ish', lon: 2 } }), null);
  assert.equal(normalizeKeylessGeocodeResponse({ result: null }), null);
  assert.equal(normalizeKeylessGeocodeResponse(null), null);
  // A broken box costs the framing box, not the destination.
  const halfBox = normalizeKeylessGeocodeResponse({
    result: { lat: 1, lon: 2, viewport: { southwest: { lat: 0, lng: 1 } }, types: ['locality', 7] },
  });
  assert.deepEqual(halfBox, { lat: 1, lng: 2, label: null, types: ['locality'], viewport: null, source: null });
});
