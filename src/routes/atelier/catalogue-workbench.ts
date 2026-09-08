import type { Component } from 'svelte';

import branching from './branching.toml?raw';
import CollaborationScene from './CollaborationScene.svelte';
import navigation from './navigation.toml?raw';
import source from './scenario.toml?raw';
import ConnectionTools from './tools/ConnectionTools.svelte';
import ContentTools from './tools/ContentTools.svelte';
import ContextTools from './tools/ContextTools.svelte';
import CreationTools from './tools/CreationTools.svelte';
import DocumentTools from './tools/DocumentTools.svelte';
import GroupTools from './tools/GroupTools.svelte';
import JunctionTools from './tools/JunctionTools.svelte';
import LayoutTools from './tools/LayoutTools.svelte';
import NatureTools from './tools/NatureTools.svelte';
import NavigationTools from './tools/NavigationTools.svelte';
import RecoveryTools from './tools/RecoveryTools.svelte';
import SelectionTools from './tools/SelectionTools.svelte';
import TextTools from './tools/TextTools.svelte';
import WorkbenchScene from './WorkbenchScene.svelte';
import type {
	WorkbenchToolProps,
	WorkshopFrame,
	WorkshopGroup,
	WorkshopScenario,
	WorkshopVariant,
} from './workshop-types';

function variant(
	tools: Component<WorkbenchToolProps>,
	id: string,
	label: string,
	description: string,
	question: string,
	frame: WorkshopFrame = {},
): WorkshopVariant {
	return {
		id,
		frame,
		presentation: id,
		label,
		description,
		question,
		tag: 'À comparer',
		scene: WorkbenchScene,
		tools,
	};
}
function scenario(
	id: string,
	label: string,
	journey: string,
	instruction: string,
	variants: WorkshopScenario['variants'],
	fixture = branching,
	fixtureInstruction?: (nodeCount: number) => string,
): WorkshopScenario {
	return {
		id,
		label,
		title: label,
		subtitle: 'Même intention, plusieurs façons d’agir. Essaie, puis compare.',
		journey,
		instruction,
		...(fixtureInstruction && { fixtureInstruction }),
		variants,
		source: fixture,
		initialState: { zoom: 0.8, selection: [] },
	};
}
export const creationScenario = scenario(
	'SC-BOX-CREATE',
	'Développer une idée',
	'Créer · relier · dupliquer',
	'Crée une boîte isolée, puis sélectionne une boîte et ajoute une suite reliée. Choisis une nature et duplique la sélection.',
	[
		variant(
			CreationTools,
			'contextual',
			'Depuis la sélection',
			'Un ajout lancé dans le contexte de la sélection.',
			'Le lien avec la boîte de départ est-il évident ?',
		),
		variant(
			CreationTools,
			'palette',
			'Palette de création',
			'Une palette rassemble les réglages avant de créer.',
			'La palette aide-t-elle à choisir sans ralentir ?',
			{ panel: 'right' },
		),
		variant(
			CreationTools,
			'keyboard',
			'Commande N',
			'N ouvre le formulaire depuis le canvas.',
			'Le raccourci reste-t-il facile à découvrir ?',
		),
	],
);
export const additionalGroups: readonly WorkshopGroup[] = [
	{
		id: 'NAV',
		label: 'Vue du canvas',
		scenarios: [
			scenario(
				'SC-NAV-EXPLORE',
				'Explorer un grand graphe',
				'Déplacer · cadrer · retrouver',
				'Déplace la vue avec Espace + glisser, zoome, cadre l’ensemble puis recherche « hypothèses » et rejoins cette boîte.',
				[
					variant(
						NavigationTools,
						'controls',
						'Commandes de cadrage',
						'Recherche, zoom et cadrage dans une petite palette.',
						'Retrouves-tu ta position après un changement d’échelle ?',
					),
					variant(
						NavigationTools,
						'minimap',
						'Avec mini-carte',
						'La même palette accompagnée d’une carte cliquable.',
						'La mini-carte facilite-t-elle réellement le retour à une branche ?',
					),
				],
				navigation,
				() =>
					'Déplace la vue avec Espace + glisser, zoome, puis recherche une boîte par son texte. Rejoins-la et ouvre l’édition avec E.',
			),
		],
	},
	{
		id: 'SEL',
		label: 'Sélection et focus',
		scenarios: [
			scenario(
				'SC-SEL-COMPOSE',
				'Composer une sélection',
				'Ajouter · retirer · étendre',
				'Sélectionne plusieurs boîtes, retire-en une, essaie le rectangle puis les voisins. Termine au clavier et vide la sélection.',
				[
					variant(
						SelectionTools,
						'modifier',
						'Modificateur + rectangle',
						'Ctrl/Cmd + clic et sélection par zone.',
						'Le geste est-il assez découvrable sans mode explicite ?',
					),
					variant(
						SelectionTools,
						'mode',
						'Mode multiple',
						'Un bouton active les clics additifs et le rectangle.',
						'Le mode explicite aide-t-il ou crée-t-il des oublis ?',
					),
				],
			),
		],
	},
	{
		id: 'CTX',
		label: 'Actions contextuelles',
		scenarios: [
			scenario(
				'SC-CTX-ACTIONS',
				'Trouver la bonne commande',
				'Révéler · éditer · dupliquer',
				'Sélectionne une boîte, ouvre son édition, annule. Ajoute une seconde boîte à la sélection et duplique-les.',
				[
					variant(
						ContextTools,
						'anchored',
						'Toolbox ancrée',
						'Les commandes suivent la première boîte sélectionnée.',
						'La proximité compense-t-elle les déplacements de la toolbox ?',
						{ contextualActions: 'custom' },
					),
					variant(
						ContextTools,
						'fixed',
						'Barre fixe',
						'Les commandes restent dans le coin du canvas.',
						'La stabilité aide-t-elle à comprendre la portée de l’action ?',
						{ contextualActions: 'custom' },
					),
					variant(
						ContextTools,
						'menu',
						'Menu contextuel',
						'Clic droit ou bouton explicite pour ouvrir les actions.',
						'Les commandes restent-elles faciles à trouver ?',
						{ contextualActions: 'custom' },
					),
				],
			),
		],
	},
	{
		id: 'REL',
		label: 'Relations et jonctions',
		scenarios: [
			scenario(
				'SC-REL-CONNECT',
				'Relier sans ambiguïté',
				'Tracer · retargeter · annuler',
				'Relie deux boîtes, change la cible d’une relation, annule un tracé puis tente de relier la décision à sa source : le cycle doit être refusé.',
				[
					variant(
						ConnectionTools,
						'handles',
						'Poignées de connexion',
						'Glisser depuis une poignée vers une boîte ; listes disponibles au clavier.',
						'Vois-tu clairement la source, la cible et le sens ?',
					),
					variant(
						ConnectionTools,
						'two-step',
						'Source puis cible',
						'Deux clics dans le canvas pour former une relation.',
						'Les deux étapes sont-elles plus précises ou plus lourdes ?',
					),
				],
			),
			scenario(
				'SC-REL-JUNCTION',
				'Exprimer une convergence',
				'Choisir · converger · vérifier',
				'Choisis deux sources et une cible. Insère une jonction XOR et lis les trois relations produites.',
				[
					variant(
						JunctionTools,
						'explicit',
						'Jonction explicite',
						'Choisir les trois extrémités puis créer une jonction XOR.',
						'Le rôle de la jonction se comprend-il avant de valider ?',
					),
					variant(
						JunctionTools,
						'assisted',
						'Suggestion de convergence',
						'Une suggestion apparaît après le choix des extrémités.',
						'L’assistance explique-t-elle sa proposition sans l’imposer ?',
					),
				],
			),
		],
	},
	{
		id: 'GRP',
		label: 'Groupes',
		scenarios: [
			scenario(
				'SC-GRP-ORGANIZE',
				'Regrouper un raisonnement',
				'Grouper · replier · dissoudre',
				'Regroupe deux boîtes, renomme le groupe, retire puis rajoute un membre. Replie, déplie puis dissous le groupe.',
				[
					variant(
						GroupTools,
						'direct',
						'Sélection dans le canvas',
						'Composer la sélection dans le graphe puis agir sur le groupe.',
						'Les frontières du groupe restent-elles compréhensibles ?',
					),
					variant(
						GroupTools,
						'inspector',
						'Inspecteur de groupe',
						'Une liste permet aussi de choisir les membres.',
						'La liste facilite-t-elle la gestion d’un groupe étendu ?',
						{ panel: 'right' },
					),
				],
			),
		],
	},
	{
		id: 'NAT',
		label: 'Content · natures et styles',
		scenarios: [
			scenario(
				'SC-NAT-STYLE',
				'Exprimer sans changer la logique',
				'Colorer · illustrer · hériter',
				'Sélectionne une boîte. Donne une couleur et une icône à sa nature, personnalise cette boîte puis change à nouveau la nature. Reviens à l’héritage et essaie Annuler.',
				[
					variant(
						ContentTools,
						'node',
						'Depuis le nœud',
						'Le nœud montre ce qu’il hérite et ce qui lui est propre.',
						'La portée de chaque modification est-elle évidente ?',
						{ panel: 'right' },
					),
					variant(
						ContentTools,
						'nature',
						'Depuis la nature',
						'Le style commun donne le point de départ ; les exceptions restent visibles.',
						'Comprends-tu quelles boîtes vont changer ?',
						{ panel: 'right' },
					),
				],
				source,
			),
			scenario(
				'SC-NAT-MANAGE',
				'Faire évoluer les natures',
				'Créer · appliquer · réaffecter',
				'Crée une nature, applique-la à une boîte. Change sa couleur, puis supprime-la en choisissant la nature de remplacement.',
				[
					variant(
						NatureTools,
						'popover',
						'Sélecteur enrichi',
						'Sélection des natures et gestion à portée de main.',
						'Comprends-tu quand une modification touche toutes les boîtes ?',
					),
					variant(
						NatureTools,
						'library',
						'Bibliothèque dédiée',
						'Les natures sont présentées comme une ressource du document.',
						'Cette vue aide-t-elle à distinguer création et application ?',
						{ panel: 'right' },
					),
				],
			),
		],
	},
	{
		id: 'LAY',
		label: 'Organisation',
		scenarios: [
			scenario(
				'SC-LAY-ARRANGE',
				'Réorganiser sans se perdre',
				'Orienter · espacer · ordonner',
				'Passe de haut en bas à gauche à droite et augmente l’espacement. Si plusieurs boîtes partagent un rang, essaie de changer leur ordre.',
				[
					variant(
						LayoutTools,
						'live',
						'Réglage continu',
						'Chaque réglage redessine immédiatement le graphe.',
						'Les déplacements restent-ils prévisibles ?',
					),
					variant(
						LayoutTools,
						'apply',
						'Application explicite',
						'Les réglages restent en attente du bouton Appliquer.',
						'Le contrôle supplémentaire vaut-il une étape de plus ?',
					),
				],
			),
		],
	},
	{
		id: 'DOC',
		label: 'Document',
		scenarios: [
			scenario(
				'SC-DOC-LIFECYCLE',
				'Commencer et emporter',
				'Renommer · exporter · importer',
				'Renomme et exporte le document. Crée un document vide, importe ton export, puis essaie un texte invalide : le document doit être conservé.',
				[
					variant(
						DocumentTools,
						'menu',
						'Menu document',
						'Les actions se découvrent dans un menu.',
						'Les commandes de début et de fin sont-elles faciles à trouver ?',
					),
					variant(
						DocumentTools,
						'sheet',
						'Panneau document',
						'Toutes les opérations sont visibles dans un panneau.',
						'La visibilité aide-t-elle ou surcharge-t-elle la séance ?',
						{ panel: 'right' },
					),
				],
			),
			scenario(
				'SC-DOC-TEXT',
				'Passer du graphe au texte',
				'Écrire · valider · revenir',
				'Change le titre ou le contenu dans le TOML et applique. Introduis ensuite une erreur puis relis le graphe pour abandonner ce brouillon.',
				[
					variant(
						TextTools,
						'split',
						'Vue partagée',
						'Le texte structuré reste à côté du graphe.',
						'Le lien entre texte et boîtes est-il assez lisible ?',
						{ panel: 'split' },
					),
					variant(
						TextTools,
						'dedicated',
						'Vue texte dédiée',
						'Une surface entière pour éditer le document.',
						'Le gain de place compense-t-il le changement de vue ?',
						{ panel: 'overlay' },
					),
				],
			),
		],
	},
	{
		id: 'COL',
		label: 'Collaboration',
		scenarios: [
			scenario(
				'SC-COL-WORK',
				'Travailler à deux',
				'Éditer · déconnecter · reprendre',
				'Sélectionne et modifie dans Alice puis dans Bob. Mets Bob hors ligne, enregistre un brouillon de son côté, modifie Alice puis reconnecte Bob et observe la convergence.',
				[
					{
						id: 'ambient',
						presentation: 'ambient',
						scene: CollaborationScene,
						tag: 'À comparer',
						label: 'Présence discrète',
						description:
							'Deux sessions réseau réelles ; la présence est un aperçu local entre ces deux vues.',
						question: 'La présence suffit-elle pour comprendre ce qui change ?',
					},
					{
						id: 'activity',
						presentation: 'activity',
						scene: CollaborationScene,
						tag: 'À comparer',
						label: 'Avec activité',
						description: 'Les mêmes sessions avec un journal des validations et mises à jour.',
						question: 'Le journal aide-t-il à comprendre l’attente et la reprise ?',
					},
				],
				source,
			),
		],
	},
	{
		id: 'SYS',
		label: 'Contrôle et retour',
		scenarios: [
			scenario(
				'SC-SYS-RECOVER',
				'Revenir sur une action',
				'Supprimer · annuler · rétablir',
				'Sélectionne une boîte reliée, supprime-la puis annule et rétablis. Compare la fluidité et la compréhension des relations touchées.',
				[
					variant(
						RecoveryTools,
						'undo-first',
						'Annulation accessible',
						'La suppression est immédiate ; son impact et Annuler restent visibles.',
						'Te sens-tu libre d’essayer sans perdre confiance ?',
					),
					variant(
						RecoveryTools,
						'confirm-impact',
						'Confirmer l’impact',
						'Une confirmation indique les boîtes et relations concernées.',
						'Cette pause apporte-t-elle une information utile ?',
					),
				],
			),
		],
	},
];
