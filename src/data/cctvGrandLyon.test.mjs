import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlaceholderCctvFrame,
  isTruncatedJpegFrame,
  loadLyonSourcesFromOpenData,
  normalizeGrandLyonCamera,
} from '../../vite.config.js';
import { staticFrameRefreshMs } from './cctvLod.js';

/*
 * Métropole de Lyon "Caméras Web Criter" pack.
 *
 * Every fixture below is SYNTHETIC, hand-written to the SHAPE of the published
 * catalog (field names and value formats verified against
 * data.grandlyon.com/fr/datapusher/ws/rdata/pvo_patrimoine_voirie.pvocameracriter),
 * so the suite never touches the network and no upstream payload is committed.
 */

const FRAME_ORIGIN = 'https://download.data.grandlyon.com/files/rdata/pvo_patrimoine_voirie.pvocameracriter/';
const NOW = Date.parse('2026-08-26T10:40:00+02:00');

/** One catalog row, defaulted to a healthy Porte de Gerland camera. */
function row(overrides = {}) {
  return {
    nom: 'Porte de Gerland',
    libellelong: 'Avenue T.Garnier / Avenue J.Jaurès',
    identifiant: 259,
    numeromaintenance: 'CWL7033',
    typecamera: 'Web',
    fournisseur: 'CRITER',
    observation: 'Direction : Porte de Gerland',
    url: `${FRAME_ORIGIN}CWL7033.JPG`,
    gid: 40,
    last_update: '2026-08-26 10:34:19+02:00',
    lat: 45.726733643986854,
    lon: 4.830317178921582,
    ...overrides,
  };
}

/** A fetch stand-in returning one catalog payload, then recording its call. */
function catalogFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok,
      status,
      json: async () => payload,
    };
  };
  impl.calls = calls;
  return impl;
}

test('Grand Lyon rows normalize into keyless Lyon camera sources', () => {
  const camera = normalizeGrandLyonCamera(row(), NOW);

  assert.equal(camera.id, 'lyon-cwl7033');
  assert.equal(camera.city, 'Lyon');
  assert.equal(camera.cityId, 'lyon');
  assert.equal(camera.sourceKind, 'grandlyon-open-data');
  assert.equal(camera.feedType, 'image');
  // The frame URL is taken from the catalog verbatim — never reconstructed.
  assert.equal(camera.url, `${FRAME_ORIGIN}CWL7033.JPG`);
  assert.equal(camera.snapshotUrl, camera.url);
  assert.match(camera.license, /Licence Ouverte/);
  assert.match(camera.provider, /Métropole de Lyon/);
});

test('Grand Lyon camera names carry the site and the direction it faces', () => {
  assert.equal(
    normalizeGrandLyonCamera(row(), NOW).name,
    'Avenue T.Garnier / Avenue J.Jaurès (dir. Porte de Gerland)'
  );
  // Site only.
  assert.equal(
    normalizeGrandLyonCamera(row({ nom: '' }), NOW).name,
    'Avenue T.Garnier / Avenue J.Jaurès'
  );
  // Direction only.
  assert.equal(
    normalizeGrandLyonCamera(row({ libellelong: '' }), NOW).name,
    'Porte de Gerland'
  );
  // Identical site and direction must not render "X (dir. X)".
  assert.equal(
    normalizeGrandLyonCamera(row({ libellelong: 'Eurexpo', nom: 'Eurexpo' }), NOW).name,
    'Eurexpo'
  );
  // Neither: the maintenance code still yields a usable label.
  assert.equal(
    normalizeGrandLyonCamera(row({ libellelong: '', nom: '' }), NOW).name,
    'Caméra Criter CWL7033'
  );
});

test('an uncurated Grand Lyon camera stays an explicit low-confidence prior', () => {
  // CWL7033 is deliberately absent from the curated table: it publishes an
  // "image unavailable" placeholder, so there is no frame to calibrate against.
  const camera = normalizeGrandLyonCamera(row(), NOW);
  assert.equal(camera.headingConfidence, 'low');
  assert.equal(camera.poseSource, undefined, 'an uncalibrated pose must not claim to be curated');
  assert.ok(Number.isFinite(camera.headingDeg));
  assert.ok(camera.headingDeg >= 0 && camera.headingDeg < 360);
  assert.equal(camera.pitchDeg, -18);
  assert.equal(camera.fovDeg, 44);
  assert.equal(camera.rangeM, 145);
  assert.equal(camera.mountHeightM, 8);

  // The fallback heading is derived from the id, so it is stable across refreshes.
  assert.equal(normalizeGrandLyonCamera(row(), NOW).headingDeg, camera.headingDeg);

  // A cardinal-looking word in free-form French text must not become a facing.
  const westish = normalizeGrandLyonCamera(
    row({ numeromaintenance: 'CWL9999', libellelong: 'Rue de l\'Ouest', observation: 'Direction : Ouest' }),
    NOW
  );
  assert.equal(westish.headingConfidence, 'low');
  assert.equal(westish.poseSource, undefined);
});

test('a curated Grand Lyon camera carries its hand-derived bearing and says so', () => {
  // CWML005 (Pont de la Mulatière, toward the M7): road axis 167/347 from OSM,
  // Pierre-Bénite bears 167 — the two halves of the derivation agree exactly.
  const camera = normalizeGrandLyonCamera(row({
    numeromaintenance: 'CWML005',
    url: `${FRAME_ORIGIN}CWML005.JPG`,
    lat: 45.728861,
    lon: 4.815704,
  }), NOW);

  assert.equal(camera.headingDeg, 167);
  assert.equal(camera.headingConfidence, 'high');
  // The badge input is what stops a hand-derived pose from reading as a survey.
  assert.equal(camera.poseSource, 'curated');
  // A known facing earns the narrower, longer, steeper personality.
  assert.equal(camera.pitchDeg, -24);
  assert.equal(camera.fovDeg, 56);
  assert.equal(camera.rangeM, 210);
  assert.equal(camera.mountHeightM, 10);
});

test('the curated bearing is keyed by maintenance code, case-insensitively', () => {
  const upper = normalizeGrandLyonCamera(row({ numeromaintenance: 'CWTA006', url: `${FRAME_ORIGIN}CWTA006.JPG`, lat: 45.76378, lon: 4.781297 }), NOW);
  const lower = normalizeGrandLyonCamera(row({ numeromaintenance: 'cwta006', url: `${FRAME_ORIGIN}CWTA006.JPG`, lat: 45.76378, lon: 4.781297 }), NOW);
  assert.equal(upper.headingDeg, 40);
  assert.equal(lower.headingDeg, 40, 'a lowercased code must resolve the same curated pose');
  assert.equal(upper.id, lower.id);
});

test('every curated bearing is a real compass value', () => {
  // A typo here (negative, >360, or a string) would silently sail through
  // normalizeSourceItem as a finite number and mis-aim a camera.
  const codes = ['CWL9018', 'CWL5801', 'CWL3005', 'CWL6165', 'CWVV011', 'CW1L8114',
    'CW2L8114', 'CWBR044', 'CW3CL005', 'CWBR043', 'CWVL802', 'CWTA006', 'CWML005', 'CWL9801'];
  for (const code of codes) {
    const camera = normalizeGrandLyonCamera(row({ numeromaintenance: code, url: `${FRAME_ORIGIN}${code}.JPG` }), NOW);
    assert.equal(camera.poseSource, 'curated', `${code} lost its curated pose`);
    assert.equal(typeof camera.headingDeg, 'number', `${code} heading is not a number`);
    assert.ok(camera.headingDeg >= 0 && camera.headingDeg < 360, `${code} heading ${camera.headingDeg} is out of range`);
    assert.ok(Number.isInteger(camera.headingDeg), `${code} heading is not a whole degree`);
  }
});

test('Grand Lyon cameras pace their ambient card frames at the Criter cadence', () => {
  // The provider string is the key into the ambient-card refresh table, so a
  // rename on either side must not silently fall back to the 5-minute default.
  assert.equal(staticFrameRefreshMs(normalizeGrandLyonCamera(row(), NOW)), 3 * 60 * 1000);
});

test('Grand Lyon rows without a stable maintenance code are rejected', () => {
  assert.equal(normalizeGrandLyonCamera(row({ numeromaintenance: '' }), NOW), null);
  assert.equal(normalizeGrandLyonCamera(row({ numeromaintenance: null }), NOW), null);
  assert.equal(normalizeGrandLyonCamera(null, NOW), null);
  assert.equal(normalizeGrandLyonCamera('CWL7033', NOW), null);
});

test('Grand Lyon rows outside the Métropole are rejected', () => {
  // Paris.
  assert.equal(normalizeGrandLyonCamera(row({ lat: 48.8566, lon: 2.3522 }), NOW), null);
  // Swapped lat/lon.
  assert.equal(normalizeGrandLyonCamera(row({ lat: 4.83, lon: 45.72 }), NOW), null);
  // Null island.
  assert.equal(normalizeGrandLyonCamera(row({ lat: 0, lon: 0 }), NOW), null);
  // Missing coordinates.
  assert.equal(normalizeGrandLyonCamera(row({ lat: null, lon: null }), NOW), null);
});

test('Grand Lyon frame URLs are pinned to the official open-data origin', () => {
  assert.equal(normalizeGrandLyonCamera(row({ url: 'https://evil.example/CWL7033.JPG' }), NOW), null);
  // Right host, wrong path — the pin is on the full frame prefix.
  assert.equal(
    normalizeGrandLyonCamera(row({ url: 'https://download.data.grandlyon.com/files/rdata/other/CWL7033.JPG' }), NOW),
    null
  );
  // Plain http must not pass as the https origin.
  assert.equal(
    normalizeGrandLyonCamera(row({ url: 'http://download.data.grandlyon.com/files/rdata/pvo_patrimoine_voirie.pvocameracriter/CWL7033.JPG' }), NOW),
    null
  );
  assert.equal(normalizeGrandLyonCamera(row({ url: '' }), NOW), null);
});

test('Grand Lyon cameras whose frames stopped refreshing are dropped', () => {
  // The catalog has no in-service flag; a frozen `last_update` is the only
  // decommissioned signal, and a dead camera would otherwise render a permanent
  // Street View / synthetic fallback.
  assert.equal(normalizeGrandLyonCamera(row({ last_update: '2020-01-01 00:00:00+01:00' }), NOW), null);
  // Just inside the 12 h window: kept.
  assert.ok(normalizeGrandLyonCamera(row({ last_update: '2026-08-25 23:00:00+02:00' }), NOW));
  // Just outside it: dropped.
  assert.equal(normalizeGrandLyonCamera(row({ last_update: '2026-08-25 20:00:00+02:00' }), NOW), null);
});

test('Grand Lyon staleness check fails open on an unreadable stamp', () => {
  // An upstream schema change must degrade the freshness filter, not blank the pack.
  assert.ok(normalizeGrandLyonCamera(row({ last_update: null }), NOW));
  assert.ok(normalizeGrandLyonCamera(row({ last_update: '' }), NOW));
  assert.ok(normalizeGrandLyonCamera(row({ last_update: 'jamais' }), NOW));
});

test('Grand Lyon loader parses the catalog payload and drops unusable rows', async () => {
  const fetchImpl = catalogFetch({
    fields: ['nom', 'numeromaintenance', 'url', 'lat', 'lon'],
    values: [
      row(),
      row({ numeromaintenance: 'CWBR044', nom: 'Eurexpo', libellelong: 'Bd des Droits de l\'Homme', url: `${FRAME_ORIGIN}CWBR044.JPG`, lat: 45.72711, lon: 4.927524 }),
      row({ numeromaintenance: 'CWDEAD', url: 'https://evil.example/x.jpg' }),
      row({ numeromaintenance: '' }),
    ],
  });

  const cameras = await loadLyonSourcesFromOpenData({ fetchImpl, nowMs: NOW });

  assert.deepEqual(cameras.map((camera) => camera.id).sort(), ['lyon-cwbr044', 'lyon-cwl7033']);
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0].url, /^https:\/\/data\.grandlyon\.com\//);
  assert.ok(fetchImpl.calls[0].options.signal instanceof AbortSignal, 'catalog fetch must be time-bounded');
});

test('Grand Lyon loader deduplicates repeated maintenance codes', async () => {
  const fetchImpl = catalogFetch({
    values: [row({ libellelong: 'Ancien libellé' }), row({ libellelong: 'Avenue T.Garnier / Avenue J.Jaurès' })],
  });

  const cameras = await loadLyonSourcesFromOpenData({ fetchImpl, nowMs: NOW });

  assert.equal(cameras.length, 1);
  // Last write wins, matching every other pack's dedup.
  assert.equal(cameras[0].name, 'Avenue T.Garnier / Avenue J.Jaurès (dir. Porte de Gerland)');
});

test('Grand Lyon loader keeps the cameras nearest the city core when capped', async () => {
  const previous = process.env.CCTV_LYON_MAX_SOURCES;
  process.env.CCTV_LYON_MAX_SOURCES = '8'; // 8 is the floor the loader clamps to
  try {
    // Nine rows: eight around Place Bellecour, one far out at Givors.
    const near = Array.from({ length: 8 }, (_, index) => row({
      numeromaintenance: `CWNEAR${index}`,
      url: `${FRAME_ORIGIN}CWNEAR${index}.JPG`,
      lat: 45.7578 + index * 0.001,
      lon: 4.8320,
    }));
    const far = row({ numeromaintenance: 'CWFAR', url: `${FRAME_ORIGIN}CWFAR.JPG`, lat: 45.5900, lon: 4.7700 });
    const fetchImpl = catalogFetch({ values: [far, ...near] });

    const cameras = await loadLyonSourcesFromOpenData({ fetchImpl, nowMs: NOW });

    assert.equal(cameras.length, 8);
    assert.ok(!cameras.some((camera) => camera.id === 'lyon-cwfar'), 'the farthest camera is the one dropped');
  } finally {
    if (previous === undefined) delete process.env.CCTV_LYON_MAX_SOURCES;
    else process.env.CCTV_LYON_MAX_SOURCES = previous;
  }
});

test('Grand Lyon loader fails soft on upstream trouble', async () => {
  assert.deepEqual(await loadLyonSourcesFromOpenData({ fetchImpl: catalogFetch({}, { ok: false, status: 503 }), nowMs: NOW }), []);
  assert.deepEqual(await loadLyonSourcesFromOpenData({ fetchImpl: catalogFetch({ values: [] }), nowMs: NOW }), []);
  assert.deepEqual(await loadLyonSourcesFromOpenData({ fetchImpl: catalogFetch({ values: 'nope' }), nowMs: NOW }), []);
  assert.deepEqual(
    await loadLyonSourcesFromOpenData({ fetchImpl: async () => { throw new Error('network down'); }, nowMs: NOW }),
    []
  );
});


// ── Provider "image unavailable" placeholder ─────────────────────────────────

test('the Metropole placeholder graphic is recognised by content', () => {
  // Nothing else can catch it: the catalog has no in-service flag, the row's
  // last_update keeps advancing every minute while the placeholder is served,
  // and the response is a valid HTTP 200 JPEG. Only the bytes give it away.
  // Fixture: the first 64 bytes cannot stand in for the real file, so this
  // asserts the CONTRACT (unknown bytes pass through) plus the guard rails.
  assert.equal(isPlaceholderCctvFrame(null), false);
  assert.equal(isPlaceholderCctvFrame(undefined), false);
  assert.equal(isPlaceholderCctvFrame(Buffer.alloc(0)), false);
  // An ordinary frame must never be mistaken for the placeholder — the check
  // fails OPEN, so anything it does not recognise is served unchanged.
  assert.equal(isPlaceholderCctvFrame(Buffer.from('a real jpeg body')), false);
  assert.equal(isPlaceholderCctvFrame(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), false);
});

// ── Frames caught mid-write ──────────────────────────────────────────────────

/** A minimal but STRUCTURALLY valid JPEG: SOI, a marker segment, then EOI. */
function jpegBody({ eoi = true, trailer = 0 } = {}) {
  const parts = [
    Buffer.from([0xFF, 0xD8]),            // SOI
    Buffer.from([0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00]), // APP0
    Buffer.alloc(500, 0x5a),              // stand-in scan data
  ];
  if (eoi) parts.push(Buffer.from([0xFF, 0xD9]));
  if (trailer) parts.push(Buffer.alloc(trailer, 0x00));
  return Buffer.concat(parts);
}

test('a JPEG that stops before its end-of-image marker is called truncated', () => {
  // Measured on CWL5801: 12 fetches, 0 complete, byte count stable within each
  // publication minute — the published file is itself incomplete, so no short
  // Content-Length (the host is chunked), no error status, and the SOF header
  // still claims the full frame. The browser paints the rows it got and leaves
  // the rest transparent, which is a 1920x1440 camera rendering as a strip.
  assert.equal(isTruncatedJpegFrame(jpegBody({ eoi: false })), true);
  assert.equal(isTruncatedJpegFrame(jpegBody({ eoi: true })), false);
});

test('trailing metadata after the marker is not truncation', () => {
  // Some cameras append bytes after EOI; requiring the marker to be the very
  // last two bytes would condemn every one of their frames.
  assert.equal(isTruncatedJpegFrame(jpegBody({ eoi: true, trailer: 8 })), false);
  assert.equal(isTruncatedJpegFrame(jpegBody({ eoi: true, trailer: 40 })), false);
});

test('the truncation check fails open on anything it cannot judge', () => {
  // Not a JPEG: not this function's call. Never guess a non-JPEG is broken.
  assert.equal(isTruncatedJpegFrame(Buffer.from('<svg xmlns="..."/>')), false);
  assert.equal(isTruncatedJpegFrame(Buffer.from([0x89, 0x50, 0x4e, 0x47])), false); // PNG
  assert.equal(isTruncatedJpegFrame(Buffer.alloc(0)), false);
  assert.equal(isTruncatedJpegFrame(Buffer.from([0xFF, 0xD8])), false);
  assert.equal(isTruncatedJpegFrame(null), false);
  assert.equal(isTruncatedJpegFrame(undefined), false);
});

test('a complete frame is never mistaken for a truncated one', () => {
  // The guard rail that matters: a false positive sends a healthy camera to
  // Street View forever, so the trailer tolerance has to clear anything a real
  // camera might append. (A 64-byte window failed this at trailer 63.)
  for (const trailer of [0, 1, 2, 16, 63, 256, 1024, 4000]) {
    assert.equal(isTruncatedJpegFrame(jpegBody({ eoi: true, trailer })), false, `trailer ${trailer}`);
  }
});

test('an embedded thumbnail marker cannot vouch for a truncated frame', () => {
  // EXIF thumbnails carry their own EOI near the START of the file. Scanning
  // the whole buffer for any FFD9 would find it and pass a frame that stops
  // half way, which is exactly the bug being fixed.
  const withThumbnail = Buffer.concat([
    Buffer.from([0xFF, 0xD8]),                 // SOI
    Buffer.from([0xFF, 0xE1, 0x00, 0x08]),     // APP1 (EXIF)
    Buffer.from([0xFF, 0xD8, 0x00, 0x00, 0xFF, 0xD9]), // the thumbnail, closed
    Buffer.alloc(200_000, 0x5a),               // main scan data, cut off
  ]);
  assert.equal(isTruncatedJpegFrame(withThumbnail), true);
});
