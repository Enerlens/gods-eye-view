import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

/**
 * Événements routiers (FR) — what the road operators themselves have declared.
 *
 * Every Direction interdépartementale des routes publishes its live event log
 * to Tipi, and Bison Futé republishes the national aggregate as one keyless
 * DATEX II document under Licence Ouverte 2.0. This layer draws it: the
 * accidents, the rockfalls, the closures, the roadworks ordered for a Tuesday
 * in October, and the diversions posted around them.
 *
 * WHAT THIS IS NOT. It is not a congestion map — the `Trafic routier` layer
 * already colours flow, and `Capteurs trafic` measures it. This is the
 * *declared* state of the network: things a human operator typed into a
 * système d'information routière because they happened. On the 2026-08-31
 * snapshot that was 286 situations, of which nine were accidents and 184 were
 * roadworks, which is the honest shape of a road network on an ordinary evening.
 *
 * ── What the drawing is careful about ───────────────────────────────────────
 *
 * • **One situation, one marker.** DATEX II nests up to twelve records inside
 *   one situation: the accident, the two lanes it blocked, the four exits now
 *   closed. Drawing all of them would put one crash on the map twelve times, so
 *   the CAUSE is drawn and the consequences are counted on its card. The rule
 *   and its ordering live in `bisonFuteFeed.js`, under test.
 *
 * • **A segment is the ROAD where the record says enough to find it, and a
 *   chord where it does not.** A `Linear` location publishes its two endpoints
 *   as coordinates — the shape between them is not in this feed — but it ALSO
 *   publishes a point-repère address pair on a named route, which is a real
 *   linear reference. The proxy resolves that pair against the State's own
 *   survey of the carriageway (`config/rrn_centreline.json`, built by
 *   `scripts/build-rrn-centreline-pack.mjs`) and hands the layer the tarmac.
 *   Measured on the 2026-09-01 feed: 168 of 210 segments (80 %) are drawn on
 *   the road, and the traced line runs a median 1.02× its own chord.
 *
 *   The rest keep the chord, and the card keeps saying so. That is the honest
 *   split — the N126 roadworks near Castres were 37 km of straight line across
 *   open country for 40 km of road, which is what this fixes; a rockfall whose
 *   PR addresses disagree with its coordinates is still drawn as the line
 *   between two published points, because guessing would be worse.
 *
 * • **Planned is not happening.** 68 of the 286 situations had not started yet
 *   — roadworks ordered weeks ahead. They are drawn dimmer, sized smaller, and
 *   the default scope hides them, because a globe that paints October's
 *   roadworks over tonight's traffic is telling you something false about now.
 *
 * • **Ended means ended.** An operator can close an event with a lifecycle flag
 *   while its validity window stays open — a rockfall opened on 31 January and
 *   cleared in March would otherwise sit on the N20 forever. The flag wins.
 *
 * • **The RRN non concédé only.** The conceded motorways — the whole
 *   ASF/APRR/Sanef network — are NOT in this feed. Their absence is a property
 *   of the source (Bison Futé serves them under the credentialed *Action b*
 *   licence), not a gap this layer can fill, and the row says so.
 */

const EVENTS_URL = '/api/bison-fute/events';

/** Layer id, shared with the world overlay and the pick registry. */
export const ROAD_EVENTS_FR_LAYER_ID = 'road-events-fr';
const OVERLAY_SOURCE_ID = ROAD_EVENTS_FR_LAYER_ID;
const SELECTED_OVERLAY_SOURCE_ID = `${ROAD_EVENTS_FR_LAYER_ID}-selected`;
/** Bounded ambient-label cohort, matching the sibling alert sources. */
export const ROAD_EVENTS_FR_OVERLAY_COHORT_LIMIT = 40;
/** Shared ambient-label paint budget. */
export const ROAD_EVENTS_FR_OVERLAY_COLLISION_CAPACITY = 32;

/**
 * The aggregate is republished hourly, so this cadence is not about catching
 * the next edition — the proxy's conditional GET makes an early poll cost one
 * 304. It is about `state`: roadworks ordered for 08:30 become active at 08:30,
 * and a five-minute re-projection is what moves them without a reload.
 */
const UPDATE_INTERVAL_MS = 300_000;

/**
 * The eight categories, in legend order, with the French the DIRs use.
 *
 * `travaux` keeps the conventional roadworks yellow even though it is two
 * thirds of the feed: recolouring the majority to make the minority pop would
 * be styling against the data. The incident colours are hotter instead.
 */
export const ROAD_EVENT_CATEGORIES = Object.freeze({
  accident: Object.freeze({
    id: 'accident', label: 'Accident', color: '#ff3b30', priority: 8,
    blurb: 'Collision déclarée par l’exploitant',
  }),
  bouchon: Object.freeze({
    id: 'bouchon', label: 'Bouchon', color: '#ff2d95', priority: 7,
    blurb: 'Trafic anormal constaté',
  }),
  fermeture: Object.freeze({
    id: 'fermeture', label: 'Fermeture', color: '#ff7a1a', priority: 6,
    blurb: 'Route ou chaussée fermée',
  }),
  obstacle: Object.freeze({
    id: 'obstacle', label: 'Obstacle', color: '#b06bff', priority: 5,
    blurb: 'Obstacle, véhicule ou chaussée endommagée',
  }),
  intemperie: Object.freeze({
    id: 'intemperie', label: 'Intempérie', color: '#4dd0e1', priority: 4,
    blurb: 'Conditions météo affectant la route',
  }),
  travaux: Object.freeze({
    id: 'travaux', label: 'Travaux', color: '#ffd60a', priority: 3,
    blurb: 'Chantier en cours ou programmé',
  }),
  restriction: Object.freeze({
    id: 'restriction', label: 'Restriction', color: '#6ea8fe', priority: 2,
    blurb: 'Limitation, alternat, voie neutralisée',
  }),
  deviation: Object.freeze({
    id: 'deviation', label: 'Déviation', color: '#58d68d', priority: 1,
    blurb: 'Itinéraire de déviation ou bretelle fermée',
  }),
});

/**
 * Presentation for a category this build has never heard of.
 *
 * It gets its OWN id rather than borrowing `restriction`'s. Folding it into a
 * real category would tally a grey marker under a blue legend row — the legend
 * would say "Restriction 2" for something drawn as neither. It is kept out of
 * `ROAD_EVENT_CATEGORIES` so the eight real categories stay exactly the eight
 * the projection can emit, and `roadEventLegend` appends it when it has a
 * count, the same way the sensor layer's no-data band works.
 */
export const ROAD_EVENT_UNKNOWN_CATEGORY = Object.freeze({
  id: 'inconnu', label: 'Non classé', color: '#8a93a6', priority: 0,
  blurb: 'Type d’événement non reconnu par cette version',
});

/**
 * Resolve a served category to its presentation.
 * @param {unknown} id
 * @returns {typeof ROAD_EVENT_UNKNOWN_CATEGORY}
 */
export function roadEventCategory(id) {
  return ROAD_EVENT_CATEGORIES[String(id ?? '')] || ROAD_EVENT_UNKNOWN_CATEGORY;
}

/**
 * DATEX II subtype → the French an operator would say.
 *
 * Every value here was observed in the live feed on 2026-08-31; the rest of the
 * DATEX II enumerations are deliberately absent. An unknown code is shown AS
 * the code rather than silently dropped: "roadClosed" tells a reader something,
 * and an empty line tells them nothing.
 */
export const ROAD_EVENT_SUBTYPE_LABELS = Object.freeze({
  // Accident / obstruction
  accident: 'accident',
  brokenDownVehicle: 'véhicule en panne',
  abandonedVehicle: 'véhicule abandonné',
  objectOnTheRoad: 'objet sur la chaussée',
  obstructionOnTheRoad: 'obstacle sur la chaussée',
  incident: 'incident',
  rockfalls: 'chutes de pierres',
  subsidence: 'affaissement de chaussée',
  fallenTrees: 'chute d’arbres',
  damagedRoadSurface: 'chaussée dégradée',
  // Traffic
  queuingTraffic: 'file d’attente',
  slowTraffic: 'trafic ralenti',
  stationaryTraffic: 'trafic à l’arrêt',
  // Weather
  snowOnTheRoad: 'neige sur la chaussée',
  iceOnTheRoad: 'verglas',
  // Works
  maintenanceWork: 'entretien',
  repairWork: 'réparation',
  roadworks: 'travaux routiers',
  roadMarkingWork: 'marquage au sol',
  resurfacingWork: 'réfection de chaussée',
  roadsideWork: 'travaux en accotement',
  grassCuttingWork: 'fauchage',
  constructionWork: 'chantier de construction',
  // Lane and carriageway management
  roadClosed: 'route fermée',
  carriagewayClosed: 'chaussée fermée',
  laneClosures: 'voies neutralisées',
  closedPermanentlyForTheWinter: 'fermée pour l’hiver',
  singleAlternateLineTraffic: 'circulation alternée',
  narrowLanes: 'voies rétrécies',
  contraflow: 'basculement de circulation',
  weightRestrictionInOperation: 'restriction de tonnage',
  speedRestrictionInOperation: 'limitation de vitesse',
  noOvertaking: 'dépassement interdit',
  // Rerouting
  doNotUseExit: 'sortie fermée',
  doNotUseEntry: 'entrée fermée',
  useExit: 'sortie conseillée',
  followLocalDiversion: 'déviation locale',
  // Services
  serviceAreaClosed: 'aire de service fermée',
  // The `other` bucket the DIRs use when the meaning is only in the text.
  other: 'autre',
});

/** Severity, in the DIRs' own four levels. */
export const ROAD_EVENT_SEVERITIES = Object.freeze({
  lowest: { label: 'très faible', weight: 0 },
  low: { label: 'faible', weight: 1 },
  medium: { label: 'moyenne', weight: 2 },
  high: { label: 'forte', weight: 3 },
  highest: { label: 'majeure', weight: 4 },
});

/** TPEG direction → French. */
export const ROAD_EVENT_DIRECTIONS = Object.freeze({
  bothWays: 'dans les deux sens',
  northBound: 'sens nord',
  southBound: 'sens sud',
  eastBound: 'sens est',
  westBound: 'sens ouest',
  innerRing: 'sens intérieur',
  outerRing: 'sens extérieur',
});

/**
 * What the visitor is looking at. Three mutually exclusive scopes, because the
 * question "is this happening now" has exactly one honest default.
 */
export const ROAD_EVENT_SCOPES = Object.freeze([
  Object.freeze({
    id: 'active', label: 'En cours', states: ['active'],
    title: 'Uniquement les événements en cours',
  }),
  Object.freeze({
    id: 'upcoming', label: '+ À venir', states: ['active', 'planned'],
    title: 'Ajouter les chantiers et fermetures programmés',
  }),
  Object.freeze({
    id: 'all', label: 'Tout', states: ['active', 'planned', 'ended'],
    title: 'Ajouter les événements que l’exploitant a clôturés',
  }),
]);

const SCOPE_BY_ID = new Map(ROAD_EVENT_SCOPES.map((scope) => [scope.id, scope]));
/** Default scope: what is happening right now. */
export const ROAD_EVENT_DEFAULT_SCOPE = 'active';

/**
 * Whether one event's state is inside a scope.
 * @param {string} scopeId
 * @param {string} state
 * @returns {boolean}
 */
export function roadEventScopeAllows(scopeId, state) {
  const scope = SCOPE_BY_ID.get(scopeId) || SCOPE_BY_ID.get(ROAD_EVENT_DEFAULT_SCOPE);
  return scope.states.includes(String(state));
}

/** Marker size in pixels, by severity. A safety-related event is one step up. */
export function roadEventPixelSize(event) {
  const weight = ROAD_EVENT_SEVERITIES[String(event?.severity)]?.weight ?? 2;
  const base = 7 + weight * 1.6;
  const sized = event?.safety ? base + 2 : base;
  return event?.state === 'planned' ? sized * 0.8 : sized;
}

/** Stroke width for a segment, by severity. */
export function roadEventStrokeWidth(event) {
  const weight = ROAD_EVENT_SEVERITIES[String(event?.severity)]?.weight ?? 2;
  return (event?.state === 'planned' ? 2 : 3) + weight * 0.9;
}

/**
 * Opacity by state. A planned event is drawn as a ghost of itself and an ended
 * one fainter still — visible when asked for, never competing with now.
 *
 * The floor is 0.45 and not the 0.3 this started at, because two of the basemaps
 * this globe ships with are LIGHT: Plan IGN v2 and a globe with no imagery
 * loaded are both near-white, and a 0.3-alpha marker on white is a marker
 * nobody can find. Measured in the QA harness against a bare globe — at 0.3 the
 * accident's own red did not register a single pixel above the background.
 */
export function roadEventAlpha(state) {
  if (state === 'planned') return 0.65;
  if (state === 'ended') return 0.45;
  return 0.95;
}

/**
 * Chord length of a segment, in km. Published so a card can say when the two
 * endpoints are far enough apart that the straight line between them is not the
 * road.
 * @param {number[]} coordinates `[lon1, lat1, lon2, lat2]`
 * @returns {number}
 */
export function roadEventChordKm(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 4) return 0;
  const [lon1, lat1, lon2, lat2] = coordinates.map(Number);
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return 0;
  const dy = (lat1 - lat2) * 111.32;
  const dx = (lon1 - lon2) * 111.32 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/**
 * Length ALONG a drawn segment, in km.
 *
 * `roadEventChordKm` above measures the straight line between the first and
 * last vertex, which is the right number for a chord and the wrong one for a
 * traced road: the N126 roadworks are 37 km of chord and 40 km of tarmac, and
 * a card that printed the chord over a drawing of the road would be describing
 * a different line than the one on screen.
 * @param {Array<number>} coordinates Flat `[lon, lat, …]`.
 * @returns {number}
 */
export function roadEventPathKm(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 4) return 0;
  let total = 0;
  for (let i = 2; i < coordinates.length; i += 2) {
    const lat1 = Number(coordinates[i - 1]);
    const lat2 = Number(coordinates[i + 1]);
    const lon1 = Number(coordinates[i - 2]);
    const lon2 = Number(coordinates[i]);
    if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) continue;
    const dy = (lat1 - lat2) * 111.32;
    const dx = (lon1 - lon2) * 111.32 * Math.cos((lat1 * Math.PI) / 180);
    total += Math.hypot(dx, dy);
  }
  return total;
}

/** Past this, a straight chord stops being a fair drawing of a road. */
export const ROAD_EVENT_LONG_CHORD_KM = 10;

/**
 * French plural of a category label.
 *
 * `travaux` is ALREADY plural — "2 travauxs" is not a word — and so is any
 * label ending in s, x or z. This is the whole rule, and it is here rather than
 * inline because the card says "Conséquences déclarées : 2 travaux, 1 fermeture"
 * and getting that wrong is visible on every roadworks card in France.
 * @param {string} word Lower-cased label.
 * @param {number} count
 * @returns {string}
 */
function pluralize(word, count) {
  if (count <= 1) return word;
  return /[sxz]$/.test(word) ? word : `${word}s`;
}

/** Format an epoch as Paris wall time, the only clock a French DIR works in. */
function formatParis(ms, options) {
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...options }).format(ms);
  } catch {
    return new Date(ms).toISOString();
  }
}

/**
 * The event's time window, phrased for a card.
 * @param {object} event Served event.
 * @param {number} nowMs Reference instant.
 * @returns {string|null}
 */
export function formatRoadEventWindow(event, nowMs = Date.now()) {
  const sameDay = (ms) => formatParis(ms, { dateStyle: 'short' }) === formatParis(nowMs, { dateStyle: 'short' });
  const stamp = (ms) => (sameDay(ms)
    ? formatParis(ms, { hour: '2-digit', minute: '2-digit' })
    : formatParis(ms, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
  const start = Number.isFinite(event?.start) ? stamp(event.start) : null;
  const end = Number.isFinite(event?.end) ? stamp(event.end) : null;
  if (event?.state === 'planned') return start ? `Prévu à partir du ${start}` : 'Programmé';
  if (event?.state === 'ended') return end ? `Terminé le ${end}` : 'Clôturé par l’exploitant';
  if (start && end) return `De ${start} à ${end}`;
  if (start) return `Depuis ${start}`;
  return null;
}

/** Human title for one event: what happened, and on which road. */
export function roadEventTitle(event) {
  const category = roadEventCategory(event?.category);
  const subtype = ROAD_EVENT_SUBTYPE_LABELS[String(event?.subtype)] || event?.subtype || null;
  // The subtype is the specific thing ("chutes de pierres"); the category is the
  // bucket ("Obstacle"). When the subtype merely restates the category — an
  // `accidentType` of `accident` — one of them is noise.
  const head = subtype && subtype.toLowerCase() !== category.label.toLowerCase()
    ? `${category.label} · ${subtype}`
    : category.label;
  return event?.road ? `${head} — ${event.road}` : head;
}

/**
 * Card body for one event, as ordered lines. Every line is something the feed
 * actually published; nothing is inferred.
 * @param {object} event
 * @param {number} [nowMs]
 * @returns {string[]}
 */
export function roadEventDetails(event, nowMs = Date.now()) {
  const lines = [];
  if (event?.description) {
    // The DIRs write multi-line orders into one comment; a card is not a page.
    for (const line of String(event.description).split('\n').map((part) => part.trim()).filter(Boolean)) {
      lines.push(line);
    }
  }
  const place = [event?.town, event?.location].filter(Boolean).join(' — ');
  if (place) lines.push(place);
  if (event?.marker) lines.push(`PR ${event.marker}`);

  const window = formatRoadEventWindow(event, nowMs);
  if (window) lines.push(window);

  const direction = ROAD_EVENT_DIRECTIONS[String(event?.direction)];
  const severity = ROAD_EVENT_SEVERITIES[String(event?.severity)]?.label;
  const meta = [direction, severity ? `gravité ${severity}` : null].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);

  if (event?.lanes && Number.isFinite(event.lanes.restricted) && event.lanes.restricted > 0) {
    const total = Number.isFinite(event.lanes.total) ? ` sur ${event.lanes.total}` : '';
    lines.push(`${event.lanes.restricted} voie${event.lanes.restricted > 1 ? 's' : ''} neutralisée${event.lanes.restricted > 1 ? 's' : ''}${total}`);
  }
  // `probable` and `riskOf` are the feed saying it has not happened yet. A card
  // that shows a forecast as fact is the one lie this layer must not tell.
  if (event?.probability === 'probable') lines.push('Prévision — non confirmé');
  else if (event?.probability === 'riskOf') lines.push('Risque signalé — non confirmé');

  const also = Object.entries(event?.also || {})
    .map(([key, count]) => `${count} ${pluralize(roadEventCategory(key).label.toLowerCase(), count)}`)
    .join(', ');
  if (also) lines.push(`Conséquences déclarées : ${also}`);

  if (event?.geometry?.kind === 'segment') {
    const shaped = event.geometry.shaped === 'carriageway';
    // Along the road when the road is what is drawn; across the chord when it
    // is not. Printing one over a drawing of the other describes a line that
    // is not on the screen.
    const km = shaped
      ? roadEventPathKm(event.geometry.coordinates)
      : roadEventChordKm(event.geometry.coordinates);
    const distance = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km >= 10 ? 0 : 1)} km`;
    if (shaped) {
      // The provenance matters as much as the number: this line follows the
      // State's own survey of the carriageway, resolved from the point-repère
      // addresses the record publishes. It is not a guess at a route.
      lines.push(`Section de ${distance} — tracé relevé sur la chaussée`);
    } else {
      // The honest caveat, and only where it is actually needed.
      lines.push(km >= ROAD_EVENT_LONG_CHORD_KM
        ? `Section de ${distance} — extrémités publiées, tracé non fourni`
        : `Section de ${distance}`);
    }
  }
  if (event?.operator) lines.push(`Source : ${event.operator}`);
  if (event?.safety) lines.push('Message lié à la sécurité');
  return lines;
}

/**
 * Tally events by category and state.
 * @param {object[]} events
 * @returns {{total:number, byCategory:Record<string,number>, byState:Record<string,number>, safety:number}}
 */
export function summarizeRoadEvents(events) {
  const byCategory = {};
  const byState = { active: 0, planned: 0, ended: 0 };
  let safety = 0;
  for (const event of Array.isArray(events) ? events : []) {
    const key = roadEventCategory(event?.category).id;
    byCategory[key] = (byCategory[key] || 0) + 1;
    if (event?.state in byState) byState[event.state] += 1;
    if (event?.safety) safety += 1;
  }
  return { total: Array.isArray(events) ? events.length : 0, byCategory, byState, safety };
}

/**
 * Legend rows for the toggle panel, severity order, zero counts omitted.
 * @param {Record<string, number>} byCategory
 * @returns {Array<{label:string,color:string,blurb:string,count:number}>}
 */
export function roadEventLegend(byCategory) {
  const rows = Object.values(ROAD_EVENT_CATEGORIES)
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .filter((category) => (byCategory?.[category.id] || 0) > 0)
    .map((category) => ({
      label: category.label,
      color: category.color,
      blurb: category.blurb,
      count: byCategory[category.id],
    }));
  // Last, and only when it happened: the rows must always sum to what is drawn.
  const unclassified = byCategory?.[ROAD_EVENT_UNKNOWN_CATEGORY.id];
  if (unclassified > 0) {
    rows.push({
      label: ROAD_EVENT_UNKNOWN_CATEGORY.label,
      color: ROAD_EVENT_UNKNOWN_CATEGORY.color,
      blurb: ROAD_EVENT_UNKNOWN_CATEGORY.blurb,
      count: unclassified,
    });
  }
  return rows;
}

/** Anchor for a drawn event: the point, or the midpoint of a chord. */
export function roadEventAnchor(geometry) {
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) return null;
  if (geometry.kind === 'segment' && coordinates.length >= 4) {
    return [(coordinates[0] + coordinates[2]) / 2, (coordinates[1] + coordinates[3]) / 2];
  }
  if (coordinates.length >= 2) return [coordinates[0], coordinates[1]];
  return null;
}

/**
 * Ambient label for one event.
 * @param {object} input
 * @param {string} input.id
 * @param {Cesium.Cartesian3} input.position
 * @param {object} input.event
 * @returns {object}
 */
export function createRoadEventOverlayEntry({ id, position, event }) {
  const category = roadEventCategory(event?.category);
  const severity = ROAD_EVENT_SEVERITIES[String(event?.severity)]?.weight ?? 2;
  return {
    id: `road-event-label:${id}`,
    position,
    variant: 'label',
    title: roadEventTitle(event),
    accent: category.color,
    // Category outranks severity outranks safety; ties break on id in the
    // selector, so a label cohort is stable between two identical polls.
    priority: category.priority * 1000 + severity * 100 + (event?.safety ? 10 : 0),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Card entry for the selected event. */
export function createRoadEventSelectedEntry({ id, position, event, nowMs = Date.now() }) {
  if (!id || !position) return null;
  return {
    id: String(id),
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: roadEventTitle(event),
    details: roadEventDetails(event, nowMs),
    accent: roadEventCategory(event?.category).color,
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

/** Keep the most consequential labels, with stable identity as the tie-break. */
export function selectRoadEventOverlayCohort(entries, limit = ROAD_EVENTS_FR_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    ROAD_EVENTS_FR_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one event to a JSON-safe analyst record. Pure — no Cesium types.
 * @param {object|null|undefined} event
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapRoadEventAnalystRecord(event, index = 0) {
  const text = (value) => { const trimmed = String(value ?? '').trim(); return trimmed || null; };
  const anchor = roadEventAnchor(event?.geometry);
  return {
    id: text(event?.id) || `EVT-${String(index).padStart(4, '0')}`,
    category: roadEventCategory(event?.category).id,
    label: roadEventTitle(event),
    state: text(event?.state),
    severity: text(event?.severity),
    safety: event?.safety === true,
    road: text(event?.road),
    town: text(event?.town),
    operator: text(event?.operator),
    lat: anchor ? anchor[1] : null,
    lon: anchor ? anchor[0] : null,
    startMs: Number.isFinite(event?.start) ? event.start : null,
    endMs: Number.isFinite(event?.end) ? event.end : null,
  };
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * `MAP_STACKS` ids that render imagery on the SHOWN Cesium globe. Same
 * allowlist, and the same reason, as the Vigicrues layer next door: a stack id
 * this module has never heard of must reach the safe BOTH fallback rather than
 * be asserted onto a surface that is not there.
 */
const GLOBE_STACK_IDS = Object.freeze(new Set(['bing-aerial', 'bing-labels', 'osm', 'ign-ortho', 'ign-plan']));

/** Ground-line classification for one map stack. */
export function roadEventClassificationForStack(activeId) {
  if (activeId === 'photoreal') return Cesium.ClassificationType.CESIUM_3D_TILE;
  if (GLOBE_STACK_IDS.has(activeId)) return Cesium.ClassificationType.TERRAIN;
  return Cesium.ClassificationType.BOTH;
}

/** Derive the active surface from live scene state (boot fires no event). */
export function roadEventClassificationForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

export function createRoadEventsFranceLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  eventsUrl = EVENTS_URL,
  mapStackEventTarget = typeof window === 'undefined' ? null : window,
  fetchImpl = typeof fetch === 'undefined' ? null : fetch,
} = {}) {
  let _viewer = null;
  let _dataSource = null;
  let _events = [];
  let _visible = [];
  let _byRenderId = new Map();
  let _summary = summarizeRoadEvents([]);
  let _scope = ROAD_EVENT_DEFAULT_SCOPE;
  let _publishedAtMs = null;
  let _counts = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _loading = false;
  let _enabled = false;
  let _selectedId = null;
  let _clickHandler = null;
  let _mapStackListener = null;
  let _rowControlsListener = null;
  let _classificationType = Cesium.ClassificationType.BOTH;

  const renderId = (id) => `road-event:${id}`;

  function applyClassification(next) {
    if (next === undefined || next === _classificationType) return;
    _classificationType = next;
    if (!_dataSource) return;
    for (const entity of _dataSource.entities.values) {
      if (entity.polyline) entity.polyline.classificationType = next;
    }
    _viewer?.scene?.requestRender?.();
  }

  /** Re-derive the drawn subset from the served events and the active scope. */
  function applyScope() {
    _visible = _events.filter((event) => roadEventScopeAllows(_scope, event.state));
    _summary = summarizeRoadEvents(_visible);
  }

  function rebuildEntities() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    _byRenderId = new Map();
    for (const event of _visible) {
      const category = roadEventCategory(event.category);
      const alpha = roadEventAlpha(event.state);
      const color = Cesium.Color.fromCssColorString(category.color);
      const id = renderId(event.id);
      const anchor = roadEventAnchor(event.geometry);
      if (!anchor) continue;
      const position = Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]);

      if (event.geometry.kind === 'segment') {
        const [lon1, lat1, lon2, lat2] = event.geometry.coordinates;
        _dataSource.entities.add({
          id,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray([lon1, lat1, lon2, lat2]),
            width: roadEventStrokeWidth(event),
            // Static positions and a static material — a CallbackProperty on
            // clamped ground geometry re-tessellates it every frame, the lesson
            // the earthquake layer paid for in measured milliseconds.
            material: new Cesium.ColorMaterialProperty(color.withAlpha(alpha)),
            clampToGround: true,
            classificationType: _classificationType,
          },
        });
      } else {
        _dataSource.entities.add({
          id,
          position,
          point: {
            pixelSize: roadEventPixelSize(event),
            color: color.withAlpha(alpha),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            // Clamped, not drawn on the ellipsoid: an event on the col du
            // Glandon sits 1 900 m under the terrain otherwise, and appears to
            // slide as the camera pans.
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: 5000,
          },
        });
      }
      _byRenderId.set(id, { event, position });
    }
    if (_selectedId && !_byRenderId.has(_selectedId)) clearSelection();
  }

  function publishOverlay() {
    if (!_enabled) return;
    const entries = [];
    for (const [id, record] of _byRenderId) {
      entries.push(createRoadEventOverlayEntry({ id, position: record.position, event: record.event }));
    }
    overlayHost.setEntries(
      OVERLAY_SOURCE_ID,
      selectRoadEventOverlayCohort(entries),
      {
        cohortLimit: ROAD_EVENTS_FR_OVERLAY_COHORT_LIMIT,
        collisionCapacity: ROAD_EVENTS_FR_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  function clearSelection() {
    _selectedId = null;
    overlayHost.clearSource(SELECTED_OVERLAY_SOURCE_ID);
  }

  function selectEvent(id) {
    const record = _byRenderId.get(id);
    if (!record) return;
    _selectedId = id;
    const entry = createRoadEventSelectedEntry({
      id,
      position: record.position,
      event: record.event,
    });
    if (entry) {
      overlayHost.setEntries(SELECTED_OVERLAY_SOURCE_ID, [entry], {
        cohortLimit: 1,
        collisionCapacity: 1,
        moving: false,
      });
    }
    governorRequestRender('road-events-fr-select');
  }

  /** Resolve a Cesium pick into one of this layer's render ids. */
  function resolvePick(picked) {
    if (!picked) return null;
    const direct = picked.id?.id;
    if (typeof direct === 'string' && _byRenderId.has(direct)) return direct;
    if (typeof picked.id === 'string' && _byRenderId.has(picked.id)) return picked.id;
    const primitiveId = picked.primitive?.id;
    if (typeof primitiveId === 'string' && _byRenderId.has(primitiveId)) return primitiveId;
    return null;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && _selectedId) clearSelection();
  }

  function installClickHandler(viewer) {
    // No canvas means no scene to click on — a unit harness, or a viewer torn
    // down mid-enable. Cesium would throw on the listener install.
    if (_clickHandler || !viewer?.scene?.canvas) return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      const id = resolvePick(viewer.scene.pick(click.position));
      if (id) selectEvent(id);
      else if (_selectedId) clearSelection();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
  }

  async function load() {
    if (!fetchImpl) return false;
    _loading = true;
    try {
      const response = await fetchImpl(eventsUrl);
      if (!response.ok) {
        _lastError = `Bison Futé HTTP ${response.status}`;
        console.warn(`[Data:RoadEvents FR] Feed returned ${response.status}`);
        return false;
      }
      const payload = await response.json();
      if (!Array.isArray(payload?.events)) {
        _lastError = 'Réponse Bison Futé malformée';
        return false;
      }
      _events = payload.events;
      _publishedAtMs = Number.isFinite(payload.publishedAtMs) ? payload.publishedAtMs : null;
      _counts = payload.counts || null;
      _stale = payload.stale === true;
      _lastUpdate = Date.now();
      _lastError = null;
      applyScope();
      rebuildEntities();
      publishOverlay();
      _rowControlsListener?.();
      _viewer?.scene?.requestRender?.();
      console.log(
        `[Data:RoadEvents FR] ${_summary.total} événements dessinés `
        + `(${_events.length} publiés, ${_summary.byState.active} en cours)`,
      );
      return true;
    } catch (error) {
      console.warn('[Data:RoadEvents FR] Fetch error:', error);
      _lastError = 'Réseau Bison Futé indisponible';
      return false;
    } finally {
      _loading = false;
    }
  }

  const layer = {
    id: ROAD_EVENTS_FR_LAYER_ID,
    name: 'Événements routiers (FR)',
    icon: '⚠',
    source: 'Bison Futé / DIR (DATEX II)',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(ROAD_EVENTS_FR_LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _events = [];
      _visible = [];
      _byRenderId = new Map();
      _summary = summarizeRoadEvents([]);
      _publishedAtMs = null;
      _counts = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      _classificationType = roadEventClassificationForScene(viewer?.scene);
      if (mapStackEventTarget && !_mapStackListener) {
        _mapStackListener = (event) => {
          applyClassification(event?.detail?.activeId
            ? roadEventClassificationForStack(event.detail.activeId)
            : roadEventClassificationForScene(_viewer?.scene));
        };
        mapStackEventTarget.addEventListener('gev:map-stack-changed', _mapStackListener);
      }
      overlayHost.setVisible(OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(SELECTED_OVERLAY_SOURCE_ID, false);
      console.log('[Data:RoadEvents FR] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      applyClassification(roadEventClassificationForScene(viewer?.scene || _viewer?.scene));
      overlayHost.setVisible(OVERLAY_SOURCE_ID, true);
      overlayHost.setVisible(SELECTED_OVERLAY_SOURCE_ID, true);
      if (viewer) {
        installClickHandler(viewer);
        registerPickOwner(ROAD_EVENTS_FR_LAYER_ID, (pickedId) => _byRenderId.has(pickedId));
      }
      publishOverlay();
    },

    disable() {
      _enabled = false;
      clearSelection();
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(OVERLAY_SOURCE_ID);
      overlayHost.setVisible(OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(SELECTED_OVERLAY_SOURCE_ID, false);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(ROAD_EVENTS_FR_LAYER_ID);
    },

    async update() {
      if (!_enabled) return false;
      return load();
    },

    destroy(viewer) {
      this.disable();
      if (mapStackEventTarget && _mapStackListener) {
        mapStackEventTarget.removeEventListener('gev:map-stack-changed', _mapStackListener);
        _mapStackListener = null;
      }
      if (_dataSource && viewer) {
        viewer.dataSources.remove(_dataSource, true);
      }
      _dataSource = null;
      _viewer = null;
      _events = [];
      _visible = [];
      _byRenderId = new Map();
      _summary = summarizeRoadEvents([]);
      _publishedAtMs = null;
      _counts = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    setParams(params = {}) {
      if (params.scope === undefined) return false;
      const next = SCOPE_BY_ID.has(params.scope) ? params.scope : null;
      if (!next || next === _scope) return false;
      _scope = next;
      applyScope();
      rebuildEntities();
      publishOverlay();
      _rowControlsListener?.();
      governorRequestRender('road-events-fr-scope');
      return true;
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getRowControls() {
      const chips = ROAD_EVENT_SCOPES.map((scope) => ({
        id: scope.id,
        label: scope.label,
        active: _scope === scope.id,
        state: _scope === scope.id ? 'active' : 'idle',
        title: scope.title,
        params: { scope: scope.id },
      }));
      return { chips, legend: roadEventLegend(_summary.byCategory) };
    },

    getAnalystRecords(maxCount = 400) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 400;
      const records = [];
      for (const event of _visible) {
        if (records.length >= limit) break;
        records.push(mapRoadEventAnalystRecord(event, records.length));
      }
      return records;
    },

    getStats() {
      return {
        count: _summary.total,
        lastUpdate: _lastUpdate,
        error: _lastError,
        loading: _loading,
        stale: _stale,
        // Licence Ouverte 2.0's second limb: state the date of the last update
        // of the information reused, not just who produced it.
        publishedAt: _publishedAtMs,
        scope: _scope,
        active: _summary.byState.active,
        planned: _summary.byState.planned,
        safety: _summary.safety,
        categories: _summary.byCategory,
        // What the feed published, against what is drawn under the scope. The
        // difference is the answer to "why is the map emptier than the count".
        published: _events.length,
        upstream: _counts,
        coverage: 'RRN non concédé',
      };
    },
  };

  return layer;
}

const roadEventsFranceLayer = createRoadEventsFranceLayer();

export default roadEventsFranceLayer;
