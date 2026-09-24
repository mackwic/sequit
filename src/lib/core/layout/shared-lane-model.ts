import { compareCanonicalStrings } from '../canonical-string';
import {
	defined,
	EndpointKind,
	LaneOrientation,
	LayoutDirection,
	type LogicDocument,
} from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { LayoutMeasurements, LayoutOptions, Size } from './layout-types';
import { validateGroupMeasurement, validateSize } from './placement/validate-measurements';

export type LaneSide = -1 | 1;

export interface SharedLaneEndpoint {
	readonly id: string;
	readonly kind: EndpointKind.Node | EndpointKind.Group;
	readonly laneId: string;
	readonly laneIndex: number;
	readonly rank: number;
	readonly layoutOrder: string;
	readonly crossSize: number;
	readonly longSize: number;
	readonly row: number;
}

export interface SharedLanePlan {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly sourceSide: LaneSide;
	readonly targetSide: LaneSide;
	readonly sourceLaneIndex: number;
	readonly targetLaneIndex: number;
	readonly sameLane: boolean;
}

export interface SharedLaneInput {
	readonly laneIds: readonly string[];
	readonly orientation: LaneOrientation;
	readonly endpoints: ReadonlyMap<string, SharedLaneEndpoint>;
	readonly plans: readonly SharedLanePlan[];
	readonly vertical: boolean;
	readonly reverse: boolean;
}

export interface PreparedSharedLanes {
	readonly input?: SharedLaneInput;
	readonly reason?: string;
}

export function verticalDirection(direction: LayoutDirection): boolean {
	return direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
}

export function reverseDirection(direction: LayoutDirection): boolean {
	return direction === LayoutDirection.BottomToTop || direction === LayoutDirection.RightToLeft;
}

export function laneSide(sourceIndex: number, targetIndex: number, laneCount: number): LaneSide {
	if (sourceIndex < targetIndex) return 1;
	if (sourceIndex > targetIndex) return -1;
	if (sourceIndex === laneCount - 1) return -1;
	return 1;
}

export function orderedLaneIds(document: LogicDocument): readonly string[] {
	const lanes = [...defined(document.presentation).lanes];
	lanes.sort((a, b) => {
		const order = compareCanonicalStrings(a.layoutOrder, b.layoutOrder);
		if (order !== 0) return order;
		return compareCanonicalStrings(a.id, b.id);
	});
	return lanes.map(({ id }) => id);
}

function measuredSize(
	item: LogicDocument['nodes'][number] | LogicDocument['groups'][number],
	measurements: LayoutMeasurements,
): Size {
	if (item.kind === EndpointKind.Node) {
		const measured = measurements.nodes.get(item.id);
		if (measured === undefined) throw new Error(`Missing node measurement: ${item.id}`);
		return validateSize(measured, `nodes.${item.id}`);
	}
	const measured = measurements.groups.get(item.id);
	if (measured === undefined) throw new Error(`Missing group measurement: ${item.id}`);
	const group = validateGroupMeasurement(measured, item.id);
	return { width: group.minimumWidth, height: group.minimumHeight };
}

interface EndpointEnvironment {
	readonly laneIds: readonly string[];
	readonly vertical: boolean;
	readonly ranks: TopologicalRanks;
	readonly measurements: LayoutMeasurements;
}

function makeEndpoint(
	item: LogicDocument['nodes'][number] | LogicDocument['groups'][number],
	environment: EndpointEnvironment,
): SharedLaneEndpoint | undefined {
	const laneIndex = environment.laneIds.indexOf(item.laneId ?? '');
	if (laneIndex < 0) return undefined;
	const size = measuredSize(item, environment.measurements);
	let crossSize = size.height;
	let longSize = size.width;
	if (environment.vertical) {
		crossSize = size.width;
		longSize = size.height;
	}
	return {
		id: item.id,
		kind: item.kind,
		laneId: defined(environment.laneIds[laneIndex]),
		laneIndex,
		rank: environment.ranks.byEndpointId.get(item.id) ?? 0,
		layoutOrder: item.layoutOrder,
		crossSize,
		longSize,
		row: 0,
	};
}

function rankEndpoints(byLane: SharedLaneEndpoint[][]): Map<string, SharedLaneEndpoint> {
	const endpoints = new Map<string, SharedLaneEndpoint>();
	for (const lane of byLane) {
		lane.sort((a, b) => {
			const rank = a.rank - b.rank;
			if (rank !== 0) return rank;
			const order = compareCanonicalStrings(a.layoutOrder, b.layoutOrder);
			if (order !== 0) return order;
			return compareCanonicalStrings(a.id, b.id);
		});
		let previousRow = -1;
		for (const item of lane) {
			const row = Math.max(item.rank, previousRow + 1);
			endpoints.set(item.id, { ...item, row });
			previousRow = row;
		}
	}
	return endpoints;
}

function relationPlans(
	graph: LogicGraph,
	endpoints: ReadonlyMap<string, SharedLaneEndpoint>,
	laneCount: number,
	orientation: LaneOrientation,
): readonly SharedLanePlan[] {
	const plans: SharedLanePlan[] = [];
	for (const { relation } of graph.relations) {
		const source = defined(endpoints.get(relation.from));
		const target = defined(endpoints.get(relation.to));
		const sides = relationSides(source, target, laneCount, orientation);
		plans.push({
			id: relation.id,
			from: relation.from,
			to: relation.to,
			sourceSide: sides.source,
			targetSide: sides.target,
			sourceLaneIndex: source.laneIndex,
			targetLaneIndex: target.laneIndex,
			sameLane: source.laneIndex === target.laneIndex,
		});
	}
	return plans;
}

interface RelationSides {
	readonly source: LaneSide;
	readonly target: LaneSide;
}

function relationSides(
	source: SharedLaneEndpoint,
	target: SharedLaneEndpoint,
	laneCount: number,
	orientation: LaneOrientation,
): RelationSides {
	if (orientation === LaneOrientation.Parallel)
		return {
			source: laneSide(source.laneIndex, target.laneIndex, laneCount),
			target: laneSide(target.laneIndex, source.laneIndex, laneCount),
		};
	if (source.laneIndex < target.laneIndex) return { source: 1, target: -1 };
	if (source.laneIndex > target.laneIndex) return { source: -1, target: 1 };
	return { source: -1, target: -1 };
}

export function prepareSharedLanes(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: LayoutOptions,
): PreparedSharedLanes {
	const document = graph.document;
	if (document.presentation === undefined)
		return { reason: 'Explicit lane presentation is required.' };
	if (options.inspectRouting === true)
		return { reason: 'Routing inspection is not available for shared lanes yet.' };
	if (document.junctions.length > 0)
		return { reason: 'Junctions are outside the first shared layout policy.' };
	if (document.groups.some(({ groupId }) => groupId !== undefined))
		return { reason: 'Nested groups are outside the first shared layout policy.' };
	if (document.nodes.some(({ groupId }) => groupId !== undefined))
		return { reason: 'Groups with descendants are outside the first shared layout policy.' };
	const laneIds = orderedLaneIds(document);
	if (laneIds.length < 2 || laneIds.length > 3)
		return { reason: 'The first shared layout policy supports two or three lanes.' };
	const vertical = verticalDirection(document.layout.direction);
	const byLane = laneIds.map(() => [] as SharedLaneEndpoint[]);
	const environment = { laneIds, vertical, ranks, measurements };
	for (const item of [...document.nodes, ...document.groups]) {
		const endpoint = makeEndpoint(item, environment);
		if (endpoint === undefined) return { reason: `Endpoint ${item.id} has no explicit lane.` };
		defined(byLane[endpoint.laneIndex]).push(endpoint);
	}
	const endpoints = rankEndpoints(byLane);
	const plans = relationPlans(
		graph,
		endpoints,
		laneIds.length,
		document.presentation.laneOrientation,
	);
	return {
		input: {
			laneIds,
			orientation: document.presentation.laneOrientation,
			endpoints,
			plans,
			vertical,
			reverse: reverseDirection(document.layout.direction),
		},
	};
}
