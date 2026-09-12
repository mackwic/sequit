import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter, transverseSize } from '../geometry/layout-frame';
import { QUAY_INSET, QUAY_SPACING } from '../layout-settings';
import type { Bounds, Size } from '../layout-types';
import type { QuayAllocation } from './quay-allocation';

interface AlignmentInput {
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	readonly quays: QuayAllocation;
}

function tooClose(offsets: readonly { readonly value: number }[]): boolean {
	return offsets.some((offset, index) => {
		if (index === 0) return false;
		const previous = defined(offsets[index - 1]);
		return offset.value - previous.value < QUAY_SPACING;
	});
}

/** One bounded proposal: align ordinary departure quays with adjacent junction centers. */
export function alignJunctionQuays(input: AlignmentInput): QuayAllocation {
	const sizes = new Map(input.quays.sizes);
	const sourceOffsets = new Map(input.quays.sourceOffsets);
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
		const required = 2 * (QUAY_INSET + Math.max(...offsets.map(({ value }) => Math.abs(value))));
		const extent = transverseSize(size, input.vertical);
		if (required > extent + 24) continue;
		const grown = Math.max(extent, required);
		let next: Size = { ...size, width: grown };
		if (!input.vertical) next = { ...size, height: grown };
		sizes.set(id, next);
		for (const offset of offsets) sourceOffsets.set(offset.id, offset.value);
	}
	return { ...input.quays, sizes, sourceOffsets };
}
