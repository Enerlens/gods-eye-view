# Plan — la clé du trafic routier, et la sous-division des couches fusionnées

*Rédigé le 2026-09-10. Propositions, pas décisions.*

> **ÉTAT AU 2026-09-10, fin de journée : les étapes 1 à 6 sont livrées.**
> Seule l'étape 7 (C4, l'arbitrage sur l'épaisseur des comptages) reste ouverte,
> et le plan la donnait déjà comme « à décider ». Mesuré à nouveau au DOM,
> Île-de-France, 1440×900, les quatre couches allumées :
>
> | | avant | après |
> |---|---|---|
> | lignes | 23 | **20** |
> | mots | 559 | **207** (−63 %) |
> | hauteur du contenu | 1 256 px | **772 px** (−39 %) |
> | écrans de défilement | 5,8 | **3,6** |
> | couleurs partagées entre sous-couches | 2 collisions | **0** |
>
> Deux écarts assumés par rapport au texte ci-dessous, et leurs raisons sont
> dans le code :
>
> - **Une ligne à un seul membre garde le nom de ce MEMBRE**, pas celui de la
>   ligne. Le plan disait « au nom de la ligne » ; `bruit-fr` seul sous la ligne
>   « Aéroports » aurait alors titré des bandes de bruit PEB avec le mot
>   « Aéroports », ce qui est pire que ce qu'on remplaçait.
> - **Les événements ne prennent pas la trame « hors échelle » partagée** (B4) :
>   ils ont un canal de FORME et s'en servent — leur inconnu dessine un point
>   d'interrogation. La trame reste pour `comptages-fr` et `road-status-fr`, qui
>   n'ont que la couleur. « La pastille est la marque » l'emporte sur « un seul
>   signe partagé ».

---

## 0. Comment les chiffres ci-dessous ont été obtenus

Sonde jetable `.context/measure-traffic-legend.mjs` : Chrome installé, 1440×900,
`newQaPage()`, les quatre couches allumées par `dataManager.setEnabled()`, lecture du DOM
de `#map-legend-items` après stabilisation. Deux vues :

| vue | ce qui dessine |
|---|---|
| Île-de-France, ~9 000 m | `traffic`, `road-events-fr`, `comptages-fr` — `road-status-fr` est à zéro, la DIRIF ne publie aucun état |
| Rouen, 18 000 m | `traffic`, `road-events-fr`, `road-status-fr` (27 segments) |

Deux avertissements sur la méthode, tous deux déjà en mémoire et tous deux revérifiés ici :
`window.Cesium` n'existe plus depuis la scission du bundle, donc un `setView` écrit
naïvement échoue **en silence** ; et le cinématique de démarrage écrase les `lat/lon` de
l'URL. La caméra n'est déplacée pour de bon qu'en construisant le vecteur ECEF à la main
et en le passant en `{x, y, z}`. Les deux premières mesures de cette session ont décrit la
même vue en croyant en décrire deux.

Les comptages de rythme sont recoupés hors navigateur contre le pack livré
(`.gev-cache/comptages-fr/week.json`, semaine du 31 août au 6 septembre 2026, 1 724 arcs
comptés) en rejouant `comptagesRhythmClass()` sur chaque arc.

---

## 1. L'état actuel, en chiffres

**Une seule ligne du panneau** — « Trafic routier », dont le bouton porte quatre couches —
imprime dans le bloc de droite :

| | Île-de-France | Rouen |
|---|---|---|
| blocs | 3 | 3 |
| lignes | **23** | 9 |
| mots | **559** | 104 |
| hauteur du contenu | **1 256 px** | 397 px |
| fenêtre allouée | 216 px | 216 px |
| écrans de défilement | **5,8** | 1,8 |

Le pire cas théorique, les quatre couches servant toutes leurs classes, est de **34 lignes**
(5 débit + 5 état + 9 événements + 15 comptages).

À lui seul, le bloc Comptages pèse 14 lignes et 859 px — 68 % de la hauteur. La bascule
`optIn` posée par l'autre agent sur `comptages-fr` le sort du cas par défaut ; ce qui suit
en tient compte.

---

## 2. Sept défauts, du plus grave au plus cosmétique

### 2.1 — Les phrases du bloc Comptages contredisent ses propres nombres · **P0**

Chaque ligne de rythme imprime **deux comptes différents pour la même chose** : celui de la
ligne, calculé sur le pack ; celui de la phrase, tapé à la main.

| ligne | compte à l'écran | compte dans la phrase |
|---|---|---|
| Nocturne | 18 | 56 |
| Week-end | 39 | 100 |
| Pendulaire | 369 | 367 |
| Pointe du matin | 296 | 150 |
| Pointe du soir | 358 | **652 « la classe la plus nombreuse »** |
| Continu | **614** | 369 |
| Rythme indéterminé | 30 | 36 |

« La classe la plus nombreuse » est fausse **à l'écran** : `Continu 614` est imprimé deux
lignes plus haut. Le total revendiqué par la phrase de Nocturne — « 56 arcs sur 1 730 » —
se heurte aux 1 724 arcs comptés du pack.

Rejouer le classifieur sur le pack livré donne exactement la colonne de gauche : ce n'est
pas la légende qui se trompe, ce sont les phrases. Le pack est glissant
(`week.discovered: true`), donc elles ne sont pas *devenues* fausses par accident — **elles
dérivent chaque semaine par construction**. Même défaut sur les bandes de débit : « 196
arcs » contre 122 affichés, « 620 arcs » contre 581.

Les seules phrases justes du bloc sont celles qui sont **calculées** : « 729 déclarés
invalides, 26 barrés, 140 ouverts », dont la somme fait bien les 895 de la ligne.

### 2.2 — Deux sous-couches peignent la congestion avec les mêmes hexadécimaux · **P0**

`traffic` (débit modélisé TomTom) et `road-status-fr` (état déclaré par les DIR) utilisent
`#2ecc71` / `#f0b23e` / `#e05252`. Les mêmes. ΔE = 0,0.

Co-observé à Rouen, dans le même bloc, au même instant :

```
▸ Trafic routier         ● rgba(46, 204, 113, .9)   Circulation fluide  1.0K
▸ État du réseau routier ● rgb(46, 204, 113)        Fluide                27
```

Une couleur, deux noms, deux régimes de preuve — une mesure de sonde flottante et une
déclaration d'exploitant. C'est A1 (même signe pour deux registres) et A3 (un canal, une
information). Les vocabulaires divergent aussi pour rien : *Circulation ralentie* / *Dense*,
*Circulation bloquée* / *Congestionné*.

### 2.3 — Le diamètre des événements porte trois informations et n'en résout aucune · **P0**

`roadEventPixelSize()` compose la gravité (5 paliers, 7 → 13,4 px), l'indicateur sécurité
(+2 px) et l'état planifié (× 0,8). Vingt combinaisons entassées entre 5,6 et 15,4 px, dont
**quatorze paires voisines à moins de 0,75 px** et quatre à 0,12 px :

```
10,20 px  gravité moyenne, actif        ≈  10,60 px  gravité faible + sécurité, actif
12,20 px  moyenne + sécurité, actif     ≈  12,32 px  majeure + sécurité, PLANIFIÉ
13,40 px  majeure, actif                ≈  13,80 px  forte + sécurité, actif
```

Un chantier **programmé** et un accident **en cours** peuvent tomber à 0,12 px l'un de
l'autre. Et la clé ne dit pas un mot du diamètre : un canal porte une valeur sur la carte
et n'existe pas dans la légende (D1), avec des paliers déclarés qui ne sont pas des paliers
perçus (B3).

### 2.4 — Quatre horloges dans une liste indifférenciée · **P0 (E1)**

| bloc | horloge |
|---|---|
| Trafic routier | direct, 60 s |
| État du réseau | direct déclaré, 60–360 s |
| Événements | instantané republié à l'heure |
| Comptages | **semaine type archivée du 31 août au 6 septembre**, à l'heure d'une puce |

Rien dans le bloc ne le dit. Les Comptages se lisent comme du direct. E1 est P0 :
« l'instant représenté s'affiche sur la carte ».

### 2.5 — Trois « je ne sais pas », trois gris, trois mots · **D3**

`#9b9187` *Rythme indéterminé* · `#8a93a6` *Non classé* · `#7c8794` *Non communiqué*.
ΔE 16 à 18 entre eux, sur une pastille de 8 px. D3 demande un **motif**, pas une teinte —
et ajoute la raison qui pèse ici : un motif survit au NVG et au FLIR, une teinte est
détruite (F5).

### 2.6 — Collisions de teintes entre sous-couches · **A3**

Sur une pastille de 8 px, ΔE76 entre classes qui cohabitent sur les mêmes rues :

| ΔE | |
|---|---|
| 7,3 | Pendulaire (comptages) ↔ Obstacle (événements) |
| 9,2 | Pointe du matin ↔ Intempérie |
| 12,6 | Circulation fluide ↔ Déviation |

Trois codes de teinte incompatibles — congestion (ordonnée), catégorie d'événement
(nominale), rythme hebdomadaire (nominal) — sur la même géométrie.

### 2.7 — Deux phrases sont en anglais, et rien ne dit que les trois blocs sont une ligne

`roadStatusFrance.js:741` sert « *The station is located and measured, but no
traffic-management centre publishes a state for it.* » et « *Published by the operating DIR
as DATEX II `freeFlow`, refreshed every 60–360 s.* » dans un bloc autrement entièrement
français.

Et les trois titres — TRAFIC ROUTIER, ÉVÉNEMENTS ROUTIERS, ÉTAT DU RÉSEAU ROUTIER — sortent
au même corps, à la même couleur, à la même casse, tous terminés par le même mot. Ils ne
correspondent à aucune ligne du panneau : le panneau en a **une**, nommée « Trafic
routier », et le premier bloc porte ce nom aussi. Rien ne dit lequel est le tout.

---

## 3. Proposition A — la clé épouse la ligne du panneau

**Le principe.** La légende a aujourd'hui un seul étage : une couche = un titre. Le panneau,
lui, en a deux depuis la table de fusions : une ligne = un bouton + des puces. **La clé doit
avoir la même forme que le contrôle.** Deux étages :

- **Étage 1, la ligne** — le nom de la ligne du panneau, une fois, avec son total.
- **Étage 2, la sous-couche** — **le libellé de la puce**, pas le nom taxonomique de la
  couche. `layerFusions.js` porte déjà `companions[].chip` : « État du réseau »,
  « Événements », « Comptages ». Le mot qu'on a cliqué est le mot qu'on relit. Aujourd'hui
  la clé affiche `_displayName(layer)`, un libellé qui n'apparaît **nulle part** dans le
  panneau pour une compagne.

**La règle de déclenchement, et c'est elle qui fait que ça se généralise sans envahir.**
L'étage 2 n'apparaît **que** si au moins deux membres d'une même fusion publient une clé au
même moment. Un seul membre allumé → un seul bloc, au nom de la ligne, exactement le rendu
d'aujourd'hui. Une couche non fusionnée → inchangée.

Recensement fait sur la table actuelle : **9 fusions sur 15** peuvent scinder leur clé.

| ligne du panneau | membres à clé |
|---|---|
| Trafic routier | 4 |
| Centrales électriques | 3 |
| Territoire | 3 |
| Enseignement · Météo · Transports en commun · Vélos partagés · Vols en direct · Zone de chalandise | 2 |

Les 6 autres fusions (Autorisations d'urbanisme, Immobilier, Navires, Cours d'eau,
Aéroports, Infrastructure numérique) n'ont qu'un membre à clé : elles ne changent pas d'un
pixel.

**Le primaire a besoin d'un nom de puce.** `traffic` est le primaire, il n'a pas de puce, et
« Trafic routier » ne peut pas être à la fois l'étage 1 et l'étage 2. Une ligne à ajouter
par fusion dans `layerFusions.js` — `primaryChip: 'Débit mesuré'` — et le primaire devient
nommable comme les autres. C'est aussi l'occasion de dire ce qu'il mesure vraiment.

**Trois variantes visuelles.**

1. **Filet et retrait** — l'étage 2 en retrait de 10 px, avec un filet vertical de 1 px sur
   toute sa hauteur. Le regard voit un tout et ses parties sans lire un mot.
2. **Puce** — le titre d'étage 2 rendu comme la puce du panneau (pilule, même corps, même
   graisse). Plus reconnaissable, plus bruyant, et une pilule non cliquable dans un panneau
   où toute pilule est un bouton est un piège (`bruitFrance.js` documente déjà ce refus).
3. **Préfixe par ligne** — pas de titre d'étage 2, chaque entrée préfixée du nom de la
   sous-couche. Rejetée : répète le mot 23 fois.

**Recommandation : variante 1, avec le vocabulaire de la variante 2.** Filet et retrait pour
la structure, libellé de puce pour le mot. Le filet reprend l'accent de la catégorie, donc
il porte déjà l'information « c'est le même sujet ».

```
TRAFIC ROUTIER                                  1 118
│ DÉBIT MESURÉ
│ ● Fluide                                      1,0 k
│ ● Ralenti                                        65
│ …
│ ÉTAT DÉCLARÉ
│ ● Fluide                                         27
│ ÉVÉNEMENTS
│ ▲ Travaux                                       174
```

**Portée du chantier.** `_refreshMapLegend()` dans `manager.js` (le groupage passe de
« par couche » à « par ligne, puis par couche »), trois règles CSS, un champ dans
`layerFusions.js`. Aucun module de couche n'est touché : le contrat
`getRowControls() → { legend: [...] }` ne bouge pas.

---

## 4. Proposition B — le budget de la clé

Le précédent est la PR #141, qui a fait passer les bouées de 12 lignes et 692 px à 8 et 219.
Ses quatre règles s'appliquent telles quelles.

**B1 · Un nombre dans une phrase est dérivé, ou il n'existe pas.** Sortir les comptes tapés
des 7 phrases de rythme et des 5 phrases de bande. Ce qui survit est le **seuil**, qui est
gelé et vrai, et que C1 demande de publier : « le cœur de nuit pèse au moins 15 % de la
journée ouvrée ». Le défaut 2.1 disparaît par construction, pas par correction — on ne peut
pas re-taper un nombre qui n'a plus de champ où s'écrire.

**B2 · Une phrase par bloc, et c'est celle du registre.** Pas par ligne. Et le registre à
déclarer ici, c'est l'**horloge** (défaut 2.4) :

```
DÉBIT MESURÉ        modélisé par TomTom, rafraîchi toutes les 60 s
ÉTAT DÉCLARÉ        publié par les DIR, hors autoroutes concédées
ÉVÉNEMENTS          (rien — les noms de catégorie se décodent seuls)
COMPTAGES           semaine type du 31 août au 6 septembre, à l'heure choisie
```

**B3 · Une échelle de tailles ne prend pas une ligne par palier.** Les 5 bandes de débit
partagent une seule encre (`#eef3f9`) et ne diffèrent que par l'épaisseur : c'est exactement
la règle graduée que la #141 a supprimée chez les bouées, avec le même argument — la fiche
imprime déjà le nombre. Une ligne au lieu de cinq :

```
▬ Épaisseur = véhicules comptés dans l'heure, de moins de 100 à plus de 1 000
```

**B4 · L'inconnu prend un motif, et le même partout** (défaut 2.5). Un gris, un glyphe en
tirets, trois libellés qui gardent leur nuance de sens mais partagent le signe. Le lecteur
apprend un signe au lieu de trois.

**Ce que ça donne, estimé** (à mesurer au DOM avant de s'en réclamer) :

| | avant, mesuré | après, estimé |
|---|---|---|
| Rouen, comptages absents | 9 lignes · 104 mots · 397 px | ~9 lignes · ~30 mots · ~200 px |
| Paris, comptages demandés | 23 lignes · 559 mots · 1 256 px | ~20 lignes · ~90 mots · ~430 px |

Le gain n'est pas d'abord en lignes, il est en **mots** : −70 % à −85 %. C'est la prose qui
fait les 5,8 écrans de défilement, pas le nombre de classes.

---

## 5. Proposition C — la carte elle-même

La demande d'« y revoir la mise en carte » tombe juste : trois des sept défauts sont dans le
rendu, pas dans la clé, et aucune réécriture de légende ne les couvre.

### C1 · Aligner le vocabulaire de la congestion, garder les deux sources

Deux options, du moins cher au plus juste.

- **C1-a, minimale.** Les deux sous-couches gardent leur bloc, mais adoptent **le même
  triplet de mots** : Fluide / Ralenti / Bloqué (+ Impraticable, que seul le DIR sert). Le
  lecteur voit alors les mêmes trois mots sous deux titres de source différents et comprend
  immédiatement que c'est une question posée deux fois. La géométrie distingue déjà les
  deux — points animés contre ligne continue au sol.
- **C1-b, ambitieuse.** Un bloc « Congestion » unique à deux colonnes de comptes, *mesurée*
  et *déclarée*. Plus lisible, mais il faut dire que les deux discrétisations ne sont **pas**
  les mêmes (un ratio à la vitesse libre contre une énumération DATEX) — sans quoi on
  fabrique une échelle commune qui n'existe pas, ce que C1 interdit. Faisable, mais c'est un
  vrai composant de légende à deux colonnes.

**Recommandation : C1-a maintenant**, C1-b si la comparaison des quatre mesures devient un
usage revendiqué.

### C2 · La catégorie d'un événement est une variable NOMINALE : elle appartient à la forme

Huit teintes de catégorie sur des rues qui portent déjà une teinte de congestion, c'est A3
au niveau de la carte. Et B5 le dit dans l'autre sens : forme et taille ne mentent pas sur
un type inconnu. Le ré-encodage propre :

| variable | nature | canal aujourd'hui | canal proposé |
|---|---|---|---|
| catégorie (travaux, accident…) | nominale | **teinte** | **forme** — un pictogramme par catégorie |
| gravité | ordonnée | diamètre, partagé | **valeur** (luminance) ou diamètre seul |
| planifié / en cours | binaire | diamètre × 0,8 | **contour** — plein vs tirets |
| sécurité | binaire | diamètre + 2 px | à sortir du diamètre, ou à abandonner |

Cela libère **tout** le canal teinte sur la route pour la congestion, qui est la seule
variable ordonnée du sujet — donc la seule à qui une échelle de teintes est due.

Coût réel : huit pictogrammes. Maki et Temaki (CC0) couvrent chantier, barrière, accident,
déviation ; c'est le jeu déjà retenu ici. Attention au piège connu : livrer huit PNG
statiques dans l'atlas, jamais un canvas par entité — un canvas coûte une entrée d'atlas
**par billboard**.

Et la clé n'y perd rien : une silhouette de classe voyage **dans** la ligne de couleur, via
le champ `glyph` du contrat, comme le fait déjà `sharedMobilityFrance`. Pas de seconde liste
de formes — c'est ce que la #138 interdit.

### C3 · L'archive ne se dessine pas comme le direct

Les comptages sont une semaine type de fin août rejouée à une heure choisie. Sur la même
rue, au même instant, que des points TomTom mesurés il y a 60 secondes. Le `optIn` posé par
l'autre agent règle la question du *quand on la voit* ; reste celle du *comment on la
distingue*. La phrase de bloc (B2) est le minimum. Au-delà, le seul canal qui ne soit pas
déjà pris est la texture du trait.

### C4 · Ce qu'il faudrait peut-être cesser de dessiner

Question ouverte, posée sans réponse : les arcs de comptage portent **deux** variables à la
fois — le rythme en teinte, le débit en épaisseur. C'est légal au regard d'A3 (deux canaux,
deux informations) et c'est documenté dans le module. Mais l'épaisseur redit ce que les deux
couches de congestion disent déjà mieux, alors que **le rythme hebdomadaire est le seul
chose que personne d'autre ne cartographie**. Réduire l'épaisseur à deux états — mesuré /
non mesuré — et laisser le nombre à la fiche rendrait la carte franchement plus lisible.
C'est une perte assumée, donc une décision produit, pas une correction.

---

## 6. Ordre de livraison

| # | quoi | pourquoi d'abord | coût |
|---|---|---|---|
| 1 | B1 — sortir les nombres tapés des phrases | c'est faux **à l'écran** aujourd'hui | petit |
| 2 | 2.7 — les deux phrases anglaises | trois minutes | trivial |
| 3 | A — les deux étages | débloque tout le reste, et sert 9 fusions | moyen |
| 4 | B2/B3/B4 — le budget de la clé | se pose naturellement sur A | moyen |
| 5 | C1-a — un seul vocabulaire de congestion | supprime la lecture double | petit |
| 6 | C2 — catégorie → forme | le vrai gain de lisibilité de la carte | gros |
| 7 | C4 — arbitrage sur l'épaisseur | décision, pas correction | à décider |

Les points 1, 2 et 5 sont livrables ensemble et sans toucher au mécanisme.

---

## 7. Ce qu'on ne fait pas, et pourquoi

- **On ne fusionne pas les quatre modules.** Ce sont quatre sources, quatre licences, quatre
  jetons de partage. La table de fusions est une décision de **présentation** et le reste.
- **On ne masque pas les sous-couches derrière un accordéon.** Une clé qu'il faut déplier
  n'est pas une clé (D1) : « une légende repliée dans un panneau qui recouvre la carte est
  une dette d'interface ».
- **On n'ajoute pas de ligne de forme séparée.** Règle de la #138 : la clé porte la couleur ;
  une forme qui se décode sans clé n'y a pas droit. Les pictogrammes de C2 voyagent dans la
  ligne de couleur.
- **On ne dérive pas les seuils de la vue.** Les coupures de rythme, de bande et de statut
  restent gelées (C1, D2) : deux lecteurs d'un même lien doivent lire la même légende.

---

## 8. Coordination

Un autre agent travaille dans ce workspace sur la même table. Au 2026-09-10 il a, non
commité :

- `src/data/layerCoverage.js` — nouveau, la territorialité des contrôles ;
- `src/data/layerFusions.js` — `comptages-fr` passe `optIn` ;
- `src/data/manager.js` — `setCoverageView`, le briefing de couverture.

La proposition A touche **`_refreshMapLegend()` dans `manager.js`** et **`layerFusions.js`**.
Les deux zones sont disjointes de son travail — il touche l'en-tête de la table et le
constructeur du manager, A touche une entrée de la table et une méthode de rendu — mais ce
n'est pas une garantie. À rebaser sur son travail plutôt qu'à mener en parallèle.
