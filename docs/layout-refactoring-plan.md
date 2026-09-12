# Refactoring du moteur de layout — bilan

Terminé le 12 septembre 2026 et intégré dans `main` par le commit `03e0783`. Ce bilan remplace le plan de travail détaillé, conservé dans l’historique de ce commit. L’organisation courante est décrite dans [l’architecture](architecture.md#organisation-du-moteur-de-layout) et [le routage](layout-routing.md).

## Décisions retenues

Le calcul reste couplé : les quais influencent les dimensions des boîtes, puis les rails déterminent les espaces entre rangées. Un workspace propre à chaque appel conserve la préparation stable et possède les coordonnées modifiées. Seul l’orchestrateur accède à l’ensemble du workspace ; les autres fonctions reçoivent les données nécessaires à leur responsabilité.

- Préparer une fois les composantes, les rangées, les membres directs des groupes, leurs racines et leurs profondeurs.
- Emprunter les index du graphe et les mesures du contenu ; posséder les dimensions effectives et les boîtes translatées. Une seule représentation géométrique fait autorité.
- Séparer la réservation des quais et rails de la matérialisation des points. Conserver les parcours à un, deux ou trois placements, sans boucle de convergence.
- Partager les voisinages immuables des relations de groupes jusqu’à divergence d’un membre ; regrouper leurs parcours identiques pour les rangs et les composantes.
- Garder les `Map` et les objets géométriques ordinaires. Les essais ne justifient ni une conversion générale en arène numérique ni un solveur de positions possibles.
- Réutiliser les buffers utiles près de leur algorithme, sans bloc `scratch` générique ni cache persistant entre appels.

Les rangs logiques, l’ordre documentaire et l’ordre d’assemblage restent distincts. Les bandes et les positions des rails gardent leur coordination globale entre composantes. Les en-têtes des groupes restent physiquement en haut. L’API asynchrone, l’inspection optionnelle et les règles géométriques sont conservées ; les directions d’import et les cibles de mutation suivent les modules extraits.

## Validation du lot

| Contrôle                             | Résultat                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Comparaison exacte avec la référence | 1 890 résultats et 30 rejets identiques ; tailles décimales et inspection comprises      |
| Graphes et rangs                     | 120 comparaisons identiques, avec collections réordonnées                                |
| Propriété des données                | Entrées et résultats précédents intacts après de nouveaux appels                         |
| `check` complet                      | 1 722 tests unitaires/propriétés, 128 tests navigateur, types, qualité et builds réussis |
| Mutation                             | 3 456 altérations ; score 84,26 %, seuil inchangé de 80 %                                |
| Budgets snapshot                     | 60/60 respectés                                                                          |
| Budgets incrémentaux                 | 59/60 respectés ; écart biparti préexistant conservé                                     |

Les cinq échecs navigateur rencontrés ont été reproduits sur la référence avant correction des attentes de direction, du document imbriqué désormais supporté et de la visibilité de la poignée avant le geste de connexion.

Lors du contrôle d’intégration du 12 septembre, les nouvelles spécifications de jonctions du travail parallèle donnaient 221 échecs avec chacun des deux moteurs. Les 624 cas comparés avaient exactement les mêmes statuts et messages d’erreur initiaux. Ces modifications ne font pas partie du lot vérifié ci-dessus ; ce résultat décrit leur état à cette date, avant la poursuite de leur implémentation.

## Performances et limites conservées

Mesures officielles enregistrées avec les mêmes versions, fixtures et budgets, sur Apple M1 Max, Node 24.20.0 et pnpm 12.3.4. Les sources restent inchangées pendant les campagnes et aucune validation concurrente n’est détectée. Les replays dits incrémentaux reconstruisent aujourd’hui le pipeline après chaque ajout ; ils ne prouvent pas une réutilisation d’état entre éditions.

| Profil                              | Mesure            |     Avant |     Après | Budget |
| ----------------------------------- | ----------------- | --------: | --------: | -----: |
| Groupes imbriqués, 1 000 nœuds      | Médiane du moteur |  83,22 ms |   5,46 ms | 205 ms |
| Groupes peu profonds, 1 000 nœuds   | Médiane du moteur |   4,18 ms |   2,77 ms | 100 ms |
| Relations de groupes, 100–999 nœuds | p95 du pipeline   |  15,20 ms |   4,20 ms |   5 ms |
| Biparti dense, 100–999 nœuds        | p95 du pipeline   | 135,68 ms | 122,46 ms |  70 ms |

La comparaison alternée confirme les gains sur les groupes. De petites hausses de médiane restent observées sur le biparti (+1,9 %), les composantes indépendantes (+2,6 %) et les jonctions (+0,7 %) ; aucun gain universel n’est revendiqué. `unbalanced-random/100-999` passe à 4,98 ms pour un seuil de 5 ms, avec peu de marge.

L’écart biparti existait dans le moteur sauvegardé. Le périmètre confirmé consiste à finaliser ce refactoring et à documenter cet écart : sa résolution est un chantier distinct. Le seuil de 70 ms reste actif et la campagne incrémentale complète reste rouge sur ce cas.

## Référence et preuves

- Moteur sauvegardé : `bb802744ed41219afe85f3f810a7dc2f02b1865c`, accessible par `codex/layout-refactor-baseline`.
- Implémentation validée : `03e0783387293bf4a5cd94c0e752420d068f01c4`, dans l’historique de `main`.
- [Mesures, comparaisons exactes et journaux de validation](/Users/thomas/.codex/visualizations/2026/09/12/01a09564-f001-7b30-81d2-5b604d3b9e53/layout-refactor-implementation/README.md).
- [Étude de conception et prototypes](/Users/thomas/.codex/visualizations/2026/09/12/01a09564-f001-7b30-81d2-5b604d3b9e53/layout-refactor-study/README.md).

Les checkouts temporaires et caches d’expérience peuvent être supprimés après archivage des preuves. Les commits conservés permettent de recréer les versions comparées ; les résultats restent hors du code de production.
