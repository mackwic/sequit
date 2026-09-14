import { bench, describe } from 'vitest';

import { layoutGraph } from '../../../../../src/app/web/projection/layout-graph';
import { LongQueueScenarioBuilder } from '../../../../../src/app/workshop/fixtures/layout-performance/builders/long-queue-scenario';
import { defined } from '../../../../../src/lib/core/document/logic-document';
import { prepareLayoutDocument } from '../../../../support/harnesses/layout';
import { LAYOUT_PERFORMANCE_BENCHMARK_OPTIONS } from '../../../../support/performance/layout-performance-policy';

const cases = [100, 1000].map((nodeCount) => {
	const { document } = new LongQueueScenarioBuilder().buildSnapshot(nodeCount);
	const prepared = prepareLayoutDocument({
		...document,
		relations: [
			...document.relations,
			{
				id: 'long-relation',
				from: defined(document.nodes.at(-1)).id,
				to: defined(document.nodes[0]).id,
			},
		],
	});
	return { nodeCount, prepared };
});

describe('layoutGraph ordinary long relations', () => {
	for (const { nodeCount, prepared } of cases) {
		bench(
			`long-queue-with-skip/nodes=${nodeCount}`,
			async () => {
				await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
			},
			LAYOUT_PERFORMANCE_BENCHMARK_OPTIONS,
		);
	}
});
