import { defined } from '../../document/logic-document';
import { RAIL_SPACING } from '../layout-settings';
import type { LayoutRelation } from '../layout-types';
import { aroundBoundaryPath, main, sourceBoundaryEscapes, transverse } from './group-exterior-path';
import {
	type ExteriorAttempt,
	type RoutingContext,
	sharedSourceEscapes,
} from './group-route-candidates';
import { candidateTracks } from './group-track-index';
import {
	CLEAR,
	firstBlockedSegment,
	type SegmentFilter,
	segmentFilter,
} from './route-segment-filter';

const HALF_RAIL = RAIL_SPACING / 2;
const DOUBLE_RAIL = RAIL_SPACING * 2;
const TRIPLE_RAIL = RAIL_SPACING * 3;
const INWARD_TRIPLE_RAIL = -TRIPLE_RAIL;
const ESCAPE_CLEARANCES = [RAIL_SPACING, DOUBLE_RAIL, TRIPLE_RAIL, HALF_RAIL, 0];
const TARGET_CLEARANCES = [
	RAIL_SPACING,
	DOUBLE_RAIL,
	TRIPLE_RAIL,
	HALF_RAIL,
	-HALF_RAIL,
	-RAIL_SPACING,
	-DOUBLE_RAIL,
	INWARD_TRIPLE_RAIL,
];
// Segments of a boundary path: the first two depend on the escape alone, the third on the escape
// and the main rail, the fourth also on the target track. The last three depend on the target
// track, the main rail and the clearance, never on the escape.
const RAIL_SEGMENT = 2;
const TAIL_SEGMENT = 4;

interface BoundarySearch {
	readonly context: RoutingContext;
	readonly attempt: ExteriorAttempt;
	readonly clear: SegmentFilter;
	/** The checks of an admissible path that do not split into segments. */
	readonly admits: (candidate: LayoutRelation) => boolean;
	/** Clearances whose tail segments are clear, by target track then main rail. */
	readonly tails: Map<number, Map<number, readonly number[]>>;
}

interface BoundaryRails {
	readonly main: number;
	readonly sourceMain: number;
	readonly sourceTrack: number;
	readonly targetTrack: number;
}

function tailClearances(search: BoundarySearch, rails: BoundaryRails): readonly number[] {
	let byRail = search.tails.get(rails.targetTrack);
	if (byRail === undefined) {
		byRail = new Map();
		search.tails.set(rails.targetTrack, byRail);
	}
	let clearances = byRail.get(rails.main);
	if (clearances === undefined) {
		clearances = TARGET_CLEARANCES.filter((targetClearance) => {
			const { frame } = search.context;
			const points = aroundBoundaryPath(frame, search.attempt.ports, rails, targetClearance);
			return firstBlockedSegment(points, search.clear, TAIL_SEGMENT, points.length - 1) === CLEAR;
		});
		byRail.set(rails.main, clearances);
	}
	return clearances;
}

/** The candidate of the first admissible clearance, or the blocked segment shared by all. */
function boundaryOnRail(
	search: BoundarySearch,
	rails: BoundaryRails,
): LayoutRelation | number | undefined {
	for (const targetClearance of tailClearances(search, rails)) {
		const points = aroundBoundaryPath(
			search.context.frame,
			search.attempt.ports,
			rails,
			targetClearance,
		);
		const blocked = firstBlockedSegment(points, search.clear, 0, TAIL_SEGMENT);
		if (blocked !== CLEAR) return blocked;
		const candidate = { ...search.attempt.route, points };
		if (search.admits(candidate)) return candidate;
	}
	return undefined;
}

/** Skip only the candidates that share a blocked segment with a rejected one. */
function boundaryOnEscape(
	search: BoundarySearch,
	escape: readonly [number, number],
): LayoutRelation | undefined {
	const { context, attempt } = search;
	const source = transverse(attempt.ports.source, context.vertical);
	const target = transverse(attempt.ports.target, context.vertical);
	const open = [...attempt.rails];
	for (const targetTrack of candidateTracks(defined(context.tracks), source, target)) {
		for (const mainRail of [...open]) {
			const rails = { main: mainRail, sourceMain: escape[0], sourceTrack: escape[1], targetTrack };
			const result = boundaryOnRail(search, rails);
			if (typeof result === 'object') return result;
			if (result !== undefined && result < RAIL_SEGMENT) return undefined;
			if (result === RAIL_SEGMENT) open.splice(open.indexOf(mainRail), 1);
		}
		if (open.length === 0) return undefined;
	}
	return undefined;
}

export function boundaryForPorts(
	context: RoutingContext,
	attempt: ExteriorAttempt,
	admits: (candidate: LayoutRelation) => boolean,
): LayoutRelation | undefined {
	const escapes = [
		...sourceBoundaryEscapes(
			context.bounds,
			context.graph.document.groups,
			attempt.ports.source,
			context.frame,
		),
		...sharedSourceEscapes(context, attempt.route, attempt.ports.source),
	];
	// A node can block the source column on the way to the exterior main rail.
	// Reserve a transverse escape first, instead of extending that column through it.
	let outgoing = 1;
	if (context.frame.forward) outgoing = -1;
	const sourceMain = main(attempt.ports.source, context.vertical);
	for (const clearance of ESCAPE_CLEARANCES)
		for (const track of [context.outside + RAIL_SPACING, 0])
			escapes.push([sourceMain + outgoing * clearance, track]);
	const search = {
		context,
		attempt,
		clear: segmentFilter(context, attempt, attempt.ports),
		admits,
		tails: new Map<number, Map<number, readonly number[]>>(),
	};
	for (const escape of escapes) {
		const candidate = boundaryOnEscape(search, escape);
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}
