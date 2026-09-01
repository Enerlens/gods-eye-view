# Où les médecins exercent, en France, avec une coordonnée

Deux fichiers, que la future couche **Médecins (FR)** doit dessiner :

- `medecins.json` — chaque adresse de France où un médecin exerce sous
  convention, sa coordonnée, ce qui s'y pratique, et l'**APL** de la DREES ;
- `praticiens.jsonl` — les praticiens nommés, une ligne par adresse, dans le
  même ordre que `sites[]`.

Ils existent pour une raison simple et gênante : **le registre national des
médecins n'a pas de coordonnées, et toutes les copies géocodées qui circulent
ont une décennie.**

Reconstruire :

```
npm run medecins:registry                   # écrit les deux fichiers
npm run medecins:registry -- --report       # + l'audit précision / couverture
npm run medecins:registry -- --verifier     # + le contrôle contre l'effectif CNAM
npm run medecins:registry -- --refresh      # re-télécharge, ignore le cache
npm run medecins:registry -- --no-cds       # sans les centres de santé
npm run medecins:registry -- --no-apl       # sans l'indicateur d'accessibilité
npm run medecins:registry -- --praticiens   # + le CSV par praticien dans .gev-cache/
npm run medecins:registry -- --plain        # écrit les deux sorties en clair
```

## L'état des lieux, vérifié le 2026-09-01

**La source qui fait autorité est aveugle.** La CNAM publie l'[Annuaire santé
Ameli](https://www.data.gouv.fr/datasets/annuaire-sante-ameli)
(`annuaire-sante-ameli`, Licence Ouverte 2.0, hebdomadaire) sous l'article
L. 1461-2 du Code de la santé publique. Édition du 17/08/2026 : **555 249
lignes, dont 194 114 médecins**. Son bloc adresse s'appelle `coordonnees_*` et
le mot est un faux ami — `coordonnees_voie`, `coordonnees_code_postal`,
`coordonnees_num_tel` : ce sont les *coordonnées* au sens de « comment vous
joindre ». **Il n'y a pas une seule latitude dans le fichier.**

**Les copies géocodées existent, et il ne faut pas s'en servir.** Opendatasoft
publie `medecins` avec un vrai `geo_point_2d` et une API Explore v2.1 qui
rendrait ce script inutile ; une douzaine de portails territoriaux la fédèrent
(Île-de-France, Aix-Marseille, Orléans, Blois, Gers, Soissons…) — vérifié pour
l'Île-de-France : même horodatage de traitement, c'est le même jeu filtré. Tous
descendent de l'annuaire CNAM **précédent**, remplacé fin 2025, et l'âge se lit
dans leurs propres colonnes :

- leur champ convention dit encore *« Secteur 2, Signature du contrat d'accès
  aux soins »*. Le CAS est fermé aux nouvelles signatures depuis le
  **31/12/2016** et remplacé par l'OPTAM — ce que publie le fichier actuel ;
- ils comptent **128 721 professionnels distincts, toutes professions
  confondues** (dentistes et sages-femmes inclus), contre 117 922 médecins
  nommés ici ;
- leur champ `references` pointe vers
  `data.gouv.fr/fr/datasets/annuaire-sante-de-la-cnam/`, qui répond **404**
  (l'API redirige vers un slug `-deprecie` qui ne résout pas non plus).

Ce n'est pas un miroir en retard, c'est une autre décennie.

**Le seul registre national géocodé quotidiennement est fermé.** Atlasanté
publie la couche RPPS géocodée par les géoservices IGN, avec une API GeoJSON.
Elle répond `HTTP 403 — "Accès interdit aux données en consultation"` hors
réseau ARS.

**Les autres pistes, et pourquoi elles ne remplacent pas celle-ci :**

| Source | Ce qu'elle donne | Pourquoi elle ne suffit pas |
| --- | --- | --- |
| **ANS — extraction RPPS** (LO 2.0, **quotidienne**) | Tous les professionnels autorisés à exercer, salariés compris. 817 Mo | Aucune coordonnée non plus. C'est le complément exhaustif, pas le raccourci |
| **API FHIR Annuaire Santé** (ANS) | Le même annuaire en REST | Clé requise, et pas de coordonnée davantage |
| **Santé.fr — accessibilité des cabinets** (LO 2.0) | RPPS + adresse + accessibilité handicap, déclarée par le praticien | Déclaratif et partiel ; pas de coordonnée |
| **FINESS — Structures** (ANS, LO 2.0, quotidienne) | Les établissements, pas les praticiens | Un CHU n'est pas un cabinet |
| **OpenStreetMap** (ODbL) | **31 747 nœuds `amenity=doctors`** en métropole (2026-09-01) | Un quart de la vérité, sans spécialité ni secteur conventionnel |

## Est-ce qu'on est dans le vrai ?

Oui, et c'est mesurable, parce que **la CNAM publie aussi son propre décompte de
la même population** — [`demographie-exercices-liberaux`](https://www.data.gouv.fr/datasets/professionnels-de-sante-liberaux-effectif-par-type-dexercice-liberal-et-par-territoire-departement-region)
sur `data.ameli.fr`, effectif libéral exclusif + mixte, millésime 2024. C'est le
contrôle idéal : même éditeur, même champ, une agrégation indépendante de la
nôtre. `--verifier` le rejoue à la demande.

| | CNAM 2024 | nous (2026-08-17) | écart |
| --- | ---: | ---: | ---: |
| **Ensemble des médecins** | **112 159** | **117 922** | **+5,1 %** |
| Médecins généralistes | 55 546 | 58 969 | +6,2 % |
| Chirurgiens | 8 003 | 8 418 | +5,2 % |
| Psychiatres | 6 308 | 6 542 | +3,7 % |
| Radiologues | 5 677 | 6 015 | +6,0 % |
| Cardiologues | 5 018 | 5 247 | +4,6 % |
| Ophtalmologues | 4 287 | 4 477 | +4,4 % |
| Anesthésistes-réanimateurs | 3 946 | 4 136 | +4,8 % |
| Hépato-gastro-entérologues | 2 020 | 2 042 | +1,1 % |
| Rhumatologues | 1 432 | 1 410 | **−1,5 %** |

23 professions appariées, écart de **−1,5 % à +15,1 %**, l'essentiel entre +2 et
+6 %. Et surtout, l'écart est du bon côté et pour des raisons nommables :

- **ce registre est un ANNUAIRE, le contrôle est un compte d'ACTIVITÉ.** La
  démographie CNAM compte les médecins qui ont facturé ; l'annuaire liste ceux
  qui sont conventionnés. Un annuaire est toujours le plus grand des deux ;
- **deux ans séparent les deux** (millésime 2024 contre édition d'août 2026) ;
- **les noms fusionnent les homonymes** — ce qui tire vers le BAS, pas vers le
  haut, donc le vrai écart est un peu plus grand que +5,1 %, pas plus petit ;
- inversement, un même médecin orthographié différemment sur deux sites
  (nom composé, nom d'usage, accent) compte deux fois.

**La géographie tient aussi**, et c'est ce qui compte pour une carte : contre
les effectifs départementaux de la CNAM, **écart médian +2,1 %, et 97
départements sur 101 dans [−10 %, +15 %]**. Aucun département n'est aberrant —
donc le géocodage n'a pas déporté de population d'un département vers un autre.

**Ancrage indépendant.** La [DREES, sur le RPPS au 1er janvier
2025](https://drees.solidarites-sante.gouv.fr/communique-de-presse/250728_CP-demographie-des-professionnels-de-sante),
compte **237 200 médecins en activité**, dont 42 % en libéral exclusif et 13 %
en mixte — soit ≈ 130 000 médecins ayant une activité libérale. Nos 117 922 se
placent entre le compte d'activité de la CNAM (112 159) et le compte
d'inscription de la DREES (≈ 130 000). C'est exactement là qu'un annuaire de
conventionnés doit tomber.

## Ce qu'il y a dedans

Mesuré sur l'édition du 17/08/2026 :

- **203 200 entrées médecin** — 194 114 du fichier PS (exercice libéral) et
  9 086 du fichier CDS (2 375 centres de santé sur 2 346 adresses) — réduites à
  **64 625 adresses distinctes**.
- **64 232 adresses localisées, 99,4 %.** `sites[]`, un tuple par adresse :
  `[lat, lon, précision, insee, cp, ville, voie, tél, type, [[spécialité, n], …], nPraticiens, adresseRegistre]`.
  `cp` et `ville` sont ceux de la **BAN**, pas ceux du registre : le registre
  écrit `75651 PARIS CEDEX 13` là où une fiche doit lire « 75013 Paris ».
  `adresseRegistre` porte l'orthographe du registre quand les deux divergent —
  9,7 % des adresses — et une chaîne vide sinon.
- **193 293 praticiens nommés** dans `praticiens.jsonl`, une ligne par site :
  `[[nom, civilité, spécialité, secteur, option tarifaire], …]`.
- **APL 2024 sur 34 890 communes**, et **64 043 des 64 232 sites appariés
  (99,7 %)**.
- **393 adresses non localisées, 0,6 %** — `nonLocalisees[]`, nommées et non
  effacées.
- **Les deux fichiers sont livrés gzippés** : `medecins.json.gz` 2,0 Mo et
  `praticiens.jsonl.gz` 1,5 Mo, contre 8,9 + 7,3 = **16,2 Mo en clair**.
  `npm run medecins:registry -- --plain` écrit la version lisible ; le proxy et
  les tests lisent celle des deux qui est présente.

### Pourquoi les noms sont dans un second fichier

Les inliner dans `medecins.json` a été mesuré d'abord : **+4,9 Mo sur un fichier
de 7,3 Mo**, téléchargés intégralement pour dessiner des points qui n'affichent
jamais un nom. `praticiens.jsonl` a une ligne par site, dans l'ordre de
`sites[]` — pas de clé de jointure, rien à indexer, et un index par offset
d'octet reste trivial à construire le jour où la fiche passera par un proxy.
Une ligne vide `[]` est un centre de santé, qui ne publie pas de noms : ce n'est
pas la même affirmation que « pas de médecin ici », et c'est pourquoi le tally
`[[spécialité, n]]` du site compte ces lignes-là et le fichier des noms non.

### La précision est publiée, parce qu'elle varie

| Précision | Adresses | Ce que c'est |
| --- | ---: | --- |
| `numero` | 53 456 (82,7 %) | La porte exacte |
| `voie` | 9 366 (14,5 %) | La rue, pas le numéro |
| `lieu-dit` | 682 (1,1 %) | Un lieu-dit |
| `commune` | 728 (1,1 %) | **Le centre du bourg — pas un cabinet** |

Un consommateur qui dessine les quatre de la même façon revendique une
précision que la source n'a jamais donnée. Même règle que la couche écoles.

### Trois passes de géocodage, et pourquoi trois

Une passe BAN filtrée sur le code postal place 60 702 adresses. Les échecs ne
sont pas de mauvaises adresses — ce sont des **CEDEX** : le registre écrit
`57085 METZ CEDEX 03` là où va un code postal, et c'est une identité de tri
postal, pas un lieu.

1. `voie` + `ville`, **filtré** sur `code_postal` → 60 702.
2. Les échecs, CEDEX et CS/BP/TSA retirés, **filtre postal abandonné** → 2 983.
3. Ce qui manque encore, `ville` seule, centre de commune accepté → 547.

Les passes 2 et 3 lâchent le filtre postal, donc elles peuvent matcher une
commune homonyme à quatre départements de là. Chaque résultat est vérifié contre
le département du code postal d'origine et **jeté** en cas de désaccord — 511 en
passe 2, 381 en passe 3. Placer un cabinet messin dans le Var serait pire que de
ne pas le placer.

Une exception est câblée, et une seule : **Saint-Martin (977) et
Saint-Barthélemy (978) ont quitté la Guadeloupe en 2007 en gardant leurs codes
postaux `971xx`**, donc le registre écrit `971` là où BAN répond `977`/`978`.
Les trois départements sont déclarés équivalents. Effet mesuré : **1 adresse** —
c'est une correction de justesse, pas de rappel.

### Une quatrième passe : quand BAN suit le code postal contre la ville

Le filtre `postcode` de BAN est un filtre **dur**, et le code postal du registre
n'est pas toujours celui de sa commune. La ligne
`1100 RUE DE GENEVE / 01220 / DAGNEUX` nomme Dagneux, dont le code postal est
01120 ; 01220 est celui de Divonne-les-Bains. La passe 1 honore le code postal,
trouve une rue de Genève à Divonne, et place ce médecin **à 99 km de son
cabinet** — avec une précision `numero` et un score confiant, parce que du point
de vue de BAN rien ne s'est mal passé.

Le build confronte donc chaque position à la **liste officielle des communes**
(`geo.api.gouv.fr`, 34 969 communes) : si la commune retenue n'est pas celle que
le registre nomme et qu'elle en est à plus de 15 km, il **redemande** l'adresse
sans filtre postal et n'accepte la réponse que si elle tombe dans la bonne
commune ; sinon il ramène le point au **centre de la commune du registre**, à
la précision `commune`, plutôt que d'afficher un numéro de rue qui est une
fiction. Mesuré : **32 sites suspects, 21 replacés à leur adresse, 11 ramenés au
centre de la commune** — `stats.reparations` les publie.

## L'APL : ce que l'unité veut dire, vraiment

L'unité publiée est *« consultations, visites et téléconsultations accessibles
par habitant standardisé et par an »*, et telle quelle elle ne dit rien à
personne. Sa clé de lecture est dans la note méthodologique de la DREES :
**un généraliste à plein temps = 5 400 consultations par an**. Donc

- `APL × population ÷ 5 400` = **le nombre de généralistes à plein temps
  auxquels cette commune a réellement accès**, voisins compris ;
- `APL × 100 000 ÷ 5 400` = la même chose en densité : la France à 3,26, c'est
  **60 généralistes équivalent temps plein pour 100 000 habitants**.

Ce n'est **pas** une densité au sens usuel : l'indicateur compte l'offre des
communes voisines pondérée par le temps de trajet, borne l'activité de chaque
médecin pour ne retenir que l'offre soutenable, et standardise la population
par l'âge — un canton de retraités a plus de besoins qu'un quartier d'étudiants
à population égale. C'est précisément pour ça qu'il existe : la DREES l'a
construit pour remplacer la « distance au professionnel le plus proche », qui
en France ne mesure presque rien (voir la section suivante).

**Le chiffre de référence est celui des médecins de 65 ans ou moins.** C'est la
série que la DREES publie et que tout le monde cite — *« 3,3 consultations par
an et par habitant en 2024 »*. Lire la colonne tous âges à la place répond 3,72
et met en désaccord avec toutes les publications. Le builder prend donc
`apl65` comme tête de série.

**Vérifié bout en bout** : sur les trois millésimes du classeur, ce code
reproduit la table officielle *« Indicateurs d'APL moyens par dixièmes de
population »* de la DREES — moyenne 3,34 / 3,29 / 3,26 contre 3,34 / 3,29 /
3,26 publiés, 1er dixième 1,47 / 1,39 / 1,32 contre 1,47 / 1,38 / 1,32, à ±0,02
sur le dernier dixième (arrondi des valeurs communales à deux décimales).

### Situer une commune, plutôt que citer un nombre

« 2,36 consultations par habitant » n'est pas actionnable. « Cette commune est
dans le 3ᵉ dixième — les 30 % de France les moins bien dotés » l'est.
`apl.dixiemes` publie les dix déciles de population et `apl.bornes` la valeur
qui ferme chacun, donc n'importe quelle commune se place. Les seuils des
zonages ARS complètent : **sous-dotée à 2,5 ou moins**, bien dotée au-delà de 4.

Deux règles de pondération, toutes deux structurantes et toutes deux faciles à
rater — la note DREES est explicite : la **moyenne** se pondère par la
population **standardisée**, les **déciles et les comptages sous un seuil** par
la population **totale**. Les intervertir change la réponse.

### La falaise des départs

Les trois colonnes de recalcul sont ce qui existe de plus proche d'un « et dans
cinq ans ». France, millésime 2024 :

| | APL | |
| --- | ---: | ---: |
| tous les généralistes | 3,73 | |
| sans les ≥ 65 ans | 3,27 | −12 % |
| sans les ≥ 62 ans | 2,91 | **−22 %** |
| sans les ≥ 60 ans | 2,70 | −27 % |

Les départements qui perdraient le plus au départ des ≥ 62 ans : l'Yonne
(2,52 → 1,65, −35 %), la Haute-Corse (−34 %), l'Eure-et-Loir (−33 %), la Guyane
(−33 %), la Creuse (−32 %), l'Essonne (−31 %).

### Couverture

**189 sites sur 64 232 n'ont pas d'APL**, explicable ligne à ligne : 72 à
Marseille, où BAN a répondu le code commune `13055` au lieu d'un arrondissement
(la DREES publie par arrondissement) ; 61 à Saint-Martin et Saint-Barthélemy,
hors champ ; **54 à Mayotte, que l'indicateur exclut explicitement** (« France
hors Mayotte ») ; 2 isolés.

## Les questions que les gens posent réellement

### « Y a-t-il un médecin près de chez moi ? » — presque toujours oui

Distance du centre de chaque commune au praticien le plus proche, pondérée par
la population (34 878 communes, 68,4 M d'habitants) :

| Spécialité | Sites | Distance médiane | > 15 km | > 30 km |
| --- | ---: | ---: | ---: | ---: |
| **Médecin généraliste** | 36 032 | **0,7 km** | **0,2 %** | 0,2 % |
| Ophtalmologiste | 4 873 | 2,4 km | 8,6 % | 0,7 % |
| Cardiologue | 4 311 | 2,6 km | 10,6 % | 1,1 % |
| Psychiatre | 5 838 | 2,8 km | 13,0 % | 2,1 % |
| Gynécologue / obstétricien | 3 951 | 3,1 km | 14,1 % | 2,0 % |
| Pédiatre | 2 531 | 3,6 km | 17,2 % | 3,9 % |
| Dermatologue | 2 478 | 3,8 km | 17,6 % | 3,3 % |

**5,8 % de la population vit à plus de 5 km d'un généraliste, 0,49 % à plus de
10 km.** Les extrêmes sont tous en Guyane : Maripasoula, 9 579 habitants,
241 km. Autrement dit **la distance n'est pas le problème français pour la
médecine générale** — et c'est exactement ce que l'APL existe pour dire :
le problème n'est pas « à quelle distance » mais « y aura-t-il de la place ».

Pour les spécialistes, c'est l'inverse : **un Français sur six est à plus de
15 km d'un pédiatre ou d'un dermatologue**. Là, la distance est la vraie
réponse, et ce fichier la porte.

### « Combien ça va me coûter ? »

Part des entrées par secteur conventionnel — le secteur 2 sans OPTAM, ce sont
les honoraires libres :

| Spécialité | Secteur 1 | Secteur 2 + OPTAM | **Secteur 2 seul** |
| --- | ---: | ---: | ---: |
| Médecin généraliste | 94 % | 2 % | **2 %** |
| Pédiatre | 42 % | 30 % | **28 %** |
| Psychiatre | 49 % | 18 % | **32 %** |
| Dermatologue | 41 % | 14 % | **43 %** |
| Gynécologue / obstétricien | 16 % | 29 % | **55 %** |
| Ophtalmologiste | 18 % | 19 % | **63 %** |
| Chirurgien orthopédiste | 6 % | 28 % | **65 %** |
| Chirurgien plasticien | 4 % | 6 % | **84 %** |

Chez le généraliste la question ne se pose quasiment pas ; chez
l'ophtalmologiste, **deux praticiens sur trois fixent leurs honoraires
librement**. C'est une information que le fichier porte par praticien, pas
seulement en moyenne.

### Ce que ce fichier ne peut PAS répondre

Et il vaut mieux le dire que le simuler :

- **« Prend-il de nouveaux patients ? »** — nulle part dans le registre.
- **« Quel délai pour un rendez-vous ? »** — non plus.
- **« Est-il vraiment là le mardi ? »** — l'ancien annuaire CNAM portait des
  horaires ; le nouveau fichier Ameli ne les publie plus.

## Quatre pièges, mesurés

**1. Le registre n'a aucun identifiant.** Ni RPPS, ni ADELI, ni SIRET — un nom,
une spécialité, une adresse. Donc « combien y a-t-il de médecins » n'a pas de
réponse exacte ici : le fichier publie **187 584 tuples (nom, prénom, adresse)**
et **117 922 noms distincts**, et le vrai nombre est entre les deux, plus près
du second. Le contrôle CNAM ci-dessus est là pour dire de combien.

**2. Une entrée n'est pas une personne, et l'écart dépend de la spécialité.**

Tous les chiffres de ce README portent sur les **adresses localisées**, la
seule base que la carte dessine — d'où 58 969 généralistes ici et 59 145 si l'on
compte aussi les 393 adresses que BAN n'a pas placées.

| Spécialité | Entrées | Noms distincts | Entrées par nom |
| --- | ---: | ---: | ---: |
| Médecin généraliste | 69 405 | 58 969 | **1,18** |
| Psychiatre | 7 592 | 6 487 | 1,17 |
| Cardiologue | 10 549 | 5 247 | 2,01 |
| Ophtalmologiste | 10 915 | 4 477 | 2,44 |
| **Radiologue** | 33 270 | 6 015 | **5,53** |

Un radiologue est listé à chaque site d'imagerie qu'il couvre. Une carte qui
dimensionne ses points sur les entrées fera de la radiologie la deuxième
spécialité de France, à 16 % — elle ne l'est pas. `nPraticiens`, le dernier
champ de chaque site, est le compte de noms distincts pour cette raison.

**3. Le registre épelle une spécialité de plusieurs façons.** `01`, `22` et `23`
disent tous les trois `Médecin généraliste` — 60 207, 6 897 et 688 lignes — sans
rien dans les colonnes publiées pour les distinguer. `33`/`75` sont tous deux
`Psychiatre` ; `07`/`70`/`77`/`79` tous `Gynécologue / Obstétricien`. Grouper
par code — le geste évident — **perd 7 585 généralistes, 11 % d'entre eux**. Le
fichier replie sur le libellé et publie le repli dans `specialitesAlias`.

**4. Un médecin sur treize exerce dans plusieurs départements.** 9 328 sur
117 922, jusqu'à six départements chacun. Compter les noms distincts *dans*
chaque département et additionner les colonnes en compte donc **12 408 deux fois
ou plus** : la somme donne 130 330 pour un pays qui en a 117 922, soit +16,2 %
au lieu de +5,1 % contre le contrôle CNAM — et un écart médian départemental de
+15,4 % au lieu de +2,1 %. `departements[dep][0]` affecte chaque médecin à **un
seul** département, celui où il a le plus d'entrées, et la colonne **somme
exactement à `stats.medecinsNommes`**. Ne la recalculez pas.

## Ce que ce fichier ne peut pas dire

C'est **l'exercice libéral conventionné**, et lui seul. Un médecin salarié
hospitalier n'y est pas — d'où une carte qui s'éclaircit autour d'un CHU plutôt
que de s'y allumer. Le registre exhaustif de tous ceux qui sont autorisés à
exercer est l'extraction RPPS de l'ANS : quotidienne, 817 Mo, et sans coordonnée
non plus.

## Ce que coûte la couche, mesuré

Tout est chiffré sur une session complète — vue nationale, maillage, ville, puis
trente micro-déplacements — lue par l'API *Resource Timing* du navigateur.

| | avant | après | |
| --- | ---: | ---: | ---: |
| **Session complète, octets réseau** | 3 360 kio | **593 kio** | 5,7× |
| `/mesh` | 1 445 kio | **361 kio** | 4,0× |
| `/sites`, boîte dense sur Paris | 1 451 kio | **163 kio** | 8,9× |
| `/national` | 9 kio | **4 kio** | 2,1× |
| Les deux artefacts dans le dépôt | 16,18 Mo | **3,67 Mo** | 4,4× |

Quatre décisions, chacune avec son prix :

1. **Tout est gzippé sur le fil.** Vite compresse le graphe de modules qu'il
   sert, pas les routes ajoutées : avant ça, chacune partait en clair. Les deux
   charges qui ne varient jamais (`/national`, `/mesh`) sont sérialisées et
   compressées **une fois** puis servies telles quelles. Sous 1 kio la
   compression est sautée — elle rendait une réponse de 68 octets plus grosse
   que l'original.
2. **Les noms ont quitté `/sites`.** Sur une boîte dense parisienne ils
   pesaient **40 % de 1 451 kio** : 16 069 noms envoyés pour dessiner 5 907
   points, dont un lecteur en ouvre un. Ils sont désormais demandés par
   `/praticiens?index=N` au clic, et mis en cache par adresse.
3. **Une vue déjà servie ne coûte rien.** `moveEnd` et `changed` se déclenchent
   tous deux sur un même geste, et le rectangle de Cesium diffère entre les
   deux à la douzième décimale — assez pour redemander deux fois la même boîte
   de 800 kio. La clé de vue est quantifiée à 1e-4° (≈ 11 m, soit un
   six-millième de la boîte la plus étroite). Une requête supplantée est
   **annulée**, pas laissée arriver pour être jetée.
4. **Le balayage des sites passe par une grille** de 0,25°, donc il est borné
   par ce qui est à l'écran et non par la taille de la France.

Ce qui n'a **pas** été optimisé, faute de preuve : la sélection du maillage
coûte 2,5 ms pour 64 232 lignes, sur un événement caméra qui n'arrive pas à
chaque image — un index spatial côté client aurait ajouté de la complexité pour
un gain invisible. Et le rendu Cesium mesure 0,4 ms par image avec la couche
active.

Le prix du gzip sur les artefacts : **15 ms de `gunzipSync` au premier appel du
proxy**, une fois par processus, contre 12,5 Mo à chaque clone, chaque CI et
chaque image de conteneur.

## Attribution

Redistribution sous Licence Ouverte 2.0, attribution obligatoire, date de
dernière mise à jour comprise :

> Annuaire santé Ameli — Caisse nationale de l'Assurance Maladie
> (data.gouv.fr), édition du 17/08/2026. Licence Ouverte 2.0.
> Accessibilité potentielle localisée (APL) 2024 aux médecins généralistes —
> DREES. Licence Ouverte 2.0.
> Géocodage : Base Adresse Nationale (api-adresse.data.gouv.fr), Licence
> Ouverte 2.0.

Les fichiers contiennent des données à caractère personnel relatives aux
professionnels de santé — nom, civilité, spécialité, adresse d'exercice,
secteur conventionnel — publiées en open data au titre de l'article L. 1461-2 du
Code de la santé publique.
