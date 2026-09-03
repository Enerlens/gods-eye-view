import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  shouldExpandGlobalContextPanel,
  shouldHideCollapsedRightPanels,
} from './rightRailPolicy.js';

test('Tactical HUD hides collapsed right-rail siblings while one panel is expanded', () => {
  assert.equal(shouldHideCollapsedRightPanels({
    hudVariant: 'tactical',
    hasExpandedPanel: true,
  }), true);
});

test('collapsed launchers remain when Tactical has no expanded panel', () => {
  assert.equal(shouldHideCollapsedRightPanels({
    hudVariant: 'tactical',
    hasExpandedPanel: false,
  }), false);
});

test('other HUD layouts keep collapsed right-rail launchers visible', () => {
  assert.equal(shouldHideCollapsedRightPanels({
    hudVariant: 'minimal',
    hasExpandedPanel: true,
  }), false);
  assert.equal(shouldHideCollapsedRightPanels({
    hudVariant: 'full',
    hasExpandedPanel: true,
  }), false);
});

test('desktop Display participates in Tactical exclusivity without changing mobile Display behavior', () => {
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(ui, /const isMobile = window\.matchMedia\('\(max-width: 720px\)'\)\.matches/);
  assert.match(
    ui,
    /!panel\.classList\.contains\('collapsed'\)\s*\n\s*&& panel\.id !== 'map-legend'\s*\n\s*&& \(!isMobile \|\| panel\.id !== 'pp-toggles'\)/,
  );
  assert.doesNotMatch(
    ui,
    /panel\.id !== 'pp-toggles' && !panel\.classList\.contains\('collapsed'\)/,
  );
  assert.match(ui, /if \(exclusive && panel\.classList\.contains\('collapsed'\)\) panel\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(css, /#right-context-rail\.layout-exclusive > \[data-panel-id\]\.collapsed \{/);
});

test('explicit Contacts, Space Missions, and Cockpit actions expand Global Context after success', () => {
  for (const action of ['contacts', 'space-missions', 'cockpit']) {
    assert.equal(shouldExpandGlobalContextPanel({
      action,
      explicitUserAction: true,
      succeeded: true,
    }), true, `${action} should reveal its supporting context`);
  }
});

test('Cockpit expansion is independent of whether a track was already selected', () => {
  for (const selectedTrack of [null, 'UAL649']) {
    assert.equal(shouldExpandGlobalContextPanel({
      action: 'cockpit',
      explicitUserAction: true,
      succeeded: true,
      selectedTrack,
    }), true);
  }
});

test('restoration and programmatic replay preserve the saved Global Context collapse state', () => {
  assert.equal(shouldExpandGlobalContextPanel({
    action: 'contacts',
    explicitUserAction: false,
    succeeded: true,
  }), false);
  assert.equal(shouldExpandGlobalContextPanel({
    action: 'space-missions',
    explicitUserAction: true,
    succeeded: true,
    restoring: true,
  }), false);
});

test('failed or unrelated actions never expand Global Context', () => {
  assert.equal(shouldExpandGlobalContextPanel({
    action: 'contacts',
    explicitUserAction: true,
    succeeded: false,
  }), false, 'a failed transition must preserve the prior panel state for rollback');
  assert.equal(shouldExpandGlobalContextPanel({
    action: 'search-nearby',
    explicitUserAction: true,
    succeeded: true,
  }), false);
});

// ── The map legend is a rail member (owner call, 2026-09-03) ────────────────
//
// It used to be a fixed card in the bottom-left corner, and `style.css` turned
// it OFF outright whenever DATA LAYERS opened. With dozens of layers in that
// panel, the reader lost the key at exactly the moment they needed it. The key
// now leads the right rail, which DATA LAYERS never reaches.
//
// Seven things had to be true for that move to work; each one is a line here,
// because each one fails SILENTLY. A legend without `data-panel-id` is simply
// skipped by the layout engine; one that keeps `position: fixed` ignores the
// rail; one the rail's `pointer-events: none` reaches cannot be scrolled.

test('the legend is a first-class member of the right rail, not a floating card', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');

  // 1. The layout engine filters on `data-panel-id` and would ignore a child
  //    without it — with no error, and no legend.
  assert.match(html, /<aside id="map-legend"[^>]*data-panel-id="map-legend"/);

  // 2. It is inside the rail, and 3. it leads it: first place in the allocation
  //    order is the one place `panelStackAutoCollapseIndices` never collapses.
  const rail = html.slice(html.indexOf('<aside id="right-context-rail">'));
  assert.ok(
    rail.indexOf('id="map-legend"') < rail.indexOf('id="global-context-panel"'),
    'the legend must precede Context in the rail markup',
  );
  assert.match(
    ui,
    /stack\.prepend\(this\._mapLegend\);\s*\n\s*this\._mapLegend\.after\(this\._ppToggles\);/,
    'the rail assembly must state the order rather than inherit it from markup',
  );

  // 4. Rail members are re-declared relative; a `position: fixed` legend would
  //    float over its own rail.
  assert.match(
    css,
    /#right-context-rail > #map-legend,\n#right-context-rail > #pp-toggles,/,
  );
  const base = css.slice(css.indexOf('\n.map-legend {'), css.indexOf('\n.map-legend[hidden]'));
  assert.match(base, /position: relative;/);
  assert.doesNotMatch(base, /position: fixed;/);

  // 5. The rail sets `pointer-events: none` on itself; a member that does not
  //    take it back cannot be scrolled or collapsed.
  assert.match(base, /pointer-events: auto;/);

  // 6. `#map-legend-items` plays the scrolling `*-inner` role the other rail
  //    panels have, so the allocated height caps the panel and the list gives.
  const items = css.slice(css.indexOf('\n.map-legend-items {'), css.indexOf('\n.map-legend-key-note'));
  assert.match(items, /flex: 1 1 auto;/);
  assert.match(items, /min-height: 0;/);
  assert.match(items, /overflow-y: auto;/);
  assert.match(
    css,
    /#right-context-rail\.layout-focus > #map-legend:not\(\.collapsed\),/,
    'the legend must take the rail allocation like every other member',
  );

  // 7. The rule that switched the key off is gone — that is the whole point.
  assert.doesNotMatch(css, /body:has\(#data-panel:not\(\.collapsed\)\) \.map-legend/);
});

// Found in a browser, not in review: with three layers on, the key rendered
// 1 400 px tall in a 900 px viewport and ran off the bottom of the screen. The
// rail's allocation is written by an rAF-scheduled pass, and a Cesium scene in
// `requestRenderMode` that has gone idle produces no frames — so the frame sat
// pending and the allocation was never written. The other rail members never
// exposed this because none of them is 1 400 px tall.
test('the key is capped by CSS, not only by the rail pass that may not have run', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const base = css.slice(css.indexOf('\n.map-legend {'), css.indexOf('\n.map-legend[hidden]'));
  assert.match(
    base,
    /max-height: var\(--right-stack-max-height, 70vh\);/,
    'the key needs a height ceiling that holds with no allocation written',
  );
  // The allocation still wins when it exists: `.layout-focus` is only ever on
  // the rail once the pass has run, and the pass writes the property in the
  // same synchronous turn — so the two can never disagree across a paint.
  assert.match(
    css,
    /#right-context-rail\.layout-focus > #map-legend:not\(\.collapsed\),[\s\S]*?max-height: var\(--right-panel-allocated-height\);/,
  );
});

// Caught in a screenshot: the rail came up as a key and nothing else. Tactical
// HUD hides collapsed launchers while a panel is EXPANDED, and the key ships
// expanded — so enabling one layer took DISPLAY, CCTV and CONTEXT off screen.
test('an open key does not count as the expanded panel that hides the launchers', () => {
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /&& panel\.id !== 'map-legend'/);
  // The policy itself is unchanged — this is about what gets fed to it.
  assert.equal(shouldHideCollapsedRightPanels({
    hudVariant: 'tactical',
    hasExpandedPanel: false,
  }), false);
});

test('a legend with nothing to key does not hold the rail slot it cannot use', () => {
  // `_refreshMapLegend` sets `hidden` when no enabled layer publishes a key. A
  // `display: none` member measures 0 but would still take the LEADING
  // allocation slot — and with it the auto-collapse immunity that slot carries.
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(
    ui,
    /\[\.\.\.stack\.children\]\s*\n\s*\.filter\(\(panel\) => panel\.matches\('\[data-panel-id\]'\) && !panel\.hidden\)/,
  );
});

test('Cockpit hides the rail without taking the map key with it', () => {
  // The rail's own column is where Cockpit puts DISPLAY and RADIO, so the key
  // cannot simply stay there — it returns to the corner it held before the
  // rail adopted it. `visibility` rather than `display` is what makes that
  // possible at all: a `display: none` ancestor cannot be opted out of.
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /body\.cockpit-mode #right-context-rail \{\s*visibility: hidden;\s*\}/);
  const rule = css.slice(css.indexOf('body.cockpit-mode #right-context-rail > #map-legend'));
  const block = rule.slice(0, rule.indexOf('}'));
  assert.match(block, /visibility: visible;/);
  assert.match(block, /position: fixed;/);
  // Out of the rail's flex flow, so the allocated height must be undone too.
  assert.match(block, /flex: none;/);
  assert.match(block, /height: auto;/);
});

test('the global bloom pass is gone from the product, uniforms and all', () => {
  // The NVG and FLIR shaders each carry their OWN `bloom` uniform. Those are
  // preset parameters, not the retired post-process pass, and stay.
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const share = readFileSync(new URL('./sharelink.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /postProcessStages\.bloom|_bloomStage|setBloom\(/);
  assert.doesNotMatch(html, /id="bloom-toggle"|id="bloom-intensity-slider"/);
  assert.match(ui, /bloom: 0\.22,/, 'the NVG preset uniform must survive');
  assert.match(ui, /bloom: 0\.2,/, 'the FLIR preset uniform must survive');
  assert.match(share, /\{ key: 'bloom', token: 'b', min: 0, max: 1 \}/);
  // The pass's own share tokens stop being WRITTEN; an older link that still
  // carries them opens fine, because an unread token is simply never read.
  assert.doesNotMatch(share, /params\.set\('(?:bloom|bi|bv)'/);
  assert.doesNotMatch(share, /params\.get\('(?:bloom|bi|bv)'\)/);
});
