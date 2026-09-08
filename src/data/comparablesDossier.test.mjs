// src/data/comparablesDossier.test.mjs
// The dossier: two instruments that must never be averaged together, and every
// exclusion said out loud.
//
// The browser half — the panel, the markers, the click — is proved by
// `scripts/qa-comparables.mjs`. What is here is the arithmetic and the wording,
// which is the whole product of this layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_RATIO_SAMPLE,
  PRIX_M2_BOUNDS,
  STALE_LISTING_DAYS,
  adoptDossier,
  agree,
  ageDays,
  comparableFromDvfSale,
  comparableLines,
  dossierLines,
  dossierSummary,
  emptyDossier,
  exportDossierJson,
  importDossierJson,
  loadDossier,
  mergeComparables,
  normaliseComparable,
  parseNumber,
  portalFromUrl,
  ratioFor,
  safeListingUrl,
  sampleStats,
  saveDossier,
} from './comparablesDossier.js';

/** A fake Storage that behaves, and one that refuses. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    _map: map,
  };
}
const refusingStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

const SUBJECT = {
  label: '12 rue de la Ré, Lyon', commune: 'Lyon 2e', lat: 45.7578, lon: 4.8357,
  surface: 74, rooms: 3, type: 'Appartement',
};

/** n sales at a given €/m², positioned near the subject. */
function ventes(ratios) {
  return ratios.map((prixM2, index) => normaliseComparable({
    id: `dvf:${index}`,
    kind: 'vente',
    label: `${index} rue Test`,
    lat: 45.7578 + index * 0.0005,
    lon: 4.8357,
    price: prixM2 * 70,
    surface: 70,
    prixM2,
    lots: 1,
    date: '2025-06-15',
  }));
}

/** n listings at a given €/m². */
function annonces(ratios) {
  return ratios.map((prixM2, index) => normaliseComparable({
    id: `saisie:${index}`,
    kind: 'annonce',
    label: `${index} avenue Test`,
    lat: 45.7590,
    lon: 4.8360,
    price: prixM2 * 70,
    surface: 70,
    date: '2026-09-01',
  }));
}

test('an asking price and an actual sale are never counted in the same median', () => {
  const dossier = {
    ...emptyDossier(),
    subject: SUBJECT,
    comparables: [...ventes([5000, 5200, 5400]), ...annonces([6000, 6200, 6400])],
  };
  const summary = dossierSummary(dossier);
  assert.equal(summary.ventes.median, 5200);
  assert.equal(summary.annonces.median, 6200);
  // No third, merged median exists anywhere on the summary — the merge is the
  // failure this module was written to make impossible.
  assert.ok(!('median' in summary), 'the summary carries no combined median');
  // And the estimate is built on the observed sample, not on the intentions.
  assert.equal(summary.basis, 'ventes');
  assert.equal(summary.estimate.mid, 5200 * 74);
});

test('the negotiation gap is printed, and only when both instruments answered', () => {
  const both = dossierSummary({
    ...emptyDossier(), subject: SUBJECT,
    comparables: [...ventes([5000, 5000, 5000]), ...annonces([5500, 5500, 5500])],
  });
  assert.equal(both.gapPercent, 10);
  const onlySales = dossierSummary({
    ...emptyDossier(), subject: SUBJECT, comparables: ventes([5000, 5000, 5000]),
  });
  assert.equal(onlySales.gapPercent, null);
  const lines = dossierLines({
    ...emptyDossier(), subject: SUBJECT,
    comparables: [...ventes([5000, 5000, 5000]), ...annonces([5500, 5500, 5500])],
  });
  assert.ok(lines.some((line) => /Écart affichage sur acte \+10 %/.test(line)));
  assert.ok(lines.some((line) => /prix demandé n’est pas un prix payé/.test(line)));
});

test("a multi-lot mutation keeps the register's null instead of a computed absurdity", () => {
  // The captured case from `dvfFeed.js`: €32,000,000 spread over 179 rows.
  const sale = comparableFromDvfSale({
    id: 'm-179', date: '2024-03-02', valeur: 32_000_000, commune: 'Paris 13e',
    address: '1 avenue de France', lat: 48.8, lon: 2.37,
    dwellingSurface: 25, dwellingCount: 179, prixM2: null, types: ['Appartement'],
  });
  assert.equal(sale.prixM2, null, 'no ratio was invented for a 179-lot building');
  assert.equal(sale.ratioRefused, 'lots');
  // It is still a sale that happened, so it is still in the dossier and still
  // counted — just not in the median.
  const summary = dossierSummary({ ...emptyDossier(), subject: SUBJECT, comparables: [sale] });
  assert.equal(summary.ventes.count, 1);
  assert.equal(summary.ventes.withRatio, 0);
  assert.equal(summary.ventes.refused.lots, 1);
});

test('a keystroke away from the truth is excluded from the median, and counted', () => {
  const typo = normaliseComparable({
    kind: 'annonce', label: 'Zéro de trop', price: 320_000_000, surface: 70, lat: 45.75, lon: 4.83,
  });
  assert.equal(typo.prixM2, null);
  assert.equal(typo.ratioRefused, 'bornes');
  const dossier = { ...emptyDossier(), subject: SUBJECT, comparables: [...annonces([5000, 5100, 5200]), typo] };
  const summary = dossierSummary(dossier);
  assert.equal(summary.annonces.withRatio, 3, 'the typo never reached the median');
  assert.equal(summary.annonces.median, 5100);
  assert.equal(summary.annonces.refused.bornes, 1);
  // A5: an exclusion nobody can see is the failure. It is on the card.
  const lines = dossierLines(dossier);
  assert.ok(lines.some((line) => /Écartés du calcul — 1 hors bornes/.test(line)), lines.join('\n'));
});

test('the bounds are wide enough for the real country, on both ends', () => {
  // A commune of the Creuse and a Paris address must both pass; only typing
  // errors are meant to be caught.
  assert.equal(ratioFor({ kind: 'annonce', price: 45_000, surface: 90 }).prixM2, 500);
  assert.equal(ratioFor({ kind: 'annonce', price: 1_400_000, surface: 45 }).prixM2, 31_111);
  assert.ok(PRIX_M2_BOUNDS.min < 500 && PRIX_M2_BOUNDS.max > 31_111);
});

test('a bracket is refused below three comparables, and says which reason blocks it', () => {
  const twoOnly = { ...emptyDossier(), subject: SUBJECT, comparables: ventes([5000, 5200]) };
  assert.equal(dossierSummary(twoOnly).estimate, null);
  assert.ok(dossierLines(twoOnly).some((line) => new RegExp(
    `Pas de fourchette — moins de ${MIN_RATIO_SAMPLE} comparables`,
  ).test(line)));

  // Enough comparables, no surface on the subject: a different blocker, and it
  // must be the one named.
  const noSurface = {
    ...emptyDossier(),
    subject: { ...SUBJECT, surface: null },
    comparables: ventes([5000, 5200, 5400]),
  };
  const lines = dossierLines(noSurface);
  assert.ok(lines.some((line) => /surface du bien non renseignée/.test(line)), lines.join('\n'));
  assert.ok(!lines.some((line) => /moins de 3 comparables/.test(line)));

  // Both blocked: both named, so nobody is sent round a corner.
  const neither = { ...emptyDossier(), subject: { ...SUBJECT, surface: null }, comparables: ventes([5000]) };
  const both = dossierLines(neither).find((line) => line.startsWith('Pas de fourchette'));
  assert.match(both, /surface du bien non renseignée/);
  assert.match(both, /moins de 3 comparables/);
});

test('a short sample is a bracket that admits it is short', () => {
  const summary = dossierSummary({
    ...emptyDossier(), subject: SUBJECT, comparables: ventes([5000, 5200, 5400]),
  });
  assert.equal(summary.estimate.short, true);
  assert.equal(summary.estimate.sample, 3);
  const lines = dossierLines({
    ...emptyDossier(), subject: SUBJECT, comparables: ventes([5000, 5200, 5400]),
  });
  assert.ok(lines.some((line) => /l’échantillon est court/.test(line)));
  // And the range is never sold as a confidence interval.
  assert.ok(lines.some((line) => /pas un intervalle de confiance/.test(line)));
});

test('an estimate built on asking prices says so in the sentence', () => {
  const dossier = { ...emptyDossier(), subject: SUBJECT, comparables: annonces([6000, 6200, 6400]) };
  assert.equal(dossierSummary(dossier).basis, 'annonces');
  const line = dossierLines(dossier).find((entry) => entry.startsWith('Fourchette'));
  assert.match(line, /sur les prix demandés/);
});

test('no line can shatter the card it is printed on', () => {
  const dossier = {
    ...emptyDossier(),
    subject: SUBJECT,
    comparables: [
      ...ventes([5000, 5200, 5400]),
      ...annonces([6000, 6200]),
      normaliseComparable({ kind: 'annonce', label: 'Sans surface', price: 300_000 }),
      normaliseComparable({
        kind: 'annonce', label: 'Ailleurs', price: 300_000, surface: 60,
        note: 'note avec · un séparateur dedans', date: '2020-01-01',
      }),
    ],
  };
  for (const line of dossierLines(dossier)) {
    assert.ok(!line.includes(' · '), `line would split in two: ${line}`);
  }
  const card = comparableLines(dossier.comparables[dossier.comparables.length - 1], SUBJECT);
  for (const line of card.details) {
    assert.ok(!line.includes(' · '), `card line would split in two: ${line}`);
  }
});

test('the sentences agree in French, because a client reads them', () => {
  const one = dossierLines({
    ...emptyDossier(), subject: SUBJECT, comparables: [...ventes([5000]), ...annonces([6000])],
  });
  const header = one.find((entry) => /comparables? reten/.test(entry));
  assert.match(header, /2 comparables retenus — 1 vente DVF, 1 annonce saisie/);

  const many = dossierLines({
    ...emptyDossier(), subject: SUBJECT, comparables: [...ventes([5000, 5200]), ...annonces([6000, 6200])],
  });
  assert.match(many.find((entry) => /comparables? reten/.test(entry)),
    /4 comparables retenus — 2 ventes DVF, 2 annonces saisies/);

  // And the one that used to read « 1 comparables sans position — comptés ».
  const floating = normaliseComparable({ kind: 'annonce', label: 'Sans coordonnées', price: 350_000, surface: 70 });
  const lines = dossierLines({ ...emptyDossier(), subject: SUBJECT, comparables: [floating] });
  assert.ok(lines.some((line) => /1 comparable sans position — compté dans les médianes, absent de la carte/.test(line)),
    lines.join('\n'));
  assert.equal(agree(0, 'vente'), 'vente', 'zero takes the singular in French');
  assert.equal(agree(1, 'annonce'), 'annonce');
  assert.equal(agree(2, 'écarté'), 'écartés');
});

test('a comparable with no position is counted in the median and named as unplaced', () => {
  const floating = normaliseComparable({
    kind: 'annonce', label: 'Import sans coordonnées', price: 350_000, surface: 70,
  });
  assert.equal(floating.lat, null);
  const dossier = { ...emptyDossier(), subject: SUBJECT, comparables: [...annonces([5000, 5200]), floating] };
  const summary = dossierSummary(dossier);
  assert.equal(summary.annonces.withRatio, 3, 'it still bears a price and a surface');
  assert.equal(summary.unplaced, 1);
  assert.ok(dossierLines(dossier).some((line) => /sans position/.test(line)));
});

test('an old listing is a price the market already refused, and the card says it', () => {
  const now = Date.parse('2026-09-08T00:00:00Z');
  const old = normaliseComparable({
    kind: 'annonce', label: 'En ligne depuis un an', price: 350_000, surface: 70,
    lat: 45.75, lon: 4.83, date: '2025-08-01',
  });
  assert.ok(ageDays(old.date, now) > STALE_LISTING_DAYS);
  const lines = dossierLines({ ...emptyDossier(), subject: SUBJECT, comparables: [old] }, { now });
  assert.ok(lines.some((line) => new RegExp(`plus de ${STALE_LISTING_DAYS} jours`).test(line)));
});

test('a listing URL is a link, and only ever http or https', () => {
  assert.equal(safeListingUrl('https://www.seloger.com/annonces/123'), 'https://www.seloger.com/annonces/123');
  assert.equal(safeListingUrl('javascript:alert(1)'), null);
  assert.equal(safeListingUrl('data:text/html,<script>'), null);
  assert.equal(safeListingUrl('   '), null);
  assert.equal(safeListingUrl('pas une url'), null);
  // The portal is a label read off the host, never a route to it.
  assert.equal(portalFromUrl('https://www.leboncoin.fr/ad/ventes_immobilieres/1'), 'leboncoin.fr');
});

test('French typing is a number, not a syntax error', () => {
  assert.equal(parseNumber('320 000'), 320000);
  assert.equal(parseNumber('320 000 €'), 320000);
  assert.equal(parseNumber('74,5'), 74.5);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(null), null);
});

test('the same DVF sale cannot be retained twice', () => {
  const sale = {
    id: 'm-1', date: '2025-01-05', valeur: 350_000, commune: 'Lyon 2e', address: '3 rue Test',
    lat: 45.75, lon: 4.83, dwellingSurface: 70, dwellingCount: 1, prixM2: 5000, types: ['Appartement'],
  };
  let dossier = emptyDossier();
  ({ dossier } = mergeComparables(dossier, [comparableFromDvfSale(sale)]));
  const second = mergeComparables(dossier, [comparableFromDvfSale(sale)]);
  assert.equal(second.added, 0);
  assert.equal(second.dossier.comparables.length, 1);
});

test('an export re-imports as itself', () => {
  const dossier = {
    ...emptyDossier(), subject: SUBJECT, comparables: [...ventes([5000, 5200]), ...annonces([6000])],
  };
  const round = importDossierJson(exportDossierJson(dossier));
  assert.equal(round.mode, 'dossier');
  assert.equal(round.kept, 3);
  assert.equal(round.rejected, 0);
  assert.equal(round.dossier.subject.label, SUBJECT.label);
  assert.equal(round.dossier.comparables[0].prixM2, 5000);
});

test("an agency's own listing export imports as an array, and rejects are counted", () => {
  const result = importDossierJson(JSON.stringify([
    { adresse: '4 rue A', prix: '350 000', surface: '70', pieces: 3, latitude: 45.75, longitude: 4.83 },
    { adresse: '6 rue B', prix: 410000, surface: 82, url: 'https://exemple.fr/a/1' },
    { rien: 'du tout' },
  ]));
  assert.equal(result.mode, 'annonces');
  assert.equal(result.kept, 2);
  assert.equal(result.rejected, 1, 'a row with nothing usable is refused, and the refusal is visible');
  assert.equal(result.dossier.comparables[0].kind, 'annonce', 'an imported row is an asking price');
  assert.equal(result.dossier.comparables[0].prixM2, 5000);
  assert.equal(result.dossier.comparables[1].portal, 'exemple.fr');
});

test('an unreadable file is refused rather than half-read', () => {
  const result = importDossierJson('{ not json');
  assert.equal(result.dossier, null);
  assert.equal(result.mode, 'illisible');
});

test('storage that refuses does not take the layer down with it', () => {
  assert.deepEqual(loadDossier(refusingStorage), emptyDossier());
  assert.equal(saveDossier(emptyDossier(), refusingStorage), false);
  const storage = fakeStorage();
  assert.equal(saveDossier({ ...emptyDossier(), subject: SUBJECT }, storage), true);
  assert.equal(loadDossier(storage).subject.label, SUBJECT.label);
  // A key holding something that is not a dossier reads as an empty one.
  assert.deepEqual(loadDossier(fakeStorage({ 'godsEyeView.comparables.v1': 'nope' })), emptyDossier());
});

test('a subject without a position is not a subject', () => {
  const adopted = adoptDossier({ subject: { label: 'quelque part' }, comparables: [] });
  assert.equal(adopted.subject, null);
});

test('an empty sample answers nothing rather than zero', () => {
  const stats = sampleStats([]);
  assert.equal(stats.median, null);
  assert.equal(stats.p25, null);
  assert.equal(stats.withRatio, 0);
  assert.equal(stats.count, 0);
});

test('an empty dossier says it is empty, without inventing a bien', () => {
  const lines = dossierLines(emptyDossier());
  assert.ok(lines.some((line) => /Aucun bien défini/.test(line)));
  assert.ok(lines.some((line) => /Aucun comparable retenu/.test(line)));
});

test('an unretained comparable leaves the median and stays in the dossier', () => {
  const list = ventes([5000, 5200, 5400]);
  list[2].retained = false;
  const summary = dossierSummary({ ...emptyDossier(), subject: SUBJECT, comparables: list });
  assert.equal(summary.total, 3);
  assert.equal(summary.retained, 2);
  assert.equal(summary.ventes.withRatio, 2);
  assert.equal(summary.ventes.median, 5100);
});
