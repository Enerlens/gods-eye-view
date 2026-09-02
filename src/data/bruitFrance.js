import * as Cesium from 'cesium';
import { createAddressScanLayer } from './addressScanLayer.js';
import {
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
 * ── DRAWN AT A FIXED GENERALISATION, AND SAYING SO ──────────────────────────
 * The outline the service returns is generalised to the requested rendering
 * scale, which `bruitFeed.js` pins at 1:{@link BRUIT_PROBE_SCALE_DENOMINATOR}
 * so the answer does not change with the camera. Nothing drawn here is a
 * surveyed limit; the arrêté PDF on the card is the document that is.
 *
 * ── WHY IT SITS ON `createAddressScanLayer` ─────────────────────────────────
 * The upstream takes a coordinate, not a bounding box, exactly like the four
 * layers already on that shell. Reusing it buys the look-at derivation, the
 * altitude gate, the 450 ms camera settle, the single-flight scan, the terrain
 * seating and the click-to-card index — about eight hundred lines this layer
 * would otherwise own a second copy of. What is added on top is the row legend
 * and the zoom guidance the shell does not have.
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
export function bruitBandDescription(band, answer = null) {
  const isWinner = Boolean(answer?.winner && answer.winner.id === band?.id);
  const arrete = bruitDayText(band?.effectiveDate);
  return [
    bandText(band),
    bruitZoneSentence(band?.kind, band?.zone),
    BRUIT_INDEX_SENTENCES[band?.index ?? 'unknown'],
    band?.atPoint === true ? null : 'zone voisine — le repère n’est pas dedans',
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
  lines.push('avions seulement — ni route, ni fer, ni industrie : la carte de bruit stratégique n’est pas publiée ici');
  lines.push(`contours généralisés au 1:${(payload?.scaleDenominator ?? BRUIT_PROBE_SCALE_DENOMINATOR).toLocaleString('fr-FR')} — ce n’est pas un relevé`);
  if (payload?.register?.short === true) {
    lines.push('registre des arrêtés incomplet : « le plus proche » peut en manquer un');
  }
  return lines.filter(Boolean).join(' · ');
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
      legend.push({
        label: kind === 'pgs' ? `PGS zone ${zone}` : `PEB zone ${zone}`,
        color: bruitZoneColorCss(kind, zone),
        count: rows.length,
        blurb: [
          bruitZoneSentence(kind, zone),
          here === rows.length ? null
            : `${rows.length - here} dessinée${rows.length - here > 1 ? 's' : ''} en tirets : renvoyée${rows.length - here > 1 ? 's' : ''} par le service à côté du repère, pas dessous`,
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
 * The loading / guidance line the panel shows beside the row.
 * @param {object} stats
 * @returns {?string}
 */
export function bruitGuidanceLabel(stats) {
  if (stats?.dormant === true) {
    return `Descendez sous ${(ADDRESS_SCAN_CEILING_M / 1000).toLocaleString('fr-FR')} km : le plan est lu sous le point visé`;
  }
  if (stats?.available?.peb === false) return 'Le service DGAC n’a pas répondu — ce n’est pas « aucune zone ici »';
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
  const peb = chooseBruitAnswer(payload?.peb, 'peb');
  const pgs = chooseBruitAnswer(payload?.pgs, 'pgs');
  _payload = payload;
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
 * Extra fields merged into `getStats()`.
 *
 * `zonesHere` and `zonesDrawn` are deliberately two numbers. Under a probe that
 * returned four polygons, one number cannot tell "you are in one zone" from
 * "four zones are on screen", and the row would claim the ground under the
 * marker carries four rules.
 */
export function summarizeBruit(payload) {
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
  maxAltitudeM: ADDRESS_SCAN_CEILING_M,
  // The wash is ground-classification geometry and a classification type is
  // read once, when the primitive is built. Switching to the Google photoreal
  // tileset hides the globe, and a wash addressed to terrain then draws
  // nothing — the layer looks switched off. Same reasoning as `urbanismeGpu`.
  redrawOnMapStack: true,
  render: renderBruit,
  summarize: summarizeBruit,
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
