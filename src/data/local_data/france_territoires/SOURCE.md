# Territory anchors — provenance & licence

`territoires.json` gives the national Filosofi view one point per département
and one per région. It is **not** a boundary file: the layer draws a disc per
territory, never a filled shape, because a filled département at national zoom
is an opaque quilt and the map underneath it disappears (see
`src/data/filosofiCarreaux.js`).

Rebuild with `npm run territoires:pack`; check it is current with
`node scripts/build-fr-territoires.mjs --check`.

## Provenance

| Field | Source | Licence |
|---|---|---|
| Anchor coordinates | Computed from `../france_departements/departements.geojson` — **IGN ADMIN EXPRESS COG 2018** via [france-geojson](https://github.com/gregoiredavid/france-geojson) | Licence Ouverte (see that folder's `SOURCE.md`) |
| `code`, `nom`, `region` | **[API Géo](https://geo.api.gouv.fr)** (`/departements?fields=code,nom,codeRegion`, `/regions`) — Etalab | Licence Ouverte 2.0 |

## How the anchors are placed

- **A département's anchor is the area-weighted centroid of its LARGEST ring.**
  Using every ring drags the point offshore for Charente-Maritime (Ré, Oléron),
  Morbihan (Belle-Île) and the Var (Porquerolles); a disc floating in the sea
  next to its own département reads as a bug.
- **One département needs more than that, and it is the one that would be worst
  to get wrong.** Hauts-de-Seine is a crescent wrapped around Paris, so its area
  centroid lands *in Paris* — the 92 disc would have been drawn on top of the 75
  disc. Its anchor is instead the interior point farthest from the boundary,
  which puts it in the south of the département, 9 km from Paris's. The script
  checks all 97 and reports every one it had to move; 92 is the only one.
- **A région's anchor is the area-weighted mean of its départements' anchors.**
  Weighted, so Paris and its two small neighbours do not drag Île-de-France's
  disc into the city they are already crowded around.
- **La Réunion has figures and no bundled outline.** Its anchor is the centre of
  the carroyage coverage box this repo already declares and tests in
  `filosofiCarreaux.js` — a published number rather than a coordinate typed from
  memory. The entry carries `anchorFromCoverageBox: true` and `areaKm2: null`,
  so nothing downstream can mistake it for a measured centroid.

## What is NOT here

Guadeloupe, Martinique, Guyane and Mayotte. Not an omission — INSEE's
`DS_FILOSOFI_CC` covers *« France métropolitaine et La Réunion »*, so there are
no figures to anchor. The carroyage layer's own coverage is wider (it includes
Martinique) and that difference is stated where the two meet.
