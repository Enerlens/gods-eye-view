// The building as a pivot: what a click on a volume can say about its ground.
//
// `docs/PLAN-CROISEMENTS.md` recorded this as blocked because "les trois
// tirages sont des requêtes réseau déclenchées par une carte, ce que le dépôt
// ne fait nulle part aujourd'hui". Two halves of that were wrong — the pattern
// exists (`cadastreParcels.selectParcel`, and this very layer's RNB lookup),
// and no network call is needed at all: DVF, Sitadel and the GPU are three
// layers already loaded for the same viewport, and the answer is a READ.
//
// So what needs pinning down is not a fetch. It is the JOIN KEY, which is the
// one place a wrong answer can be produced silently, and the wording, which is
// where a register can be made to claim more than it published.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildingDossierLines,
  cadastralParcelId,
  dossierMonthLabel,
  dossierPermitLine,
  dossierSaleLine,
  dossierZoningLine,
} from './buildingDossier.js';

test('the cadastral id is assembled, and refused rather than padded', () => {
  // Sitadel publishes the pieces; the RNB and DVF publish the whole.
  assert.equal(cadastralParcelId({
    commune: '75056', prefixe: '000', section: 'AB', numero: '123',
  }), '75056000AB0123');
  // A one-letter section and a short number are zero-padded into their fields.
  assert.equal(cadastralParcelId({
    commune: '44109', prefixe: '801', section: 'D', numero: '7',
  }), '441098010D0007');
  // An ABSENT préfixe is `000` and that is the cadastre's own convention for a
  // commune with no absorbed territory — not a guess.
  assert.equal(cadastralParcelId({ commune: '75056', section: 'AB', numero: '123' }), '75056000AB0123');
  // Corsica's 2A/2B are real INSEE codes and must survive.
  assert.equal(cadastralParcelId({ commune: '2A004', section: 'AB', numero: '1' }), '2A004000AB0001');
});

test('a missing or malformed piece is a refusal — a wrong parcel is worse than none', () => {
  for (const bad of [
    { commune: '', section: 'AB', numero: '1' },
    { commune: '750', section: 'AB', numero: '1' },
    { commune: '75056', section: '', numero: '1' },
    { commune: '75056', section: 'AB', numero: '' },
    // Toulouse publishes 46 préfixes; one that does not parse names a
    // different parcel in the same commune, so it is refused.
    { commune: '31555', prefixe: 'XX', section: 'AB', numero: '1' },
    { commune: '75056', section: 'ABC', numero: '1' },
    { commune: '75056', section: 'AB', numero: '12345' },
  ]) {
    assert.equal(cadastralParcelId(bad), null, JSON.stringify(bad));
  }
  assert.equal(cadastralParcelId(), null);
});

test('a sale is dated to the month, and never given a price per m² DVF refused', () => {
  assert.equal(dossierMonthLabel('2024-03-18'), 'mars 2024');
  assert.equal(dossierMonthLabel('bogus'), null);
  // DVF is a fiscal extract published twice a year; a day beside a live map
  // would read as a transaction feed.
  const euros = (value) => Number(value).toLocaleString('fr-FR');
  assert.equal(
    dossierSaleLine({ date: '2024-03-18', valeur: 465000, prixM2: null }),
    `Vendu mars 2024 · ${euros(465000)} € — DVF, sur cette parcelle`,
  );
  // `prixM2` is null on every lot that is not exactly one dwelling with a
  // published surface — the trap `dvfFeed.js` exists for. Dividing the
  // valeur_fonciere here would re-introduce it one line down.
  assert.equal(
    dossierSaleLine({ date: '2024-03-18', valeur: 465000, prixM2: 8214 }),
    `Vendu mars 2024 · ${euros(465000)} € · ${euros(8214)} €/m² — DVF, sur cette parcelle`,
  );
  assert.equal(dossierSaleLine({ date: '2024-03-18', valeur: 0 }), null);
  assert.equal(dossierSaleLine(null), null);
});

test('the permits line names the newest and counts the rest', () => {
  assert.equal(
    dossierPermitLine({ count: 1, newest: { date: '2023-06-02', label: 'PC · Autorisé' } }),
    'Permis : PC · Autorisé · juin 2023 — Sitadel, sur cette parcelle',
  );
  // A Paris parcel carries up to 34 permits over thirteen years, and a card is
  // four lines wide.
  assert.equal(
    dossierPermitLine({ count: 34, newest: { date: '2025-01-09', label: 'PC · Chantier ouvert' } }),
    'Permis : PC · Chantier ouvert · janvier 2025 · +33 autres depuis 2013 — Sitadel, sur cette parcelle',
  );
  assert.equal(dossierPermitLine({ count: 0 }), null);
  assert.equal(dossierPermitLine(null), null);
});

test('the three zoning answers are three different facts', () => {
  // Asked, and zoned.
  assert.equal(
    dossierZoningLine({ insideBox: true, zones: [{ code: 'UA', label: 'Zone urbaine dense' }], servitudes: [] }),
    'PLU : UA — Zone urbaine dense',
  );
  // Asked, and NOT zoned. Different from never asked, and the card says so.
  assert.equal(
    dossierZoningLine({ insideBox: true, zones: [], servitudes: [] }),
    'PLU : aucun zonage publié sur ce point',
  );
  // NEVER ASKED — the scan box does not cover this ground. Silence, because
  // anything else would be a statement about a document nobody read.
  assert.equal(dossierZoningLine({ insideBox: false, zones: [], servitudes: [] }), null);
  assert.equal(dossierZoningLine(null), null);
});

test('two zonings on one point are reported, not reconciled', () => {
  // Two communes digitise their shared limit independently and the Géoportail
  // stacks both documents; the strip between the two traces carries two.
  assert.equal(
    dossierZoningLine({
      insideBox: true,
      zones: [{ code: 'UA', label: 'Urbaine' }, { code: 'AU', label: 'À urbaniser' }],
      servitudes: [{ code: 'AC1' }],
    }),
    'PLU : UA — Urbaine · +1 zonage sur ce point · 1 servitude',
  );
});

test('a card with none of the three layers on is the card that was drawn before', () => {
  assert.deepEqual(buildingDossierLines(null), []);
  assert.deepEqual(buildingDossierLines({ sale: null, permits: null, zoning: null }), []);
});

test('the three lines come in the order a reader asks them', () => {
  const lines = buildingDossierLines({
    sale: { date: '2024-03-18', valeur: 465000, prixM2: null },
    permits: { count: 2, newest: { date: '2025-01-09', label: 'PC · Autorisé' } },
    zoning: { insideBox: true, zones: [{ code: 'UA' }], servitudes: [] },
  });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Vendu/, 'what it is worth');
  assert.match(lines[1], /^Permis/, 'what may be built on it');
  assert.match(lines[2], /^PLU/, 'what is allowed there');
});
