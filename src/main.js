import * as Cesium from 'cesium';
import { StyleManager } from './ui.js';
import { DEFAULT_CITY_VIEW, flyToDefaultCity } from './camera.js';
import { DataLayerManager } from './data/manager.js';
import flightsLayer from './data/flights.js';
import militaryFlightsLayer from './data/militaryFlights.js';
import earthquakesLayer from './data/earthquakes.js';
import vigicruesLayer from './data/vigicrues.js';
import hubeauHydrometryLayer from './data/hubeauHydrometry.js';
import meteoFranceVigilanceLayer from './data/meteoFranceVigilance.js';
import franceEnergyLayer from './data/franceEnergy.js';
import gasFranceLayer from './data/gasFrance.js';
import edfPowerPlantsLayer from './data/edfPowerPlants.js';
import frHydroPlantsLayer from './data/frHydroPlants.js';
import powerGridLayer from './data/powerGrid.js';
import bdtopoBuildingsLayer from './data/bdtopoBuildings.js';
import cadastreParcelsLayer from './data/cadastreParcels.js';
import georisquesLayer from './data/georisques.js';
import dvfSalesLayer from './data/dvfSales.js';
import dpeFranceLayer from './data/dpeFrance.js';
import urbanismeGpuLayer from './data/urbanismeGpu.js';
import idfmNetworkLayer from './data/idfmNetwork.js';
import rteGenerationLayer from './data/rteGeneration.js';
import satellitesLayer from './data/satellites.js';
import rocketLaunchesLayer from './data/rocketLaunches.js';
import trafficLayer from './data/traffic.js';
import roadEventsFranceLayer from './data/roadEventsFrance.js';
import cctvLayer from './data/cctv.js';
import radioLayer from './data/radio.js';
import bikeshareLayer from './data/bikeshare.js';
import transitFranceLayer from './data/transitFrance.js';
import roadStatusFranceLayer from './data/roadStatusFrance.js';
import sharedMobilityFranceLayer from './data/sharedMobilityFrance.js';
import irveFranceLayer from './data/irveFrance.js';
import schoolsFranceLayer from './data/schoolsFrance.js';
import supFranceLayer from './data/supFrance.js';
import comptagesParisLayer from './data/comptagesParis.js';
import delinquanceFranceLayer from './data/delinquanceFrance.js';
import anfrFranceLayer from './data/anfrFrance.js';
import fraicheurParisLayer from './data/fraicheurParis.js';
import sitadelFranceLayer from './data/sitadelFrance.js';
import idfmFrequencyLayer from './data/idfmFrequency.js';
import bruitFranceLayer from './data/bruitFrance.js';
import aisLiveVesselsLayer from './data/aisLiveVessels.js';
import militaryInstallationsLayer from './data/militaryInstallations.js';
import militaryAwarenessLayer from './data/militaryAwareness.js';
import marineBuoysLayer from './data/marineBuoys.js';
import localDataLayers from './data/localLayers.js';
import { LAYER_STATE_REGISTRY } from './data/layerState.js';
import { LAYER_CATEGORIES, LAYER_TAXONOMY } from './data/layerTaxonomy.js';
import { registerDataCredits } from './data/dataCredits.js';
import { SceneDirector } from './scenes/director.js';
import { initGevVoiceCommands } from './voice/gevRealtime.js';
import { MapStackController } from './mapStackController.js';
import { ignTerrainFlagEnabled } from './data/ignBilTerrain.js';
import { initAnnotations } from './annotations/index.js';
import { initLogoGaze } from './logoGaze.js';
import { initCockpitCloudEffects } from './cockpitCloudEffects.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from './renderGovernor.js';
import { installScopeMask } from './scopeMask.js';
import { initFirstRunExperience } from './firstRunExperience.js';

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
      msaaSamples: 4,
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true,
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
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;

    let tileset = null;
    if (keylessMode) {
      // Deliberately NOT "call it and catch": `createGooglePhotorealistic3DTileset()`
      // with no key spends a doomed round-trip and then reports a network error,
      // which the loader would print as if something had gone wrong. Nothing has —
      // this is the configured build.
      loaderStatus.textContent = 'No Google key — starting keyless...';
    } else {
      loaderStatus.textContent = 'Loading Google 3D Tiles...';
      try {
        // Load Google Photorealistic 3D Tiles
        tileset = await Cesium.createGooglePhotorealistic3DTileset({
          onlyUsingWithGoogleGeocoder: true,
        });
        viewer.scene.primitives.add(tileset);
        // NOTE: Cesium World Terrain intentionally disabled — conflicts with Google 3D Tiles at high zoom.
        // Google Photorealistic 3D Tiles provide their own terrain/elevation.
        viewer.scene.globe.show = false;
      } catch (tileError) {
        console.warn('[Init] Google 3D Tiles unavailable, falling back to Cesium globe:', tileError);
        const tileErrorDetail = describeError(tileError);
        loaderStatus.textContent = `Google 3D Tiles unavailable (${tileErrorDetail}). Continuing in fallback mode...`;
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

    const mapStackController = new MapStackController(viewer, {
      googleTileset: tileset,
      cesiumToken,
      // Lets the controller say WHY photoreal is unavailable: no key at all
      // (keyless build) reads differently from a keyed build whose tiles
      // failed, and both arrive here as `googleTileset: null`.
      googleKeyConfigured: !keylessMode,
      ignTerrainSpike,
      initialStack: tileset ? 'photoreal' : 'osm',
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
    await mapStackController.setStack(tileset ? 'photoreal' : 'osm', { silent: true });

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
    dataManager.register(flightsLayer);
    dataManager.register(militaryFlightsLayer);
    dataManager.register(earthquakesLayer);
    dataManager.register(vigicruesLayer);
    dataManager.register(hubeauHydrometryLayer);
    dataManager.register(meteoFranceVigilanceLayer);
    dataManager.register(franceEnergyLayer);
    dataManager.register(gasFranceLayer);
    dataManager.register(edfPowerPlantsLayer);
    dataManager.register(frHydroPlantsLayer);
    dataManager.register(powerGridLayer);
    dataManager.register(bdtopoBuildingsLayer);
    dataManager.register(cadastreParcelsLayer);
    dataManager.register(georisquesLayer);
    dataManager.register(dvfSalesLayer);
    dataManager.register(dpeFranceLayer);
    dataManager.register(urbanismeGpuLayer);
    dataManager.register(idfmNetworkLayer);
    dataManager.register(rteGenerationLayer);
    dataManager.register(satellitesLayer);
    dataManager.register(rocketLaunchesLayer);
    rocketLaunchesLayer.attachDataManager(dataManager);
    dataManager.register(trafficLayer);
    dataManager.register(roadEventsFranceLayer);
    dataManager.register(cctvLayer);
    dataManager.register(radioLayer);
    dataManager.register(bikeshareLayer);
    dataManager.register(transitFranceLayer);
    dataManager.register(roadStatusFranceLayer);
    dataManager.register(sharedMobilityFranceLayer);
    dataManager.register(irveFranceLayer);
    dataManager.register(schoolsFranceLayer);
    dataManager.register(supFranceLayer);
    dataManager.register(comptagesParisLayer);
    dataManager.register(delinquanceFranceLayer);
    dataManager.register(anfrFranceLayer);
    dataManager.register(fraicheurParisLayer);
    dataManager.register(sitadelFranceLayer);
    dataManager.register(idfmFrequencyLayer);
    dataManager.register(bruitFranceLayer);
    dataManager.register(aisLiveVesselsLayer);
    dataManager.register(militaryInstallationsLayer);
    dataManager.register(militaryAwarenessLayer);
    dataManager.register(marineBuoysLayer);
    militaryAwarenessLayer.attachDataManager(dataManager);
    for (const layer of localDataLayers) {
      dataManager.register(layer);
    }
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
    styleManager.attachDataManager(dataManager);

    // Initialize deterministic scene playback for social clip capture
    const sceneDirector = new SceneDirector(viewer, styleManager, dataManager);

    // Initialize the voice "whiteboard" annotation engine (world-space renderer)
    const annotations = initAnnotations({ viewer, tileset });

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

    // Expose for debugging
    // Idle render governor: flips the scene into requestRenderMode whenever
    // nothing animates per frame. Installed AFTER every module above has had
    // its chance to register pre-install holds. (perf wave 2)
    installRenderGovernor(viewer);

    // The explicit scope mask replaces the emergent six-pass artifact —
    // see src/scopeMask.js. Installed before the UI so the DISPLAY-rail
    // toggle finds it live.
    installScopeMask(viewer);

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
      dataManager,
      sceneDirector,
      mapStackController,
      annotations,
      weatherEffects,
      cockpitCloudEffects,
      getRenderGovernorDiagnostics,
      requestRender: governorRequestRender,
    };
    window.__godsEyeView.voiceCommands = initGevVoiceCommands({ viewer, styleManager, dataManager, sceneDirector, annotations });

  } catch (error) {
    console.error("God's Eye View initialization failed:", error);
    loaderStatus.textContent = `Error: ${describeError(error)}`;
    loaderStatus.style.color = '#ff4444';
  }
}

init();
