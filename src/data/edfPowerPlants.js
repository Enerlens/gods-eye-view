import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { askJoin, publishJoin } from './layerJoins.js';
import { PLANT_JOIN_KEYS, plantCrossRegisterLine } from './plantIdentity.js';
import { horizonOccluder } from './iconOrientation.js';
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
 * is — `6 réacteurs` at Gravelines, `pompage-turbinage mixte` at Grand-Maison,
 * `2 unités au charbon` at Cordemais. Area rather than radius carries the
 * megawatts: a disc twice as wide would otherwise claim four times the
 * capacity.
 *
 * THE MARK IS DRAWN OVER THE TERRAIN, not depth-tested against it. A point
 * primitive carries one depth for its whole quad, so a depth-tested disc gets
 * its lower half eaten by the ground in front of it and reads as a parasol
 * rather than a disc — see the note on `disableDepthTestDistance` in
 * `repaint`. The price is a per-frame horizon cull, in `onPreRender`.
 *
 * AND IT SAYS WHAT IT IS IN FRENCH A READER CAN ACT ON. The three files
 * publish codes — `REP 900`, `Eclusée`, `tranche`, `réserve secondaire` — and
 * this layer renders them through {@link PLANT_KIND_PLAIN} rather than at a
 * reader. The publisher's own figures are untouched; only its vocabulary is
 * translated, and the raw string is still one argument away
 * (`plantKindText(site, { register: 'raw' })`).
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
 * `unitNoun` is the unit of account a reader can picture: a nuclear site holds
 * réacteurs, a fossil-fired site holds unités — EDF's own word is `tranche`,
 * which outside a control room is a slice of bread — and a hydro plant holds
 * an unpublished number of groups, which is why it has no noun here.
 *
 * `subject` is what the place IS, in a sentence. `label` is a legend key and
 * reads as one: "Nucléaire" beside a coloured swatch is a category, and
 * "Centrale nucléaire" at the top of a card is an answer.
 */
export const FILIERE_STYLES = Object.freeze({
  nucleaire: Object.freeze({
    key: 'nucleaire', label: 'Nucléaire', subject: 'Centrale nucléaire',
    color: '#ffd166', unitNoun: 'réacteur', unitNounFeminine: false,
    blurb: 'Réacteurs à eau pressurisée exploités par EDF',
  }),
  hydraulique: Object.freeze({
    key: 'hydraulique', label: 'Hydraulique', subject: 'Centrale hydraulique',
    color: '#4fc3f7', unitNoun: null,
    blurb: 'Centrales EDF de plus de 100 MW, plus celles qui tiennent au moins 20 MW en réserve pour stabiliser le réseau',
  }),
  thermique: Object.freeze({
    key: 'thermique', label: 'Thermique à flamme', subject: 'Centrale thermique',
    color: '#f4736b', unitNoun: 'unité', unitNounFeminine: true,
    blurb: 'Charbon, gaz et fioul brûlés par EDF pour produire de l’électricité',
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
 * EDF's own vocabulary, in words a reader who does not work in the industry
 * can act on.
 *
 * **THE PUBLISHER'S STRING IS A CODE, AND IT WAS ON SCREEN AS ONE.** The card
 * over Le Blayais read `4 × REP 900`, `tranches couplées 1981-1983`, `40 MW de
 * réserve secondaire`: three published fields, faithfully rendered, and not
 * one of them says anything to somebody who came to look at a map of France.
 * `REP` is an acronym for a reactor family, `900` is the palier and not this
 * site's power, a `tranche` is a machine and not a slice of anything, and
 * `couplée` means connected to the grid.
 *
 * This is the arrangement `bruitFrance.js` already uses for the noise plans —
 * `PEB_ZONE_LABELS` turns the letter A into "logements neufs interdits" —
 * ported here rather than reinvented: a table from the code to what it MEANS,
 * consulted by the card, with the publisher's own figure left intact beside it.
 *
 * Two registers per entry, because a map label and a card have different
 * budgets. `short` is what fits beside a name on the globe — `6 réacteurs`.
 * `long` is what the card has room to say — `6 réacteurs à eau pressurisée de
 * 900 MW`. `blurb` is the extra sentence a REGIME needs and a machine does
 * not: "réacteur à eau pressurisée" is a thing a reader can picture, "Éclusée"
 * is not, and the same five hydro regimes are already explained in exactly
 * these words by the Petite hydro legend (`frHydroFeed.js`).
 *
 * Keyed on all thirteen strings the three files publish, measured against the
 * live proxy on 2026-09-10. A value that is not in this table falls through to
 * the publisher's own spelling rather than being dropped or guessed at.
 */
export const PLANT_KIND_PLAIN = Object.freeze({
  // The number in a palier is the reactor family's unit power, NOT the site's:
  // Gravelines is six machines of 900 MW, and saying "de 900 MW" beside a
  // 5 460 MW site is only honest because the count is on the same line.
  'REP 900': Object.freeze({ short: 'réacteur', long: 'réacteur à eau pressurisée de 900 MW' }),
  'REP 1300': Object.freeze({ short: 'réacteur', long: 'réacteur à eau pressurisée de 1 300 MW' }),
  'REP 1450': Object.freeze({ short: 'réacteur', long: 'réacteur à eau pressurisée de 1 450 MW' }),
  Charbon: Object.freeze({ short: 'unité au charbon', long: 'unité au charbon' }),
  'Gaz naturel': Object.freeze({ short: 'unité au gaz', long: 'unité au gaz naturel' }),
  'Fioul Domestique': Object.freeze({ short: 'unité au fioul', long: 'unité au fioul domestique' }),
  'Gaz naturel/Fioul Domestique': Object.freeze({
    short: 'unité gaz ou fioul', long: 'unité au gaz naturel ou au fioul',
  }),
  Lac: Object.freeze({
    short: 'retenue de lac', long: 'retenue de lac',
    blurb: 'l’eau est stockée des mois et turbinée quand la demande grimpe',
  }),
  Eclusée: Object.freeze({
    short: 'éclusée', long: 'éclusée',
    blurb: 'sa retenue tient quelques heures à quelques jours de production',
  }),
  "Fil de l'eau": Object.freeze({
    short: 'fil de l’eau', long: 'au fil de l’eau',
    blurb: 'elle turbine le débit qui se présente, sans rien mettre en réserve',
  }),
  'Pompage pur': Object.freeze({
    short: 'pompage-turbinage', long: 'pompage-turbinage',
    blurb: 'elle remonte l’eau dans un lac haut aux heures creuses, et la turbine à la pointe',
  }),
  'Pompage mixte': Object.freeze({
    short: 'pompage-turbinage mixte', long: 'pompage-turbinage mixte',
    blurb: 'elle turbine l’eau qui lui arrive ET remonte de l’eau aux heures creuses',
  }),
  Marémotrice: Object.freeze({
    short: 'marémotrice', long: 'usine marémotrice',
    blurb: 'elle turbine le va-et-vient de la marée',
  }),
});

/**
 * The `technologie` column, where it says something the `kind` does not.
 *
 * Only one entry, and that is the measurement rather than an omission: over
 * the 79 sites the column holds six values, and five of them (`REP 900`,
 * `REP 1300`, `REP 1450`, `Charbon`, `Gaz`) repeat the kind word for word or
 * are contained in it. `TAC` does not, and it is the difference between a
 * plant that runs and a plant that waits.
 */
export const PLANT_TECH_PLAIN = Object.freeze({
  TAC: 'turbine à combustion — une machine de pointe, démarrée pour quelques heures',
});

/** The `combustible` column, in words. */
export const PLANT_FUEL_PLAIN = Object.freeze({
  'Uranium Enrichi': 'uranium enrichi',
  'Multi-oxyde d’uranium et de plutonium': 'MOX (uranium et plutonium recyclés)',
  "Multi-oxyde d'uranium et de plutonium": 'MOX (uranium et plutonium recyclés)',
});

/** Plural of a plain noun phrase: the head word only. `unité au charbon` → `unités au charbon`. */
function pluralizeHead(phrase, count) {
  if (!Number.isFinite(count) || count < 2) return phrase;
  const [head, ...rest] = String(phrase).split(' ');
  if (!head || head.endsWith('s') || head.endsWith('x')) return phrase;
  return [`${head}s`, ...rest].join(' ');
}

/**
 * Look one published kind string up, tolerating the ` + ` join a site with two
 * kinds arrives as.
 * @param {string} kind
 * @returns {{short: string, long: string, blurb: ?string}}
 */
export function plantKindPlain(kind) {
  const parts = String(kind ?? '').split(' + ').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { short: '', long: '', blurb: null, known: false };
  const entries = parts.map((part) => PLANT_KIND_PLAIN[part] || { short: part, long: part });
  return {
    short: entries.map((entry) => entry.short).join(' + '),
    long: entries.map((entry) => entry.long).join(' + '),
    // One regime, one sentence: a site published under two regimes gets the
    // labels joined and no blurb, rather than two sentences arguing.
    blurb: entries.length === 1 ? entries[0].blurb ?? null : null,
    // Whether EVERY part was in the table. A code this build has never seen is
    // still printed, but it is not inflected: see `plantKindText`.
    known: parts.every((part) => Object.hasOwn(PLANT_KIND_PLAIN, part)),
  };
}

/**
 * What the site IS, in one phrase — the count the publisher gives, then what
 * the machines are.
 *
 * `register: 'raw'` returns the publisher's own string, unchanged, which is
 * what a data-quality reader and the unit tests want; the default is the plain
 * one, which is what a reader wants. A hydro plant gets no count because the
 * file publishes none — see the module header — and a site whose file names no
 * kind gets the filière's own label rather than an invented one.
 *
 * @param {object|null|undefined} site
 * @param {{register?: 'plain'|'short'|'raw'}} [options]
 * @returns {string}
 */
export function plantKindText(site, { register = 'plain' } = {}) {
  const style = FILIERE_STYLES[String(site?.filiere ?? '')] || null;
  const raw = String(site?.kind ?? '').trim();
  const units = Number(site?.units);
  const count = Number.isFinite(units) && units >= 2 ? units : null;
  if (!raw) return style?.label || 'Centrale';
  if (register === 'raw') return count ? `${count} × ${raw}` : raw;
  const plain = plantKindPlain(raw);
  const phrase = register === 'short' ? plain.short : plain.long;
  if (!count) return phrase;
  // A code this build has never seen keeps the publisher's `N × CODE` form.
  // Inflecting it would invent French grammar for a string that is not a
  // French word — a future `EPR2` would read `2 EPR2s`.
  if (!plain.known) return `${count} × ${phrase}`;
  return `${count} ${pluralizeHead(phrase, count)}`;
}

/**
 * Label text for one site: name, installed power, and what it is.
 *
 * THE SHORT REGISTER, because this one is painted on the globe beside a name
 * and every character costs a collision. `GRAVELINES · 5 460 MW · 6 réacteurs`
 * is a sentence; `GRAVELINES · 5 460 MW · 6 × REP 900`, which is what it said,
 * is a part number. The palier survives on the card, where there is room for
 * it.
 * @param {object} site
 * @returns {string}
 */
export function plantLabelText(site) {
  return `${site?.name ?? ''} · ${formatMegawatts(site?.mw)} · ${plantKindText(site, { register: 'short' })}`;
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
export function buildEdfPlantCard(record, crossRegister = null) {
  const style = FILIERE_STYLES[String(record?.filiere ?? '')] || null;
  const lines = [String(record?.name ?? '').trim() || 'Centrale'];

  // WHAT THIS PLACE IS, before anything it can do. The card used to open on
  // "5 460 MW installés · 6 × REP 900", which asks a reader to already know
  // both what a megawatt is worth and what a REP is; it now opens on the
  // sentence "Centrale nucléaire · 6 réacteurs à eau pressurisée de 900 MW",
  // and the number follows as its evidence. Same order as `bruitGroundCard`,
  // for the same reason: the consequence leads, the measurement supports it.
  lines.push(`◈ ${plantSubjectText(record)}`);
  const regime = plantKindPlain(record?.kind).blurb;
  if (regime) lines.push(`▸ ${regime}`);

  // THE SENTENCE THIS WHOLE LAYER TURNS ON, and it was nowhere on the card.
  // A disc sized by nameplate over a site with three of six reactors down
  // looks exactly like a site running flat out, and a reader has no way to
  // know that from a number labelled "installés" alone.
  lines.push(`⚡ ${formatMegawatts(record?.mw)} installés : le maximum du site, `
    + 'pas ce qu’il produit à cet instant');

  // The machine and the fuel, where they say something the line above does
  // not. `TAC` is the only technology string that survives that test, and the
  // nuclear fuels are the only combustibles: everywhere else the column
  // repeats the kind, and a card that printed "Charbon" under "unité au
  // charbon" would be spending a line to say nothing twice.
  for (const note of plantMachineNotes(record)) lines.push(`▸ ${note}`);

  // Secondary reserve is the site's contracted contribution to frequency
  // containment — published for 56 of the 79 sites. "40 MW de réserve
  // secondaire" is the contract's own name for it and means nothing outside a
  // control room; what it does is one clause long.
  if (Number.isFinite(record?.secondaryReserveMw) && record.secondaryReserveMw > 0) {
    lines.push(`↻ ${formatMegawatts(record.secondaryReserveMw)} tenus en réserve `
      + 'pour stabiliser le réseau en quelques minutes');
  }

  const where = [record?.commune, record?.departement, record?.region]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(' · ');
  if (where) lines.push(`📍 ${where}`);

  const commissioned = commissioningText(record?.commissionedFrom, record?.commissionedTo);
  if (commissioned) lines.push(`🕐 ${plantCommissioningText(record, commissioned)}`);

  const operator = String(record?.operator ?? '').trim();
  // Every published row currently says EDF SA, so naming it adds nothing on its
  // own — it earns a line only if a future edition names somebody else.
  if (operator && !/^edf\b/i.test(operator)) lines.push(`⌁ exploitant : ${operator}`);

  // The vintage is per FILE, not per fleet: the three EDF datasets are three
  // editions, and a card that quoted one date for all of them would invent a
  // snapshot that never existed. Written the way a French reader writes a
  // date, not the way a database stores one.
  const reference = String(record?.referenceDate ?? '').trim();
  if (reference) {
    lines.push(`# relevé EDF du parc ${(style?.label || 'électrique').toLowerCase()}, `
      + `arrêté au ${frenchDay(reference)}`);
  }

  // THE OTHER REGISTER, when it disagrees. 43 of the 69 sites both registers
  // hold agree to the megawatt and a card repeating the same figure would be
  // noise; the 12 that differ by more than 5 % differ for a reason worth a
  // line — Flamanville is 2 660 MW here and 4 280 at RTE, which is the EPR.
  // The clause says WHY they differ, because "RTE : 1 680 MW" under "3 640 MW"
  // reads as one of the two being wrong.
  const rte = plantCrossRegisterLine(
    'RTE',
    crossRegister?.mw ?? null,
    record?.mw ?? null,
    crossRegister?.units
      ? `n’y compte que ${crossRegister.units > 1 ? `les ${crossRegister.units} groupes` : 'le groupe'} de 100 MW et plus`
      : null,
  );
  if (rte) lines.push(rte);

  return lines.join('\n');
}

/**
 * The subject line: what kind of place this is, then what its machines are.
 *
 * The filière label comes first and in full — `Centrale nucléaire`, not
 * `Nucléaire` — because it is the only line that answers "what am I looking
 * at" for a reader who clicked a coloured dot.
 * @param {object|null|undefined} record
 * @returns {string}
 */
export function plantSubjectText(record) {
  const style = FILIERE_STYLES[String(record?.filiere ?? '')] || null;
  const subject = style ? style.subject : 'Centrale électrique';
  // A hydro plant's kind IS its regime, and `Centrale hydraulique · retenue de
  // lac` is the sentence. A site whose file names no kind gets the subject
  // alone: `plantKindText` falls back to the filière label there, and pinning
  // that after the subject would paint `Centrale électrique · Centrale`.
  if (!String(record?.kind ?? '').trim()) return subject;
  return `${subject} · ${plantKindText(record)}`;
}

/**
 * What the `technologie` and `combustible` columns add, in words, or nothing.
 *
 * A value is printed only when the kind line has not already said it. That
 * test is against the PUBLISHED strings rather than their expansions, because
 * the expansions are prose and a substring test over prose would drop a real
 * difference the first time two sentences happened to overlap.
 * @param {object|null|undefined} record
 * @returns {Array<string>}
 */
export function plantMachineNotes(record) {
  const kind = String(record?.kind ?? '').trim().toLowerCase();
  const notes = [];
  const seen = new Set(kind ? [kind] : []);
  const add = (raw, table, prefix = '') => {
    const value = String(raw ?? '').trim();
    if (!value) return;
    const key = value.toLowerCase();
    // `Gaz` under a kind of `Gaz naturel`: the column is naming the same
    // machine in fewer words, which is not a second fact.
    if (seen.has(key) || (kind && kind.includes(key))) return;
    seen.add(key);
    const plain = value.split(' + ')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => table[part] || part)
      .join(' · ');
    notes.push(`${prefix}${plain}`);
  };
  add(record?.tech, PLANT_TECH_PLAIN);
  add(record?.fuel, PLANT_FUEL_PLAIN, 'combustible : ');
  return notes;
}

/**
 * The commissioning line, in the publisher's unit of account and in French.
 *
 * "tranches couplées 1981-1983" was two pieces of jargon and an en dash: a
 * `tranche` is a machine and `couplée` is connected to the grid. The noun is
 * the filière's own — a nuclear site counts réacteurs — and a single-unit site
 * says so in the singular rather than talking about "tranches".
 * @param {object|null|undefined} record
 * @param {string} span From {@link commissioningText}.
 * @returns {string}
 */
export function plantCommissioningText(record, span) {
  const style = FILIERE_STYLES[String(record?.filiere ?? '')] || null;
  const noun = style?.unitNoun || null;
  const units = Number(record?.units);
  const when = span.includes('–') ? `entre ${span.replace('–', ' et ')}` : `en ${span}`;
  // No unit noun means no unit count — a hydro plant publishes neither, so the
  // sentence is about the PLANT rather than about machines it never counted.
  if (!noun) return `mise en service ${when}`;
  // THE COUNT DECIDES THE PLURAL, not the span: a two-unit site commissioned
  // in one year is still two machines, and it read "unité raccordée en 1977".
  const counted = Number.isFinite(units) && units >= 2 ? units : null;
  const many = counted !== null || span.includes('–');
  // `unité` is feminine and `réacteur` is not, so the participle cannot be a
  // constant: "2 unités raccordés" is the kind of sentence that makes a reader
  // stop trusting the rest of the card.
  const e = style?.unitNounFeminine ? 'e' : '';
  if (many) return `${counted ? `${counted} ` : ''}${noun}s raccordé${e}s au réseau ${when}`;
  return `${noun} raccordé${e} au réseau ${when}`;
}

/** An ISO day as a French reader writes it. Anything else passes through. */
export function frenchDay(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(iso ?? '').trim();
}

/**
 * The protected card entry for the selected site.
 * @param {object} record
 * @param {object} position Cesium.Cartesian3 for the disc.
 * @returns {object|null}
 */
export function createEdfSelectedOverlayEntry(record, position, crossRegister = null) {
  if (!record || !position) return null;
  const [title, ...details] = buildEdfPlantCard(record, crossRegister).split('\n');
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
  /** Take-down for the fleet offer. Null while nothing is offered. */
  let _unpublishFleet = null;
  /** Take-down for the per-frame horizon pass. Null while the row is off. */
  let _preRenderRemover = null;

  /**
   * Offer this fleet's sites, so the two registers that borrowed its
   * coordinates can stand down where they hold the same site.
   *
   * The key is the layer's own site id — `nucleaire:GRAVELINES` — which is
   * exactly what `scripts/build-rte-units-registry.mjs` wrote into the RTE
   * pack's `placementRef` when it placed a station on this fleet's published
   * coordinate. No proximity anywhere: see `plantIdentity.js` for the 540 m
   * pair that rules a distance test out.
   */
  function publishFleetJoin() {
    if (!_enabled || !_records.length) {
      _unpublishFleet?.();
      _unpublishFleet = null;
      return;
    }
    const byId = new Map(_records.map((record) => [record.id, record]));
    _unpublishFleet?.();
    _unpublishFleet = publishJoin(PLANT_JOIN_KEYS.edf, (siteId) => {
      const record = byId.get(String(siteId || ''));
      return record ? { name: record.name, mw: record.mw, filiere: record.filiere } : null;
    });
  }

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
        // NEVER A FINITE DISTANCE HERE, and the reason is what this line used
        // to do. A point primitive carries ONE depth for its whole quad — the
        // depth of the site's own coordinate — so a depth-tested disc is
        // tested against the terrain under every pixel it covers. Looking
        // down at any angle other than straight down, the ground below the
        // anchor on screen is NEARER to the camera than the anchor is, so it
        // wins the test and eats the bottom half of the disc; the ground
        // above is farther, so the top half survives. The result is not a
        // half-hidden marker, it is a PARASOL: a flat-bottomed dome that
        // looks like a different symbol, on every site, at every camera
        // height above the old 5 000 m threshold. Reproduced at Gravelines at
        // 6 km, and it is what the fleet looks like at country scale, which
        // is where this layer is actually read.
        //
        // Drawing over the terrain instead means a site on the far side of
        // the planet would paint through the globe, so `onPreRender` culls
        // against the horizon — the arrangement `rteGeneration.js` already
        // uses for its station rings, which is why those rings were whole in
        // the same frame these discs were halves.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
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

  /**
   * Per-frame horizon pass.
   *
   * The price of drawing over the terrain: with the depth test off at every
   * distance, Gravelines would paint through the planet from a camera over
   * New Zealand. Nothing on this layer animates between polls — the files are
   * annual — so this is its only per-frame work, and it is 79 dot products.
   */
  function onPreRender() {
    if (!_enabled || !_drawn.size) return;
    const camera = _viewer?.camera;
    if (!camera) return;
    const occluder = horizonOccluder(camera);
    for (const drawn of _drawn.values()) {
      if (drawn.point) drawn.point.show = occluder.isPointVisible(drawn.position);
    }
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
    const entry = createEdfSelectedOverlayEntry(
      drawn.record,
      drawn.position,
      askJoin(PLANT_JOIN_KEYS.rteByEdf, drawn.record.id),
    );
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
      if (_viewer?.scene?.preRender && !_preRenderRemover) {
        _preRenderRemover = _viewer.scene.preRender.addEventListener(onPreRender);
      }
      // The fleet is already drawn if a previous session loaded it; republish
      // the labels the overlay host dropped on disable.
      publishFleetJoin();
      if (_records.length) repaint();
    },

    disable() {
      _enabled = false;
      publishFleetJoin();
      clearSelection();
      removeClickHandler();
      if (_preRenderRemover) {
        _preRenderRemover();
        _preRenderRemover = null;
      }
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
        publishFleetJoin();
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
      if (_preRenderRemover) {
        _preRenderRemover();
        _preRenderRemover = null;
      }
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
