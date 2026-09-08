# Atelier d’interactions

Route locale : `/atelier`. Le catalogue est dans `src/routes/atelier/catalogue.ts`.
L’atelier expose 15 parcours et 33 variantes sous 11 thèmes. Chaque variante est accessible par `/atelier?scenario=SC-…&variant=…` ; l’URL suit les changements, le rechargement et les boutons précédent/suivant du navigateur. Le lien sous le canvas permet de retrouver la variante.

La majorité des essais manipulent un document local réinitialisable. `SC-COL-WORK` ouvre deux sessions indépendantes reliées au vrai serveur WebSocket local. Lancer la pile avec `mise exec -- pnpm dev:stack` ou lancer `dev:web` et `dev:collaboration` séparément. Vite relaie `/collab` vers `COLLABORATION_PORT` (8787 par défaut). Les tests E2E démarrent leur propre serveur sur 8788.

## Composition

- `WorkshopShell.svelte` : navigation groupes/scénarios, consigne, variantes, redémarrage et question de discussion. Aucun identifiant métier ni choix de présentation n’y est codé en dur.
- `workshop-types.ts` : contrats typés. Chaque groupe contient des scénarios et chaque scénario au moins une variante. Les IDs doivent être uniques dans leur groupe (scénarios) et scénario (variantes).
- `catalogue.ts` et `catalogue-workbench.ts` : métadonnées, source TOML, état initial et composants de scène. Les IDs existants restent stables pour les discussions.
- `Playground.svelte` : hôte de canvas partagé. Ouvre le document, initialise zoom et sélection, puis détruit la session au démontage. La source et l’état initial sont capturés à la création ; le cadre remonte la scène lors d’un changement de scénario, de variante ou d’un redémarrage.
- `ModalScene`, `InlineScene`, `PanelScene` : compositions explicites de l’hôte et des éditeurs. L’hôte ignore les IDs des variantes.
- `NodeMarkdownForm.svelte` : formulaire commun à la modale du produit et aux alternatives. Affiche le brouillon de `CanvasSession`, les diagnostics et les états de sauvegarde ; gère Échap quel que soit son conteneur. Chaque formulaire a ses propres IDs. Pendant un envoi, Fermer ferme l’éditeur et indique que la commande reste en attente. Les conteneurs gèrent placement, focus initial et modalité.
- `CanvasShortcut.svelte` et `FloatingActions.svelte` : raccourcis limités aux surfaces concernées, exclusion de la saisie et des modificateurs ; positionnement Floating UI partagé, groupes de boutons et menu avec navigation au clavier et retour du focus.

- `WorkbenchScene.svelte` : hôte des autres interactions ; compose le vrai `LogicCanvas`, `CanvasSession` et un outil de parcours. `WorkshopFrame` déclare le placement des outils (`left`, `right`, `split`, `overlay`) et le remplacement éventuel des actions contextuelles. L’hôte n’importe aucun composant de `tools/` et ne connaît aucun ID de variante. `WorkbenchToolProps` fournit le document, la sélection, le canvas rendu, les préférences de vue et des callbacks de mise à jour.
- `tools/` : contrôles comparés dans les variantes. Les composants partagent styles et services, et ne connaissent pas le catalogue global.
- `runtime/workshop-document.ts` : adaptateur expérimental local. Les commandes existantes passent par `DocumentSession`. Les commandes absentes du produit valident document et graphe, puis appliquent une transaction Yjs différentielle ; les objets `Y.Text` existants sont conservés. Un `UndoManager` garde l’historique de cette séance. Cette surface devra rejoindre des commandes métier explicites avant une intégration collaborative.
- `runtime/workshop-commands.ts` : surface de commandes locales nommées (boîtes, groupes, natures, relations, présentation, document et disposition). Les outils reçoivent seulement ces commandes, la lecture et l’import explicite ; ils n’ont plus accès à `apply`, `edit`, Yjs ou à la session ouverte. Chaque commande expérimentale lit le document courant avant une transaction validée. L’ajout de relation conserve la commande du produit. Le remplacement Markdown continue via `CanvasSession` et son port existant. Cette surface locale ne constitue pas un nouveau protocole collaboratif : une opération retenue pour le produit doit rejoindre les commandes métier et leur autorité.
- `runtime/workshop-nature-operations.ts`, `workshop-relation-operations.ts` et `workshop-metadata-operations.ts` : transformations pures extraites des composants. Les IDs viennent de l’appelant ; les fonctions ne dépendent ni de Svelte ni de Yjs. Les variantes réutilisent les mêmes opérations et les commandes les exécutent sur l’état courant.
- `runtime/workshop-node-operations.ts` et `workshop-group-operations.ts` : transformations pures testables. La création et la connexion réutilisent les projections du produit. `WorkshopDocument.edit` lit le document courant, valide l’opération entière puis applique une transaction : création reliée et duplication multiple ont chacune une seule étape d’annulation. Le placement en premier utilise les clés canoniques et les pairs de même groupe/rang.
- `WorkshopHistory.svelte` : historique commun aux workbenches, boutons et Ctrl/Cmd + Z / Maj + Z. Les champs de saisie conservent leur propre historique ; l’historique du document reste désactivé pendant l’édition.
- `runtime/workshop-projection.ts` : projection du repli et de l’espacement avec le moteur de layout du produit. Aucun contenu source n’est effacé au repli. Le canvas dépend seulement du contrat de projection qu’il consomme.
- `CollaborationScene` / `CollaborationParticipant` : deux sessions collaboratives et transports WebSocket, éditeurs partagés et validation par l’autorité existante. `WorkshopTransport` coupe/recrée le transport tout en conservant la session et ses opérations en attente. `WorkshopCollaboration` adapte les décisions aux promesses de commande, attend la première synchronisation et conserve une seule commande en attente par participant. Les événements du transport actualisent le statut après le client ; aucun polling. Un transport fermé ne se reconnecte plus. La présence entre les deux vues est locale, les éditions sont réellement synchronisées.
- `WorkshopFeedback.svelte` : une fiche par parcours, stockage navigateur indépendant des scènes, export Markdown des 15 fiches. `runtime/workshop-feedback.ts` valide les données lues et produit l’export. La saisie enregistre la valeur de l’événement, relit le stockage avant fusion et écoute les autres onglets ; deux fiches distinctes ne s’écrasent pas. Sur une même fiche, la dernière modification reçue prévaut. Le fichier de retours dans `docs/` est conservé séparément.

## Sélecteur global de document

Le sélecteur **Document d’essai** se trouve dans le cadre global, au-dessus du titre du scénario. Le choix s’applique aux scénarios et aux variantes :

- **Simple** (`fixture=simple`) : le petit graphe initial de trois boîtes et deux relations. C’est le défaut de `/atelier`, identique dans chaque scénario.
- **Varié** (`fixture=varied`) : le document de la page d’accueil, réutilisé directement via `AI_DOCUMENTARY_EFFORT_SOURCE`, sans copie divergente.
- **Performance** : 12 topologies, à 10, 19, 50, 100 ou 1 000 boîtes. Le choix de taille n’apparaît que pour ces documents.
- **Document propre au parcours** (`fixture=parcours`) : accès explicite aux anciennes fixtures narratives, pour suivre les consignes préparées pour un scénario.

**Charger le document** démarre un nouvel essai. Le choix est conservé entre variantes et scénarios, dans l’URL (par exemple `fixture=binary-tree&nodes=100`), au rechargement et dans les liens directs. Les exemples n’ajoutent aucun paramètre de taille artificiel. Un lien incomplet ou inconnu revient au document simple.

Les générateurs purs et tailles partagés vivent dans `src/lib/fixtures/layout-performance/`. Les tests et l’atelier consomment la même définition ; la génération, les identifiants et les graines restent déterministes. Les mesures synthétiques, budgets et harnais de benchmark restent dans `tests/`. Une règle d’architecture interdit aux générateurs de dépendre de couches autres que le domaine. Aucun import de test depuis la route.

`runtime/workshop-fixture.ts` ne construit que le document demandé, le sérialise avec le code du produit et vérifie les limites du graphe. Le navigateur mesure et rend ensuite les vrais composants. Le cas `nested-subgroups / 1000` dépasse actuellement le plafond de 100 000 appartenances de groupes développées : la page présente ce résultat sans instancier une scène invalide. Les seuils du moteur restent inchangés. Cela révèle aussi un écart avec l’ancienne matrice de benchmark documentée ; cette passe ne recalibre pas ses budgets.

`WorkshopViewportStart` replace une première boîte hors champ à l’ouverture. La navigation amène aussi le canvas à l’écran avant de centrer la boîte recherchée. Les outils prennent leurs natures, groupes et boîtes dans le document chargé. Une consigne spécifique aux fixtures peut être déclarée via `fixtureInstruction` dans le catalogue.

Dans le bilan, **Noter cet essai** ajoute le couple variante/document/taille à « Variantes essayées », sans écraser les observations ni répéter une entrée identique. Cette référence accompagne l’export Markdown.

## Présentation UI et content

`SC-NAT-STYLE` propose deux entrées dans le même inspecteur partagé : `node` part des propriétés de la boîte ; `nature` part du style commun. L’onglet de portée permet de passer de l’un à l’autre pendant un essai. Chaque propriété indique son héritage ou sa personnalisation et dispose de son propre retour à l’héritage. Le document peut être exporté directement depuis ce parcours avant de changer de variante.

- `src/lib/styles/main-theme.css` : thème principal, rôles `--ui-*` distincts des bases `--content-*`.
- `src/lib/icons/phosphor.ts` : assets Phosphor Regular livrés avec l’application. `phosphor-catalogue.ts` est chargé à l’ouverture du sélecteur pour rechercher par noms, tags et catégories. Le rendu ne charge aucun SVG depuis une référence fournie par le document.
- `src/lib/components/ui/Icon.svelte` : pictogramme décoratif partagé ; le contrôle parent porte son nom accessible. Les assets conservent leur rendu noir à l’impression.
- `src/lib/components/content/` : palette RGB, recherche d’icône, éditeur de propriétés héritées et inspecteur. Les contrôles sont réutilisés dans le gestionnaire de natures existant.
- `src/lib/document/content-style.ts` : transformations pures, identité et logique conservées. L’adaptateur de l’atelier les applique au document courant avec validation et historique.
- `NodeContent.svelte` : contenu commun à la mesure DOM et à la carte visible ; ajouter une icône ne crée pas deux calculs de taille divergents.

Les nouveaux champs optionnels traversent parseur, sérialiseur, validation, Yjs, duplication et projection canvas. La palette est un ensemble de propositions, les couleurs RGB restent libres. L’absence d’override et `icon = "none"` ont des sens distincts. Les styles de natures ne changent pas les overrides des boîtes.

## Ajouter un scénario ou un design

1. Ajouter un scénario au groupe concerné dans le catalogue, ou un nouveau groupe. Fournir ID, libellé, consigne, document TOML valide et état initial (zoom et sélection par identifiants stables).
2. Réutiliser les scènes existantes ou créer un composant respectant `WorkshopSceneProps`. Pour un design du canvas, composer `Playground` avec un éditeur et son placement. Pour une autre interaction du canvas, fournir un composant `tools` à `WorkbenchScene` ; pour un autre support, la scène peut composer directement les composants du produit. Le cadre n’impose pas de canvas.
3. Référencer ce composant dans une variante avec son ID, son libellé, sa description et la question à discuter. Déclarer le placement et les actions contextuelles via `frame`. Ne pas ajouter de condition sur cet ID dans le cadre ou l’hôte.
4. Ajouter le scénario observable aux tests E2E, puis exécuter les gates du dépôt via `mise exec -- pnpm ...`.

Les nouveaux états spécifiques à un parcours doivent être décrits explicitement dans le contrat de scène quand le besoin apparaît. Ne pas ajouter de logique métier au catalogue ou recopier les commandes du produit dans l’atelier. Les nouvelles commandes expérimentales restent dans l’adaptateur local validé jusqu’à ce que leur contrat produit soit décidé.

## Limites des propositions actuelles

L’édition « dans la boîte » est une surcouche ancrée, repositionnée aux bords de l’écran. Le panneau se superpose au canvas sur petit écran. Ces choix sont des propositions à discuter, pas des comportements de référence à généraliser.

## Catalogue de discussion et retours

- [Revue critique et décisions de refactorisation](ui-workshop-review.md) : corrections, preuves et limites.
- [Thèmes, actions, scénarios et variantes](ui-interactions.md) : inventaire de conception, avec couverture, limites et apprentissages et correspondance des anciens IDs.
- [Fiche de retour à remplir](ui-workshop-feedback.md) : bilan comparatif par scénario.

`SC-BOX-EDIT` réunit les anciennes entrées `BOX-E01` et `BOX-E04` de l’atelier. L’ouverture, l’enregistrement et l’annulation sont les étapes d’un même parcours. Seuls les scénarios exécutables sont inscrits dans le catalogue TypeScript ; le catalogue de discussion conserve les pistes futures.

## Disposition et annulation

Le sens de lecture affiché suit le document, y compris après une annulation. L’espacement reste une préférence de vue : sa modification immédiate ne réécrit pas la disposition du document et n’ajoute pas d’étape à son historique. Dans la variante « Appliquer », les deux réglages sont conservés dans un brouillon lié à la version du document. Une modification du document, notamment Annuler, invalide ce brouillon et réaffiche les valeurs courantes. Appliquer valide la direction avant de changer l’espacement.

Les tests de commandes couvrent les modifications successives sans écraser les éditions précédentes, la réaffectation atomique d’une nature, la préservation de `Y.Text`, le refus des opérations invalides et les allers-retours avec annulation. Les tests navigateur couvrent direction → Annuler → espacement dans les deux variantes, ainsi que l’invalidation d’un brouillon de disposition.
