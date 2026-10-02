import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { ITEM_GAP, OUTER_MARGIN, RAIL_SPACING } from '../layout-settings';
import type { LayoutRelation, Point } from '../layout-types';
import { routeChannel } from '../routing/channel-routing';
import type { ChannelEndpoint, ChannelRouting } from '../routing/channel-types';
import { channelPoints } from '../routing/materialize-node-routes';
import type { AdjacentAxes } from './independent-adjacent-measurements';
import type { LayoutContractCandidate } from './layout-contract';

interface ChannelPoint {
	readonly x: number;
	readonly y: number;
}

export function indexById(ids: readonly string[]): ReadonlyMap<string, number> {
	return new Map(ids.map((id, index) => [id, index]));
}

export function rails(
	graph: LogicGraph,
	candidate: LayoutContractCandidate,
	centers: ReadonlyMap<string, number>,
): readonly string[] {
	const sourceIndex = indexById(candidate.sourceOrder);
	const targetIndex = indexById(candidate.targetOrder);
	const incidences = new Map(candidate.targetOrder.map((id) => [id, 0]));
	for (const { relation } of graph.relations)
		incidences.set(relation.to, defined(incidences.get(relation.to)) + 1);
	const firstSource = defined(candidate.sourceOrder[0]);
	const lastSource = defined(candidate.sourceOrder.at(-1));
	const midpoint = (defined(centers.get(firstSource)) + defined(centers.get(lastSource))) / 2;
	return graph.relations
		.map(({ relation }) => relation)
		.sort((a, b) => {
			const degree = defined(incidences.get(a.to)) - defined(incidences.get(b.to));
			if (degree !== 0) return degree;
			const target = defined(centers.get(a.to));
			let sourceOrder = defined(sourceIndex.get(a.from)) - defined(sourceIndex.get(b.from));
			if (target < midpoint) sourceOrder = -sourceOrder;
			if (sourceOrder !== 0) return sourceOrder;
			return (
				defined(targetIndex.get(a.to)) - defined(targetIndex.get(b.to)) ||
				compareCanonicalStrings(a.id, b.id)
			);
		})
		.map(({ id }) => id);
}

export function orderedCenters(
	candidate: LayoutContractCandidate,
	firstCenter: number,
	step: number,
): ReadonlyMap<string, number> {
	const centers = new Map<string, number>();
	for (const [index, id] of candidate.sourceOrder.entries())
		centers.set(id, firstCenter + index * step);
	for (const [index, id] of candidate.targetOrder.entries())
		centers.set(id, firstCenter + index * step * 2);
	return centers;
}

function rowCrossExtent(ids: readonly string[], axes: ReadonlyMap<string, AdjacentAxes>): number {
	let extent = ITEM_GAP * Math.max(0, ids.length - 1);
	for (const id of ids) extent += defined(axes.get(id)).crossSize;
	return extent;
}

function packedRowCenters(
	ids: readonly string[],
	axes: ReadonlyMap<string, AdjacentAxes>,
	totalExtent: number,
	centers: Map<string, number>,
): void {
	const rowExtent = rowCrossExtent(ids, axes);
	let start = OUTER_MARGIN + (totalExtent - rowExtent) / 2;
	for (const id of ids) {
		const crossSize = defined(axes.get(id)).crossSize;
		centers.set(id, start + crossSize / 2);
		start += crossSize + ITEM_GAP;
	}
}

export function compactCenters(
	candidate: LayoutContractCandidate,
	axes: ReadonlyMap<string, AdjacentAxes>,
): { centers: ReadonlyMap<string, number>; crossExtent: number } {
	const contentExtent = Math.max(
		rowCrossExtent(candidate.sourceOrder, axes),
		rowCrossExtent(candidate.targetOrder, axes),
	);
	const centers = new Map<string, number>();
	packedRowCenters(candidate.sourceOrder, axes, contentExtent, centers);
	packedRowCenters(candidate.targetOrder, axes, contentExtent, centers);
	return { centers, crossExtent: contentExtent + OUTER_MARGIN * 2 };
}

function sharedPortKeys(
	positions: ReadonlyMap<string, number>,
	prefix: string,
): ReadonlyMap<string, string> {
	const relationIdsByPosition = new Map<number, string[]>();
	for (const [relationId, position] of positions) {
		const relationIds = relationIdsByPosition.get(position) ?? [];
		relationIds.push(relationId);
		relationIdsByPosition.set(position, relationIds);
	}
	const keys = new Map<string, string>();
	for (const [position, relationIds] of relationIdsByPosition) {
		if (relationIds.length < 2) continue;
		const key = `${prefix}:${position}`;
		for (const relationId of relationIds) keys.set(relationId, key);
	}
	return keys;
}

export function channelFor(input: {
	readonly graph: LogicGraph;
	readonly sourceByRelation: ReadonlyMap<string, number>;
	readonly targetByRelation: ReadonlyMap<string, number>;
}): ChannelRouting {
	const { graph, sourceByRelation, targetByRelation } = input;
	const sharedSources = sharedPortKeys(sourceByRelation, 'source');
	const sharedTargets = sharedPortKeys(targetByRelation, 'target');
	const endpoints: ChannelEndpoint[] = graph.relations.map(({ relation }) => ({
		id: relation.id,
		source: defined(sourceByRelation.get(relation.id)),
		target: defined(targetByRelation.get(relation.id)),
		sharedSource: sharedSources.get(relation.id),
		sharedTarget: sharedTargets.get(relation.id),
	}));
	return routeChannel(endpoints);
}

export function legacyMaterializedRelations(input: {
	readonly graph: LogicGraph;
	readonly projectPoint: (point: { readonly u: number; readonly v: number }) => Point;
	readonly sourceByRelation: ReadonlyMap<string, number>;
	readonly targetByRelation: ReadonlyMap<string, number>;
	readonly railByRelation: ReadonlyMap<string, number>;
	readonly sourceTop: number;
	readonly targetBottom: number;
}): readonly LayoutRelation[] {
	const {
		graph,
		projectPoint,
		sourceByRelation,
		targetByRelation,
		railByRelation,
		sourceTop,
		targetBottom,
	} = input;
	return graph.relations.map(({ relation }) => {
		const sourceU = defined(sourceByRelation.get(relation.id));
		const targetU = defined(targetByRelation.get(relation.id));
		const rail = defined(railByRelation.get(relation.id));
		const points = [
			{ u: sourceU, v: sourceTop },
			{ u: sourceU, v: rail },
			{ u: targetU, v: rail },
			{ u: targetU, v: targetBottom },
		];
		return { ...relation, points: points.map(projectPoint) };
	});
}

export function channelMaterializedRelations(input: {
	readonly graph: LogicGraph;
	readonly projectPoint: (point: ChannelPoint) => Point;
	readonly channel: ChannelRouting;
	readonly sourceTop: number;
	readonly targetBottom: number;
}): readonly LayoutRelation[] {
	const { graph, projectPoint, channel, sourceTop, targetBottom } = input;
	const halfSpan = ((channel.railCount - 1) * RAIL_SPACING) / 2;
	const channelGeometry = {
		vertical: true,
		railStart: (sourceTop + targetBottom) / 2 + halfSpan,
		railStep: -RAIL_SPACING,
		frames: [],
	};
	const pointsByRelation = new Map(
		channel.wires.map((wire) => [
			wire.id,
			channelPoints(wire, sourceTop, targetBottom, channelGeometry).map(projectPoint),
		]),
	);
	return graph.relations.map(({ relation }) => ({
		...relation,
		points: defined(pointsByRelation.get(relation.id)),
	}));
}
