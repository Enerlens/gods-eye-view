// src/data/overlayLabelPick.test.mjs
// Pins the shared "the name is a click surface" seam: prefix families, the
// source-id fence between layers, the liveness guard against pooled hit
// rectangles, and the rule that a broken host is a miss and never a throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DETECTION_LABEL_SOURCE_PREFIX,
  detectionLabelSourceId,
  overlayLabelRecordId,
  pickOverlayLabelId,
} from './overlayLabelPick.js';

/** A host stub that answers one rectangle, shaped like hitTestWorldOverlay. */
function hostWith({ sourceId, entryId, x = 100, y = 50 }) {
  return (hitX, hitY, options = {}) => {
    if (hitX !== x || hitY !== y) return null;
    if (options.sourceId && options.sourceId !== sourceId) return null;
    return { sourceId, entryId, entry: { id: entryId }, rect: { x, y, w: 80, h: 18 } };
  };
}

test('an entry id is stripped to the record id its family names', () => {
  assert.equal(overlayLabelRecordId('power-grid-label:SUB-42', 'power-grid-label:'), 'SUB-42');
  // Layers whose entry id IS the record id pass no prefix.
  assert.equal(overlayLabelRecordId('V720001002', ''), 'V720001002');
  // A source publishing two families tells them apart by asking twice.
  assert.equal(overlayLabelRecordId('schools-fr:dep:75', 'schools-fr:site:'), null);
  assert.equal(overlayLabelRecordId('', 'x:'), null);
  assert.equal(overlayLabelRecordId(null, ''), null);
  // A bare prefix names nothing.
  assert.equal(overlayLabelRecordId('gas-fr-label:', 'gas-fr-label:'), null);
});

test('a label under the cursor resolves to its record id', () => {
  const id = pickOverlayLabelId({ x: 100, y: 50 }, {
    sourceId: 'hubeau-hydro',
    prefix: 'hubeau:',
    hitTest: hostWith({ sourceId: 'hubeau-hydro', entryId: 'hubeau:F447000302' }),
  });
  assert.equal(id, 'F447000302');
});

test('a sibling layer’s label is never resolved as one of ours', () => {
  // The fence is the source id: a layer that resolved a neighbour's label as
  // its own would select the wrong object AND swallow the neighbour's click.
  assert.equal(pickOverlayLabelId({ x: 100, y: 50 }, {
    sourceId: 'power-grid',
    prefix: 'power-grid-label:',
    hitTest: hostWith({ sourceId: 'hubeau-hydro', entryId: 'hubeau:F447000302' }),
  }), null);
});

test('a rectangle that outlived its record is a miss, not a selection', () => {
  // Hit rectangles are pooled and published per painted frame, so one can name
  // a record that has since left the viewport.
  const hitTest = hostWith({ sourceId: 'gas-fr', entryId: 'gas-fr-label:PLANT-9' });
  const options = { sourceId: 'gas-fr', prefix: 'gas-fr-label:', hitTest };
  assert.equal(pickOverlayLabelId({ x: 100, y: 50 }, options), 'PLANT-9');
  assert.equal(pickOverlayLabelId({ x: 100, y: 50 }, {
    ...options,
    has: (id) => id !== 'PLANT-9',
  }), null);
});

test('empty space, a degenerate position and a missing host are all misses', () => {
  const hitTest = hostWith({ sourceId: 'gas-fr', entryId: 'gas-fr-label:PLANT-9' });
  const options = { sourceId: 'gas-fr', prefix: 'gas-fr-label:', hitTest };
  assert.equal(pickOverlayLabelId({ x: 7, y: 7 }, options), null);
  assert.equal(pickOverlayLabelId(null, options), null);
  assert.equal(pickOverlayLabelId({ x: NaN, y: 50 }, options), null);
  assert.equal(pickOverlayLabelId({ x: 100, y: 50 }, { ...options, hitTest: undefined }), null);
  // No source id means no fence, so the answer is a miss rather than a guess.
  assert.equal(pickOverlayLabelId({ x: 100, y: 50 }, { ...options, sourceId: '' }), null);
});

test('a host throwing mid-teardown does not break the layer’s click handler', () => {
  assert.equal(pickOverlayLabelId({ x: 1, y: 1 }, {
    sourceId: 'gas-fr',
    hitTest: () => { throw new Error('overlay destroyed'); },
  }), null);
});

test('detection callouts get one hit-test scope per layer, never one for the lane', () => {
  // Aircraft and military callsigns are painted by the SAME host lane. If they
  // shared a source id, a click on a civil contact would resolve inside the
  // military layer's handler — and both handlers would fight over it.
  assert.equal(detectionLabelSourceId('flights'), 'detect:flights');
  assert.equal(detectionLabelSourceId('military'), 'detect:military');
  assert.notEqual(detectionLabelSourceId('flights'), detectionLabelSourceId('military'));
  assert.ok(detectionLabelSourceId('flights').startsWith(DETECTION_LABEL_SOURCE_PREFIX));
  // The scope is a fence, so an absent layer id must not collapse onto a
  // neighbour's — and it must not read as the bare prefix of a real one.
  assert.equal(detectionLabelSourceId(null), 'detect:');
  assert.equal(detectionLabelSourceId(undefined), 'detect:');

  // The record id is published bare under that scope: no prefix to strip.
  const hitTest = hostWith({ sourceId: 'detect:flights', entryId: '3c6444' });
  assert.equal(pickOverlayLabelId({ x: 100, y: 50 }, {
    sourceId: detectionLabelSourceId('flights'),
    has: (icao24) => icao24 === '3c6444',
    hitTest,
  }), '3c6444');
  assert.equal(pickOverlayLabelId({ x: 100, y: 50 }, {
    sourceId: detectionLabelSourceId('military'),
    hitTest,
  }), null);
});
