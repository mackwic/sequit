import { performance } from 'node:perf_hooks';

import { expect, it } from 'vitest';

import { defined } from '../../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../../src/lib/core/graph/topological-ranks';
import { satisfyMetricDemands } from '../../../../../src/lib/core/layout/contract/metric-demand';
import {
	crossingIncidence,
	crossingMetricDemands,
} from '../../../../../src/lib/core/layout/grid-cell-crossing';
import { solveGridCellLayout } from '../../../../../src/lib/core/layout/grid-cell-layout';
import {
	localDocument,
	localMeasurements,
	normalize,
} from '../../../../../src/lib/core/layout/grid-cell-model';
import { GridCellLayoutStatus } from '../../../../../src/lib/core/layout/grid-cell-types';
import { layoutWithDedicatedEngine } from '../../../../../src/lib/core/layout/layout-engine';
import type { LayoutMeasurements } from '../../../../../src/lib/core/layout/layout-types';
import {
	RegionLocalLayoutCache,
	regionLocalLayoutKey,
} from '../../../../../src/lib/core/layout/regions/model/region-local-cache';
import { median, percentile } from '../../../../support/performance/performance-statistics';
import { gridInput, prepareGrid } from '../grid-cell-fixture';

function summary(values: readonly number[]): string {
	return `p50=${median(values).toFixed(3)}ms p95=${percentile(values, 95).toFixed(3)}ms`;
}

function withGroupWidth(
	measurements: LayoutMeasurements,
	minimumWidth: number,
): LayoutMeasurements {
	const groups = new Map(measurements.groups);
	groups.set('oversized', { ...defined(groups.get('oversized')), minimumWidth });
	return { ...measurements, groups };
}

it('profiles grouped leaf construction, fingerprint, hit and cold solve', () => {
	const { graph, measurements } = prepareGrid();
	const input = gridInput();
	const model = normalize(graph, input);
	if (typeof model === 'string') throw new Error(`Invalid grid profile model: ${model}`);
	const cell = defined(model.cells.find(({ id }) => id === 'b'));
	const demands = crossingMetricDemands(crossingIncidence(model.crossing));
	const demandedMeasurements = satisfyMetricDemands(
		measurements,
		demands,
		graph.document.layout.direction,
	);
	const document = localDocument(graph, input, model, cell);
	const sizes = localMeasurements(document, demandedMeasurements);
	const key = regionLocalLayoutKey(document, sizes);
	let computes = 0;
	const compute = () => {
		computes += 1;
		const localGraph = createGraph(document);
		if (!localGraph.ok) throw new Error('Invalid grouped leaf graph');
		const ranks = topologicallyRank(localGraph.value);
		return { layout: layoutWithDedicatedEngine(localGraph.value, ranks, sizes), ranks };
	};
	const cache = new RegionLocalLayoutCache();
	cache.getOrCompute(document, sizes, undefined, compute);
	const construction: number[] = [];
	const fingerprint: number[] = [];
	const hits: number[] = [];
	const cold: number[] = [];
	const warmup = 20;
	const samples = 200;
	for (let index = 0; index < warmup + samples; index += 1) {
		const buildStart = performance.now();
		const constructed = localDocument(graph, input, model, cell);
		const constructedSizes = localMeasurements(constructed, demandedMeasurements);
		const buildDuration = performance.now() - buildStart;
		const fingerprintStart = performance.now();
		const constructedKey = regionLocalLayoutKey(constructed, constructedSizes);
		const fingerprintDuration = performance.now() - fingerprintStart;
		const hitStart = performance.now();
		const cached = cache.getOrCompute(constructed, constructedSizes, undefined, compute);
		const hitDuration = performance.now() - hitStart;
		const coldStart = performance.now();
		const fresh = compute();
		const coldDuration = performance.now() - coldStart;
		if (index >= warmup) {
			construction.push(buildDuration);
			fingerprint.push(fingerprintDuration);
			hits.push(hitDuration);
			cold.push(coldDuration);
		}
		expect(constructedKey).toBe(key);
		expect(cached).toEqual(fresh);
	}
	expect(cache.stats).toEqual({ entries: 1, hits: warmup + samples, misses: 1, evictions: 0 });
	expect(computes).toBe(warmup + samples + 1);
	process.stdout.write(
		`\nGrid grouped leaf b: ${samples} samples; local document+measurements ${summary(construction)}; fingerprint ${summary(fingerprint)}; key+copy hit ${summary(hits)}; cold graph+rank+layout ${summary(cold)}\n`,
	);
});

it('profiles root recomposition through distinct local group measurement edits', () => {
	const { graph, measurements } = prepareGrid();
	const input = gridInput();
	const cache = new RegionLocalLayoutCache();
	const initial = solveGridCellLayout(graph, measurements, input, { cache });
	expect(initial.status).toBe(GridCellLayoutStatus.Selected);
	const cached: number[] = [];
	const cold: number[] = [];
	const warmup = 20;
	const samples = 100;
	for (let index = 0; index < warmup + samples; index += 1) {
		const edited = withGroupWidth(measurements, 621 + index);
		const cachedStart = performance.now();
		const incremental = solveGridCellLayout(graph, edited, input, { cache });
		const cachedDuration = performance.now() - cachedStart;
		const coldStart = performance.now();
		const fresh = solveGridCellLayout(graph, edited, input);
		const coldDuration = performance.now() - coldStart;
		if (index >= warmup) {
			cached.push(cachedDuration);
			cold.push(coldDuration);
		}
		expect(incremental.status).toBe(GridCellLayoutStatus.Selected);
		expect(incremental).toEqual(fresh);
	}
	expect(cache.stats).toEqual({
		entries: 12,
		hits: 3 * (warmup + samples),
		misses: 4 + warmup + samples,
		evictions: 4 + warmup + samples - 12,
	});
	let memory = 'retained heap unavailable (GC not exposed)';
	if (typeof global.gc === 'function') {
		const held: RegionLocalLayoutCache[] = [];
		global.gc();
		const before = process.memoryUsage().heapUsed;
		for (let cacheIndex = 0; cacheIndex < 20; cacheIndex += 1) {
			const retained = new RegionLocalLayoutCache();
			for (let variant = 0; variant < 12; variant += 1) {
				const edited = withGroupWidth(measurements, 1000 + cacheIndex * 12 + variant);
				const result = solveGridCellLayout(graph, edited, input, { cache: retained });
				expect(result.status).toBe(GridCellLayoutStatus.Selected);
			}
			expect(retained.stats.entries).toBe(12);
			held.push(retained);
		}
		global.gc();
		const delta = process.memoryUsage().heapUsed - before;
		memory = `approximate post-GC heap delta=${(delta / 1024).toFixed(1)}KiB for ${held.length} held caches of 12 entries (${(delta / held.length / 1024).toFixed(1)}KiB/cache)`;
	}
	process.stdout.write(
		`\nGrid cache local edits: ${samples} unique group-width edits after ${warmup} warmups; 3 child hits + 1 child miss per edit, ${cache.stats.entries} retained entries; cached root ${summary(cached)}; cold root ${summary(cold)}; ${memory}\n`,
	);
});
