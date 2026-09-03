/**
 * Pouls vélo — reading a typical week, and refusing to compare two instruments
 * that do not measure the same thing.
 *
 * WHAT THE PACK CONTAINS. 168 numbers per site: one per hour of a typical week,
 * Monday 00:00 first, averaged over four weeks of June 2026. Two cities, two
 * instruments, and the asymmetry is not an accident of engineering — it is the
 * finding:
 *
 *   · **Lyon publishes an archive of Vélo'v dock availability** running
 *     continuously since 2023-03-27, filterable per station and per date. It is
 *     the only one of its kind in France.
 *   · **Paris publishes no equivalent for Vélib' at all.** Verified 2026-09-02
 *     against opendata.paris.fr (two datasets, both real-time), data.gouv.fr,
 *     transport.data.gouv.fr (the `history` array for the Vélib' dataset is
 *     empty) and the community archive everyone cites,
 *     `lovasoa/historique-velib-opendata`, last pushed 2023-04-04 with release
 *     assets dated 2021.
 *
 * So Paris is shown through its 111 permanent counters instead. Lyon measures
 * STOCKS — how full a dock is — and Paris measures FLOWS — how many cyclists go
 * past. Those are different quantities in different units and this module never
 * puts them on one scale.
 *
 * WHAT IS COMPARABLE, AND IT IS ONLY ONE THING: each site against ITSELF. The
 * colour ramp is the share of that site's own weekly maximum, so "this is a busy
 * hour here" reads the same in both cities while the absolute number keeps its
 * own unit on the card and in the blob's AREA. Two sites in two cities are never
 * on screen together — they are 390 km apart — so a shared absolute scale would
 * buy nothing and cost the truth.
 *
 * Dependency-free and side-effect-free.
 *
 * @module data/veloPulseFeed
 */

/** Hours in a week. Slot 0 is Monday 00:00, local time. */
export const PULSE_SLOTS = 168;

/** The days, as a French reader names them, for slot 0..167. */
export const PULSE_DAYS = Object.freeze([
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
]);

/**
 * The wall clock the pack is written in. Not the reader's.
 *
 * Both cities' profiles are averages over PARIS wall-clock hours — that is what
 * "Tuesday 08:00" means in the pack — so reading them back needs the same
 * clock. `Europe/Paris` also carries the DST rules, which is why a fixed +01:00
 * or +02:00 offset would be wrong for half the year.
 */
export const PULSE_TIMEZONE = 'Europe/Paris';

/** `Mon`..`Sun` to slot 0..6. */
const WEEKDAY_INDEX = Object.freeze({
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
});

/**
 * A formatter pinned to Paris, built once.
 *
 * Guarded, because a JS runtime built without the full time-zone database
 * throws on an IANA name. That is not a case worth crashing a layer over, so
 * the fallback below reads the host clock and the layer is no worse off than it
 * was — but the guard is here rather than an assumption that it cannot happen.
 */
const PARIS_CLOCK = (() => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: PULSE_TIMEZONE, weekday: 'short', hour: '2-digit', hourCycle: 'h23',
    });
  } catch {
    return null;
  }
})();

/**
 * The hour-of-week slot for a moment, ON PARIS TIME.
 *
 * THIS USED TO READ THE BROWSER'S CLOCK. `getDay()` and `getHours()` answer in
 * whatever zone the reader's computer is set to, so a reader in New York asking
 * for "MAINTENANT" at Paris Tuesday 08:00 was shown Tuesday 02:00 — a different
 * hour of a week they were not looking at, with every bike figure on screen
 * belonging to it. The comment above the old code said "local, never UTC" and
 * was true; it just meant the wrong local.
 *
 * A typical week is a local phenomenon OF THE CITY, and both cities are in one
 * zone, so there is exactly one right clock and it is not the reader's.
 *
 * @param {Date} [date]
 * @returns {number} 0..167
 */
export function slotForDate(date = new Date()) {
  const when = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(when.getTime())) return 0;
  if (!PARIS_CLOCK) {
    const weekday = when.getDay();
    return (weekday === 0 ? 6 : weekday - 1) * 24 + when.getHours();
  }
  let day = null;
  let hour = null;
  for (const part of PARIS_CLOCK.formatToParts(when)) {
    if (part.type === 'weekday') day = WEEKDAY_INDEX[part.value] ?? null;
    else if (part.type === 'hour') hour = Number(part.value);
  }
  if (day === null || !Number.isFinite(hour)) return 0;
  // `hourCycle: 'h23'` is asked for above; the modulo is the belt to its
  // braces, because some ICU builds still answer 24 for midnight.
  return day * 24 + (hour % 24);
}

/**
 * A slot, as a reader says it.
 * @param {number} slot
 * @returns {string}
 */
export function slotLabel(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PULSE_SLOTS) return '—';
  const day = PULSE_DAYS[Math.floor(slot / 24)];
  const hour = slot % 24;
  return `${day} ${String(hour).padStart(2, '0')}h`;
}

/**
 * Any position on the week's circle, brought back onto 0..167.
 *
 * The week is a LOOP — Sunday 23:00 is followed by Monday 00:00 — so the
 * animation, the scrubber and the keyboard all hand this module positions that
 * ran off one end, and a negative modulo in JavaScript stays negative.
 *
 * @param {number} position Hour-of-week, fractional and unbounded.
 * @returns {number} 0 <= wrapped < 168.
 */
export function wrapSlot(position) {
  if (!Number.isFinite(position)) return 0;
  return ((position % PULSE_SLOTS) + PULSE_SLOTS) % PULSE_SLOTS;
}

/**
 * The value a site carries at a slot, or null when it was never sampled there.
 *
 * `scale` divides: Lyon stores occupancy in tenths of a percent so the pack
 * holds integers. A missing slot is null and stays null — filling it with a
 * neighbour would invent an hour the archive does not describe.
 *
 * @param {object} site
 * @param {number} slot
 * @param {number} [scale]
 * @returns {number|null}
 */
export function valueAt(site, slot, scale = 1) {
  const raw = site?.profile?.[slot];
  if (!Number.isFinite(raw)) return null;
  return scale > 1 ? raw / (scale / 100) : raw;
}

/**
 * The value to DRAW at a fractional position in the week — which is a
 * transition, and never a measurement.
 *
 * The animation used to jump from one whole hour to the next every 220 ms, so
 * 561 sites changed colour together, 168 times in 37 seconds. That is a strobe,
 * not a pulse, and it is the reason nobody could tell what was moving. The
 * clock now runs between the hours and this is what it reads: the hour we are
 * IN, eased toward the hour we are heading for.
 *
 * The two rules that keep it honest:
 *
 *   · The hour we are IN decides everything. If it holds no reading, the site
 *     is unsampled and stays grey — a neighbour's number is not an answer for
 *     an hour the archive never described.
 *   · A hole AHEAD is held, not faded into. Easing toward a missing hour would
 *     draw a station emptying when what actually happened is that nobody
 *     looked.
 *
 * Every NUMBER a card prints is read at the whole hour with `valueAt`. This
 * function only ever decides a colour and a diameter.
 *
 * @param {object} site
 * @param {number} position Fractional hour-of-week.
 * @param {number} [scale]
 * @returns {number|null}
 */
export function valueAtFraction(site, position, scale = 1) {
  const wrapped = wrapSlot(position);
  const slot = Math.floor(wrapped);
  const here = valueAt(site, slot, scale);
  if (here === null) return null;
  const next = valueAt(site, (slot + 1) % PULSE_SLOTS, scale);
  if (next === null) return here;
  return here + (next - here) * (wrapped - slot);
}

/**
 * A site's own weekly peak, and the slot it falls in.
 *
 * Computed rather than stored: it is one pass over 168 numbers and storing it
 * would be a second copy of the same fact, free to drift.
 *
 * @param {object} site
 * @returns {{value: number, slot: number}|null}
 */
export function sitePeak(site) {
  const profile = site?.profile;
  if (!Array.isArray(profile)) return null;
  let best = null;
  for (let slot = 0; slot < profile.length; slot += 1) {
    const value = profile[slot];
    if (!Number.isFinite(value)) continue;
    if (!best || value > best.value) best = { value, slot };
  }
  return best;
}

/**
 * How much of a city has to have reported at an hour for that hour to be
 * comparable with the others.
 *
 * Half. Measured on the shipped pack, Lyon's worst-sampled slot still carries
 * 70,2 % of its 450 stations and Paris' 111 counters are complete, so this
 * disqualifies nothing today — it is the guard against the archive outage that
 * would otherwise hand "POINTE" to whichever hour happened to be measured.
 */
export const PULSE_MIN_COVERAGE = 0.5;

/**
 * The hour at which the networks are most IN USE — which is not the same
 * arithmetic for a stock as for a flow.
 *
 * THIS IS THE MEASUREMENT THAT ALMOST SHIPPED WRONG. Summing raw values and
 * taking the maximum is right for a flow: the busiest counter-hour is the hour
 * most cyclists went past. Applied to Lyon it produced **Wednesday 03:00**,
 * because a dock is at its fullest when nobody is riding. The stock is the
 * COMPLEMENT of the use: an empty dock is a bike out on the road.
 *
 * So a stock is inverted before it is summed — against the dock's OWN CAPACITY,
 * which is what "full" means for a stock, and never against the highest filling
 * that station happened to reach. A flow has no natural full scale, so a flow
 * IS normalised against its own weekly maximum, which is what keeps a
 * 900-cyclist counter from drowning a 40-cyclist one. Each city is then divided
 * by the number of sites that ACTUALLY REPORTED at that hour, so 450 Lyon
 * stations and 111 Paris counters weigh equally and an outage reads as an
 * outage rather than as a quiet hour.
 *
 * With that correction the two cities agree, through two different instruments:
 * Lyon's docks are emptiest and Paris' counters busiest on a weekday evening.
 * That agreement is the layer's argument, and it only appears once the stock is
 * read the right way round.
 *
 * SPLIT OUT OF `networkBusiest` — which is now three lines around it — because
 * the busiest hour is only ever the ARGMAX of this curve, and the curve itself
 * is what the timeline under the globe draws. Two copies of this arithmetic
 * would be two chances for the strip to disagree with the hour POINTE freezes
 * on, in a layer whose entire claim is that hour.
 *
 * @param {object} cities The pack's `cities` map, or one city's entry.
 * @returns {{totals: number[], eligible: boolean[], coverage: number[],
 *   contributing: number}} 168 entries each.
 */
export function networkActivity(cities) {
  const entries = Array.isArray(cities?.sites) ? [cities] : Object.values(cities || {});
  const totals = new Array(PULSE_SLOTS).fill(0);
  // A slot is comparable only if every contributing city was well enough
  // sampled there. See `PULSE_MIN_COVERAGE`.
  const eligible = new Array(PULSE_SLOTS).fill(true);
  const coverage = new Array(PULSE_SLOTS).fill(1);
  let contributing = 0;
  for (const city of entries) {
    const sites = Array.isArray(city?.sites) ? city.sites : [];
    if (!sites.length) continue;
    const invert = city.instrument === 'stock';
    // Full is 100 % of the dock, in whatever units the pack stores it: Lyon
    // keeps occupancy in tenths of a percent so `scale` is 1 000.
    const fullScale = Number.isFinite(city.scale) && city.scale > 0 ? city.scale : 100;
    const cityTotals = new Array(PULSE_SLOTS).fill(0);
    const citySamples = new Array(PULSE_SLOTS).fill(0);
    let counted = 0;
    for (const site of sites) {
      const peak = sitePeak(site);
      // A stock only needs A reading to be usable; a flow needs a positive peak
      // to divide by. Requiring a positive peak of a stock would drop exactly
      // the stations that are always empty — which under the inversion are the
      // most used ones there are.
      if (!peak || (!invert && peak.value <= 0)) continue;
      counted += 1;
      for (let slot = 0; slot < PULSE_SLOTS; slot += 1) {
        const value = site.profile?.[slot];
        if (!Number.isFinite(value)) continue;
        const share = invert
          // Against the DOCK'S OWN CAPACITY, never its observed maximum. A
          // station whose weekly high is 38,8 % full — Gorge de Loup, in the
          // shipped pack — scored zero activity at that hour under the old
          // normalisation, while 61,2 % of its bikes were out on the road. Three
          // Lyon stations never pass 50 % and 49 never pass 80 %, so the bias
          // was not a corner case.
          ? Math.min(1, Math.max(0, 1 - (value / fullScale)))
          : value / peak.value;
        cityTotals[slot] += share;
        citySamples[slot] += 1;
      }
    }
    if (!counted) continue;
    contributing += 1;
    const floor = Math.max(1, Math.ceil(counted * PULSE_MIN_COVERAGE));
    for (let slot = 0; slot < PULSE_SLOTS; slot += 1) {
      // DIVIDE BY WHAT ANSWERED, NOT BY WHAT EXISTS. The old code divided every
      // slot by the whole site count, so an archive outage during Monday rush
      // hour looked exactly like a quiet Monday: the missing stations added
      // nothing to the numerator and stayed in the denominator, and sample
      // coverage rather than cycling could pick the busiest hour.
      if (citySamples[slot] < floor) {
        eligible[slot] = false;
        continue;
      }
      totals[slot] += cityTotals[slot] / citySamples[slot];
      const share = citySamples[slot] / counted;
      if (share < coverage[slot]) coverage[slot] = share;
    }
  }
  return { totals, eligible, coverage, contributing };
}

/**
 * The busiest hour of the week: the argmax of {@link networkActivity}.
 *
 * @param {object} cities The pack's `cities` map, or one city's entry.
 * @returns {{slot: number, score: number, coverage: number}|null}
 */
export function networkBusiest(cities) {
  const { totals, eligible, coverage, contributing } = networkActivity(cities);
  if (!contributing) return null;
  let best = -1;
  for (let slot = 0; slot < PULSE_SLOTS; slot += 1) {
    if (!eligible[slot]) continue;
    if (best < 0 || totals[slot] > totals[best]) best = slot;
  }
  // Every slot under-sampled in some city means there is no hour the pack can
  // honestly call the busiest. Null, not slot 0.
  if (best < 0) return null;
  return {
    slot: best,
    score: Math.round(totals[best] * 1000) / 1000,
    coverage: Math.round(coverage[best] * 1000) / 1000,
  };
}

/**
 * The week's own shape, 0..1, for the strip the reader scrubs.
 *
 * WHY THE ANIMATION NEEDED THIS. Watching 561 sites change colour tells you
 * something is happening and never what: the two commuter peaks, the flat
 * night, the different weekend are all facts about the NETWORK, and no single
 * site carries them. The strip draws exactly the quantity POINTE freezes on —
 * one bar per hour, the whole week at once — so the animation stops being a
 * shimmer and becomes a position in a curve the reader can see the rest of.
 *
 * Ineligible hours (see `PULSE_MIN_COVERAGE`) come back as `null`, not as 0: a
 * bar of zero height would read as an hour nobody cycled.
 *
 * @param {object} cities The pack's `cities` map.
 * @returns {{values: Array<number|null>, peakSlot: number|null,
 *   quietSlot: number|null}|null} Null when nothing contributed.
 */
export function networkCurve(cities) {
  const { totals, eligible, contributing } = networkActivity(cities);
  if (!contributing) return null;
  let max = 0;
  for (let slot = 0; slot < PULSE_SLOTS; slot += 1) {
    if (eligible[slot] && totals[slot] > max) max = totals[slot];
  }
  if (max <= 0) return null;
  const values = new Array(PULSE_SLOTS).fill(null);
  let peakSlot = null;
  let quietSlot = null;
  for (let slot = 0; slot < PULSE_SLOTS; slot += 1) {
    if (!eligible[slot]) continue;
    values[slot] = totals[slot] / max;
    if (peakSlot === null || values[slot] > values[peakSlot]) peakSlot = slot;
    if (quietSlot === null || values[slot] < values[quietSlot]) quietSlot = slot;
  }
  return { values, peakSlot, quietSlot };
}

/**
 * Where one hour sits between the week's quietest and its busiest, 0..1.
 *
 * The curve's own floor is high — a Vélo'v dock is never 100 % empty and a
 * counter is never at zero all night, so the raw week runs about 0.35..1.00 —
 * and read raw it would say "busy" at four in the morning. Stretching it onto
 * its OWN observed span is what makes both the strip and the words describe the
 * variation rather than the offset.
 *
 * @param {number} slot 0..167.
 * @param {{values: Array<number|null>, quietSlot: number|null}|null} curve
 * @returns {number|null} Null when that hour was not comparable.
 */
export function pulseRelief(slot, curve) {
  const index = Number.isFinite(slot) ? Math.floor(wrapSlot(slot)) : 0;
  const value = curve?.values?.[index];
  if (!Number.isFinite(value)) return null;
  const floor = curve.quietSlot === null ? 0 : (curve.values[curve.quietSlot] ?? 0);
  const span = 1 - floor;
  return span > 0 ? Math.min(1, Math.max(0, (value - floor) / span)) : 0;
}

/**
 * What the network is DOING at one hour, in four words.
 *
 * The strip shows where the hour sits in the week; this says it out loud, so a
 * reader who has just pressed play is told "pointe du soir" rather than being
 * left to infer it from a moving cursor. Both read the same stretched curve —
 * see {@link pulseRelief} — so the words and the bars can never disagree.
 *
 * @param {number} slot 0..167.
 * @param {{values: Array<number|null>}|null} curve From {@link networkCurve}.
 * @returns {string}
 */
export function pulsePhrase(slot, curve) {
  const index = Number.isFinite(slot) ? Math.floor(wrapSlot(slot)) : 0;
  const relief = pulseRelief(index, curve);
  const weekend = Math.floor(index / 24) >= 5;
  if (relief === null) return weekend ? 'week-end' : 'heure non relevée';
  const hour = index % 24;
  if (relief >= 0.85) return weekend ? 'pointe du week-end' : 'pointe';
  if (relief >= 0.6) return hour < 12 ? 'matinée chargée' : 'fin de journée chargée';
  if (relief >= 0.35) return weekend ? 'week-end, rythme moyen' : 'rythme moyen';
  if (relief >= 0.15) return hour >= 21 || hour < 5 ? 'la ville se vide' : 'réseau calme';
  return 'la nuit — presque personne ne roule';
}

/**
 * The five bands, as a share of the site's OWN weekly maximum.
 *
 * Labelled by the share and not by a word like "pointe", because the word would
 * be false for half the pack: a Vélo'v station at its weekly maximum is at its
 * FULLEST, which is the middle of the night, while a Paris counter at its
 * maximum is at its busiest. The share is the same quantity in both cities; a
 * word describing activity is not. The card says what a high share means for
 * that particular instrument, in that instrument's own words.
 */
export const PULSE_RAMP = Object.freeze([
  Object.freeze({ upTo: 0.2, color: '#2c3e6b', label: '< 20 %' }),
  Object.freeze({ upTo: 0.4, color: '#3b7bb5', label: '20 – 40 %' }),
  Object.freeze({ upTo: 0.6, color: '#49b3b0', label: '40 – 60 %' }),
  Object.freeze({ upTo: 0.8, color: '#f0c04a', label: '60 – 80 %' }),
  Object.freeze({ upTo: Infinity, color: '#e8603c', label: '≥ 80 %' }),
]);

/** No sample at this slot. Grey, and never the bottom band. */
export const PULSE_UNSAMPLED_COLOR = '#4a5568';

/**
 * The band a value falls in, against the site's own peak.
 * @param {number|null} value
 * @param {number|null} peak
 * @returns {number} 0..4, or -1 when there is nothing to band.
 */
export function pulseBand(value, peak) {
  if (!Number.isFinite(value) || !Number.isFinite(peak) || peak <= 0) return -1;
  const share = value / peak;
  for (let index = 0; index < PULSE_RAMP.length; index += 1) {
    if (share <= PULSE_RAMP[index].upTo) return index;
  }
  return PULSE_RAMP.length - 1;
}

/**
 * The BAND colour for one site at one slot — what the legend counts.
 * @param {number|null} value
 * @param {number|null} peak
 * @returns {string}
 */
export function pulseColor(value, peak) {
  const band = pulseBand(value, peak);
  return band < 0 ? PULSE_UNSAMPLED_COLOR : PULSE_RAMP[band].color;
}

/** `#rrggbb` → `{r, g, b}`, 0..255. */
function hexChannels(hex) {
  const value = Number.parseInt(String(hex).replace('#', ''), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** The share each ramp colour is the exact colour OF — the band's midpoint. */
const RAMP_ANCHORS = PULSE_RAMP.map((entry, index) => ({
  at: index === 0
    ? 0
    : (index === PULSE_RAMP.length - 1
      ? 1
      : (PULSE_RAMP[index - 1].upTo + entry.upTo) / 2),
  ...hexChannels(entry.color),
}));

const UNSAMPLED_CHANNELS = Object.freeze(hexChannels(PULSE_UNSAMPLED_COLOR));

/**
 * The colour the HEAT FIELD paints, interpolated along the same five anchors.
 *
 * The bands are the vocabulary — the legend counts sites in them, and the
 * reader is told "≥ 80 %" in words — but five hard steps are the wrong thing to
 * ANIMATE: a site drifting across a threshold snapped between two colours, and
 * 561 sites snapping at 168 different moments is the flicker the columns had.
 * Interpolating between the same anchors keeps every band's colour exactly
 * where the legend says it is and fills the gaps between them, so an hour of
 * the week reads as a swell rather than a switch.
 *
 * Channels rather than a string, because the animation asks 561 times a frame
 * and parsing `rgb(…)` back out at 25 Hz is work with nothing to show for it.
 *
 * @param {number|null} share 0..1, a site's value over its own weekly maximum.
 * @returns {{r: number, g: number, b: number}} 0..255 each.
 */
export function pulseRampRgb(share) {
  if (!Number.isFinite(share)) return UNSAMPLED_CHANNELS;
  const clamped = Math.min(1, Math.max(0, share));
  let low = RAMP_ANCHORS[0];
  let high = RAMP_ANCHORS[RAMP_ANCHORS.length - 1];
  for (let index = 0; index < RAMP_ANCHORS.length - 1; index += 1) {
    if (clamped >= RAMP_ANCHORS[index].at && clamped <= RAMP_ANCHORS[index + 1].at) {
      low = RAMP_ANCHORS[index];
      high = RAMP_ANCHORS[index + 1];
      break;
    }
  }
  const span = high.at - low.at;
  const t = span > 0 ? (clamped - low.at) / span : 0;
  const mix = (a, b) => Math.round(a + (b - a) * t);
  return { r: mix(low.r, high.r), g: mix(low.g, high.g), b: mix(low.b, high.b) };
}

/**
 * The same colour, as CSS, for the swatches and strips the DOM draws.
 * @param {number|null} share
 * @returns {string} `rgb(r, g, b)`.
 */
export function pulseRampColor(share) {
  const { r, g, b } = pulseRampRgb(share);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The ground RADIUS of a site's blob, in metres.
 *
 * THE COLUMNS ARE GONE, AND THIS IS WHERE THEIR CHANNEL WENT. Extruded squares
 * put the absolute quantity in a HEIGHT, which meant 561 floating cubes over a
 * city, one hiding the next, unreadable at nadir and unreadable from far
 * enough away to see both cities' shape. The layer now draws a heat field on
 * the ground, and the absolute quantity is the blob's AREA — the standard
 * proportional-symbol encoding, where twice the area means twice the quantity
 * and a reader comparing two discs is not misled by the fourth power a
 * radius-proportional symbol would give them.
 *
 * Area ∝ quantity means radius ∝ √quantity, and the two constants keep each
 * city in its OWN unit while landing a busy site in either city at a comparable
 * size: a full 40-stand Vélo'v dock and a 350-cyclist Paris rush hour both come
 * out near 150 m. Lyon's docks hold dozens and Paris' counters see hundreds, so
 * one shared constant would draw Lyon as a scatter of dots beside a Paris of
 * craters and invite exactly the comparison this module refuses to make.
 *
 * @param {number|null} value The site's value at the slot, in its own unit.
 * @param {object} city The pack's city entry.
 * @param {object} site
 * @returns {number} Metres. 0 when there is nothing to draw.
 */
export function pulseRadiusM(value, city, site) {
  if (!Number.isFinite(value)) return 0;
  if (city?.instrument === 'stock') {
    // Occupancy is a percentage; the count of bikes standing there is what the
    // eye should read, so it is reconstituted from the station's own capacity.
    const capacity = Number(site?.capacity);
    const bikes = Number.isFinite(capacity) && capacity > 0 ? (value / 100) * capacity : value / 5;
    return Math.max(PULSE_RADIUS_FLOOR_M, Math.sqrt(Math.max(0, bikes)) * PULSE_RADIUS_M_PER_ROOT_BIKE);
  }
  return Math.max(
    PULSE_RADIUS_FLOOR_M,
    Math.sqrt(Math.max(0, value)) * PULSE_RADIUS_M_PER_ROOT_CYCLIST,
  );
}

/** 24 m per √bike: a full 40-stand dock draws a 152 m blob. */
export const PULSE_RADIUS_M_PER_ROOT_BIKE = 24;
/** 7.6 m per √cyclist: a 350/h counter at rush hour draws a 142 m blob. */
export const PULSE_RADIUS_M_PER_ROOT_CYCLIST = 7.6;
/**
 * The smallest blob drawn. An empty dock at 04:00 is a MEASUREMENT — the bikes
 * are out on the road — so it keeps a mark on the map and stays clickable
 * instead of disappearing into the hours where nobody looked.
 */
export const PULSE_RADIUS_FLOOR_M = 20;

/**
 * The number a card prints, with its unit attached.
 * @param {number|null} value
 * @param {object} city
 * @param {object} site
 * @returns {string}
 */
export function pulseReading(value, city, site) {
  if (!Number.isFinite(value)) return 'non échantillonné à cette heure';
  if (city?.instrument === 'stock') {
    const capacity = Number(site?.capacity);
    const percent = Math.round(value);
    if (!Number.isFinite(capacity) || capacity <= 0) return `${percent} % pleine`;
    const bikes = Math.round((value / 100) * capacity);
    // A 19-stand dock at 7 % holds ONE bike, and the fiche under the globe
    // prints this line every hour of the week: "1 vélos" reads as a bug in the
    // number rather than as a plural nobody bothered with.
    return `${percent} % pleine — environ ${bikes} vélo${bikes > 1 ? 's' : ''} sur ${capacity}`;
  }
  return `${Math.round(value)} cyclistes par heure`;
}

/**
 * Everything a reader is told about ONE site at ONE hour, in order.
 *
 * Written once and read twice — by the card anchored on the map and by the
 * panel under the globe — because those two are the same claim about the same
 * dock, and the panel exists precisely because the anchored card can be off
 * screen. Two builders would eventually print two different numbers for one
 * station, and a reader who saw both would be right to trust neither.
 *
 * THE VALUE IS READ AT THE WHOLE HOUR. The animation runs between the hours
 * (see {@link valueAtFraction}) and that easing is a drawing decision; a
 * printed number belongs to a measured hour or to no hour at all.
 *
 * @param {{site: object, city: object}} record
 * @param {object|null} pack The whole pack, for the window it covers.
 * @param {number} slot 0..167.
 * @returns {string[]}
 */
export function pulseSiteDetails(record, pack, slot) {
  const site = record?.site;
  const city = record?.city;
  if (!site || !city) return [];
  const scale = Number(city.scale) || 1;
  const value = valueAt(site, slot, scale);
  const peakRaw = sitePeak(site);
  const peak = peakRaw ? (scale > 1 ? peakRaw.value / (scale / 100) : peakRaw.value) : null;
  const details = [];
  details.push(`${slotLabel(slot)} — ${pulseReading(value, city, site)}`);
  details.push(city.instrument === 'stock'
    ? 'Mesure un STOCK : combien de vélos sont garés là'
    : 'Mesure un FLUX : combien de cyclistes passent là');
  if (peak !== null && peakRaw) {
    // MAXIMUM, not "pointe": a Vélo'v station is at its maximum when it is
    // fullest, which is the middle of the night, and calling that a peak of
    // activity would be exactly backwards. The next line says which it is.
    details.push(`Maximum de la semaine ${slotLabel(peakRaw.slot)} — ${pulseReading(peak, city, site)}`);
    details.push(city.instrument === 'stock'
      ? 'Une station pleine = des vélos garés ; une station vide = des vélos sur la route'
      : 'Un compteur élevé = des cyclistes qui passent en ce moment');
  }
  const samples = site.samples?.[slot];
  details.push(Number.isFinite(samples) && samples > 0
    ? `Moyenne de ${samples} semaine${samples > 1 ? 's' : ''} sur les 4 relevées`
    : 'Aucun relevé à cette heure de la semaine');
  if (site.commune) details.push(site.commune);
  if (site.direction) details.push(`Sens ${site.direction}`);
  if (site.installedOn) details.push(`Compteur installé le ${site.installedOn}`);
  if (city.instrument === 'stock' && Number.isFinite(site.capacity)) {
    details.push(`${site.capacity} bornettes`);
  }
  details.push(`Semaine type ${pack?.window?.start} → ${pack?.window?.end}`);
  details.push(city.source);
  return details;
}

/**
 * Validate a pack enough to refuse a broken one loudly.
 * @param {object|null} pack
 * @returns {{ok: boolean, reason: string|null}}
 */
export function validatePack(pack) {
  if (!pack || typeof pack !== 'object') return { ok: false, reason: 'pack absent' };
  if (pack.slots !== PULSE_SLOTS) return { ok: false, reason: `slots ${pack.slots}` };
  const cities = pack.cities && typeof pack.cities === 'object' ? pack.cities : null;
  if (!cities) return { ok: false, reason: 'no cities' };
  for (const [key, city] of Object.entries(cities)) {
    if (!Array.isArray(city?.sites) || !city.sites.length) {
      return { ok: false, reason: `${key} has no sites` };
    }
    if (!['stock', 'flow'].includes(city.instrument)) {
      return { ok: false, reason: `${key} instrument ${city.instrument}` };
    }
    for (const site of city.sites) {
      if (!Array.isArray(site.profile) || site.profile.length !== PULSE_SLOTS) {
        return { ok: false, reason: `${key}/${site.id} profile length` };
      }
    }
  }
  return { ok: true, reason: null };
}

/**
 * What the whole pack adds up to, for the row.
 * @param {object|null} pack
 * @returns {object}
 */
export function summarizePack(pack) {
  const cities = pack?.cities || {};
  const out = { sites: 0, cities: 0, window: pack?.window ?? null, byCity: {} };
  for (const [key, city] of Object.entries(cities)) {
    const sites = Array.isArray(city.sites) ? city.sites : [];
    const peak = networkBusiest(city);
    out.cities += 1;
    out.sites += sites.length;
    out.byCity[key] = {
      label: city.label,
      instrument: city.instrument,
      unit: city.unit,
      sites: sites.length,
      peakSlot: peak?.slot ?? null,
      peakLabel: peak ? slotLabel(peak.slot) : null,
    };
  }
  return out;
}
