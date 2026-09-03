#!/usr/bin/env node
/**
 * qa-flights-type — phase 3a: "Type not reported", and what the adapter was
 * throwing away.
 *
 * OpenSky `/states/all` carries no ICAO type designator at all — only an
 * emitter category at index 17, which the 2026-07-02 field survey recorded as
 * `0`/"no info" for ~94 % of contacts (flights.js, the ambient-enrichment
 * comment). The type answer therefore arrived only through a rationed adsbdb
 * lookup (4 in flight, a 300-token bucket) that most of a busy region never
 * won. That much was known.
 *
 * What was NOT known is that the civil layer's fallback source already had the
 * answer in hand. adsb.lol publishes `t` (type designator) and `r` (tail) on
 * every record, and `adsbLolFallback.js` copied neither — it forwarded the
 * emitter category and dropped the two fields the classifier actually wants.
 *
 * So this harness measures the fallback path on LIVE upstream data, through
 * the shipped adapter, and counts. It does not look at pixels: there is no way
 * to force a browser session into fallback mode on demand, and the claim under
 * test is arithmetic anyway.
 *
 *  A. THE FIELDS ARE REALLY THERE. Share of contacts whose normalized vector
 *     carries a type designator at [18] and a tail at [19]. Measured
 *     2026-09-03 over Paris + Los Angeles, 1 447 contacts: 95.9 % and 96.8 %.
 *
 *  B. THE VECTOR SURVIVES THE PROXY. Indices 18/19 are a GEV extension past
 *     OpenSky's 18 entries, and the proxy JSON-stringifies the vector before
 *     the client reads it by index. Every row must be 20 long on both sides of
 *     a serialization round-trip — `undefined` would silently vanish.
 *
 *  C. THE CORRECTION IS MOSTLY NOT ABOUT `unknown`. This is the check worth
 *     reading. adsb.lol populates the emitter category far better than OpenSky
 *     does, so the placeholder silhouette was never the main damage here: the
 *     coarse category maps A2/A3 onto 'light'/'airliner', which drew business
 *     jets as narrow-bodies and turboprops as jets. Count the contacts whose
 *     class CHANGES once the designator is read, and separate the ones that
 *     were merely unclassified from the ones that were classified WRONG.
 *     Measured 2026-09-03: 282 of 1 447 changed (19.5 %), of which 244 were a
 *     wrong silhouette rather than a placeholder — 95 business jets drawn as
 *     narrow-bodies, 39 turboprops drawn as light aircraft.
 *
 *  D. THE PLACEHOLDER BUCKET STILL SHRINKS. Strictly fewer `unknown` contacts
 *     after than before. Measured 2026-09-03: 69 (4.8 %) -> 31 (2.1 %).
 *
 *  E. A TAIL IS NOT A CALLSIGN. The adapter used to fill the callsign slot with
 *     `r` when `flight` was blank, so `mapAnalystRecord` published a
 *     registration as a spoken callsign. For every contact that reports a tail
 *     and no callsign, vector[1] must now be null — the label chain does that
 *     fallback one layer up, where it knows which field it is reading.
 *
 *  F. THE LEGEND IS IN FRENCH. The other half of the phase. `unknown` must be
 *     worded exactly as the sea layers word it.
 *
 * NEEDS THE NETWORK: it calls api.adsb.lol directly, with the same URL, radius
 * and User-Agent the dev-server proxy uses. An unreachable upstream is reported
 * as "not testable here", not as a failure.
 *
 * Usage: node scripts/qa-flights-type.mjs
 */
import { normalizeAdsbLolPointResponse } from '../src/data/adsbLolFallback.js';
import { classifyAircraft, CLASS_LEGEND_LABELS } from '../src/data/aircraftClass.js';
import { VESSEL_FAMILY_LABELS } from '../src/data/vesselLabels.js';

/** Mirrors vite.config.js ADSBLOL_POINT_RADIUS_NM — the proxy's own radius. */
const RADIUS_NM = 250;
/** Two fleets that do not overlap and do not mix: a single busy region could
 *  flatter the numbers with one airline's homogeneous type list. */
const REGIONS = [
  { name: 'Paris', lat: 48.75, lon: 2.25 },
  { name: 'Los Angeles', lat: 34, lon: -118.25 },
];

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok === null ? '○' : (ok ? '✔' : '✖');
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** The emitter category the classifier would see with no designator at all —
 *  i.e. exactly what this layer had before the adapter carried `t`. */
function categoryOf(state) {
  return Number.isFinite(state[17]) ? state[17] : null;
}

async function fetchRegion({ lat, lon }) {
  const response = await fetch(
    `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${RADIUS_NM}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gods-eye-view-adsblol-regional-fallback/1.0',
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return response.json();
}

console.log(`\nqa-flights-type — adsb.lol, ${RADIUS_NM} nm, ${REGIONS.map((r) => r.name).join(' + ')}\n`);

const states = [];
const raw = [];
const unreachable = [];
for (const region of REGIONS) {
  try {
    const payload = await fetchRegion(region);
    const normalized = normalizeAdsbLolPointResponse(payload);
    states.push(...normalized.states);
    raw.push(...(Array.isArray(payload?.ac) ? payload.ac : []));
    console.log(`  · ${region.name}: ${normalized.states.length} contacts`);
  } catch (error) {
    unreachable.push(`${region.name}: ${error?.message || error}`);
  }
}
console.log('');

if (!states.length) {
  record('A..E. the fallback path', null, `adsb.lol unreachable — ${unreachable.join('; ')}`);
} else {
  // ── A. the fields are really there ───────────────────────────────────────
  const withType = states.filter((s) => s[18]).length;
  const withTail = states.filter((s) => s[19]).length;
  const typeShare = withType / states.length;
  record(
    'A. the vector carries a type designator and a tail',
    typeShare >= 0.8 && withTail / states.length >= 0.8,
    `type ${withType}/${states.length} (${(100 * typeShare).toFixed(1)} %), `
      + `tail ${withTail}/${states.length} (${(100 * withTail / states.length).toFixed(1)} %)`,
  );

  // ── B. the vector survives the proxy ─────────────────────────────────────
  const shortRows = states.filter((s) => s.length !== 20).length;
  const roundTripped = JSON.parse(JSON.stringify(states));
  const shrankInTransit = roundTripped.filter((s) => s.length !== 20).length;
  record(
    'B. every row is 20 long, before and after serialization',
    shortRows === 0 && shrankInTransit === 0,
    `${shortRows} short rows, ${shrankInTransit} shortened by JSON`,
  );

  // ── C. what the designator actually corrects ─────────────────────────────
  let changed = 0;
  let wrongBefore = 0;
  const moves = new Map();
  for (const state of states) {
    const category = categoryOf(state);
    const before = classifyAircraft({ typeCode: null, category });
    const after = classifyAircraft({ typeCode: state[18], category });
    if (before === after) continue;
    changed += 1;
    if (before !== 'unknown') wrongBefore += 1;
    const move = `${before} → ${after}`;
    moves.set(move, (moves.get(move) || 0) + 1);
  }
  const top = [...moves.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([move, n]) => `${move} ×${n}`).join(', ');
  record(
    'C. the designator reclassifies contacts the category got wrong',
    changed > 0 && wrongBefore > 0 && changed / states.length >= 0.05,
    `${changed}/${states.length} changed (${(100 * changed / states.length).toFixed(1)} %), `
      + `${wrongBefore} of them a WRONG class rather than a placeholder — ${top}`,
  );

  // ── D. the placeholder bucket shrinks ────────────────────────────────────
  const unknownBefore = states
    .filter((s) => classifyAircraft({ typeCode: null, category: categoryOf(s) }) === 'unknown').length;
  const unknownAfter = states
    .filter((s) => classifyAircraft({ typeCode: s[18], category: categoryOf(s) }) === 'unknown').length;
  record(
    'D. fewer contacts left on the placeholder silhouette',
    unknownAfter < unknownBefore,
    `${unknownBefore} (${(100 * unknownBefore / states.length).toFixed(1)} %) `
      + `→ ${unknownAfter} (${(100 * unknownAfter / states.length).toFixed(1)} %)`,
  );

  // ── E. a tail is not a callsign ──────────────────────────────────────────
  // Read from the RAW records, so the check knows which contacts were at risk
  // rather than trusting the adapter's own output to tell it.
  const tailOnly = raw.filter((a) => !String(a?.flight || '').trim() && String(a?.r || '').trim());
  const byHex = new Map(states.map((s) => [s[0], s]));
  const misnamed = tailOnly.filter((a) => {
    const state = byHex.get(String(a.hex || '').trim().toLowerCase());
    return state && state[1] !== null;
  });
  record(
    'E. a contact with a tail and no callsign reports no callsign',
    misnamed.length === 0,
    `${tailOnly.length} contacts at risk, ${misnamed.length} publishing a tail as a callsign`,
  );
}

// ── F. the legend is in French ─────────────────────────────────────────────
const stillEnglish = Object.entries(CLASS_LEGEND_LABELS)
  .filter(([, label]) => /^(Light aircraft|Glider|Turboprop|Narrow-body jet|Wide-body jet|Four-engine heavy|Helicopter|Fast jet|Business jet|Large UAV|Type not reported)$/.test(label));
record(
  'F. the legend reads in French, and matches the sea layers on "unknown"',
  stillEnglish.length === 0 && CLASS_LEGEND_LABELS.unknown === VESSEL_FAMILY_LABELS.unknown,
  stillEnglish.length
    ? `${stillEnglish.length} captions still in English`
    : `unknown reads "${CLASS_LEGEND_LABELS.unknown}", as the sea layers do`,
);

const failed = results.filter((r) => r.ok === false).length;
const skipped = results.filter((r) => r.ok === null).length;
console.log(`\n  ${results.length - failed - skipped}/${results.length - skipped} checks passed`
  + `${skipped ? ` (${skipped} not testable here)` : ''}\n`);
process.exit(failed ? 1 : 0);
