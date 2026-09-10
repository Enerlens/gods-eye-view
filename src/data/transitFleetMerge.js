/**
 * @module transitFleetMerge
 *
 * One bus, one glyph — when two French feeds publish the same bus.
 *
 * WHAT WENT WRONG. `panFeeds.js` already refuses a slot to a feed that is a
 * confirmed duplicate of another, and `build-pan-gtfs-rt-index.mjs` confirms
 * that verdict by comparing ROSTERS: two resources are one feed when they
 * report the same fleet. That test is right and it is also blind to the case
 * measured on 2026-09-10 over Seine-Eure — a feed that is a strict SUBSET of
 * another. `Semo Bus` (pan-83285, 19 vehicles) publishes the same runs as the
 * `Atoumod` Normandy aggregate (pan-82296, 239 vehicles): same `trip_id`, same
 * coordinates to the metre, same timestamps, only the id prefix differs. The
 * rosters are not equal, so neither feed is a duplicate — and every bus around
 * Val-de-Reuil, Louviers and Pont-de-l'Arche was drawn TWICE, one glyph exactly
 * behind the other, with the layer's vehicle count reporting double.
 *
 * THE KEY IS THE RUN, NOT THE VEHICLE. Two position records that name the same
 * `trip_id` are the same bus: a GTFS trip is one scheduled run, served by one
 * vehicle at a time. That is stronger evidence than coordinates — it survives
 * two feeds refreshing seconds apart, which is exactly when a distance test
 * would stop matching them.
 *
 * WHICH ONE SURVIVES. The feed whose id sorts first, always, so a vehicle keeps
 * the same identity from one poll to the next: a winner chosen by freshness
 * would hand the glyph a new id every time the two publishers overtook each
 * other, and the layer would destroy and rebuild the billboard — losing the
 * glide, and losing the selection of anyone who had clicked it. The POSITION,
 * though, is taken from whichever record is freshest, because these are two
 * messages from one publisher about one run and there is no reason to draw the
 * older of them. The survivor says how many feeds it stood for.
 *
 * Pure and dependency-free, so it runs in the dev-server proxy and under
 * `node --test` alike.
 */

/**
 * Shortest `trip_id` this module will treat as an identity.
 *
 * French trip ids are NeTEx-shaped and long (`ATOUMOD006:ServiceJourney:…`).
 * The floor is there so a network that publishes `1`, `2`, `3` cannot make two
 * unrelated buses on two unrelated networks collapse into one.
 */
export const MERGE_MIN_TRIP_ID_LENGTH = 6;

/** Fields taken from the freshest record in a group. */
const POSITION_FIELDS = ['lat', 'lon', 'bearing', 'speedMps', 'timestampMs', 'status', 'stopId', 'stopSequence'];

/**
 * The identity two records must share to be the same bus, or null when this
 * record cannot be spoken for.
 *
 * @param {Object} vehicle Wire vehicle record.
 * @returns {?string}
 */
export function fleetMergeKey(vehicle) {
  const tripId = typeof vehicle?.tripId === 'string' ? vehicle.tripId.trim() : '';
  if (tripId.length < MERGE_MIN_TRIP_ID_LENGTH) return null;
  return tripId;
}

/**
 * Collapse the same run published by several feeds into one vehicle.
 *
 * Order is preserved: the survivor sits where the first of its group sat, so a
 * viewport answer does not reshuffle between polls.
 *
 * @param {Array<Object>} vehicles Wire vehicle records, from any number of feeds.
 * @returns {{vehicles: Array<Object>, merged: number, mergedByFeed: Object}}
 *   `merged` counts the records that were dropped, and `mergedByFeed` says
 *   which feed each dropped record came from — the number a viewport answer
 *   reports so this stays visible rather than becoming quiet magic.
 */
export function mergeDuplicateRuns(vehicles) {
  const list = Array.isArray(vehicles) ? vehicles : [];
  const byKey = new Map();
  const order = [];
  const mergedByFeed = {};
  let merged = 0;

  for (const vehicle of list) {
    const key = fleetMergeKey(vehicle);
    if (key === null) {
      order.push({ single: vehicle });
      continue;
    }
    const group = byKey.get(key);
    if (!group) {
      const created = { members: [vehicle] };
      byKey.set(key, created);
      order.push(created);
      continue;
    }
    // A feed that repeated one run inside its OWN body is not two buses
    // either — the Normandy aggregate does it about ten times per message.
    group.members.push(vehicle);
    merged += 1;
  }

  const out = [];
  for (const entry of order) {
    if (entry.single) {
      out.push(entry.single);
      continue;
    }
    const members = entry.members;
    if (members.length === 1) {
      out.push(members[0]);
      continue;
    }
    const winner = pickSurvivor(members);
    const freshest = pickFreshest(members);
    const feeds = new Set();
    for (const member of members) {
      if (member.feed) feeds.add(member.feed);
      if (member !== winner && member.feed) {
        mergedByFeed[member.feed] = (mergedByFeed[member.feed] || 0) + 1;
      }
    }
    const record = { ...winner };
    if (freshest !== winner) {
      for (const field of POSITION_FIELDS) {
        if (Object.hasOwn(freshest, field)) record[field] = freshest[field];
        else delete record[field];
      }
      record.positionFeed = freshest.feed;
    }
    // Said out loud on the wire: this contact stood for more than one feed.
    if (feeds.size > 1) record.mergedFeeds = feeds.size;
    out.push(record);
  }

  return { vehicles: out, merged, mergedByFeed };
}

/**
 * The record that keeps its identity: lowest feed id, then lowest vehicle id.
 *
 * Deliberately independent of anything that changes between polls.
 */
function pickSurvivor(members) {
  let best = members[0];
  for (const member of members) {
    const feedOrder = String(member.feed || '').localeCompare(String(best.feed || ''));
    if (feedOrder < 0 || (feedOrder === 0 && String(member.id || '') < String(best.id || ''))) {
      best = member;
    }
  }
  return best;
}

/** The record with the newest fix; ties keep the earlier member. */
function pickFreshest(members) {
  let best = members[0];
  for (const member of members) {
    const a = Number.isFinite(member.timestampMs) ? member.timestampMs : -Infinity;
    const b = Number.isFinite(best.timestampMs) ? best.timestampMs : -Infinity;
    if (a > b) best = member;
  }
  return best;
}
