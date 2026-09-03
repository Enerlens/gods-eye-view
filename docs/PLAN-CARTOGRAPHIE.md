# Plan d'amélioration cartographique de GEV

*Confrontation de [`CARTOGRAPHIE.md`](./CARTOGRAPHIE.md) au code réel. 35 règles instruites sur 68 couches, puis soumises à deux arbitres — un avocat du diable qui a rouvert le code pour démolir les verdicts sévères, et un responsable produit qui a mesuré ce que chaque correctif change pour un utilisateur.*

**Après arbitrage : 4 conformes, 24 partielles, 7 non conformes.** Trois verdicts ont été renversés, preuve en main ; ils sont signalés en place.

---

## Le constat, en une phrase

**Le problème de GEV n'est pas l'ignorance cartographique, c'est le câblage.**

C'est le résultat le plus net de l'audit et il change complètement la nature du plan. Encore et encore, on trouve le même schéma : le mécanisme existe, il est bien raisonné, souvent documenté en toutes lettres dans un en-tête de module, parfois sous test unitaire — **et il n'est branché sur rien**. Quatorze cas relevés. Le dépôt a compris la règle avant qu'on la lui pose, a construit la réponse, et a oublié de la connecter à l'écran.

Deux exemples qui donnent le ton :

- `terrainOcclusion` est normalisé dans l'API de l'hôte d'overlay (`worldOverlay.js:462`), une trentaine de couches le déclarent explicitement — et sur les **63 occurrences** du dépôt, la seule qui ne soit pas une écriture est la ligne de normalisation elle-même. *(vérifié)*
- `analystEngine.js` est un moteur de requête par attribut complet, avec sept opérateurs, des champs déclarés pour cinq couches, et des tests. Son unique consommateur est `src/voice/gevActions.js`, qui le compacte en réponse vocale. **Le résultat n'atteint jamais la carte.** *(vérifié)*

Ce diagnostic a une conséquence budgétaire directe : l'essentiel des gains est en effort XS et S, pas en refonte.

---

## Ce que GEV tient déjà — et qu'il ne faut pas casser

Un audit qui ne trouverait que des défauts serait malhonnête. Ce dépôt est nettement plus lettré en cartographie que la moyenne des globes web, et par endroits il devance la doctrine :

- **`vite.config.js:6398-6405`** — la coupe en quantiles des communes est faite **une fois sur toute la France** puis distribuée inchangée aux 96 paquets départementaux, avec ce commentaire : « *Re-cutting per pack would rebin a quiet département against its own quiet neighbours and paint it like a busy one — the same colour would stop meaning the same rate as soon as the camera moved.* » C'est l'énoncé exact de la règle D2, écrit dans le code avant la doctrine.
- **`satellites.js:556-561, 584, 1729-1737`** — la seule couche à traiter l'occultation entièrement juste : points testés en profondeur, anneau d'orbite à alpha 0,35 derrière le globe via `depthFailColor`, et un en-tête qui explique pourquoi une `CallbackProperty` a été refusée (« *verified in Cesium 1.138 source: the dynamic polyline updater […] depthFailMaterial is silently dropped* »). C'est le régime (c) de la règle F1, écrit deux ans avant elle.
- **`dpeFrance.js:28-31` + `addressMarkerIcons.js:67-90`** — la palette réglementaire DPE A→G échoue au test du gris (A et G ont des luminances de 0,234 et 0,207). Plutôt que de trahir un code officiel, le marqueur **dessine la lettre** en contours vectoriels. La teinte devient redondante et la règle est tenue sans toucher au code réglementaire.
- **`amenitiesFrance.js:1391-1406`** — un échantillon volontairement biaisé (plancher de budget par famille) **qui publie son propre biais** dans la légende, ligne par ligne : « Échantillon : N tracés sur M dans la vue ». Plus une entrée de légende `color: null` intitulée « Écoles — non dessinées ici », dont le seul rôle est d'expliquer ce que la carte **ne** montre **pas**.
- **`idfmFrequencyDepartements.js:19-25`** — le dénominateur départemental est énuméré à 3,58 Mo et 3,67 s plutôt que lu dans le `count(distinct)` du portail, parce que celui-ci est un estimateur qui répond 3 452 là où la vérité est 3 506. Le module écrit la conséquence : « *A 1.5 % error in the divisor is a 1.5 % error in every colour on the map, for free.* »
- **`earthquakes.js:193`** — `Math.pow(2, mag) * 1000` en unités monde sur une ellipse clampée au sol. Le cas d'école que la règle B2 dénonce est précisément le seul que le dépôt ait traité correctement depuis le début — et l'en-tête n'en dit rien, il parle de 32,4 ms/frame contre 1,4. La conformité cartographique y est un sous-produit d'une optimisation de performance.
- **`scripts/grid-audit/`** — 5 fichiers, 41 ko, qui comparent OpenStreetMap au registre RTE 2023 sur **toute la France** (pas sur une emprise témoin), avec lecteur de shapefile et inverse Lambert-93 écrits à la main « *because this machine has neither GDAL nor pyproj* ». Résultat : 98,5 % de couverture à 1 km, 13 m d'écart médian. C'est la démarche du support Overpass de Mericskay, dépassée.
- **`renderGovernor.js:68`** — `scene.maximumRenderTimeChange = Infinity` ferme la porte dérobée entre horloge de scène et horloge de rendu. Peu de globes web prennent cette peine ; c'est ce qui rend la séparation des horloges de la règle E4 réelle et pas seulement documentée.

**Trois règles sont pleinement conformes** : C4 (les taux sont recalculés numérateur/dénominateur, jamais moyennés), G4 (chaque couche agrégée a le mode que son interaction exige), H3 (la frontière GeoJSON/tuiles est connue et respectée).

---

## Phase 0 — Brancher ce qui existe déjà

**C'est la phase la plus rentable du plan et elle n'invente rien.** Quatorze mécanismes déjà écrits, à connecter. Presque tout est XS ou S.

| # | Ce qui existe | Où | Ce qu'il manque | Règle | Effort |
|---|---|---|---|---|---|
| 0.1 | `stats.coverage`, calculé par au moins 3 couches (« 533 of 892 measuring sea », « RRN non concédé », « worldwide upstream snapshot ») | `marineBuoys.js:171-190`, `roadEventsFrance.js:1017`, `flights.js:323` | `manager.js:2561` ne le lit **que** dans la branche `fallback`, que ces couches n'atteignent jamais. Une ligne. `marineBuoys.js:403-405` affirme même en commentaire que « the manager prints it into the chip » — c'est faux. | H1 | **XS** |
| 0.2 | `headingConfidence` (`high`/`medium`/`low`), calculé avec soin — une direction multi-valuée « 270;170 » est rétrogradée à `medium` avec relevé de terrain daté en commentaire | `osmCameras.js:243-249` → stocké `cctv.js:1231` | Aucun lecteur. Une pose devinée et une pose relevée sont le même signe. | A1 | **XS** |
| 0.3 | Le facet `cadence` du registre, **validé au boot** (`throw` si absent) | `layerTaxonomy.js:128-131`, remonté en `manager.js:2029` | Affiché nulle part. Le registre sait quelque chose du temps qu'il ne dit jamais. | E2 | **XS** |
| 0.4 | `rawRowCount` / `acceptedRowCount` — l'écart exact entre ce que la couche reçoit et ce qu'elle trace | `aisLiveVessels.js:660-661` | Publiés dans `getStats()`, lus par personne. | A5 | **XS** |
| 0.5 | `saturated` — « *a straight edge through the middle of Marseille is otherwise indistinguishable from the edge of the data* » | `bdtopoBuildings.js:1001`, en-tête l. 91-94 | Aucun lecteur dans tout le dépôt. | A4 | **XS** |
| 0.6 | Le mode « intégrité stricte » du trafic : `uncoveredRoads: 'hide'`, et le signe `colored = real, white = simulation` | `traffic.js:2356-2360` | La version la plus honnête de la couche existe et n'est atteignable **que par paramètre programmatique**. Aucun contrôle d'interface. | A1 | **XS** |
| 0.7 | `terrainOcclusion`, normalisé et déclaré par ~30 couches | `worldOverlay.js:462` | **Une seule des 63 occurrences n'est pas une écriture.** Le contrat a été pensé, écrit dans l'API, jamais branché. | F1 | **S** |
| 0.8 | Le moteur de requête par attribut : 7 opérateurs, champs déclarés pour 5 couches, sous test | `analystEngine.js:52-70` | Unique consommateur : `gevActions.js:3833-3860` (voix). `result.items` n'atteint jamais le globe. **Le maillon manquant de Shneiderman est écrit et débranché.** | G1 | **S** |
| 0.9 | Le motif pointillé pour l'absence de mesure (168 h sans relevé), **déclaré en légende** | `comptagesParis.js:320-330, 832-841` | Existe sur le chemin polyligne. La règle D3 n'est pas un chantier à inventer : c'est un motif à porter du polyligne au polygone. | D3 | **S** |
| 0.10 | La formule métrique correcte : `2 * Math.tan(fieldOfView / 2) / height` — vrai champ de vision, vraie hauteur de canvas | `telegeographySubmarineCables.js:457` | Sert à dimensionner une hampe de câble. Pendant ce temps `hud.js:330` affiche un « GSD » avec la constante magique `0.000375`. | F2 | **S** |
| 0.11 | `gev:style-change`, et la compensation qui va avec, raisonnée en commentaire | émis `ui.js:9190`, écouté par `traffic.js:2229` | **Un seul auditeur sur 425 fichiers.** Le mécanisme est prouvé, jamais appliqué aux dizaines d'autres couches classées par couleur. | F5 | **S** |
| 0.12 | *(retiré après arbitrage — voir 3.6)* La bascule de scène pour les choroplèthes réduite au non-drapage sur façades et à l'épinglage de `verticalExaggeration` | `meteoFranceVigilance.js:144-147`, `urbanismeGpu.js:315-318` | Le forçage de tangage est abandonné : c'est le geste le plus intrusif que le produit puisse poser, pour un défaut que l'utilisateur ne voit pas. | F4 | **S** |
| 0.13 | `sharedMobilityFrance.js:474-483` dimensionne par la capacité avec `translucencyByDistance` **seul** — B2 respecté | comparer à `bikeshare.js:1298-1303` | Le jumeau ajoute `scaleByDistance` et inverse la hiérarchie. **Le correctif est de supprimer une ligne pour aligner une couche sur son propre voisin.** | B2 | **XS** |
| 0.14 | `militaryFlights.js:668-670` écrit « Alt unknown » quand le flux ne donne rien | comparer à `flights.js:4236` | Le jumeau injecte 10 000 m et l'imprime « FL328 ». Les deux modules partagent `stickyNumber` et se citent mutuellement en commentaire. **Le correctif le plus important du dépôt consiste à copier un module sur son jumeau.** | A1 | **S** |

**Gain de la phase 0** : la moitié des non-conformités passe en conforme ou partiel, pour un coût cumulé de l'ordre de quelques jours.

---

## Phase 1 — Les quatre tromperies

Ce sont les seuls points que je qualifierais de **bugs**, pas d'arbitrages. Ils ont en commun d'afficher un nombre ou un signe que personne n'a mesuré, dans la même typographie que ce qui est mesuré, sur une application qui revendique la véracité de ses sources.

### 1.1 · L'altitude fabriquée qui s'imprime en niveau de vol — **P0, effort S** *(vérifié ligne à ligne)*

`flights.js:4236` : `stickyNumber(baro_alt, prevMeta?.altitude, onGround ? 0 : 10000)`. Un contact sans altitude reçoit 10 000 m. `flights.js:3285-3286` l'imprime : `const altFt = Math.round((info.altitude || 0) * 3.28084)` → **`FL328`**.

La preuve que le dépôt sait faire est sur la ligne d'à côté : la vitesse, elle, **est** gardée — `info.velocity ? ... : ''`. Il manque la même garde sur l'altitude. Côté militaire, `militaryFlights.js:2865-2868` positionne à 3 048 m par défaut : le texte est honnête (« Alt unknown ») mais **la position 3D ment sans le dire**.

### 1.2 · Les identifiants tirés au sort à côté du MGRS réel — **P0, effort XS** *(vérifié)*

`hud.js:126-129` : `KH11-${4000 + Math.floor(Math.random() * 200)}`, `OPS-41xx`, orbite 47 000+, passe 100+. Affichés `hud.js:148` et `168`, dans la même fonte et la même couleur que la latitude, la longitude et le MGRS authentiques de `hud.js:186-187`. Et `hud.js:195-198` écrit `BAND: PAN / BITS: 11 / LVL: 1A` en dur dans le DOM.

Le décor de cockpit est légitime ; ce qui ne l'est pas, c'est qu'il soit **typographiquement indiscernable** de la télémétrie. Un traitement visuel distinct (fonte, opacité, préfixe `SIM`) suffit et ne coûte rien à l'ambiance.

### 1.3 · La température FLIR en degrés, déduite de la luminance de l'orthophoto — **P0, effort XS** *(vérifié)*

`thermal.js:262-263` : `tempC = 20.0 + centerLuma * 30.0`, décomposée en dizaines, unités, décimale, symbole `°`, et rendue en chiffres 7 segments. **Une grandeur physique entièrement fabriquée, affichée avec une décimale, sans marqueur de simulation.** Le commentaire du code dit « simulated » ; l'écran ne le dit pas.

Aggravant : `thermal.js:318` peint la barre d'échelle en niveaux de gris alors que l'image peut être en rampe ironbow, et sans aucune borne numérique. La seule légende que dessinent les shaders se contredit elle-même.

### 1.4 · Une flotte d'airliners qui n'en sont pas — **P0, effort S**

`aircraftClass.js:110` renvoie `'airliner'` quand il n'y a **ni** code type **ni** catégorie exploitable, et `CLASS_SCALE_2D` lui donne `1.0`, soit le milieu exact de l'échelle. Il n'existe aucune classe `unknown`, et `BODIES` (`aircraftIcons.js`) n'a aucune silhouette « non classé ».

Ce n'est pas un cas limite mais **l'état initial de toute la flotte** : `/states/all` ne porte pas le code type, qui n'arrive que par un enrichissement asynchrone rationné (`ENRICH_MAX_INFLIGHT = 4`, seau à jetons plafonné à 300). Sur une vue européenne dense, tout ce qui dépasse le budget garde la silhouette de moyen-courrier indéfiniment.

Le reclassement en place existe déjà (`flights.js:829-836`) : une silhouette « inconnu » se transformerait automatiquement dès que la mesure arrive. C'est la règle A1 appliquée au canal de la forme.

**Même défaut côté navires** : `vesselLabels.js:23-28` — la couleur par défaut est **exactement** celle de la famille CARGO. Un navire sans type déclaré est dessiné en cargo.

---

## Phase 2 — Rendre la carte lisible

### 2.1 · Sortir la légende du panneau — **P0, effort M**

*(vérifié)* `index.html:597` livre `#data-panel` avec la classe `collapsed`, et `style.css:6936-6959` pose `display: none !important` sur `.data-toggle-list` quand replié. **Aucune légende n'est visible à l'état par défaut.** L'ouvrir recouvre le quart gauche de la carte.

Pire, le moment où la légende compte le plus est précisément celui où elle est structurellement garantie absente : `ui.js:3944-3946` — `allowStored: !this._initialShareState` — l'ouverture d'un lien de partage **écarte volontairement** la préférence locale du destinataire et retombe sur le défaut markup.

Le mécanisme de rendu, lui, est excellent et n'a pas besoin d'être réécrit : `manager.js:2445-2467` construit les entrées depuis `{color, glyph, label, count, blurb}`, avec masquage du glyphe pour les couches dont le canal est la forme — la règle interne écrite est « *the swatch IS the datum* ». `sharedMobilityFrance.js:808-843` va même plus loin avec une légende à deux genres de lignes et un « Never silently truncate ».

**Le correctif est un second point de montage**, pas une refonte : un bloc `#map-legend` près de l'attribution, alimenté par les couches activées dont `legend.length > 0`, masqué en `ui-clean-view` et `recording-mode` comme le reste du chrome.

> **Sur le titre du bloc — exception assumée à une règle du corpus.** Mericskay est catégorique parmi ses sept mauvaises pratiques de légende : « *Ne JAMAIS écrire le mot légende !* ». La règle est juste sur une carte imprimée, où le bloc occupe une marge et où sa nature ne fait aucun doute. Elle ne se transpose pas ici : sur un globe encombré d'une dizaine de panneaux flottants, un bloc de pastilles colorées sans intitulé est réellement ambigu — l'utilisateur ne sait pas s'il regarde une clé, un filtre ou une liste de couches. On garde donc l'intitulé, **en le sachant contraire au corpus et pour cette raison précise**. (Une première rédaction de ce plan prescrivait l'intitulé sans mentionner la règle qu'il enfreint : c'était une contradiction avec [`CARTOGRAPHIE.md` D1](./CARTOGRAPHIE.md), pas un arbitrage.)

**Point annexe à corriger dans le même passage** : `manager.js:2448` range tous les `blurb` dans `entry.title`, c'est-à-dire une infobulle. Or ces blurbs portent des déclarations que la carte doit faire — « *Le remplissage est un compte absolu, donc la fiche donne aussi le taux pour 1 000 km²* » (`schoolsFrance.js:1553`). La bonne phrase est écrite, le rendu la rend inatteignable sans souris.

**Le même défaut frappe ailleurs, et c'est ce qui en fait un défaut d'architecture et pas de couche.** L'arbitre a cherché une porte de sortie pour le badge de calibration des caméras : `buildSummaryText` (`cctv.js:3445-3471`) compose bien « CAL RAW PRIOR », donc la distinction entre une pose relevée et une pose devinée **est** écrite — mais elle alimente `#cctv-summary`, qui vit dans `#cctv-panel`, replié par défaut et masqué par **la même règle `style.css:6936-6959`**. Un seul point de montage mal placé neutralise les efforts d'honnêteté de plusieurs couches à la fois.

Et il n'existe aucun rattrapage : l'arbitre a cherché une ouverture automatique de `#data-panel` dans tout le dépôt. La seule écriture programmée est `ui.js:5632`, qui le **replie**.

### 2.2 · Donner une légende aux couches qui n'en ont pas — **P1, effort M**

`flights.js` et `militaryFlights.js` cumulent **9 220 lignes sans une seule occurrence de `legend`** — pour dix planformes, trois teintes de statut, une rampe de taille et deux plages d'opacité. Ce sont les deux couches à la sémantique visuelle la plus riche du produit.

Patron à recopier : `comptagesParis.js:800-843` (comptage sur les enregistrements réellement tracés, couleur = la couleur exacte dessinée, `blurb` explicatif).

### 2.3 · Le mode capteur doit dire que la clé ne décode plus — **P0, effort S**

*(vérifié)* `ui.js:2971-2985` monte un `Cesium.PostProcessStage` par style dans `scene.postProcessStages` : la passe repeint l'image **composée**, choroplèthes comprises.

Le détail qui rend le défaut certain : **la légende, elle, n'est pas repeinte** — elle est en DOM. Sous FLIR, la pastille garde sa vraie couleur et la carte non. **La clé cesse de décoder la carte.**

Le geste honnête est court et n'éteint rien : dans `setStyle()` (`ui.js:9137-9199`), juste avant le dispatch de `gev:style-change`, griser le bloc de légende des couches concernées avec « clé invalide sous ce capteur ». Le correctif de fond suit le patron que le trafic a déjà validé (`trafficPresetStyle.js:110-115`) : republier la classe sur la surface de détection, qui composite **au-dessus** de la chaîne post-FX.

### 2.4 · L'absence de donnée — **verdict renversé : partiel, et le résidu est XS**

> **Non-conformité annulée par l'arbitrage.** Mon verdict initial reposait sur un critère que la doctrine ne pose pas — « aucun motif de remplissage n'existe dans le dépôt » — au lieu du test qu'elle pose : *l'absence est-elle distinguable de la classe la plus haute, et le reste-t-elle sous chaque mode capteur ?*

Sur la seule couche zonale qui peint réellement une absence, la réponse est **oui**, et c'est argumenté ligne par ligne :

- `delinquanceFrance.js:208-227` — la rampe publiée est chaude (`#ffe08a` → `#6d1414`) ; l'état « non diffusé » est peint en **ardoise** `#5c6b8a`, « *off the warm ramp entirely* », à un alpha de 0,52, délibérément **plus lourd** que la bande publiée la plus pâle (0,30) « *so it cannot be mistaken for a low value* ».
- `delinquanceFrance.js:230-235, 944-957` — il reçoit en plus un **second canal, géométrique** : contour de 2,0 px en `#aebbd6` à 0,75 contre 1,0 px à 0,35, routé dans un troisième primitif « *so their outline is drawn LAST and wins every overlap* ». Un contour deux fois plus large et beaucoup plus clair **survit à un remappage de luminance FLIR/NVG**, exactement pour la raison qui fait préférer les hachures.
- `delinquanceFrance.js:336-357` — la branche de remplissage teste l'**état avant la bande** (« *inverted, it paints a withheld cell as a value* »).
- Deux autres couches zonales passent le test dans les deux moitiés en ne dessinant **rien** (`petiteEnfanceFrance.js:286-292`, `schoolsFrance.js:292-300`) : un trou survit à n'importe quel shader.

**Ce qui reste, et qui est réel** : l'état `missing` (`#2b2f36`, alpha 0,22) n'a ni ligne de légende — `states.missing` est compté en `delinquanceFrance.js:889` et jamais poussé — ni second canal.

**Correctif, effort XS** : pousser la ligne de légende manquante, le compteur existe déjà. La trame de remplissage pour polygones reste souhaitable mais n'est plus un prérequis ; si elle est faite un jour, le patron existe sur le chemin polyligne (`comptagesParis.js:320-330`, item 0.9).

> **Ailleurs le dépôt fait mieux que la doctrine.** `vigicrues.js:159-167` donne au niveau INCONNU non seulement une teinte propre mais **la largeur de barreau la plus fine**, avec la justification : « *'not published' must never out-shout 'published as calm'* », et l'en-tête l. 94-97 énonce la règle générale : « *inventing a reassuring colour for missing data is the one failure mode a vigilance map must not have* ».

---

## Phase 3 — La mesure, la maille et le globe

### 3.1 · La couleur des feux dépend du cadrage — **P0, effort S** *(vérifié)*

`firmsHeatmap.js:584` calcule `maxScore` sur `cells`, et `aggregateFires` renvoie `clipped` (l. 558-565) — les cellules **découpées à la vue**. La même cellule de Gironde change de couleur quand un feu australien entre dans le champ.

Pire que ce que j'avais compris : les bornes de vue viennent de `camera.computeViewRectangle()`, qui dépend du **rapport d'aspect du canvas**. Deux personnes ouvrant le même lien de partage, l'une en plein écran et l'autre en demi-écran, ne voient pas la même carte des feux.

Et la couche applique **deux doctrines opposées selon l'altitude, sans le dire** : sous 750 km, `detectionColorStop` (l. 1271-1276) classe sur un domaine absolu en FRP ; au-dessus, `renderCells` classe sur le maximum visible. L'opérateur qui dézoome voit la sémantique de la couleur changer à un seuil qu'aucune interface ne signale — et comme la couche n'a aucune légende sur 1 600 lignes, rien ne peut le lui apprendre.

**Correctif : geler les seuils sur un domaine absolu en FRP dans les deux régimes.** C'est la règle C1.

### 3.2 · Un degré carré n'a pas la même surface partout — **P1, effort M** *(vérifié)*

`firmsHeatmap.js:51-52` : `gridDegrees: 2.0` et `1.0`, appliqués au monde entier. Et `heatScore` (l. 1255-1257) additionne trois **effectifs** sans jamais diviser par une aire.

Conséquence : à comptage égal, une cellule à 60° N est peinte aussi dense qu'une cellule équatoriale qui couvre le double de surface. **La couche annonce que le nord brûle plus fort qu'il ne brûle, uniquement parce qu'un degré carré y est plus petit.** C'est le seul défaut de l'audit dont l'artefact a une lecture politique, sur un flux dont le sujet est l'anomalie thermique.

Correctif : diviser les termes d'effectif par `cos(lat)` avec plancher, et doubler le pas de longitude au-delà de 60°. Puis recalibrer les deux seuils de `heatColor` et le dire dans la légende.

> **Piège adjacent, à documenter avant qu'il ne morde** : `geoMeshThinning.js:186-196` maille aussi en degrés, pour les quatre maillages de sélection. Ça ne colore rien et ça ne sert qu'en France (~16 % d'écart d'aire du sud au nord), donc ce n'est pas un manquement. Mais si un de ces adaptateurs sert un jour hors métropole, le défaut de FIRMS s'y reproduira sans qu'une ligne ait changé.

### 3.3 · Le GSD inventé — **verdict renversé : partiel, et le correctif est deux lignes supprimées**

> **Non-conformité annulée par l'arbitrage produit.** La règle a deux moitiés et la première est tenue **par construction** : il n'existe aucune barre d'échelle décorative dans le produit, donc aucune mesure fausse par ce biais. Et l'altitude est traitée **mieux que la doctrine ne l'exige** — `hud.js:336-345` corrige l'ondulation du géoïde, avec la mesure qui le justifie en commentaire : un cockpit posé sur le tarmac de SFO (N ≈ −32 m) affichait « ALT: −15m ».

*(vérifié)* Ce qui reste n'est donc pas une absence de mesure, c'est **une mesure fausse** : `hud.js:330-334` calcule `gsd = altM * 0.000375` — constante magique indépendante du champ de vision, de la hauteur du viewport et du tangage — puis en dérive un NIIRS, et les affiche à deux décimales sous l'étiquette « GSD », immédiatement au-dessus de l'altitude MSL réelle et sous le MGRS authentique. Or la vue d'ouverture est à `pitchDeg: -30` (`camera.js:61-62`), où le rapport pixel/mètre varie d'un facteur ~10 dans la même image : **le chiffre n'est juste nulle part en particulier.**

**Correctif retenu, effort XS** : supprimer GSD et NIIRS. C'est le même chantier que la tromperie 1.2 et il se traite avec elle.

**Ce que je renonce à faire**, et pourquoi : construire un module d'ancrage au sol sous réticule était mon correctif initial. Il ajouterait du chrome permanent dans le seul style que le produit livre volontairement nu — `sharelink.js:105` masque le HUD au démarrage, c'est un choix. Un utilisateur non géomaticien ne réclame pas des mètres par pixel ; il réclame qu'on ne lui affiche pas un chiffre inventé à côté de coordonnées vraies. La formule correcte existe (`telegeographySubmarineCables.js:457`) et attendra une demande réelle.

### 3.4 · Rendre le cap — **P1, effort S**

*(vérifié)* `cockpit-compass-tape` et `cockpit-heading-value` n'existent qu'en vue cockpit. Hors cockpit, l'utilisateur ne sait pas où est le nord — dans une application dont la caméra tourne librement.

C'est le cas rare où le spectacle et la géomatique demandent exactement la même chose : une bande de cap est à la fois l'habillage que la 3D détruit et un élément de cockpit.

### 3.5 · Les symboles traversent la Terre — **P1, effort L**

*(vérifié)* 77 occurrences de `disableDepthTestDistance`, dont une vingtaine à `POSITIVE_INFINITY` : `amenitiesFrance`, `schoolsFrance`, `dpeFrance`, `sitadelFrance`, `aisLiveVessels`, `idfmFrequency`, `idfmNetwork`, `militaryInstallations`, `georisques`, `fraicheurParis`, `supFrance`, `powerGrid`, `dvfSales`, `transitRouteView`.

Un médecin de Marseille se peint par-dessus les Alpes vues de Lyon. Sur une application dont l'esthétique dit « capteur », c'est une image de rayons X qu'aucun capteur ne produit. Et l'occultation crée un **troisième type de vide**, indiscernable de « pas de donnée » et de « écrêté ».

L'effort est L parce que la politique doit être décidée couche par couche — mais le champ de déclaration existe déjà (`terrainOcclusion`, item 0.7), ce qui en fait un chantier de câblage plus qu'un chantier de conception.

### 3.6 · La teinte thématique monte sur les façades — **verdict renversé : partiel, effort S**

> **Non-conformité annulée par l'arbitrage produit, et mon raisonnement corrigé.** J'affirmais qu'un aplat zonal vu en perspective devient incomparable parce que sa surface apparente décroît en 1/z². **C'est faux.** La variable visuelle d'une choroplèthe est la teinte de remplissage, que la perspective ne déforme pas : deux départements ont la même couleur en haut et en bas du cadre. Ce qui varie est leur aire apparente, et dans une choroplèthe l'aire ne porte aucune donnée. Vérification faite sur les portes de régime (`schoolsFrance.js:127-137`, entrée à 9,5° de span / 45 km) : à cette altitude la lecture est intacte.

*(vérifié)* Le défaut réel est plus étroit et bien plus intéressant : quand la pile photoréaliste est active, la classification bascule en `CESIUM_3D_TILE` — `meteoFranceVigilance.js:144-147`, `urbanismeGpu.js:315-318`, et de même dans `vigicrues`, `roadEventsFrance`, `traffic` — donc **l'aplat thématique est drapé sur les façades des immeubles**. Là, l'ombrage du bâti module la couleur perçue, donc la valeur lue. C'est la règle B3 (six paliers déclarés ≠ six paliers perçus) appliquée à une surface verticale que personne n'avait prévue.

**Correctif — et une seconde correction de ma part, découverte à l'implémentation.** Je prescrivais « ne pas draper une couche thématique sur du bâti ». **Ce n'est pas implémentable :** quand la pile photoréaliste est active, le globe est masqué, le remplissage *doit* donc être classifié `CESIUM_3D_TILE` — et ce maillage est le sol et les immeubles en **une seule géométrie**. Cesium n'offre aucun drapeau qui ne classifierait que le sol.

Il ne reste donc que deux issues : forcer la caméra au nadir (rejeté ci-dessus), ou **le dire**. C'est la seconde qui a été retenue — `surfaceFillNotice.js` produit la phrase, montée dans la légende, quand un remplissage thématique grimpe sur les façades. Épingler `scene.verticalExaggeration = 1` reste utile et se fait dans le même passage.

**Ce que je renonce à faire** : détourner la caméra vers −75° et décharger Google 3D Tiles à la bascule d'une couche. L'immersion est l'actif principal de GEV ; une caméra qui bouge toute seule sur un clic est une régression que tout utilisateur remarque, contrairement au défaut qu'elle corrige.

### 3.7 · Les rampes perdent leur ordre sur fond clair — **P1, effort M**

L'arbitre a recalculé indépendamment le compositing (sRGB → linéaire, mélange sur fond, CIELAB, ΔE00 complet) et retrouve les chiffres à la décimale. Sur un fond urbain clair `#c8c4bb`, la rampe `irve-fr` donne des clartés L\* de **67,4 · 65,9 · 65,3 · 65,8 · 69,6 · 78,0** : **non monotone**. La classe 1 est plus claire que les classes 2, 3 et 4. Même famille de résultats sur `sup-fr` (67,3 · 65,4 · 64,1 · 63,7 · 67,1 · 76,4) et `amenities-fr` (ΔE00 total de 13,9 pour six classes). Les quatre couches partagent d'ailleurs la même échelle d'alpha `[0.34, 0.40, 0.46, 0.53, 0.60, 0.68]`.

Sur eau et sur forêt, les mêmes rampes sont monotones et bien séparées. **Le défaut n'est pas la palette, c'est le compositing sur fond clair** — c'est exactement la règle B3, et le correctif qu'elle prescrit : un fond opaque désaturé sous la couche zonale, plutôt que de compter sur l'alpha seul. Le patron existe déjà dans le dépôt, formulé spontanément : `idfmFrequency.js:328-334` énonce le problème et le résout par un alpha croissant conjoint à la clarté.

---

## Phase 4 — Le temps et le filtre

### 4.1 · Brancher le filtre sur la carte — **P1, effort S→M**

C'est le maillon manquant du mantra de Shneiderman, et **le correctif le moins cher de tout l'audit** : le moteur existe (`analystEngine.js`, item 0.8), il est sous test, il ne sort que par la voix.

Deux précisions techniques que l'audit a établies contre ma propre doctrine, sources Cesium à l'appui :

- **`show` ne détruit pas le batch.** `EntityCluster.removePoint` met la primitive en réserve (`index.js:151282-151293`), et un changement d'`isShowing` sur géométrie statique devient une écriture d'attribut par instance. *(vérifié)*
- **Le vrai destructeur est `removeAll()`** — `index.js:149904-149910` pose `_createVertexArray = true`. Et il est appelé par trois chips de filtre existantes. *(vérifié)*

Les filtres déjà en place sont d'ailleurs meilleurs que la doctrine ne l'exige : `airportsPack.js:467-482` et `damsPack.js:757-782` ne se contentent pas de masquer, la légende **recompte le visible** par palier et l'infobulle ajoute « N masqué(s) ». Et `localGeojson.js:456-461` documente un arbitrage juste que la doctrine ne prévoyait pas : le filtre n'écrit pas `entity.show` lui-même mais pose `record.filteredOut`, parce que la passe de pré-rendu possède déjà `show` pour l'occultation — « *two writers would fight* ».

### 4.2 · Calibrer les traces en longueur d'écran, pas en nombre de points — **P1, effort M**

Trois copies de `TRAIL_MAX_POINTS = 400` (`flights.js:575`, `militaryFlights.js:494`, `aisLiveVessels.js:85`) : **la même valeur pour un navire à 5 m/s et un avion à 250 m/s**. Aujourd'hui la trace d'un avion barre l'écran pendant que celle d'un navire tient dans une icône, ce qui suggère faussement que le navire vient d'apparaître.

Correctif : un module `trailWindow.js`, jumeau de `trailRenderer.js` déjà partagé, exposant une **longueur au sol cible** et retournant `T = L / v` depuis la vitesse que chaque couche possède déjà. Élaguer par âge, pas par index. Exposer trois presets via `getRowControls()`, que `layerState.js` sait déjà sérialiser dans le lien de partage.

### 4.3 · L'instant représenté — **P1, effort M**

Le meilleur exemple du dépôt n'est pas une fiche mais une ligne de rang : `idfmFrequency.js:788-789` fabrique « mardi 08 h (heure de Paris) · 8 départements » et `manager.js:2569-2571` l'imprime **à la place** de l'âge du fetch. L'en-tête formule la règle mieux que ma doctrine : « *the row label always names the day it drew so a Sunday screenshot cannot be mistaken for a weekday one* ».

Le mécanisme générique existe donc et est quasi gratuit à généraliser — **trois couches sur 68** s'en servent.

Deux défauts ponctuels dans le même chantier :
- `aisLiveVessels.js:1919` — `if (!record.lastPositionUtc) return 'POS: LIVE'`. **Un horodatage manquant s'affiche « LIVE »** : l'absence d'instant se lit comme la fraîcheur maximale. Effort XS.
- `satellites.js:517-542` — la « trace » des satellites est une **prédiction** d'une période orbitale vers l'avant, graphiquement identique aux traces d'avions et de navires qui sont du passé. Trois polylignes de même facture, deux sens du temps opposés, aucune légende.

### 4.4 · L'âge de la mesure comme variable visuelle — **P0, effort M**

Une seule couche sur 68 fait de la fraîcheur une variable visuelle — `hubeauHydrometry.js:468` — et c'est une couche de points **fixes**. Les cinq couches mobiles, pour lesquelles la règle a été écrite, n'ont rien ou un binaire illisible.

Prérequis : **désaturer le canal alpha d'abord** (règle A3). `aircraftRecession.js:198-202` multiplie aujourd'hui trois informations dans un seul alpha — fraîcheur (`flights.js:2778`), distance au limbe (`alphaFloor: 0.35`), dé-emphase du focus (`dimFloor: 0.25`). L'alpha doit rester le canal de la profondeur ; la fraîcheur passe sur la saturation du `baseColor`, qui a de la marge vers le gris pour le blanc civil comme pour l'ambre militaire.

---

## Ce que je recommande de ne pas faire

| Tentation | Pourquoi s'en abstenir |
|---|---|
| **Ajouter une barre d'échelle** | En perspective elle est fausse partout sauf sur une ligne de l'écran, et fausse **silencieusement**. Une capture partagée deviendrait une mesure fausse et citable. Faire 3.3 à la place. |
| **Peindre l'absence en blanc** | Sur les rampes sombres de GEV, le blanc se lit comme la classe **haute** : on afficherait « valeur maximale » là où il n'y a pas de donnée. Faire 2.4. |
| **Câbler « rayon ∝ valeur » sur des billboards** | Le canal taille est déjà pris par la profondeur. Le résultat serait une hiérarchie inversée **avec une légende qui affirme le contraire** — pire que la punaise indifférenciée, parce que ça donne au lecteur une raison de croire ce qu'il voit. |
| **Normaliser toutes les choroplèthes de force** | `irveDepartements.js:37-44` peint un comptage brut, c'est **argumenté** en en-tête et la densité est calculée et imprimée sur la fiche. Le défaut n'est pas le comptage, c'est que la légende ne le dise pas. Corriger la légende, pas la donnée. |
| **Éteindre les couches sous mode capteur** | Le mode capteur est une part du produit. Dire que la clé ne décode plus (2.3) suffit et coûte moins. |
| **Refondre le panneau de couches** | Le mécanisme de légende y est excellent. C'est un **point de montage** qui manque, pas une refonte. |
| **Forcer la caméra au zénithal sur les couches zonales** | Le geste le plus intrusif que le produit puisse poser, pour un défaut que l'utilisateur ne voit pas — la teinte d'une choroplèthe ne se déforme pas en perspective. Faire 3.6 à la place. |
| **Construire un ancrage métrique sous réticule** | Ajouterait du chrome permanent au seul style livré volontairement nu. Le problème n'est pas la mesure manquante, c'est la mesure fausse : supprimer GSD/NIIRS suffit. |
| **Traquer toutes les constantes `MAX_RENDERED_*`** | L'arbitre a montré que `schoolsFrance.js` en a une qui **ne mord jamais** — la boîte amont est plafonnée à 0,35°, mesurée à 5 506 établissements pour un plafond de 6 000. Vérifier la borne amont avant de classer un plafond comme silencieux, sinon on applique deux poids et deux mesures à deux constantes identiques. |

---

## Récapitulatif

| Phase | Contenu | Effort cumulé | Effet |
|---|---|---|---|
| **0** | Brancher 14 mécanismes déjà écrits | quelques jours | La moitié des non-conformités tombe |
| **1** | Les 4 tromperies | ~2 jours | GEV cesse d'afficher des nombres que personne n'a mesurés |
| **2** | La légende lisible, le motif d'absence, la clé sous capteur | ~1 semaine | Un visiteur qui n'a rien ouvert peut lire la carte |
| **3** | FIRMS, le cap, l'occultation, les façades, le compositing sur fond clair | ~2 semaines | La carte cesse de dépendre du cadrage et de la fenêtre du lecteur |
| **4** | Le filtre, les traces, l'instant, l'âge | ~2 semaines | Le maillon manquant de Shneiderman, et le temps réel qui dit son âge |

**Si je ne devais en garder que trois** : 1.1 (l'altitude inventée qui s'imprime en FL), 2.1 (la légende invisible par défaut, surtout à l'ouverture d'un lien de partage), et 3.1 (la couleur des feux qui dépend de la taille de la fenêtre du lecteur). Les trois sont des cas où GEV **affirme quelque chose de faux**, ce qui est le seul reproche que Mericskay adresse vraiment au Géoweb.

---

## État d'application — 2026-09-03

*Ce qui a été implémenté, vérifié en test unitaire et confirmé dans un navigateur réel (0 erreur console, 15 couches activées ensemble). Le dépôt passe 5 192 tests unitaires, dont 27 nouveaux écrits pour ces correctifs.*

### Fait

| # | Correctif | Preuve |
|---|---|---|
| **1.1** | L'altitude non reportée n'imprime plus `FL328` | `formatContactAltitude()` extrait et testé ; `militaryFlights` lisait `info.altitudeM` sur une méta qui n'a que `altitudeFt` — l'altitude cockpit d'un contact militaire était en fait sa hauteur de rendu |
| **1.2** | Identifiants de mission distingués typographiquement | `.hud-simulated`, préfixe `SIM`, testé sur la source |
| **1.3** | La température FLIR devient un indice relatif `rEL 0.00–0.99` | Le `°` est supprimé du glyphier ; la barre d'échelle suit désormais la palette ironbow au lieu de contredire l'image |
| **1.4** | Classe `unknown` avec son propre glyphe (dard sans aile) | Mesuré en vol : **9 700 contacts « type non reporté » contre 157 moyen-courriers** — 97 % de la flotte visible portait une silhouette de narrow-body inventée |
| **1.4 bis** | Un navire sans type n'est plus peint en cargo | `#9aa7b5`, hors de la gamme des familles |
| **2.1** | Second point de montage `#map-legend` | Alimenté sans ouvrir aucun panneau ; masqué en clean-view et recording-mode ; le `blurb` est du texte, plus une infobulle |
| **2.2** | Légendes pour `flights`, `militaryFlights`, `aisLiveVessels`, `firms`, `traffic`, `urbanismeGpu` | Pastilles masquées par le glyphe réellement dessiné ; comptages sur ce qui est à l'écran |
| **2.3** | Le mode capteur déclare la clé invalide | `_syncLegendKeyValidity()`, avant le dispatch de `gev:style-change` |
| **2.4** | Le 4ᵉ état de la délinquance (`missing`) a sa ligne de légende | Le compteur existait depuis toujours |
| **3.1** | Seuils de feux absolus | `heatNormalized()` : la couleur ne dépend plus du cadrage ni du rapport d'aspect |
| **3.2** | Normalisation par `cos(lat)`, plancher à 75,5° | `maxFrp` reste intensif, délibérément non divisé |
| **3.3** | GSD et NIIRS supprimés | Test qui interdit le retour de la constante magique |
| **3.4** | Bande de cap hors cockpit | `globeHeadingTape.js` — mêmes divisions et même formateur que le cockpit, échantillonné sur `preRender`, repeint seulement au changement de pas |
| **3.6** | Le drapage sur les façades est **dit** | Cesium ne sait pas classer le sol sans le bâti sur un maillage photoréaliste : la note remplace un correctif de rendu impossible |
| **3.7** | Échelle d'alpha **descendante**, partagée par les 4 choroplèthes | `choroplethAlpha.test.mjs` recalcule sRGB → linéaire → L\* sur 8 fonds ; écart minimal 5,7 L\* contre −0,6 (inversion) avant |
| **4.2** | Traces élaguées en **longueur au sol** | `trailWindow.js` : 260 km pour tous, plancher de 12 points pour un navire à quai, plafond de 400 sommets |
| **4.3** | `POS: TIME UNKNOWN` ; l'anneau satellite se déclare prédiction | Un horodatage absent ne s'affiche plus « LIVE » |
| **4.4** | La fraîcheur quitte le canal alpha | `contactFreshness.js` : lavage vers un neutre froid, opacité pleine. L'alpha ne signifie plus que la profondeur |
| **0.1** | `stats.coverage` lu hors de la branche `fallback` | « worldwide upstream snapshot », « 533 of 892 measuring sea » enfin imprimés |
| **0.2** | `headingConfidence` branché | Cône **tireté** quand personne n'a relevé le cap. Mesuré : **527 caméras sur 815** pointaient dans une direction inventée, graphiquement identiques aux 288 relevées |
| **0.3** | Le facet `cadence` s'affiche | Une couche `static` dit « fixed snapshot » au lieu de « 4m ago » |
| **0.4** | L'écart brut/accepté d'AIS devient un `coverage` | |
| **0.5** | `saturated` de BD TOPO enfin publié | « le bord droit du bâti est la limite du tracé, pas la limite de la ville » |
| **0.6** | Le mode « mesuré seul » du trafic a une puce | Mesuré : **1 900 points simulés contre 4 100 mesurés** dans une vue parisienne |
| **0.11** | La légende trafic lit `_activeBucketColors` | La clé suit le repeint par preset au lieu de décrire la palette d'origine |
| **0.13** | `scaleByDistance` retiré de `bikeshare` | Le canal taille appartient à la capacité, comme chez son jumeau `sharedMobilityFrance` |

### Non fait, et pourquoi

- **3.5 — l'occultation par le terrain (effort L).** Les 77 `disableDepthTestDistance` demandent un arbitrage **couche par couche** : décider qu'un médecin de Marseille doit disparaître derrière les Alpes est un choix produit, pas une correction. Le champ `terrainOcclusion` reste déclaré `false` par les ~30 couches qui le mentionnent — personne ne l'a jamais demandé à `true`, donc l'implémenter seul ne changerait rien à l'écran.
- **4.1 — brancher le filtre sur la carte.** Le plan l'annonce comme « le correctif le moins cher », en supposant qu'une surface existe. Elle n'existe pas : `analystEngine` sort par la voix, et l'amener à la carte demande une API de mise en évidence dans cinq couches, un champ de requête, et une sérialisation dans le lien de partage. C'est une fonctionnalité M, pas un câblage — la livrer à moitié serait pire que l'absence.
- **0.9 — la trame de remplissage pour polygones.** L'arbitrage l'avait déjà rétrogradée : le résidu réel était la ligne de légende manquante, qui est faite (2.4).

### Ce que l'application a appris

Deux choses que ni la doctrine ni le plan n'avaient vues, trouvées en écrivant le code :

1. **`militaryFlights.js` lisait un champ qui n'existe pas.** `_describeFlight` demandait `info.altitudeM` à une méta qui ne publie que `altitudeFt`, donc le cockpit affichait silencieusement la hauteur de *rendu* — c'est-à-dire, pour un contact sans altitude, le repli de 3 048 m. Le plan reprochait au module de mentir sur la position 3D ; il mentait aussi sur le chiffre.
2. **Le correctif de compositing va dans le sens inverse de l'intuition.** Il fallait faire *descendre* l'alpha, pas monter : sur un fond urbain clair, c'est la classe la plus **sombre** que le sol délave, donc c'est elle qui a besoin d'opacité. Les quatre modules justifiaient l'échelle montante par « la densité se lit aussi comme du poids » — vrai sur un fond constant, faux sur de l'imagerie vivante.

---

## Ce que l'arbitrage a appris sur la méthode

Trois verdicts sur dix ont été renversés, et les trois erreurs se ressemblent. Elles valent d'être notées, parce qu'elles se reproduiront au prochain audit :

1. **J'ai substitué un critère au test.** Pour D3, j'ai cherché « existe-t-il une trame de remplissage ? » au lieu de poser la question de la règle : « l'absence est-elle distinguable de la classe haute, et survit-elle aux modes capteur ? » La réponse était oui, par un moyen que je n'avais pas prévu — un contour deux fois plus large, qui est un signe géométrique et survit donc à un remappage de luminance aussi bien que des hachures.
2. **J'ai facturé au dépôt la dette d'un produit qu'il n'est pas.** Pour E4, la seule branche manquante concernait un mode timelapse qui n'existe pas. Le test de la règle était explicitement conditionnel : sans objet, pas échoué. Classer partiel dans ce cas gonfle le backlog et dilue les vrais manquements.
3. **J'ai raisonné juste sur la géométrie et faux sur la sémiologie.** Pour F4, la perspective déforme bien l'aire apparente — mais dans une choroplèthe l'aire ne porte pas la donnée, la teinte la porte, et la teinte ne se déforme pas. Le vrai défaut était ailleurs, plus étroit et plus grave : le drapage sur les façades.

La leçon commune : **un choix argumenté dans un en-tête et vérifiable dans le code n'est pas une faute, c'est une décision** — même quand il s'écarte de la doctrine. Ce dépôt documente abondamment ses arbitrages ; l'auditer suppose de les lire avant de les compter comme des manquements.
