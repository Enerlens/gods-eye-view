#!/usr/bin/env node
/**
 * Browser proof for Provider Settings — the POWER UP chip and its dialog.
 *
 * What it is really checking: that a surface which writes credentials to disk
 * renders only what the server told it, never a value; that a key this panel
 * does not own offers no way to change it; and that the whole thing is absent
 * where it cannot work. The endpoint's refusals are pinned by unit tests
 * (src/keySetupCore.test.mjs); this is the half only a real page can answer.
 *
 * Usage: npm run qa:provider-settings -- --url http://localhost:4198
 *        npm run qa:provider-settings -- --url http://localhost:4197 --expect-absent
 *
 * `--expect-absent` is the check that matters for a deployment: run it against
 * `vite preview` (what the VPS runs) and it PROVES the credential surface is
 * gone rather than merely refused.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const urlFlag = process.argv.indexOf('--url');
const appUrl = (urlFlag > 0 ? process.argv[urlFlag + 1] : null)
  || process.env.QA_BASE_URL || 'http://localhost:4173';
const headful = process.argv.includes('--headful');
const expectAbsent = process.argv.includes('--expect-absent');
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  || (() => { try { return puppeteer.executablePath(); } catch { return null; } })();
if (!executablePath || !fs.existsSync(executablePath)) {
  throw new Error('Puppeteer Chrome for Testing is unavailable');
}

const browser = await puppeteer.launch({
  headless: headful ? false : 'new',
  executablePath,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const page = await newQaPage(browser);
const failures = [];
const check = (name, passed, detail = '') => {
  console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures.push(name);
};
/** page.click() hangs on this app's canvas; the DOM answers in a millisecond. */
const domClick = (selector) => page.evaluate((sel) => {
  const node = document.querySelector(sel);
  if (!node) return false;
  node.click();
  return true;
}, selector);

try {
  console.log(`Provider Settings QA — ${appUrl}`);
  await page.goto(`${appUrl}/?welcome=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // The markup ships with the page; the PANEL is initialised after the viewer
  // is up. Reading the chip before that gets the markup's own `hidden`, which
  // says nothing about how many keys are missing.
  await page.waitForFunction(
    () => document.getElementById('key-setup')?.dataset?.initialized === 'true',
    { timeout: 60000 },
  ).catch(() => {});

  const status = await page.evaluate(async () => {
    try {
      const response = await fetch('/api/setup/status', { cache: 'no-store' });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  });

  if (expectAbsent) {
    // A built bundle has no endpoint, so the module deletes its own surface.
    // Refusing the write would not be enough: a credential dialog has no
    // business rendering at all on something a deployment serves.
    const surface = await page.evaluate(() => ({
      chip: !!document.getElementById('key-setup-chip'),
      dialog: !!document.getElementById('key-setup'),
    }));
    check('no status payload here', !status || typeof status.total !== 'number');
    check('the chip is removed from the document', !surface.chip);
    check('the dialog is removed from the document', !surface.dialog);
    const write = await page.evaluate(async () => {
      const response = await fetch('/api/setup/keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      return response.status;
    });
    check('the write endpoint does not exist', write === 404, `HTTP ${write}`);
    console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS — all checks');
    await browser.close();
    process.exit(failures.length ? 1 : 0);
  }

  check('the status endpoint answers this page', !!status, status ? `${status.setCount}/${status.total} set` : 'no payload');
  if (!status) throw new Error('no status payload — is the dev server running?');

  const chip = await page.evaluate(() => {
    const node = document.getElementById('key-setup-chip');
    if (!node) return null;
    return { hidden: node.hidden, label: node.textContent.trim() };
  });
  const missing = status.total - status.setCount;
  check('the chip counts the keys still missing',
    !!chip && (missing === 0 ? chip.hidden : chip.label.includes(String(missing))),
    chip ? `hidden=${chip.hidden} label=${JSON.stringify(chip.label)}` : 'chip removed');
  // The chip renders a font glyph, not the word. A subset that is missing
  // `bolt` shows the literal text, which is exactly the failure mode this
  // repo's icon subsetting is prone to.
  const glyph = await page.evaluate(() => {
    const icon = document.querySelector('#key-setup-chip .material-symbols-outlined');
    if (!icon) return null;
    return { text: icon.textContent.trim(), family: getComputedStyle(icon).fontFamily, width: icon.getBoundingClientRect().width };
  });
  check('the chip icon is a glyph, not the word "bolt"',
    !!glyph && /Material Symbols/i.test(glyph.family) && glyph.width > 0 && glyph.width < 40,
    glyph ? `${glyph.width.toFixed(1)}px in ${glyph.family.split(',')[0]}` : 'no icon node');

  check('the dialog opens from the chip', await domClick('#key-setup-chip'));
  await page.waitForFunction(() => document.getElementById('key-setup')?.classList.contains('visible'), { timeout: 5000 })
    .catch(() => {});

  const rows = await page.evaluate(() => [...document.querySelectorAll('.key-setup-row')].map((row) => ({
    id: row.dataset.keyId,
    set: row.dataset.set === 'true',
    managed: row.dataset.managed || null,
    inputs: row.querySelectorAll('input[data-env-var]').length,
    hasRemove: !!row.querySelector('[data-key-setup-remove]'),
    types: [...row.querySelectorAll('input')].map((input) => input.type),
  })));
  check('every registry entry has a row', rows.length === status.total, `${rows.length} rows / ${status.total} keys`);
  check('a two-variable entry offers two fields',
    rows.find((row) => row.id === 'rte')?.inputs === 2 || !rows.some((row) => row.id === 'rte'),
    `rte inputs=${rows.find((row) => row.id === 'rte')?.inputs}`);
  check('every field is a password field — this app gets screen-recorded',
    rows.every((row) => row.types.every((type) => type === 'password')));

  const external = rows.filter((row) => row.managed === 'external');
  check('an externally-configured key offers no way to change it',
    external.every((row) => row.inputs === 0 && !row.hasRemove),
    external.length ? external.map((row) => row.id).join(', ') : 'none in this environment');
  const owned = rows.filter((row) => row.managed === 'file');
  check('a key this panel owns offers REMOVE', owned.every((row) => row.hasRemove),
    owned.map((row) => row.id).join(', ') || 'none');

  const leaked = await page.evaluate(() => {
    const dialog = document.getElementById('key-setup');
    const text = `${dialog?.textContent || ''} ${dialog?.innerHTML || ''}`;
    return /sk-[A-Za-z0-9]{12}|AIza[0-9A-Za-z_-]{20}|eyJ[A-Za-z0-9_-]{20}/.test(text);
  });
  check('no credential material reaches the DOM', !leaked);

  const framing = await page.evaluate(async () => {
    const response = await fetch('/', { cache: 'no-store' });
    return {
      xfo: response.headers.get('x-frame-options'),
      csp: response.headers.get('content-security-policy'),
    };
  });
  check('the app document refuses to be framed',
    framing.xfo === 'DENY' && /frame-ancestors 'none'/.test(framing.csp || ''),
    `${framing.xfo} / ${framing.csp}`);
  const fiche = await page.evaluate(async () => {
    const response = await fetch('/fiche.html', { cache: 'no-store' });
    return response.headers.get('x-frame-options');
  });
  check('the fiche stays embeddable — being in an iframe is its job', !fiche, `x-frame-options: ${fiche}`);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('key-setup')?.classList.contains('visible'), { timeout: 5000 })
    .catch(() => {});
  const closed = await page.evaluate(() => !document.getElementById('key-setup')?.classList.contains('visible'));
  check('ESC closes the dialog', closed);
} finally {
  await browser.close();
}

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS — all checks');
process.exitCode = failures.length ? 1 : 0;
