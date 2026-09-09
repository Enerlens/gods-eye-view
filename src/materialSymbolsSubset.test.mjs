// The icon font ships subsetted: 4 kB for the glyphs this app draws, instead
// of the 323 kB variable font Google serves whole. That trade has one failure
// mode, and it is silent — a glyph the subset does not carry does not render a
// box, it renders the WORD. `right_panel_open` appears in the middle of the
// cockpit, in the UI font, and nothing throws.
//
// So the committed subset is checked against the sources on every `npm test`.
// Add an icon, forget `npm run fonts:build`, and this fails here rather than in
// front of a reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODEPOINTS_CACHE_PATH, GLYPH_MANIFEST_PATH, extractGlyphs, parseCodepoints,
} from '../scripts/lib/materialSymbolGlyphs.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = path.join(REPO_ROOT, 'public', 'fonts');

const manifest = JSON.parse(readFileSync(GLYPH_MANIFEST_PATH, 'utf8'));
const validNames = parseCodepoints(readFileSync(CODEPOINTS_CACHE_PATH, 'utf8'));

test('every glyph the sources name is in the committed subset', () => {
  const referenced = [...extractGlyphs(validNames, REPO_ROOT).keys()];
  const missing = referenced.filter((glyph) => !manifest.glyphs.includes(glyph));
  assert.deepEqual(
    missing, [],
    `${missing.join(', ')} would render as words. Run \`npm run fonts:build\` and commit the font.`,
  );
});

test('the subset carries nothing the sources stopped using', () => {
  // Not a correctness failure — dead glyphs cost bytes, not pixels — but the
  // manifest is only trustworthy as a record of what is drawn if it is exact.
  const referenced = [...extractGlyphs(validNames, REPO_ROOT).keys()];
  const stale = manifest.glyphs.filter((glyph) => !referenced.includes(glyph));
  assert.deepEqual(stale, [], `stale glyphs in the subset: ${stale.join(', ')}`);
});

test('the subset font is committed, and is a subset', () => {
  const icons = manifest.files.find((f) => f.role === 'icons');
  const full = path.join(FONT_DIR, icons.file);
  assert.ok(existsSync(full), `public/fonts/${icons.file} is missing`);
  const bytes = statSync(full).size;
  // The whole variable font is ~323 kB. Anything near it means the subsetting
  // silently stopped happening and the saving went with it.
  assert.ok(bytes < 60_000, `icon font is ${Math.round(bytes / 1024)} kB — that is not a subset`);
  assert.equal(bytes, manifest.iconSubsetBytes, 'the manifest and the committed font disagree');
});

test('every committed face is named after its own bytes, and referenced', () => {
  // The hash is what earns these files `Cache-Control: immutable` in
  // `staticAssetHeaders`. A face whose name stopped tracking its content would
  // be frozen at the edge for a year — the exact failure the allowlist in
  // vite.config.js is a short allowlist to avoid.
  const css = readFileSync(path.join(FONT_DIR, 'fonts.css'), 'utf8');
  const onDisk = readdirSync(FONT_DIR).filter((f) => f.endsWith('.woff2')).sort();
  const declared = manifest.files.map((f) => f.file).sort();
  assert.deepEqual(onDisk, declared, 'public/fonts holds a face the manifest does not list');
  for (const face of manifest.files) {
    assert.match(face.file, /\.[0-9a-f]{8}\.woff2$/, `${face.file} carries no content hash`);
    assert.equal(statSync(path.join(FONT_DIR, face.file)).size, face.bytes);
    assert.ok(css.includes(`/fonts/${face.file}`), `${face.file} is not referenced by fonts.css`);
  }
});

test('index.html preloads the two faces the first screen sets text in', () => {
  // Written by `npm run fonts:build`, between markers, because the names carry
  // a hash. A preload naming a face that no longer exists is a wasted request
  // AND a missed one.
  const html = readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
  for (const role of ['inter-latin', 'jetbrains-mono-latin']) {
    const face = manifest.files.find((f) => f.role === role);
    assert.ok(face, `no face built for ${role}`);
    assert.ok(
      html.includes(`<link rel="preload" href="/fonts/${face.file}"`),
      `index.html does not preload ${face.file} — run \`npm run fonts:build\``,
    );
  }
});

test('no page loads fonts from Google any more', () => {
  for (const page of ['index.html', 'fiche.html']) {
    const full = path.join(REPO_ROOT, page);
    if (!existsSync(full)) continue;
    const html = readFileSync(full, 'utf8');
    const links = html.match(/<link[^>]*>/g) || [];
    const offenders = links.filter((link) => /fonts\.(googleapis|gstatic)\.com/.test(link));
    assert.deepEqual(offenders, [], `${page} still fetches a font from Google`);
  }
});
