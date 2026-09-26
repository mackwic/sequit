import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	GroupState,
	JunctionOperator,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { solveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-layout';
import { solveRegionLeafLayout } from '../../../../src/lib/core/layout/region-leaf-layout';
import {
	RegionCompositionStatus,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	RegionIncidentRejectionCode,
	RegionIncidentRole,
} from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import {
	MAX_REGION_LOCAL_CACHE_ENTRIES,
	RegionLocalLayoutCache,
	regionLocalLayoutKey,
} from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { nestedRegionInput, regionDocument } from './nested-region-fixture';

function selected(
	cache: RegionLocalLayoutCache,
	document = regionDocument(),
	resize?: {
		readonly id: string;
		readonly width: number;
		readonly height: number;
	},
) {
	const prepared = prepareLayoutDocument(document);
	const measurements = {
		...prepared.measurements,
		nodes: new Map(prepared.measurements.nodes),
	};
	if (resize !== undefined)
		measurements.nodes.set(resize.id, {
			width: resize.width,
			height: resize.height,
		});
	const result = solveNestedRegionLayout(prepared.graph, measurements, nestedRegionInput(), {
		options: {},
		cache,
	});
	expect(result.status).toBe(RegionCompositionStatus.Selected);
	if (result.status !== RegionCompositionStatus.Selected)
		throw new Error(`Expected selected nested layout: ${result.reason}`);
	const cold = solveNestedRegionLayout(prepared.graph, measurements, nestedRegionInput());
	expect(result).toEqual(cold);
	return result;
}

describe('per-projection local region layout cache', () => {
	it('does not recompute B for a foreign relation edit and recomposes the root for a local size edit', () => {
		const cache = new RegionLocalLayoutCache();
		const original = selected(cache);
		expect(cache.stats).toEqual({
			entries: 3,
			hits: 0,
			misses: 3,
			evictions: 0,
		});

		const source = regionDocument();
		const foreignRelationEdit = {
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id === 'across-middle') return { ...relation, id: 'foreign-relation-edited' };
				return relation;
			}),
		};
		const edited = selected(cache, foreignRelationEdit);
		expect(cache.stats).toEqual({
			entries: 5,
			hits: 1,
			misses: 5,
			evictions: 0,
		});
		expect(edited.regions.find(({ id }) => id === 'middle')?.localLayout).toEqual(
			original.regions.find(({ id }) => id === 'middle')?.localLayout,
		);
		expect(edited.layout.relations.map(({ id }) => id)).toContain('foreign-relation-edited');

		const originalWidth = prepareLayoutDocument(source).measurements.nodes.get('a-target')?.width;
		if (originalWidth === undefined) throw new Error('Missing A measurement');
		const resized = selected(cache, foreignRelationEdit, {
			id: 'a-target',
			width: originalWidth + 40,
			height: 80,
		});
		expect(cache.stats).toEqual({
			entries: 6,
			hits: 3,
			misses: 6,
			evictions: 0,
		});
		expect(resized.regions.find(({ id }) => id === 'middle')?.localLayout).toEqual(
			edited.regions.find(({ id }) => id === 'middle')?.localLayout,
		);
		expect(resized.layout).not.toEqual(edited.layout);
		expect(resized.regions.find(({ id }) => id === 'middle')?.bounds.x).not.toBe(
			edited.regions.find(({ id }) => id === 'middle')?.bounds.x,
		);
	});

	it('uses a canonical source and measurement key across permutations', () => {
		const cache = new RegionLocalLayoutCache();
		const source = regionDocument();
		const original = selected(cache, source);
		const permuted = {
			...source,
			nodes: [...source.nodes].reverse(),
			relations: [...source.relations].reverse(),
		};
		const repeated = selected(cache, permuted);
		expect(cache.stats).toEqual({
			entries: 3,
			hits: 3,
			misses: 3,
			evictions: 0,
		});
		expect(repeated).toEqual(original);

		const local = {
			...source,
			nodes: source.nodes.slice(0, 2),
			relations: source.relations.slice(0, 1),
		};
		const measurements = prepareLayoutDocument(source).measurements;
		expect(regionLocalLayoutKey(local, measurements)).toBe(
			regionLocalLayoutKey(
				{ ...local, nodes: [...local.nodes].reverse() },
				{ ...measurements, nodes: new Map([...measurements.nodes].reverse()) },
			),
		);
		expect(regionLocalLayoutKey(local, measurements)).not.toBe(
			regionLocalLayoutKey(local, { ...measurements, nodes: new Map() }),
		);
	});

	it('keys the complete incident contract for every leaf and preserves search evidence on a hit', () => {
		const source = regionDocument();
		const local = {
			...source,
			nodes: source.nodes.slice(0, 2),
			relations: source.relations.slice(0, 1),
		};
		const measurements = prepareLayoutDocument(local).measurements;
		const outgoing = {
			relation: { id: 'crossing-a', from: 'a-target', to: 'foreign' },
			endpointId: 'a-target',
			role: RegionIncidentRole.Source,
			allowedSides: [RegionPortalSide.Bottom, RegionPortalSide.Right],
		};
		const incoming = {
			relation: { id: 'crossing-b', from: 'foreign', to: 'a-source' },
			endpointId: 'a-source',
			role: RegionIncidentRole.Target,
			allowedSides: [RegionPortalSide.Left, RegionPortalSide.Top],
		};
		const contracts = [outgoing, incoming];
		const base = regionLocalLayoutKey(local, measurements);
		expect(base).toBe(regionLocalLayoutKey(local, measurements, undefined, []));
		const key = regionLocalLayoutKey(local, measurements, undefined, contracts);
		expect(key).toBe(
			regionLocalLayoutKey(local, measurements, undefined, [...contracts].reverse()),
		);
		expect(key).not.toBe(base);
		expect(key).not.toBe(
			regionLocalLayoutKey(local, measurements, undefined, [
				{ ...outgoing, allowedSides: [...outgoing.allowedSides].reverse() },
				incoming,
			]),
		);
		expect(key).not.toBe(
			regionLocalLayoutKey(local, measurements, undefined, [
				{ ...outgoing, relation: { ...outgoing.relation, to: 'another' } },
				incoming,
			]),
		);
		const selfRelation = { id: 'self', from: 'a-target', to: 'a-target' };
		expect(
			regionLocalLayoutKey(local, measurements, undefined, [
				{ ...outgoing, relation: selfRelation },
			]),
		).not.toBe(
			regionLocalLayoutKey(local, measurements, undefined, [
				{ ...outgoing, relation: selfRelation, role: RegionIncidentRole.Target },
			]),
		);
		const cache = new RegionLocalLayoutCache();
		let calculations = 0;
		const calculate = () => {
			calculations += 1;
			return {
				...solveRegionLeafLayout({
					document: local,
					measurements,
					leafPolicy: LayoutPolicy.Layered,
				}),
				incidents: [
					{
						relationId: outgoing.relation.id,
						endpointId: outgoing.endpointId,
						role: outgoing.role,
						side: RegionPortalSide.Bottom,
						anchor: { x: 1, y: 2 },
						portal: { x: 1, y: 10 },
						points: [
							{ x: 1, y: 2 },
							{ x: 1, y: 10 },
						],
					},
				],
				witness: {
					attempted: 2,
					exhaustive: true,
					rejectedAlternatives: [
						{
							relationId: outgoing.relation.id,
							endpointId: outgoing.endpointId,
							role: outgoing.role,
							side: RegionPortalSide.Right,
							code: RegionIncidentRejectionCode.RouteObstructed,
						},
					],
				},
			};
		};
		const first = cache.getOrComputeContract({
			document: local,
			measurements,
			contracts,
			compute: calculate,
		});
		Object.assign(first.incidents?.[0]?.anchor ?? {}, { x: -100 });
		Object.assign(first.incidents?.[0]?.portal ?? {}, { y: -100 });
		Object.assign(first.incidents?.[0]?.points[0] ?? {}, { x: -100 });
		Object.assign(first.witness?.rejectedAlternatives[0] ?? {}, {
			reason: 'changed',
		});
		const hit = cache.getOrComputeContract({
			document: local,
			measurements,
			contracts: [...contracts].reverse(),
			compute: calculate,
		});
		expect(calculations).toBe(1);
		expect(hit.incidents?.[0]?.anchor.x).toBe(1);
		expect(hit.incidents?.[0]?.portal.y).toBe(10);
		expect(hit.incidents?.[0]?.points[0]?.x).toBe(1);
		expect(hit.witness?.rejectedAlternatives[0]?.reason).toBeUndefined();
	});

	it('retains at most twelve bounded child results and keeps callers from mutating entries', () => {
		const cache = new RegionLocalLayoutCache();
		const first = selected(cache);
		const firstPoint = first.regions[0]?.localLayout.elements[0]?.bounds;
		if (firstPoint === undefined) throw new Error('Missing cached bounds');
		(firstPoint as { x: number }).x = -1000;
		const repeated = selected(cache);
		expect(repeated.regions[0]?.localLayout.elements[0]?.bounds.x).not.toBe(-1000);

		for (let index = 0; index < MAX_REGION_LOCAL_CACHE_ENTRIES + 2; index += 1) {
			selected(cache, regionDocument(), {
				id: 'a-target',
				width: 160 + index,
				height: 80,
			});
			expect(cache.stats.entries).toBeLessThanOrEqual(MAX_REGION_LOCAL_CACHE_ENTRIES);
		}
		expect(cache.stats.evictions).toBeGreaterThan(0);
	});

	it('does not retain failed local calculations', () => {
		const cache = new RegionLocalLayoutCache();
		const source = regionDocument();
		const measurements = prepareLayoutDocument(source).measurements;
		expect(() =>
			cache.getOrCompute(source, measurements, undefined, () => {
				throw new Error('failed local solve');
			}),
		).toThrow('failed local solve');
		expect(cache.stats).toEqual({
			entries: 0,
			hits: 0,
			misses: 1,
			evictions: 0,
		});
	});

	it('keys group and junction structure and measurements canonically', () => {
		const source = regionDocument();
		const document: LogicDocument = {
			...source,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'parent',
					label: 'Parent',
					layoutOrder: orderKey('a6'),
				},
				{
					kind: EndpointKind.Group,
					id: 'child',
					label: 'Child',
					state: GroupState.Expanded,
					groupId: 'parent',
					laneId: 'lane',
					regionId: 'region',
					layoutOrder: orderKey('a7'),
				},
			],
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'unmeasured',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a8'),
				},
				{
					kind: EndpointKind.Junction,
					id: 'measured',
					operator: JunctionOperator.Xor,
					groupId: 'child',
					laneId: 'lane',
					regionId: 'region',
					layoutOrder: orderKey('a9'),
				},
			],
		};
		const base = prepareLayoutDocument(source).measurements;
		const measurements = {
			...base,
			groups: new Map([
				[
					'child',
					{
						minimumWidth: 140,
						minimumHeight: 80,
						headerHeight: 24,
						padding: 12,
					},
				],
			]),
			junctions: new Map([['measured', { width: 24, height: 24 }]]),
		};
		const key = regionLocalLayoutKey(document, measurements, LayoutPolicy.Layered);
		expect(
			regionLocalLayoutKey(
				{
					...document,
					nodes: [...document.nodes].reverse(),
					groups: [...document.groups].reverse(),
					junctions: [...document.junctions].reverse(),
					relations: [...document.relations].reverse(),
				},
				{
					...measurements,
					nodes: new Map([...measurements.nodes].reverse()),
					groups: new Map([...measurements.groups].reverse()),
					junctions: new Map([...measurements.junctions].reverse()),
				},
				LayoutPolicy.Layered,
			),
		).toBe(key);
		expect(
			regionLocalLayoutKey(document, { ...measurements, groups: new Map() }, LayoutPolicy.Layered),
		).not.toBe(key);
		expect(
			regionLocalLayoutKey(
				document,
				{ ...measurements, junctions: new Map() },
				LayoutPolicy.Layered,
			),
		).not.toBe(key);
		expect(
			regionLocalLayoutKey(
				{
					...document,
					groups: document.groups.map((group) => {
						if (group.id === 'child') return { ...group, regionId: 'other-region' };
						return group;
					}),
				},
				measurements,
				LayoutPolicy.Layered,
			),
		).not.toBe(key);
		expect(regionLocalLayoutKey(document, measurements)).not.toBe(key);
	});

	it('preserves absent incident evidence on a warm local cache hit', () => {
		const document = regionDocument();
		const measurements = prepareLayoutDocument(document).measurements;
		const cache = new RegionLocalLayoutCache();
		const leaf = solveRegionLeafLayout({
			document,
			measurements,
			leafPolicy: LayoutPolicy.Layered,
		});
		const value = { layout: leaf.layout, ranks: leaf.ranks };
		let computations = 0;
		const compute = () => {
			computations += 1;
			return value;
		};
		const first = cache.getOrCompute(document, measurements, LayoutPolicy.Layered, compute);
		const hit = cache.getOrCompute(document, measurements, LayoutPolicy.Layered, compute);
		expect(hit).toEqual(first);
		expect(hit).not.toBe(first);
		expect(hit.incidents).toBeUndefined();
		expect(hit.witness).toBeUndefined();
		expect(computations).toBe(1);
	});

	it('invalidates a real leaf for a local metric edit and protects route and rank copies', () => {
		const source = regionDocument();
		const local: LogicDocument = {
			...source,
			nodes: source.nodes.filter(({ id }) => id === 'a-source' || id === 'a-target'),
			relations: source.relations.filter(({ id }) => id === 'inside-a'),
		};
		const measurements = prepareLayoutDocument(local).measurements;
		const cache = new RegionLocalLayoutCache();
		const cold = solveRegionLeafLayout({
			document: local,
			measurements,
			leafPolicy: LayoutPolicy.Layered,
		});
		const first = solveRegionLeafLayout({
			document: local,
			measurements,
			leafPolicy: LayoutPolicy.Layered,
			cache,
		});
		expect(first).toEqual(cold);
		Object.assign(defined(first.layout.relations[0]?.points[0]), { x: -1000 });
		const hit = solveRegionLeafLayout({
			document: local,
			measurements,
			leafPolicy: LayoutPolicy.Layered,
			cache,
		});
		expect(hit).toEqual(cold);
		expect(hit.ranks.byEndpointId).not.toBe(first.ranks.byEndpointId);
		expect(hit.ranks.bands[0]).not.toBe(first.ranks.bands[0]);
		expect(cache.stats).toMatchObject({ entries: 1, misses: 1, hits: 1 });

		const width = measurements.nodes.get('a-target')?.width;
		if (width === undefined) throw new Error('Missing target measurement.');
		const editedMeasurements = {
			...measurements,
			nodes: new Map(measurements.nodes).set('a-target', {
				width: width + 32,
				height: 80,
			}),
		};
		const edited = solveRegionLeafLayout({
			document: local,
			measurements: editedMeasurements,
			leafPolicy: LayoutPolicy.Layered,
			cache,
		});
		expect(edited).toEqual(
			solveRegionLeafLayout({
				document: local,
				measurements: editedMeasurements,
				leafPolicy: LayoutPolicy.Layered,
			}),
		);
		expect(edited.layout).not.toEqual(cold.layout);
		expect(cache.stats).toMatchObject({ entries: 2, misses: 2, hits: 1 });
		expect(regionLocalLayoutKey(local, editedMeasurements, LayoutPolicy.SharedLanes)).not.toBe(
			regionLocalLayoutKey(local, editedMeasurements, LayoutPolicy.Layered),
		);
	});
});
