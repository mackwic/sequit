import type {
	LayoutBias,
	LayoutDirection,
	LogicDocument,
} from '../../src/lib/document/logic-document';
import { validateLogicDocument } from '../../src/lib/document/validate-logic-document';
import { createGraph, type LogicGraph } from '../../src/lib/graph/create-graph';
import { topologicallyRank, type TopologicalRanks } from '../../src/lib/graph/topological-ranks';
import {
	type Bounds,
	layoutGraph,
	type LayoutMeasurements,
	type LayoutResult,
} from '../../src/lib/layout/layout-graph';
import {
	type LayoutMeasurementOverrides,
	layoutMeasurementsFor,
} from '../builders/layout-measurements';

export interface LayoutFixture {
	readonly document: LogicDocument;
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly measurements: LayoutMeasurements;
	readonly layout: LayoutResult;
}

export type PreparedLayoutDocument = Omit<LayoutFixture, 'layout'>;

export function prepareLayoutDocument(
	document: LogicDocument,
	overrides: LayoutMeasurementOverrides = {},
): PreparedLayoutDocument {
	const validation = validateLogicDocument(document);
	if (!validation.ok) throw new Error('Expected a valid layout scenario');
	const graphResult = createGraph(document);
	if (!graphResult.ok) throw new Error('Expected an acyclic layout scenario');
	const ranks = topologicallyRank(graphResult.value);
	const measurements = layoutMeasurementsFor(document, overrides);
	return { document, graph: graphResult.value, ranks, measurements };
}

export async function layoutDocument(
	document: LogicDocument,
	overrides: LayoutMeasurementOverrides = {},
): Promise<LayoutFixture> {
	const prepared = prepareLayoutDocument(document, overrides);
	const { graph, ranks, measurements } = prepared;
	const layout = await layoutGraph(graph, ranks, measurements);
	return { ...prepared, layout };
}

export function boundsById(layout: LayoutResult): ReadonlyMap<string, Bounds> {
	return new Map(layout.elements.map(({ id, bounds }) => [id, bounds]));
}

export function boundsFor(layout: LayoutResult, id: string): Bounds {
	const bounds = layout.elements.find((element) => element.id === id)?.bounds;
	if (!bounds) throw new Error(`Missing layout bounds: ${id}`);
	return bounds;
}

export function envelopeFor(layout: LayoutResult, ids: readonly string[]): Bounds {
	if (ids.length === 0) throw new Error('Cannot measure an empty layout envelope');
	const bounds = ids.map((id) => boundsFor(layout, id));
	const left = Math.min(...bounds.map(({ x }) => x));
	const top = Math.min(...bounds.map(({ y }) => y));
	const right = Math.max(...bounds.map(({ x, width }) => x + width));
	const bottom = Math.max(...bounds.map(({ y, height }) => y + height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

export function coordinateAt(bounds: Bounds, side: LayoutBias): number {
	switch (side) {
		case 'top':
			return bounds.y;
		case 'bottom':
			return bounds.y + bounds.height;
		case 'left':
			return bounds.x;
		case 'right':
			return bounds.x + bounds.width;
		default:
			throw new Error(`Unsupported layout side: ${String(side)}`);
	}
}

export function progressesFromTo(
	source: Bounds,
	target: Bounds,
	direction: LayoutDirection,
): boolean {
	switch (direction) {
		case 'top-to-bottom':
			return source.y + source.height < target.y;
		case 'bottom-to-top':
			return target.y + target.height < source.y;
		case 'left-to-right':
			return source.x + source.width < target.x;
		case 'right-to-left':
			return target.x + target.width < source.x;
		default:
			throw new Error(`Unsupported layout direction: ${String(direction)}`);
	}
}

export function contains(outer: Bounds, inner: Bounds): boolean {
	return (
		inner.x > outer.x &&
		inner.y > outer.y &&
		inner.x + inner.width < outer.x + outer.width &&
		inner.y + inner.height < outer.y + outer.height
	);
}

export function overlaps(left: Bounds, right: Bounds): boolean {
	return (
		left.x < right.x + right.width &&
		left.x + left.width > right.x &&
		left.y < right.y + right.height &&
		left.y + left.height > right.y
	);
}
