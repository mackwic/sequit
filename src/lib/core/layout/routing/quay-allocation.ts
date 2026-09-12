import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter } from '../geometry/layout-frame';
import { QUAY_INSET, QUAY_SPACING } from '../layout-settings';
import type { Bounds, Size } from '../layout-types';
import type { CorridorLink, RoutingCorridor } from './routing-corridors';

export function quayExtent(count: number): number {
	const span = (count - 1) * QUAY_SPACING;
	return 2 * QUAY_INSET + span;
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
}): Map<string, number> {
	const offsets = new Map<string, number>();
	for (const [id, links] of input.faces) {
		links.sort((a, b) => {
			let difference = a.source - b.source;
			if (input.outgoing) difference = a.target - b.target;
			return difference || compareCanonicalStrings(a.relation.id, b.relation.id);
		});
		const required = quayExtent(links.length);
		const size = defined(input.sizes.get(id));
		let grown: Size;
		if (input.vertical) grown = { ...size, width: Math.max(size.width, required) };
		else grown = { ...size, height: Math.max(size.height, required) };
		input.sizes.set(id, grown);
		const centerIndex = (links.length - 1) / 2;
		for (const [index, link] of links.entries())
			offsets.set(link.relation.id, (index - centerIndex) * QUAY_SPACING);
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
}): QuayAllocation {
	const enlarged = new Map(input.sizes);
	const outgoing = new Map<string, CorridorLink[]>();
	const incoming = new Map<string, CorridorLink[]>();
	for (const corridor of input.corridors)
		for (const { relation } of corridor.links) {
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
		const link = {
			relation,
			source: defined(centers.get(relation.from)),
			target: defined(centers.get(relation.to)),
		};
		source?.push(link);
		target?.push(link);
	}
	const face = { sizes: enlarged, vertical: input.vertical };
	return {
		sourceOffsets: allocateFace({ ...face, faces: outgoing, outgoing: true }),
		targetOffsets: allocateFace({ ...face, faces: incoming, outgoing: false }),
		sizes: enlarged,
	};
}
