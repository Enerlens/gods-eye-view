import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';
import { equivalentRadiusM } from './isochroneFeed.js';
import { zoneApprovalDate } from './urbanismeGpu.js';
import { resolutionForBox } from './filosofiFeed.js';
import {
  aggregateInRing,
  bracketWidthPercent,
  composeFiche,
  projectAddress,
  projectMarket,
  projectZoning,
  ringBounds,
} from './implantationFeed.js';

/**
 * Fiche implantation — the one card a geomarketing tool exists to print.
 *
 * WHAT IT ANSWERS. Click a door. How many people live within ten minutes' walk
 * of it, what do they earn, what may be built on the plot, and what did the
 * ground around it last sell for. Every half of that is already in this
 * repository — `isochrone-fr` has the reachable shape, `filosofi-fr` has who
 * lives in every 200 m square, the urbanism layer has the zoning, DVF has the
 * sales — and nothing has ever joined them. The join IS the product.
 *
 * THE HEADLINE IS A BRACKET, NOT A NUMBER. A 200 m square either sits inside
 * the ring, outside it, or across its edge. Every commercial tool picks a
 * convention and prints one figure; this one prints the centroid count with the
 * two countable bounds around it — the population of the squares ENTIRELY
 * inside, and of every square the ring TOUCHES. `implantationFeed.js` carries
 * the reasoning; the consequence on screen is that a reader sees how much of
 * the answer is boundary. Areal interpolation would have produced a tidier
 * number by assuming people are spread evenly inside a square, which is exactly
 * what INSEE's own imputation flag exists to deny.
 *
 * WHY IT COMPOSES IN THE BROWSER AND ADDS NO PROXY. The four sources it needs
 * are four routes this server already has, already cached, already tested —
 * `/api/isochrone`, `/api/filosofi/carreaux`, `/api/gpu`, `/api/dvf`. A fifth
 * route would have to duplicate their load logic server-side and would miss
 * their caches. So the layer fans out across them in parallel and does the join
 * locally: the join is arithmetic over data the browser already has, and it is
 * pure and unit-tested. The shared address-scan factory takes a `fetchImpl`
 * seam, and this is what that seam is for.
 *
 * WALKING ONLY, AND THREE DURATIONS. A catchment brief is written in walking
 * minutes — "dix minutes à pied" — so the chips are 5, 10 and 15, and the
 * driving ring stays the isochrone layer's own control. One ring per scan, so
 * the fiche costs one isochrone call rather than three.
 *
 * @module data/implantationFiche
 */

/** Layer id — share-link registry key and voice-tool enum value. */
export const FICHE_LAYER_ID = 'implantation-fr';
export const FICHE_LAYER_NAME = 'Fiche implantation';

/**
 * A VIRTUAL endpoint. No server serves this path: the composing fetch below
 * intercepts it, and the string exists only so the factory has something to
 * put its query parameters on and to key its change detection with.
 */
const VIRTUAL_ENDPOINT = 'gev:fiche';

/** Refresh cadence. Registers move in months; this is about camera movement. */
const UPDATE_INTERVAL_MS = 900_000;

/**
 * Same ceiling as the isochrone layer, and for the same reason: below a ring
 * the size of a few pixels there is nothing to read, and a fiche computed on a
 * shape nobody can see is a number with no picture behind it.
 */
const MAX_ALTITUDE_M = 8_000;

/** Radius the market half scans, in metres. Matches the DVF layer's own. */
const DVF_RADIUS_M = 300;

/** The durations a catchment brief is written in. */
export const FICHE_STEPS = Object.freeze([300, 600, 900]);
/** The one the layer opens on. Ten minutes is the retail default. */
export const FICHE_DEFAULT_SECONDS = 600;

/** @type {number} The ring the fiche is currently computed on. */
let _seconds = FICHE_DEFAULT_SECONDS;

const SELECTED_COLOR = '#ffd166';

/**
 * Resolve a requested duration to one the layer offers.
 * @param {unknown} value
 * @returns {number|null}
 */
export function resolveSeconds(value) {
  const parsed = Number(value);
  return FICHE_STEPS.includes(parsed) ? parsed : null;
}

/** Minutes, as a reader says them. */
export function minutesLabel(seconds) {
  return Number.isFinite(seconds) ? `${Math.round(seconds / 60)} min` : '—';
}

const _fr = new Intl.NumberFormat('fr-FR');

/**
 * Clip a free-text label to something a card line can hold.
 *
 * At the first sentence boundary where there is one, then hard at 90
 * characters. The ellipsis is not decoration: a clipped label that does not
 * say it was clipped invites the reader to treat a fragment as the whole rule.
 * @param {?string} text
 * @param {number} [max]
 * @returns {string}
 */
export function clipLabel(text, max = 90) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const stop = clean.slice(0, max + 1).lastIndexOf('.');
  if (stop > 24) return clean.slice(0, stop + 1);
  const space = clean.slice(0, max).lastIndexOf(' ');
  return `${clean.slice(0, space > 24 ? space : max)}…`;
}

/** @param {?number} value */
function count(value) {
  return Number.isFinite(value) ? _fr.format(Math.round(value)) : '—';
}

/**
 * Read a coordinate from a query, treating ABSENT as absent.
 *
 * See `ficheFetch` for why this cannot be a bare `Number()`.
 * @param {unknown} value
 * @returns {number} The coordinate, or NaN when nothing usable was given.
 */
function coordinate(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  return Number(value);
}

/**
 * Fetch one of the app's own routes, tolerating a half that does not answer.
 *
 * Resolves to null rather than throwing, for every failure: HTTP error, network
 * error, unparseable body, or a payload carrying an `error` field. Every caller
 * treats a null as "this half of the fiche is missing" and says so on the card,
 * which is only safe because the failure cannot arrive as an exception from
 * somewhere else.
 *
 * @param {string} url
 * @param {AbortSignal|null} signal
 * @param {typeof fetch} [impl]
 * @returns {Promise<object|null>}
 */
export async function fetchPart(url, signal, impl = fetch) {
  try {
    const response = await impl(url, signal ? { signal } : undefined);
    if (!response?.ok) return null;
    const payload = await response.json();
    if (!payload || payload.error) return null;
    return payload;
  } catch (error) {
    // An abort is the camera moving on, not a source failing; it still reads as
    // "missing" here, and the scan it belonged to is discarded by the factory.
    return null;
  }
}

/**
 * The composing fetch: four routes in parallel, joined into one fiche.
 *
 * The carroyage request is derived FROM the isochrone, not from the camera: the
 * box that matters is the one the ring occupies, and asking for the viewport
 * instead would fetch squares the ring cannot contain while missing the ones it
 * spills onto off-screen. That ordering is why the isochrone is awaited first
 * and the other three are fanned out after it.
 *
 * @param {string} url The virtual URL the factory built.
 * @param {{signal?: AbortSignal}} [options]
 * @param {{impl?: typeof fetch}} [seams] Test seam.
 * @returns {Promise<object>} A Response-shaped object.
 */
export async function ficheFetch(url, options = {}, { impl = fetch } = {}) {
  const query = new URLSearchParams(String(url).split('?')[1] || '');
  // ABSENT IS NOT ZERO. `URLSearchParams.get()` answers null for a missing
  // parameter, `Number(null)` is 0, and `Number.isFinite(0)` is true — so a
  // plain `Number()` turns "the caller said nothing" into "the caller said the
  // Gulf of Guinea", and the fiche would compose a real card for 0°N 0°E.
  // `isochroneFeed.js` carries the same guard for the same reason.
  const lat = coordinate(query.get('lat'));
  const lon = coordinate(query.get('lon'));
  const seconds = resolveSeconds(query.get('seconds')) ?? FICHE_DEFAULT_SECONDS;
  const signal = options.signal ?? null;
  const point = { lat, lon };
  const missing = [];

  const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, status: 400, json: async () => ({ error: 'lat and lon are required' }) };
  }

  const isochronePayload = await fetchPart(
    `/api/isochrone?lat=${lat}&lon=${lon}&profile=foot&seconds=${seconds}`, signal, impl,
  );
  const ring = isochronePayload?.rings?.[0] ?? null;
  if (!ring) missing.push('isochrone');

  const bounds = ring ? ringBounds(ring.ring) : null;
  // A carroyage box padded by one cell, so a square straddling the ring's own
  // edge is fetched rather than silently absent from the upper bound.
  const padDeg = 0.004;
  const carreauxUrl = bounds
    ? `/api/filosofi/carreaux?south=${(bounds.south - padDeg).toFixed(5)}`
      + `&west=${(bounds.west - padDeg).toFixed(5)}`
      + `&north=${(bounds.north + padDeg).toFixed(5)}`
      + `&east=${(bounds.east + padDeg).toFixed(5)}`
      + `&resolution=${resolutionForBox({
        south: bounds.south, north: bounds.north, west: bounds.west, east: bounds.east,
      })}`
    : null;

  const [carreaux, gpu, dvf, banFeature] = await Promise.all([
    carreauxUrl ? fetchPart(carreauxUrl, signal, impl) : Promise.resolve(null),
    fetchPart(`/api/gpu?lat=${lat}&lon=${lon}`, signal, impl),
    fetchPart(`/api/dvf?lat=${lat}&lon=${lon}&radius=${DVF_RADIUS_M}`, signal, impl),
    fetchPart(
      `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}&limit=1`, signal, impl,
    ).then((payload) => payload?.features?.[0] ?? null),
  ]);

  // A page the WFS cut short is not a catchment. Named here so the card can say
  // so, because summing 5 000 of an unknown number of squares and printing the
  // total is the exact failure this layer was built to refuse.
  if (!carreaux) missing.push('carroyage');
  else if (carreaux.truncated) missing.push('carroyage tronqué');
  if (!gpu) missing.push('urbanisme');
  if (!dvf) missing.push('marché');
  if (!banFeature) missing.push('adresse');

  const aggregate = ring && carreaux
    ? aggregateInRing(
      carreaux.cells || [],
      ring.holes?.length ? [ring.ring, ...ring.holes] : ring.ring,
      carreaux.resolution || 200,
    )
    : null;
  // The truncation flag travels WITH the numbers it invalidates. Carried on the
  // aggregate rather than left on the carroyage payload, because `ficheLines()`
  // only ever sees the aggregate and that is where the sentence gets printed.
  const demand = aggregate
    ? { ...aggregate, truncated: Boolean(carreaux?.truncated), matched: carreaux?.matched ?? null }
    : null;

  return ok(composeFiche({
    point,
    address: projectAddress(banFeature),
    isochrone: ring
      ? {
        seconds: ring.seconds ?? seconds,
        areaKm2: ring.areaKm2,
        radiusM: equivalentRadiusM(ring.areaKm2),
        ring: ring.ring,
        resourceVersion: ring.resourceVersion ?? null,
      }
      : null,
    demand,
    zoning: projectZoning(gpu),
    market: projectMarket(dvf),
    missing,
  }));
}

/**
 * The fiche, as the lines a card prints.
 *
 * NO LINE MAY CONTAIN ' · '. The shared factory's `cardFromEntity()` builds a
 * card by splitting the entity's `description` on that separator, so a line
 * carrying one inside it would arrive on screen as two fragments — the layer's
 * headline sentence broken across two rows, which is how a bracket stops being
 * read as a bracket. Inside a line the separator is a comma or an em dash;
 * between lines it is the ' · ' the factory owns. `implantationFiche.test.mjs`
 * asserts it, because the failure is silent and cosmetic-looking.
 *
 * Exported and pure so the wording is unit-tested rather than eyeballed: this
 * card is the layer's entire product, and a line that overstates would be the
 * whole failure.
 *
 * @param {object} fiche
 * @returns {{title: string, details: string[]}}
 */
export function ficheLines(fiche) {
  const details = [];
  const iso = fiche?.isochrone ?? null;
  const demand = fiche?.demand ?? null;
  const zoning = fiche?.zoning ?? null;
  const market = fiche?.market ?? null;

  if (iso) {
    details.push(`${minutesLabel(iso.seconds)} à pied — ${iso.areaKm2} km² réellement atteignables`);
    details.push(`Cercle équivalent ${iso.radiusM} m, mais ce n’est pas un cercle`);
  } else {
    details.push('Zone de chalandise indisponible — le service isochrone IGN n’a pas répondu');
  }

  if (demand && demand.people.count > 0) {
    const width = bracketWidthPercent(demand.people);
    // THE BRACKET, FIRST. It is the number a reader will quote, and quoting it
    // without its bounds is exactly what this layer refuses to let them do.
    //
    // Unless the carroyage page was CUT SHORT, in which case there is no
    // bracket to print: squares are missing, every figure below is a floor, and
    // the honest headline says "at least" rather than a total with an error bar
    // that does not cover the missing squares.
    if (demand.truncated) {
      details.push(`Au moins ${count(demand.people.count)} habitants — comptage incomplet`);
      details.push('Le carroyage INSEE a renvoyé une page tronquée'
        + (Number.isFinite(demand.matched) ? ` (${count(demand.matched)} carreaux dans la boîte)` : '')
        + ' — ce total est un plancher, pas une fourchette');
    } else {
      details.push(`${count(demand.people.count)} habitants`
        + (width === null ? '' : ` (±${width} %)`));
      details.push(`Entre ${count(demand.people.low)} et ${count(demand.people.high)}`
        + ' selon qu’on compte les carreaux entiers ou tout carreau touché');
    }
    // The four counts, as a partition a reader can add up: inside + straddling
    // = touched, and counted is the centroid convention drawn from both.
    details.push(`${count(demand.households.count)} ménages`
      + `, ${demand.cells.counted} carreaux de ${demand.resolution} m retenus au centre`
      + ` sur ${demand.cells.touched} touchés (${demand.cells.inside} entiers`
      + `, ${demand.cells.straddling} à cheval)`);
    // Said out loud when it dominates, because a reader meeting a ±100 %
    // bracket assumes a bug rather than a grid. A ten-minute walk is about
    // 1,1 km across and a 200 m carreau is a fifth of that, so most of the
    // squares it touches ARE its border — which is a fact about the resolution
    // of the only national grid there is, not about this address.
    if (demand.cells.touched > 0 && demand.cells.inside * 2 < demand.cells.touched) {
      details.push(`La bordure domine — ${demand.cells.straddling} des`
        + ` ${demand.cells.touched} carreaux touchés sont à cheval, à cette résolution`);
    }
    if (demand.niveau !== null) {
      details.push(`Niveau de vie moyen ${count(demand.niveau)} €/an`
        + (demand.pauvrete === null ? '' : `, ${demand.pauvrete} % de ménages pauvres`));
    }
    const composition = [
      demand.jeunes === null ? null : `${demand.jeunes} % de moins de 18 ans`,
      demand.aines === null ? null : `${demand.aines} % de 65 ans et plus`,
      demand.solo === null ? null : `${demand.solo} % de personnes seules`,
    ].filter(Boolean);
    if (composition.length) details.push(composition.join(', '));
    const tenure = [
      demand.proprietaires === null ? null : `${demand.proprietaires} % de propriétaires`,
      demand.social === null ? null : `${demand.social} % en logement social`,
    ].filter(Boolean);
    if (tenure.length) details.push(tenure.join(', '));
    // Zero imputed cells is good news and must READ as good news: the old line
    // said "0 carreaux imputés — valeurs approchées, pas observées", which
    // states the opposite of what it means.
    if (demand.imputedCells > 0) {
      const plural = demand.imputedCells > 1;
      details.push(`${demand.imputedCells} carreau${plural ? 'x' : ''}`
        + ` imputé${plural ? 's' : ''} sur ${demand.cells.counted}`
        + ` (${demand.imputedShare} %) — valeurs approchées, pas observées`);
    } else if (demand.imputedUnknown > 0) {
      // "None imputed" is a claim about INSEE's flag, and it cannot be made
      // when the flag did not arrive. Two cells in five are imputed nationally,
      // so the silent default was the flattering answer, not the neutral one.
      details.push(`Imputation non renseignée sur ${demand.imputedUnknown}`
        + ` des ${demand.cells.counted} carreaux retenus — observées ou approchées, l’INSEE ne l’a pas dit`);
    } else if (demand.cells.counted > 0) {
      details.push(`Aucun carreau imputé sur les ${demand.cells.counted} retenus`);
    }
  } else if (demand) {
    details.push('Aucun carreau INSEE habité dans cette zone');
  } else {
    details.push('Population indisponible — le carroyage INSEE n’a pas répondu');
  }

  if (zoning) {
    // The GPU's `label` is a free-text paragraph on some documents — measured
    // 219 characters on Lyon's UCe1b — and a card line is one line. Clipped at
    // the first sentence, then hard, with an ellipsis that says it was clipped.
    const approved = zoneApprovalDate(zoning.approvedOn);
    details.push(zoning.code
      ? `PLU zone ${zoning.code}${zoning.label ? `, ${clipLabel(zoning.label)}` : ''}`
        + (approved ? ` (approuvé le ${approved})` : '')
      : 'PLU — aucun zonage à ce point');
    if (zoning.overlapping > 1) {
      details.push(`${zoning.overlapping} zonages se superposent ici`
        + ' — deux communes ne placent pas leur limite au même endroit');
    }
    if (zoning.servitudes) {
      details.push(`${zoning.servitudes} servitude${zoning.servitudes > 1 ? 's' : ''}`
        + (zoning.servitudeLabels.length ? `, ${zoning.servitudeLabels.join(', ')}` : ''));
    }
  }

  if (market) {
    details.push(market.medianPrixM2 !== null
      ? `DVF ${count(market.medianPrixM2)} €/m² médian sur ${market.comparable} ventes`
        + ` comparables, ${market.sales} mutations dans ${DVF_RADIUS_M} m`
      : `DVF ${market.sales} mutations dans ${DVF_RADIUS_M} m, aucune comparable en €/m²`);
  }

  if (fiche?.missing?.length) {
    details.push(`Sources muettes — ${fiche.missing.join(', ')}`);
  }

  const address = fiche?.address ?? null;
  const title = address?.label
    || (address?.commune ? `${address.commune}` : 'Fiche implantation');
  // The separator the factory splits on must never appear inside a line, or the
  // card shatters. Enforced here as well as in the test, because a future line
  // added by hand would otherwise break the card silently.
  return { title, details: details.map((line) => line.replaceAll(' · ', ' — ')) };
}

const base = createAddressScanLayer({
  id: FICHE_LAYER_ID,
  name: FICHE_LAYER_NAME,
  icon: '⌖',
  source: 'IGN · INSEE · GPU · DGFiP',
  endpoint: VIRTUAL_ENDPOINT,
  updateInterval: UPDATE_INTERVAL_MS,
  maxAltitudeM: MAX_ALTITUDE_M,
  params: () => ({ seconds: String(_seconds) }),
  fetchImpl: (url, options) => ficheFetch(url, options),
  redrawOnMapStack: true,

  render({ payload, dataSource, point, viewer }) {
    const classificationType = viewer?.scene?.globe?.show === false
      ? Cesium.ClassificationType.CESIUM_3D_TILE
      : Cesium.ClassificationType.TERRAIN;
    let drawn = 0;

    const ring = payload.isochrone?.ring ?? null;
    if (Array.isArray(ring) && ring.length >= 3) {
      const toPositions = (entries) => (Array.isArray(entries) ? entries : [])
        .filter((entry) => Number.isFinite(entry?.[0]) && Number.isFinite(entry?.[1]))
        .map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
      const positions = toPositions(ring);
      // The holes the isochrone service cut out — ground the ring does not
      // reach. Filled over, they would show as catchment the population count
      // has already excluded.
      const holes = (payload.isochrone?.holes || [])
        .map(toPositions)
        .filter((hole) => hole.length >= 3)
        .map((hole) => new Cesium.PolygonHierarchy(hole));
      if (positions.length >= 3) {
        // ONE ring, and it is the fiche's own — not a copy of the isochrone
        // layer's three. Amber rather than teal so the two layers on at once
        // read as two different statements about the same address.
        dataSource.entities.add({
          id: 'fiche:ring:fill',
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions, holes),
            material: Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.12),
            classificationType,
            outline: false,
          },
        });
        dataSource.entities.add({
          id: 'fiche:ring:outline',
          polyline: {
            positions: [...positions, positions[0]],
            width: 3,
            material: new Cesium.ColorMaterialProperty(
              Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.95),
            ),
            clampToGround: true,
            classificationType,
          },
        });
      }
    }

    if (point) {
      const { title, details } = ficheLines(payload);
      dataSource.entities.add({
        id: 'fiche:point',
        position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
        billboard: {
          image: addressMarkerGlyph('target'),
          width: 28,
          height: 28,
          color: Cesium.Color.fromCssColorString(SELECTED_COLOR),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { kind: 'fiche-implantation' },
        name: title,
        // ' · ' is the factory's own line separator — `cardFromEntity()` splits
        // on it — and `ficheLines()` guarantees no line contains one.
        description: details.join(' · '),
      });
      drawn += 1;
    }
    return drawn;
  },

  summarize(payload) {
    const demand = payload.demand ?? null;
    const iso = payload.isochrone ?? null;
    return {
      addressLabel: payload.address?.label ?? null,
      commune: payload.address?.commune ?? null,
      seconds: iso?.seconds ?? null,
      areaKm2: iso?.areaKm2 ?? null,
      radiusM: iso?.radiusM ?? null,
      people: demand?.people?.count ?? null,
      peopleLow: demand?.people?.low ?? null,
      peopleHigh: demand?.people?.high ?? null,
      bracketPercent: demand ? bracketWidthPercent(demand.people) : null,
      households: demand?.households?.count ?? null,
      niveau: demand?.niveau ?? null,
      pauvrete: demand?.pauvrete ?? null,
      imputedShare: demand?.imputedShare ?? null,
      imputedUnknown: demand?.imputedUnknown ?? null,
      truncated: Boolean(demand?.truncated),
      straddlingCells: demand?.cells?.straddling ?? null,
      zone: payload.zoning?.code ?? null,
      medianPrixM2: payload.market?.medianPrixM2 ?? null,
      missing: payload.missing ?? [],
    };
  },
});

/**
 * The layer, wrapping the shared factory with the duration control.
 *
 * Spread rather than subclassed, for the same reason the isochrone layer is:
 * every method the factory returns is a closure over its own state and none
 * reads `this`.
 */
const implantationFicheLayer = {
  ...base,

  /**
   * Runtime params. Changing the duration CHANGES THE QUESTION — a five-minute
   * catchment is not a subset view of a fifteen-minute one, it is a different
   * ring and a different population — so this refetches.
   * @param {{seconds?: number|string}} [params]
   * @returns {boolean}
   */
  setParams(params = {}) {
    if (params.seconds === undefined) return false;
    const next = resolveSeconds(params.seconds);
    if (!next || next === _seconds) return false;
    _seconds = next;
    void base.update();
    return true;
  },

  /** @returns {{seconds: number}} The duration a share link has to carry. */
  getParams() {
    return { seconds: _seconds };
  },

  getRowControls() {
    const stats = base.getStats();
    const chips = FICHE_STEPS.map((seconds) => ({
      id: String(seconds),
      label: minutesLabel(seconds).toUpperCase(),
      active: _seconds === seconds,
      state: _seconds === seconds ? 'active' : 'idle',
      title: `Population et revenus à ${minutesLabel(seconds)} à pied de l’adresse scannée`,
      params: { seconds },
    }));
    // A three-row legend that IS the bracket: the two countable bounds and the
    // headline between them. The layer's whole argument, in the row.
    const legend = [
      {
        label: 'Carreaux entiers',
        color: '#3ce0c8',
        count: stats.peopleLow ?? 0,
        blurb: 'Habitants des carreaux entièrement dans la zone — la borne basse.',
      },
      {
        label: 'Au centre du carreau',
        color: SELECTED_COLOR,
        count: stats.people ?? 0,
        blurb: 'Convention usuelle : le carreau compte si son centre est dans la zone.',
      },
      {
        label: 'Carreaux touchés',
        color: '#d1442f',
        count: stats.peopleHigh ?? 0,
        blurb: 'Habitants de tout carreau que la zone touche — la borne haute.',
      },
    ];
    return { chips, legend };
  },

  getStats() {
    const stats = base.getStats();
    const result = {
      ...stats,
      seconds: _seconds,
      feedSource: 'IGN Géoplateforme · INSEE Filosofi · Géoportail de l’urbanisme · DVF',
    };
    if (stats.dormant) {
      result.status = 'ok';
      result.loadingLabel = `Descends sous ${Math.round(MAX_ALTITUDE_M / 1000)} km `
        + 'pour composer une fiche';
    } else if (Array.isArray(stats.missing) && stats.missing.length) {
      // DEGRADED, not an error: a fiche short of its market half is still a
      // fiche, and the row has to say which of the two it is looking at.
      result.degraded = true;
      result.loadingLabel = `Fiche partielle — sources muettes : ${stats.missing.join(', ')}`;
    }
    return result;
  },
};

/** @returns {number} The duration currently scanned. Test seam. */
export function _ficheSecondsForTest() {
  return _seconds;
}

/** Force the scanned duration without going through the manager. Test seam. */
export function _setFicheSecondsForTest(seconds) {
  _seconds = resolveSeconds(seconds) ?? FICHE_DEFAULT_SECONDS;
}

export default implantationFicheLayer;
