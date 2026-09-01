/**
 * @module transitSchedule
 *
 * Pure schedule logic for the French transit layer: joining a moving vehicle
 * to the operator's own prediction for the trip it is running, and to the
 * operator's own sentence about the line it is running on.
 *
 * WHAT THIS ADDS AND WHAT IT DOES NOT. Nothing here draws anything or fetches
 * anything. The vehicles were already on screen; this decides what may be said
 * about them beyond where they are — how far off the timetable the operator
 * thinks they are, whether the run has been cancelled, whether stops ahead of
 * them are being skipped, and whether there is an alert in force on their
 * line. Positions come from `VehiclePosition`, these come from `TripUpdate`
 * and `Alert`, and all three are the same `FeedMessage` type published by the
 * same 150 French networks (see `panFeeds.js`).
 *
 * WHAT THE FEEDS ACTUALLY PUBLISH, measured over the 30 largest live networks
 * on 2026-08-31 (1 865 vehicles):
 *
 *   - 67% of vehicles join a trip update on `trip_id`, and a further 2% only
 *     on the VEHICLE id — two networks (TANGO, Fil Bleu) publish trip ids in
 *     the position feed that appear nowhere in their own trip updates, and
 *     their vehicle ids do. Hence the two-key join.
 *   - 38% end up with a DELAY. The gap is not a join failure: 17 of those 30
 *     networks publish `StopTimeEvent.time` (an absolute prediction) and never
 *     `StopTimeEvent.delay`, and converting one to the other needs the
 *     timetable in `stop_times.txt` — 223 MB expanded for Bordeaux alone.
 *     A vehicle with no published deviation says nothing rather than 0.
 *   - `TripUpdate.delay`, the trip-level field, was published by NOBODY. The
 *     deviation always has to be read off a stop.
 *   - 42% publish `current_stop_sequence` on the position, which is what makes
 *     "the delay at the stop this bus is heading for" answerable rather than
 *     "some delay somewhere on this trip".
 *   - 6% of vehicles had at least one SKIPPED stop ahead of them, and 30%
 *     matched an active alert on their line.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM, no fs) so it runs
 * identically in the dev-server proxy, in the browser and under `node --test`.
 */

/**
 * At or below this deviation a vehicle is running EARLY, seconds.
 *
 * One minute, because a bus a minute ahead of its timetable is a bus that may
 * leave a stop before the people waiting for it arrive — which is the thing
 * riders actually experience, and the reason operators treat early running as
 * a fault rather than as a bonus.
 */
export const EARLY_THRESHOLD_SEC = -60;

/**
 * At or above this deviation a vehicle is running LATE, seconds.
 *
 * Three minutes is the tolerance French urban operators publish their own
 * punctuality against; below it the deviation is inside the noise of a feed
 * that recomputes its predictions every 20-60 s.
 */
export const LATE_THRESHOLD_SEC = 180;

/**
 * How far off the timetable a vehicle is running, as a word.
 *
 * @param {?number} delaySec Signed deviation; positive is late.
 * @returns {?('early'|'on-time'|'late')} null when nothing was published.
 */
export function punctuality(delaySec) {
  if (!Number.isFinite(delaySec)) return null;
  if (delaySec <= EARLY_THRESHOLD_SEC) return 'early';
  if (delaySec >= LATE_THRESHOLD_SEC) return 'late';
  return 'on-time';
}

/**
 * The deviation as a rider would say it.
 *
 * Deliberately routed through {@link punctuality} rather than rounding the
 * seconds directly: a card reading "2 min late" beside a summary that counts
 * the same vehicle as on time is two answers to one question. Inside the
 * on-time band the sentence is "on time", above it the minutes.
 *
 * @param {?number} delaySec Signed deviation; positive is late.
 * @returns {?string}
 */
export function formatDelay(delaySec) {
  const state = punctuality(delaySec);
  if (!state) return null;
  if (state === 'on-time') return 'on time';
  const minutes = Math.max(1, Math.round(Math.abs(delaySec) / 60));
  return `${minutes} min ${state === 'late' ? 'late' : 'early'}`;
}

/**
 * Index a feed's trip updates on the two keys a vehicle can be joined by.
 *
 * @param {Array<Object>} trips Normalized trip updates.
 * @returns {{byTrip: Map<string, Object>, byVehicle: Map<string, Object>}}
 */
export function indexTripUpdates(trips) {
  const byTrip = new Map();
  const byVehicle = new Map();
  for (const trip of Array.isArray(trips) ? trips : []) {
    if (!trip?.tripId) continue;
    // First writer wins on both keys. A feed that repeats a trip id is
    // publishing the same run twice, and the earlier entity is the one the
    // spec's ordering makes canonical.
    if (!byTrip.has(trip.tripId)) byTrip.set(trip.tripId, trip);
    if (trip.vehicleId && !byVehicle.has(trip.vehicleId)) byVehicle.set(trip.vehicleId, trip);
  }
  return { byTrip, byVehicle };
}

/**
 * Find the trip update for one vehicle.
 *
 * `trip_id` first, because it identifies the RUN and two vehicles can swap
 * runs mid-service. The vehicle id is the documented fallback and it earns its
 * place: TANGO publishes 23 vehicles whose trip ids match none of its own 31
 * trip updates, and every one of them matches on the vehicle id.
 *
 * @param {Object} vehicle Normalized vehicle record.
 * @param {{byTrip: Map, byVehicle: Map}} index From {@link indexTripUpdates}.
 * @returns {?{trip: Object, matchedBy: 'trip'|'vehicle'}}
 */
export function matchTripUpdate(vehicle, index) {
  if (!vehicle || !index) return null;
  const byTrip = vehicle.tripId ? index.byTrip?.get(vehicle.tripId) : null;
  if (byTrip) return { trip: byTrip, matchedBy: 'trip' };
  const localId = vehicleLocalId(vehicle);
  const byVehicle = localId ? index.byVehicle?.get(localId) : null;
  if (byVehicle) return { trip: byVehicle, matchedBy: 'vehicle' };
  return null;
}

/**
 * The operator's own vehicle id, with the feed prefix the decoder adds removed.
 *
 * `vehicleFromEntity` namespaces ids as `feedId:vehicleId` so two networks can
 * never collide; a trip update's `VehicleDescriptor.id` is the bare one, and
 * the join has to happen on the same string the operator published.
 *
 * @param {Object} vehicle Normalized vehicle record.
 * @returns {?string}
 */
export function vehicleLocalId(vehicle) {
  const id = String(vehicle?.id ?? '');
  if (!id) return null;
  const feedId = String(vehicle?.feedId ?? vehicle?.feed ?? '');
  if (feedId && id.startsWith(`${feedId}:`)) return id.slice(feedId.length + 1) || null;
  return id;
}

/**
 * Read the deviation off the stop that describes where this vehicle IS.
 *
 * Three answers, and which one it is travels with the number:
 *
 *   - `current-stop` — the vehicle published `current_stop_sequence` and the
 *     trip publishes a deviation at that stop or a later one. This is the
 *     prediction for the stop the vehicle is actually heading to.
 *   - `ahead` — no sequence, so the first stop still in the FUTURE is used.
 *   - `behind` — every deviation in the trip is in the past, so the most
 *     recent measurement is returned. It is the operator's last word on this
 *     run, and saying so is better than saying nothing or pretending it is a
 *     prediction.
 *   - `trip` — the trip-level `TripUpdate.delay`. No French network published
 *     one on 2026-08-31, but it is the spec's own default and costs a line.
 *
 * @param {Object} trip Normalized trip update.
 * @param {Object} [options]
 * @param {?number} [options.stopSequence] The vehicle's `current_stop_sequence`.
 * @param {number} [options.nowMs]
 * @returns {?{delaySec: number, from: 'current-stop'|'ahead'|'behind'|'trip'}}
 */
export function tripDelay(trip, { stopSequence = null, nowMs = Date.now() } = {}) {
  const stops = Array.isArray(trip?.stops) ? trip.stops : [];
  const measured = stops.filter((stop) => Number.isFinite(stop?.delaySec));

  if (measured.length) {
    if (Number.isFinite(stopSequence)) {
      const atOrAfter = measured.find(
        (stop) => Number.isFinite(stop.sequence) && stop.sequence >= stopSequence,
      );
      if (atOrAfter) return { delaySec: atOrAfter.delaySec, from: 'current-stop' };
    }
    const future = measured.find((stop) => {
      const when = stop.arrivalMs ?? stop.departureMs;
      return Number.isFinite(when) && when >= nowMs;
    });
    if (future) return { delaySec: future.delaySec, from: 'ahead' };
    return { delaySec: measured[measured.length - 1].delaySec, from: 'behind' };
  }

  if (Number.isFinite(trip?.delaySec)) return { delaySec: trip.delaySec, from: 'trip' };
  return null;
}

/**
 * The next stop of a trip, from the vehicle's point of view.
 *
 * Returns the stop's id and timings, never its NAME: a stop name lives in the
 * static `stops.txt`, which this layer does not load, and printing an opaque
 * `stop_id` as though it were a place would be worse than printing the time.
 *
 * @param {Object} trip Normalized trip update.
 * @param {Object} [options]
 * @param {?number} [options.stopSequence]
 * @param {number} [options.nowMs]
 * @returns {?Object} The `stopTimeFromUpdate` record.
 */
export function nextStop(trip, { stopSequence = null, nowMs = Date.now() } = {}) {
  const stops = Array.isArray(trip?.stops) ? trip.stops : [];
  if (!stops.length) return null;
  if (Number.isFinite(stopSequence)) {
    const atOrAfter = stops.find(
      (stop) => Number.isFinite(stop.sequence) && stop.sequence >= stopSequence,
    );
    if (atOrAfter) return atOrAfter;
  }
  return stops.find((stop) => {
    const when = stop.arrivalMs ?? stop.departureMs;
    return Number.isFinite(when) && when >= nowMs;
  }) || null;
}

/**
 * Stops the operator says this run will NOT serve.
 *
 * `ahead` is the honest qualifier, not a detail: a skipped stop only matters
 * to someone waiting at it, and whether it is still to come can only be
 * decided when the vehicle publishes a `current_stop_sequence` AND the update
 * numbers its stops. When either is missing the count is over the whole run
 * and `ahead` is false, so the card can say "on this run" instead of "ahead".
 *
 * @param {Object} trip Normalized trip update.
 * @param {?number} [stopSequence]
 * @returns {{count: number, ahead: boolean}}
 */
export function skippedStops(trip, stopSequence = null) {
  const stops = Array.isArray(trip?.stops) ? trip.stops : [];
  const skipped = stops.filter((stop) => stop?.relationship === 'skipped');
  if (!skipped.length) return { count: 0, ahead: false };
  if (Number.isFinite(stopSequence) && skipped.every((stop) => Number.isFinite(stop.sequence))) {
    return {
      count: skipped.filter((stop) => stop.sequence >= stopSequence).length,
      ahead: true,
    };
  }
  return { count: skipped.length, ahead: false };
}

/**
 * Whether a vehicle is sitting at the START of a run that is not yet due out.
 *
 * This exists because the raw arithmetic lies. A bus parked at its terminus
 * waiting for a departure 56 minutes from now publishes a predicted arrival of
 * "about now" against a scheduled arrival 56 minutes ahead, and the difference
 * the operator computes is −3 361 seconds. Printed as punctuality that reads
 * "56 minutes early", which is not a thing a bus can be — it is a bus on
 * layover, and every rider standing next to it can see that.
 *
 * Measured over Bordeaux, Rouen, Normandy, Le Havre and Montpellier on
 * 2026-08-31: 19 of the 22 vehicles more than five minutes "early" were
 * stopped at stop sequence 1. Suppressing them is the difference between a
 * viewport summary that says 28 early and one that says 9.
 *
 * The rule is deliberately one-sided. A vehicle at its first stop with a
 * POSITIVE deviation has an overdue departure, which is real lateness a rider
 * feels, so only the ahead-of-schedule case is reclassified — and only past
 * {@link EARLY_THRESHOLD_SEC}, so a bus half a minute ahead still counts as
 * the on-time vehicle it is.
 *
 * @param {Object} vehicle Normalized vehicle record.
 * @param {Object} trip Normalized trip update.
 * @param {?number} delaySec The deviation read for this vehicle.
 * @returns {boolean}
 */
export function awaitingDeparture(vehicle, trip, delaySec) {
  if (!Number.isFinite(delaySec) || delaySec > EARLY_THRESHOLD_SEC) return false;
  if (vehicle?.status !== 'stopped' && vehicle?.status !== 'incoming') return false;
  const first = Array.isArray(trip?.stops) ? trip.stops[0]?.sequence : null;
  if (!Number.isFinite(vehicle?.stopSequence) || !Number.isFinite(first)) return false;
  return vehicle.stopSequence <= first;
}

/**
 * Everything the schedule feeds say about one vehicle, or null.
 *
 * Null when the vehicle joins no trip update AND its own position carries no
 * departure from the timetable — that is, when there is nothing to add. The
 * vehicle's own `TripDescriptor.schedule_relationship` is read even without a
 * join, because it is published on the position itself and costs nothing.
 *
 * @param {Object} vehicle Normalized vehicle record.
 * @param {{byTrip: Map, byVehicle: Map}} [tripIndex]
 * @param {Object} [options]
 * @param {number} [options.nowMs]
 * @returns {?Object}
 */
export function scheduleForVehicle(vehicle, tripIndex, { nowMs = Date.now() } = {}) {
  if (!vehicle) return null;
  const match = tripIndex ? matchTripUpdate(vehicle, tripIndex) : null;
  const positionState = vehicle.tripRelationship || null;
  if (!match) {
    return positionState ? { tripState: positionState, matchedBy: null } : null;
  }

  const { trip, matchedBy } = match;
  const stopSequence = Number.isFinite(vehicle.stopSequence) ? vehicle.stopSequence : null;
  const next = nextStop(trip, { stopSequence, nowMs });
  const delay = tripDelay(trip, { stopSequence, nowMs });
  const skipped = skippedStops(trip, stopSequence);

  const summary = { matchedBy };
  if (delay && awaitingDeparture(vehicle, trip, delay.delaySec)) {
    // Not punctuality — a layover. What IS true and useful is when the
    // operator expects it out: the predicted time at this stop, less the
    // deviation, is the scheduled departure the vehicle is waiting for.
    summary.awaitingDeparture = true;
    const predicted = next?.departureMs ?? next?.arrivalMs ?? null;
    if (Number.isFinite(predicted)) {
      summary.scheduledDepartureMs = predicted - delay.delaySec * 1000;
    }
  } else if (delay) {
    summary.delaySec = delay.delaySec;
    summary.delayFrom = delay.from;
  }
  // The trip update's verdict wins over the position's: the update is the
  // message whose job is to describe the RUN, and a cancellation is published
  // there first.
  const tripState = trip.relationship || positionState;
  if (tripState) summary.tripState = tripState;
  if (skipped.count) {
    summary.skippedStops = skipped.count;
    summary.skippedAhead = skipped.ahead;
  }
  if (next) {
    const eta = next.arrivalMs ?? next.departureMs;
    if (Number.isFinite(eta)) summary.nextStopEtaMs = eta;
    if (next.stopId) summary.nextStopId = next.stopId;
  }
  if (Number.isFinite(trip.timestampMs)) summary.predictedAtMs = trip.timestampMs;
  return summary;
}

// --- Alerts -----------------------------------------------------------------

/**
 * Effect ranking, worst first, for choosing WHICH alert a card shows.
 *
 * Severity is ranked before this (see {@link alertRank}) but two thirds of
 * French alerts publish no severity at all, so the effect is usually the only
 * thing separating "no service on this line" from "a lift is out of order".
 */
const EFFECT_RANK = Object.freeze({
  'no service': 6,
  'significant delays': 5,
  detour: 4,
  'reduced service': 3,
  'modified service': 2,
  'stop moved': 2,
  'accessibility issue': 1,
  'additional service': 1,
  'other effect': 0,
  'no effect': 0,
});

const SEVERITY_RANK = Object.freeze({ severe: 3, warning: 2, info: 1 });

/**
 * How serious an alert is, as a sortable number.
 * @param {Object} alert Normalized alert.
 * @returns {number}
 */
export function alertRank(alert) {
  const severity = SEVERITY_RANK[alert?.severity] || 0;
  const effect = EFFECT_RANK[alert?.effect] || 0;
  return severity * 10 + effect;
}

/**
 * Index active alerts by every key a vehicle can be matched on.
 *
 * An alert informing NO route, trip or stop — an `agency_id` on its own — is
 * about the whole network. Those are kept apart in `network` rather than
 * attached to every vehicle: they are true of the network and they would
 * otherwise be the only thing every card in the city said.
 *
 * `route_type` selectors ("every tram") are not indexed. GTFS-Realtime carries
 * no vehicle class, so the layer's own class comes from a static join and
 * matching on it would attach an alert through two hops of inference.
 *
 * @param {Array<Object>} alerts Normalized alerts.
 * @param {Object} [options]
 * @param {number} [options.nowMs] Alerts not in force then are dropped.
 * @param {Function} [options.isActive] Seam for the active-period test.
 * @returns {{byTrip: Map, byRoute: Map, byStop: Map, network: Array<Object>, count: number}}
 */
export function indexAlerts(alerts, { nowMs = Date.now(), isActive = null } = {}) {
  const byTrip = new Map();
  const byRoute = new Map();
  const byStop = new Map();
  const network = [];
  let count = 0;

  const push = (map, key, alert) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(alert);
    else map.set(key, [alert]);
  };

  for (const alert of Array.isArray(alerts) ? alerts : []) {
    if (isActive && !isActive(alert, nowMs)) continue;
    count += 1;
    let placed = false;
    for (const informed of alert.informed || []) {
      if (informed.tripId) { push(byTrip, informed.tripId, alert); placed = true; }
      if (informed.routeId) { push(byRoute, informed.routeId, alert); placed = true; }
      if (informed.stopId) { push(byStop, informed.stopId, alert); placed = true; }
    }
    if (!placed) network.push(alert);
  }
  return { byTrip, byRoute, byStop, network, count };
}

/**
 * The alert a vehicle's card should show, and how many it matched in total.
 *
 * Most specific scope wins — a notice about this exact run beats one about its
 * line, which beats one about the network — and inside a scope, the worst
 * alert wins. The SCOPE travels with the alert because "your bus is diverted"
 * and "this line is diverted somewhere today" are different claims and the
 * card must not print the second as the first.
 *
 * @param {Object} vehicle Normalized or wire vehicle record.
 * @param {Object} index From {@link indexAlerts}.
 * @returns {?{alert: Object, scope: 'trip'|'route'|'network', count: number}}
 */
export function alertForVehicle(vehicle, index) {
  if (!vehicle || !index) return null;
  const scopes = [
    ['trip', vehicle.tripId ? index.byTrip?.get(vehicle.tripId) : null],
    ['route', vehicle.routeId ? index.byRoute?.get(vehicle.routeId) : null],
    ['network', index.network?.length ? index.network : null],
  ];

  const matched = new Set();
  let best = null;
  for (const [scope, list] of scopes) {
    if (!list?.length) continue;
    for (const alert of list) matched.add(alert);
    if (best) continue;
    const worst = [...list].sort((a, b) => alertRank(b) - alertRank(a))[0];
    best = { alert: worst, scope };
  }
  if (!best) return null;
  return { ...best, count: matched.size };
}

/**
 * Trim an alert to what a card prints.
 *
 * The description is dropped: French operators write several paragraphs of
 * rider guidance into `description_text`, and one line of a 22 px card is not
 * where that is read. The `url` is carried so the full text stays one click
 * away from the surfaces that can offer one.
 *
 * @param {Object} alert Normalized alert.
 * @param {string} scope Match scope from {@link alertForVehicle}.
 * @returns {Object}
 */
export function alertWireRecord(alert, scope) {
  const record = { scope, text: alert.header || alert.description };
  if (alert.effect) record.effect = alert.effect;
  if (alert.cause) record.cause = alert.cause;
  if (alert.severity) record.severity = alert.severity;
  if (alert.url) record.url = alert.url;
  return record;
}

/**
 * Fleet-level tally, for the row that says what is happening without a click.
 *
 * `unknown` is counted and named rather than folded into `on-time`: 62% of the
 * national fleet publishes no deviation at all, and a summary that read
 * "1 200 on time" over a fleet where 700 of those never said would be the
 * single most misleading number this layer could print.
 *
 * @param {Array<Object>} vehicles Wire records.
 * @returns {{late: number, early: number, onTime: number, unknown: number,
 *            waiting: number, canceled: number, skipped: number, alerted: number}}
 */
export function summarizeSchedule(vehicles) {
  const tally = {
    late: 0, early: 0, onTime: 0, unknown: 0,
    waiting: 0, canceled: 0, skipped: 0, alerted: 0,
  };
  for (const vehicle of Array.isArray(vehicles) ? vehicles : []) {
    const state = punctuality(vehicle?.delaySec);
    if (state === 'late') tally.late += 1;
    else if (state === 'early') tally.early += 1;
    else if (state === 'on-time') tally.onTime += 1;
    else tally.unknown += 1;
    if (vehicle?.awaitingDeparture) tally.waiting += 1;
    if (vehicle?.tripState === 'canceled') tally.canceled += 1;
    if (Number(vehicle?.skippedStops) > 0) tally.skipped += 1;
    if (vehicle?.alert) tally.alerted += 1;
  }
  return tally;
}
