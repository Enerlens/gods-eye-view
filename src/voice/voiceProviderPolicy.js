/**
 * Which brain drives the mic, and what the browser is allowed to send it.
 *
 * Two providers answer the same job with very different shapes:
 *
 *   openai      — one speech-to-speech model over WebRTC. Ears, brain and
 *                 mouth in a single session (see gevRealtime.js).
 *   openrouter  — a TEXT brain only (Mistral by default). The browser supplies
 *                 the ears (Web Speech API) and the mouth (speechSynthesis),
 *                 both keyless, and the server relays turns to OpenRouter with
 *                 the SAME tool schemas and instructions the realtime session
 *                 uses (see gevBrainVoice.js).
 *
 * Every function here is pure so the same rules can be asserted server-side
 * (vite.config.js) and client-side without a browser or a network.
 */

/** Providers this build knows how to drive. Order is the `auto` preference. */
export const VOICE_PROVIDERS = Object.freeze(['openai', 'openrouter']);

/** The brain used when OPENROUTER_VOICE_MODEL is unset. Measured 26/26 on the
 *  French routing bench, and the only model in that bench that refused to
 *  invent history when handed a thin dossier. */
export const OPENROUTER_VOICE_MODEL_DEFAULT = 'mistralai/mistral-medium-3.1';

/** Guard rails for the relay. The server holds the key, so the browser must
 *  never be able to turn /api/voice/brain into a general-purpose LLM proxy. */
export const BRAIN_RELAY_LIMITS = Object.freeze({
  maxMessages: 40,
  maxContentChars: 12000,
  maxTotalChars: 80000,
  maxToolCallsPerMessage: 8,
});

/**
 * Pick the provider a session should use.
 *
 * `requested` is GEV_VOICE_PROVIDER. `auto` (or unset) takes the first
 * configured provider in VOICE_PROVIDERS order, which keeps upstream's OpenAI
 * behaviour intact for anyone who only has that key. Naming a provider whose
 * key is missing resolves to null WITH a reason rather than silently falling
 * through to the other one — a typo in .env must not quietly bill a different
 * account than the one the operator named.
 *
 * @param {{requested?: string|null, hasOpenAiKey?: boolean, hasOpenRouterKey?: boolean}} input
 * @returns {{provider: 'openai'|'openrouter'|null, reason: string}}
 */
export function resolveVoiceProvider({ requested, hasOpenAiKey = false, hasOpenRouterKey = false } = {}) {
  const available = { openai: Boolean(hasOpenAiKey), openrouter: Boolean(hasOpenRouterKey) };
  const asked = typeof requested === 'string' ? requested.trim().toLowerCase() : '';

  if (asked === 'off' || asked === 'none' || asked === 'disabled') {
    return { provider: null, reason: 'Voice is disabled by GEV_VOICE_PROVIDER.' };
  }
  if (asked && asked !== 'auto') {
    if (!VOICE_PROVIDERS.includes(asked)) {
      return { provider: null, reason: `Unknown GEV_VOICE_PROVIDER "${asked}" — use auto, openai, openrouter, or off.` };
    }
    if (!available[asked]) {
      const key = asked === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY';
      return { provider: null, reason: `GEV_VOICE_PROVIDER=${asked} but ${key} is not set.` };
    }
    return { provider: asked, reason: `Selected by GEV_VOICE_PROVIDER=${asked}.` };
  }

  const found = VOICE_PROVIDERS.find((name) => available[name]);
  if (found) return { provider: found, reason: `Auto-selected ${found} (its key is set).` };
  return { provider: null, reason: 'No voice key is set — add OPENAI_API_KEY or OPENROUTER_API_KEY.' };
}

/**
 * Normalise a BCP-47-ish voice language to a tag the Web Speech API accepts.
 * Falls back to en-US rather than throwing: a bad value must degrade to a
 * working mic in the wrong language, never to a dead one.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeVoiceLanguage(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'en-US';
  const match = raw.match(/^([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2}|\d{3}))?$/);
  if (!match) return 'en-US';
  const language = match[1].toLowerCase();
  const region = match[2] ? match[2].toUpperCase() : DEFAULT_REGION_BY_LANGUAGE[language];
  return region ? `${language}-${region}` : language;
}

const DEFAULT_REGION_BY_LANGUAGE = Object.freeze({
  en: 'US', fr: 'FR', de: 'DE', es: 'ES', it: 'IT', pt: 'PT', nl: 'NL',
});

/** Human names for the languages we bother to instruct the model about. */
const LANGUAGE_NAMES = Object.freeze({
  en: 'English', fr: 'French', de: 'German', es: 'Spanish',
  it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
});

/**
 * The extra instruction lines a non-English session needs.
 *
 * The shipped instructions are written in English and stay that way — they are
 * the tool contract, and translating them would fork a 50-line prompt that the
 * routing bench pins. This only tells the model which language to SPEAK, and
 * pins the two habits that break confirmations in French: reading a tool's
 * enum value aloud, and translating a callsign or airport code.
 *
 * @param {string} language BCP-47 tag, already normalised.
 * @returns {string} '' for English, instruction lines otherwise.
 */
export function voiceLanguageInstruction(language) {
  const tag = normalizeVoiceLanguage(language);
  const base = tag.split('-')[0];
  if (base === 'en') return '';
  const name = LANGUAGE_NAMES[base] || tag;
  return [
    `SPEAK ${name.toUpperCase()}. Every spoken word you produce must be in ${name}, including confirmations, counts and refusals, whatever language the tool descriptions are written in.`,
    `Tool names, argument names and enum values stay in English inside tool calls — translate only what you SAY. Never translate a callsign, an ICAO/IATA code, a vessel name or a layer's proper name; read them as they are.`,
    `Keep spoken confirmations as short in ${name} as the English examples above ("Vol vers Bordeaux", "Densité à vingt-cinq pour cent").`,
  ].join('\n');
}

/**
 * Convert Realtime tool definitions to the chat-completions shape.
 *
 * The two APIs describe the same 28 tools differently: Realtime is flat
 * ({type, name, description, parameters}), chat-completions nests the body
 * under `function`. Converting at the edge is what lets ONE array in
 * vite.config.js stay the single source of truth for both providers.
 *
 * @param {Array<object>} realtimeTools
 * @returns {Array<object>}
 */
export function toChatCompletionTools(realtimeTools) {
  if (!Array.isArray(realtimeTools)) return [];
  return realtimeTools
    .filter((tool) => tool && typeof tool.name === 'string' && tool.name)
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: tool.parameters && typeof tool.parameters === 'object'
          ? tool.parameters
          : { type: 'object', properties: {} },
      },
    }));
}

/**
 * Validate and trim what the browser posted to /api/voice/brain.
 *
 * Deliberately strict and total. The server owns the system prompt, the model
 * and the tool list; the client owns only the conversation. Anything else in
 * the payload — a `system` turn, a model override, an unknown role — is a
 * request to use our key for something that is not GEV, and is refused rather
 * than sanitised into a valid-looking call.
 *
 * Oversized histories are TRIMMED FROM THE FRONT, not rejected: a long session
 * must keep working, and the oldest turns are the ones a cockpit conversation
 * can afford to forget. A trim never splits an assistant tool_calls message
 * from the tool results that answer it — an orphaned tool result is a 400 at
 * the provider, so the trim walks forward to the next clean boundary.
 *
 * @param {unknown} value
 * @param {typeof BRAIN_RELAY_LIMITS} [limits]
 * @returns {{ok: true, messages: Array<object>, trimmed: number} | {ok: false, error: string}}
 */
export function sanitizeBrainMessages(value, limits = BRAIN_RELAY_LIMITS) {
  if (!Array.isArray(value)) return { ok: false, error: 'messages must be an array' };
  if (!value.length) return { ok: false, error: 'messages must not be empty' };

  const cleaned = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'each message must be an object' };
    const role = typeof raw.role === 'string' ? raw.role.trim().toLowerCase() : '';
    if (role === 'system' || role === 'developer') {
      return { ok: false, error: 'the server owns the system prompt; do not send one' };
    }
    if (!['user', 'assistant', 'tool'].includes(role)) {
      return { ok: false, error: `unsupported role "${role || '(missing)'}"` };
    }
    const content = raw.content === null || raw.content === undefined ? '' : String(raw.content);
    if (content.length > limits.maxContentChars) {
      return { ok: false, error: `a message exceeds ${limits.maxContentChars} characters` };
    }

    if (role === 'tool') {
      const id = typeof raw.tool_call_id === 'string' ? raw.tool_call_id.trim() : '';
      if (!id) return { ok: false, error: 'a tool message needs tool_call_id' };
      cleaned.push({ role, tool_call_id: id, content });
      continue;
    }

    const message = { role, content };
    if (role === 'assistant' && raw.tool_calls !== undefined) {
      if (!Array.isArray(raw.tool_calls)) return { ok: false, error: 'tool_calls must be an array' };
      if (raw.tool_calls.length > limits.maxToolCallsPerMessage) {
        return { ok: false, error: `more than ${limits.maxToolCallsPerMessage} tool calls in one message` };
      }
      const calls = [];
      for (const call of raw.tool_calls) {
        const id = typeof call?.id === 'string' ? call.id.trim() : '';
        const name = typeof call?.function?.name === 'string' ? call.function.name.trim() : '';
        if (!id || !name) return { ok: false, error: 'each tool call needs an id and a function name' };
        const args = call.function.arguments;
        calls.push({
          id,
          type: 'function',
          function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) },
        });
      }
      message.tool_calls = calls;
      // An assistant turn that only calls tools has no text. Sending "" makes
      // some providers answer with an empty turn of their own, so drop it.
      if (!content) message.content = null;
    }
    cleaned.push(message);
  }

  let total = cleaned.reduce((sum, m) => sum + (m.content ? m.content.length : 0), 0);
  let start = 0;
  const overLimit = () => cleaned.length - start > limits.maxMessages || total > limits.maxTotalChars;
  while (overLimit() && start < cleaned.length - 1) {
    total -= cleaned[start].content ? cleaned[start].content.length : 0;
    start += 1;
    // Never begin a history on a tool result, or on an assistant turn whose
    // tool_calls we just dropped the other half of.
    while (start < cleaned.length && cleaned[start].role === 'tool') {
      total -= cleaned[start].content ? cleaned[start].content.length : 0;
      start += 1;
    }
  }
  if (overLimit()) return { ok: false, error: 'conversation is too large even after trimming' };

  const messages = cleaned.slice(start);
  if (!messages.length) return { ok: false, error: 'nothing left after trimming' };
  return { ok: true, messages, trimmed: start };
}
