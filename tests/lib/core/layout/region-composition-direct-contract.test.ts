import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph, type LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import type { LayoutMeasurements } from '../../../../src/lib/core/layout/layout-types';
import {
	childSides,
	directChild,
	leafDocument,
	policyFailure,
	type RecursiveContext,
	sideForRegion,
} from '../../../../src/lib/core/layout/nested-region-recursive-model-adapter';
import { NESTED_REGION_COMPOSITION_LIMITS } from '../../../../src/lib/core/layout/region-composition-limits';
import {
	normalizeRegionCompositionModel,
	RegionCompositionDiagnosticCode,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import {
	partitionRelations,
	relationOwnership,
} from '../../../../src/lib/core/layout/region-composition-relations';
import {
	normalizedRegions,
	parentCycle,
} from '../../../../src/lib/core/layout/region-composition-tree';
import {
	type RegionInput,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/region-composition-types';
import { depthTwoRegionDocument, depthTwoRegionInput } from './nested-region-fixture';

const emptyMeasurements: LayoutMeasurements = {
	nodes: new Map(),
	groups: new Map(),
	junctions: new Map(),
};

function graph(document: LogicDocument = depthTwoRegionDocument()): LogicGraph {
	const result = createGraph(document);
	if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('; '));
	return result.value;
}

function readyModel(source = graph(), input = depthTwoRegionInput()) {
	const normalized = normalizeRegionCompositionModel(source, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error(normalized.diagnostic.message);
	return normalized.model;
}

describe('direct region composition contracts', () => {
	it.each(['a-target', 'c'])('rejects a relation with missing %s ownership', (endpointId) => {
		const source = graph();
		const model = readyModel(source);
		const incomplete = new Map([...model.leafByEndpointId].filter(([id]) => id !== endpointId));
		expect(() => relationOwnership(source, incomplete, model.regionsById)).toThrow(
			'Relation has an unvalidated endpoint assignment.',
		);
	});

	it('rejects a partition that omits a crossing owner', () => {
		const model = readyModel();
		expect(() => partitionRelations(['left', 'branch-right'], model.relations)).toThrow(
			'Unvalidated relation owner.',
		);
	});

	it('reports a canonical cycle and rejects a missing traversal root', () => {
		const model = readyModel();
		const definitions = new Map([...model.regionsById].map(([id, node]) => [id, node.definition]));
		expect(parentCycle(definitions)).toBeUndefined();
		expect(() => normalizedRegions('missing', definitions)).toThrow('Unvalidated region identity.');
		const cyclic = new Map(definitions);
		cyclic.set('branch', { ...defined(cyclic.get('branch')), parentId: 'left' });
		expect(parentCycle(cyclic)).toEqual(['branch', 'left', 'branch']);
	});

	it.each([
		{
			name: 'a group',
			add: (document: LogicDocument) => ({
				...document,
				groups: [
					...document.groups,
					{
						kind: EndpointKind.Group as const,
						id: 'extra-group',
						label: 'Extra group',
						layoutOrder: orderKey('a6'),
					},
				],
			}),
			endpointId: 'extra-group',
			collection: 'groups',
		},
		{
			name: 'a junction',
			add: (document: LogicDocument) => ({
				...document,
				junctions: [
					...document.junctions,
					{
						kind: EndpointKind.Junction as const,
						id: 'extra-junction',
						operator: JunctionOperator.Xor,
						layoutOrder: orderKey('a6'),
					},
				],
			}),
			endpointId: 'extra-junction',
			collection: 'junctions',
		},
	] as const)('keeps $name in its owned leaf document', ({ add, endpointId, collection }) => {
		const source = graph(add(depthTwoRegionDocument()));
		const input = depthTwoRegionInput();
		const assigned: RegionInput = {
			...input,
			regionByEndpointId: new Map([...input.regionByEndpointId, [endpointId, 'left']]),
		};
		const model = readyModel(source, assigned);
		expect(policyFailure(source, model)).toBeUndefined();
		const context: RecursiveContext = {
			graph: source,
			model,
			measurements: emptyMeasurements,
			cache: undefined,
			ownershipByRelationId: new Map(),
		};
		expect(leafDocument(context, 'left')[collection].map(({ id }) => id)).toContain(endpointId);
		expect(leafDocument(context, 'middle')[collection]).toEqual([]);
	});

	it('reports the endpoint budget through the coded resource limit', () => {
		const document = depthTwoRegionDocument();
		const template = defined(document.nodes[0]);
		const extra = Array.from({ length: 7 }, (_, index) => ({
			...template,
			id: `extra-${index}`,
			layoutOrder: orderKey(`a${'6789ABC'.charAt(index)}`),
		}));
		const source = graph({ ...document, nodes: [...document.nodes, ...extra] });
		const input = depthTwoRegionInput();
		const assigned: RegionInput = {
			...input,
			regionByEndpointId: new Map([
				...input.regionByEndpointId,
				...extra.map(({ id }) => [id, 'left'] as const),
			]),
		};
		expect(
			normalizeRegionCompositionModel(source, assigned, NESTED_REGION_COMPOSITION_LIMITS),
		).toMatchObject({
			status: RegionCompositionModelStatus.Unsupported,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.ResourceLimit,
				path: ['endpoints'],
				actual: 13,
				limit: 12,
			},
		});
	});

	it('rejects a root without children after normalization', () => {
		const source = graph();
		const input: RegionInput = {
			regions: [{ id: '@root', layoutOrder: 'a0' }],
			regionByEndpointId: new Map([...source.endpointsById.keys()].map((id) => [id, '@root'])),
		};
		const model = readyModel(source, input);
		expect(policyFailure(source, model)).toContain('nonempty root region');
	});

	it('propagates both inherited incident roles through the owning branch', () => {
		const document = depthTwoRegionDocument();
		const source = graph({
			...document,
			relations: [
				...document.relations.filter(({ id }) => id !== 'at-root'),
				{ id: 'at-root', from: 'a-target', to: 'e' },
				{ id: 'root-to-branch', from: 'd', to: 'c' },
			],
		});
		const input = depthTwoRegionInput();
		const model = readyModel(source, input);
		const context: RecursiveContext = {
			graph: source,
			model,
			measurements: emptyMeasurements,
			cache: undefined,
			ownershipByRelationId: new Map(model.relations.map((owned) => [owned.relation.id, owned])),
		};
		expect(directChild(context, '@root', 'a-target')).toBe('branch');
		expect(directChild(context, 'branch', 'a-target')).toBe('left');
		const rootToBranch = childSides({
			context,
			regionId: '@root',
			childId: 'branch',
			incidentSides: new Map(),
			localSide: RegionPortalSide.Top,
		});
		expect([...rootToBranch]).toEqual([
			['at-root', [RegionPortalSide.Top]],
			['root-to-branch', [RegionPortalSide.Top]],
		]);
		const inherited = new Map([
			['at-root', [RegionPortalSide.Bottom]],
			['root-to-branch', [RegionPortalSide.Bottom]],
		]);
		const sourceLeaf = childSides({
			context,
			regionId: 'branch',
			childId: 'left',
			incidentSides: inherited,
			localSide: RegionPortalSide.Top,
		});
		expect([...sourceLeaf]).toEqual([
			['at-root', [RegionPortalSide.Bottom]],
			['inside-branch', [RegionPortalSide.Top]],
		]);
		const targetLeaf = childSides({
			context,
			regionId: 'branch',
			childId: 'branch-right',
			incidentSides: inherited,
			localSide: RegionPortalSide.Top,
		});
		expect([...targetLeaf]).toEqual([
			['inside-branch', [RegionPortalSide.Top]],
			['root-to-branch', [RegionPortalSide.Bottom]],
		]);
		const unrelatedLeaf = childSides({
			context,
			regionId: 'branch',
			childId: 'middle',
			incidentSides: inherited,
			localSide: RegionPortalSide.Top,
		});
		expect(unrelatedLeaf.size).toBe(0);
	});

	it('uses a leaf direction and an explicit disposition side independently', () => {
		const source = graph();
		const input = depthTwoRegionInput();
		const localLayout = {
			direction: LayoutDirection.BottomToTop,
			bias: LayoutBias.Bottom,
		} as const;
		const directed: RegionInput = {
			...input,
			regions: input.regions.map((region) => {
				if (region.id !== 'left') return region;
				return { ...region, layout: localLayout };
			}),
		};
		const model = readyModel(source, directed);
		const naturalContext: RecursiveContext = {
			graph: source,
			model,
			measurements: emptyMeasurements,
			cache: undefined,
			ownershipByRelationId: new Map(),
		};
		const context: RecursiveContext = {
			...naturalContext,
			dispositionSideByRegionId: new Map([['left', RegionPortalSide.Top]]),
		};
		expect(leafDocument(context, 'left').layout).toEqual(localLayout);
		expect(sideForRegion(context, '@root')).toBe(RegionPortalSide.Top);
		expect(sideForRegion(context, 'left')).toBe(RegionPortalSide.Top);
		expect(sideForRegion(naturalContext, 'left')).toBe(RegionPortalSide.Bottom);
	});
});
