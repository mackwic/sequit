import type { Point } from '../../../lib/core/layout/layout-types';
import type { RenderedRelation } from '../../web/ui/canvas/render-relations';
import { routeCrossings } from './route-geometry';

interface Bridge extends Point {
	readonly routeId: string;
	readonly axis: 'x' | 'y';
}

/** Read the absolute M/L/A commands emitted by the canvas; never treat an arbitrary arc as a bridge. */
function bridgesIn(rendered: RenderedRelation): readonly Bridge[] {
	const tokens = rendered.path.trim().split(/\s+/);
	const bridges: Bridge[] = [];
	let cursor: Point | undefined;
	let index = 0;
	function number(): number {
		const value = Number(tokens[index++]);
		if (!Number.isFinite(value)) throw new Error(`Invalid rendered path: ${rendered.id}`);
		return value;
	}
	while (index < tokens.length) {
		const command = tokens[index++];
		if (command === 'M' || command === 'L') {
			cursor = { x: number(), y: number() };
			continue;
		}
		if (command !== 'A' || cursor === undefined)
			throw new Error(`Unsupported rendered path command: ${String(command)}`);
		const radiusX = number();
		const radiusY = number();
		const rotation = number();
		const large = number();
		const sweep = number();
		const end = { x: number(), y: number() };
		const diameter = Math.abs(end.x - cursor.x) + Math.abs(end.y - cursor.y);
		const circular = radiusX > 0 && radiusX === radiusY && Math.abs(diameter - 2 * radiusX) < 0.001;
		if (circular && rotation === 0 && large === 0 && (sweep === 0 || sweep === 1)) {
			const center = { x: (cursor.x + end.x) / 2, y: (cursor.y + end.y) / 2, routeId: rendered.id };
			if (cursor.y === end.y) bridges.push({ ...center, axis: 'x' });
			else if (cursor.x === end.x) bridges.push({ ...center, axis: 'y' });
		}
		cursor = end;
	}
	return bridges;
}

interface RenderedPathsAssertions {
	haveBridgeAtEveryCrossing(): void;
}

/** VL-403/416: locate a bridge on one of the two actual paths at each calculated crossing. */
export function AssertRenderedPaths(paths: readonly RenderedRelation[]): RenderedPathsAssertions {
	return {
		haveBridgeAtEveryCrossing() {
			if (paths.length < 2) throw new Error('Expected at least two rendered paths.');
			if (new Set(paths.map(({ id }) => id)).size !== paths.length)
				throw new Error('Rendered path identifiers must be unique.');
			const crossings = routeCrossings(paths);
			const bridges = paths.flatMap(bridgesIn);
			for (const crossing of crossings) {
				const found = bridges.some((bridge) => {
					const carrier =
						(bridge.axis === 'x' && bridge.routeId === crossing.horizontalId) ||
						(bridge.axis === 'y' && bridge.routeId === crossing.verticalId);
					return (
						carrier &&
						Math.abs(bridge.x - crossing.x) < 0.001 &&
						Math.abs(bridge.y - crossing.y) < 0.001
					);
				});
				if (!found)
					throw new Error(
						`Missing bridge at (${crossing.x}, ${crossing.y}) between "${crossing.horizontalId}" and "${crossing.verticalId}".`,
					);
			}
		},
	};
}
