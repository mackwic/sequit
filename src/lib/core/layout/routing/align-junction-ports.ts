import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter, transverseSize } from '../geometry/layout-frame';
import { PORT_INSET, PORT_SPACING } from '../layout-settings';
import type { Bounds, Size } from '../layout-types';
import type { PortAllocation } from './port-allocation';

interface AlignmentInput {
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	readonly ports: PortAllocation;
}

function tooClose(offsets: readonly { readonly value: number }[]): boolean {
	return offsets.some((offset, index) => {
		if (index === 0) return false;
		const previous = defined(offsets[index - 1]);
		return offset.value - previous.value < PORT_SPACING;
	});
}

/** One bounded proposal: align ordinary departure ports with adjacent junction centers. */
export function alignJunctionPorts(input: AlignmentInput): PortAllocation {
	const sizes = new Map(input.ports.sizes);
	const sourceOffsets = new Map(input.ports.sourceOffsets);
	for (const [id, size] of sizes) {
		if (input.graph.endpointsById.get(id)?.kind !== EndpointKind.Node) continue;
		const links = input.graph.relations.filter(({ relation }) => relation.from === id);
		if (links.length < 2) continue;
		if (links.some(({ target }) => target.kind !== EndpointKind.Junction)) continue;
		const center = transverseCenter(defined(input.bounds.get(id)), input.vertical);
		const offsets = links
			.map(({ relation }) => ({
				id: relation.id,
				value: transverseCenter(defined(input.bounds.get(relation.to)), input.vertical) - center,
			}))
			.sort((a, b) => a.value - b.value);
		if (tooClose(offsets)) continue;
		const required = 2 * (PORT_INSET + Math.max(...offsets.map(({ value }) => Math.abs(value))));
		const extent = transverseSize(size, input.vertical);
		if (required > extent + 24) continue;
		const grown = Math.max(extent, required);
		let next: Size = { ...size, width: grown };
		if (!input.vertical) next = { ...size, height: grown };
		sizes.set(id, next);
		for (const offset of offsets) sourceOffsets.set(offset.id, offset.value);
	}
	return { ...input.ports, sizes, sourceOffsets };
}
