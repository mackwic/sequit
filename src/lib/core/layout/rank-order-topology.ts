import { compareCanonicalStrings } from '../canonical-string';
import { defined, EndpointKind } from '../document/logic-document';
import type { EffectiveSemanticRelation } from '../graph/create-graph';
import { countRankOrderCrossings, type RankOrder, type RankOrderRelation } from './rank-order';
import type { RankOrderDomain } from './rank-ordering';
import type { LayoutStructure } from './structure/prepare-layout';

interface OrderedEndpoint {
	readonly id: string;
	readonly rank: number;
	readonly ordinal: number;
	readonly rowSize: number;
}

interface LayeredRelation {
	readonly from: string;
	readonly to: string;
	readonly fromRank: number;
	readonly toRank: number;
	readonly intermediate: readonly { readonly rank: number; readonly id: string }[];
}

function topologyRows(structure: LayoutStructure, domain: RankOrderDomain) {
	const rows: string[][] = [];
	const endpointRanks = new Map<string, number>();
	const movable = new Map<number, number>();
	for (const component of structure.components) {
		const offset = rows.length;
		for (const [rank, ordinary] of component.rows.ordinary.entries()) {
			const junction = defined(component.rows.junction[rank]);
			const ids = [...ordinary, ...junction];
			rows.push(ids);
			for (const id of ids) endpointRanks.set(id, offset + rank);
		}
	}
	let offset = 0;
	for (const [componentIndex, component] of structure.components.entries()) {
		for (const [bandIndex, location] of domain.locations.entries())
			if (location.componentIndex === componentIndex)
				movable.set(offset + location.rank, bandIndex);
		offset += component.rows.ordinary.length;
	}
	return { rows, endpointRanks, movable };
}

function appendSegments(
	relationId: string,
	sourceId: string,
	targetId: string,
	context: {
		readonly endpointRanks: ReadonlyMap<string, number>;
		readonly relations: LayeredRelation[];
		readonly segments: RankOrderRelation[];
	},
): void {
	const { endpointRanks, relations, segments } = context;
	const fromRank = defined(endpointRanks.get(sourceId));
	const toRank = defined(endpointRanks.get(targetId));
	if (fromRank === toRank) return;
	const intermediate: { rank: number; id: string }[] = [];
	const direction = Math.sign(toRank - fromRank);
	let previous = sourceId;
	for (let rank = fromRank + direction; rank !== toRank; rank += direction) {
		const id = `${relationId}/${sourceId}/${targetId}/${rank}`;
		intermediate.push({ rank, id });
		segments.push({ from: previous, to: id });
		previous = id;
	}
	segments.push({ from: previous, to: targetId });
	relations.push({ from: sourceId, to: targetId, fromRank, toRank, intermediate });
}

function layeredSegments(
	effectiveRelations: readonly EffectiveSemanticRelation[],
	endpointRanks: ReadonlyMap<string, number>,
) {
	const relations: LayeredRelation[] = [];
	const segments: RankOrderRelation[] = [];
	const context = { endpointRanks, relations, segments };
	for (const effective of effectiveRelations)
		for (const sourceId of effective.sourceIds)
			for (const targetId of effective.targetIds)
				appendSegments(effective.relationId, sourceId, targetId, context);
	return { relations, segments };
}

/** Topology only: physical node widths, packing and rail coordinates never enter this oracle. */
export class RankTopologyOracle {
	private readonly rows: readonly (readonly string[])[];
	private readonly movable: ReadonlyMap<number, number>;
	private readonly relations: readonly LayeredRelation[];
	private readonly segments: readonly RankOrderRelation[];

	constructor(structure: LayoutStructure, domain: RankOrderDomain) {
		const { rows, endpointRanks, movable } = topologyRows(structure, domain);
		const { relations, segments } = layeredSegments(
			structure.graph.effectiveRelations,
			endpointRanks,
		);
		this.rows = rows;
		this.movable = movable;
		this.relations = relations;
		this.segments = segments;
	}

	count(structure: LayoutStructure, order: RankOrder, maximum = Number.POSITIVE_INFINITY): number {
		const rows = this.rows.map((row, rank) => {
			const bandIndex = this.movable.get(rank);
			if (bandIndex === undefined) return [...row];
			let ordinaryIndex = 0;
			return row.map((id) => {
				if (structure.graph.endpointsById.get(id)?.entity.kind !== EndpointKind.Node) return id;
				const chosen = defined(order[bandIndex])[ordinaryIndex];
				ordinaryIndex += 1;
				return defined(chosen);
			});
		});
		const positions = new Map<string, OrderedEndpoint>();
		for (const [rank, row] of rows.entries())
			for (const [ordinal, id] of row.entries())
				positions.set(id, { id, rank, ordinal, rowSize: row.length });
		const dummies = rows.map(() => [] as { readonly id: string; readonly x: number }[]);
		for (const relation of this.relations) {
			const source = defined(positions.get(relation.from));
			const target = defined(positions.get(relation.to));
			const sourceX = (source.ordinal + 1) / (source.rowSize + 1);
			const targetX = (target.ordinal + 1) / (target.rowSize + 1);
			for (const { rank, id } of relation.intermediate) {
				const progress = (rank - relation.fromRank) / (relation.toRank - relation.fromRank);
				defined(dummies[rank]).push({ id, x: sourceX + (targetX - sourceX) * progress });
			}
		}
		const augmented = rows.map((row, rank) => {
			const fixed = row.map((id, ordinal) => ({ id, x: (ordinal + 1) / (row.length + 1) }));
			return [...fixed, ...defined(dummies[rank])]
				.sort((left, right) => left.x - right.x || compareCanonicalStrings(left.id, right.id))
				.map(({ id }) => id);
		});
		return countRankOrderCrossings(augmented, this.segments, maximum);
	}
}
