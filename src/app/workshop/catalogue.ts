import { additionalGroups, creationScenario } from './catalogue-workbench';
import ModalScene from './ModalScene.svelte';
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
				subtitle: 'Une seule boîte de dialogue, un même graphe, un même geste.',
				instruction:
					'Sélectionne « Comparer les options », ouvre avec E ou Edit, ajoute deux lignes et enregistre. Rouvre l’éditeur, modifie le texte puis annule avec Échap.',
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
