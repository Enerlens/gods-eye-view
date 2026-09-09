#!/usr/bin/env node
/**
 * qa:lazy-voice — the voice agent is out of the boot bundle, and still there.
 *
 * Both halves are load-bearing, exactly as in `qa:lazy-layers`. "Never load the
 * voice" passes the first check by deleting the product; "load it eagerly"
 * passes the rest by undoing the 604 kB this change is about. What is pinned:
 *
 *   1. the entry chunk carries NO voice machinery — asserted against the built
 *      bytes, not against a request, because a request is a race and the bytes
 *      are not;
 *   2. the mic panel is in the cockpit from the first paint, before its brain
 *      exists — a control that appears late reads as a page still loading;
 *   3. the stack lands on its own, without anyone touching the mic (browser
 *      idle), and `window.__gevVoiceCommands.runner` works;
 *   4. `annotations` and `sceneDirector` come back on `window.__godsEyeView`,
 *      under the names eight harnesses already use;
 *   5. adopting the panel does not leave two of them behind.
 *
 * Usage: node scripts/qa-lazy-voice.mjs [--url http://127.0.0.1:4179]
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv.slice(2);
const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://127.0.0.1:4179';

/**
 * Strings that exist in the voice stack and nowhere else in the shell.
 *
 * Chosen from four different files so a partial regression — the controller
 * moved back out but not the annotation engine — cannot pass by accident, and
 * all four are STRING LITERALS: an identifier like `SCENE_RECIPES` is renamed
 * by the minifier, so a fingerprint built from one would report success on a
 * chunk that carries the whole file.
 */
const VOICE_FINGERPRINTS = Object.freeze([
  '/api/realtime/token',   // voice/gevRealtime.js
  'gev-anno-area',         // annotations/screenAnnotationRenderer.js
  'flights-radar',         // scenes/recipes.js
  'around_the_thing',      // annotations/annotationEngine.js
]);

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 300_000,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});

try {
  const page = await newQaPage(browser);
  await page.setViewport({ width: 1366, height: 768 });

  const scriptRequests = [];
  page.on('request', (req) => {
    const requested = req.url();
    if (/\/assets\/[^/?]+\.js(\?|$)/.test(requested)) scriptRequests.push(requested.split('/').pop());
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { timeout: 120_000 });

  // ── 1. the entry chunk carries no voice ───────────────────────────────────
  const entryName = await page.evaluate(() => {
    const tag = [...document.querySelectorAll('script[type="module"][src]')]
      .map((node) => node.getAttribute('src'))
      .find((src) => /\/assets\/index-[^/]+\.js$/.test(src));
    return tag || null;
  });
  const entryBody = entryName
    ? await page.evaluate((src) => fetch(src).then((r) => r.text()), entryName)
    : '';
  const leaked = VOICE_FINGERPRINTS.filter((needle) => entryBody.includes(needle));
  check('the entry chunk carries no voice machinery', entryName !== null && leaked.length === 0,
    { entry: entryName, bytes: entryBody.length, leaked });

  // ── 2. the panel is there before its brain ────────────────────────────────
  const shell = await page.evaluate(() => ({
    panels: document.querySelectorAll('#gev-voice-control').length,
    button: !!document.getElementById('gev-voice-button'),
    status: document.getElementById('gev-voice-status')?.textContent?.trim() || null,
    controller: typeof window.__gevVoiceCommands,
  }));
  check('the mic panel is in the cockpit from the start', shell.panels === 1 && shell.button, shell);

  // ── 3. it lands on its own, untouched ─────────────────────────────────────
  const landed = await page.evaluate(() => window.__godsEyeView.voiceReady
    .then(() => true)
    .catch(() => false));
  check('the voice stack loads at browser idle, with nobody touching the mic', landed === true);

  const wired = await page.evaluate(() => ({
    runner: typeof window.__gevVoiceCommands?.runner,
    annotations: !!window.__godsEyeView?.annotations,
    sceneDirector: !!window.__godsEyeView?.sceneDirector,
    voiceCommands: !!window.__godsEyeView?.voiceCommands,
    panels: document.querySelectorAll('#gev-voice-control').length,
    button: !!document.getElementById('gev-voice-button'),
  }));
  check('the runner answers once it has landed', wired.runner === 'function', wired);
  check('annotations and the scene director come back under their old names',
    wired.annotations && wired.sceneDirector && wired.voiceCommands, wired);
  check('adopting the panel leaves exactly one of it', wired.panels === 1 && wired.button, wired);

  // ── 4. it arrived as its own chunk, not with the shell ────────────────────
  check('the voice arrived as separate chunks', scriptRequests.length > 2,
    { chunks: scriptRequests.length });

  // ── 5. a real tool call still works end to end ────────────────────────────
  const view = await page.evaluate(() => window.__gevVoiceCommands
    .runner('get_current_view_state', {})
    .then((r) => ({ ok: r?.ok !== false, keys: Object.keys(r || {}).length }))
    .catch((error) => ({ ok: false, error: String(error?.message || error) })));
  check('a voice tool answers after the deferred load', view.ok === true, view);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} PASS\n`);
process.exit(failed.length ? 1 : 0);
