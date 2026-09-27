import { defined } from '../../../document/logic-document';
import { type RouteBridgeCache, validatedBridgesCached } from '../../bridges/bridge-oracle';
import { finiteBounds, inside } from '../../geometry/nested-region-geometry-primitives';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic as diagnostic,
	RegionGeometryDiagnosticCode as Code,
} from '../../geometry/region-geometry-diagnostic';
import type { Bounds } from '../../layout-types';
import type { RegionCompositionWork } from '../model/region-composition-limits';
import type { RegionCompositionModel } from '../model/region-composition-model';
import { RegionWorkPhase } from '../model/region-composition-types';
import {
	diagnoseParentRouteContacts,
	validateLeafCompositionGeometry,
} from './region-composition-validation-detail';
import { type GeometryContext, relationFailure } from './region-composition-validation-routes';
import type {
	RegionCompositionGeometryCandidate,
	RegionGeometryPlacement,
} from './region-composition-validation-types';

export type { RegionCompositionGeometryCandidate } from './region-composition-validation-types';

function placementInventoryFailure(
	candidate: RegionCompositionGeometryCandidate,
	context: GeometryContext,
): RegionGeometryDiagnostic | undefined {
	if (candidate.rootId !== context.model.rootId)
		return diagnostic(Code.WrongRootRegion, 'The composed canvas has the wrong root region.', {
			regionId: candidate.rootId,
		});
	if (!finiteBounds(context.root))
		return diagnostic(Code.InvalidRootBounds, 'The root canvas has invalid dimensions.', {
			regionId: candidate.rootId,
		});
	if (candidate.regions.length !== context.model.preorderIds.length - 1)
		return diagnostic(
			Code.ChildRegionInventory,
			'The composed canvas does not contain each child region exactly once.',
		);
	if (context.placements.size !== candidate.regions.length)
		return diagnostic(
			Code.RepeatedChildRegion,
			'The composed canvas repeats a child region identity.',
		);
	for (const region of candidate.regions)
		if (!context.model.regionsById.has(region.id))
			return diagnostic(
				Code.UnknownChildRegion,
				`Child region ${region.id} is not in the region model.`,
				{
					regionId: region.id,
				},
			);
	return undefined;
}

function regionPlacementFailure(
	id: string,
	context: GeometryContext,
): RegionGeometryDiagnostic | undefined {
	const region = context.placements.get(id);
	const expected = context.model.regionsById.get(id);
	if (region === undefined || expected === undefined)
		return diagnostic(
			Code.MissingChildRegion,
			`Child region ${id} is missing from the composed canvas.`,
			{
				regionId: id,
			},
		);
	if (region.parentId !== expected.parentId)
		return diagnostic(Code.WrongChildParent, `Child region ${id} has the wrong parent.`, {
			regionId: id,
			relatedRegionId: region.parentId,
		});
	let parent: Bounds | undefined = context.root;
	if (region.parentId !== context.model.rootId)
		parent = context.placements.get(region.parentId)?.bounds;
	const invalidBounds = !finiteBounds(region.bounds);
	const outsideParent = parent !== undefined && !inside(parent, region.bounds);
	if (parent === undefined || invalidBounds || outsideParent)
		return diagnostic(Code.ChildOutsideParent, `Child region ${id} is outside its parent.`, {
			regionId: id,
			relatedRegionId: region.parentId,
		});
	return undefined;
}

interface IndexedSiblingSweepEvent {
	readonly x: number;
	readonly yStart: number;
	readonly yEnd: number;
	readonly starts: boolean;
	readonly siblingIndex: number;
}

function siblingsOverlap(
	siblings: readonly RegionGeometryPlacement[],
	parentId: string,
	work?: RegionCompositionWork,
): boolean {
	if (siblings.length < 2) return false;

	const yCoordinates: number[] = [];
	for (const sibling of siblings) {
		yCoordinates.push(sibling.bounds.y, sibling.bounds.y + sibling.bounds.height);
	}

	yCoordinates.sort((left, right) => {
		work?.charge(RegionWorkPhase.Comparisons, parentId);
		return left < right ? -1 : left > right ? 1 : 0;
	});
	const uniqueYCoordinates: number[] = [];
	for (const coordinate of yCoordinates) {
		const previous = uniqueYCoordinates[uniqueYCoordinates.length - 1];
		if (previous === undefined) {
			uniqueYCoordinates.push(coordinate);
			continue;
		}
		work?.charge(RegionWorkPhase.Comparisons, parentId);
		if (coordinate !== previous) uniqueYCoordinates.push(coordinate);
	}

	const coordinateIndexes = new Map<number, number>();
	for (let index = 0; index < uniqueYCoordinates.length; index += 1)
		coordinateIndexes.set(defined(uniqueYCoordinates[index]), index);
	const indexedEvents: IndexedSiblingSweepEvent[] = [];
	for (let siblingIndex = 0; siblingIndex < siblings.length; siblingIndex += 1) {
		const bounds = defined(siblings[siblingIndex]).bounds;
		const yStart = coordinateIndexes.get(bounds.y);
		const yEnd = coordinateIndexes.get(bounds.y + bounds.height);
		if (yStart === undefined || yEnd === undefined)
			throw new Error('A sibling sweep endpoint was not coordinate-compressed.');
		indexedEvents.push(
			{ x: bounds.x, yStart, yEnd, starts: true, siblingIndex },
			{ x: bounds.x + bounds.width, yStart, yEnd, starts: false, siblingIndex },
		);
	}
	indexedEvents.sort((left, right) => {
		work?.charge(RegionWorkPhase.Comparisons, parentId);
		if (left.x !== right.x) return left.x < right.x ? -1 : 1;
		if (left.starts !== right.starts) return left.starts ? 1 : -1;
		return left.siblingIndex - right.siblingIndex;
	});

	const intervalCount = uniqueYCoordinates.length - 1;
	const maximumCoverage = new Float64Array(intervalCount * 4);
	const lazyCoverage = new Float64Array(intervalCount * 4);
	const updateCoverage = (queryStart: number, queryEnd: number, delta: number): void => {
		const update = (node: number, start: number, end: number): void => {
			work?.charge(RegionWorkPhase.Comparisons, parentId);
			if (queryStart <= start && end <= queryEnd) {
				maximumCoverage[node] += delta;
				lazyCoverage[node] += delta;
				return;
			}
			const middle = Math.floor((start + end) / 2);
			if (queryStart < middle) update(node * 2, start, middle);
			if (queryEnd > middle) update(node * 2 + 1, middle, end);
			maximumCoverage[node] =
				lazyCoverage[node] +
				Math.max(maximumCoverage[node * 2], maximumCoverage[node * 2 + 1]);
		};
		update(1, 0, intervalCount);
	};
	const maximumInRange = (queryStart: number, queryEnd: number): number => {
		const query = (
			node: number,
			start: number,
			end: number,
			inheritedCoverage: number,
		): number => {
			work?.charge(RegionWorkPhase.Comparisons, parentId);
			if (queryStart <= start && end <= queryEnd)
				return inheritedCoverage + maximumCoverage[node];
			const childInheritedCoverage = inheritedCoverage + lazyCoverage[node];
			const middle = Math.floor((start + end) / 2);
			let maximum = Number.NEGATIVE_INFINITY;
			if (queryStart < middle)
				maximum = query(
					node * 2,
					start,
					middle,
					childInheritedCoverage,
				);
			if (queryEnd > middle)
				maximum = Math.max(
					maximum,
					query(
						node * 2 + 1,
						middle,
						end,
						childInheritedCoverage,
					),
				);
			return maximum;
		};
		return query(1, 0, intervalCount, 0);
	};

	for (const event of indexedEvents) {
		if (event.starts) {
			if (maximumInRange(event.yStart, event.yEnd) > 0) return true;
			updateCoverage(event.yStart, event.yEnd, 1);
		} else updateCoverage(event.yStart, event.yEnd, -1);
	}
	return false;
}

function siblingOverlapFailure(
	context: GeometryContext,
	work?: RegionCompositionWork,
): RegionGeometryDiagnostic | undefined {
	for (const parent of context.model.regionsById.values()) {
		const siblings = parent.childIds.map((id) => defined(context.placements.get(id)));
		if (siblingsOverlap(siblings, parent.id, work))
			return diagnostic(Code.OverlappingChildren, `Children of region ${parent.id} overlap.`, {
				regionId: parent.id,
			});
	}
	return undefined;
}

function placementFailure(
	candidate: RegionCompositionGeometryCandidate,
	context: GeometryContext,
	work?: RegionCompositionWork,
): RegionGeometryDiagnostic | undefined {
	const inventory = placementInventoryFailure(candidate, context);
	if (inventory !== undefined) return inventory;
	for (const id of context.model.preorderIds) {
		if (id === context.model.rootId) continue;
		work?.charge(RegionWorkPhase.Placements, id);
		const failure = regionPlacementFailure(id, context);
		if (failure !== undefined) return failure;
	}
	return siblingOverlapFailure(context, work);
}

/** Validate every boundary in the normalized leaf → LCA → leaf route chain. */
export function validateRegionCompositionGeometry(
	model: RegionCompositionModel,
	candidate: RegionCompositionGeometryCandidate,
	bridgeCache?: RouteBridgeCache,
	work?: RegionCompositionWork,
): RegionGeometryDiagnostic | undefined {
	const placements = new Map(candidate.regions.map((region) => [region.id, region]));
	const root = {
		x: 0,
		y: 0,
		width: candidate.layout.width,
		height: candidate.layout.height,
	};
	const context = { model, placements, root };
	const placement = placementFailure(candidate, context, work);
	if (placement !== undefined) return placement;
	const leafGeometry = validateLeafCompositionGeometry(model, candidate, placements);
	if (leafGeometry !== undefined) return leafGeometry;
	const relationIds = new Set(model.relations.map(({ relation }) => relation.id));
	if (
		candidate.layout.relations.length !== relationIds.size ||
		new Set(candidate.layout.relations.map(({ id }) => id)).size !== relationIds.size
	)
		return diagnostic(
			Code.RelationInventory,
			'The composed canvas does not contain each relation exactly once.',
		);
	if (candidate.layout.relations.some(({ id }) => !relationIds.has(id)))
		return diagnostic(Code.UnknownRelation, 'The composed canvas has an unknown relation.');
	if (candidate.ownedRoutes.some(({ relationId }) => !relationIds.has(relationId)))
		return diagnostic(Code.UnknownOwnedRouteRelation, 'An owned route has an unknown relation.');
	if (candidate.portals.some(({ relationId }) => !relationIds.has(relationId)))
		return diagnostic(Code.UnknownPortalRelation, 'A boundary portal has an unknown relation.');
	for (const owned of model.relations) {
		const failure = relationFailure(owned, candidate, context);
		if (failure !== undefined) return failure;
	}
	const bridges = validatedBridgesCached(candidate.layout.relations, bridgeCache);
	return diagnoseParentRouteContacts(
		model,
		candidate.ownedRoutes,
		candidate.layout.relations,
		bridges,
	);
}

/** Display adapter for callers that only need the established wording. */
export function validateRegionCompositionGeometryMessage(
	model: RegionCompositionModel,
	candidate: RegionCompositionGeometryCandidate,
): string | undefined {
	return validateRegionCompositionGeometry(model, candidate)?.message;
}
