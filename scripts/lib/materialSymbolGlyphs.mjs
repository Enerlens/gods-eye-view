/**
 * Which Material Symbols glyphs this app actually renders.
 *
 * WHY THIS FILE EXISTS. The icon font shipped whole: 323 kB of variable font
 * for the couple of dozen glyphs on screen, fetched from `fonts.gstatic.com`
 * on every cold boot, blocking the first paint. Subsetting it is worth more
 * than every other font saving combined — and it is the one change here that
 * can break the interface SILENTLY, because a glyph the subset does not carry
 * does not fall back to a box: the ligature never forms and the element
 * renders the literal word `right_panel_open` in the middle of the cockpit.
 *
 * So the glyph list is not maintained by hand. It is extracted from the
 * sources, checked against Google's own codepoint list, and pinned by
 * `src/materialSymbolsSubset.test.mjs`, which fails `npm test` the moment a
 * source file names a glyph the committed subset does not carry. Adding an
 * icon is then: use it, run `npm run icons:subset`, commit the font.
 *
 * WHAT IT MATCHES, AND WHY IT ERRS WIDE. Two patterns:
 *
 *   A. the glyph as element text — `<span class="material-symbols-outlined">
 *      radar</span>` — in HTML and in the template literals that build markup;
 *   B. ANY string literal assigned to `textContent`/`innerText` that is a real
 *      Material Symbols name.
 *
 * B is deliberately loose. The tight version — "only when the element is
 * demonstrably a symbols span" — is the one that missed
 * `icon.textContent = expanded ? 'right_panel_close' : 'right_panel_open'`
 * during the first pass of this work: the class is set on one line, the glyph
 * chosen in a ternary forty lines away. Following that statically is a
 * data-flow analysis; being wrong costs a broken cockpit. Being wide costs a
 * few hundred bytes per unnecessary glyph, and the validation against the
 * official codepoint list keeps ordinary English strings out of the list —
 * only words Google actually named an icon after can get in.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Files scanned. Tests are excluded: they assert on markup, they do not ship it. */
export function sourceFiles(root = REPO_ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!/node_modules|dist|\.git/.test(entry)) walk(full);
      } else if (/\.(js|mjs|html)$/.test(entry) && !/\.test\.mjs$/.test(entry)) {
        out.push(full);
      }
    }
  };
  walk(path.join(root, 'src'));
  for (const page of ['index.html', 'fiche.html']) {
    const full = path.join(root, page);
    try { statSync(full); out.push(full); } catch { /* page may not exist */ }
  }
  return out;
}

const SPAN_TEXT = /class="[^"]*material-symbols-outlined[^"]*"[^>]*>\s*([a-z0-9_]+)\s*</g;
const TEXT_ASSIGNMENT = /(?:textContent|innerText)\s*=\s*([^;\n]+)/g;
const STRING_LITERAL = /['"`]([a-z0-9_]{2,})['"`]/g;

/**
 * Glyph names referenced by the sources.
 *
 * @param {Set<string>} validNames Official Material Symbols names; anything
 *   outside it is a coincidence, not an icon.
 * @param {string} [root]
 * @returns {Map<string, string[]>} glyph → the files that reference it.
 */
export function extractGlyphs(validNames, root = REPO_ROOT) {
  const found = new Map();
  const add = (glyph, file) => {
    if (!validNames.has(glyph)) return;
    if (!found.has(glyph)) found.set(glyph, []);
    const rel = path.relative(root, file);
    if (!found.get(glyph).includes(rel)) found.get(glyph).push(rel);
  };
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(SPAN_TEXT)) add(m[1], file);
    for (const m of text.matchAll(TEXT_ASSIGNMENT)) {
      for (const s of m[1].matchAll(STRING_LITERAL)) add(s[1], file);
    }
  }
  return new Map([...found.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Parse Google's `.codepoints` file: one `name hex` pair per line. */
export function parseCodepoints(text) {
  return new Set(
    text.split('\n')
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean),
  );
}

/** Where the generated manifest lives, for the build script and the test alike. */
export const GLYPH_MANIFEST_PATH = path.join(REPO_ROOT, 'config', 'material-symbols-subset.json');
export const CODEPOINTS_CACHE_PATH = path.join(REPO_ROOT, 'config', 'material-symbols-codepoints.txt');
