# Audit de Sequit — 14 septembre 2026

**Verdict : une architecture saine, des mécanismes de qualité sérieux, mais des garanties de conservation et de reprise encore insuffisantes pour un produit durablement robuste.** Je recommande des corrections et extractions ciblées, pas une réécriture du moteur ni une nouvelle architecture générale.

L’enjeu principal n’est pas la longueur des fichiers. Il est de rendre explicites les contrats qui traversent plusieurs modules : préserver le contenu lors d’une édition, reconnaître une commande déjà exécutée, conserver une room éditable dans le temps, projeter les groupes sans ambiguïté et afficher une nouvelle scène sans interrompre l’interaction.

**Périmètre et méthode.** Lecture du document, graphe, layout, collaboration, Worker, projection, UI, configuration, tests et benchmarks. Base : `d71340dac1c421fa8146f75a297b399755525f74`, avec les modifications locales présentes au début de l’audit. Les ajouts Quill et présence v3 sont signalés comme **travail en cours**. Création, entrée et partage de rooms, parcours complets de modification et futures swimlanes/grilles sont des évolutions connues, pas des bugs comptabilisés ici. Des preuves ciblées utilisent les vrais modules ; leurs limites sont indiquées. Aucun correctif applicatif n’est inclus dans cet audit.

Les [preuves et journaux de l’audit](/Users/thomas/.codex/visualizations/2026/09/14/01a09f0d-745d-7093-9ad1-f9df72a1a3c0/sequit-architecture-audit/AUDIT-EVIDENCE.md) sont conservés localement. Il contient les logs, résultats JSON, reproductions et l’état initial du checkout. Les mesures concernent ce poste ; elles ne constituent pas un test de charge Cloudflare déployé.

**Évaluation par dimension**

| Dimension            | Évaluation                                                              | Ce qui manque principalement                                                                       |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Modèle documentaire  | Bonne base : identités, DAG, ordre stable, séparation logique/géométrie | Sémantique des contenants, des arcs agrégés et du dialecte éditable                                |
| Frontières du code   | Solides et contrôlées mécaniquement                                     | Contrats applicatifs plus précis, publication/erreurs cohérentes                                   |
| Lisibilité du moteur | Nettement améliorée par le refactoring récent                           | Généraliser les capacités de routage, expliciter quelques optimisations                            |
| Collaboration        | V1 bien conçue pour les échanges nominaux et la validation              | Déduplication durable, capacité dans le temps, santé réseau, catégories d’échec                    |
| UI                   | Bases utiles pour sélection, focus et mesures                           | Projection stable, conservation du contenu, continuité du focus et navigation de sortie            |
| Tests                | Grande profondeur sur les cas modélisés                                 | Compositions entre mécanismes, vieillissement, ordonnancements réseau, vrais budgets d’interaction |
| Performance          | Mesurable sur le calcul, bonnes performances sur beaucoup de topologies | Cas dense hors budget, coûts de la collaboration et du navigateur non couverts                     |
| Évolutivité          | Bonne pour consolider le produit actuel                                 | Distinguer groupe, swimlane et portée de layout avant la composition récursive                     |

## Ce qu’il faut conserver

Le cœur est pur : pas de DOM, réseau, horloge ou Yjs. Les dépendances entre cœur, infrastructure, application, atelier et Worker sont contrôlées par [dependency-cruiser.cjs](/Users/thomas/projects/sequit/config/dependency-cruiser.cjs), avec une règle ESLint lisant la même politique. Le contrôle initial a parcouru **371 modules et 1 207 dépendances sans violation**. La frontière atelier/production est également vérifiée au build.

Le moteur possède un [workspace par appel](/Users/thomas/projects/sequit/src/lib/core/layout/layout-workspace.ts:7). Structure, géométrie, placement et routage sont séparés ; les mutations portent sur des collections et boîtes possédées par l’appel. Les tests vérifient que les entrées et résultats précédents restent intacts. Le couplage entre largeur des quais, dimensions et espace des rails est réel : l’orchestration actuelle le rend visible et borné, sans boucle de convergence arbitraire.

Les optimisations de graphe sont défendables : [partage de voisinages et copie lors d’une divergence](/Users/thomas/projects/sequit/src/lib/core/graph/create-adjacency.ts:29), expansion des groupes seulement lorsqu’elle sert une relation, [regroupement de parcours identiques pour les rangs](/Users/thomas/projects/sequit/src/lib/core/graph/topological-ranks.ts:17). Elles évitent des travaux redondants tout en conservant une API lisible. Les supprimer pour rendre chaque fonction superficiellement plus simple serait une régression.

La collaboration sépare texte CRDT, commandes structurelles et présence. Le serveur travaille sur un candidat jetable et [persiste avant de publier](/Users/thomas/projects/sequit/src/workers/collaboration-worker/collaboration-room.ts:194). Les lots structurels sont atomiques ; le filtre textuel empêche de modifier la structure par une update de texte. L’initialisation concurrente adopte le document accepté plutôt que de fusionner deux imports. Les textes restent des `Y.Text` stables et les curseurs utilisent des positions relatives.

L’atelier et Vitest exécutent les mêmes scénarios visuels, construits avec le pipeline réel. Les tests de propriétés, les essais dans Workerd, les deux sessions navigateur indépendantes et les contrôles d’imports ont une vraie valeur. Les copies DOM de mesure utilisent les mêmes composants que le rendu et sont hors interaction. Il faut conserver ces choix.

## Défauts et risques prioritaires

Les priorités ci-dessous distinguent une correction de comportement, une dette de conception et une limite volontaire de V1. **P1** signifie à traiter avant de généraliser l’usage concerné ; **P2** signifie un défaut ou une dette importante, sans implication de perte de document démontrée.

**A1 — P1 : une ancienne commande peut écraser une décision plus récente après reconnexion. Reproduit, code intégré.**

Le client [rejoue les commandes non acquittées](/Users/thomas/projects/sequit/src/lib/infrastructure/collaboration/collaborative-session.ts:253), mais le serveur ne conserve que [128 identifiants acceptés](/Users/thomas/projects/sequit/src/lib/infrastructure/collaboration/room-persistence.ts:7). Un ID évincé est traité comme une commande nouvelle par [la room](/Users/thomas/projects/sequit/src/workers/collaboration-worker/collaboration-room.ts:153).

Preuve : Alice choisit le rouge, le commit réussit, mais son acquittement est perdu. Bob exécute ensuite 128 commandes, dont un changement vers le bleu. À son retour, Alice reçoit l’état bleu puis rejoue son ancienne commande ; le rouge remplace le bleu. Les vrais modules d’exécution et de persistance donnent `{ evicted: true, before: '#0000ff', after: '#ff0000' }`. La branche de room est simulée, pas exécutée dans Workerd dans cette preuve.

**Correction :** un protocole de commandes avec identité de session, séquence monotone et progression durable, ou une expiration de reprise explicitement négociée. Après expiration, ne jamais réinterpréter silencieusement une commande ancienne comme nouvelle. Ajouter un scénario Workerd « acquittement perdu → éviction → reconnexion ». Augmenter 128 déplacerait seulement le problème. L’idempotence des updates Yjs ne rend pas idempotente la réexécution d’une commande métier. [API officielle Yjs](https://docs.yjs.dev/api/document-updates).

**A2 — P1 : une frappe Quill peut détruire des informations non éditées. Reproduit, travail en cours.**

Le binding [convertit tout le Markdown en contenu Quill puis sérialise tout le résultat](/Users/thomas/projects/sequit/src/app/web/document/quill-editor.ts:20). Le [sérialiseur](/Users/thomas/projects/sequit/src/app/web/document/quill-markdown.ts:51) ne représente pas toutes les informations du format d’entrée.

Avec le vrai Quill, jsdom, Yjs et les fonctions du checkout, ajouter seulement `!` à un paragraphe final « Conclusion » supprime, dans les blocs précédents : l’alt et le titre d’une image, le langage `typescript` d’un bloc de code, la structure d’un tableau, ou l’état des cases `[x]` et `[ ]`. L’ouverture seule ne modifie pas le texte ; la première frappe déclenche la perte. Cela contredit le contrat de [conservation exacte du Markdown](/Users/thomas/projects/sequit/docs/design.md:113).

**Correction :** définir le dialecte pris en charge et préserver les portions non éditées, y compris les blocs non représentables. L’autorité reste le contenu source, avec un mapping entre blocs/positions source et opérations d’édition. Une solution provisoire acceptable est de garder une édition source pour les contenus non pris en charge. Éviter de multiplier les remplacements globaux à chaque frappe. Les tests doivent partir d’un document Markdown existant et vérifier la conservation du reste après une édition locale ; un roundtrip interne Quill ne suffit pas.

**A3 — P1 pour les sessions prolongées : une room peut épuiser sa capacité avec un contenu visible minuscule. Démontré sur la primitive.**

Le serveur et ses candidats emploient [`gc:false`](/Users/thomas/projects/sequit/src/workers/collaboration-worker/collaboration-room.ts:25). Chaque commit réencode et réécrit l’état complet. Le [plafond applicatif](/Users/thomas/projects/sequit/src/lib/infrastructure/collaboration/room-persistence.ts:37) est de 960 Kio, soit 983 040 octets.

Avec cette politique, 60 cycles d’insertion puis suppression de 16 Kio dans un même `Y.Text` produisent un état encodé de **983 073 octets**, alors que le texte visible est vide. Ce n’est pas une mesure de débit de room ; c’est une preuve que « document visuellement petit » ne signifie pas « état persistant petit ». Effacer le texte ne rend pas nécessairement de capacité.

**Correction :** définir la durée de vie d’une room, mesurer séparément contenu utile et historique CRDT, et concevoir GC/compaction avec les clients en retard. Tester vieillissement, reprise et changements d’époque ensemble. Puis envisager un journal de commits et des checkpoints si les mesures de stockage le justifient. Ne pas simplement activer la GC : le filtre textuel et la synchronisation doivent conserver leurs garanties. Le snapshot et son plafond sont des compromis assumés de V1 ; leur conséquence devient prioritaire pour un usage durable.

**A4 — P1 dans la présence v3 : une sélection autorisée dépasse la capacité de son stockage. Taille démontrée ; rejet Worker déduit.**

Le [codec de présence](/Users/thomas/projects/sequit/src/lib/infrastructure/collaboration/participant-presence.ts:64) accepte 1 000 éléments. La room [stocke le message entier dans l’attachement WebSocket](/Users/thomas/projects/sequit/src/workers/collaboration-worker/collaboration-room.ts:105). Cloudflare limite cet attachement sérialisé à **16 384 octets**. [Documentation officielle](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

Avec des UUID de 36 caractères, 400 sélections produisent déjà **20 879 octets** de CBOR, sans compter l’éventuelle surcharge de sérialisation de l’attachement. Le dépassement de taille est mesuré ; l’appel Workerd qui lève l’exception n’a pas été exécuté dans cette preuve. Le catch actuel convertirait cette erreur de présence en refus terminal du document.

**Correction :** définir un budget en octets et une réduction explicite de la présence, avec un test réel de la borne dans Workerd. Une information éphémère trop grande doit pouvoir être réduite ou ignorée sans interrompre la session documentaire.

**A5 — P2 : une relation longue traverse une boîte étrangère. Reproduit, code intégré.**

Document minimal valide : `0 ← 1 ← 2`, plus `2 → 0`, sans jonction. Avec des boîtes de 100 × 50, le nœud 1 occupe `x=40..140, y=162..212`. La relation longue passe à `x=90`, de `y=284` à `y=90` : elle traverse sa boîte.

Le [choix du routage par couches](/Users/thomas/projects/sequit/src/lib/core/layout/layout-engine.ts:28) dépend de la présence d’une jonction ; les [corridors ordinaires](/Users/thomas/projects/sequit/src/lib/core/layout/routing/routing-corridors.ts:85) écartent les rangs non adjacents. Le [fallback](/Users/thomas/projects/sequit/src/lib/core/layout/build-layout-result.ts:35) ne consulte pas les obstacles. Cette limite est reconnue dans la documentation du routage, mais le document reste accepté et affiché incorrectement.

**Correction :** choisir le routage selon les besoins géométriques — en particulier le franchissement de rangées — puis réutiliser le mécanisme de couches existant. Ajouter le scénario et l’invariant « aucune route dans une boîte étrangère ». Aucun besoin d’un deuxième moteur.

**A6 — P2 : groupe peuplé et jonction peuvent empêcher le rendu d’un document valide. Reproduit, code intégré.**

Un groupe `g` contenant `0`, une jonction extérieure `j`, un nœud extérieur `1`, avec `g → j` et `j → 1` : validation documentaire et graphe réussissent, mais le layout lève `Relation bounds overlap: gj (g -> j)`.

Les groupes sont [enveloppés après le placement de leurs membres](/Users/thomas/projects/sequit/src/lib/core/layout/placement/enclose-groups.ts:21). Le problème est découvert tard par [endpoint-routes.ts](/Users/thomas/projects/sequit/src/lib/core/layout/routing/endpoint-routes.ts:46). L’enveloppe est une contrainte de placement et de routage ; la calculer seulement comme conséquence du placement ne suffit pas dans toutes les compositions.

**Correction :** formaliser les contraintes de frontière et d’attachement des contenants ; les faire participer au placement. Conserver le diagnostic de chevauchement. Ajouter une famille de scénarios de groupes peuplés, groupes imbriqués, jonctions intérieures/extérieures, tailles inégales, fermeture et relations traversant les frontières.

**A7 — P2 : le repli perd la provenance et rend l’identité d’un arc visible dépendante de l’ordre d’entrée. Reproduit.**

Deux relations `r1:a→c` et `r2:b→c`, avec `a,b` dans `g`, deviennent une seule relation lorsque `g` est fermé. [collapsedDocument](/Users/thomas/projects/sequit/src/lib/core/document/collapsed-document.ts:26) conserve la première : permuter le tableau source fait passer l’ID visible de `r1` à `r2`.

Le document source n’est pas corrompu. Mais une relation visible peut représenter plusieurs relations documentaires sans le dire : sélection, présence, édition, inspection et commentaires futurs ne peuvent pas s’appuyer proprement sur cet ID.

**Refactoring :** une projection de graphe visible explicite, avec une identité canonique et `sourceRelationIds` ordonnés. Les gestes doivent être traduits vers le document selon une politique définie. Construire aussi un index d’ancêtres visibles, utiliser un `Set` pour les groupes fermés et éviter de parcourir toute la hiérarchie pour chaque extrémité. Ce changement apporte d’abord une correction conceptuelle ; son gain de performance reste à mesurer.

**A8 — P2 : la projection complète est invalidée à chaque update et la scène disparaît pendant le recalcul. Coûts observables dans le code ; impact de latence non chiffré.**

Le [client relit et publie le document entier](/Users/thomas/projects/sequit/src/lib/infrastructure/collaboration/collaborative-session.ts:176). Le [workspace partagé](/Users/thomas/projects/sequit/src/app/web/ui/components/collaboration/CollaborativeWorkspace.svelte:44) recrée une projection, qui [reconstruit graphe, rangs et modèle de mesure](/Users/thomas/projects/sequit/src/app/web/projection/open-document.ts:122). [LogicCanvas](/Users/thomas/projects/sequit/src/app/web/ui/components/canvas/LogicCanvas.svelte:241) remet `canvas` à `undefined`, réinitialise sa signature de mesure, attend les polices et un tick puis remesure.

Le moteur est synchrone, même derrière la [Promise de layoutGraph](/Users/thomas/projects/sequit/src/app/web/projection/layout-graph.ts:26). Une microtask ne déplace pas ce calcul sur un autre thread. Le démontage de la scène expose aussi le focus d’une entité à sa suppression lors d’une modification distante ; cette conséquence n’a pas été reproduite dans un navigateur pendant l’audit.

**Refactoring :** un contrôleur de projection stable avec invalidations texte/style, mesures, topologie et configuration. Réutiliser graphe/rangs si la topologie n’a pas changé, conserver les mesures non invalidées, regrouper les updates avant recalcul et garder la dernière scène valide jusqu’à la publication atomique de la suivante. Préserver la protection existante contre les résultats périmés. Mesurer ensuite le coût restant avant de choisir un Worker ou un moteur réellement incrémental.

**A9 — P2 : Tab reste enfermé dans le canvas. Comportement explicite et testé.**

[RenderedCanvas](/Users/thomas/projects/sequit/src/app/web/ui/components/canvas/RenderedCanvas.svelte:86) intercepte Tab et Shift+Tab et boucle par modulo. Le [test navigateur](/Users/thomas/projects/sequit/tests/app/web/e2e/canvas-interactions.spec.ts:274) impose cette boucle. Escape vide la sélection mais ne sort pas le focus du canvas.

**Correction :** permettre une entrée/sortie standard avec Tab, les flèches servant au déplacement entre entités, ou proposer une sortie clavier explicite et documentée. Tester le parcours complet page → canvas → toolbar → page, au-delà de la navigation interne. Le critère W3C exige qu’un utilisateur puisse quitter un composant au clavier. [Référence W3C](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html).

**A10 — P2 : les catégories d’erreur et l’état de santé réseau sont trop pauvres.**

Le [catch de la room](/Users/thomas/projects/sequit/src/workers/collaboration-worker/collaboration-room.ts:50) traite de la même manière refus métier, erreur de présence et exception de persistance. Le protocole renvoie une chaîne. Une exception d’un abonné appelée pendant [la réception](/Users/thomas/projects/sequit/src/lib/infrastructure/collaboration/collaborative-session.ts:199) peut également devenir un faux « message serveur invalide ». Le [workspace](/Users/thomas/projects/sequit/src/app/web/ui/components/collaboration/CollaborativeWorkspace.svelte:44) transforme toute erreur de projection en problème de repli.

Le [transport](/Users/thomas/projects/sequit/src/lib/infrastructure/collaboration/websocket-collaboration-transport.ts:94) ne reconnecte qu’après fermeture ; il n’a ni heartbeat ni délai de synchronisation. Une socket silencieuse peut donc conserver un statut trompeur jusqu’à la détection par la pile réseau. Il s’agit d’une lacune de contrat et de tests, pas d’une panne réseau physique reproduite ici.

**Refactoring :** erreurs structurées avec catégorie, code, caractère récupérable et ID de commande ; isolation des abonnés ; diagnostic local séparé des rejets serveur ; santé réseau avec échéances et reconnexion avec jitter. Définir des budgets de file, fréquence et volume par room/participant avant exposition publique. Instrumenter tailles, temps d’autorisation/persistance, longueur de file, rejets et reconnexions, sans journaliser les textes utilisateurs.

Le refresh avec perte des frappes non confirmées est [explicitement accepté en V1](/Users/thomas/projects/sequit/docs/design.md:262), ainsi que l’absence de journal navigateur et de reprise après fermeture de page. Ce ne sont pas des oublis de mise en œuvre. Pour atteindre l’ambition de résilience exprimée, il faudra néanmoins revoir ce contrat : une indisponibilité temporaire ne devrait pas être assimilée à une erreur documentaire terminale.

## Clarté, maintenabilité et définitions

**Les contrats de commandes sont plus faibles que les types du domaine.** [SharedDocumentCommand](/Users/thomas/projects/sequit/src/lib/infrastructure/document/shared-document-command.ts:26) emploie des dictionnaires `Record<string, string>` pour `properties` et `set`. Le réseau valide correctement ses entrées, mais les appels internes peuvent construire des combinaisons impossibles que TypeScript accepte. Les listes de champs et leurs règles sont réparties entre codecs, lecteurs Yjs, exécuteur et UI.

Je recommande des commandes applicatives discriminées par type d’élément et des constructeurs pour les gestes fréquents. Garder le décodage runtime strict à la frontière. Mutualiser les règles entre commande locale et partagée, sans refaire deux moteurs : [finalizeSharedCommand](/Users/thomas/projects/sequit/src/lib/infrastructure/document/shared-command-rules.ts:20) réutilise déjà l’ordre et les transformations du core. Cette réutilisation est à préserver.

**La coexistence des sessions locale et partagée doit rester intentionnelle.** Les contrats et comportements de publication, retour de commande et erreurs diffèrent. Une façade applicative de capacités communes — lecture, abonnement, opérations, résultats — facilitera le passage d’un document local à une room. Le binding d’éditeur peut continuer à connaître Yjs ; il n’est pas utile de généraliser un moteur de synchronisation abstrait pour une seule implémentation. Le [FIXME de l’adaptateur Yjs local](/Users/thomas/projects/sequit/src/app/web/document/yjs-document-session.ts:49), sur les merges invalides restant dans le document physique, doit empêcher sa réutilisation naïve comme autorité collaborative. Ce n’est pas le chemin serveur validé de la V1.

**La documentation mélange encore décisions actuelles, hypothèses et bilans.** Exemple objectif : [design.md](/Users/thomas/projects/sequit/docs/design.md:99) indique format 1 et absence de version dans `LogicDocument`, alors que le [modèle](/Users/thomas/projects/sequit/src/lib/core/document/logic-document.ts:6) porte format 2. Le [lexique du biais](/Users/thomas/projects/sequit/docs/visual-language.md:186) promet des déplacements entre rangées que [placement-rows.ts](/Users/thomas/projects/sequit/src/lib/core/layout/structure/placement-rows.ts:4) n’implémente pas généralement. La version réseau 3 appartient, elle, au travail local en cours et doit être mise à jour avec ce lot.

Il faut un contrat courant court, indiquant pour chaque règle son statut : implémentée, spécification exécutable encore rouge, proposition, décision abandonnée. Ajouter une référence à son scénario. Une mise à jour ciblée des documents de référence aura davantage de valeur qu’un nouveau document d’architecture général.

**Les seuils de lint ne suffisent pas à définir la lisibilité.** Les règles sont strictes et utiles, mais certaines contraintes concernent les fichiers TypeScript et pas les composants Svelte ; des exceptions explicites existent pour le mapping TOML et certains algorithmes. Ne pas durcir mécaniquement les seuils ni fragmenter les fonctions pour satisfaire une métrique. Pour [mapSequitDocument](/Users/thomas/projects/sequit/src/lib/infrastructure/toml/map-sequit-document.ts:189), extraire des lecteurs par entité et garder une orchestration linéaire paraît utile. Éviter une DSL de validation générique qui cacherait les règles et les diagnostics.

Pour chaque optimisation moins évidente, demander : quel travail répété évite-t-elle, qui possède les données mutables, quel invariant protège l’aliasing, quelle mesure la justifie ? Les voisinages partagés répondent déjà assez bien à ces questions. Les relectures/clonages/reconstructions répétés aux frontières applicatives sont une cible plus prometteuse que la suppression de ces optimisations locales.

## Performance et force réelle des tests

**Mesures fraîches sur Apple M1 Max, Node 24.20.0 et pnpm 12.3.4 :** 59 des 60 snapshots respectent leur budget. Le biparti dense à 1 000 nœuds atteint 115,70 ms de médiane pour un budget de 100 ms. Les groupes imbriqués à 1 000 nœuds prennent 5,38 ms, les relations entre groupes 2,58 ms, et le profil riche en jonctions 7,41 ms. Le replay incrémental ciblé `group-relations` passe ses cinq tranches ; sa tranche 100–999 atteint 4,60 ms de p95 total pour un budget de 5 ms. Les anciennes difficultés sur les groupes ne doivent donc pas être présentées comme encore actuelles sur la seule base de notes historiques.

Il s’agit d’une capture par suite, sans validation lourde simultanée, mais avec les applications habituelles et le serveur de développement présents. Ce sont des observations locales, pas une comparaison avant/après démontrant une régression ou un gain. La matrice incrémentale entière et la latence navigateur n’ont pas été remesurées. Les rapports conservent l’environnement, les échantillons et l’empreinte des sources.

Le dispositif de performance est honnête et bien documenté : fixtures déterministes, mesures par phase, conditions et empreintes de sources, distinction régression/objectifs UX. Le mot « incrémental » désigne ici un replay d’insertions ; [chaque insertion reconstruit plusieurs étapes](/Users/thomas/projects/sequit/tests/support/performance/incremental-layout-timing.ts:39). Ce n’est pas une preuve d’algorithme incrémental.

Le benchmark de snapshot commence avec graphe, rangs et mesures déjà préparés. Il ne couvre pas TOML, CRDT, DOM, rendu Svelte, peinture ou frappe. Le [benchmark d’autorisation](/Users/thomas/projects/sequit/tests/lib/infrastructure/collaboration/performance/authorize-proposal.bench.ts:29) omet `textOnly:true`, utilise un document frais et ne mesure ni stockage ni diffusion. La création de relation y passe par une update brute, alors que le produit emploie des commandes.

**Instrumentation à ajouter avant de décider les optimisations :**

- Coût local : saisie/composition → texte visible, puis → scène stable ; nombre de layouts par rafale, p95, longues tâches, allocations et mémoire.
- Coût distant : update reçue → texte/scène visibles ; zoom, pan et focus pendant la réception.
- Serveur : texte et commandes par leur véritable chemin, sur documents frais et vieillis, tailles de room et nombres de participants distincts ; validation, persistance et diffusion mesurées séparément.
- Périmètre pris en charge : tailles documentaires, profondeur, densité de relations et nombre de participants annoncés, avec comportement défini lorsqu’une limite est atteinte.

Les objectifs existants de 16 ms pour la projection synchrone et 50 ms pour le calcul total restent des objectifs ; les budgets calibrés ne doivent pas les remplacer. Une marge de 100 ou 205 ms peut détecter certaines régressions tout en laissant passer une expérience trop lente. Les benchmarks sont hors `pnpm check` et ne sont pas un contrôle de performance navigateur en CI.

La couverture web de 98 % concerne [les fichiers TypeScript inclus](/Users/thomas/projects/sequit/config/vitest.config.ts:14), ainsi que certains scénarios et supports. Les fichiers `.svelte` ne sont pas inclus dans ce pourcentage. Les E2E apportent une autre preuve, qu’il faut lire séparément. Le [périmètre de mutation](/Users/thomas/projects/sequit/config/stryker.config.json:34) inclut structure/placement mais pas l’ensemble de `routing/`. Son exécution hebdomadaire ne prouve pas que toutes les zones critiques ont été mutées ; elle n’a pas été relancée ici.

Les investissements de tests les plus rentables sont des compositions et séquences absentes des exemples actuels :

1. Reprise avec acquittement perdu, éviction, duplication, redémarrage et socket silencieuse.
2. Édition riche conservant les blocs non édités ; composition IME pendant modification distante.
3. Groupes peuplés/imbriqués avec jonctions et arcs longs ; absence de route dans les obstacles, dans toutes les directions compatibles.
4. Projection/repli stable sous permutation, avec provenance des arcs visible et gestes ambigus interdits.
5. Vieillissement CRDT, bornes de présence/persistance, lots composés et échec de stockage.
6. Focus, scroll et scène stables pendant update distante ; parcours clavier sortant du canvas.

Le projet teste actuellement Desktop Chrome. WebKit, Firefox et les parcours mobiles critiques doivent faire partie de l’élargissement de validation avant une promesse d’accès universel. Aucune faille XSS n’a été confirmée : le [contenu des nœuds](/Users/thomas/projects/sequit/src/app/web/ui/components/canvas/NodeContent.svelte:7) est actuellement affiché comme texte échappé. Cela ne constitue pas un audit de sécurité exhaustif de toutes les dépendances ou d’un déploiement.

## Préparer groupes, swimlanes et sous-layouts

Aujourd’hui, un groupe combine appartenance hiérarchique, enveloppe graphique, extrémité de relation et repli. Il n’a pas son propre layout : [LogicDocument](/Users/thomas/projects/sequit/src/lib/core/document/logic-document.ts:144) définit une seule configuration pour tout le document, et les bandes sont globales. Les relations visant un groupe [se développent sur ses membres](/Users/thomas/projects/sequit/src/lib/core/graph/create-graph.ts:257). Ce modèle convient à l’agencement actuel ; il ne définit pas encore la composition de raisonnements autonomes.

| Concept                | Rôle à définir                                  | Question de produit déterminante                                                                             |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Groupe logique         | Appartenance, sous-ensemble, repli, frontières  | Relier le groupe signifie-t-il relier tous ses membres, son interface, ou le raisonnement qu’il représente ? |
| Swimlane               | Partition visuelle et contraintes d’alignement  | L’acteur ou la responsabilité est-il indépendant du groupe logique ? Quelles dimensions sont partagées ?     |
| Cellule de grille      | Placement dans une composition                  | Taille libre, partagée par ligne/colonne, ou contrainte ?                                                    |
| Portée de layout       | Calcul local avec orientation et règles propres | Quels éléments/ports sont exposés aux relations externes ?                                                   |
| Relation entre portées | Traversée d’une frontière                       | Lien vers une interface exposée ou vers un élément profond ? Que montre le repli ?                           |

**Préparation immédiate :** clarifier les groupes et leur projection ; introduire une notion explicite de frontière/port dans le calcul là où elle corrige A6 ; isoler les entrées et sorties d’une portée unique sans changer le comportement. L’index d’appartenance et le graphe visible sont des extractions utiles dès maintenant.

**Quand le second mode devient concret :** calculer un sous-layout dans son repère local, obtenir dimensions et ports exposés, placer les cellules/contenants parents, puis traduire les coordonnées et router les relations entre portées. Réutiliser la géométrie et les algorithmes actuels à l’intérieur d’une portée. Les transformations parent/enfant doivent rester explicites ; le `CanvasModel` actuel est une scène plate.

Ne pas coder maintenant un framework de stratégies sans deuxième cas réel. Ne pas représenter une swimlane simplement comme un groupe étiré : cela mélangerait dépendances sémantiques et contraintes de présentation. Une extension de schéma impliquera TOML, Yjs, commandes, validation et compatibilité de protocole ; ces migrations appartiennent au même lot fonctionnel.

Pour les business processes, décider aussi si les boucles métier doivent être exprimables. Le modèle actuel rejette les cycles et les relations pointent de l’enfant vers le parent. Une présentation différente peut suffire à certains processus ; d’autres demanderont une sémantique distincte. Cette décision précède une éventuelle généralisation du modèle de graphe.

## Ordre de travail recommandé

| Lot                         | Résultat attendu                                                                                  | Périmètre et condition de réussite                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Contrôle fiable         | Un état reproductible et un signal de validation lisible                                          | Aligner pnpm/lockfile, résoudre les deux attentes E2E obsolètes selon le contrat courant, documenter les spécifications encore absentes |
| 1 — Conservation et reprise | Une édition conserve le reste ; une commande n’est jamais rejouée comme nouvelle après expiration | A1 et A2, tests ciblés métier/Worker et vrais documents Markdown                                                                        |
| 2 — Capacité et échecs      | Présence bornée, erreurs récupérables distinctes, santé réseau explicite                          | A3/A4/A10 ; preuves de vieillissement et reprise, sans changer la GC à l’aveugle                                                        |
| 3 — Groupes et routage      | Tout document du périmètre géométrique annoncé se projette sans obstacles traversés               | A5/A6/A7 ; scénarios de composition, provenance et permutations                                                                         |
| 4 — Interaction fluide      | Une update distante ne détruit ni focus, ni scène, ni navigation                                  | A8/A9 ; projection stable, invalidations ciblées, mesures navigateur                                                                    |
| 5 — Contrats applicatifs    | Les opérations impossibles sont difficiles à exprimer et les diagnostics restent exploitables     | Commandes typées, convergence des capacités locales/partagées, documentation courante                                                   |
| 6 — Composition future      | Deux portées de layout réelles peuvent se composer sans casser le cas existant                    | Contrats swimlane/cellule/ports décidés, migration versionnée, second mode concret                                                      |

Les lots 1 à 4 justifient des changements cohérents avec leurs tests et leur documentation. Pour chaque lot, conserver `quality:fast` comme contrôle local et `check` avant intégration ; ajouter le benchmark ciblé concerné. Ne pas faire passer un contrôle en abaissant les assertions, les seuils ou la portée de l’audit.

L’objectif de robustesse doit se traduire en garanties vérifiables : conservation du contenu, reprise définie, atomicité de la structure, capacité documentée, continuité de l’interaction et latence mesurée. Une couverture élevée ne suffit pas à garantir l’absence de bugs ; ces contrats rendent les défauts restants observables, reproductibles et corrigeables.

## Annexe de validation

| Contrôle                                         | Résultat de l’audit                                                                                            | Limite d’interprétation                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Premier `quality:fast` sur le checkout initial   | Réussi : lint, Knip, architecture, couverture et duplication ; 2 253 tests web et 38 Worker                    | `mise` sélectionne pnpm 12, mais le champ `packageManager` local redirige alors vers pnpm 8.7.6                                         |
| Couverture de ce passage                         | Branches : 98,02 % web, 98,42 % Worker ; duplication globale mesurée : 0,90 %                                  | Ne couvre pas les composants Svelte dans le pourcentage web ; aucune garantie de tous les ordonnancements                               |
| Répétition de `quality:fast` en imposant pnpm 12 | Échec : un test d’intégration ESLint dépasse 5 s ; 2 252 tests web passent                                     | Exécutée avec d’autres validations, donc sensible à la contention ; la suite complète n’est pas déclarée verte pour cette répétition    |
| Reprise isolée du fichier ESLint concerné        | 67 tests réussis                                                                                               | Valide ce fichier, pas un nouveau passage complet de `quality:fast`                                                                     |
| Format et types                                  | Réussis ; Svelte : 0 erreur, 0 avertissement ; types Worker et tests vérifiés                                  | Passage après remise en état des dépendances par les outils                                                                             |
| E2E complets                                     | 140 réussis / 145 ; 5 échecs                                                                                   | Deux attentes anciennes et trois erreurs de chargement Vite, distinguées ci-dessous                                                     |
| Relance isolée des trois E2E Quill               | 3 réussis / 3, avec serveurs redémarrés                                                                        | Les traces précédentes montrent HTTP 504 `Outdated Optimize Dep` sur le module Quill ; pas trois bugs produit supplémentaires           |
| Build web et Worker                              | Réussis ; Worker en dry-run, aucun déploiement                                                                 | Ce n’est pas une validation d’exploitation dans Cloudflare déployé                                                                      |
| Snapshots performance                            | 59 dans le budget / 60                                                                                         | Biparti dense 1 000 : 115,70 ms, budget 100 ms ; commande rouge                                                                         |
| Replay incrémental des relations entre groupes   | 5 tranches dans le budget                                                                                      | 100–999 : 4,60 ms p95 ; aucune conclusion sur la matrice incrémentale entière                                                           |
| Preuves ciblées                                  | Replay après 128 commandes, croissance historique, taille de présence, Quill et trois cas de projection/layout | Les niveaux de preuve sont détaillés dans chaque constat ; les trois cas layout ont été relancés avec validation documentaire explicite |

Les deux E2E qui restent à résoudre sont [l’attente d’attachement sous l’en-tête du groupe](/Users/thomas/projects/sequit/tests/app/web/e2e/ai-documentary-effort.spec.ts:114), alors que le contrat courant impose les faces principales, et [le nombre fixe de scénarios](/Users/thomas/projects/sequit/tests/app/workshop/e2e/visual-tests.spec.ts:218), qui attend 32 au lieu de 33. Ils étaient déjà décrits dans le bilan de validation de la collaboration ; les mêmes symptômes ont été observés aujourd’hui. Aucun checkout historique séparé n’a été relancé pendant cet audit. Ces assertions doivent être mises en accord avec la décision produit vérifiée, pas supprimées sans remplacement.

**Reproductibilité de l’environnement : problème local confirmé.** Le travail en cours ajoute `packageManager: pnpm@8.7.6` alors que `mise.toml` impose 12.3.4 ; le lockfile initial est au format 6 au lieu du format 9 de HEAD et a perdu les overrides présents dans ce dernier. `mise exec -- pnpm --version` retourne effectivement 8.7.6. Imposer la version 12 avec `npm_config_manage_package_manager_versions=false` a déclenché une réconciliation automatique des dépendances ; une première commande de types a échoué sur la résolution de `workerd@1.20260911.1`, avant qu’une autre invocation rétablisse l’arbre installé et un lockfile v9. Ce comportement rend les résultats d’une installation propre incertains tant que la configuration n’est pas alignée.

Le lockfile de départ a été restauré à l’identique à la fin de l’audit. Une comparaison binaire du diff suivi avant/après confirme que les modifications préexistantes ont été conservées ; seul ce rapport est ajouté par l’audit. L’arbre local de dépendances a été réconcilié par les commandes pnpm. Les mesures avec pnpm 12 portent sur cet environnement installé, avec leurs empreintes enregistrées. **Aucun `pnpm check` complet réussi n’est revendiqué.** Mutation hebdomadaire, audit de vulnérabilités des dépendances, test de charge déployé et mesures multi-navigateurs n’ont pas été exécutés.

## Note de préparation des commits — 14 septembre 2026

Après cet audit, le champ `packageManager` a été aligné sur pnpm 12.3.4, conformément à `mise.toml`. Le lockfile a été régénéré avec cette version à partir de celui de HEAD, en conservant les overrides du dépôt et en ajoutant les dépendances Quill. Les constats d’environnement ci-dessus décrivent donc l’état initial de l’audit. Cette correction ne résout pas les constats applicatifs A1 à A10.
