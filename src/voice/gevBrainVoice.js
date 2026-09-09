/**
 * The keyless-ears voice session: browser STT -> text brain -> browser TTS.
 *
 * This is the second way to drive the same 28 tools. Where gevRealtime.js opens
 * one speech-to-speech WebRTC session to OpenAI, this one splits the job three
 * ways and only the middle piece costs anything:
 *
 *   ears   Web Speech API (SpeechRecognition) — no key, no download
 *   brain  /api/voice/brain -> OpenRouter (Mistral by default) — ONE key
 *   mouth  speechSynthesis — no key, OS voices, works offline
 *   hands  createGevActionRunner — the SAME runner the realtime path uses
 *
 * The trade is honest and worth stating where someone will read it: this is
 * turn-based, not full duplex. You cannot interrupt it mid-sentence the way you
 * can interrupt the realtime model, and the round trip adds latency the
 * speech-to-speech path does not have. What it buys is a voice cockpit that
 * runs on an OpenRouter key instead of an OpenAI one — and a mic that keeps
 * working when the brain is a model somebody else self-hosts.
 */

/** Rounds of tool-calling one spoken turn may drive before we give up on it. */
const DEFAULT_MAX_ROUNDS = 5;

/**
 * A fetch that is safe to store and call as a method.
 *
 * `globalThis.fetch` must be invoked with the global object as its receiver.
 * Keeping the bare reference on an instance and calling `this.fetchImpl(...)`
 * makes the SESSION the receiver, which browsers reject with "Illegal
 * invocation" — and Node does not, so it is invisible to unit tests. Wrapping
 * it once here is what makes the same call work in both.
 */
const defaultFetch = (input, init) => globalThis.fetch(input, init);

/** Recognition dies quietly every ~60 s in Chrome; this is the restart debounce. */
const RECOGNITION_RESTART_MS = 250;

/** Longest Retry-After we sit out on the operator's behalf. */
const RETRY_AFTER_MAX_MS = 30_000;
/** A 429 with no Retry-After is worth this much: Cloudflare's block is 10 s. */
const RETRY_AFTER_DEFAULT_MS = 10_000;
/** How many times one spoken turn re-asks the brain after a 429. */
const BRAIN_RELAY_RETRY_LIMIT = 1;

/**
 * Milliseconds to wait before retrying, read off a Retry-After header.
 *
 * Both forms the header allows are read — delay-seconds and an HTTP-date —
 * because the two limiters this app meets differ: the in-app throttles send
 * `5`, the Cloudflare rule in front of staging sends `10`. A missing or
 * unreadable value falls back to `fallbackMs`, and the result is clamped to
 * [1 s, 30 s] so a broken header can neither spin the mic nor park it for an
 * hour.
 *
 * @param {string|null|undefined} value - Raw header value.
 * @param {{now?: number, fallbackMs?: number}} [options]
 * @returns {number}
 */
export function parseRetryAfterMs(value, { now = Date.now(), fallbackMs = RETRY_AFTER_DEFAULT_MS } = {}) {
  const text = String(value ?? '').trim();
  let ms = NaN;
  if (/^\d+$/.test(text)) ms = Number(text) * 1000;
  else if (text) {
    const at = Date.parse(text);
    if (Number.isFinite(at)) ms = at - now;
  }
  if (!Number.isFinite(ms)) ms = fallbackMs;
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(1000, ms));
}

/**
 * The tray's second line for a lookup that never got an answer.
 *
 * Each one starts by naming what the fault is NOT — the microphone — because
 * that is where the default hint sent people, and none of these live there.
 *
 * @param {number|null} status - HTTP status, or null when nothing came back.
 * @returns {string}
 */
export function describeUnreachableConfig(status) {
  if (status === 429) {
    return 'Not the microphone: a rate limit in front of this server (not the app) is refusing /api requests from your network address. '
      + 'Something else on it is busy — a script, a test run, several tabs reloading — or the edge rule is set below what the app needs; see docs/DEPLOY.md.';
  }
  if (status === 401) return 'Not the microphone: the access gate refused the request. Reload the page and sign in again.';
  if (status === 404) return 'Not the microphone: this build predates the voice endpoint. Deploy a current build.';
  return 'Not the microphone: the server never answered. Check that this host is reachable, then click the mic again.';
}

/**
 * Read the server's voice configuration.
 *
 * Never throws: a dev server without the endpoint (an older build, a static
 * preview) must present a mic that says it is unavailable, not a page that
 * fails to boot.
 *
 * `reachable` is the load-bearing field. It separates the two failures that
 * used to read identically on the dock and need opposite responses:
 *
 *   reachable: true   the server ANSWERED — "no key is set", "voice is off".
 *                     Clicking again will say the same thing. Fix the .env.
 *   reachable: false  the server was never heard from — a 429, a 404 on an
 *                     older build, a dropped packet. Clicking again may work,
 *                     so this answer must NOT be remembered (see
 *                     GevRealtimeController.resolveVoiceConfig).
 *
 * The status code travels in `reason` because it is the whole diagnosis: 404
 * means the build predates this endpoint, 401 means the auth gate, 429 means
 * a rate limit in front of the app rather than the app itself.
 *
 * A 429 also carries `retryAfterMs`, read off the limiter's own Retry-After:
 * the caller can sit that out and ask again instead of handing a stopwatch
 * to the operator (GevRealtimeController.resolveVoiceConfigPatiently). Only
 * a 429 gets one — a dropped connection retried blindly is a loop, not a
 * remedy. `hint` is the tray's second line, naming where the fault is not.
 *
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{provider: string|null, reason: string, reachable: boolean, retryAfterMs: number|null, hint: string|null, language: string, model: string|null, maxRounds: number, configured: object}>}
 */
export async function fetchVoiceConfig(fetchImpl = defaultFetch) {
  const unreachable = (detail, { status = null, retryAfterMs = null } = {}) => ({
    provider: null,
    reachable: false,
    reason: status === 429
      ? 'Rate limited in front of this server (HTTP 429) — the voice configuration could not be read. Click the mic again.'
      : `Could not reach voice configuration (${detail}). Click the mic again.`,
    retryAfterMs,
    hint: describeUnreachableConfig(status),
    language: 'en-US',
    model: null,
    maxRounds: DEFAULT_MAX_ROUNDS,
    configured: { openai: false, openrouter: false },
  });
  let response;
  try {
    response = await fetchImpl('/api/voice/config', { headers: { Accept: 'application/json' } });
  } catch (error) {
    return unreachable(error?.message || 'network error');
  }
  if (!response.ok) {
    return unreachable(`HTTP ${response.status}`, {
      status: response.status,
      retryAfterMs: response.status === 429 ? parseRetryAfterMs(response.headers?.get?.('retry-after')) : null,
    });
  }
  try {
    const data = await response.json();
    return {
      provider: typeof data?.provider === 'string' ? data.provider : null,
      reachable: true,
      reason: typeof data?.reason === 'string' ? data.reason : 'Voice is not configured on this server.',
      language: typeof data?.language === 'string' ? data.language : 'en-US',
      model: typeof data?.model === 'string' ? data.model : null,
      maxRounds: Number(data?.maxRounds) > 0 ? Math.min(8, Number(data.maxRounds)) : DEFAULT_MAX_ROUNDS,
      configured: data?.configured && typeof data.configured === 'object' ? data.configured : { openai: false, openrouter: false },
      retryAfterMs: null,
      hint: null,
    };
  } catch (error) {
    return unreachable(error?.message || 'unreadable response');
  }
}

/** The browser's SpeechRecognition constructor, or null where there is none. */
export function speechRecognitionConstructor(scope = globalThis) {
  return scope?.SpeechRecognition || scope?.webkitSpeechRecognition || null;
}

/**
 * What each SpeechRecognition error actually means, and what to do about it.
 *
 * The API reports a bare code and the dock used to print it verbatim under a
 * static hint reading "check microphone permission" — which is wrong for most
 * of them, and worst for the one that is hardest to guess:
 *
 *   `network` does NOT mean the user is offline, and it has nothing to do with
 *   this app's server. Recognition in a Chromium browser is a client for a
 *   REMOTE Google service, and Chromium forks (Arc, Brave, plain Chromium
 *   builds, Electron) ship without the key that service requires. Same
 *   machine, same connection: Chrome works, the fork answers `network`.
 *   Reported repeatedly on chromium-dev, and telling that user to check their
 *   microphone sends them to look at the one thing that is fine.
 *
 * `fatal` marks the codes where retrying in this browser cannot help, so the
 * session stops instead of sitting in a restart loop.
 *
 * @type {Record<string, {message: string, hint: string, fatal: boolean}>}
 */
export const RECOGNITION_ERRORS = Object.freeze({
  network: {
    message: 'This browser cannot reach its speech recognition service',
    hint: "Not your connection and not this server — Chromium forks (Arc, Brave, Electron) ship without the key Google's speech service needs. Open the app in Chrome, Edge or Safari.",
    fatal: true,
  },
  'not-allowed': {
    message: 'Microphone permission was denied',
    hint: 'Allow the microphone for this site, then click the mic again.',
    fatal: true,
  },
  'service-not-allowed': {
    message: 'This browser refused to start speech recognition',
    hint: 'The page must be served over HTTPS or from localhost, and the browser must allow its speech service. Try Chrome, Edge or Safari over HTTPS.',
    fatal: true,
  },
  'audio-capture': {
    message: 'No microphone was found',
    hint: 'Check that an input device is connected and selected in the system sound settings.',
    fatal: true,
  },
  'language-not-supported': {
    message: 'This browser does not speak the configured language',
    hint: 'Set GEV_VOICE_LANGUAGE to a language this browser supports, or try Chrome.',
    fatal: true,
  },
  'bad-grammar': {
    message: 'Speech recognition rejected its grammar',
    hint: 'This is a browser bug rather than a configuration problem. Try Chrome, Edge or Safari.',
    fatal: false,
  },
});

/** Codes that are part of normal listening, not failures. */
const BENIGN_RECOGNITION_ERRORS = new Set(['no-speech', 'aborted']);

/**
 * Resolve one recognition error code to what the dock should say.
 * @param {string} code
 * @returns {{benign: boolean, message?: string, hint?: string, fatal?: boolean}}
 */
export function describeRecognitionError(code) {
  const key = typeof code === 'string' ? code.trim() : '';
  if (BENIGN_RECOGNITION_ERRORS.has(key)) return { benign: true };
  const known = Object.prototype.hasOwnProperty.call(RECOGNITION_ERRORS, key)
    ? RECOGNITION_ERRORS[key]
    : null;
  if (known) return { benign: false, ...known };
  return {
    benign: false,
    message: `Speech recognition failed: ${key || 'unknown error'}`,
    hint: 'Try Chrome, Edge or Safari over HTTPS. If it persists, reload the page.',
    fatal: false,
  };
}

/**
 * Choose the closest synthesis voice for a language tag.
 *
 * Exact tag first, then any voice of the same base language, then the browser
 * default. Prefers a local voice over a network one at equal specificity: a
 * cockpit confirmation should not wait on a round trip to be spoken.
 *
 * @param {Array<{lang?: string, localService?: boolean, default?: boolean}>} voices
 * @param {string} language
 * @returns {object|null}
 */
export function pickSpeechVoice(voices, language) {
  if (!Array.isArray(voices) || !voices.length) return null;
  const tag = String(language || '').toLowerCase();
  const base = tag.split('-')[0];
  const score = (voice) => {
    const lang = String(voice?.lang || '').toLowerCase().replace('_', '-');
    if (!lang) return 0;
    if (lang === tag) return 4;
    if (lang.split('-')[0] === base) return 2;
    return 0;
  };
  let best = null;
  let bestScore = 0;
  for (const voice of voices) {
    const value = score(voice) + (voice?.localService ? 1 : 0);
    if (score(voice) > 0 && value > bestScore) {
      best = voice;
      bestScore = value;
    }
  }
  return best;
}

/**
 * What the client should do with an assistant message.
 *
 * Split out because it is the whole turn state machine and it is worth
 * asserting without a browser: a message with tool calls means keep working
 * (even when it also carries text — that text is a preamble the shipped
 * instructions tell the model not to produce), text alone ends the turn, and
 * neither means the model returned nothing usable.
 *
 * @param {object|null} message
 * @returns {{action: 'tools'|'speak'|'empty', calls: Array<object>, text: string}}
 */
export function nextBrainStep(message) {
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls.filter((c) => c?.function?.name) : [];
  const text = typeof message?.content === 'string' ? message.content.trim() : '';
  if (calls.length) return { action: 'tools', calls, text };
  if (text) return { action: 'speak', calls: [], text };
  return { action: 'empty', calls: [], text: '' };
}

/**
 * Parse a tool call's arguments without letting one bad call kill the turn.
 * A model that emits invalid JSON gets an error result back and a chance to
 * correct itself, which is strictly better than dropping the user's request.
 *
 * @param {string|object|undefined} value
 * @returns {{ok: true, args: object} | {ok: false, error: string}}
 */
export function parseToolArguments(value) {
  if (value === undefined || value === null || value === '') return { ok: true, args: {} };
  if (typeof value === 'object') return { ok: true, args: value };
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'arguments must be a JSON object' };
    }
    return { ok: true, args: parsed };
  } catch (error) {
    return { ok: false, error: `invalid JSON arguments: ${error?.message || error}` };
  }
}

/** Session cost, in the same shape the realtime cost readout uses. */
export function formatBrainCost(totalUsd) {
  const value = Number.isFinite(totalUsd) ? Math.max(0, totalUsd) : 0;
  return value >= 1 ? `~$${value.toFixed(2)}` : `~$${value.toFixed(3)}`;
}

/**
 * One turn-based voice session against the text brain.
 *
 * `host` is the GevRealtimeController that owns the button, the readout and the
 * push-to-talk shortcut. This class borrows that UI rather than building a
 * second one, so the mic looks and behaves identically whichever brain answers.
 */
export class GevBrainVoiceSession {
  constructor({ host, runner, config, fetchImpl = defaultFetch, scope = globalThis }) {
    this.host = host;
    this.runner = runner;
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.scope = scope;
    this.active = false;
    this.busy = false;
    this.micEnabled = true;
    this.recognition = null;
    this.restartTimer = null;
    this.messages = [];
    this.turnId = 0;
    this.costUsd = 0;
    this.abortController = null;
  }

  isActive() {
    return this.active;
  }

  /**
   * @param {{pushToTalk?: boolean}} options
   * @returns {Promise<void>}
   */
  async start({ pushToTalk = false } = {}) {
    if (this.active) return;
    const Recognition = speechRecognitionConstructor(this.scope);
    if (!Recognition) {
      this.host.setStatus('error', 'This browser has no speech recognition — try Chrome, Edge or Safari');
      return;
    }
    this.active = true;
    this.busy = false;
    this.micEnabled = !pushToTalk;
    this.messages = [];
    this.costUsd = 0;
    this.turnId += 1;
    this.host.pushToTalkMode = pushToTalk;
    this.syncCost();

    const recognition = new Recognition();
    recognition.lang = this.config.language || 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => this.handleRecognitionResult(event);
    recognition.onerror = (event) => this.handleRecognitionError(event);
    recognition.onend = () => this.handleRecognitionEnd();
    this.recognition = recognition;

    try {
      recognition.start();
    } catch (error) {
      this.active = false;
      this.recognition = null;
      this.host.setStatus('error', `Microphone could not start: ${error?.message || error}`);
      return;
    }
    this.host.setStatus('listening', pushToTalk ? 'Hold Space to talk' : this.readyDetail());
  }

  /** @returns {string} */
  readyDetail() {
    const model = this.config.model ? this.config.model.split('/').pop() : 'text brain';
    return `LISTENING · ${model.toUpperCase()}`;
  }

  stop({ keepError = false } = {}) {
    if (!this.active) return;
    this.active = false;
    this.busy = false;
    this.turnId += 1;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.abortController?.abort();
    this.abortController = null;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.abort(); } catch { /* already stopped */ }
    }
    try { this.scope.speechSynthesis?.cancel(); } catch { /* no synthesis */ }
    // A fatal recognition error has just painted its diagnosis; resetting to
    // idle here would wipe it before anyone could read it.
    if (!keepError) this.host.setStatus('idle', 'VOICE STANDBY');
  }

  /**
   * Push-to-talk mutes the EARS here, not a WebRTC track: there is no outbound
   * stream to disable, so a held Space gates whether a final transcript is
   * allowed to become a turn.
   * @param {boolean} enabled
   */
  setMicrophoneEnabled(enabled) {
    this.micEnabled = Boolean(enabled);
  }

  handleRecognitionResult(event) {
    if (!this.active) return;
    let finalText = '';
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0]?.transcript || '';
      if (result.isFinal) finalText += transcript;
      else interim += transcript;
    }
    if (interim.trim() && !this.busy) {
      this.host.setStatus('listening', interim.trim().slice(0, 90));
    }
    const spoken = finalText.trim();
    if (!spoken) return;
    if (!this.micEnabled) return; // push-to-talk key is up: heard, but not sent.
    if (this.busy) return;
    this.runTurn(spoken);
  }

  handleRecognitionError(event) {
    if (!this.active) return;
    const diagnosis = describeRecognitionError(event?.error);
    if (diagnosis.benign) return; // no-speech / aborted: onend restarts us.
    // Hand the host the specific second line BEFORE setStatus paints the tray.
    this.host.nextErrorHint = diagnosis.hint;
    this.host.setStatus('error', diagnosis.message);
    if (diagnosis.fatal) this.stop({ keepError: true });
  }

  handleRecognitionEnd() {
    if (!this.active || !this.recognition) return;
    // Chrome ends a continuous session on its own every minute or so. Restarting
    // is what makes an open mic actually stay open.
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.active || !this.recognition) return;
      try { this.recognition.start(); } catch { /* already running */ }
    }, RECOGNITION_RESTART_MS);
  }

  /**
   * One spoken request, start to finish: relay, tools, relay again, speak.
   * @param {string} spoken
   */
  async runTurn(spoken) {
    this.busy = true;
    const turnId = this.turnId;
    const isCurrent = () => this.active && this.turnId === turnId;
    this.messages.push({ role: 'user', content: spoken });
    this.host.setStatus('executing', spoken.slice(0, 90));

    try {
      for (let round = 0; round < this.config.maxRounds; round += 1) {
        if (!isCurrent()) return;
        const reply = await this.relay();
        if (!isCurrent()) return;
        if (!reply.ok) {
          this.host.setStatus('error', reply.error);
          return;
        }
        this.costUsd += reply.usage?.cost || 0;
        this.syncCost();

        const step = nextBrainStep(reply.message);
        if (step.action === 'empty') {
          this.host.setStatus('listening', this.readyDetail());
          return;
        }
        if (step.action === 'speak') {
          this.messages.push({ role: 'assistant', content: step.text });
          await this.speak(step.text, isCurrent);
          if (isCurrent()) this.host.setStatus('listening', this.readyDetail());
          return;
        }

        this.messages.push({
          role: 'assistant',
          content: step.text || null,
          tool_calls: step.calls,
        });
        for (const call of step.calls) {
          if (!isCurrent()) return;
          const result = await this.executeCall(call, isCurrent);
          this.messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 8000),
          });
        }
      }
      // Rounds exhausted: the tools ran, so say so rather than going silent.
      if (isCurrent()) this.host.setStatus('listening', this.readyDetail());
    } finally {
      if (this.turnId === turnId) this.busy = false;
    }
  }

  /**
   * Sit out a wait the server asked for, unless the turn is cancelled first.
   * A method, so a test can replace it and never actually sleep.
   *
   * @param {number} ms
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<boolean>} true when the wait ran its course, false if aborted.
   */
  waitMs(ms, signal = null) {
    return new Promise((resolve) => {
      if (signal?.aborted) { resolve(false); return; }
      const onAbort = () => { clearTimeout(timer); resolve(false); };
      const timer = setTimeout(() => {
        signal?.removeEventListener?.('abort', onAbort);
        resolve(true);
      }, ms);
      signal?.addEventListener?.('abort', onAbort, { once: true });
    });
  }

  /** @returns {Promise<{ok: boolean, message?: object, usage?: object, error?: string}>} */
  async relay() {
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    try {
      for (let attempt = 0; ; attempt += 1) {
        const response = await this.fetchImpl('/api/voice/brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: this.messages }),
          signal,
        });
        const data = await response.json().catch(() => null);
        if (response.ok) return { ok: true, message: data?.message || null, usage: data?.usage || null };
        // A 429 says how long to wait, whichever limiter sent it — the in-app
        // throttle or a rule at the edge. One spoken request is worth one
        // wait: obey it and ask once more before the turn is declared lost.
        if (response.status === 429 && attempt < BRAIN_RELAY_RETRY_LIMIT) {
          const waitMs = parseRetryAfterMs(response.headers?.get?.('retry-after'));
          this.host.setStatus('executing', `RATE LIMITED — RETRY IN ${Math.ceil(waitMs / 1000)} S`);
          if (!(await this.waitMs(waitMs, signal))) return { ok: false, error: 'Turn cancelled' };
          continue;
        }
        return { ok: false, error: data?.error || `Voice brain failed: HTTP ${response.status}` };
      }
    } catch (error) {
      if (error?.name === 'AbortError') return { ok: false, error: 'Turn cancelled' };
      return { ok: false, error: error?.message || 'Voice brain unreachable' };
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Run one tool call through the shared action runner.
   * A thrown tool becomes a result the model can read and recover from — the
   * realtime path does the same, and silence here would strand the turn.
   */
  async executeCall(call, isCurrent) {
    const name = call.function.name;
    const parsed = parseToolArguments(call.function.arguments);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    this.host.setStatus('executing', name.replace(/_/g, ' ').toUpperCase());
    try {
      const result = await this.runner(name, parsed.args, {
        signal: this.abortController?.signal,
        isCurrent,
      });
      return result ?? { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || `Tool ${name} failed` };
    }
  }

  /**
   * Speak one confirmation, with the ears closed.
   *
   * An open mic hears the speakers. Chrome's recogniser has no echo
   * cancellation of its own, so a spoken confirmation would otherwise come
   * straight back in as a user turn and the session would talk to itself.
   */
  speak(text, isCurrent) {
    const synth = this.scope.speechSynthesis;
    if (!synth || !this.scope.SpeechSynthesisUtterance) {
      this.host.setStatus('listening', text.slice(0, 90));
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (isCurrent() && this.active && this.recognition) {
          try { this.recognition.start(); } catch { /* already running */ }
        }
        resolve();
      };
      try { this.recognition?.stop(); } catch { /* not started */ }
      const utterance = new this.scope.SpeechSynthesisUtterance(text);
      utterance.lang = this.config.language || 'en-US';
      const voice = pickSpeechVoice(synth.getVoices?.() || [], utterance.lang);
      if (voice) utterance.voice = voice;
      utterance.onend = finish;
      utterance.onerror = finish;
      this.host.setVoiceSpeaker?.('assistant');
      this.host.setStatus('executing', text.slice(0, 90));
      try {
        synth.speak(utterance);
      } catch {
        finish();
      }
    });
  }

  syncCost() {
    const node = this.host?.ui?.costValue;
    if (!node) return;
    node.textContent = formatBrainCost(this.costUsd);
    node.dataset.level = 'ok';
    node.title = this.config.model
      ? `Estimated session cost — ${this.config.model}`
      : 'Estimated session cost';
  }
}
