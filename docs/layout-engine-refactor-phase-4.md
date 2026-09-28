# Refonte du moteur de layout — phase 4 : document de passation

Unique point d'entrée de la phase 4 : une session qui reprend sans historique lit ce document, puis seulement les extraits qu'il cite. Statut : **validée sur le principe par l'utilisateur le 27 septembre 2026, non démarrée.** Références : [plan de refonte](layout-engine-refactor.md) (invariants de domaine), [phase 3](layout-engine-refactor-phase-3.md) (bilan), [journal](layout-engine-refactor-journal-2026-09-24.md) (preuves et registre ; « n° » renvoie au registre). Chemins de code relatifs à `src/lib/core/layout/`.

## 1. Point de reprise

- **Branche** : `codex/layout-contract-generalization`, tête de code `784460a4` (clôture de la phase 3), suivie du commit de ce document (branche `phase4/handoff`).
- **Fusion** : faite le 28 septembre 2026, `main` avancé en local jusqu'à cette tête (non poussé, pas de PR). `pnpm check` était vert partout (4 809 tests web avec couverture, 67 worker, 292 propriétés, 215 E2E Chromium, performance snapshot et incrémentale, WebKit et mobile), **sauf Firefox** : les 55 E2E Firefox échouent au lancement du navigateur (`Could not find profile folder`). Le binaire Playwright `firefox-1543` échoue aussi seul sur `about:blank`, même après `playwright install --force firefox`. Le problème vient donc de l'environnement de la machine, pas du code. Il faut le rétablir, puis relancer `--project=firefox`, avant de pousser.
- **Outils** : Node et pnpm via `mise exec -- …` (versions de `mise.toml`) ; un worktree par tranche ; formatage **uniquement** par `mise exec -- pnpm exec prettier --config config/prettier.config.js --ignore-path config/prettier.ignore --write <fichiers>`.

| Porte                 | Contenu                                                                               | Qui, quand                         |
| --------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| `quality:precommit`   | format des fichiers modifiés, lint, knip, architecture, types ; relâchements signalés | writer, avant chaque commit        |
| `quality:fast`        | couverture web et worker sans propriétés (seuil 90 %, décision utilisateur)           | writer, fin de tranche             |
| `quality:integration` | propriétés, E2E Chromium, performance snapshot                                        | script d'intégration, fin de vague |
| `check`               | tout, plus couverture complète, performance incrémentale, autres navigateurs, build   | avant fusion dans `main`           |

`VITEST_MAX_WORKERS=1` si le test dense (`indexed-route-materialization.test.ts`) dépasse son délai sous charge. `TEST_RELAXATION_BASE=<base>` fixe la base du rapport de relâchements de `quality:precommit`.

**Worktrees** : aucun. Le 28 septembre 2026, les branches `phase3/budget-grid` et `phase3/rank-search-k32` (déjà contenues dans la tête) ont été supprimées, ainsi que `phase3/group-detour` (approche rejetée, remplacée par B2) et `phase3/collab-edit-cost`. Cette dernière reposait sur un rollback Yjs et une reprise de checkpoint que `main` a remplacés par une validation avant commit monotone (`df4cec9d`, `437cbda9`) ; sa fusion donnait des conflits dans 11 fichiers.

**Premiers gestes de la session suivante** : vérifier que Firefox est rétabli, puis relancer `--project=firefox` ; lancer V0a avec un brief tiré de la section 4. Les décisions de la section 5 sont prises.

## 2. Objectif et non-objectifs

**Objectif.** Deux idées de l'utilisateur, combinées :

1. **Modéliser le domaine.** Le moteur reçoit une topologie typée (`GraphEndpoint`, relations résolues et uniques, `GroupHierarchy` en intervalles préordre) et la réinvente avec des ids `string`, des booléens, des rectangles et des clés `JSON.stringify` (chiffres en annexe). Au moins douze familles de défauts du registre en découlent. Remplacer ces primitifs par des types porteurs de sens : ids marqués, emprises, cadres relatifs à une route, incidences, ressources nommées, comptes exacts ou bornés, résultats de recherche typés au lieu d'exceptions de contrôle.
2. **Rendre les phases explicites, forme B.** Des phases à l'intérieur du moteur dédié **et** de chaque domaine (`lanes/`, `grids/`, `regions/`) ; `shared/` pour les seuls contrats qui traversent une frontière ; la boucle finie ports → demandes métriques → re-placement pilotée par l'orchestrateur (aucun import de `routing/` vers `placement/`) ; la règle « phase N importe les phases < N et `shared/` », vérifiée par `dependency-cruiser`, avec orchestrateurs et adaptateurs en exceptions déclarées et sans cycle.

**Cible de la forme B.**

- `shared/` : `identity` (ids, index) ; `vocabulary` (`FlowRole`, `Side`, `Axis`, `LayoutFrame`) ; `topology` (`LayoutEndpoint`, `Incidence`, `Frame`, `FrameRole`, `GapSpan`) ; `faces` ; `resources` (issu de `resources/`) ; `routes` (`Route`, `routeRuns`, issus de `bridges/route-runs.ts`) ; `search` (`Count`, `WorkMeter`, `SearchOutcome`, `StopCause`) ; `diagnostics` (enveloppe et `describe`). `layout-types.ts` reste la projection publique.
- Contrats internes au moteur dédié, hors de `shared/` : `Structure` (table d'extrémités, `RankSpan`) → `PlacementSnapshot` (bornes en lecture seule par `EndpointIndex`, cadres) → `PortProposal`/`FaceDemand` (boucle finie dans l'orchestrateur) → `RoutingPlan` (arêtes, allocations) → `Route[]` → projection et `SearchOutcome` de validation. Lanes, grilles et régions suivent le même schéma.
- Retours de flux nécessaires, portés par l'orchestrateur et non par des imports inverses : boucle ports → re-placement (`layout-port-placement.ts`, `routing/settle-group-corridors.ts:78-112`) ; évaluation de layouts complets par le rang, déjà injectable par `DedicatedLayoutEvaluator` (`rank/rank-order-search.ts:28-34`) ; récursion des régions vers des solveurs de feuilles contractualisés.
- Risques à surveiller : ordres et identifiants de pistes (`resources/routing-resource-allocation.ts`), preuves et budgets de recherche, ordre déterministe, boucles de calcul ; les préserver avant tout déplacement massif.

**Non-objectifs.**

- Aucun changement de rendu hors V4 ; `LayoutResult` identique à l'octet près (mêmes champs, même ordre de clés).
- Pas d'IR publiée ni persistée ; pas de phases globales qui disperseraient chaque domaine (forme A rejetée).
- Pas de nouvel algorithme ni de nouveau solveur ; aucun seuil relevé.
- Pas d'alias ni de ré-export de compatibilité : chaque coupe est franche.

## 3. Invariants et protections

**Empreintes à garder inchangées** (commande groupée : encadré « Rejouer » du journal) :

- 12 SHA-256 de `LayoutResult` dédié : `tests/lib/core/layout/dedicated-layout-identity.test.ts` ;
- empreinte dense : `tests/lib/core/layout/indexed-route-materialization.test.ts` ;
- 5 grilles : `tests/lib/core/layout/grid-cell-layout-identity.test.ts` ;
- banc d'ordre : `tests/app/workshop/solver-prototype/rank-order-comparison.test.ts` ;
- bus parent : `tests/lib/core/layout/nested-region-parent-bus-order.test.ts` ;
- corpus différentiel : `tests/scenarios/visual/layout-differential-corpus.test.ts`, parité seulement, **jamais une référence**.

**Règle d'arrêt : une empreinte qui change hors V4 arrête la tranche.** Le changement relève alors d'une décision B (section 5), avec son entrée de journal et un ré-épinglage unique.

**Checks automatisés** (`tests/lib/core/layout/`) : `published-layout-validation` (et sa propriété), `layout-noninterference`, `layout-work-unit-bounds`, `bounded-search-witness-honesty`, `layout-workspace.property`. Une tranche qui rend une implication vérifiée par le type peut retirer l'assertion correspondante, en la listant et en la justifiant.

**Budgets de performance** (`tests/support/performance/snapshot-layout-budgets.ts` et `incremental-layout-budgets.ts` ; jamais relevés pour faire passer une mesure) :

- snapshot : `wide-bipartite-layers/1000` < 138 ms (médiane calme 91,8 ms sur `34d023c9`), `nested-subgroups/1000` < 205 ms, `lane-allocations-dense/1000` < 65 ms ; ailleurs 10/10/30/50/100 ms pour 10/19/50/100/1000 nœuds ;
- incrémental : 5 ms dans la plupart des cellules ; notamment `wide-bipartite-layers` 10-19 < 9 et 100-999 < 195, `nested-subgroups/100-999` < 200, `binary-tree/100-999` < 9, `group-relations/100-999` < 10 ;
- toute tranche du chemin chaud (V2a à V2e) fournit une paire `performance:record`/`performance:compare` sur `wide-bipartite-layers/nodes=1000`, base et branche dans la même fenêtre calme (`tests/support/performance/README.md`).

## 4. Tranches

Tailles : S ≤ 5 fichiers de production, M de 6 à 20 ; aucune tranche L. Chaque tranche passe les portes writer et garde les empreintes de la section 3 ; la colonne « Preuve » ne liste que ce qui s'y ajoute. Entre deux vagues : `quality:integration` et trois mesures de performance.

| Id    | Contenu                                                                                                                                                                                                                                                                            | Taille  | Fichiers principaux                                                                                                                                                          | Dépend de     | Parallèle             | Preuve d'acceptation                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| V0a   | M0 et ids côté dédié : scope `shared/` dans `config/dependency-cruiser.cjs` (n'importe que lui-même) ; `shared/identity` (`RelationId`, `EndpointId`, `GroupId`, `RegionId`, `LaneId`, index denses) ; production à `createGraph` et dans `layout-types.ts` ; consommateurs dédiés | M       | `shared/identity/`, `layout-types.ts`, `structure/`, `rank/`, `placement/`, `routing/`                                                                                       | —             | non                   | architecture ; aucune chaîne d'id changée dans `document/` ni `infrastructure/`                 |
| V0b   | Ids dans les domaines (codemod AST) ; vocabulaire unique `FlowRole`, `Side`, `Axis` (`shared/vocabulary`) ; doublon `RegionIncidentRole` supprimé ; `RoutingPortRole` réservé à l'inspection                                                                                       | M       | `lanes/`, `grids/`, `regions/`, `contract/`, `folded/`, tests                                                                                                                | V0a           | non                   | clé de `regions/model/region-local-cache.ts:63` inchangée                                       |
| V0c   | M2 cœur : `Count`, `Budget`, `WorkMeter`, `SearchOutcome`, `StopCause` (`shared/search`) ; `search/bounded-search.ts` et ses 10 appelants                                                                                                                                          | M       | `search/`, `shared/search/`                                                                                                                                                  | V0b           | non                   | `bounded-search-witness-honesty`, `layout-work-unit-bounds` ; bornes et provenance intactes     |
| V1a   | Grilles : témoins en `SearchOutcome`/`Count` (fin de la convention budget + 1 et de l'état « Arrêtée » inatteignable), diagnostics typés ; `search/grid-cell-crossing-witness.ts` déplacé dans `grids/`                                                                            | M       | `grids/`, `GridCellAllocationExplorer.svelte`                                                                                                                                | V0c           | oui                   | E2E atelier (data-attributes) ; totaux exacts ou bornés                                         |
| V1b   | Lanes : témoins et diagnostics typés ; `AllocationWorkExceeded` en valeur                                                                                                                                                                                                          | M       | `lanes/`, explorateurs d'atelier qui lisent ces témoins                                                                                                                      | V0c           | oui                   | publication ; non-interférence                                                                  |
| V1c   | Rang et contrat : témoin de rang sans `stop`, `exhaustive` et `truncated` redondants ; `GroupRouteFailure` (5 captures dans `rank/`) en valeur                                                                                                                                     | M       | `rank/`, `contract/`, `group-endpoint-routing.ts`, `SolverExplorer`, `ComposedExplorer`, `JointK32Explorer`                                                                  | V0c           | oui                   | banc d'ordre ; messages projetés identiques                                                     |
| V1d   | Régions : `exhausted?`, `exhaustive?`, `code: string`, `RegionWorkLimitExceeded`, `ExhaustedLeafAlternative`, messages concaténés → diagnostics typés et `describe`                                                                                                                | M       | `regions/**`, `root-region.ts`                                                                                                                                               | V0c           | oui                   | bus parent ; E2E des régions persistées                                                         |
| V1e   | M4 dédié : `shared/topology` (`Frame`, `FrameRole` par préordre, `GapSpan` exhaustif avec `Covers` = comportement actuel) ; 4 parcours d'ascendance et la clé JSON du cache de passages supprimés                                                                                  | M       | `routing/group-passages.ts`, `routing/layered-routing.ts`, `dedicated-candidate-validation/element-checks.ts`, `dedicated-candidate-validation/layout-checks.ts`             | V0b           | oui                   | non-interférence ; propriété group-junction                                                     |
| V1f   | M4 grilles et régions : 2 derniers parcours ; un seul `inside` ; appartenance par hiérarchie, non par géométrie                                                                                                                                                                    | S       | `grids/grid-cell-validation.ts`, `regions/validation/nested-region-leaf-incident-validation.ts`, `regions/leaf/region-leaf-incident-geometry.ts`, `geometry/*-primitives.ts` | V1a, V1d, V1e | non                   | 5 grilles ; si `region-leaf-incident-geometry.ts:252` change une sortie, arrêt et bascule en V4 |
| V2a   | M6 cœur : `EdgeRole`, `Capacity`, `OccurrenceKey`, piste libre en union (fin de `FREE_TRACK = ''`), allocation pure (sans réécrire `demand.rail` ni muter la capacité), `sameAllocation` ; partie canal                                                                            | M       | `resources/`, `shared/resources/`, `routing/channel-routing.ts`, `routing/channel-interval-allocation.ts`                                                                    | V1            | non                   | propriété d'allocation ; paire perf                                                             |
| V2b   | M5a : une seule clé d'incidence (`Incidence`, `IncidenceIndex` = 2·RelationIndex + rôle) au lieu de quatre encodages                                                                                                                                                               | S       | `routing/port-allocation.ts`, `lanes/shared-lane-ports.ts`, `regions/model/region-incident-contract.ts`, `dedicated-candidate-validation/ports.ts`                           | V2a           | non                   | paire perf                                                                                      |
| V2c   | M5b : table `LayoutEndpoint` (`Footprint` Box/Envelope, `FacePolicy`, préordre) ; fin des relectures de genre par id                                                                                                                                                               | M       | `structure/prepare-layout.ts`, `routing/port-allocation.ts`, `routing/routing-layers.ts`, `lanes/shared-lane-model.ts`                                                       | V2b           | chaîne dédiée         | paire perf                                                                                      |
| V2d   | M5c : `PortProposal` en tableaux denses ; `FaceDemand` unique (fin du doublon `contract/metric-demand.ts`) ; capacité de face = arête (n° 10)                                                                                                                                      | M       | `routing/port-allocation.ts`, `contract/metric-demand.ts`, `layout-port-placement.ts`                                                                                        | V2c           | chaîne dédiée         | paire perf ; gain attendu : plus de revérification O(n) du tri des relations                    |
| V2e   | Phases dédiées, pas 1 et 2 : instantanés immuables (`PlacementSnapshot` indexé par `EndpointIndex`) ; boucle ports → re-placement et stabilisation des corridors dans l'orchestrateur                                                                                              | M       | `layout-engine.ts`, `layout-port-placement.ts`, `placement/`, `routing/settle-group-corridors.ts`, `build-layout-result.ts`                                                  | V2d           | chaîne dédiée         | phases testées sur entrée figée ; paire perf                                                    |
| V2f   | M6 consommateurs : propriétaire de ressource typé au lieu de `ownerId` ; `sameAllocation` au lieu du JSON                                                                                                                                                                          | M       | `lanes/shared-lane-{frame,routing,allocation-search}.ts`, `grids/grid-cell-crossing*.ts`, `contract/resolve-contract.ts`                                                     | V2b           | oui (avec V2c-e, V2g) | 5 grilles ; bus parent                                                                          |
| V2g   | M7a : un seul parseur `routeRuns` qui refuse par un type au lieu d'ignorer les segments diagonaux ou nuls ; `Run` avec axe ; ordinaux de route ; clés numériques des ponts                                                                                                         | M       | `bridges/`, `routing/route-cost.ts`, `inspection/routing-inspection.ts`                                                                                                      | V2a           | oui                   | propriétés `bridge-oracle` et `bridge-oracle-index` ; points intacts                            |
| V2h   | M7b : `RoutePiece` (complète, incidente, possédée) et propriétaire de route ; sources de route de `build-layout-result.ts` sans précédence implicite ; autres parseurs retirés                                                                                                     | M       | `build-layout-result.ts`, `contract/validate-candidate.ts`, `lanes/shared-lane-route-validation.ts`, `geometry/nested-region-geometry-primitives.ts`                         | V2e, V2g      | non                   | publication ; homonymes distincts                                                               |
| V3a   | Pas 3 : adaptateur `LeafSolver(document local, incidences + Side[] admis) → SearchOutcome<LeafSolution, LeafRejection>` ; contrat interdomaine                                                                                                                                     | M       | `contract/candidate-layout.ts`, `regions/leaf/region-leaf-layout.ts`                                                                                                         | V2            | non                   | E2E des régions et lanes persistées                                                             |
| V3b-e | Pas 4 : modules rangés en phases (b dédié, c lanes, d grilles, e régions) ; règle `phase N → phases < N ou shared/` dans `dependency-cruiser`                                                                                                                                      | 4 × S-M | un domaine par tranche                                                                                                                                                       | V3a           | oui (4)               | architecture ; diff de déplacement seul                                                         |
| V3f   | M8 : clés résiduelles ; `no-restricted-syntax` sur `JSON.stringify` dans `layout/`, sauf le module d'empreinte                                                                                                                                                                     | S       | `config/eslint.config.js`, restes                                                                                                                                            | V3b-e         | non                   | lint                                                                                            |
| V4    | Décisions B de la section 5, en série, un seul ré-épinglage                                                                                                                                                                                                                        | S à M   | section 5                                                                                                                                                                    | V3            | non                   | décision, contre-exemple, entrée de journal                                                     |

**Ordre et parallélisme.**

- V0 en série, un writer. Puis **mesurer le coût réel de V0 et extrapoler** avant de lancer V1 (section 7).
- V1 : V1a à V1e en parallèle dans des worktrees disjoints, puis V1f.
- V2 : V2a, puis V2b, puis trois fils : la chaîne dédiée V2c → V2d → V2e, avec un seul propriétaire de `layout-engine`, `layout-port-placement`, `structure/`, `placement/`, `routing/` et `build-layout-result` ; V2f ; V2g, puis V2h après V2e.
- V3 : V3a, puis V3b-e en parallèle, puis V3f.
- Raison de l'ordre : le modèle transversal passe d'abord pour ne pas retyper deux fois les contrats ; les concepts qui sont des contrats de phase (M5 à M7) arrivent avec leur phase ; déplacements et règle d'import en dernier, sur des interfaces stables.

## 5. Décisions de l'utilisateur (V4)

**Décidé le 28 septembre 2026 : B1, B2 et B3 acceptés.** B1 et B3 se font dans le même ré-épinglage que B2 (une seule entrée de journal, un seul ré-épinglage des empreintes).

- **B2 — Faut-il planifier les passages autour des enveloppes de groupes pendant le routage, au lieu de les corriger après placement (détour, sinon `GroupRouteFailure`) ?**
  - Plus gros gain de lisibilité et de simplicité : `Envelope` sort de `RoutingLayers.rows` ; la correction de `group-endpoint-routing.ts:253-293` disparaît.
  - Ré-épingle les documents à groupes.
  - Deux tranches M : B2a, enveloppe hors des couches et écart de rang issu de `RankSpan` (inclut le correctif de D1, section 6) ; B2b, passages planifiés et retrait de la correction a posteriori.
- **B1 — Faut-il réserver la coque d'un cadre de groupe qui couvre les deux rangées d'un canal (n° 43, ouvert) ?**
  - Aujourd'hui `groupShellGap` (`routing/layered-routing.ts:186-209`) tombe dans `return 0` : un rail étranger peut traverser le cadre.
  - Tranche S : cas `GapSpan.Covers`, avec contre-exemple.
- **B3 — Faut-il retirer les points colinéaires en double des routes publiées ?**
  - Invisible à l'écran (`routing/group-exterior-path.ts:35-52` et autres générateurs), mais ré-épingle les 12 SHA et l'empreinte dense.
  - Tranche S.

Si B2 est refusé, D1 devient une tranche S isolée de V4, avec son propre ré-épinglage.

## 6. Défauts connus à reprendre (par priorité)

1. **D1 — relation groupe→groupe entre rangs adjacents réduite à un point.**
   - Symptôme : les cadres se touchent et la route compte 4 points identiques, par ex. (686,240) dans le scénario `group-relations` ; la flèche est invisible et le validateur la rejette (`route`) dans tout ordre, documentaire compris, de 1×1 à 7×7 membres.
   - Cause : `relationGroupRankGap` (`placement/prepare-measurements.ts`) réserve la somme des coques, pas l'écart libre `BASE_RANK_GAP` entre le bord de l'extrémité-groupe et l'autre extrémité.
   - Correctif essayé puis annulé : `gap = max(existant, coques + BASE_RANK_GAP)` donne une route de 72 px valide dans les 4 directions, mais change `dedicated-layout-identity` et fait passer `group-relations/1000` à froid de ~4 ms à ~35 s (39,6 ms à 100 nœuds). **Profiler ce coût non linéaire avant tout correctif.**
   - Budget : la relation impute |S|×|T| paires au budget de rang ; deux groupes de 7 membres (49 paires ≥ 45) **désactivent la recherche d'ordre de toute leur composante**. Imputer 1 unité par relation **après** le correctif de gap seulement : sinon la recherche relancée n'a que des candidats invalides (`baseline-fallback`) et `group-relations` dépasse ses plafonds incrémentaux (50-99 : 6,63 ms pour 5 ; 100-999 : 31,7 ms pour 10).
   - Depuis `a4999076`, la sélection d'ordre change pour tout document comportant une telle relation.
2. **Non-interférence non garantie** pour les composantes sans jonction portant des arêtes longues (n° 66, ouvert) : elles gardent le routage global (`reservedRoutes`) ; le témoin A seul/A+B ne couvre que 31 configurations à jonction.
3. **Limite acceptée de la grille** (n° 58) : gouttière de rangée et ordre de bus non canonique ne sont pas énumérés conjointement dans une même relation.
4. **Cellules de performance incrémentale au bord du plafond** (n° 54 et 70, ouverts) : `wide-bipartite-layers/10-19` a mesuré 10,5 ms une fois en `check` complet contre 6,1 à 6,4 ms isolé (plafond 9) ; `binary-tree/100-999` refait un layout froid complet à chaque insertion (~6 ms, plafond 9 sans marge). Remesurer en fenêtre calme ; aucun plafond relevé sans décision utilisateur.

## 7. Processus et budget

**Audit de consommation du 21 au 27 septembre** (`/tmp/token-audit/report_tables.md`) : 4,64 G tokens, dont 96 % de relecture de cache. Le coût suit la taille du contexte relu à chaque appel, bien plus que le volume produit.

| Rôle          | Part des tokens | Contexte moyen |
| ------------- | --------------: | -------------: |
| writers       |            73 % |          120 k |
| orchestrateur |            12 % |          432 k |
| intégrateurs  |           5,9 % |           70 k |
| relecteurs    |           3,1 % |           29 k |

Coût par tranche de phase 3 : moyenne 135 M, médiane 85 M.

**Règles opératoires de la phase 4.**

- Un writer passe la main à 120-150 k de contexte ; préférer un nouvel agent avec un résumé à la reprise d'un long contexte.
- Brief d'environ 3 k par tranche, extrait de ce document (ligne du tableau, section 3, section 8) ; jamais le journal entier.
- Portes lancées par script ; un LLM intégrateur seulement en cas de conflit ou d'échec.
- Couverture complète et `check` à l'intégration seulement.
- Au plus une relecture et une vérification par tranche, guidées par les 5 familles de la section 8.
- Orchestrateur compacté à 200 k ; une session par vague.

**Budget.** Le tableau compte 23 tranches, dont 7 de taille S ou S-M (comptées pour moitié), soit environ 19,5 équivalents M. Sur la base de l'audit (≈ 135 M par tranche sans levier, ≈ 80 M avec), la phase 4 est estimée à **≈ 1,6 G tokens avec ces leviers (fourchette 1,3 à 2,3 G)** et ≈ 2,6 G sans. Mesurer V0 (3 tranches M), recalculer le coût par tranche, et soumettre le total extrapolé à l'utilisateur avant V1.

## 8. Liste de vérification des writers

Les relectures de phase 3 ont trouvé ces cinq défauts à répétition, portes vertes comprises. Le rapport du writer dit comment chacun est couvert :

1. **Chemin produit** : chaque comportement a un témoin par l'entrée produit (`layoutWithRootRegion`, projection, scénario persistant), pas seulement par appel direct au solveur ; chercher les gardes amont qui rendraient le gain inatteignable.
2. **Non-interférence** : pour toute portée globale, une composante indépendante ne change ni ports, ni attaches, ni routes (A seul contre A+B).
3. **Travail compté** : aucun calcul combinatoire ou quadratique avant ou hors budget ; profiler le pire cas voisin ; pas de falaise juste au-delà du profil.
4. **Témoins honnêtes** : `exhaustive` seulement après parcours complet ; cause, provenance, compteurs exacts ou borne explicite ; aucune géométrie partielle ou invalide publiée.
5. **Pas de relâchement silencieux** : assertion retirée ou affaiblie, `it.fails` ou skip ajouté, budget ou plafond modifié : listé et justifié (champ `relaxations`).

Préférer des types qui rendent l'état impossible non représentable (union discriminée, `switch` exhaustif sans `default`) à une garde défensive ; aucun test écrit pour le compteur de couverture.

## Annexe — diagnostic qui justifie le modèle (tête `6af4368f`)

`LayoutStructure` et `RoutingLayers` repassent à `string[]`, `Map<string, Bounds>` et `Map<string, number>` (`structure/prepare-layout.ts:12-22`, `layout-types.ts:116-120`), puis chaque phase réinterprète ces primitifs :

| Motif                 | Occurrences | Fichiers | Signe                                                               |
| --------------------- | ----------: | -------: | ------------------------------------------------------------------- |
| `endpointsById.get(`  |          34 |       19 | genre de l'extrémité relu par id ; groupe traité comme un nœud      |
| `bounds.get(`         |          43 |       21 | appartenance déduite de la géométrie                                |
| `JSON.stringify`      |          32 |       17 | clés d'identité sérialisées, y compris à partir de flottants        |
| `vertical: boolean`   |          82 |       38 | axe recalculé depuis la direction                                   |
| `extends Error`       |          15 |        8 | arrêts attendus par exception (`GroupRouteFailure` capturée 5 fois) |
| `Point[]` comme route |          42 |       26 | cinq parseurs de segments, dont un qui ignore les diagonales        |
| `reason: string`      |          26 |       14 | codes texte au lieu de diagnostics typés                            |

Autres constats : `total` a trois représentations (`number`, `string`, `bigint`) ; `exhausted` signifie « budget refusé » et `exhaustive` « espace couvert » ; au moins 15 formes de témoin ; six parcours d'ascendance ignorent les intervalles préordre ; deux `inside` aux arguments inversés ; l'`ownerId` des ressources mélange cinq espaces de noms.

**Règles communes du modèle.** Trois niveaux d'identité : ids documentaires marqués (frontières, clés de cache), handles `GraphEndpoint`/`GraphRelation` dans un appel, index denses marqués pour les tableaux chauds. Unions en interfaces nommées et discriminants en enums string (`config/eslint.config.js:151-153`) ; marques construites par prédicat de type, jamais par `as` (`no-unsafe-type-assertion`) ; formes monomorphes et `readonly` en production, gel profond en test seulement. L'empreinte vaut `sha256(JSON.stringify(result))` : ni champ ajouté ni ordre de clés modifié.

| Concept             | Types clés                                                | Invariant principal                                                             | Registre                            | Coût                          |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------- |
| Identités           | `RelationId`, `EndpointId`, … ; `RelationIndex`           | construits seulement à `createGraph` ou à la normalisation des régions          | 4, 6, 41, 52, 67                    | nul                           |
| Extrémités, emprise | `LayoutEndpoint`, `Footprint` Box/Envelope                | `Envelope` ssi groupe peuplé ; jamais dans une rangée ni une couche             | 21, 25, 26, 47, 57, 65, 66          | ~1 000 objets, une fois       |
| Cadres              | `Frame`, `FrameRole`, `GapSpan`                           | rôle déduit de la hiérarchie, jamais de la géométrie ; cas `Covers` explicite   | 42, 43, 44, 52, 57, 65              | O(1) par préordre             |
| Faces, ports        | `Incidence`, `Face`, `Port` Slot/Shared, `FaceDemand`     | offset dérivé, jamais identité ; capacité de face = arête                       | 7, 9, 10, 19, 26, 31, 39, 60        | chemin chaud, tableaux denses |
| Routes, runs        | `RoutePiece`, `Route`, `Run`, `routeRuns`                 | un parseur qui refuse ; identité par ordinal ; points inchangés                 | 5, 33, 40, 45, 51, 60, 65, 67       | deux champs par route         |
| Ressources          | `RoutingEdge` (`EdgeRole`, `Capacity`), `TrackAllocation` | capacité connue avant allocation ; allocation pure ; occurrence ≠ relation      | 7, 9, 10, 26, 31, 60                | quelques arêtes par rang      |
| Comptes, budgets    | `Count` Exact/LowerBound, `WorkMeter`                     | une seule représentation de `total` ; évidence privée, sans remise à zéro       | 1, 2, 6, 36, 41, 56, 58, 62, 63, 68 | hors chemin chaud             |
| Résultats           | `SearchOutcome` Selected/Exhausted/Truncated, `StopCause` | `Exhausted` ⇒ compte exact ; `Optimal` ⇒ parcours complet ; `Truncated` ⇒ cause | 10, 14, 24, 25, 34                  | valeurs au lieu d'exceptions  |
