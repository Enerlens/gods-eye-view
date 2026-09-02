# `velo_pulse/` — one typical week of cycling, in Lyon and in Paris

`pulse.json`, rebuilt by `npm run velo:pulse`
(`scripts/build-velo-pulse.mjs`).

## What is in it

168 numbers per site — one per hour of a typical week, Monday 00:00 first —
averaged over **four weeks of June 2026** (2026-06-01 → 2026-06-28), read in
**local wall-clock time** in both cities.

```
{ generated, window: {start, end, weeks}, slots: 168, note,
  cities: {
    lyon:  { label, instrument: "stock", unit, scale: 1000, source, licence,
             sites: [{ id, name, commune, lon, lat, capacity,
                       profile: [168], samples: [168] }] },
    paris: { label, instrument: "flow",  unit, scale: 1,    source, licence,
             sites: [{ id, name, direction, installedOn, lon, lat,
                       profile: [168], samples: [168] }] } } }
```

`profile[i]` is `null` where no reading landed in that hour of the week;
`samples[i]` says how many of the four weeks contributed. Lyon's occupancy is
stored in **tenths of a percent** (`scale: 1000`) so the pack holds integers —
a float per slot would triple the file for precision the source does not have.

## The two cities are measured by two different instruments, and that is the point

The Métropole de Lyon publishes the availability of every Vélo'v station
continuously since **2023-03-27** — filterable per station and per date, and the
only archive of its kind in France.

**Paris publishes no equivalent for Vélib' at all.** Checked 2026-09-02:

| where | what it answers |
|---|---|
| `opendata.paris.fr` | two Vélib' datasets, **both real-time only** |
| `data.gouv.fr` | no availability history for Vélib' |
| `transport.data.gouv.fr` | the dataset's `history` array is **empty** |
| `lovasoa/historique-velib-opendata` | last pushed **2023-04-04**, release assets dated **2021** |

So Paris is read through its 111 permanent bike counters instead:

- **Lyon — STOCKS.** How full a dock is. A station that empties every weekday
  morning and refills every evening is a commuter origin; the reverse is a
  destination.
- **Paris — FLOWS.** How many cyclists pass a counter. People going by, not
  bicycles standing still.

Nothing in this pack puts the two on one scale. What the layer compares is each
site against **itself** — the share of its own weekly maximum — which means the
same thing in both cities while the absolute number keeps its own unit.

## Two traps the build had to survive

1. **Paris timestamps are UTC and the profile is local.** The ODS `date` field
   is `2026-06-01T00:00:00+00:00`. Grouping on `date_format(date, "H")` without
   a timezone gives the UTC hour and the morning peak lands at 04:00–05:00 —
   measured on counter `100003096`, whose 04:00 bucket reads **38** without a
   timezone and **4** with `timezone=Europe/Paris`. Every query passes it.
2. **Lyon's archive does not write every station every minute.** A 5-minute
   window over the whole network returned 332 of 454 stations in one probe and
   360 in another; 10 minutes returned all 454. The build samples a 5-minute
   window per hour and leans on four weeks to fill the gaps — a station present
   73 % of the time is present in at least one of four samples 99.5 % of the
   time — and records `samples[i]` so the layer can say how many landed. A
   station sampled in fewer than half the week's hours is **dropped and
   counted**, never drawn with holes in it.

A `CLOSED` station is skipped rather than averaged in as 0 %: a maintenance
outage is not an empty dock, and averaging it as one would draw it as a
commuter origin.

## Why one fixed four-week window and not all of it

A typical week in June is not a typical week in January, and averaging thirteen
months would hide that rather than solve it. Both cities are read over the
**same** four weeks so the two pictures describe the same days. June is chosen
because it is an ordinary month in France — August is the holiday exodus and
would flatter Lyon's quieter stations.

## Cost, measured 2026-09-02

| city | requests | bytes pulled | note |
|---|---|---|---|
| Lyon | 672 (one per hour) | ~215 MB | paced at 300 ms; the portal never sees more than three windows a second |
| Paris | 113 (one per counter) | ~1 MB | one server-side aggregation each, `group_by` on day-of-week and hour |

## Licences

- Lyon — **Licence Ouverte 2.0**, Métropole de Lyon / JCDecaux.
- Paris — **ODbL**, Ville de Paris.

Both are attribution-only and both are registered in the app's Data attribution
popover.
