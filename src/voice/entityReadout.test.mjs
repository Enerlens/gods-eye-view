/*
 * THE BIKE-STATION TEST.
 *
 * On 2026-09-09 an operator selected a Bordeaux TBM station GEV had just drawn
 * and asked how many bikes and docks it had. The mic told them to consult the
 * transport company's website. Every number was already in the browser:
 * `bikesAvailable`, `docksAvailable` and `capacity` sat on the render record.
 * What was missing was any way for the voice surface to read them — the layer
 * exposed no selection accessor and published no analyst records.
 *
 * These tests pin the readouts that closed that gap. They are deliberately
 * about SHAPE and HONESTY rather than about plumbing:
 *   - a null is never spoken as a zero;
 *   - an internal key never reaches the model, which would read it aloud;
 *   - a layer that only knows a count says so instead of implying absence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { bikeshareStationReadout } from '../data/bikeshare.js';
import { irveSiteReadout } from '../data/irveFrance.js';
import { medecinsSiteReadout } from '../data/medecinsFrance.js';
import { dvfSaleRecord } from '../data/dvfSales.js';
import { ANALYST_LAYERS } from '../data/analystEngine.js';

test('a selected bike station answers the question that was asked', () => {
  const readout = bikeshareStationReadout({
    key: 'bordeaux-tbm:1042',
    cityId: 'bordeaux-tbm',
    stationId: '1042',
    stationName: 'Place Gambetta',
    lat: 44.8404,
    lon: -0.5805,
    capacity: 20,
    bikesAvailable: 12,
    docksAvailable: 8,
    isInstalled: true,
    isRenting: true,
    isReturning: true,
    lastReportedMs: 1_757_400_000_000,
  });
  assert.equal(readout.name, 'Place Gambetta');
  assert.equal(readout.bikesAvailable, 12);
  assert.equal(readout.docksAvailable, 8);
  assert.equal(readout.capacity, 20);
  assert.equal(readout.occupancyPct, 60);
  assert.equal(readout.lastReportedMs, 1_757_400_000_000);
  // The system and the city are how a person names where a station is; the
  // registry knows both and the render record only knows a slug.
  assert.equal(readout.system, 'Le Vélo (TBM)');
  assert.equal(readout.city, 'Bordeaux, FR');
  // The primitive must not travel: it is a Cesium object, and `point` in a
  // JSON payload is a serialization accident waiting to happen.
  assert.equal(readout.point, undefined);
});

test('a station whose status has not landed reports nothing, not nought', () => {
  const readout = bikeshareStationReadout({
    key: 'x:1', cityId: 'x', stationId: '1', stationName: 'Fresh', lat: 1, lon: 2,
    capacity: 20, bikesAvailable: null, docksAvailable: null,
    isInstalled: true, isRenting: true, isReturning: true, lastReportedMs: null,
  });
  assert.equal(readout.bikesAvailable, null, '"no bikes" and "not reported" are opposite answers');
  assert.equal(readout.occupancyPct, null);
  assert.equal(readout.lastReportedMs, null);
  assert.equal(bikeshareStationReadout(null), null);
});

test('a closed station says so, and an open one does not have to', () => {
  const closed = bikeshareStationReadout({
    key: 'x:2', cityId: 'x', stationId: '2', stationName: 'Closed', lat: 1, lon: 2,
    capacity: 10, bikesAvailable: 0, docksAvailable: 10,
    isInstalled: false, isRenting: false, isReturning: false, lastReportedMs: null,
  });
  assert.equal(closed.installed, false);
  assert.equal(closed.renting, false);
  assert.equal(closed.bikesAvailable, 0, 'a REPORTED zero is a zero');
});

test('a charge-point site never claims an availability nobody publishes', () => {
  const full = irveSiteReadout({
    id: 'site-1',
    site: {
      id: 'site-1', lat: 44.84, lon: -0.58, name: 'Parking Victoire', commune: 'Bordeaux',
      operators: ['IZIVIA', 'Bouygues'], pdcDistinct: 6, pdcPublished: 8, peakKW: 150,
      topBand: 'hpc', connectors: [], access: '24/7', free: false, updatedTo: '2026-08-30',
    },
  });
  assert.equal(full.detail, 'full');
  assert.equal(full.chargePoints, 6);
  assert.equal(full.peakKW, 150);
  // The national IRVE file is an inventory. Live occupancy is per-operator OCPI
  // behind a contract, so the payload states the absence rather than leaving a
  // gap the model would fill in with "available".
  assert.equal(full.availabilityKnown, false);
  assert.equal(full.available, undefined);
  // A bare flag gets skimmed past — measured on the bench, where the model
  // answered a "are any free?" question by going hunting with another query.
  // The prose is what it actually reads.
  assert.match(full.availabilityNote, /NOT published/);
});

test('a thinned national dot says it only knows a count', () => {
  const mesh = irveSiteReadout({
    id: 'mesh-1',
    mesh: true,
    site: { id: 'mesh-1', lat: 47, lon: 2, pdcDistinct: 3, pdcPublished: 3, topBand: 'ac' },
  });
  assert.equal(mesh.detail, 'count-only');
  assert.equal(mesh.chargePoints, 3);
  assert.equal(mesh.name, null, 'a mesh dot has no name to give, and must not invent one');
  assert.equal(mesh.operators, null);
  assert.equal(irveSiteReadout(null), null);
  assert.equal(irveSiteReadout({ id: 'x' }), null);
});

test('a medical practice counts entries and says so — and ships no names', () => {
  const readout = medecinsSiteReadout({
    key: 'site:42',
    lat: 44.84,
    lon: -0.58,
    practitioners: 8,
    family: 'generaliste',
    site: [44.84, -0.58, 'numero', '33063', '33000', 'Bordeaux', '12 rue Sainte-Catherine', '0556000000', [], [['G', 6], ['S', 2]], 8],
  }, { specialites: { G: 'Médecine générale', S: 'Cardiologie' } });
  assert.equal(readout.practitioners, 8);
  assert.equal(readout.commune, 'Bordeaux');
  assert.equal(readout.address, '12 rue Sainte-Catherine');
  assert.match(readout.countsEntries, /not distinct people/);
  assert.deepEqual(readout.specialties, [
    { label: 'Médecine générale', entries: 6 },
    { label: 'Cardiologie', entries: 2 },
  ]);
  // Practitioner names are personal data about identified individuals and are
  // fetched separately for the card a human clicked. They must not ride into a
  // model prompt on every glance.
  assert.equal(readout.practitionerNames, undefined);
  assert.equal(readout.praticiens, undefined);
});

test('every layer the analyst enum names publishes the fields it advertises', () => {
  // A field named in ANALYST_LAYERS that the mapper never emits is a filter
  // that silently matches nothing — the worst kind of query bug, because it
  // answers "zero" instead of failing.
  const emitted = {
    bikeshare: Object.keys(bikeshareStationReadout({
      key: 'k', cityId: 'c', stationId: 's', stationName: 'n', lat: 0, lon: 0,
      capacity: 1, bikesAvailable: 1, docksAvailable: 0,
      isInstalled: true, isRenting: true, isReturning: true, lastReportedMs: 1,
    })),
    'irve-fr': Object.keys(irveSiteReadout({
      id: 'i', site: { id: 'i', lat: 0, lon: 0, name: 'n', commune: 'c', operators: [], pdcDistinct: 1, pdcPublished: 1, peakKW: 22, topBand: 'ac', connectors: [], access: 'a', free: true, updatedTo: 'd' },
    })),
    'medecins-fr': Object.keys(medecinsSiteReadout({
      key: 'k', lat: 0, lon: 0, practitioners: 1, family: 'generaliste',
      site: [0, 0, 'p', 'i', 'cp', 'v', 'voie', 'tel', [], [], 1],
    })),
    'dvf-sales': Object.keys(dvfSaleRecord({
      id: 'm', lat: 0, lon: 0, prixM2: 5000, valeur: 300_000, dwellingSurface: 60,
      dwellingCount: 1, rooms: 3, distanceM: 40, date: '2024-01-01',
      nature: 'Vente', types: ['Appartement'], address: 'a', commune: 'c',
    })),
  };
  for (const [layerId, fields] of Object.entries(emitted)) {
    const declared = ANALYST_LAYERS[layerId];
    assert.ok(declared, `${layerId} must be in ANALYST_LAYERS`);
    for (const field of [...declared.numeric, ...declared.text, ...declared.flags]) {
      assert.ok(
        fields.includes(field),
        `${layerId} advertises "${field}" but its readout never emits it`,
      );
    }
    assert.ok(fields.includes('lat') && fields.includes('lon'), `${layerId} must be locatable`);
  }
});
