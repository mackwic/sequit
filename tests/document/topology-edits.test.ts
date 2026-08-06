import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	type LogicDocument,
	type OrderKey,
} from '../../src/lib/document/logic-document';
import { orderKey } from '../../src/lib/document/order-key';
import {
	projectNodeAddition,
	projectRelationAddition,
} from '../../src/lib/document/topology-edits';
import { orderEndpoints } from '../../src/lib/layout/endpoint-order';
import { fractionalOrderKeySpace } from '../../src/lib/layout/order-key-space';
import { crossingAwareDirectionScenario } from '../builders/crossing-aware-direction-scenario';

describe('topology edits', () => {
	function threeTargetScenario(
		targetOrder: readonly string[],
		sourceOrder: readonly string[] = ['source-a', 'source-b', 'source-c'],
	): LogicDocument {
		const keys = new Map(
			[...sourceOrder, ...targetOrder, 'successor'].map((id, index) => [id, orderKey(`a${index}`)]),
		);
		return {
			persistenceFormat: 2,
			id: 'three-targets',
			title: 'Three targets',
			layout: { direction: 'top-to-bottom', bias: 'top' },
			natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
			groups: [],
			nodes: [...sourceOrder, 'target-a', 'target-b', 'target-c', 'successor'].map((id) => ({
				kind: EndpointKind.Node,
				id,
				natureId: 'goal',
				markdown: id,
				layoutOrder: keys.get(id) ?? orderKey('a0'),
			})),
			junctions: [],
			relations: [
				{ id: 'a', from: 'source-a', to: 'target-a' },
				{ id: 'b', from: 'source-b', to: 'target-b' },
				{ id: 'targets-a', from: 'target-a', to: 'successor' },
				{ id: 'targets-b', from: 'target-b', to: 'successor' },
				{ id: 'targets-c', from: 'target-c', to: 'successor' },
			],
		};
	}

	function threeJunctionTargetScenario(): LogicDocument {
		const ids = [
			'source-a',
			'source-b',
			'source-c',
			'junction-c',
			'junction-a',
			'junction-b',
			'successor',
		];
		const keys = new Map(ids.map((id, index) => [id, orderKey(`a${index}`)]));
		return {
			persistenceFormat: 2,
			id: 'three-junction-targets',
			title: 'Three junction targets',
			layout: { direction: 'top-to-bottom', bias: 'top' },
			natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
			groups: [],
			nodes: ['source-a', 'source-b', 'source-c', 'successor'].map((id) => ({
				kind: EndpointKind.Node,
				id,
				natureId: 'goal',
				markdown: id,
				layoutOrder: keys.get(id) ?? orderKey('a0'),
			})),
			junctions: ['junction-a', 'junction-b', 'junction-c'].map((id) => ({
				kind: EndpointKind.Junction,
				id,
				operator: 'xor' as const,
				layoutOrder: keys.get(id) ?? orderKey('a0'),
			})),
			relations: [
				{ id: 'a', from: 'source-a', to: 'junction-a' },
				{ id: 'b', from: 'source-b', to: 'junction-b' },
				{ id: 'junction-a-out', from: 'junction-a', to: 'successor' },
				{ id: 'junction-b-out', from: 'junction-b', to: 'successor' },
				{ id: 'junction-c-out', from: 'junction-c', to: 'successor' },
			],
		};
	}

	it('moves a same-rank junction target without rewriting its peers', () => {
		const original = threeJunctionTargetScenario();
		const before = new Map(original.junctions.map(({ id, layoutOrder }) => [id, layoutOrder]));
		const result = projectRelationAddition(
			original,
			{ id: 'c', from: 'source-c', to: 'junction-c' },
			fractionalOrderKeySpace,
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected same-rank junction relation to succeed');
		expect(result.value.eligible).toBe(true);
		expect(result.value.moved).toBe(true);
		expect(result.value.selectedScore).toBeLessThan(result.value.previousScore ?? 0);
		expect(orderEndpoints(result.value.document.junctions)).toEqual([
			'junction-a',
			'junction-b',
			'junction-c',
		]);
		expect(result.value.changes.endpointOrderChanges.map(({ endpointId }) => endpointId)).toEqual([
			'junction-c',
		]);
		for (const junction of result.value.document.junctions) {
			if (junction.id !== 'junction-c') expect(junction.layoutOrder).toBe(before.get(junction.id));
		}
	});

	it('leaves a junction-to-ordinary target unchanged when placement layers are not adjacent', () => {
		const original = threeJunctionTargetScenario();
		const document: LogicDocument = {
			...original,
			nodes: [
				...original.nodes,
				{
					kind: EndpointKind.Node,
					id: 'later-target',
					natureId: 'goal',
					markdown: 'Later target',
					layoutOrder: orderKey('a8'),
				},
			],
			relations: [
				...original.relations,
				{ id: 'successor-to-later', from: 'successor', to: 'later-target' },
			],
		};
		const before = document.nodes.map(({ layoutOrder }) => layoutOrder);
		const result = projectRelationAddition(
			document,
			{ id: 'non-adjacent', from: 'junction-c', to: 'later-target' },
			fractionalOrderKeySpace,
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected non-adjacent relation to succeed');
		expect(result.value.eligible).toBe(false);
		expect(result.value.moved).toBe(false);
		expect(result.value.changes.endpointOrderChanges).toEqual([]);
		expect(result.value.document.nodes.map(({ layoutOrder }) => layoutOrder)).toEqual(before);
	});

	it('moves only the relation target key into the selected local slot', () => {
		const original = crossingAwareDirectionScenario({ direction: 'top-to-bottom', bias: 'top' });
		const peerKeys = new Map(original.nodes.map(({ id, layoutOrder }) => [id, layoutOrder]));
		const result = projectRelationAddition(
			original,
			{
				id: 'source-a-to-target-b',
				from: 'source-a',
				to: 'target-b',
			},
			fractionalOrderKeySpace,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected relation projection to succeed');
		expect(result.value.changes.endpointOrderChanges).toMatchObject([
			{ endpointKind: EndpointKind.Node, endpointId: 'target-b' },
		]);
		expect(result.value.changes.relationAdditions).toEqual([
			{ id: 'source-a-to-target-b', from: 'source-a', to: 'target-b' },
		]);
		expect(orderEndpoints(result.value.document.nodes).slice(0, 5)).toEqual([
			'source-a',
			'source-b',
			'target-b',
			'target-a',
			'successor',
		]);
		for (const node of result.value.document.nodes) {
			if (node.id !== 'target-b') expect(node.layoutOrder).toBe(peerKeys.get(node.id));
		}
	});

	it('returns no endpoint-local change when no strict crossing improvement exists', () => {
		const original = crossingAwareDirectionScenario({ direction: 'top-to-bottom', bias: 'top' });
		const result = projectRelationAddition(
			original,
			{
				id: 'source-b-to-target-b',
				from: 'source-b',
				to: 'target-b',
			},
			fractionalOrderKeySpace,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected relation projection to succeed');
		expect(result.value.changes.endpointOrderChanges).toEqual([]);
		expect(result.value.document.nodes).toEqual(original.nodes);
	});

	it.each([
		[
			'before the first peer',
			['source-c', 'source-a', 'source-b'],
			['target-a', 'target-b', 'target-c'],
			['target-c', 'target-a', 'target-b'],
		],
		[
			'between two peers',
			['source-a', 'source-b', 'source-c'],
			['target-a', 'target-c', 'target-b'],
			['target-a', 'target-b', 'target-c'],
		],
		[
			'after the last peer',
			['source-a', 'source-b', 'source-c'],
			['target-c', 'target-a', 'target-b'],
			['target-a', 'target-b', 'target-c'],
		],
	] as const)(
		'allocates the moved target key %s without rewriting peers',
		(_name, sourceOrder, initial, expected) => {
			const original = threeTargetScenario(initial, sourceOrder);
			const before = new Map(original.nodes.map((node) => [node.id, node.layoutOrder]));
			const result = projectRelationAddition(
				original,
				{
					id: 'c',
					from: 'source-c',
					to: 'target-c',
				},
				fractionalOrderKeySpace,
			);

			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error('Expected relation projection to succeed');
			expect(result.value.moved).toBe(true);
			expect(result.value.selectedScore).toBeLessThan(result.value.previousScore ?? 0);
			expect(result.value.changes.endpointOrderChanges.map(({ endpointId }) => endpointId)).toEqual(
				['target-c'],
			);
			const targets = result.value.document.nodes.filter(({ id }) => id.startsWith('target-'));
			expect(orderEndpoints(targets)).toEqual(expected);
			for (const node of result.value.document.nodes) {
				if (node.id !== 'target-c') expect(node.layoutOrder).toBe(before.get(node.id));
			}
			const movedKey = targets.find(({ id }) => id === 'target-c')?.layoutOrder;
			expect(movedKey && fractionalOrderKeySpace.isValid(movedKey)).toBe(true);
		},
	);

	it('retains every endpoint key when topology changes ranks but no strict move qualifies', () => {
		const original = threeTargetScenario(['target-a', 'target-b', 'target-c']);
		const before = new Map(original.nodes.map((node) => [node.id, node.layoutOrder]));
		const result = projectRelationAddition(
			original,
			{
				id: 'target-c-to-a',
				from: 'target-c',
				to: 'target-a',
			},
			fractionalOrderKeySpace,
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected rank-changing relation to succeed');
		expect(result.value.changes.endpointOrderChanges).toEqual([]);
		expect(new Map(result.value.document.nodes.map((node) => [node.id, node.layoutOrder]))).toEqual(
			before,
		);
	});

	it('does not rewrite peers when duplicate endpoint keys are present', () => {
		const original = crossingAwareDirectionScenario({ direction: 'top-to-bottom', bias: 'top' });
		const duplicatePeers = {
			...original,
			nodes: original.nodes.map((node) =>
				node.id === 'source-b' || node.id === 'target-a'
					? { ...node, layoutOrder: orderKey('a2') }
					: node,
			),
		};
		const result = projectRelationAddition(
			duplicatePeers,
			{
				id: 'source-a-to-target-b',
				from: 'source-a',
				to: 'target-b',
			},
			fractionalOrderKeySpace,
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected duplicate-key relation addition to succeed');
		expect(result.value.changes.endpointOrderChanges.map(({ endpointId }) => endpointId)).toEqual([
			'target-b',
		]);
		for (const node of result.value.document.nodes) {
			if (node.id !== 'target-b') {
				expect(node.layoutOrder).toBe(
					duplicatePeers.nodes.find(({ id }) => id === node.id)?.layoutOrder,
				);
			}
		}
		expect(result.value.changes.relationAdditions).toHaveLength(1);
	});

	it('projects a node addition with an injected order-key space without Yjs', () => {
		const original = threeTargetScenario(['target-a', 'target-b', 'target-c']);
		const calls: {
			readonly slot: { readonly before?: string; readonly after?: string };
			readonly discriminator?: string;
		}[] = [];
		const testKey = orderKey('a7');
		const testKeySpace = {
			compare: (left: OrderKey, right: OrderKey) => (left < right ? -1 : left > right ? 1 : 0),
			isValid: (key: string): key is OrderKey => {
				void key;
				return true;
			},
			keyFor: (
				slot: { readonly before?: string; readonly after?: string },
				discriminator?: string,
			) => {
				calls.push({ slot, discriminator });
				return testKey;
			},
		};

		const result = projectNodeAddition(
			original,
			{ id: 'new-node', natureId: 'goal', markdown: 'New node' },
			testKeySpace,
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected node projection to succeed');
		expect(calls).toEqual([{ slot: { before: orderKey('a6') }, discriminator: 'new-node' }]);
		expect(result.value.changes).toEqual({
			nodeAdditions: [expect.objectContaining({ id: 'new-node', layoutOrder: testKey })],
			relationAdditions: [],
			endpointOrderChanges: [],
		});
		expect(result.value.document.nodes.at(-1)).toMatchObject({
			id: 'new-node',
			kind: EndpointKind.Node,
			layoutOrder: testKey,
		});
	});

	it('keeps the row unchanged when the selected slot has duplicate-key neighbors', () => {
		const original = threeTargetScenario(
			['target-c', 'target-a', 'target-b'],
			['source-a', 'source-c', 'source-b'],
		);
		const duplicateKey = orderKey('a4');
		const duplicateNeighbors = {
			...original,
			nodes: original.nodes.map((node) =>
				node.id === 'target-a' || node.id === 'target-b'
					? { ...node, layoutOrder: duplicateKey }
					: node,
			),
		};
		const keysBefore = new Map(
			duplicateNeighbors.nodes.map(({ id, layoutOrder }) => [id, layoutOrder]),
		);

		const result = projectRelationAddition(
			duplicateNeighbors,
			{ id: 'c', from: 'source-c', to: 'target-c' },
			fractionalOrderKeySpace,
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected duplicate-neighbor addition to succeed');
		expect(result.value.eligible).toBe(true);
		expect(result.value.moved).toBe(false);
		expect(result.value.selectedScore).toBe(result.value.previousScore);
		expect(result.value.changes.endpointOrderChanges).toEqual([]);
		expect(result.value.changes.relationAdditions).toEqual([
			{ id: 'c', from: 'source-c', to: 'target-c' },
		]);
		expect(
			new Map(result.value.document.nodes.map(({ id, layoutOrder }) => [id, layoutOrder])),
		).toEqual(keysBefore);
	});

	it('rejects a relation move when the key space materializes the wrong slot', () => {
		const original = threeTargetScenario(['target-a', 'target-c', 'target-b']);
		const targetKey = original.nodes.find(({ id }) => id === 'target-c')?.layoutOrder;
		if (targetKey === undefined) throw new Error('Expected target-c fixture key');
		const faultyKeySpace = {
			compare: (left: OrderKey, right: OrderKey) => (left < right ? -1 : left > right ? 1 : 0),
			isValid: (key: string): key is OrderKey => {
				void key;
				return true;
			},
			keyFor: () => targetKey,
		};

		const result = projectRelationAddition(
			original,
			{ id: 'c', from: 'source-c', to: 'target-c' },
			faultyKeySpace,
		);

		expect(result).toEqual({
			ok: false,
			diagnostics: [
				expect.objectContaining({
					code: 'endpoint-order-materialization-failed',
					path: ['relations', 'c', 'to'],
					expectedOrder: ['target-a', 'target-b', 'target-c'],
					materializedOrder: ['target-a', 'target-c', 'target-b'],
				}),
			],
		});
	});

	it.each([
		['empty', false],
		['populated', true],
	] as const)('adds a relation to an %s group without moving the group', (_name, populated) => {
		const groupKey = orderKey('a1');
		const memberKey = orderKey('a2');
		const members: LogicDocument['nodes'] = populated
			? [
					{
						kind: EndpointKind.Node,
						id: 'member',
						natureId: 'goal',
						groupId: 'target-group',
						markdown: 'Member',
						layoutOrder: memberKey,
					},
				]
			: [];
		const document: LogicDocument = {
			persistenceFormat: 2,
			id: 'group-target',
			title: 'Group target',
			layout: { direction: 'top-to-bottom', bias: 'top' },
			natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
			groups: [
				{ kind: EndpointKind.Group, id: 'target-group', label: 'Target', layoutOrder: groupKey },
			],
			nodes: [
				{
					kind: EndpointKind.Node,
					id: 'source',
					natureId: 'goal',
					markdown: 'Source',
					layoutOrder: orderKey('a0'),
				},
				...members,
			],
			junctions: [],
			relations: [],
		};

		const result = projectRelationAddition(
			document,
			{ id: 'to-group', from: 'source', to: 'target-group' },
			fractionalOrderKeySpace,
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected relation to group to succeed');
		expect(result.value.eligible).toBe(false);
		expect(result.value.moved).toBe(false);
		expect(result.value.changes.endpointOrderChanges).toEqual([]);
		expect(result.value.document.groups[0]?.layoutOrder).toBe(groupKey);
		if (populated) expect(result.value.document.nodes[1]?.layoutOrder).toBe(memberKey);
	});
});
