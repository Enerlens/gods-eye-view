/**
 * Géorisques feed projection — the seam between the state's own risk register
 * and what the browser is served.
 *
 * WHAT THIS SOURCE ACTUALLY IS. Géorisques (BRGM, for the Ministère de la
 * Transition écologique) is the register behind the **état des risques**, the
 * document a French seller is legally obliged to hand a buyer. The same facts
 * are normally read weeks into a purchase, at the compromis. Read from a
 * coordinate instead, they are readable before the first visit.
 *
 * MEASURED against the live API on 2026-09-01, at 2.3760,48.8300 (Paris 13e):
 *   - `GET /api/v1/resultats_rapport_risque?latlon=LON,LAT&rayon=1000`
 *     → 200, 3,260 bytes, `access-control-allow-origin: *`,
 *       `cache-control: no-cache, no-store, must-revalidate`
 *   - `GET /api/v1/installations_classees?latlon=LON,LAT&rayon=1000&page_size=…`
 *     → 200, 7,007 bytes, 30 establishments; the same call at rayon=2000
 *       returns 256, so the radius is the whole cost control
 *   - `GET /api/v1/radon?code_insee=75113` → 200, 179 bytes,
 *     `data[0].classe_potentiel: "1"`
 *
 * THE ONE STRUCTURAL FACT WORTH CARRYING. `risquesNaturels` and
 * `risquesTechnologiques` are OBJECTS keyed by hazard, not arrays, and each
 * hazard carries TWO verdicts: `libelleStatutCommune` and
 * `libelleStatutAdresse`. On the 13e, ICPE reads "Risque Concerne" for the
 * commune and "Risque non Concerne" for the address. That gap is the
 * difference between "true anywhere around here" and "depends on your street",
 * and the upstream already computes it — so this projection TRANSPORTS both
 * verdicts rather than collapsing them into one boolean. Collapsing them would
 * manufacture a certainty the source declined to make.
 *
 * A SECOND TRAP, ENCODED HERE SO IT IS NOT REDISCOVERED. `commune.codeInsee`
 * comes back as `75056` — Paris as a single commune — not the arrondissement.
 * The radon endpoint is keyed by INSEE code and accepts the arrondissement
 * (`75113`), so the caller passes the code it resolved from the BAN rather
 * than the one this report echoes. See `dvfFeed.js`, which is broken by the
 * same distinction in a louder way.
 *
 * Dependency-free and side-effect-free: URL construction and projection only,
 * so a unit test can point at a captured response. The `/api/georisques` proxy
 * imports this; nothing in the browser bundle does.
 */

const API_ROOT = 'https://www.georisques.gouv.fr/api/v1';

/** Default search radius in metres when the caller names none. */
export const GEORISQUES_DEFAULT_RADIUS_M = 1000;
/**
 * Hard ceiling on the radius, in metres.
 *
 * Not a politeness limit: the ICPE endpoint returned 30 establishments at
 * 1,000 m and 256 at 2,000 m on the same point. The count grows with the area,
 * so an unbounded radius is an unbounded response for a question — "what is
 * near this address" — that stops meaning anything past a walk.
 */
export const GEORISQUES_MAX_RADIUS_M = 5000;
/** Ceiling on establishments served, independent of what the radius returns. */
export const GEORISQUES_MAX_ICPE = 60;

/**
 * Radon potential classes, in the IRSN vocabulary Géorisques republishes.
 * Class 3 is the only one that triggers a regulatory obligation for a seller.
 */
export const RADON_CLASS_LABELS = Object.freeze({
  1: 'Potentiel radon faible',
  2: 'Potentiel radon faible à moyen',
  3: 'Potentiel radon significatif',
});

/**
 * Coerce a query value to a number, treating ABSENT as absent.
 *
 * `URLSearchParams.get()` returns `null` for a missing parameter, `Number(null)`
 * is `0`, and `Number.isFinite(0)` is true — so a plain `Number()` turns "the
 * caller said nothing" into "the caller said zero", and every clamp below then
 * returns its MINIMUM instead of its default. Measured live: `GET /api/dpe`
 * with no `radius` scanned 50 m rather than the documented 200 m, and returned
 * `total: 0` for an address with 2,805 diagnostics around it. Same root cause
 * as the `addressPoint` guard in `vite.config.js`.
 *
 * @param {unknown} value
 * @returns {number|null} A finite number, or null when nothing usable was given.
 */
function requestedNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Clamp a requested radius into the range this layer will actually serve.
 * @param {unknown} value Requested radius in metres.
 * @returns {number} A radius within [100, GEORISQUES_MAX_RADIUS_M].
 */
export function clampRadius(value) {
  const requested = requestedNumber(value);
  if (requested === null) return GEORISQUES_DEFAULT_RADIUS_M;
  return Math.min(GEORISQUES_MAX_RADIUS_M, Math.max(100, Math.round(requested)));
}

/**
 * Build the three upstream URLs a single address scan needs.
 *
 * `latlon` is LONGITUDE FIRST — the API's own order, and the inverse of the
 * parameter name. Getting it backwards returns a plausible report for a point
 * in the sea rather than an error, which is why it is built in one place.
 *
 * @param {{lon: number, lat: number, radiusM?: number, inseeCode?: string|null}} query
 * @returns {{report: string, icpe: string, radon: string|null}}
 */
export function buildGeorisquesUrls({ lon, lat, radiusM, inseeCode = null }) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error('georisques: lon/lat must be finite numbers');
  }
  const radius = clampRadius(radiusM);
  const latlon = `${lon},${lat}`;
  return {
    report: `${API_ROOT}/resultats_rapport_risque?latlon=${encodeURIComponent(latlon)}&rayon=${radius}`,
    icpe: `${API_ROOT}/installations_classees?latlon=${encodeURIComponent(latlon)}&rayon=${radius}`
      + `&page_size=${GEORISQUES_MAX_ICPE}`,
    radon: inseeCode ? `${API_ROOT}/radon?code_insee=${encodeURIComponent(inseeCode)}` : null,
  };
}

/**
 * Great-circle distance in metres. Local enough that the spherical form is
 * exact to well under a metre at the radii this module serves.
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number}
 */
function haversineM(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Project one hazard entry, preserving the two verdicts the source separates.
 *
 * `present: false` is a real answer ("this hazard does not reach here"), not a
 * missing one, so it survives into the output rather than being filtered away
 * — a scan that silently dropped every absent hazard could not tell a reader
 * the difference between "checked, clear" and "never checked".
 *
 * @param {string} id Hazard key as the upstream names it.
 * @param {object|null|undefined} entry
 * @returns {{id: string, label: string, present: boolean,
 *   communeVerdict: string|null, addressVerdict: string|null,
 *   variesByAddress: boolean, detail: string|null}|null}
 */
function projectHazard(id, entry) {
  if (!entry || typeof entry !== 'object') return null;
  const communeVerdict = entry.libelleStatutCommune ?? null;
  const addressVerdict = entry.libelleStatutAdresse ?? null;
  return {
    id,
    label: String(entry.libelle ?? id),
    present: entry.present === true,
    communeVerdict,
    addressVerdict,
    // The upstream disagreeing with itself is the signal, not a defect: it
    // means the hazard exists in the commune but not at this point.
    variesByAddress: Boolean(communeVerdict) && Boolean(addressVerdict)
      && communeVerdict !== addressVerdict,
    detail: entry.specifique ?? null,
  };
}

/**
 * Project the hazard map into a stable, ordered array.
 * @param {object|null|undefined} hazards Upstream `risquesNaturels`/`risquesTechnologiques`.
 * @returns {Array<ReturnType<typeof projectHazard>>}
 */
export function projectHazards(hazards) {
  if (!hazards || typeof hazards !== 'object') return [];
  const out = [];
  for (const [id, entry] of Object.entries(hazards)) {
    const projected = projectHazard(id, entry);
    if (projected) out.push(projected);
  }
  // Present hazards first, then alphabetical: the reader's question is "what
  // reaches me", and a stable tail keeps snapshots diffable.
  out.sort((a, b) => (Number(b.present) - Number(a.present)) || a.id.localeCompare(b.id));
  return out;
}

/**
 * Project the classified-installations page into drawable establishments.
 *
 * Entries whose `regime` is "Non ICPE" are KEPT. The endpoint is the state's
 * industrial-site register, and a site it has surveyed and then declassified
 * is still a fact about the neighbourhood; hiding it would misrepresent the
 * register as smaller than it is. The regime rides along so a reader can tell
 * a Seveso site from a declassified electronics shop.
 *
 * @param {object|null|undefined} payload Upstream `installations_classees` body.
 * @param {{lon: number, lat: number}} origin Point the scan was centred on.
 * @returns {{items: Array<object>, total: number|null, truncated: boolean}}
 */
export function projectIcpe(payload, origin) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const total = Number.isFinite(payload?.results) ? payload.results : null;
  const items = [];
  for (const row of rows) {
    const lon = Number(row?.longitude);
    const lat = Number(row?.latitude);
    const hasPosition = Number.isFinite(lon) && Number.isFinite(lat);
    items.push({
      id: String(row?.codeAIOT ?? row?.siret ?? `icpe-${items.length}`),
      name: String(row?.raisonSociale ?? 'Établissement sans raison sociale'),
      address: [row?.adresse1, row?.adresse2, row?.adresse3].filter(Boolean).join(', ') || null,
      commune: row?.commune ?? null,
      postalCode: row?.codePostal ?? null,
      regime: row?.regime ?? null,
      seveso: Boolean(row?.statutSeveso),
      sevesoStatus: row?.statutSeveso ?? null,
      ied: row?.ied === true,
      nationalPriority: row?.prioriteNationale === true,
      activityState: row?.etatActivite ?? null,
      updatedAt: row?.date_maj ?? null,
      lon: hasPosition ? lon : null,
      lat: hasPosition ? lat : null,
      distanceM: hasPosition && Number.isFinite(origin?.lon) && Number.isFinite(origin?.lat)
        ? Math.round(haversineM(origin.lat, origin.lon, lat, lon))
        : null,
    });
  }
  items.sort((a, b) => {
    if (a.distanceM === null) return b.distanceM === null ? 0 : 1;
    if (b.distanceM === null) return -1;
    return a.distanceM - b.distanceM;
  });
  return {
    items: items.slice(0, GEORISQUES_MAX_ICPE),
    total,
    truncated: total !== null && total > items.length,
  };
}

/**
 * Project the commune radon class.
 * @param {object|null|undefined} payload Upstream `radon` body.
 * @returns {{class: number|null, label: string|null}}
 */
export function projectRadon(payload) {
  const row = Array.isArray(payload?.data) ? payload.data[0] : null;
  const parsed = Number.parseInt(String(row?.classe_potentiel ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3) return { class: null, label: null };
  return { class: parsed, label: RADON_CLASS_LABELS[parsed] ?? null };
}

/**
 * Assemble the three upstream answers into the one document the client reads.
 *
 * Every input is optional. A source that failed contributes `null` for its own
 * field and nothing else — the design's rule that "a slow or unavailable
 * source degrades one act, never the whole mission" is enforced here, at the
 * projection, rather than being left to each caller to remember.
 *
 * @param {{report?: object|null, icpe?: object|null, radon?: object|null,
 *   origin: {lon: number, lat: number}, radiusM: number}} input
 * @returns {object} The `/api/georisques` response body, minus its envelope.
 */
export function projectGeorisques({ report, icpe, radon, origin, radiusM }) {
  const address = report?.adresse
    ? {
      label: report.adresse.libelle ?? null,
      lon: Number(report.adresse.longitude),
      lat: Number(report.adresse.latitude),
    }
    : null;
  const icpeProjection = projectIcpe(icpe, origin);
  return {
    address,
    commune: report?.commune
      ? {
        name: report.commune.libelle ?? null,
        // Echoed as the API gives it — 75056 for any Paris arrondissement.
        inseeCode: report.commune.codeInsee ?? null,
        postalCode: report.commune.codePostal ?? null,
      }
      : null,
    radiusM,
    naturalRisks: projectHazards(report?.risquesNaturels),
    technologicalRisks: projectHazards(report?.risquesTechnologiques),
    icpe: icpeProjection.items,
    icpeTotal: icpeProjection.total,
    icpeTruncated: icpeProjection.truncated,
    radon: projectRadon(radon),
    sourceUrl: report?.url ?? null,
    // Which of the three upstreams answered. A reader must be able to tell
    // "no ICPE nearby" from "the ICPE endpoint did not reply".
    available: {
      report: Boolean(report),
      icpe: Boolean(icpe),
      radon: Boolean(radon),
    },
  };
}
