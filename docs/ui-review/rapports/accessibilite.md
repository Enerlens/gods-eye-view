# Accessibilité — rapport

## Ce que j'ai fait

Parcours V-GLOBE (S-VIDE) puis V-FRANCE (S-NAT : `irve-fr` + `schools-fr` + `delinquance-fr`),
surfaces ouvertes : `#data-panel`, `#scene-panel`, `#cctv-panel`, `#pp-toggles`, HUD,
`#top-center-actions`, `#gev-voice-control`, `#context-radio-dock`.
Outillage : quatre harnais Puppeteer maison (`docs/ui-review/sondes/ui-a11y-audit.mjs`, `-focus.mjs`, `-ring.mjs`,
`-final.mjs`), `newQaPage()` + `?welcome=0`, `scene.render()` pompé à la main, contraste WCAG
calculé **deux fois** — sur le fond CSS déclaré et sur le **pixel réellement rendu** échantillonné
dans la capture avec `sharp` (histogramme modal du rectangle du texte).
Données brutes : `docs/ui-review/sondes/ui-a11y-1.json` … `docs/ui-review/sondes/ui-a11y-4.json`, `docs/ui-review/sondes/ui-a11y-pixel.json`.

## Constats

### [CASSE] « Non diffusé — secret statistique » est codé par une teinte sans motif, et sa clarté tombe au milieu de la rampe

- **Ce que j'ai vu :** la 7ᵉ entrée de légende de `delinquance-fr` (l'absence de donnée) est une
  pastille pleine `rgb(92,107,138)`, sans motif : `glyph:false`, `mask:"none"`, 6×6 px.
  Sa luminance relative est **0,1463** — elle atterrit **entre** la classe 3
  (`rgb(224,49,49)`, L=0,1827) et la classe 4 (`rgb(176,32,32)`, L=0,1037) de la rampe ordonnée.
  Contraste WCAG « pas de donnée » ↔ classe 3 = **1,19:1**, ↔ classe 4 = **1,28:1**.
  En niveaux de gris : pas-de-donnée = 106, classe 3 = 118, classe 4 = 91.
- **Où :** `#data-toggles [data-layer-id="delinquance-fr"] .data-toggle-legend-swatch` (7ᵉ) ;
  le swatch n'a pas de masque, cf. `style.css:6098` (`.data-toggle-legend-swatch`) et la classe
  `has-glyph` de `style.css:6112` qui n'est **pas** appliquée à cette entrée.
- **Reproduction :**
  1. `http://localhost:4290/?welcome=0`
  2. `#data-panel` → bouton `.panel-collapse-btn` (« Expand DATA LAYERS »)
  3. activer `delinquance-fr`
  4. lire `getComputedStyle(sw).backgroundColor` des 7 `.data-toggle-legend-swatch` de la ligne
- **Preuve :** mesure — `docs/ui-review/sondes/ui-a11y-4.json` → `legends[1].items`. Les 7 couleurs :
  `255,224,138` / `255,182,72` / `249,115,22` / `224,49,49` / `176,32,32` / `109,20,20` /
  **`92,107,138`**. Ratios calculés ci-dessus avec la formule WCAG du briefing.
- **Pourquoi ça compte, vu de ma lentille :** en niveaux de gris, sous NVG, sous FLIR, sur une
  impression monochrome, ou pour n'importe qui avec une acuité chromatique réduite, « donnée
  retenue au titre du secret statistique » se lit comme **« 6,23 à 6,44 délits pour 1 000
  habitants »**. Ce n'est pas une nuance esthétique : c'est un département qu'on croit lire.

### [CASSE] Les deux paliers les plus sombres de chaque rampe sont invisibles dans la légende elle-même

- **Ce que j'ai vu :** la pastille de légende fait **6×6 px** et porte la couleur exacte de la
  classe, sur le verre du panneau échantillonné à `rgb(10,12,18)`. Contrastes mesurés :
  | couche | classe 0 | classe 1 | classe 2 |
  |---|---|---|---|
  | `irve-fr` | **1,30:1** | **1,85:1** | 2,76:1 |
  | `schools-fr` | **1,60:1** | **2,46:1** | 3,94:1 |
  | `delinquance-fr` (classe la + haute) | **1,64:1** | — | — |
  WCAG 1.4.11 (non-text contrast) demande 3:1 pour un graphique porteur de sens.
  Trois des six paliers d'`irve-fr` sont sous le seuil, deux de `schools-fr`.
- **Où :** `.data-toggle-legend-swatch`, `style.css:6098-6106` — 6 px, `border-radius:50%`,
  filet `box-shadow: 0 0 0 1px rgba(255,255,255,0.18)` (lui-même à ~1,4:1 sur le verre).
  Le commentaire du code assume le choix : « The swatch IS the datum — keep it exactly the point
  color, with only a hairline ring ».
- **Reproduction :** identique au constat précédent, puis mesurer les swatches d'`irve-fr` et
  `schools-fr` contre `getComputedStyle(#data-panel).backgroundColor` composité.
- **Preuve :** mesure — `docs/ui-review/sondes/ui-a11y-4.json` → `legends[*].items[*].swatchBg` et `w`/`h` = 6/6.
  Capture : `docs/ui-review/captures/ui-accessibilite-crop-snat-left.webp` (V-FRANCE, S-NAT, colonne gauche).
- **Pourquoi ça compte, vu de ma lentille :** la légende est la seule clé de décodage d'une
  choroplèthe. Si le palier bas de la clé est invisible, la classe basse de la carte est
  indécodable — pas « moins jolie », indécodable.

### [CASSE] 20 des 50 textes visibles échouent AA sur le pixel réellement rendu, dont **tous** les titres de panneau en 8 px

- **Ce que j'ai vu :** contraste calculé sur le pixel de fond réel (histogramme modal du
  rectangle, capture 1440×900, dpr 1), pas sur la couleur CSS déclarée. 20 échecs / 50 textes.
  Les pires :
  | ratio | taille | élément | texte | fond échantillonné |
  |---|---|---|---|---|
  | 2,30 | 11 px | `p.subtitle` | « NO PLACE LEFT BEHIND » | `rgb(5,6,10)` |
  | 2,30 | 10 px | `span.indicator-label` | « ACTIVE STYLE » | `rgb(5,6,10)` |
  | **2,36** | **8 px** | `span.panel-title` | « SCENES » | `rgb(10,11,18)` |
  | **2,36** | **8 px** | `span.pp-header-label` | « DISPLAY » | `rgb(10,11,17)` |
  | **2,37** | **8 px** | `span.panel-title` | « DATA LAYERS » | `rgb(10,12,18)` |
  | 2,43 | 13 px | `button.panel-collapse-btn` | « + » / « ◀ » (×5) | `rgb(18,19,25)` |
  | 2,41 | 6,4 px | `#gev-voice-cost-value` | « ~$0.00 » | `rgb(22,42,53)` |
  Le libellé de classe de légende porte la même couleur (`--text-dim`,
  `rgba(232,234,237,0.3)`, `style.css:16`) en **8 px** : composité `rgb(77,77,78)` sur
  `rgb(10,12,18)` = **2,32:1**. AA exige 4,5:1.
- **Où :** `span.panel-title`, `span.pp-header-label`, `.data-toggle-legend-item`,
  `button.panel-collapse-btn` ; variable fautive `--text-dim` à `style.css:16`.
- **Reproduction :**
  1. `http://localhost:4290/?welcome=0`, viewport 1440×900
  2. poser V-GLOBE (lon 10, lat 48, 12 000 km, pitch −90), 10 × `scene.render()`
  3. capturer, puis pour chaque nœud texte : couleur CSS composée sur le mode de l'histogramme
     de son rectangle dans la capture
- **Preuve :** mesure — `docs/ui-review/sondes/ui-a11y-pixel.json` (53 mesures, `declaredRatio` vs `realRatio`).
  Captures : `docs/ui-review/captures/ui-accessibilite-vglobe.webp`, agrandissement ×3
  `docs/ui-review/captures/ui-accessibilite-crop-panel-titles.webp` où « SCENES » et le « − » du bouton de repli
  sont à peine détachés du verre.
- **Pourquoi ça compte, vu de ma lentille :** 8 px à 2,3:1, c'est sous le seuil AA **et** sous
  toute taille minimale raisonnable, sur les six étiquettes qui nomment les six panneaux du
  produit. C'est le premier mot que quiconque doit lire, et c'est le moins lisible.

### [CASSE] Le globe n'est ni atteignable au clavier ni nommé

- **Ce que j'ai vu :** `#cesiumContainer canvas` a `role = null`, `aria-label = null`,
  `tabindex = null`. Il n'apparaît à aucun des 78 arrêts de tabulation relevés. Les 53 couches,
  les entités cliquables, la sélection d'objet : rien de tout cela n'est atteignable autrement
  qu'à la souris.
- **Où :** `#cesiumContainer canvas` ; aucun `role="application"`/`img`, aucun `tabindex="0"`.
- **Reproduction :**
  1. `http://localhost:4290/?welcome=0`
  2. `document.activeElement.blur()`, puis 220 × `Tab`
  3. le canvas n'est jamais `document.activeElement`
- **Preuve :** mesure — `docs/ui-review/sondes/ui-a11y-1.json` → `aria.canvasRole = {role:null, label:null,
  tabindex:null}` ; `docs/ui-review/sondes/ui-a11y-3.json` → `walkData` (78 arrêts, aucun sur le canvas).
- **Pourquoi ça compte, vu de ma lentille :** le produit **est** le globe. Un utilisateur au
  clavier seul peut allumer 53 couches et n'en consulter aucune entité. C'est l'exclusion la plus
  large que j'aie mesurée : elle porte sur la totalité de la valeur du produit, pas sur un
  contrôle.

### [FRICTION] 22 des 50 contrôles interactifs sont sous 24×24 px ; 49 sur 50 sous 44×44

- **Ce que j'ai vu :** inventaire des `getBoundingClientRect()` de tous les contrôles visibles
  et dans le viewport, panneaux SCENES + CCTV ouverts (V-FRANCE, 1440×900) : **50 cibles**,
  **22 sous 24 px de côté minimal** (WCAG 2.5.8 AA), **49 sous 44 px** (2.5.5 AAA).
  Les plus petites : `#gev-voice-tier` **24,8×11,5** (côté min 11,5 px), le lien de crédit Cesium
  **138×13**, `button.scene-shot-btn` « LOAD » **36,4×20** et « DEL » **30,8×20** (×6),
  les cinq `.panel-collapse-btn` **22×22** / **20×20** / **19,2×22**.
  En S-VIDE, sur 13 cibles à l'écran, **8 sont sous 24 px** et **13/13 sous 44**.
- **Où :** `#gev-voice-tier`, `.scene-shot-btn`, `.panel-collapse-btn`, `.pp-collapse-btn`.
- **Reproduction :**
  1. `http://localhost:4290/?welcome=0`, viewport 1440×900
  2. ouvrir `#scene-panel` et `#cctv-panel`
  3. `[...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[role="button"],[data-layer-id]')].map(e=>e.getBoundingClientRect())`
- **Preuve :** mesure — `docs/ui-review/sondes/ui-a11y-2.json` → `targets` (50 entrées triées par côté minimal).
- **Pourquoi ça compte, vu de ma lentille :** `.panel-collapse-btn` à 22×22 px est **la** porte
  d'entrée de chaque panneau : sans elle on ne voit aucune couche. Un tremblement, un trackpad,
  un écran tactile, et cette porte se rate.

### [FRICTION] Rien n'est annoncé quand une couche s'allume — 17 régions live, 0 changement

- **Ce que j'ai vu :** j'ai relevé le `textContent` des **17** nœuds `[aria-live]`/`[role=status]`/
  `[role=alert]` de la page, allumé `earthquakes`, attendu 2,5 s, relevé à nouveau :
  **0 nœud modifié**. `#world-overlay-status` (`role="status" aria-live="polite"
  aria-atomic="true"`, `index.html:22`) reste vide (`textLen = 0`) ; `#toast` (`index.html:64`)
  reste vide. Par ailleurs les boutons de bascule des lignes de couche sont des
  `<button type="submit">` **sans `aria-pressed` ni `role="switch"`** — l'état ne vit que dans le
  nom accessible (« Vols en direct: OFF »).
- **Où :** `#world-overlay-status` (`index.html:22`), `#toast` (`index.html:64`),
  `#data-toggles [data-layer-id] > button`.
- **Reproduction :**
  1. `http://localhost:4290/?welcome=0`
  2. snapshot du `textContent` de tous les `[aria-live],[role=status],[role=alert]`
  3. `__godsEyeView.dataManager.setEnabled('earthquakes', true, {origin:'qa'})`
  4. attendre 2 500 ms, re-snapshot
- **Preuve :** mesure — `docs/ui-review/sondes/ui-a11y-4.json` → `liveProbe: []` (tableau vide = aucun
  changement), et `docs/ui-review/sondes/ui-a11y-1.json` → `aria.liveRegions` (17 nœuds, `#world-overlay-status`
  et `#toast` à `textLen:0`).
- **Pourquoi ça compte, vu de ma lentille :** un badge `role="status"` qui ne s'annonce jamais est
  un défaut. L'action centrale du produit — allumer une couche — ne produit aucun retour non
  visuel. **Réserve honnête :** j'ai déclenché par l'API `dataManager`, pas par un clic sur le
  bouton de la ligne ; la reprise par le chemin clic n'a pas pu tourner (serveur tombé).

### [FRICTION] 66 arrêts de tabulation d'affilée dans `#data-panel`, sans landmark, sans titre, sans liste pour en sortir

- **Ce que j'ai vu :** `#data-panel` déplié, la marche à la tabulation fait **78 arrêts** dont
  **66 à l'intérieur du panneau**, couvrant les **57** lignes de couche. Il n'y a **aucun**
  mécanisme de saut : `document.querySelector('main,[role=main]')` = `null` ; pas de lien
  d'évitement (`skipLink: false`) ; **2 titres** dans tout le document (`h1` « GOD'S EYE VIEW »
  et un `h2`) ; `#data-toggles` a `role = null` ; les lignes sont des `DIV` à `role = null`.
  Les 8 `.panel-collapse-btn` portent `aria-expanded` mais **`aria-controls = null` pour les 8**,
  et **l'un d'eux n'a ni `aria-label` ni `aria-expanded`**.
  Bon point mesuré au passage : aucun piège à focus, aucun arrêt hors écran
  (`offscreen: 0`), un seul arrêt clippé — la liste défile bien sous le focus.
- **Où :** `#left-panel-stack` > `#data-panel` > `#data-toggles` (`index.html:605`) ;
  `.panel-collapse-btn`.
- **Reproduction :**
  1. `http://localhost:4290/?welcome=0`
  2. déplier `#data-panel` uniquement
  3. `blur()` puis `Tab` jusqu'à revenir sur `body` ; compter les arrêts et ceux dont
     `closest('#data-panel')` est vrai
- **Preuve :** mesure — `docs/ui-review/sondes/ui-a11y-3.json` → `walkData` : 78 arrêts, 66 `inDataPanel`,
  57 `layerId` distincts, `offscreen: 0` ; `docs/ui-review/sondes/ui-a11y-4.json` → `struct.main = false`,
  `struct.dataPanelListRole = null`, `struct.collapseBtnAria` (8 × `controls: null`).
- **Pourquoi ça compte, vu de ma lentille :** un lecteur d'écran navigue par landmarks, par
  titres ou par listes. Ici il n'a aucun des trois : la seule façon d'atteindre le panneau CCTV
  depuis les couches est 66 tabulations.

### [INCOHÉRENCE] Le focus clavier est le pixel exact du survol souris sur les actions globales

- **Ce que j'ai vu :** `#top-center-actions button` pose `outline: none` (`style.css:1903`) puis
  fait partager **une seule règle** à `:hover` et `:focus-visible` (`style.css:1906-1911`).
  Sous une vraie pression de `Tab`, `#clear-selected-layers` rend
  `outline-style: none`, `outline-width: 0px`, `box-shadow: none`.
  Le seul écart de couleur entre les deux états est la bordure de 1 px :
  `--glass-border rgba(255,255,255,0.08)` → `--glass-border-hover rgba(255,255,255,0.15)`,
  soit, composité sur le verre `rgb(10,10,17)`, `rgb(30,30,36)` → `rgb(47,47,53)` =
  **1,25:1** entre l'état au repos et l'état focalisé.
- **Où :** `style.css:1888` (base, `outline: none` l.1903) et `style.css:1906-1911` (règle
  `:hover, :focus-visible` partagée) ; contrôles `#clear-selected-layers`, `#share-btn`,
  `#reset-globe-view`.
- **Reproduction :**
  1. `http://localhost:4290/?welcome=0`
  2. `document.activeElement.blur()` puis un seul `Tab` (arrêt 1 = `#clear-selected-layers`)
  3. lire `getComputedStyle(document.activeElement).outlineStyle / outlineWidth / boxShadow`
- **Preuve :** code + mesure — `style.css:1903` et `style.css:1906-1911` ;
  `docs/ui-review/sondes/ui-a11y-2.json` → `walk[0].outline = "none|0px|rgba(232,234,237,0.5)|off0px"`,
  `boxShadow = "none"`.
- **Pourquoi ça compte, vu de ma lentille :** WCAG 2.4.11 demande un indicateur de focus
  distinguable ; ici l'indicateur existe mais il est **indiscernable de l'état survol**, et sa
  seule composante colorée vaut 1,25:1. L'utilisateur clavier ne peut pas savoir si le bouton
  est ciblé ou simplement survolé. Le reste de l'app fait autrement (`#control-panel-toggle` a
  un vrai `outline: 1px solid color-mix(in srgb, var(--accent) 80%, transparent)` avec
  `outline-offset: 3px`) : c'est donc aussi une divergence interne.

### [FRICTION] B4 est tenu, mais trois paires de classes adjacentes d'`irve-fr` sont sous 1,5:1

- **Ce que j'ai vu :** j'ai passé les trois rampes ordonnées au test littéral de B4 — luminance
  relative WCAG, puis simulation de deutéranopie (Viénot–Brettel 1999 en RGB linéaire).
  **L'ordre survit dans les trois cas** : luminances strictement monotones
  (`irve-fr` 0,020 → 0,523 ; `schools-fr` 0,036 → 0,675 ; `delinquance-fr` 0,764 → 0,038).
  En revanche l'écart entre classes voisines est faible : `irve-fr` a **3 paires adjacentes
  sur 5 sous 1,5:1** (la plus serrée, classes 0↔1, à **1,42:1**), `schools-fr` et
  `delinquance-fr` en ont une chacune (1,43:1 et 1,35:1) — et ce sont les valeurs **avant**
  compositing alpha sur le fond de carte.
- **Où :** rampes des couches `irve-fr`, `schools-fr`, `delinquance-fr` (swatches lus dans
  `#data-toggles [data-layer-id] .data-toggle-legend-swatch`).
- **Reproduction :**
  1. `http://localhost:4290/?welcome=0`, déplier `#data-panel`
  2. activer les trois couches, relever les `backgroundColor` de chaque swatch
  3. calculer la luminance WCAG de chaque, vérifier la monotonie ; simuler la deutéranopie
- **Preuve :** mesure — `docs/ui-review/sondes/ui-a11y-4.json` → `legends`. `irve-fr` :
  `47,27,82` → `77,42,134` → `114,57,180` → `155,79,208` → `199,116,224` → `235,169,239`,
  ratios adjacents 1,42 / 1,49 / 1,49 / 1,58 / 1,64.
- **Pourquoi ça compte, vu de ma lentille :** c'est le seul point où la doctrine est réellement
  respectée, et il faut le dire — la teinte n'ordonne pas ici, la valeur ordonne. Le reste du
  risque se déplace vers le nombre de paliers : six paliers déclarés dont deux paires que je
  mesure à moins de 1,5:1 avant même le compositing.

## Hors lentille

- Les trois couches nationales de S-NAT peignent **les mêmes départements en même temps** en
  alpha : la couleur affichée sur la carte n'est plus celle d'aucune des trois légendes
  (visible sur `docs/ui-review/captures/ui-accessibilite-crop-snat-left.webp`).
- Déplier `#scene-panel` **replie automatiquement** `#data-panel` (accordéon non annoncé) : le
  panneau qu'on venait d'ouvrir disparaît sans que rien ne le dise.

## Ce que je n'ai PAS pu vérifier

- **Le test F5 (FLIR sur une couche zonale).** Le script était écrit et prêt
  (`docs/ui-review/sondes/ui-a11y-f5.mjs` : `delinquance-fr` à V-FRANCE, échantillonnage de 728 pixels du
  territoire, bascule `button.style-btn[data-style="thermal"]`, comparaison de l'ordre des
  luminances avant/après). **Le serveur de dev du port 4290 est tombé au moment de le lancer**
  (`net::ERR_CONNECTION_REFUSED`, puis 14 sondes `curl` à `000` sur ~4 minutes). Je n'ai relancé
  aucun serveur, conformément au briefing.
- **La reprise par le chemin clic de la sonde `aria-live`** (constat « rien n'est annoncé ») :
  même cause. Le constat repose sur le déclenchement par API.
- **La mesure pixel de l'anneau de focus.** Deux tentatives : `page.screenshot({clip})` a
  échoué en `Protocol error … Failed to deserialize params.clip.width`, et le diff par
  recadrage `sharp` a rendu 3 136 / 3 136 pixels changés — c'est-à-dire le globe Cesium qui
  continuait de charger des tuiles entre les deux prises, pas un anneau. J'ai donc rapporté le
  focus sur la **règle CSS + le style calculé sous `Tab` réel**, jamais sur ces captures.
- **Surfaces laissées de côté :** `#cctv-panel` en profondeur (lightbox, `#cctv-lightbox-meta`),
  le HUD cockpit (`#cockpit-hud`, masqué en vue globe), `#param-slider-panel`,
  `#clean-view-toggle`, le lien de partage et la fiche d'entité — cette dernière parce qu'elle
  exige un clic sur le canvas, qui est justement l'interaction que ma lentille a constatée
  impossible au clavier.
- **Ce que je n'ai pas mesuré :** le rendu sous un vrai GPU (tout est en SwiftShader headless),
  le comportement d'un lecteur d'écran réel (VoiceOver/NVDA), et `prefers-reduced-motion`.
