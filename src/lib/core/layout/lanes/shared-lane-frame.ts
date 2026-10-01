import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { RoutingEdge } from '../geometry/routing-edge';
import { OUTER_MARGIN, RAIL_SPACING } from '../layout-settings';
import type { Bounds, LayoutElement, Point } from '../layout-types';
import { trackOffset } from '../resources/routing-resource-allocation';
import {
	bandCrossLayout,
	bandPortAccess,
	type LaneBands,
	planLaneBands,
	type PortAccess,
} from './shared-lane-bands';
import type { SharedLaneInput, SharedLanePlan } from './shared-lane-model';
import type { SharedLanePorts } from './shared-lane-ports';
import type { LogicalBox, SharedLaneBounds } from './shared-lane-types';

export const SHARED_LANE_CLEARANCE = 12;
const LANE_INSET = 24;
const MINIMUM_LANE_WIDTH = 144;

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
	/** How each port, keyed by incidence, leaves its face and reaches its lane gutter. */
	readonly portAccessByIncidence: ReadonlyMap<string, PortAccess>;
	/** The owner of the routing edges this frame publishes. */
	readonly ownerId: string;
	/** The gutter band beside the lanes: one track per plan, both sides of a lane reading the ordinal. */
	readonly gutterEdge: RoutingEdge;
	/** The rail band outside the content: one track per relation that crosses a lane. */
	readonly exteriorRailEdge: RoutingEdge;
	/** The band reserved above the content: one track per plan, read by the top passage. */
	readonly topExteriorRailEdge: RoutingEdge;
}

/** The owner of the edges of one lane frame: its lanes, in the canonical presentation order. */
export function frameOwnerId(input: SharedLaneInput): string {
	return `lanes:${input.laneIds.join('+')}`;
}

/** The gutter band of a lane frame: the canonical track of every plan, on both gutter sides. */
export function frameGutterEdge(ownerId: string, planCount: number): RoutingEdge {
	return { ownerId: `${ownerId}/gutter`, capacity: planCount, spacing: RAIL_SPACING };
}

/** The rail band outside a lane frame's content: one track per relation that crosses a lane. */
export function frameExteriorRailEdge(ownerId: string, crossingCount: number): RoutingEdge {
	return { ownerId: `${ownerId}/exterior-rail`, capacity: crossingCount, spacing: RAIL_SPACING };
}

/** The band a lane frame reserves above its content: one track per plan, since any plan may detour. */
function frameTopExteriorRailEdge(ownerId: string, planCount: number): RoutingEdge {
	return { ownerId: `${ownerId}/top-exterior-rail`, capacity: planCount, spacing: RAIL_SPACING };
}

/**
 * The band an edge owns from the frame border to its far track: the clearance, then the first track
 * offset and the whole edge extent. Layout reserves its placement bands with this (`maxGutter`,
 * `topReserve`, the transverse `maximumTrack`) and routing places only tracks inside `edgeExtent`,
 * so a track always stays inside the space the placement of the same edge opened.
 */
export function frameEdgeBand(edge: RoutingEdge): number {
	return SHARED_LANE_CLEARANCE + trackOffset(edge, edge.capacity);
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

/** Where an endpoint sits in its band: the band's cross width and its own offset inside it. */
interface BandSlot {
	readonly bandWidth: number;
	readonly offset: number;
}

interface FrameSizes {
	readonly rows: number[];
	readonly widths: number[];
	readonly slots: ReadonlyMap<string, BandSlot>;
}

function rowAndLaneSizes(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	lanes: LaneBands,
): FrameSizes {
	const rows: number[] = [];
	const widths = input.laneIds.map(() => MINIMUM_LANE_WIDTH);
	const slots = new Map<string, BandSlot>();
	for (const item of input.endpoints.values()) {
		const long = Math.max(item.longSize, ports.demandByEndpoint.get(item.id) ?? 0);
		rows[item.row] = Math.max(rows[item.row] ?? 0, long);
	}
	for (const band of lanes.bands.values()) {
		const layout = bandCrossLayout(lanes, band, ({ crossSize }) => crossSize);
		const laneIndex = defined(band[0]).laneIndex;
		widths[laneIndex] = Math.max(defined(widths[laneIndex]), layout.width + 2 * LANE_INSET);
		for (const [slot, item] of band.entries())
			slots.set(item.id, { bandWidth: layout.width, offset: defined(layout.offsets[slot]) });
	}
	for (let row = 0; row < rows.length; row += 1) rows[row] ??= 1;
	return { rows, widths, slots };
}

interface RowPositions {
	readonly starts: number[];
	/** Start of each row boundary: before row 0, between two rows, after the last row. */
	readonly boundaryStarts: number[];
	readonly contentStart: number;
	readonly end: number;
}

/** Rows separated by their boundaries; the outer boundaries exist only for band detours. */
function rowStarts(
	rows: readonly number[],
	boundaries: readonly number[],
	topReserve: number,
): RowPositions {
	const contentStart = OUTER_MARGIN + topReserve;
	const starts: number[] = [];
	const boundaryStarts = [contentStart];
	let cursor = contentStart + defined(boundaries[0]);
	for (const [row, size] of rows.entries()) {
		starts.push(cursor);
		cursor += size;
		boundaryStarts.push(cursor);
		cursor += defined(boundaries[row + 1]);
	}
	return { starts, boundaryStarts, contentStart, end: cursor };
}

/** Cross-lane plans group by endpoint rows, preserving documentary order for row ties. */
function sortedCrossLanePlans(input: SharedLaneInput): readonly SharedLanePlan[] {
	const plans = input.plans.filter(({ sameLane }) => !sameLane);
	plans.sort((a, b) => {
		const aSource = defined(input.endpoints.get(a.from)).row;
		const bSource = defined(input.endpoints.get(b.from)).row;
		if (aSource !== bSource) return aSource - bSource;
		const aTarget = defined(input.endpoints.get(a.to)).row;
		const bTarget = defined(input.endpoints.get(b.to)).row;
		if (aTarget !== bTarget) return aTarget - bTarget;
		return 0;
	});
	return plans;
}

function lanePositions(
	widths: readonly number[],
	gutterEdge: RoutingEdge,
): {
	readonly starts: number[];
	readonly extent: number;
} {
	const maxGutter = frameEdgeBand(gutterEdge);
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
	readonly sizes: FrameSizes;
	readonly laneStarts: readonly number[];
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
		const rowSize = defined(placement.sizes.rows[item.row]);
		const laneWidth = defined(placement.sizes.widths[item.laneIndex]);
		const laneStart = defined(placement.laneStarts[item.laneIndex]);
		const rowStart = defined(placement.rowPositions[item.row]);
		const slot = defined(placement.sizes.slots.get(item.id));
		const bandStart = laneStart + (laneWidth - slot.bandWidth) / 2;
		const cross = bandStart + slot.offset;
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

/**
 * The parallel frame: rows across every lane, the endpoints of one lane row side by side in a band,
 * and the gutters, rails and band corridors its routes run on.
 */
export function makeSharedLaneFrame(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	reserveTopExterior = false,
): SharedLaneFrame {
	const bands = planLaneBands(input);
	const sizes = rowAndLaneSizes(input, ports, bands);
	const ownerId = frameOwnerId(input);
	const crossLanePlans = sortedCrossLanePlans(input);
	const gutterEdge = frameGutterEdge(ownerId, input.plans.length);
	const exteriorRailEdge = frameExteriorRailEdge(ownerId, crossLanePlans.length);
	const topExteriorRailEdge = frameTopExteriorRailEdge(ownerId, input.plans.length);
	let topReserve = 0;
	if (reserveTopExterior) topReserve = frameEdgeBand(topExteriorRailEdge);
	const rows = rowStarts(sizes.rows, bands.boundaries, topReserve);
	const positions = lanePositions(sizes.widths, gutterEdge);
	const exteriorRailAnchor = rows.end + SHARED_LANE_CLEARANCE;
	const exteriorBase = exteriorRailAnchor + trackOffset(exteriorRailEdge, 0);
	const lastTrack =
		exteriorRailAnchor + trackOffset(exteriorRailEdge, Math.max(0, exteriorRailEdge.capacity - 1));
	const longExtent = Math.max(rows.end + OUTER_MARGIN, lastTrack + OUTER_MARGIN);
	const placed = endpointBoxes(input, ports, {
		rowPositions: rows.starts,
		sizes,
		laneStarts: positions.starts,
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
		contentLongStart: rows.contentStart,
		contentLongEnd: rows.end,
		topExteriorBase: OUTER_MARGIN + trackOffset(topExteriorRailEdge, 0),
		exteriorBase,
		crossLanePlans,
		portAccessByIncidence: bandPortAccess(input, bands, {
			boxes: placed.boxes,
			boundaryStarts: rows.boundaryStarts,
			portOffsetByIncidence: ports.offsetByIncidence,
		}),
		ownerId,
		gutterEdge,
		exteriorRailEdge,
		topExteriorRailEdge,
	};
}
