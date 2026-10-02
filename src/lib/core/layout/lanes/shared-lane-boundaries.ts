import { defined } from '../../document/logic-document';
import { BASE_RANK_GAP, RAIL_SPACING } from '../layout-settings';

/** One lane's stretch of a row boundary: boundary 0 precedes row 0, boundary `row + 1` follows it. */
export function boundaryKey(laneIndex: number, boundaryIndex: number): string {
	return JSON.stringify([laneIndex, boundaryIndex]);
}

/**
 * What one lane routes through one of its row boundaries. The detours leaving the earlier row keep
 * nearest it, those leaving the later row nearest that one, and the local rails run between them.
 */
export interface BoundaryUse {
	readonly earlier: number;
	readonly rails: number;
	readonly later: number;
}

/** The row boundaries of a parallel frame once its rows are placed. */
export interface PlacedBoundaries {
	/** Long size of each row boundary: before row 0, between two rows, after the last row. */
	readonly sizes: readonly number[];
	/** Long start of each row boundary. */
	readonly starts: readonly number[];
	/** The use of each lane boundary, keyed by `boundaryKey`; an absent key routes nothing. */
	readonly uses: ReadonlyMap<string, BoundaryUse>;
}

function trackCount(use: BoundaryUse | undefined): number {
	if (use === undefined) return 0;
	return use.earlier + use.rails + use.later;
}

/** Centred tracks of one corridor, at rail spacing. */
export function corridorTrack(start: number, size: number, count: number, index: number): number {
	const spread = (count - 1) * RAIL_SPACING;
	const first = start + (size - spread) / 2;
	return first + index * RAIL_SPACING;
}

/**
 * Every row boundary holds the tracks of its busiest lane at rail spacing; a boundary between two
 * rows keeps at least the ordinary rank gap.
 */
export function boundarySizes(
	rowCount: number,
	laneCount: number,
	uses: ReadonlyMap<string, BoundaryUse>,
): readonly number[] {
	const sizes: number[] = [];
	for (let boundary = 0; boundary <= rowCount; boundary += 1) {
		let tracks = 0;
		for (let lane = 0; lane < laneCount; lane += 1)
			tracks = Math.max(tracks, trackCount(uses.get(boundaryKey(lane, boundary))));
		let size = tracks * RAIL_SPACING;
		if (boundary > 0 && boundary < rowCount) size = Math.max(BASE_RANK_GAP, size);
		sizes.push(size);
	}
	return sizes;
}

/** The long coordinate of the track at `slot` among every track of one lane boundary. */
export function boundaryTrack(
	boundaries: PlacedBoundaries,
	laneIndex: number,
	boundaryIndex: number,
	slot: number,
): number {
	return corridorTrack(
		defined(boundaries.starts[boundaryIndex]),
		defined(boundaries.sizes[boundaryIndex]),
		trackCount(boundaries.uses.get(boundaryKey(laneIndex, boundaryIndex))),
		slot,
	);
}
