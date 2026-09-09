#!/usr/bin/env node
/*
 * MEASURE — the two spoken turns that bracket the machine chain.
 *
 * `measure-plug-e2e.mjs` and `measure-plug-render.mjs` time everything from
 * the search to the first frame. Between them and the visitor sit two Realtime
 * turns nobody here has ever timed:
 *
 *   turn 1  the question is understood and a tool call leaves    → t(tool)
 *   turn 2  the proposal is spoken back                          → t(audio)
 *
 * This times both, against the PRODUCTION instructions and tool definitions —
 * the session is minted by the app's own `/api/realtime/token`, exactly as
 * `qa-voice-routing.mjs` does, so what is measured is the config that ships.
 * `--with-plug-tools` adds the two tools the dataset flow would need, so the
 * routing of a question this agent cannot answer today can be measured before
 * anything is built for it.
 *
 * Text in, audio out: a text turn removes the visitor's own speaking time
 * (which is theirs, not ours) while keeping the answer's real audio latency.
 *
 * ⚠ NEVER RUN. As of 2026-09-09 `OPENAI_API_KEY` is empty in the root `.env`
 * and in every workspace, so `/api/realtime/token` answers 503 and this file
 * has never executed once. Treat its output as unverified until it has.
 *
 * Run: node scripts/measure-voice-turn.mjs --url http://localhost:4415 [--reps 3] [--with-plug-tools]
 */
import WebSocket from 'ws';

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const APP_URL = option('--url', 'http://localhost:4415');
const REPS = Number(option('--reps', '3'));
const WITH_PLUG_TOOLS = args.includes('--with-plug-tools');

/** The tools the dataset flow would need, shaped as they would ship. */
const PLUG_TOOLS = [
  {
    type: 'function',
    name: 'search_datasets',
    description: 'Search the French open-data catalogue for a dataset the visitor asked about, and report which of the hits can actually be drawn. Use for "est-ce qu\'on a…", "trouve-moi les données de…", "il existe un jeu sur…". Propose, never plug: plug_dataset is a separate call the visitor has to agree to first.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string', description: 'What to look for, in French, as the visitor said it.' } },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'plug_dataset',
    description: 'Draw a dataset that search_datasets has already proposed and the visitor has agreed to. Never call it before the visitor said yes to one named proposal.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { datasetPage: { type: 'string', description: 'The dataset page URL from search_datasets.' } },
      required: ['datasetPage'],
    },
  },
];

const PHRASES = WITH_PLUG_TOOLS
  ? [
    { text: 'Est-ce qu\'on a les défibrillateurs ?', expect: 'search_datasets' },
    { text: 'Tu peux trouver les bornes de recharge électriques ?', expect: 'search_datasets' },
    { text: 'Oui, affiche celui-là.', expect: 'plug_dataset' },
  ]
  : [
    { text: 'Allume les vols.', expect: 'set_layer_visibility' },
    { text: 'Emmène-moi à Paris.', expect: 'fly_to_location' },
  ];

async function mint() {
  const response = await fetch(`${APP_URL}/api/realtime/token`, { method: 'POST' });
  if (!response.ok) throw new Error(`token ${response.status}: ${(await response.text()).slice(0, 120)}`);
  const body = await response.json();
  const value = body?.value || body?.client_secret?.value;
  if (!value) throw new Error('no client secret in the mint');
  return { value, model: body?.session?.model || 'gpt-realtime' };
}

function connect(secret, model) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const timer = setTimeout(() => reject(new Error('ws connect timeout')), 15000);
    socket.on('open', () => { clearTimeout(timer); resolve(socket); });
    socket.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

/** One turn, timed at every boundary the visitor can perceive. */
function runTurn(socket, text) {
  return new Promise((resolve) => {
    const marks = { tool: null, toolName: null, audio: null, done: null, error: null };
    const started = performance.now();
    const onMessage = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (marks.tool == null && message.type === 'response.output_item.done' && message.item?.type === 'function_call') {
        marks.tool = performance.now() - started;
        marks.toolName = message.item.name;
        // A neutral result, so the model can produce the spoken half of the turn.
        socket.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: message.item.call_id, output: JSON.stringify({ ok: true, note: 'mesure' }) },
        }));
        socket.send(JSON.stringify({ type: 'response.create' }));
      }
      if (marks.audio == null && /^response\.(output_)?audio\.delta$/.test(message.type || '')) {
        marks.audio = performance.now() - started;
      }
      if (message.type === 'error') marks.error = message.error?.message || 'realtime error';
      if (message.type === 'response.done' && (marks.tool == null || marks.audio != null)) {
        marks.done = performance.now() - started;
        socket.off('message', onMessage);
        resolve(marks);
      }
    };
    socket.on('message', onMessage);
    const timer = setTimeout(() => { socket.off('message', onMessage); resolve({ ...marks, error: marks.error || 'timeout' }); }, 45000);
    const settle = resolve;
    resolve = (value) => { clearTimeout(timer); settle(value); };
    socket.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }));
    socket.send(JSON.stringify({ type: 'response.create' }));
  });
}

const ms = (value) => (value == null ? '—' : `${Math.round(value)} ms`);
function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] };
}

const { value, model } = await mint();
console.log(`session ${model}${WITH_PLUG_TOOLS ? ' + search_datasets/plug_dataset' : ''}\n`);
const socket = await connect(value, model);
if (WITH_PLUG_TOOLS) {
  socket.send(JSON.stringify({ type: 'session.update', session: { tools: PLUG_TOOLS } }));
}
const runs = [];
try {
  for (const phrase of PHRASES) {
    console.log(`━━ « ${phrase.text} »`);
    for (let rep = 1; rep <= REPS; rep += 1) {
      const marks = await runTurn(socket, phrase.text);
      runs.push({ ...marks, text: phrase.text, rep });
      const routed = marks.toolName === phrase.expect ? '✔' : `✖ ${marks.toolName || 'aucun outil'}`;
      console.log(`   ${rep}  outil ${ms(marks.tool).padStart(8)} · 1er son ${ms(marks.audio).padStart(8)} · fin ${ms(marks.done).padStart(8)}  ${routed}${marks.error ? ` — ${marks.error}` : ''}`);
    }
  }
} finally {
  socket.close();
}

console.log('\n━━━━━━ DISTRIBUTION ━━━━━━');
for (const key of ['tool', 'audio', 'done']) {
  const summary = stats(runs.map((run) => run[key]));
  console.log(`${key.padEnd(6)} ${ms(summary?.min).padStart(9)} … ${ms(summary?.median).padStart(9)} … ${ms(summary?.max).padStart(9)}`);
}
