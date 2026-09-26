import { defined } from '../../document/logic-document';
import type { RouteBridgeAnalysis } from '../bridge-oracle';
import { routeBridgeAnalysis } from '../bridge-oracle';
import type { LayoutResult, Point } from '../layout-types';
import type { DedicatedRouteScore } from './types';

interface MutableRouteScore {
	strictCrossings: number;
	validatedBridges: number;
	length: number;
	bends: number;
}

function accumulateRouteGeometry(
	route: LayoutResult['relations'][number],
	score: MutableRouteScore,
): void {
	let runCount = 0;
	let previousRunEnd: Point | undefined;
	let previousOrientation = 0;
	let previousDirection = 0;
	for (let index = 1; index < route.points.length; index += 1) {
		const previous = defined(route.points[index - 1]);
		const point = defined(route.points[index]);
		const deltaX = point.x - previous.x;
		const deltaY = point.y - previous.y;
		score.length += Math.abs(deltaX) + Math.abs(deltaY);
		let orientation: number;
		let direction: number;
		if (deltaX === 0 && deltaY !== 0) {
			orientation = 1;
			direction = Math.sign(deltaY);
		} else if (deltaY === 0 && deltaX !== 0) {
			orientation = 2;
			direction = Math.sign(deltaX);
		} else continue;
		const samePosition = previousRunEnd?.x === previous.x && previousRunEnd.y === previous.y;
		const sameDirection = orientation === previousOrientation && direction === previousDirection;
		if (!samePosition || !sameDirection) runCount += 1;
		previousRunEnd = point;
		previousOrientation = orientation;
		previousDirection = direction;
	}
	if (runCount > 1) score.bends += runCount - 1;
}

export function routeScore(
	layout: LayoutResult,
	analysis: RouteBridgeAnalysis,
): DedicatedRouteScore {
	const score: MutableRouteScore = {
		strictCrossings: analysis.crossings.length,
		validatedBridges: analysis.bridges.length,
		length: 0,
		bends: 0,
	};
	for (const route of layout.relations) accumulateRouteGeometry(route, score);
	return score;
}

/** Scores materialized geometry rather than abstract rank inversions. */
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
