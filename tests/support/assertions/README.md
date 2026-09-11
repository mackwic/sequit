# Assertions visuelles

Le module partagé est désormais [dans l’atelier](../../../src/app/workshop/visual-tests/assert-box.ts), pour être importé à la fois par les tests et par le contrôle visuel.

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

[Scénarios partagés](../../app/workshop/visual-tests/node-scenarios.test.ts), chacun exécuté dans les quatre directions :

| Scénario                        | Assertions                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| Un nœud de 100 × 60             | Rang 1, centré sur X et Y dans le rectangle du layout                                      |
| Deux nœuds identiques sans lien | Tous deux rang 1, centres alignés dans leur rangée, enveloppe centrée sur l’axe transverse |
| A → B                           | Rangs 1 et 2, B après A dans le sens du layout avec un espace positif                      |
| A → B de tailles différentes    | Centres alignés sur l’axe de progression                                                   |

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

- [Document Markdown + Svelte](../../../src/app/workshop/visual-tests/centered-chain.svx) : explication, code source importé, exécution et contrôle visuel optionnel.
- [Scénario TypeScript partagé](../../../src/app/workshop/visual-tests/scenarios/centered-chain.scenario.ts) : préparation des entrées et assertion, sans dépendance au DOM ou au Markdown.
- Le test automatique importe uniquement le scénario TypeScript et appelle `arrange()` puis `assert(layout)`. Il n’importe aucun composant Svelte, fichier `.svx` ou compilateur Markdown.
- Le contrôle visuel affiche les coordonnées du résultat testé. La simulation de décalage est locale à la page et ne modifie pas le scénario enregistré.
- La galerie exécute automatiquement chaque scénario à son affichage, puis à chaque changement de direction et à l’ouverture du contrôle visuel. Les commandes sont regroupées dans ce panneau ; le verdict reste visible sous le code. La direction est conservée entre les scénarios tant que la galerie reste ouverte. Une exécution déjà en cours n’est pas lancée en double à l’ouverture du panneau. Le dessin reste chargé uniquement lorsque le panneau est ouvert.
- Les rangs sont affichés dans les boîtes et les guides matérialisent leurs centres.
- Le sélecteur **Bias** transmet le biais au vrai calcul : `Top` / `Bottom` sur un axe vertical, `Left` / `Right` sur un axe horizontal. Le choix est conservé entre scénarios et lors d’un changement de direction compatible ; changer d’axe rétablit un biais compatible, du côté de départ de la nouvelle direction. Chaque scénario est aussi exécuté sans navigateur dans les huit combinaisons direction/biais. Les quatre cas actuels doivent passer avec les deux biais de leur axe.
- Les tests navigateur de cette page sont une vérification distincte de son interface, lancée uniquement via la commande E2E.
- Les liens `/atelier/lexique#…` des fiches `.svx` sont contrôlés contre les identifiants présents dans `docs/visual-language.md`. Ce test lit les fichiers comme du texte, sans compiler ni rendre le Markdown. Le test E2E vérifie aussi que le lien affiché ouvre effectivement le terme demandé.

Le support mdsvex est configuré dans Vite pour les pages de l’atelier. La configuration Vitest demeure indépendante ; la page ne fait pas partie du graphe d’imports des tests du scénario.
