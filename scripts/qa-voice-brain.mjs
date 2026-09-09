#!/usr/bin/env node
/**
 * qa-voice-brain.mjs — acceptance for the OpenRouter voice path.
 *
 * The realtime harness (qa-voice-routing.mjs) needs an OpenAI key and a WebRTC
 * session. This one drives the OTHER brain: browser speech recognition, a text
 * model behind /api/voice/brain, and the shared action runner.
 *
 * WHY THE MICROPHONE IS FAKED. Headless Chromium ships no SpeechRecognition
 * implementation, and no flag adds one — the API is a thin client for a Google
 * speech service. So the harness installs a stub recogniser before app scripts
 * run and feeds it French sentences. Everything downstream of the transcript is
 * REAL: the relay, the model, the 28 tool schemas, the runner, and the world it
 * moves. What this cannot prove is the recognition accuracy itself; that is a
 * browser's job, not ours.
 *
 * Usage:
 *   node scripts/qa-voice-brain.mjs                       # against :4421
 *   node scripts/qa-voice-brain.mjs --url http://localhost:5173
 *   node scripts/qa-voice-brain.mjs --case "va à Lyon"    # one ad-hoc phrase
 */
import process from 'node:process';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = readFlag('--url', 'http://localhost:4421');
const AD_HOC = readFlag('--case', null);

/**
 * Each case is one spoken French sentence and a predicate over the world it
 * should have produced. Assertions read APP STATE, never the model's words:
 * phrasing drifts between model versions, a camera position does not.
 */
const CASES = [
  {
    say: 'Emmène-moi à Bordeaux.',
    check: (state) => {
      const { longitude, latitude } = state.camera;
      // Bordeaux is -0.58, 44.84. Two degrees is generous enough for whichever
      // framing the model picks and tight enough to fail on Paris (2.35, 48.86).
      return Math.abs(longitude + 0.58) < 2 && Math.abs(latitude - 44.84) < 2
        ? null
        : `camera at ${longitude.toFixed(2)}, ${latitude.toFixed(2)} — not Bordeaux`;
    },
  },
  {
    say: 'Allume les avions.',
    check: (state) => (state.layers.includes('flights') ? null : 'flights layer is off'),
  },
  {
    say: 'Coupe les avions.',
    check: (state) => (state.layers.includes('flights') ? 'flights layer is still on' : null),
  },
  {
    say: 'Recule complètement, montre-moi le globe entier.',
    check: (state) => (state.camera.heightM > 8_000_000
      ? null
      : `camera at ${Math.round(state.camera.heightM / 1000)} km — not a globe view`),
  },
];

/** Installed before app scripts: a recogniser the harness can speak into. */
function installFakeRecognition() {
  class FakeRecognition {
    constructor() {
      this.lang = '';
      globalThis.__gevFakeRecognition = this;
    }
    start() { this.running = true; }
    stop() { this.running = false; this.onend?.(); }
    abort() { this.running = false; }
    /** Deliver one final transcript, exactly as a browser would. */
    say(text) {
      const result = [{ transcript: text }];
      result.isFinal = true;
      this.onresult?.({ resultIndex: 0, results: [result] });
    }
  }
  globalThis.SpeechRecognition = FakeRecognition;
  // Synthesis is stubbed too: headless has no voices, and a real one would make
  // every case wait out the spoken confirmation in real time.
  globalThis.speechSynthesis = {
    getVoices: () => [],
    speak: (utterance) => { globalThis.__gevSpoken = [...(globalThis.__gevSpoken || []), utterance.text]; utterance.onend?.(); },
    cancel: () => {},
  };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
}

// Metal ANGLE, like every other harness here: SwiftShader cannot construct the
// CesiumWidget on this machine, and a dead widget means no __godsEyeView to
// assert against (see scripts/qa-airports.mjs for the same flags).
const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage', '--window-size=1440,900',
  ],
});
let failures = 0;
try {
  const page = await newQaPage(browser);
  await page.evaluateOnNewDocument(installFakeRecognition);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });

  const config = await page.evaluate(async () => (await fetch('/api/voice/config')).json());
  console.log(`provider=${config.provider} model=${config.model} language=${config.language}`);
  if (config.provider !== 'openrouter') {
    console.error(`This harness needs the OpenRouter brain. Server says: ${config.reason}`);
    process.exit(2);
  }

  await page.waitForFunction(() => Boolean(globalThis.__gevVoiceCommands && globalThis.__godsEyeView), { timeout: 180_000 });
  await page.evaluate(async () => { await globalThis.__gevVoiceCommands.start({}); });
  const started = await page.evaluate(() => Boolean(globalThis.__gevVoiceCommands.brainSession?.isActive()));
  if (!started) {
    console.error('The brain session did not start.');
    process.exit(2);
  }

  const cases = AD_HOC ? [{ say: AD_HOC, check: () => null }] : CASES;
  for (const testCase of cases) {
    const outcome = await page.evaluate(async (say) => {
      const session = globalThis.__gevVoiceCommands.brainSession;
      const before = session.costUsd;
      // Read the turn out of the conversation, not out of a speechSynthesis
      // stub: `window.speechSynthesis` is a read-only accessor in Chrome, so
      // the harness's replacement never takes and the real (voiceless) one
      // answers instead. The messages are the authoritative record anyway.
      const mark = session.messages.length;
      await session.runTurn(say);
      const view = globalThis.__godsEyeView;
      const camera = view.viewer.camera.positionCartographic;
      const deg = (rad) => (rad * 180) / Math.PI;
      const turn = session.messages.slice(mark);
      return {
        spoken: turn.filter((m) => m.role === 'assistant' && m.content).map((m) => m.content),
        cost: session.costUsd - before,
        tools: turn.filter((m) => m.role === 'assistant' && m.tool_calls)
          .flatMap((m) => m.tool_calls.map((c) => `${c.function.name}${c.function.arguments}`)),
        results: turn.filter((m) => m.role === 'tool').map((m) => m.content.slice(0, 120)),
        state: {
          camera: {
            longitude: deg(camera.longitude),
            latitude: deg(camera.latitude),
            heightM: camera.height,
          },
          layers: view.dataManager.getAll().filter((l) => l.enabled).map((l) => l.id),
        },
      };
    }, testCase.say);

    // Camera flights are animated; let the tween land before reading position.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    const settled = await page.evaluate(() => {
      const view = globalThis.__godsEyeView;
      const camera = view.viewer.camera.positionCartographic;
      const deg = (rad) => (rad * 180) / Math.PI;
      return {
        camera: {
          longitude: deg(camera.longitude),
          latitude: deg(camera.latitude),
          heightM: camera.height,
        },
        layers: view.dataManager.getAll().filter((l) => l.enabled).map((l) => l.id),
      };
    });

    const problem = testCase.check(settled);
    const label = problem ? 'FAIL' : 'ok  ';
    console.log(`${label} « ${testCase.say} »`);
    console.log(`       outils : ${outcome.tools.join(' | ') || '(aucun)'}`);
    console.log(`       retours: ${outcome.results.join(' | ') || '(aucun)'}`);
    console.log(`       dit    : ${outcome.spoken.join(' / ') || '(rien)'}`);
    console.log(`       coût   : $${outcome.cost.toFixed(5)}`);
    if (problem) {
      console.log(`       ↳ ${problem}`);
      failures += 1;
    }
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} échec(s)` : '\nTous les cas passent.');
process.exit(failures ? 1 : 0);
