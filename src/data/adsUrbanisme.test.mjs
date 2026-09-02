// src/data/adsUrbanisme.test.mjs
//
// The layer draws two things that mean different things, and these pin the
// difference: a CRANE is a dossier, and the ground under it is a PLOT. Only
// one French portal publishes that ground, so most of the map has cranes and
// no wash — which has to read as "this register has no shape to give" rather
// than as "nothing here has an outline".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  ADS_MAX_MONTHS,
  LOCAL_ADS_PORTALS,
  normaliseLocalRow,
  projectAdsPermits,
} from './adsFeed.js';
import {
  ADS_WINDOWS,
  ADS_WINDOW_DEFAULT,
  adsWindowChips,
  drawAdsEmprises,
  empriseCard,
  empriseStyle,
} from './adsUrbanisme.js';

const PORTALS = JSON.parse(readFileSync(
  new URL('./fixtures/ads-portals-sample.json', import.meta.url), 'utf8',
));
const BORDEAUX = LOCAL_ADS_PORTALS.find((portal) => portal.key === 'bordeaux');
const now = () => Cesium.JulianDate.now();

/** The fixture rows, projected exactly as the proxy serves them. */
function bordeauxPayload() {
  const permits = PORTALS.bordeaux.map((row) => normaliseLocalRow(BORDEAUX, row));
  return projectAdsPermits({
    permits,
    origin: { lon: permits[0].lon, lat: permits[0].lat },
    radiusM: 200_000,
  });
}

test('a shared plot wears the loudest state on it, not the last one read', () => {
  // A chantier running right now outranks everything: it is the one fact a
  // reader on the pavement can already hear.
  assert.equal(empriseStyle([
    { state: 'termine' }, { state: 'commence' }, { state: 'accorde' },
  ]).state, 'commence');
  // A file still open at the counter outranks one already granted — it is the
  // one that can still be objected to.
  assert.equal(empriseStyle([{ state: 'accorde' }, { state: 'instruction' }]).state, 'instruction');
  // A refusal is the only state that says nothing will happen here, so it
  // never speaks for ground that also carries a live file.
  assert.equal(empriseStyle([{ state: 'refuse' }, { state: 'depose' }]).state, 'depose');
  // Ties keep the FIRST, and the payload is sorted nearest-first: a plot must
  // not change colour because two of its dossiers were re-ordered.
  const tie = [{ state: 'accorde' }, { state: 'autorise' }];
  assert.equal(empriseStyle(tie).state, 'accorde');
  assert.equal(empriseStyle([...tie].reverse()).state, 'autorise');
  assert.equal(empriseStyle(tie).color, empriseStyle([...tie].reverse()).color);
  // An unpublished state is drawn, never guessed at.
  assert.equal(empriseStyle([{ state: null }]).state, null);
  assert.equal(empriseStyle([]).state, null);
});

test('the plot card is about the land, which is what the crane cannot say', () => {
  const card = empriseCard(
    { parcels: ['281BN1091', '281BN1092', '281BN1100'], areaM2: 623 },
    [
      { kindLabel: 'Déclaration préalable', depositedOn: '2024-09-27' },
      { kindLabel: 'Déclaration préalable', depositedOn: '2026-04-19' },
      { kindLabel: 'Permis de construire', depositedOn: '2026-06-02' },
    ],
  );
  assert.equal(card.name, 'Parcelles 281BN1091, 281BN1092, 281BN1100');
  // Three markers on one coordinate are one marker to look at; the count is
  // the only place that fact is legible.
  assert.match(card.description, /3 dossiers sur cette emprise/);
  assert.match(card.description, /623 m² au sol/);
  assert.match(card.description, /2 × Déclaration préalable/);
  assert.match(card.description, /dernier dépôt le 02\/06\/2026/);
  // Said out loud because it is the exception, not the rule, in this layer.
  assert.match(card.description, /emprise publiée par Bordeaux Métropole/);

  // A single-dossier plot does not announce a count of one.
  const lone = empriseCard({ parcels: ['550AH697'], areaM2: 251 }, [
    { kindLabel: 'Permis de construire', depositedOn: '2026-06-11' },
  ]);
  assert.equal(lone.name, 'Parcelle 550AH697');
  assert.doesNotMatch(lone.description, /dossiers sur cette emprise/);

  // Long parcel lists are summarised rather than run off the card.
  const many = empriseCard({ parcels: ['a', 'b', 'c', 'd', 'e'], areaM2: 10 }, []);
  assert.equal(many.name, 'Parcelles a, b, c +2');
});

test('one plot is drawn once, however many dossiers stand on it', () => {
  const source = new Cesium.CustomDataSource('ads-test');
  const payload = bordeauxPayload();
  const drawn = drawAdsEmprises(source, payload, Cesium.ClassificationType.TERRAIN);

  // Eight fixture rows: a certificat the projection never draws, one row
  // published with no geometry, and a trio sharing one outline.
  assert.equal(drawn, 4, 'four plots');
  // Seven dossiers reach the map — eight rows less the certificat — and one of
  // them is the flagged row published with no geometry at all.
  assert.equal(payload.permits.length, 7);
  assert.equal(payload.summary.withEmprise, 6);
  const fills = source.entities.values.filter((entity) => entity.polygon);
  assert.equal(fills.length, 4, 'not one wash per dossier');

  // Translucent fills ADD: three copies of one plot paint it three times over
  // and it reads as the busiest ground on the block.
  const ids = fills.map((entity) => entity.id);
  assert.equal(new Set(ids).size, ids.length, 'no two fills claim one id');
});

test('the wash is clamped to the ground, or it floats over the photograph', () => {
  const source = new Cesium.CustomDataSource('ads-test');
  drawAdsEmprises(source, bordeauxPayload(), Cesium.ClassificationType.CESIUM_3D_TILE);
  const fill = source.entities.values.find((entity) => entity.polygon);
  assert.equal(
    fill.polygon.classificationType.getValue(now()),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  // A clamped polygon cannot stroke itself in Cesium — `outline: true` is
  // ignored once it is classified — so the boundary is its own polyline.
  assert.equal(fill.polygon.outline.getValue(now()), false);
  const strokes = source.entities.values.filter((entity) => entity.polyline);
  assert.ok(strokes.length >= 4);
  for (const stroke of strokes) {
    assert.equal(stroke.polyline.clampToGround.getValue(now()), true);
  }
});

test('the middle of a plot opens the same card as its edge', () => {
  const source = new Cesium.CustomDataSource('ads-test');
  drawAdsEmprises(source, bordeauxPayload(), Cesium.ClassificationType.TERRAIN);
  const fill = source.entities.values.find((entity) => entity.polygon);
  // `cardFromEntity` needs a position, and a polygon entity has none of its
  // own. Without this the plots draw and none of them is clickable.
  const position = fill.position.getValue(now());
  assert.ok(position, 'the fill carries its own card anchor');
  const carto = Cesium.Cartographic.fromCartesian(position);
  assert.ok(Number.isFinite(carto.longitude) && Number.isFinite(carto.latitude));

  const edge = source.entities.values.find(
    (entity) => entity.polyline && entity.id.startsWith(`${fill.id}:`),
  );
  // Same name and description, so a click on the boundary opens the plot's
  // card rather than one titled with an entity id.
  assert.equal(edge.name, fill.name);
  assert.equal(edge.description.getValue(now()), fill.description.getValue(now()));
});

test('a hole in a plot is a hole, not ground', () => {
  // The trio's outline carries an inner ring the publisher flagged and this
  // repo keeps, because it is genuinely inside the parcel.
  const source = new Cesium.CustomDataSource('ads-test');
  const payload = bordeauxPayload();
  drawAdsEmprises(source, payload, Cesium.ClassificationType.TERRAIN);
  const withHole = source.entities.values.filter((entity) => entity.polygon)
    .find((entity) => entity.polygon.hierarchy.getValue(now()).holes.length > 0);
  assert.ok(withHole, 'the shared plot keeps its inner ring');
  const hierarchy = withHole.polygon.hierarchy.getValue(now());
  assert.equal(hierarchy.holes.length, 1);
  // Every ring is stroked, interior ones included: the boundary is the part
  // that survives being small.
  const rings = source.entities.values.filter(
    (entity) => entity.polyline && entity.id.startsWith(`${withHole.id}:`),
  );
  assert.equal(rings.length, 2, 'the outer ring and the hole');
});

test('a plot whose every dossier fell outside the cut is not drawn', () => {
  // Ground with no crane on it reads as a permit whose card will not open.
  const source = new Cesium.CustomDataSource('ads-test');
  const drawn = drawAdsEmprises(source, {
    permits: [],
    emprises: [{
      id: 0,
      parts: [[[[-0.6, 44.8], [-0.6, 44.801], [-0.599, 44.801], [-0.599, 44.8]]]],
      anchor: { lon: -0.5995, lat: 44.8005 },
      areaM2: 8000,
      parcels: ['063KN138'],
    }],
  }, Cesium.ClassificationType.TERRAIN);
  assert.equal(drawn, 0);
  assert.equal(source.entities.values.length, 0);

  // And a payload from a register with no shapes at all draws no ground.
  assert.equal(drawAdsEmprises(source, { permits: [] }, Cesium.ClassificationType.BOTH), 0);
});

test('the three windows are the register`s own span, and the middle one is not decoration', () => {
  assert.deepEqual(ADS_WINDOWS.map((window) => window.months), ['36', '72', '156']);
  // 36 stays the default — nobody who touches nothing sees a different map.
  assert.equal(ADS_WINDOW_DEFAULT, '36');
  // 156 is Sitadel's whole span and the proxy's own ceiling; a fourth rung
  // beyond it would be a window the register cannot fill.
  assert.equal(ADS_WINDOWS.at(-1).months, String(ADS_MAX_MONTHS));
  // And 72 exists because a finished house outlives the window that shows it:
  // Ustaritz's `06454721B0009` was authorised 2021-07-20 and read 2026-09, so
  // 36 months floors at 2023-09-01 and hides the permit that built it.
  const monthsSince = (2026 - 2021) * 12 + (9 - 7);
  assert.ok(Number(ADS_WINDOWS[0].months) < monthsSince, 'three years does not reach it');
  assert.ok(Number(ADS_WINDOWS[1].months) > monthsSince, 'six years does');
});

test('the chips mark the window in force and hand back what a click would set', () => {
  const chips = adsWindowChips('72');
  assert.deepEqual(chips.map((chip) => chip.label), ['3 ANS', '6 ANS', '13 ANS']);
  assert.deepEqual(chips.map((chip) => chip.active), [false, true, false]);
  assert.deepEqual(chips.map((chip) => chip.state), ['idle', 'active', 'idle']);
  // The chip's params must be values the layer's `runtimeParams` accepts —
  // the row control and the parameter gate are one mechanism from two ends.
  assert.deepEqual(chips.map((chip) => chip.params), [
    { months: '36' }, { months: '72' }, { months: '156' },
  ]);
});

test('a window nobody chose falls back to the default rather than lighting nothing', () => {
  const chips = adsWindowChips(null);
  assert.deepEqual(chips.map((chip) => chip.active), [true, false, false]);
  // A value from a build that offered something else lights no chip, which is
  // honest: the layer refused it too, so no chip describes what is on screen.
  assert.deepEqual(adsWindowChips('24').map((chip) => chip.active), [false, false, false]);
});

/**
 * WIDENING THE WINDOW IS WHAT CAUSES THE TRUNCATION, so the warning belongs on
 * the control that causes it. `ADS_MAX_PERMITS` serves the 400 nearest
 * dossiers: on a dense block a longer window does not add history, it TRADES
 * the far edge of the circle for it, and nothing on screen says so.
 */
test('the active chip carries the truncation the window would cause', () => {
  const truncated = adsWindowChips('156', {
    truncated: true, permitsFound: 400, permitsInRadius: 913,
  });
  assert.match(truncated[2].title, /400 dossiers servis sur 913/);
  assert.match(truncated[2].title, /les plus proches d’abord/);
  // An untruncated scan says what it found instead of warning about nothing.
  const whole = adsWindowChips('156', { truncated: false, permitsFound: 38 });
  assert.match(whole[2].title, /38 dossiers sur ce bloc/);
  // And the inactive chips describe what choosing them would mean.
  assert.match(whole[0].title, /3 dernières années/);
  assert.match(whole[1].title, /chantiers achevés compris/);
});

test('a chip title never invents a count the scan did not report', () => {
  for (const chip of adsWindowChips('36', null)) {
    assert.ok(!/\d+ dossiers/.test(chip.title), chip.title);
  }
  // A summary that arrived without a count is the same case as no summary.
  for (const chip of adsWindowChips('36', { truncated: false })) {
    assert.ok(!/\d+ dossiers/.test(chip.title), chip.title);
  }
});
