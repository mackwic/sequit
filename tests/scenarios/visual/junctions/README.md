# Jonctions sur les rails : spécification visuelle

Ce lot traduit les décisions de la discussion du 12 septembre 2026. Les assertions sont actives : un écart du moteur doit rester un échec, sans `skip`, `todo`, échec attendu ni correction des coordonnées dans les fixtures. Aucun changement du moteur ou des commandes de suppression n’appartient à ce lot.

Le catalogue présente **9 familles**, avec **25 variantes exécutables**. Chaque famille possède un fichier `.scenario.ts` et une page `.svx` dans `/atelier/tests-visuels/<id-de-famille>`. Un sélecteur permet d’afficher une variante à la fois, avec sa description, son dessin et son verdict.

`scenarios.test.ts` parcourt toutes les variantes, indépendamment de celle affichée dans l’atelier. Leurs identifiants et leurs assertions sont conservés. Chacune est testée dans les quatre directions, les deux biais compatibles par direction et la configuration par défaut : **13 exécutions par variante, soit 325 pour les jonctions**. La famille n’ajoute pas une exécution redondante de sa variante par défaut.

Les pertes d’ancre et les branches conservées utilisent des données paramétrées et une préparation/assertion commune. Les comportements géométriques distincts gardent leurs assertions propres.

## Contrat retenu

- Les jonctions ne créent pas de rang logique. Leurs centres se placent sur les lignes de référence des rails.
- Un rail portant une jonction réserve une épaisseur sur l’axe principal, supérieure à celle d’un rail ne portant que des chemins. Cette réservation comprend l’objet et ses dégagements. Plusieurs objets sur le même rail n’additionnent pas leurs épaisseurs : leurs empreintes doivent tenir sur des portions libres.
- Les jonctions directement chaînées progressent dans l’intervalle sur des rails distincts. Les jonctions indépendantes réutilisent idéalement le même rail ; une traverse peut également partager les portions libres de ce rail.
- La recherche de l’intervalle traverse récursivement les jonctions vers les premières boîtes du côté des rangs croissants. Parmi ces boîtes, le plus faible rang détermine le voisin de référence. La jonction précède sa rangée effective dans le sens du layout, y compris lorsque le biais change cette rangée.
- Le rail de base est recherché au centre de l’intervalle. Les tests n’inventent ni identifiants d’allocation ni ordre de numérotation pour les rails supplémentaires : ils observent les centres, les traverses et les espacements réels.
- L’agrandissement concerne les rangées entières, qui restent alignées. Les réservations inutiles sont récupérées après suppression.
- Les quais d’entrée et de sortie sont sur les deux faces principales opposées et suivent le sens des flèches. Leur nombre peut agrandir la jonction transversalement ; la dimension satisfait le maximum du contenu et des besoins des deux faces, sans additionner ces besoins.
- Le partage des troncs et des quais suit VL-413. Les croisements sans raccord reçoivent un pont. Une jonction est un obstacle pour les routes étrangères, même lorsqu’elles empruntent son rail.
- Une jonction doit conserver une origine et une destination. Perdre la dernière connexion d’un côté la supprime, avec ses relations. La collecte est récursive et s’arrête devant une jonction encore valide. Les boîtes devenues indépendantes sont conservées.

Les scénarios utilisent XOR, seul opérateur représenté dans le modèle actuel, comme représentant du comportement de layout commun aux opérateurs. Ils ne testent pas la sémantique d’évaluation AND/OR/XOR. Les mesures de départ sont explicites : boîtes de 80 sur l’axe transversal et 60 sur l’axe principal ; jonctions compactes de 28 × 20, laissant respirer le libellé. Les quais des jonctions sont espacés de 12, avec une marge de 8 ; les entrées d’une même jonction partagent le quai central et une traverse. Les sorties issues d’un même quai recherchent aussi une traverse commune, même si cela ajoute un pont. Cette préférence s’applique aux nœuds comme aux jonctions. Le dégagement autour d’une jonction est de 12. Les variantes signalant des mesures surdimensionnées éprouvent le moteur avec des entrées extrêmes ; elles ne représentent pas la taille du symbole dans le produit.

## Couverture

| Page                                                                | Variantes                                                                                                                         |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `junction-base-rail` — Une jonction sur le rail de base             | `junction-base-rail`                                                                                                              |
| `junction-chain` — Chaînes de jonctions                             | `junction-chain`, `junction-long-chain`, `junction-unequal-chains`                                                                |
| `junction-branches` — Branchements autour des jonctions             | `junction-fan-in`, `junction-fan-out`, `junction-converge-diverge`                                                                |
| `junction-shared-rails` — Partage et épaisseur des rails            | `junction-parallel`, `junction-mixed-route`, `junction-thick-rail`, `junction-shared-thickness`                                   |
| `junction-nearest-row` — Choix de l’intervalle                      | `junction-nearest-row`, `junction-recursive-nearest-row`, `junction-placement-bias`                                               |
| `junction-crossing-quays` — Quais, croisements et obstacles         | `junction-crossing-quays`                                                                                                         |
| `junction-remove-connection` — Perte d’une connexion indispensable  | `junction-remove-last-origin`, `junction-remove-last-destination`, `junction-remove-isolated`, `junction-remove-unanchored-chain` |
| `junction-remove-cascade` — Suppression en cascade et espace libéré | `junction-remove-cascade-origin`, `junction-remove-cascade-destination`, `junction-cascade-stops`, `junction-release-space`       |
| `junction-preserve-branch` — Conserver une branche valide           | `junction-preserve-origin-branch`, `junction-preserve-destination-branch`                                                         |

## Exécution et interprétation

```sh
mise exec -- pnpm exec vitest run --config config/vitest.config.ts tests/scenarios/visual/scenarios.test.ts -t junction
mise exec -- pnpm exec vitest run --config config/vitest.config.ts tests/support/assertions/assert-junctions.test.ts
mise exec -- pnpm exec playwright test --config config/playwright.config.ts tests/app/workshop/e2e/junction-scenarios.spec.ts
```

Les suppressions passent par les véritables `WorkshopCommands`, avant `createGraph → topologicallyRank → layoutGraph`. Le test vérifie les identités restantes dans le document **et** dans le layout. Il ne suffit donc pas de masquer une jonction dans le rendu ; aucune collecte n’est implémentée dans le harness. Les vues comparatives affichent le document avant l’édition et le résultat réel après l’édition.

Les tests des assertions utilisent aussi des contre-exemples : bord confondu avec le centre du rail, jonctions superposées ou inversées, intervalle incorrect, traversée d’un obstacle, quais trop serrés et éléments résiduels dans le document ou le dessin.

Les tests navigateur vérifient que les pages, les géométries et les verdicts sont consultables, même lorsqu’une spécification échoue. Ils n’exigent pas que le moteur conserve ses défauts actuels. La conformité fonctionnelle reste vérifiée strictement par les scénarios partagés.

Au premier contrôle de ce lot : **8 variantes passent dans les 13 configurations ; 17 échouent dans les 13 configurations** (104 réussites et 221 échecs). Ce relevé est un état initial, pas une liste d’échecs autorisés. Le verdict s’arrête à la première assertion en échec ; les assertions suivantes restent à satisfaire également.

Les règles propres aux groupes et l’arbitrage des centrages asymétriques restent délibérément hors périmètre. Le principe « groupe replié traité comme un nœud » est conservé pour le futur lot sur les groupes ; il n’est pas présenté ici comme couvert par un test de groupe.
