import type { RouteBridgeAnalysis } from '../bridge-oracle';
import { routeBridgeAnalysis } from '../bridge-oracle';
import type { LayoutResult } from '../layout-types';
import type { DedicatedRouteScore } from './types';

export function routeScore(analysis: RouteBridgeAnalysis): DedicatedRouteScore {
	return {
		strictCrossings: analysis.crossings.length,
		validatedBridges: analysis.bridges.length,
	};
}

/** Scores materialized geometry rather than abstract rank inversions. */
export function scoreDedicatedCandidateRoutes(layout: LayoutResult): DedicatedRouteScore {
	return routeScore(routeBridgeAnalysis(layout.relations));
}

export function compareDedicatedRouteScores(
	first: DedicatedRouteScore,
	second: DedicatedRouteScore,
): number {
	return (
		first.strictCrossings - second.strictCrossings ||
		first.validatedBridges - second.validatedBridges
	);
}
