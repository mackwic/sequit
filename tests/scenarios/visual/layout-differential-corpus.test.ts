import assert from 'node:assert/strict';

import { describe, expect, it, vi } from 'vitest';

import type * as LayoutGraphModule from '../../../src/app/web/projection/layout-graph';
import { LAYOUT_DIRECTIONS } from '../../../src/lib/core/document/logic-document';
import { executableScenarios } from './catalogue';

const differentialCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../../src/app/web/projection/layout-graph', async (importOriginal) => {
	const actual = await importOriginal<typeof LayoutGraphModule>();
	const { createGraph } = await import('../../../src/lib/core/graph/create-graph');
	const { topologicallyRank } = await import('../../../src/lib/core/graph/topological-ranks');
	const { layoutWithDedicatedEngine } = await import('../../../src/lib/core/layout/layout-engine');

	const layoutGraph: typeof actual.layoutGraph = async (graph, ranks, measurements, options) => {
		const baselineGraph = createGraph(structuredClone(graph.document));
		if (!baselineGraph.ok) throw new Error('The corpus document is graph-invalid');
		const baselineRanks = topologicallyRank(baselineGraph.value);
		assert.deepStrictEqual(baselineRanks, ranks, 'The corpus must use reproducible ranks');
		const baseline = layoutWithDedicatedEngine(
			baselineGraph.value,
			baselineRanks,
			structuredClone(measurements),
			structuredClone(options),
		);
		const candidate = await actual.layoutGraph(graph, ranks, measurements, options);
		assert.deepStrictEqual(
			candidate,
			baseline,
			`Differential layout mismatch: ${graph.document.id}`,
		);
		differentialCalls.count += 1;
		return candidate;
	};
	return { ...actual, layoutGraph };
});

describe.each(executableScenarios)('$id layout differential corpus', (scenario) => {
	it.each(LAYOUT_DIRECTIONS)('preserves the full result in %s', async (direction) => {
		const before = differentialCalls.count;
		const layout = await scenario.arrange(direction);
		scenario.assert(layout);
		expect(differentialCalls.count).toBeGreaterThan(before);
	});
});
