# Contours des marchés voisins — provenance & licence

`market_areas.geojson` donne à la couche **Mix électrique (FR)**
(`src/data/franceEnergy.js`) une emprise à tracer autour de chacune des cinq
zones de marché avec lesquelles éCO2mix publie un solde commercial. RTE ne
publie aucune géométrie : `ech_comm_angleterre`, `ech_comm_espagne`,
`ech_comm_italie`, `ech_comm_suisse` et `ech_comm_allemagne_belgique` sont cinq
nombres et un nom de pays. Le contour vient donc d'ailleurs.

## Provenance

| Fichier | Source | Licence | Récupéré |
|---|---|---|---|
| `market_areas.geojson` | **Natural Earth — `ne_50m_admin_0_countries`** (Nathaniel Vaughn Kelso & Tom Patterson), redistribué par [natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) | **Domaine public** (« no rights reserved ») | 2026-09-10 |

- **Téléchargé depuis :**
  `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson`
- **Preuve de licence :** Natural Earth déclare, sur sa page *Terms of Use*,
  *« All versions of Natural Earth raster + vector map data found on this
  website are in the public domain. You may use the maps in any manner,
  including modifying the content and design, electronic dissemination, and
  offset printing. The primary authors, Tom Patterson and Nathaniel Vaughn
  Kelso, and all other contributors renounce all financial claim to the maps
  and invites you to use them for personal, educational, and commercial
  purposes. No permission is needed to use Natural Earth. »*
  Le dépôt `nvkelso/natural-earth-vector` porte un `LICENSE.md` qui reprend ce
  texte et le complète d'une renonciation explicite au copyright.
- **Attribution conservée par courtoisie** (elle n'est pas exigée) :
  `Contours des pays : Natural Earth (domaine public).`

## Ce que le fichier contient, et ce qu'il ne contient pas

Généré par `scripts/build-energy-market-areas.mjs`, qui affiche à chaque
exécution le décompte avant / après. Dernière exécution : **2 281 → 674
points, 70 % d'allègement, 12 392 octets.**

Une entité par champ `ech_comm_*` — donc **quatre pays et un couple** :
`allemagne_belgique` porte l'Allemagne et la Belgique dans une seule entité,
parce qu'éCO2mix publie un seul solde pour les deux et qu'un contour étiqueté
séparément inventerait une répartition que la donnée ne porte pas.

Retiré volontairement, et pour des raisons qui ne sont pas seulement des
octets :

- **L'Irlande du Nord**, absente du contour britannique. La contrepartie
  d'`ech_comm_angleterre` est la zone de marché GB ; l'Irlande du Nord échange
  dans le SEM insulaire avec la République et n'en fait pas partie.
- **Les Baléares et les Canaries**, absentes du contour espagnol. Ce sont des
  systèmes insulaires propres, pas le marché péninsulaire contre lequel
  `ech_comm_espagne` se règle. Le fichier dessine le **marché** espagnol, pas
  l'**État** espagnol.
- **Les îlots** (Shetland, Anglesey, Rügen) : sous le seuil de 0,5 degré carré,
  invisibles à l'altitude où la couche se lit.

La Sicile et la Sardaigne sont **conservées** : ce sont deux zones du marché
italien, et `ech_comm_italie` se règle contre son agrégat.

## Ce que le contour n'est pas

Ce n'est **pas** une carte des interconnexions. Le tracé délimite la zone de
marché ; il ne dit rien de l'endroit où les câbles franchissent la frontière.
La flèche qui part du littoral français part du **point du contour français le
plus proche du point de référence du marché** — un fait géométrique, calculé,
et pas un poste de conversion.
