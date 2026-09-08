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
**la France entière — Paris compris — s'importe en 4 min 34 s, se sert sous
2 Go résidents et répond à p50 170 ms** sur ce même Mac : *av. de France →
La Défense en 25 min par le M14 et le RER A, Melun → La Défense en 55 min par
la ligne R et le RER A*. Le prix de 32 Go n'est pas le prix du produit, c'est le
prix d'OTP.

Le refus du GTFS francilien, qui bornait ce document à « la France moins
Paris », **n'était pas un défaut de la donnée** : c'est une table de MOTIS
2.11.2 dont les clés pointent sur un tampon déjà libéré, corrigée en amont le
30 août 2026 et absente de toute version publiée. Une colonne retirée d'un
fichier de 8 584 octets suffit à l'attendre. **Un moteur, pas deux** — §8.

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

**Ce paragraphe est laissé tel qu'il a été mesuré, et il est exact — mais son
titre l'était moins. La cause a été trouvée depuis, et ce n'est pas la donnée :
voir §8.** L'IDFM ne publie rien d'illégal ni d'invalide ; c'est MOTIS 2.11.2
qui lit une table dont les clés ont été libérées. Le §8 le démontre, le répare
en une colonne, et construit **la France entière, Paris compris, sur ce même
Mac**.

### La symétrie qui est le vrai enseignement

- **OTP refuse Corsica Ferries** (un `route_id` vide) — **MOTIS l'accepte**.
- **MOTIS refuse l'IDFM** — **OTP l'accepte**.

**Aucun des deux moteurs ne lit la France telle qu'elle est publiée.** Le
constat tient ; sa cause, elle, n'est pas la même des deux côtés, et le §8 a
tranché : le refus de Corsica Ferries est un **défaut de donnée** (un
`route_id` vide, que la spécification interdit), le refus de l'IDFM est un
**défaut de moteur** — une table de correspondance dont les clés pointent sur
un tampon déjà libéré, corrigée en amont le 30 août 2026 et absente de toute
version publiée. Symétrie de forme, pas de nature.

La conclusion du §5 s'en trouve renforcée, pas remplacée — **la couche de
validation et de réparation n'est pas optionnelle, quel que soit le moteur
choisi.** Elle sert même à deux choses distinctes : réparer ce que les
producteurs publient de travers, et **contourner ce que le moteur du moment ne
sait pas lire**. Le second est temporaire, le premier ne l'est pas.

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
| Flux français refusés | Corsica Ferries | **IDFM** — bug moteur, réparé en une colonne (§8) |

Le chiffre de 32 Go du §3 **n'est donc pas le prix du produit, c'est le prix
d'OTP**. Avec un moteur mémoire-projetée, la France tient sur une machine
ordinaire — disque un peu plus généreux, mémoire cinq à dix fois moindre,
requêtes dix à trente fois plus rapides.

Ce qui restait bloquant était **une seule colonne d'un seul flux**, pas une
architecture. Le §8 l'a levé : « la France sur une petite machine » veut
maintenant dire **la France, Paris compris**, et elle a été construite.

---

## 8. Le refus de l'Île-de-France : la cause, la réparation, et la France entière

Le §7 laissait trois portes ouvertes — « soit l'IDFM publie un GTFS lisible,
soit le défaut remonte à MOTIS, soit la couche de réparation le corrige ». La
bonne était la deuxième, et la troisième coûte cinq lignes.

**Le GTFS de l'IDFM n'a aucun défaut. MOTIS 2.11.2 lit une table dont les clés
ont été libérées.**

### Ce que le journal disait déjà

L'échec est reproductible en **4,9 s** : MOTIS 2.11.2, le GTFS IDFM 80921 tel
que publié (116 719 562 octets), une base OSM minuscule. La dernière étape
annoncée par le suivi de progression n'est pas « Read Stop Times », c'est
**`Load Ticketing`** — l'extension *Google Transit Ticketing*, celle qui porte
les liens d'achat de titres. Rien à voir avec des horaires.

Le même flux servi de deux façons échoue de deux façons — et c'est ça, la
signature :

| Le flux est servi… | MOTIS 2.11.2 |
|---|---|
| en archive `.zip` | `ankerl::unordered_dense::map::at(): key not found` |
| en **répertoire** de fichiers | **SIGSEGV** (code 139), même étape |
| `.zip` ou répertoire, **colonne `ticketing_deep_link_id` retirée d'`agency.txt`** | **import propre** |

Un même défaut logique ne produit pas deux pannes différentes selon le mode de
lecture ; une **mémoire libérée**, si. En archive, le contenu du fichier est un
tampon sur le tas : libéré puis réécrit, la comparaison de clés échoue et la
table dit « pas trouvé ». En répertoire, le fichier est **projeté en mémoire** :
à la libération, la page est démappée, et la même comparaison déréférence une
adresse qui n'existe plus. Le moteur mémoire-projetée du §7 se retourne ici
contre lui-même.

### La ligne, en amont

`nigiri` est le chargeur d'horaires de MOTIS. La version épinglée par MOTIS
2.11.2 (`.pkg` → nigiri `0a08a1c`), dans `src/loader/gtfs/ticketing.cc` :

```cpp
auto map = hash_map<std::string_view, ticketing_link_idx_t>{};   // clés = vues
...
auto const deep_links =
    read_ticketing_deep_links(tt, load(kTicketingDeeplinks).data());  // ← temporaire
for (auto const& [provider_idx, deep_link_id] : agency_ticketing) {
  tt.providers_[provider_idx].ticketing_link_ = deep_links.at(deep_link_id);  // ← lit du libéré
}
```

Les clés de la table sont des `string_view` sur le contenu du fichier. Ce
contenu est un **temporaire détruit au point-virgule**. Le `at()` de la ligne
suivante compare la clé cherchée à des octets qui ne sont plus à personne.

Corrigé en amont le **2026-08-30** par `cf852e90` — *« ticketing parsers: fix
crash (map keys go out of scope) »* — qui passe la table en
`hash_map<std::string, …>`. Les dates comptent : **v2.11.2 est du 12 août, le
correctif du 30**. Aucune version publiée ne le contient ; `master` l'a (motis
épingle nigiri `b27ad6b`, du 31 août). Et **aucun ticket ne décrit la panne** : chercher
« ticketing » dans les deux dépôts ne rend que l'implémentation de l'extension
elle-même. Le correctif est passé sans que personne n'écrive qu'il débloquait
Paris.

### Pourquoi l'IDFM, et pratiquement personne d'autre

Les 53 flux du corpus ont été balayés. **Deux déclarent la colonne, un seul la
remplit** :

- **IDFM** — les deux ressources téléchargeables donnent à **toutes** leurs
  agences la même valeur, `ticketing_deep_link:1` : 62 agences pour l'« Horaires
  au format GTFS » (80921), 60 pour la « GTFS modifié » (80931). Les deux ont
  été réimportées ici, et les deux tombent sur la même phrase. Ce qui explique
  enfin pourquoi le §7 les voyait « échouer identiquement » : ce n'est pas leur
  contenu qui se ressemble, c'est le code qui les lit.
- **TCL Lyon** (81943) déclare la colonne dans `agency.txt` **et** `routes.txt`,
  mais toutes ses valeurs sont vides — et `agency.cc` ignore le vide. Le flux
  passe.

Le seul réseau français que MOTIS 2.11.2 refuse est donc celui qui a implémenté
l'extension Google jusqu'au bout. **Le réseau le plus complet du pays est puni
d'avoir été le plus complet.**

### La réparation : une colonne, cinq lignes, 0,05 s

Ce qu'on jette est nommable : `ticketing_deep_links.txt` de l'IDFM contient
**une ligne**, dont les trois URL sont `https://app.idf-mobilites.fr/gtfs` —
l'application de l'opérateur, la même pour les 62 agences. Ce n'est pas de la
donnée de routage, et le produit n'en affiche rien.

```bash
python3 - <<'EOF'
import csv, io, zipfile
z = zipfile.ZipFile('idfm.zip')
rows = list(csv.DictReader(io.TextIOWrapper(z.open('agency.txt'), 'utf-8-sig')))
cols = [c for c in rows[0] if c != 'ticketing_deep_link_id']
with open('agency.txt', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore')
    w.writeheader(); w.writerows(rows)
EOF
zip -0 -j idfm.zip agency.txt     # 0,05 s : un membre réécrit, pas 1 Go
```

Le remplacement d'un seul membre coûte **0,05 s** sur l'archive de 117 Mo
(1,05 Go décompressés) : la réparation n'ajoute rien au temps de collecte, et le
`.zip` d'origine reste à côté, intact et vérifiable.

### La France entière, Paris compris, sur ce Mac de 16 Go

Corpus reconstruit le 2026-09-08 avec la règle du §1, étendue de ce qu'elle
avait manqué : le Point d'Accès National classe la couverture nationale sous
`pays`, pas `country`, et **le GTFS « Réseau SNCF TGV, Intercités et TER » était
tombé du corpus de septembre**. Sans lui, Bordeaux → Toulouse se route en
**28 heures** par cars interurbains ; avec lui, en 2 h 27. Un corpus se vérifie
par ses itinéraires, pas par son compte de fichiers.

| | |
|---|---|
| Flux | **53** (46 régionaux + 7 nationaux/européens), **1 002 Mo** zippés |
| `stop_times` | **39 602 882** — dont 8 736 153 pour le seul IDFM |
| Rues | `france-latest.osm.pbf`, **5 076 560 568 octets** (le fichier du §3) |
| **Import complet** | **274 s** — horaires 22,7 s · adresses 1 min 47 · rues 2 min 00 · appariement 16 s |
| RSS maximum à l'import | **5,13 Go** |
| Sur disque | **7,7 Go** |
| Chargé | **383 555 arrêts · 1 868 158 courses · 36 760 889 transports × jours**, 53 sources |
| Démarrage du serveur | **10,8 s** à froid, **3,6 s** cache chaud |
| **Résident en service** | **2,63 Go** au démarrage, **1,81 Go** après 300 requêtes |
| Latence, 300 trajets entre 20 gares | **p50 170 ms · p90 346 ms · p99 596 ms**, **300/300** avec itinéraire |

Le résident **baisse** sous la charge : le système reprend les pages projetées
dont personne ne se sert. C'est la propriété que le §7 annonçait, vérifiée cette
fois avec Paris dedans.

Et ce que ça donne, départ mercredi 9 septembre 2026 à 8 h (heure de Paris) :

| Trajet | Résultat | Latence |
|---|---|---|
| **av. de France (13e) → La Défense** | **25 min**, 1 corr. — **M14** jusqu'à Châtelet, **RER A** jusqu'à La Défense | **p50 124 ms** |
| **Melun → La Défense** | **55 min**, 1 corr. — **ligne R** jusqu'à Gare de Lyon, **RER A** | **p50 82 ms** |
| Paris Austerlitz → Lyon Part-Dieu | 119 min, **direct** | 241 ms |
| Bordeaux St-Jean → Toulouse Matabiau | 147 min, **direct** | 154 ms |
| Nice → Lyon Part-Dieu | 273 min, 1 corr. | 103 ms |
| Rennes → Brest | 120 min, direct | 141 ms |
| Lille Flandres → Roubaix | 26 min, 1 corr. — **M2** | 101 ms |

« Melun → La Défense » ne trouvait rien au §7. Il trouve la ligne R et le RER A,
en 82 ms.

### La reconstruction hebdomadaire coûte une minute, pas une nuit

Mesure non prévue, et c'est la plus utile pour l'exploitation. Ajouter les
sept flux nationaux à un jeu de données déjà importé a coûté **59 s** — horaires
31 s, appariement des arrêts aux rues 18 s, extension du géocodage aux arrêts
8 s. Le graphe de rues (`osr`, 2 min) et l'index d'adresses (`adr`, 1 min 47)
n'ont **pas** été refaits : MOTIS les indexe par empreinte de l'OSM, qui n'avait
pas bougé.

Donc, pour les 39 % de flux GTFS republiés dans les 7 jours (§5) : **une minute
de machine par semaine**, pas les 274 s d'un build complet, et pas la nuit
d'OTP. Le build complet ne redevient nécessaire que lorsque l'extrait OSM
change.

### Trois défauts de corpus ramassés au passage

La couche de validation du §5 a maintenant des cas nommés, tous rencontrés sur
ce seul balayage :

- **Un zip de zips.** Le flux Mobigo Jura (84076) publie une archive qui ne
  contient que `20260803.zip` et `20270101.zip`. MOTIS ne charge pas zéro : il
  **refuse l'import entier** — `unable to import: no loader for ... found`,
  code de sortie 1. Un flux départemental fait donc tomber le build national,
  exactement comme le `route_id` vide de Corsica Ferries chez OTP (§5). Il faut
  le déballer, et choisir le millésime : deux sont proposés, 2026 et 2027.
- **Deux sources sans un seul jour de service.** MOTIS les charge, les compte, et
  leur donne `transportsXDays = 0` avec une date de début à **2206** :
  le réseau scolaire de Martinique s'arrête au 10 juillet 2026, les **Chemins de
  fer de la Corse au 9 mars 2026**. Un flux périmé n'est pas une erreur de
  chargement, c'est un trou silencieux dans la carte.
- **Un CSV en largeur fixe.** L'AVE Renfe complète chaque ligne par des espaces
  jusqu'à une largeur constante. MOTIS l'avale ; le balayage naïf qui vérifie
  les calendriers, lui, a lu `20260909␣␣␣…` et conclu « pas de service ». Le
  garde-fou doit être plus tolérant que le moteur, pas moins.

### La décision : un moteur, pas deux

La question posée était : « MOTIS pour la France, autre chose pour Paris ? »
La réponse est non, et le tableau dit pourquoi.

| | **Un moteur** — MOTIS + réparation | **Deux moteurs** — OTP sur l'IDF, MOTIS ailleurs |
|---|---|---|
| Machine | **une**, 16 Go suffisent (1,8–2,6 Go résidents) | celle de MOTIS **plus** celle d'OTP : 3,59 Go de tas vivant pour la seule IDF, JVM à dimensionner |
| Construction | 274 s complet, **59 s** pour un rafraîchissement d'horaires | deux chaînes, deux formats de graphe, deux cadences |
| Trajets à cheval | **routés** : Melun → La Défense, Paris → Lyon, Nice → Lyon | **impossibles** sans recoller deux réponses à la frontière — un Melun → Rouen n'appartient à aucun des deux |
| Flux refusés | aucun, après une colonne | OTP refuse toujours Corsica Ferries (§5) : la réparation reste **obligatoire** de toute façon |
| Surface d'exploitation | une API, un cron, une quarantaine | deux de chaque, et un routeur d'appels par géographie |
| Dette | **datée** : disparaît à la première version MOTIS qui embarque nigiri ≥ `cf852e90` | permanente |

Le deuxième moteur n'achèterait rien qu'on n'ait déjà, et il ferait revenir la
machine à 32 Go pour la seule région où le produit doit être le meilleur.

**Ce qu'il faut poser en exploitation, dans cet ordre :**

1. **Épingler MOTIS 2.11.2** et appliquer la réparation à l'ingestion — pas au
   téléchargement, à l'ingestion, pour que le fichier d'origine reste vérifiable.
2. **Balayer, ne pas supposer** : la réparation cherche la colonne dans
   `agency.txt` et `routes.txt` de **chaque** flux, et journalise ce qu'elle
   touche. Aujourd'hui, ça touche un flux sur 53.
3. **Surveiller la prochaine version de MOTIS.** Dès qu'une release embarque
   nigiri ≥ `cf852e90`, la réparation devient inutile — on la retire, on garde le
   balayage, et on le dit dans le journal.
4. **Ne pas oublier la licence.** Le PAN classe le GTFS IDFM en
   `mobility-licence` — Licence Mobilités, avec obligations de déclaration, et
   non Licence Ouverte. `DATA_SOURCES.md` le note déjà pour la couche
   `idfm-frequency`. Servir des itinéraires parisiens veut dire s'y conformer :
   c'est une démarche, pas un obstacle technique.

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

**Pour le §8**, même journée et même machine : MOTIS 2.11.2 en `import` puis
`server`, résident lu par `ps -o rss=` sur le processus qui répond, latences
mesurées côté client sur l'API `/api/v1/plan` (300 tirages entre 20 gares,
graine fixée). Le code incriminé est lu dans `nigiri` aux deux commits que
MOTIS épingle : `0a08a1c` pour la version 2.11.2 (`.pkg` du dépôt motis à ce
tag) et `b27ad6b` pour `master`. Corpus GTFS et OSM téléchargés à nouveau le
2026-09-08 ; le fichier `france-latest.osm.pbf` a la taille exacte du §1, à
l'octet près. Les trois défauts de corpus ont été vérifiés flux par flux, chacun
importé seul : le zip de zips fait sortir MOTIS en code 1, et les deux flux
périmés s'importent proprement en rendant `transportsXDays = 0`. Les données de
test ont été effacées après mesure.

**Un piège pour qui reproduit.** OTP 2.x reconnaît un GTFS **au nom du fichier**,
pas à son contenu : un `80931.zip` est ignoré, un `gtfs-80931.zip` est lu. Un
premier build francilien a donc tourné dix-neuf minutes, s'est terminé sans
erreur, a écrit un `graph.obj` de 338 Mo — et ce graphe ne contenait aucun
transport en commun. La seule trace était un `❓` devant le nom du fichier dans
le journal, et un `Transit built. |Stops|=0` tout à la fin. Un succès silencieux
qui n'en est pas un : exactement le mode de panne que ce dépôt refuse ailleurs.
