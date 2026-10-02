import { unbridgedCrossings } from './bridge-contact';
import { type RouteBridgeAnalysis, routeBridgeAnalysis, type RouteCrossing } from './bridge-oracle';
import type { RoutedPath } from './route-runs';

function crossingKey(crossing: RouteCrossing): string {
	return `${crossing.x}:${crossing.y}:${crossing.horizontalId}:${crossing.verticalId}`;
}

/**
 * Bridge carriers are shared: an added path can take the carrier of a crossing between two other
 * paths. True when `analysis`, over `path` and `others`, leaves such a crossing unbridged although
 * `others` alone bridge it.
 */
export function unbridgesForeignCrossing(
	analysis: RouteBridgeAnalysis,
	path: RoutedPath,
	others: readonly RoutedPath[],
): boolean {
	const foreign = unbridgedCrossings(analysis).filter(
		({ horizontalId, verticalId }) => horizontalId !== path.id && verticalId !== path.id,
	);
	if (foreign.length === 0) return false;
	const previous = new Set(unbridgedCrossings(routeBridgeAnalysis(others)).map(crossingKey));
	return foreign.some((crossing) => !previous.has(crossingKey(crossing)));
}
