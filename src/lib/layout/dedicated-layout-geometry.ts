import { LayoutDirection } from '../document/logic-document';
import type { Bounds, Point } from './layout-types';

export function translateBounds(bounds: Bounds, x: number, y: number): Bounds {
	return { ...bounds, x: bounds.x + x, y: bounds.y + y };
}

export function routePoints(
	source: Bounds,
	target: Bounds,
	direction: LayoutDirection,
): readonly Point[] {
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop) {
		let sourceY = source.y;
		let targetY = target.y + target.height;
		if (direction === LayoutDirection.TopToBottom) {
			sourceY += source.height;
			targetY = target.y;
		}
		const start = { x: source.x + source.width / 2, y: sourceY };
		const end = { x: target.x + target.width / 2, y: targetY };
		const middle = (start.y + end.y) / 2;
		return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
	}
	let sourceX = source.x;
	let targetX = target.x + target.width;
	if (direction === LayoutDirection.LeftToRight) {
		sourceX += source.width;
		targetX = target.x;
	}
	const start = { x: sourceX, y: source.y + source.height / 2 };
	const end = { x: targetX, y: target.y + target.height / 2 };
	const middle = (start.x + end.x) / 2;
	return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
}

interface RelationBounds {
	readonly relationId: string;
	readonly from: string;
	readonly to: string;
	readonly source: Bounds;
	readonly target: Bounds;
}

export function assertRelationBoundsAreDisjoint(input: RelationBounds): void {
	const { relationId, from, to, source, target } = input;
	const sourceBeforeTarget = source.x + source.width <= target.x;
	const targetBeforeSource = target.x + target.width <= source.x;
	const sourceAboveTarget = source.y + source.height <= target.y;
	const targetAboveSource = target.y + target.height <= source.y;
	const horizontallyDisjoint = sourceBeforeTarget || targetBeforeSource;
	const verticallyDisjoint = sourceAboveTarget || targetAboveSource;
	const disjoint = horizontallyDisjoint || verticallyDisjoint;
	if (!disjoint) throw new Error(`Relation bounds overlap: ${relationId} (${from} -> ${to})`);
}
