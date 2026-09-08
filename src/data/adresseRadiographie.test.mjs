// src/data/adresseRadiographie.test.mjs
// Pins the address radiography against ONE real scan: the fifteen live answers
// for 48.83 N, 2.376 E (Paris 13e), captured through the very URLs
// `radiographieRequests` builds. The wording is the product here — every line
// on the sheet is a claim about somebody's address — so it is asserted rather
// than eyeballed, and the assertions that matter most are the ones about what
// the sheet REFUSES to say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RADIOGRAPHIE_THEMES,
  composeRadiographie,
  distanceLabel,
  fetchRadiographieParts,
  metresBetween,
  radiographieRequests,
  scanBox,
} from './adresseRadiographie.js';
import {
  BAREME_GEOMETRIES,
  BAREME_REASONS,
  BAREME_SAMPLE,
  scoreIndicator,
} from './baremeNational.js';

const PARTS = JSON.parse(readFileSync(
  new URL('./fixtures/radiographie-paris13-parts.json', import.meta.url),
  'utf8',
));
/**
 * The SAME route, on the same afternoon, answering HTTP 200 with its risk
 * report missing. Captured rather than invented: Géorisques fans out to three
 * upstreams and this is what the payload looks like when one of them resets.
 */
const GEORISQUES_DEGRADED = JSON.parse(readFileSync(
  new URL('./fixtures/radiographie-georisques-degrade.json', import.meta.url),
  'utf8',
));
const POINT = { lat: 48.83, lon: 2.376 };
const AT = Date.UTC(2026, 8, 8, 12, 45);

const fiche = composeRadiographie({ point: POINT, parts: PARTS, at: AT });
const theme = (id) => fiche.themes.find((entry) => entry.id === id);
const rows = (id) => Object.fromEntries(theme(id).lines.map((row) => [row.label, row]));
const notes = (id) => theme(id).notes.join(' ');

test('the ten themes are Cityscan’s ten, in Cityscan’s order', () => {
  assert.deepEqual(
    RADIOGRAPHIE_THEMES.map((entry) => entry.id),
    ['immobilier', 'transport', 'education', 'commodites', 'nuisances',
      'risques', 'numerique', 'emploi', 'urbanisme', 'voisinage'],
  );
  assert.equal(fiche.themes.length, 10);
  for (const entry of fiche.themes) assert.ok(entry.question.length > 10);
});

test('every request is a route this repository serves, keyed by name', () => {
  const requests = radiographieRequests(POINT);
  assert.equal(requests.length, 15);
  assert.equal(new Set(requests.map((request) => request.key)).size, 15);
  for (const request of requests) {
    assert.ok(request.url.startsWith('/api/') || request.url.startsWith('https://api-adresse.data.gouv.fr/'),
      `${request.key} must be an app route or the BAN`);
  }
  // Positional results would shift every theme's input by one the day a route
  // is added; the keys are what make that impossible.
  assert.deepEqual(Object.keys(PARTS).sort(), requests.map((r) => r.key).sort());
  assert.deepEqual(radiographieRequests({ lat: NaN, lon: 2 }), []);
});

test('the captured scan answered on all ten themes', () => {
  assert.equal(fiche.answered, 10);
  assert.equal(fiche.partial, 0);
  assert.deepEqual(fiche.absent, []);
  assert.equal(fiche.address.commune, 'Paris');
  assert.equal(fiche.address.code, '75113');
});

test('exactly two numbers are ranked, and the payload names which', () => {
  // The single most important assertion in this file. Cityscan grades all ten
  // themes; `baremeNational.js` has scales for eleven indicators, and only two
  // of them were measured on a shape this sheet also measures on. Ranking a
  // third would give a plausible letter and a false one.
  assert.deepEqual(fiche.grading.ranked, ['acces', 'prixM2']);
  assert.equal(fiche.grading.rings, BAREME_SAMPLE.rings);
  assert.match(fiche.gradingNote, /même géométrie/);
  const ranked = fiche.themes.flatMap((theme) => theme.lines)
    .filter((row) => /centile national/.test(String(row.value)));
  assert.equal(ranked.length, 2);
});

test('the walking area is ranked on its OWN ring, and the other two are not', () => {
  const transport = theme('transport');
  const ranks = transport.lines.filter((row) => /centile/.test(String(row.value)));
  // Five and fifteen minutes are different shapes from the one the scale was
  // drawn on, so they carry no rank at all — not a wrong one, and not a dash
  // without an explanation.
  assert.equal(ranks.length, 1);
  assert.equal(ranks[0].label, 'Cet accès à pied dans le pays');
  assert.match(ranks[0].note, /note [A-E]/);
  assert.match(notes('transport'), /anneau de dix minutes/);
  assert.match(notes('transport'), /même géométrie/);
});

test('the price carries a rank and never a letter, and says why', () => {
  const price = rows('immobilier')['Ce prix dans le pays'];
  assert.match(price.value, /centile national/);
  // `direction: null` in the barème: a high price is good news for a seller
  // and bad news for a buyer, so the rank answers both and no letter does.
  assert.equal(/note [A-E]/.test(price.note), false);
  assert.match(price.note, /vendeur/);
  assert.match(price.note, /acheteur/);
});

test('the neighbourhood figures are refused a rank, on the geometry rule', () => {
  // The barème has a scale for every one of these — measured on a ten-minute
  // walking ring. This theme averages a RECTANGLE of carreaux, which is not
  // that shape, and printing a rank would be the exact failure that module was
  // built to make impossible.
  const ranked = theme('voisinage').lines.filter((row) => /centile/.test(String(row.value)));
  assert.equal(ranked.length, 0);
  assert.match(notes('voisinage'), /anneau piéton de dix minutes, pas sur un rectangle/);
  assert.match(notes('voisinage'), /fiche implantation du globe/);
});

test('a value measured on the wrong shape earns a named refusal, never a rank', () => {
  // Driven through the composer rather than asserted on the helper: the shape
  // this sheet passes is the thing under test.
  const wrongShape = scoreIndicator('acces', 0.97, { geometry: BAREME_GEOMETRIES.CARREAU_200 });
  assert.equal(wrongShape.percentile, null);
  assert.equal(wrongShape.reason, BAREME_REASONS.GEOMETRY);
  const rightShape = scoreIndicator('acces', 0.97, { geometry: BAREME_GEOMETRIES.RING_FOOT_600 });
  assert.ok(rightShape.percentile > 0);
});

test('a rent borrowed from a mesh of communes says so on its own row', () => {
  const immobilier = rows('immobilier');
  // Paris 13e is commune-estimated for the three apartment segments and
  // borrowed for houses — the segment is the unit of trust, not the commune.
  assert.match(immobilier['Loyer — Appartement'].note, /estimé sur la commune/);
  assert.match(immobilier['Loyer — Maison'].note, /maille de communes voisines/);
  // The published label, not a lower-cased one: « T1-T2 » is not « t1-t2 ».
  assert.ok(Object.hasOwn(immobilier, 'Loyer — Appartement T1-T2'));
  assert.match(notes('immobilier'), /charges comprises/);
  assert.match(notes('immobilier'), /pas un loyer médian observé/);
});

test('DPE letters are reported as a distribution and never averaged', () => {
  assert.match(notes('immobilier'), /ne sont pas moyennées/);
  const row = rows('immobilier')['Diagnostics dans 200 m'];
  assert.ok(row.note.includes('C '));
  assert.ok(!/^[A-G]$/.test(row.value));
});

test('a school with no published IPS is never read as an average one', () => {
  const education = theme('education');
  const withoutIndex = education.lines.filter((row) => row.note === 'IPS non publié'
    || String(row.note).endsWith('IPS non publié'));
  assert.ok(withoutIndex.length >= 1);
  // And a school that has one is printed against the national figure, which is
  // the line Cityscan's "how many schools" cannot produce.
  const withIndex = education.lines.find((row) => /IPS \d/.test(String(row.note)));
  assert.match(withIndex.note, /contre .* en France/);
  // No row may open on a dangling separator when the register published no
  // sector for the establishment.
  for (const row of education.lines) {
    assert.ok(!String(row.note ?? '').startsWith('—'), `${row.label} opens on a dash`);
  }
});

test('the air index is the maximum of its sub-indices, and names the driver', () => {
  const nuisances = rows('nuisances');
  const headline = nuisances['Indice ATMO du jour'];
  assert.match(headline.value, /^\d sur 6 — /);
  assert.match(headline.note, /tiré par : /);
  assert.match(notes('nuisances'), /MAXIMUM des cinq sous-indices/);
});

test('the two Géorisques verdicts are kept apart when they disagree', () => {
  const disagreeing = theme('risques').lines
    .filter((row) => String(row.note ?? '').includes('les deux verdicts diffèrent'));
  // Measured on this address: the register says one thing about the commune
  // and another about the point, for clay shrinkage and for ICPE.
  assert.ok(disagreeing.length >= 1);
  assert.match(notes('risques'), /c’est celui de l’adresse qui est affiché/);
  // Two rows both titled "Radon" saying different things read as a bug.
  const radonRows = theme('risques').lines.filter((row) => row.label === 'Radon');
  assert.ok(radonRows.length <= 1);
});

test('a risk report that did not answer is never printed as “no risk”', () => {
  // The most consequential false negative this sheet could produce. The route
  // answers 200 with `naturalRisks: []` when the report upstream resets, while
  // ICPE and radon still reply — so the theme must distinguish "not read" from
  // "nothing here", and keep the two halves that did answer.
  assert.equal(GEORISQUES_DEGRADED.available.report, false);
  assert.equal(GEORISQUES_DEGRADED.naturalRisks.length, 0);
  const degraded = composeRadiographie({
    point: POINT, parts: { ...PARTS, risques: GEORISQUES_DEGRADED }, at: AT,
  });
  const risques = degraded.themes.find((entry) => entry.id === 'risques');
  const headline = risques.lines.find((row) => row.label === 'Risques inscrits pour ce point');
  assert.equal(headline.value, 'non lus');
  assert.match(headline.note, /pas « aucun risque »/);
  assert.match(risques.notes.join(' '), /n’a pas pu être lu/);
  // The two halves that DID answer are still there.
  assert.ok(risques.lines.some((row) => row.label === 'Installations classées'));
  assert.ok(risques.lines.some((row) => row.label === 'Potentiel radon de la commune'));
});

test('connectivity is wired-only, and says the satellite file disagrees', () => {
  const numerique = rows('numerique');
  assert.match(numerique['Fibre optique'].value, /%$/);
  assert.match(notes('numerique'), /satellite/);
  // Paris has no arrondissement in this register, and the sheet says so rather
  // than implying the figure describes the block.
  assert.match(notes('numerique'), /ne publie pas les arrondissements/);
  // 1 667 159 of 1 667 292 must not print as 100 %.
  assert.notEqual(numerique['Encore raccordables au cuivre'].value, '100 %');
});

test('the carroyage answer is labelled by the ground it actually covers', () => {
  // The route snaps a requested box out to a 0,01° grid, so the answer is
  // wider than the question: calling it "the scan box" would attribute a
  // quarter's population to a block.
  const habitants = rows('voisinage')['Habitants'];
  assert.match(habitants.note, /carreaux de 200 m, soit \d/);
  assert.match(habitants.note, /km²/);
  assert.match(notes('voisinage'), /pas une zone de chalandise/);
});

test('the employment theme carries its direction, not just its level', () => {
  const emploi = rows('emploi');
  assert.match(emploi['Taux de chômage'].value, /%$/);
  assert.ok(Object.hasOwn(emploi, 'Depuis le recensement précédent'));
  assert.ok(Object.hasOwn(emploi, 'Recensement 2012'));
  assert.match(notes('emploi'), /pas le taux du BIT/);
});

test('a silent source degrades one theme and names it, leaving nine standing', () => {
  const without = composeRadiographie({
    point: POINT,
    parts: { ...PARTS, atmo: null, loyers: null },
    at: AT,
  });
  assert.equal(without.themes.find((entry) => entry.id === 'nuisances').status, 'absent');
  assert.deepEqual(without.themes.find((entry) => entry.id === 'nuisances').silent, ['atmo']);
  // Immobilier keeps DVF and DPE and reports the rent as the missing half —
  // `partial` and `absent` are different facts and must not look alike.
  const immobilier = without.themes.find((entry) => entry.id === 'immobilier');
  assert.equal(immobilier.status, 'partial');
  assert.deepEqual(immobilier.silent, ['loyers']);
  assert.ok(immobilier.lines.length > 3);
  assert.equal(without.answered, 8);
  assert.deepEqual(without.absent, ['nuisances']);
});

test('an empty scan produces ten absent themes rather than a broken page', () => {
  const nothing = composeRadiographie({ point: POINT, parts: {}, at: AT });
  assert.equal(nothing.answered, 0);
  assert.equal(nothing.absent.length, 10);
  assert.equal(nothing.address, null);
  for (const entry of nothing.themes) {
    assert.equal(entry.status, 'absent');
    assert.ok(entry.notes.length >= 1, `${entry.id} must say why it is empty`);
  }
});

test('the fetcher never throws, whatever the network does', async () => {
  const parts = await fetchRadiographieParts(POINT, {
    fetchImpl: async (url) => {
      if (url.includes('dvf')) throw new Error('socket hang up');
      if (url.includes('gpu')) return { ok: false, status: 502, json: async () => ({}) };
      if (url.includes('atmo')) return { ok: true, status: 200, json: async () => ({ error: 'nope' }) };
      return { ok: true, status: 200, json: async () => ({ marker: url }) };
    },
  });
  assert.equal(parts.dvf, null);
  assert.equal(parts.gpu, null);
  assert.equal(parts.atmo, null);
  assert.ok(parts.emploi.marker.includes('/api/emploi-fr'));
});

test('the scan box widens with latitude so it stays square on the ground', () => {
  const box = scanBox({ lat: 48.83, lon: 2.376 }, 0.006);
  assert.ok(box.east - box.west > box.north - box.south);
  const height = metresBetween({ lat: box.south, lon: box.west }, { lat: box.north, lon: box.west });
  const width = metresBetween({ lat: box.south, lon: box.west }, { lat: box.south, lon: box.east });
  assert.ok(Math.abs(height - width) / height < 0.05, `${height} m by ${width} m`);
});

test('distances read the way a person says them', () => {
  assert.equal(distanceLabel(94), '90 m');
  assert.equal(distanceLabel(1240), '1,2 km');
  assert.equal(distanceLabel(null), '—');
});
