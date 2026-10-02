import { defined } from '../../document/logic-document';
import type { Bounds } from '../layout-types';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import {
	CROSSING_SPACING,
	crossingFaceEdge,
	crossingPortPositions,
	crossingPortY,
} from './grid-cell-crossing';
import { equal } from './grid-cell-geometry-primitives';
import type { GridCellPlacement } from './grid-cell-types';

/** Least distance between a shifted crossing port and a corner of its face. */
const PORT_CORNER_CLEARANCE = CROSSING_SPACING / 2;
function stackInsideFace(ys: readonly number[], face: Bounds): boolean {
	const top = defined(ys[0]) - face.y;
	const bottom = face.y + face.height - defined(ys.at(-1));
	return top >= PORT_CORNER_CLEARANCE && bottom >= PORT_CORNER_CLEARANCE;
}

/**
 * The whole-track shift of an endpoint's crossing port stack. The centred stack stays unless a
 * local relation attaches on one of its points of the portal-side face with a role some crossing
 * of this endpoint does not share: that local family and the crossing would then run together off
 * the face. The nearest free shift inside the face is taken, upwards first; without one the centred
 * stack stays and the validator names the contact.
 */
export function crossingPortShift(
	cell: GridCellPlacement,
	endpointId: string,
	side: RegionPortalSide.Left | RegionPortalSide.Right,
	crossingSources: readonly boolean[],
): number {
	const face = defined(cell.localLayout.elements.find(({ id }) => id === endpointId)).bounds;
	let faceX = face.x;
	if (side === RegionPortalSide.Right) faceX += face.width;
	const foreignRole = (source: boolean) =>
		crossingSources.some((crossingSource) => crossingSource !== source);
	const attached = cell.localLayout.relations
		.flatMap(({ from, to, points }) => [
			{ source: true, own: from === endpointId, end: points[0] },
			{ source: false, own: to === endpointId, end: points.at(-1) },
		])
		.filter(({ own, end }) => own && end !== undefined)
		.filter(({ source, end }) => equal(defined(end).x, faceX) && foreignRole(source))
		.map(({ end }) => defined(end).y);
	const positions = crossingPortPositions(endpointId, face, crossingSources.length);
	const free = (shift: number) =>
		positions.every((y) => !attached.some((attachment) => equal(attachment, y + shift)));
	if (free(0)) return 0;
	const reach = Math.ceil(face.height / CROSSING_SPACING);
	const shifts = Array.from({ length: 2 * reach }, (_, index) => {
		const tracks = Math.floor(index / 2) + 1;
		const upwards = defined([-1, 1][index % 2]);
		return tracks * CROSSING_SPACING * upwards;
	});
	const fits = (shift: number) =>
		stackInsideFace(
			positions.map((y) => y + shift),
			face,
		);
	return shifts.find((shift) => fits(shift) && free(shift)) ?? 0;
}

/** One crossing port: a declared face position, or one moved by whole tracks inside the face. */
export function crossingPortOnFace(face: Bounds, incidenceCount: number, y: number): boolean {
	const edge = crossingFaceEdge('', incidenceCount);
	const tracks = (y - crossingPortY(face, edge, 0)) / CROSSING_SPACING;
	if (!equal(tracks, Math.round(tracks))) return false;
	for (let track = 0; track < incidenceCount; track += 1)
		if (equal(y, crossingPortY(face, edge, track))) return true;
	return stackInsideFace([y], face);
}

/**
 * The crossing ports of one face, sorted: the centred stack, or that stack moved by whole tracks
 * while every port keeps its clearance from the face corners. The validator is looser than
 * `crossingPortShift` on purpose: it does not ask which local attachment justifies a shift, only
 * that the shifted stack stays a stack of declared tracks inside the face.
 */
export function validCrossingPortStack(face: Bounds, ys: readonly number[]): boolean {
	const positions = crossingPortPositions('', face, ys.length);
	const shift = defined(ys[0]) - defined(positions[0]);
	const tracks = shift / CROSSING_SPACING;
	if (!equal(tracks, Math.round(tracks))) return false;
	if (!ys.every((y, track) => equal(y - defined(positions[track]), shift))) return false;
	return equal(shift, 0) || stackInsideFace(ys, face);
}
