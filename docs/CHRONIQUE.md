# La chronique — enregistrer ce qui n'a pas d'archive

> Tout le reste du serveur est un cache : il existe pour que la requête
> suivante soit bon marché, et il a le droit d'oublier. Ceci est l'inverse.

## Pourquoi

Presque tout ce que ce fork dessine sur la France est déjà une archive.
Filosofi publie une année, DVF une décennie, les comptages parisiens treize
mois glissants — et c'est parce que quelqu'un a gardé 27,7 millions de lignes
que `comptagesRhythm.js` peut affirmer que **83,9 % des arcs comptés déplacent
leur heure de pointe le week-end**.

Cinq des flux que ce serveur lit déjà ne gardent rien :

| Flux | Ce qu'il publie | Ce qu'il en reste |
|---|---|---|
| GTFS-RT (151 réseaux, PAN) | La position d'un bus maintenant | Écrasée toutes les ~30 s |
| QualiCharge dynamique | 75 427 points de charge, libres ou occupés | Remplacé à chaque publication |
| Bison Futé DATEX II | La couleur et le débit d'une section | Le répertoire ne garde que le fichier courant |
| AISStream, boîte France | Les navires entendus | Un socket ne se rejoue pas |
| Vigicrues | Le niveau de vigilance de chaque tronçon | Republié par-dessus, deux fois par jour |

Aucun d'eux n'a d'historique public, et personne ne le vend pour la France.
Chaque heure où ce serveur tourne sans enregistrer est une heure qu'on ne
rachètera pas. Chaque heure où il enregistre est une heure que personne d'autre
n'a.

C'est la recette de Flightradar24 et de MarineTraffic : signal public,
accumulation privée. Les entrées restent publiques et re-téléchargeables ; ce
qui devient propriétaire, c'est **le temps accumulé** — pas la donnée.

## Ce qui est gardé, et pour combien de temps

**La semaine type — pour toujours, minuscule.** Chaque série est repliée dans
168 créneaux heure-de-la-semaine (lundi 00 h → dimanche 23 h, heure de Paris),
chacun portant un effectif, une moyenne et une variance courants (Welford). Un
créneau, c'est cinq nombres : une série dont les 168 créneaux sont remplis pèse
**5 341 octets**, qu'un an ou dix l'aient alimentée. Le fichier ne grossit pas
avec le temps, seulement avec le nombre de séries — 250 séries pleines font
1,31 Mo, et la plus large source aujourd'hui en compte 99.

**Les ticks bruts — trente jours, un fichier NDJSON par jour local.** C'est
l'issue de secours, et c'est pourquoi la rétention est d'un mois et pas d'une
semaine : **un repli est irréversible**. Un axe auquel personne n'a pensé le
premier jour est perdu à jamais, sauf si les ticks sont encore là pour le
reconstruire. Trente jours, c'est quatre semaines complètes — de quoi rebâtir un
premier profil sur un axe neuf.

Un jour terminé est compressé sur place (`.ndjson` → `.ndjson.gz`). Mesuré sur
une journée synthétique du journal QualiCharge (96 ticks × 5 000 bornes qui
changent d'état) : **30,2 Mo en clair, 4,2 Mo compressés, un rapport de 7,3** —
soit la différence entre 900 Mo et 125 Mo de mois retenu sur un petit VPS.

## L'horloge est celle de Paris, et ce n'est pas un détail

Parce que tous les rythmes enregistrés ici sont **humains**. La pointe du soir
est à 18 h locales en février comme en juillet ; en UTC elle se déplace d'une
heure deux fois par an, ce qui étalerait deux mois de chaque profil sur deux
créneaux et aplatirait précisément la pointe que le profil sert à trouver.

Le découpage des fichiers bruts suit la même date locale, donc « le fichier de
mardi » et « les créneaux de mardi » parlent du même mardi. Et l'ordinal de
semaine — celui qui permet à un créneau de dire « vu sur 6 semaines distinctes »
plutôt que le bien plus faible « vu 312 fois » — est dérivé de la même date
calendaire locale, jamais d'une division de l'epoch : les deux changements
d'heure annuels le traversent exactement.

## Un créneau compte des SEMAINES, pas des échantillons

Une source interrogée toutes les cinq minutes met 12 échantillons dans un
créneau en une seule semaine. Une source interrogée seulement quand un opérateur
regarde cette région en met un, ou zéro. Juger « cette heure est-elle normale »
sur le seul effectif laisserait un mardi chargé certifier le créneau mardi 08 h
pour toujours, sur une semaine de preuve.

Chaque créneau porte donc `w`, le nombre de semaines **distinctes** qui l'ont
alimenté, et la lecture **refuse de noter** une valeur tant que ce nombre n'a pas
atteint trois. Avant cela, la réponse honnête est « pas encore assez
d'historique », et c'est celle qui est donnée.

## Vigicrues ne déclare aucune semaine type

Une semaine type n'a de sens que pour un phénomène périodique. Le trafic, la
ponctualité, l'occupation des bornes et la présence des navires le sont
fortement. **Une crue, non** : un niveau de vigilance répond à la pluie, pas à
mardi. Replier ça en créneaux horaires fabriquerait une saisonnalité qui
n'existe pas, puis noterait de vrais épisodes contre elle.

Vigicrues déclare donc `profile: false` : seuls les ticks bruts sont gardés, et
`/api/chronicle-fr/anomalies?source=vigicrues` **refuse** en donnant la raison,
au lieu de renvoyer une liste vide qui se lirait « rien d'anormal sur les
rivières ce soir ». Ce qui vaut ici, c'est la chronologie : quel tronçon est
passé orange, quand, et pour combien de temps.

## Le biais qu'il faut mesurer, pas cacher

Trois des quatre sources passives ne sont enregistrées **que quand quelqu'un
regarde** : le proxy transport interroge par viewport, les proxys route et
Vigicrues se rafraîchissent à la demande. La couverture d'un profil est donc une
carte de là où les opérateurs de ce serveur ont pointé la caméra, pas de la
France.

Ce n'est pas réparable en le souhaitant — interroger 151 flux GTFS-RT
nationalement est une facture réelle, et le transcript qui a ouvert ce chantier
le disait : *« le stockage d'un an de GTFS-RT national demande un chiffrage
avant de l'allumer »*. Alors c'est **mesuré** : chaque créneau porte son nombre
de semaines, `/profile` le renvoie, et un profil maigre se lit comme maigre
plutôt que comme un réseau calme.

Corollaire assumé sur le transit : la série de flotte est `feed.reported` — le
nombre de véhicules que le **réseau** a publiés — et jamais `feed.inView`, qui
est le nombre tombé dans le rectangle du demandeur. Sinon une même série
signifierait « les véhicules que TBM fait rouler » quand une caméra est sur
Bordeaux, et « ceux qui roulent dans une boîte de 0,3° près de Lyon » dix
minutes plus tard.

## Les axes, source par source

Le choix d'axe est **permanent** au-delà de la fenêtre de trente jours. Les cinq
replis vivent donc ensemble dans `vite.config.js`, sous un même titre, pour être
relus d'un seul regard.

| Source | Cadence | Séries repliées | Journal brut |
|---|---|---|---|
| `transit-fr` | 5 min / série | `feed:<id>/vehicles`, `/onTimePct`, `/spoken` | les ticks eux-mêmes |
| `irve-fr` | 15 min | `fr/*` national, `op:<code>/occupePct` (94 opérateurs, 85 au-dessus du plancher de 20 bornes) | **chaque transition d'état de chaque borne** |
| `road-status-fr` | 6 min | `fr/*` national, `axis:<A7>/congestedPct` et `/speedKph` (99 axes mesurés) | chaque changement de couleur de section |
| `ais-fr` | 5 min | `fr/vessels`, `/moving`, `/knownType`, `/meanSog`, `cell:<lat>,<lon>/vessels` (carrés de 1°) | les ticks eux-mêmes |
| `vigicrues` | 30 min | *aucune* | chaque changement de niveau de tronçon |

Deux axes ont été écartés et méritent d'être écrits :

- **Le segment routier** plutôt que l'axe. 830 sections dessinées × 2 séries =
  1 660, contre un plafond de 250. La question qui vaut — « l'A7 est-elle plus
  lente qu'un samedi 11 h habituel » — est une question d'axe. Le niveau segment
  n'est pas perdu : il est dans le journal d'événements, pendant trente jours.
- **Le département pour l'IRVE.** Il faudrait joindre le fichier statique
  QualiCharge (41,8 Mo, 78 405 lignes, `code_insee_commune` présent) une fois par
  semaine. Ce n'est pas cher, mais ce n'est pas fait ici — et comme le journal
  brut est par borne, l'axe départemental reste **reconstructible** sur les
  trente derniers jours le jour où quelqu'un le décide. C'est exactement à ça
  que sert le brut.

## Ce que coûte l'enregistrement

Rien en amont, pour quatre sources sur cinq : `recordChronicle` est appelé avec
une charge que le proxy avait déjà téléchargée et projetée.

La cinquième, le sondeur QualiCharge, est un **nouvel** appel : 1,17 Mo
compressé toutes les 15 minutes, soit ~112 Mo par jour contre le proxy de
transport.data.gouv.fr. C'est pour cette raison — et uniquement celle-là —
qu'elle est **opt-in** (`CHRONICLE_IRVE_DYNAMIC=1`), armée dans
`deploy/vps/docker-compose.yml` parce que c'est le déploiement qui a un volume
persistant, et donc le seul où l'accumulation vaut quelque chose.

Le premier sondage après un démarrage journalise l'état hérité des 75 427 bornes
(~2,9 Mo). C'est voulu : après une coupure on ne sait pas ce qui a changé, donc
la ligne de base est réécrite plutôt que devinée.

## Les routes

```
GET /api/chronicle-fr/status                     les cinq sources, leur licence,
                                                 leur cadence, ce qu'elles tiennent
GET /api/chronicle-fr/series?source=             les séries connues, par poids
GET /api/chronicle-fr/profile?source=&series=    une semaine type, 168 créneaux
GET /api/chronicle-fr/anomalies?source=&limit=   la dernière valeur de chaque
                                                 série, notée contre son créneau
```

Lecture seule par construction : aucune route n'écrit. L'enregistrement se fait
à l'intérieur des proxys qui téléchargent déjà.

`/anomalies` distingue **trois** silences, parce qu'ils ne veulent pas dire la
même chose : `observed: 0` (rien n'a été vu depuis le démarrage du processus),
`unjudged` (tout ce qui a été vu est tombé dans un créneau trop jeune), et
`judged > 0` sans bande au-dessus de `typical` (tout était ordinaire).

Une valeur est **notée avant d'être repliée**. « Est-ce normal ? » veut dire
« au regard de ce qu'on savait avant que ça arrive » ; noter après met la valeur
à l'intérieur de sa propre espérance et tire toute lecture vers `typical`. Sur un
créneau jeune ce n'est pas un arrondi : mesuré sur cinq échantillons, une valeur
400 au-dessus de la moyenne des quatre autres notait 1,8 σ au lieu des dizaines
qu'elle valait vraiment.

## La ligne de licence

Quatre des cinq sont en Licence Ouverte 2.0, qui autorise un dérivé
propriétaire contre la seule attribution. La cinquième, AISStream, rediffuse une
émission radio publique sans conditions formelles.

**GTFS-RT est celle qu'il faut lire flux par flux.** Le catalogue du PAN déclare
Licence Ouverte 2.0 sur la plupart des flux temps réel français et **ODbL 1.0
sur une minorité substantielle** — et le partage à l'identique de l'ODbL atteint
toute **base dérivée** exposée publiquement, pas seulement la carte qu'on en
tire. La licence déclarée voyage donc avec chaque source dans
`chronicleSources.js`, et `/status` la renvoie sur chaque ligne : un profil bâti
sur un flux ODbL reste en partage à l'identique quoi qu'on empile dessus.
C'est ce qu'un futur chemin d'export doit consulter ; ce n'est pas de la
décoration.

## Où c'est écrit

| Fichier | Ce qu'il porte |
|---|---|
| `src/data/chronicle.js` | L'horloge, le repli 168 créneaux, la lecture d'anomalie, l'arithmétique de rétention. Pur, testé hors ligne. |
| `src/data/chronicleSources.js` | Les cinq sources déclarées : licence, attribution, cadence, axes, et pourquoi personne ne garde leur passé. |
| `src/data/qualichargeDynamic.js` | La seule nouvelle source amont, et les trois pièges mesurés de son fichier. |
| `vite.config.js` | Les fichiers, la temporisation, le renommage atomique, le balayage de rétention, et les cinq replis. |
| `scripts/qa-chronicle.mjs` | `npm run qa:chronicle -- --url http://localhost:5173` |

## Le piège qui vaut le détour : un tiers du fichier IRVE ne parle pas de maintenant

`horodatage` dit quand l'opérateur a parlé de cette borne pour la dernière fois,
pas quand le fichier a été bâti — et il remonte à des années. Mesuré le
2026-09-07 à 16:37 UTC sur les 75 427 lignes :

| Fraîcheur | Lignes | Part |
|---|---|---|
| < 1 h | 17 786 | 23,6 % |
| < 6 h | 40 915 | 54,2 % |
| < 24 h | 51 230 | 67,9 % |
| < 7 j | 62 796 | 83,3 % |
| < 30 j | 67 737 | 89,8 % |
| la plus vieille | | **862 jours** |

Et les lignes périmées ne sont pas périmées-et-muettes, elles sont
périmées-et-**affirmatives** : sur les 24 197 hors des 24 heures, **18 052 disent
encore `libre`** et 858 seulement `occupe`. Lire le fichier tel quel donne
58 742 bornes libres ; ne compter que ce qui a été réaffirmé dans la journée en
donne 40 690. **Une lecture naïve gonfle la capacité de recharge libre de la
France de 44,4 %**, et toujours dans le même sens — un opérateur qui se tait se
tait pendant que ses bornes sont au repos.
