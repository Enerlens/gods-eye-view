// src/data/rteGenerationFeed.test.mjs
// Pins the two upstreams behind the Groupes de prod (FR) layer: ODRÉ's national
// register of generating units (real captured rows) and RTE's
// actual_generations_per_unit (a contract fixture — see fixtures/README.md).
// This is the projection the dev-server proxy and the authoring script both
// run, so it is where a schema drift shows up first, and it is where the
// register's kilowatts, its four naming grammars and its photovoltaic-filed-as-
// thermal row are absorbed along with RTE's zeroes, nulls and negatives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RTE_ACTUAL_GENERATIONS_PER_UNIT_URL,
  RTE_CLASS_ORDER,
  RTE_GENERATION_CLASSES,
  RTE_TOKEN_URL,
  RTE_UNIT_FLOOR_MW,
  classifyRegistreRow,
  classifyRteProductionType,
  composeSiteName,
  formatRteDate,
  generationSparkline,
  groupRegistreSites,
  adoptUnitsByStationName,
  joinGenerationToRegistry,
  latestMeasured,
  measuredHistory,
  mergeUnitValues,
  normalizeStationName,
  parisDayStart,
  parisOffsetMinutes,
  parseGenerationValue,
  parseInstallationName,
  parseRegistreDate,
  projectActualGenerations,
  projectRegistreUnit,
  publishedStepMinutes,
  registreKwToMw,
  rteGenerationClass,
  rteStationNameOf,
  stationNameMatch,
  rteGenerationWindow,
  rteProductionTypeLabel,
  titleCaseStationName,
} from './rteGenerationFeed.js';

const REGISTRE = JSON.parse(readFileSync(
  new URL('./fixtures/rte-registre-units-sample.json', import.meta.url),
  'utf8',
));
const GENERATION = JSON.parse(readFileSync(
  new URL('./fixtures/rte-actual-generation-sample.json', import.meta.url),
  'utf8',
));

const rowByEic = (eic) => REGISTRE.results.find((row) => row.codeeicresourceobject === eic);

// --- The captured rows still say what the projection reads ------------------

test('the captured payloads still carry the fields the projection reads', () => {
  assert.ok(Array.isArray(REGISTRE.results) && REGISTRE.results.length >= 16);
  for (const field of [
    'codeeicresourceobject', 'nominstallation', 'puismaxinstallee', 'postesource',
    'filiere', 'technologie', 'combustible', 'commune', 'codeinseecommune', 'regime',
  ]) {
    assert.ok(field in REGISTRE.results[0], field);
  }
  // The generation fixture is a REAL capture now, so it also pins what v1.1
  // does NOT send: no unit carries an installed capacity (trap 7).
  const envelopes = GENERATION.actual_generations_per_unit;
  assert.equal(envelopes.length, 8);
  for (const envelope of envelopes) {
    assert.ok(envelope.unit.eic_code, 'every captured unit has an EIC');
    assert.ok(envelope.unit.name && envelope.unit.production_type);
    assert.equal('installed_capacity' in envelope.unit, false);
    for (const value of envelope.values) {
      assert.ok(value.updated_date, 'every captured row carries updated_date');
    }
  }
});

test('the endpoints are the ones this build measured', () => {
  assert.equal(RTE_TOKEN_URL, 'https://digital.iservices.rte-france.com/token/oauth/');
  assert.equal(
    RTE_ACTUAL_GENERATIONS_PER_UNIT_URL,
    'https://digital.iservices.rte-france.com/open_api/actual_generation/v1/actual_generations_per_unit',
  );
  assert.equal(RTE_UNIT_FLOOR_MW, 100);
});

// --- Register: units are published in KILOWATTS -----------------------------

test('puismaxinstallee is kilowatts, and one plant is split across two groups to three decimals', () => {
  // 1 310 000 is a 1 310 MW reactor. Reading it as megawatts makes the French
  // fleet a thousand times the planet's.
  assert.equal(registreKwToMw(rowByEic('17W100P100P0090I').puismaxinstallee), 1310);

  const brommat6 = rowByEic('17W000000012816Y').puismaxinstallee;
  const brommat7 = rowByEic('17W000000012953O').puismaxinstallee;
  assert.equal(brommat6, 180357.261);
  assert.equal(brommat7, 225642.739);
  assert.equal(brommat6 + brommat7, 406000);
  // Rounded to a tenth of a megawatt each, the pair still sums to the plant.
  assert.equal(registreKwToMw(brommat6) + registreKwToMw(brommat7), 406);

  assert.equal(registreKwToMw(0), null);
  assert.equal(registreKwToMw(null), null);
  assert.equal(registreKwToMw('not a number'), null);
});

test('parseRegistreDate reads the register’s DD/MM/YYYY and passes ISO through', () => {
  assert.equal(parseRegistreDate('07/01/2009'), '2009-01-07');
  assert.equal(parseRegistreDate('2009-01-07'), '2009-01-07');
  assert.equal(parseRegistreDate(''), null);
  assert.equal(parseRegistreDate(null), null);
});

// --- Register: classification -----------------------------------------------

test('a photovoltaic farm filed under “Thermique non renouvelable” is solar, not thermal', () => {
  // The 132 MW Ajaccio row. Classifying on `filiere` alone paints a solar farm
  // as a thermal power station, which is why `technologie` is consulted first.
  const ajaccio = REGISTRE.results.find((row) => row.technologie === 'Photovoltaïque');
  assert.equal(ajaccio.filiere, 'Thermique non renouvelable');
  assert.equal(classifyRegistreRow(ajaccio), 'solar');
});

test('the Rance is tidal even though the register names it a hydro plant', () => {
  const rance = rowByEic('17W100P100P0272C');
  assert.match(rance.nominstallation, /CENTRALE HYDRAULIQUE DE RANCE/);
  assert.equal(rance.filiere, 'Energies Marines');
  assert.equal(classifyRegistreRow(rance), 'marine');
});

test('the register’s own filière splits land on the shared classes', () => {
  assert.equal(classifyRegistreRow(rowByEic('17W100P100P0090I')), 'nuclear');
  assert.equal(classifyRegistreRow(rowByEic('17W100P100P02756')), 'hydro-pumped');
  assert.equal(classifyRegistreRow(rowByEic('17W000000012816Y')), 'hydro-reservoir');
  // Same site, two fuels: coal turbine and combined-cycle gas.
  assert.equal(classifyRegistreRow(rowByEic('17W100P100P0005Z')), 'fossil-coal');
  assert.equal(classifyRegistreRow(rowByEic('17W100P100P00105')), 'fossil-gas');
  assert.equal(classifyRegistreRow(rowByEic('17W0000014455651')), 'wind');
  assert.equal(classifyRegistreRow(rowByEic('17W000002385265P')), 'battery');
  // A row that says nothing is drawn as `other`, not dropped.
  assert.equal(classifyRegistreRow({}), 'other');
  assert.equal(classifyRegistreRow(null), 'other');
});

test('every class the register can produce has a legend row, in a stable order', () => {
  assert.equal(RTE_CLASS_ORDER.length, Object.keys(RTE_GENERATION_CLASSES).length);
  assert.deepEqual([...new Set(RTE_CLASS_ORDER)], RTE_CLASS_ORDER);
  for (const row of REGISTRE.results) {
    assert.ok(RTE_CLASS_ORDER.includes(classifyRegistreRow(row)), row.nominstallation);
  }
  assert.equal(rteGenerationClass('nope').id, 'other');
});

// --- Register: four naming grammars in one column ---------------------------

test('nominstallation is parsed across all four of its grammars', () => {
  const cases = [
    // The parenthetical here is NOT an article, so it stays where the
    // register put it — it is disambiguating, not sorting.
    ['17W100P100P0090I', 'BVIL7N01', 'Groupe 01', /^BELLEVILLE \(BELLEVILLE-SUR-LOIRE\)$/],
    // The article is parked at the end for index sorting; it belongs at the front.
    ['17W100P100P0149B', 'TRICAN01', 'Groupe 01', /^LE TRICASTIN$/],
    ['17W100P100P0279Z', 'AIGLEH', 'Groupe 6', /^L’AIGLE$/],
    ['17W000000918390N', 'MORA5T01', 'Groupe 01', /^LES MORANDES$/],
    // The hydro grammar glues the group ordinal to the site name.
    ['17W000000012953O', 'BROMMH', 'Groupe 7', /^BROMMAT$/],
    // The storage grammar hides its ordinal inside the introducer, so the
    // number comes from the register's own unit code instead.
    ['17W000002385265P', 'SSLAIS01', 'Groupe 01', /SAINT-LAID/],
    // An accented FERME ÉOLIENNE, which a plain-ASCII introducer list misses.
    ['17W0000014455651', 'B.GUEEA1', 'Adp A1', /BANC-DE-GUERANDE/],
  ];
  // `parseInstallationName` returns the register's own casing; the title-case
  // and the French contractions happen later, in `composeSiteName`.
  for (const [eic, code, unit, site] of cases) {
    const parsed = parseInstallationName(rowByEic(eic).nominstallation);
    assert.equal(parsed.code, code, eic);
    assert.equal(parsed.unit, unit, eic);
    assert.match(parsed.site, site, eic);
    assert.equal(parsed.confidential, false);
  }
});

test('a Confidentiel row is named null, not "Confidentiel"', () => {
  const hidden = REGISTRE.results.find((row) => row.nominstallation === 'Confidentiel');
  const parsed = parseInstallationName(hidden.nominstallation);
  assert.deepEqual(parsed, { code: null, unit: null, site: null, confidential: true });
  // It also carries no `postesource`, so it falls back to its commune — which
  // is the honest grouping for a unit that is not on RTE's grid at all.
  assert.equal(hidden.postesource, null);
  assert.equal(projectRegistreUnit(hidden).site, `INSEE:${hidden.codeinseecommune}`);
});

test('titleCaseStationName keeps particles down, roman numerals up, and hyphens intact', () => {
  assert.equal(titleCaseStationName('ST-LAURENT-DES-EAUX B'), 'St-Laurent-des-Eaux B');
  assert.equal(titleCaseStationName('PIED-DE-BORNE'), 'Pied-de-Borne');
  // `Saussaz Ii` is not a word in any language.
  assert.equal(titleCaseStationName('SAUSSAZ II'), 'Saussaz II');
  assert.equal(titleCaseStationName(''), '');
});

test('composeSiteName contracts the French the register spells out', () => {
  assert.equal(composeSiteName('nuclear', 'Le Bugey'), 'Centrale nucléaire du Bugey');
  assert.equal(composeSiteName('fossil-gas', 'Les Morandes'), 'Centrale thermique des Morandes');
  assert.equal(composeSiteName('hydro-reservoir', 'La Bathie'), 'Centrale hydraulique de la Bathie');
  assert.equal(composeSiteName('hydro-reservoir', 'L’Aigle'), 'Centrale hydraulique de l’Aigle');
  // `de Avignon` is not French.
  assert.equal(composeSiteName('hydro-run-of-river', 'AVIGNON'), 'Centrale hydraulique d’Avignon');
  // The register omits the space before its parentheses.
  assert.equal(
    composeSiteName('biomass', 'PROVENCE(EX GARD5)'),
    'Centrale biomasse de Provence (Ex Gard5)',
  );
  assert.equal(composeSiteName('marine', 'RANCE'), 'Usine marémotrice de Rance');
});

test('normalizeStationName folds the abbreviation that makes ODRÉ and OSM the same station', () => {
  // The register writes ST-ALBAN-ST-MAURICE; OpenStreetMap writes Saint-Alban.
  assert.ok(
    normalizeStationName('ST-ALBAN-ST-MAURICE')
      .includes(normalizeStationName("Centre Nucléaire de Production d'Electricité de Saint-Alban")),
  );
  assert.equal(normalizeStationName('STE-CROIX-DU-VERDON'), 'SAINT CROIX VERDON');
  assert.equal(normalizeStationName('Sainte-Croix'), 'SAINT CROIX');
  assert.equal(normalizeStationName(null), '');
});

test('stationNameMatch scores on tokens, so a substring cannot fake a match', () => {
  const n = normalizeStationName;
  // Identity beats containment, which is what disambiguates EDF's own
  // `BISSORTE` from its `SUPER-BISSORTE` in the same file.
  assert.equal(stationNameMatch(n('SUPER-BISSORTE'), n('SUPER-BISSORTE')), 2);
  assert.equal(stationNameMatch(n('SUPER-BISSORTE'), n('BISSORTE')), 1);

  // The register's spelling against EDF's, on the stations where they differ.
  assert.equal(stationNameMatch(n('ST-CHAMAS'), n('SAINT-CHAMAS')), 2);
  assert.equal(stationNameMatch(n('STE-CROIX-DU-VERDON'), n('SAINTE-CROIX')), 1);
  assert.equal(stationNameMatch(n('VAIRES-SUR-MARNE'), n('VAIRES SUR MARNE')), 2);
  assert.equal(stationNameMatch(n('COMBE D AVRIEUX'), n("COMBE-D'AVRIEUX")), 2);
  assert.equal(stationNameMatch(n('BELLEVILLE (BELLEVILLE-SUR-LOIRE)'), n('BELLEVILLE')), 1);

  // The reason this is not `String.includes`: it is, and `DURANCE` contains
  // `RANCE`, which would put the tidal barrage on a Provençal river.
  assert.equal('DURANCE'.includes('RANCE'), true);
  assert.equal(stationNameMatch(n('DURANCE'), n('RANCE')), 0);
  assert.equal(stationNameMatch(n('BORT'), n('BORT-LES-ORGUES')), 1);
  assert.equal(stationNameMatch('', 'RANCE'), 0);
  assert.equal(stationNameMatch(null, null), 0);
});

// --- Register: grouping into stations ---------------------------------------

test('the site key is the connection substation, not the commune', () => {
  const units = REGISTRE.results.map(projectRegistreUnit).filter(Boolean);
  const sites = groupRegistreSites(units);
  const byId = new Map(sites.map((site) => [site.id, site]));

  // Brommat and Sarrans are two different plants in the SAME commune. Grouping
  // on the commune would merge them into one 589 MW station that does not exist.
  assert.equal(rowByEic('17W000000012816Y').commune, 'Brommat');
  assert.equal(rowByEic('17W100P100P02934').commune, 'Brommat');
  assert.equal(byId.get('BROMM').units.length, 2);
  assert.equal(byId.get('SARRA').units.length, 1);
  assert.equal(byId.get('BROMM').mw, 406);

  // Émile-Huchet is one station holding two fuels. It takes the class with the
  // most installed power and reports the whole mix rather than hiding the rest.
  const huchet = byId.get('E.HUC');
  assert.equal(huchet.units.length, 2);
  assert.equal(huchet.class, 'fossil-coal');
  assert.deepEqual(huchet.classes, { 'fossil-coal': 600, 'fossil-gas': 433.9 });

  // A confidential unit still gets a site, named from its commune.
  const confidential = sites.find((site) => site.id.startsWith('INSEE:'));
  assert.match(confidential.name, /Ajaccio$/);

  // Most installed power first, deterministic on ties.
  const powers = sites.map((site) => site.mw);
  assert.deepEqual(powers, [...powers].sort((a, b) => b - a));
});

test('projectRegistreUnit drops a row with no EIC code and keeps everything else', () => {
  assert.equal(projectRegistreUnit({ nominstallation: 'X' }), null);
  const unit = projectRegistreUnit(rowByEic('17W100P100P0090I'));
  assert.equal(unit.eic, '17W100P100P0090I');
  assert.equal(unit.site, 'BVIL7');
  assert.equal(unit.class, 'nuclear');
  assert.equal(unit.mw, 1310);
  assert.equal(unit.commune, 'Belleville-sur-Loire');
  assert.equal(unit.insee, '18026');
  assert.equal(unit.kv, '400 kV');
  assert.equal(unit.regime, 'En service');
});

// --- Time, in the timezone the grid is dispatched in ------------------------

test('the Paris offset is derived, not hardcoded, on both sides of the changeover', () => {
  assert.equal(parisOffsetMinutes(new Date('2026-01-15T12:00:00Z')), 60);
  assert.equal(parisOffsetMinutes(new Date('2026-07-15T12:00:00Z')), 120);
});

test('parisDayStart lands on Paris midnight, including on the changeover days', () => {
  assert.equal(parisDayStart(new Date('2026-08-28T10:00:00Z')).toISOString(), '2026-08-27T22:00:00.000Z');
  assert.equal(formatRteDate(parisDayStart(new Date('2026-08-28T10:00:00Z'))), '2026-08-28T00:00:00+02:00');
  // Spring forward is 2026-03-29 at 02:00; the midnight before it is still +01.
  assert.equal(formatRteDate(parisDayStart(new Date('2026-03-29T10:00:00Z'))), '2026-03-29T00:00:00+01:00');
  // Autumn back is 2026-10-25; the midnight after it is +01, the one before +02.
  assert.equal(formatRteDate(parisDayStart(new Date('2026-10-25T10:00:00Z'), 1)), '2026-10-26T00:00:00+01:00');
  assert.equal(formatRteDate(parisDayStart(new Date('2026-10-25T10:00:00Z'), -1)), '2026-10-24T00:00:00+02:00');
});

test('the window always spans a day boundary, so 00:30 is not an empty answer', () => {
  // 00:30 Paris. A window over TODAY holds half an hour of a day that has not
  // been published yet; this one always reaches back through a full day.
  const early = rteGenerationWindow(new Date('2026-08-28T22:30:00Z'));
  assert.equal(early.startDate, '2026-08-28T00:00:00+02:00');
  assert.equal(early.endDate, '2026-08-30T00:00:00+02:00');
  assert.equal(early.end - early.start, 48 * 3600_000);

  const midday = rteGenerationWindow(new Date('2026-08-28T10:15:00Z'));
  assert.equal(midday.startDate, '2026-08-27T00:00:00+02:00');
  assert.equal(midday.endDate, '2026-08-29T00:00:00+02:00');
});

// --- RTE: the eight traps ----------------------------------------------------

test('trap 1 — zero is a reading, not a gap', () => {
  assert.equal(parseGenerationValue(0), 0);
  assert.equal(parseGenerationValue('0'), 0);
  // The coercions that turn absence into a running-at-zero reactor.
  assert.equal(parseGenerationValue(null), null);
  assert.equal(parseGenerationValue(''), null);
  assert.equal(parseGenerationValue(undefined), null);
  assert.equal(parseGenerationValue(false), null);
  assert.equal(parseGenerationValue('  '), null);
  assert.equal(parseGenerationValue(-1180), -1180);
  assert.equal(parseGenerationValue(Number.NaN), null);

  // MEASURED: Gravelines 5 sat at exactly 0 MW in the capture — a reactor in
  // outage, and a reading, not a gap.
  const { units } = projectActualGenerations(GENERATION);
  const gravelines = units.find((unit) => unit.name === 'GRAVELINES 5');
  assert.equal(gravelines.mw, 0);
  assert.equal(gravelines.class, 'nuclear');
  assert.notEqual(gravelines.at, null, 'measured, which is not the same as absent');
});

test('trap 2 — the last row MIGHT be the future (defensive; v1.1 sends no nulls)', () => {
  // The capture contains zero nulls across every row, so this guard never
  // fires against v1.1. It is pinned on a hand-built series because the schema
  // permits a null `value` and éCO2mix pads exactly this way.
  const rows = GENERATION.actual_generations_per_unit.flatMap((entry) => entry.values);
  assert.equal(rows.filter((row) => row.value === null).length, 0, 'v1.1 sends no nulls');

  const padded = mergeUnitValues([
    { start_date: '2026-08-28T10:00:00+02:00', value: 900 },
    { start_date: '2026-08-28T11:00:00+02:00', value: 655 },
    { start_date: '2026-08-28T12:00:00+02:00', value: null },
    { start_date: '2026-08-28T13:00:00+02:00', value: null },
  ]);
  assert.equal(padded.at(-1).mw, null, 'the last ELEMENT is the unpublished future');
  assert.equal(latestMeasured(padded).mw, 655, 'the last READING is not');
});

test('trap 3 — a negative reading is a station drawing from the grid', () => {
  const { units, stats } = projectActualGenerations(GENERATION);
  // MEASURED, and not what the contract-only draft assumed: the deepest
  // negative in the whole capture is a REACTOR, not a pump. Chooz 1 is shut
  // down and buying back its own coolant pumps and instruments.
  const chooz = units.find((unit) => unit.name === 'CHOOZ 1');
  assert.equal(chooz.mw, -58);
  assert.equal(chooz.class, 'nuclear');
  assert.equal(chooz.productionType, 'NUCLEAR');
  assert.ok(stats.pumping >= 1, 'counted as consumption');
  // And it drags the national total down, because it genuinely is load.
  const positive = units.filter((unit) => unit.mw > 0).reduce((sum, u) => sum + u.mw, 0);
  assert.ok(stats.totalMw < positive);
});

test('trap 4 — values are sorted by time (defensive; v1.1 arrives sorted)', () => {
  for (const entry of GENERATION.actual_generations_per_unit) {
    const dates = entry.values.map((value) => value.start_date);
    assert.deepEqual(dates, [...dates].sort(), `${entry.unit.name} arrived sorted`);
  }
  const scrambled = mergeUnitValues([
    { start_date: '2026-08-28T11:00:00+02:00', value: 3 },
    { start_date: '2026-08-28T09:00:00+02:00', value: 1 },
    { start_date: '2026-08-28T10:00:00+02:00', value: 2 },
  ]);
  assert.deepEqual(scrambled.map((value) => value.mw), [1, 2, 3]);
  assert.equal(latestMeasured(scrambled).mw, 3);
});

test('trap 5 — one EIC in two envelopes is merged (defensive; v1.1 sends one each)', () => {
  const envelopes = GENERATION.actual_generations_per_unit;
  assert.equal(new Set(envelopes.map((e) => e.unit.eic_code)).size, envelopes.length);

  // Each envelope carries its OWN start/end, a shape that only makes sense if a
  // unit may be split across several — so the merge is kept.
  const split = projectActualGenerations({
    actual_generations_per_unit: [
      { unit: { eic_code: 'X', production_type: 'NUCLEAR' }, values: [{ start_date: '2026-08-27T22:00:00+02:00', value: 1 }] },
      { unit: { eic_code: 'X', production_type: 'NUCLEAR' }, values: [{ start_date: '2026-08-28T12:00:00+02:00', value: 2 }] },
    ],
  });
  assert.equal(split.units.length, 1);
  assert.deepEqual(split.units[0].history, [1, 2]);
});

test('trap 6 — a republished hour is resolved on updated_date, not on order', () => {
  const merged = mergeUnitValues([
    { start_date: '2026-08-28T12:00:00+02:00', value: 44, updated_date: '2026-08-28T13:04:00+02:00' },
    { start_date: '2026-08-28T12:00:00+02:00', value: 172, updated_date: '2026-08-28T14:31:00+02:00' },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].mw, 172);

  // Reversed arrival order, same answer.
  const reversed = mergeUnitValues([
    { start_date: '2026-08-28T12:00:00+02:00', value: 172, updated_date: '2026-08-28T14:31:00+02:00' },
    { start_date: '2026-08-28T12:00:00+02:00', value: 44, updated_date: '2026-08-28T13:04:00+02:00' },
  ]);
  assert.equal(reversed[0].mw, 172);

  // A repeat with no `updated_date` never displaces one that has.
  const unstamped = mergeUnitValues([
    { start_date: '2026-08-28T12:00:00+02:00', value: 172, updated_date: '2026-08-28T14:31:00+02:00' },
    { start_date: '2026-08-28T12:00:00+02:00', value: 44 },
  ]);
  assert.equal(unstamped[0].mw, 172);
});

test('trap 7 — RTE sends no installed capacity, so the register is the denominator', () => {
  const { units } = projectActualGenerations(GENERATION);
  // MEASURED: 0 of 152 units carried one in the live response, and 0 of the 8
  // kept here do.
  assert.equal(units.filter((unit) => unit.installedMw !== null).length, 0);

  const joined = joinGenerationToRegistry(buildRegistry(), units);
  const huchet = joined.sites.find((site) => site.id === 'E.HUC');
  const coal = huchet.units.find((unit) => unit.eic === '17W100P100P0005Z');
  assert.equal(coal.mw, 0, 'Émile-Huchet 6 was measured, at zero');
  assert.equal(coal.installedMw, 600, "so the load denominator is the register's");
  assert.equal(coal.registryMw, 600);

  // The both-reported path is kept for a future version that populates it.
  const withCapacity = projectActualGenerations({
    actual_generations_per_unit: [{
      unit: { eic_code: 'Y', production_type: 'NUCLEAR', installed_capacity: 595 },
      values: [{ start_date: '2026-08-28T12:00:00+02:00', value: 500 }],
    }],
  });
  assert.equal(withCapacity.units[0].installedMw, 595);
});

test('trap 8 — a unit the registry cannot place is counted, never drawn, never dropped', () => {
  const { units } = projectActualGenerations(GENERATION);
  const joined = joinGenerationToRegistry(buildRegistry(), units);
  // Dirinon is in neither the register's EIC list nor its station names.
  const dirinon = joined.unplaced.find((unit) => unit.name === 'DIRINON 1');
  assert.ok(dirinon, 'Dirinon stays unplaced');
  assert.equal(dirinon.mw, 1);
  const drawn = joined.sites.flatMap((site) => site.units.map((unit) => unit.eic));
  assert.ok(!drawn.includes(dirinon.eic));
  assert.ok(joined.stats.unplacedUnits >= 1);
});

// --- RTE: the rest of the projection ----------------------------------------

test('an envelope with no eic_code is counted rather than crashing (defensive)', () => {
  // Every captured envelope has one; the counter exists so a future gap is
  // visible in the readout rather than silently shortening the fleet.
  assert.equal(projectActualGenerations(GENERATION).stats.unnamed, 0);
  const anonymous = projectActualGenerations({
    actual_generations_per_unit: [{ unit: { production_type: 'FOSSIL_GAS' }, values: [] }],
  });
  assert.equal(anonymous.stats.unnamed, 1);
  assert.equal(anonymous.units.length, 0);
});

test('an unrecognised production_type is repeated, not flattened', () => {
  assert.equal(classifyRteProductionType('FOSSIL_COAL_DERIVED_GAS'), 'other');
  assert.equal(rteProductionTypeLabel('FOSSIL_COAL_DERIVED_GAS'), 'production_type=FOSSIL_COAL_DERIVED_GAS');
  assert.equal(rteProductionTypeLabel('NUCLEAR'), 'Nucléaire');
  assert.equal(rteProductionTypeLabel(''), 'Filière non publiée');
  assert.equal(classifyRteProductionType('nuclear'), 'nuclear', 'case-insensitive');
});

test('the register and RTE agree on the class of the same machine', () => {
  // If they did not, a station would change colour the moment a key was added.
  const pairs = [
    ['17W100P100P0090I', 'NUCLEAR'],
    ['17W100P100P02756', 'HYDRO_PUMPED_STORAGE'],
    ['17W000000012816Y', 'HYDRO_WATER_RESERVOIR'],
    ['17W100P100P0005Z', 'FOSSIL_HARD_COAL'],
    ['17W100P100P00105', 'FOSSIL_GAS'],
    ['17W100P100P0272C', 'MARINE'],
    ['17W0000014455651', 'WIND_OFFSHORE'],
  ];
  for (const [eic, productionType] of pairs) {
    assert.equal(classifyRegistreRow(rowByEic(eic)), classifyRteProductionType(productionType), eic);
  }
  // Except for the grid batteries, which v1.1 publishes as OTHER while the
  // register knows they are batteries. The REGISTER wins in the join, so the
  // site keeps its colour — RTE only ever supplies the number.
  const cernay = projectActualGenerations(GENERATION).units.find((u) => u.name === 'CERNAY');
  assert.equal(cernay.productionType, 'OTHER');
  assert.equal(cernay.class, 'other');
  assert.equal(classifyRegistreRow(rowByEic('17W000002385265P')), 'battery');
  const joined = joinGenerationToRegistry(buildRegistry(), [cernay]);
  const site = joined.sites.find((s) => s.id === 'SSLAI');
  assert.equal(site.units.find((u) => u.eic === cernay.eic).class, 'battery');
});

test('the published step is derived from the data, and is the modal one', () => {
  const hourly = mergeUnitValues([
    { start_date: '2026-08-28T09:00:00+02:00', value: 1 },
    { start_date: '2026-08-28T10:00:00+02:00', value: 2 },
    { start_date: '2026-08-28T11:00:00+02:00', value: 3 },
  ]);
  assert.equal(publishedStepMinutes(hourly), 60);
  assert.equal(publishedStepMinutes([]), null);
  assert.equal(publishedStepMinutes(hourly.slice(0, 1)), null);
  assert.equal(projectActualGenerations(GENERATION).stats.stepMinutes, 60);
});

test('history ends at the last measurement, not at the end of the window', () => {
  const values = mergeUnitValues([
    { start_date: '2026-08-28T09:00:00+02:00', value: 1 },
    { start_date: '2026-08-28T10:00:00+02:00', value: 2 },
    { start_date: '2026-08-28T11:00:00+02:00', value: null },
    { start_date: '2026-08-28T12:00:00+02:00', value: null },
  ]);
  // `slice(-3)` here would be [2, null, null] — a sparkline two thirds empty
  // for a machine that has been running all day.
  assert.deepEqual(measuredHistory(values, 3), [1, 2]);
  assert.deepEqual(measuredHistory(values, 1), [2]);
  assert.deepEqual(measuredHistory([], 24), []);

  // An interior gap IS kept: a hole in the record is a published hole.
  const gapped = mergeUnitValues([
    { start_date: '2026-08-28T09:00:00+02:00', value: 1 },
    { start_date: '2026-08-28T10:00:00+02:00', value: null },
    { start_date: '2026-08-28T11:00:00+02:00', value: 3 },
  ]);
  assert.deepEqual(measuredHistory(gapped, 24), [1, null, 3]);
});

test('the sparkline separates a gap from a zero from a consumption', () => {
  assert.equal(generationSparkline([null, 0, 900, -300], 900), '·▁█▽');
  assert.equal(generationSparkline([450], 900), '▅');
  assert.equal(generationSparkline([], 900), '');
  // Above nameplate — a real thing on a warm-weather derate — clamps rather
  // than running off the end of the ramp.
  assert.equal(generationSparkline([1200], 900), '█');
  // With no reference at all, the series scales to itself rather than vanishing.
  assert.equal(generationSparkline([10, 20], null), '▅█');
});

// --- The join ----------------------------------------------------------------

/** The shipped-registry shape, built from the captured register rows. */
function buildRegistry() {
  const units = REGISTRE.results.map(projectRegistreUnit).filter(Boolean);
  const sites = groupRegistreSites(units).map((site) => ({
    ...site,
    lat: 47,
    lon: 2,
    placement: 'commune-centre',
  }));
  return { sites, units };
}

test('the join draws the whole fleet with no live data at all', () => {
  const registry = buildRegistry();
  const joined = joinGenerationToRegistry(registry, []);
  assert.equal(joined.sites.length, registry.sites.length);
  assert.equal(joined.stats.liveSites, 0);
  assert.equal(joined.stats.silentUnits, registry.units.length);
  for (const site of joined.sites) {
    // Null load, NOT zero: "nothing published" and "producing nothing" are
    // different facts and must not share a colour.
    assert.equal(site.mw, null);
    assert.equal(site.load, null);
    assert.ok(site.installedMw > 0);
  }
});

test('a station’s load is its own units, summed, against its own nameplate', () => {
  const joined = joinGenerationToRegistry(
    buildRegistry(),
    projectActualGenerations(GENERATION).units,
  );
  // Émile-Huchet: the coal group measured at zero, the gas group silent. The
  // denominator is the whole station, so a partly-reported plant understates
  // rather than claiming anything about the half nobody published.
  const huchet = joined.sites.find((site) => site.id === 'E.HUC');
  assert.equal(huchet.reporting, 1);
  assert.equal(huchet.units.length, 2);
  assert.equal(huchet.mw, 0);
  assert.equal(huchet.installedMw, 1033.9);
  assert.equal(huchet.load, 0);

  // A site nobody published anything for keeps a NULL load, not a zero one.
  const rance = joined.sites.find((site) => site.id === 'RANCE');
  assert.equal(rance.mw, null);
  assert.equal(rance.load, null);
});

test('trap 9 — RTE publishes turbine groups the register only carries as a plant', () => {
  // MEASURED, and the single biggest finding of the first live run: 55 of 152
  // units — 36% of the fleet, 1 914 MW — had no register EIC, almost all hydro.
  // The register has ONE row for Grand'Maison (EIC 17W100P100P02756, 1 690 MW);
  // RTE publishes its twelve turbine groups under twelve different codes.
  const { units } = projectActualGenerations(GENERATION);
  const groups = units.filter((unit) => unit.name.startsWith('GRAND MAISON'));
  assert.equal(groups.length, 2);
  const registryEics = new Set(buildRegistry().units.map((unit) => unit.eic));
  for (const group of groups) {
    assert.equal(registryEics.has(group.eic), false, `${group.name} has no register EIC`);
  }

  const joined = joinGenerationToRegistry(buildRegistry(), units);
  const vaujany = joined.sites.find((site) => site.id === 'VAUJA');
  // Both groups reached the station, and their megawatts summed: 0 + 104.
  assert.equal(joined.stats.adoptedUnits, 2);
  assert.equal(vaujany.mw, 104);
  assert.equal(vaujany.reporting, 2);
  // The station's nameplate is still the register's single plant figure — the
  // adopted groups add output, never capacity, or the iron is counted twice.
  assert.equal(vaujany.installedMw, 1690);
  for (const unit of vaujany.units.filter((u) => u.matchedBy === 'name')) {
    assert.equal(unit.installedMw, null);
  }
  // And the weaker join is labelled as such, so a card can say so.
  const matched = [...new Set(vaujany.units.map((unit) => unit.matchedBy))];
  assert.ok(matched.includes('name'), 'the adopted groups say how they got here');
  assert.ok(matched.includes(null), 'the register plant row, which RTE never reported');
});

test('the name fallback refuses an ambiguous station and never outranks an EIC', () => {
  assert.equal(rteStationNameOf('GRAND MAISON 10'), 'GRAND MAISON');
  assert.equal(rteStationNameOf('CHOOZ B 1'), 'CHOOZ B', 'only a trailing ordinal goes');
  assert.equal(rteStationNameOf('CERNAY'), 'CERNAY', 'a name with no ordinal is untouched');
  assert.equal(rteStationNameOf(null), '');

  // Two register stations answer to the same name, so neither gets the unit.
  const registry = {
    sites: [
      { id: 'A', name: 'Centrale hydraulique de Saint-Pierre', rawSiteName: 'ST-PIERRE', units: [] },
      { id: 'B', name: 'Centrale hydraulique de Saint-Pierre', rawSiteName: 'SAINT-PIERRE', units: [] },
    ],
    units: [],
  };
  const adopted = adoptUnitsByStationName(registry, [{ eic: 'Z', name: 'SAINT-PIERRE', mw: 12 }]);
  assert.equal(adopted.size, 0, 'ambiguous stays unplaced rather than guessing');

  // And a unit the EIC key already placed is never offered to the fallback.
  const byEic = joinGenerationToRegistry(buildRegistry(), [
    { eic: '17W100P100P0005Z', name: 'EMILE HUCHET 6', mw: 42, class: 'fossil-coal' },
  ]);
  assert.equal(byEic.stats.adoptedUnits, 0);
  const huchet = byEic.sites.find((site) => site.id === 'E.HUC');
  assert.equal(huchet.units.find((u) => u.eic === '17W100P100P0005Z').matchedBy, 'eic');
});

test('the join is stable under a registry with no sites and under junk', () => {
  assert.deepEqual(joinGenerationToRegistry(null, null).sites, []);
  assert.deepEqual(joinGenerationToRegistry({}, []).unplaced, []);
  assert.deepEqual(projectActualGenerations(null).units, []);
  assert.deepEqual(projectActualGenerations({ actual_generations_per_unit: 'nope' }).units, []);
});
