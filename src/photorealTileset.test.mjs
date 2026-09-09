import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOOGLE_PHOTOREAL_ION_ASSET_ID,
  describePhotorealFailure,
  loadPhotorealTileset,
  photorealTilesetOptions,
} from './photorealTileset.js';

/**
 * A CesiumJS stand-in that records every door tried. `googleResult` and
 * `ionResult` are either a tileset or an Error to throw.
 */
function stubCesium({ googleResult, ionResult } = {}) {
  const calls = [];
  return {
    calls,
    createGooglePhotorealistic3DTileset(apiOptions, tilesetOptions) {
      calls.push({ door: 'google-key', apiOptions, tilesetOptions });
      if (googleResult instanceof Error) return Promise.reject(googleResult);
      return Promise.resolve(googleResult ?? null);
    },
    IonResource: {
      fromAssetId(assetId, options) {
        calls.push({ door: 'ion-resource', assetId, options });
        if (ionResult instanceof Error) return Promise.reject(ionResult);
        return Promise.resolve({ assetId });
      },
    },
    Cesium3DTileset: {
      fromUrl(resource, tilesetOptions) {
        calls.push({ door: 'ion', resource, tilesetOptions });
        return Promise.resolve(ionResult ?? null);
      },
    },
  };
}

test('a working Google key is used, and ion is never touched', async () => {
  const tileset = { name: 'google' };
  const Cesium = stubCesium({ googleResult: tileset });
  const result = await loadPhotorealTileset(Cesium, { googleApiKey: 'AIza-key', ionToken: 'ion-token' });

  assert.equal(result.tileset, tileset);
  assert.equal(result.source, 'google-key');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(Cesium.calls.map((call) => call.door), ['google-key']);
  // The key travels in the call, not through a global another module could clear.
  assert.equal(Cesium.calls[0].apiOptions.key, 'AIza-key');
});

test('an EEA-refused key falls through to ion, which serves the same tileset', async () => {
  // What Google actually answers on a key billed to an EEA address.
  const refused = new Error('403 PERMISSION_DENIED: 3D tiles are not available for your account and region');
  const ionTileset = { name: 'ion' };
  const Cesium = stubCesium({ googleResult: refused, ionResult: ionTileset });
  const result = await loadPhotorealTileset(Cesium, { googleApiKey: 'AIza-key', ionToken: 'ion-token' });

  assert.equal(result.tileset, ionTileset);
  assert.equal(result.source, 'ion');
  assert.deepEqual(result.errors, [{ source: 'google-key', message: refused.message }]);
  assert.deepEqual(Cesium.calls.map((call) => call.door), ['google-key', 'ion-resource', 'ion']);
  // The published asset, and a token passed explicitly rather than read off
  // `Ion.defaultAccessToken` — the caller may hold a token it never installed.
  assert.equal(Cesium.calls[1].assetId, GOOGLE_PHOTOREAL_ION_ASSET_ID);
  assert.equal(Cesium.calls[1].options.accessToken, 'ion-token');
});

test('a keyless build with an ion token still gets the 3D globe', async () => {
  const ionTileset = { name: 'ion' };
  const Cesium = stubCesium({ ionResult: ionTileset });
  const result = await loadPhotorealTileset(Cesium, { ionToken: 'ion-token' });

  assert.equal(result.source, 'ion');
  assert.deepEqual(Cesium.calls.map((call) => call.door), ['ion-resource', 'ion']);
});

test('with neither credential nothing is requested at all', async () => {
  const Cesium = stubCesium({});
  const result = await loadPhotorealTileset(Cesium, {});

  assert.equal(result.tileset, null);
  assert.equal(result.source, null);
  assert.deepEqual(result.errors, []);
  // The point of the empty attempt list: no doomed round-trip on boot.
  assert.deepEqual(Cesium.calls, []);
});

test('when both doors are shut the failure names which is which', async () => {
  const Cesium = stubCesium({
    googleResult: new Error('403 PERMISSION_DENIED'),
    ionResult: new Error('401 invalid token'),
  });
  const result = await loadPhotorealTileset(Cesium, { googleApiKey: 'k', ionToken: 't' });

  assert.equal(result.tileset, null);
  assert.equal(
    describePhotorealFailure(result.errors),
    'Google key: 403 PERMISSION_DENIED · Cesium ion: 401 invalid token',
  );
  // A single failure stays a bare cause: naming one door of one is noise.
  assert.equal(describePhotorealFailure([{ source: 'ion', message: '401' }]), '401');
  assert.equal(describePhotorealFailure([]), '');
});

test('each attempt gets its own options object', () => {
  // CesiumJS writes its defaults INTO the options it is handed, so a shared or
  // frozen constant would either leak across doors or throw in strict mode.
  const first = photorealTilesetOptions();
  const second = photorealTilesetOptions();
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  first.cacheBytes = 1;
  assert.notEqual(second.cacheBytes, 1);
});

test('the attempt callback reports the door before it is tried', async () => {
  const seen = [];
  const Cesium = stubCesium({ googleResult: new Error('nope'), ionResult: { name: 'ion' } });
  await loadPhotorealTileset(Cesium, {
    googleApiKey: 'k',
    ionToken: 't',
    onAttempt: (source) => seen.push(source),
  });
  assert.deepEqual(seen, ['google-key', 'ion']);
});
