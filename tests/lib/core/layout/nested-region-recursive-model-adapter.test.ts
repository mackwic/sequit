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
import { nestedRegionLocalMeasurements } from '../../../../src/lib/core/layout/nested-region-local-measurements';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import {
	leafDocument,
	leafIncidentContracts,
	type RecursiveContext,
} from '../../../../src/lib/core/layout/regions/model/nested-region-recursive-model-adapter';
import { NESTED_REGION_COMPOSITION_LIMITS } from '../../../../src/lib/core/layout/regions/model/region-composition-limits';
import {
	normalizeRegionCompositionModel,
	RegionCompositionDiagnosticCode,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionIncidentRole } from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/regions/validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { depthTwoRegionDocument, depthTwoRegionInput } from './nested-region-fixture';

function solve(input: RegionInput) {
	const prepared = prepareLayoutDocument(depthTwoRegionDocument());
	return solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
}

/** A row is a row: every shape below the declared envelope must select and validate. */
function expectSelectedRow(input: RegionInput) {
	const prepared = prepareLayoutDocument(depthTwoRegionDocument());
	const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	expect(attempt.status).toBe(RegionCompositionStatus.Selected);
	if (attempt.status !== RegionCompositionStatus.Selected) return undefined;
	const normalized = normalizeRegionCompositionModel(
		prepared.graph,
		input,
		NESTED_REGION_COMPOSITION_LIMITS,
	);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error(normalized.diagnostic.message);
	expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
	expect(validateNestedRegionLeafIncidents(normalized.model, attempt)).toBeUndefined();
	return attempt;
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
			(input: RegionInput) => ({
				...input,
				regions: [...input.regions, { id: 'left', parentId: 'branch', layoutOrder: 'z' }],
			}),
			RegionCompositionDiagnosticCode.DuplicateRegionId,
		],
		[
			'an empty region identity',
			(input: RegionInput) => ({
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
			(input: RegionInput) => ({
				...input,
				regions: [...input.regions, { id: 'second-root', layoutOrder: 'z' }],
			}),
			RegionCompositionDiagnosticCode.InvalidRootCount,
		],
		[
			'an unknown parent',
			(input: RegionInput) => ({
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
			(input: RegionInput) => ({
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
			(input: RegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId].filter(([id]) => id !== 'c')),
			}),
			RegionCompositionDiagnosticCode.MissingEndpointAssignment,
		],
		[
			'an extra node assignment',
			(input: RegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId, ['ghost', 'left']]),
			}),
			RegionCompositionDiagnosticCode.UnknownEndpointAssignment,
		],
		[
			'a substituted node assignment',
			(input: RegionInput) => ({
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
			(input: RegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId, ['c', 'absent']]),
			}),
			RegionCompositionDiagnosticCode.UnknownRegionAssignment,
		],
		[
			'a node owned by an internal region',
			(input: RegionInput) => ({
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

	it('selects a single-child row as a pass-through frame', () => {
		const input = depthTwoRegionInput();
		const passThrough: RegionInput = {
			...input,
			regions: input.regions.filter(({ id }) => id !== 'middle' && id !== 'branch-right'),
			regionByEndpointId: new Map(
				[...input.regionByEndpointId].map(([id, regionId]) => {
					if (regionId === 'middle' || regionId === 'branch-right') return [id, 'left'];
					return [id, regionId];
				}),
			),
		};
		const attempt = expectSelectedRow(passThrough);
		expect(attempt?.regions.filter(({ parentId }) => parentId === 'branch')).toHaveLength(1);
	});

	it('selects a five-child row and its single-child root frame', () => {
		const input = depthTwoRegionInput();
		const wider: RegionInput = {
			...input,
			regions: input.regions.map((region) => {
				if (region.id === 'right' || region.id === 'far-right')
					return { ...region, parentId: 'branch' };
				return region;
			}),
		};
		const attempt = expectSelectedRow(wider);
		expect(attempt?.regions.filter(({ parentId }) => parentId === 'branch')).toHaveLength(5);
		expect(attempt?.regions.filter(({ parentId }) => parentId === '@root')).toHaveLength(1);
	});

	it('reports a declared children budget beyond the configured bound', () => {
		const input = depthTwoRegionInput();
		const wide: RegionInput = {
			...input,
			regions: [
				...input.regions,
				...Array.from({ length: 6 }, (_, index) => ({
					id: `spare-${index}`,
					parentId: '@root',
					layoutOrder: orderKey(`a${'6789AB'.charAt(index)}`),
				})),
			],
		};
		const normalized = normalizeRegionCompositionModel(
			prepareLayoutDocument(depthTwoRegionDocument()).graph,
			wide,
			NESTED_REGION_COMPOSITION_LIMITS,
		);
		expect(normalized).toMatchObject({
			status: RegionCompositionModelStatus.Unsupported,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.ResourceLimit,
				path: ['regions', '@root', 'children'],
				actual: 9,
				limit: 8,
			},
		});
		expect(solve(wide)).toEqual({
			status: RegionCompositionStatus.Unsupported,
			reason: 'children exceed the configured limit of 8.',
		});
	});
	it('bounds deep pass-through chains before recursive solving', () => {
		const prepared = prepareLayoutDocument(depthTwoRegionDocument());
		const endpointIds = [...prepared.graph.endpointsById.keys()];
		const maxRegions = NESTED_REGION_COMPOSITION_LIMITS.maxRegions ?? 0;
		const inputAtLimit: RegionInput = {
			regions: Array.from({ length: maxRegions }, (_, index) => {
				const region: RegionInput['regions'][number] = {
					id: `depth-${index}`,
					layoutOrder: 'a0',
				};
				if (index > 0) return { ...region, parentId: `depth-${index - 1}` };
				return region;
			}),
			regionByEndpointId: new Map(endpointIds.map((id) => [id, `depth-${maxRegions - 1}`])),
		};
		expect(
			solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, inputAtLimit).status,
		).toBe(RegionCompositionStatus.Selected);

		const tooDeep: RegionInput = {
			...inputAtLimit,
			regions: Array.from({ length: 5000 }, (_, index) => {
				const region: RegionInput['regions'][number] = {
					id: `deep-${index}`,
					layoutOrder: 'a0',
				};
				if (index > 0) return { ...region, parentId: `deep-${index - 1}` };
				return region;
			}),
			regionByEndpointId: new Map(endpointIds.map((id) => [id, 'deep-4999'])),
		};
		const rejected = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			tooDeep,
		);
		const normalized = normalizeRegionCompositionModel(
			prepared.graph,
			tooDeep,
			NESTED_REGION_COMPOSITION_LIMITS,
		);
		expect(normalized).toMatchObject({
			status: RegionCompositionModelStatus.Unsupported,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.ResourceLimit,
				path: ['regions'],
				actual: 5000,
				limit: maxRegions,
			},
		});
		expect(rejected).toMatchObject({
			status: RegionCompositionStatus.Unsupported,
			reason: `regions exceed the configured limit of ${maxRegions}.`,
		});
	});

	it.each([
		[
			'four top-level children',
			(input: RegionInput) => ({
				...input,
				regions: [...input.regions, { id: 'extra', parentId: '@root', layoutOrder: 'z' }],
			}),
		],
		[
			'four grandchildren',
			(input: RegionInput) => ({
				...input,
				regions: [...input.regions, { id: 'fourth', parentId: 'branch', layoutOrder: 'z' }],
			}),
		],
		[
			'an empty leaf',
			(input: RegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId, ['b', 'left']]),
			}),
		],
	] as const)('reports an unendpointed leaf for %s', (_, change) => {
		const attempt = solve(change(depthTwoRegionInput()));
		expect(attempt.status).toBe(RegionCompositionStatus.Unsupported);
		if (attempt.status !== RegionCompositionStatus.Unsupported) return;
		expect(attempt.reason).toContain('leaf region must own an endpoint');
	});

	it('normalizes a third level without a depth limit', () => {
		const prepared = prepareLayoutDocument(depthTwoRegionDocument());
		const input = depthTwoRegionInput();
		const deeper: RegionInput = {
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
		expect(attempt.status).toBe(RegionCompositionStatus.Unsupported);
		if (attempt.status !== RegionCompositionStatus.Unsupported) return;
		expect(attempt.reason).toContain('crossings exceed the configured limit of 3');
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
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
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
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
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
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		const branch = defined(attempt.regions.find(({ id }) => id === 'branch'));
		expect(branch.localLayout.elements).toHaveLength(4);
	});
});
