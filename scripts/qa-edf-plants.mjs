#!/usr/bin/env node
/**
 * Deterministic browser proof for the EDF generating-fleet layer
 * (`edf-power-plants`).
 *
 * The upstream is annual rather than live, but it is still not a fixed truth —
 * EDF republishes these files and the numbers move. So this harness intercepts
 * `/api/edf-plants` with the SAME captured EDF payloads the unit tests use, run
 * through the real `projectEdfPlants` projection so the fixture cannot drift
 * from what the proxy actually serves, and proves the four things only a real
 * Cesium scene can prove:
 *
 *   i.   19 published rows become 11 MARKS — six Gravelines reactor rows draw
 *        one marker, not six stacked on one pixel
 *   ii.  capacity reaches the globe as AREA: Gravelines saturates, Grand-Maison
 *        sits between it and Grandval, read off the rendered primitives — and
 *        each filière is drawn with its OWN silhouette where the silhouette
 *        fits, four rasters for eleven sites (three shapes plus the plate a
 *        mark under 20 px keeps whole) rather than one texture per marker
 *   iii. the hydro file's x=latitude convention survives all the way to the
 *        rendered position — Grand-Maison unprojects to 45.15 N 6.05 E, and
 *        every site lands inside metropolitan France
 *   iv.  the labels are actually PAINTED, and each one says what its object is
 *   v.   the FILTER reaches the globe: choosing one filière removes the other
 *        two from the scene AND from the overlay, its sub-categories appear on
 *        the row only once it is chosen, and clearing brings the fleet back
 *
 * Screenshots are written under the gitignored `qa-shots/edf-plants/`.
 *
 * Run: node scripts/qa-edf-plants.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import { projectEdfPlants } from '../src/data/edfPlantsFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'edf-plants');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const APP_ORIGIN = new URL(APP_URL).origin;
const HEADFUL = args.includes('--headful');

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A view that holds all of metropolitan France. */
const FRANCE = { lon: 2.6, lat: 46.6, height: 2_200_000 };

/** The palette, duplicated here on purpose: a QA harness asserts, it doesn't import styling. */
const NUCLEAR = '#ffd166';
const HYDRO = '#4fc3f7';
const THERMAL = '#f4736b';
/** The size ramp's ceiling, likewise restated rather than imported. */
const PIXEL_MAX = 34;

const readFixture = (name) => JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'fixtures', `edf-plants-${name}.json`), 'utf8',
));

/**
 * The proxy's own output, built from the captured EDF bodies. Using the real
 * projection rather than a hand-written blob is what keeps this harness honest
 * when the projection changes.
 */
function plantsPayload() {
  const projected = projectEdfPlants({
    nucleaire: { meta: readFixture('nucleaire-dataset'), lines: readFixture('nucleaire-sample') },
    hydraulique: { meta: readFixture('hydraulique-dataset'), lines: readFixture('hydraulique-sample') },
    thermique: { meta: readFixture('thermique-dataset'), lines: readFixture('thermique-sample') },
  }, 'EDF Open Data (qa fixture)');
  return {
    fetchedAt: Date.now(),
    stale: false,
    ttlMs: 86_400_000,
    source: projected.source,
    sites: projected.sites,
    datasets: projected.datasets,
    totals: projected.totals,
  };
}

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

/**
 * Render `frames` frames explicitly. A software-rendered headless context
 * sometimes has no animation-frame loop at all, so the harness pumps the scene
 * itself rather than trusting the browser.
 */
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame++) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
}

/** Teleport the camera (duck-typed cartographic — no Cesium global). */
async function setView(page, lon, lat, height) {
  await page.evaluate((lo, la, h) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({ longitude: lo * d2r, latitude: la * d2r, height: h }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 4);
}

/** Screenshot, best-effort — these are evidence, not assertions. */
async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/**
 * Read the layer's rendered state out of the live scene.
 *
 * Deliberately reads the BILLBOARDS, not the layer's own model: the point of a
 * browser proof is that the paint reached the globe, so the sizes, colours and
 * textures here come off the collection and the positions are unprojected back
 * to degrees from the rendered Cartesians.
 */
function sceneProbe(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get('edf-power-plants').module;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const r2d = 180 / Math.PI;

    // Duck-typed: the layer's collection is the one whose marks carry its ids.
    let collection = null;
    for (let i = 0; i < scene.primitives.length; i++) {
      const primitive = scene.primitives.get(i);
      if (typeof primitive?.get !== 'function' || !(primitive.length > 0)) continue;
      if (String(primitive.get(0)?.id || '').startsWith('edf-plants:')) collection = primitive;
    }
    const hex = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : null);

    const points = [];
    for (let i = 0; collection && i < collection.length; i++) {
      const point = collection.get(i);
      const carto = point.position ? ellipsoid.cartesianToCartographic(point.position) : null;
      const image = typeof point.image === 'string' ? point.image : null;
      points.push({
        id: String(point.id),
        pixelSize: point.width,
        height: point.height,
        color: hex(point.color),
        // The whole data URI would be ~2 kB per mark over the CDP hop for no
        // gain: what the assertions need is whether two marks share a texture,
        // and a hash of it answers that in eight characters.
        texture: image ? `${image.length}:${image.slice(-24)}` : null,
        // `Infinity` does not survive the CDP JSON hop, so it is reported as a
        // flag rather than as a number.
        drawnOverTerrain: point.disableDepthTestDistance === Number.POSITIVE_INFINITY,
        depthTestDisabledBeyond: Number.isFinite(point.disableDepthTestDistance)
          ? point.disableDepthTestDistance : null,
        show: point.show !== false,
        lat: carto ? carto.latitude * r2d : null,
        lon: carto ? carto.longitude * r2d : null,
      });
    }
    return {
      stats: module.getStats(),
      analyst: module.getAnalystRecords(20),
      controls: module.getRowControls(),
      overlay: window.__gevWorldOverlay?.getDiagnostics?.() || null,
      points,
      shown: collection ? collection.show !== false : null,
      collectionFound: Boolean(collection),
    };
  });
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 45000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const payload = plantsPayload();
    let apiRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN && url.pathname === '/api/edf-plants') {
        apiRequests += 1;
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(payload),
        });
        return;
      }
      void request.continue();
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Interval polling, not animation-frame polling: headless WebGL can stall
    // the rAF loop outright, and a rAF-polled wait would then time out on an
    // app that booted perfectly well.
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await sleep(2000);
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);

    // ── i. rows become sites ───────────────────────────────────────────────
    console.log('[qa] i. 19 published rows draw 11 site marks');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('edf-power-plants', true));
    let probe = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      probe = await sceneProbe(page);
      if (apiRequests >= 1 && probe.collectionFound && probe.stats.count === 11) break;
    }
    check('the layer fetched its snapshot', apiRequests >= 1, `${apiRequests} request(s)`);
    check('the billboard collection reached the scene', probe.collectionFound);
    check('19 published rows drew 11 marks', probe.points.length === 11,
      `${probe.points.length} marks from ${payload.sites.length} sites`);
    const gravelines = probe.points.find((point) => point.id.endsWith('nucleaire:GRAVELINES'));
    check('the six Gravelines reactors are ONE marker',
      probe.points.filter((point) => point.id.includes('GRAVELINES')).length === 1);
    check('and it carries all six reactors of capacity',
      probe.analyst.find((record) => record.name === 'GRAVELINES')?.units === 6);
    check('every mark is a distinct site', new Set(probe.points.map((p) => p.id)).size === 11);
    // THE PARASOL. A billboard carries one depth for its whole quad, so a
    // finite `disableDepthTestDistance` lets the ground in front of the anchor
    // eat everything below it: reproduced at Gravelines at 6 km camera height,
    // where the 5 460 MW mark painted as a flat-bottomed dome. There is no
    // pixel test for it here because the failure is in the depth buffer, not in
    // the geometry — the primitive is the right size either way.
    check('the marks are drawn OVER the terrain, not depth-tested against it',
      probe.points.length > 0 && probe.points.every((p) => p.drawnOverTerrain),
      `depth-tested beyond ${probe.points.find((p) => !p.drawnOverTerrain)?.depthTestDisabledBeyond} m`);
    await shoot(page, '01-fleet.png');

    // ── ii. capacity is drawn as area ──────────────────────────────────────
    console.log('[qa] ii. installed capacity reaches the globe as area');
    const sizeOf = (fragment) => probe.points.find((point) => point.id.endsWith(fragment))?.pixelSize;
    check('Gravelines (5 460 MW) saturates the ramp', sizeOf('nucleaire:GRAVELINES') === PIXEL_MAX,
      `${sizeOf('nucleaire:GRAVELINES')} px`);
    check('Grand-Maison (1 714 MW) is smaller than Gravelines and larger than Grandval',
      sizeOf('hydraulique:GRAND-MAISON') < PIXEL_MAX
      && sizeOf('hydraulique:GRAND-MAISON') > sizeOf('hydraulique:GRANDVAL'),
      `${sizeOf('hydraulique:GRAND-MAISON')} px vs ${sizeOf('hydraulique:GRANDVAL')} px`);
    // Area, not radius: four times the capacity is twice the diameter above the
    // floor. Bouchain 585 MW against Cordemais 1 160 MW is close enough to 2×
    // that the wrong ramp (linear in MW) would be visible here.
    const bouchain = sizeOf('thermique:BOUCHAIN');
    const cordemais = sizeOf('thermique:CORDEMAIS');
    check('a site with twice the capacity is NOT twice the radius',
      cordemais < bouchain * 1.6, `${cordemais} px vs ${bouchain} px`);
    check('the filière colours are the rendered ones',
      gravelines?.color === NUCLEAR
      && probe.points.find((p) => p.id.endsWith('hydraulique:RANCE'))?.color === HYDRO
      && probe.points.find((p) => p.id.endsWith('thermique:CORDEMAIS'))?.color === THERMAL,
      `${gravelines?.color} / ${probe.points.find((p) => p.id.endsWith('hydraulique:RANCE'))?.color}`);
    // The mark is a SQUARE raster: a width that grew while the height stayed at
    // the floor would stretch the cooling tower rather than enlarge it.
    check('the capacity ramp reaches both sides of the raster',
      probe.points.every((point) => point.pixelSize === point.height),
      probe.points.filter((p) => p.pixelSize !== p.height).map((p) => p.id).join(','));

    // ── ii-bis. one silhouette per filière, WHERE THE SILHOUETTE FITS ──────
    //
    // Four rasters for eleven sites, and the fourth one is the point: under
    // 20 px the punch stops being a shape and becomes a stain eating the middle
    // of the pastille, so a small mark keeps its plate whole. Which of the two a
    // site draws is decided by ITS OWN capacity, so the scene is the place to
    // prove the split actually reaches the globe — Bathie (602 MW, 20.4 px) is
    // punched and Montereau (370 MW, 18.8 px) is not, on the same screen.
    console.log('[qa] ii-bis. each filière carries its own shape, where it fits');
    const textureOf = (fragment) => probe.points.find((point) => point.id.endsWith(fragment))?.texture;
    const colorOf = (fragment) => probe.points.find((point) => point.id.endsWith(fragment))?.color;
    const textures = new Set(probe.points.map((point) => point.texture));
    check('eleven sites cost four rasters: three silhouettes and one plate',
      textures.size === 4, `${textures.size} distinct textures`);
    check('the three filières are drawn with three DIFFERENT silhouettes',
      new Set([
        textureOf('nucleaire:GRAVELINES'),
        textureOf('hydraulique:GRAND-MAISON'),
        textureOf('thermique:CORDEMAIS'),
      ]).size === 3,
      'a shared silhouette would make the shape channel say nothing');
    check('two big sites of the same filière SHARE one texture',
      textureOf('hydraulique:GRAND-MAISON') === textureOf('hydraulique:BATHIE (LA)')
      && textureOf('hydraulique:GRAND-MAISON') !== textureOf('nucleaire:GRAVELINES'),
      'a texture per site would be a texture per atlas entry');
    check('a mark too small to hold a hole keeps its plate, whatever it burns',
      textureOf('hydraulique:GRANDVAL') === textureOf('thermique:MONTEREAU')
      && textureOf('hydraulique:GRANDVAL') !== textureOf('hydraulique:GRAND-MAISON'),
      `${textureOf('hydraulique:GRANDVAL')?.slice(-12)} vs ${textureOf('thermique:MONTEREAU')?.slice(-12)}`);
    check('and it is still told apart by the colour its filière owns',
      colorOf('hydraulique:GRANDVAL') === HYDRO && colorOf('thermique:MONTEREAU') === THERMAL,
      `${colorOf('hydraulique:GRANDVAL')} / ${colorOf('thermique:MONTEREAU')}`);
    check('the key carries the same silhouettes it draws',
      probe.controls.legend.length === 3
      && probe.controls.legend.every((entry) => /^data:image\/svg\+xml;base64,/.test(entry.glyph || '')),
      probe.controls.legend.map((entry) => (entry.glyph ? 'glyph' : 'none')).join(' '));

    // ── iii. x is the latitude, all the way to the rendered position ───────
    console.log('[qa] iii. the hydro x/y convention survives to the globe');
    const grandMaison = probe.points.find((point) => point.id.endsWith('hydraulique:GRAND-MAISON'));
    check('Grand-Maison renders in the Alps, not in the Indian Ocean',
      Math.abs(grandMaison.lat - 45.1458) < 0.001 && Math.abs(grandMaison.lon - 6.0512) < 0.001,
      `${grandMaison.lat?.toFixed(4)} N ${grandMaison.lon?.toFixed(4)} E`);
    check('every rendered site lands inside metropolitan France',
      probe.points.every((point) => point.lat > 41 && point.lat < 51.5
        && point.lon > -5.5 && point.lon < 9.8),
      probe.points.filter((p) => !(p.lat > 41 && p.lat < 51.5)).map((p) => p.id).join(','));
    check('the nuclear "lat, lon" string parsed the same way',
      Math.abs(gravelines.lat - 51.0128) < 0.001 && Math.abs(gravelines.lon - 2.1393) < 0.001,
      `${gravelines.lat?.toFixed(4)} N ${gravelines.lon?.toFixed(4)} E`);
    await shoot(page, '02-positions.png');

    // ── iv. the labels are painted, and say what each object is ────────────
    console.log('[qa] iv. labels are painted and name the object');
    check('the overlay painted this source’s labels',
      (probe.overlay?.paintedBySource?.['edf-power-plants'] || 0) > 0,
      JSON.stringify(probe.overlay?.paintedBySource || {}));
    check('the legend names all three filières with their installed totals',
      probe.controls.legend.length === 3
      && probe.controls.legend.every((entry) => entry.count > 0 && /MW installés/.test(entry.blurb)),
      probe.controls.legend.map((entry) => `${entry.label}:${entry.count}`).join(' '));
    check('the two reference dates are both reported, never collapsed',
      probe.stats.referenceDates.length === 2
      && probe.stats.referenceDates.includes('2023-12-31')
      && probe.stats.referenceDates.includes('2025-12-31'),
      String(probe.stats.referenceDates));
    check('the operator whose fleet this is is named', probe.stats.operator === 'EDF SA');
    check('capacity is reported as installed, not as production',
      probe.stats.capacityMw === 13489.47 && probe.analyst[0].capacityMw === 5460,
      `${probe.stats.capacityMw} MW`);
    check('a hydro plant claims no unit count it was never given',
      probe.analyst.find((record) => record.name === 'GRAND-MAISON')?.units === null);

    // ── iv-bis. the price of drawing over the terrain ──────────────────────
    // Depth testing off at every distance means nothing else stops a site on
    // the far side of the planet from painting through the globe. The cull is
    // a per-frame horizon pass, and this is the only place it can be proved:
    // put the camera over the antipode of metropolitan France and every one of
    // these discs has to be hidden.
    console.log('[qa] iv-bis. the far side of the planet does not paint through the globe');
    await setView(page, -177.4, -46.6, 8_000_000);
    await pump(page, 6, 80);
    const antipode = await sceneProbe(page);
    check('every mark on the far side of the globe is culled',
      antipode.points.length === 11 && antipode.points.every((point) => point.show === false),
      `${antipode.points.filter((point) => point.show).length} still shown`);
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);
    await pump(page, 6, 80);
    const back = await sceneProbe(page);
    check('and they come back when the camera does',
      back.points.length === 11 && back.points.every((point) => point.show === true),
      `${back.points.filter((point) => !point.show).length} still hidden`);

    // ── v. the filter reaches the globe ────────────────────────────────────
    // The chip is clicked THROUGH THE DOM rather than with `page.click()`:
    // `puppeteer-click-hangs-use-dom-clicks` — a real click on this app's
    // canvas-backed panel times out, while `element.click()` answers in a
    // millisecond and still runs the manager's whole params lane.
    //
    // THE IDS ON THE ROW ARE NAMESPACED, and that is not a detail: this row is
    // FUSED (`layerFusions.js`) with Groupes de production and Petite hydro, so
    // `_composedRowControls` prefixes every chip this layer publishes with
    // `edf-power-plants::` and puts two `fusion:` toggles in front of them. The
    // strip is read through that prefix rather than by position, so a fourth
    // companion joining the row cannot silently turn these assertions into
    // assertions about somebody else's buttons.
    console.log('[qa] v. choosing one filière removes the other two');
    const OWN = 'edf-power-plants::';
    const chipLabels = () => page.evaluate((prefix) => [...document.querySelectorAll(
      '[data-layer-id="edf-power-plants"] .data-toggle-chip',
    )]
      .filter((node) => String(node.dataset.chipId || '').startsWith(prefix))
      .map((node) => `${node.dataset.chipId.slice(prefix.length)}${node.classList.contains('active') ? '*' : ''}`), OWN);
    const clickChip = (chipId) => page.evaluate((id) => {
      const node = document.querySelector(
        `[data-layer-id="edf-power-plants"] .data-toggle-chip[data-chip-id="${id}"]`,
      );
      if (!node) return false;
      node.click();
      return true;
    }, `${OWN}${chipId}`);

    const closedStrip = await chipLabels();
    check('the row offers the three filières and nothing below them yet',
      closedStrip.join(' ') === 'f:all* f:nucleaire f:hydraulique f:thermique',
      closedStrip.join(' '));

    check('the NUCLÉAIRE chip is in the DOM and takes a click',
      await clickChip('f:nucleaire'));
    let filtered = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await pump(page, 3, 60);
      await sleep(200);
      filtered = await sceneProbe(page);
      if (filtered.points.length === 2) break;
    }
    check('the globe keeps only the nuclear sites', filtered.points.length === 2,
      `${filtered.points.length} marks`);
    check('and every one of them is a nuclear site',
      filtered.points.every((point) => point.id.includes('nucleaire:')),
      filtered.points.map((point) => point.id).join(','));
    check('the row reports what is on the globe, and what it put away',
      filtered.stats.count === 2 && filtered.stats.hidden === 9
      && filtered.stats.fleetSites === 11,
      `count ${filtered.stats.count}, hidden ${filtered.stats.hidden}`);
    check('the FLEET figures do not move because a reader narrowed the view',
      filtered.stats.capacityMw === 13489.47);
    check('the key follows the globe rather than describing the fleet',
      filtered.controls.legend.length === 1 && filtered.controls.legend[0].label === 'Nucléaire',
      filtered.controls.legend.map((entry) => entry.label).join(' '));
    check('the labels of the other two filières are gone with their marks',
      (filtered.overlay?.paintedBySource?.['edf-power-plants'] || 0) <= 2,
      JSON.stringify(filtered.overlay?.paintedBySource || {}));

    const openStrip = await chipLabels();
    check('the sub-categories appear ONLY now that a filière is chosen',
      openStrip.join(' ') === 'f:all f:nucleaire* f:hydraulique f:thermique k:all* k:REP 900 k:REP 1450',
      openStrip.join(' '));
    await shoot(page, '04-filtered.png');

    await clickChip('k:REP 900');
    let narrowed = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await pump(page, 3, 60);
      await sleep(200);
      narrowed = await sceneProbe(page);
      if (narrowed.points.length === 1) break;
    }
    check('a sub-category narrows the globe again',
      narrowed.points.length === 1 && narrowed.points[0].id.endsWith('nucleaire:GRAVELINES'),
      narrowed.points.map((point) => point.id).join(','));

    // A second click on the lit chip is the way back out, at both levels.
    await clickChip('f:nucleaire');
    let cleared = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await pump(page, 3, 60);
      await sleep(200);
      cleared = await sceneProbe(page);
      if (cleared.points.length === 11) break;
    }
    check('clicking the lit filière again brings the whole fleet back',
      cleared.points.length === 11, `${cleared.points.length} marks`);
    check('and the sub-categories fold away with it',
      (await chipLabels()).join(' ') === 'f:all* f:nucleaire f:hydraulique f:thermique');
    check('no refetch was needed to clear a filter', apiRequests === 1, `${apiRequests} requests`);

    // ── vi. turning it off leaves nothing behind ───────────────────────────
    console.log('[qa] vi. the fleet disappears when the layer is off');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('edf-power-plants', false));
    let after = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await pump(page, 3, 60);
      await sleep(300);
      after = await sceneProbe(page);
      if (after.shown === false) break;
    }
    check('the marks are hidden', after.shown === false);
    check('the labels are gone with them',
      !(after.overlay?.paintedBySource?.['edf-power-plants'] > 0),
      JSON.stringify(after.overlay?.paintedBySource || {}));
    check('and the analyst stops answering for a layer that is off',
      after.analyst.length === 0);
    await shoot(page, '03-off.png');

    const relevantErrors = consoleErrors.filter((text) => /edf|plant|centrale/i.test(text));
    check('no layer console errors', relevantErrors.length === 0, relevantErrors[0] || '');
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`[qa] ${failures.length} FAILED:`);
    for (const failure of failures) console.log(`  · ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('[qa] edf-plants: all checks passed');
  }
  console.log(`[qa] shots → ${path.relative(REPO_ROOT, SHOTS_DIR)}/`);
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
