# Hiérarchie & lisibilité — rapport

## Ce que j'ai fait

Les trois vues canoniques (V-GLOBE, V-FRANCE, V-PARIS) sous S-VIDE et S-NAT
(`irve-fr` + `schools-fr` + `delinquance-fr`), plus une sonde DOM sur le HUD, les
cinq panneaux repliés, la barre de titre et le dock du bas.
Outillage : Puppeteer 1600×1000 via `newQaPage()`, caméra posée par `setView` après
`cancelFlight()` et 8+ `scene.render()` ; contraste mesuré **pixel par pixel sur les
glyphes** (deux captures — texte rendu / texte forcé en `color: transparent` — puis
différence des deux PNG décodés dans Node avec `sharp`, ratio WCAG calculé sur le
quart de pixels les plus couverts de chaque glyphe).
Scripts : `docs/ui-review/sondes/ui-hierarchie-run2.mjs`, `glyph2.mjs`, `probe.mjs`. Aucun fichier source
touché.

## Constats

### [CASSE] Le HUD n'a pas de plaque : le texte disparaît là où le globe est clair

- **Ce que j'ai vu :** la colonne HUD gauche est du cyan/blanc semi-transparent posé
  directement sur le canvas, sans fond. Dès que le disque du globe passe sous elle, les
  glyphes tombent à un contraste de 1,1 et la phrase s'éteint en cours de mot.
  Le `text-shadow` présent ne compense rien.
- **Où :** `#hud-summary`, `div.hud-classification`, `div.hud-system`, `#hud-mode` —
  tous `CANVAS` (aucun ancêtre avec `background-color` opaque). `style.css:4247`
  (`.hud-summary-label { font-size: 9px; opacity: .55 }`) et la règle `.hud-summary`
  qui suit (`font-size: 11px; opacity: .88`).
- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0`.
  2. `viewer.camera.cancelFlight()` puis `setView` sur V-PARIS (2.3364, 48.86, 900 m,
     pitch −35, heading 160), 8 `scene.render()`.
  3. Regarder la 4e ligne du bloc en haut à gauche.
- **Preuve :** capture `docs/ui-review/captures/ui-hierarchie-hud-summary-paris.webp` (recadrage de
  `docs/ui-review/captures/ui-hierarchie-c-V-PARIS-S-VIDE.webp`) — la phrase « NORMAL STREET NEAR LOUVRE
  PYRAMID (PARIS) 0KM | EURO… » s'évanouit exactement à la frontière du bâti clair.
  Mesure sur les pixels de glyphe de `#hud-summary` à V-PARIS/S-VIDE :
  `sur fond noir p50 = 3,68` — `sur fond clair (luminance > 0,25) p50 = 1,14`,
  pire cas 1,03, sur **12 %** de ses pixels de glyphe. À V-FRANCE/S-NAT :
  1,44 sur 5 % des pixels. Le seuil WCAG AA pour ce corps est 4,5.
- **Pourquoi ça compte, vu de ma lentille :** c'est la difficulté propre au produit.
  La seule ligne qui répond à « où suis-je » est celle qui se dissout la première,
  et elle se dissout **silencieusement** : rien ne signale au lecteur qu'il manque
  la fin de la phrase.

### [CASSE] `#hud-summary` est coupée à 49 % — et l'ancrage métrique part avec

- **Ce que j'ai vu :** la ligne de résumé contient 827 px de texte dans une boîte de
  420 px, avec `text-overflow: ellipsis`. La moitié du contenu n'est jamais affichée.
- **Où :** `#hud-summary` (`overflow: hidden`, `white-space: nowrap`,
  `text-overflow: ellipsis`, `clientWidth` = 420).
- **Reproduction :**
  1. Ouvrir l'URL, poser V-PARIS.
  2. En console : `const e=document.querySelector('#hud-summary');
     [e.scrollWidth, e.clientWidth, e.textContent]`.
- **Preuve :** relevé — `scrollWidth: 827`, `clientWidth: 420`, `truncated: true`.
  Texte complet lu dans le DOM : `NORMAL STREET NEAR EIFFEL TOWER (PARIS) 0KM |
  EUROPE | ALT 555M | WINDOW 4x4KM | SUN 19° | ONA 60° | UTC+0`. Ce qui s'affiche
  s'arrête à « | EURO… ». `WINDOW 4x4KM`, `SUN`, `ONA` et `UTC+0` ne sont jamais
  visibles. Capture `docs/ui-review/captures/ui-hierarchie-hud-summary-paris.webp`.
- **Pourquoi ça compte, vu de ma lentille :** `WINDOW 4x4KM` est l'emprise au sol —
  exactement l'ancrage que la règle F2 exige à la place d'une barre d'échelle. Il
  existe, il est correct, et il est jeté par une boîte de largeur fixe. Le
  `…` de troncature tombe lui-même sur le fond clair, donc la coupe est invisible :
  l'utilisateur ne sait pas qu'il lui manque quelque chose.

### [CASSE] La navigation principale est le texte le moins lisible de l'écran

- **Ce que j'ai vu :** les cinq panneaux (DATA LAYERS, SCENES, CCTV, DISPLAY,
  CONTEXT) sont repliés par défaut ; leur seul libellé est un `8px` en
  `rgba(232,234,237,0.3)`. À côté, le mot-symbole « GOD'S EYE » est en 26px/600 à
  contraste 15,9 et la bannière fictive « TOP SECRET // SI-TK // NOFORN » à 5,45.
- **Où :** `span.panel-title` — `style.css:680` (`font-size: 9px;
  color: var(--text-dim)`, avec `--text-dim: rgba(232, 234, 237, 0.3)` à
  `style.css:16`) puis `style.css:6970-6974` qui **réduit encore à 8px à l'état
  `.collapsed`**, c'est-à-dire à l'état par défaut.
- **Reproduction :**
  1. Ouvrir l'URL. Ne rien ouvrir.
  2. Regarder les deux pastilles en haut à gauche et les trois à droite.
- **Preuve :** capture `docs/ui-review/captures/ui-hierarchie-panel-titles-paris.webp` (agrandissement ×4
  sans lissage). Contraste mesuré sur les pixels de glyphe, sur leur propre plaque
  sombre (donc le meilleur fond que l'appli leur offre) :
  `DATA LAYERS 1,78` · `SCENES 1,81` · `CCTV 1,73` · `CONTEXT 1,74` · `DISPLAY 1,81`.
  Pour comparaison, sur le même écran : `GOD'S EYE 15,86` · `NORMAL (#hud-mode) 6,89`
  · `TOP SECRET // SI-TK // NOFORN 5,45` · `#hud-mgrs 4,70`.
- **Pourquoi ça compte, vu de ma lentille :** l'œil va au mot-symbole et à une
  bannière de classification décorative. La porte d'entrée des 53 couches — la
  raison d'être du produit — est un des trois textes les plus faibles de l'écran,
  au corps le plus petit, dans un état que personne n'a choisi.

### [CASSE] D1 — trois couches codent une valeur par la couleur, aucune légende n'est visible

- **Ce que j'ai vu :** sous S-NAT, 96 départements sont peints en teal / mauve /
  brun-gris. Rien à l'écran ne permet de traduire une couleur en valeur. Les légendes
  existent bien — 24 nœuds `.data-toggle-legend-item` avec de vraies classes
  (« Lente (≤ 7,4 kW) 2.3K », « Normale (≤ 22 kW) 426 », « Accélérée (≤ 50 kW) 120 »,
  « Rapide (≤ 150 kW) 28 ») — mais toutes vivent dans `#data-panel`, replié par défaut.
- **Où :** `#data-panel .data-toggle-legend-item` / `.data-toggle-legend-swatch`.
- **Reproduction :**
  1. Ouvrir l'URL, poser V-FRANCE (2.4, 46.6, 1 600 000 m, pitch −90).
  2. `dataManager.setEnabled('irve-fr'|'schools-fr'|'delinquance-fr', true)`.
  3. Ne rien ouvrir. Chercher une échelle de couleurs.
- **Preuve :** capture `docs/ui-review/captures/ui-hierarchie-vfrance-snat.webp`. Sonde DOM :
  `legend.filter(l => l.visible && !l.inPanel)` → `[]` ; et
  `legend.filter(l => l.visible)` → `[]` également : sur 24 nœuds de légende,
  **zéro n'est rendu**. Fichier `docs/ui-review/sondes/ui-hierarchie-probe.json`.
- **Pourquoi ça compte, vu de ma lentille :** c'est le test binaire de la règle D1,
  et il échoue. Une légende repliée dans un panneau qui recouvre la carte n'est pas
  une légende. Ici elle est même repliée *par défaut*, donc l'état standard du produit
  affiche une carte choroplèthe sans clé.

### [CASSE] Deux étiquettes portent le même nom, deux chiffres, et aucune ne dit de quelle couche elle vient

- **Ce que j'ai vu :** « Paris · 11,9 » posée à 40 px au-dessus de « Paris · 10 245 ».
  Même chose pour « Gironde · 7 455 » / « Gironde · 1 416 » et « Rhône · 8,63 » /
  « Rhône · 1 555 ». Aucune unité, aucun nom de couche. La seule attribution est un
  filet de couleur d'environ 3 px collé au bord gauche de la plaque.
- **Où :** étiquettes Cesium au-dessus du globe, vue V-FRANCE sous S-NAT.
- **Reproduction :** identique au constat D1 ci-dessus, puis regarder la région
  parisienne.
- **Preuve :** capture `docs/ui-review/captures/ui-hierarchie-labels-france.webp` (recadrage ×3 de
  `docs/ui-review/captures/ui-hierarchie-c-V-FRANCE-S-NAT.webp`, zone 700,230 → 1120,340).
- **Pourquoi ça compte, vu de ma lentille :** un chiffre sans unité ni provenance
  n'est pas une donnée, c'est un motif. Et deux chiffres homonymes côte à côte
  (`8,63` et `8,62` pour Rhône et Pyrénées-Orientales à V-GLOBE) invitent
  explicitement à une comparaison qui n'a pas de sens : ils ne viennent pas de la
  même couche.

### [CASSE] F3 — hors cockpit, rien ne dit où est le nord, et le fond de carte ment

- **Ce que j'ai vu :** à V-PARIS (heading 160°) le raster OSM affiche ses propres
  toponymes à l'envers — « Boulevard Saint-Germain », « Jardin du Luxembourg »,
  « Rue Danton » sont retournés. Aucun élément de l'interface ne restitue le cap.
- **Où :** la seule rose des vents du produit est `#cockpit-compass-tape`, à
  l'intérieur de `#cockpit-hud`, qui est `hidden: true` hors mode cockpit. Le seul
  relevé de cap du DOM est `BUTTON.cctv-cal-value` (« HDG -- »), non visible. Le HUD
  standard affiche `ONA` (angle hors-nadir), `GSD`, `NIIRS`, `ALT`, `MGRS`, `BAND`,
  `BITS`, `LVL` — pas de heading.
- **Reproduction :**
  1. Ouvrir l'URL, poser V-PARIS avec `heading = 160°`.
  2. Chercher une indication du nord sans ouvrir de panneau.
- **Preuve :** capture `docs/ui-review/captures/ui-hierarchie-c-V-PARIS-S-VIDE.webp` (toponymes OSM
  renversés, plein cadre). Sonde DOM : `north.compassNodes` →
  `[{sel:'cockpit-compass',...},{sel:'cockpit-compass-tape',...}]`, et
  `north.cockpitHidden: true` ; `north.hits` → un seul nœud, `BUTTON.cctv-cal-value
  "HDG --"`, `visible: false`. Fichier `docs/ui-review/sondes/ui-hierarchie-probe.json`.
- **Pourquoi ça compte, vu de ma lentille :** c'est le test de la règle F3 et il
  échoue. Pire que « le nord n'est pas indiqué » : le seul texte orienté à l'écran
  est celui du fond de carte, et il est à l'envers. Le produit fournit donc un
  repère d'orientation faux et aucun repère juste.

### [CASSE] E1 — la seule date affichée sur la carte est l'horloge du navigateur, étiquetée « COLL »

- **Ce que j'ai vu :** `REC 2026-09-03 07:00:34Z` en haut à droite et
  `COLL: 07:00:39Z` sur le rail gauche. Les deux avancent seconde par seconde. Aucune
  couche n'affiche jamais sa propre date, même avec trois jeux INSEE/DGCL allumés.
- **Où :** `#hud-timestamp` (`src/hud.js:223`, dans un `setInterval` de 1 000 ms) et
  `#hud-coll` (`src/hud.js:355-362`, `const now = new Date()`).
- **Reproduction :**
  1. Ouvrir l'URL. Prendre une capture.
  2. Essayer de dire, à partir de la seule capture, de quand datent les données.
- **Preuve :** extrait relevé, `src/hud.js:355-362` :
  `const collEl = document.getElementById('hud-coll'); ... const now = new Date();
  ... collEl.textContent = \`COLL: ${h}:${m}:${s}Z\`;`
  Et deux lectures espacées de 5 s dans la même session : `07:00:34Z` puis
  `07:00:39Z` avec S-VIDE — aucune donnée chargée, l'horloge tourne quand même.
- **Pourquoi ça compte, vu de ma lentille :** c'est le test de la règle E1 et il
  échoue. `COLL` (*collection time*) est un terme qui désigne l'instant de prise de
  vue : ici c'est l'heure du client. Je note que `REC`, `TOP SECRET` et `KH11-4032`
  relèvent visiblement d'une fiction assumée de cockpit ; ma réserve porte sur le
  fait qu'aucun autre champ ne vient donner l'instant réel, si bien que la fiction
  occupe la seule place où un lecteur cherche une date.

### [INCOHÉRENCE] 18 tailles de police et 5 graisses pour 126 éléments visibles à l'état vide

- **Ce que j'ai vu :** à l'accueil, sans aucune couche et sans aucun panneau ouvert,
  126 éléments sont visibles à l'écran, dont 52 portent du texte. Ils se répartissent
  sur 18 tailles de police distinctes, dont **7 sous 10 px** : 6,24 · 6,4 · 6,72 ·
  6,88 · 8 · 9 · 9,28.
- **Où :** `body *` hors `#cesiumContainer`, mesuré par `getComputedStyle`.
- **Reproduction :**
  1. Ouvrir l'URL, poser V-GLOBE, ne rien ouvrir.
  2. Énumérer les `font-size` calculées de tous les descendants visibles de `body`.
- **Preuve :** relevé — `total: 126`, `interactive: 14`,
  `sizes: [6.24, 6.4, 6.72, 6.88, 8, 9, 9.28, 10, 11, 12, 13, 13.3333, 14, 16, 17,
  18, 22, 26]`, `weights: ["300","400","500","600","700"]`.
  11 couleurs de texte distinctes sur la même surface. Fichier
  `docs/ui-review/sondes/ui-hierarchie-probe.json`, capture `docs/ui-review/captures/ui-hierarchie-c-V-GLOBE-S-VIDE.webp`.
- **Pourquoi ça compte, vu de ma lentille :** l'écart 6,24 → 6,4 px est de 0,16 px.
  C'est un palier déclaré qui ne peut pas être perçu — exactement la mise en garde
  B3 transposée à la typographie. Dix-huit paliers déclarés produisent au mieux
  quatre ou cinq paliers perçus, et l'échelle cesse d'être un signal : le lecteur ne
  peut plus déduire l'importance d'un élément de sa taille.

### [FRICTION] À V-GLOBE, les étiquettes sont 2,5 fois plus larges que le pays qu'elles annotent

- **Ce que j'ai vu :** à 12 000 km d'altitude, cinq étiquettes de département sont
  empilées verticalement sur une France haute d'environ 95 px. Elles la recouvrent
  entièrement : « Pyrénées-Orientales · 8,62 » barre la Nouvelle-Aquitaine et
  l'Occitanie, « Paris · 11,9 » barre la Normandie.
- **Où :** étiquettes Cesium, vue V-GLOBE sous S-NAT.
- **Reproduction :**
  1. Ouvrir l'URL, allumer les trois couches nationales.
  2. Poser V-GLOBE (10, 48, 12 000 000 m, pitch −90).
- **Preuve :** capture `docs/ui-review/captures/ui-hierarchie-labels-globe.webp`. Mesure sur les pixels de
  `docs/ui-review/captures/ui-hierarchie-c-V-GLOBE-S-NAT.webp` : la boîte englobante des plaques sombres
  d'étiquette fait **232 × 157 px**, pour une France métropolitaine d'environ
  90 × 95 px à l'écran.
- **Pourquoi ça compte, vu de ma lentille :** le désencombrement ne suit pas
  l'altitude. À la vue d'entrée du produit, l'annotation est plus grande que l'objet,
  cache la choroplèthe qu'elle commente, et l'ensemble se lit comme une liste
  flottante plutôt que comme une carte.

## Hors lentille

- `#world-overlay-action-list` contient 0 enfant et `#world-overlay-status` est vide
  alors que 13 étiquettes sont peintes sur le globe : le miroir accessible des cibles
  visibles ne porte rien (lentille accessibilité).
- Le hash de partage s'écrit `l=` (liste de couches vide) alors que trois couches sont
  actives — possiblement un artefact de `origin: 'qa'`, à vérifier par la lentille
  états.

## Ce que je n'ai PAS pu vérifier

- **Le scénario S-LIVE** (`flights` + `ais-live-vessels` + `earthquakes`) : non joué,
  faute de budget. La lisibilité des étiquettes de contacts temps réel au-dessus du
  globe n'est donc pas mesurée ici.
- **Le test B3 sur trois fonds contrastés** (eau, forêt, urbain clair) : je n'ai
  mesuré que sur bâti OSM clair (V-PARIS) et sur le globe à petite échelle. Ni forêt
  ni neige.
- **Surfaces laissées de côté** : fiche d'entité (clic sur objet), `#cctv-panel`,
  lien de partage, `#param-slider-panel`, `#clean-view-toggle`, `#left-panel-stack`
  déplié, `#map-stack-chips`. Ma lentille m'a fait passer le budget sur le HUD et
  l'état par défaut.
- **Une première passe de mesure a été jetée** : sous interception de requêtes
  Puppeteer, Cesium a levé un panneau
  « An error occurred while rendering. Rendering has stopped. InvalidStateError:
  The source image could not be decoded », globe noir, et tous mes fonds ont été
  échantillonnés à luminance ≈ 2/255. La passe propre (sans interception, PNG décodé
  côté Node avec `sharp`) donne `errorPanel: no` sur les six captures ; seuls ces
  chiffres-là sont rapportés ci-dessus.
- **Faux positif écarté** : `#traffic-sync-chip` et `#cctv-sync-chip` sortaient à
  contraste 1,05–1,23 dans ma première sonde. Vérification faite, ils portent
  `opacity: 0` au repos — ils ne sont pas affichés, ce n'était pas un défaut.
