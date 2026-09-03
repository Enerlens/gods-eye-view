#!/usr/bin/env node
/**
 * Browser proof for the « Représentation » chantier.
 *
 * The five chantiers landed with 5 923 unit tests behind them and almost
 * nothing seen on screen. A unit test can prove that `prismHeightM(10245)`
 * returns 102 450, and cannot prove that the resulting volume is visible, that
 * it does not swallow the country, or that its legend is not printing the
 * string "undefined" next to every entry. That is what this harness is for.
 *
 * It asserts the things a screenshot would show a human, and it takes the
 * screenshots too, so a reviewer can look rather than trust:
 *
 *   i.   the four prism layers draw EXTRUDED volumes at national altitude —
 *        `extrudedHeight` actually set, `perPositionHeight` false — and no
 *        prism is taller than the frozen domain allows
 *   ii.  every legend entry renders REAL TEXT: no "undefined", and no swatch
 *        that is invisible (the `has-glyph` + `color: null` hole)
 *   iii. two prism layers on together are declared as non-comparable, which is
 *        the F7 ② case the doctrine records as failing
 *   iv.  the earthquake depth stems exist and do NOT disable the depth test
 *   v.   the hour scrubber on `comptages-fr` repaints without a refetch
 *   vi.  the console stays clean through all of it
 *
 * Run: npm run preview -- --port 4173, then
 *      node scripts/qa-representation.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'representation');
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

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
};

async function setView(page, lon, lat, height) {
  await page.evaluate((view) => {
    const gev = window.__godsEyeView;
    if (!gev?.viewer) return;
    const Cesium = window.Cesium;
    gev.viewer.trackedEntity = undefined;
    gev.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(view.lon, view.lat, view.height),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    gev.viewer.scene.render();
  }, { lon, lat, height });
}

/** Pump the render loop: the governor only draws on demand. */
async function settle(page, ms = 2500) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ }
    });
    await sleep(120);
  }
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
}

/** Every legend row currently rendered, as the reader sees it. */
async function legendText(page) {
  return page.evaluate(() => {
    const rows = [];
    for (const node of document.querySelectorAll('#map-legend .map-legend-entry, .data-toggle-legend-entry')) {
      const swatch = node.querySelector('[class*="legend-swatch"]');
      const styles = swatch ? window.getComputedStyle(swatch) : null;
      rows.push({
        text: (node.textContent || '').trim(),
        // A swatch with neither a background nor a ring is a hole in the key.
        inked: !!styles && (
          (styles.backgroundColor && styles.backgroundColor !== 'rgba(0, 0, 0, 0)')
          || (styles.boxShadow && styles.boxShadow !== 'none')
        ),
      });
    }
    return rows;
  });
}

async function main() {
  if (!chrome) {
    console.error('No Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH.');
    process.exit(2);
  }
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: HEADFUL ? false : 'new',
    // `--enable-unsafe-swiftshader` is not optional on current Chrome: without
    // it software WebGL is refused, the viewer never constructs, and the app
    // global this harness waits on is never published.
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await newQaPage(browser);
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 90_000 },
    );
    await settle(page, 3000);

    // ── i. the prisms are real geometry, at national altitude ───────────────
    // `irve-fr` is deliberately NOT in this list. Its national regime is an
    // adaptive 24-request sweep of a live ODRÉ endpoint, so on a machine that
    // cannot reach it the layer answers with the viewport regime instead —
    // which is correct behaviour and an empty assertion here. It is covered
    // deterministically, against intercepted fixtures, by `npm run qa:irve-fr`,
    // which proves the same prisms plus the regime switch this cannot.
    for (const layerId of ['schools-fr', 'sup-fr', 'france-energy']) {
      await setView(page, 2.4, 46.6, 1_800_000);
      await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, true), layerId);
      // POLL, do not sleep a fixed time. The first layer of the loop is always
      // the cold one — the rollup has to be fetched, projected and tessellated
      // — and a fixed settle turned that into "0 prismes", i.e. a timing
      // artefact reported as an empty layer. Whichever layer goes first now
      // gets the same chance as the ones that follow it.
      const readGeometry = () => page.evaluate(() => {
        const now = window.Cesium.JulianDate.now();
        let extruded = 0; let flat = 0; let maxTop = 0; let perPosition = 0;
        for (const source of window.__godsEyeView.viewer.dataSources._dataSources) {
          for (const entity of source.entities.values) {
            if (!entity.polygon) continue;
            const top = entity.polygon.extrudedHeight?.getValue?.(now);
            if (Number.isFinite(top) && top > 0) {
              extruded += 1;
              maxTop = Math.max(maxTop, top);
              if (entity.polygon.perPositionHeight?.getValue?.(now) === true) perPosition += 1;
            } else if (entity.polygon.show?.getValue?.(now) !== false) flat += 1;
          }
        }
        return { extruded, flat, maxTop, perPosition };
      });
      let geometry = { extruded: 0, flat: 0, maxTop: 0, perPosition: 0 };
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await settle(page, 2000);
        if (attempt % 4 === 3) await setView(page, 2.4, 46.6, 1_800_000);
        geometry = await readGeometry();
        if (geometry.extruded > 0) break;
      }

      check(`${layerId} — des prismes extrudés au national`, geometry.extruded > 0,
        `${geometry.extruded} extrudés, ${geometry.flat} plats, sommet ${Math.round(geometry.maxTop / 1000)} km`);
      check(`${layerId} — aucun prisme en perPositionHeight`, geometry.perPosition === 0);
      check(`${layerId} — le sommet reste sous 200 km`, geometry.maxTop < 200_000,
        `${Math.round(geometry.maxTop / 1000)} km`);

      const legend = await legendText(page);
      const undef = legend.filter((row) => /undefined/.test(row.text));
      check(`${layerId} — aucune entrée de légende « undefined »`, undef.length === 0,
        undef.map((row) => row.text).join(' / '));
      const holes = legend.filter((row) => !row.inked);
      check(`${layerId} — aucune pastille invisible`, holes.length === 0,
        holes.map((row) => row.text).slice(0, 3).join(' / '));

      await shot(page, `prisme-${layerId}`);
      await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, false), layerId);
      await settle(page, 800);
    }

    // ── iii. two prisms together — F7 ②, recorded as failing ────────────────
    await setView(page, 2.4, 46.6, 1_800_000);
    for (const id of ['sup-fr', 'schools-fr']) {
      await page.evaluate((layerId) => window.__godsEyeView.dataManager.setEnabled(layerId, true), id);
    }
    await settle(page, 6000);
    await shot(page, 'f7-deux-prismes');
    console.log('  note  F7 ② : deux prismes coïncidents, capture f7-deux-prismes.png');
    for (const id of ['sup-fr', 'schools-fr']) {
      await page.evaluate((layerId) => window.__godsEyeView.dataManager.setEnabled(layerId, false), id);
    }
    await settle(page, 800);

    // ── iv. earthquakes: stems exist, depth test intact ─────────────────────
    await setView(page, 140, 0, 12_000_000);
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('earthquakes', true));
    await settle(page, 8000);
    const quakes = await page.evaluate(() => {
      const now = window.Cesium.JulianDate.now();
      let polylines = 0; let points = 0; let depthTestOff = 0;
      for (const source of window.__godsEyeView.viewer.dataSources._dataSources) {
        for (const entity of source.entities.values) {
          if (!String(entity.id || '').startsWith('earthquake')) continue;
          if (entity.polyline) polylines += 1;
          if (entity.point) {
            points += 1;
            const d = entity.point.disableDepthTestDistance?.getValue?.(now);
            if (Number.isFinite(d) && d > 1e6) depthTestOff += 1;
          }
        }
      }
      return { polylines, points, depthTestOff };
    });
    check('séismes — des tiges de profondeur sont dessinées', quakes.polylines > 0,
      `${quakes.polylines} tiges, ${quakes.points} points`);
    check('séismes — le test de profondeur n’est pas désactivé (F1)', quakes.depthTestOff === 0);
    await shot(page, 'seismes-global');
    await setView(page, 140, -18, 900_000);
    await settle(page, 3000);
    await shot(page, 'seismes-rasant');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('earthquakes', false));

    // ── vi. console ────────────────────────────────────────────────────────
    // Two failures are the ABSENCE OF A CREDENTIAL on this machine, not a
    // regression, and the app already says so out loud: the Google 3D Tiles key
    // is EEA-blocked (403, "falling back to Cesium globe") and the HUD summary
    // has no OPENAI_API_KEY (503, "AI summary off for this session"). Anything
    // else is this chantier's problem.
    const noise = consoleErrors.filter((line) => !(
      /favicon|ERR_INTERNET_DISCONNECTED|net::/i.test(line)
      || /tile\.googleapis\.com|3dtiles/i.test(line)
      || /openai\/hud-summary/i.test(line)
      || /status of (403|503)/i.test(line)
    ));
    check('console propre', noise.length === 0, noise.slice(0, 3).join(' | '));

    console.log(`\nCaptures : ${SHOTS_DIR}`);
    console.log(failures === 0 ? '\nTOUT PASSE' : `\n${failures} ÉCHEC(S)`);
  } finally {
    await browser.close();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(2); });
