#!/usr/bin/env node
/**
 * Mesurer le barème national — la distribution, chez les Français, de ce que la
 * fiche implantation calcule à une adresse.
 *
 * ── LE PROBLÈME QU'IL RÈGLE ─────────────────────────────────────────────────
 * `implantationFiche.js` sait dire « 1,04 km² atteignables à pied en dix
 * minutes, 4 210 habitants, niveau de vie moyen 22 400 €/an ». Personne ne sait
 * si c'est beaucoup, et aucune source ne le publie : la distribution nationale
 * de « la surface qu'un Français atteint à pied en dix minutes » n'existe pas
 * en open data. Elle n'existe que si on la mesure. C'est ce que fait ce script.
 *
 * ── POURQUOI IL NE REPREND PAS `FILOSOFI_RAMPS` ─────────────────────────────
 * Le dépôt porte déjà des quantiles nationaux des mêmes indicateurs, et les
 * réutiliser aurait coûté zéro. Ce sont les quantiles d'un CARREAU de 200 m ;
 * la fiche moyenne une trentaine de carreaux sur un anneau. Moyenner écrase les
 * queues, et une valeur d'anneau notée contre une échelle de carreau reçoit une
 * lettre plausible et fausse. Le script mesure donc les deux sur LE MÊME
 * échantillon et publie l'écart : c'est le chiffre qui justifie le lot.
 *
 * ── L'ÉCHANTILLON EST UN ÉCHANTILLON DE RÉSIDENTS, PAS DE LIEUX ─────────────
 * Tirer des points au hasard sur la carte de France, c'est tirer des champs.
 * Tirer des communes, c'est donner à Saint-Front-sur-Lémance le poids de Lyon.
 * Le tirage est donc à probabilité proportionnelle à la population, en deux
 * degrés : d'abord un carreau de 1 km parmi les 377 234 que l'INSEE publie,
 * avec une probabilité proportionnelle à ses habitants ; puis un carreau de
 * 200 m à l'intérieur, de même. Chaque tirage désigne donc UN habitant, et le
 * centre de son carreau de 200 m — au plus 141 m de chez lui — sert de porte.
 * Les quantiles se lisent ensuite sans pondération : la pondération est DANS le
 * tirage.
 *
 * Tirage SYSTÉMATIQUE et non multinomial : un pas constant sur la population
 * cumulée, ce qui étale l'échantillon sur tout le pays au lieu de laisser le
 * hasard le concentrer. Un carreau plus peuplé que le pas est tiré plusieurs
 * fois, ce qui est correct — il porte plusieurs habitants — et chaque tirage y
 * choisit un carreau de 200 m différent.
 *
 * ── CHAQUE POINT PASSE PAR LES ROUTES DE L'APPLICATION ──────────────────────
 * `/api/isochrone`, `/api/filosofi/carreaux` et `/api/dvf`, sur une instance qui
 * tourne, et l'agrégation par `aggregateInRing()` importée du module que la
 * fiche utilise. Interroger l'IGN en direct aurait été plus simple et aurait
 * mesuré une AUTRE distribution que celle que le lecteur voit : le barème doit
 * sortir du même chemin de code que la mesure qu'il note.
 *
 * ── CE QUE ÇA COÛTE ─────────────────────────────────────────────────────────
 * La trame nationale à 1 km : 76 pages de WFS, ~50 Mo, deux minutes et demie,
 * mise en cache dans `.gev-cache/` — on ne la retire qu'à changement de
 * millésime. Chaque point d'échantillon : un WFS 200 m, un isochrone IGN, un
 * WFS carroyage via le proxy, un DVF. Mesuré ~5 s par point, soit environ
 * 25 minutes pour 300 tirages. Les observations brutes sont écrites à côté de
 * la trame, pour que recalculer une échelle ne coûte plus rien.
 *
 * Usage :
 *   node scripts/build-bareme-fr.mjs --frame
 *   node scripts/build-bareme-fr.mjs --sample 300 --url http://localhost:5199
 *   node scripts/build-bareme-fr.mjs --from .gev-cache/bareme-fr/observations.json
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCarreauxUrl, cellCentre, cellCorners, parseCellId, projectCarreaux, resolutionForBox,
} from '../src/data/filosofiFeed.js';
import { aggregateInRing, ringBounds } from '../src/data/implantationFeed.js';
import { BAREME_INDICATORS, BAREME_LADDER_Q } from '../src/data/baremeNational.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(REPO_ROOT, '.gev-cache', 'bareme-fr');
const FRAME_PATH = path.join(CACHE_DIR, 'frame-1km.json');
const OBSERVATIONS_PATH = path.join(CACHE_DIR, 'observations.json');

const WFS = 'https://data.geopf.fr/wfs/ows';
const FRAME_TYPENAME = 'INSEE.FILOSOFI.INDICATORS:carreaux_1km';
const FRAME_PAGE = 5_000;

/**
 * Les trois boîtes où l'INSEE publie un carroyage, et pas une de plus.
 *
 * Les mêmes que `PACK_BOXES` du pack local. Une seule boîte métropolitaine
 * aurait laissé la Martinique et La Réunion hors du barème, et le barème leur
 * aurait quand même été appliqué — c'est la panne que l'échelle de couleur du
 * carroyage a déjà rencontrée.
 */
const FRAME_BOXES = Object.freeze([
  { name: 'métropole', box: { west: -5.3, south: 41.2, east: 9.7, north: 51.2 } },
  { name: 'Martinique', box: { west: -61.3, south: 14.3, east: -60.7, north: 15.0 } },
  { name: 'La Réunion', box: { west: 55.1, south: -21.5, east: 55.9, north: -20.8 } },
]);

/** L'anneau que le barème décrit. Le même que le pas par défaut de la fiche. */
const RING_SECONDS = 600;
/** Le rayon que la couche DVF balaie, et donc celui du prix au m². */
const DVF_RADIUS_M = 300;
/** La marge de boîte du carroyage, en degrés — la même que `ficheFetch`. */
const PAD_DEG = 0.004;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (line) => process.stderr.write(`${line}\n`);

/**
 * Un générateur pseudo-aléatoire reproductible.
 *
 * Le tirage doit être rejouable : deux exécutions du même script avec la même
 * graine doivent désigner les mêmes habitants, sinon comparer deux millésimes
 * mesure le tirage autant que le pays.
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tirage systématique à probabilité proportionnelle à la taille.
 *
 * @param {Array<{weight: number}>} units Ordre stable — il fixe le résultat.
 * @param {number} n Nombre de tirages.
 * @param {() => number} random Pour le seul décalage de départ.
 * @returns {number[]} Indices tirés, avec répétitions possibles.
 */
export function systematicPps(units, n, random) {
  const total = units.reduce((sum, unit) => sum + Math.max(0, unit.weight || 0), 0);
  if (!(total > 0) || n <= 0) return [];
  const step = total / n;
  let target = random() * step;
  const picked = [];
  let cursor = 0;
  for (let i = 0; i < units.length && picked.length < n; i += 1) {
    cursor += Math.max(0, units[i].weight || 0);
    while (picked.length < n && target < cursor) {
      picked.push(i);
      target += step;
    }
  }
  return picked;
}

/**
 * Un tirage pondéré simple, pour choisir un carreau de 200 m dans un de 1 km.
 * @param {Array<{weight: number}>} units
 * @param {() => number} random
 * @returns {number} L'indice tiré, ou -1.
 */
export function weightedPick(units, random) {
  const total = units.reduce((sum, unit) => sum + Math.max(0, unit.weight || 0), 0);
  if (!(total > 0)) return -1;
  let target = random() * total;
  for (let i = 0; i < units.length; i += 1) {
    target -= Math.max(0, units[i].weight || 0);
    if (target <= 0) return i;
  }
  return units.length - 1;
}

/**
 * Quantiles NON pondérés d'un échantillon déjà tiré proportionnellement à la
 * population.
 *
 * Repondérer ici compterait la population deux fois. La convention est celle du
 * plus proche rang inférieur, la même que `build-filosofi-ramp.mjs`, pour que
 * les deux échelles restent lisibles côte à côte.
 * @param {number[]} values
 * @param {number[]} quantiles
 * @returns {Array<number|null>}
 */
export function sampleQuantiles(values, quantiles) {
  const usable = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!usable.length) return quantiles.map(() => null);
  return quantiles.map((q) => {
    const index = Math.min(usable.length - 1, Math.max(0, Math.ceil(q * usable.length) - 1));
    return usable[index];
  });
}

/** Arrondir à un pas sans laisser traîner le résidu binaire. */
export function roundTo(value, step) {
  if (!Number.isFinite(value)) return null;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

/** @param {string} url @param {number} [timeoutMs] */
async function getJson(url, timeoutMs = 60_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Comme ci-dessus, mais un échec est une absence et non une exception. */
async function tryJson(url, timeoutMs = 40_000) {
  try {
    const payload = await getJson(url, timeoutMs);
    return payload && !payload.error ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Balayer la trame nationale à 1 km, ou la relire du cache.
 * @returns {Promise<{builtAt: string, cells: Array<{id: string, ind: number}>}>}
 */
async function loadFrame({ refresh = false } = {}) {
  if (!refresh && fs.existsSync(FRAME_PATH)) {
    const cached = JSON.parse(await fsp.readFile(FRAME_PATH, 'utf8'));
    say(`Trame relue du cache : ${cached.cells.length} carreaux de 1 km`
      + ` (${cached.builtAt}).`);
    return cached;
  }
  const cells = [];
  for (const { name, box } of FRAME_BOXES) {
    let start = 0;
    let matched = null;
    for (;;) {
      const params = new URLSearchParams({
        SERVICE: 'WFS',
        VERSION: '2.0.0',
        REQUEST: 'GetFeature',
        TYPENAMES: FRAME_TYPENAME,
        OUTPUTFORMAT: 'application/json',
        PROPERTYNAME: 'id_inspire,ind',
        COUNT: String(FRAME_PAGE),
        STARTINDEX: String(start),
        BBOX: `${box.west},${box.south},${box.east},${box.north},EPSG:4326`,
      });
      // eslint-disable-next-line no-await-in-loop -- pagination is sequential by nature.
      const payload = await getJson(`${WFS}?${params}`);
      const features = payload.features || [];
      if (matched === null) matched = Number(payload.numberMatched) || null;
      for (const feature of features) {
        const props = feature.properties || {};
        const ind = Number(props.ind);
        if (props.id_inspire && Number.isFinite(ind) && ind > 0) {
          cells.push({ id: String(props.id_inspire), ind });
        }
      }
      start += features.length;
      say(`  ${name.padEnd(12)} ${String(start).padStart(7)} / ${matched ?? '?'}`);
      if (!features.length || (matched !== null && start >= matched)) break;
      // eslint-disable-next-line no-await-in-loop -- deliberate pacing.
      await sleep(250);
    }
  }
  // Ordre stable : le tirage systématique dépend de l'ordre, et un ordre qui
  // change d'une exécution à l'autre rend la graine inutile.
  cells.sort((a, b) => (a.id < b.id ? -1 : 1));
  const frame = { builtAt: new Date().toISOString().slice(0, 10), cells };
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  await fsp.writeFile(FRAME_PATH, JSON.stringify(frame));
  return frame;
}

/**
 * Choisir la porte : un carreau de 200 m tiré dans le carreau de 1 km désigné.
 * @returns {Promise<{lon: number, lat: number, cell: object}|null>}
 */
async function drawDoor(kmCellId, random) {
  const parsed = parseCellId(kmCellId);
  if (!parsed || parsed.res !== 1000) return null;
  const corners = cellCorners(parsed);
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  const box = {
    west: Math.min(...lons), east: Math.max(...lons),
    south: Math.min(...lats), north: Math.max(...lats),
  };
  const payload = await tryJson(buildCarreauxUrl({ box, resolution: 200, count: 200 }));
  if (!payload) return null;
  const { cells } = projectCarreaux(payload, { resolution: 200, count: 200 });
  const inhabited = cells.filter((cell) => Number.isFinite(cell.ind) && cell.ind > 0);
  if (!inhabited.length) return null;
  const index = weightedPick(inhabited.map((cell) => ({ weight: cell.ind })), random);
  if (index < 0) return null;
  const cell = inhabited[index];
  const [lon, lat] = cellCentre({ res: 200, n: cell.n, e: cell.e, crs: cell.crs });
  return { lon, lat, cell };
}

/**
 * Mesurer un point exactement comme la fiche le mesure.
 * @returns {Promise<object>} Une observation, ou un refus nommé.
 */
async function measurePoint(base, lon, lat) {
  const isochrone = await tryJson(
    `${base}/api/isochrone?lat=${lat}&lon=${lon}&profile=foot&seconds=${RING_SECONDS}`,
  );
  const ring = isochrone?.rings?.[0] ?? null;
  if (!ring?.ring?.length) return { refused: 'isochrone' };

  const bounds = ringBounds(ring.ring);
  if (!bounds) return { refused: 'anneau' };
  const resolution = resolutionForBox(bounds);
  const carreaux = await tryJson(`${base}/api/filosofi/carreaux`
    + `?south=${(bounds.south - PAD_DEG).toFixed(5)}`
    + `&west=${(bounds.west - PAD_DEG).toFixed(5)}`
    + `&north=${(bounds.north + PAD_DEG).toFixed(5)}`
    + `&east=${(bounds.east + PAD_DEG).toFixed(5)}`
    + `&resolution=${resolution}`);
  if (!carreaux) return { refused: 'carroyage' };
  // Une page tronquée ne donne pas un plancher exploitable dans un quantile :
  // elle donne une valeur trop basse qu'aucun drapeau ne rattrapera une fois
  // l'échelle publiée. Elle est comptée comme un refus, pas comme une mesure.
  if (carreaux.truncated) return { refused: 'carroyage tronqué' };

  const demand = aggregateInRing(
    carreaux.cells || [],
    ring.holes?.length ? [ring.ring, ...ring.holes] : ring.ring,
    carreaux.resolution || resolution,
  );
  if (!demand || !(demand.people.count > 0)) return { refused: 'anneau vide' };

  const dvf = await tryJson(`${base}/api/dvf?lat=${lat}&lon=${lon}&radius=${DVF_RADIUS_M}`);

  return {
    lon,
    lat,
    resolution: demand.resolution,
    acces: ring.areaKm2 ?? null,
    habitants: demand.people.count,
    menages: demand.households.count,
    niveau: demand.niveau,
    pauvrete: demand.pauvrete,
    social: demand.social,
    jeunes: demand.jeunes,
    aines: demand.aines,
    solo: demand.solo,
    proprietaires: demand.proprietaires,
    prixM2: dvf?.summary?.medianPrixM2 ?? null,
    dvfSales: dvf?.summary?.count ?? 0,
  };
}

/** Les échelles, à partir des observations. */
function buildLadders(observations) {
  const bareme = {};
  for (const indicator of BAREME_INDICATORS) {
    const values = observations
      .map((row) => row[indicator.id])
      .filter((v) => Number.isFinite(v));
    bareme[indicator.id] = {
      geometry: indicator.geometry,
      unit: indicator.unit,
      measured: values.length,
      ladder: sampleQuantiles(values, BAREME_LADDER_Q)
        .map((value) => roundTo(value, indicator.round)),
    };
  }
  return bareme;
}

/**
 * L'écart entre l'échelle d'anneau et l'échelle de carreau, sur le MÊME
 * échantillon — le chiffre qui dit si ce lot valait sa peine.
 */
function carreauComparison(doors) {
  const keys = ['niveau', 'pauvrete', 'social', 'jeunes', 'aines', 'solo', 'proprietaires'];
  const out = {};
  for (const key of keys) {
    const indicator = BAREME_INDICATORS.find((entry) => entry.id === key);
    const values = doors.map((cell) => cell?.[key]).filter((v) => Number.isFinite(v));
    out[key] = sampleQuantiles(values, BAREME_LADDER_Q)
      .map((value) => roundTo(value, indicator?.round ?? 0.1));
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  const base = String(flag('--url', process.env.QA_BASE_URL || 'http://localhost:5199'))
    .replace(/\/+$/, '');
  const size = Number(flag('--sample', '300'));
  const seed = Number(flag('--seed', '20260908'));
  const asJson = argv.includes('--json');
  const from = flag('--from', null);

  let observations;
  let doors;
  let meta;

  if (from) {
    const saved = JSON.parse(await fsp.readFile(path.resolve(REPO_ROOT, from), 'utf8'));
    ({ observations, doors, meta } = saved);
    say(`Observations relues : ${observations.length} anneaux (${meta.measuredAt}).`);
    // Un point de reprise n'a vu que la moitié sud du pays — la trame est triée
    // par northing. Il se relit pour reprendre ou pour regarder, jamais pour
    // publier une échelle, et le script refuse d'en imprimer un bloc à coller.
    if (meta.partial) {
      say(`⚠ Fichier PARTIEL (${meta.partial} tirages sur la campagne, sud du pays`
        + ' seulement). Sortie limitée à --json.');
      if (!asJson) {
        process.exitCode = 1;
        return;
      }
    }
  } else {
    const frame = await loadFrame({ refresh: argv.includes('--frame') });
    const framePeople = frame.cells.reduce((sum, cell) => sum + cell.ind, 0);
    say(`Trame : ${frame.cells.length} carreaux habités de 1 km,`
      + ` ${Math.round(framePeople).toLocaleString('fr-FR')} habitants.`);
    if (argv.includes('--frame') && !argv.includes('--sample')) return;

    const random = mulberry32(seed);
    const picks = systematicPps(frame.cells.map((cell) => ({ weight: cell.ind })), size, random);
    say(`Tirage systématique : ${picks.length} habitants sur`
      + ` ${new Set(picks).size} carreaux de 1 km distincts.\n`);

    observations = [];
    doors = [];
    const refusals = {};
    let done = 0;
    for (const index of picks) {
      done += 1;
      const kmCell = frame.cells[index];
      // eslint-disable-next-line no-await-in-loop -- séquentiel exprès : voir l'en-tête.
      const door = await drawDoor(kmCell.id, random);
      if (!door) {
        refusals.porte = (refusals.porte || 0) + 1;
        // eslint-disable-next-line no-await-in-loop
        await sleep(250);
        continue;
      }
      doors.push(door.cell);
      // eslint-disable-next-line no-await-in-loop
      const observation = await measurePoint(base, door.lon, door.lat);
      if (observation.refused) {
        refusals[observation.refused] = (refusals[observation.refused] || 0) + 1;
      } else {
        observations.push(observation);
      }
      const label = observation.refused
        ? `refus (${observation.refused})`
        : `${observation.acces} km², ${observation.habitants} hab.`;
      say(`  ${String(done).padStart(4)}/${picks.length}`
        + ` ${door.lat.toFixed(4)},${door.lon.toFixed(4)}  ${label}`);
      // Point de reprise. Une campagne dure une demi-heure, et une demi-heure de
      // mesures perdue parce que le poste s'est endormi est autant de service
      // public gaspillé en plus du nôtre : le fichier est réécrit tous les
      // vingt-cinq points, et `--from` sait le relire.
      //
      // UN FICHIER PARTIEL N'EST PAS UN ÉCHANTILLON NATIONAL. La trame est
      // triée par `id_inspire`, donc par northing croissant : le tirage
      // remonte le pays du sud vers le nord — ce qui stratifie implicitement
      // l'échantillon COMPLET par latitude, et c'est la raison du tri — mais
      // une campagne arrêtée à mi-course n'a vu que la moitié sud. Le fichier
      // sert à reprendre, jamais à publier une échelle.
      if (done % 25 === 0) {
        // eslint-disable-next-line no-await-in-loop
        await fsp.mkdir(CACHE_DIR, { recursive: true });
        // eslint-disable-next-line no-await-in-loop
        await fsp.writeFile(OBSERVATIONS_PATH, JSON.stringify({
          meta: { measuredAt: new Date().toISOString().slice(0, 10), partial: done, refusals },
          observations,
          doors,
        }, null, 1));
      }
      // eslint-disable-next-line no-await-in-loop -- l'IGN publie 5 req/s sans SLA.
      await sleep(250);
    }
    meta = {
      measuredAt: new Date().toISOString().slice(0, 10),
      seconds: RING_SECONDS,
      dvfRadiusM: DVF_RADIUS_M,
      seed,
      drawn: picks.length,
      kmCells: new Set(picks).size,
      frameCells: frame.cells.length,
      framePeople: Math.round(framePeople),
      frameBuiltAt: frame.builtAt,
      refusals,
    };
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(OBSERVATIONS_PATH,
      JSON.stringify({ meta, observations, doors }, null, 1));
    say(`\nObservations écrites dans ${path.relative(REPO_ROOT, OBSERVATIONS_PATH)}.`);
  }

  const bareme = buildLadders(observations);
  const result = {
    ...meta,
    rings: observations.length,
    quantiles: BAREME_LADDER_Q,
    bareme,
    carreau: carreauComparison(doors || []),
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stderr.write('\n');
  process.stdout.write(`// Mesuré le ${result.measuredAt} sur ${result.rings} anneaux piétons`
    + ` de ${RING_SECONDS / 60} min, tirés à probabilité proportionnelle à la population\n`);
  process.stdout.write(`// sur ${result.frameCells.toLocaleString('fr-FR')} carreaux de 1 km`
    + ` (${result.framePeople.toLocaleString('fr-FR')} habitants).`
    + ` Refus : ${JSON.stringify(result.refusals)}\n`);
  for (const indicator of BAREME_INDICATORS) {
    const scale = bareme[indicator.id];
    process.stdout.write(`  ${indicator.id}: Object.freeze({ geometry: '${scale.geometry}',`
      + ` measured: ${scale.measured},\n    ladder: Object.freeze(${
        JSON.stringify(scale.ladder)}) }),\n`);
  }
  // Le bloc d'échantillon, prêt à coller lui aussi : la moitié des erreurs de
  // ce genre de lot vient d'une échelle recopiée avec la taille d'échantillon
  // de la campagne d'avant, et la marge de centile s'en déduit.
  process.stdout.write(`\n  measuredAt: '${result.measuredAt}',\n`
    + `  rings: ${result.rings},\n`
    + `  drawn: ${result.drawn},\n`
    + `  marginPt: ${roundTo(2 * Math.sqrt(0.25 / result.rings) * 100, 0.1)},\n`
    + `  frameCells: ${result.frameCells},\n`
    + `  framePeople: ${result.framePeople},\n`
    + `  frameBuiltAt: '${result.frameBuiltAt}',\n`
    + `  seconds: ${result.seconds},\n`
    + `  dvfRadiusM: ${result.dvfRadiusM},\n`
    + `  seed: ${result.seed},\n`
    + `  refusals: ${JSON.stringify(result.refusals)},\n`);
  process.stdout.write('\n// Les mêmes indicateurs au CARREAU de 200 m, même échantillon :\n');
  for (const [key, ladder] of Object.entries(result.carreau)) {
    process.stdout.write(`// ${key.padEnd(14)} ${JSON.stringify(ladder)}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
