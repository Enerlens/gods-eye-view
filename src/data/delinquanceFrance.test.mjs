// What the DRAWN layer is allowed to claim, once the fold and the national
// rollup have already been proved.
//
// THE PROPERTY THIS FILE EXISTS FOR: **a withheld cell is not a zero and is not
// a low value, and nothing the reader can see may suggest otherwise.** There
// are exactly four surfaces where that could break — the fill, the bin, the
// selection card and the row legend — and there is a test below for each. A
// withheld commune must take a colour the published ramp never reaches, take no
// band, print no rate, and appear in the legend under its own name with its own
// count. The moment any one of those acquires a fallback, this layer starts
// asserting "not much crime here" about real named French communes in exactly
// the cases the SSMSI decided were too small to interpret and too identifying
// to publish.
//
// The second property is that every card says this is RECORDED delinquency —
// a function of reporting rates and of force presence — and says it in the
// publisher's own words rather than in this repo's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import delinquanceFranceLayer, {
  COMMUNE_ENTER_SPAN_DEG,
  COMMUNE_EXIT_SPAN_DEG,
  COMMUNE_MAX_PACKS,
  DELINQUANCE_FR_LABEL_SOURCE_ID,
  DELINQUANCE_FR_LAYER_ID,
  DELINQUANCE_FR_OVERLAY_SOURCE_ID,
  DELINQUANCE_MISSING_COLOR,
  DELINQUANCE_RAMP,
  DELINQUANCE_SUPPRESSED_COLOR,
  DELINQUANCE_ZERO_COLOR,
  buildDelinquanceCommuneLabel,
  buildDelinquanceCommuneRecords,
  buildDelinquanceDepartementLabel,
  buildDelinquanceLoadingLabel,
  createDelinquanceDepartementOverlayEntry,
  delinquanceBinLabels,
  delinquanceCaveat,
  delinquanceFill,
  delinquanceRegimeFor,
  delinquanceViewBox,
  delinquanceViewSpanDeg,
  formatDelinquanceRate,
  selectDelinquanceLabelCohort,
  _clearDelinquanceSelectionForTest,
  _delinquanceDepartementOverlayForTest,
  _delinquanceRowControlsForTest,
  _selectDelinquanceCommuneForTest,
  _selectDelinquanceDepartementForTest,
  _setDelinquanceStateForTest,
} from './delinquanceFrance.js';
import {
  CELL_PUBLISHED,
  CELL_SUPPRESSED,
  CELL_ZERO,
  DELINQUANCE_CELL_LABELS,
  DELINQUANCE_COMMUNE_SLUGS,
  DELINQUANCE_SUPPRESSION_RULE,
  createCommuneFold,
  joinCommuneCells,
  parseSsmsiCsv,
  projectCommuneContours,
  projectDelinquanceDepartements,
  selectDelinquanceChips,
} from './delinquanceFeed.js';
import { buildDepartementIndex } from './franceDepartements.js';
import {
  delinquanceRateBins,
  projectDelinquanceNational,
} from './delinquanceDepartements.js';

// Cesium reads the aliased line-width range off a live WebGL context, and there
// is none under `node --test`, so `ContextLimits._maximumAliasedLineWidth` sits
// at 0 and EVERY `RenderState.fromCache` throws "renderState.lineWidth is out of
// range". Priming it is a property of the harness, not of the layer.
const { default: ContextLimits } = await import('@cesium/engine/Source/Renderer/ContextLimits.js');
ContextLimits._maximumAliasedLineWidth = 16;

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const readJson = (name) => JSON.parse(read(name));
const norm = (value) => String(value).replace(/[\s ]+/g, ' ');

// ---------------------------------------------------------------------------
// The wire payloads, assembled from the real fixtures exactly as the proxy
// would assemble them. Nothing below is synthetic.
// ---------------------------------------------------------------------------
const COMMUNE_LINES = read('./fixtures/ssmsi-communes-sample.csv').split('\n').filter(Boolean);
const SINK = createCommuneFold({ year: '2025' });
for (const line of COMMUNE_LINES) SINK.push(line);
const FOLD = SINK.finish();

const DEP_PACK = projectDelinquanceDepartements({
  rows: parseSsmsiCsv(read('./fixtures/ssmsi-departements-sample.csv')),
});
const GEOJSON = JSON.parse(read('./local_data/france_departements/departements.geojson'));
const DEP_INDEX = buildDepartementIndex(GEOJSON);
const CHIPS = selectDelinquanceChips(FOLD.census);

const BASE = {
  departements: DEP_PACK.departements,
  years: DEP_PACK.years,
  newestYear: DEP_PACK.newestYear,
  chips: CHIPS,
  census: FOLD.census,
  censusByDepartement: FOLD.censusByDepartement,
  communes: FOLD.communeCount,
  edition: '2026-07-09',
};

/** The `/api/delinquance-fr/communes/<dep>` payload for one département. */
function packFor(departement, geojsonName) {
  const contours = projectCommuneContours(readJson(geojsonName));
  const joined = joinCommuneCells({ contours: contours.communes, cells: FOLD.communes, departement });
  const thresholds = {};
  const means = {};
  for (const slug of DELINQUANCE_COMMUNE_SLUGS) {
    const slot = DELINQUANCE_COMMUNE_SLUGS.indexOf(slug);
    const rates = [];
    for (const [, entry] of FOLD.communes) {
      const cell = entry.cells[slot];
      if (cell && cell[0] === CELL_PUBLISHED && cell[2] > 0) rates.push(cell[2]);
    }
    thresholds[slug] = delinquanceRateBins(rates);
    means[slug] = FOLD.departementMeans[departement]?.[slug] || null;
  }
  return {
    departement, year: FOLD.year, communes: joined.communes, unshaped: joined.unshaped, thresholds, means,
  };
}

const PACK_2B = packFor('2B', './fixtures/geoapi-communes-2b-sample.json');
const PACK_75 = packFor('75', './fixtures/geoapi-communes-75-sample.json');

const national = (indicator) => projectDelinquanceNational({
  departements: BASE.departements,
  years: BASE.years,
  index: DEP_INDEX,
  indicator,
  year: '2025',
  communeCensus: Object.fromEntries(Object.entries(BASE.censusByDepartement)
    .map(([dep, byIndicator]) => [dep, byIndicator[indicator] || null])),
});

/** A recording overlay host, so selection runs with no worldOverlay. */
function recordingHost() {
  const calls = { set: [], cleared: [], visible: [] };
  return {
    calls,
    setEntries: (sourceId, entries) => calls.set.push({ sourceId, entries }),
    clearSource: (sourceId) => calls.cleared.push(sourceId),
    setVisible: (sourceId, visible) => calls.visible.push({ sourceId, visible }),
  };
}

/**
 * The smallest viewer the selection paths touch. `selectDepartement()` and
 * `selectCommune()` place their card with `Cesium.Cartesian3.fromDegrees`, and
 * both return early without a `_viewer`, so a test that omits this proves
 * nothing at all.
 */
function fakeViewer() {
  return { scene: { requestRender() {} }, dataSources: { add() {}, remove() {} } };
}

const RAMP = new Set(DELINQUANCE_RAMP.map((css) => css.toLowerCase()));
const slotOf = (slug) => DELINQUANCE_COMMUNE_SLUGS.indexOf(slug);

test('the layer object satisfies the manager contract the registry assumes', () => {
  assert.equal(delinquanceFranceLayer.id, DELINQUANCE_FR_LAYER_ID);
  assert.equal(DELINQUANCE_FR_LAYER_ID, 'delinquance-fr');
  for (const hook of ['init', 'enable', 'disable', 'update']) {
    assert.equal(typeof delinquanceFranceLayer[hook], 'function', `${hook} is required`);
  }
  assert.equal(delinquanceFranceLayer.icon, '🚓');
  // The hazards group already carries weather and industrial-risk glyphs, and
  // this layer is a register, not a warning.
  assert.notEqual(delinquanceFranceLayer.icon, '⚠');
  assert.notEqual(delinquanceFranceLayer.icon, '🔥');
  assert.ok(delinquanceFranceLayer.updateInterval > 0);
  // THE CAVEAT IS IN THE LAYER HEADER ITSELF, not only on the cards: the name
  // and the provenance line both say ENREGISTRÉE, so the panel row says it
  // before anything is clicked.
  assert.match(delinquanceFranceLayer.name, /enregistrée/i);
  assert.match(delinquanceFranceLayer.source, /enregistrée/i);
  assert.match(delinquanceFranceLayer.source, /SSMSI/);
  assert.equal(/\(FR\)/.test(delinquanceFranceLayer.name), true, 'the layer object name keeps its scope');
});

test('a withheld cell can never take a colour from the published ramp', () => {
  // The single most load-bearing branch in the file: state FIRST, band second.
  // The bogus bins below are what an inverted branch would reach for.
  for (const bin of [-1, 0, 1, 2, 3, 4, 5, 99]) {
    const fill = delinquanceFill(CELL_SUPPRESSED, bin);
    assert.equal(fill.css, DELINQUANCE_SUPPRESSED_COLOR);
    assert.equal(RAMP.has(fill.css.toLowerCase()), false,
      'the withheld colour must not be a member of the ramp');
  }
  // Off the ramp's hue range entirely — slate against gold-to-crimson — so no
  // amount of squinting turns "withheld" into "a bit less than the palest".
  assert.equal(RAMP.has(DELINQUANCE_SUPPRESSED_COLOR.toLowerCase()), false);
  assert.equal(RAMP.has(DELINQUANCE_ZERO_COLOR.toLowerCase()), false);
  assert.equal(RAMP.has(DELINQUANCE_MISSING_COLOR.toLowerCase()), false);
  assert.equal(new Set([
    DELINQUANCE_SUPPRESSED_COLOR, DELINQUANCE_ZERO_COLOR, DELINQUANCE_MISSING_COLOR,
  ]).size, 3, 'the three off-ramp states are three distinct colours');

  // A zero is the palest thing on the map and a withheld cell is heavier than
  // any published band, so weight alone separates them.
  const zero = delinquanceFill(CELL_ZERO);
  const withheld = delinquanceFill(CELL_SUPPRESSED);
  assert.notEqual(zero.css, withheld.css);
  assert.ok(withheld.alpha > zero.alpha);
  assert.ok(withheld.alpha > delinquanceFill(CELL_PUBLISHED, 0).alpha);

  // A published cell with no usable band falls back to the zero wash, never to
  // the withheld colour — inventing a refusal is as wrong as inventing a value.
  assert.equal(delinquanceFill(CELL_PUBLISHED, -1).css, DELINQUANCE_ZERO_COLOR);
  // No row at all is its own thing again.
  assert.equal(delinquanceFill(null).css, DELINQUANCE_MISSING_COLOR);
  assert.equal(delinquanceFill(undefined).css, DELINQUANCE_MISSING_COLOR);
});

test('a withheld commune is drawn with no band, and the ramp knows nothing about it', () => {
  const { records, states } = buildDelinquanceCommuneRecords({
    packs: [PACK_2B], indicator: 'cambriolages',
  });
  assert.equal(records.length, 5);
  // Measured from the fixture: of the five Haute-Corse communes, 1 publishes a
  // burglary rate and 4 are withheld.
  assert.deepEqual(states, { published: 1, zero: 0, suppressed: 4, missing: 0 });

  for (const record of records) {
    if (record.state !== CELL_SUPPRESSED) continue;
    assert.equal(record.bin, -1, `${record.code} must take no band`);
    assert.equal(record.cell.length, 1, `${record.code} must carry no value`);
    assert.equal(RAMP.has(delinquanceFill(record.state, record.bin).css.toLowerCase()), false);
    // The departmental mean is attached, and ONLY to a withheld record, so no
    // published commune can be shaded with somebody else's average.
    assert.ok(record.mean, `${record.code} carries the département's mean for the card`);
  }
  for (const record of records) {
    if (record.state === CELL_SUPPRESSED) continue;
    assert.equal(record.mean, null, `${record.code} is published and must carry no borrowed mean`);
  }
  // Poggio-Mezzana is withheld on all fifteen indicators — one of the 7 such
  // communes in France, measured 2026-09-02.
  for (const slug of DELINQUANCE_COMMUNE_SLUGS) {
    const { records: rows } = buildDelinquanceCommuneRecords({ packs: [PACK_2B], indicator: slug });
    const poggio = rows.find((row) => row.code === '2B242');
    assert.equal(poggio.state, CELL_SUPPRESSED, `2B242/${slug}`);
    assert.equal(poggio.bin, -1);
  }
});

test('an indicator with no commune map yields no records rather than an empty map', () => {
  // `Homicides` exists only at département and région grain. Asking for it at
  // commune grain must produce nothing to draw, not fifteen zeros.
  const { records, states } = buildDelinquanceCommuneRecords({
    packs: [PACK_2B], indicator: 'homicides',
  });
  assert.equal(states.published, 0);
  assert.equal(states.suppressed, 0);
  assert.equal(states.missing, records.length);
  for (const record of records) {
    assert.equal(record.cell, null);
    assert.equal(record.state, null);
    assert.equal(record.bin, -1);
    assert.equal(delinquanceFill(record.state, record.bin).css, DELINQUANCE_MISSING_COLOR);
  }
  assert.deepEqual(buildDelinquanceCommuneRecords({ packs: null, indicator: 'cambriolages' }).records, []);
});

test('a withheld commune’s card quotes the rule and prints no value for the cell', () => {
  const { records } = buildDelinquanceCommuneRecords({ packs: [PACK_2B], indicator: 'cambriolages' });
  const withheld = records.find((row) => row.code === '2B242');
  assert.ok(withheld);
  const card = norm(buildDelinquanceCommuneLabel(withheld));

  assert.match(card, /Poggio-Mezzana/);
  assert.match(card, new RegExp(DELINQUANCE_CELL_LABELS.suppressed.replace(/[-—]/g, '.')));
  // The publisher's own sentence, word for word. The paraphrase this card used
  // to print — « entre 1 et 5 faits » — is refuted by the register itself:
  // 4 735 of the 251 145 withheld 2025 cells published more than 5 facts in
  // 2023 or 2024.
  assert.match(card, /plus de 5 faits ont été enregistrés pendant 3 années successives/);
  assert.match(card, /Le critère porte sur TROIS ANNÉES/);
  assert.equal(/entre 1 et 5 faits/i.test(card), false, 'the false gloss must be gone');
  // No rate, no count, no "0" presented as this commune's value.
  assert.equal(/\d+,\d+ pour 1 000 logements ·/.test(card), false, `"${card}" must quote no rate`);
  assert.equal(/Aucun fait/.test(card), false, 'withheld is not "no fact recorded"');
});

test('the departmental mean is labelled as the département’s, never as the commune’s', () => {
  // `complement_info_taux` is « Valeur pour 1 000 moyenne parmi les communes du
  // département sous secret statistique ». Colouring a commune with it would
  // paint a departmental average and call it local crime.
  const { records } = buildDelinquanceCommuneRecords({ packs: [PACK_2B], indicator: 'cambriolages' });
  const withheld = records.find((row) => row.code === '2B242');
  const card = norm(buildDelinquanceCommuneLabel(withheld));
  assert.match(card, /moyenne parmi les communes du département sous secret statistique/);
  assert.match(card, /pas la valeur de cette commune/);
  // And it never becomes a fill: the record's bin stays -1 whatever the mean is.
  assert.equal(withheld.bin, -1);
  assert.equal(delinquanceFill(withheld.state, withheld.bin).css, DELINQUANCE_SUPPRESSED_COLOR);

  // Where two departmental means coexist — Marseille's arrondissements form
  // their own withheld sub-population — the card says so instead of picking one
  // silently. Measured: 2 of the 1 472 (dep, indicateur) pairs do this.
  const marseille = {
    ...PACK_2B,
    departement: '13',
    communes: [{
      c: '13204', n: 'Marseille 4e', pop: 49363, log: 29927, s: 0,
      p: [[5.39, 43.30, 5.40, 43.30, 5.40, 43.31, 5.39, 43.30]],
      v: FOLD.communes.get('13204').cells,
    }],
    means: { 'vols-armes': FOLD.departementMeans['13']['vols-armes'] },
  };
  const { records: rows } = buildDelinquanceCommuneRecords({ packs: [marseille], indicator: 'vols-armes' });
  assert.equal(rows[0].state, CELL_SUPPRESSED);
  assert.equal(rows[0].mean.variants, 2);
  assert.match(norm(buildDelinquanceCommuneLabel(rows[0])), /deux moyennes coexistent/);
});

test('a published zero’s card is a claim, and reads nothing like a refusal', () => {
  const { records } = buildDelinquanceCommuneRecords({ packs: [PACK_2B], indicator: 'vols-armes' });
  const zero = records.find((row) => row.state === CELL_ZERO);
  assert.ok(zero, 'the fixture must contain a real published zero');
  const card = norm(buildDelinquanceCommuneLabel(zero));
  assert.match(card, /Aucun fait enregistré/);
  assert.match(card, /0 fait, publié comme tel/);
  // The other half of the SSMSI rule, quoted: a zero is only published when the
  // absence held for three successive years.
  assert.match(card, /l’absence de faits enregistrés lorsqu’elle se reproduit sur 3 années successives/);
  // A zero card must not carry the suppression rule — the two must never blur.
  assert.equal(/Non diffusé/.test(card), false, `"${card}" must not read as withheld`);
  assert.equal(card.includes(norm(DELINQUANCE_SUPPRESSION_RULE)), false);

  // Textually and visually distinguishable, both directions, in one comparison.
  const withheld = buildDelinquanceCommuneLabel(
    buildDelinquanceCommuneRecords({ packs: [PACK_2B], indicator: 'cambriolages' })
      .records.find((row) => row.state === CELL_SUPPRESSED),
  );
  assert.notEqual(norm(withheld), card);
  assert.notEqual(delinquanceFill(CELL_ZERO).css, delinquanceFill(CELL_SUPPRESSED).css);
});

test('a published commune’s card carries its rate, its unit and its denominator', () => {
  const { records } = buildDelinquanceCommuneRecords({ packs: [PACK_75], indicator: 'cambriolages' });
  const paris = records.find((row) => row.code === '75056');
  assert.equal(paris.state, CELL_PUBLISHED);
  assert.ok(paris.bin >= 0);
  const card = norm(buildDelinquanceCommuneLabel(paris));
  assert.match(card, /Paris/);
  assert.match(card, /pour 1 000 logements/);
  assert.match(card, /2 103 778 habitants/);
  // The contour was decimated from 532 vertices to 60, and the card says so —
  // a commune limit is a legal object and this is not one.
  assert.match(card, /Contour simplifié/);
});

test('a commune with no inhabitants is reported, never divided', () => {
  // The six villages détruits of Verdun: `insee_pop = 0`, so no per-1 000
  // rate exists. The register publishes `nombre = 0` with `taux` = NA.
  const record = {
    id: 'delinquance-fr:com:55039',
    code: '55039',
    name: 'Beaumont-en-Verdunois',
    pop: 0,
    log: 0,
    cells: FOLD.communes.get('55039').cells,
    cell: FOLD.communes.get('55039').cells[slotOf('cambriolages')],
    state: CELL_ZERO,
    bin: -1,
    indicator: 'cambriolages',
    year: '2025',
  };
  const card = norm(buildDelinquanceCommuneLabel(record));
  assert.match(card, /Population municipale nulle/);
  assert.equal(/NaN|Infinity/.test(card), false, `"${card}" must contain no arithmetic wreckage`);
});

test('every card says this is RECORDED delinquency, in the publisher’s own words', () => {
  const cards = [];
  for (const indicator of ['cambriolages', 'escroqueries', 'usage-stupefiants']) {
    for (const record of buildDelinquanceCommuneRecords({ packs: [PACK_2B], indicator }).records) {
      cards.push(norm(buildDelinquanceCommuneLabel(record)));
    }
    const pack = national(indicator);
    for (const row of pack.departements.slice(0, 12)) {
      cards.push(norm(buildDelinquanceDepartementLabel(row, { indicator, year: '2025' })));
    }
  }
  assert.ok(cards.length > 20);
  for (const card of cards) {
    assert.match(card, /Délinquance ENREGISTRÉE/, card.slice(0, 80));
    // The SSMSI's own two numbers, which say the caveat harder than any
    // sentence written here: 12 % of victims of sexual violence outside the
    // household report it, against 74 % of burglary victims.
    assert.match(card, /12 % des victimes de violences sexuelles hors ménage/);
    assert.match(card, /74 % pour les victimes de cambriolages/);
    assert.match(card, /SSMSI, juillet 2026/);
  }
  // An offence counted in `Mis en cause` says which kind of claim it is.
  const stup = cards.find((card) => /^\S+ Usage de stupéfiants — 2025/.test(card));
  assert.ok(stup, 'the sweep must include a Mis en cause indicator');
  assert.match(stup, /comptée en mis en cause/);
  assert.match(stup, /activité des services/);
});

test('the first chip is the one whose meaning is least obvious, and it says so', () => {
  // Escroqueries is the indicator with the most communes carrying a published
  // positive value (8 134 nationally on the 2025 edition), so it is what the
  // layer opens on — and the PDF says its victims are counted where they LIVE.
  const caveat = norm(delinquanceCaveat('escroqueries'));
  assert.match(caveat, /LIEU DE RÉSIDENCE/);
  assert.match(caveat, /où habitent les victimes/);
  assert.match(norm(delinquanceCaveat('cambriolages')), /1 000 LOGEMENTS/);
  // A withheld cell adds the rule; a published one does not need it.
  assert.equal(norm(delinquanceCaveat('cambriolages')).includes(norm(DELINQUANCE_SUPPRESSION_RULE)), false);
  assert.equal(
    norm(delinquanceCaveat('cambriolages', { state: CELL_SUPPRESSED }))
      .includes(norm(DELINQUANCE_SUPPRESSION_RULE)),
    true,
  );
  assert.doesNotThrow(() => delinquanceCaveat(null));
  assert.doesNotThrow(() => delinquanceCaveat('nope', { state: CELL_SUPPRESSED }));
});

test('the row legend names the withheld state apart and never folds it into a band', () => {
  const host = recordingHost();
  _setDelinquanceStateForTest({
    viewer: fakeViewer(), overlayHost: host, base: BASE,
    packs: [['2B', PACK_2B]], visibleDeps: ['2B'],
    indicator: 'cambriolages', year: '2025', regime: 'communes',
  });
  const { chips, legend } = _delinquanceRowControlsForTest();
  assert.equal(chips.length, 6);
  assert.equal(chips.filter((chip) => chip.active).length, 1);
  for (const chip of chips) {
    assert.ok(chip.label, 'every chip is named');
    assert.equal(/\(FR\)/.test(chip.label), false);
    assert.match(chip.title, /unité de compte/);
  }

  const withheldRows = legend.filter((row) => row.color === DELINQUANCE_SUPPRESSED_COLOR);
  assert.equal(withheldRows.length, 1, 'the withheld state is exactly one legend row');
  assert.equal(withheldRows[0].count, 4, 'four of the five Haute-Corse communes are withheld');
  assert.match(withheldRows[0].label, /Non diffusé/);
  // The blurb quotes the rule rather than paraphrasing it.
  assert.match(norm(withheldRows[0].blurb), /plus de 5 faits ont été enregistrés pendant 3 années successives/);
  assert.equal(/entre 1 et 5/i.test(norm(withheldRows[0].blurb)), false);
  // No band's count may include it.
  for (const row of legend) {
    if (row === withheldRows[0]) continue;
    assert.notEqual(row.color, DELINQUANCE_SUPPRESSED_COLOR);
  }
  _clearDelinquanceSelectionForTest();
});

test('THE NATIONAL WITHHELD COUNT REACHES THE CARD AT EVERY ZOOM', () => {
  // At national altitude nothing is withheld — the DEP base has no
  // `est_diffuse` column at all — so the map looks complete. The legend must
  // still carry the number a reader will meet one zoom later, or the layer is
  // hiding its own limit at the one zoom where it is invisible.
  const host = recordingHost();
  _setDelinquanceStateForTest({
    viewer: fakeViewer(), overlayHost: host, base: BASE, national: national('vols-armes'),
    depIndex: DEP_INDEX, indicator: 'vols-armes', year: '2025', regime: 'departements',
  });
  const { legend } = _delinquanceRowControlsForTest();
  const nationalRow = legend.find((row) => /national/.test(row.label));
  assert.ok(nationalRow, 'the national withheld count must be on the legend at département zoom');
  assert.equal(nationalRow.color, DELINQUANCE_SUPPRESSED_COLOR);
  assert.equal(nationalRow.count, FOLD.census['vols-armes'][CELL_SUPPRESSED]);
  assert.equal(nationalRow.count, 9, '9 of the 18 fixture communes are withheld for Vols avec armes');
  assert.match(norm(nationalRow.blurb), /plus de 5 faits/);

  // And it reaches the SELECTED département's card as a proportion.
  const card = norm(buildDelinquanceDepartementLabel(
    national('vols-armes').departements.find((row) => row.code === '13'),
    { indicator: 'vols-armes', year: '2025' },
  ));
  assert.match(card, /4 des 5 communes non diffusées/);
  assert.match(card, /1 avec une valeur publiée/);
  _clearDelinquanceSelectionForTest();
});

test('selecting a commune puts one card on its own overlay source, and clearing removes it', () => {
  const host = recordingHost();
  const { records } = buildDelinquanceCommuneRecords({ packs: [PACK_2B], indicator: 'cambriolages' });
  _setDelinquanceStateForTest({
    viewer: fakeViewer(), overlayHost: host, base: BASE, packs: [['2B', PACK_2B]],
    communeRecords: records, indicator: 'cambriolages', year: '2025', regime: 'communes',
  });

  const withheld = records.find((row) => row.state === CELL_SUPPRESSED);
  _selectDelinquanceCommuneForTest(withheld.id);
  const painted = host.calls.set.filter((call) => call.sourceId === DELINQUANCE_FR_OVERLAY_SOURCE_ID);
  assert.equal(painted.length, 1);
  assert.equal(painted[0].entries.length, 1, 'exactly one card, never a cohort');
  const entry = painted[0].entries[0];
  assert.equal(entry.id, withheld.id);
  assert.ok(entry.position, 'a card must be placed, never left at 0,0');
  // The card's own body carries the rule, so what is drawn is what was tested.
  assert.match(norm(entry.details.join(' ')), /plus de 5 faits ont été enregistrés pendant 3 années/);

  _clearDelinquanceSelectionForTest();
  assert.ok(host.calls.cleared.includes(DELINQUANCE_FR_OVERLAY_SOURCE_ID));
});

test('an unknown id selects nothing rather than selecting the first commune', () => {
  const host = recordingHost();
  const { records } = buildDelinquanceCommuneRecords({ packs: [PACK_2B], indicator: 'cambriolages' });
  _setDelinquanceStateForTest({
    viewer: fakeViewer(), overlayHost: host, base: BASE, communeRecords: records,
    indicator: 'cambriolages', regime: 'communes',
  });
  _selectDelinquanceCommuneForTest('delinquance-fr:com:not-a-commune');
  assert.equal(host.calls.set.length, 0);
  // Likewise a département with no polygon anchor — the five overseas ones.
  _selectDelinquanceDepartementForTest('973');
  assert.equal(host.calls.set.length, 0, 'an offshore département has no anchor to place a card on');
  _clearDelinquanceSelectionForTest();
});

test('the ambient département labels are only drawn for published départements', () => {
  const host = recordingHost();
  const pack = national('homicides');
  const anchors = new Map(pack.departements.map((row) => [row.code, { anchor: [2.35, 48.85] }]));
  _setDelinquanceStateForTest({
    viewer: null, overlayHost: host, base: BASE, national: pack, depMeta: [...anchors],
    indicator: 'homicides', year: '2025', regime: 'departements',
  });
  const cohort = _delinquanceDepartementOverlayForTest();
  assert.ok(cohort.length > 0);
  assert.ok(cohort.length <= 14, 'the ambient cohort is capped');
  const published = new Set(pack.departements.filter((row) => row.state === CELL_PUBLISHED).map((row) => row.code));
  for (const entry of cohort) {
    const code = entry.id.split(':').pop();
    assert.equal(published.has(code), true, `${code} is not published and must carry no ambient label`);
    assert.equal(/—/.test(entry.title), false, 'a published label always carries a value');
  }
  // Ardèche published a zero and must not get a "0.000" label that reads like a
  // measurement of quietness.
  assert.equal(cohort.some((entry) => entry.id.endsWith(':07')), false);
  // The cohort is stable: same input, same order.
  assert.deepEqual(selectDelinquanceLabelCohort([]), []);
  assert.deepEqual(_delinquanceDepartementOverlayForTest().map((e) => e.id), cohort.map((e) => e.id));
  _clearDelinquanceSelectionForTest();
});

test('a withheld département would take the withheld accent, not a ramp accent', () => {
  const entry = createDelinquanceDepartementOverlayEntry(
    { code: '18', name: 'Cher', state: CELL_SUPPRESSED, bin: 3, rate: null }, { anchor: [2.4, 47.1] },
  );
  assert.equal(entry.accent, DELINQUANCE_SUPPRESSED_COLOR);
  assert.equal(RAMP.has(String(entry.accent).toLowerCase()), false);
  assert.match(entry.title, /—/, 'a withheld label offers no number');
});

test('the legend labels carry the denominator, which changes between indicators', () => {
  const thresholds = delinquanceRateBins([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const camb = delinquanceBinLabels(thresholds, 'cambriolages');
  const viol = delinquanceBinLabels(thresholds, 'violences-sexuelles');
  assert.equal(camb.length, 6);
  for (const label of camb) assert.match(norm(label), /\/ 1 000 logements$/);
  for (const label of viol) assert.match(norm(label), /\/ 1 000 habitants$/);
  assert.match(camb[camb.length - 1], /^> /);
  // A degenerate threshold list still produces one honest open-ended band.
  assert.deepEqual(delinquanceBinLabels([], 'cambriolages').length, 1);
  assert.deepEqual(delinquanceBinLabels(null, 'cambriolages').length, 1);
});

test('a rate is formatted at a precision that does not flatten homicides to 0.01', () => {
  // Homicide rates are of the order of 0.01 per 1 000; a two-decimal format
  // prints every département identically.
  assert.equal(norm(formatDelinquanceRate(0.0078318)), '0,008');
  assert.equal(norm(formatDelinquanceRate(9.2781143)), '9,28');
  assert.equal(norm(formatDelinquanceRate(95.9334025)), '95,9');
  // An ABSENT rate is a dash, never 0,000: `Number(null)` is 0, and a withheld
  // cell whose rate printed as « 0,000 pour 1 000 habitants » would be the
  // exact claim this layer exists to refuse.
  assert.equal(formatDelinquanceRate(null), '—');
  assert.equal(formatDelinquanceRate(undefined), '—');
  assert.equal(formatDelinquanceRate(''), '—');
  assert.equal(formatDelinquanceRate(NaN), '—');
  assert.equal(formatDelinquanceRate('nope'), '—');
  // A published zero is still a claim and still prints as one.
  assert.equal(norm(formatDelinquanceRate(0)), '0,000');
});

test('the regime swap has hysteresis, so a camera on the boundary does not thrash', () => {
  assert.ok(COMMUNE_EXIT_SPAN_DEG > COMMUNE_ENTER_SPAN_DEG);
  assert.equal(delinquanceRegimeFor(9.5, 'departements'), 'departements');
  assert.equal(delinquanceRegimeFor(COMMUNE_ENTER_SPAN_DEG, 'departements'), 'communes');
  // Between the two thresholds the current regime is kept, whichever it is.
  const between = (COMMUNE_ENTER_SPAN_DEG + COMMUNE_EXIT_SPAN_DEG) / 2;
  assert.equal(delinquanceRegimeFor(between, 'communes'), 'communes');
  assert.equal(delinquanceRegimeFor(between, 'departements'), 'departements');
  assert.equal(delinquanceRegimeFor(COMMUNE_EXIT_SPAN_DEG + 0.01, 'communes'), 'departements');
  // Past the limb there is no rectangle, and the national regime is the safe
  // answer — never a commune fetch for a view that covers a hemisphere.
  assert.equal(delinquanceRegimeFor(Infinity, 'communes'), 'departements');
  assert.equal(delinquanceRegimeFor(NaN, 'communes'), 'departements');
  assert.ok(COMMUNE_MAX_PACKS >= 1);
});

test('the camera helpers refuse a view they cannot measure', () => {
  assert.equal(delinquanceViewSpanDeg(null), Infinity);
  assert.equal(delinquanceViewSpanDeg({ camera: {} }), Infinity);
  assert.equal(delinquanceViewBox(null), null);
  assert.equal(delinquanceViewBox({ camera: { computeViewRectangle: () => null } }), null);
  const viewer = {
    camera: {
      computeViewRectangle: () => ({
        south: 0.85, north: 0.86, west: 0.04, east: 0.05,
      }),
    },
  };
  const span = delinquanceViewSpanDeg(viewer);
  assert.ok(span > 0 && Number.isFinite(span));
  const box = delinquanceViewBox(viewer);
  assert.ok(box.north > box.south && box.east > box.west);
  // Padded outward, so a commune straddling the edge is still fetched.
  assert.ok(box.north > (0.86 * 180) / Math.PI);
});

test('the loading copy names what is being waited on', () => {
  assert.equal(buildDelinquanceLoadingLabel({ loading: false }), null);
  assert.match(buildDelinquanceLoadingLabel({ loading: true, base: null }), /base départementale SSMSI/);
  assert.match(
    buildDelinquanceLoadingLabel({ loading: true, base: BASE, regime: 'communes' }),
    /contours communaux/,
  );
  assert.doesNotThrow(() => buildDelinquanceLoadingLabel({}));
});

test('getStats reports guidance as guidance, never as a fault', () => {
  _setDelinquanceStateForTest({
    viewer: fakeViewer(), overlayHost: recordingHost(), base: BASE, national: national('cambriolages'),
    indicator: 'cambriolages', year: '2025', regime: 'departements', status: 'empty', count: 0,
  });
  const stats = delinquanceFranceLayer.getStats();
  // `layerFeedState()` treats 'zoom-in' / 'empty' / 'idle' as GUIDANCE and
  // still paints a green ON chip. A prompt smuggled into `error` paints a fault.
  assert.ok(['zoom-in', 'empty', 'idle', 'ok'].includes(stats.status), stats.status);
  assert.equal(stats.error, undefined, 'an empty view is not an error');
  // A stale edition is flagged rather than drawn as fresh.
  _clearDelinquanceSelectionForTest();
  _setDelinquanceStateForTest({
    viewer: fakeViewer(), overlayHost: recordingHost(), base: { ...BASE, stale: true },
    indicator: 'cambriolages', regime: 'departements',
  });
  assert.equal(delinquanceFranceLayer.getStats().stale, true);
  _clearDelinquanceSelectionForTest();
});

test('the national summary carries the provenance and the withheld census', () => {
  _setDelinquanceStateForTest({
    viewer: fakeViewer(), overlayHost: recordingHost(), base: BASE, national: national('cambriolages'),
    indicator: 'cambriolages', year: '2025', regime: 'departements', visibleDeps: ['2B'],
  });
  const summary = delinquanceFranceLayer.getNationalSummary();
  assert.match(summary.attribution, /SSMSI/);
  assert.match(summary.attribution, /Licence Ouverte 2\.0/);
  assert.equal(summary.edition, '2026-07-09');
  assert.deepEqual(summary.communeCensus, FOLD.census.cambriolages);
  assert.equal(summary.offshore.length, 3);
  assert.deepEqual(summary.visibleDepartements, ['2B']);
  _clearDelinquanceSelectionForTest();
  assert.equal(delinquanceFranceLayer.getNationalSummary(), null, 'no base, no claim');
});

// NOTE: this test logs `[Data:Délinquance-FR] département shapes unavailable:
// fetch failed`. That is the layer degrading honestly, not a failure —
// `setParams` reloads the viewport, which fetches the bundled département
// outlines by URL, and there is no fetch target under `node --test`. The
// warning is the proof that the failure is caught and named rather than
// throwing through the params path.
test('setParams refuses an indicator that has no commune map', () => {
  _setDelinquanceStateForTest({
    viewer: fakeViewer(), overlayHost: recordingHost(), base: BASE,
    indicator: 'cambriolages', year: '2025', regime: 'departements',
  });
  delinquanceFranceLayer.setParams({ indicator: 'homicides' });
  assert.equal(delinquanceFranceLayer.getParams().indicator, 'cambriolages');
  delinquanceFranceLayer.setParams({ indicator: 'nonsense' });
  assert.equal(delinquanceFranceLayer.getParams().indicator, 'cambriolages');
  delinquanceFranceLayer.setParams({ indicator: 'escroqueries' });
  assert.equal(delinquanceFranceLayer.getParams().indicator, 'escroqueries');
  _clearDelinquanceSelectionForTest();
});

test('the overlay source ids are the layer’s own and do not collide', () => {
  assert.equal(DELINQUANCE_FR_OVERLAY_SOURCE_ID, 'delinquance-fr-selected');
  assert.equal(DELINQUANCE_FR_LABEL_SOURCE_ID, 'delinquance-fr-departements');
  assert.notEqual(DELINQUANCE_FR_OVERLAY_SOURCE_ID, DELINQUANCE_FR_LABEL_SOURCE_ID);
  for (const id of [DELINQUANCE_FR_OVERLAY_SOURCE_ID, DELINQUANCE_FR_LABEL_SOURCE_ID]) {
    assert.ok(id.startsWith(DELINQUANCE_FR_LAYER_ID));
  }
});
