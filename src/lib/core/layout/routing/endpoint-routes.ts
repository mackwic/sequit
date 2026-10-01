import { LayoutDirection } from '../../document/logic-document';
import { type Bounds, type Point, RelationBoundsOverlap } from '../layout-types';

/** All endpoint kinds attach on the principal faces, including groups with headers. */
export function routePoints({
	source,
	target,
	direction,
	rail,
	sourceOffset = 0,
	targetOffset = 0,
}: {
	readonly source: Bounds;
	readonly target: Bounds;
	readonly direction: LayoutDirection;
	/** Physical primary-axis coordinate of the reserved transverse rail. */
	readonly rail?: number | undefined;
	readonly sourceOffset?: number | undefined;
	readonly targetOffset?: number | undefined;
}): readonly Point[] {
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop) {
		let sourceY = source.y;
		let targetY = target.y + target.height;
		if (direction === LayoutDirection.BottomToTop) {
			sourceY += source.height;
			targetY = target.y;
		}
		const start = { x: source.x + source.width / 2 + sourceOffset, y: sourceY };
		const end = { x: target.x + target.width / 2 + targetOffset, y: targetY };
		const middle = rail ?? (start.y + end.y) / 2;
		return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
	}
	let sourceX = source.x;
	let targetX = target.x + target.width;
	if (direction === LayoutDirection.RightToLeft) {
		sourceX += source.width;
		targetX = target.x;
	}
	const start = { x: sourceX, y: source.y + source.height / 2 + sourceOffset };
	const end = { x: targetX, y: target.y + target.height / 2 + targetOffset };
	const middle = rail ?? (start.x + end.x) / 2;
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
	if (!disjoint) throw new RelationBoundsOverlap(relationId, from, to);
}
