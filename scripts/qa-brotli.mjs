#!/usr/bin/env node
/**
 * qa:brotli — the origin serves brotli, and it serves the right bytes.
 *
 * `src/deliveryPolicy.test.mjs` pins the two judgements as pure functions
 * (which URL may be pre-compressed, and whether a client asked for brotli).
 * Neither can see the failure that would actually hurt: a `.br` body served
 * under the wrong `Content-Type`, without `Content-Encoding`, with a
 * `Content-Length` from the wrong file, or — worst and quietest — a stale `.br`
 * next to a rebuilt asset, which a browser decodes into last week's bundle
 * without a single error.
 *
 * So this one talks to the running preview server over a socket, with
 * `node:http` rather than `fetch` (undici decompresses behind your back, and
 * the compressed size is half of what is being asserted here).
 *
 * Requires a preview server: `npm run build && npm run preview -- --port 4179 --host 127.0.0.1`
 * (without `--host` vite binds `localhost`, which resolves to ::1 here and not
 * to the 127.0.0.1 the other harnesses default to).
 *
 * Usage: node scripts/qa-brotli.mjs [--url http://127.0.0.1:4179]
 */
import http from 'node:http';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const base = new URL(argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://127.0.0.1:4179');

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
};

/**
 * One request, with the encoding we asked for and the bytes exactly as sent.
 * @param {string} pathname
 * @param {string} acceptEncoding
 * @returns {Promise<{status: number, headers: object, body: Buffer}>}
 */
function request(pathname, acceptEncoding = 'identity') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: base.hostname, port: base.port, path: pathname, method: 'GET', headers: { 'accept-encoding': acceptEncoding } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const page = await request('/index.html', 'identity').catch((error) => {
  console.error(`\n  Aucun serveur sur ${base.origin} — lancer \`npm run preview -- --port ${base.port}\`.\n`);
  throw error;
});

const html = page.body.toString('utf8');
const entry = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
// The engine is a content-hashed chunk since it moved to tree-shaken ESM, and
// vite announces it with `modulepreload` rather than a script tag.
const cesium = html.match(/\/assets\/cesium-engine-[A-Za-z0-9_-]+\.js/)?.[0];
check('the built page names its entry chunk and the Cesium engine', Boolean(entry && cesium), { entry, cesium });
if (!entry || !cesium) process.exit(1);

for (const [label, target] of [['le chunk d\'entrée', entry], ['le moteur Cesium', cesium]]) {
  const brotli = await request(target, 'br, gzip');
  const identity = await request(target, 'identity');

  check(`${label} : servi en brotli`, brotli.headers['content-encoding'] === 'br', brotli.headers['content-encoding']);
  // Decoded defensively: when the pre-compression step has not run, the server
  // answers gzip, and `brotliDecompressSync` on that body THROWS — which would
  // take the whole harness down with a zlib stack trace instead of reporting
  // the one thing it exists to report.
  let decoded = null;
  try { decoded = zlib.brotliDecompressSync(brotli.body); } catch { /* not brotli */ }
  check(`${label} : le corps décodé est identique à l'original`,
    decoded !== null && decoded.equals(identity.body),
    { br: brotli.body.length, identity: identity.body.length, decodable: decoded !== null });
  check(`${label} : Content-Length annonce le corps envoyé`,
    Number(brotli.headers['content-length']) === brotli.body.length,
    { announced: brotli.headers['content-length'], sent: brotli.body.length });
  check(`${label} : le type reste du JavaScript`,
    /javascript/.test(brotli.headers['content-type'] || ''), brotli.headers['content-type']);
  check(`${label} : garde son année de cache et son Vary`,
    /immutable/.test(brotli.headers['cache-control'] || '') && /accept-encoding/i.test(brotli.headers.vary || ''),
    { cc: brotli.headers['cache-control'], vary: brotli.headers.vary });

  // The point of the exercise, stated as a number rather than assumed.
  const gzip = await request(target, 'gzip');
  const saved = gzip.body.length - brotli.body.length;
  check(`${label} : plus petit que le gzip du serveur (${(saved / 1024).toFixed(0)} kB de moins)`,
    saved > 0, { gzip: gzip.body.length, br: brotli.body.length });
}

// A client that cannot decode brotli must never be handed one.
const refused = await request(entry, 'gzip, deflate');
check('un client qui ne demande pas brotli n\'en reçoit pas', refused.headers['content-encoding'] !== 'br', refused.headers['content-encoding']);
const zeroQuality = await request(entry, 'br;q=0, gzip');
check('« br;q=0 » est un refus, pas une acceptation', zeroQuality.headers['content-encoding'] !== 'br', zeroQuality.headers['content-encoding']);

// index.html revalidates, so it is deliberately out of the pre-compressed set:
// this middleware answers 200 and never 304.
const document = await request('/index.html', 'br, gzip');
check('la page, qui se revalide, n\'est pas servie pré-compressée', document.headers['content-encoding'] !== 'br', document.headers['content-encoding']);

// The `.br` files are an implementation detail of the delivery layer. Serving
// one directly would hand a browser a body it has no way to decode.
const naked = await request(`${entry}.br`, 'br, gzip');
check('demander le .br directement ne renvoie pas un corps indécodable',
  naked.status === 404 || naked.headers['content-encoding'] === 'br', { status: naked.status, enc: naked.headers['content-encoding'] });

const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} PASS\n`);
process.exit(failed.length ? 1 : 0);
