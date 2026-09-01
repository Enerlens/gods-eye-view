/**
 * @module panFeeds
 *
 * Pure catalog + viewport logic for the **Point d'Accès National** (PAN) to
 * French mobility data — `transport.data.gouv.fr`, the national access point
 * France operates under EU regulation 2017/1926.
 *
 * WHAT THIS SOURCE IS: a directory, not a feed. `GET /api/datasets` returns
 * every published mobility dataset with its resources; the ones this module
 * cares about are the `gtfs-rt` resources that declare the `vehicle_positions`
 * feature — roughly 150 live position feeds covering urban buses, trams,
 * metros, interurban coaches and school services across metropolitan France
 * and the DROM. Each resource is fetched directly for its own protobuf body.
 *
 * WHAT THE CATALOG DOES NOT GIVE: a bounding box. Coverage is published as a
 * NAME (`{type: 'epci', nom: 'Bordeaux Métropole'}`), never as geometry, so a
 * viewport-driven layer cannot ask the catalog "which feeds are on screen".
 * The footprint of every feed in `config/pan_gtfs_rt_feeds.json` is therefore
 * OBSERVED — the bounds of the vehicles the feed actually reported when
 * `scripts/build-pan-gtfs-rt-index.mjs` probed it — and the dev-server proxy
 * keeps learning bounds for feeds that were empty at build time. An observed
 * bbox is a measurement, not a coverage claim: a network's real service area
 * is at least as large as the box, and off-peak probes see less of it.
 *
 * Dependency-free and side-effect-free (same shape as `osmCameras.js`) so the
 * selection rules are unit-testable without a Vite server. The box geometry
 * itself lives in `viewportBox.js`, shared with the French shared-mobility
 * source, which asks the same question of a different catalog.
 */
import { feedIsSelectable } from './panFeedHealth.js';
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

/** Catalog endpoint. Public, keyless, no rate limit published. */
export const PAN_DATASETS_URL = 'https://transport.data.gouv.fr/api/datasets';

/** Resource format that carries GTFS-Realtime bodies. */
export const PAN_GTFS_RT_FORMAT = 'gtfs-rt';

/** Declared feature that means "this resource has VehiclePosition entities". */
export const PAN_VEHICLE_POSITIONS_FEATURE = 'vehicle_positions';

/**
 * Declared feature that means "this resource has TripUpdate entities".
 *
 * Measured 2026-08-31: every one of the 150 vehicle-position feeds has a
 * trip-update companion in its own dataset, and 63 of them ARE that companion
 * — one resource id serving both. That is what carries the ordered stops of the trip a
 * selected vehicle is running — and how far off the timetable the operator
 * says it is — without touching the 223 MB `stop_times.txt` of the static
 * archive, and it is what makes both an enrichment of the fleet already on
 * screen rather than a second layer.
 */
export const PAN_TRIP_UPDATES_FEATURE = 'trip_updates';

/**
 * Declared feature that means "this resource has Alert entities".
 *
 * Thinner: 60 of the 150 (measured 2026-08-31). An alert is the operator's own
 * sentence about a line — works, a strike, a diversion — and is the only
 * source in GTFS-Realtime for the disruption a rider would be told about at
 * the stop.
 */
export const PAN_SERVICE_ALERTS_FEATURE = 'service_alerts';

/** Resource format that carries static GTFS archives. */
export const PAN_GTFS_FORMAT = 'GTFS';

/** Human labels for the licence codes the PAN publishes on these datasets. */
export const PAN_LICENCE_LABELS = Object.freeze({
  lov2: 'Licence Ouverte 2.0',
  'fr-lo': 'Licence Ouverte 1.0',
  'odc-odbl': 'ODbL 1.0',
  'odc-by': 'ODC-BY',
  'notspecified': 'Licence non précisée',
  'other-open': 'Autre licence ouverte',
});

/**
 * `sub_types` values seen on vehicle-position datasets, mapped to the display
 * mode the layer colours by. This is the network's SERVICE class as declared
 * by its publisher, not a per-vehicle mode: GTFS-Realtime carries no
 * `route_type`, so a tram and a bus inside one urban network are both `urban`
 * until the matching GTFS static feed is loaded.
 */
export const PAN_MODE_LABELS = Object.freeze({
  urban: 'Urban',
  intercity: 'Intercity',
  school: 'School',
  zonal_drt: 'On-demand',
  seasonal: 'Seasonal',
  'long_distance': 'Long distance',
});

/** Fallback mode when a dataset declares no `sub_types`. */
export const PAN_DEFAULT_MODE = 'urban';

/**
 * Largest viewport this source answers, in degrees. A live position layer is
 * city-to-region scale: past this the per-feed request fan-out stops being a
 * viewport query and becomes a national download, and the individual vehicle
 * glyphs stop meaning anything on screen. Wider views get the layer's
 * `zoom-in` guidance state instead of a truncated answer.
 */
export const PAN_MAX_BOX_DEG = 6;

/** Outward snap grid (~5.5 km) so neighbouring viewports share one cache entry. */
export const PAN_BOX_STEP_DEG = 0.05;

/** Per-request cap on feeds fetched upstream. */
export const PAN_MAX_FEEDS_PER_REQUEST = 16;

/**
 * Per-request slots reserved for feeds with no observed footprint yet (a feed
 * that was empty when probed — school services at night, seasonal networks in
 * the off season). Without a reserved slot such a feed could never be seen
 * again, because selection is bbox-driven and it has no bbox.
 */
export const PAN_UNKNOWN_FOOTPRINT_SLOTS = 2;

/**
 * How far outside every KNOWN footprint the unknown-footprint allowance still
 * applies, in degrees (~165 km).
 *
 * A feed with no bbox could be anywhere, so on its own it would justify probing
 * French networks from a camera parked over Tokyo. The bound used instead is
 * measured rather than declared: a viewport earns the allowance only when it
 * comes within this margin of somewhere a feed has actually been observed. That
 * keeps unknown feeds discoverable across the region they plausibly serve
 * without hard-coding a "France" box — which would be a coverage claim, and
 * would be wrong for the DROM networks anyway.
 */
export const PAN_UNKNOWN_PROBE_MARGIN_DEG = 1.5;

/** Hard cap on vehicles returned for one viewport. */
export const PAN_MAX_VEHICLES = 6000;

/**
 * Human-readable licence label for a PAN licence code.
 * @param {*} licence Raw `dataset.licence`.
 * @returns {string}
 */
export function panLicenceLabel(licence) {
  const code = String(licence ?? '').trim();
  if (!code) return 'Licence non précisée';
  return PAN_LICENCE_LABELS[code] || code;
}

/**
 * Preferred display name for a network.
 *
 * A dataset that declares exactly ONE commercial offer is named for the brand
 * riders actually see on the bus ("liO", "TBM") rather than for its catalog
 * title ("Réseau urbain et scolaire TBM"). A dataset with several offers is an
 * AGGREGATE — Normandy publishes 22 networks through one feed — and naming it
 * after the first offer would label every vehicle in the région "Astrobus".
 * Those keep the catalog title, which is the only name true of the whole set.
 *
 * @param {Object} dataset PAN dataset record.
 * @returns {string}
 */
export function panNetworkName(dataset) {
  const offers = Array.isArray(dataset?.offers) ? dataset.offers : [];
  const title = String(dataset?.title ?? '').trim();
  if (offers.length === 1) {
    const commercial = String(offers[0]?.nom_commercial ?? '').trim();
    if (commercial) return commercial;
  }
  return title || 'Réseau sans nom';
}

/** Short coverage string, e.g. "Bordeaux Métropole · Occitanie". */
export function panAreaLabel(dataset) {
  const areas = Array.isArray(dataset?.covered_area) ? dataset.covered_area : [];
  const names = areas.map((area) => String(area?.nom ?? '').trim()).filter(Boolean);
  return names.join(' · ');
}

/**
 * Service modes declared by a dataset, normalized and de-duplicated.
 * @param {Object} dataset PAN dataset record.
 * @returns {string[]} Non-empty list; falls back to {@link PAN_DEFAULT_MODE}.
 */
export function panModes(dataset) {
  const raw = Array.isArray(dataset?.sub_types) ? dataset.sub_types : [];
  const modes = [...new Set(raw.map((mode) => String(mode || '').trim()).filter(Boolean))];
  return modes.length ? modes : [PAN_DEFAULT_MODE];
}

/**
 * Build the feed descriptor for one `gtfs-rt` resource of one dataset.
 *
 * The stable id is the PAN RESOURCE id, not the dataset id: several networks
 * publish two vehicle-position resources under one dataset (Montpellier's TaM
 * splits bus and tram), and collapsing them would silently drop half a city.
 *
 * @param {Object} dataset PAN dataset record.
 * @param {Object} resource One entry of `dataset.resources`.
 * @returns {?Object} Descriptor, or null when the resource is unusable.
 */
export function panFeedDescriptor(dataset, resource) {
  const resourceId = resource?.id;
  const url = String(resource?.url ?? '').trim();
  if (!resourceId || !url) return null;
  return {
    id: `pan-${resourceId}`,
    resourceId,
    datagouvId: resource?.datagouv_id ? String(resource.datagouv_id) : null,
    network: panNetworkName(dataset),
    title: String(dataset?.title ?? '').trim(),
    publisher: String(dataset?.publisher?.name ?? '').trim() || null,
    area: panAreaLabel(dataset),
    modes: panModes(dataset),
    licence: String(dataset?.licence ?? '').trim() || null,
    licenceLabel: panLicenceLabel(dataset?.licence),
    url,
    pageUrl: String(resource?.page_url ?? '').trim() || null,
    datasetUrl: String(dataset?.page_url ?? '').trim() || null,
    bbox: null,
  };
}

/**
 * Whether a resource is a GTFS-RT body that declares vehicle positions.
 * `is_available: false` is the PAN's own "we could not reach this" flag and is
 * respected — polling a resource the catalog already knows is down is noise.
 *
 * @param {Object} resource One entry of `dataset.resources`.
 * @returns {boolean}
 */
export function isVehiclePositionResource(resource) {
  if (!resource || resource.format !== PAN_GTFS_RT_FORMAT) return false;
  if (resource.is_available === false) return false;
  const features = Array.isArray(resource.features) ? resource.features : [];
  return features.includes(PAN_VEHICLE_POSITIONS_FEATURE);
}

/**
 * Whether a resource is a GTFS-RT body that declares a given feature.
 *
 * Same availability rule as {@link isVehiclePositionResource}: a resource the
 * catalog already flags as unreachable is not one to poll.
 *
 * @param {Object} resource One entry of `dataset.resources`.
 * @param {string} feature One of the `PAN_*_FEATURE` constants.
 * @returns {boolean}
 */
export function isRealtimeResourceWith(resource, feature) {
  if (!resource || resource.format !== PAN_GTFS_RT_FORMAT) return false;
  if (resource.is_available === false) return false;
  if (!String(resource.url ?? '').trim()) return false;
  const features = Array.isArray(resource.features) ? resource.features : [];
  return features.includes(feature);
}

/**
 * The dataset's resources carrying `feature`, ranked by how likely each is to
 * be the COMPANION of one particular vehicle-position resource.
 *
 * Ranking, in order:
 *
 *   1. The vehicle-position resource ITSELF, when it declares the feature too.
 *      63 of the 150 French position feeds do (measured 2026-08-31), and for
 *      those the companion body is bytes already fetched — the same
 *      `FeedMessage` read a second way, at zero network cost.
 *   2. Nearest resource id. The PAN mints a network's paired resources in one
 *      go, so a pair sits on adjacent ids: TBM is 83026/83025, TaM's urban set
 *      81755/81757 and its suburban set 83780/83779. Adjacency is a strong
 *      hint precisely where it is needed — a dataset that publishes SEVERAL
 *      position feeds (TaM splits urban from suburban, Astuce splits three
 *      operators) and would otherwise pair every one of them to the same body.
 *   3. Id order, so the result never depends on catalog ordering.
 *
 * It is a RANKING, not a verdict: `scripts/build-pan-gtfs-rt-index.mjs` probes
 * the candidates and keeps the one whose trips actually join the feed's own
 * vehicles, because the id-adjacency hint is wrong for at least one network
 * (Astuce's three operators interleave). Nothing downstream guesses.
 *
 * @param {Object} dataset PAN dataset record.
 * @param {Object} vehicleResource The dataset's vehicle-position resource.
 * @param {string} feature One of the `PAN_*_FEATURE` constants.
 * @returns {Array<Object>} Candidate resources, best first.
 */
export function companionResources(dataset, vehicleResource, feature) {
  const resources = Array.isArray(dataset?.resources) ? dataset.resources : [];
  const anchor = Number(vehicleResource?.id);
  return resources
    .filter((resource) => isRealtimeResourceWith(resource, feature))
    .map((resource) => ({
      resource,
      self: resource.id === vehicleResource?.id ? 0 : 1,
      distance: Number.isFinite(anchor) && Number.isFinite(Number(resource.id))
        ? Math.abs(Number(resource.id) - anchor)
        : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => (
      a.self - b.self
      || a.distance - b.distance
      || String(a.resource.id).localeCompare(String(b.resource.id))
    ))
    .map((entry) => entry.resource);
}

/**
 * Whether a resource is a GTFS-RT body that declares trip updates.
 *
 * Same availability rule as {@link isVehiclePositionResource}: a resource the
 * catalog already flags as unreachable is not one to poll on a click.
 *
 * @param {Object} resource One entry of `dataset.resources`.
 * @returns {boolean}
 */
export function isTripUpdateResource(resource) {
  return isRealtimeResourceWith(resource, PAN_TRIP_UPDATES_FEATURE);
}

/**
 * Static GTFS resources of one dataset, in catalog order.
 *
 * Kept as a LIST rather than reduced to a guess: several datasets ship more
 * than one archive — STAR Rennes publishes "version en cours" and "version à
 * venir" — and which of them carries usable geometry is answered by trying
 * them, not by picking the first.
 *
 * @param {Object} dataset PAN dataset record.
 * @returns {Array<Object>} The `format: 'GTFS'` resources.
 */
export function staticGtfsResources(dataset) {
  const resources = Array.isArray(dataset?.resources) ? dataset.resources : [];
  return resources.filter((resource) => resource?.format === PAN_GTFS_FORMAT && resource?.url);
}

/**
 * Stable URL of the PAN's own GeoJSON conversion of a static GTFS resource.
 *
 * The PAN converts every GTFS it hosts to GeoJSON and serves the result from a
 * URL derived from the RESOURCE id, refreshed whenever the archive is. That
 * conversion is what makes a line's trace drawable at all: it carries the
 * `shapes.txt` geometry already joined to `routes.txt` (`route_id`,
 * `route_short_name`, `route_color`), and the stop points with their ids — the
 * two members that, read raw, are the largest in the archive (36 MB and 13 MB
 * compressed for Normandy, measured 2026-08-31).
 *
 * The URL is DERIVED, not published in the bulk catalog: only the per-dataset
 * endpoint carries `conversions.GeoJSON`, which the index builder reads to
 * learn whether a conversion exists and how big it is.
 *
 * @param {number|string} resourceId PAN resource id of the static GTFS.
 * @returns {string}
 */
export function panGeoJsonConversionUrl(resourceId) {
  return `https://transport.data.gouv.fr/resources/conversions/${resourceId}/GeoJSON`;

}

/**
 * Every vehicle-position feed in a PAN catalog dump, in stable id order.
 * @param {Array<Object>} datasets Parsed `GET /api/datasets` body.
 * @returns {Array<Object>} Feed descriptors.
 */
export function vehiclePositionFeedsFromCatalog(datasets) {
  const feeds = [];
  for (const dataset of Array.isArray(datasets) ? datasets : []) {
    // Only public-transit datasets carry vehicle positions; the type check
    // keeps a future feature reuse (e.g. car-sharing) from silently joining.
    for (const resource of Array.isArray(dataset?.resources) ? dataset.resources : []) {
      if (!isVehiclePositionResource(resource)) continue;
      const descriptor = panFeedDescriptor(dataset, resource);
      if (descriptor) feeds.push(descriptor);
    }
  }
  feeds.sort((a, b) => a.id.localeCompare(b.id));
  return feeds;
}

// --- Viewport geometry -----------------------------------------------------
// Thin, named wrappers over the shared box helpers. The names stay
// transit-flavoured because the CEILINGS are this source's own policy; the
// arithmetic is not, and lives in `viewportBox.js`.

/** Validate a request box against this source's {@link PAN_MAX_BOX_DEG} ceiling. */
export function validTransitBox(box) {
  return validBox(box, PAN_MAX_BOX_DEG);
}

/** Snap a request box outward onto this source's cache grid. */
export function snapTransitBox(box, stepDeg = PAN_BOX_STEP_DEG) {
  return snapBoxOutward(box, stepDeg);
}

/** Stable cache key for a snapped box. */
export function transitBoxKey(box, decimals = 3) {
  return boxKey(box, decimals);
}

/** Grow a box by a margin in degrees, clamped to the globe. */
export function padTransitBox(box, marginDeg) {
  return padBox(box, marginDeg);
}

/** Whether two axis-aligned boxes share any area (edge contact counts). */
export function boxesIntersect(a, b) {
  return boxesOverlap(a, b);
}

/** Whether a point falls inside a box. */
export function boxContains(box, lat, lon) {
  return boxContainsPoint(box, lat, lon);
}

/** Degree-squared area of the intersection of two boxes (0 when disjoint). */
export function boxOverlapArea(a, b) {
  return overlapArea(a, b);
}

/** Bounds only ever grow — see {@link mergeBounds}. */
export function mergeObservedBounds(current, observed) {
  return mergeBounds(current, observed);
}

/**
 * Choose which feeds to fetch for one viewport.
 *
 * Ranking is by the fraction of the FEED's own footprint that the viewport
 * covers, not by raw overlap area: a metro network fully on screen is more
 * relevant than a région-wide coach network clipping the corner, and raw area
 * would rank them the other way round. Ties break on the larger observed fleet
 * so a live network outranks a near-dormant one, then on id for determinism.
 *
 * Feeds with no observed footprint keep a small reserved allowance
 * ({@link PAN_UNKNOWN_FOOTPRINT_SLOTS}) so they can eventually reveal
 * themselves; which ones get the slots rotates with `rotation` so the set is
 * covered over successive polls rather than always probing the same two. That
 * allowance is spent only near known coverage — see
 * {@link PAN_UNKNOWN_PROBE_MARGIN_DEG}.
 *
 * @param {Array<Object>} feeds Index entries (descriptors, possibly with bbox).
 * @param {{south:number, west:number, north:number, east:number}} box Viewport.
 * @param {Object} [options]
 * @param {number} [options.maxFeeds]
 * @param {number} [options.unknownSlots]
 * @param {number} [options.probeMarginDeg]
 * @param {number} [options.rotation] Monotonic counter that rotates the
 *   unknown-footprint allowance.
 * @returns {{selected: Array<Object>, matched: number, unknown: number,
 *            truncated: boolean, nearKnownCoverage: boolean}}
 */
export function selectFeedsForBox(feeds, box, options = {}) {
  const maxFeeds = Number.isFinite(options.maxFeeds)
    ? Math.max(1, Math.floor(options.maxFeeds))
    : PAN_MAX_FEEDS_PER_REQUEST;
  const unknownSlots = Number.isFinite(options.unknownSlots)
    ? Math.max(0, Math.floor(options.unknownSlots))
    : PAN_UNKNOWN_FOOTPRINT_SLOTS;
  const rotation = Number.isFinite(options.rotation) ? Math.floor(options.rotation) : 0;
  const probeMarginDeg = Number.isFinite(options.probeMarginDeg)
    ? Math.max(0, options.probeMarginDeg)
    : PAN_UNKNOWN_PROBE_MARGIN_DEG;

  const scored = [];
  const unknown = [];
  let nearKnownCoverage = false;
  for (const feed of Array.isArray(feeds) ? feeds : []) {
    // Duplicates and quarantined feeds never earn a slot: a viewport gets 16,
    // and spending one on a body that is already on screen under another id —
    // or on a resource that has failed every probe for two builds — costs a
    // live network its place. See `panFeedHealth.js` for how both are measured.
    if (!feedIsSelectable(feed)) continue;
    if (!feed.bbox) {
      unknown.push(feed);
      continue;
    }
    if (!nearKnownCoverage && boxesIntersect(padTransitBox(feed.bbox, probeMarginDeg), box)) {
      nearKnownCoverage = true;
    }
    const overlap = boxOverlapArea(feed.bbox, box);
    if (overlap <= 0) continue;
    const footprint = Math.max(1e-9, boxArea(feed.bbox));
    scored.push({ feed, covered: Math.min(1, overlap / footprint) });
  }

  scored.sort((a, b) => (
    b.covered - a.covered
    || (b.feed.vehicleSample || 0) - (a.feed.vehicleSample || 0)
    || a.feed.id.localeCompare(b.feed.id)
  ));

  const selected = scored.slice(0, maxFeeds).map((entry) => entry.feed);
  const remaining = maxFeeds - selected.length;
  let unknownTaken = 0;
  if (remaining > 0 && unknown.length && unknownSlots > 0 && nearKnownCoverage) {
    unknown.sort((a, b) => a.id.localeCompare(b.id));
    const take = Math.min(remaining, unknownSlots, unknown.length);
    for (let i = 0; i < take; i++) {
      selected.push(unknown[(rotation * take + i) % unknown.length]);
      unknownTaken += 1;
    }
  }

  return {
    selected,
    matched: scored.length,
    unknown: unknownTaken,
    truncated: scored.length > maxFeeds,
    nearKnownCoverage,
  };
}
