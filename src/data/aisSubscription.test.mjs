// What the AISStream subscription asks for, and whether its silence is
// evidence. Pure — no environment, no socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIS_BBOX_FRANCE,
  AIS_BBOX_WORLD,
  AIS_DEFAULT_MESSAGE_TYPES,
  coversDefaultMessageTypes,
  isBusyAisSubscription,
  isKnownBusyBoundingBoxes,
} from './aisSubscription.js';

test('the France box takes in the approaches the traffic actually uses', () => {
  const [[[south, west], [north, east]]] = AIS_BBOX_FRANCE;
  const inside = (lat, lon) => lat >= south && lat <= north && lon >= west && lon <= east;
  // Ouessant TSS, Dover strait, Gulf of Lion, Corsica, Nice approaches.
  for (const [lat, lon] of [[48.5, -5.5], [51.0, 1.5], [43.0, 4.0], [41.9, 9.3], [43.5, 7.3]]) {
    assert.equal(inside(lat, lon), true, `${lat},${lon} is inside the box`);
  }
  // And it is metropolitan, on purpose — the DOM publish AIS this does not ask for.
  assert.equal(inside(14.6, -61.1), false, 'Fort-de-France is outside the box');
  assert.equal(inside(-20.9, 55.3), false, 'Le Port (La Réunion) is outside the box');
});

test('both measured presets arm the watchdog', () => {
  assert.equal(isKnownBusyBoundingBoxes(AIS_BBOX_WORLD), true);
  assert.equal(isKnownBusyBoundingBoxes(AIS_BBOX_FRANCE), true);
  // Spelled out by hand in .env, JSON-parsed into plain arrays — same boxes.
  assert.equal(isKnownBusyBoundingBoxes(JSON.parse('[[[-90,-180],[90,180]]]')), true);
  assert.equal(isKnownBusyBoundingBoxes(JSON.parse('[[[41.0,-8.0],[51.6,10.0]]]')), true);
});

test('a harbour-sized box does not arm it', () => {
  assert.equal(isKnownBusyBoundingBoxes([[[49.4, 0.0], [49.6, 0.3]]]), false);
  assert.equal(isKnownBusyBoundingBoxes([]), false);
  assert.equal(isKnownBusyBoundingBoxes(null), false);
  assert.equal(isKnownBusyBoundingBoxes('[[[41,-8],[51.6,10]]]'), false);
  // The France box plus a second one is a different subscription, unmeasured.
  assert.equal(isKnownBusyBoundingBoxes([...AIS_BBOX_FRANCE, [[14.0, -62.0], [16.6, -60.0]]]), false);
});

test('dropping a message type disarms it, adding one does not', () => {
  assert.equal(coversDefaultMessageTypes(AIS_DEFAULT_MESSAGE_TYPES), true);
  assert.equal(coversDefaultMessageTypes(undefined), true);
  assert.equal(coversDefaultMessageTypes([...AIS_DEFAULT_MESSAGE_TYPES, 'AidsToNavigationReport']), true);
  assert.equal(coversDefaultMessageTypes(['ShipStaticData']), false);
  assert.equal(coversDefaultMessageTypes([]), false);
  assert.equal(coversDefaultMessageTypes('PositionReport'), false);
  // CSV parsing leaves whitespace on the entries; it must not cost a match.
  const spaced = AIS_DEFAULT_MESSAGE_TYPES.map((type) => ` ${type} `);
  assert.equal(coversDefaultMessageTypes(spaced), true);
});

test('a busy subscription needs both a measured box and the full type set', () => {
  assert.equal(isBusyAisSubscription(AIS_BBOX_FRANCE, AIS_DEFAULT_MESSAGE_TYPES), true);
  assert.equal(isBusyAisSubscription(AIS_BBOX_FRANCE, ['ShipStaticData']), false);
  assert.equal(isBusyAisSubscription([[[49.4, 0.0], [49.6, 0.3]]], AIS_DEFAULT_MESSAGE_TYPES), false);
});
