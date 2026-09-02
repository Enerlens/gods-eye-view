// src/data/proxyResponseCaps.test.mjs
// The three primitives every keyed proxy in `vite.config.js` leans on, pinned
// after an outside review found each of them quietly wrong: an accumulator that
// throws on a busy day, a byte cap that counted characters, and a host
// allowlist that stopped applying the moment an upstream answered 302.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAll,
  gbfsRedirectTarget,
  readResponseTextCapped,
} from '../../vite.config.js';

// Comfortably past the ~124k arguments V8 accepts on the Node in `engines`,
// and below the "200k+ detections can be live" the FIRMS renderer budgets for.
const OVERSIZED = 200_000;

test('appendAll takes an array size that a spread refuses outright', () => {
  const items = new Array(OVERSIZED).fill(1);
  // Pinned deliberately: on a future V8 that raises the argument limit this
  // assertion fails, which is the signal that the guard has stopped being
  // load-bearing — not a reason to weaken the test.
  assert.throws(() => { const sink = []; sink.push(...items); }, RangeError);
  const target = ['pre-existing'];
  assert.equal(appendAll(target, items), target);
  assert.equal(target.length, OVERSIZED + 1);
  assert.equal(target[0], 'pre-existing');
  assert.equal(target[OVERSIZED], 1);
});

test('appendAll accepts any iterable and leaves an empty one alone', () => {
  assert.deepEqual(appendAll([1], new Set([2, 3])), [1, 2, 3]);
  assert.deepEqual(appendAll([1], []), [1]);
});

test('the shared response cap counts bytes, not UTF-16 code units', async () => {
  // '€' is ONE code unit and THREE UTF-8 bytes. Every `body.length > maxBytes`
  // check these proxies used to run measured 3 where the wire carries 9, so a
  // non-Latin feed could sit at three times a cap and still pass it.
  const body = '€€€';
  assert.equal(body.length, 3);
  assert.equal(Buffer.byteLength(body), 9);
  assert.equal(await readResponseTextCapped(new Response(body), 9), body);
  await assert.rejects(
    readResponseTextCapped(new Response(body), 8),
    (error) => error?.code === 'RESPONSE_TOO_LARGE',
  );
});

test('a declared Content-Length over the cap is refused without reading the body', async () => {
  const response = new Response('x', { headers: { 'content-length': '64' } });
  await assert.rejects(
    readResponseTextCapped(response, 32),
    (error) => error?.code === 'RESPONSE_TOO_LARGE',
  );
  // And the socket is released rather than left open until GC reaches it.
  assert.equal(response.bodyUsed, true);
});

const gbfsBase = new URL('https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json');

test('a GBFS redirect inside the allowlist is followed', () => {
  assert.equal(
    gbfsRedirectTarget(gbfsBase, 'https://gbfs.bluebikes.com/gbfs/en/station_status.json')?.href,
    'https://gbfs.bluebikes.com/gbfs/en/station_status.json',
  );
  // Relative Location headers are legal and common — resolve, then re-check.
  assert.equal(
    gbfsRedirectTarget(gbfsBase, '../fr/station_information.json')?.href,
    'https://gbfs.lyft.com/gbfs/2.3/bkn/fr/station_information.json',
  );
});

test('a GBFS redirect off the allowlist is refused, which is the whole point', () => {
  // The reason this helper exists. fetch() follows redirects on its own, so an
  // allowlisted feed answering 302 was enough to make the proxy fetch a link
  // local address and hand back the body — every check above it already spent.
  assert.equal(gbfsRedirectTarget(gbfsBase, 'http://169.254.169.254/latest/meta-data/'), null);
  assert.equal(gbfsRedirectTarget(gbfsBase, 'https://evil.example/station_status.json'), null);
  // Right host, wrong endpoint: the path allowlist survives the hop too.
  assert.equal(gbfsRedirectTarget(gbfsBase, 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/free_bike_status.json'), null);
  // Downgrade to http, on an allowed host, is still a downgrade.
  assert.equal(gbfsRedirectTarget(gbfsBase, 'http://gbfs.lyft.com/gbfs/en/station_status.json'), null);
});

test('a missing or unparseable Location is refused rather than guessed at', () => {
  assert.equal(gbfsRedirectTarget(gbfsBase, null), null);
  assert.equal(gbfsRedirectTarget(gbfsBase, ''), null);
  assert.equal(gbfsRedirectTarget(gbfsBase, '   '), null);
  assert.equal(gbfsRedirectTarget(gbfsBase, 'http://['), null);
});
