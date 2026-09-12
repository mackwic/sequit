import { defined } from '../../document/logic-document';
import type { RoutingLayers } from '../layout-types';
import type { LayoutStructure } from './prepare-layout';

/** Expand routing layers only, never the graph's logical ranks or ordinary placement rows. */
export function routingLayers(structure: LayoutStructure): RoutingLayers {
	const rows: string[][] = [];
	const intervals: number[] = [];
	const ordinary = Array.from({ length: structure.maximumRank + 1 }, () => [] as string[]);
	const junctions = Array.from({ length: structure.maximumRank + 1 }, () => [] as string[][]);
	for (const id of structure.graph.rankableEndpointIds) {
		if (structure.junctionIds.has(id)) continue;
		defined(ordinary[defined(structure.ranks.byEndpointId.get(id))]).push(id);
	}
	for (const [id, junction] of structure.junctions) {
		const layers = defined(junctions[junction.interval]);
		const row = layers[junction.depth] ?? [];
		row.push(id);
		layers[junction.depth] = row;
	}
	for (let rank = 0; rank <= structure.maximumRank; rank += 1) {
		rows.push(defined(ordinary[rank]));
		intervals.push(rank);
		for (const row of defined(junctions[rank])) {
			rows.push(row);
			intervals.push(rank);
		}
	}
	return {
		rows,
		intervals,
		byId: new Map(rows.flatMap((row, rank) => row.map((id) => [id, rank] as const))),
	};
}
