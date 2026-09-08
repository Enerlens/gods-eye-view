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

Trois graphes régionaux réels ont été bâtis de bout en bout avec
**OpenTripPlanner**, un modèle a été ajusté dessus, et la France en a été
extrapolée (§1 à §3). Puis la même question a été posée à un moteur d'une autre
famille, **MOTIS**, qui projette ses données en mémoire au lieu de les tenir
dans un tas JVM — et la réponse n'est pas la même (§7).

**La réponse courte, pour qui ne lit que ce paragraphe.** Avec OTP, la France
demande une machine de **32 Go** et cette machine-ci n'y arrive pas. Avec MOTIS,
la France entière s'importe en **6 min 41 s**, se sert sous **2 Go résidents**
et répond en **24 à 32 ms** — sur ce même Mac. Le prix de 32 Go n'est pas le
prix du produit, c'est le prix d'OTP. Mais MOTIS **ne lit pas le GTFS de
l'Île-de-France**, donc « la France sur une petite machine » veut dire
aujourd'hui « la France moins Paris », et c'est un défaut d'un flux, pas d'une
architecture.

**Ce qui a servi :** OpenTripPlanner **2.9.0** (sortie du 2026-03-18) et
**MOTIS 2.11.2** (2026-08-12), les versions qu'on déploierait aujourd'hui.
JDK 26, MacBook 16 Go / 10 cœurs — dont 15 Go étaient déjà occupés par d'autres
applications au repos, ce qui compte pour lire le §3 bis.

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

### Ce que ce contrôle établit — et ce qu'il n'établit PAS

Il montre **le mode de panne**, et c'est le seul titre qu'il mérite : privée de
mémoire résidente, la JVM ne rend pas un résultat en retard, elle ne rend rien
en occupant la machine. Il n'y a pas de version dégradée « ça tourne lentement ».

Il ne montre **pas** que « la France demande plus de 16 Go », et il faut le dire
franchement parce que la première rédaction de cette page le laissait entendre.
**Ce Mac n'avait pas 16 Go à offrir.** Mesuré après coup, au repos, sans aucun
build en cours : **607 processus, `PhysMem` à 15 Go utilisés et 154 Mo libres**,
dont 1,47 Go de WebKit, 1,5 Go réparti sur les aides d'Arc, 0,65 Go pour
ChatGPT/Codex et 1 Go de Chrome laissé par les harnais QA. Le `-Xmx11G` donné à
OTP ne pouvait pas être honoré : il restait autour de **4 à 6 Go réellement
disponibles**, et c'est ce chiffre-là, pas 16, que la troisième passe a heurté.

Ce que le contrôle vaut donc exactement : **il confirme la forme de la panne, il
ne mesure pas le seuil.** Le seuil vient de §3 — de trois builds régionaux
propres et du modèle ajusté dessus —, et il n'a pas besoin de ce quatrième
essai. Un contrôle honnête du seuil demanderait une machine dédiée de 16 Go et
une autre de 32 ; il reste à faire, et il n'est pas fait ici.

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

- **Valhalla.** Non mesuré. Son routage piéton/voiture est excellent, mais son
  support du transport en commun est moins éprouvé que celui des deux autres, et
  la question posée ici est multimodale de bout en bout. MOTIS, lui, a été
  mesuré : voir §7.
- **La qualité des itinéraires**, au-delà du fait qu'ils sont plausibles et
  nomment les bonnes lignes. Comparer à Citymapper ou au Assistant SNCF demande
  un corpus de trajets de référence, qui est un autre chantier.
- **Le temps réel.** Les 150 flux GTFS-RT chiffrés dans
  `docs/CHRONIQUE-GTFS-RT.md` se branchent sur un OTP en service, mais leur coût
  d'ingestion continue n'est pas dans les chiffres ci-dessus.

---

---

## 7. MOTIS — la même question posée à un moteur mémoire-projetée

Le §6 disait « c'est la piste à mesurer avant de renoncer ». Elle a été mesurée,
le même jour, sur la même machine, avec les mêmes fichiers.

**MOTIS 2.11.2** (binaire macOS arm64 officiel) ne tient pas son graphe dans le
tas d'un processus : il écrit des fichiers **projetés en mémoire** (`mmap`) et
laisse le système d'exploitation décider de ce qui reste résident. La contrainte
change de nature — la RAM cesse d'être un plancher dur et devient un cache.

Le générateur de tuiles vectorielles a été **désactivé** dans sa configuration,
parce qu'OTP n'en construit pas non plus et que GEV dessine son propre globe :
comparer un routeur à un routeur + un serveur de tuiles n'aurait pas été
comparer.

### Ce qu'il fait de la France, sur ce Mac de 16 Go

| | |
|---|---|
| Périmètre | **la France entière** — 5,08 Go d'OSM, 43 flux, **26 925 380 `stop_times`** |
| Import | **401 s** (6 min 41 s) |
| RSS maximum à l'import | **5,60 Go** |
| Données produites | **8,3 Go** — dont 4,2 Go de routage rue, 1,8 Go d'adresses, 1,0 Go de tracés, **745 Mo de grille horaire** |
| Démarrage du serveur | **11 s** |
| **Résident en service** | **1,47 Go** au démarrage, **1,91 Go** après 600 requêtes |

C'est la ligne qui décide : **la France entière servie sous 2 Go résidents**,
pendant qu'OTP demandait 3,59 Go d'ensemble vivant pour la seule Île-de-France.
Le résident monte avec l'usage — c'est le cache qui se remplit — et reste très
en dessous des 8,3 Go du jeu de données, ce qui est exactement la promesse du
`mmap`.

### Et il répond vite

| Trajet | Réponse | p50 |
|---|---|---|
| av. de France → La Défense | 39 min, C › B › A | **26 ms** |
| Paris Gare de Lyon → Lyon Part-Dieu | 123 min, direct | **24 ms** |
| Bordeaux → Toulouse | 192 min, 1 corr. | **32 ms** |
| Lille Flandres → Roubaix | 35 min, métro M2 | **24 ms** |
| Rennes → Brest | 136 min, direct | **26 ms** |

Sur 300 trajets entre vingt gares françaises tirées au hasard : **p50 88 ms,
p90 244 ms, p99 360 ms**, 250 avec itinéraire. OTP, sur la seule
Île-de-France, mesurait 291 à 748 ms.

### Le mais, et il est gros

**MOTIS 2.11.2 ne lit pas l'Île-de-France.**

Les 44 flux du corpus ont été passés un par un dans MOTIS, sur une base OSM
minuscule, pour savoir lesquels il accepte : **42 sur 43 passent**. Le seul
refus est **IDFM** — le réseau qui compte le plus, et celui sur lequel porte la
question du produit. L'erreur est
`ankerl::unordered_dense::map::at(): key not found`, et elle survit au retrait
de `frequencies.txt` (que l'IDFM publie **vide**, en-tête seul),
`transfers.txt`, `platform_groups.txt`, `ticketing_deep_links.txt`,
`attributions.txt` **et** `shapes.txt`. Les deux ressources GTFS téléchargeables
de l'IDFM échouent identiquement : la « modifiée » (80931, 186 Mo) et
l'« originale » (80921, 117 Mo). La troisième (83316) répond **403**.

La France mesurée ci-dessus est donc **la France moins Paris** :
26 925 380 `stop_times` sur les 35 508 239 du corpus, soit **75,8 %**. Elle
route correctement de Lille à Roubaix et de Rennes à Brest ; « Melun → La
Défense » ne trouve rien.

### La symétrie qui est le vrai enseignement

- **OTP refuse Corsica Ferries** (un `route_id` vide) — **MOTIS l'accepte**.
- **MOTIS refuse l'IDFM** — **OTP l'accepte**.

**Aucun des deux moteurs ne lit la France telle qu'elle est publiée.** Ce n'est
pas un défaut d'un moteur, c'est une propriété du corpus : il contient des
défauts que deux implémentations rigoureuses ne rencontrent pas au même endroit.
La conclusion du §5 s'en trouve renforcée, pas remplacée — **la couche de
validation et de réparation n'est pas optionnelle, quel que soit le moteur
choisi.**

### Ce que ça change pour la décision

| | OTP 2.9.0 | MOTIS 2.11.2 |
|---|---|---|
| Ce qui a été construit sur ce Mac | **Île-de-France seule** | **France moins Paris** |
| Construction | 1 061 s (IDF) | **401 s (France)** |
| RSS maximum à la construction | 3,97 Go (IDF) | 5,60 Go (France) |
| Sur disque | 886 Mo (IDF) · **4,8 Go France, extrapolé** | **8,3 Go (France, mesuré)** |
| Démarrage | 17 s | **11 s** |
| **Mémoire en service** | **3,59 Go vivants (IDF)** · **15–19 Go France, extrapolé** | **1,91 Go (France, mesuré)** |
| Latence | 291–748 ms (IDF) | **24–32 ms** (mêmes trajets) |
| France sur cette machine | **échec** | **réussi** |
| Flux français refusés | Corsica Ferries | **IDFM** |

Le chiffre de 32 Go du §3 **n'est donc pas le prix du produit, c'est le prix
d'OTP**. Avec un moteur mémoire-projetée, la France tient sur une machine
ordinaire — disque un peu plus généreux, mémoire cinq à dix fois moindre,
requêtes dix à trente fois plus rapides.

Ce qui reste bloquant est **une seule ligne d'un seul flux**, pas une
architecture. Et c'est un problème qui a un propriétaire : soit l'IDFM publie un
GTFS que MOTIS lit, soit le défaut est remonté à MOTIS, soit la couche de
réparation du §5 le corrige en amont. Tant que ce n'est pas fait, « la France
sur une petite machine » veut dire **la France moins Paris**, et Paris est
précisément la scène du produit.

---

## Sources et méthode

OpenTripPlanner 2.9.0 (`otp-shaded-2.9.0.jar`, commit `9babe45`) et MOTIS
2.11.2 (`motis-macos-arm64`), JDK 26,
macOS, 16 Go, 10 cœurs. OSM : Geofabrik, extraits `france`, `ile-de-france`,
`bretagne`, `corse` du 2026-09-08. GTFS : transport.data.gouv.fr, API
`/api/datasets`, téléchargements du 2026-09-08. Cadence de republication :
`config/pan_gtfs_static.json`, index du dépôt généré le 2026-09-07.

Chaque build a été mesuré avec `/usr/bin/time -l` (RSS maximum) et chaque heap
vivant avec `jcmd GC.run` suivi de `jcmd GC.heap_info`.

**Un piège pour qui reproduit.** OTP 2.x reconnaît un GTFS **au nom du fichier**,
pas à son contenu : un `80931.zip` est ignoré, un `gtfs-80931.zip` est lu. Un
premier build francilien a donc tourné dix-neuf minutes, s'est terminé sans
erreur, a écrit un `graph.obj` de 338 Mo — et ce graphe ne contenait aucun
transport en commun. La seule trace était un `❓` devant le nom du fichier dans
le journal, et un `Transit built. |Stops|=0` tout à la fin. Un succès silencieux
qui n'en est pas un : exactement le mode de panne que ce dépôt refuse ailleurs.
