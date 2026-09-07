#!/usr/bin/env node
/**
 * qa-chronicle — is the server actually keeping what it says it is keeping?
 *
 * The chronicle is the one thing in this repo whose failure is INVISIBLE. A
 * broken proxy draws an empty map and somebody notices within a minute; a
 * recorder that silently stops writing looks exactly like a recorder that is
 * working, and the cost is only discovered months later when the profile it
 * was supposed to have built turns out to be a week old. So the checks below
 * are deliberately about the FILES and the arithmetic, not about pixels.
 *
 *  A. EVERY DECLARED SOURCE IS ANSWERED FOR. The status endpoint names all
 *     five, and each carries a licence and an attribution — the two fields
 *     that decide whether an accumulated base may ever be exposed, and which
 *     are worthless if they are only in a comment.
 *
 *  B. THE RAW LOG IS ON DISK AND EVERY LINE OF IT READS BACK. One corrupt
 *     append poisons the thirty-day window that is supposed to be the escape
 *     hatch when an axis turns out to be wrong.
 *
 *  C. THE FOLD IS THE FOLD OF THE LOG. For every series in today's raw file,
 *     the profile's slot must hold at least as many samples as the log has
 *     ticks for it. A profile that has fallen behind its own log is the exact
 *     symptom of a debounce that stopped firing.
 *
 *  D. VIGICRUES REFUSES TO BE SCORED, AND SAYS WHY. It is the source that
 *     declares no typical week, and a `profile: false` that quietly returned
 *     an empty list would read as "nothing unusual on the rivers tonight".
 *
 *  E. NOTHING OLDER THAN THE RETENTION FLOOR SURVIVES, and nothing this
 *     module did not write is deleted.
 *
 *  F. AN UNKNOWN SOURCE IS REFUSED. The source id is a DIRECTORY NAME; a
 *     traversal that reached the filesystem would be the one security-shaped
 *     bug this feature can have.
 *
 * Run: node scripts/qa-chronicle.mjs --url http://localhost:5173
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  CHRONICLE_RETENTION_DAYS,
  chronicleDayOfFile,
  chronicleRetentionFloor,
  chronicleStamp,
  decodeChronicleTick,
} from '../src/data/chronicle.js';
import { CHRONICLE_SOURCES } from '../src/data/chronicleSources.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:5173');
/** How many series of one source check C walks. See the comment at its use. */
const PROFILE_SAMPLE = Number(option('--profile-sample', '20'));

/**
 * Endpoints hit first, to provoke a tick from the sources that only record
 * when someone is looking. A box over Provence, which is covered by both a
 * traffic-management centre and several transit networks.
 */
const PROVOKE = [
  '/api/vigicrues/status',
  '/api/road-status-fr/segments?south=43.0&west=4.0&north=46.0&east=7.0',
  '/api/transit-fr/vehicles?south=43.2&west=5.2&north=43.4&east=5.5',
];

const failures = [];
const notes = [];

function check(label, ok, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`;
  console.log(`[qa] ${line}`);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

async function getJson(route) {
  const response = await fetch(`${APP_URL}${route}`, { signal: AbortSignal.timeout(120_000) });
  const body = await response.text();
  // A 429 read as an empty answer would make every check below fail for a
  // reason that has nothing to do with the recorder. It is named instead.
  if (response.status === 429) notes.push(`rate-limited on ${route}`);
  try {
    return { status: response.status, body: JSON.parse(body) };
  } catch {
    return { status: response.status, body: null, raw: body.slice(0, 200) };
  }
}

/** Read one day file, gz or plain, as text. Returns null for a compacted day. */
async function readDay(dir, name) {
  if (name.endsWith('.gz')) return null; // compacted; C only inspects today
  return readFile(path.join(dir, name), 'utf8');
}

async function main() {
  console.log(`[qa] chronicle against ${APP_URL}`);
  for (const route of PROVOKE) {
    await fetch(`${APP_URL}${route}`, { signal: AbortSignal.timeout(120_000) })
      .catch((error) => notes.push(`could not provoke ${route}: ${error?.message || error}`));
  }

  const status = await getJson('/api/chronicle-fr/status');
  if (status.status !== 200 || !status.body) {
    console.error(`[qa] /api/chronicle-fr/status answered ${status.status}`);
    process.exitCode = 1;
    return;
  }
  const { body } = status;
  console.log(`[qa] recording ${body.enabled ? 'ENABLED' : 'DISABLED'}`
    + `, clock ${body.timeZone}, ${body.slots} slots, ${body.minWeeks} weeks before a slot may judge`);
  console.log(`[qa] irve-fr poller: ${body.irveDynamic?.armed ? 'armed' : 'not armed (CHRONICLE_IRVE_DYNAMIC)'}`);

  // ── A. every declared source is answered for, with its licence ────────────
  const answered = new Set((body.sources || []).map((source) => source.id));
  check(
    'A. the status names every declared source',
    CHRONICLE_SOURCES.every((source) => answered.has(source.id)),
    `${answered.size}/${CHRONICLE_SOURCES.length}`,
  );
  check(
    'A. and every one of them carries a licence and an attribution',
    (body.sources || []).every((source) => source.licence && source.attribution),
    (body.sources || []).filter((source) => !source.licence || !source.attribution)
      .map((source) => source.id).join(', ') || 'all present',
  );

  for (const source of body.sources || []) {
    const held = source.startedAt
      ? `since ${new Date(source.startedAt).toISOString().slice(0, 16)}`
      : 'nothing recorded yet';
    console.log(`[qa]   ${source.id.padEnd(15)} ${String(source.series).padStart(4)} series,`
      + ` ${String(source.rawDays).padStart(2)} raw day(s), ${(source.rawBytes / 1e6).toFixed(2)} MB,`
      + ` ${source.slotsJudgeable} judgeable slot(s) — ${held}`);
  }

  const root = body.root;
  let onDisk = true;
  await stat(root).catch(() => { onDisk = false; });
  if (!onDisk) {
    notes.push(`${root} is not reachable from here — B, C and E need a local server`);
  }

  const todayKey = chronicleStamp(Date.now())?.dayKey;
  for (const source of body.sources || []) {
    if (!onDisk || !source.rawDays) continue;
    const dir = path.join(root, source.id);
    const names = await readdir(dir).catch(() => []);

    // ── B. every line of today's log reads back ────────────────────────────
    const todayName = names.find((name) => chronicleDayOfFile(name) === todayKey && !name.endsWith('.gz'));
    /** @type {Map<string, Map<number, number>>} series -> slot -> tick count */
    const logged = new Map();
    if (todayName) {
      const text = await readDay(dir, todayName);
      const lines = String(text).split('\n').filter(Boolean);
      const decoded = lines.map(decodeChronicleTick);
      check(
        `B. ${source.id}: every line of today's raw log decodes`,
        decoded.every(Boolean),
        `${decoded.filter(Boolean).length}/${lines.length} lines`,
      );
      for (const tick of decoded) {
        if (!tick) continue;
        const slot = chronicleStamp(tick.at)?.slot;
        if (!Number.isInteger(slot)) continue;
        for (const key of Object.keys(tick.samples)) {
          const perSlot = logged.get(key) || new Map();
          perSlot.set(slot, (perSlot.get(slot) || 0) + 1);
          logged.set(key, perSlot);
        }
      }
    }

    // ── C. the fold has not fallen behind its own log ─────────────────────
    if (source.profile && logged.size) {
      const behind = [];
      // One request per series, so a source with a wide axis is SAMPLED rather
      // than walked: the invariant is per-series and holds on any subset, and
      // a 300-request harness against a read endpoint is rude for no gain.
      const sampled = [...logged].slice(0, PROFILE_SAMPLE);
      for (const [series, perSlot] of sampled) {
        const answer = await getJson(
          `/api/chronicle-fr/profile?source=${encodeURIComponent(source.id)}&series=${encodeURIComponent(series)}`,
        );
        const slots = new Map((answer.body?.slots || []).map((row) => [row.slot, row.samples]));
        for (const [slot, ticks] of perSlot) {
          if ((slots.get(slot) || 0) < ticks) behind.push(`${series}@${slot}`);
        }
      }
      check(
        `C. ${source.id}: the profile holds every tick its log recorded`,
        behind.length === 0,
        behind.length
          ? `${behind.length} series behind: ${behind.slice(0, 3).join(', ')}`
          : `${sampled.length} of ${logged.size} series checked`,
      );
    }

    // ── E. retention, and nothing else touched ────────────────────────────
    const floor = chronicleRetentionFloor(Date.now(), source.retentionDays);
    const stale = names.filter((name) => {
      const day = chronicleDayOfFile(name);
      return day && day < floor;
    });
    check(
      `E. ${source.id}: nothing older than the ${CHRONICLE_RETENTION_DAYS}-day floor survives`,
      stale.length === 0,
      stale.length ? stale.join(', ') : `floor ${floor}`,
    );
    check(
      `E. ${source.id}: the fold itself was not swept`,
      names.includes('profile.json'),
      names.filter((name) => !chronicleDayOfFile(name)).join(', ') || 'none',
    );
  }

  // ── D. the source that declares no typical week says so ──────────────────
  const vigicrues = await getJson('/api/chronicle-fr/anomalies?source=vigicrues');
  check(
    'D. Vigicrues refuses to be scored, and gives the reason',
    vigicrues.body?.profile === false && Boolean(vigicrues.body?.reason),
    vigicrues.body?.reason ? 'reason published' : 'no reason given',
  );

  // ── F. an unknown or traversing source is refused ────────────────────────
  const traversal = await getJson('/api/chronicle-fr/profile?source=..%2F..%2Fetc&series=x');
  const unknown = await getJson('/api/chronicle-fr/series?source=nope');
  check(
    'F. an unknown source is refused with the list of real ones',
    traversal.status === 400 && unknown.status === 400 && Array.isArray(unknown.body?.sources),
    `${traversal.status} / ${unknown.status}`,
  );
  if (onDisk) {
    const roots = await readdir(root).catch(() => []);
    const ids = new Set(CHRONICLE_SOURCES.map((source) => source.id));
    check(
      'F. and no directory outside the registry was created',
      roots.every((name) => ids.has(name)),
      roots.filter((name) => !ids.has(name)).join(', ') || `${roots.length} directories`,
    );
  }

  console.log('');
  for (const note of notes) console.log(`[qa] note: ${note}`);
  if (failures.length) {
    console.error(`[qa] ${failures.length} failure(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('[qa] chronicle: all checks passed');
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
