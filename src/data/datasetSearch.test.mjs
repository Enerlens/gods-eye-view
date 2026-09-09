import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATAGOUV_SEARCH_URL,
  SEARCH_SHORTLIST,
  blockerLabel,
  candidateFacts,
  formatObjectCount,
  freshnessLabel,
  looksLikeDatasetAddress,
  normalizeSearchHit,
  proveCandidates,
  searchDatasets,
  shortlistDatasets,
} from './datasetSearch.js';

const NOW = Date.parse('2026-09-09T12:00:00Z');

function response(body, { status = 200 } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

const HIT_NATIONAL = {
  slug: 'geodae-base-nationale-des-defibrillateurs',
  title: "Géo'DAE - Base Nationale des Défibrillateurs",
  license: 'lov2',
  last_update: '2026-09-01T00:00:00Z',
  organization: { name: 'Atlasanté' },
  quality: { all_resources_available: true },
};
const HIT_TOWN = {
  slug: 'defibrillateurs-levallois',
  title: 'Défibrillateurs',
  license: 'fr-lo',
  last_update: '2019-05-26T00:00:00Z',
  organization: { name: 'Ville de Levallois' },
  quality: { all_resources_available: true },
};
const HIT_ZOMBIE = {
  slug: 'arbres-remarquables-donnees-geographiques-ods',
  title: 'Arbres remarquables',
  license: 'notspecified',
  last_update: '2024-01-01T00:00:00Z',
  organization: { name: 'Ville de Paris' },
  quality: { all_resources_available: false },
};

function draft(total, { publisher = 'Atlasanté', licence = 'Licence Ouverte 2.0', faults = [] } = {}) {
  return { total, faults, manifest: { attribution: { publisher, licence } } };
}

// ── one field, two intents ────────────────────────────────────────────────

test('an address is told apart from a subject without a mode switch', () => {
  assert.equal(looksLikeDatasetAddress('https://www.data.gouv.fr/datasets/x/'), true);
  assert.equal(looksLikeDatasetAddress('www.data.gouv.fr/datasets/x/'), true);
  assert.equal(looksLikeDatasetAddress('edb6a9e1-2f16-4bbf-99e7-c3eb6b90794c'), true);
  assert.equal(looksLikeDatasetAddress('défibrillateurs'), false);
  assert.equal(looksLikeDatasetAddress('bornes de recharge'), false);
  assert.equal(looksLikeDatasetAddress('   '), false);
});

// ── the four facts ────────────────────────────────────────────────────────

test('a count is grouped the French way, and an unknown one says so', () => {
  assert.equal(formatObjectCount(186118), '186 118');
  assert.equal(formatObjectCount(19), '19');
  assert.equal(formatObjectCount(null), null);
  assert.equal(formatObjectCount(undefined), null);
  assert.equal(formatObjectCount(0), '0', 'a truly empty dataset says zero, not "unknown"');
  assert.deepEqual(candidateFacts({ total: null, publisher: 'Ville de X' }), ['Ville de X'],
    'an unknown count is left out, not announced — the publisher leads instead');
});

test('freshness is coarse on purpose, and says when a dataset stopped', () => {
  assert.equal(freshnessLabel('2026-09-09T09:00:00Z', NOW), "à jour aujourd'hui");
  assert.equal(freshnessLabel('2026-09-08T09:00:00Z', NOW), 'à jour hier');
  assert.equal(freshnessLabel('2026-09-05T12:00:00Z', NOW), 'à jour il y a 4 jours');
  assert.equal(freshnessLabel('2026-06-09T12:00:00Z', NOW), 'à jour il y a 3 mois');
  assert.equal(freshnessLabel('2019-09-20T12:00:00Z', NOW), 'figé depuis 7 ans');
  assert.equal(freshnessLabel(null, NOW), null);
  assert.equal(freshnessLabel('pas une date', NOW), null);
});

test('a fact line never invents a fact it was not given', () => {
  assert.deepEqual(
    candidateFacts({ total: 186118, publisher: 'Atlasanté', lastUpdate: '2026-09-01T00:00:00Z', licence: 'Licence Ouverte 2.0' }, NOW),
    ['186 118 objets', 'Atlasanté', 'à jour il y a 1 semaine', 'Licence Ouverte 2.0'],
  );
  assert.deepEqual(candidateFacts({ total: 19 }, NOW), ['19 objets']);
  assert.deepEqual(candidateFacts({}, NOW), [], 'nothing known says nothing');
});

// ── why a candidate was set aside ─────────────────────────────────────────

test('a fault becomes one phrase a reader can act on', () => {
  assert.equal(blockerLabel('HTTP 404'), 'fichiers introuvables');
  assert.equal(
    blockerLabel('HTTP 404', { resourcesUnavailable: true }),
    'fichiers indisponibles — data.gouv.fr le signale aussi',
  );
  assert.equal(blockerLabel('`geometry` : une source tabulaire doit dire comment une ligne devient un point'), 'aucune colonne de position');
  assert.equal(blockerLabel('relais : https uniquement'), 'adresse non sécurisée');
  assert.equal(blockerLabel('relais : hôte non autorisé : dl.dropboxusercontent.com'), 'hébergeur non autorisé');
  assert.equal(blockerLabel('ce jeu ne publie aucune ressource lisible'), 'aucun fichier lisible');
  assert.equal(blockerLabel('réponse trop volumineuse'), 'fichier trop lourd');
});

test('an unknown fault is passed through, clipped, never swallowed', () => {
  assert.equal(blockerLabel('quelque chose de neuf'), 'quelque chose de neuf');
  assert.equal(blockerLabel('x'.repeat(200)).length, 62);
  assert.equal(blockerLabel(''), 'illisible');
});

// ── the search ────────────────────────────────────────────────────────────

test('the search asks the ranked endpoint and reduces each hit', async () => {
  let asked = null;
  const fetchImpl = async (url) => { asked = url; return response({ total: 119, data: [HIT_NATIONAL] }); };
  const { total, hits } = await searchDatasets('défibrillateurs', { fetchImpl, relay: null });
  assert.ok(asked.startsWith(DATAGOUV_SEARCH_URL), asked);
  assert.match(asked, /page_size=5/);
  assert.match(asked, /q=d%C3%A9fibrillateurs/);
  assert.equal(total, 119);
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], {
    slug: 'geodae-base-nationale-des-defibrillateurs',
    title: "Géo'DAE - Base Nationale des Défibrillateurs",
    page: 'https://www.data.gouv.fr/datasets/geodae-base-nationale-des-defibrillateurs/',
    publisher: 'Atlasanté',
    licence: 'Licence Ouverte 2.0',
    lastUpdate: '2026-09-01T00:00:00Z',
    resourcesUnavailable: false,
  });
});

test('an empty subject asks nothing at all', async () => {
  let called = 0;
  await searchDatasets('   ', { fetchImpl: async () => { called += 1; return response({}); }, relay: null });
  assert.equal(called, 0);
});

test("data.gouv's own dead-link verdict is carried, not re-guessed", () => {
  assert.equal(normalizeSearchHit(HIT_ZOMBIE).resourcesUnavailable, true);
  assert.equal(normalizeSearchHit(HIT_NATIONAL).resourcesUnavailable, false);
  assert.equal(normalizeSearchHit({ slug: 'x', title: 'X' }).resourcesUnavailable, false);
  assert.equal(normalizeSearchHit({ title: 'sans slug' }), null);
});

// ── proving before proposing ──────────────────────────────────────────────

test('the hits are read at once, and only the drawable ones are offered', async () => {
  const hits = [HIT_ZOMBIE, HIT_NATIONAL, HIT_TOWN].map(normalizeSearchHit);
  let concurrent = 0;
  let peak = 0;
  const infer = async (url) => {
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    await Promise.resolve();
    concurrent -= 1;
    if (url.includes('arbres')) throw new Error('HTTP 404');
    if (url.includes('levallois')) return draft(19, { publisher: 'Ville de Levallois', licence: 'Licence Ouverte 1.0' });
    return draft(186118);
  };
  const { ready, blocked } = await proveCandidates(hits, infer, { now: NOW });
  assert.equal(peak, 3, 'the three reads overlap');
  assert.deepEqual(ready.map((entry) => entry.slug), [
    'geodae-base-nationale-des-defibrillateurs',
    'defibrillateurs-levallois',
  ]);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].reason, 'fichiers indisponibles — data.gouv.fr le signale aussi');
  assert.equal(blocked[0].rawFault, 'HTTP 404');
});

test('the count is what separates a national base from one town', async () => {
  const hits = [HIT_NATIONAL, HIT_TOWN].map(normalizeSearchHit);
  const infer = async (url) => (url.includes('levallois')
    ? draft(19, { publisher: 'Ville de Levallois', licence: 'Licence Ouverte 1.0' })
    : draft(186118));
  const { ready } = await proveCandidates(hits, infer, { now: NOW });
  assert.equal(ready[0].facts[0], '186 118 objets');
  assert.equal(ready[1].facts[0], '19 objets');
  assert.equal(ready[1].facts[2], 'figé depuis 7 ans');
});

test('a manifest fault blocks a candidate as surely as a dead file', async () => {
  const hits = [HIT_NATIONAL].map(normalizeSearchHit);
  const infer = async () => draft(500, { faults: ['`geometry` : une source tabulaire doit dire comment une ligne devient un point'] });
  const { ready, blocked } = await proveCandidates(hits, infer, { now: NOW });
  assert.equal(ready.length, 0);
  assert.equal(blocked[0].reason, 'aucune colonne de position');
});

test("the platform's relevance order is kept — nothing is re-ranked by size", async () => {
  const hits = [HIT_TOWN, HIT_NATIONAL].map(normalizeSearchHit);
  const infer = async (url) => (url.includes('levallois') ? draft(19) : draft(186118));
  const { ready } = await proveCandidates(hits, infer, { now: NOW });
  assert.deepEqual(ready.map((entry) => entry.total), [19, 186118]);
});

// ── the whole shortlist ───────────────────────────────────────────────────

test('a subject becomes a shortlist a reader can choose from', async () => {
  const fetchImpl = async () => response({ total: 119, data: [HIT_NATIONAL, HIT_ZOMBIE] });
  const infer = async (url) => {
    if (url.includes('arbres')) throw new Error('HTTP 404');
    return draft(186118);
  };
  const shortlist = await shortlistDatasets('défibrillateurs', infer, { fetchImpl, relay: null, now: NOW });
  assert.equal(shortlist.query, 'défibrillateurs');
  assert.equal(shortlist.total, 119);
  assert.equal(shortlist.ready.length, 1);
  assert.equal(shortlist.blocked.length, 1);
  assert.equal(shortlist.ready[0].draft.manifest.attribution.publisher, 'Atlasanté');
});

test('a subject nobody publishes comes back empty and fast, not wrong', async () => {
  const fetchImpl = async () => response({ total: 0, data: [] });
  const shortlist = await shortlistDatasets('nids de frelons asiatiques', async () => draft(1), { fetchImpl, relay: null, now: NOW });
  assert.equal(shortlist.total, 0);
  assert.deepEqual(shortlist.ready, []);
  assert.deepEqual(shortlist.blocked, []);
});

test('the shortlist is capped, so the wait cannot grow with the catalogue', async () => {
  let asked = null;
  await searchDatasets('x', { fetchImpl: async (url) => { asked = url; return response({ data: [] }); }, relay: null, limit: 50 });
  assert.match(asked, /page_size=20/, 'twenty is the ceiling');
  assert.equal(SEARCH_SHORTLIST, 5);
});
