import { defined } from '../../../document/logic-document';
import { boundedCounter, type SearchBudgetCounter } from '../../search/bounded-search';
import {
	type RegionCompositionDiagnostic,
	RegionCompositionDiagnosticCode,
	type RegionInput,
	RegionWorkPhase,
} from './region-composition-types';

export type { RegionCompositionDiagnostic } from './region-composition-types';
export { RegionCompositionDiagnosticCode } from './region-composition-types';

/** Normalization outcome, shared by every composition entry point. */
export enum RegionCompositionModelStatus {
	Ready = 'ready',
	Invalid = 'invalid',
	Unsupported = 'unsupported',
}

export interface RegionCompositionWorkBudgets {
	readonly normalizationComparisons: number;
	readonly placements: number;
	readonly comparisons: number;
	readonly traversals: number;
}

/** Work units are charged before each actual validation, comparison or relation visit. */
export const NESTED_REGION_COMPOSITION_WORK_BUDGETS: RegionCompositionWorkBudgets = {
	normalizationComparisons: 8192,
	placements: 512,
	comparisons: 1024,
	traversals: 4096,
};

export class RegionWorkLimitExceeded extends Error {
	constructor(readonly diagnostic: RegionCompositionDiagnostic) {
		super(diagnostic.message);
	}
}

/** One monotone counter per independently calibrated composition phase. */
export class RegionCompositionWork {
	private readonly counters: Record<RegionWorkPhase, SearchBudgetCounter>;

	constructor(private readonly limits: RegionCompositionWorkBudgets) {
		for (const limit of Object.values(limits)) {
			if (!Number.isSafeInteger(limit) || limit < 0)
				throw new Error('Region composition budgets must be non-negative safe integers.');
		}
		this.counters = {
			[RegionWorkPhase.NormalizationComparisons]: boundedCounter(limits.normalizationComparisons),
			[RegionWorkPhase.Placements]: boundedCounter(limits.placements),
			[RegionWorkPhase.Comparisons]: boundedCounter(limits.comparisons),
			[RegionWorkPhase.Traversals]: boundedCounter(limits.traversals),
		};
	}

	charge(phase: RegionWorkPhase, ownerId: string): void {
		const counter = this.counters[phase];
		if (counter.take()) return;
		const limit = this.limits[phase];
		throw new RegionWorkLimitExceeded({
			code: RegionCompositionDiagnosticCode.ResourceLimit,
			message: `Region ${phase} work exhausted at ${limit} operations (owner ${ownerId}).`,
			path: ['regions', ownerId, phase],
			phase,
			ownerId,
			actual: counter.attempted,
			limit,
			exhaustive: false,
		});
	}

	attempted(phase: RegionWorkPhase): number {
		return this.counters[phase].attempted;
	}
}

/** Recursive composition has multiple stack frames per region; this is not a work budget. */
const MAX_REGION_RECURSION_DEPTH = 192;

/** Depth was calculated by the iterative normalized tree walk, before any recursive solve. */
export function checkRegionStackDepth(
	preorderIds: readonly string[],
	regionsById: ReadonlyMap<string, { readonly depth: number }>,
): RegionCompositionDiagnostic | undefined {
	for (const id of preorderIds) {
		const depth = defined(regionsById.get(id)).depth;
		if (depth < MAX_REGION_RECURSION_DEPTH) continue;
		return {
			code: RegionCompositionDiagnosticCode.StackDepthLimit,
			message: `Recursive region stack depth ${depth + 1} exceeds the safe limit of ${MAX_REGION_RECURSION_DEPTH}.`,
			path: ['regions', id, 'depth'],
			actual: depth + 1,
			limit: MAX_REGION_RECURSION_DEPTH,
		};
	}
	return undefined;
}

/** Children owned by each parent region, keyed by the parent identity. */
export function regionChildCounts(input: RegionInput): ReadonlyMap<string, number> {
	const counts = new Map<string, number>();
	for (const region of input.regions) {
		if (region.parentId === undefined) continue;
		counts.set(region.parentId, (counts.get(region.parentId) ?? 0) + 1);
	}
	return counts;
}
