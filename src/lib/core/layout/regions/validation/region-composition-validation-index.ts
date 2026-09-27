import type { LayoutResult } from '../../layout-types';
import type { RegionCompositionWork } from '../model/region-composition-limits';
import type { RegionCompositionModel } from '../model/region-composition-model';
import { RegionWorkPhase } from '../model/region-composition-types';
import type { RegionCompositionGeometryCandidate } from './region-composition-validation-types';

export interface GroupMember {
	readonly endpointId: string;
	readonly groupId: string;
}

type LayoutLane = NonNullable<LayoutResult['lanes']>[number];

export interface LeafValidationIndex {
	readonly endpointIdsByLeaf: ReadonlyMap<string, readonly string[]>;
	readonly groupMembersByLeaf: ReadonlyMap<string, readonly GroupMember[]>;
	readonly lanesByLeaf: ReadonlyMap<string, readonly LayoutLane[]>;
	readonly publishedLanes: readonly LayoutLane[];
}

/** Index each owner once instead of rescanning the entire scene for every leaf. */
export function indexLeafValidation(
	model: RegionCompositionModel,
	candidate: RegionCompositionGeometryCandidate,
	work?: RegionCompositionWork,
): LeafValidationIndex {
	const endpointIdsByLeaf = new Map<string, string[]>();
	for (const [endpointId, leafId] of model.leafByEndpointId) {
		work?.charge(RegionWorkPhase.Traversals, endpointId);
		let ids = endpointIdsByLeaf.get(leafId);
		if (ids === undefined) {
			ids = [];
			endpointIdsByLeaf.set(leafId, ids);
		}
		ids.push(endpointId);
	}
	const groupMembersByLeaf = new Map<string, GroupMember[]>();
	for (const [endpointId, groupId] of model.parentGroupByEndpointId) {
		work?.charge(RegionWorkPhase.Traversals, endpointId);
		const leafId = model.leafByEndpointId.get(endpointId);
		if (leafId === undefined) continue;
		let members = groupMembersByLeaf.get(leafId);
		if (members === undefined) {
			members = [];
			groupMembersByLeaf.set(leafId, members);
		}
		members.push({ endpointId, groupId });
	}
	const publishedLanes = candidate.layout.lanes ?? [];
	const lanesByLeaf = new Map<string, LayoutLane[]>();
	for (const lane of publishedLanes) {
		work?.charge(RegionWorkPhase.Traversals, lane.id);
		if (lane.regionId === undefined) continue;
		let owned = lanesByLeaf.get(lane.regionId);
		if (owned === undefined) {
			owned = [];
			lanesByLeaf.set(lane.regionId, owned);
		}
		owned.push(lane);
	}
	return { endpointIdsByLeaf, groupMembersByLeaf, lanesByLeaf, publishedLanes };
}
