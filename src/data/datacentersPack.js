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
 * ── THE ONE FACT THE PACK HELD AND NEVER PUBLISHED: SIZE ────────────────────
 *
 * 3 517 of the 4 351 features (80.8 %) are polygons, and their footprint spans
 * five orders of magnitude — p05 417 m², median 5 741 m², p95 50 519 m², max
 * 7 044 428 m² — and until now every one of them rendered as the same 10 px
 * dot. That is the most discriminating thing in the file and it costs nothing
 * to compute: the whole pack is 46 596 vertices, and the render path already
 * walks each polygon's positions once to place its stem.
 *
 * ── AND NOW DRAWS. THE FOUR SIGNS, AND WHY THEY ARE FOUR ────────────────────
 *
 * The size channel is spent in WORLD UNITS, not in screen pixels: the emprise
 * is drawn where it is, at the metre count it has, so it shrinks with distance
 * the way a building does. That is the branch of B2 that a physical object is
 * entitled to — the alternative, a constant-pixel disc scaled by area, would
 * claim a hall is legible from orbit, which it is not. The anchor dot drops
 * from 10 px to 6 px and stops being the size channel; it is now only the
 * stem's head and the card's hook.
 *
 * Measured over the whole pack, the four render classes and their counts:
 *
 *     volume   461  10.6 %   building polygon + a published height
 *     slab   2 739  63.0 %   building polygon, height NOT published
 *     site     317   7.3 %   polygon with no `building` tag — a fence
 *     point    834  19.2 %   no polygon at all
 *
 * `slab` is 63 % of the pack and it is the reason nothing gets a default
 * height (A1): six features in ten would then be standing at a height nobody
 * measured. A slab is flat, and flat is the sign for "emprise connue, hauteur
 * inconnue". A `point` is a HOLLOW ring, not a disc, because there is no
 * emprise to be small — there is no emprise at all, and "small" and "absent"
 * must not share a mark.
 *
 * Height is read from `height` first (154 features, 3.5 %) because it is
 * already metres, then from `building:levels` (374, 8.6 %), which has to be
 * converted. The conversion factor is MEASURED, not assumed: 59 features carry
 * both tags, and their height-per-storey is a median 5.0 m (p25 4.0, p75 6.7).
 * Five metres is a data hall, not an office floor, and it is what
 * {@link DATACENTER_LEVEL_HEIGHT_M} says. The 461 resulting extrusions run
 * 3 m → 170 m, median 12.2 m.
 *
 * ── COLOUR, WHICH THIS LAYER HAD NEVER SPENT ────────────────────────────────
 *
 * Every datacenter was cyan, so hue carried nothing. It now carries the one
 * distinction the footprint number cannot survive without: a hall is cyan, a
 * SITE OUTLINE is slate. Fill opacity is a single constant across all three
 * surface classes precisely so that it encodes nothing (A3) — form says what
 * is known, hue says what the polygon outlines, and the polygon's own extent
 * says how big.
 *
 * ── BUT A POLYGON IS NOT ALWAYS A BUILDING ──────────────────────────────────
 *
 * This is the trap, and it is why {@link datacenterFootprint} returns a KIND
 * and not just a number. 317 polygons carry no `building` tag (or
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

/* ══════════════════════════════════════════════════════════════════════════
 * SIZE — the channel this pack spends in world units
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Metres per storey, for the 374 features that publish `building:levels` and
 * no `height`.
 *
 * MEASURED, not assumed. 59 features carry both tags; the ratio of the two is
 * a median 5.0 m per storey (p25 4.0, p75 6.7). That is a data hall — a
 * 3 m office floor would put a two-storey Equinix building at 6 m and make it
 * disappear against its own car park. The number is a scaling of a published
 * count, so it never invents a height where none was counted.
 */
export const DATACENTER_LEVEL_HEIGHT_M = 5;

/**
 * Bounds on anything that reaches the extrusion.
 *
 * The pack's own maximum is 170 m and 34 storeys. A `height=1200` is a mapping
 * error, and a 6 km tower over a car park would read as the most important
 * object on the continent — so out-of-range values are refused rather than
 * clamped: a clamped 400 m is still a claim nobody made.
 */
export const DATACENTER_MAX_HEIGHT_M = 300;
/** @see DATACENTER_MAX_HEIGHT_M */
export const DATACENTER_MAX_LEVELS = 100;

/**
 * How tall OSM says this building is, and on whose authority.
 *
 * `height` wins over `building:levels` because it is already metres and needs
 * no factor. Returns null — never a default — for the 90 % that publish
 * neither, which is the whole point: {@link datacenterSurface} then classes
 * them `slab` and they are drawn FLAT.
 *
 * @param {object} tags OSM tags.
 * @returns {{heightM:number, basis:'height'|'levels'}|null}
 */
export function datacenterHeightM(tags) {
  const source = tags && typeof tags === 'object' ? tags : {};
  const metres = Number.parseFloat(text(source.height).replace(',', '.'));
  if (Number.isFinite(metres) && metres > 0 && metres <= DATACENTER_MAX_HEIGHT_M) {
    return { heightM: Math.round(metres * 10) / 10, basis: 'height' };
  }
  const levels = Number.parseInt(text(source['building:levels']), 10);
  if (Number.isFinite(levels) && levels > 0 && levels <= DATACENTER_MAX_LEVELS) {
    return { heightM: levels * DATACENTER_LEVEL_HEIGHT_M, basis: 'levels' };
  }
  return null;
}

/** Cyan — a hall. The layer's historical colour, now carrying a distinction. */
export const DATACENTER_HALL_COLOR = '#00ffff';

/**
 * Slate — a site outline. Deliberately a LOW-chroma neighbour of the cyan and
 * not a second bright hue: these two are not two categories of equal standing,
 * they are "the thing" and "the fence around the thing", and the fence must
 * not out-shout the hall it contains.
 */
export const DATACENTER_SITE_COLOR = '#8fa6b5';

/**
 * ONE fill opacity for all three surface classes, so that opacity encodes
 * NOTHING (A3). Form says what is known (volume / flat / absent), hue says
 * what the polygon outlines (hall / fence), extent says how big. A ramp of
 * alphas on top of that would be a fourth encoding of facts already carried.
 */
export const DATACENTER_FILL_ALPHA = 0.32;

/** Constant-pixel anchor dot. It is the stem's head, not the size channel. */
export const DATACENTER_ANCHOR_PX = 6;
/** A hollow ring, at a size no filled dot uses, for "no emprise published". */
export const DATACENTER_POINTLESS_PX = 9;

/**
 * The four render classes, in the order the legend prints them.
 *
 * `count` is the measured population of the shipped pack, quoted so that a
 * re-extraction that shifts these proportions shows up as a stale comment
 * rather than as a silent change of what the map says.
 */
export const DATACENTER_SURFACES = Object.freeze([
  Object.freeze({
    key: 'volume',
    label: 'Volume bâti',
    color: DATACENTER_HALL_COLOR,
    count: 461,
    blurb: 'Emprise OSM extrudée à sa hauteur publiée — height en mètres, ou '
      + 'building:levels × 5 m (médiane mesurée sur les 59 objets qui portent '
      + 'les deux tags). 461 objets, 10,6 % du paquet.',
  }),
  Object.freeze({
    key: 'slab',
    label: 'Emprise seule',
    color: DATACENTER_HALL_COLOR,
    count: 2739,
    blurb: 'Emprise connue, hauteur non publiée : dessinée à plat, jamais '
      + 'extrudée. 2 739 objets, 63 % du paquet — c’est la raison pour '
      + 'laquelle aucune hauteur par défaut n’est inventée.',
  }),
  Object.freeze({
    key: 'site',
    label: 'Contour de site',
    color: DATACENTER_SITE_COLOR,
    count: 317,
    blurb: 'Polygone sans tag building : une clôture ou un campus, pas un '
      + 'hall — médiane 31 204 m² contre 5 008 m². Jamais extrudé, même '
      + 'quand un mappeur y a posé une hauteur (5 cas).',
  }),
  Object.freeze({
    key: 'point',
    label: 'Sans emprise',
    color: DATACENTER_HALL_COLOR,
    count: 834,
    blurb: 'Point OSM : aucune surface publiée. Anneau creux et non disque '
      + 'plein, parce qu’« absent » ne doit pas se lire « petit ». '
      + '834 objets, 19,2 %.',
  }),
]);

const SURFACE_BY_KEY = new Map(DATACENTER_SURFACES.map((entry) => [entry.key, entry]));

/**
 * Which of the four signs one feature draws.
 *
 * The area gate here is `> 0`, NOT {@link DATACENTER_MIN_AREA_M2}: the 61
 * polygons under 50 m² are real traced geometry and drawing them is honest,
 * even though PRINTING a two-significant-figure area for them would not be.
 * The card keeps the stricter gate; the map draws what was mapped.
 *
 * A site outline is never a volume. Five of the 317 carry a height tag, and
 * extruding a fence to it would present the height of whatever the mapper had
 * in mind as the height of the enclosure.
 *
 * @param {object} tags OSM tags.
 * @param {number} areaM2 Footprint from {@link geometryAreaM2}.
 * @returns {'volume'|'slab'|'site'|'point'}
 */
export function datacenterSurface(tags, areaM2) {
  const area = Number(areaM2);
  if (!Number.isFinite(area) || area <= 0) return 'point';
  const building = text(tags?.building).toLowerCase();
  const isBuilding = Boolean(building) && building !== 'no';
  if (!isBuilding) return 'site';
  return datacenterHeightM(tags) ? 'volume' : 'slab';
}

/**
 * The three published size marks, largest first — the legend's scale.
 *
 * FROZEN DOMAIN thresholds (C1): a hectare and ten hectares are units a reader
 * already owns, and 1 000 m² is the floor under which an OSM outline is more
 * about the tracing than about the site. They are never derived from what is
 * on screen. Counts are the shipped pack's, cumulative — `≥ 1 ha` includes the
 * 84 that are also `≥ 10 ha`.
 */
export const DATACENTER_AREA_MARKS = Object.freeze([
  Object.freeze({ key: 'ha10', minM2: 100_000, label: '≥ 10 ha', count: 84 }),
  Object.freeze({ key: 'ha1', minM2: 10_000, label: '≥ 1 ha', count: 1254 }),
  Object.freeze({ key: 'm1000', minM2: 1_000, label: '≥ 1 000 m²', count: 2976 }),
]);

/**
 * Graphite for the size marks. ONE colour for all three, because in those rows
 * the datum is the swatch's SIZE; a hue that moved with it would be a second,
 * false encoding. Same reasoning as `PRISM_HEIGHT_SWATCH_COLOR` next door.
 */
export const DATACENTER_SIZE_SWATCH_COLOR = '#c3ccd8';

/**
 * The area band one footprint falls in, or '' when it is under the smallest
 * published mark (or absent). Used as the second half of the tally key so the
 * legend can count the marks without a second pass over the pack.
 * @param {number} areaM2
 * @returns {string} A {@link DATACENTER_AREA_MARKS} key, or ''.
 */
export function datacenterAreaBand(areaM2) {
  const area = Number(areaM2);
  if (!Number.isFinite(area) || area <= 0) return '';
  for (const mark of DATACENTER_AREA_MARKS) {
    if (area >= mark.minM2) return mark.key;
  }
  return '';
}

/* ── Legend glyphs ─────────────────────────────────────────────────────────
 * Masked by the panel (see manager.js), so the fill colour written here is
 * discarded and the row's `color` is what shows. Only the SHAPE survives —
 * which is the point: this legend's channels are form and size, not hue.
 */

const _b64 = (value) => (typeof btoa === 'function'
  ? btoa(value)
  : Buffer.from(value, 'utf8').toString('base64'));

const GLYPH_BOX = 16;
/** @type {Map<string,string>} shape key → data URI. */
const _glyphCache = new Map();

function glyph(key, body) {
  const cached = _glyphCache.get(key);
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_BOX} ${GLYPH_BOX}">`
    + `${body}</svg>`;
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set(key, uri);
  return uri;
}

/** A box seen in relief — the extruded volume. */
const VOLUME_GLYPH = glyph('volume',
  '<path d="M2 9L8 5.5L14 9L8 12.5Z" fill="#000"/>'
  + '<path d="M2 9L2 12L8 15.5L8 12.5Z" fill="#000" opacity="0.75"/>'
  + '<path d="M14 9L14 12L8 15.5L8 12.5Z" fill="#000" opacity="0.5"/>');
/** The same box seen flat — footprint, no height. */
const SLAB_GLYPH = glyph('slab', '<path d="M2 8L8 4.5L14 8L8 11.5Z" fill="#000"/>');
/** The same outline, hollow — a fence encloses, it does not occupy. */
const SITE_GLYPH = glyph('site',
  '<path d="M2 8L8 4.5L14 8L8 11.5Z" fill="none" stroke="#000" stroke-width="1.6"/>');
/** A ring — nothing measured to be inside it. */
const RING_GLYPH = glyph('ring',
  '<circle cx="8" cy="8" r="4.6" fill="none" stroke="#000" stroke-width="1.8"/>');

/** A filled square whose SIDE is the datum, for the three area marks. */
function areaMarkGlyph(sidePx) {
  const side = Math.max(2, Math.min(GLYPH_BOX, Number(sidePx) || 2));
  const origin = (GLYPH_BOX - side) / 2;
  return glyph(`area:${side}`,
    `<rect x="${origin.toFixed(2)}" y="${origin.toFixed(2)}" `
    + `width="${side.toFixed(2)}" height="${side.toFixed(2)}" fill="#000"/>`);
}

const SURFACE_GLYPHS = Object.freeze({
  volume: VOLUME_GLYPH,
  slab: SLAB_GLYPH,
  site: SITE_GLYPH,
  point: RING_GLYPH,
});

/**
 * The render contract this pack hands `createLocalGeoJsonLayer` — one object
 * per feature, resolved once at load, in the shape documented there.
 *
 * @param {object} props Unwrapped feature properties (`{tags, ...}`).
 * @param {{areaM2?: number}} [measured] Facts read off the geometry.
 * @returns {object} Render spec.
 */
export function datacenterRenderSpec(props, { areaM2 = 0 } = {}) {
  const source = props && typeof props === 'object' ? props : {};
  const tags = source.tags && typeof source.tags === 'object' ? source.tags : {};
  const surface = datacenterSurface(tags, areaM2);
  const height = surface === 'volume' ? datacenterHeightM(tags) : null;
  const isSite = surface === 'site';
  return {
    key: `${surface}|${datacenterAreaBand(areaM2)}`,
    pixelSize: surface === 'point' ? DATACENTER_POINTLESS_PX : DATACENTER_ANCHOR_PX,
    // A1: no emprise published is a HOLLOW mark, never a small filled one.
    hollow: surface === 'point',
    color: isSite ? DATACENTER_SITE_COLOR : DATACENTER_HALL_COLOR,
    surface: surface === 'point' ? null : (surface === 'volume' ? 'volume' : 'flat'),
    // KNOWN RISK, deliberately left standing rather than papered over with a
    // colour rule. The flat class carries TWO colours — 2 739 halls in cyan
    // and 317 site outlines in slate — and both are terrain-clamped, so they
    // land in one batched ground-classification pass, which Cesium colours by
    // each instance's bounding RECTANGLE rather than its polygon. A site
    // outline encloses by construction the halls it surrounds (median
    // 31 204 m² against 5 008 m²), so its slate can bleed over them.
    //
    // Forcing the class monochrome via `surfaceColor` (the seam exists in
    // `applyLocalSurfaceStyle`) removes the bleed and also removes the one
    // distinction that matters here — a fence is not a hall — which this
    // module measured and its test pins. The fix that keeps both is a SECOND
    // GEOMETRY: draw a site outline as a clamped polyline, which is what a
    // fence is, and leave the fill class to the halls alone. That needs a new
    // path in the shared loader, not a colour, and it is not done.
    fillAlpha: DATACENTER_FILL_ALPHA,
    extrudedHeightM: height ? height.heightM : null,
  };
}

/**
 * Build the row/map legend from a live tally keyed by `datacenterRenderSpec`.
 *
 * Seven rows: four signs, then the three size marks. The signs answer "what am
 * I looking at"; the marks answer "how big is that", which a world-unit size
 * channel cannot answer on its own — a footprint drawn at its true extent has
 * no scale unless one is printed (D1).
 *
 * Counts are what is DRAWN. The key is composite (`surface|band`) so both
 * questions are answered from one pass, the same fold `damTierLegend` uses.
 *
 * @param {Map<string,{total:number, visible:number}>|object} tally
 * @returns {Array<{label:string,color:string,glyph:string,blurb:string,count:number}>}
 */
export function datacenterSurfaceLegend(tally) {
  const entries = tally instanceof Map ? [...tally] : Object.entries(tally || {});
  const bySurface = new Map();
  const byBand = new Map();
  for (const [key, bucket] of entries) {
    if (!bucket?.total) continue;
    const at = String(key).indexOf('|');
    const surface = at < 0 ? String(key) : String(key).slice(0, at);
    const band = at < 0 ? '' : String(key).slice(at + 1);
    for (const [map, id] of [[bySurface, surface], [byBand, band]]) {
      if (!id) continue;
      const seen = map.get(id) || { total: 0, visible: 0 };
      seen.total += bucket.total;
      seen.visible += bucket.visible ?? bucket.total;
      map.set(id, seen);
    }
  }

  const legend = [];
  for (const surface of DATACENTER_SURFACES) {
    const bucket = bySurface.get(surface.key);
    if (!bucket?.total) continue;
    const hidden = bucket.total - bucket.visible;
    legend.push({
      label: surface.label,
      color: surface.color,
      glyph: SURFACE_GLYPHS[surface.key],
      blurb: hidden > 0 ? `${surface.blurb} — ${hidden} masqué${hidden > 1 ? 's' : ''}` : surface.blurb,
      count: bucket.visible,
    });
  }
  // The marks are CUMULATIVE — `≥ 1 ha` counts the `≥ 10 ha` too — so they are
  // summed downward. A reader compares them to each other, not to the total.
  let running = 0;
  const sizes = [];
  for (const mark of DATACENTER_AREA_MARKS) {
    const bucket = byBand.get(mark.key);
    running += bucket?.visible ?? 0;
    if (!bucket?.total && running === 0) continue;
    sizes.push({
      label: mark.label,
      color: DATACENTER_SIZE_SWATCH_COLOR,
      glyph: areaMarkGlyph(4 + 4 * (DATACENTER_AREA_MARKS.length - sizes.length - 1)),
      blurb: 'Emprise dessinée à l’échelle du terrain, pas en pixels : elle '
        + 'rapetisse avec la distance comme le bâtiment qu’elle est.',
      count: running,
    });
  }
  legend.push(...sizes);
  return legend;
}

/** The surface entry behind one key, for callers that need its wording. */
export function datacenterSurfaceInfo(key) {
  return SURFACE_BY_KEY.get(String(key ?? '')) || null;
}
