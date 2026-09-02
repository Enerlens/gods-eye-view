// src/data/implantationFiche.test.mjs
// The composing layer: four routes fanned out into one card, and a card that
// cannot shatter.
//
// The spatial join is proved in `implantationFeed.test.mjs`. This file is about
// what the browser actually does — which URLs are called and in what order,
// what happens when a source is silent, and the separator rule that would break
// the card in a way no assertion on the payload could catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import implantationFicheLayer, {
  FICHE_DEFAULT_SECONDS,
  FICHE_STEPS,
  _ficheSecondsForTest,
  _setFicheSecondsForTest,
  ficheFetch,
  clipLabel,
  ficheLines,
  fetchPart,
  minutesLabel,
  resolveSeconds,
} from './implantationFiche.js';

/**
 * A ring big enough to hold the fixture cells, as the isochrone route sends it.
 *
 * The bounds are drawn around the two REAL cell centroids below — 4.83021 /
 * 45.77046 and 4.83277 / 45.77059 — rather than around a plausible-looking
 * Lyon box, so the join under test actually has something to join.
 */
const RING = [
  [4.8280, 45.7690], [4.8360, 45.7690], [4.8360, 45.7720], [4.8280, 45.7720],
];

const ISOCHRONE_PAYLOAD = {
  profile: 'foot',
  rings: [{ seconds: 600, areaKm2: 0.94, ring: RING, resourceVersion: '2026-08-25' }],
  missing: 0,
  expansion: [],
};

const CARREAUX_PAYLOAD = {
  resolution: 200,
  cells: [
    {
      n: 2_531_400, e: 3_918_600, ind: 500, men: 220, niveau: 24_000, pauvrete: 14,
      jeunes: 19, aines: 16, social: 8, solo: 46, proprietaires: 33, est: 0, com: '69381',
    },
    {
      n: 2_531_400, e: 3_918_800, ind: 300, men: 130, niveau: 21_000, pauvrete: 22,
      jeunes: 24, aines: 12, social: 40, solo: 38, proprietaires: 18, est: 1, com: '69381',
    },
  ],
  communes: { 69381: 'Lyon 1er Arrondissement' },
};

const GPU_PAYLOAD = {
  zones: [{ code: 'UA', label: 'centre-ville', kind: 'u', approvedOn: '2019-03-12', atPoint: true }],
  servitudes: [{ label: 'AC1 monument historique' }],
};

const DVF_PAYLOAD = {
  summary: { count: 47, comparableCount: 31, medianPrixM2: 4200 },
  years: '2020-2024',
  commune: { name: 'Lyon 1er' },
};

const BAN_PAYLOAD = {
  features: [{
    properties: {
      label: '20 Place Bellecour 69002 Lyon', city: 'Lyon', citycode: '69382',
      postcode: '69002', distance: 12,
    },
  }],
};

/**
 * A fetch stub that records every URL and answers by route.
 * @param {{silent?: string[]}} [options] Routes that must answer as failures.
 */
function stubFetch({ silent = [] } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const fail = silent.some((fragment) => String(url).includes(fragment));
    if (fail) return { ok: false, status: 503, json: async () => ({ error: 'down' }) };
    if (String(url).includes('/api/isochrone')) {
      return { ok: true, status: 200, json: async () => ISOCHRONE_PAYLOAD };
    }
    if (String(url).includes('/api/filosofi/carreaux')) {
      return { ok: true, status: 200, json: async () => CARREAUX_PAYLOAD };
    }
    if (String(url).includes('/api/gpu')) {
      return { ok: true, status: 200, json: async () => GPU_PAYLOAD };
    }
    if (String(url).includes('/api/dvf')) {
      return { ok: true, status: 200, json: async () => DVF_PAYLOAD };
    }
    if (String(url).includes('api-adresse.data.gouv.fr')) {
      return { ok: true, status: 200, json: async () => BAN_PAYLOAD };
    }
    return { ok: false, status: 404, json: async () => ({ error: 'unknown route' }) };
  };
  return { impl, calls };
}

const read = async (response) => response.json();

// ── The fan-out ─────────────────────────────────────────────────────────────

test('one scan calls four of the app\'s own routes plus the address service', async () => {
  const { impl, calls } = stubFetch();
  const response = await ficheFetch('gev:fiche?lat=45.7578&lon=4.8357&seconds=600', {}, { impl });
  assert.equal(response.ok, true);
  assert.equal(calls.filter((url) => url.includes('/api/isochrone')).length, 1);
  assert.equal(calls.filter((url) => url.includes('/api/filosofi/carreaux')).length, 1);
  assert.equal(calls.filter((url) => url.includes('/api/gpu')).length, 1);
  assert.equal(calls.filter((url) => url.includes('/api/dvf')).length, 1);
  assert.equal(calls.filter((url) => url.includes('api-adresse')).length, 1);
  assert.equal(calls.length, 5, 'no source is fetched twice');
});

test('the isochrone is fetched FIRST, because the carroyage box comes from it', async () => {
  const { impl, calls } = stubFetch();
  await ficheFetch('gev:fiche?lat=45.7578&lon=4.8357&seconds=600', {}, { impl });
  assert.ok(calls[0].includes('/api/isochrone'), calls[0]);
  // And the box it asks the carroyage for is the RING's, not the camera's.
  const carreaux = new URL(calls.find((url) => url.includes('/api/filosofi')), 'http://x');
  const south = Number(carreaux.searchParams.get('south'));
  const north = Number(carreaux.searchParams.get('north'));
  assert.ok(south < 45.7690 && north > 45.7720, 'the box must cover the ring with padding');
  // Padded by about one cell, so a square straddling the ring's own edge is
  // fetched rather than silently absent from the upper bound.
  assert.ok(45.7690 - south > 0.002 && 45.7690 - south < 0.01, `pad ${45.7690 - south}`);
});

test('one ring per scan, not three — the fiche is not the isochrone layer', async () => {
  const { impl, calls } = stubFetch();
  await ficheFetch('gev:fiche?lat=45.7578&lon=4.8357&seconds=900', {}, { impl });
  const isochrone = new URL(calls[0], 'http://x');
  assert.equal(isochrone.searchParams.get('seconds'), '900');
  assert.equal(isochrone.searchParams.get('profile'), 'foot', 'a catchment brief walks');
});

test('a point with no coordinates is refused before any request is spent', async () => {
  const { impl, calls } = stubFetch();
  const response = await ficheFetch('gev:fiche?seconds=600', {}, { impl });
  assert.equal(response.ok, false);
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

// ── A source that goes quiet ────────────────────────────────────────────────

test('a silent zoning service leaves a fiche that says so', async () => {
  const { impl } = stubFetch({ silent: ['/api/gpu'] });
  const fiche = await read(await ficheFetch('gev:fiche?lat=45.7578&lon=4.8357&seconds=600', {}, { impl }));
  assert.deepEqual(fiche.missing, ['urbanisme']);
  assert.equal(fiche.zoning, null);
  // Everything else still arrived: one source down is not a dead fiche.
  assert.ok(fiche.demand.people.count > 0);
  assert.equal(fiche.market.medianPrixM2, 4200);
  assert.ok(ficheLines(fiche).details.some((line) => /Sources muettes/.test(line)));
});

test('a silent isochrone stops the join, and the card says which half is gone', async () => {
  const { impl, calls } = stubFetch({ silent: ['/api/isochrone'] });
  const fiche = await read(await ficheFetch('gev:fiche?lat=45.7578&lon=4.8357&seconds=600', {}, { impl }));
  assert.ok(fiche.missing.includes('isochrone'));
  assert.ok(fiche.missing.includes('carroyage'));
  assert.equal(fiche.demand, null);
  // With no ring there is no box, so the carroyage is not even asked for — a
  // request that could not be joined is a request not spent.
  assert.equal(calls.filter((url) => url.includes('/api/filosofi')).length, 0);
  const lines = ficheLines(fiche).details;
  assert.ok(lines.some((line) => /Zone de chalandise indisponible/.test(line)));
  assert.ok(lines.some((line) => /Population indisponible/.test(line)));
});

test('a failed part resolves to null rather than throwing', async () => {
  const throwing = async () => { throw new Error('network'); };
  assert.equal(await fetchPart('/api/x', null, throwing), null);
  const notJson = async () => ({ ok: true, json: async () => { throw new Error('bad json'); } });
  assert.equal(await fetchPart('/api/x', null, notJson), null);
  const errorBody = async () => ({ ok: true, json: async () => ({ error: 'nope' }) });
  assert.equal(await fetchPart('/api/x', null, errorBody), null);
});

// ── The card ────────────────────────────────────────────────────────────────

test('NO card line contains the separator the factory splits on', async () => {
  // `cardFromEntity()` builds the card by splitting `description` on ' · '. A
  // line carrying one inside it arrives on screen as two fragments — the
  // bracket sentence broken in half, which is how a bracket stops being read as
  // a bracket. Silent, cosmetic-looking, and the layer's whole product.
  const { impl } = stubFetch();
  const fiche = await read(await ficheFetch('gev:fiche?lat=45.7578&lon=4.8357&seconds=600', {}, { impl }));
  const { details } = ficheLines(fiche);
  assert.ok(details.length >= 6, `expected a full fiche, got ${details.length} lines`);
  for (const line of details) {
    assert.ok(!line.includes(' · '), `line would shatter the card: ${line}`);
  }
  // And the round trip the layer actually performs must give the lines back.
  assert.deepEqual(details.join(' · ').split(' · '), details);
});

test('the headline is a bracket, and the bounds are on the card', async () => {
  const { impl } = stubFetch();
  const fiche = await read(await ficheFetch('gev:fiche?lat=45.7578&lon=4.8357&seconds=600', {}, { impl }));
  const { details, title } = ficheLines(fiche);
  assert.equal(title, '20 Place Bellecour 69002 Lyon');
  assert.ok(details.some((line) => /habitants/.test(line)), 'a population line');
  assert.ok(details.some((line) => /^Entre .* et .* selon qu’on compte/.test(line)),
    `the bounds must be printed: ${details.join(' | ')}`);
  // The four counts must add up on screen: inside + straddling = touched.
  const partition = details.find((line) => /carreaux de \d+ m retenus au centre/.test(line));
  assert.ok(partition, `the partition line is missing: ${details.join(' | ')}`);
  const [, counted, touched, inside, straddling] = /(\d+) carreaux de \d+ m retenus au centre sur (\d+) touchés \((\d+) entiers, (\d+) à cheval\)/
    .exec(partition) || [];
  assert.ok(counted, `the partition line does not parse: ${partition}`);
  assert.equal(Number(inside) + Number(straddling), Number(touched),
    'inside + straddling must equal touched, or a reader cannot add them up');
  assert.ok(Number(counted) <= Number(touched));
  assert.ok(details.some((line) => /Niveau de vie moyen/.test(line)));
  assert.ok(details.some((line) => /imputé/.test(line)), 'the imputation is never dropped');
  // The fixture has exactly one imputed cell: the singular must be singular.
  assert.ok(details.some((line) => /^1 carreau imputé sur /.test(line)),
    `expected a singular imputation line: ${details.join(' | ')}`);
  assert.ok(details.some((line) => /PLU zone UA/.test(line)));
  assert.ok(details.some((line) => /DVF/.test(line)));
});

test('a fiche with no population says so rather than printing a zero', async () => {
  const { impl } = stubFetch();
  const fiche = await read(await ficheFetch('gev:fiche?lat=45.7578&lon=4.8357&seconds=600', {}, { impl }));
  const empty = ficheLines({ ...fiche, demand: { ...fiche.demand, people: { low: 0, count: 0, high: 0 } } });
  assert.ok(empty.details.some((line) => /Aucun carreau INSEE habité/.test(line)));
});

test('a fiche with no address falls back to the commune, then to a generic title', () => {
  assert.equal(ficheLines({ address: { label: null, commune: 'Lyon' } }).title, 'Lyon');
  assert.equal(ficheLines({}).title, 'Fiche implantation');
});

// ── The duration control ────────────────────────────────────────────────────

test('only the three published durations are accepted', () => {
  for (const seconds of FICHE_STEPS) assert.equal(resolveSeconds(seconds), seconds);
  assert.equal(resolveSeconds(450), null, 'a duration with no chip cannot be forced');
  assert.equal(resolveSeconds('600'), 600, 'a share link decodes to a string');
  assert.equal(resolveSeconds(null), null);
  assert.equal(FICHE_DEFAULT_SECONDS, 600, 'ten minutes is the retail default');
});

test('changing the duration is refused when it is not a change, or not a duration', () => {
  _setFicheSecondsForTest(600);
  assert.equal(implantationFicheLayer.setParams({ seconds: 600 }), false);
  assert.equal(implantationFicheLayer.setParams({ seconds: 450 }), false);
  assert.equal(implantationFicheLayer.setParams({}), false);
  assert.equal(_ficheSecondsForTest(), 600);
  _setFicheSecondsForTest(FICHE_DEFAULT_SECONDS);
});

test('the duration reaches a share link, because the headline depends on it', () => {
  _setFicheSecondsForTest(900);
  assert.deepEqual(implantationFicheLayer.getParams(), { seconds: 900 });
  _setFicheSecondsForTest(FICHE_DEFAULT_SECONDS);
});

test('the chips are the three durations and exactly one is active', () => {
  _setFicheSecondsForTest(300);
  const { chips, legend } = implantationFicheLayer.getRowControls();
  assert.deepEqual(chips.map((chip) => chip.label), ['5 MIN', '10 MIN', '15 MIN']);
  assert.equal(chips.filter((chip) => chip.active).length, 1);
  assert.equal(chips.find((chip) => chip.active).id, '300');
  // The legend IS the bracket: two countable bounds and the headline between.
  assert.deepEqual(legend.map((row) => row.label),
    ['Carreaux entiers', 'Au centre du carreau', 'Carreaux touchés']);
  _setFicheSecondsForTest(FICHE_DEFAULT_SECONDS);
});

test('minutes read the way a brief says them', () => {
  assert.equal(minutesLabel(300), '5 min');
  assert.equal(minutesLabel(900), '15 min');
  assert.equal(minutesLabel(null), '—');
});

// ── The wording defects the browser found ───────────────────────────────────

test('zero imputed cells reads as good news, not as a warning about nothing', async () => {
  const { impl } = stubFetch();
  const fiche = await read(await ficheFetch('gev:fiche?lat=45.7578&lon=4.8357&seconds=600', {}, { impl }));
  const clean = {
    ...fiche,
    demand: { ...fiche.demand, imputedCells: 0, imputedShare: 0 },
  };
  const lines = ficheLines(clean).details;
  assert.ok(lines.some((line) => /^Aucun carreau imputé sur les \d+ retenus$/.test(line)),
    lines.join(' | '));
  // The old line said "0 carreaux imputés — valeurs approchées, pas observées",
  // which states the opposite of what it means.
  assert.ok(!lines.some((line) => /^0 carreau/.test(line)), lines.join(' | '));
});

test('a paragraph-long zoning label is clipped, and says it was clipped', () => {
  const long = 'Tissu urbain dense a caractere patrimonial qui regroupe toutes les fonctions '
    + 'des centres urbains. Il est constitue d ilots profonds tres occupes par le bati avec '
    + 'peu d espaces vegetalises.';
  assert.ok(long.length > 150, 'the fixture must be a real paragraph');
  const clipped = clipLabel(long);
  assert.ok(clipped.length <= 92, `${clipped.length} characters`);
  assert.ok(clipped.endsWith('.') || clipped.endsWith('…'), clipped);
  // A short label is untouched — clipping is not a formatter.
  assert.equal(clipLabel('centre-ville'), 'centre-ville');
  assert.equal(clipLabel(null), '');
});

test('the approval date is a date, not the register\'s eight digits', () => {
  const lines = ficheLines({
    zoning: { code: 'UA', label: 'centre', approvedOn: '20260326', overlapping: 1, servitudes: 0, servitudeLabels: [] },
  }).details;
  assert.ok(lines.some((line) => /approuvé le 26\/03\/2026/.test(line)), lines.join(' | '));
});

test('a ring dominated by its own border says so', async () => {
  const { impl } = stubFetch();
  const fiche = await read(await ficheFetch('gev:fiche?lat=45.7578&lon=4.8357&seconds=600', {}, { impl }));
  // Measured over place Bellecour at ten minutes: 24 carreaux retenus, and
  // nearly all of the squares the ring touches are on its edge. A reader
  // meeting a ±100 % bracket with no explanation assumes a bug.
  const borderHeavy = ficheLines({
    ...fiche,
    demand: { ...fiche.demand, cells: { inside: 2, straddling: 30, counted: 20, touched: 32 } },
  }).details;
  assert.ok(borderHeavy.some((line) => /La bordure domine/.test(line)), borderHeavy.join(' | '));
  const interior = ficheLines({
    ...fiche,
    demand: { ...fiche.demand, cells: { inside: 60, straddling: 20, counted: 70, touched: 80 } },
  }).details;
  assert.ok(!interior.some((line) => /La bordure domine/.test(line)),
    'a ring with a real interior must not carry the caveat');
});
