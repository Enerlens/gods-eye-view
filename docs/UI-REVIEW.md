# Revue UI de God's Eye View

*Revue conduite le 2026-09-03 sur `http://localhost:4290/?welcome=0`, branche
`tests-5-sous-agents-fork`. Elle porte sur **l'interface** — chrome, HUD,
panneaux, lisibilité à l'écran — et non sur le vocabulaire graphique des couches,
qui fait l'objet de `docs/REPRESENTATION.md` — **pas encore fusionné, il vit
sur la branche `boris-mericskay-bonnes-pratiques`**, à laquelle cette revue
renvoie plusieurs fois.*

## Comment elle a été faite, et ce que ça implique pour la lire

Six agents ont exploré la même interface avec des **lentilles de critique
disjointes** — hiérarchie & lisibilité, cohérence du système, états &
micro-interactions, accessibilité, audit de doctrine cartographique, et un
« regard neuf » à qui aucune grille n'a été donnée. Aucun ne connaissait les
constats des autres. Chaque constat a ensuite été soumis à un **vérificateur
adversarial** chargé de le réfuter, qui devait refaire la mesure lui-même.

**60 constats bruts → 48 survivants → 40 défauts distincts**, dont **7 trouvés
deux fois par des lentilles indépendantes**. Les 48 incluent 3 verdicts
`INCERTAIN`, conservés faute d'avoir été réfutés — d'où l'écart d'une unité avec
certains décomptes du corps du document, qui les traitent au cas par cas. Douze sont tombés ; la section
[« Ce que la réfutation a écarté »](#ce-que-la-réfutation-a-écarté) les garde,
parce que leurs motifs d'échec valent pour calibrer la prochaine revue.

Trois réserves à garder en tête en lisant :

- **Tout a été mesuré sous SwiftShader headless**, jamais sur un GPU réel. Les
  temps de frame cités ne valent que les uns par rapport aux autres.
- **Le serveur de dev est tombé en cours de session**, ce qui a amputé cinq
  mesures. Elles sont listées dans les angles morts.
- **La section « ratés par les lentilles » n'a pas été réfutée.** Ce sont des
  pistes, pas des constats — au moins l'une d'elles (le `<h1>` qui contiendrait
  une feuille de style) est bancale : le `<span>` porteur est `aria-hidden`.

## Où sont les preuves

| | |
|---|---|
| Les six rapports de lentille, non résumés | [`ui-review/rapports/`](ui-review/rapports/) |
| Captures citées (46) | [`ui-review/captures/`](ui-review/captures/) |
| Sondes et relevés bruts (23) | [`ui-review/sondes/`](ui-review/sondes/) |

Les captures sont au format WebP. **Quinze sont sans perte** — ce sont les
recadrages qui servent de preuve à une mesure de contraste, leurs pixels sont
exacts. Les trente et une autres, vues d'ensemble photographiques du globe, sont
compressées avec perte : elles servent de contexte, pas de mesure. Les sondes
sont les scripts jetables qui ont produit les chiffres, conservés tels quels pour
que chaque mesure soit rejouable ; ce ne sont pas des harnais maintenus, et ils
n'ont pas leur place dans `scripts/`.

---

## En un paragraphe

GEV rend correctement ce qu'il calcule ; ce qu'il ne fait pas, c'est **rendre lisible ce qu'il rend**. Les six lentilles convergent sur un même diagnostic : le produit a une couche de données solide et une couche d'affichage qui n'a jamais été arbitrée. Le texte de l'interface est posé nu sur un canvas dont la luminance va de 0 à 1, si bien que la ligne qui répond à « où suis-je » disparaît sur un toit clair (contraste mesuré 1,04, seuil AA 4,5) et que les cinq pastilles qui ouvrent les 53 couches sont les textes les moins lisibles de l'écran (1,67 à 2,11:1, en 8 px). La clé de lecture — la légende — existe, est correcte, et vit dans un tiroir replié par défaut, pendant que la carte peinte pose des étiquettes qui ne nomment ni leur couche ni leur unité (« Rhône · 8,63 » à quarante pixels de « Rhône · 5 437 » : un taux et un effectif dans la même pastille). Sous FLIR, la légende reste en couleur alors que la carte passe en niveaux de gris et que l'ordre de luminance des départements s'inverse — la clé cesse d'être valide. Les jetons de design sont déclarés dans `:root` et ignorés (147 `border-radius` en dur sur 161, 22 interlettrages pour un seul rôle typographique), les états autres que repos et survol ne sont pas dessinés (3 règles `:active` contre 69 `:hover`), le globe — c'est-à-dire la totalité de la valeur du produit — n'est ni atteignable au clavier ni nommé, et le HUD de fiction (`COLL`, `GSD`, `NIIRS`, `TOP SECRET // SI-TK // NOFORN`) occupe exactement les emplacements où l'on cherche une date de donnée, une échelle et un cap. Rien de tout cela n'est un bug de rendu : ce sont des décisions d'affichage qui n'ont jamais été prises une fois pour toutes, et que chaque surface a reprises pour son compte.

---

## Les motifs

Huit causes racines couvrent les 40 défauts. Le nombre entre crochets est le nombre d'instances rattachées.

### M1 — Le texte de la chrome n'a jamais de plaque, et le fond sous lui est un canvas qui va du noir au blanc [6 instances · hiérarchie, accessibilité, regard neuf]

Aucun ancêtre de `#hud-summary` ne porte de `background-color` opaque ni de `backdrop-filter` — vérifié par `getComputedStyle` sur toute la chaîne `#hud-summary → .hud-summary-wrap → .hud-content → .hud-corner → #intel-hud`, tous en `rgba(0,0,0,0)`. La première couleur opaque est le `BODY`, sous le canvas. À quoi s'ajoute une couleur de texte à alpha effectif 0,53 (`rgba(0,255,255,0.6)` × `opacity: 0.88`) et une variable `--text-dim: rgba(232,234,237,0.3)` (`style.css:16`) appliquée aux étiquettes les plus structurantes. Le résultat n'est pas « peu contrasté » : sur les toits clairs de Paris, le texte est **à la couleur exacte du fond** (ratio 1,00).

### M2 — La clé de lecture est dans un tiroir, et le signe posé sur la carte ne se nomme jamais [6 instances · hiérarchie, doctrine, regard neuf]

Les légendes existent, sont complètes et portent leurs intervalles en toutes lettres (« 663–1 315 bornes », « > 6,89 / 1 000 habitants ») — mais elles vivent dans `#data-panel`, replié par défaut : à l'état d'accueil, 19 nœuds `.data-toggle-legend-item` sont dans le DOM, **0 visible**. Symétriquement, ce qui est peint sur le globe n'emporte pas sa provenance : ni nom de couche, ni unité, ni indicateur actif. Le défaut se compose avec lui-même — un chiffre anonyme sur la carte, et sa clé fermée.

### M3 — Le système de design est déclaré et n'a jamais été contraignant : chaque surface re-décide [9 instances · cohérence, hiérarchie, états]

`:root` définit `--panel-radius`, `--btn-radius`, `--transition-fast`, `--transition-smooth`. Sur 161 déclarations `border-radius`, **14 passent par un jeton** ; `.15s` est écrit 23 à 26 fois alors que `--transition-fast` vaut exactement 150 ms. Même dérive sur la typographie (17 à 18 tailles calculées à l'écran, dont quatre paliers dans une fenêtre de 0,64 px), sur les icônes (deux familles graphiques dans la même liste, 7 glyphes servant chacun deux sujets sans rapport), sur les formateurs de nombres (trois conventions divergentes dans le groupe ÉNERGIE), sur `:disabled` (18 règles, 7 opacités, 3 curseurs). La signature est constante : **on ajoute, on ne retire pas** — jusqu'à une police d'icônes tierce chargée à chaque démarrage et jamais utilisée.

### M4 — Les états qui ne sont ni « repos » ni « survol » ne sont pas dessinés [6 instances · états, accessibilité]

69 sélecteurs `:hover` contre **3** `:active` ; `outline: none` sur le bouton ON/OFF des 57 couches sans aucun remplaçant ; `feed-loading` sans règle de couleur, donc rendu au cyan exact de `feed-nominal` ; classes de cycle de vie posées par le JS (`transitioning enabling`, `lifecycle-uncertain`) sans aucune règle CSS ; aucune région `aria-live` ne bouge quand une couche s'allume. Le produit soigne l'état qu'on obtient en passant la souris et saute tous ceux qui accusent réception d'un geste ou d'une attente.

### M5 — Le clavier et le lecteur d'écran n'ont pas de produit : la valeur est dans le canvas et dans la souris [10 instances · accessibilité, regard neuf, états]

Le canvas Cesium n'a ni `role`, ni `aria-label`, ni `tabindex` ; `el.tabIndex === -1` et `canvas.focus()` par script ne le rend pas actif. La sélection d'entité passe exclusivement par un `ScreenSpaceEventHandler` sur le canvas, et la fiche produite est peinte sur ce même canvas — donc absente du DOM, non sélectionnable, non copiable, non annonçable. Autour, les cibles sont petites (20 sur 25 sous 24 px), la ligne de couche n'est cliquable que sur 6,6 % de sa surface, et la seule porte pour chercher un lieu n'a ni curseur, ni rôle, ni nom accessible.

### M6 — Le HUD est une fiction assumée, et elle occupe toutes les places où l'on cherche une information réelle [9 instances · hiérarchie, doctrine, regard neuf]

`src/hud.js:1-13` revendique l'esthétique NRO/NGA. Le problème n'est pas la fiction, c'est qu'elle est **exclusive** : `COLL` (temps de collecte) est l'horloge du poste, `GSD` vaut `altitude × 0,000375` quel que soit le tangage — faux d'un facteur 3,3 au réticule — `NIIRS` en est dérivé, et il n'existe **aucune barre d'échelle ni aucun indicateur de cap ailleurs dans l'application**. Les deux textes les plus forts de l'écran (`GOD'S EYE VIEW` à 15,86:1, la bannière de classification à 5,45:1) ne portent aucune information exploitable pendant que les portes d'entrée fonctionnelles sont à 8 px et 1,7:1.

### M7 — Le fork parle deux langues, et la couture passe au milieu des phrases [5 instances · cohérence, regard neuf, accessibilité]

Le socle amont est anglais, les 57 couches France sont françaises, et la frontière ne suit aucune limite lisible : sept en-têtes de panneaux sur sept en anglais, huit en-têtes de catégorie sur huit en français **à l'intérieur de l'un d'eux**, `ALT: 555m` avec point décimal à côté de « Séismes (24 h) » avec espace insécable, et des cartes d'entité qui alternent « Réseau de transport » et « of published trace » dans la même phrase. `<html lang="en">` couronne l'ensemble.

### M8 — Le désencombrement ne suit pas l'échelle : ce qui est peint se chevauche [5 instances · hiérarchie, regard neuf, doctrine]

À la vue d'entrée du produit, l'amas d'étiquettes (≈ 185 × 150 px) est plus grand que la France métropolitaine qu'il annote (≈ 135 × 105 px), et les plaques se tranchent mutuellement (« Giron|Paris · 10 245 »). La fiche d'entité court de `x=0` au-delà de `x=1600`, passe sous les panneaux et se coupe en plein mot au bord droit. En S-LIVE, une trentaine de pastilles s'empilent sur l'Europe de l'Ouest.

---

## Constats, par ordre de traitement

**Le principe de l'ordre :** largeur de surface touchée × coût de la mauvaise lecture × probabilité de rencontre à l'état par défaut. M1 et M2 passent devant tout parce qu'ils touchent l'état d'accueil, sans aucune action utilisateur, et qu'ils portent sur la lecture de la donnée elle-même. M8 suit parce que ses deux instances sont des CASSE visibles à la première seconde. M5 vient ensuite malgré son CASSE : la population touchée est plus étroite et la correction est structurelle, pas cosmétique. M6, M3, M4, M7 ferment la marche — larges mais sans perte de donnée.

---

### Bloc 1 — M1 : le texte sans plaque

#### 1. Les titres de panneaux sont les textes les moins lisibles de l'écran
- **Gravité :** CASSE
- **Lentilles :** hiérarchie **et** accessibilité — **convergence indépendante**, par deux méthodes de mesure différentes (A/B DOM-only à canvas figé d'un côté, pixel de glyphe le plus clair contre mode de l'histogramme de l'autre).
- **Recoupement :** **nouveau** — `REPRESENTATION.md` est un audit du vocabulaire des couches, il ne regarde pas la chrome.
- **Reproduction :** ouvrir l'URL, ne rien ouvrir, regarder les cinq pastilles repliées.
- **Preuve :** contraste sur les pixels de glyphe, sur leur propre plaque sombre — DATA LAYERS 1,67 · SCENES 1,74 · CCTV 1,73 · CONTEXT 1,57, contre VISUAL PRESETS 3,49 sur le même écran (hiérarchie) ; « DATA LAYERS » à **2,10:1** et « SCENES » à 2,11:1 par échantillonnage pixel direct (accessibilité). `font-size: 8px` à l'état `.collapsed` (`style.css:6970-6975`), `color: rgba(232,234,237,0.3)` (`style.css:16`). Aucune récupération au survol : la seule règle `:hover` touchant `.panel-title` vise `#command-dock`, pas les pastilles repliées. Captures `docs/ui-review/captures/adv-refute-hier-9f3-crop-panel-titles.webp`, `docs/ui-review/captures/ui-accessibilite-crop-panel-titles.webp`, `docs/ui-review/captures/advcheck-2f9-vglobe.webp`.

#### 2. 20 des 50 textes visibles échouent AA sur le pixel réellement rendu
- **Gravité :** CASSE · **Lentille :** accessibilité
- **Recoupement :** **nouveau**
- **Reproduction :** V-GLOBE, viewport 1440×900, composer chaque couleur CSS sur le mode de l'histogramme de son rectangle.
- **Preuve :** `docs/ui-review/sondes/ui-a11y-pixel.json` (53 mesures). `p.subtitle` 11 px = 2,30:1 ; les cinq `button.panel-collapse-btn` = 2,43:1 (2,40:1 à la revérification) ; `#gev-voice-cost-value` 6,4 px = 2,41:1 ; libellé de classe de légende 8 px = 2,32:1. Captures `docs/ui-review/captures/ui-accessibilite-vglobe.webp`, `docs/ui-review/captures/advcheck-2f9-vglobe.webp`. *Réserve du vérificateur :* le sous-titre « NO PLACE LEFT BEHIND » ne se reproduit pas (son rectangle contient du texte à 9,43:1) et le compte « 20 sur 50 » n'a été revérifié que sur 12 nœuds.

#### 3. Le HUD n'a pas de plaque : le texte disparaît là où le globe est clair
- **Gravité :** CASSE · **Lentille :** hiérarchie
- **Recoupement :** **nouveau**
- **Reproduction :** V-PARIS (2.3364 / 48.86 / 900 m, pitch −35, heading 160), lire la ligne SUMMARY.
- **Preuve :** sur les pixels de glyphe de `#hud-summary`, contraste médian global 2,83 ; sur les 11,4 % de pixels posés sur un fond de luminance > 0,25, médiane **1,04**, minimum **1,00**. Chaîne d'ancêtres vérifiée : cinq niveaux tous en `rgba(0,0,0,0)`, `backdrop-filter: none`. Captures `docs/ui-review/captures/adv-refute-hier-9f3-crop-hud-summary.webp` (× 3, nearest) et `docs/ui-review/captures/ui-hierarchie-hud-summary-paris.webp` ; DOM dans `docs/ui-review/sondes/adv-refute-hier-9f3-domA.json`.

#### 4. Les deux paliers les plus sombres de chaque rampe sont invisibles dans la légende elle-même
- **Gravité :** FRICTION · **Lentille :** accessibilité
- **Recoupement :** **nouveau** — l'audit valide les rampes en tant que rampes (B4), il ne regarde pas leur rendu dans la pastille de 6 px.
- **Reproduction :** déplier `#data-panel`, activer `irve-fr`, `schools-fr`, `delinquance-fr`, mesurer chaque `.data-toggle-legend-swatch` (6×6 px) contre le verre du panneau.
- **Preuve :** sur pixels réellement rendus, palier le plus sombre de `delinquance-fr` = **1,65:1**, avant-dernier 2,87:1 ; `irve-fr` classe 0 = 1,30:1, classe 1 = 1,85:1 ; `schools-fr` classe 0 = 1,60:1. WCAG 1.4.11 exige 3:1. Le filet `box-shadow 1px rgba(255,255,255,0.18)` (`style.css:6102`) composité donne 1,67:1 — il ne sauve pas. Capture `docs/ui-review/captures/advcheck-2f9-legend.webp`. *Atténuation retenue :* chaque item porte son intervalle en toutes lettres, donc clé dégradée et non clé absente.

---

### Bloc 2 — M2 : la clé enfermée, le signe anonyme

#### 5. Deux étiquettes portent le même nom, deux chiffres, aucune ne dit sa couche ni son unité
- **Gravité :** CASSE
- **Lentilles :** hiérarchie **et** doctrine (test A3) — **convergence indépendante**, sur deux captures et deux sessions.
- **Recoupement :** **confirmé des deux côtés, et durci.** `REPRESENTATION.md` (piste 5) écrit : « dix couches peignent les mêmes 96 polygones […] allumer trois couches nationales donne trois fois la même carte de France en trois teintes ». L'audit avait vu la cause structurelle ; la revue mesure sa conséquence à l'écran.
- **Reproduction :** allumer `irve-fr` + `schools-fr` + `delinquance-fr`, V-FRANCE, lire les pastilles.
- **Preuve :** « Paris · 11,9 » à (762,207) et « Paris · 10 245 » à (752,257), 40 px d'écart ; « Rhône · 8,63 » / « Rhône · 1 555 » ; « Gironde · 7 455 » / « Gironde · 1 416 » ; « Nord · 7 801 » / « Nord · 2 504 ». Le premier de chaque paire est un taux pour 1 000 habitants, le second un effectif. Captures `docs/ui-review/captures/adv-refute-hier-9f3-france-snat.webp`, `docs/ui-review/captures/advK7-d-snat-france.webp`, `docs/ui-review/captures/ui-doctrine-snat-france-panelsclosed.webp`, `docs/ui-review/captures/ui-hierarchie-labels-france.webp`.

#### 6. Sous FLIR, la légende cesse d'être une clé valide et l'ordre de luminance s'inverse
- **Gravité :** CASSE · **Lentille :** doctrine (test F5)
- **Recoupement :** **nouveau** — l'audit ne traite pas l'interaction entre les presets capteur et les couches thématiques.
- **Reproduction :** `delinquance-fr` seul, V-FRANCE en régime national, relever un pixel au centroïde de plusieurs départements, cliquer FLIR, re-rendre, relever les mêmes points.
- **Preuve :** caméra journalisée identique avant/après (2.4 / 46.6 / 1 600 000 m). NORMAL → FLIR : Finistère L = 0,7248 → **0,0152** ; Cantal L = 0,7413 → **1,000** ; Nord L = 0,6413 → 0,2307. L'ordre `Manche > Cantal > Finistère > Nord > Aube > Loiret > Hérault > Gironde` devient `Cantal > Manche > Aube > Loiret > Nord > Gironde > Hérault > Finistère` — le Finistère passe du 3ᵉ au 8ᵉ rang. Les 7 pastilles de légende restent en couleur, inchangées. Captures `docs/ui-review/captures/advK7-c-normal.webp`, `docs/ui-review/captures/advK7-c-thermal.webp`, `docs/ui-review/captures/ui-doctrine-delinquance-thermal.webp` ; script `docs/ui-review/sondes/advK7-c.mjs`.

#### 7. Trois choroplèthes peintes, aucune légende visible sans ouvrir un panneau
- **Gravité :** FRICTION (descendue de CASSE)
- **Lentilles :** hiérarchie **et** doctrine (test D1) — **convergence indépendante**.
- **Recoupement :** **nouveau**
- **Reproduction :** allumer les trois couches nationales, V-FRANCE, ne toucher à aucun panneau.
- **Preuve :** 19 nœuds `.data-toggle-legend-item` dans le DOM, **0 visible** ; balayage de tout `[class*=legend],[id*=legend]` filtré sur visibilité effective → liste vide ; `#data-panel` = `panel-collapsible collapsed active`. Captures `docs/ui-review/captures/advK7-d-snat-france.webp`, `docs/ui-review/captures/ui-doctrine-snat-france-panelsclosed.webp`, `docs/ui-review/captures/ui-hierarchie-vfrance-snat.webp`. **Ce que la réfutation a retiré du constat :** la doctrine invoquait « une légende repliée dans un panneau qui *recouvre* la carte ». Mesuré : panneau déplié = `{x:52, y:271,5, w:176, h:50}`, soit **0,55 % de la surface écran**, en bord gauche, sans recouvrir la Bretagne ; et les 19 items redeviennent tous visibles au premier clic (`docs/ui-review/captures/adv-refute-hier-9f3-france-datapanel-open.webp`). C'est un coût de lecture, pas une impossibilité.

#### 8. « Non diffusé — secret statistique » est codé par une teinte, dont la clarté tombe au milieu de la rampe
- **Gravité :** FRICTION (descendue de CASSE)
- **Lentilles :** accessibilité **et** doctrine (test D3) — **convergence indépendante**.
- **Recoupement :** **théorique inversé.** `REPRESENTATION.md` classe `delinquance-fr` parmi les six couches « déjà justes » et cite nommément « 4ᵉ état non publié distinct » comme le meilleur traitement du secret statistique du dépôt. La revue confirme l'audit sur **la carte** et le contredit sur **la légende**.
- **Preuve :** `rgb(92,107,138)`, L = 0,1463, intercalé entre la classe 4 (`rgb(224,49,49)`, L = 0,1824) et la classe 5 (`rgb(176,32,32)`, L = 0,1024) ; contraste avec la classe 4 = **1,184**, sous le plus petit pas inter-classes de la rampe (1,35). Le swatch n'a ni `has-glyph` ni `mask` (relevé sur les 7 items, 6×6 px chacun). **Ce que la réfutation a retiré :** sur la carte, un second canal non chromatique existe et est documenté — `delinquanceFrance.js:234-236` définit `SUPPRESSED_OUTLINE_COLOR '#aebbd6'` à alpha 0,75 et 2,0 px sur une primitive dédiée `_suppressedOutlines` (lignes 947-958), contre un contour ordinaire `'#0b0e12'` à 0,35 et 1,0 px, et l'en-tête l'argumente (« with its own wider, brighter outline so the eye finds the withheld cells first »). Le défaut se réduit au swatch de légende, qui n'hérite pas de ce contour. Capture `docs/ui-review/captures/advcheck-2f9-legend.webp`.

#### 9. B4 est tenu, mais trois paires de classes adjacentes d'`irve-fr` sont sous 1,5:1
- **Gravité :** FRICTION · **Lentille :** accessibilité
- **Recoupement :** **confirmé des deux côtés** — l'audit ne relève aucun défaut d'ordonnancement sur ces rampes ; la revue le vérifie à l'écran, y compris sous deutéranopie simulée (Viénot-Brettel 1999), et ne trouve que l'étroitesse des pas.
- **Preuve :** luminances strictement monotones dans les trois rampes. Paires adjacentes `irve-fr` : 1,42 / 1,49 / 1,49 / 1,58 / 1,64 ; `schools-fr` : 1,53 / 1,60 / 1,55 / 1,54 / 1,43 ; `delinquance-fr` sur pixels rendus : 1,35 / 1,61 / 1,61 / 1,51 / 1,75. `docs/ui-review/sondes/ui-a11y-4.json`, `docs/ui-review/captures/advcheck-2f9-legend.webp`.

---

### Bloc 3 — M8 : les chevauchements

#### 10. À V-GLOBE, les étiquettes sont plus grandes que le pays qu'elles annotent, et elles se tranchent entre elles
- **Gravité :** CASSE (**remontée** de FRICTION par le vérificateur)
- **Lentille :** hiérarchie
- **Recoupement :** **nouveau**
- **Reproduction :** allumer les trois couches nationales, poser V-GLOBE (10, 48, 12 000 000 m, pitch −90).
- **Preuve :** amas d'étiquettes de (645,385) à (830,535) ≈ 185 × 150 px, France métropolitaine de (655,395) à (790,500) ≈ 135 × 105 px. Chevauchements lisibles à l'œil : « Giron|Paris · 10 245 » à y≈456, « Pyrenees…|Gironde » à y≈486-504, « Paris · 11,9 » partiellement couvert par « Seine-Maritime · 1 362 ». Captures `docs/ui-review/captures/adv-refute-hier-9f3-globe-snat.webp`, `docs/ui-review/captures/ui-hierarchie-labels-globe.webp`, `docs/ui-review/captures/ui-hierarchie-c-V-GLOBE-S-NAT.webp`.

#### 11. La fiche d'un département s'ouvre sous les panneaux et déborde du viewport
- **Gravité :** CASSE — *le seul CASSE que le vérificateur maintient explicitement à ce niveau.*
- **Lentille :** regard neuf
- **Recoupement :** **nouveau**
- **Reproduction :** allumer `delinquance-fr`, V-FRANCE, clic souris réel (CDP) au centre d'un département. *Les événements pointeur synthétiques ne suffisent pas.*
- **Preuve :** bandeau peint sur canvas, y≈455→600, courant de `x=0` au-delà de `x=1600` ; colonne gauche amputée par `#data-panel` (x 52→370) ; la phrase SSMSI se coupe sur « …contre 74 % pour les victimes de camb » au bord droit. `document.body.innerText` après le clic = 5 027 caractères sans aucune occurrence du nom du département : la fiche n'est pas dans le DOM. Captures `docs/ui-review/captures/ui-verif-e-dept.webp`, `docs/ui-review/captures/ui-regard-neuf-07-dept-click.webp`, `docs/ui-review/captures/ui-regard-neuf-08-card-no-panel.webp`.

---

### Bloc 4 — M5 : clavier et lecteur d'écran

#### 12. Le globe n'est ni atteignable au clavier ni nommé
- **Gravité :** CASSE · **Lentille :** accessibilité
- **Recoupement :** **nouveau**
- **Reproduction :** `document.activeElement.blur()` puis Tab jusqu'au retour sur `body`.
- **Preuve :** trois chemins indépendants. (1) `{role: null, label: null, tabindex: null, tabIndexProp: -1, focusableByJs: false}` — `canvas.focus()` par script ne rend pas le canvas actif. (2) 78 arrêts de tabulation, **0 sur un canvas**, 0 hors écran. (3) La sortie de secours n'existe pas : `schoolsFrance.js:813-815` réduit le `keydown` document-level à `if (event.key === 'Escape') clearSelection()`, la sélection passant exclusivement par un `ScreenSpaceEventHandler` sur `viewer.scene.canvas` (`schoolsFrance.js:824-838`). `docs/ui-review/sondes/ui-a11y-1.json`, `docs/ui-review/sondes/ui-a11y-3.json`.

#### 13. 66 arrêts de tabulation d'affilée dans `#data-panel`, sans titre et sans liste pour en sortir
- **Gravité :** FRICTION · **Lentille :** accessibilité
- **Recoupement :** **nouveau**
- **Preuve :** 78 arrêts au total, 66 dans `#data-panel`, 57 `layerId` distincts, 0 hors écran (donc aucun piège au focus). `struct.main = false`, 2 titres dans tout le document, aucun lien d'évitement, `#data-toggles` sans `role`, les 8 `.panel-collapse-btn` tous à `aria-controls: null`. `docs/ui-review/sondes/ui-a11y-3.json`, `docs/ui-review/sondes/ui-a11y-4.json`. **Correction du vérificateur :** « sans landmark » est faux — 15 éléments de repère existent dans le document. Le reste tient.

#### 14. 22 des 50 contrôles interactifs sont sous 24×24 px ; 49 sur 50 sous 44×44
- **Gravité :** FRICTION · **Lentille :** accessibilité
- **Recoupement :** **nouveau**
- **Preuve :** `docs/ui-review/sondes/ui-a11y-2.json`. Contre-mesure du vérificateur, plus sévère : 25 cibles visibles, **20 sous 24 px**, 25/25 sous 44 px. `#gev-voice-tier` 24,8×11,5 ; `.panel-collapse-btn` 19,2×22, 20×20 et 22×22 ; les `.data-toggle-btn` à 42,7×20, c'est-à-dire toute la liste des couches. *Réserve :* l'exception d'espacement de WCAG 2.5.8 n'a pas été testée — c'est pourquoi la gravité reste FRICTION.

#### 15. La ligne d'une couche fait 271×48 px, seule une pastille de 43×20 px est cliquable
- **Gravité :** FRICTION · **Lentille :** regard neuf
- **Recoupement :** **nouveau**
- **Preuve :** `cursor: auto` sur `.data-toggle-row`, `.data-toggle-left`, `.data-icon`, `.data-name` ; `cursor: pointer` uniquement sur `.data-toggle-btn`, 43×20 = 860 px² sur 13 008, soit **6,6 %**. Test fonctionnel fermé par le vérificateur, serveur vivant : clic dispatché sur `.data-name` → `getEnabledLayerIds()` ne contient toujours pas `flights` ; clic sur la pastille → `true`. Capture `docs/ui-review/captures/ui-regard-neuf-03-layers-open.webp`.

#### 16. LOCATION, la porte pour trouver une ville, n'a aucune affordance de bouton
- **Gravité :** FRICTION · **Lentille :** regard neuf
- **Recoupement :** **nouveau**
- **Preuve :** `.location-toolbar-label` (SPAN, 144×22) → `cursor: auto`, `role: null`, `tabindex: null`, `aria-label: null`, `title: null` ; idem sur `.location-toolbar`, `.location-inner`, `#location-bar`. Le clic ouvre bien le panneau (`panel-collapsible collapsed` → `panel-collapsible`) mais `document.activeElement === BODY` après ouverture, et encore après 900 ms. Capture `docs/ui-review/captures/ui-regard-neuf-04-location-clicked.webp`. *Correction :* ce n'est pas « la seule porte » — les pastilles de villes et le bouton 🔎 sont dans la même barre.

#### 17. Deux des huit villes rapides sont hors cadre, sans le moindre indice
- **Gravité :** FRICTION · **Lentille :** regard neuf
- **Recoupement :** **nouveau**
- **Preuve :** `#location-pills` `clientWidth` 346 / `scrollWidth` 514, bord droit 1061 ; « Nantes » finit exactement à 1061, donc la liste a l'air complète ; « Montpellier » x1066→1148 et « Strasbourg » x1152→1229 sont clippés, `elementFromPoint` à leur centre renvoie `CANVAS`. `maskImage: none`, `backgroundImage: none` — aucun dégradé, aucun chevron. **Pire que décrit :** le conteneur ne défile pas (`scrollLeft = 200` → relu 0 ; `scrollBy(200,0)` → 3). Capture `docs/ui-review/captures/ui-regard-neuf-05-lyon.webp`.

#### 18. Rien n'est annoncé quand une couche s'allume — 17 régions live, 0 changement
- **Gravité :** FRICTION · **Lentille :** accessibilité
- **Recoupement :** **nouveau**
- **Reproduction :** relever les 17 nœuds `[aria-live],[role=status],[role=alert]`, **cliquer** la pastille d'une couche, attendre 3,5 s, relever à nouveau. *La réserve de la lentille (déclenchement par API) a été levée par le vérificateur : le chemin clic donne le même résultat.*
- **Preuve :** les 17 textes rigoureusement identiques avant/après ; `#world-overlay-status` et `#toast` à chaîne vide alors qu'ils portent `role="status"`. Le bouton est un `<button>` sans `role`, sans `aria-pressed`, sans `aria-checked`. `docs/ui-review/sondes/ui-a11y-1.json`, `docs/ui-review/sondes/ui-a11y-4.json`. *Atténuation :* le nom accessible bascule bien (« Séismes (24 h): OFF » → « : ON »), retour dégradé et non normatif.

---

### Bloc 5 — M6 : le HUD occupe la place de l'information

#### 19. Le GSD du HUD est faux d'un facteur 3,3 au réticule et varie dans l'image
- **Gravité :** INCOHERENCE (descendue de CASSE) · **Lentille :** doctrine (test F2)
- **Recoupement :** **nouveau**
- **Reproduction :** V-PARIS, mesurer l'emprise au sol par `camera.pickEllipsoid` sur une base de 100 px à trois hauteurs d'écran.
- **Preuve :** HUD « GSD: 0.34m NIIRS: 6.5 », « ALT: 855m ». Mesuré : 0,8322 m/px à 85 % de hauteur, **1,1326 m/px au centre**, 1,7723 m/px à 15 % — rapport centre/HUD = **3,33**, amplitude dans l'image **2,13×**. Corroboré dans le code : `src/hud.js:337` → `const gsd = Math.max(0.01, altM * 0.000375);`, sans tangage, sans FOV, sans taille de viewport ; vérifié à V-FRANCE (ALT 1 599 951 m → « GSD: 600.00m » = alt/2666,7). Captures `docs/ui-review/captures/advK7-c-vparis.webp`, `docs/ui-review/captures/ui-doctrine-vparis-f1.webp`. **Ce que la réfutation retient :** valeur décorative dans une frise décorative revendiquée (`src/hud.js:1-13`, commentaire « approximate resolution … derived from camera altitude » à `hud.js:333-337`). Contredit le reste du produit sans le rendre inutilisable. **À lire avec l'angle mort correspondant :** il n'existe **aucune barre d'échelle nulle part** dans l'application (0 nœud `[class*=scale-bar]` / `[class*=scalebar]` à V-PARIS comme à V-FRANCE).

#### 20. La seule date affichée sur la carte est l'horloge du navigateur, étiquetée « COLL »
- **Gravité :** FRICTION (descendue de CASSE)
- **Lentilles :** hiérarchie **et** doctrine (test E1) — **convergence indépendante**.
- **Recoupement :** **nouveau**
- **Preuve :** `#hud-coll` passe de « COLL: 08:05:39Z » à « COLL: 08:05:44Z » en 5 s sans qu'aucune donnée ne charge ; `src/hud.js:355-362` fait `const now = new Date()`. Relevé simultané dans un seul `evaluate` : `hudTimestamp` « 2026-09-03 08:46:40Z », `hudColl` « COLL: 08:46:40Z », `clientNow` « 2026-09-03T08:46:40.460Z » — même seconde, même horloge. Balayage DOM (`MAJ|updated|sync|age|20\d\d-\d\d`) : aucun autre horodatage de donnée. Méta de couche : « Délinquance enregistrée — SSMSI · à l'instant » — un âge de fetch, pas un millésime.

#### 21. Hors cockpit, rien ne dit où est le nord ni le cap
- **Gravité :** FRICTION (descendue de CASSE)
- **Lentilles :** hiérarchie **et** doctrine (test F3) — **convergence indépendante**.
- **Recoupement :** **nouveau**
- **Preuve :** tous les nœuds de compas (`#cockpit-compass`, `#cockpit-compass-tape`, `#cockpit-heading-value`, `.cockpit-heading-caret`) sont dans `#cockpit-hud`, `visible: false`. Le seul relevé de cap du DOM est `BUTTON.cctv-cal-value` « HDG -- », invisible. Balayage de `#intel-hud` filtré sur visibilité effective, regex `/HDG|HEADING|\bCAP\b|NORTH|NORD/i` → **0 occurrence**. Aucun `resetNorth` / bouton de remise au nord dans la source. Captures `docs/ui-review/captures/adv-refute-hier-9f3-paris-on.webp`, `docs/ui-review/captures/ui-doctrine-vparis-f1.webp`. **Ce que la réfutation a retiré :** « le fond de carte ment » est une surinterprétation — les toponymes OSM pivotés de 160° sont le comportement normal d'un raster sur caméra tournée, pas un repère fabriqué à tort. Il reste un cue absent, pas un cue faux.

#### 22. `#hud-summary` est coupée à 49 %
- **Gravité :** FRICTION (descendue de CASSE)
- **Lentilles :** hiérarchie **et** regard neuf — **convergence indépendante**.
- **Recoupement :** **nouveau**
- **Preuve :** `scrollWidth` 827-842 / `clientWidth` 420 ; `white-space: nowrap`, `overflow: hidden`, **`text-overflow: ellipsis`** (les deux lentilles avaient omis l'ellipse), `title: null`, `max-width: 420px` déclaré à `style.css:4243`. Capture `docs/ui-review/captures/ui-hierarchie-hud-summary-paris.webp`. **Deux atténuations réfutées :** (a) l'ancrage métrique n'est pas perdu — « GSD: 0.34M NIIRS: 6.5 », « ALT: 855M » et « ONA: 55.0° » restent visibles dans les rails, seul « WINDOW 3x3KM » est jeté ; (b) le contenu *voulu* est une phrase de cinq mots générée par `/api/openai/hud-summary` (« Output exactly five words »), et la chaîne de 105 caractères est le repli déterministe `_composeSummary()` (`src/hud.js:574`) affiché parce que `OPENAI_API_KEY` est vide — piège connu du briefing. Le repli reste visible entre deux rafraîchissements, donc le constat ne tombe pas.

#### 23. Le grand mot cyan lu comme un niveau d'alerte est le nom du style visuel, déjà affiché ailleurs
- **Gravité :** INCOHERENCE · **Lentille :** regard neuf
- **Recoupement :** **nouveau**
- **Preuve :** `#hud-mode` = « NORMAL », x59 y218, `font-size: 16px`, sans étiquette ; `#active-style-name` = « NORMAL », x1456 y49, `font-size: 16px`, sous le libellé « ACTIVE STYLE ». Bascule simultanée après un clic sur NOIR : `{hudMode:"NORMAL", activeStyle:"NORMAL"}` → `{"NOIR","NOIR"}`. Troisième occurrence dans le code : `src/hud.js:578` réinjecte `hud-mode.textContent` en tête de la ligne SUMMARY.

#### 24. Les sigles de l'écran d'accueil, aucun expliqué ni survolable
- **Gravité :** QUESTION · **Lentille :** regard neuf
- **Recoupement :** **nouveau**
- **Preuve :** `document.querySelectorAll('#intel-hud [title]')` → **tableau vide**. `title: null` et `parentElement.title: null` sur `.hud-classification`, `.hud-system`, `.hud-orbital`, `#hud-mgrs`, `#hud-gsd`, `#hud-ona`, `.data-count`. Capture `docs/ui-review/captures/ui-regard-neuf-01-landing.webp`.

---

### Bloc 6 — M3 : le système de design non contraignant

#### 25. Les jetons existent dans `:root` et le produit ne s'en sert pas — 22 interlettrages pour un seul rôle
- **Gravité :** INCOHERENCE · **Lentille :** cohérence
- **Recoupement :** **nouveau**
- **Preuve (mesure basse du vérificateur, plus prudente que celle de la lentille) :** 164 déclarations `border-radius`, **14 via jeton**, 32 valeurs distinctes dans la feuille ; 62 `var(--transition-*)` contre `.15s` écrit 26 fois alors que `--transition-fast` vaut 150 ms ; à l'écran, 67 boutons visibles pour **17 signatures distinctes**, 9 rayons de bouton, 9 tailles de police de bouton, 19 rayons distincts, 12 `letter-spacing` distincts à `font-size: 8px` et 10 à 9 px, en trois unités (`1.35px`, `0.08em`, `0.1rem`). `:root` ne définit que 4 jetons de forme/temps. **À décharge, mesuré aussi :** 344 des 438 éléments texte visibles utilisent `--text-primary/-secondary/-dim`, et les 6 panneaux vitrés partagent `16px + rgba(12,12,20,0.72) + blur(24px) saturate(1.4)`.

#### 26. 18 tailles de police et 5 graisses à l'état vide, dont quatre paliers dans 0,64 px
- **Gravité :** INCOHERENCE · **Verdict de reproduction : INCERTAIN** · **Lentille :** hiérarchie
- **Recoupement :** **nouveau**
- **Preuve :** `docs/ui-review/sondes/ui-hierarchie-probe.json`, `docs/ui-review/sondes/adv-refute-hier-9f3-census.json`. **Aucun des trois chiffres de la lentille ne se reproduit à ±1** (17 tailles et non 18, 146 éléments visibles et non 126, 12 couleurs de texte et non 11) ; seul « 5 graisses » (300/400/500/600/700) tombe juste. Le mécanisme, lui, est reproduit : le cluster 6,24 / 6,40 / 6,72 / 6,88 px existe, soit trois paliers déclarés dans une fenêtre de **0,16 à 0,64 px**, imperceptibles. *Le relevé chiffré n'est pas fiable ; la conclusion l'est.*

#### 27. Deux familles d'icônes dans la même liste, et le même pictogramme dessiné des deux façons
- **Gravité :** INCOHERENCE · **Lentille :** cohérence
- **Recoupement :** **nouveau**
- **Preuve :** recensement DOM sur les 57 lignes de `#data-toggles`. Le partage emoji/glyphe diffère entre la lentille (23/34) et le vérificateur (32/25) selon le classement de `✈ U+2708` nu, **mais les doublons sont identiques dans les deux comptes** : `⌖`×2, `⬡`×2, `⚠`×3, `≋`×2, `◉`×2, `▤`×2, `▦`×2 — `⬡` désigne à la fois les bouées marines et le réseau gaz. HTML relevé : `<span class="data-icon">✈️</span>` (flights) contre `<span class="data-icon">⌖</span>` (military-installations), même classe, même `font-family`. Dans `#pp-toggles` : 2 Material Symbols, 4 glyphes géométriques, 2 emoji. Captures `docs/ui-review/captures/ui-coherence-data-panel.webp`, `docs/ui-review/captures/ui-coherence-topactions.webp`, `docs/ui-review/captures/ui-verif-detect-on.webp`.

#### 28. « Actif » est cyan partout et vert sur un seul bouton, dans la même colonne
- **Gravité :** INCOHERENCE · **Lentille :** cohérence
- **Recoupement :** **nouveau**
- **Reproduction :** lire `#pp-toggles` **à boot+2 s** — l'état DETECT est restauré tard au démarrage, une lecture trop précoce le trouve inactif.
- **Preuve :** `#hud-toggle`, `#models3d-toggle`, `#scope-toggle`, `#sharpen-toggle` → `rgba(0,212,255,0.15)` / `rgb(0,212,255)` ; `#detection-toggle` → `rgba(0,255,80,0.18)` / `rgba(0,255,80,0.8)`, `animationName: detection-pulse`. Le vert n'existe qu'aux lignes `style.css:1437-1462`, toutes sur `#detection-toggle` ; `:root` (26 jetons) n'a ni `--success` ni vert. `docs/ui-review/sondes/ui-coherence-states.json`, `docs/ui-review/sondes/ui-verif-probe5.mjs`. *Nuance :* DETECT est le seul contrôle multi-états de la colonne (OFF→SPARSE→BALANCED→DENSE, `ui.js:10182-10195`) et le vert vif est la classe `.panoptic` — mais l'échelon bas `.active` est vert aussi. *Piège écarté :* le vert persiste 4 s sur un bouton OFF après une bascule, c'est le gel du recalcul de style en `requestRenderMode`, pas un défaut.

#### 29. La virgule veut dire « milliers » dans une couche énergie et « décimale » dans sa voisine
- **Gravité :** INCOHERENCE (descendue de CASSE) · **Lentille :** cohérence
- **Recoupement :** **nouveau**
- **Preuve (exécution des modules livrés) :** `rteGeneration.formatGenMw(9500)` → `"9,500 MW"` ; `gasFrance.formatMw(9500)` → `"9,5 GW"` ; `powerGrid.formatGridKm(36106)` → `"36,106 km"` ; `gasFrance.formatKm(36106)` → `"36 106 km"`. Recensement `src/` : **88 `toLocaleString('fr-FR')` contre 9 `en-US`**. Le commentaire `src/data/gasFrance.js:250` décrit le défaut nommément (« a figure a French reader parses as 36.1, off by a factor of 1000 ») — et `gasFrance.js:302`, sept lignes sous son propre helper `fr()`, écrit `${site.km.toFixed(1)} km of published trace`, point décimal anglais. **Ce que la réfutation a retiré :** le défaut n'est jamais apparu à l'écran, ni pour la lentille ni pour le vérificateur (S-NAT / S-LIVE bloquants sous SwiftShader), et les cartes portant le format `en-US` sont rédigées en prose anglaise, registre où la virgule de milliers est cohérente.

#### 30. « Désactivé » : 18 règles, 7 opacités, 3 curseurs
- **Gravité :** QUESTION (descendue de INCOHERENCE) · **Lentille :** états
- **Recoupement :** **nouveau**
- **Preuve :** `#scene-stop-btn` → `opacity 0.45`, `cursor default` ; `#radio-play-btn` → `opacity 0.42`, `cursor not-allowed`. Extraction ligne à ligne des blocs `:disabled` : opacités 0,28 / 0,38 / 0,42 / 0,45 / 0,48 / 0,5 / 0,55 / 0,7 ; curseurs `wait` ×6, `not-allowed` ×7, `default` ×3. `docs/ui-review/sondes/ui-etats-cssom.json`. **Ce que la réfutation a retiré :** la thèse « un seul sens » est fausse — `cursor: wait` couvre systématiquement les contrôles désactivés **pendant** une opération asynchrone (`.context-radio-toggle:5296`, `.context-mode-button:5472`, `.panel-layer-toggle:5523`, `.data-toggle-chip:6071` avec commentaire d'intention explicite), `not-allowed` les contrôles dont la **précondition** manque. Deux sens, deux curseurs. Reste l'éparpillement des opacités, réel mais jamais côte à côte.

#### 31. Une troisième fonte d'icônes est téléchargée à chaque chargement et jamais utilisée
- **Gravité :** FRICTION · **Lentille :** cohérence
- **Recoupement :** **nouveau**
- **Preuve :** `index.html:13` → `<link href="https://fonts.googleapis.com/icon?family=Material+Icons+Round" rel="stylesheet" />`. Journal de requêtes Puppeteer : **1 requête** `/Material\+Icons\+Round/`, **0 requête** `/materialiconsround/i` — la feuille part, aucun `.woff2` ne suit puisque rien ne référence la famille. 0 élément `.material-icons` dans le DOM ; `style.css` n'utilise que Material Symbols Outlined (15 règles). Le coût réel est une feuille tierce bloquant le rendu, pas le poids d'une fonte.

#### 32. Les couches disent quand elles ont été rafraîchies, les fonds de carte ne disent rien
- **Gravité :** QUESTION (descendue de INCOHERENCE) · **Lentille :** cohérence
- **Recoupement :** **nouveau** — l'audit `REPRESENTATION.md` ne traite pas les fonds de carte.
- **Preuve :** HTML des 6 chips extrait — aucune date dans le `label`, le `title` ni l'`aria-label` ; seuls compléments `title="IGN Ortho — metropolitan France only"` (2 chips sur 6, en anglais, souris seulement). `src/mapStackChips.js:44-70` : le modèle n'a que `label`, `requirement`, `unavailableHint`, `coverageNote`. Capture `docs/ui-review/captures/ui-coherence-panels-open.webp`. **Ce que la réfutation a retiré :** la symétrie invoquée n'existe pas — le « · jamais » des 57 lignes est un horodatage de *fetch de session*, pas un millésime, et un fond tuilé est refetché en continu au panoramique. Le manque réel (le millésime de l'ortho IGN) est un ajout de contenu, pas une contradiction interne.

---

### Bloc 7 — M4 : les états non dessinés

#### 33. L'état pressé n'existe pas : 3 sélecteurs `:active` contre 69 `:hover`
- **Gravité :** FRICTION (descendue de INCOHERENCE) · **Lentille :** états
- **Recoupement :** **nouveau**
- **Reproduction :** `page.mouse.down` maintenu 250 ms sur le bouton ON/OFF d'une ligne de couche.
- **Preuve :** `.data-toggle-btn` — repos `{bg rgba(255,255,255,0.04), bc 0.08, transform none}` → survol `{bg 0.06, bc 0.15}` → **pressé : strictement identique au survol**, `transform: none`, `box-shadow: none`, alors que `matches(':active') === true`. Contrôle témoin `#share-btn` sous le même dispatch : `transform matrix(1.0098…)` → `matrix(0.95,…)`. Comptes `style.css` : 70 `:hover`, 42 `:focus-visible`, **3 `:active`** (lignes 654, 766, 1913). 39 des 42 contrôles échantillonnés n'ont aucune règle `:active`.

#### 34. Le bouton ON/OFF des 57 couches supprime son anneau de focus et ne le remplace par rien
- **Gravité :** FRICTION (descendue de CASSE) · **Lentille :** états
- **Recoupement :** **nouveau**
- **Preuve :** balayage de **toutes** les feuilles chargées (`document.styleSheets`, Cesium compris) à la recherche d'une règle `:focus` dont le sélecteur matche le bouton → **0 occurrence**. `getComputedStyle` avant et après `focus()` : strictement identiques, alors que `document.activeElement === el` et `el.matches(':focus-visible') === true`. La suppression est active : `outline: none` à `style.css:5969`. **Incohérence interne mesurée :** la puce `.data-toggle-chip` de la *même ligne* coupe aussi l'outline (`style.css:6053`) mais fournit un remplaçant (`6056-6057`), et l'en-tête de catégorie juste au-dessus en a un (`4527-4528`). `docs/ui-review/sondes/ui-etats-cssom.json`, `docs/ui-review/sondes/ui-verif-etats.mjs`.

#### 35. Cinq états de flux, quatre couleurs : LOADING porte le cyan de ON
- **Gravité :** QUESTION (descendue de INCOHERENCE) · **Lentille :** états
- **Recoupement :** **nouveau**
- **Preuve (témoins injectés dans le panneau réel, cascade réelle) :** `active feed-loading` rend **exactement** la couleur, le fond, la bordure et le halo de `active feed-nominal` (`rgb(0,212,255)` / `rgba(0,212,255,0.15)` / halo `0 0 10px`), alors que `feed-stale` = `rgb(255,210,122)`, `feed-degraded` = `rgb(255,173,114)`, `feed-unavailable` = `rgb(255,133,133)`. `grep feed-loading style.css` → une seule occurrence, `5974`, dont le corps est `{ min-width: 82px; letter-spacing: 0.8px; }`. **Ce que la réfutation a retiré :** « seul le mot change » est faux — `min-width` passe de 38 à 82 px et le `letter-spacing` de 1,5 à 0,8 px, donc le bouton **double visiblement de largeur**, animé par `transition: all`. Et la couleur sert d'échelle de faute (ambre/orange/rouge) ; loading n'est pas une faute.

---

### Bloc 8 — M7 : les deux langues

#### 36. Quatre bascules de langue dans une seule ligne du catalogue
- **Gravité :** INCOHERENCE
- **Lentilles :** cohérence (INCOHERENCE) **et** regard neuf (QUESTION) — **convergence indépendante**, avec deux lectures différentes de la gravité : défaut de système d'un côté, question produit assumée de l'autre.
- **Recoupement :** **nouveau**
- **Preuve :** lignes extraites de `#data-toggles` : `"✈️Vols en direct—OFFOpenSky Network · jamais"`, `"⌖Sites militaires—OFFOpenStreetMap + optional Google Maps Places · jamais"`. Sept en-têtes de panneaux sur sept en anglais (DATA LAYERS, SCENES, DISPLAY, CCTV, CONTEXT, RADIO, VISUAL PRESETS) ; **huit en-têtes de catégorie sur huit en français à l'intérieur de DATA LAYERS** (AIR & ESPACE, DÉFENSE, MARITIME, MOBILITÉ TERRESTRE, ÉNERGIE, RISQUES & ENVIRONNEMENT, RÉSEAUX & CAPTEURS, BÂTI & TERRITOIRE). HUD : `hud-alt = "ALT: 555m SUN: 28.5° EL"`, `hud-gsd = "GSD: 0.22m NIIRS: 7.1"` — point décimal anglais — contre « Séismes (24 h) » avec espace insécable française. Placeholder « Search any location... ». Captures `docs/ui-review/captures/ui-coherence-panels-open.webp`, `docs/ui-review/captures/ui-regard-neuf-01-landing.webp`. **Élargissement du vérificateur :** la faille traverse aussi l'intérieur des cartes d'entité FR — `buildRteSelectionLabel` écrit « of nameplate », « groups reporting » puis « ── 2 groupes ── » et « Site de production » dans la même carte.

---

### Bloc 9 — Constats de doctrine sans motif transverse

#### 37. Aucune couche mobile n'encode l'âge de la mesure dans le signe
- **Gravité :** FRICTION (descendue de CASSE) · **Lentille :** doctrine (test A2)
- **Recoupement :** **partiellement théorique.** `REPRESENTATION.md` traite A2 une seule fois, en sens inverse (Hub'Eau dépense la couleur sur la fraîcheur alors que A2 la veut en lavage). Les couches mobiles n'y sont pas examinées sous cet angle.
- **Preuve :** introspection des `BillboardCollection` à V-GLOBE. Navires (n = 12 000) : alphas distincts `[1]`, rgb distincts `["255,255,255"]`, `translucencyByDistance: "none"`, `scaleByDistance: "none"`. Vols (n = 7 598 chez le vérificateur, 933 chez la lentille — le semis change entre sessions) : alphas `[1]`, `translucencyByDistance: "none"`. L'attribut couleur est déjà dans le batch, inutilisé. Script `docs/ui-review/sondes/advK7-d.mjs`.

#### 38. Aucun contrôle de filtre n'est rattaché à une couche ; G2 en devient sans objet
- **Gravité :** FRICTION · **Lentille :** doctrine (test G1)
- **Recoupement :** **nouveau** — l'audit propose des filtres temporels (piste 3, « le curseur horaire ») sans constater l'absence du maillon.
- **Preuve :** inventaire des `input[type=range|checkbox|search|text]` et `select` du document — 15 nœuds à l'état d'accueil, 60 panneaux ouverts, **0 avec un ancêtre `[data-layer-id]`**. Tous sont des réglages d'affichage (`detection-density-slider`, `bloom-intensity-slider`, `hud-layout-select`…). *Correction :* « aucun contrôle rattaché à une couche » est littéralement faux — les 6 chips d'indicateur de `delinquance-fr` (« Escroqueries », « Dégradations », …) sont dans la ligne de couche, mais elles **changent la variable cartographiée sans réduire la population**. C'est vrai pour « filtre ».

#### 39. Aucun symbole n'est testé en profondeur, et rien ne distingue « je vois » de « je devine »
- **Gravité :** QUESTION · **Verdict de reproduction : INCERTAIN** · **Lentille :** doctrine (test F1)
- **Recoupement :** **nouveau**
- **Preuve :** `viewer.scene.globe.depthTestAgainstTerrain === false` — reproduit. En revanche `disableDepthTestDistance` **ne vaut pas `Infinity`** chez le vérificateur : `null` sur les 12 000 navires comme sur les 7 598 vols. La conclusion peut rester vraie (avec `depthTestAgainstTerrain` à `false`, rien n'occulte de toute façon) mais elle repose sur une seule des deux valeurs invoquées, et aucune capture ne montre un symbole traverser un bâtiment — `bdtopo-buildings` n'a rien rendu à V-PARIS et les tuiles Google 3D sont bloquées (piège connu). **Porté au crédit du produit, mesuré :** le test d'horizon ellipsoïdal fonctionne, 0 objet de la face opposée rendu.

#### 40. Sept silhouettes d'aéronef, aucune n'est un signe « non classé »
- **Gravité :** QUESTION · **Verdict de reproduction : INCERTAIN** · **Lentille :** doctrine (test B5)
- **Recoupement :** **partiellement confirmé.** `REPRESENTATION.md` critique le canal *taille* des satellites, dépensé sur une variable qualitative (B5), mais ne traite pas l'absence de signe « inconnu » sur les vols.
- **Preuve :** la lentille relève 7 SVG distincts (comptes 622/132/82/38/3/1/1) et aucun glyphe neutre ; le vérificateur **n'a pas pu reproduire l'inventaire** — dans sa session `billboard.image` n'est pas une chaîne data-URI mais un objet, son décompte s'effondre à « 1 image ». Ce qu'il mesure et qui va dans le sens d'un jeu de formes réel : 9 valeurs d'échelle de base distinctes.

#### 41. 57 couches dans une fenêtre de 479 px, sans aucun filtre
- **Gravité :** FRICTION · **Lentille :** regard neuf
- **Recoupement :** **nouveau**
- **Preuve :** `#data-toggles` — 57 lignes, `scrollHeight` 3 859 px, `clientHeight` 479 px (642 px chez le vérificateur : la hauteur dépend du viewport, le chiffre de la lentille n'est pas portable) ; `document.querySelectorAll('#data-panel input')` → `[]`, le seul `input` du document est `#location-search`. Capture `docs/ui-review/captures/ui-regard-neuf-03-layers-open.webp`. **Correction :** « sans index » est faux — les 57 lignes sont rangées en 8 catégories repliables avec compteur d'actives (« ▾✈️AIR & ESPACE 0/4 ON »).

---

## Ce que la réfutation a écarté

Douze constats sont tombés. Quatre motifs de réfutation reviennent, et ils valent pour calibrer la prochaine revue.

**a) Mesurer le CSS au lieu de mesurer l'écran.** Le constat « le focus clavier est le pixel exact du survol sur les trois actions globales » a été construit sur la lecture d'une déclaration (`outline: none`, même bloc pour `:hover` et `:focus-visible`) en oubliant le `transform: scale(1.1)` de la même règle. La capture A/B avec contrôle A/A que le vérificateur a produite tranche : deux captures du même état diffèrent de **0 pixel sur 3 600** (le canvas est bien figé en `requestRenderMode`), la paire non-focus/focus de **1 253 pixels sur 3 600**, delta max 456/765. WCAG 2.4.7 est satisfait.

**b) Confondre l'offset absolu et la distance depuis l'utilisateur.** « La légende est à 2 400 px de scroll » : la légende est rendue **à l'intérieur** de la ligne de sa couche (`row.contains(legend[0]) === true`). Quand on allume la couche depuis sa ligne — le seul chemin UI — la légende se déplie sous le pouce, entièrement visible.

**c) Prendre un choix produit documenté pour un défaut.** Trois constats sont tombés là-dessus. « DENSE va dans l'autre sens » : `satellites.js:2129-2141` documente le caractère additif dans son en-tête et son infobulle. « Ouvrir un panneau du rail droit efface les deux autres » : `src/rightRailPolicy.js:1-9` — « Tactical HUD gives an expanded right-rail panel the whole control lane » — et la flèche bascule ◀→▶, un clic ramène tout. « Le résumé du HUD rend la même ligne pour trois causes » : le repli n'est pas un vide mais `_composeSummary()`, une ligne de télémétrie complète, et la dégradation est argumentée en commentaire à l'endroit même du code.

**d) Échantillonner trop grossièrement, puis extrapoler.** « Une opération de 31 secondes annoncée par 0,2 point d'alpha » : rechronométré à 400 ms de pas, **117 ms** pour entrer en chargement et **1,17 s** pour arriver en `chip-active` ; le « 31,3 s » venait d'un premier échantillon à t = 5 535 ms et du rafraîchissement différé du compteur de ligne. Et l'affordance n'est pas « deux points d'alpha » : le libellé change (DENSE → « DENSE ··· »), le bouton passe `disabled` avec `aria-busy="true"`, le curseur devient `wait`, l'infobulle devient « Loading the Starlink shell… ». Même famille : « le lien de partage n'emporte pas la couche allumée » — hash lu avant réécriture ; « 16 contrôles sur 30 sans aide dans DISPLAY » — 21 contrôles dont 6 sans `title`, et ces 6 sont des options radio sous un intitulé de groupe qui leur donne leur sens.

**Deux constats sont tombés du côté doctrine avec une conséquence de fond.**

- **B1 — « `irve-fr` et `schools-fr` peignent un effectif brut sans le déclarer ».** La partie factuelle est vraie, la partie qui fait le défaut est fausse : la légende écrit l'unité comptée sur chaque palier (« bornes », « établissements »), et `src/data/irveDepartements.js` argumente le refus de la densité en toutes lettres, en précisant qu'elle **est** calculée depuis l'aire sphérique des polygones et rendue sur la fiche pour que le biais d'aire soit vérifiable. **C'est le seul point où la revue à l'écran contredit `REPRESENTATION.md`**, qui fait de B1 sa piste 2. L'audit garde raison sur la sémiologie (l'aplat d'effectif reste le mauvais canal) ; il avait tort sur « sans le dire ».
- **B3 — « la variation intra-classe absorbe le pas inter-classes ».** La prémisse du test est fausse : à la caméra du constat (lon −0,75 / lat 44,75 / 300 km), `delinquance-fr` n'est **pas** en choroplèthe départemental — la couche a quitté le régime national (`NATIONAL_EXIT_SPAN_DEG = 8°`, on est à ~2°) et affiche des points communaux à 3 entrées catégorielles. « Trois points dans le même département donc dans la même classe » ne veut rien dire à ce cadrage.

Deux PASS n'ont pas été reproduits et restent donc des PASS non signés : **B2** (0 inversion sur 19 644 paires — non recompté) et **C1**, ce dernier durci par le vérificateur qui a établi que les seuils sont calculés sur le rollup national complet, pas sur l'échantillon visible.

---

## Angles morts

### Ce que les vérificateurs disent avoir été raté par les lentilles

Neuf éléments méritent d'être repris dans une prochaine passe, tous vus à l'écran par un vérificateur, aucun rapporté par sa lentille.

**Accessibilité — trois manquements plus systémiques que ce qui a été rapporté.**
- `<html lang="en">` alors que la quasi-totalité de l'interface visible est en français, et aucun `lang="fr"` nulle part. WCAG 3.1.1 échoué à la racine du document ; un lecteur d'écran lit tout ce français avec une voix anglaise.
- Le seul `<h1>` du document a pour contenu textuel **du CSS** (« `.cls-4 { fill: #fff; … }` » — un bloc `<style>` d'un SVG inline logé dans le titre de niveau 1). La navigation par titres annonce donc une feuille de style comme titre principal, et « GOD'S EYE VIEW » n'est qu'un H2. La lentille a compté « 2 titres » sans regarder ce qu'ils disaient.
- Cinq contrôles de formulaire sans nom accessible : `#location-search`, `#scene-import-file`, `#scope-feather-slider`, `#bloom-intensity-slider`, `#sharpen-intensity-slider` — et `#location-search` est la seule porte clavier vers un lieu du globe.

**Doctrine — la faute la plus grave sur le remplissage, pas sur les étiquettes.** En S-NAT, la Gironde mesure `rgb(162,204,193)`, un vert d'eau qui ne correspond à **aucune** des 7 pastilles de `delinquance-fr` (jaune→rouge sombre) ni à aucune des 6 d'`irve-fr` (violet→rose). Les trois rampes se composent en alpha et produisent une couleur qui n'est dans aucune clé. La lentille a vu le symptôme sur les pastilles numériques (constat 5) et a raté la faute sur l'aplat lui-même. *Ce défaut recoupe directement la piste 5 de `REPRESENTATION.md` — « dix couches peignent les mêmes 96 polygones » — et en donne la conséquence chiffrée.*

**Doctrine — un changement de régime sémantique silencieux.** `delinquance-fr` est un taux départemental à 6 classes au-dessus de 8° d'empan, et des points communaux à 3 catégories en dessous ; la légende bascule d'un jeu à l'autre pendant un zoom continu. Deux cartes sous un même nom de couche. C'est ce qui a fait tomber B3, et aucune lentille ne l'a nommé comme défaut. **À noter :** `REPRESENTATION.md` classe ces « 3 régimes » comme corrects.

**Doctrine — l'indicateur actif n'est nommé nulle part.** Les 6 chips de `delinquance-fr` changent la variable cartographiée, mais ni les pastilles posées sur la carte ni le HUD ne disent laquelle : une capture de la France peinte ne permet pas de savoir quel délit est cartographié.

**Doctrine — la vignette du globe casse la constance de la variable rétinienne.** Le pourtour du cadre est assombri et désaturé (Bretagne et Sud-Est virant au gris-noir sur `docs/ui-review/captures/advK7-d-snat-france.webp` pendant que le centre reste saturé) : un même palier de classe ne rend pas la même couleur selon sa position à l'écran.

**États — les classes de cycle de vie n'ont aucune règle CSS.** `data-toggle-btn transitioning enabling` et `data-toggle-btn lifecycle-uncertain` sont rendus pixel pour pixel comme OFF, et il n'existe aucun sélecteur `.data-toggle-btn:disabled` dans `style.css`. Or `manager.js:2593` met le bouton en `disabled` pendant la transition : pendant ENABLING/DISABLING/UNCERTAIN le bouton garde `cursor: pointer`, s'éclaircit au survol, et ne répond pas au clic.

**Hiérarchie — quatre surfaces jamais nommées.** Un widget flottant non identifié (« OFF | STD | −$0.00 » avec barre de niveau) à cheval sur le dock du bas dans les trois vues canoniques, chevauchant le bouton vocal et tronqué par le bord du dock ; les rails verticaux pivotés à 90° (« COLL: … », « BAND: PAN », « LVL: 1A ») qui sont le plus petit corps de l'écran (6,24 à 6,88 px) **et** pivotés **et** à faible alpha, jamais mesurés en contraste ; le dock du bas qui occulte franchement « Pyrénées-Orientales · 8,62 » à V-FRANCE ; les trois boutons ronds du haut, sans étiquette et sans indication de l'actif.

**Cohérence — `aria-pressed` incohérent dans la même colonne.** `#scope-toggle` et `#models3d-toggle` portent `aria-pressed="true"`, `#detection-toggle` le porte, `#hud-toggle` et `#sharpen-toggle` non — alors que les cinq utilisent la même classe `.active`. Et la casse des libellés y change de registre : HUD, DETECT, 3D en capitales contre Scope, Celestial, Clean UI, Bloom, Sharpen en capitale initiale. Enfin, l'un des quatre `<select>` (`hud-layout-select`) n'est pas stylé du tout et rend avec la chrome par défaut de l'OS — fond clair, chevron système, coins carrés — au milieu des panneaux vitrés sombres (`docs/ui-review/captures/ui-verif-detect-on.webp`).

**Regard neuf — la fiche d'entité n'a aucun bouton de fermeture**, ni ×, ni ⌄, ni consigne, et elle est **semi-transparente** : les toponymes de la carte traversent le texte de la phrase SSMSI (`docs/ui-review/captures/ui-verif-e-dept.webp`). Par ailleurs le HUD affiche des instruments à valeur nulle comme s'ils étaient vivants (« NIIRS: 0.0 », « AIS: -- », « GSD: 600.00M » à 1 600 km), la ligne d'une couche active affiche un nombre brut sans unité (« 96 ») quand toutes les autres affichent « — », et l'attribution en bas à gauche annonce « CESIUM ion — Data attribution » alors que les tuiles rendues sont OSM.

### Ce qu'aucune lentille n'a pu couvrir

**Une panne d'infrastructure a amputé la revue.** Le serveur de dev du port 4290 est tombé en cours de session (~08:22 puis ~09:20-09:30 UTC selon les agents, `curl` → connexion refusée, plus aucun processus `vite` pour `manila-v1`). Aucun agent ne l'a relancé, conformément au briefing. Ont été perdus : le test F5 de la lentille accessibilité (script `docs/ui-review/sondes/ui-a11y-f5.mjs` écrit et prêt — heureusement recouvert par la lentille doctrine), la reprise de la sonde `aria-live` par le chemin clic (rattrapée par le vérificateur), trois mesures d'états, le lien de partage vu du destinataire, et la 9ᵉ sonde doctrine.

**Un obstacle de rendu a bloqué toute une lentille.** Sous SwiftShader headless, activer six couches simultanément bloque `scene.render()` au-delà du budget (sonde tuée après 6 minutes). Conséquence : **toutes les mesures de la lentille cohérence portent sur S-VIDE**, panneaux ouverts. Le constat sur les formateurs de nombres est prouvé par exécution des modules livrés mais **jamais reproduit dans une carte d'entité à l'écran**, et la règle C2 (la maille nommée) n'a pas pu être testée — la lecture du code suggère que les couches nomment leur maille avec soin (`amenitiesDepartements.js:194`, `filosofiCarreaux.js:678`), sans preuve à l'écran.

**Scénarios et surfaces non couverts.** S-LIVE (flights + ais-live-vessels + earthquakes) n'a été joué par aucune lentille de lisibilité : la lisibilité des étiquettes de contacts temps réel au-dessus du globe n'est pas mesurée. Le test B3 sur trois fonds contrastés n'a été fait que sur bâti OSM clair — ni forêt, ni eau, ni neige. Surfaces laissées de côté par toutes ou presque : `#cctv-panel` en profondeur, `#cockpit-hud`, `#param-slider-panel`, `#clean-view-toggle`, `#scene-panel`, le lien de partage, `#map-stack-chips` et ses puces `aria-disabled`.

**Règles de doctrine non traitées :** A6 (millésime du fond de plan), C3 (maille équi-aire), C4 (agrégation des taux), D2 (deux utilisateurs, même lien, même légende), E2/E3/E4 (régimes temporels, fenêtre, horloges), F4 (teinte drapée sur les façades), F6 (plages d'altitude déclarées), G3 (compteurs d'agrégat sur orbite), G4 (cluster/carroyage/heatmap), H2 (complétude OSM), H3 (volumétrie et transport). **G2** (un filtre ne fige pas le globe) est non concluante et le restera sans GPU réel : temps de frame moyen 704 ms pendant le tirage du curseur de densité contre **867 ms au repos** — la ligne de base est déjà catastrophique, donc le tirage n'est pas mesurablement pire que l'inactivité.

**Non mesuré du tout :** le rendu sous un vrai GPU (tout est en SwiftShader headless), le comportement d'un lecteur d'écran réel (VoiceOver / NVDA), et `prefers-reduced-motion`.

### Ce que l'audit annonce et qu'aucune lentille n'a rencontré

`REPRESENTATION.md` est un audit du **vocabulaire graphique couche par couche** ; cette revue a porté sur la **chrome, le HUD et la lisibilité à l'écran**. Le recouvrement est donc mince, et c'est en soi une information : les deux dispositifs regardent des choses différentes et se contredisent une seule fois (B1). Restent **théoriques** — annoncés par l'audit, jamais rencontrés à l'écran par une lentille : la hauteur d'extrusion inutilisée sur un globe 3D (piste 1), le cercle proportionnel manquant (piste 2, hors le cas B1 réfuté), les 500 136 mesures horaires de `comptages-fr` dont une seule est peinte (piste 3), les champs continus dessinés en objets discrets (piste 4), les datacenters à 10 px pour cinq ordres de grandeur d'emprise, les séismes dont la profondeur est codée en teinte, les navires dont la taille n'encode rien. Aucune lentille n'a chargé ces couches ; leur absence de la revue n'est pas un désaveu de l'audit.

### Défauts croisés signalés hors lentille, non instruits

`#world-overlay-action-list` contient 0 enfant et `#world-overlay-status` est vide alors que 13 étiquettes sont peintes sur le globe — le miroir accessible des cibles visibles ne porte rien. `dataManager.getEnabledLayerIds()` renvoie `{}` alors qu'une couche est allumée et peinte : la poignée d'introspection documentée dans le briefing ne reflète pas l'état. Le hash de partage s'écrit `l=` (liste vide) avec trois couches actives — possiblement un artefact de `origin: 'qa'`. Déplier `#scene-panel` replie automatiquement `#data-panel`, sans que rien ne l'annonce. Le globe se rend en disque blanc uni sur la capture V-FRANCE en clean view (`docs/ui-review/captures/ui-etats-cleanview-on.webp`). Un `TypeError: Cannot read properties of undefined (reading 'updaters')` est levé par `Scene.render()` appelé juste après un clic de sélection (`CesiumWidget._postRender`, `cesium.js:242919`). Le bandeau « VOICE SYSTEM ERROR — Check microphone permission and network access » est présent dans le DOM **au démarrage**, sans action utilisateur. Un clic sur un polygone de département n'ouvre aucune fiche depuis certaines vues. Enfin, deux lectures d'altitude ont divergé après un clic ayant déplacé la caméra (`ALT 700.0` dans `#hud-summary` contre `ALT: 16385m` dans `#hud-alt`).

---

## Tri des défauts « hors lentille » et des « ratés », 2026-09-03

Les deux listes de fin de document n'avaient pas été instruites : les défauts
croisés hors lentille étaient signalés sans enquête, et les « ratés par les
lentilles » venaient des vérificateurs sans avoir eux-mêmes été réfutés. Ce tri
les tranche, sonde par sonde. **Six tombent, trois sont confirmés, un est
nouveau.**

### Écartés — ce ne sont pas des défauts

| Signalement | Verdict |
|---|---|
| `dataManager.getEnabledLayerIds()` renvoie `{}` avec une couche allumée | **Artefact de mesure.** La méthode renvoie un `Set` (`src/data/manager.js:1460`), qui ne franchit pas la frontière JSON de Puppeteer. Le tort est dans la recette du briefing de revue, pas dans l'application. |
| Le lien de partage écrit `l=` vide avec des couches actives | **Faux.** Couche allumée par le chemin UI puis clic sur `#share-btn` : le hash contient `l=e`. La couche est portée. Le relevé initial lisait le hash avant sa réécriture. |
| Deux lectures d'altitude divergentes (`ALT 700.0` contre `ALT: 16385m`) | **Transitoire de vol caméra.** Caméra posée, les deux s'accordent : `ALT 555M` / `ALT: 555m` à V‑PARIS, `ALT 1600.0KM` / `ALT: 1599951m` à V‑FRANCE. Les deux afficheurs convergent à des cadences différentes, ce qui ne se voit que pendant un déplacement. |
| Bannière « VOICE SYSTEM ERROR » présente dans le DOM au démarrage | **Correctement masquée.** `visibility: hidden` (`style.css:8290`) — donc hors de l'arbre d'accessibilité, non annoncée. Révélée par `[data-status='error']:not(.error-dismissed)` (`style.css:8305`). Le balisage est statique, l'état ne l'est pas. |
| L'attribution annonce « CESIUM ion » alors que les tuiles rendues sont OSM | **Comportement amont.** `#cesium-credits` est le conteneur de crédits par défaut de Cesium (`src/main.js:175`) ; les crédits par couche sont enregistrés dans son popover (`registerDataCredits`, `src/main.js:198`). Ce n'est pas une affirmation de GEV sur la provenance de ses tuiles. |
| Cinq contrôles de formulaire sans nom accessible | **Surestimé : il y en a trois** — `#scene-import-file`, `#bloom-intensity-slider`, `#sharpen-intensity-slider`. `#location-search` et `#scope-feather-slider` en ont un. Les trois sont dans des panneaux repliés, ce qui les rend inatteignables tant que le panneau est fermé — pas une excuse, une circonstance. |

### Confirmés — reproduits indépendamment

**Le miroir accessible du globe est vide pendant que le globe est peint.**
Avec `delinquance-fr` active à V‑FRANCE, `__gevWorldOverlay.getDiagnostics()`
renvoie `paintedCount: 6` et `hitRectCount: 0`, pendant que
`#world-overlay-action-list` compte **0 enfant** et `#world-overlay-status` est
vide. Six étiquettes sont donc peintes sur le globe sans aucune représentation
DOM — ni au clavier, ni au lecteur d'écran, ni au clic. Renforce le motif M5.

**La couleur composite n'est dans aucune légende.** Trois choroplèthes actives
(`delinquance-fr`, `irve-fr`, `schools-fr`) à V‑FRANCE : le pixel de la Gironde
mesure `rgb(166, 206, 197)`. Le vérificateur avait relevé `rgb(162, 204, 193)`
sur une caméra légèrement différente — deux mesures indépendantes concordantes.
Aucune des **14 pastilles de légende visibles** n'en approche. La composition
alpha produit une couleur que la clé ne contient pas : la légende n'est pas
seulement enfermée dans un tiroir (M2), elle est **fausse** dès que deux couches
zonales se superposent. C'est la conséquence chiffrée de la piste 5 de
`REPRESENTATION.md`.

**`<html lang="en">` sur une interface majoritairement française**, sans aucun
`lang="fr"` ailleurs dans le document. WCAG 3.1.1 échoué à la racine.

### Nouveau, trouvé pendant le tri

**`#hud-summary` rend une chaîne vide à 12 000 km.** Aux deux autres vues
canoniques il rend une ligne complète (`NORMAL STREET NEAR EIFFEL TOWER…`,
`NORMAL GLOBAL SECTOR 46.60N 2.40E…`) ; à V‑GLOBE, `textContent` est vide après
huit cycles de rendu espacés. Distinct du constat de troncature à 49 % déjà
rapporté par la lentille hiérarchie.

### Corrigé — une affirmation du rapport est fausse

La section des « ratés » affirme que le seul `<h1>` du document a pour contenu
textuel une feuille de style, et qu'un lecteur d'écran annoncerait donc du CSS
comme titre principal. **La conclusion est fausse.** `src/logoGaze.js:109`
injecte bien le SVG entier — bloc `<style>` compris — dans le `<span>` du titre,
donc `h1.textContent` contient effectivement `.cls-4 { fill: #fff; }`. Mais ce
`<span>` porte `aria-hidden="true"` dans `index.html`, et `logoGaze` le repose
sur le SVG cloné : il est hors de l'arbre d'accessibilité. Le `<h1>` contient par
ailleurs bien « GOD'S EYE VIEW ». Ce qui reste vrai est étroit : toute extraction
textuelle naïve du titre ramasse du CSS.

