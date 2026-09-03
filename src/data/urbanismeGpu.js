import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';
import { GPU_BOX_MAX_ALTITUDE_M, GPU_MAX_BOX_DEG } from './gpuFeed.js';
import { pointInPolygons } from './ringGeometry.js';
import { greatCircleKm } from './trafficBounds.js';
import { cameraViewBox } from './viewGate.js';
import { focusedViewBox } from './viewportBox.js';

/**
 * Géoportail de l'urbanisme — what may legally be built here, and what the
 * state has already encumbered this ground with.
 *
 * THE MOST DECISION-CHANGING LAYER OF THE SIX, AND THE LEAST LOOKED AT. A
 * listing shows the flat. It does not show that the car park opposite is zoned
 * for construction, that an airport noise-exposure plan covers the address, or
 * that a railway protection strip runs under the balcony. All three are
 * public, drawable, and read today — if at all — one PDF at a time.
 *
 * IT DRAWS THE BLOCK, NOT THE DOT. Below {@link GPU_BOX_MAX_ALTITUDE_M} the
 * zoning half is asked for over a BOX around what the camera is looking at, so
 * the answer on screen is the neighbourhood's zoning rather than one polygon
 * under the operator's feet. That is the layer's actual question — "could the
 * car park opposite become twenty-five metres of construction?" is about the
 * plot OPPOSITE — and a point query cannot answer it. Higher up it falls back
 * to the point, which is still correct and much cheaper. Measured on
 * 2026-09-01 at the 0.02° ceiling: Paris 52 zones and 221 KB against 122 KB
 * for the point, Ustaritz 55 zones and 170 KB against 17 KB.
 *
 * THE SERVITUDE HALF STAYS A POINT IN BOTH REGIMES, and the measurement is
 * why: one 390 m box over Lyon's Presqu'île answers 210 easement features and
 * 2.3 MB. At the zoning ceiling the full-box regime cost 4 MB upstream, 1.8 MB
 * on the wire and 1 182 entities against the hybrid's 888 KB, 506 KB and 218 —
 * four times the payload for the half of the answer a point already gets
 * right. "What reaches this address" is the right question for an easement.
 *
 * THE ZONE IS FILLED, AND THAT IS NOT DECORATION. It was drawn as a bare
 * outline until an operator looked at Ustaritz and asked how one house could
 * be in two PLU zones at once. An outline has no inside: nothing on screen
 * says which side of the line the rule applies to, and when two lines run near
 * each other a building between them belongs to both as far as the eye can
 * tell. A translucent wash answers the question the line only posed, and it
 * answers it in the one place a reader is looking — the ground under the
 * house. The stroke stays on top, because the wash says WHERE and the stroke
 * says EXACTLY WHERE.
 *
 * AND THE ENCLAVES ARE CUT OUT OF IT. `gpuFeed.js` kept outer rings only until
 * this branch, on the reasoning that a hole in an outline is invisible. It is
 * invisible; a hole in a FILL is the whole point. Measured at Ustaritz on
 * 2026-09-01: the `UB` zone returned for the village centre is one polygon
 * with two interior rings — the school (`UE`, 6 646 m²) and the industrial
 * estate (`UYc`, 50 686 m²). Filled without its holes, UB is a solid blob that
 * paints 57 332 m² of ground with a rule that does not apply to it. That is
 * how a house ends up in two zones, and it was ours, not the register's.
 *
 * THE FILL IS WEIGHTED BY WHAT THE FAMILY DOES TO A VIEW, see
 * {@link zoneFillAlpha}. Never above a third: an orthophoto that cannot be
 * read under the rule is not a map of the rule.
 *
 * SERVITUDES STAY LINES, AND THE LINES ARE DASHED. They are not zoning, and a
 * solid stroke would say they were. They are also the wrong size to fill:
 * measured, one `pm1` technological-risk envelope is 759 polygons and 50 669
 * vertices spanning kilometres, so a wash of it tints the entire view rather
 * than a plot. Dashed is the ordinary cartographic convention for a rule laid
 * OVER ground rather than a property of the ground, and it survives being
 * drawn on top of the zone fill.
 *
 * WHY THERE IS A MARKER AT THE SCAN POINT. Clamped polylines are drawn as
 * ground primitives and are NOT pickable in this scene — measured: 62 vertices
 * of one servitude ring on screen, `scene.pick` returning null at every one of
 * them. Widening the stroke did not change it. But aiming at a hairline was
 * always the wrong interaction anyway: a zoning rule and an easement describe
 * the GROUND UNDER THE ADDRESS, not a particular line on a map. So the layer
 * plants one marker at the point it scanned, carrying the whole answer, and the
 * outlines stay as the context that shows how far each rule reaches.
 *
 * AND THEN THE WHOLE GROUND IS THE ANSWER, NOT THE MARKER. One marker per scan
 * makes the map's own colours ornamental: the reader can see that the plot
 * opposite is magenta and still has to fly the camera over it to be told what
 * magenta means there, because the only thing carrying words is a 26-pixel
 * glyph somewhere else. So a click ANYWHERE on this layer's ground — the wash,
 * the outlines, the bare globe between them — is read as a question about that
 * spot and answered from the map already in hand: see {@link gpuAnswerAt}. No
 * request, no wait, and it works on the plot opposite, which is the plot this
 * layer exists for.
 *
 * THE ANSWER IS READ OFF THE DRAWN SHAPES, AND WITHIN 30 M OF THE MARKER IT IS
 * NOT. Those shapes are decimated by up to 96%, and the module's own rule is
 * that a simplified outline must never be what decides which rule applies to a
 * house: measured at Ustaritz, the scan point APIcarto itself answers `UB` for
 * falls OUTSIDE the decimated `UB` ring. At the scan point the register has
 * already answered — `atPoint` for the zoning, and every servitude returned by
 * construction, since that half is always a point query — so within
 * {@link GPU_REGISTER_RADIUS_M} the register's answer is used and the geometry
 * is not consulted. Further out the drawn map answers, and the card says that
 * the outline it answered from is simplified.
 *
 * DRAWN AS SIMPLIFIED SHAPES, AND SAYING SO. The measured upstream is
 * 1,396,720 bytes for one point, one feature of which is 759 polygons and
 * 50,669 vertices published to the millimetre. `gpuFeed.js` decimates that by
 * 96%, and every shape carries `simplified` so nothing here is mistaken for a
 * surveyed limit. The regulation URL rides along on each servitude: this layer
 * points at the legal document, it is not one.
 *
 * @module data/urbanismeGpu
 */

const UPDATE_INTERVAL_MS = 900_000;

/**
 * `typezone`, the standardised family — and it is SEVEN values, not four.
 *
 * The table read `{U, AU, A, N}` until a census said otherwise. Measured
 * 2026-09-01 over twelve APIcarto boxes — Paris, Lyon, Lille, Toulouse,
 * Marseille, Rennes and five peri-urban ones around Nantes, Orléans, Annecy,
 * Caen and Perpignan, plus Ustaritz — **4 216 zoning features, and plain `AU`
 * appears ZERO times**. Every à-urbaniser zone in the sample is `AUc` (97) or
 * `AUs` (23). So the one family this module's own header calls "the one that
 * changes a view" was the one family it drew in the unknown-value grey, at the
 * unknown-value weight, in every commune. `AU` is kept as a legacy spelling
 * because a document somewhere may still use it, not because it was seen.
 *
 * AND THE `c`/`s` IS THE MOST DECISION-CHANGING BIT IN THE LAYER. `AUc` is
 * open: the car park opposite can become flats under the PLU as it stands.
 * `AUs` is closed until the document is modified or revised — the register's
 * own words for it, in the sample: "à urbaniser bloquée", "réservée à
 * l'extension future de la ville", "à urbaniser dans un 2e temps". Same
 * family, different clock, so: same magenta, cooled.
 *
 * `Ah` and `Nh` are built pockets inside the agricultural and natural zones —
 * one `Ah` in the sample, at Jatxou. They take their family's hue, brightened,
 * because they are the exception INSIDE a quiet family.
 */
const ZONE_COLORS = Object.freeze({
  U: '#ff9d3d',    // urbaine — already built
  AU: '#ff5ac8',   // à urbaniser, legacy spelling — never observed
  AUc: '#ff5ac8',  // à urbaniser, OPEN — the one that changes a view
  AUs: '#b378e8',  // à urbaniser, CLOSED until the document is revised
  A: '#9ad14b',    // agricole
  Ah: '#d3ed72',   // secteur bâti dans la zone agricole
  N: '#3dd6c4',    // naturelle
  Nh: '#8ef0e4',   // secteur bâti dans la zone naturelle
});
const ZONE_FALLBACK = '#c9d4e0';

/**
 * Index a `typezone` table for case-insensitive lookup.
 *
 * The tables above are written in the register's OWN spelling — `AUc`, `AUs`,
 * `Ah`, `Nh` — because that is what a reader comparing this file against a GPU
 * response needs to see. Reading them then has to be case-insensitive, and the
 * previous `ZONE_COLORS[kind.toUpperCase()]` would have missed every one of
 * them: `'AUc'.toUpperCase()` is `AUC`, which is not a key.
 * @template T
 * @param {Record<string, T>} table
 * @returns {Record<string, T>}
 */
function byUpperKey(table) {
  return Object.freeze(Object.fromEntries(
    Object.entries(table).map(([key, value]) => [key.toUpperCase(), value]),
  ));
}

/**
 * How heavily each family's wash sits on the ground.
 *
 * NOT one number, because the families are not equally worth looking at and
 * they do not cover equal amounts of France.
 *
 * THE NUMBERS ARE MEASURED, not chosen. On the operator's own basemap — IGN
 * ortho, under this app's colour grading and scope mask — the same polygon was
 * repainted at five alphas over Ustaritz and the frame differenced against the
 * unpainted one, across the ~380 000 pixels the zone covers:
 *
 *   0.18 → mean ΔR  +3   INVISIBLE on an orthophoto. This was the first value.
 *   0.22 → mean ΔR  +5   the floor: present if you look for it
 *   0.28 → mean ΔR +11   reads without being looked for
 *   0.33 → mean ΔR +17   clear, roofs and cars still legible under it
 *   0.40 → mean ΔV +24   strong; the photograph is still readable
 *
 * The app attenuates a nominal alpha hard, which is why the intuitive "0.18 is
 * plenty" was wrong by a factor of four. The ceiling is 0.45: past that the
 * wash stops annotating the ground and starts replacing it.
 */
const ZONE_FILL_ALPHA = Object.freeze({
  AUc: 0.42,
  AU: 0.34,
  AUs: 0.34,
  Ah: 0.34,
  Nh: 0.34,
  U: 0.30,
  A: 0.22,
  N: 0.22,
});
const ZONE_FILL_FALLBACK_ALPHA = 0.26;
/** Past this the wash replaces the photograph instead of annotating it. */
export const ZONE_FILL_MAX_ALPHA = 0.45;

/** The stroke on the boundary itself, over its own wash. */
const ZONE_OUTLINE_ALPHA = 0.95;
/**
 * 3 px, not 2. A clamped hairline is both hard to see against an orthophoto
 * and hard to HIT: picking a polyline needs the cursor on the line itself, and
 * at 2 px selecting a zoning boundary was a matter of luck. Width is the only
 * pick tolerance a Cesium polyline has.
 */
const ZONE_OUTLINE_WIDTH_PX = 3;

const SERVITUDE_COLOR = '#ff4d3d';
/** Dash period in pixels — long enough to read as a dash at a shallow pitch. */
const SERVITUDE_DASH_LENGTH_PX = 20;

/**
 * Narrowest zone that gets its code written on it, in degrees of longitude.
 *
 * A neighbourhood of fifty coloured polygons with no codes on them is a puzzle,
 * not a map — which family a colour means is learnable, but `UB` against `UYc`
 * is not, and those two are the same orange. So each zone carries its code on
 * the ground, the way the paper document does.
 *
 * The threshold is what keeps that from becoming noise. `anchor.widthDeg` is
 * the width of the chord the label stands on, so this is "do not write four
 * characters across a shape a few metres wide": 0.0004° is about 33 m of
 * longitude at 45°N, roughly a building. Below it the zone is drawn and
 * coloured but unlabelled — its card still names it.
 */
const ZONE_LABEL_MIN_WIDTH_DEG = 0.0004;

/**
 * What each family means, in the words someone buying a house would use.
 *
 * The register's own `libelong` is frequently just "Zone UB", which restates
 * the code rather than explaining it. The family letter is the one part of the
 * national grammar that IS standard across every commune, so it is the one
 * part that can be spelled out without inventing.
 */
export const ZONE_FAMILY_SENTENCES = Object.freeze({
  U: 'zone urbaine — déjà bâtie et équipée',
  AU: 'zone à urbaniser — constructible, aujourd\'hui non bâtie',
  AUc: 'zone à urbaniser OUVERTE — constructible sous le PLU en vigueur',
  AUs: 'zone à urbaniser FERMÉE — constructible seulement après modification ou révision du PLU',
  A: 'zone agricole — construction très limitée',
  Ah: 'secteur bâti dans la zone agricole — quelques constructions admises, à la différence du reste de la zone',
  N: 'zone naturelle — construction très limitée',
  Nh: 'secteur bâti dans la zone naturelle — quelques constructions admises, à la différence du reste de la zone',
});

const ZONE_COLOR_INDEX = byUpperKey(ZONE_COLORS);
const ZONE_ALPHA_INDEX = byUpperKey(ZONE_FILL_ALPHA);
const ZONE_SENTENCE_INDEX = byUpperKey(ZONE_FAMILY_SENTENCES);

/** Servitude families worth pulling to the front of a reader's attention. */
const LOUD_SUP_CODES = new Set(['t1', 't4', 't5', 't7', 'i1', 'i3', 'i4', 'pm1', 'pm3']);

/**
 * Colour a zoning polygon by its national type letter.
 * @param {string|null} kind
 * @returns {string} CSS colour.
 */
export function zoneColorCss(kind) {
  return ZONE_COLOR_INDEX[String(kind || '').toUpperCase()] || ZONE_FALLBACK;
}

/**
 * How opaque that family's wash is. See {@link ZONE_FILL_ALPHA}.
 * @param {string|null} kind
 * @returns {number} 0..1.
 */
export function zoneFillAlpha(kind) {
  return ZONE_ALPHA_INDEX[String(kind || '').toUpperCase()] ?? ZONE_FILL_FALLBACK_ALPHA;
}

/**
 * The family, in a sentence, or null when the register published a letter this
 * grammar does not know. An unknown family is left unexplained rather than
 * guessed at — the code is still on the card.
 * @param {string|null} kind
 * @returns {?string}
 */
export function zoneFamilySentence(kind) {
  return ZONE_SENTENCE_INDEX[String(kind || '').toUpperCase()] ?? null;
}

/**
 * An approval date as a person writes one.
 *
 * The register publishes `datvalid` two ways in the same national schema —
 * `20240323` at Ustaritz, `2026-06-16` in Paris — and the first is not a date
 * on a card, it is eight digits. Anything that is neither is passed through
 * untouched rather than mangled into a guess.
 * @param {string|null} raw
 * @returns {?string}
 */
export function zoneApprovalDate(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact) return `${compact[3]}/${compact[2]}/${compact[1]}`;
  const dashed = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (dashed) return `${dashed[3]}/${dashed[2]}/${dashed[1]}`;
  return text;
}

/**
 * Ground classification for one map stack.
 *
 * The zone wash is classification geometry, which is what makes it drape on
 * IGN ortho, on Bing and on the Google photoreal tileset alike. With the globe
 * hidden there is no terrain to classify and only the tileset can receive it;
 * asking for TERRAIN there draws nothing at all.
 * @param {object|null|undefined} scene
 * @returns {number} Cesium.ClassificationType
 */
export function gpuClassificationTypeForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

/**
 * Positions for one ring, closed.
 * @param {Array<number[]>} ring
 * @returns {?Array<object>}
 */
function ringPositions(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  return Cesium.Cartesian3.fromDegreesArray(ring.flat());
}

/**
 * Draw one feature: a washed, hole-cut fill per part, and a stroke on EVERY
 * ring — interior ones included, because an enclave has a boundary too and it
 * is the boundary a reader needs most.
 *
 * Exported for its own test: "the enclave is a hole in the wash, and it has a
 * stroke of its own" is the contract this whole change exists to hold, and a
 * later simplification back to outline-only would silently undo it.
 *
 * @param {object} dataSource
 * @param {string} idPrefix
 * @param {Array<Array<Array<number[]>>>} parts Outer ring first, then holes.
 * @param {{css: string, fillAlpha: number, width: number, dashed: boolean,
 *   classificationType: number, name: string, description: string,
 *   properties: object}} style
 * @returns {number} Parts drawn.
 */
export function drawGpuParts(dataSource, idPrefix, parts, style) {
  let drawn = 0;
  const stroke = Cesium.Color.fromCssColorString(style.css).withAlpha(ZONE_OUTLINE_ALPHA);
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
          material: Cesium.Color.fromCssColorString(style.css).withAlpha(style.fillAlpha),
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
            ? new Cesium.PolylineDashMaterialProperty({
              color: stroke, dashLength: SERVITUDE_DASH_LENGTH_PX,
            })
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
 * One zone's card, shared by its outline and by the code written on it.
 *
 * The same sentence either way, because they are the same zone: clicking the
 * code on the ground and clicking its boundary must not tell a reader two
 * different things about the rule they are standing on.
 * @param {object} entry Projected zone.
 * @returns {string}
 */
export function zoneDescription(entry) {
  return [
    zoneFamilySentence(entry?.kind),
    entry?.atPoint === false ? 'zone voisine — pas celle sous le repère' : null,
    entry?.label,
    entry?.approvedOn ? `PLU approuvé le ${zoneApprovalDate(entry.approvedOn)}` : null,
    entry?.regulationFile,
    entry?.holes
      ? `${entry.holes} enclave${entry.holes > 1 ? 's' : ''} découpée${entry.holes > 1 ? 's' : ''} dans la zone`
      : null,
    entry?.simplified ? `contour simplifié (${entry.sourceVertices} sommets à l'amont)` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * How near the scan point a click has to be for the REGISTER's own answer to
 * be used instead of the drawn one, in metres.
 *
 * TWO THINGS SET THIS NUMBER AND THEY AGREE. The first is honesty: at the scan
 * point APIcarto answered the question itself — `atPoint` on the zoning, and
 * every servitude in the payload, since that half is always a point query —
 * and a ring this module decimated by up to 96% must not be allowed to
 * contradict it. Measured at Ustaritz: the point the service answers `UB` for
 * falls outside the drawn `UB` ring, because a straightened edge cut across it.
 * The second is what a click MEANS: the marker glyph is 26 px, and at the
 * altitudes this layer works at — 900 m gives roughly a metre per pixel — 30 m
 * is "the operator clicked the marker's own patch of ground".
 */
export const GPU_REGISTER_RADIUS_M = 30;

/**
 * Longest line a ground card composes, in characters.
 *
 * A CARD IS EXACTLY AS WIDE AS ITS LONGEST DETAIL. The overlay neither wraps
 * nor truncates — measured in `worldOverlayDraw.js`, the box is the widest of
 * its title and details plus padding — so the one unbounded line here, the
 * list of easement families, is also the one that can push the card across two
 * thirds of the screen: Paris 13e answers "Abords d'un monument historique"
 * and "Plan de prévention des risques (naturels ou technologiques)" at the
 * same address, 108 characters together.
 *
 * The bound is not a taste call. It is the widest sentence this layer ALREADY
 * has to fit — the closed-à-urbaniser explanation, which every card over an
 * `AUs` zone shows anyway — so a ground card is never wider than the layer's
 * own existing worst case.
 */
const GROUND_CARD_MAX_LINE_CHARS = Math.max(
  ...Object.values(ZONE_FAMILY_SENTENCES).map((sentence) => sentence.length),
);

/**
 * Rows a ground card may fill.
 *
 * Not a preference: `createAddressScanOverlayEntry` keeps the first six
 * details and silently drops the rest, so a card that composes seven loses its
 * last line — which, in the order these are written, is the one saying the
 * outline the answer came from is simplified.
 */
const GROUND_CARD_MAX_DETAILS = 6;

/**
 * Whether a point falls inside the box the zoning half was asked for.
 * @param {?{south:number, west:number, north:number, east:number}} box
 * @param {number} lon
 * @param {number} lat
 * @returns {?boolean} Null when there was no box — the point regime, where the
 *   zoning answer covers the scan point and nothing else.
 */
export function insideScanBox(box, lon, lat) {
  if (!box || !Number.isFinite(box.south)) return null;
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

/**
 * What this layer knows about one point of ground, out of the answer in hand.
 *
 * Pure, and deliberately so: it is the whole of the click behaviour, it has
 * four regimes to get right, and none of them is observable in a screenshot.
 *
 * @param {?object} payload The projected GPU answer currently drawn.
 * @param {number} lon
 * @param {number} lat
 * @param {?{lat:number, lon:number}} [scanPoint] Where the register was asked.
 * @returns {?object} Null when there is no answer to read.
 */
export function gpuAnswerAt(payload, lon, lat, scanPoint = null) {
  if (!payload || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const zones = payload.zones || [];
  const servitudes = payload.servitudes || [];
  const fromRegister = Number.isFinite(scanPoint?.lat) && Number.isFinite(scanPoint?.lon)
    && greatCircleKm(scanPoint.lat, scanPoint.lon, lat, lon) * 1000 <= GPU_REGISTER_RADIUS_M;
  const registerZones = zones.filter((zone) => zone.atPoint);
  // The register first where it has spoken, the drawn map everywhere else.
  const answerZones = fromRegister && registerZones.length
    ? registerZones
    : zones.filter((zone) => pointInPolygons(zone.parts, lon, lat));
  // Under a point query every servitude returned reaches that point BY
  // CONSTRUCTION — the service selected them with it — so at the scan point
  // they are all reported, decimation and dropped pieces notwithstanding.
  const answerServitudes = fromRegister
    ? servitudes
    : servitudes.filter((entry) => pointInPolygons(entry.parts, lon, lat));
  return {
    lon,
    lat,
    zones: answerZones,
    servitudes: answerServitudes,
    fromRegister,
    // Whether the zoning half was ever asked about this ground. `false` and
    // "no zone here" are completely different answers and the card says which.
    insideBox: insideScanBox(payload.box, lon, lat),
    regime: payload.regime ?? 'point',
    // How many easements the register returned for the scan point, so an
    // absence can name what was actually checked.
    servitudesScanned: servitudes.length,
    zoningRefused: payload.zoningRefused ?? null,
    simplified: [...answerZones, ...answerServitudes].some((entry) => entry.simplified),
  };
}

/**
 * The easement half of a ground card, in one sentence.
 *
 * THE ABSENCES ARE THREE DIFFERENT SENTENCES AND THAT IS THE POINT. "No
 * easement here" is a strong claim from a layer whose reason to exist is that
 * the state has quietly encumbered ground, and it is only true where the
 * register was asked. Everywhere else the honest answer names what WAS checked
 * — the easements returned for the marker — and says the question was never
 * put for this spot.
 * @param {object} answer
 * @returns {string}
 */
export function servitudeSentence(answer) {
  const found = answer?.servitudes || [];
  if (found.length) {
    const labels = [...new Set(found.map((entry) => entry.label || entry.code).filter(Boolean))];
    const head = `${found.length} servitude${found.length > 1 ? 's' : ''} ici`;
    // Named until the line reaches the layer's own widest sentence, then
    // counted. The first family is always named even when it alone overruns:
    // "et 5 autres" on its own names nothing at all.
    const named = [];
    let width = head.length + 2;
    for (const label of labels) {
      if (named.length && width + label.length + 2 > GROUND_CARD_MAX_LINE_CHARS) break;
      named.push(label);
      width += label.length + 2;
    }
    const rest = labels.length - named.length;
    return `${head} : ${named.join(', ')}`
      + (rest > 0 ? ` et ${rest} autre${rest > 1 ? 's' : ''}` : '');
  }
  if (answer?.fromRegister) return 'aucune servitude à ce point';
  if (answer?.servitudesScanned) {
    // "du repère" carries the whole caveat: these are the easements the
    // register returned for the marker, and they are the only ones that have
    // been looked for anywhere.
    return `aucune des ${answer.servitudesScanned} servitudes du repère n'atteint ce point`;
  }
  return 'aucune servitude relevée au repère — elles ne sont interrogées qu\'au repère';
}

/**
 * The easement half of a ground card, as one line or as a short list.
 *
 * ONE LINE IS THE DEFAULT AND A LIST IS THE FALLBACK, which is the opposite of
 * how it reads. A card of six short lines is a card; a card of three lines one
 * of which runs 108 characters is a banner, because the overlay sizes the box
 * on its widest line. So the families go one per line exactly when naming them
 * on a single line would be too wide — and only while the card has rows to
 * spare, since `createAddressScanOverlayEntry` keeps six and the ones this
 * would push off are the zone's own.
 *
 * @param {object} answer
 * @param {number} [budget] Rows this half may use.
 * @returns {string[]}
 */
export function servitudeLines(answer, budget = 3) {
  const sentence = servitudeSentence(answer);
  const found = answer?.servitudes || [];
  const labels = [...new Set(found.map((entry) => entry.label || entry.code).filter(Boolean))];
  const head = `${found.length} servitude${found.length > 1 ? 's' : ''} ici`;
  const oneLine = `${head} : ${labels.join(', ')}`;
  // Rows for the families themselves, the count line taken off the top. Under
  // two there is no list worth making, and the counted sentence already fits.
  const room = budget - 1;
  if (labels.length < 2 || room < 2 || oneLine.length <= GROUND_CARD_MAX_LINE_CHARS) {
    return [sentence];
  }
  if (labels.length <= room) return [`${head} :`, ...labels.map((label) => `· ${label}`)];
  const shown = labels.slice(0, room - 1);
  const rest = labels.length - shown.length;
  return [
    `${head} :`,
    ...shown.map((label) => `· ${label}`),
    `· et ${rest} autre${rest > 1 ? 's' : ''}`,
  ];
}

/**
 * Why a point has no zoning, which is never just "it has none".
 *
 * Four reasons, and only one of them is about the ground: the answer was
 * refused whole, the box never covered this spot, the camera is high enough
 * that only the marker was asked about, or the published document genuinely
 * stops here. A card that printed "aucun zonage" for all four would report
 * three of this layer's own limits as facts about the plot.
 * @param {object} answer
 * @returns {{title: string, detail: ?string}}
 */
export function zoningGapSentence(answer) {
  /** Grouped the way France writes a number: 1 500, not 1500. */
  const grouped = (value) => Number(value).toLocaleString('fr-FR');
  if (answer?.zoningRefused) {
    return {
      title: 'Zonage non dessiné',
      detail: `${grouped(answer.zoningRefused.found)} zones dans ce cadre, au-delà des `
        + `${grouped(answer.zoningRefused.limit)} que le service renvoie — rapprochez-vous`,
    };
  }
  if (answer?.insideBox === false) {
    return {
      title: 'Hors du bloc interrogé',
      detail: 'le zonage n\'a été demandé que pour le bloc dessiné — recentrez la vue sur ce point',
    };
  }
  if (answer?.insideBox === null) {
    return {
      title: 'Zonage non interrogé ici',
      detail: `au-dessus de ${grouped(GPU_BOX_MAX_ALTITUDE_M)} m le zonage n'est demandé`
        + ' que pour le repère',
    };
  }
  return {
    title: 'Aucun zonage à ce point',
    detail: 'le bloc a bien été interrogé : le document publié ne couvre pas ce point',
  };
}

/**
 * The card for a click on bare ground.
 *
 * Signature is the shell's `groundCard` contract — see `addressScanLayer.js`.
 * @param {{payload: object, lon: number, lat: number, point: ?object}} context
 * @returns {?{title: string, details: string[]}}
 */
export function gpuGroundCard({
  payload, lon, lat, point = null,
} = {}) {
  const answer = gpuAnswerAt(payload, lon, lat, point);
  if (!answer) return null;
  const zone = answer.zones[0] || null;
  const gap = zone ? null : zoningGapSentence(answer);
  const overlapping = answer.zones.length;
  // The zone's own rows, decided first: the easements then take what is left of
  // the six the overlay paints, rather than pushing the rule off the card.
  const family = zone ? zoneFamilySentence(zone.kind) : null;
  const rest = [
    // The register contradicting itself, at the point the operator asked about
    // rather than at the marker: two communes digitise their shared limit
    // independently and the Géoportail stacks both documents.
    overlapping > 1
      ? `${overlapping} zonages se superposent ici — deux communes, deux tracés de la limite`
      : null,
    gap?.detail ?? null,
    zone
      ? [
        zone.approvedOn ? `PLU approuvé le ${zoneApprovalDate(zone.approvedOn)}` : null,
        zone.regulationFile,
      ].filter(Boolean).join(' · ') || null
      : null,
    // Said here rather than in the header because THIS is where it bites: the
    // answer above was read off a decimated outline, and near a limit that
    // outline is wrong by exactly the tolerance the layer declares.
    answer.simplified && !answer.fromRegister
      ? 'contours simplifiés — près d\'une limite, c\'est le document qui fait foi'
      : null,
  ].filter(Boolean);
  const servitudes = servitudeLines(
    answer,
    GROUND_CARD_MAX_DETAILS - rest.length - (family ? 1 : 0),
  );
  return {
    title: zone
      ? `${zone.code || 'Zone'} — ${zone.label || 'zonage PLU'}`
      : gap.title,
    details: [family, ...servitudes, ...rest].filter(Boolean),
  };
}

/**
 * The box this scan should ask for, or null to ask about the point.
 *
 * The gate is the camera's ALTITUDE, not the span of the view rectangle, and
 * the cadastre layer paid for that distinction: `computeViewRectangle` on a
 * TILTED camera reaches the horizon, so gating on its span refuses the layer at
 * street level on exactly the oblique view this globe defaults to.
 *
 * @param {?{lat:number, lon:number, altitudeM:number}} point Scan centre.
 * @param {?object} viewer
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function gpuScanBox(point, viewer) {
  if (!Number.isFinite(point?.altitudeM) || point.altitudeM > GPU_BOX_MAX_ALTITUDE_M) return null;
  // The shared `cameraViewBox`, the same arithmetic the view gate solves its
  // flights against, so the box asked for and the box a flight is planned from
  // cannot drift apart.
  return focusedViewBox(cameraViewBox(viewer), point, GPU_MAX_BOX_DEG);
}

/**
 * Query parameters for one scan: the bbox when there is one, nothing when
 * there is not. An absent box IS the point regime, server-side.
 * @param {object} point
 * @param {?object} viewer
 * @returns {Record<string, string>}
 */
export function gpuScanParams(point, viewer) {
  const box = gpuScanBox(point, viewer);
  if (!box) return {};
  return {
    south: box.south.toFixed(6),
    west: box.west.toFixed(6),
    north: box.north.toFixed(6),
    east: box.east.toFixed(6),
  };
}

const urbanismeGpuLayer = createAddressScanLayer({
  id: 'urbanisme-gpu',
  name: 'Urbanisme (PLU & servitudes)',
  icon: '▦',
  source: 'Géoportail de l\'urbanisme — IGN',
  endpoint: '/api/gpu',
  updateInterval: UPDATE_INTERVAL_MS,
  params: gpuScanParams,
  // The wash is ground-classification geometry and a classification type is
  // read once, when the primitive is built. Switching from IGN ortho to the
  // Google photoreal tileset hides the globe, and a wash built for TERRAIN
  // then draws nothing — the layer looks switched off. Redrawing is what keeps
  // it on the ground the operator just chose.
  redrawOnMapStack: true,
  // A click anywhere on this layer's ground is a question about that ground.
  // The only layer of the six that answers one, because it is the only one
  // whose subject IS the ground: the other four describe things standing on it
  // — a sale, a diagnostic, a hazard record — and those have addresses.
  groundCard: gpuGroundCard,

  /**
   * The key to the ground wash.
   *
   * This layer paints eight zoning families in eight hues, plus a dashed red
   * servitude outline with no fill, and carried no legend at all — hue was
   * doing all the work with nothing to decode it. Tallied over the zones
   * ACTUALLY DRAWN in this scan, in descending order, so the key never lists a
   * family that is not on screen.
   *
   * `surfaceFill` marks it as a ground-classified area wash, so the manager
   * adds the shared note about the drape over the photorealistic mesh.
   * @param {{zones?: Array<object>, servitudes?: Array<object>}} payload Drawn scan payload.
   * @returns {{legend: Array<object>, surfaceFill: boolean}}
   */
  rowControls(payload) {
    const byKind = new Map();
    for (const zone of payload.zones || []) {
      const kind = String(zone?.kind || '').toUpperCase() || '?';
      byKind.set(kind, (byKind.get(kind) || 0) + 1);
    }
    const legend = [...byKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => ({
        label: kind === '?' ? 'Famille non publiée' : kind,
        color: zoneColorCss(kind),
        count,
        // The national grammar, which IS standard across communes — the one
        // part of a PLU that can be spelled out without inventing.
        blurb: zoneFamilySentence(kind)
          || 'Le registre publie une lettre que cette grammaire ne connaît pas — '
            + 'la zone est dessinée, pas expliquée.',
      }));
    const servitudes = (payload.servitudes || []).length;
    if (servitudes) {
      legend.push({
        label: 'Servitude d’utilité publique',
        color: SERVITUDE_COLOR,
        count: servitudes,
        blurb: 'Contour tireté, sans aplat : une seule enveloppe mesurée fait '
          + '759 polygones sur des kilomètres, et la remplir teinterait la vue '
          + 'au lieu d’une parcelle.',
      });
    }
    return { legend, surfaceFill: true };
  },

  render({ payload, dataSource, point, viewer }) {
    const classificationType = gpuClassificationTypeForScene(viewer?.scene);
    let drawn = 0;
    const zones = payload.zones || [];
    // The zone under the operator's own feet, which under a box is one of
    // many. `projectZones` already sorted it first, but reading the flag says
    // what is meant instead of trusting an order.
    const here = zones.filter((entry) => entry.atPoint);
    const zone = here[0] || null;
    const servitudes = payload.servitudes || [];
    const enclaves = zones.reduce((sum, entry) => sum + (entry.holes || 0), 0);
    const boxed = payload.regime === 'box';
    if (point && (zone || zones.length || servitudes.length)) {
      dataSource.entities.add({
        id: 'gpu:scan-point',
        position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
        billboard: {
          // A PLAN SHEET. A zoning rule is a drawing ABOUT ground rather than
          // an object standing on it, and the sheet is what tells this marker
          // apart from the euro, the DPE badge and the hazard triangle that
          // land on the same address.
          image: addressMarkerGlyph('plan'),
          width: 26,
          height: 26,
          color: Cesium.Color.fromCssColorString(zoneColorCss(zone?.kind)),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { kind: 'plu-scan-point' },
        name: zone ? `${zone.code || 'Zone'} — ${zone.label || 'zonage PLU'}` : 'Servitudes à cette adresse',
        description: [
          zoneFamilySentence(zone?.kind),
          zone?.approvedOn ? `PLU approuvé le ${zoneApprovalDate(zone.approvedOn)}` : null,
          zone?.regulationFile,
          // The register contradicting itself, said plainly. Two communes
          // digitise their shared limit independently and the Géoportail
          // stacks both documents, so the strip between the two versions of
          // the boundary carries two zonings. Measured around Ustaritz: 17 of
          // 34 126 sampled points, every one at a commune limit.
          here.length > 1
            ? `${here.length} zonages se superposent ici — deux communes ne placent pas leur limite au même endroit`
            : null,
          // What is on screen BESIDES the answer, so a map of fifty polygons
          // is not mistaken for fifty answers about this address.
          boxed && zones.length > here.length
            ? `${zones.length - here.length} autres zones autour, dans le bloc`
            : null,
          // Said out loud because the reader is about to see unpainted islands
          // inside a painted zone and deserves to know they are the register's,
          // not a gap in the draw.
          enclaves
            ? `${enclaves} enclave${enclaves > 1 ? 's' : ''} découpée${enclaves > 1 ? 's' : ''} — un autre zonage s'y applique`
            : null,
          payload.zoningRefused
            ? `zonage non dessiné : ${payload.zoningRefused.found} zones dans ce cadre, au-delà des ${payload.zoningRefused.limit} que le service renvoie`
            : null,
          servitudes.length
            ? `${servitudes.length} servitude${servitudes.length > 1 ? 's' : ''} : `
              + [...new Set(servitudes.map((entry) => entry.label))].join(', ')
            : 'aucune servitude relevée',
          servitudes.some((entry) => entry.simplified)
            ? 'contours simplifiés pour l\'affichage — voir le règlement' : null,
        ].filter(Boolean).join(' · '),
      });
      drawn += 1;
    }
    for (const entry of zones) {
      // The code, written on the ground, the way the paper document does it.
      // Without it a block of fifty polygons is a colour chart: the FAMILY is
      // legible from the hue, but `UB` against `UYc` — both orange, one
      // residential and one industrial — is not.
      if (entry.anchor && entry.anchor.widthDeg >= ZONE_LABEL_MIN_WIDTH_DEG && entry.code) {
        dataSource.entities.add({
          id: `gpu:zone:${entry.id}:label`,
          position: Cesium.Cartesian3.fromDegrees(entry.anchor.lon, entry.anchor.lat),
          // The zone's own card, so clicking the code opens the rule. This is
          // also the only PICKABLE thing a zone has: clamped polylines are
          // ground primitives and `scene.pick` returns null on them, measured
          // at every one of 62 vertices of a ring on screen.
          name: `${entry.code} — ${entry.label || 'zonage PLU'}`,
          description: zoneDescription(entry),
          properties: { kind: 'plu-zone-label', zoneKind: entry.kind },
          label: {
            text: entry.code,
            font: 'bold 13px "Roboto Mono", monospace',
            fillColor: Cesium.Color.fromCssColorString(zoneColorCss(entry.kind)),
            // Black, not a lighter outline: it survives over both a pale
            // orthophoto and the dark end of the wash, and it is the same
            // discipline the marker glyphs use.
            outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // Fade out where the zone is too small on screen to hold text,
            // rather than piling codes on top of each other over a city.
            scaleByDistance: new Cesium.NearFarScalar(500, 1.0, 6000, 0.55),
            translucencyByDistance: new Cesium.NearFarScalar(3000, 1.0, 9000, 0.0),
          },
        });
      }
      drawn += drawGpuParts(dataSource, `gpu:zone:${entry.id}`, entry.parts, {
        css: zoneColorCss(entry.kind),
        fillAlpha: zoneFillAlpha(entry.kind),
        width: ZONE_OUTLINE_WIDTH_PX,
        dashed: false,
        classificationType,
        name: `${entry.code || 'Zone'} — ${entry.label || 'zonage PLU'}`,
        properties: { kind: 'plu-zone', zoneKind: entry.kind, simplified: entry.simplified },
        description: zoneDescription(entry),
      });
    }
    for (const servitude of payload.servitudes || []) {
      drawn += drawGpuParts(dataSource, `gpu:sup:${servitude.id}`, servitude.parts, {
        css: SERVITUDE_COLOR,
        // No wash. See the module header: one measured envelope is 759
        // polygons spanning kilometres, and a wash of it tints the view rather
        // than a plot.
        fillAlpha: 0,
        width: LOUD_SUP_CODES.has(servitude.code) ? 5 : 4,
        dashed: true,
        classificationType,
        name: servitude.label || servitude.code || 'Servitude',
        properties: {
          kind: 'servitude',
          code: servitude.code,
          simplified: servitude.simplified,
          regulationUrl: servitude.regulationUrl,
        },
        description: [
          servitude.name,
          servitude.assietteType,
          servitude.bufferM ? `zone tampon de ${servitude.bufferM} m` : null,
          // Two different simplifications, said apart. A dropped PIECE is a
          // part of the envelope that is not on screen at all; a decimated
          // ring is the whole shape, drawn straighter. Reporting "1/1 pièces"
          // for a shape that lost only vertices would name the wrong loss.
          servitude.servedParts < servitude.sourceParts
            ? `${servitude.servedParts} des ${servitude.sourceParts} pièces de l'emprise dessinées`
            : null,
          servitude.simplified
            ? `contour simplifié (${servitude.sourceVertices} sommets à l'amont)`
            : null,
          servitude.regulationUrl ? `règlement : ${servitude.regulationUrl}` : null,
        ].filter(Boolean).join(' · '),
      });
    }
    return drawn;
  },

  summarize(payload) {
    const servitudes = payload.servitudes || [];
    const zones = payload.zones || [];
    const here = zones.filter((zone) => zone.atPoint);
    return {
      // The zones under the operator, not everything on screen. Under a box
      // `zones` is a neighbourhood, and a row reading "52 zones" would say the
      // address has 52 zonings.
      zones: here.map((zone) => ({
        code: zone.code, kind: zone.kind, label: zone.label, approvedOn: zone.approvedOn,
      })),
      // Which question was answered. `zoneCount` alone cannot tell "one zone
      // here" from "one zone in the whole block".
      regime: payload.regime ?? 'point',
      // More than one zone for ONE point is not a bug here and is worth
      // reporting: two communes digitise their shared limit independently and
      // the Géoportail stacks both documents without reconciling them, so the
      // strip between the two versions of the boundary carries two zonings.
      zoneCount: here.length,
      // Everything drawn, including the neighbours.
      zonesDrawn: zones.length,
      // A zoning half refused rather than truncated. See `gpuFeed.js`.
      zoningRefused: payload.zoningRefused ?? null,
      // Ground inside a drawn zone that the same document zones otherwise.
      enclaves: zones.reduce((sum, zone) => sum + (zone.holes || 0), 0),
      servitudeCount: servitudes.length,
      servitudeCodes: servitudes.map((entry) => entry.code).filter(Boolean),
      // The families a buyer would want named out loud rather than counted.
      notableServitudes: servitudes
        .filter((entry) => LOUD_SUP_CODES.has(entry.code))
        .map((entry) => entry.label),
      // True when any outline on screen is a decimation, not a boundary.
      simplified: [...zones, ...servitudes].some((entry) => entry.simplified),
      available: payload.available ?? null,
    };
  },
});

export default urbanismeGpuLayer;
