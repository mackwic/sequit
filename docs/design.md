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
- une couleur constante dans le document.

Extensions possibles, encore non décidées :

- une icône ;
- une description ;
- des règles sur les relations autorisées ;
- un style visuel complémentaire.

### Boîte

Une boîte possède :

- un identifiant stable ;
- une nature ;
- un contenu rich text ;
- éventuellement des métadonnées.

Le titre visible correspond à la nature de la boîte. La couleur du titre est déterminée par cette nature.

### Relation

Une relation est orientée et relie une boîte source à une boîte cible.

Le modèle visuel pourra ressembler à un arbre, mais le modèle logique visé est un graphe orienté acyclique (DAG). Cela autorise notamment plusieurs antécédents pour une même boîte et la convergence de plusieurs branches.

La signification exacte d'une relation reste à définir : dépendance, contribution, prérequis, production, ou relation générique orientée.

## Représentation textuelle

La représentation textuelle est la forme lisible et portable du document. Elle est parsée vers un graphe logique normalisé, lui-même projeté sur le canvas.

```text
Document textuel
      ↓ parse / validation
Graphe logique normalisé
      ↓ tri topologique / layout
Canvas interactif
```

Exemple exploratoire, non contractuel :

```text
types:
  Goal         color: "#7c5cff"
  Precondition color: "#e5a93d"
  Action       color: "#4caf78"
  Want         color: "#e2679f"

launch [Goal]:
  Lancer la première version avant septembre.

market [Precondition]:
  Confirmer l'intérêt de dix utilisateurs pilotes.

prototype [Action]:
  Construire un prototype collaboratif.

feedback [Want]:
  Obtenir des retours sur le modèle d'interaction.

market -> prototype
prototype -> launch
prototype -> feedback
```

Cette syntaxe illustre les propriétés recherchées, sans constituer encore une spécification :

- déclarations compactes ;
- identifiants explicites et stables ;
- relations faciles à lire ;
- contenu multiligne ;
- bibliothèque de natures locale au document.

Le rich text pourrait être représenté par un sous-ensemble de Markdown.

## Source de vérité et édition

Le système doit éviter deux états indépendants — un fichier texte et un canvas — qu'il faudrait réconcilier.

Le modèle cible comporte trois représentations du même document :

1. **Un modèle structuré collaboratif**, manipulé par l'application.
2. **Une sérialisation textuelle stable**, destinée à la lecture, l'import, l'export et éventuellement l'édition directe.
3. **Une projection visuelle**, calculée depuis le modèle structuré.

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

## Collaboration

La collaboration doit porter sur des objets structurés :

- bibliothèque de natures ;
- boîtes ;
- contenu rich text ;
- relations ;
- options ou contraintes de présentation.

Yjs est retenu comme moteur CRDT. Le schéma exact des données partagées reste à concevoir.

Le format textuel reste la représentation canonique portable. Il ne faut cependant pas synchroniser naïvement le document complet comme une simple chaîne si cela rend les opérations visuelles concurrentes fragiles.

## Architecture technique retenue

- frontend en SvelteKit et TypeScript ;
- déploiement sur Cloudflare ;
- Tailwind CSS pour l'interface, complété par des variables CSS pour les couleurs configurables des natures ;
- Worker Cloudflare en TypeScript pour l'entrée HTTP, l'authentification future et le routage ;
- un Durable Object par document pour coordonner les connexions WebSocket et la synchronisation Yjs.

La stratégie de persistance des mises à jour et snapshots Yjs reste à définir.

## Hors périmètre à ce stade

Aucune décision n'est encore prise concernant :

- les comptes et permissions ;
- la stratégie de persistance ;
- les commentaires ;
- les pièces jointes ;
- les modèles de documents ;
- les règles métier avancées ;
- l'exécution ou la simulation du graphe ;
- les formats d'export visuel ;
- le mode hors ligne.

## Questions ouvertes

1. Quelle est la sémantique précise d'une relation orientée ?
2. Le graphe est-il toujours acyclique ?
3. Les natures imposent-elles des règles de connexion ou seulement une apparence ?
4. La bibliothèque de natures appartient-elle au document, à un espace de travail, ou aux deux ?
5. Le contenu des boîtes est-il du Markdown, un document rich text structuré, ou un sous-ensemble spécifique ?
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
- Le format textuel exact reste à concevoir ; Mermaid sert d'inspiration, pas encore de dépendance ni de standard retenu.
- Yjs est retenu comme moteur CRDT ; le périmètre précis du document partagé reste ouvert.
- Le frontend utilise SvelteKit et TypeScript.
- L'application est déployée sur Cloudflare.
- La collaboration passe par un Worker TypeScript et un Durable Object par document.
- Tailwind CSS habille l'interface ; les couleurs configurables des natures restent des données du document exposées par variables CSS.
