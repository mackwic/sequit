import { describe, expect, it } from 'vitest';

import { defined, LayoutPolicy } from '../../../../src/lib/core/document/logic-document';
import { createGraph, type LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import { regionLeafPolicy } from '../../../../src/lib/core/layout/regions/leaf/region-leaf-policy';
import {
	NESTED_REGION_COMPOSITION_WORK_BUDGETS,
	RegionCompositionWork,
} from '../../../../src/lib/core/layout/regions/model/region-composition-limits';
import {
	normalizeRegionCompositionModel,
	RegionCompositionDiagnosticCode,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import type { RegionInput } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionWorkPhase } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { regionLaneDocument } from '../../../support/builders/region-lane-document';
import { gridDocument, gridInput } from './grid-cell-fixture';
import {
	depthTwoRegionDocument,
	depthTwoRegionInput,
	nestedRegionInput,
	regionDocument,
} from './nested-region-fixture';

function graph(document = depthTwoRegionDocument()): LogicGraph {
	const result = createGraph(document);
	if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('; '));
	return result.value;
}

function ready(source = graph(), input = depthTwoRegionInput()) {
	const result = normalizeRegionCompositionModel(source, input);
	if (result.status !== RegionCompositionModelStatus.Ready)
		throw new Error(result.diagnostic.message);
	return result.model;
}

function thirdLevelInput(): RegionInput {
	const input = depthTwoRegionInput();
	return {
		regions: [...input.regions, { id: 'deep', parentId: 'left', layoutOrder: 'a' }],
		regionByEndpointId: new Map(
			[...input.regionByEndpointId].map(([id, regionId]) => {
				if (regionId === 'left') return [id, 'deep'];
				return [id, regionId];
			}),
		),
	};
}

describe('recursive region composition model', () => {
	it('materializes legacy leaf policies once and preserves an explicit policy despite local lanes', () => {
		const presentation = defined(
			regionLaneDocument().regionPresentation?.regions.find(({ id }) => id === 'shared')
				?.lanePresentation,
		);
		const input = nestedRegionInput();
		const model = ready(graph(regionDocument()), {
			...input,
			regions: input.regions.map((region) => {
				if (region.id === 'left') return { ...region, lanePresentation: presentation };
				if (region.id === 'middle')
					return { ...region, policy: LayoutPolicy.Layered, lanePresentation: presentation };
				return region;
			}),
		});
		expect(defined(model.regionsById.get('@root')).definition.policy).toBe(LayoutPolicy.Layered);
		const inherited = defined(model.regionsById.get('left')).definition;
		expect(inherited.policy).toBe(LayoutPolicy.SharedLanes);
		expect(regionLeafPolicy(inherited)).toBe(LayoutPolicy.SharedLanes);
		const explicit = defined(model.regionsById.get('middle')).definition;
		expect(explicit.policy).toBe(LayoutPolicy.Layered);
		expect(regionLeafPolicy(explicit)).toBe(LayoutPolicy.Layered);
	});

	it('rejects a leaf lane presentation on a region that owns children', () => {
		const lanes = defined(
			regionLaneDocument().regionPresentation?.regions.find(({ id }) => id === 'shared')
				?.lanePresentation,
		);
		const input = depthTwoRegionInput();
		const result = normalizeRegionCompositionModel(graph(), {
			...input,
			regions: input.regions.map((region) => {
				if (region.id !== 'branch') return region;
				return { ...region, lanePresentation: lanes };
			}),
		});
		expect(result).toMatchObject({
			status: RegionCompositionModelStatus.Invalid,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.NonLeafLanePresentation,
				path: ['regions', 'branch'],
			},
		});
		if (result.status === RegionCompositionModelStatus.Ready) return;
		expect(result.diagnostic.message).toContain(
			'owns child regions but declares a leaf lane presentation',
		);
	});

	it('normalizes one level with local ranks and root-owned crossings', () => {
		const model = ready(graph(regionDocument()), nestedRegionInput());
		expect(model.preorderIds).toEqual(['@root', 'left', 'middle', 'right']);
		expect(model.regionsById.get('left')).toMatchObject({
			parentId: '@root',
			childIds: [],
			depth: 1,
		});
		expect(
			model.relations.map(({ relation, ownerId, kind }) => [relation.id, ownerId, kind]),
		).toEqual([
			['inside-a', 'left', 'local'],
			['across-middle', '@root', 'crossing'],
		]);
		expect(model.localRelationsByOwner.get('left')?.map(({ id }) => id)).toEqual(['inside-a']);
		expect(model.crossingRelationsByOwner.get('@root')?.map(({ id }) => id)).toEqual([
			'across-middle',
		]);
	});

	it('assigns two-level crossings to their least common ancestor', () => {
		const model = ready();
		expect(model.regionsById.get('branch')?.childIds).toEqual(['left', 'middle', 'branch-right']);
		expect(
			model.relations.map(({ relation, ownerId, kind }) => [relation.id, ownerId, kind]),
		).toEqual([
			['inside-a', 'left', 'local'],
			['inside-branch', 'branch', 'crossing'],
			['at-root', '@root', 'crossing'],
		]);
		expect(model.crossingRelationsByOwner.get('branch')?.map(({ id }) => id)).toEqual([
			'inside-branch',
		]);
		expect(model.crossingRelationsByOwner.get('right')).toEqual([]);
	});

	it('keeps every boundary of a depth-three incident and has no depth guard', () => {
		const model = ready(graph(), thirdLevelInput());
		expect(model.regionsById.get('deep')?.depth).toBe(3);
		expect(model.leafByEndpointId.get('a-source')).toBe('deep');
		expect(model.relations.map(({ relation, ownerId }) => [relation.id, ownerId])).toEqual([
			['inside-a', 'deep'],
			['inside-branch', 'branch'],
			['at-root', '@root'],
		]);
		const incident = model.relations.find(({ relation }) => relation.id === 'inside-branch');
		expect(incident?.sourcePathToOwner).toEqual(['deep', 'left']);
		expect(incident?.targetPathToOwner).toEqual(['branch-right']);
	});

	it('is canonical under region, endpoint, relation, and assignment permutations', () => {
		const source = depthTwoRegionDocument();
		const input = depthTwoRegionInput();
		const expected = ready(graph(source), input);
		const permuted = ready(
			graph({
				...source,
				nodes: [...source.nodes].reverse(),
				relations: [...source.relations].reverse(),
			}),
			{
				regions: [...input.regions].reverse(),
				regionByEndpointId: new Map([...input.regionByEndpointId].reverse()),
			},
		);
		expect(permuted).toEqual(expected);
	});

	it.each([
		[
			'duplicate region',
			(input: RegionInput) => ({
				...input,
				regions: [...input.regions, { id: 'left', parentId: '@root', layoutOrder: 'z' }],
			}),
			RegionCompositionDiagnosticCode.DuplicateRegionId,
		],
		[
			'unknown parent',
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
			'parent cycle',
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
			'multiple roots',
			(input: RegionInput) => ({
				...input,
				regions: [...input.regions, { id: 'other-root', layoutOrder: 'z' }],
			}),
			RegionCompositionDiagnosticCode.InvalidRootCount,
		],
		[
			'missing endpoint assignment',
			(input: RegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId].filter(([id]) => id !== 'c')),
			}),
			RegionCompositionDiagnosticCode.MissingEndpointAssignment,
		],
		[
			'unknown endpoint assignment',
			(input: RegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId, ['ghost', 'left']]),
			}),
			RegionCompositionDiagnosticCode.UnknownEndpointAssignment,
		],
		[
			'unknown region assignment',
			(input: RegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId, ['c', 'absent']]),
			}),
			RegionCompositionDiagnosticCode.UnknownRegionAssignment,
		],
		[
			'internal region assignment',
			(input: RegionInput) => ({
				...input,
				regionByEndpointId: new Map([...input.regionByEndpointId, ['c', 'branch']]),
			}),
			RegionCompositionDiagnosticCode.NonLeafAssignment,
		],
	] as const)('reports a structured diagnostic for %s', (_, change, code) => {
		const result = normalizeRegionCompositionModel(graph(), change(depthTwoRegionInput()));
		expect(result).toMatchObject({
			status: RegionCompositionModelStatus.Invalid,
			diagnostic: { code },
		});
		if (result.status === RegionCompositionModelStatus.Ready) return;
		expect(result.diagnostic.path.length).toBeGreaterThan(0);
		expect(result.diagnostic.message.length).toBeGreaterThan(0);
	});

	it('reports a cycle path', () => {
		const input = thirdLevelInput();
		const cycle = normalizeRegionCompositionModel(graph(), {
			...input,
			regions: input.regions.map((region) => {
				if (region.id === 'left') return { ...region, parentId: 'deep' };
				return region;
			}),
		});
		expect(cycle).toMatchObject({
			status: RegionCompositionModelStatus.Invalid,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.ParentCycle,
				cycle: ['deep', 'left', 'deep'],
			},
		});
	});
	it('keeps an indivisible group in one leaf and diagnoses a split assignment', () => {
		const input = gridInput();
		const regions: RegionInput['regions'] = [
			{ id: '@root', layoutOrder: '0' },
			...input.cells.map(({ id }) => ({
				id,
				parentId: '@root',
				layoutOrder: id,
			})),
		];
		const grouped = graph(gridDocument());
		const valid = normalizeRegionCompositionModel(grouped, {
			regions,
			regionByEndpointId: input.cellByEndpointId,
		});
		expect(valid.status).toBe(RegionCompositionModelStatus.Ready);
		const split = new Map(input.cellByEndpointId);
		split.set('b', 'a');
		expect(
			normalizeRegionCompositionModel(grouped, {
				regions,
				regionByEndpointId: split,
			}),
		).toMatchObject({
			status: RegionCompositionModelStatus.Invalid,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.SplitGroup,
				path: ['endpoints', 'b', 'regionId'],
			},
		});
	});

	it('rejects duplicate relation identities before ownership partitions can overwrite them', () => {
		const source = graph();
		const first = source.relations[0];
		if (first === undefined) throw new Error('Expected at least one relation.');
		const duplicated = { ...source, relations: [...source.relations, first] };
		expect(normalizeRegionCompositionModel(duplicated, depthTwoRegionInput())).toMatchObject({
			status: RegionCompositionModelStatus.Invalid,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.DuplicateRelationId,
				path: ['relations', first.relation.id],
			},
		});
	});

	it('rejects an empty region identity with a precise diagnostic', () => {
		const input = depthTwoRegionInput();
		expect(
			normalizeRegionCompositionModel(graph(), {
				...input,
				regions: [...input.regions, { id: '', parentId: '@root', layoutOrder: 'z' }],
			}),
		).toMatchObject({
			status: RegionCompositionModelStatus.Invalid,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.EmptyRegionId,
				path: ['regions'],
			},
		});
	});

	it('charges real relation traversal during normalization before partitioning', () => {
		const work = new RegionCompositionWork({
			...NESTED_REGION_COMPOSITION_WORK_BUDGETS,
			traversals: 1,
		});
		const normalized = normalizeRegionCompositionModel(graph(), depthTwoRegionInput(), work);
		expect(normalized).toMatchObject({
			status: RegionCompositionModelStatus.Unsupported,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.ResourceLimit,
				phase: RegionWorkPhase.Traversals,
				actual: 1,
				limit: 1,
				exhaustive: false,
			},
		});
		expect(work.attempted(RegionWorkPhase.Traversals)).toBe(1);
	});

	it.each([-1, 1.5, Number.NaN])('rejects invalid work budget %s', (traversals) => {
		expect(
			() => new RegionCompositionWork({ ...NESTED_REGION_COMPOSITION_WORK_BUDGETS, traversals }),
		).toThrow('Region composition budgets must be non-negative safe integers.');
	});
});
