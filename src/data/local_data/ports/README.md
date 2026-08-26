# Ports — NGA World Port Index (Pub. 150)

World port catalog published by the U.S. National Geospatial-Intelligence Agency.

- **Source API:** `https://msi.nga.mil/api/publications/world-port-index?output=json`
- **Publication:** NGA Pub. 150, *World Port Index*
- **Retrieved:** 2026-08-26 (6.3 MB raw, 2,951 port records)
- **License:** U.S. Government work — **public domain** (17 U.S.C. § 105). No
  attribution is legally required; we credit NGA anyway, in
  [`DATA_SOURCES.md`](../../../../DATA_SOURCES.md) and in the in-app
  "Data attribution" popover.
- **Runtime output:** `ports.geojsonl` (2,951 features, ~1.1 MB)
- **Build:** `node scripts/build-nga-ports.mjs [raw.json]` — deterministic; with
  no argument it downloads the live catalog.

## Read this before trusting a value

**Depths are binned range codes, not surveyed soundings.** They ship under
`approxDepthM` and the layer renders them as `~11 m channel (approx.)` for that
reason. Rotterdam reports an 11 m channel where the real Maasgeul is dredged to
roughly 24 m, and Marseille reports a cargo pier (16 m) deeper than its own
channel (13 m) — both consistent with per-facility binning, neither consistent
with a survey. **Do not route a vessel with this pack.**

**`harborSize` code `V` means *very small*, not "very large".** The ladder runs
V → S → M → L. It is the most common code in the catalog (1,784 of 2,951 =
60.5%), and the ports carrying `L` are Rotterdam, Shanghai, Antwerpen, Busan and
Hamburg while Marseille carries `S`. Verified against those ports on 2026-08-26.
Inverting this scale silently turns three thousand fishing harbours into major
container terminals.

## Fields deliberately dropped

The upstream record carries ~100 fields. These were measured over the full
catalog on 2026-08-26 and excluded rather than shipped:

| Field | Why dropped |
|-------|-------------|
| `portSecurity` | `U` (unknown) for 2,921 / 2,951 — 98.98% |
| `vts` | `U` for 2,940 / 2,951 — 99.63% |
| `tss` | `U` for 2,947 / 2,951 — 99.86% |
| `maxVesselDraft` | Present for 93 / 2,951 (3.2%), observed max 61 m — more than double any real ship's draft |
| `maxVesselLength` | Present for 93 / 2,951, observed max 760 m against a real record of ~458 m |
| `maxVesselBeam` | Present for 61 / 2,951 |

A field that is unknown for 99% of rows is not information. Rendering it would
put "VTS: unknown" under three thousand ports and call it intelligence.

## Transform

1. `xcoord`/`ycoord` → GeoJSON `Point [lon, lat]`, rounded to 5 decimals (~1 m).
   Rows with missing, non-finite, out-of-range, or exactly `0,0` coordinates are
   dropped — Null Island is not a port in the Gulf of Guinea.
2. Coded fields (`harborSize`, `harborType`, `shelter`) decoded to human text.
   A code absent from the decode table is dropped, never guessed at.
3. The `U` sentinel and empty strings are omitted, not emitted as "unknown".
4. Region names are title-cased and interior whitespace runs collapsed (the
   source pads them into fixed-width columns: `ICELAND  WEST COAST`).
5. Features sorted by `portNumber` for a stable diff.

All 2,951 upstream rows survived the transform on the 2026-08-26 retrieval.
