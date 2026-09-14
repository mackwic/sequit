# Remédiation de l’audit du 14 septembre 2026

Ce chantier applique les constats A1–A10 de [l’audit](architecture-audit-2026-09-14.md). Les décisions ci-dessous ont été précisées avec Thomas le 14 septembre. Les résultats de validation sont consignés après exécution ; une cible ne vaut pas une garantie déjà mesurée.

## Contrats retenus

- **Texte** : TOML conserve du Markdown. Sa syntaxe peut être normalisée si le contenu et la mise en forme sont conservés. Le choix de l’éditeur privilégie une intégration simple. Yjs reste le moteur de coédition ; aucune migration vers un nouveau modèle riche n’est nécessaire pour corriger les pertes actuelles.
- **Corps** : gras, italique et souligné. Le souligné utilise la balise Markdown/HTML `<u>`. Un contenu importé plus riche reste conservé ; il n’est pas aplati pour entrer dans le profil du corps.
- **Description** : champ Markdown optionnel distinct du corps, sans effet sur la taille de la carte. Titres, listes et tâches, citations, liens, code avec langage, tableaux et images par URL avec texte alternatif constituent le périmètre documentaire souhaité. Les formats que la projection riche ne conserve pas restent éditables en source. Description vide et absence sont équivalentes.
- **Couleur du texte** : amélioration souhaitable via la palette existante, secondaire à la conservation et à la simplicité du format.
- **Reprise** : modifications non confirmées conservées tant que l’onglet reste ouvert. Aucun journal navigateur durable ni récupération après fermeture requis. L’undo reste local au champ ouvert, pour les actions de la personne.
- **Groupes repliés** : les éléments masqués ne sont pas accessibles à la modification. Une flèche unique vers l’intérieur reste supprimable ; son extrémité visible peut être réaffectée, son extrémité masquée est verrouillée. Un agrégat verrouille ses deux extrémités et sa suppression retire atomiquement toutes ses relations sources. Un repli ambigu conserve une vue dépliée avec explication.
- **Déploiement** : changement de protocole et rechargement des clients acceptables à ce stade. Préserver les documents confirmés et leurs identifiants ; aucun effacement des rooms.
- **Cible** : ordinateur courant, Chrome/Firefox/Safari, jusqu’à 1 000 boîtes et 50 personnes connectées, principalement une personne présentant et des personnes observant. Consultation mobile. Vérifier séparément calcul, interaction et diffusion ; les mesures locales ne certifient pas un déploiement Cloudflare.

## Lots d’implémentation

1. Conservation et reprise : conservation Markdown, description, reçus de commandes persistés avec l’état accepté.
2. Capacité et erreurs : collecte du contenu supprimé après validation, présence bornée indépendamment du document, surveillance et catégories d’échec. Régression minimale : 600 insertions/suppressions de 16 Kio et reprise d’un client ancien.
3. Groupes et routage : arcs longs ordinaires, jonctions aux frontières des groupes, provenance et identité déterministe des relations agrégées.
4. Interaction : projection stable, invalidation ciblée, géométrie réutilisée à dimensions constantes, calculs regroupés par frame, sortie clavier et continuité de scène/focus.
5. Contrats applicatifs et validation : commandes typées, documents de référence à jour, régressions comportementales et contrôles du dépôt sans affaiblir les seuils.

Swimlanes, cellules de grille et nouveaux parcours de partage feront l’objet de lots fonctionnels ultérieurs. Leur modèle n’est pas anticipé par un framework supplémentaire dans cette remédiation.

## Modifications réalisées

| Constat | Changement                                                                                                                                                                                    | Preuve comportementale principale                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1      | Identité de session et séquence de commandes ; reçus persistés atomiquement avec le document. Le client conserve la trame encodée jusqu’à confirmation.                                       | Rejeu après 150 commandes et éviction réelle du Durable Object ; absence de trou après une commande locale invalide.                                  |
| A2      | Profils Quill séparés pour corps et description ; passage en source dès qu’une conversion riche serait destructive. Le TOML et les textes Yjs restent en Markdown.                            | Conservation exacte d’un document riche pendant une frappe, édition distante et aller-retour TOML ; rendu sûr de gras/italique/souligné sur la carte. |
| A3      | Collecte Yjs après autorisation du candidat puis après application du commit, sans recréer le document ni ses identifiants.                                                                   | 600 cycles insertion/suppression de 16 Kio sur le véritable chemin d’autorisation ; retour d’une réplique ancienne et undo/redo local.                |
| A4      | Présence limitée à 16 éléments sélectionnés par personne ; données éphémères invalides et erreurs de sockets isolées du document.                                                             | 50 sockets sous workerd, sélections de 1 000 éléments, réception d’un commit par les 50 participants.                                                 |
| A5      | Les relations longues ordinaires passent par les couches de routage intermédiaires.                                                                                                           | Relation sautant un rang, sans jonction, sans traverser la boîte intermédiaire.                                                                       |
| A6      | Réservation de canaux aux frontières effectives des groupes pour les jonctions.                                                                                                               | Groupes peuplés, imbriqués et contraints en taille, dans les directions de layout supportées.                                                         |
| A7      | Projection repliée avec provenance, identité déterministe et capacités de modification des extrémités. Suppression atomique des sources d’une flèche agrégée.                                 | Permutations des entrées ; suppression de 150 relations via projection, codec CBOR et exécuteur ; parcours navigateur des éléments masqués.           |
| A8      | Préparation du graphe et géométrie réutilisées par document ouvert ; invalidation selon topologie et mesures ; recalculs regroupés par frame. La scène reste montée pendant les mises à jour. | Deux contextes navigateur : update distante, même élément DOM, focus, sélection et zoom conservés ; calcul rejeté réessayable.                        |
| A9      | Une entrée Tab dans le canvas, déplacement interne avec les flèches, sortie Tab native.                                                                                                       | Entrée, déplacement, sortie et retour au dernier élément focalisé dans les trois moteurs navigateur.                                                  |
| A10     | Messages Retry/Reject distincts, attente de disponibilité bornée, ping et détection des sockets silencieuses, isolation des abonnés.                                                          | Erreurs temporaires de stockage, présence pendant une reprise, socket muette et abonné défaillant.                                                    |

Les commandes structurelles utilisent maintenant une union discriminée corrélant le type d’entité, ses propriétés autorisées et ses champs optionnels. Une modification structurelle ne peut plus transporter un champ textuel arbitraire. La validation à la frontière réseau reste nécessaire en complément des types TypeScript.

La mesure complète d’A8 a également révélé un coût de rendu absent du chronomètre de projection : sur l’arbre de 1 000 nœuds, le délai de saisie vers le DOM distant approchait trois secondes. Le profil CPU local attribuait environ 1,3 seconde par navigateur à la dérivation des chemins des relations, avec de nombreux accès aux proxies Svelte. Les instantanés documentaires et géométriques immuables utilisent désormais une réactivité sur leur remplacement ; l’identité des relations et les chemins rendus sont conservés tant que géométrie et provenance restent identiques. La réception de présence ne relit plus inutilement le document dans l’atelier.

La dernière passe sans capture Playwright, sur huit mises à jour entre deux contextes Chromium et le Worker local, observe une médiane de **3,10 ms** pour mesure DOM et projection (2,9–9,1 ms), et de **136,30 ms** de l’événement `beforeinput` au DOM distant (115,2–160,2 ms). Ces huit observations ne constituent ni un p95 représentatif ni un objectif de latence garanti. Le test enregistre les deux séries et son mode de capture dans `browser-projection.json` ; il reste un scénario d’observation sans seuil de performance inventé.

Les contrats actuels sont décrits dans [design.md](design.md), [collaboration-resilience.md](collaboration-resilience.md) et [layout-routing.md](layout-routing.md). L’audit et le plan V1 restent des documents historiques.

## Validation finale

Exécution locale le 14 septembre 2026, avec Node 24.20.0 et pnpm 12.3.4 via `mise`, sur Apple M1 Max alimenté sur secteur. Le dépôt est basé sur `31113a1` avec les modifications de cette remédiation. Aucun seuil n’a été abaissé.

| Contrôle                             | Résultat                                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                         | Réussite complète : format, types, `quality:fast`, E2E et builds web/Worker. Le build Worker est un dry-run, sans déploiement.                                                      |
| Tests applicatifs                    | 2 424 tests passent dans 133 fichiers. Couverture : 99,31 % instructions, 98,09 % branches, 99,31 % fonctions, 99,60 % lignes.                                                      |
| Tests Worker sous workerd            | 46 tests passent dans 5 fichiers. Couverture : 100 % instructions/fonctions/lignes, 98,66 % branches.                                                                               |
| Navigateurs                          | 187 tests passent : suite Chromium complète, parcours critiques Firefox/WebKit, consultation mobile WebKit.                                                                         |
| Snapshots du moteur                  | **59/60 dans le budget. Commande en échec** pour `wide-bipartite-layers/1000` : médiane 116,68 ms, budget strict de 100 ms. Ce cas était déjà hors budget dans l’audit (115,70 ms). |
| Replay incrémental `group-relations` | 5/5 tranches dans le budget ; p95 total de 4,18 ms sur la tranche 100–999, budget de 5 ms.                                                                                          |
| Nouveau profil arcs longs            | Chaîne avec liaison dernier→premier : moyenne 0,66 ms à 100 nœuds et 8,19 ms à 1 000 nœuds. Observation sans nouveau seuil calibré.                                                 |

La couverture applicative concerne le périmètre TypeScript de la configuration Vitest ; elle ne représente pas un pourcentage de couverture des composants Svelte. Les E2E vérifient ces interactions séparément. La mutation et la matrice incrémentale entière n’ont pas été relancées.

Les rapports de performance du moteur sont complets, avec empreinte de sources inchangée et aucune validation lourde concurrente détectée. Ils conservent échantillons et environnement. Les valeurs de l’audit servent de contexte historique : aucune comparaison avant/après certifiée par `performance:compare` n’est revendiquée, car l’empreinte du protocole inclut une documentation de benchmark modifiée depuis l’audit.

Les journaux, profils CPU et mesures sont conservés dans le [dossier de preuves de remédiation](/Users/thomas/.codex/visualizations/2026/09/14/01a09f0d-745d-7093-9ad1-f9df72a1a3c0/sequit-architecture-audit/remediation/README.md).

## Limites maintenues

- Les couleurs du texte restent à ajouter. Les tableaux, tâches et autres constructions que Quill ne conserve pas fidèlement restent modifiables en source.
- La reprise protège l’onglet ouvert. Fermer celui-ci peut perdre les modifications encore non confirmées.
- La collecte des contenus supprimés ne rend pas infinie la capacité de stockage. Le plafond de snapshot reste à 960 Kio ; les reçus de sessions occupent des clés distinctes et leur rétention devra être réévaluée avec l’usage réel.
- Le scénario de 50 sockets est local. Il ne mesure pas la latence, les conditions réseau, les coûts ou la capacité du déploiement Cloudflare.
- Le scénario navigateur mesure séparément la collecte des dimensions DOM et la projection, puis le délai entre l’événement de saisie et la mutation du DOM chez l’observateur. Ce second délai inclut la diffusion locale entre les deux contextes, sans inclure le polling Playwright. La peinture et la latence Cloudflare en production restent hors mesure. Ces observations complètent les benchmarks du moteur sans constituer à elles seules un objectif de fluidité validé.
- Les changements de protocole nécessitent le rechargement des anciens clients. Les documents confirmés et les identifiants existants sont conservés.
- Le cas dense hors budget reste à optimiser. Le build signale également un chunk JavaScript de 532,77 Ko minifié (126,10 Ko gzip) : le coût de premier chargement reste un sujet distinct de la frappe sur un document ouvert.
