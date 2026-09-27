import { defined } from '../../../document/logic-document';
import { finiteBounds, inside } from '../../geometry/nested-region-geometry-primitives';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic as diagnostic,
	RegionGeometryDiagnosticCode as Code,
} from '../../geometry/region-geometry-diagnostic';
import type { Bounds, LayoutResult, Point } from '../../layout-types';
import type { RegionCompositionModel } from '../model/region-composition-model';
import type { LeafValidationIndex } from './region-composition-validation-index';
import type { RegionGeometryPlacement } from './region-composition-validation-types';

export function translatedBoundsMatch(local: Bounds, global: Bounds, translation: Point): boolean {
	if (global.x !== local.x + translation.x) return false;
	if (global.y !== local.y + translation.y) return false;
	if (global.width !== local.width) return false;
	return global.height === local.height;
}

function lanePlacementFailure(
	regionId: string,
	local: NonNullable<LayoutResult['lanes']>[number],
	global: NonNullable<LayoutResult['lanes']>[number],
	placement: RegionGeometryPlacement,
): RegionGeometryDiagnostic | undefined {
	const correctOwner = local.regionId === regionId;
	const sameIdentity = global.id === local.id && global.label === local.label;
	if (!correctOwner || !sameIdentity)
		return diagnostic(Code.LaneIdentityMismatch, `Lane ${local.id} differs from its leaf layout.`, {
			regionId,
			laneId: local.id,
		});
	if (!finiteBounds(global.bounds) || !inside(placement.bounds, global.bounds))
		return diagnostic(
			Code.LaneOutsideLeaf,
			`Lane ${local.id} leaves its leaf region ${regionId}.`,
			{
				regionId,
				laneId: local.id,
			},
		);
	if (
		placement.translation === undefined ||
		!translatedBoundsMatch(local.bounds, global.bounds, placement.translation)
	)
		return diagnostic(
			Code.TranslatedLaneMismatch,
			`Lane ${local.id} differs from its translated leaf layout.`,
			{ regionId, laneId: local.id },
		);
	return undefined;
}

export function leafLaneGeometryFailure(
	model: RegionCompositionModel,
	placements: ReadonlyMap<string, RegionGeometryPlacement>,
	index: LeafValidationIndex,
): RegionGeometryDiagnostic | undefined {
	const published = index.publishedLanes;
	let expectedCount = 0;
	for (const region of model.regionsById.values()) {
		if (region.childIds.length > 0 || region.id === model.rootId) continue;
		const placement = defined(placements.get(region.id));
		const local = placement.localLayout?.lanes ?? [];
		const owned = index.lanesByLeaf.get(region.id) ?? [];
		expectedCount += local.length;
		if (owned.length !== local.length)
			return diagnostic(
				Code.LeafLaneInventory,
				`Leaf region ${region.id} does not publish each local lane exactly once.`,
				{ regionId: region.id },
			);
		for (const [index, lane] of local.entries()) {
			const global = defined(owned[index]);
			const failure = lanePlacementFailure(region.id, lane, global, placement);
			if (failure !== undefined) return failure;
		}
	}
	if (published.length !== expectedCount)
		return diagnostic(
			Code.GlobalLaneInventory,
			'The composed canvas has an unknown or duplicate lane.',
		);
	return undefined;
}
