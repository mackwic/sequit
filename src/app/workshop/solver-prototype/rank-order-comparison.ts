import {
	defined,
	EndpointKind,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	type LogicRelation,
	PERSISTENCE_FORMAT,
} from '../../../lib/core/document/logic-document';
import { createGraph } from '../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../lib/core/graph/topological-ranks';
import { compareDedicatedRouteScores } from '../../../lib/core/layout/dedicated-candidate-validation/route-score';
import type { DedicatedRouteScore } from '../../../lib/core/layout/dedicated-candidate-validation/types';
import { validateDedicatedCandidate } from '../../../lib/core/layout/dedicated-candidate-validation/validate';
import {
	evaluateDedicatedLayout,
	layoutWithDedicatedEngineAndRankOrderWitness,
} from '../../../lib/core/layout/layout-engine';
import type { LayoutMeasurements, LayoutResult } from '../../../lib/core/layout/layout-types';
import {
	compareRankOrders,
	countRankOrderCrossings,
	documentaryRankOrder,
	enumerateRankOrders,
	type RankDomain,
	type RankOrder,
	rankOrderEnumerationSize,
	rankOrderKendallDistance,
	type RankOrderRelation,
	validateRankOrder,
} from '../../../lib/core/layout/rank/rank-order';
import type { RankOrderSearchWitness } from '../../../lib/core/layout/rank/rank-order-witness';
import {
	applyRankOrder,
	collectRankOrderDomain,
} from '../../../lib/core/layout/rank/rank-ordering';
import { prepareLayout } from '../../../lib/core/layout/structure/prepare-layout';
import {
	type EndpointSlot,
	fractionalOrderKeySpace,
} from '../../../lib/core/ordering/order-key-space';
import { realK32Fixture } from './real-k32-witness';

export interface RankOrderCorpusEntry {
	readonly id: string;
	readonly label: string;
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
}

export interface RankOrderComparisonEntry {
	readonly id: string;
	readonly label: string;
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly relations: readonly LogicRelation[];
	readonly domain: RankDomain;
	readonly documentary: RankOrder;
	readonly enumerated: RankOrder;
	readonly selectedOrder: RankOrder;
	readonly selectedKendall: number;
	readonly documentaryCrossings: number;
	readonly enumeratedCrossings: number;
	readonly documentaryValid: boolean;
	readonly enumeratedValid: boolean;
	readonly divergence: boolean;
	readonly enumeratedCount: number;
	readonly layout: LayoutResult;
	readonly documentaryRouteScore?: DedicatedRouteScore;
	readonly selectedRouteScore?: DedicatedRouteScore;
	readonly exhaustiveRouteScore?: DedicatedRouteScore;
	readonly witness: RankOrderSearchWitness;
}

export interface RankOrderComparison {
	readonly entries: readonly RankOrderComparisonEntry[];
}

function corpusEntry(
	id: string,
	label: string,
	ids: readonly string[],
	relations: readonly LogicRelation[],
): RankOrderCorpusEntry {
	const orderKeys = new Map<string, string>();
	let previous: string | undefined;
	for (const endpointId of ids) {
		let slot: EndpointSlot = {};
		if (previous !== undefined) slot = { before: previous };
		previous = fractionalOrderKeySpace.keyFor(slot);
		orderKeys.set(endpointId, previous);
	}
	const document: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id,
		title: label,
		layout: defined(layoutConfiguration(LayoutDirection.TopToBottom, LayoutBias.Top)),
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [],
		junctions: [],
		nodes: ids.map((endpointId) => ({
			id: endpointId,
			kind: EndpointKind.Node,
			natureId: 'task',
			markdown: endpointId.toUpperCase(),
			layoutOrder: defined(orderKeys.get(endpointId)),
		})),
		relations,
	};
	return {
		id,
		label,
		document,
		measurements: {
			nodes: new Map(ids.map((endpointId) => [endpointId, { width: 80, height: 60 }])),
			groups: new Map(),
			junctions: new Map(),
		},
	};
}

/**
 * The adjacent 3+1 and 2+2 documents already probed by the adjacent comparison, plus three
 * single-band catalogue topologies mirrored here: `src/` may not import the visual test
 * catalogue under `tests/`, and each is a plain two-rank document with at most four nodes.
 */
export function rankOrderComparisonCorpus(): readonly RankOrderCorpusEntry[] {
	const adjacent = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'sparse');
	const horizontal = realK32Fixture(LayoutDirection.LeftToRight, 'd-e', 'sparse');
	return [
		{
			id: 'adjacent-3+1',
			label: 'Adjacent 3+1',
			document: adjacent.document,
			measurements: adjacent.measurements,
		},
		corpusEntry(
			'adjacent-2+2',
			'Adjacent 2+2',
			['a', 'b', 'c', 'd', 'e'],
			[
				{ id: 'a-d', from: 'a', to: 'd' },
				{ id: 'b-d', from: 'b', to: 'd' },
				{ id: 'a-e', from: 'a', to: 'e' },
				{ id: 'c-e', from: 'c', to: 'e' },
			],
		),
		corpusEntry(
			'two-successors',
			'Catalogue : deux successeurs',
			['a', 'b', 'c'],
			[
				{ id: 'a-b', from: 'a', to: 'b' },
				{ id: 'a-c', from: 'a', to: 'c' },
			],
		),
		corpusEntry(
			'two-predecessors',
			'Catalogue : deux prédécesseurs',
			['a', 'b', 'c'],
			[
				{ id: 'a-c', from: 'a', to: 'c' },
				{ id: 'b-c', from: 'b', to: 'c' },
			],
		),
		corpusEntry(
			'three-predecessors',
			'Catalogue : trois prédécesseurs',
			['a', 'b', 'c', 'd'],
			[
				{ id: 'a-d', from: 'a', to: 'd' },
				{ id: 'b-d', from: 'b', to: 'd' },
				{ id: 'c-d', from: 'c', to: 'd' },
			],
		),
		{
			id: 'geometric-3+1',
			label: 'Geometric 3+1 (horizontal)',
			document: horizontal.document,
			measurements: horizontal.measurements,
		},
		corpusEntry(
			'geometric-2+2',
			'Geometric 2+2',
			['a', 'b', 'c', 'd', 'e'],
			[
				{ id: 'a-d', from: 'a', to: 'd' },
				{ id: 'b-d', from: 'b', to: 'd' },
				{ id: 'b-e', from: 'b', to: 'e' },
				{ id: 'c-d', from: 'c', to: 'd' },
			],
		),
	];
}

/** The fewest-crossing enumerated order, ties broken by canonical band order. */
function bestEnumeratedOrder(
	orders: readonly RankOrder[],
	relations: readonly RankOrderRelation[],
): { readonly order: RankOrder; readonly crossings: number } {
	const [first, ...rest] = orders;
	const initial = defined(first);
	let best: RankOrder = initial;
	let bestCrossings = countRankOrderCrossings(initial, relations);
	for (const order of rest) {
		const crossings = countRankOrderCrossings(order, relations);
		const improves = crossings < bestCrossings;
		const ties = crossings === bestCrossings && compareRankOrders(order, best) < 0;
		if (improves || ties) {
			best = order;
			bestCrossings = crossings;
		}
	}
	return { order: best, crossings: bestCrossings };
}

function compareRankOrderEntry(entry: RankOrderCorpusEntry): RankOrderComparisonEntry {
	const created = createGraph(entry.document);
	if (!created.ok) throw new Error(`Rank order corpus entry ${entry.id} did not create a graph.`);
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const domain: RankDomain = { bands: ranks.bands };
	const endpoints = [
		...entry.document.groups,
		...entry.document.nodes,
		...entry.document.junctions,
	];
	const documentary = documentaryRankOrder(domain, { endpoints });
	const orders = enumerateRankOrders(domain, rankOrderEnumerationSize(domain));
	const best = bestEnumeratedOrder(orders, entry.document.relations);
	const documentaryCrossings = countRankOrderCrossings(documentary, entry.document.relations);
	const structure = prepareLayout(graph, ranks);
	const movable = collectRankOrderDomain(structure);
	const baseline = evaluateDedicatedLayout(structure, entry.measurements);
	const baselineValidation = validateDedicatedCandidate({
		graph,
		ranks,
		measurements: entry.measurements,
		layout: baseline,
	});
	let exhaustiveRouteScore: DedicatedRouteScore | undefined;
	for (const order of enumerateRankOrders(movable, rankOrderEnumerationSize(movable))) {
		const layout = evaluateDedicatedLayout(
			applyRankOrder(structure, movable, order),
			entry.measurements,
		);
		const validation = validateDedicatedCandidate({
			graph,
			ranks,
			measurements: entry.measurements,
			layout,
		});
		if (!validation.valid) continue;
		if (
			exhaustiveRouteScore === undefined ||
			compareDedicatedRouteScores(validation.score, exhaustiveRouteScore) < 0
		)
			exhaustiveRouteScore = validation.score;
	}
	const selected = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, entry.measurements);
	const selectedValidation = validateDedicatedCandidate({
		graph,
		ranks,
		measurements: entry.measurements,
		layout: selected.layout,
	});
	const byId = new Map(selected.layout.elements.map(({ id, bounds }) => [id, bounds]));
	let transverse: 'x' | 'y' = 'x';
	if (
		entry.document.layout.direction === LayoutDirection.LeftToRight ||
		entry.document.layout.direction === LayoutDirection.RightToLeft
	)
		transverse = 'y';
	const selectedOrder = domain.bands.map((band) =>
		[...band].sort(
			(left, right) => defined(byId.get(left))[transverse] - defined(byId.get(right))[transverse],
		),
	);
	return {
		id: entry.id,
		label: entry.label,
		document: entry.document,
		measurements: entry.measurements,
		relations: entry.document.relations,
		domain,
		documentary,
		enumerated: best.order,
		selectedOrder,
		selectedKendall: rankOrderKendallDistance(selectedOrder, documentary),
		documentaryCrossings,
		enumeratedCrossings: best.crossings,
		documentaryValid: validateRankOrder(domain, documentary),
		enumeratedValid: validateRankOrder(domain, best.order),
		divergence: best.crossings < documentaryCrossings,
		enumeratedCount: orders.length,
		layout: selected.layout,
		witness: selected.witness,
		...(baselineValidation.valid && { documentaryRouteScore: baselineValidation.score }),
		...(selectedValidation.valid && { selectedRouteScore: selectedValidation.score }),
		...(exhaustiveRouteScore !== undefined && { exhaustiveRouteScore }),
	};
}

/** Compare documentary order with the best enumerated order on the same corpus. */
export function compareRankOrderCorpus(
	corpus: readonly RankOrderCorpusEntry[],
): RankOrderComparison {
	return { entries: corpus.map(compareRankOrderEntry) };
}
