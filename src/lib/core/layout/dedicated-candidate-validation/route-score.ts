import type { RouteBridgeAnalysis } from '../bridges/bridge-oracle';
import type { DedicatedRouteScore } from './types';

export function routeScore(analysis: RouteBridgeAnalysis): DedicatedRouteScore {
	return {
		strictCrossings: analysis.crossings.length,
		validatedBridges: analysis.bridges.length,
	};
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
