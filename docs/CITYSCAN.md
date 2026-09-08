# Cityscan, démonté — et ce que notre fork peut en reprendre

*Reniflage et triage du 8 septembre 2026. Tout ce qui suit est daté : Cityscan
est en train de disparaître dans un autre produit, et la moitié des constats
ci-dessous a une date de péremption.*

---

## 0. Le fait qui change la question

**Cityscan n'existe déjà plus comme produit autonome.** Le service est passé
sous Septeo (3ᵉ éditeur immobilier français, 30 000 professionnels, 15 000
agences) et se replie sur **Modelo Insight**. Le centre d'aide s'intitule
littéralement « Aide en ligne Modelo Insight » ; l'application `app.cityscan.fr`
sert désormais un builder de documents d'estimation, pas la « radiographie
d'adresse » qui a fait sa réputation.

Conséquence directe sur la commande : **il y a deux Cityscan à copier, et ils ne
coûtent pas le même prix.**

| | Le Cityscan *scoring* | Le Cityscan *2026* (Modelo Insight) |
|---|---|---|
| Ce que c'est | 120 indicateurs, 10 thématiques, note /100 et lettre A→E, rayon 5 km autour d'une adresse | Avis de valeur marché / locatif, comparables, rapport PDF de marque, captation de leads |
| Notre position | **Nous avons déjà la quasi-totalité de la matière première** | Nous n'avons rien, et une partie n'est pas récupérable |
| Palier | 1 (composition) | 2 et 3 |

Le premier est un problème de **composition** — les données sont chez nous, il
manque la forme. Le second est un problème de **produit et de distribution**.

> Note de cohérence : une analyse antérieure du dépôt recommandait de *ne pas*
> concurrencer Cityscan sur le scoring d'adresse. Cette recommandation est
> levée par décision du 2026-09-08. Elle reste vraie sur un point, conservé
> ci-dessous en palier 3 : la distribution, pas la donnée.

---

## 1. Ce que le reniflage a montré

### Architecture

- `app.cityscan.fr` — SPA **Vue 3**, build Vite, servie depuis **S3 + CloudFront**
  (PoP `CDG52`). 1 bundle d'entrée de 2,7 Mo + **302 chunks** paresseux (3,3 Mo).
  Sentry 28.0.6.
- `api.cityscan.fr` — backend **Symfony** (les messages d'erreur le trahissent :
  `No route found for "GET …": Method Not Allowed (Allow: POST)`), auth **JWT +
  refresh token**, tuiles protégées par en-tête `Authorization`.
- **Fond de carte : AWS Location Service** (`maps.geo.eu-central-1.amazonaws.com`,
  style `Bright`), en **MapLibre GL 2D**. Pas d'IGN, pas de 3D, pas de LiDAR.
  C'est notre écart le plus visible et il joue en notre faveur.
- Intégrations tierces repérées : Stripe (abonnement + facturation),
  Brevo, immodvisor et « opinion-system » (avis clients), Ideta (chatbot),
  signature électronique, et un module **IA** (`/app/ai/chat`, `/app/ai/char-limits`).

### La surface de données (relevée dans les bundles)

| Route | Ce qu'elle sert | Notre équivalent |
|---|---|---|
| `POST /app/data/insights/address` | le scan d'adresse | `/api/geocode` + `implantation-fr` |
| `/app/data/insights/address/permits/{nearby,search}` | permis, **rayon 500 m** | `/api/sitadel-fr` + `/api/ads-fr` |
| `/app/data/insights/diagnostics` | DPE | `/api/dpe` |
| `/app/data/insights/risks` | risques | `/api/georisques` |
| `/app/data/insights/transactions/resale` | mutations DVF | `/api/dvf` |
| `/app/data/insights/urbanism` | PLU / zonage | `/api/gpu` |
| `/app/data/insee/stats` | socio-démo | `/api/filosofi` (partiel) |
| `/app/data/market/{id}` | prix de marché | — |
| `/app/data/poi/{themes,details/{uid},tiles/{z}/{x}/{y}}` | POI vectoriels | `/api/amenities-fr` (partiel) |
| `/app/maps/itinerary` | itinéraires | `/api/isochrone`, `/api/route` |
| `/app/geocoder/{search,city}` | géocodage | `/api/geocode` |

**Il n'y a pas une seule source de données dans cette liste que nous n'ayons pas
déjà, ou qui ne soit pas publique.**

### La taxonomie POI, en clair

Un chunk non minifié (`CT2Gf7GDrHjQNXQaM8v0J.js`) livre l'arbre complet :
**5 familles × 6 thèmes = 30 types**.

| Famille | Thèmes |
|---|---|
| `businesses` | frozen_food_store, tabac, fresh_products, supermarket, grocery, bakery |
| `education` | nursery, kinder_garten, primary_school, secondary_school, high_school, university |
| `transport` | airport, port, bus, metro, tram_stop, train_station |
| `hobbies` | restaurant, bar, garden, gym, cinema, cultural_places |
| `service` | pharmacy, post_office, gas_station, general_practitioner, hospital, bank |

Notre couche **Équipements du quotidien** ne tire que **10 codes BPE sur 235**,
en 7 familles. Passer de 10 à ~40 codes couvre 25 des 30 types Cityscan sans une
ligne d'architecture nouvelle. Le fichier note déjà le coût mesuré de l'extension
(« épicerie et boulangerie : 80 226 lignes de plus »).

### Le point le plus utile de tout le reniflage

`GET /app/common/translations` est **public** (517 clés, 39 ko). Il nomme chaque
module du rapport et, surtout, **il cite les sources que Cityscan revendique** :

- `Source : Observatoires immobiliers, Base DVF et Statistiques sociodémographiques (INSEE)`
- `Source : Sélection de votre conseiller(ère) parmi les portails d'annonces`
- `Sources : Sélection de votre conseiller(ère) par la base DVF`
- `Source : Algorithme {product}`

Traduction : **les comparables ne sont pas un flux propriétaire, ce sont des
annonces choisies à la main par l'agent.** Le seul vrai composant fermé est
l'« Algorithme » d'estimation. Le fossé est plus étroit qu'annoncé — et il est
exactement là où nous l'attendions.

Les modules du rapport, tels que nommés par le produit : `cover_details`,
`estimation_summary`, `price_recommendation`, `properties`, `property_features`,
`renovation_work` (18 postes de travaux chiffrés), `yield_analysis`,
`yield_formula` (rendement, amortissement, frais).

### Méthode de notation (documentation publique, pas reniflage)

Note **/100 par indicateur**, doublée d'une **lettre A→E** calquée sur le DPE.
Périmètre d'observation : **5 km** autour de l'adresse. 10 thématiques :
Immobilier, Transport, Éducation, Commodités, Nuisances, Risques, Numérique,
Emploi, Urbanisme, Voisinage.

### Tarifs affichés

Avis de valeur marché **39 € HT/mois** (illimité) · Avis de valeur locatif
**39 €** · Captation de leads **30 €** · Valorisation de bien **50 €** ·
5 API (Data, Estimateur, Report, POI, Maps), tarifs non publiés.

---

## 2. Grille de correspondance : les 10 thématiques contre notre inventaire

Nos 52 couches et 66 routes serveur, rangées dans la grille de Cityscan.

| Thématique | Ce que nous avons **déjà** | Ce qui manque | Palier |
|---|---|---|---|
| **Immobilier** | Ventes immobilières (DVF), Performance énergétique (DPE), Parcelles, Bâti 3D + pivot RNB | Loyers de référence ; estimation ; annonces en cours | 1 (loyers) · 2 (estimation) · 3 (annonces) |
| **Transport** | Transit FR (151 réseaux **GTFS-RT**), Fréquence des transports, Réseau IDFM, Road Status, Événements routiers, Bikeshare, Shared Mobility, Zone de chalandise (isochrones) | rien de significatif | **déjà devant** |
| **Éducation** | Établissements scolaires, Accueil du jeune enfant, Enseignement supérieur | **IPS** et résultats (DEPP) | 1 |
| **Commodités** | Équipements du quotidien (BPE, 10 codes), Médecins, Bornes IRVE, Îlots de fraîcheur | 25 codes BPE de plus (restaurants, bars, cinémas, banques, stations-service, boulangeries…) | 1 |
| **Nuisances** | Bruit des aéroports, Comptages routiers, Antennes mobiles (ANFR) | **Qualité de l'air** (indice ATMO), cartes de bruit stratégiques hors aérien | 1 (air) · 2 (bruit CBS) |
| **Risques** | Risques (Géorisques : ICPE, radon, inondation, sismicité…), Vigicrues, Hub'Eau, Vigilance MF | rien | **à parité** |
| **Numérique** | Antennes mobiles (ANFR) | **ARCEP « Ma connexion internet »** (débits fixes par adresse) et couverture mobile | 1 |
| **Emploi** | — | INSEE Melodi (chômage, actifs, commune et IRIS) | 1 |
| **Urbanisme** | Urbanisme (PLU/GPU), Autorisations d'urbanisme (Sitadel), Parcelles, Fiche implantation | servitudes d'utilité publique en propre | 1 (mineur) |
| **Voisinage** | Carroyage INSEE (Filosofi), Délinquance enregistrée | structure des ménages / âges (INSEE) | 1 |

**Huit thématiques sur dix sont déjà servies par des routes en production.**
Ce qui manque n'est pas de la donnée : c'est **une adresse, un barème et une
fiche**.

Et nous avons trois choses que Cityscan n'a pas et n'aura pas à ce prix : le
globe 3D photoréaliste et le bâti IGN, les couches **vivantes** (GTFS-RT,
IRVE dynamique, AIS, trafic, crues) que la chronique accumule, et le moteur
analyste vocal.

---

## 3. Le triage

### Palier 1 — duplicable facilement (jours, pas semaines)

Tout ce qui suit ne demande **aucune licence nouvelle, aucun partenariat, aucun
service hébergé supplémentaire**, et suit un patron déjà présent dans le dépôt.

1. **La radiographie d'adresse.** Une adresse en entrée, dix thématiques en
   sortie, chacune notée. Toute la donnée est derrière nos routes ; la
   `Fiche implantation` fait déjà la jointure isochrone × Filosofi × GPU × DVF
   et prouve que le patron tient. Le travail réel est le **barème**, pas la
   collecte. *(voir la réserve au palier 1½)*
2. **BPE de 10 à ~40 codes.** Couvre 25 des 30 types POI de Cityscan. Le coût est
   déjà mesuré dans `amenitiesFeed.js`.
3. **Loyers** — « Carte des loyers » du ministère, millésime 2025, €/m² par
   commune, maison et appartement séparés. Comble l'« Observatoire des loyers »
   que Cityscan cite dans ses propres sources.
4. **Numérique** — ARCEP « Ma connexion internet » : débits et technologies
   **à l'adresse**, plus la couverture mobile par opérateur. C'est la seule
   thématique Cityscan où nous étions à zéro.
5. **Qualité de l'air** — indice ATMO quotidien par commune (Atmo France, API
   nationale). Une couche vivante de plus, que Cityscan vend en statique.
6. **Éducation, la version qui dépasse** — **IPS** des écoles, collèges et lycées
   (DEPP, API Opendatasoft), joint à notre couche Établissements par l'UAI.
   Cityscan compte les écoles ; nous pourrions dire lesquelles.
7. **Emploi** — INSEE Melodi, ouvert et sans clé (vérifié : HTTP 200).
8. **Le rapport partageable.** Nos liens de partage sérialisent déjà caméra,
   style, couches et cible. Un mode `?embed=1` et une impression PDF du panneau
   couvrent « Valorisation de bien » (50 €/mois) et « Captation de leads »
   (30 €/mois) sans backend.

### Palier 1½ — le coût caché ~~à dire tout de suite~~ **livré le 2026-09-08**

> **Fait.** Méthode, mesures et choix : [`docs/BAREME.md`](BAREME.md). Code :
> `src/data/baremeNational.js`, `scripts/build-bareme-fr.mjs`
> (`npm run bareme:fr`). La fiche imprime désormais un rang national et, pour
> trois indicateurs sur onze, une lettre A→E.

**La lettre A→E n'est pas gratuite** — c'était vrai. Mais le chiffrage
ci-dessous, écrit avant de mesurer, se trompait de lot :

> ~~il faut précalculer les ~120 indicateurs sur 35 000 communes ou 50 000 IRIS,
> les stocker, et les rafraîchir. Ce n'est pas difficile, c'est un lot de
> traitement et un volume.~~

Un tableau à la commune **ne peut pas noter la fiche**, parce que la fiche ne
mesure rien à la commune : elle mesure sur un anneau piéton de dix minutes. Une
valeur ne se classe que dans une distribution mesurée sur **la même géométrie**,
et le dépôt en portait déjà le contre-exemple — `FILOSOFI_RAMPS` offre les mêmes
indicateurs gratuitement, au carreau de 200 m, et les employer aurait donné des
lettres plausibles et fausses.

Le bon lot n'est donc pas un inventaire, c'est un **tirage** : un échantillon de
résidents à probabilité proportionnelle à la population, sur lequel on fait
tourner la fiche elle-même. Il ne coûte ni base, ni service, ni volume — une
constante gelée dans une source et une demi-heure de mesure par millésime.

Ce qui reste vrai de l'avertissement : sans ce lot on livre des **valeurs**
honnêtes (« 3 crèches à 400 m ») et pas des **notes**, et la note engage un
jugement — sur onze indicateurs mesurés, huit n'ont pas de sens défendable et
reçoivent un rang sans lettre.

### Palier 2 — faisable, mais des semaines

1. ~~**L'estimateur (avis de valeur).**~~ **LIVRÉ le 2026-09-08** — couche
   `avis-valeur` (`vv`), route `/api/avis-valeur`, sur les mêmes millésimes DVF
   que la carte des ventes. Le détail tient dans `docs/CURRENT-STATE.md` ; ce
   qui compte pour ce document, c'est que le coût annoncé ici était le bon et
   qu'il était ailleurs que dans la donnée :
   · le nettoyage multi-lots était **déjà fait** par `dvfFeed.js` (une mutation
     de 179 lots n'a pas de €/m²), donc rien à refaire ;
   · l'appariement RNB s'est révélé **inutile** — un comparable se choisit par
     rayon, surface et type, pas par bâtiment ;
   · la calibration EST le produit : deux intervalles qui ne se mélangent
     jamais, un plancher de cinq ventes *dérivé* du point où l'intervalle
     cesse d'exister, et une porte à deux clauses qui refuse de publier un
     milieu qu'on ne connaît pas mieux que le marché n'est dispersé ;
   · et l'affichage de l'incertitude n'est pas une décoration ajoutée à la fin,
     c'est la raison pour laquelle il y a **trois réponses possibles** au lieu
     d'une : une valeur, une fourchette sans valeur, ou rien — en disant
     laquelle.
   Trois choses ont été trouvées en chemin qu'aucune analyse de bureau n'aurait
   données : le registre **ne couvre pas** le Bas-Rhin, le Haut-Rhin, la Moselle
   ni Mayotte (404 mesurés, trois millions d'habitants) ; il publie des
   appartements **déclarés à un euro**, dont l'arrondi au m² vaut 0, un nombre
   qui franchit tous les garde-fous ; et les VEFA se paient +43 % au m² à
   Paris 13e, donc les garder biaisait l'estimation vers le haut.
   **Ce que Cityscan garde encore** : dix ans de calibration contre des ventes
   réelles, et un algorithme qu'on ne peut pas auditer. Le nôtre est auditable,
   ce qui est un argument différent — pas le même.
2. **Le générateur de documents.** Sections, modules, gabarits, thèmes, polices,
   historique, signature. C'est un produit entier, pas une couche — et c'est le
   seul poste du palier 2 qui **dépend du palier 1** : il assemble la fiche
   adresse (palier 1, point 1) et sort par le mode intégrable et l'impression
   PDF (palier 1, point 8). Le commencer avant que ces deux-là existent, c'est
   écrire un gabarit pour un contenu qui n'a pas encore de forme. À prendre
   après, pas en parallèle. L'estimateur, lui, ne dépendait de rien — c'est
   pourquoi il est parti en premier.
3. **Le bruit hors aérien — chiffré le 2026-09-08, et plus cher que « un
   chantier de collecte ».** Ce qui était écrit ici restait vrai et vague ; les
   mesures :
   · **155 jeux** répondent à « cartes de bruit stratégiques » sur data.gouv.fr,
     et 113 à « classement sonore des infrastructures » ;
   · ils sont publiés **par DDT, par département, par type d'infrastructure et
     par période**. Sur les 50 premiers résultats, **quatre organisations
     seulement** — dont 30 jeux pour la seule DDT de Côte-d'Or, qui découpe la
     même carte en route / autoroute / voie ferrée × jour / nuit / 24 h × type
     A / type C ;
   · ils sortent en **WMS + WFS + Shapefile**. Le WFS répond : `GetCapabilities`
     mesuré **HTTP 200, 20 562 octets**, une couche `ms:LNC_FER_CONV_S_021` ;
   · la note de `docs/CURRENT-STATE.md` disait « les archives Géo-IDE n'ont pas
     de CORS ». **C'est exact et ce n'est plus un obstacle** : nos couches
     passent par un proxy serveur, où le CORS ne s'applique pas. L'obstacle est
     ailleurs ;
   · l'obstacle est le **format et le poids**. Le service n'annonce que du GML
     (`gml/3.2`, `3.2.1`, `3.1.1`, `2.1.2`) ; `OUTPUTFORMAT=application/json`
     répond **500 enveloppant un 400**. Et `COUNT=1` sur la couche « voies
     ferrées conventionnelles » de Côte-d'Or rapporte **1 080 625 octets pour
     UNE bande**. Le `numberMatched` de cette couche est 4.
   Traduction : ce n'est pas le patron de `bruitFrance.js` (WMS
   `GetFeatureInfo`, réponses de quelques kilo-octets, JSON). C'est un parseur
   GML, une découverte par DDT, et des polygones à l'échelle du mégaoctet par
   bande — avec une couverture nationale qui, sur cet échantillon, n'existe pas
   encore. **Palier 2 confirmé, mais le coût est le parseur et la collecte, pas
   le rendu, et la couverture est partielle par construction.**
4. **Temps de trajet multimodal vers un point choisi — les deux entrées sont
   mesurées, le graphe ne l'est pas.** Nos isochrones tiennent ; « 23 min en TC
   jusqu'à La Défense » demande un moteur hébergé (OTP/Valhalla), et ce moteur
   demande deux fichiers que nous connaissons déjà :
   · **le GTFS statique français** — `config/pan_gtfs_static.json` indexe
     **147 réseaux**, dont 134 déclarent leurs `shapes`, pour
     **413 007 724 octets** de conversions PAN ;
   · **l'extrait OSM France** — mesuré le 2026-09-08 par une requête de plage
     sur Geofabrik, `Content-Range: bytes 0-1/5076560568`, soit **5,08 Go**.
   Ce qui n'est PAS mesuré, et qui décide de la facture : la taille du graphe
   construit et la RAM du processus qui le sert. C'est le seul poste du palier 2
   qui ajoute une **machine** au produit plutôt qu'une route ; tant que ce
   chiffre n'est pas pris sur une vraie construction, l'annoncer serait une
   estimation sans intervalle — exactement ce que la couche livrée au point 1
   refuse de faire.

### Palier 3 — non duplicable

1. **Les annonces en cours** (SeLoger, Leboncoin, portails). Pas de licence, CGU
   contraires. C'est le socle de « Biens en vente / en location ». *Nuance
   apprise au reniflage : chez Cityscan aussi c'est l'agent qui les sélectionne
   à la main — le produit n'a donc pas de flux magique, il a un utilisateur qui
   travaille. Un opérateur humain reste une option légale ; un robot, non.*
2. **Les avis clients** (immodvisor, opinion-system) — partenariats commerciaux.
3. **La signature électronique et le mandat** dans le flux de l'agent —
   conformité, pas code.
4. **La distribution.** Cityscan est dans Modelo, Netty et Apimo, via Septeo,
   devant 30 000 professionnels. C'est le vrai fossé, et aucune ligne de code ne
   le franchit.

**Un faux fossé, à ne pas payer :** « cartes des mutations depuis 2014 ».
DVF est publique depuis 2014 et nous l'avons déjà. Ce n'est pas un actif
propriétaire, c'est un argument de vente.

---

## 3 bis. Ce qui a été livré du palier 1 — 8 septembre 2026

Écrit après coup, contre le code, pas contre le plan.

| Item du palier 1 | État | Où |
|---|---|---|
| 1. Radiographie d'adresse | **livré**, dix thématiques ; deux chiffres situés contre le barème de #99, le reste refusé sur la géométrie | `/fiche.html`, `src/data/adresseRadiographie.js` |
| 3. Loyers | **livré** | `/api/loyers-fr`, `src/data/loyersFeed.js` |
| 4. Numérique (ARCEP) | **livré** | `/api/arcep-fr`, `src/data/arcepFeed.js` |
| 5. Qualité de l'air (ATMO) | **livré**, en direct, avec J+1 et J+2 | `/api/atmo-fr`, `src/data/atmoFeed.js` |
| 6. IPS des écoles | **était déjà fait** | `src/data/ipsFeed.js`, joint par UAI depuis la PR #53 |
| 7. Emploi (Melodi) | **livré**, trois recensements | `/api/emploi-fr`, `src/data/emploiFeed.js` |
| 8. Rapport partageable | **livré** : `?embed=1` + impression navigateur | `fiche.html` |
| 2. BPE de 10 à 24 codes | **livré**, et il coûtait plus cher que prévu | `src/data/amenitiesFeed.js` |

**Ce que le démontage avait sous-estimé sur la BPE.** Le chiffre cité —
« épicerie et boulangerie : 80 226 lignes de plus » — ne mesurait que deux
codes sur les quatorze nécessaires. Le recensement complet des 235 codes TYPEQU
a été refait sur l'archive vivante, puis le pack national reconstruit. Ce que
l'extension coûte réellement, mesuré des deux côtés :

| | avant | après |
|---|---|---|
| Codes TYPEQU lus | 10 | 24 |
| Familles | 7 | 14 |
| Lignes dessinées | 126 857 | **521 672** |
| Points après repli | 95 404 | **445 380** |
| `pack.json` sur disque | 37,8 Mo | **170 Mo** |
| Repli national | 47 s | 54 s |
| Le carré le plus dense (0,349°, 48.65 N 2.20 E) | 9 139 points | **53 121** |

Le seul A504 « restaurant-restauration rapide » pèse 231 989 lignes — davantage
que les sept familles d'origine réunies — et 34 192 de ses points partagent une
coordonnée avec un autre restaurant.

**Le plafond qui ne mordait jamais mord maintenant.** La route `/sites` répond
au plus 12 000 points ; sur le carré parisien le plus dense elle en écarte
désormais 41 121, soit trois quarts de la vue. Ce nombre était calculé et
publié dans le payload, mais la couche ne l'affichait pas : elle le dit
maintenant sous son propre interrupteur, et renvoie au maillage. C'est la
seule régression que l'extension a introduite, et elle est corrigée.

**Quatre types Cityscan que la BPE ne peut pas servir**, vérifié dans
`TYPEQU_2025.csv` : il n'existe **aucun code « bar / café / débit de
boissons »**, **aucun code « musée »**, aucun « tabac » et aucun « jardin
public » dans l'édition 2025. B209 est le *commerce* de boissons, F312 la
médiation culturelle. Ces quatre types restent ouverts tant qu'on n'ira pas les
chercher dans OSM, et `BPE_ABSENT_TYPES` le dit dans le code plutôt que de
laisser un lecteur conclure qu'il n'y a pas de café dans sa rue.

**Rencontre avec le palier 1½.** Le barème national (#99) a atterri sur `main`
pendant que cette feuille se construisait, et il change ce qu'elle a le droit
de dire. Deux de ses chiffres sont mesurés sur exactement les formes que le
barème a relevées — l'anneau piéton de dix minutes et le disque de 300 m de
DVF — et ils portent donc un centile national, plus une lettre pour le premier.
Tout le reste est refusé, et c'est le module qui refuse : les chiffres de
voisinage de la feuille sont moyennés sur un **rectangle de carreaux**, pas sur
un anneau, et `scoreIndicator()` répond « échelle mesurée sur une autre
géométrie ». La feuille imprime ce refus au lieu d'un tiret. C'est la fiche
implantation du globe qui porte les rangs de ces indicateurs-là.

**Ce qui reste ouvert, et qui n'était pas au palier 1 :** aucun lien depuis le
globe vers la fiche — la carte de survol du globe est plafonnée à six lignes
par `addressScanLayer.js` et n'a pas d'affordance cliquable, donc la fiche
s'ouvre par URL. Trois thématiques pourraient encore s'enrichir de routes déjà
en production : délinquance enregistrée et petite enfance (Voisinage,
Éducation), bruit aérien et antennes ANFR (Nuisances).

---

## 4. Ordre de construction proposé

1. **La fiche adresse** — promouvoir `Fiche implantation` en radiographie
   d'adresse à dix thématiques, en **valeurs mesurées d'abord**, sans lettre.
   C'est la scène qui fait ressembler le fork à Cityscan, et elle est presque
   entièrement composée de code existant.
2. **Les quatre couches manquantes** — ARCEP, loyers, ATMO, IPS — parce qu'elles
   ferment les seules cases vides de la grille et coûtent chacune un patron déjà
   écrit.
3. **BPE de 10 à 40 codes** — le rattrapage POI, mécanique.
4. ~~**Le lot de normalisation nationale**, seulement une fois que la fiche est
   lue et que l'on sait quels indicateurs méritent une note.~~ **Fait le
   2026-09-08**, et pris avant les couches parce qu'il décide de leur forme :
   toute couche ajoutée arrive maintenant avec l'obligation de déclarer sur
   quelle géométrie elle se laisse noter. Voir [`docs/BAREME.md`](BAREME.md).
5. **Le mode intégrable et l'export PDF** — la surface commerciale, une fois que
   le contenu vaut d'être partagé.
6. ~~**L'estimateur** — en dernier, et jamais sans son intervalle.~~
   **Fait le 2026-09-08, et pris en premier plutôt qu'en dernier.** La raison
   du changement d'ordre : c'est le seul poste de la grille qui ne dépendait
   d'aucun autre. La fiche adresse (palier 1) et le générateur de documents
   (palier 2) se tiennent l'un l'autre ; l'estimateur ne tient qu'à DVF, qui
   était déjà en production. Il est donc parti seul, sans attendre, et la
   consigne « jamais sans son intervalle » a été tenue au sens fort : il y en a
   deux, et le produit refuse de publier un chiffre quand le second est trop
   large.

---

## Sources

Reniflage : `app.cityscan.fr` (bundle d'entrée + 302 chunks),
`api.cityscan.fr/app/common/translations` (public), en-têtes HTTP,
`aide.cityscan.fr`. Documentation publique : `cityscan.fr` (pages solutions et
`/csapis/`), `blog.cityscan.fr/tout-savoir-sur-les-indicateurs` via l'Internet
Archive (instantané du 2023-03-29), presse spécialisée pour la méthode de
notation. Vérification des jeux de données : data.gouv.fr,
`data.education.gouv.fr`, `api.insee.fr/melodi`.

Comparable utile repéré en chemin : **score-adresse.fr** — un clone B2C mince,
7 sources ouvertes, rapport PDF à 9,90 €. La preuve que le palier 1 est bien un
palier 1.
