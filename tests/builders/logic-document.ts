import { type LogicDocument, PERSISTENCE_FORMAT } from '../../src/lib/document/logic-document';

export function validLogicDocument(): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'valid-document',
		title: 'Valid document',
		layout: { direction: 'bottom-to-top', bias: 'top' },
		natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
		groups: [
			{ id: 'container', label: 'Container' },
			{ id: 'endpoint-group', label: 'Endpoint group' },
			{ id: 'orphan-group', label: 'Orphan group' },
		],
		nodes: [
			{ id: 'source-a', natureId: 'goal', groupId: 'container', markdown: 'Source A\n' },
			{ id: 'source-b', natureId: 'goal', groupId: 'container', markdown: 'Source B\n' },
			{ id: 'target', natureId: 'goal', markdown: 'Target\n' },
			{ id: 'isolated', natureId: 'goal', markdown: 'Isolated\n' },
		],
		junctions: [{ id: 'choice', operator: 'xor', groupId: 'container' }],
		relations: [
			{ id: 'a-to-choice', from: 'source-a', to: 'choice' },
			{ id: 'b-to-choice', from: 'source-b', to: 'choice' },
			{ id: 'choice-to-target', from: 'choice', to: 'target' },
			{ id: 'group-to-target', from: 'endpoint-group', to: 'target' },
		],
	};
}
