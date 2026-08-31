import * as Cesium from 'cesium';

/**
 * Per-layer data attribution registered into Cesium's credit display.
 *
 * Legal requirement (see DATA_SOURCES.md, findings H10/H11 in
 * every third-party data layer this app can
 * display carries its own license and required attribution — ODbL (OSM
 * datacenters/dams, adsb.lol, Overpass roads), CC BY-NC-SA (TeleGeography
 * cables), NASA FIRMS, CelesTrak, USGS, City of Austin, GBFS operators, OpenSky.
 * The MIT code license does NOT cover this data.
 *
 * These credits are registered ONCE at init as STATIC credits with
 * showOnScreen=false, so they live in the expandable bottom-left "Data
 * attribution" lightbox (Cesium's credit popover) rather than cluttering the
 * on-globe line. Always-present is intentional and reversible: the lightbox is
 * the app's canonical attribution surface and DATA_SOURCES.md is the
 * machine-readable index. Strings are copied verbatim from DATA_SOURCES.md — if
 * you add a data source, add it there AND here.
 */

/**
 * Attribution entries. `html` is the credit markup; keep it minimal and
 * link out where DATA_SOURCES.md provides a canonical URL. Order roughly
 * follows DATA_SOURCES.md (live sources, then bundled snapshots).
 * @type {{ key: string, html: string }[]}
 */
export const DATA_CREDITS = [
  // ── Live sources ────────────────────────────────────────────────
  {
    key: 'opensky',
    html:
      'Flights: OpenSky Network — Schäfer et al., ' +
      '“Bringing Up OpenSky”, IPSN 2014 · ' +
      '<a href="https://opensky-network.org" target="_blank" rel="noopener">opensky-network.org</a> ' +
      '(non-commercial)',
  },
  {
    key: 'adsblol',
    html:
      'Military flights, aircraft traces &amp; bounded regional flight fallback: ' +
      '<a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'aisstream',
    html:
      'Live vessels (AIS): ' +
      '<a href="https://aisstream.io" target="_blank" rel="noopener">AISStream.io</a>',
  },
  {
    key: 'celestrak',
    html:
      'Satellites (TLEs): CelesTrak ' +
      '(<a href="https://celestrak.org" target="_blank" rel="noopener">celestrak.org</a>), ' +
      'Dr. T.S. Kelso',
  },
  {
    key: 'launch-library-2',
    html:
      'Space mission launch, payload &amp; recovery metadata: ' +
      '<a href="https://ll.thespacedevs.com/docs/" target="_blank" rel="noopener">Launch Library 2 — The Space Devs</a> ' +
      '(API documentation and rate limits)',
  },
  {
    key: 'usgs',
    html: 'Earthquakes: Data courtesy of the U.S. Geological Survey',
  },
  {
    key: 'ndbc',
    html:
      'Marine buoy observations: NOAA National Data Buoy Center ' +
      '(<a href="https://www.ndbc.noaa.gov" target="_blank" rel="noopener">ndbc.noaa.gov</a>) ' +
      '— U.S. public domain',
  },
  {
    key: 'overpass',
    html:
      'Road geometry (traffic): ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'military-installations-osm',
    html:
      'Mapped installation context: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0; incomplete mapped context)',
  },
  {
    key: 'cockpit-place-osm',
    html:
      'Cockpit place context: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      'via Nominatim (ODbL 1.0)',
  },
  {
    key: 'search-geocoder',
    html:
      'Place search (keyless builds): ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a> ' +
      'via <a href="https://nominatim.openstreetmap.org" target="_blank" rel="noopener">Nominatim</a> (ODbL 1.0), ' +
      'with French addresses and points of interest from the ' +
      '<a href="https://data.geopf.fr/geocodage/" target="_blank" rel="noopener">IGN G&eacute;oplateforme geocoder</a> ' +
      '(BAN &mdash; Licence Ouverte 2.0)',
  },
  {
    key: 'open-meteo',
    html:
      'Cockpit current conditions: ' +
      '<a href="https://open-meteo.com/en/licence" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> ' +
      '(CC BY 4.0)',
  },
  {
    key: 'google-news-rss',
    html:
      'Cockpit regional headlines: ' +
      '<a href="https://policies.google.com/terms" target="_blank" rel="noopener">Google News RSS</a> ' +
      '(location-matched article links; publisher terms apply)',
  },
  {
    key: 'gdelt',
    html:
      'Cockpit regional headlines: ' +
      '<a href="https://www.gdeltproject.org/about.html" target="_blank" rel="noopener">GDELT Project</a> ' +
      '(location-matched article links; publisher terms apply)',
  },
  {
    key: 'austin-cctv',
    html:
      'CCTV cameras &amp; frames: City of Austin, TX — ' +
      '<a href="https://data.austintexas.gov" target="_blank" rel="noopener">data.austintexas.gov</a>',
  },
  {
    key: 'caltrans-cctv',
    html:
      'CCTV cameras &amp; frames (California): Caltrans — ' +
      '<a href="https://cwwp2.dot.ca.gov/" target="_blank" rel="noopener">cwwp2.dot.ca.gov</a>',
  },
  {
    key: 'tfl-cctv',
    html:
      'CCTV cameras &amp; frames (London): ' +
      '<a href="https://tfl.gov.uk/info-for/open-data-users/" target="_blank" rel="noopener">Powered by TfL Open Data</a>. ' +
      'Contains OS data © Crown copyright and database rights.',
  },
  {
    key: 'grandlyon-cctv',
    html:
      'CCTV cameras &amp; frames (Lyon): Métropole de Lyon — ' +
      '<a href="https://data.grandlyon.com" target="_blank" rel="noopener">data.grandlyon.com</a> ' +
      '(<a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte / Open Licence 2.0</a>)',
  },
  {
    key: 'gbfs',
    html:
      'Bikeshare availability: GBFS operator feeds (e.g. Austin BCycle). ' +
      'France — Vélib\' Métropole (Smovengo / Syndicat Autolib\' Vélib\' Métropole, ' +
      '<a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener">ODbL</a>); ' +
      'Vélo\'v and vélôToulouse (JCDecaux, ' +
      '<a href="https://developer.jcdecaux.com/files/Open-Licence-fr.pdf" target="_blank" rel="noopener">Licence Ouverte</a>); ' +
      'Le Vélo par TBM (Bordeaux Métropole, Licence Ouverte)',
  },
  {
    key: 'vigicrues',
    html:
      'River-flood vigilance (France): ' +
      '<a href="https://www.vigicrues.gouv.fr/" target="_blank" rel="noopener">Vigicrues</a> — ' +
      'SCHAPI (Service central d\'hydrom&eacute;t&eacute;orologie et d\'appui &agrave; la pr&eacute;vision ' +
      'des inondations), Minist&egrave;re de la Transition &eacute;cologique ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'The bulletin\'s own publication time is reported by the layer as its data timestamp.',
  },
  {
    key: 'hubeau-hydrometrie',
    html:
      'River gauge stations and observations (France): ' +
      '<a href="https://hubeau.eaufrance.fr/page/api-hydrometrie" target="_blank" rel="noopener">Hub\'Eau — API Hydrom&eacute;trie</a>, ' +
      'data from the PHyC platform operated by Service Central Vigicrues (SCV, ex-SCHAPI); ' +
      'measurements produced by the DREALs and other operators ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte</a>). ' +
      'Raw, unvalidated readings, published without any availability guarantee — not a flood-warning service.',
  },
  {
    key: 'meteofrance-vigilance',
    html:
      'Weather vigilance (France): ' +
      '<a href="https://vigilance.meteofrance.fr/" target="_blank" rel="noopener">M&eacute;t&eacute;o-France — Vigilance m&eacute;t&eacute;orologique</a> ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>), ' +
      'via the data.gouv.fr mirror unless an API key is configured. ' +
      'D&eacute;partement boundaries: IGN — ADMIN EXPRESS COG (&eacute;dition 2018), ' +
      'via <a href="https://github.com/gregoiredavid/france-geojson" target="_blank" rel="noopener">france-geojson</a> (G. David), Licence Ouverte.',
  },
  {
    key: 'ign-geoplateforme',
    html:
      'IGN basemaps (France): ' +
      '<a href="https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_BD-ORTHO" target="_blank" rel="noopener">BD ORTHO&reg; (ORTHOIMAGERY.ORTHOPHOTOS)</a> ' +
      'and <a href="https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_PLAN-IGN" target="_blank" rel="noopener">Plan IGN v2</a>, ' +
      'served keyless by the IGN G&eacute;oplateforme (data.geopf.fr) under ' +
      '<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>. ' +
      'The orthophoto mosaic has no single update date &mdash; the aerial survey year differs per d&eacute;partement and is published by IGN as a ' +
      '<a href="https://data.geopf.fr/annexes/ressources/fiches/photographies-aeriennes-RVB/geoportail_dates_des_prises_de_vues_aeriennes-RVB.pdf" target="_blank" rel="noopener">table of flight dates</a>. ' +
      'Plan IGN v2 is regenerated continuously from IGN&rsquo;s vector databases. ' +
      'Coverage is clipped to metropolitan France and Corsica; DOM-TOM are not shown.',
  },
  {
    key: 'odre-eco2mix',
    html:
      'Live French electricity mix (&eacute;CO2mix, national + 12 r&eacute;gions): ' +
      '<a href="https://odre.opendatasoft.com/explore/dataset/eco2mix-national-tr/" target="_blank" rel="noopener">ODR&Eacute; — Open Data R&eacute;seaux &Eacute;nergies</a>, ' +
      'produced by RTE ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'The dataset&rsquo;s own 15-minute timestamp is reported by the layer as its data timestamp. ' +
      'R&eacute;gion fills are drawn on d&eacute;partement boundaries: IGN — ADMIN EXPRESS COG (&eacute;dition 2018), ' +
      'via <a href="https://github.com/gregoiredavid/france-geojson" target="_blank" rel="noopener">france-geojson</a> (G. David), Licence Ouverte.',
  },
  {
    key: 'odre-gas-fr',
    html:
      'French gas system: transmission traces &copy; ' +
      '<a href="https://odre.opendatasoft.com/explore/dataset/trace-du-reseau-grt-250/" target="_blank" rel="noopener">NaTran (ex-GRTgaz)</a> ' +
      'and <a href="https://odre.opendatasoft.com/explore/dataset/terega-trace-du-reseau/" target="_blank" rel="noopener">Ter&eacute;ga</a>, ' +
      'gas-fired power stations and renewable-methane injection points via ' +
      '<a href="https://odre.opendatasoft.com/explore/dataset/points-dinjection-de-biomethane-en-france/" target="_blank" rel="noopener">ODR&Eacute; — Open Data R&eacute;seaux &Eacute;nergies</a> ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'Both traces are published deliberately simplified, to about 250 m, and are drawn as published &mdash; ' +
      'they are not a pipeline location. Power-station figures are installed capacity by annual edition, not live output.',
  },
  {
    key: 'edf-power-plants',
    html:
      'EDF generating fleet (localisation and installed power of its hydraulic, ' +
      'nuclear and fossil-fired plants): ' +
      '<a href="https://opendata.edf.fr/datasets" target="_blank" rel="noopener">Open Data EDF</a> — ' +
      'three datasets published by EDF SA ' +
      '(<a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'Installed capacity, not production. Each file&rsquo;s own reference date is reported by the layer: ' +
      'nuclear is a vision consolid&eacute;e au 31/12/2025, hydraulic and thermal au 31/12/2023.',
  },
  {
    key: 'pan-transit',
    html:
      'Live French transit vehicles: GTFS-Realtime feeds published on the ' +
      '<a href="https://transport.data.gouv.fr" target="_blank" rel="noopener">Point d’Accès National (transport.data.gouv.fr)</a> — ' +
      'per-network licences, mostly ' +
      '<a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte 2.0</a> ' +
      'and <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL 1.0</a>, ' +
      '© each transport authority / operator',
  },
  {
    key: 'pan-shared-mobility',
    html:
      'Shared vehicles in France (bikes, scooters, mopeds, car-sharing): GBFS feeds published on the ' +
      '<a href="https://transport.data.gouv.fr" target="_blank" rel="noopener">Point d’Accès National (transport.data.gouv.fr)</a> — ' +
      'per-operator licences, mostly ' +
      '<a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte 2.0</a> ' +
      'and <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL 1.0</a>, ' +
      '© each operator / mobility authority',
  },
  {
    key: 'radio-browser',
    html:
      'Internet-radio station directory: ' +
      '<a href="https://www.radio-browser.info/" target="_blank" rel="noopener">Radio Browser</a> ' +
      '(public domain; audio delivered directly by each broadcaster)',
  },
  {
    key: 'reearth-terrain',
    html:
      'Terrain (keyless globe stacks): ' +
      '<a href="https://terrain.reearth.land" target="_blank" rel="noopener">Re:Earth Terrain</a> / ' +
      'Mapterhorn (CC BY 4.0) / EGM2008 (NGA)',
  },
  // ── Bundled snapshots ───────────────────────────────────────────
  {
    key: 'datacenters',
    html:
      'Datacenters: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'dams',
    html:
      'Dams: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0) + Open Infrastructure Map',
  },
  {
    key: 'ports',
    html:
      'Ports: NGA World Port Index (Pub. 150) — ' +
      '<a href="https://msi.nga.mil/Publications/WPI" target="_blank" rel="noopener">msi.nga.mil</a> ' +
      '— U.S. public domain. Harbour depths are WPI range bins, not surveyed soundings.',
  },
  {
    key: 'firms',
    html:
      'Active fires: NASA FIRMS — we acknowledge the use of data and/or imagery ' +
      'from NASA’s Fire Information for Resource Management System ' +
      '(<a href="https://earthdata.nasa.gov/firms" target="_blank" rel="noopener">earthdata.nasa.gov/firms</a>), ' +
      'part of NASA’s Earth Observing System Data and Information System (EOSDIS)',
  },
  {
    key: 'telegeography',
    html:
      'Submarine cables: © TeleGeography — ' +
      '<a href="https://www.submarinecablemap.com" target="_blank" rel="noopener">submarinecablemap.com</a> ' +
      '(CC BY-NC-SA 3.0 — NonCommercial)',
  },
];

/**
 * Conditional credits — registered via `registerDynamicCredit` only when the
 * corresponding capability actually activates (deliberately NOT part of
 * DATA_CREDITS, which is always-on). TomTom terms require attribution when
 * their flow data is displayed; keyless installs never show it, so the
 * credit only appears once live traffic-flow mode activates.
 * @type {{ key: string, html: string }}
 */
export const TOMTOM_CREDIT = {
  key: 'tomtom',
  html:
    'Traffic flow data © ' +
    '<a href="https://www.tomtom.com" target="_blank" rel="noopener">TomTom</a>',
};

/**
 * Registered the first time the opt-in OSM mapped-camera source
 * (`CCTV_OSM_CAMERAS_ENABLED=1`) actually puts camera positions on the globe.
 * Deliberately dynamic: the source is off by default and viewport-loaded, so an
 * always-on ODbL notice would credit data that is not on screen.
 */
export const OSM_CAMERA_CREDIT = {
  key: 'osm-cameras',
  html:
    'Mapped camera positions: ' +
    '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
    '(ODbL 1.0; positions only — no live feed)',
};

/** Registered when the first Natural Earth region outline resolves (public
 * domain — no attribution required; credited as a courtesy). */
export const NATURAL_EARTH_CREDIT = {
  key: 'natural-earth',
  html:
    'Physical region boundaries from ' +
    '<a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a> (public domain)',
};

/** @type {Set<string>} Keys of dynamic credits already registered this session. */
const _dynamicCreditKeys = new Set();

/**
 * Register a conditional credit at the moment its data source activates.
 * Idempotent per `credit.key`; lands in the same "Data attribution" popover
 * as the static credits (showOnScreen=false).
 * @param {Cesium.Viewer} viewer — the initialized Cesium viewer
 * @param {{ key: string, html: string }} credit — e.g. `TOMTOM_CREDIT`
 * @returns {boolean} True when the credit is (now) registered.
 */
export function registerDynamicCredit(viewer, credit) {
  const creditDisplay = viewer?.creditDisplay;
  if (!creditDisplay || typeof creditDisplay.addStaticCredit !== 'function') {
    return false;
  }
  if (!credit?.key || !credit?.html) return false;
  if (_dynamicCreditKeys.has(credit.key)) return true;
  creditDisplay.addStaticCredit(new Cesium.Credit(credit.html, false));
  _dynamicCreditKeys.add(credit.key);
  return true;
}

/**
 * Register every per-layer data credit into the viewer's credit display.
 * Idempotent: safe to call once at init. Credits are static and always
 * present in the "Data attribution" popover.
 * @param {Cesium.Viewer} viewer — the initialized Cesium viewer
 */
export function registerDataCredits(viewer) {
  const creditDisplay = viewer?.creditDisplay;
  if (!creditDisplay || typeof creditDisplay.addStaticCredit !== 'function') {
    return;
  }
  // Keyed, not just iterated: a three-way merge of two branches that each
  // added the same source once left `pan-transit` in this list twice, and the
  // popover showed the same attribution line twice. Registering by key makes
  // that class of merge accident invisible to the reader instead of visible.
  const seen = new Set();
  for (const { key, html } of DATA_CREDITS) {
    if (seen.has(key)) continue;
    seen.add(key);
    // showOnScreen=false → lives in the expandable "Data attribution" popover,
    // not the on-globe credit line.
    creditDisplay.addStaticCredit(new Cesium.Credit(html, false));
  }
}
