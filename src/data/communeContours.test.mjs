// The commune outlines two French layers now share.
//
// The behaviour under test is the same one `delinquanceFeed.test.mjs` has
// always pinned — it runs against the same real Corsican and Parisian
// fixtures — and those tests staying green next to these is what says the
// extraction was faithful rather than a rewrite. What is new here is the part
// the childcare layer needed: `codeEpci` surviving the projection, and the
// second request that is the only way an arrondissement exists at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ARRONDISSEMENT_DEPARTEMENTS,
  COMMUNE_MAX_PARTS,
  COMMUNE_MAX_RING_VERTICES,
  arrondissementContoursUrl,
  communeContoursUrl,
  decimateCommuneRing,
  hasArrondissements,
  projectCommuneContours,
  ringAnchor,
} from './communeContours.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const CORSE = load('geoapi-communes-2b-sample.json');
const PARIS = load('geoapi-communes-75-epci-sample.json');
const ARRONDISSEMENTS = load('geoapi-arrondissements-75-sample.json');

test('a URL is only built for a code the API could answer', () => {
  assert.equal(
    communeContoursUrl('2B'),
    'https://geo.api.gouv.fr/departements/2B/communes?format=geojson&geometry=contour&fields=code,nom,population',
  );
  assert.match(communeContoursUrl('2a'), /departements\/2A\/communes/);
  assert.match(communeContoursUrl('971'), /departements\/971\/communes/);
  for (const bad of ['', '9', '999', '../etc', '75056', null]) {
    assert.throws(() => communeContoursUrl(bad), /invalid département code/);
  }
  // The field list is the one place a caller could smuggle query string into
  // the URL, so it is guarded rather than escaped — see `assertFields`.
  assert.throws(() => communeContoursUrl('75', { fields: 'code&limit=1' }), /invalid fields/);
  assert.match(communeContoursUrl('75', { fields: 'code,codeEpci' }), /fields=code,codeEpci$/);
});

test('only three départements have arrondissements, and they need the second call', () => {
  assert.deepEqual([...ARRONDISSEMENT_DEPARTEMENTS], ['75', '69', '13']);
  for (const dep of ARRONDISSEMENT_DEPARTEMENTS) assert.equal(hasArrondissements(dep), true);
  assert.equal(hasArrondissements('01'), false);
  assert.equal(hasArrondissements(null), false);
  const url = arrondissementContoursUrl('13');
  assert.match(url, /codeDepartement=13/);
  assert.match(url, /type=arrondissement-municipal/);
  // Not the /departements/:code/communes route: that one answers the parent
  // commune and would silently return the same polygon twice.
  assert.equal(/departements\/13/.test(url), false);
});

test('a ring is closed, deduped and honest about having been strided', () => {
  const galeria = CORSE.features.find((f) => f.properties.code === '2B121');
  const decimated = decimateCommuneRing(galeria.geometry.coordinates[0]);
  assert.equal(decimated.simplified, true);
  assert.equal(decimated.ring.length / 2, COMMUNE_MAX_RING_VERTICES);
  // An unclosed ring is the one simplification whose failure mode is a visible
  // gash across the commune.
  assert.equal(decimated.ring[0], decimated.ring[decimated.ring.length - 2]);
  assert.equal(decimated.ring[1], decimated.ring[decimated.ring.length - 1]);
  // A ring the layer cannot draw yields nothing rather than a degenerate shape.
  assert.deepEqual(decimateCommuneRing([[1, 2], [1, 2]]), { ring: [], simplified: false });
  assert.deepEqual(decimateCommuneRing(null), { ring: [], simplified: false });
});

test('a multi-part commune keeps its biggest pieces and says how many it dropped', () => {
  const contours = projectCommuneContours(CORSE);
  assert.equal(contours.communes.length, 5);
  assert.equal(contours.droppedParts, 2, "L'Île-Rousse publishes five pieces; three are kept");
  const ileRousse = contours.communes.find((c) => c.code === '2B134');
  assert.equal(ileRousse.parts.length, COMMUNE_MAX_PARTS);
  assert.equal(ileRousse.simplified, true);
  // Outer rings only: an interior ring is ANOTHER commune, drawn in its own
  // right, so cutting the hole would leave a gap where a polygon already sits.
  assert.equal(contours.communes.find((c) => c.code === '2B049').parts.length, 2);
  assert.equal(projectCommuneContours({ features: [{ properties: {}, geometry: null }] }).communes.length, 0);
  assert.equal(projectCommuneContours(null).communes.length, 0);
});

test('codeEpci survives the projection when the caller asked for it', () => {
  // An EPCI has no contour on this API. This one property is the whole reason
  // its territory can be drawn at all.
  assert.equal(projectCommuneContours(PARIS).communes[0].epci, '200054781');
  // …and its absence is null rather than a guess: the arrondissement request
  // does not carry it, measured on the real answer.
  assert.equal(projectCommuneContours(ARRONDISSEMENTS).communes[0].epci, null);
  assert.equal(projectCommuneContours(CORSE).communes[0].epci, null);
});

test('a card anchor is the mean of a drawn ring, never of an undrawn one', () => {
  const paris = projectCommuneContours(PARIS).communes[0];
  const [lon, lat] = ringAnchor(paris.parts[0]);
  assert.ok(lon > 2.2 && lon < 2.5, `lon ${lon}`);
  assert.ok(lat > 48.7 && lat < 49, `lat ${lat}`);
  assert.equal(ringAnchor([1, 2]), null);
  assert.equal(ringAnchor(null), null);
});
