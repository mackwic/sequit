import { compareCanonicalStrings } from '../canonical-string';
import {
	defined,
	EndpointKind,
	LayoutDirection,
	type LayoutPolicy,
	type LogicDocument,
	type LogicNode,
} from '../document/logic-document';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { LayoutMeasurements, LayoutResult, Point } from './layout-types';
import { pathsTouchWithoutBridge } from './nested-region-leaf-incident-contacts';
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

export enum RegionGhostIncidentRole {
	Source = 'source',
	Target = 'target',
}

interface RegionGhostIncidentRequest {
	readonly relationId: string;
	readonly endpointId: string;
	readonly side: NestedPortalSide;
	readonly role: RegionGhostIncidentRole;
}

export interface RegionIncidentGhostMultipleInput {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly incidents: readonly RegionGhostIncidentRequest[];
	readonly policy?: LayoutPolicy | undefined;
	readonly cache?: NestedRegionLocalLayoutCache | undefined;
}

interface RegionGhostSelectedIncident extends RegionGhostIncidentRequest {
	readonly anchor: Point;
	readonly portal: Point;
	readonly points: readonly Point[];
}

interface RegionIncidentGhostMultipleSelected {
	readonly status: RegionIncidentGhostStatus.Selected;
	readonly layout: LayoutResult;
	readonly ranks: TopologicalRanks;
	readonly incidents: readonly RegionGhostSelectedIncident[];
}

export type RegionIncidentGhostMultipleAttempt =
	RegionIncidentGhostMultipleSelected | RegionIncidentGhostFailure;

interface MultipleAuxiliaryIncident {
	readonly request: RegionGhostIncidentRequest;
	readonly nodeId: string;
	readonly routeId: string;
}

interface MultipleAuxiliaryLeaf {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly incidents: readonly MultipleAuxiliaryIncident[];
}

const ROLE_SLOT = {
	[RegionGhostIncidentRole.Target]: '0-target',
	[RegionGhostIncidentRole.Source]: '1-source',
} as const;

function orderedIncidentRequests(
	requests: readonly RegionGhostIncidentRequest[],
): readonly RegionGhostIncidentRequest[] {
	return [...requests].sort((left, right) => {
		const leftRole = ROLE_SLOT[left.role];
		const rightRole = ROLE_SLOT[right.role];
		if (leftRole !== rightRole) return compareCanonicalStrings(leftRole, rightRole);
		return compareCanonicalStrings(left.relationId, right.relationId);
	});
}

function multiplePreflight(
	input: RegionIncidentGhostMultipleInput,
): LogicNode | RegionIncidentGhostFailure {
	const { document, incidents } = input;
	if (incidents.length < 2 || incidents.length > 4)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'Two to four incidents are supported.',
		);
	const direction = document.layout.direction;
	if (direction !== LayoutDirection.TopToBottom && direction !== LayoutDirection.BottomToTop)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'Only vertical leaves are supported.',
		);
	if (document.groups.length > 0 || document.junctions.length > 0)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'Only node-only leaves are supported.',
		);
	if (document.nodes.length !== 1 || document.relations.length !== 0)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'Multiple incidents require one node and no local relations.',
		);
	const node = defined(document.nodes[0]);
	let side = NestedPortalSide.Top;
	if (direction === LayoutDirection.BottomToTop) side = NestedPortalSide.Bottom;
	if (incidents.some((incident) => incident.side !== side))
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'The incident side opposes the flow.',
		);
	if (incidents.some((incident) => incident.endpointId !== node.id))
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'Every incident must meet the leaf node.',
		);
	const ids = incidents.map(({ relationId }) => relationId);
	if (new Set(ids).size !== ids.length)
		return unavailable(
			RegionIncidentGhostStatus.Unsupported,
			'Incident identities must be distinct.',
		);
	return node;
}

function materializeMultiple(
	input: RegionIncidentGhostMultipleInput,
	node: LogicNode,
): MultipleAuxiliaryLeaf {
	const occupied = new Set([
		...input.document.nodes.map(({ id }) => id),
		...input.document.relations.map(({ id }) => id),
		...input.incidents.map(({ relationId }) => relationId),
	]);
	const additions = orderedIncidentRequests(input.incidents).map((request) => {
		const slot = ROLE_SLOT[request.role];
		const nodeId = freshId(`@region-incident-ghost/${slot}/${request.relationId}`, occupied);
		occupied.add(nodeId);
		const routeId = freshId(`@region-incident-route/${slot}/${request.relationId}`, occupied);
		occupied.add(routeId);
		return { request, nodeId, routeId };
	});
	return {
		document: {
			...input.document,
			nodes: [
				...input.document.nodes,
				...additions.map(({ nodeId }) => ({
					kind: EndpointKind.Node as const,
					id: nodeId,
					natureId: node.natureId,
					markdown: 'Ghost\n',
					layoutOrder: node.layoutOrder,
				})),
			],
			relations: [
				...input.document.relations,
				...additions.map(({ request, nodeId, routeId }) => ({
					id: routeId,
					from: request.endpointId,
					to: nodeId,
				})),
			],
		},
		measurements: {
			...input.measurements,
			nodes: new Map([
				...input.measurements.nodes,
				...additions.map(({ nodeId }) => [nodeId, { width: 1, height: 1 }] as const),
			]),
		},
		incidents: additions,
	};
}

function projectedMultipleLayout(
	augmented: LayoutResult,
	auxiliary: MultipleAuxiliaryLeaf,
	frame: ProjectionFrame,
): LayoutResult {
	const nodeIds = new Set(auxiliary.incidents.map(({ nodeId }) => nodeId));
	const routeIds = new Set(auxiliary.incidents.map(({ routeId }) => routeId));
	return {
		width: augmented.width,
		height: frame.height,
		elements: augmented.elements
			.filter(({ id }) => !nodeIds.has(id))
			.map((element) => ({
				...element,
				bounds: { ...element.bounds, y: element.bounds.y - frame.offsetY },
			})),
		relations: augmented.relations
			.filter(({ id }) => !routeIds.has(id))
			.map((relation) => ({
				...relation,
				points: relation.points.map((point) => translatePoint(point, frame.offsetY)),
			})),
	};
}

function selectMultipleIncident(
	augmented: LayoutResult,
	layout: LayoutResult,
	frame: ProjectionFrame,
	auxiliary: MultipleAuxiliaryIncident,
): RegionGhostSelectedIncident | RegionIncidentGhostFailure {
	const { request, routeId } = auxiliary;
	// The augmented star has one generated node and route per request. The leaf solver
	// materializes every graph endpoint and relation in its selected layout.
	const route = defined(
		augmented.relations.find(({ id }) => id === routeId),
		`The augmented leaf lost auxiliary route ${routeId}.`,
	);
	const endpoint = defined(
		layout.elements.find(({ id }) => id === request.endpointId),
		`The projected leaf lost incident endpoint ${request.endpointId}.`,
	);
	const portal = defined(route.points.at(-1), `Auxiliary route ${routeId} has no portal.`);
	let anchorY = endpoint.bounds.y;
	if (request.side === NestedPortalSide.Bottom) anchorY += endpoint.bounds.height;
	const anchor = { x: portal.x, y: anchorY };
	const projectedPortal = translatePoint(portal, frame.offsetY);
	const outbound = [anchor, projectedPortal];
	const failure = geometryFailure(layout, endpoint, outbound, request.side);
	if (failure !== undefined) return unavailable(RegionIncidentGhostStatus.Unknown, failure);
	const endpointRight = endpoint.bounds.x + endpoint.bounds.width;
	if (anchor.x <= endpoint.bounds.x || anchor.x >= endpointRight)
		return unavailable(
			RegionIncidentGhostStatus.Unknown,
			'The auxiliary route misses the node face.',
		);
	let points = outbound;
	if (request.role === RegionGhostIncidentRole.Target) points = [...outbound].reverse();
	return { ...request, anchor, portal: projectedPortal, points };
}

function multipleGeometryFailure(
	incidents: readonly RegionGhostSelectedIncident[],
): string | undefined {
	// Preflight admits one real node, and projection removes every generated node.
	for (let left = 0; left < incidents.length; left += 1) {
		const first = defined(incidents[left]);
		for (let right = left + 1; right < incidents.length; right += 1) {
			const second = defined(incidents[right]);
			if (pathsTouchWithoutBridge(first.points, second.points))
				return 'Two incidents touch without a bridge.';
		}
	}
	return undefined;
}

function selectMultiple(
	auxiliary: MultipleAuxiliaryLeaf,
	computed: NestedRegionLocalLayout,
): RegionIncidentGhostMultipleAttempt {
	const augmented = computed.layout;
	const first = defined(auxiliary.incidents[0]);
	const firstGhost = defined(
		augmented.elements.find(({ id }) => id === first.nodeId),
		`The augmented leaf lost auxiliary endpoint ${first.nodeId}.`,
	);
	const frame = projectionFrame(augmented, firstGhost, first.request.side);
	for (const auxiliaryIncident of auxiliary.incidents.slice(1)) {
		const ghost = defined(
			augmented.elements.find(({ id }) => id === auxiliaryIncident.nodeId),
			`The augmented leaf lost auxiliary endpoint ${auxiliaryIncident.nodeId}.`,
		);
		const otherFrame = projectionFrame(augmented, ghost, auxiliaryIncident.request.side);
		if (otherFrame.offsetY !== frame.offsetY || otherFrame.height !== frame.height)
			return unavailable(
				RegionIncidentGhostStatus.Unknown,
				'The auxiliary portals use different boundaries.',
			);
	}
	const layout = projectedMultipleLayout(augmented, auxiliary, frame);
	const incidents: RegionGhostSelectedIncident[] = [];
	for (const auxiliaryIncident of auxiliary.incidents) {
		const selected = selectMultipleIncident(augmented, layout, frame, auxiliaryIncident);
		if ('status' in selected) return selected;
		incidents.push(selected);
	}
	const failure = multipleGeometryFailure(incidents);
	if (failure !== undefined) return unavailable(RegionIncidentGhostStatus.Unknown, failure);
	const ghostIds = new Set(auxiliary.incidents.map(({ nodeId }) => nodeId));
	return {
		status: RegionIncidentGhostStatus.Selected,
		layout,
		ranks: {
			byEndpointId: new Map([...computed.ranks.byEndpointId].filter(([id]) => !ghostIds.has(id))),
			bands: computed.ranks.bands.map((band) => band.filter((id) => !ghostIds.has(id))),
		},
		incidents,
	};
}

/** Bounded shared solve for two to four same-face incidents on one node without local routes. */
export function solveRegionLeafWithGhostIncidents(
	input: RegionIncidentGhostMultipleInput,
): RegionIncidentGhostMultipleAttempt {
	const node = multiplePreflight(input);
	if ('status' in node) return node;
	const auxiliary = materializeMultiple(input, node);
	const computed = solveGhostLeaf({ ...auxiliary, policy: input.policy, cache: input.cache });
	if ('status' in computed) return computed;
	return selectMultiple(auxiliary, computed);
}
