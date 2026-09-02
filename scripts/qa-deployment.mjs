#!/usr/bin/env node
/**
 * Smoke-test a deployment the way a browser meets it.
 *
 * `curl /healthz` proves the container is alive; it does not prove the bundle
 * boots, the gate lets a real page through, or the proxies answer from the
 * origin the browser is actually on. This drives the deployed URL with the
 * same first-run suppression every other harness uses, then asserts on what
 * the page reports about itself.
 *
 * Usage:
 *   node scripts/qa-deployment.mjs --url https://gev.example.com --auth user:password
 *
 * The credentials go out as an Authorization header, not in the URL: Chrome
 * strips userinfo from navigations and the request would arrive unauthenticated.
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const url = flag('url', process.env.GEV_DEPLOY_URL || '');
const auth = flag('auth', process.env.GEV_DEPLOY_AUTH || '');
if (!url) {
  console.error('usage: node scripts/qa-deployment.mjs --url <url> [--auth user:password]');
  process.exit(2);
}

/** Endpoints whose failure would empty a layer the fork exists for. */
const PROBES = [
  '/api/energy-fr',
  '/api/edf-plants',
  '/api/rte-generation',
  '/api/schools-fr/departements',
  '/api/sup-fr/departements',
  '/api/comptages-fr/status',
  '/api/delinquance-fr/status',
  '/api/anfr-fr/status',
  '/api/fraicheur-fr/status',
  '/api/sitadel-fr/status',
  '/api/idfm-frequency/status',
  '/api/bruit-fr/status',
  '/api/irve-fr/departements',
  '/api/gas-fr/sites',
  '/api/bison-fute/events',
  '/api/celestrak/active',
  '/api/vigilance',
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await newQaPage(browser);
  if (auth) {
    await page.setExtraHTTPHeaders({
      Authorization: `Basic ${Buffer.from(auth).toString('base64')}`,
    });
  }
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));

  const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
  check('the deployment answers the navigation', response?.status() === 200, `HTTP ${response?.status()}`);

  const canvas = await page.waitForSelector('canvas', { timeout: 60000 }).catch(() => null);
  check('a Cesium canvas is on the page', Boolean(canvas));

  const drawn = await page.evaluate(() => {
    const el = document.querySelector('canvas');
    return el ? { width: el.width, height: el.height } : null;
  });
  check('the canvas has real dimensions', Boolean(drawn && drawn.width > 100 && drawn.height > 100),
    drawn ? `${drawn.width}×${drawn.height}` : 'no canvas');

  for (const path of PROBES) {
    const status = await page.evaluate(
      (p) => fetch(p).then((r) => r.status).catch(() => 0),
      path,
    );
    check(`${path} answers`, status === 200, `HTTP ${status}`);
  }

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
