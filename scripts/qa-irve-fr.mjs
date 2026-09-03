#!/usr/bin/env node
/**
 * Deterministic browser proof for the French charge-point layer.
 *
 * The register is rebuilt daily and cannot be a fixed truth, so this
 * intercepts all three IRVE endpoints with fixtures and proves the seven
 * things the live feed itself cannot:
 *
 *   i.   at national altitude the layer answers with the 96 DÉPARTEMENTS and
 *        asks for no viewport at all — the country-scale question is answered
 *        rather than deferred, and no dot is drawn
 *   ii.  a city view swaps regimes and draws one dot per SITE, not one per
 *        charge point — the car park publishing 224 of them is a dot, not a
 *        cloud — and the choropleth goes away rather than fighting it
 *   iii. the ramp is read from the site's HIGHEST band, and a site whose only
 *        published power is out of envelope takes the neutral tint instead of
 *        a rung
 *   iv.  the legend counts CHARGE POINTS by band, low to high, omitting bands
 *        with nothing in view
 *   v.   the layer says installed capacity — it names both the published and
 *        the de-duplicated count, and never implies availability
 *   vi.  the two scales never share a legend: at altitude it is the quantile
 *        ramp, over a city it is the power bands, and never both
 *   vii. between the two, the MAILLAGE: real positions, spatially thinned so
 *        the sparse country survives, fetched once and reported as a sample
 *
 * Run: node scripts/qa-irve-fr.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'irve-fr');
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

/** La Défense: the real site that publishes 127 station ids at one point. */
const CITY = { lon: 2.24202, lat: 48.89155 };

/**
 * Six sites, one per band, shaped after real rows: the Q-Park car park, a
 * Tesla Supercharger, an ENGIE Vianeo site published twice, and a Ze-Watt site
 * whose kilowatt column holds watts.
 */
const SITES = [
  {
    id: '48.89155,2.24202', lat: 48.89155, lon: 2.24202,
    name: 'QPARK - LA DÉFENSE - CENTRE GRANDE ARCHE', commune: 'Courbevoie',
    operators: ['IZIVIA'], networks: ['QPARK'], duplicateOperators: [],
    pdcPublished: 224, pdcDistinct: 224,
    bands: { lente: 219, normale: 5, accelere: 0, rapide: 0, hpc: 0, inconnue: 0 },
    topBand: 'normale', peakKW: 22, implantation: 'Parking public',
    access: 'Accès libre', pmr: 'Accessibilité inconnue', connectors: ['type2'],
    free: false, coordVerified: true, updatedFrom: '2025-11-15', updatedTo: '2026-07-30',
  },
  {
    id: '48.89600,2.24600', lat: 48.896, lon: 2.246,
    name: 'Tesla Supercharger La Défense', commune: 'Courbevoie',
    operators: ['Tesla'], networks: ['Tesla'], duplicateOperators: [],
    pdcPublished: 16, pdcDistinct: 16,
    bands: { lente: 0, normale: 0, accelere: 0, rapide: 0, hpc: 16, inconnue: 0 },
    topBand: 'hpc', peakKW: 361, implantation: 'Station dédiée à la recharge rapide',
    access: 'Accès libre', pmr: 'Accessible mais non réservé PMR', connectors: ['ccs'],
    free: false, coordVerified: true, updatedFrom: '2026-07-20', updatedTo: '2026-07-20',
  },
  {
    id: '48.88900,2.23800', lat: 48.889, lon: 2.238,
    name: 'ENGIE Vianeo - Courbevoie', commune: 'Courbevoie',
    operators: ['ENGIE Vianeo'], networks: ['Vianeo'],
    // The double publication this harness exists to keep visible.
    duplicateOperators: ['Greenflux'],
    pdcPublished: 20, pdcDistinct: 10,
    bands: { lente: 0, normale: 1, accelere: 1, rapide: 8, hpc: 0, inconnue: 0 },
    topBand: 'rapide', peakKW: 150, implantation: 'Parking privé à usage public',
    access: 'Accès libre', pmr: 'Accessibilité inconnue', connectors: ['type2', 'ccs', 'chademo'],
    free: false, coordVerified: true, updatedFrom: '2025-07-28', updatedTo: '2026-04-08',
  },
  {
    id: '48.89400,2.25100', lat: 48.894, lon: 2.251,
    name: 'Belib’ - Courbevoie', commune: '',
    operators: ['TotalEnergies Charging Services'], networks: ["Belib'"],
    duplicateOperators: [], pdcPublished: 7, pdcDistinct: 7,
    bands: { lente: 7, normale: 0, accelere: 0, rapide: 0, hpc: 0, inconnue: 0 },
    topBand: 'lente', peakKW: 7, implantation: 'Voirie',
    access: 'Accès libre', pmr: 'Non accessible', connectors: ['type2', 'ef'],
    // Unstated, not free — the tri-state the card has to keep separate.
    free: null, coordVerified: false, updatedFrom: '2023-07-06', updatedTo: '2025-06-30',
  },
  {
    id: '48.88700,2.24900', lat: 48.887, lon: 2.249,
    name: 'Electra Courbevoie', commune: 'Courbevoie',
    operators: ['Electra'], networks: ['Electra'], duplicateOperators: [],
    pdcPublished: 4, pdcDistinct: 4,
    bands: { lente: 0, normale: 0, accelere: 4, rapide: 0, hpc: 0, inconnue: 0 },
    topBand: 'accelere', peakKW: 50, implantation: 'Parking privé à usage public',
    access: 'Accès réservé', pmr: 'Accessibilité inconnue', connectors: ['ccs'],
    free: false, coordVerified: true, updatedFrom: '2026-07-30', updatedTo: '2026-07-30',
  },
  {
    id: '48.89000,2.23500', lat: 48.89, lon: 2.235,
    name: 'INTERMARCHE - Ze-Watt', commune: '',
    operators: ['Ze-Watt'], networks: ['Ze-Watt'], duplicateOperators: [],
    pdcPublished: 4, pdcDistinct: 4,
    // 7 360 in a kilowatt column. It must NOT be painted as the hottest site
    // on screen, and it must NOT be quietly divided by a thousand either.
    bands: { lente: 0, normale: 0, accelere: 0, rapide: 0, hpc: 0, inconnue: 4 },
    topBand: 'inconnue', peakKW: null, implantation: 'Parking privé à usage public',
    access: 'Accès réservé', pmr: 'Accessibilité inconnue', connectors: ['type2', 'ef'],
    free: null, coordVerified: false, updatedFrom: '2026-07-31', updatedTo: '2026-07-31',
  },
];

/**
 * A national rollup, shaped as `/api/irve-fr/departements` returns one. Five
 * real départements across the whole ramp plus one that is genuinely empty,
 * which must stay unpainted rather than take the bottom bin.
 */
const NATIONAL = {
  departements: [
    { code: '75', name: 'Paris', pdc: 10539, sites: 664, areaKm2: 104, per1000Km2: 101336.5, bin: 5, bands: { lente: 8000, normale: 2000, accelere: 400, rapide: 100, hpc: 39, inconnue: 0 } },
    { code: '59', name: 'Nord', pdc: 8026, sites: 1461, areaKm2: 5739, per1000Km2: 1398.5, bin: 5, bands: { lente: 4000, normale: 3000, accelere: 839, rapide: 150, hpc: 37, inconnue: 0 } },
    { code: '69', name: 'Rhône', pdc: 5442, sites: 751, areaKm2: 3253, per1000Km2: 1672.9, bin: 4, bands: { lente: 3000, normale: 2000, accelere: 400, rapide: 40, hpc: 2, inconnue: 0 } },
    { code: '31', name: 'Haute-Garonne', pdc: 1900, sites: 400, areaKm2: 6331, per1000Km2: 300.1, bin: 2, bands: { lente: 900, normale: 800, accelere: 150, rapide: 40, hpc: 10, inconnue: 0 } },
    { code: '48', name: 'Lozère', pdc: 227, sites: 69, areaKm2: 5167, per1000Km2: 43.9, bin: 0, bands: { lente: 100, normale: 100, accelere: 20, rapide: 5, hpc: 2, inconnue: 0 } },
    { code: '2A', name: 'Corse-du-Sud', pdc: 0, sites: 0, areaKm2: 3995, per1000Km2: 0, bin: -1, bands: { lente: 0, normale: 0, accelere: 0, rapide: 0, hpc: 0, inconnue: 0 } },
  ],
  thresholds: [667, 1319, 1908, 2432, 4060],
  binCount: 6,
  painted: 5,
  pdcAssigned: 26134,
  pdcSwept: 231079,
  pdcTotal: 231079,
  pdcWithheld: 5359,
  pdcInvalid: 24,
  pdcUnassigned: 816,
  pdcSnapped: 778,
  truncated: false,
  stalledStripes: 0,
  dataset: 'bornes-irve',
  source: 'transport.data.gouv.fr / ODRÉ (odre.opendatasoft.com)',
  stale: false,
};

/**
 * The national point set, shaped as `/api/irve-fr/mesh` returns it: 4-tuples
 * of `[lat, lon, pdc, bandIndex]` against `IRVE_BAND_KEYS`, never objects.
 *
 * Deliberately built as a DENSE Paris cluster and a SPARSE rural spread, so
 * the stratified pick has something to prove: a rank-ordered thinning would
 * keep the capital and drop the Massif Central, and the assertion below is
 * that both survive. `lente`(0) dominates the rural cells and `hpc`(4) the
 * motorway sites, which is the bias the modal-band rule exists to correct.
 */
const MESH_SITES = (() => {
  const sites = [];
  // A dense conurbation: 1 800 sites inside half a degree of Paris. The count
  // has to clear the regime's own render budget (1 100) or nothing is thinned
  // and the assertion below would pass on a map that never had to choose.
  for (let i = 0; i < 1800; i++) {
    const lat = 48.75 + ((i * 37) % 500) / 1000;
    const lon = 2.05 + ((i * 53) % 500) / 1000;
    sites.push([Number(lat.toFixed(5)), Number(lon.toFixed(5)), 2 + (i % 40), i % 5]);
  }
  // A sparse country: one site per cell across the rest of France, including
  // the Massif Central, whose emptiness must read as sparse and not as absent.
  for (let i = 0; i < 500; i++) {
    const lat = 43.2 + (i % 25) * 0.26;
    const lon = 0.4 + Math.floor(i / 25) * 0.31;
    sites.push([Number(lat.toFixed(5)), Number(lon.toFixed(5)), 1 + (i % 6), i % 2 ? 0 : 1]);
  }
  return sites;
})();

const MESH = {
  sites: MESH_SITES,
  siteCount: MESH_SITES.length,
  pdc: MESH_SITES.reduce((sum, site) => sum + site[2], 0),
  bands: ['lente', 'normale', 'accelere', 'rapide', 'hpc', 'inconnue'],
  dataset: 'bornes-irve',
  source: 'transport.data.gouv.fr / ODRÉ (odre.opendatasoft.com)',
  stale: false,
};

function sitesPayload() {
  return {
    sites: SITES,
    siteCount: SITES.length,
    pdcPublished: SITES.reduce((sum, site) => sum + site.pdcPublished, 0),
    pdcDistinct: SITES.reduce((sum, site) => sum + site.pdcDistinct, 0),
    pdcTotal: SITES.reduce((sum, site) => sum + site.pdcPublished, 0) + 9,
    pdcWithheld: 9,
    pdcInvalid: 0,
    duplicateSites: 1,
    truncated: false,
    source: 'transport.data.gouv.fr / ODRÉ (odre.opendatasoft.com)',
    dataset: 'bornes-irve',
    box: { south: 48.87, west: 2.22, north: 48.91, east: 2.27 },
    maxBoxDeg: 0.35,
    fetchedAt: Date.now(),
    stale: false,
  };
}

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

/** Render frames explicitly — headless WebGL can stall the rAF loop outright. */
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame++) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
}

async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

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

function probe(page) {
  return page.evaluate(() => {
    const module = window.__godsEyeView.dataManager.layers.get('irve-fr').module;
    // Count what is really on the globe, not what the module says it drew.
    const source = window.__godsEyeView.viewer.dataSources.getByName(
      'Bornes IRVE — implantation par département',
    )[0];
    // Count DÉPARTEMENTS, not entities: Cesium makes one entity per part, and
    // ten départements carry islands — a shown count would say 6 for 5.
    const shownCodes = new Set();
    const hiddenCodes = new Set();
    // The count is now the height, so the probe has to read the Z axis: a
    // département with a PRISM has a measured count, a département drawn FLAT
    // has a count measured at zero, and the two are different statements.
    const prismCodes = new Set();
    const flatCodes = new Set();
    let shown = 0;
    for (const entity of source ? source.entities.values : []) {
      if (!entity.polygon) continue;
      const code = String(entity.properties?.code?.getValue?.() ?? '').trim();
      if (entity.show) {
        shownCodes.add(code);
        shown += 1;
        const top = entity.polygon.extrudedHeight?.getValue?.();
        if (Number.isFinite(top) && top > 0) prismCodes.add(code); else flatCodes.add(code);
      } else hiddenCodes.add(code);
    }
    for (const code of shownCodes) hiddenCodes.delete(code);
    for (const code of prismCodes) flatCodes.delete(code);
    return {
      stats: module.getStats(),
      summary: module.getViewportSummary(),
      national: module.getNationalSummary(),
      meshPick: module.getMeshSummary(),
      legend: module.getRowControls().legend.map((item) => [item.label, item.count, item.color]),
      rendered: module.getDetectableObjects({ maxCount: 100000 }).length,
      polygonsShown: shownCodes.size,
      polygonsHidden: hiddenCodes.size,
      polygonParts: shown,
      prisms: prismCodes.size,
      flats: flatCodes.size,
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

    const payload = sitesPayload();
    let siteRequests = 0;
    let nationalRequests = 0;
    let meshRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN && url.pathname === '/api/irve-fr/sites') {
        siteRequests += 1;
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
        return;
      }
      if (url.origin === APP_ORIGIN && url.pathname === '/api/irve-fr/mesh') {
        meshRequests += 1;
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MESH, fetchedAt: Date.now() }),
        });
        return;
      }
      if (url.origin === APP_ORIGIN && url.pathname === '/api/irve-fr/departements') {
        nationalRequests += 1;
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...NATIONAL, fetchedAt: Date.now() }),
        });
        return;
      }
      void request.continue();
    });

    console.log(`[qa] booting ${APP_URL}`);
    // Suppress the first-run launcher before the app reads it. It is modal and
    // centred, so a screenshot taken behind it proves nothing about the dots
    // this harness exists to look at.
    await page.evaluateOnNewDocument(() => {
      try { window.localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch { /* private mode */ }
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await sleep(2000);

    // ── i. national altitude answers with départements ─────────────────────
    console.log('[qa] i. the national regime');
    // 9.5° of LATITUDE SPAN, not an altitude: `NATIONAL_ENTER_SPAN_DEG` in
    // irveFrance.js. 900 km cleared the ORIGINAL altitude gate and clears
    // nothing now — at this window shape it spans ~6.7° and lands in the
    // maillage. 1 800 km is the whole country with margin on both sides.
    await setView(page, 2.4, 46.6, 1_800_000);
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('irve-fr', true));
    let national = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (attempt % 5 === 0) await setView(page, 2.4, 46.6, 1_800_000);
      await pump(page, 3, 60);
      await sleep(400);
      national = await probe(page);
      if (nationalRequests >= 1 && !national.stats.loading && national.polygonsShown > 0) break;
    }
    check('a national view asks for the rollup, not for a viewport',
      nationalRequests >= 1 && siteRequests === 0, `national=${nationalRequests} sites=${siteRequests}`);
    check('the départements with charge points are RAISED, one prism each',
      national.prisms === 5,
      `${national.prisms} prismes, ${national.flats} plats, ${national.polygonParts} parts`);
    check('and an island keeps every part of its département painted',
      national.polygonParts >= national.polygonsShown, `${national.polygonParts} parts`);
    // The reversal this chantier made, and it is the better reading. The empty
    // département used to be HIDDEN, which put "measured at zero" and "never
    // measured" behind one silence (A1). Zero is a MEASUREMENT: it is drawn,
    // flat and filled, with its own legend line — and a département the sweep
    // never reached is the one that gets no prism and a hatched footprint.
    check('and a count measured at ZERO is drawn flat, never hidden',
      national.flats >= 1 && national.polygonsHidden === 0,
      `${national.flats} plats, ${national.polygonsHidden} masqués`);
    check('no site dot is drawn at this altitude', national.rendered === 0, `${national.rendered} points`);
    check('the layer reports the country total', national.national?.pdcAssigned === 26134,
      String(national.national?.pdcAssigned));
    // Let the photoreal tileset settle before the shot. The assertions above
    // are already green; this only makes the screenshot legible to a human,
    // and headless SwiftShader is slow to stream a continent.
    await pump(page, 25, 120);
    await sleep(5000);
    await pump(page, 25, 120);
    await shoot(page, '01-national.png');

    // ── vi(a). the legend at altitude is the quantile ramp ─────────────────
    console.log('[qa] vi. the national legend');
    const nationalLegend = Object.fromEntries(national.legend.map(([label, count]) => [label, count]));
    // The key is bivariate now: a HEIGHT ruler with numbered marks (D1 — a
    // height with no ruler says only "taller than that one") and the density
    // classes. An entry that names a CHANNEL or a mark carries no count by
    // contract, so only the counted rows tally the départements.
    // The two tallies are over two CHANNELS and must not be added together: a
    // département measured at zero is counted once on the height side, as the
    // refusal of a prism, and once again on the colour side, in its density
    // class. Summing them would assert that a bivariate key describes each
    // unit once, which is exactly what a bivariate key does not do.
    const colourHeader = national.legend.findIndex(([label]) => /^Couleur —/.test(label));
    const colourTotal = national.legend.slice(colourHeader + 1)
      .filter(([, count]) => Number.isFinite(count))
      .reduce((sum, [, count]) => sum + count, 0);
    check('the national legend rules the height and counts DÉPARTEMENTS',
      colourHeader > 0
      && colourTotal === 6
      && national.legend.some(([label]) => /^Hauteur — /.test(label))
      && national.legend.filter(([label]) => /\d[\s\u202f]?\d*\s+points de charge$/.test(label)).length >= 2,
      JSON.stringify(national.legend.map(([l, c]) => [l, c])));
    check('and never shows a power band at this altitude',
      !national.legend.some(([label]) => /kW/.test(label)),
      JSON.stringify(national.legend.map(([l]) => l)));
    check('the ramp is the violet scale, not the power ramp',
      national.legend
        .filter(([, , color]) => !!color)
        .every(([, , color]) => /^#(2f1b52|4d2a86|7239b4|9b4fd0|c774e0|eba9ef|c3ccd8)$/i.test(color)),
      JSON.stringify(national.legend.map(([, , c]) => c)));

    // ── vii. the maillage, between the country and the city ────────────────
    // The regime the second commit added and this harness never covered: at
    // régional scale the layer neither paints départements nor draws 39 859
    // dots, but a spatially thinned sample of real sites that SAYS it is one.
    console.log('[qa] vii. the maillage');
    // The camera is re-asserted every few attempts, not set once. Leaving the
    // national regime is a CAMERA-driven transition, and on a cold dev server
    // the scene is still compiling modules when the first setView lands — the
    // move is then swallowed and the layer sits in the choropleth until the
    // retry budget runs out. Re-issuing it costs nothing and makes the run
    // independent of how warm the server is.
    let mesh = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (attempt % 5 === 0) await setView(page, 2.4, 46.9, 600_000);
      await pump(page, 3, 60);
      await sleep(400);
      mesh = await probe(page);
      if (meshRequests >= 1 && !mesh.stats.loading && mesh.rendered > 0) break;
    }
    const meshPick = mesh.meshPick;
    check('the middle regime fetches the national point set, once',
      meshRequests === 1, `${meshRequests} mesh request(s)`);
    check('and never asks for a viewport it cannot answer',
      siteRequests === 0, `${siteRequests} site request(s)`);
    check('the choropleth has stood down', mesh.polygonsShown === 0,
      `${mesh.polygonsShown} polygons still painted`);
    check('real positions are drawn, and fewer than the set it picked from',
      mesh.rendered > 0 && mesh.rendered < MESH_SITES.length,
      `${mesh.rendered} of ${MESH_SITES.length}`);
    // The point of a stratified pick: the sparse country survives the thinning
    // that a rank-ordered one would spend entirely on the dense conurbation.
    // `sourceId` is the mesh site's own "lat,lon", so this reads real drawn
    // positions rather than trusting the picker's own accounting.
    const rural = await page.evaluate(() => window.__godsEyeView.dataManager.layers
      .get('irve-fr').module.getDetectableObjects({ maxCount: 100000 })
      .filter((entry) => Number(String(entry.sourceId).split(',')[0]) < 48).length);
    check('the sparse country is sampled too, not spent on the dense one',
      rural > 0, `${rural} rural dots`);
    // A thinned map that does not say it is thinned claims France has 1 100
    // charge points — the regime's stated contract, asserted as data.
    check('the layer declares the sample rather than implying an inventory',
      meshPick?.thinned === true && meshPick.shown < meshPick.inBox,
      JSON.stringify(meshPick));
    check('and the row line under the toggle names both counts',
      /\d.* of \d.* sites — sampled maillage/.test(String(mesh.stats.loadingLabel || '')),
      String(mesh.stats.loadingLabel || '').slice(0, 160));
    await shoot(page, '03-maillage.png');

    // ── ii. one dot per SITE ───────────────────────────────────────────────
    console.log('[qa] ii. city view');
    await setView(page, CITY.lon, CITY.lat, 4_000);
    let loaded = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      loaded = await probe(page);
      if (siteRequests >= 1 && !loaded.stats.loading && loaded.stats.count > 0) break;
    }
    check('the viewport request is issued once inside the gate', siteRequests >= 1, `${siteRequests}`);
    check('one dot per site, not one per charge point',
      loaded.rendered === SITES.length, `${loaded.rendered} for ${SITES.length} sites / 275 charge points`);
    check('and the layer counts sites, not charge points',
      loaded.stats.count === SITES.length, `count=${loaded.stats.count}`);
    check('the choropleth stands down rather than fighting the dots',
      loaded.polygonsShown === 0, `${loaded.polygonsShown} polygons still painted`);
    await shoot(page, '02-city.png');

    // ── iii. the ramp reads the highest band, and refuses a bad one ────────
    console.log('[qa] iii. the power ramp');
    const byLabel = Object.fromEntries(loaded.legend.map(([label, count]) => [label, count]));
    const colorOf = Object.fromEntries(loaded.legend.map(([label, , color]) => [label, color]));
    check('the out-of-envelope band is drawn in neutral slate, not on the ramp',
      colorOf['Puissance non exploitable'] === '#7c8899', colorOf['Puissance non exploitable']);
    check('and the high-power band keeps the hot end of the ramp',
      colorOf['Haute puissance (> 150 kW)'] === '#fa5252', colorOf['Haute puissance (> 150 kW)']);

    // ── iv. the legend counts charge points, by band, low to high ──────────
    console.log('[qa] iv. row legend');
    check('the legend counts CHARGE POINTS, not dots',
      byLabel['Lente (≤ 7,4 kW)'] === 226, JSON.stringify(loaded.legend.map(([l, c]) => [l, c])));
    check('every band in view is listed exactly once',
      Object.keys(byLabel).length === 6, JSON.stringify(Object.keys(byLabel)));
    check('with no zero-count entries', loaded.legend.every(([, count]) => count > 0), JSON.stringify(loaded.legend));
    check('read low power to high',
      loaded.legend[0][0].startsWith('Lente') && loaded.legend.at(-1)[0].startsWith('Puissance non'),
      JSON.stringify(loaded.legend.map(([l]) => l)));

    // ── v. the layer says capacity, and names what it merged ───────────────
    console.log('[qa] v. what the control row declares');
    check('the control row reports the de-duplicated total',
      /charge points/.test(loaded.stats.loadingLabel || ''), loaded.stats.loadingLabel);
    check('and names the double publication it merged out',
      /double-published merged/.test(loaded.stats.loadingLabel || ''), loaded.stats.loadingLabel);
    check('and the coordinates it withheld',
      /misplaced withheld/.test(loaded.stats.loadingLabel || ''), loaded.stats.loadingLabel);
    check('the layer never advertises availability',
      !/(libre|available|disponible)/i.test((loaded.stats.loadingLabel || '').replace(/Accès libre/g, '')),
      loaded.stats.loadingLabel);
    check('the viewport summary carries both totals',
      loaded.summary?.pdcPublished === 275 && loaded.summary?.pdcDistinct === 265,
      JSON.stringify({ published: loaded.summary?.pdcPublished, distinct: loaded.summary?.pdcDistinct }));

    const relevant = consoleErrors.filter((entry) => !/favicon|Failed to load resource/i.test(entry));
    check('no console errors from the layer',
      !relevant.some((entry) => /IRVE|irve-fr/i.test(entry)),
      relevant.filter((entry) => /IRVE|irve-fr/i.test(entry)).join(' | '));

    console.log(`\n[qa] shots → ${path.relative(REPO_ROOT, SHOTS_DIR)}`);
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`\n[qa] FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('\n[qa] PASS');
  }
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
