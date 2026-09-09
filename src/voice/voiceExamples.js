/**
 * What you can say — the discoverability list.
 *
 * A voice cockpit with 29 tools and 59 data layers is undiscoverable by design
 * unless something says so: the mic looks identical whether it can do one thing
 * or a hundred, and an operator who tries twice and misses twice stops trying.
 * These are the phrasings that reach the widest part of the surface, in the
 * language the fork is actually used in.
 *
 * ONE LIST, TWO READERS. The dock rotates three of these while it is idle, and
 * the same strings are named in the shipped instructions so "que puis-je dire ?"
 * is answered from the prompt without a tool call. A unit test holds the two in
 * agreement — a suggestion the model cannot honour is worse than no suggestion.
 *
 * Every line here must be answerable by a tool that exists. When one stops
 * being true, delete it: this file is a promise, not a wish list.
 */

/** Spoken examples, French first — the fork's own language. */
export const VOICE_EXAMPLES_FR = Object.freeze([
  'Emmène-moi à Bordeaux.',
  'Montre les médecins.',
  'Quelles couches as-tu ?',
  'Combien de bornes de recharge dans la vue ?',
  'Combien de vélos à cette station ?',
  'Où suis-je ?',
  'Passe en vision nocturne.',
  'Affiche les avions et suis le plus proche.',
  'La station de vélos la plus proche avec des vélos.',
  'Recule, vue du globe entier.',
]);

/** The same surface, for an English-speaking operator. */
export const VOICE_EXAMPLES_EN = Object.freeze([
  'Take me to Bordeaux.',
  'Show the doctors layer.',
  'What layers do you have?',
  'How many charge points are in view?',
  'How many bikes at this station?',
  'Where am I?',
  'Switch to night vision.',
  'Show flights and track the closest one.',
  'Nearest bike station with bikes available.',
  'Zoom out to the whole globe.',
]);

/**
 * Three examples to show, rotating by index.
 *
 * A fixed three would train the operator that the mic does three things. The
 * rotation is deterministic (index, not random) so a test can assert it and so
 * two glances a second apart do not shuffle under the reader's eyes.
 *
 * @param {string} language BCP-47 tag; anything non-French gets the English set.
 * @param {number} index Rotation counter, any integer.
 * @param {number} [count=3] How many to show.
 * @returns {Array<string>}
 */
export function rotatingVoiceExamples(language, index, count = 3) {
  const list = String(language || '').toLowerCase().startsWith('fr')
    ? VOICE_EXAMPLES_FR
    : VOICE_EXAMPLES_EN;
  const size = Math.max(0, Math.min(count, list.length));
  const start = ((Math.trunc(index) % list.length) + list.length) % list.length;
  return Array.from({ length: size }, (_, offset) => list[(start + offset) % list.length]);
}
