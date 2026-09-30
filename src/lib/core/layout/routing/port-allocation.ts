import { compareCanonicalStrings } from '../../canonical-string';
import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import {
	JUNCTION_PORT_INSET,
	JUNCTION_PORT_SPACING,
	PORT_INSET,
	PORT_SPACING,
} from '../layout-settings';
import { type Bounds, RoutingPortRole, type Size } from '../layout-types';
import {
	assignPortOffset,
	type PortOffsetsBuilder,
	RelationPortOffsets,
} from './relation-port-offsets';
import {
	type CorridorLink,
	corridorLink,
	corridorsIndexGraph,
	relationIdsAreUnique,
	relationPositions,
	type RoutingCorridor,
} from './routing-corridors';

function portSpacing(kind: EndpointKind): number {
	if (kind === EndpointKind.Junction) return JUNCTION_PORT_SPACING;
	return PORT_SPACING;
}

export function portExtent(count: number, kind: EndpointKind): number {
	let inset = PORT_INSET;
	if (kind === EndpointKind.Junction) inset = JUNCTION_PORT_INSET;
	const span = (count - 1) * portSpacing(kind);
	return 2 * inset + span;
}

export interface PortAllocation {
	readonly sourceOffsets: ReadonlyMap<string, number>;
	readonly targetOffsets: ReadonlyMap<string, number>;
	/** Unshared face slots are unique per endpoint, so channel planning can skip regrouping. */
	readonly hasSharedSourcePorts: boolean;
	/** Face capacity required by the chosen port assignment, before placement. */
	readonly metricDemands: readonly PortMetricDemand[];
	readonly sizes: ReadonlyMap<string, Size>;
}

export enum PortMetricDemandKind {
	FaceCapacity = 'face-capacity',
}

interface PortMetricDemand {
	readonly kind: PortMetricDemandKind.FaceCapacity;
	readonly endpointId: string;
	readonly role: RoutingPortRole;
	readonly portCount: number;
	readonly minimumCrossSize: number;
}

interface FaceAllocation {
	readonly offsets: ReadonlyMap<string, number>;
	readonly metricDemands: readonly PortMetricDemand[];
}

/** Links towards the same opposite coordinate keep the documentary order of their relations. */
function sortFaceLinks(
	links: CorridorLink[],
	outgoing: boolean,
	position: (relation: LogicRelation) => number,
): void {
	const documentary = (a: CorridorLink, b: CorridorLink) =>
		position(a.relation) - position(b.relation);
	if (outgoing) links.sort((a, b) => a.target - b.target || documentary(a, b));
	else links.sort((a, b) => a.source - b.source || documentary(a, b));
}

/** The documentary position of a relation of `graph`, indexed only once a tie needs it. */
function documentaryPosition(graph: LogicGraph): (relation: LogicRelation) => number {
	let positions: ReadonlyMap<string, number> | undefined;
	return (relation) => {
		positions ??= relationPositions(graph);
		return defined(positions.get(relation.id));
	};
}

function allocateFace(input: {
	readonly faces: ReadonlyMap<string, CorridorLink[]>;
	readonly outgoing: boolean;
	readonly sortLinks: boolean;
	readonly graph: LogicGraph;
	/** Every link carries its index in `graph`, whose relation ids are unique. */
	readonly indexed: boolean;
	readonly position: (relation: LogicRelation) => number;
	readonly shared?: ReadonlySet<string>;
}): FaceAllocation {
	let offsets: PortOffsetsBuilder = new Map<string, number>();
	if (input.indexed) offsets = new RelationPortOffsets(input.graph);
	const metricDemands: PortMetricDemand[] = [];
	for (const [id, links] of input.faces) {
		if (input.shared?.has(id) === true) {
			for (const link of links) assignPortOffset(offsets, link, 0);
			continue;
		}
		if (input.sortLinks) sortFaceLinks(links, input.outgoing, input.position);
		const kind = defined(input.graph.endpointsById.get(id)).kind;
		const spacing = portSpacing(kind);
		let role = RoutingPortRole.Incoming;
		if (input.outgoing) role = RoutingPortRole.Outgoing;
		metricDemands.push({
			kind: PortMetricDemandKind.FaceCapacity,
			endpointId: id,
			role,
			portCount: links.length,
			minimumCrossSize: portExtent(links.length, kind),
		});
		const centerIndex = (links.length - 1) / 2;
		for (const [index, link] of links.entries())
			assignPortOffset(offsets, link, (index - centerIndex) * spacing);
	}
	return { offsets, metricDemands };
}

function satisfyFaceDemands(
	sizes: ReadonlyMap<string, Size>,
	demands: readonly PortMetricDemand[],
	vertical: boolean,
): ReadonlyMap<string, Size> {
	const enlarged = new Map(sizes);
	for (const demand of demands) {
		const size = defined(enlarged.get(demand.endpointId));
		if (vertical)
			enlarged.set(demand.endpointId, {
				...size,
				width: Math.max(size.width, demand.minimumCrossSize),
			});
		else
			enlarged.set(demand.endpointId, {
				...size,
				height: Math.max(size.height, demand.minimumCrossSize),
			});
	}
	return enlarged;
}

interface PortAllocationInput {
	readonly corridors: readonly RoutingCorridor[];
	/** The producer retains graph relation objects and orders each face by its opposite endpoint. */
	readonly fromCrossingCorridors?: boolean;
	readonly sizes: ReadonlyMap<string, Size>;
	readonly vertical: boolean;
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly sharedSources?: ReadonlySet<string>;
	readonly sharedTargets?: ReadonlySet<string>;
}

interface FaceLinks {
	readonly outgoing: Map<string, CorridorLink[]>;
	readonly incoming: Map<string, CorridorLink[]>;
	readonly routedRelationIds: Set<string> | undefined;
	readonly routedRelationRefs: Set<LogicRelation> | undefined;
}

function recordFaceLink(faceLinks: FaceLinks, link: CorridorLink): void {
	const { outgoing, incoming, routedRelationIds, routedRelationRefs } = faceLinks;
	const { relation } = link;
	if (routedRelationRefs === undefined) {
		if (routedRelationIds?.has(relation.id) === true) return;
		routedRelationIds?.add(relation.id);
	} else routedRelationRefs.add(relation);
	let sources = outgoing.get(relation.from);
	if (sources === undefined) {
		sources = [];
		outgoing.set(relation.from, sources);
	}
	let targets = incoming.get(relation.to);
	if (targets === undefined) {
		targets = [];
		incoming.set(relation.to, targets);
	}
	sources.push(link);
	targets.push(link);
}

function collectFaceLinks(input: PortAllocationInput): FaceLinks {
	const outgoing = new Map<string, CorridorLink[]>();
	const incoming = new Map<string, CorridorLink[]>();
	let routedRelationIds: Set<string> | undefined;
	let routedRelationRefs: Set<LogicRelation> | undefined;
	let uniqueIds = input.fromCrossingCorridors === true;
	if (uniqueIds) uniqueIds = relationIdsAreUnique(input.graph);
	if (uniqueIds) routedRelationRefs = new Set<LogicRelation>();
	else routedRelationIds = new Set<string>();
	const faceLinks = { outgoing, incoming, routedRelationIds, routedRelationRefs };
	for (const corridor of input.corridors)
		for (const link of corridor.links) recordFaceLink(faceLinks, link);
	return faceLinks;
}

function appendDirectFaceLinks(input: PortAllocationInput, faceLinks: FaceLinks): boolean {
	const { outgoing, incoming, routedRelationIds, routedRelationRefs } = faceLinks;
	let appended = false;
	for (const [relationIndex, { relation }] of input.graph.relations.entries()) {
		if (routedRelationRefs?.has(relation) === true || routedRelationIds?.has(relation.id) === true)
			continue;
		const source = outgoing.get(relation.from);
		const target = incoming.get(relation.to);
		if (source === undefined && target === undefined) continue;
		appended = true;
		const link = corridorLink(relation, relationIndex, input.bounds, input.vertical);
		source?.push(link);
		target?.push(link);
	}
	return appended;
}

/** Reserve distinct ports in crossing corridors; simple forks keep their shared central port. */
export function allocatePorts(input: PortAllocationInput): PortAllocation {
	const faceLinks = collectFaceLinks(input);
	const appendedDirectLinks = appendDirectFaceLinks(input, faceLinks);
	const face = {
		graph: input.graph,
		sortLinks: input.fromCrossingCorridors !== true || appendedDirectLinks,
		indexed:
			input.fromCrossingCorridors === true && corridorsIndexGraph(input.corridors, input.graph),
		position: documentaryPosition(input.graph),
	};
	const shared = input.sharedSources ?? new Set<string>();
	const source = allocateFace({
		...face,
		faces: faceLinks.outgoing,
		outgoing: true,
		shared,
	});
	const target = allocateFace({
		...face,
		faces: faceLinks.incoming,
		outgoing: false,
		shared: input.sharedTargets ?? new Set<string>(),
	});
	const metricDemands = [...source.metricDemands, ...target.metricDemands].sort(
		(a, b) =>
			compareCanonicalStrings(a.endpointId, b.endpointId) ||
			compareCanonicalStrings(a.role, b.role),
	);
	return {
		sourceOffsets: source.offsets,
		targetOffsets: target.offsets,
		hasSharedSourcePorts: shared.size > 0,
		metricDemands,
		sizes: satisfyFaceDemands(input.sizes, metricDemands, input.vertical),
	};
}

function recordPortFamily(
	families: Map<string, Map<number, string | string[]>>,
	owner: string,
	offset: number,
	relationId: string,
): void {
	let byOffset = families.get(owner);
	if (byOffset === undefined) {
		byOffset = new Map();
		families.set(owner, byOffset);
	}
	const first = byOffset.get(offset);
	if (first === undefined) byOffset.set(offset, relationId);
	else if (typeof first === 'string') byOffset.set(offset, [first, relationId]);
	else first.push(relationId);
}

function sharedEndpointPorts(
	relations: readonly LogicRelation[],
	offsets: ReadonlyMap<string, number>,
	endpoint: (relation: LogicRelation) => string,
): ReadonlyMap<string, string> {
	const families = new Map<string, Map<number, string | string[]>>();
	for (const relation of relations) {
		const owner = endpoint(relation);
		const value = offsets.get(relation.id) ?? 0;
		// JSON encodes every non-finite number as null in the family key.
		let offset = value;
		if (!Number.isFinite(value)) offset = Number.NaN;
		recordPortFamily(families, owner, offset, relation.id);
	}
	const shared = new Map<string, string>();
	for (const [owner, byOffset] of families) {
		for (const ids of byOffset.values()) {
			if (typeof ids === 'string') continue;
			const key = JSON.stringify([owner, offsets.get(defined(ids[0])) ?? 0]);
			for (const id of ids) shared.set(id, key);
		}
	}
	return shared;
}

/** Shared faces are identified by endpoint and actual port offset, independently of endpoint kind. */
export function sharedSourcePorts(
	relations: readonly LogicRelation[],
	offsets: ReadonlyMap<string, number>,
): ReadonlyMap<string, string> {
	return sharedEndpointPorts(relations, offsets, ({ from }) => from);
}

export function sharedTargetPorts(
	relations: readonly LogicRelation[],
	offsets: ReadonlyMap<string, number>,
): ReadonlyMap<string, string> {
	return sharedEndpointPorts(relations, offsets, ({ to }) => to);
}
