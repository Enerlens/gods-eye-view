import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PORT_NAME_MATCH_MAX_M,
  buildPortIndex,
  destinationCandidates,
  destinationPortLine,
  foldPortKey,
  matchDestinationToPort,
  portDistanceM,
} from './portDirectory.js';

/** The shipped World Port Index pack, read the way the layer reads it. */
const PORTS = readFileSync(
  new URL('./local_data/ports/ports.geojsonl', import.meta.url),
  'utf8',
).split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));

const INDEX = buildPortIndex(PORTS);

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
