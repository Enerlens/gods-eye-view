/**
 * Géoportail de l'urbanisme feed projection — what may legally be built on the
 * plot opposite, and what the state has already encumbered this one with.
 *
 * WHY THIS MATTERS TO A BUYER MORE THAN ALMOST ANYTHING ELSE. A listing shows
 * the flat. It does not show that the car park across the street is zoned for
 * twenty-five metres of construction, or that the address sits inside an
 * airport noise-exposure plan, or that a railway protection strip runs under
 * the balcony. All three are public, all three are drawable, and all three are
 * read by hand today — one PDF at a time — if they are read at all.
 *
 * MEASURED against APIcarto on 2026-09-01, at 2.3760,48.8300 (Paris 13e):
 *   - `GET apicarto.ign.fr/api/gpu/zone-urba?geom={Point}`
 *     → 200, **89,897 bytes**, one feature: zone `UG`, "Zone urbaine générale",
 *       partition `DU_75056`, PLU approved 2026-06-16, 3,588 vertices
 *   - `GET apicarto.ign.fr/api/gpu/assiette-sup-s?geom={Point}`
 *     → 200, **1,396,720 bytes**, five servitudes, **56,063 vertices total**
 *   - the response echoes the request origin in `access-control-allow-origin`
 *
 * WHERE THE 1.4 MB GOES, AND WHY THE PROXY EXISTS. One `pm1` servitude — a
 * technological-risk envelope — carries **50,669 vertices** on its own, and
 * coordinates are published to **8 decimal places**, which is a millimetre.
 * The browser needs an outline it will draw at city zoom. So this projection
 * rounds to 5 dp (~1 m), drops the points that rounding collapses, and
 * decimates what remains, reporting `simplified` per ring rather than pretending
 * the result is the surveyed boundary. Nothing here is a legal document; the
 * `urlreg` of each servitude is relayed so a reader can reach the one that is.
 *
 * THE FIELD THAT IS NOT THERE. There is no `categorie` on a servitude. The
 * type is `suptype` — a short code (`ac1`, `t1`, `pm1`, `t5`…) — beside
 * `typeass`, `nomass` and `nomsuplitt`. The codes are the national SUP
 * nomenclature and are meaningless on screen, so SUP_TYPE_LABELS below turns
 * them into the sentence a buyer needs. Anything unmapped keeps its raw code
 * rather than being hidden.
 *
 * Dependency-free and side-effect-free. The `/api/gpu` proxy imports this.
 */

const APICARTO_ROOT = 'https://apicarto.ign.fr/api/gpu';

/** Coordinate precision, in decimal places. 5 dp is ~1 m. */
export const GPU_COORDINATE_DECIMALS = 5;
/**
 * Vertices kept per ring before decimation kicks in.
 *
 * Set against the measured worst case: a single servitude arrived with 50,669
 * vertices for a shape that is drawn a few hundred pixels wide.
 */
export const GPU_MAX_RING_VERTICES = 400;
/**
 * Separate PIECES of one feature kept, largest first.
 *
 * A per-ring cap alone is not enough and the measurement says why: the 50,669-
 * vertex `pm1` envelope is a MultiPolygon of roughly a hundred separate
 * polygons, every one of them comfortably under the per-ring cap. Capping only
 * rings left 37,983 points standing — a 25% saving on a shape that needed a
 * 98% one. The pieces dropped are slivers of a few points each, invisible at
 * the zoom this is ever drawn at.
 *
 * Counted in PIECES rather than in rings since interior rings started being
 * carried: a hole belongs to its outer ring and is spent out of the vertex
 * budget with it, so an enclave can never be the thing a budget drops.
 */
export const GPU_MAX_FEATURE_PARTS = 24;
/** Total vertices kept per feature, across all its rings. */
export const GPU_MAX_FEATURE_VERTICES = 1200;

/**
 * The national servitude nomenclature, in the words a buyer would use.
 *
 * Only the families that actually change a purchase decision are spelled out.
 * An unmapped code is returned as-is — a servitude nobody has named is still a
 * servitude, and hiding it would be worse than showing a bare code.
 */
export const SUP_TYPE_LABELS = Object.freeze({
  ac1: 'Abords d\'un monument historique',
  ac2: 'Site inscrit ou classé',
  ac4: 'Secteur sauvegardé / site patrimonial remarquable',
  as1: 'Protection d\'un captage d\'eau potable',
  i1: 'Canalisation d\'hydrocarbures',
  i3: 'Canalisation de gaz',
  i4: 'Ligne électrique',
  int1: 'Voisinage d\'un cimetière',
  pm1: 'Plan de prévention des risques (naturels ou technologiques)',
  pm3: 'Risque technologique',
  pt1: 'Protection d\'une station radioélectrique',
  pt2: 'Protection d\'un faisceau hertzien',
  pt3: 'Réseau de télécommunication',
  t1: 'Voie ferrée — zone de protection',
  t4: 'Servitude aéronautique de balisage',
  t5: 'Servitude aéronautique de dégagement (aérodrome)',
  t7: 'Servitude aéronautique hors dégagement',
  ep1: 'Alignement de voirie',
});

/**
 * Build one APIcarto URL for a point.
 * @param {'zone-urba'|'assiette-sup-s'|'prescription-surf'} endpoint
 * @param {{lon: number, lat: number}} point
 * @returns {string}
 */
export function buildGpuUrl(endpoint, { lon, lat }) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error('gpu: lon/lat must be finite numbers');
  }
  const geom = JSON.stringify({ type: 'Point', coordinates: [lon, lat] });
  return `${APICARTO_ROOT}/${endpoint}?geom=${encodeURIComponent(geom)}`;
}

/**
 * Round a ring to metre precision and drop the points that collapses.
 * @param {Array<number[]>} ring
 * @returns {Array<number[]>}
 */
function roundRing(ring) {
  const scale = 10 ** GPU_COORDINATE_DECIMALS;
  const out = [];
  let previous = null;
  for (const point of Array.isArray(ring) ? ring : []) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const rounded = [Math.round(lon * scale) / scale, Math.round(lat * scale) / scale];
    if (previous && previous[0] === rounded[0] && previous[1] === rounded[1]) continue;
    out.push(rounded);
    previous = rounded;
  }
  return out;
}

/**
 * Decimate a ring to at most {@link GPU_MAX_RING_VERTICES} points.
 *
 * A fixed stride, not Douglas-Peucker: these are administrative envelopes drawn
 * at city zoom, the first and last points are always kept so the ring still
 * closes, and a stride is the one simplification whose failure mode — a
 * slightly straighter boundary — is honest about itself. The caller reports
 * `simplified` so nothing downstream mistakes this for a surveyed limit.
 *
 * @param {Array<number[]>} ring
 * @returns {{ring: Array<number[]>, simplified: boolean}}
 */
export function decimateRing(ring) {
  const rounded = roundRing(ring);
  if (rounded.length <= GPU_MAX_RING_VERTICES) return { ring: rounded, simplified: false };
  const stride = Math.ceil(rounded.length / GPU_MAX_RING_VERTICES);
  const out = [];
  for (let i = 0; i < rounded.length; i += stride) out.push(rounded[i]);
  const last = rounded[rounded.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return { ring: out, simplified: true };
}

/**
 * Flatten a Polygon or MultiPolygon into decimated PARTS — an outer ring and
 * the interior rings it encloses, in GeoJSON order.
 *
 * THE HOLES ARE NOT DECORATION, AND DROPPING THEM PUT HOUSES IN THE WRONG
 * ZONE. This function used to keep `polygon[0]` and nothing else, on the
 * reasoning that an interior ring is invisible once a shape is drawn as an
 * outline. Both halves of that were wrong. Measured against Ustaritz (64547)
 * on 2026-09-01, the answer for one point in the village centre: zone `UB`,
 * ONE polygon, TWO interior rings — 6 646 m² that the same PLU zones `UE`
 * (the school and its grounds) and 50 686 m² that it zones `UYc` (the
 * industrial estate). Keeping the outer ring alone draws UB as a solid blob
 * that swallows both, so every building inside them is shown inside a zone it
 * is not in. Across the whole commune: 14 interior rings, 299 441 m² — thirty
 * hectares of ground attributed to the wrong rule.
 *
 * A hole is never dropped while its outer ring survives, which is why the
 * budget below is spent per PART rather than per ring: half a donut is not a
 * cheaper donut, it is a different shape that says something false.
 *
 * @param {object|null|undefined} geometry
 * @returns {{parts: Array<Array<Array<number[]>>>, simplified: boolean, sourceVertices: number,
 *   sourceRings: number, sourceParts: number, servedParts: number, holes: number}}
 */
export function projectGeometry(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates
      : [];
  const candidates = [];
  let simplified = false;
  let sourceVertices = 0;
  let sourceRings = 0;
  let sourceParts = 0;
  for (const polygon of polygons) {
    const outer = Array.isArray(polygon) ? polygon[0] : null;
    if (!Array.isArray(outer)) continue;
    const decimatedOuter = decimateRing(outer);
    sourceVertices += outer.length;
    sourceRings += 1;
    sourceParts += 1;
    if (decimatedOuter.simplified) simplified = true;
    if (decimatedOuter.ring.length < 3) continue;
    const rings = [decimatedOuter.ring];
    for (let index = 1; index < polygon.length; index += 1) {
      const hole = polygon[index];
      if (!Array.isArray(hole)) continue;
      sourceVertices += hole.length;
      sourceRings += 1;
      const decimatedHole = decimateRing(hole);
      if (decimatedHole.simplified) simplified = true;
      // A ring that decimates below a triangle cannot be a hole; it is also
      // too small to be one at the zoom this is drawn at.
      if (decimatedHole.ring.length >= 3) rings.push(decimatedHole.ring);
    }
    candidates.push(rings);
  }
  // Largest first, so what survives a budget is the part of the envelope a
  // reader can actually see. Ranked on the OUTER ring: a part is as visible as
  // its outline, and its holes are inside that outline by construction.
  candidates.sort((a, b) => b[0].length - a[0].length);
  const parts = [];
  let holes = 0;
  let budget = GPU_MAX_FEATURE_VERTICES;
  for (const rings of candidates) {
    if (parts.length >= GPU_MAX_FEATURE_PARTS || budget <= 0) { simplified = true; break; }
    parts.push(rings);
    holes += rings.length - 1;
    for (const ring of rings) budget -= ring.length;
  }
  return {
    parts, simplified, sourceVertices, sourceRings, sourceParts, servedParts: parts.length, holes,
  };
}

/**
 * Project the zoning answer.
 * @param {object|null|undefined} payload `zone-urba` FeatureCollection.
 * @returns {Array<object>}
 */
export function projectZones(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const zones = [];
  for (const feature of features) {
    const properties = feature?.properties || {};
    const geometry = projectGeometry(feature?.geometry);
    if (!geometry.parts.length) continue;
    zones.push({
      id: String(properties.gid ?? `zone-${zones.length}`),
      code: properties.libelle ?? null,
      label: properties.libelong ?? null,
      // `U`, `AU`, `A`, `N` — urban, to-be-urbanised, agricultural, natural.
      kind: properties.typezone ?? null,
      partition: properties.partition ?? null,
      documentId: properties.idurba ?? null,
      approvedOn: properties.datvalid ?? properties.datappro ?? null,
      regulationFile: properties.nomfic || null,
      regulationUrl: properties.urlfic || null,
      parts: geometry.parts,
      holes: geometry.holes,
      simplified: geometry.simplified,
      sourceVertices: geometry.sourceVertices,
      sourceRings: geometry.sourceRings,
      sourceParts: geometry.sourceParts,
      servedParts: geometry.servedParts,
    });
  }
  return zones;
}

/**
 * Project the servitude answer.
 * @param {object|null|undefined} payload `assiette-sup-s` FeatureCollection.
 * @returns {Array<object>}
 */
export function projectServitudes(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const servitudes = [];
  for (const feature of features) {
    const properties = feature?.properties || {};
    const geometry = projectGeometry(feature?.geometry);
    if (!geometry.parts.length) continue;
    const code = String(properties.suptype ?? '').trim().toLowerCase();
    servitudes.push({
      id: String(properties.idass ?? properties.gid ?? `sup-${servitudes.length}`),
      code: code || null,
      // The national code means nothing on screen; the sentence does. An
      // unmapped code falls back to the code rather than disappearing.
      label: SUP_TYPE_LABELS[code] ?? (code ? code.toUpperCase() : null),
      name: properties.nomass ?? null,
      assietteType: properties.typeass ?? null,
      literalName: properties.nomsuplitt ?? null,
      bufferM: Number.isFinite(properties.paramcalc) ? properties.paramcalc : null,
      regulationName: properties.nomreg ?? null,
      regulationUrl: properties.urlreg || null,
      documentFile: properties.fichier ?? null,
      parts: geometry.parts,
      holes: geometry.holes,
      simplified: geometry.simplified,
      sourceVertices: geometry.sourceVertices,
      sourceRings: geometry.sourceRings,
      sourceParts: geometry.sourceParts,
      servedParts: geometry.servedParts,
    });
  }
  // Named families first so a reader meets "airport noise plan" before "PT2".
  servitudes.sort((a, b) => Number(Boolean(SUP_TYPE_LABELS[b.code])) - Number(Boolean(SUP_TYPE_LABELS[a.code])));
  return servitudes;
}

/**
 * Assemble both answers into the one document the client reads.
 * @param {{zoning?: object|null, servitudes?: object|null}} input
 * @returns {object}
 */
export function projectGpu({ zoning, servitudes }) {
  return {
    zones: projectZones(zoning),
    servitudes: projectServitudes(servitudes),
    available: { zoning: Boolean(zoning), servitudes: Boolean(servitudes) },
  };
}
