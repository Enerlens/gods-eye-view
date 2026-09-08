/**
 * @module data/adresseRadiographie
 *
 * **La radiographie d'adresse** — one point in, ten themes out.
 *
 * This is the scene Cityscan was built around and the one thing this fork had
 * all the material for and none of the shape. `docs/CITYSCAN.md` measured it:
 * eight of their ten themes were already served by routes in production, the
 * remaining two landed as `/api/arcep-fr` and `/api/emploi-fr`, and what was
 * missing was never data — it was *une adresse, un barème et une fiche*.
 *
 * This module is the fiche. The barème is deliberately NOT here; see below.
 *
 * ── WHERE IT GRADES, AND WHERE IT REFUSES TO ────────────────────────────────
 * Cityscan grades every theme out of 100 and stamps a letter A→E on it. A
 * letter is a claim about a NATIONAL DISTRIBUTION, and since 2026-09-08 this
 * repository has one: `baremeNational.js` carries eleven measured scales, from
 * a national draw of 1 200 residents.
 *
 * **It covers two of this sheet's numbers and refuses the rest, on purpose.**
 * A scale is keyed on the GEOMETRY it was measured on, and it will not rank a
 * value measured on another shape — the trap that module exists to make
 * impossible. Of everything below:
 *
 *   - the **ten-minute walking area** is measured on exactly the ring the
 *     scale was drawn from (`RING_FOOT_600`), so it carries a national
 *     percentile and a letter;
 *   - the **median price per m²** is measured on the same 300 m disc
 *     (`DISC_300`), so it carries a percentile — and never a letter, because
 *     a high price is good news for a seller and bad news for a buyer;
 *   - every neighbourhood figure here is averaged over a RECTANGLE of INSEE
 *     carreaux, not over a walking ring, so the scale refuses it and the sheet
 *     prints the refusal. The globe's `Fiche implantation` measures the same
 *     indicators on the ring and does carry their ranks.
 *
 * Nothing else has a scale at all. A reader is told "3 crèches à 400 m",
 * "fibre chez 94,5 % des locaux", "indice ATMO 2 sur 6, tiré par l'ozone" —
 * values, without a letter, because no letter has been earned for them.
 *
 * ── The ten themes, and where each one's number comes from ──────────────────
 * Every route below already existed or was added for this fiche, every one is
 * cached server-side, and every one may fail on its own without taking the
 * page with it — a theme with no answer says so and the other nine stand.
 *
 *   Immobilier   `/api/dvf` · `/api/loyers-fr` · `/api/dpe`
 *   Transport    `/api/isochrone` (marche 5/10/15 min, voiture 15 min)
 *   Éducation    `/api/schools-fr/sites` — with the DEPP's IPS on each school
 *   Commodités   `/api/amenities-fr/sites` — BPE + FINESS
 *   Nuisances    `/api/atmo-fr`
 *   Risques      `/api/georisques`
 *   Numérique    `/api/arcep-fr`
 *   Emploi       `/api/emploi-fr`
 *   Urbanisme    `/api/gpu` · `/api/ads-fr`
 *   Voisinage    `/api/filosofi/carreaux`
 *
 * ── The one place this fiche goes further than the product it copies ────────
 * Cityscan's Éducation theme counts schools. This one names them and prints
 * each one's **indice de position sociale** beside the national figure, because
 * `ipsFeed.js` already joined the DEPP's file to the ministry's register on the
 * UAI. Counting schools describes a catchment; the IPS describes what is
 * actually on offer inside it, and the two are not the same address.
 *
 * ── Every theme carries its own silence ─────────────────────────────────────
 * A theme is `ok`, `partial` or `absent`, and the reasons are printed rather
 * than smoothed over: an air index borrowed from a neighbouring zone, a rent
 * computed for a mesh of communes rather than for this one, an unemployment
 * rate withheld because the commune has fewer than a hundred active residents.
 * The teardown's whole argument was that Cityscan's ten scores hide exactly
 * these; a copy that hid them too would not be worth building.
 *
 * Dependency-free and side-effect-free apart from the injected `fetch`: URL
 * construction and projection only. Runs in the browser and under `node --test`.
 */

import { AMENITY_FAMILY_LABELS, AMENITY_FAMILY_PLURALS } from './amenitiesFamilies.js';
import {
  BAREME_GEOMETRIES,
  BAREME_REASONS,
  BAREME_SAMPLE,
  scoreIndicator,
} from './baremeNational.js';

/** Read from the barème rather than retyped, so the two cannot drift apart. */
const BAREME_REASONS_GEOMETRY = BAREME_REASONS.GEOMETRY;

/** How far around the point each bounded question looks. */
export const RADIOGRAPHIE_RADIUS = Object.freeze({
  /** DVF's own scan radius, kept identical so the two views cannot disagree. */
  sales: 300,
  /** Diagnostics: dense enough at 200 m to describe a street. */
  dpe: 200,
  /** The statutory état des risques is a commune-and-address answer anyway. */
  risks: 500,
  /** Permits: the block, not the quarter. */
  permits: 500,
  /** Half a kilometre of box for the point registers — schools, équipements. */
  boxDeg: 0.006,
});

/** Walking budgets the catchment is written in, plus the driving one. */
export const RADIOGRAPHIE_WALK_STEPS = Object.freeze([300, 600, 900]);
export const RADIOGRAPHIE_DRIVE_SECONDS = 900;

/** How many named items a theme may list before it says "and N more". */
export const RADIOGRAPHIE_LIST_CAP = 6;

/**
 * The ten themes, in the order Cityscan itself lists them.
 *
 * `question` is the sentence the theme answers, printed on the sheet: a header
 * that says only "Numérique" leaves the reader to guess whether the number
 * below is coverage, speed or price.
 */
export const RADIOGRAPHIE_THEMES = Object.freeze([
  Object.freeze({ id: 'immobilier', label: 'Immobilier', question: 'Ce que le terrain vaut, et ce qu’il coûte à louer.' }),
  Object.freeze({ id: 'transport', label: 'Transport', question: 'Ce qu’on atteint depuis cette porte, à pied et en voiture.' }),
  Object.freeze({ id: 'education', label: 'Éducation', question: 'Quelles écoles, et lesquelles.' }),
  Object.freeze({ id: 'commodites', label: 'Commodités', question: 'Les commerces et services du quotidien à portée de marche.' }),
  Object.freeze({ id: 'nuisances', label: 'Nuisances', question: 'L’air qu’on y respire aujourd’hui.' }),
  Object.freeze({ id: 'risques', label: 'Risques', question: 'Ce que l’État a inscrit au registre pour ce point.' }),
  Object.freeze({ id: 'numerique', label: 'Numérique', question: 'Ce qu’une ligne fixe peut porter ici.' }),
  Object.freeze({ id: 'emploi', label: 'Emploi', question: 'L’activité des habitants, et son sens de marche.' }),
  Object.freeze({ id: 'urbanisme', label: 'Urbanisme', question: 'Ce qui peut être bâti, et ce qui l’est déjà.' }),
  Object.freeze({ id: 'voisinage', label: 'Voisinage', question: 'Qui habite autour, d’après le carroyage INSEE.' }),
]);

const _fr = new Intl.NumberFormat('fr-FR');

/**
 * Minutes, as a reader says them.
 *
 * `implantationFiche.js` exports the same three lines, and this page does NOT
 * import them from there: that module imports Cesium, and pulling a 3D engine
 * into a printable text sheet to format "10 min" is not a trade worth making.
 * Duplication of an expression this small, with the reason written down, beats
 * a dependency that size.
 *
 * @param {number} seconds @returns {string}
 */
export function minutesLabel(seconds) {
  return Number.isFinite(seconds) ? `${Math.round(seconds / 60)} min` : '—';
}

/** A whole number, French-spaced, or the em dash. */
export function count(value) {
  return Number.isFinite(value) ? _fr.format(Math.round(value)) : '—';
}

/** A decimal with a French comma, at the given precision. */
export function decimal(value, digits = 1) {
  return Number.isFinite(value)
    ? _fr.format(Math.round(value * 10 ** digits) / 10 ** digits)
    : '—';
}

/** A percentage, one decimal at most, with its sign kept. */
function percent(value, digits = 1) {
  return Number.isFinite(value) ? `${decimal(value, digits)} %` : '—';
}

/** Great-circle metres between two points. */
export function metresBetween(a, b) {
  if (!Number.isFinite(a?.lat) || !Number.isFinite(b?.lat)) return null;
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

/**
 * A label written for mid-sentence use, promoted to a row heading.
 *
 * The pollutant names come from `atmoFeed.js`, where they are written to be
 * read inside a sentence — "tiré par ozone". Printed as a row label beside
 * "Indice ATMO du jour" they were the only lower-case headings on the sheet.
 * @param {string} label @returns {string}
 */
function asHeading(label) {
  const text = String(label ?? '');
  return text ? text[0].toLocaleUpperCase('fr-FR') + text.slice(1) : text;
}

/** A distance as a reader says it. */
export function distanceLabel(metres) {
  if (!Number.isFinite(metres)) return '—';
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${decimal(metres / 1000, 1)} km`;
}

/**
 * The bounding box a point-register question is asked over.
 * @param {{lat: number, lon: number}} point
 * @param {number} [padDeg]
 */
export function scanBox({ lat, lon }, padDeg = RADIOGRAPHIE_RADIUS.boxDeg) {
  return {
    south: lat - padDeg,
    west: lon - padDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180)),
    north: lat + padDeg,
    east: lon + padDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180)),
  };
}

/**
 * Every request the fiche makes, as `{key, url}`.
 *
 * Named keys rather than positional results, so a route added or removed does
 * not silently shift every theme's input by one.
 *
 * @param {{lat: number, lon: number}} point
 * @returns {Array<{key: string, url: string}>}
 */
export function radiographieRequests({ lat, lon }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const box = scanBox({ lat, lon });
  const bbox = `south=${box.south.toFixed(5)}&west=${box.west.toFixed(5)}`
    + `&north=${box.north.toFixed(5)}&east=${box.east.toFixed(5)}`;
  const at = `lat=${lat}&lon=${lon}`;
  return [
    { key: 'address', url: `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}&limit=1` },
    { key: 'dvf', url: `/api/dvf?${at}&radius=${RADIOGRAPHIE_RADIUS.sales}` },
    { key: 'loyers', url: `/api/loyers-fr?${at}` },
    { key: 'dpe', url: `/api/dpe?${at}&radius=${RADIOGRAPHIE_RADIUS.dpe}` },
    { key: 'walk', url: `/api/isochrone?${at}&profile=foot&seconds=${RADIOGRAPHIE_WALK_STEPS.join(',')}` },
    { key: 'drive', url: `/api/isochrone?${at}&profile=car&seconds=${RADIOGRAPHIE_DRIVE_SECONDS}` },
    { key: 'schools', url: `/api/schools-fr/sites?${bbox}` },
    { key: 'amenities', url: `/api/amenities-fr/sites?${bbox}` },
    { key: 'atmo', url: `/api/atmo-fr?${at}` },
    { key: 'risques', url: `/api/georisques?${at}&radius=${RADIOGRAPHIE_RADIUS.risks}` },
    { key: 'arcep', url: `/api/arcep-fr?${at}` },
    { key: 'emploi', url: `/api/emploi-fr?${at}` },
    { key: 'gpu', url: `/api/gpu?${at}` },
    { key: 'permis', url: `/api/ads-fr?${at}&radius=${RADIOGRAPHIE_RADIUS.permits}&months=36` },
    { key: 'carroyage', url: `/api/filosofi/carreaux?${bbox}&resolution=200` },
  ];
}

/**
 * Fetch every part, tolerating any of them failing.
 *
 * Resolves to a map of key → payload, with `null` for anything that did not
 * answer. Never throws: a page that renders nine themes because the tenth
 * upstream is down is the whole design.
 *
 * @param {{lat: number, lon: number}} point
 * @param {{fetchImpl?: typeof fetch, signal?: AbortSignal}} [seams]
 * @returns {Promise<Object<string, ?object>>}
 */
export async function fetchRadiographieParts(point, { fetchImpl = fetch, signal = null } = {}) {
  const requests = radiographieRequests(point);
  const settled = await Promise.all(requests.map(async ({ key, url }) => {
    try {
      const response = await fetchImpl(url, signal ? { signal } : undefined);
      if (!response?.ok) return [key, null];
      const payload = await response.json();
      if (!payload || payload.error) return [key, null];
      return [key, payload];
    } catch {
      return [key, null];
    }
  }));
  return Object.fromEntries(settled);
}

/**
 * The national rank of one value, as the row a reader can read.
 *
 * `scoreIndicator` never throws and never returns null: an indicator it could
 * not place comes back with a NAMED reason, and printing that reason is half
 * the product — "échelle mesurée sur une autre géométrie" and "aucune échelle"
 * are different facts and a reader deserves the second sentence rather than a
 * dash.
 *
 * @param {string} id Indicator id in `baremeNational.js`.
 * @param {?number} value
 * @param {string} geometry The shape THIS sheet measured on. Passing it is what
 *   makes a wrong ranking impossible; omitting it earns a refusal, by design.
 * @param {string} label Row heading.
 * @returns {?object} A printable row, or null when there is nothing to say.
 */
function rankRow(id, value, geometry, label) {
  const score = scoreIndicator(id, value, { geometry });
  if (score.reason && score.percentile === null) {
    // Only worth a row when the refusal teaches something. "No scale at all"
    // for an indicator nobody expected to be graded is noise.
    if (score.reason !== BAREME_REASONS_GEOMETRY) return null;
    return line(label, 'non classé', score.reason);
  }
  if (score.percentile === null) return null;
  const bracket = `${score.percentileLow}ᵉ à ${score.percentileHigh}ᵉ centile`;
  // The letter only when both ends of the bracket land in one band; otherwise
  // the honest answer is two letters, which is what `scoreIndicator` says.
  const letter = score.letter
    ? `note ${score.letter}`
    : (score.letterHigh && score.letterLow ? `note ${score.letterHigh} ou ${score.letterLow}` : null);
  const head = [bracket, letter].filter(Boolean).join(' — ');
  // The direction note is a SENTENCE and the bracket is a figure; chaining both
  // on em dashes read as one run-on. It is printed only where there is no
  // letter, which is exactly where a reader needs to be told why.
  const note = score.direction ? head : `${head}. ${score.directionNote}`;
  return line(label, `${score.percentile}ᵉ centile national`, note);
}

/** Shorthand for one printed row. */
function line(label, value, note = null) {
  return note ? { label, value, note } : { label, value };
}

/** Immobilier — sales, rents, diagnostics. */
function projectImmobilier({ dvf, loyers, dpe }) {
  const lines = [];
  const notes = [];
  const summary = dvf?.summary ?? null;
  if (summary) {
    lines.push(line(
      `Prix médian dans ${RADIOGRAPHIE_RADIUS.sales} m`,
      summary.medianPrixM2 === null ? '—' : `${count(summary.medianPrixM2)} €/m²`,
      `${count(summary.comparableCount)} ventes comparables sur ${count(summary.count)} mutations`,
    ));
    if (Number.isFinite(summary.p25PrixM2) && Number.isFinite(summary.p75PrixM2)) {
      lines.push(line('Moitié centrale des ventes',
        `${count(summary.p25PrixM2)} à ${count(summary.p75PrixM2)} €/m²`,
        'premier et troisième quartiles — la moitié des ventes tient dans cet écart'));
    }
    // The 300 m radius above is `RADIOGRAPHIE_RADIUS.sales`, kept identical to
    // DVF's own — and identical to the disc the national scale was measured on,
    // which is what lets this one line carry a rank at all.
    const priceRank = rankRow('prixM2', summary.medianPrixM2, BAREME_GEOMETRIES.DISC_300,
      'Ce prix dans le pays');
    if (priceRank) lines.push(priceRank);
    const reference = summary.reference ?? null;
    if (reference?.medianPrixM2) {
      lines.push(line(`Référence ${reference.name || reference.code || ''}`.trim(),
        `${count(reference.medianPrixM2)} €/m²`,
        `${count(reference.comparableCount)} ventes comparables`));
    }
  } else {
    notes.push('DVF n’a pas répondu — aucun prix de vente sur ce point.');
  }

  if (loyers?.segments?.length) {
    for (const segment of loyers.segments) {
      lines.push(line(
        // The published label verbatim: lower-casing it turned « T1-T2 » into
        // « t1-t2 », which is not a thing the ministry publishes.
        `Loyer — ${segment.label}`,
        `${decimal(segment.eurM2, 2)} €/m²`,
        `${decimal(segment.low, 2)} à ${decimal(segment.high, 2)} €/m² — `
        + `environ ${count(segment.monthlyEur)} €/mois pour ${segment.surfaceM2} m², ${segment.basisLabel}`,
      ));
    }
    notes.push('Loyers charges comprises, non meublé : c’est une prédiction du modèle du ministère '
      + 'pour un bien-type, pas un loyer médian observé.');
    if (loyers.borrowedSegments > 0) {
      notes.push(`${loyers.borrowedSegments} des ${loyers.segments.length} loyers ont été calculés `
        + 'pour une maille de communes voisines, pas pour cette commune.');
    }
  } else {
    notes.push('Carte des loyers muette pour cette commune.');
  }

  if (dpe && Number.isFinite(dpe.total)) {
    const distribution = dpe.distribution || {};
    const served = Object.values(distribution).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const best = Object.entries(distribution)
      .filter(([, value]) => Number(value) > 0)
      .map(([label, value]) => `${label} ${value}`)
      .join(', ');
    lines.push(line(`Diagnostics dans ${RADIOGRAPHIE_RADIUS.dpe} m`, count(dpe.total),
      served ? `${best} — répartition sur les ${count(served)} diagnostics lus` : null));
    if (Number.isFinite(dpe.medianCoutAnnuel)) {
      lines.push(line('Coût énergétique annuel médian', `${count(dpe.medianCoutAnnuel)} €`,
        'tous usages, tel que le DPE l’estime pour le logement diagnostiqué'));
    }
    // Never averaged into a street grade: a DPE describes one dwelling.
    notes.push('Les étiquettes ne sont pas moyennées : un DPE décrit une enveloppe, '
      + 'et la moyenne des lettres d’une rue n’est pas une propriété de la rue.');
  }
  return { lines, notes };
}

/** Transport — what the door actually reaches. */
function projectTransport({ walk, drive }) {
  const lines = [];
  const notes = [];
  for (const ring of walk?.rings || []) {
    lines.push(line(`${minutesLabel(ring.seconds)} à pied`,
      `${decimal(ring.areaKm2, 2)} km²`,
      'surface réellement atteignable par la voirie, pas un cercle'));
    // ONLY the ten-minute ring, and only because the national scale was drawn
    // on exactly that shape. Ranking the five- or fifteen-minute ring against
    // it would give a plausible letter and a false one — the whole reason
    // `baremeNational.js` keys its scales on a geometry.
    if (ring.seconds === 600) {
      const rank = rankRow('acces', ring.areaKm2, BAREME_GEOMETRIES.RING_FOOT_600,
        'Cet accès à pied dans le pays');
      if (rank) lines.push(rank);
    }
  }
  const driveRing = drive?.rings?.[0] ?? null;
  if (driveRing) {
    lines.push(line(`${minutesLabel(driveRing.seconds)} en voiture`,
      `${decimal(driveRing.areaKm2, 1)} km²`,
      'hors trafic — l’isochrone IGN est calculée sur la voirie, pas sur le temps réel'));
  }
  if (!lines.length) notes.push('Le service isochrone IGN n’a pas répondu.');
  else {
    notes.push('Les réseaux de transport en commun ne sont pas encore comptés ici : '
      + 'la couche Transit FR les dessine en direct sur le globe.');
    notes.push('Seul l’anneau de dix minutes est situé dans le pays : le barème national '
      + 'a été mesuré sur cette forme-là, et une valeur ne se classe que dans une '
      + 'distribution mesurée sur la même géométrie.');
  }
  return { lines, notes };
}

/** Éducation — the schools, and the index Cityscan does not print. */
function projectEducation({ schools, point }) {
  const lines = [];
  const notes = [];
  const sites = Array.isArray(schools?.sites) ? schools.sites : [];
  if (!schools) {
    notes.push('L’annuaire de l’éducation n’a pas répondu.');
    return { lines, notes };
  }
  const ranked = sites
    .map((site) => ({ site, distance: metresBetween(point, { lat: site.lat, lon: site.lon }) }))
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((a, b) => a.distance - b.distance);
  const byLevel = new Map();
  for (const { site } of ranked) {
    const level = site.level || 'autre';
    byLevel.set(level, (byLevel.get(level) || 0) + 1);
  }
  lines.push(line('Établissements dans la boîte de scan', count(ranked.length),
    [...byLevel.entries()].map(([level, n]) => `${level} ${n}`).join(', ') || null));

  let withIndex = 0;
  for (const { site, distance } of ranked.slice(0, RADIOGRAPHIE_LIST_CAP)) {
    const ips = site.ips ?? null;
    const value = ips && ips.status === 'ok' && Number.isFinite(ips.value) ? ips.value : null;
    if (value !== null) withIndex += 1;
    // Never read as average. `ipsFeed.js` measures that roughly one school in
    // three that COULD carry an index does not, and a blank is not a middling
    // score. The sector is prefixed only when the register published one:
    // joining an empty string with an em dash produced rows opening on a dash.
    const index = value === null
      ? 'IPS non publié'
      : `IPS ${decimal(value, 1)}`
        + (Number.isFinite(ips.national) ? ` contre ${decimal(ips.national, 1)} en France` : '');
    lines.push(line(site.name || site.uai || 'Établissement',
      distanceLabel(distance),
      site.sector ? `${site.sector} — ${index}` : index));
  }
  if (ranked.length > RADIOGRAPHIE_LIST_CAP) {
    lines.push(line('…', `${count(ranked.length - RADIOGRAPHIE_LIST_CAP)} autres établissements`));
  }
  if (ranked.length) {
    notes.push(`IPS publié pour ${withIndex} des ${Math.min(ranked.length, RADIOGRAPHIE_LIST_CAP)} `
      + 'établissements les plus proches — un IPS absent n’est jamais lu comme une moyenne.');
  }
  return { lines, notes };
}

/** Commodités — the everyday registers, by family and by distance. */
function projectCommodites({ amenities, point }) {
  const lines = [];
  const notes = [];
  if (!amenities) {
    notes.push('Le pack national BPE / FINESS n’a pas répondu.');
    return { lines, notes };
  }
  const sites = Array.isArray(amenities.sites) ? amenities.sites : [];
  const nearest = new Map();
  const tally = new Map();
  for (const site of sites) {
    const { family } = site;
    const lat = Number(site.lat);
    const lon = Number(site.lon);
    if (!family || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // `count` is how many establishments the fold put on this one coordinate:
    // three GPs in one surgery are one dot and three médecins, and a card that
    // counted dots would under-report the dense half of every city.
    tally.set(family, (tally.get(family) || 0) + (Number(site.count) || 1));
    const distance = metresBetween(point, { lat, lon });
    const held = nearest.get(family);
    if (!held || distance < held.distance) nearest.set(family, { distance, site });
  }
  lines.push(line('Équipements dans la boîte de scan', count(amenities.rows ?? sites.length),
    amenities.capped
      ? `${count(amenities.capped)} points au-delà du plafond de la réponse`
      : `${count(amenities.dots ?? sites.length)} points distincts`));
  for (const [family, entry] of [...nearest.entries()].sort((a, b) => a[1].distance - b[1].distance)) {
    const nearestName = entry.site.names?.[0] || entry.site.kinds?.[0] || 'sans nom';
    const total = tally.get(family);
    // "1 commerces alimentaires" is the reason this is not a template string:
    // the plural head-word is the only one the vocabulary carries, and a rural
    // scan finds exactly one of most families.
    const many = total === 1
      ? 'un seul dans la boîte'
      : `${count(total)} ${AMENITY_FAMILY_PLURALS[family] || family} dans la boîte`;
    lines.push(line(AMENITY_FAMILY_LABELS[family] || family, distanceLabel(entry.distance),
      `${many} — le plus proche : ${nearestName}`));
  }
  if (!nearest.size) notes.push('Aucun équipement de ces familles dans la boîte de scan.');
  notes.push('La BPE ne publie ni bar ni café ni musée, et ses écoles sont écartées '
    + 'au profit du registre du ministère — voir le thème Éducation.');
  return { lines, notes };
}

/** Nuisances — today's air. */
function projectNuisances({ atmo }) {
  const lines = [];
  const notes = [];
  if (!atmo || atmo.uncovered) {
    notes.push('Aucune AASQA ne publie d’indice pour cette commune ni autour d’elle.');
    return { lines, notes };
  }
  lines.push(line('Indice ATMO du jour',
    `${atmo.quality} sur 6 — ${atmo.band?.label ?? '—'}`,
    atmo.driving?.length ? `tiré par : ${atmo.driving.join(', ')}` : null));
  for (const pollutant of atmo.pollutants || []) {
    if (!Number.isFinite(pollutant.quality)) continue;
    lines.push(line(asHeading(pollutant.label), `${pollutant.quality} — ${pollutant.band?.label ?? '—'}`));
  }
  for (const day of atmo.forecast || []) {
    lines.push(line(`Prévision ${day.date}`, `${day.quality} — ${day.band?.label ?? '—'}`));
  }
  if (atmo.borrowed && atmo.zone) {
    notes.push(`Indice publié pour ${atmo.zone.name || atmo.zone.code} `
      + `(${atmo.zone.scale === 'epci' ? 'intercommunalité' : 'commune voisine'})`
      + (Number.isFinite(atmo.zone.distanceM) ? `, à ${distanceLabel(atmo.zone.distanceM)}` : '')
      + ' — pas pour cette commune.');
  }
  if (atmo.agency) notes.push(`Publié par ${atmo.agency}.`);
  notes.push('L’indice global est le MAXIMUM des cinq sous-indices, pas leur moyenne.');
  return { lines, notes };
}

/** Risques — the statutory register, commune verdict and address verdict apart. */
function projectRisques({ risques }) {
  const lines = [];
  const notes = [];
  if (!risques) {
    notes.push('Géorisques n’a pas répondu.');
    return { lines, notes };
  }
  // THE ROUTE ANSWERS EVEN WHEN THE REGISTER DID NOT. Géorisques fans out to
  // three upstream endpoints and reports which of them replied; measured live
  // on 2026-09-08, the risk REPORT failed while the ICPE list and the radon
  // lookup succeeded — the documented ECONNRESET on roughly one call in four.
  // The payload then carries `naturalRisks: []`, and a card that printed
  // "0 risques inscrits" would be publishing the most consequential false
  // negative this whole fiche can produce. Silence is named instead.
  const available = risques.available || {};
  const reported = available.report !== false;
  const families = [
    ...(risques.naturalRisks || []).map((risk) => ({ ...risk, kind: 'naturel' })),
    ...(risques.technologicalRisks || []).map((risk) => ({ ...risk, kind: 'technologique' })),
  ];
  const present = families.filter((risk) => risk.present);
  if (!reported || !families.length) {
    lines.push(line('Risques inscrits pour ce point', 'non lus',
      'le rapport Géorisques n’a pas répondu — ce n’est pas « aucun risque »'));
    notes.push('L’état des risques n’a pas pu être lu pour ce point. '
      + 'Les installations classées et le potentiel radon ci-dessous viennent '
      + 'de deux autres appels, qui ont répondu.');
  } else {
    lines.push(line('Risques inscrits pour ce point', count(present.length),
      `sur ${count(families.length)} familles interrogées dans ${RADIOGRAPHIE_RADIUS.risks} m`));
  }
  for (const risk of present) {
    // The disagreement is read from the two verdicts themselves, not from the
    // `variesByAddress` flag, which is the source's statement about variation
    // WITHIN the radius. A commune classed "Risque Existant - important" for
    // clay shrinkage above a point classed "Risque non Connu" is a
    // disagreement whatever that flag says.
    lines.push(line(risk.label, risk.addressVerdict || risk.communeVerdict || '—',
      risk.communeVerdict && risk.addressVerdict && risk.communeVerdict !== risk.addressVerdict
        ? `la commune est classée « ${risk.communeVerdict} » — les deux verdicts diffèrent`
        : null));
  }
  if (risques.radon?.label) {
    // Named apart from the `radon` risk family above, which answers a verdict:
    // two rows both titled "Radon" saying different things read as a bug.
    lines.push(line('Potentiel radon de la commune', risques.radon.label,
      Number.isFinite(risques.radon.class) ? `classe ${risques.radon.class} sur 3` : null));
  }
  if (Number.isFinite(risques.icpeTotal)) {
    lines.push(line('Installations classées', count(risques.icpeTotal),
      risques.icpeTruncated ? 'liste tronquée par la source' : `dans ${RADIOGRAPHIE_RADIUS.risks} m`));
  }
  if (reported && families.length) {
    notes.push('Le registre publie un verdict pour la commune et un pour l’adresse ; '
      + 'ils ne disent pas toujours la même chose, et c’est celui de l’adresse qui est affiché.');
  }
  return { lines, notes };
}

/** Numérique — the fixed line. */
function projectNumerique({ arcep }) {
  const lines = [];
  const notes = [];
  if (!arcep) {
    notes.push('Ma connexion internet n’a pas répondu.');
    return { lines, notes };
  }
  lines.push(line('Locaux dans la commune', count(arcep.premises),
    arcep.edition ? `édition ${arcep.edition}` : null));
  for (const technology of arcep.technologies || []) {
    lines.push(line(asHeading(technology.label), percent(technology.percent),
      `${count(technology.premises)} locaux`));
  }
  const gigabit = (arcep.speeds || []).find((speed) => speed.key === 'gigabit');
  if (gigabit) {
    lines.push(line('Éligibles à 1 Gbit/s (filaire)', percent(gigabit.percent),
      `${count(gigabit.premises)} locaux`));
  }
  if (arcep.wiredIneligible && arcep.wiredIneligible.premises > 0) {
    lines.push(line('Sans offre haut débit filaire', count(arcep.wiredIneligible.premises),
      percent(arcep.wiredIneligible.percent)));
  }
  if (arcep.copper) {
    lines.push(line('Encore raccordables au cuivre', percent(arcep.copper.percent),
      arcep.copper.premises === 0 ? 'le cuivre est déjà fermé ici' : `${count(arcep.copper.premises)} locaux`));
  }
  notes.push('Débits filaires uniquement. Le fichier par défaut de l’ARCEP compte le satellite '
    + 'et répond 100 % à la même question.');
  if (arcep.commune?.folded) {
    notes.push('L’ARCEP ne publie pas les arrondissements : ces parts décrivent la commune entière.');
  }
  return { lines, notes };
}

/** Emploi — the census, and its direction of travel. */
function projectEmploi({ emploi }) {
  const lines = [];
  const notes = [];
  if (!emploi) {
    notes.push('L’API Melodi n’a pas répondu.');
    return { lines, notes };
  }
  if (emploi.outOfScope) {
    notes.push('Le recensement publie ce jeu de données pour la France hors Mayotte.');
    return { lines, notes };
  }
  const current = emploi.current;
  if (!current) {
    notes.push('Aucune observation du recensement pour cette commune.');
    return { lines, notes };
  }
  lines.push(line(`Population de 15 à 64 ans (${current.year})`, count(current.population)));
  if (current.unemploymentRate === null) {
    lines.push(line('Taux de chômage', 'non publié', current.ratesWithheld));
  } else {
    lines.push(line('Taux de chômage', percent(current.unemploymentRate),
      `${count(current.unemployed)} chômeurs sur ${count(current.active)} actifs`));
    lines.push(line('Taux d’activité', percent(current.activityRate)));
    lines.push(line('Taux d’emploi', percent(current.employmentRate)));
  }
  if (Number.isFinite(emploi.trend)) {
    const sense = emploi.trend > 0 ? 'en hausse' : (emploi.trend < 0 ? 'en baisse' : 'stable');
    lines.push(line('Depuis le recensement précédent',
      `${emploi.trend > 0 ? '+' : ''}${decimal(emploi.trend, 1)} point`,
      `chômage ${sense}`));
  }
  for (const year of emploi.series || []) {
    if (year.year === current.year) continue;
    lines.push(line(`Recensement ${year.year}`,
      year.unemploymentRate === null ? 'non publié' : percent(year.unemploymentRate)));
  }
  notes.push('Chômage au sens du recensement, à la résidence — pas le taux du BIT.');
  return { lines, notes };
}

/** Urbanisme — the zoning and the live permits. */
function projectUrbanisme({ gpu, permis }) {
  const lines = [];
  const notes = [];
  if (gpu) {
    const zones = Array.isArray(gpu.zones) ? gpu.zones : [];
    const atPoint = zones.filter((zone) => zone.atPoint);
    const shown = atPoint.length ? atPoint : zones.slice(0, 1);
    for (const zone of shown) {
      lines.push(line('Zonage PLU', zone.code || '—', zone.label || zone.typezone || null));
    }
    if (!shown.length) lines.push(line('Zonage PLU', 'aucun zonage à ce point'));
    if (Number.isFinite(gpu.zonesAtPoint) && gpu.zonesAtPoint > 1) {
      notes.push(`${gpu.zonesAtPoint} zonages se superposent à ce point — `
        + 'deux communes ne placent pas leur limite au même endroit.');
    }
    const servitudes = Array.isArray(gpu.servitudes) ? gpu.servitudes : [];
    if (servitudes.length) {
      lines.push(line('Servitudes d’utilité publique', count(servitudes.length)));
    }
  } else {
    notes.push('Le Géoportail de l’urbanisme n’a pas répondu.');
  }
  if (permis?.summary) {
    const summary = permis.summary;
    lines.push(line(`Autorisations dans ${RADIOGRAPHIE_RADIUS.permits} m`,
      count(summary.count),
      'déposées sur les 36 derniers mois'));
    const kinds = Object.entries(summary.byKind || {})
      .filter(([, value]) => Number(value) > 0)
      .map(([kind, value]) => `${kind} ${value}`)
      .join(', ');
    if (kinds) lines.push(line('Par nature', kinds, 'PC permis de construire, DP déclaration préalable, PA aménager, PD démolir'));
    if (Number.isFinite(summary.housing) && summary.housing > 0) {
      lines.push(line('Logements autorisés', count(summary.housing), 'sur ces mêmes dossiers'));
    }
    if (Number.isFinite(summary.underInstruction) && summary.underInstruction > 0) {
      lines.push(line('Encore en instruction', count(summary.underInstruction)));
    }
    if (Number.isFinite(permis.unplacedInCommune) && permis.unplacedInCommune > 0) {
      notes.push(`${count(permis.unplacedInCommune)} autorisations de la commune n’ont pas pu être `
        + 'positionnées faute de référence cadastrale résolue : elles ne sont ni dessinées ni comptées ici.');
    }
  }
  return { lines, notes };
}

/** Voisinage — the 200 m grid. */
function projectVoisinage({ carroyage }) {
  const lines = [];
  const notes = [];
  const cells = Array.isArray(carroyage?.cells) ? carroyage.cells : [];
  if (!carroyage) {
    notes.push('Le carroyage INSEE n’a pas répondu.');
    return { lines, notes };
  }
  if (!cells.length) {
    notes.push('Aucun carreau habité dans la boîte de scan.');
    return { lines, notes };
  }
  // THE ANSWER IS WIDER THAN THE QUESTION, and the label has to say so. The
  // carroyage route snaps a requested box out to a 0,01° grid before querying,
  // so a 1,8 km² scan box came back with 105 carreaux — 4,2 km² of ground.
  // Calling that "the scan box" would attribute a quarter's population to a
  // block. The covered area is computed from the cells themselves, which is
  // the only figure that is true whatever the route snaps to.
  const resolution = Number(carroyage.resolution) || 200;
  const areaKm2 = (cells.length * resolution * resolution) / 1e6;
  const extent = `${count(cells.length)} carreaux de ${resolution} m, soit ${decimal(areaKm2, 1)} km²`;
  // The route publishes its own fold; recomputing it here would be a second
  // opinion nobody asked for, and the two would drift.
  const summary = carroyage.summary ?? null;
  const sum = (key) => cells.reduce((total, cell) => total + (Number(cell[key]) || 0), 0);
  const weighted = (key) => {
    let numerator = 0;
    let denominator = 0;
    for (const cell of cells) {
      const value = Number(cell[key]);
      const weight = Number(cell.ind);
      if (!Number.isFinite(value) || !Number.isFinite(weight)) continue;
      numerator += value * weight;
      denominator += weight;
    }
    return denominator > 0 ? numerator / denominator : null;
  };
  lines.push(line('Habitants', count(summary?.people ?? sum('ind')), extent));
  lines.push(line('Ménages', count(summary?.households ?? sum('men'))));
  const niveau = summary?.niveau ?? weighted('niveau');
  if (Number.isFinite(niveau)) {
    lines.push(line('Niveau de vie moyen', `${count(niveau)} €/an`, 'pondéré par la population du carreau'));
  }
  const pauvrete = summary?.pauvrete ?? weighted('pauvrete');
  if (Number.isFinite(pauvrete)) lines.push(line('Ménages pauvres', percent(pauvrete)));
  const solo = weighted('solo');
  if (solo !== null) lines.push(line('Personnes seules', percent(solo)));
  const aines = weighted('aines');
  if (aines !== null) lines.push(line('65 ans et plus', percent(aines)));
  const jeunes = weighted('jeunes');
  if (jeunes !== null) lines.push(line('Moins de 18 ans', percent(jeunes)));
  const imputed = Number.isFinite(summary?.imputedCells)
    ? summary.imputedCells
    : cells.filter((cell) => Number(cell.est) === 1).length;
  if (imputed > 0) {
    notes.push(`${count(imputed)} des ${count(cells.length)} carreaux portent des valeurs imputées `
      + 'par l’INSEE — approchées, pas observées.');
  }
  if (carroyage.truncated) {
    notes.push('Le carroyage a renvoyé une page tronquée : ces totaux sont des planchers.');
  }
  notes.push('Ce sont des carreaux autour du point, pas une zone de chalandise : '
    + 'la fiche implantation du globe calcule la même chose sur l’isochrone réelle.');
  // The refusal, said where it applies. The barème has scales for every one of
  // these indicators — but measured on a ten-minute walking ring, and a
  // rectangle of carreaux is not that shape. Printing a rank here would be the
  // exact failure `baremeNational.js` was built to make impossible.
  notes.push('Aucun de ces chiffres n’est situé dans le pays : le barème national les '
    + 'mesure sur l’anneau piéton de dix minutes, pas sur un rectangle de carreaux. '
    + 'C’est la fiche implantation du globe qui en porte les rangs.');
  return { lines, notes };
}

/** theme id → projector. */
const PROJECTORS = Object.freeze({
  immobilier: projectImmobilier,
  transport: projectTransport,
  education: projectEducation,
  commodites: projectCommodites,
  nuisances: projectNuisances,
  risques: projectRisques,
  numerique: projectNumerique,
  emploi: projectEmploi,
  urbanisme: projectUrbanisme,
  voisinage: projectVoisinage,
});

/** Which fetched parts each theme depends on, for the status verdict. */
const THEME_PARTS = Object.freeze({
  immobilier: ['dvf', 'loyers', 'dpe'],
  transport: ['walk', 'drive'],
  education: ['schools'],
  commodites: ['amenities'],
  nuisances: ['atmo'],
  risques: ['risques'],
  numerique: ['arcep'],
  emploi: ['emploi'],
  urbanisme: ['gpu', 'permis'],
  voisinage: ['carroyage'],
});

/**
 * The address line, from the BAN's own reverse answer.
 * @param {?object} feature
 */
export function projectRadiographieAddress(feature) {
  const properties = feature?.features?.[0]?.properties ?? feature?.properties ?? null;
  if (!properties) return null;
  return {
    label: properties.label || null,
    street: properties.name || null,
    postcode: properties.postcode || null,
    commune: properties.city || null,
    code: properties.citycode || null,
    // Published by the BAN and printed, because a point 180 m from the nearest
    // known address is not the same claim as one at the door.
    distanceM: Number.isFinite(properties.distance) ? Math.round(properties.distance) : null,
  };
}

/**
 * Compose the sheet.
 *
 * @param {object} options
 * @param {{lat: number, lon: number}} options.point
 * @param {Object<string, ?object>} options.parts Output of `fetchRadiographieParts`.
 * @param {number} [options.at] Wall clock; injected in tests.
 * @returns {object}
 */
export function composeRadiographie({ point, parts = {}, at = Date.now() }) {
  const themes = RADIOGRAPHIE_THEMES.map((theme) => {
    const projected = PROJECTORS[theme.id]({ ...parts, point });
    const needed = THEME_PARTS[theme.id];
    const answered = needed.filter((key) => parts[key]).length;
    // `absent` means NOTHING answered. A theme with lines but a silent second
    // source is `partial`, and the note says which — the two must not look the
    // same, because one is a fact about the address and the other about a
    // server.
    const status = answered === 0 ? 'absent' : (answered === needed.length ? 'ok' : 'partial');
    return {
      ...theme,
      status,
      silent: needed.filter((key) => !parts[key]),
      lines: projected.lines,
      notes: projected.notes,
    };
  });
  return {
    point,
    address: projectRadiographieAddress(parts.address),
    themes,
    generatedAt: at,
    // Counted rather than asserted, so the sheet's own header can say how much
    // of itself answered.
    answered: themes.filter((theme) => theme.status === 'ok').length,
    partial: themes.filter((theme) => theme.status === 'partial').length,
    absent: themes.filter((theme) => theme.status === 'absent').map((theme) => theme.id),
    // What the sheet may and may not grade, carried on the payload so no
    // renderer can forget it and no reader has to guess.
    grading: {
      source: 'baremeNational.js',
      measuredAt: BAREME_SAMPLE.measuredAt,
      rings: BAREME_SAMPLE.rings,
      marginPt: BAREME_SAMPLE.marginPt,
      ranked: ['acces', 'prixM2'],
    },
    gradingNote: `Deux chiffres sont situés dans le pays — la surface atteignable à pied `
      + `en dix minutes et le prix médian au m² — contre un barème tiré sur `
      + `${count(BAREME_SAMPLE.rings)} résidents (±${decimal(BAREME_SAMPLE.marginPt, 1)} `
      + `points de centile). Tout le reste est donné en valeur : une note exige une `
      + `distribution nationale mesurée sur la même géométrie, et il n’en existe pas `
      + `encore pour ces indicateurs-là.`,
  };
}
