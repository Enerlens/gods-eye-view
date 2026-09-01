/**
 * ODRÉ gas-system feed projection — pure functions, no Cesium, no network.
 *
 * Shared by the `/api/gas-fr` proxy (which runs these server-side, once, and
 * caches the result) and by the unit tests, which run them against captured
 * payloads. Every trap documented here was measured against the live datasets
 * on 2026-08-27 and is pinned by a test on a real captured row — the same
 * arrangement `eco2mixFeed.js` uses for éCO2mix.
 *
 * Four ODRÉ datasets, all keyless, all Licence Ouverte 2.0:
 *
 *   `trace-du-reseau-grt-250`   NaTran (ex-GRTgaz) transmission trace, 11 615 rows
 *   `terega-trace-du-reseau`    Teréga transmission trace, 1 298 rows
 *   `prod-elec-gaz-naturel-fr`  centralised gas-fired power stations, 98 rows
 *   `points-dinjection-de-biomethane-en-france`
 *                               renewable-methane injection points, 854 rows
 *
 * ── The traps, in the order they would bite ─────────────────────────────────
 *
 * 1. **The power-station file publishes every station seven times.** Its 98
 *    rows are 14 sites × 7 annual editions (`annee_de_reference` 2019…2025).
 *    Summing the column gives 50 372 MW for a fleet that is 7 196 MW, and
 *    plotting the rows puts seven stacked dots on each of 14 coordinates. Only
 *    the newest edition of each site survives; the older six are counted and
 *    named as superseded, never drawn.
 *
 * 2. **And the editions disagree with each other.** Landivisiau is `En projet`
 *    in the 2019 and 2020 editions, `En service` from 2021, and publishes its
 *    commissioning date only from the 2022 edition onward. Nothing protects a
 *    reader from landing on the wrong one: the `exports/json` endpoint answers
 *    2025 first, the `records` endpoint answered 2023, 2022, 2025, 2021, 2024,
 *    2019, 2020 for that same station, and neither promises an order. "The
 *    first row per site" is a coin flip that lands two times in seven on a
 *    station that has been running for five years being drawn as a project
 *    that never opened. Newest edition wins, and the card names the edition it
 *    read — and names the status the older ones claimed.
 *
 * 3. **Teréga's third ordinate is not a height.** Teréga publishes
 *    `[lon, lat, z]` where NaTran publishes `[lon, lat]`; that z runs from
 *    −705.5 m to +1 809.4 m over a footprint whose real ground is roughly
 *    0–1 500 m, with 514 vertices below sea level. It is neither a burial
 *    depth nor a ground height, so it is dropped and the stroke is clamped to
 *    the ground. Worse, feeding those 3-tuples to a flat lon/lat reader
 *    silently mis-plots the whole network, so the arity is checked per vertex
 *    rather than per dataset.
 *
 * 4. **One null geometry and eight MultiLineStrings in a file that is
 *    otherwise all LineString.** Teréga row Hautes-Pyrénées publishes
 *    `geo_shape: null`, and 8 rows are MultiLineString carrying 38 parts;
 *    NaTran is 11 615 plain LineStrings. Assuming the NaTran shape throws on
 *    one row and silently drops eight.
 *
 * 5. **Fifteen decimals on a ±250 m product.** Both traces publish
 *    coordinates to ~1e-15° — sub-nanometre — under titles that say they are
 *    simplified to about 250 m. They are rounded to 5 decimals (~1.1 m, still
 *    200× finer than the product's own stated accuracy), which costs nothing
 *    and reveals 165 published "lines" — 147 NaTran and 18 Teréga — whose
 *    vertices are all one point.
 *
 * 6. **`site_ouvert` is the string `"False"`.** Three of the 854 injection
 *    sites in a file titled *en service* are closed, each with a closure date
 *    and its capacity zeroed. `Boolean("False")` is `true` in JavaScript, so
 *    the naive read draws three closed plants at zero size.
 *
 * 7. **Most injection points feed a network this layer does not draw.** 743 of
 *    854 inject into the *distribution* network (GRDF and the local ELDs), 111
 *    into the transmission network whose trace is on screen. Both are drawn
 *    and both are counted, but they are distinguished — an injection point on
 *    the distribution network is not connected to the stroke it happens to sit
 *    beside.
 *
 * 8. **The catalogue's own `modified` date is wrong.** ODRÉ reports
 *    `modified: 2019-11-30` for a power-station file that carries a 2025
 *    edition. Licence Ouverte 2.0 obliges publishing the data's update date,
 *    so what travels to the client is the edition year the projection actually
 *    read, never the catalogue's metadata.
 *
 * ── What this module deliberately does NOT do ───────────────────────────────
 *
 * • It never densifies, smooths or re-routes a trace. Both networks are
 *   published simplified on purpose; drawing a "better" pipeline than the
 *   operator published would invent infrastructure siting.
 * • It never merges NaTran strokes with Teréga strokes. They are two
 *   companies' pipes; their bounding boxes overlap (58 NaTran rows sit inside
 *   Teréga's box) but a shared box is not a shared asset.
 * • It never joins an injection point or a power station to a pipe. Nothing in
 *   any of these four files publishes that link.
 *
 * @module data/gasFranceFeed
 */

/** Coordinate precision kept, in decimal places (~1.1 m at French latitudes). */
export const GAS_COORD_DECIMALS = 5;

/** Mean Earth radius used for stroke lengths, km. */
const EARTH_RADIUS_KM = 6371.0088;

/**
 * The two transmission-network operators, with the dataset each publishes.
 *
 * GRTgaz renamed itself **NaTran** in 2025; the dataset id still says `grt`
 * and the catalogue title already says NaTran, so the label carries both —
 * anyone who knows this network knows it by the old name.
 *
 * The two hues are violet and orchid on purpose. A pipeline drawn in any blue
 * is invisible on a map: measured against the OSM stack, a steel-blue stroke
 * sat inside 14/255 of the basemap's own river colour and read as a river,
 * while rendering perfectly — the failure mode a screenshot cannot catch and a
 * pixel count can (see `scripts/qa-gas-fr.mjs`). Violet and orchid occur in no
 * basemap, and neither collides with the orange power stations or the green
 * injection points.
 *
 * BOTH WERE THEN RAISED, AND THE HUE CHOICE IS WHY THEY ONLY NEEDED RAISING.
 * The first pair (`#9d7ae6` violet, `#e87ad0` orchid) cleared the river test
 * and still lost to IGN ortho: a mid-chroma pastel over aerial imagery has
 * nothing to be lighter or darker than, because the imagery supplies every
 * value at once. The answer is not another hue — the hue reasoning above still
 * holds, and the violet band is now crowded anyway (submarine cables at
 * `#b388ff`, road obstacles at `#b06bff`) — it is more chroma HERE plus the
 * dark casing the layer now strokes under every pipe. See `gasFrance.js`.
 *
 * The pair below therefore keeps both hues and pushes each one out: violet
 * stays violet, orchid stays orchid, and the operator channel a reader has
 * already learned survives the change.
 */
export const GAS_NETWORK_OPERATORS = Object.freeze({
  natran: Object.freeze({
    id: 'natran',
    label: 'NaTran (ex-GRTgaz)',
    dataset: 'trace-du-reseau-grt-250',
    color: '#c08bff',
    depField: 'departement',
    regionField: 'nom_region',
  }),
  terega: Object.freeze({
    id: 'terega',
    label: 'Teréga',
    dataset: 'terega-trace-du-reseau',
    color: '#ff6ad5',
    depField: 'nom_du_departement',
    regionField: 'region',
  }),
});

/** Stable operator order, so the legend and the payload never reshuffle. */
export const GAS_NETWORK_OPERATOR_IDS = Object.freeze(['natran', 'terega']);

/** Colour for the gas-fired power stations — the system's outlet. */
export const GAS_PLANT_COLOR = '#ff8c42';
/** Colour for renewable-methane injection points — the system's inlet. */
export const GAS_INJECTION_COLOR = '#5ddc8f';

/** Injection points reaching the transmission network vs the distribution one. */
export const GAS_NETWORK_TIERS = Object.freeze({
  transport: Object.freeze({
    id: 'transport',
    label: 'Transport',
    blurb: 'Injects into the transmission network drawn here.',
  }),
  distribution: Object.freeze({
    id: 'distribution',
    label: 'Distribution',
    blurb: 'Injects into the local distribution network, which this layer does not draw.',
  }),
});

/**
 * Read an Opendatasoft boolean.
 *
 * The injection file publishes `site_ouvert` as the STRINGS `"True"` and
 * `"False"`, and `Boolean("False")` is `true`. Anything not recognised is
 * `null` — "not published" and "false" are different facts, and a closed site
 * must never arrive here as "probably open".
 * @param {*} value
 * @returns {?boolean}
 */
export function parseOdsBoolean(value) {
  if (value === true || value === false) return value;
  if (value === null || value === undefined) return null;
  const token = String(value).trim().toLowerCase();
  if (token === 'true' || token === '1' || token === 'oui' || token === 'yes') return true;
  if (token === 'false' || token === '0' || token === 'non' || token === 'no') return false;
  return null;
}

/**
 * Finite number or null. `''`, `null` and `'N/A'` are all "not published";
 * none of them is zero.
 * @param {*} value
 * @returns {?number}
 */
export function parseOdsNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(numeric) ? numeric : null;
}

/** Trimmed non-empty string, or null. @param {*} value @returns {?string} */
function text(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Rows out of either envelope Opendatasoft answers with: the `records` API
 * returns `{total_count, results}`, the `exports/json` endpoint returns a bare
 * array. The proxy uses the export endpoint; the fixtures were captured
 * through it; a caller holding the other shape must not silently see zero rows.
 * @param {*} payload
 * @returns {Array<object>}
 */
export function odsRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

/**
 * Round to the kept precision. Ordinary `toFixed` would return a string and
 * re-parsing it per vertex is measurable across 50 000 of them.
 * @param {number} value
 * @returns {number}
 */
function round5(value) {
  return Math.round(value * 1e5) / 1e5;
}

/**
 * Great-circle length of a lon/lat ring, in kilometres.
 * @param {Array<[number, number]>} coordinates
 * @returns {number}
 */
export function polylineLengthKm(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const [lon1, lat1] = coordinates[i - 1];
    const [lon2, lat2] = coordinates[i];
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dPhi = phi2 - phi1;
    const dLambda = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dPhi / 2) ** 2
      + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    total += 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return total;
}

/**
 * Every lon/lat part of one `geo_shape`, whatever shape it arrives in.
 *
 * Absorbs traps 3, 4 and 5 in one pass: the ODRÉ `geo_shape` is a GeoJSON
 * *Feature* on one dataset and a bare geometry on the other; the type is
 * LineString or MultiLineString; vertices are 2-tuples on one network and
 * 3-tuples on the other, and the third ordinate is dropped. Coordinates are
 * rounded and consecutive duplicates collapsed, which is what makes a
 * degenerate part detectable at all.
 *
 * @param {*} shape A `geo_shape` cell.
 * @returns {{parts: Array<Array<[number, number]>>, dropped: number, hadHeights: boolean}}
 *   `dropped` counts parts that collapsed to a single point at kept precision.
 */
export function gasShapeParts(shape) {
  const geometry = shape && typeof shape === 'object'
    ? (shape.geometry && typeof shape.geometry === 'object' ? shape.geometry : shape)
    : null;
  const type = text(geometry?.type);
  const raw = geometry?.coordinates;
  let sequences = [];
  if (type === 'LineString' && Array.isArray(raw)) sequences = [raw];
  else if (type === 'MultiLineString' && Array.isArray(raw)) sequences = raw.filter(Array.isArray);

  const parts = [];
  let dropped = 0;
  let hadHeights = false;
  for (const sequence of sequences) {
    const points = [];
    for (const vertex of sequence) {
      if (!Array.isArray(vertex) || vertex.length < 2) continue;
      if (vertex.length > 2) hadHeights = true;
      const lon = parseOdsNumber(vertex[0]);
      const lat = parseOdsNumber(vertex[1]);
      if (lon === null || lat === null) continue;
      if (Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
      const point = [round5(lon), round5(lat)];
      const previous = points[points.length - 1];
      if (previous && previous[0] === point[0] && previous[1] === point[1]) continue;
      points.push(point);
    }
    if (points.length >= 2) parts.push(points);
    else if (sequence.length > 0) dropped += 1;
  }
  return { parts, dropped, hadHeights };
}

/** Node key for endpoint matching — exact, at the kept precision. */
function nodeKey(point) {
  return `${point[0]},${point[1]}`;
}

/**
 * Concatenate published segments that share an endpoint exactly.
 *
 * The traces are published as thousands of short pieces — 4 834 of NaTran's
 * 11 615 rows are two-point segments — and a piece only ever joins another at
 * a vertex both already publish. Chaining through nodes of degree exactly 2
 * therefore moves no vertex, invents nothing, and halves the number of clamped
 * ground strokes the globe has to build. A node where three or more pieces
 * meet is a real junction and always ends a stroke.
 *
 * @param {Array<Array<[number, number]>>} segments
 * @returns {Array<Array<[number, number]>>}
 */
export function chainGasSegments(segments) {
  const incident = new Map();
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    for (const key of [nodeKey(segment[0]), nodeKey(segment[segment.length - 1])]) {
      const bucket = incident.get(key);
      if (bucket) bucket.push(i);
      else incident.set(key, [i]);
    }
  }
  const used = new Array(segments.length).fill(false);
  const chains = [];
  for (let i = 0; i < segments.length; i += 1) {
    if (used[i]) continue;
    used[i] = true;
    let chain = segments[i].slice();
    for (const atTail of [true, false]) {
      for (;;) {
        // A ring has closed on itself — extending further would revisit it.
        if (chain.length > 2 && nodeKey(chain[0]) === nodeKey(chain[chain.length - 1])) break;
        const node = atTail ? chain[chain.length - 1] : chain[0];
        const bucket = incident.get(nodeKey(node)) || [];
        if (bucket.length !== 2) break;
        const next = bucket.find((index) => !used[index]);
        if (next === undefined) break;
        used[next] = true;
        const segment = segments[next].slice();
        if (atTail) {
          if (nodeKey(segment[0]) !== nodeKey(node)) segment.reverse();
          chain = chain.concat(segment.slice(1));
        } else {
          if (nodeKey(segment[segment.length - 1]) !== nodeKey(node)) segment.reverse();
          chain = segment.slice(0, -1).concat(chain);
        }
      }
    }
    chains.push(chain);
  }
  return chains;
}

/**
 * Project one operator's trace into drawable strokes.
 *
 * Chaining is scoped to a département so the only attribute either file
 * publishes about a pipe survives the merge — a stroke that spanned two
 * départements could honestly claim neither.
 *
 * @param {*} payload Raw ODRÉ rows (export array or records envelope).
 * @param {{id: string, label: string, dataset: string, color: string,
 *   depField: string, regionField: string}} operator
 * @returns {{strokes: Array<object>, groups: Array<object>, summary: object}}
 */
export function projectGasTrace(payload, operator) {
  const rows = odsRows(payload);
  /** @type {Map<string, {dep: ?string, region: ?string, segments: Array<Array<[number, number]>>}>} */
  const groups = new Map();
  let publishedParts = 0;
  let degenerateParts = 0;
  let rowsWithoutGeometry = 0;
  let rowsWithoutDepartement = 0;
  let multiPartRows = 0;
  let heightRows = 0;

  for (const row of rows) {
    const shape = row?.geo_shape;
    if (!shape) {
      rowsWithoutGeometry += 1;
      continue;
    }
    const { parts, dropped, hadHeights } = gasShapeParts(shape);
    degenerateParts += dropped;
    if (hadHeights) heightRows += 1;
    if (parts.length > 1) multiPartRows += 1;
    if (!parts.length) {
      if (!dropped) rowsWithoutGeometry += 1;
      continue;
    }
    const dep = text(row?.[operator.depField]);
    const region = text(row?.[operator.regionField]);
    if (!dep) rowsWithoutDepartement += 1;
    const key = dep || '—';
    let group = groups.get(key);
    if (!group) {
      group = { dep, region, segments: [] };
      groups.set(key, group);
    }
    // The region is published per row; the first non-null one in a département
    // names the group. They never disagree in the captured files, and if a
    // future edition does, the département is the attribute that matters.
    if (!group.region && region) group.region = region;
    for (const part of parts) {
      group.segments.push(part);
      publishedParts += 1;
    }
  }

  // The département and région are the same two strings for every stroke in a
  // group, and there are 7 199 strokes against 95 groups. They travel once, in
  // `groups`, and each stroke carries the index — worth ~320 KB on the wire.
  const strokes = [];
  const groupList = [];
  let vertices = 0;
  let lengthKm = 0;
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key);
    const groupIndex = groupList.length;
    groupList.push({ o: operator.id, d: group.dep, r: group.region });
    for (const chain of chainGasSegments(group.segments)) {
      const flat = new Array(chain.length * 2);
      for (let i = 0; i < chain.length; i += 1) {
        flat[i * 2] = chain[i][0];
        flat[i * 2 + 1] = chain[i][1];
      }
      const km = polylineLengthKm(chain);
      lengthKm += km;
      vertices += chain.length;
      strokes.push({ g: groupIndex, km: Math.round(km * 100) / 100, c: flat });
    }
  }

  return {
    strokes,
    groups: groupList,
    summary: {
      id: operator.id,
      label: operator.label,
      dataset: operator.dataset,
      color: operator.color,
      rows: rows.length,
      publishedParts,
      strokes: strokes.length,
      vertices,
      lengthKm: Math.round(lengthKm),
      departements: groups.size,
      degenerateParts,
      rowsWithoutGeometry,
      rowsWithoutDepartement,
      multiPartRows,
      // Trap 3: says out loud that a third ordinate was present and discarded.
      heightRows,
    },
  };
}

/**
 * Project both traces into one network document.
 * @param {{natran: *, terega: *}} payloads
 * @param {string} source Attribution string carried to the client.
 * @returns {{source: string, operators: Array<object>, groups: Array<object>,
 *   strokes: Array<object>, stats: object}}
 */
export function projectGasNetwork(payloads, source = 'ODRÉ (odre.opendatasoft.com)') {
  const operators = [];
  const groups = [];
  const strokes = [];
  for (const id of GAS_NETWORK_OPERATOR_IDS) {
    const operator = GAS_NETWORK_OPERATORS[id];
    const projected = projectGasTrace(payloads?.[id], operator);
    operators.push(projected.summary);
    const offset = groups.length;
    for (const group of projected.groups) groups.push(group);
    // Re-based, because each operator numbered its own groups from zero.
    for (const stroke of projected.strokes) strokes.push({ ...stroke, g: stroke.g + offset });
  }
  return {
    source,
    operators,
    groups,
    strokes,
    stats: {
      strokes: strokes.length,
      vertices: operators.reduce((sum, o) => sum + o.vertices, 0),
      lengthKm: operators.reduce((sum, o) => sum + o.lengthKm, 0),
      publishedParts: operators.reduce((sum, o) => sum + o.publishedParts, 0),
    },
  };
}

/** Slugify a site name into a stable id fragment. */
function slug(value, fallback) {
  const base = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || fallback;
}

/**
 * Edition year of a power-station row.
 *
 * `annee_de_reference` is typed `date` in the catalogue but arrives as the
 * bare string `"2025"`, so it is read as a year rather than parsed as a date —
 * `new Date('2025')` is a valid date and would quietly work until the day the
 * publisher writes a full ISO stamp in a different timezone.
 * @param {*} value
 * @returns {?number}
 */
export function parseEditionYear(value) {
  const match = /^\s*(\d{4})/.exec(String(value ?? ''));
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1900 && year <= 2200 ? year : null;
}

/**
 * Project the centralised gas-fired power stations, newest edition per site.
 *
 * Absorbs traps 1, 2 and 8: the file is seven annual editions stacked in one
 * table, the editions disagree about status and commissioning date, and the
 * catalogue's `modified` date predates the newest edition by six years.
 *
 * @param {*} payload Raw ODRÉ rows.
 * @returns {{plants: Array<object>, stats: object}}
 */
export function projectGasPlants(payload) {
  const rows = odsRows(payload);
  /** @type {Map<string, {rows: Array<object>}>} */
  const sites = new Map();
  let rowsWithoutGeometry = 0;

  for (const row of rows) {
    const lon = parseOdsNumber(row?.point_geo?.lon ?? row?.longitude_site);
    const lat = parseOdsNumber(row?.point_geo?.lat ?? row?.latitude_site);
    if (lon === null || lat === null || (lon === 0 && lat === 0)) {
      rowsWithoutGeometry += 1;
      continue;
    }
    const name = text(row?.site) || 'Centrale';
    // The coordinate is part of the key: two editions of one site always share
    // it, and it is what makes the key survive a renamed site.
    const key = `${slug(name, 'centrale')}@${round5(lon)},${round5(lat)}`;
    const entry = sites.get(key);
    const record = {
      year: parseEditionYear(row?.annee_de_reference),
      lon: round5(lon),
      lat: round5(lat),
      name,
      mw: parseOdsNumber(row?.puissance_installee_mw),
      operator: text(row?.operateur),
      status: text(row?.statut),
      statusEn: text(row?.status),
      commissioned: text(row?.date_de_mise_en_service),
    };
    if (entry) entry.rows.push(record);
    else sites.set(key, { rows: [record] });
  }

  const plants = [];
  let supersededRows = 0;
  let fleetMw = 0;
  let projectMw = 0;
  const editionYears = new Set();
  for (const [key, entry] of [...sites.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ordered = entry.rows
      .slice()
      .sort((a, b) => (b.year ?? -1) - (a.year ?? -1));
    const newest = ordered[0];
    supersededRows += ordered.length - 1;
    for (const row of ordered) if (row.year !== null) editionYears.add(row.year);
    // Trap 2 made visible rather than hidden: if the older editions said
    // something else, the card says so instead of pretending the file agrees.
    const priorStatuses = [...new Set(
      ordered.slice(1).map((row) => row.status).filter((status) => status && status !== newest.status),
    )];
    const inService = newest.status === 'En service';
    const mw = newest.mw;
    if (Number.isFinite(mw)) {
      if (inService) fleetMw += mw;
      else projectMw += mw;
    }
    plants.push({
      id: `gas-plant:${key}`,
      kind: 'plant',
      name: newest.name,
      lon: newest.lon,
      lat: newest.lat,
      mw,
      operator: newest.operator,
      status: newest.status,
      inService,
      commissioned: newest.commissioned,
      edition: newest.year,
      editions: ordered
        .map((row) => row.year)
        .filter((year) => year !== null)
        .sort((a, b) => a - b),
      supersededBy: priorStatuses,
    });
  }

  plants.sort((a, b) => (b.mw ?? 0) - (a.mw ?? 0) || a.name.localeCompare(b.name));
  const years = [...editionYears].sort((a, b) => a - b);
  return {
    plants,
    stats: {
      rows: rows.length,
      sites: plants.length,
      supersededRows,
      rowsWithoutGeometry,
      inService: plants.filter((plant) => plant.inService).length,
      fleetMw: Math.round(fleetMw),
      projectMw: Math.round(projectMw),
      editionFrom: years.length ? years[0] : null,
      editionTo: years.length ? years[years.length - 1] : null,
      // What the licence obliges: the data's own update date, not the
      // catalogue's, which is six years older than the newest edition here.
      editions: years,
    },
  };
}

/**
 * Project the renewable-methane injection points.
 *
 * Absorbs traps 6 and 7: `site_ouvert` is a string, and the network tier
 * decides whether the point touches the trace on screen at all.
 *
 * @param {*} payload Raw ODRÉ rows.
 * @returns {{injections: Array<object>, stats: object}}
 */
export function projectBiomethaneSites(payload) {
  const rows = odsRows(payload);
  const injections = [];
  let closed = 0;
  let rowsWithoutGeometry = 0;
  let capacityGwh = 0;
  let transport = 0;
  let distribution = 0;
  let unknownOpenState = 0;

  for (const row of rows) {
    const open = parseOdsBoolean(row?.site_ouvert);
    const closureDate = text(row?.date_de_fermeture_du_site);
    if (open === false || closureDate) {
      // A closed site in a file titled "en service": counted, never drawn.
      closed += 1;
      continue;
    }
    if (open === null) unknownOpenState += 1;
    const lon = parseOdsNumber(row?.coordonnees?.lon);
    const lat = parseOdsNumber(row?.coordonnees?.lat);
    if (lon === null || lat === null || (lon === 0 && lat === 0)) {
      rowsWithoutGeometry += 1;
      continue;
    }
    const tier = String(row?.type_de_reseau ?? '').trim().toLowerCase() === 'transport'
      ? GAS_NETWORK_TIERS.transport.id
      : GAS_NETWORK_TIERS.distribution.id;
    if (tier === 'transport') transport += 1;
    else distribution += 1;
    const capacity = parseOdsNumber(row?.capacite_de_production_gwh_an);
    if (Number.isFinite(capacity) && capacity > 0) capacityGwh += capacity;
    const id = row?.id_unique_projet;
    injections.push({
      id: `gas-injection:${Number.isFinite(Number(id)) ? id : slug(row?.nom_du_projet, 'site')}`,
      kind: 'injection',
      name: text(row?.nom_du_projet) || 'Site d’injection',
      lon: round5(lon),
      lat: round5(lat),
      gwh: capacity,
      tier,
      network: text(row?.grx_demandeur),
      registry: text(row?.gestionnaire_de_registre),
      feedstock: text(row?.site),
      process: text(row?.procede),
      commune: text(row?.commune),
      departement: text(row?.departement),
      region: text(row?.region),
      year: parseOdsNumber(row?.annee_mes),
      commissioned: text(row?.date_de_mes),
      // "Augmentation supplémentaire prévue" vs "Aucune augmentation
      // supplémentaire prévue" — the two published values differ only by the
      // word in front, so the test is the first word, not a substring search.
      expanding: String(row?.augmentation_prevue ?? '').trim().toLowerCase().startsWith('augmentation'),
    });
  }

  injections.sort((a, b) => (b.gwh ?? 0) - (a.gwh ?? 0) || a.name.localeCompare(b.name));
  const years = injections.map((site) => site.year).filter((year) => Number.isFinite(year));
  return {
    injections,
    stats: {
      rows: rows.length,
      drawn: injections.length,
      closed,
      rowsWithoutGeometry,
      unknownOpenState,
      transport,
      distribution,
      capacityGwh: Math.round(capacityGwh),
      commissionedFrom: years.length ? Math.min(...years) : null,
      commissionedTo: years.length ? Math.max(...years) : null,
    },
  };
}

/**
 * Project both point datasets into one sites document.
 * @param {{plants: *, injections: *}} payloads
 * @param {string} source
 * @returns {{source: string, plants: Array<object>, injections: Array<object>, stats: object}}
 */
export function projectGasSites(payloads, source = 'ODRÉ (odre.opendatasoft.com)') {
  const plants = projectGasPlants(payloads?.plants);
  const injections = projectBiomethaneSites(payloads?.injections);
  return {
    source,
    plants: plants.plants,
    injections: injections.injections,
    stats: {
      plants: plants.stats,
      injections: injections.stats,
    },
  };
}
