import * as Cesium from 'cesium';
import { createAddressScanLayer } from './addressScanLayer.js';
import {
  BRUIT_AREA_SCALE_DENOMINATOR,
  BRUIT_INDEX_LABELS,
  BRUIT_INDEX_SENTENCES,
  BRUIT_PROBE_SCALE_DENOMINATOR,
  BRUIT_SOURCE,
  PEB_ZONE_LABELS,
  PEB_ZONE_ORDER,
  PGS_ZONE_LABELS,
  PGS_ZONE_ORDER,
  bandText,
} from './bruitFeed.js';
import { pointInPolygons } from './ringGeometry.js';
import { ZONE_FILL_MAX_ALPHA } from './urbanismeGpu.js';

/**
 * @module data/bruitFrance
 *
 * The aircraft-noise plans of France, drawn — and the one decision this layer
 * exists to make out loud: WHICH of the zones the service returns is the answer.
 *
 * ── WHAT THIS ADDS OVER `urbanismeGpu` ──────────────────────────────────────
 * The Géoportail de l'urbanisme already reaches the plan d'exposition au bruit.
 * `DATA_SOURCES.md` says so, and it arrives there as a servitude: a code, an
 * assiette outline and a PDF link, drawn as a dashed line at the address, with
 * NO zone letter, NO threshold and NO unit. Over the same ground at Roissy that
 * layer's whole answer is "servitude aéronautique". This layer's answer is
 * "zone C, Lden 56 – 65 dB(A), arrêté du 03/04/2007, LFPG — DSAC NORD". The
 * difference is the number, and the number is the reason anyone looks.
 *
 * ── THE DEFECT THIS LAYER WAS BUILT TO AVOID: `features[0]` ─────────────────
 * A WMS GetFeatureInfo is not a point-in-polygon test. GeoServer answers with
 * every feature within a buffer of the queried PIXEL, and the aircraft-noise
 * plans genuinely overlap. Measured on 2026-09-02, one probe at each of the 224
 * aerodromes in the arrêté register, at the scale `bruitFeed.js` pins:
 *
 *   features returned per probe   0 → 9   1 → 141   2 → 67   3 → 5   4 → 2
 *
 * So **74 of the 215 probes that answer at all — 34% — return more than one
 * polygon for one pixel**, and taking `features[0]` would be a coin toss on a
 * third of France. Three DISTINCT reasons sit behind that number, and they need
 * three different answers, not one:
 *
 *  1. THE SAME BAND, PUBLISHED TWICE. Measured at LFPZ, LFPV, LFXU and LFGQ:
 *     one zone comes back as two features with two `id_map` values, and at LFPZ
 *     the two copies even disagree about `producteur` (`DSAC N` against `ADP`)
 *     and `date_maj` (`null` against `2017-05-23Z`). `bruitFeed.js` merges them
 *     on the band's identity and counts the pieces. Nothing here has to know.
 *
 *  2. A BAND THE BUFFER FOUND, THAT THE POINT IS NOT IN. Measured at Les
 *     Mureaux (LFXU): 4 features come back, and the two zone-A polygons are
 *     BESIDE the probe, not under it. `bruitFeed.js` re-tests every ring, holes
 *     included, and flags `atPoint`. Those bands are drawn — "the louder zone
 *     starts thirty metres away" is worth seeing — but they are DASHED, drawn
 *     at the faintest wash, and can never be the answer.
 *
 *  3. TWO BANDS THAT REALLY DO BOTH COVER THE POINT. This is the one that needs
 *     a rule. Measured by probing each airport's whole plan and re-testing it on
 *     a 120 × 120 grid of its own bbox:
 *       · LFPZ (Saint-Cyr) — zones **A and B overlap**; at 48.80989, 2.07921
 *         all four returned polygons contain the point (A id 649, A id 652,
 *         B id 650, B id 653) and zone B has no hole cut where zone A sits.
 *       · LFMD (Cannes-Mandelieu) — zones **B and C overlap** at 43.53184,
 *         6.95601.
 *       · LFPB (Le Bourget) — **two different airports**: Le Bourget's own
 *         zone A and Roissy's zone D, two arrêtés twelve years apart.
 *
 * ── THE RULE, AND WHY IT IS THE STRICTEST ZONE ──────────────────────────────
 * {@link chooseBruitAnswer} ranks the eligible bands and the card NAMES the
 * clause that separated the winner from the runner-up. In order:
 *
 *   1. `atPoint` — a band the point is not inside is not a candidate at all.
 *   2. THE MOST EXPOSED ZONE WINS. A/B/C/D on the PEB, I/II/III on the PGS.
 *      This is not a tie-break dressed up as a rule: the PEB's restrictions are
 *      cumulative-strictest, so on ground covered by both A and B it is zone A
 *      that forbids housing. Answering "zone B" at Saint-Cyr because it came
 *      back first would understate the rule that actually applies there. The
 *      letters are also the ONE part of the document that is identical at every
 *      airport and under both indices, so ranking them compares like with like
 *      even where the thresholds do not.
 *   3. Tie on the letter → the NEWEST effective arrêté, because a revised plan
 *      supersedes the one it replaced. Never observed in the 224-airport sweep;
 *      written down because the day it happens the alternative is arbitrary.
 *   4. Still tied → the OACI code, alphabetically, then the feature id. Two
 *      clauses that decide nothing about physics and everything about
 *      determinism: the same ground must not answer differently because
 *      GeoServer shuffled its response.
 *
 * Everything the rule did NOT pick is still on the card. `{n} zones sous le
 * repère`, the runner-up spelled out with its own band, and the count of the
 * ones the buffer found beside the point. A layer that picks silently is a
 * layer that is wrong 34% of the time without saying so.
 *
 * ── THE UNIT IS NEVER GUESSED, AND THAT WORK IS ALREADY DONE ────────────────
 * `indldenext`/`indldenint` mix two incompatible scales — the *indice
 * psophique* abandoned in 2002 and Lden dB(A) — with nothing in the row to tell
 * them apart. Measured over the 298 zone rows the 224 probes returned:
 * 75 rows carry psophique values (78 … 96) and 223 carry Lden (50 … 70).
 * `bruitFeed.js` chooses from the LATER of `date_arret` and the date inside the
 * arrêté PDF, and suppresses the unit rather than guessing when the two
 * disagree. This module's contribution is narrower and just as load-bearing:
 * **it never renders a bare number.** Every threshold on screen arrives through
 * {@link bandText}, which returns null when the index is unsettled, and the
 * band then prints as "seuils 84 – 89 — indice non déterminé". A number with no
 * unit beside it is read as decibels by everyone.
 *
 * ── WHAT IS NOT DRAWN, AND WILL NOT BE ──────────────────────────────────────
 * THERE IS NO STRATEGIC NOISE MAP HERE. The EU directive's CBS isophones — the
 * thing most people mean by "the noise map" — are not on the Géoplateforme at
 * all: grepping all three capabilities documents for bruit/noise/classement
 * returns these four DGAC aviation layers and nothing else. They exist as ~76
 * per-DDT Géo-IDE ATOM shapefile zips, EPSG:2154, ISO-8859-1, no CORS header,
 * and one of them (Tarn) is MapInfo TAB with no shapefile inside at all. That
 * is a server-side harvest of several hundred archives, and it is deferred, not
 * forgotten. ROAD AND RAIL NOISE ARE THEREFORE ABSENT FROM THIS LAYER, and the
 * card says "avions seulement" rather than letting a reader infer that the
 * quiet ground beside a motorway is quiet.
 *
 * ── TWO MODES, BECAUSE A DEZOOMED CAMERA ASKS A DIFFERENT QUESTION ──────────
 * A PEB is a set of NESTED RINGS and a point probe returns the one the pixel
 * is in — normally zone A, at the aerodrome — because GetFeatureInfo answers
 * within a few pixels of the coordinate. That is the right answer to "what
 * applies to this address" and the wrong answer to "show me the noise around
 * this airport": zones B, C and D are donuts the point is not inside, so from
 * a dezoomed camera the layer drew one band out of four and then, above 12 km,
 * nothing at all. The plans themselves are up to 65.8 km across; the ceiling
 * was under a fifth of that, so the shape could never be on screen whole.
 *
 * So above {@link ADDRESS_SCAN_CEILING_M} the layer switches question:
 *
 *   POINT MODE, below 12 km — unchanged. One probe at the camera's coordinate,
 *     pinned at 1:{@link BRUIT_PROBE_SCALE_DENOMINATOR}, `atPoint` re-tested,
 *     the winner rule, the runner-up, the dashes, the marker. Everything the
 *     rest of this header is about.
 *   OVERVIEW MODE, 12 km to {@link BRUIT_OVERVIEW_CEILING_M} — one probe per
 *     AERODROME in view, at its own published reference point, at
 *     1:{@link BRUIT_AREA_SCALE_DENOMINATOR}, whose buffer is wide enough that
 *     the whole plan comes back. No marker, so no winner, no runner-up and no
 *     dashes: `atPoint` is false on every band because nothing was tested
 *     against a point, and drawing that as "you are not standing in it" would
 *     be an answer to a question nobody asked.
 *
 * ── DRAWN AT A STATED GENERALISATION, AND IT IS NOT THE SAME ONE ────────────
 * The outline the service returns is generalised to the requested rendering
 * scale — 1:39,757 for a point probe, 1:3,975,696 for an overview, a hundred
 * times coarser. The overview is therefore WIDER, not finer: it is the whole
 * plan at the detail a shape being read from a hundred kilometres up needs, and
 * descending under 12 km re-reads the band underfoot at the fine scale. The
 * card prints whichever denominator the payload actually carries, never a
 * constant, so the two can never be confused. Nothing drawn here is a surveyed
 * limit; the arrêté PDF on the card is the document that is.
 *
 * ── WHY IT SITS ON `createAddressScanLayer` ─────────────────────────────────
 * The upstream takes a coordinate, not a bounding box, exactly like the four
 * layers already on that shell. Reusing it buys the look-at derivation, the
 * altitude gate, the 450 ms camera settle, the single-flight scan, the terrain
 * seating and the click-to-card index — about eight hundred lines this layer
 * would otherwise own a second copy of. What is added on top is the row legend
 * and the zoom guidance the shell does not have.
 *
 * THE OVERVIEW NEEDED NO CHANGE TO THAT SHELL, and that is not a coincidence.
 * The shell already refetches whenever the QUERY changes rather than only when
 * the centre moves — written for the urbanism layer, which asks for a box close
 * in and a point higher up — so a mode that adds one `km=` parameter above an
 * altitude switches itself, and the proxy reads that parameter to decide which
 * of the two questions it is being asked.
 */

/** Layer id — matches LAYER_STATE_REGISTRY, LAYER_TAXONOMY and the proxy route. */
export const BRUIT_FR_LAYER_ID = 'bruit-fr';

/** Overlay source id. The shell keys its single selected card on the layer id. */
export const BRUIT_FR_OVERLAY_SOURCE_ID = BRUIT_FR_LAYER_ID;

/** Proxy route. */
export const BRUIT_FR_ENDPOINT = '/api/bruit-fr';

/**
 * Manager tick, 15 minutes.
 *
 * NOT because the register moves — measured from the 224 arrêté filenames, it
 * gained 8 documents in the whole of the 2020s and 3 in 2022 — but because a
 * scan that failed must eventually retry without the camera moving. The camera
 * settle drives every scan a reader actually notices. Same value as the four
 * sibling address layers, for the same reason.
 */
const UPDATE_INTERVAL_MS = 900_000;

/**
 * The PEB ramp: how much noise the ground under it is exposed to.
 *
 * Warm-to-cool by SEVERITY, not by threshold value, because the threshold is
 * not comparable across the two indices — 96 is the top of the psophique scale
 * and 70 is the top of Lden, and a ramp keyed on the number would paint Cannes
 * darker than Roissy for being older. The letter is the comparable channel.
 *
 * Zone D is deliberately COOL and not a fourth warm step. It carries no
 * building restriction at all — it is the information-and-soundproofing zone —
 * and a fourth shade of amber would say it was the quiet end of the same rule
 * rather than a different kind of statement.
 *
 * Checked against the neighbours this layer will be stacked on. `urbanismeGpu`
 * spends orange on `U`, magenta on `AUc`, green on `A` and teal on `N`, and red
 * on its servitude dashes; `georisques` owns the hazard triangle. The crimson
 * here is darker and more saturated than the servitude red, and the pale blue
 * of zone D appears in neither palette.
 */
export const PEB_ZONE_COLORS = Object.freeze({
  A: '#ff2d55', // gêne très forte — habitation interdite
  B: '#ff7a1f', // gêne forte
  C: '#ffcc33', // gêne modérée
  D: '#9fd0ff', // information — pas de restriction de construire
});

/**
 * The PGS ramp: a violet family, and deliberately no colour in common with the
 * PEB.
 *
 * The two plans are drawn over the same aerodromes and they are NOT the same
 * document. The PEB says what may be built; the PGS says whose windows the
 * *taxe sur les nuisances sonores aériennes* pays to replace. Sharing a ramp
 * would say they were two grades of one thing. Measured, the overlap is real
 * and small: 11 of the 224 aerodromes answer a PGS probe at their own published
 * point, against 215 for the PEB.
 */
export const PGS_ZONE_COLORS = Object.freeze({
  1: '#e05bff', // zone I — aide au taux le plus élevé
  2: '#b06bf0', // zone II
  3: '#7d6fe0', // zone III
});

/** A zone letter this grammar does not know. Neutral, and never ranked first. */
export const BRUIT_UNKNOWN_ZONE_COLOR = '#c9d4e0';

/**
 * How heavily each wash sits on the ground — BORROWED, NOT RE-MEASURED, and
 * that is stated because it decides what a reader sees.
 *
 * `urbanismeGpu.js` derived its ladder by repainting one polygon at five alphas
 * over the operator's own basemap and differencing the frames: 0.18 invisible,
 * 0.22 the floor, 0.28 readable, 0.33 clear, 0.40 strong, 0.45 the ceiling past
 * which the wash replaces the photograph. That measurement is of the app's
 * alpha attenuation and colour grading, not of the layer that made it, so it
 * transfers; it was not re-run here and this comment is the only honest way to
 * say so. {@link ZONE_FILL_MAX_ALPHA} is imported from that module rather than
 * copied, so its ceiling and this layer's cannot drift apart.
 *
 *   winner  0.42  the band the rule chose — the answer
 *   inside  0.30  another band that also contains the point
 *   nearby  0.22  a band the buffer returned beside the point, dashed as well
 */
export const BRUIT_FILL_ALPHA = Object.freeze({
  winner: 0.42,
  inside: 0.30,
  nearby: 0.22,
});

/** The stroke on the boundary itself, over its own wash. */
const BRUIT_OUTLINE_ALPHA = 0.95;

/**
 * 3 px for a band under the marker, 2 px for one merely beside it.
 *
 * The same reasoning `urbanismeGpu.js` records: width is the only pick
 * tolerance a Cesium polyline has, and a clamped hairline over an orthophoto is
 * both hard to see and hard to hit. The thinner stroke on a nearby band is the
 * second channel — with the dash — saying it is context and not an answer.
 */
export const BRUIT_OUTLINE_WIDTH_PX = Object.freeze({ inside: 3, nearby: 2 });

/** Dash period in pixels, for the bands the point is NOT in. */
const BRUIT_DASH_LENGTH_PX = 18;

/**
 * Narrowest band that gets its letter written on the ground, in degrees.
 *
 * Measured over all 293 bands the 224 probes returned, the narrowest label
 * anchor is **0.000451°** and the median is 0.005288°, so this gate has never
 * fired on real data — every band in the register is wide enough to carry four
 * characters. It stays because the register is not a promise: a band published
 * as a sliver would otherwise get its letter written across a shape a few
 * metres wide, and 0.0004° is about 30 m of longitude at 45°N.
 */
export const BRUIT_LABEL_MIN_WIDTH_DEG = 0.0004;

/**
 * Which clause of {@link chooseBruitAnswer} actually separated the winner from
 * the runner-up, in the words that go on the card.
 *
 * Not a debug string. The whole failure this layer exists to avoid is a silent
 * pick, and a reader who sees two zones painted under one marker is owed the
 * reason one of them is the headline.
 */
export const BRUIT_WINNER_RULES = Object.freeze({
  only: 'seule zone sous le repère',
  zone: 'la plus exposée des zones sous le repère',
  arrete: 'même zone, arrêté le plus récent',
  oaci: 'même zone et même date : code OACI par ordre alphabétique',
  id: 'départage stable sur l’identifiant du registre',
});

/** Colour a band by its plan and its zone letter. */
export function bruitZoneColorCss(kind, zone) {
  const table = kind === 'pgs' ? PGS_ZONE_COLORS : PEB_ZONE_COLORS;
  // Object.hasOwn and not `table[zone] || fallback`: `zone` arrives as a string
  // or as null, and a lookup that falls through on a falsy VALUE would be a
  // different bug the day a colour is ever the empty string.
  const key = typeof zone === 'string' ? zone.trim().toUpperCase() : '';
  return Object.hasOwn(table, key) ? table[key] : BRUIT_UNKNOWN_ZONE_COLOR;
}

/**
 * Severity rank of a zone within its own plan — LOWER IS MORE EXPOSED.
 *
 * A zone the register spells in a way this grammar does not know ranks LAST,
 * never first. That is deliberate and it is the coercion trap in miniature:
 * `PEB_ZONE_ORDER.indexOf(null)` is -1, and -1 sorts ahead of zone A, so an
 * unlabelled polygon would become the answer at every airport that published
 * one.
 */
export function bruitZoneRank(kind, zone) {
  const order = kind === 'pgs' ? PGS_ZONE_ORDER : PEB_ZONE_ORDER;
  const key = typeof zone === 'string' ? zone.trim().toUpperCase() : '';
  const index = order.indexOf(key);
  return index === -1 ? order.length : index;
}

/** What each zone means for the ground under it, or null for an unknown letter. */
export function bruitZoneSentence(kind, zone) {
  const table = kind === 'pgs' ? PGS_ZONE_LABELS : PEB_ZONE_LABELS;
  const key = typeof zone === 'string' ? zone.trim().toUpperCase() : '';
  return Object.hasOwn(table, key) ? table[key] : null;
}

/**
 * Which wash a band gets: the answer, another band under the marker, or context.
 * @param {object} band
 * @param {?object} winner The band {@link chooseBruitAnswer} chose.
 * @returns {'winner'|'inside'|'nearby'}
 */
export function bruitEmphasis(band, winner) {
  if (band?.atPoint !== true) return 'nearby';
  return winner && band.id === winner.id ? 'winner' : 'inside';
}

/**
 * Which wash an OVERVIEW band gets — and there is no 'nearby' here.
 *
 * The point-mode ladder has three rungs because a probe answers about a marker:
 * the band the rule chose, another band under it, and a band the buffer found
 * beside it. An overview has no marker, so the third rung has nothing to mean
 * and the dash — which says "you are not standing in this one" — would be a
 * claim about a reader who is not standing anywhere.
 *
 * What is left is the one distinction the plan itself makes: the most exposed
 * band of each aerodrome, and the rest. That is `top` from `foldAerodromes`,
 * which is a fact about the document rather than a verdict about ground.
 *
 * @param {object} band
 * @param {?object} aerodrome The folded entry this band belongs to.
 * @returns {'winner'|'inside'}
 */
export function bruitAreaEmphasis(band, aerodrome) {
  return aerodrome?.top && band?.id === aerodrome.top.id ? 'winner' : 'inside';
}

/**
 * Rank two eligible bands. Exported so the ordering itself can be tested
 * without going through the whole selection.
 *
 * @param {'peb'|'pgs'} kind
 * @returns {(a: object, b: object) => number}
 */
export function bruitBandComparator(kind) {
  return (a, b) => (
    bruitZoneRank(kind, a?.zone) - bruitZoneRank(kind, b?.zone)
    // Newest effective arrêté first. Dates are `YYYY-MM-DD` strings, which sort
    // correctly as strings; a band with no date at all sorts last rather than
    // winning on an empty string comparing low.
    || String(b?.effectiveDate ?? '').localeCompare(String(a?.effectiveDate ?? ''))
    || String(a?.oaci ?? '￿').localeCompare(String(b?.oaci ?? '￿'))
    || String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
  );
}

/**
 * Pick ONE band as the answer for a plan, and say which clause decided it.
 *
 * See the module header for why the strictest zone wins and why every clause
 * below it exists. Nothing is discarded: `inside` is the other bands the point
 * is genuinely in, `nearby` is what the buffer found beside it.
 *
 * @param {Array<object>} bands Output of `projectBruitZones` for one plan.
 * @param {'peb'|'pgs'} kind
 * @returns {{winner: ?object, inside: Array<object>, nearby: Array<object>,
 *   rule: ?string, ruleLabel: ?string, eligible: number, overlapping: boolean}}
 */
export function chooseBruitAnswer(bands, kind = 'peb') {
  const rows = Array.isArray(bands) ? bands : [];
  const eligible = rows.filter((band) => band?.atPoint === true);
  const nearby = rows.filter((band) => band?.atPoint !== true);
  if (!eligible.length) {
    return {
      winner: null, inside: [], nearby, rule: null, ruleLabel: null,
      eligible: 0, overlapping: false,
    };
  }
  const ranked = [...eligible].sort(bruitBandComparator(kind));
  const [winner, runnerUp] = ranked;
  let rule = 'only';
  if (runnerUp) {
    if (bruitZoneRank(kind, winner.zone) !== bruitZoneRank(kind, runnerUp.zone)) rule = 'zone';
    else if (String(winner.effectiveDate ?? '') !== String(runnerUp.effectiveDate ?? '')) rule = 'arrete';
    else if (String(winner.oaci ?? '') !== String(runnerUp.oaci ?? '')) rule = 'oaci';
    else rule = 'id';
  }
  return {
    winner,
    inside: ranked.slice(1),
    nearby,
    rule,
    ruleLabel: BRUIT_WINNER_RULES[rule],
    eligible: eligible.length,
    // Two bands of ONE airport over one point: the register's own rings
    // overlapping, measured at LFPZ (A over B) and LFMD (B over C). Reported
    // apart from "two airports here", which is a different fact.
    overlapping: ranked.slice(1).some((band) => band.oaci === winner.oaci),
  };
}

/**
 * One band, in one line: its letter and its thresholds in the unit they are
 * actually in.
 *
 * `bandText` returns null when there are no thresholds at all and prints
 * "seuils … — indice non déterminé" when the index could not be settled. Both
 * are passed through unchanged. Nothing in this module formats a threshold by
 * hand, which is what keeps a bare number off the globe.
 */
export function bruitBandLabel(band) {
  const zone = typeof band?.zone === 'string' && band.zone.trim() ? band.zone.trim() : '?';
  // The PGS is named on its own bands, not only in the sentence that
  // introduces them: a card that says "zone 3" beside a card that says "zone C"
  // invites reading the two documents as one scale.
  const prefix = band?.kind === 'pgs' ? `PGS zone ${zone}` : `zone ${zone}`;
  const text = bandText(band);
  return text ? `${prefix} — ${text}` : prefix;
}

/** A register date as the day a French reader writes it. */
export function bruitDayText(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/**
 * The card for ONE band — shared by its wash, every one of its rings, and the
 * letter written on it, because they are the same band and must not tell a
 * reader three different things.
 */
export function bruitBandDescription(band, answer = null, { area = false } = {}) {
  const isWinner = Boolean(answer?.winner && answer.winner.id === band?.id);
  const arrete = bruitDayText(band?.effectiveDate);
  return [
    bandText(band),
    bruitZoneSentence(band?.kind, band?.zone),
    BRUIT_INDEX_SENTENCES[band?.index ?? 'unknown'],
    // `atPoint` is false on EVERY overview band, because nothing was tested
    // against a point. Printing the point-mode sentence there would invent a
    // marker the reader does not have and then tell them they are outside it.
    area || band?.atPoint === true ? null : 'zone voisine — le repère n’est pas dedans',
    isWinner && answer?.ruleLabel ? `retenue : ${answer.ruleLabel}` : null,
    arrete ? `arrêté du ${arrete}` : null,
    // The register keeping a 1985 date on a plan reissued in Lden. Said on the
    // band because it is the field a reader would check, and because it is what
    // moved this band's unit.
    band?.revisedDocument && bruitDayText(band?.arreteDate)
      ? `le registre affiche encore ${bruitDayText(band.arreteDate)} — date reprise du document`
      : null,
    band?.inverted ? 'seuils publiés à l’envers dans le registre, remis dans l’ordre' : null,
    band?.pieces > 1 ? `publiée en ${band.pieces} polygones, fusionnés` : null,
    band?.holes
      ? `${band.holes} découpe${band.holes > 1 ? 's' : ''} — la zone plus exposée commence là`
      : null,
    band?.oaci ? `${band.oaci}${band.airport ? ` — ${band.airport}` : ''}` : null,
    band?.producer ? `producteur ${band.producer}` : null,
    band?.documentUrl ? `arrêté : ${band.documentUrl}` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * Below this, the "nearest aerodrome" is the one under the marker.
 *
 * 0.5 km. The register publishes an aerodrome REFERENCE POINT, not a site
 * outline, and `nearestArrete` already rounds its distance to 0.1 km — so
 * anything under half a kilometre is "here" at the resolution the register
 * itself has, and printing "à 0 km" would spend a sentence saying nothing.
 */
export const BRUIT_ARRETE_UNDER_MARKER_KM = 0.5;

/**
 * The nearest aerodrome that HAS a plan, as the sentence that replaces a blank
 * answer.
 *
 * The coordinate behind the distance is the arrêté register's own published
 * point — never a commune centroid, never a guess. Null when nothing is within
 * the register module's reach, because "the nearest PEB is 300 km away" says
 * nothing about the ground under the camera.
 */
export function bruitNearestSentence(nearest) {
  if (!nearest || !Number.isFinite(nearest.distanceKm)) return null;
  const name = [nearest.oaci, nearest.name].filter(Boolean).join(' — ');
  const day = bruitDayText(nearest.arreteDate);
  const arrete = day ? `, arrêté du ${day}` : '';
  // STANDING ON IT, and the service still returned nothing. That is the most
  // informative empty answer this layer can give, and "à 0 km" would be the
  // least: measured, 9 of the 224 aerodromes answer an empty FeatureCollection
  // at their own published reference point, and three of them — LFPN, LFPK,
  // LFPT — answer nothing at any scale. The arrêté exists; the polygon does
  // not, or does not reach this point.
  if (nearest.distanceKm <= BRUIT_ARRETE_UNDER_MARKER_KM) {
    return `le repère est sur l’aérodrome ${name || 'sans nom'}${arrete} — `
      + 'le service ne renvoie aucun polygone ici';
  }
  const km = nearest.distanceKm.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return `aérodrome le plus proche avec un PEB : ${name || 'sans nom'}, à ${km} km${arrete}`;
}

/**
 * The headline over the scan marker.
 *
 * Four states, and the difference between the last two is the whole of this
 * layer's honesty: an empty FeatureCollection and a service that did not answer
 * are the same 0 features downstream, and only `available` tells them apart.
 */
export function bruitMarkerTitle(payload, peb, pgs) {
  if (payload?.available?.peb === false && payload?.available?.pgs === false) {
    return 'Plans de bruit — service sans réponse';
  }
  const winner = peb?.winner || pgs?.winner;
  if (winner) {
    const zone = typeof winner.zone === 'string' && winner.zone.trim() ? winner.zone.trim() : '?';
    const who = [winner.oaci, winner.airport].filter(Boolean).join(' — ');
    return `Zone ${zone}${who ? ` · ${who}` : ''}`;
  }
  return 'Aucun plan de bruit aérien sur ce point';
}

/**
 * Everything the marker says, in the order a reader needs it.
 *
 * The first line is the answer. The lines that follow are, in order: what the
 * rule rejected, what the register contradicted itself about, what is NOT in
 * this layer at all, and how the shapes on screen were made. A reader who stops
 * after the first line is not misled; a reader who reads to the end knows
 * exactly how much of France this covers.
 */
export function bruitScanDescription(payload, peb, pgs) {
  const winner = peb?.winner || null;
  const lines = [];
  // The PEB outage leads, because it is the line that stops a blank answer from
  // being read as "nothing here". The PGS outage does not: it would push the
  // answer the reader came for down one line to report a secondary document.
  if (payload?.available?.peb === false) {
    lines.push('le service PEB n’a pas répondu — ce n’est pas « aucune zone ici »');
  }
  if (winner) {
    lines.push(bandText(winner));
    lines.push(bruitZoneSentence('peb', winner.zone));
    lines.push(BRUIT_INDEX_SENTENCES[winner.index ?? 'unknown']);
    const day = bruitDayText(winner.effectiveDate);
    if (day) lines.push(`arrêté du ${day}${winner.revisedDocument ? ' (date reprise du document, le registre affiche l’ancienne)' : ''}`);
  } else if (payload?.available?.peb !== false) {
    lines.push('aucun plan d’exposition au bruit ne couvre ce point');
    lines.push(bruitNearestSentence(payload?.nearest));
  }
  // THE LINE THIS LAYER EXISTS FOR. Never omitted when there was a choice.
  if (peb?.eligible > 1) {
    lines.push(`${peb.eligible} zones sous le repère — retenue : ${peb.ruleLabel}`);
    const runnerUp = peb.inside[0];
    if (runnerUp) lines.push(`aussi sous le repère : ${bruitBandLabel(runnerUp)}`);
  }
  if (peb?.overlapping) {
    lines.push('le registre publie ici deux zones qui se recouvrent, sans découpe entre elles');
  }
  const airports = new Set([...(payload?.peb || [])]
    .filter((band) => band.atPoint === true).map((band) => band.oaci).filter(Boolean));
  if (airports.size > 1) {
    lines.push(`deux plans se superposent ici : ${[...airports].sort().join(', ')} — deux arrêtés, deux faits`);
  }
  const nearby = peb?.nearby?.length || 0;
  if (nearby) {
    lines.push(`${nearby} zone${nearby > 1 ? 's' : ''} renvoyée${nearby > 1 ? 's' : ''} à côté du repère, dessinée${nearby > 1 ? 's' : ''} en tirets`);
  }
  if (pgs?.winner) {
    lines.push(`plan de gêne sonore : ${bruitBandLabel(pgs.winner)} — aide à l’insonorisation`);
  } else if (payload?.available?.pgs === false) {
    lines.push('le service PGS n’a pas répondu — rien ne peut être dit ici du fonds d’insonorisation');
  }
  if (payload?.mixedIndex) {
    lines.push('deux indices différents sur ce point — les seuils ne sont pas comparables entre eux');
  }
  if (payload?.disputed) {
    lines.push('indice non déterminé : la date de l’arrêté et les seuils publiés ne concordent pas');
  }
  lines.push(...bruitCommonCaveats(payload));
  if (payload?.register?.short === true) {
    lines.push('registre des arrêtés incomplet : « le plus proche » peut en manquer un');
  }
  return lines.filter(Boolean).join(' · ');
}

/**
 * The scale the outlines on screen were generalised at — READ, never assumed.
 *
 * The two modes differ by a factor of a hundred, so a card that reached for a
 * module constant instead of the payload's own number would print a point
 * scan's precision over an overview's outline exactly once, in the case where
 * the payload happens to be missing the field. One function, so the several
 * places that print it cannot drift apart.
 *
 * @param {object} payload
 * @returns {number}
 */
export function bruitScaleDenominator(payload) {
  return payload?.scaleDenominator
    ?? (payload?.area === true ? BRUIT_AREA_SCALE_DENOMINATOR : BRUIT_PROBE_SCALE_DENOMINATOR);
}

/**
 * The caveats that belong on EVERY card this layer draws, in both modes.
 *
 * Pulled out of {@link bruitScanDescription} rather than copied into the
 * overview: "avions seulement" and the generalisation scale are true of every
 * shape on screen whatever question produced it, and a reader who clicks a band
 * in the overview is owed exactly the same two sentences as one who clicks a
 * band at an address. The scale is READ FROM THE PAYLOAD and never assumed —
 * the two modes differ by a factor of a hundred.
 *
 * @param {object} payload
 * @returns {string[]}
 */
export function bruitCommonCaveats(payload) {
  const denominator = bruitScaleDenominator(payload);
  return [
    'avions seulement — ni route, ni fer, ni industrie : la carte de bruit stratégique n’est pas publiée ici',
    `contours généralisés au 1:${denominator.toLocaleString('fr-FR')} — ce n’est pas un relevé`,
  ];
}

/**
 * The card the world overlay actually paints, and it is SIX LINES.
 *
 * `createAddressScanOverlayEntry` slices a card's details to six — a shell
 * constant, shared by five layers, and not this layer's to widen. So a card
 * built by pushing every true sentence onto a list does not "say more", it
 * silently DROPS its tail, and what a description like this one puts at the end
 * is its caveats: the generalisation, and the fact that road and rail noise are
 * not in this layer at all. Measured on the aerodrome card at Roissy, the two
 * lines that fell off the bottom were exactly those.
 *
 * So the tail is not a tail. Five lines of answer, then the caveat, always —
 * and the caveat is the two sentences of {@link bruitCommonCaveats} condensed
 * into one, because at six lines the cost of a second one is the fifth fact.
 *
 * @param {Array<?string>} lines Most load-bearing first.
 * @param {object} payload
 * @returns {string[]}
 */
export function bruitCardDetails(lines, payload) {
  const denominator = bruitScaleDenominator(payload);
  return [
    ...lines.filter(Boolean).slice(0, BRUIT_CARD_MAX_LINES - 1),
    `avions seulement — contours généralisés au 1:${denominator.toLocaleString('fr-FR')}, ce n’est pas un relevé`,
  ];
}

/** What `createAddressScanOverlayEntry` paints. Restated so the two cannot drift. */
export const BRUIT_CARD_MAX_LINES = 6;

/** The headline over one aerodrome's plan in the overview. */
export function bruitAerodromeTitle(aerodrome) {
  const who = [aerodrome?.oaci, aerodrome?.name].filter(Boolean).join(' — ');
  return who || 'Aérodrome sans code';
}

/**
 * One aerodrome's whole plan, on one card.
 *
 * NO WINNER SENTENCE, and the omission is the point. `top` is the most exposed
 * band the document publishes, not the band that applies to any particular
 * ground, and the overview has no ground under a marker to apply it to. The
 * card lists the bands in order and says how many there are; deciding which one
 * governs an address is what descending under 12 km is for, and the last line
 * says so.
 *
 * @param {object} aerodrome A `foldAerodromes` entry.
 * @param {object} payload
 * @param {?object} [pgs] The same aerodrome's PGS entry, when it has one.
 * @returns {string}
 */
export function bruitAerodromeDescription(aerodrome, payload, pgs = null) {
  const count = aerodrome?.zones ?? 0;
  const arrete = bruitDayText(aerodrome?.top?.effectiveDate);
  return bruitCardDetails([
    // The whole plan on ONE line, thresholds and units included, because the
    // plan is what this card is for and the budget is six.
    // JOINED WITH A SEMICOLON, NOT ' · '. The shell splits a description on
    // ' · ' to make the card's lines, so a band list joined that way is not one
    // line carrying four bands — it is four lines, and four lines out of a
    // budget of six is the caveat pushed off the bottom.
    `${count} zone${count > 1 ? 's' : ''} publiée${count > 1 ? 's' : ''} : `
      + (aerodrome?.bands || []).map((band) => bruitBandLabel(band)).join(' ; '),
    arrete
      ? `arrêté du ${arrete}${aerodrome?.top?.revisedDocument ? ' (date reprise du document, le registre affiche l’ancienne)' : ''}`
      : BRUIT_INDEX_SENTENCES[aerodrome?.top?.index ?? 'unknown'],
    pgs?.zones
      ? `plan de gêne sonore : ${pgs.zones} zone${pgs.zones > 1 ? 's' : ''} — aide à l’insonorisation`
      : null,
    // An aerodrome nobody aimed at. Its plan is whatever fell inside a
    // neighbour's buffer, which is not a promise that the plan is complete.
    aerodrome?.probed === false
      ? 'renvoyé par la sonde d’un aérodrome voisin — son plan peut être incomplet ici'
      : null,
    'descendez sous 12 km pour savoir quelle zone s’applique à une adresse',
    aerodrome?.top?.documentUrl ? `arrêté : ${aerodrome.top.documentUrl}` : null,
  ], payload).join(' · ');
}

/**
 * What the overview says about itself, as the row's own sentence.
 *
 * Three numbers and never fewer: how many aerodromes were drawn, how many were
 * in reach and left out by the request budget, and how many were asked and did
 * not answer. A map that quietly stops at twelve and a map that is complete
 * look identical, and only the second one is a statement about France.
 *
 * @param {object} payload
 * @returns {string}
 */
export function bruitAreaSummary(payload) {
  const drawn = payload?.aerodromes?.length || 0;
  const lines = [];
  if (payload?.available?.peb === false) {
    lines.push(`${payload.missing} aérodrome${payload.missing > 1 ? 's' : ''} n’${payload.missing > 1 ? 'ont' : 'a'} pas répondu — la vue est incomplète`);
  }
  lines.push(drawn > 0
    ? `${drawn} aérodrome${drawn > 1 ? 's' : ''} avec un plan dans un rayon de ${payload?.radiusKm} km`
    : 'aucun plan de bruit aérien dans ce cadre');
  if (!drawn) lines.push(bruitNearestSentence(payload?.nearest));
  if (payload?.dropped > 0) {
    lines.push(`${payload.dropped} aérodrome${payload.dropped > 1 ? 's' : ''} de plus dans le cadre, non demandé${payload.dropped > 1 ? 's' : ''}`);
  }
  // Normal here, unlike at a point: a region spans several arrêtés by
  // construction, and the two scales are still not comparable to each other.
  if (payload?.mixedIndex) {
    lines.push('plusieurs indices dans ce cadre — les seuils ne se comparent pas d’un aérodrome à l’autre');
  }
  // Through the same six-line budget as the other two overview cards: this one
  // is painted on an entity too, and its tail is its caveat.
  return bruitCardDetails(lines, payload).join(' · ');
}

/**
 * What this layer has to say about an arbitrary point of ground.
 *
 * WITHOUT THIS, THE INSIDE OF A ZONE IS NOT CLICKABLE — and that is not a
 * nicety, it is most of the layer. The wash is a ground-classification POLYGON,
 * and a polygon entity carries no `position`, so `cardFromEntity` cannot build
 * a card for it and `scene.pick` at any pixel inside a band returns an entity
 * the click index has never heard of. Measured in the running app at 60 km over
 * Roissy: a pick on the aerodrome marker's own pixel returns
 * `bruit:peb:566:fill:0`, with the marker only SECOND in the drill list. So the
 * bands' outlines answered a click and their interiors — the whole coloured
 * surface a reader is looking at — answered nothing at all.
 *
 * THE ANSWER IS RE-DERIVED, NOT LOOKED UP. `atPoint` on a band is about the
 * coordinate the SCAN was aimed at, which is not where this click landed, and
 * in the overview it is false on every band because there was no scan point at
 * all. So every band is re-tested against the clicked coordinate with the same
 * `pointInPolygons` the feed uses, holes included — an enclave cut out of zone C
 * is ground where zone C does NOT apply, and answering "zone C" there would be
 * exactly the error the holes exist to prevent.
 *
 * AND IT SAYS WHAT IT WAS MEASURED AGAINST. This is a test against the drawn
 * outline, which is generalised — to 1:39,757 under a point scan and to
 * 1:3,975,696 in an overview, where a hundred metres of boundary is well under
 * a vertex. Near an edge that is a guess, and the card says so rather than
 * letting a coloured pixel pass for a legal limit.
 *
 * Returns null when no band contains the point, which the shell reads as
 * "declined": the click then falls through to dismissing whatever card is open,
 * because "there is no zone here" is not worth taking over the screen for.
 *
 * @param {{lon: number, lat: number, payload: object}} context
 * @returns {?{title: string, details: string[]}}
 */
export function bruitGroundCard({ lon, lat, payload }) {
  if (!payload || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const hit = (kind) => (payload[kind] || [])
    .filter((band) => pointInPolygons(band.parts, lon, lat))
    .sort(bruitBandComparator(kind));
  const peb = hit('peb');
  const pgs = hit('pgs');
  const lead = peb[0] || pgs[0] || null;
  if (!lead) return null;
  const area = payload.area === true;
  const who = [lead.oaci, lead.airport].filter(Boolean).join(' — ');
  const arrete = bruitDayText(lead.effectiveDate);
  const others = (lead.kind === 'peb' ? peb : pgs).slice(1);
  return {
    title: `Zone ${String(lead.zone ?? '?')}${who ? ` · ${who}` : ''}`,
    details: bruitCardDetails([
      bandText(lead),
      bruitZoneSentence(lead.kind, lead.zone),
      arrete ? `arrêté du ${arrete}` : BRUIT_INDEX_SENTENCES[lead.index ?? 'unknown'],
      // Two bands over one piece of ground is a real state of the register —
      // measured at Saint-Cyr and at Cannes — and the strictest is the headline.
      others.length
        ? `aussi sur ce point : ${others.map((band) => bruitBandLabel(band)).join(' ; ')}`
        : null,
      peb.length && pgs.length ? `plan de gêne sonore : ${bruitBandLabel(pgs[0])}` : null,
      // The sentence that stops a coloured pixel from passing for a legal
      // limit. At 1:3,975,696 a hundred metres of boundary is well under one
      // vertex, so near an edge this answer is a guess.
      area
        ? 'lu sur le contour d’ensemble : près d’une limite, descendez sous 12 km pour la version fine'
        : (lead.documentUrl ? `arrêté : ${lead.documentUrl}` : null),
    ], payload),
  };
}

/** @type {Map<number, string>} raster size → data URI. */
const _glyphCache = new Map();
const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * The marker glyph: a source and three radiating arcs.
 *
 * DRAWN HERE AND NOT IN `addressMarkerIcons.js`, deliberately. That pack is a
 * shared module owned by the five address layers and its `ADDRESS_GLYPH_KINDS`
 * export is asserted exhaustively by its own test; adding a sixth body to it
 * from this branch would be an edit to a file this layer does not own. The
 * technique is copied exactly, because it is the part that matters: white
 * line-art over a wide dark halo, no hue of its own, so Cesium's
 * `billboard.color` multiply takes the zone colour cleanly (white × c = c)
 * while the halo survives it (0 × c = 0) and keeps the glyph readable over a
 * pale orthophoto.
 *
 * @param {number} [px] Raster size. 88 matches the shared pack's reasoning:
 *   Cesium's billboard atlas has no mipmaps, and these draw at 15–32 CSS px.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function bruitMarkerGlyph(px = 88) {
  const cached = _glyphCache.get(px);
  if (cached) return cached;
  const strokes = 'M30,38 L30,58 L44,58 L62,74 L62,22 L44,38 Z'
    + ' M72,36 A22,22 0 0 1 72,60'
    + ' M80,26 A34,34 0 0 1 80,70';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 96 96">`
    + `<g fill="none" stroke="rgba(0,0,0,0.62)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><path d="${strokes}"/></g>`
    + `<g fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="${strokes}"/></g>`
    + '</svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set(px, uri);
  return uri;
}


/**
 * Ground classification for one map stack.
 *
 * The wash is classification geometry, which is what makes it drape on IGN
 * ortho, on Bing and on the Google photoreal tileset alike. With the globe
 * hidden there is no terrain to classify and only the tileset can receive it;
 * asking for TERRAIN there draws nothing at all. Same call, same reasoning and
 * same `redrawOnMapStack: true` as `urbanismeGpu.js`.
 */
export function bruitClassificationTypeForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

/** Positions for one ring, or null when it is not a shape. */
function ringPositions(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  return Cesium.Cartesian3.fromDegreesArray(ring.flat());
}

/**
 * Draw one band: a washed, hole-cut fill per part, and a stroke on EVERY ring.
 *
 * THE HOLES ARE THE WHOLE POINT, and this is not the same argument the zoning
 * layer makes. A PEB zone is a RING — the ground between two thresholds — so
 * its interior rings are exactly where the LOUDER zone begins. Filled without
 * them, zone C is painted over zone B and zone A and the map shows the QUIET
 * number on the loudest ground. Measured at the pinned scale: Roissy's zone C
 * arrives as one polygon with two interior rings, Les Mureaux's zone B with six
 * per piece, and one band at Saint-Denis de la Réunion with thirteen.
 *
 * The interior rings are stroked too. An enclave has a boundary, and it is the
 * boundary that says the rule changes here.
 *
 * @returns {number} Parts drawn.
 */
export function drawBruitParts(dataSource, idPrefix, parts, style) {
  let drawn = 0;
  const stroke = Cesium.Color.fromCssColorString(style.css).withAlpha(BRUIT_OUTLINE_ALPHA);
  for (const [index, rings] of (parts || []).entries()) {
    const outer = ringPositions(rings?.[0]);
    if (!outer) continue;
    if (style.fillAlpha > 0) {
      const holes = [];
      for (let h = 1; h < rings.length; h += 1) {
        const hole = ringPositions(rings[h]);
        if (hole) holes.push(new Cesium.PolygonHierarchy(hole));
      }
      dataSource.entities.add({
        id: `${idPrefix}:fill:${index}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(outer, holes),
          material: Cesium.Color.fromCssColorString(style.css)
            .withAlpha(Math.min(style.fillAlpha, ZONE_FILL_MAX_ALPHA)),
          classificationType: style.classificationType,
          outline: false,
        },
      });
    }
    for (const [ringIndex, ring] of rings.entries()) {
      const positions = ringPositions(ring);
      if (!positions) continue;
      dataSource.entities.add({
        id: `${idPrefix}:${index}:${ringIndex}`,
        name: style.name,
        description: style.description,
        properties: style.properties,
        polyline: {
          positions: [...positions, positions[0]],
          width: style.width,
          material: style.dashed
            ? new Cesium.PolylineDashMaterialProperty({ color: stroke, dashLength: BRUIT_DASH_LENGTH_PX })
            : new Cesium.ColorMaterialProperty(stroke),
          clampToGround: true,
          classificationType: style.classificationType,
        },
      });
    }
    drawn += 1;
  }
  return drawn;
}

/**
 * Every band on screen, quietest first.
 *
 * DRAW ORDER IS LOAD-BEARING HERE in a way it is not for zoning. Two Cesium
 * ground-classification polygons over the same ground blend, and the register
 * genuinely publishes overlapping bands — measured at LFPZ, where zone B has no
 * hole cut where zone A sits. Painting the loudest LAST is what keeps the
 * strictest zone legible on the ground the rule actually applies to.
 *
 * @param {Array<object>} bands
 * @param {'peb'|'pgs'} kind
 * @returns {Array<object>}
 */
export function bruitDrawOrder(bands, kind = 'peb') {
  return [...(bands || [])].sort((a, b) => (
    // Context under answers, then quietest to loudest.
    Number(a?.atPoint === true) - Number(b?.atPoint === true)
    || bruitZoneRank(kind, b?.zone) - bruitZoneRank(kind, a?.zone)
  ));
}

/**
 * The colour legend for the toggle row: one entry per zone actually on screen.
 *
 * Counted from what was DRAWN, not from the vocabulary, so a row never claims a
 * band the reader cannot see. The blurbs carry the facts that would otherwise
 * need a chip — and a chip in this manager is a BUTTON, so an informational one
 * would look clickable and do nothing.
 */
export function bruitLegend(payload) {
  if (!payload) return [];
  const legend = [];
  for (const [kind, order] of [['peb', PEB_ZONE_ORDER], ['pgs', PGS_ZONE_ORDER]]) {
    const bands = payload[kind] || [];
    for (const zone of order) {
      const rows = bands.filter((band) => String(band?.zone ?? '').trim().toUpperCase() === zone);
      if (!rows.length) continue;
      const here = rows.filter((band) => band.atPoint === true).length;
      // `atPoint` is false on every overview band by construction, so the
      // point-mode blurb would report all of them as "returned beside the
      // marker" — an explanation of dashes that are not on screen.
      const aside = payload.area === true ? 0 : rows.length - here;
      legend.push({
        label: kind === 'pgs' ? `PGS zone ${zone}` : `PEB zone ${zone}`,
        color: bruitZoneColorCss(kind, zone),
        count: rows.length,
        blurb: [
          bruitZoneSentence(kind, zone),
          aside === 0 ? null
            : `${aside} dessinée${aside > 1 ? 's' : ''} en tirets : renvoyée${aside > 1 ? 's' : ''} par le service à côté du repère, pas dessous`,
        ].filter(Boolean).join(' — '),
      });
    }
    const unknown = bands.filter((band) => bruitZoneRank(kind, band?.zone) === order.length);
    if (unknown.length) {
      legend.push({
        label: kind === 'pgs' ? 'PGS zone inconnue' : 'PEB zone inconnue',
        color: BRUIT_UNKNOWN_ZONE_COLOR,
        count: unknown.length,
        blurb: 'lettre de zone absente ou inconnue du registre — jamais retenue comme réponse',
      });
    }
  }
  return legend;
}

/**
 * The status the manager reads, and it is GUIDANCE and not a fault.
 *
 * `zoom-in` and `empty` are in the manager's `GUIDANCE_STATUSES`, so they paint
 * a green ON chip rather than DEGRADED. Putting the zoom prompt in
 * `stats.error` instead — which is the easy mistake — would report a working
 * layer as broken every time the camera is above its ceiling, which is most of
 * the time on a globe.
 */
export function bruitStatus(stats) {
  if (!stats) return 'idle';
  if (stats.dormant === true) return 'zoom-in';
  if (stats.available?.peb === false) return 'unavailable';
  if (!stats.lastUpdate) return 'idle';
  // `zonesHere` counts the bands under a MARKER, and the overview has none —
  // reading it there would report every dezoomed view as empty while a dozen
  // plans are on screen.
  if (stats.area === true) return stats.zonesDrawn > 0 ? 'ok' : 'empty';
  return stats.zonesHere > 0 ? 'ok' : 'empty';
}

/**
 * The scan altitude ceiling, restated here so the guidance line and the shell
 * cannot drift apart.
 *
 * 12 000 m, the shared address-scan value, KEPT rather than raised — and the
 * measurement says it is the right order. Over the 293 bands the 224 probes
 * returned, the widest side of a band is 0.27 km at the smallest, 1.9 km at the
 * median and 4.74 km at the 90th percentile, so at 12 km of altitude the zone
 * under the crosshair is a shape on screen rather than a speck. The two
 * national outliers — Roissy's zone C at 41.5 km and Le Bourget's zone D at
 * 65.8 km — are drawn WHOLE anyway, because the service does not clip the
 * geometry it returns to the box it was asked through.
 */
export const ADDRESS_SCAN_CEILING_M = 12_000;

/**
 * Where the OVERVIEW stops, and the number is the widest plan in France.
 *
 * 250 km. Le Bourget's zone D is 65.8 km across — the national outlier, and
 * precisely the shape a reader dezooms to see. Cesium's default frustum spends
 * 60° on the wider screen dimension, so the ground half-width under the camera
 * is `altitude × tan 30°` and the view is about 1.15 × 250 km tall: that band
 * spans roughly a quarter of the screen at this ceiling, which is a shape, and
 * a twentieth at a thousand kilometres, which is a smudge. Above it the layer
 * goes dormant exactly as it did before — but at twenty times the altitude, and
 * for the honest reason that there is nothing left to see rather than because
 * the probe stopped meaning anything.
 */
export const BRUIT_OVERVIEW_CEILING_M = 250_000;

/**
 * Radius the overview asks for, in km, from the camera's altitude.
 *
 * `tan 30° = 0.577` is the ground half-width under a default Cesium frustum;
 * the half-DIAGONAL of a 16:9 canvas is 1.147 × that, so 0.7 × the altitude
 * covers the corners of the screen rather than the middle of its edges. The
 * proxy then reaches another 35 km past whatever is asked for, because a plan
 * is drawn around its aerodrome and the aerodrome can be off-screen while its
 * zone D is not.
 *
 * ROUNDED UP TO A 25 KM LADDER, and that is a cache decision, not a geometric
 * one. The radius is part of the proxy's cache key, so a continuously varying
 * one would mint a fresh entry on every scroll of the wheel; twelve possible
 * values means a reader who flies up and back down is answered from memory.
 *
 * @param {number} altitudeM
 * @returns {number}
 */
export const BRUIT_AREA_RADIUS_STEP_KM = 25;
export function bruitAreaRadiusKm(altitudeM) {
  const km = (Number(altitudeM) || 0) / 1000 * 0.7;
  const stepped = Math.ceil(km / BRUIT_AREA_RADIUS_STEP_KM) * BRUIT_AREA_RADIUS_STEP_KM;
  return Math.max(BRUIT_AREA_RADIUS_STEP_KM, stepped);
}

/**
 * The extra query parameters that choose the mode.
 *
 * `km` present is the overview; absent is the point scan. Nothing else changes
 * — same route, same shell — and because the shared shell rescans whenever the
 * query string changes, crossing {@link ADDRESS_SCAN_CEILING_M} in either
 * direction re-asks the question by itself.
 *
 * @param {{altitudeM: number}} point
 * @returns {Record<string, string>}
 */
export function bruitScanParams(point) {
  const altitudeM = Number(point?.altitudeM);
  if (!Number.isFinite(altitudeM) || altitudeM <= ADDRESS_SCAN_CEILING_M) return {};
  return { km: String(bruitAreaRadiusKm(altitudeM)) };
}

/**
 * The loading / guidance line the panel shows beside the row.
 * @param {object} stats
 * @returns {?string}
 */
export function bruitGuidanceLabel(stats) {
  if (stats?.dormant === true) {
    return `Descendez sous ${(BRUIT_OVERVIEW_CEILING_M / 1000).toLocaleString('fr-FR')} km : au-delà, les zones ne font plus une forme à l’écran`;
  }
  if (stats?.available?.peb === false) {
    return stats?.area === true
      ? `Le service DGAC n’a pas répondu pour ${stats.missing} aérodrome${stats.missing > 1 ? 's' : ''} — la vue est incomplète`
      : 'Le service DGAC n’a pas répondu — ce n’est pas « aucune zone ici »';
  }
  if (stats?.area === true) {
    if (!stats.lastUpdate) return null;
    if (!(stats.aerodromes > 0)) {
      return stats.nearestKm != null
        ? `Aucun plan dans ce cadre — le plus proche est à ${Number(stats.nearestKm).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`
        : 'Aucun plan de bruit aérien dans ce cadre';
    }
    // The line that keeps a capped map from reading as a complete one.
    return stats.dropped > 0
      ? `${stats.aerodromes} aérodromes dessinés · ${stats.dropped} de plus dans le cadre, non demandés`
      : null;
  }
  if (stats?.lastUpdate && !(stats.zonesHere > 0)) {
    return stats.nearestKm != null
      ? `Aucun plan sur ce point — le plus proche est à ${Number(stats.nearestKm).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`
      : 'Aucun plan de bruit aérien sur ce point';
  }
  return null;
}

/** Last payload drawn, for the row legend the shell has no hook for. */
let _payload = null;
let _peb = null;
let _pgs = null;

/**
 * Draw one scan. Exported so a test can drive the production path against a
 * plain `CustomDataSource` with no WebGL context anywhere.
 *
 * @param {{payload: object, dataSource: object, point: object, viewer: ?object}} context
 * @returns {number} Entities created.
 */
export function renderBruit({ payload, dataSource, point, viewer }) {
  const classificationType = bruitClassificationTypeForScene(viewer?.scene);
  _payload = payload;
  if (payload?.area === true) {
    _peb = null;
    _pgs = null;
    return renderBruitArea({ payload, dataSource, classificationType });
  }
  const peb = chooseBruitAnswer(payload?.peb, 'peb');
  const pgs = chooseBruitAnswer(payload?.pgs, 'pgs');
  _peb = peb;
  _pgs = pgs;
  let drawn = 0;

  for (const [kind, answer] of [['peb', peb], ['pgs', pgs]]) {
    for (const band of bruitDrawOrder(payload?.[kind], kind)) {
      const emphasis = bruitEmphasis(band, answer.winner);
      const css = bruitZoneColorCss(kind, band.zone);
      const description = bruitBandDescription(band, answer);
      const name = bruitBandLabel(band);
      if (band.anchor && band.anchor.widthDeg >= BRUIT_LABEL_MIN_WIDTH_DEG) {
        dataSource.entities.add({
          id: `bruit:${band.id}:label`,
          position: Cesium.Cartesian3.fromDegrees(band.anchor.lon, band.anchor.lat),
          name,
          description,
          properties: { kind: `${kind}-zone-label`, zone: band.zone, atPoint: band.atPoint },
          label: {
            // The letter, and the letter only. The thresholds are on the card:
            // writing "62 – 70 Lden dB(A)" across a 500 m band would be four
            // words of ink over the thing they describe.
            text: String(band.zone ?? '?'),
            font: 'bold 15px "Roboto Mono", monospace',
            fillColor: Cesium.Color.fromCssColorString(css),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(800, 1.0, 14_000, 0.6),
            translucencyByDistance: new Cesium.NearFarScalar(9000, 1.0, 20_000, 0.0),
          },
        });
      }
      drawn += drawBruitParts(dataSource, `bruit:${band.id}`, band.parts, {
        css,
        fillAlpha: BRUIT_FILL_ALPHA[emphasis],
        width: emphasis === 'nearby' ? BRUIT_OUTLINE_WIDTH_PX.nearby : BRUIT_OUTLINE_WIDTH_PX.inside,
        // The dash is the second channel, beside the wash, saying "the service
        // found this near your pixel, you are not standing in it".
        dashed: emphasis === 'nearby',
        classificationType,
        name,
        description,
        properties: { kind: `${kind}-zone`, zone: band.zone, atPoint: band.atPoint, emphasis },
      });
    }
  }

  // ALWAYS, when there is a point — unlike the zoning layer, which plants no
  // marker on an address with nothing on it. Here the empty answer IS an
  // answer: "no noise plan covers this ground, the nearest aerodrome that has
  // one is 12.4 km away" is the sentence a reader came for, and there is
  // nothing else on screen to hang it on.
  if (point) {
    dataSource.entities.add({
      id: 'bruit:scan-point',
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
      billboard: {
        image: bruitMarkerGlyph(),
        width: 26,
        height: 26,
        color: Cesium.Color.fromCssColorString(
          peb.winner ? bruitZoneColorCss('peb', peb.winner.zone)
            : pgs.winner ? bruitZoneColorCss('pgs', pgs.winner.zone)
              : BRUIT_UNKNOWN_ZONE_COLOR,
        ),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { kind: 'bruit-scan-point' },
      name: bruitMarkerTitle(payload, peb, pgs),
      description: bruitScanDescription(payload, peb, pgs),
    });
    drawn += 1;
  }
  return drawn;
}

/**
 * Where a zone letter is legible in the overview, and where it is litter.
 *
 * Visible from 10 km — just under the mode boundary, so the letters are already
 * on screen as a reader climbs through it — and gone by 200 km, where a dozen
 * plans' worth of letters would be a cloud of characters over shapes a few
 * pixels across. The aerodrome markers do NOT fade with them: past that
 * distance the marker is the only thing left that names what is on screen.
 */
export const BRUIT_AREA_LABEL_SCALE = Object.freeze({ near: 10_000, far: 150_000 });
export const BRUIT_AREA_LABEL_FADE = Object.freeze({ near: 100_000, far: 200_000 });

/**
 * Draw an overview: every band of every aerodrome in view, plus one marker per
 * aerodrome.
 *
 * DRAW ORDER IS THE SAME ARGUMENT AS POINT MODE and it matters more here. Two
 * ground-classification polygons over the same ground blend, and an overview
 * puts every band of every plan on screen at once — including, at Saint-Cyr and
 * Cannes, the two the register publishes overlapping with no hole cut between
 * them. Quietest first, so the strictest zone stays legible on the ground its
 * rule applies to.
 *
 * @returns {number} Entities created.
 */
export function renderBruitArea({ payload, dataSource, classificationType }) {
  let drawn = 0;
  const byBand = new Map();
  for (const kind of ['peb', 'pgs']) {
    const entries = kind === 'pgs' ? payload?.pgsAerodromes : payload?.aerodromes;
    for (const aerodrome of entries || []) {
      for (const band of aerodrome.bands || []) byBand.set(band.id, aerodrome);
    }
  }
  for (const kind of ['peb', 'pgs']) {
    for (const band of bruitDrawOrder(payload?.[kind], kind)) {
      const aerodrome = byBand.get(band.id) || null;
      const emphasis = bruitAreaEmphasis(band, aerodrome);
      const css = bruitZoneColorCss(kind, band.zone);
      const description = bruitBandDescription(band, null, { area: true });
      const name = bruitBandLabel(band);
      if (band.anchor && band.anchor.widthDeg >= BRUIT_LABEL_MIN_WIDTH_DEG) {
        dataSource.entities.add({
          id: `bruit:${band.id}:label`,
          position: Cesium.Cartesian3.fromDegrees(band.anchor.lon, band.anchor.lat),
          name,
          description,
          properties: { kind: `${kind}-zone-label`, zone: band.zone, area: true },
          label: {
            text: String(band.zone ?? '?'),
            font: 'bold 15px "Roboto Mono", monospace',
            fillColor: Cesium.Color.fromCssColorString(css),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(
              BRUIT_AREA_LABEL_SCALE.near, 1.0, BRUIT_AREA_LABEL_SCALE.far, 0.65,
            ),
            translucencyByDistance: new Cesium.NearFarScalar(
              BRUIT_AREA_LABEL_FADE.near, 1.0, BRUIT_AREA_LABEL_FADE.far, 0.0,
            ),
          },
        });
      }
      drawn += drawBruitParts(dataSource, `bruit:${band.id}`, band.parts, {
        css,
        fillAlpha: BRUIT_FILL_ALPHA[emphasis],
        // Never `nearby`: there is no marker to be beside. See
        // `bruitAreaEmphasis`.
        width: BRUIT_OUTLINE_WIDTH_PX.inside,
        dashed: false,
        classificationType,
        name,
        description,
        properties: { kind: `${kind}-zone`, zone: band.zone, area: true, emphasis },
      });
    }
  }

  const pgsByOaci = new Map((payload?.pgsAerodromes || [])
    .filter((entry) => entry.oaci).map((entry) => [entry.oaci, entry]));
  for (const aerodrome of payload?.aerodromes || []) {
    if (!Number.isFinite(aerodrome.lat) || !Number.isFinite(aerodrome.lon)) continue;
    dataSource.entities.add({
      id: `bruit:aerodrome:${aerodrome.oaci ?? aerodrome.bands?.[0]?.id ?? drawn}`,
      position: Cesium.Cartesian3.fromDegrees(aerodrome.lon, aerodrome.lat),
      billboard: {
        image: bruitMarkerGlyph(),
        width: 24,
        height: 24,
        color: Cesium.Color.fromCssColorString(
          bruitZoneColorCss('peb', aerodrome.top?.zone),
        ),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { kind: 'bruit-aerodrome', oaci: aerodrome.oaci, area: true },
      name: bruitAerodromeTitle(aerodrome),
      description: bruitAerodromeDescription(
        aerodrome, payload, aerodrome.oaci ? pgsByOaci.get(aerodrome.oaci) ?? null : null,
      ),
    });
    drawn += 1;
  }

  // THE EMPTY OVERVIEW STILL NEEDS SOMEWHERE TO SAY SO. With no aerodrome in
  // reach there is no marker, no band and nothing to click, and the sentence a
  // reader came for — "the nearest plan is 84 km away" — would have nothing to
  // hang on. It goes on the centre of the view, which is the only point the
  // overview has.
  if (!(payload?.aerodromes?.length) && payload?.centre) {
    dataSource.entities.add({
      id: 'bruit:area-centre',
      position: Cesium.Cartesian3.fromDegrees(payload.centre.lon, payload.centre.lat),
      billboard: {
        image: bruitMarkerGlyph(),
        width: 22,
        height: 22,
        color: Cesium.Color.fromCssColorString(BRUIT_UNKNOWN_ZONE_COLOR),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { kind: 'bruit-area-centre', area: true },
      name: 'Aucun plan de bruit aérien dans ce cadre',
      description: bruitAreaSummary(payload),
    });
    drawn += 1;
  }
  return drawn;
}

/**
 * Extra fields merged into `getStats()`.
 *
 * `zonesHere` and `zonesDrawn` are deliberately two numbers. Under a probe that
 * returned four polygons, one number cannot tell "you are in one zone" from
 * "four zones are on screen", and the row would claim the ground under the
 * marker carries four rules.
 */
export function summarizeBruit(payload) {
  if (payload?.area === true) {
    return {
      area: true,
      // How many aerodromes are DRAWN, how many were left out by the request
      // budget, and how many were asked and did not answer. `bruitStatus` reads
      // `zonesDrawn` here rather than `zonesHere`, which counts bands under a
      // marker the overview does not have.
      aerodromes: payload.aerodromes?.length || 0,
      zonesHere: 0,
      zonesDrawn: (payload.peb?.length || 0) + (payload.pgs?.length || 0),
      dropped: payload.dropped ?? 0,
      missing: payload.missing ?? 0,
      radiusKm: payload.radiusKm ?? null,
      nearbyCount: 0,
      pgsAerodromes: payload.pgsAerodromes?.length || 0,
      mixedIndex: payload.mixedIndex === true,
      disputed: payload.disputed === true,
      revised: payload.revised === true,
      nearestKm: Number.isFinite(payload?.nearest?.distanceKm) ? payload.nearest.distanceKm : null,
      nearestOaci: payload?.nearest?.oaci ?? null,
      register: payload?.register ?? null,
      scaleDenominator: payload?.scaleDenominator ?? BRUIT_AREA_SCALE_DENOMINATOR,
      available: payload?.available ?? null,
    };
  }
  const peb = chooseBruitAnswer(payload?.peb, 'peb');
  const pgs = chooseBruitAnswer(payload?.pgs, 'pgs');
  const airports = new Set((payload?.peb || [])
    .filter((band) => band.atPoint === true).map((band) => band.oaci).filter(Boolean));
  return {
    zonesHere: peb.eligible,
    zonesDrawn: (payload?.peb?.length || 0) + (payload?.pgs?.length || 0),
    nearbyCount: payload?.nearbyCount ?? 0,
    winnerZone: peb.winner?.zone ?? null,
    winnerRule: peb.rule,
    winnerOaci: peb.winner?.oaci ?? null,
    // The band, in its own unit, or null. Never a bare number.
    winnerBand: peb.winner ? bandText(peb.winner) : null,
    index: peb.winner?.index ?? null,
    mixedIndex: payload?.mixedIndex === true,
    disputed: payload?.disputed === true,
    revised: payload?.revised === true,
    overlapping: peb.overlapping,
    airportsHere: airports.size,
    pgsZone: pgs.winner?.zone ?? null,
    nearestKm: Number.isFinite(payload?.nearest?.distanceKm) ? payload.nearest.distanceKm : null,
    nearestOaci: payload?.nearest?.oaci ?? null,
    register: payload?.register ?? null,
    scaleDenominator: payload?.scaleDenominator ?? BRUIT_PROBE_SCALE_DENOMINATOR,
    available: payload?.available ?? null,
  };
}

const bruitScanLayer = createAddressScanLayer({
  id: BRUIT_FR_LAYER_ID,
  name: 'Bruit des aéroports (PEB/PGS)',
  icon: '🔊',
  source: BRUIT_SOURCE,
  endpoint: BRUIT_FR_ENDPOINT,
  updateInterval: UPDATE_INTERVAL_MS,
  // The OVERVIEW ceiling, not the point one. Below `ADDRESS_SCAN_CEILING_M`
  // `bruitScanParams` sends no `km` and the proxy answers a point scan; above
  // it, the same route answers about the aerodromes in view. Only past 250 km
  // does the shell go dormant and clear the draw.
  maxAltitudeM: BRUIT_OVERVIEW_CEILING_M,
  params: bruitScanParams,
  // The wash is ground-classification geometry and a classification type is
  // read once, when the primitive is built. Switching to the Google photoreal
  // tileset hides the globe, and a wash addressed to terrain then draws
  // nothing — the layer looks switched off. Same reasoning as `urbanismeGpu`.
  redrawOnMapStack: true,
  render: renderBruit,
  summarize: summarizeBruit,
  // The wash is a polygon, and a polygon entity has no position to hang a card
  // on. Without this hook the interior of every band is inert — see
  // `bruitGroundCard`.
  groundCard: bruitGroundCard,
});

/**
 * The layer module.
 *
 * The scan shell is wrapped rather than returned directly, for two things it
 * does not have: a colour legend for the toggle row, and a `status` the manager
 * can read as GUIDANCE. Every lifecycle method is the shell's own closure,
 * spread through unchanged.
 */
const bruitFranceLayer = {
  ...bruitScanLayer,

  getStats() {
    const stats = bruitScanLayer.getStats();
    return {
      ...stats,
      status: bruitStatus(stats),
      loadingLabel: bruitGuidanceLabel(stats),
    };
  },

  /**
   * Colour legend for the toggle row — only the zones actually on screen.
   * @returns {{chips: Array<object>, legend: Array<object>}}
   */
  getRowControls() {
    // Read back through the shell's own stats rather than a private flag: the
    // shell clears its draw when the camera climbs above the ceiling and does
    // NOT call `render`, so a legend built from the last payload alone would
    // keep describing a scan that is no longer on screen.
    if (bruitScanLayer.getStats().dormant === true) return { chips: [], legend: [] };
    return { chips: [], legend: bruitLegend(_payload) };
  },
};

/** Seed the drawn state, for tests that do not construct a viewer. */
export function _setBruitStateForTest(payload) {
  _payload = payload;
  _peb = chooseBruitAnswer(payload?.peb, 'peb');
  _pgs = chooseBruitAnswer(payload?.pgs, 'pgs');
  return { peb: _peb, pgs: _pgs };
}

/** The chosen answers for the last drawn payload. */
export function _bruitAnswersForTest() {
  return { peb: _peb, pgs: _pgs };
}

/** Row controls, for tests that do not construct a viewer. */
export function _bruitRowControlsForTest() {
  return bruitFranceLayer.getRowControls();
}

/** Stats, for tests that do not construct a viewer. */
export function _bruitStatsForTest() {
  return bruitFranceLayer.getStats();
}

/**
 * Draw a payload into a fresh data source, exactly the way `enable()` does.
 * @returns {{dataSource: object, drawn: number}}
 */
export function _drawBruitForTest(payload, point, viewer = null) {
  const dataSource = new Cesium.CustomDataSource(BRUIT_FR_LAYER_ID);
  const drawn = renderBruit({ payload, dataSource, point, viewer });
  return { dataSource, drawn };
}

export default bruitFranceLayer;
