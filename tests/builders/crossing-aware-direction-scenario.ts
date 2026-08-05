import {
	EndpointKind,
	type LayoutConfiguration,
	type LogicDocument,
	type LogicNode,
	PERSISTENCE_FORMAT,
} from '../../src/lib/document/logic-document';
import { orderKey } from '../../src/lib/document/order-key';

export function crossingAwareDirectionScenario(layout: LayoutConfiguration): LogicDocument {
	let order = 0;
	const node = (id: string, markdown: string): LogicNode => ({
		kind: EndpointKind.Node,
		id,
		natureId: 'statement',
		markdown,
		layoutOrder: orderKey(`a${order++}`),
	});
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'crossing-aware-direction',
		title: 'Crossing-aware direction',
		layout,
		natures: [{ id: 'statement', label: 'Statement', color: '#334455' }],
		groups: [],
		nodes: [
			node('source-a', 'Source A'),
			node('source-b', 'Source B'),
			node('target-a', 'Target A'),
			node('target-b', 'Target B'),
			node('successor', 'Successor'),
			node('established-isolated', 'Established'),
			node('zz-added-first', 'Added first'),
			node('aa-added-second', 'Added second'),
		],
		junctions: [],
		relations: [
			{ id: 'source-b-to-target-a', from: 'source-b', to: 'target-a' },
			{ id: 'target-a-to-successor', from: 'target-a', to: 'successor' },
			{ id: 'target-b-to-successor', from: 'target-b', to: 'successor' },
		],
	};
}
