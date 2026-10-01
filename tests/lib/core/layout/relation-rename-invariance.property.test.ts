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
	readonly configuration: readonly [LayoutDirection, LayoutBias];
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
 * The selected order and the complete layout, every identifier named back to its original;
 * a document the engine cannot route names its failing relation back the same way.
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
			order: witness.selectedOrder.map((row) => row.map(originalId)),
			layout: {
				...layout,
				elements: layout.elements
					.map((element) => ({ ...element, id: originalId(element.id) }))
					.toSorted((left, right) => compareCanonicalStrings(left.id, right.id)),
				relations: layout.relations
					.map((relation) => ({
						...relation,
						id: originalId(relation.id),
						from: originalId(relation.from),
						to: originalId(relation.to),
					}))
					.toSorted((left, right) => compareCanonicalStrings(left.id, right.id)),
			},
			bridges: bridgeSet(layout.relations, originalId),
		};
	} catch (error) {
		if (!(error instanceof GroupRouteFailure)) throw error;
		return { failure: error.code, relation: originalId(error.relationId) };
	}
}

/** Reverse the lexical order across all endpoint kinds and relations, without changing content. */
function reverseIdentifiers(document: LogicDocument) {
	const ids = [...document.nodes, ...document.junctions, ...document.groups, ...document.relations]
		.map(({ id }) => id)
		.toSorted(compareCanonicalStrings);
	const renamedIds = new Map(
		ids.map((id, index) => [id, `renamed-${String(ids.length - index).padStart(3, '0')}`]),
	);
	const originalIds = new Map([...renamedIds].map(([original, renamed]) => [renamed, original]));
	const rename = (id: string) => defined(renamedIds.get(id));
	const endpoint = <T extends { readonly id: string; readonly groupId?: string }>(entity: T): T => {
		const renamed = { ...entity, id: rename(entity.id) };
		if (entity.groupId === undefined) return renamed;
		return { ...renamed, groupId: rename(entity.groupId) };
	};
	return {
		document: {
			...document,
			nodes: document.nodes.map(endpoint),
			junctions: document.junctions.map(endpoint),
			groups: document.groups.map(endpoint),
			relations: document.relations.map((relation) => ({
				...relation,
				id: rename(relation.id),
				from: rename(relation.from),
				to: rename(relation.to),
			})),
		},
		originalId: (id: string) => defined(originalIds.get(id)),
	};
}

function junctionWitness(configuration: DocumentShape['configuration']): LogicDocument {
	const document = documentOf({
		nodeCount: 4,
		groupCount: 0,
		junctionCount: 1,
		dag: [0, 1, 2, 3],
		documentary: [0, 1, 2, 3],
		memberships: [0, 0, 0, 0],
		pairs: [],
		configuration,
	});
	return {
		...document,
		relations: [
			{ id: 'r0', from: 'junction-0', to: 'node-3' },
			{ id: 'r1', from: 'node-3', to: 'node-2' },
			{ id: 'r2', from: 'junction-0', to: 'node-0' },
			{ id: 'r3', from: 'node-1', to: 'node-2' },
		],
	};
}
describe('identifier rename invariance', () => {
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
				expect(outcome(renamed, (id) => originalIds.get(id) ?? id)).toEqual(
					outcome(document, (id) => id),
				);
			}),
			PROPERTY_PARAMETERS,
		);
	}, 20_000);

	it.each(CONFIGURATIONS)(
		'keeps complete layouts invariant when every identifier is lexically reversed in %s with %s bias',
		(direction, bias) => {
			fc.assert(
				fc.property(
					shapes.filter(({ groupCount, junctionCount }) => groupCount > 0 && junctionCount > 0),
					(shape) => {
						const document = documentOf({ ...shape, configuration: [direction, bias] });
						fc.pre(createGraph(document).ok);
						const renamed = reverseIdentifiers(document);
						expect(outcome(renamed.document, renamed.originalId)).toEqual(
							outcome(document, (id) => id),
						);
					},
				),
				PROPERTY_PARAMETERS,
			);
		},
		60_000,
	);

	it.each(CONFIGURATIONS)(
		'keeps a junction coinciding with a foreign group invariant in %s with %s bias',
		(direction, bias) => {
			const document = documentOf({
				nodeCount: 8,
				groupCount: 2,
				junctionCount: 1,
				dag: [2, 6, 1, 4, 0, 7, 3, 5],
				documentary: [0, 2, 7, 1, 3, 6, 5, 4],
				memberships: [1, 0, 0, 0, 0, 2, 0, 1],
				pairs: [
					[4, 5],
					[4, 0],
				],
				configuration: [direction, bias],
			});
			const renamed = reverseIdentifiers(document);
			const original = outcome(document, (id) => id);
			expect(original).toHaveProperty('layout.relations', [
				expect.objectContaining({ id: 'relation-0', from: 'junction-0', to: 'node-2' }),
				expect.objectContaining({ id: 'relation-1', from: 'node-7', to: 'node-0' }),
				expect.objectContaining({ id: 'relation-2', from: 'node-0', to: 'node-2' }),
			]);
			expect(outcome(renamed.document, renamed.originalId)).toEqual(original);
		},
	);

	it.each(CONFIGURATIONS)(
		'keeps the junction/anchor tie crossing-free in %s with %s bias',
		(direction, bias) => {
			const document = junctionWitness([direction, bias]);
			const first = {
				...document,
				junctions: document.junctions.map((junction) => ({ ...junction, id: 'a0' })),
				relations: document.relations.map((relation) => {
					if (relation.from !== 'junction-0') return relation;
					return { ...relation, from: 'a0' };
				}),
			};
			const second = {
				...first,
				junctions: first.junctions.map((junction) => ({ ...junction, id: 'p0' })),
				relations: first.relations.map((relation) => {
					if (relation.from !== 'a0') return relation;
					return { ...relation, from: 'p0' };
				}),
			};
			const selected = outcome(first, (id) => {
				if (id === 'a0') return 'junction-0';
				return id;
			});
			expect(
				outcome(second, (id) => {
					if (id === 'p0') return 'junction-0';
					return id;
				}),
			).toEqual(selected);
			expect(selected).toHaveProperty('order', [
				['node-2', 'node-0'],
				['node-1', 'node-3'],
			]);
			expect(selected).toHaveProperty('bridges', []);
		},
	);
});
