# Résilience de la collaboration

Le protocole CBOR v4 conserve les documents Yjs existants. Un client utilisant un
ancien protocole doit recharger la page. Les descriptions absentes ou stockées
comme chaînes sont migrées en `Y.Text` au chargement de la room, puis persistées
avant son ouverture aux participants. Une description vide est absente de la
projection portable ; son `Y.Text` vide garde son identité dans le document actif.

## Commandes et reprise

Chaque instance ouverte de `CollaborativeSession` reçoit un `sessionId` aléatoire.
Ses commandes portent une séquence positive consécutive. Le client valide et
encode la commande avant de consommer la séquence et conserve la trame exacte
jusqu'au commit. Une commande locale invalide ne crée donc aucun trou et une
modification ultérieure de l'objet fourni par l'appelant ne change pas un rejeu.

Le serveur persiste la dernière séquence acceptée sous une clé
`command-session:<sessionId>`, dans la même transaction que le document et son
numéro de commit. Une séquence déjà acceptée renvoie l'état actuel sans réexécuter
la commande. Une séquence future présentant un trou demande une resynchronisation.
Ces reçus ne sont pas évincés après un nombre arbitraire de commandes. Les anciens
reçus UUID du format de stockage restent lisibles mais ne gouvernent pas les
commandes v4. Une commande atomique `deleteRelations` peut supprimer les sources
d'une relation agrégée sans consommer une commande par relation ; la limite de
100 commandes par lot est conservée et la taille de la trame borne la liste.

Une panne temporaire de stockage ou un trou de séquence produit un message
`Retry`. Le client garde son document, ses textes locaux et ses commandes en
mémoire, puis recommence la synchronisation après une seconde. Les erreurs de
protocole ou les mutations incompatibles avec le domaine sont terminales et
produisent `Reject`. Aucune reprise des modifications non confirmées après
fermeture de la page n'est promise : il n'y a pas de journal navigateur durable.

## Collecte des données supprimées

Les candidats de validation utilisent toujours `gc: false`. Le filtre des mises
à jour de texte doit pouvoir inspecter les structures supprimées pour distinguer
un changement de texte d'une mutation structurelle interdite.

Après autorisation, `compactRoomDocument` libère les contenus supprimés à l'aide
de la collecte Yjs. Les horloges et ensembles de suppressions restent présents ;
aucun nouveau document ni nouvel identifiant d'époque n'est créé. Le serveur
persiste le candidat compacté avant d'appliquer et de diffuser le commit. Il
compacte également son document actif après application. L'undo du texte reste
local au client et son `UndoManager` conserve les contenus dont il a besoin.

Cette collecte borne l'accumulation des contenus supprimés dans les scénarios
testés. Elle ne garantit pas une taille constante pour une histoire infinie de
clients, d'identifiants ou de mutations structurelles. La limite existante de
snapshot reste applicable ; les reçus de sessions occupent des clés séparées.

## Présence et santé de la connexion

La présence ne modifie jamais le document. Une sélection expose au maximum
16 éléments ; les noms, couleurs et positions relatives sont bornés. Une trame
contient au maximum 128 participants. Le test des valeurs maximales vérifie une
présence individuelle inférieure à 6 Kio et une trame de room inférieure à 1 Mio.
Une présence malformée, un champ inconnu ou une erreur d'attachement est ignoré.
La diffusion encode la liste une seule fois puis isole les erreurs de chaque
socket. Les erreurs des abonnés du client sont également isolées et signalées
par `reportError` lorsque cette API existe.

Le transport attend au plus 10 secondes le message de disponibilité. Après
15 secondes sans message, il envoie un ping ; 10 secondes sans réponse déclenchent
la reconnexion. La reconnexion utilise le délai progressif existant de 1 à
30 secondes. Ces temporisations détectent une socket silencieuse et ne constituent
pas un objectif de latence de production.

## Vérifications reproductibles

Depuis la racine du dépôt :

```sh
mise exec -- pnpm run test:web tests/lib/infrastructure/collaboration
mise exec -- pnpm run test:coverage:collaboration
```

- `room-gc.test.ts` traverse l'autorisation réelle pour 600 insertions de 16 Kio
  suivies de 600 suppressions. Le snapshot final doit rester sous 10 000 octets.
  Une réplique restée hors ligne avant ces cycles rejoint ensuite le même état.
  Les tests couvrent aussi undo/redo local, édition d'un texte dont le nœud a été
  supprimé et structures interdites masquées par la collecte côté client.
- `resilience.test.ts` vérifie le rejeu ancien après 150 autres commandes et une
  éviction réelle du Durable Object, les trous de séquence et l'atomicité en cas
  d'échec de stockage.
- Le même test connecte 50 sockets sous workerd, envoie des sélections de
  1 000 éléments, vérifie leur réduction à 16 et la réception d'un commit par les
  50 participants sans déconnexion. C'est un scénario de charge local, pas une
  mesure de latence ni une preuve de capacité en production.
- Les tests du client vérifient la reprise malgré des mouvements de présence,
  l'absence de trou après une commande locale invalide et l'isolation des abonnés.
