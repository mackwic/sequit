# Refonte du moteur de layout — phase 4 (notes, non démarrée)

Statut : **proposée, validée sur le principe par l'utilisateur le 27 septembre 2026, reportée faute de crédits.** Rien de ce document n'est implémenté. Point de départ : tête de clôture de la phase 3 sur `codex/layout-contract-generalization`.

## Intention

Deux idées de l'utilisateur, combinées :

1. **Modéliser le domaine** : le moteur jette la topologie typée du graphe (extrémités, relations résolues, hiérarchie de groupes en préordre) et la réinvente avec des ids, des booléens, des rectangles et des clés `JSON.stringify`. Au moins douze familles de défauts du registre en découlent.
2. **Phases explicites** : des contrats d'interface entre phases séparées (pas des IR publiées ni persistées), un dossier `shared/` pour les seuls types qui traversent une frontière, et la règle « une phase N importe seulement des phases antérieures et `shared/` ». Forme retenue : **B** (phases à l'intérieur du moteur dédié et de chaque domaine, orchestrateurs au-dessus).

Ordre décidé : modèle transversal d'abord, puis phases du moteur dédié avec leur modèle, puis adaptateurs et déplacements ; les changements de rendu (V4) seulement sur décision explicite.

## Décisions en attente de l'utilisateur (V4)

- **B1** : cadre de groupe couvrant deux rangées d'un canal (n° 43).
- **B2** : enveloppe de groupe sortie des couches, passages planifiés au lieu de la correction après placement (plus gros gain de lisibilité et de simplicité).
- **B3** : suppression des points colinéaires dupliqués dans les routes (cosmétique ; ré-épingle les 12 références et l'empreinte dense).

## Défauts connus à reprendre en priorité

### Relation groupe→groupe entre rangs adjacents (constaté le 27 septembre 2026)

- Défaut pour la phase 4. Quand deux groupes sont reliés et placés sur deux rangs adjacents, leurs cadres se touchent (écart nul) et la route groupe→groupe se réduit à un point : 4 points identiques, par ex. (686,240) dans `group-relations` et (174,240) pour deux groupes d'un seul membre. La flèche est donc invisible et le validateur la rejette (`route`) dans tout ordre, documentaire compris. On l'observe dès 1×1 membre et jusqu'à 7×7, ainsi que dans le scénario de performance `group-relations`, entre chaque paire de groupes consécutifs. Cause : `relationGroupRankGap` (`src/lib/core/layout/placement/prepare-measurements.ts`) ne réserve que la somme des coques des groupes qui contiennent les membres, et non l'écart libre `BASE_RANK_GAP` entre le bord d'une extrémité-groupe et l'autre extrémité. Correctif essayé : gap = max(existant, coques intérieures + BASE_RANK_GAP) quand une extrémité est un groupe. Avec lui, la route mesure 72 px et le layout est valide dans les 4 directions, un test rouge avant et vert après existait (1 et 7 membres, par `layoutWithRootRegion`), et avec 1 unité de budget les groupes 7×7 restent cherchés. Trois raisons de l'avoir annulé : (a) il modifie l'empreinte `dedicated-layout-identity` ; (b) `group-relations` à 1000 nœuds passe de ~4 ms à ~35 s en layout à froid (à 100 nœuds : 39,6 ms). L'écart global de rang multiplie donc un coût non linéaire à profiler avant tout correctif ; (c) il s'arrêtait au milieu d'un profilage.

- Après ce correctif seulement, imputer 1 unité de budget par relation groupe→groupe au lieu de |S|×|T|. Aujourd'hui, deux groupes de 7 membres (49 paires ≥ 45) sautent la recherche de toute leur composante. Sans ce correctif, 1 unité relance une recherche inutile : tous les candidats sont invalides, la sortie est `baseline-fallback`, et `group-relations` dépasse ses plafonds incrémentaux (50-99 : 6,63 ms pour un plafond de 5 ; 100-999 : 31,7 ms pour un plafond de 10).

- Conséquence actuelle : la relation groupe→groupe impute |S|×|T| paires au budget de rang ; deux groupes de 7 membres (49 paires) désactivent la recherche d'ordre de toute leur composante (falaise à 45 paires). La sélection d'ordre change pour tout document comportant une relation groupe→groupe depuis `a4999076`.

### Autres points ouverts

- Non-interférence générale des composantes sans jonction comportant des arêtes longues (réservation inter-composantes `reservedRoutes`).
- Combinaison gouttière de rangée + ordre de bus non canonique dans une même relation de grille (limite acceptée en phase 3).
- Coût incrémental `binary-tree/100-999` : chaque insertion refait un layout froid complet (~6 ms) ; plafond 9 ms sans marge.

## Modèle de domaine et plan en vagues (diagnostic du 27 septembre 2026)

# Diagnostic de modélisation du domaine du moteur de layout et préparation de la phase 4 (tête `6af4368f`)

**Sources.** `history://DiagDomainModel` et `DiagDomainModel2` ne contiennent que l'énoncé ; les deux sessions se sont arrêtées sans produire de résultat. Je n'en ai tiré aucune piste. Les scouts délégués ont échoué avec l'erreur « No model selected » : l'inventaire est donc de première main. Les chemins sont relatifs à `src/lib/core/layout/`. Ce diagnostic est en lecture seule : aucun test ni aucune modification.

**Constat principal.** La topologie typée existe déjà en amont du moteur, qui la perd dès son entrée :

- le graphe porte l'union `GraphEndpoint` et les relations résolues (`graph/create-graph.ts:14-35`) ;
- ses relations sont canoniques et uniques (`create-graph.ts:91-110`) ;
- `GroupHierarchy` fournit des intervalles préordre (`structure/group-hierarchy.ts:8-9`) ;
- une preuve nominale existe déjà (`routing/routing-corridors.ts:13-28`).

Pourtant `LayoutStructure` et `RoutingLayers` repassent à `string[]`, `Map<string, Bounds>` et `Map<string, number>` (`structure/prepare-layout.ts:12-22`, `layout-types.ts:116-120`), puis chaque phase réinterprète ces primitifs. On compte :

- 34 `endpointsById.get(` dans 19 fichiers ;
- 43 `bounds.get(` dans 21 fichiers ;
- 32 `JSON.stringify` dans 17 fichiers ;
- 82 `vertical: boolean` dans 38 fichiers ;
- 15 `extends Error` dans 8 fichiers.

## 1. Inventaire des primitifs porteurs de sens

1. **Majeur — l'extrémité est un id, et le groupe est traité comme un nœud.**
   - Déclaration : `LayoutRelation.from/to: string` et mesures par id (`layout-types.ts:15-19,37-42`).
   - Réinterprétations :
     - règles de port choisies par un `switch` sur le genre, où le groupe reçoit les règles d'un nœud (`routing/port-allocation.ts:14-24,80-82`) ;
     - « Shared faces … independently of endpoint kind » (`:287-296`) ;
     - le validateur fait de même (`dedicated-candidate-validation/ports.ts:47-54`) ;
     - une relation de groupe n'est conservée que selon la couche logique du groupe (`routing/routing-layers.ts:55-57`) ;
     - correction a posteriori puis exception `GroupRouteFailure` (`group-endpoint-routing.ts:253-293`) ;
     - le groupe est une boîte dans les lanes (`lanes/shared-lane-model.ts:16-21`).
   - Registre : n°21, 25, 26, 47, 57, 65, 66.
   - Chemin chaud : oui (ports, résultat).

2. **Majeur — le rang logique et la portée physique d'un cadre sont confondus.**
   - Les ids de groupes figurent dans `RoutingLayers.rows` (`structure/routing-layers.ts:6-33`), puis sont filtrés par `enclosingGroups` (« an envelope spanning its members, not a box on one physical layer », `routing/routing-space.ts:31-37`).
   - Une jonction est placée à son intervalle (`structure/prepare-layout.ts:57-58`).
   - Trois espaces d'index `number` coexistent : rang, couche de routage (`intervals`) et clé de gap (`routing/reserve-node-routing.ts:14-20`, `placement/place-elements.ts:19`).
   - `groupShellGap` ne traite que « commence dans le gap » et « finit dans le gap » ; un cadre qui couvre les deux rangées tombe dans `else return 0` (`routing/layered-routing.ts:186-209`). [INFÉRENCE] C'est vraisemblablement la cause du **n°43 ouvert**.
   - Le validateur ne construit des bandes que pour les nœuds (`dedicated-candidate-validation/layout-checks.ts:71-93`).
   - Registre : n°43, 44, 57.

3. **Majeur — `Bounds` ne dit rien de l'appartenance (ancêtre ou étranger).**
   - Six parcours d'ascendance réécrits :
     - `routing/group-passages.ts:20-33` ;
     - `routing/layered-routing.ts:242-248` ;
     - `grids/grid-cell-validation.ts:37-50` ;
     - `dedicated-candidate-validation/element-checks.ts:81-88` ;
     - `regions/validation/nested-region-leaf-incident-validation.ts:162-171` ;
     - `layout-checks.ts:138-142`.
   - Ils ignorent les intervalles préordre déjà disponibles.
   - L'appartenance est déduite de la géométrie (`inside(group, endpoint)`, `regions/leaf/region-leaf-incident-geometry.ts:250-252`) : ce raccourci excuse précisément la fausse appartenance visuelle du n°42.
   - Deux `inside` coexistent, avec l'ordre des arguments inversé et une stricte inclusion différente (`geometry/nested-region-geometry-primitives.ts:20`, `geometry/shared-lane-geometry-primitives.ts:39`).
   - Le cache est indexé par le JSON de l'ensemble des ancêtres (`group-passages.ts:59`) ; il a déjà produit une collision, corrigée par `940242a0`.
   - Registre : n°42, 43, 52, 57, 65.

4. **Majeur — `relationId` sert de clé d'allocation et d'incidence.**
   - Les grilles indexent leurs pistes par relation (`grids/grid-cell-crossing-allocation-types.ts:5-11`, `grid-cell-crossing-allocation.ts:74-76,90-92`).
   - Une incidence (relation × rôle) a quatre encodages :
     - deux maps `sourceOffsets` et `targetOffsets` (`port-allocation.ts:26-34`) ;
     - `incidenceKey` en JSON (`lanes/shared-lane-ports.ts:69-75`) ;
     - `JSON.stringify([relation.id, role])` (`regions/model/region-incident-contract.ts:114`) ;
     - `portKey(endpointId, from)` (`ports.ts:26-28`).
   - « Occurrence ≠ relation » n'est qu'un commentaire sur une `string` (`resources/routing-resource-allocation.ts:7-10`).
   - Registre : n°60 (levé pour les canaux seulement), 7, 9, 19, 39.

5. **Majeur — des clés sérialisées servent d'identité, y compris à partir de flottants.**
   - Famille de ports indexée par `JSON.stringify([owner, offset])`, avec un contournement NaN→null (`port-allocation.ts:262-276`), puis réutilisée comme `sharedTarget?: string` (`routing/channel-types.ts:3-9`).
   - Coordonnées converties en chaînes : `${x}:${y}` (`bridges/bridge-contact.ts:56,67,233`, `bridge-oracle.ts:125-130`, `routing/route-cost.ts:45`, `inspection/routing-inspection.ts:30`).
   - Ids synthétiques à séparateurs : `rank/rank-order-topology.ts:64`, `lanes/shared-lane-route-ranking.ts:63`, `shared-lane-ports.ts:33`, `'~root'` + `join('|')` (`prepare-layout.ts:32-36`).
   - Égalité d'allocations décidée par JSON : `grids/grid-cell-crossing-identity.ts:42-62`, `lanes/shared-lane-allocation-search.ts:44-46,105-111`, `contract/resolve-contract.ts:138`.
   - Registre : n°52, 4, 6, 41, 67.

6. **Majeur — comptes et exhaustivité portés par des champs indépendants.**
   - `total` a trois représentations : `number` (`search/bounded-search.ts:21-27`), `string` (`:73-79`, `shared-lane-route-candidates.ts:21-31`) et `bigint` (`grids/grid-cell-crossing-phases.ts:65`).
   - Exact ou LowerBound n'existe que pour la grille, par une convention budget+1 (`search/grid-cell-crossing-witness.ts:16-33`, `grids/grid-cell-crossing-search.ts:86-89`).
   - Champs redondants : `truncated: !exhaustive` (`bounded-search.ts:97-98`) ; `stop` + `exhaustive` + `truncated` dans le témoin de rang (`rank/rank-order-search.ts:42-91`).
   - La phase de grille porte quatre booléens (`attempted`, `exhaustive`, `truncated`, `selected`) ; son consommateur gère un état « Arrêtée » inatteignable (`GridCellAllocationExplorer.svelte:26-30` face à `grid-cell-crossing-search.ts:143-145`).
   - Le vocabulaire est inversé : `exhausted` signifie « budget refusé » (`bounded-search.ts:108-146`), `exhaustive` signifie « espace couvert ». S'y ajoutent `exhausted?: true` (`region-incident-contract.ts:53`) et `exhaustive?: false` (`region-composition-types.ts:49`).
   - Les compteurs sont mutables et remis à zéro par les appelants (`bounded-search.ts:121-176`).
   - On dénombre au moins 15 formes de témoin.
   - Registre : n°1, 2, 6, 36, 41, 56, 58, 62, 63, 68.

7. **Majeur — codes texte et exceptions de contrôle.**
   - `reason: string` apparaît 26 fois dans 14 fichiers ; `code: string` (`region-composition-types.ts:150-153`).
   - La provenance est un sac d'ids optionnels (`geometry/region-geometry-diagnostic.ts:73-82`, `dedicated-candidate-validation/types.ts:44-54`).
   - `RegionIncidentRole` est déclaré deux fois (`region-incident-contract.ts:7`, `region-geometry-diagnostic.ts:68`).
   - Des arrêts attendus passent par des exceptions : `GroupRouteFailure` est attrapée 5 fois dans `rank/`, plus `ExhaustedLeafAlternative`, `AllocationWorkExceeded`, `RegionWorkLimitExceeded` et deux `Uncacheable*Failure`.
   - Des messages sont concaténés (`regions/recursive/region-partial-composition-attempts.ts:111`).
   - Registre : n°10, 14, 24, 25, 34.

8. **Mineur — rôles et faces en vocabulaires multiples.**
   - Rôles : `RoutingPortRole` (entrant/sortant), `PortRole` (lanes), `RegionIncidentRole` (×2), `FoldedAttachmentRole`, et `from: boolean`.
   - Côtés : `RegionPortalSide`, `FoldedSideFace`, `LaneSide = -1|1`.
   - L'axe est recalculé depuis la direction (`ports.ts:49-50`, `layout-checks.ts:59-66`).
   - Deux demandes métriques de face coexistent (`port-allocation.ts:40-46` et `contract/metric-demand.ts:5-31`), discriminées par un test `'kind' in` (`:34`).
   - Registre : n°10, 26, 31.

9. **Majeur — la route est un simple `Point[]`.**
   - 42 occurrences dans 26 fichiers.
   - Au moins cinq parseurs de segments ; `routeRuns` **laisse tomber silencieusement** les segments diagonaux ou de longueur nulle (`bridges/route-runs.ts:61-64`). Autres parseurs : `nested-region-geometry-primitives.ts:55`, `lanes/shared-lane-route-validation.ts:204`, `contract/validate-candidate.ts:98`, `route-cost.ts:22`.
   - `bridge-contact-shared.ts:17-19` recalcule l'orientation déjà présente dans `RouteRun`.
   - Les générateurs émettent des points colinéaires (`routing/group-exterior-path.ts:35-52`), si bien que l'identité des octets diffère de l'identité dessinée (n°65).
   - Quatre sources de route avec une précédence implicite, puis une correction en place (`build-layout-result.ts:38-50,71`).
   - Registre : n°5, 33, 40, 45, 51, 65.

10. **Majeur — l'identité de chemin est une `string`.**
    - `RoutedPath.id` et `RouteRun.pathId` (`route-runs.ts:7-24`).
    - Deux modes d'identité coexistent : `pathId` ou `pathOrdinals` (`bridges/route-run-index.ts:64-78`).
    - Les homonymes ont été écrasés par une `Map` (`9ef5035b`).
    - `EndpointRoute {from?, to?}` encode le genre du morceau par des champs optionnels (`bridge-contact-shared.ts:6-10`).
    - Morceaux possédés (`region-composition-types.ts:98-102`) et id `${relationId}/${endpointId}` dans les lanes.
    - Registre : n°40, 60, 67.

11. **Majeur — la ressource n'a ni identité ni genre.**
    - `RoutingEdge {ownerId, capacity, spacing}` (`geometry/routing-edge.ts:2-8`).
    - `ownerId` mélange plusieurs espaces de noms : la région pour toutes les arêtes de grille (`grids/grid-cell-crossing.ts:52-61`), l'extrémité (`:115`), `${endpointId}/${side}`, `${ownerId}/gutter…` (`lanes/shared-lane-frame.ts:53-65`), `'@root/channel'` (`routing/channel-routing.ts:201`).
    - La capacité est mutée après allocation (`channel-routing.ts:188-193`) ; l'allocation réécrit `demand.rail` (`routing/channel-interval-allocation.ts:5-10,74`).
    - `FREE_TRACK = ''` sert de sentinelle (`grids/grid-cell-crossing-orders.ts:5`) ; une même map sert deux arêtes (`lanes/shared-lane-routing.ts:108-110`).
    - Une capacité de face est déclarée sans être appliquée (n°10).
    - Registre : n°7, 9, 10, 26, 31, 60.

12. **Mineur (chemin chaud) — le run de canal est un état mutable.**
    - Sentinelle `key: -1`, champs `rail`, `remaining`, `depth` (`channel-types.ts:15-24`).
    - Des coordonnées flottantes servent de clés (`bySource: Map<number, …>`, `channel-routing.ts:213-217`).
    - Chemin chaud : oui.

## 2. Modèle de domaine proposé

**Règles communes.**

- **Trois niveaux d'identité :**
  - ids documentaires marqués, pour les frontières entre graphes et régions et pour les clés de cache ;
  - handles objets `GraphEndpoint` / `GraphRelation` à l'intérieur d'un appel (motif existant) ;
  - index denses marqués pour les tableaux chauds d'une phase.
- **Contraintes de lint :**
  - membres d'union en interfaces nommées et discriminants en enums string (`config/eslint.config.js:151-153`) ;
  - aucune marque n'existe aujourd'hui : c'est une convention nouvelle, à introduire une seule fois dans `shared/identity` ;
  - constructeurs de marque par prédicat de type, et non par `as` (`no-unsafe-type-assertion`, `:88`).
- **Projection de `LayoutResult` :** elle reste inchangée. L'empreinte vaut `sha256(JSON.stringify(result))` (`tests/lib/core/layout/dedicated-layout-identity.test.ts:40-42`) : ni champ ajouté ni ordre de clés modifié.
- **Performance :** formes monomorphes sur les tableaux chauds ; `readonly` en production ; gel profond seulement en test.

**Identités.**

```ts
declare const relationTag: unique symbol;
export type RelationId = string & { readonly [relationTag]: true }; // idem EndpointId, GroupId, RegionId, LaneId
export function isRelationId(value: string): value is RelationId {
	return value.length > 0;
}
export type RelationIndex = number & { readonly [relationTag]: true }; // position canonique dans graph.relations
```

- Invariant : les ids ne sont construits qu'à `createGraph` ou à la normalisation des régions.
- État rendu impossible : un id synthétique concaténé (`rank-order-topology.ts:64`).
- Coût : nul.

**Extrémités et emprise.**

```ts
export enum FootprintKind {
	Box = 'box',
	Envelope = 'envelope',
}
interface BoxFootprint {
	readonly kind: FootprintKind.Box;
} // nœud, jonction, groupe vide ou replié
interface EnvelopeFootprint {
	readonly kind: FootprintKind.Envelope;
	readonly ranks: RankSpan;
	readonly members: readonly LayoutEndpoint[];
}
export type Footprint = BoxFootprint | EnvelopeFootprint;
export interface LayoutEndpoint {
	readonly id: EndpointId;
	readonly source: GraphEndpoint;
	readonly index: EndpointIndex;
	readonly footprint: Footprint;
	readonly ports: FacePolicy;
	readonly preorder: number;
}
```

- Invariants :
  - `Envelope` si et seulement si le groupe a des membres ;
  - une `Envelope` n'apparaît jamais dans une rangée ni dans une couche ;
  - `FacePolicy` (retrait, espacement) est fixée une seule fois.
- États rendus impossibles : groupe peuplé traité en boîte d'une couche ; jonction avec les règles d'un nœud ; relecture du genre par id.
- Coût : environ 1 000 objets construits une fois ; les 34 lookups deviennent des accès de champ.

**Cadres et appartenance relative à une route.**

```ts
export enum FrameRole {
	Ancestor = 'ancestor',
	Incident = 'incident',
	Foreign = 'foreign',
}
export interface Frame {
	readonly owner: FrameOwner;
	readonly bounds: Bounds;
	readonly subtree: PreorderInterval;
}
export function frameRole(ends: RouteEnds, frame: Frame): FrameRole; // O(1) par préordre
export enum GapSpan {
	Before = 'before',
	Enters = 'enters',
	Inside = 'inside',
	Exits = 'exits',
	Covers = 'covers',
	After = 'after',
}
export function gapSpan(frame: Interval, gap: Interval): GapSpan; // switch exhaustif (règle :92)
```

- Invariants :
  - le rôle se déduit de la hiérarchie, jamais de la géométrie ;
  - `Foreign` rend le cadre opaque (`docs/layout-engine-refactor.md:146`) ;
  - `Incident` ne franchit le bord qu'au portail ou à l'attache.
- États rendus impossibles : oublier le cas `Covers` ; déduire l'appartenance par `inside` ; indexer le cache par JSON.
- Coût : O(1) ; le cache est indexé par (groupe le plus profond de la source, groupe le plus profond de la cible).

**Faces, incidences et ports.**

```ts
export enum FlowRole {
	Source = 'source',
	Target = 'target',
}
export enum Side {
	Top = 'top',
	Bottom = 'bottom',
	Left = 'left',
	Right = 'right',
}
export interface Incidence {
	readonly relation: GraphRelation;
	readonly role: FlowRole;
	readonly index: IncidenceIndex;
} // 2·RelationIndex+rôle
export interface Face {
	readonly endpoint: LayoutEndpoint;
	readonly side: Side;
	readonly edge: RoutingEdge;
}
export enum PortKind {
	Slot = 'slot',
	Shared = 'shared',
}
interface SlotPort {
	readonly kind: PortKind.Slot;
	readonly face: Face;
	readonly slot: number;
}
interface SharedPort {
	readonly kind: PortKind.Shared;
	readonly face: Face;
}
export type Port = SlotPort | SharedPort;
export interface FaceDemand {
	readonly face: Face;
	readonly ports: number;
	readonly minimumCrossSize: number;
}
```

- Invariants :
  - l'offset se dérive de (slot, politique) et n'est jamais une identité ;
  - la famille de ports vaut exactement (face, slot) ;
  - la capacité de face est une arête et la seule règle de capacité (n°10).
- États rendus impossibles : clé flottante sérialisée ; quatre encodages de l'incidence ; deux demandes métriques.
- Coût : chemin chaud, 2 × 40 169 incidences. Des tableaux denses remplacent deux `Map<string, number>`.
- [INFÉRENCE] Cela supprime aussi la revérification O(n) du tri des relations (`port-allocation.ts:168-176`) : gain probable, à mesurer par une paire `performance:record/compare`.

**Runs et routes (identité, propriétaire, famille).**

```ts
export enum PieceKind {
	Complete = 'complete',
	Incident = 'incident',
	Owned = 'owned',
}
interface CompletePiece {
	readonly kind: PieceKind.Complete;
	readonly relation: GraphRelation;
}
interface IncidentPiece {
	readonly kind: PieceKind.Incident;
	readonly incidence: Incidence;
	readonly portal: Side;
}
interface OwnedPiece {
	readonly kind: PieceKind.Owned;
	readonly relation: GraphRelation;
	readonly region: RegionId;
	readonly ordinal: number;
}
export type RoutePiece = CompletePiece | IncidentPiece | OwnedPiece;
export interface Route {
	readonly piece: RoutePiece;
	readonly owner: RouteOwner;
	readonly points: readonly Point[];
}
export interface Run {
	readonly route: RouteOrdinal;
	readonly axis: Axis;
	readonly fixed: number;
	readonly low: number;
	readonly high: number;
	readonly forward: boolean;
}
export function routeRuns(
	route: Route,
	ordinal: RouteOrdinal,
	work?: WorkMeter,
): readonly Run[] | InvalidSegment;
```

- La famille de runs est une union nommée : famille de port (`SlotPort`) ou famille de canal (arête, occurrence).
- Invariants :
  - un seul parseur, qui refuse avec un type au lieu d'ignorer ;
  - l'identité dans un balayage passe par un ordinal ;
  - les homonymes sont distincts par construction.
- Les `points` restent identiques à l'octet près. La simplification des points colinéaires est un changement de comportement séparé (B3).
- Coût : deux champs internes par route, avec un objet propriétaire constant ; projection vers `{id, from, to, points}`.
- [INFÉRENCE] Les runs ne sont calculés qu'en validation, qui n'est pas exécutée sur wide/1000 sans changement local (`rank/rank-order-selection.ts:124-133`).

**Ressources.**

```ts
export enum EdgeRole {
	Channel = 'channel',
	ColumnGutter = 'column-gutter',
	RowGutter = 'row-gutter',
	TopBus = 'top-bus',
	RowBus = 'row-bus',
	Face = 'face',
	LaneGutter = 'lane-gutter',
	LaneExteriorRail = 'lane-exterior-rail',
	LaneTopExteriorRail = 'lane-top-exterior-rail',
	LaneInterior = 'lane-interior',
}
export enum CapacityKind {
	Declared = 'declared',
	DemandSized = 'demand-sized',
	Centered = 'centered',
}
export interface RoutingEdge {
	readonly owner: ResourceOwner;
	readonly role: EdgeRole;
	readonly ordinal: number;
	readonly capacity: Capacity;
	readonly spacing: number;
}
export interface TrackDemand {
	readonly occurrence: OccurrenceKey;
	readonly carries: readonly RelationId[];
	readonly start: number;
	readonly end: number;
	readonly order?: number;
}
export interface TrackAllocation {
	readonly edge: RoutingEdge;
	readonly tracks: ReadonlyMap<OccurrenceKey, Track>;
}
export function sameAllocation(left: TrackAllocation, right: TrackAllocation): boolean; // égalité en ordre canonique
```

- Invariants :
  - capacité connue avant allocation, sauf `DemandSized` déclaré explicitement pour les canaux ;
  - allocation pure, sans réécriture de la demande ;
  - une occurrence n'est jamais une relation ;
  - piste libre représentée par une union, et non par `''`.
- Pas de champ `axis` sans consommateur : knip le refuse (n°31).
- Coût : quelques arêtes par rang ou cadre. `ChannelRun` reste un état de travail local ; seule l'allocation publiée devient immuable.

**Comptes et budgets.**

```ts
export enum CountKind {
	Exact = 'exact',
	LowerBound = 'lower-bound',
}
interface ExactCount {
	readonly kind: CountKind.Exact;
	readonly value: bigint;
}
interface LowerBoundCount {
	readonly kind: CountKind.LowerBound;
	readonly value: bigint;
}
export type Count = ExactCount | LowerBoundCount;
export function countUpTo(total: () => bigint, limit: Budget): Count; // saturé à limit+1
export interface WorkMeter {
	take(units?: number): boolean;
	readonly spent: number;
	readonly limit: Budget;
	readonly owner: SearchOwner;
}
```

- Invariants : l'évidence reste privée, sans injection ni remise à zéro par l'appelant ; `total` n'a plus qu'une seule représentation.
- Coût : hors chemin chaud.

**Résultats de recherche et causes d'arrêt.**

```ts
export enum OutcomeKind {
	Selected = 'selected',
	Exhausted = 'exhausted',
	Truncated = 'truncated',
}
export enum SelectionProof {
	Optimal = 'optimal',
	FirstValid = 'first-valid',
	Bound = 'bound',
}
interface Selected<S, R> {
	readonly kind: OutcomeKind.Selected;
	readonly selection: S;
	readonly proof: SelectionProof;
	readonly explored: number;
	readonly space: Count;
	readonly rejected: readonly R[];
}
interface Exhausted<R> {
	readonly kind: OutcomeKind.Exhausted;
	readonly explored: number;
	readonly space: ExactCount;
	readonly rejected: readonly R[];
}
interface Truncated<S, R> {
	readonly kind: OutcomeKind.Truncated;
	readonly stop: StopCause;
	readonly explored: number;
	readonly space: Count;
	readonly incumbent?: S;
	readonly rejected: readonly R[];
}
export type SearchOutcome<S, R> = Selected<S, R> | Exhausted<R> | Truncated<S, R>;
```

- `StopCause` est une union nommée : Budget (propriétaire, phase, dépensé, limite) | Depth | ShapeEnvelope.
- Les rejets sont typés par code, avec une provenance propre à chaque code. Le texte vient de `describe(diagnostic)` à la projection.
- Les exceptions sont réservées aux invariants violés.
- Invariants, via les seuls constructeurs :
  - `Exhausted` impose un compte exact et `explored = value` ;
  - `Optimal` impose un parcours exhaustif ;
  - `Truncated` impose une cause.
- États rendus impossibles : `exhaustive` et `truncated` à la fois ; `stop: Complete` avec `truncated` ; l'état « Arrêtée » ; `exhaustive` avec `LowerBound`.
- Coût : hors chemin chaud ; valeurs au lieu d'exceptions.

## 3. Plan de migration en coupes franches

Chaque coupe est franche : ni alias ni ré-export.

**Protections de chaque coupe.**

- Empreintes à garder inchangées :
  - 12 SHA dédiées (`dedicated-layout-identity.test.ts`) ;
  - empreinte dense (`indexed-route-materialization.test.ts`) ;
  - 5 grilles (`grid-cell-layout-identity.test.ts`) ;
  - bus parent (`nested-region-parent-bus-order.test.ts`) ;
  - banc d'ordre (`rank-order-comparison.test.ts`) ;
  - corpus différentiel (`layout-differential-corpus.test.ts`), qui ne sert jamais de référence (golden).
- Checks automatisés : `published-layout-validation(.property)`, `layout-noninterference`, `layout-work-unit-bounds`, `bounded-search-witness-honesty`, `layout-workspace.property`, puis `quality:precommit` et `quality:fast`.
- Coupes touchant le chemin chaud : une paire de performance wide/1000.
- **Une empreinte modifiée arrête la coupe** : le changement relève alors des coupes de comportement B.

Tailles : S ≤ 5 fichiers, M de 6 à 20, L au-delà.

| Coupe | Contenu                                                                                                                                                  | Taille                                                            | Protection spécifique                                                                                                                                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0    | Scope `shared/` dans `dependency-cruiser` (n'importe que lui-même) ; convention d'identité                                                               | S                                                                 | architecture                                                                                                                                                                                                                              |
| M1    | Ids marqués ; `FlowRole` et `Side` uniques ; doublon `RegionIncidentRole` supprimé ; `RoutingPortRole` réservé à l'inspection                            | M–L mécanique (environ 35 src, 40 tests, codemod AST)             | Valeurs de chaînes identiques et non persistées : aucune occurrence dans `document/` ni `infrastructure/`. La clé de cache locale (`region-local-cache.ts:63`) reste inchangée.                                                           |
| M2    | `Count`, `Budget`, `WorkMeter`, `SearchOutcome` : d'abord `search/` et ses 10 appelants, puis chaque témoin de solveur                                   | M puis 5 × S–M (21 src, 4 composants `.svelte`, environ 24 tests) | Supprimer les implications devenues vérifiées par le type (`bounded-search-witness-honesty.test.ts:86-91,154-155,167`) et justifier ce relâchement ; conserver les bornes et la provenance. Adapter les data-attributes E2E de l'atelier. |
| M3    | Diagnostics typés ; exceptions de contrôle → valeurs                                                                                                     | M (environ 15)                                                    | Messages projetés identiques ; publication ; non-interférence                                                                                                                                                                             |
| M4    | `frameRole` par préordre ; suppression des 6 parcours et de la clé JSON ; `GapSpan` avec `Covers` = comportement actuel                                  | M (environ 10)                                                    | 12 SHA, dense, non-interférence, propriété group-junction. Si `region-leaf-incident-geometry.ts:252` change une sortie, basculer en B.                                                                                                    |
| M5    | 5a clés d'incidence (S) ; 5b table d'extrémités et fin des lookups de genre (M) ; 5c `PortProposal` en tableaux et `FaceDemand` unique (M, chemin chaud) | L                                                                 | 12 SHA, dense, paire de performance, grilles et lanes                                                                                                                                                                                     |
| M6    | `EdgeRole`, `Capacity`, occurrences ; `sameAllocation` au lieu du JSON ; allocation pure                                                                 | M (environ 15)                                                    | 5 grilles, bus parent, propriété d'allocation, 12 SHA                                                                                                                                                                                     |
| M7    | Pièces, propriétaires, parseur unique, ordinaux, clés numériques des ponts                                                                               | M–L (environ 20)                                                  | Propriétés `bridge-oracle(-index)`, publication ; points intacts                                                                                                                                                                          |
| M8    | Clés résiduelles, puis garde `no-restricted-syntax` sur `JSON.stringify` dans `layout/` (un seul module d'empreinte autorisé)                            | S                                                                 | lint                                                                                                                                                                                                                                      |
| B1    | Cas `Covers` (n°43)                                                                                                                                      | S                                                                 | Décision utilisateur, contre-exemple, journal                                                                                                                                                                                             |
| B2    | Enveloppe de groupe sortie des couches et passages planifiés au lieu de la correction a posteriori                                                       | L                                                                 | Décision utilisateur, ré-épinglage unique                                                                                                                                                                                                 |
| B3    | Canonicalisation des points colinéaires                                                                                                                  | S, mais 12 SHA et dense ré-épinglés                               | Décision utilisateur                                                                                                                                                                                                                      |

## 4. Articulation avec les phases

**Contenu de `shared/`, limité aux types qui traversent réellement les frontières.**

- `identity` : ids et index.
- `vocabulary` : `FlowRole`, `Side`, `Axis`, `LayoutFrame`.
- `topology` : `LayoutEndpoint`, `Incidence`, `Frame`, `FrameRole`, `GapSpan`.
- `faces`.
- `resources` (issu de `resources/`).
- `routes` : `Route` et `routeRuns`, issus de `bridges/route-runs.ts`.
- `search` : `Count`, `WorkMeter`, `SearchOutcome`, `StopCause`. `search/grid-cell-crossing-witness.ts` en sort vers `grids/`, car c'est un type de domaine.
- `diagnostics` : enveloppe et `describe`.
- `layout-types.ts` reste la projection publique.

**Hors de `shared/`.** Les contrats internes à un domaine :

- dédié : `Structure` (table d'extrémités, `RankSpan`) → `PlacementSnapshot` (bornes en lecture seule par `EndpointIndex`, cadres) → `PortProposal` / `FaceDemand`, boucle finie dans l'orchestrateur → `RoutingPlan` (arêtes, allocations) → `Route[]` → projection + `SearchOutcome` de validation ;
- lanes, grilles et régions suivent le même schéma ;
- contrat interdomaine : `LeafSolver(document local, incidences + Side[] autorisés) → SearchOutcome<LeafSolution, LeafRejection>`.

**Ordre global : entrelacé.**

1. Le modèle transversal sans dépendance de phase (M0–M4) passe d'abord : l'écrire après les phases obligerait à retyper deux fois les contrats.
2. Les concepts qui _sont_ des contrats de phase (M5, M6, M7) sont livrés avec la phase qui les produit.
3. Les déplacements de modules et les règles `dependency-cruiser` viennent en dernier.

**Plan unique de la phase 4, en vagues.** Chaque tranche passe les portes writer ; `quality:integration` et 3 mesures de performance entre les vagues.

- **V0 — série, 1 writer.** M0, M1 et le cœur de M2 (`search/` et ses 10 appelants, une coupe franche imposée par knip).
- **V1 — 4 writers, fichiers disjoints.**
  - (a) grilles et `search/` : M2 et M3, avec `GridCellAllocationExplorer` ;
  - (b) lanes, rang et contrat : M2 et M3, avec `SolverExplorer`, `ComposedExplorer`, `JointK32Explorer` ;
  - (c) `regions/**` et `root-region.ts` : M2, M3, plus M4 côté validation et feuilles de régions ;
  - (d) M4 côté dédié : `group-passages`, `layered-routing`, `element-checks`, `layout-checks`, `grid-cell-validation`.
- **V2 — 3 writers.**
  - (a) phases du moteur dédié, pas 1 et 2 de la proposition (instantanés et boucle ports → re-placement), avec M5 et la part canal de M6. Un seul propriétaire pour `layout-engine`, `layout-port-placement`, `structure/`, `placement/`, `routing/`, `build-layout-result`. Paire de performance obligatoire.
  - (b) M6 dans lanes, grilles et composition. Ce writer modifie `resources/` en premier ; (a) consomme ensuite.
  - (c) M7 : `bridges/`, routes de la validation dédiée, ids de routes des lanes, routes de validation des régions.
- **V3.**
  - (a) adaptateurs `LeafSolver` et contrat, pas 3 de la proposition (`contract/candidate-layout.ts:4-30`, `regions/leaf/region-leaf-layout.ts:5-8,93-100`) ;
  - (b) déplacements par domaine, 4 writers en parallèle, avec la règle « phase N importe les phases < N et `shared/` » (pas 4) ;
  - (c) M8.
- **V4 — série.** B1, B2, B3, chacun sur décision utilisateur, avec son entrée de journal et un seul ré-épinglage.

## Verdict

**Cause** : le moteur jette la topologie typée du graphe et la réinvente par des ids, des booléens et des clés sérialisées. Au moins 12 familles de défauts du registre en découlent.
**Remède** : trois niveaux d'identité et 8 concepts, sans coût mesurable sur le chemin chaud (marques et index denses) ; `LayoutResult` reste identique à l'octet près.
**Ordre** : modèle transversal (V0–V1), puis phases dédiées avec leur modèle (V2), adaptateurs et déplacements (V3), et changements de comportement seulement sur décision (V4).

## Carte des phases (diagnostic du 27 septembre 2026)

1. **Majeur — la carte n’est pas un pipeline unique.** Le répertoire compte environ 200 modules TS. Pour le moteur dédié : **normaliser** `structure/` et `root-region.ts` (`structure/prepare-layout.ts:12-22,52-102`; `root-region.ts:125-137`), **planifier/ordonner** `rank/` (`rank/rank-order-selection.ts:290-339`), **placer** `placement/` (`placement/place-elements.ts:16-29,62-67`), **réserver/router** `routing/`, `resources/` et `group-endpoint-routing.ts` (`routing/reserve-node-routing.ts:14-20,46-54`; `group-endpoint-routing.ts:240-282`), **matérialiser/valider** `build-layout-result.ts`, `dedicated-candidate-validation/`, puis `inspection/` (`build-layout-result.ts:54-95`; `dedicated-candidate-validation/validate.ts:17-49`). `layout-engine.ts:187-265`, `layout-port-placement.ts` et `layout-workspace.ts` sont de l’**orchestration**, non une phase. `geometry/`, `bridges/`, `search/`, `layout-types.ts` et `layout-settings.ts` fournissent des primitives/contrats transversaux ; `contract/` matérialise et compare des candidats dédiés (`contract/resolve-contract.ts:105-145`), `folded/` est un moteur spécialisé (`folded/folded-group-layout.ts:30-76`). Les domaines **lanes/** couvrent eux-mêmes modèle→ports→recherche→géométrie/validation (`lanes/shared-lane-layout.ts:308-336`), **grids/** modèle→ressources→cellules→routes/recherche/validation (`grids/grid-cell-layout.ts:94-129,139-156`), et **regions/** répartit ce cycle entre `model/`, `leaf/`, `composition/`, `validation/`, `recursive/` (`regions/recursive/nested-region-recursive-layout.ts:71-150`). Correction : cartographier ces sous-pipelines par domaine, pas déplacer chaque dossier actuel dans une tranche globale.

2. **Majeur — retours du flux nécessaires, mais imports inverses évitables.** (a) Les ports augmentent les tailles puis relancent le placement ; les corridors de groupes sont recalculés jusqu’à stabilisation monotone des demandes (`routing/port-allocation.ts:26-34,99-118`; `layout-port-placement.ts:21-29`; `routing/settle-group-corridors.ts:78-112`). **Nécessaire** : boucle finie pilotée par l’orchestrateur, avec proposition de demandes/ports et re-placement ; la boucle n’a pas besoin d’un import de `routing` vers `placement` (déjà interdit par `config/dependency-cruiser.cjs:124-141`). (b) Le rang évalue des layouts _complets_ puis les valide, restaure les éditions rejetées et reboucle (`rank/rank-order-selection.ts:124-205,290-339`) ; **nécessaire**, déjà injectable via `DedicatedLayoutEvaluator` (`rank/rank-order-search.ts:28-34`) : conserver l’injection au niveau orchestrateur, non faire importer au rang la matérialisation. (c) La composition descend récursivement vers les feuilles, qui recréent graphe/rangs et relancent moteur dédié ou lanes ; elle explore jusqu’à 64 compositions puis valide la géométrie composée (`regions/recursive/nested-region-recursive-layout.ts:71-90,135-182`; `regions/leaf/region-leaf-layout.ts:93-100,147-185`; `regions/recursive/region-composition-search.ts:94-95,130-155,225-264`). **Nécessaire** : orchestrateur récursif et solveurs de feuilles injectés/contractualisés. (d) Les ressources de grille sont calculées _avant_ disposition, et leurs allocations recherchées _après_ (`grids/grid-cell-crossing-resources.ts:19-48`; `grids/grid-cell-layout.ts:139-156`) : **nécessaire**, séparer demande/capacité préalable et allocation géométrique ultérieure. En revanche, `contract/candidate-layout.ts:4-30` et `regions/leaf/region-leaf-layout.ts:5-8,93-100` importent directement le moteur/solveur concret : couplage de localisation **accidentel**, à confiner dans des adaptateurs/orchestrateurs. Ce sont des cycles _d’exécution_, pas des cycles d’import autorisés (`config/dependency-cruiser.cjs:188-192`).

3. **Majeur — frontières `shared/` à rendre explicites, sans IR publiée.** Entrée→plan : `LogicGraph`, `TopologicalRanks`, `LayoutMeasurements`, `LayoutStructure` et ordre candidat (`structure/prepare-layout.ts:12-22`; `rank/rank-ordering.ts:6-11,30-35`). Plan→place : `LayoutStructure`, `LayoutFrame`, `PreparedMeasurements` (`placement/prepare-measurements.ts:9-15,125-149`; `placement/place-elements.ts:25-30`). Place→route : bornes et état de placement, `RoutingLayers`, `PortAllocation` (offsets, demandes métriques, tailles), puis `NodeRouting` (gaps/corridors) (`placement/place-elements.ts:16-23`; `layout-types.ts:116-120`; `routing/port-allocation.ts:26-34`; `routing/reserve-node-routing.ts:14-20`). Route→résultat/validation : routes, bornes et `LayoutResult`, puis `DedicatedCandidateValidationInput`/rejets typés (`build-layout-result.ts:14-21,54-75`; `dedicated-candidate-validation/types.ts:25-55`). Frontière récursive : `RegionCompositionModel`, contrats/solutions d’incidents, placements/portails/routes possédées et `RegionLayoutAttempt` (`regions/model/region-composition-model.ts:38-47`; `regions/model/region-incident-contract.ts:12-29`; `regions/model/region-composition-types.ts:34-47,56-68,121-127`). Mettre dans `shared/` **seulement les types effectivement traversants**, avec sous-espaces par domaine ; conserver les stratégies locales. Pour tester une phase sur entrée figée il manque surtout un _snapshot_ explicite de tailles/bornes/espaces et des propositions de re-placement : aujourd’hui `PreparedMeasurements.sizes`, `PlacementState.bounds` et `LayoutWorkspace.routing` sont mutables et partagés (`placement/prepare-measurements.ts:9-15`; `placement/place-elements.ts:16-23,123-124`; `layout-workspace.ts:7-14`). Le figer dans les tests, sans copie systématique en production. Pour la récursion, fournir ownership, contrats de côtés, budget et solveur de feuille comme entrées, non une nouvelle représentation persistée (`regions/composition/region-arrangement.ts:9-44`; `regions/recursive/region-arrangement-orchestration.ts:53-105`).

4. **Majeur — choix B, avec règle d’import non adjacente.** **A** (phases globales contenant `lanes/grids/regions`) donne un parcours uniforme mais disperse chaque domaine dans toutes les phases et rend malaisés les rappels récursifs et les ressources avant placement ; migrations estimées **5–7 lots mécaniques** sur ~200 fichiers/imports, puis **4–5 lots de conception** sur les boucles et adaptateurs. **B** (phases à l’intérieur du moteur dédié et de chaque domaine, `shared/` commun, orchestrateurs au-dessus) conserve les frontières existantes et `RegionArrangement` (`regions/composition/region-arrangement.ts:38-44`) : **2–4 lots mécaniques**, puis **3–4 lots de conception** pour isoler retours de ports, évaluation de candidats et feuilles. Règle depcruise : dans chaque domaine, `phase N → phases < N | shared/` ; _pas_ « N−1 seulement », car placement/route/validation consomment aussi graphe, mesures et primitives de phases non adjacentes (`build-layout-result.ts:14-21`; `dedicated-candidate-validation/types.ts:25-30`). Orchestrateurs/adaptateurs explicitement hors de cette règle, imports interdomaines déclarés, interdiction conservée des cycles ; remplacer progressivement la matrice actuelle (`config/dependency-cruiser.cjs:1-25,27-95,153-166`). Risques : modifier les ordres/identifiants de tracks (`resources/routing-resource-allocation.ts:5-20,54-71`), perdre les preuves/budgets de recherche (`rank/rank-order-search.ts:56-90`; `grids/grid-cell-crossing-phases.ts:18-32`), ou multiplier copies et recompositions ; conserver `LayoutResult` et l’empreinte de cache local (`regions/model/region-local-cache.ts:12-17,45-68,121-169`). `regions/` a des commits récents (`git log -5 --oneline -- src/lib/core/layout/regions`) : migrations de chemins à coordonner après stabilisation des contrats, sans réécrire simultanément sa recherche.

**Verdict —** B répond au découplage demandé sans prétendre à une IR publique.
**Règle —** imports vers toute phase antérieure et `shared/`, orchestration récursive séparée.
**Réserve —** préserver les boucles de calcul, l’ordre déterministe et les budgets avant les déplacements massifs.
