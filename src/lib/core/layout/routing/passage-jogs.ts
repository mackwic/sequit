import { defined, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter } from '../geometry/layout-frame';
import type { Bounds, RoutingLayers } from '../layout-types';

export interface PassageReservation {
	readonly coordinate: number;
	readonly sourceLayer: number;
	readonly targetLayer: number;
	readonly sourceId: string;
	readonly targetId: string;
	/** Transverse coordinates where the reserved route leaves its source and meets its target. */
	readonly sourceCoordinate: number;
	readonly targetCoordinate: number;
}

export interface JogContext {
	readonly graph: LogicGraph;
	readonly layers: RoutingLayers;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	readonly reservations: readonly PassageReservation[];
}

export interface JogRequest {
	readonly relation: LogicRelation;
	readonly candidates: readonly number[];
	readonly sourceCoordinate: number;
	readonly targetCoordinate: number;
	readonly layerSpan: readonly [target: number, source: number];
}

interface JogBand {
	/** Routing layer beside which the jog runs. */
	readonly layer: number;
	/** The jog runs toward the previous layer (source side) or the next layer (target side). */
	readonly towardPrevious: boolean;
	/** The endpoint the jog leaves; passages sharing it can nest without crossing. */
	readonly endpointId: string;
	readonly from: number;
	readonly to: number;
}

function strictlyBetween(value: number, band: JogBand): boolean {
	return value > Math.min(band.from, band.to) && value < Math.max(band.from, band.to);
}

/** Boxes of the band's own layer whose relations leave through that band. */
function crossedEndpoints(context: JogContext, band: JogBand): number {
	const { graph, bounds, vertical } = context;
	let edges = graph.predecessorsByEndpointId;
	if (band.towardPrevious) edges = graph.outgoingByEndpointId;
	let count = 0;
	for (const id of defined(context.layers.rows[band.layer])) {
		if ((edges.get(id)?.length ?? 0) === 0) continue;
		const box = bounds.get(id);
		if (box !== undefined && strictlyBetween(transverseCenter(box, vertical), band)) count += 1;
	}
	return count;
}

/** Passages already reserved through the band, between `boundary - 1` and `boundary`. */
function crossedPassages(context: JogContext, band: JogBand): number {
	let boundary = band.layer + 1;
	if (band.towardPrevious) boundary = band.layer;
	let count = 0;
	for (const held of context.reservations) {
		let shared = held.targetId === band.endpointId;
		if (band.towardPrevious) shared = held.sourceId === band.endpointId;
		const spans = held.targetLayer < boundary && held.sourceLayer >= boundary;
		if (spans && !shared && strictlyBetween(held.coordinate, band)) count += 1;
	}
	return count;
}

function jogCrossings(context: JogContext, band: JogBand): number {
	return crossedEndpoints(context, band) + crossedPassages(context, band);
}

function between(value: number, first: number, second: number): boolean {
	return value > Math.min(first, second) && value < Math.max(first, second);
}

/**
 * Reserved jogs the candidate passage runs through. A jog lies in the band beside its endpoint
 * row; the passage fully crosses the bands strictly between its own two jog bands.
 */
function crossedJogs(context: JogContext, request: JogRequest, candidate: number): number {
	const [targetLayer, sourceLayer] = request.layerSpan;
	const firstInside = targetLayer + 2;
	const inside = (boundary: number) => boundary >= firstInside && boundary < sourceLayer;
	let count = 0;
	for (const held of context.reservations) {
		if (inside(held.sourceLayer) && between(candidate, held.sourceCoordinate, held.coordinate))
			count += 1;
		if (inside(held.targetLayer + 1) && between(candidate, held.targetCoordinate, held.coordinate))
			count += 1;
	}
	return count;
}

/**
 * A long relation joins its passage through one jog beside each endpoint; those jogs cross
 * the relations leaving the endpoint rows and the passages already reserved there, and the
 * passage itself crosses the jogs of reserved relations. Rank the unique candidates by that
 * estimate, keeping the caller's priority order between equals.
 */
export function byJogCrossings(context: JogContext, request: JogRequest): readonly number[] {
	const { relation, sourceCoordinate, targetCoordinate } = request;
	const [targetLayer, sourceLayer] = request.layerSpan;
	const source = { layer: sourceLayer, towardPrevious: true, endpointId: relation.from };
	const target = { layer: targetLayer, towardPrevious: false, endpointId: relation.to };
	const estimates = new Map<number, number>();
	for (const candidate of request.candidates) {
		if (estimates.has(candidate)) continue;
		const fromSource = jogCrossings(context, { ...source, from: sourceCoordinate, to: candidate });
		const fromTarget = jogCrossings(context, { ...target, from: targetCoordinate, to: candidate });
		const through = crossedJogs(context, request, candidate);
		estimates.set(candidate, fromSource + fromTarget + through);
	}
	return [...estimates.keys()].sort(
		(left, right) => defined(estimates.get(left)) - defined(estimates.get(right)),
	);
}
