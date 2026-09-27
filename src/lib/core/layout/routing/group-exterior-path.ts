import { defined } from '../../document/logic-document';
import { type LayoutFrame, pointOnAxes } from '../geometry/layout-frame';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds, LayoutRelation, Point } from '../layout-types';

export interface FacePorts {
	readonly source: Point;
	readonly target: Point;
}

export function main(point: Point, vertical: boolean): number {
	if (vertical) return point.y;
	return point.x;
}

export function transverse(point: Point, vertical: boolean): number {
	if (vertical) return point.x;
	return point.y;
}

function faceClearances(
	frame: LayoutFrame,
	ports: FacePorts,
	clearances: readonly [number, number],
): readonly [number, number] {
	let outgoing = -1;
	if (!frame.forward) outgoing = 1;
	const sourceMain = main(ports.source, frame.vertical);
	const targetMain = main(ports.target, frame.vertical);
	const source = sourceMain + outgoing * clearances[0];
	const target = targetMain - outgoing * clearances[1];
	return [source, target];
}

export function exteriorPath(
	frame: LayoutFrame,
	track: number,
	ports: FacePorts,
	clearances: readonly [number, number],
): readonly Point[] {
	const [source, target] = faceClearances(frame, ports, clearances);
	const sourceCoordinate = transverse(ports.source, frame.vertical);
	const targetCoordinate = transverse(ports.target, frame.vertical);
	return [
		ports.source,
		pointOnAxes(sourceCoordinate, source, frame.vertical),
		pointOnAxes(track, source, frame.vertical),
		pointOnAxes(track, target, frame.vertical),
		pointOnAxes(targetCoordinate, target, frame.vertical),
		ports.target,
	];
}

/** An extra main-axis rail passes an obstacle spanning every simple transverse track. */
export function aroundPath(
	frame: LayoutFrame,
	ports: FacePorts,
	rails: { readonly main: number; readonly target: number },
	clearances: readonly [number, number],
): readonly Point[] {
	const [source, target] = faceClearances(frame, ports, clearances);
	const sourceCoordinate = transverse(ports.source, frame.vertical);
	const targetCoordinate = transverse(ports.target, frame.vertical);
	return [
		ports.source,
		pointOnAxes(sourceCoordinate, source, frame.vertical),
		pointOnAxes(sourceCoordinate, rails.main, frame.vertical),
		pointOnAxes(rails.target, rails.main, frame.vertical),
		pointOnAxes(rails.target, target, frame.vertical),
		pointOnAxes(targetCoordinate, target, frame.vertical),
		ports.target,
	];
}

/** Both sides are tried: a group may block the closer one at either endpoint. */
export function exteriorMainRails(
	bounds: ReadonlyMap<string, Bounds>,
	routes: readonly LayoutRelation[],
	vertical: boolean,
): readonly number[] {
	let low = Infinity;
	let high = 0;
	for (const box of bounds.values()) {
		let start = box.x;
		let size = box.width;
		if (vertical) {
			start = box.y;
			size = box.height;
		}
		low = Math.min(low, start);
		high = Math.max(high, start + size);
	}
	for (const route of routes)
		for (const point of route.points) {
			const coordinate = main(point, vertical);
			low = Math.min(low, coordinate);
			high = Math.max(high, coordinate);
		}
	return [Math.max(0, low - RAIL_SPACING), high + RAIL_SPACING];
}
export function aroundBoundaryPath(
	frame: LayoutFrame,
	ports: FacePorts,
	rails: {
		readonly main: number;
		readonly sourceMain: number;
		readonly sourceTrack: number;
		readonly targetTrack: number;
	},
	targetClearance: number,
): readonly Point[] {
	const sourceCoordinate = transverse(ports.source, frame.vertical);
	const targetCoordinate = transverse(ports.target, frame.vertical);
	let outgoing = -1;
	if (!frame.forward) outgoing = 1;
	const targetMain = main(ports.target, frame.vertical) - outgoing * targetClearance;
	return [
		ports.source,
		pointOnAxes(sourceCoordinate, rails.sourceMain, frame.vertical),
		pointOnAxes(rails.sourceTrack, rails.sourceMain, frame.vertical),
		pointOnAxes(rails.sourceTrack, rails.main, frame.vertical),
		pointOnAxes(rails.targetTrack, rails.main, frame.vertical),
		pointOnAxes(rails.targetTrack, targetMain, frame.vertical),
		pointOnAxes(targetCoordinate, targetMain, frame.vertical),
		ports.target,
	];
}

/** A source port can escape along the boundary of a close foreign group. */
export function sourceBoundaryEscapes(
	bounds: ReadonlyMap<string, Bounds>,
	groups: readonly { readonly id: string }[],
	port: Point,
	frame: LayoutFrame,
): readonly (readonly [number, number])[] {
	const origin = main(port, frame.vertical);
	const side = transverse(port, frame.vertical);
	let outward = -1;
	if (!frame.forward) outward = 1;
	const escapes: [number, number][] = [];
	for (const group of groups) {
		const box = defined(bounds.get(group.id));
		let start = box.x;
		let cross = box.y;
		let mainSize = box.width;
		let extent = box.height;
		if (frame.vertical) {
			start = box.y;
			cross = box.x;
			mainSize = box.height;
			extent = box.width;
		}
		const end = start + mainSize;
		for (const edge of [start, end]) {
			if ((edge - origin) * outward <= 0) continue;
			escapes.push([edge, cross], [edge, cross + extent]);
		}
	}
	escapes.sort((first, second) => {
		const mainDifference = Math.abs(first[0] - origin) - Math.abs(second[0] - origin);
		if (mainDifference !== 0) return mainDifference;
		const trackDifference = Math.abs(first[1] - side) - Math.abs(second[1] - side);
		if (trackDifference !== 0) return trackDifference;
		const mainOrder = first[0] - second[0];
		if (mainOrder !== 0) return mainOrder;
		return first[1] - second[1];
	});
	return escapes.filter((escape, index) => {
		const previous = escapes[index - 1];
		if (previous === undefined) return true;
		if (escape[0] !== previous[0]) return true;
		return escape[1] !== previous[1];
	});
}
