#!/usr/bin/env node
/**
 * Deterministic browser proof for the five French address layers.
 *
 * `georisques`, `dvf-sales`, `dpe-fr`, `urbanisme-gpu` and `idfm-network` are
 * the only layers in the app that scan around the point the camera is LOOKING
 * AT rather than over the viewport, and four of them draw nothing at all above
 * 12 km. Both behaviours are invisible to a unit test and both fail silently:
 * a scan centred on the wrong block, or a dormant layer, looks exactly like a
 * layer with no data.
 *
 * So this harness proves the five things only a real Cesium scene can:
 *
 *   i.   each layer draws entities over the reference address (avenue de
 *        France, Paris 13e) — the address the mission storyboard is built on
 *   ii.  each layer's scan centre lands within 400 m of that address, so the
 *        camera look-at derivation is doing its job
 *   iii. above the activation ceiling the layers go DORMANT and clear their
 *        draw, rather than leaving a block-scale answer on screen at
 *        region scale
 *   iv.  the honesty fields survive to the browser: DVF reports fewer
 *        comparables than sales, DPE reports more diagnostics than it drew,
 *        and the GPU outlines declare themselves simplified
 *   v.   IDFM reports its own live-vehicle absence rather than looking broken
 *   vi.  NAVIGATING re-scans without waiting for the manager's tick. These
 *        layers refresh every 5 to 15 minutes — right for registers that move
 *        in weeks, useless for someone flying across a city — so they listen to
 *        `camera.moveEnd`. Without it the reported symptom is a layer that
 *        "has trouble refreshing" when you move, then catches up minutes later.
 *   vii. clicking a drawn marker OPENS A CARD. The app runs with
 *        `infoBox: false`, so a marker with a perfectly good `description` is
 *        inert until its layer owns a LEFT_CLICK handler — the first version of
 *        these layers shipped exactly that way and every other check still
 *        passed
 *
 * Screenshots are written under the gitignored `qa-shots/address-layers/`.
 *
 * Run: node scripts/qa-address-layers.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'address-layers');
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

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * The reference address of the mission storyboard: avenue de France, Paris 13e,
 * beside Bibliothèque François-Mitterrand. Chosen because every one of the six
 * sources has something to say about it — metro at 30 m, a railway protection
 * strip, 2,805 diagnostics within 300 m, and 153 recorded sales.
 */
const ADDRESS = { lon: 2.3760, lat: 48.8300 };
const CLOSE_VIEW = { ...ADDRESS, height: 900 };
/** A second Paris address, 5.7 km north — far enough to be a different scan. */
const SECOND_ADDRESS = { lon: 2.3553, lat: 48.8809 };
const SECOND_VIEW = { ...SECOND_ADDRESS, height: 900 };
const REGION_VIEW = { ...ADDRESS, height: 60_000 };

const LAYERS = ['georisques', 'dvf-sales', 'dpe-fr', 'urbanisme-gpu', 'idfm-network'];

/** Metres between two coordinates. */
function metresApart(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Move the camera.
 *
 * Through the viewer's OWN ellipsoid rather than a global `Cesium` — the app
 * does not publish one, and an earlier version of this harness fell back to
 * `camera.positionWC`, left the camera on the default Paris view, and reported
 * every layer as scanning 6,749 m from the address it thought it had flown to.
 * Every check still passed except the one measuring the distance, which is
 * exactly why that check is here.
 */
async function flyTo(page, view) {
  await page.evaluate((lon, lat, height) => {
    const gev = window.__godsEyeView;
    if (!gev?.viewer) throw new Error('viewer unavailable');
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: lon * d2r, latitude: lat * d2r, height,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    scene.requestRender?.();
  }, view.lon, view.lat, view.height);
  await pump(page, 4, 80);
}

/**
 * Look at the address from an angle, with it kept at the middle of the screen.
 *
 * `flyTo` looks straight down, and straight down is the one pose in which the
 * anchoring bug is invisible: a marker buried under the terrain projects to
 * almost the same pixel as the street above it when the camera is directly
 * overhead. The error is a function of obliquity, so the check that measures it
 * has to be able to tilt and to turn.
 */
async function orbit(page, view, headingDeg, pitchDeg, rangeM = 900) {
  await page.evaluate((lon, lat, headingDegrees, pitchDegrees, range) => {
    const gev = window.__godsEyeView;
    if (!gev?.viewer) throw new Error('viewer unavailable');
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    const heading = headingDegrees * d2r;
    const pitch = pitchDegrees * d2r;
    // Stand the camera back down the heading and up by the pitch, so the
    // address itself lands under the crosshair rather than off the edge.
    const up = range * Math.sin(-pitch);
    const back = range * Math.cos(-pitch);
    const dLat = -(back * Math.cos(heading)) / 111_320;
    const dLon = -(back * Math.sin(heading)) / (111_320 * Math.cos(lat * d2r));
    const ground = scene.globe?.getHeight?.({
      longitude: lon * d2r, latitude: lat * d2r, height: 0,
    });
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: (lon + dLon) * d2r,
        latitude: (lat + dLat) * d2r,
        height: (Number.isFinite(ground) ? ground : 0) + up,
      }),
      orientation: { heading, pitch, roll: 0 },
    });
    scene.requestRender?.();
  }, view.lon, view.lat, headingDeg, pitchDeg, rangeM);
  await pump(page, 8);
}

/**
 * Draw frames by hand.
 *
 * The render governor runs in `requestRenderMode`, so nothing repaints on its
 * own — and terrain that is never rendered is terrain `getHeight` cannot answer
 * for.
 */
async function pump(page, frames = 6, gapMs = 90) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await sleep(gapMs);
  }
}

/**
 * Measure, for each drawn marker, how far it is from its own address.
 *
 * `heightErrorM` is the marker's height minus the height of the terrain the
 * globe is DRAWING beneath it. `offsetPx` turns that into the thing a user
 * sees: the distance on screen between where the marker is painted and where
 * its address actually is. That number is a function of the camera pose, which
 * is the whole complaint — a marker eighty metres underground does not sit
 * still, it slides across the city as you turn.
 */
async function measureAnchor(page, ids, sampleSize = 10) {
  return page.evaluate((layerIds, limit) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const globe = scene.globe;
    const ellipsoid = globe.ellipsoid;
    const time = gev.viewer.clock.currentTime;
    const out = {};
    for (const layerId of layerIds) {
      const source = gev.viewer.dataSources.getByName(layerId)?.[0];
      const rows = [];
      for (const entity of source?.entities?.values || []) {
        if (rows.length >= limit) break;
        // Clamped polylines carry no `position`; they are already on the ground.
        const position = entity.position?.getValue?.(time);
        if (!position) continue;
        const carto = ellipsoid.cartesianToCartographic(position);
        const ground = globe.getHeight({
          longitude: carto.longitude, latitude: carto.latitude, height: 0,
        });
        if (!Number.isFinite(ground)) continue;
        const truth = ellipsoid.cartographicToCartesian({
          longitude: carto.longitude, latitude: carto.latitude, height: ground,
        });
        const drawnAt = scene.cartesianToCanvasCoordinates(position);
        const belongsAt = scene.cartesianToCanvasCoordinates(truth);
        if (!drawnAt || !belongsAt) continue;
        rows.push({
          id: entity.id,
          groundM: ground,
          heightErrorM: carto.height - ground,
          offsetPx: Math.hypot(drawnAt.x - belongsAt.x, drawnAt.y - belongsAt.y),
        });
      }
      out[layerId] = rows;
    }
    return out;
  }, ids, sampleSize);
}

/** The worst marker in a layer's sample, by one measured field. */
function worst(rows, field) {
  return rows.length ? Math.max(...rows.map((row) => Math.abs(row[field]))) : Infinity;
}

/**
 * Read the symbol every layer is drawing with.
 *
 * The user-visible contract this measures: turn two registers on over the same
 * street and you must be able to tell which dot came from which. Colour cannot
 * carry that — DVF spends it on the price against the local median, DPE on the
 * official A–G scale — so the SHAPE has to, and nothing in an entity count or
 * a stats field can see whether it does.
 */
async function readSymbols(page, ids) {
  return page.evaluate((layerIds) => {
    const gev = window.__godsEyeView;
    const time = gev.viewer.clock.currentTime;
    const out = {};
    for (const layerId of layerIds) {
      const source = gev.viewer.dataSources.getByName(layerId)?.[0];
      const images = new Set();
      let markers = 0;
      let bareDots = 0;
      let imageless = 0;
      for (const entity of source?.entities?.values || []) {
        // A clamped zoning ring draws neither; it is not a marker.
        if (!entity.billboard && !entity.point) continue;
        markers += 1;
        if (entity.point) bareDots += 1;
        const image = entity.billboard?.image?.getValue?.(time);
        if (image) images.add(String(image)); else imageless += 1;
      }
      out[layerId] = { markers, bareDots, imageless, images: [...images] };
    }
    return out;
  }, ids);
}

/**
 * Ask the manager to refresh these layers now.
 *
 * Their own cadences are 5 to 15 minutes — correct for registers that move in
 * weeks, and far too slow for a harness to wait on.
 */
async function refresh(page, ids) {
  await page.evaluate(async (layerIds) => {
    for (const id of layerIds) {
      try { await window.__godsEyeView.dataManager.refreshLayer(id); } catch { /* reported via stats */ }
    }
  }, ids);
}

/** Read every layer's entity count and stats in one pass. */
async function readLayers(page, ids) {
  return page.evaluate((layerIds) => {
    const app = window.__godsEyeView;
    const out = {};
    for (const id of layerIds) {
      const entry = app?.dataManager?.layers?.get(id);
      const source = app?.viewer?.dataSources?.getByName?.(id)?.[0] || null;
      let stats = null;
      try { stats = entry?.module?.getStats?.() ?? null; } catch { stats = null; }
      out[id] = {
        registered: Boolean(entry),
        enabled: entry?.enabled === true,
        entities: source ? source.entities.values.length : null,
        stats,
      };
    }
    return out;
  }, ids);
}

const failures = [];
const note = (ok, message) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

(async () => {
  if (!chrome) {
    console.error('No Chrome/Chromium binary found. Set PUPPETEER_EXECUTABLE_PATH.');
    process.exit(2);
  }
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: !HEADFUL,
    args: ['--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  try {
    const page = await newQaPage(browser);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });

    let booted = false;
    for (let i = 0; i < 90 && !booted; i += 1) {
      booted = await page.evaluate(() => Boolean(window.__godsEyeView?.dataManager));
      if (!booted) await sleep(1000);
    }
    if (!booted) throw new Error('App did not boot within 90 s');

    console.log('\n— registration —');
    const registered = await readLayers(page, LAYERS);
    for (const id of LAYERS) note(registered[id].registered, `${id} is registered`);

    console.log('\n— scanning the reference address —');
    await flyTo(page, CLOSE_VIEW);
    for (const id of LAYERS) {
      await page.evaluate((layerId) => window.__godsEyeView.dataManager.setEnabled(layerId, true), id);
    }
    // Six upstreams, one of them three CSV editions on a cold cache.
    for (let i = 0; i < 20; i += 1) {
      await refresh(page, LAYERS);
      const state = await readLayers(page, LAYERS);
      if (LAYERS.every((id) => (state[id].entities ?? 0) > 0)) break;
      await sleep(3000);
    }
    const scanned = await readLayers(page, LAYERS);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'address-close.png') });

    for (const id of LAYERS) {
      const layer = scanned[id];
      note((layer.entities ?? 0) > 0, `${id} drew ${layer.entities} entities (error: ${layer.stats?.error ?? 'none'})`);
      const centre = layer.stats?.scanCentre;
      if (centre) {
        const offset = Math.round(metresApart(ADDRESS, centre));
        note(offset <= 400, `${id} scanned within ${offset} m of the address`);
      }
    }

    console.log('\n— the honesty fields survive to the browser —');
    const dvf = scanned['dvf-sales'].stats || {};
    note(Number.isFinite(dvf.salesFound) && dvf.salesFound > 0, `DVF found ${dvf.salesFound} sales`);
    note(dvf.comparableCount <= dvf.salesFound,
      `DVF reports ${dvf.comparableCount} comparables of ${dvf.salesFound} sales`);
    note(Number.isFinite(dvf.medianPrixM2), `DVF median ${dvf.medianPrixM2} €/m²`);

    const dpe = scanned['dpe-fr'].stats || {};
    note(dpe.diagnosticsTotal >= dpe.diagnosticsServed,
      `DPE served ${dpe.diagnosticsServed} of ${dpe.diagnosticsTotal} diagnostics`);

    const gpu = scanned['urbanisme-gpu'].stats || {};
    note(typeof gpu.simplified === 'boolean', `GPU declares simplified=${gpu.simplified}`);
    note(Array.isArray(gpu.servitudeCodes), `GPU servitudes: ${(gpu.servitudeCodes || []).join(', ') || 'none'}`);

    const geo = scanned.georisques.stats || {};
    // Asserting on `available.report` and not merely on a finite count: an
    // earlier version of this check passed while the report endpoint was down,
    // because a degraded scan reports 0 risks and 0 is a perfectly finite
    // number. Géorisques resets the connection on roughly one call in four,
    // which is why the proxy retries — and why this check must be able to see
    // when the retry was not enough.
    note(geo.available?.report === true,
      `Géorisques report endpoint answered (available=${JSON.stringify(geo.available)})`);
    note(geo.naturalRisksPresent > 0,
      `Géorisques: ${geo.naturalRisksPresent} natural and ${geo.technologicalRisksPresent} technological risks present`);
    note(Array.isArray(geo.varyingByAddress),
      `Géorisques varies by address for: ${(geo.varyingByAddress || []).join(', ') || 'nothing'}`);
    // Radon is keyed by commune INSEE code, which the report does not supply at
    // arrondissement level — the proxy resolves it from the BAN so that one of
    // the statutory état-des-risques items is reachable from a bare coordinate.
    note(geo.available?.radon === true && Number.isFinite(geo.radonClass),
      `Géorisques radon class ${geo.radonClass} resolved without a caller-supplied INSEE code`);

    const idfm = scanned['idfm-network'].stats || {};
    note(idfm.liveVehicles === null && typeof idfm.liveVehicleNote === 'string',
      'IDFM reports its own live-vehicle absence rather than looking broken');
    note(Object.keys(idfm.byMode || {}).length > 0, `IDFM modes in view: ${JSON.stringify(idfm.byMode)}`);

    // The reported symptom, measured: "the dots move when I nudge the map".
    // `Cartesian3.fromDegrees(lon, lat)` puts a marker on the ELLIPSOID, and
    // the globe draws avenue de France at 79 to 83 m — so the marker was
    // eighty metres under its own street, painted anyway because depth testing
    // is off. A vertical error under an oblique camera is a HORIZONTAL error on
    // screen, and one that changes with every camera pose: measured at 83 px
    // head-on and 62 px sideways after a 35° turn. Nothing in the data or in
    // the entity count can see this, which is why it is measured here.
    console.log('\n— the markers are nailed to the ground, not to the ellipsoid —');
    await orbit(page, ADDRESS, 0, -35);
    let anchorA = {};
    for (let i = 0; i < 20; i += 1) {
      anchorA = await measureAnchor(page, LAYERS);
      // Terrain streams in after the markers do, and the re-seat is debounced;
      // give it the frames it needs rather than reading a half-loaded globe.
      if (LAYERS.every((id) => anchorA[id]?.length && worst(anchorA[id], 'heightErrorM') <= 1)) break;
      await pump(page, 3);
    }
    await orbit(page, ADDRESS, 40, -35);
    await pump(page, 6);
    const anchorB = await measureAnchor(page, LAYERS);

    for (const id of LAYERS) {
      const sampleA = anchorA[id] || [];
      const sampleB = anchorB[id] || [];
      if (!sampleA.length) {
        note(false, `${id}: no marker could be measured against the terrain`);
        continue;
      }
      // Guards the check against passing on a flat globe: on an ellipsoid-only
      // terrain provider every height is 0 and every marker is trivially right.
      const ground = Math.max(...sampleA.map((row) => row.groundM));
      note(ground > 1,
        `${id}: terrain under the markers reads ${ground.toFixed(1)} m, so this is a real measurement`);
      const heightError = worst(sampleA, 'heightErrorM');
      note(heightError <= 1,
        `${id}: worst of ${sampleA.length} markers stands ${heightError.toFixed(2)} m off the terrain`);
      const pixelsA = worst(sampleA, 'offsetPx');
      const pixelsB = worst(sampleB, 'offsetPx');
      note(pixelsA <= 2 && pixelsB <= 2,
        `${id}: marker sits ${pixelsA.toFixed(1)} px from its address head-on`
        + ` and ${pixelsB.toFixed(1)} px turned 40° — it does not slide`);
    }
    await page.screenshot({ path: path.join(SHOTS_DIR, 'address-anchored.png') });

    // Shape is the only channel left to say WHICH register a marker came from,
    // and it is the one the operator actually asked for: "on ne sait pas
    // qu'est-ce qui correspond à ce data layer et qu'est-ce qui correspond à
    // cet autre". Two layers that draw the same picture would pass every other
    // check in this file.
    console.log('\n— each register draws its own symbol —');
    const symbols = await readSymbols(page, LAYERS);
    const usedBy = new Map();
    for (const id of LAYERS) {
      const layer = symbols[id];
      note(layer.markers > 0, `${id} drew ${layer.markers} markers`);
      note(layer.bareDots === 0,
        `${id} draws symbols, not bare dots (${layer.bareDots} left)`);
      note(layer.imageless === 0 && layer.images.length > 0,
        `${id} carries ${layer.images.length} distinct symbol(s), ${layer.imageless} without one`);
      for (const image of layer.images) {
        usedBy.set(image, [...(usedBy.get(image) || []), id]);
      }
    }
    const shared = [...usedBy.values()].filter((owners) => owners.length > 1);
    note(shared.length === 0,
      shared.length
        ? `symbol collision between ${shared.map((o) => o.join(' + ')).join(', ')}`
        : 'no two registers draw the same symbol');
    // The DPE marker IS the label, so a street with several grades on it must
    // show several different markers. One image for 200 diagnostics would mean
    // the grade had quietly stopped reaching the glyph.
    note(symbols['dpe-fr'].images.length > 1,
      `DPE draws ${symbols['dpe-fr'].images.length} different grades as ${symbols['dpe-fr'].images.length} different markers`);
    note(symbols['dvf-sales'].images.length === 1,
      'every DVF sale draws the same euro sign — the price is in the tint, not the shape');

    console.log('\n— navigating re-scans on its own —');
    const before = await readLayers(page, LAYERS);
    await flyTo(page, SECOND_VIEW);
    // Deliberately NO refreshLayer() here: the point is that moving the camera
    // is enough. The manager's own tick is 5 minutes away.
    for (let i = 0; i < 25; i += 1) {
      const state = await readLayers(page, LAYERS);
      const moved = LAYERS.every((id) => {
        const centre = state[id].stats?.scanCentre;
        return centre && metresApart(SECOND_ADDRESS, centre) < 400;
      });
      if (moved) break;
      await sleep(1000);
    }
    const after = await readLayers(page, LAYERS);
    for (const id of LAYERS) {
      const centre = after[id].stats?.scanCentre;
      const previous = before[id].stats?.scanCentre;
      if (!centre) { note(false, `${id}: no scan centre after navigating`); continue; }
      const offset = Math.round(metresApart(SECOND_ADDRESS, centre));
      note(offset <= 400,
        `${id} re-scanned ${offset} m from the new address without a forced refresh`
        + (previous ? ` (was ${Math.round(metresApart(SECOND_ADDRESS, previous))} m away)` : ''));
      note((after[id].entities ?? 0) > 0, `${id} drew ${after[id].entities} entities at the new address`);
    }

    console.log('\n— clicking a marker opens a card —');
    await flyTo(page, CLOSE_VIEW);
    for (let i = 0; i < 20; i += 1) {
      const state = await readLayers(page, LAYERS);
      if (LAYERS.every((id) => (state[id].entities ?? 0) > 0
        && metresApart(ADDRESS, state[id].stats?.scanCentre || { lat: 0, lon: 0 }) < 400)) break;
      await sleep(1000);
    }
    for (const id of LAYERS) {
      const clickable = (await readLayers(page, [id]))[id].stats?.clickableCount ?? 0;
      note(clickable > 0, `${id} indexed ${clickable} clickable markers`);
    }
    // Pick through the scene rather than by screen coordinates: a marker's
    // pixel position depends on terrain and tiles, and a miss would read as a
    // broken click handler rather than as a bad guess by the harness.
    // Real input through CDP, not a synthetic MouseEvent. Cesium's
    // ScreenSpaceEventHandler pairs a pointerdown with a pointerup and tracks
    // pointer identity; hand-dispatched events satisfy neither, so an earlier
    // version of this check reported every layer as unclickable while the
    // handlers were in fact working. `page.mouse` with explicit coordinates
    // needs no layout round trip, unlike `page.click`.
    const clicked = {};
    for (const id of LAYERS) {
      const target = await page.evaluate((layerId) => {
        const gev = window.__godsEyeView;
        const source = gev.viewer.dataSources.getByName(layerId)?.[0];
        const scene = gev.viewer.scene;
        const time = gev.viewer.clock.currentTime;
        const canvas = scene.canvas;
        const rect = canvas.getBoundingClientRect();
        const onScreen = (position) => {
          if (!position) return null;
          const screen = scene.cartesianToCanvasCoordinates(position);
          if (!screen) return null;
          if (screen.x < 4 || screen.y < 4) return null;
          if (screen.x > canvas.clientWidth - 4 || screen.y > canvas.clientHeight - 4) return null;
          return { x: rect.left + screen.x, y: rect.top + screen.y };
        };
        for (const entity of source?.entities?.values || []) {
          const point = onScreen(entity.position?.getValue?.(time));
          if (point) return { entityId: entity.id, ...point };
          // A zoning ring can be kilometres across while the camera sees a
          // block, so its MIDPOINT is usually off-canvas even though the line
          // crosses the view. Scan the vertices for one that is actually
          // visible instead of assuming the middle of the ring is.
          const ring = entity.polyline?.positions?.getValue?.(time);
          if (!Array.isArray(ring)) continue;
          for (const vertex of ring) {
            const hit = onScreen(vertex);
            if (hit) return { entityId: entity.id, ...hit };
          }
        }
        return null;
      }, id);
      if (!target) { clicked[id] = { attempted: false }; continue; }
      await page.mouse.click(target.x, target.y);
      await sleep(350);
      const after = await page.evaluate(
        (layerId) => window.__godsEyeView.dataManager.layers.get(layerId)?.module?.getStats?.()?.selectedId ?? null,
        id,
      );
      clicked[id] = { attempted: true, dispatched: true, entityId: target.entityId, after };
    }
    for (const id of LAYERS) {
      const result = clicked[id];
      note(Boolean(result?.attempted), `${id}: found an on-screen marker to click`);
      if (!result?.attempted) continue;
      // Selection of SOMETHING in this layer, not of the exact marker aimed at:
      // 200 diagnostics inside 200 m overlap heavily, so which of two markers
      // sharing a pixel wins is a Cesium depth detail, not a contract. What
      // must hold is that a click on a marker selects a marker.
      const ENTITY_PREFIX = {
        georisques: 'georisques:', 'dvf-sales': 'dvf:', 'dpe-fr': 'dpe:',
        'urbanisme-gpu': 'gpu:', 'idfm-network': 'idfm:',
      };
      const prefix = ENTITY_PREFIX[id];
      note(typeof result.after === 'string' && result.after.startsWith(prefix),
        `${id} click selected ${result.after ?? 'nothing'} (aimed at ${result.entityId})`);
    }
    const painted = await page.evaluate(() => window.__gevWorldOverlay?.getDiagnostics?.()?.paintedBySource || {});
    console.log(`  ·    overlay cards painted: ${JSON.stringify(painted)}`);
    // The selection card must reach the SCREEN, not merely the layer's state:
    // `selectedId` can be set while the overlay paints nothing.
    note(Object.keys(painted).length > 0, `a selection card was painted (${JSON.stringify(painted)})`);

    console.log('\n— dormancy above the ceiling —');
    await flyTo(page, REGION_VIEW);
    for (let i = 0; i < 10; i += 1) {
      await refresh(page, LAYERS);
      const state = await readLayers(page, LAYERS);
      if (LAYERS.every((id) => state[id].stats?.dormant === true)) break;
      await sleep(1500);
    }
    const high = await readLayers(page, LAYERS);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'address-region.png') });
    for (const id of LAYERS) {
      const layer = high[id];
      note(layer.stats?.dormant === true && (layer.entities ?? 0) === 0,
        `${id} is dormant and cleared at 60 km (dormant=${layer.stats?.dormant}, entities=${layer.entities})`);
    }

    console.log(`\nScreenshots: ${SHOTS_DIR}`);
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
