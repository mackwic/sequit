import { defined } from '../../document/logic-document';
import type { Point } from '../layout-types';

function transverse(point: Point, vertical: boolean): number {
	if (vertical) return point.x;
	return point.y;
}

function offset(point: Point, amount: number, vertical: boolean): Point {
	if (vertical) return { x: point.x + amount, y: point.y };
	return { x: point.x, y: point.y + amount };
}

/** Other attachments on a reserved node face must use its allocated quays too. */
export function anchorRouteToQuays(
	points: readonly Point[],
	source: number,
	target: number,
	vertical: boolean,
): readonly Point[] {
	if (source === 0 && target === 0) return points;
	const first = defined(points[0]);
	const last = defined(points.at(-1));
	const start = offset(first, source, vertical);
	const end = offset(last, target, vertical);
	const firstCross = transverse(first, vertical);
	const lastCross = transverse(last, vertical);
	if (points.every((point) => transverse(point, vertical) === firstCross)) {
		let middle = (first.x + last.x) / 2;
		if (vertical) {
			middle = (first.y + last.y) / 2;
			return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
		}
		return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
	}
	let prefix = 0;
	let suffix = points.length - 1;
	while (transverse(defined(points[prefix]), vertical) === firstCross) prefix += 1;
	while (transverse(defined(points[suffix]), vertical) === lastCross) suffix -= 1;
	return points.map((point, index) => {
		if (index < prefix) return offset(point, source, vertical);
		if (index > suffix) return offset(point, target, vertical);
		return point;
	});
}
