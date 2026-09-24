import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/nested-region-leaf-incident-validation';
import { nestedRegionLocalMeasurements } from '../../../../src/lib/core/layout/nested-region-local-measurements';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import {
	leafDocument,
	leafIncidentContracts,
	type RecursiveContext,
} from '../../../../src/lib/core/layout/nested-region-recursive-model-adapter';
import {
	type NestedRegionInput,
	NestedRegionLayoutStatus,
} from '../../../../src/lib/core/layout/nested-region-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionDiagnosticCode,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';
import { validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { RegionIncidentRole } from '../../../../src/lib/core/layout/region-incident-contract';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { depthTwoRegionDocument, depthTwoRegionInput } from './nested-region-fixture';

function solve(input: NestedRegionInput) {
	const prepared = prepareLayoutDocument(depthTwoRegionDocument());
	return solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
}

describe('recursive region model and row policy', () => {
	it('passes source provenance and a four-sided incident choice to either leaf', () => {
		const prepared = prepareLayoutDocument(depthTwoRegionDocument());
		const normalized = normalizeRegionCompositionModel(prepared.graph, depthTwoRegionInput());
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		const context: RecursiveContext = {
			graph: prepared.graph,
			model: normalized.model,
			measurements: prepared.measurements,
			cache: undefined,
			ownershipByRelationId: new Map(
				normalized.model.relations.map((owned) => [owned.relation.id, owned]),
			),
		};
		expect(
			leafIncidentContracts(
				context,
				'left',
				new Map([['inside-branch', [RegionPortalSide.Right]]]),
			),
		).toEqual([
			{
				relation: { id: 'inside-branch', from: 'a-target', to: 'c' },
				endpointId: 'a-target',
				role: RegionIncidentRole.Source,
				allowedSides: [RegionPortalSide.Right],
			},
		]);
		expect(
			leafIncidentContracts(
				context,
				'branch-right',
				new Map([['inside-branch', [RegionPortalSide.Left]]]),
			),
		).toMatchObject([
			{
				endpointId: 'c',
				role: RegionIncidentRole.Target,
				allowedSides: [RegionPortalSide.Left],
			},
		]);
	});

	it('keeps only local measurements and does not fabricate an absent local size', () => {
		const prepared = prepareLayoutDocument(depthTwoRegionDocument());
		const normalized = normalizeRegionCompositionModel(prepared.graph, depthTwoRegionInput());
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		const context: RecursiveContext = {
			graph: prepared.graph,
			model: normalized.model,
			measurements: prepared.measurements,
			cache: undefined,
			ownershipByRelationId: new Map(),
		};
		const document = leafDocument(context, 'left');
		const incomplete = {
			...prepared.measurements,
			nodes: new Map([...prepared.measurements.nodes].filter(([id]) => id !== 'a-target')),
		};
		const local = nestedRegionLocalMeasurements(document, incomplete);
		expect(document.nodes.map(({ id }) => id)).toEqual(['a-source', 'a-target']);
		expect([...local.nodes.keys()]).toEqual(['a-source']);
		expect(local.groups.size).toBe(0);
		expect(local.junctions.size).toBe(0);
	});

	it.each([
		[
			'duplicate region identity',
			(input: NestedRegionInput) => ({
				...input,
				regions: [...input.regions, { id: 'left', parentId: 'branch', layoutOrder: 'z' }],
			}),
			RegionCompositionDiagnosticCode.DuplicateRegionId,
		],
		[
			'an empty region identity',
			(input: NestedRegionInput) => ({
				...input,
				regions: input.regions.map((region) => {
					if (region.id === 'left') return { ...region, id: '' };
					return region;
				}),
			}),
			RegionCompositionDiagnosticCode.EmptyRegionId,
		],
		[
			'two roots',
			(input: NestedRegionInput) => ({
				...input,
				regions: [...input.regions, { id: 'second-root', layoutOrder: 'z' }],
			}),
			RegionCompositionDiagnosticCode.InvalidRootCount,
		],
		[
			'an unknown parent',
			(input: NestedRegionInput) => ({
				...input,
				regions: input.regions.map((region) => {
					if (region.id === 'branch') return { ...region, parentId: 'absent' };
					return region;
				}),
			}),
			RegionCompositionDiagnosticCode.UnknownParent,
		],
		[
			'a parent cycle',
			(input: NestedRegionInput) => ({
				...input,
				regions: input.regions.map((region) => {
					if (region.id === 'branch') return { ...region, parentId: 'left' };
					return region;
				}),
			}),
			RegionCompositionDiagnosticCode.ParentCycle,
		],
		[
			'a missing node assignment',
			(input: NestedRegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId].filter(([id]) => id !== 'c')),
			}),
			RegionCompositionDiagnosticCode.MissingEndpointAssignment,
		],
		[
			'an extra node assignment',
			(input: NestedRegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId, ['ghost', 'left']]),
			}),
			RegionCompositionDiagnosticCode.UnknownEndpointAssignment,
		],
		[
			'a substituted node assignment',
			(input: NestedRegionInput) => ({
				...input,
				regionByEndpointId: new Map([
					...[...input.regionByEndpointId].filter(([id]) => id !== 'c'),
					['ghost', 'left'],
				]),
			}),
			RegionCompositionDiagnosticCode.MissingEndpointAssignment,
		],
		[
			'a node assigned to an unknown region',
			(input: NestedRegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId, ['c', 'absent']]),
			}),
			RegionCompositionDiagnosticCode.UnknownRegionAssignment,
		],
		[
			'a node owned by an internal region',
			(input: NestedRegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId, ['c', 'branch']]),
			}),
			RegionCompositionDiagnosticCode.NonLeafAssignment,
		],
	] as const)('reports a structured diagnostic for %s', (_, change, code) => {
		const prepared = prepareLayoutDocument(depthTwoRegionDocument());
		const result = normalizeRegionCompositionModel(prepared.graph, change(depthTwoRegionInput()));
		expect(result).toMatchObject({
			status: RegionCompositionModelStatus.Invalid,
			diagnostic: { code },
		});
		if (result.status === RegionCompositionModelStatus.Ready) return;
		expect(result.diagnostic.path.length).toBeGreaterThan(0);
	});

	it.each([
		[
			'one top-level child',
			(input: NestedRegionInput) => ({
				...input,
				regions: input.regions.map((region) => {
					if (region.id === 'right' || region.id === 'far-right')
						return { ...region, parentId: 'branch' };
					return region;
				}),
			}),
			'two or three direct child regions',
		],
		[
			'four top-level children',
			(input: NestedRegionInput) => ({
				...input,
				regions: [...input.regions, { id: 'extra', parentId: '@root', layoutOrder: 'z' }],
			}),
			'two or three direct child regions',
		],
		[
			'a single grandchild',
			(input: NestedRegionInput) => ({
				...input,
				regions: input.regions.filter(({ id }) => id !== 'middle' && id !== 'branch-right'),
				regionByEndpointId: new Map(
					[...input.regionByEndpointId].map(([id, regionId]) => {
						if (regionId === 'middle' || regionId === 'branch-right') return [id, 'left'];
						return [id, regionId];
					}),
				),
			}),
			'two or three direct child regions',
		],
		[
			'four grandchildren',
			(input: NestedRegionInput) => ({
				...input,
				regions: [...input.regions, { id: 'fourth', parentId: 'branch', layoutOrder: 'z' }],
			}),
			'two or three direct child regions',
		],
		[
			'an empty leaf',
			(input: NestedRegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId, ['b', 'left']]),
			}),
			'leaf region must own',
		],
	] as const)('keeps the row policy bounded for %s', (_, change, reason) => {
		const attempt = solve(change(depthTwoRegionInput()));
		expect(attempt.status).toBe(NestedRegionLayoutStatus.Unsupported);
		if (attempt.status !== NestedRegionLayoutStatus.Unsupported) return;
		expect(attempt.reason).toContain(reason);
	});

	it('normalizes a third level without a depth limit', () => {
		const prepared = prepareLayoutDocument(depthTwoRegionDocument());
		const input = depthTwoRegionInput();
		const deeper: NestedRegionInput = {
			...input,
			regions: [...input.regions, { id: 'deep', parentId: 'left', layoutOrder: 'a' }],
			regionByEndpointId: new Map(
				[...input.regionByEndpointId].map(([id, regionId]) => {
					if (regionId === 'left') return [id, 'deep'];
					return [id, regionId];
				}),
			),
		};
		const result = normalizeRegionCompositionModel(prepared.graph, deeper);
		expect(result.status).toBe(RegionCompositionModelStatus.Ready);
		if (result.status !== RegionCompositionModelStatus.Ready) return;
		expect(result.model.regionsById.get('deep')?.depth).toBe(3);
	});

	it('bounds the number of root-owned crossings', () => {
		const source = depthTwoRegionDocument();
		const document: LogicDocument = {
			...source,
			relations: [
				...source.relations,
				{ id: 'root-2', from: 'd', to: 'e' },
				{ id: 'root-3', from: 'd', to: 'e' },
				{ id: 'root-4', from: 'd', to: 'e' },
			],
		};
		const prepared = prepareLayoutDocument(document);
		const attempt = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			depthTwoRegionInput(),
		);
		expect(attempt.status).toBe(NestedRegionLayoutStatus.Unsupported);
		if (attempt.status !== NestedRegionLayoutStatus.Unsupported) return;
		expect(attempt.reason).toContain('at most three owned crossings');
	});

	it('resolves a group crossing after its owning parent retries a bus side', () => {
		const source = depthTwoRegionDocument();
		const document: LogicDocument = {
			...source,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'group-left',
					label: 'Left group',
					layoutOrder: orderKey('a0'),
				},
			],
			nodes: source.nodes.map((node) => {
				if (node.id !== 'a-source') return node;
				return { ...node, groupId: 'group-left' };
			}),
			relations: [...source.relations, { id: 'group-crossing', from: 'group-left', to: 'c' }],
		};
		const input = depthTwoRegionInput();
		const prepared = prepareLayoutDocument(document);
		const composedInput = {
			...input,
			regionByEndpointId: new Map([...input.regionByEndpointId, ['group-left', 'left']]),
		};
		const attempt = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			composedInput,
		);
		expect(attempt.status).toBe(NestedRegionLayoutStatus.Selected);
		if (attempt.status !== NestedRegionLayoutStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(prepared.graph, composedInput);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, attempt)).toBeUndefined();
		expect(
			attempt.layout.relations.find(({ id }) => id === 'group-crossing')?.points.length,
		).toBeGreaterThan(1);
	});

	it('uses stable identities to order tied grandchildren', () => {
		const input = depthTwoRegionInput();
		const tied = {
			...input,
			regions: input.regions.map((region) => {
				if (region.id !== 'left' && region.id !== 'middle') return region;
				return { ...region, layoutOrder: 'same' };
			}),
		};
		const attempt = solve(tied);
		expect(attempt.status).toBe(NestedRegionLayoutStatus.Selected);
		if (attempt.status !== NestedRegionLayoutStatus.Selected) return;
		expect(attempt.regions.map(({ id }) => id).slice(1, 4)).toEqual([
			'branch-right',
			'left',
			'middle',
		]);
	});

	it('can give an internal parent its own flow direction', () => {
		const input = depthTwoRegionInput();
		const localDirection = defined(
			layoutConfiguration(LayoutDirection.BottomToTop, LayoutBias.Bottom),
		);
		const directed = {
			...input,
			regions: input.regions.map((region) => {
				if (region.id !== 'branch') return region;
				return { ...region, layout: localDirection };
			}),
		};
		const attempt = solve(directed);
		expect(attempt.status).toBe(NestedRegionLayoutStatus.Selected);
		if (attempt.status !== NestedRegionLayoutStatus.Selected) return;
		const branch = defined(attempt.regions.find(({ id }) => id === 'branch'));
		expect(branch.localLayout.elements).toHaveLength(4);
	});
});
