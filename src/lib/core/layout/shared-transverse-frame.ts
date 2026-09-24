import { defined } from '../document/logic-document';
import { OUTER_MARGIN, RAIL_SPACING } from './layout-settings';
import type { LayoutElement } from './layout-types';
import { type LogicalBox, physicalBounds, SHARED_LANE_CLEARANCE } from './shared-lane-frame';
import type { SharedLaneEndpoint, SharedLaneInput } from './shared-lane-model';
import type { SharedLanePorts } from './shared-lane-ports';
import type { SharedLaneBounds } from './shared-lane-types';

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
}

function orderedEndpoints(
	input: SharedLaneInput,
	laneIndex: number,
): readonly SharedLaneEndpoint[] {
	return [...input.endpoints.values()]
		.filter((item) => item.laneIndex === laneIndex)
		.sort((a, b) => a.row - b.row);
}

function endpointCrossSize(item: SharedLaneEndpoint, ports: SharedLanePorts): number {
	return Math.max(item.crossSize, ports.demandByEndpoint.get(item.id) ?? 0);
}

function contentCrossSize(items: readonly SharedLaneEndpoint[], ports: SharedLanePorts): number {
	let content = 0;
	for (const item of items) content += endpointCrossSize(item, ports);
	if (items.length > 1) content += (items.length - 1) * ENDPOINT_GAP;
	return content;
}

function laneMetrics(
	input: SharedLaneInput,
	ports: SharedLanePorts,
): {
	readonly items: readonly (readonly SharedLaneEndpoint[])[];
	readonly lengths: readonly number[];
	readonly occupiedCross: readonly number[];
	readonly crossSize: number;
} {
	const items = input.laneIds.map((_id, index) => orderedEndpoints(input, index));
	const lengths = items.map((lane) => {
		const contentLength = Math.max(0, ...lane.map((item) => item.longSize));
		return Math.max(MINIMUM_LANE_SIZE, contentLength + 2 * LANE_INSET);
	});
	const occupiedCross = items.map((lane) => contentCrossSize(lane, ports));
	const crossSize = Math.max(
		MINIMUM_LANE_SIZE,
		...occupiedCross.map((width) => width + 2 * LANE_INSET),
	);
	return { items, lengths, occupiedCross, crossSize };
}

function longitudinalPositions(
	lengths: readonly number[],
	relationCount: number,
): {
	readonly starts: readonly number[];
	readonly extent: number;
	readonly maximumTrack: number;
} {
	const maximumTrack = SHARED_LANE_CLEARANCE + (relationCount + 1) * RAIL_SPACING;
	const gap = 2 * maximumTrack + LANE_INSET;
	const starts: number[] = [];
	let cursor = OUTER_MARGIN + maximumTrack;
	for (const length of lengths) {
		starts.push(cursor);
		cursor += length + gap;
	}
	const extent = cursor - gap + maximumTrack + OUTER_MARGIN;
	return { starts, extent, maximumTrack };
}

interface TransversePositioning {
	readonly longitudinal: ReturnType<typeof longitudinalPositions>;
	readonly crossStart: number;
}

function positionEndpoints(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	metrics: ReturnType<typeof laneMetrics>,
	positioning: TransversePositioning,
): {
	readonly boxes: ReadonlyMap<string, LogicalBox>;
	readonly elements: readonly LayoutElement[];
} {
	const boxes = new Map<string, LogicalBox>();
	const elements: LayoutElement[] = [];
	for (const [laneIndex, laneItems] of metrics.items.entries()) {
		const freeCross = metrics.crossSize - defined(metrics.occupiedCross[laneIndex]);
		let cursor = positioning.crossStart + freeCross / 2;
		for (const item of laneItems) {
			const crossSize = endpointCrossSize(item, ports);
			const laneStart = defined(positioning.longitudinal.starts[laneIndex]);
			const laneLength = defined(metrics.lengths[laneIndex]);
			const longitudinal = laneStart + (laneLength - item.longSize) / 2;
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
	metrics: ReturnType<typeof laneMetrics>,
	positions: ReturnType<typeof longitudinalPositions>,
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

export function makeTransverseLaneFrame(
	input: SharedLaneInput,
	ports: SharedLanePorts,
): TransverseLaneFrame {
	const metrics = laneMetrics(input, ports);
	const positions = longitudinalPositions(metrics.lengths, input.plans.length);
	const crossStart = OUTER_MARGIN + positions.maximumTrack;
	const placed = positionEndpoints(input, ports, metrics, { longitudinal: positions, crossStart });
	return {
		boxes: placed.boxes,
		elements: placed.elements,
		lanes: positionedLanes(input, metrics, positions, crossStart),
		crossStart,
		crossSize: metrics.crossSize,
		crossExtent: crossStart + metrics.crossSize + positions.maximumTrack + OUTER_MARGIN,
		longExtent: positions.extent,
		laneLongStarts: positions.starts,
		laneLongSizes: metrics.lengths,
	};
}
