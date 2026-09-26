import { expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import type { LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import { satisfyMetricDemands } from '../../../../src/lib/core/layout/contract/metric-demand';
import {
	crossingIncidence,
	crossingMetricDemands,
} from '../../../../src/lib/core/layout/grid-cell-crossing';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grid-cell-layout';
import {
	localDocument,
	localMeasurements,
	normalize,
} from '../../../../src/lib/core/layout/grid-cell-model';
import {
	type GridCellInput,
	GridCellLayoutStatus,
} from '../../../../src/lib/core/layout/grid-cell-types';
import type { LayoutMeasurements } from '../../../../src/lib/core/layout/layout-types';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { gridDocument, gridInput, prepareGrid } from './grid-cell-fixture';

function selected(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: GridCellInput,
	cache: RegionLocalLayoutCache,
) {
	const incremental = solveGridCellLayout(graph, measurements, input, { cache });
	expect(incremental).toEqual(solveGridCellLayout(graph, measurements, input));
	if (incremental.status !== GridCellLayoutStatus.Selected)
		throw new Error(`Expected selected grid: ${incremental.status}: ${incremental.reason}`);
	return incremental;
}

it('reuses grouped grid leaves by effective measurements through edits and permutations', () => {
	const document = gridDocument();
	const input = gridInput();
	const prepared = prepareGrid(document);
	const nodes = new Map(prepared.measurements.nodes);
	nodes.set('a-bottom', { width: 220, height: 24 });
	const measurements = { ...prepared.measurements, nodes };
	const cache = new RegionLocalLayoutCache();
	const original = selected(prepared.graph, measurements, input, cache);
	expect(cache.stats).toEqual({ entries: 4, hits: 0, misses: 4, evictions: 0 });

	const permuted = prepareGrid({
		...document,
		nodes: [...document.nodes].reverse(),
		groups: [...document.groups].reverse(),
		relations: [...document.relations].reverse(),
	});
	const permutedInput = {
		...input,
		cells: [...input.cells].reverse(),
		cellByEndpointId: new Map([...input.cellByEndpointId].reverse()),
	};
	const permutedMeasurements = {
		...measurements,
		nodes: new Map([...measurements.nodes].reverse()),
		groups: new Map([...measurements.groups].reverse()),
	};
	expect(selected(permuted.graph, permutedMeasurements, permutedInput, cache)).toEqual(original);
	expect(cache.stats).toEqual({ entries: 4, hits: 4, misses: 4, evictions: 0 });

	const groups = new Map(measurements.groups);
	const originalGroup = defined(groups.get('oversized'));
	groups.set('oversized', { ...originalGroup, minimumWidth: originalGroup.minimumWidth + 180 });
	const widenedMeasurements = { ...measurements, groups };
	const widened = selected(prepared.graph, widenedMeasurements, input, cache);
	expect(cache.stats).toEqual({ entries: 5, hits: 7, misses: 5, evictions: 0 });
	expect(defined(widened.cells.find(({ id }) => id === 'b')).localLayout).not.toEqual(
		defined(original.cells.find(({ id }) => id === 'b')).localLayout,
	);
	expect(widened.layout).not.toEqual(original.layout);

	const withIncident = {
		...document,
		relations: [...document.relations, { id: 'second-crossing', from: 'a-bottom', to: 'c' }],
	};
	const incidentGraph = prepareGrid(withIncident).graph;
	const model = normalize(incidentGraph, input);
	if (typeof model === 'string') throw new Error(`Expected grid model: ${model}`);
	const incidence = crossingIncidence(model.crossing);
	const demands = crossingMetricDemands(incidence);
	expect(demands.map(({ endpointId, axis, minimum }) => [endpointId, axis, minimum])).toEqual([
		['a-bottom', 'height', 56],
		['c', 'height', 32],
		['d', 'height', 32],
	]);
	expect(demands.find(({ endpointId }) => endpointId === 'a-bottom')?.minimum).toBe(56);
	const aDocument = localDocument(incidentGraph, input, model, defined(model.cells[0]));
	expect(
		localMeasurements(
			aDocument,
			satisfyMetricDemands(widenedMeasurements, demands, incidentGraph.document.layout.direction),
		).nodes.get('a-bottom')?.height,
	).toBe(56);
	const withCrossing = selected(incidentGraph, widenedMeasurements, input, cache);
	expect(cache.stats).toEqual({ entries: 6, hits: 10, misses: 6, evictions: 0 });
	expect(
		defined(withCrossing.cells.find(({ id }) => id === 'a')).localLayout.elements.find(
			({ id }) => id === 'a-bottom',
		)?.bounds.height,
	).toBeGreaterThanOrEqual(56);
	expect(withCrossing.layout.relations.map(({ id }) => id)).toContain('second-crossing');

	expect(selected(prepared.graph, widenedMeasurements, input, cache)).toEqual(widened);
	expect(cache.stats).toEqual({ entries: 6, hits: 14, misses: 6, evictions: 0 });
});

it('reserves two direct group ports and keeps cached and cold grid results equal', () => {
	const base = gridDocument();
	const document = {
		...base,
		relations: [
			...base.relations,
			{ id: 'group-to-c', from: 'oversized', to: 'c' },
			{ id: 'group-to-d', from: 'oversized', to: 'd' },
		],
	};
	const input = gridInput();
	const prepared = prepareGrid(document);
	const originalGroupMetric = defined(prepared.measurements.groups.get('oversized'));
	const measurements = {
		...prepared.measurements,
		groups: new Map(prepared.measurements.groups).set('oversized', {
			...originalGroupMetric,
			minimumHeight: 20,
		}),
	};
	const model = normalize(prepared.graph, input);
	if (typeof model === 'string') throw new Error(`Expected group grid model: ${model}`);
	const demands = crossingMetricDemands(crossingIncidence(model.crossing));
	const demanded = satisfyMetricDemands(
		measurements,
		demands,
		prepared.graph.document.layout.direction,
	);
	const groupDemand = demands.find(({ endpointId }) => endpointId === 'oversized');
	expect(groupDemand?.minimum).toBe(56);
	expect(demanded.groups.get('oversized')?.minimumHeight).toBe(56);

	const cache = new RegionLocalLayoutCache();
	const original = selected(prepared.graph, measurements, input, cache);
	const group = defined(original.layout.elements.find(({ id }) => id === 'oversized'));
	const routes = new Map(original.layout.relations.map((route) => [route.id, route]));
	const firstPort = defined(routes.get('group-to-c')?.points[0]);
	const secondPort = defined(routes.get('group-to-d')?.points[0]);
	expect(Math.abs(firstPort.y - secondPort.y)).toBe(24);
	expect(firstPort.x).toBe(group.bounds.x + group.bounds.width);
	expect(secondPort.x).toBe(firstPort.x);
	expect(firstPort.y).toBeGreaterThan(group.bounds.y);
	expect(secondPort.y).toBeLessThan(group.bounds.y + group.bounds.height);
	expect(group.bounds.height).toBeGreaterThanOrEqual(56);
	expect(cache.stats).toMatchObject({ hits: 0, misses: 4 });

	const permuted = prepareGrid({
		...document,
		nodes: [...document.nodes].reverse(),
		groups: [...document.groups].reverse(),
		relations: [...document.relations].reverse(),
	});
	const permutedInput = {
		...input,
		cells: [...input.cells].reverse(),
		cellByEndpointId: new Map([...input.cellByEndpointId].reverse()),
	};
	const permutedMeasurements = {
		...measurements,
		nodes: new Map([...measurements.nodes].reverse()),
		groups: new Map([...measurements.groups].reverse()),
	};
	expect(selected(permuted.graph, permutedMeasurements, permutedInput, cache)).toEqual(original);
	expect(cache.stats).toMatchObject({ hits: 4, misses: 4 });

	const wider = {
		...measurements,
		groups: new Map(measurements.groups).set('oversized', {
			...originalGroupMetric,
			minimumHeight: group.bounds.height + 100,
		}),
	};
	const changed = selected(prepared.graph, wider, input, cache);
	expect(
		defined(changed.layout.elements.find(({ id }) => id === 'oversized')).bounds.height,
	).toBeGreaterThan(group.bounds.height);
	expect(cache.stats).toMatchObject({ hits: 7, misses: 5 });
});
