import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	leafDocument,
	leafIncidentContracts,
	type RecursiveContext,
} from '../../../../src/lib/core/layout/regions/composition/nested-region-recursive-model-adapter';
import {
	checkRegionStackDepth,
	NESTED_REGION_COMPOSITION_WORK_BUDGETS,
	RegionCompositionWork,
} from '../../../../src/lib/core/layout/regions/model/region-composition-limits';
import {
	normalizeRegionCompositionModel,
	RegionCompositionDiagnosticCode,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import { RegionWorkPhase } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	RegionCompositionStatus,
	type RegionInput,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	incidentEndpointPositions,
	RegionIncidentRole,
} from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { nestedRegionLocalMeasurements } from '../../../../src/lib/core/layout/regions/recursive/nested-region-local-measurements';
import {
	solveRecursiveNestedRegionLayout,
	solveRecursiveNestedRegionLayoutWithWork,
} from '../../../../src/lib/core/layout/regions/recursive/nested-region-recursive-layout';
import { validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/regions/validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	independentNodes,
	rowOf,
	shallowForestOf,
} from '../../../support/performance/layout-resource-scenarios';
import { persistedGridDocument } from './grid-cell-fixture';
import {
	depthTwoRegionDocument,
	depthTwoRegionInput,
	persistedNestedGridDocument,
} from './nested-region-fixture';

function solve(input: RegionInput) {
	const prepared = prepareLayoutDocument(depthTwoRegionDocument());
	return solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
}

/** An accepted row publishes a complete and independently validated geometry. */
function expectSelectedRow(input: RegionInput) {
	const prepared = prepareLayoutDocument(depthTwoRegionDocument());
	const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	expect(attempt.status).toBe(RegionCompositionStatus.Selected);
	if (attempt.status !== RegionCompositionStatus.Selected) return undefined;
	const normalized = normalizeRegionCompositionModel(prepared.graph, input);
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
			endpointPositions: incidentEndpointPositions(prepared.graph.document),
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
			endpointPositions: incidentEndpointPositions(prepared.graph.document),
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

	it.each([9, 13])('selects a low-work row with %i populated children', (count) => {
		const { document, input } = rowOf(count);
		const prepared = prepareLayoutDocument(document);
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready) throw new Error('Invalid row');
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		expect(attempt.regions).toHaveLength(count);
	});

	it.each([100, 600])('selects and validates a wide row of %i children', (count) => {
		const { document, input } = rowOf(count);
		const prepared = prepareLayoutDocument(document);
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		let reason: string | undefined;
		if (attempt.status === RegionCompositionStatus.Unsupported) reason = attempt.reason;
		expect(attempt.status, reason).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready) throw new Error('Invalid row');
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		expect(attempt.regions).toHaveLength(count);
	});

	it.each([0, 1, 2, 3])('charges each child placement before work at limit %i', (limit) => {
		const { document, input } = rowOf(2);
		const prepared = prepareLayoutDocument(document);
		const work = new RegionCompositionWork({
			...NESTED_REGION_COMPOSITION_WORK_BUDGETS,
			placements: limit,
		});
		const attempt = solveRecursiveNestedRegionLayoutWithWork(
			prepared.graph,
			prepared.measurements,
			input,
			{ work },
		);
		if (limit < 2) {
			expect(attempt).toMatchObject({
				status: RegionCompositionStatus.Unsupported,
				diagnostic: {
					code: RegionCompositionDiagnosticCode.ResourceLimit,
					phase: RegionWorkPhase.Placements,
					limit,
					actual: limit,
					exhaustive: false,
				},
			});
			expect('layout' in attempt).toBe(false);
		} else expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		expect(work.attempted(RegionWorkPhase.Placements)).toBe(Math.min(limit, 2));
	});

	it('reports a typed refusal when normalization has no comparison work', () => {
		const { document, input } = rowOf(9);
		const prepared = prepareLayoutDocument(document);
		const work = new RegionCompositionWork({
			...NESTED_REGION_COMPOSITION_WORK_BUDGETS,
			normalizationComparisons: 0,
		});
		const attempt = solveRecursiveNestedRegionLayoutWithWork(
			prepared.graph,
			prepared.measurements,
			input,
			{ work },
		);
		expect(attempt).toMatchObject({
			status: RegionCompositionStatus.Unsupported,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.ResourceLimit,
				phase: RegionWorkPhase.NormalizationComparisons,
				limit: 0,
				exhaustive: false,
			},
		});
		expect('layout' in attempt).toBe(false);
	});

	it('reports a typed refusal before unbudgeted sibling geometry is published', () => {
		const { document, input } = rowOf(9);
		const prepared = prepareLayoutDocument(document);
		const work = new RegionCompositionWork({
			...NESTED_REGION_COMPOSITION_WORK_BUDGETS,
			comparisons: 0,
		});
		const attempt = solveRecursiveNestedRegionLayoutWithWork(
			prepared.graph,
			prepared.measurements,
			input,
			{ work },
		);
		expect(attempt).toMatchObject({
			status: RegionCompositionStatus.Unsupported,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.ResourceLimit,
				phase: RegionWorkPhase.Comparisons,
				limit: 0,
				exhaustive: false,
			},
		});
		expect('layout' in attempt).toBe(false);
	});

	it('selects a shallow forest of 265 regions without a shape quota', () => {
		const { document, input } = shallowForestOf(192);
		const prepared = prepareLayoutDocument(document);
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready) throw new Error('Invalid forest');
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		expect(attempt.regions).toHaveLength(264);
	});

	it('selects seventeen independent local relations across populated leaves', () => {
		const document = independentNodes(34);
		const populated = rowOf(17).input;
		const input: RegionInput = {
			...populated,
			regionByEndpointId: new Map(
				document.nodes.map((node, index) => [node.id, `child-${Math.floor(index / 2)}`]),
			),
		};
		const prepared = prepareLayoutDocument({
			...document,
			relations: Array.from({ length: 17 }, (_, index) => ({
				id: `local-${index}`,
				from: `node-${index * 2}`,
				to: `node-${index * 2 + 1}`,
			})),
		});
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Invalid relations');
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		expect(attempt.layout.relations).toHaveLength(17);
	});

	it('selects four disjoint inter-region traversals', () => {
		const { document, input } = rowOf(8);
		const prepared = prepareLayoutDocument({
			...document,
			relations: Array.from({ length: 4 }, (_, index) => ({
				id: `crossing-${index}`,
				from: `node-${index * 2}`,
				to: `node-${index * 2 + 1}`,
			})),
		});
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Invalid traversals');
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		expect(attempt.layout.relations).toHaveLength(4);
	});

	it.each([191, 192, 193])('diagnoses recursive stack depth at %i levels', (depth) => {
		const prepared = prepareLayoutDocument(depthTwoRegionDocument());
		const input: RegionInput = {
			regions: Array.from({ length: depth }, (_, index) => {
				const region: RegionInput['regions'][number] = { id: `depth-${index}`, layoutOrder: 'a0' };
				if (index > 0) return { ...region, parentId: `depth-${index - 1}` };
				return region;
			}),
			regionByEndpointId: new Map(
				[...prepared.graph.endpointsById.keys()].map((id) => [id, `depth-${depth - 1}`]),
			),
		};
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Invalid witness');
		const diagnostic = checkRegionStackDepth(
			normalized.model.preorderIds,
			normalized.model.regionsById,
		);
		if (depth <= 192) expect(diagnostic).toBeUndefined();
		else
			expect(diagnostic).toEqual({
				code: RegionCompositionDiagnosticCode.StackDepthLimit,
				message: 'Recursive region stack depth 193 exceeds the safe limit of 192.',
				path: ['regions', 'depth-192', 'depth'],
				actual: 193,
				limit: 192,
			});
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (depth <= 192) expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		else
			expect(attempt).toMatchObject({
				status: RegionCompositionStatus.Unsupported,
				reason: 'Recursive region stack depth 193 exceeds the safe limit of 192.',
				diagnostic: { code: RegionCompositionDiagnosticCode.StackDepthLimit },
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
	] as const)('keeps an unendpointed non-grid leaf outside the policy for %s', (_, change) => {
		for (const direction of Object.values(LayoutDirection)) {
			const document = depthTwoRegionDocument();
			const prepared = prepareLayoutDocument({
				...document,
				layout: defined(
					layoutConfiguration(direction, LayoutBias.Top) ??
						layoutConfiguration(direction, LayoutBias.Left),
				),
			});
			const attempt = solveRecursiveNestedRegionLayout(
				prepared.graph,
				prepared.measurements,
				change(depthTwoRegionInput()),
			);
			expect(attempt).toMatchObject({
				status: RegionCompositionStatus.Unsupported,
				reason: 'Each leaf region must own an endpoint.',
			});
		}
	});

	it.each(Object.values(LayoutDirection))(
		'honestly refuses an entirely empty grid in %s',
		(direction) => {
			const base = persistedGridDocument();
			const document = {
				...base,
				layout: defined(
					layoutConfiguration(direction, LayoutBias.Top) ??
						layoutConfiguration(direction, LayoutBias.Left),
				),
				nodes: [],
				groups: [],
				relations: [],
			};
			const prepared = prepareLayoutDocument(document);
			const attempt = solveRecursiveNestedRegionLayout(
				prepared.graph,
				prepared.measurements,
				nestedRegionInput(prepared.graph),
			);
			expect(attempt).toMatchObject({
				status: RegionCompositionStatus.Unsupported,
				reason: 'An entirely empty grid is not supported; at least one cell must own an endpoint.',
			});
		},
	);

	it.each(Object.values(LayoutDirection))(
		'does not misdiagnose descendant cell content as an entirely empty grid in %s',
		(direction) => {
			const base = persistedNestedGridDocument();
			const presentation = base.regionPresentation;
			const document = {
				...base,
				layout: defined(
					layoutConfiguration(direction, LayoutBias.Top) ??
						layoutConfiguration(direction, LayoutBias.Left),
				),
				regionPresentation: {
					...presentation,
					regions: [
						...presentation.regions,
						{
							id: 'a-inner',
							parentId: 'a',
							layoutOrder: orderKey('a0'),
							policy: LayoutPolicy.Layered,
						},
					],
				},
				nodes: base.nodes
					.filter(({ id }) => id.startsWith('a-') || id === 'outside')
					.map((node) => {
						if (node.regionId === 'a') return { ...node, regionId: 'a-inner' };
						return node;
					}),
				relations: base.relations.filter(({ id }) => id === 'inside-a'),
			};
			const prepared = prepareLayoutDocument(document);
			expect(
				solveRecursiveNestedRegionLayout(
					prepared.graph,
					prepared.measurements,
					nestedRegionInput(prepared.graph),
				),
			).toMatchObject({
				status: RegionCompositionStatus.Unsupported,
				reason: 'Grid cells with child regions are outside the bounded grid policy.',
			});
		},
	);

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
