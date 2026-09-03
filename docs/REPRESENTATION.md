# Ce que GEV dessine, et ce qu'il pourrait dessiner

*Audit dataset par dataset du **vocabulaire graphique**, pas de son honnêteté. Suite de `CARTOGRAPHIE.md` (la doctrine) et de `PLAN-CARTOGRAPHIE.md` (les correctifs appliqués le 2026-09-03).*

---

## Pourquoi le passage précédent ne se voit pas

Il ne se voit pas parce qu'il ne devait pas se voir. Le plan appliqué portait sur la section A de la doctrine — l'honnêteté — et une correction d'honnêteté réussie est invisible par construction : `FL328` disparaît, le `°` disparaît, un cône devient tireté, un alpha descend au lieu de monter. Vingt-cinq correctifs, dont dix-neuf changent un chiffre ou un attribut sans changer un signe.

**Aucun d'eux ne change ce que GEV *est capable de dire*.** Le vocabulaire graphique du produit n'a pas bougé d'un iota, et c'est lui, le sujet de cette note.

### Le recensement, chiffré

| | |
|---|---|
| Couches de données | **52** |
| Dont le signe principal est un **point coloré** (billboard ou `PointPrimitive`) | **39** |
| Qui peignent les **mêmes 96 polygones départementaux** | **10** |
| Qui dessinent une **ligne** comme objet principal | 6 |
| Occurrences de `extrudedHeight` dans tout `src/` | **3** — deux dans les annotations utilisateur, **une seule** dans une couche de données (`bdtopoBuildings.js:599`, et c'est la hauteur réelle du bâtiment, pas une variable thématique) |
| Cartes de flux | **1** (les cinq arcs frontaliers de `franceEnergy`) |
| Isolignes, surfaces continues, densité de points, anamorphoses, encodages bivariés, animations temporelles sur la carte | **0** |

Autrement dit : GEV est un globe 3D temps réel qui dessine **un atlas 2D de 1975 posé sur une sphère**. Les deux seuls signes qu'il connaisse vraiment sont *la punaise* et *le département peint*. Mericskay ouvre son cours sur la punaise et le département peint pour dire que ce sont les deux réflexes du géoweb dont il faut sortir.

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
