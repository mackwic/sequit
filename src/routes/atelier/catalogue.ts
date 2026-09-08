import { additionalGroups, creationScenario } from './catalogue-workbench';
import InlineScene from './InlineScene.svelte';
import ModalScene from './ModalScene.svelte';
import PanelScene from './PanelScene.svelte';
import source from './scenario.toml?raw';
import type { WorkshopGroup, WorkshopVariant } from './workshop-types';
const variants = [
	{
		id: 'modal',
		scene: ModalScene,
		label: 'Modale',
		tag: 'Actuel',
		description: 'Un espace dédié pour écrire. Le graphe passe au second plan.',
		question: 'La coupure avec le graphe aide-t-elle à écrire, ou fait-elle perdre le contexte ?',
	},
	{
		id: 'inline',
		scene: InlineScene,
		label: 'Dans la boîte',
		tag: 'Proposition A',
		description: 'L’éditeur prend la place de la boîte. Les voisines restent visibles.',
		question: 'La proximité suffit-elle à compenser une surface d’écriture plus étroite ?',
	},
	{
		id: 'panel',
		scene: PanelScene,
		label: 'Panneau latéral',
		tag: 'Proposition B',
		description: 'Le contenu s’édite à côté du graphe, dans une zone de largeur constante.',
		question: 'Le regard circule-t-il facilement entre la boîte et son contenu ?',
	},
] as const satisfies readonly WorkshopVariant[];
export const workshopGroups = [
	{
		id: 'BOX',
		label: 'Boîtes',
		scenarios: [
			{
				id: 'SC-BOX-EDIT',
				label: 'Éditer une boîte',
				journey: 'Écrire · enregistrer · annuler',
				title: 'Écrire sans perdre le fil.',
				subtitle: 'Trois façons d’éditer. Un même graphe, un même geste.',
				instruction:
					'Sélectionne « Comparer les options », ouvre avec E ou Edit, ajoute deux lignes et enregistre. Retrouve la boîte, rouvre l’éditeur, modifie le texte puis annule avec Échap. Compare ensuite les autres variantes.',
				fixtureInstruction: () =>
					'Sélectionne une boîte, ouvre avec E ou Edit, ajoute deux lignes et enregistre. Retrouve-la, puis essaie d’abandonner une modification avec Échap.',
				source,
				initialState: { zoom: 1, selection: [] },
				variants,
			},
			creationScenario,
		],
	},
	...additionalGroups,
] as const satisfies readonly WorkshopGroup[];
