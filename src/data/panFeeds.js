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
 * selection rules are unit-testable without a Vite server.
 */

/** Catalog endpoint. Public, keyless, no rate limit published. */
export const PAN_DATASETS_URL = 'https://transport.data.gouv.fr/api/datasets';

/** Resource format that carries GTFS-Realtime bodies. */
export const PAN_GTFS_RT_FORMAT = 'gtfs-rt';

/** Declared feature that means "this resource has VehiclePosition entities". */
export const PAN_VEHICLE_POSITIONS_FEATURE = 'vehicle_positions';

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

// --- Viewport geometry ------------------------------------------------------

/**
 * Validate a request box: finite, ordered, non-dateline, no wider than
 * {@link PAN_MAX_BOX_DEG} on either axis.
 * @param {{south:*, west:*, north:*, east:*}} box
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function validTransitBox(box) {
  const south = Number(box?.south);
  const west = Number(box?.west);
  const north = Number(box?.north);
  const east = Number(box?.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  if (south >= north || west >= east) return null;
  if (north - south > PAN_MAX_BOX_DEG || east - west > PAN_MAX_BOX_DEG) return null;
  return { south, west, north, east };
}

/**
 * Snap a request box OUTWARD onto the shared cache grid, so panning a few
 * streets re-uses the cached answer and a cached answer always covers at least
 * what was asked for. Mirrors `snapOsmCameraBox`, at a coarser step.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [stepDeg]
 * @returns {{south:number, west:number, north:number, east:number}}
 */
export function snapTransitBox(box, stepDeg = PAN_BOX_STEP_DEG) {
  const snap = (value, grow) => {
    const cells = Number((value / stepDeg).toFixed(9));
    return Number(((grow > 0 ? Math.ceil(cells) : Math.floor(cells)) * stepDeg).toFixed(6));
  };
  return {
    south: Math.max(-90, snap(box.south, -1)),
    west: Math.max(-180, snap(box.west, -1)),
    north: Math.min(90, snap(box.north, 1)),
    east: Math.min(180, snap(box.east, 1)),
  };
}

/** Stable cache key for a snapped box. */
export function transitBoxKey(box, decimals = 3) {
  return [box.south, box.west, box.north, box.east]
    .map((value) => Number(value).toFixed(decimals))
    .join(',');
}

/** Grow a box by a margin in degrees, clamped to the globe. */
export function padTransitBox(box, marginDeg) {
  const margin = Number(marginDeg) || 0;
  return {
    south: Math.max(-90, box.south - margin),
    west: Math.max(-180, box.west - margin),
    north: Math.min(90, box.north + margin),
    east: Math.min(180, box.east + margin),
  };
}

/** Whether two axis-aligned boxes share any area (edge contact counts). */
export function boxesIntersect(a, b) {
  if (!a || !b) return false;
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

/** Whether a point falls inside a box. */
export function boxContains(box, lat, lon) {
  if (!box) return false;
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

/** Degree-squared area of the intersection of two boxes (0 when disjoint). */
export function boxOverlapArea(a, b) {
  if (!boxesIntersect(a, b)) return 0;
  const lat = Math.min(a.north, b.north) - Math.max(a.south, b.south);
  const lon = Math.min(a.east, b.east) - Math.max(a.west, b.west);
  return Math.max(0, lat) * Math.max(0, lon);
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
    if (!feed?.url) continue;
    if (!feed.bbox) {
      unknown.push(feed);
      continue;
    }
    if (!nearKnownCoverage && boxesIntersect(padTransitBox(feed.bbox, probeMarginDeg), box)) {
      nearKnownCoverage = true;
    }
    const overlap = boxOverlapArea(feed.bbox, box);
    if (overlap <= 0) continue;
    const footprint = Math.max(
      1e-9,
      (feed.bbox.north - feed.bbox.south) * (feed.bbox.east - feed.bbox.west),
    );
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

/**
 * Merge freshly observed bounds into a feed's stored footprint.
 *
 * Bounds only ever GROW: a rush-hour probe sees more of a network than a
 * Sunday-night one, and shrinking the box on a quiet sample would make the
 * feed drop out of viewports it genuinely serves.
 *
 * @param {?{south:number, west:number, north:number, east:number}} current
 * @param {?{south:number, west:number, north:number, east:number}} observed
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function mergeObservedBounds(current, observed) {
  if (!observed) return current || null;
  if (!current) return { ...observed };
  return {
    south: Math.min(current.south, observed.south),
    west: Math.min(current.west, observed.west),
    north: Math.max(current.north, observed.north),
    east: Math.max(current.east, observed.east),
  };
}
