import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import {
	evaluateDedicatedLayout,
	layoutWithDedicatedEngineAndRankOrderWitness,
} from '../../../../src/lib/core/layout/layout-engine';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import {
	enumerateRankOrders,
	rankOrderEnumerationSize,
} from '../../../../src/lib/core/layout/rank/rank-order';
import { RankSearchStop } from '../../../../src/lib/core/layout/rank/rank-order-witness';
import {
	applyRankOrder,
	collectRankOrderDomain,
} from '../../../../src/lib/core/layout/rank/rank-ordering';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { fractionalOrderKeySpace } from '../../../../src/lib/core/ordering/order-key-space';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';

const DIRECTIONS = [
	[LayoutDirection.TopToBottom, LayoutBias.Top],
	[LayoutDirection.BottomToTop, LayoutBias.Bottom],
	[LayoutDirection.LeftToRight, LayoutBias.Left],
	[LayoutDirection.RightToLeft, LayoutBias.Right],
] as const;

/** Nodes in documentary order; each relation runs `from` its first id `to` its second. */
function rankedDocument(
	ids: readonly string[],
	relations: readonly (readonly [string, string])[],
	direction: LayoutDirection,
	bias: LayoutBias,
): LogicDocument {
	let previous: string | undefined;
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'rank-order-search',
		title: 'Rank order search',
		layout: defined(layoutConfiguration(direction, bias)),
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [],
		junctions: [],
		nodes: ids.map((id) => {
			let slot = {};
			if (previous !== undefined) slot = { before: previous };
			previous = fractionalOrderKeySpace.keyFor(slot);
			return { id, kind: EndpointKind.Node, natureId: 'task', markdown: id, layoutOrder: previous };
		}),
		relations: relations.map(([from, to]) => ({ id: `${from}-${to}`, from, to })),
	};
}

/** The published layout and the fewest strict crossings any permutation of its bands routes with. */
function searchedAgainstEveryOrder(document: LogicDocument) {
	const created = createGraph(document);
	if (!created.ok) throw new Error('Invalid rank search witness');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const measurements = layoutMeasurementsFor(document);
	const strictCrossings = (layout: LayoutResult): number => {
		const validation = validateDedicatedCandidate({ graph, ranks, measurements, layout });
		if (!validation.valid) return Number.POSITIVE_INFINITY;
		return validation.score.strictCrossings;
	};
	const structure = prepareLayout(graph, ranks);
	const domain = collectRankOrderDomain(structure);
	const size = rankOrderEnumerationSize(domain);
	const fewest = Math.min(
		...enumerateRankOrders(domain, size).map((order) =>
			strictCrossings(
				evaluateDedicatedLayout(applyRankOrder(structure, domain, order), measurements),
			),
		),
	);
	const { layout, witness } = layoutWithDedicatedEngineAndRankOrderWitness(
		graph,
		ranks,
		measurements,
	);
	return { crossings: strictCrossings(layout), fewest, size, witness };
}

describe('dedicated rank order search on real routes', () => {
	it('routes every order a topological tie hides and keeps the one crossing least', () => {
		// Exchanges tie on topological crossings and documentary distance; only routes tell
		// them apart. Ranked on the topological proxy alone, the rows crossed three times.
		const relations = [
			['k0', 'r1'],
			['k0', 'r2'],
			['k1', 'r0'],
			['k1', 'r1'],
			['k1', 'r2'],
		] as const;
		const expected = {
			[LayoutDirection.TopToBottom]: 1,
			[LayoutDirection.BottomToTop]: 1,
			[LayoutDirection.LeftToRight]: 2,
			[LayoutDirection.RightToLeft]: 2,
		};
		for (const [direction, bias] of DIRECTIONS) {
			const searched = searchedAgainstEveryOrder(
				rankedDocument(['k0', 'k1', 'r0', 'r1', 'r2'], relations, direction, bias),
			);
			expect(searched.size).toBe(12);
			expect(searched.crossings).toBe(searched.fewest);
			expect(searched.crossings).toBe(expected[direction]);
			expect(searched.witness).toMatchObject({
				mode: 'exact',
				stop: RankSearchStop.Complete,
				proposed: 12,
				evaluated: 12,
				pruned: 0,
				exhaustive: true,
				truncated: false,
			});
		}
	});

	it('finds the crossing-free order the topological proxy ranks behind the selected one', () => {
		const relations = [
			['b', 'a'],
			['c', 'a'],
			['e', 'b'],
			['e', 'c'],
			['e', 'd'],
			['f', 'a'],
			['f', 'c'],
			['f', 'e'],
			['g', 'e'],
		] as const;
		for (const [direction, bias] of DIRECTIONS) {
			const searched = searchedAgainstEveryOrder(
				rankedDocument(['a', 'b', 'c', 'd', 'e', 'f', 'g'], relations, direction, bias),
			);
			expect(searched.fewest).toBe(0);
			expect(searched.crossings).toBe(0);
			// The search stops at the first crossing-free order: it never claims the others.
			expect(searched.witness).toMatchObject({
				mode: 'exact',
				stop: RankSearchStop.CrossingFree,
				pruned: 0,
				exhaustive: false,
				truncated: false,
			});
			expect(searched.witness.evaluated).toBe(searched.witness.proposed);
			expect(searched.witness.proposed).toBeLessThan(searched.size);
		}
	});
});
