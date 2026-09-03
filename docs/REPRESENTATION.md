# Ce que GEV dessine, et ce qu'il pourrait dessiner

*Audit dataset par dataset du **vocabulaire graphique**, pas de son honnêteté. Suite de `CARTOGRAPHIE.md` (la doctrine) et de `PLAN-CARTOGRAPHIE.md` (les correctifs appliqués le 2026-09-03).*

---

## Pourquoi le passage précédent ne se voit pas

Il ne se voit pas parce qu'il ne devait pas se voir. Le plan appliqué portait sur la section A de la doctrine — l'honnêteté — et une correction d'honnêteté réussie est invisible par construction : `FL328` disparaît, le `°` disparaît, un cône devient tireté, un alpha descend au lieu de monter. Vingt-cinq correctifs, dont dix-neuf changent un chiffre ou un attribut sans changer un signe.

**Aucun d'eux ne change ce que GEV *est capable de dire*.** Le vocabulaire graphique du produit n'a pas bougé d'un iota, et c'est lui, le sujet de cette note.

### Le recensement, chiffré

*Recompté le 2026-09-03, après le chantier. La colonne « avant » est le recensement d'origine de cette note ; **deux de ses chiffres étaient faux au moment où ils ont été écrits** et sont corrigés ici avec leur méthode, pour qu'ils soient rejouables.*

| | avant | après | comment c'est compté |
|---|---|---|---|
| Couches de données enregistrées | ~~52~~ **54** | **54** | `REGISTERED_LAYER_IDS.length` (`layerState.js:488`), croisé au boot avec `LAYER_TAXONOMY_TABLE`. 53 `dataset` + 1 `coordinator` (`military-awareness`, sans géométrie propre). **Le 52 d'origine n'était reproductible par aucun compte du dépôt** — le tableau dataset-par-dataset de cette même note en aligne 54. |
| Dont le signe principal est un **point coloré** (billboard, `PointGraphics` ou `PointPrimitive`) | ~~39~~ **36** | **35** | Critère publié : *la marque que la couche dessine pour l'individu qu'elle nomme*. Le 39 d'origine n'était adossé à aucun critère et n'est pas rejouable ; sous celui-ci le compte était 36 avant le chantier. Une seule couche en est sortie — `local-datacenters`, passée du point de 10 px à son emprise. **C'est le mauvais indicateur pour ce chantier** : `earthquakes`, `marine-buoys`, `anfr-fr`, `local-dams` et `ais-live-vessels` ont tous changé de grammaire sans quitter la famille du point. Voir la ligne suivante. |
| **Couches portant un quantitatif sur l'axe Z** | **1** | **10** | Le vrai indicateur du chantier. Avant : `bdtopo-buildings` seul, et sa hauteur n'est pas thématique. Après : 7 par extrusion (`bdtopo-buildings`, `sitadel-fr`, `irve-fr`, `schools-fr`, `sup-fr`, `france-energy`, `local-datacenters` via `localGeojson`) + 3 par polyligne verticale (`marine-buoys`, `earthquakes`, `anfr-fr`). |
| Occurrences de `extrudedHeight` dans tout `src/` | **3** | **84** | `grep -rn "extrudedHeight" src/ \| wc -l` = 84, dont 51 dans des fichiers de test. Sur les 33 restants : **12 écritures dans des couches de données** (irve 2, schools 2, sup 2, `franceEnergy` 3, `sitadelFrance` 1, `bdtopoBuildings` 1, `localGeojson` 1), 2 dans les annotations utilisateur, 3 lectures, 10 mentions en commentaire, plus 5 occurrences de `extrudedHeightM` (le champ de la *render spec* de `damsPack` / `datacentersPack` / `localGeojson`) et 1 de `extrudedHeightReference`. Des 12 écritures, **7 posent une hauteur** et 5 la remettent à `undefined` — parce qu'un département qui retombe à plat doit récupérer sa classification au sol (A1). |
| Qui **chargent les mêmes 96 polygones départementaux** | **10** | **10** | `grep -rn "france_departements/departements.geojson" src/` = 12 fichiers, moins `choroplethPrism.js` et `anfrFrance.js` qui n'en parlent qu'en commentaire. La liste : `amenities-fr`, `delinquance-fr`, `idfm-frequency`, `irve-fr`, `medecins-fr`, `meteofrance-vigilance`, `petite-enfance-fr`, `schools-fr`, `sup-fr`, `france-energy`. |
| … dont en **aplat** | 10 | **6** | `amenities-fr`, `delinquance-fr`, `idfm-frequency`, `medecins-fr`, `meteofrance-vigilance`, `petite-enfance-fr`. |
| … dont en **prisme extrudé** | 0 | **4** | `irve-fr`, `schools-fr`, `sup-fr` (les 96 polygones) et `france-energy` (les mêmes polygones agrégés en 12 régions, la Corse hachurée à plat). |
| Qui dessinent une **ligne** comme objet principal | 6 | **6** | `road-status-fr`, `comptages-fr`, `power-grid`, `gas-fr`, `vigicrues`, `telegeography-submarine-cables`. Inchangé — mais `comptages-fr` porte désormais deux variables sur cette ligne au lieu d'une. |
| Cartes de flux | **1** | **1** (les cinq arcs frontaliers de `franceEnergy`) | inchangé |
| Isolignes, surfaces continues, anamorphoses | **0** | **0** | inchangé — le Dorling de `sup-fr` est explicitement remis à plus tard |
| Encodages bivariés sur la carte | **0** | **5** | Les quatre prismes (hauteur = effectif, couleur = taux) et `comptages-fr` (teinte = rythme, largeur = débit). |
| Dimension temporelle **sur la carte** | **1** (`idfm-frequency`) | **2** | `comptages-fr` a gagné le curseur horaire de `idfm-frequency`. |

Deux précisions que le recensement d'origine écrasait :

- `idfm-frequency` charge bien le fichier des 96 polygones mais n'en peint que **8** — l'Île-de-France. Le compter parmi « les couches qui peignent la même carte de France » était faux dans les deux sens.
- `france-energy` peint les mêmes polygones **agrégés en 12 régions**, pas 96 départements. Les parois intérieures des départements d'une même région restent d'ailleurs visibles au travers du volume translucide, artefact assumé et écrit dans son en-tête.

Autrement dit : GEV est un globe 3D temps réel qui dessine **un atlas 2D de 1975 posé sur une sphère**. Les deux seuls signes qu'il connaisse vraiment sont *la punaise* et *le département peint*. Mericskay ouvre son cours sur la punaise et le département peint pour dire que ce sont les deux réflexes du géoweb dont il faut sortir.

> **Depuis le 2026-09-03, cette phrase n'est plus tout à fait vraie.** L'atlas est toujours là — 35 couches sur 54 dessinent encore une punaise, et six cartes de France en aplat restent superposables. Mais l'axe Z est passé de **une** couche à **dix**, et le département peint a cessé d'être le seul geste national : quatre couches le montent en volume. Voir [État d'application](#état-dapplication--2026-09-03) pour ce qui a été fait, avec sa preuve, et pour ce que l'implémentation a appris contre ce document.

### La phrase qui désigne le chantier

> « **Le véritable défi sémiotique du géoweb réside dans les modalités de représentations graphiques de nouvelles formes de données numériques en temps réel** […] Pour le moment les solutions en ligne réutilisent pour beaucoup les moyens graphiques existants en essayant de les transposer à ces nouvelles données. »

Le passage précédent a nettoyé la transposition. Il ne l'a pas dépassée.

---

## Cinq pistes structurelles

Chacune vaut pour plusieurs couches à la fois. Le check dataset par dataset qui suit s'y rattache.

### Piste 1 — Habiter l'axe Z

**C'est la piste la plus rentable, et la doctrine la prescrit déjà** sans que personne l'ait lue comme une piste : la règle B2 dit que sur un globe la taille écran est confisquée par la profondeur, et que le quantitatif doit migrer sur *« un canal orthogonal à la profondeur : anneau en pixels constants, valeur/luminance, ou **hauteur d'extrusion lue contre un guide vertical** »*.

La hauteur d'extrusion n'est utilisée nulle part. Sur un globe 3D. C'est le canal le plus large, le plus lisible, le seul que la perspective ne mange pas — et il est vide.

Trois usages immédiats :

- **Le prisme départemental remplace l'aplat.** Hauteur = l'effectif absolu, couleur = le taux. Un seul geste qui résout la faute B1 sur trois couches (§ *Bornes*, *Écoles*, *Sup*) **et** produit un bivarié là où il n'y avait qu'une variable.
- **Le séisme retrouve sa profondeur.** Un hypocentre est un point à −10 km ou à −600 km ; GEV le dessine à plat et code la profondeur en teinte rouge/orange/jaune, qui se lit comme une gravité. Sur un globe, la profondeur *est* une géométrie disponible.
- **Le bâti devient le support thématique.** `bdtopo-buildings` extrude déjà les volumes réels de la France. Cinq couches (DPE, DVF, permis, Sitadel, urbanisme) dessinent aujourd'hui des punaises *au-dessus* de ces volumes. Les peindre *sur* eux est la seule chose qui change réellement l'écran d'un fork immobilier.

**Argument d'ingénierie qui va dans le même sens** : le dépôt a déjà buté sur le fait qu'un `GroundPrimitive` batché colorie par le *rectangle englobant* de chaque instance, pas par son polygone. Un polygone extrudé n'est pas un `GroundPrimitive` — il ne classifie rien, il a sa propre géométrie, et la couleur par instance y fonctionne normalement. Passer en 3D **supprime** la contrainte au lieu de l'aggraver.

### Piste 2 — Le cercle proportionnel manquant

Trois couches peignent un **effectif brut en aplat de couleur**, ce que le corpus appelle textuellement *« l'une des erreurs sémiologiques les plus courantes que l'on peut rencontrer sur le géoweb »* :

| Couche | Ce qui est peint | Mesuré |
|---|---|---|
| `irve-fr` | nombre de points de charge par département | 227 → 10 539 |
| `schools-fr` | nombre d'écoles par département | — |
| `sup-fr` | nombre d'étudiants par département | 2,96 M au total |

Les trois modules **argumentent** leur choix dans leur en-tête, et l'argument est réel (`irveDepartements.js` : la densité couvre un facteur 2 300 et rend 95 départements indistinguables). Mais l'alternative qu'ils comparent est toujours *« aplat d'effectif contre aplat de densité »*. La bonne alternative n'est ni l'un ni l'autre : **cercle proportionnel pour l'effectif, aplat pour le taux, les deux ensemble**. C'est la figure canonique, elle existe depuis Minard, et elle n'apparaît nulle part dans GEV.

Une seule couche utilise aujourd'hui la surface proportionnelle : `edf-power-plants` (« aire plutôt que rayon porte les mégawatts : un disque deux fois plus large revendiquerait quatre fois la capacité »). Elle prouve que le dépôt sait le faire.

### Piste 3 — Le temps n'est jamais sur la carte

`comptages-fr` détient **168 valeurs horaires pour chacun de ses 2 977 arcs** — 500 136 mesures — et en peint **une** : la moyenne de l'heure ouvrée. C'est le plus gros gâchis représentationnel du dépôt. `eco2mix` est une série au pas de 15 minutes montrée en jauge. Hub'Eau tient des hydrogrammes. `sparkline.js` existe et ne sert que dans des fiches de panneau.

Une seule couche a une dimension temps sur la carte : `idfm-frequency`, dont l'en-tête dit lui-même *« la première dimension heure-du-jour de ce dépôt »*. Elle marche, elle est sous test, et son mécanisme (des puces jour × tranche horaire qui repeignent la scène) est **directement réutilisable**.

La piste n'est pas « faire une animation ». C'est : *le temps est un axe de lecture, pas un attribut de fiche.*

### Piste 4 — Les champs continus dessinés comme des objets discrets

Quatre jeux sont des **surfaces**, dessinées en points ou en aplats administratifs :

- **APL médecins** — un indicateur d'accessibilité continu, publié **à la commune**, peint sur 96 départements.
- **Lden bruit** — un champ acoustique, réduit à trois lettres de zone (ce qui est le découpage légal, donc défendable — mais la surface existe).
- **Stations météo** — 2 144 instruments qui *mesurent un champ*, dessinés en points coloriés par… leur classe d'instrument.
- **FIRMS** — déjà une grille, mais une grille en degrés (C3), corrigée par `cos(lat)` faute de mieux. H3 existe.

### Piste 5 — Sortir du département

Dix couches peignent les mêmes 96 polygones. C'est le MAUP en pratique (C2) : *« une limite administrative correspond rarement à une discontinuité spatiale »*. Et c'est aussi une monotonie visuelle — allumer trois couches nationales donne trois fois la même carte de France en trois teintes.

Trois sorties, par ordre de coût :
1. **La commune, quand la donnée est communale.** `medecins-fr` et `amenities-fr` agrègent volontairement à la maille supérieure des données qu'ils tiennent à la maille inférieure. `petite-enfance-fr` a déjà fait le chemin inverse — c'est le modèle.
2. **Le carroyage.** L'INSEE publie Filosofi à 200 m, en libre accès. C'est la maille qui ne ment pas.
3. **L'anamorphose / Dorling.** 2,96 M d'étudiants dans trente villes : la carte de France est le mauvais support, le cartogramme est le bon.

---

## Le check, dataset par dataset

Colonnes : **dessine** = le signe actuel · **défaut** = ce qui cloche pour la lecture (pas pour l'honnêteté) · **proposition** = le remplacement · **coût** S/M/L.

> **Ces tableaux décrivent l'état du 2026-09-03 AVANT le chantier, et ils ne sont pas mis à jour** : ce sont l'audit, il doit rester lisible tel qu'il a été rendu. **16 de ses 39 propositions sont refermées** ; la section [État d'application](#état-dapplication--2026-09-03) les reprend une par une, avec la preuve et, quand l'implémentation s'est écartée du brief, la raison.

### ✈️ Air & Espace

| Couche | Dessine | Défaut | Proposition | Coût |
|---|---|---|---|---|
| **Vols en direct** | silhouette par classe, altitude 3D réelle, traînée unie | L'altitude est *juste* mais **illisible** : rien à l'écran ne distingue un FL350 d'un FL100 sans ouvrir une fiche. Le canal Z porte la donnée et personne ne peut la lire. | **La tige d'altitude** — une verticale fine du contact jusqu'au sol, avec son ombre. Signe standard du contrôle aérien 3D ; restitue à la fois l'altitude *et* la position au sol, aujourd'hui toutes deux perdues en perspective. Et la traînée passe en rampe de **taux de montée** (montée / palier / descente) au lieu d'une couleur unie. | **S** |
| **Satellites** | points, taille 6–12 px **par groupe**, orbite en polyligne | La taille — le canal quantitatif le plus fort — est dépensée sur une variable **qualitative** (« prominence du groupe »). B5. | Libérer la taille. Et surtout : dessiner **l'empreinte au sol** (cercle de visibilité) plutôt que le seul point. La question qu'un satellite pose est « qui voit quoi », et elle est spatiale. | M |
| **Aéroports** | point par classe de taille | Un aéroport a une **forme** : ses pistes. La classe OurAirports (`large`/`medium`/`small`) est un proxy éditorial de la longueur de piste, qui est dans le pack. | Sous ~50 km, dessiner **la piste orientée à sa vraie longueur**. La hiérarchie devient une mesure au lieu d'un bucket. | M |
| **Missions spatiales** | marqueur au pas de tir + trace orbitale | Correct. | — | — |

### 🎖️ Défense

| Couche | Dessine | Défaut | Proposition | Coût |
|---|---|---|---|---|
| **Vols militaires** | idem vols civils | idem | idem (tige d'altitude) | S |
| **Sites militaires** | point coloré par classe, plafond 700 | Une base, un champ de tir, un terrain militaire sont des **emprises**, pas des coordonnées. Le point ne dit ni l'étendue ni la forme. | Dessiner **le périmètre OSM** quand il existe (la majorité), le point en repli déclaré. Un champ de tir de 40 km² cesse d'être une punaise. | M |
| **Contexte global** | dérivé, pas de géométrie propre | — | — | — |

### ⚓ Maritime

| Couche | Dessine | Défaut | Proposition | Coût |
|---|---|---|---|---|
| **Navires en direct** | flèche 32 px, couleur par famille, traînée | **La taille n'encode rien.** Un porte-conteneurs de 400 m et un remorqueur de 12 m ont la même flèche. Or l'AIS message 5 publie `to_bow`/`to_stern`/`to_port`/`to_starboard` — la coque est dans la donnée. | Sous ~10 km, **le navire à son échelle réelle**, coque orientée au cap. Au-dessus, flèche dont l'aire ∝ longueur. C'est le changement le plus spectaculaire du dépôt pour un port. | M |
| **Bouées marines** | couleur = état de mer OMM, gris si pas de capteur | Bon (le gris est un vrai refus). Mais la hauteur de vague, le seul chiffre que 21 % des bouées publient, est enfermée dans la teinte. | Ajouter la **tige verticale ∝ Hs**. Une houle de 8 m dans le golfe de Gascogne devient un relief. | S |
| **Ports** | point | Idem aéroports : une emprise portuaire a une forme. | Périmètre quand OSM le donne. | M |

### 🚗 Mobilité terrestre

| Couche | Dessine | Défaut | Proposition | Coût |
|---|---|---|---|---|
| **Trafic routier** | points animés le long des polylignes OSM | Beau, et **la seule animation du produit**. Mais la densité de points ne mesure rien : elle est le rendu, pas la donnée. Et 1 900 points simulés cohabitent avec 4 100 mesurés. | Séparer les deux rôles : **le segment porte la mesure** (couleur = congestion, largeur = débit), **les points portent l'animation**. Aujourd'hui les points portent les deux et n'en portent bien aucun. | M |
| **État du réseau routier** | segments colorés par le CIGT | Correct, et la couche la mieux construite du groupe. | — | — |
| **Comptages routiers** | arc coloré ET large sur la **même** bande de comptage, tirets si non mesuré | Deux canaux pour une information (A3), **et 167 des 168 heures jetées**. C'est le plus gros gâchis du dépôt. | 1) **Un curseur horaire** — le mécanisme de `idfm-frequency` transposé. 2) Libérer la couleur pour la **forme du rythme** calculée sur les 168 h (pendulaire / continu / nocturne / week-end), la largeur gardant le débit. On obtient une carte de flux bivariée qui n'existe nulle part ailleurs. | **M** |
| **Transports en commun** | icône par mode + coin de cap orbitant | Correct, et l'argument sur le coin plutôt que la rotation de l'icône est juste. | — | — |
| **Réseau IDFM** | 37 956 arrêts en points + lignes à leur couleur officielle | 37 956 punaises est le cas d'école du semis illisible. | **Agrégation en maille** au-dessus du quartier (hex), les arrêts individuels sous. Ou : ne dessiner que les **lignes**, les arrêts n'apparaissant qu'au zoom rue. | M |
| **Fréquence IDFM** | point par arrêt, 7 bandes de courses/h, puces jour × heure | **La couche modèle du dépôt.** Elle a un axe temps, des seuils gelés, une bande « silencieux » distincte. | Rien à corriger — **à généraliser**. C'est le patron de la piste 3. | — |
| **Stations vélos** | taille = capacité, couleur = disponibilité | Correct depuis le retrait du `scaleByDistance`. | La vraie question est temporelle (« y aura-t-il un vélo dans 10 min »), pas instantanée. Hors périmètre licence pour l'instant. | — |
| **Véhicules partagés** | point par véhicule | La flotte **clignote** (GBFS masque les véhicules loués) et rien à l'écran ne le dit. | Un signe qui assume l'inventaire : **densité par maille** plutôt que semis de points, puisque l'objet individuel est faux par construction. | M |
| **Événements routiers** | marqueur par situation, segment quand la localisation le permet | Correct. | — | — |

### ⚡ Énergie

| Couche | Dessine | Défaut | Proposition | Coût |
|---|---|---|---|---|
| **Mix électrique** | régions peintes par le solde d'échange + 5 arcs frontaliers | Le solde est un **effectif signé en MW** peint en aplat — B1 — et il lui faudrait une rampe divergente centrée sur zéro. Les 5 arcs sont la seule carte de flux du produit. | **Prisme par région** : hauteur = \|MW\|, couleur = signe (import/export). L'Île-de-France en creux face à Auvergne-Rhône-Alpes en pic, c'est le fait structurel du réseau français rendu en une image. | **M** |
| **Groupes de production** | point par unité | La puissance est le sujet et ne pilote pas la taille de façon lisible. | **Cylindre extrudé** : hauteur = puissance livrée, base = puissance installée. La différence entre les deux *est* le taux de charge, sans autre encodage. | M |
| **Centrales EDF** | **disque d'aire ∝ puissance installée**, couleur = filière | **La seule couche correctement proportionnelle du dépôt.** | La passer en volume (cylindre) pour l'aligner sur ci-dessus : « le relief énergétique de la France ». | S |
| **Petite hydro** | point par installation | 2 757 installations, la plupart minuscules. | Même échelle proportionnelle que les deux ci-dessus, pour que les trois couches énergie se lisent **ensemble**. Aujourd'hui elles utilisent trois grammaires. | S |
| **Réseau électrique** | lignes par bande de tension, souterrain en tirets, postes dimensionnés | Bon. Une seule chose : les lignes HT sont clampées **au sol**, alors qu'elles sont à 30–60 m. | Les poser à leur hauteur (caténaire simplifiée). Change beaucoup l'impression de réseau en vue rasante, coût faible. | S |
| **Réseau gaz** | tracés + points dimensionnés | Bon. | — | — |
| **Bornes de recharge** | 3 régimes : **aplat d'effectif** → maillage → sites | **B1.** L'en-tête compare « effectif » à « densité » et choisit l'effectif ; la bonne réponse était les deux, sur deux canaux. | **Cercle proportionnel** (aire ∝ points de charge) **sur** l'aplat de densité. Le régime national cesse d'être une carte de la population. | **M** |
| **Barrages** | point | OSM publie souvent `height` et `length`. | Extrusion de l'ouvrage, ou au minimum taille ∝ longueur. | S |

### ⚠ Risques & environnement

| Couche | Dessine | Défaut | Proposition | Coût |
|---|---|---|---|---|
| **Séismes (24 h)** | disque au sol de rayon `2^magnitude × 1000` m, couleur = 3 classes de profondeur | Deux fautes. **(1)** Le rayon ne mesure rien : ni la rupture, ni le rayon ressenti, ni le ShakeMap — c'est une exponentielle décorative. **(2)** La profondeur, variable quantitative continue, est codée rouge→orange→jaune, qui se lit comme une **gravité** (B4). | **L'hypocentre à sa profondeur réelle**, sous la surface, relié au sol par une tige. La profondeur devient géométrie et libère la couleur ; la magnitude passe sur un **anneau en pixels constants** (B2). Un globe 3D qui dessine enfin un phénomène 3D. | **M** |
| **Feux actifs (FIRMS)** | grille 2°/1° normalisée `cos(lat)`, sprites de chaleur | La grille en degrés reste non équi-aire (C3) ; `cos(lat)` est un pansement. Et le FRP est une **puissance en MW** — un absolu — rendu en couleur. | **H3** (ou S2) pour la maille, et le FRP en **hauteur de cellule**. Le feu comme relief thermique. | L |
| **Vigicrues** | tronçons colorés sur 4 niveaux ordinaux, élargis si alerte | Correct, y compris le parti « réseau sombre par temps calme ». | — | — |
| **Hub'Eau** | point, taille = log₁₀(débit) sur 5→15 px, **couleur = fraîcheur** | Le débit couvre 4,7 décades comprimées en un facteur 3 de diamètre — illisible. Et la couleur, canal le plus fort, est dépensée sur la fraîcheur, que A2 veut en *lavage* pas en teinte. | Élargir franchement l'échelle de taille, et donner la couleur à l'**état hydrologique** (débit rapporté au module ou au QMNA5 de la station) — un rapport, donc légitime en aplat. Ambition : **la largeur du cours d'eau ∝ débit**, joint à la géométrie des tronçons. | M → L |
| **Risques (Géorisques)** | points ICPE ; les aléas restent en texte | Le refus de dessiner un aléa sans géométrie est **juste** et doit être gardé. | Mais Géorisques publie de vraies emprises en WMS (AZI, TRI, retrait-gonflement). C'est la surface manquante, et elle est disponible. | M |
| **Vigilance météo** | 96 départements sur 4 niveaux ordinaux, vert = rien | Correct — l'ordinal en aplat est exactement le bon usage, et « vert = rien peint » est un bon arbitrage. | — | — |
| **Bruit** | zones PEB/PGS A–D en polygones | Le découpage en lettres est **légal**, donc légitime. Mais le Lden est un champ. | **Extruder les zones par le seuil dB** : le bruit en relief au-dessus de l'aéroport. Spectaculaire, exact, et sans inventer de donnée. | S |
| **Îlots de fraîcheur** | points (équipements, fontaines) + polygones (parcs) + 219 432 arbres | La question réelle est *« à quelle distance suis-je du frais »*, qui est une **surface**, pas un semis. `isochroneFeed.js` existe dans le dépôt et n'est câblé nulle part. | **Isochrone piétonne** depuis le réseau des refuges, ou surface de distance. Les points restent en dessous. | M |
| **Délinquance** | 3 régimes, taux pour mille, 4ᵉ état « non publié » distinct | Correct — le meilleur traitement du secret statistique du dépôt. | — | — |

### ≋ Réseaux & capteurs

| Couche | Dessine | Défaut | Proposition | Coût |
|---|---|---|---|---|
| **Câbles sous-marins** | polylignes + atterrages | Correct. | Épaisseur ∝ capacité si la donnée le permet (elle est dans TeleGeography, mais la licence NC limite). | — |
| **Datacenters** | **un point de 10 px**, pour tous | Le module **le dit lui-même** : 3 517 des 4 351 objets sont des polygones, dont l'emprise couvre cinq ordres de grandeur (médiane 5 625 m², max 7 060 220 m²), *« et chacun rend le même point de 10 px. C'est la chose la plus discriminante du fichier et elle ne coûte rien à calculer »*. | **Dessiner l'emprise**, extrudée par `building:levels` quand il existe. Le diagnostic est écrit, le correctif ne l'a jamais été. | **S** |
| **Caméras publiques** | frustum pitché + plan moniteur, cône tireté si cap non relevé | **La couche la plus 3D-native du produit**, et de loin. | Rien. C'est la preuve que le reste peut suivre. | — |
| **Radio** | points | Une station de radio n'a pas de lieu, elle a une **aire de diffusion**. | Hors périmètre (annuaire web, pas émetteur). Laisser. | — |
| **Stations météo** | point, couleur = **classe de la station** | 2 144 instruments qui mesurent un champ, coloriés par le type d'instrument. La mesure n'est nulle part sur la carte. | Couleur = **la mesure** (température, vent), classe en forme ou en contour. Et à terme, l'interpolation du champ, qui est ce qu'une station sert à produire. | M |
| **Antennes mobiles** | point, couleur = génération la plus récente, maillage national | Le refus du choroplèthe est **bien argumenté et juste** (59–76 % en métropole, 1 % en Nouvelle-Calédonie). | Deux ajouts gratuits : ANFR publie la **hauteur du support** (extrusion) et l'**azimut** de chaque antenne (secteurs). Un pylône dessiné en pylône, avec ses lobes. | M |

### ▤ Bâti & territoire — le plus gros gisement

| Couche | Dessine | Défaut | Proposition | Coût |
|---|---|---|---|---|
| **Bâti 3D** | volumes BD TOPO extrudés, hauteurs réelles | **Rien. C'est la seule vraie géométrie 3D du produit — et elle ne sert qu'à elle-même.** | **En faire le support thématique des cinq couches ci-dessous.** Une géométrie, cinq lectures. C'est le changement le plus visible que ce dépôt puisse faire. | **M** (le socle) |
| **DPE** | points A–G aux couleurs officielles | Une punaise **au-dessus** du toit dont elle parle. Les couleurs officielles sont un bon choix ; leur support ne l'est pas. | **Peindre le volume** du bâtiment. « La rue en DPE » devient littéralement la rue. | S *(une fois le socle fait)* |
| **Ventes (DVF)** | points colorés par ratio au **médian de ce qui est à l'écran** | Violation C1 assumée : la même vente change de couleur quand on déplace la caméra. L'argument (« l'outlier de la rue ») est réel, le dénominateur ne devrait pas être le cadrage. | Dénominateur = **le médian de la commune**, nommé dans la légende. Et peindre le bâtiment, pas un point à côté. | S |
| **Autorisations d'urbanisme** | points colorés par état du dossier | Le choix de la couleur pour l'état est **juste** (argumenté dans l'en-tête). | Ajouter le volume : **extruder l'emprise par les logements autorisés**. « Ce qui arrive » cesse d'être une punaise. | M |
| **Sitadel** | dessiné sur la **parcelle** exacte | Bon — déjà la bonne maille. | Même extrusion. | S |
| **Urbanisme (PLU & servitudes)** | polygones de zonage à plat, servitudes en pointillés | Le GPU **ne publie pas de hauteur maximale** (attributs : `libelle`, `typezone`, `partition`, le règlement est un PDF). Donc l'« enveloppe constructible en volume » n'est pas dérivable et **ne doit pas être inventée**. | Ce qui est faisable : extruder les **assiettes de servitude** par leur `paramcalc` (le tampon *est* publié), et signaler quand une servitude passe sous un bâtiment dessiné. | M |
| **Parcelles cadastrales** | polygones au sol | Correct. | — | — |
| **Médecins** | national = **APL en aplat départemental**, puis maillage, puis sites | L'APL est publié **à la commune** et agrégé au département pour l'affichage. On perd la seule chose intéressante : le gradient intra-départemental, qui est là où le désert médical se voit. | **Descendre à la commune.** `petite-enfance-fr` a déjà fait exactement ce chemin et a documenté pourquoi. Même geste, même bénéfice. | **M** |
| **Écoles** | national = **aplat d'effectif** | B1. | Cercle proportionnel (effectif) sur aplat (densité ou taux de scolarisation). | M |
| **Enseignement supérieur** | national = **aplat d'étudiants** | B1, et le cas le plus extrême : 2,96 M d'étudiants concentrés dans ~30 villes peints sur 96 départements de superficie sans rapport. | **Cercles proportionnels**, voire un **Dorling** : c'est le jeu du dépôt où l'anamorphose est le plus justifiée. | M |
| **Équipements** | national = **part des communes équipées** (un taux) | Correct — le bon usage de l'aplat. | — | — |
| **Accueil du jeune enfant** | taux, à l'**EPCI et à la commune** | **Le mieux maillé du dépôt**, et son en-tête explique pourquoi il a quitté les points (« un taux est une propriété d'un territoire ; en point il devient une propriété d'une coordonnée »). | Rien — **c'est le modèle de la piste 5**. | — |

---

## Ce que je ferais, dans cet ordre

1. **Le bâti comme support thématique** (DPE, DVF, permis sur les volumes BD TOPO). La géométrie existe déjà, la jointure est l'adresse ou la parcelle, et c'est le seul changement qui transforme immédiatement l'écran d'un fork immobilier. — *M pour le socle, S par couche ensuite.*
2. **Le prisme et le cercle proportionnel au national** (mix électrique, bornes, écoles, sup). Corrige la faute B1 trois fois, supprime la monotonie des dix cartes de France identiques, et donne un bivarié gratuit. — *M.*
3. **Les séismes à leur profondeur.** Petit périmètre, effet maximal, et c'est l'argument de vente d'un globe 3D. — *M.*
4. **Le curseur horaire sur les comptages**, en transposant `idfm-frequency`. 500 136 mesures dont une seule est visible aujourd'hui. — *M.*
5. **Le canal taille, partout où il est libre** : datacenters (le module réclame lui-même le correctif), navires à l'échelle, bouées, barrages, antennes. — *S chacun.*

## Ce que je ne ferais pas

- **Inventer une enveloppe constructible** à partir du GPU. La hauteur n'est pas dans la donnée ; elle est dans un PDF. Ce serait exactement la faute A1, en volume.
- **Une heatmap sur un semis de points** parce qu'il est illisible. Le corpus est explicite : *« à utiliser avec prudence dans la mesure où le processus de transformation graphique sous-jacent est davantage esthétique que rigoureux »*. Agrégation en maille déclarée, oui ; nappe floue, non.
- **Toucher à `vigicrues`, `meteofrance-vigilance`, `road-status-fr`, `petite-enfance-fr`, `cctv`, `delinquance-fr`.** Ces six-là sont déjà justes. Le vocabulaire manquant est ailleurs.


---

## État d'application — 2026-09-03

*Seize chantiers parallèles, un par sujet, chacun avec sa propre mesure. **994 tests unitaires sur 32 fichiers, 0 échec** au moment de la passe d'intégration — puis **un test devenu rouge** pendant la rédaction de ce rapport, par une correction concurrente de `franceEnergy.js` qui a raison contre son propre test (incohérence 13). **Aucune vérification navigateur** : les seize agents ont travaillé sur le même arbre, `npm test` et la QA visuelle étaient interdits — les rendus Cesium (prismes extrudés, matériaux rayés, occultation par le maillage photoréaliste) sont argumentés depuis la source Cesium embarquée et testés sur des entités factices, pas vus à l'écran. C'est la dette la plus importante de ce chantier.*

**16 des 39 propositions de l'audit sont refermées.** Six d'entre elles l'ont été *autrement* que ce que l'audit demandait, et ces six-là sont la partie intéressante — voir « Ce que l'application a appris ».

### Fait

| Ligne de l'audit | Ce qui est livré | Preuve |
|---|---|---|
| **Bâti 3D** — « en faire le support thématique » | `buildingTheme.js` : registre de thèmes à précédence, jointure point→emprise par grille à √n cellules, la plus petite emprise gagne. Le volume non joint garde sa teinte d'usage **lavée** (s×0,15 / l×0,42 en HSL). | `buildingTheme.test.mjs`. ΔE76 ≥ 36,5 mesuré contre les trois palettes visées ; le nombre de tests de polygone est asséré (200 au lieu de 600 000 en naïf ; 8,7 ms contre 2 967 ms au plafond 14 000 × 2 000). Les 39 tests bdtopo existants passent sans modification. |
| **DPE** — « peindre le volume » | Thème enregistré, `reduce` = **le mode** des étiquettes du bâtiment, égalité tranchée par la pire lettre. Le badge se **tait** (12 px au lieu de 20) quand le volume dit déjà sa lettre. | `dpeFrance.test.mjs`. La palette officielle est gardée et son défaut mesuré : L\* 55,4 / 72,3 / 92,8 / 96,6 / 83,8 / 72,1 / 52,7 — B et F à 0,2 L\* l'un de l'autre, donc le test B4 échoue **pour la palette de l'État**, et c'est la raison écrite de garder les badges qui dessinent la lettre en forme. |
| **DVF** — « dénominateur = le médian de la commune » | `communeReference()` calculé sur toutes les mutations des éditions déjà téléchargées : zéro requête et zéro parse en plus, et un nombre qui ne bouge plus avec la caméra. Les deux médians coexistent sous des noms différents (`localMedianPrixM2` / `referenceMedianPrixM2`). | `dvfSales.test.mjs` — un test asserte l'implication « aucun médian communal ⟹ aucune vente colorable », qui rend le repli prouvablement inatteignable, et un troisième signe (`#c46be0`) existe quand même parce qu'A1 n'admet pas de repli non marqué. |
| **Autorisations d'urbanisme** — « ajouter le volume » | ADS ne propose au thème que les dossiers pouvant porter sur de l'existant ; construction neuve déclarée et permis d'aménager sont **retenus et comptés**. Précédence 10 (DPE) < 20 (DVF) < 30 (ADS) — vérifié, aucune collision. | `adsUrbanisme.test.mjs`. Mesuré : la couche fusionne 7 sources et exactement 2 publient `NATURE_PROJET_DECLAREE` ; refuser de peindre une nature inconnue éteindrait le thème à Paris, Bordeaux et Nantes. |
| **Sitadel** — « même extrusion » | Prisme sur la parcelle, hauteur **linéaire**, 1 logement = 1 m, plafond 200 m. Un permis sans logements publiés garde son aplat au sol bordé de **sa propre couleur** au lieu du noir neutre. | `sitadelFrance.test.mjs`. Sol lu via `cachedGroundFloor` à l'ancre de **chaque parcelle** (un permis à trois parcelles sur une pente en enterrerait deux) ; cellule froide = parcelle laissée à plat et comptée. |
| **Mix électrique** — « prisme par région » | Hauteur = \|MW\|, couleur = signe en **deux teintes franches** plus une classe « équilibrée » pour la bande morte. Domaine gelé 12 000 MW ↔ 120 km. | `franceEnergy.test.mjs`. `balanceStyle()` ne renvoie plus `null` dans la bande morte : `null` veut désormais dire uniquement « non mesuré ». La Corse devient une emprise plate **hachurée**, plus un trou. |
| **Bornes de recharge** — « sortir de l'aplat d'effectif » | Prisme : hauteur = points de charge (domaine gelé 12 000), couleur = densité sur une **ladder géométrique** 100/250/500/1 000/2 500 pour 1 000 km². | `irveFrance.test.mjs`. Registre re-mesuré en direct (24 requêtes ODRÉ, 227 007 points, 2026-09-03). Occupation des six classes : 11·27·28·19·7·4 contre 94·1·0·0·0·1 sur six intervalles égaux. |
| **Écoles** | Prisme linéaire, domaine gelé 2 600 établissements, couleur = densité, seuils ×2 : 40/80/160/320/640. | `schoolsFrance.test.mjs`. Export national du jour téléchargé (68 158 lignes) et passé dans `projectSchoolsDepartements` : 150 → 2 504, médiane 577, amplitude 1:16,7. Preuve du choix de la densité : Gironde et Yvelines tiennent 1 416 établissements chacune — même hauteur — et deux classes de couleur d'écart. |
| **Enseignement supérieur** | Prisme en **racine carrée** (déclarée), domaine gelé 400 000 étudiants, couleur = part des étudiants à bac+4 et au-delà. | `supFrance.test.mjs` construit le jumeau linéaire et prouve qu'il écraserait 51 des 96 départements sous le plancher, médiane comprise (9 109 contre un plancher à 13 333). Densité **refusée** comme couleur : ρ de Spearman 0,974 avec l'effectif. |
| **Séismes** — « la profondeur devient géométrie » | Une **règle de profondeur** qui monte, longueur = profondeur focale à 1:1, déclarée en capitales comme échelle de lecture. Magnitude = diamètre **linéaire en pixels constants** (6 px à M2,5, +3 px par unité). Couleur libérée → âge sur 4 bandes horaires gelées. | `earthquakes.test.mjs`. Les deux autres options sont réfutées par la mesure, pas par principe (voir « appris »). Trois pièges `Number(null) === 0` corrigés : sans eux une profondeur absente valait 0 km et un horodatage absent tombait dans la bande **la plus ancienne**. |
| **Navires** — « le navire à son échelle réelle » | Sous le seuil, coque en **unités monde** orientée au cap ; au-dessus, flèche en pixels constants d'aire ∝ longueur. Seuil **dérivé** des optiques : 15,6 km, la distance à laquelle une coque de 200 m couvre encore 10 px. | `aisLiveVessels.test.mjs`. Deux runs AISStream réels : 18,0 % puis 16,2 % des MMSI publient une coque exploitable ; 1 709 blocs de dimensions sur 4 307 étaient tout à zéro. Les sentinelles AIS (511 m, 63 m) sont refusées explicitement. Le proxy a été câblé pendant ce passage et la rupture de contrat qui en a résulté corrigée (incohérence 7 bis) : la coque est désormais réellement atteignable, mais **elle n'a jamais tourné à l'écran**. |
| **Bouées** — « tige verticale ∝ Hs » | Tige en unités monde, exagération **×10 000** publiée en clair, plancher 2 km, domaine gelé 14 m (sommet de la dernière bande nommée de l'échelle OMM). | `marineBuoys.test.mjs` lit le source pour garantir qu'aucun `scaleByDistance` n'entre. Relevé NDBC réel du jour : 898 stations, 266 à capteur, médiane 0,8 m, max 4,1 m. **Violation D1 préexistante corrigée au passage** : la couche n'avait aucune légende alors que sa couleur portait une valeur. |
| **Barrages** — « extrusion, ou taille ∝ longueur » | Quatre classes d'envergure à seuils gelés (100/300/1 000 m), 18/13/9/6 px, plus un anneau creux pour les non mesurés. **`height` refusé** et le refus chiffré. | `damsPack.test.mjs` verrouille le refus par assertion. `height` est mesuré à **171 objets sur 7 432 (2,30 %)** : l'extruder aurait produit une carte de 171 objets et 7 261 valeurs par défaut. `spanM` couvre 5 328 (71,69 %). |
| **Datacenters** — « dessiner l'emprise » | Quatre signes : volume extrudé 461 (10,6 %), dalle plate 2 739 (63,0 %), contour de site 317 (7,3 %), anneau creux 834 (19,2 %). Hauteur convertie depuis `building:levels` par un facteur **mesuré** : médiane 5,0 m/niveau sur les 59 objets portant les deux tags. | `datacentersPack.test.mjs`, `localGeojson.test.mjs`. Un contour de site n'est **jamais** extrudé, même quand un cartographe y a posé une hauteur (5 cas). |
| **Antennes mobiles** — « hauteur du support, azimut » | Fût à la hauteur réelle en unités monde ; secteurs **uniquement pour le support sélectionné**, et en rayons, pas en cônes. | `anfrFrance.test.mjs`. Couverture mesurée : 99,24 % (72 149 des 72 700), médiane 30 m, max 343,3 m. Les 551 sans hauteur sont exactement les 506 « intérieur sous-terrain » + 38 « tunnel » + 7 « galerie ». L'azimut est **mesuré absent** de l'observatoire (en-tête CSV relu en direct, 22 colonnes) et présent dans Cartoradio à 98,8 %. |
| **Comptages routiers** — « curseur horaire + forme du rythme » | Sept classes de rythme mesurées sur le pack réel (2 977 arcs × 168 h) ; couleur = rythme, largeur = débit, curseur horaire à 48 tranches. | `comptagesRhythm.test.mjs`, `comptagesParis.test.mjs`. Le curseur ne reconstruit **aucun vertex** : la géométrie est bâtie une fois par bande de largeur et le curseur n'écrit que `show` (G2). 6 287 instances en 8 draw calls, bornées par `comptagesReachableBands()` à 58,1 % du produit cartésien. |

### Cohérence de grammaire — trois verdicts

**① Les couches énergie ne partagent pas d'échelle, et c'est un problème chiffré.** Quatre couches encodent des mégawatts, sur quatre lois différentes :

| Couche | Loi | Plage | Ce qui sature |
|---|---|---|---|
| `edf-power-plants` | `7 + 0,27·√MW` px, plafond 26 px | 74 → 5 460 MW | à 4 953 MW (Gravelines est écrêtée) |
| `fr-hydro-plants` | `4,5 + 0,62·kW^0,25` px, plafond 22 px | 40 kW → 1 800 MW | à 633 MW |
| `rte-generation` | anneau ∝ `√(MW / référence)`, écrêté à 1 | ≥ 100 MW | — |
| `france-energy` | hauteur de prisme ∝ \|MW\| | 1 544 → 7 781 MW | à 12 000 MW |

Conséquence arithmétique, calculée sur les formules du dépôt : **une centrale de 900 MW fait 22 px chez `fr-hydro-plants` et 15,1 px chez `edf-power-plants`** — en aire, 380 px² contre 179 px², un facteur 2,1 pour la même puissance, sur la même carte, allumées ensemble. Et les deux couches déclarent la même borne haute (1 800 MW, Grand-Maison) : soit la même centrale est dessinée deux fois à deux tailles, soit l'une des deux bornes d'en-tête est fausse. À trancher.

**Ce n'est pas « il faut une échelle unique »** : les trois domaines vont de 40 kW à 5 460 MW, et une seule loi écraserait la petite hydro ou saturerait la grosse. Ce qu'il faut, c'est **un module partagé** — le patron du dépôt existe déjà (`franceDepartements.js`, `geoMeshThinning.js`, `choroplethPrism.js`) — exposant une loi MW→px et une loi MW→hauteur, avec un plancher déclaré « hors échelle » sous 1 MW pour la petite hydro. Aujourd'hui trois modules ont réinventé trois exposants sans se citer, et `frHydroPlants.js` se contredit lui-même : sa ligne 46 promet *« area proportional to installed power »* quand sa ligne 224 calcule une racine **quatrième**, donc une aire proportionnelle à √P.

**② Deux prismes allumés ensemble sont un piège, et il n'est déclaré nulle part.** Vérifié dans le code :

- Les quatre prismes partagent **exactement la même enveloppe géométrique** : `PRISM_MIN_HEIGHT_M = 4 000`, `PRISM_MAX_HEIGHT_M = 120 000`, `PRISM_BASE_HEIGHT_M = 0`. Quatre unités différentes dans le même volume d'écran.
- `irve-fr` et `france-energy` ont des règles **pixel pour pixel identiques** : `domainMax` 12 000 tous les deux, mode linéaire tous les deux, `heightTicks: [10 000, 5 000, 1 000]` tous les deux. Les trois barres de leur légende ont donc la même hauteur et les mêmes chiffres, pour des points de charge d'un côté et des mégawatts de l'autre. La coïncidence des deux 12 000 fait ressembler le piège à une échelle.
- `irve-fr`, `schools-fr` et `sup-fr` extrudent **les mêmes 96 polygones depuis la même base ellipsoïdale**. Deux d'entre elles allumées ensemble donnent deux volumes translucides coïncidents : à `PRISM_BODY_ALPHA = 0,62`, l'alpha composité dans le recouvrement vaut 0,86 et aucune des deux arêtes supérieures n'est lisible.

La mitigation existe à moitié : `prismLegend()` publie le domaine de **sa** couche en toutes lettres (« Le plus haut prisme fait 120 km pour 12 000 points de charge, borne gelée »). Ce qu'aucune légende ne dit, c'est que **ce sommet ne se compare pas à celui d'à côté**. `choroplethPrism.js` écrit même l'inverse sans le vouloir : « *every prism starts at the SAME base, so tops are comparable* » — vrai à l'intérieur d'une couche, faux entre deux.

**Correctif minimal, une phrase dans `prismLegend()`** : ajouter au blurb du titre de hauteur « *Cette règle ne mesure que cette couche : un prisme d'une autre couche à la même altitude ne dit pas la même chose.* » Correctif complet : exclusion mutuelle des couches à prisme sur la même maille, qui appartient à `manager.js` / `layerState.js`, hors périmètre.

**③ « Échelle de lecture » et « unités monde » coexistent — c'est légitime, et ça méritait une règle.** Écrite dans la doctrine sous le numéro **F7 — « Une hauteur déclare son registre et son domaine »** ([`CARTOGRAPHIE.md`](./CARTOGRAPHIE.md), section F), et marquée comme ajoutée par ce chantier. Elle distingue **trois** registres et non deux, parce que `earthquakes` en a inventé un troisième : *longueur vraie, position conventionnelle*.

Le point qui rend la règle nécessaire plutôt que décorative : ce n'est pas la coexistence qui pose problème, c'est le **recouvrement d'amplitude**. Mesuré, il n'y en a presque pas — le mont Blanc est à 4 810 m, le plus haut mât ANFR à 343,3 m, un immeuble BD TOPO à ~200 m, et les registres d'échelle commencent à 2 km (bouées) et 4 km (prismes). L'ambiguïté est donc impossible **par la géométrie**, ce qui vaut mieux qu'une légende. Deux exceptions :

- `sitadel-fr` pose 1 logement = 1 m avec un plafond de 200 m, c'est-à-dire **exactement dans la plage des volumes BD TOPO réels**, et son en-tête dit que c'est délibéré (« lire le prisme contre la ville où il se dresse »). Un prisme de 27 m à côté d'un immeuble de 27 m est deux fois la même longueur et deux fois autre chose. Toléré parce que la légende le dit — mais c'est le seul endroit du dépôt où la lecture repose sur la légende et pas sur la géométrie.
- **Contrainte pour la suite** : la « tige d'altitude » que l'audit propose pour les vols occuperait 0–13 km, avec le même signe, le même pied au sol et la même verticale que la règle de profondeur des séismes (1–700 km). Sous 13 km les deux seraient indiscernables. F7 interdit de livrer la seconde avec le signe de la première.

### Non fait, et pourquoi

- **Le Dorling de `sup-fr`.** Explicitement remis à plus tard par le chantier, sous « Not in this pass ». La base normalisée (une colonne au centroïde) est exacte mais supprime le polygone — donc la carte — et fait entrer en collision les huit départements d'Île-de-France, précisément là où sont les valeurs.
- **Les trois autres couches énergie en volume** (« Groupes de production », « Centrales EDF », « Petite hydro »). Hors périmètre des seize chantiers, et le verdict ① ci-dessus dit qu'il faut d'abord un module d'échelle partagé, pas trois cylindres de plus.
- **FIRMS en H3, Hub'Eau, stations météo, Géorisques WMS, bruit extrudé, îlots de fraîcheur en isochrone, médecins à la commune, réseau IDFM agrégé, emprises des aéroports / ports / sites militaires, satellites en empreinte au sol, tige d'altitude des vols, animation du trafic.** 23 propositions ouvertes. Aucune n'a été tentée : le chantier a délibérément concentré l'effort sur l'axe Z et sur le bâti thématique, qui sont les deux pistes qui changent l'écran.
- **`local-datacenters` sur les 3D Tiles photoréalistes.** `RELATIVE_TO_GROUND` est relatif au terrain du globe et non au tileset : un volume s'appuie sur le terrain pendant que le toit du maillage est là où il a été photographié. Les *geometry updaters* de Cesium n'ont pas de référence de hauteur 3D-Tiles — seuls les billboards et les points en ont. Documenté dans l'en-tête, pas corrigeable ici.
- **Aucune QA navigateur.** Voir l'avertissement en tête de section. C'est la seule chose que je recommanderais de faire avant de fusionner.

### Ce que l'application a appris

C'est la partie qui vaut d'être lue : **six des seize chantiers ont livré autre chose que ce que cette note demandait, et à chaque fois parce qu'une mesure a réfuté le brief.**

**1. Le brief se trompait sur les séismes, et le globe opaque n'est pas un obstacle technique — c'est la raison.** L'audit demandait « l'hypocentre à sa profondeur réelle, sous la surface ». Les trois options ont été construites et regardées dans un vrai navigateur. (a) Une tige souterraine avec `disableDepthTestDistance` traverse la planète : parké à l'antipode du séisme le plus profond du jour (Fidji, 581 km), **26 des 28 événements M2,5+ sont sur l'hémisphère opposé et se projettent tous les 26 dans le cadre 1440×900** — Fidji et Tonga peints sur le Mali, le Niger, la Türkiye et le Royaume-Uni. Et en vue rasante, une tige souterraine se projette dans **exactement la même direction écran** qu'une ligne posée à plat sur l'eau venant vers la caméra : vu d'en haut, « vers le bas » et « vers moi » sont les mêmes pixels. (b) `scene.globe.translucency` fait passer la scène **entière** de 0,30 ms à 1,30–2,40 ms de médiane, payé par toutes les autres couches, pour la symbologie d'une seule — et `scene.globe` est un objet global qu'aucune couche ne possède. La bonne réponse est une **règle dressée vers le haut**, déclarée comme telle. Le brief prescrivait le geste évident ; l'évident était faux.

**2. « Cercle proportionnel » et « hauteur d'extrusion » ne sont pas le même geste, et la note les confondait.** La piste 1 et la piste 2 se citaient l'une l'autre comme si la racine carrée du cercle se transposait à la hauteur. Elle ne se transpose pas : **une aire se corrige en racine, une longueur se lit directement.** Appliquer la racine à une hauteur corrige un biais absent et sous-estime tous les rapports. Trois des quatre prismes sont donc linéaires, et le seul en racine — `sup-fr` — l'est pour une raison entièrement différente : son domaine fait 1:535 et une règle linéaire écraserait 51 départements sur 96 sous le plancher, médiane comprise.

**3. « Hauteur = effectif, couleur = taux » ne suffit pas : le taux doit être décorrélé.** Le brief supposait qu'un rapport quelconque fait l'audit de l'effectif. Mesuré sur `sup-fr` : la densité d'étudiants a un **ρ de Spearman de 0,974** avec l'effectif et déplace un département de 4,3 rangs sur 96 en moyenne — la teinte aurait redit la hauteur, soit A3 deux fois. La couleur y est donc devenue la part des étudiants à bac+4 (ρ 0,880, 10,4 rangs), avec le coût écrit dans la légende : **elle n'audite plus le biais d'aire**, et le module le déclare au lieu de le corriger.

**4. L'argument qui protégeait l'aplat d'effectif depuis des mois était un artefact de discrétisation.** Trois modules refusaient la densité en citant « 95 départements indistinguables ». Recompté sur `irve-fr` : sur six intervalles **égaux**, l'occupation des classes est 94·1·0·0·0·1 — d'où le chiffre. Sur une ladder **géométrique** gelée (100/250/500/1 000/2 500 pour 1 000 km²), elle est 11·27·28·19·7·4, chaque classe habitée. Ce n'était pas une propriété de la donnée, c'était le choix des bornes. Et les quantiles ont été refusés au passage pour la raison C1 : ils sont une propriété de l'échantillon, donc un département changerait de classe parce qu'une bande du balayage a été perdue.

**5. Le canal taille était déjà pris partout, par des variables que personne n'avait déclarées.** Trouvé en le libérant, pas en le cherchant : la flèche AIS portait **trois paliers de vitesse** (0,60 / 0,68 / 0,78) sans légende ; le point des bouées portait un booléen « a un capteur » (9 px contre 6) ; le point des barrages portait un **échelon d'importance éditorial** ; les satellites portent encore une « prominence de groupe ». A3 se viole surtout par omission — un canal qu'on croit vide.

**6. Passer en 3D *supprime* des contraintes Cesium au lieu d'en ajouter.** La note le pariait ; la source embarquée le confirme, et va plus loin que le pari. `_isOnTerrain` renvoie `false` dès que `extrudedHeight` est défini (`index.js:148334-148336`), donc `polygon.classificationType` est **lu puis ignoré silencieusement** sur un prisme : la classification n'était pas « perdue », elle n'existait déjà plus. Corollaires : le bug du `GroundPrimitive` batché qui colorie par le **rectangle englobant** de chaque instance disparaît de lui-même ; et Cesium ne force `outline: false` que sur du terrain (`index.js:61110-61113`), donc le prisme récupère la silhouette et l'arête de lecture que l'aplat n'a jamais pu avoir. En revanche l'inverse est vrai aussi et il a fallu l'écrire : une empreinte **plate** doit garder son `classificationType`, sinon elle est enterrée sous 2 km de relief alpin.

**7. Le prisme descendant est inimplémentable, et le mesurer valait mieux que le décréter.** L'intuition « import vers le bas, export vers le haut » a été construite avant d'être abandonnée. `Globe.translucency.enabled` vaut `false` par défaut (`index.js:208871`), c'est une propriété de scène qu'aucune couche ne possède, et sur la pile photoréaliste le globe est masqué de toute façon (`main.js:237`). Deuxième raison, plus profonde : **un graphique à barres signées ne marche que parce que sa ligne zéro est droite**. Ici le datum est une sphère, et comparer 7 781 MW vers le haut en Auvergne à 6 478 MW vers le bas en Île-de-France, c'est mesurer deux longueurs de part et d'autre d'un limbe courbe — exactement la comparaison que le prisme existe pour rendre facile.

**8. `Number(null) === 0` a piégé trois chantiers indépendants.** Une ligne sans longitude part au large du Ghana et se compte comme « a raté un bâtiment » ; une profondeur absente devient 0 km ; un horodatage absent devient 1970, donc la bande **la plus ancienne**. Les trois chantiers ont convergé sur la même réponse sans se parler : **deux compteurs d'absence, jamais un** — « non localisé » et « localisé mais hors emprise » ne sont pas le même aveu.

**9. Le refus documenté et chiffré est un livrable, au même titre qu'un dessin.** L'audit demandait d'extruder les barrages par `height`. Mesuré : **171 objets sur 7 432, soit 2,30 %**. La couche a refusé, verrouillé le refus par une assertion, et déplacé le canal taille sur `spanM` (71,69 %). Même geste pour l'enveloppe constructible du GPU, que la note refusait déjà — et le chantier Sitadel a étendu l'argument d'un cran : un volume fantôme à hauteur **fixe** pour la démolition a été écarté parce que **toute constante est un nombre sur l'échelle même que le fichier ne publie pas. A1 en trois dimensions.**

**10. Le brief demandait `getStats().legend` ; rien dans le dépôt ne le lit.** Les légendes passent par `getRowControls()`, seul chemin que `manager.js` monte à la fois dans la ligne de panneau **et** dans le bloc sur la carte. Deux chantiers ont commencé par câbler un champ mort. Et le vrai plafond de la règle D1 n'est pas dans les couches : `manager.js:2470` concatène `_formatCount(item.count)` **sans garde**, et `_formatCount(undefined)` renvoie la chaîne `"undefined"` — six chantiers sur seize l'ont signalé indépendamment. Le bloc **sur la carte** (`:2612`) garde correctement avec `Number.isFinite`. C'est la correction d'une ligne la plus rentable du dépôt.

**11. Deux bugs réels trouvés en passant, dont un qui annulait toute la règle D1 sur une couche.** `aisLiveVessels.getRowControls()` gardait sur `records.size` alors que `state.vesselRecords` est un **tableau** : `undefined` étant *falsy*, le retour anticipé partait à chaque appel et la couche dont la teinte est le seul indice n'avait **jamais** affiché de légende, ni dans le panneau ni sur le point de montage `#map-legend` ajouté exprès pour D1. Et `schoolsFrance.clearSelection()` repeignait **avant** de vider `_selectedId`, donc le repaint remettait le cyan sur l'entité qu'on désélectionnait — défaut préexistant sous l'aplat, beaucoup plus voyant sur un volume de 100 km.

**12. La redondance n'est pas un défaut quand les deux canaux sont lisibles à des distances disjointes — mais il faut le calculer.** Trois chantiers ont gardé un point *et* un volume, et les trois l'ont justifié par de l'arithmétique et non par du goût. `sitadel-fr` : à 12 000 m, le sol fait 19,2 m/px, donc un prisme de 200 m fait 10 px et celui d'un logement 0,05 px ; à 300 m, 0,48 m/px, le prisme d'un logement fait 2 px et sa parcelle 58 px. Le point est la couche du haut de la plage, le prisme celle du bas, et **ni l'un ni l'autre ne fait le travail de l'autre**. C'est le test qu'il faut exiger de toute redondance future.

### Incohérences transversales relevées, non corrigées

Rangées par ce qu'elles coûtent. **Trois d'entre elles ont été corrigées pendant ce passage** — deux par la passe d'intégration qui tournait en parallèle (`manager.js`, `vite.config.js`), la troisième par moi parce qu'elle était la conséquence directe des deux autres et qu'elle cassait la livraison la plus visible du chantier. Elles sont barrées plutôt que supprimées : ce sont les défauts que seize chantiers en parallèle ont produits, et c'est une information sur la méthode.

| # | Incohérence | Où | Pourquoi ce n'est pas fait ici |
|---|---|---|---|
| ~~1~~ | ~~`_formatCount(undefined)` → la chaîne `"undefined"` dans la ligne de panneau~~ | `manager.js:2470` | **Corrigé pendant ce passage**, par la même garde `Number.isFinite` que le bloc sur carte. Six chantiers sur seize l'avaient signalé indépendamment. `manager.test.mjs` : 117 tests, 0 échec. |
| 2 | Une taille **thématique** composée avec `scaleByDistance` — le défaut exact retiré de `bikeshare.js` au passage précédent | `edfPowerPlants.js:639`, `frHydroPlants.js:692`, `hubeauHydrometry.js:1071`, `meteoStationsFrance.js:589` | Hors périmètre, et **change le rendu de quatre couches sans QA visuelle**. Chiffré pour Hub'Eau : la taille couvre 5 → 15 px sur log₁₀(débit), et la rampe de distance couvre 1,3 → 0,45, soit un facteur 2,89 — **le canal de distance est aussi large que le canal de donnée**. En vue oblique depuis 300 km, une station à 1 m³/s vue de près fait 7,3 px et le Rhône en crue à 5 000 m³/s vu à 900 km en fait 6,75. Facteur 5 000 sur la donnée, inversion à l'écran. |
| 3 | `_points.removeAll()` sur un **chemin de filtre** — le destructeur que G2 nomme, à la ligne exacte qu'elle cite | `frHydroPlants.js:677`, atteint par `setParams` → `_floorKw` → `repaint()` ; `PointPrimitiveCollection.prototype.removeAll` pose `_createVertexArray = true` (`index.js:149904-149910`) | Hors périmètre. Le curseur de plancher de puissance reconstruit le tableau de sommets à chaque cran. |
| 4 | `frHydroPlants.js` se contredit : ligne 46 « *area proportional to installed power* », ligne 224 `kW^0,25` (donc aire ∝ √P) | `frHydroPlants.js` | Hors périmètre. La ligne 205-211 explique correctement la racine quatrième ; c'est le résumé du haut qui est faux. |
| 5 | Le titre du bloc de légende **sur la carte** est le nom de la couche : un lecteur voit les classes DPE sous « Bâti 3D (FR) » | `manager.js` | Hors périmètre. `getStats().themeLabel` est publié et attend un lecteur. |
| ~~6~~ | ~~Les trois versions de cache disque du proxy~~ | `vite.config.js` | **Corrigé pendant ce passage** : `IRVE_NATIONAL_CACHE_VERSION` 3 → 4, `SCHOOLS_NATIONAL_CACHE_VERSION` 2 → 3, `SUP_CACHE_VERSION` 1 → 2. Les trois rollups avaient changé de forme et le cache disque vit de 1 à 7 jours. |
| ~~7~~ | ~~La capture des dimensions AIS n'est pas câblée dans le proxy~~ | `vite.config.js`, `ingestAisStreamEnvelope` | **Câblé pendant ce passage**, mieux que ne le proposait le rapport du chantier : le proxy stocke le bloc réduit entier (`hull`) au lieu de le ré-éclater en quatre offsets que le client re-réduirait. Un `StaticDataReport` étant scindé en deux parties, un `null` conserve la réponse précédente au lieu de l'effacer, et un nouveau bloc REMPLACE l'ancien (un transpondeur reconfiguré est une nouvelle déclaration, pas un trou à combler). **Voir la ligne 7 bis** : ce câblage a créé une rupture de contrat que j'ai corrigée. |
| **7 bis** | **Rupture de contrat proxy ↔ client, corrigée ici.** Le proxy publiait `row.hull = {loaM, beamM, toBowM, toPortM}` ; `vesselHullFromRow()` ne lisait que `row.to_bow…` puis `row.length` / `row.beam`. Aucune des deux formes n'étant présente, **100 % des contacts retombaient sur le chevron « non mesuré » pendant que le proxy faisait correctement son travail** — panne totale, silencieuse, et honnêtement légendée « dimensions non reportées ». | `aisLiveVessels.js:1400` contre `vite.config.js:17310` | **Corrigé** : `vesselHullFromRow()` accepte désormais trois formes publiées — le bloc déjà réduit d'abord (seul chemin sans perte), les quatre offsets AIS, puis `length`/`beam`. Le bloc est **re-validé** et non pas cru : un proxy a le droit d'avoir tort, et une longueur nulle ou non finie doit arriver « non reportée » et jamais « navire de longueur zéro ». Quatre tests ajoutés dans `aisLiveVessels.test.mjs`, 163 tests AIS au vert. |
| 8 | `scripts/qa-irve-fr.mjs` va échouer : il exige que **toute** ligne de légende nationale porte une couleur de la rampe violette et que les comptes se somment par bin. La légende du prisme a des titres (`color: null`), trois repères en graphite et des lignes de refus | `scripts/` | Hors périmètre. `qa-schools-fr.mjs` a été ménagé exprès (la sous-chaîne `/départements/i` survit) ; `qa-maritime.mjs` ne teste rien de la tige. |
| 9 | `sitadelFeed.js:994` écrit `finiteOrNull(row.NB_LGT_TOT_CREES) ?? 0` : un zéro publié et une cellule vide arrivent comme le même nombre | `sitadelFeed.js` | Hors périmètre. La légende dit « ne créant aucun logement **ou** n'en publiant pas le nombre — les deux arrivent ici confondues » plutôt que de choisir. |
| 10 | `idfmFrequency.test.mjs` importe `COMPTAGES_FLOW_COLORS` pour tester la non-collision des palettes ; la rampe est conservée exportée mais **retirée de la carte** | `idfmFrequency.test.mjs` | L'assertion reste vraie mais vise une rampe qui ne se dessine plus. À réorienter vers `COMPTAGES_RHYTHM_COLORS` (collision la plus proche mesurée : idfm-rail `#3d8bff` contre nocturne `#4f63d6`, ΔE 18,0). |
| 11 | `.context/gev-inventaire.json` décrit encore le régime national d'`irve-fr` comme « 6 bins de quantiles » et cite `irveDepartementBinLabels`, fonction supprimée | `.context/` | Artefact de recherche, pas du code. |
| 12 | Un commit (`0d51e2b`) a été posé **pendant** le chantier alors que la consigne l'interdisait, sous un titre qui décrit le passage précédent, et il embarque `buildingTheme.js` et `choroplethAlpha.js` | historique git | Signalé, pas défait. Le diff de `franceEnergy.js` a par ailleurs été reconstruit après un `git checkout` accidentel et mérite une relecture d'intégration. |
| 13 | **Un test rouge, à l'instant où j'écris.** `franceEnergy.test.mjs` — « the deadband stops claiming a DIRECTION, not a measurement » — épingle une bande morte **symétrique fermée** (`balanceStyle(+1 MW)` = importer), alors que `balanceStyle()` vient d'être réécrite en intervalles **semi-ouverts** `(-∞,-1] (-1,1] (1,+∞)` pour s'aligner sur `prismRatioBin`, dont la règle est `v <= breaks[i]`. Le commentaire ajouté dit pourquoi, et le motif est réel : à exactement +1 MW le corps du prisme était peint « équilibrée » pendant que l'étiquette flottant dessus disait « IMPORTE 1 MW ». | `franceEnergy.js:400-410` contre `franceEnergy.test.mjs:112` | **Non corrigé volontairement.** Le fichier a été modifié pendant que je rédigeais (mtime 11:27, ce rapport 11:28) : un autre passage d'intégration est en cours dans ce module, et deux écrivains sur le même test se battraient. C'est le CODE qui a raison et le test qui est périmé de deux assertions ; l'auteur du changement doit les retourner. **À vérifier avant de fusionner.** |

**Trois corrections que j'ai faites**, parce que ce sont des affirmations ou des contrats que ce chantier a rendus faux et qu'aucun agent ne possédait :

- `src/data/aisLiveVessels.js` — la rupture de contrat 7 bis ci-dessus, plus quatre tests. C'est la seule des trois qui change ce qui est dessiné, et c'est la seule qui remet en marche une livraison qui, sans elle, était inerte.
- `src/data/choroplethPrism.js` — l'en-tête affirmait que `extrudedHeight` n'apparaît qu'**une fois** dans tout `src/data`. C'était vrai à l'écriture et faux quatre heures plus tard. Mis au passé, avec le recompte et un renvoi vers ce document.
- `src/data/choroplethAlpha.js` — l'en-tête se présentait comme « l'échelle partagée par les quatre choroplèthes d'effectif ». Trois d'entre elles sont parties en prisme ; il n'en reste **qu'une** (`amenities-fr`). L'en-tête dit désormais qui l'utilise, pourquoi un prisme ne doit pas l'utiliser, et qu'il ne faut pas le supprimer comme mort.

### Ce que je ferais maintenant, dans cet ordre

1. **La QA navigateur.** Rien de ce chantier n'a été vu à l'écran. Quatre choses à regarder en priorité : deux prismes allumés ensemble, le seuil de coque AIS sur Rotterdam ou Le Havre, l'occultation des prismes Sitadel par le maillage photoréaliste, et l'encombrement du bloc de légende (les bouées seules y ajoutent 13 lignes).
2. **La phrase de non-comparabilité dans `prismLegend()`** (verdict ②). C'est la dernière correction d'une ligne qui reste ; les trois autres ont été faites pendant ce passage.
3. **Vérifier la coque AIS à l'écran.** Le contrat proxy ↔ client vient d'être réparé et n'a jamais tourné en vrai : un port dense (Rotterdam, Le Havre) répond en une minute à la question « le seuil de 15,6 km est-il le bon ».
4. **Le module d'échelle de puissance partagé** (verdict ①), avant d'ajouter le moindre cylindre aux trois couches énergie restantes.
5. **Retirer les quatre `scaleByDistance` composés** (incohérence 2), avec une capture avant-après par couche.
