import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validatedBridges } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import {
	RegionCompositionWork,
	regionCompositionWorkBudgets,
} from '../../../../src/lib/core/layout/regions/model/region-composition-limits';
import {
	RegionCompositionDiagnosticCode,
	RegionCompositionStatus,
	type RegionInput,
	RegionWorkPhase,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	RegionIncidentRejectionCode,
	RegionIncidentUnknownCode,
} from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { RegionSearchProvenance } from '../../../../src/lib/core/layout/regions/model/region-search-evidence';
import { solveRegionSubtreeAttempts } from '../../../../src/lib/core/layout/regions/recursive/region-partial-composition';
import {
	REGION_SUBTREE_CALCULATION_FAILED,
	RegionSubtreeScope,
} from '../../../../src/lib/core/layout/regions/recursive/region-partial-composition-types';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import {
	regionLanePartialDocument,
	regionLanePartialSubtreeDocument,
} from '../../../support/builders/region-lane-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { independentNodes, rowOf } from '../../../support/performance/layout-resource-scenarios';
import { depthTwoRegionDocument, regionDocument } from './nested-region-fixture';

function attemptsFor(
	document: LogicDocument,
	cache = new RegionLocalLayoutCache(),
	measurements = prepareLayoutDocument(document).measurements,
) {
	const { graph } = prepareLayoutDocument(document);
	return solveRegionSubtreeAttempts({
		graph,
		measurements,
		input: nestedRegionInput(graph),
		cache,
	});
}

describe('region partial composition', () => {
	it('retains a completed sibling and diagnoses later shared-work exhaustion', () => {
		const source = independentNodes(49);
		const document = {
			...source,
			relations: [
				{ id: 'heavy-route', from: 'node-0', to: 'node-48' },
				{ id: 'safe-route', from: 'node-46', to: 'node-47' },
			],
		};
		const input: RegionInput = {
			regions: [
				{ id: '@root', layoutOrder: '0' },
				{ id: 'heavy', parentId: '@root', layoutOrder: 'a1' },
				{ id: 'safe', parentId: '@root', layoutOrder: 'a0' },
				...Array.from({ length: 48 }, (_, index) => ({
					id: `child-${index}`,
					parentId: ['heavy', 'safe'][Number(index >= 46)] ?? 'heavy',
					layoutOrder: orderKey(`a${index.toString().padStart(3, '0')}1`),
				})),
			],
			regionByEndpointId: new Map(
				source.nodes.map((node, index) => {
					if (index === 48) return [node.id, 'child-1'];
					return [node.id, `child-${index}`];
				}),
			),
		};
		const { graph, measurements } = prepareLayoutDocument(document);
		const work = new RegionCompositionWork({
			...regionCompositionWorkBudgets(input.regions.length, graph.relations.length),
			comparisons: 128,
		});
		const attempts = solveRegionSubtreeAttempts({
			graph,
			measurements,
			input,
			cache: new RegionLocalLayoutCache(),
			work,
		});
		const safe = attempts.find(({ regionId }) => regionId === 'safe');
		expect(safe).toMatchObject({
			status: RegionCompositionStatus.Selected,
			scope: RegionSubtreeScope.ClosedSubtree,
			layout: { relations: [{ id: 'safe-route' }] },
		});
		if (safe?.status !== RegionCompositionStatus.Selected) throw new Error('Missing safe scene');
		expect(safe.layout.relations.map(({ id }) => id)).toEqual(['safe-route']);
		const heavy = attempts.find(({ regionId }) => regionId === 'heavy');
		expect(heavy).toMatchObject({
			status: RegionCompositionStatus.Unsupported,
			scope: RegionSubtreeScope.ClosedSubtree,
			diagnostic: {
				code: 'resource-limit',
				phase: RegionWorkPhase.Comparisons,
				exhaustive: false,
			},
		});
		expect(
			attempts.some(
				(attempt) =>
					attempt.status === RegionCompositionStatus.Selected &&
					attempt.layout.relations.some(({ id }) => id === 'heavy-route'),
			),
		).toBe(false);
		expect(work.attempted(RegionWorkPhase.Comparisons)).toBe(128);
	});

	it('refuses a thousand flat leaves at a bounded work limit after retaining selected leaves', () => {
		const { document, input } = rowOf(1000);
		const { graph, measurements } = prepareLayoutDocument(document);
		const work = new RegionCompositionWork({
			...regionCompositionWorkBudgets(input.regions.length, graph.relations.length),
			traversals: 10_000,
		});
		const attempts = solveRegionSubtreeAttempts({
			graph,
			measurements,
			input,
			cache: new RegionLocalLayoutCache(),
			work,
		});
		const retainedLeaf = attempts.find(({ regionId }) => regionId === 'child-0');
		expect(retainedLeaf).toMatchObject({
			status: RegionCompositionStatus.Selected,
			scope: RegionSubtreeScope.Leaf,
			document: { nodes: [{ id: 'node-0' }], relations: [] },
			layout: { elements: [{ id: 'node-0' }], relations: [] },
		});
		const exhausted = attempts.at(-1);
		if (exhausted === undefined) throw new Error('Missing resource-limit failure');
		expect(exhausted).toMatchObject({
			status: RegionCompositionStatus.Unsupported,
			diagnostic: {
				code: 'resource-limit',
				phase: RegionWorkPhase.Traversals,
				limit: 10_000,
				exhaustive: false,
			},
			endpointIds: [],
			relationIds: [],
		});
		expect(exhausted.regionId).toMatch(/^child-\d+$/);
		if (retainedLeaf?.status !== RegionCompositionStatus.Selected)
			throw new Error('Missing previously validated leaf');
		expect(exhausted.regionId).not.toBe(retainedLeaf.regionId);
		expect(
			attempts.filter(
				(attempt) =>
					attempt.status === RegionCompositionStatus.Unsupported &&
					attempt.diagnostic?.code === RegionCompositionDiagnosticCode.ResourceLimit,
			),
		).toEqual([exhausted]);
		expect(exhausted).not.toHaveProperty('layout');
		expect(work.attempted(RegionWorkPhase.Traversals)).toBe(10_000);
	});
	it('reports an unsupported leaf beside the current independent leaf', () => {
		const attempts = attemptsFor(regionLanePartialDocument(true));
		expect(attempts).toMatchObject([
			{
				status: RegionCompositionStatus.Unsupported,
				regionId: 'shared',
				scope: RegionSubtreeScope.Leaf,
				reason: 'Junctions are outside the first shared layout policy.',
				endpointIds: ['delivery', 'gate', 'request'],
				relationIds: ['first-handoff'],
			},
			{
				status: RegionCompositionStatus.Selected,
				regionId: 'ordinary',
				scope: RegionSubtreeScope.Leaf,
				document: {
					nodes: [{ id: 'neighbor', markdown: 'Neighbor\n' }],
					relations: [],
				},
			},
		]);
	});

	it('selects a validated closed branch with its whole internal route and covers descendants', () => {
		const attempts = attemptsFor(regionLanePartialSubtreeDocument(true));
		expect(attempts.map(({ regionId }) => regionId)).toEqual(['branch', 'shared']);
		const branch = attempts[0];
		expect(branch).toMatchObject({
			status: RegionCompositionStatus.Selected,
			regionId: 'branch',
			scope: RegionSubtreeScope.ClosedSubtree,
		});
		if (branch?.status !== RegionCompositionStatus.Selected)
			throw new Error('Expected a selected closed branch');
		expect(branch.document.nodes.map(({ id }) => id).sort()).toEqual(['mate-node', 'neighbor']);
		expect(branch.layout.regions?.map(({ id }) => id).sort()).toEqual(['mate', 'ordinary']);
		expect(branch.layout.relations).toMatchObject([
			{ id: 'inside-branch', from: 'neighbor', to: 'mate-node' },
		]);
		expect(branch.layout.relations[0]?.points.length).toBeGreaterThan(1);
	});

	it('omits an open branch and incident leaves rather than publishing partial routes', () => {
		const source = regionLanePartialSubtreeDocument(true);
		const document: LogicDocument = {
			...source,
			relations: [...source.relations, { id: 'leaves-branch', from: 'mate-node', to: 'delivery' }],
		};
		const attempts = attemptsFor(document);
		expect(attempts.find(({ regionId }) => regionId === 'branch')).toBeUndefined();
		expect(attempts.some(({ status }) => status === RegionCompositionStatus.Selected)).toBe(false);
	});

	it('attempts healthy descendants after a closed branch fails', () => {
		const source = regionLanePartialSubtreeDocument(true);
		const document: LogicDocument = {
			...source,
			nodes: source.nodes.filter(({ id }) => id !== 'mate-node'),
			relations: source.relations.filter(({ id }) => id !== 'inside-branch'),
		};
		const attempts = attemptsFor(document);
		const branch = attempts.find(({ regionId }) => regionId === 'branch');
		expect(branch?.status).not.toBe(RegionCompositionStatus.Selected);
		expect(attempts.find(({ regionId }) => regionId === 'ordinary')).toMatchObject({
			status: RegionCompositionStatus.Selected,
			scope: RegionSubtreeScope.Leaf,
			layout: { elements: [{ id: 'neighbor' }], relations: [] },
		});
	});
	it('preserves bounded blocked-incident evidence for a closed subtree', () => {
		const source = depthTwoRegionDocument();
		const template = source.nodes.find(({ id }) => id === 'c');
		if (template === undefined) throw new Error('Expected a node template.');
		const sourceIds = Array.from({ length: 4 }, (_, index) => `n${index}`);
		const targetIds = Array.from({ length: 3 }, (_, index) => `t${index}`);
		const endpointIds = [...sourceIds, ...targetIds, 'middle-node', 'outside-node'];
		const document: LogicDocument = {
			...source,
			nodes: endpointIds.map((id, index) => ({
				...template,
				id,
				markdown: `${id}\n`,
				layoutOrder: orderKey(`a${index}`),
			})),
			relations: [
				...sourceIds.slice(1).map((id, index) => ({
					id: `local-${index}`,
					from: defined(sourceIds[index]),
					to: id,
				})),
				{ id: 'local-wide', from: 'n0', to: 'n3' },
				...sourceIds.slice(0, 3).map((id, index) => ({
					id: `cross-${index}`,
					from: id,
					to: defined(targetIds[index]),
				})),
			],
		};
		const input: RegionInput = {
			regions: [
				{ id: '@root', layoutOrder: '0' },
				{ id: 'branch', parentId: '@root', layoutOrder: 'a' },
				{ id: 'left', parentId: 'branch', layoutOrder: 'a' },
				{ id: 'middle', parentId: 'branch', layoutOrder: 'b' },
				{ id: 'far', parentId: 'branch', layoutOrder: 'c' },
				{ id: 'outside', parentId: '@root', layoutOrder: 'b' },
			],
			regionByEndpointId: new Map([
				...sourceIds.map((id) => [id, 'left'] as const),
				...targetIds.map((id) => [id, 'far'] as const),
				['middle-node', 'middle'],
				['outside-node', 'outside'],
			]),
		};
		const { graph, measurements } = prepareLayoutDocument(document);
		const attempts = solveRegionSubtreeAttempts({
			graph,
			measurements,
			input,
			cache: new RegionLocalLayoutCache(),
		});
		const attempt = attempts.find(
			({ scope, status }) =>
				scope === RegionSubtreeScope.ClosedSubtree && status === RegionCompositionStatus.Unknown,
		);
		if (attempt?.status !== RegionCompositionStatus.Unknown)
			throw new Error('Expected an unknown closed subtree.');
		if (attempt.witness === undefined) throw new Error('Expected incident search evidence.');
		expect(attempt).toMatchObject({
			provenance: RegionSearchProvenance.Incident,
			code: RegionIncidentUnknownCode.SearchBudgetExceeded,
			witness: { attempted: 1024, exhaustive: false },
		});
		expect(
			attempt.witness.rejectedAlternatives.some(
				({ code }) => code === RegionIncidentRejectionCode.RouteObstructed,
			),
		).toBe(true);
	});
	it('preserves lane geometry when composing a closed row', () => {
		const source = regionLanePartialSubtreeDocument(false);
		const presentation = defined(source.regionPresentation);
		const document: LogicDocument = {
			...source,
			regionPresentation: {
				...presentation,
				regions: presentation.regions.map((region) => {
					if (region.id !== 'shared') return region;
					return { ...region, parentId: 'branch', layoutOrder: orderKey('a2') };
				}),
			},
		};
		const branch = attemptsFor(document).find(({ regionId }) => regionId === 'branch');
		if (branch?.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected a selected closed branch; status=${branch?.status}`);
		expect(branch.scope).toBe(RegionSubtreeScope.ClosedSubtree);
		expect(branch.layout.lanes?.map(({ id }) => id)).toEqual(['sales', 'service']);
	});

	it('reports a typed unsupported closed branch containing a shared-lane leaf', () => {
		const source = regionLanePartialSubtreeDocument(true);
		const presentation = source.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const document: LogicDocument = {
			...source,
			relations: source.relations.filter(({ id }) => id !== 'inside-branch'),
			regionPresentation: {
				...presentation,
				regions: presentation.regions.map((region) => {
					if (region.id === 'shared')
						return {
							...region,
							parentId: 'branch',
							layoutOrder: orderKey('a1'),
						};
					if (region.id === 'mate') {
						const rootSibling = { ...region };
						Reflect.deleteProperty(rootSibling, 'parentId');
						return rootSibling;
					}
					return region;
				}),
			},
		};
		const attempts = attemptsFor(document);
		expect(attempts.find(({ regionId }) => regionId === 'branch')).toMatchObject({
			status: RegionCompositionStatus.Unsupported,
			scope: RegionSubtreeScope.ClosedSubtree,
			reason: 'Junctions are outside the first shared layout policy.',
			endpointIds: ['delivery', 'gate', 'neighbor', 'request'],
			relationIds: ['first-handoff'],
		});
		expect(attempts.find(({ regionId }) => regionId === 'shared')).toMatchObject({
			status: RegionCompositionStatus.Unsupported,
			scope: RegionSubtreeScope.Leaf,
			reason: 'Junctions are outside the first shared layout policy.',
			endpointIds: ['delivery', 'gate', 'request'],
		});
		expect(attempts.find(({ regionId }) => regionId === 'mate')).toMatchObject({
			status: RegionCompositionStatus.Selected,
			scope: RegionSubtreeScope.Leaf,
		});
	});

	it('bridges two crossing routes wholly inside a branch', () => {
		const source = regionDocument();
		const document: LogicDocument = {
			...source,
			relations: [
				{ id: 'across-middle', from: 'a-target', to: 'c' },
				{ id: 'b-to-a', from: 'b', to: 'a-target' },
			],
		};
		const input: RegionInput = {
			regions: [
				{ id: '@root', layoutOrder: 'a0', policy: LayoutPolicy.Layered },
				{
					id: 'branch',
					parentId: '@root',
					layoutOrder: 'a0',
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'outside',
					parentId: '@root',
					layoutOrder: 'a1',
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'left',
					parentId: 'branch',
					layoutOrder: 'a0',
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'middle',
					parentId: 'branch',
					layoutOrder: 'a1',
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'right',
					parentId: 'branch',
					layoutOrder: 'a2',
					policy: LayoutPolicy.Layered,
				},
			],
			regionByEndpointId: new Map([
				['a-source', 'outside'],
				['a-target', 'left'],
				['b', 'middle'],
				['c', 'right'],
			]),
		};
		const { graph, measurements } = prepareLayoutDocument(document);
		const attempts = solveRegionSubtreeAttempts({
			graph,
			measurements,
			input,
			cache: new RegionLocalLayoutCache(),
		});
		const branch = attempts.find(({ regionId }) => regionId === 'branch');
		expect(branch).toMatchObject({
			status: RegionCompositionStatus.Selected,
			scope: RegionSubtreeScope.ClosedSubtree,
			regionId: 'branch',
		});
		if (branch?.status !== RegionCompositionStatus.Selected)
			throw new Error('Expected a selected branch subtree');
		expect(validatedBridges(branch.layout.relations).length).toBeGreaterThan(0);
		expect(attempts.find(({ regionId }) => regionId === 'outside')?.status).toBe(
			RegionCompositionStatus.Selected,
		);
	});

	it('selects a closed four-child branch and still attempts independent leaves', () => {
		const source = regionDocument();
		const template = source.nodes.find(({ id }) => id === 'c');
		if (template === undefined) throw new Error('Expected node template');
		const document: LogicDocument = {
			...source,
			nodes: [
				...source.nodes,
				{ ...template, id: 'd', markdown: 'D\n', layoutOrder: orderKey('a4') },
			],
		};
		const input: RegionInput = {
			regions: [
				{ id: '@root', layoutOrder: 'a0', policy: LayoutPolicy.Layered },
				{
					id: 'branch',
					parentId: '@root',
					layoutOrder: 'a0',
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'outside',
					parentId: '@root',
					layoutOrder: 'a1',
					policy: LayoutPolicy.Layered,
				},
				...(['left', 'second', 'middle', 'right'] as const).map((id, index) => ({
					id,
					parentId: 'branch',
					layoutOrder: orderKey(`a${index}`),
					policy: LayoutPolicy.Layered,
				})),
			],
			regionByEndpointId: new Map([
				['a-source', 'left'],
				['a-target', 'second'],
				['b', 'middle'],
				['c', 'right'],
				['d', 'outside'],
			]),
		};
		const { graph, measurements } = prepareLayoutDocument(document);
		const attempts = solveRegionSubtreeAttempts({
			graph,
			measurements,
			input,
			cache: new RegionLocalLayoutCache(),
		});
		const branch = attempts.find(({ regionId }) => regionId === 'branch');
		expect(branch).toMatchObject({
			status: RegionCompositionStatus.Selected,
			scope: RegionSubtreeScope.ClosedSubtree,
			regionId: 'branch',
		});
		if (branch?.status !== RegionCompositionStatus.Selected)
			throw new Error('Expected a selected four-child branch');
		expect(branch.layout.regions?.map(({ id }) => id).sort()).toEqual([
			'left',
			'middle',
			'right',
			'second',
		]);
		expect(attempts.find(({ regionId }) => regionId === 'outside')?.status).toBe(
			RegionCompositionStatus.Selected,
		);
	});

	it('marks a shared-lane leaf with an inherited group unsupported without hiding its sibling', () => {
		const source = regionLanePartialDocument(false);
		const group = {
			kind: EndpointKind.Group,
			id: 'shared-group',
			label: 'Shared group',
			regionId: 'shared',
			laneId: 'sales',
			layoutOrder: orderKey('a5'),
		} satisfies LogicDocument['groups'][number];
		const document: LogicDocument = {
			...source,
			groups: [group],
			nodes: source.nodes.map((node) => {
				if (node.id !== 'request') return node;
				const member = { ...node, groupId: group.id };
				delete member.regionId;
				delete member.laneId;
				return member;
			}),
		};
		const attempts = attemptsFor(document);
		expect(attempts.find(({ regionId }) => regionId === 'shared')).toMatchObject({
			status: RegionCompositionStatus.Unsupported,
			scope: RegionSubtreeScope.Leaf,
			endpointIds: ['delivery', 'request', 'shared-group'],
			relationIds: ['first-handoff'],
		});
		expect(attempts.find(({ regionId }) => regionId === 'ordinary')?.status).toBe(
			RegionCompositionStatus.Selected,
		);
	});

	it('keeps a typed failed branch and unresolved sibling when branch measurements are missing', () => {
		const document = regionLanePartialSubtreeDocument(true);
		const measured = prepareLayoutDocument(document).measurements;
		const nodes = new Map(measured.nodes);
		nodes.delete('neighbor');
		const attempts = attemptsFor(document, new RegionLocalLayoutCache(), {
			...measured,
			nodes,
		});
		expect(attempts.find(({ regionId }) => regionId === 'branch')).toMatchObject({
			status: REGION_SUBTREE_CALCULATION_FAILED,
			scope: RegionSubtreeScope.ClosedSubtree,
			endpointIds: ['mate-node', 'neighbor'],
			relationIds: ['inside-branch'],
		});
		expect(attempts.find(({ regionId }) => regionId === 'shared')?.status).toBe(
			RegionCompositionStatus.Unsupported,
		);
		expect(attempts.find(({ regionId }) => regionId === 'ordinary')).toBeUndefined();
	});

	it('reports calculation failure with canonical identifiers when a leaf lacks measurements', () => {
		const document = regionLanePartialDocument(true);
		const measured = prepareLayoutDocument(document).measurements;
		const nodes = new Map(measured.nodes);
		nodes.delete('neighbor');
		const attempts = attemptsFor(document, new RegionLocalLayoutCache(), {
			...measured,
			nodes,
		});
		expect(attempts.find(({ regionId }) => regionId === 'ordinary')).toMatchObject({
			status: REGION_SUBTREE_CALCULATION_FAILED,
			scope: RegionSubtreeScope.Leaf,
			endpointIds: ['neighbor'],
			relationIds: [],
		});
	});

	it('uses the current source and gives the same result with a warm or cold cache', () => {
		const cache = new RegionLocalLayoutCache();
		attemptsFor(regionLanePartialSubtreeDocument(false), cache);
		const unresolved = regionLanePartialSubtreeDocument(true);
		expect(attemptsFor(unresolved, cache)).toEqual(attemptsFor(unresolved));
		const edited: LogicDocument = {
			...unresolved,
			nodes: unresolved.nodes.map((node) => {
				if (node.id !== 'mate-node') return node;
				return { ...node, markdown: 'Current mate\n' };
			}),
		};
		const warm = attemptsFor(edited, cache);
		expect(warm).toEqual(attemptsFor(edited));
		expect(warm.find(({ regionId }) => regionId === 'branch')).toMatchObject({
			status: RegionCompositionStatus.Selected,
			document: {
				nodes: [{ id: 'neighbor' }, { id: 'mate-node', markdown: 'Current mate\n' }],
			},
		});
	});

	it('returns no subtree attempts for invalid region ownership', () => {
		const source = regionLanePartialSubtreeDocument(true);
		const document: LogicDocument = {
			...source,
			nodes: source.nodes.map((node) => {
				if (node.id !== 'mate-node') return node;
				return { ...node, regionId: 'branch' };
			}),
		};
		expect(attemptsFor(document)).toEqual([]);
	});
});
