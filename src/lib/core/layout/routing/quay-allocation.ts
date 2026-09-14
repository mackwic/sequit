import { compareCanonicalStrings } from '../../canonical-string';
import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter } from '../geometry/layout-frame';
import {
	JUNCTION_QUAY_INSET,
	JUNCTION_QUAY_SPACING,
	QUAY_INSET,
	QUAY_SPACING,
} from '../layout-settings';
import type { Bounds, Size } from '../layout-types';
import type { CorridorLink, RoutingCorridor } from './routing-corridors';

function quaySpacing(kind: EndpointKind): number {
	if (kind === EndpointKind.Junction) return JUNCTION_QUAY_SPACING;
	return QUAY_SPACING;
}

export function quayExtent(count: number, kind: EndpointKind): number {
	let inset = QUAY_INSET;
	if (kind === EndpointKind.Junction) inset = JUNCTION_QUAY_INSET;
	const span = (count - 1) * quaySpacing(kind);
	return 2 * inset + span;
}

export interface QuayAllocation {
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
		const required = quayExtent(links.length, kind);
		const size = defined(input.sizes.get(id));
		let grown: Size;
		if (input.vertical) grown = { ...size, width: Math.max(size.width, required) };
		else grown = { ...size, height: Math.max(size.height, required) };
		input.sizes.set(id, grown);
		const centerIndex = (links.length - 1) / 2;
		for (const [index, link] of links.entries())
			offsets.set(link.relation.id, (index - centerIndex) * quaySpacing(kind));
	}
	return offsets;
}

/** Reserve distinct quays in crossing corridors; simple forks keep their shared central quay. */
export function allocateQuays(input: {
	readonly corridors: readonly RoutingCorridor[];
	readonly sizes: ReadonlyMap<string, Size>;
	readonly vertical: boolean;
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly sharedSources?: ReadonlySet<string>;
	readonly sharedTargets?: ReadonlySet<string>;
}): QuayAllocation {
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

/** Shared faces are identified by endpoint and actual quay offset, independently of endpoint kind. */
export function sharedSourceQuays(
	relations: readonly LogicRelation[],
	offsets: ReadonlyMap<string, number>,
): ReadonlyMap<string, string> {
	const families = new Map<string, string[]>();
	for (const { id, from } of relations) {
		const key = JSON.stringify([from, offsets.get(id) ?? 0]);
		const ids = families.get(key) ?? [];
		ids.push(id);
		families.set(key, ids);
	}
	const shared = new Map<string, string>();
	for (const [key, ids] of families) {
		if (ids.length < 2) continue;
		for (const id of ids) shared.set(id, key);
	}
	return shared;
}
