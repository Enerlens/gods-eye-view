import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PORT_GAZETTEER_NAME_MATCH_MAX_M,
  PORT_NAME_MATCH_MAX_M,
  buildPortIndex,
  destinationCandidates,
  destinationPortLine,
  foldPortKey,
  matchDestinationToPort,
  portDistanceM,
} from './portDirectory.js';
import { aliasSpellings, parseUnlocodeCoordinates, splitCsvLine } from '../../scripts/build-port-gazetteer.mjs';

/** The shipped World Port Index pack, read the way the layer reads it. */
const PORTS = readFileSync(
  new URL('./local_data/ports/ports.geojsonl', import.meta.url),
  'utf8',
).split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));

const INDEX = buildPortIndex(PORTS);

/** The shipped gazetteer, read the way the ports layer reads it. */
const GAZETTEER = JSON.parse(readFileSync(
  new URL('./local_data/ports/gazetteer.json', import.meta.url),
  'utf8',
));

const FULL = buildPortIndex(PORTS, GAZETTEER);

/** Somewhere in the southern North Sea — where most of this feed sails. */
const CHANNEL = { lat: 51.2, lon: 2.4 };

test('the index is built from the pack the app actually ships', () => {
  assert.equal(INDEX.ports, 2951);
  assert.equal(INDEX.byLocode.size, 2550);
  assert.equal(INDEX.byName.size, 2934);
  // A harbour answers to BOTH spellings — the register's and the master's.
  assert.ok(INDEX.byName.has('PORT OF LE HAVRE'));
  assert.ok(INDEX.byName.has('LE HAVRE'));
  assert.equal(INDEX.contestedNames, 52, 'the WPI really does list two Southamptons');
});

test('folding is a key, never a similarity', () => {
  assert.equal(foldPortKey('Saint-Nazaire'), 'SAINT NAZAIRE');
  assert.equal(foldPortKey('ST. NAZAIRE'), 'ST NAZAIRE');
  assert.equal(foldPortKey('Gênes'), 'GENES');
  // The letters normalisation cannot take apart. 174 gazetteer names were
  // folding to a key with a hole in it before these.
  assert.equal(foldPortKey('København'), 'KOBENHAVN');
  assert.equal(foldPortKey('Humlebæk'), 'HUMLEBAEK');
  assert.equal(foldPortKey('Þórshöfn'), 'THORSHOFN');
  assert.equal(foldPortKey('Straße'), 'STRASSE');
  assert.equal(foldPortKey(null), '');
  // Two strings either fold to the same key or they do not — `GENOA` and
  // `GENOVA` are one letter apart and stay two different keys.
  assert.notEqual(foldPortKey('GENOA'), foldPortKey('GENOVA'));
});

test('a UN/LOCODE resolves whichever way the master spelled it', () => {
  for (const written of ['BEANR', 'BE ANR', 'be anr', 'BEANR ']) {
    const match = matchDestinationToPort(written, INDEX, CHANNEL);
    assert.equal(match?.port.name, 'Antwerpen', written);
    assert.equal(match.how, 'locode');
  }
});

test('a leg resolves to where the ship is GOING, not where it has been', () => {
  // Both spellings are live in the field, measured in one hour of the feed.
  assert.equal(matchDestinationToPort('DOVER<=>CALAIS', INDEX, CHANNEL)?.port.name, 'Calais');
  assert.equal(matchDestinationToPort('NOMON => TRALI', INDEX, CHANNEL)?.port.name, 'Aliaga');
  assert.equal(matchDestinationToPort('GB PME > TR ALI', INDEX, CHANNEL)?.port.name, 'Aliaga');
  assert.equal(matchDestinationToPort('TO ROTTERDAM', INDEX, CHANNEL)?.port.name, 'Rotterdam');
});

test('the register s own generic heads are stripped, because a master never types them', () => {
  // The pack calls them `Port Of Le Havre`, `Port Of Rouen`, `Rade De Brest`;
  // 19 ships wrote `LE HAVRE`, 12 wrote `ROUEN` and 14 wrote `BREST`.
  assert.equal(matchDestinationToPort('LE HAVRE', INDEX, CHANNEL)?.port.name, 'Port Of Le Havre');
  assert.equal(matchDestinationToPort('ROUEN', INDEX, CHANNEL)?.port.name, 'Port Of Rouen');
  assert.equal(matchDestinationToPort('BREST', INDEX, CHANNEL)?.port.name, 'Rade De Brest');
});

test('a berth inside a port resolves to the port, and a KIND of place never does', () => {
  // The field's own twenty-character ceiling cuts these off mid-word.
  assert.equal(matchDestinationToPort('ANTWERPEN 4E HAVENDO', INDEX, CHANNEL)?.port.name, 'Antwerpen');
  assert.equal(matchDestinationToPort('VLISSINGEN BUITENHAV', INDEX, CHANNEL)?.port.name, 'Vlissingen');
  assert.equal(matchDestinationToPort('TERNEUZEN  BRAAKMANH', INDEX, CHANNEL)?.port.name, 'Terneuzen');
  // `PORT` is a kind of place. Without the guard this asks the register for a
  // harbour called `PORT` and takes whatever comes back.
  const generic = destinationCandidates('PORT ELIZABETH BERTH');
  assert.ok(!generic.includes('PORT'));
});

test('two harbours with one name are settled by the ship, never by load order', () => {
  // GB SOU and CA SON both fold to `SOUTHAMPTON`.
  const channel = matchDestinationToPort('SOUTHAMPTON', INDEX, CHANNEL);
  assert.equal(channel?.port.countryCode, 'GB');
  assert.equal(channel.contested, 2);
  const lakeHuron = matchDestinationToPort('SOUTHAMPTON', INDEX, { lat: 44.5, lon: -81.4 });
  assert.equal(lakeHuron?.port.countryCode, 'CA');
  // With no ship there is nothing to settle it with, and guessing would be
  // worse than printing the raw field.
  assert.equal(matchDestinationToPort('SOUTHAMPTON', INDEX), null);
});

test('a name match too far away is refused; a code at the same range is not', () => {
  // Measured: six ships in the Channel wrote `PORTSMOUTH`, and the WPI carries
  // no English harbour of that name — only US PSM, 5 157 km away. Every name
  // match over 2 500 km in the sample was wrong; every legitimate one was
  // under 1 348 km.
  assert.equal(matchDestinationToPort('PORTSMOUTH', INDEX, CHANNEL), null);
  assert.equal(matchDestinationToPort('PORTLAND', INDEX, CHANNEL), null);
  // The same ship writing a CODE is believed at any range: a code is the
  // master's own identifier, not a spelling that happened to agree.
  const far = matchDestinationToPort('USPSM', INDEX, CHANNEL);
  assert.equal(far?.port.countryCode, 'US');
  assert.ok(portDistanceM(CHANNEL.lat, CHANNEL.lon, far.port.lat, far.port.lon)
    > PORT_NAME_MATCH_MAX_M);
});

test('what the field is NOT is refused rather than guessed at', () => {
  for (const junk of ['HARBOUR TOWAGE', 'FOR ORDERS', 'CRUISING', '-', '??', '', null]) {
    assert.equal(matchDestinationToPort(junk, INDEX, CHANNEL), null, String(junk));
  }
  // Inland river ports: the World Port Index is an index of SEA harbours, and
  // the Rhine carries a large share of this feed. Refused, not approximated.
  for (const inland of ['MAINZ', 'KARLSRUHE', 'DUISBURG']) {
    assert.equal(matchDestinationToPort(inland, INDEX, CHANNEL), null, inland);
  }
  // And no edit distance anywhere: `GENOA` is one letter from `GENOVA` and
  // stays unresolved, because the rule that matched it would also match
  // `PARIS` to something 5 500 km away.
  assert.equal(matchDestinationToPort('GENOA', INDEX, CHANNEL), null);
});

test('the line the card prints carries the harbour, its code and the distance', () => {
  const match = matchDestinationToPort('ANTWERPEN', INDEX, CHANNEL);
  const line = destinationPortLine(match, CHANNEL);
  assert.match(line, /^→ Antwerpen · BEANR · \d+ km$/);
  // A code match does not repeat the code the master already typed.
  const byCode = destinationPortLine(matchDestinationToPort('BEANR', INDEX, CHANNEL), CHANNEL);
  assert.match(byCode, /^→ Antwerpen · \d+ km$/);
  // Nothing resolved, nothing printed: the caller keeps the raw field.
  assert.equal(destinationPortLine(null, CHANNEL), null);
});

test('a mangled index and a mangled pack are inert', () => {
  assert.equal(matchDestinationToPort('BEANR', null, CHANNEL), null);
  const empty = buildPortIndex(null);
  assert.equal(empty.ports, 0);
  assert.equal(matchDestinationToPort('BEANR', empty, CHANNEL), null);
  // A feature with no coordinate is skipped, not indexed at (0, 0).
  const partial = buildPortIndex([
    { properties: { name: 'Nowhere', unlocode: 'XX NOW' }, geometry: null },
    { properties: { name: 'Somewhere', unlocode: 'XX SOM' }, geometry: { coordinates: [1, 2] } },
  ]);
  assert.equal(partial.ports, 1);
  assert.equal(matchDestinationToPort('XXNOW', partial, CHANNEL), null);
  assert.equal(matchDestinationToPort('XXSOM', partial, CHANNEL)?.port.name, 'Somewhere');
});

// --- The gazetteer ----------------------------------------------------------
//
// `scripts/build-port-gazetteer.mjs` adds the places the World Port Index is
// not an index of — 11 545 UN/LOCODE ports and 13 657 spellings — and moves
// the destination census from 50.4 % to 68.9 % on a 1 924-vessel sample.
// What is asserted here is that it can only ever ADD: the WPI keeps every
// code it carries, no card that resolved before resolves differently, and a
// name agreeing from far away is refused harder than a WPI name would be.

test('the gazetteer merges without displacing a single World Port Index harbour', () => {
  assert.ok(FULL.gazetteerPorts > 10_000, `only ${FULL.gazetteerPorts} gazetteer places`);
  assert.ok(FULL.aliases > 10_000, `only ${FULL.aliases} spellings`);
  assert.equal(FULL.ports, INDEX.ports, 'the WPI count is untouched');
  // Compared by CONTENT: each `buildPortIndex` call mints its own frozen
  // entries, so identity would only be testing that fact.
  for (const [code, port] of INDEX.byLocode) {
    const after = FULL.byLocode.get(code);
    assert.ok(after && after.name === port.name && after.lat === port.lat && after.lon === port.lon,
      `${code} was displaced by a gazetteer row`);
    assert.ok(!after.gazetteer, `${code} is answered by a gazetteer row`);
  }
});

test('the gazetteer can only bring an answer NEARER — never blank it, never push it away', () => {
  // The whole risk of a second register is what it does to an answer that was
  // already right, and the invariant is not "nothing moves": a bucket that
  // gains a nearer place of the same name SHOULD move, which is the module's
  // own nearest-wins rule and is why six ships in the Channel writing
  // `PORTLAND` stop resolving to Oregon. Driven over every WPI harbour name,
  // the set most exposed to a collision with an 11 545-row gazetteer.
  const from = { lat: 51.2, lon: 2.4 };
  let checked = 0;
  let moved = 0;
  for (const [name] of INDEX.byName) {
    const before = matchDestinationToPort(name, INDEX, from);
    if (!before) continue;
    checked += 1;
    const after = matchDestinationToPort(name, FULL, from);
    assert.ok(after, `${name} stopped resolving`);
    const wasKm = portDistanceM(from.lat, from.lon, before.port.lat, before.port.lon);
    const isKm = portDistanceM(from.lat, from.lon, after.port.lat, after.port.lon);
    assert.ok(isKm <= wasKm,
      `${name} moved AWAY, ${before.port.name} → ${after.port.name}`);
    if (after.port.name !== before.port.name) moved += 1;
  }
  assert.ok(checked > 100, `only ${checked} names exercised`);
  // And it stays a rare event: a wholesale reshuffle would mean the gazetteer
  // is answering for harbours rather than beside them.
  assert.ok(moved / checked < 0.05, `${moved} of ${checked} answers moved`);
});

test('the two families the audit named now resolve', () => {
  // An inland river port: the WPI is an index of SEA harbours and never had it.
  const rhine = { lat: 50.0, lon: 8.3 };
  assert.equal(matchDestinationToPort('MAINZ', INDEX, rhine), null);
  assert.equal(matchDestinationToPort('MAINZ', FULL, rhine)?.port.unlocode, 'DEMAI');
  // An exonym: the pack spells it `Genova` and 13 masters typed `GENOA`.
  const ligurian = { lat: 44.0, lon: 8.9 };
  assert.equal(matchDestinationToPort('GENOA', INDEX, ligurian), null);
  assert.equal(matchDestinationToPort('GENOA', FULL, ligurian)?.port.name, 'Genova');
  // The register's own qualifier, which a master never types.
  assert.equal(matchDestinationToPort('FRANKFURT', FULL, { lat: 50.1, lon: 8.7 })?.port.unlocode, 'DEFRA');
  // And the other register's spelling of a harbour the WPI calls something else.
  const corsica = { lat: 41.92, lon: 8.74 };
  assert.equal(matchDestinationToPort('AJACCIO', INDEX, corsica), null);
  assert.equal(matchDestinationToPort('AJACCIO', FULL, corsica)?.port.unlocode?.replace(' ', ''), 'FRAJA');
});

test('a gazetteer name agreeing from far away is refused, and a WPI one at the same range is not', () => {
  // Three ships at Beaulieu-sur-Mer typed `BEAULIEU`; the only Beaulieu
  // UN/LOCODE codes as a port is in Hampshire, 1 030 km away.
  const riviera = { lat: 43.70, lon: 7.34 };
  assert.equal(matchDestinationToPort('BEAULIEU', FULL, riviera), null);
  assert.ok(PORT_GAZETTEER_NAME_MATCH_MAX_M < PORT_NAME_MATCH_MAX_M);
  // A WPI harbour at a comparable range still answers: the ceiling is per
  // ENTRY, not per query.
  const brest = matchDestinationToPort('BREST', FULL, { lat: 51.2, lon: 2.4 });
  const brestM = brest ? portDistanceM(51.2, 2.4, brest.port.lat, brest.port.lon) : 0;
  assert.ok(brestM > PORT_GAZETTEER_NAME_MATCH_MAX_M && brestM < PORT_NAME_MATCH_MAX_M,
    `Rade De Brest is ${Math.round(brestM / 1000)} km from the ship`);
});

test('a bucket holding both kinds answers with the nearest ADMISSIBLE one', () => {
  // A gazetteer row over its own ceiling must not blank an answer a WPI
  // harbour further away can still give.
  const index = buildPortIndex(
    [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.7, 45.5] },
      properties: { name: 'Faraway', unlocode: 'US FAR' },
    }],
    { ports: [['GBFAR', 'Faraway', 51.0, 0.0]], aliases: [] },
  );
  // A ship in the mid-Atlantic: 4 500 km from the gazetteer row (over its
  // 500 km ceiling) and 5 900 km from the WPI one (under its 2 500 km one)…
  const midAtlantic = { lat: 45.0, lon: -35.0 };
  const near = portDistanceM(45, -35, 51, 0);
  const far = portDistanceM(45, -35, 45.5, -122.7);
  assert.ok(near > PORT_GAZETTEER_NAME_MATCH_MAX_M && near < far);
  // …so neither is admissible here, and the field is printed raw.
  assert.equal(matchDestinationToPort('FARAWAY', index, midAtlantic), null);
  // Move the ship inside the WPI ceiling and the WPI harbour answers even
  // though the gazetteer row is still the nearer of the two.
  const pacific = { lat: 45.0, lon: -100.0 };
  assert.equal(matchDestinationToPort('FARAWAY', index, pacific)?.unlocode, undefined);
  assert.equal(matchDestinationToPort('FARAWAY', index, pacific)?.port.name, 'Faraway');
  assert.equal(matchDestinationToPort('FARAWAY', index, pacific)?.port.gazetteer, undefined);
});

test('a malformed gazetteer is inert, exactly like a malformed pack', () => {
  const fine = buildPortIndex(PORTS, null);
  assert.equal(fine.gazetteerPorts, 0);
  assert.equal(fine.aliases, 0);
  const junk = buildPortIndex(PORTS, {
    ports: [null, 'nope', [], ['TOOSHORT'], ['XX', 'no code', 1, 2], ['DEXXX', 'No coords', 'a', 'b']],
    aliases: [null, ['AB'], ['ALIAS', 'ZZZZZ'], ['X', 'DEMAI']],
  });
  assert.equal(junk.gazetteerPorts, 0);
  assert.equal(junk.aliases, 0, 'an alias pointing at no known code is dropped');
  assert.equal(junk.byName.size, INDEX.byName.size);
});

// --- The build script's own parsing -----------------------------------------

test('UN/LOCODE degrees-and-minutes parse, or refuse', () => {
  assert.deepEqual(parseUnlocodeCoordinates('4230N 00131E'), [42.5, 1.517]);
  assert.deepEqual(parseUnlocodeCoordinates('4425N 00857E'), [44.417, 8.95]);
  assert.deepEqual(parseUnlocodeCoordinates('4720N 00225W'), [47.333, -2.417]);
  // A column that is empty for 4 791 of the 17 596 ports.
  assert.equal(parseUnlocodeCoordinates(''), null);
  assert.equal(parseUnlocodeCoordinates('somewhere'), null);
  assert.equal(parseUnlocodeCoordinates('9930N 00131E'), null, 'past the pole');
});

test('the CSV split honours the export s own quoting', () => {
  assert.deepEqual(splitCsvLine(',BE,ANR,Antwerpen,Antwerpen,VAN,AI,12345---,0307,,5113N 00425E,'),
    ['', 'BE', 'ANR', 'Antwerpen', 'Antwerpen', 'VAN', 'AI', '12345---', '0307', '', '5113N 00425E', '']);
  assert.deepEqual(splitCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']);
  assert.deepEqual(splitCsvLine('a,"b""c",d'), ['a', 'b"c', 'd']);
});

test('an alias row yields every spelling it offers, parentheses included', () => {
  assert.deepEqual(aliasSpellings('Antwerp = Antwerpen'), ['ANTWERP', 'ANTWERPEN']);
  // `ø` is not a decomposable diacritic; `LETTER_FOLDINGS` is what makes this
  // meet a master typing `KOBENHAVN`.
  assert.deepEqual(aliasSpellings('Copenhagen = København'), ['COPENHAGEN', 'KOBENHAVN']);
  // A parenthetical is a SECOND spelling, so both halves of both sides count.
  assert.deepEqual(aliasSpellings('Cairo = El Qahira (Cairo)'),
    ['CAIRO', 'EL QAHIRA CAIRO', 'EL QAHIRA']);
  assert.deepEqual(aliasSpellings(''), []);
});
