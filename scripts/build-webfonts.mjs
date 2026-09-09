#!/usr/bin/env node
/**
 * fonts:build — vendor the three webfonts, and cut the icon font down to the
 * glyphs this app actually draws.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Measured on a cold boot, 2026-09-09: 410 kB of font, of which **323 kB is
 * Material Symbols Outlined** — the complete variable icon font, 4 277 glyphs,
 * for the 26 this interface renders. Behind it, three render-blocking
 * stylesheets on `fonts.googleapis.com`, which the browser cannot even start
 * fetching until it has resolved and shaken hands with two origins it has
 * never seen. On the 60 ms line this plan targets, that is a third of a second
 * before the first paint, spent on a request that returns 1 kB of CSS.
 *
 * A fourth link, `Material Icons Round`, was fetched and never used: no rule
 * and no element in this tree references it. It is simply gone.
 *
 * And a public map that ships a `fonts.gstatic.com` reference sends every
 * visitor's IP to Google before they have consented to anything (CJUE, 2022).
 * Self-hosting settles that too, for free.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *
 * Asks Google's `css2` endpoint for exactly what this app uses, with a Chrome
 * user-agent so it answers in woff2, downloads each face next to the app, and
 * writes one local stylesheet. For the icon font it passes `icon_names=` — the
 * endpoint's own subsetting — so the served file carries only our glyphs.
 *
 * The glyph list is EXTRACTED, never typed: see
 * `scripts/lib/materialSymbolGlyphs.mjs` for why a hand-kept list is a broken
 * cockpit waiting to happen, and `src/materialSymbolsSubset.test.mjs` for the
 * test that fails when the sources drift from the committed subset.
 *
 * Re-run after adding an icon:  npm run fonts:build
 *
 * Usage: node scripts/build-webfonts.mjs [--check]
 *   --check  report what would change, write nothing (used by CI-by-hand).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODEPOINTS_CACHE_PATH, GLYPH_MANIFEST_PATH, extractGlyphs, parseCodepoints,
} from './lib/materialSymbolGlyphs.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = path.join(REPO_ROOT, 'public', 'fonts');
const CSS_PATH = path.join(FONT_DIR, 'fonts.css');
const checkOnly = process.argv.includes('--check');

// A desktop Chrome UA is not a disguise, it is the request: the endpoint keys
// its answer on the UA, and a Node default gets TTF back — 3× the bytes and no
// unicode-range gating.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const CODEPOINTS_URL = 'https://raw.githubusercontent.com/google/material-design-icons/master/'
  + 'variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints';

/**
 * The faces this app asks for, spelled exactly as `index.html` used to.
 * Ranges (`300..700`) are variable axes — Google answers one file, not five.
 */
const FAMILIES = [
  { slug: 'inter', query: 'family=Inter:wght@300..600' },
  { slug: 'jetbrains-mono', query: 'family=JetBrains+Mono:wght@300..700' },
];

/**
 * Which unicode-range blocks to keep.
 *
 * `latin` alone is the tempting answer and the wrong one: French needs `œ`
 * (U+0153) and `Œ` (U+0152), which live in latin-ext, and the interface is in
 * French. Dropping cyrillic, greek and vietnamese costs nothing — the browser
 * only ever downloaded the blocks a page actually used, so this shrinks what
 * is COMMITTED, not what is fetched.
 */
const KEEP_SUBSETS = new Set(['latin', 'latin-ext']);

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

async function fetchBinary(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Split a css2 answer into faces. Google prefixes each `@font-face` with a
 * `/* latin *\/` comment naming the block; that comment is the only place the
 * subset name appears, so it is what the filter reads.
 */
function parseFaces(css) {
  const faces = [];
  const re = /(?:\/\*\s*([a-z0-9-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const body = m[2];
    const url = body.match(/url\(([^)]+)\)/)?.[1];
    if (!url) continue;
    faces.push({ subset: m[1] || 'default', body, url });
  }
  return faces;
}

/**
 * `Inter` + `latin-ext` → `inter-latin-ext.4f2a91c3.woff2`.
 *
 * The hash is not decoration. `vite preview` serves everything `no-cache`, and
 * `staticAssetHeaders` only promises a year to URLs whose NAME changes when
 * their bytes do — deliberately, so nothing gets frozen for twelve months by
 * accident. Unhashed, these four files would be revalidated on every visit and
 * never held at the Cloudflare edge; hashed, they are `immutable` and correct,
 * and adding an icon cannot leave a returning visitor reading the word
 * `right_panel_open` until the cache expires.
 */
const hashOf = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 8);
const faceFileName = (slug, subset, bytes) => `${slug}-${subset}.${hashOf(bytes)}.woff2`;

async function buildTextFamily(family, out) {
  const css = await fetchText(`https://fonts.googleapis.com/css2?${family.query}&display=swap`);
  for (const face of parseFaces(css)) {
    if (!KEEP_SUBSETS.has(face.subset)) continue;
    const bytes = await fetchBinary(face.url);
    const file = faceFileName(family.slug, face.subset, bytes);
    out.files.push({ file, bytes, role: `${family.slug}-${face.subset}` });
    out.css.push(`@font-face {\n${face.body.trim()
      .replace(/url\([^)]+\)/, `url('/fonts/${file}')`)
      .split('\n').map((line) => `  ${line.trim()}`).join('\n')}\n}`);
  }
}

async function buildIconFont(glyphs, out) {
  const query = 'family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0,0'
    + `&icon_names=${glyphs.join(',')}`;
  const css = await fetchText(`https://fonts.googleapis.com/css2?${query}`);
  const faces = parseFaces(css);
  if (faces.length !== 1) throw new Error(`expected one icon face, got ${faces.length}`);
  const bytes = await fetchBinary(faces[0].url);
  const file = `material-symbols-outlined-subset.${hashOf(bytes)}.woff2`;
  out.files.push({ file, bytes, role: 'icons' });
  out.css.push(`@font-face {\n${faces[0].body.trim()
    .replace(/url\([^)]+\)/, `url('/fonts/${file}')`)
    .split('\n').map((line) => `  ${line.trim()}`).join('\n')}\n  font-display: block;\n}`);
  // The class Google's own stylesheet shipped. It is reproduced here rather
  // than linked because that link is exactly what this file removes; `liga`
  // is what turns the word `radar` into the glyph, so it is not optional.
  out.css.push(`.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
}`);
  return bytes.length;
}

// ── run ─────────────────────────────────────────────────────────────────────

let codepointsText;
if (existsSync(CODEPOINTS_CACHE_PATH)) {
  codepointsText = readFileSync(CODEPOINTS_CACHE_PATH, 'utf8');
} else {
  codepointsText = await fetchText(CODEPOINTS_URL);
  if (!checkOnly) {
    mkdirSync(path.dirname(CODEPOINTS_CACHE_PATH), { recursive: true });
    writeFileSync(CODEPOINTS_CACHE_PATH, codepointsText);
  }
}
const validNames = parseCodepoints(codepointsText);
const found = extractGlyphs(validNames);
const glyphs = [...found.keys()];
console.log(`glyphs referenced by the sources: ${glyphs.length}`);
for (const [glyph, files] of found) console.log(`  ${glyph.padEnd(24)} ${files.join(', ')}`);

if (checkOnly) {
  const manifest = existsSync(GLYPH_MANIFEST_PATH)
    ? JSON.parse(readFileSync(GLYPH_MANIFEST_PATH, 'utf8')) : { glyphs: [] };
  const missing = glyphs.filter((g) => !manifest.glyphs.includes(g));
  const extra = manifest.glyphs.filter((g) => !glyphs.includes(g));
  console.log(missing.length || extra.length
    ? `DRIFT missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`
    : 'subset is current');
  process.exit(missing.length ? 1 : 0);
}

const out = { files: [], css: [] };
out.css.push('/* Generated by `npm run fonts:build` — see scripts/build-webfonts.mjs. */');
for (const family of FAMILIES) await buildTextFamily(family, out);
const iconBytes = await buildIconFont(glyphs, out);

mkdirSync(FONT_DIR, { recursive: true });
// Hashed names never collide, so a rebuild would otherwise leave the previous
// generation lying in `public/` forever — shipped in every image, cached for a
// year, referenced by nothing.
const keep = new Set([...out.files.map((f) => f.file), 'fonts.css']);
for (const stale of readdirSync(FONT_DIR).filter((f) => !keep.has(f))) {
  rmSync(path.join(FONT_DIR, stale));
  console.log(`  removed stale public/fonts/${stale}`);
}
let total = 0;
for (const { file, bytes } of out.files) {
  writeFileSync(path.join(FONT_DIR, file), bytes);
  total += bytes.length;
  console.log(`  wrote public/fonts/${file.padEnd(46)} ${(bytes.length / 1024).toFixed(1)} kB`);
}
writeFileSync(CSS_PATH, `${out.css.join('\n\n')}\n`);

// The two faces the first screen sets text in are preloaded from `index.html`,
// so they start downloading beside the stylesheet instead of one round trip
// behind it. Their names carry a content hash, so the markup cannot be written
// by hand — this rewrites it, between markers, and
// `src/materialSymbolsSubset.test.mjs` fails if the two ever disagree.
const PRELOAD_ROLES = ['inter-latin', 'jetbrains-mono-latin'];
const preloads = PRELOAD_ROLES.map((role) => {
  const face = out.files.find((f) => f.role === role);
  if (!face) throw new Error(`no face built for preload role ${role}`);
  return `  <link rel="preload" href="/fonts/${face.file}" as="font" type="font/woff2" crossorigin />`;
}).join('\n');
const INDEX_PATH = path.join(REPO_ROOT, 'index.html');
const html = readFileSync(INDEX_PATH, 'utf8');
const MARKERS = /( *<!-- fonts:build preload -->\n)[\s\S]*?( *<!-- \/fonts:build preload -->)/;
if (!MARKERS.test(html)) throw new Error('index.html is missing the fonts:build preload markers');
writeFileSync(INDEX_PATH, html.replace(MARKERS, `$1${preloads}\n$2`));

writeFileSync(GLYPH_MANIFEST_PATH, `${JSON.stringify({
  note: 'Generated by `npm run fonts:build`. Do not edit: run the script.',
  generated: new Date().toISOString().slice(0, 10),
  iconSubsetBytes: iconBytes,
  files: out.files.map(({ file, bytes, role }) => ({ role, file, bytes: bytes.length })),
  glyphs,
}, null, 2)}\n`);
console.log(`\nicon subset ${(iconBytes / 1024).toFixed(1)} kB for ${glyphs.length} glyphs`
  + ` (the whole font was 323 kB); ${(total / 1024).toFixed(1)} kB committed in total`);
