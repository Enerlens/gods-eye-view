# Plan des croisements de données

*État de l'audit du 2026-09 sur les 62 lignes du panneau `DATA LAYERS` : ce qui
a été livré, ce qui reste dû, et — pour chaque point resté dehors — la raison
qui l'a fait rester dehors. Un plan qui ne dit pas pourquoi il s'arrête est une
liste de vœux.*

---

## Le constat de départ

Le panneau listait **quatorze sujets dessinés par deux à quatre lignes chacun**,
et le dépôt ne savait croiser qu'à **trois endroits** : la Fiche implantation,
les trois thèmes des volumes BD TOPO, et la radiographie d'adresse. Hors de ces
trois surfaces, **aucune couche ne lisait la donnée d'une autre.**

La raison n'était pas un oubli, elle était structurelle : un module de couche est
un singleton avec un cycle de vie, et en importer un depuis un autre couple deux
cycles, charge un paquet qui ne sera peut-être jamais allumé, et fait un cycle
dès que la seconde couche veut quelque chose en retour. Les croisements
n'avaient donc pas été écrits.

---

## Livré

### Les fusions — 62 lignes → 38

`src/data/layerFusions.js`. Quinze entrées replient **23 couches** dans la ligne
du sujet auquel elles appartiennent, chacune devenant une pastille ronde sous
cette ligne. Rien n'est supprimé : id, module, cycle de vie, cache, jeton de
partage, clé sur la carte et crédit sont conservés, et un lien envoyé avant la
fusion rallume exactement ce qu'il rallumait.

Quand une fusion mélange une couche mondiale et une couche française, c'est la
**mondiale** qui garde la ligne (`bikeshare` devant `shared-mobility-fr`,
`local-datacenters` devant `anfr-fr`) : un lecteur hors de France ne doit pas
voir une pastille `FR` au-dessus de données qui le concernent.
`layerFusions.test.mjs` l'affirme.

### Le tableau d'affichage

`src/data/layerJoins.js`. Une couche offre un fait sous une clé, une autre le
lit, aucune des deux ne s'importe. Trois propriétés : aucun arc d'import,
l'absence est ordinaire (`null`, et le consommateur en dit **moins**), un
`throw` est contenu et averti une fois.

### Les croisements branchés dessus

| Croisement | Ce qu'il ajoute | Clés |
|---|---|---|
| Navire → port | `→ Antwerpen · 26 km` au lieu de `→ BEANR`, 50,5 % du champ résolu, mesuré sur 2 250 navires | `ports/directory` |
| Navire → mer | `MER SLIGHT · 1 m · bouée 62170 à 128 km` | `buoys/nearest` |
| Vol → destination | `AUS → LAX · 1 994 km` — les coordonnées qu'adsbdb publiait sans lecteur | — |
| Aéroport → ciel | `1 en approche — TVF57PQ` | `flights/boundFor` |
| Centrale hydro → eau | `≋ 560 m³/s à 2,7 km — station Le Rhône à Tarascon` | `gauges/nearest` |
| Centrale hydro → ouvrage | `▰ Barrage de Saint-Nicolas à 1,2 km — aucun registre ne le relie` | `dams/nearest` |

### La porte vers la radiographie

`src/data/ficheSheet.js` — la pastille `RADIOGRAPHIE` sur la ligne
`Zone de chalandise` encadre `fiche.html` sur le point que le globe scanne. Et
la feuille lit **dix-sept routes au lieu de quinze** : `Nuisances` gagne le
bruit aéronautique, `Numérique` gagne les supports ANFR.

---

## Reste dû, et pourquoi

### 1. Dédoublonner les centrales électriques

**Ce qui manque.** Trois registres — `edf-power-plants`, `rte-generation`,
`fr-hydro-plants` — plus 14 centrales dans `gas-fr`, se partagent 56 sites, dont
5 sites gaz dessinés deux fois avec des mégawatts différents. La fusion les a
mis sur une ligne ; elle ne les a pas dédoublonnés.

**Pourquoi c'est resté dehors.** Le dédoublonnage se fait sur le code EIC entre
ODRÉ et RTE et sur l'identifiant ODRÉ ailleurs, et il faut choisir *quelle*
source fait foi pour la position et *laquelle* pour la puissance — ce n'est pas
un filtre, c'est une colonne vertébrale à écrire, avec une échelle de puissance
partagée que `REPRESENTATION.md` réclamait déjà. C'est un chantier à part
entière, pas la seconde moitié d'une ligne de table.

### 2. Sortir la famille « médecin » d'`Équipements du quotidien`

**Ce qui manque.** `amenities-fr` dessine la BPE D265 (61 263 lignes) et
`medecins-fr` dessine le registre conventionné (64 232 adresses). Le même
cabinet est dessiné deux fois. La règle qu'`amenities-fr` s'applique déjà —
« un seul registre par famille », qui lui fait refuser tout le domaine
enseignement de la BPE — dit qu'il doit se retirer.

**Pourquoi c'est resté dehors.** `AMENITY_FAMILIES` **est une clé de cache** :
le maillage stocke une famille par son INDEX dans ce tableau, et son propre
en-tête dit que réordonner ce tableau renomme silencieusement chaque ligne d'un
paquet en cache. Retirer un élément décale tous les indices suivants. Le
changement demande donc un `AMENITIES_CACHE_VERSION` de plus **et une
reconstruction du paquet national** — mesurée ici à 58 s à froid, et vue en
échec (`[Amenities Proxy] national build unavailable: terminated`) pendant cette
session. Le faire à moitié aurait laissé un maillage dont les couleurs mentent.

L'autre moitié du point 16 de l'audit — « Médecins absorbe pharmacies et
hôpitaux FINESS » — demande en plus de reconstruire le paquet `medecins.json`
depuis `npm run medecins:registry`, donc une modification du script de build.

### 3. Le bâtiment comme pivot

**Ce qui manque.** Un clic sur un volume BD TOPO donne déjà ses identifiants
RNB, ses adresses et ses parcelles. Il devrait ensuite tirer la dernière vente
DVF par parcelle, les permis Sitadel par référence de parcelle, et la zone PLU
au point.

**Pourquoi c'est resté dehors.** Les trois tirages sont des **requêtes réseau
déclenchées par une carte**, ce que le dépôt ne fait nulle part aujourd'hui :
toutes ses cartes se composent sur de la donnée déjà résidente. C'est un motif à
poser (annulation, état de chargement sur la carte, cache par parcelle) avant
d'être un croisement. `cadastreParcelDetail` est déjà nommé comme le prochain
consommateur.

### 4. IRVE et QualiCharge — « libre maintenant »

**Ce qui manque.** `qualichargeDynamic.js` décode déjà l'état temps réel de
75 427 points de charge, avec ses trois pièges mesurés — dont celui qui gonfle
la capacité libre de 44,4 % si l'on lit les lignes périmées. Il n'alimente que
la chronique, jamais la couche IRVE.

**Pourquoi c'est resté dehors.** La jointure se fait sur `id_pdc_itinerance`, et
la couche IRVE **n'a pas cet identifiant** : sa requête de viewport GROUPE les
lignes pour être payable (4 017 lignes de Paris centre → 469 lignes groupées),
et `IRVE_GROUP_FIELDS` exclut explicitement `id_station_itinerance` parce que
l'inclure défait le groupement. QualiCharge, de son côté, ne publie aucune
coordonnée. Il faut donc une table `id_pdc → coordonnée` construite côté
serveur depuis le fichier consolidé — une seconde passe nationale, avec son
cache et son TTL. C'est une route de proxy à écrire, pas une ligne de carte.

### 5. Une semaine type partagée

**Ce qui manque.** `comptages-fr`, `velo-pulse-fr` et `idfm-frequency` ont
chacun leur curseur d'heure de la semaine type, et la chronique en accumule
quatre autres. Depuis la fusion, la ligne `Trafic routier` allumée porte
**quatorze pastilles**, dont sept viennent du seul sélecteur d'heure des
comptages. « Paris, mardi 8 h » devrait être un geste.

**Pourquoi c'est resté dehors.** Un contrôle partagé veut dire un module qui
possède « l'heure de la semaine », trois couches qui s'y abonnent, et une
décision sur ce que chacune met dans son jeton de partage — les trois encodent
aujourd'hui leur heure séparément et des liens déjà envoyés en dépendent.
C'est le croisement le plus visible qui reste, et le seul dont la difficulté est
dans la **grammaire de partage** plutôt que dans la donnée.

### 6. Vigilance et tronçons

**Ce qui manque.** La carte d'un département en vigilance crues devrait citer
ses tronçons Vigicrues.

**Pourquoi c'est resté dehors.** Deux obstacles, et le second est le vrai : la
vigilance ne dessine pas de carte du tout — elle pose une **étiquette** non
interactive par département (`createVigilanceOverlayEntry`,
`interactive: false`), donc il n'y a rien où accrocher la ligne. Et un tronçon
Vigicrues ne porte **aucun code de département** : le rattacher demanderait un
point-dans-polygone de chaque tronçon contre chaque contour départemental, à
chaque bulletin. Beaucoup de machinerie pour une étiquette d'une ligne.

### 7. La destination AIS : les exonymes et les ports fluviaux

**Ce qui manque.** 49,5 % des destinations restent non résolues. Deux familles
sont rattrapables : les exonymes (`ANTWERP` contre `Antwerpen`, `GENOA` contre
`Genova`, `GENT` contre `Ghent` — 35 navires mesurés sur ces trois-là seulement)
et les ports fluviaux du Rhin et de la Seine (`MAINZ` 14, `PARIS` 9,
`FRANKFURT` 9, `DUISBURG`, `NEUSS`, `KARLSRUHE`, `KÖLN`, `MAASTRICHT`).

**Pourquoi c'est resté dehors.** Les deux demandent une **table de noms avec une
source**, pas un rapprochement flou : UN/LOCODE publie les variantes de nom, et
les ports fluviaux ne sont pas dans le World Port Index parce que le WPI est un
index de ports **maritimes**. Inventer les alias dans le dépôt aurait été
exactement le rapprochement approximatif que `portDirectory.js` refuse.

### 8. Élargir la résolution de trajet des vols

**Ce qui manque.** `flights/boundFor` répond 0 partout sur une session fraîche,
parce que `_requestRouteEnrichment` ne se déclenche que pour le contact **suivi**.

**Pourquoi c'est resté dehors.** L'élargir veut dire mettre les recherches de
trajet dans le seau de jetons ambiant, dimensionné par mesure contre les
recherches de **type** (`ENRICH_AMBIENT_BUDGET_CEIL` = 1000, recharge 150 / 5 min,
`npm run qa:enrich-budget`). Doubler ce que le seau paie sans remesurer
invaliderait la mesure qui l'a fixé.
