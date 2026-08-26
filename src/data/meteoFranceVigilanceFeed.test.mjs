// src/data/meteoFranceVigilanceFeed.test.mjs
// Pins the UPSTREAM Météo-France Vigilance product against a real captured
// CDP_CARTE_EXTERNE payload. This is the projection the dev-server proxy runs,
// so it is where a schema drift shows up first — and it is the only place the
// product's genuinely inconsistent typing is handled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VIGILANCE_PHENOMENA,
  VIGILANCE_WARNING_COLOR,
  projectVigilanceProduct,
  vigilanceColorId,
} from './meteoFranceVigilanceFeed.js';

const SAMPLE = JSON.parse(readFileSync(
  new URL('./fixtures/meteofrance-cartevigilance-sample.json', import.meta.url),
  'utf8',
));

test('the captured product still carries the fields the projection reads', () => {
  const product = SAMPLE.product;
  assert.equal(product.type_cdp, 'cdp_carte_externe');
  assert.equal(typeof product.update_time, 'string');
  assert.ok(Array.isArray(product.periods) && product.periods.length === 2);
  for (const period of product.periods) {
    assert.ok(['J', 'J1'].includes(period.echeance));
    assert.ok(Array.isArray(period.timelaps.domain_ids));
  }
});

test('global_max_color_id is a STRING while every other colour field is an int', () => {
  // Not a curiosity — a strict deserialiser blows up here, and it is the one
  // field most likely to be read as "how bad is France right now".
  assert.equal(typeof SAMPLE.product.global_max_color_id, 'string');
  const domain = SAMPLE.product.periods[0].timelaps.domain_ids[0];
  assert.equal(typeof domain.max_color_id, 'number');
  assert.equal(typeof domain.phenomenon_items[0].phenomenon_max_color_id, 'number');
  // And phenomenon_id is a string in this product but an int in some
  // republications, so it is coerced the other way.
  assert.equal(typeof domain.phenomenon_items[0].phenomenon_id, 'string');

  assert.equal(projectVigilanceProduct(SAMPLE, 'test').national, 3);
});

test('vigilanceColorId coerces to 1..4 and rejects everything else', () => {
  assert.equal(vigilanceColorId('3'), 3);
  assert.equal(vigilanceColorId(1), 1);
  assert.equal(vigilanceColorId(4), 4);
  for (const bad of [null, undefined, 0, 5, -1, 2.5, '', 'orange', {}, []]) {
    assert.equal(vigilanceColorId(bad), null, `${JSON.stringify(bad)} must be null`);
  }
});

test('periods are keyed by echeance, so a J-only night payload cannot throw', () => {
  const projected = projectVigilanceProduct(SAMPLE, 'test');
  assert.deepEqual(Object.keys(projected.periods).sort(), ['J', 'J1']);
  assert.equal(projected.periods.J.beginTime, '2026-08-26T04:00:00Z');

  // Between 00:00 and 06:00 Paris the product carries only a J block. Reading
  // periods[1] would throw for six hours every night — exactly the hours when
  // a night-time escalation is most interesting.
  const nightOnly = JSON.parse(JSON.stringify(SAMPLE));
  nightOnly.product.periods = nightOnly.product.periods.filter((p) => p.echeance === 'J');
  const night = projectVigilanceProduct(nightOnly, 'test');
  assert.deepEqual(Object.keys(night.periods), ['J']);
  assert.equal(night.periods.J1, undefined);
});

test('every domain survives the projection — the client owns the whitelist', () => {
  const projected = projectVigilanceProduct(SAMPLE, 'test');
  const ids = Object.keys(projected.periods.J.domains);
  // Départements, the national roll-up, a coastal strip and Corsica all pass
  // through. Filtering here would mean guessing which two-digit codes are real
  // départements — and Andorra's '99' passes any such guess.
  assert.ok(ids.includes('FRA'));
  assert.ok(ids.includes('3010'), 'coastal strips are passed through, not merged into their département');
  assert.ok(ids.includes('2A'), 'Corsica keeps its alphanumeric code');
  assert.ok(ids.includes('35') && ids.includes('14') && ids.includes('10'));
});

test('a coastal strip is NOT the same domain as its département', () => {
  const projected = projectVigilanceProduct(SAMPLE, 'test');
  const domains = projected.periods.J.domains;
  // Naively stripping the trailing '10' from '3010' would merge the Hérault
  // coastline into Hérault and overstate the département's level.
  assert.equal(domains['3010'].c, 1);
  assert.deepEqual(domains['3010'].p, [], 'the coastal strip carries only vagues-submersion, green today');
  assert.equal(domains['30'], undefined, 'Hérault itself is not in this trimmed fixture');
});

test('only raised phenomena are carried, most severe first', () => {
  const projected = projectVigilanceProduct(SAMPLE, 'test');
  const orange = projected.periods.J.domains['35'];
  assert.equal(orange.c, 3);
  // Six phenomena are published for this département; five are green, which is
  // the absence of a warning rather than a warning.
  assert.deepEqual(orange.p, [['3', 3]]);
  assert.equal(VIGILANCE_WARNING_COLOR, 2);

  const green = projected.periods.J.domains['10'];
  assert.equal(green.c, 1);
  assert.deepEqual(green.p, []);
});

test('phenomena are ordered so a single-slot renderer shows the right one', () => {
  const projected = projectVigilanceProduct({
    product: {
      update_time: '2026-01-08T23:05:49Z',
      periods: [{
        echeance: 'J',
        timelaps: {
          domain_ids: [{
            domain_id: '38',
            max_color_id: 4,
            phenomenon_items: [
              { phenomenon_id: '2', phenomenon_max_color_id: 2 },
              { phenomenon_id: '8', phenomenon_max_color_id: 4 },
              { phenomenon_id: '5', phenomenon_max_color_id: 3 },
              { phenomenon_id: '1', phenomenon_max_color_id: 1 },
            ],
          }],
        },
      }],
    },
  }, 'test');
  assert.deepEqual(projected.periods.J.domains['38'].p, [['8', 4], ['5', 3], ['2', 2]]);
});

test('phenomenon 4 (crues) survives with an empty timelaps_items', () => {
  // The spec is explicit: for phenomenon 4 the chronology arrays are empty for
  // J and J1, while phenomenon_max_color_id stays meaningful. A chronology
  // renderer that assumes non-empty divides by zero.
  const domain = SAMPLE.product.periods[0].timelaps.domain_ids
    .find((entry) => entry.domain_id === 'FRA');
  const crues = domain.phenomenon_items.find((item) => String(item.phenomenon_id) === '4');
  assert.ok(crues, 'crues must still be published');
  assert.deepEqual(crues.timelaps_items, []);
  assert.equal(typeof crues.phenomenon_max_color_id, 'number');

  // Raise it and it must reach the projection anyway.
  const raised = JSON.parse(JSON.stringify(SAMPLE));
  const target = raised.product.periods[0].timelaps.domain_ids
    .find((entry) => entry.domain_id === 'FRA');
  target.phenomenon_items.find((item) => String(item.phenomenon_id) === '4')
    .phenomenon_max_color_id = 3;
  assert.ok(projectVigilanceProduct(raised, 'test').periods.J.domains.FRA.p
    .some(([id, color]) => id === '4' && color === 3));
});

test('the phenomenon names are the spec\'s, with 2 = pluie and 4 = crues', () => {
  assert.equal(VIGILANCE_PHENOMENA[1], 'Vent violent');
  assert.equal(VIGILANCE_PHENOMENA[2], 'Pluie-inondation');
  assert.equal(VIGILANCE_PHENOMENA[4], 'Crues');
  assert.equal(VIGILANCE_PHENOMENA[9], 'Vagues-submersion');
  assert.equal(Object.keys(VIGILANCE_PHENOMENA).length, 9);
  // The SET present is seasonal and never all nine: August carried
  // {1,2,3,4,5,6,9} and January {1,2,3,4,5,7,8,9}.
  const august = new Set(SAMPLE.product.periods[0].timelaps.domain_ids
    .flatMap((domain) => domain.phenomenon_items.map((item) => String(item.phenomenon_id))));
  assert.ok(august.has('6'), 'canicule is an August phenomenon');
  assert.ok(!august.has('8'), 'avalanches are not');
});

test('the source label is carried through so the client can say where it came from', () => {
  assert.equal(projectVigilanceProduct(SAMPLE, 'data.gouv.fr mirror').source, 'data.gouv.fr mirror');
  assert.equal(projectVigilanceProduct(SAMPLE, 'test').updateTime, '2026-08-26T04:00:28Z');
});

test('an empty or malformed product projects to an empty, non-throwing document', () => {
  for (const input of [null, undefined, {}, { product: null }, { product: { periods: 'nope' } }, 'nope']) {
    const projected = projectVigilanceProduct(input, 'test');
    assert.deepEqual(projected.periods, {});
    assert.equal(projected.updateTime, null);
    assert.equal(projected.national, null);
    assert.equal(projected.source, 'test');
  }
});

test('an unnamed domain or phenomenon is skipped rather than keyed on ""', () => {
  const projected = projectVigilanceProduct({
    product: {
      periods: [{
        echeance: 'J',
        timelaps: {
          domain_ids: [
            { domain_id: '  ', max_color_id: 3, phenomenon_items: [] },
            {
              domain_id: '75',
              max_color_id: 2,
              phenomenon_items: [
                { phenomenon_id: '', phenomenon_max_color_id: 2 },
                { phenomenon_id: '3', phenomenon_max_color_id: 2 },
              ],
            },
          ],
        },
      }],
    },
  }, 'test');
  assert.deepEqual(Object.keys(projected.periods.J.domains), ['75']);
  assert.deepEqual(projected.periods.J.domains['75'].p, [['3', 2]]);
});
