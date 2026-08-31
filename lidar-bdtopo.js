import * as Cesium from 'cesium';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import 'cesium/Build/Cesium/Widgets/widgets.css';

// -----------------------------------------------------------------------------
// APERÇU — LiDAR HD (MNT) + BD TOPO 3D sur un quartier réel.
//
// Voir l'en-tête de lidar-bdtopo.html pour le pourquoi. Ce fichier est le
// comment, et il tient en quatre morceaux :
//
//   1. `loadMntPatch`      une requête WMS, un raster de flottants, un
//                          échantillonneur bilinéaire.
//   2. `makeTerrainProvider` ce raster présenté à Cesium comme un vrai terrain.
//   3. `loadBuildings`     les tuiles vectorielles BD TOPO, extrudées entre
//                          leurs deux altitudes publiées.
//   4. `measureFit`        la mesure qui dit si les deux se rejoignent
//                          vraiment, plutôt que de nous le faire croire.
// -----------------------------------------------------------------------------

// --- Quartiers --------------------------------------------------------------
// Emprises vérifiées couvertes par le LiDAR HD (0 pixel nodata au 2026-08-31).
// `view` est ce qu'on regarde ; le MNT téléchargé déborde de `MNT_MARGIN` de
// chaque côté, pour que le relief ne se coupe pas net au bord du champ.
// `heading`/`pitch`/`range` : l'oblique qui rend le dénivelé lisible, `range`
// en multiples du rayon de l'emprise.
const SITES = {
  lyon: {
    label: 'Lyon — Fourvière',
    view: { west: 4.8150, south: 45.7550, east: 4.8300, north: 45.7650 },
    heading: 255, pitch: -14, range: 2.3,
  },
  grenoble: {
    label: 'Grenoble — la Bastille',
    view: { west: 5.7200, south: 45.1900, east: 5.7350, north: 45.2000 },
    heading: 15, pitch: -14, range: 2.6,
  },
  marseille: {
    label: 'Marseille — Notre-Dame-de-la-Garde',
    view: { west: 5.3600, south: 43.2800, east: 5.3750, north: 43.2900 },
    heading: 330, pitch: -16, range: 2.4,
  },
  montmartre: {
    label: 'Paris — la butte Montmartre',
    view: { west: 2.3350, south: 48.8820, east: 2.3480, north: 48.8920 },
    heading: 190, pitch: -16, range: 2.4,
  },
  defense: {
    label: 'Paris — La Défense',
    view: { west: 2.2300, south: 48.8850, east: 2.2500, north: 48.8980 },
    heading: 290, pitch: -12, range: 2.2,
  },
};

/** Débordement du MNT autour de l'emprise regardée, en fraction de sa taille. */
const MNT_MARGIN = 0.45;

/**
 * L'emprise à télécharger autour d'une emprise regardée.
 * @param {{west:number,south:number,east:number,north:number}} view
 * @returns {{west:number,south:number,east:number,north:number}}
 */
function patchRect(view) {
  const dLon = (view.east - view.west) * MNT_MARGIN;
  const dLat = (view.north - view.south) * MNT_MARGIN;
  return {
    west: view.west - dLon, east: view.east + dLon,
    south: view.south - dLat, north: view.north + dLat,
  };
}

// --- Services IGN, tous keyless ---------------------------------------------
const WMS_R = 'https://data.geopf.fr/wms-r/wms';
const WMTS = 'https://data.geopf.fr/wmts';
const BDTOPO_TMS = 'https://data.geopf.fr/tms/1.0.0/BDTOPO';

/**
 * MNT LiDAR HD. `.MIXED.` plutôt que `.ELEVATIONGRIDCOVERAGE.` : la variante
 * mixte bouche les zones que le vol LiDAR n'a pas encore couvertes avec le
 * RGE ALTI, donc elle ne renvoie jamais de trou au milieu d'une ville.
 */
const MNT_LAYER = 'IGNF_LIDAR-HD_MNT_ELEVATION.MIXED.WGS84G';
/** Valeur nodata du service — mer, hors emprise. Jamais une altitude. */
const MNT_NODATA_BELOW = -1000;

const IGN_CREDIT = '© IGN — Géoplateforme (Licence Ouverte 2.0)';

const BASE_LAYERS = {
  ortho: { layer: 'ORTHOIMAGERY.ORTHOPHOTOS', tms: 'PM_0_19', max: 19, format: 'image/jpeg' },
  mnt: { layer: 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', tms: 'PM_0_18', max: 18, format: 'image/png' },
  mnh: { layer: 'IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', tms: 'PM_0_18', max: 18, format: 'image/png' },
  plan: { layer: 'PLANIGN.LIDAR.TERRAIN', tms: 'PM_6_18', max: 18, min: 6, format: 'image/png' },
};

// --- Bâti -------------------------------------------------------------------
/** Niveau de tuiles BD TOPO. z16 porte le bâti complet, non simplifié. */
const BDTOPO_Z = 16;
/** Garde-fou : au-delà, c'est qu'on a demandé une emprise trop large. */
const MAX_TILES = 64;
/**
 * On enfonce la base des volumes de 2 m sous `altitude_minimale_sol`.
 * BD TOPO déclare `precision_altimetrique` à 1,5 m sur du bâti photogrammétrique
 * et le MNT LiDAR est à ±0,2 m : sans cette marge, un bâtiment dont l'altitude
 * publiée dépasse le sol mesuré de 40 cm laisse voir le jour sous ses murs.
 * Elle ne change rien à la partie visible — seul le sous-sol s'allonge.
 */
const SINK_M = 2;
/** `precision_altimetrique` quand la BD TOPO n'a pas de Z du tout. */
const NO_Z_SENTINEL = 9999;

const USAGE_COLOR = {
  'Résidentiel': '#e8b96a',
  'Commercial et services': '#6ad0e8',
  'Industriel': '#e87d7d',
  'Agricole': '#9ee87d',
  'Sportif': '#b9a7e8',
  'Religieux': '#b9a7e8',
  'Annexe': '#b9a7e8',
};
/** Teinte neutre du mode « maquette » : la forme parle, pas la catégorie. */
const MASSING_BASE = '#d8cbb4';

/**
 * La couleur d'un volume.
 *
 * OPAQUE, sans exception. Un alpha même de 0,94 fait basculer la géométrie dans
 * la passe translucide de Cesium, qui n'écrit pas la profondeur : les bâtiments
 * cessent de se cacher les uns les autres et la ville se lit comme une seule
 * masse où tout transparaît à travers tout. C'était le défaut principal du
 * premier rendu.
 *
 * La luminosité porte la HAUTEUR, et c'est délibéré : sur ces tuiles, 83 à 87 %
 * des bâtiments tombent dans deux valeurs d'`usage_1` (Résidentiel et
 * Indifférencié), donc la couleur par usage est presque constante et ne sépare
 * rien. La hauteur, elle, varie entre voisins immédiats — c'est le seul canal
 * qui distingue deux immeubles accolés quand aucune arête ne les sépare.
 * @param {string} usage
 * @param {number} heightM — hauteur visible du volume.
 * @param {'usage'|'massing'} mode
 * @returns {Cesium.Color}
 */
function colorFor(usage, heightM, mode) {
  const base = Cesium.Color.fromCssColorString(
    mode === 'usage' ? (USAGE_COLOR[usage] || '#8d9aa6') : MASSING_BASE,
  );
  const t = Math.min(Math.max(((Number(heightM) || 6) - 4) / 34, 0), 1);
  // `darken` is an INSTANCE method on Cesium.Color; there is no static form.
  return base.darken(0.42 * (1 - t), new Cesium.Color());
}

// -----------------------------------------------------------------------------
// 1. Le MNT, en une requête
// -----------------------------------------------------------------------------

/**
 * Raster d'altitudes NGF-IGN69 sur une emprise, échantillonnable en continu.
 *
 * Le WMS raster de la Géoplateforme est plafonné à 40 requêtes/minute : un
 * fournisseur de terrain tuilé classique le dépasse en quelques secondes de
 * navigation. On télécharge donc UNE dalle qui couvre tout le quartier et on la
 * garde en mémoire. Effet de bord agréable : plus aucune couture entre tuiles.
 */
class MntPatch {
  /**
   * @param {{west:number,south:number,east:number,north:number}} rect — degrés.
   * @param {number} width — colonnes du raster.
   * @param {number} height — lignes du raster.
   * @param {Float32Array} values — altitudes NGF, ligne 0 = nord.
   * @param {number} geoidN — ondulation du géoïde au centre, en mètres.
   */
  constructor(rect, width, height, values, geoidN) {
    this.rect = rect;
    this.width = width;
    this.height = height;
    this.values = values;
    this.geoidN = geoidN;

    let min = Infinity; let max = -Infinity; let holes = 0; let sum = 0; let n = 0;
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i];
      if (v <= MNT_NODATA_BELOW) { holes += 1; continue; }
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v; n += 1;
    }
    this.minM = n ? min : 0;
    this.maxM = n ? max : 0;
    this.holes = holes;
    // Les trous prennent la valeur VALIDE LA PLUS PROCHE, pas la moyenne de
    // l'emprise : à Grenoble, où le vol LiDAR s'arrête en cours de montagne,
    // une moyenne poserait un plateau à 350 m en plein milieu d'un versant qui
    // en fait 430. Le prolongement du bord, lui, se voit à peine.
    if (holes) fillHolesNearest(values, width, height, n ? sum / n : 0);
  }

  /**
   * Altitude ORTHOMÉTRIQUE (NGF-IGN69) en un point, par interpolation
   * bilinéaire entre les centres de pixels. Hors emprise, la valeur du bord est
   * prolongée : le monde continue à plat au lieu de tomber d'une falaise.
   * @param {number} lonDeg
   * @param {number} latDeg
   * @returns {number} mètres NGF
   */
  orthometricAt(lonDeg, latDeg) {
    const { west, south, east, north } = this.rect;
    const w = this.width; const h = this.height;
    // -0.5 : le premier échantillon est au CENTRE du premier pixel, pas au bord.
    let fx = ((lonDeg - west) / (east - west)) * w - 0.5;
    let fy = ((north - latDeg) / (north - south)) * h - 0.5;
    fx = Math.min(Math.max(fx, 0), w - 1);
    fy = Math.min(Math.max(fy, 0), h - 1);
    const x0 = Math.floor(fx); const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, w - 1); const y1 = Math.min(y0 + 1, h - 1);
    const tx = fx - x0; const ty = fy - y0;
    const v = this.values;
    const a = v[y0 * w + x0]; const b = v[y0 * w + x1];
    const c = v[y1 * w + x0]; const d = v[y1 * w + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /**
   * La même altitude, ramenée sur l'ellipsoïde WGS84 que Cesium attend :
   * h = H + N. N est pris au centre de l'emprise — il varie de moins de 2 cm
   * sur un quartier, très en dessous du bruit du MNT lui-même.
   * @param {number} lonDeg
   * @param {number} latDeg
   * @returns {number} mètres ellipsoïdaux
   */
  ellipsoidalAt(lonDeg, latDeg) {
    return this.orthometricAt(lonDeg, latDeg) + this.geoidN;
  }
}

/**
 * Un aller-retour de remplissage « plus proche voisin » le long d'un axe.
 * @param {Float32Array} values — modifié sur place.
 * @param {number} width
 * @param {number} height
 * @param {boolean} horizontal — true : balayage en lignes, false : en colonnes.
 * @returns {number} nombre de trous encore ouverts après ce passage.
 */
function nearestSweep(values, width, height, horizontal) {
  const bad = (v) => v <= MNT_NODATA_BELOW;
  const best = new Float32Array(values.length);
  const has = new Uint8Array(values.length);
  const dist = new Int32Array(values.length);
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  const step = horizontal ? 1 : width;

  for (let o = 0; o < outer; o += 1) {
    const base = horizontal ? o * width : o;
    let lastVal = 0; let lastPos = -1;
    for (let i = 0; i < inner; i += 1) {
      const k = base + i * step;
      if (!bad(values[k])) { lastVal = values[k]; lastPos = i; continue; }
      if (lastPos >= 0) { best[k] = lastVal; has[k] = 1; dist[k] = i - lastPos; }
    }
    lastPos = -1;
    for (let i = inner - 1; i >= 0; i -= 1) {
      const k = base + i * step;
      if (!bad(values[k])) { lastVal = values[k]; lastPos = i; continue; }
      if (lastPos < 0) continue;
      const d = lastPos - i;
      if (!has[k] || d < dist[k]) { best[k] = lastVal; has[k] = 1; dist[k] = d; }
    }
  }

  let remaining = 0;
  for (let k = 0; k < values.length; k += 1) {
    if (!bad(values[k])) continue;
    if (has[k]) values[k] = best[k]; else remaining += 1;
  }
  return remaining;
}

/**
 * Bouche les pixels sans donnée par la valeur valide la plus proche.
 *
 * On alterne les axes : un pixel dont la LIGNE ENTIÈRE et la COLONNE ENTIÈRE
 * sont vides n'a de voisin qu'en diagonale et n'est atteint qu'au tour suivant.
 * Deux tours suffisent sur un raster réel — le troisième est là pour que la
 * boucle ait une fin, et le repli pour le cas où l'emprise est vide de bout en
 * bout, qui est un échec de requête, pas un trou.
 * @param {Float32Array} values — modifié sur place.
 * @param {number} width
 * @param {number} height
 * @param {number} fallback
 * @returns {void}
 */
function fillHolesNearest(values, width, height, fallback) {
  for (let pass = 0; pass < 4; pass += 1) {
    if (nearestSweep(values, width, height, pass % 2 === 0) === 0) return;
  }
  for (let k = 0; k < values.length; k += 1) {
    if (values[k] <= MNT_NODATA_BELOW) values[k] = fallback;
  }
}

/** true si la plateforme est petit-boutiste (toutes le sont, mais vérifions). */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Mètres par degré de longitude à une latitude donnée. @returns {number} */
const metresPerLonDeg = (latDeg) => 111320 * Math.cos((latDeg * Math.PI) / 180);
/** Mètres par degré de latitude — constant à ce qu'on en fait près. */
const METRES_PER_LAT_DEG = 111320;

/**
 * Télécharge le MNT LiDAR HD sur une emprise, en une seule requête WMS.
 *
 * `budget` est le côté LE PLUS LONG du raster ; l'autre est calculé pour que le
 * pixel reste carré au sol. Un raster carré sur une emprise qui ne l'est pas
 * étirerait l'échantillonnage dans une direction et le tasserait dans l'autre.
 * @param {{west:number,south:number,east:number,north:number}} rect
 * @param {number} budget — 1024 / 2048 / 4096.
 * @param {number} geoidN — ondulation du géoïde au centre de l'emprise.
 * @returns {Promise<MntPatch>}
 */
async function loadMntPatch(rect, budget, geoidN) {
  const midLat = (rect.south + rect.north) / 2;
  const spanXm = (rect.east - rect.west) * metresPerLonDeg(midLat);
  const spanYm = (rect.north - rect.south) * METRES_PER_LAT_DEG;
  const scale = budget / Math.max(spanXm, spanYm);
  const width = Math.max(2, Math.round(spanXm * scale));
  const height = Math.max(2, Math.round(spanYm * scale));

  // WMS 1.3.0 + EPSG:4326 : la BBOX est en (lat, lon), pas l'inverse.
  const url = `${WMS_R}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
    + `&LAYERS=${encodeURIComponent(MNT_LAYER)}&STYLES=`
    + `&CRS=EPSG:4326&BBOX=${rect.south},${rect.west},${rect.north},${rect.east}`
    + `&WIDTH=${width}&HEIGHT=${height}&FORMAT=${encodeURIComponent('image/x-bil;bits=32')}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`MNT LiDAR : HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const expected = width * height * 4;
  if (buf.byteLength !== expected) {
    // Le service répond en XML quand il n'est pas content ; on le dit.
    const head = new TextDecoder().decode(buf.slice(0, 300));
    throw new Error(`MNT LiDAR : ${buf.byteLength} octets au lieu de ${expected} — ${head.slice(0, 160)}`);
  }

  let values;
  if (LITTLE_ENDIAN) {
    values = new Float32Array(buf);
  } else {
    const view = new DataView(buf);
    values = new Float32Array(width * height);
    for (let i = 0; i < values.length; i += 1) values[i] = view.getFloat32(i * 4, true);
  }
  return new MntPatch(rect, width, height, values, geoidN);
}

// -----------------------------------------------------------------------------
// 2. Le raster présenté à Cesium comme un terrain
// -----------------------------------------------------------------------------

/** Côté de la grille d'altitudes remise à Cesium pour chaque tuile de terrain. */
const HEIGHTMAP_SIDE = 64;

/**
 * Terrain Cesium adossé à une dalle MNT en mémoire.
 *
 * `CustomHeightmapTerrainProvider` veut une grille d'altitudes ELLIPSOÏDALES
 * par tuile, en ordre ligne-majeur, ligne 0 au NORD — exactement l'ordre dans
 * lequel le WMS livre son BIL, ce qui évite tout retournement.
 * @param {MntPatch} patch
 * @returns {Cesium.CustomHeightmapTerrainProvider}
 */
function makeTerrainProvider(patch) {
  const tilingScheme = new Cesium.GeographicTilingScheme();
  const side = HEIGHTMAP_SIDE;
  return new Cesium.CustomHeightmapTerrainProvider({
    width: side,
    height: side,
    tilingScheme,
    credit: new Cesium.Credit(`MNT LiDAR HD — ${IGN_CREDIT}`, false),
    callback(x, y, level) {
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const west = Cesium.Math.toDegrees(rect.west);
      const east = Cesium.Math.toDegrees(rect.east);
      const north = Cesium.Math.toDegrees(rect.north);
      const south = Cesium.Math.toDegrees(rect.south);
      const out = new Float32Array(side * side);
      for (let row = 0; row < side; row += 1) {
        const lat = north - ((north - south) * row) / (side - 1);
        for (let col = 0; col < side; col += 1) {
          const lon = west + ((east - west) * col) / (side - 1);
          out[row * side + col] = patch.ellipsoidalAt(lon, lat);
        }
      }
      return out;
    },
  });
}

// -----------------------------------------------------------------------------
// Le viewer
// -----------------------------------------------------------------------------

const viewer = new Cesium.Viewer('cesiumContainer', {
  baseLayer: false,
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false,
  animation: false, timeline: false, fullscreenButton: false,
  infoBox: true, selectionIndicator: true,
});
viewer.scene.globe.depthTestAgainstTerrain = true;
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0b1620');
viewer.scene.skyAtmosphere.show = true;
// Le soleil rase : sans ombrage, un MNT à 50 cm ressemble à une nappe.
// Le soleil éclaire le sol ET les volumes : sans lui, murs et toits rendent le
// même ton et une boîte à toit plat n'a plus de forme du tout.
viewer.scene.globe.enableLighting = true;
viewer.scene.light = new Cesium.SunLight();

const statsEl = document.getElementById('stats');
const probeEl = document.getElementById('probe');
const placeEl = document.getElementById('place');
const resEl = document.getElementById('res');
const baseEl = document.getElementById('base');
const tintEl = document.getElementById('tint');
const terrainEl = document.getElementById('terrain');
const buildingsEl = document.getElementById('buildings');
const reloadEl = document.getElementById('reload');

/** État courant, pour que les cases à cocher n'aient pas à tout recharger. */
const state = {
  siteId: null,
  patch: null,
  terrainProvider: null,
  flatTerrain: new Cesium.EllipsoidTerrainProvider(),
  imageryLayer: null,
  buildingStats: null,
  loading: false,
};

/** Installe l'habillage choisi, en remplaçant le précédent. */
function setBaseLayer(key) {
  const spec = BASE_LAYERS[key] || BASE_LAYERS.ortho;
  const labels = [];
  for (let i = 0; i <= spec.max; i += 1) labels.push(String(i));
  const provider = new Cesium.WebMapTileServiceImageryProvider({
    url: WMTS,
    layer: spec.layer,
    style: 'normal',
    format: spec.format,
    tileMatrixSetID: spec.tms,
    tileMatrixLabels: labels,
    maximumLevel: spec.max,
    credit: new Cesium.Credit(IGN_CREDIT, false),
  });
  const next = new Cesium.ImageryLayer(provider);
  viewer.imageryLayers.add(next, 0);
  if (state.imageryLayer) viewer.imageryLayers.remove(state.imageryLayer, true);
  state.imageryLayer = next;
}

/** Applique le terrain LiDAR ou l'ellipsoïde plat, selon la case. */
function applyTerrain() {
  const wanted = terrainEl.checked && state.terrainProvider
    ? state.terrainProvider
    : state.flatTerrain;
  if (viewer.terrainProvider !== wanted) viewer.terrainProvider = wanted;
}

// -----------------------------------------------------------------------------
// 3. Le bâti BD TOPO
// -----------------------------------------------------------------------------

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) =>
  Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);

/**
 * @param {number} z @param {number} x @param {number} y
 * @returns {Promise<?{tile: VectorTile, z: number, x: number, y: number, bytes: number}>}
 */
async function fetchTile(z, x, y) {
  const res = await fetch(`${BDTOPO_TMS}/${z}/${x}/${y}.pbf`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`tuile ${z}/${x}/${y} : HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length) return null;
  return { tile: new VectorTile(new PbfReader(buf)), z, x, y, bytes: buf.length };
}

const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Où poser un bâtiment, et pourquoi.
 *
 * L'ordre est une hiérarchie de preuve, pas une préférence de rendu :
 *   1. les deux altitudes publiées par l'IGN — le bâtiment sait où il est ;
 *   2. l'altitude de sol publiée + la hauteur publiée — le toit est déduit ;
 *   3. le MNT sous le centroïde + la hauteur publiée — le sol est mesuré,
 *      l'IGN ne l'ayant pas déclaré pour ce bâtiment ;
 *   4. rien de tout ça : 6 m au-dessus du MNT, et on le compte à part.
 * @param {object} props — attributs BD TOPO.
 * @param {{lon:number, lat:number}} centroid
 * @param {MntPatch} patch
 * @returns {{base:number, top:number, basis:'published'|'height'|'lidar'|'guess'}}
 */
function seatBuilding(props, centroid, patch) {
  const N = patch.geoidN;
  const minSol = finite(props.altitude_minimale_sol);
  const maxToit = finite(props.altitude_maximale_toit);
  const hauteur = finite(props.hauteur);

  if (minSol !== null && maxToit !== null && maxToit > minSol) {
    return { base: minSol + N - SINK_M, top: maxToit + N, basis: 'published' };
  }
  if (minSol !== null && hauteur !== null && hauteur > 0) {
    return { base: minSol + N - SINK_M, top: minSol + N + hauteur, basis: 'height' };
  }
  const ground = patch.ellipsoidalAt(centroid.lon, centroid.lat);
  if (hauteur !== null && hauteur > 0) {
    return { base: ground - SINK_M, top: ground + hauteur, basis: 'lidar' };
  }
  return { base: ground - SINK_M, top: ground + 6, basis: 'guess' };
}

/**
 * La mesure qui vaut la démonstration : l'altitude de sol que la BD TOPO
 * DÉCLARE tombe-t-elle sur le sol que le LiDAR MESURE ?
 *
 * On compare le MNT sous le centroïde à la fourchette [altitude_minimale_sol,
 * altitude_maximale_sol] du bâtiment — la fourchette est la bonne cible, parce
 * qu'un bâtiment en pente n'a pas UNE altitude de sol. Un mètre de tolérance de
 * part et d'autre : la BD TOPO annonce elle-même 1,5 m de précision
 * altimétrique sur le bâti photogrammétrique.
 * @param {object} props
 * @param {{lon:number, lat:number}} centroid
 * @param {MntPatch} patch
 * @returns {?{inside: boolean, deltaM: number}}
 */
function measureFit(props, centroid, patch) {
  const minSol = finite(props.altitude_minimale_sol);
  if (minSol === null) return null;
  const declared = finite(props.precision_altimetrique);
  // 9999 n'est pas une précision de 10 km : c'est la sentinelle « pas de Z ».
  // Un bâtiment qui n'a pas d'altitude ne peut pas être confronté à une mesure.
  if (declared === NO_Z_SENTINEL) return null;

  const mnt = patch.orthometricAt(centroid.lon, centroid.lat);
  const maxSol = finite(props.altitude_maximale_sol);
  // La tolérance est celle que la BD TOPO s'accorde à elle-même — jamais une
  // qu'on choisirait pour se donner raison. Plancher à 1 m : en dessous, c'est
  // le bruit du MNT et la position du centroïde qu'on mesurerait.
  const tol = Math.max(declared === null ? 1.5 : declared, 1);
  const high = (maxSol === null ? minSol : maxSol) + tol;
  return {
    inside: mnt >= minSol - tol && mnt <= high,
    deltaM: mnt - minSol,
    tol,
    // Paris ne publie ni `altitude_maximale_sol` ni `altitude_maximale_toit` :
    // là-bas la cible est un point, ailleurs c'est une fourchette. Dire lequel
    // évite de comparer deux sévérités différentes comme si c'était la même.
    ranged: maxSol !== null,
  };
}

/** Médiane d'un tableau de nombres (mute le tableau). @returns {number} */
function median(values) {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** Fiche d'un bâtiment, affichée par l'infoBox de Cesium. @returns {string} */
function describe(props, seat, fit) {
  const rows = [
    ['Usage principal', props.usage_1],
    ['Usage secondaire', props.usage_2],
    ['Nature', props.nature],
    ['Hauteur publiée', props.hauteur ? `${props.hauteur} m` : null],
    ['Étages', props.nombre_d_etages],
    ['Logements', props.nombre_de_logements],
    ['Altitude sol (BD TOPO)', props.altitude_minimale_sol != null
      ? `${props.altitude_minimale_sol} → ${props.altitude_maximale_sol ?? '?'} m NGF` : null],
    ['Altitude toit (BD TOPO)', props.altitude_maximale_toit != null
      ? `${props.altitude_maximale_toit} m NGF` : null],
    ['Sol mesuré (MNT LiDAR)', fit ? `${(props.altitude_minimale_sol + fit.deltaM).toFixed(1)} m NGF` : null],
    ['Écart déclaré ↔ mesuré', fit ? `${fit.deltaM >= 0 ? '+' : ''}${fit.deltaM.toFixed(1)} m` : null],
    ['Posé sur', {
      published: 'ses deux altitudes publiées',
      height: 'son altitude de sol + sa hauteur',
      lidar: 'le MNT LiDAR + sa hauteur',
      guess: 'le MNT LiDAR, hauteur inconnue (6 m par défaut)',
    }[seat.basis]],
    ['Précision altimétrique', props.precision_altimetrique ? `${props.precision_altimetrique} m` : null],
    ['Acquisition altimétrique', props.methode_d_acquisition_altimetrique],
    ['Matériaux toiture', props.materiaux_de_la_toiture],
    ['Identifiant RNB', props.identifiants_rnb],
    ['Clé IGN', props.cleabs],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  return '<table class="cesium-infoBox-defaultTable"><tbody>'
    + rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')
    + '</tbody></table>';
}

/**
 * Charge et dessine le bâti BD TOPO de l'emprise visible du quartier.
 * @param {object} site
 * @param {MntPatch} patch
 * @returns {Promise<object>} statistiques de chargement.
 */
async function loadBuildings(site, patch) {
  // Le bâti déborde de l'emprise regardée exactement comme le MNT : sinon la
  // ville s'arrête net sur une ligne droite au milieu du champ, ce qui se lit
  // comme une limite de données alors que ce n'est qu'une limite de requête.
  const rect = patchRect(site.view);
  const { west, south, east, north } = rect;
  const x0 = lon2x(west, BDTOPO_Z); const x1 = lon2x(east, BDTOPO_Z);
  const y0 = lat2y(north, BDTOPO_Z); const y1 = lat2y(south, BDTOPO_Z);
  const wanted = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (wanted > MAX_TILES) throw new Error(`${wanted} tuiles demandées, plafond ${MAX_TILES}`);

  const jobs = [];
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) jobs.push(fetchTile(BDTOPO_Z, x, y));

  const t0 = performance.now();
  const tiles = (await Promise.all(jobs)).filter(Boolean);
  const tFetch = performance.now() - t0;
  const bytes = tiles.reduce((acc, t) => acc + t.bytes, 0);

  viewer.entities.removeAll();
  viewer.entities.suspendEvents();

  const t1 = performance.now();
  const seen = new Set();
  const deltas = [];
  const basis = { published: 0, height: 0, lidar: 0, guess: 0 };
  const methods = new Map();
  let volumes = 0; let insideCount = 0; let fitCount = 0; let rangedCount = 0;
  let tallest = 0; let homes = 0; let outside = 0;

  for (const { tile, z, x, y } of tiles) {
    const layer = tile.layers.batiment;
    if (!layer) continue;
    for (let i = 0; i < layer.length; i += 1) {
      const feature = layer.feature(i);
      const props = feature.properties || {};

      const gj = feature.toGeoJSON(x, y, z);
      const polygons = gj.geometry.type === 'MultiPolygon'
        ? gj.geometry.coordinates : [gj.geometry.coordinates];
      for (const polygon of polygons) {
        const ring = polygon[0];
        if (!ring || ring.length < 4) continue;

        let cx = 0; let cy = 0;
        const flat = [];
        for (const [lon, lat] of ring) { flat.push(lon, lat); cx += lon; cy += lat; }
        const centroid = { lon: cx / ring.length, lat: cy / ring.length };

        // Les anneaux INTÉRIEURS, que la première version jetait. La BD TOPO en
        // publie sur 11 % des polygones à Lyon et 6 % à Grenoble : ce sont les
        // cours d'îlot et les puits de lumière. Les boucher remplissait de
        // béton plein exactement les vides qui séparent un bâtiment du suivant,
        // et transformait un front de rue en un bloc unique.
        const holes = [];
        for (let h = 1; h < polygon.length; h += 1) {
          const inner = polygon[h];
          if (!inner || inner.length < 4) continue;
          const flatHole = [];
          for (const [lon, lat] of inner) flatHole.push(lon, lat);
          holes.push(new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flatHole)));
        }

        // Les tuiles z16 débordent de l'emprise du MNT de plusieurs centaines
        // de mètres. Au-delà du bord, `orthometricAt` prolonge la dernière
        // valeur connue : on y dessinerait des bâtiments assis sur un sol
        // inventé, et on les compterait dans une mesure d'accord qui n'en
        // serait plus une. On les laisse donc dehors, et on le dit.
        if (centroid.lon < west || centroid.lon > east
          || centroid.lat < south || centroid.lat > north) { outside += 1; continue; }

        // Un bâtiment à cheval sur deux tuiles y apparaît découpé : on dessine
        // chaque morceau (ils se recollent) mais on ne le compte qu'une fois.
        const fresh = props.cleabs && !seen.has(props.cleabs);
        if (fresh) {
          seen.add(props.cleabs);
          homes += Number(props.nombre_de_logements) || 0;
          const method = props.methode_d_acquisition_altimetrique || 'non renseignée';
          methods.set(method, (methods.get(method) || 0) + 1);
        }

        const seat = seatBuilding(props, centroid, patch);
        const fit = measureFit(props, centroid, patch);
        if (fresh) {
          basis[seat.basis] += 1;
          if (fit) {
            fitCount += 1;
            deltas.push(fit.deltaM);
            if (fit.inside) insideCount += 1;
            if (fit.ranged) rangedCount += 1;
          }
          const above = seat.top - (seat.base + SINK_M);
          if (above > tallest) tallest = above;
        }

        viewer.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(
              Cesium.Cartesian3.fromDegreesArray(flat), holes,
            ),
            height: seat.base,
            extrudedHeight: seat.top,
            material: colorFor(props.usage_1, seat.top - seat.base - SINK_M, tintEl.value),
            outline: false,
            closeTop: true,
            // Fermé : sur un versant la base d'un volume finit par affleurer, et
            // un fond ouvert laisse voir l'intérieur des murs opposés.
            closeBottom: true,
          },
          name: props.usage_1 || props.nature || 'Bâtiment',
          description: describe(props, seat, fit),
        });
        volumes += 1;
      }
    }
  }

  viewer.entities.resumeEvents();
  return {
    buildings: seen.size,
    volumes,
    tiles: tiles.length,
    bytes,
    tFetch,
    tDraw: performance.now() - t1,
    basis,
    methods: [...methods.entries()].sort((a, b) => b[1] - a[1]),
    homes,
    tallest,
    outside,
    fitCount,
    rangedPct: fitCount ? (100 * rangedCount) / fitCount : null,
    insidePct: fitCount ? (100 * insideCount) / fitCount : null,
    medianDelta: deltas.length ? median(deltas) : null,
  };
}

// -----------------------------------------------------------------------------
// Orchestration
// -----------------------------------------------------------------------------

/** Repeint le bloc de statistiques à partir de l'état courant. */
function renderStats() {
  const patch = state.patch;
  if (!patch) { statsEl.textContent = 'Chargement…'; return; }
  const spanM = patch.maxM - patch.minM;
  const px = ((patch.rect.north - patch.rect.south) * METRES_PER_LAT_DEG) / patch.height;

  const lines = [];
  lines.push(`<span class="k">MNT LiDAR</span> <b>${patch.width}×${patch.height}</b> px`
    + ` · <b>${px.toFixed(2)} m</b>/px`);
  lines.push(`<span class="k">relief</span> <b>${patch.minM.toFixed(1)}</b> → <b>${patch.maxM.toFixed(1)}</b> m NGF`
    + ` (<b>${spanM.toFixed(0)} m</b>)`);
  lines.push(`<span class="k">géoïde EGM96</span> N = <b>${patch.geoidN.toFixed(2)} m</b>`
    + (patch.holes ? ` · <span class="warn">${patch.holes} px sans donnée</span>` : ''));

  const b = state.buildingStats;
  if (b) {
    const total = Math.max(b.buildings, 1);
    const pct = (n) => `${((100 * n) / total).toFixed(1)}%`;
    lines.push('<hr style="border:0;border-top:1px solid rgba(120,190,240,.15);margin:7px 0">');
    lines.push(`<span class="k">BD TOPO</span> <b>${b.buildings}</b> bâtiments · ${b.volumes} volumes`
      + ` · ${b.tiles} tuiles z${BDTOPO_Z}`);
    lines.push(`<span class="k">posés sur</span> sol + toit publiés <b>${pct(b.basis.published)}</b>`
      + ` · sol + hauteur <b>${pct(b.basis.height)}</b>`
      + ((b.basis.lidar + b.basis.guess)
        ? ` · MNT LiDAR <b>${pct(b.basis.lidar + b.basis.guess)}</b>` : ''));
    if (b.insidePct !== null) {
      // Paris ne publie qu'UNE altitude de sol, Lyon en publie deux : la cible
      // n'a pas la même largeur, et la phrase doit le dire ou le pourcentage ment.
      const cible = b.rangedPct > 50
        ? 'dans la fourchette de sol publiée'
        : "sur l'altitude de sol publiée";
      lines.push(`<span class="k">sol déclaré ↔ sol LiDAR</span> <b>${b.insidePct.toFixed(1)}%</b>`
        + ` ${cible} · écart médian`
        + ` <b>${b.medianDelta >= 0 ? '+' : ''}${b.medianDelta.toFixed(2)} m</b>`);
    }
    if (b.methods?.length) {
      const [name, count] = b.methods[0];
      lines.push(`<span class="k">altimétrie IGN</span> ${name.toLowerCase()} pour <b>${pct(count)}</b>`
        + (b.methods.length > 1 ? ` <span class="k">(+${b.methods.length - 1} autres)</span>` : ''));
    }
    lines.push(`<span class="k">le plus haut</span> <b>${b.tallest.toFixed(1)} m</b>`
      + (b.homes ? ` · <b>${b.homes}</b> logements` : ''));
    lines.push(`<span class="k">réseau</span> ${(b.bytes / 1024).toFixed(0)} Ko en ${b.tFetch.toFixed(0)} ms`
      + ` · rendu ${b.tDraw.toFixed(0)} ms`
      + (b.outside ? ` · <span class="k">${b.outside} hors emprise MNT, non dessinés</span>` : ''));
  }
  statsEl.innerHTML = lines.join('<br>');
}

/** Charge un quartier de bout en bout : MNT, terrain, habillage, bâti, caméra. */
async function loadSite(siteId) {
  if (state.loading) return;
  const site = SITES[siteId];
  if (!site) return;
  state.loading = true;
  reloadEl.disabled = true;
  placeEl.disabled = true;
  statsEl.innerHTML = `Téléchargement du MNT LiDAR HD sur <b>${site.label}</b>…`;

  try {
    const { meanSeaLevel } = await import('egm96-universal');
    const rect = patchRect(site.view);
    const centreLat = (rect.south + rect.north) / 2;
    const centreLon = (rect.west + rect.east) / 2;
    const geoidN = meanSeaLevel(centreLat, centreLon);

    const patch = await loadMntPatch(rect, Number(resEl.value), geoidN);
    state.siteId = siteId;
    state.patch = patch;
    state.terrainProvider = makeTerrainProvider(patch);
    state.buildingStats = null;
    applyTerrain();
    renderStats();

    // `flyTo` sur un Rectangle cadre à la verticale et ignore l'orientation
    // demandée : on passe par une sphère englobante, seule façon d'obtenir une
    // vue oblique à une distance choisie — et l'oblique est tout l'intérêt ici.
    const target = Cesium.Rectangle.fromDegrees(
      site.view.west, site.view.south, site.view.east, site.view.north,
    );
    const sphere = Cesium.BoundingSphere.fromRectangle3D(
      target, Cesium.Ellipsoid.WGS84, patch.ellipsoidalAt(centreLon, centreLat),
    );
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(site.heading),
        Cesium.Math.toRadians(site.pitch),
        sphere.radius * site.range,
      ),
      duration: 1.8,
    });

    if (buildingsEl.checked) {
      statsEl.innerHTML += '<br><span class="k">Chargement du bâti BD TOPO…</span>';
      state.buildingStats = await loadBuildings(site, patch);
    } else {
      viewer.entities.removeAll();
    }
    renderStats();
  } catch (error) {
    statsEl.innerHTML = `<span class="warn">Échec : ${error.message}</span>`;
    console.error('[lidar-bdtopo]', error);
  } finally {
    state.loading = false;
    reloadEl.disabled = false;
    placeEl.disabled = false;
  }
}

// --- Sonde au sol -----------------------------------------------------------
// Un clic sur le terrain rend l'altitude MESURÉE là où on a cliqué : c'est la
// seule façon honnête de montrer qu'on regarde une mesure et pas un décor.
const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
clickHandler.setInputAction((movement) => {
  if (viewer.scene.pick(movement.position)) return; // un bâtiment : l'infoBox s'en charge
  const ray = viewer.camera.getPickRay(movement.position);
  const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
  if (!hit || !state.patch) return;
  const carto = Cesium.Cartographic.fromCartesian(hit);
  const lon = Cesium.Math.toDegrees(carto.longitude);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const ngf = state.patch.orthometricAt(lon, lat);
  probeEl.innerHTML =
    `<b>${lat.toFixed(5)}°N ${lon.toFixed(5)}°E</b> · sol LiDAR <b>${ngf.toFixed(2)} m NGF</b>`
    + ` (= ${(ngf + state.patch.geoidN).toFixed(2)} m ellipsoïdaux, N = ${state.patch.geoidN.toFixed(2)} m)`;
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// --- Commandes --------------------------------------------------------------
placeEl.addEventListener('change', () => loadSite(placeEl.value));
resEl.addEventListener('change', () => loadSite(placeEl.value));
reloadEl.addEventListener('click', () => loadSite(placeEl.value));
baseEl.addEventListener('change', () => setBaseLayer(baseEl.value));
tintEl.addEventListener('change', async () => {
  if (!state.patch || !buildingsEl.checked) return;
  // Re-tracé complet : les tuiles sont dans le cache du navigateur,
  // donc c'est un aller-retour mémoire, pas réseau.
  state.buildingStats = await loadBuildings(SITES[state.siteId], state.patch);
  renderStats();
});
terrainEl.addEventListener('change', applyTerrain);
buildingsEl.addEventListener('change', async () => {
  if (!state.patch) return;
  if (!buildingsEl.checked) {
    viewer.entities.removeAll();
    state.buildingStats = null;
    renderStats();
    return;
  }
  state.buildingStats = await loadBuildings(SITES[state.siteId], state.patch);
  renderStats();
});

setBaseLayer(baseEl.value);
loadSite(placeEl.value);

// Pour l'inspection depuis la console et pour la capture d'écran automatisée.
window.__lidarBdtopo = { state, SITES, loadSite };
