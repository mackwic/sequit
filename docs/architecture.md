# Organisation des modules

Tout le code source vit sous `src/`. Les répertoires expriment les responsabilités et les dépendances, pas des applications SvelteKit distinctes.

```text
src/
  app/
    web/
      document/       Session applicative, exécution et assemblage Yjs
      projection/     Projection du document et déclenchement du layout
      ui/             Canvas, interactions, inspecteurs, thème et icônes
      i18n/           Traduction de l'interface (code Paraglide généré, non versionné)
      examples/       Contenu d'exemple du produit
    workshop/
      runtime/        Commandes et adaptateurs expérimentaux
      tools/          Outils de manipulation
      fixtures/       Générateurs déterministes utilisés aussi par les tests
  workers/
    collaboration-worker/
      index.ts                Entrée du Worker
      collaboration-room.ts   Durable Object autoritaire
      room-storage.ts         Persistance Cloudflare
  lib/
    core/
      document/       Modèle, validation et transformations pures
      graph/          Résolution des relations, cycles et rangs
      ordering/       Ordre stable des éléments
      layout/         Calcul géométrique synchrone
    infrastructure/
      document/       Contrats de commandes, publications et erreurs de session
      toml/           Encodage portable du document
      collaboration/  Yjs, session réseau, protocole et autorisation partagés
      layout-report/  Contrat, validation et stockage des signalements de layout
  routes/             Points d'entrée SvelteKit fins
```

## Dépendances

- `core` ne dépend d'aucune couche extérieure. Ses calculs reçoivent leurs entrées explicitement ; ils ne lisent ni DOM, ni réseau, ni horloge, ni source aléatoire. Les mutations internes de collections temporaires restent possibles. `fractional-indexing` est la dépendance algorithmique autorisée.
- `infrastructure` dépend du core et de ses propres modules, jamais des applications ou des workers.
- `app/web` assemble le core et l'infrastructure. Ses composants et ses sessions peuvent être utilisés par l'atelier ; le produit ne dépend jamais de `app/workshop`.
- `app/workshop` est exclusivement destiné au développement. Ses opérations ne deviennent pas des commandes collaboratives du produit par leur seule présence dans le dépôt.
- Les workers utilisent `lib`, jamais `app` ou les routes web. Chaque worker possède son entrée, sa configuration et son contexte de types.
- Les routes assemblent les modules applicatifs et restent en dehors de leurs dépendances.

Ces directions, ainsi que les contraintes plus fines entre graphe, ordre, layout et codecs, sont définies dans `config/dependency-cruiser.cjs`. La règle ESLint locale `allowed-import-directions` lit cette même politique : elle vérifie les imports statiquement résolubles, y compris les types, réexports et imports dynamiques littéraux, dans TypeScript et Svelte. Les chemins relatifs et l'alias `$lib` sont normalisés avant vérification. Dependency-cruiser complète ce contrôle sur le graphe, notamment pour les cycles. Les interdictions d'effets courants dans le core sont également contrôlées par ESLint. Les tests de propriétés couvrent déterminisme et invariants.

## Traduction de l'interface

L'interface est traduite avec Paraglide JS. Le projet inlang (`project.inlang/settings.json`) déclare le français comme langue de référence et l'anglais ; les messages vivent dans `messages/<langue>/<zone>.json`, une zone par domaine de l'interface (`common`, `document`, `content`, `canvas`, `editing`, `collaboration`, `editor`, `diagnostics`, `feedback`), avec des clés `snake_case` préfixées par leur zone. Un test vérifie que chaque message appartient à une seule zone et que chaque langue traduit toutes les clés avec les mêmes paramètres.

Le code des messages est généré dans `src/app/web/i18n/paraglide/` par le plugin Vite, par `pnpm i18n:compile` (lancé à l'installation, par `quality:precommit` et par `check`) et par la configuration Vitest ; les options communes sont dans `config/paraglide.ts`. Seul `app/web`, et les routes, importent les messages : `lib` et les workers restent sans langue et produisent des codes ou des raisons typées, que l'interface traduit. Un message n'est jamais appelé au chargement d'un module, car la langue appartient à la requête : les tables statiques de libellés gardent la fonction de message et l'appellent à la lecture.

Côté serveur, `src/hooks.server.ts` résout la langue de la requête (cookie, puis `Accept-Language`, puis français) et l'inscrit dans `<html lang>`. Les tests Vitest utilisent la langue de référence (`tests/support/base-locale.ts`), et l'E2E un navigateur français, sauf dans les scénarios qui choisissent l'anglais.

## Tests

Les tests reflètent les responsabilités des sources, sans vivre dans les modules de production :

```text
tests/
  app/
    web/              document, projection, ui, acceptance et e2e
    workshop/         runtime, fixtures et e2e de l'atelier
  lib/
    core/             document, graph, ordering et layout
    infrastructure/   collaboration et toml
  workers/
    collaboration-worker/   Tests dans le runtime Cloudflare et contexte de types dédié
  routes/             Points d'entrée SvelteKit
  config/eslint/rules/ Tests des règles locales
  scenarios/visual/   Scénarios exécutables et fiches explicatives de tests visuels
  support/            Builders, fixtures, assertions et harnais partagés
```

Les sous-dossiers `e2e/` et `performance/` restent proches du module concerné, mais sont exclus de la suite web standard et exécutés par leurs commandes dédiées. Les tests Worker sont eux aussi isolés de la suite web. Les tests de types sont nommés `*.type-test.ts` et vérifiés par TypeScript.

Les scénarios visuels, leurs assertions et leurs fixtures appartiennent à `tests/`. Vitest et
`src/app/workshop/visual-tests` exécutent les mêmes scénarios. L’atelier conserve la galerie, les
réglages et les composants de présentation ; lui seul peut importer `tests/support` et
`tests/scenarios`, jamais les fichiers de lancement `*.test.ts` ou `*.spec.ts`. Cette permission
ne s’étend pas au produit, au core, aux workers ou aux autres modules de l’atelier.

Les fiches `.svx` restent voisines des scénarios et utilisent les composants de l’atelier. Le
catalogue TypeScript ne charge pas ces fiches, ce qui permet à Vitest de fonctionner sans UI.

## Frontières applicatives

Les sessions locale et collaborative implémentent la même interface `DocumentSession` et reçoivent les mêmes lots `SharedDocumentCommand`. `LocalDocumentSession`, dans `app/web/document`, exécute chaque lot avec `executeSharedCommands` sur un candidat détaché, puis fusionne sa mise à jour dans le `Y.Doc` ; le dépôt Yjs observe seulement le document et publie chaque transaction, locale ou distante. Les contrats de résultat et de session restent dans `infrastructure/document`, afin que Yjs ne dépende pas d'une classe de l'application web.

La session collaborative reste regroupée avec son protocole et ses documents Yjs. Cette organisation n'introduit pas de moteur de synchronisation abstrait indépendant de Yjs.

`CanvasProjection` décrit les données mesurables, la publication des changements et la production du modèle visuel. Le produit et l'atelier fournissent chacun ce contrat. Le canvas ne dérive plus son interface du résultat d'ouverture d'un fichier TOML.

Le moteur de layout est synchrone et pur : son résultat est une fonction des seuls inputs. L'enveloppe asynchrone est dans `app/web/projection`. La mesure des éléments DOM et les brouillons, sélections, zooms et demandes de focus restent dans l'UI.

Les listes d’adjacence du graphe sont en lecture seule. Une relation de groupe peut partager le même voisinage entre plusieurs membres ; une relation propre à un membre détache ce voisinage avant de le modifier. Les rangs regroupent les parents d’une même frontière qui partagent exactement leur liste d’enfants, en conservant le rang maximal et le nombre de parents traités. Le graphe, les rangs et les composantes conservent ainsi leurs résultats et leurs ordres sans répéter les mêmes parcours.

## Organisation du moteur de layout

`layout/layout-engine.ts` orchestre un calcul couplé de placement et de routage. Un `LayoutWorkspace` existe pour cet appel seulement : il emprunte le graphe et les rangs, conserve la préparation stable, puis possède les dimensions effectives et les boîtes modifiées. Aucun état géométrique ne survit pour être réutilisé par l’appel suivant, à une exception bornée près : une projection ouverte peut prêter au layout de sa racine dédiée un `ChannelRoutingCache` qu'elle possède, comme elle prête déjà son `RegionLocalLayoutCache` aux régions imbriquées. Ce cache rejoue le routage d'un canal seulement si toutes ses entrées exactes sont identiques, dans de nouveaux objets, et le résultat reste égal au calcul froid. Chaque layout racine y retient au plus 200 000 fils, routages réutilisés et nouveaux confondus ; avec ceux que garde encore le layout précédent, le cache n'en contient jamais plus de 400 000. Le cœur ne contient aucun état de module ; `layoutGraph` n'emprunte aucun cache.

La [cible de refonte par IR et régions](layout-engine-refactor.md) documente le découpage proposé, la boucle bornée entre routage et géométrie, les contrats de mémoïsation et le plan de migration. Elle décrit une cible ; le présent chapitre reste la description du moteur exécuté aujourd’hui.

- `structure/` prépare les composantes, les rangées et les membres directs des groupes. Le parcours itératif de la hiérarchie mémorise racines et profondeurs. Les composantes du graphe classable et celles de l’assemblage des contenants sont distinctes ; leur ordre de parcours est explicite.
- `geometry/` définit le repère physique, les translations des boîtes possédées et les enveloppes. Il ne connaît ni le workspace ni les décisions de placement et de routage.
- `placement/` valide les mesures, calcule les métriques de rangées et place les éléments. Chaque groupe peuplé y est un bloc rigide : son intérieur est placé et encadré d’abord, groupes libres compris, puis il occupe un seul emplacement dans les rangées de son conteneur, où les familles d’enfants sont centrées sur le membre relié ou sur le cadre du groupe visé. Aucune passe ne sépare les groupes après coup : les créneaux de rangées et de rails réservent les coques des cadres, et le débord d’un cadre au-delà de son rail est mesuré une fois placé, puis réservé là seulement où il rencontre un élément étranger. Les maxima principaux sont partagés globalement entre composantes ; les métriques transversales suivent les dimensions effectives.
- `routing/` sélectionne les couloirs, réserve les ports et les rails, puis matérialise les routes. La réservation et la production de points sont séparées.
- `build-layout-result.ts` assemble les résultats dans l’ordre canonique. `inspection/` construit les explications seulement si l’option est activée.

Seul l’orchestrateur importe le type complet du workspace. Placement et routage reçoivent les vues dont ils ont besoin et ne s’importent pas mutuellement. Ces directions internes sont contrôlées par la même politique d’import que les frontières applicatives. La politique d’édition `crossing-aware-order.ts` reste indépendante de la géométrie et du workspace.

Les mesures du contenu restent intactes ; l’agrandissement pour les ports remplace seulement les dimensions effectives. Les translations opèrent sur des boîtes construites pour l’appel. Le résultat en reçoit la propriété à la fin : il n’existe ni copie systématique entre phases, ni double stockage synchronisé des coordonnées. Les tests de propriété vérifient que deux appels, y compris avec inspection et mesures différentes, ne modifient ni leurs entrées ni un résultat précédent.

## Atelier et production

Il y a une seule application SvelteKit. En développement, `/atelier` charge dynamiquement les modules de `app/workshop`.

En production, `import.meta.env.DEV` élimine ces imports lors de la compilation et la route renvoie une erreur 404. Une petite entrée de route subsiste, sans le code de l'atelier. Le plugin `config/production-boundaries.ts` fait échouer le build si un module de `app/workshop` ou de `tests/` entre dans un chunk serveur ou navigateur.

Le changement des chemins du Worker ne change ni son nom Cloudflare, ni le nom de son binding, ni sa classe Durable Object, ni ses migrations.

## Vérification

Les commandes restent définies dans `package.json`, avec les versions de `mise.toml`. La couverture web exclut les sources Worker, qui conservent leur propre suite et leurs seuils. Les règles de qualité qui portaient sur les anciens chemins suivent les modules déplacés, y compris les générateurs de fixtures. Les déclarations Worker sont régénérées avec `pnpm types:collaboration`.
