import { compareCanonicalStrings } from '../../canonical-string';
import { defined, EndpointKind, LayoutDirection } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { boundsOverlap, finitePositiveBounds } from '../geometry/box-geometry';
import type { Bounds, LayoutResult } from '../layout-types';
import type { EndpointMinimumSize } from './element-checks';
import { minimumElementSize, sameOwnerGroup } from './element-checks';
import type { DedicatedCandidateValidationInput, RejectedDedicatedCandidate } from './types';
import { DedicatedCandidateRejectionCode, rejected } from './types';

function validCanvas(width: number, height: number): boolean {
	if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
	return width > 0 && height > 0;
}

function validBoxBounds(box: Bounds): boolean {
	if (!finitePositiveBounds(box)) return false;
	return box.x >= 0 && box.y >= 0;
}

function outsideCanvas(box: Bounds, width: number, height: number): boolean {
	const right = box.x + box.width;
	const bottom = box.y + box.height;
	return right > width || bottom > height;
}

function meetsMinimumSize(box: Bounds, size: EndpointMinimumSize | undefined): boolean {
	if (size === undefined) return false;
	if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return false;
	return box.width >= size.width && box.height >= size.height;
}

export function validateElementBounds(
	input: DedicatedCandidateValidationInput,
	elements: ReadonlyMap<string, LayoutResult['elements'][number]>,
): RejectedDedicatedCandidate | undefined {
	const { width, height } = input.layout;
	if (!validCanvas(width, height)) return rejected(DedicatedCandidateRejectionCode.InvalidCanvas);
	for (const [id, endpoint] of input.graph.endpointsById) {
		const box = defined(elements.get(id)).bounds;
		if (!validBoxBounds(box)) return rejected(DedicatedCandidateRejectionCode.InvalidBounds, id);
		if (outsideCanvas(box, width, height))
			return rejected(DedicatedCandidateRejectionCode.InvalidCanvas, id);
		const size = minimumElementSize(input, id, endpoint.kind);
		if (!meetsMinimumSize(box, size))
			return rejected(DedicatedCandidateRejectionCode.MinimumSize, id);
	}
	return undefined;
}

function mainCoordinate(bounds: Bounds, direction: LayoutDirection): number {
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop)
		return bounds.y + bounds.height / 2;
	return bounds.x + bounds.width / 2;
}

function forwardDirection(direction: LayoutDirection): boolean {
	return direction === LayoutDirection.TopToBottom || direction === LayoutDirection.LeftToRight;
}

export function validateRankRows(
	input: DedicatedCandidateValidationInput,
	elements: ReadonlyMap<string, LayoutResult['elements'][number]>,
): RejectedDedicatedCandidate | undefined {
	const direction = input.graph.document.layout.direction;
	let sign = -1;
	if (forwardDirection(direction)) sign = 1;
	const rows = [...input.graph.endpointsById]
		.filter(
			([id, endpoint]) => endpoint.kind === EndpointKind.Node && input.ranks.byEndpointId.has(id),
		)
		.map(([id]) => {
			const element = defined(elements.get(id));
			return {
				id,
				rank: defined(input.ranks.byEndpointId.get(id)),
				progress: sign * mainCoordinate(element.bounds, direction),
			};
		})
		.sort((left, right) => left.progress - right.progress || left.rank - right.rank);
	for (let index = 1; index < rows.length; index += 1) {
		const previous = defined(rows[index - 1]);
		const current = defined(rows[index]);
		const rankDecreases = current.rank < previous.rank;
		const samePositionHasDifferentRank =
			current.progress === previous.progress && current.rank !== previous.rank;
		if (rankDecreases || samePositionHasDifferentRank)
			return rejected(DedicatedCandidateRejectionCode.RankOrder, current.id);
	}
	return undefined;
}

function relatedByGroup(graph: LogicGraph, firstId: string, secondId: string): boolean {
	if (graph.endpointsById.get(firstId)?.kind !== EndpointKind.Group) return false;
	if (sameOwnerGroup(graph, firstId, secondId)) return true;
	return sameOwnerGroup(graph, secondId, firstId);
}

function unrelatedOverlap(
	graph: LogicGraph,
	first: LayoutResult['elements'][number],
	second: LayoutResult['elements'][number],
): boolean {
	if (!boundsOverlap(first.bounds, second.bounds)) return false;
	if (relatedByGroup(graph, first.id, second.id)) return false;
	return !relatedByGroup(graph, second.id, first.id);
}

export function validateElementOverlap(
	input: DedicatedCandidateValidationInput,
	elements: ReadonlyMap<string, LayoutResult['elements'][number]>,
): RejectedDedicatedCandidate | undefined {
	const ordered = [...elements.values()].sort(
		(left, right) => left.bounds.x - right.bounds.x || compareCanonicalStrings(left.id, right.id),
	);
	for (let index = 0; index < ordered.length; index += 1) {
		const first = defined(ordered[index]);
		const firstRight = first.bounds.x + first.bounds.width;
		for (let otherIndex = index + 1; otherIndex < ordered.length; otherIndex += 1) {
			const second = defined(ordered[otherIndex]);
			if (second.bounds.x >= firstRight) break;
			if (unrelatedOverlap(input.graph, first, second))
				return {
					...rejected(DedicatedCandidateRejectionCode.ElementOverlap, second.id),
					otherEndpointId: first.id,
				};
		}
	}
	return undefined;
}
