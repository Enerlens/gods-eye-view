import * as Cesium from 'cesium';
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
 * is in the publisher's own vocabulary — `6 × REP 900` at Gravelines,
 * `Pompage mixte` at Grand-Maison, `2 × Charbon` at Cordemais. Area rather
 * than radius carries the megawatts: a disc twice as wide would otherwise
 * claim four times the capacity.
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
 *   structures; measured, only 3 of these 51 hydro plants sit within 3 km of
 *   one. Nothing is de-duplicated between them, because a barrage and the
 *   usine it feeds are different objects.
 */

const API_URL = '/api/edf-plants';

/** Shared world-overlay source id (matches the layer id). */
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
 * `unitNoun` is the publisher's own unit of account: a nuclear site holds
 * réacteurs, a fossil-fired site holds tranches, and a hydro plant holds an
 * unpublished number of groups, which is why it has no noun here.
 */
export const FILIERE_STYLES = Object.freeze({
  nucleaire: Object.freeze({
    key: 'nucleaire', label: 'Nucléaire', color: '#ffd166', unitNoun: 'réacteur',
    blurb: 'Réacteurs à eau pressurisée exploités par EDF',
  }),
  hydraulique: Object.freeze({
    key: 'hydraulique', label: 'Hydraulique', color: '#4fc3f7', unitNoun: null,
    blurb: 'Centrales EDF > 100 MW (ou réserve secondaire ≥ 20 MW)',
  }),
  thermique: Object.freeze({
    key: 'thermique', label: 'Thermique à flamme', color: '#f4736b', unitNoun: 'tranche',
    blurb: 'Charbon, gaz et fioul exploités par EDF',
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
 * What the site IS, in one phrase: the unit count where the publisher gives
 * one, then the publisher's own word for the kind of plant.
 *
 * A hydro plant gets no count, because the file does not publish one — see the
 * module header. A site whose file names no kind gets the filière's own label
 * rather than an invented one.
 * @param {object|null|undefined} site
 * @returns {string}
 */
export function plantKindText(site) {
  const style = FILIERE_STYLES[String(site?.filiere ?? '')] || null;
  const kind = String(site?.kind ?? '').trim() || style?.label || 'Centrale';
  const units = Number(site?.units);
  if (!Number.isFinite(units) || units < 2) return kind;
  return `${units} × ${kind}`;
}

/**
 * Label text for one site: name, installed power, and what it is.
 * @param {object} site
 * @returns {string}
 */
export function plantLabelText(site) {
  return `${site?.name ?? ''} · ${formatMegawatts(site?.mw)} · ${plantKindText(site)}`;
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
export function createPlantOverlayEntry(record, position) {
  return {
    id: `edf-plants:${record.id}`,
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

  function repaint() {
    if (!_pointCollection) return;
    _pointCollection.removeAll();
    const entries = [];
    for (const record of _records) {
      const position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
      _pointCollection.add({
        position,
        pixelSize: plantPixelSize(record.mw),
        color: plantColor(record.filiere),
        outlineColor: COLOR_OUTLINE,
        outlineWidth: 1,
        scaleByDistance: new Cesium.NearFarScalar(20_000, 1.25, 3_000_000, 0.55),
        translucencyByDistance: new Cesium.NearFarScalar(20_000, 1, 5_000_000, 0.35),
        disableDepthTestDistance: 5000,
        id: `edf-plants:${record.id}`,
      });
      entries.push(createPlantOverlayEntry(record, position));
    }
    publishOverlay(entries);
    _viewer?.scene?.requestRender?.();
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
    id: 'edf-power-plants',
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
      overlayHost.setVisible(EDF_PLANTS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:EDF Plants] Initialized');
    },

    enable() {
      _enabled = true;
      if (_pointCollection) _pointCollection.show = true;
      overlayHost.setVisible(EDF_PLANTS_OVERLAY_SOURCE_ID, true);
      // The fleet is already drawn if a previous session loaded it; republish
      // the labels the overlay host dropped on disable.
      if (_records.length) repaint();
    },

    disable() {
      _enabled = false;
      if (_pointCollection) _pointCollection.show = false;
      overlayHost.clearSource(EDF_PLANTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EDF_PLANTS_OVERLAY_SOURCE_ID, false);
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
      overlayHost.clearSource(EDF_PLANTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EDF_PLANTS_OVERLAY_SOURCE_ID, false);
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
