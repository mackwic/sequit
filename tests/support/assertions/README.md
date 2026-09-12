# Assertions visuelles

Le module partagé est désormais [dans l’atelier](../../../src/app/workshop/visual-tests/asserts/assert-box.ts), pour être importé à la fois par les tests et par le contrôle visuel.

Cette version vérifie l’alignement, le centrage, l’ordre spatial des boîtes et les rangs logiques des nœuds. Les concepts de référence sont **boîte** (VL-302), **repère du layout** (VL-220), **alignement** (VL-505) et **rang** (VL-117) dans le [lexique](../../../docs/visual-language.md).

## API implémentée

```ts
AssertBox(a).isAlignedWith(b, { by: 'top' }).isAlignedWith(c, { by: 'centerX', tolerance: 0.001 });
AssertBox(a).isCenteredIn(layout.frame, { axis: 'both' });
AssertBox(layout.envelopeOf(['a', 'b'])).isCenteredIn(layout.frame, { axis: 'x' });
AssertNode(layout.getNodeById('a')).hasRank(1);
AssertNode(layout.getNodeById('b')).hasRank(2);
AssertBox(b).isAfter(a, { direction: layout.direction });
```

- Une boîte observée fournit un `id` et des `bounds` (`x`, `y`, `width`, `height`). La sélection de cette boîte reste extérieure aux assertions.
- Le résultat du scénario est un `VisualLayout` : `layout.getById('a')` retourne l’élément visuel de cet identifiant ou lève `Missing layout element: *[id="a"]`. Cette recherche exacte porte sur les boîtes et jonctions, pas sur les routes ; elle ne dépend pas du DOM. La classe conserve les coordonnées et routes du résultat du moteur.
- `top` compare les bords supérieurs ; `centerX` et `centerY` comparent les centres sur X et Y. Ce sont des repères physiques, indépendants de la direction du layout.
- `isCenteredIn` compare les centres sur `x`, `y` ou les deux axes. `layout.frame` est le rectangle du résultat calculé, à l’origine `(0, 0)`, avant zoom ou déplacement de la vue. `envelopeOf(ids)` mesure les bornes communes des seuls éléments sélectionnés.
- `isAfter` exige un espace strictement positif entre les bords dans le sens de progression. Il ne suffit pas de comparer les centres de boîtes qui pourraient se chevaucher.
- `getNodeById` ajoute le rang logique aux coordonnées observées. La harness numérote les rangs **1, 2…**, conformément aux scénarios discutés ; elle convertit les indices **0, 1…** du moteur et du lexique actuel, sans les modifier. Un rang logique ne suffit pas à établir une rangée visuelle : la chaîne `A → B` vérifie séparément le rang et l’ordre spatial.
- Chaque appel retourne le même objet d'assertions : la chaîne conserve **a** comme sujet, même après une comparaison avec **b**.
- La tolérance est absolue, en unités du layout. La valeur initiale de `0.001` est une convention numérique de cette harness, pas une décision produit du lexique. `0` impose une égalité exacte ; la borne de tolérance est incluse.
- Les géométries non finies, dimensions non positives et tolérances invalides sont rejetées.
- Le module ne dépend pas de Vitest ; un échec lève une erreur lisible par le test appelant.

Exemple de diagnostic :

```text
Box "a" is not aligned with box "below" by centerX: actual=70, expected=80, difference=10, tolerance=0.001 (layout units).
```

## Cas présents

[Tests de l'assertion](assert-box.test.ts) :

- bords supérieurs identiques avec des hauteurs différentes ;
- centres X identiques avec des largeurs et positions Y différentes ;
- chaînage conservant le sujet initial ;
- décalage de 10 unités et diagnostic détaillé ;
- bords gauches identiques mais centres différents ;
- grande largeur de référence (10 000 unités) : centres alignés et décalage de 10 unités détecté ;
- tolérance à sa borne, hors de sa borne et égalité exacte ;
- refus des entrées numériques invalides.

[Tests de layouts réels](../../app/web/projection/box-alignment.test.ts) :

- deux boîtes indépendantes de dimensions différentes avec un biais haut : bords supérieurs alignés ;
- une chaîne `A → B` en haut-bas avec des largeurs différentes : centres X alignés.

Les coordonnées attendues des petits cas sont calculées à la main. Ces tests peuvent donc détecter une erreur dans l'assertion elle-même. Les scénarios de layout vérifient ensuite le résultat du vrai moteur avec la même API.

Les dimensions de référence sont définies dans [layout-reference.ts](../fixtures/layout-reference.ts).

[Scénarios partagés](../../app/workshop/visual-tests/scenarios.test.ts), chacun exécuté dans les quatre directions :

| Scénario                        | Assertions                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| Un nœud de 100 × 60             | Rang 1, centré sur X et Y dans le rectangle du layout                                      |
| Deux nœuds identiques sans lien | Tous deux rang 1, centres alignés dans leur rangée, enveloppe centrée sur l’axe transverse |
| A → B                           | Rangs 1 et 2, B après A dans le sens du layout avec un espace positif                      |
| A → B de tailles différentes    | Centres alignés sur l’axe de progression                                                   |

Les trois cas de la famille **Successeurs et enveloppes** complètent ces premiers exemples :

- A → B et A → C : l’enveloppe B, C est centrée sur A transversalement ;
- A → B, A → C et A → D : l’enveloppe B, C, D est centrée sur A transversalement ;
- les mêmes relations, avec E isolé au rang 1 : E reste strictement à droite de cette enveloppe en layout vertical, ou strictement en dessous en layout horizontal.

Ces documents sont préparés en une fois, avec des boîtes de 100 × 60. Les contre-exemples vérifient le décentrage de l’enveloppe et le contact ou chevauchement de E avec son bord transversal.

Les contre-exemples déplacent les boîtes, décentrent l’enveloppe, inversent les positions ou changent un rang : ils doivent faire échouer l’assertion correspondante. Un test de propriété vérifie aussi le nœud seul sur 200 dimensions générées et les quatre directions. Il protège notamment contre le double ajout de marge extérieure trouvé par ces scénarios.

## Exécution ciblée

```sh
mise exec -- pnpm run test:web tests/support/assertions tests/app/workshop/visual-tests tests/app/web/projection/box-alignment.test.ts
```

## Suites possibles, à discuter

- Ajouter l'espacement minimal entre deux boîtes.
- Introduire `AssertRoute(...).isOrthogonal()` lorsque le premier test de route le demande.
- Compléter les repères d'alignement et les directions au fil des cas.
- Réutiliser les assertions dans des variations générées, puis produire des diagnostics dessinés.

Aucune règle générale de centrage des convergences n'est introduite ici. Les arbitrages entre centrage et croisements restent ceux du lexique et des scénarios validés.

## Documentation exécutable

Page locale : `/atelier/tests-visuels`.

- [Document Markdown + Svelte](../../../src/app/workshop/visual-tests/cases/nodes/centered-chain.svx) : explication, code source importé, exécution et contrôle visuel optionnel.
- [Scénario TypeScript partagé](../../../src/app/workshop/visual-tests/cases/nodes/centered-chain.scenario.ts) : préparation des entrées et assertion, sans dépendance au DOM ou au Markdown.
- Le test automatique importe uniquement le scénario TypeScript et appelle `arrange()` puis `assert(layout)`. Il n’importe aucun composant Svelte, fichier `.svx` ou compilateur Markdown.
- Le contrôle visuel affiche les coordonnées du résultat testé. La simulation de décalage est locale à la page et ne modifie pas le scénario enregistré.
- La galerie exécute automatiquement chaque scénario à son affichage, puis à chaque changement de direction et à l’ouverture du contrôle visuel. Les commandes sont regroupées dans ce panneau ; le verdict reste visible sous le code. La direction est conservée entre les scénarios tant que la galerie reste ouverte. Une exécution déjà en cours n’est pas lancée en double à l’ouverture du panneau. Le dessin reste chargé uniquement lorsque le panneau est ouvert.
- Les rangs sont affichés dans les boîtes et les guides matérialisent leurs centres.
- Le sélecteur **Bias** transmet le biais au vrai calcul : `Top` / `Bottom` sur un axe vertical, `Left` / `Right` sur un axe horizontal. Le choix est conservé entre scénarios et lors d’un changement de direction compatible ; changer d’axe rétablit un biais compatible, du côté de départ de la nouvelle direction. Chaque scénario est aussi exécuté sans navigateur dans les huit combinaisons direction/biais. Tous les cas du catalogue sont exécutés avec les deux biais de leur axe.
- Les tests navigateur de cette page sont une vérification distincte de son interface, lancée uniquement via la commande E2E.
- Les liens `/atelier/lexique#…` des fiches `.svx` sont contrôlés contre les identifiants présents dans `docs/visual-language.md`. Ce test lit les fichiers comme du texte, sans compiler ni rendre le Markdown. Le test E2E vérifie aussi que le lien affiché ouvre effectivement le terme demandé.

Le support mdsvex est configuré dans Vite pour les pages de l’atelier. La configuration Vitest demeure indépendante ; la page ne fait pas partie du graphe d’imports des tests du scénario.

## Ajouter un cas au cahier

Créer deux fichiers voisins dans `src/app/workshop/visual-tests/cases/<famille>/` :

- `<nom>.scenario.ts` exporte `scenario: LayoutScenario`, avec `id`, `label`, `group`, `order`, puis `arrange()` et `assert()` ;
- `<nom>.svx` importe ce scénario et son code avec `?raw`, explique la règle et affiche `VisualTest`.

Prendre `cases/nodes/single-node.scenario.ts` et `single-node.svx` comme exemple. `id` reste stable ; `label` et `group` définissent les libellés du cahier, `order` son ordre de lecture. Le dossier sert à ranger les fichiers ; le groupe affiché est défini uniquement dans le scénario.

Le catalogue commun découvre automatiquement les exports `scenario`. La galerie charge la fiche `.svx` correspondante à la demande et la suite `scenarios.test.ts` exécute chaque scénario dans les huit configurations direction/biais, ainsi qu’avec les paramètres par défaut. Aucun ajout à une liste de tests ou de navigation n’est nécessaire. Les tests de régression propres à une règle restent dans leurs fichiers dédiés.

`catalogue.test.ts` vérifie les identifiants uniques, les métadonnées et la correspondance exacte entre scénarios et fiches. Les fichiers `.svx` ne sont pas chargés par le catalogue TypeScript.

## Relations et composants indépendants

- `successors-and-independent-chain` vérifie la séparation stricte des enveloppes A–B–C–D et E–F, et le centrage transversal de F sur E.
- `shared-successors` spécifie A → C, A → D, B → C et B → D : centrage transversal des deux enveloppes, absence de tout tronc commun entre les quatre routes, croisement avec pont entre A → D et B → C.

Ce second cas est désormais satisfait : dans les couloirs de nœuds ordinaires où l’ordre source/cible est inversé, le routage coordonne les ancrages et les passages transversaux. Les routes sont distinctes et le rendu dessine les ponts. Les éventails et convergences sans inversion conservent leurs routes et leurs troncs communs.

Les assertions distinguent les niveaux du lexique :

- `AssertRoute(route).isOrthogonal().isAttachedTo(source, target)` vérifie une route calculée (VL-401) et ses ancrages sur les contours (VL-517).
- `AssertRoutes(routes).haveNoOverlap()` interdit tout recouvrement de longueur positive (VL-417), sans prétendre identifier un tronc intentionnel. Un point d’attache commun reste autorisé.
- `haveNoCrossing()` et `haveCrossing()` observent les intersections transversales à l’intérieur des tronçons, après regroupement des points colinéaires. Un raccord en T, un contact d’extrémités ou un recouvrement ne sont pas assimilés à un croisement.
- `haveNoCrossingWith(other)` et `haveNoOverlapWith(other)` comparent deux collections disjointes, sans imposer ces contraintes à l’intérieur de chacune.
- `AssertRenderedPaths(paths).haveBridgeAtEveryCrossing()` vérifie un pont à chaque croisement sur l’un des deux chemins concernés (VL-403/416). Elle lit les commandes absolues M/L/A actuellement émises par le canvas et repère les arcs semi-circulaires ; une autre syntaxe échoue explicitement. Pour exiger aussi l’existence d’un croisement, appeler `AssertRoutes(...).haveCrossing()`.

Les troncs communs restent autorisés dans les scénarios de deux et trois successeurs ; seule l’absence de croisements y est ajoutée. Le cas des deux parents et deux successeurs conserve son interdiction explicite de tout recouvrement. Le contrôle visuel utilise le rendu des chemins du produit.

## Convergences et croisements

Quatre fiches complètent le catalogue sans dupliquer la séparation de composants déjà couverte :

- `two-predecessors` : A → C et B → C, C centré sur l’enveloppe A–B ;
- `three-predecessors` : A → D, B → D et C → D, D centré sur l’enveloppe A–B–C ;
- `diamond` : A → B, A → C, B → D et C → D, enveloppe B–C centrée sur A et D ;
- `avoidable-crossing` : A → D et B → C, avec un ordre de déclaration A–B–C–D. D doit être en face de A et C en face de B ; la seconde rangée prend l’ordre transversal D–C.

Les quatre cas vérifient les rangs, la progression, le centrage transversal et l’absence de croisements dans toutes les configurations. Les troncs communs restent autorisés pour les convergences et le losange ; les deux routes indépendantes du cas de permutation ne doivent pas se recouvrir.

Pour les scénarios dont toutes les boîtes ont la même taille, `uniformNodeScenario` mutualise la préparation : la fiche TypeScript garde les identifiants de nœuds, la taille explicite, les relations et les assertions. Les scénarios à tailles différentes peuvent continuer à appeler `layoutNodes` directement.

## Rails et quais : spécifications à examiner

Neuf fiches dans `cases/routing/` utilisent le moteur réel, sans lui ajouter d’allocateur.
Chaque fiche est rejouée par le lanceur commun dans les quatre directions et les biais compatibles.

| Identifiant             | Comportement attendu                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| `default-quays`         | Quai entrant et sortant uniques, centrés, sans agrandissement.                  |
| `narrow-quays`          | Deux quais distincts : le besoin des quais agrandit le nœud.                    |
| `wide-quays`            | Le contenu suffit : aucun agrandissement supplémentaire.                        |
| `asymmetric-quays`      | Deux quais entrants et trois sortants : maximum des besoins des faces.          |
| `local-rails`           | Le corridor concerné grandit ; les autres intervalles restent identiques.       |
| `shared-quay`           | Une fourche partage un quai et des tronçons sur les deux axes.                  |
| `forced-crossing-rails` | Chemins distincts, pont, quais espacés et corridor agrandi.                     |
| `reused-rail`           | Deux fourches indépendantes utilisent des portions disjointes du rail 0.        |
| `released-rails-quays`  | Après retrait des diagonales : retour aux dimensions et à l’intervalle simples. |

Les mesures proposées pour ce cahier sont centralisées dans `fixtures/routing-fixtures.ts` et indiquées dans chaque fiche : pas des quais 48, marges 24 ; intervalle de base 72, pas des rails 24, marge des rails 12. Ce sont des attentes de test, pas des paramètres transmis au moteur. Leur calibration reste ouverte.

- `AssertQuays` observe les ancres distinctes sur une même face principale : nombre, centrage, espacement et marges.
- `AssertQuaySize` vérifie le maximum du besoin du contenu et de chaque face, sans additionner les deux faces.
- `AssertRails` observe les segments transversaux de longueur positive, leur nombre de coordonnées distinctes, leurs espacements et l’intervalle disponible. Il ne prétend pas lire une réservation virtuelle ou son numéro dans le moteur.
- `AssertTrunks` exige un segment de longueur positive partagé par tous les chemins d’une famille explicitement autorisée. Il ne décide pas quelles familles peuvent fusionner.
- `VisualLayout.withReference` conserve un dessin de référence pour une comparaison dans la même page. La suppression est spécifiée par les états avant/après ; le geste d’édition et l’undo ne sont pas couverts par cette comparaison.

Lors de l’ajout, `default-quays`, `shared-quay` et `reused-rail` passent. Les six autres échouent sur les espacements ou dimensions encore absents. Les assertions restent actives, sans `skip` ni inversion de verdict.

Les règles de partage dans un motif mixte (A vers B/C, E vers C) et la séparation d’un tronc pour franchir un autre chemin restent à préciser. Les scénarios présents utilisent les familles déjà convenues : fourche partagée, graphe biparti aux chemins distincts.
