// scripts/lib/filosofiPack.test.mjs
// The on-disk contract for the local 2021 carroyage pack, and the two rules
// that keep it from lying: it covers métropole only, and its absence is a
// fallback rather than a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
  PACK_BOXES,
  PACK_CRS,
  PACK_VINTAGE,
  SHARD_M,
  packCovers,
  packIndexPath,
  shardKey,
  shardPath,
  shardsForBox,
} from './filosofiPack.mjs';
import {
  buildPackFromArchive,
  cellFromRow,
  accumulateKm,
  coarseCellToWire,
  parseIdcar,
  shardBounds,
  share,
  singleCommune,
  splitCsvLine,
} from '../build-filosofi-2021-pack.mjs';

// ── The layout ──────────────────────────────────────────────────────────────

test('a shard is a whole number of cells, so its key is exact arithmetic', () => {
  assert.equal(SHARD_M % 200, 0, 'the fine grid must tile a shard exactly');
  assert.equal(SHARD_M % 1000, 0, 'and so must the coarse one');
  assert.equal(shardKey(3035, 2_529_000, 3_920_400),
    `3035-${Math.floor(2_529_000 / SHARD_M)}_${Math.floor(3_920_400 / SHARD_M)}`);
  // Two cells in the same 50 km tile share a key; one over the edge does not.
  assert.equal(shardKey(3035, 2_529_000, 3_920_400), shardKey(3035, 2_529_200, 3_920_600));
  assert.notEqual(shardKey(3035, 2_529_000, 3_920_400), shardKey(3035, 2_529_000, 3_920_400 + SHARD_M));
  // THE GRID IS PART OF THE KEY. Two cells in two territories can carry the
  // same northing and easting and mean different places; without the prefix
  // they would land in one file and overwrite each other.
  assert.notEqual(shardKey(3035, 1_600_000, 700_000), shardKey(5490, 1_600_000, 700_000));
  assert.equal(shardPath('/p', 200, '50_78'), path.join('/p', 'r200', '50_78.json.gz'));
  assert.equal(packIndexPath('/p'), path.join('/p', 'index.json'));
});

test('shards are chosen by their own published boxes, so nothing projects twice', () => {
  const bounds = {
    lyon: { south: 45.7, west: 4.8, north: 45.9, east: 5.0 },
    paris: { south: 48.8, west: 2.2, north: 49.0, east: 2.5 },
  };
  assert.deepEqual(shardsForBox(bounds, { south: 45.75, west: 4.83, north: 45.78, east: 4.87 }), ['lyon']);
  assert.deepEqual(shardsForBox(bounds, { south: 40, west: 0, north: 50, east: 6 }).sort(), ['lyon', 'paris']);
  assert.deepEqual(shardsForBox(bounds, { south: 43.0, west: 1.0, north: 43.5, east: 1.5 }), []);
  assert.deepEqual(shardsForBox(undefined, { south: 0, west: 0, north: 1, east: 1 }), []);
});

test('the pack covers all three territories, and refuses a box that straddles one', () => {
  // INSEE grids each territory in its own zone — métropole EPSG:3035,
  // Martinique 5490, La Réunion 2975 — and the app inverts all three.
  assert.deepEqual([...PACK_CRS].sort((a, b) => a - b), [2975, 3035, 5490]);
  assert.ok(packCovers({ south: 45.75, west: 4.82, north: 45.79, east: 4.88 }), 'Lyon');
  assert.ok(packCovers({ south: 41.3, west: 8.6, north: 42.0, east: 9.5 }), 'Corse');
  assert.ok(packCovers({ south: 14.4, west: -61.2, north: 14.9, east: -60.8 }), 'Martinique');
  assert.ok(packCovers({ south: -21.4, west: 55.2, north: -20.9, east: 55.8 }), 'La Réunion');
  // INSIDE a box, not merely touching it: answering half a straddling viewport
  // from the pack would silently short the other half. That one goes to the
  // relay, which has every territory in one grid.
  assert.ok(!packCovers({ south: 40.0, west: 4.0, north: 52.0, east: 10.0 }), 'over the top edge');
  assert.ok(!packCovers({ south: 14.0, west: -62.0, north: 16.0, east: -60.0 }), 'around Martinique');
  assert.ok(!packCovers(null));
  assert.equal(PACK_BOXES.length, 3);
});

// ── Reading INSEE's CSV ─────────────────────────────────────────────────────

test('the identifier carries its projection, and all three are packable', () => {
  assert.deepEqual(parseIdcar('CRS3035RES200mN2029400E4259000'),
    { crs: 3035, res: 200, n: 2_029_400, e: 4_259_000 });
  // Martinique and La Réunion, in INSEE's own files and in their own zones.
  assert.equal(parseIdcar('CRS5490RES200mN1592600E728800').crs, 5490);
  assert.equal(parseIdcar('CRS2975RES200mN7634200E359400').crs, 2975);
  assert.equal(parseIdcar('nonsense'), null);
  // A DOM cell is packed, and carries its grid — without which it would be
  // rebuilt as LAEA and land in the Arctic.
  const martinique = cellFromRow({ idcar_200m: 'CRS5490RES200mN1592600E728800', ind: '1' });
  assert.equal(martinique.crs, 5490);
  // A grid nobody inverts is still refused.
  assert.equal(cellFromRow({ idcar_200m: 'CRS9999RES200mN1E1', ind: '1' }), null);
});

test('a quoted commune list does not shift every column after it', () => {
  // The bug this replaced: about 8 % of rows quote their commune field because
  // the cell straddles communes — `"2A041,2A247"` — and `line.split(',')`
  // shifted the rest by one. The first build published 64 010 communes and the
  // wrong income in one row out of twelve.
  const line = 'CRS3035RES200mN2042600E4257600,CRS3035RES1000mN2042000E4257000,'
    + 'CRS3035RES32000mN2016000E4256000,1,1,"2A041,2A247",4,1.9';
  const parts = splitCsvLine(line);
  assert.equal(parts[5], '2A041,2A247', 'the quoted field stays whole');
  assert.equal(parts[6], '4', 'and the column after it is still the population');
  assert.equal(parts.length, 8);
  // Doubled quotes are an escaped quote, not the end of the field.
  assert.deepEqual(splitCsvLine('a,"b""c",d'), ['a', 'b"c', 'd']);
  assert.deepEqual(splitCsvLine('a,,b'), ['a', '', 'b']);
});

test('a cell on several communes is named by none of them', () => {
  // INSEE lists every commune a carreau touches. The wire shape carries one
  // code, and picking the first would be inventing an answer the publisher
  // deliberately declined to give — the same reason the 1 km grid names none.
  assert.equal(singleCommune('2A041'), '2A041');
  assert.equal(singleCommune('"2A041"'), '2A041');
  assert.equal(singleCommune('2A041,2A247'), null);
  assert.equal(singleCommune(''), null);
  assert.equal(singleCommune(null), null);
});

test('a row becomes the same wire cell the WFS path produces', () => {
  // The whole point of the pack: the proxy serves it through the path that
  // already exists, and the client cannot tell which source answered except by
  // reading the vintage it is told.
  const cell = cellFromRow({
    idcar_200m: 'CRS3035RES200mN2529000E3920400',
    idcar_1km: 'CRS3035RES1000mN2529000E3920000',
    i_est_200: '0',
    lcog_geo: '69381',
    ind: '100', men: '50', men_pauv: '10', men_1ind: '25', men_prop: '20',
    ind_snv: '2500000', men_surf: '3000', men_coll: '45', log_soc: '5',
    ind_0_3: '4', ind_4_5: '2', ind_6_10: '6', ind_11_17: '8',
    ind_65_79: '10', ind_80p: '5',
  });
  assert.equal(cell.n, 2_529_000);
  assert.equal(cell.e, 3_920_400);
  assert.equal(cell.ind, 100);
  assert.equal(cell.niveau, 25_000, 'ind_snv / ind, which the WFS pre-divides');
  assert.equal(cell.pauvrete, 20, '10 poor households of 50');
  // `men_surf` is a TOTAL floor area, not a mean: reading it straight would
  // publish a France of 3 000 m² apartments.
  assert.equal(cell.surface, 60);
  assert.equal(cell.jeunes, 20, 'four age bands under 18, summed');
  assert.equal(cell.aines, 15);
  assert.equal(cell.est, 0);
  assert.equal(cell.com, '69381');
});

test('an unstated imputation flag is null, never "observed"', () => {
  // The one claim this field exists to make, and the one a missing column
  // cannot support.
  assert.equal(cellFromRow({ idcar_200m: 'CRS3035RES200mN1E1', i_est_200: '1', ind: '1' }).est, 1);
  assert.equal(cellFromRow({ idcar_200m: 'CRS3035RES200mN1E1', i_est_200: '0', ind: '1' }).est, 0);
  assert.equal(cellFromRow({ idcar_200m: 'CRS3035RES200mN1E1', ind: '1' }).est, null);
});

test('a share of nothing is null, not zero', () => {
  assert.equal(share(10, 50), 20);
  assert.equal(share(1, 3), 33.3, 'rounded to the tenth the relay publishes');
  assert.equal(share(5, 0), null, 'no denominator is not a rate of zero');
  assert.equal(share(null, 50), null);
});

// ── Aggregating to 1 km ─────────────────────────────────────────────────────

test('the coarse grid sums numerators, never averages rates', () => {
  // The mean of two cells' poverty rates is not the poverty rate of the two.
  // Averaging would weight a 4-household square like a 400-household one and
  // make the coarse grid disagree with the fine one over the same ground.
  const coarse = new Map();
  const base = {
    idcar_1km: 'CRS3035RES1000mN2529000E3920000',
    i_est_1km: '0',
    ind_snv: '0', men_surf: '0', men_prop: '0', men_1ind: '0', men_coll: '0', log_soc: '0',
  };
  accumulateKm(coarse, { ...base, ind: '400', men: '200', men_pauv: '20' });
  accumulateKm(coarse, { ...base, ind: '4', men: '2', men_pauv: '2' });
  const wire = coarseCellToWire([...coarse.values()][0]);
  assert.equal(wire.men, 202);
  // 22 poor of 202 is 10.9 %. The mean of 10 % and 100 % would have been 55 %.
  assert.equal(wire.pauvrete, 10.9);
  assert.equal(wire.com, null, 'a 1 km square spans communes and INSEE names none');
});

test('the coarse imputation flag is the published one, not derived from children', () => {
  // INSEE decides confidentiality at each resolution: a 1 km square of observed
  // 200 m cells can still be published as modelled, and inferring it from the
  // children would be overruling the publisher.
  const coarse = new Map();
  accumulateKm(coarse, {
    idcar_1km: 'CRS3035RES1000mN2529000E3920000', i_est_1km: '1', ind: '10', men: '5',
  });
  accumulateKm(coarse, {
    idcar_1km: 'CRS3035RES1000mN2529000E3920000', i_est_1km: '1', ind: '10', men: '5',
  });
  assert.equal(coarseCellToWire([...coarse.values()][0]).est, 1);
});

test('a 1 km cell keeps its own grid, and an unknown grid is refused', () => {
  const coarse = new Map();
  accumulateKm(coarse, { idcar_1km: 'CRS2975RES1000mN7634000E359000', i_est_1km: '0', ind: '19', men: '8' });
  assert.equal(coarse.size, 1);
  assert.equal(coarseCellToWire([...coarse.values()][0]).crs, 2975);
  accumulateKm(coarse, { idcar_1km: 'CRS9999RES1000mN1E1', ind: '1' });
  assert.equal(coarse.size, 1, 'a grid nobody inverts is not accumulated');
});

// ── The index the proxy reads ───────────────────────────────────────────────

test('a shard publishes a box that contains its own cells', () => {
  // The proxy picks files by viewport and never projects anything itself, so a
  // box that clipped its own cells would drop them silently.
  const cells = [
    { n: 2_529_000, e: 3_920_400 },
    { n: 2_530_000, e: 3_921_400 },
  ];
  // Those two cells sit at 45.75002/4.85531 and 45.75963/4.86728.
  const box = shardBounds(cells, 200);
  assert.ok(box.south < 45.75002 && box.north > 45.75963, `${JSON.stringify(box)}`);
  assert.ok(box.west < 4.85531 && box.east > 4.86728, `${JSON.stringify(box)}`);
  // The margin is a whole cell, because a centre is not a corner.
  const tight = shardBounds([cells[0]], 200);
  assert.ok(tight.north - tight.south > (2 * 200) / 111_000 * 0.9);
});

test('the vintage the builder writes is the one the module publishes', () => {
  // Two programs agree about this number — the script that writes the pack and
  // the proxy that reads it — and a drift between them would caption 2021 data
  // with another year.
  assert.equal(PACK_VINTAGE, 2021);
});


// ── Reading the archive ─────────────────────────────────────────────────────

/** A minimal ZIP, so the reader is tested without a 91 MB download. */
function buildZip(members) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const raw = Buffer.from(member.body, 'utf8');
    const stored = member.store === true;
    const payload = stored ? raw : deflateRawSync(raw);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const dir = Buffer.alloc(46 + name.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    name.copy(dir, 46);
    locals.push(local, payload);
    central.push(dir);
    offset += local.length + payload.length;
  }
  const body = Buffer.concat(locals);
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, eocd]);
}

const HEADER = 'idcar_200m,idcar_1km,i_est_200,i_est_1km,lcog_geo,ind,men,men_pauv,'
  + 'men_1ind,men_prop,ind_snv,men_surf,men_coll,log_soc,ind_0_3,ind_4_5,ind_6_10,'
  + 'ind_11_17,ind_65_79,ind_80p';
const ROW = (id, km, crsRow) => `${id},${km},0,0,${crsRow},100,50,10,25,20,2500000,3000,45,5,4,2,6,8,10,5`;

test('the archive is read in place — no unzip binary, no expanded CSV', async () => {
  // A DEPLOYMENT FACT, not a preference: the staging container has no `unzip`,
  // and the first version of this script shelled out to one. The members are
  // 473 MB expanded, so they are streamed out of the archive rather than
  // written down to be read once.
  const zip = buildZip([
    {
      name: 'carreaux_200m_met.csv',
      body: `${HEADER}\n${ROW('CRS3035RES200mN2529000E3920400', 'CRS3035RES1000mN2529000E3920000', '69381')}\n`,
    },
    {
      // Stored rather than deflated, because INSEE's writer is not the only one
      // that will ever produce this archive.
      name: 'carreaux_200m_reun.csv',
      store: true,
      body: `${HEADER}\n${ROW('CRS2975RES200mN7679200E333600', 'CRS2975RES1000mN7679000E333000', '97411')}\n`,
    },
    {
      name: 'carreaux_200m_mart.csv',
      body: `${HEADER}\n${ROW('CRS5490RES200mN1609400E709000', 'CRS5490RES1000mN1609000E709000', '97209')}\n`,
    },
  ]);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'filosofi-pack-test-'));
  try {
    const zipPath = path.join(dir, 'sample.zip');
    await fsp.writeFile(zipPath, zip);
    const packDir = path.join(dir, 'pack');
    const index = await buildPackFromArchive(zipPath, packDir);

    assert.equal(index.cells[200], 3, 'one cell from each territory');
    assert.equal(index.vintage, PACK_VINTAGE);
    // The three grids land in three different shards, because the grid is part
    // of the key.
    assert.equal(Object.keys(index.bounds[200]).length, 3);
    assert.ok(Object.keys(index.bounds[200]).some((key) => key.startsWith('2975-')));
    assert.ok(Object.keys(index.bounds[200]).some((key) => key.startsWith('5490-')));
    assert.deepEqual(index.skipped, {}, 'nothing INSEE ships is skipped');
    // And the shard really is on disk, gzipped, with the grid on its cell.
    const key = Object.keys(index.bounds[200]).find((k) => k.startsWith('2975-'));
    assert.ok(fs.existsSync(shardPath(packDir, 200, key)));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('a member INSEE stopped shipping fails the build, it is not skipped', async () => {
  // The totals would come out short and look like data.
  const zip = buildZip([{ name: 'carreaux_200m_met.csv', body: `${HEADER}\n` }]);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'filosofi-pack-test-'));
  try {
    const zipPath = path.join(dir, 'sample.zip');
    await fsp.writeFile(zipPath, zip);
    await assert.rejects(
      () => buildPackFromArchive(zipPath, path.join(dir, 'pack')),
      /carreaux_200m_mart\.csv is not in/,
    );
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
