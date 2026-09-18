import { compareCanonicalStrings } from '../../canonical-string';
import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter } from '../geometry/layout-frame';
import {
	JUNCTION_PORT_INSET,
	JUNCTION_PORT_SPACING,
	PORT_INSET,
	PORT_SPACING,
} from '../layout-settings';
import type { Bounds, Size } from '../layout-types';
import type { CorridorLink, RoutingCorridor } from './routing-corridors';

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
	readonly sizes: ReadonlyMap<string, Size>;
}

function allocateFace(input: {
	readonly faces: ReadonlyMap<string, CorridorLink[]>;
	readonly outgoing: boolean;
	readonly vertical: boolean;
	readonly sizes: Map<string, Size>;
	readonly graph: LogicGraph;
	readonly shared?: ReadonlySet<string>;
}): Map<string, number> {
	const offsets = new Map<string, number>();
	for (const [id, links] of input.faces) {
		if (input.shared?.has(id) === true) {
			for (const { relation } of links) offsets.set(relation.id, 0);
			continue;
		}
		links.sort((a, b) => {
			let difference = a.source - b.source;
			if (input.outgoing) difference = a.target - b.target;
			return difference || compareCanonicalStrings(a.relation.id, b.relation.id);
		});
		const kind = defined(input.graph.endpointsById.get(id)).kind;
		const required = portExtent(links.length, kind);
		const size = defined(input.sizes.get(id));
		let grown: Size;
		if (input.vertical) grown = { ...size, width: Math.max(size.width, required) };
		else grown = { ...size, height: Math.max(size.height, required) };
		input.sizes.set(id, grown);
		const centerIndex = (links.length - 1) / 2;
		for (const [index, link] of links.entries())
			offsets.set(link.relation.id, (index - centerIndex) * portSpacing(kind));
	}
	return offsets;
}

/** Reserve distinct ports in crossing corridors; simple forks keep their shared central port. */
export function allocatePorts(input: {
	readonly corridors: readonly RoutingCorridor[];
	readonly sizes: ReadonlyMap<string, Size>;
	readonly vertical: boolean;
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly sharedSources?: ReadonlySet<string>;
	readonly sharedTargets?: ReadonlySet<string>;
}): PortAllocation {
	const enlarged = new Map(input.sizes);
	const outgoing = new Map<string, CorridorLink[]>();
	const incoming = new Map<string, CorridorLink[]>();
	const corridorLinks = new Map<string, CorridorLink>();
	for (const corridor of input.corridors)
		for (const link of corridor.links) {
			const { relation } = link;
			corridorLinks.set(relation.id, link);
			if (!outgoing.has(relation.from)) outgoing.set(relation.from, []);
			if (!incoming.has(relation.to)) incoming.set(relation.to, []);
		}
	const centers = new Map(
		[...input.bounds].map(([id, box]) => [id, transverseCenter(box, input.vertical)]),
	);
	for (const { relation } of input.graph.relations) {
		const source = outgoing.get(relation.from);
		const target = incoming.get(relation.to);
		if (source === undefined && target === undefined) continue;
		const link = corridorLinks.get(relation.id) ?? {
			relation,
			source: defined(centers.get(relation.from)),
			target: defined(centers.get(relation.to)),
		};
		source?.push(link);
		target?.push(link);
	}
	const face = { sizes: enlarged, vertical: input.vertical, graph: input.graph };
	const shared = input.sharedSources ?? new Set<string>();
	const sourceOffsets = allocateFace({ ...face, faces: outgoing, outgoing: true, shared });
	return {
		sourceOffsets,
		targetOffsets: allocateFace({
			...face,
			faces: incoming,
			outgoing: false,
			shared: input.sharedTargets ?? new Set<string>(),
		}),
		sizes: enlarged,
	};
}

function sharedEndpointPorts(
	relations: readonly LogicRelation[],
	offsets: ReadonlyMap<string, number>,
	endpoint: (relation: LogicRelation) => string,
): ReadonlyMap<string, string> {
	const families = new Map<string, string[]>();
	for (const relation of relations) {
		const key = JSON.stringify([endpoint(relation), offsets.get(relation.id) ?? 0]);
		const ids = families.get(key) ?? [];
		ids.push(relation.id);
		families.set(key, ids);
	}
	const shared = new Map<string, string>();
	for (const [key, ids] of families) {
		if (ids.length < 2) continue;
		for (const id of ids) shared.set(id, key);
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
