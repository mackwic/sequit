import { defined } from '../../document/logic-document';
import type { Point } from '../layout-types';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import type {
	RegionIncidentContract,
	RegionSolvedIncident,
} from '../regions/model/region-incident-contract';
import {
	directSharedLaneIncidentPath,
	type SharedLaneIncidentFailure,
} from './shared-lane-incident-validation';
import type { SharedLanePorts } from './shared-lane-ports';
import type { SharedLaneGeometry } from './shared-lane-types';

const CLEARANCE = 12;
const MAX_DETOUR_RAILS = 12;

export interface LaneIncidentPathCandidate {
	readonly id: string;
	readonly path: RegionSolvedIncident | SharedLaneIncidentFailure;
}

function horizontalBoundary(side: RegionPortalSide): boolean {
	return side === RegionPortalSide.Top || side === RegionPortalSide.Bottom;
}

function railCoordinates(
	geometry: SharedLaneGeometry,
	anchor: Point,
	side: RegionPortalSide,
): readonly number[] {
	const horizontal = horizontalBoundary(side);
	let extent = geometry.height;
	let anchorCoordinate = anchor.y;
	if (horizontal) {
		extent = geometry.width;
		anchorCoordinate = anchor.x;
	}
	const values = new Set([CLEARANCE, extent - CLEARANCE]);
	for (const element of geometry.elements) {
		const bounds = element.bounds;
		if (horizontal) {
			values.add(bounds.x - CLEARANCE);
			values.add(bounds.x + bounds.width + CLEARANCE);
		} else {
			values.add(bounds.y - CLEARANCE);
			values.add(bounds.y + bounds.height + CLEARANCE);
		}
	}
	return [...values]
		.filter((value) => {
			const inside = value > 0 && value < extent;
			return inside && value !== anchorCoordinate;
		})
		.sort((left, right) => {
			const leftDistance = Math.abs(left - anchorCoordinate);
			const rightDistance = Math.abs(right - anchorCoordinate);
			if (leftDistance !== rightDistance) return leftDistance - rightDistance;
			return left - right;
		})
		.slice(0, MAX_DETOUR_RAILS);
}

function launchCoordinate(anchor: Point, side: RegionPortalSide): number {
	switch (side) {
		case RegionPortalSide.Left:
			return anchor.x - CLEARANCE;
		case RegionPortalSide.Right:
			return anchor.x + CLEARANCE;
		case RegionPortalSide.Top:
			return anchor.y - CLEARANCE;
		case RegionPortalSide.Bottom:
			return anchor.y + CLEARANCE;
		default:
			throw new Error(`Unknown incident side ${String(side)}.`);
	}
}

function detourPoints(path: RegionSolvedIncident, rail: number): readonly Point[] {
	const { anchor, side } = path;
	const launch = launchCoordinate(anchor, side);
	if (horizontalBoundary(side)) {
		const start = { x: anchor.x, y: launch };
		const turn = { x: rail, y: launch };
		return [anchor, start, turn, { x: rail, y: path.portal.y }];
	}
	const start = { x: launch, y: anchor.y };
	const turn = { x: launch, y: rail };
	return [anchor, start, turn, { x: path.portal.x, y: rail }];
}

function withinLaunch(geometry: SharedLaneGeometry, path: RegionSolvedIncident): boolean {
	const launch = launchCoordinate(path.anchor, path.side);
	if (horizontalBoundary(path.side)) return launch > 0 && launch < geometry.height;
	return launch > 0 && launch < geometry.width;
}

/** Direct first, then short orthogonal detours around measured element bounds. */
export function laneIncidentPathCandidates(
	geometry: SharedLaneGeometry,
	ports: SharedLanePorts,
	contract: RegionIncidentContract,
	side: RegionPortalSide,
): readonly LaneIncidentPathCandidate[] {
	const direct = directSharedLaneIncidentPath(geometry, ports, contract, side);
	if ('code' in direct) return [{ id: 'direct', path: direct }];
	const candidates: LaneIncidentPathCandidate[] = [{ id: 'direct', path: direct }];
	if (!withinLaunch(geometry, direct)) return candidates;
	for (const rail of railCoordinates(geometry, direct.anchor, side)) {
		const points = detourPoints(direct, rail);
		candidates.push({
			id: `rail/${rail}`,
			path: { ...direct, portal: defined(points.at(-1)), points },
		});
	}
	return candidates;
}
