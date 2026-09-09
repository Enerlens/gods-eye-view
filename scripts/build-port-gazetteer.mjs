#!/usr/bin/env node
/**
 * Build src/data/local_data/ports/gazetteer.json — the places an AIS
 * destination names that the World Port Index is not an index of.
 *
 * WHAT THIS IS FOR, IN ONE MEASUREMENT
 * ------------------------------------
 * `portDirectory.js` resolves the twenty-character `destination` field a
 * master types by hand against the 2 951 harbours the app already draws.
 * Measured over 2 250 distinct vessels on 2026-09-09, that reached **50.5 %**,
 * and the module wrote down what the other half was. Two families of it were
 * rattrapable and both needed a NAME TABLE WITH A SOURCE, which is exactly
 * what this script builds:
 *
 *   · **inland river ports** — `MAINZ`, `PARIS`, `FRANKFURT`, `NEUSS`,
 *     `KARLSRUHE`, `DUISBURG`, `KÖLN`, `MAASTRICHT`. The WPI is an index of
 *     SEA harbours; the Rhine and the Seine carry a large share of this feed.
 *   · **exonyms** — `ANTWERP` against `Antwerpen`, `GENOA` against `Genova`,
 *     `GENT` against `Ghent`. `portDirectory.js` refused to invent these, and
 *     was right to: an edit-distance rule that turns `GENOA` into `GENOVA`
 *     also turns `PARIS` into `PARIS ISLAND`, 5 500 km away.
 *
 * THREE SOURCES, AND WHAT EACH ONE IS ALLOWED TO SAY
 * --------------------------------------------------
 * 1. **UN/LOCODE** (UNECE), via the Frictionless mirror `datasets/un-locode`,
 *    licence **ODC-PDDL-1.0** (public domain dedication). This decides WHAT IS
 *    A PORT: an entry whose function code carries `1` in the first position is
 *    a port in UN/LOCODE's own coding, and river ports carry it exactly like
 *    sea ones. 17 596 entries qualify. Nothing here decides for itself that a
 *    place is a port — that judgement is the source's.
 * 2. **UN/LOCODE's own alias list** (`alias.csv`, same licence). 52 rows of
 *    the form `Antwerp = Antwerpen`. Small, and it is the exonym table that
 *    exists rather than one this repository made up.
 * 3. **GeoNames** `cities15000.txt`, licence **CC BY 4.0** (attribution
 *    required, and carried in DATA_SOURCES.md and on the layer's credit). It
 *    is used for exactly TWO things, both of which COMPLETE a row UN/LOCODE
 *    already selected — it never adds a place:
 *      a. **a coordinate for a port that publishes none.** 5 767 of the
 *         17 596 UN/LOCODE ports have an empty `Coordinates` column, and they
 *         are not obscure: `DEMAI Mainz`, `DEKAE Karlsruhe`, `GBPME
 *         Portsmouth` and `NLMST Maastricht` are all in that hole, and all
 *         four are among the names this feed actually types.
 *      b. **the exonyms of a port that has one.** GeoNames publishes
 *         `alternatenames` per city — `Genova` carries `Genoa`, `Gênes`,
 *         `Génova` — and a city joined to a port by NAME AND PROXIMITY lends
 *         it those spellings.
 *
 * THE JOIN RULES, STATED BECAUSE THEY ARE THE WHOLE RISK
 * -----------------------------------------------------
 * · A coordinate is taken from GeoNames only when the (country, folded name)
 *   pair matches **exactly one** city in that country. Two Portsmouths in one
 *   country would be refused rather than guessed between.
 * · An exonym is attached only when the GeoNames city is within
 *   {@link EXONYM_MAX_KM} of the port AND one of its names folds to the port's
 *   own name. Proximity alone would give `Genova` the alternate names of a
 *   different Genova; a name alone would give an English Portsmouth the
 *   alternates of the American one.
 * · An alias shorter than {@link MIN_ALIAS_CHARS} folded characters is
 *   dropped. GeoNames lists `GOA` among Genova's alternates, and a three-letter
 *   key in a table of harbour names is a collision waiting to be printed on a
 *   card.
 * · A UN/LOCODE port whose code the WPI already carries is dropped: the WPI
 *   row is richer (depths, shelter, harbour size) and is the one on the map.
 *
 * WHAT THE OUTPUT IS NOT
 * ----------------------
 * **Not a layer.** These places are not drawn: the Ports row is the World Port
 * Index and stays the World Port Index. This file is a gazetteer read by
 * `portDirectory.js` to answer "what place is the master naming", and a card
 * that resolves to one of these says the name and the distance without
 * implying the app has a harbour record for it.
 *
 * Usage:
 *   node scripts/build-port-gazetteer.mjs
 *   node scripts/build-port-gazetteer.mjs --unlocode code-list.csv \
 *        --alias alias.csv --geonames cities15000.txt
 * With no arguments it downloads all three.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldPortKey } from '../src/data/portDirectory.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTS_DIR = path.join(HERE, '..', 'src', 'data', 'local_data', 'ports');
const WPI_PACK = path.join(PORTS_DIR, 'ports.geojsonl');
const OUT = path.join(PORTS_DIR, 'gazetteer.json');

const UNLOCODE_URL = 'https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv';
const ALIAS_URL = 'https://raw.githubusercontent.com/datasets/un-locode/main/data/alias.csv';
const GEONAMES_URL = 'https://download.geonames.org/export/dump/cities15000.zip';

/**
 * How near a GeoNames city must be to lend a port its exonyms.
 *
 * 25 km. A port and the city it is named after are the same place at this
 * scale — `Genova` the city sits 4.4 km from the WPI's `Genova` harbour, and
 * `Antwerpen` 3 km from its. Past that the two are different places that
 * happen to share a name, which is the exact confusion this table exists to
 * avoid rather than to create.
 */
const EXONYM_MAX_KM = 25;

/**
 * Shortest folded alias worth indexing.
 *
 * Four. GeoNames lists `GOA` among Genova's alternate names and `NYC` among
 * New York's; a three-letter key in a table that a twenty-character
 * hand-typed field is matched against is a collision, not a name.
 */
const MIN_ALIAS_CHARS = 4;

/**
 * The prepositional phrases UN/LOCODE appends to tell two places apart.
 *
 * `Frankfurt am Main`, `Mülheim an der Ruhr`, `Bergen op Zoom`, `Newcastle
 * upon Tyne`, `Saint-Valery-sur-Somme`. A master types the head. Folding drops
 * the hyphens, so `SUR` catches the French forms too.
 *
 * Deliberately a CLOSED LIST of function words, not a pattern: a rule that cut
 * a name at any two-to-three letter token would turn `Port La Nouvelle` into
 * `Port` and `Rio de Janeiro` into `Rio`.
 */
const QUALIFIER_TAILS = Object.freeze([
  'AM', 'AN DER', 'AN DEN', 'AUF', 'AUX', 'AAN DE', 'AAN DEN', 'BEI',
  'OP', 'UPON', 'SUR', 'SOUS', 'LES', 'LEZ', 'SOBRE', 'SUL', 'SULLA',
]);

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};

/** Great-circle kilometres. Local, like `portDirectory.portDistanceM`. */
function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * UN/LOCODE's `Coordinates` column: `4230N 00131E`, degrees and whole minutes.
 *
 * Whole minutes is ~1.8 km of precision at the equator, which is right for the
 * question this table answers — which PLACE is the master naming — and wrong
 * for anything else. Nothing downstream navigates with it.
 *
 * @param {string} value
 * @returns {?[number, number]} `[lat, lon]`, or null when unparseable/absent.
 */
export function parseUnlocodeCoordinates(value) {
  const match = /^(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])$/.exec(String(value || '').trim());
  if (!match) return null;
  const lat = (Number(match[1]) + Number(match[2]) / 60) * (match[3] === 'S' ? -1 : 1);
  const lon = (Number(match[4]) + Number(match[5]) / 60) * (match[6] === 'W' ? -1 : 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Three decimals — about 110 m — and that is already FINER than the source:
  // UN/LOCODE publishes whole minutes, which is ~1.8 km. Writing five would be
  // 90 kB of digits claiming a precision the column does not have.
  return [Math.round(lat * 1e3) / 1e3, Math.round(lon * 1e3) / 1e3];
}

/**
 * Split one CSV line, honouring the quoting the UN/LOCODE export uses.
 *
 * Hand-written rather than a dependency: the file has exactly one quoting
 * feature — a doubled `""` inside a quoted field — and this repository's build
 * scripts do not take dependencies for one.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

/**
 * The two halves of an alias row: `Antwerp = Antwerpen`.
 *
 * The list also carries parenthetical forms — `Suez (As Suways) = As Suways
 * (Suez)` — and a parenthetical is a SECOND spelling, not decoration, so both
 * the bare and the parenthesised forms of each side are yielded.
 *
 * @param {string} text One `Name` cell from `alias.csv`.
 * @returns {string[]} Every spelling the row offers, folded, deduplicated.
 */
export function aliasSpellings(text) {
  const out = [];
  for (const half of String(text || '').split('=')) {
    const trimmed = half.trim();
    if (!trimmed) continue;
    // `Gent (Ghent)` is two names; `El Iskandariya (Alexandria)` likewise.
    const bare = trimmed.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    const inner = [...trimmed.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
    for (const spelling of [trimmed, bare, ...inner]) {
      const key = foldPortKey(spelling);
      if (key.length >= MIN_ALIAS_CHARS && !out.includes(key)) out.push(key);
    }
  }
  return out;
}

async function readOrFetch(localPath, url, { zipEntry = null } = {}) {
  if (localPath) return fs.readFileSync(localPath, 'utf8');
  process.stderr.write(`  ↓ ${url}\n`);
  const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  if (!zipEntry) return res.text();
  // One zip entry, unzipped without a dependency: Node ships zlib, and a
  // single stored/deflated member is a fixed-layout header plus a stream.
  const buf = Buffer.from(await res.arrayBuffer());
  const { inflateRawSync } = await import('node:zlib');
  let offset = 0;
  while (offset < buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compressed = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataAt = offset + 30 + nameLen + extraLen;
    if (name === zipEntry) {
      const data = buf.subarray(dataAt, dataAt + compressed);
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    }
    offset = dataAt + compressed;
  }
  throw new Error(`${zipEntry} not found in ${url}`);
}

async function main() {
  // ---- The WPI pack, so the supplement is only what it does NOT hold ------
  const wpiLocodes = new Set();
  const wpiPorts = [];
  for (const line of fs.readFileSync(WPI_PACK, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const feature = JSON.parse(line);
    const p = feature.properties || {};
    const code = foldPortKey(p.unlocode).replace(/ /g, '');
    if (code) wpiLocodes.add(code);
    const [lon, lat] = feature.geometry?.coordinates || [];
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      wpiPorts.push({ code, name: p.name || '', lat, lon });
    }
  }
  process.stderr.write(`  WPI: ${wpiPorts.length} harbours, ${wpiLocodes.size} with a UN/LOCODE\n`);

  // ---- UN/LOCODE: what is a port, and where -------------------------------
  const unlocodeCsv = await readOrFetch(opt('--unlocode'), UNLOCODE_URL);
  const lines = unlocodeCsv.split('\n');
  const header = splitCsvLine(lines[0]);
  const col = Object.fromEntries(header.map((name, i) => [name.trim(), i]));
  for (const required of ['Country', 'Location', 'Name', 'Function', 'Coordinates', 'Change']) {
    if (col[required] === undefined) throw new Error(`UN/LOCODE column missing: ${required}`);
  }

  /** @type {Map<string, {code:string, name:string, lat:?number, lon:?number, country:string}>} */
  const candidates = new Map();
  /** `[wpiCode, unlocodeName]` — the same harbour, spelled the other way. */
  const alsoKnownAs = [];
  let ports = 0;
  let withoutCoordinates = 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const row = splitCsvLine(lines[i]);
    // `X` marks an entry the next edition removes. Shipping one would put a
    // withdrawn code in a table that answers for years.
    if (row[col.Change] === 'X') continue;
    if ((row[col.Function] || '')[0] !== '1') continue; // not a port, in the source's own coding
    const code = `${(row[col.Country] || '').trim()}${(row[col.Location] || '').trim()}`;
    if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(code)) continue;
    ports += 1;
    const name = (row[col.Name] || '').trim();
    if (wpiLocodes.has(code)) {
      // The map already draws this one — but the TWO REGISTERS NAME IT
      // DIFFERENTLY, and both spellings are live in the field. The WPI calls
      // Ajaccio `Port D' Ajaccio` and UN/LOCODE calls it `Ajaccio`; three
      // ships in the sample sat inside that harbour typing `AJACCIO` and
      // resolved to nothing. A shared code is the two registers saying they
      // mean the same place, so the other spelling is an alias with a source
      // rather than a guess.
      if (name) alsoKnownAs.push([code, name]);
      continue;
    }
    const coordinates = parseUnlocodeCoordinates(row[col.Coordinates]);
    if (!coordinates) withoutCoordinates += 1;
    // Later duplicates of a code do not overwrite an earlier one: the file is
    // sorted by code and a repeat is a data slip, not an update.
    if (!candidates.has(code)) {
      candidates.set(code, {
        code,
        name,
        lat: coordinates?.[0] ?? null,
        lon: coordinates?.[1] ?? null,
        country: (row[col.Country] || '').trim(),
      });
    }
  }
  process.stderr.write(`  UN/LOCODE: ${ports} ports, ${candidates.size} not already in the WPI`
    + ` (${withoutCoordinates} of them publish no coordinate)\n`);

  // ---- GeoNames: complete the rows UN/LOCODE already chose ----------------
  const geonamesTsv = await readOrFetch(opt('--geonames'), GEONAMES_URL, { zipEntry: 'cities15000.txt' });
  /** country → folded name → city rows sharing it. */
  const cityByCountry = new Map();
  /** Cities with coordinates, for the proximity half of the exonym join. */
  const cities = [];
  for (const line of geonamesTsv.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    const country = f[8];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !country) continue;
    const names = [f[1], f[2], ...(f[3] || '').split(',')];
    const folded = [];
    for (const name of names) {
      const key = foldPortKey(name);
      if (key.length >= MIN_ALIAS_CHARS && !folded.includes(key)) folded.push(key);
    }
    if (!folded.length) continue;
    const city = { lat, lon, country, folded };
    cities.push(city);
    let byName = cityByCountry.get(country);
    if (!byName) { byName = new Map(); cityByCountry.set(country, byName); }
    for (const key of folded) {
      const bucket = byName.get(key);
      if (bucket) bucket.push(city);
      else byName.set(key, [city]);
    }
  }
  process.stderr.write(`  GeoNames: ${cities.length} cities ≥ 15 000 inhabitants\n`);

  // (a) a coordinate for a port that publishes none — and only when the
  //     (country, name) pair is unambiguous inside that country.
  let placed = 0;
  let ambiguous = 0;
  for (const port of candidates.values()) {
    if (port.lat !== null) continue;
    const bucket = cityByCountry.get(port.country)?.get(foldPortKey(port.name));
    if (!bucket) continue;
    // Deduplicate on the coordinate: one city can be reached through several
    // of its own alternate names, and that is one candidate, not four.
    const distinct = [...new Map(bucket.map((c) => [`${c.lat},${c.lon}`, c])).values()];
    if (distinct.length !== 1) { ambiguous += 1; continue; }
    port.lat = distinct[0].lat;
    port.lon = distinct[0].lon;
    port.placedByGeoNames = true;
    placed += 1;
  }
  process.stderr.write(`  GeoNames placed ${placed} coordinate-less ports`
    + ` (${ambiguous} refused as ambiguous inside their country)\n`);

  const gazetteer = [...candidates.values()]
    .filter((port) => port.lat !== null && port.name)
    .sort((a, b) => (a.code < b.code ? -1 : 1));

  // (b) exonyms. Every port with a coordinate — the WPI's as well as this
  //     supplement's — may pick up the alternate names of the city it IS.
  // A MULTIMAP, not a map. Two places can legitimately answer to one spelling
  // — `Frankfurt am Main` and `Frankfurt an der Oder` both answer to
  // `FRANKFURT` — and `buildPortIndex` appends every one of them to the name
  // bucket, where the distance from the ship decides between them exactly as
  // it already does for the two `Southampton`s the WPI carries.
  const aliasPairs = new Set();
  const addAlias = (key, code) => {
    if (key.length < MIN_ALIAS_CHARS || !code) return;
    aliasPairs.add(`${key}\u0000${code}`);
  };
  // WHO GETS EXONYMS, and it is a size decision made on a measurement.
  // Extending them to all 11 545 gazetteer rows moved the destination census
  // by one point and took the alias table from 13 657 spellings to 31 220 —
  // 209 kB against roughly 300 kB on the wire. So one set gets them and the
  // rest do not:
  //
  //   · every WPI harbour, because it is a place a reader can click, and a
  //     place on the map may be known by another name;
  //   · and nobody else. Extending it to the 933 rows GeoNames itself placed
  //     added 7 000 spellings — 36 kB on the wire — and resolved ONE more
  //     vessel in the sample, which is the shape of an expansion that has run
  //     out of demand.
  const allPorts = wpiPorts.filter((p) => p.code);
  // Own names are never aliases: `buildPortIndex` already indexes them, and an
  // alias that shadowed a real harbour name would move a card off it.
  const ownNames = new Set([
    ...allPorts.map((p) => foldPortKey(p.name)),
    ...gazetteer.map((p) => foldPortKey(p.name)),
  ]);
  let exonyms = 0;
  for (const port of allPorts) {
    const key = foldPortKey(port.name);
    if (!key) continue;
    const nearby = cityByCountry.get(port.code.slice(0, 2))?.get(key);
    if (!nearby) continue;
    const city = nearby.find((c) => distanceKm(port.lat, port.lon, c.lat, c.lon) <= EXONYM_MAX_KM);
    if (!city) continue;
    for (const spelling of city.folded) {
      if (spelling === key || ownNames.has(spelling)) continue;
      const before = aliasPairs.size;
      addAlias(spelling, port.code);
      if (aliasPairs.size !== before) exonyms += 1;
    }
  }
  process.stderr.write(`  GeoNames lent ${exonyms} exonyms to ports within ${EXONYM_MAX_KM} km\n`);

  // (c) UN/LOCODE's own alias list. Added LAST so a hand-curated row from the
  //     source of record wins over a GeoNames alternate that disagrees.
  const aliasCsv = await readOrFetch(opt('--alias'), ALIAS_URL);
  const codeByName = new Map();
  for (const port of [...allPorts, ...gazetteer]) {
    const key = foldPortKey(port.name);
    if (key && !codeByName.has(key)) codeByName.set(key, port.code);
  }
  let official = 0;
  for (const line of aliasCsv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const row = splitCsvLine(line);
    const spellings = aliasSpellings(row[1]);
    // The row is a set of names for ONE place; whichever of them the port
    // register already knows is the anchor, and the rest become aliases of it.
    const anchor = spellings.map((key) => codeByName.get(key)).find(Boolean);
    if (!anchor) continue;
    for (const key of spellings) {
      if (ownNames.has(key)) continue;
      const before = aliasPairs.size;
      addAlias(key, anchor);
      if (aliasPairs.size !== before) official += 1;
    }
  }
  process.stderr.write(`  UN/LOCODE's own alias list resolved ${official} spellings\n`);

  // (d) THE REGISTER'S OWN DISAMBIGUATING TAIL. UN/LOCODE writes `Frankfurt am
  //     Main` and `Mülheim an der Ruhr` and `Bergen op Zoom`; a master types
  //     `FRANKFURT`. This is the mirror of `GENERIC_NAME_HEADS` in
  //     `portDirectory.js` — a rule about how the REGISTER names things, not a
  //     similarity score — and it is why the alias table had to become a
  //     multimap: `Frankfurt am Main` and `Frankfurt an der Oder` both answer
  //     to `FRANKFURT`, and the distance from the ship is what picks. The head
  //     is indexed ALONGSIDE the published name, never instead of it, and it
  //     is dropped when it is already some other place's own name.
  // (e) the OTHER register's spelling of a harbour both of them carry.
  let crossNames = 0;
  for (const [code, name] of alsoKnownAs) {
    const key = foldPortKey(name);
    if (ownNames.has(key)) continue; // the WPI already answers to this exact key
    const before = aliasPairs.size;
    addAlias(key, code);
    if (aliasPairs.size !== before) crossNames += 1;
  }
  process.stderr.write(`  ${crossNames} harbours gained UN/LOCODE's spelling of their own name\n`);

  let tails = 0;
  for (const port of [...allPorts, ...gazetteer]) {
    const key = foldPortKey(port.name);
    const cut = QUALIFIER_TAILS.map((tail) => key.indexOf(` ${tail} `))
      .filter((at) => at > 0)
      .sort((a, b) => a - b)[0];
    if (cut === undefined) continue;
    const head = key.slice(0, cut);
    if (head.length < MIN_ALIAS_CHARS || ownNames.has(head)) continue;
    const before = aliasPairs.size;
    addAlias(head, port.code);
    if (aliasPairs.size !== before) tails += 1;
  }
  process.stderr.write(`  ${tails} names shortened past the register's own qualifier\n`);

  const payload = {
    generated: new Date().toISOString().slice(0, 10),
    sources: [
      { name: 'UN/LOCODE 2024-2 (UNECE)', licence: 'ODC-PDDL-1.0', url: UNLOCODE_URL },
      { name: 'GeoNames cities15000', licence: 'CC BY 4.0', url: GEONAMES_URL },
    ],
    // [code, name, lat, lon]
    ports: gazetteer.map((p) => [p.code, p.name, p.lat, p.lon]),
    // [foldedSpelling, code], and a spelling MAY REPEAT: several places answer
    // to `FRANKFURT`. The code is resolved against the MERGED locode index at
    // read time, so an alias may point at a WPI harbour or at one of the ports
    // above; one that points at neither is dropped there.
    aliases: [...aliasPairs]
      .map((pair) => pair.split('\u0000'))
      .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : (a[0] < b[0] ? -1 : 1))),
  };
  fs.writeFileSync(OUT, `${JSON.stringify(payload)}\n`, 'utf8');
  const bytes = fs.statSync(OUT).size;
  process.stderr.write(`\n  → ${path.relative(process.cwd(), OUT)}`
    + `  ${payload.ports.length} ports, ${payload.aliases.length} spellings,`
    + ` ${(bytes / 1024).toFixed(0)} kB\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
