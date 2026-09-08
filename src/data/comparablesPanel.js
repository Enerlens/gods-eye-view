import {
  attachPanelDrag,
  clearPanelPosition,
  restorePanelPosition,
} from '../panelDrag.js';
import {
  agree,
  distanceMetres,
  dossierLines,
  dossierSummary,
  emptyDossier,
  exportDossierJson,
  frenchDate,
  importDossierJson,
  mergeComparables,
  parseNumber,
  safeListingUrl,
} from './comparablesDossier.js';

/**
 * Le dossier — the screen the competitor's whole comparables module turns out
 * to be, and the only place in this application a reader types a price.
 *
 * WHY A PANEL AND NOT A ROW OF CHIPS. Every other French layer answers a
 * question with data somebody else published; this one has to ASK. A property
 * with its surface, a listing with its price, an address to geocode — none of
 * that fits in the chip strip the data panel gives a layer, so the panel is
 * layer-owned and self-mounting, the same idiom as `veloPulseHud.js` and the
 * space mission detail panel: it exists only while the layer is on, and costs
 * `index.html` nothing for the thirty layers that do not need it.
 *
 * WHAT IT REFUSES TO DO, VISIBLY. There is no "import from a portal" button and
 * there never will be. The URL field stores a link and the application never
 * requests it — see `comparablesDossier.js` for the four decisions and the
 * three judgments behind that. The footer says so in one line, because a tool
 * that quietly did the other thing would look exactly the same from here.
 *
 * TWO WAYS IN, BOTH FREE. Type a listing, or import a file. The import accepts
 * an agency's own export — a bare array of listings — because an agent owns the
 * listings they publish and their back-office already exports them; that is a
 * consent, not an extraction. It MERGES rather than replaces, so an import can
 * never silently destroy a dossier somebody spent an afternoon building.
 *
 * NOTHING IN HERE IS BUILT WITH `innerHTML` EXCEPT THE STATIC SHELL. Every row
 * carries text a user typed, and it is written with `textContent`. A listing
 * label is the most obviously attacker-controlled string in this repository.
 *
 * @module data/comparablesPanel
 */

export const COMPARABLES_PANEL_ID = 'comparables-panel';

const _fr = new Intl.NumberFormat('fr-FR');

/** How long the destructive button stays armed after the first press, in ms. */
const CONFIRM_WINDOW_MS = 4000;

/** Dwelling types offered, in the register's own words — DVF says these two. */
const TYPES = Object.freeze(['Appartement', 'Maison', 'Terrain', 'Local']);

const PANEL_MARKUP = `
  <div class="cmp-head" data-cmp-grip title="Glissez pour déplacer le panneau · double-clic pour le remettre en place">
    <span class="cmp-grip" aria-hidden="true"></span>
    <span class="cmp-title">DOSSIER · COMPARABLES</span>
    <span class="cmp-count" data-cmp-count></span>
  </div>

  <section class="cmp-block cmp-subject">
    <div class="cmp-block-head">LE BIEN</div>
    <p class="cmp-subject-label" data-cmp-subject-label>Aucun bien posé</p>
    <div class="cmp-row">
      <input type="text" class="cmp-input cmp-grow" data-cmp-address
             placeholder="Adresse du bien…" autocomplete="off" spellcheck="false" />
      <button type="button" class="cmp-btn" data-cmp-geocode title="Chercher cette adresse (BAN / IGN)">↵</button>
      <button type="button" class="cmp-btn" data-cmp-here title="Poser le bien au centre de la vue">CENTRE</button>
    </div>
    <div class="cmp-row">
      <input type="text" class="cmp-input cmp-narrow" data-cmp-surface placeholder="m²" inputmode="decimal" />
      <input type="text" class="cmp-input cmp-narrow" data-cmp-rooms placeholder="pièces" inputmode="numeric" />
      <select class="cmp-input cmp-grow" data-cmp-type></select>
    </div>
  </section>

  <section class="cmp-block">
    <div class="cmp-block-head">CE QUE LE DOSSIER DIT</div>
    <ul class="cmp-lines" data-cmp-lines></ul>
  </section>

  <section class="cmp-block">
    <div class="cmp-block-head">RETENUS <span class="cmp-sub" data-cmp-retained-count></span></div>
    <ul class="cmp-list" data-cmp-retained></ul>
  </section>

  <section class="cmp-block">
    <div class="cmp-block-head">VENTES AUTOUR DU BIEN <span class="cmp-sub" data-cmp-pool-count></span></div>
    <ul class="cmp-list cmp-pool" data-cmp-pool></ul>
  </section>

  <section class="cmp-block">
    <div class="cmp-block-head">AJOUTER UNE ANNONCE</div>
    <div class="cmp-row">
      <input type="text" class="cmp-input cmp-grow" data-cmp-new-address
             placeholder="Adresse de l’annonce…" autocomplete="off" spellcheck="false" />
    </div>
    <div class="cmp-row">
      <input type="text" class="cmp-input cmp-narrow" data-cmp-new-price placeholder="prix €" inputmode="decimal" />
      <input type="text" class="cmp-input cmp-narrow" data-cmp-new-surface placeholder="m²" inputmode="decimal" />
      <input type="text" class="cmp-input cmp-narrow" data-cmp-new-rooms placeholder="pièces" inputmode="numeric" />
      <select class="cmp-input cmp-narrow" data-cmp-new-type></select>
    </div>
    <div class="cmp-row">
      <input type="text" class="cmp-input cmp-grow" data-cmp-new-url
             placeholder="lien de l’annonce (facultatif, jamais consulté)" autocomplete="off" spellcheck="false" />
      <button type="button" class="cmp-btn cmp-btn-primary" data-cmp-add>AJOUTER</button>
    </div>
    <p class="cmp-status" data-cmp-status role="status" aria-live="polite"></p>
  </section>

  <div class="cmp-foot">
    <button type="button" class="cmp-btn" data-cmp-export>EXPORTER</button>
    <button type="button" class="cmp-btn" data-cmp-import>IMPORTER</button>
    <button type="button" class="cmp-btn cmp-btn-danger" data-cmp-clear>VIDER</button>
    <input type="file" data-cmp-file accept="application/json,.json" hidden />
  </div>
  <p class="cmp-provenance">
    Sélection manuelle, comme chez le concurrent. Aucune annonce n’est collectée
    automatiquement : ce dossier ne contient que ce que vous y mettez, il ne quitte
    jamais ce navigateur, et le lien d’une annonce n’est jamais consulté par l’application.
  </p>
`;

/** Whether there is a document to mount into. */
function canMount() {
  return typeof document !== 'undefined' && Boolean(document.body);
}

/** A `<option>` list, same two registers everywhere. */
function fillTypes(select, withEmpty = true) {
  if (!select) return;
  const options = withEmpty ? ['', ...TYPES] : TYPES;
  select.replaceChildren(...options.map((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value || 'type…';
    return option;
  }));
}

/**
 * Geocode a typed address through the app's own proxy.
 *
 * The proxy, and not the BAN directly, because it is already rate-limited,
 * cached and keyless — and because a geocode is the ONLY outbound request this
 * panel ever makes. The address the reader typed is the only thing that leaves
 * the machine, and it leaves it to be turned into a coordinate.
 *
 * @param {string} query
 * @param {typeof fetch} [impl]
 * @returns {Promise<?{lat: number, lon: number, label: ?string}>}
 */
export async function geocodeAddress(query, impl = fetch) {
  const text = String(query ?? '').trim();
  if (text.length < 3) return null;
  try {
    const response = await impl(`/api/geocode?q=${encodeURIComponent(text)}&lang=fr`);
    if (!response?.ok) return null;
    const payload = await response.json();
    const result = payload?.result;
    if (!result || !Number.isFinite(result.lat) || !Number.isFinite(result.lon)) return null;
    return { lat: result.lat, lon: result.lon, label: result.label ?? text };
  } catch {
    return null;
  }
}

/**
 * The address of a coordinate, for the property posed from the camera.
 *
 * The same reverse call the fiche makes, and it is allowed to fail: a property
 * posed with no label is still a property, and the panel prints its coordinate
 * rather than pretending to an address it does not have.
 *
 * @param {{lat: number, lon: number}} point
 * @param {typeof fetch} [impl]
 * @returns {Promise<?{label: ?string, commune: ?string}>}
 */
export async function reverseAddress(point, impl = fetch) {
  try {
    const response = await impl(
      `https://api-adresse.data.gouv.fr/reverse/?lon=${point.lon}&lat=${point.lat}&limit=1`,
    );
    if (!response?.ok) return null;
    const payload = await response.json();
    const properties = payload?.features?.[0]?.properties;
    if (!properties) return null;
    return { label: properties.label ?? null, commune: properties.city ?? null };
  } catch {
    return null;
  }
}

/** A coordinate as a label, when no address answered. */
export function coordinateLabel(point) {
  return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
}

/**
 * Build the panel and wire it to the layer's actions.
 *
 * @param {object} actions See `comparablesLayer.js`.
 * @returns {?object} Controller, or null where there is no document.
 */
export function mountComparablesPanel(actions = {}) {
  if (!canMount()) return null;
  document.getElementById(COMPARABLES_PANEL_ID)?.remove();

  const panel = document.createElement('aside');
  panel.id = COMPARABLES_PANEL_ID;
  panel.className = 'cmp-panel';
  panel.setAttribute('aria-label', 'Dossier de comparables');
  panel.innerHTML = PANEL_MARKUP;
  (document.getElementById('cesiumContainer') || document.body).appendChild(panel);

  const node = (selector) => panel.querySelector(selector);
  const subjectLabel = node('[data-cmp-subject-label]');
  const addressInput = node('[data-cmp-address]');
  const surfaceInput = node('[data-cmp-surface]');
  const roomsInput = node('[data-cmp-rooms]');
  const typeSelect = node('[data-cmp-type]');
  const linesList = node('[data-cmp-lines]');
  const retainedList = node('[data-cmp-retained]');
  const retainedCount = node('[data-cmp-retained-count]');
  const poolList = node('[data-cmp-pool]');
  const poolCount = node('[data-cmp-pool-count]');
  const countBadge = node('[data-cmp-count]');
  const statusLine = node('[data-cmp-status]');
  const fileInput = node('[data-cmp-file]');
  const newType = node('[data-cmp-new-type]');
  const clearButton = node('[data-cmp-clear]');

  fillTypes(typeSelect);
  fillTypes(newType);

  let dossier = emptyDossier();
  let pool = { list: [], total: 0, missing: false, radiusM: 0 };
  let clearArmedAt = 0;
  let destroyed = false;

  const say = (message) => { if (statusLine) statusLine.textContent = message; };

  /**
   * Keystrokes stay in the panel.
   *
   * The application binds single keys globally — Escape dismisses a card, and
   * the cockpit reads letters — so a reader typing "12 rue de la Paix" into a
   * field would otherwise be flying the camera at the same time.
   */
  panel.addEventListener('keydown', (event) => {
    const tag = String(event.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') event.stopPropagation();
  });

  // ── the property ─────────────────────────────────────────────────────────
  async function poseFromAddress() {
    const query = addressInput?.value ?? '';
    if (String(query).trim().length < 3) { say('Tapez une adresse à chercher.'); return; }
    say('Recherche de l’adresse…');
    const hit = await geocodeAddress(query);
    if (destroyed) return;
    if (!hit) { say('Adresse introuvable — précisez la commune.'); return; }
    actions.setSubject?.({ lat: hit.lat, lon: hit.lon, label: hit.label });
    say(`Bien posé sur ${hit.label}.`);
  }

  async function poseFromCamera() {
    const point = actions.cameraPoint?.();
    if (!point) { say('La vue ne regarde pas le sol.'); return; }
    say('Lecture de l’adresse au centre de la vue…');
    const address = await reverseAddress(point);
    if (destroyed) return;
    actions.setSubject?.({
      lat: point.lat,
      lon: point.lon,
      label: address?.label ?? coordinateLabel(point),
      commune: address?.commune ?? null,
    });
    say(address?.label ? `Bien posé sur ${address.label}.` : 'Bien posé — aucune adresse à ce point.');
  }

  node('[data-cmp-geocode]')?.addEventListener('click', () => { void poseFromAddress(); });
  node('[data-cmp-here]')?.addEventListener('click', () => { void poseFromCamera(); });
  addressInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void poseFromAddress(); }
  });

  const pushSubjectField = (field, value) => {
    if (!dossier.subject) { say('Posez d’abord le bien.'); return; }
    actions.updateSubject?.({ [field]: value });
  };
  surfaceInput?.addEventListener('change', () => pushSubjectField('surface', parseNumber(surfaceInput.value)));
  roomsInput?.addEventListener('change', () => pushSubjectField('rooms', parseNumber(roomsInput.value)));
  typeSelect?.addEventListener('change', () => pushSubjectField('type', typeSelect.value || null));

  // ── a listing, typed ─────────────────────────────────────────────────────
  async function addListing() {
    const address = node('[data-cmp-new-address]')?.value ?? '';
    const price = parseNumber(node('[data-cmp-new-price]')?.value);
    const surface = parseNumber(node('[data-cmp-new-surface]')?.value);
    const rooms = parseNumber(node('[data-cmp-new-rooms]')?.value);
    const url = node('[data-cmp-new-url]')?.value ?? '';
    if (!Number.isFinite(price)) { say('Une annonce sans prix n’est pas un comparable.'); return; }
    if (url.trim() && !safeListingUrl(url)) { say('Lien ignoré — seuls http et https sont acceptés.'); }
    let position = null;
    if (String(address).trim().length >= 3) {
      say('Recherche de l’adresse de l’annonce…');
      position = await geocodeAddress(address);
      if (destroyed) return;
    }
    const added = actions.add?.({
      kind: 'annonce',
      label: position?.label ?? address,
      lat: position?.lat ?? null,
      lon: position?.lon ?? null,
      price,
      surface,
      rooms,
      type: newType?.value || null,
      url,
      // The date a listing was READ, which is the only date the reader can
      // vouch for. A portal's own publication date is not on this screen.
      date: new Date().toISOString().slice(0, 10),
    });
    if (!added) { say('Annonce refusée — il faut au moins un prix et une adresse.'); return; }
    for (const selector of ['[data-cmp-new-address]', '[data-cmp-new-price]',
      '[data-cmp-new-surface]', '[data-cmp-new-rooms]', '[data-cmp-new-url]']) {
      const field = node(selector);
      if (field) field.value = '';
    }
    say(position
      ? 'Annonce retenue et placée.'
      : 'Annonce retenue — sans adresse trouvée, elle compte mais ne se trace pas.');
  }
  node('[data-cmp-add]')?.addEventListener('click', () => { void addListing(); });

  // ── export, import, empty ────────────────────────────────────────────────
  node('[data-cmp-export]')?.addEventListener('click', () => {
    try {
      const blob = new Blob([exportDossierJson(dossier)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `comparables-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      say('Dossier exporté.');
    } catch {
      say('Export impossible dans ce navigateur.');
    }
  });

  node('[data-cmp-import]')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const result = importDossierJson(await file.text());
    fileInput.value = '';
    if (destroyed) return;
    if (!result.dossier) { say('Fichier illisible — un export JSON est attendu.'); return; }
    // MERGE, never replace. An import that emptied a dossier would be the one
    // irreversible action in this panel, and it would look like a success.
    const merged = mergeComparables(dossier, result.dossier.comparables);
    actions.replace?.({
      ...merged.dossier,
      subject: dossier.subject ?? result.dossier.subject ?? null,
    });
    say(`${merged.added} comparables ajoutés`
      + (result.rejected ? `, ${result.rejected} lignes refusées` : '')
      + (merged.added < result.kept ? `, ${result.kept - merged.added} déjà présents` : '')
      + '.');
  });

  clearButton?.addEventListener('click', () => {
    const now = Date.now();
    if (now - clearArmedAt > CONFIRM_WINDOW_MS) {
      // Two presses, no modal. The globe is behind this panel and a blocking
      // dialog over it is a worse interruption than a button that waits.
      clearArmedAt = now;
      clearButton.textContent = 'CONFIRMER ?';
      clearButton.classList.add('is-armed');
      setTimeout(() => {
        if (destroyed || Date.now() - clearArmedAt < CONFIRM_WINDOW_MS) return;
        clearButton.textContent = 'VIDER';
        clearButton.classList.remove('is-armed');
      }, CONFIRM_WINDOW_MS + 50);
      say('Appuyez à nouveau pour vider le dossier.');
      return;
    }
    clearArmedAt = 0;
    clearButton.textContent = 'VIDER';
    clearButton.classList.remove('is-armed');
    actions.replace?.(emptyDossier());
    say('Dossier vidé.');
  });

  // ── rows ─────────────────────────────────────────────────────────────────
  /**
   * The second line of a row: the four facts that decide whether a comparable
   * is one.
   *
   * The €/m² is formatted the way the summary above formats it — a thousands
   * separator on one line and none on the next reads as two different numbers.
   * A missing ratio says WHY, because « pas de €/m² » on a 32 M€ mutation looks
   * like a gap in the data rather than a fact about the sale.
   *
   * @param {object} entry
   * @param {?number} distanceM
   * @returns {string}
   */
  function rowMeta(entry, distanceM) {
    return [
      Number.isFinite(entry.prixM2)
        ? `${_fr.format(entry.prixM2)} €/m²`
        : `pas de €/m²${entry.ratioRefused === 'lots' ? ' — lot multiple' : ''}`,
      Number.isFinite(entry.surface) ? `${_fr.format(entry.surface)} m²` : null,
      Number.isFinite(entry.rooms) ? `${entry.rooms} ${agree(entry.rooms, 'pièce')}` : null,
      Number.isFinite(distanceM) ? `${_fr.format(distanceM)} m` : null,
      frenchDate(entry.date),
    ].filter(Boolean).join(' — ');
  }

  /**
   * One retained comparable, as a row.
   *
   * The badge is the same word the marker's silhouette says — VENTE for the
   * euro sign, ANNONCE for the price tag — because a reader who learns the
   * pair here has to be able to read the map without coming back.
   */
  function retainedRow(entry) {
    const item = document.createElement('li');
    item.className = `cmp-item cmp-item-${entry.kind}`
      + (entry.retained === false ? ' is-out' : '');

    const badge = document.createElement('span');
    badge.className = 'cmp-badge';
    badge.textContent = entry.kind === 'vente' ? 'VENTE' : 'ANNONCE';
    item.appendChild(badge);

    const body = document.createElement('div');
    body.className = 'cmp-item-body';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'cmp-item-title';
    title.textContent = entry.label;
    title.title = 'Voler jusqu’à ce comparable';
    title.addEventListener('click', () => actions.lookAt?.(entry));
    body.appendChild(title);

    const meta = document.createElement('span');
    meta.className = 'cmp-item-meta';
    meta.textContent = rowMeta(entry, distanceMetres(dossier.subject, entry));
    body.appendChild(meta);

    if (entry.url) {
      const link = document.createElement('a');
      link.className = 'cmp-item-link';
      link.href = entry.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = entry.portal ? `voir sur ${entry.portal}` : 'voir l’annonce';
      body.appendChild(link);
    }
    item.appendChild(body);

    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'cmp-icon-btn';
    keep.textContent = entry.retained === false ? '○' : '◉';
    keep.title = entry.retained === false
      ? 'Remettre ce comparable dans le calcul'
      : 'Sortir ce comparable du calcul, sans le supprimer';
    keep.addEventListener('click', () => actions.toggle?.(entry.id));
    item.appendChild(keep);

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'cmp-icon-btn cmp-icon-danger';
    drop.textContent = '✕';
    drop.title = 'Retirer du dossier';
    drop.addEventListener('click', () => actions.remove?.(entry.id));
    item.appendChild(drop);

    return item;
  }

  /** One DVF sale on offer, as a row with a single verb. */
  function poolRow(entry) {
    const item = document.createElement('li');
    item.className = 'cmp-item cmp-item-pool';

    const body = document.createElement('div');
    body.className = 'cmp-item-body';
    const title = document.createElement('span');
    title.className = 'cmp-item-title';
    title.textContent = entry.label;
    body.appendChild(title);
    const meta = document.createElement('span');
    meta.className = 'cmp-item-meta';
    meta.textContent = rowMeta(entry, entry.distanceM);
    body.appendChild(meta);
    item.appendChild(body);

    const take = document.createElement('button');
    take.type = 'button';
    take.className = 'cmp-icon-btn';
    take.textContent = entry.already ? '✓' : '+';
    take.disabled = Boolean(entry.already);
    take.title = entry.already ? 'Déjà dans le dossier' : 'Retenir cette vente comme comparable';
    take.addEventListener('click', () => actions.add?.(entry));
    item.appendChild(take);
    return item;
  }

  /** One sentence of the summary. */
  function line(text) {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }

  function renderDossier() {
    const summary = dossierSummary(dossier);
    if (subjectLabel) {
      subjectLabel.textContent = summary.subject
        ? (summary.subject.label || coordinateLabel(summary.subject))
        : 'Aucun bien posé';
      subjectLabel.classList.toggle('is-empty', !summary.subject);
    }
    // Fields are only overwritten when the reader is not typing in them.
    const fill = (field, value) => {
      if (!field || document.activeElement === field) return;
      field.value = value === null || value === undefined ? '' : String(value);
    };
    fill(surfaceInput, summary.subject?.surface ?? null);
    fill(roomsInput, summary.subject?.rooms ?? null);
    if (typeSelect && document.activeElement !== typeSelect) {
      typeSelect.value = dossier.subject?.type ?? '';
    }

    linesList?.replaceChildren(...dossierLines(dossier).map(line));
    const rows = [...(dossier.comparables ?? [])];
    retainedList?.replaceChildren(...rows.map(retainedRow));
    if (retainedCount) {
      retainedCount.textContent = rows.length
        ? `${summary.retained}/${summary.total} dans le calcul`
        : 'aucun';
    }
    if (countBadge) {
      countBadge.textContent = summary.estimate
        ? `${Math.round(summary.estimate.mid / 1000)} k€ médian`
        : `${summary.retained} retenus`;
    }
  }

  function renderPool() {
    if (!poolList) return;
    poolList.replaceChildren(...pool.list.map(poolRow));
    if (!poolCount) return;
    if (pool.missing) {
      poolCount.textContent = 'DVF muet';
    } else if (!pool.list.length) {
      poolCount.textContent = `aucune dans ${pool.radiusM} m`;
    } else {
      // A5: the count shown, the count found, and the criterion that chose.
      poolCount.textContent = pool.total > pool.list.length
        ? `${pool.list.length} des ${pool.total} plus proches, dans ${pool.radiusM} m`
        : `${pool.list.length} dans ${pool.radiusM} m`;
    }
  }

  restorePanelPosition(panel, COMPARABLES_PANEL_ID);
  panel.classList.add('panel-draggable');
  const detachDrag = attachPanelDrag(panel, {
    panelId: COMPARABLES_PANEL_ID,
    handle: node('[data-cmp-grip]'),
  });
  // A panel dragged somewhere unfortunate has to have a way home that does not
  // involve clearing site data — the same double-click the pulse panel offers.
  node('[data-cmp-grip]')?.addEventListener('dblclick', () => {
    clearPanelPosition(COMPARABLES_PANEL_ID);
    for (const property of ['left', 'top', 'right', 'bottom', 'transform']) {
      panel.style.removeProperty(property);
    }
  });

  renderDossier();
  renderPool();

  return {
    /** @param {object} next The dossier the layer just committed. */
    setDossier(next, { saved = true } = {}) {
      dossier = next ?? emptyDossier();
      renderDossier();
      if (!saved) say('Le navigateur refuse d’enregistrer — le dossier ne survivra pas au rechargement.');
    },
    /** @param {{list: Array<object>, total: number, missing: boolean, radiusM: number}} next */
    setCandidates(next) {
      pool = next ?? { list: [], total: 0, missing: false, radiusM: 0 };
      renderPool();
    },
    /** @returns {HTMLElement} The mounted node. Test and QA seam. */
    element() {
      return panel;
    },
    destroy() {
      destroyed = true;
      detachDrag?.();
      panel.remove();
    },
  };
}
