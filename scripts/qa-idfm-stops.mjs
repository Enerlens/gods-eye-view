/**
 * qa-idfm-stops.mjs — what a reader reported about the IDFM stops on
 * 2026-09-10, asserted as numbers against the LIVE app.
 *
 *   1. SEATING. « les icônes bougent quand on bouge la carte. » The layer drew
 *      its marks on the ELLIPSOID while the photorealistic mesh over the Latin
 *      Quarter reads 83 to 114 m, so every mark stood some ninety metres under
 *      its own pavement — and a vertical error under a camera that is not
 *      exactly overhead is a HORIZONTAL error on screen that changes with the
 *      camera. Measured before the fix, nadir at 420 m on a 1400 × 900 canvas:
 *      140 px of median offset, 272 px at worst, and up to 269 px of SLIDE
 *      across a 250 m pan. This harness recomputes all three.
 *
 *      The oracle is `scene.sampleHeight` at each mark's own coordinate — the
 *      same call `renderedSurface.js` seats with, so this is not an independent
 *      measurement of the height. It IS an independent measurement of the two
 *      things that were wrong: that the drawn position and the surface disagree,
 *      and by how many pixels that disagreement MOVES when the camera does.
 *
 *   2. THE KEY. « là, c'est du charabia. » Each ladder row must name the WAIT
 *      rather than the rate, carry no blurb paraphrasing its own label, and the
 *      stops with no published coordinate must appear as an UNMAPPED note
 *      rather than as a counted row between two rows counting what is on
 *      screen.
 *
 *   3. ONE CLICK, ONE CARD. « il faut qu'on puisse cliquer qu'une fois et que
 *      cela affiche l'ensemble des informations. » PR #158 merged the two
 *      layers into one, which is where that fix now lives; this asserts the
 *      outcome from the reader's side. The pictogram and the disc are two marks
 *      on ONE coordinate, and clicking either must leave exactly one card
 *      standing, carrying both publications' lines.
 *
 * WHY THIS EXISTS ALONGSIDE `qa-idfm-network.mjs`. That harness serves fixtures
 * and drives selection through the module, because Chrome for Testing has been
 * measured picking ZERO Cesium entities out of 23 on screen here. This one is
 * the opposite trade on purpose: the INSTALLED Chrome, the live upstreams, the
 * real photoreal mesh, and real CDP input through `page.mouse` — because the
 * defect it is written for is a disagreement between a drawn position and a
 * streamed surface, and neither of those exists in a fixture.
 *
 * Real CDP input, never a hand-dispatched MouseEvent: Cesium's
 * ScreenSpaceEventHandler pairs a pointerdown with a pointerup and tracks
 * pointer identity, and synthetic events satisfy neither — an earlier probe
 * reported every layer as unclickable while the handlers worked perfectly (see
 * `qa-address-layers.mjs`, which learnt this first).
 *
 * Run:  QA_BASE_URL=http://localhost:4310 node scripts/qa-idfm-stops.mjs
 * Exit 0 = no hard failures.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { newQaPage } from './lib/qa-first-run.mjs';

const BASE = process.env.QA_BASE_URL || 'http://localhost:4310';
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find((path) => fs.existsSync(path));

/** Cardinal Lemoine, the stop the whole report was written about. */
const LAT = 48.84688;
const LON = 2.35192;
/** The camera in the reader's screenshots. */
const CAMERA_M = 420;

/** Ceiling on the residual offset a seated mark may still show, in px. */
const MAX_OFFSET_PX = 3;
/** Ceiling on how far a mark may slide across a 250 m pan, in px. */
const MAX_SLIDE_PX = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function record(ok, label, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: CHROME,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await newQaPage(browser);
page.on('pageerror', (error) => console.log('  [pageerror]', String(error).slice(0, 200)));

await page.goto(`${BASE}/?welcome=0`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForFunction(() => window.__godsEyeView?.viewer, { timeout: 120_000 });

/**
 * Put the camera where the harness asked, and check it held.
 *
 * TWICE, and that is not belt-and-braces. The arrival cinematic is a FLIGHT and
 * a flight rewrites the camera every frame, so a bare `setView` is overwritten;
 * `cancelFlight` first handles that. But the scene director can arm ANOTHER
 * flight later, and an earlier cut of this harness parked correctly, waited
 * 25 s for the layers, and then measured a camera that had drifted onto the
 * 16e — reporting the frequency layer as broken when it had simply gone back to
 * its wide regime for a view it was right about. So the park is repeated after
 * the layers are up, and the box is re-read after it.
 */
async function parkCamera() {
  let carto = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.evaluate(({ lat, lon, height }) => {
      const { viewer } = window.__godsEyeView;
      viewer.camera.cancelFlight?.();
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: (lon * Math.PI) / 180, latitude: (lat * Math.PI) / 180, height,
        }),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
    }, { lat: LAT, lon: LON, height: CAMERA_M });
    await sleep(700);
    carto = await page.evaluate(() => {
      const position = window.__godsEyeView.viewer.camera.positionCartographic;
      return {
        height: position.height,
        lat: (position.latitude * 180) / Math.PI,
        lon: (position.longitude * 180) / Math.PI,
      };
    });
    if (Math.abs(carto.height - CAMERA_M) < 40
      && Math.abs(carto.lat - LAT) < 0.002
      && Math.abs(carto.lon - LON) < 0.002) break;
  }
  return carto;
}

await parkCamera();
await page.evaluate(() => {
  // ONE row since PR #158: the hourly offer is no longer a layer of its own.
  window.__godsEyeView.dataManager.setEnabled('idfm-network', true);
});
await sleep(12_000);
// Park again, then give the layer a full scan AND the whole seating backoff
// (~16 s) from the view it will actually be measured in.
const parked = await parkCamera();
record(
  Math.abs(parked.height - CAMERA_M) < 40
    && Math.abs(parked.lat - LAT) < 0.002
    && Math.abs(parked.lon - LON) < 0.002,
  'the camera parked where the harness asked, and held',
  `${Math.round(parked.height)} m, ${parked.lat.toFixed(4)}/${parked.lon.toFixed(4)}`,
);
await sleep(25_000);

/**
 * Park, and wait until the layer is actually CHARTING before measuring.
 *
 * The scene director can arm a flight at any time, and a camera that has left
 * the Latin Quarter puts the layer back in its wide regime — where it is right
 * to draw no discs and publish no ladder. An earlier cut of this harness read
 * the key at such a moment and reported « la clé ne nomme pas l'attente » for a
 * key that was correctly empty. So every measuring section re-parks first and
 * waits for the layer to say it is charting, rather than trusting a sleep.
 *
 * @returns {Promise<object>} The layer's own stats at the moment it settled.
 */
async function settleOnStops(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  let stats = null;
  while (Date.now() < deadline) {
    await parkCamera();
    stats = await page.evaluate(() => window.__godsEyeView.dataManager.getAll()
      .find((layer) => layer.id === 'idfm-network')?.stats || null);
    if (stats?.regime === 'arrets' && stats.charted > 0) return stats;
    await sleep(2_000);
  }
  return stats;
}

// ---------------------------------------------------------------------------
// 1. Seating
// ---------------------------------------------------------------------------

const settled = await settleOnStops();
record(
  settled?.regime === 'arrets' && settled.charted > 0,
  'the layer is charting the stops it will be measured on',
  `regime ${settled?.regime}, ${settled?.charted} chiffrés`,
);

const drift = await page.evaluate(() => {
  const { viewer } = window.__godsEyeView;
  const { scene, camera } = viewer;
  const source = viewer.dataSources.getByName('idfm-network')[0];
  if (!source) return { error: 'no idfm-network data source' };
  const ellipsoid = scene.globe.ellipsoid;
  const now = viewer.clock.currentTime;
  const width = scene.canvas.clientWidth;
  const height = scene.canvas.clientHeight;
  const toWindow = (position) => {
    const point = scene.cartesianToCanvasCoordinates(position);
    return point && Number.isFinite(point.x) ? point : null;
  };
  const rows = [];
  for (const entity of source.entities.values) {
    const position = entity.position?.getValue(now);
    if (!position) continue;
    const point = toWindow(position);
    if (!point || point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue;
    const carto = ellipsoid.cartesianToCartographic(position);
    let surfaceM = null;
    try {
      surfaceM = scene.sampleHeight({
        longitude: carto.longitude, latitude: carto.latitude, height: 0,
      });
    } catch { /* mid-teardown */ }
    if (surfaceM == null) continue;
    rows.push({
      name: entity.name,
      drawnM: carto.height,
      surfaceM,
      position,
      seated: position.constructor.fromRadians(carto.longitude, carto.latitude, surfaceM),
    });
  }
  const snapshot = () => rows.map((row) => {
    const drawn = toWindow(row.position);
    const seated = toWindow(row.seated);
    return (drawn && seated) ? { dx: drawn.x - seated.x, dy: drawn.y - seated.y } : null;
  });
  const before = snapshot();
  camera.moveRight(250);
  scene.render();
  const after = snapshot();
  camera.moveLeft(250);
  scene.render();
  const offsets = [];
  const slides = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (!before[i] || !after[i]) continue;
    offsets.push(Math.hypot(before[i].dx, before[i].dy));
    slides.push(Math.hypot(after[i].dx - before[i].dx, after[i].dy - before[i].dy));
  }
  const median = (list) => (list.length
    ? list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)] : null);
  return {
    onScreen: rows.length,
    heightErrorM: rows.length
      ? Math.max(...rows.map((row) => Math.abs(row.drawnM - row.surfaceM))) : null,
    medianOffsetPx: median(offsets),
    maxOffsetPx: offsets.length ? Math.max(...offsets) : null,
    maxSlidePx: slides.length ? Math.max(...slides) : null,
    surfaceSpanM: rows.length
      ? Math.max(...rows.map((r) => r.surfaceM)) - Math.min(...rows.map((r) => r.surfaceM)) : null,
  };
});

console.log('\n--- 1. SEATING ---');
console.log(JSON.stringify(drift, null, 2));
record(drift.onScreen > 0, 'stops are drawn in the viewport', `${drift.onScreen} on screen`);
record(
  drift.maxOffsetPx !== null && drift.maxOffsetPx <= MAX_OFFSET_PX,
  'every stop is drawn where its stop is',
  `worst ${drift.maxOffsetPx?.toFixed(1)} px (was 272)`,
);
record(
  drift.maxSlidePx !== null && drift.maxSlidePx <= MAX_SLIDE_PX,
  'and stays there across a 250 m pan',
  `worst ${drift.maxSlidePx?.toFixed(1)} px (was 269)`,
);

const discs = await page.evaluate(() => {
  const { scene } = window.__godsEyeView.viewer;
  const ellipsoid = scene.globe.ellipsoid;
  let collection = null;
  for (let i = 0; i < scene.primitives.length; i += 1) {
    const primitive = scene.primitives.get(i);
    if (primitive?.constructor?.name === 'PointPrimitiveCollection' && primitive.length) {
      const first = primitive.get(0);
      if (typeof first?.id === 'string' && first.id.startsWith('idfm-freq:')) {
        collection = primitive;
        break;
      }
    }
  }
  if (!collection) {
    // A missing collection is usually a layer that never left the WIDE regime
    // (départements, not discs) or one whose box the proxy refused — say which,
    // rather than reporting a seating failure for a layer that drew nothing.
    const layer = window.__godsEyeView.dataManager.getAll()
      .find((entry) => entry.id === 'idfm-network');
    return {
      error: 'no idfm-network point collection',
      enabled: layer?.enabled,
      stats: layer?.stats,
    };
  }
  let worst = 0;
  let checked = 0;
  for (let i = 0; i < Math.min(collection.length, 30); i += 1) {
    const carto = ellipsoid.cartesianToCartographic(collection.get(i).position);
    let surfaceM = null;
    try {
      surfaceM = scene.sampleHeight({
        longitude: carto.longitude, latitude: carto.latitude, height: 0,
      });
    } catch { /* mid-teardown */ }
    if (surfaceM == null) continue;
    checked += 1;
    // The discs carry a deliberate 2 m lift so they are not swallowed by the
    // surface they sit on; that lift is the expected residual, not an error.
    worst = Math.max(worst, Math.abs(carto.height - surfaceM - 2));
  }
  return { drawn: collection.length, checked, worstResidualM: worst };
});
console.log(JSON.stringify(discs, null, 2));
record(
  discs.checked > 0 && discs.worstResidualM < 1,
  'the frequency discs sit on the surface too, at their own 2 m lift',
  `worst residual ${discs.worstResidualM?.toFixed(2)} m`,
);

// ---------------------------------------------------------------------------
// 1b. The legend a reader misread
// ---------------------------------------------------------------------------

await settleOnStops();
const legend = await page.evaluate(() => {
  const host = document.getElementById('map-legend-items');
  if (!host) return { error: 'no legend host' };
  const group = [...host.querySelectorAll('.map-legend-group')]
    .find((node) => /IDFM/.test(node.querySelector('.map-legend-layer')?.textContent || ''));
  if (!group) return { error: 'no IDFM legend group' };
  return {
    heightPx: Math.round(group.getBoundingClientRect().height),
    rows: [...group.querySelectorAll('.map-legend-entry')].map((entry) => ({
      unmapped: entry.querySelector('.map-legend-swatch')?.classList.contains('is-unmapped'),
      label: entry.querySelector('.map-legend-label')?.textContent || '',
      blurb: entry.querySelector('.map-legend-blurb')?.textContent || null,
    })),
  };
});
console.log('\n--- 1b. LEGEND ---');
console.log(JSON.stringify(legend, null, 2));
const ladder = (legend.rows || []).filter((row) => !row.unmapped
  && !/aucun passage/.test(row.label));
record(
  ladder.length > 0 && ladder.every((row) => /toutes les|d’attente/.test(row.label)),
  'every ladder row names the WAIT, not the rate',
);
record(
  ladder.every((row) => row.blurb === null),
  'and none of them carries a blurb that repeats its own label',
);
const unplaced = (legend.rows || []).find((row) => row.unmapped);
record(
  Boolean(unplaced) && /sur aucune carte/.test(unplaced.label),
  'the unplaced stops are an unmapped note, not a counted row',
  unplaced ? unplaced.label : 'row absent',
);

// ---------------------------------------------------------------------------
// 2. One click, one card
// ---------------------------------------------------------------------------

/**
 * Every card this app has open over an IDFM stop.
 *
 * `idfm-frequency-selected` is read as well as `idfm-network`, and it is not
 * dead code: it is the source the retired layer used, and this harness's whole
 * job on point 3 is to prove that no SECOND panel appears over one stop. A
 * probe that only looked where the surviving card lives could not tell a fixed
 * defect from a renamed one.
 */
const openCards = () => page.evaluate(async () => {
  const overlay = await import('/src/overlays/worldOverlay.js');
  const read = (id) => overlay.getOverlaySourceEntries(id) || [];
  const network = read('idfm-network');
  const retired = read('idfm-frequency-selected');
  const shown = network[0] || retired[0] || null;
  return {
    network: network.length,
    retired: retired.length,
    card: shown ? [shown.title, ...(shown.details || [])] : null,
  };
});

/**
 * A screen point where the wanted KIND of mark owns its own pixel.
 *
 * The two marks are CONCENTRIC — the frequency disc tops out at 13 px, the mode
 * badge is 21 to 27 — and since PR #162 the disc is HIDDEN wherever a badge
 * stands. So a `pastille` target only exists on a stop the referential page did
 * not return, and the sweep below has to try several stops rather than assume
 * the first one on screen carries both. Aiming at the centre alone would report
 * the badge as unclickable when the disc is merely on top of it.
 */
const aimAt = (kind) => page.evaluate((want) => {
  const { viewer } = window.__godsEyeView;
  const { scene } = viewer;
  const rect = scene.canvas.getBoundingClientRect();
  const now = viewer.clock.currentTime;
  const source = viewer.dataSources.getByName('idfm-network')[0];
  const wanted = (id) => (want === 'pictogramme'
    ? String(id).startsWith('idfm:stop:')
    : String(id).startsWith('idfm-freq:'));
  for (const entity of (source ? source.entities.values : [])) {
    const position = entity.position?.getValue(now);
    if (!position) continue;
    const point = scene.cartesianToCanvasCoordinates(position);
    if (!point || point.x < 60 || point.y < 60
      || point.x > scene.canvas.clientWidth - 60
      || point.y > scene.canvas.clientHeight - 60) continue;
    for (const [dx, dy] of [[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7], [6, 6], [-6, -6]]) {
      const picked = scene.pick({ x: point.x + dx, y: point.y + dy });
      const id = typeof picked?.id === 'string' ? picked.id : picked?.id?.id;
      if (typeof id === 'string' && wanted(id)) {
        return { x: rect.left + point.x + dx, y: rect.top + point.y + dy, pickedId: id, name: entity.name };
      }
    }
  }
  return null;
}, kind);

console.log('\n--- 2. ONE CLICK, ONE CARD ---');
await settleOnStops();
for (const kind of ['pictogramme', 'pastille']) {
  /* eslint-disable no-await-in-loop */
  const target = await aimAt(kind);
  if (!target && kind === 'pastille') {
    // NOT a failure since PR #162: a disc yields to the badge above it, so in a
    // view where every profiled stop is also on the referential page there is
    // no bare disc left to click. Nothing to assert, and saying "unclickable"
    // would report the layer broken for doing exactly what it was asked to do.
    console.log('  (aucune pastille à nu dans cette vue — toutes sous un badge, cf. #162)');
    continue;
  }
  if (!target) {
    record(false, `a ${kind} owns a pixel on screen`);
    continue;
  }
  await page.mouse.click(target.x, target.y);
  await sleep(1200);
  const cards = await openCards();
  console.log(`\nclic sur le ${kind} — ${target.name} (${target.pickedId})`);
  if (cards.card) console.log(cards.card.map((line) => `  | ${line}`).join('\n'));
  record(
    cards.network + cards.retired === 1,
    `clicking the ${kind} leaves exactly one card standing`,
    `réseau ${cards.network}, ancienne source fréquence ${cards.retired}`,
  );
  record(
    Boolean(cards.card?.some((line) => /zone \d|plain-pied/.test(line))),
    'and that card carries the referential\'s own lines',
  );
  record(
    Boolean(cards.card?.some((line) => /par heure ici|Rien ne passe ici/.test(line))),
    'and the hourly offer\'s own lines, on the same card',
  );
  await page.keyboard.press('Escape');
  await sleep(600);
  /* eslint-enable no-await-in-loop */
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
