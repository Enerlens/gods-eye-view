// What the SSMSI bases are allowed to say, and — the whole reason this file
// exists — what they are NOT allowed to say about a cell the publisher withheld.
//
// ONE PROPERTY DOMINATES EVERY TEST BELOW: **a suppressed cell is not a zero
// and is not a low value.** `est_diffuse = "ndiff"` means the three-year
// publication criterion was not met; it does not bound the value. The fixtures
// prove that from the register itself: Cessy (01071) published 16 `Vols de
// véhicule` in 2023, is withheld in 2024 and 2025, and its withheld row carries
// a `complement_info_nombre` of 2.05 that belongs to the Ain and not to Cessy.
// Marseille's three withheld arrondissements average 11.0 `Vols avec armes`
// each. Any code path that reads a `ndiff` row as 0, as "small", or as its
// département's average is manufacturing a claim about a named French commune,
// and each test here closes one door that could come through.
//
// The second property is that a PUBLISHED ZERO is a claim too — the register
// only publishes it when the absence held for three successive years — so a
// zero must never be confused with a suppression in either direction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CELL_PUBLISHED,
  CELL_SUPPRESSED,
  CELL_ZERO,
  DELINQUANCE_CELL_LABELS,
  DELINQUANCE_CELL_STATES,
  DELINQUANCE_COMMUNE_SLUGS,
  DELINQUANCE_COMPLEMENT_RULE,
  DELINQUANCE_DEPARTEMENT_SLUGS,
  DELINQUANCE_EDITION_FLOOR,
  DELINQUANCE_INDICATORS,
  DELINQUANCE_LICENCE,
  DELINQUANCE_MAX_PARTS,
  DELINQUANCE_MAX_RING_VERTICES,
  DELINQUANCE_PLAINTE_RULE,
  DELINQUANCE_SUPPRESSION_RULE,
  DELINQUANCE_TOTAL_COMMUNE_SLUGS,
  DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS,
  DELINQUANCE_TOTAL_EXCLUDED,
  DELINQUANCE_TOTAL_SLUG,
  DELINQUANCE_YEAR_FLOOR,
  DELINQUANCE_ZERO_RULE,
  aggregateDelinquanceCommuneTotal,
  communeCodeColumn,
  createCommuneFold,
  decimateCommuneRing,
  delinquanceCellState,
  delinquanceContoursUrl,
  delinquanceIndicatorNote,
  delinquanceRateUnit,
  indicatorForLabel,
  indicatorForSlug,
  joinCommuneCells,
  newestDelinquanceYear,
  parseSsmsiCsv,
  pickDelinquanceResources,
  projectCommuneContours,
  projectDelinquanceDepartements,
  selectDelinquanceChips,
  splitSsmsiLine,
  ssmsiNumber,
  ssmsiText,
  stripBom,
} from './delinquanceFeed.js';

const readText = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const readJson = (name) => JSON.parse(readText(name));

const COMMUNE_CSV = readText('ssmsi-communes-sample.csv');
const COMMUNE_LINES = COMMUNE_CSV.split('\n').filter(Boolean);
const DEP_CSV = readText('ssmsi-departements-sample.csv');
const DATASET = readJson('ssmsi-dataset-sample.json');

/** Fold the commune fixture for one year, exactly as the proxy would. */
function fold(year) {
  const sink = createCommuneFold({ year });
  for (const line of COMMUNE_LINES) sink.push(line);
  return sink.finish();
}

const FOLD_2025 = fold('2025');
const FOLD_2023 = fold('2023');
const SLOT = (slug) => DELINQUANCE_COMMUNE_SLUGS.indexOf(slug);

test('the fixtures are the real bases, at the row counts they were captured with', () => {
  // 300 commune rows over 18 communes (01071 across 2023-2025, the other 17 in
  // 2025 only) and 504 département rows over 14 départements × 18 indicators ×
  // 2 years. A drifted count means the fixture was edited, not the code.
  assert.equal(COMMUNE_LINES.length - 1, 300);
  assert.equal(DEP_CSV.replace(/\r\n?/g, '\n').split('\n').filter(Boolean).length - 1, 504);

  // The commune base carries no BOM; the département base does. Both measured
  // on the live 2026-07-09 edition and both are load-bearing: `stripBom` is
  // what stops the first header cell being read as `﻿"Code_departement"`.
  assert.equal(COMMUNE_CSV.charCodeAt(0) === 0xFEFF, false);
  assert.equal(DEP_CSV.charCodeAt(0), 0xFEFF);
  assert.equal(stripBom(DEP_CSV).slice(0, 20), '"Code_departement";"');

  const header = COMMUNE_LINES[0].split(';').map((name) => ssmsiText(name));
  assert.deepEqual(header, [
    'CODGEO_2026', 'annee', 'indicateur', 'unite_de_compte', 'nombre', 'taux_pour_mille',
    'est_diffuse', 'insee_pop', 'insee_pop_millesime', 'insee_log', 'insee_log_millesime',
    'complement_info_nombre', 'complement_info_taux',
  ]);
});

test('the geography column is found by prefix, because its name moves every edition', () => {
  // The shipped file says CODGEO_2026 while the methodology PDF's own variable
  // table still says CODGEO_2025 — measured 2026-09-02 on both. A hardcoded
  // column name breaks every July.
  assert.equal(FOLD_2025.codeColumn, 'CODGEO_2026');
  assert.equal(communeCodeColumn(['CODGEO_2025', 'annee']), 'CODGEO_2025');
  assert.equal(communeCodeColumn(['CODGEO', 'annee']), 'CODGEO');
  assert.equal(communeCodeColumn(['code_commune', 'annee']), null);
  assert.equal(communeCodeColumn([]), null);
});

test('NA is null and never zero, and the decimal separator is a comma', () => {
  assert.equal(ssmsiNumber('NA'), null);
  assert.equal(ssmsiNumber('"NA"'), null);
  assert.equal(ssmsiNumber(''), null);
  assert.equal(ssmsiNumber(null), null);
  assert.equal(ssmsiNumber('"0,0078318"'), 0.0078318);
  assert.equal(ssmsiNumber('"5"'), 5);
  assert.equal(ssmsiNumber('"0"'), 0);
  // The distinction the whole layer rests on: an absent number and a zero are
  // different values, and `null` must never coerce to 0 on the way through.
  assert.notEqual(ssmsiNumber('NA'), ssmsiNumber('"0"'));
  assert.equal(ssmsiText('"Vols avec armes"'), 'Vols avec armes');
  assert.equal(ssmsiText('NA'), '');
});

test('est_diffuse is read BEFORE any number, so ndiff can never fall through to 0', () => {
  // Order is the entire safety property. A `ndiff` row whose `nombre` happened
  // to parse would otherwise be classified numerically.
  assert.equal(delinquanceCellState({ est_diffuse: 'ndiff', nombre: 'NA' }), CELL_SUPPRESSED);
  // The register QUOTES its fields, and the fold hands them on raw, so the
  // flag arrives as `"ndiff"` with the quotes attached. A bare string compare
  // made the `ndiff` branch dead code and let classification fall through to
  // the numeric one; it only landed on the right answer because a withheld row
  // also carries `nombre = NA`. This row is the case where the accident ends.
  assert.equal(delinquanceCellState({ est_diffuse: '"ndiff"', nombre: '"0"' }), CELL_SUPPRESSED);
  assert.equal(delinquanceCellState({ est_diffuse: '"ndiff"', nombre: '"41"' }), CELL_SUPPRESSED);
  assert.equal(delinquanceCellState({ est_diffuse: '"diff"', nombre: '"0"' }), CELL_ZERO);
  assert.equal(delinquanceCellState({ est_diffuse: 'ndiff', nombre: '"41"' }), CELL_SUPPRESSED);
  assert.equal(delinquanceCellState({ est_diffuse: 'diff', nombre: '"0"' }), CELL_ZERO);
  assert.equal(delinquanceCellState({ est_diffuse: 'diff', nombre: '"12"' }), CELL_PUBLISHED);
  // No flag and no number is unknown, not zero.
  assert.equal(delinquanceCellState({ nombre: 'NA' }), CELL_SUPPRESSED);
  assert.deepEqual([...DELINQUANCE_CELL_STATES], ['published', 'zero', 'suppressed']);
});

test('a published zero survives a NULL rate — the six villages détruits of Verdun', () => {
  // 55039 Beaumont-en-Verdunois: `insee_pop = 0`, so the register publishes
  // `nombre = "0"` with `taux_pour_mille` literally `NA`. Measured 2026-09-02:
  // all six of 55039/55050/55139/55189/55239/55307 do this, and they are the
  // ONLY published cells in the whole base with no rate. A classifier that
  // looked at the rate would call them suppressed.
  const raw = COMMUNE_LINES.find((line) => line.startsWith('"55039";"2025";"Violences physiques intrafamiliales"'));
  assert.ok(raw, 'the fixture must carry the zero-population commune');
  const fields = raw.split(';');
  assert.equal(ssmsiText(fields[4]), '0');
  assert.equal(ssmsiText(fields[5]), '');
  assert.equal(ssmsiText(fields[6]), 'diff');
  assert.equal(ssmsiNumber(fields[5]), null);
  assert.equal(delinquanceCellState({ est_diffuse: fields[6], nombre: fields[4] }), CELL_ZERO);

  const entry = FOLD_2025.communes.get('55039');
  assert.equal(entry.pop, 0);
  assert.equal(FOLD_2025.zeroPopulation, 1, 'the fixture carries exactly one such commune');
  // Fourteen published zeros and one suppression, and the suppression is not
  // one of the zeros. The 16th slot is the computed total and is asserted on
  // its own below — it is not one of the register's cells.
  const states = entry.cells
    .slice(0, DELINQUANCE_COMMUNE_SLUGS.length)
    .map((cell) => cell[0]);
  assert.equal(states.filter((s) => s === CELL_ZERO).length, 14);
  assert.equal(states.filter((s) => s === CELL_SUPPRESSED).length, 1);
  assert.equal(states.filter((s) => s === CELL_PUBLISHED).length, 0);
  // A commune with no inhabitants gets no rate out of the total either: a
  // per-1 000-inhabitants figure over zero inhabitants is not a number.
  const total = entry.cells[DELINQUANCE_COMMUNE_SLUGS.length];
  assert.equal(total[1], 0, 'nothing was recorded here');
  assert.equal(total[2], null, 'and there is no denominator to divide by');
});

test('a suppressed cell carries NO number at all — there is nothing downstream can paint', () => {
  // The structural version of the safety property: the fold writes `[state]`
  // for a withheld cell and `[state, count, rate]` for a published one, so a
  // renderer cannot reach for a value that is not there.
  let suppressed = 0;
  let zero = 0;
  let published = 0;
  for (const [code, entry] of FOLD_2025.communes) {
    // The register's cells only: the computed total in the last slot has its
    // own four-element shape and its own test.
    for (let slot = 0; slot < DELINQUANCE_COMMUNE_SLUGS.length; slot += 1) {
      const cell = entry.cells[slot];
      if (!cell) continue;
      if (cell[0] === CELL_SUPPRESSED) {
        suppressed += 1;
        assert.equal(cell.length, 1, `${code}/${DELINQUANCE_COMMUNE_SLUGS[slot]} must carry no value`);
      } else if (cell[0] === CELL_ZERO) {
        zero += 1;
        assert.equal(cell.length, 1, `${code}/${DELINQUANCE_COMMUNE_SLUGS[slot]} needs no stored zero`);
      } else {
        published += 1;
        assert.equal(cell.length, 3);
        assert.ok(cell[1] > 0, 'a published cell has a positive count');
      }
    }
  }
  // Recounted from the fixture on 2026-09-02: 184 published, 26 zero, 60
  // suppressed over the 18 communes × 15 indicators of the 2025 slice — 22 %
  // withheld, against 47.9 % over the whole 2025 edition.
  assert.equal(published, 184);
  assert.equal(zero, 26);
  assert.equal(suppressed, 60);
  assert.equal(published + zero + suppressed, 18 * 15);
  assert.ok(suppressed > 0, 'the fixture MUST contain real suppressed cells');
  assert.ok(zero > 0, 'the fixture MUST contain a real published zero');
  assert.ok(published > 0, 'the fixture MUST contain a real published value');
});

test('a suppressed cell is never averaged: complement_info stays out of the cells', () => {
  // `complement_info_*` is a DEPARTMENTAL mean over withheld communes — the
  // PDF's own words. It is hoisted to `departementMeans`, never onto a cell,
  // and the census is what a card may quote.
  const marseille = FOLD_2025.communes.get('13204');
  const armes = marseille.cells[SLOT('vols-armes')];
  assert.equal(armes[0], CELL_SUPPRESSED);
  assert.equal(armes.length, 1);
  // The value that must not have reached it is real, and it is 11.
  const raw = COMMUNE_LINES.find((line) => line.startsWith('"13204";"2025";"Vols avec armes"'));
  assert.match(raw, /"11,0000000";"0,3287180"/);

  const mean13 = FOLD_2025.departementMeans['13']['vols-armes'];
  assert.equal(mean13.count, 11);
  assert.equal(mean13.rate, 0.328718);
  // TWO distinct departmental means coexist in the Bouches-du-Rhône for this
  // indicator — 62 ordinary communes at 1.2096774 against 3 Marseille
  // arrondissements at 11.0, measured nationally on 2026-09-02. The fold
  // reports the variant count instead of silently picking one.
  assert.equal(mean13.variants, 2);
  const mean01 = FOLD_2025.departementMeans['01']['vols-vehicules'];
  assert.equal(mean01.variants, 1);
  assert.equal(mean01.count, 2.0508475);
  // Seine-Saint-Denis: the average WITHHELD commune recorded 22.33 amendes
  // forfaitaires — four times the "plus de 5 faits" threshold.
  assert.equal(FOLD_2025.departementMeans['93']['usage-stupefiants-afd'].count, 22.3333333);
});

test('NON DIFFUSÉ DOES NOT MEAN SMALL — the register refutes it inside one commune', () => {
  // The single most important assertion in this file. Cessy (01071, Ain,
  // 5 832 inhabitants) published 16 `Vols de véhicule` in 2023 and is withheld
  // in 2025. Folding the SAME fixture on the two years shows both facts, so
  // "between 1 and 5 facts" is not a reading anything here may offer.
  const slot = SLOT('vols-vehicules');
  const then = FOLD_2023.communes.get('01071').cells[slot];
  const now = FOLD_2025.communes.get('01071').cells[slot];
  assert.equal(then[0], CELL_PUBLISHED);
  assert.equal(then[1], 16);
  assert.equal(now[0], CELL_SUPPRESSED);
  assert.equal(now.length, 1);
  // And the departmental mean the withheld row carries is 2.05 — a number
  // about the Ain, eight times smaller than Cessy's own last published value.
  assert.equal(FOLD_2025.departementMeans['01']['vols-vehicules'].count, 2.0508475);

  // Nationally, measured over the live edition on 2026-09-02: 4 735 of the
  // 251 145 withheld 2025 cells belong to a (commune, indicateur) pair that
  // published more than 5 facts in 2023 or 2024. The rule quoted below is a
  // three-year condition on the series, which is why.
  assert.equal(
    DELINQUANCE_SUPPRESSION_RULE,
    '« Les données diffusées sont limitées aux communes pour lesquelles plus de 5 faits ont '
    + 'été enregistrés pendant 3 années successives. »',
  );
});

test('the publisher’s sentences are quoted, not paraphrased', () => {
  // Extracted with `pdftotext -layout` from the 277 329-byte methodology PDF on
  // 2026-09-02 and compared character for character. A paraphrase of a
  // suppression rule is a claim about the values being suppressed.
  assert.match(DELINQUANCE_SUPPRESSION_RULE, /plus de 5 faits ont été enregistrés pendant 3 années successives/);
  assert.match(DELINQUANCE_ZERO_RULE, /l’absence de faits enregistrés lorsqu’elle se reproduit sur 3 années/);
  assert.match(DELINQUANCE_COMPLEMENT_RULE, /moyenne parmi les communes du département sous secret statistique/);
  assert.match(DELINQUANCE_PLAINTE_RULE, /12 % des victimes de violences sexuelles hors ménage/);
  assert.match(DELINQUANCE_PLAINTE_RULE, /74 % pour les victimes de cambriolages/);
  for (const quote of [DELINQUANCE_SUPPRESSION_RULE, DELINQUANCE_ZERO_RULE, DELINQUANCE_PLAINTE_RULE]) {
    assert.ok(quote.startsWith('«') && quote.endsWith('»'), `${quote} must be marked as a quotation`);
  }
  // The paraphrase that was here before, and that this correction removed.
  const source = readFileSync(new URL('./delinquanceFeed.js', import.meta.url), 'utf8');
  const layer = readFileSync(new URL('./delinquanceFrance.js', import.meta.url), 'utf8');
  const strings = (text) => text.split('\n')
    .filter((line) => !/^\s*\*/.test(line) && !/^\s*\/\//.test(line))
    .join('\n');
  assert.equal(/entre 1 et 5 faits/i.test(strings(source)), false);
  assert.equal(/entre 1 et 5 faits/i.test(strings(layer)), false);
});

test('the census counts all three states and the suppressed tally is the point of it', () => {
  const census = FOLD_2025.census;
  for (const slug of DELINQUANCE_COMMUNE_SLUGS) {
    assert.equal(census[slug].length, 3, `${slug} carries three counts`);
    assert.equal(
      census[slug][CELL_PUBLISHED] + census[slug][CELL_ZERO] + census[slug][CELL_SUPPRESSED],
      FOLD_2025.communeCount,
      `${slug} accounts for every commune`,
    );
  }
  // Vols avec armes over the 18 fixture communes: 4 published, 5 zero, 9
  // withheld. It is the indicator with the most withheld ground, exactly as at
  // national scale (3 155 published, 31 562 zero, 3 155… ) — and 9 of 18 here.
  assert.deepEqual(census['vols-armes'], [4, 5, 9]);
  assert.deepEqual(census.escroqueries, [15, 1, 2]);
  // The per-département census, which is what lets a national card say how
  // much of the finer map underneath is blank without a second request.
  assert.deepEqual(FOLD_2025.censusByDepartement['13']['vols-armes'], [1, 0, 4]);
  assert.deepEqual(FOLD_2025.censusByDepartement['75']['vols-armes'], [2, 0, 1]);
  assert.deepEqual(Object.keys(FOLD_2025.censusByDepartement).sort(),
    ['01', '13', '2A', '2B', '55', '75', '93', '971']);
});

test('the départements are sliced off the code, and Corsica and the DOM survive it', () => {
  // 2A004 must land in `2A` and 97101 in `971`, not in `2A0` and `97`. The
  // register writes Corsica exactly as the IGN outlines do, which is what makes
  // the code join legal here — see delinquanceDepartements.js.
  assert.equal(FOLD_2025.communes.get('2A004').dep, '2A');
  assert.equal(FOLD_2025.communes.get('2B242').dep, '2B');
  assert.equal(FOLD_2025.communes.get('97101').dep, '971');
  assert.equal(FOLD_2025.communes.get('75104').dep, '75');
});

test('the fold keeps one year and reports the others rather than silently dropping them', () => {
  assert.equal(FOLD_2025.year, '2025');
  assert.deepEqual(FOLD_2025.yearsSeen, ['2023', '2024', '2025']);
  assert.equal(FOLD_2025.rowsSwept, 300);
  assert.equal(FOLD_2025.rowsKept, 270);
  assert.equal(FOLD_2025.communeCount, 18);
  // 30 of the 300 rows are Cessy's 2023 and 2024 — swept, counted, not kept.
  assert.equal(FOLD_2025.rowsSwept - FOLD_2025.rowsKept, 30);
  assert.equal(FOLD_2023.communeCount, 1, 'only Cessy carries a 2023 row here');
  // The fast `split(';')` path held for every row, as it does for all 5 238 000
  // upstream. A non-zero here means the quote-aware walk took over.
  assert.equal(FOLD_2025.slowLines, 0);
  assert.deepEqual(FOLD_2025.unknownIndicators, []);
});

test('an unrecognised indicator label is COUNTED, because the register renames them', () => {
  // In July 2025 « coups et blessures volontaires sur personne de 15 ans ou
  // plus » became two indicators. A silent `undefined` would have emptied the
  // map without a word.
  const sink = createCommuneFold({ year: '2025' });
  sink.push(COMMUNE_LINES[0]);
  sink.push('"01071";"2025";"Coups et blessures volontaires";"Victime";"7";"1,2001371";"diff";"5832";"2022";"2551";"2022";NA;NA');
  const out = sink.finish();
  assert.deepEqual(out.unknownIndicators, [{ label: 'Coups et blessures volontaires', rows: 1 }]);
  assert.equal(out.communeCount, 0, 'an unknown label contributes no cell');
  assert.equal(indicatorForLabel('Coups et blessures volontaires'), null);
  assert.equal(indicatorForLabel('Vols avec armes').slug, 'vols-armes');
  assert.equal(indicatorForSlug('nope'), null);
});

test('the indicator vocabulary declares its grains and its denominators', () => {
  assert.equal(DELINQUANCE_INDICATORS.length, 18);
  assert.equal(DELINQUANCE_DEPARTEMENT_SLUGS.length, 18);
  assert.equal(DELINQUANCE_COMMUNE_SLUGS.length, 15);
  // The three that exist only above the commune. A UI offering them at commune
  // grain would draw an empty map and call it zero crime.
  const depOnly = DELINQUANCE_INDICATORS.filter((entry) => !entry.grains.includes('com'));
  assert.deepEqual(depOnly.map((entry) => entry.slug).sort(),
    ['homicides', 'tentatives-homicide', 'usage-stupefiants-hors-afd']);
  // Exactly one indicator is per 1 000 dwellings, and it is the burglaries.
  const perLog = DELINQUANCE_INDICATORS.filter((entry) => entry.per === 'logements');
  assert.deepEqual(perLog.map((entry) => entry.slug), ['cambriolages']);
  assert.equal(delinquanceRateUnit('cambriolages'), '1 000 logements');
  assert.equal(delinquanceRateUnit('homicides'), '1 000 habitants');
  assert.equal(delinquanceRateUnit('nope'), '1 000 habitants');
  // Five units of account, so no two indicators may be summed into a score.
  assert.deepEqual([...new Set(DELINQUANCE_INDICATORS.map((e) => e.unite))].sort(),
    ['Infraction', 'Mis en cause', 'Victime', 'Victime entendue', 'Véhicule']);
});

test('the indicators that mean something other than they look carry the warning', () => {
  // Escroqueries is the FIRST chip — the indicator with the most paintable
  // ground — and the PDF says its victims are counted where they live.
  assert.match(delinquanceIndicatorNote('escroqueries'), /LIEU DE RÉSIDENCE/);
  assert.match(delinquanceIndicatorNote('cambriolages'), /1 000 LOGEMENTS/);
  assert.match(delinquanceIndicatorNote('usage-stupefiants'), /une seule fois par unité spatiale/);
  assert.match(delinquanceIndicatorNote('homicides'), /département et à la région seulement/);
  // A slug with nothing special to say gets nothing, not a filler line.
  assert.equal(delinquanceIndicatorNote('vols-armes'), null);
  assert.equal(delinquanceIndicatorNote(null), null);
});

test('the chips are derived from the data, not chosen by hand', () => {
  const chips = selectDelinquanceChips(FOLD_2025.census);
  assert.equal(chips.length, 6);
  for (const slug of chips) assert.ok(DELINQUANCE_COMMUNE_SLUGS.includes(slug));
  // Ranked by communes carrying a published POSITIVE value — the maps with the
  // most ground that can honestly be coloured.
  const published = chips.map((slug) => FOLD_2025.census[slug][CELL_PUBLISHED]);
  assert.deepEqual(published, [...published].sort((a, b) => b - a));
  // Vols avec armes is 9-of-18 withheld in this fixture and must not be chosen.
  assert.equal(chips.includes('vols-armes'), false);
  assert.equal(selectDelinquanceChips({}, 3).length, 3);
  assert.equal(selectDelinquanceChips(null, 0).length, 1, 'never an empty chip row');
});

test('the département base is projected whole, and has no third state to project', () => {
  const rows = parseSsmsiCsv(DEP_CSV);
  assert.equal(rows.length, 504);
  assert.equal(rows[0].Code_departement, '01');
  assert.equal(rows[0].indicateur, 'Homicides');
  assert.equal(Object.hasOwn(rows[0], 'est_diffuse'), false,
    'the DEP base has no suppression column at all');

  const pack = projectDelinquanceDepartements({ rows });
  assert.equal(pack.departements.length, 14);
  assert.deepEqual(pack.years, ['2024', '2025']);
  assert.equal(pack.newestYear, '2025');
  assert.equal(pack.rowsSwept, 504);
  assert.equal(pack.cellsKept, 504);
  assert.deepEqual(pack.unknownIndicators, []);
  assert.deepEqual(pack.departements.map((d) => d.code),
    ['01', '05', '07', '13', '18', '2A', '2B', '59', '70', '75', '90', '971', '973', '976']);

  // Cher: 1 668 burglaries in 2025 at 9.278 per 1 000 dwellings — the
  // département that makes the whole rate-not-count argument.
  const cher = pack.departements.find((d) => d.code === '18');
  assert.deepEqual(cher.cells.cambriolages[1], [CELL_PUBLISHED, 1668, 9.2781143]);
  assert.equal(cher.log, 179778);
  // A published zero at this grain too — Ardèche recorded no homicide in 2025.
  const ardeche = pack.departements.find((d) => d.code === '07');
  assert.deepEqual(ardeche.cells.homicides[1], [CELL_ZERO, 0, 0]);
  // Every one of the 18 indicators has a series, including the three that have
  // no commune map at all.
  for (const slug of DELINQUANCE_DEPARTEMENT_SLUGS) {
    assert.equal(cher.cells[slug].length, 2, `${slug} has one cell per year`);
  }
  // Population and dwellings are taken at the NEWEST year, not at whichever
  // row happened to be swept first.
  assert.equal(cher.pop, 298660);
});

test('the resource picker takes the two bases out of eleven and floors the edition', () => {
  const picked = pickDelinquanceResources(DATASET);
  assert.match(picked.departements.url, /donnee-dep-data\.gouv-2025-geographie2026.*\.csv$/);
  assert.match(picked.communes.url, /donnee-data\.gouv-2025-geographie2026.*\.csv\.gz$/);
  assert.match(picked.documentation.url, /fichier-metadonnees.*\.pdf$/);
  assert.equal(picked.departements.bytes, 2001231);
  assert.equal(picked.communes.bytes, 39932450);
  assert.equal(picked.licence, DELINQUANCE_LICENCE);
  assert.equal(picked.edition, DELINQUANCE_EDITION_FLOOR);
  assert.equal(picked.staleEdition, false);
  // The dataset carries four Atlas PDFs of 44 to 174 MB; "the first csv" would
  // have been right by luck and "the first resource" would have been an Atlas.
  assert.equal(DATASET._fixture.upstreamResourceCount, 11);
  assert.equal(DATASET.resources.some((r) => /^Atlas/.test(r.title)), true);

  // An edition OLDER than the floor is a rolled-back portal, not a new fact.
  const rolled = pickDelinquanceResources({
    ...DATASET,
    resources: DATASET.resources.map((r) => ({ ...r, last_modified: '2025-07-01T00:00:00' })),
  });
  assert.equal(rolled.staleEdition, true);
  assert.equal(rolled.edition, DELINQUANCE_EDITION_FLOOR, 'the floor holds');

  assert.throws(() => pickDelinquanceResources({ resources: [] }), /no DEP csv/);
  assert.throws(
    () => pickDelinquanceResources({ resources: DATASET.resources.filter((r) => r.format !== 'csv.gz') }),
    /no COM csv\.gz/,
  );
});

test('the year is discovered from the column and floored, as a string', () => {
  assert.equal(newestDelinquanceYear(['2016', '2025']), '2025');
  assert.equal(newestDelinquanceYear(['2016', '2024']), DELINQUANCE_YEAR_FLOOR);
  assert.equal(newestDelinquanceYear(['2026', '2025']), '2026');
  // Not a year: must not win by parsing to NaN or by lexical accident.
  assert.equal(newestDelinquanceYear(['2025p', '9999999', '']), DELINQUANCE_YEAR_FLOOR);
  assert.equal(newestDelinquanceYear(null), DELINQUANCE_YEAR_FLOOR);
});

test('the fast CSV split is guarded, and the guard degrades to a quote-aware walk', () => {
  const header = ['a', 'b', 'c'];
  assert.deepEqual(splitSsmsiLine('1;2;3', 3), ['1', '2', '3']);
  // A quoted semicolon breaks the field count, and the slow path takes over
  // rather than mis-aligning every column after it.
  const tricky = '"01001";"Saint-Ex; le Bourg";"3"';
  assert.equal(tricky.split(';').length, 4, 'the naive split mis-counts this line');
  assert.deepEqual(splitSsmsiLine(tricky, header.length), ['01001', 'Saint-Ex; le Bourg', '3']);
  // Without a declared field count there is no guard to fire, and the fast
  // path is what the header line itself is read with.
  assert.equal(splitSsmsiLine(tricky, NaN).length, 4);
  // The guard fires on the field COUNT, so an escaped quote is only unescaped
  // when something else already forced the slow path. That is the honest
  // contract: the fast path returns raw tokens and `ssmsiText` unquotes them.
  assert.deepEqual(splitSsmsiLine('"a""b";"c"', 2), ['"a""b"', '"c"']);
  assert.deepEqual(splitSsmsiLine('"a""b";"c;d"', 2), ['a"b', 'c;d']);
});

test('a commune ring is decimated, closed, and honest about having been', () => {
  const pack2b = readJson('geoapi-communes-2b-sample.json');
  const galeria = pack2b.features.find((f) => f.properties.code === '2B121');
  // Galéria carries the biggest outline in the fixture: 2 897 vertices raw.
  assert.equal(galeria.geometry.coordinates[0].length, 2897);
  const decimated = decimateCommuneRing(galeria.geometry.coordinates[0]);
  assert.equal(decimated.simplified, true);
  assert.equal(decimated.ring.length / 2, 64);
  assert.ok(decimated.ring.length / 2 <= DELINQUANCE_MAX_RING_VERTICES + 1);
  // A stride can drop the closing vertex, and an unclosed ring is a visible
  // gash across the commune.
  assert.equal(decimated.ring[0], decimated.ring[decimated.ring.length - 2]);
  assert.equal(decimated.ring[1], decimated.ring[decimated.ring.length - 1]);
  // A ring the layer cannot draw yields nothing rather than a degenerate shape.
  assert.deepEqual(decimateCommuneRing([[1, 2], [1, 2]]), { ring: [], simplified: false });
  assert.deepEqual(decimateCommuneRing(null), { ring: [], simplified: false });
  // A coordinate that is not a number is skipped, never coerced to 0,0.
  assert.deepEqual(decimateCommuneRing([[1, 2], [null, 3], [4, 5]]), { ring: [], simplified: false });
});

test('a multi-part commune keeps its three biggest pieces and says how many it dropped', () => {
  const contours = projectCommuneContours(readJson('geoapi-communes-2b-sample.json'));
  assert.equal(contours.communes.length, 5);
  assert.equal(contours.droppedParts, 2, "L'Île-Rousse publishes five pieces; three are kept");
  const ileRousse = contours.communes.find((c) => c.code === '2B134');
  assert.equal(ileRousse.parts.length, DELINQUANCE_MAX_PARTS);
  assert.equal(ileRousse.name, "L'Île-Rousse");
  assert.equal(ileRousse.simplified, true);
  // Calenzana's outline has an interior ring — an enclave that is ANOTHER
  // commune, drawn in its own right, so cutting the hole would leave a gap.
  const calenzana = readJson('geoapi-communes-2b-sample.json').features
    .find((f) => f.properties.code === '2B049');
  assert.equal(calenzana.geometry.coordinates.some((polygon) => polygon.length > 1), true);
  assert.equal(contours.communes.find((c) => c.code === '2B049').parts.length, 2);
  // A feature with no code is skipped, never given one.
  assert.equal(projectCommuneContours({ features: [{ properties: {}, geometry: null }] }).communes.length, 0);
  assert.equal(projectCommuneContours(null).communes.length, 0);
});

test('the join reports the arrondissements it folded away instead of losing them', () => {
  // geo.api.gouv.fr publishes Paris as ONE contour; the SSMSI publishes the
  // commune AND its arrondissements. Measured nationally on 2026-09-01: all
  // 34 875 contours have a row and the only 45 codes with no contour are the
  // arrondissements of Paris, Lyon and Marseille. `unshaped` is a finer grain
  // folded away, never a loss, and the payload names it.
  const contours = projectCommuneContours(readJson('geoapi-communes-75-sample.json'));
  assert.equal(contours.communes.length, 1);
  assert.equal(contours.communes[0].name, 'Paris');
  const joined = joinCommuneCells({ contours: contours.communes, cells: FOLD_2025.communes, departement: '75' });
  assert.equal(joined.communes.length, 1);
  assert.equal(joined.withoutCells, 0);
  assert.deepEqual(joined.unshaped.map((row) => row.c), ['75104', '75108']);
  // Paris's own cell is the parent total, and the withheld arrondissement is
  // still withheld in the unshaped list — folding does not publish it.
  const armes = joined.communes[0].v[SLOT('vols-armes')];
  assert.deepEqual(armes, [CELL_PUBLISHED, 393, 0.1868068]);
  const quatrieme = joined.unshaped.find((row) => row.c === '75104');
  assert.deepEqual(quatrieme.v[SLOT('vols-armes')], [CELL_SUPPRESSED]);

  // A contour with no row is counted, not drawn as zero.
  const orphan = joinCommuneCells({
    contours: [{ code: '99999', name: 'Nulle part', parts: [[0, 0, 1, 1, 0, 1, 0, 0]], simplified: false }],
    cells: FOLD_2025.communes,
    departement: '99',
  });
  assert.equal(orphan.communes.length, 0);
  assert.equal(orphan.withoutCells, 1);
});

test('a contour URL is only built for a code the register could publish', () => {
  assert.equal(delinquanceContoursUrl('2B'),
    'https://geo.api.gouv.fr/departements/2B/communes?format=geojson&geometry=contour&fields=code,nom,population');
  assert.match(delinquanceContoursUrl('971'), /departements\/971\/communes/);
  assert.match(delinquanceContoursUrl('2a'), /departements\/2A\/communes/);
  for (const bad of ['', '9', '999', '../etc', '75056', null]) {
    assert.throws(() => delinquanceContoursUrl(bad), /invalid département code/);
  }
});

test('the three state labels cannot be read as one another', () => {
  const { published, zero, suppressed } = DELINQUANCE_CELL_LABELS;
  assert.equal(new Set([published, zero, suppressed]).size, 3);
  // "Aucun fait enregistré" is an assertion; "Non diffusé" is a refusal. The
  // word "zéro" must never appear in the refusal.
  assert.match(zero, /Aucun fait/);
  assert.match(suppressed, /Non diffusé/);
  assert.equal(/z[ée]ro|aucun/i.test(suppressed), false, `"${suppressed}" must not imply nothing happened`);
  assert.equal(/non diffus|secret/i.test(zero), false, `"${zero}" must not imply a refusal`);
});

// ---------------------------------------------------------------------------
// The computed total — the one indicator the register does not publish
// ---------------------------------------------------------------------------

test('the total drops the decomposition that would double-count, and only that', () => {
  // `Usage de stupéfiants` = AFD + hors AFD, measured exactly in 101 of 101
  // départements, so keeping all three sums the family twice.
  assert.deepEqual([...DELINQUANCE_TOTAL_EXCLUDED],
    ['usage-stupefiants-afd', 'usage-stupefiants-hors-afd']);
  assert.equal(DELINQUANCE_TOTAL_COMMUNE_SLUGS.length, 14);
  assert.equal(DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS.length, 16);
  assert.ok(DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS.includes('usage-stupefiants'),
    'the PARENT is what stays in');
  for (const excluded of DELINQUANCE_TOTAL_EXCLUDED) {
    assert.equal(DELINQUANCE_TOTAL_COMMUNE_SLUGS.includes(excluded), false);
    assert.equal(DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS.includes(excluded), false);
  }
  // Reachable by slug, unreachable by label: no upstream row can ever resolve
  // to a total, because the register publishes no such row.
  assert.equal(indicatorForSlug(DELINQUANCE_TOTAL_SLUG).computed, true);
  assert.equal(indicatorForLabel('Tous les indicateurs — total calculé'), null);
  assert.equal(DELINQUANCE_COMMUNE_SLUGS.includes(DELINQUANCE_TOTAL_SLUG), false,
    'the register list must never grow the computed slug');
  assert.equal(DELINQUANCE_DEPARTEMENT_SLUGS.includes(DELINQUANCE_TOTAL_SLUG), false);
  assert.equal(delinquanceRateUnit(DELINQUANCE_TOTAL_SLUG), '1 000 habitants');
});

test('A TOTAL OVER A WITHHELD CELL IS A FLOOR, AND SAYS SO IN ITS OWN SHAPE', () => {
  const cells = new Array(DELINQUANCE_COMMUNE_SLUGS.length).fill(null);
  cells[SLOT('cambriolages')] = [CELL_PUBLISHED, 10, 5];
  cells[SLOT('degradations')] = [CELL_PUBLISHED, 7, 3.5];
  cells[SLOT('vols-armes')] = [CELL_SUPPRESSED];
  for (const slug of DELINQUANCE_COMMUNE_SLUGS) {
    if (!cells[SLOT(slug)]) cells[SLOT(slug)] = [CELL_ZERO];
  }
  const [state, count, rate, withheld] = aggregateDelinquanceCommuneTotal(cells, 2000);
  assert.equal(state, CELL_PUBLISHED);
  assert.equal(count, 17, 'the published contributors, and nothing else');
  assert.equal(rate, 8.5, 'recomputed on the population, not summed from rates');
  assert.equal(withheld, 1, 'the floor knows how far it might be from the value');

  // The AFD child is present and published, and is STILL not counted.
  cells[SLOT('usage-stupefiants')] = [CELL_PUBLISHED, 4, 2];
  cells[SLOT('usage-stupefiants-afd')] = [CELL_PUBLISHED, 3, 1.5];
  assert.equal(aggregateDelinquanceCommuneTotal(cells, 2000)[1], 21, '17 + 4, never + 3 again');
});

test('the total tells a complete zero from a withheld one, and paints neither as the other', () => {
  const allZero = new Array(DELINQUANCE_COMMUNE_SLUGS.length).fill(null)
    .map(() => [CELL_ZERO]);
  const complete = aggregateDelinquanceCommuneTotal(allZero, 1000);
  assert.deepEqual(complete, [CELL_ZERO, 0, 0, 0], 'a measured zero keeps its zero rate');

  const withheldSomewhere = allZero.slice();
  withheldSomewhere[SLOT('escroqueries')] = [CELL_SUPPRESSED];
  const partial = aggregateDelinquanceCommuneTotal(withheldSomewhere, 1000);
  assert.equal(partial[0], CELL_SUPPRESSED, 'nothing published + something withheld = unknown');
  assert.equal(partial[2], null, 'and an unknown cell carries NO rate to paint');
  assert.equal(partial[3], 1);

  // A cell the edition never wrote counts as withheld, never as a zero.
  const missing = allZero.slice();
  missing[SLOT('degradations')] = null;
  assert.equal(aggregateDelinquanceCommuneTotal(missing, 1000)[3], 1);
});

test('the fold appends the total, censuses it, and feeds it to the national ramp', () => {
  for (const [code, entry] of FOLD_2025.communes) {
    assert.equal(entry.cells.length, DELINQUANCE_COMMUNE_SLUGS.length + 1,
      `${code} carries the register's cells plus exactly one computed slot`);
    const total = entry.cells[DELINQUANCE_COMMUNE_SLUGS.length];
    assert.equal(total.length, 4, 'a total says how many contributors were withheld');
    assert.deepEqual(
      total,
      aggregateDelinquanceCommuneTotal(entry.cells, entry.pop),
      'the stored total is the pure function of the cells beside it',
    );
    if (total[0] === CELL_SUPPRESSED) assert.equal(total[2], null);
  }
  // 15 published, 0 complete zeros, 3 suppressed over the fixture's 18
  // communes; the 15 published rates are what the national quantile cut sees.
  assert.deepEqual(FOLD_2025.census[DELINQUANCE_TOTAL_SLUG], [15, 0, 3]);
  assert.equal(FOLD_2025.rates.get(DELINQUANCE_TOTAL_SLUG).length, 15);
  for (const rate of FOLD_2025.rates.get(DELINQUANCE_TOTAL_SLUG)) assert.ok(rate > 0);
  // Bouches-du-Rhône: Marseille's own total, and the census of its communes.
  assert.deepEqual(
    FOLD_2025.censusByDepartement['13'][DELINQUANCE_TOTAL_SLUG],
    [5, 0, 0],
  );
  // The chip set is cut from the REGISTER's indicators, so the computed total
  // can never displace a published one from the row.
  assert.equal(selectDelinquanceChips(FOLD_2025.census).includes(DELINQUANCE_TOTAL_SLUG), false);
});
