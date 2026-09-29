import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { EffectiveSemanticRelation } from '../../graph/create-graph';
import type { LayoutStructure } from '../structure/prepare-layout';
import { countRankOrderCrossings, type RankOrder, type RankOrderRelation } from './rank-order';
import { applyRankOrder, type RankOrderDomain } from './rank-ordering';

interface LayeredRelation {
	readonly from: string;
	readonly to: string;
	readonly fromRank: number;
	readonly toRank: number;
	readonly intermediate: readonly { readonly rank: number; readonly id: string }[];
}

/** Ordinary then junction ids of every component row, components one after the other. */
function topologyRows(structure: LayoutStructure): string[][] {
	const rows: string[][] = [];
	for (const component of structure.components)
		for (const [rank, ordinary] of component.rows.ordinary.entries())
			rows.push([...ordinary, ...defined(component.rows.junction[rank])]);
	return rows;
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

interface PassagePosition {
	readonly x: number;
	/** Between equal positions, a source nearer the passage side nests inside. */
	readonly tie: number;
}

/**
 * Routing gives a long relation one straight passage beside the rows it skips, on the side
 * nearer to both endpoints. Longer passages nest outside shorter ones, then a relation farther
 * from that side nests outside a nearer one. Interpolating through the skipped rows would
 * miss the crossings of its two end jogs.
 */
function passagePosition(sourceX: number, targetX: number, span: number): PassagePosition {
	const average = (sourceX + targetX) / 2;
	if (average < 0.5) return { x: -(span + average), tie: -sourceX };
	return { x: 1 + span + (1 - average), tie: 1 - sourceX };
}

/**
 * Normalized transverse positions by row ordinal. A junction rail is centered on its ordinary
 * children, so it takes their mean position rather than the end of its row.
 */
function transversePositions(
	structure: LayoutStructure,
	rows: readonly (readonly string[])[],
): ReadonlyMap<string, number> {
	const positions = new Map<string, number>();
	for (const row of rows)
		for (const [ordinal, id] of row.entries()) positions.set(id, (ordinal + 1) / (row.length + 1));
	for (const [id, junction] of structure.junctions) {
		const children = junction.neighbors.filter((child) => positions.has(child));
		if (children.length === 0 || !positions.has(id)) continue;
		const sum = children.reduce((total, child) => total + defined(positions.get(child)), 0);
		positions.set(id, sum / children.length);
	}
	return positions;
}

interface RowEntry {
	readonly id: string;
	readonly x: number;
	readonly tie: number;
}

function compareRowEntries(left: RowEntry, right: RowEntry): number {
	const byPosition = left.x - right.x || left.tie - right.tie;
	return byPosition || compareCanonicalStrings(left.id, right.id);
}

/** Topology only: physical node widths, packing and rail coordinates never enter this oracle. */
export class RankTopologyOracle {
	private readonly domain: RankOrderDomain;
	private readonly relations: readonly LayeredRelation[];
	private readonly segments: readonly RankOrderRelation[];

	constructor(structure: LayoutStructure, domain: RankOrderDomain) {
		const endpointRanks = new Map<string, number>();
		for (const [rank, ids] of topologyRows(structure).entries())
			for (const id of ids) endpointRanks.set(id, rank);
		const { relations, segments } = layeredSegments(
			structure.graph.effectiveRelations,
			endpointRanks,
		);
		this.domain = domain;
		this.relations = relations;
		this.segments = segments;
	}

	count(structure: LayoutStructure, order: RankOrder, maximum = Number.POSITIVE_INFINITY): number {
		const rows = topologyRows(applyRankOrder(structure, this.domain, order));
		const positions = transversePositions(structure, rows);
		const dummies = rows.map((): RowEntry[] => []);
		for (const relation of this.relations) {
			const sourceX = defined(positions.get(relation.from));
			const targetX = defined(positions.get(relation.to));
			const { x, tie } = passagePosition(sourceX, targetX, relation.intermediate.length);
			for (const { rank, id } of relation.intermediate) defined(dummies[rank]).push({ id, x, tie });
		}
		const augmented = rows.map((row, rank) => {
			const fixed = row.map((id) => ({ id, x: defined(positions.get(id)), tie: 0 }));
			return [...fixed, ...defined(dummies[rank])].sort(compareRowEntries).map(({ id }) => id);
		});
		return countRankOrderCrossings(augmented, this.segments, maximum);
	}
}
