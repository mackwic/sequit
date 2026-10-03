import { defined, type LogicRelation } from '../../document/logic-document';
import type { Bounds, Point } from '../layout-types';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import {
	CROSSING_SPACING,
	crossingFaceExtent,
	crossingRailX,
	type GridRoutingEdges,
} from './grid-cell-crossing';
import type { GridCrossingAllocation } from './grid-cell-crossing-allocation-types';
import { adjacentCellSide, faceSpan } from './grid-cell-crossing-face';
import { crossingRowY } from './grid-cell-crossing-resources';
import { equal } from './grid-cell-geometry-primitives';
import type { GridCellPlacement } from './grid-cell-types';

/** The gap between two neighbouring cells and where its jogs may lie. */
interface DirectGap {
	/** The cells share a row: the gap is vertical and the jog is a vertical segment at some x. */
	readonly lateral: boolean;
	/** The column gutter whose allocated tracks order the crossings of this gap. */
	readonly gutterColumn: number;
	/** The left cell's right edge or the upper cell's bottom edge. */
	readonly gapStart: number;
	/**
	 * Free lane offsets from `gapStart`, best first, shared with the crossing's mates; undefined
	 * when the gap is the inner gutter of `gutterColumn`, whose own allocated track carries the jog.
	 */
	readonly lanes: readonly number[] | undefined;
	/** The left frame of `gutterColumn`'s cells, which anchors an inner gutter's rails. */
	readonly frameX: number;
}

/**
 * A crossing between two neighbouring cells of one row or one column, routed through the gap that
 * separates them: each endpoint ports on the face looking at the other cell, and the route jogs
 * once inside the gap when its two portals are not aligned.
 */
export interface DirectCrossing extends DirectGap {
	readonly sourceSide: RegionPortalSide;
	readonly targetSide: RegionPortalSide;
	/** The crossings sharing these lanes, this one included, in documentary order. */
	readonly mates: readonly string[];
}

interface DirectCrossingInput {
	readonly crossing: readonly LogicRelation[];
	readonly cells: readonly GridCellPlacement[];
	readonly cellByEndpointId: ReadonlyMap<string, string>;
	readonly columnCount: number;
	readonly edges: GridRoutingEdges;
	readonly nestedEndpointIds: ReadonlySet<string>;
}

/**
 * The lanes of a gap of `width` that keep a track of clearance from both cells, avoid the reserved
 * tracks of another resource and the excluded approach lanes, nearest the gap middle first.
 */
function freeLanes(width: number, taken: readonly number[]): readonly number[] {
	const lanes: number[] = [];
	for (
		let offset = CROSSING_SPACING;
		offset <= width - CROSSING_SPACING;
		offset += CROSSING_SPACING
	)
		if (!taken.some((other) => equal(other, offset))) lanes.push(offset);
	const middle = width / 2;
	return lanes.sort((left, right) => {
		const nearer = Math.abs(left - middle) - Math.abs(right - middle);
		return nearer || left - right;
	});
}

/**
 * The gap between two neighbouring cells. Between rows the allocated row tracks are reserved, and
 * the lane one track above the lower cell is where an inherited incident approaches its outer rail;
 * between columns both lanes one track from a cell are such approaches. A gap before an inner
 * column is that column's gutter: its own allocated track, already reserved, carries the jog.
 */
function gapOf(
	first: GridCellPlacement,
	second: GridCellPlacement,
	input: DirectCrossingInput,
): DirectGap {
	const [low, high] = [first, second].sort((left, right) => {
		const rows = left.row - right.row;
		return rows || left.column - right.column;
	});
	const upper = defined(low);
	const lower = defined(high);
	if (upper.row === lower.row) {
		const gapStart = upper.bounds.x + upper.bounds.width;
		const width = lower.bounds.x - gapStart;
		let lanes: readonly number[] | undefined;
		if (lower.column === input.columnCount - 1)
			lanes = freeLanes(width, [CROSSING_SPACING, width - CROSSING_SPACING]);
		return { lateral: true, gutterColumn: lower.column, gapStart, lanes, frameX: lower.bounds.x };
	}
	const gapStart = upper.bounds.y + upper.bounds.height;
	const width = lower.bounds.y - gapStart;
	const rowEdge = defined(input.edges.rowGutters[upper.row]);
	const reserved = Array.from(
		{ length: rowEdge.capacity },
		(_, track) => crossingRowY(rowEdge, gapStart, track) - gapStart,
	);
	return {
		lateral: false,
		gutterColumn: upper.column,
		gapStart,
		lanes: freeLanes(width, [...reserved, width - CROSSING_SPACING]),
		frameX: upper.bounds.x,
	};
}

function endpointBounds(cell: GridCellPlacement, endpointId: string): Bounds {
	return defined(cell.localLayout.elements.find(({ id }) => id === endpointId)).bounds;
}

/** Drops the crossings of every gap with fewer free lanes than crossings. */
function withinLanes(candidates: Map<string, DirectCrossing>): void {
	for (const [id, direct] of candidates)
		if (direct.lanes !== undefined && direct.mates.length > direct.lanes.length)
			candidates.delete(id);
}

interface DirectFace {
	readonly bounds: Bounds;
	readonly side: RegionPortalSide;
	readonly ids: string[];
}

/** Drops the crossings of a top or bottom face too narrow for its stacked ports. */
function withinFaces(
	candidates: Map<string, DirectCrossing>,
	input: DirectCrossingInput,
	cellById: ReadonlyMap<string, GridCellPlacement>,
): void {
	const byFace = new Map<string, DirectFace>();
	for (const relation of input.crossing) {
		const direct = candidates.get(relation.id);
		if (direct === undefined || direct.lateral) continue;
		const ends: readonly (readonly [string, RegionPortalSide])[] = [
			[relation.from, direct.sourceSide],
			[relation.to, direct.targetSide],
		];
		for (const [endpointId, side] of ends) {
			const key = `${endpointId}\u0000${side}`;
			const cell = defined(cellById.get(defined(input.cellByEndpointId.get(endpointId))));
			const face = byFace.get(key) ?? { bounds: endpointBounds(cell, endpointId), side, ids: [] };
			face.ids.push(relation.id);
			byFace.set(key, face);
		}
	}
	for (const { bounds, side, ids } of byFace.values())
		if (faceSpan(bounds, side).length < crossingFaceExtent(ids.length))
			for (const id of ids) candidates.delete(id);
}

/**
 * The crossings this grid routes through the gap between their neighbouring cells. A crossing with
 * an endpoint nested in a sub-region keeps its gutter route, since the grid cannot port that frame;
 * so does every crossing of a gap whose free lanes are fewer than its crossings, or of a top or
 * bottom face too narrow for its ports. The others still fall back to their gutter route when the
 * gap route of an allocation does not validate.
 */
export function directCrossings(input: DirectCrossingInput): ReadonlyMap<string, DirectCrossing> {
	const cellById = new Map(input.cells.map((cell) => [cell.id, cell]));
	const cellOf = (endpointId: string) =>
		defined(cellById.get(defined(input.cellByEndpointId.get(endpointId))));
	const candidates = new Map<string, DirectCrossing>();
	const matesByGap = new Map<string, string[]>();
	for (const relation of input.crossing) {
		const source = cellOf(relation.from);
		const target = cellOf(relation.to);
		const sourceSide = adjacentCellSide(source, target);
		const targetSide = adjacentCellSide(target, source);
		const nested = [relation.from, relation.to].some((id) => input.nestedEndpointIds.has(id));
		if (nested || sourceSide === undefined) continue;
		if (targetSide === undefined) continue;
		const gap = gapOf(source, target, input);
		const key = `${gap.lateral}:${gap.gutterColumn}:${Math.min(source.row, target.row)}`;
		const mates = matesByGap.get(key) ?? [];
		mates.push(relation.id);
		matesByGap.set(key, mates);
		candidates.set(relation.id, { ...gap, sourceSide, targetSide, mates });
	}
	withinLanes(candidates);
	withinFaces(candidates, input, cellById);
	return new Map(
		[...candidates].map(([id, direct]) => [
			id,
			{ ...direct, mates: direct.mates.filter((mate) => candidates.has(mate)) },
		]),
	);
}

/**
 * The jog coordinate of a direct crossing for one allocation: x of the vertical jog between two
 * columns, y of the horizontal jog between two rows. The gutter tracks of the gap's reference column
 * are distinct, so they order the crossings sharing its lanes.
 */
export function directJog(
	direct: DirectCrossing,
	relationId: string,
	allocation: GridCrossingAllocation,
	edges: GridRoutingEdges,
): number {
	const tracks = defined(allocation.gutterTrackByRelationId[direct.gutterColumn]);
	const own = defined(tracks.get(relationId));
	if (direct.lanes === undefined) {
		const edge = defined(edges.gutters[direct.gutterColumn]);
		return crossingRailX(edge, direct.frameX, RegionPortalSide.Left, own);
	}
	const rank = trackRank(direct.mates, tracks, own);
	return direct.gapStart + defined(direct.lanes[rank]);
}

/** The grid-owned points between the two portals of a direct crossing: none when aligned. */
export function directJogPoints(
	direct: DirectCrossing,
	jog: number,
	source: Point,
	target: Point,
): readonly Point[] {
	if (direct.lateral) {
		if (equal(source.y, target.y)) return [];
		return [
			{ x: jog, y: source.y },
			{ x: jog, y: target.y },
		];
	}
	if (equal(source.x, target.x)) return [];
	return [
		{ x: source.x, y: jog },
		{ x: target.x, y: jog },
	];
}

/** How many of `ids` hold a track below `own`: the rank of `own` among them. */
export function trackRank(
	ids: readonly string[],
	tracks: ReadonlyMap<string, number>,
	own: number,
): number {
	let rank = 0;
	for (const id of ids) if (defined(tracks.get(id)) < own) rank += 1;
	return rank;
}
