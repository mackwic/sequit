import { describe, expect, it } from 'vitest';

import { defined, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import {
	crossingIncidence,
	crossingMetricDemands,
} from '../../../../src/lib/core/layout/grid-cell-crossing';
import { validateNestedRegionLeafIncidentsMessage as validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/nested-region-leaf-incident-validation';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionLayoutSelected,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/region-composition-types';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/region-local-cache';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { persistedNestedGridWithGroupPortalDocument } from './nested-region-fixture';

function memberDocument(from = 'b', to = 'd'): LogicDocument {
	const source = persistedNestedGridWithGroupPortalDocument();
	return {
		...source,
		relations: source.relations.map((relation) => {
			if (relation.id !== 'group-crossing') return relation;
			return { ...relation, from, to };
		}),
	};
}

function attempt(document: LogicDocument, cache?: RegionLocalLayoutCache) {
	const prepared = prepareLayoutDocument(document);
	const input = nestedRegionInput(prepared.graph);
	const normalized = normalizeRegionCompositionModel(prepared.graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error('Expected normalized member portal model');
	const result = solveRecursiveNestedRegionLayout(
		prepared.graph,
		prepared.measurements,
		input,
		cache,
	);
	const cold = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	expect(result).toEqual(cold);
	if (result.status === RegionCompositionStatus.Selected) {
		expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, result)).toBeUndefined();
	}
	return { result, model: normalized.model };
}

function selected(document: LogicDocument, cache?: RegionLocalLayoutCache) {
	const { result, model } = attempt(document, cache);
	if (result.status !== RegionCompositionStatus.Selected)
		throw new Error(`Expected selected member portal: ${result.status}: ${result.reason}`);
	return { result, model };
}

function leafPiece(result: RegionLayoutSelected) {
	return defined(
		result.ownedRoutes.find(
			({ relationId, regionId }) => relationId === 'group-crossing' && regionId === 'b',
		),
	);
}

describe('direct group member crossing an internal grid cell', () => {
	it.each([
		{ from: 'b', to: 'd', owners: ['b', 'grid', 'd'] },
		{ from: 'd', to: 'b', owners: ['d', 'grid', 'b'] },
	])(
		'attaches $from → $to through the member, cell and grid boundaries',
		({ from, to, owners }) => {
			const document = memberDocument(from, to);
			const { result } = selected(document);
			const member = defined(result.layout.elements.find(({ id }) => id === 'b'));
			const group = defined(result.layout.elements.find(({ id }) => id === 'cell-group'));
			const cell = defined(result.regions.find(({ id }) => id === 'b'));
			const route = defined(result.layout.relations.find(({ id }) => id === 'group-crossing'));
			let port = defined(route.points[0]);
			if (to === 'b') port = defined(route.points.at(-1));
			expect(port.x).toBe(member.bounds.x + member.bounds.width);
			expect(port.y).toBeGreaterThan(member.bounds.y);
			expect(port.y).toBeLessThan(member.bounds.y + member.bounds.height);
			expect(member.bounds.x).toBeGreaterThan(group.bounds.x);
			expect(member.bounds.x + member.bounds.width).toBeLessThan(
				group.bounds.x + group.bounds.width,
			);
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
			expect(
				result.portals.find(
					({ relationId, regionId }) => relationId === 'group-crossing' && regionId === 'b',
				)?.side,
			).toBe(RegionPortalSide.Right);
		},
	);

	it('reuses local geometry under permutations and invalidates a resized group', () => {
		const document = memberDocument();
		const cache = new RegionLocalLayoutCache();
		const first = selected(document, cache).result;
		const permuted: LogicDocument = {
			...document,
			nodes: [...document.nodes].reverse(),
			groups: [...document.groups].reverse(),
			relations: [...document.relations].reverse(),
			regionPresentation: {
				...defined(document.regionPresentation),
				regions: [...defined(document.regionPresentation).regions].reverse(),
			},
		};
		expect(selected(permuted, cache).result).toEqual(first);
		expect(cache.stats.hits).toBeGreaterThan(0);
		const prepared = prepareLayoutDocument(document);
		const resized = {
			...prepared.measurements,
			groups: new Map(prepared.measurements.groups).set('cell-group', {
				...defined(prepared.measurements.groups.get('cell-group')),
				minimumHeight: 500,
			}),
		};
		const input = nestedRegionInput(prepared.graph);
		const incremental = solveRecursiveNestedRegionLayout(prepared.graph, resized, input, cache);
		expect(incremental).toEqual(solveRecursiveNestedRegionLayout(prepared.graph, resized, input));
		expect(incremental.status).toBe(RegionCompositionStatus.Selected);
	});

	it('reserves two distinct member ports when two cells receive crossings', () => {
		const source = memberDocument();
		const document: LogicDocument = {
			...source,
			relations: [...source.relations, { id: 'a-member-to-c', from: 'b', to: 'c' }],
		};
		const prepared = prepareLayoutDocument(document);
		const input = nestedRegionInput(prepared.graph);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized two-port member model');
		const crossing = defined(normalized.model.crossingRelationsByOwner.get('grid'));
		const demands = crossingMetricDemands(crossingIncidence(crossing));
		expect(demands.find(({ endpointId }) => endpointId === 'b')?.minimum).toBe(56);
		const measurements = {
			...prepared.measurements,
			nodes: new Map(prepared.measurements.nodes).set('b', {
				...defined(prepared.measurements.nodes.get('b')),
				height: 20,
			}),
		};
		const cache = new RegionLocalLayoutCache();
		const result = solveRecursiveNestedRegionLayout(prepared.graph, measurements, input, cache);
		expect(result).toEqual(solveRecursiveNestedRegionLayout(prepared.graph, measurements, input));
		if (result.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected selected member ports: ${result.status}: ${result.reason}`);
		expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, result)).toBeUndefined();
		const member = defined(result.layout.elements.find(({ id }) => id === 'b'));
		const portYs = ['a-member-to-c', 'group-crossing'].map(
			(id) =>
				defined(defined(result.layout.relations.find((route) => route.id === id)).points[0]).y,
		);
		expect(Math.abs(defined(portYs[0]) - defined(portYs[1]))).toBe(24);
		expect(member.bounds.height).toBeGreaterThanOrEqual(56);
	});

	it('rejects an unrelated node moved into the direct group exit', () => {
		const source = memberDocument();
		const template = defined(source.nodes.find(({ id }) => id === 'c'));
		const obstacle = {
			...template,
			id: 'b-obstacle',
			groupId: 'cell-group',
			layoutOrder: orderKey('a1'),
		};
		delete obstacle.regionId;
		const document: LogicDocument = {
			...source,
			nodes: [...source.nodes, obstacle],
		};
		const { result, model } = selected(document);
		const piece = leafPiece(result);
		const group = defined(result.layout.elements.find(({ id }) => id === 'cell-group'));
		const anchor = defined(piece.points[0]);
		const damaged = {
			...result,
			layout: {
				...result.layout,
				elements: result.layout.elements.map((element) => {
					if (element.id !== 'b-obstacle') return element;
					return {
						...element,
						bounds: {
							x: group.bounds.x + group.bounds.width + 8,
							y: anchor.y - 8,
							width: 16,
							height: 16,
						},
					};
				}),
			},
		};
		expect(validateNestedRegionLeafIncidents(model, damaged)).toBe(
			'Relation group-crossing source incident in leaf b crosses foreign node b-obstacle.',
		);
		const blocked: LogicDocument = {
			...document,
			nodes: document.nodes.map((node) => {
				if (node.id !== 'b-obstacle') return node;
				return { ...node, layoutOrder: orderKey('a3') };
			}),
		};
		expect(attempt(blocked).result).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionGeometryDiagnosticCode.GridCrossingEntersElement,
			regionId: 'grid',
			reason: 'Cross-cell relation group-crossing enters element b-obstacle.',
		});
	});

	it('rejects a member incident that exits and reenters its parent group', () => {
		const { result, model } = selected(memberDocument());
		const piece = leafPiece(result);
		const group = defined(result.layout.elements.find(({ id }) => id === 'cell-group'));
		const anchor = defined(piece.points[0]);
		const portal = defined(piece.points.at(-1));
		const outside = group.bounds.x + group.bounds.width + 8;
		const inside = group.bounds.x + group.bounds.width - 8;
		const damaged = {
			...result,
			ownedRoutes: result.ownedRoutes.map((route) => {
				if (route !== piece) return route;
				return {
					...route,
					points: [
						anchor,
						{ x: outside, y: anchor.y },
						{ x: outside, y: anchor.y + 8 },
						{ x: inside, y: anchor.y + 8 },
						{ x: inside, y: anchor.y },
						portal,
					],
				};
			}),
		};
		expect(validateNestedRegionLeafIncidents(model, damaged)).toBe(
			'Relation group-crossing source incident in leaf b crosses foreign node cell-group.',
		);
	});

	it('requires a level exit from a member actually enclosed by its group', () => {
		const { result, model } = selected(memberDocument());
		const group = defined(result.layout.elements.find(({ id }) => id === 'cell-group'));
		const piece = leafPiece(result);
		const anchor = defined(piece.points[0]);
		const offLevel = {
			...result,
			portals: result.portals.map((portal) => {
				if (portal.relationId !== 'group-crossing' || portal.regionId !== 'b') return portal;
				return { ...portal, point: { ...portal.point, y: portal.point.y + 8 } };
			}),
		};
		expect(validateNestedRegionLeafIncidents(model, offLevel)).toBe(
			'Relation group-crossing source incident in leaf b crosses foreign node cell-group.',
		);
		const unenclosed = {
			...result,
			layout: {
				...result.layout,
				elements: result.layout.elements.map((element) => {
					if (element.id !== group.id) return element;
					return { ...element, bounds: { ...element.bounds, x: anchor.x + 1 } };
				}),
			},
		};
		expect(validateNestedRegionLeafIncidents(model, unenclosed)).toBe(
			'Relation group-crossing source incident in leaf b crosses foreign node cell-group.',
		);
	});

	it('routes an outer member incident, a mixed grid and nested groups', () => {
		const outer = memberDocument('b', 'outside');
		const outerResult = selected(outer).result;
		expect(
			outerResult.ownedRoutes
				.filter(({ relationId }) => relationId === 'group-crossing')
				.map(({ regionId }) => regionId),
		).toEqual(['b', 'grid', '@root', 'outside']);
		const source = memberDocument();
		const mixed: LogicDocument = {
			...source,
			relations: [...source.relations, { id: 'outer-incident', from: 'a-target', to: 'outside' }],
		};
		const mixedResult = selected(mixed).result;
		expect(
			mixedResult.ownedRoutes
				.filter(({ relationId }) => relationId === 'outer-incident')
				.map(({ regionId }) => regionId),
		).toEqual(['a', 'grid', '@root', 'outside']);
		const inner = defined(source.groups.find(({ id }) => id === 'cell-group'));
		const nested = { ...inner, groupId: 'outer-group' };
		delete nested.regionId;
		const document: LogicDocument = {
			...source,
			groups: [{ ...inner, id: 'outer-group', layoutOrder: orderKey('a1') }, nested],
		};
		const nestedResult = selected(document).result;
		expect(
			nestedResult.ownedRoutes
				.filter(({ relationId }) => relationId === 'group-crossing')
				.map(({ regionId }) => regionId),
		).toEqual(['b', 'grid', 'd']);
	});
});
