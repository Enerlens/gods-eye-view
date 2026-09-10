import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./datasetPlugPanel.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

/*
 * « Brancher un jeu de données » — how much of the panel it is allowed to take.
 *
 * WHAT WENT WRONG, AND WHY A TEST. Every section of this box is laid out with
 * `display: flex` from a class rule, and a class rule outranks the user agent's
 * `[hidden] { display: none }`. So the box shipped permanently open: the search
 * field, an empty draft card and its two blank column pickers were painted at
 * all times, whatever `form.hidden = true` said. Measured on a 13" laptop, that
 * was 244 px of dead form under a layer list left with 51 px — one visible
 * layer row out of thirty-nine, in a panel whose entire purpose is the list.
 *
 * Nothing in the JS was wrong and nothing looked wrong in a review of it, which
 * is exactly why this is pinned here instead: the fault only exists in the
 * cascade, between two files that are each defensible alone.
 *
 * The rest of the suite pins the three sizes that replaced it — see the THREE
 * SIZES note in datasetPlugPanel.js.
 */

/** The panel's markup template, as a string, from the module source. */
function markup() {
  const start = source.indexOf('const MARKUP = `');
  assert.ok(start >= 0, 'MARKUP template literal not found');
  const open = start + 'const MARKUP = `'.length;
  const end = source.indexOf('`;', open);
  assert.ok(end > open, 'MARKUP template literal is unterminated');
  return source.slice(open, end);
}

const MARKUP = markup();

/**
 * The [start, end) span of the element carrying `attribute`, tags included.
 * Small hand scanner rather than a parser: this markup is one literal of
 * well-formed tags, and the only question asked of it is containment.
 */
function elementSpan(attribute) {
  const at = MARKUP.indexOf(attribute);
  assert.ok(at >= 0, `no element carries ${attribute}`);
  const start = MARKUP.lastIndexOf('<', at);
  const openEnd = MARKUP.indexOf('>', at);
  const tag = MARKUP.slice(start + 1, openEnd).match(/^[a-z]+/)?.[0];
  assert.ok(tag, `could not read the tag name for ${attribute}`);
  if (MARKUP[openEnd - 1] === '/') return [start, openEnd + 1];

  let depth = 1;
  let cursor = openEnd + 1;
  const pattern = new RegExp(`<(/?)${tag}\\b([^>]*)>`, 'g');
  pattern.lastIndex = cursor;
  let match = pattern.exec(MARKUP);
  while (match) {
    if (match[1] === '/') depth -= 1;
    else if (!match[2].endsWith('/')) depth += 1;
    cursor = match.index + match[0].length;
    if (depth === 0) return [start, cursor];
    match = pattern.exec(MARKUP);
  }
  assert.fail(`element carrying ${attribute} is never closed`);
  return [start, cursor];
}

const contains = (outer, inner) => {
  const [outerStart, outerEnd] = elementSpan(outer);
  const [innerStart, innerEnd] = elementSpan(inner);
  return innerStart > outerStart && innerEnd <= outerEnd;
};

/** Every CSS rule in the file, as `{ selector, body }`, comments stripped. */
function rules() {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(stripped);
  while (match) {
    found.push({ selector: match[1].trim(), body: match[2] });
    match = pattern.exec(stripped);
  }
  return found;
}

const ALL_RULES = rules();

/** (ids, classes+attributes+pseudo-classes, elements), per CSS selector specificity. */
function specificity(selector) {
  const cleaned = selector.replace(/::[a-z-]+/g, '');
  return [
    (cleaned.match(/#[\w-]+/g) || []).length,
    (cleaned.match(/\.[\w-]+|\[[^\]]+\]|:[a-z-]+(\([^)]*\))?/g) || []).length,
    (cleaned.match(/(^|[\s>+~])[a-z]+/g) || []).length,
  ];
}

const outranks = (a, b) => {
  const left = specificity(a);
  const right = specificity(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return false;
};

const declaration = (body, property) => body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`))?.[1]?.trim() || null;

test('nothing the panel ships hidden can be painted by a display rule', () => {
  // The classes that carry `hidden` in the shipped markup.
  const hiddenClasses = new Set();
  for (const tag of MARKUP.match(/<[a-z][^>]*\shidden[\s/>]/g) || []) {
    for (const name of tag.match(/class="([^"]*)"/)?.[1]?.split(/\s+/) || []) {
      if (name) hiddenClasses.add(name);
    }
  }
  assert.ok(hiddenClasses.has('dsp-form'), 'the form no longer ships hidden');
  assert.ok(hiddenClasses.has('dsp-draft'), 'the draft card no longer ships hidden');
  assert.ok(hiddenClasses.has('dsp-results'), 'the shortlist no longer ships hidden');

  const guard = ALL_RULES.find((rule) => rule.selector === '.dsp [hidden]');
  assert.ok(guard, 'no `.dsp [hidden]` rule: the box will paint its own hidden sections');
  assert.equal(declaration(guard.body, 'display'), 'none');

  // Any rule that gives one of those classes a display must lose to the guard.
  for (const rule of ALL_RULES) {
    const display = declaration(rule.body, 'display');
    if (!display || display === 'none') continue;
    for (const selector of rule.selector.split(',').map((part) => part.trim())) {
      const targets = [...hiddenClasses].some((name) => new RegExp(`\\.${name}(?![\\w-])`).test(selector));
      if (!targets) continue;
      assert.ok(
        outranks(guard.selector, selector),
        `"${selector} { display: ${display} }" outranks .dsp [hidden] — a hidden section would still paint`,
      );
    }
  }
});

test('the box ships closed, and says so to a screen reader', () => {
  assert.match(MARKUP, /class="dsp-form"[^>]*\shidden/, 'the form does not ship hidden');
  assert.match(MARKUP, /data-dsp-open[^>]*aria-expanded="false"/, 'the opener does not ship collapsed');
  assert.match(source, /openButton\.setAttribute\('aria-expanded'/, 'aria-expanded is never updated');
});

test('the third size is keyed to proof of intent, not to a click', () => {
  // A click opens the field. Only a shortlist on screen or a draft in hand
  // takes room from the layer list.
  const body = source.slice(source.indexOf('function syncDepth'), source.indexOf('function fillSelect'));
  assert.match(body, /!resultsSection\.hidden \|\| !draftSection\.hidden/, 'depth is no longer read from the shortlist and the draft');
  assert.match(body, /panel\.classList\.toggle\('dsp-deep'/, 'the dsp-deep class is no longer set');

  const share = ALL_RULES.find((rule) => rule.selector === '#dataset-plug-panel.dsp-deep');
  assert.ok(share, 'no rule lets the box share the panel at the third size');
  assert.equal(declaration(share.body, 'min-height'), '0', 'the box cannot yield without min-height: 0');

  const floor = ALL_RULES.find((rule) => rule.selector.includes('dsp-deep') && rule.selector.includes('.data-toggle-list'));
  assert.ok(floor, 'the layer list has no floor at the third size');
  // Pinned to the floor, or flexbox shrinks the list in proportion to its own
  // 2 600 px of rows and hands the box nine pixels. See the CSS note.
  assert.match(declaration(floor.body, 'flex') || '', /\d+px$/, 'the list floor is not pinned as a flex basis');
  assert.match(declaration(floor.body, 'min-height') || '', /^\d+px$/, 'the list floor has no min-height');
});

test('BRANCHER cannot be scrolled out of reach', () => {
  // The draft is taller than the box's share of a 13" panel, so the scroller
  // holds the reading and the actions stay pinned under it.
  assert.ok(contains('data-dsp-body', 'data-dsp-results'), 'the shortlist is outside the scroller');
  assert.ok(contains('data-dsp-body', 'data-dsp-draft'), 'the draft is outside the scroller');
  assert.ok(!contains('data-dsp-body', 'data-dsp-actions'), 'BRANCHER is inside the scroller: it can be scrolled away');
  assert.ok(!contains('data-dsp-body', 'data-dsp-url'), 'the search field is inside the scroller');
  assert.ok(!contains('data-dsp-body', 'data-dsp-status'), 'the status line is inside the scroller');
  assert.match(source, /actionsRow\.hidden = false/, 'the actions row is never shown with the draft');
  assert.match(source, /actionsRow\.hidden = true/, 'the actions row is never hidden with the draft');

  const scroller = ALL_RULES.find((rule) => rule.selector === '.dsp-body');
  assert.ok(scroller, 'the scroller has no rule');
  assert.equal(declaration(scroller.body, 'overflow-y'), 'auto');
  assert.match(declaration(scroller.body, 'max-height') || '', /^\d+px$/, 'the scroller has no cap: on a tall screen it can push the list out');
});

test('a collapsed DATA LAYERS panel shows no box at all', () => {
  const rule = ALL_RULES.find((entry) => entry.selector.includes('#data-panel.collapsed #dataset-plug-panel'));
  assert.ok(rule, 'the box survives the panel being collapsed');
  assert.match(rule.body, /display:\s*none/);
});
