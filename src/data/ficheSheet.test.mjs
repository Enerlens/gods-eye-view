import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FICHE_SHEET_ID,
  ficheSheetCoords,
  ficheSheetUrl,
  mountFicheSheet,
} from './ficheSheet.js';
import { ficheSheetPoint } from './implantationFiche.js';

test('the frame asks fiche.html for the embedded sheet at a real point', () => {
  const url = ficheSheetUrl({ lat: 48.8566, lon: 2.3522 });
  assert.equal(url, '/fiche.html?lat=48.856600&lon=2.352200&embed=1');
  // The tab link is the SAME sheet without `embed=1`, so it opens with the
  // lookup form and the print button the panel supplies itself.
  assert.equal(
    ficheSheetUrl({ lat: 48.8566, lon: 2.3522 }, { embed: false }),
    '/fiche.html?lat=48.856600&lon=2.352200',
  );
});

test('a point that is not a point opens nothing', () => {
  assert.equal(ficheSheetUrl(null), null);
  assert.equal(ficheSheetUrl({ lat: 'ici', lon: 2 }), null);
  assert.equal(ficheSheetUrl({ lat: 91, lon: 2 }), null, 'off the planet');
  assert.equal(ficheSheetUrl({ lat: 48, lon: 181 }), null);
  assert.equal(ficheSheetCoords(null), '');
  assert.equal(ficheSheetCoords({ lat: 45.75781, lon: 4.83569 }), '45.75781, 4.83569');
});

test('the door opens on what the reader clicked, then on the pin, then on the camera', () => {
  // The three agree the moment a reader has done anything at all. They differ
  // only before the first click, where the scanned centre is still the honest
  // answer to "which address is this card about".
  assert.deepEqual(
    ficheSheetPoint({
      groundCard: { lat: 1, lon: 2 },
      scanPin: { lat: 3, lon: 4 },
      scanCentre: { lat: 5, lon: 6 },
    }),
    { lat: 1, lon: 2 },
  );
  assert.deepEqual(
    ficheSheetPoint({ scanPin: { lat: 3, lon: 4 }, scanCentre: { lat: 5, lon: 6 } }),
    { lat: 3, lon: 4 },
  );
  assert.deepEqual(ficheSheetPoint({ scanCentre: { lat: 5, lon: 6 } }), { lat: 5, lon: 6 });
  assert.equal(ficheSheetPoint({}), null);
  assert.equal(ficheSheetPoint(null), null);
  // A half-written centre is not a point. `Number(null)` is 0, so a missing
  // longitude would otherwise open the sheet in the Gulf of Guinea.
  assert.equal(ficheSheetPoint({ scanCentre: { lat: 45.75, lon: null } }), null);
});

test('with no document there is no panel, and nothing throws', () => {
  const original = globalThis.document;
  delete globalThis.document;
  try {
    assert.equal(mountFicheSheet(), null);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

/** The smallest DOM the panel touches: children, attributes, one listener. */
function makeSheetElement() {
  const element = {
    children: [],
    className: '',
    id: '',
    hidden: false,
    style: { removeProperty() {} },
    dataset: {},
    attributes: {},
    listeners: new Map(),
    html: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    remove() {},
    getBoundingClientRect() { return { width: 400, height: 600, left: 0, top: 0 }; },
    querySelector(selector) {
      const key = selector.replace(/[[\]]/g, '');
      if (!this._nodes) this._nodes = new Map();
      if (!this._nodes.has(key)) this._nodes.set(key, makeSheetElement());
      return this._nodes.get(key);
    },
    set innerHTML(value) { this.html = String(value); },
    get innerHTML() { return this.html; },
  };
  return element;
}

test('the panel opens on a point, refuses a non-point, and empties its frame when closed', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = {
    createElement: makeSheetElement,
    getElementById: () => null,
    body: makeSheetElement(),
  };
  // `attachPanelDrag` and `restorePanelPosition` both no-op without a window,
  // which is exactly the seam this test wants: the panel's own behaviour, and
  // none of the drag layer's.
  delete globalThis.window;
  try {
    const sheet = mountFicheSheet();
    assert.ok(sheet, 'the panel mounted');
    assert.equal(sheet.element.id, FICHE_SHEET_ID);
    assert.equal(sheet.element.hidden, true, 'it opens closed');
    assert.equal(sheet.point(), null);

    assert.equal(sheet.show({ lat: 'nowhere', lon: 2 }), false, 'a bad point opens nothing');
    assert.equal(sheet.element.hidden, true);

    assert.equal(sheet.show({ lat: 45.75, lon: 4.83 }, 'Rue de la Ré'), true);
    assert.equal(sheet.element.hidden, false);
    assert.deepEqual(sheet.point(), { lat: 45.75, lon: 4.83 });
    const frame = sheet.element.querySelector('[data-fiche-frame]');
    assert.equal(frame.getAttribute('src'), '/fiche.html?lat=45.750000&lon=4.830000&embed=1');
    assert.equal(
      sheet.element.querySelector('[data-fiche-open]').attributes.href,
      '/fiche.html?lat=45.750000&lon=4.830000',
    );
    assert.equal(
      sheet.element.querySelector('[data-fiche-coords]').textContent,
      'Rue de la Ré · 45.75000, 4.83000',
    );

    sheet.hide();
    assert.equal(sheet.element.hidden, true);
    // Emptied, not merely hidden: a frame left pointed at the sheet keeps
    // fifteen requests warm behind a panel nobody is reading.
    assert.equal(frame.getAttribute('src'), null);
    assert.equal(sheet.point(), null);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
