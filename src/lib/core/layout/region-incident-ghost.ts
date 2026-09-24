import {
	defined,
	EndpointKind,
	LayoutDirection,
	type LayoutPolicy,
	type LogicDocument,
	type LogicNode,
	type LogicRelation,
} from '../document/logic-document';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { LayoutMeasurements, LayoutRelation, LayoutResult, Point } from './layout-types';
import type {
	NestedRegionLocalLayout,
	NestedRegionLocalLayoutCache,
} from './nested-region-local-cache';
import { NestedPortalSide } from './nested-region-types';
import {
	freshId,
	geometryFailure,
	type ProjectionFrame,
	projectionFrame,
	type RegionIncidentGhostFailure,
	RegionIncidentGhostStatus,
	solveGhostLeaf,
	translatePoint,
	unavailable,
} from './region-incident-ghost-common';

export interface RegionIncidentGhostInput {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly relationId: string;
	readonly endpointId: string;
	readonly side: NestedPortalSide;
	readonly policy?: LayoutPolicy;
	readonly cache?: NestedRegionLocalLayoutCache;
}

interface RegionIncidentGhostSelected {
	readonly status: RegionIncidentGhostStatus.Selected;
	/** The auxiliary node and relation are absent; the requested side is the canvas boundary. */
	readonly layout: LayoutResult;
	/** Real endpoint ranks retain their positions in the augmented solve. */
	readonly ranks: TopologicalRanks;
	readonly incident: RegionGhostIncident;
}

interface RegionGhostIncident {
	readonly relationId: string;
	readonly endpointId: string;
	readonly side: NestedPortalSide;
	readonly anchor: Point;
	readonly portal: Point;
	readonly points: readonly Point[];
}

export type RegionIncidentGhostAttempt = RegionIncidentGhostSelected | RegionIncidentGhostFailure;

interface AuxiliaryLeaf {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly nodeId: string;
	readonly routeId: string;
}

function auxiliaryIds(
	document: LogicDocument,
	relationId: string,
): {
	readonly nodeId: string;
	readonly routeId: string;
} {
	const occupied = new Set([
		...document.nodes.map(({ id }) => id),
		...document.groups.map(({ id }) => id),
		...document.junctions.map(({ id }) => id),
		...document.relations.map(({ id }) => id),
		relationId,
	]);
	const nodeId = freshId(`@region-incident-ghost/${relationId}`, occupied);
	occupied.add(nodeId);
	return {
		nodeId,
		routeId: freshId(`@region-incident-route/${relationId}`, occupied),
	};
}

function materialize(input: RegionIncidentGhostInput, source: LogicNode): AuxiliaryLeaf {
	const { nodeId, routeId } = auxiliaryIds(input.document, input.relationId);
	const ghost: LogicNode = {
		kind: EndpointKind.Node,
		id: nodeId,
		natureId: source.natureId,
		markdown: 'Ghost\n',
		layoutOrder: source.layoutOrder,
	};
	const route: LogicRelation = {
		id: routeId,
		from: input.endpointId,
		to: nodeId,
	};
	return {
		document: {
			...input.document,
			nodes: [...input.document.nodes, ghost],
			relations: [...input.document.relations, route],
		},
		measurements: {
			...input.measurements,
			nodes: new Map([...input.measurements.nodes, [nodeId, { width: 1, height: 1 }]]),
		},
		nodeId,
		routeId,
	};
}

function projectedLayout(
	layout: LayoutResult,
	auxiliary: AuxiliaryLeaf,
	frame: ProjectionFrame,
): LayoutResult {
	const { offsetY, height } = frame;
	return {
		width: layout.width,
		height,
		elements: layout.elements
			.filter(({ id }) => id !== auxiliary.nodeId)
			.map((element) => ({
				...element,
				bounds: { ...element.bounds, y: element.bounds.y - offsetY },
			})),
		relations: layout.relations
			.filter(({ id }) => id !== auxiliary.routeId)
			.map((relation) => ({
				...relation,
				points: relation.points.map((point) => translatePoint(point, offsetY)),
			})),
	};
}

function incidentFromRoute(
	route: LayoutRelation,
	endpointId: string,
	offsetY: number,
): readonly Point[] {
	let points = route.points;
	if (route.from !== endpointId) points = [...route.points].reverse();
	return points.map((point) => translatePoint(point, offsetY));
}

function publicRanks(ranks: TopologicalRanks, ghostId: string): TopologicalRanks {
	return {
		byEndpointId: new Map([...ranks.byEndpointId].filter(([id]) => id !== ghostId)),
		bands: ranks.bands.map((band) => band.filter((id) => id !== ghostId)),
	};
}

function preflight(input: RegionIncidentGhostInput): LogicNode | RegionIncidentGhostFailure {
	const { document, relationId, endpointId, side } = input;
	const direction = document.layout.direction;
	if (direction !== LayoutDirection.TopToBottom && direction !== LayoutDirection.BottomToTop)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'Only vertical leaves are supported.',
		);
	if (direction === LayoutDirection.TopToBottom && side !== NestedPortalSide.Top)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'This flow supports only the top incident side.',
		);
	if (direction === LayoutDirection.BottomToTop && side !== NestedPortalSide.Bottom)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'This flow supports only the bottom incident side.',
		);
	if (document.groups.length > 0 || document.junctions.length > 0)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'Only node-only leaves are supported.',
		);
	if (document.relations.length !== 1)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'Exactly one local relation is supported.',
		);
	const local = defined(document.relations[0]);
	if (local.to !== endpointId)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'The local relation must enter the incident endpoint.',
		);
	if (local.id === relationId)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'The incident identity is not local.',
		);
	const source = document.nodes.find(({ id }) => id === endpointId);
	if (source === undefined)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'The incident endpoint is not a leaf node.',
		);
	return source;
}

function selectIncident(
	input: RegionIncidentGhostInput,
	auxiliary: AuxiliaryLeaf,
	computed: NestedRegionLocalLayout,
): RegionIncidentGhostAttempt {
	const augmented = computed.layout;
	const ghost = augmented.elements.find(({ id }) => id === auxiliary.nodeId);
	const route = augmented.relations.find(({ id }) => id === auxiliary.routeId);
	if (ghost === undefined || route === undefined)
		return unavailable(RegionIncidentGhostStatus.Unknown, 'The auxiliary route is missing.');
	const frame = projectionFrame(augmented, ghost, input.side);
	const layout = projectedLayout(augmented, auxiliary, frame);
	const endpoint = layout.elements.find(({ id }) => id === input.endpointId);
	if (endpoint === undefined)
		return unavailable(RegionIncidentGhostStatus.Unknown, 'The incident endpoint is missing.');
	const points = incidentFromRoute(route, input.endpointId, frame.offsetY);
	const failure = geometryFailure(layout, endpoint, points, input.side);
	if (failure !== undefined) return unavailable(RegionIncidentGhostStatus.Unknown, failure);
	return {
		status: RegionIncidentGhostStatus.Selected,
		layout,
		ranks: publicRanks(computed.ranks, auxiliary.nodeId),
		incident: {
			relationId: input.relationId,
			endpointId: input.endpointId,
			side: input.side,
			anchor: defined(points[0]),
			portal: defined(points.at(-1)),
			points,
		},
	};
}

/**
 * Single outgoing incident on a vertical node-only leaf with one incoming local relation.
 * Horizontal, same-flow-side, and multiple-incident layouts need a separate policy.
 */
export function solveRegionLeafWithGhostIncident(
	input: RegionIncidentGhostInput,
): RegionIncidentGhostAttempt {
	const source = preflight(input);
	if ('status' in source) return source;
	const auxiliary = materialize(input, source);
	const computed = solveGhostLeaf({ ...auxiliary, policy: input.policy, cache: input.cache });
	if ('status' in computed) return computed;
	return selectIncident(input, auxiliary, computed);
}

export { RegionIncidentGhostStatus } from './region-incident-ghost-common';
export {
	RegionGhostIncidentRole,
	solveRegionLeafWithGhostIncidents,
} from './region-incident-ghost-multiple';
