#!/usr/bin/env node
/**
 * qa-vessel-types — phase 5: why so many ships read "Type non déclaré", and
 * what the registry on disk changes.
 *
 * The cause is in the protocol, not in the layer. AIS position reports —
 * messages 1/2/3 and 18, the ones the map is drawn from — carry no identity at
 * all. Type, name, IMO number and hull dimensions travel only in message 5 and
 * in part B of message 24, roughly every six minutes per transponder. The
 * server merged the two families correctly but kept the result in a
 * process-lifetime `Map` that was never written anywhere, so every restart
 * threw away 100 % of what it had learned and began the six-minute wait again.
 *
 * This harness measures the running dev server. It does not look at pixels:
 * the claim is a count, and the count is the whole of it.
 *
 *  A. THE SUBSCRIPTION IS THE ONE CONFIGURED. Every live contact falls inside
 *     the resolved bounding boxes — the France default, or whatever
 *     AISSTREAM_BOUNDING_BOXES overrides it with.
 *
 *  B. THE REGISTRY IS ON DISK. `.gev-cache/ais-static/registry.json` exists,
 *     parses at the current version, and holds identities.
 *
 *  C. WHAT A RESTART WOULD KEEP. Share of live contacts whose MMSI the file
 *     already knows. That is the type coverage the NEXT boot starts with,
 *     where it used to start at zero.
 *
 *  D. THE DECLARED SHARE, RIGHT NOW, with the family breakdown the legend
 *     draws. Informational: on a cold cache this is the ~30 % the protocol
 *     gives you, and it is supposed to climb over sessions.
 *
 *  E. NO VOYAGE DATA ON DISK. `destination` rides in the same message 5 as the
 *     identity, but it is true for one passage only. It must appear nowhere in
 *     the document.
 *
 *  F. THE REGISTRY IS BOUNDED. Every entry inside the 30-day TTL and under the
 *     size cap — the leak `pruneAisStreamCache()` never swept.
 *
 * NEEDS A RUNNING DEV SERVER with a live AISStream key. A feed that is not
 * delivering is reported as "not testable here", not as a failure.
 *
 * Run: node scripts/qa-vessel-types.mjs --url http://localhost:5174
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from 'vite';
import {
  AIS_STATIC_MAX_ENTRIES,
  AIS_STATIC_REGISTRY_VERSION,
  AIS_STATIC_TTL_MS,
} from '../src/data/aisStaticRegistry.js';
import { AIS_BBOX_FRANCE } from '../src/data/aisSubscription.js';
import { VESSEL_FAMILY_LABELS, vesselTypeFamily } from '../src/data/vesselLabels.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:5174');
const REGISTRY_FILE = path.join(process.cwd(), '.gev-cache', 'ais-static', 'registry.json');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok === null ? '○' : (ok ? '✔' : '✖');
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

const percent = (part, total) => (total ? `${((100 * part) / total).toFixed(1)} %` : 'n/a');

/** The boxes the server resolved, read from the same .env it reads. */
function resolvedBoxes() {
  const env = loadEnv('development', process.cwd(), '');
  const raw = env.AISSTREAM_BOUNDING_BOXES;
  if (!raw) return { boxes: AIS_BBOX_FRANCE, source: 'default (metropolitan France)' };
  try {
    return { boxes: JSON.parse(raw), source: 'AISSTREAM_BOUNDING_BOXES' };
  } catch {
    return { boxes: AIS_BBOX_FRANCE, source: 'default (AISSTREAM_BOUNDING_BOXES is unparseable)' };
  }
}

function insideAnyBox(lat, lon, boxes) {
  return boxes.some((box) => {
    const [[latA, lonA], [latB, lonB]] = box;
    return lat >= Math.min(latA, latB) && lat <= Math.max(latA, latB)
      && lon >= Math.min(lonA, lonB) && lon <= Math.max(lonA, lonB);
  });
}

console.log(`\nqa-vessel-types — ${APP_URL}/api/ais-live\n`);

let feed;
try {
  const response = await fetch(`${APP_URL}/api/ais-live?maxRows=50000`, {
    signal: AbortSignal.timeout(20_000),
  });
  feed = await response.json();
} catch (error) {
  console.log(`  ○ the dev server is not answering — ${error?.message || error}\n`);
  process.exit(0);
}

const rows = Array.isArray(feed?.rows) ? feed.rows : [];
console.log(`  · feed ${feed?.status || 'unknown'}, watchdog ${feed?.watchdog || 'unknown'}, ${rows.length} contacts\n`);
if (!rows.length) {
  console.log(`  ○ no contacts yet (status "${feed?.status}") — not testable here\n`);
  process.exit(0);
}

// ── A. the subscription is the one configured ──────────────────────────────
const { boxes, source } = resolvedBoxes();
const outside = rows.filter((row) => !insideAnyBox(row.lat, row.lon, boxes));
record(
  'A. every contact is inside the subscribed boxes',
  outside.length === 0,
  `${source}; ${outside.length} of ${rows.length} outside`,
);

// ── B / E / F. the file itself ─────────────────────────────────────────────
let document = null;
try {
  document = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
} catch { /* absent or unreadable: reported below */ }

const entries = document?.entries && typeof document.entries === 'object' ? document.entries : {};
const identities = Object.entries(entries);
record(
  'B. the identity registry is on disk',
  Boolean(document) && document.version === AIS_STATIC_REGISTRY_VERSION && identities.length > 0,
  document
    ? `v${document.version}, ${identities.length} identities, saved ${document.savedAt}`
    : `${REGISTRY_FILE} is absent — run the server for a minute first`,
);

// ── C. what a restart would keep ───────────────────────────────────────────
if (!identities.length) {
  record('C. a restart would keep what this session learned', null, 'no registry to measure');
} else {
  const known = rows.filter((row) => Object.hasOwn(entries, String(row.mmsi)));
  record(
    'C. a restart would keep what this session learned',
    known.length > 0,
    `${known.length} of ${rows.length} live contacts (${percent(known.length, rows.length)}) are already on disk`,
  );
}

// ── D. the declared share, right now ───────────────────────────────────────
const declared = rows.filter((row) => String(row.type || '').trim());
const families = new Map();
for (const row of rows) {
  const family = vesselTypeFamily(row.type) || 'unknown';
  families.set(family, (families.get(family) || 0) + 1);
}
const breakdown = [...families.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([family, count]) => `${VESSEL_FAMILY_LABELS[family] || family}: ${count}`)
  .join(' · ');
record(
  'D. contacts carrying a declared type (informational)',
  null,
  `${declared.length} of ${rows.length} (${percent(declared.length, rows.length)})`,
);
console.log(`      ${breakdown}`);

if (identities.length) {
  const text = JSON.stringify(document);
  record(
    'E. no voyage data was written to disk',
    !text.includes('"destination"'),
    'destination is true for one passage only, and is never persisted',
  );

  const now = Date.now();
  const expired = identities.filter(([, entry]) => !(now - Number(entry?.updatedAt) <= AIS_STATIC_TTL_MS));
  record(
    'F. the registry is bounded by its TTL and its cap',
    expired.length === 0 && identities.length <= AIS_STATIC_MAX_ENTRIES,
    `${expired.length} past the 30-day TTL, ${identities.length}/${AIS_STATIC_MAX_ENTRIES} of the cap`,
  );
}

const failed = results.filter((r) => r.ok === false).length;
const skipped = results.filter((r) => r.ok === null).length;
console.log(`\n  ${results.length - failed - skipped}/${results.length - skipped} checks passed`
  + `${skipped ? ` (${skipped} informational or not testable here)` : ''}\n`);
process.exit(failed ? 1 : 0);
