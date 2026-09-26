import { defined } from '../../document/logic-document';
import { disallowedRouteContacts } from '../bridges/bridge-contact';
import type { RouteBridgeAnalysis } from '../bridges/bridge-oracle';
import type { RouteRun } from '../bridges/route-runs';
import { routeRuns } from '../bridges/route-runs';
import type { LayoutRelation } from '../layout-types';
import { routeBoundsOverlap, routePathBounds } from './route-geometry';
import type { RejectedDedicatedCandidate } from './types';
import { DedicatedCandidateRejectionCode, rejected } from './types';

function intervalsOverlap(
	firstStart: number,
	firstEnd: number,
	secondStart: number,
	secondEnd: number,
): boolean {
	const firstLow = Math.min(firstStart, firstEnd);
	const secondLow = Math.min(secondStart, secondEnd);
	const firstHigh = Math.max(firstStart, firstEnd);
	const secondHigh = Math.max(secondStart, secondEnd);
	return firstLow <= secondHigh && firstHigh >= secondLow;
}

function vertical(run: RouteRun): boolean {
	return run.start.x === run.end.x;
}

function sameOrientationContact(first: RouteRun, second: RouteRun, isVertical: boolean): boolean {
	if (isVertical) {
		if (first.start.x !== second.start.x) return false;
		return intervalsOverlap(first.start.y, first.end.y, second.start.y, second.end.y);
	}
	if (first.start.y !== second.start.y) return false;
	return intervalsOverlap(first.start.x, first.end.x, second.start.x, second.end.x);
}

function perpendicularContact(horizontal: RouteRun, verticalRun: RouteRun): boolean {
	const x = verticalRun.start.x;
	const y = horizontal.start.y;
	const horizontalContains =
		x >= Math.min(horizontal.start.x, horizontal.end.x) &&
		x <= Math.max(horizontal.start.x, horizontal.end.x);
	const verticalContains =
		y >= Math.min(verticalRun.start.y, verticalRun.end.y) &&
		y <= Math.max(verticalRun.start.y, verticalRun.end.y);
	return horizontalContains && verticalContains;
}

function runContact(first: RouteRun, second: RouteRun): boolean {
	const firstVertical = vertical(first);
	const secondVertical = vertical(second);
	if (firstVertical === secondVertical) return sameOrientationContact(first, second, firstVertical);
	if (firstVertical) return perpendicularContact(second, first);
	return perpendicularContact(first, second);
}

export function validateSelfContacts(route: LayoutRelation): boolean {
	const runs = routeRuns(route);
	for (let first = 0; first < runs.length; first += 1) {
		for (let second = first + 2; second < runs.length; second += 1) {
			if (runContact(defined(runs[first]), defined(runs[second]))) return false;
		}
	}
	return true;
}

export function contactFailure(
	routes: readonly LayoutRelation[],
	analysis: RouteBridgeAnalysis,
): RejectedDedicatedCandidate | undefined {
	const envelopes = routes.map(routePathBounds);
	for (let firstIndex = 0; firstIndex < routes.length; firstIndex += 1) {
		const first = defined(routes[firstIndex]);
		if (!validateSelfContacts(first))
			return rejected(DedicatedCandidateRejectionCode.SelfContact, undefined, first.id);
		for (let secondIndex = firstIndex + 1; secondIndex < routes.length; secondIndex += 1) {
			const second = defined(routes[secondIndex]);
			if (!routeBoundsOverlap(defined(envelopes[firstIndex]), defined(envelopes[secondIndex])))
				continue;
			const invalidContact = disallowedRouteContacts(first, second, analysis.bridges)[0];
			if (invalidContact === undefined) continue;
			return {
				valid: false,
				code: DedicatedCandidateRejectionCode.RouteContact,
				relationId: first.id,
				otherRelationId: second.id,
				contact: invalidContact.from,
			};
		}
	}
	return undefined;
}
