# French generating units (≥ 100 MW)

`units.json` is the fleet the **Groupes de prod (FR)** layer draws: every French
generating unit at or above 100 MW, which is exactly the set RTE's
`actual_generations_per_unit` resource publishes output for. It exists because
**RTE publishes no coordinate for any unit** — its API returns an EIC code, a
name, a production type and a number of megawatts, and nothing else.

Rebuild it with:

```
npm run rte:units                    # writes this file
npm run rte:units -- --report        # and prints the placement audit
npm run rte:units -- --refresh-osm   # re-query Overpass instead of the cache
```

The two country-wide Overpass queries are cached under `.gev-cache/` because
public mirrors are unreliable — one build drew 429, 502, 504, a DNS failure and
one mirror answering `200` with an empty database inside twenty minutes. A run
that cannot reach OpenStreetMap **fails** rather than writing a registry with
every non-EDF station demoted to its commune centre; pass `--allow-partial` to
accept that deliberately.

## What is in it

- `units[]` — 171 units keyed by **EIC code**, which is the join key RTE's API
  also uses. Installed power, filière class, connection voltage, regime,
  commissioning date, and the station each one belongs to.
- `sites[]` — 108 stations, grouped by the RTE connection substation the
  register names (`postesource`). Name, class, commune, installed power, the
  class mix when a station burns more than one thing, and a position.

## Where the positions come from

No single dataset publishes both a unit's identity and its location, so four
are joined at build time and **every station records which of them it got**:

| `placement` | count | what it is |
|---|---:|---|
| `edf-published` | 69 | EDF's own coordinate for its own station, from EDF Open Data, matched on the `centrale` name |
| `osm-plant` | 11 | the OpenStreetMap `power=plant` outline of the station itself, matched by name and source class |
| `rte-switchyard` | 13 | the OpenStreetMap `power=substation` carrying the `ref:FR:RTE` code the register names — the yard, not the generating hall |
| `commune-centre` | 15 | the centre of the commune, from `geo.api.gouv.fr`, because nothing better is published |

`anchorKm` is the distance from that anchor to the commune centre, and
`placementRef` is the source element, EDF station or INSEE code it came from. A
candidate more than `maxAnchorKm` (30 km) away is refused rather than trusted,
and two anchors are never averaged: an average of two published positions is a
third, unpublished one.

### Why EDF outranks OpenStreetMap

Measured 2026-08-28 across the 69 stations where both publish a position: they
agree to within **300 m on every reactor and every thermal site**, and diverge
by up to **9.5 km on hydro** — where one scheme spreads a powerhouse, an intake
and a dam across a valley under names that all match, and where the operator is
the only party who knows which of them IS the station. Of the 68 stations that
previously had a non-commune anchor, taking EDF's moved 11 of them more than
500 m *closer* to the commune the register independently names and 6 more than
500 m further; the rest moved less than that.

It is not unanimous, and the file says so rather than hiding it: every
`edf-published` row carries **`supersededOsmKm`**, the distance to the
OpenStreetMap candidate it outranked, so the tier order is auditable per
station instead of resting on this paragraph. The twelve rows above 3 km are
all hydro.

Four of the `commune-centre` stations are **offshore wind farms**, so their
rings sit on the beach rather than 15 km out to sea. OpenStreetMap maps no
`power=plant` for them and no open dataset publishes their footprint; the layer
says so on the card rather than quietly moving them.

## The join's real limit

The EIC code joins RTE's live output to this register exactly for **nuclear and
thermal**, where both publish one row per generating unit. It fails wholesale
for **hydro**: this register carries one row per PLANT (Grand'Maison is one row,
EIC `17W100P100P02756`, 1 690 MW) while RTE publishes the twelve turbine groups
inside it under twelve different codes. Measured on the live API 2026-08-28:
**55 of 152 units, 36% of the fleet and 1 914 MW**, had no code here.

Those units reach their station through a match on RTE's `<STATION> <n>` unit
name instead, and every one of them is marked `matchedBy: 'name'` — weaker
evidence than a published code, and the card says so. An ambiguous name is
refused rather than assigned.

Nobody publishes where an individual **reactor** is — OpenStreetMap has zero
`power=generator` + `generator:source=nuclear` elements over France — so the
layer draws the station once and lists its groups on the card.

## Sources and licences

- **ODRÉ**, *Registre national des installations de production et de stockage
  d'électricité* (edition of 30/06/2026) — Licence Ouverte 2.0.
- **EDF Open Data**, localisation of EDF SA's nuclear, hydraulic and
  thermal-à-flamme stations — Licence Ouverte 2.0. Read from the portal's
  native data-fair routes: opendata.edf.fr has migrated to Koumoul and the
  `/api/v1/datasets` route most links still point at answers the SPA's HTML
  404.
- **OpenStreetMap** contributors, `power=plant` and `power=substation`
  `ref:FR:RTE` — ODbL 1.0. Keep the contributor attribution when
  redistributing this derived database.
- **geo.api.gouv.fr**, commune centres — Licence Ouverte.
