import { defined } from '../../document/logic-document';
import type { RouteBridgeAnalysis } from '../bridge-oracle';
import { routeBridgeAnalysis, routeRuns } from '../bridge-oracle';
import type { LayoutResult } from '../layout-types';
import type { DedicatedRouteScore } from './types';

export function routeScore(
	layout: LayoutResult,
	analysis: RouteBridgeAnalysis,
): DedicatedRouteScore {
	let length = 0;
	let bends = 0;
	for (const route of layout.relations) {
		for (let index = 1; index < route.points.length; index += 1) {
			const previous = defined(route.points[index - 1]);
			const point = defined(route.points[index]);
			const horizontalLength = Math.abs(point.x - previous.x);
			const verticalLength = Math.abs(point.y - previous.y);
			length += horizontalLength + verticalLength;
		}
		bends += Math.max(0, routeRuns(route).length - 1);
	}
	return {
		strictCrossings: analysis.crossings.length,
		validatedBridges: analysis.bridges.length,
		length,
		bends,
	};
}

/** Lexicographic score of final materialized paths, never of abstract rank inversions. */
export function scoreDedicatedCandidateRoutes(layout: LayoutResult): DedicatedRouteScore {
	return routeScore(layout, routeBridgeAnalysis(layout.relations));
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
