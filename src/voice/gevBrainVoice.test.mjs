import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeRecognitionError,
  GevBrainVoiceSession,
  fetchVoiceConfig,
  formatBrainCost,
  nextBrainStep,
  parseToolArguments,
  pickSpeechVoice,
  speechRecognitionConstructor,
} from './gevBrainVoice.js';

test('a missing /api/voice/config degrades to "no provider", never to a throw', async () => {
  const dead = await fetchVoiceConfig(async () => { throw new Error('offline'); });
  assert.equal(dead.provider, null);
  const notFound = await fetchVoiceConfig(async () => ({ ok: false, status: 404 }));
  assert.equal(notFound.provider, null);
  assert.equal(notFound.language, 'en-US');
});

test('config values are read defensively', async () => {
  const config = await fetchVoiceConfig(async () => ({
    ok: true,
    json: async () => ({ provider: 'openrouter', language: 'fr-FR', model: 'mistralai/mistral-medium-3.1', maxRounds: 99 }),
  }));
  assert.equal(config.provider, 'openrouter');
  assert.equal(config.language, 'fr-FR');
  assert.equal(config.maxRounds, 8, 'an absurd round budget is clamped, not obeyed');
});

test('the recognition constructor is found behind the webkit prefix', () => {
  assert.equal(speechRecognitionConstructor({}), null);
  const webkit = function WebkitRecognition() {};
  assert.equal(speechRecognitionConstructor({ webkitSpeechRecognition: webkit }), webkit);
});

test('tool calls win over any preamble text the model produced anyway', () => {
  const step = nextBrainStep({ content: 'Je vole vers Lyon', tool_calls: [{ function: { name: 'fly_to_location' } }] });
  assert.equal(step.action, 'tools');
  assert.equal(step.calls.length, 1);
});

test('text alone ends the turn; nothing at all is not an error', () => {
  assert.equal(nextBrainStep({ content: 'Vol vers Bordeaux' }).action, 'speak');
  assert.equal(nextBrainStep({ content: '   ' }).action, 'empty');
  assert.equal(nextBrainStep(null).action, 'empty');
});

test('malformed tool arguments become a readable result, not a crash', () => {
  assert.deepEqual(parseToolArguments(undefined), { ok: true, args: {} });
  assert.deepEqual(parseToolArguments('{"a":1}'), { ok: true, args: { a: 1 } });
  assert.equal(parseToolArguments('{oops').ok, false);
  assert.equal(parseToolArguments('[1,2]').ok, false, 'a JSON array is not an argument object');
});

test('a local voice for the exact tag beats a remote one', () => {
  const voices = [
    { lang: 'en-US', localService: true },
    { lang: 'fr-CA', localService: true },
    { lang: 'fr-FR', localService: false },
    { lang: 'fr-FR', localService: true },
  ];
  assert.equal(pickSpeechVoice(voices, 'fr-FR').localService, true);
  assert.equal(pickSpeechVoice(voices, 'fr-FR').lang, 'fr-FR');
  assert.equal(pickSpeechVoice([{ lang: 'de-DE' }], 'fr-FR'), null, 'no match is null, not a wrong-language voice');
  assert.equal(pickSpeechVoice([], 'fr-FR'), null);
});

test('cost gains a digit below a dollar so a cheap session is not shown as $0.00', () => {
  assert.equal(formatBrainCost(0.0007), '~$0.001');
  assert.equal(formatBrainCost(2.5), '~$2.50');
  assert.equal(formatBrainCost(-1), '~$0.000');
  assert.equal(formatBrainCost(NaN), '~$0.000');
});

/* ---------- a full turn, with fake ears, fake brain and fake mouth ---------- */

function makeHarness({ replies }) {
  const statuses = [];
  const spoken = [];
  const toolCalls = [];
  const host = {
    ui: { costValue: { dataset: {} }, root: { dataset: {} } },
    setStatus: (status, detail) => statuses.push([status, detail]),
    setVoiceSpeaker: () => {},
  };
  let round = 0;
  const fetchImpl = async () => ({
    ok: true,
    json: async () => replies[Math.min(round++, replies.length - 1)],
  });
  class FakeRecognition {
    start() { this.started = true; }
    stop() { this.started = false; }
    abort() { this.started = false; }
  }
  class FakeUtterance {
    constructor(text) { this.text = text; setTimeout(() => this.onend?.(), 0); }
  }
  const scope = {
    SpeechRecognition: FakeRecognition,
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: { getVoices: () => [{ lang: 'fr-FR', localService: true }], speak: (u) => spoken.push(u.text), cancel: () => {} },
  };
  const runner = async (name, args) => {
    toolCalls.push([name, args]);
    return { ok: true, name };
  };
  const session = new GevBrainVoiceSession({
    host,
    runner,
    config: { language: 'fr-FR', model: 'mistralai/mistral-medium-3.1', maxRounds: 5 },
    fetchImpl,
    scope,
  });
  return { session, statuses, spoken, toolCalls, host };
}

test('a spoken turn runs its tools, then speaks one confirmation', async () => {
  const { session, spoken, toolCalls } = makeHarness({
    replies: [
      {
        message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'fly_to_location', arguments: '{"query":"Bordeaux"}' } }] },
        usage: { cost: 0.0004 },
      },
      { message: { content: 'Vol vers Bordeaux.' }, usage: { cost: 0.0003 } },
    ],
  });
  await session.start({});
  await session.runTurn('Emmène-moi à Bordeaux');
  assert.deepEqual(toolCalls, [['fly_to_location', { query: 'Bordeaux' }]]);
  assert.deepEqual(spoken, ['Vol vers Bordeaux.']);
  assert.ok(Math.abs(session.costUsd - 0.0007) < 1e-9, 'per-round cost accumulates');
  // The tool result went back as a tool message the model can read.
  const toolMessage = session.messages.find((m) => m.role === 'tool');
  assert.equal(toolMessage.tool_call_id, 'c1');
  assert.match(toolMessage.content, /"ok":true/);
});

test('a relay failure surfaces the server message and stops the turn', async () => {
  const { session, statuses, spoken } = makeHarness({ replies: [] });
  session.fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: 'No auth credentials found' }) });
  await session.start({});
  await session.runTurn('va à Lyon');
  assert.deepEqual(spoken, []);
  assert.deepEqual(statuses.at(-1), ['error', 'No auth credentials found']);
});

test('a model that only ever calls tools is capped by maxRounds instead of looping', async () => {
  const { session, toolCalls } = makeHarness({
    replies: [{ message: { tool_calls: [{ id: 'c', function: { name: 'get_current_view_state', arguments: '{}' } }] }, usage: {} }],
  });
  await session.start({});
  await session.runTurn('boucle');
  assert.equal(toolCalls.length, 5, 'exactly maxRounds rounds, then the turn ends');
});

test('push-to-talk gates the ears: a final transcript with the key up is not sent', async () => {
  const { session, toolCalls } = makeHarness({ replies: [{ message: { content: 'ok' }, usage: {} }] });
  await session.start({ pushToTalk: true });
  session.setMicrophoneEnabled(false);
  session.handleRecognitionResult({ resultIndex: 0, results: [Object.assign([{ transcript: 'va à Lyon' }], { isFinal: true })] });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(toolCalls, []);
});

test('stop() ends the session and refuses to keep processing a late transcript', async () => {
  const { session, toolCalls } = makeHarness({ replies: [{ message: { content: 'ok' }, usage: {} }] });
  await session.start({});
  assert.equal(session.isActive(), true);
  session.stop();
  assert.equal(session.isActive(), false);
  session.handleRecognitionResult({ resultIndex: 0, results: [Object.assign([{ transcript: 'trop tard' }], { isFinal: true })] });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(toolCalls, []);
});

test('a denied microphone stops the session instead of retrying forever', async () => {
  const { session, statuses, host } = makeHarness({ replies: [] });
  await session.start({});
  session.handleRecognitionError({ error: 'not-allowed' });
  assert.equal(session.isActive(), false);
  assert.ok(statuses.some(([s, d]) => s === 'error' && /permission/i.test(d)));
  assert.match(host.nextErrorHint, /Allow the microphone/);
  // The diagnosis must survive the stop that follows it.
  assert.equal(statuses.at(-1)[0], 'error');
});

test('no-speech is normal and does not raise an error', async () => {
  const { session, statuses } = makeHarness({ replies: [] });
  await session.start({});
  const before = statuses.length;
  session.handleRecognitionError({ error: 'no-speech' });
  assert.equal(statuses.length, before);
  assert.equal(session.isActive(), true);
});

test('a browser with no SpeechRecognition says so rather than starting', async () => {
  const { session, statuses } = makeHarness({ replies: [] });
  session.scope = { speechSynthesis: session.scope.speechSynthesis };
  await session.start({});
  assert.equal(session.isActive(), false);
  assert.match(statuses.at(-1)[1], /no speech recognition/i);
});

test('the default fetch survives being called as a method — the browser checks its receiver', async () => {
  // Regression: `this.fetchImpl(...)` with the bare global made the session the
  // receiver, and Chrome answered "Illegal invocation". Node does not enforce
  // that, so only a stand-in for the browser's check catches it here.
  const realFetch = globalThis.fetch;
  const seen = [];
  function pickyFetch(url) {
    if (this !== globalThis && this !== undefined) throw new TypeError("Illegal invocation");
    seen.push(url);
    return Promise.resolve({ ok: true, json: async () => ({ message: { content: 'ok' }, usage: { cost: 0 } }) });
  }
  globalThis.fetch = pickyFetch;
  try {
    const session = new GevBrainVoiceSession({
      host: { ui: {}, setStatus() {}, setVoiceSpeaker() {} },
      runner: async () => ({ ok: true }),
      config: { language: 'fr-FR', maxRounds: 1 },
      scope: { speechSynthesis: null },
    });
    session.active = true;
    session.messages = [{ role: 'user', content: 'va à Lyon' }];
    const reply = await session.relay();
    assert.equal(reply.ok, true);
    assert.deepEqual(seen, ['/api/voice/brain']);

    seen.length = 0;
    const config = await fetchVoiceConfig();
    assert.deepEqual(seen, ['/api/voice/config']);
    assert.equal(config.provider, null, 'that stub returns no provider, and that is read safely');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('reachable separates "the server said no" from "the server never answered"', async () => {
  const answered = await fetchVoiceConfig(async () => ({
    ok: true,
    json: async () => ({ provider: null, reason: 'No voice key is set — add OPENAI_API_KEY or OPENROUTER_API_KEY.' }),
  }));
  assert.equal(answered.reachable, true, 'a 200 saying "no key" IS an answer');
  assert.match(answered.reason, /No voice key is set/);

  for (const [status, pattern] of [[404, /HTTP 404/], [401, /HTTP 401/], [429, /HTTP 429/]]) {
    const blocked = await fetchVoiceConfig(async () => ({ ok: false, status }));
    assert.equal(blocked.reachable, false);
    assert.match(blocked.reason, pattern, 'the status code is the diagnosis');
    assert.match(blocked.reason, /Click the mic again/, 'and the message must say the click is worth repeating');
  }

  const offline = await fetchVoiceConfig(async () => { throw new Error('Failed to fetch'); });
  assert.equal(offline.reachable, false);
  assert.match(offline.reason, /Failed to fetch/);

  const garbled = await fetchVoiceConfig(async () => ({ ok: true, json: async () => { throw new Error('Unexpected token'); } }));
  assert.equal(garbled.reachable, false, 'a 200 of nonsense is not an answer either');
});

test('"network" is diagnosed as the browser, not as the user\'s connection', () => {
  // Reported by a user on Arc, 2026-09-09: recognition answered `network` while
  // the app, the server and the connection were all fine. Chromium forks ship
  // without the key Google's speech service needs. The old message printed the
  // bare code under a static "check microphone permission" hint, which sent the
  // user to inspect the one thing that was working.
  const d = describeRecognitionError('network');
  assert.equal(d.benign, false);
  assert.equal(d.fatal, true, 'retrying in the same browser cannot help');
  assert.doesNotMatch(d.message, /permission/i);
  assert.match(d.hint, /Arc/, 'name the browsers this actually happens on');
  assert.match(d.hint, /Chrome, Edge or Safari/, 'and name a way out');
  assert.match(d.hint, /Not your connection and not this server/);
});

test('benign codes are silent, unknown codes still say something useful', () => {
  assert.deepEqual(describeRecognitionError('no-speech'), { benign: true });
  assert.deepEqual(describeRecognitionError('aborted'), { benign: true });
  const unknown = describeRecognitionError('some-new-code');
  assert.equal(unknown.benign, false);
  assert.equal(unknown.fatal, false, 'an unknown code is not assumed unrecoverable');
  assert.match(unknown.message, /some-new-code/, 'the raw code stays visible for a bug report');
  assert.deepEqual(describeRecognitionError(undefined).benign, false);
});

test('a fatal recognition error stops the session but leaves its diagnosis up', async () => {
  const { session, statuses, host } = makeHarness({ replies: [] });
  await session.start({});
  session.handleRecognitionError({ error: 'network' });
  assert.equal(session.isActive(), false, 'no restart loop against a service that will not answer');
  assert.deepEqual(statuses.at(-1), ['error', 'This browser cannot reach its speech recognition service']);
  assert.match(host.nextErrorHint, /Chrome, Edge or Safari/);
});

test('a non-fatal error keeps listening', async () => {
  const { session } = makeHarness({ replies: [] });
  await session.start({});
  session.handleRecognitionError({ error: 'bad-grammar' });
  assert.equal(session.isActive(), true);
});
