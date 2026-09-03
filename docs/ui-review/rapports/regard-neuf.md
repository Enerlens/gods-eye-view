# Regard neuf — rapport

## Ce que j'ai fait

Ouvert `http://localhost:4290/?welcome=0` dans un Chromium Puppeteer persistant
(1600×1000), et joué trois tâches de visiteur sans documentation : trouver ma
ville, comprendre une couleur, partager ce que je vois. Surfaces ouvertes :
HUD, `#data-panel` (57 couches), barre `LOCATION`, `VISUAL PRESETS` + `MAP
SOURCE`, rail droit `DISPLAY`/`CCTV`/`CONTEXT`, fiche d'entité (clic sur un
département), bouton de partage. Vues V-GLOBE, V-FRANCE ; scénarios S-VIDE et
une couche nationale à aplat (`delinquance-fr`). Outillage : `/tmp/ui-regard-neuf-*.mjs`,
captures `/tmp/ui-regard-neuf-*.png`.

## Ce que j'ai cru voir dans les dix premières secondes

Écrit **avant** d'explorer, sur la seule capture d'accueil
(`docs/ui-review/captures/ui-regard-neuf-01-landing.webp`) :

> « Un simulateur de vue satellite espion. Un hublot rond sur un plan de rue de
> Paris, entouré de faux marquages militaires : TOP SECRET // SI-TK // NOFORN,
> KH11-4120 OPS-4158, REC ●, ORB: 47320, MGRS, GSD 0.22m, NIIRS 7.1. Je dirais
> une démo cinématique ou un jouet, pas un outil. Je ne vois aucune donnée, ni
> aucun sujet. »

**J'avais tort.** C'est une console de 57 couches de données publiques,
majoritairement françaises (INSEE, RTE, IGN, Météo-France, SSMSI…). Je ne l'ai
appris qu'en dépliant `DATA LAYERS`, c'est-à-dire après avoir cliqué un `+` que
j'avais lu comme « ajouter une couche ». Sur l'écran d'accueil, aucun des 47
nœuds de texte visibles (relevé DOM complet, étape s1) ne nomme un jeu de
données, une institution, la France, ni un usage. Le théâtre occupe 100 % des
dix premières secondes ; le produit, 0 %.

## Constats

### [CASSE] La seule phrase en langage clair de l'écran est coupée à mi-course

- **Ce que j'ai vu :** en haut à gauche, sous `SUMMARY`, la seule ligne qui
  ressemble à une phrase — celle sur laquelle je me rabats quand tout le reste
  est du sigle. Elle s'arrête à « … | EUROPE | A ».
- **Où :** HUD, `#hud-summary` (`.hud-summary`).
- **Reproduction :** 1. ouvrir l'URL ; 2. poser la caméra sur V-FRANCE ;
  3. lire la ligne sous `SUMMARY`.
- **Preuve :** mesuré en page — texte réel
  `NORMAL GLOBAL SECTOR 46.60N 2.40E | EUROPE | ALT 1600.0KM | WINDOW 2178x1216KM | SUN 32° | ONA 0° | UTC+0`
  (105 caractères) ; largeur naturelle mesurée avec la police de l'élément
  (`canvas.measureText`) **693 px** ; `clientWidth` **420 px** ; `scrollWidth`
  **819 px** ; `white-space: nowrap`, `overflow: hidden`, aucun attribut
  `title`. Capture `docs/ui-review/captures/ui-regard-neuf-12-right-column-gone.webp` (ligne à
  59,245).
- **Pourquoi ça compte :** environ 40 % de la seule information rédigée est
  perdue, sans survol de secours. Le visiteur qui cherche « où suis-je et à
  quelle échelle » lit une demi-phrase.

### [CASSE] La fiche d'un département s'ouvre sous les panneaux et déborde de l'écran

- **Ce que j'ai vu :** avec la couche `Délinquance enregistrée` allumée, un clic
  sur un département ouvre un bandeau pleine largeur (y ≈ 275→430). Ses
  premières lignes — le nom du département et les chiffres — passent **sous**
  les en-têtes `DATA LAYERS` et `SCENES` ; sa ligne la plus longue est **coupée
  net au bord droit du viewport**, en plein mot : « …contre 74 % pour les
  victimes de camb ».
- **Où :** fiche d'entité, dessinée sur canvas (voir preuve), au-dessus du
  globe ; occultée par `#left-panel-stack` (x 52→412).
- **Reproduction :** 1. ouvrir l'URL ; 2. allumer `delinquance-fr` ;
  3. V-FRANCE ; 4. cliquer au centre d'un département (ici 900,470 → Nièvre).
- **Preuve :** captures `docs/ui-review/captures/ui-regard-neuf-07-dept-click.webp` (panneau
  ouvert : « Nièvr », « Escroc », « 6,69 pou », « 201 417 », « 248 de » sont
  amputés par le panneau) et `docs/ui-review/captures/ui-regard-neuf-08-card-no-panel.webp`
  (panneau replié : le bandeau va de x=0 au-delà de x=1600 et la phrase SSMSI
  est tronquée au bord). En prime, `document.body.innerText` ne contient ni
  « Nièvre » ni « SSMSI » (`innerHTML.length` inchangé, 167571 → 167572 après
  le clic) : la fiche est peinte sur un canvas, donc ni sélectionnable, ni
  copiable.
- **Pourquoi ça compte :** c'est le seul endroit où le produit m'explique un
  chiffre, et c'est celui qu'on ne peut pas lire en entier.

### [CASSE] Une couche peinte sur la carte n'est identifiée nulle part à l'écran

- **Ce que j'ai vu :** la France se couvre d'aplats jaune→brun avec des
  étiquettes « Paris · 11,9 », « Rhône · 8,63 », « Var · 7,53 ». Rien à l'écran
  ne dit **de quoi** il s'agit, ni **de quelle unité**. Le panneau des couches,
  resté en haut de sa liste, affiche `AIR & ESPACE 0/4 ON`, `Vols en direct
  OFF`, `Satellites OFF` — donc il me dit que rien n'est allumé.
- **Où :** carte + `#data-panel` / `#data-toggles`.
- **Reproduction :** 1. ouvrir l'URL ; 2. allumer `delinquance-fr` ;
  3. V-FRANCE ; 4. lire l'écran entier.
- **Preuve :** capture `docs/ui-review/captures/ui-regard-neuf-06-delinquance.webp`. Relevé
  exhaustif des textes visibles après activation (étape s12) : aucune
  occurrence de « Délinquance », ni d'unité. La légende existe bien
  (`.data-toggle-legend-item`, 7 entrées, « 0,000–5,36 / 1 000 habitants » …
  « Non diffusé — secret statistique ») mais elle est à **y = 2779 px** dans un
  conteneur dont le `clientHeight` est **479 px** (`scrollHeight` 3859) : il
  faut faire défiler ~2 400 px dans le panneau pour la voir.
- **Pourquoi ça compte :** je regarde une carte choroplèthe avec des nombres et
  je ne peux pas savoir ce qu'ils comptent. C'est exactement l'échec « la
  couleur, ça veut dire quoi » que je devais tester.

### [CASSE] Ouvrir un panneau du rail droit efface les deux autres, en-tête compris

- **Ce que j'ai vu :** au démarrage le rail droit propose trois en-têtes,
  `DISPLAY`, `CCTV`, `CONTEXT`. Après avoir déplié `CONTEXT` puis `DISPLAY`, le
  rail ne contient plus que `DISPLAY`. `CCTV` et `CONTEXT` ont disparu sans
  trace : ni en-tête replié, ni onglet, ni chevron. Je n'ai trouvé aucun moyen
  visible de les rappeler.
- **Où :** `#right-context-rail` (`.layout-exclusive .layout-focus`),
  `#cctv-panel`, `#param-slider-panel`.
- **Reproduction :** 1. ouvrir l'URL ; 2. cliquer le `◀` de `CONTEXT` ;
  3. cliquer le `◀` de `DISPLAY` ; 4. regarder le rail droit.
- **Preuve :** capture `docs/ui-review/captures/ui-regard-neuf-12-right-column-gone.webp` (rail =
  `DISPLAY` seul). Mesuré : `#cctv-panel` → `display: none`, classe
  `panel-collapsible collapsed layout-auto-collapsed`, rect 0×0 ; les
  `.panel-title` « CCTV » et « CONTEXT » ont un rect 0×0 (`vis: false`) alors
  qu'ils mesuraient respectivement 26 px et 59 px de large au démarrage
  (x 1391, y 351 et y 407).
- **Pourquoi ça compte :** j'ai perdu deux surfaces entières du produit — dont
  le panneau CCTV — en cliquant une flèche, et rien ne m'indique qu'elles
  existent encore. Un visiteur ne peut pas déduire l'existence de ce qui n'est
  plus dessiné.

### [FRICTION] Deux des huit villes rapides sont hors cadre, sans aucun indice

- **Ce que j'ai vu :** la barre `LOCATION` propose des pastilles de villes.
  J'en vois six (Paris, Marseille, Lyon, Toulouse, Nice, Nantes) ; il y en a
  huit. « Montpellier » et « Strasbourg » sont entièrement hors du conteneur.
  « Nantes » finit **pile** au bord droit, ce qui donne l'impression d'une
  liste complète.
- **Où :** `#location-pills` (`.location-pills`), pastilles `button.location-pill`.
- **Reproduction :** 1. ouvrir l'URL ; 2. cliquer `LOCATION` ; 3. regarder la
  rangée de villes.
- **Preuve :** mesuré — conteneur `clientWidth` **346**, `scrollWidth` **514**,
  bord droit **1061** ; « Nantes » right = **1061** (à ras) ; « Montpellier »
  x 1066→1148 et « Strasbourg » x 1152→1229, tous deux `clippedRight: true`, et
  `document.elementFromPoint` à leur centre ne renvoie pas la pastille.
  `overflow-x: auto` mais aucune barre de défilement, aucun dégradé, aucun
  chevron. Capture `docs/ui-review/captures/ui-regard-neuf-05-lyon.webp`.
- **Pourquoi ça compte :** l'affordance manquante fait passer une liste
  tronquée pour une liste complète — je conclus à tort que Strasbourg n'est pas
  proposée.

### [FRICTION] `LOCATION`, la seule porte pour trouver une ville, n'a aucune affordance

- **Ce que j'ai vu :** j'ai mis du temps à trouver comment chercher un lieu.
  Le mot `LOCATION` en bas de l'écran ressemble à une étiquette, pas à un
  bouton. Il ouvre pourtant la recherche. Une fois ouverte, le champ n'a pas le
  focus : il faut un deuxième clic pour taper.
- **Où :** `.location-toolbar-label` / `.location-toolbar` / `.location-inner` /
  `#location-bar` ; champ `#location-search`.
- **Reproduction :** 1. ouvrir l'URL ; 2. survoler puis cliquer `LOCATION` ;
  3. essayer de taper sans recliquer.
- **Preuve :** mesuré sur les quatre niveaux — `cursor: auto` partout, aucun
  `role`, aucun `tabindex`, aucun `aria-label` ; le clic déclenche bien
  l'ouverture (`#location-bar` passe de `panel-collapsible collapsed` à
  `panel-collapsible`, hauteur 62 px). Après ouverture,
  `document.activeElement !== #location-search` (`focused: false`), placeholder
  « Search any location… ». Capture `docs/ui-review/captures/ui-regard-neuf-04-location-clicked.webp`.
- **Pourquoi ça compte :** c'est le premier geste d'un visiteur (« trouve ma
  ville ») et le seul contrôle qui le permet ne se signale ni au curseur, ni au
  clavier, ni au lecteur d'écran.

### [FRICTION] 57 couches, une fenêtre de 479 px, aucun filtre

- **Ce que j'ai vu :** le panneau `DATA LAYERS` montre environ neuf lignes à la
  fois, dont la dernière coupée en deux. Pour trouver « Établissements
  scolaires », j'ai fait défiler à l'aveugle. Il n'y a pas de champ de
  recherche.
- **Où :** `#data-toggles` dans `#data-panel`.
- **Reproduction :** 1. ouvrir l'URL ; 2. déplier `DATA LAYERS` ; 3. chercher
  une couche par son nom.
- **Preuve :** mesuré — `scrollHeight` **3859 px** pour `clientHeight`
  **479 px** ; 57 lignes `[data-layer-id]` ; distance de défilement depuis la
  première ligne : `dvf-sales` **2733 px**, `schools-fr` **3379 px**,
  `cadastre-fr` **3765 px**. `document.querySelectorAll('#data-panel input')`
  → **[]** (aucun champ de filtre). Capture
  `docs/ui-review/captures/ui-regard-neuf-03-layers-open.webp`.
- **Pourquoi ça compte :** la richesse du produit (son argument principal) est
  rangée dans un tiroir de 479 px sans index.

### [FRICTION] La ligne d'une couche fait 271×48 px ; seule une pastille de 43×20 px est cliquable

- **Ce que j'ai vu :** j'ai visé le nom de la couche, pas la petite pastille
  `OFF` à droite. Rien ne bouge, et rien ne m'indiquait où viser : le nom et
  l'icône n'ont pas de curseur main.
- **Où :** `#data-toggles [data-layer-id] .data-name` vs `.data-toggle-btn`.
- **Reproduction :** 1. déplier `DATA LAYERS` ; 2. cliquer sur le mot
  « Satellites ».
- **Preuve :** mesuré — ligne 271×48 px (13 008 px²) ; seul élément de la ligne
  à `cursor: pointer` = `.data-toggle-btn`, 43×20 px (854 px², **6,6 %** de la
  surface de la ligne). `.data-toggle-row`, `.data-toggle-left`, `.data-icon`,
  `.data-name` : tous `cursor: auto`. Le libellé accessible n'existe que sur la
  pastille (`aria-label: "Vols en direct: OFF"`).
- **Pourquoi ça compte :** 93 % de la cible visuelle est inerte. (La moitié
  fonctionnelle du test — « le clic sur le nom ne fait rien » — n'a pas pu être
  confirmée : voir plus bas, le serveur est tombé.)

### [FRICTION] Le panneau `DISPLAY` : 16 contrôles sur 30 sans la moindre aide, et un jargon maison

- **Ce que j'ai vu :** `DENSE`, `Density 75 %`, `Allocation : Elastic /
  Weighted`, `Fade 7 %`, `Outside 1 %`, `Models : Proximity / All`, `Scope /
  Feather 11 %`, `Celestial`, `Clean UI`. Je ne peux deviner ce que change
  aucun d'entre eux. Densité de quoi ? Dehors de quoi ?
- **Où :** `#right-context-rail` / `#pp-toggles`.
- **Reproduction :** 1. ouvrir l'URL ; 2. déplier `DISPLAY` ; 3. survoler
  chaque contrôle.
- **Preuve :** mesuré — 30 contrôles interactifs dans le rail, **16 sans
  `title` ni `aria-label`** (dont `#detection-allocation-elastic`
  « Elastic », `#detection-allocation-row` « Allocation », le label
  « Density »). Et l'aide qui existe parle une autre langue que l'écran :
  `#detection-fade-slider[title]` = *« World-overlay fade distance outside the
  keyhole as a percentage of its radius »* — le mot « keyhole » n'apparaît
  nulle part dans l'interface visible. Capture
  `docs/ui-review/captures/ui-regard-neuf-12-right-column-gone.webp`.
- **Pourquoi ça compte :** un panneau de réglages qu'on ne peut pas lire est un
  panneau qu'on n'ouvre qu'une fois.

### [INCOHÉRENCE] Le grand mot cyan que j'ai lu comme un niveau d'alerte est le nom du style visuel

- **Ce que j'ai vu :** sous `TOP SECRET // SI-TK // NOFORN` et
  `KH11-4120 OPS-4158`, un mot en grand cyan : `NORMAL`. Dans ce contexte je
  l'ai lu comme un état de la situation (niveau d'alerte / de menace). C'est en
  fait le nom du préréglage visuel — la même valeur qu'`ACTIVE STYLE` affiche
  déjà en haut à droite du même écran.
- **Où :** `#hud-mode` (x 59, y 190) et `#active-style-name` (x 1456, y 49).
- **Reproduction :** 1. ouvrir l'URL ; 2. déplier `VISUAL PRESETS` ;
  3. cliquer `NOIR` ; 4. relire les deux coins de l'écran.
- **Preuve :** mesuré avant/après le clic — `{ hudMode: "NORMAL",
  activeStyle: "NORMAL" }` → `{ hudMode: "NOIR", activeStyle: "NOIR" }`. La
  même donnée est donc affichée deux fois, à deux endroits, sous deux
  présentations dont une seule est étiquetée. (Note : `#hud-summary` continue
  d'ouvrir sur « NORMAL GLOBAL SECTOR … » après le passage en `NOIR`.)
- **Pourquoi ça compte :** le mot le plus gros de la colonne gauche m'a fait
  croire à une information opérationnelle. C'est un réglage d'apparence.

### [QUESTION] Le lien de partage ne semble pas emporter la couche allumée — [NON REPRODUIT]

- **Ce que j'ai vu :** avec `Délinquance enregistrée` sur `ON`, le paramètre de
  couches du lien est vide.
- **Où :** `#share-btn` (title « Copy share link ») ; `location.hash`.
- **Reproduction :** 1. allumer `delinquance-fr` ; 2. lire `location.hash`.
- **Preuve :** valeur relevée — `aria-label` du bouton de la ligne =
  « Délinquance enregistrée: **ON** », et le hash contient
  `…&map=osm&l=&lo=f.e.1&ui=…` : **`l=` est vide**. Je n'ai **pas** pu ouvrir
  le lien en tant que destinataire (le serveur de dev est tombé pendant le
  test) ; le presse-papiers headless a répondu « Copy failed », je n'ai donc
  pas non plus vu le lien réellement copié.
- **Pourquoi ça compte :** « partager ce que je vois » était ma troisième
  tâche ; je ne peux pas savoir si le destinataire verra la carte colorée ou un
  globe vide.

### [QUESTION] Le châssis est en anglais, le contenu en français

- **Ce que j'ai vu :** `GOD'S EYE VIEW`, `NO PLACE LEFT BEHIND`, `DATA LAYERS`,
  `SCENES`, `DISPLAY`, `CONTEXT`, `VISUAL PRESETS`, `LOCATION`, `MAP SOURCE`,
  `Search any location…`, `SELECT CONTEXT — CONTACTS — nearest planes · vessels
  · sites` — puis, à l'intérieur : `Vols en direct`, `Délinquance enregistrée`,
  `Îlots de fraîcheur`, `Accueil du jeune enfant`, `Non diffusé — secret
  statistique`.
- **Où :** partout (relevés de texte visibles, étapes s1, s12, s19).
- **Preuve :** les deux relevés DOM cités ci-dessus.
- **Pourquoi ça compte :** je ne sais pas pour qui c'est écrit. Le visiteur
  français bute sur le châssis, l'anglophone sur les données. Est-ce assumé ?

### [QUESTION] Les sigles de l'accueil, un par un

Relevés exacts sur l'écran d'entrée, aucun accompagné d'une explication ni
d'un survol : `TOP SECRET // SI-TK // NOFORN`, `KH11-4120  OPS-4158`,
`ORB: 47320  PASS: DESC-265`, `MGRS: 31U DQ 4825 1195`, `GSD: 0.22m`,
`NIIRS: 7.1`, `ONA: 60.0°`, `COLL: 08:02:47Z`, `BAND: PAN`, `BITS: 11`,
`LVL: 1A`, `AIS: --`, `REC ●`. Puis dans les préréglages : `CRT`, `NVG`,
`FLIR`. Dans `MAP SOURCE` : le badge `ION` accolé à deux entrées, sans
définition. Dans la liste des couches : `FR` et `VILLES` en pastilles après le
nom, sans légende ; la fraîcheur affichée `· jamais` sur les 57 couches ; le
compteur `—` (`.data-count`) que j'ai pris pour un tiret décoratif.
Question honnête : lesquels de ces mots servent le produit, et lesquels servent
l'ambiance ? Je n'ai pas pu le déduire de l'écran.

## Hors lentille

- **Le serveur de dev du port 4290 est tombé en cours de session** (≈ 08:22 UTC,
  `curl` → `000`, plus aucun `LISTEN` sur 4290). Je ne l'ai ni tué ni
  reconstruit ; signalé ici parce que les autres agents partagent ce port.
- La fiche d'entité est peinte sur un canvas : son texte n'est ni sélectionnable,
  ni copiable, ni accessible à un lecteur d'écran.
- Le rail droit met « ~$0.00 » (coût du contrôle vocal) en permanence à l'écran,
  à 6,4 px de corps.

## Ce que je n'ai PAS pu vérifier

- **Le lien de partage vu du destinataire** : j'allais ouvrir le hash dans un
  second onglet quand le serveur est tombé (`ERR_CONNECTION_REFUSED`). Le
  constat sur `l=` vide reste donc à demi prouvé.
- **Le clic sur le nom d'une couche** : après la chute du serveur, même la
  pastille `OFF` ne bascule plus (`OFF` → `OFF`), donc je n'ai pas pu isoler
  « le nom n'est pas cliquable » de « plus rien ne bascule ». Seule la mesure
  géométrique et le curseur tiennent.
- **La récupération de `CCTV`/`CONTEXT`** après leur disparition : j'ai cherché
  un affordance de retour dans le DOM du rail et n'en ai pas trouvé, mais je
  n'ai pas pu tester un rechargement de page (serveur tombé).
- **Surfaces laissées de côté** : `#cctv-panel` ouvert, `#scene-panel`
  (SCENES), le mode `CLEAN UI`, le contrôle vocal, la vue V-PARIS et le
  scénario S-LIVE (`flights` + `ais-live-vessels` + `earthquakes`) — je me suis
  concentré sur le premier parcours d'un visiteur.
