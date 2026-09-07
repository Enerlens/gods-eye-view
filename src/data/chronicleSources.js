/**
 * @module chronicleSources
 * @description The five feeds this server records because nobody else does —
 * what each one publishes, what is folded, what is only kept, and why.
 *
 * This is the declaration, not the plumbing. `chronicle.js` holds the fold and
 * the retention arithmetic; `vite.config.js` holds the files and the wiring
 * that calls the recorder from inside each proxy. This file is what the status
 * endpoint, `DATA_SOURCES.md` and the tests all read, so that "which sources
 * are recorded, under what licence, at what cadence" has exactly one answer.
 *
 * ── The entry test: does anyone publish its past? ──────────────────────────
 *
 * A feed belongs here when its own publisher overwrites it and no third party
 * sells the history. That is deliberately a high bar, and it excludes most of
 * what this fork draws:
 *
 *   • Filosofi, DVF, DPE, Sitadel, the cadastre — archives already, by year or
 *     by semester. Recording them would duplicate a public file.
 *   • éCO2mix, RTE generation — RTE publishes its own multi-year history.
 *   • Météo-France SYNOP — the running-year archive is a published product.
 *   • Vélib' and Vélo'v — Lyon already publishes the Vélo'v availability
 *     history back to 2023-03-27 (`veloPulse.js` is built from it), and the
 *     Paris feed is ODbL, so an accumulated Vélib' base could not be closed
 *     even if it were worth building. It is left out on both counts.
 *   • OpenSky and adsb.lol — non-commercial and ODbL respectively, and
 *     Flightradar24 has sold that history for fifteen years.
 *
 * ── The licence line, which decides what may stay closed ──────────────────
 *
 * Four of the five are Licence Ouverte 2.0, which permits a proprietary
 * derivative against attribution alone. The fifth, AISStream, redistributes an
 * unencrypted public radio broadcast under no formal terms.
 *
 * GTFS-RT is the one that has to be read per feed: transport.data.gouv.fr's
 * catalogue declares Licence Ouverte 2.0 on most French realtime feeds and
 * ODbL 1.0 on a sizeable minority, and ODbL's share-alike reaches any derived
 * DATABASE that is publicly exposed — not just the map drawn from it. So the
 * recorder stores the declared licence WITH each transit series, and a profile
 * built on an ODbL feed is share-alike no matter what is built on top of it.
 * `licenceOf()` below is what a future export path must consult; it is not
 * decoration.
 */

/** Directory-and-URL token pattern every source id obeys. */
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{1,30}$/;

/**
 * The recorded feeds.
 *
 * `profile: false` is not a lesser status — it says the hour-of-week fold is
 * the WRONG shape for this phenomenon, and that the value of recording it is
 * the chronology alone. Only Vigicrues declares it, and the reason is in its
 * `why`.
 */
export const CHRONICLE_SOURCES = Object.freeze([
  Object.freeze({
    id: 'transit-fr',
    label: 'Transport public — GTFS-RT (PAN)',
    upstream: 'transport.data.gouv.fr — 151 flux GTFS-Realtime VehiclePositions + TripUpdates',
    licence: 'per-feed: Licence Ouverte 2.0 / ODbL 1.0 / Licence Ouverte 1.0',
    attribution: 'transport.data.gouv.fr + l’autorité organisatrice de chaque réseau',
    // Five minutes per series, not per tick: the server polls GTFS-RT per
    // VIEWPORT, so which feeds are refreshed depends on where an operator is
    // looking. Gating each feed on its own clock means a network recorded once
    // every five minutes whichever viewport happened to trigger the fetch.
    minIntervalMs: 5 * 60_000,
    retentionDays: 30,
    profile: true,
    axes: 'feed:<id>/vehicles (flotte publiée par le réseau), feed:<id>/onTimePct et feed:<id>/spoken ; aucune série nationale — la réponse est un viewport',
    why: 'Un VehiclePositions est écrasé toutes les ~30 s et aucun réseau ne publie sa ponctualité passée. '
      + 'La jointure horaires × temps réel existe déjà dans le serveur ; seule l’accumulation manque.',
    // Recorded ONLY where an operator has looked. The bias is real and the
    // status endpoint reports the per-series week count so a thin profile
    // reads as thin rather than as a quiet network.
    opportunistic: true,
  }),
  Object.freeze({
    id: 'irve-fr',
    label: 'Recharge électrique — statut dynamique (QualiCharge)',
    upstream: 'proxy.transport.data.gouv.fr/resource/qualicharge-irve-dynamique',
    licence: 'Licence Ouverte 2.0',
    attribution: 'QualiCharge — Direction générale de l’énergie et du climat, via transport.data.gouv.fr',
    minIntervalMs: 15 * 60_000,
    retentionDays: 30,
    profile: true,
    axes: 'fr/* national, puis op:<code>/occupePct par opérateur d’itinérance',
    why: 'Le fichier consolidé statique dit où sont les bornes ; celui-ci dit lesquelles sont libres, '
      + 'et il est remplacé à chaque publication. Personne ne conserve l’occupation passée.',
    opportunistic: false,
  }),
  Object.freeze({
    id: 'road-status-fr',
    label: 'Réseau routier national — DATEX II (Bison Futé)',
    upstream: 'tipi.bison-fute.gouv.fr — Traficolor par agglomération + QTV débit/vitesse national',
    licence: 'Licence Ouverte 2.0',
    attribution: 'Bison Futé — DGITM / Ministère chargé des transports',
    // The flow snapshot has a strict six-minute publication window; asking
    // faster records the same document twice.
    minIntervalMs: 6 * 60_000,
    retentionDays: 30,
    profile: true,
    axes: 'fr/* national, puis axis:<A7>/congestedPct et axis:<A7>/speedKph par axe nommé',
    why: 'Chaque répertoire d’agglomération ne contient que la publication courante ; la précédente est '
      + 'supprimée. Le débit QTV disparaît au bout de six minutes.',
    opportunistic: true,
  }),
  Object.freeze({
    id: 'ais-fr',
    label: 'Trafic maritime — boîte France (AISStream)',
    upstream: 'stream.aisstream.io — 41.0..51.6 N, -8.0..10.0 E',
    licence: 'aucune condition formelle ; l’AIS est une émission radio publique',
    attribution: 'AISStream.io (courtoisie)',
    minIntervalMs: 5 * 60_000,
    retentionDays: 30,
    profile: true,
    axes: 'fr/* national, puis cell:<lat>,<lon>/vessels par carré de 1° de la boîte France',
    why: 'Un socket ne se rejoue pas. MarineTraffic vend cet historique pour le monde ; personne ne le '
      + 'publie pour la façade française.',
    opportunistic: false,
  }),
  Object.freeze({
    id: 'vigicrues',
    label: 'Vigilance crues — tronçons surveillés',
    upstream: 'vigicrues.gouv.fr/services/InfoVigiCru.geojson',
    licence: 'Licence Ouverte 2.0',
    attribution: 'Vigicrues — SCHAPI, Ministère de la Transition écologique',
    minIntervalMs: 30 * 60_000,
    retentionDays: 30,
    // NO typical week, and this is the whole point of letting a source say so.
    // A flood answers to rainfall, not to Tuesday. Folding a vigilance level
    // into hour-of-week slots would manufacture a weekly seasonality that does
    // not exist and then score real episodes against it. What is worth having
    // here is the CHRONOLOGY — which reach went amber, when, and for how long —
    // so the raw ticks are kept and nothing is folded.
    profile: false,
    retention: 'chronologie seule',
    axes: 'fr/level2, fr/level3, fr/level4 en brut ; aucun profil hebdomadaire',
    why: 'Le bulletin est republié par-dessus le précédent deux fois par jour, et aucune archive publique '
      + 'ne dit quel tronçon était orange le 12 mars.',
    opportunistic: true,
  }),
]);

/** @type {Map<string, object>} */
const BY_ID = new Map(CHRONICLE_SOURCES.map((source) => [source.id, source]));

/** One declared source, or null. Never throws on an unknown id. */
export function chronicleSourceById(id) {
  return BY_ID.get(String(id || '')) || null;
}

/** Every declared source id, in declaration order. */
export function chronicleSourceIds() {
  return CHRONICLE_SOURCES.map((source) => source.id);
}

/**
 * Whether the registry itself is well formed.
 *
 * Exported because the test asserts it rather than re-listing the invariants:
 * an id that is not directory-safe becomes a path, and a source with no
 * licence becomes an export nobody can clear.
 */
export function chronicleRegistryFaults(sources = CHRONICLE_SOURCES) {
  const faults = [];
  const seen = new Set();
  for (const source of sources) {
    if (!SOURCE_ID.test(source?.id || '')) faults.push(`id not directory-safe: ${source?.id}`);
    if (seen.has(source?.id)) faults.push(`duplicate id: ${source.id}`);
    seen.add(source?.id);
    if (!source?.licence) faults.push(`${source?.id}: no licence declared`);
    if (!source?.attribution) faults.push(`${source?.id}: no attribution declared`);
    if (!source?.why) faults.push(`${source?.id}: no reason it has no public archive`);
    if (!Number.isFinite(source?.minIntervalMs) || source.minIntervalMs < 60_000) {
      faults.push(`${source?.id}: minIntervalMs must be at least a minute`);
    }
    if (!Number.isFinite(source?.retentionDays) || source.retentionDays < 1) {
      faults.push(`${source?.id}: retentionDays must be a positive number of days`);
    }
    if (typeof source?.profile !== 'boolean') faults.push(`${source?.id}: profile must be declared true or false`);
  }
  return faults;
}
