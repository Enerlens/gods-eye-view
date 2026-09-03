// What the DRAWN layer is allowed to claim, once the feed's fold and the
// mesh's thinning have already been proved.
//
// ONE property runs through the whole file, and it is the one the register
// makes easy to get wrong: **a mast that has never transmitted must never be
// presentable as a mast that transmits.** `Projet approuvé` is 8.05 % of the
// observatoire (66 508 of 826 418 rows, re-counted 2026-09-02) and 3 638
// supports carry nothing else. Each test below shuts one door an approved
// project could come through: the fill, the ring, the DETECT callout, the row
// label, the legend and the card.
//
// The second property is that the two channels never impersonate each other.
// Colour is the newest generation that RADIATES; size is how many operators
// are on the mast. Neither is ever a stand-in for the other, and neither is
// ever silently absent — a support with no readable height says so, a maillage
// dot that cannot draw the upgrade ring says so, and a Cartoradio card that
// has not arrived says so instead of leaving the address out.
//
// The third is that this layer's ids are SUP_ID-keyed. 952 of the 72 700
// supports share a five-decimal coordinate with another (measured on the real
// register), so a coordinate-keyed record map would drop them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';

import anfrFranceLayer, {
  ANFR_BAND_COLORS,
  ANFR_FR_LAYER_ID,
  ANFR_FR_OVERLAY_SOURCE_ID,
  ANFR_MAST_ENTER_SPAN_DEG,
  ANFR_MAST_EXIT_SPAN_DEG,
  ANFR_MAX_BOX_DEG,
  ANFR_SECTOR_RAY_M,
  anfrAzimuthLines,
  anfrBandColor,
  anfrMastHeightM,
  anfrMastLegend,
  anfrMastRegime,
  anfrSectorRays,
  anfrDetailLines,
  anfrEditionLabel,
  anfrFrenchDate,
  anfrHasPlannedUpgrade,
  anfrHasTechnicalGeneration,
  anfrLiveGenerationsLine,
  anfrMeshStyle,
  anfrMeshRecordId,
  anfrPlanLine,
  anfrPointSize,
  anfrSupportId,
  anfrSupportStyle,
  anfrViewSpanDeg,
  buildAnfrLoadingLabel,
  buildAnfrMeshLabel,
  buildAnfrSelectionLabel,
  cameraAnfrBox,
  cameraAnfrMeshBox,
  createAnfrSelectedOverlayEntry,
  pickAnfrSupportsAt,
  _anfrDetectablesForTest,
  _anfrMastTallyForTest,
  _anfrRecordForTest,
  _anfrRowControlsForTest,
  _anfrSelectedIdForTest,
  _anfrStatsForTest,
  _clearAnfrSelectionForTest,
  _loadAnfrViewportForTest,
  _selectAnfrForTest,
  _setAnfrStateForTest,
} from './anfrFrance.js';
import {
  ANFR_GENERATIONS,
  ANFR_HEIGHTLESS_NATURES,
  ANFR_HEIGHT_MISSING,
  ANFR_ID,
  ANFR_LAT,
  ANFR_LON,
  ANFR_NAT,
  ANFR_HAUT,
  ANFR_OPS,
  ANFR_PLAN,
  ANFR_SVC,
  ANFR_LIVE,
  ANFR_SYS,
  anfrCsvColumns,
  anfrDecodeMask,
  anfrDistanceM,
  parseAnfrNatureTable,
  projectAnfrSupports,
  projectCartoradioAntennas,
  projectCartoradioExposure,
  projectCartoradioSupport,
  readAnfrCsvRow,
} from './anfrFeed.js';
import { buildAnfrMesh, selectAnfrMesh } from './anfrMesh.js';

// Cesium reads the aliased line-width range off a live WebGL context, and
// there is none under `node --test`, so `ContextLimits._maximumAliasedLineWidth`
// sits at 0 and every `RenderState.fromCache` throws "renderState.lineWidth is
// out of range". This layer draws points rather than lines, but the primitive
// it seats them in shares the render-state cache, and priming the limit is a
// property of the harness rather than of the layer.
const { default: ContextLimits } = await import('@cesium/engine/Source/Renderer/ContextLimits.js');
ContextLimits._maximumAliasedLineWidth = 16;

// The shafts and the azimuth rays are polylines, and a polyline carries a
// `Material`. Cesium types a material uniform by testing it against the DOM
// image classes — `uniformValue instanceof HTMLCanvasElement` and friends,
// `Material.js:1262` — and under `node --test` those identifiers do not exist,
// so a bare `Material.fromType('Color', …)` throws a ReferenceError before it
// ever reaches a GPU. Declaring the four names is a property of the harness,
// exactly like the aliased line width above: nothing here is ever an instance
// of them, so the `instanceof` chain falls through to the object branch that
// the colour and dash uniforms actually belong in.
for (const name of ['HTMLCanvasElement', 'HTMLImageElement', 'ImageBitmap', 'OffscreenCanvas']) {
  if (!(name in globalThis)) globalThis[name] = class {};
}

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const norm = (value) => String(value).replace(/[\s ]+/g, ' ');

const OBSERVATOIRE = read('anfr-observatoire-sample.json');
const NATURE = read('anfr-nature-sample.json');
const CARTORADIO = read('anfr-cartoradio-sample.json');

const LINES = OBSERVATOIRE.csv.split('\n');
const COLUMNS = anfrCsvColumns(LINES[0]);
const ROWS = LINES.slice(1).filter(Boolean).map((line) => readAnfrCsvRow(line, COLUMNS));
const FOLD = projectAnfrSupports({
  rows: ROWS, natures: parseAnfrNatureTable(NATURE.text), edition: OBSERVATOIRE.edition,
});

/** Exactly what the `/supports` route serves: masks decoded to labels. */
const SUPPORTS = FOLD.supports.map((row) => ({
  id: row[ANFR_ID],
  lat: row[ANFR_LAT],
  lon: row[ANFR_LON],
  svc: row[ANFR_SVC],
  live: row[ANFR_LIVE],
  plan: row[ANFR_PLAN],
  operators: anfrDecodeMask(row[ANFR_OPS], FOLD.operators),
  systems: anfrDecodeMask(row[ANFR_SYS], FOLD.systems),
  nature: FOLD.natures[String(row[ANFR_NAT])] || null,
  heightM: row[ANFR_HAUT],
}));
const NATIONAL = {
  count: FOLD.count,
  live: FOLD.live,
  projectOnly: FOLD.projectOnly,
  plannedUpgrades: FOLD.plannedUpgrades,
  bands: FOLD.bands,
  generations: FOLD.generations,
};
const PACK = {
  supports: SUPPORTS,
  count: SUPPORTS.length,
  inBox: SUPPORTS.length,
  truncated: false,
  edition: OBSERVATOIRE.edition,
  source: FOLD.source,
  national: NATIONAL,
  fetchedAt: 1_767_000_000_000,
};
const MESH_TUPLES = buildAnfrMesh(FOLD.supports);
const MESH_PAYLOAD = {
  mesh: MESH_TUPLES,
  ...NATIONAL,
  edition: OBSERVATOIRE.edition,
  source: FOLD.source,
  fetchedAt: 1_767_000_000_000,
};
const ANTENNAS = projectCartoradioAntennas(CARTORADIO.antennes.body);
const DETAIL = {
  supId: CARTORADIO.supId,
  site: projectCartoradioSupport(CARTORADIO.site.body),
  antennas: ANTENNAS,
  exposure: projectCartoradioExposure({
    mesures: CARTORADIO.mesures.body,
    report: CARTORADIO.mesure.body,
    lat: 48.85528,
    lon: 2.33167,
    newestService: ANTENNAS.newestService,
  }),
};

const support = (id) => SUPPORTS.find((row) => row.id === id);
const makeHost = () => {
  const host = {
    entries: null,
    visible: new Map(),
    setEntries(sourceId, entries) { host.entries = entries; },
    setVisible(sourceId, value) { host.visible.set(sourceId, value); },
    clearSource() { host.entries = null; },
  };
  return host;
};
const fakeViewer = (west, south, east, north) => ({
  camera: { computeViewRectangle: () => Cesium.Rectangle.fromDegrees(west, south, east, north) },
  scene: { requestRender() {} },
});

test('the layer object satisfies the manager contract it is registered under', () => {
  assert.equal(anfrFranceLayer.id, ANFR_FR_LAYER_ID);
  assert.equal(ANFR_FR_LAYER_ID, 'anfr-fr');
  assert.match(anfrFranceLayer.id, /^[a-z0-9-]+$/);
  assert.equal(anfrFranceLayer.name, 'Antennes mobiles (ANFR)');
  // NOT the ≋ of the RÉSEAUX & CAPTEURS shelf, and not anything the `radio`
  // row (internet audio streams) could be mistaken for.
  assert.equal(anfrFranceLayer.icon, '📡');
  assert.equal(typeof anfrFranceLayer.source, 'string');
  for (const method of ['init', 'enable', 'disable', 'update', 'getStats', 'getRowControls', 'getDetectableObjects', 'destroy']) {
    assert.equal(typeof anfrFranceLayer[method], 'function', method);
  }
  // The register is rebuilt weekly; the poll must not pretend otherwise.
  assert.ok(anfrFranceLayer.updateInterval >= 60 * 60_000);
});

test('the fill is the newest generation that RADIATES, and a project has none', () => {
  // 278838: eight rows, every one "Projet approuvé", across 2G/3G/4G.
  const planned = anfrSupportStyle(support(278838));
  assert.equal(planned.band, 'projet');
  assert.equal(planned.hollow, true);
  assert.equal(planned.ringed, true);
  assert.ok(planned.alpha < 0.2, 'a project is drawn hollow, not filled');
  assert.equal(planned.color, ANFR_BAND_COLORS.projet);

  // 449714: 5G technically operational over 2G/3G/4G in service.
  const live = anfrSupportStyle(support(449714));
  assert.equal(live.band, '5g');
  assert.equal(live.hollow, false);
  assert.equal(live.alpha, 1);
  assert.equal(live.color, ANFR_BAND_COLORS['5g']);

  // 325857: 3G and 4G, nothing newer.
  assert.equal(anfrSupportStyle(support(325857)).band, '4g');
  // Whatever the plan mask holds, it never reaches the fill.
  for (const row of SUPPORTS) {
    const withoutPlan = anfrSupportStyle({ ...row, plan: 0 });
    assert.equal(anfrSupportStyle(row).band, withoutPlan.band, `support ${row.id}`);
  }
});

test('the pale ring means one thing: an approved project is on file here', () => {
  // 506104 radiates 2G/3G/4G and has 5G approved — the ring is on a filled dot.
  const upgrade = anfrSupportStyle(support(506104));
  assert.equal(upgrade.ringed, true);
  assert.equal(upgrade.hollow, false);
  assert.equal(anfrHasPlannedUpgrade(support(506104)), true);

  // 449714 has a project filed on 5G, which it ALREADY radiates. That is
  // paperwork, not an upgrade, and it earns no ring — 11 830 of the 15 606
  // live supports with a project on file are exactly this case.
  assert.notEqual(support(449714).plan, 0);
  assert.equal(anfrHasPlannedUpgrade(support(449714)), false);
  assert.equal(anfrSupportStyle(support(449714)).ringed, false);

  // 22132 has no project at all.
  assert.equal(support(22132).plan, 0);
  assert.equal(anfrSupportStyle(support(22132)).ringed, false);
  assert.equal(anfrHasPlannedUpgrade({}), false);
});

test('the size is the operator count, capped at the one five-operator mast', () => {
  assert.equal(anfrPointSize(0), anfrPointSize(1));
  assert.ok(anfrPointSize(2) > anfrPointSize(1));
  assert.ok(anfrPointSize(4) > anfrPointSize(3));
  assert.equal(anfrPointSize(5), anfrPointSize(9), 'five is the measured maximum');
  assert.equal(anfrPointSize(null), anfrPointSize(1));
  // The channel is read off the resolved operator list, so the card and the
  // dot cannot disagree.
  assert.equal(anfrSupportStyle(support(506104)).operators, 5);
  assert.equal(anfrSupportStyle(support(506104)).sizePx, anfrPointSize(5));
  assert.equal(anfrSupportStyle(support(325857)).operators, 1);
});

test('the maillage draws the hollow ring and says which ring it cannot draw', () => {
  const byPosition = new Map(MESH_TUPLES.map((t) => [`${t[0]},${t[1]}`, t]));
  const plannedTuple = byPosition.get(`${support(278838).lat},${support(278838).lon}`);
  const style = anfrMeshStyle(plannedTuple);
  assert.equal(style.band, 'projet');
  assert.equal(style.hollow, true);
  assert.equal(style.ringed, true);

  // 506104's upgrade ring CANNOT be drawn from a tuple — there is no plan mask
  // in it — so the maillage draws it as an ordinary 4G dot and the row label
  // is what tells the reader the rings are missing at this zoom.
  const upgradeTuple = byPosition.get(`${support(506104).lat},${support(506104).lon}`);
  assert.equal(anfrMeshStyle(upgradeTuple).ringed, false);
  const label = buildAnfrLoadingLabel({
    regime: 'maillage',
    status: 'ready',
    loading: false,
    count: 6,
    inView: 15,
    national: NATIONAL,
    pick: { thinned: true },
  });
  assert.match(norm(label), /6 points pour 15 supports dans la vue/);
  assert.match(norm(label), /15 en France/);
  assert.match(norm(label), /projets d’extension visibles seulement en zoom/);
});

test('records are keyed by SUP_ID, so two masts on one lattice point both survive', () => {
  const host = makeHost();
  const coSited = [
    { ...support(449714), id: 900001 },
    { ...support(449714), id: 900002 },
  ];
  _setAnfrStateForTest({
    viewer: fakeViewer(2.3, 48.8, 2.4, 48.9),
    overlayHost: host,
    pack: { ...PACK, supports: coSited, count: 2, inBox: 2 },
  });
  assert.equal(_anfrStatsForTest().count, 2);
  assert.ok(_anfrRecordForTest(anfrSupportId(900001)));
  assert.ok(_anfrRecordForTest(anfrSupportId(900002)));
  assert.equal(anfrSupportId(900001), 'anfr-fr:900001');
  // A mesh id is namespaced apart, because it is a position and not an identity.
  assert.equal(anfrMeshRecordId([48.85528, 2.33167, 4, 4]), 'anfr-fr:mesh:48.85528,2.33167');
  // pickAnfrSupportsAt returns BOTH, ordered, so the card can name the co-siting.
  const here = pickAnfrSupportsAt(coSited, 48.85528, 2.33167);
  assert.equal(here.length, 2);
  assert.deepEqual(here.map((row) => row.id), [900001, 900002]);
  assert.deepEqual(pickAnfrSupportsAt(coSited, 0, 0), []);
  assert.deepEqual(pickAnfrSupportsAt(null, 0, 0), []);
  _clearAnfrSelectionForTest();
});

test('the card splits the generations by the status the register published', () => {
  // Measured over the whole file: every technically-operational row is 5G and
  // no 5G row is ever "En service". The card reports that per support instead
  // of asserting the rule.
  assert.equal(
    anfrLiveGenerationsLine(support(449714)),
    '5G techniquement opérationnelle — 4G · 3G · 2G en service',
  );
  assert.equal(anfrLiveGenerationsLine(support(2883667)), '5G techniquement opérationnelle');
  assert.equal(anfrLiveGenerationsLine(support(325857)), '4G · 3G en service');
  assert.equal(anfrLiveGenerationsLine(support(278838)), null);

  // The flag that puts ANFR's own gloss on the card fires on the 5G supports
  // and on nothing else — which is the whole point of quoting it rather than
  // asserting a per-mast maturity.
  assert.equal(anfrHasTechnicalGeneration(support(449714)), true);
  assert.equal(anfrHasTechnicalGeneration(support(2883667)), true);
  assert.equal(anfrHasTechnicalGeneration(support(325857)), false);
  assert.equal(anfrHasTechnicalGeneration(support(278838)), false);
  assert.equal(anfrHasTechnicalGeneration({}), false);
  for (const row of SUPPORTS) {
    const fiveG = Boolean(row.live & (1 << ANFR_GENERATIONS.indexOf('5G')));
    assert.equal(anfrHasTechnicalGeneration(row), fiveG, `support ${row.id}`);
  }
  // And it puts the register's own sentence on the card, verbatim.
  const copy = norm(buildAnfrSelectionLabel({ support: support(449714) }, PACK));
  assert.match(copy, /Techniquement opérationnel — allumé, pas déclaré en service/);
  assert.doesNotMatch(
    norm(buildAnfrSelectionLabel({ support: support(325857) }, PACK)),
    /Techniquement opérationnel/,
  );
});

test('the plan line distinguishes an upgrade from a re-filing', () => {
  assert.match(anfrPlanLine(support(506104)), /^Projet approuvé : 5G — autorisé, pas encore émis/);
  assert.match(anfrPlanLine(support(278838)), /rien n’émet à cette position$/);
  assert.match(anfrPlanLine(support(449714)), /bande déjà à l’antenne, dossier rouvert$/);
  assert.equal(anfrPlanLine(support(22132)), null);
  assert.equal(anfrPlanLine({}), null);
});

test('the selection card is every published value and every stated absence', () => {
  const copy = norm(buildAnfrSelectionLabel({ support: support(449714), detail: DETAIL }, PACK));
  assert.match(copy, /^Support 449714 · Immeuble/);
  assert.match(copy, /4 opérateurs : BOUYGUES TELECOM, FREE MOBILE, ORANGE, SFR/);
  assert.match(copy, /Support de 65 m/);
  assert.match(copy, /Observatoire ANFR du 27 août 2026 · Licence Ouverte 2\.0/);
  // The systems line summarises rather than truncating silently.
  assert.match(copy, /\+6 systèmes/);

  // 325857 publishes a height of 0, which is not a height.
  const zeroHeight = norm(buildAnfrSelectionLabel({ support: support(325857) }, PACK));
  assert.match(zeroHeight, /Hauteur du support non publiée/);
  assert.doesNotMatch(zeroHeight, /0 m/);

  // A support that radiates nothing says so in the first line of its card.
  const planned = norm(buildAnfrSelectionLabel({ support: support(278838) }, PACK));
  assert.match(planned, /Aucune génération n’émet à cette position/);
  assert.doesNotMatch(planned, /en service/);
});

test('the Cartoradio half is labelled while it is missing, not silently omitted', () => {
  const pending = buildAnfrSelectionLabel({ support: support(449714), detailPending: true }, PACK);
  assert.match(norm(pending), /Cartoradio : lecture de la fiche du support…/);
  const failed = buildAnfrSelectionLabel(
    { support: support(449714), detailError: 'HTTP 503' }, PACK,
  );
  assert.match(norm(failed), /⚠ Fiche Cartoradio indisponible — HTTP 503/);
  // A card with neither says nothing about an address it does not have.
  const bare = norm(buildAnfrSelectionLabel({ support: support(449714) }, PACK));
  assert.doesNotMatch(bare, /Propriétaire/);
  assert.doesNotMatch(bare, /Exposition/);
});

test('the exposure line carries its date and refuses to imply it measured this mast', () => {
  const lines = anfrDetailLines(DETAIL).map(norm);
  const joined = lines.join('\n');
  assert.match(joined, /43-45 R DES STS PÈRES.*75006, PARIS 6E ARRONDISSEMENT/);
  assert.match(joined, /Propriétaire : Ets public/);
  // The observatoire is public mobile only; the mast also carries a microwave
  // link, and the card says the layer does not draw it.
  assert.match(joined, /Porte aussi FH — non tracé par cette couche/);
  assert.match(joined, /33 antennes sur 5 stations/);
  assert.match(joined, /dernier équipement en service le 18\/07\/2025/);
  // 0,0 V/m measured in 2009, forty metres away, beside equipment from 2025.
  assert.match(joined, /Exposition mesurée 0,00 V\/m à 40 m — 04\/02\/2009/);
  assert.match(joined, /AEXPERTISE · ANFR\/DR 15-2\.1 · interieur/);
  assert.match(joined, /⚠ Mesure antérieure au dernier équipement installé \(18\/07\/2025\)/);
  assert.match(joined, /mesures publiées dans 300 m — celle-ci est la plus proche/);
  assert.match(joined, /Mesure d’un LIEU, pas de ce mât/);

  // No measurement in the radius is stated, not left blank.
  const empty = anfrDetailLines({ ...DETAIL, exposure: { within: 0, radiusM: 300, nearest: null, report: null } });
  assert.match(norm(empty.join('\n')), /Aucune mesure d’exposition publiée dans 300 m/);
  assert.deepEqual(anfrDetailLines(null), []);

  // A SUP_ID Cartoradio does not hold answers HTTP 200 with a ZERO-byte body
  // (measured against /sites/999999999), so the proxy hands back a card with
  // nothing in it. That is named rather than left as an empty half.
  const mute = anfrDetailLines({
    supId: 999999999, site: null, antennas: null, exposure: null,
    degraded: ['fiche support (empty upstream body)'],
  });
  assert.deepEqual(mute.map(norm), ['⚠ Cartoradio muet sur : fiche support (empty upstream body)']);
  assert.equal(anfrFrenchDate('2025-07-18'), '18/07/2025');
  assert.equal(anfrFrenchDate('18/07/2025'), null);
  assert.equal(anfrEditionLabel('2026-08-27'), '27 août 2026');
  assert.equal(anfrEditionLabel('nope'), null);
});

test('the maillage card is never a placeholder, and names which half it is showing', () => {
  const tuple = MESH_TUPLES.find((t) => t[3] === 4);
  const first = norm(buildAnfrMeshLabel({ tuple }, { edition: '2026-08-27' }));
  assert.match(first, /^Support ANFR \(maillage\)/);
  assert.match(first, /5G en service/);
  assert.match(first, /opérateurs? déclarés?/);
  assert.match(first, /Maillage — un point par cellule · observatoire du 27 août 2026/);

  assert.match(norm(buildAnfrMeshLabel({ tuple, lookupPending: true })), /Lecture du support dans le registre…/);
  assert.match(norm(buildAnfrMeshLabel({ tuple, lookupError: 'HTTP 500' })), /⚠ Registre injoignable pour ce point — HTTP 500/);
  assert.match(norm(buildAnfrMeshLabel({ tuple, lookupEmpty: true })), /⚠ Aucun support du registre à cette position exacte/);
});

test('selecting a support runs the production path and publishes one protected card', async () => {
  const host = makeHost();
  const calls = [];
  const http = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => DETAIL };
  };
  _setAnfrStateForTest({
    viewer: fakeViewer(2.3, 48.8, 2.4, 48.9), overlayHost: host, pack: PACK, http,
  });
  const id = anfrSupportId(449714);
  _selectAnfrForTest(id);
  assert.equal(_anfrSelectedIdForTest(), id);
  assert.equal(host.entries.length, 1);
  const entry = host.entries[0];
  assert.equal(entry.id, id);
  assert.equal(entry.protected, true);
  assert.equal(entry.selected, true);
  assert.equal(entry.priority, Number.MAX_SAFE_INTEGER);
  assert.match(norm(entry.title), /^Support 449714 · Immeuble$/);

  // The Cartoradio fetch is one call for the clicked mast, and the card is
  // repainted with it when it lands.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['/api/anfr-fr/support/449714']);
  assert.match(norm(host.entries[0].details.join('\n')), /Propriétaire : Ets public/);

  // Selecting the same mast again does not re-ask.
  _selectAnfrForTest(id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);

  _clearAnfrSelectionForTest();
  assert.equal(_anfrSelectedIdForTest(), null);
  assert.equal(host.entries, null);
});

test('a maillage click asks the register for the identity, once, and caches a miss', async () => {
  const host = makeHost();
  const calls = [];
  const http = async (url) => {
    calls.push(url);
    if (url.startsWith('/api/anfr-fr/supports')) {
      return { ok: true, json: async () => ({ supports: [support(449714)] }) };
    }
    return { ok: true, json: async () => DETAIL };
  };
  const pick = selectAnfrMesh(MESH_TUPLES, { box: { south: 48.8, west: 2.3, north: 48.9, east: 2.4 } });
  _setAnfrStateForTest({
    viewer: fakeViewer(2.3, 48.8, 2.4, 48.9),
    overlayHost: host,
    mesh: MESH_PAYLOAD,
    meshPick: pick,
    regime: 'maillage',
    http,
  });
  const id = anfrMeshRecordId([48.85528, 2.33167, 4, 4]);
  assert.ok(_anfrRecordForTest(id), 'the Paris dot is in the pick');
  _selectAnfrForTest(id);
  // First paint: the band and the operator count, truthfully, with no identity.
  assert.match(norm(host.entries[0].title), /Support ANFR \(maillage\)/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls[0].startsWith('/api/anfr-fr/supports?'), true);
  // The lookup box is ~110 m wide, because ANFR positions sit on a ~31 m
  // arc-second lattice and a wider box would sweep in the neighbour.
  const params = new URLSearchParams(calls[0].split('?')[1]);
  assert.ok(Number(params.get('north')) - Number(params.get('south')) < 0.002);
  assert.match(norm(host.entries[0].title), /^Support 449714/);

  // A dot the register cannot name is cached as unnameable, not re-asked.
  const missHost = makeHost();
  const missCalls = [];
  const missHttp = async (url) => {
    missCalls.push(url);
    return { ok: true, json: async () => ({ supports: [] }) };
  };
  _setAnfrStateForTest({
    viewer: fakeViewer(2.3, 48.8, 2.4, 48.9),
    overlayHost: missHost,
    mesh: MESH_PAYLOAD,
    meshPick: pick,
    regime: 'maillage',
    http: missHttp,
  });
  _selectAnfrForTest(id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(norm(missHost.entries[0].details.join('\n')), /Aucun support du registre à cette position exacte/);
  _selectAnfrForTest(id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(missCalls.length, 1);
  _clearAnfrSelectionForTest();
});

test('DETECT is never offered a mast that has never transmitted', () => {
  const host = makeHost();
  _setAnfrStateForTest({ viewer: fakeViewer(2.3, 48.8, 2.4, 48.9), overlayHost: host, pack: PACK });
  const candidates = _anfrDetectablesForTest();
  assert.equal(candidates.length, SUPPORTS.length - FOLD.projectOnly);
  assert.equal(candidates.some((c) => c.sourceId === anfrSupportId(278838)), false);
  for (const candidate of candidates) {
    assert.equal(candidate.type, 'Antenna mast');
    assert.doesNotMatch(candidate.id, /PROJET/);
    assert.ok(candidate.position instanceof Cesium.Cartesian3);
    assert.match(candidate.id, /^(2G|3G|4G|5G)/);
  }
  // The cap and the stride are honoured, so the detector never gets more than
  // it asked for.
  assert.equal(_anfrDetectablesForTest({ maxCount: 3 }).length, 3);
  assert.equal(_anfrDetectablesForTest({ maxCount: 1, seed: 7 }).length, 1);
  _clearAnfrSelectionForTest();
  assert.deepEqual(_anfrDetectablesForTest(), [], 'a disabled layer offers nothing');
});

test('the legend keeps the project row at zero, because the ring has to be explained', () => {
  const host = makeHost();
  _setAnfrStateForTest({ viewer: fakeViewer(2.3, 48.8, 2.4, 48.9), overlayHost: host, pack: PACK });
  const { legend, chips } = _anfrRowControlsForTest();
  // No chips: the manager renders a chip as a clickable button that dispatches
  // `chip.params`, so an informational one would be a control that does
  // nothing. `anfr-fr` is `enabled-only` and owns no option group.
  assert.deepEqual(chips, []);
  // Newest generation first, which is the order the map is read in.
  assert.deepEqual(legend.map((row) => row.color).slice(0, 2), [
    ANFR_BAND_COLORS['5g'], ANFR_BAND_COLORS['4g'],
  ]);
  assert.equal(legend[legend.length - 1].color, ANFR_BAND_COLORS.projet);
  assert.equal(legend.find((row) => row.color === ANFR_BAND_COLORS['5g']).count, FOLD.bands['5g']);
  for (const row of legend) assert.ok(row.blurb && row.blurb.length > 20, row.label);

  // The one national fact a reader cannot get from the map itself rides on the
  // 5G swatch's tooltip, where the ramp is actually read.
  const fiveG = legend.find((row) => row.color === ANFR_BAND_COLORS['5g']);
  assert.match(norm(fiveG.blurb), /AUCUN émetteur 5G « en service »/);
  assert.match(norm(fiveG.blurb), /120 891 lignes 5G/);

  // With nothing drawn there is no legend to draw either.
  _clearAnfrSelectionForTest();
  assert.deepEqual(_anfrRowControlsForTest(), { chips: [], legend: [] });
});

test('the row label counts the rings it is drawing, in the singular when there is one', () => {
  const host = makeHost();
  _setAnfrStateForTest({ viewer: fakeViewer(2.3, 48.8, 2.4, 48.9), overlayHost: host, pack: PACK });
  const label = norm(buildAnfrLoadingLabel());
  assert.match(label, /^15 supports/);
  assert.match(label, /1 projet approuvé, rien n’émet/);
  assert.match(label, /4 extensions autorisées/);
  assert.equal(norm(buildAnfrLoadingLabel({ loading: true })), 'lecture du registre ANFR...');
  assert.equal(buildAnfrLoadingLabel({ status: 'error' }), '');
  assert.equal(
    buildAnfrLoadingLabel({ regime: 'supports', count: 0, records: new Map() }),
    'aucun support ANFR dans cette vue',
  );
  _clearAnfrSelectionForTest();
});

test('getStats surfaces the honesty numbers and the guidance, never a fake zero', () => {
  const host = makeHost();
  _setAnfrStateForTest({ viewer: fakeViewer(2.3, 48.8, 2.4, 48.9), overlayHost: host, pack: PACK });
  const stats = _anfrStatsForTest();
  assert.equal(stats.status, 'ok');
  assert.equal(stats.count, 15);
  assert.equal(stats.regime, 'supports');
  assert.equal(stats.supportsNational, FOLD.count);
  assert.equal(stats.projectOnly, FOLD.projectOnly);
  assert.equal(stats.plannedUpgrades, FOLD.plannedUpgrades);
  assert.equal(stats.edition, '2026-08-27');
  assert.equal('error' in stats, false);
  assert.ok(stats.loadingLabel);
  const summary = anfrFranceLayer.getViewportSummary();
  assert.equal(summary.regime, 'supports');
  assert.equal(summary.drawn, 15);
  assert.equal('supports' in summary, false, 'the rows are not repeated into the summary');
  _clearAnfrSelectionForTest();
});

test('the camera decides the regime, and never asks for a box the proxy refuses', async () => {
  assert.equal(ANFR_MAX_BOX_DEG, 0.35);
  const wide = fakeViewer(-5, 41, 10, 51.5);
  assert.equal(cameraAnfrBox(wide), null, 'a national view is above the ceiling');
  assert.ok(cameraAnfrMeshBox(wide), 'the maillage has no ceiling');
  assert.ok(anfrViewSpanDeg(wide).lat > 10);
  const tight = fakeViewer(2.30, 48.84, 2.36, 48.88);
  const box = cameraAnfrBox(tight);
  assert.ok(box.north - box.south <= ANFR_MAX_BOX_DEG);
  assert.ok(box.east - box.west <= ANFR_MAX_BOX_DEG);
  // The padded maillage box is wider than the view, so a dot does not pop in
  // at the screen edge.
  const padded = cameraAnfrMeshBox(tight);
  assert.ok(padded.north > box.north && padded.south < box.south);
  assert.equal(anfrViewSpanDeg({}).lat, Infinity);
  assert.equal(cameraAnfrBox({}), null);
  assert.equal(cameraAnfrMeshBox({}), null);
});

test('a wide view loads the maillage and a tight one loads the supports', async () => {
  const host = makeHost();
  const asked = [];
  const http = async (url) => {
    asked.push(url.split('?')[0]);
    if (url.startsWith('/api/anfr-fr/mesh')) return { ok: true, json: async () => MESH_PAYLOAD };
    if (url.startsWith('/api/anfr-fr/supports')) return { ok: true, json: async () => PACK };
    return { ok: true, json: async () => DETAIL };
  };
  _setAnfrStateForTest({ overlayHost: host, http, regime: 'maillage' });
  const national = await _loadAnfrViewportForTest(fakeViewer(-5, 41, 10, 51.5));
  assert.equal(national.regime, 'maillage');
  assert.equal(asked[0], '/api/anfr-fr/mesh');
  assert.ok(national.count > 0);
  assert.equal(national.status, 'ready');

  const street = await _loadAnfrViewportForTest(fakeViewer(2.30, 48.84, 2.36, 48.88));
  assert.equal(street.regime, 'supports');
  assert.equal(asked[asked.length - 1], '/api/anfr-fr/supports');
  assert.equal(street.count, 15);
  _clearAnfrSelectionForTest();
});

test('a failed refresh keeps the map it has and says the refresh failed', async () => {
  const host = makeHost();
  let fail = false;
  const http = async (url) => {
    if (fail) throw new Error('ECONNREFUSED');
    if (url.startsWith('/api/anfr-fr/supports')) return { ok: true, json: async () => PACK };
    return { ok: true, json: async () => MESH_PAYLOAD };
  };
  _setAnfrStateForTest({ overlayHost: host, http, regime: 'maillage' });
  const first = await _loadAnfrViewportForTest(fakeViewer(2.30, 48.84, 2.36, 48.88));
  assert.equal(first.count, 15);
  fail = true;
  const second = await _loadAnfrViewportForTest(fakeViewer(2.30, 48.84, 2.36, 48.88), { force: true });
  // Fifteen real masts are still fifteen real masts. Blanking the screen would
  // say France has no antennas.
  assert.equal(second.count, 15);
  assert.equal(second.status, 'ready');
  assert.match(second.error, /rafraîchissement du registre ANFR indisponible/);

  // With nothing drawn at all, the failure is an error state and not an empty
  // country.
  _setAnfrStateForTest({ overlayHost: host, http, regime: 'maillage' });
  const cold = await _loadAnfrViewportForTest(fakeViewer(2.30, 48.84, 2.36, 48.88), { force: true });
  assert.equal(cold.count, 0);
  assert.equal(cold.status, 'error');
  assert.match(cold.error, /registre ANFR indisponible/);
  assert.equal(_anfrStatsForTest().status, 'error');
  _clearAnfrSelectionForTest();
});

test('a malformed payload is refused rather than drawn as an empty France', async () => {
  const host = makeHost();
  const http = async () => ({ ok: true, json: async () => ({ nope: true }) });
  _setAnfrStateForTest({ overlayHost: host, http, regime: 'maillage' });
  const result = await _loadAnfrViewportForTest(fakeViewer(-5, 41, 10, 51.5));
  assert.equal(result.count, 0);
  assert.equal(result.status, 'error');
  // The reader gets a French sentence; `malformed payload` stays in the console.
  assert.equal(result.error, 'maillage national ANFR indisponible');
  _clearAnfrSelectionForTest();
});

test('the maillage says when the camera is simply not over France', () => {
  // `layerFeedState()` renders `empty` as a green ON chip, so a blank row and a
  // broken row look identical. The sentence is what tells them apart.
  assert.equal(
    buildAnfrLoadingLabel({
      regime: 'maillage', status: 'ready', loading: false, count: 0, inView: 0, national: NATIONAL,
    }),
    'aucun support ANFR dans cette vue',
  );
  // Before anything at all has loaded there is nothing honest to say.
  assert.equal(
    buildAnfrLoadingLabel({
      regime: 'maillage', status: 'ready', loading: false, count: 0, inView: 0, national: null,
    }),
    '',
  );
});

test('init builds the three real collections, and the draw path fills them', async () => {
  // The seams above run the card and legend paths with `point: null`. This one
  // runs the production `reconcileSupports` against a real
  // PointPrimitiveCollection, so the style a test asserts on is the style a
  // primitive actually receives. The two polyline collections beside it are
  // the world-space channel: shafts, and the selected mast's azimuth rays.
  const added = [];
  const viewer = {
    ...fakeViewer(2.30, 48.84, 2.36, 48.88),
    scene: {
      requestRender() {},
      primitives: {
        add(primitive) { added.push(primitive); return primitive; },
        remove(primitive) { return added.splice(added.indexOf(primitive), 1).length > 0; },
        contains() { return true; },
        raiseToTop() {},
      },
    },
  };
  anfrFranceLayer.init(viewer);
  assert.equal(added.length, 3);
  assert.equal(added[0].constructor, Cesium.PointPrimitiveCollection);
  assert.equal(added[1].constructor, Cesium.PolylineCollection, 'the shafts');
  assert.equal(added[2].constructor, Cesium.PolylineCollection, 'the azimuth rays');

  const http = async (url) => ({
    ok: true,
    json: async () => (url.startsWith('/api/anfr-fr/supports') ? PACK : MESH_PAYLOAD),
  });
  _setAnfrStateForTest({ viewer, overlayHost: makeHost(), http, regime: 'maillage' });
  // `_setAnfrStateForTest` does not touch the collection init() made, so the
  // real load path below is what puts primitives in it.
  const result = await _loadAnfrViewportForTest(viewer);
  assert.equal(result.regime, 'supports');
  assert.equal(added[0].length, 15, 'one primitive per support in the box');

  const record = _anfrRecordForTest(anfrSupportId(449714));
  assert.ok(record.point, 'the record holds its primitive');
  assert.equal(record.point.pixelSize, record.style.sizePx);
  const before = record.point.pixelSize;
  _selectAnfrForTest(record.id);
  assert.ok(record.point.pixelSize > before, 'selection grows the real primitive');
  _clearAnfrSelectionForTest();
  assert.equal(record.point.pixelSize, before, 'and clearing restores it');

  anfrFranceLayer.destroy(viewer);
  assert.equal(added.length, 0, 'destroy removes every collection it added');
});

test('the overlay entry is anchored, protected and single', () => {
  const record = {
    id: anfrSupportId(449714),
    support: support(449714),
    position: Cesium.Cartesian3.fromDegrees(2.33167, 48.85528, 2.5),
  };
  const entry = createAnfrSelectedOverlayEntry(record, PACK);
  assert.equal(entry.collisionGroup, 'ambient-card');
  assert.equal(entry.paintLane, 'selected');
  assert.equal(entry.interactive, false);
  assert.equal(entry.horizonCull, true);
  assert.ok(entry.details.length > 3);
  assert.equal(createAnfrSelectedOverlayEntry({ id: 'x' }), null);
  assert.equal(createAnfrSelectedOverlayEntry(null), null);
  assert.equal(ANFR_FR_OVERLAY_SOURCE_ID, 'anfr-fr-selected');
  assert.equal(anfrBandColor('nope'), ANFR_BAND_COLORS.projet);
});

// ── The world-space channel: the support drawn at its real height ───────────
// One property holds through the six tests below, and it is B2's: the QUANTITY
// is a length in metres of the world, and no screen-space channel is composed
// with it. The dot's pixel size is still the operator count and is multiplied
// by nothing; the shaft's pixel width is a constant that carries nothing. The
// second property is A1's: 551 supports of the register publish no height, and
// none of them gets a default one — they get no shaft at all, and the count
// travels with the row label, the legend and the card.

const heightlessId = anfrSupportId(325857);

test('the shaft is the published height, and there is none where there is none', () => {
  // 325857 is the fixture's underground support: the register leaves its
  // height blank because there is no mast to measure. It is one of the three
  // natures that hold all 551 blanks nationally.
  const blank = support(325857);
  assert.equal(blank.heightM, null);
  assert.ok(ANFR_HEIGHTLESS_NATURES.includes(blank.nature));
  assert.equal(anfrMastHeightM(blank), null);
  // A zero and a negative are the same refusal, for the same reason: the
  // register writes 0 where nobody filled the field in.
  assert.equal(anfrMastHeightM({ heightM: 0 }), null);
  assert.equal(anfrMastHeightM({ heightM: -12 }), null);
  assert.equal(anfrMastHeightM({}), null);
  assert.equal(anfrMastHeightM(null), null);
  // And a published one is passed through in metres, unscaled and unclassed —
  // there is no thematic mapping to invert here.
  assert.equal(anfrMastHeightM(support(437710)), 308);
  assert.equal(anfrMastHeightM(support(449714)), 65);

  _setAnfrStateForTest({ overlayHost: makeHost(), pack: PACK, regime: 'supports', mastRegime: true });
  const tally = _anfrMastTallyForTest();
  assert.equal(tally.masts + tally.unpublished, SUPPORTS.length);
  assert.equal(tally.unpublished, 1, 'the one blank in the fixture, counted');
  assert.equal(tally.clipped, 0);
  _clearAnfrSelectionForTest();
});

test('the dot rides the top of its shaft, and stays on the ground without one', () => {
  _setAnfrStateForTest({ overlayHost: makeHost(), pack: PACK, regime: 'supports', mastRegime: true });
  const tall = _anfrRecordForTest(anfrSupportId(437710));
  const flat = _anfrRecordForTest(heightlessId);
  const lift = (record) => Cesium.Cartographic.fromCartesian(record.position).height
    - Cesium.Cartographic.fromCartesian(record.groundPosition).height;
  // 308 m of support is 308 m of lift, to within the ellipsoid round trip.
  assert.ok(Math.abs(lift(tall) - 308) < 0.5);
  // No height, no lift: the dot and the foot of the missing shaft are the same
  // point, which is exactly what "no measurement" should look like.
  assert.ok(Math.abs(lift(flat)) < 1e-6);
  // The pixel channel is untouched by any of it — the dot is still sized by
  // the operator count, and nothing multiplies it (B2).
  assert.equal(tall.style.sizePx, anfrPointSize(tall.support.operators.length));
  assert.equal(flat.style.sizePx, anfrPointSize(flat.support.operators.length));
  _clearAnfrSelectionForTest();
});

test('the shaft sub-regime has hysteresis and is nested inside the exact one', () => {
  // Entering is stricter than leaving, so a camera resting on the boundary
  // cannot flicker the whole shaft field on and off.
  assert.ok(ANFR_MAST_ENTER_SPAN_DEG < ANFR_MAST_EXIT_SPAN_DEG);
  assert.ok(ANFR_MAST_EXIT_SPAN_DEG < ANFR_MAX_BOX_DEG, 'and both sit inside the exact regime');
  assert.equal(anfrMastRegime(0.05, false), true);
  assert.equal(anfrMastRegime(0.07, false), false, 'above the entry, not entered');
  assert.equal(anfrMastRegime(0.07, true), true, 'above the entry, not yet left');
  assert.equal(anfrMastRegime(0.1, true), false);
  assert.equal(anfrMastRegime(Infinity, true), false);
  assert.equal(anfrMastRegime(NaN, true), false);

  // The maillage tuple has no height in it, so the shafts cannot follow the
  // camera down there even if the span would allow it.
  _setAnfrStateForTest({
    overlayHost: makeHost(), mesh: MESH_PAYLOAD, regime: 'maillage', mastRegime: true,
  });
  assert.equal(_anfrMastTallyForTest().mastRegime, false);
  assert.equal(_anfrMastTallyForTest().masts, 0);
  assert.deepEqual(anfrMastLegend({ regime: 'maillage', mastRegime: true }), [],
    'and no height key is published beside a map that draws no shafts');
  _clearAnfrSelectionForTest();
});

test('the height legend publishes numbered marks and names the shape of a blank', () => {
  // D1 — a size channel with no numbered mark says only "taller than that
  // one". Three marks, frozen, from the national distribution (C1).
  _setAnfrStateForTest({ overlayHost: makeHost(), pack: PACK, regime: 'supports', mastRegime: true });
  const { legend } = _anfrRowControlsForTest();
  const labels = legend.map((row) => row.label);
  assert.ok(labels.includes('12 m') && labels.includes('30 m') && labels.includes('48 m'));
  const ticks = legend.filter((row) => /^\d+ m$/.test(row.label));
  assert.equal(ticks.length, 3);
  for (const tick of ticks) assert.ok(tick.glyph?.startsWith('data:image/svg+xml'));
  // The scale is 1:1 and the legend says so, because that is the whole reason
  // the length is legitimate on a globe.
  const header = legend.find((row) => row.label.startsWith('Fût'));
  assert.ok(header.blurb.includes('un mètre dessiné vaut un mètre de support'));
  assert.equal(header.count, 14);
  // A1 — the blank has its own row, its own count, and a hatch rather than a
  // tint, so it survives the sensor passes (D3).
  const blank = legend.find((row) => row.label.startsWith('sans fût'));
  assert.equal(blank.count, 1);
  assert.ok(blank.glyph?.startsWith('data:image/svg+xml'));
  assert.ok(blank.blurb.includes(String(ANFR_HEIGHT_MISSING)));
  // ANFR's own spelling, `Intérieur sous-terrain`, quoted rather than tidied.
  assert.ok(blank.blurb.includes('sous-terrain'));
  // The band ramp is untouched: the new rows are appended, never mixed into it.
  assert.equal(labels.indexOf('5G en service'), 0);
  _clearAnfrSelectionForTest();
});

test('the row label tells the three empties apart', () => {
  // A4 — no shaft on screen can mean too far to draw one, no height published,
  // or the cap biting. Three causes, three sentences.
  const far = buildAnfrLoadingLabel({
    regime: 'supports', status: 'ready', loading: false, count: 15, inView: 15,
    records: new Map(), mastRegime: false, masts: 0, mastsUnpublished: 0, mastsClipped: 0,
  });
  assert.ok(far.includes('vue rapprochée'));
  assert.ok(!far.includes('sans hauteur publiée'));

  const near = buildAnfrLoadingLabel({
    regime: 'supports', status: 'ready', loading: false, count: 15, inView: 15,
    records: new Map(), mastRegime: true, masts: 14, mastsUnpublished: 1, mastsClipped: 3,
  });
  assert.ok(near.includes('14 fûts à leur hauteur'));
  assert.ok(near.includes('1 sans hauteur publiée, sans fût'), 'singular, and A1');
  assert.ok(near.includes('3 fûts écrêtés par le plafond'), 'A5 — the cap declares itself');

  const plural = buildAnfrLoadingLabel({
    regime: 'supports', status: 'ready', loading: false, count: 15, inView: 15,
    records: new Map(), mastRegime: true, masts: 10, mastsUnpublished: 5, mastsClipped: 0,
  });
  assert.ok(plural.includes('5 sans hauteur publiée, sans fût'));
  // The maillage never mentions shafts at all: it has no heights to draw.
  const mesh = buildAnfrLoadingLabel({
    regime: 'maillage', status: 'ready', loading: false, count: 3, inView: 9,
    national: NATIONAL, pick: { thinned: true }, mastRegime: false,
  });
  assert.ok(!mesh.includes('fût'));
});

test('the rays are the published bearings, and refuse to imply a range', () => {
  // The azimuth is NOT in the observatoire — it comes from the Cartoradio card
  // of the mast the reader clicked, one mast at a time. What is drawn is a
  // bearing at a published mounting height, and nothing else.
  const { rays, bearings, unplaced, unaimed } = anfrSectorRays(DETAIL);
  assert.ok(rays.length > 0);
  assert.equal(unplaced, 0);
  assert.equal(unaimed, 0);
  assert.ok(bearings.includes(0), 'zero is north, and it is drawn');
  assert.deepEqual(bearings, [...new Set(bearings)].sort((a, b) => a - b));
  assert.ok(bearings.length < rays.length, 'the card lists bearings, the map draws pairs');

  // A bearing with no mounting height is REFUSED, not seated on the mast's own
  // height: those are two different published numbers and swapping them would
  // be an invention that looks measured.
  const partial = anfrSectorRays({
    antennas: {
      withoutAzimuth: 2,
      azimuths: [
        { deg: 120, heightM: 30, antennas: 3 },
        { deg: 240, heightM: null, antennas: 1 },
        { deg: NaN, heightM: 30, antennas: 1 },
      ],
    },
  });
  assert.deepEqual(partial.rays, [{ deg: 120, heightM: 30, antennas: 3 }]);
  assert.equal(partial.unplaced, 1);
  assert.equal(partial.unaimed, 2);
  assert.deepEqual(anfrSectorRays(null).rays, []);

  // And the card says, in French, that the ray length is a drawing convention.
  const lines = anfrAzimuthLines(DETAIL);
  assert.ok(lines.some((line) => line.includes('Azimuts publiés')));
  assert.ok(lines.some((line) => line.includes('0°')));
  assert.ok(lines.some((line) => line.includes(`${ANFR_SECTOR_RAY_M} m`)
    && line.includes('ni l’ouverture ni la portée')));
  const refusals = anfrAzimuthLines({
    antennas: { withoutAzimuth: 1, azimuths: [{ deg: 90, heightM: null, antennas: 1 }] },
  });
  assert.ok(refusals.some((line) => line.includes('sans hauteur de fixation publiée')));
  assert.ok(refusals.some((line) => line.includes('sans azimut publié')));
  assert.deepEqual(anfrAzimuthLines({ antennas: { azimuths: [], withoutAzimuth: 0 } }), []);
});

test('the drawn shafts and rays are world geometry, and go away with the selection', async () => {
  // The production path, against real primitive collections: this is where a
  // length in metres either is a length in metres or is not.
  const added = [];
  const viewer = {
    ...fakeViewer(2.325, 48.850, 2.340, 48.860),
    scene: {
      requestRender() {},
      canvas: {},
      preRender: { addEventListener: () => () => {} },
      primitives: {
        add(primitive) { added.push(primitive); return primitive; },
        remove(primitive) { return added.splice(added.indexOf(primitive), 1).length > 0; },
        contains() { return true; },
        raiseToTop() {},
      },
    },
  };
  anfrFranceLayer.init(viewer);
  const [, masts, sectors] = added;

  const http = async () => ({ ok: true, json: async () => PACK });
  _setAnfrStateForTest({ viewer, overlayHost: makeHost(), http, regime: 'maillage' });
  // A 0.015° box is inside the shaft sub-regime, so the load path draws them.
  await _loadAnfrViewportForTest(viewer);
  assert.equal(_anfrMastTallyForTest().mastRegime, true);
  assert.equal(masts.length, 14, 'one shaft per published height, and none for the blank');
  assert.equal(masts.show, true);

  // The shaft's LENGTH is the support's height, in metres of the world. This
  // is the B2 assertion: nothing screen-space is composed with it.
  const line = masts.get(0);
  const foot = Cesium.Cartographic.fromCartesian(line.positions[0]);
  const top = Cesium.Cartographic.fromCartesian(line.positions[1]);
  assert.ok(Math.abs(foot.longitude - top.longitude) < 1e-12, 'the shaft is vertical');
  const drawn = top.height - foot.height;
  const heights = SUPPORTS.map((row) => row.heightM).filter((value) => value > 0);
  assert.ok(heights.some((value) => Math.abs(value - drawn) < 0.5), `${drawn} is a published height`);

  // A support that radiates nothing gets a dashed shaft: its height is a
  // figure on an authorised file, not a measurement of something built.
  const materials = new Set();
  for (let i = 0; i < masts.length; i += 1) materials.add(masts.get(i).material.type);
  assert.ok(materials.has('Color'));
  assert.ok(materials.has('PolylineDash'), 'the project-only support is dashed');

  // Now the rays. Nothing is drawn until a support is selected AND its
  // Cartoradio card has arrived, because that card is where the bearings are.
  assert.equal(sectors.show, false);
  _setAnfrStateForTest({
    viewer, overlayHost: makeHost(), http, pack: PACK, regime: 'supports',
    mastRegime: true, details: [[449714, DETAIL]],
  });
  _selectAnfrForTest(anfrSupportId(449714));
  const expected = anfrSectorRays(DETAIL).rays.length;
  assert.equal(_anfrMastTallyForTest().sectors, expected);
  assert.equal(sectors.length, expected);
  assert.equal(sectors.show, true);
  // Every ray is exactly the declared 60 m, horizontal, at its own mounting
  // height — a direction, never a coverage radius.
  for (let i = 0; i < sectors.length; i += 1) {
    const [near, far] = sectors.get(i).positions;
    const a = Cesium.Cartographic.fromCartesian(near);
    const b = Cesium.Cartographic.fromCartesian(far);
    assert.ok(Math.abs(a.height - b.height) < 0.5, 'horizontal');
    const metres = anfrDistanceM(
      Cesium.Math.toDegrees(a.latitude), Cesium.Math.toDegrees(a.longitude),
      Cesium.Math.toDegrees(b.latitude), Cesium.Math.toDegrees(b.longitude),
    );
    assert.ok(Math.abs(metres - ANFR_SECTOR_RAY_M) < 0.5, `${metres} m`);
  }
  // One material for the whole fan: a PolylineCollection buckets by material
  // instance, and 33 fresh ones would be 33 draw calls for one colour.
  assert.equal(new Set([...Array(sectors.length)].map((_, i) => sectors.get(i).material)).size, 1);

  // Deselecting takes the rays down and leaves the shafts alone: they belong
  // to two different questions.
  _clearAnfrSelectionForTest();
  assert.equal(sectors.show, false);
  for (let i = 0; i < sectors.length; i += 1) assert.equal(sectors.get(i).show, false);

  anfrFranceLayer.destroy(viewer);
  assert.equal(added.length, 0);
});
