import { describe, expect, it } from 'vitest';

import {
	createProjectionLayoutCaches,
	layoutGraph,
	layoutGraphForProjection,
} from '../../../../src/app/web/projection/layout-graph';
import { applyLayoutPerformanceInsertion } from '../../../../src/app/workshop/fixtures/layout-performance/apply-layout-performance-insertion';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../../../../src/app/workshop/fixtures/layout-performance/scenarios';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

describe('projection-owned channel routing cache', () => {
	it.each([
		['wide-bipartite-layers', 60],
		['unbalanced-random', 40],
	] as const)(
		'keeps %s projection layouts equal to cold layouts through %i insertions',
		async (name, nodeCount) => {
			const builder = LAYOUT_PERFORMANCE_SCENARIOS.find(
				(scenario) => scenario.name === name,
			)?.createBuilder();
			if (builder === undefined) throw new Error(`Missing scenario ${name}`);
			const caches = createProjectionLayoutCaches();
			let document = builder.buildInitialDocument();
			for (const insertion of builder.buildInsertions(nodeCount)) {
				document = applyLayoutPerformanceInsertion(document, insertion);
				const { graph, ranks, measurements } = prepareLayoutDocument(document);
				const incremental = await layoutGraphForProjection(graph, ranks, measurements, caches);
				expect(incremental, `insertion ${insertion.nodeIndex}`).toStrictEqual(
					await layoutGraph(graph, ranks, measurements),
				);
			}
			expect(caches.channels.stats.hits).toBeGreaterThan(0);
		},
		60_000,
	);
});
