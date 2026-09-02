// src/data/meteoStationsFrFeed.test.mjs
// Pins the UPSTREAM SHAPES this layer joins, against captured files: the
// real-time station list's columns, the parameter vocabulary that separates an
// instrument from a derived statistic, the SYNOP archive's kelvins and pascals,
// and the fiche climatologique — a human-readable French report parsed for two
// records. The layer's presentation is covered in meteoStationsFrance.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FAMILY_BY_ANCHOR,
  FAMILY_BY_KEY,
  FAMILY_KEYS,
  INSTRUMENT_FAMILIES,
  STATION_CLASSES,
  STATION_CLASS_ORDER,
  SYNOPTIC_CORE,
  classifyStation,
  compassPoint,
  departementOf,
  describeInstruments,
  familiesFromFiche,
  finiteOrNull,
  kelvinToCelsius,
  parseFicheClim,
  projectStationRow,
  reduceSynopArchive,
  splitSemicolon,
  summarizeStations,
} from './meteoStationsFrFeed.js';

const STATIONS = JSON.parse(readFileSync(
  new URL('./fixtures/meteo-stations-fr-sample.json', import.meta.url),
  'utf8',
));
const byName = (name) => STATIONS.find((station) => station.name === name);

test('the real-time list projects to a station, and refuses a row that is not one', () => {
  const row = {
    Id_station: '01014002',
    Id_omm: '',
    Nom_usuel: 'ARBENT',
    Latitude: '46.278167',
    Longitude: '5.669000',
    Altitude: '534',
    Date_ouverture: '2003-10-01',
    Pack: 'RADOME',
  };
  const station = projectStationRow(row);
  assert.equal(station.id, '01014002');
  assert.equal(station.name, 'ARBENT');
  assert.equal(station.lat, 46.278167);
  assert.equal(station.pack, 'RADOME');
  assert.equal(station.dep, '01');
  // 287 stations carry a WMO number and 1 857 do not; an empty cell is null,
  // never the empty string, so `station.omm` is a usable truth test.
  assert.equal(station.omm, null);

  assert.equal(projectStationRow({ ...row, Id_station: '' }), null);
  assert.equal(projectStationRow({ ...row, Id_station: 'ABCDEFGH' }), null);
  assert.equal(projectStationRow({ ...row, Latitude: '' }), null);
  // A pack the publisher has never used is dropped rather than carried into
  // the palette as a third, unstyled value.
  assert.equal(projectStationRow({ ...row, Pack: 'MYSTERE' }).pack, null);
});

test('overseas identifiers are three digits and Corsica is 20', () => {
  // NUM_POSTE is DDCCCNNN on the 1976 numbering. Guadeloupe is 971, not 97,
  // and no station in France carries 2A or 2B — the identifier is the join key
  // and inventing the modern code would break it.
  assert.equal(departementOf('97105002'), '971');
  assert.equal(departementOf('97412801'), '974');
  assert.equal(departementOf('98832001'), '988');
  assert.equal(departementOf('20004002'), '20');
  assert.equal(departementOf('01014002'), '01');
  assert.equal(departementOf('1014002'), '01', 'a 7-digit id is left-padded, not rejected');
  assert.equal(departementOf('nope'), null);
});

test('an instrument family is anchored on an hourly reading, not on a keyword', () => {
  // This is the whole reason the anchors exist. Météo-France publishes 254
  // parameter names for this network and most are DERIVED statistics; matching
  // on the word would count a degree-day accumulator as a thermometer and a
  // decadal wind average — present on 879 stations — as an anemometer, when
  // only 845 have one.
  const fiche = {
    parametres: [
      { nom: 'TEMPERATURE SOUS ABRI HORAIRE', dateFin: '' },
      { nom: 'MOYENNE DECADAIRE DE LA FORCE DU VENT', dateFin: '' },
      { nom: 'NOMBRE DE JOURS AVEC TX>=35°C', dateFin: '' },
      { nom: 'CUMUL DES DJU SEUIL 18 METHODE CHAUFFAGISTE', dateFin: '' },
    ],
  };
  assert.deepEqual(familiesFromFiche(fiche), ['temp']);
});

test('a decommissioned instrument is not a present one', () => {
  const fiche = {
    parametres: [
      { nom: 'TEMPERATURE SOUS ABRI HORAIRE', dateFin: '' },
      // The mast came down; reading this would report an anemometer that is
      // not there.
      { nom: 'VITESSE DU VENT HORAIRE', dateFin: '2011-06-30 00:00:00' },
    ],
  };
  assert.deepEqual(familiesFromFiche(fiche), ['temp']);
});

test('no fiche is not an empty fiche', () => {
  // A station whose inventory says it measures nothing and a station whose
  // inventory does not exist are different facts, and only the second is
  // `unknown`. Six stations in the network are the second.
  assert.equal(familiesFromFiche(null), null);
  assert.equal(familiesFromFiche({}), null);
  assert.deepEqual(familiesFromFiche({ parametres: [] }), []);
  assert.equal(classifyStation(null), 'unknown');
  assert.equal(classifyStation([]), 'other');
  assert.equal(byName('ALBA LA ROMAINE').klass, 'unknown');
  assert.equal(byName('ALBA LA ROMAINE').fam, null);
});

test('the classes are the measured capability, in order', () => {
  assert.equal(classifyStation(['temp', 'rain', 'wind', 'humidity', 'pressure']), 'synoptic');
  assert.equal(classifyStation(['temp', 'rain', 'wind', 'humidity']), 'wind');
  assert.equal(classifyStation(['temp', 'rain']), 'temp-rain');
  assert.equal(classifyStation(['temp']), 'thermo');
  assert.equal(classifyStation(['rain']), 'rain');
  assert.equal(classifyStation(['road', 'visibility']), 'other');

  assert.equal(byName('TOULOUSE-BLAGNAC').klass, 'synoptic');
  assert.equal(byName('ARBENT').klass, 'wind');
  assert.equal(byName('VERIZIEU').klass, 'temp-rain');
  assert.equal(byName('BREIL SUR ROYA').klass, 'rain');

  // Every class the classifier can return has a palette entry and a legend
  // slot, or a station would be drawn in no colour at all.
  const produced = new Set(STATION_CLASS_ORDER);
  for (const key of produced) assert.ok(STATION_CLASSES[key], `${key} has no style`);
  assert.deepEqual([...produced].sort(), Object.keys(STATION_CLASSES).sort());
});

test('the anchors and the family table agree with each other', () => {
  assert.equal(INSTRUMENT_FAMILIES.length, 14);
  assert.equal(FAMILY_KEYS.length, 14);
  assert.equal(new Set(FAMILY_KEYS).size, 14, 'family keys are unique');
  assert.equal(Object.keys(FAMILY_BY_ANCHOR).length, 14, 'anchors are unique');
  for (const family of INSTRUMENT_FAMILIES) {
    assert.equal(FAMILY_BY_ANCHOR[family.anchor], family.key);
    assert.equal(FAMILY_BY_KEY[family.key], family);
  }
  // The synoptic core has to be spelled with real family keys, or the
  // classifier would silently never return `synoptic`.
  for (const key of SYNOPTIC_CORE) assert.ok(FAMILY_BY_KEY[key], `${key} is not a family`);
});

test('a card is told what is missing from the five it assumed, not from all fourteen', () => {
  const { measures, missing } = describeInstruments(['temp', 'rain', 'snow']);
  assert.deepEqual(measures, ['température', 'précipitations', 'neige au sol']);
  // Not "ne mesure pas l'état de la mer" under a station in the Cantal.
  // Ordered like `measures`, by how many stations carry the family, so the two
  // halves of one card read as one list.
  assert.deepEqual(missing, ['humidité', 'vent à 10 m', 'pression']);
  assert.deepEqual(describeInstruments(null), { measures: [], missing: [] });
});

test('the summary separates what publishes from what is merely listed', () => {
  const stats = summarizeStations(STATIONS);
  assert.equal(stats.stations, STATIONS.length);
  assert.equal(stats.metropole + stats.overseas, STATIONS.length);
  // CAP CEPET is named in Météo-France's SYNOP list and has written no
  // observation all year; BOULOGNE-SEM publishes hourly and is not on the
  // list. The two fields must not collapse into one.
  assert.equal(byName('CAP CEPET').synop, true);
  assert.equal(byName('CAP CEPET').live, false);
  assert.equal(byName('BOULOGNE-SEM').synop, false);
  assert.equal(byName('BOULOGNE-SEM').live, true);
  assert.ok(stats.synop >= 1 && stats.live >= 1);
  // MARSILLARGUES closed on 2026-01-01 and is still in the real-time list.
  assert.equal(byName('MARSILLARGUES').closed, '2026-01-01');
  assert.ok(stats.closed >= 1);
});

test('the SYNOP archive reduces to the newest observation per station', () => {
  const text = readFileSync(
    new URL('./fixtures/meteo-synop-archive-sample.csv', import.meta.url), 'utf8',
  );
  const { observations, rows, newest } = reduceSynopArchive(text.split('\n'));
  assert.ok(rows > 0);
  const toulouse = observations['07630'];
  assert.ok(toulouse, 'Toulouse-Blagnac is in the fixture');
  assert.equal(toulouse.name, 'TOULOUSE-BLAGNAC');
  // The fixture interleaves stations, so "newest wins" cannot pass by
  // accidentally keeping the last row of the file.
  for (const observation of Object.values(observations)) {
    assert.ok(observation.at <= newest);
  }
  const hours = text.split('\n').slice(1).filter(Boolean)
    .filter((line) => line.split(';')[2] === '07630')
    .map((line) => line.split(';')[7]);
  assert.equal(toulouse.at, hours.sort().at(-1), 'kept the latest validity_time, not the last row');
});

test('the archive is in kelvin and pascals, and the card never sees either', () => {
  const text = readFileSync(
    new URL('./fixtures/meteo-synop-archive-sample.csv', import.meta.url), 'utf8',
  );
  const { observations } = reduceSynopArchive(text.split('\n'));
  for (const observation of Object.values(observations)) {
    if (observation.tempC !== null) {
      assert.ok(observation.tempC > -90 && observation.tempC < 60, `${observation.tempC} °C is not a temperature`);
    }
    if (observation.pressureHpa !== null) {
      assert.ok(
        observation.pressureHpa > 850 && observation.pressureHpa < 1100,
        `${observation.pressureHpa} hPa is not a pressure`,
      );
    }
  }
  assert.equal(kelvinToCelsius('273.15'), 0);
  assert.equal(kelvinToCelsius('294.25'), 21.1);
  assert.equal(kelvinToCelsius(''), null);
});

test('a renamed column fails loudly instead of returning empty readings', () => {
  // Silently producing 190 null cards is the failure mode this guard exists to
  // prevent: it looks like an outage and is a schema change.
  assert.throws(
    () => reduceSynopArchive(['lat;lon;name;validity_time', '1;2;X;2026-01-01T00:00:00Z']),
    /geo_id_wmo/,
  );
});

test('a genuine zero survives, an empty cell does not', () => {
  // `rr1 = 0.0` means "it did not rain", which is information a card should
  // print; an empty cell means the station did not report.
  assert.equal(finiteOrNull('0.0'), 0);
  assert.equal(finiteOrNull(''), null);
  assert.equal(finiteOrNull(null), null);
  assert.equal(finiteOrNull('12,5'), 12.5, 'a French decimal comma is read');
});

test('the compass names the direction the wind blows from', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(90), 'E');
  assert.equal(compassPoint(310), 'NO');
  assert.equal(compassPoint(360), 'N');
  assert.equal(compassPoint(-45), 'NO');
  assert.equal(compassPoint(''), null);
});

test('the fiche climatologique yields the records and the window they stand in', () => {
  const text = readFileSync(
    new URL('./fixtures/meteo-ficheclim-31069001-sample.data', import.meta.url), 'utf8',
  );
  const fiche = parseFicheClim(text);
  assert.equal(fiche.station, 'TOULOUSE-BLAGNAC (31)');
  assert.equal(fiche.high.value, 42.4);
  assert.equal(fiche.high.date, '2023');
  assert.equal(fiche.low.value, -19.2);
  assert.equal(fiche.low.date, '1956');
  // The window is the point: 42,4 °C means something different at a station
  // open since 1947 than at one open since 2004.
  assert.match(fiche.period, /^01-01-1947 → \d{2}-\d{2}-\d{4}$/);
});

test('a fiche whose shape changed shows nothing rather than a record with no date', () => {
  assert.equal(parseFicheClim(''), null);
  assert.equal(parseFicheClim('FICHE CLIMATOLOGIQUE;\n'.repeat(10)), null);
  const text = readFileSync(
    new URL('./fixtures/meteo-ficheclim-31069001-sample.data', import.meta.url), 'utf8',
  );
  // Drop the cold record's heading: a half-parsed fiche is refused whole.
  assert.equal(parseFicheClim(text.replace('La température la plus basse', 'Autre chose')), null);
});

test('every Météo-France CSV in this layer is unquoted, so a plain split is honest', () => {
  assert.deepEqual(splitSemicolon('a; b ;c'), ['a', 'b', 'c']);
  assert.deepEqual(splitSemicolon(''), ['']);
  const text = readFileSync(
    new URL('./fixtures/meteo-synop-archive-sample.csv', import.meta.url), 'utf8',
  );
  assert.equal(text.includes('"'), false, 'the archive quotes nothing');
});
