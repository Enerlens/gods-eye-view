/**
 * @module gbfsFeeds
 *
 * Pure catalog, parsing and REDUNDANCY logic for French shared mobility —
 * the GBFS feeds published on the Point d'Accès National
 * (`transport.data.gouv.fr`): vélos en libre-service, trottinettes, scooters
 * and autopartage.
 *
 * WHAT MAKES THIS SOURCE AWKWARD, and what most of this file is about:
 *
 *   1. **The catalog double-counts.** One operator publishes the same feed
 *      under several dataset entries — Dott appears as "France", "Paris",
 *      "Lyon", "Bordeaux", "OL Vallée" and "Bourgoin-Jaillieu" pointing at one
 *      URL; Vélam Amiens is listed five times. Measured 2026-08-27: 8 groups,
 *      22 catalog resources, one real system each.
 *   2. **The same system appears at several GBFS versions.** Naolib Nantes is
 *      published at `/gbfs/v2/` and `/gbfs/v3/` — different URLs, identical
 *      121 stations.
 *   3. **The same system appears on different HOSTS.** Vélo'v Lyon is served
 *      both by JCDecaux (`api.cyclocity.fr`) and by the Métropole
 *      (`download.data.grandlyon.com`) — 464 stations, a 100% match. No URL
 *      comparison can catch this.
 *   4. **Four systems are already drawn by another layer.** Vélib', Vélo'v,
 *      vélÔToulouse and Le Vélo (TBM) ship in `bikeshare.js`.
 *
 * So identity here is NOT a URL and NOT a name. It is the SET OF PLACES a
 * system reports — see {@link coordSignature} and {@link containment}. That is
 * the only test that survives all four cases, and it is a measurement rather
 * than a naming convention someone has to keep tidy.
 *
 * WITH ONE CORRECTION THAT THE DATA FORCED. Paris requires free-floating
 * operators to park in municipal bays, and every operator republishes that one
 * set of bays as its own `station_information`. Voi Paris and Dott Paris
 * therefore share 96.6% of their "station" positions while being entirely
 * different fleets — the first build marked one as a duplicate of the other.
 * Shared public infrastructure does not identify an operator, so:
 *
 *   - a system with a free-floating fleet is identified by its VEHICLES, not
 *     by the bays it is told to park in;
 *   - a positional match is only accepted as proof of duplication when the two
 *     systems share a publisher host, or when BOTH are purely docked (a dock
 *     network is its operator's own infrastructure — which is what lets Vélo'v
 *     be recognised across `api.cyclocity.fr` and `download.data.grandlyon.com`).
 *
 * An identical resolved URL is always proof, whatever the hosts.
 *
 * Dependency-free and side-effect-free so every rule above is unit-testable
 * without a Vite server.
 */
import {
  boxArea,
  boxContains as boxContainsPoint,
  boxKey,
  boxOverlapArea as overlapArea,
  boxesIntersect as boxesOverlap,
  mergeBounds,
  padBox,
  snapBoxOutward,
  validBox,
} from './viewportBox.js';

/** Catalog endpoint — the same national access point the transit layer reads. */
export const PAN_DATASETS_URL = 'https://transport.data.gouv.fr/api/datasets';

/** Resource format that carries a GBFS auto-discovery document. */
export const PAN_GBFS_FORMAT = 'gbfs';

/** Dataset type the PAN uses for shared-vehicle systems. */
export const PAN_SHARING_TYPE = 'vehicles-sharing';

/** Human labels for the licence codes the PAN publishes on these datasets. */
export const GBFS_LICENCE_LABELS = Object.freeze({
  lov2: 'Licence Ouverte 2.0',
  'fr-lo': 'Licence Ouverte 1.0',
  'odc-odbl': 'ODbL 1.0',
  'odc-by': 'ODC-BY',
  notspecified: 'Licence non précisée',
  'other-open': 'Autre licence ouverte',
});

/**
 * Display vehicle kinds. Derived from the GBFS `form_factor` +
 * `propulsion_type` pair, which is the only place the spec states what a
 * vehicle physically is.
 */
export const VEHICLE_KIND_LABELS = Object.freeze({
  bike: 'Bike',
  ebike: 'E-bike',
  scooter: 'Scooter',
  moped: 'Moped',
  car: 'Car',
  other: 'Other',
});

/**
 * Largest viewport this source answers, in degrees. Shared vehicles are a
 * street-scale dataset — past this the per-system fan-out stops being a
 * viewport query and the individual glyphs stop meaning anything.
 */
export const GBFS_MAX_BOX_DEG = 3;

/** Outward snap grid (~3.3 km) so neighbouring viewports share one cache entry. */
export const GBFS_BOX_STEP_DEG = 0.03;

/** Per-request cap on systems fetched upstream. */
export const GBFS_MAX_SYSTEMS_PER_REQUEST = 14;

/** Hard cap on objects (stations + vehicles) returned for one viewport. */
export const GBFS_MAX_OBJECTS = 6000;

/**
 * Coordinate rounding used to build a system's identity signature.
 * Four decimals is ~11 m — tight enough that two different systems in one city
 * do not collide, loose enough that the same station published by two
 * different hosts still matches.
 */
export const SIGNATURE_DECIMALS = 4;

/**
 * Containment above which two systems are judged to be the same system.
 *
 * Containment, not Jaccard: an operator's national feed legitimately CONTAINS
 * its per-city feeds, and Jaccard would score that pair low while containment
 * scores it ~1. The threshold is deliberately well below 1 because two
 * publishers of one system can round coordinates differently.
 */
export const REDUNDANCY_THRESHOLD = 0.8;

/** Minimum points before a signature is trusted for a redundancy verdict. */
export const SIGNATURE_MIN_POINTS = 5;

/**
 * Above this fraction of shared station positions, a system's "stations" are
 * public parking infrastructure rather than its own docks — so they must not
 * be drawn per operator.
 *
 * Measured over Paris on 2026-08-27: Dott and Voi each report ~12,000 station
 * positions of which 96–97% are also reported by the other operators, while
 * Vélib' shares only 3% of its 1,341. Drawing the shared set once per operator
 * would put three near-identical dots on every bay in the city.
 */
export const SHARED_STATION_FRACTION = 0.5;

/**
 * Whether a system's stations are its own infrastructure and should be drawn.
 *
 * Two ways a "station" turns out not to be one:
 *   - it is a municipal bay every operator in the city republishes
 *     ({@link SHARED_STATION_FRACTION});
 *   - it is a whole-city SENTINEL. Lime Paris publishes exactly one station
 *     named "Paris Proper" with 999,999 docks holding its entire fleet;
 *     rendering that as a dock would stack ~6,000 bikes on one point.
 *
 * @param {Object} system Index entry.
 * @returns {boolean}
 */
export function systemDrawsStations(system) {
  if (!system || !system.stationCount) return false;
  if (Number(system.sharedStationFraction) > SHARED_STATION_FRACTION) return false;
  if (system.sentinelStations === true) return false;
  return true;
}

/**
 * Whether a station row is a whole-city sentinel rather than a real dock.
 * A dock with more places than the country has vehicles is a placeholder.
 * @param {{docks:?number, available:?number, capacity:?number}} station
 * @returns {boolean}
 */
export function isSentinelStation(station) {
  const docks = Number(station?.docks);
  const available = Number(station?.available);
  return (Number.isFinite(docks) && docks >= 10000) || (Number.isFinite(available) && available >= 2000);
}

/**
 * Fraction of a system's station positions that OTHER systems also report.
 *
 * @param {Set<string>} places The system's own station signature.
 * @param {Map<string, number>} frequency Coordinate → number of systems reporting it.
 * @returns {number} 0–1, or 0 when the system has no stations.
 */
export function sharedStationFraction(places, frequency) {
  if (!places?.size || !frequency) return 0;
  let shared = 0;
  for (const key of places) if ((frequency.get(key) || 0) > 1) shared += 1;
  return shared / places.size;
}

/**
 * Count how many systems report each station coordinate.
 * @param {Array<{id:string, places:Set<string>}>} systems
 * @returns {Map<string, number>}
 */
export function stationFrequency(systems) {
  const frequency = new Map();
  for (const system of systems || []) {
    for (const key of system?.places || []) frequency.set(key, (frequency.get(key) || 0) + 1);
  }
  return frequency;
}

/**
 * Human-readable licence label for a PAN licence code.
 * @param {*} licence Raw `dataset.licence`.
 * @returns {string}
 */
export function gbfsLicenceLabel(licence) {
  const code = String(licence ?? '').trim();
  if (!code) return 'Licence non précisée';
  return GBFS_LICENCE_LABELS[code] || code;
}

/**
 * Read a GBFS text field, which is a plain string in 2.x and an array of
 * localized objects in 3.0.
 *
 * A 3.0 feed read with `String()` renders every station as `[object Object]`,
 * which is a silent failure rather than a loud one — so this is the single
 * choke point every text read goes through.
 *
 * @param {*} value Raw field.
 * @param {string} [preferred] Preferred language code.
 * @returns {?string}
 */
export function localizedText(value, preferred = 'fr') {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const match = value.find((entry) => entry?.language === preferred) || value[0];
    const text = String(match?.text ?? '').trim();
    return text || null;
  }
  if (value && typeof value === 'object') {
    const text = String(value.text ?? '').trim();
    return text || null;
  }
  return null;
}

/**
 * Resolve a GBFS auto-discovery document to a `{feedName: url}` map.
 *
 * 2.x nests the feed list under a language key (`data.fr.feeds`); 3.0 puts it
 * at `data.feeds`. 150 of the 172 French catalog entries point at one of these
 * documents rather than at a data file, which is exactly why the pre-existing
 * `/api/gbfs` proxy — which only accepts `station_*.json` paths — could not
 * reach them.
 *
 * @param {*} discovery Parsed `gbfs.json`.
 * @param {string} [preferred] Preferred language key for the 2.x shape.
 * @returns {?Object<string, string>} Feed name (without `.json`) → URL.
 */
export function resolveGbfsDiscovery(discovery, preferred = 'fr') {
  const data = discovery?.data;
  if (!data || typeof data !== 'object') return null;
  let feeds = Array.isArray(data.feeds) ? data.feeds : null;
  if (!feeds) {
    const key = Object.hasOwn(data, preferred) ? preferred : Object.keys(data)[0];
    feeds = data[key]?.feeds;
  }
  if (!Array.isArray(feeds) || !feeds.length) return null;
  const map = {};
  for (const feed of feeds) {
    const name = String(feed?.name ?? '').trim().replace(/\.json$/i, '');
    const url = String(feed?.url ?? '').trim();
    if (name && url) map[name] = url;
  }
  return Object.keys(map).length ? map : null;
}

/**
 * The status feed carrying free-floating vehicles, whose name changed in 3.0.
 * @param {Object<string, string>} feeds Resolved discovery map.
 * @returns {?string}
 */
export function freeVehicleFeedUrl(feeds) {
  return feeds?.vehicle_status || feeds?.free_bike_status || null;
}

/**
 * Normalize one GBFS vehicle type row to a display kind.
 *
 * @param {Object} type Row of `vehicle_types.json`.
 * @returns {string} One of {@link VEHICLE_KIND_LABELS}'s keys.
 */
export function vehicleKindFromType(type) {
  const form = String(type?.form_factor ?? '').toLowerCase();
  const propulsion = String(type?.propulsion_type ?? '').toLowerCase();
  const electric = propulsion.includes('electric');
  if (form === 'car') return 'car';
  if (form === 'moped') return 'moped';
  if (form.startsWith('scooter')) return 'scooter';
  if (form === 'bicycle' || form === 'cargo_bicycle') return electric ? 'ebike' : 'bike';
  if (!form) return electric ? 'ebike' : 'bike';
  return 'other';
}

/**
 * Build a `vehicle_type_id → kind` lookup from `vehicle_types.json`.
 *
 * Per the spec, a system that publishes no vehicle-types file is assumed to
 * operate non-motorized bicycles — so an empty lookup is meaningful, not a
 * failure, and callers fall back to `bike` rather than to `other`.
 *
 * @param {*} payload Parsed `vehicle_types.json`.
 * @returns {Object<string, string>}
 */
export function vehicleKindLookup(payload) {
  const rows = payload?.data?.vehicle_types;
  const lookup = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.vehicle_type_id ?? '').trim();
    if (id) lookup[id] = vehicleKindFromType(row);
  }
  return lookup;
}

/** Coerce a GBFS boolean, which appears as `true`, `1` or `"true"` across feeds. */
function gbfsBool(value, fallback = true) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Parse `station_information.json` into positioned stations.
 *
 * Handles the 3.0 localized `name` array — a 2.x-only reader renders every
 * station as `[object Object]`.
 *
 * @param {*} payload Parsed feed.
 * @returns {Array<{id:string, name:?string, lat:number, lon:number, capacity:?number}>}
 */
export function parseGbfsStations(payload) {
  const rows = payload?.data?.stations;
  const stations = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.station_id ?? '').trim();
    const lat = finiteNumber(row?.lat);
    const lon = finiteNumber(row?.lon);
    if (!id || lat === null || lon === null) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue;
    stations.push({
      id,
      name: localizedText(row?.name),
      lat,
      lon,
      capacity: finiteNumber(row?.capacity),
    });
  }
  return stations;
}

/**
 * Parse `station_status.json` into an availability map keyed by station id.
 *
 * Reads both the 2.x `num_bikes_available` and the 3.0
 * `num_vehicles_available`: a reader that knows only the 2.x name reports
 * every station on a 3.0 feed as empty, which looks like a dead system rather
 * than like a parse error.
 *
 * @param {*} payload Parsed feed.
 * @returns {Map<string, {available:number, docks:?number, renting:boolean,
 *   returning:boolean, installed:boolean, byKind:Object<string, number>}>}
 */
export function parseGbfsStationStatus(payload) {
  const rows = payload?.data?.stations;
  const status = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.station_id ?? '').trim();
    if (!id) continue;
    const available = finiteNumber(row?.num_vehicles_available)
      ?? finiteNumber(row?.num_bikes_available)
      ?? 0;
    const byKind = {};
    // 2.x publishes a mechanical/ebike split; 3.0 publishes per-type counts.
    for (const entry of Array.isArray(row?.num_bikes_available_types) ? row.num_bikes_available_types : []) {
      for (const [key, count] of Object.entries(entry || {})) {
        const kind = key === 'ebike' ? 'ebike' : (key === 'mechanical' ? 'bike' : key);
        byKind[kind] = (byKind[kind] || 0) + (finiteNumber(count) ?? 0);
      }
    }
    for (const entry of Array.isArray(row?.vehicle_types_available) ? row.vehicle_types_available : []) {
      const typeId = String(entry?.vehicle_type_id ?? '').trim();
      if (typeId) byKind[typeId] = (byKind[typeId] || 0) + (finiteNumber(entry?.count) ?? 0);
    }
    status.set(id, {
      available: Math.max(0, available),
      docks: finiteNumber(row?.num_docks_available),
      renting: gbfsBool(row?.is_renting),
      returning: gbfsBool(row?.is_returning),
      installed: gbfsBool(row?.is_installed),
      byKind,
    });
  }
  return status;
}

/**
 * Parse `vehicle_status.json` / `free_bike_status.json` into positioned vehicles.
 *
 * These are the vehicles NOT currently rented — the spec forbids listing a
 * vehicle that is part of an active rental. So this is an inventory of what is
 * parked and available, never a track of anything in motion.
 *
 * @param {*} payload Parsed feed.
 * @param {Object<string, string>} [kinds] `vehicle_type_id → kind` lookup.
 * @returns {Array<Object>}
 */
export function parseGbfsVehicles(payload, kinds = {}) {
  const rows = payload?.data?.vehicles || payload?.data?.bikes;
  const vehicles = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const lat = finiteNumber(row?.lat);
    const lon = finiteNumber(row?.lon);
    if (lat === null || lon === null) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue;
    // A vehicle attached to a station is already drawn as part of that
    // station's availability; drawing it again would double-count the fleet.
    if (row?.station_id) continue;
    if (gbfsBool(row?.is_disabled, false)) continue;
    if (gbfsBool(row?.is_reserved, false)) continue;
    const id = String(row?.vehicle_id ?? row?.bike_id ?? '').trim();
    const typeId = String(row?.vehicle_type_id ?? '').trim();
    vehicles.push({
      id: id || null,
      lat,
      lon,
      // Spec default: a system with no vehicle-types file runs plain bicycles.
      kind: kinds[typeId] || (typeId ? 'other' : 'bike'),
      rangeMeters: finiteNumber(row?.current_range_meters),
      lastReported: finiteNumber(row?.last_reported),
    });
  }
  return vehicles;
}

// --- Identity and redundancy ------------------------------------------------

/**
 * The set of PLACES a system reports, rounded to ~11 m.
 *
 * This is the system's identity. Two feeds describing the same physical
 * network produce the same set whatever their URL, host, publisher or GBFS
 * version — which is the only property that survives all four ways this
 * catalog duplicates itself.
 *
 * @param {Array<{lat:number, lon:number}>} points
 * @param {number} [decimals]
 * @returns {Set<string>}
 */
export function coordSignature(points, decimals = SIGNATURE_DECIMALS) {
  const set = new Set();
  for (const point of points || []) {
    const lat = Number(point?.lat);
    const lon = Number(point?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    set.add(`${lat.toFixed(decimals)},${lon.toFixed(decimals)}`);
  }
  return set;
}

/**
 * Registrable domain of a host, for "same publisher" tests.
 *
 * Ecovelo serves one system from `api.gbfs.v2.2.ecovelo.mobi` and
 * `api.gbfs.v3.0.ecovelo.mobi` — different hostnames, same publisher — so a
 * raw hostname comparison would treat two versions of one network as two
 * networks. Two labels is the right depth for `.fr` / `.mobi` / `.com`; the
 * common French second-level suffixes are handled explicitly.
 *
 * @param {?string} host
 * @returns {?string}
 */
export function registrableDomain(host) {
  const clean = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!clean) return null;
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;
  const twoLevelSuffixes = new Set(['co.uk', 'gouv.fr', 'asso.fr', 'com.fr', 'org.uk']);
  const lastTwo = parts.slice(-2).join('.');
  if (twoLevelSuffixes.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

/** Normalized system name for the last-resort mirror test. */
export function normalizedSystemName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whether two sets hold exactly the same members. */
export function setsEqual(a, b) {
  if (!a || !b || a.size !== b.size || a.size === 0) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/**
 * Fraction of the SMALLER set that the larger one contains.
 *
 * Containment rather than Jaccard, because an operator's national feed
 * legitimately contains its per-city feeds and both are duplicates of each
 * other for our purposes.
 *
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number} 0–1, or 0 when either set is too small to judge.
 */
export function containment(a, b) {
  if (!a?.size || !b?.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size < SIGNATURE_MIN_POINTS) return 0;
  let shared = 0;
  for (const key of small) if (large.has(key)) shared += 1;
  return shared / small.size;
}

/**
 * Decide which systems are duplicates of each other, and of systems another
 * layer already draws.
 *
 * The kept representative of a duplicate group is the one reporting the MOST
 * places — an operator's national feed covers every city feed under it, so
 * keeping it loses nothing and keeping a city feed instead would silently drop
 * the rest of the country.
 *
 * Each system carries TWO signatures: `places` (its stations) and `fleet`
 * (its free-floating vehicles). Stations are compared when both sides have
 * them — they are stable across snapshots — and fleets otherwise.
 *
 * @param {Array<{id:string, places?:Set<string>, fleet?:Set<string>,
 *   statusUrl?:string, domain?:string, docked?:boolean,
 *   normalizedName?:string, stationCount?:number}>} systems
 * @param {Object} [options]
 * @param {Array<{id:string, places?:Set<string>, fleet?:Set<string>,
 *   statusUrl?:string, domain?:string, docked?:boolean,
 *   normalizedName?:string, stationCount?:number}>} [options.alreadyCovered]
 *   Systems drawn by another layer; anything matching one of these is excluded
 *   rather than becoming a group representative.
 * @param {number} [options.threshold]
 * @returns {Map<string, {with:string, reason:string, containment:number}>}
 *   Verdicts keyed by system id. Absent from the map means "keep".
 */
export function findRedundantSystems(systems, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : REDUNDANCY_THRESHOLD;
  const covered = Array.isArray(options.alreadyCovered) ? options.alreadyCovered : [];
  const verdicts = new Map();

  /** Same resolved feed is proof of duplication regardless of anything else. */
  const sameUrl = (a, b) => Boolean(a.statusUrl && b.statusUrl && a.statusUrl === b.statusUrl);

  /**
   * A positional match only proves duplication when the positions belong to
   * the operator rather than to the city:
   *
   *   - two purely DOCKED networks — docks are the operator's own hardware,
   *     which is what lets Vélo'v be recognised across two publisher hosts;
   *   - or the same publisher domain, which is what lets one Ecovelo system be
   *     recognised across its `v2.2` and `v3.0` subdomains.
   *
   * Two free-floating operators in Paris share ~12,000 municipal bays (96% of
   * each other's station sets, measured 2026-08-27) while running entirely
   * different fleets, so outside these two cases positions prove nothing.
   */
  const positionsAreEvidence = (a, b) => (
    (a.docked === true && b.docked === true)
    || (Boolean(a.domain) && a.domain === b.domain)
  );

  /**
   * Last resort for one system mirrored by an unrelated aggregator: identical
   * operator name, identical station count, and overlapping footprint. Narrow
   * on purpose — it must not fire on two Dott city feeds that share a name but
   * report different station counts.
   */
  const looksMirrored = (a, b) => (
    Boolean(a.normalizedName)
    && a.normalizedName === b.normalizedName
    && Number.isFinite(a.stationCount) && a.stationCount > 0
    && a.stationCount === b.stationCount
  );

  /**
   * A network too small for {@link containment} to judge statistically can
   * still be recognised when its station set is EXACTLY the other's — three
   * identical coordinates under one operator name is not a coincidence.
   */
  const identicalPlaces = (a, b) => setsEqual(a.places, b.places);

  /**
   * Which signature to compare. Stations when both systems have them — they
   * are stable and comparable across snapshots — otherwise the fleets, which
   * is all a purely free-floating system has.
   */
  const positionalScore = (a, b) => (
    (a.places?.size && b.places?.size)
      ? containment(a.places, b.places)
      : containment(a.fleet, b.fleet)
  );

  const match = (a, b) => {
    if (sameUrl(a, b)) return { reason: 'identical-url', score: 1 };
    const score = positionalScore(a, b);
    if (positionsAreEvidence(a, b) && score >= threshold) {
      return { reason: 'same-places', score };
    }
    if (looksMirrored(a, b) && (score >= threshold || identicalPlaces(a, b))) {
      return { reason: 'mirrored-system', score: score || 1 };
    }
    return null;
  };

  // Largest first, so the survivor of a group is the most complete feed.
  const weight = (system) => (system.places?.size || 0) + (system.fleet?.size || 0);
  const ordered = [...(systems || [])].sort((a, b) => (
    weight(b) - weight(a) || String(a.id).localeCompare(String(b.id))
  ));

  const kept = [];
  for (const system of ordered) {
    let hit = null;
    let against = null;
    for (const other of covered) {
      hit = match(system, other);
      if (hit) { against = other; break; }
    }
    if (!hit) {
      for (const other of kept) {
        hit = match(system, other);
        if (hit) { against = other; break; }
      }
    }
    if (hit) {
      verdicts.set(system.id, {
        with: against.id,
        reason: hit.reason,
        containment: Number(hit.score.toFixed(3)),
      });
      continue;
    }
    kept.push(system);
  }
  return verdicts;
}

// --- Catalog ----------------------------------------------------------------

/** Preferred display name for a shared-mobility system. */
export function gbfsSystemName(dataset) {
  const title = String(dataset?.title ?? '').trim();
  // PAN titles are already operator-shaped ("VLS Vélam Amiens", "Vélos Lime
  // Paris"); the leading category token is noise once the layer groups by kind.
  return title.replace(/^(VLS|Vélos et trottinettes|Vélos|Trottinettes|Autopartage|Scooters)\s+/i, '').trim()
    || title
    || 'Système sans nom';
}

/** Short coverage string from the dataset's declared areas. */
export function gbfsAreaLabel(dataset) {
  const areas = Array.isArray(dataset?.covered_area) ? dataset.covered_area : [];
  return areas.map((area) => String(area?.nom ?? '').trim()).filter(Boolean).join(' · ');
}

/**
 * Every GBFS system in a PAN catalog dump, in stable id order.
 * @param {Array<Object>} datasets Parsed `GET /api/datasets` body.
 * @returns {Array<Object>} System descriptors, before any redundancy pass.
 */
export function gbfsSystemsFromCatalog(datasets) {
  const systems = [];
  for (const dataset of Array.isArray(datasets) ? datasets : []) {
    for (const resource of Array.isArray(dataset?.resources) ? dataset.resources : []) {
      if (resource?.format !== PAN_GBFS_FORMAT) continue;
      if (resource?.is_available === false) continue;
      const url = String(resource?.original_url || resource?.url || '').trim();
      const resourceId = resource?.id;
      if (!url || !resourceId) continue;
      systems.push({
        id: `gbfs-${resourceId}`,
        resourceId,
        name: gbfsSystemName(dataset),
        title: String(dataset?.title ?? '').trim(),
        publisher: String(dataset?.publisher?.name ?? '').trim() || null,
        area: gbfsAreaLabel(dataset),
        licence: String(dataset?.licence ?? '').trim() || null,
        licenceLabel: gbfsLicenceLabel(dataset?.licence),
        discoveryUrl: url,
        pageUrl: String(resource?.page_url ?? '').trim() || null,
        datasetUrl: String(dataset?.page_url ?? '').trim() || null,
        bbox: null,
      });
    }
  }
  systems.sort((a, b) => a.id.localeCompare(b.id));
  return systems;
}

// --- Viewport geometry ------------------------------------------------------
// Named wrappers over the shared helpers; the ceilings are this source's policy.

/** Validate a request box against {@link GBFS_MAX_BOX_DEG}. */
export function validGbfsBox(box) {
  return validBox(box, GBFS_MAX_BOX_DEG);
}

/** Snap a request box outward onto this source's cache grid. */
export function snapGbfsBox(box, stepDeg = GBFS_BOX_STEP_DEG) {
  return snapBoxOutward(box, stepDeg);
}

/** Stable cache key for a snapped box. */
export function gbfsBoxKey(box, decimals = 3) {
  return boxKey(box, decimals);
}

/** Grow a box by a margin in degrees, clamped to the globe. */
export function padGbfsBox(box, marginDeg) {
  return padBox(box, marginDeg);
}

/** Whether a point falls inside a box. */
export function gbfsBoxContains(box, lat, lon) {
  return boxContainsPoint(box, lat, lon);
}

/** Bounds only ever grow. */
export function mergeGbfsBounds(current, observed) {
  return mergeBounds(current, observed);
}

/**
 * Choose which systems to fetch for one viewport.
 *
 * Ranking is by the fraction of the SYSTEM's own footprint that the viewport
 * covers, so a city network fully on screen outranks a national free-floating
 * feed clipping the corner. Systems already marked redundant never compete.
 *
 * @param {Array<Object>} systems Index entries.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {Object} [options]
 * @param {number} [options.maxSystems]
 * @returns {{selected: Array<Object>, matched: number, truncated: boolean}}
 */
export function selectSystemsForBox(systems, box, options = {}) {
  const maxSystems = Number.isFinite(options.maxSystems)
    ? Math.max(1, Math.floor(options.maxSystems))
    : GBFS_MAX_SYSTEMS_PER_REQUEST;

  const scored = [];
  for (const system of Array.isArray(systems) ? systems : []) {
    if (!system?.bbox || system.redundant) continue;
    if (!boxesOverlap(system.bbox, box)) continue;
    const overlap = overlapArea(system.bbox, box);
    if (overlap <= 0) continue;
    scored.push({ system, covered: Math.min(1, overlap / Math.max(1e-9, boxArea(system.bbox))) });
  }
  scored.sort((a, b) => (
    b.covered - a.covered
    || (b.system.objectSample || 0) - (a.system.objectSample || 0)
    || a.system.id.localeCompare(b.system.id)
  ));
  return {
    selected: scored.slice(0, maxSystems).map((entry) => entry.system),
    matched: scored.length,
    truncated: scored.length > maxSystems,
  };
}
