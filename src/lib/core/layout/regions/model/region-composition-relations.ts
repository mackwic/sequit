import { compareCanonicalStrings } from '../../../canonical-string';
import type { LogicRelation } from '../../../document/logic-document';
import type { LogicGraph } from '../../../graph/create-graph';
import type { RegionCompositionNode } from './region-composition-tree';

export enum RegionRelationKind {
	Local = 'local',
	Crossing = 'crossing',
}

export interface RegionRelationOwnership {
	readonly relation: LogicRelation;
	readonly sourceLeafId: string;
	readonly targetLeafId: string;
	readonly ownerId: string;
	readonly kind: RegionRelationKind;
	/** Each path starts at its leaf and stops before the common owner. */
	readonly sourcePathToOwner: readonly string[];
	readonly targetPathToOwner: readonly string[];
}

function parentOf(
	region: RegionCompositionNode,
	regionsById: ReadonlyMap<string, RegionCompositionNode>,
): RegionCompositionNode | undefined {
	if (region.parentId === undefined) return undefined;
	return regionsById.get(region.parentId);
}

function leastCommonAncestor(
	sourceId: string,
	targetId: string,
	regionsById: ReadonlyMap<string, RegionCompositionNode>,
): string {
	let source = regionsById.get(sourceId);
	let target = regionsById.get(targetId);
	while (source !== undefined && target !== undefined) {
		if (source.depth <= target.depth) break;
		source = parentOf(source, regionsById);
	}
	while (source !== undefined && target !== undefined) {
		if (target.depth <= source.depth) break;
		target = parentOf(target, regionsById);
	}
	while (source !== undefined && target !== undefined) {
		if (source.id === target.id) break;
		source = parentOf(source, regionsById);
		target = parentOf(target, regionsById);
	}
	if (source === undefined || target === undefined) throw new Error('Unvalidated region ancestry.');
	return source.id;
}

function pathToOwner(
	leafId: string,
	ownerId: string,
	regionsById: ReadonlyMap<string, RegionCompositionNode>,
): readonly string[] {
	const path: string[] = [];
	let current = regionsById.get(leafId);
	while (current !== undefined && current.id !== ownerId) {
		path.push(current.id);
		current = parentOf(current, regionsById);
	}
	if (current === undefined) throw new Error('Owner is not an ancestor of its endpoint.');
	return path;
}

export function relationOwnership(
	graph: LogicGraph,
	leafByEndpointId: ReadonlyMap<string, string>,
	regionsById: ReadonlyMap<string, RegionCompositionNode>,
): readonly RegionRelationOwnership[] {
	return [...graph.relations]
		.sort((left, right) => compareCanonicalStrings(left.relation.id, right.relation.id))
		.map(({ relation }) => {
			const sourceLeafId = leafByEndpointId.get(relation.from);
			const targetLeafId = leafByEndpointId.get(relation.to);
			if (sourceLeafId === undefined || targetLeafId === undefined)
				throw new Error('Relation has an unvalidated endpoint assignment.');
			const ownerId = leastCommonAncestor(sourceLeafId, targetLeafId, regionsById);
			let kind = RegionRelationKind.Crossing;
			if (sourceLeafId === targetLeafId) kind = RegionRelationKind.Local;
			return {
				relation,
				sourceLeafId,
				targetLeafId,
				ownerId,
				kind,
				sourcePathToOwner: pathToOwner(sourceLeafId, ownerId, regionsById),
				targetPathToOwner: pathToOwner(targetLeafId, ownerId, regionsById),
			};
		});
}

export function partitionRelations(
	regionIds: readonly string[],
	relations: readonly RegionRelationOwnership[],
): {
	readonly local: ReadonlyMap<string, readonly LogicRelation[]>;
	readonly crossing: ReadonlyMap<string, readonly LogicRelation[]>;
} {
	const local = new Map(regionIds.map((id) => [id, [] as LogicRelation[]]));
	const crossing = new Map(regionIds.map((id) => [id, [] as LogicRelation[]]));
	for (const owned of relations) {
		let partition = crossing;
		if (owned.kind === RegionRelationKind.Local) partition = local;
		const bucket = partition.get(owned.ownerId);
		if (bucket === undefined) throw new Error('Unvalidated relation owner.');
		bucket.push(owned.relation);
	}
	return { local, crossing };
}
