/**
 * @module fiche
 *
 * The renderer behind `fiche.html` — the address radiography as a document.
 *
 * `adresseRadiographie.js` owns everything that decides WHAT is on the sheet
 * and is unit-tested against captured payloads; this file owns only how it
 * looks and how the page is driven. Keeping the split sharp is what lets the
 * wording of a claim be tested at all: a sentence composed inside a DOM
 * builder is a sentence nobody can assert on.
 *
 * NO CESIUM, NO GLOBE, NO MAP. The page is text. That is what makes it
 * printable to PDF by the browser, embeddable in an iframe, and readable on an
 * agent's phone.
 *
 * THE URL IS THE STATE. `?lat=&lon=` scans a point, `?q=` geocodes first
 * through the app's own `/api/geocode`, and `?embed=1` strips the chrome. A
 * scan is therefore a link — which is the whole distribution mechanism this
 * sheet has, and the reason the address is pushed into the history rather than
 * held in a variable.
 */

import {
  composeRadiographie,
  fetchRadiographieParts,
} from './data/adresseRadiographie.js';

const el = (id) => document.getElementById(id);

/** Escape a string for insertion as text. */
function text(value) {
  return String(value ?? '');
}

/** Build an element with text content and optional class. */
function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined && content !== null) element.textContent = text(content);
  return element;
}

/** The status verdict, as a word a reader understands. */
const STATUS_LABEL = Object.freeze({
  ok: 'complet',
  partial: 'partiel',
  absent: 'sans réponse',
});

/**
 * Read the point from the URL.
 * @returns {{lat: number, lon: number}|null}
 */
function pointFromSearch(params) {
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Geocode a free-text address through the app's own proxy.
 *
 * The BAN is asked directly rather than through `/api/geocode`, because this
 * sheet is France-only by construction — every one of its fifteen sources is a
 * French register — and the BAN answers a French address better than a
 * worldwide geocoder does, with the INSEE code already attached.
 *
 * @param {string} query
 * @returns {Promise<?{lat: number, lon: number, label: string}>}
 */
async function geocode(query) {
  const url = 'https://api-adresse.data.gouv.fr/search/?limit=1&q='
    + encodeURIComponent(query);
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = await response.json();
    const feature = payload?.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    return {
      lon: Number(coordinates[0]),
      lat: Number(coordinates[1]),
      label: feature.properties?.label || query,
    };
  } catch {
    return null;
  }
}

/** Render one theme section. */
function renderTheme(theme) {
  const section = node('section', 'theme');
  section.dataset.status = theme.status;
  const heading = node('h2');
  heading.append(node('span', null, theme.label));
  if (theme.status !== 'ok') {
    heading.append(node('span', 'flag', `— ${STATUS_LABEL[theme.status]}`));
  }
  section.append(heading);
  section.append(node('p', 'question', theme.question));

  if (theme.lines.length) {
    const list = node('dl', 'rows');
    for (const row of theme.lines) {
      const group = node('div');
      group.append(node('dt', null, row.label));
      group.append(node('dd', null, row.value));
      if (row.note) group.append(node('dd', 'note', row.note));
      list.append(group);
    }
    section.append(list);
  }

  const notes = [...theme.notes];
  if (theme.silent?.length) {
    notes.unshift(`Sources muettes : ${theme.silent.join(', ')}.`);
  }
  if (notes.length) {
    const list = node('ul', 'notes');
    for (const note of notes) list.append(node('li', null, note));
    section.append(list);
  }
  return section;
}

/** Render the whole sheet. */
function render(fiche) {
  const address = fiche.address;
  el('title').textContent = address?.label
    || address?.commune
    || `${fiche.point.lat.toFixed(5)}, ${fiche.point.lon.toFixed(5)}`;

  const subline = el('subline');
  subline.textContent = '';
  const parts = [];
  if (address?.commune && address?.code) parts.push(`${address.commune} (${address.code})`);
  // The BAN's own distance to the nearest known address, printed whenever it
  // is not the door: a sheet titled with a street name for a point 180 m away
  // is describing a different place than the reader thinks.
  if (Number.isFinite(address?.distanceM) && address.distanceM > 10) {
    parts.push(`point à ${address.distanceM} m de l’adresse la plus proche`);
  }
  subline.append(node('span', null, parts.join(' · ')));
  subline.append(document.createTextNode(' '));
  subline.append(node('span', 'coords',
    `${fiche.point.lat.toFixed(5)}, ${fiche.point.lon.toFixed(5)}`));

  el('status').textContent = `${fiche.answered} thématiques complètes`
    + `, ${fiche.partial} partielles`
    + `, ${fiche.absent.length} sans réponse`
    + ` — ${new Date(fiche.generatedAt).toLocaleString('fr-FR')}`;

  const host = el('themes');
  host.textContent = '';

  const caveat = node('p', 'caveat', fiche.gradingNote);
  host.append(caveat);

  for (const theme of fiche.themes) host.append(renderTheme(theme));

  el('colophon').textContent = 'Sources publiques françaises — DVF (DGFiP), carte des loyers '
    + '(DGALN/DHUP), ADEME, IGN, annuaire de l’éducation et IPS (DEPP), BPE (INSEE) et FINESS, '
    + 'indice ATMO (Atmo France et les AASQA), Géorisques (BRGM), Ma connexion internet (ARCEP), '
    + 'recensement (INSEE), Géoportail de l’urbanisme, Sitadel (SDES), carroyage Filosofi (INSEE). '
    + 'Chaque licence et chaque attribution est détaillée dans DATA_SOURCES.md.';
}

/** Scan a point and render it. */
async function scan(point) {
  el('status').textContent = 'Interrogation des quinze sources…';
  const parts = await fetchRadiographieParts(point);
  render(composeRadiographie({ point, parts }));
}

async function boot() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('embed') === '1') document.body.classList.add('embed');

  el('lookup').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = el('query').value.trim();
    if (!query) return;
    el('status').textContent = 'Géocodage…';
    const found = await geocode(query);
    if (!found) {
      el('status').textContent = 'Adresse introuvable dans la Base Adresse Nationale.';
      return;
    }
    // The scan is a LINK. Pushed rather than replaced so a reader comparing two
    // addresses can go back to the first one.
    const next = new URLSearchParams(window.location.search);
    next.set('lat', found.lat.toFixed(6));
    next.set('lon', found.lon.toFixed(6));
    next.delete('q');
    window.history.pushState({}, '', `?${next.toString()}`);
    await scan({ lat: found.lat, lon: found.lon });
  });

  el('print').addEventListener('click', () => window.print());

  window.addEventListener('popstate', () => {
    const point = pointFromSearch(new URLSearchParams(window.location.search));
    if (point) void scan(point);
  });

  const point = pointFromSearch(params);
  if (point) {
    await scan(point);
    return;
  }
  const query = params.get('q');
  if (query) {
    el('query').value = query;
    el('lookup').requestSubmit();
  }
}

void boot();
