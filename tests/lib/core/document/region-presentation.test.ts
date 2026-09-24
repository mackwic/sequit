import { describe, expect, it } from 'vitest';

import { LayoutPolicy } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	type LayoutRegionDefinition,
	normalizeRegionPresentation,
	RegionPresentationIssueCode,
	RegionPresentationStatus,
	ROOT_LAYOUT_REGION_ID,
} from '../../../../src/lib/core/document/region-presentation';
import { validLogicDocument } from '../../../support/builders/logic-document';

function definition(
	id: string,
	parentId: string | undefined,
	position: string,
): LayoutRegionDefinition {
	const region = {
		id,
		layoutOrder: orderKey(position),
		policy: LayoutPolicy.Layered,
	};
	if (parentId === undefined) return region;
	return { ...region, parentId };
}

describe('normalized true-region presentation', () => {
	it('derives one root for legacy documents without changing their endpoints', () => {
		const document = validLogicDocument();
		const result = normalizeRegionPresentation(document);
		expect(result.status).toBe(RegionPresentationStatus.Ready);
		if (result.status !== RegionPresentationStatus.Ready) return;
		expect(result.value.regions).toEqual([
			{ id: ROOT_LAYOUT_REGION_ID, policy: LayoutPolicy.Layered },
		]);
		expect([...result.value.regionByEndpointId.values()]).toEqual(
			Array.from({ length: 8 }, () => ROOT_LAYOUT_REGION_ID),
		);
		expect(document.groups[0]).not.toHaveProperty('regionId');
	});

	it('sorts siblings, keeps nested parents before children, and inherits group ownership', () => {
		const document = validLogicDocument();
		const regions = [
			definition('service', undefined, 'a2'),
			definition('sales-cell', 'sales', 'a0'),
			definition('sales', undefined, 'a1'),
		];
		const assignments = new Map([
			['target', 'service'],
			['container', 'sales-cell'],
			['endpoint-group', 'sales'],
		]);
		const result = normalizeRegionPresentation(document, regions, assignments);
		expect(result.status).toBe(RegionPresentationStatus.Ready);
		if (result.status !== RegionPresentationStatus.Ready) return;
		expect(result.value.regions.map(({ id }) => id)).toEqual([
			ROOT_LAYOUT_REGION_ID,
			'sales',
			'sales-cell',
			'service',
		]);
		for (const id of ['container', 'source-a', 'source-b', 'choice'])
			expect(result.value.regionByEndpointId.get(id)).toBe('sales-cell');
		expect(result.value.regionByEndpointId.get('endpoint-group')).toBe('sales');
		expect(result.value.regionByEndpointId.get('target')).toBe('service');
		expect(result.value.regionByEndpointId.get('isolated')).toBe(ROOT_LAYOUT_REGION_ID);
		const permuted = normalizeRegionPresentation(
			{
				...document,
				nodes: [...document.nodes].reverse(),
				groups: [...document.groups].reverse(),
			},
			[...regions].reverse(),
			new Map([...assignments].reverse()),
		);
		expect(permuted).toEqual(result);
	});

	it('breaks equal sibling order keys canonically by region id', () => {
		const document = validLogicDocument();
		const regions = [definition('zeta', undefined, 'a0'), definition('alpha', undefined, 'a0')];
		const first = normalizeRegionPresentation(document, regions);
		const reversed = normalizeRegionPresentation(document, [...regions].reverse());
		expect(first).toEqual(reversed);
		expect(first.status).toBe(RegionPresentationStatus.Ready);
		if (first.status !== RegionPresentationStatus.Ready) return;
		expect(first.value.regions.map(({ id }) => id)).toEqual([
			ROOT_LAYOUT_REGION_ID,
			'alpha',
			'zeta',
		]);
	});

	it('rejects cycles and missing region parents instead of guessing a hierarchy', () => {
		const document = validLogicDocument();
		const cycle = normalizeRegionPresentation(document, [
			definition('a', 'b', 'a0'),
			definition('b', 'a', 'a1'),
		]);
		expect(cycle).toMatchObject({
			status: RegionPresentationStatus.Invalid,
			issues: [
				{ code: RegionPresentationIssueCode.RegionCycle, id: 'a' },
				{ code: RegionPresentationIssueCode.RegionCycle, id: 'b' },
			],
		});
		const missing = normalizeRegionPresentation(document, [definition('a', 'absent', 'a0')]);
		expect(missing).toMatchObject({
			status: RegionPresentationStatus.Invalid,
			issues: [{ code: RegionPresentationIssueCode.UnknownParent, id: 'a' }],
		});
	});

	it('rejects duplicate or invalid regions and unowned or split endpoints', () => {
		const document = validLogicDocument();
		const duplicate = normalizeRegionPresentation(document, [
			definition('sales', undefined, 'a0'),
			definition('sales', undefined, 'a1'),
		]);
		expect(duplicate).toMatchObject({
			status: RegionPresentationStatus.Invalid,
			issues: [{ code: RegionPresentationIssueCode.DuplicateRegion, id: 'sales' }],
		});
		const invalid = normalizeRegionPresentation(document, [
			definition(ROOT_LAYOUT_REGION_ID, undefined, 'a0'),
			{ id: 'bad-order', layoutOrder: 'x', policy: LayoutPolicy.Layered },
		]);
		expect(invalid.status).toBe(RegionPresentationStatus.Invalid);
		if (invalid.status !== RegionPresentationStatus.Invalid) return;
		expect(invalid.issues).toEqual(
			expect.arrayContaining([
				{
					code: RegionPresentationIssueCode.InvalidRegion,
					id: ROOT_LAYOUT_REGION_ID,
				},
				{ code: RegionPresentationIssueCode.InvalidRegion, id: 'bad-order' },
			]),
		);
		const assignment = normalizeRegionPresentation(
			document,
			[definition('sales', undefined, 'a0')],
			new Map([
				['source-a', 'sales'],
				['target', 'absent'],
				['missing', 'sales'],
			]),
		);
		expect(assignment.status).toBe(RegionPresentationStatus.Invalid);
		if (assignment.status !== RegionPresentationStatus.Invalid) return;
		expect(assignment.issues).toEqual(
			expect.arrayContaining([
				{
					code: RegionPresentationIssueCode.InheritedAssignment,
					id: 'source-a',
				},
				{
					code: RegionPresentationIssueCode.UnknownAssignedRegion,
					id: 'target',
				},
				{ code: RegionPresentationIssueCode.UnknownEndpoint, id: 'missing' },
			]),
		);
	});

	it('flags a broken group owner and normalizes a deep tree iteratively', () => {
		const document = validLogicDocument();
		const broken = normalizeRegionPresentation({
			...document,
			nodes: document.nodes.map((node) => {
				if (node.id === 'source-a') return { ...node, groupId: 'missing' };
				return node;
			}),
		});
		expect(broken).toMatchObject({
			status: RegionPresentationStatus.Invalid,
			issues: [
				{
					code: RegionPresentationIssueCode.InvalidGroupParent,
					id: 'source-a',
				},
			],
		});
		const depth = 1200;
		const regions = Array.from({ length: depth }, (_, index) => {
			if (index === 0) return definition(`r${index}`, undefined, 'a0');
			return definition(`r${index}`, `r${index - 1}`, 'a0');
		});
		const normalized = normalizeRegionPresentation(document, regions);
		expect(normalized.status).toBe(RegionPresentationStatus.Ready);
		if (normalized.status !== RegionPresentationStatus.Ready) return;
		expect(normalized.value.regions).toHaveLength(depth + 1);
		expect(normalized.value.regions.at(-1)?.id).toBe(`r${depth - 1}`);
	});

	it('rejects a cycle of group ownership during region normalization', () => {
		const document = validLogicDocument();
		const cyclic = {
			...document,
			groups: document.groups.map((group) => {
				if (group.id === 'container') return { ...group, groupId: 'endpoint-group' };
				if (group.id === 'endpoint-group') return { ...group, groupId: 'container' };
				return group;
			}),
		};
		const result = normalizeRegionPresentation(cyclic);
		expect(result.status).toBe(RegionPresentationStatus.Invalid);
		if (result.status !== RegionPresentationStatus.Invalid) return;
		expect(result.issues).toEqual(
			expect.arrayContaining([
				{ code: RegionPresentationIssueCode.InvalidGroupParent, id: 'choice' },
			]),
		);
	});
});
