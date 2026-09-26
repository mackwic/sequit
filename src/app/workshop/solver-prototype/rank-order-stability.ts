import {
	defined,
	EndpointKind,
	type LogicDocument,
} from '../../../lib/core/document/logic-document';
import { createGraph } from '../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../lib/core/graph/topological-ranks';
import { validateDedicatedCandidate } from '../../../lib/core/layout/dedicated-candidate-validation';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../lib/core/layout/layout-engine';
import type { LayoutRelation, LayoutResult, Point } from '../../../lib/core/layout/layout-types';
import type { RankOrderSearchWitness } from '../../../lib/core/layout/rank-order-search';
import { fractionalOrderKeySpace } from '../../../lib/core/ordering/order-key-space';
import { rankOrderComparisonCorpus, type RankOrderCorpusEntry } from './rank-order-comparison';

export interface RankOrderMutation {
	readonly id: string;
	readonly label: string;
	readonly before: RankOrderCorpusEntry;
	readonly after: RankOrderCorpusEntry;
}

export interface RankOrderStability {
	readonly commonElements: number;
	readonly movedElements: number;
	/** Translation of each common box's center, divided by its previous box diagonal. */
	readonly meanNormalizedMovement: number;
	readonly maxNormalizedMovement: number;
	readonly rankChanges: number;
	readonly commonRelations: number;
	readonly portChanges: number;
	readonly pathChanges: number;
}

export interface RankOrderMutationComparison extends RankOrderStability {
	readonly id: string;
	readonly label: string;
	readonly addedElements: number;
	readonly removedElements: number;
	readonly addedRelations: number;
	readonly removedRelations: number;
	readonly beforeCrossings?: number;
	readonly afterCrossings?: number;
	readonly beforeWitness: RankOrderSearchWitness;
	readonly afterWitness: RankOrderSearchWitness;
}

function entry(
	base: RankOrderCorpusEntry,
	document: LogicDocument,
	measurements = base.measurements,
): RankOrderCorpusEntry {
	return { ...base, document, measurements };
}

/** Document edits, including an unrelated large component that crosses the global work frontier. */
export function rankOrderMutationCorpus(): readonly RankOrderMutation[] {
	const base = defined(rankOrderComparisonCorpus().find(({ id }) => id === 'geometric-2+2'));
	const { document } = base;
	const lastKey = defined(document.nodes.at(-1)).layoutOrder;
	const added = {
		id: 'f',
		kind: EndpointKind.Node,
		natureId: 'task',
		markdown: 'F',
		layoutOrder: fractionalOrderKeySpace.keyFor({ before: lastKey }),
	} as const;
	const withNode = entry(
		base,
		{
			...document,
			nodes: [...document.nodes, added],
			relations: [...document.relations, { id: 'a-f', from: 'a', to: 'f' }],
		},
		{
			...base.measurements,
			nodes: new Map([...base.measurements.nodes, ['f', { width: 80, height: 60 }]]),
		},
	);
	const withoutNode = entry(
		base,
		{
			...document,
			nodes: document.nodes.filter(({ id }) => id !== 'c'),
			relations: document.relations.filter(({ id }) => id !== 'c-d'),
		},
		{
			...base.measurements,
			nodes: new Map([...base.measurements.nodes].filter(([id]) => id !== 'c')),
		},
	);
	const ids = Array.from({ length: 65 }, (_, index) => `chain-${index}`);
	const large = entry(
		base,
		{
			...document,
			nodes: [
				...document.nodes,
				...ids.map((id) => ({
					id,
					kind: EndpointKind.Node as const,
					natureId: 'task',
					markdown: id,
					layoutOrder: fractionalOrderKeySpace.keyFor({ before: lastKey }),
				})),
			],
			relations: [
				...document.relations,
				...ids
					.slice(1)
					.map((id, index) => ({ id: `chain-route-${index}`, from: defined(ids[index]), to: id })),
			],
		},
		{
			...base.measurements,
			nodes: new Map([
				...base.measurements.nodes,
				...ids.map((id) => [id, { width: 80, height: 40 }] as const),
			]),
		},
	);
	return [
		{
			id: 'add-relation',
			label: 'Ajouter une relation locale',
			before: base,
			after: entry(base, {
				...document,
				relations: [...document.relations, { id: 'a-e', from: 'a', to: 'e' }],
			}),
		},
		{
			id: 'remove-relation',
			label: 'Retirer une relation locale',
			before: base,
			after: entry(base, {
				...document,
				relations: document.relations.filter(({ id }) => id !== 'c-d'),
			}),
		},
		{ id: 'add-node', label: 'Ajouter un nœud et une relation', before: base, after: withNode },
		{
			id: 'add-isolated-node',
			label: 'Ajouter un nœud indépendant sans toucher aux routes',
			before: base,
			after: entry(base, { ...document, nodes: [...document.nodes, added] }, withNode.measurements),
		},
		{
			id: 'remove-node',
			label: 'Retirer un nœud et sa relation',
			before: base,
			after: withoutNode,
		},
		{
			id: 'unrelated-shortcut',
			label: 'Ajouter un raccourci dans une chaîne indépendante',
			before: large,
			after: entry(large, {
				...large.document,
				relations: [
					...large.document.relations,
					{ id: 'extra-shortcut', from: defined(ids[0]), to: defined(ids[2]) },
				],
			}),
		},
	];
}

function samePoint(left: Point, right: Point): boolean {
	return left.x === right.x && left.y === right.y;
}

function samePath(left: LayoutRelation, right: LayoutRelation): boolean {
	return (
		left.points.length === right.points.length &&
		left.points.every((point, index) => samePoint(point, defined(right.points[index])))
	);
}

function samePorts(left: LayoutRelation, right: LayoutRelation): boolean {
	return (
		samePoint(defined(left.points[0]), defined(right.points[0])) &&
		samePoint(defined(left.points.at(-1)), defined(right.points.at(-1)))
	);
}

function observed(entry: RankOrderCorpusEntry) {
	const created = createGraph(entry.document);
	if (!created.ok) throw new Error(`Invalid rank mutation ${entry.id}: ${JSON.stringify(created)}`);
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const selected = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, entry.measurements);
	const validation = validateDedicatedCandidate({
		graph,
		ranks,
		measurements: entry.measurements,
		layout: selected.layout,
	});
	return {
		...selected,
		ranks: ranks.byEndpointId,
		...(validation.valid && { crossings: validation.score.strictCrossings }),
	};
}

function stability(
	before: LayoutResult,
	after: LayoutResult,
	beforeRanks: ReadonlyMap<string, number>,
	afterRanks: ReadonlyMap<string, number>,
): RankOrderStability {
	const later = new Map(after.elements.map((element) => [element.id, element]));
	let commonElements = 0;
	let movedElements = 0;
	let rankChanges = 0;
	let totalMovement = 0;
	let maxNormalizedMovement = 0;
	for (const element of before.elements) {
		const next = later.get(element.id);
		if (next === undefined) continue;
		commonElements += 1;
		if (beforeRanks.get(element.id) !== afterRanks.get(element.id)) rankChanges += 1;
		const { bounds: old } = element;
		const { bounds: current } = next;
		const displacement = Math.hypot(
			current.x + current.width / 2 - old.x - old.width / 2,
			current.y + current.height / 2 - old.y - old.height / 2,
		);
		if (displacement > 0) movedElements += 1;
		const normalized = displacement / Math.hypot(old.width, old.height);
		totalMovement += normalized;
		maxNormalizedMovement = Math.max(maxNormalizedMovement, normalized);
	}
	const routes = new Map(after.relations.map((relation) => [relation.id, relation]));
	let commonRelations = 0;
	let portChanges = 0;
	let pathChanges = 0;
	for (const relation of before.relations) {
		const next = routes.get(relation.id);
		if (next === undefined) continue;
		commonRelations += 1;
		if (!samePorts(relation, next)) portChanges += 1;
		if (!samePath(relation, next)) pathChanges += 1;
	}
	let meanNormalizedMovement = 0;
	if (commonElements > 0) meanNormalizedMovement = totalMovement / commonElements;
	return {
		commonElements,
		movedElements,
		meanNormalizedMovement,
		maxNormalizedMovement,
		rankChanges,
		commonRelations,
		portChanges,
		pathChanges,
	};
}

export function compareRankOrderMutations(
	mutations: readonly RankOrderMutation[],
): readonly RankOrderMutationComparison[] {
	return mutations.map(({ id, label, before, after }) => {
		const prior = observed(before);
		const next = observed(after);
		const priorElements = new Set(prior.layout.elements.map(({ id }) => id));
		const nextElements = new Set(next.layout.elements.map(({ id }) => id));
		const priorRelations = new Set(prior.layout.relations.map(({ id }) => id));
		const nextRelations = new Set(next.layout.relations.map(({ id }) => id));
		return {
			id,
			label,
			...stability(prior.layout, next.layout, prior.ranks, next.ranks),
			addedElements: [...nextElements].filter((endpointId) => !priorElements.has(endpointId))
				.length,
			removedElements: [...priorElements].filter((endpointId) => !nextElements.has(endpointId))
				.length,
			addedRelations: [...nextRelations].filter((relationId) => !priorRelations.has(relationId))
				.length,
			removedRelations: [...priorRelations].filter((relationId) => !nextRelations.has(relationId))
				.length,
			...(prior.crossings !== undefined && { beforeCrossings: prior.crossings }),
			...(next.crossings !== undefined && { afterCrossings: next.crossings }),
			beforeWitness: prior.witness,
			afterWitness: next.witness,
		};
	});
}
