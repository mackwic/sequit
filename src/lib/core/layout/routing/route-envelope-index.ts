import { defined } from '../../document/logic-document';
import { routeBoundsOverlap } from '../geometry/box-geometry';
import type { Bounds } from '../layout-types';

interface EnvelopeNode {
	bounds: Bounds;
	readonly index: number | undefined;
	readonly left: EnvelopeNode | undefined;
	readonly right: EnvelopeNode | undefined;
	parent: EnvelopeNode | undefined;
}

export interface RouteEnvelopeIndex {
	readonly root: EnvelopeNode | undefined;
	readonly leaves: readonly EnvelopeNode[];
}

function enclosing(left: Bounds, right: Bounds): Bounds {
	const x = Math.min(left.x, right.x);
	const y = Math.min(left.y, right.y);
	const rightEdge = Math.max(left.x + left.width, right.x + right.width);
	const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
	return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

function build(
	bounds: readonly Bounds[],
	leaves: EnvelopeNode[],
	start: number,
	end: number,
): EnvelopeNode | undefined {
	if (start === end) return undefined;
	if (end === start + 1) {
		const leaf = {
			bounds: defined(bounds[start]),
			index: start,
			left: undefined,
			right: undefined,
			parent: undefined,
		};
		leaves.push(leaf);
		return leaf;
	}
	const middle = Math.floor((start + end) / 2);
	const left = defined(build(bounds, leaves, start, middle));
	const right = defined(build(bounds, leaves, middle, end));
	const node: EnvelopeNode = {
		bounds: enclosing(left.bounds, right.bounds),
		index: undefined,
		left,
		right,
		parent: undefined,
	};
	left.parent = node;
	right.parent = node;
	return node;
}

export function prepareRouteEnvelopeIndex(bounds: readonly Bounds[]): RouteEnvelopeIndex {
	const leaves: EnvelopeNode[] = [];
	return { root: build(bounds, leaves, 0, bounds.length), leaves };
}

function collect(
	node: EnvelopeNode | undefined,
	candidate: Bounds,
	excluded: number,
	neighbors: number[],
): void {
	if (node === undefined || !routeBoundsOverlap(node.bounds, candidate)) return;
	if (node.index !== undefined) {
		if (node.index !== excluded) neighbors.push(node.index);
		return;
	}
	collect(node.left, candidate, excluded, neighbors);
	collect(node.right, candidate, excluded, neighbors);
}

export function routeEnvelopeNeighbors(
	index: RouteEnvelopeIndex,
	candidate: Bounds,
	excluded: number,
	neighbors: number[],
): void {
	neighbors.length = 0;
	collect(index.root, candidate, excluded, neighbors);
}

export function replaceRouteEnvelope(
	index: RouteEnvelopeIndex,
	routeIndex: number,
	bounds: Bounds,
): void {
	const leaf = defined(index.leaves[routeIndex]);
	leaf.bounds = bounds;
	for (let parent = leaf.parent; parent !== undefined; parent = parent.parent)
		parent.bounds = enclosing(defined(parent.left).bounds, defined(parent.right).bounds);
}
