import { defined } from '../../document/logic-document';
import type { RoutingEdge } from '../geometry/routing-edge';
import { OUTER_MARGIN } from '../layout-settings';
import type { LayoutElement } from '../layout-types';
import {
	frameEdgeBand,
	frameExteriorRailEdge,
	frameGutterEdge,
	frameOwnerId,
	physicalBounds,
} from './shared-lane-frame';
import {
	compareLayoutOrder,
	type SharedLaneEndpoint,
	type SharedLaneInput,
} from './shared-lane-model';
import type { SharedLanePorts } from './shared-lane-ports';
import type { LogicalBox, SharedLaneBounds } from './shared-lane-types';
import { localLegLevels, localRowGaps } from './shared-transverse-legs';

const LANE_INSET = 24;
const ENDPOINT_GAP = 48;
const MINIMUM_LANE_SIZE = 144;

export interface TransverseLaneFrame {
	readonly boxes: ReadonlyMap<string, LogicalBox>;
	readonly elements: readonly LayoutElement[];
	readonly lanes: readonly SharedLaneBounds[];
	readonly crossStart: number;
	readonly crossSize: number;
	readonly crossExtent: number;
	readonly longExtent: number;
	readonly laneLongStarts: readonly number[];
	readonly laneLongSizes: readonly number[];
	/** The port offsets the frame placed its elements with: what the routing reads a port again by. */
	readonly portOffsetByIncidence: ReadonlyMap<string, number>;
	/** The owner of the routing edges this frame publishes. */
	readonly ownerId: string;
	/** The gutter corridor across the lanes: one track per plan, both sides reading the ordinal. */
	readonly gutterEdge: RoutingEdge;
	/** The rail band along a lane: one track per plan, both ends of a lane reading the ordinal. */
	readonly railEdge: RoutingEdge;
	/** The rank-axis position of the leg of each facing local plan, in the row gap it crosses. */
	readonly localLegByPlan: ReadonlyMap<string, number>;
}

/**
 * The endpoints of one lane in cross order: by row, then documentary order inside a row. Each keeps
 * its own cross column, so a port leaves the lane along the rank axis without meeting a neighbour.
 */
function orderedEndpoints(
	input: SharedLaneInput,
	laneIndex: number,
): readonly SharedLaneEndpoint[] {
	return [...input.endpoints.values()]
		.filter((item) => item.laneIndex === laneIndex)
		.sort((a, b) => {
			const row = a.row - b.row;
			if (row !== 0) return row;
			return compareLayoutOrder(a, b);
		});
}

function endpointCrossSize(item: SharedLaneEndpoint, ports: SharedLanePorts): number {
	return Math.max(item.crossSize, ports.crossDemandByEndpoint.get(item.id) ?? 0);
}

function contentCrossSize(items: readonly SharedLaneEndpoint[], ports: SharedLanePorts): number {
	let content = 0;
	for (const item of items) content += endpointCrossSize(item, ports);
	if (items.length > 1) content += (items.length - 1) * ENDPOINT_GAP;
	return content;
}

interface LaneRow {
	readonly offset: number;
	readonly size: number;
}

/** The rows of one lane along the rank axis, in row order, and the content length they span. */
interface LaneRows {
	readonly rows: ReadonlyMap<number, LaneRow>;
	readonly content: number;
}

function laneRows(
	items: readonly SharedLaneEndpoint[],
	laneIndex: number,
	gapAfter: (laneIndex: number, row: number) => number,
): LaneRows {
	const sizes = new Map<number, number>();
	for (const item of items) sizes.set(item.row, Math.max(sizes.get(item.row) ?? 0, item.longSize));
	const rows = new Map<number, LaneRow>();
	let cursor = 0;
	let previous: number | undefined;
	for (const [row, size] of sizes) {
		if (previous !== undefined) cursor += gapAfter(laneIndex, previous);
		rows.set(row, { offset: cursor, size });
		cursor += size;
		previous = row;
	}
	return { rows, content: cursor };
}

interface TransverseLaneMetrics {
	readonly items: readonly (readonly SharedLaneEndpoint[])[];
	readonly rows: readonly LaneRows[];
	readonly lengths: readonly number[];
	readonly occupiedCross: readonly number[];
	readonly crossSize: number;
}

function laneMetrics(input: SharedLaneInput, ports: SharedLanePorts): TransverseLaneMetrics {
	const items = input.laneIds.map((_id, index) => orderedEndpoints(input, index));
	const gapAfter = localRowGaps(input);
	const rows = items.map((lane, index) => laneRows(lane, index, gapAfter));
	const lengths = rows.map(({ content }) => Math.max(MINIMUM_LANE_SIZE, content + 2 * LANE_INSET));
	const occupiedCross = items.map((lane) => contentCrossSize(lane, ports));
	const crossSize = Math.max(
		MINIMUM_LANE_SIZE,
		...occupiedCross.map((width) => width + 2 * LANE_INSET),
	);
	return { items, rows, lengths, occupiedCross, crossSize };
}

/** Where each lane starts along the rank axis, and the frame's whole length along it. */
interface LongitudinalPositions {
	readonly starts: readonly number[];
	readonly extent: number;
}

function longitudinalPositions(
	lengths: readonly number[],
	maximumTrack: number,
): LongitudinalPositions {
	const gap = 2 * maximumTrack + LANE_INSET;
	const starts: number[] = [];
	let cursor = OUTER_MARGIN + maximumTrack;
	for (const length of lengths) {
		starts.push(cursor);
		cursor += length + gap;
	}
	const extent = cursor - gap + maximumTrack + OUTER_MARGIN;
	return { starts, extent };
}

interface TransversePositioning {
	readonly longitudinal: LongitudinalPositions;
	readonly crossStart: number;
}

/** Where the rows of one lane begin: its content is centred along the lane's length. */
function laneContentStart(
	metrics: TransverseLaneMetrics,
	positions: LongitudinalPositions,
	laneIndex: number,
): number {
	const laneStart = defined(positions.starts[laneIndex]);
	const content = defined(metrics.rows[laneIndex]).content;
	return laneStart + (defined(metrics.lengths[laneIndex]) - content) / 2;
}

function positionEndpoints(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	metrics: TransverseLaneMetrics,
	positioning: TransversePositioning,
): {
	readonly boxes: ReadonlyMap<string, LogicalBox>;
	readonly elements: readonly LayoutElement[];
} {
	const boxes = new Map<string, LogicalBox>();
	const elements: LayoutElement[] = [];
	for (const [laneIndex, laneItems] of metrics.items.entries()) {
		const freeCross = metrics.crossSize - defined(metrics.occupiedCross[laneIndex]);
		const lane = defined(metrics.rows[laneIndex]);
		const contentStart = laneContentStart(metrics, positioning.longitudinal, laneIndex);
		let cursor = positioning.crossStart + freeCross / 2;
		for (const item of laneItems) {
			const crossSize = endpointCrossSize(item, ports);
			const row = defined(lane.rows.get(item.row));
			const rowStart = contentStart + row.offset;
			const longitudinal = rowStart + (row.size - item.longSize) / 2;
			const logical = { cross: cursor, longitudinal, crossSize, longSize: item.longSize };
			boxes.set(item.id, logical);
			elements.push({
				id: item.id,
				kind: item.kind,
				bounds: physicalBounds(logical, input, positioning.longitudinal.extent),
			});
			cursor += crossSize + ENDPOINT_GAP;
		}
	}
	return { boxes, elements };
}

function positionedLanes(
	input: SharedLaneInput,
	metrics: TransverseLaneMetrics,
	positions: LongitudinalPositions,
	crossStart: number,
): readonly SharedLaneBounds[] {
	return input.laneIds.map((id, index) => ({
		id,
		bounds: physicalBounds(
			{
				cross: crossStart,
				longitudinal: defined(positions.starts[index]),
				crossSize: metrics.crossSize,
				longSize: defined(metrics.lengths[index]),
			},
			input,
			positions.extent,
		),
	}));
}

/**
 * The transverse frame: lanes stacked along the rank axis, each holding its rows in rank order; the
 * endpoints of one row sit side by side and every endpoint keeps its own cross column in its lane.
 */
export function makeTransverseLaneFrame(
	input: SharedLaneInput,
	ports: SharedLanePorts,
): TransverseLaneFrame {
	const metrics = laneMetrics(input, ports);
	const ownerId = frameOwnerId(input);
	const gutterEdge = frameGutterEdge(ownerId, input.plans.length);
	const railEdge = frameExteriorRailEdge(ownerId, input.plans.length);
	const maximumTrack = Math.max(frameEdgeBand(gutterEdge), frameEdgeBand(railEdge));
	const positions = longitudinalPositions(metrics.lengths, maximumTrack);
	const crossStart = OUTER_MARGIN + maximumTrack;
	const placed = positionEndpoints(input, ports, metrics, { longitudinal: positions, crossStart });
	const localLegByPlan = localLegLevels(input, {
		boxes: placed.boxes,
		offsets: ports.offsetByIncidence,
		gapStart: (laneIndex, row) => {
			const before = defined(defined(metrics.rows[laneIndex]).rows.get(row));
			return laneContentStart(metrics, positions, laneIndex) + before.offset + before.size;
		},
	});
	return {
		boxes: placed.boxes,
		elements: placed.elements,
		lanes: positionedLanes(input, metrics, positions, crossStart),
		crossStart,
		crossSize: metrics.crossSize,
		crossExtent: crossStart + metrics.crossSize + maximumTrack + OUTER_MARGIN,
		longExtent: positions.extent,
		laneLongStarts: positions.starts,
		laneLongSizes: metrics.lengths,
		portOffsetByIncidence: ports.offsetByIncidence,
		ownerId,
		gutterEdge,
		railEdge,
		localLegByPlan,
	};
}
