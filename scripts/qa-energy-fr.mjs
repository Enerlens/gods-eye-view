#!/usr/bin/env node
/**
 * Deterministic browser proof for the French electricity-mix layer
 * (`france-energy`).
 *
 * The feed is live and therefore untestable as a fixed truth, so this harness
 * intercepts `/api/energy-fr` with the SAME captured ODRÉ payload the unit
 * tests use — run through the real `projectEco2mix` projection, so the fixture
 * cannot drift from what the proxy actually serves — and proves the four
 * behaviours that only a real Cesium scene can prove:
 *
 *   i.   ONE mark reaches the globe per RÉGION — twelve prisms and a striped
 *        Corsica, not ninety-six départements — each with its true perimeter
 *        traced on the ground under it
 *   ii.  the sign convention survives all the way to the globe — Île-de-France
 *        (a net importer) is amber and Auvergne-Rhône-Alpes (a net exporter)
 *        is teal, read back off the rendered material, not off the model
 *   iii. the five border flows are drawn as RAISED VOLUMES pointing the way
 *        the power travels — a translucent tube whose radius is the megawatts,
 *        a near-opaque cone on the receiving end — leaving the FRONTIER rather
 *        than the middle of the country, with the direction repeated in words
 *   iv.  the five neighbouring markets are outlined, and never filled
 *   v.   a border that falls to zero hides its arc instead of drawing a
 *        hairline — and KEEPS its market outline, in slate
 *
 * Screenshots are written under the gitignored `qa-shots/energy-fr/`.
 *
 * Run: node scripts/qa-energy-fr.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import { projectEco2mix } from '../src/data/eco2mixFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'energy-fr');
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

/** A view that holds all of metropolitan France and its five neighbours. */
const FRANCE = { lon: 2.6, lat: 46.6, height: 2_600_000 };

/** The palette, duplicated here on purpose: a QA harness asserts, it doesn't import styling. */
const AMBER = '#ff9b3d';
const TEAL = '#2ee6a8';

const readFixture = (name) => JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'fixtures', name), 'utf8',
));

/**
 * The proxy's own output, built from the captured ODRÉ bodies. Using the real
 * projection rather than a hand-written blob is what keeps this harness honest
 * when the projection changes.
 */
function energyPayload({ zeroBorder = null } = {}) {
  const projected = projectEco2mix({
    national: readFixture('eco2mix-national-tr-sample.json'),
    regional: readFixture('eco2mix-regional-tr-sample.json'),
  }, 'ODRÉ (qa fixture)');
  const national = zeroBorder
    ? {
      ...projected.national,
      exchanges: projected.national.exchanges.map((entry) => (
        entry.key === zeroBorder ? { ...entry, mw: 0 } : entry
      )),
    }
    : projected.national;
  return {
    fetchedAt: Date.now(),
    stale: false,
    ttlMs: 240_000,
    source: projected.source,
    national,
    regions: projected.regions,
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
 * Render `frames` frames explicitly. Cesium's clamped-ground polygons only
 * resolve their material once the scene has actually drawn, and a
 * software-rendered headless context sometimes has no animation-frame loop at
 * all — so the harness pumps the scene itself rather than trusting the browser.
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
 * Deliberately reads the ENTITIES, not the layer's own model: the point of a
 * browser proof is that the paint reached the globe, so the colours here come
 * off `polygon.material` and the arcs off `polyline.positions`.
 */
function sceneProbe(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get('france-energy').module;
    const sources = gev.viewer.dataSources;
    let collection = null;
    for (let i = 0; i < sources.length; i++) {
      if (String(sources.get(i).name || '').includes('éCO2mix')) collection = sources.get(i);
    }
    const hex = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : null);

    const polygons = [];
    const arcs = [];
    const heads = [];
    const lines = [];
    for (const entity of collection ? collection.entities.values : []) {
      const id = String(entity.id);
      const code = String(entity.properties?.code?.getValue?.() ?? '');
      if (entity.polygon) {
        const material = entity.polygon.material?.color?.getValue?.();
        polygons.push({
          id,
          code,
          shown: entity.show !== false,
          color: hex(material),
          alpha: material ? Math.round(material.alpha * 1000) / 1000 : null,
          // The magnitude moved off alpha and onto the Z axis, so the probe
          // has to read the Z axis. `null` for a flat footprint, which is what
          // an unpainted région (Corse) now draws.
          topM: entity.polygon.extrudedHeight?.getValue?.() ?? null,
          material: material ? 'color' : 'motif',
        });
      } else if (entity.polylineVolume) {
        const positions = entity.polylineVolume.positions?.getValue?.() || [];
        const shape = entity.polylineVolume.shape?.getValue?.() || [];
        const material = entity.polylineVolume.material?.color?.getValue?.();
        arcs.push({
          id,
          code,
          shown: entity.show !== false,
          vertices: positions.length,
          // World radius, in metres. The old mark carried a screen width, and
          // that is exactly what this harness must refuse to accept back.
          radiusM: shape.length ? Math.round(Math.hypot(shape[0].x, shape[0].y)) : null,
          sides: shape.length,
          color: hex(material),
          alpha: material ? Math.round(material.alpha * 100) / 100 : null,
          outlineAlpha: entity.polylineVolume.outlineColor?.getValue?.()
            ? Math.round(entity.polylineVolume.outlineColor.getValue().alpha * 100) / 100
            : null,
          ends: positions.length
            ? [positions[0], positions[positions.length - 1]].map((p) => {
              const c = gev.viewer.scene.globe.ellipsoid.cartesianToCartographic(p);
              return [c.longitude * 180 / Math.PI, c.latitude * 180 / Math.PI, c.height];
            })
            : [],
        });
      } else if (entity.cylinder) {
        const material = entity.cylinder.material?.color?.getValue?.();
        const position = entity.position?.getValue?.(gev.viewer.clock.currentTime);
        const carto = position
          ? gev.viewer.scene.globe.ellipsoid.cartesianToCartographic(position)
          : null;
        heads.push({
          id,
          code,
          shown: entity.show !== false,
          topRadius: entity.cylinder.topRadius?.getValue?.() ?? null,
          bottomRadius: Math.round(entity.cylinder.bottomRadius?.getValue?.() ?? 0),
          length: Math.round(entity.cylinder.length?.getValue?.() ?? 0),
          alpha: material ? Math.round(material.alpha * 100) / 100 : null,
          color: hex(material),
          oriented: Boolean(entity.orientation),
          at: carto
            ? [carto.longitude * 180 / Math.PI, carto.latitude * 180 / Math.PI, carto.height]
            : null,
        });
      } else if (entity.polyline) {
        const positions = entity.polyline.positions?.getValue?.() || [];
        const row = {
          id,
          code,
          shown: entity.show !== false,
          vertices: positions.length,
          width: entity.polyline.width?.getValue?.() ?? null,
          color: hex(entity.polyline.material?.color?.getValue?.()),
          clamped: entity.polyline.clampToGround?.getValue?.() === true,
          // Cartographic degrees of the two ends, so the harness can prove an
          // arc leaves the frontier instead of the centre of the country.
          ends: positions.length
            ? [positions[0], positions[positions.length - 1]].map((p) => {
              const c = gev.viewer.scene.globe.ellipsoid.cartesianToCartographic(p);
              return [c.longitude * 180 / Math.PI, c.latitude * 180 / Math.PI];
            })
            : [],
        };
        lines.push(row);
      }
    }
    return {
      stats: module.getStats(),
      analyst: module.getAnalystRecords(20),
      controls: module.getRowControls(),
      polygons,
      arcs,
      heads,
      lines,
      sourceFound: Boolean(collection),
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

    let payload = energyPayload();
    let apiRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN && url.pathname === '/api/energy-fr') {
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

    // ── i. the régions paint, Corsica does not ─────────────────────────────
    console.log('[qa] i. régions paint by their own balance');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('france-energy', true));
    let probe = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      probe = await sceneProbe(page);
      if (apiRequests >= 1 && probe.sourceFound && probe.stats.count === 12) break;
    }
    check('the layer fetched its snapshot', apiRequests >= 1, `${apiRequests} request(s)`);
    check('the data source reached the viewer', probe.sourceFound);
    check('all 12 covered régions resolved', probe.stats.count === 12, `count=${probe.stats.count}`);

    // The dissolve, proved on the globe: THIRTEEN polygon marks — twelve
    // measured régions and Corse — where there used to be ninety-six. The
    // number the eye counts has to be the number that was measured.
    const shownCodes = new Set(probe.polygons.filter((p) => p.shown).map((p) => p.code));
    check('one polygon mark per région, and not one per département',
      probe.polygons.length === 13 && shownCodes.size === 13,
      `${probe.polygons.length} polygons, ${shownCodes.size} codes: ${[...shownCodes].sort().join(',')}`);
    // Codes that are a DÉPARTEMENT and never a région — '75' and '76' are both,
    // Paris and Nouvelle-Aquitaine, Seine-Maritime and Occitanie.
    check('no département code survives into the scene',
      !['95', '69', '2A', '2B', '01', '92'].some((code) => shownCodes.has(code)),
      [...shownCodes].sort().join(','));

    // Corsica is KNOWN and deliberately unmeasured — éCO2mix régional publishes
    // no Corsican row. It used to be hidden outright, which made "we have no
    // figure" indistinguishable from "this place does not exist" (A1). It is
    // now DRAWN, flat and hatched: present, and visibly carrying no value.
    const corsica = probe.polygons.find((polygon) => polygon.code === '94');
    check('Corsica is drawn, flat, and carries no prism',
      Boolean(corsica) && corsica.shown && !corsica.topM,
      corsica ? `shown=${corsica.shown} top=${corsica.topM}` : 'absent');
    const raised = probe.polygons.filter((p) => p.topM > 0).map((p) => p.code);
    check('and 12 of the 13 carry a prism — every one but Corse',
      raised.length === 12 && !raised.includes('94'), `${raised.length} prismes`);

    // The reduced footprint is only honest because the true one is drawn. One
    // clamped perimeter per dissolved ring, islands included.
    const perimeters = probe.lines.filter((line) => line.id.startsWith('energy-fr:perimeter:'));
    const perimeterCodes = new Set(perimeters.map((line) => line.code));
    // More lines than régions: the perimeter keeps the islands the prism drops,
    // and an island ring is short by design.
    check('every région traces its TRUE perimeter on the ground',
      perimeterCodes.size === 13
      && perimeters.every((line) => line.shown && line.clamped && line.vertices >= 4),
      `${perimeters.length} lines over ${perimeterCodes.size} régions`);
    check('a mainland perimeter is a real outline, not a stub',
      perimeters.filter((line) => line.id.endsWith(':0')).every((line) => line.vertices > 100),
      perimeters.filter((line) => line.id.endsWith(':0')).map((line) => line.vertices).join(','));
    check('Corse has a perimeter even though it has no figure',
      perimeters.some((line) => line.id.startsWith('energy-fr:perimeter:94:') && line.shown));
    // The unmeasured régions are NAMED. An anonymous grey shape is what made a
    // reader hunt for the missing région along the coastline.
    check('an unmeasured région is counted from the KNOWN 13, and named',
      probe.stats.unpublishedRegions === 1
      && probe.controls.legend.some((entry) => /non publié/.test(entry.label)
        && entry.count === 1 && /Corse/.test(entry.blurb || '')),
      `unpublished=${probe.stats.unpublishedRegions}`);
    check('and the counts on the legend add up to 13',
      (() => {
        const counted = probe.controls.legend
          .filter((entry) => entry.color && Number.isFinite(entry.count)
            && !/^\d/.test(entry.label))
          .reduce((sum, entry) => sum + entry.count, 0);
        return counted === 13;
      })(),
      probe.controls.legend
        .filter((entry) => Number.isFinite(entry.count))
        .map((entry) => `${entry.label}=${entry.count}`).join(' · '));
    await shoot(page, '01-regions.png');

    // ── ii. the sign convention survives to the rendered material ──────────
    console.log('[qa] ii. importer amber, exporter teal');
    const colorOf = (code) => probe.polygons.find((polygon) => polygon.code === code);
    // Île-de-France: +6 478 MW upstream, i.e. consumption above generation.
    const idf = colorOf('11');
    check('Île-de-France (net importer) renders amber', idf?.color === AMBER,
      `11 → ${idf?.color}`);
    // Auvergne-Rhône-Alpes: −7 781 MW upstream, the country's biggest surplus.
    const aura = colorOf('84');
    check('Auvergne-Rhône-Alpes (net exporter) renders teal', aura?.color === TEAL,
      `84 → ${aura?.color}`);
    check('the perimeter under a région repeats its colour, quieter',
      probe.lines.some((line) => line.id === 'energy-fr:perimeter:11:0' && line.color === AMBER)
      && probe.lines.some((line) => line.id === 'energy-fr:perimeter:84:0' && line.color === TEAL));
    // Alpha ramps on |balance| / load, so the country's largest imbalance must
    // read stronger than a milder one regardless of which side each is on.
    // A3, and this is the reversal worth reading. The magnitude used to ramp
    // the FILL ALPHA, which meant the alpha channel carried the imbalance while
    // the hue carried its sign — two readings on one surface, and the stronger
    // of the two invisible over bright imagery. The magnitude is now the prism
    // HEIGHT and the colour is the sign ALONE, so alpha must be CONSTANT: a
    // ramp left on it would be the old defect surviving under the new one.
    check('alpha carries nothing any more — the height carries the magnitude',
      probe.polygons.filter((p) => p.topM > 0).every((p) => p.alpha === aura.alpha),
      `AURA ${aura.alpha} vs Bretagne ${colorOf('53').alpha}`);
    check('and the strongest imbalance is the tallest prism',
      aura.topM > colorOf('53').topM,
      `AURA ${Math.round(aura.topM / 1000)} km vs Bretagne ${Math.round(colorOf('53').topM / 1000)} km`);
    // The key is now the prism key: a height scale with numbered marks (D1 — a
    // height with no ruler says only "taller than that one") and the two sign
    // classes. Entries that name a CHANNEL carry no count, by contract.
    const named = probe.controls.legend.filter((entry) => Number.isFinite(entry.count));
    check('the row legend rules the height and names both sides in words',
      probe.controls.legend.length > 2
      && probe.controls.legend.every((entry) => typeof entry.label === 'string' && entry.label.length > 0)
      && named.length >= 2,
      probe.controls.legend.map((entry) => entry.label).join(' · '));

    // ── iii. the border arcs ───────────────────────────────────────────────
    console.log('[qa] iii. five raised border arcs, leaving the frontier');
    check('five arcs are drawn', probe.arcs.filter((arc) => arc.shown).length === 5,
      `${probe.arcs.filter((arc) => arc.shown).length} arcs`);
    check('each arc is a sampled curve, not a two-point line',
      probe.arcs.every((arc) => arc.vertices > 8),
      probe.arcs.map((arc) => arc.vertices).join(','));
    // A VOLUME in metres, not a stroke in pixels. The old mark was 3.85 px for
    // 366 MW and this is the check that refuses to let it come back.
    check('the flow is a world-sized volume, not a screen-width line',
      probe.arcs.every((arc) => arc.radiusM >= 9000 && arc.radiusM <= 22000 && arc.sides >= 6),
      probe.arcs.map((arc) => `${arc.code}:${arc.radiusM}m/${arc.sides}`).join(' '));
    check('thickness tracks the flow', new Set(probe.arcs.map((arc) => arc.radiusM)).size > 1,
      probe.arcs.map((arc) => arc.radiusM).join(','));
    // The prism grammar the reader asked the arrow to borrow.
    check('translucent body, near-opaque edge — the prism grammar',
      probe.arcs.every((arc) => arc.alpha < 0.5 && arc.outlineAlpha > arc.alpha),
      probe.arcs.map((arc) => `${arc.alpha}/${arc.outlineAlpha}`).join(' '));
    check('and it is lifted clear of the ground at BOTH ends',
      probe.arcs.every((arc) => arc.ends.every(([, , h]) => h > arc.radiusM)),
      probe.arcs.map((arc) => arc.ends.map(([, , h]) => Math.round(h)).join('/')).join(' '));

    console.log('[qa] iii-bis. the sense is a cone, and it is the brightest end');
    check('every flow ends in a cone', probe.heads.length === 5
      && probe.heads.every((head) => head.shown && head.topRadius === 0),
      `${probe.heads.length} heads`);
    check('the cone is FAT — a head barely wider than its shaft is a taper',
      probe.heads.every((head) => {
        const shaft = probe.arcs.find((arc) => arc.code === head.code);
        return shaft && head.bottomRadius > shaft.radiusM * 1.5;
      }),
      probe.heads.map((head) => `${head.code}:${head.bottomRadius}m`).join(' '));
    check('and it is the brightest end of the mark — that is where the sense is',
      probe.heads.every((head) => {
        const shaft = probe.arcs.find((arc) => arc.code === head.code);
        return head.alpha > 0.8 && shaft && head.alpha > shaft.alpha;
      }),
      probe.heads.map((head) => `${head.code}:${head.alpha}`).join(' '));
    check('each cone is aimed, not left on the local vertical',
      probe.heads.every((head) => head.oriented && head.at));
    // The fix the reader asked for, proved at the pixel's own coordinates: no
    // arc may touch down anywhere near 2.60 E / 46.60 N, which is where all
    // five used to start.
    const BERRY = [2.60, 46.60];
    const nearBerry = probe.arcs.filter((arc) => [
      ...arc.ends,
      probe.heads.find((head) => head.code === arc.code)?.at,
    ].filter(Boolean).some(([lon, lat]) => (
      Math.hypot(lon - BERRY[0], lat - BERRY[1]) < 1
    )));
    check('no arc leaves the middle of the country any more',
      probe.arcs.length === 5 && nearBerry.length === 0,
      nearBerry.map((arc) => `${arc.id} ${arc.ends.map((e) => e.map((v) => v.toFixed(2)).join('/'))}`).join(' '));
    // And each one touches down on the French frontier facing its own market.
    const frenchEnd = (key) => {
      const arc = probe.arcs.find((entry) => entry.id.endsWith(`:${key}`));
      const head = probe.heads.find((entry) => entry.id.endsWith(`:${key}`));
      const inFrance = ([lon, lat]) => lon > -5.2 && lon < 8.3 && lat > 42.2 && lat < 51.2;
      // Either end can be the French one: the cone lands on France for an
      // import and abroad for an export.
      return [...(arc?.ends || []), head?.at].filter(Boolean).find(inFrance);
    };
    check('the British arc leaves the Channel coast, not the Mediterranean',
      (frenchEnd('angleterre')?.[1] ?? 0) > 50,
      String(frenchEnd('angleterre')));
    check('the Spanish arc leaves the Pyrénées',
      (frenchEnd('espagne')?.[1] ?? 90) < 44,
      String(frenchEnd('espagne')));
    check('the Italian arc leaves the Alps, not Corsica',
      (frenchEnd('italie')?.[0] ?? 0) > 6.5 && (frenchEnd('italie')?.[1] ?? 0) > 43.5,
      String(frenchEnd('italie')));
    check('the physical and commercial national balances are reported separately',
      probe.stats.netExportMw !== probe.stats.netCommercialExportMw,
      `${probe.stats.netExportMw} vs ${probe.stats.netCommercialExportMw}`);
    check('the analyst sees the balance restated as an export figure',
      probe.analyst.find((record) => record.id === '84')?.netExportMw === 7781);
    await shoot(page, '02-borders.png');

    // ── iv. the market areas ───────────────────────────────────────────────
    console.log('[qa] iv. the neighbours are delimited, never filled');
    const markets = probe.lines.filter((line) => line.id.startsWith('energy-fr:market:'));
    const marketKeys = new Set(markets.map((line) => line.code));
    check('all five markets are outlined',
      marketKeys.size === 5 && markets.every((line) => line.shown && line.clamped),
      [...marketKeys].sort().join(','));
    check('an outline is a LINE — nothing foreign is ever filled',
      markets.every((line) => line.vertices > 8)
      && !probe.polygons.some((polygon) => marketKeys.has(polygon.code)));
    // The outline carries the arc's class: France imports from Spain on this
    // snapshot (+500 MW) and exports to Italy (−2 537 MW).
    const marketColor = (key) => markets.find((line) => line.code === key)?.color;
    check('Spain, which France imports from, is outlined amber',
      marketColor('espagne') === AMBER, `espagne → ${marketColor('espagne')}`);
    check('Italy, which France exports to, is outlined teal',
      marketColor('italie') === TEAL, `italie → ${marketColor('italie')}`);
    await shoot(page, '04-markets.png');

    // ── v. a border that falls to zero ─────────────────────────────────────
    console.log('[qa] v. a zero border hides its arc and keeps its outline');
    const arcsBefore = probe.arcs.length;
    payload = energyPayload({ zeroBorder: 'suisse' });
    await page.evaluate(() => window.__godsEyeView.dataManager.refreshLayer?.('france-energy'));
    let after = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await pump(page, 3, 60);
      await sleep(300);
      after = await sceneProbe(page);
      if (after.stats.borders === 4) break;
    }
    check('the zeroed border is no longer drawn',
      after.arcs.filter((arc) => arc.shown).length === 4,
      `${after.arcs.filter((arc) => arc.shown).length} shown`);
    check('and it is hidden, not destroyed', after.arcs.length === arcsBefore,
      `${after.arcs.length} entities vs ${arcsBefore}`);
    check('the Swiss arc specifically is the one hidden',
      after.arcs.find((arc) => arc.id.endsWith(':suisse'))?.shown === false);
    check('the other four kept their geometry',
      after.arcs.filter((arc) => arc.shown).every((arc) => arc.vertices > 8));
    check('and the Swiss cone went with its shaft — no orphan arrowhead',
      after.heads.find((head) => head.code === 'suisse')?.shown === false,
      after.heads.map((head) => `${head.code}:${head.shown}`).join(' '));
    // The outline is NOT an arc: an arc is a direction and a direction of
    // nothing is nothing, while "who is on the other side" stays true at zero.
    const swissOutline = after.lines.filter((line) => line.code === 'suisse');
    check('but Switzerland keeps its outline, in slate',
      swissOutline.length > 0
      && swissOutline.every((line) => line.shown && line.color !== TEAL && line.color !== AMBER),
      swissOutline.map((line) => `${line.shown}:${line.color}`).join(' '));
    await shoot(page, '03-zero-border.png');

    const relevantErrors = consoleErrors.filter((text) => /energy|eco2mix/i.test(text));
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
    console.log('[qa] energy-fr: all checks passed');
  }
  console.log(`[qa] shots → ${path.relative(REPO_ROOT, SHOTS_DIR)}/`);
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
