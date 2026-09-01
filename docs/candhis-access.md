# CANDHIS — the French sea-state source, and the key it needs

Status as of **2026-09-01**: **qualified, not yet wired.** The licence is open
and the API is documented; the only thing missing is an access key, which is
requested by email. Nothing here is blocked on a negotiation.

## Why this document exists

`marine-buoys` draws **NOAA NDBC**, and NDBC is a US network. Measured on the
full `latest_obs.txt` report (861 stations, 2026-09-01):

| Box | Stations |
|---|---|
| Metropolitan France (−10…10 E, 41…52 N) | **8 — and all eight are UK Met Office or Irish moorings** in the Channel and the Western Approaches |
| French Antilles | 1 (42060, a US Caribbean mooring) |
| Guyane · Réunion · Mayotte · Polynésie · Nouvelle-Calédonie | **0** |

So in a France fork the layer switches on and draws nobody's French sea state,
because there is none in it. Météo-France's own moored buoys (62001 Gascogne and
the rest) are **not** in the NDBC report either — checked directly.

## The source: CANDHIS (Cerema)

*Observatoire côtier national de mesure in situ des états de mer* — about forty
real-time houlographes, métropole and outre-mer, run by the Cerema with the
DIRMs, Haropa Port, EDF, the Dreals and the port authorities.

- **Licence: Licence Ouverte Etalab v2.0.** Free reuse including commercial,
  subject to naming the source and the date of last update. The wording the
  Cerema asks for is in `01_Utilisation.fr.pdf`: at minimum *« Candhis »*, ideally
  the partner organisations of the campaign — e.g. *« SMBS-GLP et Cerema —
  Données originales téléchargées sur https://candhis.cerema.fr/, mise à jour du
  … »*. The station list is separately published on data.gouv.fr under `lov2`.
- **API: `https://candhis.cerema.fr/API/v1/`**, REST, JSON, **GET only**.
  Auth is an `Authorization: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` header. There
  is a daily request quota (HTTP 429) and IP banning (HTTP 423).
  Reference: `https://candhis.cerema.fr/doc/04_Candhis_API_v1_Utilisateur.pdf`.

| Endpoint | What it returns |
|---|---|
| `getCampListe.php?type=N` | every campaign of one houlographe type |
| `getCampInfos.php?camp=ccccc` | name, latitude, longitude, depth, directional flag, sensor model |
| `getCampZone.php?zone=Zxx` | campaigns in a zone (Z01 métropole … Z05 Antilles/Guyane/SPM, Z06 Réunion/Mayotte) |
| `getCampTR.php?camp=…&dateDeb=…` | real-time series for one campaign |
| **`getCampListeTR.php?type=N`** | **the latest hourly reading for the WHOLE network of one sensor type, in one call** |

`getCampListeTR` is the shape this app wants: one request per houlographe type
(0 non-directional H13, 1 directional Hm0, 2 directional H13) covers the network,
exactly as `/api/ndbc` covers NDBC with one fetch.

Its columns map onto the card `src/data/marineBuoys.js` already writes:

| CANDHIS | `marineBuoys.js` |
|---|---|
| `H1/3 (m)` / `Hm0 (m)` | `waveHeightM` |
| `TH1/3 (s)` / `Tp (s)` | `dominantPeriodS` |
| `Dir. au pic (°)` | `waveDirDeg` |
| `Temp. mer (°C)` | `seaTempC` |
| `Hmax (m)`, `Étal. au pic (°)` | new lines, or dropped |

Sea state colours on the WMO ladder already in `SEA_STATE_BANDS` need no change:
CANDHIS publishes metres, same as NDBC.

## The one action that unblocks it

Send this to **candhis@cerema.fr**. The three fields are the ones the API manual
requires; the domain and structure values must be chosen from its own lists.

> Objet : Demande de clé d'accès à l'API Candhis
>
> Bonjour,
>
> Je souhaite obtenir une clé d'accès à l'API Candhis (v1) afin d'afficher
> l'état de la mer mesuré par le réseau sur un globe cartographique ouvert
> (projet God's Eye View, visualisation de données publiques françaises).
>
> - Nom : …
> - Domaine d'activité : atlas de données
> - Type de structure : particulier
>
> L'usage prévu est un appel horaire à `getCampListeTR.php` pour les trois types
> de houlographes, mis en cache côté serveur, afin d'afficher Hs, la période, la
> direction et la température de surface par bouée. La mention « Candhis » et la
> date de mise à jour accompagneront systématiquement l'affichage, conformément
> à la Licence Ouverte v2.0.
>
> Cordialement,

Once the key lands, it belongs in the repo-root `.env` as `CANDHIS_API_KEY`,
behind a `/api/candhis` proxy shaped like `/api/ndbc` (one poll, disk cache,
serve-stale) — and the layer degrades keyless exactly as `rte-generation` does.

## What was considered and rejected

- **SHOM / REFMAR** — the wrong subject. Its network is tide gauges: they
  measure sea *level*, not sea *state*. No wave height, no period, no direction.
  `services.data.shom.fr` is also key-gated with a narrower licence.
- **EMODnet Physics (ERDDAP)** — keyless and European, but it is a per-platform
  research catalogue, not a "latest observation for the network" endpoint: each
  buoy is its own dataset, discovered separately. Its French wave data
  originates from CANDHIS anyway, with added delay.
- **Météo-France SYNOP (data.gouv, keyless, LO)** — 62 stations, all of them on
  land. Checked directly; no moored buoy in it.
- **Copernicus Marine In Situ TAC** — requires an account, and is a delayed-mode
  archive rather than a live network snapshot.
