import { describe, expect, it } from 'vitest';

import { EndpointKind, type LogicDocument } from '../../src/lib/document/logic-document';
import { projectRelationAddition } from '../../src/lib/document/topology-edits';
import { orderEndpoints } from '../../src/lib/layout/endpoint-order';
import { fractionalOrderKeySpace } from '../../src/lib/layout/order-key-space';
import { crossingAwareDirectionScenario } from '../builders/crossing-aware-direction-scenario';

describe('topology edits', () => {
	function threeTargetScenario(
		targetOrder: readonly string[],
		sourceOrder: readonly string[] = ['source-a', 'source-b', 'source-c'],
	): LogicDocument {
		const keys = new Map(
			[...sourceOrder, ...targetOrder, 'successor'].map((id, index) => [id, `a${index}`]),
		);
		return {
			persistenceFormat: 1,
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
				layoutOrder: keys.get(id),
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

	it('moves only the relation target key into the selected local slot', () => {
		const original = crossingAwareDirectionScenario({ direction: 'top-to-bottom', bias: 'top' });
		const peerKeys = new Map(original.nodes.map(({ id, layoutOrder }) => [id, layoutOrder]));
		const result = projectRelationAddition(original, {
			id: 'source-a-to-target-b',
			from: 'source-a',
			to: 'target-b',
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected relation projection to succeed');
		expect(result.value.changes.endpointOrderChanges).toMatchObject([{ endpointId: 'target-b' }]);
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
		const result = projectRelationAddition(original, {
			id: 'source-b-to-target-b',
			from: 'source-b',
			to: 'target-b',
		});
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
			const result = projectRelationAddition(original, {
				id: 'c',
				from: 'source-c',
				to: 'target-c',
			});

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
		const result = projectRelationAddition(original, {
			id: 'target-c-to-a',
			from: 'target-c',
			to: 'target-a',
		});

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
				node.id === 'source-b' || node.id === 'target-a' ? { ...node, layoutOrder: 'a2' } : node,
			),
		};
		const result = projectRelationAddition(duplicatePeers, {
			id: 'source-a-to-target-b',
			from: 'source-a',
			to: 'target-b',
		});

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
});
