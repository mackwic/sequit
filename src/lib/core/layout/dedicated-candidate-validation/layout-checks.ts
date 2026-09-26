import { compareCanonicalStrings } from '../../canonical-string';
import { defined, EndpointKind, LayoutDirection } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { boundsOverlap, finitePositiveBounds } from '../geometry/box-geometry';
import type { Bounds, LayoutResult } from '../layout-types';
import { prepareJunctions } from '../structure/junction-structure';
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
	for (const [id, endpoint] of [...input.graph.endpointsById].sort(([a], [b]) =>
		compareCanonicalStrings(a, b),
	)) {
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

interface PrimaryInterval {
	readonly start: number;
	readonly end: number;
}

function physicalInterval(bounds: Bounds, direction: LayoutDirection): PrimaryInterval {
	let start = bounds.x;
	let end = bounds.x + bounds.width;
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop) {
		start = bounds.y;
		end = bounds.y + bounds.height;
	}
	if (direction === LayoutDirection.BottomToTop || direction === LayoutDirection.RightToLeft)
		return { start: -end, end: -start };
	return { start, end };
}

function ordinaryBands(
	input: DedicatedCandidateValidationInput,
	elements: ReadonlyMap<string, LayoutResult['elements'][number]>,
): Map<number, { start: number; end: number; id: string }> {
	const bands = new Map<number, { start: number; end: number; id: string }>();
	const nodes = [...input.graph.endpointsById]
		.filter(([, endpoint]) => endpoint.kind === EndpointKind.Node)
		.sort(([a], [b]) => compareCanonicalStrings(a, b));
	for (const [id] of nodes) {
		const rank = defined(input.ranks.byEndpointId.get(id));
		const interval = physicalInterval(
			defined(elements.get(id)).bounds,
			input.graph.document.layout.direction,
		);
		const band = bands.get(rank);
		if (band === undefined) bands.set(rank, { ...interval, id });
		else {
			band.start = Math.min(band.start, interval.start);
			band.end = Math.max(band.end, interval.end);
		}
	}
	return bands;
}

function junctionRankFailure(
	input: DedicatedCandidateValidationInput,
	elements: ReadonlyMap<string, LayoutResult['elements'][number]>,
	bands: ReadonlyMap<number, PrimaryInterval>,
	ordered: readonly (readonly [number, PrimaryInterval])[],
): RejectedDedicatedCandidate | undefined {
	const direction = input.graph.document.layout.direction;
	const junctions = prepareJunctions(input.graph, input.ranks.byEndpointId);
	for (const id of [...junctions.keys()].sort(compareCanonicalStrings)) {
		const junction = defined(junctions.get(id));
		const interval = physicalInterval(defined(elements.get(id)).bounds, direction);
		const before = bands.get(junction.interval);
		const after = ordered.find(([rank]) => rank > junction.interval)?.[1];
		const overlapsPreviousRow = before !== undefined && interval.start < before.end;
		const overlapsNextRow = after !== undefined && interval.end > after.start;
		if (overlapsPreviousRow || overlapsNextRow)
			return rejected(DedicatedCandidateRejectionCode.RankOrder, id);
		for (const parentId of defined(input.graph.outgoingByEndpointId.get(id))) {
			if (junctions.get(parentId)?.interval !== junction.interval) continue;
			const parentInterval = physicalInterval(defined(elements.get(parentId)).bounds, direction);
			if (parentInterval.end > interval.start)
				return rejected(DedicatedCandidateRejectionCode.RankOrder, id);
		}
	}
	return undefined;
}

/** Ordinary ranks occupy disjoint physical bands; junction rails live in their intervening interval. */
export function validateRankRows(
	input: DedicatedCandidateValidationInput,
	elements: ReadonlyMap<string, LayoutResult['elements'][number]>,
): RejectedDedicatedCandidate | undefined {
	const bands = ordinaryBands(input, elements);
	const ordered = [...bands].sort(([left], [right]) => left - right);
	for (let index = 1; index < ordered.length; index += 1) {
		const previous = defined(ordered[index - 1])[1];
		const current = defined(ordered[index])[1];
		if (previous.end > current.start)
			return rejected(DedicatedCandidateRejectionCode.RankOrder, current.id);
	}
	return junctionRankFailure(input, elements, bands, ordered);
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
			if (unrelatedOverlap(input.graph, first, second)) {
				const ids = [first.id, second.id].sort(compareCanonicalStrings);
				return {
					...rejected(DedicatedCandidateRejectionCode.ElementOverlap, defined(ids[0])),
					otherEndpointId: defined(ids[1]),
				};
			}
		}
	}
	return undefined;
}
