import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import {
	corridorCarriesCanonicalIndexes,
	type CorridorLink,
	relationPositions,
	type RoutingCorridor,
} from './routing-corridors';

/**
 * Port offsets stored by relation index for a graph whose relation ids are unique. Routing reads
 * them by index; the map view in assignment order is built only when iteration is requested.
 */
export class RelationPortOffsets implements ReadonlyMap<string, number> {
	readonly #graph: LogicGraph;
	readonly #values: Float64Array;
	readonly #order: number[] = [];
	#map: Map<string, number> | undefined;
	#positions: ReadonlyMap<string, number> | undefined;
	#read = false;

	constructor(graph: LogicGraph) {
		this.#graph = graph;
		this.#values = new Float64Array(graph.relations.length).fill(Number.NaN);
	}

	/** Whether these offsets are addressed by the relation indices of `graph`. */
	indexes(graph: LogicGraph): boolean {
		return this.#graph === graph;
	}

	/** Whether `corridor` carries relation indices of the graph these offsets are addressed by. */
	indexesCorridor(corridor: RoutingCorridor): boolean {
		return corridorCarriesCanonicalIndexes(corridor, this.#graph);
	}

	assign(relationIndex: number, offset: number): void {
		if (this.#read) throw new Error('Port offsets are read-only once they have been read.');
		if (Number.isNaN(defined(this.#values[relationIndex]))) this.#order.push(relationIndex);
		this.#values[relationIndex] = offset;
	}

	at(relationIndex: number): number | undefined {
		this.#read = true;
		const offset = this.#values[relationIndex];
		if (offset === undefined || Number.isNaN(offset)) return undefined;
		return offset;
	}

	get(relationId: string): number | undefined {
		this.#read = true;
		const positions = (this.#positions ??= relationPositions(this.#graph));
		const index = positions.get(relationId);
		if (index === undefined) return undefined;
		return this.at(index);
	}

	has(relationId: string): boolean {
		return this.get(relationId) !== undefined;
	}

	get size(): number {
		return this.#order.length;
	}

	#view(): Map<string, number> {
		this.#read = true;
		if (this.#map !== undefined) return this.#map;
		const map = new Map<string, number>();
		for (const index of this.#order)
			map.set(defined(this.#graph.relations[index]).relation.id, defined(this.#values[index]));
		this.#map = map;
		return map;
	}

	entries(): MapIterator<[string, number]> {
		return this.#view().entries();
	}

	keys(): MapIterator<string> {
		return this.#view().keys();
	}

	values(): MapIterator<number> {
		return this.#view().values();
	}

	forEach(
		callback: (value: number, key: string, map: ReadonlyMap<string, number>) => void,
		thisArg?: unknown,
	): void {
		for (const [key, value] of this.#view()) callback.call(thisArg, value, key, this);
	}

	[Symbol.iterator](): MapIterator<[string, number]> {
		return this.entries();
	}
}

/** The offset of `graph`'s relation at `index`, read by index when these offsets index `graph`. */
export function relationPortOffset(
	offsets: ReadonlyMap<string, number> | undefined,
	graph: LogicGraph,
	index: number,
): number | undefined {
	if (offsets instanceof RelationPortOffsets && offsets.indexes(graph)) return offsets.at(index);
	return offsets?.get(defined(graph.relations[index]).relation.id);
}

/** Offsets being assigned: by relation index when every link indexes the graph, else by id. */
export type PortOffsetsBuilder = Map<string, number> | RelationPortOffsets;

export function assignPortOffset(
	offsets: PortOffsetsBuilder,
	link: CorridorLink,
	offset: number,
): void {
	if (offsets instanceof RelationPortOffsets) offsets.assign(defined(link.relationIndex), offset);
	else offsets.set(link.relation.id, offset);
}
