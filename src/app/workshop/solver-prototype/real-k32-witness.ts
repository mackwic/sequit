import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
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
import type { OrderKey } from '../../../lib/core/document/order-key';
import { createGraph } from '../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../lib/core/graph/topological-ranks';
import {
	isVerticalDirection,
	transverseCenter,
	transverseSize,
} from '../../../lib/core/layout/geometry/layout-frame';
import type {
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
	Point,
	Size,
} from '../../../lib/core/layout/layout-types';
import { RoutingPortRole } from '../../../lib/core/layout/layout-types';
import type { ConditionalPortConflicts } from '../../../lib/core/layout/routing/conditional-port-conflicts';
import {
	graphCorridorConflicts,
	GraphCorridorStatus,
} from '../../../lib/core/layout/routing/graph-corridor-conflicts';
import { orderEndpoints } from '../../../lib/core/ordering/endpoint-order';
import { fractionalOrderKeySpace } from '../../../lib/core/ordering/order-key-space';
import { layoutGraph } from '../../web/projection/layout-graph';

export interface RealK32Fixture {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
}

export type K32TargetOrder = 'd-e' | 'e-d';
export type K32Variant = 'sparse' | 'complete';

interface ObservedCrossing {
	readonly firstRelationId: string;
	readonly secondRelationId: string;
	readonly point: Point;
}

interface RealK32Summary {
	readonly direction: LayoutDirection;
	readonly variant: K32Variant;
	readonly ranks: readonly { readonly id: string; readonly rank: number }[];
	readonly sourceOrder: readonly string[];
	readonly targetOrder: readonly string[];
	readonly observedSourceOrder: readonly string[];
	readonly observedTargetOrder: readonly string[];
	readonly targets: readonly {
		readonly id: string;
		readonly intrinsicCrossSize: number;
		readonly allocatedCrossSize: number;
		readonly incomingPorts: readonly {
			readonly point: Point;
			readonly relationIds: readonly string[];
		}[];
	}[];
	readonly routes: readonly LayoutRelation[];
	readonly crossings: readonly ObservedCrossing[];
	readonly conditionalConflicts: ConditionalPortConflicts | undefined;
	readonly assessment: 'confirmed' | 'unproven';
	readonly diagnostics: readonly string[];
}

export interface RealK32Witness {
	readonly layout: LayoutResult;
	readonly ranks: ReadonlyMap<string, number>;
	readonly summary: RealK32Summary;
}

function biasFor(direction: LayoutDirection): LayoutBias {
	if (direction === LayoutDirection.BottomToTop) return LayoutBias.Bottom;
	if (direction === LayoutDirection.LeftToRight) return LayoutBias.Left;
	if (direction === LayoutDirection.RightToLeft) return LayoutBias.Right;
	return LayoutBias.Top;
}

/** The complete variant matches `three-incoming-ports`; sparse exposes the port choice. */
export function realK32Fixture(
	direction: LayoutDirection,
	targetOrder: K32TargetOrder = 'd-e',
	variant: K32Variant = 'sparse',
): RealK32Fixture {
	const ids = ['a', 'b', 'c', 'd', 'e'];
	if (targetOrder === 'e-d') ids.splice(3, 2, 'e', 'd');
	const orderKeys = new Map<string, OrderKey>();
	let previous: OrderKey | undefined;
	for (const id of ids) {
		let slot = {};
		if (previous !== undefined) slot = { before: previous };
		previous = fractionalOrderKeySpace.keyFor(slot);
		orderKeys.set(id, previous);
	}
	let relations = ['a', 'b', 'c'].flatMap((from) =>
		['d', 'e'].map((to) => ({ id: `${from}-to-${to}`, from, to })),
	);
	if (variant === 'sparse')
		relations = relations.filter(({ id }) => ['a-to-d', 'b-to-d', 'c-to-d', 'a-to-e'].includes(id));
	const document: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'real-k32-witness',
		title: 'Trois arrivées saturent une face étroite',
		layout: defined(layoutConfiguration(direction, biasFor(direction))),
		natures: [{ id: 'goal', label: 'Goal', color: '#285448' }],
		groups: [],
		junctions: [],
		nodes: ids.map((id) => ({
			id,
			kind: EndpointKind.Node,
			natureId: 'goal',
			markdown: id.toUpperCase(),
			layoutOrder: defined(orderKeys.get(id)),
		})),
		relations,
	};
	let size: Size = { width: 80, height: 60 };
	if (!isVerticalDirection(direction)) size = { width: 60, height: 80 };
	return {
		document,
		measurements: {
			nodes: new Map(ids.map((id) => [id, size])),
			groups: new Map(),
			junctions: new Map(),
		},
	};
}

interface Segment {
	readonly relationId: string;
	readonly axis: 'x' | 'y';
	readonly fixed: number;
	readonly start: number;
	readonly end: number;
}

function segmentsFor(route: LayoutRelation): Segment[] {
	const segments: Segment[] = [];
	for (let index = 1; index < route.points.length; index += 1) {
		const before = defined(route.points[index - 1]);
		const after = defined(route.points[index]);
		if (before.x === after.x && before.y !== after.y)
			segments.push({
				relationId: route.id,
				axis: 'y',
				fixed: before.x,
				start: Math.min(before.y, after.y),
				end: Math.max(before.y, after.y),
			});
		if (before.y === after.y && before.x !== after.x)
			segments.push({
				relationId: route.id,
				axis: 'x',
				fixed: before.y,
				start: Math.min(before.x, after.x),
				end: Math.max(before.x, after.x),
			});
	}
	return segments;
}

function observedCrossings(routes: readonly LayoutRelation[]): ObservedCrossing[] {
	const segments = routes.flatMap(segmentsFor);
	const crossings = new Map<string, ObservedCrossing>();
	for (const horizontal of segments.filter(({ axis }) => axis === 'x')) {
		for (const vertical of segments.filter(({ axis }) => axis === 'y')) {
			if (horizontal.relationId === vertical.relationId) continue;
			const { fixed: x } = vertical;
			const { fixed: y } = horizontal;
			if (x <= horizontal.start || x >= horizontal.end || y <= vertical.start || y >= vertical.end)
				continue;
			const ids = [horizontal.relationId, vertical.relationId].sort(compareCanonicalStrings);
			const firstRelationId = defined(ids[0]);
			const secondRelationId = defined(ids[1]);
			crossings.set(JSON.stringify([firstRelationId, secondRelationId, x, y]), {
				firstRelationId,
				secondRelationId,
				point: { x, y },
			});
		}
	}
	return [...crossings.values()].sort(
		(a, b) =>
			compareCanonicalStrings(a.firstRelationId, b.firstRelationId) ||
			compareCanonicalStrings(a.secondRelationId, b.secondRelationId) ||
			a.point.x - b.point.x ||
			a.point.y - b.point.y,
	);
}

function rowOrder(
	ids: readonly string[],
	layout: LayoutResult,
	vertical: boolean,
): readonly string[] {
	const included = new Set(ids);
	return layout.elements
		.filter(({ id }) => included.has(id))
		.toSorted(
			(a, b) =>
				transverseCenter(a.bounds, vertical) - transverseCenter(b.bounds, vertical) ||
				compareCanonicalStrings(a.id, b.id),
		)
		.map(({ id }) => id);
}

function sameOrder(first: readonly string[], second: readonly string[]): boolean {
	return first.length === second.length && first.every((id, index) => id === second[index]);
}

function crossCoordinate(point: Point, vertical: boolean): number {
	if (vertical) return point.x;
	return point.y;
}

function rankOf(ids: readonly string[], ranks: ReadonlyMap<string, number>): number | undefined {
	const first = ids[0];
	if (first === undefined) return undefined;
	const rank = ranks.get(first);
	if (ids.some((id) => ranks.get(id) !== rank)) return undefined;
	return rank;
}

function hasExpectedTopology(
	relations: readonly LogicRelation[],
	sources: readonly string[],
	targets: readonly string[],
	variant: K32Variant,
): boolean {
	if (sources.length !== 3 || targets.length !== 2) return false;
	const expected = new Map([
		['a-to-d', ['a', 'd']],
		['b-to-d', ['b', 'd']],
		['c-to-d', ['c', 'd']],
		['a-to-e', ['a', 'e']],
	]);
	if (variant === 'complete') {
		expected.set('b-to-e', ['b', 'e']);
		expected.set('c-to-e', ['c', 'e']);
	}
	return (
		relations.length === expected.size &&
		relations.every(({ id, from, to }) => {
			const endpoints = expected.get(id);
			return endpoints?.[0] === from && endpoints[1] === to;
		})
	);
}

/** Probes the actual graph/rank/layout pipeline; final coordinates only check the symbolic premise. */
export async function runRealK32Witness(
	direction: LayoutDirection,
	requestedTargetOrder: K32TargetOrder = 'd-e',
	variant: K32Variant = 'sparse',
	fixture: RealK32Fixture = realK32Fixture(direction, requestedTargetOrder, variant),
): Promise<RealK32Witness> {
	const { document, measurements } = fixture;
	const created = createGraph(document);
	if (!created.ok) throw new Error(created.diagnostics.map(({ message }) => message).join('; '));
	const graph = created.value;
	const rankResult = topologicallyRank(graph);
	const ranks = rankResult.byEndpointId;
	const relations = graph.relations.map(({ relation }) => relation);
	const sources = [...new Set(relations.map(({ from }) => from))].sort(compareCanonicalStrings);
	const targets = [...new Set(relations.map(({ to }) => to))].sort(compareCanonicalStrings);
	const orderedIds = orderEndpoints(document.nodes);
	const sourceSet = new Set(sources);
	const targetSet = new Set(targets);
	const sourceOrder = orderedIds.filter((id) => sourceSet.has(id));
	const targetOrder = orderedIds.filter((id) => targetSet.has(id));
	const sourceRank = rankOf(sources, ranks);
	const targetRank = rankOf(targets, ranks);
	const layout = await layoutGraph(graph, rankResult, measurements, {
		inspectRouting: true,
	});
	const vertical = isVerticalDirection(direction);
	const observedSourceOrder = rowOrder(sources, layout, vertical);
	const observedTargetOrder = rowOrder(targets, layout, vertical);
	const crossings = observedCrossings(layout.relations);
	const diagnostic: string[] = [];
	if (document.layout.direction !== direction) diagnostic.push('Direction du document différente.');
	if (document.groups.length > 0 || document.junctions.length > 0)
		diagnostic.push('Attaches de groupe ou de jonction hors du témoin K3,2.');
	if (!hasExpectedTopology(relations, sources, targets, variant))
		diagnostic.push(`Le graphe ne forme pas la variante ${variant} attendue.`);
	if (sourceRank === undefined || targetRank === undefined || sourceRank !== targetRank + 1)
		diagnostic.push('Les deux rangs source et cible ne sont pas adjacents.');
	if (!sameOrder(sourceOrder, observedSourceOrder) || !sameOrder(targetOrder, observedTargetOrder))
		diagnostic.push('L’ordre documentaire ne correspond pas à l’ordre transversal matérialisé.');
	let conditionalConflicts: ConditionalPortConflicts | undefined;
	if (diagnostic.length === 0 && sourceRank !== undefined && targetRank !== undefined) {
		const analyzed = graphCorridorConflicts(graph, rankResult, {
			sourceRank,
			targetRank,
			sourceOrder,
			targetOrder,
			passage: 'monotone-adjacent-corridor',
		});
		if (analyzed.status === GraphCorridorStatus.Deduced) conditionalConflicts = analyzed.conflicts;
		else diagnostic.push(`Le corridor symbolique reste inconnu : ${analyzed.reason}.`);
	}
	if (conditionalConflicts !== undefined) {
		const corridorAllocated =
			layout.routingInspection?.corridors.some(
				({ rank, allocated }) => rank === targetRank && allocated,
			) ?? false;
		if (conditionalConflicts.inversions.length > 0 && !corridorAllocated)
			diagnostic.push('Aucun corridor adjacent alloué malgré les inversions.');
		const observedPairs = new Set(
			crossings.map(({ firstRelationId, secondRelationId }) =>
				JSON.stringify([firstRelationId, secondRelationId]),
			),
		);
		for (const { firstRelationId, secondRelationId } of conditionalConflicts.inversions)
			if (!observedPairs.has(JSON.stringify([firstRelationId, secondRelationId])))
				diagnostic.push(`Inversion non observée : ${firstRelationId}, ${secondRelationId}.`);
	}
	const targetsSummary = targets.map((id) => {
		const intrinsic = defined(measurements.nodes.get(id));
		const element = defined(layout.elements.find((candidate) => candidate.id === id));
		const inspected = defined(layout.routingInspection?.nodes.find((node) => node.id === id));
		return {
			id,
			intrinsicCrossSize: transverseSize(intrinsic, vertical),
			allocatedCrossSize: transverseSize(element.bounds, vertical),
			incomingPorts: inspected.ports
				.filter(({ role }) => role === RoutingPortRole.Incoming)
				.map(({ point, relations: relationIds }) => ({
					point,
					relationIds: [...relationIds].sort(compareCanonicalStrings),
				}))
				.sort((a, b) => crossCoordinate(a.point, vertical) - crossCoordinate(b.point, vertical)),
		};
	});
	if (conditionalConflicts !== undefined)
		for (const {
			endpointId,
			firstRelationId,
			secondRelationId,
		} of conditionalConflicts.requiredSeparations) {
			const target = defined(targetsSummary.find(({ id }) => id === endpointId));
			const shared = target.incomingPorts.some(
				({ relationIds }) =>
					relationIds.includes(firstRelationId) && relationIds.includes(secondRelationId),
			);
			if (shared)
				diagnostic.push(`Port partagé malgré conflit : ${firstRelationId}, ${secondRelationId}.`);
		}
	let assessment: RealK32Summary['assessment'] = 'confirmed';
	if (diagnostic.length > 0) assessment = 'unproven';
	return {
		layout,
		ranks,
		summary: {
			direction,
			variant,
			ranks: [...ranks]
				.map(([id, rank]) => ({ id, rank }))
				.sort((a, b) => compareCanonicalStrings(a.id, b.id)),
			sourceOrder,
			targetOrder,
			observedSourceOrder,
			observedTargetOrder,
			targets: targetsSummary,
			routes: [...layout.relations].sort((a, b) => compareCanonicalStrings(a.id, b.id)),
			crossings,
			conditionalConflicts,
			assessment,
			diagnostics: diagnostic,
		},
	};
}
