/**
 * @module medecinsFrance
 *
 * Where doctors practise in France, and where a person will struggle to see one.
 *
 * Two questions, and the layer answers them at two different scales, because
 * they have two different answers. Zoomed out, the honest question is **"is
 * there room here?"** — and the DREES's APL is what answers it. Zoomed in, the
 * question is **"who, where, and what will it cost?"** — and that is the
 * register itself, with names.
 *
 * The reason the national regime paints ACCESSIBILITY and not a doctor count is
 * measured, not aesthetic: **the median French person lives 0.7 km from a
 * general practitioner, and only 0.49 % of the population is further than
 * 10 km.** A choropleth of counts would say "France is covered" and be useless.
 * What is scarce is not proximity but capacity — 18 % of the population lives
 * in a commune the ARS class as under-served — and the APL is the only public
 * indicator that measures it.
 *
 *   national — 96 painted départements, coloured by APL. Entered on the view's
 *              LATITUDE span (≥ 9.5°, metropolitan France being 9.8° tall),
 *              never on the larger of the two spans, which on a 16:10 viewport
 *              is mostly a statement about the window's shape.
 *   mesh     — real practice positions, spatially thinned to 1 100–2 200 dots.
 *   sites    — every practice in the box, with the doctors' names on the card.
 *
 * ── What the colour means, and what the size means ──────────────────────────
 * In the two close regimes the colour is the FAMILY of medicine practised —
 * six of them, cut by what a person is looking for rather than by the
 * nomenclature's own tree (see `medecinsFrFeed.js`). Size is the number of
 * DISTINCT DOCTORS at the address, never the number of register entries: a
 * radiologist is listed at every imaging site they cover, 5.53 entries per
 * name against 1.18 for a GP, and sizing on entries would make radiology look
 * like the second-largest specialty in France.
 *
 * ── What this layer cannot tell you, and says so ────────────────────────────
 * It is conventioned LIBERAL practice. A hospital's salaried doctors are not
 * in the register, so the map thins out around a CHU rather than lighting up
 * over it. And the register publishes no appointment book: whether a doctor
 * takes new patients, and how long the wait is, are the two questions people
 * most want answered and neither is in any public file.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor } from './groundFloor.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import {
  APL_62,
  APL_ALL,
  APL_DEP_62,
  APL_DEP_65,
  APL_DEP_POPULATION,
  APL_STANDING_LABELS,
  MEDECINS_FR_LAYER_ID,
  MEDECINS_MAX_BOX_DEG,
  MEDECIN_FAMILIES,
  MEDECIN_FAMILY_LABELS,
  MESH_FAMILY,
  MESH_LAT,
  MESH_LON,
  MESH_PRACTITIONERS,
  PRACTITIONER_CIVILITE,
  PRACTITIONER_NAME,
  PRACTITIONER_OPTION,
  PRACTITIONER_SECTEUR,
  PRACTITIONER_SPECIALTY,
  SITE_CP,
  SITE_INSEE,
  SITE_KIND,
  SITE_LAT,
  SITE_LON,
  SITE_PRACTITIONERS,
  SITE_PRECISION,
  SITE_TEL,
  SITE_VILLE,
  SITE_VOIE,
  aplDecile,
  aplStanding,
  medecinFamily,
  medecinsMeshBudget,
  medecinsRegime,
  practitionerTariff,
  selectMedecinsMesh,
  siteSpecialtyList,
  sitePrimaryFamily,
  tariffMix,
} from './medecinsFrFeed.js';

export { MEDECINS_FR_LAYER_ID };

const RENDER_PREFIX = 'medecins-fr:';
const OVERLAY_SOURCE_ID = 'medecins-fr-selected';
const OVERLAY_SOURCE_OPTIONS = Object.freeze({ cohortLimit: 1, collisionCapacity: 1, moving: false });
const LABEL_SOURCE_ID = 'medecins-fr-departements';
const LABEL_COHORT_LIMIT = 14;
const LABEL_COLLISION_CAPACITY = 12;

const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;

/** Six families, six colours — categorical, never a ramp. */
export const FAMILY_COLORS = Object.freeze({
  generaliste: '#4ade80',
  'femme-enfant': '#f472b6',
  'sante-mentale': '#c084fc',
  specialiste: '#38bdf8',
  chirurgie: '#fb923c',
  imagerie: '#facc15',
});

const SELECTED_COLOR = '#ffffff';
const COLOR_OUTLINE = Cesium.Color.fromCssColorString('#0b1220').withAlpha(0.85);
const GROUND_LIFT_M = 6;

/**
 * The APL ladder, anchored on the two thresholds the ARS actually use.
 *
 * 2.5 and 4 are policy — under-served and well-served — and they are the two
 * cuts that mean something outside this file. The other two exist so a map of
 * 96 départements is not three flat blocks: below 2.0 is the tail the DREES's
 * own first decile sits in (1.32 nationally), and 3.26 is the national mean,
 * so a département either clears the country or it does not.
 */
export const APL_BINS = Object.freeze([
  Object.freeze({ max: 2.0, color: '#7f1d1d', label: 'sous 2,0 — très sous-doté' }),
  Object.freeze({ max: 2.5, color: '#dc2626', label: '2,0 à 2,5 — sous-doté' }),
  Object.freeze({ max: 3.26, color: '#f59e0b', label: '2,5 à 3,3 — sous la moyenne' }),
  Object.freeze({ max: 4.0, color: '#84cc16', label: '3,3 à 4,0 — au-dessus' }),
  Object.freeze({ max: Infinity, color: '#22c55e', label: 'au-delà de 4,0 — bien doté' }),
]);

export function aplBin(value) {
  if (!Number.isFinite(value)) return null;
  for (let index = 0; index < APL_BINS.length; index += 1) {
    if (value <= APL_BINS[index].max) return index;
  }
  return APL_BINS.length - 1;
}

const fr = (value) => (Number.isFinite(value) ? Number(value).toLocaleString('fr-FR') : '—');
const pct = (value) => `${(value * 100).toFixed(0)} %`;

/**
 * Dot size from the number of DOCTORS at the address. Square-root, so a
 * fifteen-doctor practice reads as bigger than a solo one without swallowing
 * the street it sits on.
 */
export function medecinPixelSize(practitioners) {
  const count = Math.max(1, Number(practitioners) || 1);
  return Math.min(15, 5 + Math.sqrt(count) * 1.6);
}

/**
 * One line saying what a place costs, from its practitioners.
 * Returns null when the site publishes no names — a health centre — because
 * "no tariff information" and "free" are not the same sentence.
 */
export function tariffLine(practitioners) {
  if (!practitioners?.length) return null;
  const mix = tariffMix(practitioners);
  const total = mix.fixe + mix.plafonne + mix.libre + mix.autre;
  if (!total) return null;
  if (mix.fixe === total) return 'tarif fixé pour tous (secteur 1)';
  const parts = [];
  if (mix.fixe) parts.push(`${mix.fixe} au tarif fixé`);
  if (mix.plafonne) parts.push(`${mix.plafonne} plafonné (OPTAM)`);
  if (mix.libre) parts.push(`${mix.libre} en honoraires libres`);
  if (mix.autre) parts.push(`${mix.autre} sans secteur publié`);
  return parts.join(' · ');
}

/**
 * The card for one practice.
 *
 * Ordered by what a person came to find out: where it is, who is there, what
 * it costs, and only then how well the neighbourhood is served. The precision
 * caveat is last and only appears when the position is not the exact door —
 * a card that always disclaims teaches its reader to stop reading.
 *
 * Exported for test: this is where the layer's honesty actually lives.
 */
export function buildSiteCard(site, practitioners, context = {}) {
  const { specialites = {}, apl = null } = context;
  const title = site[SITE_VILLE] ? `${site[SITE_VOIE] || site[SITE_VILLE]}` : 'Cabinet';
  const details = [];

  const place = [site[SITE_CP], site[SITE_VILLE]].filter(Boolean).join(' ');
  if (place) details.push(place);
  if (site[SITE_TEL]) details.push(`☎ ${site[SITE_TEL]}`);
  if (site[SITE_KIND]?.includes('centre-de-sante')) details.push('Centre de santé');

  const doctors = site[SITE_PRACTITIONERS] || 0;
  const specialties = siteSpecialtyList(site, specialites);
  if (doctors > 0) {
    details.push(`${fr(doctors)} médecin${doctors > 1 ? 's' : ''}`);
  } else if (specialties.length) {
    // A health centre publishes specialties but no names. Say what is known.
    details.push('Praticiens non nommés par le registre');
  }

  for (const entry of specialties.slice(0, 6)) {
    details.push(`· ${entry.label}${entry.count > 1 ? ` (${entry.count})` : ''}`);
  }
  if (specialties.length > 6) details.push(`· et ${specialties.length - 6} autres spécialités`);

  const tariff = tariffLine(practitioners);
  if (tariff) details.push(tariff);

  for (const entry of (practitioners ?? []).slice(0, 8)) {
    const label = specialites[entry[PRACTITIONER_SPECIALTY]] ?? entry[PRACTITIONER_SPECIALTY];
    const civilite = entry[PRACTITIONER_CIVILITE] === 'F' ? 'Dre' : 'Dr';
    const cost = practitionerTariff(entry[PRACTITIONER_SECTEUR], entry[PRACTITIONER_OPTION]);
    details.push(`${civilite} ${entry[PRACTITIONER_NAME]} — ${label}, ${cost}`);
  }
  if ((practitioners?.length ?? 0) > 8) {
    details.push(`et ${practitioners.length - 8} autres praticiens`);
  }

  const commune = apl?.communes?.[site[SITE_INSEE]];
  if (commune) {
    const value = commune[APL_ALL];
    const decile = aplDecile(value, apl.bornes);
    const standing = aplStanding(value, apl.seuils);
    if (Number.isFinite(value)) {
      const tenth = decile ? `${decile}ᵉ dixième de France` : null;
      details.push(`Accès local : ${APL_STANDING_LABELS[standing] ?? '—'}${tenth ? ` · ${tenth}` : ''}`);
    }
    const at62 = commune[APL_62];
    if (Number.isFinite(value) && Number.isFinite(at62) && value > 0) {
      details.push(`Si les médecins de 62 ans et plus partaient : ${pct(at62 / value - 1)}`);
    }
  }

  const precision = context.precision?.[site[SITE_PRECISION]];
  if (precision && precision !== 'numero') {
    details.push(precision === 'commune'
      ? '⚠ position au centre de la commune, pas au cabinet'
      : `⚠ position à la ${precision}, pas au numéro`);
  }
  const registre = site[11];
  if (registre) details.push(`Adresse publiée par le registre : ${registre}`);

  return [title, ...details].join('\n');
}

/** The card for one département, in the national regime. */
export function buildDepartementCard(code, name, row, aplRow, stats) {
  const details = [];
  if (aplRow) {
    const value = aplRow[APL_DEP_65];
    details.push(`APL ${value?.toFixed?.(2) ?? '—'} consultations/habitant/an`);
    const standing = aplStanding(value, stats?.seuils);
    if (standing) details.push(APL_STANDING_LABELS[standing]);
    const at62 = aplRow[APL_DEP_62];
    const all = aplRow[0];
    if (Number.isFinite(at62) && Number.isFinite(all) && all > 0) {
      details.push(`Départs des 62 ans et plus : ${pct(at62 / all - 1)}`);
    }
    if (aplRow[APL_DEP_POPULATION]) details.push(`${fr(aplRow[APL_DEP_POPULATION])} habitants`);
  }
  if (row) {
    details.push(`${fr(row[0])} médecins · ${fr(row[1])} adresses`);
  }
  return [name || code, ...details].join('\n');
}

function overlayEntry(id, position, copy, accent = SELECTED_COLOR) {
  const [title, ...details] = copy.split('\n');
  return {
    id: String(id),
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title,
    details,
    accent,
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

/** Keep the most populated départements labelled, stably. */
export function selectLabelCohort(entries, limit = LABEL_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(LABEL_COHORT_LIMIT, Math.floor(Number(limit) || 0)));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice()
    .sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)))
    .slice(0, cap);
}

/**
 * A stable key for "the same view, for this layer's purposes".
 *
 * `moveEnd` and `changed` both fire on one gesture, and Cesium's rectangle
 * differs between them in the twelfth decimal — `48.777034637322785` against
 * `48.77703463732277`, which is 3 nanometres and was enough to send the same
 * 800 kB box twice. Quantising to 1e-4° (≈ 11 m) collapses them into one
 * without ever merging two views a reader could tell apart: the site regime
 * only ever draws boxes 0.6° wide or less, so 11 m is four thousandths of the
 * narrowest one.
 *
 * The regime is part of the key, so crossing a regime boundary always re-asks
 * even when the rectangle barely moved.
 */
export function boxKey(box, regime) {
  const q = (value) => Math.round(value * 1e4);
  return `${regime}:${q(box.south)}:${q(box.west)}:${q(box.north)}:${q(box.east)}`;
}

export function createMedecinsLayer({
  overlayHost = { setEntries: setOverlayEntries, clearSource: clearOverlaySource, setVisible: setOverlaySourceVisible },
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  let _viewer = null;
  let _points = null;
  let _clickHandler = null;
  let _enabled = false;
  let _loading = false;
  let _lastError = null;
  let _lastUpdate = null;

  let _national = null;
  let _mesh = null;
  let _meshPromise = null;
  let _depShapesPromise = null;
  let _depDataSource = null;
  let _depMeta = new Map();
  const _depEntities = new Map();

  let _regime = 'national';
  let _sites = [];
  let _sitesTruncated = false;
  let _sitesBox = null;
  let _records = new Map();
  let _selectedId = null;
  let _cameraRemovers = [];
  let _rowControlsListener = null;
  let _sitesToken = 0;
  let _paint = 'apl';
  let _nationalPromise = null;
  let _sitesAbort = null;
  let _lastServedKey = null;
  /** siteIndex → practitioner rows, fetched on the click that needs them. */
  const _practitionerCache = new Map();

  const renderId = (key) => `${RENDER_PREFIX}${key}`;

  function markerPosition(lat, lon) {
    const floor = cachedGroundFloor(lat, lon);
    return Cesium.Cartesian3.fromDegrees(lon, lat, (Number.isFinite(floor) ? floor : 0) + GROUND_LIFT_M);
  }

  function cameraBox() {
    const rectangle = _viewer?.camera?.computeViewRectangle?.();
    if (!rectangle) return null;
    const deg = Cesium.Math.toDegrees;
    return {
      south: deg(rectangle.south),
      west: deg(rectangle.west),
      north: deg(rectangle.north),
      east: deg(rectangle.east),
    };
  }

  async function fetchJson(url, signal) {
    const response = await fetchImpl(url, signal ? { signal } : undefined);
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    return response.json();
  }

  async function ensureNational() {
    if (_national) return _national;
    // Guarded, because `moveEnd` and `changed` both fire on the same gesture
    // and two un-guarded refreshes fetched this route twice on every boot.
    if (_nationalPromise) return _nationalPromise;
    _nationalPromise = fetchJson('/api/medecins-fr/national')
      .then((payload) => { _national = payload; return payload; })
      .catch((error) => { _nationalPromise = null; throw error; });
    return _nationalPromise;
  }

  async function ensureMesh() {
    if (_mesh) return _mesh;
    if (_meshPromise) return _meshPromise;
    _meshPromise = fetchJson('/api/medecins-fr/mesh')
      .then((payload) => { _mesh = payload; return payload; })
      .catch((error) => { _meshPromise = null; throw error; });
    return _meshPromise;
  }

  async function ensureDepartementShapes() {
    if (_depShapesPromise) return _depShapesPromise;
    _depShapesPromise = (async () => {
      const geojson = await (await fetchImpl(DEPARTEMENTS_URL)).json();
      _depMeta = parseDepartements(geojson);
      const source = await Cesium.GeoJsonDataSource.load(geojson, {
        clampToGround: true,
        fill: Cesium.Color.TRANSPARENT,
        stroke: Cesium.Color.TRANSPARENT,
        strokeWidth: 0,
      });
      source.name = 'Médecins (FR) — accessibilité par département';
      source.show = _enabled;
      for (const entity of source.entities.values) {
        const code = String(entity.properties?.code?.getValue?.() ?? '').trim();
        if (!entity.polygon || !code) { entity.show = false; continue; }
        entity.polygon.outline = false;
        entity.polygon.classificationType = Cesium.ClassificationType.BOTH;
        entity.polygon.material = new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT);
        entity.show = false;
        const parts = _depEntities.get(code);
        if (parts) parts.push(entity);
        else _depEntities.set(code, [entity]);
      }
      if (_viewer) await _viewer.dataSources.add(source);
      _depDataSource = source;
      return source;
    })().catch((error) => {
      // Retryable, never a permanently poisoned promise that leaves the
      // national view silently empty for the rest of the session.
      _depShapesPromise = null;
      throw error;
    });
    return _depShapesPromise;
  }

  /** The value a département is painted on, under the current chip. */
  function departementValue(code) {
    if (_paint === 'medecins') {
      const row = _national?.departements?.[code];
      const population = _national?.apl?.departements?.[code]?.[APL_DEP_POPULATION];
      if (!row || !population) return null;
      // Per 100 000 inhabitants — a raw count paints Paris and nothing else.
      return (row[0] / population) * 100_000;
    }
    return _national?.apl?.departements?.[code]?.[APL_DEP_65] ?? null;
  }

  function departementColor(code) {
    const value = departementValue(code);
    if (!Number.isFinite(value)) return null;
    if (_paint === 'medecins') {
      // Density has no policy thresholds, so it gets a plain five-step ramp
      // around the national figure rather than borrowed APL cuts.
      const steps = [90, 120, 150, 190];
      const index = steps.findIndex((step) => value <= step);
      return APL_BINS[index < 0 ? APL_BINS.length - 1 : index].color;
    }
    return APL_BINS[aplBin(value)]?.color ?? null;
  }

  function repaintDepartements() {
    if (!_national) return;
    const materials = new Map();
    const painted = new Set();
    for (const code of _depEntities.keys()) {
      const color = departementColor(code);
      if (!color) continue;
      let material = materials.get(color);
      if (!material) {
        material = new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(color).withAlpha(0.55));
        materials.set(color, material);
      }
      painted.add(code);
      for (const entity of _depEntities.get(code)) {
        if (!entity.polygon) continue;
        entity.polygon.material = material;
        entity.show = _regime === 'national';
      }
    }
    // A département the rollup does not cover is drawn as absence, not as the
    // bottom of the scale. Overseas départements have no APL row at all.
    for (const [code, parts] of _depEntities) {
      if (painted.has(code)) for (const entity of parts) entity.show = _regime === 'national';
      else for (const entity of parts) entity.show = false;
    }
    _viewer?.scene?.requestRender?.();
  }

  function publishDepartementLabels() {
    if (!_enabled || _regime !== 'national' || !_national) {
      overlayHost.clearSource(LABEL_SOURCE_ID);
      return;
    }
    const entries = [];
    for (const [code, meta] of _depMeta) {
      const anchor = meta?.anchor;
      const value = departementValue(code);
      if (!anchor || !Number.isFinite(value)) continue;
      const population = _national.apl?.departements?.[code]?.[APL_DEP_POPULATION] ?? 0;
      entries.push({
        id: `medecins-fr:dep:${code}`,
        position: Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
        variant: 'label',
        title: `${meta.name ?? code} · ${_paint === 'apl' ? value.toFixed(2) : Math.round(value)}`,
        accent: departementColor(code) ?? '#38bdf8',
        priority: population,
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 15,
        verticalOnly: true,
        placement: 'above',
      });
    }
    overlayHost.setEntries(LABEL_SOURCE_ID, selectLabelCohort(entries), {
      cohortLimit: LABEL_COHORT_LIMIT,
      collisionCapacity: LABEL_COLLISION_CAPACITY,
    });
  }

  function clearSelection() {
    _selectedId = null;
    overlayHost.clearSource(OVERLAY_SOURCE_ID);
    governorRequestRender('medecins-fr-clear');
  }

  function paintSiteCard(id, record, praticiens) {
    const copy = buildSiteCard(record.site, praticiens, {
      specialites: _national?.specialites,
      precision: _national?.precision,
      apl: _national?.apl,
    });
    overlayHost.setEntries(
      OVERLAY_SOURCE_ID,
      [overlayEntry(`${id}:card`, record.position, copy, FAMILY_COLORS[record.family] ?? SELECTED_COLOR)],
      OVERLAY_SOURCE_OPTIONS,
    );
    governorRequestRender('medecins-fr-select');
  }

  /**
   * Open a card, and fetch the doctors' names for it.
   *
   * The names are NOT in the `/sites` payload on purpose — over central Paris
   * they were 40 % of 1 451 kio, shipped to draw 5 907 dots of which a reader
   * opens one. So the card paints immediately from what the dot already knows,
   * and fills in the names when they land. Cached per address, because a
   * reader who closes a card and reopens it should not pay twice.
   */
  function selectSite(id) {
    const record = _records.get(id);
    if (!record) return;
    _selectedId = id;
    const cached = _practitionerCache.get(record.index);
    paintSiteCard(id, record, cached ?? null);
    if (cached || record.index === undefined) return;
    fetchJson(`/api/medecins-fr/praticiens?index=${record.index}`)
      .then((payload) => {
        _practitionerCache.set(record.index, payload.praticiens ?? []);
        // Only if the reader is still looking at this card.
        if (_selectedId === id) paintSiteCard(id, record, payload.praticiens ?? []);
      })
      .catch(() => { /* the card is already useful without the names */ });
  }

  function selectDepartement(code) {
    const anchor = _depMeta.get(code)?.anchor;
    if (!anchor) return;
    _selectedId = `dep:${code}`;
    const copy = buildDepartementCard(
      code,
      _depMeta.get(code)?.name,
      _national?.departements?.[code],
      _national?.apl?.departements?.[code],
      { seuils: _national?.apl?.seuils },
    );
    overlayHost.setEntries(
      OVERLAY_SOURCE_ID,
      [overlayEntry(`medecins-fr:dep-card:${code}`, Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]), copy)],
      OVERLAY_SOURCE_OPTIONS,
    );
    governorRequestRender('medecins-fr-select-dep');
  }

  function repaintPoints(rows) {
    if (!_points) return;
    _points.removeAll();
    _records = new Map();
    for (const row of rows) {
      const id = renderId(row.key);
      const position = markerPosition(row.lat, row.lon);
      const color = Cesium.Color.fromCssColorString(FAMILY_COLORS[row.family] ?? FAMILY_COLORS.specialiste);
      _points.add({
        id,
        position,
        pixelSize: medecinPixelSize(row.practitioners),
        color,
        outlineColor: COLOR_OUTLINE,
        outlineWidth: 1,
        translucencyByDistance: undefined,
      });
      _records.set(id, { ...row, position });
    }
    restoreSpriteOrder();
    _viewer?.scene?.requestRender?.();
  }

  async function renderMesh(box) {
    const payload = await ensureMesh();
    const budget = medecinsMeshBudget(box.north - box.south);
    const { picked } = selectMedecinsMesh(payload.sites, { box, budget });
    repaintPoints(picked.map((row, index) => ({
      key: `mesh:${index}:${row[MESH_LAT]}:${row[MESH_LON]}`,
      lat: row[MESH_LAT],
      lon: row[MESH_LON],
      practitioners: row[MESH_PRACTITIONERS],
      family: MEDECIN_FAMILIES[row[MESH_FAMILY]] ?? 'specialiste',
      site: null,
      praticiens: null,
    })));
  }

  async function renderSites(box) {
    const token = ++_sitesToken;
    // A superseded request is cancelled rather than left to arrive and be
    // discarded: a drag across Paris otherwise leaves several 800 kB responses
    // downloading and parsing for viewports nobody is looking at any more.
    _sitesAbort?.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    _sitesAbort = controller;
    const params = new URLSearchParams({
      south: String(box.south), west: String(box.west), north: String(box.north), east: String(box.east),
    });
    let payload;
    try {
      payload = await fetchJson(`/api/medecins-fr/sites?${params}`, controller?.signal);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      throw error;
    }
    if (token !== _sitesToken) return;
    _sites = payload.sites;
    _sitesTruncated = Boolean(payload.truncated);
    _sitesBox = box;
    repaintPoints(payload.sites.map((entry) => ({
      key: `site:${entry.index}`,
      index: entry.index,
      lat: entry.site[SITE_LAT],
      lon: entry.site[SITE_LON],
      practitioners: entry.site[SITE_PRACTITIONERS],
      family: sitePrimaryFamily(entry.site),
      site: entry.site,
    })));
  }

  /** The one place the three regimes are chosen between. */
  async function refresh({ force = false } = {}) {
    if (!_enabled || !_viewer) return;
    const box = cameraBox();
    if (!box) return;
    const span = box.north - box.south;
    const regime = medecinsRegime(span);
    const changed = regime !== _regime;
    const key = boxKey(box, regime);
    if (!force && !changed && key === _lastServedKey && !_lastError) return;
    _lastServedKey = key;
    _regime = regime;
    _loading = true;
    _lastError = null;
    try {
      await ensureNational();
      if (regime === 'national') {
        await ensureDepartementShapes();
        repaintDepartements();
        publishDepartementLabels();
        repaintPoints([]);
      } else {
        if (changed) { repaintDepartements(); publishDepartementLabels(); }
        // The proxy refuses a box wider than its ceiling, and the ceiling bites
        // before the regime gate does on a wide-but-short viewport.
        const wide = (box.east - box.west) > MEDECINS_MAX_BOX_DEG;
        if (regime === 'sites' && !wide) await renderSites(box);
        else await renderMesh(box);
      }
      _lastUpdate = Date.now();
    } catch (error) {
      _lastError = error?.message || String(error);
      // A failed view must be retryable: keeping its key would make every
      // later camera event skip the retry as "already served".
      _lastServedKey = null;
    } finally {
      _loading = false;
      _rowControlsListener?.();
      governorRequestRender('medecins-fr-refresh');
    }
  }

  function installClickHandler(viewer) {
    if (_clickHandler) return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.position);
      const id = picked?.id;
      if (typeof id === 'string' && _records.has(id)) { selectSite(id); return; }
      if (_regime === 'national') {
        const code = String(picked?.id?.properties?.code?.getValue?.() ?? '').trim();
        if (code && _depEntities.has(code)) { selectDepartement(code); return; }
      }
      if (_selectedId) clearSelection();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClickHandler() {
    _clickHandler?.destroy?.();
    _clickHandler = null;
  }

  const layer = {
    id: MEDECINS_FR_LAYER_ID,
    name: 'Médecins (FR)',
    icon: '✚',
    source: 'CNAM + DREES',
    // The pack is a shipped file. A finite interval exists only so a first
    // load that failed heals itself.
    updateInterval: 1_800_000,

    init(viewer) {
      _viewer = viewer;
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      viewer.scene.primitives.add(_points);
      _points.show = false;
      registerSpriteCollection(MEDECINS_FR_LAYER_ID, _points);
      registerPickOwner(MEDECINS_FR_LAYER_ID, (pickedId) => (
        typeof pickedId === 'string' && pickedId.startsWith(RENDER_PREFIX)
      ));
      overlayHost.setVisible(OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(LABEL_SOURCE_ID, false);
      console.log('[Data:Médecins FR] Initialized');
    },

    async enable(viewer) {
      _enabled = true;
      if (viewer) installClickHandler(viewer);
      if (_points) _points.show = true;
      if (_depDataSource) _depDataSource.show = true;
      overlayHost.setVisible(OVERLAY_SOURCE_ID, true);
      overlayHost.setVisible(LABEL_SOURCE_ID, true);
      // Both camera events, for the reason the hydro layer documents: `moveEnd`
      // misses programmatic placement (which is exactly what a share link is),
      // and `changed` misses the end of a gesture.
      const follow = () => { if (_enabled) refresh(); };
      if (!_cameraRemovers.length) {
        for (const event of [_viewer?.camera?.moveEnd, _viewer?.camera?.changed]) {
          if (event?.addEventListener) _cameraRemovers.push(event.addEventListener(follow));
        }
      }
      await refresh({ force: true });
    },

    disable() {
      _enabled = false;
      if (_points) { _points.show = false; _points.removeAll(); }
      if (_depDataSource) _depDataSource.show = false;
      for (const parts of _depEntities.values()) for (const entity of parts) entity.show = false;
      overlayHost.clearSource(OVERLAY_SOURCE_ID);
      overlayHost.clearSource(LABEL_SOURCE_ID);
      overlayHost.setVisible(OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(LABEL_SOURCE_ID, false);
      removeClickHandler();
      for (const remove of _cameraRemovers) remove();
      _cameraRemovers = [];
      _records = new Map();
      _selectedId = null;
      _sites = [];
      _lastServedKey = null;
      _sitesAbort?.abort();
      _sitesAbort = null;
    },

    async update() {
      if (!_enabled) return;
      await refresh({ force: true });
    },

    destroy(viewer) {
      this.disable();
      unregisterSpriteCollection(MEDECINS_FR_LAYER_ID);
      unregisterPickOwner(MEDECINS_FR_LAYER_ID);
      if (_points) { viewer?.scene?.primitives?.remove?.(_points); _points = null; }
      if (_depDataSource) { viewer?.dataSources?.remove?.(_depDataSource, true); _depDataSource = null; }
      _depEntities.clear();
      _depShapesPromise = null;
      _depMeta = new Map();
      _viewer = null;
      _national = null;
      _mesh = null;
      _meshPromise = null;
      _lastUpdate = null;
      _lastError = null;
    },

    setParams(params = {}) {
      if (params.paint === undefined) return false;
      const paint = params.paint === 'medecins' ? 'medecins' : 'apl';
      if (paint === _paint) return false;
      _paint = paint;
      if (_regime === 'national') { repaintDepartements(); publishDepartementLabels(); }
      if (_selectedId?.startsWith('dep:')) selectDepartement(_selectedId.slice(4));
      _rowControlsListener?.();
      governorRequestRender('medecins-fr-paint');
      return true;
    },

    getParams() { return { paint: _paint }; },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getRowControls() {
      const chips = [
        {
          id: 'medecins-paint-apl',
          label: 'Accès',
          active: _paint === 'apl',
          state: _paint === 'apl' ? 'active' : 'idle',
          title: 'Peindre l’accessibilité (APL DREES) — combien de consultations un habitant peut atteindre',
          params: { paint: 'apl' },
        },
        {
          id: 'medecins-paint-count',
          label: 'Densité',
          active: _paint === 'medecins',
          state: _paint === 'medecins' ? 'active' : 'idle',
          title: 'Peindre le nombre de médecins pour 100 000 habitants',
          params: { paint: 'medecins' },
        },
      ];
      const legend = _regime === 'national'
        ? APL_BINS.map((bin, index) => ({ color: bin.color, label: _paint === 'apl' ? bin.label : `niveau ${index + 1}` }))
        : MEDECIN_FAMILIES.map((family) => ({
          color: FAMILY_COLORS[family],
          label: MEDECIN_FAMILY_LABELS[family],
        }));
      return { chips, legend };
    },

    getStats() {
      const stats = _national?.stats ?? null;
      return {
        count: _records.size,
        lastUpdate: _lastUpdate,
        loading: _loading,
        error: _lastError,
        stale: false,
        regime: _regime,
        truncated: _sitesTruncated,
        // The register's own figures, whatever the viewport shows. `medecins`
        // is the distinct-name count and `entrees` the row count; they are
        // different questions and both are published so neither impersonates
        // the other.
        adresses: stats?.adressesLocalisees ?? null,
        medecins: stats?.medecinsNommes ?? null,
        entrees: stats?.lignesMedecin ?? null,
        nonLocalisees: _national?.nonLocalisees ?? null,
        aplMillesime: _national?.apl?.millesime ?? null,
        aplNational: _national?.apl?.national ?? null,
        edition: _national?.source?.ps?.modified ?? null,
        generated: _national?.generated ?? null,
      };
    },
  };

  return layer;
}

const medecinsFranceLayer = createMedecinsLayer();

export default medecinsFranceLayer;
