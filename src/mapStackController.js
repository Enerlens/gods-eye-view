import * as Cesium from 'cesium';
import { governorRequestRender } from './renderGovernor.js';
import { IgnBilTerrainProvider } from './data/ignBilTerrain.js';
import { createGoogleMapTilesProvider } from './data/googleMapTiles.js';

export const MAP_STACKS = [
  {
    id: 'photoreal',
    label: 'Google 3D',
    shortLabel: '3D',
    kind: 'photoreal',
    requiresIon: false,
  },
  // ── Google 2D Map Tiles (same key as the 3D globe, no ion token) ──────────
  // These two exist because the EEA withdrawal is narrower than its error
  // message: Google refuses `satellite` and 3D tiles to an EEA billing
  // address but serves `roadmap` and `terrain` on the very same key. So a
  // build whose "Google 3D" chip is permanently dead can still show Google's
  // cartography. See src/data/googleMapTiles.js for the measured evidence.
  {
    id: 'google-roadmap',
    label: 'Plan Google',
    shortLabel: 'Plan G',
    kind: 'google-2d',
    requiresIon: false,
    google2d: { mapType: 'roadmap', scale: 'scaleFactor2x' },
  },
  {
    id: 'google-terrain',
    label: 'Relief Google',
    shortLabel: 'Relief G',
    kind: 'google-2d',
    requiresIon: false,
    google2d: { mapType: 'terrain', scale: 'scaleFactor2x' },
  },
  {
    id: 'bing-aerial',
    label: 'Bing Aerial',
    shortLabel: 'Aerial',
    kind: 'ion',
    style: Cesium.IonWorldImageryStyle.AERIAL,
    requiresIon: true,
  },
  {
    id: 'bing-labels',
    label: 'Bing Labels',
    shortLabel: 'Labels',
    kind: 'ion',
    style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS,
    requiresIon: true,
  },
  {
    id: 'osm',
    label: 'OSM',
    shortLabel: 'OSM',
    kind: 'osm',
    requiresIon: false,
  },
  // ── IGN Géoplateforme (keyless, France only) ───────────────────────────────
  // The two stacks that make a keyless build worth looking at. `data.geopf.fr`
  // serves WMTS with `access-control-allow-origin: *` and no key of any kind,
  // and the WMTS/TMS endpoints are not rate-limited (unlike the vector-tile
  // ones). Coverage is France + DOM; this pass ships metropolitan France only
  // (`IGN_FRANCE_RECTANGLE`), because the DOM sit in three different vertical
  // systems and belong with the terrain work, not here.
  {
    id: 'ign-ortho',
    label: 'IGN Ortho',
    shortLabel: 'Ortho',
    kind: 'ign-wmts',
    requiresIon: false,
    coverageNote: 'metropolitan France only',
    wmts: {
      layer: 'ORTHOIMAGERY.ORTHOPHOTOS',
      format: 'image/jpeg',
      maximumLevel: 19,
    },
  },
  {
    id: 'ign-plan',
    label: 'Plan IGN',
    shortLabel: 'Plan',
    kind: 'ign-wmts',
    requiresIon: false,
    coverageNote: 'metropolitan France only',
    wmts: {
      layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
      format: 'image/png',
      maximumLevel: 19,
    },
  },
];

const DEFAULT_OSM_CREDIT = '© OpenStreetMap contributors';

/** Longest provider sentence that still belongs in a chip tooltip. */
const PROVIDER_ERROR_MAX_CHARS = 200;

/**
 * One readable line out of whatever a tile provider threw.
 *
 * Cesium rejects a failed tile request with a `RequestErrorEvent` — a plain
 * object with `statusCode`, `response` and `responseHeaders` and NO `message` —
 * so the generic "serialize it" fallback produces nine hundred characters of
 * gzip headers. The useful part is two fields deep, inside a JSON string:
 * Google's actual sentence about why (quota, region, a key restricted to
 * another referrer) lives at `response.error.message`. A tooltip nobody can
 * read is the same as no tooltip, which is the failure this whole path exists
 * to end.
 * @param {*} raw - Anything a provider or `describeError` produced.
 * @returns {string} `HTTP 403 — <provider sentence>`, the sentence alone, or ''.
 */
export function summarizeProviderError(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  let status = null;
  let message = text;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      if (Number.isFinite(parsed.statusCode)) status = parsed.statusCode;
      let body = parsed.response;
      // The body is a JSON STRING inside the serialized event, so it needs its
      // own parse; a plain-text body is kept as-is.
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { /* plain text body */ }
      }
      const inner = body && typeof body === 'object'
        ? (body.error?.message || body.message)
        : body;
      message = String(inner || parsed.message || '').trim();
      if (!message && status === null) message = text;
    }
  } catch { /* not JSON — it is already a sentence */ }
  message = message.replace(/\s+/g, ' ').trim();
  if (message.length > PROVIDER_ERROR_MAX_CHARS) {
    message = `${message.slice(0, PROVIDER_ERROR_MAX_CHARS - 1)}…`;
  }
  if (status === null) return message;
  return message ? `HTTP ${status} — ${message}` : `HTTP ${status}`;
}

/** Keyless IGN Géoplateforme WMTS endpoint (no key, no token, CORS-open). */
const IGN_WMTS_URL = 'https://data.geopf.fr/wmts';

/**
 * Metropolitan France + Corsica, in degrees. Two jobs, both load-bearing:
 *
 * 1. It bounds the IGN layer, so Cesium never requests a tile the
 *    Géoplateforme has nothing for. Without it the provider issues 404s for
 *    the whole planet on every zoom — the declared layer bbox is useless as a
 *    coverage mask, since it is the bounding box of France UNION the DOM and
 *    therefore spans most of the globe.
 * 2. It is why the IGN stacks need TWO imagery layers (see
 *    `_activateGlobeStack`): a rectangle-limited layer sitting at index 0 is
 *    Cesium's BASE layer, and Cesium smears a base layer's edge pixels across
 *    every tile outside its bounds rather than leaving them blank. France's
 *    coastline would paint the Atlantic and then the rest of Earth.
 *
 * DOM-TOM are deliberately outside this pass.
 */
export const IGN_FRANCE_RECTANGLE = Object.freeze({
  west: -5.5, south: 41.2, east: 9.8, north: 51.2,
});

// Keyless global ellipsoidal terrain (Re:Earth Terrain / Mapterhorn, CC BY 4.0,
// EGM2008 geoid via NGA) — quantized-mesh 1.0, `ellipsoid` data-type. Fixes
// regime C (keyless globe stacks previously rendered a flat
// EllipsoidTerrainProvider — see the height-datum contract in docs/CURRENT-STATE.md
// §1a). Constructed via `.fromUrl()`, never a hand-built `{z}/{x}/{y}.terrain`
// URL (spec correction, spec §1a).
const REEARTH_TERRAIN_URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';

/**
 * Builds the keyless IGN Geoplateforme WMTS imagery provider for one stack.
 *
 * Four details are load-bearing and each was checked against a live
 * `data.geopf.fr` GetCapabilities on 2026-08-28:
 *
 * - `style: 'normal'` is REQUIRED. Cesium's `WebMapTileServiceImageryProvider`
 *   throws synchronously without it, and IGN publishes exactly one style named
 *   `normal` for both layers — so omitting it fails the switch, it does not
 *   quietly pick a default.
 * - `tileMatrixSetID: 'PM'` is IGN's Web Mercator set, and it is bit-for-bit
 *   Cesium's default `WebMercatorTilingScheme`: 256 px tiles, top-left
 *   -20037508.34/+20037508.34, a single tile at level 0. The layers declare the
 *   `PM_0_19` subset, but the server accepts plain `PM` for the same tiles, and
 *   `PM` is the set whose level ids match Cesium's own.
 * - `tileMatrixLabels` must be the STRING level ids `'0'..'19'`; Cesium passes
 *   the label through verbatim as `TILEMATRIX`.
 * - `rectangle` is the France clamp. See `IGN_FRANCE_RECTANGLE`.
 * @param {object} stack - An `ign-wmts` descriptor from `MAP_STACKS`.
 * @returns {Cesium.WebMapTileServiceImageryProvider}
 */
export function createIgnWmtsProvider(stack) {
  const { layer, format, maximumLevel } = stack.wmts;
  return new Cesium.WebMapTileServiceImageryProvider({
    url: IGN_WMTS_URL,
    layer,
    style: 'normal',
    format,
    tileMatrixSetID: 'PM',
    tileMatrixLabels: Array.from({ length: maximumLevel + 1 }, (_, level) => String(level)),
    maximumLevel,
    rectangle: Cesium.Rectangle.fromDegrees(
      IGN_FRANCE_RECTANGLE.west,
      IGN_FRANCE_RECTANGLE.south,
      IGN_FRANCE_RECTANGLE.east,
      IGN_FRANCE_RECTANGLE.north,
    ),
    // The on-globe line. Etalab 2.0 wants the source named where the data is
    // shown; the fuller notice, with the product edition, is the static entry
    // `registerDataCredits()` puts in the "Data attribution" popover.
    credit: new Cesium.Credit('© IGN — Géoplateforme', true),
  });
}

/**
 * Controls the active globe/map stack. Google Photorealistic 3D Tiles remain
 * the cinematic default, while Cesium ion world imagery, OSM, and the keyless
 * IGN Geoplateforme stacks run as globe imagery stacks.
 */
export class MapStackController {
  constructor(viewer, {
    googleTileset = null,
    cesiumToken = '',
    googleKeyConfigured = null,
    googleTilesetError = '',
    ignTerrainSpike = false,
    initialStack = 'photoreal',
    onChange = null,
    onError = null,
  } = {}) {
    this.viewer = viewer;
    this.googleTileset = googleTileset;
    this.cesiumToken = String(cesiumToken || '').trim();
    // Why `photoreal` is unavailable, when it is: a build with NO Google key
    // (the keyless build) and a keyed build whose tileset failed to load are
    // the same `googleTileset === null` here but need opposite advice. Default
    // `null` means "caller didn't say" and keeps the old generic wording, so a
    // controller built by a test or a tool doesn't start claiming a cause it
    // has no evidence for.
    this.googleKeyConfigured = googleKeyConfigured;
    // WHY the photoreal tileset is missing, in the provider's own words —
    // quota, network, a key restricted to another referrer. Boot used to
    // swallow this: `main.js` caught the error, showed the Cesium globe, and
    // the app opened on OSM with nothing on screen saying the source had
    // changed. The map source a reader is looking at is not a detail they can
    // be left to infer, so the controller carries the cause and the tray says
    // it. Empty means photoreal was never attempted (keyless build, or a
    // caller that did not say).
    this.googleTilesetError = summarizeProviderError(googleTilesetError);
    // DEV-ONLY SPIKE (`?ign_terrain=1`). Replaces the keyless terrain provider
    // with IGN RGE ALTI over France, and FORCES the keyless branch even when an
    // ion token is present — the point of the spike is to look at IGN terrain,
    // and Cesium World Terrain would silently win on a keyed machine. Read once
    // at construction: a flag that could flip mid-session would leave meshed
    // tiles from two different datums on the globe at the same time.
    // See src/data/ignBilTerrain.js for why this must never be the default.
    this.ignTerrainSpike = ignTerrainSpike === true;
    this._onChange = onChange;
    this._onError = onError;
    // `initialStack` is honoured whenever it can actually be shown; the guard
    // at the end of this constructor is what handles the case where it cannot.
    // It used to be overridden with 'osm' outright whenever the 3D tileset was
    // missing, which made a caller's choice of startup stack unreachable on
    // exactly the builds that have one to make.
    this._activeId = initialStack;
    // A stack owns an ORDERED LIST of imagery layers, not one layer: the IGN
    // stacks are OSM (base, index 0) + IGN France (index 1). Bottom-first.
    this._imageryLayers = [];
    this._imageryProviders = new Map();
    this._isSwitching = false;
    this._lastError = null;
    // Tracks which terrain PROVIDER is actually installed on the scene, not
    // just an ion-available boolean: 'world' (Cesium World Terrain, ion
    // token), 'keyless' (Re:Earth or its Ellipsoid fallback), or null (never
    // set yet — Cesium's own startup default). Using a tri-state here (rather
    // than the `enabled` boolean `_setWorldTerrainEnabled` receives) matters
    // because both the "never set" and "keyless" states pass `enabled=false`;
    // collapsing them to a boolean would make the first real keyless switch
    // a no-op against the initial `false` default and leave Cesium's built-in
    // provider in place instead of installing Re:Earth terrain.
    this._terrainMode = null;
    // Cache of the constructed keyless Re:Earth CesiumTerrainProvider, so
    // repeat switches into a keyless globe stack don't refetch `layer.json`.
    // Lives independently of `_switchGen` — construction is async and racy
    // switches are guarded where it's awaited (`_setWorldTerrainEnabled`).
    this._reearthTerrainProvider = null;
    // Monotonic switch counter. setStack() awaits network-bound provider
    // creation; a rapid A→B switch where A (e.g. slow Bing) resolves AFTER B
    // (fast OSM) would otherwise revert the user's last choice (M7). Each call
    // captures a generation and aborts its own commit once superseded.
    this._switchGen = 0;
    // Whether a switch has actually built the scene yet. `_activeId` is seeded
    // in this constructor, BEFORE anything is on the globe, so the re-entry
    // short-circuit in `setStack()` cannot key on the id alone — it would swallow
    // the one boot call that builds the imagery in the first place.
    this._activated = false;
    // Cleared by the first DELIBERATE switch: once someone picks a source, the
    // globe is the one they asked for and the boot fallback is no longer news.
    this._bootNoticeDismissed = false;
    // Imagery layers CONSTRUCTED this page load — the reload bug's own number.
    // A share link that opens on its own basemap must cost exactly what a plain
    // load of that basemap costs, and nothing but a counter proves it.
    this._imageryBuilds = 0;

    if (!this.getStack(this._activeId) || !this.isStackAvailable(this._activeId)) {
      // The startup ladder, mirroring the one main.js applies: the 3D globe,
      // else Google's 2D cartography when the key is KNOWN to exist (the EEA
      // case — 3D and satellite are withheld, roadmap and terrain are not),
      // else OSM. A `null` key flag — the caller never said — deliberately
      // stays on OSM rather than landing on a stack whose session call would
      // answer 503 for want of a key.
      if (googleTileset) this._activeId = 'photoreal';
      else if (this.googleKeyConfigured === true) this._activeId = 'google-roadmap';
      else this._activeId = 'osm';
    }
  }

  getStacks() {
    return MAP_STACKS.map((stack) => {
      const available = this.isStackAvailable(stack.id);
      return {
        ...stack,
        available,
        // Why this stack can't be picked, from the ONE place that decides it.
        // A stack can be unavailable for reasons other than a missing ion
        // token (photoreal is unavailable when the Google tileset failed to
        // load), so callers must not infer the reason from `available` alone.
        unavailableReason: available ? null : this._unavailableReason(stack),
      };
    });
  }

  /**
   * Human-readable reason a stack can't be activated. Shared by `getStacks()`
   * and `setStack()` so the tooltip and the toast never drift apart.
   * @param {object} stack - Stack descriptor.
   * @returns {string}
   */
  _unavailableReason(stack) {
    if (stack?.requiresIon) return 'Cesium ion token required for Bing stacks';
    if (stack?.kind === 'photoreal' && this.googleKeyConfigured === false) {
      return 'Google Maps API key required for Google 3D';
    }
    if (stack?.kind === 'photoreal' && this.googleKeyConfigured === true) {
      return this.googleTilesetError
        ? `Google 3D Tiles failed to load: ${this.googleTilesetError}`
        : 'Google 3D Tiles failed to load';
    }
    if (stack?.kind === 'google-2d') {
      return `Google Maps API key required for ${stack.label}`;
    }
    return `${stack?.label || 'This map stack'} is unavailable`;
  }

  getStack(id) {
    return MAP_STACKS.find((stack) => stack.id === id) || null;
  }

  getActiveId() {
    return this._activeId;
  }

  /**
   * Monotonic id of the most recently STARTED switch.
   *
   * A switch is only superseded by another `setStack()` — nothing else moves
   * this number — so a caller that must know whether the globe it is looking
   * at is still the one IT asked for can compare this across its own await.
   * Unchanged (or advanced by exactly its own call) means no newer switch has
   * claimed the globe.
   * @returns {number}
   */
  getSwitchGeneration() {
    return this._switchGen;
  }

  getActiveStack() {
    return this.getStack(this._activeId);
  }

  isStackAvailable(id) {
    const stack = this.getStack(id);
    if (!stack) return false;
    if (stack.kind === 'photoreal') return !!this.googleTileset;
    // `google-2d` needs the Google key but NOT a loaded 3D tileset: these are
    // exactly the stacks that work when photoreal does not. Only an explicit
    // `false` (the keyless build said so) makes them unavailable — `null`
    // means the caller never said, and guessing "missing" would hide a
    // working basemap from every controller built by a test or a tool.
    if (stack.kind === 'google-2d') return this.googleKeyConfigured !== false;
    if (stack.requiresIon) return !!this.cesiumToken;
    return true;
  }

  /**
   * Where an UNRECOGNIZED stack id lands.
   *
   * `photoreal` when it can actually be shown, else the first stack that can.
   * The distinction matters because an unknown id is not a request for a
   * particular source — it is a retired or corrupted `map=` share param — so
   * resolving it to a source this build cannot show would raise a credential
   * error about a stack nobody asked for. A DELIBERATE request for an
   * unavailable stack still errors; that one is a real answer to a real ask.
   * @returns {object} An available stack descriptor, or OSM as the last resort.
   */
  _fallbackStack() {
    if (this.isStackAvailable('photoreal')) return this.getStack('photoreal');
    return MAP_STACKS.find((stack) => this.isStackAvailable(stack.id)) || this.getStack('osm');
  }

  /**
   * Activate a map stack.
   *
   * RE-ENTRY IS A NO-OP, and that is load-bearing rather than an optimization.
   * `_activateGlobeStack()` DESTROYS and REBUILDS every imagery layer, so the
   * new `Cesium.ImageryLayer` instances start from an empty tile cache and
   * re-refine coarse→sharp in full view of the reader. Replaying the stack that
   * is already on the globe therefore costs a visible reload of a map that did
   * not change — which is exactly what a share link used to buy: boot activated
   * a stack, the hash restore replayed the same id a moment later, and the globe
   * blurred and re-sharpened for nothing.
   * @param {string} id - Stack id; an unrecognized one resolves to {@link _fallbackStack}.
   * @param {{silent?: boolean}} [options] - `silent` suppresses the change events.
   * @returns {Promise<object|null>} Controller state, or null for an empty registry.
   */
  async setStack(id, { silent = false } = {}) {
    const stack = this.getStack(id) || this._fallbackStack();
    if (!stack) return null;

    if (this._activated && stack.id === this._activeId && !this._isSwitching) {
      return this.getState();
    }

    if (!this.isStackAvailable(stack.id)) {
      const message = this._unavailableReason(stack);
      this._lastError = message;
      this._onError?.(message, stack);
      return this.getState();
    }

    const gen = ++this._switchGen;
    this._isSwitching = true;
    this._lastError = null;
    if (!silent) {
      // Boot activates silently; anything else is somebody choosing, and once
      // somebody has chosen, the boot fallback is no longer news.
      this._bootNoticeDismissed = true;
      this._emitChange('switching');
    }

    try {
      if (stack.kind === 'photoreal') {
        await this._activatePhotoreal(gen);
      } else {
        await this._activateGlobeStack(stack, gen);
      }
      // A newer switch started while we were awaiting the provider — that call
      // owns the final state now, so don't commit ours or emit a stale 'ready'.
      if (gen !== this._switchGen) return this.getState();
      this._activeId = stack.id;
      this._activated = true;
      // Show/hide of tilesets + imagery swaps need a frame in idle mode;
      // subsequent tile loads self-request via Cesium. (perf wave 2)
      governorRequestRender('map-stack');
      if (!silent) this._emitChange('ready');
    } catch (error) {
      if (gen !== this._switchGen) return this.getState();
      const message = error?.message || String(error);
      this._lastError = message;
      this._onError?.(message, stack);
      if (this.googleTileset) {
        await this._activatePhotoreal(gen);
        if (gen !== this._switchGen) return this.getState();
        this._activeId = 'photoreal';
        this._activated = true;
      }
      if (!silent) this._emitChange('error');
    } finally {
      // Only the latest switch clears the switching flag; a superseded call
      // must not stomp a newer switch that is still in progress.
      if (gen === this._switchGen) this._isSwitching = false;
    }

    return this.getState();
  }

  /**
   * The startup fallback, said out loud.
   *
   * Distinct from `lastError`, which belongs to a switch somebody ASKED for and
   * which the tray turns into a toast. This is the quieter failure: the app
   * opened on a source nobody chose because the one it wanted could not load.
   * It rides on the status chip until the first deliberate pick.
   * @returns {string|null}
   */
  _bootNotice() {
    if (this._bootNoticeDismissed) return null;
    // No recorded failure, or photoreal is on the globe after all: nothing to say.
    if (!this.googleTilesetError || this._activeId === 'photoreal') return null;
    const label = this.getActiveStack()?.label || this._activeId;
    return `Google 3D Tiles failed to load: ${this.googleTilesetError} — showing ${label}`;
  }

  /**
   * Imagery layers built since the page loaded. Diagnostics only — the QA
   * harness compares it against the number of stacks actually asked for.
   * @returns {number}
   */
  getImageryBuildCount() {
    return this._imageryBuilds;
  }

  getState(status = this._isSwitching ? 'switching' : 'ready') {
    return {
      activeId: this._activeId,
      activeStack: this.getActiveStack(),
      stacks: this.getStacks(),
      status,
      lastError: this._lastError,
      // Never folded into `lastError`: that field means "the switch you asked
      // for did not happen", and a caller that toasts it must not start
      // toasting a boot fallback nobody requested.
      notice: this._bootNotice(),
      hasCesiumIonToken: !!this.cesiumToken,
    };
  }

  async _activatePhotoreal(gen) {
    this._removeImageryLayers();
    if (this.googleTileset) this.googleTileset.show = true;
    this.viewer.scene.globe.show = false;
    // Terrain is left UNTOUCHED here. The photoreal globe is hidden
    // (`globe.show = false`), so the terrain provider is inert — it renders and
    // streams nothing. Routing this through `_setWorldTerrainEnabled(false)`
    // would make the DEFAULT startup stack await a keyless Re:Earth `layer.json`
    // fetch it can't use, delaying photoreal boot on a slow/blocked network and
    // (on failure) caching the flat `EllipsoidTerrainProvider` fallback for
    // later OSM switches. The Re:Earth fetch is therefore lazy: it happens on
    // the first switch to an actual globe stack (`_activateGlobeStack`).
    // `_terrainMode` is intentionally not changed — every globe-stack transition
    // re-derives the correct provider from it (null/'world'/'keyless'), so
    // leaving it as-is keeps the next switch correct without a photoreal fetch.
    void gen;
  }

  async _activateGlobeStack(stack, gen) {
    const providers = await this._getStackProviders(stack);
    // A newer switch started while the provider was resolving — don't touch the
    // scene's imagery layers, the winning switch already owns them (M7).
    if (gen != null && gen !== this._switchGen) return;
    this._removeImageryLayers();

    // Added bottom-first at ascending indices, so `providers[0]` is Cesium's
    // BASE layer and later entries composite over it.
    providers.forEach((provider, index) => {
      const layer = new Cesium.ImageryLayer(provider);
      this.viewer.imageryLayers.add(layer, index);
      this._imageryLayers.push(layer);
      this._imageryBuilds += 1;
    });

    if (this.googleTileset) this.googleTileset.show = false;
    this.viewer.scene.globe.show = true;
    await this._setWorldTerrainEnabled(!!this.cesiumToken && !this.ignTerrainSpike, gen);
  }

  /**
   * Imagery providers for one stack, BOTTOM-FIRST.
   *
   * Every stack but the IGN pair is a single world-covering layer. The IGN
   * stacks return `[osm, ign]`: IGN covers metropolitan France only, and a
   * France-shaped layer at index 0 would be Cesium's base layer, whose edge
   * pixels Cesium stretches over the rest of the planet. OSM underneath keeps
   * the world honest and the French tiles land on top of it.
   * @param {object} stack - Stack descriptor from `MAP_STACKS`.
   * @returns {Promise<Array<Cesium.ImageryProvider>>}
   */
  async _getStackProviders(stack) {
    if (stack.kind !== 'ign-wmts') return [await this._getImageryProvider(stack)];
    return [
      await this._getImageryProvider(this.getStack('osm')),
      await this._getImageryProvider(stack),
    ];
  }

  async _getImageryProvider(stack) {
    if (this._imageryProviders.has(stack.id)) {
      return this._imageryProviders.get(stack.id);
    }

    let provider;
    if (stack.kind === 'ion') {
      provider = await Cesium.createWorldImageryAsync({ style: stack.style });
    } else if (stack.kind === 'osm') {
      provider = new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
        credit: DEFAULT_OSM_CREDIT,
      });
    } else if (stack.kind === 'ign-wmts') {
      provider = createIgnWmtsProvider(stack);
    } else if (stack.kind === 'google-2d') {
      // Async unlike the others: a 2D tile URL is invalid without a session
      // token, and only the server can mint one. A throw here (no key, dead
      // billing, or the regional withdrawal) propagates to setStack's error
      // path with Google's own wording, and nothing is cached — so a switch
      // retried after the key is fixed opens a fresh session instead of
      // replaying the failure.
      provider = await createGoogleMapTilesProvider(stack);
    } else {
      throw new Error(`Unsupported map stack: ${stack.id}`);
    }

    this._imageryProviders.set(stack.id, provider);
    return provider;
  }

  _removeImageryLayers() {
    for (const layer of this._imageryLayers) {
      this.viewer.imageryLayers.remove(layer, false);
    }
    this._imageryLayers.length = 0;
  }

  /**
   * Sets the scene's terrain provider for the current globe stack.
   *
   * `enabled` selects Cesium World Terrain (ion token present — regime B,
   * unchanged). Disabled/keyless (regime C: OSM or any globe stack without an
   * ion token) now tries the keyless Re:Earth ellipsoidal terrain instead of
   * the flat `EllipsoidTerrainProvider`, falling back to the flat provider
   * (today's behavior) if construction fails — no worse than before this fix.
   *
   * `CesiumTerrainProvider.fromUrl()` is async (fetches `layer.json`), so this
   * method is async-safe: `gen` is the caller's switch generation (from
   * `setStack`'s `_switchGen`, threaded through `_activatePhotoreal` /
   * `_activateGlobeStack`, mirroring the M7 pattern in `_activateGlobeStack`
   * for imagery providers). If a newer switch starts while the Re:Earth
   * fetch is in flight, this call's result is discarded instead of
   * clobbering the newer switch's terrain.
   * @param {boolean} enabled
   * @param {number} [gen] — switch generation this call belongs to
   */
  async _setWorldTerrainEnabled(enabled, gen) {
    const targetMode = enabled ? 'world' : 'keyless';
    if (targetMode === this._terrainMode) return;
    if (enabled) {
      this.viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain({
        requestVertexNormals: true,
      }));
    } else {
      const provider = await this._getKeylessTerrainProvider();
      // A newer switch started while the Re:Earth layer.json fetch was in
      // flight — that call owns terrain now; don't stomp it (M7 pattern).
      if (gen != null && gen !== this._switchGen) return;
      this.viewer.terrainProvider = provider;
    }
    this._terrainMode = targetMode;
  }

  /**
   * Resolves (and caches) the keyless terrain provider for globe stacks
   * without an ion token: Re:Earth ellipsoidal quantized-mesh terrain, or
   * `EllipsoidTerrainProvider` (flat — current/prior behavior) if the
   * Re:Earth endpoint can't be constructed. Never throws.
   * @returns {Promise<Cesium.TerrainProvider>}
   */
  async _getKeylessTerrainProvider() {
    if (this._reearthTerrainProvider) return this._reearthTerrainProvider;
    if (this.ignTerrainSpike) {
      // Cached in the same slot as Re:Earth on purpose: the spike and the
      // shipped keyless provider are mutually exclusive for the whole session,
      // so one cache entry is the whole truth about what terrain is installed.
      this._reearthTerrainProvider = new IgnBilTerrainProvider();
      return this._reearthTerrainProvider;
    }
    try {
      this._reearthTerrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(REEARTH_TERRAIN_URL);
    } catch (error) {
      console.warn('[mapStackController] Re:Earth terrain unavailable, falling back to flat ellipsoid terrain:', error);
      this._reearthTerrainProvider = new Cesium.EllipsoidTerrainProvider();
    }
    return this._reearthTerrainProvider;
  }

  _emitChange(status) {
    this._onChange?.(this.getState(status));
  }
}
