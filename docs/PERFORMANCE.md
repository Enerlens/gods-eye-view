# Performance baseline

This page records two different things, and confusing them is the mistake it
now exists to prevent.

*Test context* through *Controls for a future capture* are **one
hardware-rendered Apple M5 comparison** captured on 22 August 2026 in Chrome 150
at 1440 x 900 — a machine that hides every cost a small laptop pays. It is not a
minimum hardware specification and should not be used to predict performance on
untested systems. The original capture artifacts are not included, so those
sections record results rather than defining a runnable benchmark.

*Small-laptop lab profile*, *Origin capacity* and *Reference machine* are the
**small-laptop campaign** of `docs/PLAN-PERFORMANCE.md` (phase 0), added
9 September 2026: a throttled lab profile, the origin under a crowd, and the one
measurement that still needs real hardware. Each is runnable —
`npm run perf:boot`, `perf:warm`, `perf:layers`, `perf:origin` — and each says
what it cannot see.

## Test context

The baseline was captured on 22 August 2026 with these conditions:

| Setting | Value |
| --- | --- |
| Renderer | Apple M5 Metal through the hardware ANGLE path |
| Browser | Chrome 150 in a fresh isolated profile |
| Viewport | 1440 x 900 at device pixel ratio 1 |
| Focus | Page foregrounded for controlled scenes |
| Scene sample | 5 seconds of scripted motion, then 5 seconds at rest |
| Startup | Browser cache disabled; three samples |

The capture covered three startup samples, 16 cold layer scenarios with 14
measurements, 23 controlled option and stress scenes, and five
hardware-rendered overlay scenes.

## Startup

| Sample | App ready | Initial settle | Load event | Motion / rest | Used JS heap |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 784.980 ms | 2,035.082 ms | 439.5 ms | 60 / 60 FPS | 102.9 MiB |
| 2 | 604.849 ms | 1,855.836 ms | 442.4 ms | 60 / 60 FPS | 111.6 MiB |
| 3 | 558.527 ms | 1,809.592 ms | 438.8 ms | 60 / 60 FPS | 105.1 MiB |
| Median | 604.849 ms | 1,855.836 ms | 439.5 ms | 60 / 60 FPS | 105.1 MiB |

The initial-settle measurement is the more useful launch reference because it
includes the first visual and data settling window. All three samples reached
the display ceiling during both motion and rest.

## Cold layer activation

Cold activation was measured separately from warm option switching. Live object
counts are included so that future runs can compare source populations before
attributing a difference to the client.

| Layer | Activation | Source count | Motion / rest | Used JS heap |
| --- | ---: | ---: | ---: | ---: |
| CCTV city | 19,608.240 ms | 48 | 60 / 60 FPS | 192.7 MiB |
| Space Missions (report label: Rocket missions) | 3,581.066 ms | 26 | 60 / 60 FPS | 131.3 MiB |
| Radio | 3,458.709 ms | 750 | 60 / 60 FPS | 124.8 MiB |
| Bikeshare | 2,069.498 ms | 633 | 60 / 60 FPS | 157.4 MiB |
| Datacenters | 817.693 ms | 4,362 | 59.6 / 60 FPS | 328.2 MiB |
| Flights | 667.671 ms | 247 | 60 / 60 FPS | 118.4 MiB |
| Submarine cables | 614.727 ms | 2,629 | 60 / 60 FPS | 412.0 MiB |
| Military Flights | 557.113 ms | 68 | 60 / 60 FPS | 118.4 MiB |

CCTV had the largest cold activation cost in this capture. Submarine cables
used the most heap, followed by datacenters. Completed single-layer samples
generally reached 60 FPS, so activation time and heap separate these cases more
clearly than steady-state frame rate.

## Aircraft, detection, and Cockpit

| Scene | Motion / rest |
| --- | ---: |
| Idle globe | 60 / 60 FPS |
| Flights, 2D | 60 / 60 FPS |
| Flights, 3D proximity | 60 / 60 FPS |
| Flights, all 3D models | 60 / 60 FPS |
| Military Flights, all 3D models | 60 / 60 FPS |
| Detection at 25% | 39.3 / 41.1 FPS |
| Detection at 50% | 37.4 / 39.8 FPS |
| Detection at 100% | 34.4 / 35.5 FPS |
| Cockpit | 49.6 / 49.2 FPS |

The clean detection scenes processed 8,169 to 8,170 observations. Selected
labels rose from 14 at 25% density to 28 at 50% and 56 at 100%. The aircraft
rows came from an earlier loaded, foreground-controlled pass because the clean
rerun received no live aircraft rows.

## Visual styles and combined stress

| Scene | Motion / rest |
| --- | ---: |
| Normal | 60 / 60 FPS |
| CRT (report label: Retro) | 60 / 60 FPS |
| NVG (report label: Surveillance) | 60 / 60 FPS |
| FLIR (report label: Thermal) | 49 / 60 FPS |
| Anime | 60 / 59.8 FPS |
| Noir | 47 / 56.6 FPS |
| Snow | 42.3 / 45.8 FPS |
| Combined static | 57.6 / 60 FPS |
| Combined operational | 39.9 / 43.1 FPS |

The combined static scene rendered 11,575 objects, used 872.2 MiB of JavaScript
heap, and issued 48,665 text draws during motion and 54,106 at rest. The combined
operational sample contained 3,909 observations and two selected labels, but its
live aircraft and traffic rows were empty, so it remains a limited stress case.

Snow, Noir, dense detection, and text-heavy combined layers are the clearest
controlled comparison points for later optimization work.

## Keyed live sources

NASA FIRMS, AISStream, and TomTom were captured in a separate hardware-rendered
pass. The page was visible but was not the focused window, so these frame rates
must not be compared directly with the foreground-controlled scenes above.

| Source | Point-in-time population | Activation or coverage | Motion / rest |
| --- | ---: | --- | ---: |
| NASA FIRMS | 100,430 detections in 3,557 cells | 30.0 s activation | 32.1 / 55.2 FPS |
| AISStream | 12,000 vessels | 6.4 s activation | 22.1 / 29.8 FPS |
| TomTom Traffic | 4,222 road dots | 70% coverage, 2 decoded tiles | 45.0 / 51.7 FPS |

These populations change continuously. A future comparison must record the
live counts again and match the focus conditions.

## Controls for a future capture

Use the same controls before attributing a difference to the application:

1. Record the exact GPU renderer and reject software-rendered or unavailable GPU
   strings.
2. Use a 1440 x 900 viewport at device pixel ratio 1 and keep the page focused.
3. Measure cache-disabled startup separately from cold layer activation and warm
   option switching.
4. Repeat startup three times and compare medians.
5. Sample each option for 5 seconds in scripted motion and 5 seconds at rest.
6. Record live object counts before attributing a difference to the client.
7. Treat a live-source outage as missing coverage, not as evidence of low client
   rendering cost.

## Small-laptop lab profile (phase 0.1 to 0.2)

Measured 9 September 2026 on `origin/main` at `9701e35` — before #123 split the
JavaScript entry chunk. Re-measured on `50a8827` immediately after it landed,
the app cost falls from **2.67 MB to 2.23 MB [2.22–2.23]**; the timing column of
that second run is not usable (the Mac was at load 22.5) and is not reproduced
here. Nothing else in this section moves with that change.

Method: `npm run perf:boot` against `npm run build` + `vite preview` on the
development Mac. The profile is the one `docs/PLAN-PERFORMANCE.md` § 0 defines: **CPU ÷4,
10 Mbit/s / 60 ms, 1366×768, cache disabled**, median of five with `[min–max]`.

These are CPU milliseconds. Headless Chromium renders in software, so the frame
times below compare runs of this probe to each other and to nothing else — see
"Reference machine" for the measurement they cannot replace.

| | Cold, no layer | **Warm cache**, no layer | Lyon + 3 French layers |
| --- | ---: | ---: | ---: |
| `viewer` ready | 3,572 ms [3,558–3,591] | **603 ms [592–964]** | 3,590 ms [3,557–4,007] |
| DOMContentLoaded | 2,975 ms | **373 ms** | — |
| First frame | 3,574 ms | 618 ms | — |
| App bytes / requests | 2.67 MB / 29 | **0.00 MB / 28** | 2.67 MB / 29 |
| 25 s window, tiles included | 5.90 MB / 244 | 0.00 MB / 241 | 5.90 MB / 244 |
| JS heap | 25 MB | 25 MB | **40 MB [38–47]** |
| Bytes after switch-on (15 s) | 1.51 MB / 148 req | — | **3.98 MB / 152 req** |
| Parked, renders / 5 s | 0 | 0 | **301 [300–301]** (`transit-fr`) |
| Orbit p90 / p99 | 18.7 / 23.0 ms | 19.5 / 24.6 ms | 19.5 / 31.6 ms |

Four readings that are not obvious from the table:

- **A returning visitor pays nothing and waits 0.6 s.** "0.00 MB over 28
  requests" is not a missing measurement: every same-origin request was served
  from the HTTP cache, so `encodedDataLength` is genuinely zero, and the only
  bytes on the wire were ~1 kB to `api.cesium.com`. The `immutable` headers
  already in `vite.config.js` do that work. It also means the warm figure does
  **not** isolate parse from network — V8's code cache removes most of the
  first-compile cost too — so it bounds the second visit rather than explaining
  the first.
- **Turning three French layers on does not slow the boot** (3,590 vs 3,572 ms)
  and costs 15 MB of heap, well inside the 250 MiB the plan allows. On the wire
  it costs **2.47 MB over four requests**: the matched control — same viewpoint,
  same settle, no layer — pays 1.51 MB over 148, so each French layer arrives as
  one bulk payload.
- **The parked scene never stops drawing, and it is `transit-fr` alone.**
  Measured one layer at a time at the same viewpoint: `irve-fr` 0 renders / 5 s,
  `schools-fr` 0, `transit-fr` **300**. This is not the leak that phase 2.5
  fixed — the render governor reports `mode: "continuous"` with
  `holds: ["transit-fr"]`, and returns to `idle` with no holds the moment the
  layer is switched off. It is deliberate: a layer that animates vehicles asks
  for frames. What was never priced is the bill — **60 fps for as long as the
  tab is open**, on a machine the plan wants to keep cool. Note that
  `scripts/qa-perf.mjs` cannot see this: its parked check disables every layer
  first, so 24/24 and a scene that never idles are compatible today.
- **One cold orbit sample was starved**, not slow: a single frame took 73
  seconds while a peer benchmark ran on the same Mac. The median absorbs it; the
  `[min–max]` is what exposes it, which is why the probe never prints a median
  alone.

## Origin capacity — fifty cold visitors at once (phase 0.4)

Measured 9 September 2026 with `scripts/perf-origin-bench.mjs`, **run on the
VPS** against `http://127.0.0.1:4173`. It has to run there: `gev.enerlens.com`
is behind a Cloudflare rule capping `/api` at 30 req/10 s per IP, and a run from
the Mac would measure that rule rather than the server. Build under test:
`voix-gev-sans-cle-api@2b396bf`, the branch staging was pinned to that day.
Host: Hostinger KVM 2 (2 vCPU, 8 GB) shared with the Enerlens production stack;
the `gev` container still has neither `mem_limit` nor `cpus`.

Each virtual visitor replays the **recorded 23-request boot** — `/`, the two
scripts, the CSS, the fonts, the Cesium assets, the three same-origin `/api`
calls — then starts over as a new visitor. Requests use keep-alive and accept
gzip, like a browser.

| Load | Boots served | Requests | p50 | p95 | p99 | Egress | Container CPU | Container RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 visitors, 10 s | 62 (6.0/s) | 476 | 21.9 ms | 901 ms | 1,004 ms | 16.8 MB/s | 173 % | 295 MiB |
| 25 visitors, 10 s | 56 (5.2/s) | 478 | 63.2 ms | 2,287 ms | 2,340 ms | 16.8 MB/s | 176 % | 369 MiB |
| 50 visitors, 30 s | 166 (5.3/s) | 4,023 | 69.5 ms | 2,080 ms | 4,163 ms | 17.7 MB/s | 175 % | 345 MiB |

The first two rows replay the seven assets discoverable from the served HTML;
the third replays the full 23-request trace. All 4,023 responses were 200.

**Both plan targets are met, and neither is where the problem is.** `/api` p95
under this crowd is **19 to 34 ms** across the three boot endpoints — the target
was 1 s — and the container peaks at **345 MiB** against a 1 GiB ceiling. What
saturates is the delivery of static bytes:

| Path | p95 | p99 |
| --- | ---: | ---: |
| `/cesium-1.138.0/Cesium.js` | 4,271 ms | 4,304 ms |
| `/assets/index-*.js` | 2,042 ms | 2,080 ms |
| `/cesium-.../approximateTerrainHeights.json` | 330 ms | 348 ms |
| `/api/geoid`, `/api/google/2d-session` | 19–34 ms | 29–40 ms |

**The ceiling is gzip, not bandwidth.** Throughput is 16.8 to 17.7 MB/s at 10,
25 and 50 visitors alike — flat — while the container sits at 175 % of the
200 % this box can give. `vite preview` ships **no pre-compressed asset**:
verified on staging, a request for `/assets/index-*.js` returns
`Content-Encoding: gzip` with no `Content-Length`, so 2.5 MB are compressed on
the fly, per visitor, alongside Cesium's 5.7 MB. Serving pre-built `.br`/`.gz`
files (plan task 1.6) turns that CPU into a file read, and it is the same task
that cuts client bytes — one change, two ceilings.

Two mitigations already in place, and their limit: Cloudflare caches
`/cesium-*/*` and `/assets/*` at the edge (`cf-cache-status: HIT` on the second
request, verified the same day), so a real crowd mostly never reaches the
origin. The exception is the window right after each deploy, when the content
hash changes and the first visitor per asset pays a MISS — and staging
redeploys every three minutes while a PR is open.

## Reference machine — the small laptop (phase 0.3)

The M5 numbers above hide every cost that decides whether this application is
usable for the reader it is built for: an elected official, a town hall officer,
a local journalist, on a 2018-2020 laptop. `docs/PLAN-PERFORMANCE.md` defines
that machine as 2 cores, **Intel UHD 620 integrated graphics**, 8 GB, 1366×768,
Chrome, a domestic or 4G line.

**No automated harness in this repository can measure it.** Headless Chromium
renders through SwiftShader — in software — so `scripts/perf-boot-probe.mjs`
reports CPU milliseconds and nothing else. The four fixed GPU costs the plan
proposes to cut are invisible there by construction:

| Fixed cost | Where | Why it is invisible headless |
| --- | --- | --- |
| MSAA ×4 | `src/main.js` (`msaaSamples`) | multisample resolve is a GPU pass |
| Sharpen at 49 | `src/ui.js` (four presets) | 9 texture reads per full-screen pixel |
| `preserveDrawingBuffer: true` | `src/main.js` | a full framebuffer copy per frame |
| Render resolution | no `resolutionScale` anywhere | fill rate is the whole cost |

So the measurement is made by hand, once, by somebody holding such a machine.
`scripts/perf-real-gpu-console.js` is that measurement: paste it into the
DevTools console on `https://gev.enerlens.com/?welcome=0`, wait five minutes,
send back the one JSON line it copies to the clipboard. It refuses to report on
a software renderer — a run on SwiftShader is not a failed run, it is a
meaningless one — and it copies the parked/orbit method of `perf-boot-probe.mjs`
exactly, so the two columns stay comparable.

### Recorded runs

| Date | Renderer | Cores | Canvas | Layers | Parked / 5 s | Orbit p50 / p90 / p99 | > 33 ms | > 100 ms |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: |
| — | *no run yet* | | | | | | | |

Targets, from `docs/PLAN-PERFORMANCE.md` § 2: parked **0**, orbit **p90 ≤ 33 ms**
with **no frame over 100 ms**, with three French layers on. Until one row exists
here, tasks 2.1 to 2.4 of that plan cannot be validated, and doing them blind
would repeat the August M5 mistake this page exists to record.

## What is not established yet

- This report does not establish Windows performance. The procedure that would
  — and the empty table waiting for its first row — is under
  "Reference machine" above.
- The report does not record machine memory capacity, so it cannot support a
  minimum-memory recommendation.
- The report does not cover other GPU renderers or viewport configurations.
- Military Installations is outside this comparison because it requires close
  camera context.
- The keyed pass has no controlled rerun suitable for comparison with the
  option scenes.

Use this page as a regression baseline for one known hardware and browser
configuration, not as a compatibility guarantee.
