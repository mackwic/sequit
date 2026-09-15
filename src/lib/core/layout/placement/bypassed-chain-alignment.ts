import { defined } from '../../document/logic-document';
import { transverseSize } from '../geometry/layout-frame';
import { QUAY_INSET, QUAY_SPACING, RAIL_SPACING } from '../layout-settings';
import type { Size } from '../layout-types';
import type { BypassedChain } from '../structure/bypassed-chains';

interface ChainAlignment {
	readonly centers: ReadonlyMap<string, number>;
	readonly sourceOffsets: ReadonlyMap<string, number>;
	readonly targetOffsets: ReadonlyMap<string, number>;
	readonly sizes: ReadonlyMap<string, Size>;
}

/** Keep the chain centered and straight; only its bypass moves to the positive side. */
export function alignBypassedChains(
	chains: readonly BypassedChain[],
	sizes: ReadonlyMap<string, Size>,
	vertical: boolean,
): ChainAlignment | undefined {
	if (chains.length === 0) return undefined;
	const enlarged = new Map<string, Size>();
	const centers = new Map<string, number>();
	const sourceOffsets = new Map<string, number>();
	const targetOffsets = new Map<string, number>();
	for (const chain of chains) {
		const bypassOffset = QUAY_SPACING + RAIL_SPACING;
		for (const id of chain.ids) centers.set(id, 0);
		for (const id of [chain.bypass.from, chain.bypass.to]) {
			const size = defined(sizes.get(id));
			const extent = Math.max(transverseSize(size, vertical), 2 * (bypassOffset + QUAY_INSET));
			let grown = { ...size, width: extent };
			if (!vertical) grown = { ...size, height: extent };
			enlarged.set(id, grown);
		}
		for (const link of chain.links) {
			sourceOffsets.set(link.id, 0);
			targetOffsets.set(link.id, 0);
		}
		sourceOffsets.set(chain.bypass.id, bypassOffset);
		targetOffsets.set(chain.bypass.id, bypassOffset);
	}
	return { centers, sourceOffsets, targetOffsets, sizes: enlarged };
}
