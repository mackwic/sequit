import { defined } from '../../document/logic-document';
import { RouteOrientation, type RouteRun, type RouteWorkCharge } from './route-runs';

interface Envelope {
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
}

interface IndexedRun {
	readonly run: RouteRun;
	readonly index: number;
	readonly box: Envelope;
}

interface Node {
	readonly box: Envelope;
	readonly run: IndexedRun;
	readonly before: Node | undefined;
	readonly after: Node | undefined;
}

function envelope(run: RouteRun): Envelope {
	return {
		left: Math.min(run.start.x, run.end.x),
		right: Math.max(run.start.x, run.end.x),
		top: Math.min(run.start.y, run.end.y),
		bottom: Math.max(run.start.y, run.end.y),
	};
}

function overlaps(first: Envelope, second: Envelope): boolean {
	const horizontal = first.left <= second.right && second.left <= first.right;
	const vertical = first.top <= second.bottom && second.top <= first.bottom;
	return horizontal && vertical;
}

function union(first: Envelope, second: Envelope): Envelope {
	return {
		left: Math.min(first.left, second.left),
		right: Math.max(first.right, second.right),
		top: Math.min(first.top, second.top),
		bottom: Math.max(first.bottom, second.bottom),
	};
}

function build(runs: readonly IndexedRun[], start: number, end: number): Node | undefined {
	if (start === end) return undefined;
	const middle = Math.floor((start + end) / 2);
	const run = defined(runs[middle]);
	const before = build(runs, start, middle);
	const after = build(runs, middle + 1, end);
	let box = run.box;
	if (before !== undefined) box = union(box, before.box);
	if (after !== undefined) box = union(box, after.box);
	return { run, box, before, after };
}

interface Query {
	readonly box: Envelope;
	readonly current: number;
	readonly later: boolean;
	readonly pathId: string;
	readonly pathOrdinals: readonly number[] | undefined;
	readonly matches: IndexedRun[];
	readonly charge: RouteWorkCharge | undefined;
}

function candidates(node: Node | undefined, query: Query): void {
	if (node === undefined) return;
	query.charge?.(1);
	if (!overlaps(node.box, query.box)) return;
	let eligible = node.run.index < query.current;
	if (query.later) eligible = node.run.index > query.current;
	let differentPath = node.run.run.pathId !== query.pathId;
	if (query.pathOrdinals !== undefined)
		differentPath = query.pathOrdinals[node.run.index] !== query.pathOrdinals[query.current];
	if (eligible && differentPath && overlaps(node.run.box, query.box)) query.matches.push(node.run);
	candidates(node.before, query);
	candidates(node.after, query);
}

function sortedTree(runs: readonly IndexedRun[], charge?: RouteWorkCharge): Node | undefined {
	const ordered = [...runs].sort((first, second) => {
		charge?.(1);
		const x = first.box.left - second.box.left;
		const y = first.box.top - second.box.top;
		return x || y || first.index - second.index;
	});
	return build(ordered, 0, ordered.length);
}

export enum RunNeighborDirection {
	Earlier = 'earlier',
	Later = 'later',
}

export interface RunIndexOptions {
	readonly direction: RunNeighborDirection;
	readonly perpendicularOnly: boolean;
	readonly charge?: RouteWorkCharge | undefined;
	readonly pathOrdinals?: readonly number[];
}

/** Static segment-envelope index; yield different-path neighbours in canonical run order. */
export function indexRouteRuns(
	runs: readonly RouteRun[],
	options: RunIndexOptions,
): (index: number) => readonly RouteRun[] {
	const { charge, perpendicularOnly } = options;
	const later = options.direction === RunNeighborDirection.Later;
	const indexed = runs.map((run, index) => ({ run, index, box: envelope(run) }));
	let root: Node | undefined;
	let horizontal: Node | undefined;
	let vertical: Node | undefined;
	if (perpendicularOnly) {
		horizontal = sortedTree(
			indexed.filter(({ run }) => run.orientation === RouteOrientation.Horizontal),
			charge,
		);
		vertical = sortedTree(
			indexed.filter(({ run }) => run.orientation === RouteOrientation.Vertical),
			charge,
		);
	} else root = sortedTree(indexed, charge);
	charge?.(runs.length);
	return (index) => {
		const matches: IndexedRun[] = [];
		const run = defined(indexed[index]);
		let queried = root;
		if (perpendicularOnly) {
			queried = horizontal;
			if (run.run.orientation === RouteOrientation.Horizontal) queried = vertical;
		}
		candidates(queried, {
			box: run.box,
			current: index,
			later,
			pathId: run.run.pathId,
			pathOrdinals: options.pathOrdinals,
			matches,
			charge,
		});
		matches.sort((first, second) => {
			charge?.(1);
			return first.index - second.index;
		});
		return matches.map(({ run }) => run);
	};
}
