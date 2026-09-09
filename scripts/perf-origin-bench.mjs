#!/usr/bin/env node
/**
 * perf:origin — what the server does when fifty people open the globe at once.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `perf:boot` measures one visitor on a slow laptop. This one measures the
 * other end of the same wire: a `vite preview` process in a container on a
 * 2-vCPU box **shared with the Enerlens production database**. The number that
 * matters there is not the average — it is the p95 under a crowd, and the
 * container's RSS while it happens, because the failure mode is not "the page
 * is slow", it is "Postgres lost its memory".
 *
 * ── WHY IT REPLAYS A BOOT AND NOT ONE URL ───────────────────────────────────
 *
 * A flat hammer on `/` measures a static file handler and nothing a visitor
 * lives through. A real cold visit is a SEQUENCE: the HTML, then the two big
 * scripts it names, then the CSS, then the handful of `/api` calls the app
 * makes on its own. Each virtual visitor here replays that whole sequence and
 * starts over, so `visits/s` is "cold boots served per second" and the p95 is
 * per request inside a real boot. The asset list is DISCOVERED from `/`
 * (hashed filenames change every build), never hardcoded.
 *
 * ── WHY IT MUST RUN ON THE VPS, NOT ON THE MAC ──────────────────────────────
 *
 * `gev.enerlens.com` is behind a Cloudflare rule capping `/api` at 30 req/10 s
 * per IP, and the Mac shares its IP with the person reading this. Fifty
 * visitors from here measure Cloudflare's patience, not the server's. Run it
 * on the box, against `127.0.0.1`, where the tunnel and the rule are both out
 * of the path. See `docs/PLAN-PERFORMANCE.md` § phase 0.4.
 *
 * Usage:
 *   node scripts/perf-origin-bench.mjs --url http://127.0.0.1:4173
 *   node scripts/perf-origin-bench.mjs --visitors 50 --duration 30 --json
 *   node scripts/perf-origin-bench.mjs --auth gev:hunter2      # HTTP Basic gate
 *   node scripts/perf-origin-bench.mjs --paths boot-urls.json  # from perf:urls
 */
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const has = (k) => argv.includes(k);

const base = arg('--url', 'http://127.0.0.1:4173').replace(/\/$/, '');
const visitors = Number(arg('--visitors', '50'));
const durationMs = Number(arg('--duration', '30')) * 1000;
const auth = arg('--auth', '');
const pathsFile = arg('--paths', '');
const asJson = has('--json');
const rampMs = Number(arg('--ramp', '2')) * 1000;

/**
 * The `/api` calls a boot makes on its own, before anyone touches anything.
 * Overridable with `--api`, and overridden wholesale by `--paths`. Kept short
 * on purpose: an endpoint that a boot does NOT call has no business in a boot
 * bench, however expensive it is.
 */
const DEFAULT_API = (arg('--api', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

const headers = { 'accept-encoding': 'gzip, deflate, br', connection: 'keep-alive' };
if (auth) headers.authorization = `Basic ${Buffer.from(auth).toString('base64')}`;

const agentFor = (u) => (u.startsWith('https:')
  ? new https.Agent({ keepAlive: true, maxSockets: Infinity })
  : new http.Agent({ keepAlive: true, maxSockets: Infinity }));
const agent = agentFor(base);

/** One request, timed. Resolves rather than rejects: an error is a data point. */
function get(path) {
  return new Promise((resolve) => {
    const u = new URL(path, base);
    const lib = u.protocol === 'https:' ? https : http;
    const t0 = process.hrtime.bigint();
    let ttfb = null; let bytes = 0;
    const req = lib.request(u, { agent, headers, timeout: 30_000 }, (res) => {
      ttfb = Number(process.hrtime.bigint() - t0) / 1e6;
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => resolve({
        path, status: res.statusCode, ttfb, type: res.headers['content-type'] || '',
        total: Number(process.hrtime.bigint() - t0) / 1e6, bytes,
      }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({
      path, status: `ERR ${e.message}`, ttfb,
      total: Number(process.hrtime.bigint() - t0) / 1e6, bytes,
    }));
    req.end();
  });
}

/**
 * The boot sequence. Discovered from the served HTML because the asset names
 * carry a content hash: a hardcoded list silently benches 404s after any build,
 * and a 404 is fast, so the run would look GOOD.
 */
async function discover() {
  if (pathsFile) {
    const raw = JSON.parse(readFileSync(pathsFile, 'utf8'));
    const rows = Array.isArray(raw) ? raw : (raw.rows || raw.list || []);
    const out = [];
    for (const r of rows) {
      const u = typeof r === 'string' ? r : r.url;
      if (!u) continue;
      try {
        const parsed = new URL(u, base);
        // Same-origin only: this bench answers "what does OUR box do", and a
        // tile from Google in the list would measure Google.
        if (parsed.origin === new URL(base).origin) out.push(parsed.pathname + parsed.search);
      } catch { /* not a URL */ }
    }
    // Duplicates are KEPT here. A recorded boot asks for `/logo.svg` three
    // times — favicon, two `<img>` — and de-duplicating would bench a boot
    // nobody performs. The auto-discovery branch dedups because it reads a
    // document, not a trace.
    return out;
  }
  const html = await new Promise((resolve, reject) => {
    const u = new URL('/', base);
    const lib = u.protocol === 'https:' ? https : http;
    // `identity` for THIS request only: the bench itself asks for gzip/br like
    // a browser does, but discovery reads the body as text, and a gzipped body
    // read as utf8 matches no regex and silently benches a one-URL sequence.
    lib.get(u, { headers: { ...headers, 'accept-encoding': 'identity' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`GET / → ${res.statusCode}`)); res.resume(); return; }
      let body = ''; res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  return ['/', ...new Set(assets), ...DEFAULT_API];
}

const pct = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0);
const round = (n, d = 1) => Number(n.toFixed(d));

const paths = await discover();

// Preflight, and it is not optional. A `--paths` trace recorded on one build
// carries that build's content hashes; replayed against another, every app
// chunk 404s — and a 404 is FAST, so the run reports a flattering p95 for a
// boot nobody could complete. One request per unique path costs a second and
// makes that impossible.
{
  const unique = [...new Set(paths)];
  const bad = [];
  // Status alone is not enough. `vite preview` answers a MISSING `/assets/*.js`
  // with 200 and index.html — the SPA fallback — so a stale trace benches
  // 58 kB of HTML while reporting 200 and looking fast. Measured on staging
  // 2026-09-09: a wrong content hash returned 200 text/html, 58 241 bytes,
  // where the real chunk is 2 559 351 bytes of text/javascript.
  const EXPECTED = { js: 'javascript', css: 'css', json: 'json', woff2: 'font', svg: 'svg', png: 'image' };
  for (const p of unique) {
    const r = await get(p);
    if (r.status !== 200) { bad.push(`${r.status}  ${p}`); continue; }
    const ext = (p.split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    const want = ext && EXPECTED[ext];
    if (want && !r.type.includes(want)) bad.push(`200 but ${r.type || 'no content-type'} (SPA fallback?)  ${p}`);
  }
  if (bad.length) {
    console.error(`Preflight failed — ${bad.length}/${unique.length} paths do not answer 200:\n  ${bad.join('\n  ')}`);
    console.error('A trace recorded on another build cannot be replayed here; re-record it, or drop --paths and let the bench discover the assets from /.');
    process.exit(1);
  }
}

if (!asJson) {
  console.log(`boot sequence: ${paths.length} same-origin requests`);
  for (const p of paths) console.log(`  ${p}`);
  console.log(`\n${visitors} visitors, ${durationMs / 1000}s, ramp ${rampMs / 1000}s → ${base}\n`);
}

const samples = [];
let visits = 0;
const deadline = Date.now() + durationMs;

/** One virtual visitor: replay the boot, then immediately be a new visitor. */
async function visitor(i) {
  // Ramping matters: fifty sockets opening in the same millisecond measures
  // the accept queue, not the server. A real crowd arrives spread out.
  await new Promise((r) => setTimeout(r, (rampMs * i) / Math.max(1, visitors)));
  while (Date.now() < deadline) {
    for (const p of paths) {
      if (Date.now() >= deadline) return;
      samples.push(await get(p));
    }
    visits++;
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: visitors }, (_, i) => visitor(i)));
const elapsed = (Date.now() - started) / 1000;

const byPath = new Map();
const status = {};
let bytes = 0;
for (const s of samples) {
  bytes += s.bytes;
  status[s.status] = (status[s.status] || 0) + 1;
  if (!byPath.has(s.path)) byPath.set(s.path, []);
  byPath.get(s.path).push(s.total);
}
const all = samples.map((s) => s.total).sort((a, b) => a - b);
const summary = {
  base, visitors, durationS: round(elapsed), paths: paths.length,
  requests: samples.length, visits, visitsPerS: round(visits / elapsed, 2),
  reqPerS: round(samples.length / elapsed, 1),
  MB: round(bytes / 1048576, 1), MBps: round(bytes / 1048576 / elapsed, 2),
  p50: round(pct(all, 0.5)), p95: round(pct(all, 0.95)), p99: round(pct(all, 0.99)),
  max: round(all[all.length - 1] || 0),
  status,
};
const perPath = [...byPath.entries()].map(([p, v]) => {
  const s = v.sort((a, b) => a - b);
  return { path: p, n: s.length, p50: round(pct(s, 0.5)), p95: round(pct(s, 0.95)), p99: round(pct(s, 0.99)) };
}).sort((a, b) => b.p95 - a.p95);

if (asJson) {
  console.log(JSON.stringify({ summary, perPath }, null, 2));
} else {
  for (const r of perPath) console.log(`  p95 ${String(r.p95).padStart(7)}ms  p99 ${String(r.p99).padStart(7)}ms  n=${String(r.n).padStart(4)}  ${r.path}`);
  console.log(
    `\nORIGIN visitors=${visitors} ${summary.durationS}s`
    + ` visits=${visits} (${summary.visitsPerS}/s) req=${summary.requests} (${summary.reqPerS}/s)`
    + ` p50=${summary.p50}ms p95=${summary.p95}ms p99=${summary.p99}ms max=${summary.max}ms`
    + ` egress=${summary.MB}MB (${summary.MBps}MB/s)`
    + ` status=${JSON.stringify(status)}`,
  );
}
