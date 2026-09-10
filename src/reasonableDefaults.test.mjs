// src/reasonableDefaults.test.mjs
//
// What the console looks like the FIRST time it opens — before any share link,
// before any stored state. The "reasonable defaults" batch (product invariant,
// 2026-08-22) moved three of them together:
//
//   1. 3D aircraft models ON, mode `proximity`.
//      Pinned in `data/layerState.test.mjs`, next to the coordinator that
//      actually decides fresh-boot layer state — including the early return that
//      makes each layer's own initializer the operative default.
//   2. Scope feather moved to 0% on 2026-08-22, 8% on 2026-08-23, a soft 11%
//      edge on 2026-08-24, and a wide 49% falloff on 2026-09-10. The hard crop
//      is still one drag away and pinned.
//   3. Detection ON for EVERY style, Normal included. It opens at Balanced @
//      50% since 2026-09-10; Dense @ 75% is still the tactical preset the
//      military styles and Contacts apply.
//   4. Detection OUTSIDE opacity 37% (2026-09-10; 1% on 08-24, 3% on 08-23, 5%
//      before), with the slider's `step` at 1 so the range around it is
//      reachable at all.
//
// The 2026-09-10 batch is one instruction — the owner's own DISPLAY panel,
// screenshotted, with "I'd like the display settings I picked here to be the
// defaults." Fade, OUTSIDE, feather and the detection profile all move from
// that single reading, which is why they move together.
//
// Each pin below has the same three parts, because a default is never one
// literal:
//
//   • the first-run VALUE, at every surface that independently decides it — a
//     fresh boot runs no restore, so these literals ARE the startup state and
//     changing one alone ships a UI that disagrees with its own engine;
//   • explicit state still WINS over it — a link, or the operator's own hand,
//     because "default" means "what you get when you said nothing";
//   • the surrounding override machinery is INTACT, so a default flip cannot
//     quietly take a separate landed behaviour with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  KEYHOLE_OUTER_RADIUS,
  KEYHOLE_OUTSIDE_OPACITY_DEFAULT,
  KEYHOLE_LABEL_FEATHER_RATIO,
  KEYHOLE_LABEL_FEATHER_MAX_RATIO,
} from './celestialRing.js';
import {
  AIRCRAFT_BRACKET_FLOOR_ANCHOR,
  canonicalizeDensity,
  defaultDensityForProfile,
  profileForDensity,
} from './data/detectionPolicy.js';
import {
  SCOPE_FEATHER_RATIO_DEFAULT,
  getScopeMaskFeather,
  scopeMaskGeometry,
  setScopeMaskFeather,
} from './scopeMask.js';
import { ShareLinkManager } from './sharelink.js';

const uiSource = fs.readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const shareSource = fs.readFileSync(new URL('./sharelink.js', import.meta.url), 'utf8');

/** Slice ui.js between two literal anchors, so a pin reads one method, not the file. */
function uiBlock(start, end) {
  const startIndex = uiSource.indexOf(start);
  assert.ok(startIndex >= 0, `missing source anchor: ${start}`);
  const endIndex = uiSource.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing source anchor: ${end}`);
  return uiSource.slice(startIndex, endIndex);
}

/** A ShareLinkManager over a synthetic hash — enough surface for parseInitialHash. */
function managerForHash(hash) {
  globalThis.window = { location: { hash, href: `http://localhost/${hash}` } };
  globalThis.history = { replaceState(_s, _t, next) { window.location.hash = next; } };
  const viewer = {
    camera: {
      changed: { addEventListener() {} },
      positionCartographic: { latitude: 0, longitude: 0, height: 1000 },
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
    },
  };
  return new ShareLinkManager(viewer);
}

// ---------------------------------------------------------------------------
// 2. Scope feather — a subtle soft edge on a first run
// ---------------------------------------------------------------------------

test('first run opens with a wide scope feather, at every surface that decides it', () => {
  assert.equal(SCOPE_FEATHER_RATIO_DEFAULT, 0.49,
    '2026-09-10, superseding the 08-24 11%, the 08-23 8% and the 08-22 hard crop');
  assert.equal(getScopeMaskFeather(), 0.49,
    'and the live module starts there, not merely documents it');

  // The slider and its readout are the same default rendered as markup — a
  // fresh boot applies no restore, so a stale value here would show one number
  // over a mask drawn at another.
  assert.match(indexHtml, /id="scope-feather-slider"[^>]*\svalue="49"/,
    'index.html: the feather slider ships at 49');
  assert.match(indexHtml, /id="scope-feather-value"[^>]*>49%</,
    'index.html: and its readout agrees with the handle');

  // The link this session generates must describe the mask this session draws,
  // for the window before the first _syncShareState.
  assert.match(shareSource, /this\._scopeFeatherPct = 49;/,
    'sharelink.js: the generator starts from the same value the mask starts at');
});

test('an explicit feather still wins over the wide default', () => {
  // A link is authored state. The new default governs a session that said
  // nothing; it must never overwrite one that said something.
  assert.equal(managerForHash('#lat=10&lon=20&scf=35').parseInitialHash().scopeFeatherPct, 35);
  assert.equal(managerForHash('#lat=10&lon=20&scf=64').parseInitialHash().scopeFeatherPct, 64);
  assert.equal(managerForHash('#lat=10&lon=20&scf=0').parseInitialHash().scopeFeatherPct, 0,
    'an explicit 0 is a choice too, not an absent field');

  // A link from before `scf` existed still restores what ITS author saw, which
  // is the retired 35 — parsing an archive is not the same question as booting
  // fresh, and this deliberately did NOT move with either later default.
  assert.equal(managerForHash('#lat=10&lon=20&style=normal').parseInitialHash().scopeFeatherPct, 35,
    'a pre-scf link restores the author\'s view, not the new default');
});

test('the wide default did not weaken the feather control, and 0 is still reachable', () => {
  // The cheap way to move a default would be to nerf the control. Prove the
  // slider still spans its full range and the geometry is still DERIVED from
  // the ratio — a check that would pass vacuously if it only ever saw one value.
  assert.match(indexHtml, /id="scope-feather-slider"[^>]*\smin="0"[^>]*\smax="100"/,
    'the slider still offers the whole range');
  const previous = getScopeMaskFeather();
  try {
    for (const ratio of [0.35, 0.7, 1]) {
      setScopeMaskFeather(ratio);
      const geo = scopeMaskGeometry(1200, 900);
      const keyholeR = 900 * 0.5 * KEYHOLE_OUTER_RADIUS;
      assert.ok(Math.abs((geo.outerR - geo.innerR) - keyholeR * ratio) < 1e-9,
        `feather ${ratio} must still widen the band to that fraction of the keyhole`);
    }
    // The new default is a real, narrow band — not the hard crop, and nowhere
    // near the retired 35 % halo.
    setScopeMaskFeather(SCOPE_FEATHER_RATIO_DEFAULT);
    const soft = scopeMaskGeometry(1200, 900);
    const keyholeR = 900 * 0.5 * KEYHOLE_OUTER_RADIUS;
    assert.ok(Math.abs((soft.outerR - soft.innerR) - keyholeR * SCOPE_FEATHER_RATIO_DEFAULT) < 1e-9,
      'the default really draws its own band, derived from the ratio');
    assert.ok(soft.outerR > soft.innerR, 'and it is a band, not a hard edge');
    // The hard crop the previous default shipped is still one drag away.
    setScopeMaskFeather(0);
    const hard = scopeMaskGeometry(1200, 900);
    assert.equal(hard.outerR, hard.innerR,
      'an explicit 0 is still the hard crop — the path was not removed with the default');
  } finally {
    setScopeMaskFeather(previous);
  }
});

// ---------------------------------------------------------------------------
// 2c. Detection Fade — 24% on a first run, at every surface that decides it
// (2026-09-10; 7% on 08-24, 16% before). Fade is the label/card fading
// band around the keyhole — a different control from the scope-mask feather.
test('first run opens at 24% detection fade, at every surface that decides it', () => {
  assert.equal(KEYHOLE_LABEL_FEATHER_RATIO, 0.24,
    'celestialRing.js: the engine fade band opens at 24%');
  assert.match(uiSource, /detectionFadePct: 24,/,
    'ui.js: the global post defaults apply the same value on first load');
  assert.match(indexHtml, /id="detection-fade-slider"[^>]*\svalue="24"/,
    'index.html: the fade slider ships at 24');
  assert.match(indexHtml, /id="detection-fade-value"[^>]*>24%</,
    'index.html: the fade readout agrees with the slider');
  assert.match(shareSource, /this\._detectionFadePct = 24;/,
    'sharelink.js: the generator starts from the same value the overlay draws');
  // The band is a fraction of the keyhole radius and the slider caps at 40, so
  // the new default has to sit inside the range the engine will honour.
  assert.ok(KEYHOLE_LABEL_FEATHER_RATIO < KEYHOLE_LABEL_FEATHER_MAX_RATIO,
    'the default fade stays under the engine ceiling it is clamped to');
  assert.match(indexHtml, /id="detection-fade-slider"[^>]*\smax="40"/,
    'index.html: and the handle can still reach it');
});

// 2b. Detection OUTSIDE opacity — 1% on a first run
// ---------------------------------------------------------------------------

test('first run opens at 37% OUTSIDE opacity, at every surface that decides it', () => {
  assert.equal(KEYHOLE_OUTSIDE_OPACITY_DEFAULT, 0.37,
    '2026-09-10: the world beyond the keyhole stays readable rather than erased');

  // Four independent literals decide this on a fresh boot: the engine constant
  // above, the markup and its readout, ui.js's global post defaults, and the
  // share generator's starting state. Changing one alone ships a UI that
  // disagrees with its own engine.
  assert.match(indexHtml, /id="detection-opacity-slider"[^>]*\svalue="37"/,
    'index.html: the OUTSIDE slider ships at 37');
  assert.match(indexHtml, /id="detection-opacity-value"[^>]*>37%</,
    'index.html: and its readout agrees with the handle');
  assert.match(uiSource, /detectionOutsideOpacityPct: 37,/,
    'ui.js: the global post defaults apply the same value on first load');
  assert.match(shareSource, /this\._detectionOutsideOpacityPct = 37;/,
    'sharelink.js: the generator starts from the same value the overlay draws');

  // The bracket floor is calibrated AT the default, so it moves with it — the
  // approval attaches to the bracket brightness, not to the slider position.
  assert.equal(AIRCRAFT_BRACKET_FLOOR_ANCHOR, KEYHOLE_OUTSIDE_OPACITY_DEFAULT,
    'the AIR bracket floor anchor tracks the default it calibrates against');

  // Reachability: the mapping was always continuous, but at the previous step
  // of 5 the whole sub-default range was one stop wide.
  assert.match(indexHtml, /id="detection-opacity-slider"[^>]*\sstep="1"/,
    'index.html: every integer percent is reachable from the handle');
});

test('an explicit OUTSIDE opacity still wins over the readable default', () => {
  assert.equal(managerForHash('#lat=10&lon=20&ko=5').parseInitialHash().detectionOutsideOpacityPct, 5);
  assert.equal(managerForHash('#lat=10&lon=20&ko=40').parseInitialHash().detectionOutsideOpacityPct, 40);
  assert.equal(managerForHash('#lat=10&lon=20&ko=0').parseInitialHash().detectionOutsideOpacityPct, 0,
    'an explicit 0 is a choice too, not an absent field');

  // A link from before `ko` existed restores what ITS author saw. Every link
  // since carries the field explicitly, so the 5% era is unaffected either way.
  assert.equal(managerForHash('#lat=10&lon=20&style=normal').parseInitialHash().detectionOutsideOpacityPct, 5,
    'a pre-ko link restores the author\'s view, not the new default');
});

// ---------------------------------------------------------------------------
// 3. Detection — on for every style on a first run, Normal included
// ---------------------------------------------------------------------------

test('first run opens with detection on at Balanced @ 50%, from its own preset', () => {
  // Normal used to start OFF while only CRT/NVG/FLIR auto-applied a preset.
  // Detection is now on for all of them; what a FIRST RUN opens at is its own
  // frozen object since 2026-09-10, read off the owner's console. The tactical
  // Dense @ 75% did not move — it is still what the military styles and
  // Contacts apply — so the two looks can now differ without either drifting.
  assert.match(uiSource, /const FIRST_RUN_DETECTION_PRESET = Object\.freeze\(\{ mode: 'balanced', densityPct: 50 \}\);/,
    'a first run opens at Balanced @ 50%');
  assert.match(uiSource, /const MILITARY_DETECTION_PRESET = Object\.freeze\(\{ mode: 'dense', densityPct: 75 \}\);/,
    'and the tactical look is still Dense @ 75%');
  const baseline = uiBlock('const GLOBAL_POST_DEFAULTS = {', '\n};');
  assert.match(baseline, /detectionMode: FIRST_RUN_DETECTION_PRESET\.mode\.toUpperCase\(\),/,
    'the first-load baseline reads the preset rather than restating it');
  assert.match(baseline, /detectionDensity: FIRST_RUN_DETECTION_PRESET\.densityPct,/,
    'density comes from the same object, so the two cannot drift');
  assert.doesNotMatch(baseline, /detectionMode: 'OFF'/,
    'the retired OFF baseline is gone, not shadowed');

  // 50 is a canonical stop and it really is the Balanced profile — a baseline
  // that named a mode the density did not imply would be re-derived away by
  // `_applyDetectionDensityFromUi` on the very next slider read.
  assert.equal(canonicalizeDensity(50), 50, '50 is one of the five approved stops');
  assert.equal(profileForDensity(50), 'BALANCED', 'and the stop and the mode agree');
  assert.equal(defaultDensityForProfile('BALANCED'), 50,
    'so the profile round-trips back to the same density');

  // The markup and the engine already sat at 50; the baseline is what used to
  // overwrite them with 75 on every boot. Pinned so they stay one number.
  assert.match(indexHtml, /id="detection-density-slider"[^>]*\svalue="50"/,
    'index.html: the density slider ships at the same stop the baseline applies');
  assert.match(indexHtml, /id="detection-density-value"[^>]*>50%</,
    'index.html: and its readout agrees with the handle');

  // `const` has no hoisted value: the baseline can only READ the preset if the
  // preset is declared first. Getting this backwards is a startup TDZ crash,
  // which no other test in the suite would reach.
  assert.ok(
    uiSource.indexOf('const FIRST_RUN_DETECTION_PRESET =')
      < uiSource.indexOf('const GLOBAL_POST_DEFAULTS ='),
    'FIRST_RUN_DETECTION_PRESET must be declared before the baseline that reads it',
  );
});

test('the tactical preset is still what the military styles and Contacts apply', () => {
  // Splitting the first-run look out of MILITARY_DETECTION_PRESET must not
  // quietly take the tactical look with it: the three military styles and the
  // Contacts context mode all still reach for the Dense @ 75% object, and the
  // first-run object is used by the baseline and nowhere else.
  const stylePresets = uiBlock('const STYLE_PRESET_DEFAULTS = {', '\n};');
  assert.equal((stylePresets.match(/detection: MILITARY_DETECTION_PRESET,/g) || []).length, 3,
    'retro, surveillance and thermal each still apply the tactical preset');
  assert.match(uiSource, /applyPreset: \(\) => this\._applyDetectionPreset\(MILITARY_DETECTION_PRESET\)/,
    'Contacts still forces the tactical preset while it owns detection');
  assert.equal((uiSource.match(/FIRST_RUN_DETECTION_PRESET\./g) || []).length, 2,
    'the first-run preset is read twice — mode and density — and nowhere else');
  assert.doesNotMatch(stylePresets, /FIRST_RUN_DETECTION_PRESET/,
    'and no style preset reaches for the first-run look');
});

test('detection-on-by-default is a default, not an operator override', () => {
  // `_detectionUserOverridden` means the OPERATOR hand-edited detection, and it
  // suppresses the military-style auto-enable for the rest of the session.
  // A factory default is not that. If applying the baseline set the flag, a
  // fresh session would silently lose the style auto-enable behaviour — a
  // separate landed feature, taken out by an unrelated change.
  const applyDefaults = uiBlock('  _applyGlobalPostDefaults() {', '\n  }\n');
  assert.match(applyDefaults, /this\._setDetectionMode\(defaults\.detectionMode\)/,
    'the baseline still goes through the real detection path');
  assert.doesNotMatch(applyDefaults, /_detectionUserOverridden/,
    'applying a factory default must not impersonate an operator edit');

  // And the two halves of the override machinery are still wired: the style
  // preset consults the flag, and the detection button sets it.
  assert.match(uiSource, /if \(preset\.detection && !this\._detectionUserOverridden\) \{/,
    'a style preset still yields to an operator who changed detection by hand');
  const detectionButton = uiBlock("this._detectionBtn.addEventListener('click'", 'cycleDetectionMode()');
  assert.match(detectionButton, /this\._detectionUserOverridden = true;/,
    'and the detection control still claims the override when the operator uses it');

  // Style-switch semantics are unchanged: Normal is still not a preset owner,
  // so switching TO Normal does not re-apply or clear anything.
  const stylePresets = uiBlock('const STYLE_PRESET_DEFAULTS = {', '\n};');
  for (const style of ['retro', 'surveillance', 'thermal']) {
    assert.match(stylePresets, new RegExp(`\\n  ${style}: \\{`),
      `${style} still carries its own preset`);
  }
  assert.doesNotMatch(stylePresets, /\n  normal: \{/,
    'Normal gained a default, not a style preset — switching to it still touches nothing');
});

test('a share link that carries detection OFF still restores OFF', () => {
  // Same rule as the feather: the default governs a session that said nothing.
  const off = managerForHash('#lat=10&lon=20&dm=OFF&dd=50').parseInitialHash();
  assert.equal(off.detectionMode, 'OFF', 'an explicit OFF survives the default flip');

  const sparse = managerForHash('#lat=10&lon=20&dm=SPARSE&dd=25').parseInitialHash();
  assert.equal(sparse.detectionMode, 'SPARSE');
  assert.equal(sparse.detectionDensity, 25,
    'and a quieter explicit profile is not promoted to the new default');

  const dense = managerForHash('#lat=10&lon=20&dm=DENSE&dd=75').parseInitialHash();
  assert.equal(dense.detectionMode, 'DENSE');
  assert.equal(dense.detectionDensity, 75);
});
