# Changelog

This changelog records public product changes. For the authoritative description
of current runtime behavior, see [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md).

## [Unreleased] — 2026-09-02

### Added
- **IPS des écoles — le dernier point du brief, et ce n'est pas une couche.** L'*indice de position sociale* de la DEPP ne publie aucune coordonnée : ses 43 322 lignes sont clés sur l'UAI et rien d'autre, donc une couche devrait emprunter sa géométrie à `schools-fr` — c'est-à-dire qu'elle SERAIT `schools-fr`. L'indice arrive donc comme la cinquième jointure sur l'UAI de ce fichier, à côté des quatre fichiers d'effectifs qui donnent déjà la taille des points. Sans clé, Licence Ouverte 2.0, via le proxy `/api/schools-fr` existant.
- **La couleur veut toujours dire NIVEAU et la taille toujours EFFECTIF.** Rien de ce qui est à l'écran ne change quand on active la couche. Il n'y a pas d'échelle de couleur IPS, même optionnelle : le canal couleur porte déjà un sens, et un second sens caché derrière un interrupteur ferait dire deux choses différentes à deux captures de la même couche sans que rien à l'écran ne les distingue. L'indice arrive là où il peut être qualifié — sur la fiche, et sur la ligne sous l'interrupteur.
- **Un établissement sur trois n'a pas d'IPS, et sa fiche le dit.** Mesuré le 2026-09-02 contre les fichiers vivants : `schools-fr` dessine 68 158 lignes ouvertes et géolocalisées sur **68 083 UAI distincts**, dont **62 857 peuvent porter un indice** (Ecole 48 169 · Collège 9 055 · Lycée 5 547 · EREA 79, plus 7 que l'annuaire laisse sans type et que la DEPP indexe quand même). **42 974 trouvent une ligne IPS (68,4 %)** et **40 529 en rapportent un nombre (64,5 %)** : Ecole 66,9 % / 61,8 %, Collège 77,8 % / 77,7 %, Lycée 65,4 % / 65,4 %, EREA 97,5 % / 97,5 %. Les 22 328 autres portent *IPS non publié pour cet UAI* — jamais dessinés, jamais colorés, jamais lus comme moyens.
- **Quatre fichiers, quatre rentrées différentes : un `max()` global efface 32 494 écoles.** `fr-en-ips-ecoles-ap2022` s'arrête à **2024-2025 (32 494 lignes)** là où les collèges (7 089), les lycées (3 662) et les EREA (77) atteignent **2025-2026**. Chaque jeu découvre donc SA propre rentrée par son `group_by=rentree_scolaire`, plancher à la valeur mesurée, comparée comme chaîne `YYYY-YYYY` derrière un garde de format — `Number('2024-2025')` vaut NaN, un max numérique rendrait le plancher pour toujours. Les fichiers sont en plus cumulatifs (97 080 lignes écoles = trois années empilées), donc la rentrée est épinglée dans le `where`.
- **Les lycées n'ont pas de colonne `ips`, et leur chiffre d'établissement mélange deux populations que le fichier publie séparément.** Ils publient `ips_voie_gt`, `ips_voie_pro`, `ips_post_bac` et `ips_etab` avec `type_de_lycee` ∈ {LEGT 1 565, LP 1 097, LPO 1 000} — une jointure écrite contre `ips` en perd 3 662. `ips_etab` est le chiffre retenu (seule colonne définie sur 3 661 des 3 662, seule comparable entre les trois types), mais la fiche le nomme comme chiffre d'établissement puis nomme les voies dessous : sur les **931 LPO qui portent les deux, l'écart médian GT / pro est de 18,1 points, le neuvième décile 27,9, et le plus large est 0312746S à GT 140,1 contre pro 92,4** — 47,7 points dans un `ips_etab` de 126,3. Ce n'est pas non plus une copie d'une voie unique : 2 042 lignes portent `ips_post_bac`, replié dans `ips_etab` et nulle part ailleurs.
- **`fr-en-ips-erea-ap2022` écrit mal le nom de sa propre colonne, et c'est un HTTP 400.** `nom_de_l_etablissment`, sans le second « e ». Vérifié dans les deux sens le 2026-09-02 : l'orthographe correcte renvoie `ODSQL query is malformed: Unknown field: nom_de_l_etablissement. Clause(s) containing the error(s): select.` sur les EREA, et la faute renvoie la même chose sur les écoles. Le `select` est construit par jeu de données, jamais partagé.
- **La référence est par type pour les lycées : LEGT 120,2, LPO 104,4, LP 89,9.** 30 points d'un bout à l'autre — comparer un LP à la référence LEGT n'est pas un arrondi, c'est un mauvais chiffre. La fiche porte la référence départementale et nationale du type de l'établissement, et l'écart au département. Deux cas mesurés renvoient l'écart à la référence nationale : la référence départementale manque (2 LEGT, 10 LPO, 3 LP) ou elle ÉGALE l'indice de l'école, donc elle la contient et presque rien d'autre — **184 lignes, dont 49 des 77 EREA**, puisqu'il y a au plus un EREA par département. Avec ni l'une ni l'autre (94 collèges et 39 lycées n'ont pas d'`ips_national`), la fiche donne les ancrages qu'elle a et aucun écart.
- **« NS » est une valeur publiée, et `Number('NS')` vaut NaN.** Le fichier écoles écrit littéralement `"NS"` — *non significatif*, le marqueur de secret statistique de la DEPP — dans **2 504 de ses 32 494 lignes (7,7 %)**. `Number(ligne.ips) || 0` en ferait 2 504 IPS de **0** sur une échelle dont l'étendue mesurée est 54,9 à 162,7. Elles sont lues comme sentinelle et la fiche dit *IPS non significatif (« NS ») — effectif trop faible*, ce qui n'est pas la même chose qu'une école que la DEPP n'a jamais examinée. Deux autres vides existent : 2 collèges publient `ips = null` et 1 lycée publie toutes ses colonnes IPS nulles. Au total **2 445 établissements dessinés sont DANS les fichiers de la DEPP et n'ont quand même pas d'indice**.
- **L'écart-type a fallu sa propre fenêtre de vraisemblance, et réutiliser celle de l'indice en mangeait 162.** La dispersion intra-établissement va de **7,9** (0752954D) à 46,2, donc un plancher d'indice à 20 supprimait en silence 102 collèges, 39 lycées et 21 des 77 EREA. Ce n'est pas la même grandeur que l'indice qu'elle disperse.
- **Le maillage ne porte pas un octet d'IPS.** Ce paquet expédie des coordonnées SANS les noms pour tenir à 1,66 Mo contre 5,42 Mo ; un indice par tuple l'y ramènerait. L'indice emprunte donc le chemin de clic que le NOM paie déjà : une lecture du registre pour une coordonnée, mémorisée pour la session, et la fiche produite est exactement celle du régime exact, IPS compris. Coût mesuré ailleurs : huit requêtes une fois par processus (**7 598 242 octets bruts / 750 413 gzippés, 3,4 s à froid, 0,64 s à chaud** ; les quatre exports toutes colonnes feraient 33 040 379 / 1 587 950), et sur la vue la plus dense de France (0,34° sur Paris, 4 725 établissements) **+473 636 octets bruts (+17,0 %) et +30 741 sur le fil (+8,8 %)**.
- **Perdre la DEPP ne casse pas la couche.** Vérifié de bout en bout en pointant le portail IPS sur un hôte inexistant : la vue rend toujours ses 195 établissements, 169 portent *Indice de position sociale indisponible — fichier DEPP injoignable* et zéro porte « non publié », le rollup national reste intact avec `ips.status: unavailable`. Un seul fichier en panne ne coûte son indice qu'à son niveau. Les deux caches disque sont versionnés pour l'occasion (`SCHOOLS_NATIONAL_CACHE_VERSION` 1 → 2, et un `SCHOOLS_VIEWPORT_CACHE_VERSION` neuf à 2), sans quoi une boîte mise en cache dans les six dernières heures aurait continué à servir des fiches muettes sur l'indice.
- **Équipements du quotidien — les sept choses qu'une vie quotidienne touche, et les cinq que la carte refuse de redessiner.** Nouvelle couche `amenities-fr` (🏪, jeton `bq`, catégorie BÂTI & TERRITOIRE) sur la Base permanente des équipements 2025 de l'Insee et le registre FINESS : 126 859 lignes de registre repliées en **95 406 points** — 30 215 médecins généralistes, 19 354 commerces alimentaires, 19 216 pharmacies, 16 832 guichets La Poste, 3 953 gendarmeries et commissariats, 3 625 bassins de natation, 2 211 hôpitaux. Sans clé, Licence Ouverte, via le proxy `/api/amenities-fr`.
- **Aucune école, et c'est le premier choix de conception.** Le brief demandait « écoles » en tête de ligne ; la couche n'en dessine pas une. `schools-fr` trace déjà les 68 158 établissements ouverts et géolocalisés de l'Annuaire du ministère, clé UAI, et `sup-fr` 6 914 sites du supérieur — tandis que les 79 743 lignes DOM=C de la BPE (C1 écoles 48 661, C2 collèges 7 532, C3 lycées 5 872) **ne portent aucune colonne UAI** : les 95 colonnes livrées ont été vérifiées une à une, aucune ne permet de rapprocher une école BPE d'une école déjà tracée autrement que par appariement d'adresses. Son géocodage est en plus mesurablement moins bon (79,2 % de `QUALITE_XY = B` sur tout le fichier, 124 107 lignes sans latitude). La légende porte donc une ligne « Écoles — non dessinées ici » avec le compte et la destination, parce qu'un lecteur qui ne les trouve pas doit être renseigné, pas laissé à conclure qu'il manque des données.
- **insee.fr renvoie 200 sans en-tête `Origin` et 403 avec.** Vérifié deux fois le 2026-09-02 depuis `http://localhost:4173`, sur la page, sur `BPE25.zip` et sur `BPE25.parquet`, en GET comme en HEAD — un HEAD nu renvoie 200, ce qui fait croire à l'absence de blocage. Le serveur ignore aussi `Range` (200 et non 206, et il commence à diffuser les 142 Mo) et ne renvoie pas de `Content-Length`. Aucun navigateur ne peut lire ce fichier, aucune clé n'y change rien : le pliage se fait dans le proxy ou pas du tout. Build à froid mesuré de bout en bout sur les amonts réels : **52,9 s**, dont 51 s de téléchargement ; l'inflation des 1 515 251 530 octets et la lecture des 2 921 770 lignes prennent **8,7 s**.
- **Un point que le registre avoue avoir inventé n'est pas dessiné — et les deux registres l'avouent différemment.** La BPE publie `QUALITE_GEOLOC = 33`, que l'Insee traduit mot pour mot par « Voie inconnue, Position aléatoire dans la commune » : **1 284 lignes** sur les dix codes retenus, et le mot « aléatoire » est littéral — sur les 207 communes portant plus d'une de ces lignes (724 lignes), **3 seulement** contiennent une coordonnée répétée. FINESS le dit autrement : **4 646 lignes sont géocodées sur `ADMIN-EXPRESS-2023`** avec un score `.` au lieu d'un nombre, et la partition est exacte (BAN 88 737 et BDADRESSE 9 535 ont un score, ADMIN-EXPRESS 4 646 et MAPS 19 n'en ont pas). Ce sont des centroïdes de commune, prouvés et non supposés : **2 612 des 2 619 lignes ADMIN-EXPRESS partageant une commune avec une autre sont sur une coordonnée identique à l'octet près**, contre 1 608 sur 84 561 pour le témoin BAN — quatre établissements de Bourg-en-Bresse sont tous à 5,224702 / 46,205283. Au total **2 182 positions refusées**, comptées par famille sur la fiche, plus 170 lignes sans aucune coordonnée.
- **Les 100 équipements quotidiens de Mayotte existent comme comptage et pas comme lieux.** Les 40 médecins, 14 bureaux de poste, 5 supermarchés, 7 gendarmeries et 3 bassins que la BPE recense dans le 976 ont **LATITUDE, LONGITUDE, LAMBERT_X et LAMBERT_Y vides** tout en déclarant `EPSG=4471`. C'est 100 des 170 lignes sans coordonnée de toute la sélection. L'île ne porte donc aucun équipement BPE sur cette carte, et la fiche le dit ; ce qu'on y voit vient de FINESS, qui place ses 189 établissements de santé dont 28 pharmacies et 7 hôpitaux.
- **FINESS ne publie pas de latitude : des mètres projetés dans cinq CRS, nommés dans un champ libre.** `coordxet`/`coordyet` sont en mètres et la projection est le **cinquième jeton séparé par virgule** de `sourcecoordet`. Sur les 103 032 lignes, les 102 937 valeurs non vides se coupent **toutes** en exactement cinq jetons avec le CRS en position 4 — y compris les deux lignes `4,ATLASANTE,.,MAPS 06-11-2024,WGS84/UTM zone 1S (Wallis-et-Futuna)` dont on dit souvent que les jetons se décalent, et dont ils ne se décalent pas. Une expression régulière sur `EPSG:(\d+)` perdrait en silence **18 lignes sans préfixe** (16 à Saint-Pierre-et-Miquelon, 2 à Wallis-et-Futuna). Passer les 2 659 lignes non métropolitaines dans l'inverse Lambert-93 les déplace de **6 990 km en médiane** (4 632 km au minimum, 21 004 km au maximum : l'Hôpital de Sia, à Wallis, atterrit à 0,88 E / 63,57 N, en mer de Norvège). Tous les datums ultramarins étant GRS80, une seule inverse UTM paramétrée par fuseau et hémisphère couvre les sept cas.
- **Le point dessiné est une ADRESSE, pas une ligne de registre — parce que la BPE n'a aucune clé.** IDEQUIP, IDSOURCE et SOU sont documentés dans le dessin de fichier et ne sont pas livrés, et le SIRET est vide sur tout équipement hors Sirene. Or les lignes s'empilent : **60 270 médecins généralistes occupent 30 215 coordonnées distinctes**, dont 12 084 en portent plusieurs et une en porte **146** (Paris 14e). 126 859 lignes deviennent donc 95 406 points, chacun disant combien d'établissements il représente et nommant les quatre premiers, le reste étant compté. Les familles ne fusionnent jamais entre elles : 1 137 positions portent deux familles différentes, et une pharmacie dans un supermarché, ce sont deux choses.
- **La vue nationale peint une PART, pas un compte — et c'est le compte qui le décide.** Le nombre d'équipements par département va de 186 (Territoire de Belfort) et 221 (Lozère) à 3 560 (Nord) et 3 710 (Paris), soit à trois chiffres près l'ordre de la population. La couche peint donc quelque chose d'indépendant de la population, tiré du même fichier : la BPE liste **34 915 codes DEPCOM** (la commune, et l'arrondissement municipal pour Paris, Lyon et Marseille), dont **34 778 se replient sur un polygone métropolitain**, et la teinte dit combien d'entre eux portent au moins un des cinq équipements que la BPE fournit. Nationalement **15 196 sur 34 778 = 43,7 %** ; par département de 21,6 % (Gers), 22,0 % (Hautes-Pyrénées), 22,5 % (Somme) et 22,6 % (Ardennes, Meuse) à 100 % (Paris, Hauts-de-Seine, Seine-Saint-Denis, Val-de-Marne), médiane 48,8 %. Les deux familles FINESS sont volontairement hors du ratio et la fiche le dit : FINESS publie une ligne d'acheminement postal, pas un code commune Insee.
- **Le maillage éclaircit famille par famille, parce que les familles vont de 1 à 13,7.** Sur une seule passe globale au budget national de 1 100 points, la répartition mesurée est médecin 414 · commerce 179 · pharmacie 139 · poste 284 · bassin 25 · gendarmerie 45 · **hôpital 14** — quatorze hôpitaux pour un pays qui en compte 2 211. Sept passes séparées avec un plancher de `budget / (4 × familles)` donnent médecin 331 · commerce 223 · pharmacie 222 · poste 197 · bassin 42 · gendarmerie 46 · **hôpital 39**, et la légende imprime tracés-sur-en-vue par famille, parce que le mélange à l'écran n'est alors plus le mélange réel. Le poids que la sélection classe est la **précision de géocodage** : quand une cellule ne garde qu'un point, elle garde celui dont le registre est le plus sûr.
- **La taille d'un point ne veut rien dire, et c'est écrit.** `schools-fr` dimensionne par effectif, `sup-fr` par inscrits, `irve-fr` par puissance ; ici aucun des deux registres ne publie de magnitude. La taille est donc une règle de lisibilité inverse à l'effectif national (médecin 6,5 px pour 30 215 points, hôpital 12 px pour 2 211) et aucune fiche ne la relit comme un nombre. Le second canal est celui que les registres publient vraiment : **108 573 des 126 859 lignes retenues sont au numéro de voirie** (`QUALITE_GEOLOC = 11` ou score FINESS ≥ 95) et portent un halo sable ; 12 990 sont à la voie, 912 en « voie probable » et 4 384 sans aucune précision publiée — dont **3 626 bassins de natation, le recensement sportif n'étant pas géocodé par la chaîne d'adressage de la BPE** (3 632 de ses 3 633 lignes sont `_Z`). Les deux bandes basses perdent le halo et 40 à 50 % de leur opacité.
- **Quatre autres refus, chacun avec sa mesure.** B326 stations de recharge (28 819) : `irve-fr` lit le même fait en direct sur 39 579 coordonnées, montrer un instantané 2025 à côté serait un second avis périmé. DOM=E transports (99 280) : 96 253 sont des adresses d'exploitants de taxis et VTC, et les 2 938 gares et 89 aéroports appartiennent à `transit-fr` et `local-airports`. D307 pharmacies (20 334) : FINESS répond pour cette famille, avec `nofinesset` unique sur 103 032 lignes sans un seul doublon et une actualisation mensuelle. D106 urgences (695) : mesuré et non supposé — **547 des 694 géolocalisées sont à moins de 200 m d'un hôpital FINESS déjà dessiné, 665 à moins de 1 km, médiane 79 m** ; ce sont des services à l'intérieur des bâtiments déjà tracés.
- **Trois vocabulaires pour les mêmes départements, donc aucune jointure par code.** La BPE écrit `971 972 973 974 976` et la Corse `2A`/`2B` ; FINESS écrit `9A 9B 9C 9D 9F`, plus `9E` pour Saint-Pierre-et-Miquelon et `9J` pour Wallis-et-Futuna ; les contours IGN embarqués en utilisent un troisième. Chaque point et chaque commune est placé par point-dans-polygone avec l'accroche côtière partagée de 2 km : **92 725 des 95 406 points rattachés, dont 307 accrochés à la côte, et 2 681 hors de tout polygone métropolitain**, signalés plutôt que traînés sur l'un d'eux.
- **Sitadel — the only forward-looking layer on the globe, drawn on the parcels the permits were granted for.** France publishes every building authorisation since 2013 — 3 020 749 across four files — and not one of them carries a coordinate: 94 columns on the housing register, 33 on the demolitions, `geoFields: ["REG","DEP"]` on both. The new layer reads the two files that answer "what will be here" (1 917 260 + 202 895 permits, 70,2 % of the corpus) and turns each one into the exact cadastral parcel it was granted for, by joining `SEC_CADASTRE1..3`/`NUM_CADASTRE1..3` to the same Etalab cadastre `cadastre-fr` draws.
- **The join rate travels with every object, because it is the finding.** Measured 2026-09-02 over six communes and both files against cadastre edition 2026-06-01: 21 271 permits, **9 744 placed (45,8 %)** — Paris 91,3 %, Nantes 75,6 %, Ustaritz 55,1 %, Beaupréau-en-Mauges 54,5 %, Marseille 20,1 %, Toulouse 7,6 %. For calibration, DREAL Auvergne-Rhône-Alpes published the same join officially and placed 162 171 of 362 038 (44,8 %). Every card prints its commune's rate AND its year's, and the row line prints the count that was not placed.
- **Two different failures, kept apart, because a reader can act on the difference.** *Missing* means the parcel was divided and renumbered — which is what happens when somebody builds on it, so Nantes places 60 % of 2013 and 97 % of 2026, and its single largest permit (553 dwellings, 2015) is one of the losses. *Ambiguous* means the commune publishes section préfixes Sitadel has no column for: Toulouse's 46 préfixes put 34 different parcels under the key `31555AB0069`, so a last-writer-wins index "places" 97,7 % of its permits and is wrong about nearly all of them, while refusing the tie places 9,5 % and is right.
- **The declared plot surface audits the join independently, and ranks the communes the same way.** `SUPERFICIE_TERRAIN` places nothing; compared with the area actually drawn it agrees within a factor of two for 98,4 % of Paris' placed permits, 94,2 % of Nantes', 86,4 % of Beaupréau's, 84,7 % of Ustaritz', 68,6 % of Marseille's and **51,5 % of Toulouse's**. Each card carries its own ratio and the word CONCORDANT or DISCORDANT.
- **Three real dates, not one — which is what makes this different from `dvf-sales`.** `ETAT_DAU` and the three dates give four states of a project and they are the colour: `Autorisé` (nothing further reported), `Chantier ouvert` (a DATE_REELLE_DOC exists), `Travaux achevés` (a DATE_REELLE_DAACT exists), `Annulé`. Demolitions get a fifth band of their own rather than being coloured by `ETAT_PD`, which carries no information — 1 497 of Nantes' 1 587 and 1 582 of Paris' 1 609 sit at *Autorisé*. Dot size is dwellings CREATED, square-rooted, capped at 200.
- **ONE commune at a time, and the arithmetic is the reason.** DiDo answers a filtered, column-projected query by scanning an 889 MB CSV: 3,57–5,01 s regardless of the answer's size, so a national pass would be 39 hours. The layer resolves the commune under the middle of the screen through `geo.api.gouv.fr`, gates at 12 000 m of camera altitude (2·h·tan 30° = 13,86 km of ground, against communes 12,1–17,9 km wide, measured from their own parcel bounds), and draws the commune contour so the neighbouring commune reads as *never asked* rather than *nothing here*.
- **DiDo refuses a fourth simultaneous request, and nothing upstream of this said so.** Six parallel queries returned three HTTP 200 and three HTTP 429 within 145 ms, body `max connections reached: 3` — with no `content-type`, no `retry-after` and no CORS header. The proxy holds a global semaphore of two; three simultaneous commune builds (six queries) complete in 10,5 s at peak concurrency 2 with no refusal.
- **Panning is free.** `/api/sitadel-fr/commune` takes `have=<insee>` and answers an unchanged commune in **53 bytes** instead of the 2 085 535-byte Nantes pack or the 3 144 667-byte Paris one. Cold build 5,9–7,6 s, warm 8,6 ms from memory, 126 ms from the disk cache under `.gev-cache/sitadel-fr/`.
- **No coverage rectangle, on purpose.** Sitadel and the Etalab cadastre both cover the DROM — Saint-Denis de La Réunion answers with 2 849 permits and a 10,4 MB parcel file — so a metropolitan box would have refused them while claiming national coverage. A point with no French commune under it is a real answer that clears the map instead of leaving the last commune's permits drawn over ground they do not cover.
- **`idfm-frequency` — the first time-of-day dimension in God's Eye View.** Île-de-France Mobilités' own *Offre hebdomadaire moyenne hors vacances*: **1,311,578 rows** of average departures per stop, per line and per one-hour band for a term-time week of 2025, Licence Ouverte v2.0. `transit-fr` consumes zero IDFM data because IDFM publishes no vehicle positions (0 in Paris intra-muros against 453 in Bordeaux) and `idfm-network` draws the offer as a static referential, so "how often does anything stop here at 08:00 versus 22:00" was previously unanswerable on this globe.
- **One number moves as you scrub the clock, on a FIXED ladder.** Six steps at 2/4/8/16/32 departures an hour, never a quantile, so a colour means the same wait everywhere and at every hour. Measured on the 805 stops of a 4 km box on Châtelet, on an average Tuesday: **115 stops above 32/h at 08:00 and exactly 1 at 22:00; at 01:00, 397 of the 805 run nothing at all.** Saint-Lazare (métro) is 37/h at 08:00 and 8.7/h at 22:00.
- **Silence is measured, so it is not grey.** A stop that publishes a profile and has no course in the selected band was measured and the published answer is zero, so it keeps its own colour, its own size, its own legend row and its own card sentence — and `fraicheur-fr`'s repo-wide grey `#8a93a6` ("the register did not measure this") is deliberately not borrowed for it. A silent stop is also never offered to DETECT.
- **The operating day is 04:00 → 03:59, and the night bands are kept.** `min/max(tranche_horaire)` is 4 and 27; band 25 is 01:00–01:59. Validating 0..23 would delete the half of the day that separates two addresses, and it is where the largest signal is: **band 25 is 15,904 courses region-wide on a Monday and 31,585 on a Friday, +98.6 %**. 01:30 on a Wednesday is mapped onto TUESDAY's band 25.
- **A wide view gets the same ladder in the same unit.** 356 aggregate rows and 17 enumerated stop censuses fold to **14,719 bytes raw / 5,864 gzipped** in 54 ms, painting 8 départements by departures per hour PER STOP: Paris **13.22** at 08:00 against Seine-et-Marne's **3.00**, and **7.13 against 0.61** at 22:00 — the gap more than doubles after dark. The divisor is enumerated, not counted, because Opendatasoft's `count(distinct id_arret)` is an estimator that answers 3,452 for Paris where enumerating returns 3,506.
- **Designed around a deliberate overlap with `idfm-network`.** 34,903 of these 36,502 stops (95.6 %) join `arrets.arrid` and another 518 join `zdaid` — 97.0 % in all — so both layers mark the same coordinate. Measured on the 805-stop box: median nearest-neighbour **24.2 m**, 463 stops with a neighbour inside 30 m. So the rate disc is 4.5–13 px, strictly under `idfm-network`'s smallest pictogram (14 px), its interior is translucent so the mode glyph reads through whichever paints last, the ramp is a desaturated cold→warm ladder holding none of that layer's five saturated mode hues, and record ids are namespaced `idfm-freq:` so a click on a stacked stop is never ambiguous to `pickRegistry`.
- **549 stops (1.50 %) publish no coordinate and are counted, never placed.** They are exactly the null-`code_departement` bucket — and `where=code_departement="None"` returns HTTP 200 with zero rows, so the predicate has to be `is null` or all 549 vanish without an error. 473 Train, 69 Bus, 7 Tramway, carrying **84,768 of the 3,071,759 average-Tuesday courses (2.76 %)**. 518 join a stop ZONE in the referential, but 512 of those zones have two or more platform coordinates, so there is no single published point to borrow.
- **Eight départements outside Île-de-France hold 235 stops between them and stay unpainted.** 60 (87 stops) · 28 (82) · 27 (36) · 89 (11) · 02 (9) · 45 (7) · 10 (2) · 51 (1). The paint threshold is 1,000 stops and it is not tuned: the smallest painted bucket has 2,971 and the largest unpainted one 87, a 2,884-stop gap.
- **The published département code and the IGN outlines disagree on 542 of 35,953 stops (1.51 %), and the layer says so instead of correcting it.** 35,411 agree, 0 fall outside all 96 polygons, 0 need a coast snap; the largest single flow is 49 stops published as 75 that sit inside 92. The courses are only published per code, so repartitioning the divisor by polygon would divide one partition by another.
- **A box past the ceiling is refused after ONE call.** The identity query asks for 1,201 rows so a full page is the signal. Measured at Châtelet on square boxes: 4 km 802 stops, 5 km 1,133, and every box from 5.5 km up returns exactly 1,201 rows — so the refusal tests page saturation, not the distinct count, which is always under the ceiling on a truncated page. Refusals cost 531 bytes and 194–422 ms instead of four heavy pages.
- **One failed band window is a hole in the DAY, not a hole in the map, and it is named.** The viewport's profiles arrive as four pages split on the band axis; the proxy reports `windows: {asked, answered}` and both the row and the card say how many are missing, because an unnamed hole in the sparkline reads as "no service between 16:00 and 21:00".
- **Two defects fixed in `idfmFrequencyFeed.js`, both of the coercion class.** `bandLabel(null)` printed `00:00–00:59` — a real, readable clock face for a band the publisher does not have — because `Math.trunc(Number(null))` is 0 and `Number.isFinite(0)` is true; and `clampBand(null)` returned band 4 while `clampBand(undefined)` returned the documented default of 8, from the same function, for the same absence. `num('')` also returned 0 rather than null. All three now guard before the coercion, and 22 assertions in `idfmFrequencyFeed.test.mjs` hold them to it.
- **Provenance.** Edition discovered from the portal's own `data_processed` and floored at 2026-08-18T15:54:55+00:00; an older discovery is a malformed answer, not a new fact. Licence Ouverte v2.0 for the frequency figures, and the layer ships its own credit line rather than sharing `idfm-network`'s ODbL 1.0 one, because the two obligations are not the same.
- **Aircraft-noise plans, and a layer that refuses to guess which zone you are in.** New `bruit-fr` layer (token `bz`, 🔊, RISQUES & ENVIRONNEMENT): the DGAC's *plan d'exposition au bruit* and *plan de gêne sonore* read under the point the camera is looking at, from the keyless Géoplateforme WMS-V. 224 aerodromes carry a PEB; 215 of them answer with geometry at their own published point.
- **The dB label is fabricated on a third of French aerodromes if you print the register as published — so this layer prints the index instead.** `indldenext`/`indldenint` mix the *indice psophique* France abandoned in 2002 with Lden dB(A). Measured over the 298 zone rows one probe at each of the 224 aerodromes returns: **75 rows on a pre-2002 arrêté with values 78 … 96, and 223 on a later one with values 50 … 70**, two ranges that do not overlap. The unit is taken from the LATER of `date_arret` and the date inside the arrêté PDF — LFNA (Gap-Tallard) publishes 1985-07-01 on a plan reissued 11/04/2017 — and where the date rule and the value range disagree the unit is SUPPRESSED, not guessed. Nothing converts psophique to decibels: the correspondence is a regulatory table, not a formula.
- **34% of probes return more than one polygon, so the layer ranks them and says on the card which clause won.** Features per probe over 224 aerodromes: 0 → 9, 1 → 141, 2 → 67, 3 → 5, 4 → 2. Taking `features[0]` would be a coin toss on a third of France. A band the point is not inside (measured at Les Mureaux: 4 features, 2 of them containing the probe) is drawn DASHED as context and can never be the answer; the same band published twice (LFPV, LFXU, LFGQ, LFPZ — where the two copies disagree about `producteur` and `date_maj`) is merged with its piece count; and where two zones genuinely both cover the point the **strictest** wins, because the PEB's restrictions are cumulative-strictest. At Saint-Cyr-l'École zone B has no hole cut where zone A sits, so 48,81025 / 2,07712 is inside both — the card reads “2 zones sous le repère — retenue : la plus exposée des zones sous le repère” and names zone B underneath it.
- **Two airports at one point are two facts.** At Le Bourget the probe returns Le Bourget's own zone A (arrêté 2017) and Roissy's zone D (arrêté 2007) — 15 041 bytes, 742 vertices, the heaviest response in the register — and the card names both rather than folding twelve years of arrêtés into one answer.
- **The probe scale is pinned, because the service goes silent with HTTP 200.** `dgac_peb_plan_wmsv` stops rendering below ~1:25 000 and answers a 137-byte empty FeatureCollection, which reads exactly like “no noise plan here”. The probe is fixed at 1e-4° per pixel (1:39 757, a 59% margin) and never derived from the camera. At that scale 9 aerodromes answer nothing at their own reference point; six of them do answer at a coarser probe and every one of those features is OUTSIDE the point, and the remaining three — Toussus-le-Noble, Coulommiers, Pontoise — have an arrêté and no polygon at any scale.
- **An empty probe gets a sentence, not a blank.** The national arrêté register (224 points, 66 355 B, disk-cached for 7 days) turns “nothing here” into “the nearest aerodrome with a PEB is LFPG — P. CH. DE GAULLE, 39,4 km away, arrêté du 03/04/2007”, from the register's own published coordinate and never a commune centroid. Standing ON an aerodrome that answers nothing, it says that instead. And a register that came back short says so on the card, because “the nearest” out of a truncated index is confidently wrong.
- **“The service did not answer” and “there is nothing here” are different sentences.** Both are zero features downstream; only `available` tells them apart, and the card leads with the outage rather than reporting a clean bill of health.
- **Enclaves are cut out of the fill, because a PEB zone is a RING.** Its interior rings are exactly where the LOUDER zone begins — Roissy's zone C arrives with two, Les Mureaux's zone B with six per piece, one band at Saint-Denis de la Réunion with thirteen. Filled without them, zone C is painted over zone B and zone A and the map shows the quiet number on the loudest ground. Every ring is stroked, the interior ones included.
- **There is NO strategic noise map on the Géoplateforme, and the layer says so on every card.** Its WMS-V capabilities are 1 009 124 B and declare 915 layer names; exactly four mention bruit, and all four are DGAC aviation. The EU directive's CBS isophones exist only as ~76 per-DDT Géo-IDE ATOM shapefile zips — EPSG:2154, ISO-8859-1, no `access-control-allow-origin` header at all, four distinct HTTP-200 failure modes on the live OGC services, and Tarn shipping MapInfo TAB with no shapefile inside. That harvest is deferred; road, rail and industrial noise are absent from this layer and the cards read « avions seulement » rather than letting quiet ground beside a motorway be inferred.
- **`data.geopf.fr` rate-limits in HTML.** A 240-point grid sweep at three concurrent probes returned HTTP 429 with `content-type: text/html` and a 134-byte nginx page on 190 of 240 points; `response.json()` on that throws `Unexpected token '<'`. The proxy checks the content type before parsing, retries a 429 twice, and caches per ~11 m.
- **Three coercion defects fixed in the noise feed before it shipped.** `Number(null)` is 0, so `projectPebArretes` PLACED an aerodrome whose coordinates arrived as `[null, null]` at 0°N 0°E and made it “the nearest aerodrome with a noise plan” for the Gulf of Guinea, `projectRings` turned a null vertex into a ring point there, and `threshold(false)` returned a fabricated 0 dB. All three now type-check before parsing.
- **Antennes mobiles (ANFR) — 72 700 supports, colorés par ce qui émet vraiment.** Nouvelle couche `anfr-fr` (📡, jeton `an`, catégorie RÉSEAUX & CAPTEURS) sur l'observatoire hebdomadaire de l'Agence nationale des fréquences : 826 418 lignes de l'édition 2026-08-27 (181 988 412 octets de CSV) repliées sur 72 700 supports répartis sur 107 codes département, DOM et COM compris. Sans clé, Licence Ouverte 2.0, via le proxy `/api/anfr-fr`.
- **Un projet approuvé n'est pas un mât — et c'est 8,05 % du fichier.** Recompté le 2026-09-02 sur les `refine.statut` du portail : `En service` 639 019, `Techniquement opérationnel` 120 891, `Projet approuvé` 66 508. Replié sur les supports, **3 638 (5,00 %) n'émettent rien du tout** et sont dessinés en anneau creux, jamais comme une génération ; 15 606 supports émetteurs portent un dossier approuvé, dont **3 776 seulement ajouteraient une génération** qu'ils n'ont pas — les 11 830 autres rouvrent une bande déjà à l'antenne. Le registre se confirme lui-même : `emr_dt` est nul sur 66 321 lignes et toutes sont des projets approuvés.
- **« Techniquement opérationnel » décrit la 5G, pas un mât.** Croisement sur les 826 418 lignes : les 120 891 lignes techniquement opérationnelles sont **toutes** de la 5G, et **aucune ligne 5G de cette édition n'est jamais « en service »** ; les 639 019 lignes « en service » sont toutes 2G/3G/4G. La fiche dit quelle génération est dans quel statut, et la puce du panneau explique une fois pourquoi la réponse est toujours la même.
- **La couleur dit la génération qui émet, la taille dit les opérateurs, l'anneau dit le dossier.** Bandes mesurées sur les 72 700 supports : 5G 50 148 · 4G 18 698 · 3G 127 · 2G 89 · rien 3 638. Les deux échelons du milieu sont presque vides et c'est le constat, pas un bug : 54 757 mâts émettent de la 3G mais 54 630 émettent aussi de la 4G ou de la 5G, donc 127 mâts seulement ont la 3G pour meilleure génération. Le nuancier a donc deux ancres et non cinq échelons. Taille = opérateurs distincts : 36 671 supports en portent un, 16 786 deux, 8 230 trois, 11 012 quatre, et **exactement un en porte cinq** (SUP_ID 506104, Saint-Barthélemy).
- **Pas de choroplèthe départementale, et c'est une mesure qui le décide.** Les polygones embarqués sont les 96 départements métropolitains. La part des supports dont la meilleure génération émettrice est la 5G est presque plate en métropole — interquartile **59,7 % → 75,5 %** sur les 101 départements d'au moins 200 supports — alors que tout l'écart est outre-mer : Nouvelle-Calédonie **1,0 %**, Polynésie française 8,7 %, Martinique 28,8 %, Guadeloupe 29,8 %, contre 84,1 % dans le Val-d'Oise. Une choroplèthe métropolitaine peindrait la bande plate et perdrait les 3 822 supports où se trouve le constat. La vue nationale est donc le maillage : de vraies positions, éclaircies à 1 100 points, dans les 107 codes département.
- **Les supports se superposent, donc la couche est indexée par SUP_ID.** L'ANFR dérive ses coordonnées de degrés/minutes/**secondes entières**, soit une quantification à 1/3600° (~31 m de longitude à 48°N) : les 72 700 supports n'occupent que **71 748 positions distinctes à cinq décimales**, 895 positions sont occupées deux fois ou plus et une en porte six. Une table indexée par coordonnée perdrait 952 mâts. Le maillage, lui, ne connaît qu'une position : un clic y interroge le registre dans une boîte de ~110 m et la fiche dit combien de supports partagent le point.
- **La fiche Cartoradio, à la demande et une seule fois par mât.** Adresse, propriétaire, catégories que la couche ne dessine pas (FH, TNT, PMR), nombre d'antennes et de stations, systèmes avec leurs **paires de fréquences publiées** (la 5G NR 700 du support 449714 revient en 708–718 / 723–733 / 763–773 / 778–788 MHz, jamais additionnées en une largeur de bande que l'ANFR n'a pas publiée), et la mesure d'exposition publiée la plus proche dans 300 m avec sa distance, son laboratoire, son protocole et **sa date**. Sur le support 449714 : 33 mesures dans 300 m, la plus proche à 40 m, **0,0 V/m mesurés le 04/02/2009 sous protocole ANFR/DR 15-2.1** — un rapport sans aucune bande 5G, à côté d'un mât dont le dernier émetteur est entré en service le 18/07/2025. La fiche affiche l'avertissement plutôt que le seul chiffre.
- **Le registre DAS existe, il est réel, et il n'est pas géographique.** `das-telephonie-mobile` compte 1 230 lignes (1 150 conformes, 80 non conformes, 136 marques, prélèvements de 2012-01-03 à 2025-07-02) et **aucune coordonnée** : c'est un registre de produits, pas de lieux. Il est résumé une fois sur la charge nationale et jamais joint à un mât. Le portail se contredit sur sa taille — le catalogue D4C annonce 1 232 pour la même ressource là où le datastore en renvoie 1 230 ; la projection lit le datastore.
- **Les pièges du fichier, refusés plutôt que devinés.** Le CSV est en LF pur (zéro `\r` sur 181 988 412 octets) là où les tables 5 W voisines sont en CRLF — un analyseur écrit pour l'une laisse un retour chariot sur `statut` et transforme toute la carte en projets ; il commence par un BOM UTF-8, qui fait disparaître `id` d'un index de colonnes naïf ; `coordonnees` est en LATITUDE d'abord chez l'ANFR et en LONGITUDE d'abord dans la republication clermontoise du même schéma, donc une valeur qui ne se coupe pas sur exactement une virgule est refusée ; `sup_nm_haut` porte une virgule décimale sur 243 889 lignes et vaut `0` sur 551 supports, ce qui n'est pas une hauteur et sort en « non publiée » (médiane 30 m, 95ᵉ centile 48 m, maximum 343,3 m).
- **Collision de NOM, pas de données.** La couche `radio` de ce dépôt est radio-browser.info : des flux audio Internet identifiés par un UUID de station. Celle-ci est constituée de mâts physiques identifiés par le `SUP_ID` de l'ANFR. Elles partagent une étagère de panneau et rien d'autre : aucun champ, aucun identifiant, aucune source commune. Les deux libellés sont voisins dans le panneau exprès.
- **Hors champ par la loi, et la couche le dit.** Cité mot pour mot du jeu de données : *« Installations radioélectriques de plus de 5 watts, hormis celles de l'Aviation Civile et des ministères de la Défense et de l'Intérieur. »* Un vide au-dessus d'une base ou d'un aéroport est une politique publique, pas un trou de données.
- **🌳 Îlots de fraîcheur (Paris) — a new keyless ODbL layer over four Ville de Paris / Eau de Paris registers.** 535 cool spots as points, 984 cool green spaces as real footprints (584 Polygon + 400 MultiPolygon, 219 832 published vertices), 1 323 drinking fountains, and the 219 432 trees of the city loaded per viewport. Two regimes and the split is by SIZE, not by zoom: the three refuge registers fold server-side into one 643 107 B gzipped document and ship whole, the trees cannot (111 MB decoded for the whole file) and are a bbox query.
- **Only 23 of the 984 cool green spaces stay open during a heatwave, and the layer draws all 23 in their own hot stroke.** Verified directly — `where=canicule_ouverture="Oui"` answers `{"total_count": 23}` — because the cross-facet returns three `Oui` rows, (Oui,null)=3, (Oui,Non)=11, (Oui,Oui)=9, and adding two of the three gives the 20 an earlier reading of this dataset reported. Nine are also 24 h. **Eleven of the twenty-three publish `indice_veget_sup8m_2024 = 0`** — no measured vegetation over 8 m at all — with a median canopy share of 0,0280 against 0,3197 across all 983 spaces carrying the metric; eight of those eleven are `categorie: "Jardiniere"`, five of them on the Porte Maillot roundabout.
- **The equipment register is coloured by mechanism, not by building type, because the building types ARE the finding.** 127 ombrières pérennes, 125 lieux de culte, 87 brumisateurs, 65 musées, 39 piscines, 19 mairies d'arrondissement, 17 bains-douches, 16 bibliothèques, 13 terrains de boules, 12 ombrières temporaires, 11 baignades extérieures, 4 découverte et initiation. 225 of the 535 are cold stone you go inside — the biggest family and the one nobody guesses — and the five families (pierre, ombre, brume, bain, plein air) name why each thing is on a heat list.
- **Green spaces are coloured by a measured canopy metric, not by area.** `indice_veget_sup8m_2024` is the share of ground under vegetation taller than 8 m at the 2024 survey; seven fixed bands on the measured distribution (p25 0,1083, p50 0,3197, p75 0,5366), with `= 0` its own band (66 spaces) and `null` grey (1 space) because “nothing was found here” and “nobody looked” are different statements. The register also publishes `p_vegetation_h`, a DIFFERENT number on 903 of the 953 rows carrying both (SQUARE D'ANVERS: 0,10921619 against 0,12799286); the card prints both and calls neither a correction. Total measured canopy: 8 734 377 m², of which the two bois hold 6 159 289 m².
- **682 of the 984 green spaces publish opening hours whose own validity window had already expired**, 638 of them the same `du 01/05/26 au 31/08/26`, in a file last modified 2026-08-28. The window is printed on the SAME line as the open/closed answer on every card, never in a footnote. 214 spaces and 423 cool spots publish no readable weekday hours at all and are reported as *unknown*, never as *closed*.
- **“Open right now” is recomputed in the browser, on Europe/Paris, every minute.** The proxy caches its fold for an hour and its summary is unusable for this question: measured over the real registers, 757 green spaces and 93 cool spots are open at 14 h 00 Paris against 367 and 0 at 01 h 30. The local re-fold costs 5,0 ms over the whole pack. The zone is `Europe/Paris` and not the browser's, because an operator in Denver would otherwise be shown a Paris park as open eight hours after it shut.
- **The tree half is a viewport query with a 36-byte gate.** `exports/geojson` honours `where=in_bbox(geo_point_2d,…)` and is subject to neither cap `records` carries — 100 rows a page, and `offset + limit <= 10000` with *“Invalid value for sum of offset + limit API parameter: 10099 was found but <= 10000 is expected.”* Before any download, `records?…&limit=0&select=count(*) as n` answers the box's population in 36 B and 99 ms; over budget nothing is fetched and the true count is printed. Measured: 5 287 trees for 1 690 170 B decoded on a central box; 10 571 trees for 3 368 281 B on the densest box in Paris.
- **The tree budget is 12 500, set on the widest box the PROXY accepts rather than the widest the client asks for.** Every grid-aligned window was scored over all 219 432 published coordinates (downloaded through `exports/json?select=geo_point_2d`, 15 737 120 B): the densest 0,020° window holds **10 571** trees at 48.816,2.346 → 48.836,2.366 — the 13e — confirmed against the portal's own count probe, and the densest 0,022° one holds 12 269. A budget set at 10 000 would have refused the arrondissement with the most trees in it.
- **A tree height of 0 means “not surveyed”, and 19 407 of the 219 432 trees carry it** (with `circonferenceencm = 0` on 16 250; 16 123 carry both). Those dots take their own grey and the minimum size and are never scaled. The size ceiling is 25 m, the 99th percentile of the 200 025 published heights, not the 65 m maximum that exactly two trees reach. `remarquable` is three-state — NON 205 726, null 13 523, OUI 183 — and the null is not a no. `stadedeveloppement` carries `"Jeune (arbre)Adulte"`, two states concatenated upstream, on 41 526 trees (18,9 %), labelled as unreadable rather than mapped to either.
- **One palette across three modules, and grey means exactly one thing.** Grey `#8a93a6` is reserved for “the register did not measure this” — the space with no canopy index, the 19 407 trees with no surveyed height, and any fountain that stops publishing `dispo` — and no other channel may take it. Two collisions were caught and fixed on the way in: the measured-tree band was exactly `#2f8b43`, which is the canopy ramp's 40–55 % fill, so a measured tree standing on any of those 164 parks was painted in its own background; and the residual equipment family was amber, which the 183 remarkable trees own. A test now forbids both.
- **Nothing is placed that was not published.** All 535 equipment rows, all 1 323 fountains and all 219 432 trees carry a real coordinate; 984 of 984 green spaces keep at least one usable ring, and the 22 rings (of 3 439) that fall below a triangle at one metre are dropped and counted. Coordinates are rounded to 5 decimal places — 0,73 m of longitude at 48,86° N — which alone takes 219 832 published vertices to 127 465, because 42,0 % of them were duplicates of their neighbour once 16 decimal places of noise came off. No stride, no Douglas-Peucker: a park's outline is its published outline, moved by at most a metre.
- **`identifiant` is a key on neither refuge register, and `count(distinct)` on this portal lies.** 533 distinct identifiers over 535 equipment rows and 955 over 984 green spaces, 24 of which publish none at all; render ids carry the published key AND the geometry, and every reuse is counted onto the row. Separately, `count(distinct idbase)` answers 211 523 for a 219 432-row register — a HyperLogLog approximation — while `exports/json?select=idbase` settles it at 219 432 distinct, 0 duplicates.
- **Délinquance enregistrée (FR) — the SSMSI's recorded-crime bases, drawn with the publisher's caution rather than around it.** 34,920 communes, 101 départements, 18 indicators at département grain and 15 at commune grain, 2016–2025, keyless under Licence Ouverte 2.0. Two regimes: a 96-polygon département choropleth on `taux_pour_mille`, and per-département commune packs below a 0.75° view span.
- **Fixed a false gloss of the suppression rule that a card was printing to readers.** The layer described a withheld cell as « entre 1 et 5 faits ». The rule (« Les données diffusées sont limitées aux communes pour lesquelles plus de 5 faits ont été enregistrés pendant 3 années successives ») is a three-year condition on the series, not a ceiling on the displayed year, and the register refutes the gloss: measured 2026-09-02, **4,735 of the 251,145 withheld 2025 cells belong to a (commune, indicateur) pair that published more than 5 facts in 2023 or 2024** — Cessy (01071) published 16 *Vols de véhicule* in 2023 — and **36 (département, indicateur) pairs carry a withheld-commune mean above 5**, topping out at 22.33 in Seine-Saint-Denis. Every surface now quotes the SSMSI verbatim.
- **Fixed a dead branch in `delinquanceCellState` that made the whole three-state model accidental.** The register quotes its fields, so the flag arrives as `"ndiff"` with the quotes attached and a bare `String()` comparison never matched. Classification was falling through to the numeric branch and landing on the right answer only because a withheld row also carries `nombre = NA`; an edition that ever wrote a number beside a `ndiff` flag would have painted a withheld commune as measured.
- **`formatDelinquanceRate(null)` printed « 0,000 ».** `Number(null)` is 0, so an absent rate formatted as a measured zero — the exact sentence the three-state model exists to prevent. It now returns an em dash, while a genuine published zero (Ardèche recorded no homicide in 2025) still formats as `0,000`.
- **A withheld cell is not a zero and is not a low value, and 63 tests now hold that line.** A withheld cell takes no colour from the six-band ramp for any bin index including bogus ones, contributes to no quantile threshold, is never averaged, arrives on the wire as a bare `[state]` with no number to paint, and appears in the legend under its own name with its own count. The national withheld count reaches the row legend even at département zoom, where nothing is withheld and the map otherwise looks complete.
- **The quantile cut is taken on faits per MILLION, because the shared `countBins` rounds to integers.** Measured over the 96 metropolitan polygons on the 2025 edition, `Cambriolages de logement`: the real quantiles are 3.641, 4.769, 5.491, 5.926 and 6.569 per 1,000 dwellings and `countBins` on the raw rates returns **[4, 5, 6, 7, 8]**, moving the top boundary from 6.57 to 8.00. On `Homicides` the 93 real quantiles run 0.0071 to 0.0178 and it returns **[0, 1, 2, 3, 4]**, putting every département in band 0.
- **Rate, not count, and the Cher is the whole argument.** On the 2025 cambriolages, by count the leaders are Bouches-du-Rhône 8,586, Nord 8,501, Rhône 7,153 and Paris 7,072, and the eight biggest hold 55,198 of 211,596 facts (26.1%) — very nearly a list of the eight biggest départements. By rate per 1,000 dwellings the leaders are Guyane 9.80, **Cher 9.28**, Ain 8.67 and Isère 8.36, and the Nord drops from 2nd to 17th.
- **Real SSMSI rows, captured through the exact URLs the proxy builds.** `ssmsi-communes-sample.csv` (300 rows, 18 communes) and `ssmsi-departements-sample.csv` (504 rows, 14 départements) plus the geo.api.gouv.fr contours for Paris and five Haute-Corse communes and the trimmed data.gouv.fr dataset payload. Every row is a distinct trap: the withheld-but-not-small commune, the all-fifteen-withheld commune, the zero-population village détruit whose published zero carries a `NA` rate, the Paris arrondissement withheld to block subtraction, the Marseille arrondissements whose departmental mean is 11.0, the 2,897-vertex outline, the five-part island commune, and the enclave ring.

- **Comptages routiers (Paris) — the first road layer here that has counted a
  vehicle.** `traffic` is TomTom flow, bring-your-own-key, and its own header
  says a keyless build runs a SIMULATION; `road-status-fr` is DATEX incident
  reporting whose own header says Île-de-France has no publisher at all. Neither
  has ever counted a car inside Paris. This draws `q` — whose field description
  is verbatim *"Débit (nombre de véhicules comptés pendant l'heure)"* — from the
  city's own permanent loops, on the arc that measured it. **2,977 arcs, 500,136
  hourly readings**, folded from a dataset of **27,772,889**.
- **It is J-2, and the word "live" appears nowhere in it.** Measured
  2026-09-01T21:02Z: `data_processed` 2026-09-01T01:02:50Z, cadence
  *Quotidienne*, granularity *Horaire*, and `max(t_1h)` 2026-08-30T22:00:00Z —
  a nightly batch ~46 h behind the wall clock. So the unit is not a moment but
  the last COMPLETE local Monday–Sunday week, **discovered** from the data's own
  newest hour and floored at the week this was measured against. A discovery
  older than the floor is a malformed answer, not a new fact. `comptagesWeekLabel`
  is asserted to contain no clock time and no claim of liveness.
- **891 of the 2,977 arcs measured nothing, and they are drawn as silence.** The
  live build reports 1,730 arcs counting vehicles, 356 publishing occupancy but
  no count, and 891 publishing neither in any of the 168 hours — with the city's
  own `etat_barre` explaining them as 724 *Invalide*, 141 *Ouvert* and 26
  *Barré*, so 141 arcs are declared open and still silent. A silent arc gets
  `bin: null` and a colour that is **not a member of the flow ramp**; giving it
  the ramp's quietest step would assert a measurement on 891 real streets.
- **A null bin no longer prints as "< 100 véh/h".** `comptagesFlowBandLabel()`
  guarded with `Number(bin)`, and `Number(null)`, `Number('')`, `Number(false)`
  and `Number([])` are all `0` — so an unmeasured arc rendered as the bottom
  band on the legend and the card. It now guards on `typeof bin !== 'number'`.
  This is the exact conflation the module header forbids, reaching a user-facing
  surface; `comptagesFlowBin()` had always refused it.
- **The geometry comes from the measurement, not from the referential.**
  `referentiel-comptages-routiers` publishes **3,739 rows for only 3,348
  distinct `iu_ac`** — 338 repeated with no usable tiebreak, `date_fin` maxing
  at 2023-01-01 on 3,303 arcs that are demonstrably still counting in 2026 —
  and it misses 31 arcs that ARE counting while carrying 402 that are not. The
  counts export carries `geo_shape` on every row: 2,977 features for 2,977 ids,
  fresher, and 0.27 s against 7.7 s. The referential is never fetched.
- **31 arcs publish no geometry and 19 of them are measuring.** They are counted
  on the card and named in the loading line rather than dropped or pinned to a
  street they might not be on.
- **Ten upstream calls, folded once, in 3.1 s.** One `max(t_1h)`, one GeoJSON
  export pinned to the week's closing hour, eight grouped aggregations (the
  clock six hours at a time, because the grouped endpoint caps `offset + limit`
  at 30,000 and one day-type is 71,448 cells), and one `etat_barre` roll-up
  whose loss is explicitly not fatal. Payload 1,374,165 B raw, **305,250 B
  gzipped**. Cached six hours in memory, a fortnight on disk under
  `.gev-cache/comptages-fr/`.
- Share token `cr`, panel icon 🚦 — deliberately neither `traffic`'s 🚗 nor
  `road-status-fr`'s 🛣, because the whole point is that it is a different
  quantity. `REGISTERED_LAYER_IDS.length` moves 42 → 43.

- **Stations météo (FR) — where France measures the weather, and what each
  instrument can actually tell you.** All **2 144 stations** of Météo-France's
  real-time observation network, from the tide line to the **Aiguille du Midi at
  3 845 m**. The globe already showed the weather three times — Open-Meteo in the
  cockpit, Vigilance météo per département, Vigicrues on the rivers — and never
  once showed where the numbers come from. A vigilance map is an interpretation
  of readings taken somewhere; this is the somewhere.
- **Colour is capability, because a French weather station usually is not one.**
  A reader expects 2 144 identical instruments knowing temperature, wind,
  pressure and humidity. Against Météo-France's own per-station inventory:
  **1 254 of the 2 144 — 58 % — measure temperature and rain and nothing else**,
  only **845 can tell you which way the wind is blowing**, and only **234** have
  a barometer. **228** measure all five. So the palette is what each dot can
  answer, the disc is sized by how many of the fourteen instrument families it
  carries, and the **VENT** chip deletes 60 % of the map on purpose.
- **190 stations publish their readings in the open — and Météo-France's own
  list names 62.** A ring means a station whose last hour is readable without a
  key, and clicking one fetches it: temperature, wind and gust in km/h, pressure,
  humidity, rain, visibility, snow. Boulogne-sur-Mer, Le Touquet, Dunkerque,
  Dieppe, Beauvais-Tillé, Ouessant-Stiff and 123 others publish hourly without
  appearing on the list that is supposed to name them; **CAP CEPET is on the list
  and has written nothing all year**. The layer counts the archive, never the
  list. The other 1 954 stations are measuring right now and publishing nothing
  a visitor can read — the card says that, rather than showing an empty reading.
- **Every station's records, with the window they stand in.** 1 230 postes
  publish a *fiche climatologique*, and a click brings back the hottest and
  coldest day ever recorded there plus the period the record was established
  over — Toulouse-Blagnac's 42,4 °C in 2023 against observations back to 1947,
  Arbent's 39,2 °C against 2004. The window is printed with the number because
  without it the two read the same.
- **The instrument inventory, joined from a 191 MB file no browser can fetch.**
  The station list is eight columns and says nothing about what anything
  measures; that lives in Météo-France's per-parameter inventory, dated one
  instrument at a time. `npm run meteo:stations` joins four of the publisher's
  files into a 644 KB pack. Families are anchored on hourly base readings, never
  keyword-matched: matching on "VENT" would count a decadal wind average —
  present on 879 stations — as an anemometer when only 845 have one.
- **Seven stations in the live list are closed, and six exist in no metadata at
  all.** MARSILLARGUES since 2026-01-01, DESHAIES GENDARMERIE since 2024-10-01,
  ST JOSEPH-CIRAD and TAN ROUGE-CIRAD since 2023-03-29, and three more —
  Météo-France's own metadata records the closure and its own real-time list
  still carries the station. They are drawn hollow and the card leads with the
  date. ALBA LA ROMAINE, SOULAINES, TARASCON, PIOGGIOLA, QUERCITELLO and MURAT
  SUR VEBRE are drawn in the neutral grey this project uses for "the publisher
  did not say" — never as stations that measure nothing.
- **Urbanisme (PLU) — click anywhere on the map, not on the marker.** The layer
  drew a whole block of zoning and put every word of the answer on one 26-pixel
  glyph, so the plot opposite could be SEEN and not READ: knowing what the
  magenta polygon across the street means meant flying the camera over it.
  A click on the wash, on an outline, or on the bare globe between them now
  opens a card for that spot — which zone, what the family means, which
  easements reach it, when the PLU was approved and under which document.
  Measured at Ustaritz at 900 m: four clicks across one screen answer `UB`,
  `UA`, `A` and `UB`. No request and no wait: the answer is read out of the map
  already in hand. The scan marker keeps its own card, which is the scan-level
  summary.
- **The register outranks the drawing, within 30 m of the marker.** The shapes
  on screen are decimated by up to 96%, and this layer's own rule is that a
  simplified outline must never decide which rule applies to a house: measured
  at Ustaritz, the point APIcarto itself answers `UB` for falls OUTSIDE the
  drawn `UB` ring — 571 sampled points do. At the scan point the register has
  already answered, so it is used and the geometry is not consulted; further
  out the drawn map answers and the card says its outlines are simplified.
- **Four ways to have no zoning, said apart.** The answer was refused whole,
  the box never covered this spot, the camera is above 1 500 m so only the
  marker was asked about, or the published document genuinely stops here.
  A card printing "aucun zonage" for all four would report three of the layer's
  own limits as facts about the plot. Easements the same: "aucune servitude à
  ce point" only where the register answered that point, and "aucune des N
  servitudes du repère n'atteint ce point" everywhere else — because "this
  ground is clear" is a survey, and the easement half is only ever asked at the
  marker.
- **An approval date is a date.** The same national schema publishes `datvalid`
  as `20240323` at Ustaritz and `2026-06-16` in Paris; both now read
  `23/03/2024` and `16/06/2026` on every card.
- **Accueil du jeune enfant (FR) — the indicator, because the register does not
  exist.** The question "can we add a crèche dataset?" was answered by
  measurement, not assumption, and the answer is no: the Cnaf publishes 210
  open datasets and **not one is an establishment**; FINESS holds 174 621
  establishments of which only **183** have a crèche-shaped name, and those are
  incidental (EAJE are authorised by the département's PMI, not an ARS);
  INSEE's BPE has the right object but its only API millésimes are 2016 and
  **2021**; and Sirene's NAF 88.91A silently drops the entire public sector —
  `nature_juridique` 7210 with that APE returns **zero rows**, while a
  municipal crèche is really there as an establishment of the commune's SIREN.
  So the new layer draws what the State does publish: **places of formal
  childcare per 100 children under three**, at the three scales the Cnaf
  publishes them — 102 départements, 1 251 EPCI, 1 061 communes.
- **The colour is a ratio to France, not a quantile.** This layer paints three
  nested scales, and a quantile band means "the top sixth of what is on
  screen" — so the same colour would mean different things at different zooms
  and an area would change colour without anything changing about it. Every
  scale is anchored on the one national figure (**60,9** in 2023, which
  cross-checks exactly against the ONAPE 2024 report), on a diverging ramp
  whose break falls where the ratio crosses 1. The map then says something
  immediately: the Atlantic west is well above France, the Paris ring and the
  Mediterranean south well below.
- **The omission is the finding.** The bundled polygons are metropolitan, so 6
  of the Cnaf's 102 rows cannot be painted — Guyane 13,4, Saint-Martin 30,2,
  La Réunion 38,5, Guadeloupe 44,1, Saint-Barthélemy 47,5, Martinique 55,2.
  **Every one is below the national rate, Guyane at 22% of it**, while not one
  metropolitan département reaches the lowest band. A map stopping at the
  coastline would delete the whole bottom of the distribution, so the six are
  carried with their rates and named on the national card.
- **Two placeholder rows that are not spelled alike.** The EPCI file publishes
  `numepci = "XX"` carrying a real and extreme 195,8 — the national maximum,
  drawn nowhere, anchoring any ramp — and the département places file spells
  the same idea `XXX`. Matching a literal would have caught one of the two.
  With it gone the real EPCI range is 2,7 to 160,5.
- **Médecins (FR) — where doctors are, and where access runs out.** 64 232
  practice addresses, 117 922 named doctors and what each of them charges,
  drawn at three scales. The national view paints the DREES's **accessibilité
  potentielle localisée** rather than a headcount, and that is a measured
  choice: the median French person lives **0.7 km from a general practitioner**
  and only 0.49 % of the population is beyond 10 km, so a map of counts would
  say "France is covered" and be useless. What is scarce is capacity — 18 % of
  the population lives in a commune the ARS class as under-served. Closer in,
  colour is the family of medicine and dot size is the number of distinct
  doctors at the address; a click names them, says what each costs (94 % of GP
  entries are secteur 1 against 18 % of ophthalmologists, 63 % of whom set
  their own fees), places the commune in the national tenth, and shows what
  the neighbourhood loses when its over-62s retire — **−22 % nationally**.
- **The register that publishes no coordinates, geocoded.** The CNAM's
  *Annuaire santé Ameli* is the only nationwide list of conventioned doctors
  and it contains **not one latitude**: its address block is named
  `coordonnees_*` in the sense of *contact details*. Every ready-geocoded copy
  in circulation descends from the previous CNAM directory, deprecated in
  December 2025, and still speaks of the *contrat d'accès aux soins* — closed
  to new signatures on 2016-12-31. The one daily-geocoded national register,
  Atlasanté's, answers HTTP 403 outside the ARS network. So
  `npm run medecins:registry` geocodes the register against the Base Adresse
  Nationale in three passes and ships the result: **64 232 of 64 625 addresses
  placed, 99.4 %**, 82.7 % at the exact door, 1.1 % at a commune centre that
  says so on its card, and 393 named rather than quietly dropped.
- **Checked against the CNAM's own headcount, and it holds.** The same
  publisher counts the same population a second way; `--verifier` replays the
  comparison. **117 922 named doctors against 112 159**, +5.1 % — the gap a
  directory should show over an activity count taken two years earlier — with
  23 professions between −1.5 % and +15.1 %, and per DÉPARTEMENT a median gap
  of **+2.1 %, 97 of 101 inside [−10 %, +15 %]**, so the geocoding moved nobody
  between departments. Three register traps are neutralised on the way: a
  radiologist is listed at every imaging site they cover (5.53 entries per name
  against 1.18 for a GP), three separate codes read `Médecin généraliste`
  (grouping by code loses 11 % of them), and 9 328 doctors practise in more
  than one département (summing per-department distinct names answers 130 330
  for a country holding 117 922).

- **Urbanisme (PLU) — it draws the block now, not the dot.** The layer answered
  one point, which is the wrong question: "could the car park opposite become
  twenty-five metres of construction?" is about the plot OPPOSITE. Below
  1 500 m the zoning half is asked for over a BOX around what the camera is
  looking at — clipped to the view, so nothing off screen is fetched — and each
  zone is drawn in its family's colour with **its code written on the ground**,
  the way the paper document does it. Above 1 500 m it falls back to the point
  answer, which is still correct and much cheaper. The enclaves that were blank
  islands are now named: the school reads `UE`, the industrial estate `UYc`.
- **The servitude half stays a point, and the measurement is why.** One 390 m
  box over Lyon's Presqu'île answers **210 easement features and 2.3 MB**. At
  the zoning ceiling a full-box regime cost 4 MB upstream, 1.8 MB on the wire
  and 1 182 entities, against the hybrid's 888 KB, 506 KB and 218 — four times
  the payload for the half of the answer a point already gets right.
- **It costs bytes, not frames.** Measured in the browser on the shipped build,
  both regimes, IGN ortho: median frame **0.6–1.4 ms**, worst frame after a
  redraw **1.4–2.2 ms**, and **zero frames over 16 ms** in either. Cesium
  batches ground fills by material and there are only eight zone colours.
  Upstream, the box costs +13% to +27% in a city (the easements already
  dominate) and 17× in a rural commune, where the point answer was 30 KB.
- **`zone-urba` truncates at 5 000 features, HTTP 200, silently — same trap as
  the cadastre.** Measured 2026-09-01: a 0.15° box over Paris returns 4 105 of
  4 105 whole; a 0.40° box returns **5 000 of 17 182**, and a 1.0°
  Île-de-France box **5 000 of 46 500**. A zoning map missing four fifths of
  itself is not visibly incomplete — it looks like a commune with genuinely
  mixed zoning — so a box over the ceiling is refused whole and the true count
  printed. At the layer's own 0.02° ceiling the densest measured box answers 55
  zones, so the refusal is the exception.
- **A label that might sit outside its own zone would be worse than no label.**
  Anchors are the midpoint of the longest interior chord, not the centroid: a
  PLU zone is routinely a meander along a village street or a ring around a
  hamlet, and the centroid of either lands on ground the rule does not cover.
  Verified against all 55 zones of a real answer — every anchor inside its own
  drawn shape. A zone too narrow to hold text is drawn and coloured but
  unlabelled; its card still names it.
- **Which zone you are standing in is decided by whoever was asked.** Under a
  point query APIcarto has already answered it, and re-deciding can only
  disagree; under a box query the layer decides, against the ring as PUBLISHED
  rather than the one it draws. That is not academic: Ustaritz's `UB` ring is
  521 vertices, decimated to 400 for drawing, and the coordinate APIcarto
  itself answers `UB` for falls OUTSIDE the decimated ring. The drawn shape is
  a simplification and must never decide which rule applies to a house.
- The card separates the block from the address: the zone under the marker, how
  many others are on screen, and — when two communes disagree at their shared
  limit — that several zonings claim the same ground. A neighbouring zone's own
  card says it is a neighbour.
- A scan now refetches when the QUESTION changes, not only when the scan centre
  moves 250 m. Zooming straight down through the box altitude moves the centre
  by nothing at all while changing the kind of answer that belongs on screen.
- `viewportBox.focusedViewBox` and a new `ringGeometry.js` hold the box
  derivation and the point-in-polygon the cadastre layer had already paid for;
  the cadastre keeps its own names and ceilings and delegates the arithmetic.

- **Urbanisme (PLU) — the zone is now a wash on the ground, with its enclaves
  cut out of it.** The layer drew bare outlines, and an operator asked the
  right question of them: how can one house be in two PLU zones at once? An
  outline has no inside. Nothing on screen said which side of a line the rule
  applied to, and a building between two lines belonged to both as far as the
  eye could tell. Each zone is now filled — ground-classified, so it drapes on
  IGN ortho, on Bing and on the photoreal tileset alike — with the stroke kept
  on top: the wash says where, the stroke says exactly where.
- **The enclaves were ours, and they are fixed.** The projection kept outer
  rings only, on the reasoning that a hole in an outline is invisible. It is —
  and it is the whole point of a fill. Measured at Ustaritz on 2026-09-01, the
  zone returned for the village centre is `UB`, one polygon, **two interior
  rings**: 6 646 m² the same PLU zones `UE` (the school) and 50 686 m² it
  zones `UYc` (the industrial estate). Filled without them, `UB` painted
  57 332 m² of ground with a rule that does not reach it — and across the
  commune, 14 rings and 299 441 m². Interior rings are now carried, spent out
  of the vertex budget *with* the ring they perforate so a hole can never be
  what a budget drops, and stroked in their own right.
- **A point really can be in two zones, and the layer now says so.** Sampled
  on a 35 m grid over a 9 × 6 km box around Ustaritz: **17 of 34 126 points
  (0,05 %) fall inside two zoning polygons, every one of them at a commune
  limit**. Seven urbanism documents overlap in that box across 73 polygon
  pairs and 5,3 ha — including 525 m² that Jatxou zones `UD` (urbaine) while
  Halsou zones the same ground `A` (agricole). Each commune digitises its own
  PLU against its own idea of where the limit runs, and the Géoportail stacks
  the documents without reconciling them. `zoneCount` is reported so the case
  reads as the register disagreeing with itself, not as a broken answer.
- **`typezone` has seven values, and the table had four — so the family this
  layer exists for was drawn in the unknown-value grey.** Measured across
  twelve APIcarto boxes (Paris, Lyon, Lille, Toulouse, Marseille, Rennes, five
  peri-urban boxes, Ustaritz): **4 216 zoning features and not one plain
  `AU`.** Every à-urbaniser zone published `AUc` or `AUs`. And that letter is
  the most decision-changing thing in the layer: **`AUc` is open** — the plot
  opposite can be built under the PLU as it stands — while **`AUs` is closed
  until the document is modified or revised**. Same magenta family, cooled and
  quieter. `Ah` and `Nh`, the built pockets inside the agricultural and
  natural zones, take their family's hue brightened.
- **The wash weights are measured, not felt.** The same polygon repainted at
  five alphas over an IGN orthophoto, each frame differenced against the
  unpainted one across the ~380 000 pixels the zone covers: **0.18 moved the
  picture by a mean of 3/255 in red and could not be seen at all**; 0.22 by 5,
  0.28 by 11, 0.33 by 17, 0.40 by 24. Shipped: `AUc` 0.42, the exceptions
  0.34, `U` 0.30, and `A`/`N` 0.22 — they are most of the country, and at the
  urban weight a natural zone washes a whole valley teal.
- **Servitudes stay lines, and the lines are dashed.** They are not zoning, and
  a solid stroke said they were. They are also the wrong size to fill: one
  measured `pm1` risk envelope is 759 polygons spanning kilometres, so a wash
  of it tints the view rather than a plot.
- Each zone card now names its family in words — *zone urbaine — déjà bâtie et
  équipée*, *zone à urbaniser OUVERTE* — and says how many enclaves were cut,
  so an unpainted island inside a painted zone reads as the register's, not as
  a gap in the draw.
- The five point-scan layers hand their renderer the viewer, and the urbanism
  layer redraws on a map-stack change. A ground-classification surface is read
  once, when the primitive is built, so a wash addressed to terrain drew
  nothing at all once the photoreal tileset hid the globe — the layer looked
  switched off. It rebuilds from the answer already in hand, with no refetch.

- Added the **Parcelles cadastrales** layer — the lines France taxes land
  along, keyless. IGN's **Api Carto** serves the DGFiP's *Plan Cadastral
  Informatisé* (PCI vecteur) under Licence Ouverte 2.0 with no key and no
  account: one polygon per parcel, with its section, its 14-character national
  `idu`, and the surface the tax administration has registered against it.
  Loaded per viewport, ground-clamped so it drapes on IGN ortho, on Bing and on
  the Google photoreal tileset alike.
- **A cadastral line is a fiscal line, not a legal one, and every card ends by
  saying so.** In France a property limit is fixed by *bornage* — a
  géomètre-expert's survey under article 646 of the Code civil — and the
  cadastre has no authority over it. A crisp polygon on a photorealistic globe
  is exactly the thing a reader takes for a surveyed limit.
- **How approximate each line is, is published, and nobody draws it.** Every
  parcel belongs to a *feuille*, and the feuille carries the scale of the plan
  it was drawn on. Measured across 673 sheets on 2026-09-01: **1:250** in
  central Strasbourg, **1:5000** over the Landes forest, a twentyfold spread
  with zero nulls. At the conventional 0,5 mm of drawn line that is ±0,13 m
  against ±2,5 m for the same word "boundary". Parcels are coloured by that
  band, and the card prints the figure with the assumption attached — a bare
  "±0,25 m" reads as a survey result.
- **The holes are the streets, and the row says how many.** The cadastre
  parcels private land, not the public domain, so a correct answer over a city
  centre is full of gaps. Clipped to the view and measured: **45,7 % of Lyon's
  Presqu'île** is cadastred, 32,7 % around the Champ-de-Mars, 80,9 % in the
  Marais — against 95,0 % of a Cantal block and 98,6 % of a Landes forest one.
  The layer reports the fraction so the gaps read as the public realm rather
  than as a broken feed.
- The service disagrees with itself in ways a naive read gets visibly wrong, so
  six of them are absorbed server-side and pinned against a captured answer:
  - **Api Carto caps every request at 5,000 features and says so only in
    `totalFeatures`.** `_limit=10000` over Paris returns exactly 5,000 of
    12,483, HTTP 200, no warning — and paging with `_start` walks an internal
    order that mixes arrondissements, so a truncated answer is a cadastre with
    *scattered* holes, which is precisely what a complete one looks like over
    the public domain. A box over the cap is refused whole and the true count
    is printed. At the layer's own 0.02° ceiling the densest French cities
    answer 2,100–2,400 parcels, so the refusal is the exception.
  - **A sheet is not identified by (commune, section, feuille).** Lyon
    publishes section `AL` feuille 1 in five arrondissements, and the 5e's copy
    is drawn at 1:1000 while the others are at 1:500 — a four-part join gives
    those parcels a coin-flipped tolerance. With `code_arr` in the key there
    were 0 collisions across 27,595 parcels and 450 sheets.
  - **`idu` does not start with `code_insee` for 38 % of urban France.** The
    first five characters are the *arrondissement* code: a Marais parcel is
    `75103000AP0045` while its `code_insee` is `75056`. Reassembling the key
    joins to nothing in DVF for Paris, Lyon and Marseille, so the published
    `idu` is carried verbatim and never rebuilt.
  - **`contenance` is a fiscal declaration, not a measurement of the polygon.**
    Mamoudzou publishes it as `null` and Ostwald as `0` — and `Number(null)` is
    `0`, which would turn "not published" into "declares zero square metres".
    Where both figures exist, 7,2 % of parcels differ by more than 5 % and
    1,0 % by more than 20 %. Both numbers are on the card and neither is
    averaged into the other.
  - **Courtyards are holes and a parcel can be in two pieces.** Dropping the
    Palais-Royal's interior ring moves its area from inside 1 % of the declared
    contenance to outside 5 %; a Marseille parcel is one identifier over two
    disjoint polygons.
  - **A section is not always letters.** Alsace-Moselle numbers its sections
    (`22`), Marseille prefixes with a digit (`0D`), and `com_abs` — the API's
    "commune absorbée" — runs 801–842 across Toulouse, a commune with no
    arrondissements at all. All are carried as opaque strings.

- Added the **Bornes IRVE** layer — every public EV charge point France has
- **Enseignement supérieur (FR) — the level the schools layer stops before.**
  The *Annuaire de l'éducation* ends at the baccalauréat: measured 2026-09-01,
  its `type_etablissement` has eight values and not one of them is a
  university, an IUT, an école d'ingénieurs, an école de commerce, an IFSI or a
  school of architecture. Joining the two registers on the UAI measures the
  hole — of the 6 509 establishments the ministry's Parcoursup cartography
  lists for the 2026 session, **3 492 appear nowhere in the Annuaire**. The new
  layer draws the MESR's own *Effectifs d'étudiants inscrits — détail par
  établissements* (Licence Ouverte 2.0, rentrée 2024): **6 294 establishments,
  6 914 sites, 2 960 012 students placed**, coloured by seven bands folded from
  the register's 14 published categories and sized by the students counted at
  that campus.
- **No thinning and no sampling, because the whole register fits.** Resolved to
  sites it is **0.62 MB gzipped with every name, band, roll, cycle mix, campus
  count, formation list and website on it** — what the `schools-fr` maillage
  costs (0.63 MB gzipped) while carrying no names at all. So there is no bbox endpoint,
  no ceiling and no spatial thinning: `/api/sup-fr/sites` hands the browser the
  register once and every zoom is answered from it. `/api/sup-fr/departements`
  is the ~30 KB national rollup built by the same sweep. Cold build, measured
  end to end against the live portal: **2.9 s**.
- **1 665 establishments have no coordinate, and the fix is a second register.**
  `geo` is null on 3 442 of the register's 22 068 rows — the Université de la
  Nouvelle-Calédonie and the Université de la Polynésie française among them.
  Nothing is placed at a commune centroid. The layer reads the ministry's
  *Cartographie des formations Parcoursup* (session 2026, 25 831 formations,
  every one geolocated) and borrows a coordinate ONLY where that file gives
  exactly one point for the UAI: **977 establishments and 82 200 students**,
  lifting placed enrolment from 95.69% to **98.41%**. The borrow was checked
  rather than assumed — where both files give one point, the median
  disagreement is **74 m** and 90% agree within 1 km. Polynésie is recovered
  this way; New Caledonia is not, so all 18 of its establishments are reported
  as unplaced instead of being invented into the Pacific. A borrowed coordinate
  says so on its card.
- **The choropleth counts students, not dots — and says why.** Counting sites,
  Paris (484) leads the Nord (292) by 1.66× and the top ten départements hold
  35%. Counting students, Paris (394 788) leads the Rhône (192 964) by 2.05×
  and the top ten hold **49.8%**. The site count is flatter because 2 800 of
  the 6 914 sites are lycées running a BTS — and a map of where BTS sections
  are is a map of where lycées are, which **Établissements scolaires** already
  draws. Those 2 800 shared addresses get their own legend band, and the two
  layers use deliberately different palettes (deep hues and a white dot outline
  here, pastels and a black one there) so a stacked dot reads as the overlap it
  is rather than as a duplicate.
- **The name on the globe is now a click surface.** Every label the shared
  overlay paints — the river gauge's name, the substation's, the power
  station's, the cable's — selects its object exactly as the dot does. It never
  did: labels are painted onto a `pointer-events: none` canvas stacked over the
  viewport, so `scene.pick()` under one returns the globe, and a click aimed at
  a name reached the terrain behind it and DISMISSED the selection instead. The
  name is what says which object this is, and it is five to twenty times the
  target area of the 5–15 px dot it floats above, so it is what people aim at.
  Wired into twelve layers — Hub'Eau, Réseau électrique, Réseau gaz, Production
  RTE, Petite hydro, Événements routiers, Écoles and Bornes IRVE (their
  département names at national altitude), Radio (station names only — a
  cluster badge names a count, not a station), Câbles sous-marins, the ISS
  label and the rocket-mission markers. The depth-tested primitive is still
  resolved first, so a name drawn across a NEIGHBOURING object can never steal
  that object's click, a pick a sibling layer owns is left alone, and a click on
  empty space still clears the selection. Proved in a real browser by
  `npm run qa:label-click`, which reads where the host painted a label,
  dispatches a real pointer event at its centre — nowhere near the dot — and
  asserts the layer's card starts painting.
- **Six French public registers, read from a coordinate.** Géorisques, DVF,
  the ADEME DPE register, the IGN isochrone service, the Géoportail de
  l'urbanisme and Île-de-France Mobilités are now integrated end to end —
  keyless, Licence Ouverte or ODbL, behind six new proxies with unit-tested
  projections. Five new layers scan around the ground point the camera is
  looking at: **Risques (Géorisques)**, **Ventes immobilières (DVF)**,
  **Performance énergétique (DPE)**, **Urbanisme (PLU & servitudes)** and
  **Réseau IDFM (Paris)**. Measured over avenue de France, Paris 13e: 30
  classified installations, 153 recorded sales with a median of **9 063 €/m²**,
  915 energy diagnostics within 200 m, a railway protection strip and two risk-
  prevention envelopes, and 36 transport stops including a métro entrance 30 m
  from the door.
- **Reachable area instead of a circle.** `/api/isochrone` serves IGN's Valhalla
  rings over BD TOPO®: a 15-minute walk from that address covers **2.16 km²**,
  a 15-minute drive **56.96 km²**. Only walking and driving exist — the service
  rejects `bicycle` with HTTP 400 and no cycling ring is modelled in its place.
- **The Paris transit blank is answered.** IDFM publishes no GTFS-Realtime
  vehicle positions at all, so the live-transit layer is empty over the city
  this fork opens on. The new IDFM layer draws the network OFFER — 37 956 stops,
  2 121 lines with their official liveries, step-free status where surveyed —
  and reports the live-vehicle absence in its own stats rather than looking
  broken.

### Fixed

- **Une caméra sélectionnée rendait VERTE au lieu d'ambre, parce que son icône avait sa propre couleur cuite dedans.** Cesium multiplie `billboard.color` dans la texture. La couche CCTV s'en sert pour dire laquelle des caméras l'opérateur a sélectionnée — `#6be8ff` au repos, `#ffd97a` pour l'active — mais le dessin portait du cyan en dur (`#75e7ff` sur des aplats sombres, plus un dégradé de lentille). #75e7ff × #ffd97a = **#75c57a** : la seule caméra que l'ambre devait isoler était la seule à ne pas être ambre. Le cyan de repos sortait lui aussi faux, sursaturé à #31d2ff. L'icône est maintenant `temaki/security_camera` en tracé blanc sur halo sombre, comme tous les autres jeux de ce dépôt le documentent depuis le début : le blanc rend la multiplication neutre, le noir y survit (0 × c = 0) et garde le glyphe lisible sur une orthophoto claire. Au passage, un détail de caméra murale dessiné pour 36 px cesse d'être bouilli en un pâté bleu à 15. Une teinte cuite est un bug, pas un parti pris — `mapIcons.test.mjs` refuse désormais tout glyphe portant un dégradé, une opacité ou un hexadécimal autre que `#ffffff`.
- **"Sites militaires — Context is temporarily unavailable", while Overpass was
  merely busy.** The layer went dark under normal panning and the server log
  said nothing, so the failure was indistinguishable from a dead upstream. It
  was a rate limit this app manufactured itself. `GET /api/status` on
  overpass-api.de answers **"Rate limit: 2"** — two concurrent slots per IP —
  and the rotation was never four mirrors wide — it was **four hostnames over
  two machines**. `lz4.overpass-api.de` resolves to `65.109.112.52`, one of the
  two addresses `overpass-api.de` itself answers with, and both facades report
  `Announced endpoint: lambert.openstreetmap.de/`; `overpass.kumi.systems` is a
  CNAME onto `overpass.private.coffee` (both land on `193.219.97.30`), and that
  host answered a bodyless **502 in ~3 s** on every probe. So half the list
  bought no redundancy and simply paid the same dead host's timeout twice.
  `overpass.kumi.systems` has been dropped. Nothing paced the requests: the installations proxy
  called straight through with no gate at all, and the generic Overpass proxy
  allowed six in flight against a budget of two. A burst of eight drew **429 on
  requests 6 and 8** — and a 429 is a verdict on the **IP**, not on the mirror,
  so "try the next one" collected the same 429, then six seconds of dead
  community mirrors, then surfaced a bare 503. Sequentially, **two of six**
  requests failed that way.
  Upstream requests are now queued at the budget the mirrors actually publish —
  two in flight, waiting rather than failing, proceeding ungated after 20 s so a
  busy moment can never become an error — and a reported rate limit is **waited
  out** (1.5 s, then 4 s) instead of rotated away, since waiting is the only
  move a per-IP limit responds to. The two healthy facades lead the rotation so
  the ~6 s of dead weight is only ever paid after the mirrors that answer have
  failed, and the installations proxy now **names the cause** in the server log
  — rate limit, server-side timeout, or refusal — because the three need
  different fixes and looked identical before.
- **A blocked IP made the globe feel hung, not degraded.** overpass-api.de does
  not only rate-limit an IP it dislikes; it stops answering it. Provoked while
  testing the fix above, the block outlasted **four minutes** of polling,
  `/api/status` included — and every rotation during it spent **47 s** of
  timeouts to learn the same thing, once per camera move, while still sending
  the traffic that caused it. A rotation where no mirror answers at all now
  parks the whole Overpass path for a minute, so the next caller fails in
  **1.7 ms** instead of 47 s and lands straight on its stale cache (measured
  live during that block). A rate limit is deliberately excluded — it is the
  recoverable case, and parking it would trade a two-second wait for a minute of
  blindness. The layer's disk cache, meanwhile, kept serving previously visited
  ground throughout the outage in **9 ms**.

- **Clicking a parcel highlighted a wedge with the NEIGHBOUR's corners.** The
  cadastral outline under the cursor was square and correct, and the cyan fill
  poured into it was a diagonal blob with two edges that belonged to no parcel
  at all. Measured over Ustaritz on parcel AN 0512: **41% of the plot filled**,
  and the two straight cuts through the highlight sat on parcel AN 0511's east
  and north **bounding-box** edges to within one pixel. That is the tell. A
  batched `GroundPrimitive` does not colour a ground pixel by the polygon that
  contains it — Cesium classifies the whole batch in ONE stencil pass, which
  records only "some instance here", and the colour pass then keeps the first
  instance whose kilometres-tall shadow volume reaches the pixel and whose own
  axis-aligned bounding rectangle contains it. Parcel bounding rectangles
  overlap their neighbours' constantly, so inside one batch neighbours repaint
  each other along rectangle edges. It was invisible while every parcel in the
  batch shared a band colour, and glaring the moment selection made one differ.
  Fills are now batched **by band colour** — five primitives at most, against
  one before and one-per-parcel never — and the selected parcel is drawn as a
  primitive of its own laid over the batch. The highlight now matches the
  parcel's own polygon to an intersection-over-union of **0.98 nadir and 0.98
  oblique**, against 0.44 and 0.14 before, proved on pixels by the new
  `npm run qa:cadastre-highlight`.
- **A digue titled "Barrage" — the pack knew better than the card.** Reported
  from the map: a "Barrage · 159 m de long" at Octeville-sur-Mer where no
  barrage is visible. Checked against OpenStreetMap: `w860215522` carries the
  single tag `man_made=dyke`, four nodes, no water body within 250 m — an
  anti-ruissellement bund on the Rouelles watershed, not a dam. The 159 m was
  never wrong; it is `spanM`, measured off the drawn geometry, and it
  recomputes to 159 m from the raw nodes. The word was wrong. The pack has
  stored `kind` since the two-axis rebuild and colours digues ochre, but the
  card title fell through to the LAYER's name whenever a feature had none of
  its own — which titled **1 198 digues, 24 barrage-digues and 88 unclassified
  world features "Barrage"**, out of 5 948 nameless features in a pack of
  7 432. Nameless features are now titled by what they ARE, in the same words
  the chips and the legend already use: Barrage, Digue, Barrage-digue, or
  Ouvrage for the world half that has no `kind` left to read. The second
  reported sighting settles what these actually are: `w849340116` is the bund
  of `w849340115`, tagged `natural=water` + `water=basin` + `intermittent=yes`
  — the embankment of a dry retention basin.

- **"Sites militaires — Error loading" was one mirror refusing, and three
  healthy ones never asked.** Every viewport answered HTTP 503, and the layer
  was right to say so: `/api/military-installations` reads `status >= 400` as a
  failure. The failure was underneath it. `overpass-api.de` scores requests for
  abuse at its Apache front-end and was returning a bare **406 Not Acceptable**
  to the proxy's agent string — a plain HTML page matching neither the
  rate-limit nor the runtime-error sniffer. Measured 2026-09-01, same query,
  interleaved to control for server load: the old
  `gods-eye-view-overpass-proxy/1.0` drew a 406 on **8 of 11** attempts, an
  OSM-conventional `app/version (+contact)` agent on **0 of 11**. That alone was
  survivable; what made it fatal is that `fetchOverpassPayload` rotated to the
  next mirror only on 429/5xx, so a 4xx ended the chain at mirror 1 with three
  mirrors untried below it. A 4xx is a MIRROR verdict, not a query verdict, and
  now rotates — the same rule the mapped-camera and power-grid probes already
  applied, which is why those layers stayed up through the same outage. A
  genuinely malformed query still surfaces: every mirror rejects it, nothing
  outranks it, the caller gets the 4xx back. Third fault, and the one that would
  have outlived the other two: `/api/overpass` cached anything under `< 500`, so
  the refusal was written to memory AND to disk under a **7-to-30-day TTL** and
  re-served as a `HIT` without asking upstream again — one bad minute upstream
  taking every Overpass-backed layer down for a month. Success only, now, and a
  4xx joins 5xx in serving last-good from disk at any age. Measured back to back
  on the same server, fresh cache keys: Lyon, Marseille and Nantes went 503 →
  200 with 21, 23 and 4 installations; in the browser the layer reports `ready`
  with BA107 Villacoublay, le Mont-Valérien and le Fort de Rosny drawn. Six
  regression tests in `overpassProxy.test.mjs` pin the rotation. Worth knowing
  separately: the other three mirrors were all answering 502/504 that day, so
  `overpass-api.de` was the only healthy one — which is why this filter hit so
  hard.

- **"Bâti 3D could not start cleanly" was a camera, not a fault.** Turning the
  layer on from a wide view failed outright: the toggle flipped straight back
  to OFF under an error toast, with a perfectly healthy IGN feed behind it. Two
  faults, one symptom. The layer refuses a request box wider than **0.08°** and
  returned that refusal as `false` out of its first `update()` — which the data
  manager reads as the module REJECTING its lifecycle, so it tore the layer
  down and said so. A load that fetched nothing because it was asked for
  nothing is now not a failed load, in Bâti 3D, the mapped grid and Hub'Eau
  alike. And the guidance it replaces is now carried out instead of announced:
  an explicit enable **flies the camera to the view the layer needs** and loads
  it. Measured over France at 420 km: 420 000 m → 2 900 m, buildings drawn, no
  error published anywhere. The flight only answers explicit intent — a share
  link or a Context restore keeps its own camera — it zooms in and never out,
  it steepens a horizon-facing pitch (no altitude alone can shrink a view that
  reaches the horizon), and it refuses to fly at all when the coverage in shot
  is a sliver at the edge of a camera aimed somewhere else: 400 km over Berlin
  clipping Alsace stays over Berlin. New harness: `npm run qa:view-gate`.

- **A scan with no coordinates no longer answers about the Gulf of Guinea.**
  `searchParams.get('lon')` is `null` when absent, `Number(null)` is `0`, and
  `Number.isFinite(0)` is true, so `GET /api/gpu` with no query string returned
  HTTP 200 and an empty result for 0°N 0°E — indistinguishable from "there is
  nothing at your address". Now HTTP 400. Pinned by `addressProxy.test.mjs`.

- **The address markers were unclickable, and half of each one was eaten by the
  ground.** Two separate faults, both invisible to a unit test. The app runs
  with `infoBox: false`, so an entity's `description` displays nothing on its
  own — every layer must own a `LEFT_CLICK` handler, and these five did not, so
  clicking a marker did nothing at all. Separately, `disableDepthTestDistance`
  was a finite 2 500 m, which re-enables depth testing the moment the camera is
  further off than that: at city zoom the terrain clipped the lower half of
  every disc. Markers now draw always-on-top, own a click handler, and open the
  same world-overlay card as their sibling layers.
- **Five registers over one building, drawn as five identical dots.** Turn on
  Ventes immobilières and Performance énergétique together and both painted
  coloured discs over the same roofs, with nothing to say which register a dot
  came from. Size and hue were already spoken for — DVF spends its colour on
  the price against the local median, DPE on the official A–G scale — so SHAPE
  was the only channel left, and it is the right one anyway: it survives at
  16 px and it survives colour blindness. Each register now draws what it is
  about: a **€** for a sale, **the A–G letter in a frame** for a diagnostic (so
  the grade no longer needs a click), a **hazard triangle** for Géorisques, a
  **plan sheet** for the PLU, and **the mode's own pictogram** for an IDFM
  stop. Every glyph is white line-art over a dark halo and carries no hue of
  its own, so `billboard.color` still delivers each layer's value channel
  untouched.

- **The address markers slid across the city as you moved the camera.**
  `Cartesian3.fromDegrees(lon, lat)` puts a marker on the ELLIPSOID, at height
  0, and the globe draws avenue de France at **79 to 83 m** — so every DVF sale,
  every DPE diagnostic, every risk site and every IDFM stop stood eighty metres
  under the street it describes, painted anyway because depth testing is off.
  Under an oblique camera a vertical error is a HORIZONTAL error on screen, and
  it changes with every camera pose: measured at 700 m and a pitch of −35°, a
  DVF dot landed **83 px** from its own address, and turning the camera moved
  that error **62 px sideways**. The reported symptom was exactly that — the
  dots are not fixed, they move when you nudge the map. Markers are now placed
  at the height of the terrain the globe is actually rendering, and re-seated as
  terrain streams in and as the LOD refines. Measured after the fix: 0 px, from
  both poses, on all five layers.
- **The address layers only noticed you had moved every five minutes.** They
  are camera-driven, but their refresh cadence is the manager's tick — 5 to 15
  minutes, right for registers that change in weeks and useless for someone
  flying across a city. Navigating to a new address left the previous
  neighbourhood's answer on screen until the timer happened to fire, which reads
  exactly as "the layer has trouble refreshing". All five now listen to
  `camera.moveEnd` with a 450 ms settle, matching the BD TOPO layer, behind a
  single-flight guard so a fly-through queues one repeat rather than a request
  per frame. They also request a repaint explicitly: the render governor runs in
  `requestRenderMode`, so a redraw nobody asks to paint never reaches the screen.
- **`HeightReference.CLAMP_TO_GROUND` makes a point unpickable.** It reads like
  the right answer for an annotation that belongs to a building; measured in the
  running app it produced 30 drawn Géorisques points where `scene.pick` and
  `scene.drillPick` both returned nothing. No point layer in this repo uses it,
  and these no longer do either.
- **Zoning outlines are not click targets, and no longer pretend to be.**
  Clamped polylines render as ground primitives and are not pickable here — 62
  vertices of one easement ring on screen, `scene.pick` null at every one.
  Widening the stroke did not help. The urbanism layer now plants a marker at
  the point it scanned, carrying the zone, its approval date and the easements
  crossing it, because a zoning rule describes the ground under an address
  rather than a particular line on a map.

### Notes

- Every price per square metre this release computes is deliberately absent for
  multi-lot sales, swaps and auctions. One captured Paris mutation is
  €32 000 000 spread over **179 rows**: summing the column inflates the 2024
  edition of the 13ᵉ from €0.89 bn to €15.33 bn, and dividing the first row by
  its 25 m² flat gives €1.28 million per square metre. The register does not say
  how such a sale was split, so neither does the layer.
- Added the **Établissements scolaires** layer — every school France
  registers, keyless. The *Annuaire de l'éducation* is published by the
  Ministère de l'Éducation nationale on data.education.gouv.fr under Licence
  Ouverte 2.0 and rebuilt daily: 68,939 rows on 2026-09-01, of which 68,557 are
  open and **68,158 are open and carry a coordinate** — the set the layer
  draws. Three regimes by view span, as the IRVE layer: the 96 départements
  with the country in view, a spatially thinned *maillage* of real positions in
  between, and every establishment with its card over a city. Coloured by
  school level, sized by pupils.
- The register holds no roll, so the roll is a join, and its completeness is
  stated rather than assumed. Dot size comes from the ministry's four per-level
  *effectifs* datasets at rentrée 2025, joined on the UAI: **57,683 of the
  62,918 open, geolocated teaching establishments get one (91.7%)**,
  11,237,267 pupils in total. The 5,235 that do not are named — 2,212 are
  sub-UAI SEGPA and SEP *sections* whose pupils are already counted inside the
  collège or lycée at the same coordinate, and 455 are under the ministry of
  Agriculture. A school with no roll draws at the base size and its card says
  *effectif non publié*; it is never drawn as, or described as, a school with
  no pupils.
- The register's own uncertainties are surfaced instead of flattened:
  - `precision_localisation` is its account of its own geocoding, and it is not
    uniform — **2,159 rows are placed at their commune's centroid, not at the
    school**. Those cards say so. The 22 published spellings fold onto a
    four-step ladder, and an unrecognised one resolves to *unknown* rather than
    inheriting "exact address".
  - **399 open establishments have no coordinate at all**, and 332 of them are
    one place: French Polynesia's 311 and Wallis-et-Futuna's 21 are ungeocoded
    in their entirety. They are excluded at the query rather than placed at a
    commune centroid, and the shortfall is carried to the client.
  - A UAI is an administrative unit, not a building, so two dots can share one
    address. Every site carries its `etablissement_mere`, and the card names
    the parent.
  - `restauration`, `hebergement`, `ulis`, `segpa` and `apprentissage` publish
    1, 0 **and null**, where null means "not declared". The card lists what is
    declared present rather than denying what was never stated.
- The national choropleth is metropolitan and admits it. The bundled
  département polygons are 96 features with no overseas geometry, so **2,762
  open, geolocated schools cannot be painted** — La Réunion's 855, Guadeloupe's
  448, Martinique's 403 and the rest, plus 9 island schools the simplified
  outlines drop. They are counted, named, and reported on the national row
  line; the other two regimes draw positions and show all of them. Assignment
  is point-in-polygon and never a code join, because the register spells
  Corsica `02A` where the IGN outlines say `2A`.

- **The roads the State measures but never says where.** Bison Futé's counting-station
  referential publishes a position for 843 of its 1 367 stations. The other 525 are
  not positionless — 153 of them publish an ADDRESS, the point repère that the French
  road network is actually numbered by, and every kilometre post of the non-conceded
  network is published with its Lambert-93 coordinates in a second open dataset, the
  [Bornage du réseau routier national](https://www.data.gouv.fr/datasets/bornage-du-reseau-routier-national)
  (51 940 posts, Licence Ouverte 2.0, keyless). Joining the two recovers **all 115
  stations of DIR Ouest**, which had never been drawn, plus 26 of DIR Atlantique, 10 of
  DIR Centre-Est and 2 of DIR Est. The join is **calibrated on every build rather than
  trusted**: 831 stations publish an address *and* a coordinate, and resolving theirs
  disagrees with the DIRs' own answer by a **median of 3.8 m** (p90 7.2 m, max 64 m,
  99.8 % within 25 m) — because the DIRs derive the coordinates they publish from this
  very referential. The number is recomputed and stored in the committed index each
  run, so an edition that stopped agreeing would move it in the build log before it
  moved a station on screen.
- **Nantes, Rennes, Saint-Brieuc and Lorient–Vannes are on the map.** The four Breton
  traffic centres publish 619 live road states under identifiers that appear in no
  referential row — which is why the layer drew nothing over a quarter of Brittany.
  Those identifiers turned out to be point-repère addresses themselves:
  `35A0084T096_00D` is département 35, route A84, PR 96, abscissa 0, right-hand
  carriageway. **602 of them resolve**, four cities move from the layer's "state
  published, position withheld" table to its showcase list, and the committed geometry
  goes from **1 195 sites / 832 located** to **1 958 / 1 587**, 608 of them full
  segments over **975 km**. A site placed this way says so on its card — *"position
  resolved from its kilometre post (PR), median 4 m"* — because a derived position and
  a published one are not the same claim.
- **Segments follow the surveyed centre of their own carriageway.** The referential
  gives a counting station two endpoints and nothing in between, so every segment was
  drawn as a straight chord. Threading the kilometre posts between the two ends was the
  first answer and it could not carry the layer: **the median segment is 948 m long and
  the median post interval 1 000 m**, so 643 of 842 segments contained no post at all
  and stayed straight. The drawn line sat a median **56 m** from its own tarmac, 142 m
  at p90, **411 segments past 25 m** — on the Bordeaux rocade, a green line cutting the
  inside of every curve. The shape now comes from the dataset next door:
  [Liaisons du réseau routier national](https://www.data.gouv.fr/datasets/liaisons-du-reseau-routier-national)
  (DGITM, Licence Ouverte 2.0, keyless) publishes **56 205 polylines, 1.66 M vertices,
  one per point-repère interval, at a mean 26 m between vertices** — against the
  1 000 m the posts offered. **The join needs no geometry at all**: every section NAMES
  the two posts it runs between, in the address grammar this build already reads, so it
  is placed in the same cumulative-distance space the bornage is sorted by — and the
  coordinates are then free to be checked rather than trusted. Over 33 483 joined
  sections the polylines' own ends sit **0 m from the posts they name at p50, p90 and
  p99**: the two files are cut from the same survey. **589 of the 608 real segments
  trace** (96.9 %), simplified at 4 m — under the width of a traffic lane — for a
  committed file of 485 KB against 364 KB. The 19 that do not are slip roads and
  unnumbered axes the point-repère referential does not address; they keep the post
  threading, or the chord, exactly as before. Three guards refuse to shape rather than
  guess: a section drawn more than 50 m from the posts it names, an endpoint more than
  150 m from any post of the road it names, and a trace running more than three times
  the straight line between its ends — the ring-road case, where shaping would wrap a
  segment around the whole of Bordeaux.
- **Lille stays dark, and that is a measurement, not a gap.** DIR Nord's 357 site ids
  were tested against the bornage both ways they can be read: three digits as the PR
  fits 24 % of them, two digits fits 75 % — but the two-digit reading puts DIR Nord's
  A1 sensors at PR 12–30, which is département 95, inside Île-de-France and 150 km
  outside its territory. A grammar that has to be wrong to parse is not the grammar,
  so the empty-state sentence over Lille now reads "under site ids that are neither a
  referential row nor an address" and the city keeps its explanation.

### Changed

- **Les lettres A–G du DPE sont maintenant celles d'Inter, la police de l'interface — plus des tracés faits à la main.** Les huit badges étaient sept chemins tracés au trait dans ce fichier, plus un point d'interrogation : épaisseur constante, des arcs là où une police a des courbes, et aucun rapport entre une lettre et la suivante au-delà d'une boîte englobante commune. Ça se lisait comme une **calligraphie approximative**, pas comme du texte composé — le B et le G le disaient le plus fort. Tout le reste de l'iconographie de ce projet est l'image d'un OBJET ; une lettre, non : c'est un caractère, et les caractères sont le métier des dessinateurs de caractères. Les contours viennent donc d'**Inter** (SIL OFL 1.1), extraits une fois au build avec fontkit à l'instance `wght 700, opsz 14` — l'axe de taille optique réglé sur 14 et pas 32 exprès, parce qu'il ouvre les contreformes pour les petits corps et que ça s'affiche à 15 px. Inter précisément parce que l'application compose déjà toute son interface avec (`--font-sans`) : un badge sur le globe et la même note imprimée sur la fiche sont désormais les mêmes lettres. **Aucun point de contrôle n'est déplacé** : chaque `d` est stocké tel que la police le contient, dans son espace em de 2048 unités, et le placement dans la boîte de 96 — hauteur de capitale à 42, ligne de base à y=70, centrage sur la boîte propre de la lettre, y inversé — est un `transform` SVG appliqué au rendu, donc vérifiable. Le halo de la lettre est volontairement plus fin que celui du reste du pack (5 au lieu de 12) : un contour strié grossit vers l'intérieur autant que vers l'extérieur, et à 12 la panse du A se referme et le badge se lit comme un triangle. Aucun fichier de police n'est redistribué, seulement huit contours.
- **Maki et Temaki — deux jeux d'icônes CARTOGRAPHIQUES à côté de Material Symbols, et un téléphérique qui cesse de ressembler à un immeuble.** Material Symbols est dessiné pour 24 px dans un menu ; Maki (Mapbox) et Temaki (l'éditeur iD d'OpenStreetMap) sont dessinés dans une boîte de 15 unités pour une étiquette posée sur de l'imagerie — soit exactement la bande où ces couches dessinent, 15 à 29 px CSS. Ce n'est pas une migration : Material garde les douze classes qu'il dessine bien. `aerial` passe à `maki/aerialway`, une cabine suspendue à son câble, là où `cable_car` est une cabine à pieds qui se lit comme un bâtiment à 22 px. Les deux jeux sont en **CC0 1.0** — dédicace au domaine public, donc aucune obligation d'attribution, contrairement à l'Apache-2.0 de Material et à son NOTICE à propager. `licenses/maki/` et `licenses/temaki/` existent quand même : consigner d'où vient une œuvre reprise est la discipline de ce dépôt, pas une contrainte de licence. Seule la chaîne `d` de chaque tracé est reprise, verbatim, dans la boîte de 15 unités de chaque jeu — jamais remise à l'échelle, ce qui serait un redessin. `cable_car` est retiré du dépôt, pas seulement laissé inutilisé, et le NOTICE de Material le dit.
- **Accueil du jeune enfant — le taux se lit sur le territoire, plus sur un point posé au milieu.** La couche dessinait ses deux échelles locales en pastilles au centre administratif de chaque zone. Un taux de couverture est une propriété d'un TERRITOIRE : posé sur une coordonnée il devient la propriété d'un centroïde — un champ à l'écart de la commune-siège pour une intercommunalité rurale, un point du 5e pour une Métropole — et rien à l'écran ne disait où le chiffre cessait de s'appliquer. Les 1 250 intercommunalités et les 1 061 communes sont désormais REMPLIES, en classification au sol, à partir des contours communaux de `geo.api.gouv.fr`.
- **Une intercommunalité n'a aucun contour publié : elle est peinte comme ses communes membres.** `geo.api.gouv.fr` ne publie pas de polygone d'EPCI et refuse une requête de contours non filtrée — 1 255 appels, 66 Mo, 3,1 millions de sommets (mesuré). Mais il publie `codeEpci` à côté de chaque commune, sans appel supplémentaire : le territoire d'une EPCI est donc dessiné comme ses communes membres, sous UNE seule couleur et sans liseré intérieur, pour se lire comme une zone et non comme une mosaïque. Ce qui manque est le trait extérieur de l'union, et rien ne l'invente.
- **Les deux échelles pavent le sol, elles ne se superposent jamais.** Sous 0,45° d'ouverture, chacune des 1 061 communes que la Cnaf publie est DÉCOUPÉE dans le lavis de son EPCI et remplie de son propre taux : chaque parcelle de sol porte exactement un chiffre, le plus fin publié pour elle, et le liseré blanc dit lequel. Deux fonds translucides ne peuvent donc plus se mélanger en une troisième couleur qui ne veut rien dire. Paris, Lyon et Marseille sont le cas dur — la Cnaf publie par arrondissement, `geo.api.gouv.fr` répond une commune unique — et l'arrondissement remplace sa commune-mère au lieu de s'y ajouter, la mère disparaissant entièrement du lavis.
- **Le service répond par BOÎTE, pas par département.** Les contours ne se récupèrent qu'un département à la fois en amont ; ils sont donc mémorisés entiers côté proxy et DÉCOUPÉS à la vue. Mesuré sur cinq villes, une boîte de 0,9° recoupe 4 à 18 départements — Paris étant le pire, ses départements étant les plus petits — donc servir les paquets entiers enverrait le Pas-de-Calais parce qu'un coin de l'écran l'a effleuré. Coût mesuré : **111 Ko pour une vue sur Lyon (32 Ko gzippés)**, et 2,03 Mo / 636 Ko dans le pire cas mesuré (1,3° sur l'Île-de-France, 2 261 communes, 4,5 s à froid et 9 ms à chaud). La boîte est calée sur une grille de 0,1° avant d'être demandée, donc un panoramique ne repose la question que toutes les quelques largeurs d'écran.
- **Le choroplèthe départemental descend jusqu'à la relève, il n'y a plus aucun zoom sans territoire.** Il répondait au-dessus de 9,5° parce que les pastilles prenaient le relais en dessous ; il tient maintenant jusqu'à 0,9°, où les territoires prennent la main. Le plafond est mesuré et non choisi : une boîte de 0,9° contient environ 1 450 communes, du même ordre que les lots de parcelles que cette application dessine déjà.
- **Un lot groupé de `GroundPrimitive` porte UNE couleur.** Cesium classe tout un lot en une passe de stencil, puis garde le premier instance dont le RECTANGLE ENGLOBANT contient le pixel — jamais le polygone. Les rectangles de communes voisines se chevauchent en permanence, donc un lot est constitué par couleur de bande (six au plus) et la sélection est un couple de primitives à elle, posé par-dessus. `npm run qa:petite-enfance-fr` le garde sur les pixels : le sol sous un territoire prend bien la couleur de SA bande, aucun anneau n'est dessiné deux fois, et le choroplèthe ne laisse aucune primitive derrière lui.
- **Ce que la carte ne dit plus.** La taille des pastilles portait le nombre de places, donc la couche répondait à deux questions à la fois. Un remplissage n'a qu'un canal et il va au taux — la question que l'indicateur existe pour poser. Le nombre de places reste sur chaque fiche, et l'alternative était une pastille flottant au-dessus de son propre territoire.
- Le découpage des contours communaux et la recherche « quels départements dans cette boîte » vivent maintenant dans `src/data/communeContours.js` et `src/data/franceDepartements.js`, partagés par la couche délinquance et la couche petite enfance au lieu d'être dupliqués. `delinquanceFeed.js` garde sa surface d'export et ses mesures ; ses suites de tests inchangées sont ce qui prouve que l'extraction est fidèle.

- The maillage thinning and the point-in-département lookup now live in
  `src/data/geoMeshThinning.js` and `src/data/franceDepartements.js`, shared by
  the charge-point and schools layers instead of duplicated. `irveMesh.js` and
  `irveDepartements.js` keep their full export surface and their measurements;
  their unchanged test suites are what prove the extraction was faithful.

- **The Data Layers panel is grouped and in French.** Thirty-four datasets no
  longer arrive as one flat list ordered by the accident of which PR merged
  first. They sit in **eight thematic groups** — *Air & espace, Défense,
  Maritime, Mobilité terrestre, Énergie, Risques & environnement, Réseaux &
  capteurs, Bâti & territoire* — each a collapsible section whose header carries
  its own tally (*"2/8 ON"*) and turns cyan while anything in it is live. Every
  group opens by default; a group you close is remembered, per group, across
  reloads.
- **Every row now reads in French.** *Live Flights* is **Vols en direct**, *Live
  AIS Vessels* is **Navires en direct**, *Mapped Installations* is **Sites
  militaires**, *Street Traffic* is **Trafic routier**, *Groupes de prod (FR)*
  is **Groupes de production**. The five `(FR)` suffixes are gone: a small
  **FR** / **US** / **VILLES** chip now says where a layer has data, once, on
  the sixteen rows where the answer is not "everywhere" — and nothing at all on
  a global layer, because a badge on every row is a badge on none. The panel
  widened from 280 to 320 px to hold the longer names on one line.- Added the **Bornes IRVE** layer — every public EV charge point France has
  declared, keyless. The *fichier consolidé des bornes de recharge pour
  véhicules électriques* is assembled daily by transport.data.gouv.fr from the
  operators' own filings and republished by **ODRÉ** under Licence Ouverte 2.0:
  231,079 points de charge, loaded per viewport, drawn as one dot per *site*,
  coloured by the highest power band installed there and sized by how many
  charge points are there. Clicking one gives the split by power, the
  connectors, the access conditions, the operators — and the span of that
  site's own declarations rather than the age of the poll.
- It is installed capacity, not availability, and says so. The register
  publishes where the charge points are, never whether any of them is free, so
  the layer draws no availability colour and prints no "libre" count.
- The register disagrees with itself in ways that a naive read gets visibly
  wrong, so seven of them are absorbed server-side and pinned against a
  captured payload:
  - `coordonneesxy` is **labelled backwards** — its `lon` key holds the
    latitude — on every row checked, and `geo_point_borne` is null on all
    231,079, so Opendatasoft's own geo filter matches nothing. Only the
    consolidated columns are read.
  - The station id fragments the station: Q-Park's Grande Arche car park
    publishes **127 station ids at one coordinate**, and 1,192 rows nationally
    publish the literal string `"Non concerné"`. The render unit is the
    coordinate, rounded to ~1.1 m.
  - 442 of 3,812 Île-de-France sites carry two "operators" publishing an
    **identical** power profile at the same point — 7.5% of the area's charge
    points, counted twice by any plain sum. Identical profiles collapse;
    overlapping ones never do; both totals travel to the client.
  - 3.0% of rows publish a power no charge point can have (771 rows at 7,360 —
    watts in a kilowatt column — and 5,315 at ≤ 0). Those are counted in an
    explicit *puissance non exploitable* band rather than rescaled by a guess
    that would turn a real 600 kW bank into 0.6 kW.
  - `consolidated_is_lon_lat_correct` is False for two different reasons. False
    with no verified commune (80,545 rows) means *unverifiable* and is kept;
    False with one (5,361 rows) means the position contradicts its own commune
    and is withheld and counted. Reading the flag as one thing would either
    discard a third of France or leave a Gironde site drawn south of Madagascar.
  - Booleans arrive in nine forms including `"False"`, which JavaScript coerces
    to `true` — that alone would report every paid site as free.
  - Some publishers ship Mac-Roman accents decoded as Latin-1, which would
    split one legend row into four.

- **Bornes IRVE** gained its middle regime — the *maillage*. The layer now
  answers at three scales instead of two: the 96 départements while the whole
  country is in view, real site positions thinned onto a 30 × 20 grid once
  France is cropped, and every site with full detail over a city. Only one is
  ever drawn, and each carries its own legend.
- The thinning is spatial, not by rank: every occupied grid cell gets a dot
  before any cell gets a second, so the Massif Central stays visible as sparse
  rather than vanishing. Taking the biggest N instead would have collapsed
  France to a dozen conurbations.
- And each cell is represented by its most common band rather than its biggest
  site. Picking the largest drew **46.2% of the dots as high-power DC when
  12.2% of the sites in view were** — the biggest site in a rural cell is the
  motorway bank — which made the map say France runs on 300 kW chargers when
  it runs on 22 kW ones. The modal rule brings that to 8.7% against 12.2%
  true. The residual (`normale` at ~46% against 36%) is stated in the legend
  rather than hidden.
- The national point set is served once (`/api/irve-fr/mesh`, 39 579 tuples,
  0.9 MB, cached a day) and picked in the client, so panning the maillage
  costs no round trip.
- The layer's share-link token is **`8`**, not the `l` this work was originally
  written against: `l` went to **Centrales EDF** while the branch sat unmerged,
  and two layers on one token is a share link that silently enables the wrong
  one. Links written before this lands never carried an IRVE token at all, so
  nothing in the wild changes meaning.

- **Clicking a parcel now answers what is on it, not only where it is.** The
  card leads with the **address** (Base Adresse Nationale, keyless, Licence
  Ouverte 2.0) and carries **what is built there** from IGN BD TOPO — the
  building count, their footprint, the share of the parcel they cover, the
  tallest, the storeys, the dwellings and the dominant use — plus the parcel's
  own longest dimension. `24 Rue Paul Valéry 75116 Paris · 1 bâtiment · 1 026 m²
  au sol · 83 % de la parcelle · R+7 · 25 logements`.
  - **Neither join is published, and both lines say so.** BD TOPO and the PCI
    are two products with two lineages and no key between them, so a building
    belongs to the parcel its footprint centre falls on — a stated rule the card
    names, wrong in both directions at a boundary. BAN answers with the NEAREST
    address point, so the distance it publishes is printed beside the address
    past 10 m and the answer is dropped entirely past 60 m: on a card whose
    subject is which piece of ground you are looking at, a confidently wrong
    address does more damage than a missing line.
  - **A building near a tile edge is in both tiles.** Measured over Paris 16e: a
    naive join of two z15 tiles reported 25 buildings on a parcel that has 14,
    with one identifier appearing three times at 2 983, 13 and 5 042 m². Vector
    tiles carry a buffer. Deduplicating on `cleabs` — present on 100% of the
    1 202 features in a sampled tile — is the difference between 89% built and
    56%.
  - Both lookups run only on a click, are memoised per parcel, and fail as
    absences: the cadastre's own card is complete and correct without either.

### Fixed

- **Clicking a parcel highlighted a shape somewhere else.** Selection asked
  Cesium what was under the cursor, and `scene.pick` against ground-
  classification geometry answers with whichever shadow volume the ray enters
  first — which at the grazing angles this globe is normally flown at is not
  reliably the parcel visible under the pointer. The polygons are already in
  memory, so a click is now resolved against them directly: exact, independent
  of the classification pass, and testable without WebGL. Clicking a courtyard
  or a street selects nothing, which is the honest answer — the gaps in this
  layer are the public domain, and answering with the nearest parcel would
  invent one where France publishes none.
- **A pan dropped the selection and left the card behind.** Rebuilding the
  records on a new viewport cleared `_selectedId` without clearing the overlay,
  so the card stayed on screen describing a parcel that was no longer drawn,
  no longer highlighted and no longer clickable. The selection is now matched
  back by IDU after a redraw, and cleared with the records when the parcel has
  genuinely left the box.
- **The layer would not load at street level on a tilted camera.** The viewport
  gate read the span of `computeViewRectangle`, which on a TILTED camera returns
  everything the lens can see down to the horizon — a statement about the pitch
  far more than about how close the operator is. Measured in the app at 240 m
  over Paris: 0.0038° of longitude looking straight down, 0.0084° at 45°, and
  **0.0397° at 25°** — the same altitude, a tenfold spread. This globe defaults
  to an oblique view, so the layer refused to draw while the operator stood in
  the street with the parcels in front of them, and the row told them to zoom in
  when they already had.
  - The gate is now the camera's **altitude** (≤ 1 500 m), which is stable under
    pitch, and the row says "Descends sous 1 500 m" rather than naming a span
    the operator cannot see.
  - The request is a ≤ 0.02° box anchored on the point the **middle of the
    screen** meets the globe, clipped to the view. Under a nadir camera the view
    is the smaller of the two and the box IS the view, so nothing off-screen is
    ever requested; under a tilt it is the near and middle ground around what is
    being looked at, and the far half of the screen — where a parcel is well
    under a pixel — is not asked for. Anchoring on the camera's own position
    instead would load the ground behind the operator's shoulder.
- **And the proxy then rejected its own client.** Because the anchored box is
  exactly the client ceiling on both axes above a few hundred metres,
  `snapBoxOutward` — which moves all four edges out by up to a full grid step —
  reliably pushed it past a proxy bound that only allowed one step of growth.
  The layer 400'd at 400 m, 800 m and 1 200 m over Paris while working at 240 m,
  which is the shape of a bug that a span-sized box had been hiding. The bound
  now allows two steps for the snap and a third for floating point.

Verified over Paris 16e on the oblique view that reported it: 2 393 parcelles at
239 m, 4 426 at 800 m, 3 736 at 1 400 m, and the guidance line above that.

- **The Événementiel-DIR road-events attribution was never rendered** — the
  same merge shape that erased the power grid's ODbL notice a week earlier.
  Two branches each appended a credit at the same point in `DATA_CREDITS`, and
  the three-way merge kept both bodies but lost the `},\n  {` between them, so
  `bison-fute-events` and `irve-charge-points` shared one object literal and the
  second `key`/`html` pair silently overwrote the first. The road events layer
  has been drawing Licence Ouverte data with no entry in the attribution
  popover. Both are now separate objects.
- **And the shape is now caught rather than found by accident.** Twice it took
  someone adding an unrelated credit next to it to notice, because every
  runtime invariant still holds: the array is well formed, every entry has a
  key, no key is duplicated — it is simply one entry shorter.
  `src/data/dataCredits.test.mjs` reads the source and asserts the number of
  `key:` and `html:` properties matches the array length, which is the only
  place the evidence survives.
### Fixed

- **234 road-status "segments" were points wearing a segment's shape.** Their
  referential row publishes a start equal to its end, and they were being written as
  four-number segments and handed to Cesium as zero-length ground polylines — geometry
  it cannot stroke. They are now written as single points, which is what makes the
  renderer draw them as the 25 m stub a positioned station with no extent deserves.
  The segment count falls from 842 to 608 and nothing is lost: the difference was never
  234 roads.
- **A rebuild of the road-status index reported Brittany as unlit.** The coverage table's
  `fromPointRepere` counted what a run had newly placed rather than what the file held,
  so the second build against an already-complete index reported zero for Nantes,
  Rennes, Saint-Brieuc and Lorient–Vannes on a day nothing about them had changed. It
  now counts from the committed record, and the assertion that guards those four cities
  survives a re-run.
- **One refused tile took the whole Bâti 3D layer down.** A city-sized viewport is 24–60
  separate requests to the Géoplateforme, a free service that rate-limits at 400 req/min
  and answers 5xx under load; they were gathered with `Promise.all`, so a single refusal
  rejected the entire load, blanked the buildings and put the layer into a 20 s→4 min
  backoff with fifty-nine good tiles in hand. This is why the layer failed to load on
  the hosted deployment and not on a laptop. A refusal is now per-tile: the squares that
  answered are drawn, the shortfall is counted, the row reads *"N tuiles BD TOPO refusées
  sur M — bâti incomplet, nouvelle tentative"*, and the layer asks again. Only every tile
  refusing is still a failure — there is nothing to draw then. A partial answer is marked
  DEGRADED and never passes as a whole city.
- **A school's name depended on how far you had zoomed.** The national *maillage* pack
  ships coordinates and not names on purpose — carrying them takes it from 1.66 MB to
  5.42 MB — so a dot clicked at region scale produced a card titled "Établissement" and
  an instruction to zoom in, while the same school two zoom steps closer was "Collège
  Jean Moulin". A click now asks the register for that one coordinate and the card
  becomes the full one, name included; the answer is remembered for the session, so
  re-clicking costs nothing. Where several UAIs share an address — 2,212 SEGPA and SEP
  sections nationally sit at their parent's coordinate — the dot's own level picks
  between them and the card says how many others are there.
- **DETECT described schools by their level or their roll, never by their name.** A
  callout read "412 élèves", which names nothing, or "École", of which a district has
  hundreds. It now reads the establishment's published name — "Collège Jean Moulin" —
  prefixed with its level only for the 2.6% of register names that do not already state
  one ("Lycée · Institution Saint-Pierre").
- **Deux satellites FIRMS sur trois disparaissaient les jours de grande activité, et la
  couche avait l'air en bonne santé.** `fires.push(...records)` passe un ARGUMENT par
  détection, et V8 refuse au-delà d'environ 124 300 (mesuré ici sur Node 26.0.0, le
  seuil exact dépendant de l'état de la pile). Un tirage `world/2` en rend ~131 000 pour
  NOAA20 et SNPP : les deux levaient `RangeError`, attrapé juste en dessous comme une
  panne d'amont, et seul NOAA21 — 114 000, sous la limite — survivait. Compte mondial
  mesuré en amont : **113 996 → 377 169**. La boucle passe par `appendAll`, et l'entrée
  `ok:true` n'est plus écrite qu'une fois les détections effectivement rangées : elle
  partait AVANT, donc une source qui échouait était listée deux fois, `ok:true` avec son
  vrai compte puis `ok:false`, et `/api/firms` annonçait des détections qu'il n'avait
  pas gardées. Correctif d'amont repris et étendu (bilawalsidhu/gods-eye-view#93).
- **Six plafonds de réponse comptaient des caractères là où ils annonçaient des octets.**
  `body.length` compte des unités de code UTF-16 : trois octets d'euro en valent un, donc
  un corps non latin pouvait tenir à près du triple d'un plafond et le passer. Pire, le
  test arrivait APRÈS `await response.text()`, c'est-à-dire après l'allocation qu'il
  existe pour empêcher. Les six sites — GBFS, le lecteur partagé des six scans d'adresse
  (Géorisques, DVF, DPE, GPU, isochrones, IDFM), NDBC, et le repli non diffusé de CCTV —
  passent par `readResponseTextCapped`, qui refuse sur `Content-Length`, compte en octets
  pendant la lecture et annule le flux au dépassement. Il servait déjà 14 appels dans le
  même fichier. Il relâche aussi la socket quand il refuse sur l'en-tête, au lieu de la
  laisser ouverte jusqu'au GC. Le repli CCTV était une seconde implémentation presque
  identique de ce lecteur, portant le bug que la version partagée n'a pas ; il n'en est
  plus qu'un adaptateur.
- **Un tirage FIRMS n'avait aucun plafond du tout.** `res.text()` lisait le CSV mondial
  sans limite. Il est plafonné à 256 Mo — un ordre de grandeur au-dessus des ~13 Mo que
  pèsent 100 000 détections, donc il ne peut se déclencher que sur un amont qui a changé
  de forme.
- **Les paquets Natural Earth et quartiers chargeaient par deux chemins selon le
  runtime.** Une branche `isNode` importait dynamiquement `node:fs`, ce que Vite
  externalisait avec un avertissement à chaque build de production. L'attribut d'import
  fait le même travail dans les deux runtimes et la branche disparaît, avec un test de
  frontière qui empêche un import `node:` de revenir dans un module construit pour le
  navigateur. Correctif d'amont repris tel quel (bilawalsidhu/gods-eye-view#83).

### Security

- **Le proxy GBFS validait une URL, puis en récupérait une autre.** L'hôte, le chemin et
  le protocole étaient vérifiés sur l'URL demandée par le client — puis `fetch()` suivait
  les redirections tout seul. Un flux de la liste blanche répondant
  `302 Location: http://169.254.169.254/…` suffisait à faire récupérer cette adresse par
  le serveur et à en renvoyer le corps, tous les contrôles ayant déjà été dépensés. Le
  proxy suit désormais les redirections à la main, en réappliquant la liste blanche à
  chaque saut (`gbfsRedirectTarget`), avec trois sauts au maximum et une seule échéance
  pour toute la chaîne — un flux ne peut pas gagner du temps en rebondissant. Même
  posture que le proxy Radio Browser, qui refusait déjà les redirections.

### Changed

- **Un visiteur froid tirait 5,06 Mo de l'origine à chaque visite, et le cache de Cloudflare n'en gardait rien.** `vite preview` — ce que fait tourner un déploiement — code en dur `Cache-Control: no-cache` sur chaque fichier qu'il sert. Mesuré sur l'origine hébergée : `cf-cache-status: BYPASS` sur tous les assets, donc l'edge ne stockait rien et chaque première visite traversait le tunnel jusqu'à Paris, où que soit le lecteur. Deux familles d'URL sont pourtant immuables par construction et le disent désormais : `/assets/*`, dont Vite écrit le hash de contenu dans chaque nom, et le paquet Cesium. La liste est délibérément une allowlist courte plutôt qu'une exclusion — un futur asset reste non caché tant que personne n'y a réfléchi, jamais gelé un an par inadvertance. `index.html` garde son `no-cache` : c'est la carte qui mène des noms hashés au contenu, et une copie périmée épinglerait un visiteur sur un bundle qui n'existe plus.
- **Le chemin Cesium porte sa version, sans quoi la promesse d'un an aurait été un mensonge.** `vite-plugin-cesium` recopie la sortie de build du moteur telle quelle sous une base unique, et aucun de ces noms de fichiers ne porte de hash : `/cesium/Cesium.js` désignait donc 6 Mo différents après chaque montée de version. Le répertoire est maintenant `/cesium-<version>/`, donc l'URL change quand ses octets changent. Rien dans l'arbre n'écrit ce chemin en dur — le plugin définit `CESIUM_BASE_URL` pour le chargeur de Workers et d'Assets, monte la route de dev au même endroit, et écrit la balise qu'il injecte depuis la même valeur.
- **Le moteur Cesium ne bloque plus l'analyse du HTML.** Il était injecté comme script classique dans `<head>` : la plus grosse chose de la page — 1,63 Mo sur le fil, 6 Mo une fois analysés — et l'analyseur s'y arrêtait net, si bien que les 55 ko de balisage en dessous et la feuille de style derrière attendaient tout le téléchargement puis toute l'exécution. `defer` le place sur la même liste d'exécution-après-analyse que le bundle module, et cette liste respecte l'ordre du document : la balise injectée est au-dessus de `/assets/index-*.js`, donc `window.Cesium` est défini quand la première ligne de l'app le lit.
- **Les fichiers `.geojson` partaient non compressés, et c'était une histoire de plus au lieu de barre oblique.** mrmime les type `application/geo+json` et le filtre de compression de Vite teste `/text|javascript|\/json|xml/i` : `+json` n'est pas `/json`, donc le test échouait et le fichier sortait brut. Mesuré sur `departements.geojson` : **254 348 octets, puis 83 593** une fois relabellisé `application/json` — ce que ces fichiers sont, puisque rien d'autre que `JSON.parse` ne les lit. La même passe pose `Vary: Accept-Encoding`, que le middleware de compression n'annonçait jamais : sans conséquence tant que rien ne cache, mais avec un cache edge devant, c'est une invitation à servir un corps gzip à un client qui n'en a jamais demandé.
- **Le HUD tirait 1,77 Mo de grille pour corriger un chiffre, et c'était le plus gros objet expédié — plus gros que le moteur Cesium.** L'altitude que Cesium rapporte est ELLIPSOÏDALE, celle qu'un lecteur attend est au-dessus du niveau moyen des mers, et l'écart N vient de la grille EGM96 embarquée (2,77 Mo, 1,77 Mo sur le fil, à peine compressible). Le HUD étant visible par défaut, sa première tick de télémétrie traînait cette grille entière dans le démarrage de chaque visiteur. N arrive désormais de `/api/geoid`, une cellule grossière à la fois, calculé côté serveur par **le même paquet** : le nombre est identique au bit près, pour une cinquantaine d'octets. Mesuré sur sept démarrages à froid bridés : **5 187 ko → 3 359 ko d'octets depuis l'origine de l'app, soit −35 %**, une mesure sans bruit (5 187 exactement à chaque run). Le temps de démarrage ne bouge pas : ces 1,8 Mo se téléchargeaient en parallèle des tuiles sans rien bloquer — le gain est en octets et en egress, pas en vitesse.
- **La grille reste embarquée, parce que six modules de couches ne peuvent pas s'en passer.** `flights`, `militaryFlights`, `aisLiveVessels`, `bdtopoBuildings`, `terrainHeights` et `ignBilTerrain` la lisent en processus — le dernier fait des milliers de lookups SYNCHRONES par tuile de terrain, ce qu'aucun réseau ne peut servir. Ce qu'ils ont en commun : aucun n'existe avant que sa couche soit activée, c'est-à-dire exactement quand payer la grille est honnête. C'est pourquoi la retirer du HUD la retire du démarrage sans la retirer à personne. Le mode de défaillance du HUD est inchangé : un endpoint injoignable résout à `null`, `ellipsoidalToMslDisplayM` laisse passer la hauteur ellipsoïdale brute, et l'affichage est non corrigé plutôt que faux. En traversant une cellule, l'ancien N est conservé pendant que le nouveau arrive — les cellules voisines diffèrent de centimètres, alors que blanchir la valeur ferait sauter le chiffre de plusieurs dizaines de mètres le temps d'une tick, c'est-à-dire l'artefact même que ce datum existe pour supprimer.
- **Un vol de caméra coûtait 29 Mo de tuiles, pour raffiner des images destinées à être remplacées.** Cesium raffine le globe jusqu'à `maximumScreenSpaceError` à chaque image, y compris celles d'un vol : le vol d'intro descend quatre secondes à travers toute la pyramide de zoom au-dessus d'un seul point, donc le globe se raffinait à pleine finesse à chaque altitude traversée et jetait chaque niveau une image plus tard. Mesuré sur un démarrage à froid du build expédié : 178 tuiles OSM réparties de z1 à z17 et 190 tuiles de terrain de z0 à z14. La tolérance d'erreur est maintenant relâchée pendant que la caméra bouge et **rendue à l'identique dès qu'elle se pose** : la valeur au repos est celle que Cesium avait, capturée à l'installation et jamais supposée, donc ce gouverneur ne dégrade jamais une image fixe. Sur un vol de quatre secondes entre villes françaises, médiane de cinq vols : **826 requêtes / 29 Mo → 438 requêtes / 14,4 Mo**, des plages qui ne se recouvrent pas.
- **Sur un démarrage à froid, ce même gouverneur ne vaut que −2,7 %, et c'est la mesure qui compte.** Sur une fenêtre fixe de vingt secondes, une fois la caméra posée, la vue finale charge ses tuiles de toute façon : le gain porte sur le déplacement, pas sur l'arrivée. Un premier relevé isolé suggérait −35 % ; c'était un artefact de fenêtre de mesure, pas un résultat.
- **Une optimisation a été mesurée puis retirée.** Reporter le chargement de la grille EGM96 sur `requestIdleCallback` n'a rien donné — 5 352 ms contre 5 674 ms jusqu'à l'app prête, à l'intérieur d'une bande de bruit de ±900 ms. Décaler des octets ne les supprime pas. La piste est notée ici pour qu'elle ne soit pas retentée comme une évidence.


## [Unreleased] — 2026-08-31

### Added

- **Every live transit vehicle now carries the operator's own delay and
  disruption.** All 150 French vehicle-position feeds have a `TripUpdate`
  companion in their own dataset — and **63 of them ARE that companion**,
  publishing both in one protobuf body, so for those the delay is bytes already fetched rather than a
  second request. The dev-server proxy joins that prediction to the vehicle
  already on screen and sends four things with it: how far off the timetable the
  operator says the run is, whether the run has been **cancelled**, which of its
  remaining stops it will **skip**, and the operator's own sentence about its
  line from `Alert` (60 feeds carry them). The card reads *"🕘 9 min late"* and
  *"⚠ Bordeaux : travaux quai de Paludate (this line · detour)"*, the ambient
  contact label reads *"LN 15 +9m"*, and the control-panel row says *"1 network ·
  25 late"* without a click. Measured 2026-08-31 over the 30 largest live
  networks (1,865 vehicles): **67% of vehicles join a trip update** by `trip_id`,
  a further 2% only by vehicle id, and **38% end up with a deviation**. The gap
  is not a join failure — 17 of those 30 networks publish an absolute predicted
  `time` and never a `delay`, and converting one to the other needs the 223 MB
  `stop_times.txt` this project refuses to load. Those vehicles read *"run
  tracked · no delay published"* instead of showing zero, because a viewer must
  be able to tell "on time" from "nobody said".
- **A bus parked at its terminus is not fifty-six minutes early.** A vehicle
  waiting for a departure an hour away publishes a predicted arrival of "about
  now" against a scheduled arrival an hour ahead, and the deviation the operator
  computes is −3,361 s. Printed as punctuality that reads *56 minutes early*,
  which is not a thing a bus can be. `transitSchedule.awaitingDeparture` catches
  it — stopped at the first stop of its own run, ahead of schedule — and reports
  *"🕘 waiting to depart · due out 22:46"* instead. Over one Bordeaux viewport
  that is the difference between a summary claiming **28 early** and one saying
  **7 early, 13 waiting**. The rule is deliberately one-sided: a vehicle at its
  first stop running LATE has an overdue departure, which is real lateness.
- **Which resource carries a network's delays is now measured, not guessed.**
  The PAN catalog never says which trip-update resource pairs with which
  position feed, and a dataset can publish several of each — Astuce ships three
  position feeds and four trip-update feeds, one per operator, on interleaved
  ids. `scripts/build-pan-gtfs-rt-index.mjs` now probes the candidates and keeps
  the one whose trips actually **join this feed's own vehicles**, committing the
  measured join rate alongside. Adjacent resource ids are only the ranking hint:
  they pair TaM's urban and suburban feeds correctly and get Astuce wrong, where
  measurement scores the right body at 90%. Mean measured join rate across the
  79 networks with vehicles running at build time: **0.92**.
- **Aéroports: 7 464 places to land, France in full.** A new bundled layer
  draws the world's airports and aerodromes from **OurAirports**, the open
  catalogue its volunteer editors dedicate to the public domain. Cards carry the
  **ICAO and IATA codes**, the class, the **longest open runway** in metres with
  its surface family, and the commune — Roissy at 4 215 m of asphalt, an 82 m
  strip at La Tour-du-Pin, and 7 462 more in between. Bundled with the build, so
  it draws with **no key and no network**.

  The pack is a **selection, and the selection is asymmetric on purpose**:
  worldwide it is every large and medium airport plus everything that sells a
  scheduled seat (which is what keeps Monaco's heliport and the Greenland
  shuttles), while **France and the overseas territories carry the whole long
  tail** — 1 335 fields, altiports, hydrobases and one balloon field included.
  Shipped whole, the catalogue is 86 002 rows and roughly 25 MB of committed
  JSON, 23 196 of them heliports, and in France almost every one of those is a
  hospital landing pad with no ICAO code. The four clauses that decide what
  survives live in `src/data/airportsPack.js` — the same module the layer reads
  back when it writes a card, so the build and the globe cannot disagree about a
  field — and `airports/README.md` states the limit plainly: a small airfield
  missing outside France was **not selected**, and is not evidence of an empty
  sky.

  **Importance is a map channel, not a footnote.** Seven thousand identical dots
  is a wall, and this pack is the opposite of uniform. Two independent fields
  decide how much an airfield matters — OurAirports' editorial **size** class,
  and the hard fact of whether a **timetabled service** calls there — so
  crossing them gives four tiers: **Grand aéroport** (1 172), **Aéroport de
  ligne** (3 175), **Aéroport sans ligne** (1 991) and **Aérodrome & aéroclub**
  (1 126, all of them French, because the clause that admits them is). The tier
  is decided once and then drives everything: the dot size (14 → 6 px), the
  colour ramp, the label ladder, the legend, and **how far out the card stays
  readable** (14 000 km → 200 km). That last channel is the one that fixed the
  real problem: over Île-de-France the shared label grid was awarding fifteen
  cells to aéroclubs and three to Roissy, Orly and Le Bourget, because cells are
  awarded *locally* and a grass strip with no competition always wins its own.
  Priority cannot fix that; range can. The marker is always drawn — only its
  name waits until you come closer.

  Four chips on the layer row cut to the tier you want — `TOUS`, `AÉROPORTS`
  (drops the aéroclubs), `LIGNES` (only what a ticket is sold to), `GRANDS`.
  They are runtime params, **not** share-link state, and the layer keeps
  reporting all 7 464 features while a floor is on: a chip hides markers without
  losing them, the same contract the hydro layer's `floorKw` already follows.
  The legend counts what is **drawn**, not what is loaded, so a hidden tier
  reads 0 and says how many it is holding back rather than quietly overstating
  the picture. The grading itself is generic — `createLocalGeoJsonLayer` now
  takes an optional group/style/filter/legend contract, and the three other
  bundled packs are untouched by it.

  Three values in the pack are easy to misread and are labelled rather than
  cleaned up. `runways.count` counts upstream runway *records*, helicopter lanes
  included — Charles de Gaulle reports 5, of which four are its paved runways.
  `type` is OurAirports' editorial **size** bucket and does **not** map onto the
  French regulatory ladder. And `runways.surface` is a three-value family
  (`revêtue` / `non revêtue` / `eau`) collapsed from 557 free-text spellings
  across 48 203 runways; 22% of features carry no surface at all rather than a
  guess.

- **Click a live bus and see the line it is running.** Selecting a vehicle in
  **Transit FR** now draws its **route trace on the ground in the operator's own
  colour**, marks **every stop of the run it is on**, and adds to the card the
  line's public name, the stop it is heading for with a countdown and schedule
  deviation, and its terminus. Bordeaux's Lianes 35 draws as a 32 km loop with
  its 82 stops and reads *"▸ Avenue de l'Europe · due · 5 min late / ⇥ Gare
  Saint-Jean · 67 stops"*. Escape puts it all away again.
- **The two halves of that answer come from two feeds, and degrade separately.**
  The **trace, the line's name and its colour** come from the network's static
  GTFS — through the PAN's own **GeoJSON conversion** of it, so `shapes.txt`
  (36.7 MB compressed for Normandie) is never downloaded; the **ordered stops
  and their predicted times** come from the network's live **GTFS-RT
  TripUpdates** feed, which every one of the 142 datasets publishing vehicle
  positions also publishes. A network with no usable trip update still gets its
  line drawn, from `route_id` alone, and the card says the stops are not listed.
- **Which of a line's traces the run is on is measured, not guessed.** A French
  line publishes several shape variants and the conversion drops `shape_id`, so
  the layer picks the variant that carries **every one of the trip's own stops**
  — measured against all 897 of TBM's running trips on 2026-08-31, all 897
  matched at a median stop-to-trace offset of 3 m. When no variant fits, the
  **whole line** is drawn instead of one run of it and the card says so.
- **`npm run transit:static`** builds `config/pan_gtfs_static.json` (196 KB,
  URLs only): for each of the 148 queryable vehicle feeds, its TripUpdates
  sibling and its static GTFS's GeoJSON conversion. Geometry itself is fetched
  on demand and cached under `.gev-cache/pan-gtfs-geo/` — a first click on a
  network costs 0.87 s, every later one 18 ms.
- **A new layer: the State's own traffic sensors on the French national road
  network.** `Road Status FR` (`road-status-fr`) draws **830 segments, 918 km**
  of the non-conceded RRN, coloured every 60–360 s by the sixteen DIR
  traffic-management centres' own DATEX II `trafficStatusValue`, and carries the
  one measurement TomTom has no equivalent of at any price: a **vehicle count**
  — veh/h and average km/h per station, from Bison Futé's six-minute national
  snapshot. Keyless and Licence Ouverte 2.0, so on a build with no
  `TOMTOM_API_KEY` — where the traffic layer runs its simulation — this is the
  only measured congestion data on the globe. It is brightest exactly where
  `Transit FR` is dark: Marseille (186 segments), Toulouse (127), Lyon (106) and
  Saint-Étienne (100) publish no live bus at all.
- **The geometry is built offline, because the published referential is three
  traps.** `npm run road-status:index` commits
  `config/datex_traficolor_sites.json` (178 KB, 1 195 sites, 832 located).
  `refDir.csv` is in **Lambert-93**, so `scripts/lib/lambert93.mjs` reprojects
  it — deriving the projection constants from its defining parameters and
  asserting them against IGN's published NTG_71 values rather than pasting
  numbers a typo would turn into a silent kilometre. It is **regenerated every
  six-minute cycle with a moving row set** (1 197 stations in one cycle, 1 192
  in the next), so the build UNIONS successive cycles instead of trusting one.
  And it **declares twenty columns while publishing nineteen** on every row, so
  the parser reads positionally: a header-zipped read puts `nb_voies` in the
  easting and makes most of the network look unlocatable, which it is not.
- **Two different kinds of empty, kept apart.** Île-de-France has no publisher
  at all — the DIRIF appears in neither publication, verified three ways — while
  Lille, Nantes, Rennes, Saint-Brieuc, Lorient–Vannes and Nancy–Metz publish a
  live colour for **1 046 sites whose position nobody publishes**. A viewport
  over Lille now reads "357 live road states published under site ids that are
  in no national referential row" instead of a blank that looks like a bug, and
  `roadStatusCoverage.test.mjs` cross-checks every such claim against the built
  index so a DIR that starts publishing coordinates fails the suite rather than
  leaving a city wrongly dark.
- **Nothing is inferred from the count.** A located station no traffic centre
  watches stays grey and reads `Not reported` rather than being folded into free
  flow; where two centres report one site the WORSE state wins; flow and speed
  are labelled **6-min average**, never as an instantaneous reading; and a
  station that counted nothing says so instead of printing "0 km/h" — 114 of
  1 192 stations at 22:30 CEST, which is a fact about the hour, not a jam.
  Proven end-to-end by `npm run qa:road-status-fr` (18 checks) and 44 new unit
  tests.
- **Live French transit vehicles now say what they ARE.** GTFS-Realtime carries
  no vehicle class, so `npm run transit:route-types` joins each network's static
  GTFS `route_type` and commits `config/pan_route_types.json` — 147 feeds, 7,044
  routes, 195 KB. It reads **one member** out of each remote archive
  (`routes.txt`, 8.7 KB inside Bordeaux TBM's 26.7 MB / 250 MB-expanded feed)
  via HTTP range requests where the publisher allows them, so the national build
  transfers ~136 MB instead of ~1.5 GB. A Bordeaux viewport now separates its
  **67 trams and 3 Garonne river shuttles from its 358 buses**, coloured and
  labelled per class. Measured 2026-08-31 the join types **92.7% of the national
  live fleet**; the rest keep a neutral glyph and read `Type unknown` rather than
  borrowing their network's service class, which is a different question.
- **Transit vehicles are drawn as vehicles.** Each class now renders with its
  **Material Symbol** (Apache-2.0, vendored path by path under
  `licenses/material-symbols/`): a bus with a windscreen and headlights, a tram
  with its pantograph, a river shuttle as a boat, a métro, a funicular, a cable
  car. An earlier pass drew hand-made plan-view silhouettes and they were
  internally consistent and unrecognisable — recognition beats invention. The
  icons are FRONT views and so are never rotated; the operator's bearing is
  drawn instead as a small wedge that ORBITS the icon on its own billboard, so
  a bus stays a bus while still showing which way it is going. A vehicle whose
  feed publishes no bearing has no wedge, which is the same statement the bare
  disc used to make.
- **The road layer reaches metro altitude.** `trafficBounds.ROAD_FETCH_TIERS`
  replaces one fixed 0.05° fetch box with three altitude bands, the coarsest
  drawing arterials across a **0.30° (~33 km) box up to 30 km** — where it used
  to switch off at 8 km. Animated road traffic and the live transit fleet can
  finally share a frame over a whole French métropole: measured over Bordeaux,
  1,605 road dots and 356 live vehicles at once. The coarse band is cheaper than
  the street band it sits above (1,929 ways vs 3,701). Two new scene recipes,
  **Bordeaux Transport Pulse** and **France Transit Showcase**, are written
  against those bands.
- **The layer says where it has nothing, and why.** `src/data/transitCoverage.js`
  records the measured French coverage map — Paris intra-muros, Lyon, Marseille,
  Lille and Strasbourg had **zero** live vehicles at a Monday peak on 2026-08-31,
  because Île-de-France Mobilités publishes no GTFS-Realtime at all, Marseille
  publishes alerts only and Tisséo trip updates only. An empty viewport there now
  names the publisher and points at the nearest city that works, instead of
  reading "no PAN feed covers this view" and looking like a bug. A unit test
  cross-checks every "dark" claim against the shipped feed index, so an operator
  that starts publishing breaks the build.
- **The shipped PAN index deduplicates and quarantines itself.** Some networks
  publish one body under two resource ids — Kicéo's twin returned the same 59
  vehicles, drawn twice. `src/data/panFeedHealth.js` finds candidates by
  positional fingerprint and confirms them on a second probe **by roster only**,
  because the fleet moves between probes. A run of failed probes takes a feed out
  of viewport selection without deleting it, and any success revives it.
  `/api/transit-fr/feeds` now reports shipped and queryable counts side by side.

- **Événements routiers (FR): what the road operators themselves declared.** A
  new layer in **MOBILITÉ TERRESTRE**, keyless, Licence Ouverte 2.0, through a
  new `/api/bison-fute` proxy. It draws `Événementiel-DIR` — the national DATEX
  II aggregate every Direction interdépartementale des routes publishes its
  event log into. On the snapshot it was built against that was **286 situations
  holding 600 records**: nine accidents, one queue, 48 obstructions, 184
  roadworks orders, four closures and the diversions posted around them, across
  eight categories with their own legend.

  It is the companion to **Road Status FR**, which landed the same week and
  reads this publisher's OTHER product: that layer draws how the network is
  *flowing* (Traficolor status, veh/h, km/h), this one draws what has been
  *declared to have happened on it*. Neither reads the other's feed.

  Three decisions are the layer:

  - **One situation, one marker.** DATEX II nests up to twelve records inside a
    single situation — the accident, the two lanes it blocked, the four exits
    now closed. Drawing them all would put one crash on the map twelve times,
    so the CAUSE is drawn and the consequences are counted on its card
    (`+ 5 déviations`). An accident outranks the lane closure it caused; a
    diversion only wins when a situation is nothing but diversions.
  - **Planned is not happening.** 68 of the 286 had not started yet — works
    ordered for October. They are hidden by default, drawn dimmer and smaller
    under the `+ À venir` chip, and a globe that painted next month's roadworks
    over tonight's traffic would be saying something false about now.
  - **Ended means ended.** A rockfall opened on 31 January, cleared in March,
    and published with **no end time at all** — only the operator's lifecycle
    flag says it is over. Read on its validity window it has been blocking the
    N20 for seven months. The flag wins.

  The layer covers the **réseau routier national non concédé** and says so. The
  conceded motorways — the whole ASF/APRR/Sanef network — are not in this feed
  at all; Bison Futé serves them under the credentialed *Action b* / *Action c*
  licences, and their absence is a property of the source rather than a gap the
  layer hides. Two further caveats are stated rather than hidden: a `Linear`
  event publishes only its two endpoints, so a segment is the straight chord
  between them (median 1.77 km on the capture; the card says so past 10 km), and
  records the feed marks `probable` or `riskOf` are labelled unconfirmed.

  Under the hood: `bisonFuteFeed.js` holds a ~90-line DATEX II reader (no new
  dependency), the situation classifier and the primacy ordering, pinned by 17
  unit tests against a real captured document — including the rockfall with no
  end time and the situation whose internal operator notes must not reach a
  public globe. The proxy refreshes with `If-None-Match`: the origin serves ETag
  and gzip (3.3 MB → 165 KB) and answers a conditional GET with a 304, which is
  what makes a five-minute poll of a 3.3 MB document affordable.
  `npm run qa:bison-fute` proves the rest in a real browser.

- **Every data layer now knows what it is.** A new `src/data/layerTaxonomy.js`
  gives all 28 registered layers a category — **AIR & ESPACE**, **DÉFENSE**,
  **MARITIME**, **MOBILITÉ TERRESTRE**, **ÉNERGIE**, **RISQUES &
  ENVIRONNEMENT**, **RÉSEAUX & CAPTEURS** — plus three facets: coverage
  (`global` / `fr` / `us` / `cities`), auth (`none` / `free-key` / `metered`)
  and cadence (`live` / `periodic` / `static`). The table is cross-checked
  against the registered layer set in BOTH directions at import, so adding a
  layer without categorizing it is a boot failure rather than a row that
  quietly lands in whatever group it was appended next to.
  `DataLayerManager.getAll()` now reports `category`, `kind` and `tags`, and
  the one registered layer that loads nothing of its own — the CONTACTS
  coordinator — is marked `kind: 'coordinator'` so it can never occupy a row or
  inflate a group count. **Nothing changes on screen yet**: the DATA LAYERS
  panel still renders its flat list. This is the data the grouped panel reads.
- **Seven more French cities on the LOCATION tray**, five landmarks each —
  Marseille (Notre-Dame de la Garde, Vieux-Port, MuCEM, Château d'If,
  Vélodrome), Lyon (Fourvière, Bellecour, Confluences, Part-Dieu, Saint-Jean),
  Toulouse (Capitole, Saint-Sernin, Pont Neuf, Jacobins, Cité de l'Espace),
  Nice, Nantes, Montpellier and Strasbourg (cathédrale, Petite France,
  Parlement européen).

### Changed

- **The globe opens on Paris.** A visit carrying no share link now starts over
  the Eiffel Tower at 600 m, framed toward the Trocadéro, instead of Austin.
  The LOCATION tray offers the eight largest French communes by population —
  Paris, Marseille, Lyon, Toulouse, Nice, Nantes, Montpellier, Strasbourg — in
  that order. The cities that left the tray did **not** leave the app: Austin,
  San Francisco, New York, Tokyo, London, Dubai and Washington stay reachable
  by search and by voice. Deleting them would have stranded the seeded CCTV
  cameras, which anchor to a city plus a landmark *index* — a regression test
  now walks that seed table and fails if any camera loses the landmark it was
  calibrated against.

### Fixed

- **The power grid's OpenStreetMap attribution was never rendered.** Its entry
  in `DATA_CREDITS` was missing its object boundary, so `power-grid-osm` and
  `rte-actual-generation` shared one object literal and the second `key`/`html`
  pair silently overwrote the first — the ODbL credit for a layer that draws
  volunteer-mapped geometry simply did not appear in the Data attribution
  popover. Both entries are now separate objects, and 42 credits are registered
  where 41 were. Found while adding the Bison Futé credit next to it.

- **`npm run qa:traffic` could not boot at all.** It waited on
  `window.__godsEyeView` with puppeteer's default animation-frame polling, and
  software-rendered headless WebGL stalls the rAF loop — so the harness timed
  out after 60 s on an app that had booted perfectly well, reporting `0 passed,
  0 failed`. It now polls on an interval, the way `qa-transit-fr.mjs` already
  documented, and its screenshots are best-effort: a lost frame capture used to
  abort a run whose assertions had all passed. The traffic proof runs end to
  end again — 11 assertions, live and keyless.

## [Unreleased] — 2026-08-28

### Added

- **Petite hydro: the markers were half a kilometre underground, and it showed
  as drift.** Reported from the map: pan the camera and the dots appeared to
  slide over a map that was standing still — the Espalungue marker would not sit
  on its building, and the offset changed direction between two screenshots of
  the same place.

  It was not a data error. Espalungue's coordinate is **6 m** from IGN's
  building footprint. The markers were being drawn at **ellipsoidal height 0**
  while the ground in the Ossau valley is at **556 m**, so every dot was 556 m
  below the terrain it was meant to stand on — 840 m at Grand-Maison. A point
  under the surface is not merely low: its screen position is offset from the
  surface point above it by `depth × tan(angle between the view ray and the
  local vertical)`, which is zero at the centre of a nadir view and reaches
  about **320 m** at the rim of a 60° field of view. That angle changes as the
  camera moves, so the marker slides.

  Markers are now clamped onto the terrain, the way `rteGeneration.js` already
  clamps its station rings. The synchronous half — reading a floor already in
  cache — is free and always applies; the terrain fetch is bounded to the
  markers actually on screen, capped at 250, and skipped entirely above 200 km
  of camera height where the offset is under two pixels. Positions are updated
  in place on the existing primitives rather than by repainting 2 742 points.

  The clamp follows **both** `camera.moveEnd` and `camera.changed`, because
  neither covers the other: `moveEnd` does not fire when the camera is placed
  programmatically, which is exactly what a share link does, so on its own it
  would have left a link that opens straight into a valley with every marker
  still buried.

### Fixed

- **Bâti 3D no longer floats over Lyon's hillsides.** Reported from a
  Croix-Rousse view where whole blocks hung in the air while the next block sat
  correctly on the ground — and that pattern was the diagnosis. The layer
  re-anchors IGN's surveyed floor altitudes onto the surface the globe draws by
  taking the median difference between the two over a ~1.1 km cell, but it
  sampled that surface **once per cell, at the cell centre**, and differenced
  that single height against each building's own floor. On flat ground the
  result is the datum error, which is what the correction is for. On a slope it
  is the *relief between the cell centre and the building* — 30 to 60 m across a
  0.01° cell on the Croix-Rousse — and every building in the cell was lifted by
  it, uniformly, which is why the artefact came in cell-shaped blocks.
  The surface is now measured under each building with `globe.getHeight` — the
  terrain triangles already resident on screen, one synchronous read per volume
  and no network at all. The per-building sampling the first version priced as
  unaffordable (6 400 DEM lookups per viewport) costs nothing, because it never
  touches the DEM; the coarse grid is now only consulted when the camera has
  teleported and no terrain is resident yet. Two smaller corrections came with
  it: the surveyed ground compared against that height is now the middle of the
  footprint (`altitude_minimale_sol` is its LOW corner, and IGN publishes
  `altitude_maximale_sol` beside it — median drop 1.9 m, up to 13 m), which
  stops half of each building's own slope being read as terrain error; and what
  the cell median still cannot fix is absorbed by GROWING each volume — base
  down where the mesh is low, roof up where it is high, capped at 60 m.
  **The correction only ever lengthens a volume, never moves it**, so the floor
  altitude on every card is still the one IGN published. The layer also reports
  the residual it had to absorb (median and worst 5%) rather than averaging it
  out of sight, and `npm run qa:bdtopo` now asserts that residual over
  Fourvière — a hill, chosen because the old sampling could not pass there.

- `qa-fr-hydro.mjs` now probes `/api/terrain/heights` and reports which checks a
  target cannot run, instead of failing them. `vite preview` serves `dist`
  without the dev-server API middlewares, so the ground clamp and the overlay
  paint checks are only meaningful against `npm run dev` — where they pass. An
  earlier note in this harness blamed SwiftShader for the empty overlay
  diagnostics; that was wrong, and the cause was the preview target.

- **Petite hydro now reads the Plan IGN, and 229 more plants have a place on
  the map.** Asked for better precision, and the suggestion was the right one:
  the Plan IGN draws France's power stations, and it draws them from **BD
  TOPO**, whose `zone_d_activite_ou_d_interet` layer carries 4 318 features
  tagged `nature = 'Centrale électrique'`. Three things make it the best
  positional evidence available. It is **the building** — median footprint span
  **32 m**, against an OpenStreetMap `type=site` relation that can be twelve
  kilometres wide. It **publishes its own error bar**, `precision_planimetrique`,
  3 m or better on 242 of the positions used here, and the card now prints it.
  And the join needs no guessing at all: BD TOPO publishes `insee_commune`, the
  same INSEE code ODRÉ prints on every register row.

  Used in two passes. **Refine:** a plant another tier had already identified is
  snapped onto the nearest footprint in its commune within 250 m — **360
  positions moved, a median of 12 m.** The radius is read off the measured
  distribution rather than chosen: agreement clusters tight below 250 m and the
  curve flattens after it. **Place:** a row nothing else could position takes a
  footprint when the toponym matches, or when the commune holds exactly one
  register row and exactly one free footprint. **765 → 998 plants placed**, and
  coverage below 4,5 MW roughly doubled — 50 % of the 1–4,5 MW band (was 38 %)
  and 19 % below 1 MW (was 11 %). The honest caveat is on the card: 86 of the
  229 new placements sit on a `Centrale électrique` whose kind IGN leaves blank,
  and where IGN did not say "hydroélectrique", the card says so.

- **Four plants were on the wrong continent, and the register said so itself.**
  Both the commune and the source substation are codes ODRÉ publishes, and
  OpenStreetMap publishes the substation code too as `ref:FR:RTE`. Across the
  378 RTE-connected rows OSM can check, the two agree to a median of 2,4 km and
  a p90 of 5,4 km; **the largest legitimate gap is 11 km, and then the next four
  are 6 717, 6 864, 7 263 and 8 945 km.** All four are metropolitan hydro plants
  filed under an overseas commune: the 30 MW **Lac d'Oô** — Luchon,
  Haute-Garonne — is published in **Guyane**, **Luz** in Martinique, **Motz** in
  Guadeloupe and **Pont-du-Loup** at La Réunion. For those the commune is simply
  the wrong field, so the substation wins and the plant is drawn where its own
  yard is. The register's commune is kept verbatim on the record and the card
  prints both claims: the reader is owed the contradiction, not a quiet edit.

- **Petite hydro: 167 plants were in the wrong place, including one in a
  forest.** Reported from the map: the Centrale du Hourat at Laruns was drawn
  2,7 km up the mountain, mid-forest, when it stands in the middle of the
  village beside the Arriussé. Two independent bugs, both mine, both now
  measured and pinned:

  **Overpass `center` on a relation is the centre of its BOUNDING BOX.**
  OpenStreetMap maps a large hydro scheme as one `type=site` relation covering
  the intake, the headrace tunnel, the penstock, the powerhouse and the
  tailrace — the Hourat's spans 6,0 km, Grand-Maison's 12,1 km, Montpezat's
  22,8 km — and the centre of that box is a point on **no object at all**.
  Measured on the first build: **167 of 722 OSM-positioned plants (23 %) sat at
  the centre of an object more than 500 m across, 99 of them more than 3 km.**
  The build now asks for `bb` instead of `center` so it can see the span,
  refuses anything wider than 500 m as a position, and snaps those to the
  `power=generator` elements inside — the generating hall. **127 plants moved,
  a median of 1,3 km and up to 7,5 km.** The Hourat now lands 47 m from 4 rue
  de Gerp, 64440 Laruns. What cannot be resolved is not guessed: it goes to its
  commune ring.

  **A prefix-shaped first word is not decoration.** The register writes
  `MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3`, so the build stripped any four to
  six uppercase characters followed by a hyphen. `GRAND` is five uppercase
  characters followed by a hyphen: **`GRAND-MAISON` became `MAISON`**, and
  France's largest hydro plant lost its join to EDF's own published coordinate.
  The decoration is now recognised only as a pair — prefix *and* trailing `-n` —
  which also spares the real register names `HYDR-AUZENE` and `COLY-LAMALETTE`.

  Three consequences worth naming. Cards now say **which object** the dot is —
  a published point, a mapped outline, a generating hall, or a connection yard —
  alongside how the plant was identified, and print how far a snapped position
  moved. A new last-resort tier places 49 plants on the **RTE switchyard whose
  `ref:FR:RTE` is the register's own `postesource`**, applied only to
  RTE-connected rows because on an Enedis row that substation serves a whole
  area and would stack a dozen producers on one pixel. And the 12 km commune
  ring is now re-tested on the FINAL position rather than on the candidate that
  was about to be thrown away. Coverage rose with the accuracy: **765 plants
  placed (was 761), 98 % of the fleet above 100 MW and 90 % of the 10–100 MW
  band.**

- **Petite hydro (FR): the other 2 686 hydroelectric plants.** A user went
  looking for the hydro installation at **Laruns**, in the
  Pyrénées-Atlantiques, and could not find it. Nothing was broken — there are
  *nine* plants in that commune (Miégebat 74 MW, Le Hourat 46,9 MW,
  Pont-de-Camps 39,4 MW, Artouste, Bious, Geteu, Fabrèges, Espalungue,
  Artouste-Lac, **223,9 MW between them**) and this globe could draw none of
  them: *Centrales EDF* covers EDF SA's own fleet and those nine are **SHEM's**,
  while *Groupes de prod* stops at 100 MW because that is RTE's publication
  floor. Two correct layers, and a whole valley in the gap. Measured against
  ODRÉ's national register, that gap is **2 742 installations and 26,02 GW**, of
  which the two existing layers between them reach 56.

  The new layer draws the register whole, down to a **40 kW mill at Monteils**,
  keyless, from a file shipped in the repo. It carries two kinds of marker and
  the difference between them is the point:

  - **A filled disc is a plant, where it is** — 761 of them, 23,4 GW, coloured
    by the register's own technology vocabulary (fil de l'eau, éclusée, lac,
    pompage-turbinage, hydrolien fluvial) and sized by installed power on a
    fourth-root ramp, because this fleet spans 40 kW to 1,69 GW and a
    square-root scale over that range either drowns the mills or paints
    Grand-Maison over a département.
  - **A hollow ring is a COMMUNE, not a plant** — 1 368 of them, standing for
    the 1 981 installations no source places. **The register publishes no
    coordinates at all**, only an INSEE code, and measured across the plants
    that *do* get a real position the commune centre sits a **median 3,0 km**
    from the actual powerhouse (p90 9,0 km) — in a Pyrenean valley, routinely a
    different river. So they are not pinned somewhere false; the ring says how
    many and how much, and never where.

  **Half the register is anonymised, and those cards are still full.** 1 357
  rows publish `Confidentiel` where a name belongs — small private plants whose
  operator is a person. They are neither dropped nor labelled "Confidentiel":
  the card leads with what the publisher *does* give, which for those rows is
  commune, installed power, technology, commissioning date, connection voltage,
  source substation, grid operator and EIC code at 95–100 %, plus — on 90 % of
  them — **the energy actually injected over the trailing twelve months**, which
  yields a capacity factor. An unnamed 3,9 MW plant at Licq-Athérey reads *3,9
  MW installés · 3,9 GWh injectés sur 12 mois glissants (12 %) · Fil de l'eau ·
  HTA, poste L.ATH, Enedis · en service depuis le 15/11/2007*.

  Three chips (**TOUT / ≥ 1 MW / ≥ 10 MW**) hide markers at runtime without
  touching the register behind them — the totals in the stats line stay put, and
  a ring clears a floor on its largest member, never on its commune total.
  Ambient labels follow the camera rather than the national capacity ranking, so
  zooming into the Ossau valley names Miégebat and Le Hourat instead of holding
  the label budget for Grand-Maison four hundred kilometres away.

  Four upstream traps are absorbed and documented rather than smoothed over:
  the register's **published zeros that mean "not declared"** (`debitmaximal` is
  zero on every single row in France, so it is not read at all); its internal
  name decoration (`MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3` is a poste-source
  code, a name and a revision number); **26 hydro plants published as
  `Photovoltaïque`**, 25 of them Corsica's real hydro fleet — Rizzanese 55 MW,
  Lugo-di-Nazza 43 MW, Castirla 28,5 MW, Tolla, Calacuccia, Ocana, Asco — which
  keep their disc and their published string on the card but are refused a hydro
  colour; and EDF's hydro file, where **`coordonnees_x_wgs` is the latitude**.
  Sources: ODRÉ (Licence Ouverte 2.0), EDF Open Data (Licence Ouverte 2.0),
  OpenStreetMap (**ODbL 1.0 — the share-alike travels with the shipped file**),
  geo.api.gouv.fr. Rebuild with `npm run hydro:registry -- --report`; browser
  proof in `npm run qa:fr-hydro`.

- **The app now starts with no key at all.** `git clone && npm i && npm run dev`
  boots to a working globe. Previously `src/main.js` threw before the viewer
  existed if `GOOGLE_MAPS_API_KEY` was missing, so a fresh checkout without a
  billed Google account produced a dead page — even though the whole fallback
  path already existed downstream. The key is now optional and, when absent, is
  never published to the page: `Cesium.GoogleMaps.defaultApiKey` and
  `window.__GOOGLE_MAPS_API_KEY__` stay unset, so no request is fired with an
  undefined key. Google 3D reports **"Google Maps API key required for Google
  3D"** rather than a generic failure, and the Google-only viewport-places
  endpoint is not called at all. `scripts/dev-fresh.sh` warns and continues
  instead of exiting.
- **The search box works without a Google key.** Type a place, land on it — no
  credential involved. A keyless build now geocodes through `/api/geocode`,
  which answers from **OpenStreetMap (Nominatim)** worldwide and from the **IGN
  Géoplateforme** (BAN addresses and the IGN POI index) for the French
  addresses OSM has not mapped. Cities, régions, parks, streets and buildings
  are framed exactly as before — the camera work is unchanged, only the
  geocoder is new. Searching biases to what you are looking at, so "sixth
  street" over Austin is East 6th Street rather than a village in Uganda,
  while a place the whole world knows by that name still wins: "Toulouse" typed
  over Austin is the city in France, not the bistro down the road. Results are
  cached and the OpenStreetMap usage policy's one-request-per-second limit is
  respected for the whole app, so a search can take a couple of seconds the
  first time and is instant afterwards.
- **Two keyless France basemaps, from the IGN Géoplateforme.** **IGN Ortho**
  (BD ORTHO®, 20 cm aerial, z0-19) and **Plan IGN** (Plan IGN v2, z0-19) join
  the MAP SOURCE row, which is now six tiles on two rows. No key, no token, no
  account — `data.geopf.fr` serves WMTS with `access-control-allow-origin: *`,
  and IGN documents the WMTS endpoints as not rate-limited. Licence Ouverte
  2.0; the attribution popover names both products with their `cartes.gouv.fr`
  records and links IGN's table of aerial-survey dates, because an orthophoto
  mosaic has no single update date.
- Coverage is **metropolitan France and Corsica**, and the tray says so before
  you click: both tiles carry "IGN Ortho — metropolitan France only" in their
  tooltip and accessible name. Each IGN stack composites **over an OSM base
  layer** rather than replacing it, so the rest of the planet stays present —
  a rectangle-limited layer at index 0 would be Cesium's base layer, and Cesium
  smears a base layer's edge pixels across every tile outside its bounds.

- **Groupes de prod (FR) now draws the hydro fleet, and says what a negative
  reading really is.** The layer shipped in #14 against a hand-written fixture,
  because no RTE account was available to build it with. Run against the live
  resource for the first time, three of its claims turned out to be wrong and
  one gap turned out to be large.
  - **36% of the fleet was invisible.** RTE and the ODRÉ register cut the fleet
    at different granularities: the register carries one row per hydro PLANT,
    RTE publishes its turbine GROUPS under entirely different EIC codes. 55 of
    152 units — 1 914 MW — had no register code, so Grand'Maison, La Bâthie,
    Montézic, Revin, Super-Bissorte and thirteen more read as "RTE published
    nothing" while RTE was publishing them by the dozen. Those units now reach
    their station through a name match, which is weaker evidence than a
    published code and is labelled as such on the card. 148 of 152 units place;
    the four that do not are still counted and reported. Live stations went from
    43 to 60 of 108.
  - **A negative reading is usually a stopped unit, not a pump.** 24 units read
    negative and **fourteen were reactors** — Chooz 1 at −58 MW, Paluel 3 at
    −49. A shut-down reactor still runs its coolant pumps and instruments and
    buys that power off the grid: a stopped 1 500 MW machine is a ~50 MW load.
    Not one of the 28 pumped-storage units was pumping at that hour. The card
    and the legend say so now.
  - **RTE sends no installed capacity** (0 of 152 units), so the register's
    figure is the denominator behind every load percentage — and **no nulls**
    (0 of 6 992 rows), so the future-padding guard is defensive rather than
    observed. The module now marks each of its nine traps as MEASURED or
    DEFENSIVE instead of implying all were seen.
  - The test fixture is a **real capture** now, not a contract sketch.

- Added the **Groupes de prod (FR)** layer — France's power stations, unit by
  unit, at the output RTE last published for each one. 171 generating units of
  100 MW or more across 108 stations: 57 reactors for 63.0 GW, 56 hydro
  machines, 44 thermal groups, 9 offshore wind units, the Rance tidal barrage
  and two grid batteries. It completes the sentence the Réseau gaz layer's card
  has been leaving open — what those stations are producing *right now*, which
  éCO2mix only publishes as a national filière total.
  - **A ring is what a station can do; a disc is what it is doing.** The ring is
    sized by installed power on a √ ramp so area tracks megawatts, and the disc
    fills it at full load. A **faint empty ring** is a station RTE published
    nothing for. A **crisp empty ring** is one measured at zero — a reactor in
    outage, which is the most interesting state a reactor has and the one a
    `value || 0` guard silently erases. A **magenta disc** is a machine
    *consuming* the grid: Grand'Maison pumping 1 690 MW back up its mountain, or
    a battery charging.
  - **Click a station and the card is its units.** Each group with its own
    megawatts against its own nameplate, and a day of hourly history as a
    sparkline — where `·` is a published gap, `▁` is a measured zero, and `▽` is
    consumption. Not a smoothed line: the gaps are real and stay visible.
  - **It draws with no key at all.** The fleet is a shipped file built from
    ODRÉ's national register and positioned from EDF Open Data, OpenStreetMap
    and geo.api.gouv.fr, so a `git clone` puts all 108 stations, their names,
    their filières and 93.5 GW of installed capacity on the globe with zero
    credentials. A free RTE account (`RTE_CLIENT_ID` / `RTE_CLIENT_SECRET`
    from data.rte-france.com) only ever adds the number that moves — and the
    layer says so, in the readout and in the first legend row, instead of
    reporting zero.

- Four things the Groupes de prod layer refuses to do, each stated on screen:
  - **Draw a reactor.** Nobody publishes where an individual reactor building
    is — OpenStreetMap has zero `power=generator` + `generator:source=nuclear`
    elements over the whole of France — so Gravelines is one ring with six
    groups on its card, not six discs invented from a site outline.
  - **Hide where a ring came from.** RTE publishes no coordinate for any unit,
    so every position is derived from four published anchors and every card
    names its own: 69 stations sit on **EDF's own published coordinate for its
    own station**, 11 on an OpenStreetMap `power=plant` outline, 13 on the
    `ref:FR:RTE` switchyard their register entry names, and 15 at the centre of
    their commune — including four offshore wind farms whose rings are therefore
    on the beach, because nothing open publishes their footprint. A candidate
    more than 30 km from the commune centre is refused, and two anchors are
    never averaged into a third position nobody published. EDF outranks
    OpenStreetMap because the two agree to within 300 m on every reactor and
    every thermal site and diverge by up to 9.5 km on hydro, where a
    powerhouse, an intake and a dam share a name across a valley; every
    `edf-published` row records `supersededOsmKm` so that choice is auditable
    per station rather than asserted.
  - **Reconcile two capacities.** RTE's `installed_capacity` and the register's
    `puismaxinstallee` are different administrative numbers for the same
    machine; when they differ by a megawatt or more the card prints both.
  - **Quietly drop a unit.** A unit RTE reports that the shipped register has
    never heard of is counted in the readout with its megawatts, as *unplaced* —
    because there is nowhere honest to draw it.

- Eight upstream traps absorbed in the projection and pinned in the tests:
  **zero is a reading, not a gap** (`value || null` erases every reactor in
  outage and reads the fleet as 100% available); **the last row is the future**
  (the window is padded with unpublished `null` hours, so `values.at(-1)` reads
  the whole country as 0 MW — the same shape as éCO2mix's `prevision_j1`
  padding); **negative is pumping, not corruption**; `values` arrive out of
  chronological order; **one EIC code arrives in two envelopes** when the window
  spans a day boundary, so last-one-wins throws away half the history; RTE
  republishes an hour with a newer `updated_date`; the two installed capacities
  disagree; and RTE's fleet drifts from ODRÉ's register. On the register side:
  `puismaxinstallee` is published in **kilowatts** to three decimals, a 132 MW
  photovoltaic farm at Ajaccio is filed under `filiere: "Thermique non
  renouvelable"`, the Rance tidal barrage is named `CENTRALE HYDRAULIQUE`, and
  unit names arrive in four grammars with the article parked at the end
  (`TRICASTIN (LE)`).

- Added the **Centrales EDF** layer — where French electricity is physically
  made, from EDF's own three open datasets (hydraulic, nuclear, thermal),
  keyless under Licence Ouverte 2.0. 79 generating sites carrying 80 094 MW:
  18 nuclear sites (61 370 MW), 51 hydraulic plants (13 779 MW) and 10
  fossil-fired sites (4 945 MW). Each site is one disc whose **area** — not its
  radius — is its installed capacity, coloured by filière and labelled with
  what the object actually is in the publisher's own vocabulary:
  `GRAVELINES · 5 460 MW · 6 × REP 900`, `GRAND-MAISON · 1 714 MW ·
  Pompage mixte`, `CORDEMAIS · 1 160 MW · 2 × Charbon`. This is the structural
  half of the question **Mix élec** answers live: that layer says what is
  flowing right now, this one says what is built, and where.
- The layer is built around what these files do and do not say. **It is EDF's
  fleet, not France's** — the hydro file carries 51 of the 400+ installations
  EDF operates (those above 100 MW, plus those whose secondary reserve reaches
  20 MW), no CNR or SHEM hydro and no Engie or TotalEnergies CCGT; only nuclear
  is complete for the country. **There is no single "as of"**: nuclear is a
  vision consolidée au 31/12/2025 and the other two au 31/12/2023, so every
  site is stamped with its own file's date and the layer reports the range
  rather than presenting a total that never existed at one instant. **Installed
  capacity is not production**, and it is named that way everywhere. **A row is
  not a site**: the nuclear and thermal files publish one row per unit with the
  site's coordinate repeated on each, so six Gravelines reactors draw one
  marker and not six stacked on a pixel, while a hydro plant — published one
  row per plant, with no turbine count — reports no unit count rather than "1".
- **Five of these sites are also drawn by the Réseau gaz layer, and both are
  right.** That layer draws ODRÉ's register of the 14 centralised gas-fired
  stations whoever runs them; this one draws EDF's own fossil-fired file
  whatever it burns. The overlap is exactly the five EDF gas sites — Martigues,
  Bouchain, Blénod, Montereau, Gennevilliers — where the two publishers
  disagree slightly on capacity (585 against 575 MW at Bouchain). Nothing is
  de-duplicated: neither set contains the other, and hiding one figure would
  hide that they disagree.
- Two upstream traps are absorbed server-side in `edfPlantsFeed.js` and pinned
  against captured payloads: the hydro file publishes **`coordonnees_x_wgs` as
  the latitude** (read the usual way, Grand-Maison lands off Somalia) while the
  other two publish one `"lat, lon"` string, and
  `reserve_secondaire_maximale` is a **site figure repeated on every unit
  row**, so Cattenom offers 60 MW of reserve and not four times 60. 49 unit
  tests; `npm run qa:edf-plants` is the browser proof. Attribution registered
  in the Data attribution popover and DATA_SOURCES.md.

- Added the **Power Grid** layer — the wires themselves, from OpenStreetMap,
  keyless, loaded for the viewport you are looking at. The Mix élec and Réseau
  gaz layers came from ODRÉ; the electricity network's own geometry is the one
  part RTE publishes nothing for, so this is community mapping and the layer
  says so everywhere it can.
  - **Routes by voltage band** — a 400 kV backbone stroke is thicker and hotter
    than a 63 kV one, and the four bands (≥ 300 / 180–299 / 100–179 / 50–99 kV)
    are generic rather than French, so the same palette reads correctly on the
    British 400/275/132 and German 380/220/110 grids. Verified live against
    central London.
  - **The substations they land in**, sized by the same band, named on the globe
    when OSM names them — "Poste électrique de Villejust", 400/225/90 kV, RTE —
    and captioned with what OSM calls them: a poste source, a traction feed, or
    a role it never stated.
  - **The pylons**, but only below 0.25° of view, where a pylon is a thing
    rather than a dot. There are 11,670 of them in a 1.2° × 1.6° box; at that
    range they cost more bandwidth than the entire network they carry.
  - **Underground cable is dashed.** In Île-de-France a quarter of the mapped
    high-voltage network is `power=cable`, and drawing it like an overhead line
    would claim pylons that are not there.

- Four things the Power Grid layer refuses to do, each stated on screen:
  - **Draw a line at conductor height.** The wire hangs tens of metres up and
    OSM records that for a minority of pylons and for no line at all, so every
    route is a ground-clamped stroke of the mapped ROUTE — and every legend row
    says so, rather than lifting the network to a plausible-looking catenary.
  - **Guess a voltage.** Voltage is the filter because voltage is the evidence:
    a feature OSM has not given one is absent, not demoted. That filter is also
    what turns 619 raw "substations" in one Paris viewport — 404 of them
    street-corner cabinets and cadastre-imported building footprints — into the
    209 real high-voltage yards worth drawing.
  - **Call a stroke a line.** OSM splits one named liaison across dozens of
    ways, so the readout reports both: 1,386 strokes for 304 mapped routes, over
    Île-de-France.
  - **Imply a truncated view is a complete one.** Each class has its own element
    cap and reports its own truncation, and the readout says which one was cut
    and to zoom in. Above 0.8° of view the layer asks for nothing at all and
    says "zoom in" instead of drawing a partial grid that looks whole.

- Six upstream traps absorbed server-side and pinned against a captured Overpass
  response: **one shared element cap starves whatever Overpass emits last** (899
  pylons erased every line and substation in a Paris box, so each class now gets
  its own bounded output); `voltage` arrives as a `;` list carrying junk
  (`225000;0`, `225000;225000;225000;63000`) that `Number()` turns into NaN;
  `power=line` is not a synonym for high voltage (one is tagged 400 **volts**);
  RTE's own 225 kV yards are tagged `substation=industrial`, so the subtype is a
  caption and never a filter; a multipolygon substation carries no `lat`/`lon`
  at all, only a computed centre; and `power=cable` is the same network
  underground.


- **Shared mobility now says what an object is and who runs it, at the same
  time.** Two independent facts get two independent channels. **Shape** answers
  *what*: a bike, an e-bike, a kick scooter, a moped, a shared car and an
  unknown form factor each draw their own silhouette, so a Paris street stops
  being one undifferentiated cloud of dots. **Colour** answers *who*: every
  operator has its own hue, held nationwide — Lime is the same green in Lille
  as in Marseille, and Vélib', Voi, Dott, Pony, Bird, Citiz, Clem', YEGO,
  Cityscoot, Tier and Leo&Go are pinned so that no two of them can ever
  collide. The row legend now carries both keys: the silhouettes actually
  drawn, then the operators actually in view, named and counted.
- A **station keeps its fill for availability** — the one reading a person acts
  on — and wears its operator on the RING instead. The Bikeshare layer does the
  same, from the same registry, so over Paris a Vélib' dock and a Dott dock are
  tellable apart even though two different layers draw them. Bikeshare station
  dots grew from 4–12 px to 7–14 px so the ring cannot eat the fill.
- No French GBFS feed publishes a brand colour, and the layer does not pretend
  otherwise: the ~15 operators that run several French systems are pinned by
  hand, and every other network's hue is derived from its published title and
  labelled as derived in the legend tooltip. Two municipal networks can land on
  the same hue; the legend names them, and the names are what settle it. A
  selected vehicle's card now leads with its operator ("Lime E-bike"), and the
  detection readout says "PONY SCOOTER" rather than just "SCOOTER".

- Added the **Réseau gaz** layer — the French gas system, keyless. Three ODRÉ
  products drawn together because they only make sense next to each other: the
  **pipes**, the **inlets** and the **outlets**.
  - **36,106 km of high-pressure transmission trace**, clamped to the ground —
    NaTran (ex-GRTgaz) 31,420 km in violet, Teréga 4,686 km in orchid. Two
    companies, two colours, two length figures; a stroke of one is never
    chained onto a stroke of the other.
  - **850 renewable-methane injection points**, sized by the capacity each
    declares (16.3 TWh/an in total), and **14 centralised gas-fired power
    stations** sized by nameplate power (7,196 MW) — which is where a good part
    of that gas leaves the system as the `gaz` filière of the Mix élec layer.
  - It is a **published simplification, not a pipeline location**. Both
    operators publish their trace at about 250 m; nothing is densified,
    smoothed or re-routed, and every card says so.
  - It is **installed capacity, not live output**, and it says that too. What
    those 14 machines are producing right now is a national figure RTE does not
    break down per station without an API account.
  - **741 of the 850 injection points feed a network this layer does not
    draw** — the local distribution grid. They are drawn dimmer, counted on
    their own legend row, and no connector is ever drawn between a site and a
    pipe, because none of these files publishes that link.
- Six upstream traps are absorbed server-side and pinned against captured
  payloads:
  - The power-station file is **seven annual editions stacked in one table** —
    98 rows are 14 sites × 2019…2025. Summing the column reports 50,372 MW for
    a 7,196 MW fleet and stacks seven dots on each of 14 coordinates.
  - **The editions disagree**, and no endpoint promises an order. Landivisiau
    is `En projet` in 2019 and 2020 and `En service` from 2021; the export
    answers 2025 first, the records API answered 2023, 2022, 2025, 2021, 2024,
    2019, 2020. Newest edition wins, and the card names what the older ones
    claimed.
  - **Teréga's third ordinate is not a height** — it runs −705.5 m to
    +1,809.4 m over ground that is 0–1,500 m. Dropped, and the arity is checked
    per vertex because a flat lon/lat reader fed 3-tuples does not throw, it
    silently mis-plots the network.
  - One `geo_shape: null` row (which still carries a `geo_point_2d`) and eight
    `MultiLineString` rows in a file that is otherwise all `LineString`.
  - **Fifteen decimals on a ±250 m product.** Rounded to 5 (~1.1 m), which also
    reveals 165 published "lines" whose vertices are all one point.
  - **`site_ouvert` is the string `"False"`**, which JavaScript coerces to
    `true` — that alone would draw three closed sites, at zero size, out of a
    file titled *en service*.
- A pipeline drawn in any blue renders perfectly and reads as a river. The
  first version of this layer did exactly that — measured against the OSM
  basemap, its steel blue sat within 14/255 of the basemap's own water colour
  on every channel — so the two networks are violet and orchid, a unit test
  keeps all four channels apart, and the browser harness now counts the
  operator's own pixels with the trace shown against the same view with it
  hidden. Every structural check can pass while nobody can see the layer.

- Added the **Shared Mobility FR** layer — every French shared vehicle the
  Bikeshare layer does not already draw. From the same national access point as
  the transit layer, but its GBFS half: ~40,600 free-floating bikes, e-bikes,
  scooters and mopeds plus ~15,500 operator dock stations, across 135 systems,
  keyless, under per-operator Licence Ouverte 2.0 / ODbL 1.0. Loaded per
  viewport, coloured by vehicle kind with a live legend, and clicking one gives
  its battery range, its operator, and the age of that vehicle's own last
  report rather than the age of the poll.
- It is an inventory, not a track, and says so: GBFS never publishes a vehicle
  during a rental, so a vehicle being ridden is invisible and nothing is
  interpolated between two sightings. Freshness is uneven across operators
  (Lime ~50 s, Dott a median 8 minutes with a long tail) and is shown per
  object.
- Three redundancies are resolved before anything is drawn, each measured
  rather than assumed: the catalog's 165 resources collapse to 135 distinct
  systems (identity is the set of places a system reports, which catches
  Vélo'v published from two different domains where a URL comparison cannot);
  the four systems already in Bikeshare are excluded against that layer's live
  registry; and the 32,783 municipal parking-bay rows that free-floating
  operators republish as their own "stations" are merged out instead of being
  drawn once per operator. Every verdict is recorded in
  `config/gbfs_fr_systems.json` rather than silently applied.

- Added the **Mix élec** layer — France's live electricity mix, keyless. RTE's
  éCO2mix, republished by **ODRÉ** under Licence Ouverte 2.0 and refreshed every
  15 minutes, answers the question a national consumption gauge never can:
  *which regions power France, and which draw on it.* The 12 métropolitaines are
  painted by their own consumption-minus-generation balance — teal where a
  region produces a surplus, amber where it runs a deficit, opacity ramped by
  how large that imbalance is against the region's own load — so Auvergne-Rhône-
  Alpes and Normandie exporting hard while Île-de-France imports nearly its
  whole load is legible at a glance. The five commercial border balances are
  drawn as raised arcs whose arrow points the way the power travels, with the
  direction repeated in words on the label; a border at 0 MW is drawn as no arc
  at all. National load, gCO₂/kWh, low-carbon share and the net export figure
  are reported on the layer's row.
- The layer is built around what this dataset does and does not say. `ech_comm_*`
  is a **commercial nomination between market areas, not a cable**, so the arcs
  are anchored on country reference points rather than interconnection sites,
  and Allemagne + Belgique — published as one field — stays one arc labelled
  with both. The commercial balances do **not** sum to the physical one
  (measured: −2 893 against −3 633 MW), so both are reported, separately named.
  éCO2mix régional covers 12 regions: **Corse runs on its own system and is
  absent upstream**, so it is never painted rather than inheriting a neighbour's
  colour. RTE publishes no regional carbon content, so none is drawn.
  Attribution to éCO2mix / RTE via ODRÉ, with the dataset's own 15-minute
  timestamp, is registered in the Data attribution popover.
- Added the **Transit FR** layer — the first thing on this globe that moves on
  the ground. Live GTFS-Realtime vehicle positions from the French Point d'Accès
  National (`transport.data.gouv.fr`): buses, trams, metros and interurban
  coaches across ~150 networks, keyless, under per-feed Licence Ouverte 2.0 /
  ODbL 1.0. Vehicles are loaded for the viewport you are looking at (never
  nationally), colour-coded by the network's declared service class with a live
  legend, and clicking one raises its line, speed, bearing, stop status,
  occupancy and the age of the operator's own last fix. Glyphs **glide between
  two consecutive reported fixes** rather than jumping, so the scene renders up
  to one poll interval behind live and never extrapolates past what a feed
  actually said; a vehicle reporting no bearing is drawn as a disc, not a
  chevron pointing somewhere plausible. Above ~300 km the layer fetches nothing
  and says so.
- Coverage is honest about its own gaps: France's largest networks —
  Île-de-France, Lyon, Marseille, Strasbourg, Lille — publish no live vehicle
  positions at all (their SIRI feeds carry next-departure and disruption data,
  not coordinates), so a camera over central Paris reads "no PAN feed covers
  this view" instead of an empty map.
  Feed footprints are OBSERVED — the catalog publishes coverage as a name and
  never as geometry — and shipped in `config/pan_gtfs_rt_feeds.json`
  (`node scripts/build-pan-gtfs-rt-index.mjs` rebuilds it), so a cold start
  costs no probe sweep. Attribution to transport.data.gouv.fr and each
  publishing transport authority is registered in the Data attribution popover.
- Added a **Ports** layer: the NGA **World Port Index** (Pub. 150), 2,951 ports
  worldwide, bundled and keyless. Each port carries its country, region,
  UN/LOCODE, harbour size and type, shelter rating and water body. The
  publication is a U.S. Government work and therefore public domain, so unlike
  the TeleGeography cables it carries no commercial-use carve-out. Two traps in
  the source are handled rather than passed through: harbour depths are WPI
  *range bins*, not surveyed soundings, so they render as `~11 m channel
  (approx.)` and must not be used for navigation; and the size code `V` means
  *very small*, not "very large" — inverting that scale would promote three
  thousand fishing harbours to container terminals. Fields that are "unknown"
  for ~99% of rows (port security, VTS, TSS) and the max-vessel dimensions
  (present for 3% of rows, with impossible values) are dropped rather than
  rendered as data.
- Added a **Marine Buoys** layer: live sea state from the NOAA **National Data
  Buoy Center**, keyless, through the new `/api/ndbc` proxy (10-minute cache,
  disk-backed, serve-stale). One upstream fetch covers the globe. Buoys are
  colored on the WMO sea-state ladder by significant wave height, with period,
  direction, sea temperature and wind on the card. **The network is sparse and
  the layer shows it instead of papering over it:** only about a fifth of
  reporting stations carry a wave sensor, and one that does not renders neutral
  grey with the line omitted — never as a calm sea. A genuine `0.0 m` reading
  stays visually distinct from an absent one, and the control chip carries the
  measured/total split. Observations older than 12 hours are dropped, and an
  upstream outage notice is rejected rather than cached as an empty ocean.
- Added an opt-in **OpenStreetMap mapped-camera** source
  (`CCTV_OSM_CAMERAS_ENABLED=1`): publicly mapped surveillance-camera positions
  are loaded for the viewport you are looking at — plus a snapped margin, so
  panning re-uses the cached answer — and merged into the CCTV layer, anywhere
  in the world OSM has them. OSM maps where a camera is, never what it sees, so
  these cameras carry no feed and show a labeled Street View or
  `NO UPSTREAM CONFIGURED` frame, with tag-derived poses (bearing, tilt, mount
  height) marked `RAW PRIOR` and © OpenStreetMap contributors (ODbL)
  attribution registered the moment positions appear on the globe.
- Added the Métropole de Lyon "Caméras Web Criter" pack to the CCTV layer: the
  city's public traffic cameras, keyless, with their frames served live from the
  Grand Lyon open-data host. Cameras whose frames stop refreshing drop out of the
  catalog. Attribution to the Métropole de Lyon (Licence Ouverte 2.0) is
  registered in the Data attribution popover; `CCTV_LYON_ENABLED=0` disables the
  pack.
- Clicking the CCTV panel preview (or pressing Enter on it) now opens the frame
  full-screen at the publisher's own resolution — most public cameras publish
  1920x1080 into a 360px rail. Escape or the close button returns. The bar prints
  the frame's true pixel size, so an upscaled low-resolution camera never implies
  detail it does not have. Enlarging costs no extra request: the decoded frame is
  moved, not re-fetched.
- Lyon camera headings are now hand-derived from OpenStreetMap road geometry plus
  the published frames, and served as `CAL · CURATED`, instead of the arbitrary
  id-hash fallback the catalog's missing bearing would otherwise force. The 3D
  monitor plane now lands a median 6 m from the carriageway the camera watches,
  against 30 m for the hash it replaces. One camera keeps the fallback because it
  publishes a placeholder image, not a frame.
- Added three French national alert layers, all keyless: **Vigicrues** (337
  monitored river reaches coloured by the state's 4-level flood vigilance),
  **Hub'Eau Gauges** (the live river-sensor mesh beneath it, up to ~4,000
  stations sized by discharge) and **Météo-France Vigilance** (the 4-colour
  départemental weather warning across 9 phenomena). All three are Licence
  Ouverte.
- Added the `/api/vigicrues` and `/api/vigilance` dev-server proxies. Vigicrues
  publishes 2.2 MB with no gzip, no ETag and no Last-Modified against a map
  that changes twice a day, so the proxy splits it into a geometry document
  fetched once per session and a ~3 KB level document that is polled. The
  vigilance proxy prefers Météo-France's own keyless data.gouv.fr mirror and
  uses the authenticated API only when `METEOFRANCE_API_KEY` is set.
- Bundled the 96 metropolitan French département polygons (IGN ADMIN EXPRESS
  via france-geojson, Licence Ouverte) — the vigilance product carries colours
  but no geometry.
- Added honest aircraft identity narration: callsign, operator, registration,
  type, and route come only from selected-contact context, and missing operator,
  route, or type enrichment is named explicitly.
- Added local, publication-compatible copies of the two README PNGs, with source
  records and third-party-license boundaries in `docs/media/README.md`.
- Added regression coverage for aircraft identity narration and optional-key
  loading feedback.
- Added `scripts/lib/qa-first-run.mjs`: the QA fleet's shared handling of the
  first-run mission card. Every headless harness is a fresh browser session, so
  the card — which returns every fresh session by design — used to land on top
  of each new dataset's QA run, swallowing the clicks and pixels the harness was
  measuring, and each harness solved it again, differently. All 40 harnesses
  that drive the app now open their page with `newQaPage(browser)`, and
  `npm test` audits the fleet for it (`src/qaFirstRunSuppression.test.mjs`) so a
  new harness cannot forget. `scripts/qa-firstrun.mjs` is the one exemption —
  the card is what it tests. For QA by hand, `?welcome=0` on the app URL does
  the same thing, and `dev-fresh.sh` now prints that URL on startup.

### Changed

- First-run presentation now opens with Detection `DENSE` at 75%, `ELASTIC`
  allocation, Fade 7%, Outside 1%, scope feather 11%, and aircraft 3D models in
  `PROXIMITY`. Stored state and share links still override these baselines.
- The 17 selected README GIFs remain unchanged and are documented separately
  from the two owner-published PNGs.
- Bundled datacenter and dam snapshots now omit contact-oriented fields and
  note values containing email or phone identifiers. Feature geometry, names,
  operator/capacity/river metadata, counts, and ODbL terms are unchanged.
- Public documentation and the L9 release matrix no longer reference non-public
  planning material or repository history.
- Camera frames are now polled at the publisher's own cadence where it is known.
  The Grand Lyon feed republishes once a minute, so the active-camera poll drops
  from every 10 s to every 60 s — five of every six requests were re-fetching a
  picture the client already had. Packs that do not declare a cadence are
  unchanged.
- A provider "image unavailable" placeholder is no longer reported as a healthy
  snapshot. It is recognised by content hash, routed into the existing Street
  View / synthetic fallback chain, and named in the health line.
- An incomplete camera frame — a JPEG that ends before its scan data, which a
  browser paints as a thin strip of the top of the image — is likewise no longer
  reported as a healthy snapshot. It takes the same fallback chain, and the
  health line says the frame was incomplete.

### Fixed

- A retired or corrupted `map=` share parameter no longer raises a credential
  error about a source nobody asked for. An unrecognized id now resolves to the
  build's own default stack (`photoreal` when it is available, otherwise the
  first source that is), instead of unconditionally to `photoreal`.
- The `set_map_stack` voice tool and its toast quoted a hard-coded "requires a
  Cesium ion token" for **every** unavailable stack. They now quote the
  controller's own reason, so a keyless build stops sending operators after the
  wrong credential.
- The Data attribution popover listed the French transit source twice: a
  three-way merge of two branches that had each added it once left the entry
  duplicated verbatim. Credits are now registered by key, so that class of
  merge accident cannot reach the popover again.
- The full-resolution CCTV viewer no longer boxes every frame at 16:9. Its
  geometry rule was losing on CSS specificity to the panel's own `#cctv-frame`
  rule, so a camera with a different aspect ratio was letterboxed inside a shape
  it does not have.
- A missing optional FIRMS key no longer turns the complete Environmental
  mission into `LOAD FAILED`. The FIRMS row still reports `KEY REQUIRED`, while
  earthquakes continue to load. Real lifecycle and fetch failures retain
  failure priority.
- The mapped-installations layer retries after an unavailable request when it is
  enabled or the camera settles.
- Aircraft trails attach to the rendered aircraft transform and remain near the
  rear center across headings. Parked aircraft do not draw a moving head
  segment.
- Grounded aircraft keep validated floor evidence through temporary terrain
  outages and wait for measured photoreal-surface evidence before a 3D model
  takes over from its billboard.
- Cockpit altitude uses aviation MSL data rather than Cesium render height.

### Security

- Production transitive dependencies resolve to patched DOMPurify and
  protobufjs releases without changing the Cesium version or application APIs.
- Production dependency audit reports no known advisories; remaining audit
  findings are confined to development and QA tooling.

## [Unreleased] — 2026-08-23

### Added

- Added a first-run mission launcher for Contacts, Space Missions,
  Environmental, and manual exploration.
- Added terrain-validity gating and bounded last-known placement for grounded
  aircraft models.

### Changed

- Environmental consistently presents both earthquakes and NASA FIRMS fires,
  with honest optional-key degradation.
- The tracked aircraft trail acceptance bar is visual: roughly rear-center,
  stable across headings, with minor hull overlap allowed and no conspicuous
  top, bottom, or lateral projection.

## [Unreleased] — 2026-08-18 to 2026-08-22

### Added

- Added the four-source Map Source tray, share-link v2 state, cockpit/context
  voice parity, MSL altitude readouts, and close-range tracked aircraft models.
- Added the L9 release-candidate matrix, AIS feed watchdog, voice cost controls,
  satellite classes, and the shared world-overlay host.
- Added deterministic first-run, map-source, floor, overlay, tracking, and
  aircraft-model regression harnesses.

### Changed

- Consolidated world labels, cards, tracked readouts, CCTV thumbnails, cable
  labels, mission labels, and detection presentation under shared allocation and
  lifecycle rules.
- Reduced idle rendering through the render governor and explicit scope mask.
- Improved cockpit layout, context restoration, keyless feed honesty, and
  aircraft 2D/3D handoffs.

### Fixed

- Fixed degenerate depth picks, map-source restore states, route-camera motion,
  bright-ground label readability, grounded display flooring, and cross-layer
  tracking cleanup.
- Fixed stale overlay callbacks, parked-idle render leaks, cable-label sweep
  starvation, and several share-link state conflicts.

## [Unreleased] — 2026-08-02 to 2026-08-16

### Added

- Added Global Context modes, Cockpit briefing surfaces, Radio context,
  satellite mission replay, and real per-class aircraft models with adjacent
  provenance records.
- Added a shared screen-space overlay system with bounded allocation for labels,
  cards, callouts, detection brackets, and selected-object presentation.

### Changed

- Unified right-side product controls and responsive cockpit/map layouts.
- Migrated public-safe neighborhood geometry to DataSF and tightened safe local
  development defaults.
- Improved proxy resilience, annotation outline bounds, CCTV enable pacing,
  contact de-emphasis, and deterministic visual stacking.

## [Unreleased] — July 2026

### Added

- Added live NASA FIRMS fires, optional live TomTom traffic, Caltrans and TfL
  CCTV packs, CCTV viewsheds and direct-manipulation calibration, citywide CCTV
  cards, Natural Earth regions, analyst queries, and voice routing QA.
- Added the end-to-end vertical-datum system for aircraft, vessels, CCTV,
  annotations, trails, and terrain-aware rendering.
- Added aircraft class silhouettes, path-derived display heading, ADSBDB
  enrichment, cached CelesTrak TLE lookup, and next-ISS-pass prediction.

### Fixed

- Fixed elevated-airport aircraft placement, vessel sea-surface placement,
  close-zoom FIRMS anchors, antimeridian region framing, annotation resolution,
  cross-layer tracking ownership, and CCTV projection lifecycle issues.

## [Unreleased] — June 2026

### Added

- Added OpenAI Realtime voice control, scene-aware entity context, viewport image
  grounding, the AI HUD summary, live AIS vessels, infrastructure layers, map
  source switching, free-text navigation, and server-side data proxies.
- Added hybrid map annotations, 3D aircraft, panoptic detection, tracking
  harnesses, and public data attribution.
- Added MIT source licensing, security guidance, contribution guidance, data
  source notices, and third-party asset boundaries.

### Changed

- Removed the experimental AI video-edit style and retained seven deterministic
  visual styles.
- Moved Realtime text-history trimming to the server-side retention policy while
  keeping only the latest viewport image in conversation context.

## [0.7.0] — 2026-02-18

- Added the Bikeshare Pulse layer and panoptic label improvements.
- Improved tracked-item boxes, post-render alignment, and CCTV projection
  quality.
- Removed the experimental shift-drag CCTV calibration interaction.

## [0.6.0] — 2026-02-10

- Added the initial multi-layer 3D globe experience, visual styles, live
  aircraft, satellites, earthquakes, CCTV, traffic, FIRMS, infrastructure, and
  performance controls.
- Added entity inspection, tracking, scenes, keyboard controls, and shareable
  views.

## [0.1.0] — 2026-02-09

- Initial project version.
