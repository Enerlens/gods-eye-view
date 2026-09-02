import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, resolveGroundFloorCellsBounded } from './groundFloor.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { pickOverlayLabelId } from './overlayLabelPick.js';
import {
  FAMILY_BY_KEY,
  FAMILY_KEYS,
  POSTE_TYPES,
  STATION_CLASSES,
  STATION_CLASS_ORDER,
  STATION_PACKS,
  compassPoint,
  describeInstruments,
} from './meteoStationsFrFeed.js';

/**
 * Stations météo (FR) — where France measures the weather, and what each
 * instrument can actually tell you.
 *
 * This layer exists because the globe already showed the weather three times —
 * Open-Meteo's conditions in the cockpit, Météo-France's vigilance colours per
 * département, Vigicrues on the rivers — and never once showed **where the
 * numbers come from**. A vigilance map is an interpretation of readings taken
 * somewhere; this is the somewhere.
 *
 * **2 144 stations** in Météo-France's real-time observation network, 1 818 in
 * metropolitan France and 326 overseas, from the tide line to the Aiguille du
 * Midi at 3 845 m — the highest weather station in the country, with La
 * Meije-Nivôse at 3 093 m and Bellecôte-Nivôse at 2 992 m behind it.
 *
 * ── What a marker means, and why they are not all the same colour ───────────
 *
 * A reader turning this layer on expects 2 144 identical instruments, each
 * knowing the temperature, the wind, the pressure and the humidity. That is not
 * what France has. Measured against Météo-France's own per-station inventory:
 *
 *   **1 254 of the 2 144 — 58 % — measure temperature and rain, and nothing
 *   else.** 565 add the wind. Only **228** measure the five parameters the word
 *   "weather station" means to a reader, and only **845 of 2 144 can tell you
 *   which way the wind is blowing at all.** 234 have a barometer.
 *
 * So colour is capability, not decoration: it is the answer to "can this dot
 * tell me what I am about to ask it". Size is the number of instrument families
 * the station carries, one to fourteen, so a station that measures the sea
 * state, the road surface and the snow depth reads as the instrument it is.
 * The card names every family in words, because colour alone must never carry
 * the meaning.
 *
 * ── The live half: 190 stations publish, and the list says 62 ───────────────
 *
 * A **ring** around a marker means that station's readings are published in the
 * open, and clicking it fetches the last hour's observation — temperature, wind,
 * gust, pressure, humidity, rain, visibility, snow. There are **190 of them**,
 * and Météo-France's own *liste des stations SYNOP* names **62**: Boulogne, Le
 * Touquet, Dunkerque, Dieppe, Beauvais-Tillé, Ouessant-Stiff and 123 others
 * publish hourly without appearing on the list that is supposed to name them.
 * The list is wrong the other way too — **CAP CEPET is named and has written
 * nothing all year** — so the layer counts what the archive contains, never what
 * the list claims. See trap 3 in `meteoStationsFrFeed.js`.
 *
 * The other 1 954 stations are measuring right now and publishing nothing a
 * visitor can read without a Météo-France API key. The card says that plainly
 * rather than showing an empty reading, because "no data here" and "this station
 * does not publish" are different sentences.
 *
 * ── Honesty rules this layer is built around ────────────────────────────────
 *
 * • **Seven stations in the live list are closed.** MARSILLARGUES since
 *   2026-01-01, DESHAIES GENDARMERIE since 2024-10-01, ST JOSEPH-CIRAD and TAN
 *   ROUGE-CIRAD since 2023-03-29, DEMBENI and MAMOUDZOU_SAPC since 2025-04-01,
 *   BASSE-TERRE GUILLARD since 2026-02-11. Météo-France's own metadata says so
 *   and its own real-time list still carries them. They are drawn hollow and the
 *   card leads with the closure date — dropping them would hide a fact about the
 *   network under a tidier map.
 *
 * • **Six stations have no published inventory at all.** ALBA LA ROMAINE,
 *   SOULAINES, TARASCON, PIOGGIOLA, QUERCITELLO and MURAT SUR VEBRE appear in
 *   the real-time list and in no metadata file. They are drawn in the neutral
 *   grey this project uses for "the publisher did not say", never as stations
 *   that measure nothing.
 *
 * • **This is the real-time network, not the register.** France has 14 751
 *   climatological postes back to 1806, of which 2 404 are open, plus 699
 *   *stations complémentaires* run by the DGPR, the DIR routes, the DREAL and
 *   EDF. None of them is drawn here. `getStats()` reports what is excluded.
 *
 * • **RADOME is the publisher's word, not a quality score.** 696 stations are
 *   in the reference network expertised at J+1 and 1 448 are not. The card says
 *   which; the layer does not rank them.
 *
 * The network is a shipped file — `local_data/meteo_stations_fr/stations.json`,
 * rebuilt with `npm run meteo:stations` — because the instrument inventory it
 * encodes lives in a 191 MB file no browser can fetch. See that script's header.
 */

const REGISTRY_URL = new URL('./local_data/meteo_stations_fr/stations.json', import.meta.url).href;

/** Layer id — also the share-link registry key. */
export const METEO_STATIONS_LAYER_ID = 'meteo-stations-fr';
/** Prefix for every render id this layer puts in the scene. */
export const METEO_STATIONS_RENDER_PREFIX = 'meteo-station:';
/** Ambient labels. */
export const METEO_STATIONS_OVERLAY_SOURCE_ID = 'meteo-stations-fr';
/** Selected-object card, on its own protected source. */
export const METEO_STATIONS_SELECTED_OVERLAY_SOURCE_ID = 'meteo-stations-fr-selected';
/**
 * Ambient-label entry-id prefix — the click surface a station's NAME provides.
 * Deliberately NOT `METEO_STATIONS_RENDER_PREFIX`: the label names the upstream
 * station id, the record map is keyed by the render id, and the click path
 * converts between them rather than assuming they are the same string.
 */
export const METEO_STATIONS_LABEL_PREFIX = 'meteo-station-label:';
/** 2 144 stations; the label cohort is the handful worth naming at a glance. */
export const METEO_STATIONS_OVERLAY_COHORT_LIMIT = 22;
/** Shared ambient-label paint budget, matching the sibling French sources. */
export const METEO_STATIONS_OVERLAY_COLLISION_CAPACITY = 16;

/** Live observations and per-station records, both keyless. See the proxy. */
export const OBSERVATIONS_ENDPOINT = '/api/meteo-stations/observations';
export const NORMALS_ENDPOINT = '/api/meteo-stations/normals';

/**
 * How long the browser holds one observation set before asking again.
 *
 * Five minutes, deliberately SHORTER than the proxy's own hour: a tab left open
 * across an hour boundary should pick up the new hour within five minutes of it
 * landing, and the extra requests are answered from the proxy's cache without
 * touching the 22 MB upstream. A failed fetch is cached for the same window, so
 * an outage costs one request every five minutes rather than one per click.
 */
export const OBSERVATIONS_CLIENT_TTL_MS = 300_000;

/**
 * Metres above the local ground the markers are drawn at.
 *
 * Weather stations sit where the terrain is most extreme in France — the
 * nivôses are above 2 900 m and the Aiguille du Midi is at 3 845 m — so an
 * unclamped marker is not merely low, it is in the wrong PLACE: a point drawn
 * at ellipsoidal zero under a 3 km peak slides across the map as the camera
 * pans, by `depth × tan(angle from the local vertical)`. Two metres of lift, so
 * the disc sits ON the surface rather than z-fighting it — the same treatment
 * `frHydroPlants.js` gives its markers, for the same reason and worse terrain.
 */
export const GROUND_LIFT_M = 2;

/** Above this camera height the clamp is not worth a network round trip. */
export const FLOOR_WARM_MAX_CAMERA_M = 200_000;

/** Never ask the terrain resolver for more than this many markers at once. */
export const FLOOR_WARM_MAX_POINTS = 250;

const SELECTED_COLOR = '#7ee8fa';
const COLOR_OUTLINE = Cesium.Color.fromCssColorString('#04121f');
/** The ring that says "this station's readings are public". */
const LIVE_RING_COLOR = '#e8f6ff';
/** A closed station: hollow, so it reads as an absence. */
const CLOSED_FILL_ALPHA = 0.12;

export const METEO_STATIONS_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/**
 * The filters the row's chips offer.
 *
 * RUNTIME filters, not build ones: the shipped file always holds the whole
 * network, so a chip hides markers rather than losing them, and the stats line
 * keeps reporting what was hidden. Each one answers a question a reader
 * actually arrives with, and the counts are what makes the layer's argument
 * visible — pressing VENT deletes 60 % of the map.
 */
export const METEO_STATION_FILTERS = Object.freeze([
  Object.freeze({ id: 'all', label: 'TOUT', test: null }),
  Object.freeze({
    id: 'wind', label: 'VENT', family: 'wind',
    test: (station) => station.fam?.includes('wind'),
  }),
  Object.freeze({
    id: 'pressure', label: 'PRESSION', family: 'pressure',
    test: (station) => station.fam?.includes('pressure'),
  }),
  Object.freeze({
    id: 'live', label: 'RELEVÉS', test: (station) => station.live === true,
  }),
]);

/**
 * Disc size in pixels, by how many instrument families the station carries.
 *
 * Linear, not a root scale: the range is 0 to 14, not four orders of magnitude,
 * and a reader comparing a two-family poste with a thirteen-family synoptic
 * station should see the ratio the number actually is. A station with no
 * published inventory takes the minimum — it is not small, it is unknown, and
 * the colour says so.
 */
export const STATION_PIXEL_MIN = 4;
export const STATION_PIXEL_MAX = 13;

/**
 * Pixel diameter for one station.
 * @param {{fam?: Array<string>|null}|null|undefined} station
 * @returns {number}
 */
export function stationPixelSize(station) {
  const families = Array.isArray(station?.fam) ? station.fam.length : 0;
  const span = STATION_PIXEL_MAX - STATION_PIXEL_MIN;
  return STATION_PIXEL_MIN + span * Math.min(1, families / FAMILY_KEYS.length);
}

/**
 * Marker colour for one station.
 * @param {{klass?: string}|null|undefined} station
 * @returns {Cesium.Color}
 */
export function stationColor(station) {
  const entry = STATION_CLASSES[station?.klass] || STATION_CLASSES.unknown;
  return Cesium.Color.fromCssColorString(entry.color);
}

/**
 * What to call a station on screen.
 *
 * The published `Nom_usuel` is already the usual name — `TOULOUSE-BLAGNAC`,
 * `AIGUILLE DU MIDI` — and is shown as published, in the register's own
 * uppercase. It is NOT title-cased: `ST QUENTIN`, `MAMOUDZOU_SAPC` and
 * `TAN ROUGE-CIRAD` are identifiers as much as names, and prettifying them
 * would make them stop matching the file a reader might go and check.
 * @param {object|null|undefined} station
 * @returns {string}
 */
export function stationDisplayName(station) {
  const name = String(station?.name ?? '').trim();
  if (name) return name;
  const commune = station?.commune ? ` à ${station.commune}` : '';
  return `Station météo${commune}`;
}

/**
 * Ambient label text for one station.
 *
 * Altitude is grouped the same way the card groups it — `3 845 m`, not
 * `3845 m` — because the label and the card are read one after the other and a
 * number that changed shape between them reads as a different number.
 */
export function stationLabelText(station) {
  const alt = Number.isFinite(station?.alt) ? ` · ${fr(station.alt)} m` : '';
  return `${stationDisplayName(station)}${alt}`;
}

/**
 * Format a French number without the narrow no-break spaces the terminal and
 * some fonts render as a box.
 * @param {number} value
 * @param {number} [digits]
 * @returns {string}
 */
function fr(value, digits = 0) {
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).replace(/[  ]/g, ' ');
}

/** `YYYY-MM-DD` as `DD/MM/YYYY`. */
function frDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/**
 * An ISO validity time as the hour a French reader would say.
 * @param {string|null|undefined} iso
 * @returns {string|null}
 */
export function formatObservationTime(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso ?? ''));
  if (!match) return null;
  return `${match[3]}/${match[2]} à ${match[4]} h ${match[5]} UTC`;
}

/**
 * The live-observation lines of a card, or null when there is no reading.
 *
 * Every value is optional independently: a station can publish a temperature
 * and no pressure in the same message, and a card that dropped the whole block
 * because one field was empty would hide the reading a reader came for. Wind is
 * converted to km/h beside the m/s the message carries, because the SYNOP
 * product is in metres per second and no French forecast ever is.
 * @param {object|null|undefined} observation
 * @returns {string[]}
 */
export function buildObservationLines(observation) {
  if (!observation) return [];
  const lines = [];
  const at = formatObservationTime(observation.at);
  const bits = [];
  if (Number.isFinite(observation.tempC)) bits.push(`${fr(observation.tempC, 1)} °C`);
  if (Number.isFinite(observation.humidity)) bits.push(`${fr(observation.humidity)} % HR`);
  if (Number.isFinite(observation.pressureHpa)) bits.push(`${fr(observation.pressureHpa, 1)} hPa`);
  if (bits.length) lines.push(`🌡 ${bits.join(' · ')}${at ? `  — ${at}` : ''}`);

  if (Number.isFinite(observation.windMs)) {
    // "de secteur OSO", not "de OSO": five of the sixteen compass points start
    // with a vowel sound in French — E, ESE, O, OSO, ONO — and would need an
    // elision the other eleven must not have. `secteur` is the standard French
    // meteorological phrasing and it is right for all sixteen.
    const point = compassPoint(observation.windDir);
    const gust = Number.isFinite(observation.gustMs)
      ? `, rafale ${fr(observation.gustMs * 3.6)} km/h`
      : '';
    lines.push(
      `💨 ${fr(observation.windMs * 3.6)} km/h${point ? ` de secteur ${point}` : ''}${gust}`,
    );
  }
  if (Number.isFinite(observation.rain1hMm)) {
    lines.push(observation.rain1hMm > 0
      ? `🌧 ${fr(observation.rain1hMm, 1)} mm sur la dernière heure`
      : '🌧 pas de pluie sur la dernière heure');
  }
  if (Number.isFinite(observation.snowM) && observation.snowM > 0) {
    lines.push(`❄ ${fr(observation.snowM * 100)} cm de neige au sol`);
  }
  if (Number.isFinite(observation.visibilityM)) {
    lines.push(`👁 visibilité ${fr(observation.visibilityM / 1000, 1)} km`);
  }
  return lines;
}

/**
 * The records line, from the station's fiche climatologique.
 *
 * The period is printed with the records and is not decoration: a record of
 * 39,2 °C means something different at a station open since 2004 than at one
 * open since 1947, and a card that gave the number without the window would
 * invite exactly that mistake. Toulouse-Blagnac's 42,4 °C stands against
 * observations back to 1947; Arbent's 39,2 °C against 2004.
 * @param {object|null|undefined} fiche
 * @returns {string[]}
 */
export function buildNormalsLines(fiche) {
  if (!fiche?.high || !fiche?.low) return [];
  const window = fiche.period ? ` — records établis sur ${fiche.period}` : '';
  return [
    `📈 record ${fr(fiche.high.value, 1)} °C en ${fiche.high.date}`
    + ` · ${fr(fiche.low.value, 1)} °C en ${fiche.low.date}${window}`,
  ];
}

/**
 * The card for one station.
 *
 * Ordered by what a reader wants first: what it measures, then what it is
 * reading right now, then where and what it is. The instrument line comes
 * before everything because it is the layer's whole argument — a reader who
 * clicks a dot expecting a thermometer and a barometer should learn within one
 * line which of the two is actually there.
 * @param {object} station
 * @param {{observation?: object|null, fiche?: object|null, pending?: boolean}} [live]
 * @returns {string} Newline-separated; the first line is the title.
 */
export function buildStationCard(station, live = {}) {
  const lines = [stationDisplayName(station)];

  if (station?.closed) {
    lines.push(
      `⚠ station FERMÉE le ${frDate(station.closed)} — toujours présente `
      + 'dans la liste temps réel de Météo-France',
    );
  }

  const { measures, missing } = describeInstruments(station?.fam);
  if (!Array.isArray(station?.fam)) {
    lines.push('⊘ inventaire non publié — cette station est absente des métadonnées Météo-France');
  } else if (measures.length) {
    lines.push(`◈ mesure ${measures.join(', ')}`);
    if (missing.length) lines.push(`⊘ ne mesure pas ${missing.join(', ')}`);
  } else {
    lines.push('⊘ aucun paramètre en cours de mesure au dernier inventaire publié');
  }

  if (live.observation) {
    lines.push(...buildObservationLines(live.observation));
  } else if (station?.live) {
    lines.push(live.pending === false
      ? '🌡 relevé public indisponible pour l’instant'
      : '🌡 relevé en cours de chargement…');
  } else {
    // Not "no data": the station is measuring, and the reading exists behind a
    // credential. Saying so is the difference between a gap and a paywall.
    lines.push('🔒 relevés non publiés en accès libre — API Météo-France sur clé');
  }

  if (live.fiche) lines.push(...buildNormalsLines(live.fiche));
  else if (station?.fiche && live.pending !== false) lines.push('📈 fiche climatologique en cours de chargement…');

  const place = [
    station?.commune,
    station?.place && station.place !== station.commune ? `lieu-dit ${station.place}` : null,
  ].filter(Boolean).join(', ');
  const where = `📍 ${place || '—'}${station?.dep ? ` (${station.dep})` : ''}`;
  lines.push(Number.isFinite(station?.alt) ? `${where} · ${fr(station.alt)} m` : where);

  const pack = station?.pack ? STATION_PACKS[station.pack] : null;
  if (pack) lines.push(`▣ pack ${pack.label} — ${pack.blurb}`);
  if (Number.isFinite(station?.type) && POSTE_TYPES[station.type]) {
    lines.push(`▸ ${POSTE_TYPES[station.type]}`);
  }
  if (station?.opened) lines.push(`🕐 ouverte depuis le ${frDate(station.opened)}`);
  if (station?.omm) {
    lines.push(station.live
      ? `# indicatif OMM ${station.omm} · poste ${station.id}`
      : `# indicatif OMM ${station.omm} (non publié en SYNOP) · poste ${station.id}`);
  } else {
    lines.push(`# poste ${station.id}`);
  }
  return lines.join('\n');
}

/**
 * The legend for what is currently drawn.
 * @param {Array<object>} stations Visible stations.
 * @returns {Array<object>}
 */
export function stationLegend(stations) {
  const tally = new Map();
  let live = 0;
  let closed = 0;
  for (const station of stations) {
    const key = station?.klass || 'unknown';
    tally.set(key, (tally.get(key) || 0) + 1);
    if (station?.live) live += 1;
    if (station?.closed) closed += 1;
  }
  const legend = [];
  for (const key of STATION_CLASS_ORDER) {
    const count = tally.get(key);
    if (!count) continue;
    const style = STATION_CLASSES[key];
    legend.push({ label: style.label, color: style.color, count, blurb: style.blurb });
  }
  if (live) {
    legend.push({
      label: 'Anneau = relevés publics',
      color: LIVE_RING_COLOR,
      count: live,
      blurb: 'Observation horaire lisible sans clé. Météo-France en liste 62 ; '
        + 'son archive en contient 190, et la couche compte l’archive.',
    });
  }
  if (closed) {
    legend.push({
      label: 'Disque creux = station fermée',
      color: STATION_CLASSES.unknown.color,
      count: closed,
      blurb: 'Fermée selon les métadonnées Météo-France, toujours listée dans '
        + 'son réseau temps réel. Conservée et signalée, jamais supprimée en silence.',
    });
  }
  return legend;
}

/**
 * One station as the analyst panel reads it.
 * @param {object} station
 * @param {number} [index]
 * @returns {object}
 */
export function mapStationAnalystRecord(station, index = 0) {
  const text = (value) => { const t = String(value ?? '').trim(); return t || null; };
  const num = (value) => (Number.isFinite(value) ? value : null);
  return {
    id: text(station?.id) || `METEO-${String(index).padStart(4, '0')}`,
    name: text(station?.name),
    kind: 'weather-station',
    // Null, not an empty array: an analyst asking "which stations have no
    // published inventory" must be able to test for absence, and a station
    // that measures nothing is a different answer from one nobody documented.
    instruments: Array.isArray(station?.fam) ? station.fam.slice() : null,
    instrumentCount: Array.isArray(station?.fam) ? station.fam.length : null,
    stationClass: text(station?.klass),
    measuresWind: Array.isArray(station?.fam) ? station.fam.includes('wind') : null,
    measuresPressure: Array.isArray(station?.fam) ? station.fam.includes('pressure') : null,
    publishesOpenly: station?.live === true,
    listedAsSynop: station?.synop === true,
    wmoId: text(station?.omm),
    pack: text(station?.pack),
    posteType: num(station?.type),
    commune: text(station?.commune),
    departement: text(station?.dep),
    altitudeM: num(station?.alt),
    opened: text(station?.opened),
    closed: text(station?.closed),
    lat: num(station?.lat),
    lon: num(station?.lon),
  };
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
  hitTest: hitTestWorldOverlay,
});

/**
 * @param {object} [options]
 * @returns {object} Data-manager layer module.
 */
export function createMeteoStationsFranceLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  registryUrl = REGISTRY_URL,
  // Injected so the lifecycle can be exercised headless: Vite serves this file
  // over HTTP in the browser, and Node's `fetch` refuses the `file:` URL the
  // test resolves to.
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  let _viewer = null;
  let _points = null;
  let _clickHandler = null;
  let _registry = null;
  let _stations = [];
  let _visible = [];
  let _records = new Map();
  let _selectedId = null;
  let _enabled = false;
  let _loading = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _filterId = 'all';
  let _rowControlsListener = null;
  let _labelEntries = [];
  let _cameraRemovers = [];
  let _floorToken = 0;
  /** WMO id → last observation. Fetched once per hour, for every live station. */
  let _observations = null;
  let _observationsAt = null;
  let _observationsInflight = null;
  /** Poste id → parsed fiche climatologique (or null when it has none). */
  const _normals = new Map();

  const renderId = (id) => `${METEO_STATIONS_RENDER_PREFIX}${id}`;

  function markerPosition(lat, lon) {
    const floor = cachedGroundFloor(lat, lon);
    return Cesium.Cartesian3.fromDegrees(
      lon, lat, (Number.isFinite(floor) ? floor : 0) + GROUND_LIFT_M,
    );
  }

  function applyFilter() {
    const filter = METEO_STATION_FILTERS.find((entry) => entry.id === _filterId);
    _visible = filter?.test ? _stations.filter((station) => filter.test(station)) : _stations;
  }

  function repaint() {
    if (!_points) return;
    // Everything a clamp pass was about to write into belongs to the
    // collection this line destroys.
    _floorToken += 1;
    _points.removeAll();
    _records = new Map();
    const entries = [];

    for (const station of _visible) {
      const position = markerPosition(station.lat, station.lon);
      const id = renderId(station.id);
      const color = stationColor(station);
      const pixelSize = stationPixelSize(station);
      // A live station gets a pale ring; a closed one is drawn hollow so it
      // reads as an absence rather than as one more working instrument.
      const outlineColor = station.live
        ? Cesium.Color.fromCssColorString(LIVE_RING_COLOR)
        : COLOR_OUTLINE;
      const point = _points.add({
        position,
        pixelSize,
        color: station.closed ? color.withAlpha(CLOSED_FILL_ALPHA) : color,
        outlineColor: station.closed ? color : outlineColor,
        outlineWidth: station.live ? 1.6 : 1,
        scaleByDistance: new Cesium.NearFarScalar(20_000, 1.25, 3_000_000, 0.5),
        translucencyByDistance: new Cesium.NearFarScalar(20_000, 1, 5_000_000, 0.3),
        disableDepthTestDistance: 5000,
        id,
      });
      const record = {
        id,
        point,
        position,
        subject: station,
        baseColor: station.closed ? color.withAlpha(CLOSED_FILL_ALPHA) : color,
        baseOutline: station.closed ? color : outlineColor,
        basePixelSize: pixelSize,
        degrees: { lat: station.lat, lon: station.lon },
        floorResolved: Number.isFinite(cachedGroundFloor(station.lat, station.lon)),
      };
      _records.set(id, record);
      record.labelEntry = {
        id: `${METEO_STATIONS_LABEL_PREFIX}${station.id}`,
        position,
        degrees: { lat: station.lat, lon: station.lon },
        variant: 'label',
        title: stationLabelText(station),
        accent: color.toCssColorString(),
        // The stations worth naming at a glance are the ones that can answer
        // the most, then the ones that publish — an instrument count, not an
        // altitude, so the label cohort tracks the layer's own argument.
        priority: (Array.isArray(station.fam) ? station.fam.length : 0) * 10
          + (station.live ? 5 : 0),
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: true,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 13,
        verticalOnly: true,
        placement: 'above',
      };
      entries.push(record.labelEntry);
    }

    _labelEntries = entries;
    publishOverlay();
    if (_selectedId && _records.has(_selectedId)) selectObject(_selectedId);
    governorRequestRender('meteo-stations-repaint');
  }

  /**
   * Publish the ambient labels for what is ON SCREEN.
   *
   * The cohort is drawn from the stations inside the current view rectangle,
   * not from the national set: handing the host all 2 144 entries would let the
   * Aiguille du Midi and a handful of thirteen-instrument synoptic stations
   * hold the label budget from four hundred kilometres away, and zooming into
   * the Cantal would show twenty unlabelled dots. Falling back to everything
   * when the camera cannot produce a rectangle is right for exactly the case
   * where the national top 22 IS the answer — a full-globe view.
   */
  function publishOverlay() {
    if (!_enabled) {
      overlayHost.clearSource(METEO_STATIONS_OVERLAY_SOURCE_ID);
      return;
    }
    const inView = viewportFilter();
    const entries = inView ? _labelEntries.filter((entry) => inView(entry)) : _labelEntries;
    // Fall through to the ground clamp: what is on screen is exactly what is
    // worth pulling onto the terrain, and this is where that set is known.
    void clampVisibleToGround();
    overlayHost.setEntries(
      METEO_STATIONS_OVERLAY_SOURCE_ID,
      entries,
      {
        cohortLimit: METEO_STATIONS_OVERLAY_COHORT_LIMIT,
        collisionCapacity: METEO_STATIONS_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  /**
   * Pull the visible markers onto the terrain.
   *
   * Positions are updated IN PLACE on the existing primitives rather than by
   * repainting the collection — 2 144 points do not need rebuilding because
   * twelve of them learned their altitude.
   */
  async function clampVisibleToGround() {
    if (!_enabled || !_points) return;
    const cameraM = _viewer?.camera?.positionCartographic?.height;
    if (!Number.isFinite(cameraM) || cameraM > FLOOR_WARM_MAX_CAMERA_M) return;
    const inView = viewportFilter();
    const pending = [];
    for (const record of _records.values()) {
      if (record.floorResolved) continue;
      if (inView && !inView(record)) continue;
      pending.push(record);
      if (pending.length >= FLOOR_WARM_MAX_POINTS) break;
    }
    if (!pending.length) return;
    const token = ++_floorToken;
    await resolveGroundFloorCellsBounded(pending.map((record) => record.degrees));
    // The camera can move, the layer can be disabled, or the filter can repaint
    // the collection while the resolver is in flight. Anything the repaint
    // replaced is stale, so the token check drops this whole pass.
    if (token !== _floorToken || !_enabled || !_points) return;
    let moved = 0;
    for (const record of pending) {
      const floor = cachedGroundFloor(record.degrees.lat, record.degrees.lon);
      if (!Number.isFinite(floor)) continue;
      record.floorResolved = true;
      const position = Cesium.Cartesian3.fromDegrees(
        record.degrees.lon, record.degrees.lat, floor + GROUND_LIFT_M,
      );
      record.position = position;
      if (record.point) record.point.position = position;
      if (record.labelEntry) record.labelEntry.position = position;
      moved += 1;
    }
    if (!moved) return;
    publishOverlay();
    if (_selectedId && _records.has(_selectedId)) selectObject(_selectedId);
    governorRequestRender('meteo-stations-ground-clamp');
  }

  /**
   * A predicate for "this station is inside the current view", or null when the
   * camera cannot answer.
   */
  function viewportFilter() {
    const rectangle = _viewer?.camera?.computeViewRectangle?.();
    if (!rectangle) return null;
    const { west, south, east, north } = rectangle;
    if (![west, south, east, north].every(Number.isFinite)) return null;
    // A rectangle spanning the antimeridian has west > east. New Caledonia and
    // Wallis are in this network, but neither is ON the antimeridian, and
    // refusing the case is cheaper than being subtly wrong about it.
    if (west > east) return null;
    return (entry) => {
      if (!entry?.degrees) return true;
      const { lat, lon } = entry.degrees;
      const radLat = lat * Math.PI / 180;
      const radLon = lon * Math.PI / 180;
      return radLon >= west && radLon <= east && radLat >= south && radLat <= north;
    };
  }

  /**
   * Fetch the hourly observation set, once, for every live station at once.
   *
   * ONE request for all 190, not one per card: the upstream product is a single
   * file and slicing it per station would multiply a 22 MB server-side fetch by
   * the number of dots a reader clicks. A card opened while the fetch is in
   * flight joins it rather than starting a second.
   * @returns {Promise<?object>}
   */
  async function loadObservations() {
    if (_observations && Date.now() - _observationsAt < OBSERVATIONS_CLIENT_TTL_MS) return _observations;
    if (!_observationsInflight) {
      _observationsInflight = (async () => {
        try {
          const response = await fetchImpl(OBSERVATIONS_ENDPOINT);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (!payload?.observations) throw new Error('no observations in payload');
          _observations = payload.observations;
          _observationsAt = Date.now();
          return _observations;
        } catch (error) {
          console.warn('[Data:Stations météo] observations unavailable:', error?.message || error);
          // An empty object, not null: it means "asked, and there is nothing",
          // which is what the card should say. Null would look like "not asked".
          _observations = _observations || {};
          _observationsAt = Date.now();
          return _observations;
        } finally {
          _observationsInflight = null;
        }
      })();
    }
    return _observationsInflight;
  }

  /**
   * Fetch one station's fiche climatologique.
   *
   * `null` is a real, cached answer — 914 stations in this network publish no
   * fiche — so the map stores it and never asks twice.
   * @param {object} station
   * @returns {Promise<?object>}
   */
  async function loadNormals(station) {
    if (!station?.fiche) return null;
    if (_normals.has(station.id)) return _normals.get(station.id);
    try {
      const response = await fetchImpl(`${NORMALS_ENDPOINT}?id=${encodeURIComponent(station.id)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      _normals.set(station.id, payload?.fiche ?? null);
      return payload?.fiche ?? null;
    } catch (error) {
      console.warn('[Data:Stations météo] fiche unavailable:', error?.message || error);
      // Deliberately NOT cached: a timeout is not evidence the fiche is absent.
      return null;
    }
  }

  function clearSelection() {
    const record = _selectedId ? _records.get(_selectedId) : null;
    if (record?.point) {
      record.point.color = record.baseColor;
      record.point.pixelSize = record.basePixelSize;
      record.point.outlineColor = record.baseOutline;
    }
    _selectedId = null;
    overlayHost.clearSource(METEO_STATIONS_SELECTED_OVERLAY_SOURCE_ID);
  }

  /**
   * Paint the selected station's card.
   * @param {string} id Render id.
   * @param {{observation?: object|null, fiche?: object|null, pending?: boolean}} [live]
   */
  function paintCard(id, live = {}) {
    const record = _records.get(id);
    if (!record) return;
    const text = buildStationCard(record.subject, live);
    const [title, ...details] = text.split('\n');
    overlayHost.setEntries(
      METEO_STATIONS_SELECTED_OVERLAY_SOURCE_ID,
      [{
        id,
        position: record.position,
        variant: 'selected',
        selected: true,
        protected: true,
        paintLane: 'selected',
        collisionGroup: 'ambient-card',
        priority: Number.MAX_SAFE_INTEGER,
        title,
        details,
        accent: SELECTED_COLOR,
        interactive: false,
        anchorRadiusPx: 9,
        minAnchorGapPx: 11,
        verticalOnly: true,
        placement: 'above',
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
      }],
      METEO_STATIONS_SELECTED_OVERLAY_SOURCE_OPTIONS,
    );
    governorRequestRender('meteo-stations-select');
  }

  function selectObject(id) {
    const record = _records.get(id);
    clearSelection();
    if (!record) return;
    _selectedId = id;
    const selected = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    if (record.point) {
      record.point.outlineColor = selected;
      record.point.pixelSize = record.basePixelSize + 5;
    }
    const station = record.subject;
    // The card is painted TWICE on purpose: once immediately from what the
    // shipped pack already knows, and once when the two network answers land.
    // A card that waited would leave a reader looking at nothing for the length
    // of a 22 MB server-side fetch, and everything worth reading — what the
    // station measures, where it is, what it is — is already local.
    paintCard(id, {});
    if (!station?.live && !station?.fiche) {
      paintCard(id, { pending: false });
      return;
    }
    Promise.all([
      station?.live ? loadObservations() : Promise.resolve(null),
      loadNormals(station),
    ]).then(([observations, fiche]) => {
      // The reader may have clicked elsewhere, or the filter may have repainted
      // the collection, while those were in flight.
      if (_selectedId !== id || !_records.has(id)) return;
      paintCard(id, {
        observation: station?.omm ? (observations?.[station.omm] ?? null) : null,
        fiche,
        pending: false,
      });
    });
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && _selectedId) {
      clearSelection();
      governorRequestRender('meteo-stations-deselect');
    }
  }

  /**
   * Install the click-to-select handler.
   *
   * Guarded on `document` because Cesium's `ScreenSpaceEventHandler` registers
   * DOM listeners in its constructor, and this layer's lifecycle is exercised
   * headless in `meteoStationsFrance.test.mjs`.
   */
  function installClickHandler(viewer) {
    if (_clickHandler || typeof document === 'undefined') return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      if (!_enabled) return;
      const picked = viewer.scene.pick(click.position);
      const id = typeof picked?.primitive?.id === 'string' ? picked.primitive.id : null;
      if (id && _records.has(id)) { selectObject(id); return; }
      // The label plane the depth buffer knows nothing about, resolved after
      // the native pick so a name drawn across a neighbouring station cannot
      // steal it. The label carries the upstream station id, not the render id.
      const labelled = pickOverlayLabelId(click.position, {
        sourceId: METEO_STATIONS_OVERLAY_SOURCE_ID,
        prefix: METEO_STATIONS_LABEL_PREFIX,
        has: (stationId) => _records.has(renderId(stationId)),
        hitTest: overlayHost.hitTest,
      });
      if (labelled) { selectObject(renderId(labelled)); return; }
      if (!id || !id.startsWith(METEO_STATIONS_RENDER_PREFIX)) clearSelection();
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

  const layer = {
    id: METEO_STATIONS_LAYER_ID,
    name: 'Weather Stations (FR)',
    icon: '🌡',
    source: 'Météo-France',
    // The network is a shipped file and never changes between page loads.
    // A finite interval exists only so a first load that failed heals itself.
    updateInterval: 1_800_000,

    init(viewer) {
      _viewer = viewer;
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      viewer.scene.primitives.add(_points);
      _points.show = false;
      _records = new Map();
      _selectedId = null;
      _enabled = false;
      overlayHost.setVisible(METEO_STATIONS_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(METEO_STATIONS_SELECTED_OVERLAY_SOURCE_ID, false);
      registerPickOwner(METEO_STATIONS_LAYER_ID, (pickedId) => (
        typeof pickedId === 'string' && pickedId.startsWith(METEO_STATIONS_RENDER_PREFIX)
      ));
      console.log('[Data:Stations météo] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (viewer) installClickHandler(viewer);
      if (_points) _points.show = true;
      overlayHost.setVisible(METEO_STATIONS_OVERLAY_SOURCE_ID, true);
      overlayHost.setVisible(METEO_STATIONS_SELECTED_OVERLAY_SOURCE_ID, true);
      // BOTH camera events, because neither covers the other. `moveEnd` fires
      // when a user finishes dragging but NOT when the camera is placed
      // programmatically, which is exactly what a share link does; `changed`
      // fires from inside the render loop for any delta including `setView`,
      // but not reliably at the end of a gesture. Both handlers are idempotent.
      const follow = () => { if (_enabled) publishOverlay(); };
      if (!_cameraRemovers.length) {
        for (const event of [_viewer?.camera?.moveEnd, _viewer?.camera?.changed]) {
          if (event?.addEventListener) _cameraRemovers.push(event.addEventListener(follow));
        }
      }
      if (_stations.length) repaint();
    },

    disable() {
      _enabled = false;
      clearSelection();
      removeClickHandler();
      for (const remove of _cameraRemovers) remove();
      _cameraRemovers = [];
      if (_points) _points.show = false;
      overlayHost.clearSource(METEO_STATIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(METEO_STATIONS_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(METEO_STATIONS_SELECTED_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (_registry) return true;
      _loading = true;
      try {
        const response = await fetchImpl(registryUrl);
        if (!response.ok) {
          _lastError = `Réseau stations HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.stations)) {
          _lastError = 'Réseau stations malformé';
          return false;
        }
        _registry = payload;
        _stations = payload.stations.filter(
          (station) => Number.isFinite(station?.lat) && Number.isFinite(station?.lon),
        );
        applyFilter();
        _lastUpdate = Date.now();
        _lastError = null;
        repaint();
        _rowControlsListener?.();
        console.log(
          `[Data:Stations météo] ${_stations.length} stations, `
          + `${payload.stats?.live ?? 0} avec relevés publics, `
          + `${payload.stats?.byFamily?.wind ?? 0} avec anémomètre`,
        );
        return true;
      } catch (error) {
        console.warn('[Data:Stations météo] Load error:', error);
        _lastError = 'Réseau stations illisible';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      clearSelection();
      overlayHost.clearSource(METEO_STATIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(METEO_STATIONS_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(METEO_STATIONS_SELECTED_OVERLAY_SOURCE_ID, false);
      unregisterPickOwner(METEO_STATIONS_LAYER_ID);
      removeClickHandler();
      for (const remove of _cameraRemovers) remove();
      _cameraRemovers = [];
      if (_points) {
        viewer?.scene?.primitives?.remove?.(_points);
        _points = null;
      }
      _viewer = null;
      _records = new Map();
      _registry = null;
      _stations = [];
      _visible = [];
      _labelEntries = [];
      _floorToken += 1;
      _selectedId = null;
      _lastUpdate = null;
      _lastError = null;
      _observations = null;
      _observationsAt = null;
      _normals.clear();
    },

    /**
     * Runtime params. `filter` hides stations without losing them: the shipped
     * file always carries the whole network and `getStats()` keeps reporting
     * the totals.
     * @param {{filter?: string}} [params]
     * @returns {boolean}
     */
    setParams(params = {}) {
      if (params.filter === undefined) return false;
      const next = METEO_STATION_FILTERS.find((entry) => entry.id === params.filter);
      if (!next || next.id === _filterId) return false;
      _filterId = next.id;
      applyFilter();
      if (_selectedId && !_records.has(_selectedId)) clearSelection();
      repaint();
      _rowControlsListener?.();
      return true;
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getRowControls() {
      const chips = METEO_STATION_FILTERS.map((filter) => {
        const count = filter.test ? _stations.filter((s) => filter.test(s)).length : _stations.length;
        return {
          id: filter.id,
          label: filter.label,
          active: _filterId === filter.id,
          state: _filterId === filter.id ? 'active' : 'idle',
          title: filter.family
            ? `${count} stations mesurent ${FAMILY_BY_KEY[filter.family].label}`
              + ` sur ${_stations.length}`
            : filter.id === 'live'
              ? `${count} stations publient leurs relevés sans clé`
              : `Tout le réseau temps réel — ${count} stations`,
          params: { filter: filter.id },
        };
      });
      return { chips, legend: stationLegend(_visible) };
    },

    getAnalystRecords(maxCount = 200) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 200;
      const out = [];
      for (const station of _visible) {
        if (out.length >= limit) break;
        out.push(mapStationAnalystRecord(station, out.length));
      }
      return out;
    },

    getStats() {
      const stats = _registry?.stats || null;
      return {
        count: _visible.length,
        lastUpdate: _lastUpdate,
        loading: _loading,
        error: _lastError,
        stale: false,
        // The network's own figures, reported whatever the filter hides.
        stations: stats?.stations ?? null,
        metropole: stats?.metropole ?? null,
        overseas: stats?.overseas ?? null,
        // Two different claims: what publishes, and what the list says
        // publishes. See trap 3 in the feed module.
        live: stats?.live ?? null,
        listedSynop: stats?.synop ?? null,
        closed: stats?.closed ?? null,
        withFiche: stats?.fiche ?? null,
        byClass: stats?.byClass ?? null,
        byFamily: stats?.byFamily ?? null,
        filter: _filterId,
        hidden: _stations.length - _visible.length,
        // Licence Ouverte 2.0 obliges the producer AND the data's own date.
        generated: _registry?.generated ?? null,
        synopNewest: _registry?.synop?.newest ?? null,
        excluded: _registry?.excluded ?? null,
      };
    },
  };

  return layer;
}

const meteoStationsFranceLayer = createMeteoStationsFranceLayer();

export default meteoStationsFranceLayer;
