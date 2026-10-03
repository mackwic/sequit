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
- une icône optionnelle, référencée par bibliothèque et nom ;
- une famille optionnelle, identifiant d’un ensemble prédéfini de natures.

Les familles prédéfinies sont « Générique » (`generic` : `Node` sans icône, `Comment`, `Problem`, `Idea`, `Question`), « Goal Tree » (`goal-tree` : `Goal`, `Need`, `Want`, `Solution`, `Precondition`, `Desirable Effect`, `Note`) et « Rétro Keep · Drop · Start » (`retro-kds` : `Keep`, `Drop`, `Start`, `Question`). Chaque famille possède ses identifiants : deux familles peuvent avoir chacune leur « Question ». Le champ `family` est conservé dans le TOML, sans changer de format, et dans les champs Yjs ; une famille inconnue reste lue et rangée avec les natures sans famille. Tout nouveau document démarre avec la famille Générique ; les natures des documents d’exemple appartiennent à Goal Tree.

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
- L’interface du produit est disponible en français, langue de référence, et en anglais ; l’atelier reste en français. Le contenu (titres, natures, libellés, documents d’exemple) n’est jamais traduit : un document garde le texte saisi ou créé, dans la langue de sa création. Ses libellés visibles et ses noms accessibles utilisent les jetons `--ui-*` et les classes `.ui-action`, `.ui-field` et `.ui-notice` du thème principal plutôt que des couleurs littérales.
- La langue de l’interface est celle choisie dans la section « Langue » du menu du document, mémorisée dans un cookie ; sans choix, celle du navigateur si elle est disponible, sinon le français. Changer de langue recharge la page ; le document courant est conservé comme à toute fermeture de page. `<html lang>` suit la langue servie.
- Toutes les modales partagent un même cadre (`ModalDialog`) : bandeau d’en-tête avec sur-titre et titre, corps, bandeau d’actions « Annuler » / action principale. Échap et un clic sur le fond ferment ; Cmd/Ctrl+Entrée valide lorsque la modale le permet ; le focus reste confiné. Aucun bouton « Fermer » dans l’en-tête.

Les propriétés optionnelles `color` et `icon` des nœuds sont conservées dans le TOML et dans les champs Yjs correspondants. Les natures possèdent leur couleur de base et une icône optionnelle. `icon = "none"` supprime explicitement une icône héritée ; supprimer le champ restaure l’héritage. Une référence telle que `phosphor:scales` identifie une ressource sans incorporer de SVG ou d’URL distante. Une référence d’une bibliothèque indisponible reste conservée, avec un indicateur de remplacement dans le rendu.

Les couleurs acceptées sont `#RGB` ou `#RRGGBB`. Les fonds, bordures et encres du thème sont séparés de la teinte choisie. À l’impression, les cartes gardent leurs couleurs (`print-color-adjust: exact` sur la scène) et perdent seulement ombres et marques de sélection ; l’impression et l’export d’image du canvas sont décrits avec le menu du document.

Les composants d’inspection sont partagés dans `src/app/web/ui/components/content`. Leur accès expérimental est disponible dans l’atelier ; les commandes de style du produit collaboratif restent à intégrer comme les autres commandes expérimentales. Les codecs partagés préservent déjà ces propriétés.

### Relation

Une relation est orientée de l’enfant (source, `from`) vers son parent (cible, `to`). Si A est la racine et B son enfant, la relation est `B → A`.

Les racines sans parent sont au rang 1. Le rang d’un enfant vaut 1 + le plus grand rang de ses parents ; les jonctions ne comptent pas comme étapes de nœuds supplémentaires. Les rangs progressent depuis l’origine de la direction du layout : haut en `top-to-bottom`, bas en `bottom-to-top`, gauche en `left-to-right`, droite en `right-to-left`. Les flèches remontent vers les parents, dans le sens opposé. Le calcul utilise des indices de rang à partir de 0 ; le vocabulaire et les rangs affichés commencent à 1. Avec des lanes, une boîte occupe la rangée de son rang calculé sur tout le graphe, à côté des autres boîtes de sa lane de même rang ; en orientation transverse, une relation vers une lane postérieure (parent dans une lane qui suit celle de l’enfant) va à contre-sens des rangs, car l’ordre documentaire des lanes prime (règle « Rang logique, rangée de lane et bande » de la [refonte du moteur](layout-engine-refactor.md)).

Le modèle visuel pourra ressembler à un arbre, mais le modèle logique visé est un graphe orienté acyclique (DAG). Cela autorise notamment plusieurs antécédents pour une même boîte et la convergence de plusieurs branches.

Deux boîtes ne sont reliées qu'une fois dans un même sens : créer une relation, ou déplacer l'extrémité d'une relation existante, vers un couple source → cible déjà relié est refusé. Le sens inverse reste une relation distincte, soumise au refus des cycles. Un document qui contient déjà des relations parallèles reste lisible.

La signification exacte d'une relation reste à définir : dépendance, contribution, prérequis, production, ou relation générique orientée.

## Représentation textuelle

La représentation textuelle est la forme lisible et portable du document. Les documents sans lanes explicites restent lisibles sous TOML `persistenceFormat = 2` ; le format 3 porte les lanes explicites, le format 4 les vraies régions, le format 5 une grille racine 2 × 2, le format 6 des lanes locales à une feuille de région et le format 7 une grille 2 × 2 à l'intérieur d'une région. Ces préférences et les affectations des éléments sont persistées sans coordonnées.

```text
TOML versionné
      ↓ parsing, mapping et validation
LogicDocument sémantique
      ↓ DocumentSession / Yjs
LogicDocument courant
      ↓ graphe, rangs et layout
Canvas interactif
```

`persistenceFormat` sélectionne actuellement la sérialisation TOML dans `LogicDocument`. Ce champ n’intervient pas dans le calcul de layout ; la présentation persistée porte la politique, l’orientation, l’ordre des lanes et leurs affectations, puis la hiérarchie, l’ordre et l’appartenance des régions. Une région racine virtuelle est dérivée, et les membres d'un groupe héritent de sa région.

Le document contient des identifiants stables, une bibliothèque locale de natures, des groupes, des nœuds, des junctions, des relations et des préférences de layout. Corps et descriptions restent du Markdown dans le TOML. L’édition visuelle peut normaliser une syntaxe équivalente, mais doit conserver le contenu et la mise en forme ; un contenu non représentable sans perte reste éditable en source. Tout ce que l’éditeur riche écrit se rouvre en édition riche à l’identique : une ligne de l’éditeur donne une ligne de Markdown, lignes vides et espaces compris. Le souligné est représenté par `<u>texte</u>` ; quand `*`, `**` ou `~~` seraient lus littéralement (par exemple une emphase finissant par une ponctuation collée à une lettre), la ligne utilise `<em>`, `<strong>` et `<s>`. Le canevas lit `<em>`, `<strong>` et `<u>` comme leurs équivalents Markdown. L’import/export conserve le Markdown décodé sans convertir globalement les documents en HTML.

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

L’[allocation des rails et des ports](layout-routing.md) décrit le calcul actuel, ses contraintes et les extensions de routage restant à spécifier.

La [refonte du moteur par IR et régions](layout-engine-refactor.md) distingue le contenu documentaire des régions de présentation, puis prépare les lanes, les cellules de grille et l’incrémentalité sans faire des coordonnées une nouvelle source de vérité.

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

- Un glissement depuis le fond du canvas ou la zone vide d’un groupe dessine une enveloppe et remplace la sélection par les nœuds qu’elle intersecte ; ni les jonctions ni les groupes ne sont capturés par l’enveloppe, ils se sélectionnent au clic. Avec Maj, l’enveloppe ajoute ces nœuds à la sélection existante. Maj+clic sur un nœud non sélectionné l’ajoute ; Maj+clic sur un nœud sélectionné le retire.
- À partir de deux nœuds sélectionnés, une barre contextuelle centrée au-dessus de leur enveloppe commune propose « Grouper ». Son raccourci est `G`. Les nœuds doivent appartenir au même conteneur, sinon le bouton reste inactif ; le nouveau groupe est créé dans ce conteneur, devient la sélection et sa modale s’ouvre pour le nommer (titre présélectionné, « Groupe » par défaut si l’on annule).
- Une seule modale « Groupe » sert à nommer et à modifier : titre et couleur, avec « Dissoudre » en pied. Elle s’ouvre par `G`, un double-clic sur l’en-tête, `E` ou « Propriétés… ». En collaboration, le titre est un texte partagé en direct ; la couleur part à l’enregistrement.
- Un chevron dans l’en-tête du groupe, ou « Replier » / « Déplier » dans sa barre contextuelle, change `state` ; les membres disparaissent et leurs relations se rattachent au groupe replié, en local comme en collaboration. Au clavier, `[` replie et `]` déplie, comme dans un éditeur de code : sur un groupe sélectionné, ce groupe ; sur un nœud ou une jonction sélectionné dans un groupe, son conteneur. Ces touches acceptent Alt ou Maj lorsque la disposition du clavier l’exige. « Dissoudre », dans la modale et la barre contextuelle, conserve les membres dans le conteneur parent et retire le groupe avec ses propres relations.
- La modale des propriétés d’une boîte (« Propriétés de la boîte ») porte sa nature (avec un aperçu de la couleur et de l’icône effectives), la lane pour une boîte racine, son contenu, sa description, puis « Couleur et icône » repliée, dont la ligne résume l’état courant (« Hérités de la nature » ou « Personnalisés »). Le contenu et la description s’éditent dans le même éditeur riche en local et en collaboration (`MarkdownField` / `SharedTextField`, thème `text-field.css`) : gras, italique et souligné pour le contenu ; titres, listes, citation, code et lien pour la description, avec « Texte source » dans sa barre d’outils. Le champ du contenu, à la mesure de quelques lignes de boîte, est plus bas que celui de la description. Chaque barre d’outils est un seul arrêt de tabulation (← → entre ses boutons) ; Tab passe au champ suivant, jamais une tabulation dans le texte. Le focus entre dans le contenu ; Annuler, Échap ou le fond ferment sans rien enregistrer ; Cmd/Ctrl+Entrée valide.
- Une boîte se crée en place, sans modale. Un double-clic sur le fond, `N`, « Nouvelle boîte » ou `C` font apparaître une boîte vide là où le layout la placera, défilent en douceur jusqu’à elle quand elle sort du viewport (sans animation avec `prefers-reduced-motion`) et y placent le curseur : le texte s’y tape directement, gras, italique et souligné par leurs touches. L’indication tient sur une ligne (« Ce que dit la boîte… »). Tant qu’elle n’est pas créée, la boîte se dessine en brouillon : contour et séparation de l’en-tête en pointillés, fond translucide, sans ombre, et contour d’accent lui aussi en pointillés pendant la saisie ; le curseur, à la couleur d’accent, montre la saisie, sans cadre autour du texte. Une boîte existante saisie en place garde son dessin plein. Cette boîte en cours de saisie est un brouillon local à la vue : elle n’entre pas dans le document, les autres participants ne la voient pas et elle ne fait pas de pas d’historique. Le layout la compte pourtant comme créée, avec l’identifiant, l’ordre et la place qu’elle aura, et la mesure sur son texte, ou sur son indication tant qu’elle est vide : la créer ne la déplace pas.
- Un canvas sans boîte, groupe ni jonction montre, au centre du viewport où se tiendra la première boîte, une boîte transparente en pointillés qui invite à écrire (« À quoi pensez-vous ? ») : un clic, ou Entrée quand elle a le focus, y fait saisir la première boîte, comme `N`. Son en-tête, comme celui d’une boîte, montre la nature des nouvelles boîtes (couleur, icône, libellé) ; un clic dessus ouvre le menu « Nature des nouvelles boîtes » de la barre latérale, qui la change pour la boîte à venir et rend le focus à l’en-tête. Elle n’apparaît que lorsque le canvas accepte les commandes et disparaît dès qu’une boîte se saisit.
- Une boîte n’a qu’une barre d’actions, au-dessus d’elle, à la place de celle de sa sélection : elle ne bouge pas entre le clic et la saisie, ni pendant que la boîte grandit vers le bas. Sélectionnée, la boîte y propose « Créer un enfant » (`C`), « Propriétés… » (`E`) et « Supprimer » ; en cours de saisie, « Valider » (`Cmd/Ctrl+Entrée`), « Créer un enfant » (`Cmd/Ctrl+Maj+Entrée`), « Propriétés… » (`Cmd/Ctrl+E`) et « Annuler » (Échap) : mêmes mots, même ordre, seules les touches changent, et « Valider », bouton principal, signale la saisie avec le contour de la boîte et le curseur. « Éditer » n’existe pas : éditer une boîte, c’est écrire dedans. Valider crée la boîte et sa relation éventuelle en un seul lot refusable, donc un seul pas d’historique, puis la sélectionne et lui donne le focus. « Créer un enfant » la crée de même et fait aussitôt saisir un enfant qui lui est relié : une branche s’écrit au clavier. « Propriétés… » la crée puis ouvre sa modale pour la nature, la description, la couleur et l’icône. Un clic ou le focus ailleurs crée la boîte sans la sélectionner. Une boîte vide n’est jamais créée : la valider revient à l’annuler. Une nouvelle boîte ne pouvant pas être supprimée, effacer (Backspace ou Suppr) quand elle n’a plus aucun texte l’annule aussi, comme Échap ; une boîte existante saisie en place ne s’efface jamais ainsi. La quitter la laisse en attente à sa place, racine ou enfant, toujours en brouillon mais sans contour d’accent, sans barre ni focus ; un clic dedans la reprend. Une nouvelle saisie (double-clic sur le fond, `N`, « Nouvelle boîte », `C`, `S`) prend sa place là où elle est demandée, y défile en douceur et y place le curseur : il n’y a jamais qu’une boîte en saisie. Saisir en place une boîte existante l’abandonne. Annuler ne crée rien et rend la sélection et le focus à l’élément d’où la saisie est partie, sinon au canvas. Un lot refusé rend la boîte à la saisie avec son texte, et abandonne l’enfant qui la suivait. En collaboration, une boîte proposée reste affichée à sa place jusqu’à ce que la room la publie.
- Un double-clic sur le fond retire la sélection ; le fond d’un groupe fait saisir la boîte dans ce groupe, le fond du canvas hors groupe. `N` et le bouton « Nouvelle boîte » de la barre latérale font saisir une boîte racine, sans relation, que la sélection ne relie ni ne contient : elle n’en reprend que la lane. Avec exactement un nœud ou une jonction sélectionné, « Créer un enfant » dans sa barre contextuelle, ou `C`, fait saisir une boîte enfant reliée à la sélection, dans son conteneur. Aucune boîte ne se saisit dans un groupe replié, où elle serait invisible.
- Seule sélectionnée, une boîte porte deux poignées « + » à cheval sur son contour, placées d’après la direction du layout : du côté opposé au but, « Créer un enfant » (comme `C`) ; sur le côté transverse (à droite quand le but est en haut ou en bas, en dessous quand il est à gauche ou à droite), « Créer un frère » (`S`). Un frère reprend tous les parents de la boîte (une relation vers chacun), son groupe et sa lane ; le frère d’une racine est une racine. Le layout le place selon l’ordre du document, pas forcément contre la boîte : le défilement en douceur l’amène à l’écran. Les poignées se cliquent ; un glissement qui part d’elles relie, comme depuis la boîte. Une jonction n’a ni poignée ni frère.
- Toute nouvelle boîte, racine ou enfant, prend la nature des nouvelles boîtes : la dernière choisie, sinon la première de la bibliothèque telle qu’elle est affichée (première famille, dans l’ordre de la famille), qui la remplace aussi quand elle disparaît. Le second bouton de la barre latérale la montre par sa couleur et son icône, et son menu « Nature des nouvelles boîtes », groupé par famille, la change ou ouvre « Gérer les natures du document ». Le choix vaut pour la vue ouverte.
- Une boîte existante se saisit aussi en place : un double-clic dessus, ou Entrée quand elle a le focus, rend son texte éditable dans la boîte même, avec la même barre et les mêmes touches que pour une nouvelle boîte. Un double-clic sur son en-tête, où est la nature, ouvre plutôt sa modale de propriétés ; pendant la saisie, il enregistre d’abord, comme « Propriétés… ». Valider l’enregistre et lui rend le focus ; « Créer un enfant » l’enregistre puis fait saisir un enfant relié ; « Propriétés… » l’enregistre puis ouvre sa modale, seul chemin vers la description, la couleur et l’icône avec `E`, le double-clic sur l’en-tête et le bouton « Propriétés… » de la barre de la sélection ; un clic ailleurs l’enregistre sans lui rendre le focus ; Échap garde le texte enregistré. Pendant la saisie, la boîte est mesurée sur le texte tapé. En collaboration, le texte saisi en place est partagé à la frappe, comme dans la modale : Échap ferme sans le reprendre. Une boîte supprimée par un pair pendant sa saisie la termine. Un enregistrement refusé garde la saisie ouverte et affiche le refus sous la boîte.
- La nature se change aussi depuis le canvas : un clic sur l’en-tête d’une boîte déjà seule sélectionnée ouvre sous lui le menu « Nature de la boîte », groupé par famille comme celui des nouvelles boîtes et terminé, comme lui, par « Gérer les natures du document » ; le premier clic ne fait que sélectionner. Choisir une nature la change en une commande refusable, un pas d’historique, et rend le focus à la boîte ; une couleur ou une icône propres à la boîte restent prioritaires. Un second clic sur l’en-tête, Échap ou un clic ailleurs ferme le menu, qui disparaît aussi quand la sélection change ou qu’une saisie commence ; le double-clic sur l’en-tête ouvre toujours les propriétés.
- La nouvelle boîte en cours de saisie, pas encore créée, offre le même menu dès le premier clic sur son en-tête : elle reste en saisie, son texte garde le focus et sa place, et la nature choisie est celle avec laquelle Valider la crée, sans commande ni pas d’historique de plus ; la nature des nouvelles boîtes ne change pas. Une boîte vide en attente n’offre pas ce menu, et une boîte existante saisie en place garde le double-clic sur l’en-tête pour ses propriétés.
- Un clic sélectionne ; `E` ou « Propriétés… » ouvre la modale d’une boîte. Le contenu et la description sont des textes : leur enregistrement s’applique à la place, sans écraser les frappes concurrentes ; nature, couleur et icône partent en une commande refusable en bloc. Un glissement depuis toute la surface d’un nœud, groupe ou jonction crée une relation vers l’élément de destination. Le geste commence après 6 pixels de déplacement ; une ligne droite fantôme suit le pointeur et toute la destination se surligne. Une étiquette près du pointeur nomme l’effet du relâcher : « Relier à « texte de la boîte » », « Relier au groupe « libellé » », « Relier à la jonction », « Déplacer dans « libellé » » (« Déplacer la sélection dans … » quand la sélection suit), « Sortir du groupe » (« Sortir la sélection des groupes »). Une relation que le document refuserait (cycle, relation déjà présente, autre refus) et un groupe visant un de ses sous-groupes s’annoncent en rouge, sur une destination contournée de rouge (« Relation impossible : elle créerait un cycle », « Déjà relié »…) ; relâcher alors ne propose rien. Relâcher dans le vide ou Échap annule. Le sens est origine → destination. Vers un groupe, seuls son en-tête et une bande intérieure de 16 pixels le long de ses bords relient : relâcher plus à l’intérieur déplace l’élément saisi dans le groupe, et relâcher sur le fond du canvas le ramène à la racine. Si l’élément saisi est sélectionné, toute la sélection (nœuds et groupes ; les jonctions suivent leurs cibles) se déplace avec lui ; la relation, elle, ne part que de l’élément saisi. La destination de déplacement se souligne en pointillés. Un élément déjà dans le conteneur visé ne bouge pas, un groupe n’entre jamais dans lui-même ni dans un de ses descendants, et un élément qui revient à la racine reprend la voie et la région du groupe qu’il quitte. C’est la commande partagée `move`, refusable en bloc comme les autres.
- `J`, le bouton « Jonction » de la barre contextuelle d’une relation ou un double-clic sur la relation insèrent une jonction : la relation origine → destination est remplacée, en un seul lot, par origine → jonction → destination ; la jonction devient la sélection et sa modale s’ouvre sur l’opérateur (ET, OU, OU exclusif ; le dernier choisi est proposé, OU exclusif au départ). Annuler garde la jonction avec cet opérateur. Une flèche agrégée par un groupe replié ne se scinde pas. Quand la sélection ne compte que des relations, au moins deux et aucune agrégée, la barre de la sélection propose aussi « Jonction » (`J`) : dans un seul lot, ces relations sont remplacées par une relation de chacune de leurs origines vers une nouvelle jonction, puis une relation de la jonction vers chacune de leurs destinations, sans doublon ; `A → P` et `B → P` deviennent `A → J`, `B → J` et `J → P`, tandis que `A → P` et `B → Q` font pointer J vers P et vers Q. Un cycle ainsi formé refuse le lot. `E`, « Propriétés… » ou un double-clic sur une jonction rouvrent la même modale ; l’opérateur part en une commande refusable.
- Une jonction n’entre jamais seule dans un groupe : elle suit ses cibles. Avec `A → J → P` et `B → J → P`, J est dans le groupe de P, où que soient A et B ; si P est hors groupe, J l’est aussi. Avec plusieurs cibles, J vit dans le groupe le plus profond qui les contient toutes, donc hors groupe dès qu’une cible est hors groupe ; une jonction cible compte avec sa propre place. Hors groupe, J prend la lane et la région de ses cibles, en gardant les siennes tant qu’une cible les offre. Cette place est recalculée après chaque commande : déplacer, grouper, dégrouper ou recâbler une cible emmène la jonction, et `move` ignore une jonction citée seule.
- « Supprimer », Suppr et Backspace suppriment la sélection et les relations incidentes aux éléments supprimés. Supprimer une relation conserve ses extrémités. Supprimer une jonction conserve le flux qu’elle portait : dans le même lot, chaque source restante est reliée à chaque cible restante (`A → J → P` et `B → J → P` deviennent `A → P` et `B → P`), à travers les jonctions supprimées avec elle, sans répéter une relation existante ; une relation sélectionnée avec la jonction ne transmet rien. Supprimer un groupe supprime son contenu ; l’action distincte « Dissoudre » conserve les membres. Une sélection composée est supprimée atomiquement, y compris les relations sources d’une flèche agrégée.
- `Cmd/Ctrl+Z` annule le dernier pas de l’historique de la personne et `Cmd/Ctrl+Maj+Z` le rétablit, sans bouton, en local comme en collaboration. Un lot refusé ne crée pas de pas ; un nouveau pas efface la branche à rétablir ; le document d’ouverture n’est pas un pas. Les touches agissent partout dans la page hors champ de saisie, où l’historique natif du champ prévaut, et restent inertes pendant une modale ou une commande en cours.
  - En local, un pas est un lot de commandes accepté ou un enregistrement de texte, tenu par un `Y.UndoManager` sur les origines de la session.
  - En collaboration, chacun n’annule que ses propres pas (`SessionHistory`). Un pas structurel est un lot accepté par la room, gardé comme les documents juste avant et juste après son commit. Annuler propose le lot qui rétablit ce que ce pas a changé, et seulement cela, propriété par propriété (`restoreHistoryStep`) : ce qu’il a créé est supprimé, ce qu’il a supprimé revient avec ses identifiants et ses textes, ce qu’il a modifié reprend sa valeur là où personne ne l’a changé depuis ; un élément supprimé depuis par un autre reste supprimé. Rétablir propose le lot inverse. La room décide comme pour tout lot : rien ne change avant son commit, un pas refusé est abandonné avec le message du refus, et un pas qui n’a plus rien à rétablir est sauté. Un pas de texte réunit les frappes successives d’un même champ jusqu’à toute autre action, et se rétablit par le `Y.Text` du champ.
- Les raccourcis de suppression sont limités au canvas et ignorent les champs de saisie. Pendant l’édition, glisser sélectionne le texte et Backspace efface du texte. Les commandes structurelles du canvas partagé sont disponibles uniquement lorsque la session est connectée.
- La barre contextuelle reste à l’intérieur du canvas : près du bord haut, elle passe sous l’élément plutôt que sous l’en-tête de page.
- Sur le canvas, le clic droit n’ouvre jamais le menu du navigateur, sauf dans un champ de saisie ou la boîte en cours de saisie. Sur un élément (boîte, groupe, y compris son fond, jonction ou relation), il le sélectionne et lui donne le focus, ou garde toute la sélection s’il en fait déjà partie : sa barre contextuelle apparaît. Sur une sélection de seules boîtes, le menu contextuel propose « Copier » ; cette action n'occupe pas la barre flottante. Sur le fond du canvas, le clic droit ouvre au pointeur le « Menu du canvas » sans toucher à la sélection : « Tout sélectionner », « Coller ici » et « Gérer les natures du document » lorsque le canvas accepte les commandes, « Exporter… » et « Exporter l’image… », puis « Zoom avant », « Zoom arrière » et « Revenir à 100 % » lorsqu’ils s’appliquent. Choisir une action ou Échap le ferme et rend le focus au canvas.
- « Tout sélectionner » (`Cmd/Ctrl+A`, canvas focalisé) remplace la sélection par les nœuds et jonctions affichés.
- Copier (`Cmd/Ctrl+C` ou menu contextuel) prend un instantané des boîtes sélectionnées, avec leur contenu, description, nature et présentation. Une sélection vide ou mêlant groupe, jonction ou relation ne se copie pas. Le fragment comprend aussi les groupes contenant ces boîtes (même si seule une partie de leurs membres est sélectionnée), les relations dont les extrémités sont copiées et les jonctions situées sur un chemin entre extrémités copiées. Les branches vers des éléments non copiés restent en place. Le presse-papiers porte l'identifiant du document : seul ce même document peut recevoir le fragment. Dans un champ de saisie, copier et coller gardent le comportement natif du texte.
- Coller (`Cmd/Ctrl+V`) crée de nouvelles identités pour tout le fragment en un seul pas d'historique, sélectionne les boîtes créées et laisse le layout les placer. La sélection courante fournit le conteneur de destination si tous ses éléments partagent ce conteneur ; un groupe sélectionné reçoit le fragment en son intérieur et se déplie si nécessaire. Sans destination commune, chaque élément de premier niveau retrouve son conteneur d'origine. « Coller ici » sur le fond ou dans la barre d'un groupe impose le conteneur pointé ; sur le fond, la lane ou région pointée est reprise lorsque disponible. Les natures doivent encore exister dans le document au moment du collage.
- Le canvas se déplace à la molette, au trackpad ou par Espace + glisser sur le fond, jusqu’à presque un viewport au-delà du graphe de chaque côté : n’importe quelle partie du graphe peut être amenée n’importe où à l’écran, et une bande de 64 px de la scène reste toujours visible. Sans déplacement, la scène se tient comme avant : centrée tant qu’elle tient dans le viewport, sinon à 64 px du coin haut gauche. Ce décalage se conserve quand le layout change ou que la fenêtre change de taille ; un zoom garde le point sous le pointeur, ou le centre du viewport.
- Sur petit écran (canvas de moins de 640 px de large, téléphone), le canvas démarre à 70 % au lieu de 100 %, et « Réinitialiser le zoom » y revient ; un zoom choisi par la personne est conservé quand la largeur change. Seul le zoom réduit le contenu : la taille du texte des boîtes ne change pas, car elle fixe leurs mesures et donc le layout. Sous 640 px, les modales occupent tout l’écran, les barres d’actions flottantes ne montrent que leurs icônes (le libellé reste le nom accessible du bouton), et l’en-tête ne garde que les icônes du logo, de « Collaborer », de « Partager » et de l’état de connexion. Sur écran tactile (`hover: none`), les touches `<kbd>` et le bouton `?` sont masqués, et les champs de saisie passent à 16 px pour que Safari iOS ne zoome pas la page quand on les touche.
- Dans l’en-tête, le titre du document courant, précédé d’une icône de menu, ouvre le menu du document. « Renommer le document », en tête du menu, remplace ce bouton par un champ de même emprise, l’icône devenant un crayon et le texte, entièrement sélectionné, restant en place ; Entrée ou un clic ailleurs renomment, Échap annule, et un titre vidé conserve le titre courant. Entrée et Échap rendent le focus au titre. Le titre est un texte partagé : en session, il change pour tous, et « Renommer le document » n’est proposé que connecté.
- Le menu du document ne propose que les actions disponibles : « Renommer le document », « Nouveau document », « Ouvrir… », « Documents récents… », « Exporter… », « Exporter l’image… » et « Imprimer… ». « Exporter… » ouvre une modale proposant le document complet en TOML (`<titre-en-slug>.sequit.toml`), le graphe logique en Graphviz DOT (`.dot`) et une scène éditable Excalidraw (`.excalidraw`) issue de la mise en page courante ; cette dernière option attend un canvas calculé pour le document affiché. DOT conserve les identifiants, éléments et relations orientées mais Graphviz calcule son propre rendu ; Excalidraw conserve les formes et tracés visibles, sans remplacer le TOML comme format de sauvegarde Sequit. « Exporter l’image… » ouvre une modale à la manière d’Excalidraw : aperçu, nom de fichier (slug du titre par défaut), « Uniquement la sélection » (coché d’office quand une sélection existe : les entités choisies et les relations qui les joignent, cadrées avec 32 px de marge, sans lanes ni régions), « Fond » (blanc, sinon transparent), « Échelle » 1×/2×/3× avec la taille en pixels, puis « PNG », « SVG » et « Copier dans le presse-papiers » (PNG). L’image est la scène rendue (`html-to-image`, `canvas-image.ts`) à sa taille naturelle, sans le zoom d’écran ni les marques de sélection ; le SVG est un `foreignObject` HTML, fidèle dans un navigateur et non éditable en vectoriel. Les styles SVG des relations restent des attributs, le clone ne lisant pas les feuilles de style dans un `<svg>`. « Imprimer… » (ou `Cmd/Ctrl+P`) n’imprime que la scène, en couleurs : l’en-tête, les contrôles et les superpositions sont masqués, le zoom d’écran est ignoré et la scène est réduite (jamais agrandie) pour tenir sur une feuille, dans la zone imprimable commune à A4 et Letter avec 10 mm de marge ; l’orientation de la feuille (`@page`, `canvas-print.ts`) est celle qui montre la scène le plus grand, Safari laissant ce choix à la boîte de dialogue. « Ouvrir… » remplace le document courant par un fichier local après validation ; un fichier invalide affiche ses diagnostics et conserve le document. Le chip de mise en page, en haut du canvas, affiche où se trouve le but (« But en haut », « But à gauche »…) ; il ouvre un menu qui propose les quatre directions puis le côté serré : « Serrer vers le but » (biais à l’origine de la direction) ou « Aligner les points de départ » (biais opposé). Changer de direction conserve le côté choisi ; direction et biais partent en une seule commande, en local comme en session partagée, où le chip est inactif hors connexion.
- Le chip a un second segment, à droite de la direction : « Layout simple » ou « N lanes », qui ouvre la modale « Lanes ». Sans lanes, « Activer les lanes » prépare « Lane 1 » et « Lane 2 » à renommer ; sinon la modale liste les lanes racine (nom, ordre par ▲▼, suppression) avec « Ajouter une lane » et l’orientation, libellée d’après la direction (« En colonnes » / « En bandes »). Tout part en une seule commande `updateLanes` à l’enregistrement : le document passe en format 3 (ou revient en format 2 après « Désactiver les lanes »), chaque élément racine garde sa lane si elle survit, le contenu d’une lane supprimée rejoint la lane choisie dans la modale (la première par défaut), et les membres d’un groupe héritent. Le moteur de lanes racine accepte deux ou trois lanes et refuse jonctions et groupes contenant des boîtes : la modale plafonne l’ajout et prévient ; le canvas affiche alors son diagnostic. En collaboration, la commande est proposée telle quelle.
- Une boîte de premier niveau porte sa lane : un double-clic sur l’espace libre d’une lane y fait saisir la boîte, `N` reprend la lane de la sélection, sinon la première lane. Les modales Boîte et Groupe proposent un sélecteur « Lane » pour un élément racine ; un membre de groupe n’en a pas.
- Le document courant est conservé dans le navigateur (`localStorage`, clé `sequit:recent-documents`) : un fichier ouvert ou un document créé avec « Nouveau document » y entre aussitôt ; le document vide présenté à la première visite y entre à sa première modification. Chaque modification est réécrite après un court délai et au plus tard à la fermeture de la page. Au chargement, la page rouvre le dernier document conservé ; en son absence, elle crée un nouveau document vide avec un identifiant propre et la famille Générique. « Documents récents… » liste au plus 12 documents par identifiant, du plus récent au plus ancien, avec « Ouvrir » et « Retirer » ; une entrée qui ne s’ouvre plus affiche ses diagnostics. Si le stockage refuse une écriture, la page prévient avant de quitter tant que des modifications ne sont ni conservées ni exportées, et « Ouvrir… » avertit que le document sera remplacé sans être enregistré.
- « Collaborer » (en-tête) ouvre une session partagée à la manière d’Excalidraw : la modale demande le nom du participant (conservé dans le navigateur), puis publie le document courant dans une room dont l’identifiant aléatoire (20 caractères, `[a-z0-9]`) devient l’identifiant du document et le secret du lien `/session/<room>`. Le document est transmis à la page de session par `sessionStorage`, jamais par l’URL. Une personne qui ouvre le lien sans nom conservé le saisit d’abord ; « Annuler » ramène à l’accueil. La room prend l’état du serveur si elle existe déjà ; un lien vers une room inconnue ouvre une session vide.
- Dans la session, l’en-tête montre l’état de connexion, les participants sous forme d’avatars colorés (soi en premier, initiales, au plus cinq puis « +N ») et « Partager », qui ouvre la modale de session : lien sélectionné avec « Copier le lien » (repli sur la sélection si le presse-papiers est refusé), nom modifiable en direct, et « Quitter la session ». Quitter conserve une copie locale du document partagé dans les documents récents et ramène à l’accueil ; la room reste ouverte aux autres. Le menu du document n’y propose que « Renommer le document », « Exporter… », « Exporter l’image… » et « Imprimer… ». Un refus terminal recharge la page et affiche son message une seule fois, via `sessionStorage`.
- Présence sur le canvas : le curseur de chaque participant est publié au plus toutes les 50 ms, au rythme du transport, et affiché chez les autres avec son nom et sa couleur d’avatar, en interpolant chaque déplacement (110 ms, courbe de sortie, désactivée avec `prefers-reduced-motion`). Un curseur immobile depuis six secondes s’estompe. Quitter le canvas ou la fenêtre ne l’efface pas : la dernière position reste visible tant que le participant est connecté. Un curseur hors du viewport devient une pastille au bord de l’écran, orientée vers lui et cliquable pour s’y rendre. Cliquer sur l’avatar d’un participant le suit : le viewport se recentre sur son curseur (ou, à défaut, sa sélection) à chaque déplacement ; un geste de défilement, un clic ou une touche dans le canvas, ou un nouveau clic sur l’avatar, arrête le suivi. Les sélections distantes (boîtes, groupes, jonctions, relations) restent encadrées au nom du participant.
- En développement, Vite relaie `/collab/<room>` vers le worker de collaboration ; déployé, le worker web le transmet par son service binding `COLLABORATION` (`src/routes/collab/[room]/+server.ts`).
- Cycle de vie d’une room : le Durable Object garde le document dans son stockage SQLite tant que quelqu’un s’y connecte. Vingt-quatre heures après le départ du dernier participant, il archive l’état Yjs compacté et une projection TOML dans le bucket R2 `ROOM_ARCHIVE` (`rooms/<room>/state.yjs`, `rooms/<room>/document.toml`), puis efface son stockage : plus rien n’est facturé pour une room endormie. Ouvrir le lien réveille la room depuis l’archive, avec le même état et le même compteur de commits ; une room jamais initialisée est simplement oubliée. Si l’archivage échoue, le stockage est conservé et l’alarme réessayée. Le bucket `sequit-room-archive` est déclaré dans le `wrangler.jsonc` du worker ; Wrangler le crée en local et au premier `wrangler deploy` s’il n’existe pas encore sur le compte. Seule la rétention de l’archive se règle en dehors du dépôt, par une règle de cycle de vie R2.
- Le worker refuse un identifiant de room qui ne respecte pas la forme produite par le client (400 avant de nommer un objet) et n’admet pas plus de 50 sockets par room (429 « Room full » ; le client réessaie avec son délai croissant). La limitation par adresse IP relève d’une règle WAF Cloudflare sur `/collab/*`, prérequis de déploiement, pas du code.
- Journal du worker : une ligne structurée par événement (`room.restored`, `connected`, `disconnected`, `full`, `initialized`, `commands`, `retry`, `rejected`, `idle-deferred`, `archived`, `purged`, `archive-failed`), lisible dans Workers Logs et sous `wrangler dev`. La room y est désignée par les douze premiers caractères hexadécimaux du SHA-256 de son identifiant, jamais par le secret lui-même ; les synchronisations de texte, une par lot de frappes, ne sont pas journalisées.

### Modèle d’interaction auteur retenu (30 septembre 2026)

Ce modèle remplace les variantes hypothétiques de l’atelier pour les parcours concernés. La section précédente décrit le comportement livré ; elle est mise à jour à mesure que chaque ligne est intégrée.

Conventions :

- Dans le canvas, les raccourcis sont des lettres nues, actives seulement quand le focus est sur le canvas et jamais dans un champ de saisie. Les modificateurs sont réservés aux gestes système : `Cmd/Ctrl+Z`, `Cmd/Ctrl+Maj+Z`, `Cmd/Ctrl+A`, Suppr, Échap.
- Dans une modale ou dans la boîte en cours de saisie, les raccourcis reprennent le préfixe `Cmd/Ctrl`, Échap excepté.
- Une action a un seul bouton et une seule touche ; son effet dépend de la sélection courante. Une action inapplicable à la sélection est absente, pas désactivée. Le menu du canvas, au clic droit sur le fond, regroupe sans les dupliquer des actions de la barre latérale, du menu du document et du zoom.
- Une seule modale par type d’élément : l’édition d’une boîte, la création et l’édition d’un groupe ou d’une jonction. Une boîte se crée en place, sans modale. Annuler une création ne crée rien ; aucune suppression compensatoire n’est nécessaire.
- Les raccourcis d’action du canvas (touche, libellé, indice, `aria-keyshortcuts`) sont déclarés une seule fois dans `src/app/web/ui/canvas/canvas-shortcuts.ts` ; les barres, boutons et l’atelier en dérivent.
- Une action affiche son raccourci dans son infobulle (« Propriétés… · E ») et, dans une barre d’actions, un menu ou un pied de modale, dans une touche `<kbd>` par cap, alignées à droite, masquées aux lecteurs d’écran qui reçoivent `aria-keyshortcuts`. Les touches s’écrivent comme la plateforme les imprime, détectée une fois depuis `navigator` : symboles sur macOS (`⇧⌘↵`, `⌫`), mots ailleurs (`Ctrl+Maj+Entrée`, `Suppr`) ; le panneau les lit toujours en mots (`Cmd+Maj+Entrée`).
- Un bouton `?` en bas à droite du canvas, ou la touche `?`, ouvre « Raccourcis clavier », la liste de tous les raccourcis par contexte, dérivée du même catalogue que les boutons. Il est absent sur écran tactile.

| Action             | Sélection requise                               | Geste                                                                                                                                                              | Touche                                                                      | Effet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nouvelle boîte     | aucune, ou un élément dont elle reprend la lane | bouton de la barre latérale, double-clic sur le fond                                                                                                               | `N`                                                                         | Boîte racine saisie en place, dans le groupe dont le fond a été double-cliqué le cas échéant, de la nature des nouvelles boîtes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Créer un enfant    | un nœud ou une jonction                         | bouton contextuel ; poignée « + » d’un nœud, du côté opposé au but                                                                                                 | `C`                                                                         | Boîte enfant saisie en place, reliée à la sélection, dans son conteneur, de la nature des nouvelles boîtes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Créer un frère     | un nœud                                         | poignée « + » sur le côté transverse à la direction                                                                                                                | `S`                                                                         | Boîte saisie en place, reliée à chaque parent de la sélection, dans son groupe et sa lane, de la nature des nouvelles boîtes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Saisir en place    | une boîte, nouvelle ou existante                | double-clic sur la boîte, barre au-dessus de la boîte ; un clic ailleurs enregistre sans sélectionner                                                              | Entrée ; puis `Cmd/Ctrl+Entrée`, `Cmd/Ctrl+Maj+Entrée`, `Cmd/Ctrl+E`, Échap | Saisit le texte dans la boîte ; crée ou enregistre la boîte puis la sélectionne, fait saisir un enfant, ou ouvre ses propriétés ; Échap n’enregistre rien.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Propriétés…        | un élément                                      | bouton contextuel ; double-clic sur l’en-tête d’une boîte, sur un groupe ou une jonction                                                                           | `E`                                                                         | Modale de l’élément : nature, contenu, description, couleur et icône pour une boîte ; libellé et couleur pour un groupe ; opérateur pour une jonction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Nature de la boîte | un nœud, ou la nouvelle boîte en saisie         | clic sur l’en-tête de la boîte sélectionnée, ou de la nouvelle boîte en saisie                                                                                     | —                                                                           | Menu des natures groupées par famille, puis « Gérer les natures du document » ; le choix change la nature de la boîte en une commande, ou celle que prendra la boîte en saisie.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Relier             | —                                               | glissement depuis toute la surface d’un élément vers un nœud, une jonction, l’en-tête ou la bande intérieure de 16 px d’un groupe                                  | —                                                                           | Aucune poignée de connexion. Une étiquette près du pointeur nomme l’effet du relâcher, ou le refus avant qu’il ait lieu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Déplacer           | —                                               | glissement depuis un élément vers l’intérieur d’un groupe ou le fond du canvas                                                                                     | —                                                                           | L’élément saisi, avec la sélection s’il en fait partie, entre dans le groupe ou revient à la racine (commande `move`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Jonction           | une relation, ou plusieurs relations seules     | double-clic sur la relation, bouton contextuel, barre de la sélection                                                                                              | `J`                                                                         | Insère une jonction sur la relation (origine → jonction → destination) et ouvre sa modale pour l’opérateur. Avec plusieurs relations sélectionnées, et rien d’autre, leurs origines convergent vers une seule jonction qui pointe vers chacune de leurs destinations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Grouper            | au moins deux nœuds du même conteneur           | bouton contextuel                                                                                                                                                  | `G`                                                                         | Crée le groupe puis ouvre sa modale pour le nommer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Replier / déplier  | un groupe, ou un nœud dans un groupe            | chevron dans l’en-tête, bouton contextuel                                                                                                                          | `[` replie, `]` déplie                                                      | Change `state` ; la projection repliée existante s’applique. Sur un nœud ou une jonction, la touche agit sur son conteneur. `Espace` reste le basculement de sélection au clavier et le modificateur de panoramique.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Dissoudre          | un groupe                                       | modale du groupe, bouton contextuel                                                                                                                                | —                                                                           | Conserve les membres ; distinct de Supprimer, qui supprime le contenu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Supprimer          | au moins un élément                             | bouton contextuel                                                                                                                                                  | Suppr, Backspace                                                            | Inchangé.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Annuler / rétablir | —                                               | aucun bouton                                                                                                                                                       | `Cmd/Ctrl+Z`, `Cmd/Ctrl+Maj+Z`                                              | Historique de la personne, en local comme en collaboration, où chacun n’annule que ses propres pas. Dans un champ de saisie, l’historique natif du champ prévaut.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Tout sélectionner  | —                                               | menu du canvas                                                                                                                                                     | `Cmd/Ctrl+A`                                                                | Sélectionne les nœuds et jonctions affichés, jamais les groupes ni les relations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Natures            | —                                               | menu de nature de la barre latérale ou de l’en-tête de l’invitation d’un canvas vide, « Gérer les natures du document » au bas des menus de nature, menu du canvas | `Cmd/Ctrl+Entrée` dans la modale                                            | Le menu choisit la nature des nouvelles boîtes, présentées par famille. Une modale « Natures » maître-détail : la liste des natures groupées par famille, avec leur usage, à côté du formulaire (libellé, famille, couleur, icône) de la nature sélectionnée, la première à l’ouverture. Une nouvelle nature reprend la famille de celle qui était sélectionnée. Passer à une autre nature ou à « Nouvelle nature » enregistre d’abord le formulaire, sauf un libellé vide qui le retient ; « Enregistrer » (`Cmd/Ctrl+Entrée`) enregistre et ferme ; « Annuler » et Échap ferment sans enregistrer le formulaire. « Supprimer », rouge, passe à une étape de confirmation (`Cmd/Ctrl+Entrée`) : supprimer une nature utilisée exige de réaffecter ses boîtes à une autre nature, proposées par famille ; la dernière nature utilisée ne peut pas être supprimée. « Familles » ajoute en un lot les natures d’une famille prédéfinie absentes du document, par identifiant. En collaboration, le libellé d’une nature existante est un texte partagé en direct ; famille, couleur et icône partent à l’enregistrement. |
| Mise en page       | —                                               | chip de layout à deux segments (livré) : direction et « N lanes » ; un par région à venir                                                                          | —                                                                           | Direction (« But en haut », « But à gauche »…), côté serré (« Serrer vers le but », « Aligner les points de départ ») et lanes racine (deux ou trois, orientation, réaffectation à la suppression). Régions et grille attendent la fin de la refonte du moteur.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Points ouverts : la réaffectation d’une extrémité de relation sans poignée (supprimer puis relier, ou geste dédié). Les opérateurs de jonction sont `xor`, `and` et `or`. Le glissement d’une boîte vers une autre lane, ainsi que la réaffectation de régions et de cellules, n’ont pas encore de geste.

## Signalement des layouts incorrects

Tout utilisateur peut signaler un layout incorrect pour enrichir la base de tests. Le bouton « Signaler un problème de mise en page », en bas à droite du canvas à côté de l’aide et du zoom, ouvre une modale : ce qui ne va pas (chevauchement, croisement évitable, tracé de relation étrange, espacement, ordre des éléments, mise en page impossible, autre ; « mise en page impossible » est présélectionné quand le canvas affiche un échec), un commentaire libre et des zones. « Pointer sur le graphe » replie la modale : un rectangle tracé devient une zone avec les boîtes, groupes, jonctions et tronçons de relation qu’il touche ; un clic pointe la jonction ou la boîte sous le pointeur, sinon une relation à moins de 6 pixels, sinon le groupe le plus intérieur. Échap ou « Terminer » rouvre la modale.

Le rapport est anonymisé dans le navigateur, toujours : chaque texte du document (titre, boîtes, descriptions, natures, groupes, lanes) devient `xxx` et chaque identifiant devient un jeton `e…` de même largeur, attribué dans l’ordre canonique des identifiants d’origine ; un départage par identifiant décide donc de la même façon. Le commentaire part tel quel. Le rapport contient le document anonymisé en TOML, les mesures du canvas, y compris celles des boîtes, groupes et jonctions que masquent les groupes repliés, pour que le document se rejoue aussi déplié, la géométrie affichée sans texte, le relevé de ce que la page a réellement dessiné (boîtes lues dans le DOM et tracés SVG, ramenés en coordonnées du canvas, avec la partie du canvas visible dans la fenêtre), la géométrie du dernier canvas affiché avant celui-ci qui en différait, pour voir ce que le dernier changement a déplacé (ses éléments supprimés depuis sont nommés `x…` ; ce layout précédent ne se rejoue pas, faute de son document), les zones, le navigateur et la fenêtre. Avant l’envoi, le document d’origine et le document anonymisé sont remis en page à froid avec les mêmes mesures : `anonymizationDiverged` signale des géométries différentes, `projectionDiverged` un canvas affiché différent de cette remise en page à froid.

`POST /layout-reports` reconstruit le rapport à partir de ses seuls champs connus et le refuse si son document porte un autre texte que `xxx` ou un identifiant non anonyme, si une géométrie nomme autre chose qu’un jeton `e…`/`x…`, ou s’il dépasse 4 Mo. Le worker web l’écrit dans le bucket R2 `LAYOUT_REPORTS` (`sequit-layout-reports`), sous `layout-reports/<jour UTC>/<id>.json`, avec la date de réception et la version du Worker (`CF_VERSION_METADATA`) ; la catégorie, la date et la version figurent aussi dans les métadonnées de l’objet. La limitation par adresse IP relève d’une règle WAF Cloudflare sur `/layout-reports`, prérequis de déploiement comme pour `/collab/*`. Sous `vite dev`, sans bucket, la route répond 503 ; `pnpm preview` écrit dans le bucket local de Wrangler.

`pnpm reports:pull` copie les rapports du bucket déployé dans `layout-reports/`, ignoré par Git, sous les mêmes chemins ; il passe par la connexion Wrangler (`wrangler login`) et ne réécrit jamais un rapport déjà copié. `pnpm reports:pull --local` lit le bucket local de `pnpm preview`. En développement, `/atelier/reports` liste ces rapports, du plus récent au plus ancien, et rejoue le document anonymisé avec les mesures enregistrées dans le moteur actuel. La page indique si le rejeu redonne exactement la géométrie signalée, ou le même échec ; un échec montre l’erreur, ses causes et la pile d’appels de la plus profonde, et un rejeu différent liste les éléments déplacés, apparus ou disparus. Chaque groupe du document peut être rejoué dans l’autre état, replié ou déplié, pour voir les deux côtés d’un repli ; les rapports antérieurs à la mesure des membres masqués échouent alors faute de mesures. Le dernier changement à l’écran est listé de la même façon, du layout précédent au layout signalé. Le canvas superpose, par calques, le layout signalé, ce que la page a dessiné, la partie visible, le layout précédent, le rejeu et les zones pointées, avec les éléments pointés en rouge. Un fichier que cette version ne sait pas relire est nommé, sans bloquer les autres.

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

Le protocole WebSocket en version `6` utilise des enveloppes CBOR `[6, message]`,
limitées à 1 Mio. Ses messages sont `initialize`, `sync`, `change`, `commit`,
`reject`, `retry`, `conflict` et `presence`. Les refus et notifications portent des
raisons typées sans texte localisé ; le web les traduit avec Paraglide. Les
diagnostics de validation restent des détails techniques anglais. Les pairs v5
restent servis par conversion des raisons en messages neutres non localisés.
Les règles de reprise, de conversion et de santé de la connexion sont détaillées
dans [la documentation de résilience](collaboration-resilience.md).

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
Pas de rollback, d’IndexedDB, d’undo collaboratif global (chacun n’annule que ses
propres pas) ni de récupération après fermeture de page dans cette première
version. Le contrôle texte conserve
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
4. La bibliothèque de natures appartient au document (décision du 30 septembre 2026) ; des modèles de documents pourront la préremplir plus tard.
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
- Les formats TOML 2 à 7 restent lisibles : lanes explicites (3), vraies régions (4), grille racine (5), lanes locales (6) et grille interne (7).
- `LogicDocument` porte actuellement `persistenceFormat` pour sélectionner la sérialisation TOML.
- Les formats Yjs live 3 à 8 restent lisibles : lanes explicites (4), vraies régions (5), grille racine (6), lanes locales (7) et grille interne (8), indépendamment de `persistenceFormat`.
- `DocumentSession` est l’unique façade applicative vers le document Yjs live.
- Les cycles sont rejetés avant le calcul des rangs.
- Les relations ordinaires s’attachent aux faces perpendiculaires à l’axe principal, avec des segments de départ et d’arrivée dans cet axe. En lanes parallèles, cette règle vaut pour les relations internes à une lane ; une relation entre deux lanes part et arrive par les faces latérales tournées l’une vers l’autre. Le cas source valide `G = {A, B}`, `B → x → A`, lorsque G est replié, possède une politique bornée d’attaches latérales dérivées des membres masqués ; ces attaches conservent leur provenance et ne changent pas la règle des relations ordinaires.
- Dans une lane parallèle, deux rangées logiques consécutives se relient par leurs faces principales : droite si les ports sont alignés, deux coudes entre les rangées sinon ; une relation qui saute des rangées longe le couloir de sa lane sans la quitter. Les ports suivent la position de l'extrémité opposée ; ils ne font grandir que la dimension transversale de leur face. Ces relations n'ont pas de repli par une gouttière latérale.
- Une relation longue dont les deux extrémités appartiennent au même groupe emprunte un passage dans le padding de leur groupe commun le plus profond ; sa route ne sort pas de cette enveloppe.
- Un groupe non vide occupe l’intervalle des rangs de son contenu ; un groupe vide endpoint est atomique.
- ELK a été écarté après sa gate de compatibilité ; `layoutGraph(...)` utilise un moteur dédié déterministe.
- Le frontend utilise SvelteKit et TypeScript.
- L'application est déployée sur Cloudflare.
- La collaboration passe par un Worker TypeScript et un Durable Object par document.
- Tailwind CSS habille l'interface ; les couleurs configurables des natures restent des données du document exposées par variables CSS.
- Une seule famille de commandes structurelles, `SharedDocumentCommand`, sert les sessions locale et collaborative derrière une interface de session commune. La session locale exécute ces commandes avec l’exécuteur partagé, sans réseau ; `DocumentCommandKind` et le gateway local sont remplacés, pas doublés.
