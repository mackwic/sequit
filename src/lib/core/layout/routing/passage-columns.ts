import { defined, type LogicRelation } from '../../document/logic-document';
import { transverseCenter } from '../geometry/layout-frame';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds, RoutingLayers } from '../layout-types';
import type { PassageReservation } from './passage-jogs';

type LayerSpan = readonly [target: number, source: number];

export interface PassageEnds {
	readonly layerSpan: LayerSpan;
	/** Transverse coordinates of the relation's effective source and target ports. */
	readonly sourceCoordinate: number;
	readonly targetCoordinate: number;
}

interface PassageEndInput {
	readonly layers: RoutingLayers;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	readonly sourceOffsets?: ReadonlyMap<string, number> | undefined;
	readonly targetOffsets?: ReadonlyMap<string, number> | undefined;
}

export function passageEnds(input: PassageEndInput, relation: LogicRelation): PassageEnds {
	const source = defined(input.bounds.get(relation.from));
	const target = defined(input.bounds.get(relation.to));
	return {
		layerSpan: [
			defined(input.layers.byId.get(relation.to)),
			defined(input.layers.byId.get(relation.from)),
		],
		sourceCoordinate:
			transverseCenter(source, input.vertical) + (input.sourceOffsets?.get(relation.id) ?? 0),
		targetCoordinate:
			transverseCenter(target, input.vertical) + (input.targetOffsets?.get(relation.id) ?? 0),
	};
}

/** Lower bound in the sorted reservation index; equal coordinates stay adjacent. */
function insertionIndex(reservations: readonly PassageReservation[], coordinate: number): number {
	let start = 0;
	let end = reservations.length;
	while (start < end) {
		const middle = Math.floor((start + end) / 2);
		if (defined(reservations[middle]).coordinate < coordinate) start = middle + 1;
		else end = middle;
	}
	return start;
}

/** Insertion index of a column no held passage of an overlapping layer span comes within a rail of. */
export function freeColumnIndex(
	reservations: readonly PassageReservation[],
	[targetLayer, sourceLayer]: LayerSpan,
	coordinate: number,
): number | undefined {
	const index = insertionIndex(reservations, coordinate);
	for (let before = index - 1; before >= 0; before -= 1) {
		const held = defined(reservations[before]);
		if (coordinate - held.coordinate >= RAIL_SPACING) break;
		if (held.targetLayer < sourceLayer && targetLayer < held.sourceLayer) return undefined;
	}
	for (let after = index; after < reservations.length; after += 1) {
		const held = defined(reservations[after]);
		if (held.coordinate - coordinate >= RAIL_SPACING) break;
		if (held.targetLayer < sourceLayer && targetLayer < held.sourceLayer) return undefined;
	}
	return index;
}

/**
 * Hold the first column from `start` outward that no held passage of an overlapping span comes
 * within a rail of, so that no later passage runs along it either.
 */
export function holdOuterColumn(
	reservations: PassageReservation[],
	relation: LogicRelation,
	ends: PassageEnds,
	start: number,
): number {
	let coordinate = start;
	let index = freeColumnIndex(reservations, ends.layerSpan, coordinate);
	while (index === undefined) {
		coordinate += RAIL_SPACING;
		index = freeColumnIndex(reservations, ends.layerSpan, coordinate);
	}
	const [targetLayer, sourceLayer] = ends.layerSpan;
	reservations.splice(index, 0, {
		coordinate,
		sourceLayer,
		targetLayer,
		sourceId: relation.from,
		targetId: relation.to,
		sourceCoordinate: ends.sourceCoordinate,
		targetCoordinate: ends.targetCoordinate,
	});
	return coordinate;
}
