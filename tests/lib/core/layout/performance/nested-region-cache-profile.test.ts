import { performance } from 'node:perf_hooks';

import { expect, it } from 'vitest';

import { createGraph } from '../../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../../src/lib/core/graph/topological-ranks';
import { layoutWithDedicatedEngine } from '../../../../../src/lib/core/layout/layout-engine';
import { solveNestedRegionLayout } from '../../../../../src/lib/core/layout/nested-region-layout';
import { RegionCompositionStatus } from '../../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionLocalLayoutCache } from '../../../../../src/lib/core/layout/regions/model/region-local-cache';
import { prepareLayoutDocument } from '../../../../support/harnesses/layout';
import { median, percentile } from '../../../../support/performance/performance-statistics';
import { nestedRegionInput, regionDocument } from '../nested-region-fixture';

it('measures canonical key and defensive copy against cold child solves of one to four nodes', () => {
	const warmup = 20;
	const samples = 200;
	for (const nodeCount of [1, 2, 3, 4]) {
		const source = regionDocument();
		const nodes = source.nodes.slice(0, nodeCount);
		const memberIds = new Set(nodes.map(({ id }) => id));
		const document = {
			...source,
			nodes,
			relations: source.relations.filter(
				({ from, to }) => memberIds.has(from) && memberIds.has(to),
			),
		};
		const measurements = prepareLayoutDocument(document).measurements;
		const cache = new RegionLocalLayoutCache();
		let computes = 0;
		const compute = () => {
			computes += 1;
			const graph = createGraph(document);
			if (!graph.ok) throw new Error('Invalid local benchmark graph');
			const ranks = topologicallyRank(graph.value);
			return {
				layout: layoutWithDedicatedEngine(graph.value, ranks, measurements),
				ranks,
			};
		};
		cache.getOrCompute(document, measurements, undefined, compute);
		const hits: number[] = [];
		const cold: number[] = [];
		for (let index = 0; index < warmup + samples; index += 1) {
			const hitStart = performance.now();
			const cached = cache.getOrCompute(document, measurements, undefined, compute);
			const hitDuration = performance.now() - hitStart;
			const coldStart = performance.now();
			const fresh = compute();
			const coldDuration = performance.now() - coldStart;
			if (index >= warmup) {
				hits.push(hitDuration);
				cold.push(coldDuration);
			}
			expect(cached).toEqual(fresh);
		}
		expect(cache.stats).toMatchObject({ entries: 1, hits: warmup + samples, misses: 1 });
		expect(computes).toBe(warmup + samples + 1);
		process.stdout.write(
			`\nNested child ${nodeCount} nodes: ${samples} samples; key+copy hit p50=${median(hits).toFixed(3)}ms p95=${percentile(hits, 95).toFixed(3)}ms; cold graph+rank+layout p50=${median(cold).toFixed(3)}ms p95=${percentile(cold, 95).toFixed(3)}ms\n`,
		);
	}
});

it('profiles a root recomposition with three local cache hits against a cold solve', () => {
	const { graph, measurements } = prepareLayoutDocument(regionDocument());
	const regions = nestedRegionInput();
	const cache = new RegionLocalLayoutCache();
	const initial = solveNestedRegionLayout(graph, measurements, regions, { options: {}, cache });
	expect(initial.status).toBe(RegionCompositionStatus.Selected);
	const cached: number[] = [];
	const cold: number[] = [];
	const warmup = 20;
	const samples = 100;
	for (let index = 0; index < warmup + samples; index += 1) {
		const cachedStart = performance.now();
		const incremental = solveNestedRegionLayout(graph, measurements, regions, {
			options: {},
			cache,
		});
		const cachedDuration = performance.now() - cachedStart;
		const coldStart = performance.now();
		const fresh = solveNestedRegionLayout(graph, measurements, regions);
		const coldDuration = performance.now() - coldStart;
		if (index >= warmup) {
			cached.push(cachedDuration);
			cold.push(coldDuration);
		}
		expect(incremental).toEqual(fresh);
	}
	expect(cache.stats).toEqual({
		entries: 3,
		hits: 3 * (warmup + samples),
		misses: 3,
		evictions: 0,
	});
	process.stdout.write(
		`\nNested region cache: ${samples} root recompositions with three local hits; cached p50=${median(cached).toFixed(3)}ms p95=${percentile(cached, 95).toFixed(3)}ms; cold p50=${median(cold).toFixed(3)}ms p95=${percentile(cold, 95).toFixed(3)}ms\n`,
	);
});
