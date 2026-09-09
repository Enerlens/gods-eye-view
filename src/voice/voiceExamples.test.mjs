import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  VOICE_EXAMPLES_EN,
  VOICE_EXAMPLES_FR,
  rotatingVoiceExamples,
} from './voiceExamples.js';

const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
const dock = readFileSync(new URL('./gevRealtime.js', import.meta.url), 'utf8');

test('the rotation is deterministic, wraps, and never repeats within a showing', () => {
  assert.deepEqual(rotatingVoiceExamples('fr-FR', 0), VOICE_EXAMPLES_FR.slice(0, 3));
  // Wrapping matters: the last examples must be reachable, and index 9 of ten
  // has to take two from the front rather than run off the end.
  const wrapped = rotatingVoiceExamples('fr-FR', 9);
  assert.equal(wrapped.length, 3);
  assert.equal(wrapped[0], VOICE_EXAMPLES_FR.at(-1));
  assert.equal(new Set(wrapped).size, 3);
  // A negative counter is a counter, not a crash.
  assert.deepEqual(rotatingVoiceExamples('en-US', -1), [
    VOICE_EXAMPLES_EN.at(-1), VOICE_EXAMPLES_EN[0], VOICE_EXAMPLES_EN[1],
  ]);
  assert.deepEqual(rotatingVoiceExamples('fr', 0, 0), []);
  // Anything that is not French gets the English set, including nothing at all.
  assert.deepEqual(rotatingVoiceExamples(null, 0), VOICE_EXAMPLES_EN.slice(0, 3));
});

test('every example the dock offers is one the model was told it can answer', () => {
  // A suggestion the model cannot honour is worse than no suggestion: the
  // operator tries it, it fails, and they stop trusting the whole surface.
  const start = config.indexOf("'WHAT CAN I SAY?");
  assert.ok(start > 0, 'the discoverability instruction is missing');
  const line = config.slice(start, config.indexOf("',\n", start));
  for (const example of VOICE_EXAMPLES_FR) {
    // The instruction quotes the phrasings without their trailing full stop.
    const phrase = example.replace(/\s*[.?!]+$/, '');
    assert.ok(line.includes(phrase), `the instructions never mention "${phrase}"`);
  }
});

test('the dock has somewhere to put them', () => {
  assert.match(dock, /<ul class="gev-voice-help-examples"><\/ul>/);
  assert.match(dock, /helpExamples: root\.querySelector\('\.gev-voice-help-examples'\)/);
  assert.match(dock, /refreshVoiceExamples/);
});
