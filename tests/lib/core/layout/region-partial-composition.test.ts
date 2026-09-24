import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	RegionCompositionStatus,
	type RegionInput,
} from '../../../../src/lib/core/layout/region-composition-types';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/region-geometry-diagnostic';
import { RegionIncidentUnknownCode } from '../../../../src/lib/core/layout/region-incident-contract';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/region-local-cache';
import {
	REGION_SUBTREE_CALCULATION_FAILED,
	RegionSubtreeScope,
	solveRegionSubtreeAttempts,
} from '../../../../src/lib/core/layout/region-partial-composition';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import {
	regionLanePartialDocument,
	regionLanePartialSubtreeDocument,
} from '../../../support/builders/region-lane-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { regionDocument } from './nested-region-fixture';

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
	it('reports an unresolved leaf beside the current independent leaf', () => {
		const attempts = attemptsFor(regionLanePartialDocument(true));
		expect(attempts).toMatchObject([
			{
				status: RegionCompositionStatus.Unknown,
				regionId: 'shared',
				scope: RegionSubtreeScope.Leaf,
				code: RegionIncidentUnknownCode.NoValidAlternative,
				witness: { exhaustive: true },
				endpointIds: ['delivery', 'request', 'second-request'],
				relationIds: ['first-handoff', 'second-handoff', 'within-sales'],
			},
			{
				status: RegionCompositionStatus.Selected,
				regionId: 'ordinary',
				scope: RegionSubtreeScope.Leaf,
				document: { nodes: [{ id: 'neighbor', markdown: 'Neighbor\n' }], relations: [] },
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

	it('retains typed search evidence when a closed branch contains an unresolved lane leaf', () => {
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
						return { ...region, parentId: 'branch', layoutOrder: orderKey('a1') };
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
			status: RegionCompositionStatus.Unknown,
			scope: RegionSubtreeScope.ClosedSubtree,
			code: RegionIncidentUnknownCode.NoValidAlternative,
			failureRegionId: 'shared',
			witness: { exhaustive: true },
			endpointIds: ['delivery', 'neighbor', 'request', 'second-request'],
		});
		expect(attempts.find(({ regionId }) => regionId === 'mate')).toMatchObject({
			status: RegionCompositionStatus.Selected,
			scope: RegionSubtreeScope.Leaf,
		});
	});

	it('reports typed geometry failure for crossing routes wholly inside a branch', () => {
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
				{ id: 'branch', parentId: '@root', layoutOrder: 'a0', policy: LayoutPolicy.Layered },
				{ id: 'outside', parentId: '@root', layoutOrder: 'a1', policy: LayoutPolicy.Layered },
				{ id: 'left', parentId: 'branch', layoutOrder: 'a0', policy: LayoutPolicy.Layered },
				{ id: 'middle', parentId: 'branch', layoutOrder: 'a1', policy: LayoutPolicy.Layered },
				{ id: 'right', parentId: 'branch', layoutOrder: 'a2', policy: LayoutPolicy.Layered },
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
			status: RegionCompositionStatus.Unknown,
			scope: RegionSubtreeScope.ClosedSubtree,
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
			failureRegionId: 'branch',
			relationId: 'across-middle',
			endpointIds: ['a-target', 'b', 'c'],
			relationIds: ['across-middle', 'b-to-a'],
		});
		expect(attempts.find(({ regionId }) => regionId === 'outside')?.status).toBe(
			RegionCompositionStatus.Selected,
		);
	});

	it('marks a closed four-child branch unsupported and still attempts independent leaves', () => {
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
				{ id: 'branch', parentId: '@root', layoutOrder: 'a0', policy: LayoutPolicy.Layered },
				{ id: 'outside', parentId: '@root', layoutOrder: 'a1', policy: LayoutPolicy.Layered },
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
		expect(attempts.find(({ regionId }) => regionId === 'branch')).toMatchObject({
			status: RegionCompositionStatus.Unsupported,
			scope: RegionSubtreeScope.ClosedSubtree,
			endpointIds: ['a-source', 'a-target', 'b', 'c'],
			relationIds: ['across-middle', 'inside-a'],
		});
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
		const attempts = attemptsFor(document, new RegionLocalLayoutCache(), { ...measured, nodes });
		expect(attempts.find(({ regionId }) => regionId === 'branch')).toMatchObject({
			status: REGION_SUBTREE_CALCULATION_FAILED,
			scope: RegionSubtreeScope.ClosedSubtree,
			endpointIds: ['mate-node', 'neighbor'],
			relationIds: ['inside-branch'],
		});
		expect(attempts.find(({ regionId }) => regionId === 'shared')?.status).toBe(
			RegionCompositionStatus.Unknown,
		);
		expect(attempts.find(({ regionId }) => regionId === 'ordinary')).toBeUndefined();
	});

	it('reports calculation failure with canonical identifiers when a leaf lacks measurements', () => {
		const document = regionLanePartialDocument(true);
		const measured = prepareLayoutDocument(document).measurements;
		const nodes = new Map(measured.nodes);
		nodes.delete('neighbor');
		const attempts = attemptsFor(document, new RegionLocalLayoutCache(), { ...measured, nodes });
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
			document: { nodes: [{ id: 'neighbor' }, { id: 'mate-node', markdown: 'Current mate\n' }] },
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
