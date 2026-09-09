/*
 * « BRANCHER UN JEU DE DONNÉES » — the panel under the layer list.
 *
 * ONE FIELD, TWO INTENTS. The reader types an address or a subject, and the
 * button says which one it read — ANALYSER for an address, CHERCHER for words.
 * Nobody has to learn a mode.
 *
 * A subject opens the shortlist. Five hits are read at once and only the ones
 * PROVEN drawable are offered, each under four facts in the reader's own
 * words: how many objects, who publishes, how fresh, under what licence. That
 * is deliberate: measured on six subjects (docs/DEMANDER-UNE-DONNEE.md), the
 * platform's first hit is right about half the time, and its failures look
 * like successes — one town's nineteen points where a national base of 186 118
 * was meant. No machine can tell those apart; the count, side by side, can.
 * So the panel proposes and the reader chooses. Nothing is starred, nothing is
 * pre-selected, and what was set aside is listed with the reason in one phrase.
 *
 * Choosing a candidate costs no second read — its draft is already in hand —
 * and lands in the same draft card a pasted address produces. The reader still
 * sees the name, the publisher, the licence, the columns that locate a row and
 * the notes owed, and still presses BRANCHER. The shortlist stays on screen
 * afterwards, because "ce n'est pas ça, essaie l'autre" is the normal case.
 *
 * What it never does: draw before the reader has seen the draft; hide a
 * guessed geometry behind a working map; rank the candidates by size (biggest
 * is not most relevant — the Paris pharmacies are the right answer for someone
 * looking at Paris); or promise persistence the storage refused.
 *
 * @module data/datasetPlugPanel
 */

import { datasetManifestFaults } from './datasetManifest.js';
import { detectGeometry } from './datasetGeometry.js';
import { looksLikeDatasetAddress, shortlistDatasets } from './datasetSearch.js';

export const DATASET_PLUG_PANEL_ID = 'dataset-plug-panel';

const MARKUP = `
  <button type="button" class="dsp-open" data-dsp-open aria-expanded="false">
    <span class="dsp-open-plus" aria-hidden="true">＋</span>
    <span lang="fr">BRANCHER UN JEU DE DONNÉES</span>
  </button>
  <form class="dsp-form" data-dsp-form hidden autocomplete="off">
    <div class="dsp-row">
      <input type="text" class="dsp-input dsp-grow" data-dsp-url spellcheck="false"
             placeholder="Un sujet — « défibrillateurs » — ou une adresse…" />
      <button type="submit" class="dsp-btn dsp-btn-primary" data-dsp-analyse>CHERCHER</button>
    </div>
    <section class="dsp-results" data-dsp-results hidden>
      <ul class="dsp-cands" data-dsp-candidates></ul>
      <p class="dsp-aside" data-dsp-blocked hidden></p>
    </section>
    <section class="dsp-draft" data-dsp-draft hidden>
      <div class="dsp-row">
        <label class="dsp-label">Nom</label>
        <input type="text" class="dsp-input dsp-grow" data-dsp-label maxlength="64" />
        <input type="color" class="dsp-color" data-dsp-color title="Couleur des marques" />
      </div>
      <div class="dsp-row" data-dsp-resources-row hidden>
        <label class="dsp-label">Ressource</label>
        <select class="dsp-input dsp-grow" data-dsp-resource></select>
      </div>
      <div class="dsp-row" data-dsp-geometry-row hidden>
        <label class="dsp-label">Position</label>
        <select class="dsp-input dsp-narrow" data-dsp-lon><option value="">longitude…</option></select>
        <select class="dsp-input dsp-narrow" data-dsp-lat><option value="">latitude…</option></select>
      </div>
      <dl class="dsp-facts" data-dsp-facts></dl>
      <ul class="dsp-notes" data-dsp-notes></ul>
      <div class="dsp-row dsp-actions">
        <button type="button" class="dsp-btn dsp-btn-primary" data-dsp-plug>BRANCHER</button>
        <button type="button" class="dsp-btn" data-dsp-cancel>ANNULER</button>
      </div>
    </section>
    <p class="dsp-status" data-dsp-status role="status" aria-live="polite"></p>
  </form>
  <ul class="dsp-list" data-dsp-list></ul>
`;

function canMount() {
  return typeof document !== 'undefined' && Boolean(document.body);
}

function formatCount(value) {
  return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} Mo`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} ko`;
  return `${bytes} o`;
}

/**
 * Mount the panel into the data-layers panel, below the list.
 * @param {object} box The dataset box API (`initDatasetBox`).
 * @param {{host?: HTMLElement|null}} [options]
 * @returns {HTMLElement|null}
 */
export function mountDatasetPlugPanel(box, { host = null } = {}) {
  if (!canMount()) return null;
  const parent = host
    || document.querySelector('#data-panel .data-panel-inner')
    || document.getElementById('data-toggles')?.parentElement
    || null;
  if (!parent) return null;
  document.getElementById(DATASET_PLUG_PANEL_ID)?.remove();

  const panel = document.createElement('div');
  panel.id = DATASET_PLUG_PANEL_ID;
  panel.className = 'dsp';
  panel.innerHTML = MARKUP;
  parent.appendChild(panel);

  const node = (selector) => panel.querySelector(selector);
  const openButton = node('[data-dsp-open]');
  const form = node('[data-dsp-form]');
  const urlInput = node('[data-dsp-url]');
  const analyseButton = node('[data-dsp-analyse]');
  const resultsSection = node('[data-dsp-results]');
  const candidateList = node('[data-dsp-candidates]');
  const blockedLine = node('[data-dsp-blocked]');
  const draftSection = node('[data-dsp-draft]');
  const labelInput = node('[data-dsp-label]');
  const colorInput = node('[data-dsp-color]');
  const resourcesRow = node('[data-dsp-resources-row]');
  const resourceSelect = node('[data-dsp-resource]');
  const geometryRow = node('[data-dsp-geometry-row]');
  const lonSelect = node('[data-dsp-lon]');
  const latSelect = node('[data-dsp-lat]');
  const facts = node('[data-dsp-facts]');
  const notes = node('[data-dsp-notes]');
  const plugButton = node('[data-dsp-plug]');
  const cancelButton = node('[data-dsp-cancel]');
  const status = node('[data-dsp-status]');
  const list = node('[data-dsp-list]');

  let draft = null;
  let busy = false;
  let chosenSlug = null;
  // Every action that writes the status line takes a ticket. A load settling
  // twenty seconds after the reader moved on must not overwrite what they are
  // reading now.
  let statusTicket = 0;

  const say = (message) => { statusTicket += 1; if (status) status.textContent = message || ''; return statusTicket; };
  const sayIfCurrent = (ticket, message) => { if (ticket === statusTicket && status) status.textContent = message || ''; };

  /**
   * Wait for a freshly plugged layer to settle, then say what it drew.
   *
   * The shortlist proposes; only the marks prove. This is the sentence that
   * closes the loop — including the two a proposal cannot promise: a source
   * that fails on the way in, and a dataset that is real, loaded, and simply
   * has nothing where the reader happens to be looking.
   */
  async function reportDrawn(id, label, pending) {
    const ticket = statusTicket;
    // The load runs INSIDE `box.plug()`, so this has to watch from beside the
    // promise rather than after it — the layer is registered synchronously, a
    // microtask before the first fetch, which is why `report()` already answers.
    let persisted = true;
    void pending.then((result) => { persisted = result?.persisted !== false; }, () => {});
    const deadline = Date.now() + 120000;
    let settled = null;
    while (Date.now() < deadline) {
      settled = box.report?.(id) || null;
      if (!settled) break;
      if (settled.error || (!settled.loading && settled.count > 0)) break;
      // While it runs, the only honest thing to show is the fraction the
      // loader can prove — and the time left once it has earned the right to
      // say one. `sayIfCurrent` keeps this silent if the reader moved on.
      if (settled.progressLine && ticket === statusTicket && status) {
        status.textContent = `« ${label} » — ${settled.progressLine}`;
      }
      await new Promise((resolve) => { setTimeout(resolve, 200); });
    }
    await pending.catch(() => {});
    const caveat = persisted ? '' : " — le stockage a refusé : il ne survivra pas à cet onglet.";
    if (!settled) { sayIfCurrent(ticket, `« ${label} » branché.${caveat}`); return; }
    if (settled.error) {
      sayIfCurrent(ticket, `« ${label} » branché, mais la source a échoué : ${settled.error}`);
      return;
    }
    if (settled.count > 0) {
      sayIfCurrent(ticket, `« ${label} » — ${settled.coverage || `${settled.count} objets`}.${caveat}`);
      return;
    }
    sayIfCurrent(ticket, `« ${label} » branché, mais rien à cet endroit — déplacez ou rapprochez la vue.${caveat}`);
  }

  // Keystrokes stay in the panel: the app binds single keys globally.
  panel.addEventListener('keydown', (event) => {
    const tag = String(event.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') event.stopPropagation();
  });

  function setOpen(open) {
    form.hidden = !open;
    openButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.classList.toggle('dsp-expanded', open);
    if (open) urlInput?.focus();
  }

  function fillSelect(select, columns, chosen, placeholder) {
    select.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholder;
    select.appendChild(empty);
    for (const column of columns) {
      const option = document.createElement('option');
      option.value = column;
      option.textContent = column;
      if (column === chosen) option.selected = true;
      select.appendChild(option);
    }
  }

  function addFact(term, value) {
    if (!value) return;
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    facts.appendChild(dt);
    facts.appendChild(dd);
  }

  function currentManifest() {
    if (!draft) return null;
    const manifest = JSON.parse(JSON.stringify(draft.manifest));
    manifest.label = labelInput.value.trim() || manifest.label;
    if (/^#[0-9a-f]{6}$/i.test(colorInput.value)) manifest.color = colorInput.value.toLowerCase();
    const lon = lonSelect.value;
    const lat = latSelect.value;
    if (!geometryRow.hidden && lon && lat) {
      manifest.geometry = { lon, lat };
      if (manifest.source?.kind === 'datagouv') manifest.source.scope = 'viewport';
    }
    return manifest;
  }

  function renderDraft() {
    facts.replaceChildren();
    notes.replaceChildren();
    if (!draft) { draftSection.hidden = true; return; }
    const { manifest, columns, sample, resources, total } = draft;
    labelInput.value = manifest.label || '';
    colorInput.value = manifest.color || '#ffb14e';

    if (Array.isArray(resources) && resources.length > 1) {
      resourceSelect.replaceChildren();
      for (const resource of resources) {
        const option = document.createElement('option');
        option.value = resource.id;
        option.textContent = `${resource.title || resource.id} · ${resource.format || '?'}${resource.filesize ? ` · ${formatBytes(resource.filesize)}` : ''}`;
        if (resource.id === manifest.source?.resourceId) option.selected = true;
        resourceSelect.appendChild(option);
      }
      resourcesRow.hidden = false;
    } else {
      resourcesRow.hidden = true;
    }

    const tabular = Array.isArray(columns) && columns.length && ['csv', 'datagouv'].includes(manifest.source?.kind);
    if (tabular) {
      const guess = manifest.geometry || detectGeometry(columns, sample || [])?.geometry || null;
      fillSelect(lonSelect, columns, guess?.lon || '', 'longitude…');
      fillSelect(latSelect, columns, guess?.lat || '', 'latitude…');
      geometryRow.hidden = false;
      if (manifest.geometry && !manifest.geometry.lon) {
        // A point / WKT / projected geometry was guessed: keep it, hide the pickers.
        geometryRow.hidden = true;
      }
    } else {
      geometryRow.hidden = true;
    }

    addFact('Source', `${manifest.source?.kind}${manifest.source?.scope === 'viewport' ? ' · chargée pour la vue' : ''}`);
    addFact('Éditeur', manifest.attribution?.publisher);
    addFact('Licence', manifest.attribution?.licence);
    if (Number.isFinite(total)) addFact('Lignes', formatCount(total));
    if (Array.isArray(columns) && columns.length) addFact('Colonnes', `${columns.length} — ${columns.slice(0, 6).join(', ')}${columns.length > 6 ? '…' : ''}`);
    if (manifest.geometry) {
      const g = manifest.geometry;
      addFact('Position', g.lon ? `${g.lon} / ${g.lat}` : (g.point || g.wkt || g.geojson || `${g.x} / ${g.y} (${g.crs})`));
    }
    for (const note of draft.notes || []) {
      const li = document.createElement('li');
      li.textContent = note;
      notes.appendChild(li);
    }
    draftSection.hidden = false;
    syncFaults();
  }

  function syncFaults() {
    const manifest = currentManifest();
    const faults = manifest ? datasetManifestFaults(manifest) : ['aucun brouillon'];
    plugButton.disabled = faults.length > 0 || busy;
    plugButton.title = faults.length ? faults.join('\n') : 'Enregistrer ce jeu et l\'allumer';
    if (faults.length && manifest) say(`À compléter : ${faults[0]}`);
  }

  /** The button says what the field will do, so no one has to guess a mode. */
  function syncIntent() {
    const text = urlInput.value.trim();
    analyseButton.textContent = looksLikeDatasetAddress(text) ? 'ANALYSER' : 'CHERCHER';
  }

  function clearCandidates() {
    chosenSlug = null;
    candidateList.replaceChildren();
    blockedLine.textContent = '';
    blockedLine.hidden = true;
    resultsSection.hidden = true;
  }

  /**
   * The shortlist, as rows a reader can weigh against each other.
   * A row is a button: its whole surface chooses, so there is no target to aim
   * at, and the facts under the title are the only argument it makes.
   */
  function renderCandidates(shortlist) {
    candidateList.replaceChildren();
    for (const entry of shortlist.ready) {
      const li = document.createElement('li');
      li.className = 'dsp-cand';
      li.dataset.slug = entry.slug;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dsp-cand-btn';
      const title = document.createElement('span');
      title.className = 'dsp-cand-title';
      title.textContent = entry.title;
      const factLine = document.createElement('span');
      factLine.className = 'dsp-cand-facts';
      factLine.textContent = entry.facts.join(' · ');
      button.append(title, factLine);
      button.addEventListener('click', () => chooseCandidate(entry));
      li.appendChild(button);
      candidateList.appendChild(li);
    }
    // What was found and set aside, with the reason — a reader who asked is
    // owed the whole answer, not the flattering half of it.
    if (shortlist.blocked.length) {
      blockedLine.textContent = `Écartés : ${shortlist.blocked
        .map((entry) => `${entry.title} (${entry.reason})`)
        .join(' · ')}`;
      blockedLine.title = shortlist.blocked.map((entry) => `${entry.title} — ${entry.rawFault}`).join('\n');
      blockedLine.hidden = false;
    } else {
      blockedLine.hidden = true;
    }
    resultsSection.hidden = shortlist.ready.length === 0 && shortlist.blocked.length === 0;
  }

  function markChosen() {
    for (const li of candidateList.querySelectorAll('.dsp-cand')) {
      li.classList.toggle('dsp-cand-chosen', li.dataset.slug === chosenSlug);
    }
  }

  /** No second read: the draft that proved this candidate is the draft shown. */
  function chooseCandidate(entry) {
    draft = entry.draft;
    chosenSlug = entry.slug;
    markChosen();
    renderDraft();
    say(draft.faults.length
      ? `À compléter : ${draft.faults[0]}`
      : `« ${entry.title} » — vérifiez, puis BRANCHER pour le voir sur le globe.`);
  }

  async function search() {
    const query = urlInput.value.trim();
    if (!query || busy) return;
    busy = true;
    analyseButton.disabled = true;
    draft = null;
    renderDraft();
    clearCandidates();
    say('Recherche sur data.gouv.fr…');
    try {
      const shortlist = await shortlistDatasets(query, (url) => box.infer(url));
      renderCandidates(shortlist);
      if (!shortlist.total) say(`Aucun jeu publié sur « ${query} ».`);
      else if (!shortlist.ready.length) say(`${shortlist.total} jeux trouvés, aucun des ${shortlist.blocked.length} premiers n'est exploitable — précisez le sujet, ou collez une adresse.`);
      else say(`${shortlist.total} jeux trouvés — voici ceux qui se dessinent. Choisissez.`);
    } catch (error) {
      clearCandidates();
      say(`Recherche impossible : ${error?.message || error}`);
    } finally {
      busy = false;
      analyseButton.disabled = false;
      syncFaults();
    }
  }

  async function analyse(resourceId = null) {
    const url = urlInput.value.trim();
    if (!url) { say('Collez l\'adresse d\'un jeu de données.'); return; }
    if (busy) return;
    busy = true;
    analyseButton.disabled = true;
    say('Lecture de la source…');
    try {
      draft = await box.infer(url, resourceId ? { resourceId } : {});
      if (!resourceId) clearCandidates();
      renderDraft();
      say(draft.faults.length ? `À compléter : ${draft.faults[0]}` : 'Brouillon prêt — vérifiez, puis BRANCHER.');
    } catch (error) {
      draft = null;
      renderDraft();
      say(`Impossible de lire cette adresse : ${error?.message || error}`);
    } finally {
      busy = false;
      analyseButton.disabled = false;
      syncFaults();
    }
  }

  async function plug() {
    const manifest = currentManifest();
    if (!manifest || busy) return;
    const faults = datasetManifestFaults(manifest);
    if (faults.length) { say(`À compléter : ${faults[0]}`); return; }
    busy = true;
    plugButton.disabled = true;
    say('Branchement…');
    try {
      const label = manifest.label || manifest.id;
      // Not awaited yet on purpose: the source is fetched inside `plug()`, and
      // a reader watching a blank « Branchement… » for eleven seconds is
      // exactly the silence this panel is supposed to break.
      const pending = box.plug(manifest);
      say(`« ${label} » — chargement…`);
      void reportDrawn(manifest.id, label, pending);
      await pending;
      draft = null;
      renderDraft();
      // The field and the shortlist stay: « ce n'est pas ça, essaie l'autre »
      // is the ordinary next move, and retyping the subject to get back to a
      // list already on screen would be a punishment for looking.
      if (!chosenSlug) urlInput.value = '';
      markChosen();
      renderList();
    } catch (error) {
      say(`Échec : ${error?.message || error}`);
    } finally {
      busy = false;
      syncFaults();
    }
  }

  function renderList() {
    list.replaceChildren();
    const entries = box.list().filter((entry) => entry.origin === 'plugged');
    list.hidden = entries.length === 0;
    for (const entry of entries) {
      const li = document.createElement('li');
      li.className = 'dsp-item';
      li.dataset.datasetId = entry.id;
      const name = document.createElement('span');
      name.className = 'dsp-item-name';
      name.textContent = entry.label;
      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.className = 'dsp-icon-btn';
      exportButton.title = 'Copier le manifeste (à déposer dans datasets/)';
      exportButton.textContent = '⧉';
      exportButton.addEventListener('click', async () => {
        const text = box.exportManifest(entry.id);
        try {
          await navigator.clipboard.writeText(text);
          say(`Manifeste « ${entry.id}.json » copié.`);
        } catch {
          say('Presse-papiers refusé — le manifeste est dans la console.');
          console.info(text);
        }
      });
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'dsp-icon-btn dsp-icon-danger';
      removeButton.title = 'Débrancher';
      removeButton.textContent = '✕';
      removeButton.dataset.dspRemove = entry.id;
      removeButton.addEventListener('click', async () => {
        removeButton.disabled = true;
        const removed = await box.unplug(entry.id);
        say(removed ? `« ${entry.label} » débranché.` : 'Débranchement refusé.');
        renderList();
      });
      li.append(name, exportButton, removeButton);
      list.appendChild(li);
    }
  }

  openButton.addEventListener('click', () => setOpen(form.hidden));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (looksLikeDatasetAddress(urlInput.value)) void analyse();
    else void search();
  });
  urlInput.addEventListener('input', syncIntent);
  cancelButton.addEventListener('click', () => { draft = null; renderDraft(); clearCandidates(); say(''); setOpen(false); });
  plugButton.addEventListener('click', () => { void plug(); });
  resourceSelect.addEventListener('change', () => { void analyse(resourceSelect.value); });
  for (const control of [labelInput, colorInput, lonSelect, latSelect]) {
    control.addEventListener('input', syncFaults);
    control.addEventListener('change', syncFaults);
  }
  box.subscribe?.(renderList);
  syncIntent();
  renderList();
  return panel;
}
