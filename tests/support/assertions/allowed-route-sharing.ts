import { defined } from '../../../src/lib/core/document/logic-document';
import type { LayoutRelation, Point } from '../../../src/lib/core/layout/layout-types';
import { VisualAssertionError } from './assertion-error';
import { routeCrossings, type RouteSegment, routeSegments } from './route-geometry';

function samePoint(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
}

function overlap(a: RouteSegment, b: RouteSegment): RouteSegment | undefined {
	if (a.axis !== b.axis || a.fixed !== b.fixed) return undefined;
	const start = Math.max(a.start, b.start);
	const end = Math.min(a.end, b.end);
	if (start >= end) return undefined;
	return { ...a, start, end };
}

/** A shared trunk must be continuous from the common endpoint, not a later reunion. */
function commonTrunk(a: LayoutRelation, b: LayoutRelation, incoming = false): RouteSegment[] {
	let index = 0;
	let left = routeSegments(a);
	let right = routeSegments(b);
	if (incoming) {
		index = -1;
		left = left.toReversed();
		right = right.toReversed();
	}
	if (!samePoint(defined(a.points.at(index)), defined(b.points.at(index)))) return [];
	const shared: RouteSegment[] = [];
	for (let position = 0; position < Math.min(left.length, right.length); position += 1) {
		const first = defined(left[position]);
		const second = defined(right[position]);
		const segment = overlap(first, second);
		if (segment === undefined) break;
		shared.push(segment);
		if (first.start !== second.start || first.end !== second.end) break;
	}
	return shared;
}

function permittedTrunks(
	a: LayoutRelation,
	b: LayoutRelation,
	crossed: ReadonlySet<string>,
	sharedTargets: ReadonlySet<string>,
): RouteSegment[] {
	const allowed: RouteSegment[] = [];
	if (a.from === b.from) allowed.push(...commonTrunk(a, b));
	if (a.to !== b.to) return allowed;
	if (sharedTargets.has(a.to) || (!crossed.has(a.id) && !crossed.has(b.id))) {
		allowed.push(...commonTrunk(a, b, true));
		return allowed;
	}
	if (samePoint(defined(a.points.at(-1)), defined(b.points.at(-1)))) {
		throw new VisualAssertionError(
			'Port entrant après croisement',
			'un port exclusif par flèche croisée',
			'port partagé',
			{ routes: [a.id, b.id], boxes: [a.to] },
			{ code: 'routes.shared-crossed-port' },
		);
	}
	return allowed;
}

function checkPair(
	a: LayoutRelation,
	b: LayoutRelation,
	crossed: ReadonlySet<string>,
	sharedTargets: ReadonlySet<string>,
): void {
	const allowed = permittedTrunks(a, b, crossed, sharedTargets);
	for (const first of routeSegments(a)) {
		for (const second of routeSegments(b)) {
			const shared = overlap(first, second);
			if (shared === undefined) continue;
			const covered = allowed.some((trunk) => {
				const portion = overlap(shared, trunk);
				return portion?.start === shared.start && portion.end === shared.end;
			});
			if (!covered)
				throw new VisualAssertionError(
					'Tronc commun interdit',
					'un partage continu au départ ou une arrivée sans croisement',
					shared.end - shared.start,
					{ routes: [a.id, b.id] },
					{ code: 'routes.forbidden-trunk' },
				);
		}
	}
}

/** Both participants count as crossed, including every route using a crossed shared trunk. */
export function assertAllowedRouteSharing(
	routes: readonly LayoutRelation[],
	context: readonly LayoutRelation[] = routes,
	sharedTargets: ReadonlySet<string> = new Set(),
): void {
	const crossed = new Set(
		routeCrossings(context).flatMap(({ horizontalId, verticalId }) => [horizontalId, verticalId]),
	);
	for (const [index, route] of routes.entries()) {
		for (const other of routes.slice(index + 1)) checkPair(route, other, crossed, sharedTargets);
	}
}
