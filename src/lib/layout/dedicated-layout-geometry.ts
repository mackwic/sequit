import { LayoutDirection } from '../document/logic-document';
import type { Bounds, GroupMeasurement, Point } from './layout-types';

export function translateBounds(bounds: Bounds, x: number, y: number): Bounds {
	return { ...bounds, x: bounds.x + x, y: bounds.y + y };
}

function routePoints(source: Bounds, target: Bounds, direction: LayoutDirection): readonly Point[] {
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

enum PortSide {
	Top = 'top',
	Right = 'right',
	Bottom = 'bottom',
	Left = 'left',
}

interface RoutePort extends Point {
	readonly side: PortSide;
}

function endpointCenter(bounds: Bounds): Point {
	return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function ordinaryPort(bounds: Bounds, direction: LayoutDirection, source: boolean): RoutePort {
	if (direction === LayoutDirection.TopToBottom) {
		if (source) {
			return {
				x: bounds.x + bounds.width / 2,
				y: bounds.y + bounds.height,
				side: PortSide.Bottom,
			};
		}
		return { x: bounds.x + bounds.width / 2, y: bounds.y, side: PortSide.Top };
	}
	if (direction === LayoutDirection.BottomToTop) {
		if (source) return { x: bounds.x + bounds.width / 2, y: bounds.y, side: PortSide.Top };
		return {
			x: bounds.x + bounds.width / 2,
			y: bounds.y + bounds.height,
			side: PortSide.Bottom,
		};
	}
	if (direction === LayoutDirection.LeftToRight) {
		if (source) {
			return {
				x: bounds.x + bounds.width,
				y: bounds.y + bounds.height / 2,
				side: PortSide.Right,
			};
		}
		return { x: bounds.x, y: bounds.y + bounds.height / 2, side: PortSide.Left };
	}
	if (source) return { x: bounds.x, y: bounds.y + bounds.height / 2, side: PortSide.Left };
	return {
		x: bounds.x + bounds.width,
		y: bounds.y + bounds.height / 2,
		side: PortSide.Right,
	};
}

function groupPort(bounds: Bounds, measurement: GroupMeasurement, toward: Point): RoutePort {
	const contentTop = Math.min(bounds.y + bounds.height, bounds.y + measurement.headerHeight);
	const availableHeight = Math.max(0, bounds.y + bounds.height - contentTop);
	const y = contentTop + availableHeight / 2;
	if (toward.x < bounds.x + bounds.width / 2) {
		return { x: bounds.x, y, side: PortSide.Left };
	}
	return { x: bounds.x + bounds.width, y, side: PortSide.Right };
}

function outsidePort(port: RoutePort, clearance = 24): Point {
	if (port.side === PortSide.Top) return { x: port.x, y: port.y - clearance };
	if (port.side === PortSide.Right) return { x: port.x + clearance, y: port.y };
	if (port.side === PortSide.Bottom) return { x: port.x, y: port.y + clearance };
	return { x: port.x - clearance, y: port.y };
}

function appendDistinct(points: Point[], point: Point): void {
	const previous = points.at(-1);
	if (previous?.x === point.x && previous.y === point.y) return;
	points.push(point);
}

export function routePointsWithGroupHeaders({
	source,
	target,
	direction,
	sourceGroup,
	targetGroup,
}: {
	readonly source: Bounds;
	readonly target: Bounds;
	readonly direction: LayoutDirection;
	readonly sourceGroup?: GroupMeasurement | undefined;
	readonly targetGroup?: GroupMeasurement | undefined;
}): readonly Point[] {
	if (sourceGroup === undefined && targetGroup === undefined)
		return routePoints(source, target, direction);
	let sourcePort = ordinaryPort(source, direction, true);
	if (sourceGroup !== undefined) {
		sourcePort = groupPort(source, sourceGroup, endpointCenter(target));
	}
	let targetPort = ordinaryPort(target, direction, false);
	if (targetGroup !== undefined) {
		targetPort = groupPort(target, targetGroup, endpointCenter(source));
	}
	const sourceOutside = outsidePort(sourcePort);
	const targetOutside = outsidePort(targetPort);
	const points: Point[] = [{ x: sourcePort.x, y: sourcePort.y }];
	appendDistinct(points, sourceOutside);
	if (sourceOutside.x !== targetOutside.x && sourceOutside.y !== targetOutside.y) {
		if (sourcePort.side === PortSide.Left || sourcePort.side === PortSide.Right) {
			const middleX = (sourceOutside.x + targetOutside.x) / 2;
			appendDistinct(points, { x: middleX, y: sourceOutside.y });
			appendDistinct(points, { x: middleX, y: targetOutside.y });
		} else {
			const middleY = (sourceOutside.y + targetOutside.y) / 2;
			appendDistinct(points, { x: sourceOutside.x, y: middleY });
			appendDistinct(points, { x: targetOutside.x, y: middleY });
		}
	}
	appendDistinct(points, targetOutside);
	appendDistinct(points, { x: targetPort.x, y: targetPort.y });
	return points;
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
