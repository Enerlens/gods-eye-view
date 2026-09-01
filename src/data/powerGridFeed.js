/**
 * @module powerGridFeed
 *
 * Pure OpenStreetMap → power-grid projection for the **Power Grid** layer
 * (`/api/power-grid` proxy in `vite.config.js`, drawing in `powerGrid.js`).
 *
 * What this dataset IS: the transmission network as volunteers have mapped it —
 * high-voltage line routes (`power=line`), their underground counterparts
 * (`power=cable`), the substations they land in (`power=substation`), and the
 * pylons that hold them up (`power=tower` / `power=portal`). © OpenStreetMap
 * contributors under ODbL 1.0, loaded for the VIEWPORT the operator is looking
 * at, never as a country-wide download.
 *
 * What it is NOT: a grid register. OSM power coverage is very good in western
 * Europe and patchy elsewhere; a line that is not drawn here is not a line that
 * does not exist. Nothing in this module ever invents a feature, a voltage, or
 * a vertex.
 *
 * ── The line this module will not cross ─────────────────────────────────────
 *
 * A conductor hangs tens of metres above the ground and OSM does not say how
 * high, so this projection publishes the mapped GROUND ROUTE and the layer
 * clamps it to the terrain. Drawing a catenary would mean inventing the one
 * number the data withholds. The same rule kills every other temptation here:
 * a stroke is exactly the mapped way, decimated by nothing, rounded to five
 * decimals (~1.1 m) and no further.
 *
 * ── Six upstream traps, absorbed here and pinned in powerGridFeed.test.mjs ───
 *
 * 1. **A shared element cap starves whatever sorts last.** Overpass emits
 *    node → way → relation, so ONE capped union let 899 towers erase every line
 *    and substation in a Paris viewport (measured 2026-08-27, cap 900, zero
 *    ways returned). Every class gets its OWN output set and its own cap, and
 *    substations get one per element type — the real substation yards are ways
 *    and relations, and 197 street-corner nodes ate a 200-element substation
 *    cap before a single yard came back.
 *
 * 2. **`voltage` is a `;`-separated list carrying junk.** Real values from that
 *    same box: `225000;63000`, `400000;225000;90000`, `225000;225000;225000;63000`,
 *    and `225000;0` — a zero token for a circuit that is not energised.
 *    `Number('225000;63000')` is NaN, which would drop a 225 kV line out of the
 *    grid entirely. Tokens are parsed individually; the maximum positive one
 *    classifies the feature and the whole string travels to the card.
 *
 * 3. **`power=line` does not mean high voltage.** One way in that box is
 *    `power=line` at `voltage=400` — four hundred VOLTS. The Overpass prefilter
 *    regex is only a bandwidth optimisation; the 50 kV floor is enforced
 *    numerically here, so a mirror that ignores the regex cannot put a garden
 *    supply cable on the transmission layer.
 *
 * 4. **`substation=industrial` is a real poste source.** "Poste électrique de
 *    Villeras", operator RTE, `ref:FR:RTE=VLERA`, 225 kV, is tagged
 *    `substation=industrial`; so is a 63 kV RTE yard at Palaiseau. Filtering on
 *    `substation=transmission|distribution` would have thrown both away. The
 *    subtype is carried as a LABEL and never used as a filter — voltage is the
 *    filter, because voltage is the evidence.
 *
 * 5. **A relation substation has no `lat`/`lon`.** Multipolygon yards (Poste
 *    électrique de Haute-Borne, 225 kV) carry only Overpass's computed
 *    `center`; reading `element.lat` gives undefined and the yard vanishes.
 *
 * 6. **`power=cable` is the same network underground.** Same operators, same
 *    voltages, 550 of them against 1,650 overhead ways in one Île-de-France
 *    box. Drawing them identically would claim pylons that are not there, so
 *    `location` decides and the layer dashes them.
 *
 * Dependency-free and side-effect-free so the projection is unit-testable
 * without a Vite server — the same shape as `gasFranceFeed.js` and
 * `osmCameras.js`.
 */

/**
 * Voltage floor, in volts. 50 kV is the bottom of the high-voltage transmission
 * world essentially everywhere: France's HTB starts at 50 kV (63/90/150/225/400),
 * Germany at 110, the UK at 132, North America at 115/138. Below it a feature is
 * distribution — the street network — which is a different map and a different
 * order of magnitude in element count.
 */
export const POWER_GRID_MIN_VOLTAGE_V = 50_000;

/**
 * Overpass-side prefilter for `voltage`, as a regex over the `;` list.
 *
 * Reads as "any token that is six or more digits (≥ 100 000) OR five digits
 * starting 5-9 (50 000–99 999)" — i.e. exactly `>= 50 kV`, expressed in a form
 * Overpass's regex engine can evaluate. It exists purely to keep the response
 * small: the numeric floor above is what actually decides, and it re-checks
 * every element the mirror returns (trap 3).
 *
 * Measured on a 0.45° × 0.60° Paris box, 2026-08-27: the filter takes
 * substations from 619 elements — 404 of them street-corner
 * `minor_distribution` cabinets and cadastre-imported building footprints — to
 * 209 real high-voltage yards, 190 of which carry an RTE reference.
 */
export const POWER_GRID_VOLTAGE_PREFILTER = '(^|;)([0-9]{6,}|[5-9][0-9]{4})($|;)';

/**
 * Voltage bands, highest first. The thresholds are deliberately generic rather
 * than a list of French nominal voltages, so the same palette reads correctly on
 * the UK (400/275/132), German (380/220/110) and North American (500/345/230/115)
 * grids: the top band is always the national backbone.
 *
 * `minKv` is inclusive; a feature below the last band never reaches here because
 * of the 50 kV floor.
 */
export const POWER_GRID_TIERS = Object.freeze([
  Object.freeze({
    id: 'ehv',
    minKv: 300,
    label: '≥ 300 kV',
    blurb: 'The backbone. In France this is the 400 kV grid RTE runs the country on.',
    color: '#ff5f4d',
    widthPx: 3.2,
    pointPx: 15,
  }),
  Object.freeze({
    id: 'hv-high',
    minKv: 180,
    label: '180–299 kV',
    blurb: 'The regional transmission tier — 225 kV in France, 220 kV across much of Europe.',
    color: '#ff9d3c',
    widthPx: 2.5,
    pointPx: 12,
  }),
  Object.freeze({
    id: 'hv-mid',
    minKv: 100,
    label: '100–179 kV',
    blurb: 'Sub-transmission — 150 kV in France, 132 kV in the UK, 110 kV in Germany.',
    color: '#ffd84d',
    widthPx: 2,
    pointPx: 10,
  }),
  Object.freeze({
    id: 'hv-low',
    minKv: POWER_GRID_MIN_VOLTAGE_V / 1000,
    label: '50–99 kV',
    blurb: 'The last high-voltage step before distribution — France’s 63 kV and 90 kV network.',
    color: '#7ee0a8',
    widthPx: 1.6,
    pointPx: 8,
  }),
]);

const TIER_BY_ID = new Map(POWER_GRID_TIERS.map((tier) => [tier.id, tier]));

/**
 * `substation=*` values, mapped to what they mean on a card.
 *
 * Purely a LABEL table (trap 4): an unlisted or absent value produces the
 * "not stated" row rather than an exclusion, because RTE's own 225 kV yards
 * turn up tagged `industrial` and plenty of real ones carry no subtype at all.
 */
export const POWER_SUBSTATION_ROLES = Object.freeze({
  transmission: 'Transmission substation',
  distribution: 'Poste source (HV → distribution)',
  traction: 'Railway traction substation',
  industrial: 'Industrial / site substation',
  generation: 'Generation switchyard',
  transition: 'Overhead ↔ underground transition',
  converter: 'HVDC converter station',
  compensation: 'Reactive-compensation station',
  // Normally a street-corner transformer cabinet and far below this layer — but
  // one turns up in central London carrying a mapped 132 kV. Voltage is the
  // evidence, so it is drawn; the label repeats what OSM said rather than
  // promoting it or hiding the disagreement.
  minor_distribution: 'Tagged minor distribution, at high voltage',
});
/** Role shown when OSM records no `substation` subtype. */
export const POWER_SUBSTATION_ROLE_UNSTATED = 'Substation (role not stated)';

/**
 * Caption for one `substation` value.
 *
 * A value this table has never seen is REPEATED, not flattened into "not
 * stated": OSM did say something, and "substation=foo" is more honest than
 * implying the tag was missing. Only a genuinely absent tag gets the unstated
 * label.
 *
 * @param {*} value - Raw `substation` tag value.
 * @returns {string}
 */
export function substationRoleLabel(value) {
  const role = String(value ?? '').trim().toLowerCase();
  if (!role) return POWER_SUBSTATION_ROLE_UNSTATED;
  return POWER_SUBSTATION_ROLES[role]
    || `Tagged ${role.replaceAll('_', ' ')}`;
}

/** Largest viewport this source will answer, in degrees, on either axis. */
export const POWER_GRID_MAX_BOX_DEG = 0.8;
/**
 * Slack on that comparison, in degrees (~0.1 mm).
 *
 * A box whose span IS the limit must be accepted, and in binary floating point
 * 2.85 − 2.05 is 0.8000000000000003 — so a bare `>` refuses the exact box the
 * limit describes, arbitrarily, depending on which two numbers produced it.
 * (Caught 2026-08-27 against the live proxy, on the widest box the client can
 * ask for.) The tolerance is far below any span a camera can produce and far
 * below the coordinate precision this module publishes.
 */
export const POWER_GRID_BOX_TOLERANCE_DEG = 1e-9;

/**
 * Whether a box exceeds the per-axis span limit, tolerantly.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [maxDeg]
 * @returns {boolean}
 */
export function powerBoxTooWide(box, maxDeg = POWER_GRID_MAX_BOX_DEG) {
  const limit = maxDeg + POWER_GRID_BOX_TOLERANCE_DEG;
  return (box.north - box.south) > limit || (box.east - box.west) > limit;
}
/**
 * Outward snap grid (~5.5 km) — the "load a bit more than what is on screen"
 * margin. Neighbouring viewports quantize onto the SAME box so a short pan
 * re-uses the cached answer, and because the snap only ever GROWS the box a
 * cached answer is always a superset of what was asked for. Same technique and
 * step as the mapped-installation proxy.
 */
export const POWER_GRID_BOX_STEP_DEG = 0.05;
/**
 * Pylons are requested only when the SNAPPED box is this small (~28 km).
 *
 * Measured 2026-08-27: 2,893 towers in a 0.45° × 0.60° Paris box and 11,670 in
 * a 1.2° × 1.6° one. At those extents a pylon is a sub-pixel dot that costs
 * more bandwidth than the entire line network — so the wide view draws lines
 * and substations, and the pylons appear when you are close enough to tell them
 * apart. Deciding this from the SNAPPED box (not the requested one) keeps the
 * cache key a pure function of the box.
 */
export const POWER_GRID_TOWER_MAX_BOX_DEG = 0.25;

/**
 * Per-class Overpass output caps.
 *
 * Separate caps ARE the fix for trap 1: one shared cap is spent in element-type
 * order, so whichever class Overpass emits last gets nothing. Sized against the
 * densest real viewport measured (Île-de-France, 0.6° × 0.6°: 1,650 line ways,
 * 550 cables, 210 substations), with headroom, so saturation is the exception
 * rather than the rule — and reported when it happens.
 */
export const POWER_GRID_CAPS = Object.freeze({
  /** Lines + cables share one set: both are strokes and both are the subject. */
  strokes: 2600,
  substationWays: 300,
  substationNodes: 120,
  substationRelations: 60,
  towers: 2000,
});

/** Overpass `[timeout:]` for one viewport probe (seconds). */
export const POWER_GRID_QUERY_TIMEOUT_SEC = 50;

/** Coordinate precision kept on a projected stroke — ~1.1 m at the equator. */
export const POWER_GRID_COORD_DECIMALS = 5;

const EARTH_MEAN_RADIUS_KM = 6371.0088;

/**
 * Parse an OSM `voltage` value into its individual volt readings.
 *
 * OSM writes one `;`-separated token per circuit the feature carries, and the
 * list contains junk: repeated values on a shared route
 * (`225000;225000;225000;63000`), a step-down pair at a substation
 * (`90000;20000`), and `0` for a circuit that is present but not energised
 * (`225000;0`). Tokens that are not a positive finite number are dropped rather
 * than coerced — trap 2.
 *
 * @param {*} raw - Raw `voltage` tag value.
 * @returns {Array<number>} Distinct positive volt readings, highest first.
 */
export function parseOsmVoltages(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const seen = new Set();
  for (const token of text.split(';')) {
    const trimmed = token.trim();
    if (!/^\d+(?:\.\d+)?$/.test(trimmed)) continue;
    const volts = Number(trimmed);
    if (!Number.isFinite(volts) || volts <= 0) continue;
    seen.add(volts);
  }
  return [...seen].sort((a, b) => b - a);
}

/**
 * The volt reading that classifies a feature: the highest one it carries.
 *
 * A pylon route carrying 225 kV and 63 kV circuits is a 225 kV route — that is
 * the tower height, the corridor width, and the thing an operator means by "the
 * 225 line". The other readings still travel to the card.
 *
 * @param {*} raw - Raw `voltage` tag value.
 * @returns {number} Volts, or NaN when the tag says nothing usable.
 */
export function maxOsmVoltage(raw) {
  const volts = parseOsmVoltages(raw);
  return volts.length ? volts[0] : NaN;
}

/**
 * The band a voltage falls in, or null below the high-voltage floor.
 * @param {number} volts
 * @returns {?object} A frozen `POWER_GRID_TIERS` entry.
 */
export function powerVoltageTier(volts) {
  if (!Number.isFinite(volts) || volts < POWER_GRID_MIN_VOLTAGE_V) return null;
  const kv = volts / 1000;
  for (const tier of POWER_GRID_TIERS) {
    if (kv >= tier.minKv) return tier;
  }
  return null;
}

/** Look a tier up by id, for callers holding only a projected payload. */
export function powerTierById(id) {
  return TIER_BY_ID.get(String(id ?? '')) || null;
}

/**
 * Format a voltage the way a grid operator writes it: 400 kV, 225 kV, 63 kV.
 * @param {number} volts
 * @returns {string}
 */
export function formatKilovolts(volts) {
  if (!Number.isFinite(volts) || volts <= 0) return '—';
  const kv = volts / 1000;
  return `${kv >= 10 ? Math.round(kv) : Number(kv.toFixed(1))} kV`;
}

/**
 * Validate a viewport box: finite, ordered, non-dateline, and no wider than
 * POWER_GRID_MAX_BOX_DEG on either axis.
 *
 * @param {{south:*, west:*, north:*, east:*}} box
 * @returns {?{south:number, west:number, north:number, east:number}} Null if unusable.
 */
export function validPowerGridBox(box) {
  const south = Number(box?.south);
  const west = Number(box?.west);
  const north = Number(box?.north);
  const east = Number(box?.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  if (south >= north || west >= east) return null;
  if (powerBoxTooWide({ south, west, north, east })) return null;
  return { south, west, north, east };
}

/**
 * Snap a request box OUTWARD onto the shared cache grid.
 *
 * Rounding the ratio first matters: 0.7999.../0.05 lands a hair under an exact
 * grid line in binary floating point, which would snap a whole cell too far.
 *
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [stepDeg]
 * @returns {{south:number, west:number, north:number, east:number}}
 */
export function snapPowerGridBox(box, stepDeg = POWER_GRID_BOX_STEP_DEG) {
  const snap = (value, grow) => {
    const cells = Number((value / stepDeg).toFixed(9));
    return Number(((grow > 0 ? Math.ceil(cells) : Math.floor(cells)) * stepDeg).toFixed(6));
  };
  return {
    south: Math.max(-90, snap(box.south, -1)),
    west: Math.max(-180, snap(box.west, -1)),
    north: Math.min(90, snap(box.north, 1)),
    east: Math.min(180, snap(box.east, 1)),
  };
}

/** Stable cache key for a box, at the precision the query itself uses. */
export function powerGridBoxKey(box, decimals = 3) {
  return [box.south, box.west, box.north, box.east]
    .map((value) => Number(value).toFixed(decimals))
    .join(',');
}

/**
 * Whether a box is tight enough to be worth asking for pylons.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [maxDeg]
 * @returns {boolean}
 */
export function powerGridIncludesTowers(box, maxDeg = POWER_GRID_TOWER_MAX_BOX_DEG) {
  if (!box) return false;
  return !powerBoxTooWide(box, maxDeg);
}

/**
 * Build the Overpass QL probe for one viewport box.
 *
 * One bounded bbox per class (never an area/country scan), a separate output
 * statement per class so no class can starve another (trap 1), and a clamped
 * timeout — the same discipline the client-facing Overpass proxy enforces on
 * app queries.
 *
 * `out geom` on the strokes because a route without its vertices is nothing;
 * `out center tags` on substation ways and relations because a yard is drawn as
 * a point and its polygon would cost more than it says (trap 5 — a relation has
 * no `lat`/`lon` of its own, so `center` is not optional); `out body` on towers
 * because a node carries its own coordinates.
 *
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {object} [options]
 * @param {object} [options.caps] - Per-class element caps.
 * @param {number} [options.timeoutSec]
 * @param {boolean} [options.towers] - Whether to ask for pylons at all.
 * @returns {string} Overpass QL.
 */
export function powerGridQuery(box, {
  caps = POWER_GRID_CAPS,
  timeoutSec = POWER_GRID_QUERY_TIMEOUT_SEC,
  towers = powerGridIncludesTowers(box),
} = {}) {
  const timeout = Math.max(5, Math.min(90, Math.floor(timeoutSec)));
  const cap = (value, ceiling) => Math.max(1, Math.min(ceiling, Math.floor(Number(value) || 1)));
  const bbox = [box.south, box.west, box.north, box.east]
    .map((value) => Number(value).toFixed(6))
    .join(',');
  const voltage = `["voltage"~"${POWER_GRID_VOLTAGE_PREFILTER}"]`;
  return `[out:json][timeout:${timeout}];`
    + `way["power"~"^(line|cable)$"]${voltage}(${bbox})->.s;`
    + `way["power"="substation"]${voltage}(${bbox})->.pw;`
    + `node["power"="substation"]${voltage}(${bbox})->.pn;`
    + `relation["power"="substation"]${voltage}(${bbox})->.pr;`
    + `.s out geom ${cap(caps.strokes, 6000)};`
    + `.pw out center tags ${cap(caps.substationWays, 1000)};`
    + `.pn out tags ${cap(caps.substationNodes, 1000)};`
    + `.pr out center tags ${cap(caps.substationRelations, 500)};`
    + (towers
      ? `node["power"~"^(tower|portal)$"](${bbox})->.t;.t out body ${cap(caps.towers, 6000)};`
      : '');
}

/** Round one coordinate to the precision this projection publishes. */
function roundCoord(value) {
  return Number(Number(value).toFixed(POWER_GRID_COORD_DECIMALS));
}

/**
 * Great-circle length of a flat `[lon, lat, lon, lat, …]` stroke, in km.
 * @param {Array<number>} coords
 * @returns {number}
 */
export function strokeLengthKm(coords) {
  if (!Array.isArray(coords) || coords.length < 4) return 0;
  const toRad = Math.PI / 180;
  let km = 0;
  for (let i = 2; i < coords.length; i += 2) {
    const lon1 = coords[i - 2] * toRad;
    const lat1 = coords[i - 1] * toRad;
    const lon2 = coords[i] * toRad;
    const lat2 = coords[i + 1] * toRad;
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    km += 2 * EARTH_MEAN_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return km;
}

/**
 * Whether a stroke runs underground.
 *
 * `location` is the mapped answer and wins outright — including the mistagged
 * cases in both directions (`power=line` + `location=underground`, and the rare
 * `power=cable` strung overhead). Only when it is silent does the key itself
 * decide, which is what `power=cable` means by convention (trap 6).
 *
 * @param {Record<string,string>} tags
 * @returns {boolean}
 */
export function strokeIsUnderground(tags = {}) {
  const location = String(tags.location || '').trim().toLowerCase();
  if (location === 'underground' || location === 'underwater') return true;
  if (location === 'overhead' || location === 'outdoor' || location === 'overground') return false;
  return String(tags.power || '').trim().toLowerCase() === 'cable';
}

/** Trimmed tag string, or null. Keeps a card from printing whitespace. */
function tagText(value, maxLength = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * Parse an OSM `height` value (metres) for a pylon.
 * Only the plain metric forms — a pylon height is a survey number, and a value
 * this cannot read is reported as absent rather than guessed.
 * @param {*} value
 * @returns {number} Metres, or NaN.
 */
export function parseTowerHeightM(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(?:m|meter|meters|metre|metres)?$/);
  if (!match) return NaN;
  const meters = Number(match[1]);
  return meters > 0 && meters <= 300 ? meters : NaN;
}

/** Interning dictionary: repeated strings become one entry and an index. */
function makeDictionary() {
  const values = [];
  const index = new Map();
  return {
    values,
    /** @returns {number} Index, or -1 for an absent value. */
    intern(value) {
      if (value === null || value === undefined) return -1;
      const existing = index.get(value);
      if (existing !== undefined) return existing;
      const next = values.push(value) - 1;
      index.set(value, next);
      return next;
    },
  };
}

/**
 * Project one Overpass response into the document the proxy serves.
 *
 * Everything the client needs to draw and to caption, and nothing it does not:
 * strokes as flat coordinate arrays, substations and pylons as points, and the
 * three strings that repeat across thousands of elements — operator, route
 * name, and the raw voltage list — interned into dictionaries. On the densest
 * viewport measured (Île-de-France 0.6°, 2,200 strokes, 48,439 vertices) that
 * takes Overpass's 3.8 MB down to about 825 KB.
 *
 * @param {object} payload - Parsed Overpass JSON (`{elements: [...]}`).
 * @param {object} [options]
 * @param {object} [options.caps] - The caps the query used, for saturation.
 * @param {boolean} [options.towersRequested] - Whether pylons were asked for.
 * @returns {object} Projected document.
 */
export function projectPowerGrid(payload, {
  caps = POWER_GRID_CAPS,
  towersRequested = true,
} = {}) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];

  const operators = makeDictionary();
  const routes = makeDictionary();
  /** Interned voltage readings: one entry per distinct raw `voltage` string. */
  const voltageValues = [];
  const voltageIndex = new Map();
  const internVoltage = (raw) => {
    const text = String(raw ?? '').trim();
    const existing = voltageIndex.get(text);
    if (existing !== undefined) return existing;
    const volts = parseOsmVoltages(text);
    const tier = powerVoltageTier(volts[0]);
    const entry = {
      raw: text,
      v: volts.length ? volts[0] : null,
      all: volts,
      tier: tier ? tier.id : null,
    };
    const next = voltageValues.push(entry) - 1;
    voltageIndex.set(text, next);
    return next;
  };

  const strokes = [];
  const substations = [];
  const towers = [];
  /** Per-class element counts, for the saturation report. */
  const counts = {
    strokes: 0, substationWays: 0, substationNodes: 0, substationRelations: 0, towers: 0,
  };
  /** Elements the mirror returned that this projection refused. */
  const rejected = { belowFloor: 0, noGeometry: 0, noPosition: 0 };

  for (const element of elements) {
    const tags = element?.tags;
    if (!tags || typeof tags !== 'object') continue;
    const kind = String(tags.power || '').trim().toLowerCase();
    const type = String(element.type || '').trim().toLowerCase();

    if (kind === 'line' || kind === 'cable') {
      counts.strokes += 1;
      // Trap 3: the Overpass regex is a bandwidth filter, not the rule. A 400 V
      // way tagged `power=line` is not transmission, whatever the mirror sent.
      const volts = maxOsmVoltage(tags.voltage);
      const tier = powerVoltageTier(volts);
      if (!tier) { rejected.belowFloor += 1; continue; }
      const geometry = Array.isArray(element.geometry) ? element.geometry : [];
      const coords = [];
      for (const point of geometry) {
        const lon = Number(point?.lon);
        const lat = Number(point?.lat);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        coords.push(roundCoord(lon), roundCoord(lat));
      }
      // Overpass can return a way whose geometry was clipped to nothing; a
      // single vertex is a point, not a route, and is dropped rather than drawn.
      if (coords.length < 4) { rejected.noGeometry += 1; continue; }
      strokes.push({
        id: `${type.charAt(0) || 'w'}${element.id}`,
        c: coords,
        vi: internVoltage(tags.voltage),
        o: operators.intern(tagText(tags.operator, 80)),
        n: routes.intern(tagText(tags.name)),
        u: strokeIsUnderground(tags) ? 1 : 0,
        km: Number(strokeLengthKm(coords).toFixed(3)),
        circuits: Number.isFinite(Number(tags.circuits)) ? Number(tags.circuits) : null,
      });
      continue;
    }

    if (kind === 'substation') {
      if (type === 'way') counts.substationWays += 1;
      else if (type === 'relation') counts.substationRelations += 1;
      else counts.substationNodes += 1;
      const volts = maxOsmVoltage(tags.voltage);
      const tier = powerVoltageTier(volts);
      if (!tier) { rejected.belowFloor += 1; continue; }
      // Trap 5: a relation (and a way under `out center`) carries no lat/lon.
      const lat = Number(element.lat ?? element.center?.lat);
      const lon = Number(element.lon ?? element.center?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) { rejected.noPosition += 1; continue; }
      const role = String(tags.substation || '').trim().toLowerCase();
      substations.push({
        id: `${type.charAt(0) || 'n'}${element.id}`,
        lat: roundCoord(lat),
        lon: roundCoord(lon),
        // Trap 4: the subtype is a caption, never a filter.
        role: role || null,
        roleLabel: substationRoleLabel(role),
        name: tagText(tags.name),
        ref: tagText(tags['ref:FR:RTE'] || tags.ref, 40),
        vi: internVoltage(tags.voltage),
        o: operators.intern(tagText(tags.operator, 80)),
      });
      continue;
    }

    if (kind === 'tower' || kind === 'portal') {
      counts.towers += 1;
      const lat = Number(element.lat ?? element.center?.lat);
      const lon = Number(element.lon ?? element.center?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) { rejected.noPosition += 1; continue; }
      const heightM = parseTowerHeightM(tags.height);
      towers.push({
        id: `${String(element.type || 'node').charAt(0) || 'n'}${element.id}`,
        lat: roundCoord(lat),
        lon: roundCoord(lon),
        portal: kind === 'portal' ? 1 : 0,
        design: tagText(tags.design, 40),
        ref: tagText(tags.ref, 40),
        h: Number.isFinite(heightM) ? heightM : null,
        o: operators.intern(tagText(tags.operator, 80)),
      });
    }
  }

  // Per-tier roll-up, in the fixed band order so the legend never reshuffles.
  const tierStats = new Map(POWER_GRID_TIERS.map((tier) => [tier.id, {
    id: tier.id,
    label: tier.label,
    blurb: tier.blurb,
    color: tier.color,
    strokes: 0,
    lengthKm: 0,
    overheadKm: 0,
    undergroundKm: 0,
    substations: 0,
  }]));
  let lengthKm = 0;
  let undergroundKm = 0;
  for (const stroke of strokes) {
    const tier = tierStats.get(voltageValues[stroke.vi]?.tier);
    lengthKm += stroke.km;
    if (stroke.u) undergroundKm += stroke.km;
    if (!tier) continue;
    tier.strokes += 1;
    tier.lengthKm += stroke.km;
    if (stroke.u) tier.undergroundKm += stroke.km;
    else tier.overheadKm += stroke.km;
  }
  const byRole = {};
  for (const substation of substations) {
    const tier = tierStats.get(voltageValues[substation.vi]?.tier);
    if (tier) tier.substations += 1;
    const key = substation.role || 'unstated';
    byRole[key] = (byRole[key] || 0) + 1;
  }
  const round1 = (value) => Number(value.toFixed(1));
  const tiers = [...tierStats.values()]
    .filter((tier) => tier.strokes || tier.substations)
    .map((tier) => ({
      ...tier,
      lengthKm: round1(tier.lengthKm),
      overheadKm: round1(tier.overheadKm),
      undergroundKm: round1(tier.undergroundKm),
    }));

  return {
    strokes,
    substations,
    towers,
    operators: operators.values,
    routes: routes.values,
    voltages: voltageValues,
    tiers,
    stats: {
      strokes: strokes.length,
      lengthKm: round1(lengthKm),
      overheadKm: round1(lengthKm - undergroundKm),
      undergroundKm: round1(undergroundKm),
      substations: substations.length,
      towers: towers.length,
      byRole,
      // Distinct mapped route names in view — the closest honest answer to
      // "how many LINES am I looking at", which the way count is not.
      routes: routes.values.length,
      rejected,
    },
    // Honest truncation, per class: Overpass cut the result, so the box holds
    // more of that class than was served. Reported rather than hidden, because
    // a truncated stroke set has GAPS in it and the legend has to say so.
    saturated: {
      strokes: counts.strokes >= caps.strokes,
      substations: counts.substationWays >= caps.substationWays
        || counts.substationNodes >= caps.substationNodes
        || counts.substationRelations >= caps.substationRelations,
      towers: towersRequested && counts.towers >= caps.towers,
    },
    caps: { ...caps },
    towersRequested: Boolean(towersRequested),
  };
}
