# Le GTFS-RT national — le chiffrage

> `docs/CHRONIQUE.md` laisse une phrase en suspens : *« interroger 151 flux
> GTFS-RT nationalement est une facture réelle […] le stockage d'un an de
> GTFS-RT national demande un chiffrage avant de l'allumer »*. Ceci est ce
> chiffrage. Il ne conclut pas « c'est cher » ou « c'est donné » : il donne le
> prix de chaque forme de rétention, parce que le prix varie d'un facteur 50
> entre elles, et que le choix se fait là.

Tout ce qui suit a été mesuré contre les 147 ressources distinctes de
`config/pan_gtfs_rt_feeds.json`, à **deux heures** : le **2026-09-07 de 22 h 09
à 22 h 27** (flotte de soirée, 1 259 véhicules) et le **2026-09-08 à 09 h 14**
(flotte du matin, 4 799 véhicules), plus les horaires statiques de quatre
réseaux. Deux heures et pas une seule : extrapoler depuis l'heure la plus vide
surestimait la facture réseau de 40 %, et c'est la seconde mesure qui l'a
montré — voir plus bas.

```bash
npm run chronicle:gtfs-rt-cost -- --companions --rounds 12 --interval 30 --out soir.json
npm run chronicle:gtfs-rt-cost -- --companions --rounds 0 --out matin.json
npm run chronicle:gtfs-rt-cost -- --budget matin.json --against soir.json   # sans réseau
npm run chronicle:service-day  -- --date 20260907
```

## L'unité de compte n'est pas l'heure du sondage, c'est la journée de service

Une sonde ne mesure jamais que l'heure où elle tourne, et le transport n'a pas
d'heure moyenne : à 22 h la France en service pèse un cinquième de ce qu'elle
pèse à 17 h. Multiplier un balayage nocturne par 1 440 donnerait un chiffrage
faux de 80 %, et un balayage de pointe un chiffrage faux dans l'autre sens.

La forme de la journée vient donc de l'endroit qui la connaît déjà : les
horaires publiés. Pour le lundi 2026-09-07, `measure-gtfs-service-day.mjs`
compte les courses en service heure par heure dans quatre archives statiques —
une métropole, deux réseaux moyens, une ligne de village :

| Réseau | Courses | Passages d'arrêt / jour | En service à 17 h | Véh·h par véhicule de 17 h | Passages par véhicule de 17 h |
|---|---|---|---|---|---|
| TBM (Bordeaux) | 7 153 | 268 054 | 530 | 12,43 | 505,8 |
| STAR (Rennes) | 6 191 | 132 285 | 389 | 9,00 | 340,1 |
| Irigo (Angers) | 2 511 | 82 039 | 205 | 9,08 | 400,2 |
| SITRAVEL | 38 | 1 120 | 5 | 7,60 | 224,0 |
| **pondéré par la flotte de 17 h** | | | 1 129 | **10,62** | **428,3** |

L'autre bout de la multiplication est mesuré, pas supposé : l'index national
refait le même jour (branche `transit-index-redate-2026-09`, PR #94 — pas celui
de `main`, qui date du 2026-08-31 et a sondé un soir de vacances) a interrogé les
147 flux le **2026-09-07 à 17 h 18** et a compté **7 212 véhicules** et 17 200
courses actives. D'où les deux nombres dont tout le reste découle :

- **76 591 véhicule-heures par jour** sur le périmètre du PAN ;
- **3,09 millions de passages d'arrêt par jour**.

**Contrôle.** La courbe des horaires prédit ~1 550 véhicules à 22 h ; la sonde
en a compté 1 259. L'horaire est donc optimiste d'environ 20 % en fin de
service — des courses programmées que plus aucun véhicule ne remonte. Le
chiffrage hérite de ce biais **dans le sens prudent** : il surestime.

## Ce que pèse un balayage national

Deux balayages des positions, à deux heures :

| Balayage | Flux qui répondent | Véhicules | Brut | Compressé |
|---|---|---|---|---|
| 2026-09-07, 22 h 09 | 142 / 147 | 1 259 | 720 Ko | 230 Ko |
| 2026-09-08, 09 h 14 | 145 / 147 | 4 799 | 1 426 Ko | 434 Ko |

**Quatre fois plus de véhicules pour moins du double d'octets.** C'est le fait
central du chiffrage, et une seule mesure ne pouvait pas le donner. La droite
qui passe par les deux points :

> **un balayage national pèse 157 Ko compressés, plus 59 o par véhicule en
> service.**

Le coût unitaire de chaque objet, lui, se lit par régression à l'intérieur d'un
balayage :

| Poste | Coût unitaire (gz) | Part du balayage de 22 h |
|---|---|---|
| Corps vide (en-tête protobuf seul) | 35 o — 15 o en clair | 5 Ko |
| Une position de véhicule | 36,7 o | 46 Ko |
| Une mise à jour d'arrêt reçue **sans l'avoir demandée** | 9,5 o | 150 Ko |
| Une alerte | 812 o | 35 Ko |

Ce modèle par objet prédit le balayage du matin à **3 % près** sans y avoir été
ajusté. Deux surprises y sont dedans.

**Une bonne moitié du balayage de positions n'est pas des positions.** 63 des
147 flux publient positions, courses et alertes dans un seul corps : le serveur
télécharge 15 806 mises à jour d'arrêt par balayage le soir, 22 985 le matin,
sans les avoir demandées. C'est une aubaine pour la ponctualité — elles sont
déjà payées — et **c'est là qu'était l'erreur du chiffrage à une seule mesure** :
ces mises à jour ne suivent presque pas la flotte (+45 % quand la flotte fait
×3,8). Les facturer au véhicule, à partir de l'heure où il y a le moins de
véhicules, revient à multiplier un plancher par une flotte : c'est le piège
propre à la mesure nocturne, et un balayage de pointe seul s'en serait à peine
approché.

**Une alerte coûte 22 fois une position.** C'est du texte écrit par un humain,
souvent en plusieurs langues, et son volume ne bouge pas avec l'heure : 43
alertes le soir, 42 le matin. Avec les mises à jour de course qui voyagent dans
les mêmes corps, c'est ce qui compose le plancher de 157 Ko.

## Ce qu'on achète en interrogeant plus vite

Trois passes de cadence, chacune comptant les véhicules dont l'horodatage ou la
position a changé depuis le tour précédent :

| Cadence | Corps qui changent | Véhicules porteurs d'une observation neuve | Observations distinctes par véhicule-heure |
|---|---|---|---|
| 10 s (25 plus gros flux) | 15 sur 25 | 25,6 % | **92** |
| 30 s (national) | 129 sur 142 | 55,4 % | **66** |
| 60 s (national) | 138 sur 142 | 64,8 % | **39** |

Lu autrement, sur les 25 plus gros flux : **un véhicule émet une position
toutes les ~39 s**.
Sonder à 30 s en récolte 72 %, sonder à 60 s en récolte 42 %, et sonder à 10 s
en paye trois fois le prix pour 40 % de plus. L'horodatage d'en-tête dit la même
chose du côté éditeur : sur les 25 plus gros flux, l'écart médian entre deux
republications est de **20 s** (p25 11 s, p75 40 s, max 61 s).

**La déduplication est gratuite et elle est grosse.** Écrire seulement les
véhicules dont l'observation est neuve ne perd rien — c'est la même mesure
répétée — et retire 45 % des lignes à 30 s, 35 % à 60 s.

## Quatre formes de rétention, et leur année

Le tableau que `--budget … --against …` recalcule à partir des deux balayages.
« Entrant » est ce qui traverse le réseau du VPS, en-têtes HTTP compris (~700 o
par requête, estimés et non mesurés) ; les colonnes de droite sont ce qui reste
sur le disque. La dernière applique les taux de doublons mesurés au tour à tour
— 55,4 % de positions neuves à 30 s, 64,8 % à 60 s.

| Cadence | Requêtes/j | Entrant/j | Entrant/an | Corps entiers gardés | Positions projetées | Positions dédupliquées |
|---|---|---|---|---|---|---|
| 30 s | 417 600 | 1,24 Go | 442 Go | 342 Go/an | 76,3 Go/an | **42,3 Go/an** |
| 60 s | 208 800 | 619 Mo | 221 Go | 171 Go/an | 38,1 Go/an | **24,7 Go/an** |
| 120 s | 104 400 | 310 Mo | 110 Go | 86 Go/an | 19,1 Go/an | · |
| 300 s | 41 760 | 124 Mo | 44 Go | 34 Go/an | 7,6 Go/an | · |

Une position projetée dans la forme du journal de la chronique — flux, véhicule,
course, ligne, horodatage, lat/lon à 5 décimales, cap, vitesse — pèse **148,9 o
en clair et 24,6 o compressée**, soit **un tiers de moins que la même position
en protobuf**. Garder les corps entiers coûte donc plus cher que garder ce
qu'on en tire, et rapporte des champs que rien ne lit : odomètre, libellé
commercial, taux d'occupation.

**Le cinquième objet, celui qui vaut le produit, ne dépend pas de la cadence.**
Un passage d'arrêt réalisé — flux, course, ligne, arrêt, rang, retard, heure —
pèse ~104 o en clair et **9,5 o compressé** dans le lot du matin, 10,8 o dans
celui, plus petit, du soir. À 3,09 millions de passages par jour, c'est **28 à
32 Mo par jour, 10 à 11,3 Go par an**, et ce chiffre est le même qu'on sonde
toutes les 30 s ou toutes les 5 minutes : un bus ne passe qu'une fois.

Enfin les **semaines types** ne coûtent rien : 441 séries de flux font 2,4 Mo,
et une ponctualité plus une vitesse pour chacune des **6 895 lignes** françaises
font **70 Mo pour toujours**. C'est la seule couche qui ne grossit pas avec le
temps.

## Le piège de facture : les mises à jour de course

Pour obtenir les passages d'arrêt par la voie officielle, il faut interroger les
82 ressources TripUpdates qui répondent sur 85. Mesurées aux deux heures :
**537 Ko compressés pour 1 936 courses** le soir, **2 410 Ko pour 11 420
courses** le matin — soit un plancher de 155 Ko et **202 o par course**, trois
fois et demie le prix d'un véhicule.

| Cadence des compagnons | Requêtes/j | Entrant/j | Entrant/an |
|---|---|---|---|
| 30 s | 236 160 | 4,82 Go | **1 718 Go** |
| 60 s | 118 080 | 2,41 Go | **859 Go** |
| 300 s | 23 616 | 482 Mo | **172 Go** |

Et l'essentiel de ces octets est une **re-prédiction** : le même « 4 min de
retard » réécrit toutes les 20 s pour tous les arrêts restants de la course.
22,4 mises à jour d'arrêt par course, republiées à chaque sondage, pour un seul
passage qui finira par être vrai.

**Il y a une porte de sortie, et elle est mesurée deux fois : 4 220 des 4 799
positions du matin nomment déjà l'arrêt où le véhicule se trouve** (`stopId` ou
`stopSequence`) — 88 %, contre 82 % le soir — et **86 des 124 flux qui avaient
des véhicules le font pour chacun d'eux**. Un
passage d'arrêt se déduit donc d'une transition de `stopSequence` dans le flux
de positions, que l'on télécharge déjà. Les compagnons ne sont nécessaires que
pour le reste — et à 300 s, pas à 30 s.

## Ce que la boîte peut porter

Le seul déploiement à volume persistant est le staging ([`docs/DEPLOY.md`](DEPLOY.md)) :
un **Hostinger KVM 2 à Paris — 2 vCPU, 8 Go de RAM, 96 Go de disque**, et il
n'est pas dédié. Il porte aussi la production Enerlens (Postgres, Redis, Caddy,
Next.js), gbrain, hermes et clawvisor.

| Constat, 2026-09-07 | Valeur |
|---|---|
| Disque libre | **21 Go** sur 96 (79 % utilisés) |
| Volume `gev_gev-cache` aujourd'hui | 196 Mo |
| Cache de build Docker récupérable | 12,8 Go |
| Bande passante du plan | 8 To/mois — 52 Go/mois d'entrant à 30 s, soit 0,6 % |
| CPU de décodage | **16 ms par balayage national** (3 passes × 142 corps) |

Le CPU et la bande passante ne sont pas des contraintes. **Le disque en est
une, et c'est la marge de la production qu'on entamerait.**

## Ce que je recommande d'allumer, et ce que ça coûte

| Couche | Cadence | Rétention | Empreinte en régime |
|---|---|---|---|
| Positions nationales, dédupliquées | 30 s | 30 jours de brut | **3,5 Go** |
| Passages d'arrêt, déduits des positions | — | 12 mois glissants | **11 Go** |
| Semaines types par flux et par ligne | — | pour toujours | **70 Mo** |
| Compagnons TripUpdates, flux sans arrêt dans les positions | 300 s | rien de brut | ~0 |
| **Total année 1** | | | **≈ 15 Go** |

Quinze gigaoctets tiennent dans les 21 libres, mais mangent les trois quarts de
la marge d'une machine qui héberge une production. Deux façons de rendre la
marge, dans l'ordre de préférence :

1. `docker builder prune` rend **12,8 Go** sans rien détruire d'irremplaçable.
   (Ne jamais toucher au volume `gev_gev-cache` : il porte la chronique.)
2. Passer le VPS de KVM 2 à KVM 4 — 100 → 200 Go de disque — pour **8,99 →
   14,99 $/mois** au tarif courant ([Hostinger VPS pricing
   2026](https://smarthostfinder.com/hostinger-vps-pricing/)).

L'année 2 n'ajoute rien : les passages roulent sur douze mois et les semaines
types ne grossissent pas.

**Ce que je déconseille, avec son prix.** Archiver les corps entiers sur le VPS
(342 Go/an à 30 s) est exclu — c'est seize fois l'espace libre. Sur du stockage
objet, en revanche, ce n'est pas l'espace qui coûte : chez Cloudflare R2, à
0,015 $/Go·mois avec l'égress gratuit, 342 Go accumulés sur un an reviennent à
**environ 31 $ pour l'année**. Ce sont les **écritures** qui piègent : un objet
par corps et par sondage fait 12,7 millions de PUT par mois, soit **57 $/mois**
à 4,50 $ le million ([R2 pricing](https://developers.cloudflare.com/r2/pricing)).
Le même contenu écrit **en lots horaires** (147 objets par heure) coûte
**0,48 $/mois**. Si l'assurance « on n'a pas encore choisi le bon axe » vaut
30 $ l'année, elle vaut ce prix-là — pas l'autre.

## Ce que le chiffrage a appris au passage

**Le contrôle du matin a validé la journée et cassé le modèle d'octets.** La
courbe des horaires prédisait 4 657 véhicules à 09 h ; le balayage en a compté
**4 799**, soit **+3 %** — la journée de service tirée des horaires tient, et
avec elle tous les volumes stockés. Le même balayage a en revanche pesé 434 Ko
là où le modèle bâti sur la seule soirée en prédisait 767 : **+77 % sur le
balayage, +40 % sur l'année**. C'est pour ça que le tableau se
lit maintenant sur deux points, et pourquoi une troisième mesure, un jour de
pointe à 17 h, reste la bienvenue.

**Un flux qui dort ressemble exactement à un flux mort.** Cinq des 147
ressources ont échoué le soir, **deux seulement le matin** — les trois URL du
proxy PAN qui rendaient un 404 à 22 h répondaient de nouveau à 09 h, ce qui
confirme le diagnostic. Restent deux vraies pannes : Tempobus, disparu de
l'index refait le 2026-09-07, et Rémi (Centre-Val de Loire), qui a **changé
d'identifiant de ressource en sept jours**. Deux conséquences : l'index doit être reconstruit chaque semaine,
sans quoi l'enregistrement perd des réseaux en silence — et le garde-fou déjà
présent dans `recordTransitChronicle` (« un flux en erreur n'a rien publié ;
enregistrer un zéro apprendrait au profil que ce réseau ne fait rouler aucun
bus à cette heure-là ») n'est pas théorique : il s'est déclenché cinq fois en
une demi-heure de mesure.

**Le plafond de séries de la chronique ne passe pas à l'échelle nationale.**
`CHRONICLE_MAX_SERIES` vaut 250 ; 147 flux × 3 séries en demandent 441. Le
plafond existe parce que le fichier de profil est réécrit en entier à chaque
vidage — il faudra donc soit un fichier par source et par tranche, soit un
plafond relevé assumé (441 séries pleines = 2,4 Mo réécrits par vidage).

**La nuit coûte le plancher, et l'éteindre rapporterait peu.** Avec les
en-têtes, **259 Ko par balayage sont dus quelle que soit la flotte** — 157 Ko de
corps que l'heure ne déplace pas, 102 Ko d'en-têtes HTTP —, soit 60 % de la
facture quotidienne à 30 s. Éteindre l'enregistrement de 1 h à 5 h
économiserait donc **environ 10 % de l'entrant**, et ferait perdre exactement ce
qui n'a aucune archive ailleurs : les premiers départs, les bus de nuit, et la
preuve qu'un réseau ne roulait pas. Ce qui vaut vraiment la peine d'être coupé
n'est pas une plage horaire, c'est une source : les compagnons TripUpdates
coûtent quatre fois les positions et disent quatre fois la même chose.

## Ce que ce chiffrage ne dit pas

- **Il mesure deux heures, pas vingt-quatre.** Une soirée et un matin ; le
  reste de la journée vient des horaires publiés, que le matin a confirmés à
  3 % près. La vraie courbe, celle des flux et pas des horaires, arrivera toute
  seule : c'est le profil que la chronique construit en tournant.
- **Il ne couvre pas l'Île-de-France, et aucun budget n'y changerait rien.**
  IDFM ne publie **aucune position de véhicule en GTFS-RT** (`DATA_SOURCES.md`,
  et `transitCoverage.js` a mesuré 0 véhicule dans Paris intra-muros contre 453
  à Bordeaux). Les 7 212 véhicules sont donc la France **sans** son premier
  réseau — ce qui ne se rattrape pas en sondant plus vite.
- **Il ne tranche pas la licence.** 46 des 150 flux sont en ODbL 1.0 et 104 en
  Licence Ouverte : la section « ligne de licence » de `docs/CHRONIQUE.md`
  reste la règle, et un export devra lire la licence flux par flux.
