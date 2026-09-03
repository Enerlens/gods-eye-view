# Cohérence du système — rapport

## Ce que j'ai fait

Recensement quantitatif de `style.css` (9 434 lignes) croisé avec un relevé
`getComputedStyle` en page sur 813 éléments visibles, panneaux ouverts
(`#data-panel`, `#pp-toggles`/paramètres, `#top-center-actions`, chips
`MAP SOURCE`), aux vues **V-GLOBE** et **V-FRANCE**, scénario **S-VIDE** —
Puppeteer + `newQaPage()`, `--enable-unsafe-swiftshader`, captures `/tmp/ui-coherence-*.png`.
Les formateurs de nombres ont été exécutés directement en Node pour relever
leurs sorties réelles.

## Constats

### [CASSE] La virgule veut dire « milliers » dans une couche énergie et « décimale » dans sa voisine

- **Ce que j'ai vu :** trois couches du même groupe (ÉNERGIE) formatent leurs
  chiffres selon trois conventions incompatibles. Exécution des fonctions
  livrées :

  | appel | sortie |
  |---|---|
  | `rteGeneration.formatGenMw(9500)` | `"9,500 MW"` |
  | `gasFrance.formatMw(9500)` | `"9,5 GW"` |
  | `powerGrid.formatGridKm(36106)` | `"36,106 km"` |
  | `gasFrance.formatKm(36106)` | `"36 106 km"` |
  | `datexRoadStatus.formatFlow(36106)` | `"36 106 véh/h"` |
  | `rteGeneration.formatGenMw(36106)` | `"36.1 GW"` |

  `"9,500 MW"` se lit *neuf mégawatts et demi* par un lecteur français ; c'est
  9 500 MW. Et `"36,106 km"` est exactement la chaîne que le dépôt a déjà
  identifiée comme fausse — dans `src/data/gasFrance.js:250` :
  « `toLocaleString('en-US')` was reaching the cards as `36,106 km of trace` —
  a figure a French reader parses as 36.1, off by a factor of 1000 ». Le bug a
  été corrigé localement dans `gasFrance` (helper `fr()`), corrigé une seconde
  fois autrement dans `datexRoadStatus` (`.replace(/,/g, ' ')`), et laissé en
  place dans `powerGrid` et `rteGeneration`.
- **Où :** `src/data/rteGeneration.js:229`, `src/data/powerGrid.js:214`,
  `src/data/satellites.js:834`, `src/data/flights.js:435` (`en-US`) contre
  `src/data/gasFrance.js:260` (`fr-FR`) et `src/data/datexRoadStatus.js:518`
  (rustine). Surface : cartes d'entité des couches énergie / réseau.
- **Reproduction :**
  1. `node -e "import('./src/data/rteGeneration.js').then(m=>console.log(m.formatGenMw(9500)))"` → `9,500 MW`
  2. `node -e "import('./src/data/gasFrance.js').then(m=>console.log(m.formatMw(9500)))"` → `9,5 GW`
  3. `node -e "import('./src/data/powerGrid.js').then(m=>console.log(m.formatGridKm(36106)))"` → `36,106 km`
- **Preuve :** valeurs relevées ci-dessus (sorties réelles des modules livrés) +
  le commentaire `src/data/gasFrance.js:250` qui documente le défaut.
- **Pourquoi ça compte, vu de ma lentille :** A3 — un canal, une information.
  Le même caractère `,` porte deux sens dans le même produit, à une couche
  d'écart. Ce n'est plus une inélégance : un chiffre devient faux d'un facteur
  1000. Et la trace de trois corrections locales divergentes du même défaut est
  la signature exacte d'une accumulation : personne n'a jamais eu le droit
  d'écrire *le* formateur du produit.

### [INCOHÉRENCE] Deux familles d'icônes dans la même liste — et le même pictogramme dessiné des deux façons

- **Ce que j'ai vu :** sur les 57 lignes de `#data-toggles`, **23 icônes sont
  des emoji couleur** (`✈️ 🛰️ 🚀 🎖️ 🚗 🚌 🚲 🛴 🚦 🔌 🌋 🔊 🌳 🚓 📹 🌡 📡 🎓 🏪 🏗 🏛 🧸 🛣`)
  et **34 sont des glyphes Unicode monochromes** (`✈ ⌖ ◭ ⬡ ⚓ Ⓜ ◷ ⚠ ⏱ ⚡ ☢ ◈ ≈ ⌁ ▰ ▲ ≋ ◉ ▣ € ▤ ▦ ⌂ ◎ ▩ ✚`).
  Trois lignes séparent `flights` (✈️, avion bleu et blanc, pleine couleur) de
  `local-airports` (✈, avion plat monochrome) : **le même pictogramme, deux
  familles graphiques, dans le même écran**.
  Huit glyphes servent en outre à plusieurs couches : `⬡` = bouées marines **et**
  réseau gaz ; `◉` = stations Hub'Eau **et** radio ; `≋` = Vigicrues **et** câbles
  sous-marins ; `⌖` = sites militaires **et** fiche implantation ; `▤` = DPE **et**
  bâti 3D ; `▦` = urbanisme **et** parcelles ; `⚠` × 3.
  Une troisième famille cohabite dans le même panneau des paramètres : sur les
  8 boutons de `#pp-toggles`, 2 icônes sont des Material Symbols (`adjust`,
  `flare`), 4 sont des glyphes géométriques (`◎ ✈ □ ▣`) et 2 sont des emoji
  couleur (`🔍 ✨`). Idem dans la barre de 3 boutons ronds du haut :
  `layers_clear` (Material), `🔗` (emoji), `public` (Material).
- **Où :** `#data-toggles [data-layer-id]`, `#pp-toggles .pp-icon`,
  `#top-center-actions button`. La règle `.pp-icon` (`style.css:1013`) ne fixe
  aucune `font-family` ; seuls les `.pp-icon.material-symbols-outlined` en ont une.
- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0`
  2. Déplier `#data-panel`, catégories AIR & ESPACE puis DÉFENSE
  3. Comparer la ligne « Vols en direct » et la ligne « Aéroports »
- **Preuve :** capture `docs/ui-review/captures/ui-coherence-data-panel.webp` (les quatre premières
  lignes sont en emoji couleur, « Aéroports » et « Sites militaires » en trait
  monochrome) ; recensement DOM : 23 emoji / 34 glyphes texte sur 57 lignes,
  8 groupes de glyphes dupliqués ; capture `docs/ui-review/captures/ui-coherence-topactions.webp`.
- **Pourquoi ça compte, vu de ma lentille :** B5 — la forme est qualitative, et
  elle ne doit pas mentir. Ici la *saturation* de l'icône ne code rien : elle
  code la date d'écriture de la couche. Et quand `⬡` désigne à la fois une bouée
  et un gazoduc, la forme ne distingue plus deux sujets sans rapport.

### [INCOHÉRENCE] « Actif » est cyan partout et vert sur un seul bouton, dans la même colonne

- **Ce que j'ai vu :** dans le panneau DISPLAY, cinq boutons `.pp-toggle-btn`
  sont actifs simultanément. Quatre portent l'accent cyan, un porte du vert :

  | bouton | `background-color` | `border-color` | couleur du label |
  |---|---|---|---|
  | `#hud-toggle` | `rgba(0, 212, 255, 0.15)` | `rgb(0, 212, 255)` | `rgb(0, 212, 255)` |
  | `#models3d-toggle` | `rgba(0, 212, 255, 0.15)` | `rgb(0, 212, 255)` | `rgb(0, 212, 255)` |
  | `#scope-toggle` | `rgba(0, 212, 255, 0.15)` | `rgb(0, 212, 255)` | `rgb(0, 212, 255)` |
  | `#sharpen-toggle` | `rgba(0, 212, 255, 0.15)` | `rgb(0, 212, 255)` | `rgb(0, 212, 255)` |
  | `#detection-toggle` | `rgba(0, 255, 80, 0.18)` | `rgba(0, 255, 80, 0.8)` | `rgba(0, 255, 80, 0.9)` |

  Rien dans la sémantique ne justifie la bascule : DETECT est un affichage comme
  les autres, pas une alerte ni une confirmation.
- **Où :** `#pp-toggles` ; `style.css:1002` (`.pp-toggle-btn.active` → `var(--accent)`)
  contre `style.css:1437` (`#detection-toggle.active` → `rgba(0,255,80,…)`) et
  `style.css:1452` (`.panoptic`, `.god`).
- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0`
  2. Déplier le panneau DISPLAY (colonne de droite)
  3. Lire la colonne HUD / DENSE / 3D / SCOPE
- **Preuve :** capture `docs/ui-review/captures/ui-coherence-params.webp` (DENSE encadré vert au
  milieu de HUD, 3D et SCOPE cyan) + les `getComputedStyle` du tableau,
  relevés en page (`docs/ui-review/sondes/ui-coherence-states.json`).
- **Pourquoi ça compte, vu de ma lentille :** B4 — le code couleur doit rester
  dans un seul registre. Ici le vert, qui n'apparaît nulle part ailleurs dans
  l'UI, promet une différence de nature qui n'existe pas ; à l'inverse, si le
  vert devait un jour signifier « nominal » ou « OK », la place est prise.

### [INCOHÉRENCE] Quatre bascules de langue dans une seule ligne du catalogue

- **Ce que j'ai vu :** une ligne de couche se lit
  `DATA LAYERS` (en) → `AIR & ESPACE` (fr) → `0/4 ON` (en) → `Vols en direct` (fr)
  → `OFF` (en) → `OpenSky Network · jamais` (en · fr). La ligne « Sites
  militaires » pousse le mélange à l'intérieur d'une même phrase :
  `OpenStreetMap + optional Google Maps Places · jamais`.
  Et la symétrie est franche : **le catalogue des 57 couches est entièrement en
  français, toute la chrome de contrôle est entièrement en anglais** — `DATA
  LAYERS`, `DISPLAY`, `LAYOUT`, `DENSITY`, `ALLOCATION`, `ELASTIC`, `WEIGHTED`,
  `FADE`, `OUTSIDE`, `MODELS`, `PROXIMITY`, `ALL`, `FEATHER`, `CELESTIAL`,
  `CLEAN UI`, `MAP SOURCE`, `VISUAL PRESETS`, `ACTIVE STYLE`, `LOCATION` —
  dans le même écran (`docs/ui-review/captures/ui-coherence-panels-open.webp`).
  Le formatage suit : le HUD écrit `2026-09-03 07:13:32Z`, `ALT: 555M`,
  `GSD: 0.22M`, `SUN: 19.6°` — séparateur décimal point, unité collée au
  chiffre — pendant que le catalogue écrit `Séismes (24 h)` avec l'espace
  insécable française. Côté source, 4 locales cohabitent sur 78 sites d'appel
  de formatage : `'fr-FR'` ×95, `'fr'` ×57, `'en-US'` ×10, `'en'` ×4,
  `'en-GB'` ×2, `'en-CA'` ×1.
- **Où :** `#data-panel` / `#data-toggles`, `#pp-toggles`, `#map-stack-chips`,
  `#hud-*`. Locales : `src/ui.js:1419`, `src/data/veloPulseFeed.js:70`,
  `src/data/fraicheurFeed.js:541`, `src/data/idfmFrequency.js:469`,
  `src/data/rteGenerationFeed.js:749` et `:787` (`en-CA`).
- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0`
  2. Déplier `#data-panel` et le panneau DISPLAY
  3. Lire de gauche à droite
- **Preuve :** capture `docs/ui-review/captures/ui-coherence-panels-open.webp` ;
  `docs/ui-review/captures/ui-coherence-data-panel.webp` ; recensement de texte (32 chaînes
  numériques visibles) ; comptage des tags de locale ci-dessus.
- **Pourquoi ça compte, vu de ma lentille :** c'est la ligne de faille du fork
  rendue visible à l'utilisateur. Le socle amont n'a jamais été traduit, les
  couches France l'ont été ; l'utilisateur, lui, ne voit qu'un produit qui
  n'arrive pas à décider dans quelle langue il parle — au milieu d'une même
  phrase.

### [INCOHÉRENCE] Les jetons de design existent, et le produit ne s'en sert pas

- **Ce que j'ai vu :** `:root` (`style.css:1`) déclare `--panel-radius: 16px`,
  `--btn-radius: 10px`, `--transition-fast: 150ms`, `--transition-smooth: 300ms`.
  Mesuré sur la feuille et à l'écran :

  | rôle | jetons utilisés | valeurs littérales | distinctes |
  |---|---|---|---|
  | `border-radius` | 12 `--panel-radius` + 2 `--btn-radius` | 147 déclarations en dur | **32** dans la feuille, **12** simultanément à l'écran |
  | durée de transition | 62 `var(--transition-*)` | 46 durées en dur | **25** (dont `.15s` écrit 23 fois alors que `--transition-fast` **vaut** 150 ms) |
  | `font-size` | — | — | **47** dans la feuille (px et rem mélangés), **16** simultanément à l'écran |
  | `padding` (raccourci) | — | 118 valeurs | **118** distinctes |

  Le rôle le plus répété du produit — la micro-étiquette capitale monospace —
  est écrit avec **22 valeurs distinctes de `letter-spacing` pour `font-size: 8px`**
  et **19 pour `font-size: 9px`**, dans trois unités (`1.35px`, `0.08em`, `0.1rem`).
  Sur les 23 règles `text-transform: uppercase` de la feuille, 16 valeurs de
  `letter-spacing` différentes, plus 2 sans.
  À l'écran, les 86 boutons visibles se répartissent en **15 signatures
  distinctes** (rayon × padding × taille × graisse × famille × casse × interlettrage
  × fond × bordure) ; l'écart ne porte aucun sens : `.pp-mode-btn` et
  `.detection-allocation` sont deux segmentés identiques en fonction, l'un à
  `font-size: 9px / letter-spacing: 0.6px`, l'autre à `8px / 0.35px`, tous deux
  à `border-radius: 0px` quand tout le reste de l'écran est arrondi à 3, 4, 6 ou 8 px.
  Même schéma sur les `<select>` : 4 dans l'app, 3 stylages, rayons 5 / 6 / 7 / 7 px,
  et `#cctv-camera-select` (`style.css:6264`) / `#scene-select` (`style.css:6728`)
  sont deux blocs identiques recopiés.
- **Où :** `style.css` — `:root` en tête ; `.pp-select:1344`, `#cctv-camera-select:6264`,
  `#scene-select:6728`, `#radio-filter:5587`.
- **Reproduction :**
  1. `grep -oE 'border-radius:[^;]+;' style.css | sort -u | wc -l` → 32
  2. `grep -c 'var(--panel-radius' style.css` → 12, sur 161 déclarations
  3. Ouvrir la page, relever `getComputedStyle` de tous les `button` visibles →
     15 signatures distinctes pour 86 boutons
- **Preuve :** les comptes ci-dessus (feuille + DOM),
  `docs/ui-review/sondes/ui-coherence-dump4.json`.
- **Pourquoi ça compte, vu de ma lentille :** A3 appliqué à l'interface. Quand
  un même rôle admet 22 valeurs, la valeur ne porte plus d'information : le
  lecteur ne peut plus déduire « c'est plus important » d'un interlettrage plus
  large, parce que l'interlettrage encode la semaine où la couche a été écrite.
  Le système existe sur le papier (`:root`) ; il n'a simplement jamais été
  contraignant, et chaque couche France ajoutée a re-décidé pour elle-même.
  **À décharge** : la palette de texte, elle, tient — 14 couleurs de texte
  distinctes à l'écran, dominées par les trois jetons `--text-primary` /
  `-secondary` / `-dim` (344 usages sur 438) ; et les panneaux vitrés sont
  homogènes (`16px` + `rgba(12,12,20,0.72)` + `blur(24px) saturate(1.4)` sur
  les 6 panneaux principaux). Le désordre est dans les *contrôles*, pas dans
  les *surfaces*.

### [INCOHÉRENCE] Les couches disent quand elles ont été rafraîchies, les fonds de carte ne disent rien

- **Ce que j'ai vu :** les 57 lignes de `#data-toggles` portent toutes un
  horodatage de fraîcheur (`OpenSky Network · jamais`, `USGS · jamais`,
  `Métropole de Lyon · Ville de Paris · jamais`). Les 6 chips `MAP SOURCE`
  (`GOOGLE 3D`, `BING AERIAL ion`, `BING LABELS ion`, `OSM`, `IGN ORTHO`,
  `PLAN IGN`) ne portent **ni date, ni millésime, ni date de campagne** — rien
  d'autre que leur nom. Le seul complément existant est un
  `coverageNote: 'metropolitan France only'` (`src/mapStackController.js:49` et `:62`),
  posé sur 2 des 6, en anglais, et seulement dans l'attribut `title` (souris).
  Le produit sait donc documenter la fraîcheur d'une couche, et ne le fait pas
  pour l'image sur laquelle il pose tout le reste.
- **Où :** `#map-stack-chips` / `.map-stack-chip` ; `src/mapStackChips.js:44-70`
  (le modèle du chip n'a que `label`, `requirement`, `unavailableHint`,
  `coverageNote`) ; `src/mapStackController.js:7-62` (définition des 6 stacks).
- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0`
  2. Ouvrir le tiroir MAP SOURCE (bas de l'écran)
  3. Chercher une date sur `IGN ORTHO` — il n'y en a pas, ni en étiquette ni en `title`
- **Preuve :** capture `docs/ui-review/captures/ui-coherence-panels-open.webp` (rangée MAP SOURCE
  visible, 6 chips nus) ; lecture de `mapStackChipModel()` — aucun champ de
  millésime n'existe dans le modèle.
- **Pourquoi ça compte, vu de ma lentille :** A6 — le fond n'est pas un décor.
  L'incohérence n'est pas seulement doctrinale, elle est interne : deux
  registres de rigueur documentaire dans la même fenêtre, l'un pour les couches
  France ajoutées par le fork, l'autre pour les fonds hérités du socle.

### [FRICTION] Une troisième fonte d'icônes est téléchargée et jamais utilisée

- **Ce que j'ai vu :** `index.html:13` charge
  `https://fonts.googleapis.com/icon?family=Material+Icons+Round` — une feuille
  bloquante de plus, en tiers. La requête part bien au chargement (vérifié en
  page). Or `material-icons` n'apparaît **nulle part** : ni dans `index.html`,
  ni dans `src/`, ni dans `style.css` — qui n'utilise que
  `Material Symbols Outlined` (15 règles).
- **Où :** `index.html:13`.
- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0` avec l'onglet Réseau ouvert
  2. Filtrer sur `Material+Icons+Round` → 1 requête
  3. `grep -rn "material-icons" index.html src style.css` → 0 occurrence
- **Preuve :** sonde Puppeteer, `MaterialIconsRound requested: true` ; grep à 0
  occurrence.
- **Pourquoi ça compte, vu de ma lentille :** c'est la trace fossile d'un jeu
  d'icônes abandonné qui n'a jamais été retiré. Seul, c'est un détail de
  performance ; dans ce rapport, c'est la même histoire que les 22
  interlettrages et les trois formateurs de nombres — on ajoute, on ne retire pas.

## Hors lentille

- Le serveur de dev du port 4290 est tombé pendant la session (~09:20, `curl` →
  connexion refusée ; aucun `vite` pour `manila-v1` dans `ps`). Je ne l'ai ni
  lancé ni tué — mes sondes ne ciblaient que mes propres processus Node.
- Quatre tailles de police calculées descendent sous 7 px à l'écran
  (`6.24px`, `6.4px`, `6.72px`, `6.88px`, dont le bouton `#gev-voice-tier` « STD »
  à 6.4 px) — lisibilité, pas ma lentille.
- `#hud-summary` affiche `0KM` et `#hud-alt` `ALT: 555M` : unité collée au
  chiffre et en capitale, dans un produit par ailleurs francisé.

## Ce que je n'ai PAS pu vérifier

- **Le scénario S-NAT et le scénario S-LIVE à l'écran.** Activer six couches
  simultanément sous SwiftShader bloque `scene.render()` au-delà de mon budget
  (une sonde tuée après 6 minutes sans rendre la main). Toutes mes mesures
  portent donc sur **S-VIDE**, panneaux ouverts.
- **Conséquence directe :** le constat sur les formateurs de nombres
  (`9,500 MW` / `36,106 km`) est prouvé par exécution des modules livrés, mais
  **non reproduit dans une carte d'entité à l'écran** — il aurait fallu charger
  `rte-generation` et `power-grid` et cliquer un objet.
- **La règle C2 (la maille nommée).** Elle demande d'ouvrir les légendes des
  choroplèthes nationales à V-FRANCE, ce que S-NAT m'a refusé. La lecture du
  code suggère que les couches nomment leur maille avec soin
  (`amenitiesDepartements.js:194`, `filosofiCarreaux.js:678`), mais je n'ai
  aucune preuve à l'écran et je ne rapporte donc rien.
- **La vue V-PARIS**, la fiche d'entité, le panneau CCTV déplié, le lien de
  partage et le mode « clean view » : laissés de côté, ma lentille étant déjà
  servie par les surfaces ouvertes.
- **La fin de la session**, après la chute du port 4290 : je n'ai pas pu
  recapturer `#map-stack-chips` ni `#pp-toggles` en 2× ; les captures citées
  proviennent du passage précédent, à 1× (1600×1000).
