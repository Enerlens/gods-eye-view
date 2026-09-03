# Doctrine cartographique de God's Eye View

*D'après le corpus pédagogique de Boris Mericskay, confronté à ce qu'est réellement GEV : un globe 3D temps réel.*

---

## Pourquoi ce document

Boris Mericskay est maître de conférences en géographie et géomatique à l'Université Rennes 2, co-responsable du master de géomatique SIGAT, membre de l'UMR ESO. Il coordonne au sein du GdR MAGIS l'action de recherche « (Carto)graphies et (Géo)visualisations de données ». Son travail porte exactement sur l'objet que GEV est devenu : la cartographie en ligne, la géovisualisation de données massives, et le régime de représentation propre au Géoweb.

Ce document extrait de son enseignement ce qui tient pour GEV, après l'avoir passé au filtre de trois critiques : celle d'un moteur 3D temps réel, celle de l'état de l'art 2026, celle du produit et de son public. **Ce n'est pas un résumé de Mericskay.** Une règle qui n'a pas survécu à la critique est reléguée en fin de document, avec sa raison.

Chaque règle porte un **test de conformité** : on doit pouvoir regarder une couche de GEV et répondre oui ou non.

### Ce qui a été réellement lu

27 sources accessibles sur 28. Le détail figure en [bibliographie](#bibliographie). L'essentiel :

- **`CM_SemiologieGraphique_2020.pdf`** — 116 diapositives, lues intégralement, y compris les diapositives-images rendues en PNG jusqu'à 260 dpi pour vérifier les verbatims.
- **`Intro_Dataviz.pdf`** (101 dia.), **`geoviz2018.pdf`**, **`Spatiotemporel.pdf`**, **`AnalysespatialeM1.pdf`**, **`Leaflet.pdf`**, **`Cours_MapboxGL.pdf`**, **`Intro_Overpass.pdf`**, **`OverpassTurbo_SOTM_2022.pdf`**.
- **« La géovisualisation de données massives sur le Web »**, *Mappemonde* 131, 2021 — l'article le plus directement pertinent pour GEV.
- **« La cartographie à l'heure du Géoweb »** (HAL, halshs-01468314).
- **`Communication cartographique`** (ISTE, 2022), qu'il coordonne — avant-propos et introduction lus intégralement.
- Ses deux tutoriels **Geotribu** sur MapLibre et les tuiles vectorielles.

Une seule source est restée fermée : l'index du répertoire `Cours/` du master SIGAT (403), ce qui n'a coûté aucun support — tous ont été atteints par leur URL directe.

---

## Le cadre : règles et séduction

Mericskay ouvre l'ouvrage qu'il coordonne sur la question qui est exactement celle de GEV — le chapitre 1 s'intitule « Les facettes du cartographe : une communication entre **règles et séduction** ». Il ne tranche pas en faveur des règles.

> « une carte, quels que soient son support, sa forme, son concepteur ou son contexte d'utilisation, répond toujours au même objectif : simplifier la réalité pour transmettre une information, communiquer un message. »
> — Mericskay, *Communication cartographique*, introduction, 2022

Sa conclusion sur le Géoweb est encore plus nette, et elle vaut absolution pour le parti pris de GEV :

> « Un vaste chantier s'ouvre ainsi aux "professionnels" de la carte, **non pas pour en garder le contrôle**, mais surtout pour que la carte sur Internet conserve ses spécificités et une certaine rigueur. »
> — « La cartographie à l'heure du Géoweb »

Le spectacle n'est donc pas disqualifiant. Ce qui est disqualifiant, c'est le diagnostic qu'il porte sur les « nouveaux cartographes » — et GEV doit se demander s'il en est :

> « Pas de culture de la "carte" et de ses "règles" de constructions • **Peu de recul sur les données (qualité, MAJ, intégrité, exhaustivité,…)** • Emphase sur le visuel, le design, le graphisme »

Et sa charge sur la dérive :

> « Les cartes en ligne sont, en effet, très axées autour de la Dataviz, où l'objectif est de proposer des visualisations esthétiques et séduisantes, **souvent au détriment des "règles conventionnelles" de la cartographie thématique**. »

Enfin, la phrase qui désigne GEV sans le savoir — écrite en 2016, elle décrit le produit :

> « **Le véritable défi sémiotique du géoweb réside dans les modalités de représentations graphiques de nouvelles formes de données numériques en temps réel** relatives par exemple à la mobilité, aux réseaux sociaux ou aux mesures provenant des capteurs connectés toujours plus nombreux. Pour le moment les solutions en ligne réutilisent pour beaucoup les moyens graphiques existants en essayant de les transposer à ces nouvelles données. »

ADS-B, AIS, TLE, USGS, FIRMS, DATEX2, GBFS, GTFS-RT, Météo-France, CANDHIS : GEV est le cas d'espèce. Mericskay dit que recycler les signes statiques sur ces flux est un échec — et que le chantier est ouvert.

### Un point que le corpus ne peut pas voir

Mericskay écrit pour une carte 2D : cadrage fixe, échelle unique, projection déclarée, population entière visible, temps figé, pas d'axe Z, pas de budget par image. GEV est l'inverse terme à terme. **Presque toutes ses règles restent vraies dans leur intention et fausses dans leur forme.** La barre d'échelle, le blanc pour la donnée manquante, les cercles proportionnels, le cluster à rayon écran, les 2 images par seconde : appliqués à la lettre, ils produiraient des cartes fausses sur un globe qui saccade.

D'où la structure de ce document : **fondement** (ce que dit le corpus) puis **transposition** (ce que la règle devient ici).

---

## A. Honnêteté — le socle non négociable

> Une violation de cette section trompe l'utilisateur. Elle est traitée comme un bug, pas comme un arbitrage de design.

### A1 · Jamais le même signe pour une valeur mesurée et une valeur par défaut — **P0**

**Fondement.** Le corpus l'exige à propos de la donnée manquante (« L'absence d'information est indiquée dans la légende et représentée en blanc sur la carte »), et à propos du recul sur les données : intégrité et exhaustivité.

**Transposition.** Sur GEV la question n'est pas la case vide d'un tableau, c'est la valeur de repli injectée pour que le rendu ne casse pas. Toute constante de secours qui atteint l'écran doit être marquée — glyphe fantôme, contour pointillé, mention explicite — ou ne pas atteindre l'écran du tout.

**Test.** Pour chaque champ affiché dans une fiche ou porté par une variable visuelle : existe-t-il une valeur de repli dans le code ? Si oui, un utilisateur peut-il distinguer les deux cas à l'écran ?

### A2 · L'âge de la mesure est une variable visuelle — **P0**

**Fondement.** C'est la demande explicite de Mericskay : concevoir « de nouveaux systèmes de signes adaptés à la fois aux informations à représenter, **à leurs temporalités**, aux publics visés comme aux dispositifs mobilisés ».

**Transposition.** Un mobile dont la dernière mesure réelle date de 90 s continue de glisser à 60 fps par navigation à l'estime : le rendu fabrique de la donnée 59 images sur 60. L'ancienneté doit être portée par le signe lui-même — alpha décroissant, traînée qui s'estompe, contour pointillé au-delà d'un seuil, puis purge — et **pas seulement par un badge textuel dans un panneau**. C'est l'encodage le moins coûteux qui soit s'il passe par l'attribut couleur déjà présent dans le batch.

**Test.** Sur une couche mobile, un objet vu il y a 5 s et un objet vu il y a 3 min sont-ils graphiquement différents sans ouvrir de panneau ?

### A3 · Un canal, une information — **P0**

**Fondement.** « Ce langage doit être clair et cohérent : évite l'excès de redondance, la surcharge… »

**Transposition.** Si l'opacité porte à la fois la fraîcheur et la distance au limbe, le lecteur ne peut plus lire ni l'une ni l'autre : un objet lointain et un objet périmé atterrissent au même alpha. Chaque variable visuelle porte une information et une seule ; si deux informations doivent coexister, il faut deux canaux orthogonaux.

**Test.** Pour chaque couche, lister les variables visuelles utilisées et l'information portée par chacune. Une variable qui apparaît deux fois est un défaut.

### A4 · Le vide a trois causes, et elles ne se ressemblent pas — **P0**

**Fondement.** Absent du corpus, qui n'a ni profondeur ni budget de rendu — c'est un angle mort identifié par la critique.

**Transposition.** Une zone sans symboles sur GEV peut signifier : (a) pas de donnée publiée, (b) donnée écrêtée par un plafond d'affichage, (c) objet occulté par le terrain ou le bâti. Ces trois vides sont aujourd'hui indiscernables. Le badge source/fraîcheur ne couvre aucun des trois.

**Test.** Face à une zone vide, l'interface permet-elle de trancher entre les trois causes ?

### A5 · Tout écrêtage se déclare — **P1**

**Fondement.** « Malgré un rendu visuel efficace, cette forme de généralisation des données est cependant **à utiliser avec prudence** dans la mesure où le processus de transformation graphique sous-jacent est davantage esthétique que rigoureux. » Échantillonner, clusteriser, faire une heatmap sont des **actes cartographiques**, pas des optimisations.

**Transposition.** Toute couche plafonnée affiche `n affichés / N connus` et le critère de sélection (les plus récents ? les plus proches ? les plus intenses ?).

*Le dépôt tient déjà cette règle par endroits* : `src/data/amenitiesFrance.js:165-171` documente que le plafond de 12 000 ne mord pas en production, que la charge utile arrive triée famille-la-plus-rare-d'abord, et que « whatever is dropped is counted and printed under the toggle ». C'est le patron à généraliser.

**Test.** Pour chaque constante de type `MAX_RENDERED_*` / `*_CAP` / budget de maille : l'utilisateur voit-il le compte écrêté et le critère ?

### A6 · Le fond de plan est une couche, pas un décor — **P1**

**Fondement.** C'est une critique frontale de Mericskay : l'espace géographique se réduit sur le Géoweb à « **un simple fond de carte, un support neutre** ». Le fond n'est jamais neutre.

**Transposition.** BD ORTHO a un millésime, les 3D Tiles ont une provenance et une date de campagne, le photoréalisme suggère une fraîcheur que l'imagerie n'a pas. Le bandeau source/fraîcheur affiché par couche doit couvrir aussi le fond.

**Test.** L'utilisateur peut-il savoir de quand date l'image qu'il regarde ?

---

## B. Sémiologie graphique

### B1 · Absolu → taille. Relatif → valeur. Jamais d'aplat sur un effectif brut — **P0**

**Fondement.** C'est la règle la plus martelée du corpus, énoncée deux fois dans le cours et reprise dans l'article :

> « La seule variable possible pour une donnée quantitative absolue c'est la taille. »
> « Une donnée continue absolue est le nombre total d'observations sur un territoire donné (pop, effectif, nombres de quelque chose) ◦ Pour la représenter, on privilégiera une variation de taille. / Une donnée continue relative est le rapport d'une donnée absolue dans un référentiel (densité, taux,…) ◦ On privilégiera une variation de couleurs (dégradé) »
> « Représentation d'une variable quantitative absolue en aplats de couleur — **NOP !!!!** »
> « **L'une des erreurs sémiologiques les plus courantes que l'on peut rencontrer sur le géoweb** se trouve au niveau de la représentation de données quantitatives absolues sous forme d'aplats de couleurs. »

**Transposition.** C'est le geste de **normalisation** qui autorise la choroplèthe, pas l'inverse. La règle se câble comme un garde-fou : chaque couche quantitative déclare son unité, `ratio` (taux, densité, prix au m², part) ou `count` (nombre de bornes, de médecins, de mutations). `count` interdit l'aplat.

**Nuance de la critique produit** : peindre un effectif brut *peut* se défendre quand la question de l'utilisateur est « où y en a-t-il beaucoup », à condition que ce soit **écrit sur la carte**. Ce qui est indéfendable, c'est de le faire silencieusement.

**Test.** Pour chaque `GroundPrimitive` ou polygone rempli par une valeur : la valeur classée est-elle un rapport ? Sinon, la légende dit-elle explicitement qu'il s'agit d'un effectif et que l'aire de la maille n'est pas neutralisée ?

### B2 · Sur un globe, la taille écran est déjà prise par la profondeur — **P0**

**Fondement.** Le corpus prescrit le cercle proportionnel. Bertin n'a pas d'axe Z.

**Transposition.** Un billboard subit déjà un facteur ~1/z. Câbler « rayon ∝ magnitude » par-dessus multiplie les deux : un séisme M7 lointain devient plus petit qu'un M3 proche — l'inversion exacte du message, **avec une légende qui affirme le contraire**. C'est pire que la punaise indifférenciée, parce que ça donne au lecteur une raison de croire ce qu'il voit.

Le quantitatif doit migrer sur un canal **orthogonal à la profondeur** : anneau de rayon fixe en pixels superposé au glyphe, valeur/luminance, ou hauteur d'extrusion lue contre un guide vertical. Si le rayon écran est utilisé, il doit être calculé en pixels constants (indépendant de `scaleByDistance`), pas en unités monde.

**Test.** Placer deux objets de valeurs très différentes à des distances très différentes. La hiérarchie visuelle correspond-elle à la hiérarchie des valeurs ?

### B3 · Six paliers déclarés ne font pas six paliers perçus — **P1**

**Fondement.** Le seuil chiffré le plus dur du corpus :

> « Le nombre de paliers différentiables est de 6 à 7 valeurs de gris **y compris le blanc et le noir**. »

**Transposition.** Sur GEV la couleur perçue est le résultat d'une chaîne : alpha blendé sur une orthophoto texturée — donc la même classe rend différemment sur un toit blanc et sur une forêt —, puis HDR et bloom, puis le post-process capteur, puis le gamma de l'écran. Compter six bandes parce que le cours dit six et se croire conforme est une erreur.

Deux corollaires opérationnels : ne pas compter sur l'alpha seul sous une couche zonale (poser un fond opaque désaturé, ou encoder par isolignes / motif) ; et valider le nombre de paliers en **mesurant** l'écart perceptuel des couleurs compositées sur un jeu de fonds témoins — c'est automatisable.

**Test.** Rendu hors écran sur trois fonds contrastés (eau, forêt, urbain clair) : deux classes adjacentes restent-elles séparables ? Deux classes distantes restent-elles ordonnées ?

### B4 · La teinte n'ordonne pas, mais elle porte des codes — **P1**

**Fondement.**
> « La variation de couleur est uniquement différenciatrice, elle est utilisée pour représenter des caractères qualitatifs […] **L'œil ne peut pas établir d'ordre !** »
> « Mais renvoi à des codes couleur familiers ! » (occupation du sol : rouge = artificialisé, jaune = terres arables, vert = forêt, bleu = eau)
> « Mélange de la variation couleur = incompréhension »

**Transposition.** Une échelle ordonnée doit varier en **valeur** (clarté), pas seulement en teinte. Quand un code culturel existe et qu'il est fort — vert/ambre/rouge pour la congestion routière, l'échelle Météo-France — il prime sur la pureté bertinienne, à condition de rester dans un seul registre.

Ajout de l'état de l'art : la recommandation contemporaine (Jégou, webinaire AR9 #16, juin 2024) est d'**adapter la luminosité du gradient à la progression de la donnée** plutôt que de reprendre un préréglage. « La donnée est plus lisible quand le gradient lui est adapté. »

**Test.** Convertir la rampe en niveaux de gris. L'ordre survit-il ? Simuler une deutéranopie. L'ordre survit-il ?

### B5 · Forme et taille ne mentent pas sur un type inconnu — **P0**

**Fondement.** « La forme : qualitatif seulement, 5 à 7 formes maximum. »

**Transposition.** Cas d'école dans GEV : une silhouette d'aéronef et une échelle de taille encodent une classe. Quand le classificateur retombe sur une valeur par défaut faute de code type, le glyphe **affirme** un type qui n'a pas été mesuré. C'est A1 appliqué à la forme. Il faut une silhouette « inconnu » et une échelle neutre.

**Test.** Le jeu de formes contient-il un signe explicite pour « non classé » ?

---

## C. Discrétisation, maille et méthode

### C1 · Discrétiser le phénomène, pas l'échantillon — **P0**

**Fondement.**
> « Le choix du mode de discrétisation est un problème délicat puisqu'il **détermine l'aspect de la carte et conditionne son interprétation**. »
> « Une discrétisation est satisfaisante lorsqu'elle permet la création de classes homogènes et distinctes entre elles. »
> « Nécessaire d'être à même d'expliquer les choix opérés. »

**Transposition — c'est la règle que la 2D ne pouvait pas formuler.** Le corpus discrétise une série close et immobile. GEV discrétise des flux dont la population change à chaque poll et un cadrage qui change à chaque frame. Discrétiser « la série » revient alors à faire dépendre la couleur d'un objet de la présence d'autres objets dans le champ : la même cellule change de couleur quand la caméra bouge, sans qu'aucune donnée n'ait changé.

**La règle correcte en temps réel : seuils de domaine constants**, exprimés dans l'unité du phénomène (magnitude, FRP en MW, nœuds, €/m² nationaux), gelés, publiés dans le panneau, **jamais recalculés depuis l'échantillon visible ni depuis le cadrage**.

**Test.** Cadrer une zone, capturer. Élargir le cadrage pour faire entrer des valeurs extrêmes d'un autre continent. La zone initiale a-t-elle changé de couleur ?

### C2 · La maille est une hypothèse de lecture, pas un fait — **P1**

**Fondement.** Le MAUP, auquel le cours consacre une section entière avant tout exercice :

> « Un problème d'agrégation spatiale (MAUP) est une source de biais statistique qui peut **affecter radicalement** les résultats […] Les sommaires résultants (ex. totaux, taux, proportions) sont influencés par le choix des limites du secteur. »
> « Une limite administrative correspond rarement à une discontinuité spatiale. »

**Transposition.** Une même couche vue en commune puis en département n'est pas la même carte. Le panneau doit nommer la maille active et, quand deux régimes coexistent, dire que le classement changerait avec un autre découpage.

**Test.** Le panneau nomme-t-il la maille ? La légende dit-elle de quoi elle compte les unités ?

### C3 · Sur une sphère, une maille en degrés n'est pas équi-aire — **P1**

**Fondement.** « La taille de la maille est LA question du carroyage » ; le corpus condamne la maille non métrique.

**Transposition.** Sa correction — mailler en mètres — n'est pas transposable telle quelle : il n'existe aucun pavage régulier lat/lon équi-aire, et la correction par `cos(lat)` laisse dégénérer les cellules polaires. Sur un globe : pavage quasi-équi-aire (H3, S2, HEALPix), ou à défaut **l'aire réelle de la cellule au dénominateur** et fusion au-delà de 60°.

Sans quoi, à comptage égal, les hautes latitudes sont peintes deux fois plus dense qu'à l'équateur — un artefact de maillage qui, sur une couche d'anomalies thermiques, produit un résultat géopolitiquement chargé.

**Test.** Deux cellules à comptage identique, l'une à l'équateur l'autre à 60° : rendent-elles la même couleur ? Si oui, c'est un défaut.

### C4 · Un taux ne s'agrège pas comme un effectif — **P1**

**Fondement.** « Ne jamais sommer une valeur relative. » « Un taux se calcule comme un rapport de sommes dédoublonnées, jamais comme une moyenne de taux. » « Après une jointure spatiale par distance ou tampon, le GROUP BY n'est pas optionnel. »

**Test.** Toute remontée commune → département recalcule-t-elle le numérateur et le dénominateur séparément ?

---

## D. Légende

### D1 · Là où la couleur porte une valeur, la légende est obligatoire — et visible avec la carte — **P0**

**Fondement.** Mericskay constate que la fenêtre contextuelle a remplacé la légende, et pose une exception nette :

> « Les légendes sont toutefois **encore nécessaires** et présentes dans certains cas, à l'image des cartes choroplèthes où l'information relative à la variation de valeur sera lisible sur la carte pour donner un sens à l'information représentée. »

Et parmi les sept mauvaises pratiques listées : ne jamais écrire le mot « légende ».

**Transposition.** Le tout-popup est défendable pour les vols, les navires, les caméras — objets nominaux qu'on interroge un par un. Il est fautif dès qu'une couleur code une valeur. Et une légende repliée dans un panneau qui recouvre la carte n'est pas une légende : c'est une dette d'interface.

**Test.** Sans ouvrir aucun panneau, l'utilisateur peut-il traduire une couleur en valeur ?

### D2 · Légende à deux étages sur un cadrage mobile — **P1**

**Fondement.** Les cinq règles positives du cours : bornes arrondies et faciles à lire, **valeurs minimale et maximale de la série toujours indiquées**, clefs de lecture, valeurs statistiques significatives, absence de donnée annoncée.

**Transposition.** La règle du min/max « de la série » n'a plus de référent unique quand le lecteur voit une sous-population qui change à chaque mouvement de caméra. Afficher les extrema mondiaux à côté d'une vue de la Gironde est trompeur ; afficher ceux de la vue rend deux captures non comparables et **casse la reproductibilité du lien de partage**.

D'où deux étages : une **échelle absolue gelée** par couche (bornes de domaine publiées, jamais dérivées de la vue), sur laquelle se superpose un **histogramme mobile** de la sous-population visible avec un compteur `n visibles / N connus`.

**Test.** Deux utilisateurs ouvrant le même lien de partage lisent-ils la même légende ?

### D3 · L'absence de donnée se code par un motif, pas par une teinte — **P1**

**Fondement.** « L'absence d'information est indiquée dans la légende et **représentée en blanc** sur la carte. »

**Transposition — la règle du blanc est inapplicable ici et la suivre serait dangereux.** Sur un globe photoréaliste il n'existe pas de fond neutre : le blanc est une couleur du monde (toitures, neige, nuage) et le vide, c'est de l'orthophoto. Pire, sur une rampe conçue pour fond sombre, le blanc se lit comme la classe **haute** — GEV afficherait « valeur maximale » là où il n'a aucune donnée.

Le motif géométrique (hachures, grille) est la bonne réponse, et il a un second avantage : **un motif survit au NVG et au FLIR, une teinte est détruite**.

**Test.** Sur une couche zonale, la maille sans donnée est-elle distinguable de la classe la plus haute ? Et le reste-t-elle sous chaque mode capteur ?

---

## E. Temps

### E1 · L'instant représenté s'affiche sur la carte — **P0**

**Fondement.** Deux fois dans le support spatio-temporel : « Display frame start time on map », « Ajouter l'heure sur chaque carte ». Une carte animée sans date affichée n'est pas interprétable.

**Transposition.** L'affichage doit porter l'instant **représenté par les données**, pas l'heure locale du client ni un « il y a N secondes » indifférencié. Deux conséquences : chaque fiche d'entité porte l'horodatage de la mesure ; et le lien de partage sérialise l'instant, sans quoi il rejoue la même vue avec d'autres données.

**Test.** Une capture d'écran de GEV suffit-elle à savoir de quand datent les données qu'elle montre ?

### E2 · Trois concepts temporels, trois traitements — **P1**

**Fondement.** « Événement : représente un instant bien précis sur la ligne du temps. Intervalle temporel : de modélisation / représentation. Période : représente un ensemble d'intervalles. » Et la distinction de base : « une donnée spatio-temporelle est une donnée spatiale dont la **forme et/ou la position** varie(nt) au cours du temps ».

**Transposition.** GEV mélange deux régimes sans le dire. **Position mobile** : vols, navires, satellites, GTFS-RT. **Position fixe, attribut variable** : stations de vélos, segments routiers, stations météo, bouées, caméras. Une traînée derrière un billboard a du sens pour un A320 ; elle n'en a aucun pour une station Vélib'. Ces deux familles ne doivent pas partager le même traitement d'animation.

**Test.** Le registre de couches déclare-t-il, à côté de la source et de la fraîcheur, le régime temporel (événement / intervalle / période) et le régime de variation (position / attribut) ?

### E3 · La fenêtre temporelle est un paramètre nommé, calibré en longueur d'écran — **P1**

**Fondement.** Le paramètre central du support n'est ni la vitesse ni la date, c'est la **« durée d'une carte »** : la largeur de la fenêtre dont les entités sont affichées ensemble. Réglée à 1 minute pour une trace GPS de randonnée, 30 à 60 minutes pour la criminalité sur une journée.

**Transposition.** La persistance des traces doit être exposée comme un réglage, pas enfouie dans un module. Et la valeur doit différer par couche selon la vitesse du mobile : un avion à 250 m/s traverse une fenêtre d'une minute en 15 km, un cargo à 10 nœuds en 300 m. **Régler la fenêtre pour que la trace fasse une longueur d'écran comparable entre couches, pas une durée identique.**

**Test.** Les traînées des différentes couches mobiles ont-elles des longueurs comparables à l'écran ?

### E4 · Trois horloges, à ne pas confondre — **P1**

**Fondement.** Le corpus chiffre la cadence : « Montrer une carte chaque 500 millisecondes », « configurer la durée d'affichage de chaque carte (0,5 ou 1 seconde) ». Soit 1 à 2 images par seconde — très loin des 24 du cinéma. La lenteur est délibérée : chaque état doit être lisible avant d'être remplacé.

**Transposition.** La 2D pouvait confondre les cadences parce qu'elle n'avait qu'une horloge. Un globe en a trois, indépendantes :

| Horloge | Contrainte | Ordre de grandeur |
|---|---|---|
| **Rendu** | la caméra et l'interaction | 60 fps, sous peine de saccade |
| **Donnée** | le poll amont | de quelques secondes à 10 minutes |
| **Lecture** | le pas d'un timelapse | **1 à 2 pas/s — le chiffre du corpus s'applique ici, et seulement ici** |

Appliquer « 2 images/s » au rendu casse la caméra. L'appliquer aux données casse le timelapse.

Et la question que le corpus ne pose pas : **entre deux mesures, que fait le rendu à 60 fps ?** Il extrapole. Voir A2.

**Test.** Un futur mode timelapse tourne-t-il à 1–2 pas par seconde, et non « le plus fluide possible » ?

---

## F. Ce que le globe change — la section que le corpus ne peut pas écrire

### F1 · Politique d'occultation déclarée par couche — **P0**

**Fondement.** Absent du corpus : une carte 2D n'a pas de profondeur. Mais le corpus pose le problème dont c'est la version 3D :

> « Certains éléments de la carte peuvent être obstrués par des entités extrudées, limitant ainsi une lecture complète des données. […] Un trop grand nombre d'unités extrudées conduit à produire une image très fragmentée. »

**Transposition.** Sur GEV l'occultant n'est pas la donnée, c'est **la ville** — le bâti photoréaliste. La question « qu'est-ce qui cache quoi » domine la lisibilité d'un globe, et elle est aujourd'hui tranchée par défaut dans un sens qui produit une image de rayons X qu'aucun capteur ne produit.

Trois régimes, à déclarer par couche :
- **(a) occulté** — l'objet est dans le monde, test de profondeur actif ;
- **(b) occulté par le terrain, pas par le bâti** — test d'horizon ellipsoïdal plus échantillon de terrain ;
- **(c) toujours visible, mais marqué comme deviné** — fantôme, contour pointillé, alpha réduit.

**Jamais le même signe pour « je vois » et « je devine ».**

**Test.** Se placer au sol dans une ville. Combien de symboles traversent les immeubles sans être marqués ?

### F2 · Ancrer la mesure, ne pas poser une barre d'échelle — **P0**

**Fondement.** La critique de Mericskay, écrite en 2016, décrit GEV par avance :

> « [le WebGL] va permettre plus de souplesse au niveau par exemple du changement de l'orientation de la carte comme son inclinaison, autorisant ainsi de nouvelles manières de représenter le monde **en s'affranchissant de la classique vue de dessus en deux dimensions orientée nord**. »

Il note que l'orientation nord n'est jamais indiquée et que l'échelle, quand elle existe, est réduite à sa forme graphique, abandonnant son aspect numérique « pourtant fondamental ».

**Transposition — et c'est là qu'il faut désobéir à la lettre du corpus.** Une barre d'échelle suppose un rapport pixel/mètre constant sur toute la feuille. En perspective, ce rapport varie continûment **dans une même image** : à 45° de tangage, le sol au bas de l'écran est à environ dix fois la résolution du sol près de l'horizon. Une barre unique serait fausse partout sauf sur une ligne — et fausse **silencieusement**. Un utilisateur qui mesure l'écartement de deux avions se tromperait d'un facteur 3 à 10 sans jamais le savoir, et sa capture d'écran deviendrait une mesure fausse et citable.

La règle correcte est **d'ancrer la mesure** : emprise au sol sous le réticule, altitude caméra, cap — recalculés par image, et explicitement invalidés quand le rayon caméra rase l'horizon.

**Test.** L'utilisateur dispose-t-il d'une référence métrique dont la validité est garantie au point où il regarde ?

### F3 · Restituer le cap — **P1**

**Fondement.** Même passage : l'orientation nord est implicite et jamais indiquée.

**Transposition.** Dans un HUD militaire, une bande de cap et une échelle liée à l'altitude ne sont pas de la décoration cockpit : ce sont **les deux éléments d'habillage que la 3D détruit et qu'il faut restituer**. C'est le cas rare où le spectacle et la géomatique demandent exactement la même chose.

**Test.** Hors mode cockpit, l'utilisateur sait-il où est le nord ?

### F4 · Une choroplèthe n'est pas une couche, c'est un mode de scène — **P1**

**Fondement.** « Fond de carte sobre obligatoire sous une animation. » « Avant d'afficher de la 3D, on déblaie le fond de carte. »

**Transposition — version corrigée après vérification.** Une première rédaction de cette règle affirmait qu'un aplat zonal vu en perspective devient incomparable parce que sa surface apparente décroît en 1/z². **C'est faux, et il faut le dire.** La variable visuelle d'une choroplèthe est la **teinte de remplissage**, et la perspective ne la déforme pas : deux départements ont exactement la même couleur en haut et en bas du cadre. Ce qui varie est leur **aire apparente**, et dans une choroplèthe l'aire ne porte aucune donnée. La valeur décodée est intacte ; seul le poids visuel change, ce qui est un effet de saillance connu et non une erreur de lecture.

Le défaut réel est plus étroit et bien plus grave : **la teinte thématique est drapée sur les façades**. Quand la pile photoréaliste est active, la classification bascule en `CESIUM_3D_TILE`, et l'aplat monte sur les immeubles. Là, l'ombrage du bâti module effectivement la couleur perçue — donc la valeur lue. C'est le compositing de la règle B3, appliqué à une surface verticale que personne n'a prévue.

La bonne réponse n'est donc pas de détourner la caméra — geste intrusif qui coûte plus d'immersion qu'il ne corrige — mais de **ne pas draper une couche thématique sur du bâti**, et d'épingler `verticalExaggeration = 1` pendant qu'une couche zonale est active, ce que personne ne garantit aujourd'hui.

**Test.** Sur une couche zonale, la teinte monte-t-elle sur les façades quand la pile photoréaliste est active ?

### F5 · Les shaders capteur s'arrêtent avant les couches où la couleur est la donnée — **P0**

**Fondement.** « Un rendu esthétique séduisant au détriment des règles conventionnelles. »

**Transposition.** Un post-process plein écran s'applique à l'image composée : il repeint donc aussi les choroplèthes, les rampes et les glyphes. Sous FLIR ou NVG, la légende affichée **n'est plus une clé de décodage valide** — l'application affiche une donnée fausse tout en revendiquant la véracité de ses sources.

Cela impose un ordre de passes explicite : les couches thématiques se composent **après** le filtre capteur. À défaut, le mode capteur désactive les couches où la couleur porte la valeur, et le dit.

**Test.** Activer FLIR sur une couche zonale colorée. La légende reste-t-elle exacte ?

### F6 · Aucune couche ne s'affiche à toutes les altitudes — **P1**

**Fondement.** Dans tous ses démonstrateurs, aucune symbologie n'est une valeur fixe : rayon, largeur, opacité sont des paires (zoom, valeur) — rayon de cercle 2 px au zoom 13 → 60 px au zoom 22 ; chaque couche a son `minzoom`/`maxzoom` (cadastre 16-19, limites communales maxzoom 14). Et sa critique :

> « dans de nombreuses applications, la symbologie est seulement paramétrée à un unique niveau de zoom, ce qui peut venir poser des problèmes de représentation si l'usager change d'échelle. »

**Transposition.** Une caméra 3D continue **aggrave** le problème : il n'existe aucun palier où calibrer la symbologie. Le gouverneur de détail existant définit une politique de charge GPU ; il faut la même chose pour la **charge sémiologique** — seuils d'entrée et de sortie déclarés par couche dans le registre, pas déduits du hasard.

**Test.** Chaque couche déclare-t-elle une plage d'altitude d'affichage ?

---

## G. Interaction

### G1 · Le mantra de Shneiderman, et le maillon manquant — **P1**

**Fondement.** C'est la seule règle citée dans deux supports différents, ce qui en fait l'axe prescriptif du corpus. Mericskay ne se contente pas de la citer, il la traduit en composants :

> « **Overview** : vue d'ensemble des données / **Zoom & filter** : changer d'échelle, filtrer les données / **Details on demand** : fenêtre d'information contextuelle »
> « The purpose of visualization is **insight, not pictures**. »

**Transposition.** GEV a l'overview, le zoom et les details on demand. **Le filtre est le maillon manquant** — et c'est le composant le plus rentable que le corpus désigne.

**Test.** L'utilisateur peut-il réduire une couche à un sous-ensemble sans la couper ?

### G2 · Un filtre ne détruit jamais le batch — **P0** *(condition de faisabilité de G1)*

**Fondement.** Le corpus prescrit « filtrer côté client sur une source déjà chargée », parce qu'il pense en MapLibre où `setFilter` est consommé par le shader.

**Transposition.** Le danger est réel mais il ne se trouve pas là où on l'attend, et il faut nommer le bon coupable — vérifié dans la source de Cesium embarquée :

- **`show` est sûr.** `EntityCluster.removePoint` met la primitive **en réserve** (`point.show = false`, index empilé dans `_unusedPointIndices`) sans jamais appeler `remove` — `node_modules/cesium/Build/CesiumUnminified/index.js:151282-151293`. Et sur une géométrie statique, un changement d'`isShowing` devient une écriture d'attribut `show` **par instance**. Le batch survit.
- **`removeAll()` est le destructeur.** Il pose `this._createVertexArray = true` — `index.js:149904-149910` — donc reconstruit le tableau de sommets à la frame suivante.

La règle est donc : **un filtre ne rappelle jamais `removeAll()` puis ne reconstruit la collection.** Il bascule `show`, écrit un attribut par instance, ou passe par `translucencyByDistance`. Une couche qui vide et repeuple sa collection à chaque cran de filtre fige le globe **pendant exactement le geste que le filtre est censé rendre fluide**.

Corollaire d'architecture, appris du dépôt lui-même : sur un globe, le filtre et l'occultation sont deux raisons distinctes de ne pas être visible, et elles ne peuvent pas partager le même champ. Deux écrivains sur `show` se battent, et un symbole filtré réapparaît au prochain mouvement de caméra. Il faut un état intermédiaire (`filteredOut`) et un seul écrivain final.

**Test.** Le filtre tient-il 60 fps pendant qu'on tire le curseur ? Et : le chemin de filtre appelle-t-il `removeAll()` ?

### G3 · Agréger en espace monde, pas en espace écran — **P1**

**Fondement.** Le corpus enseigne le cluster à rayon écran (« curseur d'agrégation moins / plus »).

**Transposition.** Un cluster à rayon écran se recompose à chaque image de rotation : le nombre affiché dans une pastille change pendant que la caméra tourne, **sans qu'aucun objet n'ait bougé**. Un agrégat instable est une donnée fausse. Le corpus ne peut pas voir ce problème parce qu'une carte 2D a des niveaux de zoom discrets et une caméra qui ne tourne pas.

Agréger sur un pavage **stable en espace monde**, avec hystérésis sur les bandes d'altitude et fondu croisé sur une bande de recouvrement plutôt qu'une bascule franche.

**Test.** Faire une orbite caméra sans changer d'altitude. Les compteurs d'agrégat bougent-ils ?

### G4 · Choisir cluster, carroyage ou heatmap selon ce qu'on doit pouvoir faire — **P1**

**Fondement.** Le tableau comparatif à neuf critères de l'article *Mappemonde*, qui est la grille de décision la plus dure du corpus. Le **carroyage** gagne sur le paramétrage, la pondération, l'agrégation statistique, la quantification et la lecture des structures. Le **cluster** est le seul à permettre la visualisation individuelle. La **heatmap** perd sur presque tout : ni paramétrage, ni agrégation statistique, ni quantification, ni individu, ni symbologie, ni interaction.

> « Malgré un rendu visuel efficace, cette forme de généralisation des données est cependant à utiliser avec prudence. »

**Transposition.** La heatmap est donc le pire choix dès lors qu'on veut cliquer une entité pour ouvrir sa fiche. Les seules candidates légitimes sont les couches où GEV n'offre **aucune** interaction par entité. Et une heatmap doit toujours déclarer son rayon et sa méthode — sinon c'est de la décoration.

**Test.** Pour chaque couche agrégée : le mode retenu permet-il ce que l'interface propose ?

---

## H. Données

### H1 · Savoir ce que la donnée ne contient pas — **P0**

**Fondement.** Le quatrième critère est le plus exigeant du corpus : « qualité, MAJ, intégrité, **exhaustivité** ».

**Transposition.** L'affichage source/fraîcheur, déjà présent, ne dit rien de la complétude. Or la couverture ADS-B n'est pas exhaustive, l'AIS ne voit que les navires coopératifs, et une constellation FIRMS amputée ne couvre pas la même surface. **Afficher explicitement l'incomplétude d'une couche est ce qui sépare la géovisualisation de la fiction visuelle.**

**Test.** Chaque couche déclare-t-elle son domaine de couverture et ses angles morts connus ?

### H2 · Contrôler une donnée contributive avant de l'utiliser — **P1**

**Fondement.** Le support Overpass est entièrement construit là-dessus : compter les tags avant d'extraire (`out count`), cartographier la complétude au lieu de la supposer en stylant selon l'attribut renseigné, requêter la fraîcheur (`newer:`, `changed:`), comparer OSM à une donnée de référence sur une emprise témoin. Et : « La folksonomie est une classification par des non-spécialistes — et elle bouge. »

**Test.** Pour chaque couche OSM, l'attribut porteur est-il vérifié en taux de remplissage, et ce taux est-il visible ?

### H3 · La frontière GeoJSON / tuiles se situe entre 20 000 et 30 000 entités — **P1**

**Fondement.** Seuils mesurables dans ses propres réalisations : il charge sans complexe un GeoJSON de 19 428 bâtiments (12,3 Mo) pour l'extrusion 3D, protégé par un `minZoom` de 14,5 ; et 31 409 mutations DVF (7,1 Mo) pour le clustering. Dès l'échelle d'une ville entière (359 884 parcelles à Paris), il bascule sur des tuiles vectorielles hébergées.

Les ordres de grandeur qu'il cite comme tenus en production sont très au-dessus : 90 millions de parcelles cadastrales et 15 millions de transactions DVF chez Etalab, 45 millions de bâtiments BD TOPO, 70 millions d'objets 3D pour le géoportail suisse.

**Transposition.** GEV opère plusieurs ordres de grandeur sous ces seuils, ce qui **valide** le rendu côté client — et rend indéfendable de charger un référentiel national par la même voie. Sous ~30 000 entités, un GeoJSON borné en altitude suffit ; au-delà, tuiles vectorielles ou 3D Tiles.

**Test.** Chaque couche statique connaît-elle sa volumétrie maximale et le mode de transport correspondant ?

---

## Tensions irréductibles

Ces conflits n'ont pas de solution, seulement un arbitrage. Il vaut mieux qu'il soit écrit.

| Tension | Position académique | Position produit | Arbitrage retenu |
|---|---|---|---|
| **Densité contre lisibilité** | Le semis saturé ne dit plus rien, il faut agréger | La saturation *est* le message : « le monde est déjà en train d'émettre » | Garder le semis comme vue d'entrée, offrir l'agrégat comme mode d'analyse. Ne jamais afficher les deux. |
| **Légende contre immersion** | Obligatoire dès qu'une couleur code une valeur | Une légende permanente casse le cockpit | Légende montée **uniquement** pour les couches déclarant une échelle de valeurs, et repliable — jamais absente. |
| **Spectacle contre mesure** | Le critère de succès ne peut pas être la séduction | La sidération est la porte d'entrée | Le spectacle a droit de cité **partout où il ne fabrique pas de chiffre**. Un shader qui stylise : oui. Un shader qui affiche une température en degrés : non. |
| **Fluidité contre lenteur délibérée** | 1 à 2 images/s, chaque état lisible | 60 fps ou l'immersion tombe | Trois horloges séparées (E4). La lenteur s'applique au timelapse, jamais au rendu. |
| **Rigueur contre budget d'image** | Le corpus ignore le coût du rendu | Chaque prescription a un prix mesurable | La sémiologie est une **optimisation sous contrainte**, pas une hiérarchie de règles. Chaque couche déclare son budget et choisit son style dessous. |

---

## Ce qu'on ne reprend pas, et pourquoi

| Élément du corpus | Raison |
|---|---|
| **La barre d'échelle graphique** | Fausse silencieusement en perspective. Remplacée par F2. |
| **Le blanc pour la donnée manquante** | Pas de fond neutre sur un globe photoréaliste ; sur rampe sombre le blanc se lit comme la classe haute. Remplacé par un motif (D3). |
| **Le cercle proportionnel en unités monde** | Le canal taille est déjà pris par la profondeur. Remplacé par un canal orthogonal (B2). |
| **`EntityCluster` de Cesium et le cluster à rayon écran** | Instable en rotation, et incompatible avec les collections batchées des couches denses. Remplacé par G3. |
| **~~« Filtrer = basculer `show` détruit le batch »~~** | *Correction : c'était une erreur de ce document, pas du corpus.* Vérification faite dans la source Cesium embarquée, `show` préserve le batch ; le destructeur est `removeAll()`. Voir G2, réécrit. |
| **« 2 images par seconde » appliqué au rendu** | Confusion de trois horloges distinctes. Cadré par E4. |
| **« Fond sobre sous une animation »** | Le fond est de la géométrie, pas une image. Remplacé par F4. |
| **La maille métrique régulière** | Aucun pavage lat/lon équi-aire n'existe. Remplacé par C3. |
| **Le min/max « de la série »** | Pas de référent unique sur un cadrage mobile. Remplacé par la légende à deux étages (D2). |
| **Les six paliers comme cible** | Six déclarés ≠ six perçus après compositing. Devient une mesure, pas une constante (B3). |

---

## Bibliographie

### Ouvrage
- **Mericskay, B. (coord.), *Communication cartographique : Sémiologie graphique, sémiotique et géovisualisation*, ISTE Éditions, 2022, 264 p.** — Il en signe l'introduction et le chapitre 6, « Repenser la cartographie sur le Géoweb : principes, outils et modes de représentation ». [Avant-propos et introduction en libre accès](https://www.istegroup.com/wp-content/uploads/2019/11/091_Communication-cartographique_avnat-propos-et-introduction.pdf) · [notice HAL](https://hal.science/hal-03901325/) · [chapitre 6 en anglais, Wiley](https://onlinelibrary.wiley.com/doi/10.1002/9781394265022.ch6) *(non lu — 403)*

### Articles
- [« La géovisualisation de données massives sur le Web : entre avancées technologiques et évolutions cartographiques »](https://journals.openedition.org/mappemonde/5595?lang=fr), *Mappemonde* 131, 2021.
- [« La cartographie à l'heure du Géoweb : retour sur les nouveaux modes de représentation spatiale des données numériques »](https://shs.hal.science/halshs-01468314v1), HAL-SHS.
- [« Visualiser les données spatiales sur le Web »](https://medium.com/@BorisMericskay/visualiser-les-donn%C3%A9es-spatiales-sur-le-web-f983e9e147d0), Medium.
- CV HAL complet : [cv.hal.science/boris-mericskay-r2](https://cv.hal.science/boris-mericskay-r2) — 78 documents, 90 % en accès ouvert. ORCID 0000-0002-4613-1597.

### Supports de cours — master SIGAT, Université Rennes 2
Répertoire : `https://sites-formations.univ-rennes2.fr/mastersigat/Cours/`
- [`CM_SemiologieGraphique_2020.pdf`](https://sites-formations.univ-rennes2.fr/mastersigat/Cours/CM_SemiologieGraphique_2020.pdf) — 116 dia., licence CC BY-SA
- [`Intro_Dataviz.pdf`](https://sites-formations.univ-rennes2.fr/mastersigat/Cours/Intro_Dataviz.pdf) — 101 dia.
- [`geoviz2018.pdf`](https://sites-formations.univ-rennes2.fr/mastersigat/Cours/geoviz2018.pdf) · [`Spatiotemporel.pdf`](https://sites-formations.univ-rennes2.fr/mastersigat/Cours/Spatiotemporel.pdf) · [`AnalysespatialeM1.pdf`](https://sites-formations.univ-rennes2.fr/mastersigat/Cours/AnalysespatialeM1.pdf)
- [`Leaflet.pdf`](https://sites-formations.univ-rennes2.fr/mastersigat/Cours/Leaflet.pdf) · [`Cours_MapboxGL.pdf`](https://sites-formations.univ-rennes2.fr/mastersigat/Cours/Cours_MapboxGL.pdf)
- [`Intro_Overpass.pdf`](https://sites-formations.univ-rennes2.fr/mastersigat/Cours/Intro_Overpass.pdf) · [`OverpassTurbo_SOTM_2022.pdf`](https://sites-formations.univ-rennes2.fr/mastersigat/Cours/OverpassTurbo_SOTM_2022.pdf)
- Index des supports : [bmericskay.github.io/portfolio/cours.html](https://bmericskay.github.io/portfolio/cours.html)

### Conférences
- [CartoStats](https://cartosta.sciencesconf.org/data/pages/CartoStats_B_Mericskay.pdf) — « (géo)Visualisation de données statistiques sur le Web »
- [GeoViz](https://geoviz.sciencesconf.org/data/pages/Visualisation_de_donnees_spatiales_sur_le_Web.pdf) — « Géovisualisation de données sur le Web »
- [FOSS4G-fr 2016](https://osgeo-fr.github.io/presentations_foss4gfr/2016/J1/Foss4G_Communication-enseignement-BMericskay.pdf) — « Enseigner la géomatique à l'université »

### Tutoriels
- [« Faire de la cartographie thématique sur le Web avec MapLibreGL »](https://geotribu.fr/articles/2021/2021-04-20_maplibre_site_ressource/), Geotribu, 2021.
- [« Faire une carte en ligne (tuiles vectorielles + WebGL) 100 % libre »](https://geotribu.fr/articles/2021/2021-02-23_carte_ligne_libre/), Geotribu, 2021.

### Webinaires « Carte blanche » — GdR MAGIS, action de recherche AR9 qu'il co-anime
Index : [magisar9.github.io/webinaires](https://magisar9.github.io/webinaires/) — mensuel, 30 min d'exposé filmé plus 30 min de discussion, diapositives publiées.
- **#22** (21 janv. 2026) — Trémélo & Zanin, *La sémiologie graphique est-elle obsolète ?* — enquête 2024
- **#23** (12 févr. 2026) — Thollot, *micmap : géovisualisation 3D stylisée* — rendu expressif appliqué à la carte 3D
- **#28** (8 juil. 2026) — Pillot, *Cartographier l'incertitude* — quatre sources d'incertitude, score de confiance composite ([audio](https://pod.unistra.fr/video/63277-cartographier-lincertitude/))
- **#16** (25 juin 2024) — Jégou, *Des cartes et des couleurs : enquête sur les gradients* — adapter la luminosité du gradient à la progression de la donnée ([préprint](https://hal.science/hal-04270875))
- **#4** (avr. 2023) — Douet, *na.rm=TRUE — requête, interactivité et gestion des données manquantes*
- **#8** (oct. 2023) — Gaffuri, *Gridviz : cartographie en ligne de données carroyées*

### Code
- [github.com/bmericskay](https://github.com/bmericskay) · [gitlab.huma-num.fr/bmericskay](https://gitlab.huma-num.fr/bmericskay) · [portfolio](https://bmericskay.github.io/portfolio/)
