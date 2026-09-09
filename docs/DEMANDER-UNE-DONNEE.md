# Demander une donnée à voix haute — ce que la chaîne coûte

Mesuré le 9 septembre 2026. Les trois bancs sont dans le dépôt ; tout chiffre
de cette page vient d'une de leurs sorties, et rien d'autre n'y est écrit.

Le scénario visé : le lecteur demande si telle donnée existe, l'agent cherche,
propose, le lecteur valide, l'agent branche, la carte s'allume. La boîte à
datasets (`docs/DATASETS.md`) tient déjà la moitié droite de cette chaîne —
d'une adresse à une couche dessinée. Cette page mesure la chaîne **entière**,
pour répondre à deux questions : combien de temps elle dure, et ce qu'on peut
honnêtement afficher pendant ce temps.

## Les bancs

```
npm run measure:plug                  # les plateformes, depuis Node — 6 sujets × 3 passes
npm run measure:plug -- --verify 5    # la même chose, mais 5 candidats prouvés avant de proposer
npm run measure:plug:render -- --url http://localhost:4415 --gpu   # la même chaîne DANS la page
npm run measure:voice-turn -- --url http://localhost:4415          # les deux tours de voix
```

`--gpu` compte : sous SwiftShader la première image met 1 790 ms là où Metal en
met 370. Les nombres du rasteriseur logiciel ne sont pas des nombres de lecteur.

## Le chiffre

Dans la page, sur Metal, 9 passes qui ont toutes dessiné :

| étape | min | médiane | max |
|---|---|---|---|
| chercher (data.gouv, api/2) | 134 ms | **211 ms** | 352 ms |
| lire 5 candidats à la fois | 152 ms | **291 ms** | 1 163 ms |
| brancher → premiers objets (*cache chaud*) | 52 ms | **99 ms** | 6 627 ms |
| → première image | 183 ms | **370 ms** | 2 740 ms |

**La ligne « brancher » de ce tableau est chaude, et c'est un piège.** Le
harnais rejoue le même jeu trois fois de suite ; à partir de la deuxième, les
pages sont dans le cache du navigateur. Repris à froid, une seule fois, jeu
jamais demandé :

| ce qu'on mesure vraiment | mesuré |
|---|---|
| charger le jeu seul, à froid (25–28 requêtes, 5 000 objets) | **2 464 – 5 889 ms** |
| brancher quand la donnée est déjà chaude | **488 ms** |
| brancher à froid, de bout en bout, jusqu'aux marques | **12 696 ms** |

Donc, honnêtement : **chercher et proposer prend une demi-seconde à une
seconde et demie ; dessiner prend 2,5 à 13 secondes.** L'attente n'est pas où
je l'avais dite au premier passage — elle est après le « oui », pas avant.

## Ce qui n'est pas mesuré, et ne doit pas être inventé

Les deux tours de voix qui encadrent cette chaîne — comprendre la question et
émettre l'appel d'outil, puis prononcer la proposition — **n'ont jamais été
chronométrés ici**. `OPENAI_API_KEY` est vide à la racine et dans tous les
workspaces ; `/api/realtime/token` répond `503 OPENAI_API_KEY is not set`.
`scripts/measure-voice-turn.mjs` est écrit pour ces deux bornes, contre les
instructions et les outils de production, et n'a jamais tourné une seule fois.
Il tourne à la minute où une clé est posée dans le `.env` **racine**.

Tant qu'il n'a pas tourné, le total end to end reste **1,7 s de machine + deux
tours de voix inconnus + le temps que le lecteur met à dire oui**. Écrire un
total complet aujourd'hui serait exactement le genre de chiffre que cette page
existe pour interdire.

## La vraie limite n'est pas la latence

Sur les six sujets demandés, la chaîne naïve — prendre le premier résultat —
aboutit **9 fois sur 18**. En lisant les cinq premiers candidats d'un coup et
en ne proposant que ceux qui valident, elle aboutit **12 fois sur 18**. Le prix
est faible parce que les cinq lectures sont indépendantes et bornées par le
réseau : la médiane de l'étape passe de 361 ms à 529 ms, soit **170 ms** pour
cinq fois plus de preuves. Ce que la vérification achète n'est pas de la
vitesse, c'est de ne jamais proposer un jeu avant de l'avoir prouvé
dessinable.

Ce qu'elle attrape, mesuré :

| demandé | ce que le classement met en tête | ce qui se passe |
|---|---|---|
| arbres remarquables Paris | `arbres-remarquables-donnees-geographiques-ods`, Ville de Paris | **zombie** : ses 3 ressources répondent 404 (`r/<uuid>` et profil tabulaire), le jeu reste premier. Le hit n°3 marche — 185 objets, ODbL |
| accidents corporels | les bases annuelles du ministère, 106 ressources | aucune colonne de position déclarée → le brouillon ne valide pas. Le candidat suivant valide puis **dépasse le plafond de 24 Mo au chargement** |
| bornes de recharge | le jeu des Hauts-de-Seine, 19 points | valide, dessiné, **et faux** : la base nationale ODRÉ est le hit n°2 |
| nids de frelons | rien | 0 candidat en ~110 ms — un « non » honnête et immédiat |

Trois enseignements, dans l'ordre où ils coûtent :

1. **Un jeu qui valide peut encore échouer au chargement.** Le cas des
   accidents échoue *après* que le lecteur a dit oui — la pire place pour une
   panne. La vérification sonde la forme, pas encore la taille.
2. **Aucun classement automatique ne répare ça.** Les Hauts-de-Seine passent
   devant la base nationale parce que data.gouv les a mis premiers ; re-trier
   par effectif dirait « le plus gros est le plus pertinent », ce qui est faux
   dès qu'on regarde Paris. C'est un arbitrage que la machine n'a pas les
   moyens de faire.
3. **La latence n'est pas le problème.** C'est la justesse de la proposition
   qui décide si la chaîne sert à quelque chose.

D'où ce qui a été livré à la place d'un choix automatique : **la sélection**.
Le panneau montre les candidats prouvés dessinables, chacun sous quatre faits
lus sur la plateforme — combien d'objets, qui publie, quelle fraîcheur, quelle
licence — et le lecteur choisit. Ce qui a été écarté est listé avec la raison
en une phrase. Rien n'est étoilé ni présélectionné ; l'ordre de pertinence de
data.gouv est conservé tel quel, parce que nous n'avons pas mieux.

## Ce qu'on peut afficher — et ce qu'on ne peut pas

Le chargement paginé est la seule étape qui porte un dénominateur vrai : la
première page de l'API tabulaire ramène `meta.total`, donc `min(total,
maxFeatures)` est connu **exactement** dès la première réponse. Tout le reste
de la chaîne est une poignée de requêtes de durée inconnue.

Le pire cas mesuré, GeoDAE sur la France entière au plafond de 30 000 :
**33,4 s**, 150 requêtes (le plafond `TABULAR_MAX_REQUESTS`, atteint), 37,1 Mo,
30 000 objets sur 182 587. Page : min 122 ms, médiane 242 ms, p90 291 ms.
Au plafond de 5 000, le même jeu : **3,3 s**, 25 requêtes, 6,1 Mo.

Et c'est 5 000 qui compte ici : `inferDatasetManifest()` ne pose jamais de
`maxFeatures`, donc un jeu branché par la voix hérite du défaut
(`DATASET_DEFAULT_MAX_FEATURES`). Les 33 secondes ne sont atteignables que par
un manifeste écrit à la main qui réclame le plafond de 30 000 — soit un fichier
de `datasets/`, relu par quelqu'un, pas une demande orale.

Une estimation du temps restant, extrapolée de la médiane des pages **déjà
reçues dans cette tâche-ci** :

| tâche | après 10 % | après 20 % | après 50 % |
|---|---|---|---|
| 150 pages (33,4 s) | +11 % | +9 % | +7 % |
| 25 pages (3,3 s) | **−45 %** (2 pages) | −8 % | +4 % |

D'où cinq règles, chacune tirée d'une ligne ci-dessus :

1. **Un pourcentage seulement là où il y a un dénominateur.** Deux endroits :
   les candidats lus (k sur n) et les lignes chargées (n sur `min(total,
   maxFeatures)`). Nulle part ailleurs.
2. **Jamais de pourcentage sur la tâche entière.** Le lecteur est au milieu de
   la chaîne, et le volume à charger est inconnu tant qu'il n'a pas dit oui.
   Une barre unique de la question aux marques devrait inventer son milieu.
3. **Un temps restant seulement après 5 pages ET 20 % de la tâche, et
   seulement s'il reste plus de 3 secondes.** Sous ce seuil l'extrapolation se
   trompe de moitié (−45 % à deux pages), et de toute façon le compte à rebours
   disparaît avant que l'œil s'y pose. C'est `datasetRemainingMs()`, et les
   trois seuils sont des constantes exportées, pas des nombres enfouis.
4. **L'arrondi doit être plus grossier que l'erreur.** ±10 % sur 33 s font ±3 s :
   on écrit « environ 30 secondes » et on descend par pas de 5, jamais « 32 s ».
5. **Ce qui est toujours vrai, c'est l'étape nommée.** « je cherche » → « 119
   jeux, j'en vérifie 5 » → « 3 sont exploitables » → « je charge, 4 200 sur
   30 000 ». Chacune de ces phrases est vérifiable à l'instant où elle
   s'affiche. Le temps restant vient s'y ajouter quand la règle 3 l'autorise,
   et pas avant.

## Ce qui est livré

La ligne de statut du panneau, relevée sur une vraie session, telle qu'elle
change :

```
     7 ms  « Géo'DAE — Base Nationale des Défibrillateurs » — chargement…
   495 ms  …  — 200 sur 5 000
  1466 ms  …  — 1 000 sur 5 000 — environ 5 secondes     ← 20 % atteints
  3055 ms  …  — 2 400 sur 5 000 — environ 5 secondes
  3665 ms  …  — 2 800 sur 5 000                          ← moins de 3 s : le temps disparaît
  6477 ms  …  — 4 800 sur 5 000
 12468 ms  « Géo'DAE — Base Nationale des Défibrillateurs » — 1 321 dans la vue.
```

La fraction est exacte de la première page à la dernière ; le temps restant
apparaît quand la règle 3 l'autorise et s'efface quand elle ne l'autorise plus.
La dernière ligne n'est pas une barre remplie : c'est la ligne de couverture de
la couche, celle qui dit aussi « 5 000 affichés sur 18 630 — plafond 5 000 » ou
« rien à cet endroit — déplacez ou rapprochez la vue ». **Une proposition est
une promesse ; les marques sont la seule preuve**, et c'est cette phrase-là qui
la donne.

Un mot sur les fractions qui repartent de zéro : un jeu chargé pour la vue est
redemandé quand la vue change. Si le lecteur branche pendant que la caméra vole
encore, il voit deux comptes se succéder — « 4 800 sur 5 000 » puis « 400 sur
1 321 ». Les deux sont vrais ; le second est celui de la vue où il a atterri.
