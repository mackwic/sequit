import { defined } from '../document/logic-document';
import { finiteBounds, inside, overlaps } from './geometry/nested-region-geometry-primitives';
import type { LayoutElement } from './layout-types';
import type {
	RegionChildPlacement,
	RegionLayoutSelected,
} from './regions/model/region-composition-types';

function childCanvasFits(region: RegionChildPlacement): boolean {
	const { localLayout, translation, bounds } = region;
	if (!Number.isFinite(translation.x) || !Number.isFinite(translation.y)) return false;
	if (translation.x <= bounds.x || translation.y <= bounds.y) return false;
	const right = translation.x + localLayout.width;
	const bottom = translation.y + localLayout.height;
	if (right >= bounds.x + bounds.width) return false;
	return bottom < bounds.y + bounds.height;
}

function elementFits(
	region: RegionChildPlacement,
	local: LayoutElement,
	global: LayoutElement | undefined,
): boolean {
	if (global === undefined) return false;
	if (global.bounds.x !== local.bounds.x + region.translation.x) return false;
	if (global.bounds.y !== local.bounds.y + region.translation.y) return false;
	if (global.bounds.width !== local.bounds.width) return false;
	if (global.bounds.height !== local.bounds.height) return false;
	return inside(region.bounds, global.bounds);
}

function placementFailure(
	candidate: RegionLayoutSelected,
	region: RegionChildPlacement,
): string | undefined {
	const root = { x: 0, y: 0, width: candidate.layout.width, height: candidate.layout.height };
	if (!finiteBounds(region.bounds) || !inside(root, region.bounds))
		return `Child region ${region.id} is outside the root canvas.`;
	if (!childCanvasFits(region))
		return `Child region ${region.id} does not contain its local canvas.`;
	for (const local of region.localLayout.elements) {
		const global = candidate.layout.elements.find(({ id }) => id === local.id);
		if (!elementFits(region, local, global))
			return `Element ${local.id} is not confined to its owning child.`;
	}
	return undefined;
}

export function validateNestedPlacements(candidate: RegionLayoutSelected): string | undefined {
	const root = { x: 0, y: 0, width: candidate.layout.width, height: candidate.layout.height };
	if (!finiteBounds(root)) return 'The root canvas has invalid dimensions.';
	const elementIds = candidate.layout.elements.map(({ id }) => id);
	if (new Set(elementIds).size !== elementIds.length)
		return 'The composed canvas repeats an element identity.';
	const relationIds = candidate.layout.relations.map(({ id }) => id);
	if (new Set(relationIds).size !== relationIds.length)
		return 'The composed canvas repeats a relation identity.';
	for (const region of candidate.regions) {
		const failure = placementFailure(candidate, region);
		if (failure !== undefined) return failure;
	}
	for (let index = 0; index < candidate.regions.length; index += 1) {
		const left = defined(candidate.regions[index]);
		for (const right of candidate.regions.slice(index + 1)) {
			if (overlaps(left.bounds, right.bounds)) return 'Child region interiors overlap.';
		}
	}
	return undefined;
}
