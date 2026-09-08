# Le trajet multimodal — ce que coûte vraiment « 23 min en TC jusqu'à La Défense »

*Palier 2, point 4 du triage `docs/CITYSCAN.md`. Chiffrage mesuré le 8 septembre
2026, sur cette machine, avec de vraies données. Rien ici n'est estimé de tête ;
ce qui est extrapolé est marqué comme tel et porte son modèle.*

---

## 0. La question, et pourquoi elle ne se répond pas à vue

`docs/CITYSCAN.md` disait : « nos isochrones tiennent ; *23 min en TC jusqu'à La
Défense* demande un moteur hébergé (OTP/Valhalla) ». C'est vrai et ça ne décide
rien : un moteur hébergé, c'est une **machine louée au mois**, et la seule
question qui compte est sa taille.

Cette taille ne se devine pas. Elle dépend d'un objet qu'aucune documentation ne
publie pour la France : le **graphe** — toutes les rues du pays plus tous les
horaires, cousus ensemble et tenus en mémoire. Alors il a été construit.

Trois graphes régionaux réels ont été bâtis de bout en bout, un modèle a été
ajusté dessus, et la France en a été extrapolée. Un quatrième build — la France
entière — a été lancé sur cette machine pour voir où est le mur. Il l'a trouvé
(§3 bis).

**Ce qui a servi :** OpenTripPlanner **2.9.0** (sortie du 2026-03-18, la version
qu'on déploierait aujourd'hui), JDK 26, MacBook 16 Go / 10 cœurs.

---

## 1. Ce que le moteur doit avaler

### Les rues

`france-latest.osm.pbf` de Geofabrik, mesuré le 2026-09-08 :

| | |
|---|---|
| Taille | **5 076 560 568 octets** (5,08 Go) |
| Nœuds | **526 086 201** |
| Chemins | **73 316 918** |
| Relations | **1 101 877** |

(`osmium fileinfo -e`, 7 s sur 10 cœurs.)

### Les horaires

Le Point d'Accès National publie **472 jeux GTFS**. Tous ne sont pas nécessaires :
7 régions publient un **agrégat** « réseaux urbains ET interurbains », ce qui
avale d'un coup les dizaines de réseaux d'EPCI de leur territoire.

La règle retenue, énonçable et reproductible : **tout GTFS dont la zone couverte
est une région ou le pays**, plus les réseaux urbains denses des régions qui ne
publient pas d'agrégat (TCL, RTM, Tisséo, ilévia, Lignes d'Azur). Soit **44
flux**, dont un rejeté (voir §5) :

| | |
|---|---|
| Flux | **44** (43 exploitables) |
| Poids zippé | **930,2 Mo** |
| `stop_times` | **35 508 239** |

Pour comparaison, le seul IDFM pèse **186,6 Mo zippés, 1,79 Go décompressés**,
dont **980 Mo de `stop_times.txt`** et 710 Mo de `shapes.txt`.

---

## 2. Trois graphes construits pour de vrai

Trois régions choisies pour couvrir l'espace du problème : une minuscule, une
grande et rurale, une grande et dense. Bretagne et Île-de-France ont **presque
exactement la même taille de rues** (4,53 contre 4,94 millions de chemins) et un
facteur **3,8 sur les horaires** — c'est ce couple qui sépare le coût des rues
du coût des horaires.

| | chemins OSM | `stop_times` | arrêts | `graph.obj` | build | RSS max | heap vivant en service |
|---|---|---|---|---|---|---|---|
| **Corse** | 429 610 | 17 567 | 370 | **20,7 Mo** | **10 s** | 2,87 Go | — |
| **Bretagne** | 4 532 173 | 2 447 121 | 17 592 | **317 Mo** | **140 s** | 4,29 Go | **0,97 Go** |
| **Île-de-France** | 4 943 695 | 9 262 956 | 39 898 | **886 Mo** | **1 061 s** ⚠ | 3,97 Go | **3,59 Go** |

⚠ Le build francilien tournait pendant que la machine téléchargeait 5 Go d'OSM
et 930 Mo de GTFS : `PhysMem` à 95 Mo libres, `Load Avg` à 32. **Ce temps est
pessimiste et n'est pas comparable aux deux autres**, qui ont tourné à vide. Il
est publié tel quel plutôt que réparé, parce qu'un chiffre repassé au propre
sans le dire vaut moins qu'un chiffre honnête et annoté.

« Heap vivant » = ce que le ramasse-miettes n'a pas pu rendre après un `GC.run`
forcé, mesuré par `jcmd GC.heap_info` sur le serveur en train de répondre. C'est
le seul chiffre de mémoire qui se transporte d'une machine à l'autre : le RSS,
lui, dépend du `-Xmx` qu'on a donné.

---

## 3. Le modèle, et la France

Moindres carrés sur les trois points, `graph.obj` contre (millions de chemins,
millions de `stop_times`) :

> **`graph.obj` ≈ 26,1 Mo par million de chemins + 81,7 Mo par million de
> `stop_times`**

Résidus : **Bretagne +0,4 %**, **Île-de-France 0 %**, **Corse −39 %**. La Corse
est sous-estimée parce que le modèle n'a pas d'ordonnée à l'origine et qu'un
graphe minuscule porte quand même ses index ; c'est sans effet sur une
extrapolation nationale, où le terme constant est du bruit.

Appliqué à la France :

| | |
|---|---|
| Rues | 73,3 M chemins × 26,1 Mo = **1 913 Mo** |
| Horaires | 35,5 M `stop_times` × 81,7 Mo = **2 901 Mo** |
| **`graph.obj` France** | **≈ 4,8 Go** *(extrapolé)* |

Le rapport mesuré entre le graphe sur disque et le heap vivant en service est de
**3,06×** (Bretagne) et **4,05×** (Île-de-France) — l'écart vient de la densité
des horaires, qui portent des index et 206 618 correspondances contraintes en
Île-de-France contre 109 287 en Bretagne. La France, plus proche du régime
francilien par le volume d'horaires que du régime breton :

> **heap vivant France ≈ 15 à 19 Go** *(extrapolé)*

Une JVM ne se pilote pas au ras de son ensemble vivant — il lui faut de la marge
de ramasse-miettes, en pratique 1,5 à 2× :

> **`-Xmx` de 24 à 32 Go, donc une machine de 32 Go au minimum, 48 à 64 Go pour
> être tranquille.**

---

## 3 bis. Le contrôle : la France sur 16 Go, et où est exactement le mur

L'extrapolation ci-dessus dit « 32 Go au minimum ». Une extrapolation qu'on ne
tente pas de casser est une opinion, alors la France entière a été lancée sur
cette machine de 16 Go avec `-Xmx11G`, sur les 43 flux exploitables et les
5,08 Go d'OSM.

**Elle ne construit pas.** Et la façon dont elle échoue est plus instructive
qu'un `OutOfMemoryError` : le moteur ne tombe pas, il **ralentit d'un facteur
840**. OTP lit le fichier OSM en trois passes, et le débit de chacune est écrit
dans son journal :

| Passe | Débit |
|---|---|
| Relations | **108,1 Mo/s** — 5,1 Go en 46,957 s |
| Chemins | **24,0 Mo/s** — 5,1 Go en 3 min 31,367 s |
| Nœuds | **0,128 Mo/s** — bloquée à **19 %** après quatorze minutes |

Les deux premières passes tiennent en mémoire. La troisième n'y tient plus,
parce que l'index des 73,3 millions de chemins construit par la deuxième y est
resté. À ce moment précis, mesuré : la JVM réclame 11 Go, **le système ne lui en
garde que 1,14 Go résident**, le processus brûle **171 % de CPU** à faire
entrer et sortir des pages, et `PhysMem` affiche **41 Mo libres**.

À 0,128 Mo/s, les 4,1 Go restants de cette seule passe demanderaient **près de
neuf heures** — avant la construction du graphe de rues, le raccrochage des
arrêts et la génération des correspondances, qui sont les trois étapes lourdes.
Le build a été arrêté après **22 min 56 s** : la courbe de décroissance a déjà
dit ce qu'il y avait à savoir, et neuf heures de machine à genoux n'auraient
rien ajouté.

**Ce que ce contrôle établit** : le chiffre de 32 Go n'est pas une marge de
confort, c'est un seuil. En dessous, le build ne rend pas un résultat en
retard — il ne rend rien, en occupant la machine.

---

## 4. Ce que le produit fait, une fois le moteur debout

Mesuré sur le graphe francilien, un mardi de semaine à 08 h 30, six tirs par
trajet, p50 :

| Trajet | Réponse | Temps |
|---|---|---|
| **av. de France → La Défense** | **34 min, 2 correspondances, RER C › B › A** | **748 ms** |
| Melun → La Défense | 73 min, 1 correspondance, R › A | 291 ms |
| Cergy → Créteil | 100 min, 2 corr., bus 1201 › RER A › TVM | 362 ms |
| Meaux → Versailles | 104 min, 2 corr., P › E › L | 558 ms |
| Paris 13e → Roissy CDG | 68 min, 2 corr., C › B › bus 350 | 628 ms |

La première ligne est, mot pour mot, la phrase que `docs/CITYSCAN.md` donnait
comme hors de portée. Elle est vraie, elle est calculée en trois quarts de
seconde, et elle nomme les lignes.

**Démarrage : 17 secondes** depuis `graph.obj`. Un redémarrage n'est pas un
événement ; une reconstruction en est un.

---

## 5. Les deux choses que personne ne dit avant de payer

### Ce n'est pas une facture unique, c'est un abonnement au travail

Mesuré sur l'index du dépôt (`config/pan_gtfs_static.json`, 173 flux datés) :

| Millésime republié depuis moins de | |
|---|---|
| 1 jour | **16 flux (9 %)** |
| 7 jours | **68 flux (39 %)** |
| 14 jours | **88 flux (51 %)** |
| 30 jours | **114 flux (66 %)** |

Ancienneté médiane : **13,2 jours**. Un graphe vieux d'une semaine ignore déjà
le dernier millésime de **39 %** du corpus. La reconstruction hebdomadaire est
le plancher, pas l'ambition — et une reconstruction, c'est la machine de 32 Go
occupée pendant tout le build.

### Un seul flux cassé arrête tout

`gtfs-81996.zip` (Corsica Ferries, réseau maritime) publie un `route_id` **vide**
à la ligne 27 de son `routes.txt`. Le champ est obligatoire dans la spécification
GTFS. OTP 2.9 lève `MissingRequiredFieldException` et **refuse le build entier** :
pas d'avertissement, pas de flux ignoré, pas de graphe.

Trouvé en construisant la Corse — quatre flux, dix secondes. Sur un build
national de plusieurs heures, la même ligne coûte la nuit. Un moteur national
n'est donc pas « un cron qui rebuild » : c'est un cron **plus une étape de
validation et de mise en quarantaine**, plus quelqu'un qui regarde ce qui a été
mis en quarantaine.

---

## 6. Ce qui n'est pas mesuré ici

- **Valhalla et MOTIS.** Tous deux travaillent sur des tuiles **projetées en
  mémoire** (`mmap`) au lieu de tenir le graphe dans le tas d'une JVM, ce qui
  change la nature de la contrainte : la RAM cesse d'être un plancher dur et
  devient un cache. Si le chiffre de 32 Go ci-dessus est ce qui bloque la
  décision, **c'est la piste à mesurer avant de renoncer** — et elle n'est pas
  mesurée ici, donc elle n'est pas chiffrée ici.
- **La qualité des itinéraires**, au-delà du fait qu'ils sont plausibles et
  nomment les bonnes lignes. Comparer à Citymapper ou au Assistant SNCF demande
  un corpus de trajets de référence, qui est un autre chantier.
- **Le temps réel.** Les 150 flux GTFS-RT chiffrés dans
  `docs/CHRONIQUE-GTFS-RT.md` se branchent sur un OTP en service, mais leur coût
  d'ingestion continue n'est pas dans les chiffres ci-dessus.

---

## Sources et méthode

OpenTripPlanner 2.9.0 (`otp-shaded-2.9.0.jar`, commit `9babe45`), JDK 26,
macOS, 16 Go, 10 cœurs. OSM : Geofabrik, extraits `france`, `ile-de-france`,
`bretagne`, `corse` du 2026-09-08. GTFS : transport.data.gouv.fr, API
`/api/datasets`, téléchargements du 2026-09-08. Cadence de republication :
`config/pan_gtfs_static.json`, index du dépôt généré le 2026-09-07.

Chaque build a été mesuré avec `/usr/bin/time -l` (RSS maximum) et chaque heap
vivant avec `jcmd GC.run` suivi de `jcmd GC.heap_info`.
