import { defined } from '../../document/logic-document';
import type { Bounds } from '../layout-types';
import type { RegionPortalSide } from '../regions/model/region-composition-types';
import { CROSSING_SPACING, crossingFaceEdge } from './grid-cell-crossing';
import {
	acrossFace,
	alongFace,
	crossingPortCoordinate,
	crossingPortPositions,
	faceLine,
	faceSpan,
} from './grid-cell-crossing-face';
import { equal } from './grid-cell-geometry-primitives';
import type { GridCellPlacement } from './grid-cell-types';

/** Least distance between a shifted crossing port and a corner of its face. */
const PORT_CORNER_CLEARANCE = CROSSING_SPACING / 2;
function stackInsideFace(
	coordinates: readonly number[],
	face: Bounds,
	side: RegionPortalSide,
): boolean {
	const { start, length } = faceSpan(face, side);
	const before = defined(coordinates[0]) - start;
	const after = start + length - defined(coordinates.at(-1));
	return before >= PORT_CORNER_CLEARANCE && after >= PORT_CORNER_CLEARANCE;
}

/**
 * The whole-track shift of an endpoint's crossing port stack on one face. The centred stack stays
 * unless a local relation attaches on one of its points of that face with a role some crossing of
 * this face does not share: that local family and the crossing would then run together off the
 * face. The nearest free shift inside the face is taken, towards the face start first; without one
 * the centred stack stays and the validator names the contact.
 */
export function crossingPortShift(
	cell: GridCellPlacement,
	endpointId: string,
	side: RegionPortalSide,
	crossingSources: readonly boolean[],
): number {
	const face = defined(cell.localLayout.elements.find(({ id }) => id === endpointId)).bounds;
	const line = faceLine(face, side);
	const foreignRole = (source: boolean) =>
		crossingSources.some((crossingSource) => crossingSource !== source);
	const attached = cell.localLayout.relations
		.flatMap(({ from, to, points }) => [
			{ source: true, own: from === endpointId, end: points[0] },
			{ source: false, own: to === endpointId, end: points.at(-1) },
		])
		.filter(({ own, end }) => own && end !== undefined)
		.filter(({ source, end }) => equal(acrossFace(defined(end), side), line) && foreignRole(source))
		.map(({ end }) => alongFace(defined(end), side));
	const positions = crossingPortPositions(face, side, crossingSources.length);
	const free = (shift: number) =>
		positions.every(
			(position) => !attached.some((attachment) => equal(attachment, position + shift)),
		);
	if (free(0)) return 0;
	const reach = Math.ceil(faceSpan(face, side).length / CROSSING_SPACING);
	const shifts = Array.from({ length: 2 * reach }, (_, index) => {
		const tracks = Math.floor(index / 2) + 1;
		const towardsStart = defined([-1, 1][index % 2]);
		return tracks * CROSSING_SPACING * towardsStart;
	});
	const fits = (shift: number) =>
		stackInsideFace(
			positions.map((position) => position + shift),
			face,
			side,
		);
	return shifts.find((shift) => fits(shift) && free(shift)) ?? 0;
}

/** One crossing port: a declared face position, or one moved by whole tracks inside the face. */
export function crossingPortOnFace(
	face: Bounds,
	side: RegionPortalSide,
	incidenceCount: number,
	coordinate: number,
): boolean {
	const edge = crossingFaceEdge('', incidenceCount);
	const tracks = (coordinate - crossingPortCoordinate(face, side, edge, 0)) / CROSSING_SPACING;
	if (!equal(tracks, Math.round(tracks))) return false;
	for (let track = 0; track < incidenceCount; track += 1)
		if (equal(coordinate, crossingPortCoordinate(face, side, edge, track))) return true;
	return stackInsideFace([coordinate], face, side);
}

/**
 * The crossing ports of one face, sorted along it: the centred stack, or that stack moved by whole
 * tracks while every port keeps its clearance from the face corners. The validator is looser than
 * `crossingPortShift` on purpose: it does not ask which local attachment justifies a shift, only
 * that the shifted stack stays a stack of declared tracks inside the face.
 */
export function validCrossingPortStack(
	face: Bounds,
	side: RegionPortalSide,
	coordinates: readonly number[],
): boolean {
	const positions = crossingPortPositions(face, side, coordinates.length);
	const shift = defined(coordinates[0]) - defined(positions[0]);
	const tracks = shift / CROSSING_SPACING;
	if (!equal(tracks, Math.round(tracks))) return false;
	if (
		!coordinates.every((coordinate, track) => equal(coordinate - defined(positions[track]), shift))
	)
		return false;
	return equal(shift, 0) || stackInsideFace(coordinates, face, side);
}
