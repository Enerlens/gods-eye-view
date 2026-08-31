// Unit contract for the IGN BIL terrain spike's pure decode path.
//
// These pin the two findings the spike exists to encode — the NoData SMEAR and
// the cell-centre/edge-inclusive registration mismatch — plus the fail-closed
// guard whose whole job is to stop a 137-byte XML error body from reaching
// `new Float32Array()`. Everything here is synthetic; the live-service
// measurements live in `scripts/qa-ign-terrain.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  validateBilResponse,
  isRealElevationSample,
  resampleToEdgeInclusive,
  ignTerrainTileAvailability,
  ignBilTileUrl,
  ignTerrainFlagEnabled,
  NODATA_FLOOR_M,
  IGN_TERRAIN_MIN_LEVEL,
  IGN_TERRAIN_MAX_LEVEL,
} from './ignBilTerrain.js';

const OK_TILE = { ok: true, status: 200, contentType: 'image/x-bil;bits=32', byteLength: 262144 };

test('the guard is fail-closed, and names the 137-byte error body specifically', () => {
  assert.equal(validateBilResponse(OK_TILE).valid, true);

  // THE case. Out-of-coverage replies 404 with a 137-byte XML ExceptionReport;
  // 137 % 4 === 1, so passing it to `new Float32Array()` throws inside a tile
  // request. Two independent guards must each reject it on their own.
  const errorBody = { ok: false, status: 404, contentType: 'text/xml; charset=UTF-8', byteLength: 137 };
  assert.equal(validateBilResponse(errorBody).valid, false);
  assert.match(validateBilResponse(errorBody).reason, /http 404/);
  // Each guard has to stop it ALONE: strip the 404 and the wrong content-type
  // and the byte-alignment check must still refuse those 137 bytes, because
  // that is the one that stands between an error body and Float32Array.
  assert.match(
    validateBilResponse({ ok: true, status: 200, contentType: 'image/x-bil;bits=32', byteLength: 137 }).reason,
    /not a whole number of float32/,
  );

  // A truncated but 4-aligned body is still not a tile.
  assert.equal(validateBilResponse({ ...OK_TILE, byteLength: 65536 }).valid, false);
  assert.match(validateBilResponse({ ...OK_TILE, byteLength: 65536 }).reason, /expected 262144/);

  // An HTML error page served with 200 must not be read as elevation.
  assert.equal(validateBilResponse({ ...OK_TILE, contentType: 'text/html' }).valid, false);
  assert.equal(validateBilResponse({ ...OK_TILE, contentType: '' }).valid, false);
  assert.equal(validateBilResponse({ ...OK_TILE, ok: false }).valid, false);
  assert.equal(validateBilResponse({ ...OK_TILE, status: 204 }).valid, false);
});

test('NoData rejection is a plausibility floor, because the sentinel is smeared', () => {
  // Real French ground, including the deepest polders (~-4 m).
  for (const height of [4805.6, 132.4, 0, -4, -17.2]) {
    assert.equal(isRealElevationSample(height), true, `${height} m is plausible ground`);
  }

  // The documented sentinel — and the lossy-compression ramp AROUND it, which
  // is the real hazard. A Nice z14 tile holds only 4143 samples exactly equal
  // to -99999 but 505 more spread from -1046 down to -50806, produced by
  // blending real heights against the sentinel. An equality check or a
  // `Number.isFinite` check passes every one of them as a crater.
  for (const artifact of [-99999, -99998.6, -50806, -17466, -3588, -1046, -589.5, -100.01]) {
    assert.equal(isRealElevationSample(artifact), false, `${artifact} m must be rejected`);
  }

  assert.equal(isRealElevationSample(NaN), false);
  assert.equal(isRealElevationSample(-Infinity), false);
  // The floor sits far below French land and far above the shallowest observed
  // artifact, so it can move a little without changing any of the above.
  assert.ok(NODATA_FLOOR_M < -20 && NODATA_FLOOR_M > -500);
});

test('the resample re-registers cell centres onto tile edges, so neighbours agree', () => {
  // A field that is linear in x. Two "tiles" sample it as CELL CENTRES over
  // adjacent, non-overlapping extents — exactly what the Géoplateforme sends.
  const SIZE = 8;
  const OUT = 5;
  const field = (x) => 10 + 3 * x;
  const cellCentres = (originCell) => {
    const grid = new Float32Array(SIZE * SIZE);
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        grid[row * SIZE + col] = field(originCell + col + 0.5);
      }
    }
    return grid;
  };
  const left = resampleToEdgeInclusive(cellCentres(0), SIZE, OUT);
  const right = resampleToEdgeInclusive(cellCentres(SIZE), SIZE, OUT);

  // The left tile's east edge and the right tile's west edge are the SAME
  // physical line. Before the resample they were a full cell apart (a 3-unit
  // step in this field); after it they agree exactly, because the field is
  // linear and the border extension is linear.
  for (let row = 0; row < OUT; row += 1) {
    assert.ok(
      Math.abs(left[row * OUT + (OUT - 1)] - right[row * OUT + 0]) < 1e-3,
      `seam row ${row}: ${left[row * OUT + (OUT - 1)]} vs ${right[row * OUT + 0]}`,
    );
  }
  // And the edges land on the tile boundary, not on the outermost cell centre:
  // cell centres run 0.5..7.5, so the west edge is x = 0 -> 10, east is x = 8 -> 34.
  assert.ok(Math.abs(left[0] - field(0)) < 1e-3, 'west edge extrapolates to the boundary');
  assert.ok(Math.abs(left[OUT - 1] - field(SIZE)) < 1e-3, 'east edge extrapolates to the boundary');

  // Clamping instead of extrapolating would have produced the outermost cell
  // centre (10 + 3*0.5 = 11.5) — the bug this function exists to avoid.
  assert.notEqual(Math.round(left[0] * 10) / 10, 11.5);
});

test('the resample carries a constant field unchanged and preserves north-up order', () => {
  const SIZE = 4;
  const flat = new Float32Array(SIZE * SIZE).fill(42);
  for (const value of resampleToEdgeInclusive(flat, SIZE, 3)) {
    assert.ok(Math.abs(value - 42) < 1e-4, 'a flat field must stay flat, edges included');
  }

  // Row 0 is north in both the source and the output — no flip. A field that
  // decreases southward must still decrease southward.
  const ramp = new Float32Array(SIZE * SIZE);
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) ramp[row * SIZE + col] = 100 - 10 * row;
  }
  const out = resampleToEdgeInclusive(ramp, SIZE, 3);
  assert.ok(out[0] > out[2 * 3], 'the north row must stay higher than the south row');
});

test('availability is three-valued, and each value tells Cesium something different', () => {
  const scheme = new Cesium.GeographicTilingScheme();
  const tileAt = (lonDeg, latDeg, level) => {
    const cartographic = Cesium.Cartographic.fromDegrees(lonDeg, latDeg);
    const xy = scheme.positionToTileXY(cartographic, level);
    return [xy.x, xy.y, level];
  };

  // TRUE — fetch it. Inside France, inside the published levels.
  assert.equal(ignTerrainTileAvailability(scheme, ...tileAt(2.35, 48.86, 12)), true, 'Paris z12');
  assert.equal(ignTerrainTileAvailability(scheme, ...tileAt(9.15, 41.9, 14)), true, 'Corsica z14');

  // FALSE — no data, UPSAMPLE THE PARENT. Above z14 inside France, which is
  // where a close camera spends all its time. Serving a flat tile here instead
  // replaced Mont Blanc with a plane the moment the camera came in.
  assert.equal(
    ignTerrainTileAvailability(scheme, ...tileAt(2.35, 48.86, IGN_TERRAIN_MAX_LEVEL + 1)),
    false,
    'above z14 over France must upsample, not flatten',
  );
  assert.equal(ignTerrainTileAvailability(scheme, ...tileAt(6.86, 45.83, 18)), false, 'deep zoom on the Alps');

  // UNDEFINED — unknown, ask me; the provider answers with flat ground.
  // Returning FALSE for these is fatal: Cesium marks the tile FAILED and never
  // requests it, and the level-0 roots are below z6 by definition, so the whole
  // globe renders nothing.
  assert.equal(ignTerrainTileAvailability(scheme, ...tileAt(-74.0, 40.7, 12)), undefined, 'New York');
  assert.equal(ignTerrainTileAvailability(scheme, ...tileAt(139.7, 35.7, 12)), undefined, 'Tokyo');
  assert.equal(
    ignTerrainTileAvailability(scheme, ...tileAt(2.35, 48.86, IGN_TERRAIN_MIN_LEVEL - 1)),
    undefined,
    'below z6 over France has no ancestor to upsample from',
  );
  // The two level-0 roots specifically — the case that blanked the globe.
  assert.equal(ignTerrainTileAvailability(scheme, 0, 0, 0), undefined, 'west root');
  assert.equal(ignTerrainTileAvailability(scheme, 1, 0, 0), undefined, 'east root');
});

test('the GetTile URL asks for the one format and matrix set the layer publishes', () => {
  const url = ignBilTileUrl(16598, 3745, 14);
  assert.match(url, /^https:\/\/data\.geopf\.fr\/wmts\?/);
  const params = new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('LAYER'), 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES');
  assert.equal(params.get('FORMAT'), 'image/x-bil;bits=32');
  // `WGS84G` is Cesium's GeographicTilingScheme bit for bit; the layer also
  // declares the `WGS84G_6_14` subset and the server accepts either, but only
  // `WGS84G`'s level ids line up with Cesium's own.
  assert.equal(params.get('TILEMATRIXSET'), 'WGS84G');
  assert.equal(params.get('STYLE'), 'normal');
  assert.equal(params.get('TILEMATRIX'), '14');
  assert.equal(params.get('TILEROW'), '3745');
  assert.equal(params.get('TILECOL'), '16598');
});

test('the spike is off unless the flag says exactly 1', () => {
  assert.equal(ignTerrainFlagEnabled('?ign_terrain=1'), true);
  assert.equal(ignTerrainFlagEnabled('?welcome=0&ign_terrain=1'), true);
  assert.equal(ignTerrainFlagEnabled(''), false);
  assert.equal(ignTerrainFlagEnabled('?ign_terrain=0'), false);
  // Anything truthy-looking but not `1` stays off: a dev flag that turns on by
  // accident is worse than one that needs to be typed exactly.
  assert.equal(ignTerrainFlagEnabled('?ign_terrain=true'), false);
  assert.equal(ignTerrainFlagEnabled('?ign_terrain'), false);
});
