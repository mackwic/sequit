import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../src/lib/document/logic-document';
import { orderKey } from '../../src/lib/document/order-key';
import { createGraph, type EffectiveSemanticRelation } from '../../src/lib/graph/create-graph';
import { topologicallyRank } from '../../src/lib/graph/topological-ranks';
import {
	type CrossingOrderMetadata,
	crossingScoreTolerance,
	scoreTargetInsertionSlots,
	selectTargetInsertionSlot,
	weightedInversionScore,
} from '../../src/lib/layout/crossing-aware-order';
import { orderEndpoints } from '../../src/lib/layout/endpoint-order';

function metadata(
	order: readonly string[],
	rankEntries: readonly (readonly [string, number])[],
	effectiveRelations: readonly EffectiveSemanticRelation[],
	junctionIds: readonly string[] = [],
): CrossingOrderMetadata {
	return {
		effectiveRelations,
		effectiveEndpointOrder: order,
		ranks: new Map(rankEntries),
		junctionIds: new Set(junctionIds),
	};
}

function link(
	relationId: string,
	sourceId: string,
	targetId: string,
	weight = 1,
): EffectiveSemanticRelation {
	if (weight !== 1) {
		const denominator = Math.round(1 / weight);
		return {
			relationId,
			sourceIds: [
				sourceId,
				...Array.from({ length: denominator - 1 }, (_, index) => `${relationId}-unranked-${index}`),
			],
			targetIds: [targetId],
		};
	}
	return { relationId, sourceIds: [sourceId], targetIds: [targetId] };
}

it('rejects a target missing from or duplicated in its visual row', () => {
	const emptyMetadata = metadata([], [], []);
	expect(() => scoreTargetInsertionSlots([], 'target', emptyMetadata)).toThrow(
		'Target must occur exactly once in its visual row: target',
	);
	expect(() => scoreTargetInsertionSlots(['target', 'target'], 'target', emptyMetadata)).toThrow(
		'Target must occur exactly once in its visual row: target',
	);
});

interface OracleLink {
	readonly relationId: string;
	readonly sourceId: string;
	readonly targetId: string;
	readonly weight: number;
}

function cartesianOracleRelations(
	relations: readonly EffectiveSemanticRelation[],
): readonly OracleLink[] {
	return relations.flatMap((relation) => {
		const weight = 1 / (relation.sourceIds.length * relation.targetIds.length);
		return relation.sourceIds.flatMap((sourceId) =>
			relation.targetIds.map((targetId) => ({
				relationId: relation.relationId,
				sourceId,
				targetId,
				weight,
			})),
		);
	});
}

function cartesianOracleScore(input: CrossingOrderMetadata): number {
	const links = cartesianOracleRelations(input.effectiveRelations);
	const layers = new Map<string, string>();
	const ordinals = new Map<string, number>();
	const nextOrdinal = new Map<string, number>();
	for (const id of input.effectiveEndpointOrder) {
		const rank = input.ranks.get(id);
		if (rank === undefined) continue;
		let endpointType = 'ordinary';
		if (input.junctionIds.has(id)) endpointType = 'junction';
		const layer = `${rank}:${endpointType}`;
		layers.set(id, layer);
		ordinals.set(id, nextOrdinal.get(layer) ?? 0);
		nextOrdinal.set(layer, (nextOrdinal.get(layer) ?? 0) + 1);
	}
	let score = 0;
	for (const [index, left] of links.entries()) {
		for (const right of links.slice(index + 1)) {
			if (left.relationId === right.relationId) continue;
			if (layers.get(left.sourceId) !== layers.get(right.sourceId)) continue;
			if (layers.get(left.targetId) !== layers.get(right.targetId)) continue;
			const sourceDelta = (ordinals.get(left.sourceId) ?? 0) - (ordinals.get(right.sourceId) ?? 0);
			const targetDelta = (ordinals.get(left.targetId) ?? 0) - (ordinals.get(right.targetId) ?? 0);
			if (sourceDelta * targetDelta < 0) score += left.weight * right.weight;
		}
	}
	return score;
}

function bruteForceTargetScore(
	row: readonly string[],
	targetId: string,
	input: CrossingOrderMetadata,
): number {
	const order = new Map(input.effectiveEndpointOrder.map((id, index) => [id, index]));
	const layer = (id: string) => {
		const rank = input.ranks.get(id);
		if (rank === undefined) return undefined;
		let endpointType = 'ordinary';
		if (input.junctionIds.has(id)) endpointType = 'junction';
		return `${rank}:${endpointType}`;
	};
	const ordinal = (id: string) => {
		const endpointLayer = layer(id);
		if (endpointLayer === undefined) return undefined;
		return input.effectiveEndpointOrder
			.filter((candidate) => layer(candidate) === endpointLayer)
			.indexOf(id);
	};
	const peers = new Set(row.filter((id) => id !== targetId));
	let score = 0;
	const links = cartesianOracleRelations(input.effectiveRelations);
	for (const targetAtSource of [true, false]) {
		for (const targetLink of links) {
			let targetEndpointId = targetLink.targetId;
			if (targetAtSource) targetEndpointId = targetLink.sourceId;
			if (targetEndpointId !== targetId) continue;
			for (const peerLink of links) {
				if (targetLink.relationId === peerLink.relationId) continue;
				let peerId = peerLink.targetId;
				if (targetAtSource) peerId = peerLink.sourceId;
				if (!peers.has(peerId)) continue;
				if (
					layer(targetLink.sourceId) !== layer(peerLink.sourceId) ||
					layer(targetLink.targetId) !== layer(peerLink.targetId)
				)
					continue;
				const targetSource = ordinal(targetLink.sourceId);
				const peerSource = ordinal(peerLink.sourceId);
				const targetTarget = ordinal(targetLink.targetId);
				const peerTarget = ordinal(peerLink.targetId);
				if (
					targetSource !== undefined &&
					peerSource !== undefined &&
					targetTarget !== undefined &&
					peerTarget !== undefined &&
					(targetSource - peerSource) * (targetTarget - peerTarget) < 0
				) {
					score += targetLink.weight * peerLink.weight;
				}
			}
		}
	}
	if (order.size !== input.effectiveEndpointOrder.length)
		throw new Error('Brute-force input must contain unique endpoint ids');
	return score;
}

function nestedEmptyGroupCrossingDocument(includeEmptySubgroup: boolean): LogicDocument {
	return {
		persistenceFormat: 2,
		id: 'nested-empty-group-crossing',
		title: 'Nested empty group crossing',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
		groups: (() => {
			const groups: LogicDocument['groups'][number][] = [
				{
					kind: EndpointKind.Group,
					id: 'source-group',
					label: 'Sources',
					layoutOrder: orderKey('a0'),
				},
			];
			if (includeEmptySubgroup) {
				groups.push({
					kind: EndpointKind.Group,
					id: 'empty-subgroup',
					label: 'Empty',
					groupId: 'source-group',
					layoutOrder: orderKey('a1'),
				});
			}
			return groups;
		})(),
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'source-left',
				natureId: 'goal',
				groupId: 'source-group',
				markdown: '',
				layoutOrder: orderKey('a2'),
			},
			{
				kind: EndpointKind.Node,
				id: 'source-right',
				natureId: 'goal',
				markdown: '',
				layoutOrder: orderKey('a3'),
			},
			{
				kind: EndpointKind.Node,
				id: 'target-left',
				natureId: 'goal',
				markdown: '',
				layoutOrder: orderKey('a4'),
			},
			{
				kind: EndpointKind.Node,
				id: 'target-right',
				natureId: 'goal',
				markdown: '',
				layoutOrder: orderKey('a5'),
			},
		],
		junctions: [],
		relations: [
			{ id: 'grouped', from: 'source-group', to: 'target-right' },
			{ id: 'peer', from: 'source-right', to: 'target-left' },
		],
	};
}

function scoreDocument(document: LogicDocument): number {
	const graph = createGraph(document);
	expect(graph.ok).toBe(true);
	if (!graph.ok) throw new Error('Expected an acyclic graph');
	const ranks = topologicallyRank(graph.value);
	return weightedInversionScore({
		effectiveRelations: graph.value.effectiveRelations,
		effectiveEndpointOrder: orderEndpoints([
			...document.groups,
			...document.nodes,
			...document.junctions,
		]),
		ranks: ranks.byEndpointId,
		junctionIds: new Set(document.junctions.map(({ id }) => id)),
	});
}

describe('crossing-aware target insertion', () => {
	it('matches the Cartesian oracle for group-to-group mass and excludes self-crossings', () => {
		const grouped = metadata(
			['source-a', 'source-b', 'target-a', 'target-b'],
			[
				['source-a', 0],
				['source-b', 0],
				['target-a', 1],
				['target-b', 1],
			],
			[
				{
					relationId: 'group-to-group',
					sourceIds: ['source-a', 'source-b'],
					targetIds: ['target-a', 'target-b'],
				},
			],
		);
		expect(weightedInversionScore(grouped)).toBe(0);

		const withPeer = {
			...grouped,
			effectiveRelations: [
				...grouped.effectiveRelations,
				{ relationId: 'peer', sourceIds: ['source-b'], targetIds: ['target-a'] },
			],
		};
		expect(weightedInversionScore(withPeer)).toBe(0.25);
		expect(weightedInversionScore(withPeer)).toBe(cartesianOracleScore(withPeer));
	});

	it('preserves semantic relation mass when a populated group contains an empty subgroup', () => {
		const baseline = scoreDocument(nestedEmptyGroupCrossingDocument(false));
		const withEmptySubgroup = scoreDocument(nestedEmptyGroupCrossingDocument(true));

		expect(baseline).toBe(1);
		expect(withEmptySubgroup).toBe(baseline);
	});

	it('derives hand-calculated before, after, and global-best slot scores', () => {
		const input = metadata(
			['source-a', 'source-b', 'target-a', 'target-b'],
			[
				['source-a', 0],
				['source-b', 0],
				['target-a', 1],
				['target-b', 1],
			],
			[link('a', 'source-b', 'target-a'), link('b', 'source-a', 'target-b')],
		);

		expect(scoreTargetInsertionSlots(['target-a', 'target-b'], 'target-b', input)).toEqual({
			currentSlot: 1,
			beforeByPeer: [0],
			afterByPeer: [1],
			scoreBySlot: [0, 1],
		});
		expect(selectTargetInsertionSlot(['target-a', 'target-b'], 'target-b', input)).toMatchObject({
			bestSlot: 0,
			bestScore: 0,
			currentScore: 1,
			order: ['target-b', 'target-a'],
			moved: true,
		});
	});

	it('combines incoming and outgoing buckets and ignores shared opposite endpoints', () => {
		const input = metadata(
			['source-a', 'source-b', 'target-a', 'target-b', 'successor-a', 'successor-b'],
			[
				['source-a', 0],
				['source-b', 0],
				['target-a', 1],
				['target-b', 1],
				['successor-a', 2],
				['successor-b', 2],
			],
			[
				link('incoming-a', 'source-b', 'target-a'),
				link('incoming-b', 'source-a', 'target-b'),
				link('outgoing-a', 'target-a', 'successor-b'),
				link('outgoing-b', 'target-b', 'successor-a'),
				link('shared-a', 'target-a', 'successor-a'),
				link('shared-b', 'target-b', 'successor-a'),
			],
		);

		expect(selectTargetInsertionSlot(['target-a', 'target-b'], 'target-b', input)).toMatchObject({
			bestSlot: 0,
			currentScore: 3,
			bestScore: 0,
		});
	});

	it('keeps long-edge and junction layer-pair buckets distinct', () => {
		const input = metadata(
			['source-a', 'source-b', 'junction-a', 'junction-b', 'long-a', 'long-b'],
			[
				['source-a', 0],
				['source-b', 0],
				['junction-a', 0],
				['junction-b', 0],
				['long-a', 2],
				['long-b', 2],
			],
			[
				link('junction-a', 'source-b', 'junction-a'),
				link('junction-b', 'source-a', 'junction-b'),
				link('long-a', 'source-b', 'long-a'),
				link('long-b', 'source-a', 'long-b'),
			],
			['junction-a', 'junction-b'],
		);

		expect(
			selectTargetInsertionSlot(['junction-a', 'junction-b'], 'junction-b', input),
		).toMatchObject({ bestSlot: 0, currentScore: 1 });
		expect(selectTargetInsertionSlot(['long-a', 'long-b'], 'long-b', input)).toMatchObject({
			bestSlot: 0,
			currentScore: 1,
		});
	});

	it('uses normalized weights and preserves the current slot on equal scores', () => {
		const weighted = metadata(
			['source-a', 'source-b', 'target-a', 'target-b'],
			[
				['source-a', 0],
				['source-b', 0],
				['target-a', 1],
				['target-b', 1],
			],
			[link('peer', 'source-b', 'target-a', 0.5), link('target', 'source-a', 'target-b', 0.25)],
		);
		expect(selectTargetInsertionSlot(['target-a', 'target-b'], 'target-b', weighted)).toMatchObject(
			{
				currentScore: 0.125,
				bestScore: 0,
			},
		);

		const tied = metadata(
			['target-a', 'target-b'],
			[
				['target-a', 1],
				['target-b', 1],
			],
			[],
		);
		expect(selectTargetInsertionSlot(['target-a', 'target-b'], 'target-b', tied)).toMatchObject({
			bestSlot: 1,
			currentScore: 0,
			bestScore: 0,
			moved: false,
		});
	});

	it('chooses the closest best slot, then the lower index', () => {
		const ranks = [
			['source-low', 0],
			['source-middle', 0],
			['source-high', 0],
			['peer-a', 1],
			['peer-b', 1],
			['peer-c', 1],
			['target', 1],
		] as const;
		const links = [
			link('target', 'source-middle', 'target'),
			link('peer-a', 'source-low', 'peer-a'),
			link('peer-b', 'source-middle', 'peer-b'),
			link('peer-c', 'source-high', 'peer-c'),
		];
		const closest = metadata(
			['source-low', 'source-middle', 'source-high', 'peer-a', 'peer-b', 'peer-c', 'target'],
			ranks,
			links,
		);
		expect(
			selectTargetInsertionSlot(['peer-a', 'peer-b', 'peer-c', 'target'], 'target', closest),
		).toMatchObject({ scoreBySlot: [1, 0, 0, 1], currentSlot: 3, bestSlot: 2 });

		const lowerIndex = metadata(
			['source-low', 'source-middle', 'source-high', 'peer-a', 'peer-b', 'target', 'peer-c'],
			ranks,
			[
				link('target', 'source-middle', 'target'),
				link('peer-a', 'source-low', 'peer-a'),
				link('peer-b', 'source-high', 'peer-b'),
				link('peer-c', 'source-low', 'peer-c'),
			],
		);
		expect(
			selectTargetInsertionSlot(['peer-a', 'peer-b', 'target', 'peer-c'], 'target', lowerIndex),
		).toMatchObject({ scoreBySlot: [2, 1, 2, 1], currentSlot: 2, bestSlot: 1 });
	});

	it('selects the true minimum when adjacent scores are distinct', () => {
		const input = metadata(
			['source-low', 'source-high', 'peer-a', 'peer-b', 'peer-c', 'target'],
			[
				['source-low', 0],
				['source-high', 0],
				['peer-a', 1],
				['peer-b', 1],
				['peer-c', 1],
				['target', 1],
			],
			[
				link('target', 'source-low', 'target'),
				link('peer-a', 'source-high', 'peer-a', 0.25),
				link('peer-b', 'source-high', 'peer-b', 0.25),
				link('peer-c', 'source-high', 'peer-c', 0.25),
			],
		);

		const selection = selectTargetInsertionSlot(
			['peer-a', 'peer-b', 'peer-c', 'target'],
			'target',
			input,
		);
		expect(selection.scoreBySlot).toHaveLength(4);
		expect(selection.scoreBySlot[3]).toBe(0.75);
		expect(selection.bestSlot).toBe(0);

		const mirrored = metadata(
			['source-low', 'source-high', 'target', 'peer-a', 'peer-b', 'peer-c'],
			[
				['source-low', 0],
				['source-high', 0],
				['target', 1],
				['peer-a', 1],
				['peer-b', 1],
				['peer-c', 1],
			],
			[
				link('target', 'source-high', 'target'),
				link('peer-a', 'source-low', 'peer-a', 0.25),
				link('peer-b', 'source-low', 'peer-b', 0.25),
				link('peer-c', 'source-low', 'peer-c', 0.25),
			],
		);
		const mirroredSelection = selectTargetInsertionSlot(
			['target', 'peer-a', 'peer-b', 'peer-c'],
			'target',
			mirrored,
		);
		expect(mirroredSelection.scoreBySlot[0]).toBe(0.75);
		expect(mirroredSelection.bestSlot).toBe(3);
	});

	it('matches a brute-force oracle across weighted, outgoing, junction, and long links', () => {
		let state = 17;
		function random(): number {
			state = (state * 48271) % 2147483647;
			return state / 2147483647;
		}

		for (let iteration = 0; iteration < 100; iteration += 1) {
			const sources = ['source-0', 'source-1', 'source-2'];
			const junctionSources = ['source-junction-0', 'source-junction-1'];
			const row = ['target-0', 'target-1', 'target-2', 'target-3'];
			const successors = ['successor-0', 'successor-1', 'successor-2'];
			const longSuccessors = ['long-successor-0', 'long-successor-1'];
			const links: EffectiveSemanticRelation[] = [];
			const weights = [1, 0.5, 0.25, 0.125] as const;
			const connect = (fromIds: readonly string[], toIds: readonly string[], prefix: string) => {
				for (const fromId of fromIds) {
					for (const toId of toIds) {
						if (random() < 0.45) {
							links.push(
								link(
									`${prefix}-${fromId}-${toId}`,
									fromId,
									toId,
									weights[Math.floor(random() * weights.length)] ?? 1,
								),
							);
						}
					}
				}
			};
			connect(sources, row, 'incoming');
			connect(junctionSources, row, 'incoming-junction');
			connect(row, successors, 'outgoing');
			connect(row, longSuccessors, 'outgoing-long');
			let incomingSources = sources.slice(1);
			if (random() < 0.5) incomingSources = sources.slice(0, 2);
			let outgoingTargets = successors.slice(1);
			if (random() < 0.5) outgoingTargets = successors.slice(0, 2);
			links.push(
				{
					relationId: `ranked-multi-incoming-${iteration}`,
					sourceIds: incomingSources,
					targetIds: ['target-0', 'target-2', 'target-3'],
				},
				{
					relationId: `ranked-multi-outgoing-${iteration}`,
					sourceIds: ['target-0', 'target-2'],
					targetIds: outgoingTargets,
				},
			);
			links.push(
				link('required-incoming-peer', 'source-2', 'target-0', 0.5),
				link('required-incoming-target', 'source-0', 'target-2', 0.25),
				link('required-junction-peer', 'source-junction-1', 'target-0', 0.125),
				link('required-junction-target', 'source-junction-0', 'target-2', 0.5),
				link('required-outgoing-peer', 'target-0', 'successor-2', 0.25),
				link('required-outgoing-target', 'target-2', 'successor-0', 0.5),
				link('required-long-peer', 'target-0', 'long-successor-1', 0.125),
				link('required-long-target', 'target-2', 'long-successor-0', 0.5),
			);
			const order = [...sources, ...junctionSources, ...row, ...successors, ...longSuccessors];
			const ranks = [
				...sources.map((id) => [id, 0] as const),
				...junctionSources.map((id) => [id, 0] as const),
				...row.map((id) => [id, 1] as const),
				...successors.map((id) => [id, 2] as const),
				...longSuccessors.map((id) => [id, 3] as const),
			];
			let junctionIds = [...junctionSources, ...row];
			if (iteration % 2 === 0) junctionIds = junctionSources;
			const input = metadata(order, ranks, links, junctionIds);
			const targetId = 'target-2';
			const selected = selectTargetInsertionSlot(row, targetId, input);
			const peers = row.filter((id) => id !== targetId);
			const scoreBySlot = peers
				.map((_, slot) => slot)
				.concat(peers.length)
				.map((slot) => {
					const candidate = [...peers.slice(0, slot), targetId, ...peers.slice(slot)];
					return bruteForceTargetScore(candidate, targetId, {
						...input,
						effectiveEndpointOrder: [
							...sources,
							...junctionSources,
							...candidate,
							...successors,
							...longSuccessors,
						],
					});
				});
			const currentSlot = row.indexOf(targetId);
			const minimumScore = Math.min(...scoreBySlot);
			let bruteSlot: number | undefined;
			for (const [slot, score] of scoreBySlot.entries()) {
				if (Math.abs(score - minimumScore) > crossingScoreTolerance(score, minimumScore)) continue;
				if (
					bruteSlot === undefined ||
					Math.abs(slot - currentSlot) < Math.abs(bruteSlot - currentSlot) ||
					(Math.abs(slot - currentSlot) === Math.abs(bruteSlot - currentSlot) && slot < bruteSlot)
				) {
					bruteSlot = slot;
				}
			}
			for (const [slot, score] of selected.scoreBySlot.entries()) {
				expect(
					Math.abs(score - (scoreBySlot[slot] ?? Number.NaN)),
					`iteration ${iteration}, slot ${slot}`,
				).toBeLessThanOrEqual(crossingScoreTolerance(score, scoreBySlot[slot] ?? Number.NaN));
			}
			expect(selected.bestSlot, `iteration ${iteration}`).toBe(bruteSlot);
			expect(selected.currentScore, `iteration ${iteration}`).toBe(
				selected.scoreBySlot[currentSlot],
			);
			expect(selected.bestScore, `iteration ${iteration}`).toBe(
				selected.scoreBySlot[bruteSlot ?? 0],
			);
			expect(selected.order, `iteration ${iteration}`).toEqual([
				...peers.slice(0, bruteSlot),
				targetId,
				...peers.slice(bruteSlot),
			]);
		}
	});
});
