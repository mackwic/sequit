# Sequit — document de conception

## Statut

Document de travail. Il décrit l'intention fonctionnelle du produit et les décisions prises au fil des itérations.

## Vision

Sequit est un éditeur visuel collaboratif de graphes logiques, utilisable entièrement dans le navigateur.

L'expérience principale tient dans une page unique composée d'un canvas infini. Les utilisateurs y créent des boîtes typées, éditent leur contenu, les relient et laissent le système organiser automatiquement le graphe.

Le produit reprend :

- la manipulation directe et la collaboration d'un outil comme Excalidraw ;
- la structuration logique et le réagencement automatique de Flying Logic ;
- la portabilité d'une représentation textuelle déclarative comme Mermaid ou les formats de Wardley Maps.

Le canvas n'est pas la source de vérité. Il est une projection interactive d'un document logique sérialisable sous forme textuelle.

## Principes de conception

L'organisation du code et ses frontières sont décrites dans [architecture.md](architecture.md).

Le [langage du document, du layout et des assertions visuelles](visual-language.md) est inventorié dans un document de travail à compléter et valider.

1. **La logique avant la géométrie.** Le document décrit d'abord des éléments et leurs relations, pas des formes positionnées à des coordonnées arbitraires.
2. **Une seule source de vérité.** Le canvas et l'éditeur textuel modifient le même document structuré.
3. **Manipulation visuelle en premier.** La syntaxe textuelle ne doit pas être un prérequis pour utiliser le produit.
4. **Texte lisible et portable.** Le document doit pouvoir être copié, versionné, généré et compris sans le canvas.
5. **Organisation déterministe.** Un même graphe et les mêmes options doivent produire le même agencement.
6. **Identités stables.** Renommer ou réécrire une boîte ne doit pas casser ses relations.
7. **Collaboration native.** Les boîtes, les relations et leur contenu sont des objets collaboratifs, pas un blob textuel synchronisé en bloc.

## Modèle conceptuel

### Document

Un document contient :

- une bibliothèque de natures ;
- des boîtes ;
- des relations orientées entre les boîtes ;
- des options de présentation ;
- éventuellement des contraintes légères de placement.

### Nature de boîte

Une nature définit au minimum :

- un identifiant stable ;
- un libellé, par exemple `Goal`, `Precondition`, `Action` ou `Want` ;
- une couleur de base dans le document ;
- une icône optionnelle, référencée par bibliothèque et nom.

Extensions possibles, encore non décidées :

- une description ;
- des règles sur les relations autorisées ;
- un style visuel complémentaire.

### Boîte

Une boîte possède :

- un identifiant stable ;
- une nature ;
- un corps Markdown avec édition visuelle gras, italique et souligné ;
- une description Markdown optionnelle pour les explications détaillées ;
- éventuellement des métadonnées.

Le titre visible correspond à la nature de la boîte. Sa couleur et son icône sont héritées de la nature ; un nœud peut personnaliser ces deux propriétés séparément, puis revenir à leur héritage. Le texte conserve une encre sombre sur un fond teinté clair, y compris pour les couleurs très claires.

La description accepte un contenu documentaire plus riche : titres, listes et tâches, citations, liens, code avec langage, tableaux et images par URL avec texte alternatif. Elle n’agrandit pas le corps de la carte. Une description vide équivaut à une description absente. La couleur du texte via la palette existante reste une amélioration souhaitable, secondaire à la conservation du contenu.

### UI et content

Le **content** est le graphe construit par les utilisateurs ; l’**UI** est l’interface de Sequit. Un seul thème principal est actuellement pris en charge, avec deux espaces de variables distincts.

- UI : surfaces neutres, accent indigo pour activation/sélection, vert pour réussite, ambre pour attention et rouge pour erreur ou confirmation destructive. Les actions utilisent Phosphor avec leurs libellés et raccourcis. Une icône ou un libellé accompagne les états colorés.
- Content : 54 couleurs proposées dans 18 familles, couleurs RGB personnalisées et catalogue Phosphor Regular complet. Aucune signification logique n’est imposée aux couleurs ni aux icônes. Les icônes des documents d’exemple sont des choix éditoriaux explicites.
- La sélection est un contour UI indépendant de la couleur du nœud. Le focus clavier utilise un contour décalé en pointillés. Modifier la présentation ne change ni nature logique, ni identifiants, ni relations, ni ordre.

Les propriétés optionnelles `color` et `icon` des nœuds sont conservées dans le TOML et dans les champs Yjs correspondants. Les natures possèdent leur couleur de base et une icône optionnelle. `icon = "none"` supprime explicitement une icône héritée ; supprimer le champ restaure l’héritage. Une référence telle que `phosphor:scales` identifie une ressource sans incorporer de SVG ou d’URL distante. Une référence d’une bibliothèque indisponible reste conservée, avec un indicateur de remplacement dans le rendu.

Les couleurs acceptées sont `#RGB` ou `#RRGGBB`. Les fonds, bordures et encres du thème sont séparés de la teinte choisie. Les règles d’impression retirent ombres, teintes et sélection des cartes et conservent libellés et pictogrammes en noir ; la pagination et l’export visuel complet restent à concevoir.

Les composants d’inspection sont partagés dans `src/app/web/ui/components/content`. Leur accès expérimental est disponible dans l’atelier ; les commandes de style du produit collaboratif restent à intégrer comme les autres commandes expérimentales. Les codecs partagés préservent déjà ces propriétés.

### Relation

Une relation est orientée de l’enfant (source, `from`) vers son parent (cible, `to`). Si A est la racine et B son enfant, la relation est `B → A`.

Les racines sans parent sont au rang 1. Le rang d’un enfant vaut 1 + le plus grand rang de ses parents ; les jonctions ne comptent pas comme étapes de nœuds supplémentaires. Les rangs progressent depuis l’origine de la direction du layout : haut en `top-to-bottom`, bas en `bottom-to-top`, gauche en `left-to-right`, droite en `right-to-left`. Les flèches remontent vers les parents, dans le sens opposé. Le calcul utilise des indices de rang à partir de 0 ; le vocabulaire et les rangs affichés commencent à 1.

Le modèle visuel pourra ressembler à un arbre, mais le modèle logique visé est un graphe orienté acyclique (DAG). Cela autorise notamment plusieurs antécédents pour une même boîte et la convergence de plusieurs branches.

La signification exacte d'une relation reste à définir : dépendance, contribution, prérequis, production, ou relation générique orientée.

## Représentation textuelle

La représentation textuelle est la forme lisible et portable du document. L’encodage courant est TOML sous `persistenceFormat = 2`.

```text
TOML versionné
      ↓ parsing, mapping et validation
LogicDocument sémantique
      ↓ DocumentSession / Yjs
LogicDocument courant
      ↓ graphe, rangs et layout
Canvas interactif
```

`persistenceFormat` appartient à la frontière textuelle. `LogicDocument` ne porte ni l’encodage ni sa version : un futur encodage compatible pourra produire le même modèle sémantique.

Le document contient des identifiants stables, une bibliothèque locale de natures, des groupes, des nœuds, des junctions, des relations et des préférences de layout. Corps et descriptions restent du Markdown dans le TOML. L’édition visuelle peut normaliser une syntaxe équivalente, mais doit conserver le contenu et la mise en forme ; un contenu non représentable sans perte reste éditable en source. Le souligné est représenté par `<u>texte</u>`. L’import/export conserve le Markdown décodé sans convertir globalement les documents en HTML.

## Source de vérité et édition

Le système doit éviter deux états indépendants — un fichier texte et un canvas — qu'il faudrait réconcilier.

Le modèle cible comporte trois représentations du même document :

1. **Un modèle structuré collaboratif**, manipulé par l'application.
2. **Une sérialisation textuelle stable**, destinée à la lecture, l'import, l'export et éventuellement l'édition directe.
3. **Une projection visuelle**, calculée depuis le modèle structuré.

La `DocumentSession` conserve le `Y.Doc`, applique les opérations métier fines et notifie les projections après chaque update. Le canvas relit alors le document courant au lieu de conserver le résultat initial du parser.

Une action sur le canvas modifie le document structuré :

- créer une boîte ajoute un nœud ;
- relier deux boîtes ajoute une relation ;
- changer une nature modifie le type du nœud ;
- éditer le contenu modifie son rich text ;
- supprimer une boîte supprime le nœud et traite ses relations associées.

L'éditeur textuel, s'il est exposé, doit modifier ce même document structuré après parsing et validation.

## Organisation du graphe

Le tri topologique détermine l'ordre logique des boîtes, mais pas à lui seul leurs coordonnées.

Le placement visuel nécessite un moteur de layout qui décide notamment :

- l'orientation générale, par exemple gauche vers droite ou haut vers bas ;
- les rangs des boîtes ;
- l'ordre des branches indépendantes ;
- l'espacement ;
- le routage des relations ;
- la réduction des croisements.

L’[allocation des rails et des quais](layout-routing.md) décrit le calcul actuel, ses contraintes et les extensions de routage restant à spécifier.

### Cycles

Un cycle empêche le tri topologique. La première hypothèse est donc de les interdire et de signaler immédiatement la relation qui créerait un cycle.

Ce choix reste à confirmer selon la sémantique retenue pour les relations.

### Placement manuel

Les coordonnées absolues ne devraient pas polluer la représentation logique principale.

Options à évaluer :

- layout entièrement automatique ;
- déplacement manuel temporaire, perdu au prochain réagencement ;
- contraintes déclaratives légères comme `near`, `group` ou `rank` ;
- positions persistantes conservées dans une couche de présentation séparée.

## Expérience utilisateur principale

Le parcours nominal est :

1. créer une boîte ;
2. choisir sa nature ;
3. rédiger son contenu ;
4. la relier à d'autres boîtes ;
5. observer le graphe se réorganiser ;
6. partager le document avec d'autres participants.

Fonctions centrales envisagées :

- canvas infini ;
- création et connexion rapides ;
- édition rich text dans les boîtes ;
- sélection simple et multiple ;
- zoom et déplacement du viewport ;
- auto-layout ;
- collaboration en temps réel ;
- présence, curseurs et sélections des participants ;
- undo/redo ;
- partage par URL ;
- import et export textuels.

### Gestes de création, connexion et suppression

- Un glissement depuis le fond du canvas ou la zone vide d’un groupe dessine une enveloppe et remplace la sélection par les nœuds et jonctions qu’elle intersecte ; les groupes ne sont jamais capturés par l’enveloppe. Avec Maj, l’enveloppe ajoute ces éléments à la sélection existante. Maj+clic sur un nœud non sélectionné l’ajoute ; Maj+clic sur un nœud sélectionné le retire.
- À partir de deux nœuds sélectionnés, une barre contextuelle centrée au-dessus de leur enveloppe commune propose « Grouper ». Son raccourci est `G`. Les nœuds doivent appartenir au même conteneur ; le nouveau groupe est créé dans ce conteneur.
- Un double-clic sur le fond ouvre une modale avec nature et contenu. Le focus entre dans le contenu ; Annuler ou Échap ferme sans création. Valider crée la boîte à sa place calculée par le layout, sans enregistrer le point cliqué. Un double-clic sur le fond d’un groupe crée la boîte dans ce groupe ; le fond du canvas crée une boîte hors groupe.
- Un clic sélectionne ; un double-clic sur une boîte ouvre son édition. Un glissement depuis toute la surface d’un nœud, groupe ou jonction crée une relation vers l’élément de destination. Le geste commence après 6 pixels de déplacement ; une ligne droite fantôme suit le pointeur et toute la destination se surligne. Relâcher dans le vide ou Échap annule. Le sens est origine → destination ; les connexions invalides sont refusées.
- Avec exactement un nœud, groupe ou jonction sélectionné, Cmd/Ctrl+Entrée crée un nœud enfant et Cmd/Ctrl+Maj+Entrée un sibling, puis ouvre directement son contenu. Un enfant pointe vers la sélection ; un sibling reprend tous ses parents, ou reste racine si elle n’en a pas. Le nouveau nœud conserve le groupe conteneur de la sélection : l’enfant d’un groupe est relié à ce groupe sans en devenir membre. Depuis la modale, les mêmes raccourcis sauvegardent d’abord le nœud courant puis enchaînent dans la même modale avec le nouveau contenu focusé ; Maj+Entrée sauvegarde et ferme simplement la modale.
- « Supprimer », Suppr et Backspace suppriment la sélection et les relations incidentes aux éléments supprimés. Supprimer une relation conserve ses extrémités. Supprimer un groupe supprime son contenu ; l’action distincte « Dissoudre » conserve les membres. Une sélection composée est supprimée atomiquement, y compris les relations sources d’une flèche agrégée.
- Les raccourcis de suppression sont limités au canvas et ignorent les champs de saisie. Pendant l’édition, glisser sélectionne le texte et Backspace efface du texte. Les commandes structurelles du canvas partagé sont disponibles uniquement lorsque la session est connectée.

## Collaboration

La collaboration doit porter sur des objets structurés :

- bibliothèque de natures ;
- boîtes ;
- contenu rich text ;
- relations ;
- options ou contraintes de présentation.

Yjs est le moteur CRDT. `yjsLiveDocumentFormat = 3` versionne les structures partagées indépendamment du format de persistance. La `DocumentSession` masque Yjs au reste de l’application ; les champs Markdown sont des `Y.Text` stables. Le serveur ajoute un texte de description vide aux anciens nœuds avant publication ; les éditions ultérieures utilisent le canal textuel existant.

Le format textuel reste la représentation canonique portable. Le document complet n’est jamais resynchronisé comme une chaîne ou réimporté concurremment : les modifications collaboratives passent par des opérations fines.

### Protocole d’autorisation

Le protocole WebSocket en version `4` utilise des enveloppes CBOR, limitées à
1 Mio. Ses messages sont `initialize`, `sync`, `change`, `commit`, `reject` et
`retry` et `presence`. Les règles de reprise, de collecte et de santé de la connexion
sont détaillées dans [la documentation de résilience](collaboration-resilience.md).

Le Durable Object valide les changements dans un document candidat jetable. Les
commandes structurelles créent, modifient ou suppriment les éléments ; les gestes
composés sont atomiques. Les règles du domaine, la résolution du graphe et le
rejet des cycles restent applicables, avec la limite existante de 100 000
appartenances ou dépendances effectives. Le candidat est persisté avant que son
update soit appliquée au document autoritaire stable et diffusée à tous.

Chaque session cliente ouverte possède un identifiant et une séquence de commandes
strictement contiguë. Le dernier numéro accepté est persisté par session dans la
même transaction que le snapshot. Une retransmission plus ancienne ne réexécute
jamais la commande ; un trou de séquence demande une reprise. L’ID de commande
reste une corrélation de réponse, sans porter la garantie de déduplication.
Les updates textuelles n’ont aucun ID,
aucune table de déduplication ni acquittement individuel. Le serveur vérifie
qu’elles ne modifient que les `Y.Text` autorisés ; cette vérification s’applique
également aux updates reçues pendant la synchronisation.

`initialize` propose un snapshot initial entièrement validé, uniquement pour une
room vide. Si la room existe déjà, le serveur renvoie son état sans fusionner
l’import concurrent. L’identifiant du document doit correspondre au nom de room.

### État navigateur et convergence

La session conserve un seul `Y.Doc` stable. Ses collections sont des `Y.Map`
indexées par ID, contenant les maps des éléments. Le Markdown, le titre et les
libellés sont des `Y.Text`. La structure affichée attend le commit du serveur ;
la saisie textuelle est locale et immédiate. Le binding de l’éditeur conserve sa sélection
avec les positions relatives Yjs et préserve une composition de caractères lors
de l’arrivée de modifications distantes.

Les frappes sont fusionnées avant envoi : 50 ms d’inactivité, avec un maximum de
500 ms depuis le début du lot. Les updates reçues ne réalimentent pas ce buffer.
La synchronisation enveloppe littéralement SyncStep1 et SyncStep2 de
`y-protocols`, dans les deux sens. Après une coupure, le document resté en mémoire
permet de transmettre aussi les frappes non envoyées. Il n’y a plus d’overlay
reconstruit ni de remise à zéro du document pendant cette reprise.

Les groupes partagent `state = expanded | closed`. Leur contenu reste conservé
lors du repli. Direction et biais de layout sont modifiés ensemble ; aucune
commande de déplacement manuel n’est introduite. La présence et les sélections
d’éléments sont éphémères, relayées sous forme de liste courante des participants.

Les éléments internes masqués ne sont pas proposés à l’édition ni à la création
de relations. Les flèches visibles conservent la liste canonique de leurs relations
sources : supprimer un agrégat supprime toutes ces relations dans une même commande
atomique. Une flèche unique permet la réaffectation de son extrémité visible ; une
extrémité masquée et les deux extrémités d’un agrégat sont verrouillées. Si le repli introduit
un faux cycle, la projection reste dépliée et explique l’ambiguïté.

La projection réutilise la préparation du graphe à topologie constante et le
layout à mesures constantes. Les instantanés immuables sont réactifs à leur
remplacement, sans proxies profonds. Les chemins rendus et les couleurs des flèches
sont réutilisés tant que géométrie et provenance restent identiques. Les mises à
jour sont regroupées par frame ; la scène reste montée, avec focus, sélection et
zoom conservés. Les messages de présence ne relisent pas le document.
Tab et Maj+Tab sortent du canvas ; les flèches assurent la navigation interne.

### Persistance et refus

Le Durable Object persiste un snapshot complet et son numéro de commit dans une
transaction atomique, par blocs de 64 Kio, avec une limite de 15 blocs (960 Kio).
Les anciens titres et libellés scalaires sont migrés vers `Y.Text` et la migration
est persistée avant publication. Une relecture Yjs sans changement ne crée pas de
nouveau commit de texte.

La collecte du contenu Yjs supprimé intervient après le contrôle du candidat,
afin de conserver l’information nécessaire au filtre d’autorisation. Les identités
CRDT et positions relatives restent dans le même document. Une régression exerce
600 insertions puis suppressions de 16 Kio, ainsi que la reprise d’un ancien client.

Un refus définitif laisse l’état autoritaire inchangé, envoie `reject` au proposant puis
ferme sa connexion. Le navigateur arrête le buffer et la reconnexion, recharge
la page avec le message d’erreur en querystring, affiche le toast puis retire le
paramètre. La perte des frappes non confirmées lors de ce refresh est acceptée.
Pas de rollback, d’IndexedDB, d’undo collaboratif global ni de récupération après
fermeture de page dans cette première version. Le contrôle texte conserve
uniquement les échanges de disponibilité et ping/pong ; une entrée invalide
suit le même chemin de refus terminal. Une panne de stockage ou un trou de séquence
utilise `retry` et conserve l’état local pour reprendre. Le transport détecte les
connexions silencieuses par ping/pong. Les erreurs d’un abonné et celles de présence
sont isolées du document ; une sélection volumineuse est tronquée avant stockage
éphémère, sans interdire la saisie ni les commandes.

La cible de validation est de 1 000 boîtes et 50 personnes connectées sur ordinateur,
majoritairement en observation, sous Chrome, Firefox et Safari ; consultation sur
mobile. Les essais locaux de diffusion ne constituent pas une garantie de charge
d’un déploiement Cloudflare. Les scénarios reproductibles sont consignés dans
[la documentation de résilience](collaboration-resilience.md#vérifications-reproductibles).

## Architecture technique retenue

- frontend en SvelteKit et TypeScript ;
- déploiement sur Cloudflare ;
- Tailwind CSS pour l'interface, complété par des variables CSS pour les couleurs configurables des natures ;
- Worker Cloudflare en TypeScript pour l'entrée HTTP, l'authentification future et le routage ;
- un Durable Object par document pour coordonner les connexions WebSocket et la synchronisation Yjs.

Les mises à jour Yjs acceptées sont compactées en un état complet, découpé et persisté atomiquement par room.

## Hors périmètre à ce stade

Aucune décision n'est encore prise concernant :

- les comptes et permissions ;
- les commentaires ;
- les pièces jointes ;
- les modèles de documents ;
- les règles métier avancées ;
- l'exécution ou la simulation du graphe ;
- les formats d'export visuel ;
- le mode hors ligne.

## Questions ouvertes

1. Quelle est la sémantique précise d'une relation orientée ?
2. Les champs inconnus du format persistant doivent-ils être rejetés ou tolérés pour la compatibilité ascendante ?
3. Les natures imposent-elles des règles de connexion ou seulement une apparence ?
4. La bibliothèque de natures appartient-elle au document, à un espace de travail, ou aux deux ?
5. Le Markdown doit-il rester du texte brut dans le canvas initial ou être rendu par un sous-ensemble assaini ?
6. L'éditeur textuel est-il une interface principale, une vue secondaire, ou seulement un format d'import/export ?
7. Le layout se déclenche-t-il continuellement, à la demande, ou selon un mode choisi ?
8. Quels ajustements manuels doivent survivre à un nouvel auto-layout ?
9. Plusieurs types de relations sont-ils nécessaires ?
10. Comment le document textuel représente-t-il les métadonnées de présentation sans devenir illisible ?

## Décisions enregistrées

- Le produit est une application browser-only sur une page unique.
- L'interface principale est un canvas collaboratif.
- Les éléments sont des boîtes typées avec contenu rich text.
- Chaque nature possède un libellé et une couleur stable.
- Les boîtes sont reliées par des relations orientées.
- Un tri topologique participe à leur réorganisation automatique.
- Le canvas est dérivé d'une représentation logique sérialisable sous forme textuelle.
- TOML est l’encodage courant, sous `persistenceFormat = 2`.
- `LogicDocument` reste indépendant de la version et de l’encodage persistants.
- `yjsLiveDocumentFormat = 3` versionne le schéma partagé indépendamment de `persistenceFormat`.
- `DocumentSession` est l’unique façade applicative vers le document Yjs live.
- Les cycles sont rejetés avant le calcul des rangs.
- Toutes les relations s’attachent aux faces perpendiculaires à l’axe principal, avec des segments de départ et d’arrivée dans cet axe. Aucune attache transversale, y compris pour les groupes et leurs en-têtes.
- Une relation longue dont les deux extrémités appartiennent au même groupe emprunte un passage dans le padding de leur groupe commun le plus profond ; sa route ne sort pas de cette enveloppe.
- Un groupe non vide occupe l’intervalle des rangs de son contenu ; un groupe vide endpoint est atomique.
- ELK a été écarté après sa gate de compatibilité ; `layoutGraph(...)` utilise un moteur dédié déterministe.
- Le frontend utilise SvelteKit et TypeScript.
- L'application est déployée sur Cloudflare.
- La collaboration passe par un Worker TypeScript et un Durable Object par document.
- Tailwind CSS habille l'interface ; les couleurs configurables des natures restent des données du document exposées par variables CSS.
