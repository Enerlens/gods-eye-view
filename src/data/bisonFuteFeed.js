/**
 * Bison Futé feed projection — the seam between the raw DATEX II event document
 * and the compact JSON the browser is actually served.
 *
 * Lives here rather than inside `vite.config.js` for the same reason
 * `vigicruesFeed.js` and `firmsCsv.js` do: the parsing of a third-party feed is
 * the part most likely to break when that feed shifts, so it belongs somewhere
 * a unit test can point at a real captured response. The dev-server proxy
 * imports this projection; nothing in the browser bundle does.
 *
 * THE PRODUCT
 *
 *   Événementiel-DIR — every incident, roadworks order, closure, diversion and
 *     restriction the Directions interdépartementales des routes have declared
 *     on the non-conceded national network, as DATEX II v2 `SituationPublication`.
 *
 * It is open, keyless, Licence Ouverte 2.0, and covers the RRN **non concédé**
 * only: the conceded motorways (the ASF/APRR/Sanef network) are NOT in here and
 * their absence is a property of the source, not a gap in this code.
 *
 * The SIBLING product on the same host — QTV-DIR, the six-minute speed and flow
 * snapshot — is read by `datexRoadStatus.js` for the `road-status-fr` layer,
 * which also draws Traficolor. This file deliberately does not touch it: two
 * readers of one feed is how two layers end up disagreeing about the same road.
 *
 * MEASURED against the live feed on 2026-08-31:
 *   - 3,365,501 bytes raw / 165,296 gzipped, ETag + Last-Modified both served,
 *     republished hourly at HH:13 (the payload's own `publicationTime` matched
 *     `Last-Modified` to the second)
 *   - 286 situations holding 600 situation records — 191 points, 409 segments,
 *     and every single record carried coordinates
 *
 * Conditional GET works (verified 304 with `If-None-Match`), which is what makes
 * a 5-minute poll of a 3.3 MB document affordable — see the proxy in
 * `vite.config.js`.
 */

// ---------------------------------------------------------------------------
// A minimal XML reader
// ---------------------------------------------------------------------------

/**
 * WHY A HAND-WRITTEN PARSER and not a dependency: this is a machine-generated
 * document from one supplier against a published schema, and the alternative is
 * adding a parser to `package.json` for ~90 lines of scanning. `datexRoadStatus.js`
 * reads its own DATEX II product with targeted regexes for the same reason — the
 * repo has no XML dependency, and neither reader needs one. This scanner
 * deliberately understands only what DATEX II uses: elements, attributes, text,
 * comments, CDATA and the five predefined entities. It has no DTD, no namespace
 * resolution and no entity declarations, because a feed that needed any of those
 * would be a feed this projection could not trust anyway.
 *
 * Namespace PREFIXES are stripped rather than resolved. Tipi's own two
 * publications disagree about them — this one is `ns2:`-prefixed with the DATEX
 * namespace on the prefix, while QTV declares the same namespace as the default
 * — so matching on prefixed names would tie the reader to one publication's
 * habit. Local names are unambiguous inside DATEX II, and `xsi:type` is read as
 * the attribute `type`, its own prefix stripped the same way.
 */

/** One parsed element. `text` is the concatenated direct text content. */
class XmlElement {
  constructor(name, attrs) {
    /** @type {string} Local name, prefix stripped. */
    this.name = name;
    /** @type {Record<string,string>} Attributes, prefixes stripped. */
    this.attrs = attrs;
    /** @type {XmlElement[]} */
    this.children = [];
    /** @type {string} */
    this.text = '';
  }
}

const XML_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
});

/**
 * Decode the predefined entities and numeric character references.
 * @param {string} raw Raw text run.
 * @returns {string}
 */
export function decodeXmlText(raw) {
  if (raw.indexOf('&') === -1) return raw;
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return Object.hasOwn(XML_ENTITIES, body) ? XML_ENTITIES[body] : match;
  });
}

/** Strip a namespace prefix from a qualified name. */
function localName(qualified) {
  const colon = qualified.indexOf(':');
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

const ATTRIBUTE_PATTERN = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Parse one start-tag's attribute run into a plain object. */
function parseAttributes(source) {
  const attrs = {};
  if (!source || !source.includes('=')) return attrs;
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match = ATTRIBUTE_PATTERN.exec(source);
  while (match) {
    attrs[localName(match[1])] = decodeXmlText(match[3] !== undefined ? match[3] : match[4]);
    match = ATTRIBUTE_PATTERN.exec(source);
  }
  return attrs;
}

/**
 * Parse an XML document into a tree of {@link XmlElement}.
 *
 * Tolerant by design in one direction only: unexpected content (comments,
 * processing instructions, a stray close tag) is skipped, but a document with
 * no root element throws rather than returning an empty tree that a caller
 * would report as "the feed published nothing today".
 *
 * @param {string} text Raw XML.
 * @returns {XmlElement} Root element.
 * @throws {Error} When the document holds no element at all.
 */
export function parseXml(text) {
  const source = String(text ?? '');
  const stack = [];
  let root = null;
  let cursor = 0;

  while (cursor < source.length) {
    const open = source.indexOf('<', cursor);
    if (open === -1) break;

    if (open > cursor && stack.length) {
      const run = source.slice(cursor, open);
      // Elements in these documents hold either children or text, never both,
      // so trimming here cannot swallow significant whitespace between runs.
      if (run.trim()) stack[stack.length - 1].text += decodeXmlText(run);
    }

    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      cursor = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      const body = source.slice(open + 9, end === -1 ? source.length : end);
      if (stack.length) stack[stack.length - 1].text += body;
      cursor = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', open) || source.startsWith('<!', open)) {
      const end = source.indexOf('>', open + 2);
      cursor = end === -1 ? source.length : end + 1;
      continue;
    }

    const close = source.indexOf('>', open + 1);
    if (close === -1) break;
    const body = source.slice(open + 1, close);

    if (body[0] === '/') {
      const name = localName(body.slice(1).trim());
      // Pop to the nearest matching open element. A mismatched close tag in a
      // machine-generated feed is corruption, and unwinding to the match keeps
      // the rest of the document readable instead of nesting everything after
      // it under the wrong parent.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      cursor = close + 1;
      continue;
    }

    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const space = inner.search(/\s/);
    const name = localName(space === -1 ? inner : inner.slice(0, space));
    const element = new XmlElement(name, space === -1 ? {} : parseAttributes(inner.slice(space)));
    if (stack.length) stack[stack.length - 1].children.push(element);
    else if (!root) root = element;
    if (!selfClosing) stack.push(element);
    cursor = close + 1;
  }

  if (!root) throw new Error('XML document holds no root element');
  return root;
}

/**
 * First direct child with this local name.
 * @param {XmlElement|null|undefined} element
 * @param {string} name
 * @returns {XmlElement|null}
 */
export function child(element, name) {
  const children = element?.children;
  if (!children) return null;
  for (let i = 0; i < children.length; i++) {
    if (children[i].name === name) return children[i];
  }
  return null;
}

/**
 * Follow a chain of direct-child names.
 * @param {XmlElement|null|undefined} element
 * @param {...string} names
 * @returns {XmlElement|null}
 */
export function descend(element, ...names) {
  let node = element || null;
  for (const name of names) {
    node = child(node, name);
    if (!node) return null;
  }
  return node;
}

/**
 * Every descendant with this local name, in document order.
 * @param {XmlElement|null|undefined} element
 * @param {string} name
 * @returns {XmlElement[]}
 */
export function findAll(element, name) {
  const found = [];
  const walk = (node) => {
    for (const candidate of node.children) {
      if (candidate.name === name) found.push(candidate);
      walk(candidate);
    }
  };
  if (element) walk(element);
  return found;
}

/** Trimmed text of a descended element, or null. */
function textAt(element, ...names) {
  const node = descend(element, ...names);
  const value = node ? node.text.trim() : '';
  return value || null;
}

/** Finite number from a descended element, or null. */
function numberAt(element, ...names) {
  const raw = textAt(element, ...names);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Epoch ms from an ISO-8601 stamp, or null. Never `Invalid Date`. */
export function parseTimestampMs(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// Événementiel-DIR — road events
// ---------------------------------------------------------------------------

/**
 * Coordinate precision for served geometry, in decimal places. 5 dp is ~1 m
 * against events whose own position is a PR marker plus an offset in whole
 * metres; the published 7 dp is false precision that costs a third of the
 * transfer.
 */
export const BISON_FUTE_COORDINATE_DECIMALS = 5;

const COORDINATE_SCALE = 10 ** BISON_FUTE_COORDINATE_DECIMALS;

function roundCoordinate(value) {
  return Math.round(value * COORDINATE_SCALE) / COORDINATE_SCALE;
}

/**
 * DATEX II situation-record class → the category this app draws.
 *
 * The eight categories are a PRODUCT decision, not a transcription: DATEX II
 * publishes sixteen record classes here, which is more legend than any map can
 * carry, and several of them mean the same thing to someone looking at a globe.
 * The mapping below is deliberately lossy in one direction only — the original
 * class and subtype travel with every event, so a card never has to guess.
 *
 * `RoadOrCarriagewayOrLaneManagement` is the one class that cannot be resolved
 * on its class alone: `roadClosed` is a closure and `narrowLanes` is a
 * restriction, and calling both "gestion de voies" would hide the only thing on
 * this feed a driver must not miss. It is resolved on its subtype below.
 */
const EVENT_CATEGORY_BY_TYPE = Object.freeze({
  Accident: 'accident',
  AbnormalTraffic: 'bouchon',
  VehicleObstruction: 'obstacle',
  GeneralObstruction: 'obstacle',
  EnvironmentalObstruction: 'obstacle',
  InfrastructureDamageObstruction: 'obstacle',
  AnimalPresenceObstruction: 'obstacle',
  WeatherRelatedRoadConditions: 'intemperie',
  PoorEnvironmentConditions: 'intemperie',
  MaintenanceWorks: 'travaux',
  ConstructionWorks: 'travaux',
  ReroutingManagement: 'deviation',
  SpeedManagement: 'restriction',
  GeneralInstructionOrMessageToRoadUsers: 'restriction',
  GeneralNetworkManagement: 'restriction',
  RoadsideServiceDisruption: 'restriction',
  OperatorAction: 'restriction',
  NonWeatherRelatedRoadConditions: 'restriction',
  PublicEvent: 'restriction',
  TransitInformation: 'restriction',
});

/** Subtypes of `RoadOrCarriagewayOrLaneManagement` that close something. */
const CLOSURE_SUBTYPES = Object.freeze(new Set([
  'roadClosed',
  'carriagewayClosed',
  'closedPermanentlyForTheWinter',
  'closed',
]));

/**
 * The eight drawn categories, in the order a legend should read them: what has
 * happened, then what is being done about it.
 */
export const BISON_FUTE_EVENT_CATEGORIES = Object.freeze([
  'accident', 'bouchon', 'obstacle', 'intemperie',
  'fermeture', 'travaux', 'restriction', 'deviation',
]);

/**
 * Which record inside a situation is THE event.
 *
 * A situation is one incident and carries every record about it — the accident,
 * the two lanes it blocked, the four exits now closed. Drawing all 600 records
 * would draw one incident up to twelve times, so exactly one record per
 * situation is drawn and the rest are counted on its card. The winner is the
 * CAUSE, not the consequence: an accident outranks the lane closure it caused,
 * and a diversion never wins unless a situation is nothing but diversions.
 *
 * Lower sorts first.
 */
const CATEGORY_PRIMACY = Object.freeze({
  accident: 0,
  obstacle: 1,
  intemperie: 2,
  bouchon: 3,
  travaux: 4,
  fermeture: 5,
  restriction: 6,
  deviation: 7,
});

/** Type-specific subtype elements, by record class. */
const SUBTYPE_ELEMENTS = Object.freeze([
  'accidentType',
  'abnormalTrafficType',
  'vehicleObstructionType',
  'obstructionType',
  'environmentalObstructionType',
  'infrastructureDamageType',
  'animalPresenceType',
  'weatherRelatedRoadConditionType',
  'poorEnvironmentType',
  'roadMaintenanceType',
  'constructionWorkType',
  'reroutingManagementType',
  'roadOrCarriagewayOrLaneManagementType',
  'speedManagementType',
  'generalInstructionToRoadUsersType',
  'generalNetworkManagementType',
  'roadsideServiceDisruptionType',
  'operatorActionStatus',
  'nonWeatherRelatedRoadConditionType',
  'publicEventType',
]);

/**
 * Classify one situation record.
 * @param {string} type DATEX II record class (`xsi:type`, prefix stripped).
 * @param {string|null} subtype Type-specific enum value.
 * @returns {string} One of {@link BISON_FUTE_EVENT_CATEGORIES}.
 */
export function classifyEventRecord(type, subtype) {
  if (type === 'RoadOrCarriagewayOrLaneManagement') {
    return CLOSURE_SUBTYPES.has(String(subtype || '')) ? 'fermeture' : 'restriction';
  }
  return EVENT_CATEGORY_BY_TYPE[type] || 'restriction';
}

/**
 * Read the drawable geometry of one record.
 *
 * DATEX II offers three location systems here at once — TPEG coordinates, an
 * Alert-C table reference, and a PR marker plus an offset along a road. Only
 * the first is self-contained: Alert-C needs the 37,000-point table Bison Futé
 * supplies on request, and PR markers need the RRN bornage. So TPEG is what is
 * drawn, and the PR reference travels along as text because it is what a road
 * operator actually says on the phone.
 *
 * A `Linear` location publishes only its two ENDPOINTS — the shape of the road
 * between them is not in this feed — so a segment is drawn as the straight
 * chord between them. Measured on the 2026-08-31 snapshot: 409 segments, median
 * chord 1.77 km, p90 6.5 km, and only 21 longer than 10 km. At the median a
 * chord and the road are the same line at any altitude this is legible from;
 * the 3 chords past 30 km are the honest limit of the published location, and
 * the layer says so on the card rather than pretending to a route.
 *
 * @param {XmlElement} record
 * @returns {{kind:'point'|'segment', coordinates:number[]}|null}
 */
function readGeometry(record, traceCarriageway = null) {
  const group = child(record, 'groupOfLocations');
  if (!group) return null;

  const readPoint = (node) => {
    const coordinates = descend(node, 'pointCoordinates');
    if (!coordinates) return null;
    const lat = numberAt(coordinates, 'latitude');
    const lon = numberAt(coordinates, 'longitude');
    if (lat === null || lon === null) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return [roundCoordinate(lon), roundCoordinate(lat)];
  };

  const linear = child(group, 'tpegLinearLocation');
  if (linear) {
    const from = readPoint(child(linear, 'from'));
    const to = readPoint(child(linear, 'to'));
    if (from && to) {
      // Prefer the ROAD to the line between its ends, when the record says
      // enough to find it and the caller can. The tracer is injected rather
      // than imported: it needs a 3 MB national referential that belongs on
      // the server, and this module has to stay loadable without one.
      const reference = traceCarriageway ? readLinearReference(record) : null;
      if (reference) {
        const traced = traceCarriageway({ ...reference, chord: [...from, ...to] });
        if (Array.isArray(traced?.coordinates) && traced.coordinates.length >= 4) {
          return { kind: 'segment', shaped: 'carriageway', coordinates: traced.coordinates };
        }
      }
      return { kind: 'segment', coordinates: [...from, ...to] };
    }
    // A half-published segment is still a real location. Drawing its one known
    // end as a point beats dropping the event off the map entirely.
    const single = from || to;
    return single ? { kind: 'point', coordinates: single } : null;
  }

  const point = readPoint(descend(group, 'tpegPointLocation', 'point'));
  return point ? { kind: 'point', coordinates: point } : null;
}

/**
 * Read the TPEG descriptors attached to a location — the town it is near and
 * the road it is on, as the DIR itself names them.
 * @param {XmlElement} record
 * @returns {{road:string|null, town:string|null}}
 */
function readPlaceNames(record) {
  let road = null;
  let town = null;
  for (const name of findAll(child(record, 'groupOfLocations'), 'name')) {
    const kind = textAt(name, 'tpegOtherPointDescriptorType');
    const value = textAt(name, 'descriptor', 'values', 'value');
    if (!value) continue;
    if (kind === 'linkName' && !road) road = value;
    else if (kind === 'townName' && !town) town = value;
  }
  return { road, town };
}

/**
 * Collect the public comments a record carries, by comment type.
 *
 * `internalNote` is read and DROPPED. It is published in the open feed, but it
 * is the operator's note to their own colleagues — shift handovers, phone
 * numbers, "voir avec le district" — and republishing it on a public globe is
 * not what Licence Ouverte asks of a reuser.
 *
 * @param {XmlElement} record
 * @returns {{description:string|null, location:string|null}}
 */
function readComments(record) {
  let description = null;
  const locations = [];
  for (const comment of record.children) {
    if (comment.name !== 'generalPublicComment') continue;
    const kind = textAt(comment, 'commentType');
    const value = textAt(comment, 'comment', 'values', 'value');
    if (!value) continue;
    if (kind === 'description' && !description) description = value;
    else if (kind === 'locationDescriptor') locations.push(value);
  }
  return {
    description,
    // The DIRs publish two to six location descriptors per record: a plain-French
    // "situé 804 m au nord de X" and an internal service path
    // ("DIR Sud-Ouest/District Sud (Foix)/CEI L'Hospitalet"). The first is for a
    // reader; the rest are org chart. Keep the first.
    location: locations[0] || null,
  };
}

/**
 * Shorten the supplier string to the operator a reader recognises.
 * `Direction interdépartementale des routes/DIR Sud-Ouest` → `DIR Sud-Ouest`,
 * and `Gendarmerie/CORG` → `CORG`, both of which really do appear in the feed.
 * @param {string|null} raw
 * @returns {string|null}
 */
export function shortenOperator(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const tail = text.split('/').filter(Boolean).pop();
  return (tail || text).trim() || null;
}

/**
 * Resolve an event's temporal state.
 *
 * Three sources disagree often enough that the order matters. `lifeCycleManagement
 * /end` is the operator explicitly saying "this is over" and is believed first —
 * on the 2026-08-31 snapshot 22 records carried it, including an accident whose
 * validity window was still open. Then the published window. Only then, nothing.
 *
 * @param {object} input
 * @param {boolean} input.ended Operator-declared end.
 * @param {number|null} input.start Validity start, epoch ms.
 * @param {number|null} input.end Validity end, epoch ms.
 * @param {number} input.nowMs Reference instant.
 * @returns {'ended'|'planned'|'active'}
 */
export function resolveEventState({ ended, start, end, nowMs }) {
  if (ended) return 'ended';
  if (end !== null && end < nowMs) return 'ended';
  if (start !== null && start > nowMs) return 'planned';
  return 'active';
}

/**
 * Project the `Evenementiel-DIR` aggregate into the compact events document.
 *
 * @param {string} xml Raw DATEX II `SituationPublication`.
 * @param {object} [options]
 * @param {number} [options.nowMs] Reference instant for `state`. Injected so a
 *   test can pin "active" against a captured snapshot forever.
 * @returns {{publishedAt:string|null, publishedAtMs:number|null,
 *   supplier:string|null, events:object[], counts:object}}
 */
export function projectRoadEvents(xml, { nowMs = Date.now(), traceCarriageway = null } = {}) {
  const root = parseXml(xml);
  const publication = findAll(root, 'payloadPublication')[0] || root;
  const publishedAt = textAt(publication, 'publicationTime');
  const supplier = textAt(descend(publication, 'publicationCreator'), 'nationalIdentifier');

  const events = [];
  const counts = {
    situations: 0, records: 0, undrawable: 0, points: 0, segments: 0,
    active: 0, planned: 0, ended: 0, safety: 0,
    // How many segments were drawn on the road rather than as a chord. Counted
    // so the layer can say which it is showing instead of implying all of them.
    shaped: 0,
  };

  for (const situation of findAll(publication, 'situation')) {
    counts.situations += 1;
    const situationId = String(situation.attrs.id || '').trim();
    if (!situationId) continue;

    /** @type {Array<{record:XmlElement, category:string, type:string, subtype:string|null}>} */
    const classified = [];
    for (const record of situation.children) {
      if (record.name !== 'situationRecord') continue;
      counts.records += 1;
      const type = localName(String(record.attrs.type || '').trim());
      let subtype = null;
      for (const element of SUBTYPE_ELEMENTS) {
        subtype = textAt(record, element);
        if (subtype) break;
      }
      classified.push({ record, type, subtype, category: classifyEventRecord(type, subtype) });
    }
    if (!classified.length) continue;

    const ordered = classified.slice().sort((a, b) => (
      (CATEGORY_PRIMACY[a.category] ?? 99) - (CATEGORY_PRIMACY[b.category] ?? 99)
    ));
    const primary = ordered[0];
    const geometry = readGeometry(primary.record, traceCarriageway)
      // The winning record is the one whose MEANING is the event; if its own
      // location failed to parse, any sibling's location still puts the incident
      // on the right kilometre of the right road.
      || ordered.map((entry) => readGeometry(entry.record, traceCarriageway)).find(Boolean)
      || null;
    if (!geometry) { counts.undrawable += 1; continue; }

    const { record, category, type, subtype } = primary;
    const validity = descend(record, 'validity', 'validityTimeSpecification');
    const start = parseTimestampMs(textAt(validity, 'overallStartTime'));
    const end = parseTimestampMs(textAt(validity, 'overallEndTime'));
    const ended = textAt(descend(record, 'management', 'lifeCycleManagement'), 'end') === 'true';
    const state = resolveEventState({ ended, start, end, nowMs });
    const safety = textAt(
      descend(record, 'situationRecordExtension', 'situationRecordExtendedApproved'),
      'safetyRelatedMessage',
    ) === 'true';

    const { road, town } = readPlaceNames(record);
    const { description, location } = readComments(record);
    const impact = child(record, 'impact');
    const restricted = numberAt(impact, 'numberOfLanesRestricted');
    const total = numberAt(impact, 'originalNumberOfLanes');

    counts[state] += 1;
    if (safety) counts.safety += 1;
    if (geometry.kind === 'segment') counts.segments += 1; else counts.points += 1;
    if (geometry.shaped === 'carriageway') counts.shaped += 1;

    events.push({
      id: situationId,
      version: Number(situation.attrs.version) || null,
      category,
      type,
      subtype,
      severity: textAt(situation, 'overallSeverity'),
      state,
      safety,
      start,
      end,
      updated: parseTimestampMs(textAt(situation, 'situationVersionTime')),
      // `certain` / `probable` / `riskOf`. A forecast roadworks order is
      // `probable`, and a card that showed it as fact would be lying about a
      // thing that has not happened yet.
      probability: textAt(record, 'probabilityOfOccurrence'),
      operator: shortenOperator(textAt(descend(record, 'source'), 'sourceIdentification')),
      road,
      town,
      description,
      location,
      direction: textAt(descend(record, 'groupOfLocations', 'tpegPointLocation'), 'tpegDirection')
        || textAt(descend(record, 'groupOfLocations', 'tpegLinearLocation'), 'tpegDirection'),
      // The PR marker the operator would say on the phone ("31PR24U + 530 m").
      marker: readMarker(record),
      lanes: restricted !== null || total !== null
        ? { restricted, total }
        : null,
      geometry: {
        kind: geometry.kind,
        // 'carriageway' when this is the surveyed road, absent when it is the
        // chord between the two published ends. The card says which.
        ...(geometry.shaped ? { shaped: geometry.shaped } : {}),
        coordinates: geometry.coordinates,
      },
      // What else this situation declares, as a tally by category. The
      // consequences are not drawn, but "+ 5 déviations" is the difference
      // between a closed road and a closed road somebody has already routed
      // around, and one situation really does carry five of them.
      also: tallyCategories(ordered.slice(1)),
    });
  }

  // Newest first, then by id, so a truncating client keeps the fresh half of the
  // feed and two identical snapshots always serialize identically.
  events.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0) || a.id.localeCompare(b.id));

  return {
    publishedAt,
    publishedAtMs: parseTimestampMs(publishedAt),
    supplier,
    events,
    counts,
  };
}

/**
 * Tally the categories of a situation's non-primary records.
 * @param {Array<{category:string}>} entries
 * @returns {Record<string, number>}
 */
function tallyCategories(entries) {
  const tally = {};
  for (const entry of entries) tally[entry.category] = (tally[entry.category] || 0) + 1;
  return tally;
}

/**
 * Read a record's LINEAR REFERENCE — the route and the two point-repère
 * addresses that bound the event along it.
 *
 * This is the half of a DATEX location the layer used to throw away. Every
 * `Linear` event publishes its extent twice: as two TPEG coordinates (the two
 * ENDS, and nothing between them, which is why a segment was drawn as a
 * chord), and as an address on a named road:
 *
 *     <linearElement><roadNumber>N0126</roadNumber></linearElement>
 *     <fromPoint>  81PR47U + 394 m
 *     <toPoint>    81PR5U  +   0 m
 *
 * The second is a real linear reference and it is what lets a 37 km chord
 * across open country become 40 km of the road it is actually on. Read here,
 * used by `readGeometry` when the caller supplies a tracer, and reported
 * verbatim to nobody: `readMarker` below still owns the human-facing string.
 *
 * @param {XmlElement} record
 * @returns {{roadNumber:string, from:object, to:object}|null}
 */
export function readLinearReference(record) {
  const lwle = descend(child(record, 'groupOfLocations'), 'linearWithinLinearElement');
  if (!lwle) return null;
  const roadNumber = textAt(descend(lwle, 'linearElement'), 'roadNumber');
  if (!roadNumber) return null;
  const address = (node) => {
    if (!node) return null;
    const referent = textAt(descend(node, 'fromReferent'), 'referentIdentifier');
    if (!referent) return null;
    const along = numberAt(node, 'distanceAlong');
    return { referent, distanceAlong: Number.isFinite(along) ? along : 0 };
  };
  const from = address(child(lwle, 'fromPoint'));
  const to = address(child(lwle, 'toPoint'));
  // BOTH ends or nothing: a single PR address bounds no stretch, and guessing
  // the other end from the chord would reintroduce the error being fixed.
  if (!from || !to) return null;
  return { roadNumber, from, to };
}

/**
 * Read the PR (point repère) reference of a record, as text.
 * @param {XmlElement} record
 * @returns {string|null}
 */
function readMarker(record) {
  const group = child(record, 'groupOfLocations');
  const from = descend(group, 'linearWithinLinearElement', 'fromPoint')
    || descend(group, 'pointAlongLinearElement', 'distanceAlongLinearElement');
  const referent = textAt(descend(from, 'fromReferent'), 'referentIdentifier');
  if (!referent) return null;
  const along = numberAt(from, 'distanceAlong');
  return along ? `${referent} + ${Math.round(along)} m` : referent;
}
