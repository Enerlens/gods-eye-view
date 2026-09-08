// src/data/arcepFeed.test.mjs
// Pins Ma connexion internet against real captured rows from the three files
// this module reads. The two facts under test are the ones a wrong reading
// would render silently: that the best-technology columns partition, and that
// the wired débit file — not the satellite-inclusive one — is what gets shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ARCEP_FILES,
  ARCEP_SPEED_CLASSES,
  ARCEP_TECHNOLOGIES,
  arcepFileUrl,
  parseArcepCsv,
  projectArcep,
} from './arcepFeed.js';
import { foldToCommune } from './communeCode.js';

const read = (name) => readFileSync(
  new URL(`./fixtures/arcep-mci-2026t1-${name}-sample.csv`, import.meta.url),
  'utf8',
);
const BEST = parseArcepCsv(read('meilleure-techno-thd'));
const WIRED = parseArcepCsv(read('debit-filaire'));
const TECHNO = parseArcepCsv(read('techno'));

function project(code) {
  return projectArcep({
    code,
    best: BEST.rows.get(code) ?? null,
    wired: WIRED.rows.get(code) ?? null,
    techno: TECHNO.rows.get(code) ?? null,
  });
}

test('the captured edition still publishes every column the projection reads', () => {
  for (const technology of ARCEP_TECHNOLOGIES) {
    assert.ok(BEST.header.includes(technology.column), `${technology.column} must still exist`);
  }
  for (const speed of ARCEP_SPEED_CLASSES) {
    assert.ok(WIRED.header.includes(speed.column), `${speed.column} must still exist`);
  }
  assert.ok(TECHNO.header.includes('elig_cu'));
  assert.equal(BEST.dropped, 0);
  assert.equal(BEST.edition, '2026-03-31');
  assert.equal(BEST.rows.size, 6);
});

test('each local is counted once under its best technology, and it is checked', () => {
  const paris = project('75056');
  assert.equal(paris.partitionsExactly, true);
  const sum = paris.technologies
    .filter((t) => t.key !== 'aucune')
    .reduce((total, t) => total + t.premises, 0);
  assert.equal(sum, BEST.rows.get('75056').nbr_elig_8);
});

test('Paris is one row and has no arrondissements — the code must be folded', () => {
  assert.equal(foldToCommune('75113'), '75056');
  assert.ok(BEST.rows.has('75056'));
  assert.ok(!BEST.rows.has('75113'));
  assert.equal(project('75056').premises, 1667292);
});

test('the wired file is the one read, and it disagrees with the satellite one', () => {
  // Gaas: two premises with no wired high-speed offer at all. The
  // satellite-inclusive `commune_debit.csv` publishes inel_hd = 0 for the same
  // commune, which is why that file is not in ARCEP_FILES.
  const gaas = project('40101');
  assert.equal(gaas.speedsBasis, 'filaire');
  assert.equal(gaas.wiredIneligible.premises, 2);
  assert.equal(ARCEP_FILES.wired, 'commune_debit_filaire.csv');
  assert.ok(!Object.values(ARCEP_FILES).includes('commune_debit.csv'));
});

test('speed classes are cumulative thresholds, never a partition', () => {
  const paris = project('75056');
  const by = Object.fromEntries(paris.speeds.map((s) => [s.key, s.premises]));
  assert.ok(by.gigabit <= by.thd100);
  assert.ok(by.thd100 <= by.thd30);
  assert.ok(by.thd30 <= by.bhd8);
  // Adding them would exceed the commune several times over — the reason the
  // payload keeps them under `speeds` and never under `technologies`.
  const total = paris.speeds.reduce((sum, s) => sum + s.premises, 0);
  assert.ok(total > paris.premises * 3);
});

test('copper is a moving fact: Ajaccio has none left, Paris nearly all', () => {
  const ajaccio = project('2A004');
  const paris = project('75056');
  assert.equal(ajaccio.copper.premises, 0);
  assert.equal(ajaccio.copper.percent, 0);
  assert.ok(paris.copper.percent > 99);
  // 1 667 159 of 1 667 292 is 99,992 %, and it must not be printed as 100 %:
  // 133 Paris premises have already lost their copper pair.
  assert.ok(paris.copper.premises < paris.premises);
  assert.equal(paris.copper.percent, 99.9);
});

test('a share never rounds to a whole it has not reached', () => {
  const parsed = parseArcepCsv([
    'code_insee;nom_com;code_dep;code_reg;nbr;type;elig_cu;date',
    // One premises short of the whole, and one premises above nothing.
    '01001;Essai;01;84;1000000;all;999999;2026-03-31',
    '01002;Essai;01;84;1000000;all;1;2026-03-31',
  ].join('\n'));
  const nearlyAll = projectArcep({ code: '01001', techno: parsed.rows.get('01001'), best: parsed.rows.get('01001') });
  const nearlyNone = projectArcep({ code: '01002', techno: parsed.rows.get('01002'), best: parsed.rows.get('01002') });
  assert.equal(nearlyAll.copper.percent, 99.9);
  assert.equal(nearlyNone.copper.percent, 0.1);
});

test('gigabit above fibre is cable, not an error', () => {
  // 409 communes publish it. Here the best-technology file names the medium:
  // coax carries premises the fibre column does not.
  const commune = project('29019');
  const coax = commune.technologies.find((t) => t.key === 'coax');
  assert.ok(coax && coax.premises > 0);
});

test('an overseas commune the loyers file does not cover is still served', () => {
  const mamoudzou = project('97611');
  assert.equal(mamoudzou.commune.departement, '976');
  const fibre = mamoudzou.technologies.find((t) => t.key === 'ftth');
  assert.equal(fibre.premises, 1264);
  assert.ok(fibre.percent < 10);
});

test('a silent file degrades one half and names it', () => {
  const partial = projectArcep({ code: '75056', best: BEST.rows.get('75056'), wired: null, techno: null });
  assert.equal(partial.speeds, null);
  assert.equal(partial.copper, null);
  assert.deepEqual(partial.missing, ['débits filaires', 'technologies']);
  assert.equal(projectArcep({ code: '75056' }), null);
});

test('a leading-zero INSEE code survives the parse', () => {
  // `01001` reads as digits, and coercing it to a number then back to a string
  // yields `1001` — which fails the five-character pattern. Every commune of
  // départements 01 to 09 would have vanished while Paris looked correct.
  const parsed = parseArcepCsv([
    'code_insee;nom_com;code_dep;code_reg;nbr;type;elig_cu;date',
    '01001;Essai;01;84;100;all;90;2026-03-31',
  ].join('\n'));
  assert.ok(parsed.rows.has('01001'));
  assert.equal(parsed.rows.get('01001').code_dep, '01');
  assert.equal(parsed.rows.get('01001').nbr, 100);
});

test('a row of an unexpected type is refused rather than allowed to overwrite', () => {
  const parsed = parseArcepCsv([
    'code_insee;nom_com;code_dep;code_reg;nbr;type;elig_cu;date',
    '01001;Essai;01;84;100;all;90;2026-03-31',
    '01001;Essai;01;84;40;pro;0;2026-03-31',
  ].join('\n'));
  assert.equal(parsed.rows.size, 1);
  assert.equal(parsed.rows.get('01001').elig_cu, 90);
  assert.equal(parsed.dropped, 1);
});

test('every file is addressed through the moving `last` alias', () => {
  for (const file of Object.values(ARCEP_FILES)) {
    assert.match(arcepFileUrl(file), /^https:\/\/data\.arcep\.fr\/fixe\/maconnexioninternet\/statistiques\/last\/commune\/[a-z_0-9]+\.csv$/);
  }
});
