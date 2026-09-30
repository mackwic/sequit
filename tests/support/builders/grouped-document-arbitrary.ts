import fc from 'fast-check';

import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	type LogicGroup,
	type LogicJunction,
	type LogicNode,
} from '../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../src/lib/core/document/order-key';
import type { GroupMeasurement, Size } from '../../../src/lib/core/layout/layout-types';
import { validLogicDocument } from './logic-document';

export interface GroupedCase {
	readonly document: LogicDocument;
	readonly nodes: Readonly<Record<string, Size>>;
	readonly groups: Readonly<Record<string, GroupMeasurement>>;
}

const nodeSizeArbitrary: fc.Arbitrary<Size> = fc.record({
	width: fc.integer({ min: 80, max: 300 }),
	height: fc.integer({ min: 40, max: 160 }),
});
const groupMeasurementArbitrary: fc.Arbitrary<GroupMeasurement> = fc.record({
	minimumWidth: fc.integer({ min: 100, max: 260 }),
	minimumHeight: fc.integer({ min: 60, max: 160 }),
	headerHeight: fc.integer({ min: 8, max: 48 }),
	padding: fc.integer({ min: 8, max: 32 }),
});

const layoutArbitrary: fc.Arbitrary<LayoutConfiguration> = fc.constantFrom<LayoutConfiguration>(
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Bottom },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Top },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Right },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Left },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
);

function requiredAt<T>(values: readonly T[], index: number): T {
	const value = values[index];
	if (value === undefined) throw new Error(`Missing generated value at index ${index}`);
	return value;
}

function ids(prefix: string, count: number): string[] {
	return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}

/** Pick one of `count` groups, or none; `choice` indexes past the groups mean the root. */
function groupAt(groups: readonly string[], choice: number): { groupId?: string } {
	const groupId = groups[choice];
	if (groupId === undefined) return {};
	return { groupId };
}

/** Whether `ancestor` is a group enclosing `id`, directly or not. */
function encloses(parents: ReadonlyMap<string, string | undefined>, ancestor: string, id: string) {
	for (let group = parents.get(id); group !== undefined; group = parents.get(group))
		if (group === ancestor) return true;
	return false;
}

/**
 * Small documents where groups nest, stay empty or hold junctions, and relations may join any
 * two endpoints, groups included, in both directions, except an endpoint and a group enclosing
 * it. Relations follow one random endpoint order, yet may still close a cycle through a group.
 */
export const groupedCaseArbitrary: fc.Arbitrary<GroupedCase> = fc
	.record({
		nodeCount: fc.integer({ min: 2, max: 7 }),
		junctionCount: fc.integer({ min: 0, max: 2 }),
		groupCount: fc.integer({ min: 1, max: 3 }),
	})
	.chain(({ nodeCount, junctionCount, groupCount }) => {
		const endpointCount = nodeCount + junctionCount + groupCount;
		const pair = fc.tuple(
			fc.integer({ min: 0, max: endpointCount - 1 }),
			fc.integer({ min: 0, max: endpointCount - 1 }),
		);
		return fc.record({
			layout: layoutArbitrary,
			groupParents: fc.array(fc.integer({ min: 0, max: groupCount * 2 }), {
				minLength: groupCount,
				maxLength: groupCount,
			}),
			memberships: fc.array(fc.integer({ min: 0, max: groupCount * 2 }), {
				minLength: nodeCount + junctionCount,
				maxLength: nodeCount + junctionCount,
			}),
			relations: fc.array(pair, { minLength: 1, maxLength: endpointCount + 2 }),
			ranking: fc.shuffledSubarray(
				Array.from({ length: endpointCount }, (_, index) => index),
				{
					minLength: endpointCount,
					maxLength: endpointCount,
				},
			),
			nodeSizes: fc.array(nodeSizeArbitrary, { minLength: nodeCount, maxLength: nodeCount }),
			groupSizes: fc.array(groupMeasurementArbitrary, {
				minLength: groupCount,
				maxLength: groupCount,
			}),
			nodeIds: fc.constant(ids('n', nodeCount)),
			junctionIds: fc.constant(ids('j', junctionCount)),
			groupIds: fc.constant(ids('g', groupCount)),
		});
	})
	.map((generated) => {
		const base = validLogicDocument();
		const natureId = base.natures[0]?.id ?? 'goal';
		const { nodeIds, junctionIds, groupIds } = generated;
		let order = 0;
		const nextKey = () => orderKey(`a${(order++).toString().padStart(3, '0')}1`);
		const groups = groupIds.map((id, index): LogicGroup => ({
			kind: EndpointKind.Group,
			id,
			label: id,
			layoutOrder: nextKey(),
			...groupAt(groupIds.slice(0, index), generated.groupParents[index] ?? 0),
		}));
		const nodes = nodeIds.map((id, index): LogicNode => ({
			kind: EndpointKind.Node,
			id,
			natureId,
			markdown: id,
			layoutOrder: nextKey(),
			...groupAt(groupIds, generated.memberships[index] ?? 0),
		}));
		const junctions = junctionIds.map((id, index): LogicJunction => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: nextKey(),
			...groupAt(groupIds, generated.memberships[nodeIds.length + index] ?? 0),
		}));
		const endpoints = [...nodeIds, ...junctionIds, ...groupIds];
		const parents = new Map<string, string | undefined>(
			[...groups, ...nodes, ...junctions].map(({ id, groupId }) => [id, groupId]),
		);
		const relations = generated.relations
			.map(([from, to]) => [requiredAt(generated.ranking, from), requiredAt(generated.ranking, to)])
			.filter(([from = 0, to = 0]) => from < to)
			.map(([from = 0, to = 0]) => [requiredAt(endpoints, from), requiredAt(endpoints, to)])
			.filter(
				([from = '', to = '']) => !encloses(parents, from, to) && !encloses(parents, to, from),
			)
			.map(([from = '', to = ''], index) => ({ id: `r${index}`, from, to }));
		return {
			document: {
				...base,
				layout: generated.layout,
				groups,
				nodes,
				junctions,
				relations,
			},
			nodes: Object.fromEntries(
				nodeIds.map((id, index) => [id, requiredAt(generated.nodeSizes, index)]),
			),
			groups: Object.fromEntries(
				groupIds.map((id, index) => [id, requiredAt(generated.groupSizes, index)]),
			),
		};
	});
