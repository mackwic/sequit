# Refonte du moteur de layout — phase 2

Ce plan prolonge le [plan de refonte](layout-engine-refactor.md), qui reste la référence des décisions acquises, des invariants et du contrat entre régions. Le [journal du 24 septembre](layout-engine-refactor-journal-2026-09-24.md) conserve les preuves datées. Ce document ne répète ni l'un ni l'autre : il fixe le point de reprise, le diagnostic de sortie de la phase 1 et les étapes de la phase 2.

## Point de reprise

État relevé le 24 septembre 2026.

- **Branche** `codex/layout-contract-generalization`. La phase 1 est commitée dans `3746f06`, `c2c58c2`, `fe046aa`, `7bf0643`, `a97a24e`, `9c92aec`, `ce07297`, `545de50` et `9657bce`, puis fusionnée avec `origin/main` dans `0f74fe4`, dernier commit vert. Ce plan est commité dans `d1eb686`.
- **Commit WIP rouge `819d5a3`**, sous le dernier commit de documentation, commité avec `--no-verify` comme point d'étape d'une tranche interrompue. Le lint y est propre, mais 9 tests échouent dans `tests/lib/core/layout` et `tests/app/web/projection`. Trois gardent un statut `unknown` avec un code d'incident propre à la cellule au lieu de l'ancien diagnostic de grille. Deux attendent un espacement de 24 px entre ports d'incidents groupés et obtiennent 18,67 et 66,67 : `crossingMargin` ne compte pas les mêmes traversées au placement et au routage. Un cas de grille imbriquée est sélectionné alors qu'un nœud voisin bloque la sortie de sa cellule : la composition par chemins incidents a perdu l'ancien contrôle des segments de grille ; c'est le défaut le plus sérieux. Les trois derniers sont dans `root-region.test.ts` (2) et `indexed-route-materialization.test.ts` (1). La grille y compose ses traversées à partir des chemins incidents publiés par ses cellules (`composeGridCellCrossings`, `materializePlacedGridCellDisposition`) au lieu des ports de l'ancien tracé, et la normalisation matérialise une fois la politique de chaque région (`RegionInputDefinition`). La tranche est transitoire : `gridTrackPiece` exige encore que chaque portail choisi coïncide avec celui de l'ancien tracé, sinon il renvoie `unknown` (`GridCrossingPortal`). Cette tranche doit être terminée et validée, ou annulée par un revert, pendant l'étape 0 ; aucune autre étape ne démarre sur une branche rouge.
- **Portes** : voir [l'état des portes](#état-des-portes-au-point-de-reprise).
- **Trois capacités perdues** : trois relations inter-cellules à source commune dans la grille racine, la relation directe d'un groupe racine vers une autre cellule, et la sortie externe d'une grille interne combinée à une relation locale et à une traversée intercellulaire. Le validateur unifié y détecte des contacts sans pont (`ParentRouteContact`) : ces sélections étaient des faux positifs de l'ancien oracle de grille. Depuis `545de50`, les trois parcours vérifient le diagnostic du document courant. La [preuve de grille](grid-cell-layout-proof.md) est corrigée en conséquence ; pour l'utilisateur, ces capacités restent perdues tant que l'étape 2 ne les restaure pas.

### État des portes au point de reprise

Exécution fraîche du 24 septembre 2026 sur `HEAD 0f74fe4`, dans un worktree isolé sans la tranche non commitée : `format:check`, `check:types` et `mise exec -- pnpm quality:fast` passent. Lint, code inutilisé et architecture (573 modules) sont verts ; 260 fichiers et 4 347 tests web passent avec 98,00 % de branches, **exactement au seuil de 98 %** ; 48 tests worker passent avec 98,66 % ; la duplication est de 0,96 % pour un seuil de 1 %. Les parcours Playwright, les builds et `test:performance` n'ont pas été rejoués sur ce commit : le journal consigne 60/60 en performance sur la même source de production et un `check` local rouge sur les parcours navigateur (lancements Firefox sans profil, puis anciens scénarios de grille adaptés).

Le commit WIP `819d5a3` passe le formatage et le lint mais échoue aux tests, comme indiqué plus haut. Une porte verte antérieure ne vaut pas pour une source modifiée.

## Ce que la phase 1 a livré

La composition est générale dans sa structure : arbre de régions normalisé, récursion unique, contrat incident par défaut pour les deux politiques de feuille (`layered`, `shared-lanes`), interface `RegionArrangement` (`incidentSides`, `place`, `route`) implémentée par la rangée et la grille, types `Region*` communs, diagnostics et reprises typés, validateur de chaîne indépendant, tentatives partielles par sous-arbre produites par le cœur, politique de feuille persistée et cache local sensible au contrat. Les prédicats nommant des formes de témoins ont été retirés ; seules restent des gardes de ressources.

## Ce qui reste spécialisé

1. **Le routage à l'intérieur des dispositions.** Quatre implémentations résolvent le même problème — allouer des chemins dans l'espace libre possédé par une région — avec leurs propres constantes et leurs propres règles de contact : le bus de la rangée (`rowBus`, `PARENT_BUS_SPACING`), les rails et le bus supérieur de la grille (`CROSSING_SPACING`, `OUTER_RAIL_OFFSET`, `TOP_BUS_Y`), les passages des lanes partagées et les corridors du moteur dédié. Aucune n'expose de capacité : un contact entre deux routes n'est découvert qu'après coup par le validateur. C'est la cause des trois capacités de grille perdues.
2. **Les ponts.** La décision produit existe (seuils explicites d'aire et de longueur entre pont validé et détour), mais aucun oracle complet ne valide un pont. Tout contact reste donc `unknown`.
3. **Les recherches bornées.** La recherche d'incidents de feuille, la reprise par changement de côté dans la rangée et la résolution du `LayoutContract` sont trois recherches avec leurs budgets et leurs témoins propres. La reprise exclut en outre les grilles par une condition explicite.
4. **Le moteur dédié** reste monolithique ; le `LayoutContract` n'est matérialisé que sur deux corridors adjacents bornés.

## Objectif et non-objectifs

**Objectif** : faire du routage une **allocation explicite de ressources**, commune aux dispositions puis aux politiques de feuille, avec une politique de pont validée ; ouvrir ensuite des emplacements d'algorithmes comparables sur les mêmes oracles.

**Non-objectifs** : pas de solveur de contraintes général ; pas de grille N × M, de groupes imbriqués ni de nouveaux portails de groupe avant l'étape 3 ; pas de nouveau prédicat ou module nommant un témoin ; pas de migration du moteur dédié dans cette phase, hors emplacement d'ordre à l'étape 6.

## Vocabulaire algorithmique

Chaque abstraction ci-dessous a déjà au moins deux instances réelles dans le code. Une nouvelle abstraction n'entre que si un second algorithme ou un oracle en démontre le besoin.

### Conteneurs décrits par leurs propriétés

| Conteneur     | Domaine de rangs       | Opaque aux routes étrangères | Indivisible | Organisation des enfants |
| ------------- | ---------------------- | ---------------------------- | ----------- | ------------------------ |
| Groupe        | partagé avec le parent | oui (boîte)                  | oui         | flux du parent           |
| Lane          | partagé                | non                          | non         | bande d'ordre fixe       |
| Région        | propre                 | oui                          | oui         | rangée                   |
| Cellule       | propre                 | oui                          | oui         | pistes de grille         |
| Groupe replié | feuille                | oui                          | oui         | attaches dérivées        |

Un **domaine de rangs** est l'ensemble des éléments classés ensemble ; un conteneur à rangs propres en ouvre un nouveau. Ce tableau décrit la cible de raisonnement ; il ne remplace pas les décisions du plan, notamment qu'une lane reste une politique de feuille et non une disposition.

### Graphe de ressources de routage

```text
nœuds  : ports, portails, intersections de pistes
arêtes : gouttières, rails, bus, passages — chacune possédée par une région
attributs d'arête : orientation, capacité (nombre de pistes), dégagement
allocation : route = chemin + piste attribuée sur chaque arête
conflit : deux routes sur une même piste, ou croisement hors intersection déclarée
```

Un conflit a exactement trois issues, dans cet ordre de recherche et départagées par la hiérarchie d'objectifs du plan : **ajouter une piste** (croissance de l'arête, publiée comme `MetricDemand` et, si elle dépasse l'espace possédé, remontée au parent) ; **pont validé**, si la politique l'admet ; sinon `unknown` codé avec son témoin. L'ordre des rails par inclusion d'intervalles (`ce07297`) devient la règle d'allocation d'un bus, pas une correction propre à la rangée.

### Emplacements d'algorithmes

| Emplacement           | Signature                              | Candidats existants ou proches                                   | Oracle indépendant                                 |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| Allocation de routage | graphe de ressources → chemins, pistes | bus de rangée, rails de grille, passages de lanes                | capacité, dégagement, contacts, opacité            |
| Ordre dans le rang    | rangs → ordres                         | ordre du moteur dédié ; énumération d'ordres du `LayoutContract` | permutation valide, croisements comptés            |
| Disposition           | empreintes → placements                | rangée, grille                                                   | confinement, minima extensibles, non-chevauchement |
| Classement par rangs  | domaine → rangs                        | plus long chemin seulement                                       | absence de cycle, précédences documentaires        |
| Placement             | ordres et mesures → coordonnées        | moteur dédié seulement                                           | non-chevauchement, dégagements                     |

Les deux derniers emplacements ne sont pas extraits dans cette phase : ils n'ont qu'un algorithme.

### Recherche bornée commune

Une recherche se compose de combinateurs à signature uniforme `(problème local, contrat) → tentative + témoin` : `premierValide`, `meilleur(objectif)`, `borné(budget)`. Le témoin est unique : alternatives tentées, exhaustivité, alternatives rejetées avec leur code. Le budget et l'ordre d'exploration sont déclarés ; aucun `for (;;)` d'orchestration ne porte de stratégie implicite.

## Étapes

Chaque étape se termine par `mise exec -- pnpm quality:fast` vert, un commit dédié et une entrée datée du journal. La suite `test:performance` doit rester à 60/60.

| #   | Étape                                          | Preuve d'acceptation                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Stabiliser                                     | Tranche non commitée terminée ou retirée ; `mise exec -- pnpm check` vert, y compris Firefox, ou échec d'environnement documenté et vérifié en CI ; journal et statut du plan mis à jour.                                                                                                                                                                     |
| 1   | Graphe de ressources dans la rangée            | Le bus de rangée devient une allocation sur des arêtes à capacité ; `LayoutResult` identique octet pour octet sur le corpus et les propriétés de rangée existantes.                                                                                                                                                                                           |
| 2   | Grille sur le même graphe                      | Rails et bus de grille alloués par le même code ; un conflit ajoute une piste avant tout `unknown`. Les trois capacités perdues reviennent **sans code qui les nomme** : leurs parcours retrouvent les assertions d'origine (rendu, ports distincts, opacité) sur trois navigateurs. `gridTrackPiece` et l'égalité avec l'ancien tracé disparaissent.         |
| 3   | Oracle et politique de pont                    | Un validateur indépendant du pont rendu (point de croisement hors port, dégagement, marque dans le `LayoutResult`) ; le pont devient une alternative de la recherche ; les seuils sont calibrés sur des paires d'atelier (3+1, contact de grille, `S \| SD \| C`). Les contacts `ParentRouteContact` restants choisissent détour ou pont validé, avec témoin. |
| 4   | Recherche bornée commune                       | Recherche d'incidents de feuille, reprise de côté et résolution du contrat passent par les mêmes combinateurs et le même témoin ; résultats identiques ; l'exclusion explicite des grilles dans la reprise disparaît ou devient un code déclaré.                                                                                                              |
| 5   | Passages des lanes sur le graphe de ressources | Gouttières et passages des lanes partagées deviennent des arêtes allouées ; `S \| SD \| C` et le passage intérieur restent identiques ; au moins un cas de lanes aujourd'hui `unknown` est résolu ou reçoit un code plus précis.                                                                                                                              |
| 6   | Emplacement d'ordre dans le rang               | Signature et oracle extraits ; l'ordre du moteur dédié et l'énumération du contrat comparés sur le même corpus dans un banc d'atelier ; aucun changement de résultat en production sans décision explicite.                                                                                                                                                   |
| 7   | Élargir le périmètre                           | Grille N × M, portails de groupe généraux et groupes imbriqués, chacun sélectionné sans prédicat dédié ; sinon `unknown` codé qui désigne la ressource ou le contrat manquant.                                                                                                                                                                                |

## Règles transverses

- Une forme nouvelle qui exige un prédicat dédié révèle un contrat ou une ressource incomplète : on complète le contrat, pas le témoin.
- Une capacité perdue par un oracle plus strict est documentée comme telle dans la preuve concernée, avec l'étape qui doit la restaurer.
- Les gardes restantes sont des limites de ressources, jamais des limites de structure.
- Aucun seuil de lint, couverture, duplication, mutation ou performance n'est abaissé.

## Questions ouvertes

1. Une piste porte-t-elle une seule route, ou un tronc partagé explicitement sémantique peut-il en porter plusieurs ?
2. Entre une piste supplémentaire et un pont validé, lequel explorer d'abord quand les deux respectent les seuils ?
3. Quand la croissance d'une arête doit-elle devenir une demande métrique de la région parente plutôt qu'un détour local ?
4. Le tableau des conteneurs peut-il remplacer à terme les politiques nommées, ou reste-t-il un outil de raisonnement ?
