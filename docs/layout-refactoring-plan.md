# Plan de refactoring du moteur de layout

Plan du 12 septembre 2026. Implémentation terminée et validée dans `codex/layout-workspace-refactor`, à partir de la référence `bb802744ed41219afe85f3f810a7dc2f02b1865c` (état applicatif `55c1bcf` et plan approuvé).

## Suivi de l’implémentation

- [x] Lot 0 : nouvel instantané sauvegardé, checkout d’implémentation et checkout de référence indépendants ; dépendances installées avec les versions épinglées.
- [x] Structure initiale des lots 1 à 4 : préparation commune, hiérarchie itérative, ordre d’assemblage explicite, géométrie possédée, placement et réservations séparés. Les parcours à un, deux et trois placements sont conservés.
- [x] Contrôle ciblé initial : 568 tests passent ; types et lint des fichiers concernés passent.
- [x] Lot 5, première partie : inspection et API asynchrone conservées ; directions d’import internes ajoutées ; exceptions ESLint du moteur supprimées ; chemins de mutation migrés.
- [x] Propriétés de durée de vie du workspace ; `quality:fast` passe (1 718 tests à cette étape). Un cas généré supplémentaire exerce maintenant deux croisements indépendants dans des groupes éventuellement imbriqués.
- [x] Comparaison différentielle complète, reprise après les optimisations finales de partage : 1 890 résultats identiques et 30 rejets identiques à la référence, inspection activée/désactivée et tailles décimales comprises ; 120 graphes et rangs complets également identiques.
- [x] Campagnes de performance et comparaison alternée archivées : 60/60 budgets snapshot, 59/60 budgets incrémentaux, avec un dépassement biparti préexistant encore ouvert.
- [x] `check` complet : format, types, qualité (1 722 tests), 128 tests navigateur et builds passent.
- [x] Périmètre confirmé : finaliser le refactoring et documenter le dépassement biparti préexistant ; sa remise sous 70 ms est hors de ce lot.
- [x] Mutation : 3 456 altérations, score de 84,26 % pour un seuil inchangé de 80 %. Le rapport conserve les sources exactes vérifiées.
- [x] Documentation finalisée et lot cohérent vérifié, prêt pour l’intégration.

Les premières références enregistrées avec `performance:record` sont conservées dans [layout-refactor-implementation](/Users/thomas/.codex/visualizations/2026/09/12/01a09564-f001-7b30-81d2-5b604d3b9e53/layout-refactor-implementation/baseline.json). Le moteur de référence passe 60/60 budgets snapshot. La campagne incrémentale de référence est complète, sans sources modifiées ni validation concurrente détectée, mais dépasse trois budgets sur la tranche 100–999 : `unbalanced-random` 5,02/5 ms, `wide-bipartite-layers` 135,68/70 ms et `group-relations` 15,20/5 ms. Ces dépassements ont précédé toute modification du moteur testé ; les seuils restent inchangés et doivent être réévalués sur la version finale.

La première comparaison snapshot, conservée comme étape intermédiaire, donne notamment, à 1 000 nœuds, `nested-subgroups` 83,22 → 5,43 ms, `shallow-groups` 4,18 → 2,83 ms et `group-relations` 3,82 → 3,34 ms. Les hausses observées sur certains autres profils ont ensuite été examinées par les séries alternées décrites ci-dessous ; le respect des plafonds ne suffit pas. La première mesure incrémentale après refactoring a été arrêtée après détection d’une validation concurrente dans le checkout principal : son journal est conservé, mais ses temps ne sont pas exploitables.

Le workspace possède actuellement une liste de placements de composantes réutilisée entre les phases. Il n’ajoute pas de bloc `scratch` générique inutilisé : les buffers restent près de leur algorithme, conformément à la condition de réutilisation utile du plan. Les métriques de rangées et la validation des mesures ont leurs propres modules courts (`row-metrics.ts`, `validate-measurements.ts`).

### Complément mesuré du lot 6

Les dépassements incrémentaux existaient dans la nouvelle référence, alors que le plan supposait tous les budgets verts. Le profilage a confirmé que les relations de groupes répètent le travail de construction, de tri et de parcours des mêmes voisinages. Un complément conserve les mêmes graphes et les mêmes rangs tout en partageant les données immuables : identifiants effectifs mémorisés par extrémité, listes d’adjacence partagées jusqu’à divergence, et parcours regroupé des parents qui ont exactement la même liste d’enfants dans une frontière topologique. Une relation propre à un membre détache son voisinage avant modification.

Les contrôles différentiels de ce complément comparent 120 graphes complets et leurs rangs, avec collections dans les deux ordres : ils sont identiques à la référence. Les cas comportementaux vérifient aussi qu’une dépendance ajoutée à un membre ne se propage pas aux autres. La campagne complète enregistrée pendant le créneau réservé est exploitable : sources inchangées et aucune validation concurrente détectée. Le budget incrémental `group-relations/100-999` passe de 15,20 à 4,20 ms pour un seuil inchangé de 5 ms ; le moteur seul passe de 3,82 à 2,24 ms à 1 000 nœuds. Ce complément ne change aucun budget ni aucune fixture de performance. Le layout continue à emprunter les index du graphe, sans construire un second graphe et sans arène numérique générale.

### Campagne après partage des voisinages

Les 60 budgets du moteur passent. La campagne incrémentale respecte 59 budgets sur 60 ; seul `wide-bipartite-layers/100-999` reste au-dessus de son seuil de 70 ms, à 122,46 ms contre 135,68 ms dans la référence. `unbalanced-random` revient sous 5 ms à 4,98 ms, avec très peu de marge. L’utilisateur a choisi de finaliser ce refactoring et de documenter cet écart préexistant. La remise du biparti sous 70 ms est donc hors du lot ; le seuil reste actif et la campagne incrémentale complète reste rouge sur ce cas. Un essai supplémentaire de regroupement des réservations a été esquissé dans le dossier d’expérience, sans être intégré ni revendiqué comme une amélioration vérifiée.

La comparaison alternée utilise le graphe et les rangs propres à chaque version, 20 échauffements, 21 séries de 3 appels, sur les 12 profils à 1 000 nœuds. Elle confirme notamment les gains des groupes imbriqués (81,27 → 5,00 ms), des relations de groupes (3,78 → 2,24 ms) et des groupes peu profonds (4,21 → 2,92 ms). Les médianes augmentent légèrement sur le profil biparti (+1,9 %), les composantes indépendantes (+2,6 %) et les jonctions (+0,7 %) ; ces petites variations ne sont pas présentées comme des gains. Les différences des médianes de campagne non alternée ne suffisent pas à attribuer une régression à la structure.

Les cinq échecs navigateur observés avec `check` ont été reproduits sur la référence sauvegardée. Les attentes de direction ont été corrigées pour suivre la progression logique enfant/parent ; le cas à 1 000 groupes imbriqués vérifie maintenant le document effectivement supporté ; le geste de connexion attend que sa poignée soit visible avant de prendre les coordonnées. Ces cinq cas passent après correction, sans modifier le comportement du produit ni les gardes de complexité du graphe. La campagne navigateur complète passe maintenant (128/128), ainsi que les builds et le reste de `check`.

## Décision retenue

Conserver l’algorithme couplé de placement et de routage, et l’organiser autour d’un **workspace propre à chaque calcul**, de données préparées réutilisables et de fonctions dont les responsabilités suivent le lexique.

Le workspace n’est ni un nouveau graphe complet, ni un solveur général, ni un singleton. Il emprunte les index du `LogicGraph`, possède les coordonnées qu’il modifie, et ne construit ses réservations de routage que si elles sont nécessaires. Les modules séparent les responsabilités ; ils n’imposent pas de copies entre les phases.

La première version conserve les `Map` et les objets géométriques ordinaires. Une conversion générale en indices numériques et tableaux typés n’est pas justifiée par les essais. Les tableaux de métriques de rangées et les algorithmes spécialisés restent adaptés à leurs usages.

## 1. Référence et essais réalisés

La référence expérimentale est le commit `d9798a4309ab3cfb20109fc3713fc57a8dff3d02`, sur `codex/layout-before-refactor-20260912-135932`. Elle contient les changements qui étaient non commités lors de la sauvegarde. Les expériences ont été faites dans une extraction indépendante de cet instantané, sans modifier le moteur du checkout principal.

Le dossier d’étude est [layout-refactor-study](/Users/thomas/.codex/visualizations/2026/09/12/01a09564-f001-7b30-81d2-5b604d3b9e53/layout-refactor-study/README.md). Il contient les prototypes, leur construction, les tests exploratoires, les mesures brutes et les journaux des commandes existantes.

Une inspection optionnelle du routage (`LayoutOptions.inspectRouting`, `RoutingInspection`) est apparue dans le checkout principal pendant l’étude. Le plan en tient compte, mais les chiffres ci-dessous concernent l’instantané sauvegardé, sans cette évolution. L’implémentation a donc figé une nouvelle référence, `bb802744ed41219afe85f3f810a7dc2f02b1865c`, incluant cette inspection ; les mesures du suivi en tête de document concernent cette référence récente.

### Prototypes

- **A — membres directs** : construire une table des membres directs de chaque groupe une fois par calcul.
- **B — préparation des groupes** : ajouter la mémorisation de la profondeur et du groupe racine.
- **C — géométrie possédée** : appliquer B et modifier sur place les boîtes internes lors des translations du moteur. Les mesures d’entrée restent intactes. Ce prototype ne réécrit pas toutes les opérations géométriques ni tous les placements.

Les trois variantes ont été comparées exactement à la référence sur les 60 cas de performance existants, les 8 configurations direction/biais et deux profils de tailles : **2 880 comparaisons**, toutes identiques. Les essais vérifient aussi que les entrées et les résultats d’appels précédents ne sont pas modifiés.

Un complément compose deux croisements indépendants avec des groupes, éventuellement imbriqués, et des tailles inégales : **32 situations, 96 comparaisons supplémentaires**. Ces situations passent bien par trois placements complets.

Le prototype C passe les **555 tests existants ciblés** du layout, de sa projection et des scénarios visuels, ainsi que les **60 tests officiels `test:performance`**. La référence passe également ces 60 tests. La campagne incrémentale complète, les E2E navigateur et les gates globaux de qualité n’ont pas été exécutés pour cette étude de conception. Les prototypes sont des essais, pas un lot prêt à intégrer.

### Mesures exploratoires du moteur complet

Temps en millisecondes, à 1 000 nœuds. Préparation incluse à chaque appel ; 10 échauffements, 15 séries avec ordre des variantes alterné, 3 appels par série ; médiane des moyennes de séries. Les compteurs structurels étaient désactivés pendant ces mesures. Outils : Node 24.20.0 et pnpm 12.3.4.

| Scénario                  | Référence | A : membres | B : préparation | C : translations internes |
| ------------------------- | --------: | ----------: | --------------: | ------------------------: |
| Chaîne                    |     2,054 |       2,031 |           2,015 |                     1,988 |
| Groupes imbriqués         |    78,472 |      57,189 |           5,456 |                     5,306 |
| Groupes peu profonds      |     3,924 |       2,910 |           2,943 |                     2,901 |
| Relations de groupes      |     3,612 |       3,414 |           3,421 |                     3,332 |
| Couches biparties larges  |    98,057 |      95,518 |          97,730 |                    97,617 |
| Composantes indépendantes |     2,013 |       2,061 |           2,079 |                     2,043 |
| Nombreuses jonctions      |     3,571 |       3,652 |           3,626 |                     3,615 |

Ces chiffres montrent une opportunité nette sur les groupes imbriqués. Ils ne démontrent pas un gain universel : de petites hausses existent sur les composantes indépendantes et les jonctions. Les tables inutiles doivent être évitées sur les graphes sans groupe, puis la comparaison doit être reprise sur l’implémentation finale. Le cas biparti dense reste particulièrement sensible : son budget du moteur est de 100 ms.

Le comptage séparé observe **2 000 000 visites d’éléments** pour retrouver les membres directs dans le cas à 1 000 groupes imbriqués, et **110 000** dans le cas à 100 groupes peu profonds. L’index direct évite ces recherches répétées ; la préparation des ancêtres évite les remontées répétées dans la hiérarchie.

Un essai distinct a comparé trois translations de 1 000 boîtes, création du stockage et conversion de sortie incluses : copies successives, **0,214 ms** ; objets possédés et modifiés localement, **0,078 ms** ; indices et quatre `Float64Array`, **0,121 ms**. C’est un test limité de stockage, sans parcours de relations. Il suffit à écarter l’hypothèse « les tableaux typés sont nécessairement meilleurs », pas à condamner leur usage dans un futur noyau numérique mesuré.

## 2. Contraintes relevées avant le refactoring

### Le nombre de placements dépend de la situation

`prepare-node-layout.ts` effectuait :

1. un placement initial, puis la recherche des couloirs avec inversion ;
2. aucun autre placement si ces couloirs sont absents ;
3. sinon, une allocation des quais et un deuxième placement avec les dimensions agrandies ;
4. une réservation de rails depuis ces positions transversales ;
5. une translation des rangées pour les nœuds ordinaires seuls, ou un troisième placement complet en présence de groupes ou de jonctions.

Le parcours fréquent sans couloir croisé doit conserver un seul placement et ne pas payer la préparation d’un solveur de routage complet. Le refactoring ne doit pas introduire de boucle « jusqu’à convergence ».

### Plusieurs ordres et plusieurs découpages coexistent

- Les rangs logiques viennent de `topologicallyRank` ; ils ne dépendent pas du biais.
- L’ordre documentaire est explicite, et intervient dans les rangées et dans l’ordre des composantes.
- Les composantes de placement utilisent les adjacences du graphe des éléments classables.
- Le réassemblage après calcul des contenants utilise les relations documentaires et les appartenances aux groupes. Ce n’est pas le même découpage.
- Ce réassemblage dépend de l’ordre d’insertion des bounds, qui reflète le placement précédent. Le remplacer par une itération dans l’ordre des identifiants pourrait changer le dessin.

Le workspace doit rendre ces différences visibles. Il conserve un ordre de parcours explicite pour l’assemblage, distinct de l’ordre canonique utilisé pour produire le résultat public.

### Les rangées ont une portée locale et globale

Une composante contient ses propres rangées ordonnées. Cependant, les dimensions principales des bandes sont calculées globalement, et les rails réutilisés entre couloirs indépendants sont centrés entre les limites des rangées entières. Un workspace entièrement indépendant par composante ferait perdre cette coordination.

`EndpointRows` utilise aujourd’hui des tableaux indexés par rang, avec une collection ordinaire et une collection de jonctions. On peut introduire des types et noms de placement distincts sans modifier l’affectation actuelle. Le déplacement de rangée dû au biais, prévu par VL-606, reste une évolution fonctionnelle ultérieure.

### Les frontières déjà utiles restent en place

Le `LogicGraph` fournit déjà les relations et les index d’adjacence. On les emprunte au lieu de produire un deuxième graphe. Les relations effectives de groupes restent sous leur forme compacte ; aucun produit cartésien supplémentaire ne doit être matérialisé.

`crossing-aware-order.ts` est appelé par `document/topology-edit-ordering.ts`. Il ne doit pas devenir dépendant du workspace géométrique. Le refactoring ne transforme pas cette politique d’édition documentaire en permutation générale pendant le layout.

La projection web garde sa frontière asynchrone : préparation et calcul continuent à s’exécuter dans la continuation de la promesse. Les erreurs de mesures restent donc des rejets asynchrones.

## 3. Organisation cible des fichiers

Chemins relatifs à `src/lib/core/layout/` :

```text
layout/
  layout-engine.ts                 orchestration du calcul couplé
  layout-workspace.ts              types, propriété et durée de vie
  layout-types.ts                  mesures, options et résultat public
  layout-settings.ts               valeurs géométriques actuelles nommées
  build-layout-result.ts          résultat ordonné et dimensions finales
  crossing-aware-order.ts          politique existante, indépendante du workspace

  geometry/
    layout-frame.ts                axes, sens, biais et faces principales
    envelope.ts                    enveloppes et étendues transversales

  structure/
    prepare-layout.ts              préparation commune et raccordement au graphe
    group-hierarchy.ts             membres directs, profondeur, racine
    layout-components.ts           composantes et ordre d’assemblage
    placement-rows.ts              rangées et correspondance avec les rangs

  placement/
    prepare-measurements.ts        mesures initiales, effectives et invariantes
    validate-measurements.ts       validation des dimensions et en-têtes
    place-elements.ts              une exécution complète du placement
    place-component.ts             bandes, espacements et placement local
    row-metrics.ts                 métriques dépendant des dimensions
    center-related-rows.ts          règle actuelle de centrage, portée explicite
    enclose-groups.ts               contours calculés depuis les membres directs
    pack-components.ts             assemblage, réassemblage et marge extérieure
    expand-row-gaps.ts             propagation des espaces réservés aux rails

  routing/
    routing-corridors.ts            sélection des couloirs concernés
    quay-allocation.ts              réservations des faces et dimensions requises
    reserve-node-routing.ts         canaux, nombre de rails et espaces requis
    channel-routing.ts              contraintes de départ/arrivée et cycles
    rail-packing.ts                 coloration d’intervalles
    materialize-node-routes.ts      réservations vers points géométriques
    endpoint-routes.ts              routes simples et attaches aux groupes
    route-quay-anchors.ts           application des quais aux autres attaches

  inspection/
    routing-inspection.ts           données explicatives optionnelles
```

Ce découpage a été réalisé par extraction des responsabilités. Les petits auxiliaires restent près de leur usage, sans réexports en cascade ni dossier `result/` pour un seul fichier.

### Correspondance avec les anciens fichiers

| Ancien code                                            | Destination et rôle                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `dedicated-layout-engine.ts` : `preparePlacement`      | `structure/prepare-layout.ts`, aidé par la hiérarchie et les composantes                      |
| Même fichier : `endpointSize`, `relationGroupRankGap`  | `placement/prepare-measurements.ts` ; préparer les mesures invariantes une fois               |
| Même fichier : `placeGraph`                            | `placement/place-elements.ts`, qui appelle le placement local, les contenants et l’assemblage |
| Même fichier : `groupMemberBounds`, calcul des groupes | `group-hierarchy.ts` pour la sélection, `enclose-groups.ts` pour la géométrie                 |
| Même fichier : `repackContainmentComponents`           | appartenance préparée dans `layout-components.ts`, déplacement dans `pack-components.ts`      |
| Même fichier : `createLayoutResult`                    | `build-layout-result.ts` et matérialisation des routes                                        |
| `prepare-node-layout.ts`                               | séquence couplée dans `layout-engine.ts` ; déplacement final près du placement                |
| `component-layout.ts`                                  | `place-component.ts`, opérations d’axes dans `layout-frame.ts`                                |
| `align-row-branches.ts`                                | `center-related-rows.ts`, calculs d’étendue dans `envelope.ts`                                |
| `node-routing.ts`                                      | séparation entre réservation et matérialisation                                               |
| `dedicated-layout-geometry.ts`                         | géométrie d’enveloppe et routes d’extrémités, séparées par responsabilité                     |
| `routing-inspection.ts` en cours d’ajout               | inspection optionnelle, conservant le contrat public stabilisé                                |

`ordering/endpoint-order.ts` conserve son API indépendante. `placement-rows.ts` peut l’utiliser ; on ne déplace pas mécaniquement `deriveEndpointRows` si d’autres couches en dépendent.

## 4. Données, fonctions et propriété mémoire

### Un workspace par appel

Forme indicative, les types internes détaillés étant définis près de leurs modules :

```ts
interface LayoutWorkspace {
	readonly structure: LayoutStructure;
	readonly frame: LayoutFrame;
	readonly measurements: PreparedMeasurements;
	readonly placement: PlacementState;
	routing: RoutingState | undefined;
	scratch: LayoutScratch | undefined;
}
```

Le moteur crée cet objet et gère sa durée de vie. Il ne le renvoie pas au navigateur. `readonly` protège les références là où nécessaire ; cela ne remplace pas les contrats de propriété des collections.

| Zone           | Contenu                                                                                 | Propriété et utilisation                                                               |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `structure`    | références au graphe/rangs, composantes, rangées, membres directs et ordres de parcours | lecture seule pendant le calcul ; ne pas recopier les adjacences existantes            |
| `frame`        | axe principal, sens de progression, biais physique, faces d’entrée et de sortie         | petit objet constant par appel                                                         |
| `measurements` | mesures de contenu empruntées, mesures de groupes validées, dimensions effectives       | conserver l’original ; seules les dimensions effectives reçoivent la demande des quais |
| `placement`    | bounds possédés, métriques de bandes, étendues de composantes                           | écriture locale ; stockage géométrique faisant autorité                                |
| `routing`      | couloirs sélectionnés, offsets de quais, canaux planifiés, rails et espacements         | créé seulement si nécessaire ; réservations distinctes des routes finales              |
| `scratch`      | files, marques ou tableaux temporaires qui ont une réutilisation mesurée                | initialisation paresseuse ; aucune référence dans le résultat                          |

La version initiale ne contient pas à la fois une `Map` de bounds et quatre tableaux de coordonnées synchronisés. Ce serait deux sources géométriques à maintenir. Les petits tableaux par bande déjà utiles restent conservés.

Les mesures d’entrée de nœuds peuvent être référencées tant qu’elles sont lues. Avant toute mutation d’une boîte, celle-ci doit être construite et possédée par le calcul. Les objets readonly des entrées ne sont pas rendus mutables par une assertion de type. Un type interne `MutableBounds` matérialise cette propriété.

Le résultat peut recevoir la propriété des boîtes finales à la fin de l’appel, sans copie systématique supplémentaire, à condition que le workspace ne soit ensuite ni conservé ni réutilisé. Une éventuelle réutilisation de buffers entre appels imposerait un contrat de détachement différent ; elle ne fait pas partie de ce lot.

### Des fonctions ciblées, sans hiérarchie de classes

Pas de classe par boîte, rail ou groupe, ni de superclasse `LayoutObject`. Les objets métier, sélections géométriques et ressources de routage n’ont pas une relation d’héritage utile ici.

Seul l’orchestrateur voit le workspace complet. Les fonctions prennent des vues étroites, par exemple :

```ts
centerRelatedRows({ rows, parentsById, boundsById, frame });
encloseGroups({ hierarchy, groupMeasurements, boundsById });
reserveNodeRouting({ corridors, quays, boundsById, frame });
```

Ces vues sont des références, préparées au niveau d’une phase, pas des enveloppes d’objet créées pour chaque nœud. Les utilitaires de géométrie ne connaissent ni `LogicGraph`, ni le workspace, ni le routage.

### Le repère reste concret

Conserver `x`, `y`, `width`, `height` pendant la première migration. Extraire les opérations `mainSize`, `transverseCenter`, `translateTransversely`, les faces d’attache et l’alignement au biais. Cela suffit à rendre les règles lisibles sans convertir tout le pipeline vers un autre stockage.

Le sens des flèches est opposé à celui des rangs. La réflexion d’une position dépend de l’étendue principale de la composante concernée. Cette étendue est un argument explicite des conversions ; elle n’est pas une constante globale cachée dans le repère.

Les en-têtes des groupes restent physiques, en haut de leur rectangle, quelle que soit la direction du layout. Une rotation abstraite uniforme des contenants changerait ce comportement.

### Enveloppes et réservations

Une enveloppe est une mesure calculée en un parcours des membres sélectionnés. Un centrage transverse peut calculer uniquement un intervalle transverse. Pas de cache universel d’enveloppes ; seules les métriques effectivement réutilisées dans une phase sont conservées.

Les rails restent des affectations d’intervalles et les quais des réservations par face. Une route est une suite de points matérialisée ensuite. On ne maintient pas des ensembles de positions possibles pour tous les objets : les besoins actuels se décrivent avec des coordonnées, des minimums d’espace et les contraintes de canaux existantes.

## 5. Contrats entre les phases

| Phase                  | Lit                                                   | Écrit                                                                          | À recalculer ensuite                                         |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Préparation            | graphe, rangs, configuration                          | structure et métadonnées de groupes                                            | rien tant que ces entrées ne changent pas                    |
| Mesures initiales      | contenu et mesures des groupes                        | dimensions validées, dimensions principales des bandes, dégagement des groupes | placement                                                    |
| Placement initial      | structure, mesures                                    | bounds, enveloppes de groupes et positions globales                            | sélection des couloirs                                       |
| Quais                  | couloirs et positions initiales, relations incidentes | offsets par relation et dimensions transversales effectives                    | métriques transversales, centrages, contenants et assemblage |
| Deuxième placement     | même structure, dimensions effectives                 | géométrie utilisée pour réserver les rails                                     | plan de rails                                                |
| Rails                  | couloirs, quais et positions transversales            | canaux, nombre de rails, espaces requis par intervalle                         | positions principales et ancres                              |
| Placement final        | espacements réservés                                  | géométrie finale ; translation seule pour nœuds ordinaires                     | points des routes                                            |
| Matérialisation        | géométrie finale et réservations                      | routes et résultat public                                                      | rien                                                         |
| Inspection optionnelle | résultat, réservations et mesures d’origine           | explications détachées                                                         | aucun recalcul de placement                                  |

Les quais ne changent actuellement que la dimension transversale. Les maxima principaux des nœuds, les dimensions des jonctions et les dégagements liés aux mesures des groupes sont donc des candidats à préparer une seule fois. Leur réutilisation doit préserver les erreurs de validation et les valeurs actuellement calculées.

Les couloirs sont sélectionnés depuis le placement initial puis conservés. Refaire leur sélection après agrandissement, ou modifier cette stratégie pour chercher une meilleure solution, serait une évolution algorithmique distincte.

L’allocation d’une face tient compte de **toutes** les relations incidentes pertinentes, y compris les relations longues. Un index limité aux relations des couloirs voisins serait incorrect. Les index logiques effectifs du graphe ne remplacent pas automatiquement l’incidence des relations documentaires pour cette opération.

Les couloirs indépendants réutilisent les rails d’un même intervalle : les besoins se combinent par **maximum**, pas par somme. Leurs positions sont déterminées depuis les limites globales des rangées. Les canaux gardent l’ordre et les règles de départ/arrivée actuels.

Le troisième placement en présence de groupes/jonctions reste conservé. Son remplacement par une mise à jour des positions principales nécessite une preuve indépendante sur les contenants, jonctions terminales, directions inversées et dimensions inégales ; ce n’est pas un prérequis du refactoring.

## 6. Application du lexique et comportements à préserver

Le lexique fixe le sens des concepts ; les scénarios fixent où certaines règles doivent s’appliquer. Une fonction de centrage n’implique pas que tous les nœuds doivent être centrés sur leurs parents.

- **VL-117 / VL-311 / VL-606** : nommer séparément rang logique, rangée de placement et bande de jonctions. Conserver les indices internes à partir de zéro et les rangs humains à partir de un.
- **VL-105 / VL-310 / VL-506** : une sélection de centrage n’est pas un groupe documentaire. Préserver la règle actuelle de rangée homogène et les exemples où l’alignement entre boîtes prime sur le centrage individuel.
- **VL-204 / VL-205 / VL-220** : expliciter axe, direction et repère physique ; aucune dépendance au zoom ou au DOM.
- **VL-412 / VL-413 / VL-421 / VL-422** : séparer partage de tracés, réservation de rails, réservation de quais et ancres. Entrée et sortie n’ont pas les mêmes droits de partage.
- **VL-401 / VL-403 / VL-416** : les ponts et arrondis restent au rendu. L’inspection du plan n’est pas la preuve indépendante de l’absence de chevauchement ou de croisement des routes finales.
- **VL-517** : les relations vers un groupe s’arrêtent au contour du groupe.
- **VL-519 / VL-520** : mesurer les espacements entre les bords ; ne pas substituer un espacement de centres.

Les politiques gardent leurs valeurs actuelles : espacement des éléments, marges, dégagement des jonctions, quais et rails. Les valeurs répétées de 72 doivent être examinées selon leur rôle avant d’être réunies ; une constante commune n’est pertinente que si elle représente vraiment le même réglage.

Restent hors du refactoring à résultat constant : déplacement de rangée selon le biais, nouvelle permutation automatique, arbitrage général des centrages, optimisation globale du nombre de rails, extension des réservations aux groupes/jonctions/relations longues, layout incrémental persistant. Les obligations et préférences déjà décidées sont conservées, sans inventer l’arbitrage encore ouvert.

Les points des routes et leur ordre font partie de la comparaison. Le déplacement de code ne doit pas simplifier implicitement les points colinéaires ou les segments nuls : certains chemins actuels possèdent quatre points là où une autre branche en produit deux.

## 7. Lots d’implémentation

### Lot 0 — figer la référence de départ

Préserver l’instantané existant. Lorsque les changements simultanés, notamment l’inspection, sont stabilisés, créer un nouvel instantané de l’état réellement utilisé pour le refactoring, avec ses fichiers non commités si nécessaire. Travailler dans un checkout isolé construit depuis cet état.

Conserver les journaux des gates existants et les données de comparaison. Le harnais différentiel temporaire charge les deux moteurs uniquement depuis les tests ou le dossier d’expérience : aucun ancien moteur ne doit être embarqué dans la production.

**Sortie attendue :** référence identifiée, mêmes entrées pour les deux versions, erreurs/mesures/options incluses dans le contrat comparé.

### Lot 1 — expliciter la préparation commune

Extraire les types de workspace et `preparePlacement`, en empruntant les index existants. Créer l’index des membres directs et préparer profondeurs/racines par parcours de hiérarchie, sans remontées répétées. Préférer un parcours itératif pour les grandes profondeurs.

Préserver l’ordre de visite des membres et des groupes. Préparer les composantes d’assemblage en conservant l’ordre dérivé du placement. Éviter les tables de hiérarchie sur les graphes sans groupe. Ce lot peut être découpé en extraction pure puis optimisation, chacune comparable à la référence.

**Validation :** équivalence exacte ; groupes vides classables ou non, imbrications, collections réordonnées, composantes indépendantes. Profils `nested-subgroups`, `shallow-groups`, `group-relations`, et contrôle de cas sans groupe à 10, 100 et 1 000 nœuds.

### Lot 2 — géométrie possédée, repère et contenants

Introduire les types géométriques internes mutables. Extraire les opérations orientées, les enveloppes et `encloseGroups`. Appliquer les translations sur place uniquement aux boîtes possédées. Garder une seule représentation de coordonnées.

Normaliser les mesures de groupes une fois, sans perdre la distinction avec les mesures de contenu. Conserver les marges et les décalages physiques d’en-tête. Faire apparaître l’ordre d’assemblage au lieu de le laisser dépendre implicitement de l’itération d’un stockage remplacé.

**Validation :** résultats précédents inchangés après un nouvel appel ; entrées intactes ; quatre directions et biais opposés ; dimensions variables, groupes imbriqués et attaches aux groupes. Comparer allocations/coût complet si la réduction des copies est revendiquée.

### Lot 3 — rangées et règles de placement lisibles

Extraire `placeComponent` et ses métriques de bandes. Nommer les rangées locales et leur coordination globale. Conserver le centrage initial des rangées et la règle de recentrage homogène, mais rendre leur périmètre explicite dans les fonctions et tests.

Séparer préparation structurelle des rangées et métriques dépendant des dimensions. Les agrandissements transversaux des quais invalident ces dernières, pas les rangs ni les appartenances. Garder les formes de tableaux existantes tant que leur coût ne justifie pas une représentation clairsemée différente.

**Validation :** scénarios visuels de successeurs, descendants, chaînes indépendantes et centrages concurrents ; propriétés sur groupes/jonctions et ordre documentaire ; profils chaîne, arbre, composantes indépendantes et jonctions.

### Lot 4 — réservations et matérialisation du routage

Déplacer les algorithmes de canaux et coloration sans les réécrire. Séparer `planNodeRouting` de `applyNodeRouting`. Intégrer la séquence de `prepareNodeLayout` à l’orchestrateur et conserver les parcours à un, deux ou trois placements.

Rendre explicites les données conservées entre les étapes : couloirs initiaux, quais, dimensions effectives, réservations de rails. Recalculer uniquement les informations devenues périmées. La réutilisation des contenants préparés et des mesures principales doit être vérifiée sur les cas composés.

**Validation :** quais partagés et exclusifs, traits droits, cycles de contraintes, réutilisation locale des rails, tailles inégales, ajout/suppression, couloirs indépendants, groupes et jonctions. Profil biparti dense prioritaire. Aucun gain sur les groupes ne compense une régression reproductible sur ce profil.

### Lot 5 — résultat, inspection et frontières de modules

Conserver `LayoutResult`, la promesse de `layoutGraph` et l’option d’inspection stabilisée. Construire les explications uniquement lorsqu’elles sont demandées, depuis les données disponibles et les routes finales nécessaires à cette explication. Pas de snapshots profonds du workspace à chaque phase.

Garder les assertions visuelles indépendantes : elles observent la géométrie produite, même si la galerie affiche aussi les réservations. Vérifier que l’inspection activée ou désactivée donne la même géométrie.

Adapter les imports dans les tests et consommateurs. Ajouter les directions internes pertinentes dans `config/dependency-cruiser.cjs` : géométrie/types sans dépendance vers l’orchestrateur ; structure sans dépendance vers placement/routage ; utilitaires de canaux indépendants du workspace ; orchestration seule responsable du couplage. Éviter de déplacer les cycles dans un fichier central de types.

Retirer les exceptions ESLint du moteur et du composant devenues inutiles après extraction, sans en ajouter pour les nouveaux fichiers. Déplacer les chemins ciblés dans `config/stryker.config.json` avec tout le code précédemment muté : un refactoring de chemins ne doit pas faire disparaître la mutation de l’implémentation.

**Validation :** types, architecture, couverture/duplication et inspection ; comportement asynchrone et erreurs de mesures ; contrat des chemins mutés.

### Lot 6 — validation finale et comparaison

Une fois le comportement stabilisé, lancer successivement les deux gates de performance et `check` avant intégration, sans faire tourner les campagnes de mesure en concurrence avec les autres validations. `quality:fast` sert de gate local aux lots d’implémentation ; `check` l’inclut déjà, il est inutile de le relancer séparément juste avant. La mutation suit les commandes existantes avec les chemins mis à jour.

Archiver la comparaison par scénario et taille, puis retirer l’ancien moteur des fichiers d’expérience nécessaires à l’exécution courante ; conserver son commit pour consultation. Mettre à jour `docs/layout-routing.md` et la documentation d’architecture pour décrire le moteur final.

**Sortie attendue :** lot cohérent, toutes les exigences existantes respectées, comparaison de performance documentée, aucun ancien moteur ni instrumentation expérimentale en production.

## 8. Stratégie de validation et de performance

### Pendant chaque lot

1. Tester la règle ou le profil touché avec les scénarios existants.
2. Comparer les sorties complètes au moteur sauvegardé, avec les mêmes entrées et options.
3. Exercer l’immutabilité des entrées et l’indépendance de deux résultats successifs.
4. Mesurer les variantes séquentiellement, après échauffement, en alternant leur ordre. Inclure création du workspace et conversion finale.
5. Si une hausse dépasse la variabilité des séries et se reproduit, expliquer et corriger avant de continuer. Le simple respect d’un plafond ne suffit pas à conclure à l’absence de régression.

Les assertions de géométrie doivent rester indépendantes du code de calcul. Les nouvelles propriétés concernent les frontières réellement introduites : équivalence, propriété mémoire, indépendance de l’inspection et cohérence de phases. Ne pas tester chaque tableau intermédiaire uniquement pour figer l’implémentation.

### Campagnes existantes

Toutes les commandes passent par `mise exec --`.

| Commande                            | Ce qu’elle vérifie                                                        |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `pnpm test:web …`                   | tests comportementaux ciblés et propriétés concernées                     |
| `pnpm test:performance`             | 60 cas du moteur, médiane de 11 mesures après 3 échauffements             |
| `pnpm test:incremental-performance` | replays d’ajouts jusqu’à 1 000 nœuds, p95 du pipeline complet par tranche |
| `pnpm benchmark:layout`             | comparaison complémentaire du moteur avec le benchmark existant           |
| `pnpm check:types`                  | frontières et signatures après extraction                                 |
| `pnpm quality:fast`                 | lint, code inutilisé, architecture, couverture et duplication             |
| `pnpm test:mutation`                | sensibilité des tests, chemins migrés sans réduire le périmètre existant  |
| `pnpm check`                        | gate complet avant intégration, incluant navigateur et build              |

Les tests appelés « incrémentaux » rejouent aujourd’hui les éditions puis reconstruisent et recalculent le pipeline. Ils ne prouvent pas l’existence d’un moteur conservant son état entre deux éditions. Cette distinction doit rester dans la documentation et les comparaisons.

Les compteurs de travail, profils d’allocations ou traces temporelles expérimentales restent dans le harnais. Le `core` conserve son interdiction du temps, du DOM et des dépendances extérieures. Une limite de mémoire chiffrée ne sera pas inventée sans référence ; si le stockage est modifié, mesurer son coût au lieu de déduire les allocations des seuls temps.

## 9. Critères de réussite

- Les règles de placement se lisent avec le vocabulaire des rangées, enveloppes, quais et rails, et leur domaine d’application est explicite.
- La préparation stable est identifiable et partagée ; les parcours simples restent simples.
- Chaque donnée mutable possède un propriétaire et une durée de vie explicites.
- Les résultats géométriques, les ordres et les contrats publics restent identiques pour ce refactoring.
- Les scénarios et propriétés continuent à observer le pipeline réel indépendamment des décisions internes.
- Tous les budgets existants sont conservés ; les variations avant/après sont examinées par scénario. Exception de périmètre confirmée après mesure de la référence : le dépassement préexistant du biparti dense est documenté et reste actif, sa résolution étant hors de ce refactoring. Les 60 budgets snapshot et les 59 autres budgets incrémentaux passent.
- Les nouvelles frontières sont vérifiables mécaniquement, sans affaiblir lint, couverture, mutation ou duplication.

Le premier objectif concret est donc **d’extraire une préparation commune utile, puis de rendre la géométrie possédée et les règles explicites**. L’arène numérique générale et le solveur à possibilités restent des options futures qui nécessiteraient leurs propres mesures et contraintes.
