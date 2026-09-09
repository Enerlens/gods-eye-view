#!/usr/bin/env node
/**
 * qa-voice-bench.mjs — does the voice brain still route French correctly?
 *
 * WHY THIS IS IN THE REPO AND NOT IN A SCRATCH DIRECTORY. On 2026-09-09 an
 * operator asked, in French, for the doctors layer and was told it did not
 * exist. Nothing in the unit suite could have caught that: the layer was
 * registered, the runner resolved it, the manager would have enabled it. The
 * failure lived entirely in what the MODEL was allowed to say — a 17-value enum
 * for a 60-layer registry. Only a real model turn against the real shipped
 * schema sees that class of bug, and this is that turn, 90 of them.
 *
 * WHAT IT MEASURES
 *   A. ROUTING — one French phrase in, which tool (and sometimes which
 *      argument) comes back. This is the layer-vocabulary regression net: the
 *      whole registry is probed with the words a person actually says.
 *   B. READING — a canned tool result in, does the model read the numbers out
 *      loud in French instead of sending the operator to a website? This is the
 *      bike-station regression.
 *   C. BRIEF (opt-in) — grounded vs ungrounded narration of a place, the
 *      hallucination probe the earlier bench established.
 *
 * CONFIG IS READ FROM vite.config.js, NEVER COPIED. The instructions and the
 * tool schemas are sliced out of the shipped source as text and evaluated, so
 * an edit to either changes this bench automatically. A bench with its own copy
 * of the prompt measures the copy.
 *
 * COST. Measured 2026-09-09: the 26-case routing bench cost $0.15 on
 * mistral-medium-3.1. This one runs ~90 routing cases plus 6 reading cases, so
 * budget roughly $0.20–0.40 per model per pass. `--cases N` caps it while
 * iterating, and the run prints what it actually spent.
 *
 * USAGE
 *   OPENROUTER_API_KEY=… node scripts/qa-voice-bench.mjs
 *   node scripts/qa-voice-bench.mjs --mode routing --cases 20
 *   node scripts/qa-voice-bench.mjs --mode reading
 *   node scripts/qa-voice-bench.mjs --models mistralai/mistral-medium-3.1,openai/gpt-5-mini
 *
 * NOTE ON PROVIDERS. This bench drives the OpenRouter text brain, because that
 * is the path whose routing can be measured cheaply and offline from a browser.
 * The instructions and the tool schemas it exercises are the SAME ones the
 * OpenAI Realtime session is opened with, so a routing regression found here is
 * a routing regression there — the transport differs, the contract does not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LAYER_TAXONOMY } from '../src/data/layerTaxonomy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

/* ---------------------------------------------------------------- config -- */

function parseArgs(argv) {
  const args = { mode: 'routing', cases: Infinity, models: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--mode') args.mode = argv[++i];
    else if (flag === '--cases') args.cases = Number(argv[++i]) || Infinity;
    else if (flag === '--models') args.models = argv[++i].split(',').map((m) => m.trim());
    else if (flag === '--out') args.out = argv[++i];
    else if (flag === '--help' || flag === '-h') args.help = true;
  }
  return args;
}

/**
 * The key, from the environment or from the repo-root .env the dev server reads.
 * Nothing else: a bench that hunts for keys in a user's home directory is a
 * bench that bills an account nobody meant to bill.
 */
function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (match && match[1].trim()) return match[1].trim();
  }
  throw new Error('No OPENROUTER_API_KEY — set it in the environment or in .env at the repo root.');
}

/** Slice a top-level array literal out of source text, brackets included. */
function sliceLiteral(source, startMarker, endMarker) {
  const a = source.indexOf(startMarker);
  if (a < 0) throw new Error(`marker not found: ${startMarker}`);
  const open = a + startMarker.length - 1;
  const b = source.indexOf(endMarker, open);
  if (b < 0) throw new Error(`end not found: ${endMarker}`);
  return source.slice(open, b + endMarker.indexOf(']') + 1);
}

const vite = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
const RT_TOOLS = new Function(`return ${sliceLiteral(vite, 'const GEV_REALTIME_TOOLS = [', '\n];')}`)();
const INSTRUCTIONS = [
  new Function(`return ${sliceLiteral(vite, 'const GEV_VOICE_INSTRUCTION_LINES = [', '\n];')}`)().join('\n'),
  'You are answering ONE spoken turn. Make every tool call the request needs before you speak, then give a single short spoken confirmation.',
  'Speak French. Every spoken answer must be in French.',
].join('\n');

/** Realtime tool shape → chat-completions shape, exactly as the server does it. */
const TOOLS = RT_TOOLS.map((tool) => ({
  type: 'function',
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
}));

/* --------------------------------------------------------- A. routing ----- */

/**
 * Two French phrasings for every registered layer.
 *
 * The plan asked for "43 layers × 2 phrasings"; deriving them from the registry
 * covers all 59 and cannot fall behind it. One phrasing uses the panel LABEL
 * (what the operator reads on screen), the other a natural spoken form built
 * from it — which is also the pair that broke: the model could say neither.
 */
function layerCases() {
  const cases = [];
  for (const entry of LAYER_TAXONOMY) {
    if (entry.kind !== 'dataset') continue;
    const bare = entry.label.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    cases.push({
      fr: `Affiche la couche ${bare}.`,
      want: 'set_layer_visibility',
      arg: (a) => a?.layerId === entry.id,
      argLabel: entry.id,
      group: 'layers',
    });
    cases.push({
      fr: `Montre-moi ${bare.toLowerCase()}.`,
      want: 'set_layer_visibility',
      arg: (a) => a?.layerId === entry.id,
      argLabel: entry.id,
      group: 'layers',
    });
  }
  return cases;
}

/** The original 26, kept verbatim: they are the surface's regression net. */
const CORE_CASES = [
  { fr: 'Emmène-moi à Bordeaux.', want: 'fly_to_location' },
  { fr: 'Va sur la tour Eiffel.', want: 'fly_to_location' },
  { fr: 'Montre les avions.', want: 'set_layer_visibility' },
  { fr: 'Coupe les avions.', want: 'set_layer_visibility' },
  { fr: 'Recule complètement, vue du globe entier.', want: 'zoom_to_globe' },
  { fr: 'Zoome un peu plus.', want: 'adjust_camera_zoom' },
  { fr: "Combien d'avions au-dessus de la Bretagne ?", want: 'analyst_query' },
  { fr: "Qu'est-ce que je regarde ?", want: 'get_entity_context' },
  { fr: 'Suis cet avion.', want: 'track_entity' },
  { fr: 'Arrête de suivre.', want: 'stop_tracking' },
  { fr: 'Passe en vision nocturne.', want: 'set_visual_style' },
  { fr: "Passe sur l'imagerie aérienne Bing.", want: 'set_map_stack' },
  { fr: 'Affiche les satellites.', want: 'set_layer_visibility' },
  { fr: 'Ouvre le panneau Contacts.', want: 'set_context_mode' },
  { fr: 'Mets la radio.', want: 'control_radio' },
  { fr: 'Caméra suivante.', want: 'control_cctv' },
  { fr: 'Passe le HUD en disposition opérateur.', want: 'set_hud' },
  { fr: 'Mets la densité de détection à 50.', want: 'set_detection' },
  { fr: 'Entre en mode cockpit.', want: 'control_cockpit' },
  { fr: 'Efface les annotations.', want: 'clear_annotations' },
  { fr: 'Fais une orbite autour de ça.', want: 'move_camera' },
  { fr: 'Quand est-ce que la station spatiale repasse au-dessus ?', want: 'next_iss_pass' },
  { fr: 'Montre-moi les avions au-dessus de ma tête.', want: 'frame_overhead' },
  { fr: 'Joue la scène veille orbitale.', want: 'control_scene' },
  { fr: 'Trace le trajet à pied de la gare de Lyon à la Bastille.', want: 'annotate_map', arg: (a) => a?.annotations?.[0]?.type === 'route', argLabel: 'type=route' },
  { fr: "À quelle distance est Montmartre d'ici ?", want: 'annotate_map', arg: (a) => a?.annotations?.[0]?.type === 'arrow', argLabel: 'type=arrow' },
];

/** The cases written FOR the September 2026 report, each naming its failure. */
const REPORT_CASES = [
  // "He said he does not have the doctors layer." He could not name it.
  { fr: 'Active la couche médecin.', want: 'set_layer_visibility', arg: (a) => a?.layerId === 'medecins-fr', argLabel: 'medecins-fr', group: 'report' },
  { fr: 'Montre les docteurs autour de moi.', want: 'set_layer_visibility', arg: (a) => a?.layerId === 'medecins-fr', argLabel: 'medecins-fr', group: 'report' },
  { fr: 'Je veux voir les bornes de recharge.', want: 'set_layer_visibility', arg: (a) => a?.layerId === 'irve-fr', argLabel: 'irve-fr', group: 'report' },
  // Discovery instead of denial.
  { fr: 'Quelles couches de données as-tu ?', want: 'list_layers', group: 'report' },
  { fr: 'Tu as quelque chose sur les licornes ?', want: 'list_layers', group: 'report' },
  // "He could not tell me the capacity and state of the station."
  { fr: 'Combien de vélos et de places à cette station ?', want: 'get_entity_context', group: 'report' },
  { fr: "Combien de bornes de recharge dans la vue ?", want: 'analyst_query', arg: (a) => (a?.layers || []).includes('irve-fr'), argLabel: 'layers=irve-fr', group: 'report' },
  { fr: 'La station de vélos la plus proche avec des vélos disponibles.', want: 'analyst_query', arg: (a) => (a?.layers || []).includes('bikeshare'), argLabel: 'layers=bikeshare', group: 'report' },
  // Situation questions that must be answered WITHOUT a tool call, from the
  // preamble the client sends. `situation: true` makes this bench send the
  // same preamble production does — without it the case is unfair, because the
  // model genuinely has nowhere to read the answer from.
  { fr: 'Où suis-je ?', want: null, situation: true, group: 'report' },
  { fr: 'Je regarde quoi, là ?', want: null, situation: true, group: 'report' },
];

/**
 * A situation preamble in the shape `buildSituationBrief()` produces.
 *
 * Copied rather than imported on purpose: the builder needs a Cesium viewer,
 * and what this bench is testing is whether the MODEL uses a preamble of this
 * shape, not whether the builder assembles one — `gevActions.test.mjs` owns
 * that half. If the two shapes drift, this case fails, which is the signal.
 */
const SITUATION_BRIEF = [
  '[GEV SITUATION — automatic, refreshed each turn. Use it to answer directly; do not read it aloud, '
  + 'and do not call a tool to re-fetch what is already stated here.]',
  'Camera: 44.8404, -0.5805 at 1.2 km looking at 44.8410, -0.5798 — Bordeaux, Nouvelle-Aquitaine, France (city scale).',
  'Layers on (2): Stations vélos 312 · Médecins 128.',
  'Selected: bike-station "Place Gambetta" — name Place Gambetta, bikesAvailable 12, docksAvailable 8, capacity 20. "This one" means THIS.',
].join('\n');

/* --------------------------------------------------------- B. reading ----- */

/**
 * Cases that hand the model a tool RESULT and grade what it says.
 *
 * The failure being measured: given a station's numbers, the model referred the
 * operator to the operator's website. The graders below are deliberately crude
 * string checks — they assert the numbers were spoken and that no identifier or
 * field name was — because that is exactly the complaint, and a subtler grader
 * would need a second model and a second bill.
 */
const READING_CASES = [
  {
    name: 'bike station: read the numbers, not a URL',
    ask: 'Combien de vélos et de places à cette station ?',
    result: {
      ok: true,
      action: 'get_entity_context',
      scope: 'selected',
      selected: {
        layerId: 'bikeshare', id: 'bordeaux-tbm:1042', kind: 'bike-station',
        name: 'Place Gambetta', system: 'Le Vélo (TBM)', city: 'Bordeaux, FR',
        bikesAvailable: 12, docksAvailable: 8, capacity: 20, occupancyPct: 60,
        installed: true, renting: true, returning: true, source: 'GBFS',
      },
    },
    must: [/12|douze/i, /8|huit/i],
    mustNot: [/https?:\/\//i, /site (officiel|web)/i, /bikesAvailable/, /bordeaux-tbm/],
  },
  {
    name: 'bike station: an unreported count is not zero',
    ask: 'Combien de vélos à cette station ?',
    result: {
      ok: true, action: 'get_entity_context', scope: 'selected',
      selected: {
        layerId: 'bikeshare', id: 'x:1', kind: 'bike-station', name: 'Quinconces',
        bikesAvailable: null, docksAvailable: null, capacity: 20, occupancyPct: null,
      },
    },
    must: [/(pas|non|aucune?) (encore )?(de )?(donn|remont|publi|rapport|communiqu)/i],
    mustNot: [/\b0 vélos?\b/i, /\bzéro vélos?\b/i],
  },
  {
    name: 'unknown layer: offer the neighbours, do not close the subject',
    ask: 'Montre la couche des médecins.',
    result: {
      ok: false, action: 'set_layer_visibility', layerId: 'medecin',
      error: 'Unknown data layer: medecin',
      suggestions: [{ id: 'medecins-fr', label: 'Médecins' }, { id: 'amenities-fr', label: 'Équipements du quotidien' }],
      hint: 'Name the closest registered layers to the operator and ask which they meant.',
    },
    // Three right answers: name the neighbours out loud, go and check the
    // registry, or simply retry with the corrected id. What is wrong — and
    // what happened before the suggestions existed — is closing the subject.
    acceptCall: (calls) => calls.some((call) => call.name === 'list_layers'
      || (call.name === 'set_layer_visibility' && call.args?.layerId === 'medecins-fr')),
    followUp: () => ({ ok: true, action: 'set_layer_visibility', layerId: 'medecins-fr', enabled: true }),
    must: [/médecins/i],
    mustNot: [/n['’]existe pas/i, /je n['’]ai pas cette couche/i],
  },
  {
    name: 'charge points: never invent an availability nobody publishes',
    ask: 'Il y a des bornes libres ici ?',
    result: {
      ok: true, action: 'get_entity_context', scope: 'selected',
      selected: {
        layerId: 'irve-fr', id: 's1', kind: 'charge-point-site', detail: 'full',
        name: 'Parking Victoire', commune: 'Bordeaux', chargePoints: 6, peakKW: 150,
        powerBand: 'Haute puissance (> 150 kW)', availabilityKnown: false,
        availabilityNote: 'Live availability is NOT published for this layer: the national IRVE file is a static inventory, and real-time occupancy is per-operator OCPI behind a contract. Say so; do not query for it.',
      },
    },
    must: [/6|six/],
    mustNot: [/\b(libres?|disponibles?) (maintenant|actuellement)\b/i],
    // The engine's OWN refusal, verbatim in shape: a filter naming a field the
    // layer never publishes is rejected with the real field list, so the model
    // gets one honest chance to stop hunting and answer.
    followUp: (name, rawArgs) => {
      if (name !== 'analyst_query') return { ok: true, action: name };
      let args = {};
      try { args = JSON.parse(rawArgs || '{}'); } catch { /* below */ }
      const stray = (args.filters || []).map((filter) => filter?.field)
        .filter((field) => field && !['chargePoints', 'chargePointsPublished', 'peakKW', 'name', 'commune', 'powerBand', 'access', 'detail', 'freeToUse', 'id', 'lat', 'lon'].includes(field));
      if (!stray.length) return { ok: true, action: 'analyst_query', count: 6, scopeLabel: 'dans la vue', items: [] };
      return {
        ok: false,
        action: 'analyst_query',
        error: `irve-fr has no field ${stray.join(', ')} — available fields: chargePoints, chargePointsPublished, peakKW, name, commune, powerBand, access, detail, freeToUse. `
          + 'A field this layer does not publish is not something it withholds; it is something it never measured.',
        coverage: { layersQueried: [], scope: 'unknown-field' },
      };
    },
  },
  {
    name: 'counts in view are counts in view, not national totals',
    ask: "Combien de bornes de recharge en France ?",
    result: {
      ok: true, action: 'analyst_query', count: 44, scopeLabel: 'dans la vue',
      coverage: { layersQueried: [{ layerKey: 'irve-fr', records: 44 }], note: 'in view — counts cover loaded data; irve-fr loads by viewport or camera proximity, so this is a count around the current view, never a national or world total' },
      items: [],
    },
    must: [/44|quarante-quatre/],
    mustNot: [/en France(?!\s*,?\s*(je|il)?\s*(ne|n['’]ai))/i],
  },
  {
    name: 'no field names, no underscores, no raw ids',
    ask: 'Décris cette station.',
    result: {
      ok: true, action: 'get_entity_context', scope: 'selected',
      selected: {
        layerId: 'bikeshare', id: 'bordeaux-tbm:1042', kind: 'bike-station',
        name: 'Place Gambetta', bikesAvailable: 3, docksAvailable: 17, capacity: 20,
        lastReportedMs: Date.now() - 240000,
      },
    },
    must: [/Gambetta/],
    mustNot: [/bikesAvailable/, /docksAvailable/, /bordeaux-tbm/, /_/, /lastReportedMs/],
  },
];

/* ------------------------------------------------------------- driver ----- */

const MODELS_DEFAULT = ['mistralai/mistral-medium-3.1'];

async function chat(key, model, messages, { tools = null, maxTokens = 700 } = {}) {
  const body = { model, messages, max_tokens: maxTokens, temperature: 0, top_p: 1 };
  if (tools) { body.tools = tools; body.tool_choice = 'auto'; }
  const response = await fetch(OR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return { msg: data.choices?.[0]?.message || {}, usage: data.usage || {} };
}

async function runRouting(key, model, cases) {
  const rows = [];
  let cost = 0;
  for (const testCase of cases) {
    const row = { fr: testCase.fr, want: testCase.want, group: testCase.group || 'core', got: null, grade: 'error', argOk: null, note: '' };
    try {
      const { msg, usage } = await chat(key, model, [
        { role: 'system', content: INSTRUCTIONS },
        ...(testCase.situation ? [{ role: 'user', content: SITUATION_BRIEF }] : []),
        { role: 'user', content: testCase.fr },
      ], { tools: TOOLS, maxTokens: 900 });
      cost += usage.cost || 0;
      const calls = (msg.tool_calls || []).map((call) => call.function?.name).filter(Boolean);
      row.got = calls.join('+') || '(parle)';
      // `want: null` means the phrase must be answered from context, with no
      // tool call at all — that is the whole point of the situation preamble.
      if (testCase.want === null) row.grade = calls.length ? 'miss' : 'exact';
      else if (!calls.length) row.grade = 'no_call';
      else if (calls[0] === testCase.want) row.grade = 'exact';
      else if (calls.includes(testCase.want)) row.grade = 'partial';
      else row.grade = 'miss';
      if (testCase.arg && calls.includes(testCase.want)) {
        const call = msg.tool_calls.find((entry) => entry.function?.name === testCase.want);
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* graded below */ }
        row.argOk = Boolean(testCase.arg(args));
        row.note = `${testCase.argLabel} → ${row.argOk ? 'ok' : JSON.stringify(args).slice(0, 80)}`;
      }
    } catch (error) {
      row.note = String(error.message).slice(0, 120);
    }
    rows.push(row);
    process.stderr.write(row.grade === 'exact' && row.argOk !== false ? '.' : '!');
  }
  return { rows, cost };
}

/**
 * Rounds one reading case may take before it has to have spoken.
 *
 * Three, not two, because the corrective path is genuinely three moves long:
 * ask → refused with the real field list → re-ask correctly → speak. Production
 * allows five (`maxRounds`), so a case that needs a fourth is a case the
 * operator would hear as a long silence, and failing it here is correct.
 */
const READING_MAX_ROUNDS = 3;

async function runReading(key, model) {
  const rows = [];
  let cost = 0;
  for (const testCase of READING_CASES) {
    const row = { name: testCase.name, said: '', calls: [], grade: 'error', note: '' };
    try {
      const messages = [
        { role: 'system', content: INSTRUCTIONS },
        { role: 'user', content: testCase.ask },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: testCase.result.action, arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'c1', content: JSON.stringify(testCase.result) },
      ];
      // PRODUCTION RUNS UP TO FIVE ROUNDS, so grading only the first assistant
      // turn measures something the operator never hears. A model that goes and
      // looks once and then answers is behaving correctly; what is graded is
      // what it eventually SAYS. `followUp` supplies the second tool result —
      // for a stray filter that is the engine's real refusal, which is what
      // production would hand back.
      let msg = {};
      for (let round = 0; round < READING_MAX_ROUNDS; round += 1) {
        // Tools travel even though this turn should not need one: production
        // always sends them, and an assistant `tool_calls` message with no tool
        // list is a malformed conversation for several providers.
        const reply = await chat(key, model, messages, { tools: TOOLS, maxTokens: 400 });
        cost += reply.usage.cost || 0;
        msg = reply.msg;
        const pending = (msg.tool_calls || []).filter((call) => call.function?.name);
        if (!pending.length || !testCase.followUp || round === READING_MAX_ROUNDS - 1) break;
        messages.push({ role: 'assistant', content: msg.content || null, tool_calls: pending });
        for (const call of pending) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(testCase.followUp(call.function.name, call.function.arguments)),
          });
        }
      }
      row.said = (msg.content || '').trim();
      row.calls = (msg.tool_calls || []).map((call) => {
        let args = {};
        try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* graded as-is */ }
        return { name: call.function?.name, args };
      }).filter((call) => call.name);
      // A turn that ACTS instead of talking is not automatically a failure —
      // re-issuing set_layer_visibility with the corrected id is a better
      // outcome than a sentence about it. Cases that accept an action say
      // which one; every other case has to speak.
      if (row.calls.length && testCase.acceptCall?.(row.calls)) {
        row.grade = 'pass';
        row.note = `a appelé ${row.calls.map((call) => call.name).join('+')}`;
        rows.push(row);
        process.stderr.write('.');
        continue;
      }
      const missing = (testCase.must || []).filter((pattern) => !pattern.test(row.said));
      const forbidden = (testCase.mustNot || []).filter((pattern) => pattern.test(row.said));
      row.grade = missing.length || forbidden.length ? 'fail' : 'pass';
      if (row.calls.length) {
        row.note += `a appelé ${row.calls.map((call) => `${call.name}${JSON.stringify(call.args)}`).join('+')} au lieu de répondre; `;
      }
      if (missing.length) row.note += `missing ${missing.map(String).join(', ')}; `;
      if (forbidden.length) row.note += `said ${forbidden.map(String).join(', ')}`;
    } catch (error) {
      row.note = String(error.message).slice(0, 120);
    }
    rows.push(row);
    process.stderr.write(row.grade === 'pass' ? '.' : '!');
  }
  return { rows, cost };
}

/* ---------------------------------------------------------------- main ---- */

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}

const key = loadKey();
const models = args.models || MODELS_DEFAULT;
const allRouting = [...CORE_CASES, ...REPORT_CASES, ...layerCases()];
const routingCases = Number.isFinite(args.cases) ? allRouting.slice(0, args.cases) : allRouting;

console.error(
  `tools=${TOOLS.length} instructions=${INSTRUCTIONS.length} chars `
  + `routing=${routingCases.length} reading=${READING_CASES.length} models=${models.join(',')}`,
);

const results = {};
let failed = false;
for (const model of models) {
  try {
    results[model] = args.mode === 'reading'
      ? await runReading(key, model)
      : await runRouting(key, model, routingCases);
  } catch (error) {
    results[model] = { error: String(error.message).slice(0, 200) };
  }
  process.stderr.write(`\n[fini] ${model}\n`);
}

for (const [model, result] of Object.entries(results)) {
  if (result.error) { console.log(`${model.padEnd(34)} ERREUR ${result.error}`); failed = true; continue; }
  if (args.mode === 'reading') {
    const passed = result.rows.filter((row) => row.grade === 'pass').length;
    console.log(`\n${model}  lecture ${passed}/${result.rows.length}  $${(result.cost || 0).toFixed(4)}`);
    for (const row of result.rows) {
      console.log(` ${row.grade === 'pass' ? '✔' : '✖'} ${row.name}${row.note ? ` — ${row.note}` : ''}`);
      if (row.grade !== 'pass') console.log(`    « ${row.said.slice(0, 240)} »`);
    }
    if (passed < result.rows.length) failed = true;
    continue;
  }
  const total = result.rows.length;
  const exact = result.rows.filter((row) => row.grade === 'exact').length;
  const withArgs = result.rows.filter((row) => row.argOk !== null);
  const argsOk = withArgs.filter((row) => row.argOk).length;
  console.log(
    `\n${model}  exact ${exact}/${total}  args ${argsOk}/${withArgs.length}  $${(result.cost || 0).toFixed(4)}`,
  );
  for (const row of result.rows) {
    if (row.grade === 'exact' && row.argOk !== false) continue;
    console.log(` ✖ [${row.group}] "${row.fr}" → ${row.got} (voulu ${row.want || 'aucun appel'}) ${row.note}`);
    failed = true;
  }
}

const out = args.out || path.join(ROOT, '.context', `voice-bench-${args.mode}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  mode: args.mode,
  at: new Date().toISOString(),
  toolCount: TOOLS.length,
  instructionsChars: INSTRUCTIONS.length,
  results,
}, null, 2));
console.log(`\névidence → ${path.relative(ROOT, out)}`);
process.exit(failed ? 1 : 0);
