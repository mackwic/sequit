import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import { routeRuns, type RouteWorkCharge, validatedBridges } from '../bridges/bridge-oracle';
import type { RegionSolvedIncident } from '../regions/model/region-incident-contract';
import type { SharedLaneGeometry } from './shared-lane-geometry';

export interface LaneRouteCandidateIdentity {
	readonly historicalRank: number | undefined;
	readonly allocationKey: string;
	readonly strategyId: string;
	readonly candidateId: string;
}

export interface RankedLaneRouteSelection<Selection> {
	readonly selected: Selection;
	readonly candidate: LaneRouteCandidateIdentity;
	readonly bridges: number;
	readonly length: number;
	readonly bends: number;
}

function pathLength(points: readonly { readonly x: number; readonly y: number }[]): number {
	let length = 0;
	for (let index = 1; index < points.length; index += 1) {
		const previous = defined(points[index - 1]);
		const current = defined(points[index]);
		const horizontalLength = Math.abs(current.x - previous.x);
		const verticalLength = Math.abs(current.y - previous.y);
		length += horizontalLength + verticalLength;
	}
	return length;
}

export function rankLaneRouteSelection<
	Selection extends {
		readonly geometry: SharedLaneGeometry;
		readonly incidents: readonly RegionSolvedIncident[];
	},
>(
	selected: Selection,
	candidate: LaneRouteCandidateIdentity,
	bridgesValidated?: number,
	charge?: RouteWorkCharge,
): RankedLaneRouteSelection<Selection> {
	let length = 0;
	let bends = 0;
	for (const route of selected.geometry.relations) {
		charge?.(route.points.length);
		length += pathLength(route.points);
		bends += Math.max(0, routeRuns(route, charge).length - 1);
	}
	for (const incident of selected.incidents) {
		charge?.(incident.points.length);
		length += pathLength(incident.points);
		const route = {
			id: `${incident.relationId}/${incident.endpointId}`,
			points: incident.points,
		};
		bends += Math.max(0, routeRuns(route, charge).length - 1);
	}
	const bridges = bridgesValidated ?? validatedBridges(selected.geometry.relations, charge).length;
	return {
		selected,
		candidate,
		bridges,
		length,
		bends,
	};
}

function historicalRankOrder(left: number | undefined, right: number | undefined): number {
	if (left === right) return 0;
	if (left === undefined) return 1;
	if (right === undefined) return -1;
	return left - right;
}

export function laneRouteSelectionIsBetter<Selection>(
	candidate: RankedLaneRouteSelection<Selection>,
	incumbent: RankedLaneRouteSelection<Selection>,
): boolean {
	if (candidate.bridges !== incumbent.bridges) return candidate.bridges < incumbent.bridges;
	if (candidate.length !== incumbent.length) return candidate.length < incumbent.length;
	if (candidate.bends !== incumbent.bends) return candidate.bends < incumbent.bends;
	const historyOrder = historicalRankOrder(
		candidate.candidate.historicalRank,
		incumbent.candidate.historicalRank,
	);
	if (historyOrder !== 0) return historyOrder < 0;
	const allocationOrder = compareCanonicalStrings(
		candidate.candidate.allocationKey,
		incumbent.candidate.allocationKey,
	);
	if (allocationOrder !== 0) return allocationOrder < 0;
	const strategyOrder = compareCanonicalStrings(
		candidate.candidate.strategyId,
		incumbent.candidate.strategyId,
	);
	return strategyOrder < 0;
}
