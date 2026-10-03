import { describe, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import {
	defined,
	LAYOUT_DIRECTIONS,
	layoutConfiguration,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { AssertRoutes } from '../../../support/assertions/assert-routes';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { defaultBiasFor } from '../../../support/harnesses/visual-directions';
import { junctionNetworkDocument } from '../../../support/scenarios/dedicated-channel-witnesses';

const size = { width: 220, height: 116 };

/** The reported canvas: QuickPrompt only reaches TextSelection, which DynamicPrompt also reaches. */
const promptGraph = {
	nodes: Object.fromEntries(
		['dynamic', 'quick', 'text', 'cell', 'block', 'base'].map((id) => [id, size]),
	),
	relations: [
		['dynamic', 'text'],
		['dynamic', 'cell'],
		['dynamic', 'block'],
		['quick', 'text'],
		['text', 'base'],
		['cell', 'base'],
		['block', 'base'],
	].map(([from = '', to = '']) => ({ id: `${from}-${to}`, from, to })),
};

function oriented(document: LogicDocument, direction: (typeof LAYOUT_DIRECTIONS)[number]) {
	return {
		...document,
		layout: defined(layoutConfiguration(direction, defaultBiasFor(direction))),
	};
}

describe('relations suggested by shared ink', () => {
	it.each(LAYOUT_CONFIGURATIONS)(
		'keeps QuickPrompt apart from the branches of DynamicPrompt in $direction/$bias',
		async ({ direction, bias }) => {
			const layout = await layoutNodes({ ...promptGraph, direction, bias });
			AssertLayout(layout).routes().haveNoPhantomRelation();
		},
	);

	// Known defect: the rail of j -> sink runs through the departure trunk of k, which also
	// branches to a and b, so j seems to reach b.
	it.fails.each(LAYOUT_DIRECTIONS)(
		'keeps the junction network free of suggested relations in %s',
		async (direction) => {
			const document = oriented(junctionNetworkDocument('junction-network'), direction);
			const graph = createGraph(document);
			if (!graph.ok) throw new Error('The junction network witness must form a graph.');
			const layout = await layoutGraph(
				graph.value,
				topologicallyRank(graph.value),
				layoutMeasurementsFor(document),
			);
			AssertRoutes(layout.relations).haveNoPhantomRelation();
		},
	);
});
