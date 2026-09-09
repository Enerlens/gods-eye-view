# Plan des croisements de données

*État de l'audit du 2026-09 sur les 61 lignes du panneau `DATA LAYERS` : ce qui
a été livré, ce qui reste dû, et — pour chaque point resté dehors — la raison
qui l'a fait rester dehors. Un plan qui ne dit pas pourquoi il s'arrête est une
liste de vœux.*

**Mise à jour du 2026-09-09, seconde passe.** Les huit points listés comme
« reste dû » ont été repris. Sept sont livrés ; le huitième l'est aussi, sous
une forme différente de celle qui était prévue. Le fait le plus utile de cette
passe n'est aucun des sept : c'est que **cinq des huit obstacles annoncés
n'existaient pas**, ou pas sous la forme écrite. Ils sont conservés ci-dessous,
avec ce que la vérification a trouvé, parce qu'un plan qui efface ses erreurs
d'estimation ne dit plus rien sur la manière dont il estime.

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

## Le tableau d'affichage, et ce qu'il est devenu

`src/data/layerJoins.js`. Une couche offre un fait sous une clé, une autre le
lit, aucune ne s'importe. Trois propriétés : aucun arc d'import, l'absence est
ordinaire (`null`, et le consommateur en dit **moins**), un `throw` est contenu
et averti une fois.

La seconde passe lui a ajouté **une seule chose** : `watchJoin(clé, f)`, qui
prévient quand une clé apparaît ou disparaît. `askJoin` est une *lecture*, ce
qui est juste pour une fiche — elle demande au moment où elle se dessine — mais
un **retrait** doit être immédiat : attendre le sondage suivant laisserait le
doublon à l'écran un quart d'heure. Le signal ne se déclenche que sur les
transitions de PRÉSENCE, jamais sur une republication.

---

## Livré, première passe

### Les fusions — 61 lignes → 38

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

### Les croisements branchés dessus

| Croisement | Ce qu'il ajoute | Clés |
|---|---|---|
| Navire → port | `→ Antwerpen · 26 km` au lieu de `→ BEANR` | `ports/directory` |
| Navire → mer | `MER SLIGHT · 1 m · bouée 62170 à 128 km` | `buoys/nearest` |
| Vol → destination | `AUS → LAX · 1 994 km` | — |
| Aéroport → ciel | `1 en approche — TVF57PQ` | `flights/boundFor` |
| Centrale hydro → eau | `≋ 560 m³/s à 2,7 km — station Le Rhône à Tarascon` | `gauges/nearest` |
| Centrale hydro → ouvrage | `▰ Barrage de Saint-Nicolas à 1,2 km` | `dams/nearest` |

### La porte vers la radiographie

`src/data/ficheSheet.js` — la pastille `RADIOGRAPHIE` sur la ligne
`Zone de chalandise` encadre `fiche.html` sur le point que le globe scanne. Et
la feuille lit **dix-sept routes au lieu de quinze**.

---

## Livré, seconde passe

### 1. Une centrale, une marque

`src/data/plantIdentity.js`. **69 des 108 stations RTE sont un site EDF** et
**55 centrales hydro sont un groupe RTE** (43 remontent jusqu'à EDF) :
Grand-Maison était dessinée trois fois.

L'obstacle annoncé — « une colonne vertébrale à écrire, choisir quelle source
fait foi pour la position » — **était déjà écrite, par les scripts de
fabrication du dépôt**. `build-rte-units-registry.mjs` pose 69 stations sur la
coordonnée publiée par EDF et note laquelle : `placementRef:
'edf:nucleaire:GRAVELINES'`. La question de la position était tranchée depuis la
fabrication. Le second lien est le code **EIC**, que les deux paquets ODRÉ
portent l'un et l'autre. Aucune règle de proximité : la Grand-Maison d'EDF est à
540 m du Verney, et ce sont deux ouvrages.

La carte qui survit nomme la puissance de l'autre registre **quand les deux ne
s'accordent pas** : 43 des 69 paires s'accordent au mégawatt près, et les 12 qui
dépassent 5 % sont des trouvailles (Flamanville 2 660 contre 4 280 — l'EPR).

### 2. Un cabinet, un point

`amenities-fr` dessine la BPE D265 et `medecins-fr` le registre conventionné :
le même cabinet, deux fois. L'obstacle annoncé était réel mais mal placé :
`AMENITY_FAMILIES` **est** une clé de cache, et en retirer un élément renomme
chaque ligne de chaque paquet en cache. C'est le prix de la **suppression**. Ne
pas dessiner la famille pendant qu'une autre couche le fait ne coûte rien — et
seulement quand `medecins-fr` dessine des POSITIONS, car à l'échelle nationale
elle peint un aplat d'accessibilité et ne dessine aucun cabinet.

### 3. Le bâtiment comme pivot

`src/data/buildingDossier.js`. Un clic sur un volume BD TOPO dit maintenant ce
que ce sol a valu, ce qui y a été autorisé et ce que le PLU y permet.

L'obstacle annoncé — « des requêtes réseau déclenchées par une carte, ce que le
dépôt ne fait nulle part » — était faux deux fois. Le motif existe
(`cadastreParcels.selectParcel`, et la couche bâtiments elle-même pour le RNB),
et **aucune requête n'est nécessaire** : DVF, Sitadel et le GPU sont déjà
chargés pour la même vue. La clé est le numéro de parcelle à 14 caractères,
vérifié sur données vivantes — 4 500 parcelles du paquet de Paris assemblées,
3 des 89 parcelles vendues d'un disque de 300 m portent aussi un permis.

### 4. IRVE et QualiCharge — « libre maintenant »

`src/data/irveLive.js`. L'obstacle était réel et la table manquante existe : un
export à plat de trois colonnes du fichier consolidé, **227 007 lignes, 8,4 Mo,
17 s**, d'où **99,6 %** des bornes de QualiCharge se joignent. Un piège trouvé
en chemin : **9,34 % des identifiants de borne désignent plus d'un endroit**,
dont l'identifiant littéral `Non concerné` à 117 coordonnées sur 7 302 km. Au-delà
de 50 m de contradiction la borne est refusée — 92,4 % se joignent quand même.

La carte ne change pas : capacité installée, aucune couleur de disponibilité.
Ce qui change est une ligne sur la fiche d'un site, avec son dénominateur (ce
dont le flux a parlé, jamais ce qui est installé) et son âge.

### 5. Une semaine type partagée

`src/data/weekHourCursor.js`. Trois couches dessinent une semaine ARCHIVÉE type
et vivent sur trois lignes différentes ; en voir deux à la fois dessinait deux
heures différentes côte à côte.

L'obstacle annoncé était la grammaire de partage — « les trois encodent leur
heure séparément et des liens déjà envoyés en dépendent ». **C'était faux** :
`comptages-fr` et `idfm-frequency` sont `enabled-only` et n'ont jamais mis leur
heure dans un lien, et `velo-pulse-fr` encode un mode. La décision est donc
l'inverse de celle qui était attendue : **un jeton partagé (`wh`), pas trois**,
et c'est la première clé capable d'exprimer « mardi 8 h ».

### 6. Vigilance et tronçons

L'audit disait « beaucoup de machinerie pour une étiquette d'une ligne », avec
deux obstacles. Aucun ne tient. L'étiquette est un TEXTE — elle n'a pas besoin
d'être cliquable pour porter un nom de plus. Et le point-dans-polygone n'est
cher que pour les 337 tronçons : hors épisode ils sont tous verts, aucun n'est
sur une étiquette, et le travail est proportionnel à ce qui est ÉLEVÉ. L'index
de contours existait déjà.

`Aude · Orange · Crues · Orbieu, Aude aval, Berre +1`, et un tronçon est nommé
dans chaque département qu'il traverse.

### 7. La destination AIS

`scripts/build-port-gazetteer.mjs`. Les deux familles rattrapables — ports
fluviaux et exonymes — demandaient la même chose, une table de noms **avec une
source** : UN/LOCODE (ODC-PDDL) décide ce qui est un port, GeoNames (CC BY 4.0)
ne sert qu'à *compléter* une ligne déjà choisie. Mesuré sur 1 924 navires
vivants : **50,4 % → 68,9 %**.

Un nom qui s'accorde de loin est refusé plus durement qu'avant : 268 bonnes
correspondances de 0 à 415 km, un trou, 9 mauvaises à partir de 622 km — plafond
à 500 km, dans le trou, appliqué **par entrée**.

### 8. Les trajets de vol au-delà du contact suivi

`flights/boundFor` répondait 0 partout sur une session fraîche. L'obstacle était
réel — élargir aurait dépensé un seau dimensionné contre une autre demande — et
la réponse était de mesurer. Les deux demandes ne sont pas la même flotte : un
type se demande sur l'adresse hexadécimale, un trajet sur l'INDICATIF, et seul
un indicatif de compagnie peut aboutir (573 des 726 contacts en vol à Paris).
D'où un **second seau**, plafond 600 et recharge 100, et un rendement mesuré :
30 indicatifs sur 40 donnent une route.

---

## Ce que la seconde passe a trouvé en chemin

Trois défauts qu'aucun des huit points ne visait, tous trouvés par la
vérification plutôt que par la lecture :

- **`qa-enrich-budget` comparait ses mesures au plafond de 300** alors qu'il
  valait 1 000 depuis quatre jours : il affichait « le plafond NE COUVRE PAS la
  première vue » à propos d'un plafond qui la couvrait.
- **`København` se repliait sur `K BENHAVN`.** La normalisation Unicode sépare
  `Ê` mais ne touche pas `ø`, `æ`, `ß`, `þ`, `ł` ; 174 noms du gazetteer avaient
  une clé trouée et ne pouvaient rencontrer aucune saisie.
- **`locateDepartement` répond un CODE, pas un enregistrement**, et la jointure
  vigilance ↔ tronçons lisait `?.code` dessus. Elle n'aurait jamais nommé une
  seule rivière, en silence, pour toujours. Trouvé par un test avant la carte.

---

## Ce qui reste dû

Trois choses, toutes nées de la seconde passe plutôt que de l'audit :

1. **Grand-Maison est encore dessinée deux fois si RTE est éteint.** Le lien
   EDF ↔ hydro passe par le `placementRef` de RTE, donc il n'existe que tant
   que cette ligne est allumée. Le fermer demanderait soit une table
   d'identités fabriquée hors ligne, soit une règle de proximité — et la
   mesure des 540 m entre Grand-Maison et Le Verney dit pourquoi ce ne sera
   pas la seconde.
2. **Les 5 centrales gaz que `gas-fr` partage avec EDF gardent leurs deux
   marques.** C'est délibéré : `gas-fr` dessine le SYSTÈME gazier, et la
   centrale y est l'endroit où le gaz devient de l'électricité. Deux lignes
   différentes qui dessinent le même objet pour deux sujets différents est
   légitime ; ce qui ne l'était pas, les mégawatts contradictoires, est réglé
   par la ligne de fiche.
3. **Le contrôle d'heure partagé n'a pas de surface à lui.** Il se pilote
   depuis les pastilles des trois couches, ce qui suffit à faire de « mardi
   8 h » un geste, mais un lecteur qui n'a aucune des trois lignes allumée n'a
   aucun moyen de poser l'heure avant de les allumer.
