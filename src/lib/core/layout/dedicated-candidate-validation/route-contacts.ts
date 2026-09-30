import { defined } from '../../document/logic-document';
import { disallowedRouteContacts } from '../bridges/bridge-contact';
import type { RouteBridgeAnalysis } from '../bridges/bridge-oracle';
import { type IndexedRun, indexRouteRuns, RunNeighborDirection } from '../bridges/route-run-index';
import { type RouteRun, routeRuns } from '../bridges/route-runs';
import { validateSelfContacts } from '../bridges/route-self-contacts';
import type { LayoutRelation } from '../layout-types';
import type { RejectedDedicatedCandidate } from './types';
import { DedicatedCandidateRejectionCode, rejected } from './types';

interface RouteContactIndex {
	readonly pathOrdinals: readonly number[];
	readonly runsByRoute: readonly (readonly RouteRun[])[];
	readonly neighbours: (index: number) => readonly IndexedRun[];
	cursor: number;
}

function laterRoutes(index: RouteContactIndex, firstIndex: number): readonly number[] {
	const touching = new Set<number>();
	const runs = defined(index.runsByRoute[firstIndex]);
	for (const position of runs.keys()) {
		for (const other of index.neighbours(index.cursor + position)) {
			touching.add(defined(index.pathOrdinals[other.index]));
		}
	}
	index.cursor += runs.length;
	return [...touching].sort((a, b) => a - b);
}

export function contactFailure(
	routes: readonly LayoutRelation[],
	analysis: RouteBridgeAnalysis,
): RejectedDedicatedCandidate | undefined {
	const runsByRoute = routes.map((route) => routeRuns(route));
	const runs: RouteRun[] = [];
	const pathOrdinals: number[] = [];
	for (const [routeIndex, pathRuns] of runsByRoute.entries())
		for (const run of pathRuns) {
			runs.push(run);
			pathOrdinals.push(routeIndex);
		}
	const index: RouteContactIndex = {
		pathOrdinals,
		runsByRoute,
		neighbours: indexRouteRuns(runs, {
			direction: RunNeighborDirection.Later,
			perpendicularOnly: false,
			pathOrdinals,
		}),
		cursor: 0,
	};
	for (let firstIndex = 0; firstIndex < routes.length; firstIndex += 1) {
		const first = defined(routes[firstIndex]);
		if (!validateSelfContacts(first))
			return rejected(DedicatedCandidateRejectionCode.SelfContact, undefined, first.id);
		for (const secondIndex of laterRoutes(index, firstIndex)) {
			const second = defined(routes[secondIndex]);
			const invalidContact = disallowedRouteContacts(first, second, analysis.bridges, {
				sortedByPoint: true,
			})[0];
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
