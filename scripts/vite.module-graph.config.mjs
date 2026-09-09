/**
 * perf:graph — what `src/main.js` actually drags into the boot bundle.
 *
 * ── WHY A ROLLUP CONFIG AND NOT A GREP ──────────────────────────────────────
 *
 * Twice now, the biggest single item in a code-splitting pass has been an edge
 * nobody suspected, and both times a `grep` said the opposite of the truth:
 *
 *   - #123: `src/ui.js` imported thirteen data layers with intra-directory
 *     specifiers (`from './flights.js'`), which a search for
 *     `from '.*data/flights\.js'` misses entirely.
 *   - 2026-09-09: `src/hud.js` pulled 164 kB of voice machinery for one
 *     context function, and `src/locations.js` 50 kB of annotation resolver for
 *     two geocoding helpers. Both looked like leaf imports and were not.
 *
 * The module graph Rollup itself builds cannot be wrong about this, so it is
 * what this asks. Run:
 *
 *   npm run perf:graph
 *
 * It prints the static closure's size and writes `.context/perf/graph.json`
 * with `{ closure, all }` — each module's rendered size, its static and dynamic
 * imports, and its importers. From there the useful question is usually "what
 * would deferring X remove", which is the closure recomputed with X blocked.
 *
 * The build it produces is a normal one; only the extra plugin differs — and it
 * is pointed at a throwaway `--outDir`, because it must not become the `dist/`
 * a `vite preview` then serves: this config knows nothing of
 * `scripts/precompress-dist.mjs`, so its output has no `.br` siblings, and a
 * delivery measured against it silently falls back to gzip. (Cost of learning
 * that: two `qa:brotli` runs reading 8/17 for a reason that was not in the
 * code under test.)
 */
import path from 'node:path';
import fs from 'node:fs';
import base from '../vite.config.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '.context/perf/graph.json');

export default async (env) => {
  const config = await base(env);
  config.plugins.push({
    name: 'gev-module-graph',
    generateBundle() {
      const rel = (id) => path.relative(ROOT, id).split(path.sep).join('/');
      const nodes = new Map();
      for (const id of this.getModuleIds()) {
        const info = this.getModuleInfo(id);
        if (!info || info.isExternal) continue;
        nodes.set(id, {
          id: rel(id),
          size: info.code ? Buffer.byteLength(info.code) : 0,
          // Absolute ids, as rollup reports them; the reader relativises.
          static: info.importedIds || [],
          dynamic: info.dynamicallyImportedIds || [],
          importers: (info.importers || []).map(rel),
        });
      }
      const entry = [...nodes.keys()].find((id) => id.endsWith('/src/main.js'));
      const seen = new Set();
      const stack = [entry];
      while (stack.length) {
        const id = stack.pop();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        for (const next of nodes.get(id)?.static || []) stack.push(next);
      }
      const closure = [...seen].map((id) => nodes.get(id)).filter(Boolean);
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, JSON.stringify({ closure, all: [...nodes.values()] }, null, 1));
      // Reported in two halves since Cesium came in through the module graph
      // (`rebuildCesium`, 2026-09-09): the engine is ~1 390 modules of the
      // closure and moves only when the engine moves, so a single total would
      // drown the number this tool exists to watch.
      const kB = (bytes) => `${(bytes / 1024).toFixed(0)} kB`;
      const size = (list) => list.reduce((n, m) => n + m.size, 0);
      const vendor = closure.filter((m) => m.id.includes('node_modules/'));
      const own = closure.filter((m) => !m.id.includes('node_modules/'));
      console.log(
        `[graph] fermeture statique de src/main.js, avant minification :\n`
        + `        ce dépôt   ${String(own.length).padStart(5)} modules  ${kB(size(own)).padStart(10)}\n`
        + `        vendor     ${String(vendor.length).padStart(5)} modules  ${kB(size(vendor)).padStart(10)}\n`
        + `        total      ${String(closure.length).padStart(5)} modules  ${kB(size(closure)).padStart(10)}`
        + `  → ${path.relative(ROOT, OUT)}`,
      );
    },
  });
  return config;
};
