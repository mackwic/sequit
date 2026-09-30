import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	type LogicNode,
	type LogicRelation,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import type { RoutedPath } from '../../../../src/lib/core/layout/bridges/route-runs';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../src/lib/core/layout/layout-engine';
import { GroupRouteFailure } from '../../../../src/lib/core/layout/layout-types';
import {
	type EndpointSlot,
	fractionalOrderKeySpace,
} from '../../../../src/lib/core/ordering/order-key-space';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

const CONFIGURATIONS = [
	[LayoutDirection.TopToBottom, LayoutBias.Top],
	[LayoutDirection.TopToBottom, LayoutBias.Bottom],
	[LayoutDirection.BottomToTop, LayoutBias.Top],
	[LayoutDirection.BottomToTop, LayoutBias.Bottom],
	[LayoutDirection.LeftToRight, LayoutBias.Left],
	[LayoutDirection.LeftToRight, LayoutBias.Right],
	[LayoutDirection.RightToLeft, LayoutBias.Left],
	[LayoutDirection.RightToLeft, LayoutBias.Right],
] as const;

interface DocumentShape {
	readonly nodeCount: number;
	readonly groupCount: number;
	readonly junctionCount: number;
	readonly dag: readonly number[];
	readonly documentary: readonly number[];
	readonly memberships: readonly number[];
	readonly pairs: readonly (readonly [number, number])[];
	readonly configuration: (typeof CONFIGURATIONS)[number];
}

/** Documentary keys in the given order. */
function documentaryKeys(order: readonly string[]): ReadonlyMap<string, string> {
	const keys = new Map<string, string>();
	let previous: string | undefined;
	for (const id of order) {
		let slot: EndpointSlot = {};
		if (previous !== undefined) slot = { before: previous };
		previous = fractionalOrderKeySpace.keyFor(slot);
		keys.set(id, previous);
	}
	return keys;
}

/**
 * Node relations follow the DAG order; a group may be either end, never of its own member.
 * Cycles through groups are left to the graph, which refuses them.
 */
function relationsOf(shape: DocumentShape, endpoints: readonly string[]): LogicRelation[] {
	const relations: LogicRelation[] = [];
	const seen = new Set<string>();
	const pairs = [...shape.pairs];
	if (shape.junctionCount > 0) pairs.unshift([shape.nodeCount + shape.groupCount, 0]);
	const groupOf = (index: number) => `group-${defined(shape.memberships[index])}`;
	for (const [first, second] of pairs) {
		let from = defined(endpoints[first]);
		let to = defined(endpoints[second]);
		if (first < shape.nodeCount && second < shape.nodeCount) {
			from = defined(endpoints[Math.max(first, second)]);
			to = defined(endpoints[Math.min(first, second)]);
		}
		const nested =
			(first < shape.nodeCount && groupOf(defined(shape.dag[first])) === to) ||
			(second < shape.nodeCount && groupOf(defined(shape.dag[second])) === from);
		const key = JSON.stringify([from, to]);
		if (from === to || nested || seen.has(key)) continue;
		seen.add(key);
		relations.push({ id: `relation-${relations.length}`, from, to });
	}
	return relations;
}

function documentOf(shape: DocumentShape): LogicDocument {
	const nodeIds = shape.dag.map((index) => `node-${index}`);
	const groupIds = Array.from({ length: shape.groupCount }, (_, index) => `group-${index}`);
	const junctionIds = Array.from(
		{ length: shape.junctionCount },
		(_, index) => `junction-${index}`,
	);
	const keys = documentaryKeys([
		...shape.documentary.map((index) => `node-${index}`),
		...groupIds,
		...junctionIds,
	]);
	const [direction, bias] = shape.configuration;
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'relation-rename-invariance',
		title: 'Relation rename invariance',
		layout: defined(layoutConfiguration(direction, bias)),
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: groupIds.map((id) => ({
			id,
			kind: EndpointKind.Group,
			label: id,
			layoutOrder: defined(keys.get(id)),
		})),
		junctions: junctionIds.map((id) => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: defined(keys.get(id)),
		})),
		nodes: Array.from({ length: shape.nodeCount }, (_, index) => {
			const id = `node-${index}`;
			const node: LogicNode = {
				id,
				kind: EndpointKind.Node,
				natureId: 'task',
				markdown: id,
				layoutOrder: defined(keys.get(id)),
			};
			if (defined(shape.memberships[index]) >= shape.groupCount) return node;
			return { ...node, groupId: `group-${defined(shape.memberships[index])}` };
		}),
		relations: relationsOf(shape, [...nodeIds, ...groupIds, ...junctionIds]),
	};
}

const shapes = fc
	.record({
		nodeCount: fc.integer({ min: 3, max: 8 }),
		groupCount: fc.integer({ min: 0, max: 2 }),
		junctionCount: fc.integer({ min: 0, max: 1 }),
	})
	.chain(({ nodeCount, groupCount, junctionCount }) => {
		const indices = Array.from({ length: nodeCount }, (_, index) => index);
		const endpointCount = nodeCount + groupCount + junctionCount;
		return fc.record({
			nodeCount: fc.constant(nodeCount),
			groupCount: fc.constant(groupCount),
			junctionCount: fc.constant(junctionCount),
			dag: fc.shuffledSubarray(indices, { minLength: nodeCount, maxLength: nodeCount }),
			documentary: fc.shuffledSubarray(indices, { minLength: nodeCount, maxLength: nodeCount }),
			memberships: fc.array(fc.nat(groupCount + 2), { minLength: nodeCount, maxLength: nodeCount }),
			pairs: fc.array(fc.tuple(fc.nat(endpointCount - 1), fc.nat(endpointCount - 1)), {
				minLength: 2,
				maxLength: 12,
			}),
			configuration: fc.constantFrom(...CONFIGURATIONS),
		});
	});

const renamedCase = shapes
	.map(documentOf)
	.filter((document) => document.relations.length > 1 && createGraph(document).ok)
	.chain((document) => {
		const indices = document.relations.map((_, index) => index);
		return fc.record({
			document: fc.constant(document),
			permutation: fc.shuffledSubarray(indices, {
				minLength: indices.length,
				maxLength: indices.length,
			}),
		});
	});

function bridgeSet(routes: readonly RoutedPath[], originalId: (id: string) => string) {
	const mapped = routeBridgeAnalysis(routes).bridges.map(({ x, y, carrierIds, crossedIds }) => ({
		x,
		y,
		carrierIds: carrierIds.map(originalId).toSorted(compareCanonicalStrings),
		crossedIds: crossedIds.map(originalId).toSorted(compareCanonicalStrings),
	}));
	return mapped.toSorted((left, right) =>
		compareCanonicalStrings(JSON.stringify(left), JSON.stringify(right)),
	);
}

/**
 * The selected order and the geometry, every route named back to its original relation; a
 * document the engine cannot route names its failing relation back the same way.
 */
function outcome(document: LogicDocument, originalId: (id: string) => string) {
	const created = createGraph(document);
	if (!created.ok) throw new Error('The generated document must form a graph.');
	try {
		const { layout, witness } = layoutWithDedicatedEngineAndRankOrderWitness(
			created.value,
			topologicallyRank(created.value),
			layoutMeasurementsFor(document),
		);
		return {
			order: witness.selectedOrder,
			width: layout.width,
			height: layout.height,
			elements: layout.elements,
			routes: Object.fromEntries(
				layout.relations.map(({ id, from, to, points }) => [originalId(id), { from, to, points }]),
			),
			bridges: bridgeSet(layout.relations, originalId),
		};
	} catch (error) {
		if (!(error instanceof GroupRouteFailure)) throw error;
		return { failure: error.code, relation: originalId(error.relationId) };
	}
}

describe('relation rename invariance', () => {
	it('keeps rank order, boxes, routes, and bridge carriers invariant to relation ids', () => {
		fc.assert(
			fc.property(renamedCase, ({ document, permutation }) => {
				const renamedIds = permutation.map((index) => `relation-${index}`);
				const originalIds = new Map(
					document.relations.map(({ id }, index) => [defined(renamedIds[index]), id]),
				);
				const renamed: LogicDocument = {
					...document,
					relations: document.relations.map((relation, index) => ({
						...relation,
						id: defined(renamedIds[index]),
					})),
				};
				expect(outcome(renamed, (id) => defined(originalIds.get(id)))).toEqual(
					outcome(document, (id) => id),
				);
			}),
			PROPERTY_PARAMETERS,
		);
	}, 20_000);
});
