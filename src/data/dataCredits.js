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
    key: 'power-grid-osm',
    html:
      'High-voltage grid (lines, cables, substations, pylons &mdash; per viewport): ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a> ' +
      '(ODbL 1.0). Volunteer mapping, not a grid register: coverage varies by country, ' +
      'only features OSM gives a voltage of 50 kV or more are drawn, and routes are the ' +
      'mapped ground route &mdash; not the conductor height, which OpenStreetMap does not publish.',
  },
  {
    key: 'rte-actual-generation',
    html:
      'Per-unit electricity generation (France): ' +
      '<a href="https://data.rte-france.com/catalog/-/api/generation/Actual-Generation/v1.1" target="_blank" rel="noopener">RTE — API Actual Generation</a>, ' +
      'resource <code>actual_generations_per_unit</code> (free account required; units of 100&nbsp;MW ' +
      'and above on the metropolitan transmission grid). Output as last published by RTE for the ' +
      'hour shown &mdash; not an instantaneous reading.',
  },
  {
    key: 'odre-registre-production',
    html:
      'Generating-unit register (France &mdash; EIC codes, installed power, filière, commune): ' +
      '<a href="https://odre.opendatasoft.com/explore/dataset/registre-national-installation-production-stockage-electricite-agrege/" target="_blank" rel="noopener">ODRÉ &mdash; Registre national des installations de production et de stockage d’électricité</a> ' +
      '(Licence Ouverte 2.0). Station positions are derived at build time from this register joined ' +
      'to <a href="https://opendata.edf.fr" target="_blank" rel="noopener">EDF Open Data</a> ' +
      '(Licence Ouverte 2.0, localisation of EDF SA’s nuclear, hydraulic and thermal stations), to ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a> ' +
      '(ODbL 1.0, <code>power=plant</code> and <code>ref:FR:RTE</code> substations) and to ' +
      '<a href="https://geo.api.gouv.fr" target="_blank" rel="noopener">geo.api.gouv.fr</a> commune ' +
      'centres (Licence Ouverte); each station states which of the four it was placed on.',
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
    key: 'ign-bdtopo',
    html:
      'French buildings in 3D (footprint, measured height, floor and roof altitudes, ' +
      'use, dwelling count, RNB identifier): IGN — ' +
      '<a href="https://geoservices.ign.fr/bdtopo" target="_blank" rel="noopener">BD TOPO&reg;</a>, ' +
      'served as vector tiles by the ' +
      '<a href="https://data.geopf.fr/" target="_blank" rel="noopener">G&eacute;oplateforme</a> ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'Altitudes are NGF-IGN69 and are converted to WGS84 ellipsoidal heights (h = H + N) before drawing. ' +
      'Roof altitudes are published for most of France but NOT for Paris, whose buildings come from the ' +
      'cadastre with an interpolated Z; those are extruded from the published floor altitude by the ' +
      'published height instead, and each card names which of the two it used.',
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
    key: 'fr-hydro-plants',
    html:
      'French hydro fleet (all 2 742 installations of the national register, not just the large ones): ' +
      '<a href="https://odre.opendatasoft.com/explore/dataset/registre-national-installation-production-stockage-electricite-agrege/" target="_blank" rel="noopener">ODR&Eacute; — Registre national des installations de production et de stockage d&rsquo;&eacute;lectricit&eacute;</a> ' +
      '(<a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'The register publishes NO coordinates, so positions are joined from ' +
      '<a href="https://geoservices.ign.fr/bdtopo" target="_blank" rel="noopener">IGN BD TOPO&reg;</a> ' +
      '(Licence Ouverte 2.0 &mdash; the surveyed building footprints the Plan IGN is drawn from, 589 of 998 positions), ' +
      '<a href="https://opendata.edf.fr/datasets" target="_blank" rel="noopener">Open Data EDF</a> (Licence Ouverte 2.0), ' +
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors ' +
      '(<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL 1.0</a>) ' +
      'and <a href="https://geo.api.gouv.fr" target="_blank" rel="noopener">geo.api.gouv.fr</a> commune centres. ' +
      'Installed capacity, not live output; the energy figure on a card is a trailing twelve-month total. ' +
      'A hollow ring is a commune, not a plant.',
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
    key: 'datex-road-status-fr',
    html:
      'Live French road status, flow and speed: DATEX II published by the ' +
      '<a href="https://www.bison-fute.gouv.fr" target="_blank" rel="noopener">Directions Interdépartementales des Routes via Bison Futé</a> — ' +
      '<a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence" target="_blank" rel="noopener">Licence Ouverte 2.0</a>. ' +
      'Non-conceded national network only: no coverage in Île-de-France, and no département or city road. ' +
      'Flow and speed are six-minute averages, not instantaneous readings. ' +
      'Sites the DIRs publish without a coordinate are placed from their point repère against the ' +
      '<a href="https://www.data.gouv.fr/datasets/bornage-du-reseau-routier-national" target="_blank" rel="noopener">Bornage du réseau routier national</a> ' +
      '(DGITM — Licence Ouverte 2.0), which agrees with the published positions to a median of 4 m. ' +
      'Segments are drawn along the surveyed centre of their own carriageway, from ' +
      '<a href="https://www.data.gouv.fr/datasets/liaisons-du-reseau-routier-national" target="_blank" rel="noopener">Liaisons du réseau routier national</a> ' +
      '(DGITM — Licence Ouverte 2.0), rather than as the straight line between their two ends.',
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
    key: 'bison-fute-events',
    html:
      'French road events (accidents, closures, roadworks, diversions, restrictions): ' +
      '<a href="https://transport.data.gouv.fr/datasets/evenements-routiers-sur-le-reseau-routier-national-non-concede" target="_blank" rel="noopener">' +
      '&Eacute;v&eacute;nementiel-DIR</a>, published as DATEX II by the Directions interd&eacute;partementales des routes ' +
      'through Bison Fut&eacute; / Tipi for the DGITM ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'The publication\u2019s own timestamp is reported by the layer as its data timestamp. ' +
      'Coverage is the r&eacute;seau routier national NON CONC&Eacute;D&Eacute; only &mdash; the conceded motorways are not in this feed. ' +
      'A segment is drawn as the straight line between the two endpoints DATEX II publishes; the road\u2019s real geometry is not part of the feed.',
  },
  {
    key: 'irve-charge-points',
    html:
      'EV charge points (France): <em>fichier consolid&eacute; des bornes de recharge pour v&eacute;hicules ' +
      '&eacute;lectriques</em>, assembled by ' +
      '<a href="https://transport.data.gouv.fr" target="_blank" rel="noopener">transport.data.gouv.fr</a> ' +
      'from the operators&rsquo; own IRVE filings and republished by ' +
      '<a href="https://odre.opendatasoft.com/explore/dataset/bornes-irve/" target="_blank" rel="noopener">ODR&Eacute; — Open Data R&eacute;seaux &Eacute;nergies</a> ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>), ' +
      '&copy; each am&eacute;nageur / op&eacute;rateur. Installed capacity only &mdash; the file publishes no ' +
      'availability, and each site&rsquo;s own <code>date_maj</code> is reported as its data timestamp.',
  },
  {
    key: 'cadastre-pci',
    html:
      'French cadastral parcels: <em>Plan Cadastral Informatis&eacute; (PCI vecteur)</em>, ' +
      '&copy; Direction g&eacute;n&eacute;rale des Finances publiques, served through ' +
      '<a href="https://apicarto.ign.fr/api/doc/cadastre" target="_blank" rel="noopener">IGN Api Carto</a> ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'A FISCAL document: cadastral limits carry no legal force, and a property boundary in France is ' +
      'fixed by bornage under article 646 of the Code civil. Each parcel\u2019s tolerance is derived from the ' +
      'published scale of the feuille it was drawn on, at 0,5 mm of line; the <code>contenance</code> is the ' +
      'DGFiP\u2019s registered surface and is shown beside the drawn one, never merged with it.',
  },
  {
    key: 'ban-adresse',
    html:
      'Addresses on a selected cadastral parcel: ' +
      '<a href="https://adresse.data.gouv.fr" target="_blank" rel="noopener">Base Adresse Nationale (BAN)</a> ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'The NEAREST address point to the parcel\u2019s centroid, not a published parcel-to-address relation: the card prints the ' +
      'distance BAN itself reports whenever it exceeds 10 m, and drops the answer entirely beyond 60 m.',
  },
  {
    key: 'schools-fr',
    html:
      'French schools: <em>Annuaire de l&rsquo;&eacute;ducation</em>, published by the ' +
      '<a href="https://data.education.gouv.fr/explore/dataset/fr-en-annuaire-education/" target="_blank" rel="noopener">Minist&egrave;re de l&rsquo;&Eacute;ducation nationale</a> ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>), ' +
      'rebuilt daily. Pupil numbers are joined on the UAI from the ministry&rsquo;s four ' +
      'per-level <em>effectifs</em> datasets at rentr&eacute;e 2025 and cover 91.7% of teaching ' +
      'establishments &mdash; a site with no published roll is drawn at the base size and says so. ' +
      'Coordinates carry the register&rsquo;s own <code>precision_localisation</code>; 2 159 rows are ' +
      'geocoded only to their commune, and their cards say that too.',
  },
  {
    key: 'medecins-fr',
    html:
      'French doctors: <em>Annuaire sant&eacute; Ameli</em>, published by the ' +
      '<a href="https://www.data.gouv.fr/datasets/annuaire-sante-ameli" target="_blank" rel="noopener">Caisse nationale de l&rsquo;Assurance Maladie</a> ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>), ' +
      'edition of 17/08/2026, rebuilt weekly. <strong>The register publishes no coordinates</strong> &mdash; ' +
      'positions are geocoded against the <a href="https://adresse.data.gouv.fr/" target="_blank" rel="noopener">Base Adresse Nationale</a> ' +
      '(Licence Ouverte 2.0) and each site carries the precision BAN returned; 716 are placed at their commune centre and say so. ' +
      'Accessibility is the <em>accessibilit&eacute; potentielle localis&eacute;e</em> (APL) 2024 to general practitioners aged 65 or under, ' +
      '<a href="https://www.data.gouv.fr/datasets/accessibilite-potentielle-localisee-apl-aux-professionnels-de-sante" target="_blank" rel="noopener">DREES</a> ' +
      '(Licence Ouverte 2.0), France hors Mayotte. The register carries no identifier, so counts are distinct ' +
      'practitioner names, not a headcount &mdash; measured 5 % above the CNAM&rsquo;s own 2024 figure.',
  },
  {
    key: 'sup-fr',
    html:
      'French higher education: <em>Effectifs d&rsquo;&eacute;tudiants inscrits &mdash; d&eacute;tail par '
      + '&eacute;tablissements</em>, published by the '
      + '<a href="https://data.enseignementsup-recherche.gouv.fr/explore/dataset/fr-esr-atlas_regional-effectifs-d-etudiants-inscrits-detail_etablissements/" target="_blank" rel="noopener">Minist&egrave;re de l&rsquo;Enseignement sup&eacute;rieur et de la Recherche</a> '
      + '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>), '
      + 'read at the newest published rentr&eacute;e. 1 665 of its 6 294 establishments carry no '
      + 'coordinate; 977 of those are placed from the same ministry&rsquo;s '
      + '<a href="https://data.enseignementsup-recherche.gouv.fr/explore/dataset/fr-esr-cartographie_formations_parcoursup/" target="_blank" rel="noopener"><em>Cartographie des formations Parcoursup</em></a> '
      + '(same licence), which also supplies the establishment names and the list of formations on '
      + 'each card. A borrowed coordinate says so on its card, and the 688 establishments neither '
      + 'file can place are reported rather than invented.',
  },
  {
    key: 'petite-enfance-fr',
    html:
      'French childcare coverage: <em>Taux de couverture d&rsquo;accueil du jeune enfant</em> and '
      + '<em>Nombre de places offertes pour les enfants de moins de 3 ans</em>, published by the '
      + '<a href="https://data.caf.fr/explore/dataset/txcouv_pe_dep/" target="_blank" rel="noopener">Caisse nationale des allocations familiales</a> '
      + '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>), '
      + 'read at the newest published edition across d&eacute;partement, EPCI and commune. This is an '
      + 'INDICATOR, not a register: no national list of cr&egrave;ches is published as open data, so '
      + 'the layer draws places per 100 children under three rather than establishments. The commune '
      + 'breakdown exists only for communes over 10&nbsp;000 inhabitants (1&nbsp;061 of ~34&nbsp;875), '
      + 'and EPCI and commune points are placed at their administrative centre from '
      + '<a href="https://geo.api.gouv.fr" target="_blank" rel="noopener">geo.api.gouv.fr</a> '
      + '(&Eacute;talab, same licence) &mdash; a centre, never a boundary, and the cards say so.',
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
      'Barrages: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0) — France extracted via the ' +
      '<a href="https://overpass-api.de" target="_blank" rel="noopener">Overpass API</a>, ' +
      'rest of the world from Open Infrastructure Map',
  },
  {
    key: 'ports',
    html:
      'Ports: NGA World Port Index (Pub. 150) — ' +
      '<a href="https://msi.nga.mil/Publications/WPI" target="_blank" rel="noopener">msi.nga.mil</a> ' +
      '— U.S. public domain. Harbour depths are WPI range bins, not surveyed soundings.',
  },
  {
    key: 'ourairports',
    html:
      'Airports &amp; aerodromes: ' +
      '<a href="https://ourairports.com/data/" target="_blank" rel="noopener">OurAirports</a> ' +
      '— dedicated to the public domain by its volunteer editors. Bundled as a ' +
      'selection, not the whole catalogue: every large/medium airport and every ' +
      'scheduled-service field worldwide, plus the full French long tail.',
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
  // ── Address-scan sources (France) ───────────────────────────────
  {
    key: 'georisques',
    html:
      'French natural and technological risk register (flood, clay shrinkage, seismicity, ' +
      'radon, classified industrial sites, polluted soil, hazardous pipelines): ' +
      '<a href="https://www.georisques.gouv.fr/" target="_blank" rel="noopener">G&eacute;orisques</a> &mdash; ' +
      'BRGM for the Minist&egrave;re de la Transition &eacute;cologique ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'The commune verdict and the address verdict are reported separately, as the source publishes them.',
  },
  {
    key: 'dvf',
    html:
      'French property transactions: ' +
      '<a href="https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres-geolocalisees/" target="_blank" rel="noopener">Demandes de valeurs fonci&egrave;res g&eacute;olocalis&eacute;es</a> &mdash; ' +
      'DGFiP, published by Etalab (<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'A price per square metre is shown only for the sale of a single dwelling; the register does not say ' +
      'how a multi-lot sale was split.',
  },
  {
    key: 'ademe-dpe',
    html:
      'French energy-performance diagnostics (DPE): ' +
      '<a href="https://data.ademe.fr/datasets/dpe03existant" target="_blank" rel="noopener">ADEME &mdash; DPE logements existants</a> ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'Labels are shown as a distribution, never averaged into a neighbourhood grade.',
  },
  {
    key: 'ign-isochrone',
    html:
      'Reachable-area rings: IGN G&eacute;oplateforme ' +
      '<a href="https://geoservices.ign.fr/documentation/services/services-geoplateforme/itineraire" target="_blank" rel="noopener">isochrone service</a>, ' +
      'Valhalla over BD TOPO&reg; (<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'Walking and driving only &mdash; the service publishes no cycling profile, and none is modelled here.',
  },
  {
    key: 'gpu',
    html:
      'French zoning and public-utility easements: ' +
      '<a href="https://www.geoportail-urbanisme.gouv.fr/" target="_blank" rel="noopener">G&eacute;oportail de l\'urbanisme</a>, ' +
      'read through <a href="https://apicarto.ign.fr/api/doc/gpu" target="_blank" rel="noopener">APIcarto</a> &mdash; IGN ' +
      '(<a href="https://github.com/etalab/licence-ouverte/blob/master/LO.md" target="_blank" rel="noopener">Licence Ouverte 2.0</a>). ' +
      'Outlines are decimated for drawing and flagged as simplified; they are not surveyed boundaries, and each ' +
      'easement links to its own regulation document.',
  },
  {
    key: 'idfm',
    html:
      'Paris-region transport network (stops, lines, official line colours): ' +
      '<a href="https://data.iledefrance-mobilites.fr/" target="_blank" rel="noopener">&Icirc;le-de-France Mobilit&eacute;s open data</a> ' +
      '(<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL 1.0</a> &mdash; attribution, and share-alike on derived databases). ' +
      'IDFM publishes no real-time vehicle positions; this layer draws the network offer and never a simulated vehicle.',
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
