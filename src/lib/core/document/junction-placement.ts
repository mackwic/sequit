import { compareCanonicalStrings } from '../canonical-string';
import {
	EndpointKind,
	type LogicDocument,
	type LogicEndpoint,
	type LogicGroup,
	type LogicJunction,
} from './logic-document';

/** Where a junction lives: a group, or the root with a lane and a region. */
export interface JunctionPlacement {
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
}

interface PlacementContext {
	readonly groups: ReadonlyMap<string, LogicGroup>;
	readonly endpoints: ReadonlyMap<string, LogicEndpoint>;
	readonly targets: ReadonlyMap<string, readonly string[]>;
	readonly placed: Map<string, JunctionPlacement>;
	readonly visiting: Set<string>;
}

function placementContext(document: LogicDocument): PlacementContext {
	const endpoints = new Map<string, LogicEndpoint>();
	for (const endpoint of [...document.groups, ...document.nodes, ...document.junctions])
		endpoints.set(endpoint.id, endpoint);
	const junctionIds = new Set(document.junctions.map(({ id }) => id));
	const targets = new Map<string, string[]>();
	for (const { from, to } of document.relations) {
		if (!junctionIds.has(from)) continue;
		const list = targets.get(from) ?? [];
		list.push(to);
		targets.set(from, list);
	}
	return {
		groups: new Map(document.groups.map((group) => [group.id, group])),
		endpoints,
		targets,
		placed: new Map(),
		visiting: new Set(),
	};
}

function containerChain(
	groups: ReadonlyMap<string, LogicGroup>,
	groupId: string | undefined,
): readonly string[] {
	const chain: string[] = [];
	let current = groupId;
	while (current !== undefined && !chain.includes(current)) {
		chain.push(current);
		current = groups.get(current)?.groupId;
	}
	return chain;
}

/** The deepest group holding every container; the root as soon as one container is the root. */
function commonContainer(
	groups: ReadonlyMap<string, LogicGroup>,
	containers: readonly (string | undefined)[],
): string | undefined {
	if (containers.includes(undefined)) return undefined;
	const [first, ...rest] = containers;
	const chains = rest.map((container) => new Set(containerChain(groups, container)));
	return containerChain(groups, first).find((id) => chains.every((chain) => chain.has(id)));
}

/** The root-level element holding a placement: its lane and region are those of its subtree. */
function rootOwner(
	groups: ReadonlyMap<string, LogicGroup>,
	placement: JunctionPlacement,
): JunctionPlacement {
	let owner = placement;
	const visited = new Set<string>();
	while (owner.groupId !== undefined && !visited.has(owner.groupId)) {
		visited.add(owner.groupId);
		const group = groups.get(owner.groupId);
		if (group === undefined) return owner;
		owner = group;
	}
	return owner;
}

/** Keeps the current value while a target still offers it, else the first offered one. */
function chosen(
	current: string | undefined,
	offered: readonly (string | undefined)[],
): string | undefined {
	if (offered.includes(current)) return current;
	const defined = offered.filter((value): value is string => value !== undefined);
	return defined.sort(compareCanonicalStrings)[0];
}

function placementFor(
	context: PlacementContext,
	current: JunctionPlacement,
	targets: readonly JunctionPlacement[],
): JunctionPlacement {
	if (targets.length === 0) return current;
	const groupId = commonContainer(
		context.groups,
		targets.map((target) => target.groupId),
	);
	if (groupId !== undefined) return { groupId };
	const owners = targets.map((target) => rootOwner(context.groups, target));
	const placement: { laneId?: string; regionId?: string } = {};
	const laneId = chosen(
		current.laneId,
		owners.map((owner) => owner.laneId),
	);
	if (laneId !== undefined) placement.laneId = laneId;
	const regionId = chosen(
		current.regionId,
		owners.map((owner) => owner.regionId),
	);
	if (regionId !== undefined) placement.regionId = regionId;
	return placement;
}

function targetPlacements(
	context: PlacementContext,
	targetIds: readonly string[],
): readonly JunctionPlacement[] {
	const placements: JunctionPlacement[] = [];
	for (const id of targetIds) {
		const endpoint = context.endpoints.get(id);
		if (endpoint === undefined) continue;
		if (endpoint.kind === EndpointKind.Junction) placements.push(placedJunction(context, endpoint));
		else placements.push(endpoint);
	}
	return placements;
}

function placedJunction(context: PlacementContext, junction: LogicJunction): JunctionPlacement {
	const known = context.placed.get(junction.id);
	if (known !== undefined) return known;
	if (context.visiting.has(junction.id)) return junction;
	context.visiting.add(junction.id);
	const targets = targetPlacements(context, context.targets.get(junction.id) ?? []);
	const placement = placementFor(context, junction, targets);
	context.placed.set(junction.id, placement);
	return placement;
}

/** Where a new junction relating to `targetIds` lives, given the document's current placements. */
export function junctionPlacement(
	document: LogicDocument,
	targetIds: readonly string[],
): JunctionPlacement {
	const context = placementContext(document);
	return placementFor(context, {}, targetPlacements(context, targetIds));
}

function samePlacement(junction: LogicJunction, placement: JunctionPlacement): boolean {
	const sameGroup = junction.groupId === placement.groupId;
	const sameLane = junction.laneId === placement.laneId;
	return sameGroup && sameLane && junction.regionId === placement.regionId;
}

/**
 * A junction never joins a group on its own: it lives in the deepest group holding all of its
 * targets, a junction target counting with its own placement. As soon as one target is outside
 * that group the junction is at the root, in its targets' lane and region. A junction without
 * targets keeps its place until its collection.
 */
export function placeJunctions(document: LogicDocument): LogicDocument {
	const context = placementContext(document);
	const junctions = document.junctions.map((junction) => {
		const placement = placedJunction(context, junction);
		if (samePlacement(junction, placement)) return junction;
		const { kind, id, operator, layoutOrder } = junction;
		return { kind, id, operator, layoutOrder, ...placement };
	});
	if (junctions.every((junction, index) => junction === document.junctions[index])) return document;
	return { ...document, junctions };
}
