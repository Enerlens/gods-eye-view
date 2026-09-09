# Plan performance — fluide sur un petit ordinateur, hébergé à coût tenable

> État des lieux mesuré le 2026-09-09 sur `main` (3115c15), puis plan d'action
> pour un exécuteur. Ce document dit **ce qui coûte, combien, où c'est dans le
> code, et dans quel ordre le réduire**. Chaque tâche porte sa mesure et son
> critère de sortie : une tâche qui ne bouge pas le chiffre est annulée, pas
> gardée « parce que c'est propre ». `docs/PERFORMANCE.md` garde la référence
> M5 d'août ; ici c'est la machine faible qui compte.

## 0. Ce que vaut « petit ordinateur »

Machine de référence : portable 2018-2020, 2 cœurs (i3/i5 U), **GPU intégré
Intel UHD 620**, 8 Go, écran 1366×768, Chrome, connexion domestique ou 4G à
**10 Mbit/s**. C'est la machine d'un élu, d'un agent de mairie, d'un
journaliste local. Le profil de mesure qui l'imite en laboratoire :
CPU ÷4, 10 Mbit/s / 60 ms, 1366×768, cache vide.

Ce que le laboratoire ne mesure pas — **corrigé le 2026-09-09, la prémisse
était fausse.** Ce paragraphe disait : « Chromium headless rend en SwiftShader
(logiciel), donc les coûts GPU fixes (MSAA, post-traitement,
`preserveDrawingBuffer`) ne se voient que sur une vraie machine faible ».
C'était vrai de l'ANCIEN mode headless. `headless: 'new'` est le navigateur
complet avec la fenêtre supprimée : sur ce Mac, le contexte GL de Cesium
lui-même répond `ANGLE (Apple, ANGLE Metal Renderer: Apple M5)`. **Le banc
tourne sur un vrai GPU depuis le début**, et les quatre leviers de la tâche 2.2
y sont mesurables — `npm run perf:gpu-ab` les relève un par un.

Ce que le laboratoire ne mesure toujours pas, en revanche :

- **Le GPU d'une UHD 620.** Un M5 est un ordre de grandeur au-dessus. Le banc
  compense en rendant à N× la résolution (`--scale`), ce qui reproduit le
  **rapport** des coûts bornés par le remplissage de pixels, pas leur valeur
  absolue. Un classement est donc mesurable ici ; un p90 de sortie de phase 2,
  non. C'est toujours la tâche 0.3.
- **Une machine dont le CPU ET le GPU sont lents en même temps.** `--cpu 4`
  bride le fil principal et laisse le GPU à pleine vitesse ; la machine du § 0
  n'a pas ce luxe. Les temps d'image de `perf:boot` mélangent donc un CPU bridé
  et un GPU rapide, et restent comparables entre deux runs de la même sonde,
  pas à un portable réel.

## 1. État des lieux mesuré (2026-09-09)

### 1.1 Démarrage à froid — 3,5 Mo de coque, 7 Mo avec les tuiles

`node scripts/perf-boot-urls.mjs` (cache désactivé, 1366×768, zéro couche) :

| Objet | Sur le fil | Note |
|---|---:|---|
| `cesium-1.138.0/Cesium.js` | **1 656 kB** gz (5,7 Mo brut) | build IIFE monolithique, `window.Cesium`, aucun tree-shaking |
| `assets/index-*.js` | **775 kB** gz (2,5 Mo brut) | **les 55 modules de couches importés statiquement** dans `src/main.js:8-62`, plus `ui.js` (462 kB source), `satellite.js`, `mgrs`, `pbf`, `@mapbox/vector-tile` |
| Skybox étoiles `tycho2t3_80_*.jpg` ×6 | **848 kB** | fond d'étoiles Cesium par défaut, chargé à chaque démarrage |
| Material Symbols Outlined (Google Fonts) | **323 kB** | police variable complète pour **24 glyphes** utilisés |
| Inter + JetBrains Mono (Google Fonts) | ~90 kB | 3 feuilles CSS tierces **bloquantes** avant le premier rendu |
| `approximateTerrainHeights.json` | 97 kB gz | nécessaire aux GroundPrimitive, à garder |
| `IAU2006_XYS_18.json`, `moonSmall.jpg` | 45 kB | tirés par le skybox / soleil-lune |
| CSS app + widgets | 41 kB gz | |
| **Total** | **3,83 Mo, 40 requêtes** | hors tuiles d'imagerie |

> **Corrigé le 2026-09-09 (deuxième passe).** Le total de 3,83 Mo ci-dessus a
> été relevé sur un boot où le 3D Tiles Google a répondu 404 et où le globe est
> resté **sans imagerie**. Ce n'est pas le cas normal : sur cinq boots répétés
> avec les clés du `.env` racine, les tuiles chargent, et le coût réel d'un
> démarrage à froid mesuré sur la fenêtre de 25 s est de **7,07 Mo
> [6,95–7,85] sur 254 [217–372] requêtes** — dont 120 à 260 requêtes vers
> `assets.ion.cesium.com` (terrain mondial) et 54 à 69 vers
> `tile.googleapis.com` (2D roadmap). Les deux chiffres comptent, mais ils ne
> se cumulent pas dans la même colonne et n'ont pas les mêmes leviers, alors
> `perf:boot` les sépare désormais : `shell=` (tout ce qu'il faut payer pour
> obtenir un `viewer`) et `window=` (coque + tuiles à 25 s). La coque est ce
> que la phase 1 attaque ; les tuiles sont la phase 2.3.

Deux détails qui ne se voient qu'au fil : la feuille `Material Icons Round`
est chargée mais sa police n'est **jamais demandée** (lien mort, à retirer), et
au boot la page dépense des clés avant toute action. Le compte exact, tracé au
`fetch` : **cinq appels facturés à t≈6,3 s**, à la fin du vol d'intro —
`/api/openai/hud-summary`, `/api/google/nearby-places`, et **trois géocodages
inverses `maps.googleapis.com` lancés depuis le navigateur, la clé dans
l'URL**. Le déclencheur est le `moveEnd` du vol d'intro lui-même : personne n'a
rien touché. Une page ouverte à tous est alors une page que n'importe qui peut
facturer, en la rechargeant en boucle.

Sur staging, le premier visiteur payait 5,06 Mo / 28 requêtes à l'origine
avant les en-têtes `immutable` (`vite.config.js:25022-25054`) ; l'edge
Cloudflare répond maintenant `cf-cache-status: HIT` sur `/assets/*` et
`/cesium-*/*` (vérifié depuis le VPS le 2026-09-09), donc le coût d'origine
est réglé ; **le coût client, lui, reste entier** : la compression est gzip
seulement (pas de brotli), et 3,83 Mo se paient à chaque cache vide.

### 1.2 Temps de démarrage — `npm run perf:boot`, médiane de 5, dispersion incluse

| Profil | DOMContentLoaded | `viewer` prêt | 1ʳᵉ image | Coque | Fenêtre 25 s |
|---|---:|---:|---:|---:|---:|
| Mac, sans bridage | 0,6 s | **1,2 s** | 1,4 s | — | 3,83 Mo |
| **CPU ÷4, 10 Mbit/s** | 4,1 s [3,3–5,8] | **5,8 s [4,5–8,8]** | 6,1 s [4,6–9,9] | ~3,5 Mo | 7,07 Mo [6,95–7,85] |

La dispersion sur `viewer` est le vrai résultat : de 4,5 s à 8,8 s pour le même
arbre, sur la même machine, à la même minute. Le facteur du double n'est pas du
bruit de mesure, c'est la contention entre le parse des 8,2 Mo de JS et le flot
de tuiles qui démarre pendant. Une médiane sans cet intervalle aurait laissé
croire à un chiffre stable qu'on pourrait améliorer de 10 % ; ce qu'il faut
d'abord, c'est réduire ce qui se dispute le CPU.

À CPU ÷4 le DOMContentLoaded seul est à 4,1 s : c'est le **parse et compile
de 8,2 Mo de JavaScript brut**, pas le réseau (à 10 Mbit/s les 2,4 Mo de
scripts descendent en ~2 s). Le levier est donc la quantité de JS exécutée
avant le globe, pas seulement les octets.

Caveat de banc, **révisé** : le premier relevé concluait que le banc local
n'avait pas d'imagerie (404 Google, `imageryLayers: 0`). Faux comme règle : sur
dix boots répétés, un seul a échoué ainsi — les clés sont bien lues depuis le
`.env` racine, `/api/google/2d-session` répond, et le globe reçoit une couche
d'imagerie (`imageryLayers: 1`) plus le terrain mondial Cesium ion. Le banc
local mesure donc bien les tuiles ; ce qu'il ne mesure toujours pas, c'est le
GPU.

### 1.3 Rendu

- **Caméra en mouvement, zéro couche, CPU ÷4** (SwiftShader, relatif) :
  p50 17 ms, **p90 25 ms, p99 42 ms**, jusqu'à 17 images > 33 ms sur 5 s. Sans
  bridage : p90 21 ms, p99 28 ms. Donc même sans GPU, la charge CPU par image
  d'un globe nu déborde déjà le budget 30 fps sur une machine faible.
- **Parquée** : **15 rendus / 5 s [12–19]** dans la sonde (médiane de 5), et
  `qa-perf` à 19/24 — la fuite connue du world-overlay qui honore un reflow du
  HUD (machine à écrire 24 ms, `src/hud.js:629`) comme du travail de peinture.
  ✅ **Corrigée le 2026-09-09 : 0 rendu / 5 s, `qa-perf` 24/24.** La cause
  n'était pas celle qui était écrite ; voir la tâche 2.5.
- **Coûts GPU fixes, tous actifs par défaut, aucun n'est mesuré sur GPU
  intégré** :
  - `msaaSamples: 4` — `src/main.js:188` ;
  - `preserveDrawingBuffer: true` — `src/main.js:191` (copie à chaque image,
    pour les captures) ;
  - **netteté** (`sharpen`, 9 lectures de texture par pixel plein écran) ON à
    49 — `src/ui.js:403` ;
  - atmosphère + skybox + soleil/lune — `src/main.js:226-229` ;
  - détection **DENSE à 75 %** dès le premier chargement — `src/ui.js:417-421`
    (0 rendu parqué, mais un solveur + une peinture Canvas 2D par image en
    mouvement).
- **Aucune détection de capacité** : zéro occurrence de
  `hardwareConcurrency`, `deviceMemory`, `UNMASKED_RENDERER` dans `src/`. Un
  Celeron reçoit exactement la scène d'un M5.
- Le tileset Google photoréaliste est construit **sans aucune option**
  (`src/main.js:245-247`) : SSE 16 par défaut, pas de `cacheBytes`, pas de
  `skipLevelOfDetail`. Hors EEE c'est la pile de démarrage.
- Le globe est aux défauts Cesium : SSE 2 posé, ×2 en mouvement
  (`src/globeDetailGovernor.js:57`), `tileCacheSize` 100,
  `showWaterEffect` true (tire `waterNormals.jpg`, 294 kB, dès qu'une tuile a
  un masque d'eau).

### 1.4 Couches

- **Zéro couche allumée au boot** (`src/data/layerState.js:688-697`) : le
  démarrage est propre, le coût arrive au premier clic.
- **Quatre packs monde en `GeoJsonDataSource`** (aéroports 2,6 Mo, datacenters
  2,5 Mo, barrages 2,1 Mo, ports 1,1 Mo, `src/data/localGeojson.js:1160-1166`) :
  une Entity par objet, fichier entier, aucun tuilage. Datacenters seul :
  328 Mio de tas sur M5 ; câbles sous-marins : 412 Mio. La dette nommée dans
  `docs/CURRENT-STATE.md:158-162` — « bundled-infra globe-LOD declutter »,
  ~5 700 entités sur la Terre entière — est **la plus grosse dette de rendu du
  dépôt**, et la raison pour laquelle la tuile INFRASTRUCTURE du premier
  lancement a été retirée.
- 33 modules passent encore par `entities.add` / `CustomDataSource` (chemin
  lent : propriétés évaluées par image) contre 26 en `PointPrimitiveCollection`.
  Deux cas documentés : séismes à 32 ms/image par `CallbackProperty`
  (`docs/CURRENT-STATE.md:3588`), câbles à 9,5 ms/image avant refonte.
- Les couches FR à maillage (IRVE, écoles, équipements, ANFR, médecins)
  passent par `src/data/geoMeshThinning.js` avec des budgets 2 200 / 1 600 /
  1 100 : **fixes**, jamais adaptés au temps d'image.
- `PolylineCollection` ×14 sans pool : une polyligne masquée coûte ses sommets
  (mesuré 0,6 → 6,9 ms/image sur les pistes d'aéroport, mémoire
  `cesium-polylinecollection-traps`) ; le bâti BD TOPO reconstruit sa primitive
  entière à chaque déplacement (`src/data/bdtopoBuildings.js:698-711`) et
  décode les MVT sur le thread principal.
- Empilement d'imagerie sous les deux piles IGN, tenu par la mise en veille
  `_syncWorldBaseVisibility()` sur `moveEnd` (`src/mapStackController.js:847`).
  **Cette ligne disait « contrat mesuré, à ne pas toucher » ; c'était faux, et
  #121 l'a corrigé le 2026-09-09.** Le test de couverture exigeait que la vue
  tienne dans **une seule** boîte d'opacité : au tangage par défaut du cockpit
  (−30°), une vue de Paris à cheval sur deux boîtes n'était dans aucune, ne
  s'éteignait donc pas, et payait **69 requêtes / 1 362 ko d'Esri invisible**
  sous 927 ko d'IGN visible. Le test porte désormais sur l'**union** des boîtes,
  et les boîtes sont dérivées d'un balayage de la Géoplateforme
  (`npm run qa:ign-opaque-boxes`, 17 retenues sur 24 candidates) au lieu d'être
  dessinées à la main — deux des cinq anciennes contenaient un vrai trou.
  Imagerie de la vue Paris : 2 285 → **927 ko, −59 %**. La leçon de méthode
  vaut au-delà de cette ligne : « mesuré » ne veut rien dire sans la densité de
  la mesure, et les anciennes boîtes avaient passé un contrôle 9×9, soit un
  point tous les 0,56° sur une boîte de 4,5°.

### 1.5 Serveur et hébergement

- Production = `vite preview` dans un conteneur `node:24-bookworm-slim`
  (`Dockerfile`, `package.json:88`), derrière un tunnel cloudflared, sur un
  **KVM 2 partagé avec la production Enerlens** : 2 vCPU, 8 Go dont **188 Mo
  libres** (4,4 Go disponibles cache compris), 21 Go de disque sur 96.
  Conteneur GEV : 315 Mio, ~3 % CPU au repos, **aucune limite mémoire ni CPU
  dans `deploy/vps/docker-compose.yml`**.
- Ce qui est déjà bien : coalescence des requêtes amont (`coalesceProxyRequest`,
  39 usages), une seule connexion AISStream partagée, GTFS-RT décodé une fois
  côté serveur (16 ms par balayage national), caches mémoire + disque par
  service, limiteurs par IP. Vingt visiteurs simultanés ne créent **aucun état
  par client** : le serveur tient, c'est l'egress et la mémoire qui bornent.
- Ce qui manque : ~~brotli (gzip seul, `dep-*.js:48261`)~~ **fait le 2026-09-09,
  tâche 1.6**, limites de conteneur,
  `Cache-Control` sur `/models/*.glb` (servis `no-cache`, 3,2 Mo de modèles
  d'avions retéléchargés à chaque activation de couche), et la règle Cloudflare
  qui limite tout `/api` à 30 req/10 s (documentée dans `docs/DEPLOY.md:210-229`,
  à restreindre aux routes qui dépensent une clé).

## 2. Cibles

Toutes mesurées avec les outils de la phase 0, médiane de 3 à 5 passes,
dispersion notée. Une cible sans dispersion n'est pas une mesure.

Toutes les colonnes ont été relevées le 2026-09-09 (médiane de 5,
`[min–max]`). « Départ » inclut déjà 0.1, 1.2, 1.7 et 2.5 ; la colonne des
polices et des clés est repliée dedans pour garder le tableau lisible — son
détail est au journal, § 7.

| Cible | Départ | **+ skybox (1.1)** | **+ couches (1.3, #123)** | **+ brotli (1.6) et voix (1.3)** | **+ Cesium ESM (1.5 b)** | Objectif |
|---|---:|---:|---:|---:|---:|---:|
| Octets de l'app (hors tuiles), cache vide | 3,83 Mo [3,82–3,83] | 2,67 Mo [2,67–2,67] | 2,23 Mo [2,22–2,23] | 1,78 Mo [1,78–1,78] ✅ | **1,34 Mo [1,34–1,34]** ✅ | **≤ 1,8 Mo** |
| Requêtes de l'app (hors tuiles) | 36 | 29 | 29 | 38 † | **38** | — |
| Fenêtre 25 s, tuiles comprises | 7,07 Mo [6,95–7,85] | 5,90 Mo | 5,43 Mo | 5,01 Mo | **4,56 Mo** | *voir 2.3* |
| `viewer` prêt, CPU ÷4 / 10 Mbit/s | 5,8 s [4,5–8,8] | 3,57 s [3,55–3,62] | 3,22 s | 3,66 s [3,64–5,09] | **2,34 s [2,30–2,83]** ✅ | **≤ 3,5 s** |
| `viewer` prêt, CPU ÷4, cache chaud | non mesuré | non mesuré | **0,60 s [0,59–0,96]** ✅ | non repris | non repris | ≤ 1,5 s |
| JS brut exécuté avant le globe | 8,2 Mo | 8,2 Mo | 6,7 Mo (5,6 Cesium + 1,1 entrée) | 6,4 Mo (5,6 + 0,85) | **4,8 Mo** (3,9 + 0,83) | ≤ 4 Mo |
| Orbite 5 s, zéro couche, CPU ÷4 (relatif) | p90 32,5 / p99 44,3 ms | **p90 20,6 [18,4–21,5] / p99 23,8** ✅ p99 | non repris | *non séparé du bruit* | *non séparé du bruit* | **p90 ≤ 18 / p99 ≤ 33 ms** |
| Orbite 5 s, 3 couches FR, CPU ÷4 (relatif, SwiftShader) | non mesuré | non mesuré | **p90 19,5 [18,6–23,8] / p99 31,6 [21,5–34,9] ms** | non repris | non repris | — |
| Scène **parquée**, 3 couches FR | non mesuré | non mesuré | **301 rendus / 5 s [300–301]** — `transit-fr` tient le gouverneur en `continuous` | non repris | non repris | 0 sans couche animée ; **cadence à trancher** avec (voir 0.2) |
| Orbite 5 s, 3 couches FR, **UHD 620 réel** | non mesuré | non mesuré | **toujours non mesuré** (0.3) | non mesuré | non mesuré | p90 ≤ 33 ms, aucune image > 100 ms |
| Scène parquée, détection ON | 15 rendus / 5 s [12–19] | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | **0** (`qa-perf` 24/24 ✅) |
| Clés dépensées avant tout geste | 5 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | **0** |
| Tas JS, 3 couches FR allumées | non mesuré | non mesuré | **40 Mio [38–47]** ✅ | non repris | non repris | ≤ 250 Mio |
| 4 packs infra sur Terre entière | « le fps part avec » | inchangé | inchangé | inchangé | inchangé | p90 ≤ 33 ms sur la machine de référence |
| Origine : 50 démarrages à froid simultanés | non mesuré | non mesuré | **`/api` p95 34 ms · RSS 345 Mio** ✅ | non repris | **p95 150 ms · RSS 307 Mio · 130 boots/s** ✅ (phase 4) | `/api` p95 ≤ 1 s, conteneur ≤ 1 Gio |

> La colonne « Polices + clés » (0.1 / 1.2 / 1.7) est repliée dans « Départ »
> depuis l'ajout des colonnes de la phase 1, pour garder le tableau lisible ;
> son détail reste au journal, § 7. « Non repris » marque les lignes que #124 a
> relevées et que les passes suivantes n'ont pas re-mesurées : elles ne les
> touchent pas.
>
> **Mise à jour du même jour : #123 a atterri après ces relevés.** Le découpage
> du JavaScript (tâche 1.3) fait tomber les octets de l'app de **2,67 à
> 2,23 Mo [2,22–2,23]** — remesuré ici sur `main` à `50a8827`, médiane de 5 —
> donc **le jalon A (≤ 2,5 Mo) est franchi**, après l'avoir manqué de 0,17 Mo.
> La colonne `viewer` de ce relevé n'est **pas** exploitable : la charge moyenne
> du Mac était à **22,5** et l'intervalle s'ouvre à [3,26–4,84 s]. Le chiffre à
> retenir pour le temps est celui de #123, mesuré dos à dos sur une copie propre
> : **3,91 → 3,22 s**. Les lignes de rendu, de tas et d'origine ne bougent pas
> avec cette PR.

† Les neuf requêtes de plus sont les morceaux de la voix, qui arrivent
maintenant APRÈS le globe et dans la même fenêtre de 25 s. Les octets sont donc
inchangés à 0,01 Mo près, et c'est normal : 1.3 ne retire pas de code au
visiteur, elle le sort du chemin critique. La ligne qui bouge est celle du JS
analysé avant le globe.

**Les deux cibles de la phase 1 sont atteintes : 1,34 Mo pour un plancher à 1,8
et 2,34 s pour un plafond à 3,5.** Ce qui
reste ouvert sur cette ligne du tableau, c'est le TEMPS, et il ne se paie plus
en octets : la fermeture statique de `src/main.js` fait encore **2 708 kB avant
minification sur 121 modules** (relevé du graphe Rollup, pas au grep), et c'est
ce que le navigateur analyse avant de dessiner. Les deux colonnes marquées
« non séparé du bruit » l'ont été sur un Mac qui portait un autre agent
(load 4 à 28) ; elles se relèvent sur une machine au repos, pas ici.

La ligne « orbite » est à lire avec prudence : elle est relative (SwiftShader),
et son intervalle recouvre les deux colonnes. Rien dans cette passe ne visait le
coût par image en mouvement ; le gain apparent vient probablement de la
disparition de la machine à écrire, mais **il n'est pas séparé** et ne doit pas
être compté comme acquis avant la mesure sur GPU réel (phase 0.3).

## 3. Plan d'action

Chaque tâche : **quoi · où · comment mesurer · gain attendu · risque**.
Une tâche = une PR mesurée, avec le chiffre avant/après dans le corps de la PR.
Ne jamais empiler deux leviers dans une PR : on ne saurait plus lequel a payé
(leçon du 2026-09-02 : le report d'EGM96 en `requestIdleCallback` n'a **rien**
donné, et seul l'A/B l'a montré).

### Phase 0 — Le banc (½ à 1 jour)

**0.1 Promouvoir les deux sondes en outillage du dépôt.** ✅ **Faite.**
`npm run perf:boot`, `npm run perf:urls`, `npm run perf:layers` ; `--json` ;
`--cpu 4 --net 4g` par défaut ; `newQaPage()` et les trois drapeaux
anti-throttling en place ; dispersion `[min–max]` sur chaque colonne. Une
correction non prévue : la sonde sépare désormais **`shell=`** (les octets sur
le fil au moment où le `viewer` existe) de **`window=`** (coque + tuiles à
25 s), parce que la première version additionnait les deux et faisait passer un
boot où les tuiles avaient échoué pour une mesure de la coque.

*Rédaction d'origine :*
`scripts/perf-boot-probe.mjs` (profils CPU/réseau, fenêtre fixe, médiane,
requêtes par type, tas, images parquée/en mouvement) et
`scripts/perf-boot-urls.mjs` (liste par URL) existent déjà. Ajouter
`perf:boot` et `perf:urls` dans `package.json`, une sortie `--json`, et le
profil `--cpu 4 --net 4g` comme défaut documenté. Réutiliser `newQaPage()` de
`scripts/lib/qa-first-run.mjs` (carte de premier lancement) et les trois
drapeaux anti-throttling de `qa-perf.mjs`.

**0.2 Un scénario « 3 couches FR » reproductible.** ✅ **Faite le 2026-09-09.**
`npm run perf:layers` : Lyon à 12 km, tangage −45°, `irve-fr` + `schools-fr` +
`transit-fr` allumées après le boot, 15 s de stabilisation, médiane de 5 à
CPU ÷4 / 10 Mbit/s.

| Mesure | Zéro couche | 3 couches FR | Cible |
|---|---:|---:|---:|
| `viewer` prêt | 3 572 ms | 3 590 ms [3 557–4 007] | — |
| Tas JS | 25 Mio | **40 Mio [38–47]** ✅ | ≤ 250 Mio |
| Octets après l'allumage (15 s) | 1,51 Mo / 148 req | **3,98 Mo / 152 req** | — |
| Orbite p90 / p99 | 18,7 / 23,0 ms | 19,5 / 31,6 ms | p90 ≤ 33 ms |
| Images > 100 ms | 0 | **0** ✅ | 0 |
| **Scène parquée** | **0 rendu / 5 s** | **301 rendus / 5 s** | 0 |

Trois choses que ces chiffres disent et que le tableau seul ne dirait pas :

- **Allumer trois couches ne ralentit pas le démarrage** (3 590 contre
  3 572 ms) et coûte **15 Mio de tas** — six fois moins que ce que le plan
  s'autorise. Le tas n'est pas le problème de cette scène.
- **Les trois couches coûtent 2,47 Mo pour quatre requêtes.** Le contrôle
  apparié — même point de vue, même stabilisation, aucune couche — paie
  1,51 Mo sur 148 requêtes ; la différence est donc **quatre requêtes** qui
  pèsent 2,47 Mo. Chaque couche FR arrive en un seul bloc, ce qui est le sujet
  de la phase 3.
- **La scène parquée ne s'arrête jamais de dessiner, et c'est `transit-fr`
  seul.** Mesuré une couche à la fois au même point de vue : `irve-fr` **0**,
  `schools-fr` **0**, `transit-fr` **300**. Ce n'est **pas** la fuite de la
  tâche 2.5 : le gouverneur passe en `mode: "continuous"` avec
  `holds: ["transit-fr"]` et revient à `idle`, `holds: []`, dès qu'on éteint la
  couche. C'est **assumé** — une couche qui anime des véhicules demande des
  images. Ce qui n'était pas mesuré, c'est le prix : **60 images par seconde
  pour toujours** dès qu'un visiteur français allume les transports, sur une
  machine dont le plan dit qu'elle doit rester fraîche. La question que ça pose
  à la phase 2 n'est pas « d'où vient la fuite » mais « `transit-fr` a-t-il
  besoin de 60 Hz, ou d'une cadence plafonnée à celle des positions
  qu'il reçoit ». Elle est ouverte, pas tranchée ici.

Et **`qa-perf` 24/24 ne couvre pas ce cas** : son contrôle de scène parquée
éteint d'abord **toutes** les couches (`scripts/qa-perf.mjs:123-124`), puis
vérifie `mode === 'idle'` à zéro couche. Un arbre peut donc afficher 24/24 et
une scène qui ne se gare jamais dans la vie réelle.

*Piège de méthode, corrigé dans l'outil :* le premier relevé à Lyon sans couche
donnait **56 rendus / 5 s** et ressemblait à une fuite. Ce n'en était pas une :
la stabilisation par défaut est de 8 s, et l'imagerie d'un point de vue où le
vol d'intro n'est jamais passé arrivait encore. Avec `--settle 40000` le même
arbre donne **0 [0–0]** — et `transit-fr`, lui, donne toujours **300 [300–300]**
après quarante secondes. D'où le drapeau `--settle`, qui sépare « charge
encore » de « ne se gare jamais » : deux pannes différentes, deux propriétaires
différents.

*Rédaction d'origine :* Après le boot :
`irve-fr` + `schools-fr` + `transit-fr` sur Lyon, orbite 5 s, tas, octets,
p90/p99. C'est la scène qu'un usager réel regarde ; le globe nu ne suffit pas.

**0.3 Une vraie machine faible.** 🟡 **Option (2) livrée le 2026-09-09,
options (1) et (3) toujours ouvertes.** La prémisse de cette tâche était à
moitié fausse : le banc headless tourne sur un vrai GPU (voir § 0), donc les
quatre leviers de 2.2 sont **classables sans emprunter de machine**. Ce qui
reste hors de portée du dépôt, c'est le p90 absolu d'une UHD 620 — donc le
critère de sortie de la phase 2, et lui seul.

`npm run perf:gpu-ab` (`scripts/perf-gpu-ab.mjs`) est ce substitut : il refuse
de tourner sur un renderer logiciel, mesure **un levier à la fois en A/B/A/B**
(la charge de ce Mac passe de 4 à 50 en une passe ; une médiane par condition
mesurée côte à côte est la seule qui survive à ça), et rend le travail de rendu
par image plutôt que l'intervalle du balayage écran — il appelle `scene.render()`
en rafale et draine le pipeline avec un `readPixels` d'un pixel, sinon tout se
cache sous les 16,7 ms du vsync. `--scale N` rend à N× la résolution linéaire
pour entrer dans le régime où une petite machine travaille vraiment.

*Ce qui reste vrai de la rédaction d'origine :*

- `scripts/perf-real-gpu-console.js` : à coller dans la console de n'importe
  quel Chrome, sur `https://gev.enerlens.com/?welcome=0`. Il **refuse de
  répondre sur un renderer logiciel** (un relevé SwiftShader n'est pas un relevé
  raté, il est vide de sens), reprend **exactement** la méthode de
  `perf-boot-probe.mjs` — même vue garée sur Lyon, même orbite
  `rotateRight(0.004)`, mêmes fenêtres de 5 s, mêmes percentiles, donc les deux
  colonnes restent comparables — et recopie une ligne JSON dans le
  presse-papiers. Cinq minutes, aucune installation.
- `docs/PERFORMANCE.md` § « Reference machine » : la procédure, le tableau des
  quatre coûts GPU invisibles en tête-à-tête avec l'endroit du code où ils sont
  posés, et **le tableau de relevés, vide, qui attend sa première ligne**.

Ce qu'il reste à faire est donc une décision, pas une tâche. Par ordre de coût
croissant : **(1)** n'importe quel PC Windows déjà sous la main — le sien, celui
d'un proche, un poste de bureau — vérifié non-SwiftShader dans `chrome://gpu` ;
c'est une demi-heure et quelqu'un d'autre peut la faire et renvoyer trois
lignes. **(2)** Un substitut sur le Mac en rendant à 2 ou 3× la résolution :
les quatre coûts sont bornés par le remplissage de pixels, donc leur **rapport**
se reproduit et on peut les classer — ça ne donne pas le p90 absolu d'une UHD
620, donc ça ne valide pas le critère de sortie de la phase 2, mais ça dit
lequel des quatre paie vraiment. **(3)** Acheter un portable Intel d'occasion
(~150 €), à ne faire que si « fluide sur un petit ordinateur » est un engagement
produit durable et pas seulement cette passe d'optimisation.

**Ce que ce dégel change, et ce qu'il ne change pas.** Les tâches 2.1 à 2.4 ne
sont plus gelées : chaque levier peut être classé, et un levier qui ne paie pas
peut être annulé plutôt que livré par principe. Le **critère de sortie** de la
phase 2 (« orbite p90 ≤ 20 ms en `lite`, aucune image > 100 ms, sur la machine
de référence ») reste, lui, entièrement suspendu à l'option (1) ou (3) : aucun
chiffre de `perf:gpu-ab` ne doit y être recopié.

**0.4 Un banc d'origine.** ✅ **Faite le 2026-09-09.** Ni `autocannon` ni `oha`
— rien à installer sur une boîte qui porte aussi la production Enerlens :
`scripts/perf-origin-bench.mjs`, sans dépendance, copié dans `/tmp` et lancé
depuis le VPS contre `127.0.0.1:4173`. Chaque visiteur virtuel rejoue le **vrai
jeu de 23 requêtes** d'un boot — relevé par `perf:urls`, pas deviné — puis
recommence, donc `visits/s` est un nombre de démarrages à froid servis par
seconde. Résultats complets dans `docs/PERFORMANCE.md` § « Origin capacity ».

Ce que ça donne à 50 visiteurs / 30 s : **166 boots servis (5,3/s)**, 4 023
requêtes, **toutes en 200**, p50 69,5 ms, p95 2 080 ms, p99 4 163 ms.

- **Les deux cibles du plan sont tenues, et aucune des deux n'est le problème.**
  `/api` sous cette foule est à **p95 19 à 34 ms** (cible : 1 s) et le conteneur
  plafonne à **345 Mio** (cible : 1 Gio).
- **Ce qui sature, c'est le gzip à la volée.** Le débit est **plat à 16,8–17,7
  Mo/s** à 10, 25 et 50 visiteurs, pendant que le conteneur tient **175 % des
  200 % que cette boîte peut donner**. `vite preview` ne sert **aucun asset
  pré-compressé** : les 2,5 Mo du chunk d'entrée et les 5,7 Mo de Cesium sont
  compressés à chaque visite. p95 de `Cesium.js` : **4 271 ms**. La tâche 1.6
  (brotli pré-construit) n'est donc pas seulement −15 à −25 % d'octets client,
  c'est le plafond de débit de l'origine — et cette boîte est partagée avec
  Postgres.
- **Cloudflare absorbe le statique** (`cf-cache-status: HIT` au deuxième appel,
  revérifié le même jour), sauf dans la fenêtre qui suit chaque déploiement : le
  hash change, et le premier visiteur de chaque asset paie un MISS. Le staging
  redéploie toutes les 3 minutes tant qu'une PR est ouverte.

Trois pièges rencontrés, tous consignés dans l'outil pour qu'ils ne se
reprennent pas :

1. **Un `/assets/*.js` absent répond 200 avec `index.html`** (repli SPA de
   `vite preview`) : 58 kB de HTML au lieu de 2,5 Mo de JS. Un banc qui rejoue
   une trace enregistrée sur un autre build mesure alors des 404 rapides et
   rend un p95 flatteur. Le préflight vérifie désormais le `content-type`, pas
   seulement le code.
2. **Le corps de `/` est gzippé**, et la découverte des assets le lisait en
   texte : zéro correspondance, donc un banc à une seule URL qui se croyait
   complet. La requête de découverte demande `identity`.
3. **`/api/realtime/debug-log` est en POST seulement** et n'est pas rejoué. Il
   mérite quand même une ligne au registre : **chaque chargement de page y écrit
   une ligne de journal**, en `appendFileSync` synchrone, dans un fichier sans
   rotation — un journal de mise au point alimenté par la production.

Critère de sortie : **trois des quatre chiffres sont remplis**, dispersion
incluse, et versionnés dans `docs/PERFORMANCE.md` (§ « Small-laptop lab
profile » et § « Origin capacity ») — cache chaud **0,60 s**, tas 3 couches
**40 Mio**, origine **`/api` p95 34 ms / RSS 345 Mio**. Le quatrième, l'orbite
sur GPU réel, **ne peut pas être rempli depuis ce dépôt** : il attend une
machine (0.3), et l'outil qui le remplira en cinq minutes est écrit.

Ce que la phase 0 a changé au reste du plan, en deux lignes : **1.6 (brotli)
monte** — c'est le plafond de débit de l'origine, pas seulement des octets
client — et **la phase 2 gagne une question qu'elle n'avait pas**, la cadence
d'une couche animée sur une machine qui doit rester fraîche.

### Phase 1 — Le démarrage : moins d'octets, surtout moins de JavaScript (2 à 3 jours)

**1.1 Skybox et fonds Cesium.** ✅ **Faite le 2026-09-09, validée en capture
par Memel.** Le plan l'annonçait à « −0,9 Mo, une ligne » ; le gain de temps
n'était pas chiffré et il est le double de ce que les octets laissaient croire :

| | Avant | Après |
|---|---:|---:|
| `viewer` prêt, CPU ÷4 | 5,3 s [4,2–6,0] | **3,57 s [3,55–3,62]** |
| Octets de l'app | 3,51 Mo | **2,67 Mo** |
| Requêtes de l'app | 31 | **29** |
| Orbite, p90 / p99 | 24,7 / 38,2 ms | **20,6 / 23,8 ms** |

Les 848 kB d'étoiles ne coûtaient pas que des octets : six JPEG 1024² se
disputaient la bande passante ET le décodage pendant le démarrage. La
dispersion sur `viewer` tombe à **63 ms** (contre 1,8 s), ce qui est le signe
que la contention a disparu, pas seulement la charge.

**Les étoiles ne sont pas supprimées, elles sont déplacées** (`src/starfield.js`,
décision de Memel du 2026-09-09) : elles reviennent sur les fonds
**photographiques** — `photoreal`, `bing-aerial`, `bing-labels`, `ign-ortho` —
et restent absentes des fonds **dessinés** — `google-roadmap`, `google-terrain`,
`osm`, `ign-plan`. La règle est le contenu de l'image, pas le fournisseur : sur
un plan la Terre est un schéma et le noir est un fond ; sur une photo la Terre
est vue depuis l'orbite et le ciel fait partie de la même affirmation.

Trois points d'implémentation qui ne vont pas de soi :

- **Le premier chargement est différé à l'inactivité du navigateur**, jamais
  pendant le boot. Sans ça, un build qui s'ouvre sur un fond photographique
  repaierait exactement les 848 kB qu'on vient d'enlever. Les changements
  ultérieurs — quelqu'un qui choisit — installent immédiatement.
- **Le ciel est masqué, jamais détruit.** Comparer deux fonds ne doit pas
  retélécharger les étoiles ; `qa:starfield` le vérifie explicitement.
- **La liste est par `id`, pas par `kind`.** `kind` groupe par fournisseur
  (`ion` contient Bing Aerial ET Bing Labels, `ign-wmts` contient l'ortho ET le
  Plan), et le fournisseur ne dit pas si l'image est une photo.

`qa:starfield` tient les deux moitiés : zéro face `tycho2t3_80_*.jpg` sur un
boot en fond dessiné, et les six qui arrivent au passage en satellite. Sans la
seconde, « ne jamais charger » passerait en supprimant la fonctionnalité.

Deux réductions en prime, du même geste : `scene.moon = undefined` (qui tirait
`moonSmall.jpg` et les tables IAU2006) et `globe.showWaterEffect = false` (qui
tire `waterNormals.jpg`, 294 kB, dès qu'une tuile porte un masque d'eau, pour
un miroitement invisible à toutes les altitudes où cette carte se lit).

*Rédaction d'origine :* Construire le Viewer
avec `skyBox: false` et un `scene.backgroundColor` noir (ou un skybox
procédural sans texture), `scene.moon = undefined`, et
`globe.showWaterEffect = false`. Mesure : `perf:urls`. Gain attendu : −848 kB
étoiles, −18 kB lune, −294 kB `waterNormals.jpg` dès qu'une tuile côtière
arrive, et moins de fetches `IAU2006_XYS_*`. Risque : le look « espace » du
globe à 18 000 km ; le valider en capture avant/après avec Memel — c'est un
choix d'apparence, pas seulement de poids.

**1.2 Polices : auto-hébergées et sous-ensemblées.** ✅ **Faite le 2026-09-09.**
Mesuré : **410 kB → 92 kB sur le fil**, et trois feuilles tierces bloquantes sur
deux origines jamais résolues → une feuille de 1 kB en `same-origin`, plus deux
`preload`. Material Symbols passe de **323 kB à 4,0 kB** (28 glyphes) via le
paramètre `icon_names=` de l'endpoint `css2` — c'est Google qui sous-ensemble,
on ne lance pas de sous-ensembleur. `Material Icons Round` est retirée.

Trois choses valent d'être notées, parce qu'aucune n'était dans la rédaction
d'origine :

- **La liste de glyphes n'est pas tenue à la main.** Un glyphe absent du
  sous-ensemble ne rend pas un carré : la ligature ne se forme pas et le
  cockpit affiche le MOT `right_panel_open`. Rien ne lève. La liste est donc
  extraite des sources (`scripts/lib/materialSymbolGlyphs.mjs`), validée contre
  la table de codepoints publiée par Google, et `npm test` échoue dès qu'une
  source nomme un glyphe que le sous-ensemble ne porte pas. La première passe,
  écrite trop serrée, avait déjà manqué `right_panel_open` — choisi dans un
  ternaire quarante lignes après la pose de la classe.
- **`qa:webfonts` mesure les pixels**, parce que le test statique ne peut pas
  voir cette panne-là : chaque `.material-symbols-outlined` est mesuré, une
  ligature formée fait ~24 px, le mot en fait cinq fois plus.
- **Les fichiers portent leur empreinte** (`inter-latin.c9407645.woff2`). Sans
  ça ils seraient servis `no-cache` — ils vivent dans `public/`, que Vite copie
  tel quel — donc revalidés à chaque visite et jamais tenus par l'edge. Avec,
  ils entrent dans l'allowlist `immutable` de `staticAssetHeaders`. `fonts.css`
  reste délibérément hors de l'allowlist : c'est la carte des noms, le même rôle
  qu'`index.html` pour le bundle.

*Rédaction d'origine :* Retirer les trois `<link>` Google Fonts de
`index.html:9-13` ; mettre Inter (4 graisses) et JetBrains Mono (5) en woff2
latin dans `public/fonts/` avec `font-display: swap` et un `<link rel=preload>`
pour les deux graisses du premier écran ; remplacer Material Symbols (323 kB
pour 24 glyphes) par un sous-ensemble `pyftsubset` (~6 kB) ou par des SVG
inline ; supprimer `Material Icons Round` (jamais utilisé). Mesure :
`perf:urls`, et le `DOMContentLoaded` de `perf:boot`. Gain : −400 kB et surtout
le premier rendu qui n'attend plus `fonts.googleapis.com`. Bonus : plus aucune
requête vers Google au chargement d'une page publique (RGPD, CJUE 2022).

**1.3 Découper l'entrée : les couches se chargent au premier clic.**
✅ **Faite en deux temps, les 2026-09-09.** Les 60 couches d'abord (PR #123 :
fermeture statique 7 278 → 2 525 kB, entrée 2 560 → 1 102 kB), puis la pile
vocale : **2 708 → 2 104 kB** avant minification, 121 → 103 modules, entrée
**1 134 → 853 kB** minifiés (266 → 200 kB sur le fil en brotli).

Ce que la seconde passe a appris, et qui n'était pas dans la rédaction :

- **La moitié du gain n'était pas la voix, c'était deux arêtes accidentelles.**
  `src/hud.js` importait UNE fonction de contexte cartographique à
  `voice/gevActions.js`, ce qui traînait 164 kB (le runner d'actions et son
  vocabulaire de couches) ; `src/locations.js` importait deux helpers de
  géocodage à `annotations/annotationResolver.js`, 50 kB. Aucun des deux ne
  sert avant un geste. C'est exactement le piège noté après #123 : ces arêtes
  ne se voient QUE dans le graphe Rollup, jamais au grep.
- **Le panneau ne se différencie pas, seule sa mécanique.** Le markup du micro
  est sorti dans `src/voice/voiceControlDom.js` (6 kB, aucune dépendance) et
  reste au démarrage : un contrôle qui apparaît une seconde après le reste se
  lit comme une page qui charge encore, et il déplacerait le dock sous le
  curseur.
- **Deux déclencheurs, pas un.** Inactivité du navigateur (borné, `whenIdle`)
  ET intention immédiate. Le premier n'est pas une commodité : huit harnais QA
  lisent `window.__gevVoiceCommands`, et une pile qui n'arrive JAMAIS sans
  clic les aurait tous cassés. `window.__godsEyeView.voiceReady` est la
  promesse à attendre ; `track-regression` et `qa-l9-matrix`, qui sondaient
  sans attendre, l'attendent désormais.

*Rédaction d'origine :* 
Aujourd'hui `src/main.js:8-62` importe les 55 modules et `dataManager.register`
les enregistre tous (`src/main.js:346-406`). Introduire un registre de
**descripteurs légers** (id, libellé, catégorie, jeton de partage, ce que lit
la liste des couches et `layerState.js`) et un `load: () => import('./data/x.js')`
résolu par `manager.setEnabled()` avant `enable()`. `finalizeRegistrations`
scelle les descripteurs, plus les modules. Commencer par les dix plus gros
(`flights` 290 kB, `cctv` 219, `militaryFlights` 190, `rocketLaunches` 145,
`aisLiveVessels` 110, `radio` 109, `traffic` 107, `satellites` + `satellite.js`,
`bdtopoBuildings` + `pbf`/`vector-tile`, `cadastreParcels`), puis le reste par
lot. Mesure : taille de `index-*.js` (build), `DOMContentLoaded` et `viewer`
à CPU ÷4. Gain attendu : entrée 2,5 Mo → ~0,9 Mo brut ; à CPU ÷4 c'est
**1,5 à 2,5 s de compile en moins** avant le globe. Risque : la restauration
d'un lien de partage active des couches au boot — le chemin `import()` doit
être attendu là aussi ; les tests `manager.test.mjs` (140 kB) pinnent le
contrat d'enregistrement et diront ce qui casse. Une PR par lot, pas une PR
« tout dynamique ».

**1.4 `ui.js` (455 kB dans la fermeture) : sortir le cockpit, les styles
visuels et la lightbox CCTV du chemin de démarrage.** Même mécanique qu'en 1.3,
par `import()` au premier usage (bouton COCKPIT, sélecteur de style, clic
CCTV). Mesure identique.

> **À reconsidérer avant de la faire (2026-09-09).** Après 1.3 et sa suite, le
> paquet d'entrée fait **853 kB minifiés en face des 5 593 kB de Cesium** :
> réussir 1.4 en entier retirerait environ 200 kB minifiés, soit **3 % du
> JavaScript analysé avant le globe**. C'est la tâche la plus chère de la phase
> (`ui.js` fait 10 492 lignes et porte le StyleManager, que `init()` construit
> avant tout le reste) pour le plus petit reste de gain. La règle de ce plan —
> une tâche qui ne bouge pas le chiffre est annulée — pointe vers **1.5 (b)**,
> pas vers 1.4.

**1.5 Cesium lui-même : deux options, mesurer avant de choisir.**
- (a) *Sûre* : ✅ **la moitié brotli est faite le 2026-09-09**, livrée par la
  tâche 1.6 qui la couvre entièrement : 1 651 → **1 282 kB** sur le fil (la
  prévision de ~1 300 kB était juste). **Le `preload` est annulé, mesuré :**
  les deux scripts partent déjà au même instant — `perf:urls` les relève à
  **285 ms et 286 ms** — parce que `vite-plugin-cesium` injecte sa balise en
  tête de `<head>`, au-dessus du module d'entrée. Il n'y a rien à avancer, et
  un `preload` n'aurait fait qu'ajouter une ligne à un document déjà scanné
  par le préchargeur du navigateur. Ne pas réessayer sans avoir d'abord
  déplacé la balise hors de `<head>`.
- (b) *Ambitieuse* : ✅ **faite le 2026-09-09, et gardée — mais le critère
  écrit n'est PAS atteint, et il faut le dire.** La rédaction disait « si l'ESM
  émondé tombe sous ~3 Mo brut, garder ; sinon revenir à (a) ». Il tombe à
  **3 945 kB**. Le seuil a été écrit à l'aveugle, avant toute mesure, et la
  mesure dit autre chose que ce qu'il anticipait :

  | | IIFE | ESM émondé |
  |---|---:|---:|
  | moteur, brut | 5 593 kB | **3 945 kB** |
  | moteur, sur le fil (brotli) | 1 282 kB | **824 kB** |
  | entrée de l'app, brut | 853 kB | 828 kB |
  | **JS brut avant le globe** | **6 446 kB** | **4 773 kB** (−26 %) |
  | **total sur le fil** | **1 482 kB** | **1 023 kB** (−31 %) |
  | `viewer`, CPU ÷4 (A/B alterné) | 3 655 ms [3 638–5 094] | **2 344 ms [2 298–2 826]** |
  | `app=` | 1,78 Mo | **1,34 Mo** |

  Appliquer le seuil à la lettre aurait jeté le plus gros gain restant du plan
  pour 945 kB au-dessus d'un chiffre que personne n'avait mesuré. La décision
  est donc de garder, et de laisser la trace de l'écart ici plutôt que de
  réécrire le critère après coup.

  Ce qu'il a fallu retirer d'abord : `window.__CESIUM__ = Cesium`
  (`annotations/annotationEngine.js`) — une commodité de console, et un objet
  de namespace posé sur un global est inémondable par construction. Ce qui est
  parti avec, sans avoir été prévu : **`window.Cesium`**, qui n'existait que
  par l'IIFE et jamais sur le serveur de développement. Douze harnais QA le
  lisaient ; ils lisent maintenant `viewer.clock.currentTime` et
  `scene.globe.ellipsoid`, ce qui est plus juste — l'horloge de la scène est la
  date à laquelle ses `Property` sont réellement évaluées.

  Deux choses à surveiller :

  - **La séparation de cache est conservée mais devient conditionnelle.** Un
    `manualChunks` sort le moteur dans `assets/cesium-engine-<empreinte>.js`,
    adressé par contenu, immuable un an et pré-compressé comme le reste. Mais
    son empreinte dépend désormais de ce que l'application appelle : une
    livraison qui touche une API Cesium nouvelle fait retélécharger 824 kB à un
    visiteur qui revient, là où seule une montée de version du moteur le
    faisait avant.
  - **Le chemin photoréaliste reste non testé**, avant comme après : Google
    répond 403 à ce compte depuis l'EEE. Ce n'est pas une régression de cette
    tâche, c'est un angle mort du dépôt.

  La fabrication passe de 2,3 s à 7-13 s, et `deferCesiumBundlePlugin` est
  supprimé : il réécrivait une balise qu'aucune fabrication n'émet plus.

**1.6 Brotli à l'origine.** ✅ **Faite le 2026-09-09.** Le gain attendu était
« −15 à −25 % sur les 2,4 Mo de scripts » ; mesuré à travers le serveur, c'est
**−22 % sur le moteur** (1 651 → 1 282 kB) et **−18 % sur l'entrée**
(326 → 266 kB), soit **app 2,23 → 1,77 Mo**, déterministe aux cinq démarrages.
Le critère de sortie de la phase sur les octets (≤ 1,8 Mo) est **atteint** par
cette tâche.

Trois choses qui n'étaient pas dans la rédaction d'origine :

- **Ni `vite-plugin-compression`, ni `closeBundle`.** La compression est une
  seconde moitié de `npm run build` (`scripts/precompress-dist.mjs`), pour une
  raison de correction et pas de goût : `vite-plugin-cesium` copie ses 5,7 Mo
  dans `closeBundle`, et ce hook est *parallèle* chez Rollup — un plugin qui
  compresserait dans le même hook courrait contre la copie. Une étape après
  `vite build` n'a pas de course à perdre, se relance seule, et se teste sans
  serveur.
- **Le `.gz` n'est pas écrit.** Vite gzippe déjà à la volée, et c'est
  exactement le repli qu'on veut quand le `.br` n'existe pas : une fabrication
  qui saute le script retombe sur le comportement d'avant, pas sur un 404.
- **Qualité 11, mémoïsée par empreinte de contenu.** 36 s à froid pour 264
  fichiers, **0,0 s** ensuite (`node_modules/.cache/gev-precompress`), parce
  que les 169 fichiers de Cesium sont identiques jusqu'à la prochaine montée
  de version. Sur le chunk d'entrée : q9 → 288 kB en 0,09 s, q10 → 270 kB en
  1,6 s, q11 → 266 kB en 4,1 s. La fabrication paie une fois ce que chaque
  visite paierait sinon.

Le périmètre est volontairement **les seules URL adressées par contenu**
(`/assets/*`, `/cesium-<version>/*`) : ce middleware répond 200 avec un corps
entier et jamais 304, ce qui est gratuit pour une URL que personne ne
revalide et une régression pour toutes les autres. `npm run qa:brotli` tient
le contrat sur socket ; `src/deliveryPolicy.test.mjs` pin les deux jugements
purs (quelle URL, et « ce client sait-il décoder du brotli » — `br;q=0` est un
refus, `brotli` n'est pas `br`).

**1.7 Ne rien dépenser au boot.** ✅ **Faite le 2026-09-09.** Le compte réel
était de **cinq** appels facturés, pas deux : `/api/openai/hud-summary`,
`/api/google/nearby-places`, et **trois géocodages inverses
`maps.googleapis.com` émis par le navigateur avec la clé dans l'URL**. Ils
partaient tous à t≈6,3 s, déclenchés par le `moveEnd` du vol d'intro.

Le déclencheur ne pouvait donc pas être « le premier mouvement de caméra » :
c'est l'application qui bouge la caméra. Le portillon posé
(`_installEngagementGate`, `src/hud.js`) attend un vrai geste — `pointerdown`,
`wheel`, `keydown`, `touchstart` — et jusque-là le bandeau affiche la ligne
composée localement, qui est exactement le repli du chemin IA et ne coûte rien.
Le geste ouvre tout, immédiatement.

`npm run qa:boot-spend` tient les deux moitiés du contrat, et les deux comptent :
zéro appel facturé sur une fenêtre de 24 s (au-delà du vol d'intro ET d'un tick
complet de résumé), puis le résumé QUI PART après un geste — sans quoi
« ne jamais dépenser » passerait le test en cassant la fonctionnalité.

Critère de sortie de phase : ≤ 1,8 Mo avant la première tuile, `viewer` ≤ 3,5 s
à CPU ÷4 / 10 Mbit/s, `npm test` vert, `qa:keyless-boot`, `qa:map-reload`,
`qa:firstrun` verts.

> ✅ **Atteint le 2026-09-09** : `app=` **1,34 Mo [1,34–1,34]** et `viewer`
> **2 344 ms [2 298–2 826]**, mesurés en A/B alterné contre l'arbre précédent
> sur deux serveurs. `npm test` 6 644/6 644, `qa-perf` 24/24, `qa:map-reload`
> 4/4, `qa:starfield` 4/4, `qa:lazy-layers` 9/9, `qa:lazy-voice` 8/8,
> `qa:brotli` 17/17. Reste ouvert dans la phase : **1.4** (`ui.js`), reportée
> après 1.5 (b) et à re-justifier — elle vaut désormais ~200 kB minifiés sur
> 4 773 kB analysés, soit 4 %.

### Phase 2 — Le rendu : un profil « léger », automatique et débrayable (2 à 3 jours, GPU réel disponible au banc, machine de référence pour le critère de sortie)

**2.1 `src/perfProfile.js` : détecter, décider, exposer.** ✅ **Faite le
2026-09-09.** `src/perfProfile.js` + `src/perfProfile.test.mjs` (16 tests),
l'interrupteur **Lite** dans le rail DISPLAY sous Celestial, et
`npm run qa:perf-profile` qui fige le contrat en dix contrôles.

Trois écarts à la rédaction d'origine, tous nés d'une mesure :

1. **La sonde d'images ne s'applique plus à la session en cours.** Le plan
   demandait « p90 > 28 ms → léger ». Appliqué à chaud, ça coupe la netteté et
   fait tomber le MSAA **quatre secondes après l'ouverture**, sous les yeux du
   lecteur, sur la foi des soixante images les moins représentatives de la
   session. Le verdict est donc **écrit** et c'est la **visite suivante** qui
   s'ouvre en `lite` — complète, avec les deux options de contexte que
   celle-ci n'aurait de toute façon pas pu changer.
2. **Un intervalle entre deux images n'est pas un temps d'image.** Sous
   `requestRenderMode` la scène se gare et l'intervalle suivant vaut des
   secondes. Compté naïvement, ça donnait **p90 33,9 ms sur un Apple M5** — un
   poste de travail classé petit portable. Plafond à 250 ms, et les
   **60 premières images sont jetées** (compilation de shaders, premières
   tuiles) : le M5 retombe à **22,9 ms**, verdict `full`, machine chargée à 30.
3. **Deux seuils, pas un.** 28 ms pour entrer en `lite`, 22 ms pour en sortir.
   Sans hystérésis une machine assise sur le seuil oscille à chaque visite :
   elle mesure lent, s'ouvre en `lite`, `lite` est moins cher, elle mesure
   vite, s'ouvre en `full`… et l'image change à chaque ouverture pour une
   raison que personne ne peut voir.

Le reste est tel qu'écrit : `hardwareConcurrency ≤ 4`, `deviceMemory ≤ 4`,
`WEBGL_debug_renderer_info`, `prefers-reduced-motion`, `?perf=lite|full`
(session seulement — un lien collé dans une conversation ne doit pas réécrire
le profil de qui clique), choix de l'opérateur persisté en `localStorage`,
**jamais dans le lien de partage**, et le profil ne change **jamais** ce qui
est affiché. Ce dernier point est le contrôle n°6 de `qa:perf-profile` : même
liste de couches, mêmes états, mêmes lignes de panneau, même détection.

**2.2 Les quatre coûts fixes, un A/B chacun.** ✅ **Faits le 2026-09-09, sur
GPU réel — mais pas sur celui du § 0.** Les quatre sont posés et branchés sur
le profil. Les chiffres sont ceux de `npm run perf:gpu-ab` sur un Apple M5,
un levier à la fois, A/B/A/B interleavé, en travail de rendu par image :

| Levier | 1366×768 | 2732×1536 | Où |
|---|---:|---:|---|
| `msaaSamples` 4 → 1 | **−26 à −43 %** | **−49 à −59 %** | `src/main.js` |
| netteté OFF | −6 à −13 % | **−17 %** | `grantedSharpen()`, `src/ui.js` |
| `preserveDrawingBuffer` false | −3 à −12 % | non concluant | `src/main.js` |
| `resolutionScale` ×0,8 | −5 à −26 % | **−40 à −48 %** | `globeDetailGovernor.js` |
| **MSAA + netteté ensemble** | **−34 %** | **−60 à −63 %** | — |

**Comment lire cette table.** Les fourchettes ne sont pas de la prudence
rédactionnelle : ce sont les extrêmes de relevés pris pendant que la charge du
Mac passait de 4 à 150 (un autre agent y travaillait). À 1366×768 sur un M5 une
image entière coûte **2,3 ms** et les leviers sont dans le bruit ; à 2732×1536
l'image coûte **10,8 ms** et le classement se tient. C'est le régime qui
compte : une UHD 620 à 1366×768 est bornée par le remplissage exactement comme
un M5 à 2732×1536, et c'est pour ça que `--scale` existe. **Aucun de ces
chiffres n'est un p90 d'UHD 620** et aucun ne doit être recopié dans le critère
de sortie.

**Un chiffre qui a failli être publié faux.** La comparaison de bout en bout —
deux démarrages, `?perf=full` contre `?perf=lite` — a rendu **−86 % puis
−89 %** à 2732×1536. Les mêmes deux leviers mesurés **sur une seule page** en
rendent **−63 %**, et le produit de leurs gains individuels en prédit −58 %.
Deux démarrages, ce sont deux jeux de tuiles différents, et l'écart était
encaissé comme un résultat. C'est exactement la raison d'être de la règle « un
levier par PR » du § 3 — appliquée ici à la mesure plutôt qu'à la PR. Le mode
`--levers profile` reste dans l'outil, mais il imprime maintenant un
avertissement et ne sert qu'à vérifier que `?perf=` atteint bien le Viewer.

Trois écarts à la rédaction d'origine :

- **Les polylignes fines n'avaient rien à changer.** Vérifié : la plus fine que
  `vigicrues.js` dessine fait **2,2 px** (niveau UNKNOWN) et le réseau gaz est
  à **5 px** — les deux sont déjà au-dessus du plancher de 2 px qu'une image
  mono-échantillonnée demande. La contrainte est notée dans `perfProfile.js`
  pour le jour où une de ces largeurs baissera.
- **Les appelants de `toDataURL` n'étaient pas dans `src/ui.js`.** Le seul du
  côté application est `renderFreshCesiumFrame()` (`src/voice/gevRealtime.js`),
  qui attendait déjà un `postRender` — mais depuis une microtâche, ce qui est
  *généralement* encore dans la fenêtre où le tampon est lisible. « Généralement »
  n'est pas un contrat pour une capture qu'on présente au modèle comme la vue
  courante : un `scene.render()` synchrone est ajouté juste avant. Le second
  appelant est `scripts/qa-focus-evidence.mjs`, dont le rendu et la lecture
  sont maintenant dans **un seul** `evaluate` pour la même raison.
- **`resolutionScale` vit dans le gouverneur de détail, pas à côté.** Il n'y a
  qu'une seule vérité sur « la caméra bouge-t-elle », et deux machines à états
  qui y répondent séparément, c'est un vol annulé qui laisse l'application
  floue pour le reste de la session — la garde de blocage de ce fichier existe
  précisément pour ça. Douze tests supplémentaires dans
  `globeDetailGovernor.test.mjs` couvrent le cliquet (deux `moveStart` d'affilée),
  la garde de blocage, le démontage en cours de mouvement, le changement de
  profil à chaud, et l'écho ci-dessous.

**Le levier `resolutionScale`, écrit tel quel, retourne le plan contre
lui-même.** C'est le vrai résultat de cette tâche et il n'était dans aucune
prévision. Cesium ne publie pas `moveStart` depuis un gestionnaire d'entrée :
il le **déduit** dans `View.checkForCameraUpdates`, en comparant la caméra de
cette image à celle de la précédente — **et cette comparaison inclut le
frustum**. Changer `resolutionScale` redimensionne le tampon de dessin, ce qui
change `frustum.aspectRatio` d'une erreur d'arrondi (1366/768 = 1,778646 ;
1092/614 = 1,778502), ce que Cesium lit comme un déplacement de caméra.

Il n'y a alors plus de sortie de boucle : `moveEnd` restaure la résolution, la
restauration change le rapport d'aspect, le rapport d'aspect lève `moveStart`,
`moveStart` rebaisse la résolution. **Mesuré sur l'arbre construit, avant la
garde** : un cycle de **535 ms de « mouvement » et 16 ms de repos, indéfiniment**,
sur une caméra garée au-dessus de Paris. Conséquences, toutes les trois graves
et aucune visible dans une capture d'écran :

1. le globe reste **en permanence** à la tolérance grossière (SSE 4 au lieu de
   2) — une image fixe durablement moins nette, ce que ce gouverneur promet
   explicitement de ne jamais faire ;
2. **le gouverneur de rendu ne gare plus jamais la scène** : 60 images par
   seconde pour toujours, sur les machines mêmes que le profil `lite` vise. La
   tâche 2.5 vient de fermer cette fuite ; celle-ci l'aurait rouverte en grand ;
3. l'image pulse entre deux résolutions toutes les demi-secondes.

La garde tient en une question : **un mouvement qui n'a changé ni la position
ni la direction n'est pas un mouvement**. La pose est notée à chaque
restauration et comparée à chaque `moveStart` ; une pose identique est le
gouverneur qui s'entend lui-même. Vérifié après coup sur l'arbre construit :
`0 rendu / 5 s` dans les deux profils, `mode: idle`, `holds: []`,
`echoesIgnored: 1`, `qa-perf` **24/24**.

À retenir au-delà de cette tâche : `qa-perf` **n'aurait pas attrapé ça** — il
éteint toutes les couches et mesure un globe nu en `full`. C'est le même motif
que le 09-09 au matin (« une garantie ne vaut que la densité de ce qu'elle a
mesuré ») ; c'est `qa:perf-profile` qui le couvre désormais, et la sonde de
scène garée devrait tourner dans les deux profils.

**2.3 Le globe en `lite`.** ✅ **Moitié faite le 2026-09-09, moitié annulée.**
`globe.maximumScreenSpaceError` 2 → 3 au repos (le gouverneur double ce chiffre
en mouvement, donc `lite` vole à 6 et se pose à 3) et `tileCacheSize` 100 → 60.
Posés **avant** `installGlobeDetailGovernor`, sans quoi le gouverneur capturerait
la valeur grossière comme valeur au repos.

C'est le seul levier de la phase 2 qui rende des **octets**, et c'est celui qui
compte sur une ligne à 10 Mbit/s. `perf:boot` en A/B, `?perf=full` contre
`?perf=lite`, médiane de 3, CPU ÷4 / 10 Mbit/s, Paris :

| Fenêtre de 25 s | `full` | `lite` |
|---|---:|---:|
| Requêtes | 245 | **212** (−13 %) |
| Octets | 5,48 Mo | **5,04 Mo** (−8 %) |
| Requêtes après stabilisation | 81 | **43** (−47 %) |
| Octets après stabilisation | 0,63 Mo | **0,46 Mo** (−27 %) |
| Octets de l'app | 2,25 Mo | 2,25 Mo *(identiques)* |
| Scène parquée | 0 / 5 s | 0 / 5 s |

**Le p90 ne bouge pas** (18,6 contre 20,4 ms, intervalles qui se recouvrent) et
c'est attendu : à CPU ÷4 le fil principal est le goulot, et les quatre leviers
de 2.2 sont du côté GPU. C'est la limite du § 0 qui reparle — le laboratoire ne
sait pas ralentir les deux à la fois.

**Annulé : `skyAtmosphere` et le tileset Google.** L'atmosphère est un poste
*visible* et le § 2.1 interdit à `lite` de changer ce qui est affiché. Le
tileset Google est **invisible depuis la France** (blocage EEE, 403) : les
quatre réglages proposés — dont `skipLevelOfDetail: true`, qui a un coût visuel
connu (popping) — seraient livrés sans avoir jamais été vus tourner. Deux
raisons de ne pas les poser, et la seconde est la règle du § 3.

**2.4 Détection en `lite` : ANNULÉE le 2026-09-09**, pour deux raisons dont la
première suffit.

**Elle ne paie pas.** Mesurée à la scène que le plan nomme — Lyon, `irve-fr` +
`schools-fr` + `transit-fr`, machine au repos (charge 3,3), A/B/A/B interleavé
à 2732×1536 — la densité 75 → 50 rend **+5,3 %**, c'est-à-dire rien, ou un peu
pire. Le même relevé donne −50,8 % pour le MSAA et −35,4 % pour la résolution.
*Limite de l'instrument, à dire :* la rafale mesure le travail de `scene.render()`,
et la densité est un coût de **placement**, côté CPU. Elle n'est donc pas
mesurée là où elle pourrait coûter — mais elle n'est pas non plus mesurée en
train de payer.

**Et elle contredit le § 2.1.** « 75 → 40 % de densité » retire des libellés de
la carte. Le profil ne doit **jamais** changer ce qui est affiché : la promesse
de ce fork est que la même France arrive sur un portable de 2018, pas une France
plus petite. C'est le contrôle n°6 de `qa:perf-profile`, qui échouerait si cette
tâche était livrée — à juste titre.

*Note de fait, au passage :* **40 % n'est pas un cran.** `canonicalizeDensity`
(`src/data/detectionPolicy.js:116`) colle le curseur à 0 / 25 / 50 / 75 / 100 ;
40 atterrit sur 50. La tâche demandait une valeur que l'application ne sait pas
prendre.

**2.5 Fermer la fuite parquée (17 rendus / 5 s).** ✅ **Faite le 2026-09-09 —
et pas là où ce plan la cherchait.** `qa-perf` passe de **19/24 à 24/24**, et
la sonde compte **0 rendu parqué / 5 s** contre 15 [12–19] avant.

Le plan pointait `src/overlays/worldOverlay.js` (`refreshUiOccluders`) : un
occludeur qui change de taille sans candidat à placer ne devrait pas demander
d'image. C'est vrai, et cette entrée de registre reste ouverte. Mais ce n'était
pas la cause ; c'était le second maillon. Le premier est dans `src/hud.js` :
`_setSummaryText(text, animate)` relançait la machine à écrire **même quand le
texte était identique**, et sur un serveur dont `/api/openai/hud-summary` ne
répond pas — le cas keyless, et le cas de tout banc QA — le repli local est le
même à chaque tick. Le HUD retapait donc la même phrase toutes les 15 secondes,
pour toujours ; le texte qui grandit refluait `.hud-corner.hud-top-left`, un
occludeur, et l'hôte honorait ce reflow par des images. Une ligne — ne rien
retaper qui soit déjà à l'écran — supprime la source.

Ce que ça change pour la suite : le world-overlay honore toujours le churn
qu'on lui envoie, il n'en reçoit simplement plus. La tâche reste donc au plan,
mais elle passe de **bloquante** à **durcissement** : sans elle, le prochain
élément de chrome qui s'anime en boucle rouvrira la même fuite. Ce qui a été
gagné ici est le symptôme et la mesure ; la garde, elle, n'est pas encore posée.

**2.5-bis La garde.** ✅ **Posée le 2026-09-09.** Deux verrous dans
`src/overlays/worldOverlay.js`, chacun avec son test :

- **Une invalidation déjà en attente ne rachète pas d'image.**
  `refreshUiOccluders` refusait déjà de recalculer plus souvent que
  `OCCLUDER_REFRESH_MS` (100 ms) et armait un minuteur de rattrapage — mais
  `markOccludersDirty` demandait une image à **chaque** annonce. Un élément qui
  s'anime à 60 Hz achetait donc 60 images par seconde pour dix recalculs utiles.
  Trente annonces dans une fenêtre coûtent maintenant **une** image.
- **Un inventaire qui n'a pas changé n'est pas un changement de disposition.**
  Les rectangles sont comparés à ceux de la dernière résolution ; identiques, on
  ne re-résout pas et on n'incrémente pas `_layoutRevision` (que toute la chaîne
  aval surveille). Un changement de classe qui ne change qu'une couleur passait
  auparavant pour un déménagement. Le compteur `occluderNoopRefreshes` sort dans
  les diagnostics : s'il grimpe pendant que rien ne bouge à l'écran, c'est du
  chrome qui s'anime dans le solveur de placement.

*Deux pièges d'allocation traversés pour poser ça, et le second est le plus
instructif :*

1. **Une garde qui coûte plus cher que ce qu'elle économise.** La première
   version comparait une **signature de chaîne** (`${x},${y};`). Le portillon
   d'allocation de Node 24 est passé de 3 182 à 4 746 octets par image. Remplacé
   par un `Float64Array` plat, alloué une fois et jamais réécrit à la
   comparaison.
2. **Ça n'a rien changé — et la vraie cause était ailleurs.** Le coût venait
   d'**une clé de plus dans l'objet littéral que `getWorldOverlayDiagnostics()`
   retourne**, une façade que le harnais n'appelle que **deux fois**, jamais
   dans la boucle mesurée. Même compteur, même valeur, même forme publique,
   rangé dans l'objet `_diagnostics` de module plutôt que dans le littéral de
   retour : 13/13. Reproduit à l'octet près dans les deux sens, sur trois
   workspaces jetables successifs.

   La leçon n'est pas sur V8. C'est que **le portillon d'allocation ne se
   raisonne pas, il se mesure** — et qu'il faut un Node 24 en local pour le
   faire (`brew install node@24` ; le banc saute silencieusement sur Node 26,
   donc `npm test` vert sur cette machine ne dit rien de la CI).

Leçon de méthode, à garder : la cause était dans la phase 1 alors que la tâche
était rangée en phase 2, et elle a été trouvée en lisant le chemin qui DÉCLENCHE
le rendu, pas celui qui le sert.

**2.6 Les petits per-frame.** ❌ **Mesurés le 2026-09-09, sous le seuil,
ANNULÉS** — exactement la sortie que cette tâche prévoyait (« si < 0,3 ms, ne pas
fusionner, juste le noter »).

- **L'abonnement `postRender` de `celestialRing` quand l'anneau est éteint :
  0 ms.** Rafale de 150 images, médiane de 5, avec et sans l'écouteur :
  **1,851 ms/image contre 1,864** — le « sans » est plus lent, donc c'est du
  bruit. `_draw()` sort à la première ligne quand `enabled` est faux ; ce qui
  reste est un appel de fermeture et deux lectures de propriété.
- **La réallocation du canevas de `scopeMask` : sous 0,05 ms**, la résolution du
  chronomètre du navigateur. 1366×768×4 = 4,2 Mo de tampon, et `draw()` n'est
  **pas** par image — il tourne au redimensionnement, au changement de réglage,
  au changement de DPR et à chaque palier quantifié d'alpha, soit une douzaine
  de fois sur toute une descente. Le total sur un geste complet est inférieur à
  une image.

Les deux sont réels et les deux sont propres à corriger. Aucun des deux ne
justifie de toucher un fichier : c'est la règle du § 3, appliquée contre
l'envie de ranger.

Critère de sortie : sur la machine de référence, orbite zéro couche p90 ≤ 20 ms
en `lite`, 3 couches FR p90 ≤ 33 ms sans image > 100 ms ; `qa-perf` 24/24 ;
`full` visuellement identique à aujourd'hui (captures A/B).

### Phase 3 — Les couches, une par une, mesurées (itératif, après la phase 2)

L'ordre est celui du coût documenté, pas de l'envie.

**3.1 Les quatre packs infra : sortir des Entities.** Remplacer
`GeoJsonDataSource` (`src/data/localGeojson.js:1160-1166`) par une
`PointPrimitiveCollection` + un `BillboardCollection` pour les icônes, avec un
tri par cellule (`src/data/geoMeshThinning.js`, déjà extrait) et un budget
d'écran : au-delà de 2 000 km, un point par cellule occupée ; en dessous, tout.
C'est le « bundled-infra globe-LOD declutter » que `docs/CURRENT-STATE.md`
nomme comme prérequis pour rendre la tuile INFRASTRUCTURE au premier
lancement. Mesure : tas et p90 avec les quatre packs sur Terre entière, CPU ÷4
puis machine de référence. Cible : tas −60 %, p90 ≤ 33 ms.

**3.2 Les packs entiers : pré-trier au build.** Les `.geojsonl` de 2 à 2,6 Mo
sont lus en entier puis triés côté client. Émettre au build (les scripts
`build-*.mjs` existent déjà) un pack **à deux niveaux** : un « monde » de
~3 000 lignes (`[lat, lon, poids, cat]`, format 4-uplet déjà utilisé par le
maillage) chargé au clic, et le détail par région à la demande. Ne pas tuiler
davantage avant d'avoir mesuré que le niveau 2 coûte encore.

**3.3 Pool de polylignes** (`src/data/localGeojson.js` pistes, puis les 13
autres `PolylineCollection`) et **un `Material` par polyligne**, selon la
mémoire `cesium-polylinecollection-traps`. Mesure : passe stable
`qa-cables-render-probe`.

**3.4 Bâti BD TOPO** : décoder les MVT dans un Worker (`pbf` +
`@mapbox/vector-tile` y passent sans changement) et **différencier** au lieu de
`clearPrimitive()` + rebuild (`src/data/bdtopoBuildings.js:698-711`) : garder
les tuiles encore en vue, n'ajouter que les nouvelles. Mesure : durée de la
passe d'arrêt (`moveEnd` → primitive prête) sur Lyon, CPU ÷4.

**3.5 Budgets adaptatifs.** Les ~40 constantes `MAX_RENDERED_*` / budgets de
maillage deviennent une fonction du profil (`lite` = 60 %) puis, plus tard, du
p90 mesuré des 60 dernières images (« coverage first, density second »,
`docs/KNOWN-ISSUES.md:12`). Commencer par les cinq couches à maillage FR.

**3.6 Entities → primitives pour les cas mesurés** : séismes
(`CallbackProperty` → géométrie statique + `requestRender`, déjà partiellement
fait, vérifier), puis les couches FR à `CustomDataSource` par ordre d'usage
(`transit-fr`, `road-events-fr`, `vigicrues`). Une par PR, avec la passe stable
avant/après.

### Phase 4 — L'origine : joignable par n'importe qui, sans mettre la production en danger — FAITE le 2026-09-09

Les six tâches sont livrées et mesurées. Deux gestes restent hors du dépôt et
appartiennent à Memel : la règle Cloudflare (4.3) et la levée du Basic auth
(4.4, dernière étape de la liste dans `docs/DEPLOY.md`). Le détail des
chiffres est dans `docs/PERFORMANCE.md` § « Origin capacity ».

**4.1 Bornes du conteneur — POSÉES.** `mem_limit: 1g`, `memswap_limit: 1g`,
`cpus: 1.5` et `NODE_OPTIONS=--max-old-space-size=768` dans
`deploy/vps/docker-compose.yml`, appliqués sur le VPS et vérifiés
(`docker inspect` : `mem=1073741824`, `nanocpus=1500000000` ; V8 annonce un
plafond de tas de 816 Mio). **Un cinquième réglage a été ajouté au plan :
`cpu_shares: 512`.** `cpus` est un plafond, pas une priorité — il borne un
emballement mais ne dit rien de la contention. C'est le poids, à la moitié du
défaut, qui fait que GEV rend le cœur à Postgres quand les deux le veulent.
Le `memswap_limit` égal au `mem_limit` n'est pas une redondance : la machine
n'a **aucun swap**, et des valeurs égales sont la façon de dire à Docker de ne
pas en inventer.

**4.2 En-têtes — FAITE, mais la prémisse du plan était fausse.** Mesuré sur le
serveur de prévisualisation : `vite preview` répond aux modèles avec un ETag
**faible dérivé de la mtime** (`W/"470200-1788982392686"`), donc un visiteur
qui revient paie un 304, pas 3,2 Mo. Le coût réel est ailleurs, et il est
double : `no-cache` veut dire que l'edge Cloudflare ne garde **rien**, donc le
premier avion de chaque visiteur sort de Paris ; et le script de déploiement
pose un tarball neuf, donc **chaque redéploiement change la mtime, l'ETag, et
fait retélécharger un art qui n'a pas bougé** — toutes les trois minutes tant
qu'une PR est ouverte.

Le répertoire est donc hashé, pas les fichiers un par un : `MODELS_BASE_DIR`
dans `vite.config.js` nomme `dist/models-<8 hex des octets>`, l'allowlist
`immutable` le couvre, et `src/data/modelAssets.js` traduit le nom logique en
URL servie aux six endroits qui passent une URL à Cesium. **Le `?url` par
fichier suggéré par le plan est impossible** : `flights.test.mjs` importe
`flights.js` sous `node --test`, où `import x from './c172.glb?url'` lève
`ERR_UNKNOWN_FILE_EXTENSION` avant le premier test. Un `define` de build n'a
pas ce défaut — Node y voit un identifiant absent et retombe sur `/models`.
Vérifié dans le navigateur : `/models-82ba2e5b/airplane.glb`, 88 144 octets,
`immutable`. Second volet vérifié aussi : les packs `.geojsonl` sont hashés par
Vite sous `/assets/`, donc `immutable` **et** brotli. Après ça, tout ce qui
pèse dans `dist/` est content-addressé ; il reste cinq SVG (28 ko) et les deux
pages HTML, qui ne doivent pas l'être.

**4.3 Cloudflare — l'expression est prête, la règle est toujours mauvaise.**
`deploy/vps/edge-ratelimit-probe.sh` répond sans deviner : il rafale une route
`/api` **sans clé** qu'aucune règle correcte ne devrait brider, plus `/` en
témoin. Mesuré depuis le VPS le 2026-09-09 : `/` passe 40 requêtes sans
broncher, `/api/voice/config` prend un **429 à la 31ᵉ requête, `error code:
1015`, `retry-after: 10`**. La règle est donc inchangée. Le geste est côté
tableau de bord.

**4.4 Ouverture publique — l'outillage est livré, l'interrupteur non.** Le
vrai manque n'était pas les quotas par IP (déjà posés : 20/30/20) mais le fait
qu'**un plafond par adresse ne borne pas une facture**. Le seul plafond global
qui existait était implicite — 20 × le cap par IP — donc le
`GEV_RATELIMIT_OPENAI_PER_MIN=20` de ce déploiement autorisait en silence
**400 appels facturés la minute**. Trois variables nouvelles le rendent
explicite : `GEV_RATELIMIT_{OPENAI,GOOGLE,VOICE_BRAIN}_GLOBAL_PER_MIN`, posées
à 60/90/40 dans `/opt/gev/.env` (inertes tant que ce code n'est pas déployé,
ce qui est l'intérêt de les poser d'abord). `GEV_TRUSTED_CLIENT_IP_HEADER`
était déjà en place et vérifié : `/healthz` à travers le tunnel renvoie une
adresse publique, pas celle du pont Docker. La liste ordonnée des six gestes
avant de retirer `GEV_ACCESS_PASSWORD` est dans `docs/DEPLOY.md` § « Opening
the origin to the public ». Son point 4 dit ce qu'un visiteur coûte, et la
réponse a changé depuis l'état des lieux : le portillon d'engagement de la
tâche 1.7 est livré, **un démarrage à froid ne dépense plus rien**. L'unité de
coût d'une page publique n'est donc pas l'arrivée mais le visiteur qui touche
le globe — une page chargée en boucle ne facture rien — et c'est contre ce
chiffre-là qu'il faut dimensionner les plafonds globaux.

**4.5 Capacité — on reste sur le KVM 2, mesuré.** Le banc `perf:origin`,
lancé depuis le VPS, donne à 50 visiteurs pendant 30 s : **129,9 démarrages à
froid par seconde**, 917 req/s, p50 39 ms, **p95 150 ms**, p99 178 ms, aucune
erreur, conteneur à **306,8 Mio sur 1 Gio**. Les deux seuils du plan (p95
`/api` ≤ 1 s, conteneur ≤ 1 Gio) sont tenus avec un ordre de grandeur de
marge. Pas de `docker builder prune`, pas de KVM 4.

À méthodologie identique, la même mesure valait **6,0 démarrages/s et p95
901 ms** au moment de la phase 0.4. Le facteur dix-neuf n'est pas venu de
cette phase-ci : c'est la précompression brotli (`precompress-dist.mjs`) qui a
transformé le plafond nommé en phase 0.4 — « c'est le gzip, pas la bande
passante » — en une lecture de fichier. Le débit, plat à 16,8 Mo/s à toutes
les charges, est passé à 158 Mo/s.

**4.6 Sonde de disponibilité — POSÉE et qui tourne.**
`deploy/vps/gev-health-probe.{sh,service,timer}`, activée sur le VPS, toutes
les 5 minutes, journal dans `/opt/gev/state/health.log`. Elle sonde **les deux
bouts** : `127.0.0.1:4173` et `https://gev.enerlens.com`, parce que l'origine
debout avec le public mort est un défaut de tunnel ou de DNS, et que les deux
morts est un défaut d'application — la différence est le diagnostic. Elle sort
en erreur quand le public tombe, donc le journal systemd le porte aussi.

**Ce que la phase 4 a trouvé et que le plan ne prévoyait pas.** `/opt/gev/.env`
contient une apostrophe non échappée (`OPENROUTER_APP_NAME=God's Eye View`) :
tout `. /opt/gev/.env` depuis bash meurt à la ligne 152 et les variables
suivantes ne sont pas posées. Le parseur `env_file` de Docker n'est pas un
shell et lit le fichier correctement, donc le conteneur n'a jamais rien vu —
mais n'importe quel script qui source ce fichier hérite du piège. Consigné
dans `docs/DEPLOY.md`.

### Phase 5 — Tenir la ligne

- `docs/PERFORMANCE.md` reçoit une section « machine de référence » avec les
  commandes exactes et les chiffres de chaque phase ; la page cesse d'être
  « des résultats sans banc ».
- Toute PR qui touche `src/main.js`, `index.html`, `vite.config.js` (build) ou
  un module de couche colle dans son corps la ligne `MEDIAN` de `perf:boot`
  avant/après. Pas de CI perf (il n'y en a aucune, et SwiftShader mentirait) :
  c'est une discipline de PR, comme `qa-perf` l'est déjà.
- Le score `qa-perf` est noté à chaque PR ; la mémoire
  `qa-perf-idle-failures-preexisting` passe à 24/24 après 2.5.

## 4. Ordre d'attaque et jalons

1. **Phase 0** entière — sans banc, rien de ce qui suit n'est vérifiable.
2. **1.1, 1.2, 1.7** (une journée, gain certain, zéro risque de régression
   fonctionnelle) → jalon A : ≤ 2,5 Mo avant la première tuile.
3. **1.3** par lots, puis **1.4** → jalon B : `viewer` ≤ 3,5 s à CPU ÷4.
4. **1.5 (a)** et **1.6** → jalon C : brotli servi, Cesium préchargé.
5. **2.1 à 2.5** sur la machine de référence → jalon D : `lite` livré, `qa-perf`
   24/24.
6. ~~**4.1, 4.2, 4.4** → jalon E : la page peut être ouverte.~~ **Phase 4
   entière faite le 2026-09-09.** Il reste deux gestes hors dépôt, tous deux
   côté Memel : restreindre la règle Cloudflare, puis retirer
   `GEV_ACCESS_PASSWORD` en suivant la liste de `docs/DEPLOY.md`.
7. **3.1 → 3.6**, une couche par PR, tant que le chiffre bouge.
8. **1.5 (b)** en spike quand tout le reste est fusionné.

## 5. Ce que ce plan ne fait pas, et pourquoi

- **Pas de réécriture** (WebGPU, autre moteur, autre framework). Cesium n'est
  pas le problème ; c'est ce qu'on lui demande par défaut sur toutes les
  machines.
- **Pas de tuilage vectoriel des packs** avant que 3.2 ait montré que le
  niveau 2 coûte encore : un serveur de tuiles est une infra de plus sur un
  VPS partagé.
- **Pas de Service Worker** dans un premier temps : les en-têtes `immutable` +
  l'edge Cloudflare font le cache chaud ; un SW ajoute un état à invalider à
  chaque déploiement de PR (le staging redéploie toutes les 3 min).
- **Pas de baisse de qualité en `full`** : le profil léger est un second
  réglage, pas une régression pour les machines qui tiennent la scène.
- **Pas de couche allumée par défaut** pour « montrer quelque chose » : le
  boot à zéro couche est la raison pour laquelle il tient déjà en 1,2 s sur
  Mac ; c'est au premier clic qu'il faut être bon.

## 6. Commandes

```sh
# build + serveur de prévisualisation (le lancer hors du groupe de processus
# de l'outil : macOS n'a pas setsid — voir .context/serve.py ou start_new_session)
npm run build && npx vite preview --host 127.0.0.1 --port 4179 --strictPort

# démarrage, profil petit portable (CPU ÷4 / 10 Mbit/s par défaut)
npm run perf:boot -- --url http://127.0.0.1:4179 --runs 5
# démarrage, sans bridage
npm run perf:boot -- --url http://127.0.0.1:4179 --cpu 1 --net none
# la scène qu'un usager regarde vraiment : 3 couches FR sur Lyon
npm run perf:layers -- --url http://127.0.0.1:4179
# une couche à la fois, et une stabilisation assez longue pour distinguer
# « charge encore » de « ne se gare jamais »
npm run perf:boot -- --url http://127.0.0.1:4179 --at lyon --layers transit-fr --settle 40000
# la deuxième visite : cache HTTP chaud, code cache V8 chaud
npm run perf:warm -- --url http://127.0.0.1:4179 --runs 5
# la liste des requêtes d'un boot, par octets
npm run perf:urls -- --url http://127.0.0.1:4179
# aucune clé dépensée avant un geste (et le résumé qui part après)
npm run qa:boot-spend -- --url http://127.0.0.1:4179
# les polices : rien chez Google, et les ligatures se forment
npm run qa:webfonts -- --url http://127.0.0.1:4179
# regénérer les polices après avoir ajouté une icône
npm run fonts:build
# le gouverneur de rendu (24/24 depuis le 2026-09-09)
node scripts/qa-perf.mjs --url http://127.0.0.1:4179
# coût par image d'une couche (passe stable / passe d'arrêt)
node scripts/qa-cables-render-probe.mjs --url http://127.0.0.1:4179
# imagerie : tuiles et octets par point de vue
QA_BASE_URL=http://127.0.0.1:4179 npm run qa:world-imagery-cost
# le contrat du profil de rendu : les 4 coûts, l'interrupteur, et « même carte »
npm run qa:perf-profile -- --url http://127.0.0.1:4179
# les quatre packs infra : entités dessinées, tas, p90 — les chiffres de la 3.1
npm run perf:infra -- --url http://127.0.0.1:4179
npm run perf:infra -- --url http://127.0.0.1:4179 --scene world --per-pack
# la même mesure, profil épinglé (sans quoi SwiftShader impose `lite`)
npm run perf:infra -- --url http://127.0.0.1:4179 --profile full \
  --baseline avant.json --json apres.json

# ── les coûts GPU fixes, un levier à la fois (le banc rend sur un VRAI GPU —
# voir § 0 : `headless: 'new'` n'est PAS SwiftShader) ─────────────────────────
# le classement, dans le régime où le remplissage domine
npm run perf:gpu-ab -- --url http://127.0.0.1:4179 --scale 2 --repeats 5
# la scène qu'un visiteur regarde, avec la détection qui a des candidats
npm run perf:gpu-ab -- --url http://127.0.0.1:4179 --scale 2 --at lyon \
  --layers irve-fr,schools-fr,transit-fr --settle 20000
# à ne PAS citer : deux démarrages, deux jeux de tuiles (voir 2.2)
npm run perf:gpu-ab -- --url http://127.0.0.1:4179 --levers profile

# ── l'origine, DEPUIS LE VPS uniquement (règle Cloudflare : 30 req/10 s par IP,
# et le Mac partage l'IP de Memel) ────────────────────────────────────────────
scp scripts/perf-origin-bench.mjs vps:/tmp/
ssh vps 'set -a; . /opt/gev/.env 2>/dev/null; set +a; \
  node /tmp/perf-origin-bench.mjs --url http://127.0.0.1:4173 \
    --auth "gev:$GEV_ACCESS_PASSWORD" --visitors 50 --duration 30'
ssh vps 'docker stats --no-stream gev'   # le RSS pendant, dans une autre session

# ── le GPU réel, à la main sur un vrai portable (phase 0.3) ──────────────────
# Ouvrir https://gev.enerlens.com/?welcome=0, F12 → Console, coller
# scripts/perf-real-gpu-console.js, renvoyer la ligne JSON.
```

Lire une ligne `MEDIAN` : **`app=`** est ce que ce dépôt sert (la cible de la
phase 1), **`window=`** est `app` plus tout ce que le fond de carte a streamé
en 25 s (la cible de la phase 2.3). Les deux portent leur `[min–max]` : une
médiane sans dispersion n'est pas une mesure, et c'est la dispersion qui a
montré que `viewer` variait du simple au double sur le même arbre.

## 7. Journal d'exécution

### 2026-09-09 — phase 0.1, et le jalon A à moitié

Trois tâches livrées (**0.1**, **1.2**, **1.7**), une quatrième tombée en
chemin (**2.5**), et le tableau du § 2 rempli avec sa dispersion. Mesuré avec
`npm run perf:boot --runs 5`, CPU ÷4 / 10 Mbit/s, cache vide, sur ce Mac.

| Mesure | Avant | Après |
|---|---:|---:|
| Octets de l'app, hors tuiles | 3,83 Mo [3,82–3,83] | **3,51 Mo [3,51–3,51]** |
| Requêtes de l'app, hors tuiles | 36 | **31** |
| Polices sur le fil | 410 kB, 3 origines | **92 kB, 1 origine** |
| Material Symbols | 323 kB (4 277 glyphes) | **4,0 kB (28)** |
| Clés dépensées avant tout geste | **5** | **0** |
| Rendus sur scène parquée / 5 s | 15 [12–19] | **0 [0–0]** |
| `qa-perf` | 19/24 | **24/24** |
| `viewer` prêt | 5,8 s [4,5–8,8] | 5,3 s [4,2–6,0] |

Ce que ces chiffres ne disent pas, et qu'il faut lire avec :

- **`window=` a AUGMENTÉ** (7,07 → 7,37 Mo), et c'est cohérent : la fenêtre est
  un temps fixe de 25 s, pas une fin de chargement. Une coque plus légère laisse
  passer plus de tuiles dans le même quart de minute. C'est la raison pour
  laquelle `app=` existe : sans lui, ce travail se serait lu comme une
  régression.
- **`viewer` bouge peu** (−0,5 s de médiane), et c'est attendu : les 410 kB de
  police ne sont pas le mur. Le mur reste le parse des 8,2 Mo de JS, que la
  tâche 1.3 attaque. Ce qui a vraiment changé sur cette colonne, c'est la
  **queue** : le 8,8 s a disparu, l'intervalle passe de 4,3 s de large à 1,8 s.
- **La cible « ≤ 1,8 Mo avant la première tuile » reste loin** : 3,51 Mo. Le
  skybox (0,9 Mo, tâche 1.1) et le découpage de l'entrée (tâche 1.3) sont les
  deux seuls leviers qui la mettent à portée. Aucun autre poste ne pèse assez.

Deux entrées de registre ouvertes par cette passe :

- **La tâche 2.5 est réglée au symptôme, pas à la garde.** Le world-overlay
  honore toujours le churn d'occludeur comme du travail de peinture ; il n'en
  reçoit simplement plus. Voir 2.5.
- **`app=` compte encore trois `.svg` identiques** (`/logo.svg` demandé trois
  fois au boot, en `Image`, `Fetch` et `Other`). 12 kB, donc pas une priorité,
  mais c'est le genre de détail que `perf:urls` rend visible et qu'aucune
  mesure agrégée ne montrerait.
- **`fiche.html` nomme Inter et JetBrains Mono sans les avoir jamais
  chargées** (`--font-sans` / `--font-mono` à `fiche.html:39-40`, aucune
  feuille de police liée) : la radiographie se compose donc dans la police
  système depuis toujours. Depuis cette passe, la corriger coûte une ligne —
  `<link rel="stylesheet" href="/fonts/fonts.css">` — mais ajoute 87 kB à une
  page qui n'en payait aucun. C'est un choix de typographie, pas de
  performance ; laissé à trancher, pas fait en passant.

**1.1 (skybox)** a été livrée dans la foulée, une fois les captures tranchées
par Memel — voir l'entrée suivante.

### 2026-09-09 (suite) — 1.1, et une leçon sur la méthode de capture

`viewer` **5,3 s → 3,57 s [3,55–3,62]**, app **3,51 → 2,67 Mo**, orbite p99
**38,2 → 23,8 ms**. Décision de Memel : les étoiles ne valent pas 1,7 s
d'attente sur la carte, mais elles valent quelque chose sur un fond satellite —
d'où `src/starfield.js` (§ 1.1).

**La première paire de captures était fausse, et personne ne l'aurait vu.**
L'« avant » et l'« après » ne montraient pas les mêmes libellés (France,
Espagne, Algérie d'un côté ; EUROPE, AFRIQUE de l'autre), et j'ai affirmé que
c'était « du chargement » sans le vérifier. Memel a demandé si l'altitude
l'expliquait : non — elle était **identique** dans les deux, donc constante,
donc incapable d'expliquer une différence. La vraie cause était le script de
capture, qui attendait 4 s en dur sans vérifier que les tuiles étaient
arrivées.

Refaites avec une attente de stabilisation réelle (`tilesLoaded` vrai sur douze
relevés consécutifs), les deux captures montrent **exactement** les mêmes
libellés et une boîte englobante du globe identique **au pixel** —
`[364, 58, 1004, 700]`, 640 × 642 dans les deux. Ce qui a permis de mesurer la
seule différence réelle : **2,74 % des pixels de fond allumés contre 0 %**,
luminance moyenne 2,82/255.

Au passage, une erreur d'observation corrigée par la mesure : le globe *semble*
plus grand sur fond noir franc. Il ne l'est pas — c'est l'œil, pas le rendu.

Ce qu'il faut en garder : **une capture A/B sans attente de stabilisation
produit des comparaisons fausses en silence**, exactement comme une médiane
sans dispersion. Le script corrigé est `.context/perf/shot2.mjs` ; s'il sert à
trancher une deuxième décision, il monte dans `scripts/`.

### 2026-09-09 (suite) — #121, hors plan, et une ligne du § 1.4 démentie

Pas une tâche du plan, mais un gain de rendu mesuré qui appartient à ce journal.
Sous les deux piles IGN, le fond satellite mondial se chargeait entier alors
qu'il était intégralement masqué. Le garde-fou existait — il exigeait seulement
que la vue tienne dans **une seule** boîte d'opacité, et au tangage par défaut
du cockpit (−30°) une vue de Paris à cheval sur deux boîtes n'était dans aucune.

| Vue Paris, tangage −30° | Avant | Après |
|---|---:|---:|
| Esri invisible | 69 req / 1 362 ko | **0** |
| IGN visible | 41 req / 927 ko | 41 req / 927 ko |
| Imagerie totale | 2 285 ko | **927 ko, −59 %** |

Le test porte désormais sur l'**union** des boîtes, et les boîtes sont dérivées
d'un balayage de 15 554 points de la Géoplateforme (`npm run qa:ign-opaque-boxes`)
au lieu d'être dessinées à la main : 17 retenues sur 24 candidates, et **deux
des cinq anciennes contenaient un vrai trou**. Sur 15 400 positions de caméra,
30 à 37 % de vues supplémentaires éteignent le fond.

Ce qu'il faut en retenir pour le plan lui-même : le § 1.4 écrivait « contrat
mesuré, à ne pas toucher » à propos de ce garde-fou. Il était faux, et les
anciennes boîtes avaient passé un contrôle 9×9 — un point tous les 0,56° sur une
boîte de 4,5°. **« Mesuré » ne veut rien dire sans la densité de la mesure.** La
ligne est corrigée.

### 2026-09-09 (suite) — la phase 0 est close, sauf ce qui demande un GPU

**0.2** et **0.4** sont faites, **0.3** est outillée et attend une machine.
Trois des quatre chiffres « non mesuré » du tableau § 2 sont remplis ; le
quatrième ne peut pas l'être depuis ce dépôt.

Tout est relevé sur `origin/main` à **`9701e35`**, donc **avant** le découpage
du JavaScript (#123), qui a atterri dans l'heure qui a suivi. Les octets ont été
remesurés dessus — **2,67 → 2,23 Mo**, jalon A franchi — et sont notés sous le
tableau du § 2. Le `viewer` de ce second relevé n'est pas exploitable : la charge
du Mac était à 22,5. Les lignes de rendu, de tas et d'origine ne bougent pas avec
cette PR.

| Ce qui manquait | Mesuré | Cible |
|---|---:|---:|
| `viewer` prêt, cache chaud | **0,60 s [0,59–0,96]** | ≤ 1,5 s ✅ |
| Tas JS, 3 couches FR | **40 Mio [38–47]** | ≤ 250 Mio ✅ |
| Origine, 50 boots simultanés | **`/api` p95 34 ms · RSS 345 Mio** | 1 s · 1 Gio ✅ |
| Orbite 3 couches, GPU réel | **toujours rien** | attend 0.3 |

**Trois cibles tenues, et aucune des trois n'était le problème.** C'est le
résultat le plus utile de la journée : le plan visait la mémoire, la latence
`/api` et le cache chaud, et les trois étaient déjà bonnes — la seconde visite
paie **zéro octet** et ouvre le globe en 0,6 s, le tas est six fois sous le
plafond, l'origine répond aux `/api` en 34 ms sous cinquante visiteurs. Ce que
ces mesures ont trouvé à la place, ce sont deux coûts que le plan ne pesait pas :

1. **Le plafond de l'origine est le gzip à la volée, pas la bande passante.**
   Débit plat à 16,8–17,7 Mo/s à 10, 25 et 50 visiteurs, conteneur à 175 % des
   200 % disponibles, p95 de `Cesium.js` à 4 271 ms. Aucun asset n'est
   pré-compressé. **La tâche 1.6 change donc de nature** : elle ne rend pas
   seulement 15 à 25 % d'octets au visiteur, elle rend du CPU à une boîte
   partagée avec la production Enerlens. Et la tâche 1.3 vaut plus qu'annoncé
   pour la même raison.
2. **Une couche animée cloue la scène à 60 images par seconde, pour toujours.**
   `transit-fr` seule : 300 rendus / 5 s, encore 300 après quarante secondes de
   stabilisation, gouverneur en `mode: "continuous"`, `holds: ["transit-fr"]`.
   `irve-fr` et `schools-fr` : **0** chacune. Ce n'est pas la fuite de 2.5, c'est
   un choix — mais un choix dont personne n'avait le prix, sur une machine dont
   le § 0 dit qu'elle doit rester fraîche. La phase 2 hérite d'une question de
   plus : 60 Hz, ou la cadence des positions réellement reçues ?

**Et `qa-perf` 24/24 ne l'aurait jamais vu** : son contrôle de scène parquée
éteint toutes les couches avant de compter (`scripts/qa-perf.mjs:123-124`). Un
arbre peut afficher 24/24 et ne jamais se garer chez un visiteur réel. C'est le
même motif que la ligne « contrat mesuré, à ne pas toucher » du § 1.4, démentie
le matin même par #121 : **une garantie ne vaut que la densité de ce qu'elle a
mesuré.**

Cinq corrections d'outillage, toutes issues d'un chiffre faux ou d'une panne :

- **`--warm` pendait 180 s sur la configuration la plus rapide.** La sonde de
  première image s'installait *après* la création du viewer ; sur un boot rapide
  la scène avait déjà dessiné et le gouverneur l'avait garée, donc la
  `postRender` attendue n'arrivait jamais. Elle est maintenant posée par
  `evaluateOnNewDocument`, avant tout code applicatif. La session `baghdad-v1` a
  observé le même symptôme de son côté (`tFirstRender=75534` sur un run, 3,3 s
  sur les trois suivants) — confirmation croisée.
- **Un run raté jetait les quatre autres.** Deux campagnes de cinq ont été
  perdues sur un `ProtocolError: Runtime.callFunctionOn timed out`, qui est un
  SwiftShader affamé, pas l'application. Un run qui lève est désormais compté et
  passé, et `runs=4/5` s'affiche sur la ligne `MEDIAN`.
- **`--layers` mesurait les octets d'un globe nu.** Les compteurs étaient figés
  à 25 s, avant l'allumage des couches. Il y a maintenant une seconde paire de
  marques — nommée `settle=` et non `layers=`, parce qu'à Lyon sans aucune couche
  elle compte déjà 1,51 Mo de tuiles : bouger la caméra vers une ville où le vol
  d'intro n'est jamais passé, ça se paie.
- **`--settle` sépare « charge encore » de « ne se gare jamais ».** Sans lui, le
  globe nu à Lyon affichait 56 rendus / 5 s et ressemblait à une fuite.
- **Un `/assets/*.js` absent répond 200 avec `index.html`.** Le banc d'origine
  vérifie désormais le `content-type` : sans ça, rejouer une trace enregistrée
  sur un autre build mesure des 404 rapides et rend un p95 flatteur.

Deux entrées ouvertes au registre, petites mais nommées : le boot demande
**`/api/geoid` pour un point situé en Caroline du Nord** avant que la caméra
n'arrive à Paris (0,3 kB, origine non identifiée), et **chaque chargement de
page POSTe une ligne dans `/api/realtime/debug-log`**, écrite en
`appendFileSync` synchrone dans un fichier sans rotation — un journal de mise au
point alimenté par la production.

Enfin, une note d'honnêteté sur les conditions : ces relevés ont été pris
pendant qu'un **second banc tournait sur le même Mac** (session `baghdad-v1`,
charge moyenne 4 à 8). Ça n'a pas déplacé les médianes — le boot à froid rejoue
**3 572 ms [3 558–3 591]** contre 3 570 ms le matin, et 2,67 Mo à l'identique —
mais ça a produit **une image à 73 secondes** dans un run d'orbite sur cinq. La
médiane l'absorbe ; c'est le `[min–max]` qui le montre, et c'est exactement
pourquoi la sonde n'imprime jamais une médiane seule.

### 2026-09-09 (suite) — 1.6, et le jalon des octets atteint

`app=` **2,23 → 1,77 Mo [1,77–1,77]**, à 29 requêtes inchangées. Le critère de
sortie de la phase 1 sur les octets — « ≤ 1,8 Mo avant la première tuile » — est
**atteint**. A/B sur la MÊME fabrication, en déplaçant simplement les fichiers
`.br` hors de `dist/` entre deux passes : c'est le seul protocole qui isole la
livraison du contenu.

| Objet | gzip du serveur | brotli-11 pré-calculé |
|---|---:|---:|
| `cesium-1.138.0/Cesium.js` | 1 651 kB | **1 282 kB** (−22 %) |
| `assets/index-*.js` | 326 kB | **266 kB** (−18 %) |
| `Assets/approximateTerrainHeights.json` | 97 kB | **78 kB** |
| `assets/airports-*.geojsonl` (couche) | 611 kB | **429 kB** (−30 %) |

**Le temps n'a PAS été mesurable aujourd'hui, et il ne faut pas le déduire des
octets.** Ce Mac portait un autre agent pendant toute la passe (load 4 à 28) ;
sur trois blocs de cinq démarrages, `viewer` a donné 5,9 s [3,0–42,8] avec
brotli et 3,7 s [3,1–5,6] sans — c'est-à-dire du bruit, pas une régression. La
colonne des octets, elle, est déterministe : même chiffre aux cinq démarrages,
dans les deux sens. Théoriquement 460 kB de moins à 10 Mbit/s valent ~0,37 s ;
c'est une prédiction, pas une mesure, et elle attend une machine au repos.

Trois choses apprises :

- **La compression est une étape de `npm run build`, pas un plugin.**
  `vite-plugin-cesium` copie ses 5,7 Mo dans `closeBundle`, qui est un hook
  *parallèle* chez Rollup : un plugin qui compresserait là courrait contre la
  copie et raterait le plus gros fichier une fois sur deux. Une étape après
  `vite build` n'a pas de course à perdre.
- **`total += await f()` perd des mises à jour.** Écrit ainsi dans la boucle de
  compression, le rapport annonçait 1,79 Mo pour 7,08 Mo réellement écrits :
  la forme lit l'ancienne valeur *avant* de suspendre, et les tâches
  concurrentes s'écrasent. Le bug n'était que dans le compteur, mais un
  compteur faux dans un outil de mesure est exactement ce qui fait accepter une
  optimisation qui n'existe pas.
- **`preload` pour Cesium (1.5 a) est annulé, mesuré.** Les deux scripts
  partent déjà à 285 et 286 ms : la balise du moteur est injectée en tête de
  `<head>`, au-dessus du module d'entrée, et le préchargeur du navigateur les
  voit dans le premier kilo-octet. Il n'y a rien à avancer.

### 2026-09-09 (suite) — 1.3 finie, et le mur qui reste n'est plus notre code

Fermeture statique de `src/main.js` : **2 708 → 2 104 kB** avant minification,
121 → 103 modules. Paquet d'entrée **1 134,5 → 853,3 kB** minifiés
(334,8 → 248,4 gzip ; **266 → 200 kB sur le fil**, brotli). `npm test`
6 647/6 647, `qa:lazy-voice` 8/8, `qa:lazy-layers` 9/9, `qa:brotli` 17/17.

**Le temps n'a de nouveau pas pu être séparé.** Deux tours d'A/B alternés entre
deux serveurs (`dist` et `dist-before` sur deux ports, mesures entrelacées pour
absorber une charge qui dérive) : AVANT 5 188 puis 4 778 ms, APRÈS 5 278 puis
5 062 ms, sur un Mac à load 18-21. Un relevé isolé de l'arbre APRÈS, pris à
load 8, donne `viewer` **2 686 ms [2 666–2 965]** avec une dispersion de 300 ms
— c'est une observation, pas un A/B, et elle ne doit pas être citée comme un
gain tant que les deux arbres n'ont pas été mesurés côte à côte au repos.

**Ce que la mesure de taille dit, et qui change la suite du plan.** Le paquet
d'entrée fait maintenant **853 kB en face des 5 593 kB de Cesium** : le
JavaScript analysé avant le globe est à **87 % le moteur**. Finir la tâche 1.4
(`ui.js`, 455 kB dans la fermeture, 10 492 lignes, et le StyleManager que
`init()` construit en premier) retirerait ~200 kB minifiés, soit **3 %** de ce
que le navigateur analyse. La règle de ce plan — une tâche qui ne bouge pas le
chiffre est annulée — désigne donc **1.5 (b)**, le passage de Cesium à l'ESM
émondé, comme la prochaine tâche de la phase 1, et renvoie 1.4 après elle.

**La leçon technique de la passe** : la moitié du gain ne venait pas de la
voix. `src/hud.js` importait une fonction à `voice/gevActions.js` (164 kB de
runner et de vocabulaire derrière) et `src/locations.js` deux helpers à
`annotations/annotationResolver.js` (50 kB) — deux arêtes qu'aucun `grep` ne
montre et que le graphe Rollup donne en une commande. Le graphe est `npm run perf:graph`
(`scripts/vite.module-graph.config.mjs`) : il a servi trois fois, il est donc
monté de `.context/` dans `scripts/`.

### 2026-09-09 (suite) — 1.5 (b) : la phase 1 sort, et un critère écrit trop tôt

`viewer` **3 655 ms [3 638–5 094] → 2 344 ms [2 298–2 826]**, `app=`
**1,78 → 1,34 Mo**, JS brut avant le globe **6 446 → 4 773 kB**, total sur le
fil **1 482 → 1 023 kB**. **Les deux critères de sortie de la phase 1 sont
atteints.**

**Le critère écrit pour cette tâche, lui, ne l'est pas, et c'est le point de
l'entrée.** La rédaction disait « si l'ESM émondé tombe sous ~3 Mo brut,
garder ; sinon revenir à (a) ». Il tombe à 3 945 kB. Le seuil avait été posé à
l'aveugle, avant la moindre mesure, et l'appliquer à la lettre aurait rendu au
visiteur 1,6 Mo de JavaScript et 1,3 s d'attente pour 945 kB au-dessus d'un
chiffre que personne n'avait vérifié. Gardé, donc — et l'écart consigné ici
plutôt que le critère réécrit après coup, parce qu'un seuil qu'on ajuste une
fois qu'on connaît le résultat ne sert plus à rien la fois suivante.

**Sur la mesure du temps.** Seul le tour 1 de l'A/B compte : il a été pris à
load ~15 et donne une dispersion de 530 ms côté ESM contre 1 460 ms côté IIFE.
Les tours suivants sont tombés pendant que la charge de ce Mac montait à
**133** (un autre agent), et un chiffre relevé là ne vaut rien — ni dans un
sens ni dans l'autre. Protocole utilisé, à reprendre : les deux arbres
construits, servis par deux `vite preview` sur deux ports, et les mesures
**entrelacées** plutôt que groupées, pour qu'une dérive de charge frappe les
deux colonnes également.

**Ce que le passage a emporté sans que ce soit prévu.** `window.Cesium`
n'existait que par l'IIFE — jamais sur le serveur de développement, ce que
trois harnais notaient déjà en commentaire sans que personne en tire la
conséquence. Douze harnais QA le lisaient ; ils lisent maintenant
`viewer.clock.currentTime` (l'horloge à laquelle les `Property` de la scène
sont réellement évaluées, donc plus juste que `JulianDate.now()`) et
`scene.globe.ellipsoid.cartographicToCartesian` à la place de
`Cesium.Cartesian3.fromDegrees`. Trois tests sur `deferCesiumScriptTag` ont été
supprimés avec le plugin : ils épinglaient une balise qu'aucune fabrication
n'émet plus.

**Ce qui reste à surveiller** : l'empreinte du chunk `cesium-engine` dépend
désormais de ce que l'application appelle, donc une livraison qui touche une
API Cesium nouvelle fait retélécharger 824 kB à un visiteur qui revient — là où
seule une montée de version du moteur le faisait avant. Et le chemin
photoréaliste Google reste non testé de France (403 EEE), avant comme après.

**Il reste 1.4 dans la phase 1, et elle est à re-justifier** : `ui.js` vaut
~200 kB minifiés sur 4 773 kB analysés avant le globe, soit **4 %**, pour la
plus grosse chirurgie du plan.

**Après rebasage sur `main` (#124, #125), remesuré** : `viewer` **2 315 ms
[1 907–8 924]**, `app=` **1,35 Mo [1,35–1,36]** — mêmes chiffres à 30 ms et
10 kB près. Le maximum à 8,9 s est une pointe de charge, pas l'arbre.

Une entrée à ouvrir au passage : **#125 remet 13 kB dans la fermeture de
démarrage** (`src/keySetup.js`, importé statiquement par `main.js` pour la
puce POWER UP). C'est petit et ce n'est pas une régression du plan — mais
c'est exactement la forme que 1.3 combat, et le module se retire lui-même dès
que l'endpoint du serveur de dev est absent, c'est-à-dire dans **toutes** les
livraisons. Un `import()` au premier clic sur la puce le sortirait entièrement.

**Un piège de l'outillage, appris deux fois dans la même session** :
`npm run perf:graph` construisait dans `dist/` et ne connaît pas
`scripts/precompress-dist.mjs`. Le `dist/` qu'il laissait derrière lui n'avait
donc aucun `.br`, `vite preview` retombait sur le gzip, et `qa:brotli` lisait
8/17 pour une raison qui n'était pas dans le code testé. La commande écrit
désormais dans `.context/perf/dist-graph`.

### 2026-09-09 (suite) — le banc avait un GPU depuis le début, et le profil `lite`

**La prémisse du § 0 était fausse.** Trois fichiers répétaient que Chromium
headless rend en SwiftShader et que les coûts GPU fixes sont donc invisibles au
laboratoire. C'était vrai de l'ancien mode headless. Vérifié sur le contexte GL
de Cesium lui-même, dans l'application, avec les arguments de lancement exacts
de `perf-boot-probe.mjs` :

    ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)

`headless: 'new'` est le navigateur complet avec la fenêtre supprimée. **La
phase 2 n'était pas bloquée** ; elle attendait une machine pour un critère de
sortie, et ce critère-là attend toujours. Le reste était mesurable, et l'est
maintenant : `npm run perf:gpu-ab`.

**Ce que le nouveau banc fait de différent.** Trois choix, chacun né d'un
chiffre qui mentait :

1. **Il ne compte pas d'images, il fait du travail de rendu.** `scene.render()`
   en rafale, puis un `readPixels` d'un pixel pour drainer le pipeline. Sans
   ça, à 1366×768 sur un M5, les quatre leviers sont tous à 16,7 ms — le
   balayage de l'écran, pas le coût du rendu.
2. **Il interleave.** A/B/A/B, une médiane par condition. La charge de ce Mac
   est passée de 4 à 160 pendant cette session (un autre agent) ; une passe
   « tout A puis tout B » aurait encaissé la dérive comme un résultat.
3. **Il refuse de tourner sur un renderer logiciel**, comme le snippet 0.3.

**Les leviers, classés.** Détail en 2.2. L'ordre est stable et il ne suit pas
le plan : `msaaSamples` domine tout le reste (−49 à −59 % à 2732×1536), la
résolution de mouvement vient ensuite (−48 %), la netteté est un tiers de ça
(−17 %), et `preserveDrawingBuffer` est **non concluant** — −3 à −12 % à
1366×768, +3 % à 2732×1536, ce qui n'est pas un gain, c'est du bruit. Il est
quand même posé en `lite` parce qu'il n'a aucun coût visuel et qu'il retire une
copie par image, mais il ne doit pas être compté dans le gain.

**Un −86 % qui n'existait pas.** La comparaison de bout en bout, deux
démarrages `?perf=full` contre `?perf=lite`, a rendu −86 % puis −89 %. Les deux
mêmes leviers sur **une seule page** en rendent −63 %, et le produit de leurs
gains individuels en prédit −58 %. Deux démarrages, ce sont deux jeux de tuiles
résolus différents. Le mode existe toujours dans l'outil — il sert à vérifier
que `?perf=` atteint le Viewer — mais il imprime maintenant un avertissement
sous son propre résultat. C'est la règle « un levier par PR » du § 3 appliquée
à la mesure, et elle a servi le jour même où elle a été relue.

**Et la sonde d'images du profil a failli classer un M5 en petit portable.**
p90 **33,9 ms** au premier essai. Deux causes, deux corrections, toutes deux
dans `src/perfProfile.js` : sous `requestRenderMode` l'intervalle entre deux
`postRender` n'est un temps d'image que pendant un rendu continu (plafond à
250 ms), et les soixante premières images d'une session sont la compilation des
shaders et les premières tuiles, pas le coût de rendu (elles sont jetées). Le
M5 retombe à **22,9 ms**, verdict `full`, machine chargée à 30. Le verdict ne
s'applique plus à la session en cours non plus : couper la netteté quatre
secondes après l'ouverture se voit, et ces images-là sont les moins
représentatives de la session.

**Le levier qui a failli rouvrir la fuite de 2.5.** `resolutionScale` 0,8
pendant le mouvement, écrit exactement comme le plan le demande, met
l'application dans une boucle sans fin : Cesium déduit `moveStart` d'une
comparaison de caméra **qui inclut le frustum**, redimensionner le tampon de
dessin change le rapport d'aspect, et la restauration de `moveEnd` relève donc
un `moveStart`. Mesuré sur l'arbre construit : **535 ms de « mouvement » et
16 ms de repos, indéfiniment**, sur une caméra garée — globe bloqué à la
tolérance grossière, scène jamais garée, image qui pulse. Détail et garde en
2.2. Deux leçons : le plan ne pouvait pas le prévoir, et **`qa-perf` 24/24 ne
l'aurait jamais vu** — il mesure un globe nu en `full`.

**Et une seconde panne silencieuse du même acabit.** Avec
`preserveDrawingBuffer: false`, toute lecture du canevas doit appeler
`scene.requestRender()` **puis** `scene.render()` : sous `requestRenderMode`,
`render()` seul est un **no-op**, et la lecture rend un cadre **noir**. Trois
appelants corrigés, dont celui qui envoie « la vue courante » au modèle vocal.
Rien à l'écran ne signale cette panne ; c'est le contrôle n°7 de
`qa:perf-profile`.

**Ce que ça laisse à faire pour 0.3.** Rien n'a changé au critère de sortie de
la phase 2 : il demande un p90 sur une UHD 620 et aucun chiffre ci-dessus n'en
est un. Ce qui a changé, c'est qu'on peut maintenant **classer** les leviers
sans machine — donc en annuler un qui ne paie pas — et que l'option (2) du
plan (« un substitut sur le Mac ») est livrée plutôt qu'imaginée.

### 2026-09-09 (suite) — phase 3.1, et un test qui manquait depuis le début

La 3.1 est livrée, mesurée, et elle n'a **pas** pris le chemin que le plan
annonçait. Le plan attribuait le coût des quatre packs aux Entities de Cesium
et demandait de les remplacer par une `PointPrimitiveCollection`. Le banc dit
autre chose : le coût dominant n'était pas la nature des objets, c'était
**leur nombre à l'écran**, et il venait d'un test manquant.

**Le constat.** La seule question spatiale que la couche posait était
`EllipsoidalOccluder` — « ce point est-il au-delà de l'horizon ». Un horizon
est un hémisphère, pas un cadre. Mesuré sur `origin/main`, à **120 km au-dessus
de Lyon**, les quatre packs allumés : **10 178 entités sur 22 218 à
`show = true`**. Dix mille d'entre elles étaient de l'autre côté de l'Europe,
de l'Afrique ou de l'Atlantique — batchées dans des tampons de sommets,
re-culées par Cesium à chaque image, et jamais une seule fois à l'écran. Il n'y
a jamais eu de troncature de vue dans cette couche.

Deux autres coûts, trouvés en instrumentant le tas plutôt qu'en le devinant :

- **16 834 épingles fantômes.** `GeoJsonDataSource` construit une
  `BillboardGraphics` (une punaise dessinée sur un canevas) pour chaque feature
  POINT qu'il parse, à partir de `markerSize`/`markerColor`. La boucle de la
  couche donnait ensuite à la même feature son propre `PointGraphics` — sans
  jamais retirer la punaise. **Chaque point des quatre packs était dessiné deux
  fois**, la punaise sous le disque qui la recouvre.
- **22 218 tables HTML que personne ne lit.** Le `describe` par défaut de
  Cesium rend un `<table>` de toutes les propriétés, en chaîne, pour chaque
  feature. L'application ne lit jamais `entity.description` : une fiche locale
  est écrite par `localInfrastructureOverlayCopy`. Mesuré sur le seul pack des
  ports, **1 995 276 caractères sur 2 951 features**.

**Ce qui est livré.** Une garde de frustum (`localRecordOffScreen`, sphère
englobante dimensionnée sur la hampe de rappel — 65 px à l'écran, donc
~1 670 km de monde à 20 000 km — plus l'emprise levée et les pistes étirées),
un budget de cellule d'écran au-delà de 2 000 km (`selectLocalGlobeLodMarks`,
26 px, plafond 600 marques par pack, la sélection courante toujours épinglée),
`describe: () => undefined`, et `feature.billboard = undefined`. Le budget suit
le profil de rendu de la phase 2 (`lite` = 60 % des marques, maille élargie de
`1/√0,6` parce qu'une grille perd des cellules au CARRÉ de son pas) — c'est la
règle de la 3.5 appliquée au budget que la 3.1 introduit, câblée tout de suite
plutôt que laissée en dette.

**Le banc.** `npm run perf:infra` (`scripts/perf-infra-lod.mjs`) : trois
scènes, les quatre packs, tas relevé par `HeapProfiler.collectGarbage` +
`Runtime.getHeapUsage`, p90 d'images, CPU ÷4 appliqué **après** le chargement.
Il n'existait pas — `qa-overlay-baseline.mjs` mesure deux packs sur quatre, sur
une vue américaine, sans lecture de tas — donc la 3.1 n'était pas closable même
avec le bon code.

Mesuré le 2026-09-09, M5, SwiftShader, 1440×900, CPU ÷4, profil `lite`
(SwiftShader tombe dans `SMALL_GPU_RE`, et le banc l'imprime maintenant).

| Scène | Entités dessinées | p90 mouvement | p90 repos | Tas des packs |
|---|---:|---:|---:|---:|
| **world** 20 000 km — avant | *le rendu meurt* | — | — | — |
| **world** — après | **387** / 22 218 | **167 ms** | 217 ms | 613 MiB |
| **region** 2 000 km — avant | 22 218 | *aucune image* | 2 750 ms | 390 MiB |
| **region** — après | **9 055** | 233 ms | **283 ms** (−90 %) | 617 MiB |
| **city** 120 km — avant | 10 178 | 567 ms | 500 ms | 695 MiB |
| **city** — après | **234** (−98 %) | **150 ms** (−74 %) | **183 ms** (−63 %) | 630 MiB (−9 %) |

Trois choses que ce tableau ne dit pas, et qu'il faut lire avec :

- **La scène `world` de l'avant n'est pas lente, elle est impossible.** Sur
  trois tentatives, deux ont tué le processus de rendu (`Target closed`) et la
  troisième a expiré un délai de protocole de dix minutes. Monter le tas de
  V8 à 4 Gio n'y a rien changé. C'est exactement la scène que
  `docs/CURRENT-STATE.md` décrit comme le motif du retrait de la tuile
  INFRASTRUCTURE, et c'est la scène que la 3.1 visait.
- **La cible « tas −60 % » n'est PAS atteinte** : −9 % sur la seule paire
  comparable. Les épingles et les tables partent, le reste ne bouge pas, et le
  banc dit pourquoi : mesuré pack par pack, le coût est de **28 à 36 Kio par
  feature, uniformément sur les quatre** — y compris sur les packs plats qui ne
  portent ni piste ni emprise. Ce n'est donc pas la donnée, c'est la machinerie
  `Entity` + `Property` elle-même. **Seule la migration vers les primitives
  l'enlève**, et elle reste entièrement à faire : c'est la moitié de la 3.1 que
  ce travail ne livre pas.
- **`region` est la scène qui coûte encore le plus, et c'est le seuil qui le
  décide.** Le plan écrit « au-delà de 2 000 km » ; le code applique donc
  `> 2 000 km`, et 2 000 km pile est la dernière altitude sans budget. La garde
  de frustum seule y laisse **9 055 marques** — dix fois mieux qu'avant, mais
  toujours un mur, sur une vue qui montre l'Europe entière et où personne ne
  sépare deux ouvrages voisins. Descendre `LOCAL_GLOBE_LOD_HEIGHT_M` est une
  ligne ; c'est une décision de produit (« en dessous, tout » est une garantie
  écrite), pas une correction, donc elle n'est pas prise ici.

**Une entrée de registre ouverte au passage, hors 3.1.** `anfrFrance.js`
PARTAGE ses `Material` entre polylignes (`_mastMaterials`, `_sectorMaterial`
au niveau module) — précisément le piège que la mémoire
`cesium-polylinecollection-traps` enregistre, un `Material` partagé plantant au
`destroy`. Le pool de pistes de `localGeojson.js`, lui, alloue un `Material`
par polyligne et est conforme. C'est la matière de la 3.3.

**Un chiffre de harnais a bougé, et il décrivait le bug.**
`qa-airports.mjs` exigeait « plus de 20 polylignes dans le lot » à 12 km
au-dessus de Roissy. Le lot en tient 8 maintenant, toutes à l'écran : les 12
autres étaient des pistes distribuées à des terrains hors cadre. Le plancher
passe aux cinq pistes de Roissy ; l'invariant qui compte — le pool tient
exactement ce qui est dessiné — n'a pas bougé.
