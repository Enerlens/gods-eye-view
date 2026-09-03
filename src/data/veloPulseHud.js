/**
 * Pouls vélo — the panel that says what is moving, and the reason it exists.
 *
 * WHAT WAS WRONG. The layer animated 168 hours of a typical week across 561
 * sites and told the reader nothing at all while it did: no hour on screen, no
 * shape of the week, no way to stop it or to go back to the hour that had just
 * gone past. Something shimmered over two cities and that was the whole
 * experience. The row in the layer panel did carry the hour — behind a
 * collapsed accordion, in eight-pixel type, where nobody watching the globe was
 * looking.
 *
 * And the card for a clicked station was anchored IN THE WORLD, so it faded out
 * with the keyhole: click a dock near the edge of the scope and the answer was
 * drawn at one per cent opacity, which is indistinguishable from nothing. A
 * reader cannot learn to aim for the middle of a circle they have not been told
 * about.
 *
 * WHAT THIS IS. One fixed panel, under the globe, always on screen while the
 * layer is on:
 *
 *   · the hour of the week in words, and what the network is doing at it;
 *   · the whole week as one strip — 168 bars of the network's own activity —
 *     with a cursor on the hour being drawn, so the animation is a position in
 *     a curve rather than an unexplained shimmer;
 *   · that strip is the TRANSPORT. Click it, drag it, arrow along it: the week
 *     pauses on the hour you asked for. Pressing play resumes from there;
 *   · what the colour and the size of a blob mean, in one line, next to blobs
 *     that are currently that colour and that size;
 *   · and the selected station's own week, in the same colours, with the same
 *     cursor — the answer that used to disappear off the edge of the scope.
 *
 * The panel is layer-owned and self-mounting (the same idiom as the space
 * mission detail panel): it exists only while the layer is enabled, and takes
 * no room in `index.html` for the other thirty layers that do not need it.
 *
 * Everything here is presentation. The arithmetic lives in `veloPulseFeed.js`,
 * and the strip draws the same curve `POINTE` freezes on.
 *
 * @module data/veloPulseHud
 */
import {
  attachPanelDrag,
  clearPanelPosition,
  restorePanelPosition,
} from '../panelDrag.js';
import {
  PULSE_DAYS,
  PULSE_RAMP,
  PULSE_SLOTS,
  PULSE_UNSAMPLED_COLOR,
  pulsePhrase,
  pulseRampColor,
  pulseRelief,
  pulseSiteDetails,
  sitePeak,
  slotLabel,
  valueAt,
  wrapSlot,
} from './veloPulseFeed.js';

export const PULSE_HUD_ID = 'velo-pulse-hud';

/** Day initials under the strip. Saturday and Sunday carry the weekend class. */
const DAY_INITIALS = Object.freeze(['L', 'M', 'M', 'J', 'V', 'S', 'D']);

/**
 * The strip's floor, as a fraction of its height.
 *
 * A bar of literally zero is a hole in the strip, and the quietest hour of the
 * week is not a hole — it is 4 a.m., measured. The floor keeps it visible as
 * the smallest thing on the strip rather than as an absence.
 */
const BAR_FLOOR = 0.08;

/**
 * Where a click on the strip lands, in hours of the week.
 *
 * Pure, and exported, because the strip is the layer's only continuous control
 * and an off-by-one at its right edge would put Sunday 23:00 out of reach.
 *
 * @param {number} ratio 0..1 across the strip.
 * @returns {number} 0..167.
 */
export function pulseSlotFromRatio(ratio) {
  if (!Number.isFinite(ratio)) return 0;
  const clamped = Math.min(0.999999, Math.max(0, ratio));
  return Math.floor(clamped * PULSE_SLOTS);
}

/**
 * The one line that says what a blob's colour and size mean.
 *
 * Both cities are named in it, with their instrument, because a reader who has
 * flown from Lyon to Paris has no other way to know that the field under them
 * changed meaning on the way.
 *
 * @param {object|null} summary From `summarizePack`.
 * @returns {string}
 */
export function pulseLegendSentence(summary) {
  const cities = Object.values(summary?.byCity || {});
  const instruments = cities.map((city) => {
    const name = String(city.label || '').split('—')[0].trim() || 'ville';
    return city.instrument === 'stock'
      ? `${name} : le remplissage des stations (un STOCK)`
      : `${name} : les cyclistes comptés (un FLUX)`;
  });
  // NAMED, because it decides what the reader is allowed to do with it. This is
  // one mark PER STATION — a proportional symbol whose area is the quantity —
  // and not a kernel-density heatmap, which aggregates its inputs and would
  // make the fiche below a lie: there would be no single station under the
  // cursor to open. Mericskay's own comparison table rules the heatmap out the
  // moment an interface offers per-entity interaction, and this one does.
  const head = `Une tache par station : la couleur, c’est la part du maximum de la semaine`
    + ` du site lui-même ; la surface, c’est la quantité mesurée.`;
  return instruments.length ? `${head} ${instruments.join(' · ')}.` : head;
}

/** `document` exists and can host a panel. */
function canMount() {
  return typeof document !== 'undefined' && Boolean(document.body);
}

/**
 * Paint the week strip: one bar per hour, the network's own activity.
 *
 * The bars are stretched onto the week's OWN span (see `pulseRelief`) because
 * the raw curve never approaches zero — a dock is never entirely empty and a
 * counter never entirely still — and a strip drawn on the absolute scale is a
 * flat wall that says nothing. What the reader is being shown is the VARIATION,
 * and the label above it says so.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{values: Array<number|null>}|null} curve
 */
function paintCurve(canvas, curve) {
  const context = canvas?.getContext?.('2d');
  if (!context) return;
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.clearRect(0, 0, width, height);
  const step = width / PULSE_SLOTS;
  for (let slot = 0; slot < PULSE_SLOTS; slot += 1) {
    const relief = pulseRelief(slot, curve);
    const x = slot * step;
    if (relief === null) {
      context.fillStyle = 'rgba(120, 132, 148, 0.28)';
      context.fillRect(x, height - 2 * ratio, Math.max(1, step - 0.5), 2 * ratio);
      continue;
    }
    const barHeight = Math.max(1, (BAR_FLOOR + (1 - BAR_FLOOR) * relief) * height);
    const weekend = Math.floor(slot / 24) >= 5;
    context.fillStyle = weekend
      ? 'rgba(122, 190, 214, 0.42)'
      : 'rgba(150, 226, 255, 0.62)';
    context.fillRect(x, height - barHeight, Math.max(1, step - 0.5), barHeight);
  }
  // Day boundaries, so "mardi" on the readout has somewhere to point.
  context.fillStyle = 'rgba(255, 255, 255, 0.14)';
  for (let day = 1; day < 7; day += 1) {
    context.fillRect(day * 24 * step, 0, Math.max(1, ratio * 0.5), height);
  }
}

/**
 * Paint one site's own week, in the map's colours.
 *
 * This is the same encoding as the blob under the reader's cursor, 168 times
 * over: a station whose bar is orange at 8 a.m. is drawing an orange blob at
 * 8 a.m. Reading a dock's whole week beside the hour on screen is what turns
 * "62 % pleine" into a fact about a commute.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{site: object, city: object}|null} record
 */
function paintSiteWeek(canvas, record) {
  const context = canvas?.getContext?.('2d');
  if (!context) return;
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.clearRect(0, 0, width, height);
  if (!record?.site || !record?.city) return;
  const scale = Number(record.city.scale) || 1;
  const peakRaw = sitePeak(record.site);
  const peak = peakRaw ? (scale > 1 ? peakRaw.value / (scale / 100) : peakRaw.value) : null;
  const step = width / PULSE_SLOTS;
  for (let slot = 0; slot < PULSE_SLOTS; slot += 1) {
    const value = valueAt(record.site, slot, scale);
    const share = value !== null && peak ? value / peak : null;
    const barHeight = share === null
      ? height * 0.16
      : Math.max(1, (BAR_FLOOR + (1 - BAR_FLOOR) * Math.min(1, share)) * height);
    context.fillStyle = share === null ? PULSE_UNSAMPLED_COLOR : pulseRampColor(share);
    context.fillRect(slot * step, height - barHeight, Math.max(1, step - 0.4), barHeight);
  }
  context.fillStyle = 'rgba(255, 255, 255, 0.14)';
  for (let day = 1; day < 7; day += 1) {
    context.fillRect(day * 24 * step, 0, Math.max(1, ratio * 0.5), height);
  }
}

/** One `<li>` per line of the shared card text; never a template string. */
function paintSiteLines(list, record, pack, slot) {
  if (!list) return;
  list.replaceChildren(...pulseSiteDetails(record, pack, slot).map((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  }));
}

const PANEL_MARKUP = `
  <div class="velo-pulse-hud-head" data-pulse-grip title="Glissez pour déplacer le panneau · double-clic pour le remettre en place">
    <span class="velo-pulse-grip" aria-hidden="true"></span>
    <span class="velo-pulse-hud-title">POULS VÉLO · SEMAINE TYPE</span>
    <span class="velo-pulse-hud-window" data-pulse-window></span>
  </div>
  <div class="velo-pulse-hud-clock">
    <button type="button" class="velo-pulse-play" data-pulse-play aria-label="Dérouler la semaine">
      <span class="velo-pulse-play-glyph" aria-hidden="true">▶</span>
      <span class="velo-pulse-play-label">DÉROULER</span>
    </button>
    <strong class="velo-pulse-hour" data-pulse-hour>—</strong>
    <span class="velo-pulse-phase" data-pulse-phase></span>
  </div>
  <div class="velo-pulse-strip" data-pulse-strip role="slider" tabindex="0"
       aria-label="Heure de la semaine type" aria-valuemin="0" aria-valuemax="167" aria-valuenow="0">
    <canvas class="velo-pulse-curve" data-pulse-curve></canvas>
    <div class="velo-pulse-cursor" data-pulse-cursor></div>
  </div>
  <div class="velo-pulse-days" aria-hidden="true" data-pulse-days></div>
  <p class="velo-pulse-hud-legend" data-pulse-legend></p>
  <p class="velo-pulse-range" data-pulse-range hidden role="status"></p>
  <section class="velo-pulse-site" data-pulse-site hidden>
    <div class="velo-pulse-site-head">
      <strong data-pulse-site-name></strong>
      <button type="button" class="velo-pulse-site-close" data-pulse-site-close
              aria-label="Fermer la fiche du site">×</button>
    </div>
    <div class="velo-pulse-site-strip">
      <canvas class="velo-pulse-site-week" data-pulse-site-week></canvas>
      <div class="velo-pulse-cursor" data-pulse-site-cursor></div>
    </div>
    <ul class="velo-pulse-site-lines" data-pulse-site-lines></ul>
  </section>
  <p class="velo-pulse-site-empty" data-pulse-site-empty>
    Cliquez une tache pour lire une station, sa semaine et son maximum.
  </p>
`;

/**
 * Build the panel and wire its transport.
 *
 * @param {object} handlers
 * @param {(slot: number) => void} handlers.onSeek A scrub landed on this hour.
 * @param {() => void} handlers.onTogglePlay Play/pause was pressed.
 * @param {() => void} handlers.onClearSelection The site fiche was dismissed.
 * @returns {object|null} Controller, or null where there is no document.
 */
export function mountPulseHud({ onSeek, onTogglePlay, onClearSelection } = {}) {
  if (!canMount()) return null;
  const existing = document.getElementById(PULSE_HUD_ID);
  if (existing) existing.remove();

  const panel = document.createElement('aside');
  panel.id = PULSE_HUD_ID;
  panel.className = 'velo-pulse-hud';
  panel.setAttribute('aria-label', 'Pouls vélo — semaine type');
  panel.innerHTML = PANEL_MARKUP;
  (document.getElementById('cesiumContainer') || document.body).appendChild(panel);

  const node = (selector) => panel.querySelector(selector);
  const strip = node('[data-pulse-strip]');
  const cursor = node('[data-pulse-cursor]');
  const curveCanvas = node('[data-pulse-curve]');
  const siteBlock = node('[data-pulse-site]');
  const siteWeek = node('[data-pulse-site-week]');
  const siteCursor = node('[data-pulse-site-cursor]');
  const playButton = node('[data-pulse-play]');

  node('[data-pulse-days]').replaceChildren(...DAY_INITIALS.map((initial, index) => {
    const day = document.createElement('span');
    day.textContent = initial;
    if (index >= 5) day.className = 'weekend';
    return day;
  }));

  let curve = null;
  let selected = null;
  let position = 0;
  let dragging = false;
  let paintedSlot = -1;
  let paintedPlaying = null;

  const seekFromEvent = (event) => {
    const box = strip.getBoundingClientRect();
    if (!box.width) return;
    onSeek?.(pulseSlotFromRatio((event.clientX - box.left) / box.width));
  };

  strip.addEventListener('pointerdown', (event) => {
    // PRIMARY BUTTON ONLY. A right-click on the strip used to start a scrub
    // that nothing ended: the browser opens its context menu, the `pointerup`
    // never arrives, and the strip keeps the pointer captured — so the week
    // scrubbed with every mouse move and the globe stopped receiving input
    // until the next click. `panelDrag.js` and `ui.js` both guard this way.
    if (event.button !== 0) return;
    dragging = true;
    strip.setPointerCapture?.(event.pointerId);
    seekFromEvent(event);
    // `preventDefault` below stops the browser from focusing the strip on its
    // own, and an unfocused slider ignores the arrow keys — so the reader who
    // just clicked an hour could not step to the next one.
    strip.focus?.({ preventScroll: true });
    event.preventDefault();
  });
  strip.addEventListener('pointermove', (event) => {
    if (dragging) seekFromEvent(event);
  });
  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    strip.releasePointerCapture?.(event.pointerId);
  };
  strip.addEventListener('pointerup', endDrag);
  strip.addEventListener('pointercancel', endDrag);
  // The safety net the radio tuner already carries: a capture lost to anything
  // the page does not see — an OS gesture, a window switch — still ends the
  // scrub instead of leaving it live.
  strip.addEventListener('lostpointercapture', endDrag);
  strip.addEventListener('keydown', (event) => {
    const steps = {
      ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -24, PageUp: 24,
    };
    if (event.key === 'Home') {
      onSeek?.(0);
      event.preventDefault();
      return;
    }
    const step = steps[event.key];
    if (step === undefined) return;
    onSeek?.(Math.floor(wrapSlot(Math.floor(position) + step)));
    event.preventDefault();
  });

  playButton.addEventListener('click', () => onTogglePlay?.());
  node('[data-pulse-site-close]').addEventListener('click', () => onClearSelection?.());

  // ── Moving the panel ──────────────────────────────────────────────────────
  // The whole panel is the grab surface, not just its header: it is a small
  // window that sits over the city a reader is trying to see, and asking them
  // to find a 14-pixel title bar to get it out of the way is the kind of
  // friction that ends with the layer switched off. The strip and the buttons
  // are excluded — a slider that moves the panel instead of scrubbing the week
  // would be worse than a panel that does not move at all.
  panel.classList.add('panel-draggable');
  restorePanelPosition(panel, PULSE_HUD_ID);
  const releaseDrag = attachPanelDrag(panel, {
    panelId: PULSE_HUD_ID,
    ignoreSelector: '[data-pulse-strip], .velo-pulse-site-strip',
  });
  // A panel dragged somewhere unfortunate — behind the dock, off in a corner —
  // has to have a way home that does not involve clearing site data.
  node('[data-pulse-grip]').addEventListener('dblclick', () => {
    clearPanelPosition(PULSE_HUD_ID);
    for (const property of ['left', 'top', 'right', 'bottom', 'transform']) {
      panel.style.removeProperty(property);
    }
  });

  const paintClock = () => {
    const slot = Math.floor(position);
    const phrase = pulsePhrase(slot, curve);
    node('[data-pulse-hour]').textContent = slotLabel(slot).toUpperCase();
    node('[data-pulse-phase]').textContent = phrase;
    strip.setAttribute('aria-valuenow', String(slot));
    strip.setAttribute('aria-valuetext', `${slotLabel(slot)} — ${phrase}`);
    paintedSlot = slot;
  };

  const repaintCursors = () => {
    // A percentage of the track it rides, which is what both cursors share: the
    // week strip and the site strip are the same 168 hours at the same scale,
    // so one number places both and they can never drift apart.
    const offset = `${(wrapSlot(position) / PULSE_SLOTS) * 100}%`;
    cursor.style.left = offset;
    siteCursor.style.left = offset;
  };

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      paintCurve(curveCanvas, curve);
      if (selected) paintSiteWeek(siteWeek, selected);
    })
    : null;
  resizeObserver?.observe(panel);

  return {
    element: panel,

    /** The pack changed (or first landed): repaint the week and its labels. */
    setWeek(pack, weekCurve, summary) {
      curve = weekCurve;
      // FROM THE PACK. "4 semaines de juin 2026" was written into the panel by
      // hand, and the pack is rebuildable: a rebuild over another month would
      // have left the label describing a window that no longer existed.
      const span = pack?.window;
      const weeks = Number(span?.weeks);
      node('[data-pulse-window]').textContent = span
        ? `${Number.isFinite(weeks) ? `${weeks} semaines moyennées · ` : ''}${span.start} → ${span.end}`
        : 'semaine type';
      const legend = node('[data-pulse-legend]');
      legend.replaceChildren(...PULSE_RAMP.map((entry) => {
        const swatch = document.createElement('span');
        swatch.className = 'velo-pulse-swatch';
        swatch.style.background = entry.color;
        swatch.title = `Part du maximum hebdomadaire du site — ${entry.label}`;
        return swatch;
      }));
      const sentence = document.createElement('span');
      sentence.className = 'velo-pulse-legend-text';
      // textContent, not innerHTML: this sentence is built from the pack's own
      // city labels, and a data file is not a template.
      sentence.textContent = pulseLegendSentence(summary);
      legend.appendChild(sentence);
      paintCurve(curveCanvas, curve);
      repaintCursors();
      // The panel is mounted the moment the layer is switched on and the pack
      // lands a beat later, so the first clock was painted against no curve at
      // all: without this the phrase stayed "heure non relevée" for the whole
      // session, over a week the strip was already drawing.
      paintClock();
    },

    /**
     * The clock moved.
     *
     * Called 25 times a second while the week runs, so it does the cheapest
     * possible thing per frame — one `transform` on each cursor — and touches
     * the text only when the HOUR or the transport state actually changed.
     * Rewriting the same six strings at 25 Hz is a style recalculation per
     * frame for a panel that has not changed.
     */
    setPosition(next, playing) {
      position = wrapSlot(next);
      repaintCursors();
      if (Math.floor(position) !== paintedSlot) paintClock();
      if (playing === paintedPlaying) return;
      paintedPlaying = Boolean(playing);
      playButton.querySelector('.velo-pulse-play-glyph').textContent = playing ? '❚❚' : '▶';
      playButton.querySelector('.velo-pulse-play-label').textContent = playing ? 'PAUSE' : 'DÉROULER';
      playButton.setAttribute('aria-label', playing
        ? 'Mettre la semaine en pause'
        : 'Dérouler la semaine');
      panel.classList.toggle('is-playing', paintedPlaying);
    },

    /** A site was clicked, or the selection cleared. */
    setSelection(record, pack, slot) {
      selected = record || null;
      const empty = node('[data-pulse-site-empty]');
      if (!selected) {
        siteBlock.hidden = true;
        empty.hidden = false;
        paintSiteWeek(siteWeek, null);
        return;
      }
      siteBlock.hidden = false;
      empty.hidden = true;
      const name = selected.site?.name || '—';
      node('[data-pulse-site-name]').textContent = String(name).toUpperCase();
      paintSiteLines(node('[data-pulse-site-lines]'), selected, pack, slot);
      paintSiteWeek(siteWeek, selected);
      repaintCursors();
    },

    /** Refresh the fiche's numbers when the hour changed under a selection. */
    refreshSelection(pack, slot) {
      if (!selected) return;
      paintSiteLines(node('[data-pulse-site-lines]'), selected, pack, slot);
    },

    /**
     * The camera climbed above the altitude where a blob is still a shape.
     *
     * Said rather than corrected: inflating the marks to keep them visible is
     * what the layer stopped doing (B2). What is out of range is the reader's
     * viewpoint, and the panel is where that belongs — the map itself has
     * nothing left to draw at this height.
     */
    setOutOfRange(outOfRange, ceilingKm) {
      const notice = node('[data-pulse-range]');
      notice.hidden = !outOfRange;
      notice.textContent = outOfRange
        ? `Trop haut pour lire le champ — descendez sous ${ceilingKm} km.`
        : '';
      panel.classList.toggle('is-out-of-range', Boolean(outOfRange));
    },

    setVisible(visible) {
      panel.hidden = !visible;
    },

    destroy() {
      resizeObserver?.disconnect();
      releaseDrag();
      panel.remove();
    },
  };
}

/** The strip's day letters, for a test that does not have a DOM. */
export const PULSE_HUD_DAY_INITIALS = DAY_INITIALS;
/** Re-exported so the layer and the panel cannot disagree about day names. */
export const PULSE_HUD_DAYS = PULSE_DAYS;
