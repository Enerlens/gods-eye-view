/**
 * @module data/portDirectory
 *
 * **Ce que le navire dit, et le port que c'est.**
 *
 * AIS message 5 carries a twenty-character `destination` field the master types
 * by hand. This repository has drawn it verbatim on the vessel card since the
 * layer landed — `→ BEANR`, `→ IT GOA`, `→ HARBOUR TOWAGE` — and drawn 2 951
 * World Port Index harbours a row below it, and never once joined the two.
 * That is the whole content of this module: resolve the field to a port in the
 * pack the app already ships, or refuse.
 *
 * ── WHAT THE FIELD ACTUALLY LOOKS LIKE ──────────────────────────────────────
 *
 * Measured 2026-09-09 over **2 250 distinct vessels** with a non-empty
 * destination, harvested from twelve consecutive `/api/ais-live` snapshots of
 * the live subscription and resolved against the 2 951 harbours in the pack:
 *
 *   resolved by UN/LOCODE          523   23.2 %
 *   resolved by port name          614   27.3 %
 *   unresolved                   1 113   49.5 %
 *
 * So **1 137 of 2 250 (50.5 %)** named a harbour the app already draws, and
 * this module wrote down what the other half was. Two families of it were
 * rattrapable, and both needed the same thing: a NAME TABLE WITH A SOURCE.
 * `scripts/build-port-gazetteer.mjs` now builds one, and the census moves —
 * measured the same afternoon over 1 924 vessels with
 * `npm run qa:vessel-destinations`, **50.4 % → 68.9 %**:
 *
 *   · **inland river ports**, which the World Port Index is not an index of —
 *     `MAINZ`, `PARIS`, `FRANKFURT`, `NEUSS`, `KARLSRUHE`, `DUISBURG`, `KÖLN`,
 *     `MAASTRICHT`. UN/LOCODE codes those as ports (function `1`) exactly like
 *     sea harbours, so the gazetteer carries 11 545 of them and this is the
 *     family it mostly closes;
 *   · **exonyms** — `ANTWERP` against `Antwerpen`, `GENOA` against `Genova`,
 *     `GENT` against `Ghent`. UN/LOCODE's own alias list and GeoNames'
 *     `alternatenames` supply 13 657 spellings, joined to a harbour by NAME
 *     AND PROXIMITY at build time. Still no edit distance anywhere;
 *   · **orders and states**, not places at all: `HARBOUR TOWAGE` 13,
 *     `FOR ORDERS`, `CRUISING`, `FISHING`. Not rattrapable, and not a defect;
 *   · **berths and blanks** — `QUAI 5`, `-`, `??`.
 *
 * What stays out, measured on the same sample: places UN/LOCODE does not code
 * as ports at all (`GOLFE JUAN` and `LA NAPOULE` are Riviera marinas, coded
 * `--3-----`, road terminals), and `ERLENBACH` — six barges on the Main mean
 * Erlenbach am Main, and the only Erlenbach UN/LOCODE codes as a port is in
 * Switzerland, 280 km away. That one is refused by the ceiling below rather
 * than answered wrongly.
 *
 * ── THE SHAPES IT READS, AND WHY THERE IS NO FUZZY ONE ──────────────────────
 *
 * 1. **A UN/LOCODE**, `BEANR` or `IT GOA` — the WPI's own `unlocode` column,
 *    which ships in the pack with a space in it (`IS STR`). Both spellings are
 *    live in the field: 37 vessels wrote `BEANR` and 22 wrote `IT GOA` in the
 *    same hour, so the index is keyed on the SPACELESS form and both reach it.
 * 2. **A LEG**, `DOVER<=>CALAIS` or `NOMON => TRALI`. The destination is the
 *    LAST segment; taking the first would send the card to the port the ship
 *    has already left. Also `TO ROTTERDAM` and `FOR ANTWERPEN`.
 * 3. **A PORT NAME**, `ANTWERPEN`, `LE HAVRE`, `GENOVA`, on a folded key —
 *    accents stripped, punctuation dropped, spaces collapsed — because
 *    `ST. NAZAIRE` and `SAINT-NAZAIRE` are one harbour typed two ways.
 * 4. **A NAME PLUS A BERTH**, cut off by the field's own twenty-character
 *    ceiling: `ANTWERPEN 4E HAVENDO`, `VLISSINGEN BUITENHAV`. The leading
 *    tokens are tried longest-first, and a token that names a KIND of place
 *    rather than a place (`PORT`, `TERMINAL`, `QUAI`) is never tried alone.
 *
 * There is deliberately **no fuzzy fifth**. An edit-distance match would turn
 * `GENOA` into `GENOVA` (right) and `PARIS` into `PARIS ISLAND` (wrong, and
 * 5 500 km wrong), and a vessel card is not the place to guess. Everything the
 * four rules do not resolve is printed exactly as the master typed it.
 *
 * Pure: no fetch, no DOM, no Cesium. The index is built once from the ports
 * pack the local-GeoJSON layer already parses, and published through
 * `layerJoins.js` so the vessel card can read it without importing the layer.
 */

/**
 * The Latin letters Unicode normalisation cannot take apart.
 *
 * `NFD` turns `Ê` into `E` plus a combining circumflex, and that is most of
 * the job. It does NOT touch a letter whose diacritic is part of its shape —
 * `ø`, `æ`, `ß`, `ð`, `þ`, `ł`, `đ`, `ı` — so `København` was folding to
 * `K BENHAVN` and could never meet a master typing `KOBENHAVN`. Measured on
 * the shipped packs: the World Port Index is ASCII throughout and unaffected,
 * and **174 gazetteer names** were folding to a key with a hole in it, almost
 * all of them Danish and Norwegian.
 *
 * These are transliterations, which is a different thing from a similarity
 * rule: `ø` IS `o` in every ASCII rendering of the name, and the folding is
 * applied to BOTH sides of the comparison, so it can only make two spellings
 * of one name meet — never two different names.
 */
const LETTER_FOLDINGS = Object.freeze([
  [/[ØøƟ]/g, 'O'], [/[Ææ]/g, 'AE'], [/[Œœ]/g, 'OE'], [/ß/g, 'SS'],
  [/[Ðð]/g, 'D'], [/[Þþ]/g, 'TH'], [/[Łł]/g, 'L'], [/[Đđ]/g, 'D'],
  [/[Ħħ]/g, 'H'], [/[Ŧŧ]/g, 'T'], [/[ıİ]/g, 'I'], [/[Ə]/g, 'E'],
]);

/**
 * Fold a string to the key both sides of the join are compared on.
 *
 * Diacritics out (`GÊNES` and `GENES`), the letters normalisation cannot
 * decompose transliterated ({@link LETTER_FOLDINGS}), punctuation out
 * (`ST. NAZAIRE` and `ST NAZAIRE`), runs of space collapsed, upper-cased. It
 * is deliberately NOT a similarity function: two strings either fold to the
 * same key or they do not.
 *
 * @param {unknown} value
 * @returns {string} Folded key, `''` when there is nothing to fold.
 */
export function foldPortKey(value) {
  if (typeof value !== 'string') return '';
  let folded = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  for (const [pattern, replacement] of LETTER_FOLDINGS) folded = folded.replace(pattern, replacement);
  return folded.replace(/[^A-Z0-9]+/g, ' ').trim();
}

/**
 * The strings a destination field is worth testing, most specific first.
 *
 * A LEG (`FRLEH>NLRTM`) yields its last segment; a prefixed one (`TO ANTWERP`)
 * yields the tail. The whole field is kept as a candidate too, because
 * `ST. PETERSBURG` contains no separator and must not be split.
 *
 * @param {unknown} destination Raw AIS `destination`.
 * @returns {string[]} Candidate strings, already folded, without duplicates.
 */
export function destinationCandidates(destination) {
  const folded = foldPortKey(destination);
  if (!folded) return [];
  const out = [];
  const push = (value) => {
    const key = foldPortKey(value);
    if (key && key.length >= 3 && !out.includes(key)) out.push(key);
  };
  // The arrows and dashes are already spaces after folding, so the leg split
  // reads the ORIGINAL string. `-` is not split on: `PORT-VENDRES` is one
  // harbour and `FRLEH-NLRTM` is two, and the second is rescued by the locode
  // branch below rather than by a rule that would break the first.
  const raw = String(destination);
  const legs = raw.split(/=?>+|→/).map((part) => part.trim()).filter(Boolean);
  if (legs.length > 1) push(legs[legs.length - 1]);
  push(folded.replace(/^(?:TO|FOR|DEST|DESTINATION)\s+/, ''));
  push(folded);
  // A BERTH INSIDE A PORT, and the field's own 20-character ceiling cutting it
  // off: `ANTWERPEN 4E HAVENDO`, `VLISSINGEN BUITENHAV`, `KARLSRUHE  MIRO`.
  // The leading tokens are tried longest-first, so a harbour whose real name
  // has two words is found before its first word is.
  // `out` can be empty here: a two-character field folds to nothing the
  // `push` guard will accept, and there is no prefix to take from nothing.
  const tokens = (out[out.length - 1] || '').split(' ');
  for (let take = tokens.length - 1; take >= 1; take -= 1) {
    const head = tokens.slice(0, take).join(' ');
    // A generic head is not a harbour. `PORT ELIZABETH BERTH 3` must not
    // resolve to whatever the register happens to file under `PORT`.
    if (head.length < 4 || GENERIC_HEAD_TOKENS.has(head)) continue;
    push(head);
  }
  return out;
}

/**
 * Leading tokens that name a KIND of place, never a place.
 *
 * Checked before a berth prefix is accepted as a harbour name — the rule above
 * is a prefix match, and without this `PORT ELIZABETH BERTH 3` would ask the
 * register for a harbour called `PORT`.
 */
const GENERIC_HEAD_TOKENS = new Set([
  'PORT', 'PORTS', 'PORTO', 'PUERTO', 'HAVEN', 'RADE', 'BAIE', 'BAHIA',
  'TERMINAL', 'ANCHORAGE', 'ROADS', 'BERTH', 'QUAI', 'DOCK', 'HARBOUR',
  'HARBOR', 'MARINA', 'CANAL', 'RIVER', 'ISLE', 'SAINT', 'SANTA',
]);

/** A UN/LOCODE is two country letters then three letters or digits. */
const LOCODE_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}$/;

/**
 * How far a NAME match may be from the ship, in metres. A code is exempt.
 *
 * A UN/LOCODE is the master's own identifier and is trusted at any range —
 * measured, the longest legitimate one in the sample is 9 131 km. A NAME is a
 * spelling that happened to agree, and past a certain range the agreement is
 * more likely a coincidence than an intention.
 *
 * 2 500 km, and the number is measured rather than chosen. Over the same 2 250
 * vessels, name matches sort into two clean groups with nothing between them:
 * **16 legitimate matches from 301 km to 1 348 km** (Marseille, Antwerpen,
 * Rotterdam, Bordeaux, Dublin, Cadiz, Algeciras, Oristano…), then a gap, then
 * **18 wrong ones from 5 006 km up** — six ships in the Channel writing
 * `PORTLAND` and six writing `PORTSMOUTH`, resolved to Oregon and to New
 * Hampshire because the WPI does not carry the English harbours of those
 * names, plus `HOBOKEN KRUIBEKEN` on the Scheldt resolved to New Jersey.
 *
 * The ceiling drops 18 of 632 name matches (2.8 %) and every one of them is
 * wrong. A refused match is not a blank card: the raw field is printed exactly
 * as the master typed it, which is what the card did before this module.
 */
export const PORT_NAME_MATCH_MAX_M = 2_500_000;

/**
 * How far a name match against the GAZETTEER may be. Much tighter, and why.
 *
 * The 2 500 km above was measured on the World Port Index: 2 951 major
 * harbours, where two of them sharing a name is rare enough that agreement at
 * range is usually intention. The gazetteer is a different kind of table —
 * 11 545 UN/LOCODE port locations, four times as many, and their names are
 * ordinary place names. `Stein`, `Beaulieu`, `Workum`: agreement at range is
 * usually coincidence.
 *
 * 500 km, and it is measured on the same 1 924-vessel sample, which splits as
 * cleanly as the WPI one did: **268 gazetteer name matches from 0 to 415 km,
 * every one of them plausible** — barge traffic is far from its destination
 * because rivers are long (`AMSTERDAM` at 415 km from a ship off Brighton,
 * `HERSTAL` at 359 km from the Channel, `MARSEILLE` at 299 km from Genoa) —
 * then a gap, then **9 matches from 622 km up and every one of them wrong**:
 * four ships in the Westerschelde writing `FLUSHING` resolved to Flushing,
 * Cornwall; three at Beaulieu-sur-Mer writing `BEAULIEU` resolved to Beaulieu,
 * Hampshire; one at Antibes writing `WORKUM`; one at Rouen writing `BUDAPEST`.
 * (The four `FLUSHING` are now answered correctly by the alias table, which is
 * where an exonym belongs — the ceiling is what catches the rest.)
 *
 * A refused match is not a blank card: the raw field is printed exactly as the
 * master typed it, which is what the card did before any of this existed.
 */
export const PORT_GAZETTEER_NAME_MATCH_MAX_M = 500_000;

/**
 * Generic heads the WPI puts on a harbour's name, and a master never does.
 *
 * The pack calls Le Havre `Port Of Le Havre`, Rouen `Port Of Rouen` and Brest
 * `Rade De Brest`; the field says `LE HAVRE`, `ROUEN`, `BREST`. This is a rule
 * about the REGISTER'S OWN naming convention, not a similarity score — the
 * stripped form is indexed ALONGSIDE the published one, never instead of it,
 * and a stripped form that collides with a real harbour name loses to it.
 *
 * Counted on the shipped pack: 322 of 2 951 names carry one of these heads.
 */
const GENERIC_NAME_HEADS = Object.freeze([
  'PORT OF', 'PORT DE', 'PORT DES', 'PORT DU', 'PORTO DI', 'PORTO DE',
  'PUERTO DE', 'PUERTO DEL', 'RADE DE', 'BAIE DE', 'GOLFE DE', 'HAVEN VAN',
  'BAHIA DE', 'BAIA DE', 'RIA DE',
]);

/** The keys one harbour answers to: its published name, then the stripped one. */
function portNameKeys(name) {
  const folded = foldPortKey(name);
  if (!folded) return [];
  const keys = [folded];
  for (const head of GENERIC_NAME_HEADS) {
    if (!folded.startsWith(`${head} `)) continue;
    const tail = folded.slice(head.length + 1).trim();
    if (tail.length >= 3 && !keys.includes(tail)) keys.push(tail);
    break;
  }
  return keys;
}

/**
 * Build the lookup from the World Port Index features the pack ships.
 *
 * Two maps, and the locode one wins at read time: a code is unambiguous by
 * construction, and a NAME is not — the WPI lists two `Southampton`s (GB SOU
 * and CA SON) and two `Portsmouth`s. A contested name therefore maps to a
 * LIST, and the tie is broken at read time by distance from the ship: a
 * vessel in the Channel writing `SOUTHAMPTON` does not mean Ontario. With no
 * position to measure from, a contested name is refused outright and the card
 * prints the raw field, which is what it did before this module existed.
 *
 * THE GAZETTEER MERGES INTO THE SAME TWO MAPS, and losing to the WPI where
 * they overlap. A code the WPI already carries is kept as the WPI's, because
 * that row is the one on the map and it is the richer of the two. A NAME is
 * appended to the bucket rather than replacing it, which is what lets six
 * ships in the Channel writing `PORTLAND` find Portland, Dorset — a gazetteer
 * row — while the WPI's Portland, Oregon stays in the same bucket and simply
 * loses the distance test.
 *
 * @param {ReadonlyArray<object>} features GeoJSON features from the ports pack.
 * @param {?{ports?: Array, aliases?: Array}} [gazetteer] Parsed
 *   `local_data/ports/gazetteer.json`. Absent is ordinary: the index is then
 *   exactly what it was before the gazetteer existed.
 * @returns {{byLocode: Map<string, object>, byName: Map<string, object[]>,
 *   ports: number, contestedNames: number, gazetteerPorts: number,
 *   aliases: number}}
 */
export function buildPortIndex(features, gazetteer = null) {
  const byLocode = new Map();
  const byName = new Map();
  let ports = 0;
  for (const feature of Array.isArray(features) ? features : []) {
    const properties = feature?.properties;
    const coordinates = feature?.geometry?.coordinates;
    if (!properties || !Array.isArray(coordinates)) continue;
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const entry = Object.freeze({
      name: String(properties.name || '').trim(),
      country: String(properties.country || '').trim(),
      countryCode: String(properties.countryCode || '').trim(),
      unlocode: String(properties.unlocode || '').trim(),
      harborSize: String(properties.harborSize || '').trim(),
      lat,
      lon,
    });
    ports += 1;
    const locode = foldPortKey(entry.unlocode).replace(/ /g, '');
    if (LOCODE_PATTERN.test(locode) && !byLocode.has(locode)) byLocode.set(locode, entry);
    for (const key of portNameKeys(entry.name)) {
      const bucket = byName.get(key);
      if (bucket) bucket.push(entry);
      else byName.set(key, [entry]);
    }
  }
  let gazetteerPorts = 0;
  for (const row of Array.isArray(gazetteer?.ports) ? gazetteer.ports : []) {
    const [code, name, lat, lon] = Array.isArray(row) ? row : [];
    if (typeof code !== 'string' || typeof name !== 'string') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const locode = foldPortKey(code).replace(/ /g, '');
    if (!LOCODE_PATTERN.test(locode)) continue;
    const entry = Object.freeze({
      name, country: '', countryCode: locode.slice(0, 2), unlocode: locode,
      harborSize: '', lat, lon,
      // The flag the distance test reads. It travels on the entry rather than
      // being looked up, because a bucket can hold both kinds and each has to
      // be judged against its own ceiling.
      gazetteer: true,
    });
    gazetteerPorts += 1;
    if (!byLocode.has(locode)) byLocode.set(locode, entry);
    const key = foldPortKey(name);
    if (!key) continue;
    const bucket = byName.get(key);
    if (bucket) bucket.push(entry);
    else byName.set(key, [entry]);
  }
  // Aliases LAST, so a spelling can point at a WPI harbour or at a gazetteer
  // row indifferently. One that points at neither is dropped here rather than
  // shipped as a dangling key — the pack and the build can drift.
  let aliases = 0;
  for (const row of Array.isArray(gazetteer?.aliases) ? gazetteer.aliases : []) {
    const [key, code] = Array.isArray(row) ? row : [];
    if (typeof key !== 'string' || typeof code !== 'string' || key.length < 3) continue;
    const port = byLocode.get(foldPortKey(code).replace(/ /g, ''));
    if (!port) continue;
    aliases += 1;
    const bucket = byName.get(key);
    if (!bucket) byName.set(key, [port]);
    else if (!bucket.includes(port)) bucket.push(port);
  }
  let contestedNames = 0;
  for (const bucket of byName.values()) if (bucket.length > 1) contestedNames += 1;
  return { byLocode, byName, ports, contestedNames, gazetteerPorts, aliases };
}

/**
 * Resolve one AIS destination against the index.
 *
 * @param {unknown} destination Raw AIS `destination` field.
 * @param {{byLocode: Map, byName: Map}} index From {@link buildPortIndex}.
 * @returns {?{port: object, how: 'locode'|'name', matched: string}} The harbour
 *   and HOW it was found, or null. `how` travels because the card says it: a
 *   code is the master's own identifier and a name is a spelling that happened
 *   to agree, and a reader is owed the difference.
 */
export function matchDestinationToPort(destination, index, from = {}) {
  if (!index?.byLocode || !index?.byName) return null;
  const lat = Number(from?.lat);
  const lon = Number(from?.lon);
  const positioned = Number.isFinite(lat) && Number.isFinite(lon);
  for (const candidate of destinationCandidates(destination)) {
    const locode = candidate.replace(/ /g, '');
    if (LOCODE_PATTERN.test(locode)) {
      const port = index.byLocode.get(locode);
      if (port) return { port, how: 'locode', matched: locode };
    }
    const bucket = index.byName.get(candidate);
    if (!bucket?.length) continue;
    // ONE harbour and no ship: the name is taken at its word, because there is
    // nothing to check it against and nothing to confuse it with.
    if (bucket.length === 1 && !positioned) {
      return { port: bucket[0], how: 'name', matched: candidate };
    }
    // With a ship, the nearest ADMISSIBLE one wins. Each candidate is judged
    // against its OWN ceiling and only then compared — a bucket holding a
    // gazetteer row at 600 km and a WPI harbour at 2 000 km must answer with
    // the harbour, because the gazetteer row is over its ceiling and the
    // harbour is not. Sorting first and testing after would answer `null`.
    if (!positioned) continue;
    let best = null;
    let bestM = Infinity;
    for (const port of bucket) {
      const metres = portDistanceM(lat, lon, port.lat, port.lon);
      const ceiling = port.gazetteer ? PORT_GAZETTEER_NAME_MATCH_MAX_M : PORT_NAME_MATCH_MAX_M;
      if (metres > ceiling || metres >= bestM) continue;
      bestM = metres;
      best = port;
    }
    if (!best) continue;
    return {
      port: best,
      how: 'name',
      matched: candidate,
      ...(bucket.length > 1 ? { contested: bucket.length } : {}),
    };
  }
  return null;
}

/**
 * Great-circle metres between two coordinates.
 *
 * Local to this module rather than imported: every other copy in the repository
 * lives beside a layer that owns a scene, and this one has to run under
 * `node --test` with nothing loaded.
 *
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number} Metres, `Infinity` when any argument is not a number.
 */
export function portDistanceM(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((value) => Number.isFinite(value))) return Infinity;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The line a vessel card prints for a resolved destination.
 *
 * `→ ANTWERPEN` becomes `→ Antwerpen · BEANR · 84 km`, and an unresolved field
 * keeps the raw string exactly as it was. The distance is from the SHIP, so it
 * is the one number the join adds that neither side had alone.
 *
 * @param {?{port: object, how: string}} match From {@link matchDestinationToPort}.
 * @param {{lat?: number, lon?: number}} [from] The vessel's own position.
 * @returns {?string} The line, or null when nothing was resolved.
 */
export function destinationPortLine(match, from = {}) {
  const port = match?.port;
  if (!port) return null;
  const parts = [port.name || port.unlocode];
  if (port.unlocode && match.how === 'name') parts.push(port.unlocode.replace(/ /g, ''));
  const metres = portDistanceM(Number(from.lat), Number(from.lon), port.lat, port.lon);
  if (Number.isFinite(metres)) {
    parts.push(metres >= 10_000
      ? `${Math.round(metres / 1000)} km`
      : `${Math.round(metres / 100) / 10} km`);
  }
  return `→ ${parts.join(' · ')}`;
}
