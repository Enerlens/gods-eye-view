// src/data/filosofiTerritoires.test.mjs
// The view half of the national regime: joining figures to anchors, the card
// that has to keep three millésimes apart, and the legend that has to explain
// two channels a colour ramp cannot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  TERRITORY_DISC_ALPHA,
  createTerritorySelectedOverlayEntry,
  fillTerritoryCollection,
  joinTerritories,
  resolveTerritoryPickId,
  territoryChips,
  territoryDiscColor,
  territoryId,
  territoryLegend,
  territoryStats,
} from './filosofiTerritoires.js';
import {
  TERRITORY_VINTAGE,
  foldTerritoryObservations,
  resolveTerritoryMetric,
} from './filosofiTerritoiresFeed.js';

const SAMPLE = JSON.parse(
  readFileSync(new URL('./fixtures/filosofi-territoires-sample.json', import.meta.url), 'utf8'),
);
/** The shipped anchor pack — the same file the browser fetches. */
const ANCHORS = JSON.parse(
  readFileSync(new URL('./local_data/france_territoires/territoires.json', import.meta.url), 'utf8'),
);

const rows = () => [...foldTerritoryObservations(SAMPLE).values()];
const NIVEAU = resolveTerritoryMetric('niveau');

// ── The anchor pack ─────────────────────────────────────────────────────────

test('the pack anchors every territory INSEE has figures for', () => {
  // 96 métropole plus La Réunion, and 13 régions plus hers.
  assert.equal(ANCHORS.departements.length, 97);
  assert.equal(ANCHORS.regions.length, 14);
  for (const entry of [...ANCHORS.departements, ...ANCHORS.regions]) {
    assert.ok(entry.lon > -6 && entry.lon < 56, `${entry.code} longitude`);
    assert.ok(entry.lat > -22 && entry.lat < 52, `${entry.code} latitude`);
    assert.ok(entry.nom && entry.nom.length > 1);
  }
  // Every département belongs to a région that is in the pack.
  const regionCodes = new Set(ANCHORS.regions.map((r) => r.code));
  for (const dep of ANCHORS.departements) assert.ok(regionCodes.has(dep.region), dep.code);
});

test('Hauts-de-Seine is not anchored inside Paris', () => {
  // 92 is a crescent around 75, so its area centroid lands in Paris and the two
  // discs would have been drawn at one point. The builder detects that and
  // moves the anchor to the interior point farthest from the boundary.
  const dep92 = ANCHORS.departements.find((d) => d.code === '92');
  const dep75 = ANCHORS.departements.find((d) => d.code === '75');
  assert.equal(dep92.anchorMovedInside, true, 'the pack must record that it moved');
  const km = 111 * Math.hypot(
    (dep92.lon - dep75.lon) * Math.cos((dep75.lat * Math.PI) / 180),
    dep92.lat - dep75.lat,
  );
  assert.ok(km > 5, `92 and 75 are ${km.toFixed(1)} km apart, which is not enough`);
  // And it is the ONLY one that needed moving — if that ever changes, the pack
  // should be looked at rather than trusted.
  const moved = ANCHORS.departements.filter((d) => d.anchorMovedInside);
  assert.deepEqual(moved.map((d) => d.code), ['92']);
});

test('La Réunion is flagged as an anchor without an outline, never as a centroid', () => {
  const reunion = ANCHORS.departements.find((d) => d.code === '974');
  assert.equal(reunion.anchorFromCoverageBox, true);
  assert.equal(reunion.areaKm2, null, 'no outline means no area to claim');
  assert.ok(reunion.lon > 55 && reunion.lon < 56);
  assert.ok(reunion.lat < -20 && reunion.lat > -22);
});

// ── The join ────────────────────────────────────────────────────────────────

test('figures meet their anchors, and a territory with neither is reported', () => {
  const { records, unanchored } = joinTerritories(rows(), ANCHORS, 'DEP');
  assert.equal(records.length, 4);
  assert.deepEqual(unanchored, []);
  const gironde = records.find((r) => r.code === '33');
  assert.equal(gironde.nom, 'Gironde');
  assert.equal(gironde.id, territoryId('DEP', '33'));
  assert.equal(gironde.niveau, 26_820, 'the figures survive the join');
  assert.ok(Number.isFinite(gironde.lon) && Number.isFinite(gironde.lat));
  assert.equal(records.find((r) => r.code === '974').anchorFromCoverageBox, true);
});

test('a territory with no anchor is dropped and named, never drawn at a guess', () => {
  // Guadeloupe has no Filosofi CC figures and no bundled outline. If a future
  // millésime starts answering for it, this must be visible rather than
  // plotted at 0°/0° in the Gulf of Guinea.
  const { records, unanchored } = joinTerritories(
    [...rows(), { code: '971', niveau: 19_000, population: 378_561 }], ANCHORS, 'DEP',
  );
  assert.equal(records.length, 4);
  assert.deepEqual(unanchored, ['971']);
});

test('the level decides which anchor list is used', () => {
  const { records } = joinTerritories([{ code: '11', population: 12_463_000 }], ANCHORS, 'REG');
  assert.equal(records.length, 1);
  assert.equal(records[0].nom, 'Île-de-France');
  // The same code at the other level is a different place: 11 is Aude.
  const { records: asDep } = joinTerritories([{ code: '11', population: 379_648 }], ANCHORS, 'DEP');
  assert.equal(asDep[0].nom, 'Aude');
});

// ── Drawing ─────────────────────────────────────────────────────────────────

test('a disc is drawn through, not over: the colour keeps an alpha', () => {
  const [gironde] = joinTerritories(rows(), ANCHORS, 'DEP').records.filter((r) => r.code === '33');
  const color = territoryDiscColor(gironde, NIVEAU);
  assert.ok(color.alpha < 1, 'an opaque disc hides the map it is standing on');
  assert.equal(color.alpha, TERRITORY_DISC_ALPHA);
  assert.ok(color.alpha > 0.5, 'and a faint one loses the band, which is the indicator');
});

test('a territory with no value for the indicator is left out, not drawn grey', () => {
  // A grey disc among coloured ones reads as a low value. The legend counts
  // them in a row of their own instead.
  const collection = new Cesium.PointPrimitiveCollection();
  const { records } = joinTerritories([
    ...rows(),
  ], ANCHORS, 'DEP');
  const drawn = fillTerritoryCollection(collection, records, NIVEAU);
  assert.equal(drawn.length, 4);
  assert.equal(collection.length, 4);

  const blinded = records.map((r) => (r.code === '15' ? { ...r, niveau: null } : r));
  const fewer = fillTerritoryCollection(collection, blinded, NIVEAU);
  assert.equal(fewer.length, 3);
  assert.equal(collection.length, 3, 'the collection is rebuilt, not appended to');
  assert.ok(!fewer.some((r) => r.code === '15'));
});

test('a territory with no population has no disc at all', () => {
  // Size is the population. Without one there is no symbol to draw, and
  // inventing a default would be inventing a count.
  const collection = new Cesium.PointPrimitiveCollection();
  const { records } = joinTerritories(
    rows().map((r) => ({ ...r, population: r.code === '15' ? null : r.population })),
    ANCHORS, 'DEP',
  );
  const drawn = fillTerritoryCollection(collection, records, NIVEAU);
  assert.equal(drawn.length, 3);
});

// ── The card ────────────────────────────────────────────────────────────────

test('every card line carries the year its number belongs to', () => {
  // Three publishers stand behind this card and they are on 2023, 2023 and
  // 2024. Printing them as one set of facts about "now" would invite arithmetic
  // between numbers from different years.
  const [gironde] = joinTerritories(rows(), ANCHORS, 'DEP').records.filter((r) => r.code === '33');
  const card = createTerritorySelectedOverlayEntry(gironde, NIVEAU);
  assert.equal(card.title, 'Gironde (33)');
  const text = card.details.join('\n');
  assert.match(text, /recensement 2023/);
  assert.match(text, /Filosofi 2023/);
  assert.match(text, /2024/, 'the wage year');
  // The line that stops the two regimes reading as one dataset is never
  // omitted: it is the only thing on the card that explains why zooming in
  // changes the number.
  assert.match(text, /MOYENNE/);
  assert.match(text, new RegExp(String(TERRITORY_VINTAGE.carroyage)));
  assert.match(text, /MÉDIAN/, 'and this one is a median');
  assert.match(text, /PERSONNES/, 'while the grid counts households');
  assert.match(text, /Aire du disque = habitants/);
});

test('the card names the carroyage millésime the proxy would serve, not a constant', () => {
  // A deployment that builds a local 2021 pack draws 2021 while the relay is on
  // 2019. A year hard-coded in the client captions the map wrongly the moment
  // that happens — and it did, on staging, before this was read off the answer.
  const [gironde] = joinTerritories(rows(), ANCHORS, 'DEP').records.filter((r) => r.code === '33');
  const packed = createTerritorySelectedOverlayEntry(
    { ...gironde, carroyageVintage: 2021 }, NIVEAU,
  );
  assert.match(packed.details.join('\n'), /millésime 2021/);
  // And with nothing said, the relay's own millésime — never a blank.
  const relayed = createTerritorySelectedOverlayEntry(gironde, NIVEAU);
  assert.match(relayed.details.join('\n'), new RegExp(`millésime ${TERRITORY_VINTAGE.carroyage}`));
});

test('the card says when its anchor is not a centroid', () => {
  const [reunion] = joinTerritories(rows(), ANCHORS, 'DEP').records.filter((r) => r.code === '974');
  const card = createTerritorySelectedOverlayEntry(reunion, NIVEAU);
  assert.match(card.details.join('\n'), /pas de contour embarqué/);
  // And an ordinary département does not say it.
  const [gironde] = joinTerritories(rows(), ANCHORS, 'DEP').records.filter((r) => r.code === '33');
  assert.doesNotMatch(
    createTerritorySelectedOverlayEntry(gironde, NIVEAU).details.join('\n'),
    /pas de contour embarqué/,
  );
});

test('a missing indicator is stated on the card, never left blank', () => {
  const [gironde] = joinTerritories(rows(), ANCHORS, 'DEP').records.filter((r) => r.code === '33');
  const card = createTerritorySelectedOverlayEntry({ ...gironde, niveau: null }, NIVEAU);
  assert.match(card.details.join('\n'), /non publié/i);
  assert.equal(createTerritorySelectedOverlayEntry(null, NIVEAU), null);
});

test('only a territory pick is a territory pick', () => {
  const has = (id) => id === territoryId('DEP', '33');
  assert.equal(resolveTerritoryPickId({ id: territoryId('DEP', '33') }, has), territoryId('DEP', '33'));
  assert.equal(resolveTerritoryPickId({ id: { id: territoryId('DEP', '33') } }, has), territoryId('DEP', '33'));
  // A carreau id must not be answered for by the national regime, or a click on
  // the grid would open the wrong card.
  assert.equal(resolveTerritoryPickId({ id: 'filosofi:200:2531400:3918600' }, () => true), null);
  assert.equal(resolveTerritoryPickId(null, has), null);
  assert.equal(resolveTerritoryPickId({ id: territoryId('DEP', '99') }, has), null);
});

// ── The legend and the chips ────────────────────────────────────────────────

test('the legend carries the break values and the size channel', () => {
  const { records } = joinTerritories(rows(), ANCHORS, 'DEP');
  const legend = territoryLegend(NIVEAU, records, 'DEP');
  const bands = legend.filter((row) => !row.glyph);
  assert.equal(bands.length, 6, 'six bands, no unknown row when every value is published');
  assert.match(bands[0].label, /23\s?800/);
  assert.match(bands[5].label, /28\s?000/);
  assert.equal(bands.reduce((sum, row) => sum + row.count, 0), 4);

  const shapes = legend.filter((row) => row.glyph);
  assert.equal(shapes.length, 1, 'no imputation channel at this level — INSEE publishes no flag');
  assert.match(shapes[0].label, /Aire = habitants/);
  assert.equal(shapes[0].count, records.reduce((s, r) => s + r.population, 0));
  // A classed scale that does not publish its breaks cannot be read back.
  assert.match(shapes[0].blurb, /1\s?051\s?000/);
  assert.match(shapes[0].blurb, /département/);
});

test('a territory with no value gets its own legend row, not band zero', () => {
  const { records } = joinTerritories(
    rows().map((r) => (r.code === '15' ? { ...r, niveau: null } : r)), ANCHORS, 'DEP',
  );
  const legend = territoryLegend(NIVEAU, records, 'DEP');
  const unknown = legend.filter((row) => !row.glyph).at(-1);
  assert.equal(unknown.label, 'Non publié');
  assert.equal(unknown.count, 1);
  assert.match(unknown.blurb, /La Réunion/, 'and it says what the scope is');
});

test('the région legend quotes the région breaks, not the département ones', () => {
  const legend = territoryLegend(NIVEAU, [], 'REG');
  const size = legend.find((row) => row.glyph);
  assert.match(size.blurb, /5\s?992\s?000/);
  assert.match(size.blurb, /région/);
});

test('every indicator has a chip and exactly one is active', () => {
  const chips = territoryChips(resolveTerritoryMetric('gini'));
  assert.equal(chips.length, 6);
  assert.equal(chips.filter((chip) => chip.active).length, 1);
  assert.equal(chips.find((chip) => chip.active).id, 'gini');
  for (const chip of chips) {
    assert.ok(chip.title.length > 30, `${chip.id} must explain itself`);
    assert.match(chip.title, /20\d\d/, `${chip.id} must state its year in the tooltip`);
    assert.equal(chip.params.metric, chip.id);
  }
});

test('the stats line names the level and the scope it is not covering', () => {
  const { records } = joinTerritories(rows(), ANCHORS, 'DEP');
  const stats = territoryStats(records, 'DEP');
  assert.equal(stats.level, 'DEP');
  assert.equal(stats.levelLabel, 'Départements');
  assert.match(stats.scope, /Réunion/);
  assert.equal(stats.territories, 4);
  assert.equal(territoryStats(records, 'REG').levelLabel, 'Régions');
});
