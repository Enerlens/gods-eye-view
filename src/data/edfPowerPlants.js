import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

/**
 * Centrales EDF — where France's biggest generating capacity physically is.
 *
 * EDF publishes the location and installed power of its own generating fleet
 * as three open datasets — hydraulic, nuclear and fossil-fired — under Licence
 * Ouverte 2.0, keyless. Together they put 79 sites and 80 094 MW on the globe:
 * 18 nuclear sites carrying 61 370 MW, 51 hydro plants carrying 13 779 MW, and
 * 10 fossil-fired sites carrying 4 945 MW.
 *
 * This is the STRUCTURAL half of the question the Mix élec layer answers
 * dynamically. That layer says what is flowing through the grid right now;
 * this one says what is built, and where. A site here is a fixed object with a
 * nameplate, not a meter reading — nothing on this layer moves, and nothing on
 * it is a measurement of output.
 *
 * ── Where the data comes from ───────────────────────────────────────────────
 * Through the `/api/edf-plants` proxy, which fetches the three files plus
 * their three metadata descriptors and merges them into one document. The
 * upstream's coordinate shapes, row granularity and per-file vintages are
 * absorbed in `edfPlantsFeed.js`, under test against captured payloads.
 *
 * ── What is drawn, and why THAT ─────────────────────────────────────────────
 * One disc per SITE, its area proportional to installed capacity, coloured by
 * filière, labelled with the site's name, its megawatts and what it actually
 * is in the publisher's own vocabulary — `6 × REP 900` at Gravelines,
 * `Pompage mixte` at Grand-Maison, `2 × Charbon` at Cordemais. Area rather
 * than radius carries the megawatts: a disc twice as wide would otherwise
 * claim four times the capacity.
 *
 * ── Honesty rules this layer is built around ────────────────────────────────
 *
 * • **This is EDF's fleet, not France's, and the layer never says otherwise.**
 *   The row legend and `getStats()` name the operator. The hydro file carries
 *   51 of the 400+ installations EDF operates — those above 100 MW, plus those
 *   whose secondary reserve reaches 20 MW — and no CNR or SHEM plant at all;
 *   the thermal file carries no Engie or TotalEnergies CCGT. Only nuclear is
 *   complete for the country, because every French reactor is EDF's.
 *
 * • **Three files, three vintages, so there is no single "as of".** Nuclear is
 *   a vision consolidée au 31/12/2025; hydro and thermal au 31/12/2023. The
 *   layer reports the RANGE and stamps each site with its own file's date
 *   rather than presenting 80 094 MW as a figure that existed at one instant.
 *   The nuclear file's own newest reactor entered service in 2002, so the EPR
 *   commissioned at Flamanville after that vision closed is not in it.
 *
 * • **Nameplate capacity is not output.** A 5 460 MW disc at Gravelines is
 *   what the site can produce, not what it is producing — three of its six
 *   reactors could be down for maintenance while the disc stays the same size.
 *   Every reading of this layer says "installée" / "installed".
 *
 * • **A site is drawn once, however many units it holds.** The nuclear and
 *   thermal files publish one row per unit and every unit of a site repeats
 *   the same coordinate, so drawing rows would stack six markers on Gravelines
 *   and none of them would be wrong. Hydro publishes one row per plant and
 *   says nothing about its turbine count, so hydro sites report NO unit count
 *   rather than "1".
 *
 * • **Corse and the îles du Ponant are outside all three datasets.** The
 *   publisher's declared geographic scope excludes them, so the layer draws
 *   nothing there and says why — the same "absence is not a colour" rule the
 *   Vigilance and Mix élec layers follow, for a different reason.
 *
 * • **Five of these sites are also drawn by the Réseau gaz layer, and both are
 *   right.** That layer draws ODRÉ's register of the 14 centralised gas-fired
 *   stations, whoever operates them; this one draws EDF's own fossil-fired
 *   file, whatever it burns. Measured 2026-08-27, the overlap is exactly the
 *   five EDF gas sites — Martigues (0.09 km apart), Bouchain (0.55), Blénod
 *   (0.12), Montereau (0.60) and Gennevilliers (0.15) — and the two publishers
 *   do not fully agree on their capacity: 585 against 575 MW at Bouchain, 427
 *   against 430 at Blénod, 203 against 210 at Gennevilliers. Nothing is
 *   de-duplicated, because neither set contains the other (ODRÉ carries Engie,
 *   TotalEnergies and Uniper plants this file cannot claim; this file carries
 *   the coal and fioul units a gas register does not) and because quietly
 *   dropping one publisher's figure would hide that they disagree.
 *
 * • **A dam is not a power station.** The bundled Dams layer draws OSM dam
 *   structures. Nothing is de-duplicated between the two, because a barrage
 *   and the usine it feeds are different objects — and the overlap is now
 *   large: re-measured on 2026-09-01 against the rebuilt dam pack (6 189
 *   features, 44 441 vertices), 37 of these 51 hydro plants have a mapped dam
 *   vertex within 3 km and 22 within 1 km. The figure this line used to carry
 *   — "only 3 of 51" — was true against the 704-feature pack that shipped when
 *   this layer landed, and became wrong the day the dams pack was rebuilt.
 *   Proximity is not identity: a plant sitting 300 m from a barrage is the
 *   usine that barrage feeds, drawn as the separate object it is.
 */

const API_URL = '/api/edf-plants';

/** Shared world-overlay source id (matches the layer id). */
/** Layer id — also the share-link registry key and the pick-owner key. */
export const EDF_PLANTS_LAYER_ID = 'edf-power-plants';
export const EDF_PLANTS_OVERLAY_SOURCE_ID = 'edf-power-plants';
/** Bounded label cohort offered to the shared overlay host. */
export const EDF_PLANTS_OVERLAY_COHORT_LIMIT = 60;
/** Shared ambient-label paint budget, matching the sibling French sources. */
export const EDF_PLANTS_OVERLAY_COLLISION_CAPACITY = 40;

/**
 * Idle refresh cadence.
 *
 * These files are updated ANNUALLY and the proxy holds a 24-hour cache in
 * front of them, so this interval is not chasing updates — it exists so a
 * layer whose first load failed heals on its own instead of needing a toggle.
 * Every poll after the first is answered from the proxy's memory.
 */
const UPDATE_INTERVAL_MS = 1_800_000;

/**
 * The filière palette and vocabulary.
 *
 * Three hues far enough apart in BOTH hue and lightness to survive
 * deuteranopia, and — the part that actually carries the meaning — a label on
 * every marker that names what the site is in words. The colour repeats what
 * the text already says; it is never the only channel.
 *
 * `unitNoun` is the publisher's own unit of account: a nuclear site holds
 * réacteurs, a fossil-fired site holds tranches, and a hydro plant holds an
 * unpublished number of groups, which is why it has no noun here.
 */
export const FILIERE_STYLES = Object.freeze({
  nucleaire: Object.freeze({
    key: 'nucleaire', label: 'Nucléaire', color: '#ffd166', unitNoun: 'réacteur',
    blurb: 'Réacteurs à eau pressurisée exploités par EDF',
  }),
  hydraulique: Object.freeze({
    key: 'hydraulique', label: 'Hydraulique', color: '#4fc3f7', unitNoun: null,
    blurb: 'Centrales EDF > 100 MW (ou réserve secondaire ≥ 20 MW)',
  }),
  thermique: Object.freeze({
    key: 'thermique', label: 'Thermique à flamme', color: '#f4736b', unitNoun: 'tranche',
    blurb: 'Charbon, gaz et fioul exploités par EDF',
  }),
});

/** Filière order for the legend — largest installed capacity first. */
export const FILIERE_ORDER = Object.freeze(['nucleaire', 'hydraulique', 'thermique']);

const COLOR_OUTLINE = Cesium.Color.fromCssColorString('#04121f');
const COLOR_UNKNOWN = Cesium.Color.fromCssColorString('#8fa3b8');

/**
 * Disc size, in pixels.
 *
 * Radius grows with the SQUARE ROOT of installed power, so the disc's area is
 * what tracks the megawatts — above a floor that keeps Grandval's 74 MW
 * visible at country scale. Saturation is absolute rather than relative to the
 * current maximum: the fleet is a fixed object, and a scale that renormalised
 * itself would redraw every plant in France the day one site closed.
 */
export const PLANT_PIXEL_MIN = 7;
export const PLANT_PIXEL_MAX = 26;
const PIXEL_PER_ROOT_MW = 0.27;

/**
 * Pixel diameter for one site.
 * @param {number|null|undefined} mw Installed capacity.
 * @returns {number}
 */
export function plantPixelSize(mw) {
  if (!Number.isFinite(mw) || mw <= 0) return PLANT_PIXEL_MIN;
  return Math.min(PLANT_PIXEL_MAX, PLANT_PIXEL_MIN + Math.sqrt(mw) * PIXEL_PER_ROOT_MW);
}

/**
 * Marker colour for one site. An unknown filière is drawn neutral grey rather
 * than inheriting a colour that would assert what it burns.
 * @param {string|null|undefined} filiere
 * @returns {Cesium.Color}
 */
export function plantColor(filiere) {
  const style = FILIERE_STYLES[String(filiere ?? '')];
  return style ? Cesium.Color.fromCssColorString(style.color) : COLOR_UNKNOWN;
}

/**
 * Format megawatts the way a French control-room readout would: thin-space
 * grouping, no decimals, unit spelled out.
 *
 * Display rounds; nothing else does. The hydro file publishes fractions of a
 * megawatt (Sainte-Croix is 132.27 MW) and totals are summed at full precision
 * before being rounded once, here.
 * @param {number|null|undefined} mw
 * @returns {string}
 */
export function formatMegawatts(mw) {
  if (!Number.isFinite(mw)) return '— MW';
  // `toLocaleString('fr-FR')` groups with U+202F on modern ICU and U+00A0 on
  // older ones. Both are normalised to a plain space so the label measures and
  // wraps predictably in the overlay's text layout.
  return `${Math.round(mw).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ')} MW`;
}

/**
 * What the site IS, in one phrase: the unit count where the publisher gives
 * one, then the publisher's own word for the kind of plant.
 *
 * A hydro plant gets no count, because the file does not publish one — see the
 * module header. A site whose file names no kind gets the filière's own label
 * rather than an invented one.
 * @param {object|null|undefined} site
 * @returns {string}
 */
export function plantKindText(site) {
  const style = FILIERE_STYLES[String(site?.filiere ?? '')] || null;
  const kind = String(site?.kind ?? '').trim() || style?.label || 'Centrale';
  const units = Number(site?.units);
  if (!Number.isFinite(units) || units < 2) return kind;
  return `${units} × ${kind}`;
}

/**
 * Label text for one site: name, installed power, and what it is.
 * @param {object} site
 * @returns {string}
 */
export function plantLabelText(site) {
  return `${site?.name ?? ''} · ${formatMegawatts(site?.mw)} · ${plantKindText(site)}`;
}

/**
 * Keep the sites the payload actually placed, in the order they will be drawn.
 *
 * A record without a finite position is dropped rather than defaulted to
 * anywhere — the feed already rejects points outside metropolitan France, and
 * this is the client-side half of the same refusal.
 * @param {object|null|undefined} payload `/api/edf-plants` body.
 * @returns {Array<object>}
 */
export function buildPlantRecords(payload) {
  const sites = Array.isArray(payload?.sites) ? payload.sites : [];
  const records = [];
  for (const site of sites) {
    if (!Number.isFinite(site?.lat) || !Number.isFinite(site?.lon)) continue;
    const id = String(site?.id ?? '').trim();
    const name = String(site?.name ?? '').trim();
    if (!id || !name) continue;
    records.push({
      id,
      name,
      filiere: String(site?.filiere ?? '').trim() || null,
      lat: site.lat,
      lon: site.lon,
      mw: Number.isFinite(site?.mw) ? site.mw : null,
      units: Number.isFinite(site?.units) ? site.units : null,
      kind: String(site?.kind ?? '').trim() || null,
      tech: String(site?.tech ?? '').trim() || null,
      fuel: String(site?.fuel ?? '').trim() || null,
      operator: String(site?.operator ?? '').trim() || null,
      commune: String(site?.commune ?? '').trim() || null,
      departement: String(site?.departement ?? '').trim() || null,
      region: String(site?.region ?? '').trim() || null,
      commissionedFrom: Number.isFinite(site?.commissionedFrom) ? site.commissionedFrom : null,
      commissionedTo: Number.isFinite(site?.commissionedTo) ? site.commissionedTo : null,
      secondaryReserveMw: Number.isFinite(site?.secondaryReserveMw)
        ? site.secondaryReserveMw
        : null,
      referenceDate: String(site?.referenceDate ?? '').trim() || null,
    });
  }
  // Biggest last, so the largest disc paints over its smaller neighbours where
  // two sites overlap at country scale rather than being hidden under them.
  records.sort((a, b) => (a.mw ?? 0) - (b.mw ?? 0) || a.id.localeCompare(b.id));
  return records;
}

/**
 * Roll the drawn sites up into the fleet figures the row and the HUD read.
 *
 * Recomputed from the RENDERED records rather than trusting the payload's own
 * totals: what the row reports has to be what is on the globe.
 * @param {Array<object>|null|undefined} records
 * @returns {{sites:number, units:number|null, capacityMw:number|null,
 *   operators:Array<string>, byFiliere:object}}
 */
export function summarizePlants(records) {
  const byFiliere = {};
  const operators = [];
  let capacity = null;
  let units = null;
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.operator && !operators.includes(record.operator)) operators.push(record.operator);
    const key = record?.filiere || 'inconnue';
    const bucket = byFiliere[key] || (byFiliere[key] = { sites: 0, units: null, capacityMw: null });
    bucket.sites += 1;
    if (Number.isFinite(record?.mw)) {
      bucket.capacityMw = (bucket.capacityMw ?? 0) + record.mw;
      capacity = (capacity ?? 0) + record.mw;
    }
    if (Number.isFinite(record?.units)) {
      bucket.units = (bucket.units ?? 0) + record.units;
      units = (units ?? 0) + record.units;
    }
  }
  const round = (value) => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null);
  for (const bucket of Object.values(byFiliere)) bucket.capacityMw = round(bucket.capacityMw);
  return {
    sites: Array.isArray(records) ? records.length : 0,
    units,
    capacityMw: round(capacity),
    // Every published row currently says `EDF SA`. Collected as a set rather
    // than read off one record, so a future file naming a second operator
    // would widen the caveat instead of hiding behind the first site's value.
    operators,
    byFiliere,
  };
}

/**
 * The span of reference dates behind what is drawn.
 *
 * Reported as a RANGE because the three files are three vintages: collapsing
 * them to one date would invent a snapshot that never existed. Identical dates
 * collapse to a single value, which is what a future aligned republication
 * would produce.
 * @param {Array<object>|null|undefined} datasets From `/api/edf-plants`.
 * @returns {{from:string|null, to:string|null, dates:Array<string>}}
 */
export function referenceDateRange(datasets) {
  const dates = [];
  for (const dataset of Array.isArray(datasets) ? datasets : []) {
    const date = String(dataset?.referenceDate ?? '').trim();
    if (date && !dates.includes(date)) dates.push(date);
  }
  dates.sort();
  return { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, dates };
}

/**
 * Build the source-owned presentation for one site label.
 * @param {object} record
 * @param {Cesium.Cartesian3} position
 * @returns {object}
 */
export function createPlantOverlayEntry(record, position, { skipLabel = false } = {}) {
  return {
    id: `edf-plants:${record.id}`,
    // A selected site is drawn by the protected card instead; leaving its
    // ambient label up would have the site competing with itself for the slot.
    skipLabel,
    position,
    variant: 'label',
    title: plantLabelText(record),
    accent: plantColor(record.filiere).toCssColorString(),
    // Capacity settles a contested label slot: the biggest sites are the ones
    // worth naming when the country does not fit on screen.
    priority: Math.round(record.mw ?? 0),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 14,
    verticalOnly: true,
    placement: 'above',
  };
}

/**
 * Selected-site card, on its own protected overlay source.
 *
 * The layer drew 79 discs and clicking one did nothing: it registered no pick
 * owner, no click handler and no keydown listener, so twenty published fields
 * per site reached the browser and none of them reached a reader. This is the
 * house arrangement (`frHydroPlants`, `gasFrance`, `irveFrance`), ported rather
 * than reinvented.
 */
export const EDF_PLANTS_SELECTED_OVERLAY_SOURCE_ID = 'edf-power-plants-selected';
export const EDF_PLANTS_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});
/** Accent for the selected disc and its card. */
export const EDF_SELECTED_COLOR = '#7ee8fa';
/** Extra pixels the selected disc gains, so the click reads as a click. */
const SELECTED_POINT_BONUS_PX = 5;
/**
 * How deep to drill for one of our discs.
 *
 * Measured worst case is 3 (an RTE output disc and its ring stacked over the
 * EDF disc); 8 leaves room for a third layer to arrive on the same pixel
 * without silently reintroducing the dead-click this exists to prevent.
 */
const DRILL_PICK_LIMIT = 8;

/**
 * A commissioning span, as the file publishes it.
 *
 * The two fields are a RANGE across the site's units — Gravelines' six
 * reactors came online between 1980 and 1985 — so a single date would be a
 * different claim about a different object. Equal ends collapse to one year,
 * which is what a single-unit site actually is.
 * @param {?number} from
 * @param {?number} to
 * @returns {string}
 */
export function commissioningText(from, to) {
  const start = Number.isFinite(from) ? Math.round(from) : null;
  const end = Number.isFinite(to) ? Math.round(to) : null;
  if (start === null && end === null) return '';
  if (start === null || end === null) return String(start ?? end);
  return start === end ? String(start) : `${start}–${end}`;
}

/**
 * The card for one site.
 *
 * Every line is built from a field the payload ALREADY carries and that no
 * surface rendered: `secondaryReserveMw` reached the client record and was
 * shown nowhere at all, and the commissioning span, the fuel, the operator and
 * the site's own reference date were in the same position.
 *
 * WHAT THIS CARD DELIBERATELY DOES NOT SAY: live output. The join to RTE's
 * production units is exact and already shipped — `units.json` keys 69 of the
 * 79 sites on `'edf:' + site.id`, 1:1, every ring within 10 m of its disc — and
 * it is still the wrong thing to print here. Three reasons, each measured:
 * this layer is `auth: 'none'` in the taxonomy and RTE needs a credential, so
 * the line would be blank on a keyless deploy; only 42 of the 69 have a
 * reporting unit at any moment, so it would be blank again on a third of the
 * rest; and the two files disagree about capacity on 24 sites, most loudly at
 * Flamanville, where EDF's 31/12/2025 vision predates the EPR and a live
 * 3 583 MW against its 2 660 MW nameplate would print as 135 %. The layer that
 * owns live output is `Groupes de prod`, drawn on the identical pixel.
 *
 * @param {object} record A record from `buildPlantRecords`.
 * @returns {string} Newline-separated; the first line is the title.
 */
export function buildEdfPlantCard(record) {
  const style = FILIERE_STYLES[String(record?.filiere ?? '')] || null;
  const lines = [String(record?.name ?? '').trim() || 'Centrale'];

  lines.push(`⚡ ${formatMegawatts(record?.mw)} installés · ${plantKindText(record)}`);

  // The publisher's own words for the machine, never merged with the filière
  // label above — "Thermique à flamme · charbon" says two different things.
  const machine = [record?.tech, record?.fuel]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(' · ');
  if (machine) lines.push(`◈ ${machine}`);

  // Secondary reserve is the site's contracted contribution to frequency
  // containment. It is published for 56 of the 79 sites and, until now,
  // travelled all the way into the client record to be rendered nowhere.
  if (Number.isFinite(record?.secondaryReserveMw) && record.secondaryReserveMw > 0) {
    lines.push(`↻ ${formatMegawatts(record.secondaryReserveMw)} de réserve secondaire`);
  }

  const where = [record?.commune, record?.departement, record?.region]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(' · ');
  if (where) lines.push(`📍 ${where}`);

  const commissioned = commissioningText(record?.commissionedFrom, record?.commissionedTo);
  if (commissioned) {
    const plural = commissioned.includes('–');
    lines.push(`🕐 ${plural ? 'tranches couplées' : 'couplée'} ${commissioned}`);
  }

  const operator = String(record?.operator ?? '').trim();
  // Every published row currently says EDF SA, so naming it adds nothing on its
  // own — it earns a line only if a future edition names somebody else.
  if (operator && !/^edf\b/i.test(operator)) lines.push(`⌁ exploitant : ${operator}`);

  // The vintage is per FILE, not per fleet: the three EDF datasets are three
  // editions, and a card that quoted one date for all of them would invent a
  // snapshot that never existed.
  const reference = String(record?.referenceDate ?? '').trim();
  if (reference) lines.push(`# ${style?.label || 'EDF'} — situation au ${reference}`);

  return lines.join('\n');
}

/**
 * The protected card entry for the selected site.
 * @param {object} record
 * @param {object} position Cesium.Cartesian3 for the disc.
 * @returns {object|null}
 */
export function createEdfSelectedOverlayEntry(record, position) {
  if (!record || !position) return null;
  const [title, ...details] = buildEdfPlantCard(record).split('\n');
  return {
    id: `edf-plants:${record.id}`,
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title,
    details,
    accent: EDF_SELECTED_COLOR,
    interactive: false,
    anchorRadiusPx: 9,
    minAnchorGapPx: 11,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

/** Keep the largest sites, with stable identity as the tie-break. */
export function selectPlantOverlayCohort(entries, limit = EDF_PLANTS_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    EDF_PLANTS_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Legend for the toggle row: one entry per filière actually drawn, with its
 * site count and its installed total.
 * @param {{byFiliere:object}} summary From `summarizePlants`.
 * @returns {Array<{label:string,color:string,blurb:string,count:number}>}
 */
export function filiereLegend(summary) {
  const legend = [];
  for (const key of FILIERE_ORDER) {
    const bucket = summary?.byFiliere?.[key];
    if (!bucket?.sites) continue;
    const style = FILIERE_STYLES[key];
    const units = Number.isFinite(bucket.units) && style.unitNoun
      ? `, ${bucket.units} ${style.unitNoun}s`
      : '';
    legend.push({
      label: style.label,
      color: style.color,
      blurb: `${style.blurb} — ${formatMegawatts(bucket.capacityMw)} installés${units}`,
      count: bucket.sites,
    });
  }
  return legend;
}

/**
 * Map one site to a JSON-safe analyst record (analyst query engine seam).
 * Pure — no Cesium types. Missing fields are null, never NaN.
 *
 * `capacityMw` is named for what it is: installed capacity, so an analyst
 * question about "output" cannot be answered off this field by accident.
 * @param {object|null|undefined} record
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapAnalystRecord(record, index = 0) {
  const text = (value) => { const t = String(value ?? '').trim(); return t || null; };
  const num = (value) => (Number.isFinite(value) ? value : null);
  return {
    id: text(record?.id) || `PLANT-${String(index).padStart(4, '0')}`,
    name: text(record?.name),
    filiere: text(record?.filiere),
    kind: text(record?.kind),
    fuel: text(record?.fuel),
    operator: text(record?.operator),
    capacityMw: num(record?.mw),
    units: num(record?.units),
    commune: text(record?.commune),
    departement: text(record?.departement),
    region: text(record?.region),
    commissionedFrom: num(record?.commissionedFrom),
    commissionedTo: num(record?.commissionedTo),
    // The vintage of the file this site came from — not the fetch time, and
    // not shared with the other two filières.
    referenceDate: text(record?.referenceDate),
    lat: num(record?.lat),
    lon: num(record?.lon),
  };
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * @param {object} [options]
 * @returns {object} Data-manager layer module.
 */
export function createEdfPowerPlantsLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  apiUrl = API_URL,
} = {}) {
  let _viewer = null;
  let _pointCollection = null;
  let _records = [];
  /** Rendered discs by render id, so a pick resolves to a record and a position. */
  let _drawn = new Map();
  let _selectedId = null;
  let _clickHandler = null;
  let _summary = summarizePlants([]);
  let _datasets = [];
  let _vintages = referenceDateRange([]);
  let _signature = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _loading = false;
  let _feedSource = null;

  function repaint() {
    if (!_pointCollection) return;
    _pointCollection.removeAll();
    _drawn.clear();
    const entries = [];
    for (const record of _records) {
      const position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
      const renderId = `edf-plants:${record.id}`;
      const basePixelSize = plantPixelSize(record.mw);
      const point = _pointCollection.add({
        position,
        pixelSize: basePixelSize,
        color: plantColor(record.filiere),
        outlineColor: COLOR_OUTLINE,
        outlineWidth: 1,
        scaleByDistance: new Cesium.NearFarScalar(20_000, 1.25, 3_000_000, 0.55),
        translucencyByDistance: new Cesium.NearFarScalar(20_000, 1, 5_000_000, 0.35),
        disableDepthTestDistance: 5000,
        id: renderId,
      });
      _drawn.set(renderId, { record, position, point, basePixelSize });
      entries.push(createPlantOverlayEntry(record, position, {
        skipLabel: renderId === _selectedId,
      }));
    }
    // A repaint rebuilds every primitive, so a live selection has just lost the
    // object it was styling. Re-apply it against the new disc rather than
    // leaving a card anchored to a released primitive.
    if (_selectedId && _drawn.has(_selectedId)) selectObject(_selectedId);
    else if (_selectedId) clearSelection();
    publishOverlay(entries);
    _viewer?.scene?.requestRender?.();
  }

  function clearSelection() {
    const drawn = _selectedId ? _drawn.get(_selectedId) : null;
    if (drawn?.point) {
      drawn.point.outlineColor = COLOR_OUTLINE;
      drawn.point.pixelSize = drawn.basePixelSize;
    }
    _selectedId = null;
    overlayHost.clearSource(EDF_PLANTS_SELECTED_OVERLAY_SOURCE_ID);
  }

  function selectObject(renderId) {
    const drawn = _drawn.get(renderId);
    clearSelection();
    if (!drawn) return;
    _selectedId = renderId;
    if (drawn.point) {
      drawn.point.outlineColor = Cesium.Color.fromCssColorString(EDF_SELECTED_COLOR);
      drawn.point.pixelSize = drawn.basePixelSize + SELECTED_POINT_BONUS_PX;
    }
    const entry = createEdfSelectedOverlayEntry(drawn.record, drawn.position);
    if (entry) {
      overlayHost.setEntries(
        EDF_PLANTS_SELECTED_OVERLAY_SOURCE_ID,
        [entry],
        EDF_PLANTS_SELECTED_OVERLAY_SOURCE_OPTIONS,
      );
    }
    governorRequestRender('edf-plants-select');
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && _selectedId) {
      clearSelection();
      governorRequestRender('edf-plants-deselect');
    }
  }

  /**
   * Install the click-to-select handler.
   *
   * `drillPick`, NOT `pick`, and that is measured rather than defensive. 69 of
   * the 79 sites have an RTE production-unit ring from the `Groupes de prod`
   * layer within 10 m of their disc, and those rings draw with
   * `disableDepthTestDistance: Number.POSITIVE_INFINITY` where these discs use
   * 5 000 — so with that sibling layer on, `scene.pick` over Gravelines returns
   * `rte-gen:GRAV5:out` and the EDF disc is THIRD in the drill. A plain `pick`
   * handler would therefore look dead on the nine largest nuclear sites, which
   * is a worse bug than the one being fixed.
   *
   * Guarded on `document` because Cesium's `ScreenSpaceEventHandler` registers
   * DOM listeners in its constructor and this layer's lifecycle runs headless
   * under test.
   */
  function installClickHandler(viewer) {
    if (_clickHandler || typeof document === 'undefined') return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      if (!_enabled) return;
      const drilled = viewer.scene.drillPick(click.position, DRILL_PICK_LIMIT) || [];
      for (const hit of drilled) {
        const id = typeof hit?.primitive?.id === 'string' ? hit.primitive.id : null;
        if (id && _drawn.has(id)) {
          selectObject(id);
          return;
        }
      }
      // Nothing of ours under the cursor: a click on empty globe dismisses,
      // and a click on another layer's object leaves that layer to answer.
      clearSelection();
      governorRequestRender('edf-plants-deselect');
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    document.addEventListener('keydown', onKeyDown);
  }

  function removeClickHandler() {
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
  }

  function publishOverlay(entries) {
    if (!_enabled) return;
    overlayHost.setEntries(
      EDF_PLANTS_OVERLAY_SOURCE_ID,
      selectPlantOverlayCohort(entries),
      {
        cohortLimit: EDF_PLANTS_OVERLAY_COHORT_LIMIT,
        collisionCapacity: EDF_PLANTS_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  /** Fingerprint of the drawn state, so an unchanged snapshot repaints nothing. */
  function signatureOf(records) {
    return records.map((record) => `${record.id}:${record.mw ?? ''}`).join(',');
  }

  const layer = {
    id: EDF_PLANTS_LAYER_ID,
    name: 'Centrales EDF (FR)',
    icon: '◈',
    source: 'EDF Open Data',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _pointCollection = new Cesium.PointPrimitiveCollection({
        blendOption: Cesium.BlendOption.TRANSLUCENT,
      });
      viewer.scene.primitives.add(_pointCollection);
      _pointCollection.show = false;
      _records = [];
      _summary = summarizePlants([]);
      _datasets = [];
      _vintages = referenceDateRange([]);
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      _loading = false;
      _feedSource = null;
      _drawn.clear();
      _selectedId = null;
      overlayHost.setVisible(EDF_PLANTS_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(EDF_PLANTS_SELECTED_OVERLAY_SOURCE_ID, false);
      // Registered here rather than in enable(), so the shared pick registry
      // knows these ids exist for as long as the collection does — the same
      // choice frHydroPlants makes for the same reason.
      registerPickOwner(EDF_PLANTS_LAYER_ID, (id) => _drawn.has(id));
      console.log('[Data:EDF Plants] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (viewer) _viewer = viewer;
      if (_pointCollection) _pointCollection.show = true;
      overlayHost.setVisible(EDF_PLANTS_OVERLAY_SOURCE_ID, true);
      overlayHost.setVisible(EDF_PLANTS_SELECTED_OVERLAY_SOURCE_ID, true);
      if (_viewer) installClickHandler(_viewer);
      // The fleet is already drawn if a previous session loaded it; republish
      // the labels the overlay host dropped on disable.
      if (_records.length) repaint();
    },

    disable() {
      _enabled = false;
      clearSelection();
      removeClickHandler();
      if (_pointCollection) _pointCollection.show = false;
      overlayHost.clearSource(EDF_PLANTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EDF_PLANTS_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(EDF_PLANTS_SELECTED_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      _loading = !_records.length;
      try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
          _lastError = `EDF Open Data HTTP ${response.status}`;
          console.warn(`[Data:EDF Plants] API returned ${response.status}`);
          return false;
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.sites)) {
          _lastError = 'Malformed EDF plants response';
          return false;
        }

        const records = buildPlantRecords(payload);
        const signature = signatureOf(records);
        _records = records;
        _summary = summarizePlants(records);
        _datasets = Array.isArray(payload?.datasets) ? payload.datasets : [];
        _vintages = referenceDateRange(_datasets);
        _feedSource = String(payload.source ?? '').trim() || null;
        _stale = payload.stale === true;
        _lastUpdate = Date.now();
        _lastError = null;

        if (signature !== _signature) {
          _signature = signature;
          repaint();
        }

        console.log(
          `[Data:EDF Plants] Updated: ${_summary.sites} sites,`
          + ` ${formatMegawatts(_summary.capacityMw)} installés,`
          + ` vintages ${_vintages.dates.join(' + ') || '—'}`,
        );
        return true;
      } catch (error) {
        console.warn('[Data:EDF Plants] Fetch error:', error);
        _lastError = 'EDF Open Data network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      clearSelection();
      removeClickHandler();
      unregisterPickOwner(EDF_PLANTS_LAYER_ID);
      _drawn.clear();
      overlayHost.clearSource(EDF_PLANTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EDF_PLANTS_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(EDF_PLANTS_SELECTED_OVERLAY_SOURCE_ID, false);
      if (_pointCollection) {
        viewer?.scene?.primitives?.remove?.(_pointCollection);
        _pointCollection = null;
      }
      _viewer = null;
      _records = [];
      _summary = summarizePlants([]);
      _datasets = [];
      _vintages = referenceDateRange([]);
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _loading = false;
      _feedSource = null;
    },

    /**
     * Snapshot the sites as plain JSON-safe objects for the analyst query
     * engine. On-demand only. Returns [] while the layer is off.
     * @param {number} [maxCount=200]
     * @returns {Array<Object>}
     */
    getAnalystRecords(maxCount = 200) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 200;
      const result = [];
      // Largest first, which is the order an analyst question about capacity
      // wants; the render order is deliberately the reverse of it.
      for (const record of [..._records].reverse()) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(record, result.length));
      }
      return result;
    },

    /**
     * Colour legend for the toggle row. No chips: the layer has no options.
     * @returns {{chips: Array<object>, legend: Array<object>}}
     */
    getRowControls() {
      return { chips: [], legend: filiereLegend(_summary) };
    },

    getStats() {
      return {
        // Sites, not published rows: 79 markers stand for 126 rows, and
        // reporting 126 would imply 126 places.
        count: _summary.sites,
        lastUpdate: _lastUpdate,
        error: _lastError,
        loading: _loading,
        stale: _stale,
        // Installed, never produced. The Mix élec layer owns the flow figures.
        capacityMw: _summary.capacityMw,
        units: _summary.units,
        nuclearMw: _summary.byFiliere.nucleaire?.capacityMw ?? null,
        hydroMw: _summary.byFiliere.hydraulique?.capacityMw ?? null,
        thermalMw: _summary.byFiliere.thermique?.capacityMw ?? null,
        // The operator whose fleet this is — the layer's largest caveat, kept
        // in the stats rather than only in the docs.
        operator: _summary.operators.join(' + ') || null,
        // Licence Ouverte 2.0 obliges the producer AND the data's own date.
        // Three files, so a range: see the module header.
        referenceDates: _vintages.dates,
        updateTime: _vintages.to,
        datasets: _datasets.length,
        feedSource: _feedSource,
      };
    },
  };

  return layer;
}

const edfPowerPlantsLayer = createEdfPowerPlantsLayer();

export default edfPowerPlantsLayer;
