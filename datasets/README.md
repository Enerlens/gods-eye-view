# `datasets/` — les manifestes livrés

Un fichier JSON par jeu de données, nommé d'après son `id`. Au build, chaque
manifeste devient une couche du panneau (`ds-<id>`) : groupe, ligne de source,
crédit, carte et légende sont dérivés du fichier. Le contrat complet est dans
[`docs/DATASETS.md`](../docs/DATASETS.md).

Pour en produire un depuis une adresse :

```
npm run dataset:manifest -- <page data.gouv.fr | ressource | portail Opendatasoft | WFS | .geojson | .csv>
```

`src/data/datasetsCatalog.test.mjs` refuse tout manifeste qui ne valide pas,
qui nomme un groupe inconnu, ou dont le nom de fichier ne suit pas l'`id`.

La licence d'un manifeste est **lue** sur la plateforme et **confirmée** sur
la page du jeu avant d'être livrée — jamais sur la foi d'une réponse d'API ou
de MCP.
