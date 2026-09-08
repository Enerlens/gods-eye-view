#!/usr/bin/env node
/**
 * Browser proof for the address radiography — `/fiche.html`.
 *
 * The unit tests pin the WORDING against one captured scan. This harness
 * proves the four things a fixture cannot:
 *
 *   i.   the page composes against the LIVE services, on two real addresses in
 *        two different régions, and comes back with ten themes rather than a
 *        blank sheet and a stack trace — with exactly two of its figures
 *        ranked against the national barème and the rest stating why not
 *   ii.  it loads NO Cesium. The sheet is a document; a build that quietly
 *        started shipping a 3D engine with it would still look correct on
 *        screen and be four megabytes heavier, which is exactly the kind of
 *        regression nothing else here would catch
 *   iii. `?embed=1` really does strip the chrome, because that is the mode an
 *        agency would put in an iframe
 *   iv.  a rural address still produces a full sheet, and one that names at
 *        least one of its own caveats. WHICH caveat is a property of the
 *        address, not of the code — measured on Ustaritz, every commune-level
 *        source answered locally and what surfaced instead was 55 of 78
 *        carreaux carrying imputed values, and two Géorisques verdicts
 *        disagreeing — so the check is that a caveat is named, not which one
 *
 * Run: node scripts/qa-fiche.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'fiche');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

/** Paris 13e — dense, every register answers. Ustaritz — rural, several do not. */
const PARIS = { lat: 48.83, lon: 2.376, label: 'Paris 13e' };
const RURAL = { lat: 43.3937, lon: -1.4519, label: 'Ustaritz (64)' };

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Read the rendered sheet back out of the DOM. */
const readSheet = () => ({
  title: document.getElementById('title')?.textContent ?? '',
  status: document.getElementById('status')?.textContent ?? '',
  caveat: document.querySelector('.caveat')?.textContent ?? '',
  chrome: {
    lookupVisible: Boolean(document.getElementById('lookup')?.offsetParent),
    embedClass: document.body.classList.contains('embed'),
  },
  themes: [...document.querySelectorAll('section.theme')].map((section) => ({
    label: section.querySelector('h2')?.textContent ?? '',
    status: section.dataset.status,
    rows: section.querySelectorAll('dl.rows > div').length,
    text: section.textContent,
  })),
});

async function scan(browser, point, extra = '') {
  const page = await newQaPage(browser);
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('request', (request) => requests.push(request.url()));
  await page.setViewport({ width: 900, height: 1400 });
  await page.goto(`${APP_URL}/fiche.html?lat=${point.lat}&lon=${point.lon}${extra}`,
    { waitUntil: 'networkidle0', timeout: 180_000 });
  // The sheet composes fifteen answers; networkidle0 fires when they land.
  await new Promise((resolve) => { setTimeout(resolve, 1500); });
  const sheet = await page.evaluate(readSheet);
  return {
    page, sheet, errors, requests,
  };
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    executablePath: chrome,
    args: ['--no-sandbox'],
  });
  try {
    console.log(`[qa] fiche — ${APP_URL}/fiche.html`);

    console.log(`\n[1] ${PARIS.label}`);
    const paris = await scan(browser, PARIS);
    check('ten themes rendered', paris.sheet.themes.length === 10,
      String(paris.sheet.themes.length));
    check('the address was resolved', /Paris/.test(paris.sheet.title), paris.sheet.title);
    const answered = paris.sheet.themes.filter((theme) => theme.status === 'ok').length;
    check('at least eight themes answered against the live services', answered >= 8,
      `${answered}/10`);
    check('no theme rendered empty', paris.sheet.themes.every((theme) => theme.rows > 0
      || /n’a pas répondu|Aucun|non lus/.test(theme.text)));
    // THE GRADING CONTRACT, on screen: two ranks against the national barème,
    // and a stated reason for everything it will not rank.
    const text0 = paris.sheet.themes.map((theme) => theme.text).join(' ');
    check('the sheet says what it may and may not grade',
      /même géométrie/.test(paris.sheet.caveat));
    check('exactly two figures carry a national percentile',
      (text0.match(/centile national/g) || []).length === 2,
      String((text0.match(/centile national/g) || []).length));
    // No `\b` after the letter: `textContent` runs the rows together, so the A
    // of "note A" is followed by the "15" of the next row and the boundary
    // never fires. The em dash before it is the anchor that does.
    check('the walking area carries a letter', /— note [A-E]/.test(text0));
    check('the neighbourhood figures say why they carry none',
      /pas sur un rectangle de carreaux/.test(text0));
    check('no page error', paris.errors.length === 0, paris.errors.slice(0, 2).join(' | '));

    // ii. A document page must not download a 3D engine.
    const cesium = paris.requests.filter((url) => /Cesium\.js|cesium-\d/.test(url));
    check('no Cesium asset requested', cesium.length === 0, cesium.slice(0, 2).join(' | '));
    await paris.page.screenshot({ path: path.join(SHOTS_DIR, '01-paris.png'), fullPage: true });
    await paris.page.close();

    console.log('\n[2] mode intégrable');
    const embed = await scan(browser, PARIS, '&embed=1');
    check('the body is flagged embed', embed.sheet.chrome.embedClass === true);
    check('the lookup form is hidden', embed.sheet.chrome.lookupVisible === false);
    check('the themes are still there', embed.sheet.themes.length === 10);
    await embed.page.screenshot({ path: path.join(SHOTS_DIR, '02-embed.png'), fullPage: true });
    await embed.page.close();

    console.log(`\n[3] ${RURAL.label}`);
    const rural = await scan(browser, RURAL);
    check('ten themes rendered', rural.sheet.themes.length === 10,
      String(rural.sheet.themes.length));
    check('a different address', rural.sheet.title !== paris.sheet.title, rural.sheet.title);
    const text = rural.sheet.themes.map((theme) => theme.text).join(' ');
    // The whole argument of this fiche: a register that answered about
    // somewhere else, or approximately, or not at all, must say so on the
    // sheet. WHICH caveat fires is a property of the address — measured on
    // Ustaritz, every commune-level source answered locally and the caveats
    // that surfaced were the imputed carreaux and the two Géorisques verdicts
    // disagreeing — so the check is that at least one of them is named, not
    // that a particular one is.
    check('at least one caveat is named on the sheet',
      /maille de communes voisines|pas pour cette commune|non publié|non lus/.test(text)
      || /valeurs imputées|les deux verdicts diffèrent|comptage incomplet|tronquée/.test(text));
    check('no page error', rural.errors.length === 0, rural.errors.slice(0, 2).join(' | '));
    await rural.page.screenshot({ path: path.join(SHOTS_DIR, '03-rural.png'), fullPage: true });
    await rural.page.close();

    console.log(`\n[qa] shots in ${path.relative(REPO_ROOT, SHOTS_DIR)}`);
    console.log(failures === 0 ? '\n[qa] PASS' : `\n[qa] FAIL — ${failures} check(s)`);
  } finally {
    await browser.close();
  }
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
