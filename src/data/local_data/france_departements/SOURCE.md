# Bundled French département polygons — provenance & license

`departements.geojson` gives the Météo-France Vigilance layer
(`src/data/meteoFranceVigilance.js`) a shape to colour. The vigilance product
carries **no geometry** — only a `domain_id` per département and a colour — so
the boundaries have to come from somewhere, and a live fetch of a personal
GitHub repo on every session is not a dependency this app should take.

## Provenance

| File | Source | License | Retrieved |
|---|---|---|---|
| `departements.geojson` | **IGN — ADMIN EXPRESS COG (édition 2018)** for the geometry and **INSEE (millésime 2018)** for the codes and names, redistributed as `departements-version-simplifiee.geojson` by [france-geojson](https://github.com/gregoiredavid/france-geojson) (Grégoire David) | **Licence Ouverte / Open Licence** (inherited from IGN ADMIN EXPRESS — see the license note below) | 2026-08-26 |

- **Downloaded from:**
  `https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-version-simplifiee.geojson`
  (HTTP 200, 569,299 bytes, retrieved 2026-08-26).
- **License evidence:** the france-geojson repository carries no `LICENSE` file
  and GitHub reports its license field as null; its README defers upstream —
  *« Licence : Voir conditions d'utilisation d'Admin Express (Licence
  ouverte) »* — and names its sources as INSEE (codes and names, millésime
  2018) and IGN / ADMIN EXPRESS COG (geometry, édition 2018). IGN ADMIN EXPRESS
  is published under the Licence Ouverte, so the data is Licence Ouverte, but
  that grant is **inherited by reference through a third-party repository**
  rather than declared in it. That is precisely why the file is vendored here
  with the attribution written down, instead of hotlinked at runtime: the
  upstream repository was last pushed 2022-12-02 and is unmaintained.
- **Attribution to keep when redistributing:**
  `Contours des départements : IGN — ADMIN EXPRESS COG (édition 2018), via france-geojson (G. David). Licence Ouverte.`

## Content

**96 features** — the 96 metropolitan départements, including Corsica as `2A`
and `2B`. 86 `Polygon` + 10 `MultiPolygon`, 14,335 ring vertices.

The five overseas départements (971 Guadeloupe, 972 Martinique, 973 Guyane,
974 Réunion, 976 Mayotte) are **deliberately absent**. The `metropole`
vigilance product contains no data for them — Nouvelle-Calédonie and Polynésie
are separate products with their own archives, and Antilles/Guyane/Réunion/
Mayotte vigilance is not obtainable from `cartevigilance/encours` at all. The
`departements-avec-outre-mer.geojson` variant is 3.7 MB (there is no simplified
version of it) and would ship five polygons that can never be coloured.

**Verified 2026-08-26:** the 96 `code` values are an exact set-equality match
with the 96 two-character département `domain_id` values in that morning's live
vigilance payload — no extras on either side. The join is therefore a direct
`properties.code` → `domain_id` lookup with no zero-padding and no Corsica
special case, and the code set doubles as the whitelist that discards the
national `FRA` entry, the 25 `dd10` coastal strips, the `ZDF_*` defence zones,
and Andorra's `99` (which is a bare two-digit code that passes a naive
département regex, and which appears seasonally with avalanche bulletins).

## Transform

Applied once at vendoring time, against the raw download:

1. Properties reduced to `{ code, nom }` — the only two the upstream file
   carried, kept verbatim.
2. Coordinates rounded to 4 decimals (~11 m). Département boundaries are drawn
   at national to regional zoom, where 11 m is far below a pixel; this halves
   the file (569,299 → 254,348 bytes) without moving a visible border.

No simplification beyond that rounding — the upstream file is already the
"version simplifiée", and thinning an administrative boundary further starts to
detach it from the coastline it follows.

## File format

`FeatureCollection` of `{ properties: { code, nom }, geometry: Polygon |
MultiPolygon }`, coordinates `[lon, lat]` in WGS84 (no `crs` member, which is
what Cesium expects).
