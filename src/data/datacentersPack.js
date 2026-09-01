/*
 * DATACENTERS PACK — what the bundled OpenStreetMap snapshot can honestly say.
 *
 * The layer drew 4 351 sites and its card said almost nothing about any of
 * them: 2 428 of them (55.8 %) rendered as a title and no detail line at all,
 * and the one line the rest could get came from a capacity chain
 * (`capacity:it_load` / `it_load` / `capacity` / `properties.capacity`) that
 * matches exactly THREE features in the whole pack — one each, and the fourth
 * key does not exist in the file at any level. So the card was, in practice,
 * the operator's name or nothing.
 *
 * This module is the same arrangement `damsPack.js` and `airportsPack.js`
 * already use: the file that decides what a card says lives beside the data it
 * says it about, is pure (no Cesium, no DOM, no network) and is under test, so
 * a dropped field is a failing assertion rather than a blank line nobody
 * notices.
 *
 * ── WHAT IS ACTUALLY IN THE PACK ────────────────────────────────────────────
 *
 * Measured over all 4 351 features (313 distinct OSM tag keys):
 *
 *     telecom            4 177  96.0 %   a constant — never a card line
 *     name               3 405  78.3 %
 *     building           3 218  74.0 %
 *     operator           2 619  60.2 %
 *     operator:wikidata  1 352  31.1 %
 *     website              929  21.4 %
 *     ref                  868  19.9 %
 *     building:levels      374   8.6 %
 *     operator:short       344   7.9 %
 *     start_date           188   4.3 %
 *     height               154   3.5 %
 *
 * And essentially NO power vocabulary: every key matching
 * /power|generator|capacity|load|energy|cool|pue|ups|diesel/ together covers
 * 24 features. `data_center:power` — the only one that is a real IT-load
 * figure — is on six, five of them French (Digital Realty MRS1 16 MW, MRS2
 * 16 MW, MRS3 24 MW, MRS4 20 MW, Phocea DC 1.2 MW) and it was NOT among the
 * keys the old card read. It is now.
 *
 * ── THE ONE FACT THE PACK HOLDS AND NEVER PUBLISHED: SIZE ───────────────────
 *
 * 3 517 of the 4 351 features (80.8 %) are polygons, and their footprint spans
 * five orders of magnitude — p05 263 m², median 5 625 m², p95 47 847 m², max
 * 7 060 220 m² — while every one of them renders as the same 10 px dot. That
 * is the most discriminating thing in the file and it cost nothing to compute:
 * the whole pack is 46 596 vertices, and the render path already walks each
 * polygon's positions once to place its stem.
 *
 * ── BUT A POLYGON IS NOT ALWAYS A BUILDING ──────────────────────────────────
 *
 * This is the trap, and it is why {@link datacenterFootprint} returns a KIND
 * and not just a number. 313 polygons carry no `building` tag (or
 * `building=no`), and they are site outlines, not buildings: median 31 204 m²
 * against 5 008 m² for the 3 200 that do carry one. `Meta Los Lunas Data
 * Center` is explicitly `building=no` and measures 2 033 401 m²; `Data4 Campus
 * Paris Saclay` is 343 709 m². Printing "emprise au sol" over those would be a
 * measurement of the fence, presented as a measurement of the hall — so the
 * two are worded differently, from the tag, every time.
 *
 * Areas are prefixed `≈` and rounded to two significant figures. OSM outlines
 * are volunteer tracings, not a survey, and the number must not read like one.
 *
 * Source:   OpenStreetMap (`telecom=data_center`), ODbL 1.0.
 * See also: src/data/local_data/datacenters/README.md, which records that the
 *           snapshot's extraction date and query were never written down — so
 *           this module reads what is there and claims nothing about vintage.
 */

/** Mean Earth radius (m). Matches the value the rest of the app measures with. */
const EARTH_MEAN_RADIUS_M = 6371008.8;

/**
 * Smallest footprint worth printing.
 *
 * The pack's floor is 2.6 m², which is a mapping error rather than a data
 * centre. Anything under a garden shed says more about OSM than about the
 * site, so it is dropped rather than rendered as a suspiciously precise
 * nothing.
 */
export const DATACENTER_MIN_AREA_M2 = 50;

/** Trim to a clean string, or ''. */
function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** The first non-empty candidate. */
function firstText(values) {
  for (const value of values) {
    const cleaned = text(value);
    if (cleaned) return cleaned;
  }
  return '';
}

/**
 * Signed planar area of one ring, in the local tangent plane at `lat0`.
 *
 * A shoelace over longitude scaled by cos(lat0) rather than a spherical
 * excess: checked against Chamberlain–Duquette over the pack's 3 448 rings,
 * the two agree to a median 0.2239 % / max 0.2313 %, and that residual is
 * ENTIRELY the equatorial-vs-mean radius choice — (6378137 / 6371008.8)² =
 * 1.00224. With the same radius they agree to ~0.01 %. At footprints of a few
 * thousand square metres that is metres, far inside what an OSM tracing is
 * worth, and it avoids pulling a geodesy dependency into a card.
 *
 * @param {Array<[number, number]>} ring `[lon, lat]` pairs, degrees.
 * @param {number} lat0 Reference latitude, degrees.
 * @returns {number} Signed area in m² (positive counter-clockwise).
 */
function ringAreaM2(ring, lat0) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const metresPerDegreeLat = (Math.PI / 180) * EARTH_MEAN_RADIUS_M;
  const metresPerDegreeLon = metresPerDegreeLat * Math.cos((lat0 * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    const ax = Number(a[0]);
    const ay = Number(a[1]);
    const bx = Number(b[0]);
    const by = Number(b[1]);
    if (!Number.isFinite(ax + ay + bx + by)) return 0;
    sum += (ax * metresPerDegreeLon) * (by * metresPerDegreeLat)
      - (bx * metresPerDegreeLon) * (ay * metresPerDegreeLat);
  }
  return sum / 2;
}

/**
 * Footprint area of a GeoJSON geometry, with inner rings subtracted.
 *
 * Returns 0 for Points and for anything unparseable — 834 features (19.2 %)
 * are Points and have no footprint at all, and they must simply produce no
 * line rather than a zero.
 *
 * @param {{type?:string, coordinates?:Array}|null|undefined} geometry
 * @returns {number} Area in m², 0 when there is none.
 */
export function geometryAreaM2(geometry) {
  const type = text(geometry?.type);
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) return 0;

  const polygons = type === 'Polygon'
    ? [coordinates]
    : (type === 'MultiPolygon' ? coordinates : null);
  if (!polygons) return 0;

  // One reference latitude for the whole feature, taken from its first vertex:
  // a data centre is never large enough for the cos(lat) scale to move within
  // it, and using a per-ring reference would make holes and shell disagree.
  const firstVertex = polygons[0]?.[0]?.[0];
  const lat0 = Number(Array.isArray(firstVertex) ? firstVertex[1] : NaN);
  if (!Number.isFinite(lat0)) return 0;

  let total = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) continue;
    // Ring 0 is the shell, the rest are holes. Absolute values, because OSM
    // winding is not guaranteed and a mis-wound shell must not go negative.
    total += Math.abs(ringAreaM2(polygon[0], lat0));
    for (let i = 1; i < polygon.length; i += 1) {
      total -= Math.abs(ringAreaM2(polygon[i], lat0));
    }
  }
  return total > 0 ? total : 0;
}

/**
 * What the polygon of one feature actually outlines.
 *
 * `building` is the deciding tag and the ONLY one: a feature that carries a
 * real `building=*` value is a hall, and one that carries none — or an explicit
 * `building=no` — is a site boundary. The distinction is not stylistic. Those
 * 313 site polygons are six times larger at the median and include a 2 033 401
 * m² outline explicitly tagged `building=no`.
 *
 * @param {object} tags OSM tags.
 * @param {number} areaM2 Footprint from {@link geometryAreaM2}.
 * @returns {{kind:'building'|'site', areaM2:number}|null} null when there is
 *   nothing measurable to report.
 */
export function datacenterFootprint(tags, areaM2) {
  const area = Number(areaM2);
  if (!Number.isFinite(area) || area < DATACENTER_MIN_AREA_M2) return null;
  const building = text(tags?.building).toLowerCase();
  const isBuilding = Boolean(building) && building !== 'no';
  return { kind: isBuilding ? 'building' : 'site', areaM2: area };
}

/**
 * Where square metres stop being readable and hectares start.
 *
 * Ten hectares, not one. A data-centre HALL is quoted in square metres by
 * everyone who works in one, and the pack's buildings top out around 100 000 m²
 * — switching at a single hectare would have printed the 19 473 m² Equinix
 * building as "1,9 ha", which is both true and useless. Above 10 ha the number
 * is no longer a building at all but a campus outline, and those are quoted in
 * hectares for the same reason.
 */
const HECTARE_THRESHOLD_M2 = 100_000;

/**
 * Two significant figures, grouped the French way, in m² or ha.
 * @param {number} areaM2
 * @returns {string}
 */
export function formatFootprint(areaM2) {
  const area = Number(areaM2);
  if (!Number.isFinite(area) || area <= 0) return '';
  const round2 = (value) => {
    const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
    return Math.round(value / magnitude) * magnitude;
  };
  if (area >= HECTARE_THRESHOLD_M2) {
    const hectares = round2(area / 10_000);
    return `${hectares.toLocaleString('fr-FR')} ha`;
  }
  return `${round2(area).toLocaleString('fr-FR')} m²`;
}

/**
 * A four-digit year from `start_date`, or ''.
 *
 * The tag holds 87 distinct values across 188 features, overwhelmingly bare
 * years but not exclusively, and it can mean the building's completion rather
 * than the site's commissioning. Only a clean leading year is taken, and it is
 * bounded — a `start_date` of 1066 is a mapping error, not a data centre.
 * @param {string} value
 * @returns {string}
 */
export function datacenterYear(value) {
  const match = /^(\d{4})\b/.exec(text(value));
  if (!match) return '';
  const year = Number(match[1]);
  return year >= 1950 && year <= 2100 ? match[1] : '';
}

/**
 * The card lines for one datacenter, in reading order.
 *
 * Every line drops out silently when its facts are absent — the same rule the
 * dam and airport packs follow — so a Point feature with only a name still
 * renders as a clean title with nothing under it rather than as a row of
 * dashes. Measured over the pack, this takes "at least one detail line" from
 * 44.2 % to 93.4 %, and 64.1 % get two.
 *
 * @param {object} props Unwrapped feature properties (`{tags, ...}`).
 * @param {{areaM2?: number}} [options] Footprint measured from the geometry.
 * @returns {string[]} Up to three lines.
 */
export function datacenterCardDetails(props, { areaM2 = 0 } = {}) {
  const source = props && typeof props === 'object' ? props : {};
  const tags = source.tags && typeof source.tags === 'object' ? source.tags : {};
  const title = text(source.name || tags.name).toLocaleLowerCase('fr-FR');
  const lines = [];

  // ── 1. Who runs it, and how big the IT load is when anyone said.
  //
  // `operator:short` is deliberately NOT in the chain: it has five distinct
  // values across 344 features and 83 % of them are just 'AWS' or 'QTS', so it
  // adds a word to sites that already name their operator and nothing to any
  // site that does not.
  const operator = firstText([tags.operator, source.operator, tags.owner, tags.brand]);
  // `data_center:power` first — it is the only key in this pack that is
  // actually an IT-load figure, and the three the old card looked for match one
  // feature each. They stay as tail fallbacks rather than being deleted,
  // because a future re-extraction may well populate them.
  const power = firstText([
    tags['data_center:power'],
    tags['capacity:it_load'],
    tags.it_load,
    tags.capacity,
  ]);
  // A `ref` is industry naming worth showing — 'MRS1', 'TH3', 'BX1' — but 66 %
  // of them are already a substring of the name they sit under. Printed only
  // when it is a token the title does not already carry.
  const ref = text(tags.ref);
  const refIsNew = ref && !title.includes(ref.toLocaleLowerCase('fr-FR'));
  const identity = [
    operator && operator.toLocaleLowerCase('fr-FR') !== title ? operator : '',
    refIsNew ? ref : '',
    power,
  ].filter(Boolean).join(' · ');
  if (identity) lines.push(identity);

  // ── 2. How big, and worded for what the polygon actually outlines.
  const footprint = datacenterFootprint(tags, areaM2);
  const levels = Number.parseInt(text(tags['building:levels']), 10);
  const height = Number.parseFloat(text(tags.height));
  const fabric = [
    footprint
      ? `${footprint.kind === 'building' ? 'emprise au sol' : 'emprise du site'} ≈ ${formatFootprint(footprint.areaM2)}`
      : '',
    Number.isFinite(levels) && levels > 0
      ? `${levels} niveau${levels > 1 ? 'x' : ''}`
      : (Number.isFinite(height) && height > 0
        ? `${height.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} m de haut`
        : ''),
  ].filter(Boolean).join(' · ');
  if (fabric) lines.push(fabric);

  // ── 3. Since when.
  const year = datacenterYear(tags.start_date);
  if (year) lines.push(`en service depuis ${year}`);

  return lines;
}
