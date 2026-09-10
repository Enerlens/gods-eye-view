# Mégafeu de Gironde — 22 juillet au 1ᵉʳ août 2026

Pack figé pour la couche `gironde-megafire-2026`. Reconstruit par
`node scripts/build-gironde-megafire-2026.mjs` (voir l'en-tête du script pour
les sources et la raison pour laquelle rien n'est relu à l'exécution).

Construit le 2026-09-10.

## Ce que le pack contient

| Fichier | Contenu |
| --- | --- |
| `event.json` | Les cinq périmètres Copernicus datés, leurs fronts et leurs flammes, le périmètre final EFFIS, et les statistiques publiées par Copernicus pour chaque produit. |
| `hotspots.json` | Les détections NASA FIRMS de la fenêtre, en minutes depuis son ouverture. |

## Les cinq images

| Acquisition (UTC) | Produit | Capteur | Surface brûlée publiée | Polygones dessinés |
| --- | --- | --- | ---: | ---: |
| 2026-07-24 09:05 | DEL_PRODUCT | Pléiades Neo (Legion) | 5 775,4 ha | 42 |
| 2026-07-26 10:12 | DEL_MONIT01 | Pléiades Neo (Legion) + Sentinel-2 | 24 857,4 ha | 662 |
| 2026-07-27 16:16 | GRA_PRODUCT | Pléiades Neo (Legion) | 28 284,7 ha | 490 |
| 2026-07-29 14:07 | DEL_MONIT02 | Pléiades Neo (Legion) | 31 602,4 ha | 144 |
| 2026-08-01 11:38 | GRA_MONIT01 | Pléiades Neo (Legion) | 31 326,5 ha | 126 |

La colonne « surface brûlée publiée » est celle de Copernicus, jamais recalculée
à partir du dessin. `measuredHa` (géométrie brute) et `drawnHa` (après
simplification) sont conservés dans `event.json` pour que l'écart reste
mesurable.

## Les points chauds

9 524 détections retenues dans la fenêtre, dont 3 775 le 2026-07-24 — le jour le plus actif.
Puissance radiative maximale sur un pixel : 1 573,57 MW.

## Crédits

- **Copernicus EMS Rapid Mapping** — © Contains modified Copernicus EMS Rapid Mapping data (EMSR899) 2026  
  Copernicus data and information policy — Reg. (EU) 1159/2013 · <https://mapping.emergency.copernicus.eu/activations/EMSR899/>
- **EFFIS** — © European Forest Fire Information System — EFFIS, Copernicus EMS  
  Copernicus data and information policy · <https://forest-fire.emergency.copernicus.eu/>
- **NASA FIRMS** — NASA FIRMS — VIIRS (S-NPP, NOAA-20, NOAA-21) and MODIS active fire data  
  Public domain (NASA open data) · <https://firms.modaps.eosdis.nasa.gov/>

