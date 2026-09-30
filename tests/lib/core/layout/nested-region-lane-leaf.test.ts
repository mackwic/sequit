import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	JunctionOperator,
	LaneGrowth,
	LaneOrientation,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LayoutRegionDefinition,
	type LogicDocument,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_LANE_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import type { Bounds, LayoutMeasurements } from '../../../../src/lib/core/layout/layout-types';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import {
	layoutWithRootRegionForProjection,
	UnsupportedRegionLayoutError,
} from '../../../../src/lib/core/layout/root-region';
import { ChannelRoutingCache } from '../../../../src/lib/core/layout/routing/channel-routing-cache';

const measurements: LayoutMeasurements = {
	nodes: new Map([
		['request', { width: 132, height: 64 }],
		['delivery', { width: 145, height: 68 }],
		['neighbor', { width: 120, height: 72 }],
		['other-request', { width: 124, height: 64 }],
		['other-delivery', { width: 137, height: 68 }],
	]),
	groups: new Map(),
	junctions: new Map(),
};

function fixture(orientation: LaneOrientation, duplicate = false): LogicDocument {
	const nodes: (readonly [string, string, string | undefined])[] = [
		['request', 'shared', 'sales'],
		['delivery', 'shared', 'service'],
		['neighbor', 'ordinary', undefined],
	];
	if (duplicate) {
		nodes.push(['other-request', 'other-shared', 'sales']);
		nodes.push(['other-delivery', 'other-shared', 'service']);
	}
	const lanes = [
		{ id: 'sales', label: 'Vente', layoutOrder: orderKey('a0') },
		{ id: 'service', label: 'Service', layoutOrder: orderKey('a1') },
	];
	const relations = [{ id: 'handoff', from: 'request', to: 'delivery' }];
	if (duplicate)
		relations.push({ id: 'other-handoff', from: 'other-request', to: 'other-delivery' });
	const regions: LayoutRegionDefinition[] = [
		{
			id: 'shared',
			layoutOrder: orderKey('a0'),
			policy: LayoutPolicy.SharedLanes,
			lanePresentation: { laneOrientation: orientation, growth: LaneGrowth.Auto, lanes },
		},
		{ id: 'ordinary', layoutOrder: orderKey('a1'), policy: LayoutPolicy.Layered },
	];
	if (duplicate)
		regions.push({
			id: 'other-shared',
			layoutOrder: orderKey('a2'),
			policy: LayoutPolicy.SharedLanes,
			lanePresentation: { laneOrientation: orientation, growth: LaneGrowth.Auto, lanes },
		});
	return {
		persistenceFormat: REGION_LANE_PERSISTENCE_FORMAT,
		id: 'region-lane-leaf',
		title: 'Region lane leaf',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [],
		junctions: [],
		nodes: nodes.map(([id, regionId, laneId], index) => {
			const laneField: { laneId?: string } = {};
			if (laneId !== undefined) laneField.laneId = laneId;
			return {
				kind: EndpointKind.Node,
				id,
				natureId: 'task',
				markdown: `${id}\n`,
				regionId,
				...laneField,
				layoutOrder: orderKey(`a${index}`),
			};
		}),
		relations,
		regionPresentation: {
			schemaVersion: REGION_LANE_PRESENTATION_SCHEMA,
			regions,
		},
	};
}

function solve(
	document: LogicDocument,
	cache = new RegionLocalLayoutCache(),
	sizes: LayoutMeasurements = measurements,
) {
	const graph = createGraph(document);
	if (!graph.ok) throw new Error(graph.diagnostics.map(({ message }) => message).join('; '));
	return layoutWithRootRegionForProjection(graph.value, topologicallyRank(graph.value), sizes, {
		regions: cache,
		channels: new ChannelRoutingCache(),
	});
}

function contains(outer: Bounds, inner: Bounds): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

describe('persisted lanes in a region leaf', () => {
	it('reports an unsupported grouped member in a shared lane leaf', () => {
		const source = fixture(LaneOrientation.Parallel);
		const document: LogicDocument = {
			...source,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'shared-group',
					label: 'Shared group',
					regionId: 'shared',
					laneId: 'sales',
					layoutOrder: orderKey('a4'),
				},
			],
			nodes: source.nodes.map((node) => {
				if (node.id !== 'request') return node;
				const member = { ...node, groupId: 'shared-group' };
				delete member.regionId;
				delete member.laneId;
				return member;
			}),
		};
		expect(() => solve(document)).toThrow(UnsupportedRegionLayoutError);
	});

	it('reports a junction in a shared lane leaf as unsupported', () => {
		const source = fixture(LaneOrientation.Parallel);
		const document: LogicDocument = {
			...source,
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'gate',
					operator: JunctionOperator.Xor,
					regionId: 'shared',
					laneId: 'sales',
					layoutOrder: orderKey('a4'),
				},
			],
		};
		expect(() => solve(document)).toThrow(UnsupportedRegionLayoutError);
	});

	it.each([LaneOrientation.Parallel, LaneOrientation.Transverse])(
		'composes %s lane frames with the ordinary sibling and reuses a cold local solve',
		(orientation) => {
			const document = fixture(orientation);
			const cache = new RegionLocalLayoutCache();
			const first = solve(document, cache);
			const cold = solve(document);
			expect(first).toEqual(cold);
			expect(first.regions).toHaveLength(2);
			expect(first.lanes).toHaveLength(2);
			const shared = defined(first.regions?.find(({ id }) => id === 'shared'));
			const ordinary = defined(first.regions?.find(({ id }) => id === 'ordinary'));
			for (const lane of first.lanes ?? []) {
				expect(lane.regionId).toBe('shared');
				expect(contains(shared.bounds, lane.bounds)).toBe(true);
				expect(contains(ordinary.bounds, lane.bounds)).toBe(false);
			}
			expect(first.lanes?.map(({ label }) => label)).toEqual(['Vente', 'Service']);
			const sharedIds = new Set(['request', 'delivery']);
			for (const element of first.elements.filter(({ id }) => sharedIds.has(id)))
				expect(contains(shared.bounds, element.bounds)).toBe(true);
			expect(first.relations.map(({ id }) => id)).toEqual(['handoff']);
			const stats = cache.stats;
			expect(solve(document, cache)).toEqual(first);
			expect(cache.stats.misses).toBe(stats.misses);
			expect(cache.stats.hits).toBe(stats.hits + 2);
		},
	);

	it('scopes repeated lane ids to their leaf and refreshes a label after a cache hit', () => {
		const document = fixture(LaneOrientation.Parallel, true);
		const cache = new RegionLocalLayoutCache();
		const first = solve(document, cache);
		expect(first.lanes).toHaveLength(4);
		expect(first.lanes?.map(({ regionId, id }) => [regionId, id])).toEqual([
			['shared', 'sales'],
			['shared', 'service'],
			['other-shared', 'sales'],
			['other-shared', 'service'],
		]);
		const presentation = defined(document.regionPresentation);
		const edited = {
			...document,
			regionPresentation: {
				...presentation,
				regions: presentation.regions.map((region) => {
					if (region.id !== 'shared' || region.lanePresentation === undefined) return region;
					return {
						...region,
						lanePresentation: {
							...region.lanePresentation,
							lanes: region.lanePresentation.lanes.map((lane) => {
								if (lane.id !== 'sales') return lane;
								return { ...lane, label: 'Ventes' };
							}),
						},
					};
				}),
			},
		};
		const before = cache.stats;
		const next = solve(edited, cache);
		expect(next.lanes?.[0]?.label).toBe('Ventes');
		expect(next.lanes?.[2]?.label).toBe('Vente');
		expect(cache.stats.misses).toBe(before.misses);
		expect(cache.stats.hits).toBe(before.hits + 3);
		expect(next).toEqual(solve(edited));
	});

	it('recomputes only the changed lane leaf and reuses foreign leaves', () => {
		const source = fixture(LaneOrientation.Parallel, true);
		const cache = new RegionLocalLayoutCache();
		const first = solve(source, cache);
		const newNode = {
			kind: EndpointKind.Node,
			id: 'follow-up',
			natureId: 'task',
			regionId: 'shared',
			laneId: 'service',
			markdown: 'Follow up',
			layoutOrder: orderKey('a9'),
		} as const;
		const updated = {
			...source,
			nodes: [...source.nodes, newNode],
			relations: [
				...source.relations,
				{ id: 'handoff-follow-up', from: 'delivery', to: 'follow-up' },
			],
		};
		const sizes: LayoutMeasurements = {
			...measurements,
			nodes: new Map([...measurements.nodes, ['follow-up', { width: 112, height: 64 }]]),
		};
		const before = cache.stats;
		const incremental = solve(updated, cache, sizes);
		expect(incremental).toEqual(solve(updated, new RegionLocalLayoutCache(), sizes));
		expect(incremental.elements.map(({ id }) => id)).toContain('follow-up');
		expect(first.elements.map(({ id }) => id)).not.toContain('follow-up');
		expect(cache.stats.misses - before.misses).toBe(1);
		expect(cache.stats.hits - before.hits).toBe(2);

		const beforeContract = cache.stats;
		const contracted = {
			...updated,
			relations: [
				...updated.relations,
				{ id: 'follow-up-cross', from: 'follow-up', to: 'neighbor' },
			],
		};
		const withContract = solve(contracted, cache, sizes);
		expect(withContract).toEqual(solve(contracted, new RegionLocalLayoutCache(), sizes));
		expect(withContract.relations.map(({ id }) => id)).toContain('follow-up-cross');
		expect(cache.stats.misses - beforeContract.misses).toBe(2);
		expect(cache.stats.hits - beforeContract.hits).toBe(1);
	});

	it.each([LaneOrientation.Parallel, LaneOrientation.Transverse])(
		'keeps a %s leaf incident local before crossing to an ordinary sibling',
		(orientation) => {
			const source = fixture(orientation);
			const document = {
				...source,
				relations: [...source.relations, { id: 'cross', from: 'delivery', to: 'neighbor' }],
			};
			const result = solve(document);
			expect(result.relations.map(({ id }) => id)).toEqual(['cross', 'handoff']);
			expect(result.lanes).toHaveLength(2);
			const shared = defined(result.regions?.find(({ id }) => id === 'shared'));
			const ordinary = defined(result.regions?.find(({ id }) => id === 'ordinary'));
			expect(shared.bounds.x + shared.bounds.width).toBeLessThanOrEqual(ordinary.bounds.x);
		},
	);

	it('matches a cold solve through fractional resizes, orientations and collection permutations', () => {
		const cache = new RegionLocalLayoutCache();
		fc.assert(
			fc.property(
				fc.integer({ min: 80, max: 200 }),
				fc.integer({ min: 80, max: 200 }),
				fc.boolean(),
				fc.boolean(),
				(requestWidth, neighborWidth, transverse, permute) => {
					let orientation = LaneOrientation.Parallel;
					if (transverse) orientation = LaneOrientation.Transverse;
					const source = fixture(orientation, true);
					let document = source;
					if (permute) {
						const presentation = defined(source.regionPresentation);
						document = {
							...source,
							nodes: [...source.nodes].reverse(),
							relations: [...source.relations].reverse(),
							regionPresentation: {
								...presentation,
								regions: [...presentation.regions].reverse(),
							},
						};
					}
					const nodeSizes = new Map(measurements.nodes);
					nodeSizes.set('request', { width: requestWidth + 0.25, height: 64.5 });
					nodeSizes.set('neighbor', { width: neighborWidth + 0.5, height: 72.25 });
					const sizes: LayoutMeasurements = { ...measurements, nodes: nodeSizes };
					const incremental = solve(document, cache, sizes);
					const cold = solve(document, new RegionLocalLayoutCache(), sizes);
					expect(incremental).toEqual(cold);
					expect(incremental.lanes).toHaveLength(4);
					for (const lane of incremental.lanes ?? []) {
						const owner = defined(incremental.regions?.find(({ id }) => id === lane.regionId));
						expect(contains(owner.bounds, lane.bounds)).toBe(true);
					}
				},
			),
			{ numRuns: 200 },
		);
	});
});
