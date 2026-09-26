import { describe, expect, it } from 'vitest';

import {
	defined,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { ROOT_LAYOUT_REGION_ID } from '../../../../src/lib/core/document/region-presentation';
import { satisfyMetricDemands } from '../../../../src/lib/core/layout/contract/metric-demand';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import {
	crossingIncidence,
	crossingMetricDemands,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing';
import type { LayoutMeasurements } from '../../../../src/lib/core/layout/layout-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutSelected,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/regions/recursive/nested-region-recursive-layout';
import { validateNestedRegionLeafIncidentsMessage as validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/regions/validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import type { PreparedLayoutDocument } from '../../../support/harnesses/layout';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	persistedNestedGridWithGroupPortalDocument,
	persistedNestedGridWithLaneCellDocument,
} from './nested-region-fixture';

function regionInput(document: LogicDocument): RegionInput {
	const presentation = defined(document.regionPresentation);
	const groups = new Map(document.groups.map((group) => [group.id, group]));
	function ownerRegion(endpoint: {
		readonly regionId?: string;
		readonly groupId?: string;
	}): string {
		if (endpoint.regionId !== undefined) return endpoint.regionId;
		return ownerRegion(defined(groups.get(defined(endpoint.groupId))));
	}
	return {
		regions: [
			{ id: ROOT_LAYOUT_REGION_ID, layoutOrder: 'a0' },
			...presentation.regions.map((region) => {
				if (region.parentId !== undefined) return region;
				return { ...region, parentId: ROOT_LAYOUT_REGION_ID };
			}),
		],
		regionByEndpointId: new Map(
			[...document.nodes, ...document.groups, ...document.junctions].map((endpoint) => [
				endpoint.id,
				ownerRegion(endpoint),
			]),
		),
	};
}

function selected(
	prepared: PreparedLayoutDocument,
	input: RegionInput,
	measurements: LayoutMeasurements = prepared.measurements,
	cache?: RegionLocalLayoutCache,
): RegionLayoutSelected {
	const result = solveRecursiveNestedRegionLayout(prepared.graph, measurements, input, cache);
	if (result.status !== RegionCompositionStatus.Selected)
		throw new Error(`Expected selected internal group portal: ${result.status}: ${result.reason}`);
	return result;
}

function validated(
	prepared: PreparedLayoutDocument,
	input: RegionInput,
	result: RegionLayoutSelected,
): void {
	const normalized = normalizeRegionCompositionModel(prepared.graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error('Expected a valid region model');
	expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
	expect(validateNestedRegionLeafIncidents(normalized.model, result)).toBeUndefined();
}

/** The group portal fixture with its group nested in an outer group and its member grouped deeper. */
function deeplyGroupedDocument(
	from: string,
	to: string,
): LogicDocument & {
	readonly regionPresentation: NonNullable<LogicDocument['regionPresentation']>;
} {
	const source = persistedNestedGridWithGroupPortalDocument();
	const group = defined(source.groups[0]);
	const inner = { ...group, groupId: 'outer-group' };
	delete inner.regionId;
	return {
		...source,
		groups: [{ ...group, id: 'outer-group', layoutOrder: orderKey('a1') }, inner],
		relations: source.relations.map((relation) => {
			if (relation.id !== 'group-crossing') return relation;
			return { ...relation, from, to };
		}),
	};
}

describe('direct group portals owned by an internal grid', () => {
	it.each([
		{ from: 'cell-group', to: 'd', owners: ['b', 'grid', 'd'] },
		{ from: 'd', to: 'cell-group', owners: ['d', 'grid', 'b'] },
	])('attaches $from → $to through the two cell boundaries', ({ from, to, owners }) => {
		const source = persistedNestedGridWithGroupPortalDocument();
		const document = {
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id !== 'group-crossing') return relation;
				return { ...relation, from, to };
			}),
		};
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const result = selected(prepared, input);
		validated(prepared, input, result);
		const group = defined(result.layout.elements.find(({ id }) => id === 'cell-group'));
		const member = defined(result.layout.elements.find(({ id }) => id === 'b'));
		const cell = defined(result.regions.find(({ id }) => id === 'b'));
		const route = defined(result.layout.relations.find(({ id }) => id === 'group-crossing'));
		let port = defined(route.points[0]);
		if (to === 'cell-group') port = defined(route.points.at(-1));
		expect(port.x).toBe(group.bounds.x + group.bounds.width);
		expect(port.y).toBeGreaterThan(group.bounds.y);
		expect(port.y).toBeLessThan(group.bounds.y + group.bounds.height);
		expect(member.bounds.x).toBeGreaterThan(group.bounds.x);
		expect(member.bounds.x + member.bounds.width).toBeLessThan(group.bounds.x + group.bounds.width);
		expect(group.bounds.x + group.bounds.width).toBeLessThan(cell.bounds.x + cell.bounds.width);
		expect(
			result.ownedRoutes
				.filter(({ relationId }) => relationId === 'group-crossing')
				.map(({ regionId }) => regionId),
		).toEqual(owners);
		expect(
			result.portals
				.filter(({ relationId }) => relationId === 'group-crossing')
				.map(({ regionId }) => regionId),
		).toEqual(owners.filter((id) => id !== 'grid'));
	});

	it('reserves capacity for two group incidents and preserves cache = cold under edits and permutations', () => {
		const source = persistedNestedGridWithGroupPortalDocument();
		const document = {
			...source,
			relations: [...source.relations, { id: 'a-group-to-c', from: 'cell-group', to: 'c' }],
		};
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const originalGroup = defined(prepared.measurements.groups.get('cell-group'));
		const measurements = {
			...prepared.measurements,
			groups: new Map(prepared.measurements.groups).set('cell-group', {
				...originalGroup,
				minimumHeight: 20,
			}),
		};
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected a valid region model');
		const crossings = defined(normalized.model.crossingRelationsByOwner.get('grid'));
		const demands = crossingMetricDemands(crossingIncidence(crossings));
		expect(demands.find(({ endpointId }) => endpointId === 'cell-group')?.minimum).toBe(56);
		expect(
			satisfyMetricDemands(measurements, demands, document.layout.direction).groups.get(
				'cell-group',
			)?.minimumHeight,
		).toBe(56);
		const cache = new RegionLocalLayoutCache();
		const first = selected(prepared, input, measurements, cache);
		expect(first).toEqual(selected(prepared, input, measurements));
		validated(prepared, input, first);
		const group = defined(first.layout.elements.find(({ id }) => id === 'cell-group'));
		const ports = ['a-group-to-c', 'group-crossing'].map((id) =>
			defined(defined(first.layout.relations.find((route) => route.id === id)).points[0]),
		);
		expect(Math.abs(defined(ports[0]).y - defined(ports[1]).y)).toBe(24);
		for (const port of ports) expect(port.x).toBe(group.bounds.x + group.bounds.width);
		expect(group.bounds.height).toBeGreaterThanOrEqual(56);

		const permutedDocument = {
			...document,
			nodes: [...document.nodes].reverse(),
			groups: [...document.groups].reverse(),
			relations: [...document.relations].reverse(),
			regionPresentation: {
				...document.regionPresentation,
				regions: [...document.regionPresentation.regions].reverse(),
			},
		};
		const permuted = prepareLayoutDocument(permutedDocument);
		const permutedMeasurements = {
			...measurements,
			nodes: new Map([...measurements.nodes].reverse()),
			groups: new Map([...measurements.groups].reverse()),
		};
		const reordered = selected(
			permuted,
			regionInput(permutedDocument),
			permutedMeasurements,
			cache,
		);
		expect(reordered).toEqual(first);
		expect(reordered).toEqual(
			selected(permuted, regionInput(permutedDocument), permutedMeasurements),
		);
		expect(cache.stats.hits).toBeGreaterThanOrEqual(5);

		const resized = {
			...measurements,
			groups: new Map(measurements.groups).set('cell-group', {
				...originalGroup,
				minimumHeight: group.bounds.height + 100,
			}),
		};
		const changed = selected(prepared, input, resized, cache);
		expect(changed).toEqual(selected(prepared, input, resized));
		validated(prepared, input, changed);
		expect(defined(changed.regions.find(({ id }) => id === 'b')).localLayout).not.toEqual(
			defined(first.regions.find(({ id }) => id === 'b')).localLayout,
		);
		expect(cache.stats.hits).toBeGreaterThanOrEqual(9);
	});

	it('selects the opposite group corridor order by reallocating the shared ports', () => {
		const source = persistedNestedGridWithGroupPortalDocument();
		const document = {
			...source,
			relations: [...source.relations, { id: 'group-to-c', from: 'cell-group', to: 'c' }],
		};
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const result = selected(prepared, input);
		validated(prepared, input, result);
		const group = defined(result.layout.elements.find(({ id }) => id === 'cell-group'));
		const ports = ['group-crossing', 'group-to-c'].map((id) =>
			defined(defined(result.layout.relations.find((route) => route.id === id)).points[0]),
		);
		expect(Math.abs(defined(ports[0]).y - defined(ports[1]).y)).toBe(24);
		for (const port of ports) expect(port.x).toBe(group.bounds.x + group.bounds.width);
		expect(result).toEqual(selected(prepared, input));
	});

	it('rejects a member moved beyond the group while it remains inside its cell', () => {
		const document = persistedNestedGridWithGroupPortalDocument();
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const result = selected(prepared, input);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected a valid region model');
		const group = defined(result.layout.elements.find(({ id }) => id === 'cell-group'));
		const member = defined(result.layout.elements.find(({ id }) => id === 'b'));
		const cell = defined(result.regions.find(({ id }) => id === 'b'));
		const translation = defined(cell.translation);
		const x = group.bounds.x + group.bounds.width - member.bounds.width + 1;
		expect(x + member.bounds.width).toBeLessThan(cell.bounds.x + cell.bounds.width);
		const damaged = {
			...result,
			layout: {
				...result.layout,
				elements: result.layout.elements.map((element) => {
					if (element.id !== 'b') return element;
					return { ...element, bounds: { ...element.bounds, x } };
				}),
			},
			regions: result.regions.map((region) => {
				if (region.id !== 'b') return region;
				const local = defined(region.localLayout);
				return {
					...region,
					localLayout: {
						...local,
						elements: local.elements.map((element) => {
							if (element.id !== 'b') return element;
							return { ...element, bounds: { ...element.bounds, x: x - translation.x } };
						}),
					},
				};
			}),
		};
		expect(validateRegionCompositionGeometry(normalized.model, damaged)).toBe(
			'Element b leaves its parent group cell-group in leaf region b.',
		);
	});

	it('selects a direct grouped member and a group endpoint outside its grid', () => {
		const source = persistedNestedGridWithGroupPortalDocument();
		const memberDocument = {
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id !== 'group-crossing') return relation;
				return { ...relation, from: 'b' };
			}),
		};
		const memberPrepared = prepareLayoutDocument(memberDocument);
		const memberInput = regionInput(memberDocument);
		validated(memberPrepared, memberInput, selected(memberPrepared, memberInput));
		const outerDocument = {
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id !== 'group-crossing') return relation;
				return { ...relation, to: 'outside' };
			}),
		};
		const outerPrepared = prepareLayoutDocument(outerDocument);
		const outerInput = regionInput(outerDocument);
		const outerResult = selected(outerPrepared, outerInput);
		validated(outerPrepared, outerInput, outerResult);
		expect(
			outerResult.ownedRoutes
				.filter(({ relationId }) => relationId === 'group-crossing')
				.map(({ regionId }) => regionId),
		).toEqual(['b', 'grid', '@root', 'outside']);
		for (const { from, to, owners } of [
			{ from: 'a-target', to: 'outside', owners: ['a', 'grid', '@root', 'outside'] },
			{ from: 'outside', to: 'a-target', owners: ['outside', '@root', 'grid', 'a'] },
		] as const) {
			const mixed = {
				...source,
				relations: [...source.relations, { id: 'outer-incident', from, to }],
			};
			const prepared = prepareLayoutDocument(mixed);
			const input = regionInput(mixed);
			const result = selected(prepared, input);
			validated(prepared, input, result);
			expect(
				result.ownedRoutes
					.filter(({ relationId }) => relationId === 'outer-incident')
					.map(({ regionId }) => regionId),
			).toEqual(owners);
		}
	});

	it('routes a nested group endpoint through the grid', () => {
		const source = persistedNestedGridWithGroupPortalDocument();
		const group = defined(source.groups[0]);
		const inner = { ...group, groupId: 'outer-group' };
		delete inner.regionId;
		const document = {
			...source,
			groups: [{ ...group, id: 'outer-group', layoutOrder: orderKey('a1') }, inner],
		};
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const result = selected(prepared, input);
		validated(prepared, input, result);
		expect(
			result.ownedRoutes
				.filter(({ relationId }) => relationId === 'group-crossing')
				.map(({ regionId }) => regionId),
		).toEqual(['b', 'grid', 'd']);
	});

	it.each([
		{ from: 'cell-group', to: 'd', owners: ['b', 'grid', 'd'] },
		{ from: 'd', to: 'cell-group', owners: ['d', 'grid', 'b'] },
		{ from: 'b', to: 'd', owners: ['b', 'grid', 'd'] },
		{ from: 'd', to: 'b', owners: ['d', 'grid', 'b'] },
	] as const)(
		'ports the $from → $to nested group endpoint on its own face and crosses the outer face',
		({ from, to, owners }) => {
			const document = deeplyGroupedDocument(from, to);
			const prepared = prepareLayoutDocument(document);
			const input = regionInput(document);
			const result = selected(prepared, input);
			validated(prepared, input, result);
			expect(
				result.ownedRoutes
					.filter(({ relationId }) => relationId === 'group-crossing')
					.map(({ regionId }) => regionId),
			).toEqual(owners);
			let endpointId = to;
			if (to === 'd') endpointId = from;
			const endpoint = defined(result.layout.elements.find(({ id }) => id === endpointId));
			const outer = defined(result.layout.elements.find(({ id }) => id === 'outer-group'));
			const route = defined(result.layout.relations.find(({ id }) => id === 'group-crossing'));
			let port = defined(route.points[0]);
			if (to !== 'd') port = defined(route.points.at(-1));
			expect(port.x).toBe(endpoint.bounds.x + endpoint.bounds.width);
			expect(port.y).toBeGreaterThan(endpoint.bounds.y);
			expect(port.y).toBeLessThan(endpoint.bounds.y + endpoint.bounds.height);
			// The endpoint's own face lies inside the outer group, so the route crosses that face.
			expect(port.x).toBeLessThan(outer.bounds.x + outer.bounds.width);
			expect(port.x).toBeGreaterThan(outer.bounds.x);
		},
	);

	it('keeps the nested group endpoint invariant under permutation and equals the cold result', () => {
		const document = deeplyGroupedDocument('cell-group', 'd');
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const cache = new RegionLocalLayoutCache();
		const first = selected(prepared, input, prepared.measurements, cache);
		validated(prepared, input, first);
		expect(first).toEqual(selected(prepared, input));
		const permutedDocument = {
			...document,
			nodes: [...document.nodes].reverse(),
			groups: [...document.groups].reverse(),
			relations: [...document.relations].reverse(),
			regionPresentation: {
				...document.regionPresentation,
				regions: [...document.regionPresentation.regions].reverse(),
			},
		};
		const permuted = prepareLayoutDocument(permutedDocument);
		const permutedMeasurements = {
			...prepared.measurements,
			nodes: new Map([...prepared.measurements.nodes].reverse()),
			groups: new Map([...prepared.measurements.groups].reverse()),
		};
		const reordered = selected(
			permuted,
			regionInput(permutedDocument),
			permutedMeasurements,
			cache,
		);
		expect(reordered).toEqual(first);
		expect(reordered).toEqual(
			selected(permuted, regionInput(permutedDocument), permutedMeasurements),
		);
		expect(cache.stats.hits).toBeGreaterThanOrEqual(1);
	});

	it('keeps an incident on a lane-bearing group cell outside the direct portal contract', () => {
		const source = persistedNestedGridWithLaneCellDocument();
		const group = {
			...defined(persistedNestedGridWithGroupPortalDocument().groups[0]),
			laneId: 'left',
		};
		const document = {
			...source,
			groups: [group],
			nodes: source.nodes.map((node) => {
				if (node.id !== 'b') return node;
				const member = { ...node, groupId: group.id };
				delete member.regionId;
				delete member.laneId;
				return member;
			}),
			relations: [...source.relations, { id: 'group-crossing', from: group.id, to: 'd' }],
		};
		const prepared = prepareLayoutDocument(document);
		expect(
			solveRecursiveNestedRegionLayout(
				prepared.graph,
				prepared.measurements,
				regionInput(document),
			),
		).toEqual({
			status: RegionCompositionStatus.Unsupported,
			reason: 'Groups with descendants are outside the first shared layout policy.',
		});
	});

	it('rejects a group crossing whose target is deeper than a direct grid cell', () => {
		const source = persistedNestedGridWithGroupPortalDocument();
		const d = defined(source.nodes.find(({ id }) => id === 'd'));
		const document = {
			...source,
			regionPresentation: {
				...source.regionPresentation,
				regions: [
					...source.regionPresentation.regions,
					{
						id: 'd-left',
						parentId: 'd',
						layoutOrder: orderKey('a0'),
						policy: LayoutPolicy.Layered,
					},
					{
						id: 'd-right',
						parentId: 'd',
						layoutOrder: orderKey('a1'),
						policy: LayoutPolicy.Layered,
					},
				],
			},
			nodes: [
				...source.nodes.map((node) => {
					if (node.id !== 'd') return node;
					return { ...node, regionId: 'd-left' };
				}),
				{ ...d, id: 'd2', markdown: 'D2\n', regionId: 'd-right', layoutOrder: orderKey('a7') },
			],
		};
		const prepared = prepareLayoutDocument(document);
		const input = regionInput(document);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		expect(normalized.status).toBe(RegionCompositionModelStatus.Ready);
		if (normalized.status !== RegionCompositionModelStatus.Ready) return;
		expect(
			normalized.model.relations.find(({ relation }) => relation.id === 'group-crossing'),
		).toMatchObject({
			ownerId: 'grid',
			sourceLeafId: 'b',
			targetLeafId: 'd-left',
		});
		expect(
			solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input),
		).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionGeometryDiagnosticCode.GridCrossingEntersElement,
			regionId: 'grid',
			reason: 'Cross-cell relation group-crossing enters element d2.',
		});
	});
});
