import type { VisualLayout } from '../harnesses/visual-layout';
import { routeSegments } from './route-geometry';
import { extent, minimumMetric } from './routing-measurements';

/** Rectangle distance, including contacts; attached routes may meet only their own endpoint. */
export function assertLayoutObstacles(layout: VisualLayout, clearance: number): void {
	for (const [index, a] of layout.elements.entries()) {
		for (const b of layout.elements.slice(index + 1)) {
			const x = Math.max(
				a.bounds.x - b.bounds.x - b.bounds.width,
				b.bounds.x - a.bounds.x - a.bounds.width,
			);
			const y = Math.max(
				a.bounds.y - b.bounds.y - b.bounds.height,
				b.bounds.y - a.bounds.y - a.bounds.height,
			);
			minimumMetric('Dégagement entre objets', Math.max(x, y), clearance, { boxes: [a.id, b.id] });
		}
	}
	for (const route of layout.relations) {
		for (const obstacle of layout.elements) {
			if (route.from === obstacle.id || route.to === obstacle.id) continue;
			for (const segment of routeSegments(route)) {
				let normal: 'x' | 'y' = 'y';
				if (segment.axis === 'y') normal = 'x';
				const bounds = obstacle.bounds;
				const along = Math.max(
					bounds[segment.axis] - segment.end,
					segment.start - bounds[segment.axis] - extent(bounds, segment.axis),
				);
				const across = Math.max(
					bounds[normal] - segment.fixed,
					segment.fixed - bounds[normal] - extent(bounds, normal),
				);
				minimumMetric('Route étrangère hors de l’obstacle', Math.max(along, across), clearance, {
					boxes: [obstacle.id],
					routes: [route.id],
				});
			}
		}
	}
}
