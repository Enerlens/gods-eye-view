import { createHash } from 'node:crypto';

/**
 * Vigicrues feed projection — the seam between the raw upstream GeoJSON and
 * what the browser is actually served.
 *
 * Lives here rather than inside `vite.config.js` for the same reason
 * `firmsCsv.js` does: the parsing of a third-party feed is the part most
 * likely to break when that feed shifts, so it belongs somewhere a unit test
 * can point at a real captured response. The dev-server proxy imports
 * `projectVigicruesFeed`; nothing in the browser bundle does.
 *
 * The upstream body is 2,245,691 bytes with no gzip, no ETag and no
 * Last-Modified, and the map behind it changes twice a day. This projection is
 * what makes the layer affordable: it splits the feed into a ~1.1 MB geometry
 * document that is fetched once per session and a ~3 KB level document that is
 * polled, joined by `geometryVersion`.
 */

/**
 * Coordinate precision for the served geometry, in decimal places.
 * 5 dp is ~1 m. The reaches are clamped ground lines drawn at regional zoom at
 * the closest, and the extra published digits are about a third of the
 * transfer. Douglas-Peucker was measured and rejected: on this feed a 25 m
 * tolerance removes 60 vertices out of 56,110 because the published geometry
 * is already coarse, and the only tolerance that pays (250 m → 18,652) visibly
 * straightens rivers.
 */
export const VIGICRUES_COORDINATE_DECIMALS = 5;

const COORDINATE_SCALE = 10 ** VIGICRUES_COORDINATE_DECIMALS;

/**
 * Normalize a feature's geometry to an array of line parts, or null when it
 * carries nothing drawable.
 * @param {object|null|undefined} geometry
 * @returns {Array<Array<number[]>>|null}
 */
function lineParts(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return null;
}

/**
 * Project the upstream `InfoVigiCru.geojson` FeatureCollection into the two
 * documents the proxy serves.
 *
 * `levels[id]` is `null` — never 1 — for a reach whose `NivInfViCr` is absent
 * or out of domain. Substituting green for missing data is the one failure
 * mode a flood-vigilance map must not have, so the unknown has to survive the
 * projection intact.
 *
 * @param {object|null|undefined} geojson Raw upstream FeatureCollection.
 * @returns {{updateTime: string|null, reference: string|null,
 *   geometryVersion: string, levels: Record<string, number|null>,
 *   reaches: Array<{id:string,name:string,updatedAt:string|null,parts:Array<Array<number[]>>}>}}
 */
export function projectVigicruesFeed(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const reaches = [];
  const levels = {};
  const versionParts = [];

  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const rawParts = lineParts(feature?.geometry);
    if (!Array.isArray(rawParts) || rawParts.length === 0) continue;

    const properties = feature.properties || {};
    // `CdEntCru` is the reach code ("CO1"); `id` is the internal row id.
    const id = String(properties.CdEntCru ?? properties.id ?? `troncon-${i}`);

    const parts = [];
    for (const line of rawParts) {
      if (!Array.isArray(line) || line.length < 2) continue;
      const rounded = [];
      for (const point of line) {
        const lon = Number(point?.[0]);
        const lat = Number(point?.[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        rounded.push([
          Math.round(lon * COORDINATE_SCALE) / COORDINATE_SCALE,
          Math.round(lat * COORDINATE_SCALE) / COORDINATE_SCALE,
        ]);
      }
      if (rounded.length >= 2) parts.push(rounded);
    }
    if (!parts.length) continue;

    reaches.push({
      id,
      name: String(properties.lbentcru ?? '').trim() || id,
      updatedAt: String(properties.dhmentcru ?? properties.dhcentcru ?? '').trim() || null,
      parts,
    });
    const level = Number(properties.NivInfViCr);
    levels[id] = Number.isInteger(level) && level >= 1 && level <= 4 ? level : null;
    versionParts.push(`${id}:${parts.map((part) => part.length).join('.')}`);
  }

  return {
    // `DtHrInfoVigiCru` is not decoration: Licence Ouverte 2.0's single
    // obligation has two limbs — name the concédant AND state the date of last
    // update of the information reused.
    updateTime: String(geojson?.DtHrInfoVigiCru ?? '').trim() || null,
    reference: String(geojson?.RefInfoVigiCru ?? '').trim() || null,
    // Identity of the DRAWN SHAPE, not of the bulletin: it moves only when a
    // reach is added, removed or redrawn, which is what lets the client hold
    // the geometry document across polls.
    geometryVersion: createHash('sha1').update(versionParts.join('|')).digest('hex').slice(0, 16),
    levels,
    reaches,
  };
}
