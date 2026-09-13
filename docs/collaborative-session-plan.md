# Première implémentation de la collaboration

Plan simplifié, 13 septembre 2026. La cible reste la coédition fine de tout le
document ; cette première version est implémentée avec les mécanismes ci-dessous.

## Architecture retenue

- Un seul `Y.Doc` logique, répliqué dans chaque navigateur et dans la room serveur.
- Des collections `Y.Map` indexées par ID, contenant les `Y.Map` des éléments.
- Des `Y.Text` imbriqués pour le Markdown, le titre et les libellés ; les autres
  propriétés, dont le style, sont modifiées champ par champ.
- Un textarea relié au `Y.Text`. Pas de CodeMirror ; Quill reste un éventuel repli.
- Une connexion WebSocket par client, avec notre protocole encodé en CBOR.
- Le serveur valide les changements, les persiste puis diffuse les updates Yjs
  acceptées à tous les clients, auteur compris.
- Le canvas et le TOML restent des projections du document. Le layout calcule les
  positions ; aucune commande `move`.

Réutiliser le Worker, le Durable Object, les règles métier, la persistance et le
transport existants. Adapter la session actuelle pour garder le document Yjs et
ses textes stables pendant l’édition. Le cœur reste indépendant de Yjs et du réseau.

## Opérations

| Opération      | Usage                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| `create`       | Créer un élément, y compris une relation                               |
| `update`       | Modifier ses propriétés ; pour le texte, transporter une update Yjs    |
| `delete`       | Supprimer un élément et traiter ses références selon les règles métier |
| `group`        | Créer un regroupement et y affecter les éléments, atomiquement         |
| `ungroup`      | Dissoudre un groupe en conservant ses éléments                         |
| `updateLayout` | Modifier direction et biais ensemble                                   |

Replier ou déplier est un `update` du groupe avec `state = closed` ou `expanded`.
Cet état est partagé. Relier/délier correspond à créer/supprimer une relation.
Un changement de propriété ordinaire affecte ou retire seulement le champ ciblé.

## Trajet d’une modification

Pour la structure et les propriétés ordinaires :

```text
Action → commande CBOR → validation serveur → mutation Yjs
       → persistance → diffusion de l’update → affichage chez tous
```

**Simplification retenue pour cette première version :** attendre l’acceptation
pour modifier le graphe affiché. Pas d’overlay structurel optimiste à reconstruire.
L’interface peut afficher une action en attente. Un refus déclenche le
rechargement décrit ci-dessous. Une création
refusée n’a ainsi pas encore de texte partagé ou d’autres mutations qui en dépendent.

Pour le texte :

```text
Saisie → modification immédiate du Y.Text → buffer → update enveloppée en CBOR
       → validation serveur → persistance → diffusion et fusion chez tous
```

Le texte reste éditable pendant les échanges réseau, sans bouton Enregistrer.
Yjs fusionne les modifications fines ; notre adaptateur maintient le textarea
et sa sélection. Ne pas remplacer tout le texte à chaque frappe et ne pas rejouer
les commandes chez les destinataires : ils intègrent les updates acceptées.

Les updates textuelles locales sont regroupées dans un petit buffer : envoi après
50 ms sans nouvelle frappe, et au plus tard 500 ms après la première update du
lot, même si la saisie continue. Fusionner les updates avec `Y.mergeUpdates`,
puis vider le lot envoyé. L’affichage local reste immédiat ; les updates reçues
du serveur ne réalimentent pas ce buffer.

Le serveur vérifie qu’une update annoncée comme textuelle ne modifie pas la
structure. En cas de refus, envoyer `reject`, fermer la connexion et recharger
la page avec le message d’erreur encodé dans la querystring. Après rechargement,
afficher ce message en toast-notification, puis retirer le paramètre de l’URL
pour ne pas répéter le toast. Recharger l’état accepté de la room.

Ce refus est terminal pour la session locale : arrêter le buffer et la reconnexion
automatique avant le refresh. Pas de rollback, de récupération des dépendances
ni de conservation obligatoire des modifications non confirmées. Les pertes
éventuelles liées à ce rechargement sont un compromis explicitement accepté.

## Messages réseau

Six familles suffisent pour commencer :

| Message      | Rôle                                                                 |
| ------------ | -------------------------------------------------------------------- |
| `initialize` | Proposer le document initial, accepté uniquement si la room est vide |
| `sync`       | Transporter SyncStep1 et SyncStep2 de `y-protocols`                  |
| `change`     | Envoyer une commande avec ID, ou une update textuelle sans ID        |
| `commit`     | Diffuser l’update acceptée ; corréler la commande si nécessaire      |
| `reject`     | Signaler le refus avant fermeture et rechargement                    |
| `presence`   | Indiquer qui est là et quels éléments sont sélectionnés              |

Les commandes structurelles gardent leur ID et leur déduplication. Les updates
textuelles n’ont ni ID applicatif, ni table de déduplication, ni suivi d’acquittement
individuel : Yjs est idempotent. Leur répétition ne réapplique pas la modification.

`sync` enveloppe littéralement les deux étapes de `y-protocols` : SyncStep1
transmet le vecteur d’état ; SyncStep2 répond avec l’update correspondante. Utiliser
ces étapes dans les deux sens pour récupérer l’état serveur et transmettre les
modifications locales après une coupure. Pas de mécanisme de synchronisation
maison ajouté par-dessus. Une update entrante via SyncStep2 passe par la même
validation serveur que les autres updates clientes, avant persistance et diffusion.

Lors d’une coupure réseau ordinaire, conserver le document local en mémoire et
reconnecter : la synchronisation rattrape aussi les frappes restées dans le buffer.
Le refus explicite suit, lui, le chemin terminal fermeture et refresh.

## Trois étapes

1. **Faire traverser la chaîne complète à une modification.** Une room de test,
   deux navigateurs, un `update` de propriété et un `update` textuel. Adapter CBOR,
   validation, diffusion et textarea avec les composants réels.
2. **Brancher les opérations restantes.** Réutiliser les règles existantes pour
   création, suppression, relations, groupes et layout. Ajouter l’état partagé
   `expanded` / `closed`. Les gestes composés restent atomiques côté serveur.
3. **Rendre la session utilisable à deux.** Présence et sélection d’éléments,
   statut de connexion, refus compréhensibles et reprise après coupure tant que
   la page reste ouverte. Vérifier les scénarios métier du plan de validation.

## Ce que cette première version ne cherche pas à résoudre

Reporter le journal IndexedDB des envois non confirmés, la récupération après
fermeture de page, l’undo collaboratif global, la restauration avancée des objets
supprimés, les curseurs textuels distants superposés au textarea et l’optimisation
du stockage par journal/checkpoints. Ne pas annoncer ces garanties dans l’interface.
Une update tardive ne recrée pas un élément supprimé. Si elle est refusée,
appliquer le même chemin simple de fermeture et rechargement.

Conserver la persistance serveur existante et ses limites. Les contenus confirmés
restent rechargeables. Étendre les mécanismes uniquement lorsqu’un usage concret
le demande, sans réécrire préventivement tout le stockage ou le protocole.

Le parcours « page locale → partager une session → URL donnant accès » reste
pour plus tard. Une room connue suffit à valider la collaboration.

## Validation

Utiliser les situations nommées et les scénarios Given / When / Then du
[plan de validation](collaborative-session-validation.md). Ils vérifient les
comportements de Sequit, pas une nouvelle démonstration des propriétés de Yjs.
Conserver les garanties existantes et adapter leurs tests au protocole actif ;
ajouter les contrôles ciblés du binding textarea et des règles métier.

Pendant le développement : tests pertinents via `mise exec -- pnpm`. À la fin
d’un lot d’implémentation : `pnpm run quality:fast` via mise ; avant merge :
`pnpm run check` via mise. Aucun seuil de qualité n’est réduit.

## Ajustements pendant l’implémentation — 13 septembre 2026

- **Initialisation explicite.** Ajout de `initialize { id, update }`. L’update Yjs
  initiale passe la validation complète du document et ne peut être appliquée
  qu’à une room vide. Cela conserve exactement les IDs et l’ordre du document
  initial, sans le reconstruire par des commandes CRUD. Si une autre personne
  a déjà initialisé la room, le serveur renvoie l’état accepté existant ; il ne
  fusionne jamais deux documents initiaux. L’ID concerne cette opération
  structurelle, pas les frappes ni les réponses de synchronisation.
- **Présence simple.** Le client publie sa présence ; le serveur renvoie la liste
  courante des participants. Cette liste remplace la précédente, y compris lors
  d’un départ. Pas de journal ni de persistance documentaire de la présence.
- **Fixtures de layout.** Les biais du modèle actuel suivent l’axe principal :
  `top-to-bottom` avec `top`, puis `left-to-right` avec `left`. Les scénarios
  utilisent ces paires valides ; aucune règle de layout n’est modifiée.

Le codec binaire v1 et son simulateur de serveur sont retirés : les contrats sont désormais vérifiés sur les messages CBOR v2 et le vrai Durable Object dans Workerd. Les cibles de mutation suivent les modules de remplacement, avec les mêmes seuils.

## État livré

Les trois étapes sont implémentées et utilisables dans l’atelier, notamment via
`/atelier/collaboration?room=<room>&name=<nom>` en développement. Le parcours
« Travailler à deux » ouvre aussi deux sessions indépendantes sur une même page.
Les composants de coédition sont dans l’application web ; l’atelier fournit
le point d’entrée de validation en attendant le parcours de partage.

Les résultats détaillés, y compris les deux échecs E2E préexistants du dépôt,
sont consignés dans le [plan de validation](collaborative-session-validation.md#résultat-du-13-septembre-2026).
