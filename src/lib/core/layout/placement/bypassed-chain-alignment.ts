import { defined } from '../../document/logic-document';
import { transverseSize } from '../geometry/layout-frame';
import { QUAY_INSET, QUAY_SPACING, RAIL_SPACING } from '../layout-settings';
import type { Size } from '../layout-types';
import type { BypassedChain } from '../structure/bypassed-chains';

interface ChainAlignment {
	readonly centers: ReadonlyMap<string, number>;
	readonly sourceOffsets: ReadonlyMap<string, number>;
	readonly targetOffsets: ReadonlyMap<string, number>;
	readonly passageOffsets: ReadonlyMap<string, number>;
	readonly sizes: ReadonlyMap<string, Size>;
}

/** Two straight columns, measured once; only the endpoint faces may need enlargement. */
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
	const passageOffsets = new Map<string, number>();
	for (const chain of chains) {
		const middle = chain.ids.slice(1, -1);
		const halfWidth = Math.max(
			...middle.map((id) => transverseSize(defined(sizes.get(id)), vertical) / 2),
		);
		const spacing = Math.max(QUAY_SPACING, halfWidth + RAIL_SPACING);
		for (const id of middle) centers.set(id, 0);
		for (const id of [chain.bypass.from, chain.bypass.to]) {
			const size = defined(sizes.get(id));
			const extent = Math.max(transverseSize(size, vertical), spacing + 2 * QUAY_INSET);
			let grown = { ...size, width: extent };
			if (!vertical) grown = { ...size, height: extent };
			enlarged.set(id, grown);
			centers.set(id, spacing / 2);
		}
		sourceOffsets.set(defined(chain.links.at(-1)).id, -spacing / 2);
		targetOffsets.set(defined(chain.links[0]).id, -spacing / 2);
		sourceOffsets.set(chain.bypass.id, spacing / 2);
		targetOffsets.set(chain.bypass.id, spacing / 2);
		passageOffsets.set(chain.bypass.id, spacing / 2);
		for (const link of chain.links) passageOffsets.set(link.id, sourceOffsets.get(link.id) ?? 0);
	}
	return { centers, sourceOffsets, targetOffsets, passageOffsets, sizes: enlarged };
}
