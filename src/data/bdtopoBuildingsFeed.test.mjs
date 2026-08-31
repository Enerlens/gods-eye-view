// src/data/bdtopoBuildingsFeed.test.mjs
// Pins the UPSTREAM IGN BD TOPO building schema against three real captured
// vector tiles, and the arithmetic that turns it into a placed volume.
//
// The fixture is chosen for one reason: Lyon and Paris do not publish the same
// altitudes. Lyon carries `altitude_maximale_toit` for 287 of 300 buildings;
// both Paris tiles carry it for NONE of 484, because their buildings come from
// the cadastre with an interpolated Z. Every seating rule in this file exists
// because of that split, and this test is what stops someone "simplifying" it
// back into a single rule that silently flattens Paris.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BASE_SINK_M,
  BDTOPO_MAX_BOX_DEG,
  BDTOPO_MAX_TILES,
  BDTOPO_USAGE_TIERS,
  BDTOPO_ZOOM,
  DEFAULT_HEIGHT_M,
  MAX_GROUND_CORRECTION_M,
  NO_Z_SENTINEL,
  OFFSET_MIN_SAMPLES,
  bdtopoBoxTooWide,
  bdtopoTileUrl,
  bdtopoTiles,
  bdtopoUsageTier,
  datumOffsetsByCell,
  declaredAltimetricPrecisionM,
  finiteOrNull,
  formatMetres,
  latToTileY,
  lonToTileX,
  medianOf,
  offsetCellCentre,
  offsetCellKey,
  offsetForCell,
  seatBuilding,
  summarizeBuildings,
  surveyedGroundM,
} from './bdtopoBuildingsFeed.js';

/**
 * Three real z16 tiles — Fourvière, Montmartre and La Défense — captured
 * 2026-08-31 and trimmed to one feature per distinct (usage, altimetric
 * method, has-roof-altitude, no-Z) combination, with the full per-tile counts
 * kept beside them. © IGN, Licence Ouverte 2.0.
 */
const FIXTURE = JSON.parse(readFileSync(
  new URL('./fixtures/bdtopo-batiment-sample.json', import.meta.url),
  'utf8',
));

const tileNamed = (name) => FIXTURE.tiles.find((tile) => tile.name === name);
const allFeatures = FIXTURE.tiles.flatMap((tile) => tile.features);

test('the fixture is the three tiles the seating rules were written against', () => {
  assert.equal(FIXTURE.zoom, BDTOPO_ZOOM);
  assert.deepEqual(FIXTURE.tiles.map((tile) => tile.name),
    ['lyon-fourviere', 'paris-montmartre', 'paris-la-defense']);
});

test('roof altitudes are published in Lyon and absent in Paris', () => {
  const lyon = tileNamed('lyon-fourviere').counts;
  const montmartre = tileNamed('paris-montmartre').counts;
  const defense = tileNamed('paris-la-defense').counts;

  // Lyon: nearly every building states its own roof.
  assert.ok(lyon.withRoof / lyon.total > 0.9, `Lyon roof coverage ${lyon.withRoof}/${lyon.total}`);
  assert.ok(lyon.total > 1000, 'the z15 tile carries a whole neighbourhood');
  // Paris: not one, in either tile. This is the asymmetry the layer exists around.
  assert.equal(montmartre.withRoof, 0);
  assert.equal(defense.withRoof, 0);
  // But Paris does state its floor, which is why it is still placeable.
  assert.ok(montmartre.withMinSol / montmartre.total > 0.99);
  assert.ok(defense.withMinSol / defense.total > 0.95);
});

test('the no-Z sentinel is present in the real data and is never read as a precision', () => {
  const montmartre = tileNamed('paris-montmartre');
  assert.ok(montmartre.counts.noZ > 0, 'fixture must contain buildings with no Z');

  const sentinel = allFeatures
    .map((feature) => feature.properties)
    .find((props) => Number(props.precision_altimetrique) >= NO_Z_SENTINEL);
  assert.ok(sentinel, 'fixture must carry a 9999 building');
  assert.equal(declaredAltimetricPrecisionM(sentinel), null);

  // A real precision survives untouched.
  assert.equal(declaredAltimetricPrecisionM({ precision_altimetrique: 1.5 }), 1.5);
  assert.equal(declaredAltimetricPrecisionM({}), null);
});

test('usage tiers cover the values IGN actually emits, and only those', () => {
  const usages = new Set(allFeatures.map((feature) => feature.properties.usage_1));
  for (const usage of usages) {
    const tier = bdtopoUsageTier(usage);
    assert.ok(tier, `no tier for ${usage}`);
    // Anything outside the published nomenclature must land in grey rather than
    // borrow a colour that would assert a category.
    if (tier.id === 'other') assert.ok(!BDTOPO_USAGE_TIERS.some((t) => t.usages.includes(usage)));
  }
  assert.equal(bdtopoUsageTier('Résidentiel').id, 'residential');
  assert.equal(bdtopoUsageTier('Indifférencié').id, 'other');
  assert.equal(bdtopoUsageTier(undefined).id, 'other');
});

test('seatBuilding prefers the two published altitudes, and says so', () => {
  const seat = seatBuilding(
    { altitude_minimale_sol: 287.5, altitude_maximale_toit: 298.9, hauteur: 11.2 },
    { geoidN: 49.86 },
  );
  assert.equal(seat.basis, 'published');
  // h = H + N on BOTH ends: floor and roof move together or the building shrinks.
  assert.equal(seat.topM, 298.9 + 49.86);
  assert.equal(seat.baseM, 287.5 + 49.86 - BASE_SINK_M);
  // The sink only ever lengthens the buried part.
  assert.ok(seat.topM - seat.baseM > 298.9 - 287.5);
});

test('seatBuilding falls back to floor + published height — which is all of Paris', () => {
  const paris = tileNamed('paris-montmartre').features
    .map((feature) => feature.properties)
    .find((props) => props.altitude_minimale_sol != null && props.hauteur > 0);
  assert.ok(paris, 'fixture must carry a Paris building with a floor and a height');

  const seat = seatBuilding(paris, { geoidN: 44.55 });
  assert.equal(seat.basis, 'height');
  assert.equal(seat.topM, paris.altitude_minimale_sol + 44.55 + paris.hauteur);
});

test('seatBuilding uses the rendered surface only when nothing altimetric survives', () => {
  const onSurface = seatBuilding({ hauteur: 12 }, { geoidN: 44, surfaceM: 100 });
  assert.equal(onSurface.basis, 'surface');
  assert.equal(onSurface.topM, 112);
  assert.equal(onSurface.baseM, 100 - BASE_SINK_M);

  const noHeight = seatBuilding({}, { geoidN: 44, surfaceM: 100 });
  assert.equal(noHeight.basis, 'default');
  assert.equal(noHeight.topM, 100 + DEFAULT_HEIGHT_M);
});

test('a building with neither an altitude nor a surface is refused, not invented', () => {
  const seat = seatBuilding({ hauteur: 12 }, { geoidN: 44, surfaceM: null });
  assert.ok(Number.isNaN(seat.baseM));
  assert.ok(Number.isNaN(seat.topM));
});

test('a roof altitude below the floor is not trusted over the published height', () => {
  // Real corruption mode: an inverted pair would extrude downwards.
  const seat = seatBuilding(
    { altitude_minimale_sol: 300, altitude_maximale_toit: 295, hauteur: 9 },
    { geoidN: 50 },
  );
  assert.equal(seat.basis, 'height');
  assert.equal(seat.topM, 300 + 50 + 9);
});

test('every real fixture building seats to a volume with positive height', () => {
  let placed = 0;
  for (const feature of allFeatures) {
    const seat = seatBuilding(feature.properties, { geoidN: 47, surfaceM: 80 });
    assert.ok(Number.isFinite(seat.baseM), `unplaceable base: ${feature.properties.cleabs}`);
    assert.ok(seat.topM > seat.baseM, `non-positive volume: ${feature.properties.cleabs}`);
    placed += 1;
  }
  assert.equal(placed, allFeatures.length);
});

test('the datum offset is per cell, with the viewport median as the fallback', () => {
  const offsets = datumOffsetsByCell([
    // A trusted cell: three samples, rendered surface 4 m above IGN's ground.
    { cellKey: 'A', ignM: 100, renderedM: 104 },
    { cellKey: 'A', ignM: 102, renderedM: 106 },
    { cellKey: 'A', ignM: 104, renderedM: 108 },
    // Another trusted cell, a different local error — the whole point of doing
    // this per cell rather than once for the viewport.
    { cellKey: 'B', ignM: 200, renderedM: 190 },
    { cellKey: 'B', ignM: 202, renderedM: 192 },
    { cellKey: 'B', ignM: 204, renderedM: 194 },
    // Too few samples to trust on its own.
    { cellKey: 'C', ignM: 300, renderedM: 350 },
  ]);

  assert.equal(offsets.byCell.get('A'), 4);
  assert.equal(offsets.byCell.get('B'), -10);
  assert.equal(offsets.byCell.has('C'), false);
  assert.equal(offsets.cells, 2);

  assert.equal(offsetForCell(offsets, 'A'), 4);
  assert.equal(offsetForCell(offsets, 'B'), -10);
  // C is untrusted, so it takes the viewport median of the cell medians.
  assert.equal(offsetForCell(offsets, 'C'), offsets.medianM);
  // A cell nobody sampled takes the same fallback.
  assert.equal(offsetForCell(offsets, 'Z'), offsets.medianM);
});

test('the trust threshold is the documented one', () => {
  const two = datumOffsetsByCell([
    { cellKey: 'A', ignM: 100, renderedM: 105 },
    { cellKey: 'A', ignM: 101, renderedM: 106 },
  ]);
  assert.equal(two.byCell.size, 0);

  const three = datumOffsetsByCell([
    { cellKey: 'A', ignM: 100, renderedM: 105 },
    { cellKey: 'A', ignM: 101, renderedM: 106 },
    { cellKey: 'A', ignM: 102, renderedM: 107 },
  ]);
  assert.equal(three.byCell.get('A'), 5);
  assert.equal(OFFSET_MIN_SAMPLES, 3);
});

test('a cold floor grid produces a zero offset, which is the true altitude', () => {
  const offsets = datumOffsetsByCell([
    { cellKey: 'A', ignM: 100, renderedM: null },
    { cellKey: 'B', ignM: 200, renderedM: undefined },
  ]);
  assert.equal(offsets.samples, 0);
  assert.equal(offsets.cells, 0);
  assert.equal(offsetForCell(offsets, 'A'), 0);

  // And with no offset the building sits exactly where IGN says it is.
  const seat = seatBuilding({ altitude_minimale_sol: 100, hauteur: 10 }, { geoidN: 45, offsetM: 0 });
  assert.equal(seat.topM, 155);
});

test('a volume reaches down to ground the mesh drew below the survey', () => {
  const props = { altitude_minimale_sol: 200, altitude_maximale_toit: 212 };
  // The mesh drew this spot 4 m low: without the reach, 4 m of daylight shows
  // under the walls.
  const seat = seatBuilding(props, { geoidN: 50, surfaceM: 246 });
  assert.equal(seat.baseM, 250 - 4 - BASE_SINK_M);
  // The roof it was surveyed with is untouched by the reach.
  assert.equal(seat.topM, 212 + 50);
  assert.equal(seat.basis, 'published');
});

test('a volume never loses its height into ground the mesh drew too high', () => {
  const props = { altitude_minimale_sol: 200, hauteur: 10 };
  // Rendered ground 6 m above the surveyed floor would leave 4 m of roof
  // showing; the roof rises with the ground instead.
  const seat = seatBuilding(props, { geoidN: 0, surfaceM: 206 });
  assert.equal(seat.topM, 216);
  assert.equal(seat.baseM, 200 - BASE_SINK_M);
  assert.equal(seat.basis, 'height');
});

test('the surveyed ground is the middle of the footprint, not its low corner', () => {
  // A footprint that drops 6 m across itself: its floor is the low corner, but
  // a height sampled at its centroid measures the middle. Comparing the two
  // would read 3 m of the building's own slope as terrain disagreement.
  const sloped = { altitude_minimale_sol: 200, altitude_maximale_sol: 206, hauteur: 10 };
  assert.equal(surveyedGroundM(sloped), 203);
  const seat = seatBuilding(sloped, { geoidN: 0, surfaceM: 203 });
  assert.equal(seat.gapM, 0);
  assert.equal(seat.topM, 210);
  assert.equal(seat.baseM, 200 - BASE_SINK_M);

  // Paris publishes no maximum: the floor is the whole answer, and it is flat.
  assert.equal(surveyedGroundM({ altitude_minimale_sol: 40 }), 40);
  assert.equal(surveyedGroundM({}), null);
  // An inverted pair is corruption, not a slope.
  assert.equal(surveyedGroundM({ altitude_minimale_sol: 200, altitude_maximale_sol: 190 }), 200);
});

test('ground that disagrees by more than the cap is a bad sample, not a datum', () => {
  const props = { altitude_minimale_sol: 200, altitude_maximale_toit: 210 };
  const sunk = seatBuilding(props, { geoidN: 0, surfaceM: 0 });
  // A 200 m skirt of wall is a worse artefact than the float it would hide.
  assert.equal(sunk.baseM, 200 - MAX_GROUND_CORRECTION_M - BASE_SINK_M);

  const lifted = seatBuilding(props, { geoidN: 0, surfaceM: 900 });
  assert.equal(lifted.topM, 210 + MAX_GROUND_CORRECTION_M);
});

test('ground that agrees with the survey changes nothing at all', () => {
  const props = { altitude_minimale_sol: 200, altitude_maximale_toit: 212 };
  const bare = seatBuilding(props, { geoidN: 45 });
  const grounded = seatBuilding(props, { geoidN: 45, surfaceM: 245 });
  assert.equal(grounded.baseM, bare.baseM);
  assert.equal(grounded.topM, bare.topM);
  assert.equal(grounded.basis, bare.basis);
  // Nothing to correct, and the layer says so rather than reporting no reading.
  assert.equal(grounded.gapM, 0);
  assert.equal(bare.gapM, 0);
});

test('the datum sample is the ground under the building, not the cell centre', () => {
  // Croix-Rousse, one ~1.1 km cell: the slope drops 40 m across it and the
  // globe draws it 2 m high everywhere. Sampling per building recovers the 2 m;
  // reusing the cell-centre height for every building recovers the relief
  // instead, which is what floated whole blocks over Lyon.
  const ign = [180, 200, 220];
  const rendered = ign.map((h) => h + 2);
  const perBuilding = datumOffsetsByCell(ign.map((ignM, i) => ({
    cellKey: 'croix-rousse', ignM, renderedM: rendered[i],
  })));
  assert.equal(perBuilding.byCell.get('croix-rousse'), 2);

  // The same cell measured once at its centre — here the uphill end — reads the
  // 20 m of relief between the centre and the median building as datum error.
  const cellCentre = datumOffsetsByCell(ign.map((ignM) => ({
    cellKey: 'croix-rousse', ignM, renderedM: rendered[2],
  })));
  assert.equal(cellCentre.byCell.get('croix-rousse'), 22);

  // Applied to the building at the bottom of the slope, those 20 m are 20 m of
  // daylight under its walls — the Lyon screenshot, in one number.
  const house = { altitude_minimale_sol: ign[0], hauteur: 9 };
  const floated = seatBuilding(house, {
    geoidN: 0, offsetM: offsetForCell(cellCentre, 'croix-rousse'),
  });
  assert.equal(floated.topM - rendered[0], 9 + 20);

  const seated = seatBuilding(house, {
    geoidN: 0, offsetM: offsetForCell(perBuilding, 'croix-rousse'),
  });
  assert.equal(seated.topM - rendered[0], 9);
});

test('offsets shift a building without changing its height', () => {
  const props = { altitude_minimale_sol: 100, altitude_maximale_toit: 118 };
  const flat = seatBuilding(props, { geoidN: 45 });
  const shifted = seatBuilding(props, { geoidN: 45, offsetM: -7 });
  assert.equal(shifted.topM - shifted.baseM, flat.topM - flat.baseM);
  assert.equal(shifted.topM, flat.topM - 7);
});

test('viewport gate rejects the views a building could not be seen in', () => {
  assert.equal(bdtopoBoxTooWide(null), true);
  assert.equal(bdtopoBoxTooWide({ west: 4.80, east: 4.83, south: 45.75, north: 45.77 }), false);
  // Wider than the ceiling on EITHER axis is out.
  assert.equal(bdtopoBoxTooWide({ west: 4.0, east: 5.0, south: 45.75, north: 45.77 }), true);
  assert.equal(bdtopoBoxTooWide({ west: 4.80, east: 4.83, south: 45.0, north: 46.0 }), true);
  assert.ok(BDTOPO_MAX_BOX_DEG > 0 && BDTOPO_MAX_BOX_DEG < 1);
});

test('tile cover reports overflow instead of silently trimming a city', () => {
  const small = bdtopoTiles({ west: 4.820, east: 4.826, south: 45.758, north: 45.763 });
  assert.ok(small.tiles.length >= 1);
  assert.equal(small.overflow, false);
  assert.equal(small.wanted, small.tiles.length);

  const huge = bdtopoTiles({ west: 4.0, east: 5.0, south: 45.0, north: 46.0 });
  assert.equal(huge.overflow, true);
  assert.equal(huge.tiles.length, BDTOPO_MAX_TILES);
  assert.ok(huge.wanted > BDTOPO_MAX_TILES);
});

test('tile maths lands on the tile the fixture was captured from', () => {
  for (const tile of FIXTURE.tiles) {
    // The tile's own centre, not a vertex: MVT geometry carries a buffer that
    // spills past the tile edge, so a ring corner can legitimately belong to
    // the neighbour.
    const size = 2 ** tile.z;
    const centreLon = ((tile.x + 0.5) / size) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * (tile.y + 0.5)) / size;
    const centreLat = (180 / Math.PI) * Math.atan(Math.sinh(n));
    assert.equal(lonToTileX(centreLon, tile.z), tile.x, `${tile.name} column`);
    assert.equal(latToTileY(centreLat, tile.z), tile.y, `${tile.name} row`);
    assert.equal(
      bdtopoTileUrl({ z: tile.z, x: tile.x, y: tile.y }),
      `https://data.geopf.fr/tms/1.0.0/BDTOPO/${tile.z}/${tile.x}/${tile.y}.pbf`,
    );
  }
});

test('the datum-offset grid groups a neighbourhood into one correction', () => {
  // Two buildings 300 m apart share a cell, and therefore share a datum offset.
  assert.equal(offsetCellKey(45.7605, 4.8237), offsetCellKey(45.7628, 4.8259));
  // A kilometre away is a different cell, which is the whole point of a grid.
  assert.notEqual(offsetCellKey(45.7605, 4.8237), offsetCellKey(45.7715, 4.8237));

  // The centre is the ONE point the surface is sampled at for that cell, so it
  // has to be stable for every member of the cell.
  const a = offsetCellCentre(45.7605, 4.8237);
  const b = offsetCellCentre(45.7628, 4.8259);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.lat - 45.7605) < 0.01 && Math.abs(a.lon - 4.8237) < 0.01);

  // And negative coordinates must floor, not truncate toward zero, or the
  // western DROM would fold two cells into one.
  assert.notEqual(offsetCellKey(16.24, -61.55), offsetCellKey(16.24, -61.54));
});

test('the summary counts bands, bases and dwellings without averaging them together', () => {
  const summary = summarizeBuildings([
    { tierId: 'residential', basis: 'published', dwellings: 12, heightM: 18, rnb: 'A', label: 'Résidentiel' },
    { tierId: 'residential', basis: 'height', dwellings: 4, heightM: 9, rnb: null, label: 'Résidentiel' },
    { tierId: 'other', basis: 'surface', dwellings: 0, heightM: null, rnb: 'B', label: 'Bâtiment' },
  ], { saturated: false });

  assert.equal(summary.count, 3);
  assert.equal(summary.dwellings, 16);
  assert.equal(summary.tallestM, 18);
  assert.equal(summary.tallestName, 'Résidentiel');
  assert.equal(summary.basis.published, 1);
  assert.equal(summary.basis.height, 1);
  assert.equal(summary.basis.surface, 1);
  assert.equal(summary.basis.default, 0);
  assert.ok(Math.abs(summary.heightCoverage - 2 / 3) < 1e-9);
  assert.ok(Math.abs(summary.rnbCoverage - 2 / 3) < 1e-9);
  assert.equal(summary.saturated, false);

  const residential = summary.tiers.find((tier) => tier.id === 'residential');
  assert.equal(residential.count, 2);
  // Every band is listed even at zero, so an empty band reads as "none here"
  // rather than disappearing from the legend.
  assert.equal(summary.tiers.length, BDTOPO_USAGE_TIERS.length);
  assert.equal(summary.tiers.find((tier) => tier.id === 'industrial').count, 0);
});

test('small numeric helpers behave at their edges', () => {
  assert.equal(finiteOrNull('11.2'), 11.2);
  assert.equal(finiteOrNull('abc'), null);
  // Number(null) and Number('') are both 0 — an absent height must not become
  // a zero-height building.
  assert.equal(finiteOrNull(null), null);
  assert.equal(finiteOrNull(undefined), null);
  assert.equal(finiteOrNull(''), null);
  assert.equal(finiteOrNull(0), 0);
  assert.equal(medianOf([]), null);
  assert.equal(medianOf([3, 1, 2]), 2);
  assert.equal(medianOf([4, 1, 2, 3]), 2.5);
  assert.equal(formatMetres(9.25), '9.3 m');
  assert.equal(formatMetres(245.1), '245 m');
  assert.equal(formatMetres(Number.NaN), '—');
});
