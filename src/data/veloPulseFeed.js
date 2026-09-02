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
 * own unit on the card and in the height. Two sites in two cities are never on
 * screen together — they are 390 km apart — so a shared absolute scale would
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
 * The hour-of-week slot for a moment, in LOCAL time.
 *
 * Local, never UTC: a typical week is a local phenomenon and the pack was built
 * from local wall-clock hours in both cities. Reading it back in UTC would
 * shift the whole picture by an hour or two depending on the season — which is
 * precisely the trap the build script documents for the Paris counters.
 *
 * @param {Date} [date]
 * @returns {number} 0..167
 */
export function slotForDate(date = new Date()) {
  const weekday = date.getDay();
  const isoDay = weekday === 0 ? 6 : weekday - 1;
  return isoDay * 24 + date.getHours();
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
 * The hour at which the networks are most IN USE — which is not the same
 * arithmetic for a stock as for a flow.
 *
 * THIS IS THE MEASUREMENT THAT ALMOST SHIPPED WRONG. Summing raw values and
 * taking the maximum is right for a flow: the busiest counter-hour is the hour
 * most cyclists went past. Applied to Lyon it produced **Wednesday 03:00**,
 * because a dock is at its fullest when nobody is riding. The stock is the
 * COMPLEMENT of the use: an empty dock is a bike out on the road.
 *
 * So a stock is inverted before it is summed, and each site is normalised
 * against its own weekly maximum first so a 40-stand station and a 15-stand one
 * count the same and a 900-cyclist counter does not drown a 40-cyclist one.
 * Each city is then divided by its own site count, so 450 Lyon stations and 111
 * Paris counters weigh equally.
 *
 * With that correction the two cities agree, through two different instruments:
 * Lyon's docks are emptiest and Paris' counters busiest on a weekday evening.
 * That agreement is the layer's argument, and it only appears once the stock is
 * read the right way round.
 *
 * @param {object} cities The pack's `cities` map, or one city's entry.
 * @returns {{slot: number, score: number}|null}
 */
export function networkBusiest(cities) {
  const entries = Array.isArray(cities?.sites) ? [cities] : Object.values(cities || {});
  const totals = new Array(PULSE_SLOTS).fill(0);
  let contributing = 0;
  for (const city of entries) {
    const sites = Array.isArray(city?.sites) ? city.sites : [];
    if (!sites.length) continue;
    const invert = city.instrument === 'stock';
    const cityTotals = new Array(PULSE_SLOTS).fill(0);
    let counted = 0;
    for (const site of sites) {
      const peak = sitePeak(site);
      if (!peak || peak.value <= 0) continue;
      counted += 1;
      for (let slot = 0; slot < PULSE_SLOTS; slot += 1) {
        const value = site.profile?.[slot];
        if (!Number.isFinite(value)) continue;
        const share = value / peak.value;
        cityTotals[slot] += invert ? 1 - share : share;
      }
    }
    if (!counted) continue;
    contributing += 1;
    for (let slot = 0; slot < PULSE_SLOTS; slot += 1) totals[slot] += cityTotals[slot] / counted;
  }
  if (!contributing) return null;
  let best = 0;
  for (let slot = 1; slot < PULSE_SLOTS; slot += 1) {
    if (totals[slot] > totals[best]) best = slot;
  }
  return { slot: best, score: Math.round(totals[best] * 1000) / 1000 };
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
 * The colour for one site at one slot.
 * @param {number|null} value
 * @param {number|null} peak
 * @returns {string}
 */
export function pulseColor(value, peak) {
  const band = pulseBand(value, peak);
  return band < 0 ? PULSE_UNSAMPLED_COLOR : PULSE_RAMP[band].color;
}

/**
 * How tall a site stands at one slot, in metres.
 *
 * THE HEIGHT IS THE ABSOLUTE QUANTITY, IN THAT CITY'S OWN UNIT — bikes standing
 * at a Vélo'v dock, cyclists counted in an hour at a Paris counter — and the
 * two are deliberately NOT reconciled onto one scale. What is reconciled is the
 * metres-per-unit constant, chosen so a busy site in either city reaches a
 * comparable height on screen: Lyon's docks hold at most a few dozen bikes and
 * Paris' counters see hundreds of cyclists an hour, so the same number of
 * metres per unit would draw Lyon as a flat plain beside a Paris skyline and
 * invite exactly the comparison this module refuses to make.
 *
 * @param {number|null} value The site's value at the slot, in its own unit.
 * @param {object} city The pack's city entry.
 * @param {object} site
 * @returns {number} Metres. 0 when there is nothing to draw.
 */
export function pulseHeightM(value, city, site) {
  if (!Number.isFinite(value)) return 0;
  if (city?.instrument === 'stock') {
    // Occupancy is a percentage; the count of bikes standing there is what the
    // eye should read, so it is reconstituted from the station's own capacity.
    const capacity = Number(site?.capacity);
    const bikes = Number.isFinite(capacity) && capacity > 0 ? (value / 100) * capacity : value / 5;
    return Math.max(4, bikes * PULSE_METRES_PER_BIKE);
  }
  return Math.max(4, value * PULSE_METRES_PER_CYCLIST);
}

/** 8 m per bike standing at a dock: a full 40-stand station reaches 320 m. */
export const PULSE_METRES_PER_BIKE = 8;
/** 0.9 m per cyclist an hour: a 350/h counter at rush hour reaches 315 m. */
export const PULSE_METRES_PER_CYCLIST = 0.9;

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
    return Number.isFinite(capacity) && capacity > 0
      ? `${percent} % pleine — environ ${Math.round((value / 100) * capacity)} vélos sur ${capacity}`
      : `${percent} % pleine`;
  }
  return `${Math.round(value)} cyclistes par heure`;
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
