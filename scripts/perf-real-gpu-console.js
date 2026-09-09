/**
 * Phase 0.3 — the measurement headless Chromium cannot make, run by hand on a
 * real machine. PASTE THIS WHOLE FILE INTO THE DEVTOOLS CONSOLE. It is not
 * imported by anything and it is not run by npm.
 *
 * ── WHY A PASTED SNIPPET AND NOT A HARNESS ──────────────────────────────────
 *
 * Everything else in `scripts/` drives Chromium headless, which renders through
 * SwiftShader — in software. Every frame time it reports is a CPU millisecond,
 * so the four fixed GPU costs the plan wants to cut (MSAA ×4, the sharpen pass,
 * `preserveDrawingBuffer`, render resolution) are invisible there BY
 * CONSTRUCTION. They only show on a real GPU, and the machine that matters is
 * a 2018-2020 laptop on Intel UHD graphics — a machine no CI has. So the
 * measurement is a snippet somebody pastes on the laptop they already own,
 * takes five minutes, installs nothing, and returns one line of JSON.
 *
 * ── THE METHOD IS COPIED FROM `perf-boot-probe.mjs`, DELIBERATELY ───────────
 *
 * Same parked view, same orbit (`rotateRight(0.004)` + `requestRender()`),
 * same 5 s windows, same percentiles. A number measured differently would not
 * be comparable to the lab column and would quietly become a second baseline.
 * The one thing it adds is the renderer string: a run on SwiftShader is not a
 * failed run, it is a MEANINGLESS one, so it refuses to report at all.
 *
 * ── HOW TO USE IT ───────────────────────────────────────────────────────────
 *
 *   1. On the laptop, open `chrome://gpu` and check that "WebGL: Hardware
 *      accelerated" is there. (The snippet re-checks, but check first: if it
 *      is software, nothing below is worth your five minutes.)
 *   2. Open the app with the first-run card suppressed:
 *      https://gev.enerlens.com/?welcome=0   (HTTP Basic: gev / the password)
 *   3. Wait for the globe. F12 → Console → paste this file → Enter.
 *   4. It prints two lines and copies a JSON blob to the clipboard. Send that
 *      blob back; it goes verbatim into `docs/PERFORMANCE.md`.
 *
 * Pass `?layers=irve-fr,schools-fr,transit-fr` in the URL, or edit LAYERS
 * below, to measure the scene a real visitor looks at rather than a bare globe.
 */
(async () => {
  /** Lyon at 12 km, pitch −45°: the same parked view `perf:layers` uses. */
  const VIEW = { lon: 4.8357, lat: 45.7640, height: 12_000 };
  const LAYERS = ['irve-fr', 'schools-fr', 'transit-fr'];

  const gev = window.__godsEyeView;
  if (!gev?.viewer) { console.error('No window.__godsEyeView.viewer — wait for the globe, then paste again.'); return; }
  const viewer = gev.viewer;
  const { scene } = viewer;

  // The renderer string, from the GL context Cesium is actually drawing with.
  // WEBGL_debug_renderer_info is the only way to tell "Intel UHD 620" from
  // "Google SwiftShader" — and telling them apart is the whole point.
  const gl = scene.context._gl || scene.context.gl;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  if (/swiftshader|software|llvmpipe|angle \(google/i.test(String(renderer))) {
    console.error(`This is a SOFTWARE renderer (${renderer}). The whole point of phase 0.3 is a real GPU — check chrome://gpu, enable hardware acceleration, and paste again.`);
    return;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pct = (s, q) => s[Math.min(s.length - 1, Math.floor(s.length * q))] || 0;
  const round = (n, d = 1) => Number(n.toFixed(d));

  // Cancel the cinematic fly-in FIRST: its tween resumes under any later
  // setView and drags the camera away mid-measurement.
  viewer.camera.cancelFlight();
  viewer.camera.setView({
    destination: scene.globe.ellipsoid.cartographicToCartesian({
      longitude: VIEW.lon * Math.PI / 180, latitude: VIEW.lat * Math.PI / 180, height: VIEW.height,
    }),
    orientation: { heading: 0, pitch: -Math.PI / 4, roll: 0 },
  });

  const asked = new URLSearchParams(location.search).get('layers');
  const ids = asked === null ? LAYERS : asked.split(',').map((s) => s.trim()).filter(Boolean);
  const on = [];
  for (const id of ids) {
    try { await gev.dataManager.setEnabled(id, true, { origin: 'user' }); on.push(id); }
    catch (e) { on.push(`${id}:FAILED`); }
  }
  console.log(`layers on: ${on.join(', ') || '(none)'} — settling 15 s…`);
  await wait(on.length ? 15_000 : 8_000);

  /** Parked: the target is 0 renders in 5 s. Anything above is a leak. */
  const parked = await new Promise((resolve) => {
    let renders = 0;
    const off = scene.postRender.addEventListener(() => { renders++; });
    setTimeout(() => { off(); resolve(renders); }, 5000);
  });

  /** Orbit: the frame-time distribution. p90 and p99 are the plan's targets. */
  const motion = await new Promise((resolve) => {
    const times = []; let last = performance.now(); let renders = 0;
    const off = scene.postRender.addEventListener(() => {
      const now = performance.now(); times.push(now - last); last = now; renders++;
    });
    const start = performance.now();
    const spin = () => {
      if (performance.now() - start > 5000) {
        off(); times.sort((a, b) => a - b);
        return resolve({
          fps: round(renders / 5, 1), p50: round(pct(times, 0.5)), p90: round(pct(times, 0.9)),
          p99: round(pct(times, 0.99)), over33: times.filter((t) => t > 33).length,
          over100: times.filter((t) => t > 100).length,
        });
      }
      viewer.camera.rotateRight(0.004); scene.requestRender(); requestAnimationFrame(spin);
    };
    requestAnimationFrame(spin);
  });

  const out = {
    when: new Date().toISOString().slice(0, 16),
    renderer: String(renderer), vendor: String(vendor),
    cores: navigator.hardwareConcurrency ?? null,
    memoryGB: navigator.deviceMemory ?? null,
    screen: `${screen.width}×${screen.height}@${devicePixelRatio}`,
    canvas: `${scene.canvas.width}×${scene.canvas.height}`,
    ua: navigator.userAgent,
    layers: on, parked5s: parked, ...motion,
    msaa: scene.msaaSamples, resolutionScale: viewer.resolutionScale,
    url: location.href.replace(/[?#].*$/, ''),
  };
  console.log(`%c${out.renderer} — ${out.cores} cores, ${out.canvas}`, 'font-weight:bold');
  console.log(`%cparked ${out.parked5s}/5s · orbit p50 ${out.p50} p90 ${out.p90} p99 ${out.p99} ms · >33ms ${out.over33} · >100ms ${out.over100} · ${out.fps} fps`, 'font-weight:bold');
  const blob = JSON.stringify(out);
  try { await navigator.clipboard.writeText(blob); console.log('(copied to clipboard — paste it back)'); }
  catch { console.log('copy this line by hand:\n' + blob); }
  return out;
})();
