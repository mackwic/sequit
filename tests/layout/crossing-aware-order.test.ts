import { describe, expect, it } from 'vitest';

import type { EffectiveGraphLink } from '../../src/lib/graph/create-graph';
import {
	type CrossingOrderMetadata,
	scoreTargetInsertionSlots,
	selectTargetInsertionSlot,
	weightedInversionScore,
} from '../../src/lib/layout/crossing-aware-order';

function metadata(
	order: readonly string[],
	rankEntries: readonly (readonly [string, number])[],
	effectiveLinks: readonly EffectiveGraphLink[],
	junctionIds: readonly string[] = [],
): CrossingOrderMetadata {
	return {
		effectiveLinks,
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
): EffectiveGraphLink {
	return { relationId, sourceId, targetId, weight };
}

describe('crossing-aware target insertion', () => {
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

	it('does not chain floating-point ties beyond the true minimum tolerance', () => {
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
				link('peer-a', 'source-high', 'peer-a', 2e-15),
				link('peer-b', 'source-high', 'peer-b', 2e-15),
				link('peer-c', 'source-high', 'peer-c', 2e-15),
			],
		);

		const selection = selectTargetInsertionSlot(
			['peer-a', 'peer-b', 'peer-c', 'target'],
			'target',
			input,
		);
		expect(selection.scoreBySlot).toHaveLength(4);
		expect(selection.scoreBySlot[3]).toBeCloseTo(6e-15, 28);
		expect(selection.bestSlot).toBe(1);
	});

	it('matches brute-force weighted inversion scoring for generated small rows', () => {
		let state = 17;
		function random(): number {
			state = (state * 48271) % 2147483647;
			return state / 2147483647;
		}

		for (let iteration = 0; iteration < 100; iteration += 1) {
			const sources = ['source-0', 'source-1', 'source-2'];
			const row = ['target-0', 'target-1', 'target-2', 'target-3'];
			const links: EffectiveGraphLink[] = [];
			for (const targetId of row) {
				for (const sourceId of sources) {
					if (random() < 0.45) links.push(link(`${sourceId}-${targetId}`, sourceId, targetId));
				}
			}
			const order = [...sources, ...row];
			const ranks = [
				...sources.map((id) => [id, 0] as const),
				...row.map((id) => [id, 1] as const),
			];
			const input = metadata(order, ranks, links);
			const targetId = 'target-2';
			const selected = selectTargetInsertionSlot(row, targetId, input);
			const peers = row.filter((id) => id !== targetId);
			const scoreBySlot = peers
				.map((_, slot) => slot)
				.concat(peers.length)
				.map((slot) => {
					const candidate = [...peers.slice(0, slot), targetId, ...peers.slice(slot)];
					return weightedInversionScore({
						...input,
						effectiveEndpointOrder: [...sources, ...candidate],
					});
				});
			let bruteSlot = row.indexOf(targetId);
			let bruteScore = scoreBySlot[bruteSlot] ?? 0;
			for (const [slot, score] of scoreBySlot.entries()) {
				if (
					score < bruteScore ||
					(score === bruteScore &&
						(Math.abs(slot - row.indexOf(targetId)) < Math.abs(bruteSlot - row.indexOf(targetId)) ||
							(Math.abs(slot - row.indexOf(targetId)) ===
								Math.abs(bruteSlot - row.indexOf(targetId)) &&
								slot < bruteSlot)))
				) {
					bruteSlot = slot;
					bruteScore = score;
				}
			}
			expect(selected.bestSlot, `iteration ${iteration}`).toBe(bruteSlot);
		}
	});
});
