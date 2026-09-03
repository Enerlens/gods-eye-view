# Deploying this fork

God's Eye View is **not a static site**. `vite.config.js` carries ~35 middleware
proxies that broker API keys, cache upstream answers on disk and hold the AIS
websocket open, so a deployment has to run a Node process — `vite preview`,
which serves the built bundle *and* those proxies. Anything that only uploads
`dist/` gives you a globe with no live layers.

Two consequences shape everything below:

1. **A reachable origin is a spendable wallet.** `/api/realtime/token` and
   `/api/google/nearby-places` cost real money per call. Set
   `GEV_ACCESS_PASSWORD` before the URL exists, not after.
2. **`GOOGLE_MAPS_API_KEY` and `CESIUM_ION_TOKEN` are inlined at build time**
   (the `define` block in `vite.config.js`), so they must be present when the
   image is built, not only when it runs.

## The staging deployment

One box, one URL, always showing the branch you most recently opened a pull
request for. The VPS polls GitHub every three minutes; nothing on GitHub needs
a route back into the VPS, and the box holds no CI credentials.

```
GitHub (public repo)
   ↑ poll every 3 min: newest open PR, else main
/opt/gev/gev-deploy.sh  ──build──▶  docker compose  ──▶  gev container :4173
                                                            ↑            ↑
                                              cloudflared tunnel     tailnet
                                              gev.enerlens.com    100.x.x.x:4173
```

### Layout on the VPS

| Path | What it is |
| --- | --- |
| `/opt/gev/gev-deploy.sh` | the deploy agent (copy of `deploy/vps/gev-deploy.sh`) |
| `/opt/gev/docker-compose.yml` | the stack (copy of `deploy/vps/docker-compose.yml`) |
| `/opt/gev/.env` | keys + `GEV_ACCESS_PASSWORD`, `chmod 600` |
| `/opt/gev/src` | the source tree the agent swaps out, unpacked from a tarball |
| `/opt/gev/target` | `auto` (default), `main`, or a branch name to pin |
| `/opt/gev/state/deployed` | `branch@sha` currently live |

### The 2021 carroyage pack

The INSEE carroyage the Géoplateforme relays is **millésime 2019**; INSEE
published 2021 on 2026-02-12 and the relay has not moved. Staging draws 2021
only if the pack is built into the container's cache volume:

```bash
ssh vps 'docker exec gev npm run filosofi:pack-2021'   # ~2 min, 91 MB in, 59 MB out
ssh vps 'docker exec gev node scripts/build-filosofi-2021-pack.mjs --check'
```

It writes to `/app/.gev-cache/filosofi-2021`, which is the `gev-cache` named
volume, so it **survives redeploys** and only has to be rebuilt when INSEE ships
a new millésime. Without it the proxy serves the relay and reports
`vintage: 2019` — the year travels with every answer, so staging is never
wrong about which one it is showing, only older.

The build streams the three CSVs straight out of the archive: no `unzip` (the
image has none) and no 473 MB of expanded intermediates on the volume.

### Day to day

```bash
ssh vps 'cat /opt/gev/state/deployed'          # what is live right now
ssh vps 'echo my-branch > /opt/gev/target'     # pin staging to one branch
ssh vps 'echo auto      > /opt/gev/target'     # back to newest-open-PR
ssh vps 'systemctl start gev-deploy.service'   # deploy now, do not wait
ssh vps 'journalctl -u gev-deploy -n 50'       # why a deploy did not happen
ssh vps 'docker logs -n 50 gev'                # why the app misbehaves
```

A failed build leaves the previous container running: staging never goes dark
because a PR does not compile. A ref cut before the access gate existed is
refused outright rather than deployed open.

### Why the source arrives as a tarball and not a clone

On 2026-09-02 every deploy started failing with `could not read Username for
'https://github.com'`, three minutes apart, while the repository stayed public
and cloned fine from a laptop. Tracing it with `GIT_CURL_VERBOSE=1` narrowed it
to one request: GitHub answers this box's anonymous ref advertisement — a GET
on `/info/refs` — with **200**, then returns **401** to `POST
/git-upload-pack`. Every pack transfer goes through that POST, so `clone` and
`fetch` are both unavailable here whatever the protocol version. Listing a ref
still works, but only in **protocol v0**, which does not POST; the v2 default
cannot resolve a branch head from this IP at all.

So the agent resolves the head with `git -c protocol.version=0 ls-remote` and
downloads the tree from `codeload.github.com`, a plain GET. Both are anonymous,
which is the point: the alternative was a token, and this box deliberately
holds no credential that GitHub would honour. The costs are real and accepted —
the full tree every time instead of an incremental fetch, and `/opt/gev/src` is
no longer a git repository, so `git -C /opt/gev/src log` no longer answers.
Read `/opt/gev/state/deployed` instead; it carries the sha.

To check the deployment the way a browser meets it — bundle boots, canvas
draws, layer proxies answer from that origin — rather than by trusting a
`200` from `/healthz`:

```bash
node scripts/qa-deployment.mjs --url https://gev.enerlens.com/ --auth gev:<password>
```

### Installing it somewhere else

```bash
ssh box 'mkdir -p /opt/gev'
scp deploy/vps/docker-compose.yml deploy/vps/gev-deploy.sh box:/opt/gev/
scp deploy/vps/gev-deploy.{service,timer} box:/etc/systemd/system/
ssh box 'chmod +x /opt/gev/gev-deploy.sh && chmod 600 /opt/gev/.env'
ssh box 'systemctl daemon-reload && systemctl enable --now gev-deploy.timer'
```

`/opt/gev/.env` needs at least:

```
GEV_ACCESS_USER=gev
GEV_ACCESS_PASSWORD=<a long random string>
GEV_PUBLIC_HOST=<every hostname the deployment answers on, comma-separated>
GOOGLE_MAPS_API_KEY=...
```

plus whatever optional keys you want the layers to have (see `.env.example`).
`GEV_PUBLIC_HOST` is not decoration: `vite preview` answers `Blocked request`
to a `Host` header it was not told about.

## Why not GitHub Actions / Vercel / Render

- **GitHub Actions cannot host this.** A runner is an ephemeral VM that dies
  with the job (6 h ceiling), so it can *build and ship* the app but never
  *serve* it. It is a fine trigger — the pull-based timer here simply avoids
  handing GitHub an SSH key and opening a path into the VPS.
- **Vercel / Netlify** are static + serverless. The proxies keep in-process
  caches, a disk cache and a long-lived websocket; none of that survives a
  function boundary.
- **Render** hosts the Node process happily on its free tier, but per-PR
  preview environments there are a paid feature, and the free instance cold
  starts for ~a minute after 15 idle minutes.

## Privacy

`GEV_ACCESS_PASSWORD` fronts the whole origin with HTTP Basic, including
`/api/*`, so a stray fetch cannot spend your quota. `/healthz` stays open for
health checks and reports whether the gate is armed.

Two access paths are wired on the Enerlens box:

- **Tailnet** — `http://vps-enerlens.tailc409e8.ts.net:4173`. Nothing public;
  the port is only bound on loopback and the Tailscale address.
- **Cloudflare tunnel** — `https://gev.enerlens.com`, for devices without
  Tailscale. Add a Cloudflare Access policy on that hostname if you want SSO
  in front of the password.
