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
- Empilement d'imagerie encore présent sous les deux piles IGN
  (`src/mapStackController.js:684-692`), tenu par la mise en veille
  `_syncWorldBaseVisibility()` sur `moveEnd` — contrat mesuré, à ne pas
  toucher.

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
- Ce qui manque : brotli (gzip seul, `dep-*.js:48261`), limites de conteneur,
  `Cache-Control` sur `/models/*.glb` (servis `no-cache`, 3,2 Mo de modèles
  d'avions retéléchargés à chaque activation de couche), et la règle Cloudflare
  qui limite tout `/api` à 30 req/10 s (documentée dans `docs/DEPLOY.md:210-229`,
  à restreindre aux routes qui dépensent une clé).

## 2. Cibles

Toutes mesurées avec les outils de la phase 0, médiane de 3 à 5 passes,
dispersion notée. Une cible sans dispersion n'est pas une mesure.

Colonne « aujourd'hui » remplie le 2026-09-09 (médiane de 5, `[min–max]`) ;
colonne « au 09-09 » = après les tâches 0.1, 1.2, 1.7 et 2.5.

| Cible | Départ | Au 09-09 | Objectif |
|---|---:|---:|---:|
| Octets de l'app (hors tuiles), cache vide | 3,83 Mo [3,82–3,83] | 3,51 Mo [3,51–3,51] | **≤ 1,8 Mo** |
| Requêtes de l'app (hors tuiles) | 36 | 31 | — |
| Fenêtre 25 s, tuiles comprises | 7,07 Mo [6,95–7,85] | 7,37 Mo [6,70–7,65] | *voir 2.3* |
| `viewer` prêt, CPU ÷4 / 10 Mbit/s, cache vide | 5,8 s [4,5–8,8] | 5,3 s [4,2–6,0] | **≤ 3,5 s** |
| `viewer` prêt, CPU ÷4, cache chaud | non mesuré | non mesuré | ≤ 1,5 s |
| JS brut exécuté avant le globe | 8,2 Mo | 8,2 Mo | ≤ 4 Mo |
| Orbite 5 s, zéro couche, CPU ÷4 (relatif) | p90 32,5 [19,1–36,9] / p99 44,3 ms | p90 24,7 [20,4–32,1] / p99 38,2 ms | **p90 ≤ 18 / p99 ≤ 33 ms** |
| Orbite 5 s, 3 couches FR, **UHD 620 réel** | non mesuré | non mesuré | p90 ≤ 33 ms, aucune image > 100 ms |
| Scène parquée, détection ON | 15 rendus / 5 s [12–19] | **0 [0–0]** ✅ | **0** (`qa-perf` 24/24 ✅) |
| Clés dépensées avant tout geste | 5 | **0** ✅ | **0** |
| Tas JS, 3 couches FR allumées | non mesuré | non mesuré | ≤ 250 Mio |
| 4 packs infra sur Terre entière | « le fps part avec » | inchangé | p90 ≤ 33 ms sur la machine de référence |
| Origine : 50 démarrages à froid simultanés | non mesuré | non mesuré | `/api` p95 ≤ 1 s, conteneur ≤ 1 Gio |

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

**0.2 Un scénario « 3 couches FR » reproductible.** 🟡 **Outillée, pas encore
mesurée.** `npm run perf:layers` fait le scénario (Lyon, `irve-fr` +
`schools-fr` + `transit-fr`, orbite 5 s, tas, p90/p99) ; les chiffres restent à
relever et à inscrire au tableau du § 2.

*Rédaction d'origine :* Après le boot :
`irve-fr` + `schools-fr` + `transit-fr` sur Lyon, orbite 5 s, tas, octets,
p90/p99. C'est la scène qu'un usager réel regarde ; le globe nu ne suffit pas.

**0.3 Une vraie machine faible.** Chrome sur un portable Intel UHD (ou un
Windows d'occasion à 150 €) avec `chrome://gpu` vérifié non-SwiftShader,
`?welcome=0`, la même orbite, `performance.now()` entre `postRender` relevé
depuis la console. Sans cette machine, les tâches 2.1 à 2.4 ne peuvent pas être
validées — les faire quand même en aveugle serait reproduire le M5 d'août.
Consigner dans `docs/PERFORMANCE.md` sous une nouvelle section « machine de
référence », avec le renderer exact.

**0.4 Un banc d'origine.** Depuis le VPS (jamais depuis le Mac, même IP que
Memel et règle Cloudflare) : `autocannon` ou `oha` contre `127.0.0.1:4173`
avec le jeu exact des requêtes d'un boot (`/`, les 2 scripts, les 6 `/api`),
50 connexions, 30 s, p95 et RSS du conteneur (`docker stats`).

Critère de sortie : les quatre chiffres « aujourd'hui » du tableau § 2 sont
remplis, dispersion incluse, et versionnés dans `docs/PERFORMANCE.md`.

### Phase 1 — Le démarrage : moins d'octets, surtout moins de JavaScript (2 à 3 jours)

**1.1 Skybox et fonds Cesium : −0,9 Mo, une ligne.** Construire le Viewer
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
- (a) *Sûre* : garder le build IIFE externe, mais le **pré-compresser en
  brotli** (1 656 → ~1 300 kB) et ajouter `<link rel=preload as=script>` dans
  `index.html` pour qu'il parte au même instant que l'entrée. Zéro risque
  fonctionnel.
- (b) *Ambitieuse* : `rebuildCesium: true` dans `vite-plugin-cesium`
  (`vite.config.js:25416`) pour passer par l'ESM et laisser Rollup émonder.
  Les 102 fichiers font `import * as Cesium` en accès membre statique, ce que
  Rollup sait émonder ; le seul accès dynamique est
  `window.__CESIUM__ = Cesium` (`src/annotations/annotationEngine.js:7`), à
  retirer d'abord. Faire un **spike d'une demi-journée** : build, taille, et
  `npm test` + `qa:keyless-boot`. Si l'ESM émondé tombe sous ~3 Mo brut, garder ;
  sinon revenir à (a) et l'écrire dans le CHANGELOG pour que personne ne
  réessaie.

**1.6 Brotli à l'origine.** Pré-compresser au build (`vite-plugin-compression`
ou un `closeBundle` maison écrivant `.br` et `.gz` à côté de chaque asset
> 1 kB), et servir le `.br` depuis un middleware `configurePreviewServer` à
côté de `staticCachePolicyPlugin` (`vite.config.js:25040`) quand
`Accept-Encoding` le contient, en gardant les en-têtes `immutable` et `Vary`.
Cloudflare ne recompresse pas un gzip d'origine, il faut que l'origine le
fasse. Mesure : `perf:urls` (colonne `enc`), gain attendu −15 à −25 % sur les
2,4 Mo de scripts.

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

**1.1 (skybox) n'a pas été faite** : c'est le seul poste de la phase 1 qui
change ce qu'on voit, et le plan demande de le trancher en capture avec Memel
avant de le livrer. Le gain est chiffré (848 kB d'étoiles + 18 kB de lune
+ 294 kB de `waterNormals.jpg`), le code est d'une ligne ; il manque l'accord.
