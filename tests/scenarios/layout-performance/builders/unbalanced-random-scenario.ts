import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';
import { squareShellRank, squareShellStart, squareShellWidth } from './topology-helpers';

export const DEFAULT_UNBALANCED_RANDOM_SEED = 0x5e91_7a2d;

function seededOwnerOffset(rank: number, sourceWidth: number): number {
	let value = (DEFAULT_UNBALANCED_RANDOM_SEED ^ Math.imul(rank, 0x9e37_79b1)) >>> 0;
	value ^= value << 13;
	value ^= value >>> 17;
	value ^= value << 5;
	return (value >>> 0) % sourceWidth;
}

export class UnbalancedRandomScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'unbalanced-random' as const;
	private readonly dominantOwnerIds = new Map<number, string>();

	protected resetTopology(): void {
		this.dominantOwnerIds.clear();
	}

	protected metadata(): Readonly<Record<string, unknown>> {
		return {
			seed: DEFAULT_UNBALANCED_RANDOM_SEED,
			dominantOwnerIds: Object.fromEntries(this.dominantOwnerIds),
		};
	}

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const rank = squareShellRank(nodeIndex);
		if (rank === 0) return this.insertion(nodeIndex, rank);

		const sourceStart = squareShellStart(rank - 1);
		const sourceWidth = squareShellWidth(rank - 1);
		const dominantOffset = seededOwnerOffset(rank, sourceWidth);
		const dominantOwnerId = this.nodeId(sourceStart + dominantOffset);
		this.dominantOwnerIds.set(rank, dominantOwnerId);
		const targetOffset = nodeIndex - squareShellStart(rank);
		const dominantTargetCount = Math.ceil(squareShellWidth(rank) * 0.8);
		let sourceOffset = dominantOffset;
		if (targetOffset >= dominantTargetCount && sourceWidth > 1) {
			const alternativeOffset = (targetOffset - dominantTargetCount) % (sourceWidth - 1);
			sourceOffset = alternativeOffset;
			if (alternativeOffset >= dominantOffset) sourceOffset += 1;
		}
		const sourceId = this.nodeId(sourceStart + sourceOffset);
		return this.insertion(nodeIndex, rank, {
			addedRelations: [this.relation(sourceId, this.nodeId(nodeIndex))],
		});
	}
}
