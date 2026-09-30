import { afterEach, expect, it, vi } from 'vitest';

import { DocumentProjection } from '../../../../src/app/web/projection/document-projection';
import { createProjectionLayoutCaches } from '../../../../src/app/web/projection/layout-graph';
import {
	LaneGrowth,
	LaneOrientation,
	LayoutPolicy,
	type LogicDocument,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_LANE_PRESENTATION_SCHEMA,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import {
	layoutWithRootRegion,
	layoutWithRootRegionForProjection,
} from '../../../../src/lib/core/layout/root-region';
import { ChannelRoutingCache } from '../../../../src/lib/core/layout/routing/channel-routing-cache';
import {
	depthTwoRegionDocument,
	persistedDepthTwoRegionDocument,
	persistedNestedGridDocument,
	regionDocument,
} from '../../../lib/core/layout/nested-region-fixture';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

afterEach(() => vi.restoreAllMocks());

function sourceWithRegions() {
	const source = regionDocument();
	const regionIdForNode = (id: string): string => {
		if (id.startsWith('a-')) return 'left';
		if (id === 'b') return 'middle';
		return 'right';
	};
	return {
		...source,
		persistenceFormat: REGION_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_PRESENTATION_SCHEMA,
			regions: [
				{ id: 'left', layoutOrder: orderKey('a0'), policy: LayoutPolicy.Layered },
				{ id: 'middle', layoutOrder: orderKey('a1'), policy: LayoutPolicy.Layered },
				{ id: 'right', layoutOrder: orderKey('a2'), policy: LayoutPolicy.Layered },
			],
		},
		nodes: source.nodes.map((node) => ({
			...node,
			regionId: regionIdForNode(node.id),
		})),
	};
}

function sourceWithRegionLanes(orientation: LaneOrientation, salesLabel = 'Sales'): LogicDocument {
	const source = sourceWithRegions();
	return {
		...source,
		persistenceFormat: REGION_LANE_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_LANE_PRESENTATION_SCHEMA,
			regions: source.regionPresentation.regions.map((region) => {
				if (region.id !== 'left') return region;
				return {
					...region,
					lanePresentation: {
						laneOrientation: orientation,
						growth: LaneGrowth.Auto,
						lanes: [
							{ id: 'sales', label: salesLabel, layoutOrder: orderKey('a0') },
							{ id: 'service', label: 'Service', layoutOrder: orderKey('a1') },
						],
					},
				};
			}),
		},
		nodes: source.nodes.map((node) => {
			if (node.id === 'a-source') return { ...node, laneId: 'sales' };
			if (node.id === 'a-target') return { ...node, laneId: 'service' };
			return node;
		}),
	};
}

it('invalidates an internal grid track edit and keeps cell-order permutations canonical', async () => {
	const source = persistedNestedGridDocument();
	const projection = new DocumentProjection(source);
	const measurements = layoutMeasurementsForCanvas(projection.measurementModel);
	const first = await projection.createCanvasModel(measurements);
	const grid = source.regionPresentation.regions.find(({ id }) => id === 'grid');
	if (grid?.grid === undefined) throw new Error('Missing internal grid');
	const gridPresentation = grid.grid;
	const changed: typeof source = {
		...source,
		regionPresentation: {
			...source.regionPresentation,
			regions: source.regionPresentation.regions.map((region) => {
				if (region.id !== 'grid') return region;
				return {
					...region,
					grid: { ...gridPresentation, minimumColumnWidths: [900, 100] as const },
				};
			}),
		},
	};
	expect(projection.update(changed)).toBe(true);
	const resized = await projection.createCanvasModel(measurements);
	expect(resized).toEqual(await new DocumentProjection(changed).createCanvasModel(measurements));
	expect(resized.regions?.find(({ id }) => id === 'grid')?.bounds.width).toBeGreaterThan(
		first.regions?.find(({ id }) => id === 'grid')?.bounds.width ?? 0,
	);
	const permuted: typeof source = {
		...changed,
		regionPresentation: {
			...changed.regionPresentation,
			regions: [...changed.regionPresentation.regions].reverse().map((region) => {
				if (region.grid === undefined) return region;
				return { ...region, grid: { ...region.grid, cells: [...region.grid.cells].reverse() } };
			}),
		},
	};
	expect(projection.update(permuted)).toBe(false);
	expect(await projection.createCanvasModel(measurements)).toEqual(resized);
});

it('invalidates only the lane leaf for orientation and refreshes its label after a cache hit', async () => {
	const source = sourceWithRegionLanes(LaneOrientation.Parallel);
	const projection = new DocumentProjection(source);
	const measured = layoutMeasurementsForCanvas(projection.measurementModel);
	const resolver = vi.spyOn(RegionLocalLayoutCache.prototype, 'getOrComputeContract');
	const first = await projection.createCanvasModel(measured);
	const cache = resolver.mock.contexts[0];
	if (!(cache instanceof RegionLocalLayoutCache)) throw new Error('Missing projection cache');
	expect(first.lanes?.map(({ id, regionId, label }) => [id, regionId, label])).toEqual([
		['sales', 'left', 'Sales'],
		['service', 'left', 'Service'],
	]);
	expect(cache.stats).toEqual(cacheStats(3, 0, 3));
	const relabeled = sourceWithRegionLanes(LaneOrientation.Parallel, 'Ventes');
	expect(projection.update(relabeled)).toBe(true);
	const withLabel = await projection.createCanvasModel(measured);
	expect(withLabel.lanes?.[0]?.label).toBe('Ventes');
	expect(cache.stats).toEqual(cacheStats(3, 3, 3));
	expect(withLabel).toEqual(await new DocumentProjection(relabeled).createCanvasModel(measured));
	const transverse = sourceWithRegionLanes(LaneOrientation.Transverse, 'Ventes');
	expect(projection.update(transverse)).toBe(true);
	const reoriented = await projection.createCanvasModel(measured);
	expect(cache.stats).toMatchObject({ entries: 4, misses: 4, evictions: 0 });
	expect(cache.stats.hits).toBeGreaterThanOrEqual(5);
	expect(reoriented).toEqual(await new DocumentProjection(transverse).createCanvasModel(measured));
	expect(reoriented.lanes?.[0]?.bounds).not.toEqual(withLabel.lanes?.[0]?.bounds);
});

it('keeps child cache state inside one DocumentProjection across source and measurement updates', async () => {
	const resolver = vi.spyOn(RegionLocalLayoutCache.prototype, 'getOrComputeContract');
	const source = sourceWithRegions();
	const projection = new DocumentProjection(source);
	const measurements = layoutMeasurementsForCanvas(projection.measurementModel);
	await projection.createCanvasModel(measurements);
	const cache = resolver.mock.contexts[0];
	if (!(cache instanceof RegionLocalLayoutCache)) throw new Error('Missing projection cache');
	const first = cache.stats;
	expect(first).toEqual({ entries: 3, hits: 0, misses: 3, evictions: 0 });

	const foreignRelationEdit = {
		...source,
		relations: source.relations.map((relation) => {
			if (relation.id === 'across-middle') return { ...relation, id: 'renamed-crossing' };
			return relation;
		}),
	};
	expect(projection.update(foreignRelationEdit)).toBe(true);
	const edited = await projection.createCanvasModel(measurements);
	// Both incident leaves change contract; the unrelated middle leaf is reused.
	expect(cache.stats).toEqual({ entries: 5, hits: 1, misses: 5, evictions: 0 });
	expect(edited).toEqual(
		await new DocumentProjection(foreignRelationEdit).createCanvasModel(measurements),
	);

	const resized = { ...measurements, nodes: new Map(measurements.nodes) };
	const originalSize = resized.nodes.get('a-target');
	if (originalSize === undefined) throw new Error('Missing A measurement');
	resized.nodes.set('a-target', { ...originalSize, width: originalSize.width + 40 });
	const incremental = await projection.createCanvasModel(resized);
	expect(cache.stats).toEqual({ entries: 6, hits: 3, misses: 6, evictions: 0 });
	expect(incremental).toEqual(
		await new DocumentProjection(foreignRelationEdit).createCanvasModel(resized),
	);
	const prepared = prepareLayoutDocument(foreignRelationEdit);
	expect(
		layoutWithRootRegionForProjection(prepared.graph, prepared.ranks, resized, {
			regions: cache,
			channels: new ChannelRoutingCache(),
		}),
	).toEqual(layoutWithRootRegion(prepared.graph, prepared.ranks, resized));
});

it('keeps nested-region incremental layouts equal to cold layouts through an edit sequence', async () => {
	const original = depthTwoRegionDocument();
	const source = persistedDepthTwoRegionDocument({
		...original,
		relations: original.relations.filter(({ id }) => id !== 'inside-branch'),
	});
	const projection = new DocumentProjection(source);
	const measurements = layoutMeasurementsForCanvas(projection.measurementModel);
	const localCaches = createProjectionLayoutCaches();
	const resolver = vi.spyOn(RegionLocalLayoutCache.prototype, 'getOrComputeContract');
	const check = async (
		document: typeof source,
		sizes: typeof measurements,
		stats: ReturnType<typeof cacheStats>,
	) => {
		const incrementalCanvas = await projection.createCanvasModel(sizes);
		const projectionCache = resolver.mock.contexts[0];
		if (!(projectionCache instanceof RegionLocalLayoutCache))
			throw new Error('Missing projection-owned nested-region cache');
		expect(projectionCache.stats).toEqual(stats);
		expect(incrementalCanvas).toEqual(
			await new DocumentProjection(document).createCanvasModel(sizes),
		);
		const prepared = prepareLayoutDocument(document);
		const incremental = layoutWithRootRegionForProjection(
			prepared.graph,
			prepared.ranks,
			sizes,
			localCaches,
		);
		expect(incremental).toEqual(layoutWithRootRegion(prepared.graph, prepared.ranks, sizes));
		return incremental;
	};

	await check(source, measurements, cacheStats(5, 0, 5));

	const foreign = {
		...source,
		relations: source.relations.map((relation) => {
			if (relation.id !== 'at-root') return relation;
			return { ...relation, id: 'renamed-foreign' };
		}),
	};
	expect(projection.update(foreign)).toBe(true);
	await check(foreign, measurements, cacheStats(7, 3, 7));

	const resized = { ...measurements, nodes: new Map(measurements.nodes) };
	const originalSize = resized.nodes.get('a-target');
	if (originalSize === undefined) throw new Error('Missing nested leaf measurement');
	resized.nodes.set('a-target', { ...originalSize, width: originalSize.width + 40 });
	await check(foreign, resized, cacheStats(8, 7, 8));

	const incident = {
		...foreign,
		relations: foreign.relations.map((relation) => {
			if (relation.id !== 'inside-a') return relation;
			return { ...relation, id: 'renamed-inside-a' };
		}),
	};
	expect(projection.update(incident)).toBe(true);
	const beforePermutation = await check(incident, resized, cacheStats(9, 11, 9));

	const permuted = {
		...incident,
		nodes: [...incident.nodes].reverse(),
		relations: [...incident.relations].reverse(),
		regionPresentation: {
			...incident.regionPresentation,
			regions: [...incident.regionPresentation.regions].reverse(),
		},
	};
	projection.update(permuted);
	const beforeCrossing = await check(permuted, resized, cacheStats(9, 11, 9));
	expect(beforeCrossing).toEqual(beforePermutation);

	const crossing = {
		...permuted,
		relations: permuted.relations.map((relation) => {
			if (relation.id !== 'renamed-foreign') return relation;
			return { id: 'grandchild-to-right', from: 'c', to: 'd' };
		}),
	};
	expect(projection.update(crossing)).toBe(true);
	const afterCrossing = await check(crossing, resized, cacheStats(12, 13, 12));
	expect(afterCrossing).not.toEqual(beforeCrossing);
	expect(afterCrossing.relations.map(({ id }) => id)).toContain('grandchild-to-right');
});

function cacheStats(entries: number, hits: number, misses: number) {
	return { entries, hits, misses, evictions: 0 };
}
