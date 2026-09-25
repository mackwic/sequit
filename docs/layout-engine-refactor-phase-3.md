# Refonte du moteur de layout — phase 3

Ce plan prolonge le [plan de refonte](layout-engine-refactor.md), qui reste la référence des décisions de domaine et des invariants, et le [plan de la phase 2](layout-engine-refactor-phase-2.md), dont le bilan détermine le point de reprise. Le [journal du 24 septembre](layout-engine-refactor-journal-2026-09-24.md) conserve les preuves et le registre ; ce document fixe le périmètre et l'ordre de la phase 3, sans recopier ces preuves.

## Point de reprise

La phase 3 reprend sur la clôture effective de la phase 2, après intégration et consignation des travaux de finition déjà engagés : budgets séparés par phase de recherche de grille (1A), élagage validé contre 1A (1C), capacité des gouttières fondée sur leur charge réelle (4B), candidat ponté compact dans le contrat adjacent (2B), ordre des bus de lanes (n° 8), et clôture des travaux de fuzz, du test dense et de la porte de couverture (n° 28–30). La tête de reprise sera celle du journal de clôture ; aucun hachage n'est avancé ici avant ces commits.

Ces éléments sont des prérequis, pas des étapes à refaire : 1A/1C/4B pour étendre les ressources de grille ; 2B pour éprouver la décision pont/détour sur un témoin réel ; n° 8 pour ne pas confondre ordre visuel dans un rang et ordre déclaré des lanes. L'étape 0 vérifie que leurs preuves et empreintes sont présentes avant toute modification de production. Si un prérequis manque, la phase 3 ne le contourne pas : il est terminé et consigné d'abord.

## Diagnostic

La phase 2 a généralisé l'allocation des rails et ajouté un oracle de pont, mais n'a pas rendu toutes les feuilles cohérentes avec ces contrats. Quatre écarts restent directement liés à la lisibilité :

1. **Croisements évitables dans les rangs.** `rank-order.ts` sait énumérer et noter des ordres ; le banc `rank-order-comparison.ts` montre 2 → 0 croisements sur 3+1 et 1 → 0 sur 2+2. La production (`prepareLayout` puis `preparePlacementRows`) garde pourtant l'ordre documentaire.
2. **Contacts de feuille à deux règles.** `pathsTouchWithoutBridge` et le chemin `routesCross`/`segmentsContact` rejettent tout contact entre routes incidentes ; ils n'appliquent pas l'oracle commun. À l'inverse, les contacts de composition et certaines validations de lanes consomment déjà `unbridgedContacts`.
3. **Pas de passage horizontal dans une grille.** `gridRoutingEdges` ne déclare que les gouttières de colonnes et `topBus`; `crossingRoute` fait monter les traversées vers ce bus. Une relation qui doit descendre entre rangées n'a donc pas de ressource dédiée, malgré le diagnostic `GridRowGutterMissing`.
4. **Enveloppes de cardinalité non mesurées et moteur encore mixte.** `region-composition-limits.ts` borne régions, extrémités, relations, enfants et traversées ; `grid-cell-model.ts` a sa propre enveloppe 20/20 et le solveur de feuille plafonne les incidents. Ces nombres ne démontrent pas un coût acceptable. Le graphe de ressources sert aux dispositions et aux voies adjacentes, mais les rails du moteur dédié passent encore par leur allocation spécialisée.

Les écarts acceptés qui ne bloquent pas la lisibilité (traces spécifiques d'atelier du n° 1, affectation de côtés du n° 2, deux passes de lanes du n° 16 et absence d'orientation générique au n° 31) restent hors périmètre. Ils ne justifient ni un chantier transversal ni une nouvelle abstraction dans cette phase.

## Objectif et non-objectifs

**Objectif :** réduire les croisements qui gênent la lecture des flèches causales, appliquer une seule règle vérifiable aux contacts de route, donner aux traversées entre rangées une ressource de grille et remplacer les rejets de forme par des budgets de travail mesurés. Commencer ensuite la migration du moteur dédié par une tranche dont l'identité de sortie est prouvable.

**Décision produit tranchée :** oui au réordonnancement dans le rang en production. Le graphe doit se lire avant que l'ordre documentaire des boîtes ne prime comme simple préférence. L'ordre du document reste le tie-break déterministe à croisements égaux ; il n'y a jamais de hint provenant du layout précédent d'un pair.

**Non-objectifs :** pas de déplacement manuel ni de géométrie persistée ; pas de changement aux rangs logiques, identifiants, relations, ordre des lanes, opacité des régions ou contrat d'incrémentalité ; pas de solveur général, de nouveau format documentaire, de nouveaux types de groupes ou de politique de lane ; pas de réécriture complète du moteur dédié. Une forme sans route validée reste `unknown`/`unsupported` avec diagnostic, jamais une route approximative.

## Étapes

### 0. Fermer les prérequis et figer les oracles

**Départ.** Le journal de clôture, ses sections sur 1A/1C/4B/2B et les entrées n° 8, 28–30 ; les tests `rank-order-comparison.test.ts`, `indexed-route-materialization.test.ts`, `grid-cell-layout-identity.test.ts` et `layout-differential-corpus.test.ts`.

**Travail.** Vérifier dans le journal que les travaux de reprise sont réellement terminés et que les preuves attendues correspondent à la tête reprise. Relever les empreintes et les résultats de performance comme base de comparaison ; ne pas ré-épingler une sortie à cette étape. Conserver le constat existant du test dense sous charge et son exécution sérielle si le journal de clôture le prescrit.

**Acceptation observable.** Les prérequis sont reliés à leurs preuves dans le journal ; les oracles de sortie et le corpus différentiel sont exécutables et gelés. Aucun code, rendu, seuil ou témoin n'est modifié.

**Risque / invariant.** Une branche incomplète ferait attribuer à la phase 3 une régression ou un travail déjà fait. Ici, les sorties du moteur dédié, de la grille et les empreintes restent identiques.

### 1. Activer le réordonnancement de rang en production

**Départ.** `rank-order.ts` (`documentaryRankOrder`, `enumerateRankOrders`, `rankOrderEnumerationSize`, `countRankOrderCrossings`, `compareRankOrders`), `structure/prepare-layout.ts:prepareLayout`, `structure/placement-rows.ts:preparePlacementRows`, `src/app/workshop/solver-prototype/rank-order-comparison.ts` et `src/app/workshop/visual-tests/solver-prototype/RankOrderComparisonExplorer.svelte`.

**Changement.** Faire choisir à la production un ordre par rang avant le placement, au lieu de n'utiliser `orderEndpoints` que pour l'ordre documentaire. Minimiser lexicographiquement : (1) le nombre de croisements de relations entre rangs ; (2) la distance de Kendall de l'ordre candidat à l'ordre documentaire dans chaque rang ; (3) l'ordre documentaire lui-même, puis l'identifiant canonique en cas d'égalité documentaire. Ainsi, une égalité de lisibilité garde le dessin attendu par les collaborateurs, et la règle se mesure sans pondération arbitraire.

L'énumération exhaustive est l'oracle et n'est autorisée que lorsque son coût estimé (permutations **et** évaluations des croisements) entre dans le budget. Au-delà, démarrer de l'ordre documentaire et utiliser un balayage déterministe de barycentres suivi d'améliorations locales bornées ; n'accepter qu'une amélioration de la même clé lexicographique et arrêter au budget de travail. Ne jamais matérialiser le produit factoriel pour les grands rangs. Le calcul n'utilise ni ordre précédent ni géométrie locale en cache comme préférence.

Étendre le banc à des éditions contrôlées par ajout/suppression d'une relation : afficher les croisements, le déplacement documentaire, le nombre de candidats/travail évalué et la stabilité des éléments communs. La stabilité est la distance de Kendall normalisée entre les ordres avant/après, calculée uniquement sur les paires d'éléments présents dans les deux documents et dans le même rang ; rapporter à part les éléments qui changent de rang. Elle rend visible un remaniement collatéral sans transformer l'historique d'un pair en entrée du moteur.

**Acceptation observable.** Le résultat de production atteint l'optimum exhaustif sur les petits témoins ; le comparatif conserve 2 → 0 (3+1) et 1 → 0 (2+2) ; la propriété fuzz vérifie bijection, déterminisme, jamais plus de croisements que l'ordre documentaire, et le tie-break de déplacement documentaire. Le banc montre le score de stabilité pour chaque mutation témoin. Les empreintes du dense, du banc de rang et du corpus différentiel sont mises à jour **une seule fois**, dans le commit de comportement dédié qui consigne la décision au journal ; chaque divergence est expliquée, jamais acceptée par simple ré-épinglage. Mettre aussi à jour une empreinte de grille uniquement si sa disposition locale passe effectivement par cette production.

**Rendu et portes spécifiques.** Oui, le graphe change. E2E Chromium sur les parcours visuels concernés (`tests/app/e2e/visual-tests.spec.ts`, `routing-scenarios.spec.ts` et, si l'atelier de comparaison est exposé par le parcours, `workshop-scenarios.spec.ts`). Fuzz de `rank-order.property.test.ts` et test du banc. `test:performance` obligatoire : ce nouveau travail est sur le chemin chaud et le budget `< 100 ms` ne bouge pas.

**Risque / invariant.** Un ordonnancement local peut réduire les croisements mais déplacer des boîtes sans lien avec le conflit. La distance à l'ordre documentaire et le témoin d'édition rendent ce coût mesurable ; le banc doit le signaler. En dehors des nouvelles positions et routes que celles-ci impliquent, les identifiants, les rangs logiques et les données restent inchangés.

### 2. Unifier les contacts de routes de feuilles

**Départ.** `nested-region-leaf-incident-contacts.ts:pathsTouchWithoutBridge`, `region-leaf-incident-geometry.ts:geometryFailure`, `nested-region-leaf-incident-validation.ts:localRouteFailure`, `shared-lane-incident-validation.ts:localRouteContact` / `earlierIncidentContact`, `shared-lane-route-validation.ts:validateRouteSeparation`, et l'oracle `bridge-oracle.ts:routeBridgeAnalysis` / `bridge-contact.ts:unbridgedContacts`.

**Changement.** Pour les contacts entre routes, remplacer les règles locales par l'analyse des ponts validés et `unbridgedContacts`. Le premier essai conserve la politique sans pont ; un candidat croisé n'est admissible qu'après validation d'un croisement strict par le même oracle, avec la préférence pont/détour issue des seuils acquis et du témoin réel 2B lorsqu'il existe une alternative de détour. Un croisement géométrique n'est pas à lui seul une preuve de pont.

L'oracle actuel retourne un point de contact, ce qui ne suffit pas à distinguer un raccord ponctuel au port d'un chevauchement colinéaire qui commence à ce même point. Faire porter au résultat de `unbridgedContacts` la distinction point/étendue nécessaire ; n'exempter que le point d'attache explicitement autorisé. Retirer `pathsTouchWithoutBridge`, `routesCross` et `segmentsContact` de la décision de contact **entre deux routes**. Si la vérification d'auto-intersection d'une route a encore besoin d'un test segmentaire, la garder séparée, strictement auto-locale, et ne pas en faire une seconde règle inter-routes.

**Acceptation observable.** Tests de comportement : un incident de feuille dont le seul conflit est un croisement strict rendu par un pont est sélectionné ; un contact en T, un recouvrement colinéaire, un pont sans dégagement, un pont manquant et un contact au-delà du point d'attache restent rejetés avec diagnostic. Les tests falsifient aussi l'invariance par permutation des routes et la distinction raccord ponctuel/recouvrement. Fuzz des propriétés des incidents dédiés et de lanes (`region-leaf-incident-solver.property.test.ts`, `shared-lane-bridge.property.test.ts`) et du pont. La scène montre les arcs que l'oracle a validés, pas un contact simplement toléré.

**Rendu et portes spécifiques.** Oui : l'état auparavant `unknown` peut devenir une route validée. E2E Chromium sur `region-lane-leaf-preview.spec.ts`, `shared-lane-passage-preview.spec.ts` et le parcours visuel affecté ; `test:performance` vérifie le coût supplémentaire de l'analyse des runs.

**Risque / invariant.** L'ensemble de routes analysé doit être celui de la candidate, avec les identifiants de relation réels, pour que le porteur du pont reste déterministe. Les attaches au nœud, les contacts T, les recouvrements et l'opacité restent des contraintes dures ; aucune marque de pont n'est persistée.

### 3. Ajouter les gouttières horizontales des grilles

**Prérequis.** 1A, 1C et 4B sont clôturés. 1A/1C fournit la recherche déclarée et son témoin, 4B la capacité par charge réelle ; cette étape n'ajoute pas une seconde politique d'allocation.

**Départ.** `grid-cell-crossing.ts:gridRoutingEdges` / `GridRoutingEdges`, `grid-cell-crossing-allocation.ts:crossingAllocationPhases`, `grid-cell-crossing-routing.ts:crossingEndpoint` / `crossingRoute`, puis `grid-cell-layout.ts:routePlacedGridCellDisposition` et `grid-cell-disposition.ts:layoutGridCellDisposition`. Le diagnostic déjà déclaré est `GridRowGutterMissing`.

**Changement.** Publier une arête de gouttière horizontale par séparation de rangées, détenue par la grille, et la réserver dans la disposition comme les gouttières de colonnes. Les traversées entre rangées utilisent un chemin dans les ressources possédées par la grille (gouttières, rails et bus) ; elles ne traversent jamais l'intérieur d'une cellule étrangère. Les traversées d'une même rangée gardent leur chemin courant. La charge réelle de chaque gouttière détermine sa capacité ; les candidats gardent l'ordre de phases, les budgets et les témoins de 1A/1C. Lever `GridRowGutterMissing` uniquement si un chemin déclaré manque réellement, et le falsifier par un test.

**Acceptation observable.** Ajouter des témoins de grille 2 × 2 et N × M portant une relation de rangée à rangée, y compris traversées de rangées non adjacentes, sens de layout inversé et obstacle de cellule ; vérifier les portails, la propriété des segments, l'absence de pénétration et la route affichée. Une propriété fuzz couvre les allocations de gouttières par charge, les permutations et le miroir rangée/colonne. Les grilles sans traversée entre rangées et les traversées existantes de même rangée gardent leurs empreintes ; seules les sorties réellement modifiées sont consignées.

**Rendu et portes spécifiques.** Oui, c'est un nouveau chemin de route visible. E2E Chromium sur `grid-cell-preview.spec.ts` et `visual-tests.spec.ts`, plus fuzz de `grid-cell.property.test.ts`. `test:performance` conserve le budget strict.

**Risque / invariant.** Une gouttière horizontale n'est pas une nouvelle région ni un axe de rang partagé entre cellules ; chaque cellule continue de calculer son sous-layout local. Les anciennes routes restent identiques hors témoins qui exigent le passage de rangée.

### 4. Remplacer les limites de forme par des budgets de ressources mesurés

**Départ.** `region-composition-limits.ts:checkRegionLimits` / `checkRegionCrossingLimits` et `NESTED_REGION_COMPOSITION_LIMITS` ; `grid-cell-model.ts:envelopeFailure` (20 extrémités / 20 relations) ; `region-leaf-incident-solver.ts:MAX_INCIDENTS` ; les budgets de candidats de grille issus de 1A. Les valeurs 12 extrémités, 16 relations, 3 traversées, 8 enfants et 256 régions (registre n° 12, 13, 38), ainsi que l'enveloppe de grille 20/20 (n° 37), ne sont pas des résultats de mesure.

**Changement.** Profiler des compositions et grilles représentatives, des entrées adverses profondes/larges, les nouvelles gouttières et la recherche d'incidents. Compter le travail effectivement fait (branches/candidats générés et validés, contacts de runs comparés, pistes demandées, allocations temporaires et mémoire de pile) en plus du temps mesuré. Déclarer des budgets nommés avec limites calculées à partir de ce coût et justifiées par le profil ; borner le travail de recherche, pas le nombre d'enfants ou une forme de graphe. Remplacer les pré-rejets de cardinalité par l'épuisement explicite d'un budget, `ResourceLimit`/`unknown` et un témoin donnant coût, budget, exhaustivité et ressource épuisée. Garder les rejets structurels qui expriment réellement un contrat (par exemple, la politique de grille ne supporte pas les junctions) distincts des ressources.

**Acceptation observable.** Tests frontière au budget (juste en dessous, à la limite, dépassement), falsification des diagnostics codés, monotonie du compteur et fuzz de la composition, de la grille et des recherches touchées. Une structure plus grande que les anciennes bornes est résolue si elle reste dans les budgets ; une forme coûteuse au-delà de la limite échoue de façon explicable. Les entrées déjà valides conservent leurs layouts et empreintes. `test:performance` établit et respecte les budgets sans assouplir `< 100 ms`.

**Rendu et portes spécifiques.** La levée de limites peut faire apparaître des scènes auparavant refusées : si c'est le cas, E2E Chromium pour les parcours correspondants et preuve des nouvelles routes ; pas d'E2E pour une seule modification de diagnostic sans rendu. Fuzz obligatoire. Aucun seuil de couverture, duplication ou performance n'est baissé.

**Risque / invariant.** Un nombre maximal de régions ou de relations rebaptisé « budget » resterait une limite structurelle : l'acceptation doit découler du travail effectivement consommé. Si une entrée épuise le budget, aucune scène partielle ou route ancienne n'est publiée.

### 5. Migrer la première allocation du moteur dédié, sorties inchangées

**Départ.** `layout-engine.ts:layoutWithDedicatedEngine`, `routing/layered-routing.ts:planLayeredRouting`, `routing/channel-routing.ts:routeOwnedChannel` / `assignRails`, `routing/rail-packing.ts:packRails`, face à `routing-resource-allocation.ts:RoutingEdge`, `RoutingTrackDemand` et `allocateNestedTracks`.

**Première tranche retenue.** Les rails transverses des `ChannelRun` dans `routeOwnedChannel` : leurs demandes ont déjà une étendue, un propriétaire de canal et une affectation en rails ; `packRails` est une allocation d'intervalles déterministe en O(n log n). C'est une frontière plus petite que le routage complet et chaque attribution peut être nommée comme ressource. Extraire une stratégie d'allocation d'intervalles sur le contrat d'arête commun, puis faire consommer ses pistes à `routeOwnedChannel` au lieu de muter `run.rail`. Garder exactement l'ordre de tri, le dégagement de contact, l'ordre des rails, le réemploi des intervalles disjoints et l'offset. Ne pas remplacer `packRails` par `allocateNestedTracks` : cette dernière affecte les pistes selon l'inclusion et ne réutilise pas une piste pour des intervalles disjoints ; ce n'est pas le même algorithme.

**Acceptation observable.** Les résultats `LayoutResult` sont strictement identiques sur chaque entrée du corpus différentiel, l'empreinte dense `indexed-route-materialization.test.ts` reste identique, et les tests de canaux/rails, ports denses, obstacles et `routing-resource-allocation.property.test.ts` passent. Ajouter une propriété sur les intervalles qui se chevauchent, le dégagement, le réemploi et le tie-break canonique. `test:performance` prouve que la migration n'entame pas le budget. Aucune empreinte n'est mise à jour pour faire passer cette étape ; une différence bloque et renvoie à la stratégie d'allocation.

**Rendu et portes spécifiques.** Non si l'identité est tenue ; donc pas d'E2E pour une migration sans changement visuel. Si une sortie change, arrêter la tranche : il faut une décision de rendu et une preuve dédiée, pas un nouveau snapshot opportuniste.

**Suite de migration, conditionnelle aux preuves.** Garder des tranches indépendantes et les mêmes oracles : (a) demandes de faces/ports dans `port-allocation.ts` et `reserve-node-routing.ts` ; (b) passages et conflits de corridors de `layer-passages.ts`, `routing-corridors.ts` et `graph-corridor-conflicts.ts` ; (c) canaux de groupes/jonctions puis sélection et matérialisation des routes. Chaque tranche ne démarre qu'après identité stricte de la précédente et doit démontrer son gain d'inspection, de cache ou d'assertion ; la phase 3 ne revendique pas la migration complète du moteur.

## Parallélisme et règles transverses

- L'étape 0 est le verrou de départ ; l'étape 1 vient ensuite, car son nouvel ordre modifie les sous-layouts qui servent aux validations de feuilles et de grilles.
- **Étapes 2 et 3 sont parallélisables après l'étape 1 et la clôture de leurs prérequis**, dans des worktrees distincts : étape 2 limitée aux validations/incidents de feuilles et aux contacts ; étape 3 aux ressources et routes `grid-cell-crossing*` / disposition de grille. Garder ces fichiers et leurs tests disjoints. Intégrer les deux avant de faire l'étape 4 ; elle doit mesurer leurs coûts combinés. Si la réalisation de la grille doit toucher les validateurs de feuilles, ce parallélisme tombe et l'étape 2 précède l'étape 3.
- L'étape 5 suit l'étape 4 : la limite de travail et son coût doivent être établis avant de déplacer une allocation du moteur dédié.
- Chaque étape conserve le contrat de composition, les propriétaires de segments, l'opacité, les identifiants stables, le calcul froid déterministe et l'égalité incrémental/froid. Pas de hint lié à l'historique local d'un collaborateur.
- Après chaque étape : `mise exec -- pnpm format:check`, `mise exec -- pnpm check:types`, `mise exec -- pnpm quality:fast`, puis fuzz des propriétés touchées. E2E Chromium local pour chaque étape qui change un rendu ; `mise exec -- pnpm test:performance` dès qu'un chemin chaud change. Rejouer la preuve combinée après fusion des worktrees parallèles.
- Les portes de couverture restent celles de la configuration : **98 % minimum**, jamais abaissées. L'objectif de 98,05 % est abandonné ; aucune garde n'est supprimée pour satisfaire un pourcentage. Le budget de performance existant reste strict à `< 100 ms`. Les limites de duplication, mutation, architecture et lint ne changent pas.
- Chaque changement de rendu a son commit et son entrée du journal avec la décision et les empreintes réellement modifiées. Les preuves de migration à sortie identique conservent les empreintes ; la preuve ne se réduit jamais à un test de câblage ni à un `toEqual` contre le même recalcul.

## Questions ouvertes

Uniquement les choix que les mesures ou les premiers résultats de code peuvent trancher :

1. **Quel budget de travail sépare énumération exacte et heuristique de rang ?** L'étape 1 le dérive du coût croisé candidats × évaluations et du test de performance ; la règle de qualité (croisements, puis déplacement documentaire) est déjà décidée.
2. **Quel chemin dans les gouttières dessert au mieux deux rangées non adjacentes, et dans quels cas le code doit-il lever `GridRowGutterMissing` ?** L'étape 3 l'arrête sur l'oracle d'opacité, les témoins N × M et l'allocation mesurée ; le besoin de passages horizontaux est acquis.
3. **Quelles unités et quelles valeurs de budget couvrent le coût réel sans rejeter une forme simplement par sa taille ?** L'étape 4 les calibre et falsifie les cas d'épuisement ; aucun des anciens nombres n'est conservé par inertie.
4. **Quelle tranche du moteur dédié suit la première ?** L'étape 5 mesure le coût et l'inspectabilité gagnés ; le choix se fait entre faces/ports et corridors, avant d'engager les groupes et jonctions. Toute extension conserve l'oracle d'identité, sauf décision de rendu séparée.
