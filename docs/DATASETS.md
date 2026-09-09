# La boîte à datasets — brancher n'importe quel jeu de données

Mis à jour : 8 septembre 2026.

Ce document dit comment un jeu de données entre dans God's Eye View sans
écrire de couche, ce qu'il reçoit en entrant, et ce qu'il ne reçoit pas.
Il est le contrat ; le code est dans `src/data/dataset*.js`.

## Pourquoi

Avant ce chantier, ajouter une couche coûtait **17 à 23 fichiers** — mesuré
sur `medecins-fr`, `petite-enfance-fr` et `meteo-stations-fr` : un module de
2 000 lignes, un flux, un plugin de proxy de 300 lignes, un jeton de partage,
une ligne de taxonomie, un crédit, un alias vocal, deux tables du README, un
harnais QA. Onze de ces fichiers ne servaient qu'à **énoncer un fait** sur le
jeu : d'où il vient, dans quel groupe il s'affiche, qui le publie, sous quelle
licence. Un manifeste énonce ces faits une fois, en JSON, et la boîte en
dérive toutes les entrées de registre.

Le fossé n'était pas la donnée — les plateformes françaises répondent en CORS
ouvert, mesuré le 2026-09-08 : data.gouv.fr (API tabulaire, métadonnées,
redirection `r/<uuid>`, hôte statique), la Géoplateforme IGN (WFS) et les
portails Opendatasoft envoient tous `access-control-allow-origin: *`. Le
fossé était la **plomberie**. La boîte est cette plomberie, écrite une fois.

## Trois façons de brancher un jeu

### 1. Dans l'application — un sujet, ou une adresse

Sous la liste des couches, **＋ BRANCHER UN JEU DE DONNÉES**. Un seul champ
prend les deux, et le bouton dit lequel il a lu : **CHERCHER** pour des mots,
**ANALYSER** pour une adresse.

Un sujet — « défibrillateurs » — ouvre la **sélection**. Les cinq premiers
résultats de data.gouv.fr sont lus d'un coup, seuls ceux dont un brouillon
valide sont proposés, et chacun porte quatre faits lus sur la plateforme :
combien d'objets, qui publie, quelle fraîcheur, quelle licence. Ce qui a été
écarté est dit avec la raison en une phrase — « fichiers introuvables »,
« aucune colonne de position ». Rien n'est présélectionné : mesuré sur six
sujets, le premier résultat de la plateforme est le bon une fois sur deux, et
ses erreurs ressemblent à des succès (dix-neuf points d'un département là où
une base nationale de 186 118 était visée). C'est un arbitrage que seul le
lecteur peut faire, alors il le fait — `docs/DEMANDER-UNE-DONNEE.md` mesure ce
que cette sélection coûte et ce que le retour visuel a le droit d'afficher
pendant le chargement.

Une adresse collée saute la sélection et va droit au brouillon. La boîte lit ce que la plateforme
publie sur elle-même — titre, éditeur, licence, colonnes, un échantillon —,
devine comment une ligne se place, et montre le brouillon : nom, couleur,
ressource retenue (quand il y en a plusieurs), colonnes de position (avec la
raison de la supposition), et les notes qu'un lecteur attentif doit voir. Rien
n'est dessiné avant BRANCHER.

Adresses reconnues :

| Ce qu'on colle | Ce que la boîte fait |
|---|---|
| Page d'un jeu data.gouv.fr (`/datasets/<slug>/`) | choisit la ressource la plus lisible (GeoJSON, puis CSV, puis WFS), lit son profil sur l'API tabulaire |
| Ressource data.gouv.fr (`/datasets/r/<uuid>`, `#/resources/<uuid>`, un UUID nu) | la même chose, pour cette ressource |
| Page d'un jeu Opendatasoft (`/explore/dataset/<id>/`) | lit les métadonnées du portail, trouve le champ géographique |
| Un GetFeature WFS avec `typeNames=` | une couche WFS chargée pour la vue |
| Un `.geojson`, `.geojsonl`, `.csv` nu | le fichier, l'éditeur et la licence restant à compléter |

Le jeu branché est retenu **dans ce navigateur** (`localStorage`), avec son
état allumé/éteint. Le bouton ⧉ copie son manifeste : c'est le fichier à
déposer dans `datasets/` pour qu'il soit livré à tout le monde.

### 2. Dans le dépôt — un fichier JSON

Un fichier `datasets/<id>.json` suffit. Au prochain build, la couche est sur
le panneau, dans son groupe, avec sa ligne de source, son crédit dans la
fenêtre d'attribution, sa carte et sa légende. Le test
`src/data/datasetsCatalog.test.mjs` refuse tout manifeste qui ne valide pas —
la même discipline que les registres du cœur, où une couche sans catégorie
est une panne au démarrage.

Deux exemples sont livrés : les défibrillateurs GeoDAE (data.gouv.fr, API
tabulaire, chargés pour la vue) et les arbres remarquables de Paris
(Opendatasoft, jeu entier).

**Un manifeste n'est pas livré pour ce qu'une couche dessine déjà.** Les
emprises d'aérodromes de la BD TOPO ont eu le leur, et il a été retiré : la
couche Aéroports embarque 418 de ces emprises, jointes à OurAirports sur le
code OACI, et deux lignes dans la même liste pour le même sujet demandent au
lecteur d'arbitrer un recouvrement qu'il n'a pas les moyens de voir. Ce que la
jointure laisse dehors est écrit dans `src/data/airportsPack.js` — les 704
héliports de la BD TOPO (hôpitaux, casernes, gendarmeries) et les 30 contours,
surtout militaires, qu'aucun terrain du paquet ne réclame — et cela reste
branchable en une adresse : `BDTOPO_V3:aerodrome` sur
`https://data.geopf.fr/wfs/ows`, collé dans ＋ BRANCHER UN JEU DE DONNÉES.

### 3. En ligne de commande — depuis une recherche MCP

`.mcp.json` enregistre le serveur MCP officiel de data.gouv.fr pour
l'assistant qui accompagne un contributeur. Le chemin complet :

```
search_datasets("défibrillateurs")        ← MCP : trouver le jeu
list_dataset_resources("61556e1e…")       ← MCP : voir ses ressources
npm run dataset:manifest -- https://www.data.gouv.fr/datasets/geodae-base-nationale-des-defibrillateurs/
```

Le script lit la même API REST que le MCP enveloppe, écrit
`datasets/<id>.json`, imprime les colonnes, les notes, et rappelle que la
licence lue doit être confirmée sur la page du jeu. `--dry` imprime sans
écrire ; `--resource <uuid>` choisit une ressource ; `--id` renomme.

Le MCP reste hors du produit — son preflight CORS répond 403, ses réponses
sont de la prose, data.gouv.fr le qualifie d'expérimental. Il sert à trouver ;
la boîte sert à brancher.

## Le manifeste

```jsonc
{
  "id": "defibrillateurs-geodae",          // minuscules, chiffres, tirets — devient la couche ds-<id>
  "label": "Défibrillateurs (GeoDAE)",     // le nom du panneau
  "name": "Defibrillators GeoDAE",         // facultatif : nom canonique (voix, contexte LLM)
  "icon": "♥", "color": "#ff5c7a",         // facultatifs ; la couleur est tirée d'une palette stable sinon
  "category": "built-environment",         // facultatif : un des huit groupes, sinon « JEUX BRANCHÉS »
  "coverage": "fr",                        // global | fr | us | cities → la pastille de portée
  "cadence": "periodic",                   // live | periodic | static → la formule de fraîcheur
  "source": {
    "kind": "datagouv",                    // geojson | geojsonl | csv | datagouv | wfs | opendatasoft
    "resourceId": "edb6a9e1-…",            // datagouv ; sinon "url" (+ "typeName" WFS, "dataset" ODS)
    "scope": "viewport",                   // all | viewport (datagouv lon/lat, wfs, opendatasoft)
    "maxFeatures": 4000,                   // plafond, ≤ 30 000 (H3) — déclaré sur la ligne (A5)
    "maxSpanDeg": 1.5                      // au-delà, rien n'est demandé : « rapprochez-vous » (F6)
  },
  "geometry": { "lon": "c_long_coor1", "lat": "c_lat_coor1" },
  //  ou { "point": "coordonneesXY" }     une cellule : [lon,lat] JSON, "lat, lon" ODS, {lon,lat}
  //  ou { "wkt": "geom" }                POINT (x y)
  //  ou { "x": "x", "y": "y", "crs": "EPSG:2154" }   Lambert-93, reprojeté
  //  ou { "geojson": "geometry" }        une géométrie GeoJSON dans la cellule
  //  (inutile pour geojson, geojsonl, wfs, opendatasoft : la géométrie est native)
  "feature": {
    "title": ["c_nom", "c_adr_voie"],      // le premier champ non vide fait le titre
    "details": [ { "field": "c_com_nom", "label": "Commune" }, { "field": "puissance", "unit": "kW" } ],
    "group": {                             // facultatif : une couleur par valeur d'un champ
      "field": "c_acc",
      "styles": { "Extérieur": { "color": "#ff5c7a" }, "Intérieur": { "color": "#ffb3c0" } },
      "other": { "color": "#9aa7bd", "label": "Accès non renseigné" }
    }
  },
  "attribution": {                         // obligatoire — un jeu sans éditeur ni licence ne s'affiche pas
    "publisher": "Atlasanté — GeoDAE",
    "licence": "Licence Ouverte 2.0",
    "url": "https://www.data.gouv.fr/datasets/geodae-base-nationale-des-defibrillateurs/",
    "text": "Défibrillateurs : GeoDAE — Atlasanté (Licence Ouverte 2.0)"   // la ligne de crédit
  }
}
```

`datasetManifestFaults()` liste **toutes** les fautes d'un manifeste ;
`normalizeDatasetManifest()` pose les défauts et gèle le résultat. Un
manifeste normalisé revalide tel quel : c'est ce qui permet le stockage et
l'export.

## Ce qu'un jeu reçoit en entrant

Le chargeur GeoJSON local (`localGeojson.js`), celui des aéroports, des
barrages, des ports et des datacenters : les tiges de rappel, les cartes
ambiantes arbitrées à l'écran, l'occultation à l'horizon, l'échantillonnage du
sol, le clic qui sélectionne et cadre. Trois crochets l'ouvrent sans qu'il
apprenne quoi que ce soit des plateformes : `loadFeatures` (d'où viennent les
objets), `cardCopy` (ce que dit une carte) et `invalidate` (oublier pour
recharger).

Et ce que la doctrine (`docs/CARTOGRAPHIE.md`) exige d'une couche :

| Règle | Ce que la boîte fait |
|---|---|
| A5 · tout écrêtage se déclare | la ligne de la couche dit « 4 000 affichés sur 186 137 — plafond 4 000, premières lignes » |
| D1 · légende obligatoire là où la couleur porte une valeur | une entrée par groupe avec son effectif, ou un aplat unique nommé |
| E2 · le régime temporel est déclaré | `cadence` dans le manifeste → « instantané figé » / âge / flux |
| F6 · aucune couche à toutes les altitudes | `maxSpanDeg` : au-delà, la ligne dit « rapprochez-vous » comme une consigne, pas une panne |
| H1 · la frontière de la donnée est dite | « n dans la vue », « n objets, jeu entier », « n sans position », « via relais » |
| H3 · 20 000–30 000 objets, la frontière GeoJSON/tuiles | `maxFeatures` plafonné à 30 000 |
| A1 · jamais le même signe pour mesuré et supposé | une géométrie devinée est annoncée comme telle dans le brouillon, avant tout dessin |

## Chargé pour la vue

Une source `scope: "viewport"` est demandée pour le rectangle que la caméra
regarde, élargi de 20 % pour qu'un frémissement ne recharge pas, et
redemandée quand la vue sort de cette boîte — ou quand la réponse précédente
était écrêtée et que le lecteur s'est rapproché de moitié. Trois plateformes
savent répondre à une emprise :

- **data.gouv.fr** — l'API tabulaire, par pages de 200 lignes typées, avec
  `<colonne>__greater` / `__less` sur les colonnes de position. Le fichier
  IRVE fait 161 Mo ; la vue de Paris en demande 11 633 lignes. Une ressource
  jamais indexée retombe sur le fichier brut, sous un plafond de 24 Mo.
- **WFS** — `bbox=…,CRS:84`. `CRS:84` et non `EPSG:4326` : sur la
  Géoplateforme, une emprise lat/lon renvoie zéro objet là où lon/lat en
  renvoie quatre — mesuré.
- **Opendatasoft** — `where=in_bbox(champ, lat1, lon1, lat2, lon2)` sur
  l'export GeoJSON.

## Le relais `/api/plug`

Le navigateur parle directement aux plateformes. Le relais est le repli pour
celles qui refusent un en-tête `Origin` — l'INSEE répond 403 — et n'est
tenté qu'après un échec direct de la forme d'un échec CORS. Il est étroit par
construction : GET, https, hôtes sur liste blanche (`data.gouv.fr`,
`geopf.fr`, `ign.fr`, `opendatasoft.com`, `insee.fr`… — extensible par
`GEV_PLUG_HOSTS`), redirections suivies à la main et re-vérifiées, corps
plafonné à 24 Mo, aucun en-tête du client transmis, cache disque d'une heure
servi périmé une semaine en cas de panne amont, derrière la même porte
d'accès que toute route.

## Ce qu'un jeu branché ne reçoit pas — et pourquoi

- **Un jeton de lien de partage.** Le registre des jetons ne nomme que des
  couches que le code connaît ; un lien qui dirait « charge cette URL » ferait
  aller chercher à une autre machine ce que la première a tapé. Ce qui voyage
  est le manifeste, comme fichier.
- **Une place dans l'énumération vocale.** Elle est figée par un test (sha256
  sur l'outil). Mais l'exécuteur accepte tout identifiant enregistré : « allume
  ds-defibrillateurs-geodae » marche dès que la ligne existe.
- **Une choroplèthe, un prisme, un maillage.** La boîte dessine des points,
  des lignes et des polygones à leur place. Un jeu qui demande une
  discrétisation, un rapport à une population ou une extrusion est une couche,
  et se construit sur `choroplethPrism.js`, `franceDepartements.js`,
  `geoMeshThinning.js` comme les autres.
- **Une ligne dans la fiche d'adresse.** La radiographie enchaîne des routes,
  pas des couches ; son crochet (`{id, label, question, needs, project}`) est
  le prochain chantier, pas celui-ci.

## Combien de temps ça prend

Mesuré, banc par banc, dans `docs/DEMANDER-UNE-DONNEE.md` : de la recherche aux
premières marques, la machine met **1,7 s au médian** et jusqu'à 33 s au
plafond de 30 000 objets — et cette page dit aussi ce qu'un indicateur de
progression a le droit d'afficher pendant ce temps, et ce qu'il n'a pas le
droit d'inventer.

## Vérifier

```
npm test                                       # une soixantaine de tests sur la boîte, dont chaque manifeste livré
npm run qa:datasets -- --url http://localhost:4173          # le catalogue, l'inférence, plug/unplug, le formulaire, la persistance
npm run qa:datasets -- --url http://localhost:4173 --deep   # + le chargement réel d'un jeu data.gouv.fr branché par le formulaire, par l'API tabulaire (16 contrôles)
# --shots pour les captures (lentes sous SwiftShader), --gpu pour passer par Metal

npm run measure:plug -- --verify 5                          # ce que la chaîne coûte, plateforme par plateforme
npm run measure:plug:render -- --url http://localhost:4415 --gpu   # la même chaîne dans la page, jusqu'à la première image
```
