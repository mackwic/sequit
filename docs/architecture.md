# Organisation des modules

Tout le code source vit sous `src/`. Les répertoires expriment les responsabilités et les dépendances, pas des applications SvelteKit distinctes.

```text
src/
  app/
    web/
      document/       Session applicative, exécution et assemblage Yjs
      projection/     Projection du document et déclenchement du layout
      ui/             Canvas, interactions, inspecteurs, thème et icônes
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
  support/            Builders, fixtures, scénarios et utilitaires partagés
```

Les sous-dossiers `e2e/` et `performance/` restent proches du module concerné, mais sont exclus de la suite web standard et exécutés par leurs commandes dédiées. Les tests Worker sont eux aussi isolés de la suite web. Les tests de types sont nommés `*.type-test.ts` et vérifiés par TypeScript.

## Frontières applicatives

`DocumentSession` et `LocalDocumentCommandGateway` exécutent et publient les commandes. Leurs contrats sont partagés avec les implémentations techniques dans `infrastructure/document`, afin que Yjs ne dépende pas d'une classe de l'application web. L'assemblage `yjs-document-session.ts` appartient à `app/web/document`.

La session collaborative reste regroupée avec son protocole et ses documents Yjs. Cette organisation n'introduit pas de moteur de synchronisation abstrait indépendant de Yjs.

`CanvasProjection` décrit les données mesurables, la publication des changements et la production du modèle visuel. Le produit et l'atelier fournissent chacun ce contrat. Le canvas ne dérive plus son interface du résultat d'ouverture d'un fichier TOML.

Le moteur de layout est synchrone et pur ; l'enveloppe asynchrone est dans `app/web/projection`. La mesure des éléments DOM et les brouillons, sélections, zooms et demandes de focus restent dans l'UI.

## Atelier et production

Il y a une seule application SvelteKit. En développement, `/atelier` charge dynamiquement les modules de `app/workshop`.

En production, `import.meta.env.DEV` élimine ces imports lors de la compilation et la route renvoie une erreur 404. Une petite entrée de route subsiste, sans le code de l'atelier. Le plugin `config/production-boundaries.ts` fait échouer le build si un module de `app/workshop` entre dans un chunk serveur ou navigateur.

Le changement des chemins du Worker ne change ni son nom Cloudflare, ni le nom de son binding, ni sa classe Durable Object, ni ses migrations.

## Vérification

Les commandes restent définies dans `package.json`, avec les versions de `mise.toml`. La couverture web exclut les sources Worker, qui conservent leur propre suite et leurs seuils. Les règles de qualité qui portaient sur les anciens chemins suivent les modules déplacés, y compris les générateurs de fixtures. Les déclarations Worker sont régénérées avec `pnpm types:collaboration`.
