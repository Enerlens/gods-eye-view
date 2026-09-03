# Audit de doctrine — rapport

## Ce que j'ai fait

J'ai déroulé les **tests de conformité de `CARTOGRAPHIE.md` tels qu'ils sont écrits**, contre
l'écran, en priorisant les P0. Surfaces : `#data-panel`, `#data-toggles` (légendes), `#intel-hud`,
`#right-context-rail`, `#command-dock`, les presets visuels (`NORMAL`/`FLIR`/`NVG`), le canvas.
Vues V-GLOBE, V-FRANCE, V-PARIS plus deux vues auxiliaires (Bretagne 260 km, Gironde 300 km) ;
scénarios S-VIDE, S-NAT (`irve-fr` + `schools-fr` + `delinquance-fr`), S-LIVE.
Outillage : Puppeteer + `newQaPage()`, `preserveDrawingBuffer` pour échantillonner le pixel réel
sous chaque département, parcours des `BillboardCollection` pour relever la symbologie effective.
Neuf sondes, `/tmp/ui-doctrine-probe*.mjs` et `/tmp/ui-doctrine-probe*.json`.

**Le serveur 4290 est tombé** vers la fin (ERR_CONNECTION_REFUSED, plus aucun processus vite pour
`manila-v1`) et n'est pas revenu ; la dernière sonde n'a pas tourné. Voir la fin du rapport.

---

## Tableau de conformité (ce qui a été testé)

| Règle | P | Verdict | En une ligne |
|---|---|---|---|
| **A1** un signe ≠ une valeur par défaut | P0 | ⚠️ partiel | `FALLBACK` est badgé sur la ligne de couche, mais rien ne le distingue au niveau de l'objet |
| **A2** l'âge de la mesure est une variable visuelle | P0 | ❌ | alpha = 1,000 sur 12 933 billboards, aucun canal d'ancienneté |
| **A3** un canal, une information | P0 | ❌ | l'aplat porte 3 couches à la fois, la taille porte classe × distance |
| **A4** le vide a trois causes | P0 | ⚠️ partiel | l'écrêtage est déclaré, l'occultation et l'absence ne se distinguent pas |
| **A5** tout écrêtage se déclare | P1 | ✅ | « 220 666 charge points · 96 départements · 820 outre-mer not mapped » |
| **B1** absolu → taille, jamais l'aplat sur un effectif | P0 | ❌ | `irve-fr` et `schools-fr` peignent un effectif brut, sans le dire |
| **B2** la taille écran est prise par la profondeur | P0 | ✅ | 0 inversion sur 19 644 paires mesurées |
| **B3** six paliers déclarés ≠ six perçus | P1 | ❌ | l'écart intra-classe (1,45) dépasse le pas inter-classes (1,35) |
| **B4** la teinte n'ordonne pas | P1 | ✅ | la rampe est monotone en luminance : 0,764 → 0,038 |
| **B5** une forme ne ment pas sur un type inconnu | P0 | ❓ | 7 silhouettes d'aéronef, aucune n'est un signe « non classé » |
| **C1** discrétiser le phénomène, pas l'échantillon | P0 | ✅ | bornes identiques au caractère près entre France entière et Bretagne seule |
| **C2** la maille est une hypothèse | P1 | ⚠️ partiel | la maille est nommée, le MAUP n'est pas mentionné |
| **D1** légende obligatoire et visible avec la carte | P0 | ❌ | 38 nœuds de légende, tous en 0×0 px, dans un panneau replié |
| **D3** l'absence se code par un motif | P1 | ❌ | « non diffusé » est une teinte, moins séparable que deux classes voisines |
| **E1** l'instant représenté s'affiche | P0 | ❌ | le HUD affiche l'horloge du client ; l'âge affiché est celui du *fetch* |
| **F1** politique d'occultation déclarée | P0 | ❌ | `depthTestAgainstTerrain = false`, `disableDepthTestDistance = Infinity` partout |
| **F2** ancrer la mesure | P0 | ❌ | GSD faux d'un facteur 3,3 au réticule, et varie de 1,8× dans l'image |
| **F3** restituer le cap | P1 | ❌ | aucun indicateur de nord ni de cap hors cockpit |
| **F5** les shaders capteur s'arrêtent avant la couleur-donnée | P0 | ❌ | FLIR inverse l'ordre de 11 paires sur 45, légende inchangée |
| **G1** le filtre, maillon manquant | P1 | ❌ | zéro contrôle de filtre lié à une couche dans tout le document |
| **G2** un filtre ne détruit pas le batch | P0 | — | non testable : il n'y a pas de filtre |
| **H1** savoir ce que la donnée ne contient pas | P0 | ⚠️ partiel | remarquable sur `schools-fr`, absent sur `delinquance-fr` |

Non traités faute de temps/serveur : A6, C3, C4, D2, E2, E3, E4, F4, F6, G3, G4, H2, H3.

---

## Constats

### [CASSE] F5 — Sous FLIR, la légende n'est plus une clé de décodage, et l'ordre s'inverse

- **Ce que j'ai vu :** avec `delinquance-fr` seul actif, j'ai relevé le pixel composité au centroïde
  de 10 départements en `NORMAL`, puis en `FLIR`, puis en `NVG`, sans bouger la caméra (V-FRANCE).
  La légende du panneau reste **strictement identique** dans les trois styles (les 7 pastilles
  renvoient les mêmes `rgb()` au byte près). L'image, elle, est repeinte en niveaux de gris.
  **11 paires de départements sur 45 changent d'ordre de luminance entre `NORMAL` et `FLIR`.**
  Le cas le plus net : le Finistère est le 2ᵉ plus clair en `NORMAL` (L = 0,730) et le **plus
  sombre de tous** en `FLIR` (L = 0,017) ; la Vendée passe de 0,675 à 0,888 pendant que le Nord
  descend de 0,651 à 0,292.
- **Où :** canvas Cesium + `#data-toggles [data-layer-id="delinquance-fr"] .data-toggle-legend-item` ;
  boutons `.style-btn[data-style="thermal"]` / `[data-style="surveillance"]` (`index.html:519-528`).
- **Reproduction :**
  1. `http://localhost:4290/?welcome=0`
  2. activer `delinquance-fr`, caméra V-FRANCE
  3. relever la couleur d'un département (ex. Finistère, lon −4.1 / lat 48.3)
  4. cliquer `FLIR` dans VISUAL PRESETS ; relever le même point
  5. ouvrir DATA LAYERS : la légende jaune → rouge sombre est toujours là
- **Preuve :** capture `docs/ui-review/captures/ui-doctrine-delinquance-thermal.webp` (choroplèthe intégralement grise,
  étiquettes « Paris · 11,9 », « Gironde · 7,14 » toujours affichées).
  Mesures — Finistère NORMAL `242,220,172` L=0,730 → FLIR `35,35,35` L=0,017 ;
  Cantal NORMAL `225,226,170` L=0,733 → FLIR `255,255,255` L=1,000 ;
  Gironde NORMAL `151,71,77` L=0,116 → FLIR `93,93,93` L=0,109.
  Légende en FLIR : `rgb(255,224,138)`…`rgb(109,20,20)` — inchangée.
- **Pourquoi ça compte :** c'est le test F5 mot pour mot (« Activer FLIR sur une couche zonale.
  La légende reste-t-elle exacte ? ») et il échoue. Pire que prévu par la doctrine : la rampe
  descend en luminance quand la valeur monte, or FLIR se lit « brillant = fort ». Un lecteur en
  mode capteur ne lit pas une donnée imprécise, il lit **l'inverse de la donnée**, avec une légende
  qui lui donne raison. Le panneau `PARAMETERS` du mode FLIR expose en plus un curseur
  `WHOT/BHOT` (0,33) qui permet d'inverser encore la polarité.

### [CASSE] D1 — Trois choroplèthes à l'écran, aucune légende lisible sans ouvrir un panneau

- **Ce que j'ai vu :** en S-NAT (`irve-fr` + `schools-fr` + `delinquance-fr`) à V-FRANCE, panneaux
  dans leur état par défaut, la France est entièrement peinte et **il n'existe aucune clé à
  l'écran**. Le DOM contient bien 38 nœuds `.data-toggle-legend-item` / `.data-toggle-legend-swatch`,
  mais ils mesurent **tous 0×0 px** : ils vivent dans `#data-toggles`, à l'intérieur de
  `#data-panel.collapsed`.
- **Où :** `#data-panel.panel-collapsible.collapsed` → `#data-toggles` → `.data-toggle-legend-item`
  (`style.css:6026-6112`).
- **Reproduction :**
  1. `http://localhost:4290/?welcome=0`
  2. activer `irve-fr`, `schools-fr`, `delinquance-fr`
  3. V-FRANCE, ne toucher à aucun panneau
- **Preuve :** capture `docs/ui-review/captures/ui-doctrine-snat-france-panelsclosed.webp` ;
  `dataPanelCollapsed = true`, 38 nœuds de légende, `every(w===0 && h===0) === true`.
- **Pourquoi ça compte :** test D1 (« Sans ouvrir aucun panneau, l'utilisateur peut-il traduire une
  couleur en valeur ? ») → non. Et la doctrine anticipe l'échappatoire : « une légende repliée dans
  un panneau qui recouvre la carte n'est pas une légende ». Ici c'est vrai deux fois — repliée, et
  le panneau déplié recouvre la Bretagne (visible sur `docs/ui-review/captures/ui-doctrine-delinquance-thermal.webp`).

### [CASSE] A3 + D1 — Deux étiquettes « Rhône », deux nombres, aucune unité, aucune couche

- **Ce que j'ai vu :** même vue S-NAT. Les couches posent leurs étiquettes dans **le même style de
  pastille**, sans nom de couche ni unité : on lit côte à côte « Rhône · 8,63 » et « Rhône · 5 437 »,
  « Nord · 7 801 » et « Nord · 2 504 », « Gironde · 7 455 » et « Gironde · 1 416 »,
  « Bouches-du-Rhône · 6 623 » et « Bouches-du-Rhône · 1 817 ». Le premier de chaque paire est un
  **taux pour 1 000 habitants**, le second un **effectif de bornes ou d'établissements**.
  Et l'aplat sous ces étiquettes est la composition alpha de trois rampes (violette, verte, rouge).
- **Où :** overlay `#world-overlay-root` (peint sur canvas, pas de nœud DOM interrogeable).
- **Reproduction :** identique au constat D1 ci-dessus, regarder les pastilles.
- **Preuve :** capture `docs/ui-review/captures/ui-doctrine-snat-france-panelsclosed.webp`. Légendes relevées :
  `delinquance-fr` → « 0,000–5,36 / 1 000 habitants » … ; `irve-fr` → « 1–662 bornes » … ;
  `schools-fr` → « 1–294 établissements » ….
- **Pourquoi ça compte :** test A3 (« une variable qui apparaît deux fois est un défaut ») : ici la
  variable *remplissage* porte trois informations et la variable *pastille numérique* en porte
  trois aussi, dont deux de nature incompatible (taux et effectif). C'est exactement le régime que
  la doctrine appelle « du chiffre citable et faux ».

### [CASSE] F2 — La seule référence métrique du HUD est fausse d'un facteur 3,3 là où l'utilisateur regarde

- **Ce que j'ai vu :** à V-PARIS (alt 900 m, tangage −35°, cap 160°), le HUD affiche
  `GSD: 0.34m  NIIRS: 6.5`. J'ai mesuré la vraie emprise au sol par pas de 100 px avec
  `camera.pickEllipsoid` à trois hauteurs d'écran : **0,83 m/px en bas de l'image, 1,13 m/px au
  centre (le réticule), 1,53 m/px en haut**. La valeur affichée est donc fausse d'un facteur **3,3
  au point visé**, et la vraie valeur varie de **1,8×** à l'intérieur de la même image.
  Le HUD affiche `ONA: 55.0°` juste à côté sans en tenir compte : sur les quatre vues relevées,
  `GSD ≈ altitude / 2 666` quel que soit le tangage (12 000 km → 4 500 m ; 1 600 km → 600 m ;
  300 km → 112,50 m ; 855 m → 0,34 m).
- **Où :** `#hud-gsd`, `#hud-alt`, `#hud-summary` dans `#intel-hud`.
- **Reproduction :**
  1. `http://localhost:4290/?welcome=0`
  2. `cancelFlight()` puis `setView` V-PARIS (2.3364 / 48.86 / 900 m, pitch −35, heading 160)
  3. lire `#hud-gsd` en bas à droite
- **Preuve :** capture `docs/ui-review/captures/ui-doctrine-vparis-f1.webp` (`GSD: 0.34M NIIRS: 6.5`, `ALT: 851M`).
  Mesures : `[{yFrac:0.85, mPerPx:0.832}, {yFrac:0.5, mPerPx:1.133}, {yFrac:0.25, mPerPx:1.526}]`.
- **Pourquoi ça compte :** test F2 (« une référence métrique dont la validité est garantie au point
  où il regarde ») → non. La doctrine annonçait « un facteur 3 à 10 sans jamais le savoir » ; c'est
  3,3, et le NIIRS 6,5 qui en est dérivé annonce une qualité d'image que rien ne soutient. C'est
  précisément le cas « un shader qui affiche un chiffre » de la table des tensions.

### [CASSE] B1 — Deux couches peignent un effectif brut en aplat, sans le dire

- **Ce que j'ai vu :** légendes relevées dans le panneau —
  `irve-fr` : « 1–662 **bornes** », « 663–1 315 bornes », … « 3 836+ bornes » ;
  `schools-fr` : « 1–294 **établissements** », … « > 1079 établissements ».
  Ce sont des **effectifs bruts par département**, peints en aplat sur une maille dont l'aire varie
  d'un facteur ~10 (Paris 105 km², Gironde 10 000 km²). Aucune mention, nulle part dans la ligne de
  couche, que l'aire de la maille n'est pas neutralisée. Le méta d'`irve-fr` dit
  « 220 666 charge points · 96 départements · 820 outre-mer not mapped · zoom in for sites ».
  À l'inverse `delinquance-fr` classe « / 1 000 habitants » — un taux — et est conforme.
- **Où :** `#data-toggles [data-layer-id="irve-fr"] .data-toggle-legend-item` (idem `schools-fr`).
- **Reproduction :** activer `irve-fr`, déplier DATA LAYERS, lire les six paliers.
- **Preuve :** valeurs relevées ci-dessus ; pastilles `rgb(47,27,82)` → `rgb(235,169,239)`.
- **Pourquoi ça compte :** c'est la règle la plus martelée du corpus (« NOP !!!! », « l'une des
  erreurs sémiologiques les plus courantes du géoweb »). La nuance produit de B1 autorise l'aplat
  sur un effectif **à condition que ce soit écrit sur la carte** ; ici ce n'est écrit nulle part.
  La carte répond à « où y a-t-il beaucoup de bornes » en disant surtout « où y a-t-il beaucoup de
  monde ».

### [CASSE] B3 — Dans une seule classe, la couleur perçue varie plus que le pas entre deux classes

- **Ce que j'ai vu :** avec `delinquance-fr` seul, à 300 km au-dessus de la Gironde, j'ai
  échantillonné quatre points **tous dans le même département** — donc même classe, même couleur de
  remplissage. Pixels composités relevés :
  forêt landaise `133,92,72` (L = 0,1311) · vignoble médocain `130,90,70` (L = 0,1250) ·
  Bordeaux urbain `117,61,62` (L = 0,0747) · bassin d'Arcachon `180,199,203` (L = 0,5486).
  **Rapport de contraste WCAG entre deux points de la même classe, sur terre ferme : 1,45.**
  Le plus petit pas entre deux classes voisines de la légende de cette même couche : **1,35**.
- **Où :** canvas Cesium, `delinquance-fr` en `GroundPrimitive` sur fond OSM.
- **Reproduction :**
  1. activer `delinquance-fr` seul, caméra lon −0.75 / lat 44.75 / 300 km, pitch −90
  2. échantillonner (−0.75, 44.55), (−0.575, 44.84), (−0.85, 45.15)
- **Preuve :** capture `docs/ui-review/captures/ui-doctrine-b3-gironde.webp` ; luminances ci-dessus ; rampe de la couche
  L = 0,764 / 0,552 / 0,325 / 0,183 / 0,104 / 0,038, pas adjacents 1,35 · 1,61 · 1,61 · 1,51 · 1,75.
- **Pourquoi ça compte :** test B3 (« deux classes adjacentes restent-elles séparables sur trois
  fonds contrastés ? ») → non : le bruit de compositing à l'intérieur d'une classe absorbe le pas
  entre deux classes. Six paliers sont déclarés, moins de six sont perçus, et la doctrine demande
  explicitement de le **mesurer** plutôt que de le supposer.

### [CASSE] E1 — L'horodatage affiché est l'horloge du client, jamais celui des données

- **Ce que j'ai vu :** le HUD affiche `REC 2026-09-03 08:08:10Z` et `COLL: 08:08:11Z`. Relevé au
  même instant, `new Date().toISOString()` du navigateur = `2026-09-03T08:08:11.138Z` — c'est
  l'horloge du poste, pas l'instant représenté. Côté couche, le méta affiche « il y a 42 s » —
  l'âge du **fetch**, pas la date de la mesure. Sur `delinquance-fr`, qui est une statistique
  **annuelle** du SSMSI, le panneau affiche « à l'instant » et **le millésime n'apparaît nulle
  part**.
- **Où :** `#hud-timestamp`, `#hud-coll` (`#intel-hud`) ; `.data-toggle-meta` de chaque ligne.
- **Reproduction :** ouvrir l'app, comparer `#hud-timestamp` à l'heure système ; activer
  `delinquance-fr` et chercher l'année dans la ligne de couche.
- **Preuve :** `{hudTimestamp: "2026-09-03 08:08:10Z", hudColl: "COLL: 08:08:11Z",
  clientNow: "2026-09-03T08:08:11.138Z", rowMeta: "Délinquance enregistrée — SSMSI … · il y a 42 s"}`.
- **Pourquoi ça compte :** test E1 (« une capture d'écran suffit-elle à savoir de quand datent les
  données ? ») → non, et la doctrine nomme les deux substituts exacts qui sont ici employés :
  « pas l'heure locale du client ni un "il y a N secondes" indifférencié ». Une capture de la carte
  de la délinquance ne permet pas de savoir quelle année elle montre.

### [CASSE] A2 — Aucune couche mobile n'encode l'âge de la mesure dans le signe

- **Ce que j'ai vu :** en S-LIVE, parcours des collections de primitives.
  `ais-live-vessels` : 12 000 billboards, **`color.alpha` = 1,000 pour tous**, une seule couleur de
  billboard (blanc), trois échelles seulement (0,6 / 0,68 / 0,78), `translucencyByDistance = null`,
  `scaleByDistance = null`. `flights` : 933 billboards, `alpha` = 1,000 pour tous,
  deux couleurs (`255,255,255` et `255,184,0`), `translucencyByDistance = null`.
  Le glyph navire est un SVG figé : `fill="#39d5ff"` etc. — la teinte code la **catégorie**, pas
  l'ancienneté.
- **Où :** `viewer.scene.primitives` → `root/2` (navires), `root/3` (vols).
- **Reproduction :** activer `flights` + `ais-live-vessels`, V-GLOBE, parcourir les
  `BillboardCollection` et lister les `color.alpha` distincts.
- **Preuve :** `alphas: [1]` sur les deux collections ; `tbd: ["none"]` ;
  `rgb: ["255,255,255"]` (navires) et `["255,255,255","255,184,0"]` (vols).
- **Pourquoi ça compte :** test A2 (« un objet vu il y a 5 s et un objet vu il y a 3 min sont-ils
  graphiquement différents sans ouvrir de panneau ? ») → non, ils sont au pixel près identiques.
  Or ces mobiles glissent par navigation à l'estime entre deux polls : le rendu fabrique de la
  position 59 images sur 60 et rien ne le signale. La doctrine note que c'est « l'encodage le moins
  coûteux qui soit » puisque l'attribut couleur est déjà dans le batch — il est ici inutilisé.

### [CASSE] D3 — Le « non diffusé » est une teinte, et elle est moins séparable que deux classes voisines

- **Ce que j'ai vu :** `delinquance-fr` déclare une septième entrée de légende, « Non diffusé —
  secret statistique (national) », avec la pastille `rgb(92,107,138)` — un bleu ardoise.
  Sa luminance (**L = 0,1463**) tombe **entre** la classe 4 (0,1827) et la classe 5 (0,1037).
  Rapport de contraste avec la classe 4 : **1,185** — inférieur au plus petit pas entre deux classes
  voisines de la rampe (**1,35**).
- **Où :** `#data-toggles [data-layer-id="delinquance-fr"] .data-toggle-legend-swatch`.
- **Reproduction :** activer `delinquance-fr`, déplier DATA LAYERS, relever la 7ᵉ pastille.
- **Preuve :** luminances et rapports ci-dessus, calculés depuis les `rgb()` relevés.
- **Pourquoi ça compte :** test D3 (« la maille sans donnée est-elle distinguable de la classe la
  plus haute ? Et le reste-t-elle sous chaque mode capteur ? ») → une teinte pure ne survit ni au
  compositing (constat B3) ni au niveau de gris de FLIR (constat F5), où elle atterrit au milieu de
  la rampe. La doctrine demande un **motif** exactement pour cette raison.

### [FRICTION] G1 / G2 — Le maillon « filter » est absent, et G2 devient sans objet

- **Ce que j'ai vu :** inventaire de **tous** les `input[type=range|checkbox|search|text]` et
  `select` du document, panneau déplié : 60 contrôles, dont **zéro** rattaché à une couche
  (`el.closest('[data-layer-id]')` = `null` partout). Ce sont tous des réglages d'affichage :
  `cockpit-radio-volume`, `hud-layout-select`, `detection-density-slider`, `detection-fade-slider`,
  `detection-opacity-slider`, `bloom-intensity-slider`, `scope-feather-slider`.
  `#param-slider-panel` mesure **0 px de haut** et n'affiche que « PARAMETERS − ».
  Les seuls contrôles par couche trouvés sont les six chips d'indicateur de `delinquance-fr`
  (Escroqueries / Dégradations / Vols sans violence / …) : ils **changent la variable cartographiée**,
  ils ne réduisent pas la population.
- **Où :** `#data-toggles`, `#param-slider-panel`, `#right-context-rail`.
- **Reproduction :** ouvrir l'app, déplier DATA LAYERS, chercher un curseur ou un champ de
  recherche attaché à une couche.
- **Preuve :** liste des 60 contrôles relevée dans `docs/ui-review/sondes/ui-doctrine-probe8.json` (`filters`) ;
  `paramPanel = {text: "PARAMETERS −", h: 0}`.
- **Pourquoi ça compte :** test G1 (« l'utilisateur peut-il réduire une couche à un sous-ensemble
  sans la couper ? ») → non. La doctrine désigne le filtre comme « le composant le plus rentable
  que le corpus désigne » ; avec 12 000 navires et 7 100 vols simultanés, c'est le seul geste qui
  rendrait le semis interrogeable. Conséquence méthodologique : **le test G2 (P0) est vide** — il
  n'y a aucun chemin de filtre à surveiller pour un `removeAll()`.

### [FRICTION] F1 — Rien n'est occulté, et rien ne distingue « je vois » de « je devine »

- **Ce que j'ai vu :** `scene.globe.depthTestAgainstTerrain === false`, et
  `disableDepthTestDistance === Number.POSITIVE_INFINITY` sur **la totalité** des 12 933 billboards
  vivants (12 000 navires + 933 vols). Aucun symbole n'est donc testé en profondeur, ni contre le
  terrain, ni contre le bâti — et aucun n'est marqué comme deviné (contour pointillé, alpha réduit,
  fantôme). **Point positif à porter au crédit du produit :** le test d'horizon ellipsoïdal, lui,
  est bien fait — sur 12 933 symboles à V-GLOBE, **0** objet situé sur la face opposée du globe
  n'est rendu.
- **Où :** `viewer.scene.globe`, collections `root/2` et `root/3`.
- **Reproduction :** activer `flights` + `ais-live-vessels`, lire
  `scene.globe.depthTestAgainstTerrain` et le `disableDepthTestDistance` des billboards.
- **Preuve :** `{depthTestAgainstTerrain: false}` ; `ddt: ["Infinity"]` sur les deux collections ;
  `farSide: {root/2: {n: 12000, farSideVisible: 0}, root/3: {n: 933, farSideVisible: 0}}`.
- **Pourquoi ça compte :** test F1 → le régime (a) « occulté » n'est utilisé par aucune couche, le
  régime (b) est acquis, le régime (c) existe de fait mais **sans son marquage**, ce que la doctrine
  interdit en toutes lettres : « jamais le même signe pour "je vois" et "je devine" ».

### [FRICTION] F3 — Hors cockpit, rien ne dit où est le nord

- **Ce que j'ai vu :** à V-PARIS (cap 160°), le seul repère d'orientation à l'écran est le fond OSM
  dont **les libellés sont à l'envers** (« Quartier latin », « Odéon », « Saint-Michel » retournés).
  `#cockpit-hud` est en `display: none`. Balayage de tout le DOM visible pour un token
  `N|NORD|NORTH|HDG|CAP|HEADING` : une seule occurrence, `#hud-latlon`
  (`48°51'36.00"N 002°20'11.04"E`) — la lettre N d'une latitude, pas une rose des vents.
  `#hud-summary` donne secteur, altitude, fenêtre, soleil et ONA, **jamais le cap**.
- **Où :** `#intel-hud`, `#cockpit-hud`.
- **Reproduction :** V-PARIS (heading 160, pitch −35), chercher un indicateur de nord.
- **Preuve :** capture `docs/ui-review/captures/ui-doctrine-vparis-f1.webp` ; `northIndicators: [{sel: "hud-latlon", …}]` ;
  `hudSummary: "NORMAL STREET NEAR LOUVRE PYRAMID (PARIS) 0KM | EUROPE | ALT 855M | WINDOW 3x3KM |
  SUN 28° | ONA 55° | UTC+0"`.
- **Pourquoi ça compte :** test F3 → non. La doctrine note que c'est « le cas rare où le spectacle
  et la géomatique demandent exactement la même chose » : une bande de cap est à la fois de
  l'habillage cockpit et la restitution de ce que la 3D détruit.

### [QUESTION] B5 — Sept silhouettes d'aéronef, aucune n'est un signe « non classé »

- **Ce que j'ai vu :** décodage des SVG effectivement en vol : la couche `flights` utilise
  **7 silhouettes distinctes** (bimoteur générique, régional, gros-porteur, hélicoptère à rotor
  circulaire, quadriréacteur, turbopropulseur, très gros-porteur) et une échelle de 0,496 à 1,45.
  Aucune n'est un signe neutre. **622 des 933 appareils (67 %) partagent la même silhouette à
  l'échelle 1,0.** La ligne de couche affichait par ailleurs le badge `FALLBACK` — donc le produit
  *sait* nommer un repli quand il en a un.
- **Où :** collection `root/3`, `billboard.image` (data-URI SVG).
- **Reproduction :** activer `flights`, décoder les `image` distinctes des billboards.
- **Preuve :** 7 SVG relevés (`<path d="M0,-42 C 3.8,-40 …"` etc.), comptes
  622 / 132 / 82 / 38 / 3 / 1 / 1, échelles 1 / 0,62 / 1,3 / 0,82 / 0,72 / 0,86 / 1,45.
- **Pourquoi ça compte :** test B5 (« le jeu de formes contient-il un signe explicite pour "non
  classé" ? ») → non. Je **ne peux pas prouver depuis l'interface** que la silhouette dominante est
  un repli plutôt qu'une classe réellement majoritaire (les monocouloirs *sont* majoritaires en
  Europe) — d'où la gravité QUESTION. Mais la doctrine demande le signe « inconnu » quel que soit le
  taux de repli, et il n'existe pas.

---

## Ce qui passe, et qu'il faut écrire

### [C1 — PASS] Les seuils de discrétisation ne dépendent pas du cadrage

Test exécuté mot pour mot : cadrage France entière (V-FRANCE, 1 600 km) → captures et relevé de
légende ; puis cadrage Bretagne seule (lon −2.9 / lat 48.1 / 260 km) → même relevé.
Les trois légendes reviennent **identiques au caractère près** :
`irve-fr` « 1–662 / 663–1 315 / 1 316–1 874 / 1 875–2 398 / 2 399–3 835 / 3 836+ »,
`schools-fr` « 1–294 / 295–433 / 434–589 / 590–719 / 720–1079 / > 1079 »,
`delinquance-fr` « 0,000–5,36 / … / > 6,89 ». Aucune couleur n'est recalculée depuis l'échantillon
visible. C'est la règle que la doctrine décrit comme « celle que la 2D ne pouvait pas formuler », et
GEV la tient. Preuve : `c1_wideLegend` ≡ `c1_narrowLegend` dans `docs/ui-review/sondes/ui-doctrine-probe2.json`.

### [B2 — PASS] La hiérarchie des tailles n'est pas inversée par la profondeur

Test exécuté : vue oblique à 700 km, tangage −55°, 266 glyphes d'aéronef simultanément à l'écran.
Sur **19 644 paires** de valeurs de base différentes, **0 inversion** : aucun couple où le gros
porteur rend plus petit que le petit appareil. Raison mesurée : le `scaleByDistance` va de
`1 000 m → ×3,0` à `8 000 000 m → ×0,5` de façon linéaire, donc il est quasi plat sur toute plage de
distances co-visibles réaliste (entre 5 km et 300 km, le facteur ne varie que de 3 %). Il se comporte
en atténuation globale d'altitude, pas en facteur 1/z par objet. Les navires n'ont **aucun**
`scaleByDistance` : leur taille est constante en pixels. Preuve : `docs/ui-review/sondes/ui-doctrine-probe7.json`,
`base range 0.496–1.45`, `inversions 0/19644`, capture `docs/ui-review/captures/ui-doctrine-b2-oblique.webp`.

### [B4 — PASS] La rampe ordonne en valeur, pas seulement en teinte

Conversion en niveaux de gris de la rampe `delinquance-fr` : L = 0,764 → 0,552 → 0,325 → 0,183 →
0,104 → 0,038. Strictement monotone, l'ordre survit. (Le défaut est ailleurs : la 7ᵉ entrée
« non diffusé », L = 0,146, s'intercale — voir le constat D3.)

### [A5 / H1 — PASS partiel, et c'est le patron à généraliser]

`irve-fr` : « 220 666 charge points · 96 départements · 820 outre-mer not mapped · zoom in for sites ».
`schools-fr` : « 65 396 établissements sur 96 départements · 2 762 hors métropole non cartographiés ·
**IPS publié pour 40 529 des 62 857 établissements concernés** ». Cette dernière phrase est
exactement H1 (« savoir ce que la donnée ne contient pas ») appliquée à un attribut, et c'est le
meilleur libellé de tout le produit. `flights` affiche `FALLBACK · adsb.lol · 250nm regional
fallback` — la couverture dégradée est nommée. En regard, `delinquance-fr` n'annonce ni millésime,
ni périmètre, ni taux de non-diffusion effectif.

---

## Hors lentille

- À V-GLOBE en S-LIVE, les pastilles d'étiquette se recouvrent massivement (une trentaine
  s'empilent sur l'Europe de l'Ouest) — `docs/ui-review/captures/ui-doctrine-slive-globe.webp`.
- Une exception applicative est levée par `Scene.render()` déclenché juste après un clic de
  sélection : `TypeError: Cannot read properties of undefined (reading 'updaters')` via
  `CesiumWidget._postRender` (cesium.js:242919). Reproductible en dispatchant un clic pointeur sur
  le canvas puis en pompant `scene.render()` dans le même tour.
- Le bandeau `VOICE SYSTEM ERROR — Check microphone permission and network access` est présent dans
  le DOM au démarrage, sans action utilisateur.
- Un clic sur un polygone de département (centre de l'écran, V-Gironde) n'ouvre aucune fiche : les
  couches zonales ne semblent pas offrir de « details on demand ».
- Deux lectures d'altitude ont divergé après un clic ayant déplacé la caméra (`ALT 700.0` dans
  `#hud-summary` contre `ALT: 16385m` dans `#hud-alt`) — non instruit.

---

## Ce que je n'ai PAS pu vérifier

- **Le serveur de dev 4290 est tombé** en cours de route (ERR_CONNECTION_REFUSED ; plus aucun
  processus vite pour `manila-v1`, seul celui du workspace `hamburg` sur 4173 subsiste). Il n'est pas
  revenu après ~20 min d'attente et je n'ai pas le droit d'en relancer un. La neuvième sonde n'a
  jamais tourné, ce qui laisse en suspens : la mesure en pixels du recouvrement carte/panneau pour
  D1, la grille de 25 points intra-Gironde qui aurait durci le constat B3, et le test F1 avec
  `bdtopo-buildings` réellement chargé.
- **D2** (deux utilisateurs, même lien de partage, même légende) : non testé, le bouton de partage
  n'a pas été atteint avant la panne.
- **G3** (orbite sans changer d'altitude, les compteurs d'agrégat bougent-ils ?) : aucune couche
  agrégée n'a été ouverte.
- **F1, volet bâti** : `bdtopo-buildings` n'a rien rendu à V-PARIS après 20 s d'attente, et les
  tuiles Google 3D sont bloquées (piège connu). Le constat F1 repose donc sur les valeurs de
  `depthTestAgainstTerrain` et `disableDepthTestDistance`, pas sur une capture montrant un symbole
  traverser un immeuble.
- **A1 au niveau du champ** : le clic sur un aéronef a déplacé la caméra sans que je capture de
  fiche d'entité ; je n'ai donc pas pu inventorier les champs d'une fiche à la recherche de valeurs
  de repli. Le constat A1 reste au niveau de la couche.
- **Non traitées** : A6 (millésime du fond de plan), C3 (maille équi-aire), C4 (agrégation des
  taux), E2/E3/E4 (régimes temporels, fenêtre, horloges), F4 (teinte drapée sur les façades),
  F6 (plages d'altitude déclarées), G4 (cluster/carroyage/heatmap), H2 (complétude OSM),
  H3 (volumétrie et transport).
