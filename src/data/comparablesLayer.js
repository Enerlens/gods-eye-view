import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';
import { clampDvfRadius } from './dvfFeed.js';
import { mountComparablesPanel } from './comparablesPanel.js';
import {
  CANDIDATE_LIMIT,
  ageDays,
  agree,
  comparableFromDvfSale,
  comparableLines,
  distanceMetres,
  dossierLines,
  dossierSummary,
  emptyDossier,
  loadDossier,
  mergeComparables,
  normaliseComparable,
  saveDossier,
} from './comparablesDossier.js';

/**
 * Comparables — the dossier a valuation note is written from, and the map of it.
 *
 * WHY THIS LAYER EXISTS AT ALL. `docs/CITYSCAN.md` took the competitor apart
 * and found that the one module we had nothing for — comparables — is not a
 * data problem. Their own public translation file names its source:
 * « Sélection de votre conseiller(ère) parmi les portails d'annonces ». There
 * is no listing database behind that screen. There is a screen. So this layer
 * is the screen, plus the two things the competitor's version does not do:
 * it never averages an asking price with a sale, and it never prints a number
 * without the sample it came from.
 *
 * NOTHING IS BOUGHT AND NOTHING IS SCRAPED. Owner decision, 2026-09-08: this
 * fork is going open source, so a paid listing feed (Yanport, PriceHubble,
 * Casafari) is out — a licence nobody who clones the repository could exercise
 * is not a dependency, it is a wall. Extraction is out for a harder reason,
 * with a price list attached: see the jurisprudence recorded in
 * `comparablesDossier.js`. What is left is what the competitor actually does,
 * and it costs nothing: the advisor chooses.
 *
 * ── HOW IT IS BUILT, AND WHY ON THE ADDRESS-SCAN SHELL ─────────────────────
 *
 * The shell does four things this layer would otherwise have to reinvent
 * badly: it seats markers on the terrain the globe is DRAWING (the 83-pixel
 * parallax `addressScanLayer.js` documents), it owns the click that opens a
 * card, it gates on altitude, and it holds a SCAN PIN. That last one is the
 * whole reason the fit is exact: a dossier belongs to one property, not to
 * wherever the camera drifted to, and `setScanPin()` is the mechanism that was
 * already there for it. Before a property is posed the layer follows the
 * camera and offers whatever DVF sells around the look-at point; the moment
 * one is posed, the scan pins to it and stops moving — including above the
 * altitude ceiling, which a pinned scan is exempt from, because a dossier is
 * not something that should disappear when you pull back to see the city.
 *
 * THE VIRTUAL ENDPOINT AND THE ONE REQUEST IT MAKES. `gev:comparables` is not
 * a route; {@link comparablesFetch} intercepts it, the way the fiche's does.
 * It fetches `/api/dvf` around the scan point and joins the dossier held in
 * this module. Editing the dossier changes the fetch's query string — the
 * revision counter is in it — which is what makes the shell redraw, because
 * its guard compares that string. The DVF half is memoised per point and
 * radius, so twelve edits in a row cost one request and eleven joins.
 *
 * ── WHAT IS DRAWN, AND WHAT IS DELIBERATELY NOT ────────────────────────────
 *
 * Drawn: the property, the retained comparables, and a line from the property
 * to each of them. That IS the dossier — a reader sees the sample the estimate
 * was built on, and how far it had to reach.
 *
 * NOT drawn: the candidate sales. The DVF layer next door already draws
 * exactly those mutations, coloured by what they say about the local market,
 * and drawing them again here in a second colour would put the same fact on
 * screen twice in two encodings — A3, one channel one information, at the
 * scale of the map rather than of a symbol. The pool is a list in the panel;
 * the map is the selection.
 *
 * THE TWO CHANNELS ON A MARKER, and they are orthogonal by construction:
 *
 *   · SHAPE and COLOUR say which instrument measured it. A retained mutation
 *     keeps the euro sign the DVF layer wears, because it IS that register; a
 *     keyed-in listing wears the price tag added to `addressMarkerIcons.js`
 *     for it. An intention and an observation never draw the same picture.
 *   · ALPHA says how old the measurement is (A2), floor at
 *     {@link OLDEST_ALPHA} so nothing ever fades to invisible.
 *
 * And a comparable whose date is UNKNOWN is not quietly given the oldest
 * alpha and left to look like a two-year-old sale: its connector is DASHED.
 * A1 names the remedy — « glyphe fantôme, contour pointillé, mention
 * explicite » — and a dashed line is the one this layer can afford.
 *
 * @module data/comparablesLayer
 */

/** Layer id — share-link registry key and taxonomy key. */
export const COMPARABLES_LAYER_ID = 'comparables-fr';
export const COMPARABLES_LAYER_NAME = 'Comparables (sélection conseiller)';

/** A virtual endpoint. No server serves it; {@link comparablesFetch} answers. */
const VIRTUAL_ENDPOINT = 'gev:comparables';

/** Refresh cadence. A dossier moves when its owner edits it, not on a clock. */
const UPDATE_INTERVAL_MS = 900_000;

/**
 * Radius the candidate scan covers, in metres.
 *
 * Wider than the DVF layer's own 300 m, because the question is different: the
 * map layer answers "what did this block trade at" and this one answers "what
 * may I compare this flat to", and a comparable five streets away is still a
 * comparable. Capped by `clampDvfRadius` at the proxy's own ceiling.
 */
export const CANDIDATE_RADIUS_M = 500;

/** Ceiling for the UNPINNED scan. A posed property is exempt — see the header. */
const MAX_ALTITUDE_M = 12_000;

/** A sale that was observed. The register's own instrument. */
export const VENTE_COLOR = '#3ce0c8';
/** A price that is being asked. Never the same sign as one that was paid. */
export const ANNONCE_COLOR = '#ff9f45';
/** The property under study. */
export const SUBJECT_COLOR = '#f4f7fb';

/** Alpha floor for the oldest comparable, and for one with no date at all. */
export const OLDEST_ALPHA = 0.5;
/** Age at which a comparable reaches {@link OLDEST_ALPHA}, in days. */
export const OLDEST_DAYS = 730;

/** @type {object} The dossier, held here and mirrored in localStorage. */
let _dossier = emptyDossier();

/**
 * Bumped on every edit.
 *
 * It travels in the fetch's query string, which is the only lever this module
 * has on the shell's redraw guard: the guard compares the query string and the
 * scan centre, and an edit moves neither on its own.
 */
let _revision = 0;

/** @type {?object} The mounted panel controller. */
let _panel = null;

/** @type {?object} Memoised DVF answer, keyed by point and radius. */
let _dvfMemo = null;

/**
 * The candidate pool of the last completed scan.
 *
 * The shell hands the payload to `render` and keeps it to itself, and the
 * panel needs the same list — so the fetch publishes it here as it returns.
 * Written in one place and read in one place, which is what keeps the list in
 * the panel and the markers on the map describing the same scan.
 *
 * @type {Array<object>}
 */
let _candidates = [];

/** @type {?object} The viewer, for the panel's "centre of the view" button. */
let _viewer = null;

/**
 * The manager's repaint callback for this layer's row.
 *
 * Needed, and the browser harness is what showed why: the map key is rendered
 * when the row is drawn, and a dossier edit changes what it SAYS — the sample
 * sizes beside each of the two medians — without the manager having any reason
 * to repaint. Measured over Lyon: three retained sales and a listing, and a key
 * still reading « Ventes actées 0 · Annonces saisies 0 ». A legend that lags
 * the map is doctrine D1 broken quietly.
 *
 * @type {?Function}
 */
let _rowControlsListener = null;

/**
 * How faded a comparable is drawn, by the age of what it measured.
 *
 * Linear to {@link OLDEST_DAYS}, then flat. A null date is drawn at the floor
 * AND gets a dashed connector, because looking like the oldest sale on screen
 * without saying why is exactly the substitution A1 forbids.
 *
 * @param {?number} days
 * @returns {number} 0.5 to 1.
 */
export function ageAlpha(days) {
  if (!Number.isFinite(days)) return OLDEST_ALPHA;
  const share = Math.min(1, Math.max(0, days / OLDEST_DAYS));
  return 1 - (1 - OLDEST_ALPHA) * share;
}

/** Read a coordinate from a query, treating ABSENT as absent — see the fiche. */
function coordinate(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  return Number(value);
}

/**
 * The composing fetch: the sales around the point, joined to the dossier.
 *
 * A failure of the DVF half is NOT a failure of the layer. The dossier is the
 * product and it is local; a silent register costs the reader the candidate
 * list and nothing else, so the payload carries `candidatesMissing` and the
 * panel says so where the list would have been.
 *
 * @param {string} url The virtual URL the shell built.
 * @param {{signal?: AbortSignal}} [options]
 * @param {{impl?: typeof fetch}} [seams] Test seam.
 * @returns {Promise<object>} A Response-shaped object.
 */
export async function comparablesFetch(url, options = {}, { impl = fetch } = {}) {
  const query = new URLSearchParams(String(url).split('?')[1] || '');
  const lat = coordinate(query.get('lat'));
  const lon = coordinate(query.get('lon'));
  const radiusM = clampDvfRadius(query.get('radius') ?? CANDIDATE_RADIUS_M);
  const signal = options.signal ?? null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, status: 400, json: async () => ({ error: 'lat and lon are required' }) };
  }

  const memoKey = `${lat.toFixed(5)}|${lon.toFixed(5)}|${radiusM}`;
  let dvf = _dvfMemo && _dvfMemo.key === memoKey ? _dvfMemo.payload : null;
  let asked = false;
  if (!dvf) {
    asked = true;
    try {
      const response = await impl(
        `/api/dvf?lat=${lat}&lon=${lon}&radius=${radiusM}`,
        signal ? { signal } : undefined,
      );
      const payload = response?.ok ? await response.json() : null;
      dvf = payload && !payload.error ? payload : null;
    } catch {
      // An abort is the camera moving on; a failure is a register that did not
      // answer. Both leave the dossier untouched, which is the point.
      dvf = null;
    }
    if (dvf) _dvfMemo = { key: memoKey, payload: dvf };
  }

  const known = new Set((_dossier.comparables ?? []).map((entry) => entry.id));
  const sales = Array.isArray(dvf?.sales) ? dvf.sales : [];
  const candidates = sales
    .map((sale) => comparableFromDvfSale(sale))
    .filter(Boolean)
    .map((entry) => ({ ...entry, distanceM: distanceMetres({ lat, lon }, entry), already: known.has(entry.id) }))
    .slice(0, CANDIDATE_LIMIT);
  _candidates = candidates;

  return {
    ok: true,
    status: 200,
    json: async () => ({
      point: { lat, lon },
      radiusM,
      // The dossier travels IN the payload so `summarize()` stays a pure
      // function of what it is handed, which is what the shell's stats read.
      dossier: _dossier,
      candidates,
      // A5, at the scale of a list: the panel prints both numbers and the
      // criterion, so nobody reads 24 of 60 as 60.
      candidateTotal: sales.length,
      candidatesMissing: !dvf,
      candidatesFresh: asked,
      commune: dvf?.commune?.nom ?? dvf?.commune?.name ?? null,
      reference: dvf?.summary?.reference ?? null,
    }),
  };
}

/**
 * Draw the dossier.
 *
 * Exported for the test that reads the two doctrine claims back off the
 * entities: that a listing and a sale never draw the same picture, and that an
 * unknown date is a dashed connector rather than a quiet alpha.
 *
 * @param {object} input
 * @returns {number} Entities drawn.
 */
export function renderComparables({ payload, dataSource, viewer }) {
  const classificationType = viewer?.scene?.globe?.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
  const dossier = payload.dossier ?? emptyDossier();
  const subject = dossier.subject ?? null;
  let drawn = 0;

  if (subject && Number.isFinite(subject.lat) && Number.isFinite(subject.lon)) {
    dataSource.entities.add({
      id: 'comparables:bien',
      position: Cesium.Cartesian3.fromDegrees(subject.lon, subject.lat),
      billboard: {
        image: addressMarkerGlyph('target'),
        width: 30,
        height: 30,
        color: Cesium.Color.fromCssColorString(SUBJECT_COLOR),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { kind: 'comparables-bien' },
      name: subject.label || 'Bien étudié',
      description: dossierLines(dossier).join(' · '),
    });
    drawn += 1;
  }

  for (const entry of dossier.comparables ?? []) {
    if (entry.retained === false) continue;
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lon)) continue;
    const days = ageDays(entry.date);
    const dated = Number.isFinite(days);
    const colour = Cesium.Color.fromCssColorString(
      entry.kind === 'vente' ? VENTE_COLOR : ANNONCE_COLOR,
    );
    const card = comparableLines(entry, subject);
    dataSource.entities.add({
      id: `comparables:${entry.id}`,
      position: Cesium.Cartesian3.fromDegrees(entry.lon, entry.lat),
      billboard: {
        image: addressMarkerGlyph(entry.kind === 'vente' ? 'euro' : 'tag'),
        width: 24,
        height: 24,
        color: colour.withAlpha(ageAlpha(days)),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { kind: `comparables-${entry.kind}` },
      name: card.title,
      description: card.details.join(' · '),
    });
    drawn += 1;

    if (subject && Number.isFinite(subject.lat) && Number.isFinite(subject.lon)) {
      const positions = [
        Cesium.Cartesian3.fromDegrees(subject.lon, subject.lat),
        Cesium.Cartesian3.fromDegrees(entry.lon, entry.lat),
      ];
      // Dashed when the age is UNKNOWN, solid when it is known. The alpha
      // above already says HOW old; this says whether that is a measurement or
      // a default — two informations, two channels.
      const material = dated
        ? new Cesium.ColorMaterialProperty(colour.withAlpha(0.45))
        : new Cesium.PolylineDashMaterialProperty({
          color: colour.withAlpha(0.45),
          dashLength: 12,
        });
      dataSource.entities.add({
        id: `comparables:link:${entry.id}`,
        polyline: {
          positions,
          width: 2,
          material,
          clampToGround: true,
          classificationType,
        },
      });
      drawn += 1;
    }
  }
  return drawn;
}

/**
 * The map key: two rows, and they ARE the layer's argument.
 *
 * What was paid and what is being asked, each with the size of its own sample
 * — because a median printed without the count behind it is the one number a
 * valuation reader will quote and cannot check. Pure and exported so the
 * wording is tested rather than eyeballed.
 *
 * @param {object} summary Output of the layer's `summarize()`.
 * @returns {Array<object>} Legend entries, in the panel's own shape.
 */
export function comparablesLegend(summary) {
  const euros = (value) => new Intl.NumberFormat('fr-FR').format(Math.round(value));
  const on = (n) => `${n} ${agree(n, 'comparable')}`;
  return [
    {
      label: 'Ventes actées (DVF)',
      color: VENTE_COLOR,
      count: summary?.ventes ?? 0,
      blurb: summary?.medianVentes
        ? `${euros(summary.medianVentes)} €/m² médian sur ${on(summary.ventesWithRatio)}.`
        : 'Mutations retenues dans le dossier — prix observés, source DGFiP.',
    },
    {
      label: 'Annonces saisies',
      color: ANNONCE_COLOR,
      count: summary?.annonces ?? 0,
      blurb: summary?.medianAnnonces
        ? `${euros(summary.medianAnnonces)} €/m² médian demandé sur ${on(summary.annoncesWithRatio)}.`
        : 'Annonces relevées à la main — prix demandés, jamais collectés.',
    },
  ];
}

const base = createAddressScanLayer({
  id: COMPARABLES_LAYER_ID,
  name: COMPARABLES_LAYER_NAME,
  icon: '⚖',
  source: 'DGFiP DVF · saisie conseiller',
  endpoint: VIRTUAL_ENDPOINT,
  updateInterval: UPDATE_INTERVAL_MS,
  maxAltitudeM: MAX_ALTITUDE_M,
  // The revision is in the query string on purpose — it is the only thing that
  // tells the shell's guard that the ANSWER changed while the question did not.
  params: () => ({ radius: String(CANDIDATE_RADIUS_M), rev: String(_revision) }),
  fetchImpl: (url, options) => comparablesFetch(url, options),
  redrawOnMapStack: true,

  render: renderComparables,

  summarize(payload) {
    const summary = dossierSummary(payload.dossier ?? emptyDossier());
    return {
      subjectLabel: summary.subject?.label ?? null,
      retained: summary.retained,
      total: summary.total,
      ventes: summary.ventes.count,
      ventesWithRatio: summary.ventes.withRatio,
      medianVentes: summary.ventes.median,
      annonces: summary.annonces.count,
      annoncesWithRatio: summary.annonces.withRatio,
      medianAnnonces: summary.annonces.median,
      gapPercent: summary.gapPercent,
      basis: summary.basis,
      estimate: summary.estimate,
      unplaced: summary.unplaced,
      candidates: Array.isArray(payload.candidates) ? payload.candidates.length : 0,
      candidateTotal: payload.candidateTotal ?? 0,
      candidatesMissing: Boolean(payload.candidatesMissing),
    };
  },

  rowControls(_runtime, summary) {
    return summary ? { legend: comparablesLegend(summary) } : null;
  },
});

// ---------------------------------------------------------------------------
// The dossier's edit surface — everything the panel is allowed to do
// ---------------------------------------------------------------------------

/**
 * Push the dossier to storage, to the panel and to the map.
 *
 * The panel is repainted TWICE and both are needed. Once immediately, so the
 * row a reader just added appears under their cursor rather than after a round
 * trip; once when the rescan lands, because the candidate pool's "already in
 * the dossier" flags are computed inside the fetch. Without the second pass a
 * retained sale kept its `+` button, a second click found the sale already
 * there and did nothing, and the panel looked broken — measured in the browser
 * harness, which retained one of the three it asked for.
 */
function commit(next) {
  _dossier = next;
  _revision += 1;
  const saved = saveDossier(_dossier);
  _panel?.setDossier(_dossier, { saved });
  void base.update().then(() => {
    _panel?.setCandidates(actions.candidates());
    _panel?.setDossier(_dossier, { saved });
    _rowControlsListener?.();
  });
  return saved;
}

/** The handlers the panel drives the layer with. */
const actions = {
  /** Pose the property under study, and pin the candidate scan to it. */
  setSubject(subject) {
    if (!subject || !Number.isFinite(subject.lat) || !Number.isFinite(subject.lon)) return false;
    commit({
      ..._dossier,
      subject: {
        label: subject.label ?? null,
        commune: subject.commune ?? null,
        lat: subject.lat,
        lon: subject.lon,
        surface: subject.surface ?? _dossier.subject?.surface ?? null,
        rooms: subject.rooms ?? _dossier.subject?.rooms ?? null,
        type: subject.type ?? _dossier.subject?.type ?? null,
      },
    });
    // The scan follows the property from here on. A dossier that re-listed its
    // candidates every time the camera drifted would be a different dossier
    // each time it was opened.
    base.setScanPin({ lat: subject.lat, lon: subject.lon });
    return true;
  },

  /** Edit the property's own characteristics — the surface the estimate needs. */
  updateSubject(fields) {
    if (!_dossier.subject) return false;
    commit({ ..._dossier, subject: { ..._dossier.subject, ...fields } });
    return true;
  },

  /** Retain a comparable — a DVF candidate, or a listing typed into the form. */
  add(raw) {
    const entry = normaliseComparable(raw);
    if (!entry) return false;
    const { dossier, added } = mergeComparables(_dossier, [entry]);
    if (!added) return false;
    commit(dossier);
    return true;
  },

  /** Toggle a comparable in or out of the estimate, keeping it in the dossier. */
  toggle(id) {
    const comparables = (_dossier.comparables ?? []).map((entry) => (
      entry.id === id ? { ...entry, retained: entry.retained === false } : entry
    ));
    commit({ ..._dossier, comparables });
    return true;
  },

  /** Drop a comparable for good. */
  remove(id) {
    commit({
      ..._dossier,
      comparables: (_dossier.comparables ?? []).filter((entry) => entry.id !== id),
    });
    return true;
  },

  /** Replace the whole dossier — the import path, and the empty-it path. */
  replace(dossier) {
    commit(dossier ?? emptyDossier());
    if (dossier?.subject) base.setScanPin({ lat: dossier.subject.lat, lon: dossier.subject.lon });
    else base.setScanPin(null);
    return true;
  },

  /** The ground point the camera is looking at, for "pose the view's centre". */
  cameraPoint() {
    const canvas = _viewer?.scene?.canvas;
    const width = canvas?.clientWidth || canvas?.width || 0;
    const height = canvas?.clientHeight || canvas?.height || 0;
    if (!width || !height) return null;
    const camera = _viewer?.camera;
    const hit = camera?.pickEllipsoid?.(
      new Cesium.Cartesian2(width / 2, height / 2), Cesium.Ellipsoid.WGS84,
    );
    if (!hit) return null;
    const carto = Cesium.Cartographic.fromCartesian(hit);
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
  },

  /** Fly the camera onto a comparable the reader clicked in the list. */
  lookAt(entry) {
    if (!_viewer?.camera || !Number.isFinite(entry?.lat) || !Number.isFinite(entry?.lon)) return false;
    _viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(entry.lon, entry.lat, 600),
      duration: 1.2,
    });
    return true;
  },

  /** The candidates the last scan offered, for the panel's pool list. */
  candidates() {
    const stats = base.getStats();
    return {
      list: _candidates,
      total: stats.candidateTotal ?? 0,
      missing: Boolean(stats.candidatesMissing),
      radiusM: CANDIDATE_RADIUS_M,
    };
  },
};

/** Mount the dossier panel, once. */
function ensurePanel() {
  if (_panel) return;
  _panel = mountComparablesPanel(actions);
  _panel?.setDossier(_dossier, { saved: true });
  _panel?.setCandidates(actions.candidates());
}

function destroyPanel() {
  _panel?.destroy?.();
  _panel = null;
}

/**
 * The layer, wrapping the shell with the dossier it draws.
 *
 * Spread rather than subclassed, for the reason the fiche records: every
 * method the factory returns is a closure over its own state and none reads
 * `this`.
 */
const comparablesLayer = {
  ...base,

  init(viewer) {
    _viewer = viewer;
    _dossier = loadDossier();
    base.init(viewer);
    // A dossier restored from a previous session already knows its property,
    // so the scan is pinned before the first tick rather than after it.
    if (_dossier.subject) base.setScanPin({ lat: _dossier.subject.lat, lon: _dossier.subject.lon });
  },

  enable(viewer) {
    if (viewer) _viewer = viewer;
    base.enable(viewer);
    ensurePanel();
  },

  disable(viewer) {
    destroyPanel();
    base.disable(viewer);
  },

  destroy(viewer) {
    destroyPanel();
    base.destroy(viewer);
  },

  /**
   * The manager pushes a repaint callback here so the row can update outside
   * its own refresh tick — which is exactly what an edited dossier needs.
   * @param {?Function} listener
   */
  setRowControlsListener(listener) {
    _rowControlsListener = typeof listener === 'function' ? listener : null;
    base.setRowControlsListener?.(listener);
  },

  async update(viewer, options) {
    const ok = await base.update(viewer, options);
    // The panel is redrawn from the scan that just landed rather than from the
    // one that triggered it: the candidate pool and the map have to agree, and
    // the pool is only final once the fetch has resolved.
    _panel?.setCandidates(actions.candidates());
    _panel?.setDossier(_dossier, { saved: true });
    _rowControlsListener?.();
    return ok;
  },

  getStats() {
    const stats = base.getStats();
    const result = {
      ...stats,
      feedSource: 'DGFiP DVF (candidats) · dossier local, jamais transmis',
    };
    if (stats.dormant) {
      result.status = 'ok';
      result.loadingLabel = `Descends sous ${Math.round(MAX_ALTITUDE_M / 1000)} km, `
        + 'ou pose le bien pour épingler le dossier';
    } else if (!stats.subjectLabel) {
      result.loadingLabel = 'Aucun bien posé — ouvre le dossier pour en poser un';
    } else if (stats.candidatesMissing) {
      result.degraded = true;
      result.loadingLabel = 'DVF muet — le dossier est intact, la liste de candidats est vide';
    }
    return result;
  },
};

/** Reset module state. Test seam — there is one dossier per running app. */
export function _resetComparablesForTest(dossier = emptyDossier()) {
  _dossier = dossier;
  _revision += 1;
  _dvfMemo = null;
  _candidates = [];
}

/** The dossier currently held. Test seam. */
export function _comparablesDossierForTest() {
  return _dossier;
}

export default comparablesLayer;
