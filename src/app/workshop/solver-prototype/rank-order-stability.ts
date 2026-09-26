import {
	defined,
	EndpointKind,
	type LogicDocument,
} from '../../../lib/core/document/logic-document';
import { createGraph } from '../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../lib/core/graph/topological-ranks';
import { validateDedicatedCandidate } from '../../../lib/core/layout/dedicated-candidate-validation';
import {
	evaluateDedicatedLayout,
	layoutWithDedicatedEngineAndRankOrderWitness,
} from '../../../lib/core/layout/layout-engine';
import type { LayoutRelation, LayoutResult, Point } from '../../../lib/core/layout/layout-types';
import type { RankOrderSearchWitness } from '../../../lib/core/layout/rank-order-search';
import { prepareLayout } from '../../../lib/core/layout/structure/prepare-layout';
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
	/** Motion after subtracting the median translation of common box centers. */
	readonly relativeMovedElements: number;
	readonly meanRelativeNormalizedMovement: number;
	readonly maxRelativeNormalizedMovement: number;
	readonly medianTranslation: Point;
	readonly rankChanges: number;
	readonly commonRelations: number;
	readonly portChanges: number;
	readonly pathChanges: number;
	/** Length and elbows of the same relation IDs, excluding added/removed relations. */
	readonly commonRouteLengthBefore: number;
	readonly commonRouteLengthAfter: number;
	readonly commonBendsBefore: number;
	readonly commonBendsAfter: number;
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
	readonly documentary: RankOrderStability;
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
	const resized = entry(base, document, {
		...base.measurements,
		nodes: new Map([...base.measurements.nodes, ['b', { width: 144, height: 60 }]]),
	});
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
			nodes: new Map<string, { width: number; height: number }>([
				...[...base.measurements.nodes].map(([id, size]) => [id, { ...size, width: 60 }] as const),
				...ids.map((id) => [id, { width: 80, height: 40 }] as const),
			]),
		},
	);
	const frontierIds = Array.from({ length: 13 }, (_, index) => `frontier-${index}`);
	const frontier = entry(
		base,
		{
			...document,
			nodes: [
				...document.nodes,
				...frontierIds.map((id) => ({
					id,
					kind: EndpointKind.Node as const,
					natureId: 'task',
					markdown: id,
					layoutOrder: fractionalOrderKeySpace.keyFor({ before: lastKey }),
				})),
			],
			relations: [
				...document.relations,
				...frontierIds.map((id, index) => {
					let to = 'a';
					if (index > 0) to = defined(frontierIds[index - 1]);
					return { id: `frontier-route-${index}`, from: id, to };
				}),
			],
		},
		{
			...base.measurements,
			nodes: new Map([
				...base.measurements.nodes,
				...frontierIds.map((id) => [id, { width: 80, height: 40 }] as const),
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
		{
			id: 'measurement-change',
			label: 'Modifier la largeur mesurée d’un nœud sans changer le graphe',
			before: base,
			after: resized,
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
			id: 'budget-frontier',
			label: 'Ajouter une relation dans la composante optimisée au seuil local',
			before: frontier,
			after: entry(frontier, {
				...frontier.document,
				relations: [
					...frontier.document.relations,
					{ id: 'frontier-shortcut', from: defined(frontierIds[0]), to: 'b' },
				],
			}),
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

function routeGeometry(relation: LayoutRelation): {
	readonly length: number;
	readonly bends: number;
} {
	let length = 0;
	let bends = 0;
	let previousAxis: 'x' | 'y' | undefined;
	for (let index = 1; index < relation.points.length; index += 1) {
		const previous = defined(relation.points[index - 1]);
		const current = defined(relation.points[index]);
		const dx = Math.abs(current.x - previous.x);
		const dy = Math.abs(current.y - previous.y);
		length += dx + dy;
		if (dx === 0 && dy === 0) continue;
		let axis: 'x' | 'y' = 'y';
		if (dx > 0) axis = 'x';
		if (previousAxis !== undefined && previousAxis !== axis) bends += 1;
		previousAxis = axis;
	}
	return { length, bends };
}

function observed(entry: RankOrderCorpusEntry) {
	const created = createGraph(entry.document);
	if (!created.ok) throw new Error(`Invalid rank mutation ${entry.id}: ${JSON.stringify(created)}`);
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const selected = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, entry.measurements);
	const documentary = evaluateDedicatedLayout(prepareLayout(graph, ranks), entry.measurements);
	const validation = validateDedicatedCandidate({
		graph,
		ranks,
		measurements: entry.measurements,
		layout: selected.layout,
	});
	return {
		documentary,
		...selected,
		ranks: ranks.byEndpointId,
		...(validation.valid && { crossings: validation.score.strictCrossings }),
	};
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	values.sort((left, right) => left - right);
	const middle = Math.floor(values.length / 2);
	if (values.length % 2 === 1) return defined(values[middle]);
	return (defined(values[middle - 1]) + defined(values[middle])) / 2;
}

function stability(
	before: LayoutResult,
	after: LayoutResult,
	beforeRanks: ReadonlyMap<string, number>,
	afterRanks: ReadonlyMap<string, number>,
): RankOrderStability {
	const later = new Map(after.elements.map((element) => [element.id, element]));
	const translations: { readonly x: number; readonly y: number; readonly diagonal: number }[] = [];
	let rankChanges = 0;
	for (const element of before.elements) {
		const next = later.get(element.id);
		if (next === undefined) continue;
		if (beforeRanks.get(element.id) !== afterRanks.get(element.id)) rankChanges += 1;
		const { bounds: old } = element;
		const { bounds: current } = next;
		translations.push({
			x: current.x + current.width / 2 - old.x - old.width / 2,
			y: current.y + current.height / 2 - old.y - old.height / 2,
			diagonal: Math.hypot(old.width, old.height),
		});
	}
	const commonElements = translations.length;
	const medianTranslation = {
		x: median(translations.map(({ x }) => x)),
		y: median(translations.map(({ y }) => y)),
	};
	let movedElements = 0;
	let relativeMovedElements = 0;
	let totalMovement = 0;
	let totalRelativeMovement = 0;
	let maxNormalizedMovement = 0;
	let maxRelativeNormalizedMovement = 0;
	for (const translation of translations) {
		const displacement = Math.hypot(translation.x, translation.y);
		const relative = Math.hypot(
			translation.x - medianTranslation.x,
			translation.y - medianTranslation.y,
		);
		if (displacement > 0) movedElements += 1;
		if (relative > 0) relativeMovedElements += 1;
		const normalized = displacement / translation.diagonal;
		const relativeNormalized = relative / translation.diagonal;
		totalMovement += normalized;
		totalRelativeMovement += relativeNormalized;
		maxNormalizedMovement = Math.max(maxNormalizedMovement, normalized);
		maxRelativeNormalizedMovement = Math.max(maxRelativeNormalizedMovement, relativeNormalized);
	}
	const routes = new Map(after.relations.map((relation) => [relation.id, relation]));
	let commonRelations = 0;
	let portChanges = 0;
	let pathChanges = 0;
	let commonRouteLengthBefore = 0;
	let commonRouteLengthAfter = 0;
	let commonBendsBefore = 0;
	let commonBendsAfter = 0;
	for (const relation of before.relations) {
		const next = routes.get(relation.id);
		if (next === undefined) continue;
		commonRelations += 1;
		if (!samePorts(relation, next)) portChanges += 1;
		if (!samePath(relation, next)) pathChanges += 1;
		const oldGeometry = routeGeometry(relation);
		const newGeometry = routeGeometry(next);
		commonRouteLengthBefore += oldGeometry.length;
		commonRouteLengthAfter += newGeometry.length;
		commonBendsBefore += oldGeometry.bends;
		commonBendsAfter += newGeometry.bends;
	}
	let meanNormalizedMovement = 0;
	let meanRelativeNormalizedMovement = 0;
	if (commonElements > 0) {
		meanNormalizedMovement = totalMovement / commonElements;
		meanRelativeNormalizedMovement = totalRelativeMovement / commonElements;
	}
	return {
		commonElements,
		movedElements,
		meanNormalizedMovement,
		maxNormalizedMovement,
		relativeMovedElements,
		meanRelativeNormalizedMovement,
		maxRelativeNormalizedMovement,
		medianTranslation,
		rankChanges,
		commonRelations,
		portChanges,
		pathChanges,
		commonRouteLengthBefore,
		commonRouteLengthAfter,
		commonBendsBefore,
		commonBendsAfter,
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
			documentary: stability(prior.documentary, next.documentary, prior.ranks, next.ranks),
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
