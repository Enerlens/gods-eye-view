#!/usr/bin/env node
/**
 * QA the airports layer in a real browser.
 *
 *   local-airports  OurAirports, bundled pack (7,466 airports & aerodromes)
 *                   + 418 IGN aerodrome footprints (BD TOPO®, LO 2.0)
 *
 * Checks that the layer registers under the id the share-link registry and the
 * voice enums use, enables, loads every bundled feature, and puts real entities
 * on the globe — plus the three properties this pack claims and could silently
 * lose:
 *
 *   1. IDENTITY survives the round trip. Roissy renders with LFPG/CDG and its
 *      4 215 m runway, because the card is written from these properties and a
 *      dropped field would read as a blank line, not as an error.
 *   2. The FRENCH LONG TAIL is actually there. The whole point of the selection
 *      is that France carries its small aerodromes; a filter regression that
 *      quietly reverted to "large + medium only" would still look like a
 *      working global layer from orbit.
 *   3. NO CLOSED AERODROMES. 13,482 ghost fields sit one clause away.
 *   4. The IGN GROUND is drawn under the French fields, in one colour, clamped
 *      to the terrain, and it disappears from orbit while the pastille does
 *      not — the second publisher of this pack, and the only half of it whose
 *      licence requires attribution.
 *
 * Usage: node scripts/qa-airports.mjs [--url http://localhost:4174] [--headful]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { firstRunLauncherSuppressed, newQaPage } from './lib/qa-first-run.mjs';

const args = process.argv.slice(2);
const getOpt = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = getOpt('--url', 'http://localhost:4174').replace(/\/$/, '');
const HEADFUL = args.includes('--headful');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = path.join(ROOT, 'qa-shots', 'airports');

/** Rebuilt 2026-08-31. A floor, not an equality — see the pack's README. */
const MIN_FEATURES = 7000;
const MIN_FRENCH_SMALL_FIELDS = 900;

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Take a shot, after pumping a frame.
 *
 * `Page.captureScreenshot` waits for the compositor to hand it a NEW frame, and
 * this app runs in Cesium's `requestRenderMode` — parked, it produces none, and
 * the capture hangs past any `protocolTimeout` rather than returning the last
 * one. Asking the render governor for a frame first is what unsticks it.
 * @param {import('puppeteer').Page} page
 * @param {string} file Absolute path to write.
 */
async function shoot(page, file) {
  try {
    await page.evaluate(() => {
      window.__godsEyeView?.requestRender?.('qa-airports:shot');
      window.__godsEyeView?.styleManager?.viewer?.scene?.requestRender?.();
    });
    await sleep(600);
    await page.screenshot({ path: file });
    console.log(`\n  shot → ${file}`);
  } catch (error) {
    // NOT a check. The shot is documentation; the compositor stalling over a
    // photoreal tileset that is 403-blocked in the EEA must not throw away the
    // three dozen assertions that already passed.
    console.log(`\n  shot SKIPPED (${file}): ${error?.message || error}`);
  }
}

/** Poll until `check` returns truthy or the budget runs out. */
async function waitFor(page, check, { timeoutMs = 60_000, everyMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(check);
    if (last) return last;
    await sleep(everyMs);
  }
  return last;
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const executablePath = CHROME_CANDIDATES.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });

  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage', '--window-size=1440,900',
    ],
    // `Page.captureScreenshot` intermittently blew the 30 s default on a
    // machine already running a second dev server: the shot is taken of a
    // 7 464-marker scene the compositor has to flush first. The checks had all
    // passed by then, so the harness was reporting a failure it had not found.
    protocolTimeout: 180_000,
  });

  const consoleErrors = [];
  try {
    const page = await newQaPage(browser);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`));

    console.log(`\nOpening ${APP_URL} …`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });

    const ready = await waitFor(page, () => !!window.__godsEyeView?.dataManager);
    record('app boots and exposes the data manager', !!ready);
    if (!ready) return;

    const registered = await page.evaluate(() => {
      const all = window.__godsEyeView.dataManager.getAll() || [];
      const entry = all.find((layer) => layer.id === 'local-airports') || null;
      return entry ? { name: entry.name, category: entry.category ?? null } : null;
    });
    record('local-airports is registered', !!registered,
      registered ? `name="${registered.name}" category=${registered.category}` : 'absent');
    record('the layer lands in AIR & ESPACE', registered?.category === 'air-space',
      `category=${registered?.category}`);

    await page.evaluate(async () => {
      const dm = window.__godsEyeView.dataManager;
      await dm.setEnabled('local-airports', true, { origin: 'user' });
      await dm.waitForLayerSettled?.('local-airports');
    });

    const stats = await waitFor(page, () => {
      const all = window.__godsEyeView.dataManager.getAll() || [];
      const entry = all.find((layer) => layer.id === 'local-airports');
      const s = entry?.stats ?? null;
      return s && (Number(s.count) > 0 || s.error) ? s : null;
    }, { timeoutMs: 90_000 });

    if (!stats) {
      record('the layer settles within 90 s', false, 'timed out');
      return;
    }

    record('layer reports no error', !stats.error, stats.error || 'clean');
    record('the pack loads every bundled feature', stats.count >= MIN_FEATURES,
      `count=${stats.count} (floor ${MIN_FEATURES})`);

    // ── What actually reached the globe ──────────────────────────────────
    const sample = await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const source = viewer?.dataSources?.getByName?.('Aéroports')?.[0];
      const entities = source?.entities?.values ?? [];
      if (!entities.length) return null;
      const now = window.__godsEyeView?.viewer?.clock?.currentTime;
      const props = entities.map((entity) => entity.properties?.getValue?.(now) ?? {});
      const byIcao = new Map(props.filter((p) => p.icao).map((p) => [p.icao, p]));
      const french = new Set(['BL', 'FR', 'GF', 'GP', 'MF', 'MQ', 'NC', 'PF', 'PM', 'RE', 'TF', 'WF', 'YT']);
      return {
        entities: entities.length,
        closed: props.filter((p) => p.type === 'closed').length,
        unnamed: props.filter((p) => !p.name).length,
        frenchSmallFields: props.filter((p) => french.has(p.countryCode)
          && ['small_airport', 'seaplane_base', 'balloonport'].includes(p.type)).length,
        withRunway: props.filter((p) => p.runways?.longestM).length,
        cdg: byIcao.get('LFPG') || null,
        issy: byIcao.get('LFPI') || null,
        reunion: byIcao.get('FMEE') || null,
      };
    });

    record('airports render as globe entities',
      !!sample && sample.entities >= MIN_FEATURES,
      sample ? `${sample.entities} entities` : 'no data source named "Aéroports"');
    if (!sample) return;

    // (1) Identity survives the pack → GeoJSON → Cesium round trip.
    const cdg = sample.cdg;
    record('Roissy keeps its identity through the round trip',
      cdg?.iata === 'CDG' && cdg?.type === 'large_airport' && cdg?.scheduled === true,
      cdg ? `iata=${cdg.iata} type=${cdg.type} scheduled=${cdg.scheduled}` : 'LFPG not found');
    record('Roissy reports its longest OPEN runway, in metres',
      cdg?.runways?.longestM === 4215 && cdg?.runways?.surface === 'revêtue',
      cdg ? `longestM=${cdg.runways?.longestM} surface=${cdg.runways?.surface}` : 'LFPG not found');

    // (2) The French long tail is the reason this pack is not global-only.
    record('the French long tail actually shipped',
      sample.frenchSmallFields >= MIN_FRENCH_SMALL_FIELDS,
      `${sample.frenchSmallFields} small French fields (floor ${MIN_FRENCH_SMALL_FIELDS})`);
    record('a published French heliport survives clause (d)', !!sample.issy,
      sample.issy ? sample.issy.name : 'LFPI absent');
    record('the overseas territories are France too', !!sample.reunion,
      sample.reunion ? `${sample.reunion.name} (${sample.reunion.countryCode})` : 'FMEE absent');

    // (3) The two ways this pack could quietly rot.
    record('no closed aerodrome reached the globe', sample.closed === 0,
      `${sample.closed} closed`);
    record('every rendered feature is named', sample.unnamed === 0,
      `${sample.unnamed} unnamed`);
    record('most features carry a measured runway',
      sample.withRunway / sample.entities > 0.7,
      `${sample.withRunway} of ${sample.entities}`);

    // ── Importance is visible, and the floors work ───────────────────────
    const tiers = await page.evaluate(() => {
      const dm = window.__godsEyeView.dataManager;
      const module = dm.layers?.get?.('local-airports')?.module;
      const controls = module?.getRowControls?.() || null;
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const entities = viewer?.dataSources?.getByName?.('Aéroports')?.[0]?.entities?.values ?? [];
      const now = window.__godsEyeView?.viewer?.clock?.currentTime;
      // What each channel actually carries, read off the live primitives:
      // COLOUR by tier (the ladder), SIZE by published runway length, and the
      // hollow ring where no length was published at all.
      const colours = new Map();
      const sizeByClass = new Map();
      let hollow = 0;
      let hollowWithLength = 0;
      let solidWithoutLength = 0;
      const lengthClass = (metres) => (!(metres > 0) ? 'nolength'
        : metres >= 3000 ? 'len3000'
          : metres >= 1800 ? 'len1800'
            : metres >= 1000 ? 'len1000' : 'len0');
      for (const entity of entities) {
        const p = entity.properties?.getValue?.(now) ?? {};
        // Mirrors airportTier(): the service question first, then the two types
        // clause (a) admits worldwide. Never a size ranking.
        const tier = p.scheduled === true ? 'airline'
          : (p.type === 'large_airport' || p.type === 'medium_airport') ? 'airport' : 'airfield';
        const point = entity.point;
        const size = Number(point?.pixelSize?.getValue?.(now) ?? point?.pixelSize);
        const fill = point?.color?.getValue?.(now) ?? point?.color;
        const outline = point?.outlineColor?.getValue?.(now) ?? point?.outlineColor;
        // A hollow mark is a transparent FILL with a coloured outline, so the
        // MARK's colour lives in a different slot for a ring than for a disc.
        // Reading one slot would report two colours per tier and call it a bug.
        const isHollow = Number(fill?.alpha) === 0;
        const mark = isHollow ? outline : fill;
        if (!colours.has(tier)) colours.set(tier, new Set());
        colours.get(tier).add(String(mark?.toCssHexString?.() ?? mark));
        const klass = lengthClass(Number(p.runways?.longestM));
        if (!sizeByClass.has(klass)) sizeByClass.set(klass, new Set());
        sizeByClass.get(klass).add(size);
        if (isHollow) {
          hollow += 1;
          if (klass !== 'nolength') hollowWithLength += 1;
        } else if (klass === 'nolength') {
          solidWithoutLength += 1;
        }
      }
      return {
        chips: (controls?.chips || []).map((chip) => chip.id),
        legend: (controls?.legend || []).map((item) => ({ label: item.label, count: item.count })),
        colours: [...colours.entries()].map(([tier, set]) => [tier, [...set]]),
        sizes: [...sizeByClass.entries()].map(([klass, set]) => [klass, [...set]]),
        hollow,
        hollowWithLength,
        solidWithoutLength,
      };
    });

    record('the row offers the three display floors',
      tiers.chips.join(',') === 'all,airports,airlines', tiers.chips.join(','));
    // Three tier rows, four length classes, the unmeasured ring, the runway
    // mark and the IGN outline: every channel this layer spends has a key (D1).
    record('the legend names every tier AND every size class that shipped',
      tiers.legend.length === 10,
      tiers.legend.map((item) => `${item.label}=${item.count}`).join(' · '));

    // COLOUR is the tier ladder, and nothing else may move with it.
    const colourOf = new Map(tiers.colours.map(([tier, set]) => [tier, set]));
    const oneColourPerTier = [...colourOf.values()].every((set) => set.length === 1);
    const distinctColours = new Set([...colourOf.values()].map((set) => set[0]));
    record('each tier draws in exactly one colour, and no two tiers share it',
      oneColourPerTier && distinctColours.size === colourOf.size,
      tiers.colours.map(([tier, set]) => `${tier}=[${set}]`).join(' '));

    // SIZE is the published runway length: one diameter per frozen class,
    // descending with the metres, and NEVER varying inside a class.
    const sizeOf = new Map(tiers.sizes.map(([klass, set]) => [klass, set]));
    const oneSizePerClass = [...sizeOf.values()].every((set) => set.length === 1);
    const ladder = ['len3000', 'len1800', 'len1000', 'len0'].map((k) => sizeOf.get(k)?.[0]);
    record('each length class draws at exactly one dot size', oneSizePerClass,
      tiers.sizes.map(([klass, set]) => `${klass}=[${set}]`).join(' '));
    record('the dot sizes descend with the published runway length',
      ladder.every((size, index) => Number.isFinite(size)
        && (index === 0 || size < ladder[index - 1])),
      `len3000=${ladder[0]} len1800=${ladder[1]} len1000=${ladder[2]} len0=${ladder[3]}`);

    // A1 on the globe: the ring and the disc must partition the pack exactly.
    record('the hollow ring marks every unpublished length, and only those',
      tiers.hollowWithLength === 0 && tiers.solidWithoutLength === 0 && tiers.hollow > 1000,
      `${tiers.hollow} rings · ${tiers.hollowWithLength} rings on a measured field`
      + ` · ${tiers.solidWithoutLength} discs on an unmeasured one`);
    record('the ring diameter is not reachable by any measured class',
      ![...sizeOf.entries()].some(([klass, set]) => klass !== 'nolength'
        && set.includes(sizeOf.get('nolength')?.[0])),
      `ring=${sizeOf.get('nolength')?.[0]} classes=${ladder.join('/')}`);

    // A floor must actually remove markers from the globe — and give them back.
    const floored = await page.evaluate(async () => {
      const dm = window.__godsEyeView.dataManager;
      const viewer = window.__godsEyeView.styleManager?.viewer;
      // Park the camera first. Marker visibility is a function of distance now
      // (each tier declares a range), so counting markers while the boot
      // fly-to is still descending measures the tween, not the floor.
      const Cartesian3 = viewer.camera.positionWC.constructor;
      viewer.camera.cancelFlight?.();
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(2.4, 47, 2_000_000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      viewer.camera.moveEnd.raiseEvent();
      viewer.scene.render();
      await new Promise((resolve) => { setTimeout(resolve, 700); });
      viewer.scene.render();
      const entities = viewer?.dataSources?.getByName?.('Aéroports')?.[0]?.entities?.values ?? [];
      const shown = () => entities.filter((entity) => entity.show !== false).length;
      dm.setLayerParams('local-airports', { floor: 'airlines' }, { origin: 'user' });
      viewer.scene.render();
      const afterFloor = shown();
      // The chip promises "terrains desservis par une ligne régulière". Before
      // the ladder was inverted it kept 22 fields that sell no seat, Le Bourget
      // among them, because the top tier was a SIZE class. Count the liars.
      const unscheduledShown = entities.filter((entity) => entity.show !== false
        && (entity.properties?.getValue?.()?.scheduled !== true)).length;
      const module = dm.layers?.get?.('local-airports')?.module;
      const legendAtFloor = (module?.getRowControls?.()?.legend || [])
        .map((item) => `${item.label}=${item.count}`);
      const statsAtFloor = dm.getAll().find((l) => l.id === 'local-airports')?.stats?.count;
      dm.setLayerParams('local-airports', { floor: 'all' }, { origin: 'user' });
      viewer.scene.render();
      return { afterFloor, unscheduledShown, restored: shown(), legendAtFloor, statsAtFloor };
    });

    record('the LIGNES floor hides everything below the top tier',
      floored.afterFloor > 0 && floored.afterFloor < stats.count,
      `${floored.afterFloor} markers drawn (of ${stats.count})`);
    record('the LIGNES floor keeps ONLY fields that sell a scheduled seat',
      floored.unscheduledShown === 0,
      `${floored.unscheduledShown} unscheduled fields survived the chip`);
    record('the legend follows the floor instead of claiming the whole pack',
      floored.legendAtFloor.some((entry) => /=0$/.test(entry)),
      floored.legendAtFloor.join(' · '));
    record('a floor hides markers WITHOUT losing them',
      floored.statsAtFloor === stats.count,
      `stats.count=${floored.statsAtFloor} while ${floored.afterFloor} were drawn`);
    record('lifting the floor gives every marker back',
      floored.restored > floored.afterFloor,
      `${floored.afterFloor} → ${floored.restored}`);

    // ── The runway is drawn, and the stem stops claiming an altitude ──────
    // Over Roissy at 12 km: five runway records ship, and the fifth is the
    // 440 m grass helicopter lane that makes `count: 5` read as five strips.
    const field = await page.evaluate(async () => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      // No `window.Cesium` global exists — borrow the statics off a live
      // instance's constructor, the qa-cctv-v2 / qa-height-datum precedent.
      const Cartesian3 = viewer.camera.positionWC.constructor;
      const ellipsoid = viewer.scene.globe.ellipsoid;
      viewer.camera.cancelFlight?.();
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(2.55412, 49.00896, 12_000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      // A programmatic setView does not raise moveEnd, and moveEnd is what the
      // layer re-places its geometry on — the same contract the recall stem has
      // always had. Raising it is what a drag or a flyTo would do.
      viewer.camera.moveEnd.raiseEvent();
      viewer.scene.requestRender();
      viewer.scene.render();
      await new Promise((resolve) => { setTimeout(resolve, 800); });
      viewer.scene.render();

      // The runways live in a PolylineCollection primitive, not in the data
      // source: find it by the layer tag its polylines carry as their pick id.
      let lines = null;
      for (let i = 0; i < viewer.scene.primitives.length; i += 1) {
        const primitive = viewer.scene.primitives.get(i);
        if (!primitive || typeof primitive.get !== 'function' || !primitive.length) continue;
        if (primitive.get(0)?.id?.__localLayerId === 'local-airports') { lines = primitive; break; }
      }
      if (!lines) return { found: false };

      let shown = 0;
      let cdgShown = 0;
      const cdgSpans = [];
      const widths = new Set();
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines.get(i);
        if (!line.show) continue;
        shown += 1;
        const props = line.id?.properties?.getValue?.() ?? {};
        if (props.icao !== 'LFPG') continue;
        cdgShown += 1;
        const [head, tail] = line.positions;
        cdgSpans.push(Math.round(Cartesian3.distance(head, tail)));
        widths.add(line.width);
      }

      // The stem is capped in metres for this layer: read the tip's height back
      // against the base it stands on.
      const entities = viewer.dataSources.getByName('Aéroports')[0].entities.values;
      let maxStemM = 0;
      for (const entity of entities) {
        if (entity.show === false || !entity.__localBaseCartesian) continue;
        const tip = entity.position?.getValue?.();
        if (!tip) continue;
        const lift = ellipsoid.cartesianToCartographic(tip).height
          - ellipsoid.cartesianToCartographic(entity.__localBaseCartesian).height;
        if (lift > maxStemM) maxStemM = lift;
      }
      return {
        found: true, total: lines.length, shown, cdgShown,
        cdgSpans: cdgSpans.sort((a, b) => b - a),
        widths: [...widths].sort((a, b) => a - b),
        maxStemM: Math.round(maxStemM),
      };
    });

    // The batch is POOLED: it holds what is drawn, not what the pack carries —
    // 6 698 resident polylines cost their vertices in the shader on every frame
    // whether shown or not, which is a 6 ms per-frame regression measured
    // against origin/main. So the invariant is that the two numbers AGREE.
    //
    // The FLOOR used to be 20 and is now Roissy's own five, because the number
    // it was calibrated against described a bug. Before the frustum gate
    // (PLAN-PERFORMANCE.md § 3.1) the layer dealt pool lines to every field the
    // HORIZON allowed, so at 12 km over Roissy the batch carried segments for
    // airports on the other side of Europe; measured on this framing it now
    // holds 8, all of them on screen. "More than twenty" was never the claim —
    // the claim is that real lines reach the globe and that the pool holds
    // exactly what is drawn, and both are asserted here and just below.
    record('the published runway geometry reaches the globe as real lines',
      field.found && field.shown >= 5 && field.total === field.shown,
      field.found ? `${field.total} in the batch, ${field.shown} drawn` : 'no batch');
    record('Roissy draws all five of its runway records',
      field.cdgShown === 5, `${field.cdgShown} drawn — spans ${field.cdgSpans?.join('/')} m`);
    record('each runway is drawn at its own true length, helicopter lane included',
      field.cdgSpans?.[0] > 4100 && field.cdgSpans?.[0] < 4300
      && field.cdgSpans?.[4] > 300 && field.cdgSpans?.[4] < 600,
      `longest=${field.cdgSpans?.[0]} m shortest=${field.cdgSpans?.[4]} m`);
    record('close in, the stroke carries each runway\'s own published width',
      (field.widths?.length ?? 0) > 1 && Math.max(...(field.widths || [0])) > 2,
      `stroke widths ${field.widths?.join('/')} px for 45 m and 60 m strips`);
    record('the recall stem is capped in metres, well under pattern altitude',
      field.maxStemM <= 151,
      `tallest stem ${field.maxStemM} m (cap 150, traffic pattern ~300)`);

    // ── The IGN ground: the second publisher, and its own screen floor ────
    // Same camera, 12 km over Roissy. The outline is a terrain-clamped wash
    // under the pastille, and the pastille has NOT moved onto it.
    const ground = await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const entities = viewer.dataSources.getByName('Aéroports')[0].entities.values;
      const now = viewer.clock.currentTime;
      const read = (property) => (property?.getValue ? property.getValue(now) : property);
      let carried = 0;
      let drawn = 0;
      const hues = new Set();
      let extruded = 0;
      let clamped = 0;
      let cdg = null;
      for (const entity of entities) {
        if (!entity.polygon) continue;
        carried += 1;
        const props = entity.properties?.getValue?.(now) ?? {};
        const shown = read(entity.polygon.show) !== false && entity.show !== false;
        if (shown) {
          drawn += 1;
          hues.add(read(entity.polygon.material?.color)?.withAlpha(1).toCssHexString());
        }
        // A polygon with NEITHER `height` NOR `heightReference` is what Cesium
        // turns into a ground-classification primitive — the same signature
        // `GeoJsonDataSource.load({clampToGround: true})` leaves behind. Setting
        // `heightReference` here would take the outline OUT of that pass.
        if (read(entity.polygon.extrudedHeight) != null) extruded += 1;
        if (entity.polygon.height === undefined
          && entity.polygon.heightReference === undefined) clamped += 1;
        if (props.icao !== 'LFPG') continue;
        const positions = read(entity.polygon.hierarchy)?.positions || [];
        const anchor = entity.__localBaseCartesian;
        const cartographic = viewer.scene.globe.ellipsoid.cartesianToCartographic(anchor);
        cdg = {
          shown,
          vertices: positions.length,
          areaHa: props.footprint?.areaHa ?? 0,
          match: props.footprint?.match ?? '',
          alpha: read(entity.polygon.material?.color)?.alpha ?? 0,
          // The anchor is OurAirports' published point, not the outline's centre.
          anchorLon: Number((cartographic.longitude * 180 / Math.PI).toFixed(4)),
          anchorLat: Number((cartographic.latitude * 180 / Math.PI).toFixed(4)),
        };
      }
      return { carried, drawn, hues: [...hues], extruded, clamped, cdg };
    });

    record('the IGN outlines reach the globe as terrain-clamped ground',
      ground.carried > 380 && ground.clamped === ground.carried && ground.extruded === 0,
      `${ground.carried} outlines, ${ground.clamped} clamped, ${ground.extruded} extruded`);
    record('Roissy draws its surveyed emprise, joined on the ICAO code',
      ground.cdg?.shown === true && ground.cdg?.areaHa > 2000 && ground.cdg?.match === 'icao'
      && ground.cdg?.vertices > 50,
      ground.cdg
        ? `${ground.cdg.areaHa} ha, ${ground.cdg.vertices} vertices, joined on ${ground.cdg.match}`
        : 'LFPG carries no outline');
    record('the anchor is still OurAirports\' published point, not the outline\'s centre',
      Math.abs((ground.cdg?.anchorLon ?? 0) - 2.55) < 0.02
      && Math.abs((ground.cdg?.anchorLat ?? 0) - 49.0128) < 0.02,
      `pastille at ${ground.cdg?.anchorLon}, ${ground.cdg?.anchorLat}`);
    record('every drawn outline is ONE colour — a batched ground primitive bleeds otherwise',
      ground.hues.length === 1, `${ground.hues.length} hue(s): ${ground.hues.join(' ')}`);
    record('the outline is a wash, so the apron under it stays readable',
      ground.cdg?.alpha > 0 && ground.cdg?.alpha < 0.5, `alpha ${ground.cdg?.alpha}`);

    await sleep(4000);
    await shoot(page, path.join(SHOT_DIR, 'airports-roissy.png'));

    // ── The marker range, which is the A4 fix ─────────────────────────────
    // From orbit the 100 %-French `airfield` tier must be gone: drawn, it
    // reports a French aerodrome density that belongs to the SELECTION.
    const orbit = await page.evaluate(async () => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const Cartesian3 = viewer.camera.positionWC.constructor;
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(2.4, 46, 9_000_000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      viewer.camera.moveEnd.raiseEvent();
      viewer.scene.requestRender();
      viewer.scene.render();
      await new Promise((resolve) => { setTimeout(resolve, 800); });
      viewer.scene.render();
      const drawn = { airline: 0, airport: 0, airfield: 0 };
      let longAirports = 0;
      let footprints = 0;
      for (const entity of viewer.dataSources.getByName('Aéroports')[0].entities.values) {
        if (entity.polygon) {
          const show = entity.polygon.show?.getValue
            ? entity.polygon.show.getValue(viewer.clock.currentTime)
            : entity.polygon.show;
          if (show !== false && entity.show !== false) footprints += 1;
        }
        if (entity.show === false) continue;
        const p = entity.properties?.getValue?.() ?? {};
        const tier = p.scheduled === true ? 'airline'
          : (p.type === 'large_airport' || p.type === 'medium_airport') ? 'airport' : 'airfield';
        drawn[tier] += 1;
        if (tier === 'airport' && Number(p.runways?.longestM) >= 3000) longAirports += 1;
      }
      return { ...drawn, longAirports, footprints };
    });

    record('from orbit the France-only tier is not drawn at all',
      orbit.airfield === 0,
      `airline=${orbit.airline} airport=${orbit.airport} airfield=${orbit.airfield}`);
    // The unscheduled tier reaches orbit ONLY through a 3 000 m runway — the
    // per-feature range that replaced the retired `hub` tier's flat ceiling.
    // Any other survivor means the override leaked onto the whole tier.
    record('an unscheduled field reaches orbit only on 3 000 m of runway',
      orbit.airport === orbit.longAirports,
      `${orbit.airport} drawn, ${orbit.longAirports} of them ≥ 3 000 m`);
    record('the tier that is worldwide by selection still is',
      orbit.airline > 100,
      `${orbit.airline} aéroports de ligne still drawn at 9 000 km`);
    // The ground channel has a ceiling the mark does not: at 9 000 km the
    // largest outline in the pack is a fifth of a pixel across. A card and a
    // pastille still reach orbit on a 3 000 m runway; a footprint stops being
    // a shape long before it stops being on screen.
    record('from orbit no footprint is drawn — a ground mark has its own ceiling',
      orbit.footprints === 0, `${orbit.footprints} outlines still drawn at 9 000 km`);

    // ── Shot ──────────────────────────────────────────────────────────────
    // newQaPage() suppressed the launcher before boot; this asserts the card is
    // actually out of the shot rather than trusting that it worked.
    record('first-run launcher stays suppressed for the shot',
      await firstRunLauncherSuppressed(page));
    await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      if (!viewer) return;
      // There is NO `window.Cesium` global. This block used to read one and
      // return early when it came back undefined, so the shot was taken from
      // wherever the boot fly-to happened to leave the camera and the framing
      // below was never applied. Statics are borrowed off a live instance.
      const Cartesian3 = viewer.camera.positionWC.constructor;
      // Cancel the boot fly-to first, or the tween drags the camera back to
      // Paris under the manual render pump.
      viewer.camera.cancelFlight?.();
      // Île-de-France at départemental scale: eleven fields in one frame, from
      // Roissy and Orly down to the grass strips the long tail is made of.
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(2.4, 48.7, 260_000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      viewer.camera.moveEnd.raiseEvent();
      viewer.scene.requestRender();
    });
    await sleep(6000);

    // The FAR regime, which is what 260 km is: Roissy's mark is held at its
    // class floor (18 px, so ~6 km of world length at this range — more symbol
    // than measurement, and declared as such), while Toussus' 1 100 m strip has
    // passed RUNWAY_MAX_STRETCH and is not drawn at all. Its pastille speaks
    // for it. The TRUE-length regime is proven by the 12 km block above.
    const farRegime = await page.evaluate(async () => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const Cartesian3 = viewer.camera.positionWC.constructor;
      // Self-contained, like the two blocks above: the geometry pass runs on
      // moveEnd inside a rendered frame, and this harness cannot assume the
      // page is still producing frames on its own — a stalled compositor would
      // otherwise be read as "the layer drew nothing".
      viewer.camera.cancelFlight?.();
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(2.4, 48.7, 260_000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      viewer.camera.moveEnd.raiseEvent();
      viewer.scene.render();
      await new Promise((resolve) => { setTimeout(resolve, 800); });
      viewer.scene.render();
      let lines = null;
      for (let i = 0; i < viewer.scene.primitives.length; i += 1) {
        const primitive = viewer.scene.primitives.get(i);
        if (!primitive || typeof primitive.get !== 'function' || !primitive.length) continue;
        if (primitive.get(0)?.id?.__localLayerId === 'local-airports') { lines = primitive; break; }
      }
      if (!lines) return { drawn: 0 };
      let drawn = 0;
      const spans = [];
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines.get(i);
        if (!line.show) continue;
        drawn += 1;
        const props = line.id?.properties?.getValue?.() ?? {};
        if (props.icao === 'LFPG' || props.icao === 'LFPN') {
          spans.push([props.icao, Math.round(Cartesian3.distance(line.positions[0], line.positions[1]))]);
        }
      }
      return { drawn, spans };
    });
    const roissyFar = farRegime.spans?.find((entry) => entry[0] === 'LFPG')?.[1] ?? 0;
    const toussusFar = farRegime.spans?.find((entry) => entry[0] === 'LFPN')?.[1] ?? 0;
    record('far out the mark holds its class floor instead of shrinking away',
      farRegime.drawn > 0 && roissyFar > 4300,
      `${farRegime.drawn} drawn · Roissy held at ${roissyFar} m for a 4 217 m runway`);
    record('and a strip the floor would stretch past 2x is dropped, not inflated',
      toussusFar === 0,
      toussusFar ? `Toussus drawn at ${toussusFar} m for 1 100 m` : 'Toussus left to its pastille');

    await shoot(page, path.join(SHOT_DIR, 'airports-idf.png'));

    const relevantErrors = consoleErrors.filter((text) => /airport|aéroport|ourairports/i.test(text));
    record('no console errors mentioning the new layer', relevantErrors.length === 0,
      relevantErrors[0] || 'clean');
  } finally {
    await browser.close();
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const entry of failed) console.log(`  - ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
