# Grid audit — is OpenStreetMap actually good enough?

The **Power Grid** layer draws OpenStreetMap and nothing else, because RTE
publishes no geometry for its own network any more. That is a claim with a
hole in it: *volunteer mapping* is not a synonym for *complete mapping*, and a
layer that says "coverage varies" without ever measuring it is asking to be
believed rather than checked.

This is the check. It measures OSM against RTE's own register — the one RTE
published until 2023 and then withdrew — and answers, in numbers, how much of
the French transmission network our layer is actually showing.

```sh
npm run qa:power-grid-coverage            # substations, ~1 min once cached
npm run qa:power-grid-coverage:lines      # route corridors, a long Overpass sweep
```

## What it does not do

**It never republishes the reference data.** RTE withdrew the GPS coordinates
of the public transmission network in 2025 "pour des raisons de sécurité
publique", and this project respects that: the app serves OSM, and the archived
files exist here only as a ruler. `reference.mjs` downloads them into the
gitignored `.gev-cache/grid-audit/`, and nothing from them reaches `src/`, the
proxy, or the browser.

Both sources are Licence Ouverte 2.0, which is perpetual and irrevocable for
copies distributed under it:

| | source | what |
|---|---|---|
| Routes | the State's own geo-ide mirror (DDTM de l'Eure), still served | 13,287 aerial + underground tronçons, 30 June 2023, Lambert-93 |
| Substations | Internet Archive capture of the ODRÉ export endpoint | 5,003 sites with coordinates, 27 June 2023 |

The `_027` in the shapefile layer name is the publishing département, **not** a
clip: the file spans lon −3.85 → 8.36, lat 42.1 → 50.9 — France Métropolitaine
entire.

## Results, run of 2026-08-28

Reference: 4,067 in-service *postes de transformation* at ≥ 50 kV. Subject: OSM
today, queried uncapped (176,514 `power=substation` in France).

| radius | OSM has a substation | …carrying ≥ 50 kV |
|---|---|---|
| 250 m | 98.1 % | **97.6 %** |
| 1 km | 99.4 % | **98.5 %** |
| 2 km | 99.7 % | 99.0 % |

Median offset between RTE's point and OSM's centre: **13 m** (p90 37 m).
Voltage agreement: **98.7 %**. Of the 192 sites at ≥ 300 kV, **none** are
missing — the 400 kV backbone the layer draws is complete.

Of the 60 misses at 1 km, 27 are mapped by OSM with **no usable voltage** (our
own ≥ 50 kV filter drops them, not OSM's silence), 22 carry a voltage below the
floor, and **11 are genuinely absent** — 0.27 %.

## Two traps this had to survive

**The reference is contaminated.** RTE's export is titled "Sites électriques
RTE **et points de piquage**": 816 of its 5,003 records are tap-offs carried on
a pylon, not substation yards. OSM does not tag those `power=substation` and is
right not to. Counting them cost 5 points of apparent coverage before
`fonction_du_poste` was used to separate them; they are now reported apart,
where a low rate reads as the taxonomy difference it is.

**A mirror that lies.** `overpass.osm.ch` serves a Switzerland-only extract and
answers a French bbox with `HTTP 200` and zero elements. During the first sweep
it was the only mirror up, and it wrote 16 confidently empty tiles into the
cache before the fact that central France had no power lines gave it away.
`fetch-osm.mjs` now probes every mirror with a box that unambiguously contains
French high-voltage lines and rejects any that cannot see them. A wrong answer
wearing the costume of a right one is the failure this guards.

## Files

| file | what |
|---|---|
| `lib.mjs` | shapefile (.shp/.dbf) reader, Lambert-93 → WGS84 inverse, geodesy, spatial index — no dependencies, because this machine has neither GDAL nor pyproj |
| `reference.mjs` | downloads the reference into `.gev-cache/grid-audit/` |
| `fetch-osm.mjs` | tiled, cached, extract-probing Overpass client |
| `audit-substations.mjs` | the substation comparison |
| `audit-lines.mjs` | corridor coverage of the routes, resumable; exits non-zero on a partial sweep so a half-measured report is never mistaken for a finished one |

The Lambert-93 inverse is validated twice: exact to 8 × 10⁻¹¹ ° at the
projection origin, and — against a wholly independent source — 51 % of the
shapefile's line endpoints land within 100 m of an archived substation
position, median 94 m, which is what a yard centroid should look like from its
own perimeter.
