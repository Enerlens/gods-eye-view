import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  accentForVesselType,
  applyVesselOverlayPolicy,
  normalizeVesselType,
  vesselOverlayCohortLimit,
  vesselTypeCss,
  vesselTypeFamily,
  vesselFamilyCss,
  VESSEL_FAMILY_LABELS,
  vesselHullFromAisDimensions,
  vesselHullFromAisMessage,
  vesselArrowScale,
  vesselArrowClamp,
  VESSEL_ARROW_MIN_LOA_M,
  VESSEL_ARROW_MAX_LOA_M,
  VESSEL_SIZE_TICKS_M,
  hullAltitudeM,
  hullOutlineOffsetsM,
  vesselSizeLegend,
  vesselChevronGlyph,
  vesselHullGlyph,
} from './vesselLabels.js';

test('normalizeVesselType maps numeric AIS codes to type families', () => {
  assert.equal(normalizeVesselType('30'), 'FISHING');
  assert.equal(normalizeVesselType('31'), 'TOWING');
  assert.equal(normalizeVesselType('35'), 'MILITARY');
  assert.equal(normalizeVesselType('36'), 'SAILING');
  assert.equal(normalizeVesselType('37'), 'PLEASURE');
  assert.equal(normalizeVesselType('40'), 'HIGH-SPEED');
  assert.equal(normalizeVesselType('50'), 'PILOT');
  assert.equal(normalizeVesselType('51'), 'SAR');
  assert.equal(normalizeVesselType('52'), 'TUG');
  assert.equal(normalizeVesselType('60'), 'PASSENGER');
  assert.equal(normalizeVesselType('71'), 'CARGO');
  assert.equal(normalizeVesselType('84'), 'TANKER');
  assert.equal(normalizeVesselType('90'), 'OTHER');
});

test('normalizeVesselType preserves text and degrades unknown codes', () => {
  assert.equal(normalizeVesselType('Crude Oil Tanker'), 'Crude Oil Tanker');
  assert.equal(normalizeVesselType('0'), '');
  assert.equal(normalizeVesselType('25'), 'OTHER');
  assert.equal(normalizeVesselType(undefined), '');
});

test('vessel type CSS and card accents stay paired', () => {
  assert.equal(vesselTypeCss('Crude Oil Tanker'), '#ffb347');
  assert.equal(vesselTypeCss('Container Ship'), '#39d5ff');
  assert.equal(vesselTypeCss('Passenger/Ferry'), '#ff7adf');
  assert.equal(vesselTypeCss('Fishing'), '#7cff9b');
  assert.equal(vesselTypeCss('Tug'), '#f7f0a3');
  assert.equal(accentForVesselType('Tanker'), '255, 179, 71');
  assert.equal(accentForVesselType('Cargo'), '57, 213, 255');
  assert.equal(accentForVesselType('Passenger'), '255, 122, 223');
  assert.equal(accentForVesselType('Fishing'), '124, 255, 155');
  assert.equal(accentForVesselType('Pilot Vessel'), '247, 240, 163');
  // A dredger belongs to no family in this palette — and it is NOT a cargo
  // ship. The unfamilied default is off the ramp entirely (CARTOGRAPHIE A1),
  // which is also the state of every vessel that broadcast no type at all.
  assert.equal(accentForVesselType('Dredger'), '154, 167, 181');
  assert.equal(vesselTypeCss(''), '#9aa7b5');
  assert.notEqual(vesselTypeCss(''), vesselTypeCss('Container Ship'));
  assert.equal(accentForVesselType('84'), '255, 179, 71');
  assert.equal(vesselTypeCss('62'), '#ff7adf');
});

test('vessel viewport cohort preserves the shipped 118px grid density', () => {
  assert.equal(vesselOverlayCohortLimit(1600, 900), 112);
  assert.equal(vesselOverlayCohortLimit(1920, 1080), 170);
  assert.equal(vesselOverlayCohortLimit(1920, 1080, 80), 80);
  assert.equal(vesselOverlayCohortLimit(10000, 10000), 900, 'the shipped row ceiling remains absolute');
  assert.equal(vesselOverlayCohortLimit(0, 1080), 0);
  assert.equal(vesselOverlayCohortLimit(1920, 1080, 0), 0);
});

test('vessel host policy uses always-on shared fade and protected selected lane', () => {
  const position = { x: 1, y: 2, z: 3 };
  const ambient = applyVesselOverlayPolicy({
    id: 'vessel:1', position, title: 'AMBIENT', gapPx: 10, selected: false,
  });
  assert.equal(ambient.variant, 'card');
  assert.equal(ambient.protected, false);
  assert.equal(ambient.collisionGroup, 'ambient-card');
  assert.equal(ambient.edgeFade, 'keyhole');
  assert.equal(ambient.maxDistance, 5_000_000);
  assert.equal(ambient.distanceFadeStartRatio, 0.7);
  assert.equal(ambient.cardStyle, 'tactical');
  assert.equal(ambient.verticalOnly, true);

  const selected = applyVesselOverlayPolicy({
    id: 'vessel:2', position, title: 'SELECTED', gapPx: 12, selected: true,
  });
  assert.equal(selected.variant, 'selected');
  assert.equal(selected.protected, true);
  assert.equal(selected.collisionGroup, 'ambient-card');
  assert.equal(selected.maxDistance, Number.POSITIVE_INFINITY);
});

test('vesselLabels cannot resurrect a dedicated renderer', async () => {
  const source = await readFile(new URL('./vesselLabels.js', import.meta.url), 'utf8');
  for (const forbidden of [
    'document.createElement',
    "createElement('canvas')",
    'postRender.addEventListener',
    'worldToWindowCoordinates',
    'requestAnimationFrame',
    "id = 'vessel-labels'",
  ]) {
    assert.equal(source.includes(forbidden), false, `dedicated renderer token returned: ${forbidden}`);
  }
});

test('the key names the family a hue stands for, including the one nobody declared', () => {
  // The unfamilied bucket is the map's most common vessel state and it had no
  // name. It is now off the family ramp, and the key says why.
  assert.equal(vesselTypeFamily('Crude Oil Tanker'), 'tanker');
  assert.equal(vesselTypeFamily('Container Ship'), 'cargo');
  assert.equal(vesselTypeFamily('Passenger/Ferry'), 'passenger');
  assert.equal(vesselTypeFamily('Fishing'), 'fishing');
  assert.equal(vesselTypeFamily('Pilot Vessel'), 'service');
  assert.equal(vesselTypeFamily(''), null, 'no declared type is no family');
  assert.equal(vesselTypeFamily('Dredger'), null, 'and neither is an unmatched one');
  // The swatch a family gets IS the hue drawn for it.
  assert.equal(vesselFamilyCss('tanker'), vesselTypeCss('Tanker'));
  assert.equal(vesselFamilyCss('cargo'), vesselTypeCss('Container Ship'));
  assert.equal(vesselFamilyCss(null), vesselTypeCss(''));
  assert.notEqual(vesselFamilyCss(null), vesselFamilyCss('cargo'));
  assert.ok(VESSEL_FAMILY_LABELS.unknown);
});

// ---------------------------------------------------------------------------
// Hull dimensions — the size channel (chantier 5)
// ---------------------------------------------------------------------------

test('AIS dimensions resolve to length overall and beam', () => {
  const hull = vesselHullFromAisDimensions(120, 80, 16, 16);
  assert.equal(hull.loaM, 200);
  assert.equal(hull.beamM, 32);
  assert.equal(hull.toBowM, 120);
  assert.equal(hull.toPortM, 16);
});

test('the all-zero dimension block is a sentinel, never a 0 m ship', () => {
  const hull = vesselHullFromAisDimensions(0, 0, 0, 0);
  assert.equal(hull.loaM, null);
  assert.equal(hull.beamM, null);
});

test('length without beam is a measured length and an unmeasurable hull', () => {
  const hull = vesselHullFromAisDimensions(60, 40, 0, 0);
  assert.equal(hull.loaM, 100);
  assert.equal(hull.beamM, null);
  assert.equal(hull.toPortM, null, 'no beam means no usable port offset');
});

test('the AIS saturation codes are refused, not measured', () => {
  // 511 = "511 m or greater" on A/B, 63 = "63 m or greater" on C/D.
  assert.equal(vesselHullFromAisDimensions(511, 100, 20, 20).loaM, null);
  assert.equal(vesselHullFromAisDimensions(100, 511, 20, 20).loaM, null);
  assert.equal(vesselHullFromAisDimensions(100, 100, 63, 20).beamM, null);
});

test('a beam wider than the hull is long is a transposition, not a barge', () => {
  const hull = vesselHullFromAisDimensions(5, 5, 20, 20);
  assert.equal(hull.loaM, 10);
  assert.equal(hull.beamM, null);
});

test('implausible and negative fields are refused', () => {
  assert.equal(vesselHullFromAisDimensions(400, 400, 20, 20).loaM, null, '800 m hull');
  assert.equal(vesselHullFromAisDimensions(-5, 50, 10, 10).loaM, null);
  assert.equal(vesselHullFromAisDimensions(1, 1, 1, 1).loaM, null, 'under the 3 m floor');
  assert.equal(vesselHullFromAisDimensions(null, null, null, null).loaM, null);
});

test('message 5 and message 24 part B both yield their dimensions', () => {
  const five = vesselHullFromAisMessage({ Dimension: { A: 100, B: 100, C: 15, D: 15 } });
  assert.equal(five.loaM, 200);
  const twentyFour = vesselHullFromAisMessage({
    ReportB: { Dimension: { A: 6, B: 6, C: 2, D: 2 } },
  });
  assert.equal(twentyFour.loaM, 12);
  assert.equal(twentyFour.beamM, 4);
  assert.equal(vesselHullFromAisMessage({}).loaM, null);
  assert.equal(vesselHullFromAisMessage(null).loaM, null);
});

test('the arrow scale puts AREA, not edge, on the length', () => {
  const two = vesselArrowScale(200);
  const eight = vesselArrowScale(800 > VESSEL_ARROW_MAX_LOA_M ? VESSEL_ARROW_MAX_LOA_M : 800);
  assert.equal(two, 1, 'the 200 m reference is scale 1.0');
  // Four times the length must be twice the edge, so the AREA is proportional.
  assert.ok(Math.abs(vesselArrowScale(400) / vesselArrowScale(100) - 2) < 1e-12);
  assert.ok(eight > 0);
  assert.equal(vesselArrowScale(null), null, 'unmeasured gets no point on the ramp');
  assert.equal(vesselArrowScale(0), null);
});

test('the ramp clamps at frozen metre bounds and says which end', () => {
  assert.equal(vesselArrowClamp(10), 'below');
  assert.equal(vesselArrowClamp(1000), 'above');
  assert.equal(vesselArrowClamp(100), null);
  assert.equal(vesselArrowClamp(null), null);
  assert.equal(vesselArrowScale(1), vesselArrowScale(VESSEL_ARROW_MIN_LOA_M));
  assert.equal(vesselArrowScale(9000), vesselArrowScale(VESSEL_ARROW_MAX_LOA_M));
});

test('the hull altitude is derived from the optics, not chosen', () => {
  // A 200 m hull reaching 10 px on a 900 px canvas at a 60 degree fovy.
  const altitude = hullAltitudeM(900, Math.PI / 3);
  assert.ok(altitude > 15000 && altitude < 16000, `got ${altitude}`);
  // Halve the canvas and the threshold halves: fewer pixels, less reach.
  assert.ok(Math.abs(hullAltitudeM(450, Math.PI / 3) - altitude / 2) < 1e-6);
  assert.equal(hullAltitudeM(0), 0);
  assert.equal(hullAltitudeM(900, 0), 0);
});

test('the hull outline is a five-point ship pointing at its heading', () => {
  const hull = { loaM: 100, beamM: 20, toBowM: 60, toPortM: 10 };
  const north = hullOutlineOffsetsM(hull, 0);
  assert.equal(north.length, 5);
  const [bowE, bowN] = north[0];
  assert.ok(Math.abs(bowE) < 1e-9, 'a northbound bow has no easting');
  assert.ok(Math.abs(bowN - 60) < 1e-9, 'the bow sits at the antenna-to-bow offset');
  // Heading east: the bow must move due east by the same 60 m.
  const east = hullOutlineOffsetsM(hull, 90);
  assert.ok(Math.abs(east[0][0] - 60) < 1e-9);
  assert.ok(Math.abs(east[0][1]) < 1e-9);
  // And starboard must then point south.
  const starboardIdx = 2;
  assert.ok(east[starboardIdx][1] < 0, 'starboard is to the south when heading east');
});

test('the hull outline refuses what it was not given', () => {
  assert.equal(hullOutlineOffsetsM({ loaM: 100, beamM: 20 }, NaN), null, 'no heading, no hull');
  assert.equal(hullOutlineOffsetsM({ loaM: 100, beamM: null }, 0), null, 'no beam, no hull');
  assert.equal(hullOutlineOffsetsM(null, 0), null);
});

test('an absent antenna offset centres the hull instead of inventing one', () => {
  const centred = hullOutlineOffsetsM({ loaM: 100, beamM: 20 }, 0);
  assert.ok(Math.abs(centred[0][1] - 50) < 1e-9, 'bow at half the length');
  assert.ok(Math.abs(centred[2][1] + 50) < 1e-9, 'stern at half the length');
});

test('the size legend publishes numbered marks and declares every refusal', () => {
  const legend = vesselSizeLegend({
    measured: 100,
    unmeasured: 400,
    clampedBelow: 12,
    clampedAbove: 1,
    hullsDrawn: 400,
    hullEligible: 460,
    hullNoHeading: 9,
    hullAltitudeM: 15588,
    hullActive: true,
  });
  const labels = legend.map((entry) => entry.label);
  for (const tick of VESSEL_SIZE_TICKS_M) {
    assert.ok(labels.some((label) => label.startsWith(String(tick))), `tick ${tick} m`);
  }
  const unmeasured = legend.find((entry) => entry.label === 'dimensions non reportées');
  assert.equal(unmeasured.count, 400);
  assert.ok(unmeasured.glyph.startsWith('data:image/svg+xml;base64,'));
  const capped = legend.find((entry) => entry.label.startsWith('Coques à l’échelle réelle'));
  assert.ok(capped.label.includes('400'));
  assert.ok(capped.label.includes('460'), 'A5 — n drawn out of N eligible');
  assert.ok(capped.blurb.includes('caméra'), 'the clipping criterion is named');
  assert.ok(legend.some((entry) => entry.label.includes('cap non reporté')));
  assert.ok(legend.some((entry) => entry.count === 12));
});

test('the size legend stays quiet about refusals that did not happen', () => {
  const legend = vesselSizeLegend({ measured: 3, unmeasured: 0, hullAltitudeM: 15588 });
  assert.ok(!legend.some((entry) => entry.label === 'dimensions non reportées'));
  assert.ok(!legend.some((entry) => entry.label.includes('cap non reporté')));
  assert.ok(legend.some((entry) => entry.label.includes('Descendre') || entry.blurb?.includes('Descendre')));
});

test('a measured and an unmeasured swatch are different glyphs', () => {
  assert.notEqual(vesselChevronGlyph(1, false), vesselChevronGlyph(1, true));
  assert.equal(vesselChevronGlyph(0.5), vesselChevronGlyph(0.5), 'cached, stable');
  assert.ok(vesselHullGlyph().startsWith('data:image/svg+xml;base64,'));
});
