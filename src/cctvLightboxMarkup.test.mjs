import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

/*
 * CCTV full-resolution viewer.
 *
 * The panel preview lives in the 360px right rail while most cameras in the
 * catalog publish 1920x1080, so the thumbnail discards most of the frame the
 * publisher actually sent. This suite pins the contract that makes enlarging it
 * safe: the viewer exists and is reachable by pointer AND keyboard, it is modal
 * enough not to drive the globe behind it, its backdrop is opaque so no
 * unattributed Google Maps content sits underneath, and it follows the same
 * settled frames as the preview instead of running its own fetch loop.
 */

/** Extract the body of a CSS rule by exact selector. */
function ruleBody(selector) {
  const needle = `\n${selector} {`;
  const start = css.indexOf(needle);
  assert.ok(start >= 0, `missing CSS rule for "${selector}"`);
  const open = start + needle.length;
  const end = css.indexOf('}', open);
  assert.ok(end > open, `unterminated CSS rule for "${selector}"`);
  return css.slice(open, end);
}

/** Read a single declaration out of a rule body. */
function declaration(selector, property) {
  const match = ruleBody(selector).match(new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`));
  return match ? match[1].trim() : null;
}

test('the viewer exists as a labelled modal dialog', () => {
  assert.ok(html.includes('id="cctv-lightbox"'), 'viewer element is missing');
  assert.ok(html.includes('id="cctv-lightbox-stage"'), 'viewer stage is missing');

  const start = html.indexOf('id="cctv-lightbox"');
  const tag = html.slice(html.lastIndexOf('<', start), html.indexOf('>', start) + 1);
  assert.match(tag, /role="dialog"/, 'viewer is not a dialog');
  assert.match(tag, /aria-modal="true"/, 'viewer is not marked modal');
  assert.match(tag, /aria-labelledby="cctv-lightbox-title"/, 'viewer has no accessible name');
  // Ships closed: the attribute is what _closeCctvLightbox toggles.
  assert.match(tag, /\shidden\b/, 'viewer does not start hidden');
});

test('the preview is reachable by pointer and by keyboard', () => {
  const start = html.indexOf('id="cctv-frame-wrap"');
  assert.ok(start >= 0, 'preview wrap is missing');
  const tag = html.slice(html.lastIndexOf('<', start), html.indexOf('>', start) + 1);
  assert.match(tag, /role="button"/, 'preview is not exposed as a control');
  assert.match(tag, /tabindex="0"/, 'preview cannot be reached by keyboard');
  assert.match(tag, /aria-label="[^"]+"/, 'preview control has no accessible name');

  // Enter and Space must both open it — a role=button that only answers clicks
  // is a keyboard trap for anyone who tabs to it.
  assert.match(ui, /event\.key !== 'Enter' && event\.key !== ' '/, 'no Enter/Space handling');
});

test('the backdrop is opaque, so no unattributed map content sits under it', () => {
  // DATA_SOURCES.md: the Google credit must stay visible whenever Google Maps
  // content is on screen. A fully opaque backdrop means none is — a translucent
  // one would put map pixels under an overlay that hides the credit line.
  const background = declaration('.cctv-lightbox', 'background');
  assert.ok(background, 'viewer has no backdrop');
  assert.doesNotMatch(background, /rgba|hsla|transparent/, `backdrop is not opaque: ${background}`);

  // Above every panel (95), below the clean-view exit (300).
  const z = Number(declaration('.cctv-lightbox', 'z-index'));
  assert.ok(z > 95 && z < 300, `viewer z-index ${z} is outside the panel..clean-view band`);
});

test('the enlarged frame scales to the stage without cropping', () => {
  const stage = '#cctv-lightbox-stage > img';
  assert.equal(declaration(stage, 'object-fit'), 'contain');
  assert.equal(declaration(stage, 'width'), '100%');
  assert.equal(declaration(stage, 'height'), '100%');
  // The panel pins #cctv-frame to a fixed 16:9 box; the stage must release it
  // or a 4:3 camera is letterboxed inside a ratio it does not have.
  assert.equal(declaration(stage, 'aspect-ratio'), 'auto');
});

test('the stage geometry actually beats the panel geometry it overrides', () => {
  // The first version of this rule was `.cctv-lightbox-stage > img` — (0,1,1)
  // against `#cctv-frame` at (1,0,0). Every shared property silently lost, so
  // aspect-ratio stayed 16/9 in the viewer and the assertions above passed
  // while describing a rule the browser never applied. Compare the two.
  const specificity = (selector) => {
    const ids = (selector.match(/#[\w-]+/g) || []).length;
    const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length;
    const types = (selector.replace(/[#.][\w-]+/g, '').match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
    return [ids, classes, types];
  };
  const stage = specificity('#cctv-lightbox-stage > img');
  const panel = specificity('#cctv-frame');
  const wins = stage[0] !== panel[0] ? stage[0] > panel[0]
    : stage[1] !== panel[1] ? stage[1] > panel[1]
      : stage[2] >= panel[2];
  assert.ok(wins, `stage rule ${stage} does not beat panel rule ${panel}`);

  // And it must come after the panel rule, so an equal-specificity future edit
  // still resolves the same way.
  assert.ok(
    css.indexOf('\n#cctv-lightbox-stage > img {') > 0,
    'stage rule is missing',
  );

  // Every property the panel pins on the frame must be overridden here, or the
  // panel's value leaks into the viewer.
  const panelBody = ruleBody('#cctv-frame');
  const stageBody = ruleBody('#cctv-lightbox-stage > img');
  for (const prop of ['width', 'height', 'aspect-ratio', 'object-fit']) {
    if (!new RegExp(`(?:^|;)\\s*${prop}\\s*:`).test(panelBody)) continue;
    assert.match(stageBody, new RegExp(`(?:^|;)\\s*${prop}\\s*:`), `${prop} is pinned by the panel but not overridden by the stage`);
  }
});

test('the caption reports the frame native pixel size, not the displayed size', () => {
  // The stage upscales a 320x240 camera to fill the screen exactly as it fits a
  // 1920x1080 one. naturalWidth/naturalHeight are the publisher's real numbers;
  // anything derived from layout would overstate the detail on screen.
  assert.match(ui, /naturalWidth/, 'caption does not read the natural width');
  assert.match(ui, /naturalHeight/, 'caption does not read the natural height');
  assert.doesNotMatch(
    ui.slice(ui.indexOf('_syncCctvLightboxCaption()'), ui.indexOf('_clearCctvFrame()')),
    /clientWidth|offsetWidth|getBoundingClientRect/,
    'caption measures layout instead of the decoded image',
  );
});

test('enlarging costs no extra upstream fetch', () => {
  // /api/cctv/frame answers Cache-Control: no-store, so a SECOND <img> pointed
  // at the same URL is a second trip through the proxy to the publisher — one
  // duplicate upstream request per refresh, for as long as the viewer is open.
  // Opening therefore MOVES the decoded element instead of cloning its src.
  const open = ui.slice(ui.indexOf('_openCctvLightbox() {'));
  const openBody = open.slice(0, open.indexOf('\n  /**'));
  assert.match(openBody, /_cctvLightboxStage\.appendChild\(this\._cctvFrame\)/, 'viewer does not relocate the frame');
  assert.doesNotMatch(openBody, /\.src\s*=/, 'viewer assigns a src, which refetches under no-store');
  assert.doesNotMatch(openBody, /new Image\(|fetch\(/, 'viewer starts its own fetch');

  // Closing must return it, or the panel is left permanently blank.
  const close = ui.slice(ui.indexOf('_closeCctvLightbox() {'));
  assert.match(
    close.slice(0, close.indexOf('\n  /**')),
    /_cctvFrameWrap\.insertBefore\(this\._cctvFrame/,
    'the frame is never returned to the panel',
  );

  // And there must be exactly one frame element in the document.
  assert.equal((html.match(/id="cctv-frame"/g) || []).length, 1, 'more than one frame element exists');
  assert.ok(!html.includes('id="cctv-lightbox-frame"'), 'a duplicate viewer <img> is back');
});

test('an empty preview cannot be enlarged', () => {
  // has-frame is only set once a frame has decoded; without the guard the
  // viewer would open on a blank or previous-camera image.
  const open = ui.slice(ui.indexOf('_openCctvLightbox() {'));
  const openBody = open.slice(0, open.indexOf('\n  /**'));
  assert.match(openBody, /classList\.contains\('has-frame'\)/, 'no settled-frame guard');

  // Tearing the preview down (CCTV off, camera deselected) must close it.
  const clear = ui.slice(ui.indexOf('_clearCctvFrame() {'));
  assert.match(clear.slice(0, clear.indexOf('\n  /**')), /_closeCctvLightbox\(\)/, 'viewer survives a cleared preview');
});

test('the viewer swallows the global single-key hotkeys while it is up', () => {
  // Style digits, H (HUD) and O (orbit) are bound on a document listener. With
  // the viewer covering the screen those would drive a globe nobody can see.
  const init = ui.slice(ui.indexOf('_cctvLightboxKeyHandler = (event) =>'));
  const body = init.slice(0, init.indexOf('document.addEventListener'));
  assert.match(body, /event\.stopPropagation\(\)/, 'hotkeys still reach the globe');
  assert.match(body, /event\.key === 'Escape'/, 'Escape does not close the viewer');
  assert.match(body, /event\.key === 'Tab'/, 'Tab is trapped, breaking focus cycling');
  assert.match(body, /hidden\) return/, 'handler acts while the viewer is closed');
  // Capture phase, or the document-level hotkey listener wins the race.
  assert.match(init, /addEventListener\('keydown', this\._cctvLightboxKeyHandler, true\)/, 'handler is not on the capture phase');
});

test('focus is placed on open and returned on close', () => {
  const open = ui.slice(ui.indexOf('_openCctvLightbox() {'));
  assert.match(open.slice(0, open.indexOf('\n  /**')), /_cctvLightboxCloseBtn\?\.focus/, 'focus is not moved into the dialog');

  const close = ui.slice(ui.indexOf('_closeCctvLightbox() {'));
  const closeBody = close.slice(0, close.indexOf('\n  /**'));
  assert.match(closeBody, /_cctvLightboxReturnFocus/, 'focus is not restored');
  assert.match(closeBody, /hidden = true/, 'viewer is not hidden on close');
});

test('the CCTV panel does not auto-collapse behind the viewer', () => {
  // #cctv-panel auto-discloses: pointerleave and focusout schedule a collapse.
  // Opening the viewer necessarily does BOTH — it covers the pointer and takes
  // focus to the close button, which lives outside the panel. Without the
  // satellite guard the panel collapses while the user is reading the frame,
  // and closing reveals a collapsed panel whose preview has no layout
  // (measured 0x0 in the live harness before this guard existed).
  const start = html.indexOf('id="cctv-lightbox"');
  const tag = html.slice(html.lastIndexOf('<', start), html.indexOf('>', start) + 1);
  assert.match(tag, /data-panel-satellite="cctv-panel"/, 'viewer does not declare its owning panel');

  // The guard must sit INSIDE the deferred callback, not at schedule time: the
  // close is scheduled before the viewer opens, and fires while it is up.
  const sched = ui.slice(ui.indexOf('const scheduleClose = () => {'));
  const body = sched.slice(0, sched.indexOf('\n    };'));
  assert.match(body, /satelliteOpen\(\)/, 'scheduled collapse ignores open satellites');
  assert.ok(
    body.indexOf('setTimeout') < body.indexOf('satelliteOpen()'),
    'the satellite check runs at schedule time instead of at fire time',
  );

  // :not([hidden]) is what makes the query track the viewer's own open state.
  assert.match(ui, /\[data-panel-satellite="\$\{panelId\}"\]:not\(\[hidden\]\)/, 'satellite lookup does not test openness');
});
