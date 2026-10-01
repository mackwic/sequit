import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import { BASE_RANK_GAP, RAIL_SPACING } from '../layout-settings';
import type { Point } from '../layout-types';
import type { LaneSide, SharedLaneEndpoint, SharedLaneInput } from './shared-lane-model';
import { incidenceKey, PortRole } from './shared-lane-ports';
import type { LogicalBox } from './shared-lane-types';

/** Free cross space between two neighbours of a band when no detour runs between them. */
const SLOT_GAP = 48;

/** Documentary order of the endpoints of one band: `layoutOrder`, then the identifier. */
export function compareBandOrder(a: SharedLaneEndpoint, b: SharedLaneEndpoint): number {
	const order = compareCanonicalStrings(a.layoutOrder, b.layoutOrder);
	if (order !== 0) return order;
	return compareCanonicalStrings(a.id, b.id);
}

/** One lateral port whose face looks at a neighbour of its band: it leaves between two rows. */
interface BandDetour {
	readonly key: string;
	readonly endpoint: SharedLaneEndpoint;
	readonly side: LaneSide;
	readonly slot: number;
	/** The row boundary it leaves by: after its row (1) or before it (-1), toward the other end. */
	readonly direction: LaneSide;
}

/**
 * The parallel bands of a lane frame: the endpoints of one lane on one row, side by side on the
 * cross axis in documentary order, and the corridors their blocked lateral ports run through.
 */
export interface LaneBands {
	/** The endpoints of each lane row, keyed by `[lane, row]`. */
	readonly bands: ReadonlyMap<string, readonly SharedLaneEndpoint[]>;
	readonly detours: readonly BandDetour[];
	/** Cross width of the corridor after each slot of a band, keyed by `[lane, row, slot]`. */
	readonly slotGaps: ReadonlyMap<string, number>;
	/** Long size of each row boundary: before row 0, between two rows, after the last row. */
	readonly boundaries: readonly number[];
}

/** The way a port reaches its lane gutter: the points from its face, then the long it arrives at. */
export interface PortAccess {
	readonly points: readonly Point[];
	readonly reach: number;
}

function slotGapKey(laneIndex: number, row: number, slot: number): string {
	return JSON.stringify([laneIndex, row, slot]);
}

interface DetourCorridors {
	/** The slot gap the detour descends, keyed by `[lane, row, slot before it]`. */
	readonly gap: string;
	/** The row boundary the detour crosses its lane in, keyed by `[lane, boundary]`. */
	readonly boundary: string;
	readonly boundaryIndex: number;
}

function detourCorridors(detour: BandDetour): DetourCorridors {
	const { endpoint, side, slot, direction } = detour;
	let gapSlot = slot - 1;
	if (side === 1) gapSlot = slot;
	let boundaryIndex = endpoint.row;
	if (direction === 1) boundaryIndex = endpoint.row + 1;
	return {
		gap: slotGapKey(endpoint.laneIndex, endpoint.row, gapSlot),
		boundary: JSON.stringify([endpoint.laneIndex, boundaryIndex]),
		boundaryIndex,
	};
}

function groupBands(input: SharedLaneInput): Map<string, SharedLaneEndpoint[]> {
	const bands = new Map<string, SharedLaneEndpoint[]>();
	for (const endpoint of input.endpoints.values()) {
		const key = JSON.stringify([endpoint.laneIndex, endpoint.row]);
		const band = bands.get(key) ?? [];
		band.push(endpoint);
		bands.set(key, band);
	}
	for (const band of bands.values()) band.sort(compareBandOrder);
	return bands;
}

function bandDetours(
	input: SharedLaneInput,
	bands: ReadonlyMap<string, readonly SharedLaneEndpoint[]>,
	slotById: ReadonlyMap<string, number>,
): readonly BandDetour[] {
	const detours: BandDetour[] = [];
	for (const plan of input.plans) {
		const source = defined(input.endpoints.get(plan.from));
		const target = defined(input.endpoints.get(plan.to));
		const incidences = [
			{ endpoint: source, other: target, side: plan.sourceSide, role: PortRole.Source },
			{ endpoint: target, other: source, side: plan.targetSide, role: PortRole.Target },
		];
		for (const { endpoint, other, side, role } of incidences) {
			const slot = defined(slotById.get(endpoint.id));
			const last =
				defined(bands.get(JSON.stringify([endpoint.laneIndex, endpoint.row]))).length - 1;
			const blockedAfter = side > 0 && slot < last;
			const blockedBefore = side < 0 && slot > 0;
			let direction: LaneSide = -1;
			if (other.row > endpoint.row) direction = 1;
			if (blockedAfter || blockedBefore)
				detours.push({ key: incidenceKey(plan.id, role), endpoint, side, slot, direction });
		}
	}
	return detours;
}

function countBy(keys: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
	return counts;
}

/** n tracks at rail spacing, centred: the outer ones keep half a spacing from each side. */
function boundarySizes(input: SharedLaneInput, detours: readonly BandDetour[]): number[] {
	const rowCount = Math.max(0, ...[...input.endpoints.values()].map(({ row }) => row + 1));
	const tracks = Array.from({ length: rowCount + 1 }, () => 0);
	const corridors = detours.map(detourCorridors);
	const counts = countBy(corridors.map(({ boundary }) => boundary));
	for (const { boundary, boundaryIndex } of corridors)
		tracks[boundaryIndex] = Math.max(defined(tracks[boundaryIndex]), defined(counts.get(boundary)));
	return tracks.map((count, boundary) => {
		const size = count * RAIL_SPACING;
		if (boundary === 0 || boundary === rowCount) return size;
		return Math.max(BASE_RANK_GAP, size);
	});
}

export function planLaneBands(input: SharedLaneInput): LaneBands {
	const bands = groupBands(input);
	const slotById = new Map<string, number>();
	for (const band of bands.values())
		for (const [slot, endpoint] of band.entries()) slotById.set(endpoint.id, slot);
	const detours = bandDetours(input, bands, slotById);
	const slotGaps = new Map<string, number>();
	const gapTracks = countBy(detours.map((detour) => detourCorridors(detour).gap));
	for (const band of bands.values())
		for (const [slot, endpoint] of band.slice(0, -1).entries()) {
			const key = slotGapKey(endpoint.laneIndex, endpoint.row, slot);
			slotGaps.set(key, Math.max(SLOT_GAP, (gapTracks.get(key) ?? 0) * RAIL_SPACING));
		}
	return { bands, detours, slotGaps, boundaries: boundarySizes(input, detours) };
}

/** The cross width a band occupies, and the offset of each of its endpoints inside it. */
export function bandCrossLayout(
	lanes: LaneBands,
	band: readonly SharedLaneEndpoint[],
	crossSizeOf: (endpoint: SharedLaneEndpoint) => number,
): { readonly width: number; readonly offsets: readonly number[] } {
	const offsets: number[] = [];
	let cursor = 0;
	for (const [slot, endpoint] of band.entries()) {
		if (slot > 0) {
			const previous = defined(band[slot - 1]);
			cursor += defined(lanes.slotGaps.get(slotGapKey(previous.laneIndex, previous.row, slot - 1)));
		}
		offsets.push(cursor);
		cursor += crossSizeOf(endpoint);
	}
	return { width: cursor, offsets };
}

export interface BandPlacement {
	readonly boxes: ReadonlyMap<string, LogicalBox>;
	readonly boundaryStarts: readonly number[];
	readonly portOffsetByIncidence: ReadonlyMap<string, number>;
}

interface PlacedDetour {
	readonly detour: BandDetour;
	readonly box: LogicalBox;
	readonly long: number;
	/** The port's long coordinate read along its detour direction: larger runs farther out. */
	readonly outward: number;
}

/** Centred tracks of one corridor, in the order the sorted detours read them. */
function corridorTrack(start: number, size: number, count: number, index: number): number {
	const spread = (count - 1) * RAIL_SPACING;
	const first = start + (size - spread) / 2;
	return first + index * RAIL_SPACING;
}

/**
 * Inside a slot gap, the detours of the left slot come first, then those of the right slot. Each
 * group keeps nearest its own face the port whose detour runs the shortest way along the face (the
 * lowest of those leaving after the row, the highest of those leaving before it), so a detour never
 * crosses the stub of a neighbour leaving the same face.
 */
function compareGapDetours(a: PlacedDetour, b: PlacedDetour): number {
	const side = b.detour.side - a.detour.side;
	if (side !== 0) return side;
	const outward = a.outward - b.outward;
	if (a.detour.side === 1) return -outward;
	return outward;
}

/**
 * Across a row boundary, the detours leaving the row before come first, then those leaving the row
 * after. Nearest its own row runs the detour whose slot is nearest its gutter, then, in one slot,
 * the port farthest from the boundary; so no boundary segment crosses the descent of another
 * detour leaving the same row.
 */
function compareBoundaryDetours(a: PlacedDetour, b: PlacedDetour): number {
	const direction = b.detour.direction - a.detour.direction;
	if (direction !== 0) return direction;
	let depth = b.detour.side * b.detour.slot - a.detour.side * a.detour.slot;
	if (depth === 0) depth = a.outward - b.outward;
	return depth * a.detour.direction;
}

function groupedDetours(
	placed: readonly PlacedDetour[],
	keyOf: (detour: BandDetour) => string,
	compare: (a: PlacedDetour, b: PlacedDetour) => number,
): ReadonlyMap<string, readonly PlacedDetour[]> {
	const groups = new Map<string, PlacedDetour[]>();
	for (const item of placed) {
		const key = keyOf(item.detour);
		const group = groups.get(key) ?? [];
		group.push(item);
		groups.set(key, group);
	}
	for (const group of groups.values()) group.sort(compare);
	return groups;
}

interface DetourCorridorGroups {
	readonly gaps: ReadonlyMap<string, readonly PlacedDetour[]>;
	readonly boundaries: ReadonlyMap<string, readonly PlacedDetour[]>;
}

function detourAccess(
	item: PlacedDetour,
	lanes: LaneBands,
	placement: BandPlacement,
	groups: DetourCorridorGroups,
): PortAccess {
	const { detour, box, long } = item;
	const corridors = detourCorridors(detour);
	const gap = defined(groups.gaps.get(corridors.gap));
	const boundary = defined(groups.boundaries.get(corridors.boundary));
	const width = defined(lanes.slotGaps.get(corridors.gap));
	let face = box.cross;
	let gapStart = box.cross - width;
	if (detour.side === 1) {
		face = box.cross + box.crossSize;
		gapStart = face;
	}
	const x = corridorTrack(gapStart, width, gap.length, gap.indexOf(item));
	const y = corridorTrack(
		defined(placement.boundaryStarts[corridors.boundaryIndex]),
		defined(lanes.boundaries[corridors.boundaryIndex]),
		boundary.length,
		boundary.indexOf(item),
	);
	return {
		points: [
			{ x: face, y: long },
			{ x, y: long },
			{ x, y },
		],
		reach: y,
	};
}

/**
 * The access of every port of a parallel frame. A port whose face is free reaches its gutter
 * straight across its lane; a port facing a band neighbour enters the slot gap, runs to the row
 * boundary on its side and crosses the lane between the rows.
 */
export function bandPortAccess(
	input: SharedLaneInput,
	lanes: LaneBands,
	placement: BandPlacement,
): ReadonlyMap<string, PortAccess> {
	const access = new Map<string, PortAccess>();
	for (const plan of input.plans) {
		const incidences = [
			{ id: plan.from, side: plan.sourceSide, role: PortRole.Source },
			{ id: plan.to, side: plan.targetSide, role: PortRole.Target },
		];
		for (const { id, side, role } of incidences) {
			const key = incidenceKey(plan.id, role);
			const box = defined(placement.boxes.get(id));
			const center = box.longitudinal + box.longSize / 2;
			const long = center + defined(placement.portOffsetByIncidence.get(key));
			let face = box.cross;
			if (side === 1) face += box.crossSize;
			access.set(key, { points: [{ x: face, y: long }], reach: long });
		}
	}
	const placed = lanes.detours.map((detour) => {
		const box = defined(placement.boxes.get(detour.endpoint.id));
		const long = defined(access.get(detour.key)).reach;
		return { detour, box, long, outward: long * detour.direction };
	});
	const gaps = groupedDetours(placed, (detour) => detourCorridors(detour).gap, compareGapDetours);
	const boundaries = groupedDetours(
		placed,
		(detour) => detourCorridors(detour).boundary,
		compareBoundaryDetours,
	);
	for (const item of placed)
		access.set(item.detour.key, detourAccess(item, lanes, placement, { gaps, boundaries }));
	return access;
}
