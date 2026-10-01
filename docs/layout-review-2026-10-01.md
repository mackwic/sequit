# Relecture coordonnée du moteur de layout (1er octobre 2026)

Relecture en lecture seule des trois cas de layout de premier niveau — racine dédiée (« simple »), lanes explicites à la racine, grille racine 2 × 2 et N × M — sur les trois préoccupations : tracé des flèches, ordonnancement, placement. Les régions imbriquées et grilles internes (formats 6-7), le repli de groupes, la collaboration et l'interface sont hors périmètre.

Ce document est un backlog de constats, pas un plan : aucune correction n'a été appliquée. Les défauts déjà inscrits dans [la passation de la phase 4](layout-engine-refactor-phase-4.md) (§5-6 : D1, B1/n° 43, B3, n° 58, n° 66) ne sont repris que lorsqu'un relecteur y apporte un élément nouveau.

## Dispositif

Cinq relecteurs indépendants (Claude Fable 5.1, Claude Opus 5.5, GPT-6-Astra, GPT-6.1-Sol, Claude Sonnet 5.5), chacun sur l'ensemble du périmètre, avec le même briefing (invariants, carte du code, harnais `tests/support/harnesses/layout.ts`, règle « constat reproductible ou ancré fichier:lignes, observé distingué d'inféré »). Tête relue : `09845689` (`aba98d83` plus un commit d'interface sans effet sur `src/lib/core/layout`).

Volume exécuté, tout par l'entrée produit (`layoutGraph` → `layoutWithRootRegion`) et dans les quatre directions : environ 15 000 layouts au total (DAG aléatoires à graine fixe de 3 à 18 nœuds, documents minimaux écrits à la main, fixtures existantes, quatre documents TOML d'exemple), avec contrôles indépendants : chevauchements, confinement lane/cellule/groupe, route à travers une boîte étrangère, orthogonalité, attaches, croisements stricts, coudes et longueurs, opacité des cellules, déterminisme (double appel), permutation des collections documentaires à `layoutOrder` constant, renommage des identifiants, oracle `validateDedicatedCandidate`. Plus 400 tests existants ciblés, tous verts.

Règle de recoupement :

- **corroboré** : constat observé indépendamment par au moins deux relecteurs, ou par un relecteur et re-vérifié par le coordinateur ;
- **isolé, ancré** : un seul relecteur, mais document minimal reproductible et cause localisée dans le code ;
- **à arbitrer** : constats qui se contredisent ou qui dépendent d'une décision produit non prise.

Le coordinateur a re-exécuté trois constats (L-01, L-02, G-01) sur un script jetable ; les sorties citées pour ces trois-là sont les siennes. Les autres coordonnées proviennent des rapports des relecteurs (convention : nœuds 220 × 116, jonctions 28 × 20, groupes padding 24 / en-tête 36, `layoutOrder` dans l'ordre de la liste, relation `x→y` = `from` x vers `to` y).

## Synthèse priorisée

| ID   | Cas            | Préoccupation  | Constat                                                                                                         | Gravité | Recoupement           |
| ---- | -------------- | -------------- | --------------------------------------------------------------------------------------------------------------- | ------- | --------------------- |
| G-01 | grille         | tracé          | `unknown` « enters element » selon la direction et la position du nœud dans sa cellule                          | haute   | 4 relecteurs + coord. |
| L-01 | lanes          | placement      | une boîte par rangée et par lane : un parent peut être placé **après** son enfant (flèche à contre-sens)        | haute   | 5 relecteurs + coord. |
| L-02 | lanes          | ordonnancement | l'ordre des ports d'une face est départagé par l'identifiant de l'extrémité opposée (renommer change le layout) | haute   | 4 relecteurs + coord. |
| D-01 | simple         | tracé          | layout publié invalide par interférence entre composantes, sans validation globale du documentaire              | haute   | 1 observé + 1 inféré  |
| D-02 | simple         | ordonnancement | renommer une jonction change l'ordre de rang retenu (0 → 2 croisements)                                         | haute   | isolé, ancré          |
| D-03 | simple         | tracé          | `GroupRouteFailure` sur des documents valides, selon la direction                                               | haute   | isolé, ancré          |
| G-02 | grille         | tracé          | deux cellules voisines sont reliées en faisant le tour de la grille (1 564 px pour 240 px)                      | haute   | 4 relecteurs          |
| T-01 | grille, simple | tracé          | plusieurs secondes de layout synchrone pour 4 à 11 nœuds                                                        | haute   | 3 relecteurs          |
| L-03 | lanes          | tracé          | lanes transverses : toute relation inter-lanes passe par le corridor extérieur (4 coudes, × 2,7)                | moyenne | 3 relecteurs          |
| L-04 | lanes          | tracé          | lanes parallèles : les relations intra-lane partent et arrivent par les faces latérales (C de 332 px pour 72)   | moyenne | 2 relecteurs          |
| L-05 | lanes          | ordonnancement | ports non emboîtés et aucune recherche d'ordre dans une lane : croisements évitables dans 30-40 % des cas       | moyenne | 2 relecteurs          |
| L-06 | lanes          | placement      | les relations locales d'une lane élargissent toutes les gouttières, même sans trafic                            | moyenne | 2 relecteurs          |
| D-04 | simple         | ordonnancement | la recherche d'ordre élague sur le proxy topologique et déclare `exhaustive: true` après 2 évaluations sur 8-12 | moyenne | 3 relecteurs          |
| D-05 | simple         | tracé          | rails inversés pour deux flèches de même source : croisements doubles entre elles                               | moyenne | 2 relecteurs          |
| D-06 | simple         | tracé          | un rail ou un jog posé exactement sur le trait du cadre d'un groupe (TB/BT seulement)                           | moyenne | 2 relecteurs          |
| D-07 | simple         | ordonnancement | nombre de croisements différent entre axes, ou entre TB et BT avec groupes                                      | moyenne | à arbitrer            |
| D-08 | simple         | ordonnancement | l'ordre des composantes déconnectées suit l'identifiant du groupe racine, pas l'ordre documentaire              | moyenne | isolé, ancré          |
| G-03 | grille         | tracé          | ordinaux de bus et de rails incohérents : 3 croisements pour 2 relations, TTB ≠ BTT                             | moyenne | isolé, ancré          |
| G-04 | grille         | placement      | budget de traversées épuisé en RTL seulement, classé `unsupported`                                              | moyenne | isolé, ancré          |
| G-05 | grille         | placement      | une cellule vide est `unsupported`, alors qu'une lane vide est admise                                           | moyenne | à arbitrer            |
| G-06 | grille         | placement      | une cellule agrandie par un minimum laisse son contenu calé dans le coin                                        | basse   | 2 relecteurs          |
| L-07 | lanes          | tracé          | `inspectRouting: true` rend tout document à lanes ou grille `unsupported`                                       | basse   | 3 relecteurs          |
| L-08 | lanes          | tracé          | le dispatch racine jette le code et les témoins de l'issue `unknown` des lanes                                  | basse   | 2 relecteurs          |
| D-09 | simple         | tracé          | coordonnées de routes en tiers de pixel (3-5 % des layouts dédiés)                                              | basse   | 2 relecteurs          |
| D-10 | simple         | tracé          | deux relations parallèles reçoivent la même route, superposée                                                   | basse   | isolé, ancré          |
| D-11 | simple         | placement      | routes de contournement à 0-6 px du bord du canevas avec groupes                                                | basse   | isolé, ancré          |
| T-02 | transversal    | tracé          | faces d'attache et pas de ports différents selon la politique ; `design.md:423` trop générale                   | basse   | 2 relecteurs          |
| T-03 | transversal    | —              | documentation en retard : D1, `layout-routing.md:16,80`, résumé de la règle de sélection                        | basse   | 3 relecteurs          |
| T-04 | transversal    | —              | tests verts aveugles sur les cas fautifs (générateurs tronqués, `unknown` épinglés comme nominaux)              | basse   | 3 relecteurs          |

## Lanes

### L-01 — Une boîte par rangée et par lane ; un parent peut être placé après son enfant

- **Nature** : anomalie, haute. Sources : M5-01 (contre-sens), M1-06, M2-07, M3-05, M4-04 (rang visuel ≠ rang logique) ; vérifié par le coordinateur.
- **Preuve (coordinateur)** : lanes parallèles `L1 | L2`, nœuds `a, b, c ∈ L2`, `d ∈ L1` dans cet ordre, seule relation `d→c` (`c` racine, rang 1 ; `d` rang 2). `top-to-bottom` : `a=(536,100) b=(536,288) c=(536,476) d=(124,288)` ; route `d→c = (344,346) (404,346) (404,534) (476,534) (536,534)` : l'arrivée sur le parent est 188 px **plus bas** que le départ de l'enfant. Avec `c` documenté en premier, le sens est correct ; M5 mesure un contre-sens sur au moins une relation dans 13 à 55 % des layouts aléatoires selon la taille. Même mécanisme pour les frères de même rang : `a ∈ A`, `b1, b2, b3 ∈ B`, `b1,b2,b3 → a` : `b1` y=364, `b2` y=552, `b3` y=740 (M1-06), alors que les trois ont le rang 1.
- **Code** : `lanes/shared-lane-model.ts:126-144`, `row = max(rank, previousRow + 1)` ; les lanes transverses emploient le même ordre sur l'axe transversal (`shared-transverse-frame.ts:41-47,117-132`).
- **Explication** : la rangée d'une lane est un empilement par ordre documentaire, pas une projection des rangs du graphe entier. `docs/design.md:96` promet que les rangs progressent depuis l'origine de direction et que les flèches remontent vers les parents ; `docs/layout-engine-refactor.md:38,150` annonce des rangs calculés ensemble pour le layout partagé. Aucun test de lanes n'asserte `progressesFromTo` (les propriétés existantes ne couvrent que le moteur dédié et les groupes).
- **Piste** : rangée ≥ max(rangée des parents) + 1 sur le graphe entier, avec rangées vides ; puis autoriser plusieurs boîtes par rangée dans une lane (bande transverse partagée, comme les rangées du moteur dédié). Ajouter une propriété de progression pour les lanes. Effort M (progression seule), L (bande multi-boîtes).

### L-02 — L'ordre des ports d'une face dépend de l'identifiant de l'extrémité opposée

- **Nature** : anomalie, haute (invariance au renommage, `docs/design.md` principe 6, `docs/layout-routing.md:16-20`). Sources : M1-01, M2-08, M3-01, M4-01 ; vérifié par le coordinateur.
- **Preuve (coordinateur)** : lanes `L1 | L2 | L3`, `a, b ∈ L1`, `c ∈ L2`, `d ∈ L3`, relations `r0: a→c`, `r1: b→c`, `r2: a→d`, `top-to-bottom` parallèle. Renommer seulement `c` en `z` (références réécrites, `layoutOrder`, mesures et contenu inchangés) échange les ports de `a` : `r0` part de `(392,370)` puis de `(392,418)`, `r2` de `(392,418)` puis de `(392,370)` ; les boîtes ne bougent pas. M4 compte 1 croisement + 1 pont avant, 0 + 0 après, dans les huit couples direction × orientation. M3 : 94/240 documents aléatoires à trois lanes changent de nombre de croisements au renommage ; M1 : sur `A|B|C`, la route `c1→a1` passe du rail extérieur bas (1 706 px, 2 croisements) au rail haut (0 croisement) par le seul renommage.
- **Code** : `lanes/shared-lane-ports.ts:120-130` (`compareIncidences` : `oppositeRow`, puis `compareCanonicalStrings(oppositeId)`, puis ordre documentaire de la relation) ; réservation `:227-249`. `tests/lib/core/layout/shared-transverse-layout.test.ts:185-216` et `relation-rename-invariance.property.test.ts` ne renomment que les **relations**.
- **Explication** : l'identifiant est une donnée d'identité, pas de layout ; ici il décide d'un pont. L'ordre des ports d'une face n'est pas non plus une dimension de la recherche (`shared-lane-allocation-search.ts`), donc le candidat sans croisement n'est atteint que par hasard de nommage.
- **Piste** : départager par index de lane, puis rangée, puis `layoutOrder` de l'extrémité opposée ; ne garder l'identifiant qu'en dernier. Étendre la propriété de renommage aux extrémités. Effort S (départage), M (énumérer les deux ordres par face).

### L-03 — Lanes transverses : toute relation inter-lanes passe par le corridor extérieur

- **Nature** : anomalie de lisibilité, moyenne (M1 la classe haute). Sources : M1-04, M3-02, M5-12.
- **Preuve** : deux lanes transverses, `n0` dans la première, `n1` dans la seconde, seule relation `n1→n0`, `top-to-bottom` : `n0=(124,124)`, `n1=(124,432)`, route `(234,432) (234,372) (64,372) (64,300) (234,300) (234,240)` : 532 px et quatre coudes. M3 a substitué `(234,432) (234,240)` (192 px, zéro coude) dans la géométrie sélectionnée : `validateSharedLaneGeometry` l'accepte dans les quatre directions. Fourche `b1, b2, b3 → a1` (B sous A) : `b1→a1` et `b2→a1` se croisent deux fois alors que `b2` est exactement sous `a1` ; `b2→a1` mesure 1 212 px (M1). Chaîne intra-lane transverse `a2→a1`, `a3→a2` : arches de 108 px qui sortent et rentrent par la même face haute (M5-12).
- **Code** : `lanes/shared-transverse-routing.ts:154-181` (`crossLanePoints`, unique forme à six points : source → rail extérieur → gouttière latérale → rail extérieur cible → cible) et `:195-219` ; `shared-lane-model.ts:187-189` (même lane ⇒ deux ports du même côté).
- **Piste** : ajouter une forme « directe » (un segment, ou deux coudes dans l'intervalle entre lanes adjacentes) comme première stratégie, validée par le validateur existant ; relier les faces en regard pour les relations intra-lane. Effort M.

### L-04 — Lanes parallèles : les relations intra-lane partent et arrivent par les faces latérales

- **Nature** : anomalie de lisibilité, moyenne. Sources : M1-05, M2-07.
- **Preuve** : `a1, a2 ∈ A`, `b1, b2 ∈ B`, `a2→a1`, `b1→a1`, `b2→b1`, `top-to-bottom` : `a2→a1 = (392,394) (452,394) (452,182) (392,182)` alors que `a1` est exactement au-dessus de `a2` (droite de 72 px dans le même document sans lanes) ; `b2→b1` idem. Une fourche de trois enfants étire `a1` à 144 px de haut pour trois ports latéraux.
- **Code** : `lanes/shared-lane-routing.ts:187-190` (`face(box, side)` latérales ; `plan.sameLane` → `[start, gouttière, gouttière, end]`) ; `shared-lane-model.ts:176-190`.
- **Explication** : contredit `docs/design.md:423` (faces perpendiculaires à l'axe principal) ; une lane en colonne devient une chaîne de C, incohérente avec le rendu du même graphe sans lanes.
- **Piste** : route droite sur les faces principales pour `sameLane` à rangées consécutives et ports alignés ; gouttière seulement pour les sauts de rangée. Effort S/M. Dépend de L-01 pour les rangées.

### L-05 — Ports non emboîtés et aucune recherche d'ordre dans une lane

- **Nature** : anomalie (ports) et amélioration (recherche), moyenne. Sources : M2-06, M5-07 ; M1-01 note l'absence de dimension de recherche.
- **Preuve** : `S1, S2 → P` tous dans la même lane : 1 croisement dans les huit configurations ; trois frères : 3 croisements. Ports sur `P` à y = 196/244/292 dans l'ordre `S1/S2/S3` et rails à x = 476/500/524 dans le même ordre : les arcs en U s'entrecroisent au lieu de s'emboîter (M2-06). Ordre documentaire : `a ∈ L1`, `b, c, d ∈ L2`, `c→a`, `d→b` : 1 croisement avec l'ordre `a,b,c,d`, 0 avec `a,b,d,c`, mêmes longueur et coudes ; sur 80 documents aléatoires par configuration, une permutation de l'ordre documentaire réduit les croisements dans 30 à 41 % des cas, écart moyen 12 à 14 croisements en parallèle (M5-07).
- **Code** : `lanes/shared-lane-ports.ts:120-130` (tri par `oppositeRow` croissant quel que soit le côté) et `:242-249` ; `shared-lane-model.ts:126-144` (tri par rang puis `layoutOrder`, aucune énumération).
- **Explication** : `docs/layout-engine-refactor.md:241` et la phase 3 (« oui au réordonnancement dans le rang en production ») engagent aussi les lanes, à ordre de lanes fixe ; le registre n° 8 ne clôt que l'inclusion des rails.
- **Piste** : ordonner les ports d'une face par emboîtement (extrémité la plus éloignée sur le port le plus extérieur), effort S ; réutiliser `enumerateRankOrders` sur les bandes `(lane, rang)` avec `validateSharedLaneGeometry`, effort L, lié à L-01.

### L-06 — Les relations locales d'une lane élargissent toutes les gouttières

- **Nature** : amélioration, moyenne. Sources : M3-04, M4-03.
- **Preuve** : six nœuds dans la lane gauche, seconde lane vide, `top-to-bottom` : 0, 1, 3 puis 9 relations locales donnent des largeurs de canvas 660, 756, 948, 1 524 ; la lane vide commence à x = 440 puis 1 088 (M3). `A = {a,b,c}`, `B = {}`, `C = {d}` : ajouter `b→a`, `c→b` dans A fait passer l'intervalle libre B–C de 96 à 192 px, qu'aucune relation n'emprunte (M4).
- **Code** : `lanes/shared-lane-frame.ts:147-163,230-235` (une seule capacité de gouttière égale au nombre total de plans, appliquée à tous les intervalles et aux marges) ; `shared-lane-routing.ts:91-100` (chaque plan réserve toute l'étendue longitudinale).
- **Piste** : dimensionner chaque bande par ses relations réellement incidentes et réutiliser les pistes d'intervalles disjoints. Effort M-L.

### L-07 — `inspectRouting: true` rend le document `unsupported`

- **Nature** : anomalie, basse. Sources : M1-12 (observé), M2-14, M5-17.
- **Preuve** : `layoutWithRootRegion(graph, ranks, measurements, { inspectRouting: true })` sur `A|B`, `b1→a1` : `UnsupportedLayoutPresentationError … Routing inspection is not available for shared lanes yet.` Même chose pour les grilles (`regions/recursive/nested-region-layout.ts:40-44`). `shared-lane-layout.test.ts:1583-1586` épingle ce choix.
- **Code** : `lanes/shared-lane-model.ts:201-202`.
- **Piste** : ignorer l'option (`routingInspection` absent) plutôt que changer l'issue. Effort S.

### L-08 — Le dispatch racine jette le diagnostic structuré des lanes

- **Nature** : amélioration, basse ; inféré par lecture. Sources : M3-07, M4-06.
- **Code** : `SharedLaneLayoutOutcome` porte `code`, `witness`, `allocationWitness` (`lanes/shared-lane-layout.ts:71-77,232-240`) ; `root-region.ts:310-314` ne transmet que `reason` à `UnknownLayoutPresentationError` (`:60-67`), alors que `UnknownGridCellLayoutError` (`:103-127`) conserve code, région et relation.
- **Piste** : conserver le diagnostic typé dans l'erreur racine. Effort S.

## Grille

### G-01 — `unknown` « enters element » selon la direction et la position du nœud dans sa cellule

- **Nature** : anomalie, haute (document valide sans rendu ; bascule par simple changement de direction). Sources : M1-09, M2-02, M4-02, M5-02 ; vérifié par le coordinateur.
- **Preuve (coordinateur)** : la fixture existante `persistedGridDocument()` (cellule `a` à deux nœuds `a-top`, `a-bottom`) est rendue en `top-to-bottom` (1 400 × 1 036) et `right-to-left` (1 400 × 932), et échoue en `left-to-right` : `UnknownGridCellLayoutError … Cross-cell relation across-grid enters element a-top`. Minimal (M2) : deux cellules côte à côte, `c00 = {a0, a1}` sans relation entre eux, `c01 = {b}`, seule relation `b→a1` : échec en TB/BT, succès en LR/RL ; symétrique pour une colonne de deux cellules. Fréquence : 30/40 grilles aléatoires échouent dans au moins une direction (M2) ; 47 à 50 % des documents 2 × 2 et 3 × 2 (M5) ; aucune n'échoue dans les quatre.
- **Code** : `grids/grid-cell-crossing-routing.ts:43-78,88` (port sur la face latérale de l'élément, relié au portail par **un segment horizontal droit** à la même ordonnée, sans tenir compte des autres éléments de la cellule) ; `grids/grid-cell-crossing.ts:84-94` (face gauche pour toute colonne sauf la dernière, quelle que soit la direction) ; rejet dans `grids/grid-cell-validation.ts:185-190`, aucun détour intra-cellule.
- **Explication** : un nœud n'est joignable que s'il est le plus extérieur de sa cellule du côté du portail. Le diagnostic est honnête mais la règle d'opacité ne vise que les routes **étrangères** : une cellule n'a pas à rendre ses propres nœuds inatteignables. `grid-cell.property.test.ts:71-116` ne génère qu'un nœud par cellule, en `top-to-bottom` seulement ; `grid-cell-layout.test.ts:512-548` utilise la direction bloquée comme fixture négative de diagnostic.
- **Piste** : router le dernier tronçon du portail au nœud avec le routeur de feuille (`regions/leaf/region-leaf-incident-geometry.ts` sait contourner à `CORRIDOR_CLEARANCE`), ou sortir par la face principale puis courir dans un couloir de la feuille ; à défaut réordonner la rangée locale. Étendre la propriété à plusieurs nœuds par cellule et aux quatre directions. Effort M-L.

### G-02 — Deux cellules voisines sont reliées en faisant le tour de la grille

- **Nature** : anomalie de lisibilité, haute (toutes les relations intercellulaires sont concernées). Sources : M1-07, M2-12, M3-03, M5-06.
- **Preuve** : 2 × 2, un nœud par cellule, seule relation `n0→n1` entre les deux cellules du haut, quatre directions identiques : route `(168,226) (96,226) (48,226) (48,24) (968,24) (968,226) (920,226) (848,226)`, 1 564 px, quatre coudes, pour 240 px entre les faces en regard. Même colonne (`c→a`) : rail gauche hors grille au lieu d'un segment vertical dans la gouttière de rangée (M1). Avec quatre traversées : 22 coudes, 7 croisements dont 3 entre routes de même source (M5).
- **Code** : `grids/grid-cell-crossing.ts:84-94` (face de sortie fixée par la colonne), `grid-cell-types.ts:41-45` (`GridCellPortal` limité à `Left | Right`), `grid-cell-crossing-routing.ts:88-115`.
- **Explication** : l'architecture « une gouttière par colonne + bus supérieur » est documentée (`grid-cell-layout-proof.md:5,33`) mais pas sa conséquence : l'espace libre **entre** colonnes ou rangées adjacentes n'est jamais traversé directement, bien que les gouttières de rangées existent depuis la phase 3 étape 3. En TB, la flèche sort par la gauche d'un nœud et entre par la gauche de l'autre. Distinct du n° 58 : une seule relation suffit et aucun ordre de bus ne corrige la face imposée.
- **Piste** : admettre `Top/Bottom` comme portails (prévus par `RegionPortalSide` et `grid-cell-inherited-incident.ts:48-51`), choisir la face selon la colonne de l'autre extrémité, et une forme « gouttière inter-colonnes directe » pour les cellules adjacentes, priorisée par longueur. Effort L.

### G-03 — Ordinaux de bus et de rails incohérents

- **Nature** : anomalie, moyenne. Source : M1-08 ; M5-06 observe les mêmes croisements de même source.
- **Preuve** : 2 × 3, `f→a`, `d→c` : `d→c` prend le rail droit intérieur (x = 992), le bus extérieur (y = 24), le rail gauche intérieur (x = 72) ; `f→a` l'inverse → 3 croisements, alors que la topologie en impose au plus 1. 2 × 2 avec `a1, a2 ∈ r00`, `a2→a1`, `d→a2`, `b→a1` : 0 croisement en TTB, **3** en BTT.
- **Explication** : bus (`grid-cell-crossing-allocation`) et rails sont alloués par ordinal déclaré ou inclusion d'intervalles indépendamment ; le registre n° 39 a corrigé l'inversion équivalente dans les lanes, pas dans la grille. Le n° 58 ne couvre pas ce cas sans gouttière de rangée.
- **Piste** : dériver l'ordinal du bus de celui des rails par inclusion des intervalles ; propriété « deux traversées disjointes ⇒ ≤ 1 croisement ». Effort M.

### G-04 — Budget de traversées épuisé en RTL seulement, classé `unsupported`

- **Nature** : anomalie, moyenne. Source : M5-03 (observé ; cause inférée).
- **Preuve** : 2 × 3, six cellules, 11 nœuds, cinq relations dont une seule intercellulaire (`j→f`) : `UnsupportedGridCellLayoutError: Region traversals work exhausted at 4096 operations (owner c)` en `right-to-left` après 22 ms ; rendu dans les trois autres directions, et dans les quatre sans `j→f`. ≈ 0,6 % des grilles aléatoires.
- **Code** : `regions/model/region-composition-limits.ts:28-50` (budget `max(4096, 24 × (régions + relations))`, compteur unique par appel, `root-region.ts:246-248`).
- **Explication** : la phase 3 étape 5 prévoit `ResourceLimit` en `unknown`, pas `unsupported` (réservé aux formes hors politique) ; le même document consomme plus de 4 096 traversées dans une direction et pas dans les autres, probablement par re-tentatives liées à G-01.
- **Piste** : profiler le compteur en RTL ; émettre `unknown` + `ResourceLimit`. Effort M.

### G-05 — Une cellule vide est `unsupported`

- **Nature** : à arbitrer, moyenne. Source : M5-05 ; M1 a rencontré le même refus et l'a jugé honnête.
- **Preuve** : 2 × 2 avec trois cellules peuplées : `UnsupportedGridCellLayoutError … Each leaf region must own an endpoint` dans les quatre directions ; deux lanes vides sont acceptées (`shared-lane-layout.test.ts:1650-1658`).
- **Code** : `regions/composition/nested-region-recursive-model-adapter.ts:70-75` ; épinglé par `nested-region-recursive-model-adapter.test.ts:504`.
- **Décision à prendre** : la quatrième cellule d'une grille en cours d'édition est un cas courant ; soit une feuille sans extrémité occupe un cadre de la taille de ses minima sans portail (effort S-M), soit la contrainte est documentée et portée par la validation de présentation.

### G-06 — Le contenu d'une cellule agrandie reste calé dans le coin

- **Nature** : amélioration, basse. Sources : M3-06, M4-05.
- **Preuve** : `persistedGridDocument()` : cellule `a = (96,96,700,448)`, nœuds à x = 168 : marge gauche 72 px, droite 408 px. Minima 1 000 × 800 : décentrage (−318, −270) du nœud par rapport au centre de la cellule.
- **Code** : `grids/grid-cell-disposition.ts:25-40` (pistes agrandies) et `:77-94` (translation fixe de `CELL_PADDING`).
- **Piste** : rendre l'alignement de cellule explicite (coin ou centre) et appliquer la même translation aux routes et portails. Effort S-M.

## Racine dédiée (« simple »)

### D-01 — Layout publié invalide par interférence entre composantes

- **Nature** : anomalie, haute. Sources : M2-01 (observé), M4-07 (inféré, mêmes lignes). Prolonge le n° 66.
- **Preuve** : A = jonction `j0`, nœuds `n3 n4 n7`, relations `j0→n3`, `j0→n4`, `j0→n7`, `n3→n7` ; B = `n6→n5`, `n6→x`. A seul et B seul : valides dans les quatre directions. A + B (ordre documentaire `n3 n4 n5 n6 n7 x j0`) : **invalide dans les quatre directions** selon `validateDedicatedCandidate` (`route-contact` entre `n6→n5` et `j0→n7` en (722,192) en TB/BT) : la passe de `j0→n7` part de x = 540 à x = 1 112, au-delà de B, puis longe le rail du tronc `n6→{n5,x}` (recouvrement colinéaire) ; longueur 528 → 1 672 px. Témoin : `valid: 2`, `exhaustive: true`, `globalValidations: 0`. Fuzz : 4/522 layouts publiés invalides.
- **Code** : `rank/rank-order-selection.ts:125-141` (sans modification d'ordre, la ligne de base assemblée est publiée **sans validation**) et `:209-216` (repli final, idem) ; chaque composante est validée isolément (`rank-order-local.ts:139-162`), jamais leur assemblage, alors que rails et gaps sont partagés (`rank-order-selection.ts:290`) ; `layout-engine.ts:86-103` choisit le routage mixte global dès qu'une jonction coexiste avec une composante ordinaire reliée.
- **Explication** : `published-layout-validation.test.ts:17` promet « only independently valid layouts » ; la phase 3 interdit toute géométrie invalide en sortie ; le témoin est trompeur (famille 4). Élément nouveau par rapport au n° 66 : c'est la composante **à jonction** qui est perturbée par une composante sans jonction, et le résultat est publié invalide, pas seulement différent. `layout-noninterference.test.ts:96-195` fixe A à une fourche simple et ne permute pas les rôles.
- **Piste** : valider l'assemblage global même sans modification d'ordre et ne jamais publier une ligne de base rejetée (diagnostic typé, ou réservation par composante) ; distinguer baseline prouvée globalement / localement / non vérifiée ; permuter les rôles A/B dans le témoin. Effort M.

### D-02 — Renommer une jonction change l'ordre de rang retenu

- **Nature** : anomalie, haute. Source : M2-04, isolé mais minimal et ancré ; même famille que L-02. M1, M4 et M5 n'ont trouvé aucune différence au renommage sur des DAG **sans** jonction ni groupe, ce qui est cohérent.
- **Preuve** : TB, ordre `n0 n1 n2 n3 J`, relations `J→n3`, `n3→n2`, `J→n0`, `n1→n2`. `J = "a0"` : rangées `[n0,n2],[n3,n1]`, 2 croisements pontés, `J→n0` de 1 192 px pour un canvas de 708 px. `J = "p0"` (seul l'identifiant change) : rangées `[n2,n0],[n1,n3]`, **0 croisement**, 656 px. Les géométries des quatre ordres sont identiques pour `a0` et `p0` ; seul le comptage topologique change. Fuzz : 22/150 documents changent de layout au renommage, tous avec une jonction ou au moins deux groupes.
- **Code** : `rank/transverse-positions.ts:53-59` (la jonction reçoit la position moyenne de ses ancres, donc celle de son parent unique) puis `rank/rank-order-topology.ts:84-87` départage par `compareCanonicalStrings(id)` ; le commentaire de `rank/rank-order-search.ts:197` affirme pourtant que renommer une extrémité ne change pas le choix. `relation-rename-invariance.property.test.ts:219-223` ne renomme que les relations.
- **Piste** : départager l'égalité jonction/ancre structurellement (jonction après son ancre, ou ordre documentaire) ; étendre la propriété de renommage aux extrémités. Effort S.

### D-03 — `GroupRouteFailure` sur des documents valides, selon la direction

- **Nature** : anomalie, haute. Source : M2-03, isolé, ancré.
- **Preuve** : nœuds `n0 n1 n2`, groupe `g0 = {n0}`, jonction `j0`, relations `n1→j0`, `n0→n1`, `n0→n2`, `j0→n2`, `g0→n2` : `No valid passage for relation r0-n1-j0` dans les quatre directions ; retirer `n0→n2` ou `g0→n2` suffit. Sans jonction : `g0 = {n1}`, `n0→g0`, `n2→n1`, `n0→n1`, `n3→g0`, `n0→n2`, `n3→n1` : échec en TB/BT, valide en LR/RL. Fuzz : 7/150 documents (≈ 5 %), dont 3 seulement dans certaines directions.
- **Code** : `group-endpoint-routing.ts:296` (`throw new GroupRouteFailure`), converti en diagnostic par `src/app/web/projection/layout-diagnostic.ts:54-57`.
- **Explication** : ce n'est pas D1 (aucune relation groupe→groupe entre rangs adjacents) ; la relation qui échoue est ordinaire. Le motif est « groupe et membre visant la même cible ».
- **Piste** : passe de réservation de passage (rail ou gap) quand la réparation a posteriori échoue, au lieu de lever ; ajouter ces deux documents au corpus. Effort M.

### D-04 — La recherche d'ordre élague sur le proxy topologique

- **Nature** : anomalie (témoin trompeur) et amélioration (croisements évitables), moyenne. Sources : M1-03, M2-10, M5-08.
- **Preuve** : `k0→r1`, `k0→r2`, `k1→r0`, `k1→r1`, `k1→r2`, TB : ordre retenu `[r0,r1,r2],[k1,k0]`, 3 croisements réels ; l'ordre `r1,r0,r2 / k0,k1` est valide avec 1 croisement, même score topologique et même Kendall ; témoin `proposed: 12, evaluated: 2, exhaustive: true` (M1). Sept nœuds, neuf relations : production 4 croisements stricts, permutation documentaire 0 ; témoin `proposed: 8, evaluated: 2, exhaustive: true` (M5). Sur le document de D-02, l'ordre à 0 croisement réel a 1 croisement topologique et n'est jamais évalué (M2). Statistique : sur 150 DAG, 17 % ont une permutation parmi 24 aléatoires strictement meilleure en croisements réels (M5) ; 4/60 (M1).
- **Code** : `rank/rank-order-search.ts:184-206` (`cannotBeatSelected` : topologie, Kendall, positions documentaires) et `:241-242` (élimination avant évaluation) ; `:252-253` (l'arrêt `crossing-free` ne peut viser qu'un candidat évalué).
- **Explication** : la règle de la phase 3 est respectée, mais le proxy topologique ignore les croisements créés par les rails (D-05) et s'inverse sur les jonctions (D-02). `exhaustive: true` laisse croire que toutes les permutations ont été jugées sur routes réelles, ce que la leçon n° 4 proscrit.
- **Piste** : à égalité topologique + Kendall, ou quand le retenu a des croisements réels, évaluer les candidats non dominés jusqu'au budget (12 pipelines) et départager sur `compareDedicatedRouteScores` ; sinon témoigner `pruned` séparément et ne pas poser `exhaustive`. Effort S-M. Dépend de D-05 et D-02.

### D-05 — Rails inversés pour deux flèches de même source

- **Nature** : anomalie de lisibilité, moyenne. Sources : M1-02, M5-13.
- **Preuve** : K3,3 (`x,y,z → a,b,c`, TB) : 13 croisements stricts dont `x→b × x→c : 2` et `z→a × z→b : 2` ; avec ces ports fixés, l'énumération des affectations de rails donne un minimum de 8 (M1). `c→a`, `d→a`, `d→b`, `e→a`, `e→b` : `e→a` et `e→b` se croisent deux fois ; 87/400 layouts aléatoires ont un croisement entre routes de même source ou cible (M5).
- **Code** : `routing/channel-routing.ts:238-267` (`assignRails`, coloration d'intervalles qui optimise le nombre de rails, pas les croisements, `layout-routing.md:80`), `routing/channel-crossings.ts` (`untangleChannelRails`).
- **Explication** : VL-413/416 : les flèches d'un même port forment une famille ; un croisement entre elles est un pont sans information. L'inversion est systématique dès qu'une source a deux cibles du même côté.
- **Piste** : ordonner les runs d'une même source allant du même côté par portée décroissante (emboîtement) avant la coloration, ou coût de croisement dans `untangleChannelRails`. Effort S-M.

### D-06 — Un rail posé exactement sur le trait du cadre d'un groupe

- **Nature** : anomalie de lisibilité, moyenne ; voisine de B1 mais distincte (sur le cadre, pas à travers). Sources : M2-11, M5-10.
- **Preuve** : `t`, `G = {m1, m2}`, `s`, relations `m1→t`, `m2→m1`, `s→m2`, `s→t`, TB : les traverses de `m1→t` et de `s→t` (étrangère à G) suivent y = 216 = bord haut de G, sur 24 et 110 px ; reproduit pour tout en-tête (36, 60, 90) et padding testés ; en LR/RL aucun contact (M2). `G = {b,c}` dans une chaîne de cinq : le jog de `b→a` et 110 px de `e→a` sur le bord haut ; 214/1 200 layouts aléatoires à un groupe ont un tronçon colinéaire à un côté de cadre (M5). L'oracle indépendant déclare ces layouts valides.
- **Code** (inféré) : `routing/layered-routing.ts:186-220` (`groupShellGap` élargit le canal jusqu'au bord de la coque sans dégagement ; le rail reste centré sur `(156+276)/2 = 216`).
- **Piste** : dégagement minimal (`RAIL_SPACING/2`) entre rail et coque, rails centrés sur l'espace libre `[before.end, frame.start]` ; faire contrôler le recouvrement route/cadre par l'oracle. Effort S-M, ré-épinglage probable.

### D-07 — Nombre de croisements différent entre axes ou entre TB et BT

- **Nature** : à arbitrer, moyenne. Sources : M5-09 (vertical ≠ horizontal : 36/300 documents sans groupe, 12 %) ; M2-13 (TB ≠ BT : 12/150, tous avec groupes, exemples 3/8/1/1 et 7/14/5/5). **Contradiction** : M5 mesure TB ≡ BT sur 300/300 documents avec groupes ; le générateur de M2 inclut jonctions et groupes imbriqués (`g0 ⊃ g1`), celui de M5 non. À reproduire avant d'attribuer une cause.
- **Preuve (M5)** : neuf nœuds, `d→a`, `e→b`, `f→a`, `f→d`, `h→a`, `h→c`, `h→f`, `i→c`, `i→e` : TB 4 croisements (la longue `h→a` fait le tour par l'extérieur), LR 0 (elle traverse le couloir entre `d` et `e`) ; le couloir mesure 36 px en vertical et 50 px en horizontal, car `a` est agrandi à 144 px par ses ports et décale la famille `d` de 14 px.
- **Piste** : réserver un couloir de 48 px aux relations longues indépendamment de l'axe ; isoler le cas TB/BT à 5 nœuds avec jonction et groupes imbriqués. Effort M (investigation).

### D-08 — L'ordre des composantes déconnectées suit l'identifiant du groupe racine

- **Nature** : anomalie, moyenne. Source : M2-09, isolé, ancré.
- **Preuve** : deux groupes racine à un membre, `layoutOrder` G1 < G2, plus un nœud libre : avec les identifiants `(b, a)` comme `(a, b)`, `a` est à gauche ; `(été, hiver)` → `hiver`, nœud libre, `été` ; `(~a, b)` → `b`, nœud libre, `~a`.
- **Code** : `structure/prepare-layout.ts:28-41` (contexte = identifiant du groupe racine ou `'~root'`) et `:97-101` (tri par `compareCanonicalStrings(context)` avant `effectiveOrder`).
- **Piste** : trier les contextes par `layoutOrder` du groupe racine, racine à une position canonique explicite. Effort S.

### D-09 — Coordonnées de routes en tiers de pixel

- **Nature** : amélioration, basse. Sources : M1-11, M5-15.
- **Preuve** : biparti 2 × 2 : `c→b … (243.333…,240) …` ; 22/800 layouts simples et 36/800 avec groupes ont un point non entier ; aucun en lanes ni grille. Crochet de 16 px entre deux coudes sur le biparti 3 × 3, plus court que deux rayons de pont.
- **Code** : `routing/channel-routing.ts:151-160` (`offset = (neighbor - wire.source) / 3`).
- **Piste** : arrondir, minimum 24 px pour le crochet. Effort S, ré-épinglage des SHA concernés.

### D-10 — Deux relations parallèles reçoivent la même route

- **Nature** : amélioration, basse. Source : M1-13.
- **Preuve** : `r1: b→a`, `r2: b→a` : routes identiques `(150,228) (150,192) (150,192) (150,156)` dans les quatre directions ; la seconde flèche est invisible (`design.md:100` : un document avec parallèles reste lisible).
- **Piste** : ports distincts pour les parallèles. Effort S.

### D-11 — Routes de contournement au bord du canevas

- **Nature** : anomalie, basse. Source : M5-16.
- **Preuve** : sans groupe, marge minimale 16 px sur 800 layouts ; avec un groupe : 0 px (graine 73, LR/RL, 7 nœuds, 11 relations), 4-6 px (graines 63, 68). Un trait de 2 px à x = 0 est rogné par le `viewBox` de l'export.
- **Piste** : réserver la marge externe aux rails de contournement. Effort S.

## Transversal, documentation et tests

### T-01 — Plusieurs secondes de layout synchrone pour 4 à 11 nœuds

- **Nature** : anomalie, haute (le moteur tourne sur le thread principal, `src/app/web/projection/layout-graph.ts:32-33`). Sources : M1-10, M2-05, M5-04 (grille) ; M2-05 (dédié).
- **Preuve** : grille 2 × 2, quatre nœuds : 1-2 ms avec trois traversées, **3,2 à 3,5 s** dès la quatrième, 5,5 à 8,6 s à six (M5) ; 4,3 s pour cinq traversées, 2,1 s pour une 2 × 3 à trois traversées (M1) ; 28/160 grilles aléatoires > 1 s, jusqu'à 7 s, 5,3 s dans `searchGridCrossingAllocations` (M2). Dédié : 11 nœuds, un groupe, une jonction, 16 relations : 10,4 s en TB pour finir en `GroupRouteFailure`, 5,1 s en BT ; ≈ 3,4 s sous `routeBridgeAnalysis` ← `contactsAnotherRoute` (M2).
- **Code** : `grid-cell-layout.ts:221-260` (`routed()` : géométrie entière + diagnostic par candidat, trois phases × 256 évaluations) ; `group-endpoint-routing.ts:60-73,87-201` (analyse de ponts complète des voisins à chaque essai ; produit ports × pistes × dégagements × rails sans budget compté).
- **Explication** : le budget de rang compte des pipelines, pas leur coût (1 ms à 2 s) ; `tests/support/performance/README.md` n'a pas de profil grille.
- **Piste** : profil `grid-crossings` dans la matrice de performance ; évaluation par delta (comme `validateSharedLaneGeometryDelta`) ou filtre géométrique avant validation complète ; borne inférieure topologique pour arrêter la recherche ; budget compté pour `group-endpoint-routing`. Effort M.

### T-02 — Faces d'attache et pas de ports différents selon la politique

- **Nature** : amélioration, basse. Sources : M1-14, M4-08.
- **Preuve** : dédié : faces principales, pas 48 (`PORT_SPACING`) ; lanes parallèles : faces latérales, pas 48 ; grille : faces latérales, pas 24 (`CROSSING_SPACING`, `grids/grid-cell-crossing.ts:155`). `docs/design.md:423` présente les faces perpendiculaires à l'axe principal comme règle générale, à la seule exception du repli.
- **Piste** : limiter explicitement la phrase au routage dédié intra-région et décrire les attaches des relations inter-lanes et intercellulaires ; unifier le pas une fois L-04 et G-02 traités. Effort S.

### T-03 — Documentation en retard sur le code

- Sources : M1-15, M4 (sans anomalie), M5-18, M2-16, M3-08.
- **D1 non reproductible tel que décrit** : relation groupe→groupe de 1 × 1 à 7 × 7 membres et chaînes de 3-4 groupes, quatre directions : route de 48 px à quatre points (doublon B3), cadres disjoints, validateur sans rejet — trois relecteurs. `phase-4.md:124-129` décrit encore « cadres qui se touchent, 4 points identiques, rejet `route` ». Soit la description est obsolète, soit elle dépend de la fixture `group-relations` à 10/19/50 nœuds, non exécutée ici. 48 px reste inférieur à `BASE_RANK_GAP` (72).
- `docs/layout-routing.md:80` : « Il n'ajoute pas de permutation automatique » — la production réordonne les rangs (`rank/rank-order-selection.ts:291-339`).
- `docs/layout-routing.md:16` : vrai pour le renommage de relations, faux pour les extrémités en lanes (L-02) et jonctions (D-02).
- `docs/layout-engine-refactor-phase-3.md:9,36` annonce un départage « par identifiants » après Kendall, alors que `:58` et `rank/rank-order-search.ts:184-205` comparent des positions documentaires.

### T-04 — Tests verts aveugles sur les cas fautifs

- Sources : M2-15, M4-02, M5-02, M5-05.
- `tests/support/builders/logic-document-arbitrary.ts:311` jette les indices de groupe générés pour nœuds et jonctions : seul le nœud 2 est membre d'un groupe ; `published-layout-validation.test.ts:17-29` tire 50 cas à graine fixe (D-01, D-03 trouvés avec membres aléatoires).
- `relation-rename-invariance.property.test.ts` ne renomme que les relations (L-02, D-02).
- `layout-noninterference.test.ts:96-195` fixe A à une fourche simple (D-01).
- `grid-cell.property.test.ts:71-116` : un nœud par cellule, TB seulement (G-01) ; `grid-cell-layout.test.ts:512-548` et `nested-region-recursive-model-adapter.test.ts:504` épinglent des `unknown`/`unsupported` discutables comme nominaux (G-01, G-05).
- Aucun test de lanes n'asserte la progression des rangs (L-01).

## Défauts connus confirmés

- **B1 / n° 43** (route étrangère à travers un cadre) : M5-11 le reproduit sur 8/590 layouts à un groupe (1,4 %), y compris dans les quatre directions et pour un cadre multi-rangs hébergeant un frère étranger dans sa plage, pas seulement « couvrant les deux rangées d'un canal ».
- **B3** (points colinéaires doublés) : confirmé partout par les cinq relecteurs ; la route droite entre rangs adjacents est systématiquement touchée.
- **n° 66** : prolongé par D-01.
- **n° 58** : non testé spécifiquement ; G-02 et G-03 en sont distincts.

## Points vérifiés sans anomalie

Consolidé des cinq rapports, borné aux échantillons décrits :

- Déterminisme (double appel) et invariance par permutation des collections à `layoutOrder` constant : aucun écart sur les trois cas, quatre directions (≈ 1 500 documents).
- Renommage des identifiants sur des DAG sans jonction, sans groupe et sans lanes : aucune différence géométrique (≈ 1 000 documents, quatre directions).
- Moteur dédié : aucune route à travers une boîte, aucun chevauchement, aucune diagonale, toutes les extrémités attachées, aucune flèche à contre-sens, marge ≥ 16 px sans groupe ; signature structurelle (coudes, croisements) identique TB/BT et LR/RL sur les topologies de base ; parent centré sur l'enveloppe de ses enfants ; groupes blocs rigides ; jonctions : tronc commun et jonction transparente pour le rang.
- Lanes : confinement dans la lane, aucune boîte traversée, saut de la lane médiane dans l'espace libre dans les deux orientations ; diagnostics `unsupported` honnêtes pour jonctions, groupes à membres, 1 ou 4 lanes ; lane vide admise ; 4 à 10 ms jusqu'à 32 nœuds.
- Grille : confinement dans la cellule, opacité (aucune route étrangère dans une cellule), cellules disjointes, gouttière de rangée réellement utilisée dans le 2 × 2 vertical ; aucun layout invalide publié (tous les refus sont des `unknown`/`unsupported` typés).

## Limites

- Aucun rendu visuel ni E2E : lisibilité jugée sur les coordonnées du `LayoutResult`.
- Générateurs de petite taille (≤ 18 nœuds) ; les mesures de temps sont indicatives (une machine, vitest).
- Hors périmètre non exploré : régions imbriquées, grilles internes, groupes dans les cellules ou les lanes, repli, n° 58.
- Les gravités sont celles du coordinateur après recoupement ; les relecteurs divergent d'un cran sur L-03, G-02 et L-01.
