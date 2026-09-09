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

Ce que le laboratoire **ne mesure pas** : le GPU. Chromium headless rend en
SwiftShader (logiciel), donc toutes les mesures d'images par seconde ci-dessous
sont relatives (méthode de `scripts/qa-perf.mjs`). Les coûts GPU fixes
(MSAA, post-traitement, `preserveDrawingBuffer`) ne se voient **que sur une
vraie machine faible**. Le plan en prévoit une (phase 0).

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

| Cible | Départ | **+ skybox (1.1)** | **+ couches (1.3, #123)** | **+ brotli (1.6)** | Objectif |
|---|---:|---:|---:|---:|---:|
| Octets de l'app (hors tuiles), cache vide | 3,83 Mo [3,82–3,83] | 2,67 Mo [2,67–2,67] | 2,23 Mo [2,22–2,23] | **1,77 Mo [1,77–1,77]** ✅ | **≤ 1,8 Mo** |
| Requêtes de l'app (hors tuiles) | 36 | 29 | 29 | **29** | — |
| Fenêtre 25 s, tuiles comprises | 7,07 Mo [6,95–7,85] | 5,90 Mo | 5,43 Mo | 5,00 Mo | *voir 2.3* |
| `viewer` prêt, CPU ÷4 / 10 Mbit/s | 5,8 s [4,5–8,8] | 3,57 s [3,55–3,62] | 3,22 s | *non séparé du bruit* | **≤ 3,5 s** |
| `viewer` prêt, CPU ÷4, cache chaud | non mesuré | non mesuré | **0,60 s [0,59–0,96]** ✅ | non repris | ≤ 1,5 s |
| JS brut exécuté avant le globe | 8,2 Mo | 8,2 Mo | **6,7 Mo** (5,6 Cesium + 1,1 entrée) | 6,7 Mo | ≤ 4 Mo |
| Orbite 5 s, zéro couche, CPU ÷4 (relatif) | p90 32,5 / p99 44,3 ms | **p90 20,6 [18,4–21,5] / p99 23,8** ✅ p99 | non repris | *non séparé du bruit* | **p90 ≤ 18 / p99 ≤ 33 ms** |
| Orbite 5 s, 3 couches FR, CPU ÷4 (relatif, SwiftShader) | non mesuré | non mesuré | **p90 19,5 [18,6–23,8] / p99 31,6 [21,5–34,9] ms** | non repris | — |
| Scène **parquée**, 3 couches FR | non mesuré | non mesuré | **301 rendus / 5 s [300–301]** — `transit-fr` tient le gouverneur en `continuous` | non repris | 0 sans couche animée ; **cadence à trancher** avec (voir 0.2) |
| Orbite 5 s, 3 couches FR, **UHD 620 réel** | non mesuré | non mesuré | **toujours non mesuré** (0.3) | non mesuré | p90 ≤ 33 ms, aucune image > 100 ms |
| Scène parquée, détection ON | 15 rendus / 5 s [12–19] | 0 ✅ | 0 ✅ | 0 ✅ | **0** (`qa-perf` 24/24 ✅) |
| Clés dépensées avant tout geste | 5 | 0 ✅ | 0 ✅ | 0 ✅ | **0** |
| Tas JS, 3 couches FR allumées | non mesuré | non mesuré | **40 Mio [38–47]** ✅ | non repris | ≤ 250 Mio |
| 4 packs infra sur Terre entière | « le fps part avec » | inchangé | inchangé | inchangé | p90 ≤ 33 ms sur la machine de référence |
| Origine : 50 démarrages à froid simultanés | non mesuré | non mesuré | **`/api` p95 34 ms · RSS 345 Mio** ✅ | non repris | `/api` p95 ≤ 1 s, conteneur ≤ 1 Gio |

> La colonne « Polices + clés » (0.1 / 1.2 / 1.7) est repliée dans « Départ »
> depuis l'ajout de la colonne brotli, pour garder le tableau lisible ; son
> détail reste au journal, § 7. Les lignes marquées « non repris » sont celles
> que #124 a relevées et que la passe brotli n'a pas re-mesurées : elle ne les
> touche pas.
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

**La cible des octets est atteinte : 1,77 Mo pour un plancher à 1,8.** Ce qui
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

**0.3 Une vraie machine faible.** 🟡 **Outillée, en attente d'une machine.**
La mesure ne peut pas être automatisée — c'est le seul point du plan qui demande
un geste humain — mais tout ce qui l'entoure est prêt :

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

Sans l'une des trois, les tâches **2.1 à 2.4 restent gelées** : les faire en
aveugle serait reproduire le M5 d'août.

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

**1.4 `ui.js` (462 kB) : sortir le cockpit, les styles visuels et la lightbox
CCTV du chemin de démarrage.** Même mécanique qu'en 1.3, par `import()` au
premier usage (bouton COCKPIT, sélecteur de style, clic CCTV). Mesure identique.

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
- (b) *Ambitieuse* : `rebuildCesium: true` dans `vite-plugin-cesium`
  (`vite.config.js:25416`) pour passer par l'ESM et laisser Rollup émonder.
  Les 102 fichiers font `import * as Cesium` en accès membre statique, ce que
  Rollup sait émonder ; le seul accès dynamique est
  `window.__CESIUM__ = Cesium` (`src/annotations/annotationEngine.js:7`), à
  retirer d'abord. Faire un **spike d'une demi-journée** : build, taille, et
  `npm test` + `qa:keyless-boot`. Si l'ESM émondé tombe sous ~3 Mo brut, garder ;
  sinon revenir à (a) et l'écrire dans le CHANGELOG pour que personne ne
  réessaie.

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

### Phase 2 — Le rendu : un profil « léger », automatique et débrayable (2 à 3 jours, machine de référence obligatoire)

**2.1 `src/perfProfile.js` : détecter, décider, exposer.** Lu **avant** la
construction du Viewer (MSAA et `preserveDrawingBuffer` ne se changent pas
après). Entrées : `navigator.hardwareConcurrency ≤ 4`, `deviceMemory ≤ 4`,
`WEBGL_debug_renderer_info` contenant `Intel(R) HD|UHD|Iris`, `Mali`, `Adreno`,
`SwiftShader`, `prefers-reduced-motion`, et — la seule mesure honnête — les
**temps des 60 premières images** après le premier rendu (p90 > 28 ms →
léger). Sorties : `full` / `lite`, forcées par `?perf=lite|full`, persistées
en `localStorage` (jamais dans le lien de partage), et un interrupteur
« Mode léger » dans le rail DISPLAY à côté de SCOPE. Le profil ne change
**jamais** ce qui est affiché (couches, données), seulement comment.

**2.2 Les quatre coûts fixes, un A/B chacun sur UHD 620.**
- `msaaSamples` 4 → 1 en `lite` (`src/main.js:188`). Vérifier les deux
  usages qui s'y adossent (`src/data/vigicrues.js:81`, `src/data/gasFrance.js:153`
  : des lignes fines) — passer ces polylignes à 2 px en `lite`.
- `preserveDrawingBuffer` true → false (`src/main.js:191`), et pour les
  captures d'écran forcer un `scene.render()` juste avant `toDataURL` /
  `toBlob` (chercher les appelants dans `src/ui.js`).
- Netteté OFF par défaut en `lite` (`src/ui.js:403`).
- `resolutionScale` 0,8 **pendant le mouvement seulement**, 1,0 au repos, avec
  la mécanique exacte de `src/globeDetailGovernor.js` (`moveStart`/`moveEnd`,
  garde de blocage). Sur un écran 1366×768 le 0,8 se voit à peine en mouvement
  et coupe 36 % des pixels.
Mesure : orbite 5 s, p90/p99, sur la machine de référence, un levier à la fois.
Gain attendu (ordre de grandeur habituel sur GPU intégré) : MSAA 20-35 %,
sharpen 5-10 %, preserve 5-10 %, résolution 25-35 % en mouvement.

**2.3 Le globe et le tileset en `lite`.** `globe.maximumScreenSpaceError` 2 →
3 au repos (×2 en mouvement, inchangé), `tileCacheSize` 100 → 60 (mémoire),
`skyAtmosphere.show` false ou `atmosphereLightIntensity` réduit. Pour le
tileset Google (hors EEE) : `maximumScreenSpaceError` 16 → 24 en `lite`,
`cacheBytes` 256 Mio, `skipLevelOfDetail: true`, `dynamicScreenSpaceError:
true` (`src/main.js:245-247`). Mesure : `perf:boot` en octets sur le vol
d'intro (438 req / 14,4 Mo aujourd'hui avec le gouverneur, mémoire
`globe-detail-governor-measured-gains`), et p90 sur la machine de référence.

**2.4 Détection en `lite` : 75 → 40 % de densité**, et fondu à 0 %. La
détection reste ON (directive du 2026-08-22), elle fait moins de candidats par
solve. Mesure : orbite avec `flights` allumé, p90 ; `qa-perf` §1b doit rester
vert.

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

Leçon de méthode, à garder : la cause était dans la phase 1 alors que la tâche
était rangée en phase 2, et elle a été trouvée en lisant le chemin qui DÉCLENCHE
le rendu, pas celui qui le sert.

**2.6 Les petits per-frame.** `src/scopeMask.js:355-356` réalloue le
backing-store du canvas à chaque dessin (ne le faire qu'au changement de
taille) ; `src/celestialRing.js:367` reste abonné à `postRender` quand l'anneau
est éteint (désabonner). Mesure : passe stable de
`scripts/qa-cables-render-probe.mjs` avant/après ; si < 0,3 ms, ne pas
fusionner, juste le noter.

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

### Phase 4 — L'origine : joignable par n'importe qui, sans mettre la production en danger (1 à 2 jours)

**4.1 Bornes du conteneur.** `mem_limit: 1g`, `memswap_limit: 1g`,
`cpus: 1.5` dans `deploy/vps/docker-compose.yml`, et
`NODE_OPTIONS=--max-old-space-size=768`. Aujourd'hui GEV peut, par une fuite
de cache Overpass ou AIS, prendre la mémoire de Postgres Enerlens. Mesure :
`docker stats` sous le banc 0.4.

**4.2 Ce qui manque en en-têtes.** Étendre l'allowlist `immutable` aux
modèles glTF en les hashant (`import x from './models/c172.glb?url'` ou un
préfixe de version comme pour Cesium), sinon 3,2 Mo à chaque activation de
`flights`. Idem pour les packs `.geojsonl` (déjà hashés par Vite → déjà
couverts, vérifier avec `perf:urls`).

**4.3 Cloudflare.** Remplacer la règle « 30 req / 10 s sur tout `/api` » par
l'expression de `docs/DEPLOY.md:210-229` (cinq routes qui dépensent une clé).
C'est côté tableau de bord, donc côté Memel ; l'exécuteur prépare l'expression
et le test de vérification depuis le VPS.

**4.4 Ouverture publique, quotas d'abord.** Avant de lever le Basic auth :
`GEV_RATELIMIT_OPENAI_PER_MIN`, `GEV_RATELIMIT_GOOGLE_PER_MIN`,
`GEV_RATELIMIT_VOICE_BRAIN_PER_MIN` posés (limiteurs opt-in qui existent,
`vite.config.js:1183-1219`), un plafond de dépense côté consoles OpenAI et
Google, et `GEV_TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip` vérifié via
`/healthz`. Puis retirer `GEV_ACCESS_PASSWORD`. Une page ouverte sans quotas
est une clé publique.

**4.5 Capacité : rester sur le KVM 2, décider sur mesure.** Le banc 0.4 dit si
50 boots simultanés tiennent. Si le p95 `/api` dépasse 1 s ou si le RSS frôle
la borne : d'abord `docker builder prune` (12,8 Go), puis KVM 4 (8,99 → 14,99 $
/ mois), **pas** de CDN séparé pour les statiques : l'edge Cloudflare les
sert déjà en HIT, et déplacer `dist/` sur Pages/R2 casserait l'hypothèse
same-origin de `/api` pour un gain d'egress qui n'existe plus.

**4.6 Une sonde de disponibilité.** `curl /healthz` toutes les 5 min depuis
le VPS vers `gev.enerlens.com` (pas depuis le Mac), journal dans
`/opt/gev/state/`, pour savoir quand la page publique tombe avant qu'un
lecteur le dise.

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
6. **4.1, 4.2, 4.4** → jalon E : la page peut être ouverte.
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
