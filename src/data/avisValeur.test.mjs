// src/data/avisValeur.test.mjs
//
// The arithmetic is pinned next door. What is pinned HERE is the wording,
// because on this layer the wording is the product: a number that is right and
// a sentence that is wrong publishes a wrong number.
//
// Three traps, all of them found rather than imagined:
//
// 1. THE EURO BAND IS NOT A RANGE OF PRICES ANYONE PAID. It is the €/m² band
//    multiplied by the SUBJECT'S surface. Printed as "la moitié des ventes
//    comparables" it was false whenever the comparables were not all the
//    subject's size — forty sales of 48 m² and 72 m² all at 1 000 €/m² give a
//    60 000 € band that not one of the forty landed in.
// 2. A `±` OVER AN ASYMMETRIC INTERVAL UNDERSTATES ONE SIDE. An interval built
//    from order statistics is asymmetric whenever the sample is.
// 3. A CARD LINE THAT CONTAINS THE SEPARATOR SHATTERS. `cardFromEntity()`
//    splits the description on ` · `, so a sentence carrying one arrives on
//    screen in two halves and neither is a sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupMutations, parseDvfCsv } from './dvfFeed.js';
import { projectAvisValeur } from './avisValeurFeed.js';
import {
  AVIS_BAND_CLASSES,
  AVIS_SUBJECT_COLOR,
  AVIS_SUBJECT_WITHHELD_COLOR,
  avisBandClass,
  avisChips,
  avisLegendEntries,
  avisRefusalText,
  avisSubjectCard,
  avisVoiceSummary,
  avisYearsLabel,
} from './avisValeur.js';

const PARIS_FIXTURE = new URL('./fixtures/dvf-75113-avis-250m-sample.csv', import.meta.url);
const PARIS_POINT = Object.freeze({ lon: 2.3735, lat: 48.83 });
const PARIS = Object.freeze({ code: '75113', name: 'Paris 13e Arrondissement' });
const parisMutations = groupMutations(parseDvfCsv(readFileSync(PARIS_FIXTURE, 'utf8')));

function answerFor(subject, extra = {}) {
  return {
    ...projectAvisValeur({
      mutations: parisMutations,
      subject: { ...PARIS_POINT, ...subject },
      commune: PARIS,
      years: [2025, 2024],
    }),
    ...extra,
  };
}

const ANSWERED = answerFor({ type: 'Appartement', surfaceM2: 60 });
const WITHHELD = answerFor({ type: 'Appartement', surfaceM2: 150 });
const REFUSED = answerFor({ type: 'Maison', surfaceM2: 100 });

test('the fixture still reaches all three answers, or the rest of this file proves nothing', () => {
  assert.equal(ANSWERED.estimate.basis, 'comparables');
  assert.equal(WITHHELD.estimate.basis, 'range');
  assert.equal(REFUSED.estimate.basis, 'none');
});

test('the euro band is never described as prices anyone paid', () => {
  const { details } = avisSubjectCard(ANSWERED);
  const perM2 = details.find((line) => /^fourchette /.test(line));
  const euros = details.find((line) => /^soit /.test(line));
  assert.ok(perM2.includes('€/m²'), perM2);
  assert.ok(/la moitié des ventes comparables$/.test(perM2), perM2);
  assert.ok(euros.includes('ramené aux 60 m² du sujet'), euros);
  assert.ok(euros.endsWith('pas des prix payés'), euros);
  // The claim that half the sales landed inside a band may only ever be made
  // about the €/m², never about a euro total.
  for (const line of details) {
    if (/moitié des ventes/.test(line)) assert.ok(line.includes('€/m²'), line);
  }
  const legend = avisLegendEntries(ANSWERED);
  const eurosRow = legend.find((row) => /^soit /.test(row.label));
  assert.ok(eurosRow.blurb.includes('Ce ne sont PAS les prix'), eurosRow.blurb);
  // And the band is not sold as a bound on the subject either.
  const bandRow = legend.find((row) => /^fourchette /.test(row.label));
  assert.ok(/ne le borne pas/.test(bandRow.blurb), bandRow.blurb);
});

test('an asymmetric interval is printed as two numbers, a symmetric one as one', () => {
  const asymmetric = answerFor({ type: 'Appartement', surfaceM2: 60 });
  asymmetric.estimate.prixM2 = {
    ...asymmetric.estimate.prixM2,
    median: 1000,
    ci90: { lo: 600, hi: 1000, coverage: 0.94 },
    ciDeviationPct: { low: 40, high: 0, max: 40 },
  };
  const line = avisSubjectCard(asymmetric).details.find((entry) => /^milieu connu/.test(entry));
  assert.ok(line.includes('−40 % / +0 %'), line);
  assert.ok(!line.includes('±'), line);

  const symmetric = answerFor({ type: 'Appartement', surfaceM2: 60 });
  symmetric.estimate.prixM2 = {
    ...symmetric.estimate.prixM2,
    ciDeviationPct: { low: 3.2, high: 3.2, max: 3.2 },
  };
  const same = avisSubjectCard(symmetric).details.find((entry) => /^milieu connu/.test(entry));
  assert.ok(same.includes('±3,2 %'), same);
});

test('the interval never claims more than an independent draw would buy', () => {
  const line = avisSubjectCard(ANSWERED).details.find((entry) => /^milieu connu/.test(entry));
  assert.ok(/tirage indépendant du marché local/.test(line), line);
  const row = avisLegendEntries(ANSWERED).find((entry) => /^milieu connu/.test(entry.label));
  assert.ok(/lève une hypothèse sur la forme/.test(row.blurb), row.blurb);
  assert.ok(/ne peut\s+que baisser la couverture réelle/.test(row.blurb.replace(/\s+/g, ' ')),
    row.blurb);
});

test('no card line carries the separator that would shatter it', () => {
  for (const payload of [ANSWERED, WITHHELD, REFUSED]) {
    const { title, details } = avisSubjectCard(payload);
    assert.ok(!title.includes(' · '), title);
    for (const line of details) assert.ok(!line.includes(' · '), line);
    // And the join survives a round trip through the shell's own splitter.
    assert.deepEqual(details.join(' · ').split(' · '), details);
  }
});

test('each silence gets its own sentence, and none of them is generic', () => {
  const sentences = new Set();
  for (const reason of ['register-does-not-cover', 'no-comparable',
    'centre-softer-than-market', 'interval-too-wide']) {
    const text = avisRefusalText({
      subject: { type: 'Appartement', surfaceM2: 60 },
      estimate: { basis: reason === 'no-comparable' ? 'none' : 'range', reason, count: 6 },
    });
    assert.ok(text && text.length > 40, `${reason}: ${text}`);
    sentences.add(text);
  }
  assert.equal(sentences.size, 4, 'four silences, four sentences');
  assert.equal(avisRefusalText(ANSWERED), null, 'an answer has no refusal to explain');
  assert.ok(/livre foncier/.test(avisRefusalText({
    estimate: { basis: 'none', reason: 'register-does-not-cover' },
  })));
});

test('a withheld centre is drawn and described as one', () => {
  assert.equal(WITHHELD.estimate.prixM2.median, null);
  assert.ok(WITHHELD.estimate.prixM2.withheldMedian > 0);
  const { details } = avisSubjectCard(WITHHELD);
  assert.equal(details[0], 'pas de valeur publiée');
  assert.ok(details.some((line) => /Fourchette seulement/.test(line)), details.join(' | '));
  // The band still travels: refusing a centre is not refusing the answer.
  assert.ok(details.some((line) => /^fourchette /.test(line)));
  const [headline] = avisLegendEntries(WITHHELD);
  assert.ok(/pas de valeur publiée/.test(headline.label), headline.label);
  assert.notEqual(AVIS_SUBJECT_COLOR, AVIS_SUBJECT_WITHHELD_COLOR);
});

test('the band classes cover the line and the two sides of it', () => {
  const band = { p25: 1000, p75: 2000 };
  assert.equal(avisBandClass(999, band).id, 'under');
  assert.equal(avisBandClass(1000, band).id, 'inside');
  assert.equal(avisBandClass(2000, band).id, 'inside');
  assert.equal(avisBandClass(2001, band).id, 'over');
  assert.equal(avisBandClass(1500, { p25: null, p75: 2000 }), null);
  assert.equal(avisBandClass(null, band), null);
  assert.equal(new Set(AVIS_BAND_CLASSES.map((klass) => klass.color)).size, 3);
});

test('the drift row reports the counts instead of asserting something about them', () => {
  // `basis: 'none'` has TWO causes — no edition reaches the floor, or only one
  // does and a trend needs two. The row used to assert the first in both cases.
  const oneSolidYear = {
    ...ANSWERED,
    drift: {
      basis: 'none',
      pct: null,
      fromYear: null,
      toYear: null,
      perYear: [
        { year: '2024', count: 40, comparableCount: 40, medianPrixM2: 8500 },
        { year: '2025', count: 4, comparableCount: 4, medianPrixM2: null },
      ],
    },
  };
  const row = avisLegendEntries(oneSolidYear).find((entry) => /dérive/.test(entry.label));
  assert.equal(row.count, 1, 'one edition qualifies, and the row says so');
  assert.ok(/2024 40 vente/.test(row.blurb), row.blurb);
  assert.ok(/2025 4 vente/.test(row.blurb), row.blurb);
  assert.ok(!/Aucun millésime/.test(row.blurb), row.blurb);
});

test('an edition that failed to download is not an edition with no sales', () => {
  const partial = { ...ANSWERED, unavailableYears: [2024] };
  const row = avisLegendEntries(partial).find((entry) => /non téléchargé/.test(entry.label));
  assert.equal(row.count, 1);
  assert.ok(/EXISTENT et ne sont pas arrivées/.test(row.blurb), row.blurb);
  assert.ok(avisSubjectCard(partial).details
    .some((line) => /indisponible\(s\) au moment/.test(line)));
  // Nothing of the sort is claimed when every edition arrived.
  assert.equal(avisLegendEntries(ANSWERED).some((entry) => /non téléchargé/.test(entry.label)),
    false);
});

test('a pinned subject says that its point does not travel in a share link', () => {
  const pinnedRow = avisLegendEntries(ANSWERED, { pinned: true })
    .find((entry) => /point choisi/.test(entry.label));
  assert.ok(pinnedRow, 'the disclosure exists');
  assert.ok(/rouvrira la couche sous la CAMÉRA/.test(pinnedRow.blurb), pinnedRow.blurb);
  assert.equal(avisLegendEntries(ANSWERED).some((entry) => /point choisi/.test(entry.label)),
    false, 'and it is absent while the scan follows the camera');
});

test('the chips exist before any scan, and offer the release only once pinned', () => {
  const cold = avisChips({ type: 'Appartement', surface: '60' }, null);
  assert.ok(cold.length >= 6, `${cold.length} chips`);
  assert.equal(cold.filter((chip) => chip.id.startsWith('type:')).length, 2);
  assert.equal(cold.some((chip) => chip.id === 'centre:camera'), false);
  assert.equal(cold.find((chip) => chip.id === 'surface:60').active, true);
  // A surface chip changes the COMPARABLE BAND, and its title has to say so.
  assert.ok(/bande de surface/.test(cold.find((chip) => chip.id === 'surface:100').title));
  const pinned = avisChips({ type: 'Appartement', surface: '60' }, { pinned: true });
  const release = pinned.find((chip) => chip.id === 'centre:camera');
  assert.ok(release && /n’est PAS transporté/.test(release.title), release?.title);
});

test('the editions are named the way a French reader writes them', () => {
  assert.equal(avisYearsLabel([2025]), 'édition 2025');
  assert.equal(avisYearsLabel([2024, 2025]), 'éditions 2024 et 2025');
  assert.equal(avisYearsLabel([2025, 2023, 2024]), 'éditions 2023 à 2025');
  assert.equal(avisYearsLabel([]), null);
  assert.equal(avisYearsLabel(null), null);
});

// ── WHAT THE VOICE MAY SAY ─────────────────────────────────────────────────
// Same discipline as the card: the estimate is the layer's, never the
// speaker's. The wording trap here is `basis` — three states, and only one of
// them permits a single price.

test('the voice summary publishes a centre only when the estimate has one', () => {
  const stats = {
    dormant: false, commune: 'Bordeaux', years: [2025, 2024, 2023],
    basis: 'comparables', reason: null, comparableCount: 69,
    subjectType: 'Appartement', subjectSurfaceM2: 60, rungRadiusM: 300,
    prixM2Median: 5300, prixM2P25: 4600, prixM2P75: 6100,
    valeurMedian: 318_000, ciDeviationMaxPct: 11, surfaceMedian: 52, driftPct: -4.3,
  };
  const summary = avisVoiceSummary(stats);
  assert.equal(summary.estimatedPrixM2, 5300);
  assert.equal(summary.estimatedValeurEur, 318_000);
  assert.equal(summary.comparableCount, 69);
  assert.equal(summary.radiusM, 300);
  // The band is symmetric in metres and the market is not: the comparables'
  // own median surface is printed rather than assumed to be the subject's.
  assert.equal(summary.comparableSurfaceMedianM2, 52);

  // `range` is the proxy REFUSING to centre the sample. Republishing the
  // quartiles' midpoint as a price would smuggle back the very number the
  // refusal withheld.
  const range = avisVoiceSummary({ ...stats, basis: 'range', reason: 'interval-too-wide' });
  assert.equal(range.estimatedPrixM2, null);
  assert.equal(range.estimatedValeurEur, null);
  assert.equal(range.prixM2P25, 4600);
  assert.equal(range.reason, 'interval-too-wide');

  // Nothing to speak for: off the air, or above the scan ceiling.
  assert.equal(avisVoiceSummary({ ...stats, dormant: true }), null);
  assert.equal(avisVoiceSummary(null), null);

  // Still computing is a THIRD state, and it must not read as "no comparables".
  const pending = avisVoiceSummary({ ...stats, basis: null });
  assert.equal(pending.pending, true);
  assert.equal(pending.estimatedPrixM2, undefined);
  assert.match(pending.note, /NOT "no comparables here"/);

  // And where it was centred, so a neighbourhood the camera has left cannot be
  // quoted for the one it has arrived at.
  assert.deepEqual(
    avisVoiceSummary({ ...stats, scanCentre: { lat: 44.8446, lon: -0.5786 } }).measuredAt,
    { lat: 44.8446, lon: -0.5786 },
  );
  assert.equal(summary.measuredAt, null);
});
