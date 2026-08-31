// The companion index's join rules, run against catalog shapes the PAN
// actually publishes.
//
// Two of them cost real coverage if they are wrong. The conversion URL is
// DERIVED rather than read out of the catalog, because ten vehicle feeds
// across seven archives carry no `conversions` block and every one of their
// derived URLs served content when probed on 2026-08-31 — trusting the catalog
// alone would leave those networks with no trace. And a dataset with two
// vehicle feeds (Montpellier's TaM splits bus and tram) must yield an entry
// for each, or half a city clicks through to nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pairDataset, preferredStaticResource, summarize } from './build-pan-static-index.mjs';

/** A TBM-shaped dataset: two vehicle feeds, one trip-update feed, one GTFS. */
function dataset(overrides = {}) {
  return {
    id: '67f5bad303325228295b7dff',
    title: 'Réseau urbain et scolaire TBM',
    licence: 'fr-lo',
    page_url: 'https://transport.data.gouv.fr/datasets/tbm',
    offers: [{ nom_commercial: 'TBM' }],
    resources: [
      { format: 'gtfs-rt', id: 83026, url: 'https://example/vp', features: ['vehicle_positions'] },
      { format: 'gtfs-rt', id: 83035, url: 'https://example/vp2', features: ['vehicle_positions'] },
      { format: 'gtfs-rt', id: 83025, url: 'https://example/tu', features: ['trip_updates'], title: 'GTFS-RT TripUpdates' },
      { format: 'gtfs-rt', id: 83027, url: 'https://example/al', features: ['service_alerts'] },
      {
        format: 'GTFS',
        id: 83024,
        url: 'https://example/gtfs',
        page_url: 'https://transport.data.gouv.fr/resources/83024',
        metadata: { has_shapes: true, stops_count: 7385, stats: { routes_count: 204 } },
      },
    ],
    ...overrides,
  };
}

/** The same dataset as the per-dataset endpoint returns it, with conversions. */
function detail(conversion = { filesize: 13343804, last_check_conversion_is_up_to_date: '2026-08-31T18:15:03Z' }) {
  return {
    resources: [
      { id: 83024, conversions: conversion ? { GeoJSON: conversion } : undefined },
    ],
  };
}

test('every vehicle feed of a dataset gets its own entry, sharing the siblings', () => {
  const rows = pairDataset(dataset(), detail());
  assert.deepEqual(rows.map((row) => row.feed.id), ['pan-83026', 'pan-83035']);
  for (const row of rows) {
    assert.equal(row.entry.network, 'TBM');
    assert.equal(row.entry.licenceLabel, 'Licence Ouverte 1.0');
    // Only the trip-update resource — not the alerts feed beside it.
    assert.deepEqual(row.entry.tripUpdates.map((resource) => resource.resourceId), [83025]);
    assert.equal(row.entry.statics.length, 1);
  }
});

test('a dataset with no vehicle feed contributes nothing', () => {
  const rows = pairDataset(dataset({
    resources: [{ format: 'gtfs-rt', id: 1, url: 'u', features: ['trip_updates'] }],
  }), detail());
  assert.deepEqual(rows, []);
});

test('the conversion URL is derived, and the catalog only says whether it was declared', () => {
  const declared = pairDataset(dataset(), detail())[0].entry.statics[0];
  assert.equal(declared.geojson.url, 'https://transport.data.gouv.fr/resources/conversions/83024/GeoJSON');
  assert.equal(declared.geojson.declared, true);
  assert.equal(declared.geojson.bytes, 13343804);

  // No `conversions` block: the URL is still recorded, because those URLs
  // serve. What changes is the claim attached to it.
  const undeclared = pairDataset(dataset(), detail(null))[0].entry.statics[0];
  assert.equal(undeclared.geojson.url, declared.geojson.url);
  assert.equal(undeclared.geojson.declared, false);
  assert.equal(undeclared.geojson.bytes, null);
  // The validator's own verdict on the archive is carried either way.
  assert.equal(undeclared.hasShapes, true);
  assert.equal(undeclared.stopCount, 7385);
});

test('a conversion known dead is skipped in favour of one that answered', () => {
  const statics = [
    { resourceId: 1, geojson: { url: 'a', reachable: false } },
    { resourceId: 2, geojson: { url: 'b', reachable: true } },
  ];
  assert.equal(preferredStaticResource(statics).resourceId, 2);
  // Unprobed beats known-dead; catalog order breaks the tie among equals.
  assert.equal(preferredStaticResource([
    { resourceId: 3, geojson: { url: 'c', reachable: false } },
    { resourceId: 4, geojson: { url: 'd', reachable: null } },
  ]).resourceId, 4);
  assert.equal(preferredStaticResource([{ resourceId: 5, geojson: { url: 'e', reachable: false } }]), null);
  assert.equal(preferredStaticResource([]), null);
});

test('the summary counts what the index can actually explain', () => {
  const rows = pairDataset(dataset(), detail());
  const entries = Object.fromEntries(rows.map((row) => [row.feed.id, row.entry]));
  const stats = summarize(entries);
  assert.equal(stats.withTripUpdates, 2);
  assert.equal(stats.withGeometry, 2);
  assert.equal(stats.withShapesDeclared, 2);
  assert.equal(stats.conversionBytes, 2 * 13343804);
});
