# Le barème national — comment une mesure d'adresse devient un rang

*Palier 1½ du triage `docs/CITYSCAN.md`. Écrit le 8 septembre 2026, en même
temps que la première campagne.*

---

## 0. Ce qui manquait

La `Fiche implantation` sait dire, pour une porte : *1,04 km² réellement
atteignables à pied en dix minutes, 4 210 habitants, niveau de vie moyen
22 400 €/an, 4 200 €/m² médian sur 31 ventes comparables*. Quatre faits, tous
mesurés, et un lecteur qui n'a **aucun moyen de savoir si c'est beaucoup**.

Le produit que Cityscan vend n'est pas la mesure : c'est la **position** de la
mesure dans le pays — la note sur 100 et la lettre A→E calquée sur le DPE.
`docs/CITYSCAN.md` l'avait rangée en « palier 1½ », c'est-à-dire : facile en
apparence, et porteuse d'un coût caché qu'il valait mieux annoncer avant de
promettre la lettre.

Ce document est ce que le coût est devenu une fois mesuré.

---

## 1. Le coût annoncé n'était pas le bon

L'analyse initiale chiffrait le lot ainsi : *« précalculer les ~120 indicateurs
sur 35 000 communes ou 50 000 IRIS, les stocker, et les rafraîchir »*. Un lot de
traitement et un volume.

**C'était le mauvais lot, et il aurait produit un barème faux.**

La fiche ne mesure rien à la commune. Elle mesure sur un **anneau piéton de dix
minutes** — une forme d'environ 1,1 km de large, dessinée par l'IGN sur la trame
viaire réelle. Un tableau national à la commune ne peut pas répondre à une
question posée sur un anneau : la commune de Lyon a un niveau de vie, l'anneau
autour de la place Bellecour en a un autre, et le second n'est pas une
approximation du premier — c'est une autre grandeur.

La règle qui en sort, et qui est devenue la clé de jointure du module :

> **Une valeur ne se classe que dans une distribution mesurée sur la même
> géométrie.**

Le dépôt en portait déjà la démonstration sans l'utiliser. `filosofiFeed.js`
publie `FILOSOFI_RAMPS`, des quantiles nationaux de ces mêmes indicateurs —
gratuits, à portée d'`import`. Ce sont les quantiles d'un **carreau de 200 m**.
La fiche moyenne une trentaine de carreaux ; moyenner écrase les queues. Noter
une valeur d'anneau contre une échelle de carreau donne une lettre plausible et
fausse, et **rien à l'écran ne le dirait**. La section 4 chiffre l'écart.

---

## 2. Ce qu'il fallait mesurer à la place

La bonne distribution de référence est celle-ci :

> Chez les résidents français, comment se répartit la valeur que la fiche
> calcule sur **leur** anneau de dix minutes ?

Elle n'est publiée nulle part. Aucune source ouverte ne dit quelle surface un
Français atteint à pied en dix minutes. Elle n'existe que si on la mesure — et
la mesurer, c'est faire tourner la fiche sur un échantillon de Français.

### Le tirage

`scripts/build-bareme-fr.mjs` tire un échantillon **de résidents, pas de
lieux**, à deux degrés et à probabilité proportionnelle à la population :

1. **La trame.** Les 377 234 carreaux habités de 1 km que l'INSEE publie sur la
   Géoplateforme — métropole, Martinique et La Réunion — avec leur population.
   76 pages de WFS, ~19 Mo, deux minutes et demie, mises en cache.
2. **Le premier degré.** Un tirage **systématique** sur la population cumulée :
   un pas constant plutôt qu'un tirage multinomial, ce qui étale l'échantillon
   sur tout le pays au lieu de laisser le hasard le grumeler. La trame étant
   triée par `id_inspire`, donc par northing, le pas remonte le pays du sud vers
   le nord : c'est une stratification implicite par latitude, gratuite.
3. **Le second degré.** Dans le carreau de 1 km désigné, un carreau de **200 m**
   tiré proportionnellement à sa population. Son centre — au plus 141 m d'une
   habitation réelle — sert de porte.

Chaque tirage désigne donc un habitant. Les quantiles se lisent ensuite **sans
pondération** : la pondération est dans le tirage, et repondérer compterait la
population deux fois.

### La mesure

Chaque porte passe par **les routes de l'application**, sur une instance qui
tourne : `/api/isochrone` (piéton, 600 s), `/api/filosofi/carreaux` sur la boîte
de l'anneau, `/api/dvf` sur 300 m, puis `aggregateInRing()` — la fonction que la
fiche elle-même utilise. Interroger l'IGN en direct aurait été plus court et
aurait mesuré **une autre distribution que celle que le lecteur voit**.

---

## 3. Les choix qui ne sont pas des mesures

### La lettre est un jugement, et tout n'en mérite pas un

Une lettre exige de savoir dans quel sens l'indicateur est « bon ». Pour la
surface atteignable à pied, personne ne conteste le sens. Pour la part de
logement social, la part de propriétaires, l'âge des habitants ou le prix au m²,
**le sens dépend entièrement de qui demande** : un prix élevé est une bonne
nouvelle pour un vendeur et une mauvaise pour un acheteur.

Cityscan tranche quand même, et ne dit pas au nom de qui. Ici, chaque indicateur
porte un `direction` explicite, et `null` veut dire : **rang national, jamais de
lettre**.

| Indicateur | Sens | Pourquoi |
|---|---|---|
| Surface atteignable à pied | **↑** | Non contesté. Plus de sol accessible est plus d'accès, pour tout lecteur. |
| Niveau de vie du voisinage | **↑** | *Le choix contestable de ce module.* Point de vue du résident acheteur, et lui seul. |
| Ménages pauvres | **↓** | Même point de vue, donc même réserve. |
| Habitants, ménages | — | La densité est une préférence : la clientèle d'un commerce et le bruit d'un riverain. |
| Logement social | — | Résultat d'une politique publique. Noter un quartier E parce qu'il loge est l'usage que ce module refuse de rendre facile. |
| Âges, personnes seules, propriétaires | — | Composition, pas qualité. |
| Prix au m² | — | Bonne nouvelle pour un vendeur, mauvaise pour un acheteur. |

Ajouter une lettre plus tard est une ligne à changer dans `direction`, pas une
machine à construire.

### La découpe A→E

Des quintiles : **A est le meilleur cinquième de France**, E le dernier. C'est
la convention que Cityscan a empruntée au DPE, et elle a le mérite d'être
vérifiable — « combien de Français sont en A ? » a une réponse, *un sur cinq,
par construction*. Une découpe non uniforme est défendable, mais elle doit alors
être affichée, sinon la lettre ment sur sa propre rareté. La carte l'affiche.

### La lettre est elle-même une fourchette

Un centile lu sur un échantillon porte une erreur d'échantillonnage : `2·√(p(1−p)/n)`,
soit **±2,9 points au milieu de la distribution pour 1 200 tirages**. Une valeur
qui tombe à 61 % n'est donc pas « B plutôt que C » : elle est « B ou C ».
`scoreIndicator()` renvoie la fourchette et un drapeau `ferme`, et la carte
n'imprime une lettre nue que lorsqu'elle est ferme. C'est le geste de la
fourchette de population de `implantationFeed.js`, appliqué au rang.

### Le palier

Trois indicateurs ont un plancher : la part de logement social vaut 0 sur tout
le bas de la distribution. Il n'y a alors **aucune réponse ponctuelle** — 0 %
est « quelque part dans le premier tiers », pas « au 14ᵉ centile ». Interpoler y
serait inventer une précision que la donnée refuse ; `ladderBracket()` rend
l'intervalle, et la carte imprime `0–40ᵉ`.

---

## 4. Ce que la campagne a mesuré

**Campagne du 2026-09-08.** 1 200 anneaux piétons de dix minutes, tirés sur une
trame de **377 234 carreaux de 1 km habités — 64 089 848 habitants**. Graine
`20260908`. **Zéro refus** : les 1 200 tirages ont tous reçu un anneau, une page
de carroyage complète et une population non nulle. Durée : 42 minutes, environ
2,1 s par tirage. Erreur d'échantillonnage au milieu de la distribution :
**±2,9 points de centile**.

Les échelles complètes sont dans `BAREME_FR`. Quelques repères, en p10 / p50 / p90 :

| Indicateur | p10 | p50 | p90 |
|---|---|---|---|
| Surface atteignable à pied, 10 min | 0,38 km² | 0,65 km² | 0,90 km² |
| Habitants dans l'anneau | 90 | 1 290 | 9 340 |
| Niveau de vie du voisinage | 17 200 €/an | 21 600 €/an | 28 100 €/an |
| Ménages pauvres | 5,5 % | 12,7 % | 26,8 % |
| Logement social | 0 % | 9,4 % | 46,6 % |
| Prix médian au m² (disque 300 m) | 1 280 € | 2 530 € | 5 280 € |

**Une couverture partielle, et une seule.** Dix indicateurs sur onze ont répondu
sur les 1 200 anneaux. Le prix au m² n'a répondu que **1 049 fois** : 151 anneaux
n'avaient aucune vente comparable dans leurs 300 m, et ces anneaux-là sont
ruraux. L'échelle du prix décrit donc **87 % du pays, et le plus urbain**. La
carte l'imprime quand elle s'en sert, plutôt que de laisser le rang passer pour
national.

### L'écart avec l'échelle de carreau — le chiffre qui justifie le lot

Les sept indicateurs communs ont été mesurés **deux fois sur le même
échantillon** : une fois sur l'anneau, une fois sur le carreau de 200 m tiré au
sort. Moyenner une trentaine de carreaux rentre les deux queues, et la mesure le
confirme :

> **L'intervalle interdécile d'un anneau vaut 74 % de celui d'un carreau**
> (68 % pour la part de moins de 18 ans, 81 % pour le niveau de vie).

La conséquence n'est pas académique. Notés sur l'échelle de carreau — celle que
`FILOSOFI_RAMPS` offrait gratuitement — les anneaux se déplacent ainsi :

| Anneau réellement au… | …serait lu au |
|---|---|
| **10ᵉ centile** | **22ᵉ** (+12 pt) |
| 50ᵉ centile | 53ᵉ (+3 pt) |
| **90ᵉ centile** | **84ᵉ** (−7 pt) |

Le milieu bouge peu, les extrémités bougent d'une **bande de lettre entière** :
un accès qui vaut E devient D, un niveau de vie qui vaut A devient B. Et rien à
l'écran ne l'aurait dit — c'est précisément pour cela que `geometry` est une clé
de jointure et non un commentaire.

Cas le plus violent, le **logement social** : 0 % couvre les sept premiers points
de l'échelle de carreau contre trois de celle d'anneau, si bien qu'une valeur au
50ᵉ centile d'anneau (9,4 %) se lirait au **69ᵉ** sur l'échelle de carreau. Cet
indicateur ne porte pas de lettre, donc l'erreur serait restée un rang faux
plutôt qu'une note fausse — cette fois.

### Un bug trouvé par la mesure

La première campagne a refusé **seize tirages d'affilée**, tous à La Réunion,
avec le même motif : « anneau vide ». `implantationFeed.js` perdait le `crs` du
carreau en inversant la grille INSEE. L'INSEE grille la métropole en EPSG:3035,
la Martinique en 5490 et La Réunion en 2975 ; `cellCorners()` prend 3035 par
défaut, et un carreau réunionnais inversé sans son grid revient à
**93,9° O / 55,5° N — la baie d'Hudson**. Tous les carreaux tombaient donc hors
de tous les anneaux, et la fiche répondait « aucun carreau INSEE habité dans
cette zone » **pour toute adresse de Martinique et de La Réunion**.

Corrigé, avec un test de régression qui reproduit les deux moitiés — le carreau
avec son grid se joint, le même carreau sans son grid ne se joint pas. Première
mesure réunionnaise après correctif : 0,59 km², 936 habitants.

---

## 5. Ce que le lot a réellement coûté

| | Annoncé | Mesuré |
|---|---|---|
| Objet du précalcul | 120 indicateurs × 35 000 communes | 11 indicateurs × 11 quantiles |
| Stockage | une base et son rafraîchissement | **~2 Ko** gelés dans une source |
| Coût au chargement de page | — | **zéro octet** |
| Rafraîchissement | un service | `npm run bareme:fr`, **42 minutes** |
| Trafic amont, par campagne | — | 1 200 isochrones IGN, 2 400 WFS, 1 200 DVF, séquentiels |

Le lot craignait un volume ; il n'en a pas. Un barème est une **distribution**,
et une distribution bien tirée de quelques centaines d'observations donne un
centile à trois points près. Le recensement n'était pas nécessaire — il fallait
un tirage, pas un inventaire.

Ce qui reste vrai de l'avertissement initial : la lettre **n'est pas gratuite**.
Elle coûte une campagne de mesure, une décision éditoriale par indicateur, et
l'obligation de dire quand elle ne peut pas être donnée.

---

## 6. Étendre

Le barème couvre exactement ce que la fiche mesure aujourd'hui. Chaque
indicateur ajouté à la fiche demande trois choses, et rien d'autre :

1. une ligne dans `BAREME_INDICATORS` — étiquette, unité, géométrie, **sens et
   sa justification écrite** ;
2. une ligne dans `FICHE_SCORED` — où le lire dans la fiche, et sur quelle
   géométrie ;
3. une relance de `npm run bareme:fr` — la campagne mesure tout ce qui est
   déclaré, en une passe.

Les quatre couches manquantes du palier 1 — ARCEP, loyers, ATMO, IPS — arriveront
avec leur propre géométrie (l'adresse, la commune, la commune, l'établissement).
Chacune aura donc besoin de sa propre référence, et **aucune ne pourra emprunter
celle de l'anneau**. C'est la seule chose que ce module rend impossible à
oublier.

---

## Sources et fichiers

- `src/data/baremeNational.js` — les choix, les échelles mesurées, le scoring.
- `src/data/implantationFiche.js` — `FICHE_SCORED`, la jointure et les lignes.
- `scripts/build-bareme-fr.mjs` — la campagne. `npm run bareme:fr`.
- Trame : INSEE Filosofi carroyage 1 km via la Géoplateforme (WFS), Licence
  Ouverte 2.0. Mesure : `/api/isochrone` (IGN), `/api/filosofi/carreaux`
  (Géoplateforme), `/api/dvf` (DGFiP).
