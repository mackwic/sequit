import { defined } from '../../../src/lib/core/document/logic-document';
import type { LayoutRelation, Point } from '../../../src/lib/core/layout/layout-types';
import { type RouteSegment, routeSegments } from './route-geometry';

/** The point at `along` on the line of a run. */
function pointOf({ axis, fixed }: RouteSegment, along: number): Point {
	if (axis === 'x') return { x: along, y: fixed };
	return { x: fixed, y: along };
}

function keyOf(segment: RouteSegment, along: number): string {
	const { x, y } = pointOf(segment, along);
	return `${x},${y}`;
}

class Partition {
	private readonly parents = new Map<string, string>();

	find(key: string): string {
		let root = key;
		for (let parent = this.parents.get(root); parent !== undefined && parent !== root;) {
			root = parent;
			parent = this.parents.get(root);
		}
		this.parents.set(key, root);
		return root;
	}

	join(left: string, right: string): void {
		const a = this.find(left);
		const b = this.find(right);
		if (a !== b) this.parents.set(a, b);
	}
}

/**
 * Routes whose drawn ink touches, grouped together. Ink touches where a run starts, ends or bends
 * on another route: a shared port, a common trunk or a T contact. A strict crossing does not join
 * two routes, since its point is the end of no run.
 */
export function routeNetworks(
	routes: readonly LayoutRelation[],
): readonly (readonly LayoutRelation[])[] {
	const runs = routes.map((route) => ({ route, segments: routeSegments(route) }));
	/** Positions along each line of the run ends lying on it, by axis then fixed coordinate. */
	const ends = { x: new Map<number, number[]>(), y: new Map<number, number[]>() };
	for (const { segments } of runs)
		for (const segment of segments)
			for (const along of [segment.start, segment.end]) {
				const { x, y } = pointOf(segment, along);
				ends.x.set(y, [...(ends.x.get(y) ?? []), x]);
				ends.y.set(x, [...(ends.y.get(x) ?? []), y]);
			}
	const partition = new Partition();
	for (const { segments } of runs)
		for (const segment of segments) {
			const origin = keyOf(segment, segment.start);
			for (const along of defined(ends[segment.axis].get(segment.fixed)))
				if (along >= segment.start && along <= segment.end)
					partition.join(origin, keyOf(segment, along));
		}
	const networks = new Map<string, LayoutRelation[]>();
	for (const { route, segments } of runs) {
		const first = defined(segments[0]);
		const root = partition.find(keyOf(first, first.start));
		networks.set(root, [...(networks.get(root) ?? []), route]);
	}
	return [...networks.values()];
}

export interface PhantomRelation {
	readonly from: string;
	readonly to: string;
	readonly network: readonly string[];
}

/**
 * Relations a reader infers but the drawing does not hold: connected ink offers every source of a
 * network to every target of the same network, whatever the arrow directions along it.
 */
export function phantomRelations(routes: readonly LayoutRelation[]): readonly PhantomRelation[] {
	const drawn = new Set(routes.map(({ from, to }) => JSON.stringify([from, to])));
	const phantoms: PhantomRelation[] = [];
	for (const network of routeNetworks(routes)) {
		const sources = new Set(network.map(({ from }) => from));
		const targets = new Set(network.map(({ to }) => to));
		const ids = network.map(({ id }) => id).toSorted();
		for (const from of sources)
			for (const to of targets)
				if (from !== to && !drawn.has(JSON.stringify([from, to])))
					phantoms.push({ from, to, network: ids });
	}
	return phantoms;
}
