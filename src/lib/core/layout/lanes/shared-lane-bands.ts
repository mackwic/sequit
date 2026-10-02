import { defined } from '../../document/logic-document';
import { RAIL_SPACING } from '../layout-settings';
import type { Point } from '../layout-types';
import {
	boundaryKey,
	boundaryTrack,
	type BoundaryUse,
	corridorTrack,
	type PlacedBoundaries,
} from './shared-lane-boundaries';
import {
	compareLayoutOrder,
	type LaneSide,
	type SharedLaneEndpoint,
	type SharedLaneInput,
} from './shared-lane-model';
import { incidenceKey, PortRole } from './shared-lane-ports';
import type { LogicalBox } from './shared-lane-types';

/** Free cross space between two neighbours of a band when no detour runs between them. */
const SLOT_GAP = 48;

/** The row boundary a detour leaves by: before its row (-1) or after it (1). */
type BoundarySide = -1 | 1;

interface DetourCorridors {
	/** The slot gap the detour runs along, keyed by `[lane, row, slot before it]`. */
	readonly gap: string;
	/** The row boundary the detour crosses its lane in, keyed by `[lane, boundary]`. */
	readonly boundary: string;
	readonly boundaryIndex: number;
}

/** One lateral port whose face looks at a neighbour of its band: it leaves between two rows. */
interface BandDetour {
	readonly key: string;
	readonly endpoint: SharedLaneEndpoint;
	readonly side: LaneSide;
	readonly slot: number;
	/** Before its row for a port blocked on its +1 face, after it for one blocked on its -1 face. */
	readonly direction: BoundarySide;
	readonly corridors: DetourCorridors;
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
	readonly rowCount: number;
}

/** The way a port reaches its lane gutter: the points from its face, then the long it arrives at. */
export interface PortAccess {
	readonly points: readonly Point[];
	readonly reach: number;
}

function slotGapKey(laneIndex: number, row: number, slot: number): string {
	return JSON.stringify([laneIndex, row, slot]);
}

function detourCorridors(
	endpoint: SharedLaneEndpoint,
	side: LaneSide,
	slot: number,
	direction: BoundarySide,
): DetourCorridors {
	let gapSlot = slot - 1;
	if (side === 1) gapSlot = slot;
	let boundaryIndex = endpoint.row;
	if (direction === 1) boundaryIndex = endpoint.row + 1;
	return {
		gap: slotGapKey(endpoint.laneIndex, endpoint.row, gapSlot),
		boundary: boundaryKey(endpoint.laneIndex, boundaryIndex),
		boundaryIndex,
	};
}

/** The slot of an endpoint in its band and the last slot of that band. */
interface BandSlot {
	readonly slot: number;
	readonly last: number;
}

function groupBands(input: SharedLaneInput): {
	readonly bands: ReadonlyMap<string, readonly SharedLaneEndpoint[]>;
	readonly slots: ReadonlyMap<string, BandSlot>;
	readonly rowCount: number;
} {
	const bands = new Map<string, SharedLaneEndpoint[]>();
	let rowCount = 0;
	for (const endpoint of input.endpoints.values()) {
		const key = JSON.stringify([endpoint.laneIndex, endpoint.row]);
		const band = bands.get(key) ?? [];
		band.push(endpoint);
		bands.set(key, band);
		rowCount = Math.max(rowCount, endpoint.row + 1);
	}
	const slots = new Map<string, BandSlot>();
	for (const band of bands.values()) {
		band.sort(compareLayoutOrder);
		const last = band.length - 1;
		for (const [slot, endpoint] of band.entries()) slots.set(endpoint.id, { slot, last });
	}
	return { bands, slots, rowCount };
}

/** Both lateral ports of every plan that leaves its lane: incidence key, endpoint and face. */
function portIncidences(
	input: SharedLaneInput,
): readonly { readonly key: string; readonly id: string; readonly side: LaneSide }[] {
	return input.plans.flatMap((plan) => {
		if (plan.local) return [];
		return [
			{ key: incidenceKey(plan.id, PortRole.Source), id: plan.from, side: plan.sourceSide },
			{ key: incidenceKey(plan.id, PortRole.Target), id: plan.to, side: plan.targetSide },
		];
	});
}

/**
 * A port blocked on its +1 face leaves before its row, one blocked on its -1 face after it: two
 * neighbours whose blocked ports face each other never share a row boundary, so their detours never
 * have to cross in the slot gap between them.
 */
function bandDetours(
	input: SharedLaneInput,
	slots: ReadonlyMap<string, BandSlot>,
): readonly BandDetour[] {
	const detours: BandDetour[] = [];
	for (const { key, id, side } of portIncidences(input)) {
		const { slot, last } = defined(slots.get(id));
		const blockedAfter = side > 0 && slot < last;
		const blockedBefore = side < 0 && slot > 0;
		if (!blockedAfter && !blockedBefore) continue;
		const endpoint = defined(input.endpoints.get(id));
		let direction: BoundarySide = 1;
		if (blockedAfter) direction = -1;
		const corridors = detourCorridors(endpoint, side, slot, direction);
		detours.push({ key, endpoint, side, slot, direction, corridors });
	}
	return detours;
}

function countBy(keys: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
	return counts;
}

/** What every lane boundary holds: its detours by the row they leave, and its local rails. */
export function boundaryUses(
	lanes: LaneBands,
	rails: ReadonlyMap<string, number>,
): ReadonlyMap<string, BoundaryUse> {
	const uses = new Map<string, { earlier: number; rails: number; later: number }>();
	for (const [key, count] of rails) uses.set(key, { earlier: 0, rails: count, later: 0 });
	for (const { corridors, direction } of lanes.detours) {
		const use = uses.get(corridors.boundary) ?? { earlier: 0, rails: 0, later: 0 };
		if (direction === 1) use.earlier += 1;
		else use.later += 1;
		uses.set(corridors.boundary, use);
	}
	return uses;
}

export function planLaneBands(input: SharedLaneInput): LaneBands {
	const { bands, slots, rowCount } = groupBands(input);
	const detours = bandDetours(input, slots);
	const slotGaps = new Map<string, number>();
	const gapTracks = countBy(detours.map(({ corridors }) => corridors.gap));
	for (const band of bands.values())
		for (let slot = 0; slot < band.length - 1; slot += 1) {
			const endpoint = defined(band[slot]);
			const key = slotGapKey(endpoint.laneIndex, endpoint.row, slot);
			slotGaps.set(key, Math.max(SLOT_GAP, (gapTracks.get(key) ?? 0) * RAIL_SPACING));
		}
	return { bands, detours, slotGaps, rowCount };
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
	readonly boundaries: PlacedBoundaries;
	readonly portOffsetByIncidence: ReadonlyMap<string, number>;
}

interface PlacedDetour {
	readonly detour: BandDetour;
	readonly box: LogicalBox;
	readonly long: number;
	/** The port's long coordinate read along its detour direction: larger runs farther out. */
	readonly outward: number;
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

interface CorridorKind {
	readonly keyOf: (corridors: DetourCorridors) => string;
	readonly compare: (a: PlacedDetour, b: PlacedDetour) => number;
	/** The coordinate of the track at `index` among the `count` detours of one corridor. */
	readonly track: (item: PlacedDetour, count: number, index: number) => number;
}

/** The track of every detour along one kind of corridor, keyed by incidence. */
function corridorTracks(
	placed: readonly PlacedDetour[],
	kind: CorridorKind,
): ReadonlyMap<string, number> {
	const groups = new Map<string, PlacedDetour[]>();
	for (const item of placed) {
		const key = kind.keyOf(item.detour.corridors);
		const group = groups.get(key) ?? [];
		group.push(item);
		groups.set(key, group);
	}
	const tracks = new Map<string, number>();
	for (const group of groups.values()) {
		group.sort(kind.compare);
		for (const [index, item] of group.entries())
			tracks.set(item.detour.key, kind.track(item, group.length, index));
	}
	return tracks;
}

/**
 * The access of every port of a parallel frame. A port whose face is free reaches its gutter
 * straight across its lane; a port facing a band neighbour enters the slot gap, runs to the row
 * boundary its face selects and crosses the lane between the rows.
 */
export function bandPortAccess(
	input: SharedLaneInput,
	lanes: LaneBands,
	placement: BandPlacement,
): ReadonlyMap<string, PortAccess> {
	const access = new Map<string, PortAccess>();
	for (const { key, id, side } of portIncidences(input)) {
		const box = defined(placement.boxes.get(id));
		const center = box.longitudinal + box.longSize / 2;
		const long = center + defined(placement.portOffsetByIncidence.get(key));
		let face = box.cross;
		if (side === 1) face += box.crossSize;
		access.set(key, { points: [{ x: face, y: long }], reach: long });
	}
	const placed = lanes.detours.map((detour) => {
		const box = defined(placement.boxes.get(detour.endpoint.id));
		const long = defined(access.get(detour.key)).reach;
		return { detour, box, long, outward: long * detour.direction };
	});
	const xs = corridorTracks(placed, {
		keyOf: ({ gap }) => gap,
		compare: compareGapDetours,
		track: ({ detour, box }, count, index) => {
			const width = defined(lanes.slotGaps.get(detour.corridors.gap));
			let start = box.cross - width;
			if (detour.side === 1) start = box.cross + box.crossSize;
			return corridorTrack(start, width, count, index);
		},
	});
	const ys = corridorTracks(placed, {
		keyOf: ({ boundary }) => boundary,
		compare: compareBoundaryDetours,
		track: ({ detour }, _count, index) => {
			const { boundary, boundaryIndex } = detour.corridors;
			const use = defined(placement.boundaries.uses.get(boundary));
			let slot = index;
			if (index >= use.earlier) slot += use.rails;
			return boundaryTrack(placement.boundaries, detour.endpoint.laneIndex, boundaryIndex, slot);
		},
	});
	for (const { detour, long } of placed) {
		const [port] = defined(access.get(detour.key)).points;
		const x = defined(xs.get(detour.key));
		const y = defined(ys.get(detour.key));
		access.set(detour.key, { points: [defined(port), { x, y: long }, { x, y }], reach: y });
	}
	return access;
}
