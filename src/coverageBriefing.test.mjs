// The card a territorial layer shows before it starts.
//
// One property runs through this file: **the card resolves exactly once, with a
// word the manager can act on, and never leaves a click unanswered.** A card
// that resolves twice enables a layer twice; a card that never resolves leaves
// `_runCoverageBriefing` awaiting forever and the chip inert for the rest of
// the session. Both are silent.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coverageBriefingStorageKey,
  initCoverageBriefing,
  isCoverageBriefingSuppressed,
  setCoverageBriefingSuppressed,
  suppressedCoverageChoice,
} from './coverageBriefing.js';

/** A DOM stub deep enough for one dialog: queries, classes, events, focus. */
function makeNode(selectors = {}) {
  const node = {
    hidden: false,
    checked: false,
    className: '',
    textContent: '',
    children: [],
    focused: 0,
    listeners: new Map(),
    classList: {
      add(name) {
        const set = new Set(node.className.split(/\s+/).filter(Boolean));
        set.add(name);
        node.className = [...set].join(' ');
      },
      remove(name) {
        const set = new Set(node.className.split(/\s+/).filter(Boolean));
        set.delete(name);
        node.className = [...set].join(' ');
      },
      contains(name) { return node.className.split(/\s+/).includes(name); },
    },
    addEventListener(type, handler) {
      if (!node.listeners.has(type)) node.listeners.set(type, []);
      node.listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      node.listeners.set(type, (node.listeners.get(type) || []).filter((fn) => fn !== handler));
    },
    fire(type, event = {}) {
      for (const handler of [...(node.listeners.get(type) || [])]) handler(event);
    },
    focus() { node.focused += 1; },
    replaceChildren(...items) { node.children = items; },
    querySelector(selector) { return selectors[selector] || null; },
  };
  return node;
}

/** Mount a card against a stubbed document, returning the pieces plus teardown. */
function mountCard({ storage } = {}) {
  const title = makeNode();
  const body = makeNode();
  const scope = makeNode();
  const gotoLabel = makeNode();
  const gotoButton = makeNode({ '[data-coverage-goto-label]': gotoLabel });
  const hereButton = makeNode();
  const suppress = makeNode();
  const root = makeNode({
    '[data-coverage-title]': title,
    '[data-coverage-body]': body,
    '[data-coverage-scope]': scope,
    '[data-coverage-choice="goto"]': gotoButton,
    '[data-coverage-choice="here"]': hereButton,
    '[data-coverage-goto-label]': gotoLabel,
    '[data-coverage-suppress]': suppress,
  });
  root.hidden = true;

  const documentListeners = new Map();
  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalHtmlElement = globalThis.HTMLElement;
  globalThis.document = {
    activeElement: null,
    createElement: () => makeNode(),
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      documentListeners.set(type, (documentListeners.get(type) || []).filter((fn) => fn !== handler));
    },
  };
  // The card no longer reveals on a frame — it forces a style flush instead,
  // because rAF does not tick on a page whose WebGL loop has stalled. rAF is
  // stubbed to THROW so a regression that reintroduces it fails here rather
  // than in a headless harness three weeks later.
  globalThis.requestAnimationFrame = () => {
    throw new Error('the card must not depend on a frame that may never come');
  };
  // `document.activeElement instanceof HTMLElement` must be answerable.
  globalThis.HTMLElement = class {};

  const card = initCoverageBriefing(root, { storage });
  return {
    card, root, title, body, scope, gotoButton, hereButton, gotoLabel, suppress,
    pressEscape: () => {
      for (const handler of documentListeners.get('keydown') || []) {
        handler({ key: 'Escape', preventDefault() {} });
      }
    },
    documentListeners,
    restore() {
      card?.destroy();
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.HTMLElement = originalHtmlElement;
    },
  };
}

const REQUEST = Object.freeze({
  layerId: 'comptages-fr',
  chip: 'PARIS',
  where: 'Paris intra-muros',
  goto: 'paris',
  gotoName: 'Paris',
  layerName: 'Comptages routiers (Paris)',
  brief: {
    title: 'Comptages routiers',
    lines: ['une', 'deux', 'trois'],
  },
});

function makeMemoryStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    _store: store,
  };
}

test('a missing root mounts nothing rather than throwing', () => {
  assert.equal(initCoverageBriefing(null), null);
});

test('the card paints the layer copy and names the destination', async () => {
  const ui = mountCard({ storage: makeMemoryStorage() });
  try {
    const pending = ui.card.ask(REQUEST);
    assert.equal(ui.root.hidden, false);
    assert.ok(ui.root.classList.contains('visible'));
    assert.equal(ui.title.textContent, 'Comptages routiers');
    assert.equal(ui.scope.textContent, 'PARIS');
    assert.deepEqual(ui.body.children.map((node) => node.textContent), ['une', 'deux', 'trois']);
    assert.equal(ui.gotoLabel.textContent, 'Aller à Paris');
    assert.equal(ui.gotoButton.hidden, false);
    // Focus lands on the answer that produces a map with data on it.
    assert.equal(ui.gotoButton.focused, 1);

    ui.gotoButton.fire('click');
    assert.equal(await pending, 'goto');
    assert.equal(ui.root.hidden, true);
    assert.equal(ui.root.classList.contains('visible'), false);
  } finally {
    ui.restore();
  }
});

test('a layer with nowhere to fly to hides the offer instead of making a dead one', async () => {
  const ui = mountCard({ storage: makeMemoryStorage() });
  try {
    const pending = ui.card.ask({ ...REQUEST, goto: null, gotoName: null });
    assert.equal(ui.gotoButton.hidden, true);
    assert.equal(ui.hereButton.focused, 1, 'focus goes to the only answer there is');
    ui.hereButton.fire('click');
    assert.equal(await pending, 'here');
  } finally {
    ui.restore();
  }
});

test('ESC answers nothing, which is not the same as answering here', async () => {
  // `null` is what leaves the layer exactly as the reader found it — off.
  const ui = mountCard({ storage: makeMemoryStorage() });
  try {
    const pending = ui.card.ask(REQUEST);
    ui.pressEscape();
    assert.equal(await pending, null);
    assert.equal(ui.root.hidden, true);
  } finally {
    ui.restore();
  }
});

test('a second question abandons the first rather than answering it', async () => {
  // Two chips pressed in a row. Resolving the first with the second's answer
  // would switch on a layer nobody agreed to.
  const ui = mountCard({ storage: makeMemoryStorage() });
  try {
    const first = ui.card.ask(REQUEST);
    const second = ui.card.ask({ ...REQUEST, layerId: 'velo-pulse-fr' });
    assert.equal(await first, null);
    ui.hereButton.fire('click');
    assert.equal(await second, 'here');
  } finally {
    ui.restore();
  }
});

test('the checkbox writes immediately, so ESC does not discard the preference', async () => {
  const storage = makeMemoryStorage();
  const ui = mountCard({ storage });
  try {
    const pending = ui.card.ask(REQUEST);
    ui.suppress.checked = true;
    ui.suppress.fire('change');
    assert.equal(isCoverageBriefingSuppressed('comptages-fr', storage), true);
    ui.pressEscape();
    assert.equal(await pending, null, 'the preference is kept, the question is still declined');
  } finally {
    ui.restore();
  }
});

test('a suppressed card keeps the word it used — it goes, it does not sit there', async () => {
  // "Ne plus demander — aller directement". Resolving `here` would switch the
  // layer on where it draws nothing, which is the defect this whole change
  // exists to remove, dressed up as a preference.
  const storage = makeMemoryStorage({
    [coverageBriefingStorageKey('comptages-fr')]: 'suppressed',
  });
  const ui = mountCard({ storage });
  try {
    const answer = await ui.card.ask(REQUEST);
    assert.equal(answer, 'goto');
    assert.equal(ui.root.hidden, true, 'the card never opened');
  } finally {
    ui.restore();
  }
});

test('a suppressed layer with nowhere to go is switched on where we stand', () => {
  assert.equal(suppressedCoverageChoice('paris'), 'goto');
  assert.equal(suppressedCoverageChoice(null), 'here');
});

test('suppression is per layer — one lesson learned is not all of them', async () => {
  const storage = makeMemoryStorage();
  setCoverageBriefingSuppressed('comptages-fr', true, storage);
  const ui = mountCard({ storage });
  try {
    assert.equal(await ui.card.ask(REQUEST), 'goto', 'suppressed');
    const other = ui.card.ask({ ...REQUEST, layerId: 'velo-pulse-fr' });
    assert.equal(ui.root.hidden, false, 'a different subject still gets its card');
    ui.hereButton.fire('click');
    assert.equal(await other, 'here');
  } finally {
    ui.restore();
  }
});

test('storage that refuses takes the promise back instead of displaying it', async () => {
  // Safari private mode, quota, enterprise policy. Leaving the box ticked would
  // promise a preference nothing stored.
  const refusing = { getItem: () => null, setItem() { throw new Error('quota'); } };
  const ui = mountCard({ storage: refusing });
  try {
    const pending = ui.card.ask(REQUEST);
    ui.suppress.checked = true;
    ui.suppress.fire('change');
    assert.equal(ui.suppress.checked, false);
    ui.hereButton.fire('click');
    assert.equal(await pending, 'here');
  } finally {
    ui.restore();
  }
});

test('reading storage that throws is nothing stored, not a crash', () => {
  const hostile = { get getItem() { throw new Error('SecurityError'); } };
  assert.equal(isCoverageBriefingSuppressed('comptages-fr', hostile), false);
  assert.equal(setCoverageBriefingSuppressed('comptages-fr', true, hostile), false);
});

test('destroy settles an open question and lets the keyboard go', async () => {
  const ui = mountCard({ storage: makeMemoryStorage() });
  const pending = ui.card.ask(REQUEST);
  ui.card.destroy();
  assert.equal(await pending, null, 'an awaited promise is never abandoned');
  assert.equal((ui.documentListeners.get('keydown') || []).length, 0);
  ui.restore();
});

test('a request with no layer is inert', async () => {
  const ui = mountCard({ storage: makeMemoryStorage() });
  try {
    assert.equal(await ui.card.ask({}), null);
    assert.equal(ui.root.hidden, true);
  } finally {
    ui.restore();
  }
});
