import * as Cesium from 'cesium';
import { StyleManager } from './ui.js';
import { DEFAULT_CITY_VIEW, flyToDefaultCity } from './camera.js';
import {
  MOVING_RESOLUTION_SCALE,
  getGlobeDetailDiagnostics,
  installGlobeDetailGovernor,
  setMovingResolutionScale,
} from './globeDetailGovernor.js';
import { getCameraSensitivityDiagnostics } from './data/cameraSensitivity.js';
import { peekShareMapStack } from './sharelink.js';
import { DataLayerManager } from './data/manager.js';
import { LAYER_MANIFEST } from './data/layerManifest.js';
import { createLazyLayer } from './data/lazyLayer.js';
import { LAYER_STATE_REGISTRY } from './data/layerState.js';
import { LAYER_CATEGORIES, LAYER_TAXONOMY } from './data/layerTaxonomy.js';
import { CATALOG_DATASET_MANIFESTS } from './data/datasetsCatalog.js';
import { initDatasetBox } from './data/datasetBox.js';
import { registerDataCredits } from './data/dataCredits.js';
import { installLazyVoice } from './voice/lazyVoice.js';
import { MapStackController } from './mapStackController.js';
import { describePhotorealFailure, loadPhotorealTileset } from './photorealTileset.js';
import { ignTerrainFlagEnabled } from './data/ignBilTerrain.js';
import { initLogoGaze } from './logoGaze.js';
import { installStarfield } from './starfield.js';
import { initCockpitCloudEffects } from './cockpitCloudEffects.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from './renderGovernor.js';
import { installScopeMask } from './scopeMask.js';
import { installGlobeHeadingTape } from './globeHeadingTape.js';
import { initFirstRunExperience } from './firstRunExperience.js';
import { initKeySetup } from './keySetup.js';
import {
  LITE_GLOBE_SSE,
  LITE_MSAA_SAMPLES,
  LITE_TILE_CACHE_SIZE,
  FULL_MSAA_SAMPLES,
  getPerfProfileDiagnostics,
  initPerfProfile,
  isLiteProfile,
  observeFrameProfile,
  onPerfProfileChange,
} from './perfProfile.js';

initLogoGaze();

/**
 * Extract a human-readable error message from any thrown value.
 * Handles Error objects, strings, and plain objects with message/error fields.
 * @param {*} error — caught exception value
 * @returns {string} best-effort error description
 */
function describeError(error) {
  if (!error) return 'Unknown initialization error';
  if (error instanceof Error) {
    if (error.message && error.message.trim()) return error.message.trim();
    return error.name || 'Initialization error';
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof error === 'object') {
    const maybeMessage = String(error.message || error.error || '').trim();
    if (maybeMessage) return maybeMessage;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // ignore serialization error
    }
  }
  return String(error);
}

/**
 * GOD'S EYE VIEW — Main Entry Point
 * Initializes CesiumJS with Google Photorealistic 3D Tiles,
 * style system, intelligence HUD, location presets, and share links.
 */
async function init() {
  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');

  try {
    loaderStatus.textContent = 'Configuring viewer...';

    // Set Cesium Ion token for World Terrain
    const cesiumToken = import.meta.env.CESIUM_ION_TOKEN;
    if (cesiumToken) {
      Cesium.Ion.defaultAccessToken = cesiumToken;
    }

    // Google Maps API key for Photorealistic 3D Tiles. OPTIONAL: a missing key
    // is a supported configuration (the keyless build), not a fatal error.
    // Throwing here used to abort init before the viewer existed, so
    // `git clone && npm i && npm run dev` produced a dead page for anyone
    // without a billed Google key — even though the whole downstream fallback
    // path already existed (`tileset === null` → `initialStack: 'osm'`, and
    // `MapStackController` already reports `photoreal` as unavailable with the
    // right reason). Keyless boots onto the keyless globe stacks instead.
    //
    // The key is only PUBLISHED when it exists: `Cesium.GoogleMaps.defaultApiKey`
    // and `window.__GOOGLE_MAPS_API_KEY__` stay untouched otherwise, so every
    // consumer sees a falsy value and takes its own degraded path rather than
    // firing a request with `key=undefined`. Geocoding consumers are the ones
    // that matter: `annotationResolver.geocodePlace()` and `gevActions`'
    // `reverseGeocode()` return null, and `locations.searchAndFlyTo()` rejects
    // with a keyless-specific message the search box turns into a toast.
    const googleApiKey = import.meta.env.GOOGLE_MAPS_API_KEY;
    const keylessMode = !googleApiKey;
    if (googleApiKey) {
      Cesium.GoogleMaps.defaultApiKey = googleApiKey;
      // Expose API key globally for geocoding in locations.js
      window.__GOOGLE_MAPS_API_KEY__ = googleApiKey;
    } else {
      console.info(
        '[Init] No GOOGLE_MAPS_API_KEY — starting keyless. Google 3D Tiles and '
        + 'Google-backed geocoding are unavailable; the globe stacks (OSM, IGN) are not.',
      );
    }

    // The render profile, resolved HERE and nowhere else. Two of the four fixed
    // render costs are Viewer construction arguments, so a machine that is
    // going to be treated as small has to be recognised before the next line
    // runs. See src/perfProfile.js for what `lite` may and may not change.
    initPerfProfile();

    // Create the Cesium viewer with minimal chrome
    const viewer = new Cesium.Viewer('cesiumContainer', {
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: false,
      infoBox: false,
      baseLayer: false,
      // No star field at construction. Cesium's default SkyBox pulls six
      // Tycho-2 JPEGs — 848 kB — on every cold start, and measured on a 2-core
      // laptop at 10 Mbit/s that was 1.7 s of the 5.3 s boot. It comes back,
      // deferred, on the basemaps where a sky means something: see
      // `src/starfield.js`.
      skyBox: false,
      // Visible attribution container — Google Maps / 3D Tiles credits are
      // required by Google's Terms of Service, so they must be shown (styled
      // subtly via #cesium-credits). The credit line stays visible in
      // clean-view AND recording modes too (ToS requires attribution while the
      // content is displayed — those are the exact modes used to record
      // demos), including the "Data attribution" link that opens the per-layer
      // license popover.
      creditContainer: (() => {
        const el = document.createElement('div');
        el.id = 'cesium-credits';
        document.body.appendChild(el);
        return el;
      })(),
      // The two fixed render costs that CANNOT be changed after this call, and
      // the reason `initPerfProfile()` runs above rather than after the globe
      // is up. Both are measured, one lever at a time, by `perf:gpu-ab`.
      //
      // MSAA is the biggest of the four by a wide margin: −26 to −43 % of
      // render work per frame at 1366×768, −49 to −59 % at 2732×1536. The
      // spread is the Mac's load moving under the bench, not the lever.
      msaaSamples: isLiteProfile() ? LITE_MSAA_SAMPLES : FULL_MSAA_SAMPLES,
      contextOptions: {
        webgl: {
          // `preserveDrawingBuffer` keeps the last frame readable after the
          // compositor has taken it, which costs a copy per frame and buys
          // exactly one thing: reading the canvas outside a render. Every such
          // read in this app already draws a fresh frame first
          // (`renderFreshCesiumFrame`), so `lite` declines the copy.
          preserveDrawingBuffer: !isLiteProfile(),
        },
      },
    });

    // Cap the default render loop at 60 fps. Cesium's loop otherwise runs at
    // the display's refresh rate — 120 Hz on ProMotion panels — doubling GPU
    // and CPU burn for zero visual benefit in a map app whose animation
    // cadences (poll interpolation, trail fades, style crossfades) are all
    // designed against wall-clock time, not frame count. Measured on the
    // 2026-08-05 perf investigation as a strict halving of idle burn on
    // 120 Hz hardware; a no-op on 60 Hz displays. (perf item 2)
    viewer.targetFrameRate = 60;

    // The only honest reading of how small this machine is: how long it takes
    // to draw this scene. The verdict arrives ~60 frames from now — too late
    // for the two construction arguments above, in time for everything else,
    // and remembered so the NEXT visit gets all four. (perf plan 2.1)
    observeFrameProfile(viewer);

    // Register per-layer data attribution into the "Data attribution" popover.
    // Required by each source's license (ODbL, CC BY-NC-SA, NASA FIRMS, etc.);
    // strings are verbatim from DATA_SOURCES.md. Static + always-present in the
    // expandable bottom-left credit lightbox (showOnScreen=false), so they never
    // clutter the on-globe attribution line.
    registerDataCredits(viewer);

    // Hide Cesium's default globe — Google Photorealistic 3D Tiles provide their own
    // globe at all LODs (street level → orbital). The default globe's 2D imagery
    // clips through 3D tile buildings at close range.
    //
    // Keyless, the photoreal globe is never coming, so the Cesium globe IS the
    // product and hiding it here would flash a starfield until the OSM stack
    // settled. `_activateGlobeStack()` shows it again either way; this only
    // decides what the first frames look like.
    viewer.scene.globe.show = keylessMode;

    // Keep a sky behind Google 3D Tiles, but soften Cesium's high-intensity
    // default atmosphere. With the globe hidden its bright limb otherwise
    // reads as a hard cyan seam where distant photoreal tiles meet the sky.
    // The Moon is drawn against a sky this build no longer ships by default,
    // and it drags `moonSmall.jpg` plus the IAU2006 rotation tables into the
    // boot to do it. It goes with the stars.
    viewer.scene.moon = undefined;
    viewer.scene.backgroundColor = Cesium.Color.BLACK;
    // `showWaterEffect` fetches `waterNormals.jpg` (294 kB) the moment a tile
    // carries a water mask, to animate a specular shimmer that is invisible at
    // every altitude this app is read at.
    viewer.scene.globe.showWaterEffect = false;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;

    // The globe's own two knobs in `lite` (perf plan 2.3). Set HERE, before
    // `installGlobeDetailGovernor`, because the governor captures whatever
    // tolerance it finds as the settled one and doubles THAT in motion — set
    // afterwards, the coarse value would be the one the governor hands back.
    if (isLiteProfile()) {
      viewer.scene.globe.maximumScreenSpaceError = LITE_GLOBE_SSE;
      viewer.scene.globe.tileCacheSize = LITE_TILE_CACHE_SIZE;
    }

    let tileset = null;
    // Kept out of the catch so the controller can NAME the failure on the map
    // source chip. A basemap that is not the one the app asked for has to say
    // so; the old code's `console.warn` was a message to nobody.
    let tilesetError = '';
    // Which door the 3D globe came through, or null. An ion-served tileset is
    // the SAME Google tileset, but on Cesium's contract and quota, so QA and
    // anyone driving the app from the console needs to be able to tell them
    // apart without reading the network panel.
    let tilesetSource = null;
    if (!googleApiKey && !cesiumToken) {
      // Deliberately NOT "call it and catch": with neither credential there is
      // nothing to try, and an attempt would spend a doomed round-trip and then
      // report a network error the loader would print as if something had gone
      // wrong. Nothing has — this is the configured build.
      loaderStatus.textContent = 'No Google key or ion token — starting keyless...';
    } else {
      const photoreal = await loadPhotorealTileset(Cesium, {
        googleApiKey,
        // The token already in the build for Bing and world terrain. It also
        // opens Google's photoreal tileset as ion asset 2275207, which is the
        // ONLY route left to the 3D globe on an EEA-billed Google key.
        ionToken: cesiumToken,
        onAttempt: (source) => {
          loaderStatus.textContent = source === 'ion'
            ? 'Loading Google 3D Tiles via Cesium ion...'
            : 'Loading Google 3D Tiles...';
        },
      });
      tileset = photoreal.tileset;
      tilesetSource = photoreal.source;
      if (tileset) {
        if (photoreal.source === 'ion') {
          console.info(
            '[Init] Google 3D Tiles served through Cesium ion (asset 2275207) — '
            + `${photoreal.errors.length ? 'the build key was refused: ' + describePhotorealFailure(photoreal.errors) : 'no Google key in this build'}. `
            + 'Cesium ion credits, including the free tier\'s "Upgrade for commercial use.", are required on screen.',
          );
        }
        viewer.scene.primitives.add(tileset);
        // NOTE: Cesium World Terrain intentionally disabled — conflicts with Google 3D Tiles at high zoom.
        // Google Photorealistic 3D Tiles provide their own terrain/elevation.
        viewer.scene.globe.show = false;
      } else {
        console.warn('[Init] Google 3D Tiles unavailable, falling back to Cesium globe:', photoreal.errors);
        tilesetError = describePhotorealFailure(photoreal.errors);
        loaderStatus.textContent = `Google 3D Tiles unavailable (${tilesetError}). Continuing in fallback mode...`;
        // Keep Cesium globe visible as fallback instead of aborting the app.
        viewer.scene.globe.show = true;
      }
    }

    loaderStatus.textContent = 'Initializing systems...';

    // DEV-ONLY terrain spike. Loud on purpose: with IGN RGE ALTI under the
    // globe, the repo's "terrain-globe means the Re:Earth prior IS the ground"
    // identity no longer holds, so everything clamped to the ground from a
    // cached sample — CCTV, traffic, local GeoJSON, mesh floors — is placed
    // against the wrong surface. Never ship this on.
    const ignTerrainSpike = ignTerrainFlagEnabled();
    if (ignTerrainSpike) {
      console.warn(
        '[Init] ?ign_terrain=1 — DEV SPIKE: IGN RGE ALTI terrain is installed over '
        + 'France. Ground-clamped objects (CCTV, traffic, local GeoJSON, mesh floors) '
        + 'are placed against the wrong surface while this is on.',
      );
    }

    // Where a build that cannot show the 3D globe LANDS. A keyed build with no
    // tileset is the EEA case: Google withholds 3D tiles and satellite from an
    // EEA billing address (403) but still serves roadmap and terrain on the
    // very same key, so Google's own cartography is both a better first
    // impression than OSM and the thing the operator is already paying for.
    // The keyless build lands on OSM only when it has no ion token either:
    // with one, `tileset` is the ion-served photoreal globe and this lands on
    // it, key or no key.
    const startupStack = tileset
      ? 'photoreal'
      : (keylessMode ? 'osm' : 'google-roadmap');

    const mapStackController = new MapStackController(viewer, {
      googleTileset: tileset,
      cesiumToken,
      // Lets the controller say WHY photoreal is unavailable: no key at all
      // (keyless build) reads differently from a keyed build whose tiles
      // failed, and both arrive here as `googleTileset: null`.
      googleKeyConfigured: !keylessMode,
      googleTilesetError: tilesetError,
      ignTerrainSpike,
      initialStack: startupStack,
      // Task 5 (height-datum fix): rebroadcast stack changes as a window
      // CustomEvent so data layers (CCTV per-regime ground resolution) can
      // react without coupling MapStackController to layer modules. Fires on
      // 'switching'/'ready'/'error'; listeners derive the surface regime from
      // live scene state, so intermediate emissions are harmless.
      onChange: (state) => {
        window.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: state }));
      },
      onError: (message) => console.warn('[MapStack]', message),
    });
    // ONE imagery construction per page load. The hash is read HERE, before the
    // first activation, instead of being left to the share restore a second and
    // a half later: `_activateGlobeStack()` destroys and rebuilds every imagery
    // layer, so activating the build's default and then switching made the
    // reader watch one basemap appear, get thrown away, and a second refine
    // coarse→sharp from an empty tile cache. On `#map=ign-plan` that was,
    // literally, OSM followed by Plan IGN on every reload.
    //
    // Availability is asked of the controller rather than re-derived here — it
    // is the one place that decides — and an unavailable or unknown request
    // falls back to `getActiveId()`, which is `startupStack` already resolved
    // against what this build can show. The share restore's own `setStack()`
    // then short-circuits on the live stack.
    const requestedStack = peekShareMapStack();
    const bootStack = requestedStack && mapStackController.isStackAvailable(requestedStack)
      ? requestedStack
      : mapStackController.getActiveId();
    await mapStackController.setStack(bootStack, { silent: true });

    // The star field follows the imagery: it belongs to a photograph of the
    // Earth, not to a drawing of it. Deferred on this first call so a build
    // that opens on a satellite basemap still does not pay 848 kB inside its
    // own boot — see `src/starfield.js`. The boot activation above is silent
    // and emits no event, which is why it is synced here by hand rather than
    // only through the listener below.
    const starfield = installStarfield(viewer.scene, { requestRender: governorRequestRender });
    starfield.sync(mapStackController.getActiveId(), { defer: true });
    window.addEventListener('gev:map-stack-changed', (event) => {
      if (event.detail?.status === 'switching') return;
      starfield.sync(event.detail?.activeId);
    });

    // Initialize the style manager (post-processing, HUD, locations, share links)
    const styleManager = new StyleManager(viewer, { mapStackController });
    // The previous multi-canvas weather compositor remains disabled. Cockpit
    // clouds use a separate, capped low-resolution GPU pass that never attaches
    // Cesium fog or post-process stages and is fully stopped in map mode.
    const weatherEffects = null;
    const cockpitCloudEffects = initCockpitCloudEffects(viewer);

    // If no share link state, do the default fly-to (Paris)
    if (!styleManager.hasShareState) {
      loaderStatus.textContent = `Flying to ${DEFAULT_CITY_VIEW.label}...`;
      flyToDefaultCity(viewer);
    } else {
      loaderStatus.textContent = 'Restoring shared view...';
    }

    // Initialize data layer manager
    const dataManager = new DataLayerManager(viewer, {
      allowQaRegistration: import.meta.env.DEV,
    });
    // Every production layer registers as a STUB — identity only, no module
    // behind it — and its 30-200 kB of code arrives on the first toggle that
    // needs it. See `src/data/lazyLayer.js`: statically importing all 60 put
    // 4 798 kB of the entry chunk's 7 278 kB (pre-minification, rollup's own
    // module graph, 2026-09-09) in front of a reader who has switched none of
    // them on. The manifest is generated from the modules and re-derived from
    // them on every `npm test`, so a stub can never describe a layer that no
    // longer exists.
    const layers = LAYER_MANIFEST.map((descriptor) => createLazyLayer(descriptor));
    for (const layer of layers) dataManager.register(layer);
    // `rocket-launches` and `military-awareness` read the manager back (one for
    // the satellites layer's params, the other to drive its own camera
    // hand-offs). The stub takes the reference now and passes it on the moment
    // its module loads; the manifest says which two ask for it.
    for (const layer of layers) layer.attachDataManager?.(dataManager);
    // Restoration starts only after the complete production registry is sealed.
    dataManager.finalizeRegistrations(LAYER_STATE_REGISTRY, LAYER_TAXONOMY, LAYER_CATEGORIES);
    if (import.meta.env.DEV) {
      window.__gevQaRegisterLayer = (targetManager, layerModule) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.registerForQa(layerModule);
      };
      window.__gevQaUnregisterLayer = (targetManager, layerId) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.unregisterForQa(layerId);
      };
    }
    dataManager.buildTogglePanel(document.getElementById('data-toggles'));
    // The dataset box lands AFTER the seal, by design: a plugged dataset is a
    // manifest, not a core layer, and `registerDataset` is its only door. The
    // shipped catalog (`datasets/*.json`) and whatever this browser plugged
    // earlier are registered here, and the panel to plug more is mounted
    // under the layer list.
    let datasetBox = null;
    try {
      datasetBox = initDatasetBox({ dataManager, viewer, catalog: CATALOG_DATASET_MANIFESTS });
    } catch (error) {
      console.warn('[datasets] box init failed:', error);
    }
    styleManager.attachDataManager(dataManager);

    // The voice agent, its annotation engine and the scene director are 360 kB
    // of the boot bundle and none of them draws the map — so they are mounted,
    // not built: the mic panel appears now, its machinery arrives at browser
    // idle (or immediately if somebody reaches for the mic first). See
    // `src/voice/lazyVoice.js`.
    // Republished under the names eight QA harnesses and the console already
    // know. Called from BOTH sides because the order is genuinely undecided:
    // the stack can land before `window.__godsEyeView` is published (nothing
    // between here and there awaits, but nothing promises not to either), and
    // a one-sided version would silently leave the three fields null forever.
    let voiceStack = null;
    const publishVoiceStack = () => {
      if (!voiceStack || !window.__godsEyeView) return;
      window.__godsEyeView.voiceCommands = voiceStack.controller;
      window.__godsEyeView.annotations = voiceStack.annotations;
      window.__godsEyeView.sceneDirector = voiceStack.sceneDirector;
    };
    const voice = installLazyVoice({
      viewer,
      styleManager,
      dataManager,
      tileset,
      onReady: (stack) => { voiceStack = stack; publishVoiceStack(); },
    });

    // Keep startup chrome truthful: a share is not restored until camera,
    // visual/map/panel lanes, and every requested layer have terminated.
    void Promise.all([
      styleManager.initialRestorePromise,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]).finally(() => {
      loadingScreen.classList.add('hidden');
      // Reveal only after the loading cover has yielded. transitionend can be
      // absent under reduced motion, so a bounded fallback makes this reliable.
      let firstRunRevealed = false;
      const revealFirstRun = () => {
        if (firstRunRevealed) return;
        firstRunRevealed = true;
        // dataManager is passed explicitly: the globe missions enable bundled
        // keyless layers through it, and reaching for styleManager._dataManager
        // would make a private field part of this feature's contract.
        initFirstRunExperience({ styleManager, dataManager });
      };
      loadingScreen.addEventListener('transitionend', revealFirstRun, { once: true });
      setTimeout(revealFirstRun, 900);
    });

    // Provider Settings (the POWER UP chip + dialog). Fire-and-forget: the
    // module removes its own surface when the dev-server endpoint is absent —
    // every deployment, and every visitor who is not this machine — so this
    // costs a built bundle one failed fetch and nothing else.
    void initKeySetup();

    // Expose for debugging
    // Idle render governor: flips the scene into requestRenderMode whenever
    // nothing animates per frame. Installed AFTER every module above has had
    // its chance to register pre-install holds. (perf wave 2)
    installRenderGovernor(viewer);

    // Coarser imagery/terrain while the camera moves, full detail the moment it
    // settles. The intro fly-to descends through the whole zoom pyramid over
    // one point, refining every level it passes and discarding it a frame
    // later; this declines that work without touching a still frame.
    //
    // In `lite` the same motion window also trades pixels: 0.8 linear is 36 %
    // fewer of them, and it is the second-biggest of the four fixed costs
    // (−5 to −26 % at 1366×768, −40 to −48 % at twice that — a fill-bound
    // lever only pays where fill is the constraint). One motion state machine
    // owns both trades, and the governor's header says why that is not
    // optional: implemented as its own, this lever loops.
    installGlobeDetailGovernor(viewer, {
      movingResolutionScale: isLiteProfile() ? MOVING_RESOLUTION_SCALE : null,
    });

    // What the DISPLAY-rail switch can still change once the page is up.
    // `msaaSamples` is settable on a live scene even though it is a
    // construction argument; `preserveDrawingBuffer` is not, and that is why
    // the switch persists its choice — the next load completes the trade.
    onPerfProfileChange((profile) => {
      const lite = profile === 'lite';
      viewer.scene.msaaSamples = lite ? LITE_MSAA_SAMPLES : FULL_MSAA_SAMPLES;
      setMovingResolutionScale(lite ? MOVING_RESOLUTION_SCALE : null);
      governorRequestRender('perf-profile');
    });

    // The explicit scope mask replaces the emergent six-pass artifact —
    // see src/scopeMask.js. Installed before the UI so the DISPLAY-rail
    // toggle finds it live.
    installScopeMask(viewer);

    // Where north is, outside the cockpit. See src/globeHeadingTape.js: the
    // cockpit already answered this and the ordinary globe view did not.
    installGlobeHeadingTape(viewer);

    // The follow camera recomputes the tracked target's dead-reckon position
    // every frame — tracking anything is a per-frame animation. (perf wave 2)
    viewer.trackedEntityChanged.addEventListener(() => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    });

    // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
    // stop the default render loop outright — a hidden canvas repaints for
    // nobody, and browser rAF throttling still lets throttled frames burn
    // GPU. Holder/data state is untouched, so return is seamless: restore
    // the loop, refresh the one DOM surface we gated, render a frame.
    const syncVisibilitySuspension = () => {
      const hidden = document.hidden;
      viewer.useDefaultRenderLoop = !hidden;
      cockpitCloudEffects?.setSuspended?.(hidden);
      if (!hidden) {
        if (dataManager._panelRefreshPendingOnVisible) {
          dataManager._panelRefreshPendingOnVisible = false;
          dataManager._refreshTogglePanel();
        }
        governorRequestRender('visibility-restore');
      }
    };
    document.addEventListener('visibilitychange', syncVisibilitySuspension);
    // Apply the CURRENT state too — bootstrap can complete while the tab is
    // already hidden, and waiting for the next transition would leave the
    // loop burning behind a hidden tab. (perf wave 2 fix)
    syncVisibilitySuspension();

    window.__godsEyeView = {
      viewer,
      styleManager,
      tileset,
      // 'google-key' | 'ion' | null — see the load block above.
      tilesetSource,
      dataManager,
      // Null until the voice stack lands — `voiceReady` is how a caller waits
      // for it without polling, and `loadVoice()` how it asks for it early.
      sceneDirector: null,
      mapStackController,
      annotations: null,
      voiceReady: voice.ready,
      loadVoice: voice.load,
      weatherEffects,
      cockpitCloudEffects,
      getRenderGovernorDiagnostics,
      // Two of the three session-global knobs the 2026-09-03 reload report
      // turned out to be about — the globe's error tolerance and the camera's
      // change threshold. The third, imagery constructions per page load, is
      // on `mapStackController` above. Exposed so `qa:map-reload` can watch
      // them rather than infer them from pixels.
      getGlobeDetailDiagnostics,
      getCameraSensitivityDiagnostics,
      // Which render profile this machine got, WHY it got it, and what its own
      // frames measured — so a harness never has to infer "was this a lite
      // run?" from pixels. (perf plan 2.1)
      getPerfProfileDiagnostics,
      // Whether the 848 kB star field has been paid for yet, and on which
      // basemap. `qa:starfield` asserts both halves of the contract.
      starfield,
      requestRender: governorRequestRender,
      // The dataset box: plug / unplug / infer / list, for the QA harness and
      // for anyone driving the app from the console.
      datasets: datasetBox,
    };
    // The other half of the ordering note above: if the voice stack landed
    // first, this is where its three fields stop being null.
    publishVoiceStack();
  } catch (error) {
    console.error("God's Eye View initialization failed:", error);
    loaderStatus.textContent = `Error: ${describeError(error)}`;
    loaderStatus.style.color = '#ff4444';
  }
}

init();
