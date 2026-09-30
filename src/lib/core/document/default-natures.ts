import type { LogicNature } from './logic-document';

/**
 * The library a document starts with, identical to the example documents so a new document and
 * an imported one share the same vocabulary. Templates will replace this once they exist.
 */
export function defaultNatures(): readonly LogicNature[] {
	return [
		{ id: 'need', label: 'Need', color: '#f4c400', icon: 'phosphor:flag' },
		{ id: 'want', label: 'Want', color: '#ed58c7', icon: 'phosphor:heart' },
		{ id: 'solution', label: 'Solution', color: '#6f70e8', icon: 'phosphor:lightbulb' },
		{ id: 'goal', label: 'Goal', color: '#12c930', icon: 'phosphor:target' },
		{ id: 'precondition', label: 'Precondition', color: '#8981ec', icon: 'phosphor:key' },
		{
			id: 'desirable-effect',
			label: 'Desirable Effect',
			color: '#62c985',
			icon: 'phosphor:sparkle',
		},
		{ id: 'note', label: 'Note', color: '#f2ea20', icon: 'phosphor:note' },
	];
}
