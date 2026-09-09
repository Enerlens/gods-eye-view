#!/usr/bin/env node
/**
 * qa:webfonts — the icons are icons, and nothing is fetched from Google.
 *
 * `src/materialSymbolsSubset.test.mjs` proves the glyph list matches the
 * sources. That is the static half, and it cannot see the failure that
 * matters: a subset that downloads fine, applies fine, and simply does not
 * contain the ligature — at which point `<span class="material-symbols-
 * outlined">right_panel_open</span>` renders the WORD, in the UI font, in the
 * middle of the cockpit. Nothing throws, no request fails, and the static test
 * is perfectly happy.
 *
 * So this one measures pixels. A formed ligature is one glyph — roughly square
 * at the 24 px the class sets. The literal word is fifteen characters and runs
 * five times wider. The two are not close, so the threshold does not need to be
 * subtle, and a font that failed to load at all fails the same way.
 *
 * It also pins the other half of why the fonts moved here: not one request to
 * `fonts.googleapis.com` or `fonts.gstatic.com` on a cold boot. That is a
 * performance claim (three render-blocking round trips on two unresolved
 * origins) and a privacy one (CJUE, 2022) at the same time.
 *
 * Usage: node scripts/qa-webfonts.mjs [--url http://127.0.0.1:4179]
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv.slice(2);
const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://127.0.0.1:4179';

/** A 24 px glyph in a box. Anything past this is letters, not an icon. */
const MAX_GLYPH_WIDTH_PX = 40;

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 300_000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768'],
});

try {
  const page = await newQaPage(browser);
  await page.setViewport({ width: 1366, height: 768 });
  const googleFontRequests = [];
  page.on('request', (req) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(req.url())) googleFontRequests.push(req.url());
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 3_000));

  check('nothing is fetched from Google Fonts', googleFontRequests.length === 0, googleFontRequests);

  const loaded = await page.evaluate(() => ({
    icons: document.fonts.check('24px "Material Symbols Outlined"'),
    sans: document.fonts.check('16px "Inter"'),
    mono: document.fonts.check('16px "JetBrains Mono"'),
    faces: [...document.fonts].map((f) => `${f.family} ${f.status}`),
  }));
  check('all three families are loaded from this origin', loaded.icons && loaded.sans && loaded.mono, loaded);

  // Every symbols span on the page, measured where it sits. Hidden panels are
  // included on purpose — the cockpit and the CCTV lightbox are exactly where
  // a missing glyph would go unnoticed until someone opened them — but a node
  // with no box at all cannot be measured, so those are counted and reported
  // rather than silently passed.
  const glyphs = await page.evaluate((maxWidth) => {
    const nodes = [...document.querySelectorAll('.material-symbols-outlined')];
    const wide = []; const measured = [];
    for (const node of nodes) {
      const text = (node.textContent || '').trim();
      if (!text || !/^[a-z0-9_]+$/.test(text)) continue;
      // Measure off-layout so a hidden ancestor does not zero the box.
      const probe = document.createElement('span');
      probe.className = 'material-symbols-outlined';
      probe.textContent = text;
      probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;';
      document.body.appendChild(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      measured.push(text);
      if (width > maxWidth) wide.push({ glyph: text, width: Math.round(width) });
    }
    return { total: nodes.length, measured: [...new Set(measured)], wide };
  }, MAX_GLYPH_WIDTH_PX);

  check('the page actually has icons to check', glyphs.measured.length >= 10, { measured: glyphs.measured.length });
  check(
    'every glyph forms a ligature instead of rendering as its own name',
    glyphs.wide.length === 0,
    glyphs.wide.length ? glyphs.wide : { checked: glyphs.measured.length },
  );
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nqa:webfonts ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
