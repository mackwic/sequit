import {
	type LayoutConfiguration,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../src/lib/document/logic-document';

export function crossingAwareDirectionScenario(layout: LayoutConfiguration): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'crossing-aware-direction',
		title: 'Crossing-aware direction',
		layout,
		endpointOrder: [
			'source-a',
			'source-b',
			'target-a',
			'target-b',
			'successor',
			'established-isolated',
			'zz-added-first',
			'aa-added-second',
		],
		natures: [{ id: 'statement', label: 'Statement', color: '#334455' }],
		groups: [],
		nodes: [
			{ id: 'source-a', natureId: 'statement', markdown: 'Source A' },
			{ id: 'source-b', natureId: 'statement', markdown: 'Source B' },
			{ id: 'target-a', natureId: 'statement', markdown: 'Target A' },
			{ id: 'target-b', natureId: 'statement', markdown: 'Target B' },
			{ id: 'successor', natureId: 'statement', markdown: 'Successor' },
			{ id: 'established-isolated', natureId: 'statement', markdown: 'Established' },
			{ id: 'zz-added-first', natureId: 'statement', markdown: 'Added first' },
			{ id: 'aa-added-second', natureId: 'statement', markdown: 'Added second' },
		],
		junctions: [],
		relations: [
			{ id: 'source-b-to-target-a', from: 'source-b', to: 'target-a' },
			{ id: 'target-a-to-successor', from: 'target-a', to: 'successor' },
			{ id: 'target-b-to-successor', from: 'target-b', to: 'successor' },
		],
	};
}
