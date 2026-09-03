# États & micro-interactions — rapport

## Ce que j'ai fait
Ouvert `#data-panel`, `#scene-panel`, `#control-panel`, `#radio-panel`, le mode
`clean view` et les lignes de couche (`satellites`, `earthquakes`, `flights`,
`schools-fr`, `irve-fr`) sur `http://localhost:4290/?welcome=0`, aux vues
V-FRANCE et V-GLOBE, scénarios S-VIDE et S-LIVE.
Outillage : 6 harnais Puppeteer maison (`/tmp/ui-etats/*.mjs`) qui (a) moissonnent
la CSSOM pour recenser les règles `:hover / :focus-visible / :active / :disabled`
qui matchent réellement chaque contrôle visible, (b) dispatchent de vrais
événements souris CDP et comparent le style calculé avant/après, (c) chronomètrent
au `performance.now()` en page avec `MutationObserver` + `PerformanceObserver`,
(d) coupent le réseau d'une couche par interception pour forcer l'état d'erreur.
Journaux bruts : `docs/ui-review/sondes/ui-etats-cssom.json`, `dyn.ndjson`, `a4.ndjson`,
`feedback.log`.

## Constats

### [CASSE] Le contrôle le plus utilisé du produit supprime son anneau de focus et ne le remplace par rien
- **Ce que j'ai vu :** `.data-toggle-btn` — le bouton ON/OFF des 57 lignes de
  couche — déclare `outline: none` et aucune règle `:focus` ou `:focus-visible`
  du produit ne le vise. Un utilisateur au clavier n'a strictement aucun signe
  de l'endroit où il se trouve dans la liste. Ce n'est pas un oubli global :
  dans la **même ligne**, la puce `.data-toggle-chip` coupe elle aussi l'outline
  (`style.css:6053`) mais fournit un remplaçant (`style.css:6056-6057`), et
  l'en-tête de catégorie juste au-dessus en a un aussi
  (`style.css:4527-4528`).
- **Où :** `#data-toggles .data-toggle-btn` — `style.css:5958-5972`
  (`outline: none` en `style.css:5969`) ; seule autre règle d'état :
  `.data-toggle-btn:hover` en `style.css:5983`.
- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0`.
  2. Déplier `#data-panel` (bouton `.panel-collapse-btn`).
  3. Tabuler jusqu'à un bouton de couche (« Vols en direct : OFF »).
  4. Rien ne change à l'écran. Tabuler encore : rien ne change davantage.
- **Preuve :** relevé exhaustif sur `style.css` (9 434 lignes) —
  `grep -n "data-toggle-btn" style.css | grep -E ":hover|:focus|:active"` ne
  renvoie **qu'une** ligne, `5983:.data-toggle-btn:hover`. Aucune règle de repli
  générique n'existe : il n'y a **aucun** sélecteur `button:focus-visible`,
  `*:focus-visible` ni `:where(...)` dans la feuille. Confirmé côté runtime :
  `docs/ui-review/sondes/ui-etats-cssom.json`, champ `focusVisible: []` pour ce contrôle.
- **Pourquoi ça compte, vu de ma lentille :** sur quatre états attendus (repos,
  survol, focus, pressé) ce bouton en rend **un**. Et la suppression est active
  (`outline: none`), pas passive : quelqu'un a retiré l'indicateur par défaut du
  navigateur sans en poser un.

### [INCOHÉRENCE] Un seul sens, dix-huit règles, huit opacités et trois curseurs : « désactivé » ne veut pas dire la même chose selon le panneau
- **Ce que j'ai vu :** l'état désactivé est réécrit dans chaque panneau. Trois
  familles utilisent `cursor: wait` — qui se lit « ça charge » — et cinq
  `cursor: not-allowed` — qui se lit « c'est interdit » — pour le **même**
  attribut DOM `disabled`. Deux règles ne baissent même pas l'opacité.
- **Où :** `style.css`, recensement complet :

  | ligne | sélecteur | opacité | curseur |
  |---|---|---|---|
  | 207 | `#celestial-toggle:disabled` | 0.42 | not-allowed |
  | 1162 | `.gev-quantitative-slider:disabled` | .42 | not-allowed |
  | 1313 | `.map-stack-chip[aria-disabled='true']` | — | not-allowed |
  | 1917 | `#top-center-actions button:disabled` | 0.55 | **wait** |
  | 3105 | `.cockpit-context-actions button:disabled` | — | default |
  | 3458 | `.cockpit-radio-transport button:disabled` | .38 | not-allowed |
  | 5068 | `#space-mission-panel .mission-replay-transport button:disabled` | .28 | default |
  | 5096 | `#space-mission-panel .mission-nav-button:disabled` | .28 | not-allowed |
  | 5296 | `.context-radio-toggle:disabled` | .5 | **wait** |
  | 5382 | `.context-radio-mini-transport button:disabled` | .38 | not-allowed |
  | 5472 | `.context-mode-button:disabled` | .55 | **wait** |
  | 5523 | `.panel-layer-toggle:disabled` | 0.45 | **wait** |
  | 5776 | `.radio-transport button:disabled, #radio-filter:disabled` | .42 | not-allowed |
  | 5835 | `.military-awareness-controls button:disabled` | — | default |
  | 6071 | `.data-toggle-chip:disabled` | **0.7** | **wait** |
  | 6258 | `#cctv-panel input/button/select:disabled` | 0.45 | — |
  | 6277 | `#cctv-camera-select:disabled` | 0.45 | — |
  | 6864 | `.scene-btn:disabled` | 0.45 | default |

- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0`.
  2. Déplier `#scene-panel` : `#scene-stop-btn` (STOP) est désactivé.
  3. Déplier `#radio-panel` : `#radio-play-btn` est désactivé.
  4. Comparer : opacité 0.45 / curseur `default` d'un côté, opacité 0.42 /
     curseur `not-allowed` de l'autre.
- **Preuve :** styles calculés relevés en page —
  `#scene-stop-btn` → `opacity: "0.45"`, `cursor: "default"` ;
  `#radio-play-btn` → `opacity: "0.42"`, `cursor: "not-allowed"`
  (`docs/ui-review/sondes/ui-etats-cssom.json`, bloc `disabled controls`). Le tableau ci-dessus
  est extrait de `style.css` par balayage de bloc.
- **Pourquoi ça compte, vu de ma lentille :** huit opacités pour un seul sens,
  ce n'est plus un état, c'est un dialecte par panneau. Et `wait` contre
  `not-allowed` n'est pas une nuance de goût : l'un promet que ça va revenir,
  l'autre dit non.

### [INCOHÉRENCE] L'état pressé n'existe pas : 3 sélecteurs `:active` contre 69 `:hover`
- **Ce que j'ai vu :** la feuille de style du produit contient **exactement 3**
  sélecteurs `:active`, contre 69 `:hover` et 40 `:focus-visible`. Sur les 42
  contrôles visibles que j'ai échantillonnés, 39 n'ont aucune règle `:active` —
  y compris tous les `.data-toggle-btn`, tous les `.data-toggle-chip`, tous les
  `.scene-btn`, tout le transport radio et toutes les puces `map-stack`.
- **Où :** `style.css`. Les trois seules règles pressées :
  `#top-center-actions button:active`, `.style-btn:active`,
  `.panel-drag-handle:active`. (La CSSOM en compte 9 au runtime : les 6 autres
  appartiennent à la feuille de widgets embarquée de Cesium, pas à GEV.)
- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0`, déplier `#data-panel`.
  2. Presser et maintenir la souris sur un bouton de couche : aucun changement
     visuel jusqu'au relâchement.
  3. Presser et maintenir `#share-btn` en haut : celui-là s'enfonce.
- **Preuve :** comptage sur la feuille —
  `:hover` 69, `:focus-visible` 40, `:active` **3**. Vérifié en page par
  moisson CSSOM (`docs/ui-review/sondes/ui-etats-cssom.json` : `activeSelectors`, 9 entrées dont
  6 en `.cesium-*`) et par dispatch réel : `activeDelta: null` sur
  `.data-toggle-btn`, `.data-toggle-chip`, `.scene-btn`.
- **Pourquoi ça compte, vu de ma lentille :** le produit soigne le survol
  (69 règles) et ignore l'accusé de réception du geste. Sur une console dont
  certaines actions mettent 30 secondes à répondre, c'est précisément l'état
  qu'il fallait ne pas sauter.

### [FRICTION] Une opération de 31 secondes annoncée par 0,2 point d'alpha
- **Ce que j'ai vu :** la ligne `satellites`, une fois allumée, expose une puce
  « DENSE ». Un clic dessus fait passer le catalogue de **834 à 11 600**
  objets. L'opération dure **31,3 s** chronométrées. Pendant tout ce temps, le
  seul signe à l'écran est le passage de la puce de `chip-idle` à `chip-loading`,
  soit : couleur de texte `rgba(232, 234, 237, 0.3)` → `rgba(232, 234, 237, 0.5)`
  et bordure `rgba(255, 255, 255, 0.08)` → `rgba(255, 255, 255, 0.18)`. Même
  fond, même taille, **`animation-name: none`** — pas de spinner, pas de
  progression, pas de compte partiel. Le compteur de la ligne continue
  d'afficher `834`.
- **Où :** puce `.data-toggle-chip.chip-loading` dans
  `#data-toggles [data-layer-id="satellites"] .data-toggle-controls` —
  `style.css:6042` (base) et `style.css:6076-6079` (`chip-loading`).
- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0`, déplier `#data-panel`.
  2. Allumer « Satellites » ; attendre l'affichage de `834 ON`.
  3. Cliquer sur la puce « DENSE » et chronométrer jusqu'à ce que le compteur
     change.
- **Preuve :** `docs/ui-review/sondes/ui-etats-dyn.ndjson`, entrée `G1-chip-click` —
  `{"t":5535,"cls":"data-toggle-chip chip-loading","count":"834"}` puis
  `{"t":31278,"cls":"data-toggle-chip chip-active active","count":"11.6K"}`.
  Styles calculés des quatre états de puce : `docs/ui-review/sondes/ui-etats-a4.ndjson`, entrée
  `chip-states`. (Chrome headless SwiftShader ; sur GPU réel la durée sera plus
  courte, l'absence d'indicateur ne changera pas.)
- **Pourquoi ça compte, vu de ma lentille :** entre le clic et le résultat il y
  a une demi-minute pendant laquelle l'écran répond « peut-être ». Deux points
  d'alpha sur un gris, ce n'est pas un état de chargement, c'est un état de
  chargement que personne ne verra.

### [INCOHÉRENCE] Cinq états de flux, quatre couleurs : `LOADING` porte le cyan de `ON`
- **Ce que j'ai vu :** le bouton de couche a un vocabulaire d'états riche
  (`nominal`, `loading`, `degraded`, `stale`, `fallback`, `unavailable`) et un
  code couleur qui n'en couvre que quatre. `stale` et `fallback` partagent
  l'ambre ; `loading` n'a **aucune** règle de couleur et retombe donc sur le
  cyan de `.data-toggle-btn.active`, exactement la teinte du succès. Seul le mot
  change (`ON` → `LOADING`), à 9 px et 1,5 px d'interlettrage.
- **Où :** `style.css` — `.data-toggle-btn.active` (5988, cyan `--accent`),
  `.active.feed-stale, .active.feed-fallback` (5995, `#ffd27a`),
  `.active.feed-degraded` (6003, `#ffad72`), `.active.feed-unavailable`
  (6010, `#ff8585`). `feed-loading` n'apparaît **qu'une seule fois** dans toute
  la feuille, `style.css:5974`, dans un groupe qui ne règle que `min-width` et
  `letter-spacing`. Étiquettes : `src/data/manager.js:13-20`.
- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0`, déplier `#data-panel`.
  2. Allumer une couche qui se rafraîchit (« Vols en direct »).
  3. Comparer la pastille pendant un rafraîchissement et une fois posée : même
     cyan, même fond, même halo.
- **Preuve :** `grep -n "feed-loading" style.css` → une seule occurrence,
  ligne 5974 (bloc `min-width: 82px; letter-spacing: 0.8px;`).
- **Pourquoi ça compte, vu de ma lentille :** c'est la règle A4 sur le bouton
  lui-même. « en train de charger » et « chargé et nominal » rendent le même
  écran, alors que le produit a déjà payé pour trois autres couleurs d'état.

### [FRICTION] G1 — le seul contrôle de sous-ensemble va dans l'autre sens, et la légende qui énumère les sous-ensembles n'est pas cliquable
- **Ce que j'ai vu :** sur les 57 couches, la seule ligne qui offre un contrôle
  de sous-ensemble atteignable est `satellites`, avec une unique puce « DENSE »
  — qui **agrandit** le jeu (834 → 11,6 K) au lieu de le réduire. Juste à côté,
  la même ligne énumère quatre sous-ensembles avec leur effectif —
  `STATION 21 · NAV 92 · GEO 567 · VISUAL 154` — et aucun n'est atteignable :
  ce sont des `<span>` sans écouteur, sans `tabindex`, sans `role`.
- **Où :** `#data-toggles [data-layer-id="satellites"] .data-toggle-legend-item` ;
  construction en `src/data/manager.js:2444-2466`
  (`const entry = document.createElement('span')`, aucun gestionnaire attaché).
- **Reproduction :**
  1. Ouvrir `http://localhost:4290/?welcome=0`, déplier `#data-panel`.
  2. Allumer « Satellites ». La ligne affiche
     `🛰️ Satellites 834 ON CelesTrak · à l'instant DENSE STATION 21 NAV 92 GEO 567 VISUAL 154`.
  3. Essayer de cliquer sur « GEO 567 » pour ne garder que les géostationnaires :
     rien.
- **Preuve :** `docs/ui-review/sondes/ui-etats-dyn.ndjson`, entrée `G1-chips-before` — un seul
  élément dans `chips` (`{"id":"catalog","label":"DENSE"}`), les quatre
  catégories étant dans le texte de ligne et non dans le DOM interactif ;
  code source `src/data/manager.js:2444-2466`.
- **Pourquoi ça compte, vu de ma lentille :** le test G1 demande si
  l'utilisateur peut réduire une couche à un sous-ensemble sans la couper.
  Ici l'interface **affiche** les quatre sous-ensembles, avec leurs effectifs,
  et n'en laisse isoler aucun. Le maillon manquant du mantra n'est pas absent
  par oubli : il est nommé à l'écran et rendu inerte.

### [QUESTION] [NON REPRODUIT] Le résumé du HUD rend la même ligne pour « pas configuré », « échec réseau » et « pas encore calculé »
- **Ce que j'ai vu :** le chemin d'erreur du résumé HUD appelle
  `this._setSummaryText(fallbackText, animate)` — la même ligne de repli — pour
  la clé absente, pour l'échec de `fetch`, et pour l'état initial. Aucun marqueur
  ne distingue les trois. Je n'ai pas pu confirmer visuellement : ma seule
  capture attrape l'animation en cours (`SUMMARY / NO`), pas l'état stable.
- **Où :** `src/hud.js:660` et `src/hud.js:704`, `#hud-summary`.
- **Reproduction :** 1. Ouvrir l'app sans `OPENAI_API_KEY`. 2. Lire la ligne
  `SUMMARY` du HUD. 3. Comparer avec l'app clé posée — je n'ai pas pu faire (3).
- **Preuve :** code — les deux branches `catch` de `_requestSummary` terminent
  toutes deux sur `this._setSummaryText(fallbackText, animate)` ; capture
  ambiguë `docs/ui-review/captures/ui-etats-cleanview-on.webp` (bloc `SUMMARY / NO`, en cours de
  frappe).
- **Pourquoi ça compte, vu de ma lentille :** c'est le troisième vide de la
  règle A4, sur une surface où l'opérateur n'a aucun moyen de savoir si le
  silence est un choix ou une panne.

## Ce que j'ai vérifié et qui va bien (pas des constats)
- **Le retour au clic est immédiat**, contrairement à ce que suggérait un premier
  chronométrage : `MutationObserver` posé avant le clic sur « Séismes (24 h) »
  donne `firstDomMutationMs: 1` et `clickHandlerBlockMs: 0.6`. La ligne passe
  à `transitioning enabling` / `— ENABLING` dans la milliseconde
  (`docs/ui-review/sondes/ui-etats-dyn.ndjson`, `jank-on-toggle`). Mes premiers 1 360 ms étaient
  de la famine de `setTimeout`, pas du temps mort produit.
- **L'état d'erreur d'une couche est bien distinct du chargement.** Réseau coupé
  par interception sur `schools-fr` : la pastille passe de
  `data-toggle-btn` à `data-toggle-btn active feed-unavailable`, texte
  `rgb(255,133,133)`, bordure `rgba(255,92,92,0.78)`, fond `rgba(255,60,60,0.1)`
  en ~1,5 s (`docs/ui-review/sondes/ui-etats-a4.ndjson`, `A4-after-*`). Sur les trois vides d'A4,
  « en erreur » est traité ; c'est « en cours » qui se confond avec « chargé »
  (constat ci-dessus).
- **Le mode clean view est réversible.** 76 contrôles visibles → 1 en clean view
  (uniquement `#clean-view-exit`, chip `EXIT CLEAN VIEW` de 147 × 31 px posée à
  x=647 y=18) → 76 après un clic souris réel dessus
  (`docs/ui-review/sondes/ui-etats-a4.ndjson`, `cv-0` / `cv-on` / `cv-exit-mouse` ; captures
  `docs/ui-review/captures/ui-etats-cleanview-on.webp` et `docs/ui-review/captures/ui-etats-cleanview-after-exit.webp`).
- **Les indicateurs de fraîcheur (règle A2) sont homogènes** d'une ligne à
  l'autre : même position (fin de la ligne de méta), même format relatif —
  `USGS · à l'instant`, `OpenSky Network · il y a 11 s`, `MENJ · jamais`.

## Hors lentille
- Le globe se rend en disque **blanc uni** sur la capture V-FRANCE en clean view
  (`docs/ui-review/captures/ui-etats-cleanview-on.webp`) : aucune imagerie ne s'affiche, seul le HUD
  est lisible. À voir par la lentille cartographie / représentation.
- `#data-toggles .data-toggle-btn` n'expose pas `aria-pressed` (relevé
  `pressed: null` sur toutes les lignes échantillonnées) alors que
  `.data-toggle-chip` l'expose. Pour la lentille accessibilité.
- `dataManager.getEnabledLayerIds()` renvoie `{}` (objet vide) alors que la
  couche est allumée et peinte — l'API d'introspection documentée dans le
  briefing ne reflète pas l'état.

## Ce que je n'ai PAS pu vérifier
- **Le serveur de dev du port 4290 est tombé en cours de revue** (vers 09:30,
  `ERR_CONNECTION_REFUSED`, plus aucun process vite pour `manila-v1` ; les
  autres workspaces tournaient toujours). Je n'ai pas pu le relancer (règle de
  lecture seule) et trois mesures prévues sont restées en plan : la matrice de
  couleurs des états de flux mesurée en page (je la donne depuis `style.css`),
  la sortie de clean view **au clavier** (Entrée sur `#clean-view-exit`, Échap
  en clean view), et les captures de preuve du panneau de données.
- **Règle G2 (le filtre ne doit pas figer le globe) : non concluante.** Mesurée
  sur `#detection-density-slider`, 41 crans : temps de frame moyen **704 ms**
  pendant le tirage contre **867 ms** au repos, max 1 967 ms — mais la ligne de
  base au repos est déjà catastrophique parce que le rendu headless passe par
  SwiftShader et que la scène est en `requestRenderMode`. Le tirage n'est donc
  pas mesurablement pire que l'inactivité, et je ne peux rien conclure sans un
  GPU réel. `docs/ui-review/sondes/ui-etats-dyn.ndjson`, entrée `G2-slider`.
- **Règle A5 (tout écrêtage se déclare) : non testée.** Je n'ai pas identifié
  de couche visiblement plafonnée pendant la session, et le serveur est tombé
  avant que je puisse en chercher une.
- **Surfaces laissées de côté :** le panneau CCTV (`#cctv-panel`) au-delà de
  l'inventaire de ses contrôles, la fiche d'entité (clic sur un objet du globe),
  le lien de partage, `#param-slider-panel` au-delà du curseur de densité, et
  le sélecteur de fond de carte `#map-stack-chips` — dont les puces portent un
  `aria-disabled` stylé (`style.css:1313`) que je n'ai pas pu déclencher.
- **Le premier balayage exhaustif des 76 contrôles a échoué** : le panneau de
  données se reconstruit à chaque rafraîchissement et efface les marqueurs
  `data-*` que le harnais y pose ; j'ai rabattu sur un échantillon de 42
  contrôles stables + une moisson CSSOM. Les contrôles des panneaux qui ne
  s'ouvrent pas sans données (CCTV, missions spatiales) ne sont pas dans le
  recensement.
