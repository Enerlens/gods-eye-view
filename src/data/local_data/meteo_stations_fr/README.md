# Where France measures the weather, and what each instrument can tell you

`stations.json` is the network the **Stations météo (FR)** layer draws: every
station in Météo-France's real-time observation network, joined to what each one
actually measures.

It exists because the globe already showed the weather three times — Open-Meteo's
conditions in the cockpit, Météo-France's vigilance colours per département,
Vigicrues on the rivers — and never once showed **where the numbers come from**.
A vigilance map is an interpretation of readings taken somewhere. This is the
somewhere.

Rebuild it with:

```
npm run meteo:stations                              # writes this file
npm run meteo:stations -- --report                  # and prints the per-département table
npm run meteo:stations -- --keep-fiches=/tmp/f.json # cache the 191 MB inventory between runs
```

## What is in it

Measured on the 2026-09-02 build:

- **2 144 stations**, 1 818 in metropolitan France and 326 overseas, from the
  tide line to the **Aiguille du Midi at 3 845 m** — the highest weather station
  in the country, with La Meije-Nivôse at 3 093 m and Bellecôte-Nivôse at
  2 992 m behind it.
- **696 in the RADOME reference pack**, expertised at J+1, and 1 448 in the
  extended pack.
- **190 that publish their readings in the open**, with no API key.
- **1 230 with a published *fiche climatologique*** — the records held at that
  station and the period they were established over, fetched per card.
- Fourteen instrument booleans per station, and the class derived from them.

## The one fact this file exists to carry

**A French weather station usually is not a weather station.**

A reader expects 2 144 identical instruments, each knowing the temperature, the
wind, the pressure and the humidity. Measured against Météo-France's own
per-station parameter inventory:

| instrument | stations | | instrument | stations |
|---|---:|---|---|---:|
| température sous abri | 2 084 | | insolation | 228 |
| précipitations | 2 068 | | visibilité | 211 |
| humidité | 860 | | temps présent | 206 |
| vent à 10 m | **845** | | nébulosité | 186 |
| neige au sol | 309 | | température de chaussée | 149 |
| rayonnement global | 270 | | température du sol | 132 |
| pression | **234** | | état de la mer | 44 |

**1 254 of the 2 144 — 58 % — measure temperature and rain and nothing else.**
Only **228** measure the five parameters the phrase "weather station" means, and
only **845** can tell you which way the wind is blowing. That measurement is the
layer's palette:

| class | count | what it can answer |
|---|---:|---|
| Synoptique complète | 228 | température, pluie, vent, humidité, pression |
| Automatique avec vent | 565 | température, pluie, vent — pas de pression |
| Température et pluie | 1 254 | ni le vent ni la pression |
| Température seule | 37 | thermomètre sans pluviomètre |
| Pluviomètre | 21 | la pluie et rien d'autre |
| Autres capteurs | 33 | ni température ni pluie |
| Inventaire non publié | 6 | rien n'est publié sur cette station |

## Why the instrument list is anchored, not keyword-matched

Météo-France publishes **254 parameter names** for this network and most of them
are DERIVED statistics: `NOMBRE DE JOURS AVEC TX>=35°C`, `CUMUL DES DJU SEUIL 18
METHODE CHAUFFAGISTE`, `SOMME DES TNTXM QUOTIDIEN SUP A 8°C`.

Matching on the word "TEMPERATURE" would count a degree-day accumulator as a
thermometer. Matching on "VENT" would count `MOYENNE DECADAIRE DE LA FORCE DU
VENT` — present on **879** stations — as an anemometer, when only **845** have
one. Each family is therefore anchored on the station's own HOURLY base reading,
which exists if and only if the instrument does. A parameter carrying a
`dateFin` is a decommissioned instrument and is not read: reporting one would
put an anemometer on a mast that came down in 2011.

## Four things this file records that the publisher's own files disagree about

**The SYNOP station list names 62; the SYNOP archive contains 190.** Boulogne,
Le Touquet, Dunkerque, Dieppe, Beauvais-Tillé, Ouessant-Stiff and 123 others
write an open hourly observation the list never mentions, and every one of the
190 resolves to a station in the real-time list. It fails the other way too:
**CAP CEPET is named in the list and has written nothing all year.** So `synop`
(named) and `live` (publishing) are separate fields, and the layer counts the
second.

**Seven stations in the real-time list are closed.** MARSILLARGUES on
2026-01-01, BASSE-TERRE GUILLARD on 2026-02-11, DESHAIES GENDARMERIE on
2024-10-01, ST JOSEPH-CIRAD and TAN ROUGE-CIRAD on 2023-03-29, DEMBENI and
MAMOUDZOU_SAPC on 2025-04-01. Météo-France's own metadata says so and its own
real-time list still carries them. They are kept, flagged, and drawn hollow.

**Six stations exist in no metadata file at all.** ALBA LA ROMAINE, SOULAINES,
TARASCON, PIOGGIOLA, QUERCITELLO and MURAT SUR VEBRE. `fam` is `null` for them,
not `[]` — "nobody documented this" and "this measures nothing" are different
facts and must stay testable apart.

**The popular SYNOP mirrors died on 2026-01-15.** Every OpenDataSoft copy of
*Données SYNOP essentielles OMM* — `public.opendatasoft.com` and the Toulouse
Métropole instance data.gouv itself links to — stops at 2026-01-15T09:00Z,
measured 2026-09-02. Météo-France's own S3 archive was written that same morning
and carries observations to the previous hour. Anything reading a mirror for
"current French weather" has been serving a seven-month-old reading since
January.

## What is NOT in this file, and why

**The 12 347 closed climatological postes.** `POSTES_MF.csv` carries every poste
back to **1806** and only 2 404 are still open. A layer of historical postes is a
different layer with a different argument, and drawing them beside live
instruments would say the network is five times its real size.

**The 699 *stations complémentaires*.** Type 5, published separately, 535 of them
open, run by the DGPR, the DIR routes, the DREAL, EDF and INRAE. None appears in
the real-time list — verified, the intersection is empty — and Météo-France does
not guarantee their expertise.

**The Infoclimat / StatIC network.** 1 138 French stations, and **553 of them are
CC BY-NC**: more than half the file forbids commercial reuse, station by station.
Mixing it in would ship a licence trap.

**Every reading.** The observation and the records are fetched at runtime, never
bundled: 1 230 fiches × 6 kB is 7 MB to answer a question most readers never
ask, and a bundled temperature is wrong within the hour.

## Fields

| field | meaning |
|---|---|
| `id` | `NUM_POSTE`, 8 digits `DDCCCNNN`. The join key everywhere. |
| `omm` | WMO indicative, on 287 stations. Having one ≠ publishing. |
| `synop` | Named in Météo-France's SYNOP station list (62). |
| `live` | Actually present in the SYNOP archive (190). |
| `name`, `commune`, `place` | As published — never prettified, the name is half an identifier. |
| `lat`, `lon`, `alt` | WGS84 and metres. |
| `dep` | Two digits, or three overseas. **Corsica is `20`** — `NUM_POSTE` uses the 1976 numbering and no station carries `2A`/`2B`. |
| `pack` | `RADOME` or `ETENDU`. The publisher's own word, not a quality score. |
| `type` | Météo-France poste type 0–4, verbatim from `POSTES_descriptif_champs`. |
| `opened`, `closed` | `YYYY-MM-DD`. `closed` non-null on the seven above. |
| `fam` | Instrument family keys, or **`null`** when no inventory exists. |
| `klass` | The class in the table above, derived from `fam`. |
| `fiche` | A *fiche climatologique* is published for this poste. |

## Sources

All four are Météo-France, all under
[Licence Ouverte 2.0](https://github.com/etalab/licence-ouverte/blob/master/LO.md)
— attribution required, including the data's own date.

1. **Liste des stations du réseau d'observation temps réel**, via data.gouv.fr.
   The spine: position, altitude, opening date, pack.
2. **Informations sur les stations — `fiches.json`**, 191 MB from Météo-France's
   S3. Read for one thing: the parameters each station measures today. Fourteen
   booleans per station survive; the rest is discarded. There is no smaller form
   of this file.
3. **`POSTES_MF.csv`** — commune, lieu-dit, poste type, and `DATFERM`, which is
   the only way to learn that seven live-listed stations are closed.
4. **Liste des stations SYNOP** — the 62 the publisher says publish openly.

Plus one listing rather than a download: the S3 index of
`REF_STATION/FICHECLIM_*.data`, which says which stations have a published
fiche. Asking 1 578 HEAD requests to learn a boolean the index already states
would be absurd.
