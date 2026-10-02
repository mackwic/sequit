import {
	type RoutedPath,
	RouteOrientation,
} from '../../../../src/lib/core/layout/bridges/route-runs';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import type { BoxGeometry } from '../../../support/harnesses/box-geometry';
import type { LayoutFixture } from '../../../support/harnesses/layout';
import { referenceRuns } from './bridge-oracle-reference';

interface Segment {
	readonly id: string;
	readonly vertical: boolean;
	readonly coordinate: number;
	readonly first: number;
	readonly last: number;
	readonly passage: boolean;
}

interface Plane {
	readonly start: number;
	readonly end: number;
	readonly first: number;
	readonly last: number;
}

function plane(box: Bounds, vertical: boolean): Plane {
	if (vertical)
		return { start: box.x, end: box.x + box.width, first: box.y, last: box.y + box.height };
	return { start: box.y, end: box.y + box.height, first: box.x, last: box.x + box.width };
}

function segments(paths: readonly RoutedPath[]): readonly Segment[] {
	return paths.flatMap((path) =>
		referenceRuns(path).map(({ start, end, orientation }, index, runs) => {
			const passage = index > 0 && index < runs.length - 1;
			if (orientation === RouteOrientation.Vertical)
				return {
					id: path.id,
					passage,
					vertical: true,
					coordinate: start.x,
					first: Math.min(start.y, end.y),
					last: Math.max(start.y, end.y),
				};
			return {
				id: path.id,
				passage,
				vertical: false,
				coordinate: start.y,
				first: Math.min(start.x, end.x),
				last: Math.max(start.x, end.x),
			};
		}),
	);
}

function freeBand(
	segment: Segment,
	range: readonly [number, number],
	boxes: readonly BoxGeometry[],
	groups: ReadonlySet<string>,
): { readonly start: number; readonly end: number; readonly framed: boolean } {
	let start = Number.NEGATIVE_INFINITY;
	let end = Number.POSITIVE_INFINITY;
	let startFrame = false;
	let endFrame = false;
	for (const box of boxes) {
		const projected = plane(box.bounds, segment.vertical);
		if (projected.first >= range[1] || projected.last <= range[0]) continue;
		const framed = groups.has(box.id);
		if (!framed && projected.start < segment.coordinate && segment.coordinate < projected.end)
			continue;
		for (const edge of [projected.start, projected.end]) {
			if (edge <= segment.coordinate && edge >= start) {
				if (edge > start) startFrame = false;
				start = edge;
				startFrame ||= framed;
			}
			if (edge >= segment.coordinate && edge <= end) {
				if (edge < end) endFrame = false;
				end = edge;
				endFrame ||= framed;
			}
		}
	}
	return { start, end, framed: startFrame && endFrame };
}

interface ShellBandViolation {
	readonly pathId: string;
	readonly frameId: string;
	readonly distance: number;
	readonly minimum: number;
	readonly passages: number;
}

/** Actual outside free space, or a strip between two frames, shared by all overlapping routes. */
export function referenceShellBandViolations(
	paths: readonly RoutedPath[],
	boxes: readonly BoxGeometry[],
	groups: ReadonlySet<string>,
): readonly ShellBandViolation[] {
	const runs = segments(paths);
	const violations: ShellBandViolation[] = [];
	for (const run of runs) {
		for (const box of boxes) {
			if (!groups.has(box.id)) continue;
			const frame = plane(box.bounds, run.vertical);
			const first = Math.max(frame.first, run.first);
			const last = Math.min(frame.last, run.last);
			if (first >= last) continue;
			const distance = Math.min(
				Math.abs(run.coordinate - frame.start),
				Math.abs(run.coordinate - frame.end),
			);
			// Exact frame contacts identify the explicitly permitted historical saturation fallback.
			if (distance === 0 || distance >= 12) continue;
			const band = freeBand(run, [first, last], boxes, groups);
			const inside = frame.start < run.coordinate && run.coordinate < frame.end;
			if (inside && !band.framed) continue;
			let count = 1;
			for (const other of runs) {
				if (other.id === run.id || other.vertical !== run.vertical) continue;
				if (other.first >= last || other.last <= first) continue;
				if (other.coordinate <= band.start || other.coordinate >= band.end) continue;
				if (other.coordinate !== run.coordinate) count += 1;
			}
			const minimum = Math.min(12, (band.end - band.start) / (count + 1));
			if (distance < minimum - 1e-8)
				violations.push({ pathId: run.id, frameId: box.id, distance, minimum, passages: count });
		}
	}
	return violations;
}

/** Compare independent parallel runs over at least 24 units, excluding intentional shared columns. */
export function referencePassagePitch(
	paths: readonly RoutedPath[],
	vertical: boolean,
	includePorts = true,
): number {
	const runs = segments(paths).filter(
		(run) => run.vertical === vertical && (includePorts || run.passage),
	);
	let minimum = Number.POSITIVE_INFINITY;
	for (const [index, first] of runs.entries()) {
		for (const second of runs.slice(index + 1)) {
			if (first.id === second.id || first.coordinate === second.coordinate) continue;
			if (Math.min(first.last, second.last) - Math.max(first.first, second.first) < 24) continue;
			minimum = Math.min(minimum, Math.abs(first.coordinate - second.coordinate));
		}
	}
	return minimum;
}

export function referenceEscapedRoutes({
	document,
	layout,
}: Pick<LayoutFixture, 'document' | 'layout'>): readonly string[] {
	const parents = new Map(
		[...document.nodes, ...document.junctions, ...document.groups].map(({ id, groupId }) => [
			id,
			groupId,
		]),
	);
	const boxes = new Map(layout.elements.map(({ id, bounds }) => [id, bounds]));
	const ancestors = (id: string) => {
		const result = new Set<string>();
		for (let group = parents.get(id); group !== undefined; group = parents.get(group))
			result.add(group);
		return result;
	};
	const escaped: string[] = [];
	for (const route of layout.relations) {
		const from = ancestors(route.from);
		for (const group of ancestors(route.to)) {
			if (!from.has(group)) continue;
			const box = boxes.get(group);
			if (box === undefined) throw new Error(`Missing ancestor frame ${group}`);
			if (
				route.points.some(
					({ x, y }) => x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height,
				)
			) {
				escaped.push(route.id);
				break;
			}
		}
	}
	return escaped;
}
