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
  SITADEL_FILES,
  normaliseLocalRow,
  normaliseSitadelRow,
  projectAdsPermits,
} from './adsFeed.js';
import adsUrbanismeLayer, {
  ADS_BUILDING_THEME_ID,
  ADS_BUILDING_THEME_LEGEND,
  ADS_BUILDING_THEME_PRECEDENCE,
  ADS_TARGET_EXISTING,
  ADS_TARGET_NEW,
  ADS_TARGET_UNKNOWN,
  ADS_WINDOWS,
  ADS_WINDOW_DEFAULT,
  adsBuildingThemeColorFor,
  adsBuildingThemeLedger,
  adsBuildingThemeLine,
  adsBuildingThemePoints,
  adsBuildingThemeReduce,
  adsPermitTarget,
  adsRowControls,
  adsWindowChips,
  clearAdsBuildingTheme,
  drawAdsEmprises,
  empriseCard,
  empriseStyle,
  syncAdsBuildingTheme,
} from './adsUrbanisme.js';
import {
  BUILDING_THEME_MIN_DELTA_E,
  buildingThemeConflicts,
  clearAllBuildingThemes,
  deltaE76,
  getActiveBuildingTheme,
  parseCssRgb,
  resolveBuildingThemePaint,
  unknownBuildingCss,
} from './buildingTheme.js';
import { BDTOPO_USAGE_TIERS } from './bdtopoBuildingsFeed.js';

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
// ── The building theme ──────────────────────────────────────────────────────
//
// The property these pin is the one the layer's whole claim rests on: painting
// a VOLUME says "this dossier is about this building", which is a stronger
// sentence than the marker's "a dossier exists here" — and it is FALSE for a
// new build on bare ground. So every test below is about what the theme
// REFUSES to say, and about the ledger that counts the refusals.

/** A square footprint centred on a coordinate, in the shape the join wants. */
function footprintAt(id, lon, lat, halfDeg = 0.00005) {
  return {
    id,
    degrees: [
      lon - halfDeg, lat - halfDeg,
      lon + halfDeg, lat - halfDeg,
      lon + halfDeg, lat + halfDeg,
      lon - halfDeg, lat + halfDeg,
    ],
    holes: [],
  };
}

const LOGEMENTS = SITADEL_FILES.find((file) => file.key === 'logements');
const AMENAGER = SITADEL_FILES.find((file) => file.key === 'amenager');
const DEMOLIR = SITADEL_FILES.find((file) => file.key === 'demolir');

test('the nature vocabulary is READ from adsFeed, not re-guessed here', () => {
  // If `adsFeed.js` ever rewords the two `NATURE_PROJET_DECLAREE` labels, this
  // test fails instead of every permit in France silently becoming "nature not
  // published" — which is the failure mode of a classifier that sniffs strings
  // and nobody pins.
  const newBuild = normaliseSitadelRow(LOGEMENTS, {
    NUM_DAU: '0441091200392', TYPE_DAU: 'PC', ETAT_DAU: 2, NATURE_PROJET_DECLAREE: 1,
  });
  const onExisting = normaliseSitadelRow(LOGEMENTS, {
    NUM_DAU: '0441091200393', TYPE_DAU: 'PC', ETAT_DAU: 5, NATURE_PROJET_DECLAREE: 2,
  });
  assert.match(newBuild.purpose, /nouvelle construction/);
  assert.match(onExisting.purpose, /travaux sur construction existante/);
  assert.equal(adsPermitTarget(newBuild), ADS_TARGET_NEW);
  assert.equal(adsPermitTarget(onExisting), ADS_TARGET_EXISTING);

  // The two files that do NOT carry the column are settled by the family, and
  // the law is what settles them: a permis d'aménager authorises the
  // development of LAND, a permis de démolir names something that stands.
  const amenager = normaliseSitadelRow(AMENAGER, { NUM_PA: '0441092600001', ETAT_PA: 2 });
  const demolir = normaliseSitadelRow(DEMOLIR, { NUM_PD: '0441092600086', ETAT_PD: 2 });
  assert.equal(amenager.kind, 'PA');
  assert.equal(demolir.kind, 'PD');
  assert.equal(adsPermitTarget(amenager), ADS_TARGET_NEW);
  assert.equal(adsPermitTarget(demolir), ADS_TARGET_EXISTING);

  // Neither Sitadel column reaches the métropole portals, so their dossiers
  // are `unknown` — the third answer, carried rather than rounded off.
  const bordeaux = normaliseLocalRow(BORDEAUX, PORTALS.bordeaux[0]);
  assert.equal(adsPermitTarget(bordeaux), ADS_TARGET_UNKNOWN);
  assert.equal(adsPermitTarget({}), ADS_TARGET_UNKNOWN);
  assert.equal(adsPermitTarget(null), ADS_TARGET_UNKNOWN);
});

test('exactly two of the seven sources publish a nature column', () => {
  // The measurement the header rests on, re-taken from the configuration
  // itself. If a fifth Sitadel file or a fourth portal arrives, this changes.
  const withNature = SITADEL_FILES
    .filter((file) => file.columns.includes('NATURE_PROJET_DECLAREE'))
    .map((file) => file.key);
  assert.deepEqual(withNature, ['logements', 'locaux']);
  assert.equal(SITADEL_FILES.length + LOCAL_ADS_PORTALS.length, 7);
  for (const portal of LOCAL_ADS_PORTALS) {
    assert.ok(!('natureColumn' in portal), `${portal.key} publishes no nature column`);
  }
});

test('a new build is withheld from the volumes, counted, and left as a crane', () => {
  const ledger = adsBuildingThemePoints({
    permits: [
      { kind: 'PC', state: 'commence', purpose: 'travaux sur construction existante', lon: 1, lat: 2 },
      { kind: 'PC', state: 'accorde', purpose: 'nouvelle construction · logements', lon: 1, lat: 2 },
      { kind: 'PA', state: 'accorde', purpose: 'lotissement', lon: 1, lat: 2 },
      { kind: 'DP', state: 'instruction', purpose: 'ravalement', lon: 1, lat: 2 },
      { kind: 'PC', state: null, purpose: 'travaux sur construction existante', lon: 1, lat: 2 },
      { kind: 'PC', state: 'accorde', purpose: 'ravalement', lon: null, lat: 2 },
    ],
  });
  assert.equal(ledger.total, 6);
  assert.equal(ledger.offered, 2, 'the works-on-existing one and the unclassified one');
  assert.equal(ledger.offeredDeclared, 1);
  assert.equal(ledger.offeredInferred, 1);
  assert.equal(ledger.newBuild, 1);
  assert.equal(ledger.land, 1, 'a permis d’aménager is about ground, not a roof');
  assert.equal(ledger.unpublishedState, 1);
  assert.equal(ledger.unplaced, 1);
  // The ledger is a PARTITION: a dossier that fell out of every bucket is the
  // one failure this ledger exists to make impossible.
  assert.equal(
    ledger.offered + ledger.newBuild + ledger.land + ledger.unpublishedState + ledger.unplaced,
    ledger.total,
  );
  assert.equal(ledger.points.length, ledger.offered);
  assert.equal(adsBuildingThemePoints(null).total, 0);
});

test('a volume carrying several dossiers wears the same state as the ground under it', () => {
  // One ranking, called through one function. If the roof and the plot could
  // disagree the street would contradict itself.
  const permits = [{ state: 'termine' }, { state: 'commence' }, { state: 'accorde' }];
  assert.equal(adsBuildingThemeReduce(permits), 'commence');
  assert.equal(adsBuildingThemeReduce(permits), empriseStyle(permits).state);
  assert.equal(adsBuildingThemeReduce([{ state: null }]), null);
});

test('an unpublished state paints no volume, because its grey is the refusal grey', () => {
  // ΔE76 11.2 between `#9fb0c6` (state not published) and `#8c93a3` (refused
  // or annulled) — 10 is where two colours stop sharing a name. On a roof the
  // reader would have no way to tell "nobody decided" from "the answer was no".
  const distance = deltaE76(parseCssRgb('#9fb0c6'), parseCssRgb('#8c93a3'));
  assert.ok(distance < 15, `measured ΔE ${distance.toFixed(1)}`);
  assert.equal(adsBuildingThemeColorFor(null), null);
  assert.equal(adsBuildingThemeColorFor('inconnu'), null);
  assert.equal(adsBuildingThemeColorFor('commence'), '#ff6b4a');
  // The two states that share a colour still share it — the legend has one row
  // per colour for exactly this reason.
  assert.equal(adsBuildingThemeColorFor('instruction'), adsBuildingThemeColorFor('depose'));
  assert.equal(adsBuildingThemeColorFor('accorde'), adsBuildingThemeColorFor('autorise'));
});

test('no painted class can be mistaken for a volume nobody filed on (A1)', () => {
  const washes = BDTOPO_USAGE_TIERS.map((tier) => unknownBuildingCss(tier.color));
  let worst = Infinity;
  for (const entry of ADS_BUILDING_THEME_LEGEND) {
    for (const wash of washes) {
      worst = Math.min(worst, deltaE76(parseCssRgb(entry.color), parseCssRgb(wash)));
    }
  }
  // Measured 28.0, on `#8c93a3` against the washed `Indifférencié` grey — the
  // tightest pair in the palette and still above the module's own bar.
  assert.ok(worst >= BUILDING_THEME_MIN_DELTA_E, `nearest class is ΔE ${worst.toFixed(1)}`);
  // And the registry's own registration-time guard has nothing to warn about.
  assert.deepEqual(
    buildingThemeConflicts(ADS_BUILDING_THEME_LEGEND.map((entry) => entry.color)),
    [],
  );
  // One row per colour, or the panel's swatch-matched counts double-claim.
  const colors = ADS_BUILDING_THEME_LEGEND.map((entry) => entry.color);
  assert.equal(new Set(colors).size, colors.length);
});

test('the theme paints the existing roof and refuses the empty plot next door', () => {
  clearAllBuildingThemes();
  const roof = footprintAt('roof', 2.35, 48.86);
  const bare = footprintAt('bare', 2.36, 48.86);
  syncAdsBuildingTheme({
    permits: [
      {
        kind: 'PC', state: 'commence', purpose: 'travaux sur construction existante',
        lon: 2.35, lat: 48.86,
      },
      // A declared new build that geocoded onto a standing roof. This is the
      // error the whole design is against: it must not paint anything.
      {
        kind: 'PC', state: 'accorde', purpose: 'nouvelle construction',
        lon: 2.36, lat: 48.86,
      },
    ],
  });
  const theme = getActiveBuildingTheme();
  assert.equal(theme.id, ADS_BUILDING_THEME_ID);
  assert.equal(theme.precedence, ADS_BUILDING_THEME_PRECEDENCE);

  const paint = resolveBuildingThemePaint([roof, bare], theme);
  assert.equal(paint.painted, 1);
  assert.equal(paint.colorById.get('roof'), '#ff6b4a');
  assert.equal(paint.colorById.has('bare'), false, 'a new build paints nothing');
  assert.equal(paint.unpainted, 1);
  // The "no data" row says which of the two silences it is (A4).
  assert.match(paint.unknownLabel, /hors du rayon de 400 m/);
  assert.match(paint.unknownLabel, /sans dossier/);
  clearAllBuildingThemes();
});

test('the theme is published on enable and withdrawn on disable', () => {
  clearAllBuildingThemes();
  // `addressScanLayer` installs and removes a keydown listener unconditionally,
  // and `node --test` has no DOM. A property of the harness, not of the layer.
  const hadDocument = 'document' in globalThis;
  if (!hadDocument) globalThis.document = { addEventListener() {}, removeEventListener() {} };
  // Registered EMPTY rather than not at all: the key, the wash and the count of
  // unpainted volumes have to appear the moment the layer is switched on.
  adsUrbanismeLayer.enable(null);
  assert.equal(getActiveBuildingTheme()?.id, ADS_BUILDING_THEME_ID);
  assert.deepEqual(getActiveBuildingTheme().points, []);
  adsUrbanismeLayer.disable();
  assert.equal(getActiveBuildingTheme(), null);
  assert.equal(adsBuildingThemeLedger(), null);
  if (!hadDocument) delete globalThis.document;
  clearAllBuildingThemes();
});

test('the row line publishes the OFFER ledger and points at the paint ledger', () => {
  const line = adsBuildingThemeLine({
    total: 12, offered: 5, offeredDeclared: 3, offeredInferred: 2,
    newBuild: 4, land: 1, unpublishedState: 2, unplaced: 0,
  });
  assert.match(line, /5 des 12 dossiers peignent le bâti 3D/);
  assert.match(line, /dont 2 sur nature non publiée/);
  assert.match(line, /4 en construction neuve/);
  assert.match(line, /1 permis d’aménager/);
  assert.match(line, /2 sans état publié/);
  // The number this layer does NOT hold, named where it lives — A5 is not
  // satisfied by a count that exists somewhere unnamed.
  assert.match(line, /Bâti 3D/);
  assert.equal(adsBuildingThemeLine(null), null);
  assert.equal(adsBuildingThemeLine({ total: 0 }), null);
});

test('the layer publishes its own colour key, including the class it will not paint', () => {
  const payload = bordeauxPayload();
  const controls = adsRowControls(payload);
  assert.equal(controls.legend.length, ADS_BUILDING_THEME_LEGEND.length + 1);
  const unpublished = controls.legend.at(-1);
  assert.equal(unpublished.label, 'État non publié');
  assert.equal(unpublished.color, '#9fb0c6');
  assert.match(unpublished.blurb, /le volume ne l’est pas/);
  // Every drawn dossier is counted exactly once across the key.
  const counted = controls.legend.reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(counted, payload.permits.length);
  // The plot wash IS a ground-classified drape, so the manager's photoreal
  // notice applies — but only where a portal published a plot.
  assert.equal(controls.surfaceFill, true);
  assert.equal(adsRowControls({ permits: [], emprises: [] }).surfaceFill, false);
});
