#!/usr/bin/env node
/**
 * Deterministic browser proof that the VOICE surface can read what the two
 * property layers compute.
 *
 * The gap this locks shut, reported from the field on 2026-09-09: asked for the
 * average price per square metre around the Grands Hommes bike station in
 * Bordeaux, the assistant answered that it had no access to that analysis —
 * while `/api/avis-valeur` had already returned a median, its interval and the
 * 68 comparables behind it, and the card on screen was printing them. Nothing
 * was broken; there was simply no path from the layer to the model.
 *
 * Four things are proved, none of which the live register could pin:
 *
 *   i.   ON IS NOT VISIBLE, AND THE VIEW FIXES ITSELF — asked from 40 km up,
 *        `set_layer_visibility` flies the camera down onto the point already in
 *        frame, rescans, and comes back drawing=true with `viewAdjusted`. This
 *        is the whole of the reported "activating DVF by voice never works,
 *        clicking does": from a city view the layer went ON and drew nothing.
 *   ii.  the descent frames the ANSWER, not the ceiling — 900 m for a 300 m
 *        scan, not the 7 km the 12 km ceiling would allow.
 *   iii. `get_entity_context` carries `layerSummaries` — the median the LAYER
 *        computed, its radius, how many sales carry a price, the commune
 *        denominator, and the estimate with its interval.
 *   iv.  those figures are the PROXY'S, never an average of the drawn rows:
 *        the fixture serves 12 sales out of a scan of 372 on purpose, so a
 *        summary recomputed from what is on screen would come out different
 *        and fail here.
 *
 * The two payloads below are RECORDED, not invented — captured from this app's
 * own proxy over Place des Grands Hommes on 2026-09-09, then trimmed to the
 * first few rows for size. Every summary is left exactly as the proxy sent it.
 *
 * Run: node scripts/qa-immobilier-voice.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import process from 'node:process';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
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

/** Place des Grands Hommes, Bordeaux — the operator's own scenario. */
const SUBJECT = { latitude: 44.8446, longitude: -0.5786 };

/** Recorded from GET /api/dvf?lat=44.8446&lon=-0.5786&radius=300. */
const DVF_PAYLOAD = {
  "commune": {
    "code": "33063",
    "name": "Bordeaux"
  },
  "years": [
    2025,
    2024,
    2023
  ],
  "unavailableYears": [],
  "coverage": {
    "basis": "dvf",
    "departement": "33"
  },
  "sales": [
    {
      "id": "2023-416086",
      "date": "2023-10-02",
      "nature": "Vente",
      "valeur": 224004,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "61 CRS GEORGES CLEMENCEAU",
      "parcelle": "33063000KW0139",
      "lon": -0.578637,
      "lat": 44.844554,
      "rowCount": 3,
      "dwellingCount": 1,
      "dwellingSurface": 30,
      "ancillaryCount": 2,
      "otherCount": 0,
      "types": [
        "Appartement",
        "Dépendance"
      ],
      "rooms": 1,
      "terrain": 0,
      "prixM2": 7467,
      "distanceM": 6
    },
    {
      "id": "2025-385457",
      "date": "2025-01-17",
      "nature": "Vente",
      "valeur": 330000,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "57 CRS GEORGES CLEMENCEAU",
      "parcelle": "33063000KW0141",
      "lon": -0.578838,
      "lat": 44.84442,
      "rowCount": 2,
      "dwellingCount": 1,
      "dwellingSurface": 65,
      "ancillaryCount": 1,
      "otherCount": 0,
      "types": [
        "Appartement",
        "Dépendance"
      ],
      "rooms": 2,
      "terrain": 0,
      "prixM2": 5077,
      "distanceM": 27
    },
    {
      "id": "2025-392420",
      "date": "2025-07-08",
      "nature": "Vente",
      "valeur": 345900,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "57 CRS GEORGES CLEMENCEAU",
      "parcelle": "33063000KW0141",
      "lon": -0.578838,
      "lat": 44.84442,
      "rowCount": 2,
      "dwellingCount": 1,
      "dwellingSurface": 60,
      "ancillaryCount": 1,
      "otherCount": 0,
      "types": [
        "Appartement",
        "Dépendance"
      ],
      "rooms": 3,
      "terrain": 0,
      "prixM2": 5765,
      "distanceM": 27
    },
    {
      "id": "2023-409464",
      "date": "2023-05-02",
      "nature": "Vente",
      "valeur": 624000,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "1 RUE LHOTE",
      "parcelle": "33063000KS0027",
      "lon": -0.578727,
      "lat": 44.844943,
      "rowCount": 3,
      "dwellingCount": 1,
      "dwellingSurface": 113,
      "ancillaryCount": 2,
      "otherCount": 0,
      "types": [
        "Appartement",
        "Dépendance"
      ],
      "rooms": 3,
      "terrain": 0,
      "prixM2": 5522,
      "distanceM": 39
    },
    {
      "id": "2025-390271",
      "date": "2025-05-27",
      "nature": "Vente",
      "valeur": 414400,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "7 RUE HUGUERIE",
      "parcelle": "33063000KS0028",
      "lon": -0.578839,
      "lat": 44.844925,
      "rowCount": 2,
      "dwellingCount": 1,
      "dwellingSurface": 63,
      "ancillaryCount": 1,
      "otherCount": 0,
      "types": [
        "Appartement",
        "Dépendance"
      ],
      "rooms": 2,
      "terrain": 0,
      "prixM2": 6578,
      "distanceM": 41
    },
    {
      "id": "2023-406826",
      "date": "2023-02-27",
      "nature": "Vente",
      "valeur": 389950,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "7 RUE HUGUERIE",
      "parcelle": "33063000KS0028",
      "lon": -0.578839,
      "lat": 44.844925,
      "rowCount": 3,
      "dwellingCount": 1,
      "dwellingSurface": 59,
      "ancillaryCount": 2,
      "otherCount": 0,
      "types": [
        "Appartement",
        "Dépendance"
      ],
      "rooms": 2,
      "terrain": 0,
      "prixM2": 6609,
      "distanceM": 41
    },
    {
      "id": "2024-372721",
      "date": "2024-10-01",
      "nature": "Vente",
      "valeur": 483050,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "18 RUE HUGUERIE",
      "parcelle": "33063000KW0127",
      "lon": -0.579223,
      "lat": 44.844549,
      "rowCount": 2,
      "dwellingCount": 1,
      "dwellingSurface": 76,
      "ancillaryCount": 1,
      "otherCount": 0,
      "types": [
        "Appartement",
        "Dépendance"
      ],
      "rooms": 3,
      "terrain": 0,
      "prixM2": 6356,
      "distanceM": 49
    },
    {
      "id": "2023-412265",
      "date": "2023-07-17",
      "nature": "Vente",
      "valeur": 524180,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "18 RUE HUGUERIE",
      "parcelle": "33063000KW0127",
      "lon": -0.579223,
      "lat": 44.844549,
      "rowCount": 3,
      "dwellingCount": 1,
      "dwellingSurface": 87,
      "ancillaryCount": 2,
      "otherCount": 0,
      "types": [
        "Appartement",
        "Dépendance"
      ],
      "rooms": 5,
      "terrain": 0,
      "prixM2": 6025,
      "distanceM": 49
    },
    {
      "id": "2025-389890",
      "date": "2025-04-30",
      "nature": "Vente",
      "valeur": 1600000,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "13 RUE HUGUERIE",
      "parcelle": "33063000KS0031",
      "lon": -0.579061,
      "lat": 44.844938,
      "rowCount": 1,
      "dwellingCount": 0,
      "dwellingSurface": 0,
      "ancillaryCount": 0,
      "otherCount": 1,
      "types": [
        "Local industriel. commercial ou assimilé"
      ],
      "rooms": null,
      "terrain": 138,
      "prixM2": null,
      "distanceM": 52
    },
    {
      "id": "2024-370122",
      "date": "2024-06-20",
      "nature": "Vente",
      "valeur": 850000,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "80 CRS GEORGES CLEMENCEAU",
      "parcelle": "33063000KO0005",
      "lon": -0.577935,
      "lat": 44.844596,
      "rowCount": 1,
      "dwellingCount": 0,
      "dwellingSurface": 0,
      "ancillaryCount": 0,
      "otherCount": 1,
      "types": [
        "Local industriel. commercial ou assimilé"
      ],
      "rooms": null,
      "terrain": 0,
      "prixM2": null,
      "distanceM": 52
    },
    {
      "id": "2023-407715",
      "date": "2023-03-22",
      "nature": "Vente",
      "valeur": 610000,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "5 PL TOURNY",
      "parcelle": "33063000KS0054",
      "lon": -0.578397,
      "lat": 44.845067,
      "rowCount": 3,
      "dwellingCount": 0,
      "dwellingSurface": 0,
      "ancillaryCount": 2,
      "otherCount": 1,
      "types": [
        "Dépendance",
        "Local industriel. commercial ou assimilé"
      ],
      "rooms": null,
      "terrain": 0,
      "prixM2": null,
      "distanceM": 54
    },
    {
      "id": "2023-407984",
      "date": "2023-03-31",
      "nature": "Vente",
      "valeur": 4005850,
      "commune": "Bordeaux",
      "communeCode": "33063",
      "address": "5 PL TOURNY",
      "parcelle": "33063000KS0054",
      "lon": -0.578397,
      "lat": 44.845067,
      "rowCount": 9,
      "dwellingCount": 4,
      "dwellingSurface": 659,
      "ancillaryCount": 3,
      "otherCount": 2,
      "types": [
        "Appartement",
        "Dépendance",
        "Local industriel. commercial ou assimilé"
      ],
      "rooms": 5,
      "terrain": 0,
      "prixM2": null,
      "distanceM": 54
    }
  ],
  "summary": {
    "count": 372,
    "served": 12,
    "truncated": true,
    "comparableCount": 237,
    "medianPrixM2": 5522,
    "reference": {
      "basis": "commune",
      "code": "33063",
      "name": "Bordeaux",
      "codeCount": 1,
      "count": 17916,
      "comparableCount": 12551,
      "unplacedCount": 61,
      "medianPrixM2": 4423,
      "p25PrixM2": 3643,
      "p75PrixM2": 5323
    },
    "p25PrixM2": 4773,
    "p75PrixM2": 6448,
    "radiusM": 300,
    "perYear": {
      "2023": {
        "count": 130,
        "comparableCount": 79,
        "medianPrixM2": 6186
      },
      "2024": {
        "count": 120,
        "comparableCount": 74,
        "medianPrixM2": 5317
      },
      "2025": {
        "count": 122,
        "comparableCount": 84,
        "medianPrixM2": 5285
      }
    }
  },
  "fetchedAt": 1788950978775,
  "stale": false
};

/** Recorded from GET /api/avis-valeur?…&type=Appartement&surface=60. */
const AVIS_PAYLOAD = {
  "subject": {
    "type": "Appartement",
    "surfaceM2": 60,
    "lon": -0.5786,
    "lat": 44.8446
  },
  "commune": {
    "code": "33063",
    "name": "Bordeaux"
  },
  "years": [
    2025,
    2024,
    2023
  ],
  "coverage": {
    "basis": "dvf",
    "departement": "33"
  },
  "estimate": {
    "basis": "comparables",
    "reason": null,
    "count": 68,
    "rung": {
      "id": "block",
      "radiusM": 300,
      "band": 0.2,
      "label": "300 m, ±20 % de surface"
    },
    "tried": [
      {
        "id": "block",
        "radiusM": 300,
        "band": 0.2,
        "label": "300 m, ±20 % de surface",
        "count": 68,
        "reason": null
      }
    ],
    "prixM2": {
      "median": 5300,
      "p25": 4744,
      "p75": 6193,
      "min": 701,
      "max": 8373,
      "ci90": {
        "lo": 4949,
        "hi": 5671,
        "coverage": 0.9318813257158994,
        "k": 27
      },
      "ciDeviationPct": {
        "low": 6.6,
        "high": 7,
        "max": 7
      },
      "withheldMedian": null
    },
    "valeur": {
      "median": 318000,
      "p25": 285000,
      "p75": 372000,
      "ci90": {
        "lo": 297000,
        "hi": 340000
      }
    },
    "surfaceMedian": 60,
    "symbolicCount": 0,
    "terrainMedian": null
  },
  "drift": {
    "basis": "commune-year",
    "perYear": [
      {
        "year": "2023",
        "count": 3523,
        "comparableCount": 3261,
        "medianPrixM2": 4524
      },
      {
        "year": "2024",
        "count": 3071,
        "comparableCount": 2847,
        "medianPrixM2": 4213
      },
      {
        "year": "2025",
        "count": 3727,
        "comparableCount": 3418,
        "medianPrixM2": 4117
      }
    ],
    "pct": -9,
    "loud": false,
    "fromYear": "2023",
    "toYear": "2025"
  },
  "excluded": {
    "notPriceable": 5365,
    "vefa": 53,
    "otherType": 2966,
    "unplaced": 9,
    "zeroPrice": 6,
    "duplicate": 0
  },
  "poolCount": 9517,
  "comparables": [
    {
      "id": "2025-385457",
      "lon": -0.578838,
      "lat": 44.84442,
      "date": "2025-01-17",
      "prixM2": 5077,
      "valeur": 330000,
      "surface": 65,
      "rooms": 2,
      "terrain": 0,
      "address": "57 CRS GEORGES CLEMENCEAU",
      "distanceM": 27
    },
    {
      "id": "2025-392420",
      "lon": -0.578838,
      "lat": 44.84442,
      "date": "2025-07-08",
      "prixM2": 5765,
      "valeur": 345900,
      "surface": 60,
      "rooms": 3,
      "terrain": 0,
      "address": "57 CRS GEORGES CLEMENCEAU",
      "distanceM": 27
    },
    {
      "id": "2025-390271",
      "lon": -0.578839,
      "lat": 44.844925,
      "date": "2025-05-27",
      "prixM2": 6578,
      "valeur": 414400,
      "surface": 63,
      "rooms": 2,
      "terrain": 0,
      "address": "7 RUE HUGUERIE",
      "distanceM": 41
    },
    {
      "id": "2023-406826",
      "lon": -0.578839,
      "lat": 44.844925,
      "date": "2023-02-27",
      "prixM2": 6609,
      "valeur": 389950,
      "surface": 59,
      "rooms": 2,
      "terrain": 0,
      "address": "7 RUE HUGUERIE",
      "distanceM": 41
    },
    {
      "id": "2023-406210",
      "lon": -0.579389,
      "lat": 44.844845,
      "date": "2023-02-21",
      "prixM2": 6403,
      "valeur": 358570,
      "surface": 56,
      "rooms": 2,
      "terrain": 0,
      "address": "21 RUE HUGUERIE",
      "distanceM": 68
    },
    {
      "id": "2023-406970",
      "lon": -0.579511,
      "lat": 44.844354,
      "date": "2023-02-24",
      "prixM2": 5573,
      "valeur": 373420,
      "surface": 67,
      "rooms": 2,
      "terrain": 0,
      "address": "32 RUE LAFAURIE MONBADON",
      "distanceM": 77
    },
    {
      "id": "2025-389268",
      "lon": -0.579511,
      "lat": 44.844246,
      "date": "2025-04-17",
      "prixM2": 4727,
      "valeur": 260000,
      "surface": 55,
      "rooms": 2,
      "terrain": 0,
      "address": "28 RUE LAFAURIE MONBADON",
      "distanceM": 82
    },
    {
      "id": "2025-398949",
      "lon": -0.579123,
      "lat": 44.843959,
      "date": "2025-12-15",
      "prixM2": 5000,
      "valeur": 350000,
      "surface": 70,
      "rooms": 3,
      "terrain": 0,
      "address": "47 CRS GEORGES CLEMENCEAU",
      "distanceM": 82
    }
  ],
  "served": 8,
  "truncated": true,
  "unavailableYears": [],
  "fetchedAt": 1788950979495,
  "stale": false
};

const failures = [];
function check(label, ok, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    executablePath: chrome,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });
  try {
    const page = await newQaPage(browser);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      const serve = (body) => request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      // The register itself is pinned next door (src/data/dvfFeed.test.mjs).
      // What is under test here is the path from a settled layer to a spoken
      // number, so the payload is held still.
      if (url.includes('/api/dvf?')) return serve(DVF_PAYLOAD);
      if (url.includes('/api/avis-valeur?')) return serve(AVIS_PAYLOAD);
      return request.continue();
    });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(
      () => Boolean(window.__gevVoiceCommands?.runner && window.__godsEyeView?.dataManager),
      { timeout: 120000 },
    );
    const run = (name, a = {}) => page.evaluate(
      (n, x) => window.__gevVoiceCommands.runner(n, x), name, a,
    );

    // ── i + ii. asked from too high, the view comes down by itself ─────────
    console.log('\nasked from 40 km up');
    for (const layerId of ['dvf-sales', 'avis-valeur']) {
      await run('set_layer_visibility', { layerId, enabled: false });
      await run('fly_to_location', { ...SUBJECT, rangeM: 40000, waitForArrival: true });
      await sleep(2500);
      const before = await page.evaluate(() => Math.round(window.__godsEyeView.viewer.camera.positionCartographic.height));
      const high = await run('set_layer_visibility', { layerId, enabled: true });
      const after = await page.evaluate(() => Math.round(window.__godsEyeView.viewer.camera.positionCartographic.height));
      check(`${layerId} reports it is on`, high.ok === true && high.enabled === true, JSON.stringify(high.lifecycleState));
      check(`${layerId} flew the view down by itself`, high.viewAdjusted?.ok === true,
        `${before} m → ${after} m · ${JSON.stringify(high.viewAdjusted)}`);
      // The ANSWER is framed, not the ceiling: 900 m of range for a 300 m scan,
      // never the 7 km the 12 km ceiling would have allowed.
      check(`${layerId} framed the scan, not the ceiling`, high.viewAdjusted?.rangeM === 900,
        `rangeM=${high.viewAdjusted?.rangeM}`);
      check(`${layerId} came back below its ceiling`, after < 12000 && after < before,
        `${before} m → ${after} m`);
      check(`${layerId} is drawing after the descent`, high.drawing === true && high.count > 0,
        `drawing=${high.drawing} count=${high.count}`);
      check(`${layerId} no longer reports a reason it is not drawn`, high.notDrawnBecause === undefined,
        `${high.notDrawnBecause}`);
    }
    await sleep(2500);

    // ── iii + iv. the numbers reach the voice surface ──────────────────────
    const context = await run('get_entity_context', {});
    const summaries = context.layerSummaries || [];
    const dvf = summaries.find((entry) => entry.layerId === 'dvf-sales') || {};
    const avis = summaries.find((entry) => entry.layerId === 'avis-valeur') || {};
    console.log('\nlayerSummaries');
    check('both property layers publish a summary', summaries.length === 2,
      summaries.map((entry) => entry.layerId).join(', ') || 'none');

    // The proxy's own figures, to the euro. A summary recomputed from the 12
    // drawn rows could not land on the median of a 372-sale scan.
    check('the block median is the proxy\'s, not an average of the drawn rows',
      dvf.blockMedianPrixM2 === 5522, `${dvf.blockMedianPrixM2}`);
    check('the sales it is drawn from are counted, not the markers',
      dvf.salesInRadius === 372 && dvf.salesDrawn === 12, `${dvf.salesInRadius} / ${dvf.salesDrawn}`);
    check('how many of them carry a price travels with the median',
      dvf.pricedSales === 237, `${dvf.pricedSales}`);
    check('the commune denominator is named', dvf.communeMedianPrixM2 === 4423 && /Bordeaux/.test(dvf.communeReference || ''),
      `${dvf.communeMedianPrixM2} — ${dvf.communeReference}`);
    check('the quartiles come with it', dvf.blockP25PrixM2 === 4773 && dvf.blockP75PrixM2 === 6448,
      `${dvf.blockP25PrixM2}–${dvf.blockP75PrixM2}`);
    // WHERE it was measured, so a block the camera has left cannot be quoted
    // for the one it has arrived at.
    check('the summary carries the point it was measured at',
      Math.abs((dvf.measuredAt?.lat ?? 0) - SUBJECT.latitude) < 0.02
      && Math.abs((dvf.measuredAt?.lon ?? 0) - SUBJECT.longitude) < 0.02,
      JSON.stringify(dvf.measuredAt));

    check('the estimate is published with its basis', avis.basis === 'comparables' && avis.estimatedPrixM2 === 5300,
      `${avis.basis} ${avis.estimatedPrixM2}`);
    check('the estimate names its subject and its reach',
      /Appartement/.test(avis.subject || '') && avis.radiusM === 300 && avis.comparableCount === 68,
      `${avis.subject} · ${avis.radiusM} m · ${avis.comparableCount}`);
    check('the interval travels with the centre',
      avis.prixM2P25 === 4744 && avis.prixM2P75 === 6193 && avis.intervalDeviationPct > 0,
      `${avis.prixM2P25}–${avis.prixM2P75} ±${avis.intervalDeviationPct}%`);

    // ── the sales are queryable, and an unpriceable one stays unpriced ─────
    const sales = await run('analyst_query', {
      layers: ['dvf-sales'], scope: { kind: 'view' }, sortBy: 'distance', limit: 5,
    });
    console.log('\nanalyst_query');
    check('the drawn sales answer a count', sales.ok === true && sales.count === 12, `${sales.count}`);
    check('an item is speakable — an address, not a mutation id',
      Boolean(sales.items?.[0]?.address), JSON.stringify(sales.items?.[0] || null).slice(0, 160));
    const unpriced = (sales.items || []).filter((item) => item.priced === false);
    check('a sale the register cannot price carries no price per square metre',
      unpriced.every((item) => item.prixM2 === undefined), `${unpriced.length} unpriced in the top 5`);

    // ── switching off says nothing about a screen with nothing on it ───────
    const off = await run('set_layer_visibility', { layerId: 'dvf-sales', enabled: false });
    check('turning a layer off reports no drawing verdict',
      off.ok === true && off.drawing === undefined, JSON.stringify(off));
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
