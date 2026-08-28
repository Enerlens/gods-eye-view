// src/data/edfPlantsFeed.test.mjs
// Pins the UPSTREAM SHAPE of EDF's three generating-fleet files against
// captured payloads: the two incompatible coordinate conventions, the
// row-per-unit vs row-per-plant split, the site-level reserve repeated on
// every unit row, and the three different reference dates. The layer's own
// presentation is covered separately in edfPowerPlants.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EDF_DATASETS,
  FRANCE_BOX,
  commissioningYear,
  describeDataset,
  distinctValues,
  foldRegionKey,
  parseGpsPair,
  plantPosition,
  projectDataset,
  projectEdfPlants,
  shortenSousFiliere,
  siteSecondaryReserve,
  summarizeFleet,
} from './edfPlantsFeed.js';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`./fixtures/edf-plants-${name}.json`, import.meta.url),
  'utf8',
));

const PAYLOADS = Object.freeze({
  nucleaire: { meta: fixture('nucleaire-dataset'), lines: fixture('nucleaire-sample') },
  hydraulique: { meta: fixture('hydraulique-dataset'), lines: fixture('hydraulique-sample') },
  thermique: { meta: fixture('thermique-dataset'), lines: fixture('thermique-sample') },
});

const DOC = projectEdfPlants(PAYLOADS, 'test');
const site = (id) => DOC.sites.find((entry) => entry.id === id);
const specFor = (key) => EDF_DATASETS.find((entry) => entry.key === key);

// ── Trap 1: the coordinate conventions ──────────────────────────────────────

test('the hydro file publishes X as the LATITUDE, and it is read that way', () => {
  const grandMaison = site('hydraulique:GRAND-MAISON');
  // The raw row is x=45.1457930893, y=6.05115827544. Read x-as-longitude, the
  // largest hydro plant in France lands off the coast of Somalia.
  assert.equal(grandMaison.lat, 45.1457930893);
  assert.equal(grandMaison.lon, 6.05115827544);
});

test('nuclear and thermal publish one "lat, lon" string instead', () => {
  assert.deepEqual(parseGpsPair('51.012846, 2.139287'), [51.012846, 2.139287]);
  // No space after the comma is the platform's own derived spelling.
  assert.deepEqual(parseGpsPair('45.6452741068,6.44492758326'), [45.6452741068, 6.44492758326]);
  assert.equal(site('nucleaire:GRAVELINES').lat, 51.012846);
  assert.equal(site('nucleaire:GRAVELINES').lon, 2.139287);
});

test('a coordinate that is not a usable pair is refused, never defaulted', () => {
  assert.equal(parseGpsPair('47.5'), null);
  assert.equal(parseGpsPair('47.5, 2.1, 300'), null);
  assert.equal(parseGpsPair(''), null);
  assert.equal(parseGpsPair(null), null);
  assert.equal(parseGpsPair(['47.5', '2.1']), null);
  assert.equal(plantPosition({}), null);
  assert.equal(plantPosition(null), null);
});

test('a swapped pair lands outside France and is dropped rather than drawn', () => {
  // The exact failure the box exists for: Grand-Maison with x and y exchanged.
  assert.equal(plantPosition({ coordonnees_x_wgs: 6.05115827544, coordonnees_y_wgs: 45.1457930893 }), null);
  assert.equal(plantPosition({ point_gps_wsg84: '2.139287, 51.012846' }), null);
  // And the box really is metropolitan France, not a token check.
  assert.ok(FRANCE_BOX.maxLon < 10 && FRANCE_BOX.minLon > -6);
  assert.ok(FRANCE_BOX.maxLat < 52 && FRANCE_BOX.minLat > 40);
});

test('a dropped row is counted, so a silently shrinking fleet is visible', () => {
  const rows = [
    ...PAYLOADS.hydraulique.lines.results,
    { centrale: 'AILLEURS', puissance_installee: 500, coordonnees_x_wgs: 6.05, coordonnees_y_wgs: 45.14 },
  ];
  const projected = projectDataset(rows, specFor('hydraulique'));
  assert.equal(projected.rows, 7);
  assert.equal(projected.positioned, 6);
  assert.equal(projected.sites.length, 6);
});

// ── Trap 2: a row is not a site ─────────────────────────────────────────────

test('six Gravelines reactor rows become ONE site of 5 460 MW', () => {
  const gravelines = site('nucleaire:GRAVELINES');
  assert.equal(PAYLOADS.nucleaire.lines.results.filter((r) => r.centrale === 'GRAVELINES').length, 6);
  assert.equal(gravelines.units, 6);
  assert.equal(gravelines.mw, 5460);
  // Every reactor row repeats the site's coordinate, so six markers would have
  // stacked on one pixel and none of them would have been wrong.
  assert.equal(DOC.sites.filter((entry) => entry.name === 'GRAVELINES').length, 1);
});

test('a hydro plant reports NO unit count, because the file publishes none', () => {
  // Not 1: the hydro file says nothing about how many groups a plant contains.
  assert.equal(site('hydraulique:BATHIE (LA)').units, null);
  assert.equal(site('hydraulique:GRAND-MAISON').units, null);
  assert.equal(specFor('hydraulique').granularity, 'plant');
});

test('the fleet totals separate sites from published units', () => {
  const totals = summarizeFleet(DOC.sites);
  assert.equal(totals.sites, 11);
  // 8 reactor rows + 5 thermal unit rows. Hydro contributes none, and
  // contributing "6 plants = 6 units" would be an invention.
  assert.equal(totals.units, 13);
  assert.equal(totals.byFiliere.hydraulique.sites, 6);
  assert.equal(totals.byFiliere.hydraulique.units, null);
  assert.equal(totals.byFiliere.nucleaire.units, 8);
  assert.equal(totals.byFiliere.thermique.units, 5);
});

// ── Trap 3: the reserve is a site figure on every unit row ──────────────────

test("Gravelines' secondary reserve is 40 MW, not six times 40", () => {
  const rows = PAYLOADS.nucleaire.lines.results.filter((r) => r.centrale === 'GRAVELINES');
  assert.deepEqual([...new Set(rows.map((r) => r.reserve_secondaire_maximale))], [40]);
  assert.equal(site('nucleaire:GRAVELINES').secondaryReserveMw, 40);
});

test('a reserve the rows disagree on collapses to null rather than to a guess', () => {
  assert.equal(siteSecondaryReserve([{ reserve_secondaire_maximale: 60 }]), 60);
  assert.equal(siteSecondaryReserve([
    { reserve_secondaire_maximale: 60 },
    { reserve_secondaire_maximale: 25 },
  ]), null);
  assert.equal(siteSecondaryReserve([{}, {}]), null);
  // A published zero is a fact, not an absence — Brennilis really publishes 0.
  assert.equal(siteSecondaryReserve([{ reserve_secondaire_maximale: 0 }]), 0);
  // And an unpublished one stays null: 23 of the 51 hydro plants leave it out.
  assert.equal(site('hydraulique:KEMBS').secondaryReserveMw, null);
  assert.equal(site('hydraulique:RANCE').secondaryReserveMw, null);
});

// ── Trap 4: three files, three vintages ─────────────────────────────────────

test('each file carries its own reference date, and they do not agree', () => {
  const byKey = Object.fromEntries(DOC.datasets.map((entry) => [entry.key, entry]));
  assert.equal(byKey.nucleaire.referenceDate, '2025-12-31');
  assert.equal(byKey.hydraulique.referenceDate, '2023-12-31');
  assert.equal(byKey.thermique.referenceDate, '2023-12-31');
  // Stamped per SITE too, so no reader can attribute one date to the whole map.
  assert.equal(site('nucleaire:CIVAUX').referenceDate, '2025-12-31');
  assert.equal(site('hydraulique:KEMBS').referenceDate, '2023-12-31');
});

test('the descriptor carries the licence the layer is obliged to show', () => {
  for (const dataset of DOC.datasets) {
    assert.equal(dataset.licence, 'Licence Ouverte / Open Licence version 2.0');
    assert.equal(dataset.licenceUrl, 'https://www.etalab.gouv.fr/licence-ouverte-open-licence');
    assert.match(dataset.page, /^https:\/\/opendata\.edf\.fr\/datasets\//);
    assert.equal(dataset.frequency, 'annual');
    assert.ok(dataset.dataUpdatedAt);
  }
});

test('a missing descriptor costs the date, never the plants', () => {
  const descriptor = describeDataset(null, specFor('nucleaire'));
  assert.equal(descriptor.referenceDate, null);
  assert.equal(descriptor.licence, null);
  assert.equal(descriptor.publishedCount, null);
  // The slug still resolves from the spec, so the record stays identifiable.
  assert.equal(descriptor.slug, specFor('nucleaire').slug);

  const doc = projectEdfPlants({ nucleaire: { meta: null, lines: PAYLOADS.nucleaire.lines } }, 'test');
  assert.equal(doc.sites.length, 2);
  assert.equal(doc.sites[0].referenceDate, null);
});

// ── What a site IS ──────────────────────────────────────────────────────────

test('a nuclear site is named by its palier, not by the fuel it happens to load', () => {
  const gravelines = site('nucleaire:GRAVELINES');
  assert.equal(gravelines.kind, 'REP 900');
  // The file DOES publish a fuel, and Gravelines mixes two of them. Carried as
  // a fact, deliberately not used as the site's kind.
  assert.equal(gravelines.fuel, 'Multi-oxyde d’uranium et de plutonium + Uranium Enrichi');
  assert.equal(site('nucleaire:CIVAUX').kind, 'REP 1450');
});

test('hydro is named by its water regime and thermal by what it burns', () => {
  assert.equal(site('hydraulique:GRAND-MAISON').kind, 'Pompage mixte');
  assert.equal(site('hydraulique:RANCE').kind, 'Marémotrice');
  assert.equal(site('thermique:CORDEMAIS').kind, 'Charbon');
  assert.equal(site('thermique:BOUCHAIN').kind, 'Gaz naturel');
  // One published string for two fuels stays one string.
  assert.equal(site('thermique:MONTEREAU').kind, 'Gaz naturel/Fioul Domestique');
  assert.equal(site('thermique:MONTEREAU').tech, 'TAC');
});

test('a sous-filière is abbreviated to the publisher’s own acronym', () => {
  assert.equal(shortenSousFiliere('Réacteur à eau pressurisée (REP) 1300'), 'REP 1300');
  assert.equal(shortenSousFiliere('Turbine à Combustion (TAC)'), 'TAC');
  // No parentheses, no invention.
  assert.equal(shortenSousFiliere('Gaz'), 'Gaz');
  assert.equal(shortenSousFiliere('Charbon'), 'Charbon');
  assert.equal(shortenSousFiliere(''), null);
  assert.equal(shortenSousFiliere(null), null);
});

test('two values on one site are joined, never silently reduced to the first', () => {
  assert.deepEqual(distinctValues([{ f: 'a' }, { f: 'b' }, { f: 'a' }], 'f'), ['a', 'b']);
  assert.deepEqual(distinctValues([{ f: '' }, { f: null }], 'f'), []);
});

// ── The rest of the shape ───────────────────────────────────────────────────

test('commissioning years survive both of the shapes they are published in', () => {
  // Hydro: an integer year. Nuclear and thermal: an ISO date.
  assert.equal(commissioningYear({ annee_de_mise_en_service: 1932 }), 1932);
  assert.equal(commissioningYear({ date_de_mise_en_service_industrielle: '1980-11-25' }), 1980);
  assert.equal(commissioningYear({ date_de_mise_en_service_industrielle: 'n/a' }), null);
  assert.equal(commissioningYear({}), null);
  assert.equal(site('hydraulique:KEMBS').commissionedFrom, 1932);
  // A multi-unit site reports the span its units were commissioned over.
  assert.equal(site('nucleaire:GRAVELINES').commissionedFrom, 1980);
  assert.equal(site('nucleaire:GRAVELINES').commissionedTo, 1985);
});

test('the three files spell a région three ways, so joins use a folded key', () => {
  assert.equal(foldRegionKey("Provence-Alpes-Côte d'Azur"), foldRegionKey("PROVENCE-ALPES-COTE D'AZUR"));
  assert.equal(foldRegionKey('Grand Est'), 'GRAND EST');
  assert.equal(foldRegionKey('AUVERGNE-RHONE-ALPES'), 'AUVERGNE RHONE ALPES');
  assert.equal(foldRegionKey(''), null);
  // Display keeps whichever spelling its own publisher used.
  assert.equal(site('hydraulique:SAINTE-CROIX').region, "Provence-Alpes-Côte d'Azur");
  assert.equal(site('thermique:MONTEREAU').region, 'ILE-DE-FRANCE');
  // La Rance is the one row in the hydro file with no région at all.
  assert.equal(site('hydraulique:RANCE').region, null);
  assert.equal(site('hydraulique:RANCE').regionKey, null);
});

test('fractional megawatts survive at full precision, and totals round once', () => {
  // The hydro file publishes decimals; the other two publish integers.
  assert.equal(site('hydraulique:SAINTE-CROIX').mw, 132.27);
  assert.equal(site('hydraulique:GRANDVAL').mw, 74.1);
  const totals = summarizeFleet(DOC.sites);
  assert.equal(totals.capacityMw, 13489.47);
  assert.equal(totals.byFiliere.hydraulique.capacityMw, 2924.47);
  assert.equal(totals.byFiliere.nucleaire.capacityMw, 8450);
});

test('the hydro file really does carry plants below its own 100 MW threshold', () => {
  // The published exception: plants whose secondary reserve reaches 20 MW.
  const grandval = site('hydraulique:GRANDVAL');
  assert.ok(grandval.mw < 100);
  assert.ok(grandval.secondaryReserveMw >= 20);
});

test('every site names the operator whose fleet this actually is', () => {
  for (const entry of DOC.sites) assert.equal(entry.operator, 'EDF SA');
});

test('sites come back biggest first, with a stable tie-break', () => {
  const capacities = DOC.sites.map((entry) => entry.mw);
  assert.deepEqual(capacities, [...capacities].sort((a, b) => b - a));
  assert.equal(DOC.sites[0].id, 'nucleaire:GRAVELINES');
});

test('a filière that failed to fetch is absent, not empty', () => {
  const partial = projectEdfPlants({
    nucleaire: PAYLOADS.nucleaire,
    hydraulique: null,
    thermique: { meta: PAYLOADS.thermique.meta, lines: null },
  }, 'test');
  assert.deepEqual(partial.datasets.map((entry) => entry.key), ['nucleaire']);
  assert.equal(partial.totals.byFiliere.hydraulique, undefined);
  assert.equal(partial.sites.length, 2);

  const nothing = projectEdfPlants(null, 'test');
  assert.deepEqual(nothing.sites, []);
  assert.deepEqual(nothing.datasets, []);
  assert.equal(nothing.totals.capacityMw, null);
});

test('a short page is reported as truncated rather than served as the fleet', () => {
  const doc = projectEdfPlants({
    nucleaire: {
      meta: PAYLOADS.nucleaire.meta,
      // The envelope's own total says there are more rows than arrived.
      lines: { total: 56, results: PAYLOADS.nucleaire.lines.results },
    },
  }, 'test');
  assert.equal(doc.datasets[0].truncated, true);
  assert.equal(doc.datasets[0].receivedRows, 8);
  assert.equal(doc.datasets[0].publishedCount, 56);
  // And a complete page is not flagged.
  assert.equal(DOC.datasets.every((entry) => entry.truncated === false), true);
});
