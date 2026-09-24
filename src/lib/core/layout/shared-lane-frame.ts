import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import { BASE_RANK_GAP, OUTER_MARGIN, RAIL_SPACING } from './layout-settings';
import type { Bounds, LayoutElement, Point } from './layout-types';
import type { SharedLaneInput, SharedLanePlan } from './shared-lane-model';
import type { SharedLanePorts } from './shared-lane-ports';
import type { SharedLaneBounds } from './shared-lane-types';

export const SHARED_LANE_CLEARANCE = 12;
const LANE_INSET = 24;
const MINIMUM_LANE_WIDTH = 144;

export interface LogicalBox {
	readonly cross: number;
	readonly longitudinal: number;
	readonly crossSize: number;
	readonly longSize: number;
}

export interface SharedLaneFrame {
	readonly laneStarts: readonly number[];
	readonly laneWidths: readonly number[];
	readonly boxes: ReadonlyMap<string, LogicalBox>;
	readonly elements: readonly LayoutElement[];
	readonly lanes: readonly SharedLaneBounds[];
	readonly crossExtent: number;
	readonly longExtent: number;
	readonly contentLongStart: number;
	readonly contentLongEnd: number;
	readonly topExteriorBase: number;
	readonly exteriorBase: number;
	readonly crossLanePlans: readonly SharedLanePlan[];
}

export function physicalPoint(point: Point, input: SharedLaneInput, extent: number): Point {
	let long = point.y;
	if (input.reverse) long = extent - long;
	if (input.vertical) return { x: point.x, y: long };
	return { x: long, y: point.x };
}

export function physicalBounds(
	logical: LogicalBox,
	input: SharedLaneInput,
	extent: number,
): Bounds {
	let long = logical.longitudinal;
	if (input.reverse) long = extent - long - logical.longSize;
	if (input.vertical)
		return {
			x: logical.cross,
			y: long,
			width: logical.crossSize,
			height: logical.longSize,
		};
	return { x: long, y: logical.cross, width: logical.longSize, height: logical.crossSize };
}

function rowAndLaneSizes(
	input: SharedLaneInput,
	ports: SharedLanePorts,
): { readonly rows: number[]; readonly widths: number[] } {
	const rows: number[] = [];
	const widths = input.laneIds.map(() => MINIMUM_LANE_WIDTH);
	for (const item of input.endpoints.values()) {
		const long = Math.max(item.longSize, ports.demandByEndpoint.get(item.id) ?? 0);
		rows[item.row] = Math.max(rows[item.row] ?? 0, long);
		const width = item.crossSize + 2 * LANE_INSET;
		widths[item.laneIndex] = Math.max(defined(widths[item.laneIndex]), width);
	}
	for (let row = 0; row < rows.length; row += 1) rows[row] ??= 1;
	return { rows, widths };
}

function rowStarts(
	rows: readonly number[],
	topReserve: number,
): { readonly starts: number[]; readonly end: number } {
	const starts: number[] = [];
	let cursor = OUTER_MARGIN + topReserve;
	for (const size of rows) {
		starts.push(cursor);
		cursor += size + BASE_RANK_GAP;
	}
	let end = cursor - BASE_RANK_GAP;
	if (rows.length === 0) end = OUTER_MARGIN + topReserve;
	return { starts, end };
}

function sortedCrossLanePlans(input: SharedLaneInput): readonly SharedLanePlan[] {
	const plans = input.plans.filter(({ sameLane }) => !sameLane);
	plans.sort((a, b) => {
		const aSource = defined(input.endpoints.get(a.from)).row;
		const bSource = defined(input.endpoints.get(b.from)).row;
		if (aSource !== bSource) return aSource - bSource;
		const aTarget = defined(input.endpoints.get(a.to)).row;
		const bTarget = defined(input.endpoints.get(b.to)).row;
		if (aTarget !== bTarget) return aTarget - bTarget;
		return compareCanonicalStrings(a.id, b.id);
	});
	return plans;
}

function lanePositions(
	widths: readonly number[],
	relationCount: number,
): {
	readonly starts: number[];
	readonly extent: number;
} {
	const maxGutter = SHARED_LANE_CLEARANCE + (relationCount + 1) * RAIL_SPACING;
	const laneGap = Math.max(72, 2 * maxGutter + LANE_INSET);
	const starts: number[] = [];
	let cursor = OUTER_MARGIN + maxGutter;
	for (const width of widths) {
		starts.push(cursor);
		cursor += width + laneGap;
	}
	const extent = cursor - laneGap + maxGutter + OUTER_MARGIN;
	return { starts, extent };
}

interface BoxPlacement {
	readonly rowPositions: readonly number[];
	readonly rowSizes: readonly number[];
	readonly laneStarts: readonly number[];
	readonly laneWidths: readonly number[];
	readonly longExtent: number;
}

function endpointBoxes(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	placement: BoxPlacement,
): {
	readonly boxes: ReadonlyMap<string, LogicalBox>;
	readonly elements: readonly LayoutElement[];
} {
	const boxes = new Map<string, LogicalBox>();
	const elements: LayoutElement[] = [];
	const ordered = [...input.endpoints.values()].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	for (const item of ordered) {
		const longSize = Math.max(item.longSize, ports.demandByEndpoint.get(item.id) ?? 0);
		const rowSize = defined(placement.rowSizes[item.row]);
		const laneWidth = defined(placement.laneWidths[item.laneIndex]);
		const laneStart = defined(placement.laneStarts[item.laneIndex]);
		const rowStart = defined(placement.rowPositions[item.row]);
		const cross = laneStart + (laneWidth - item.crossSize) / 2;
		const longitudinal = rowStart + (rowSize - longSize) / 2;
		const logical = { cross, longitudinal, crossSize: item.crossSize, longSize };
		boxes.set(item.id, logical);
		elements.push({
			id: item.id,
			kind: item.kind,
			bounds: physicalBounds(logical, input, placement.longExtent),
		});
	}
	return { boxes, elements };
}

function laneBounds(
	input: SharedLaneInput,
	starts: readonly number[],
	widths: readonly number[],
	longExtent: number,
): readonly SharedLaneBounds[] {
	return input.laneIds.map((id, index) => ({
		id,
		bounds: physicalBounds(
			{
				cross: defined(starts[index]),
				longitudinal: 0,
				crossSize: defined(widths[index]),
				longSize: longExtent,
			},
			input,
			longExtent,
		),
	}));
}

export function makeSharedLaneFrame(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	reserveTopExterior = false,
): SharedLaneFrame {
	const sizes = rowAndLaneSizes(input, ports);
	let topReserve = 0;
	if (reserveTopExterior) {
		const reserveCount = input.plans.length + 1;
		topReserve = SHARED_LANE_CLEARANCE + reserveCount * RAIL_SPACING;
	}
	const rows = rowStarts(sizes.rows, topReserve);
	const crossLanePlans = sortedCrossLanePlans(input);
	const positions = lanePositions(sizes.widths, input.plans.length);
	const exteriorBase = rows.end + SHARED_LANE_CLEARANCE + RAIL_SPACING;
	const lastTrack = exteriorBase + Math.max(0, crossLanePlans.length - 1) * RAIL_SPACING;
	const longExtent = Math.max(rows.end + OUTER_MARGIN, lastTrack + OUTER_MARGIN);
	const placed = endpointBoxes(input, ports, {
		rowPositions: rows.starts,
		rowSizes: sizes.rows,
		laneStarts: positions.starts,
		laneWidths: sizes.widths,
		longExtent,
	});
	return {
		laneStarts: positions.starts,
		laneWidths: sizes.widths,
		boxes: placed.boxes,
		elements: placed.elements,
		lanes: laneBounds(input, positions.starts, sizes.widths, longExtent),
		crossExtent: positions.extent,
		longExtent,
		contentLongStart: rows.starts[0] ?? OUTER_MARGIN + topReserve,
		contentLongEnd: rows.end,
		topExteriorBase: OUTER_MARGIN + SHARED_LANE_CLEARANCE + RAIL_SPACING,
		exteriorBase,
		crossLanePlans,
	};
}
