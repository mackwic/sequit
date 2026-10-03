import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import {
	defined,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import {
	RegionCompositionStatus,
	type RegionLayoutSelected,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { solveNestedRegionLayoutForProjection } from '../../../../src/lib/core/layout/regions/recursive/nested-region-layout';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { nestedRegionInput, regionDocument } from './nested-region-fixture';

function geometry(document: LogicDocument, originalIdByCurrent: ReadonlyMap<string, string>) {
	const sizesByNode = Object.fromEntries(
		document.nodes.map(({ id }) => [id, { width: 80.25, height: 40.5 }]),
	);
	const prepared = prepareLayoutDocument(document, { nodes: sizesByNode });
	const attempt = solveNestedRegionLayoutForProjection(
		prepared.graph,
		prepared.measurements,
		nestedRegionInput(),
		{ cache: new RegionLocalLayoutCache() },
	);
	if (attempt.status !== RegionCompositionStatus.Selected)
		throw new Error(`Expected selected nested layout: ${attempt.status}`);
	return normalizeGeometry(attempt, originalIdByCurrent);
}

function normalizeGeometry(
	attempt: RegionLayoutSelected,
	originalIdByCurrent: ReadonlyMap<string, string>,
): unknown {
	const originalId = (id: string) => originalIdByCurrent.get(id) ?? id;
	const relations = attempt.layout.relations
		.map(({ id, ...route }) => ({ ...route, id: originalId(id) }))
		.sort((left, right) => compareCanonicalStrings(left.id, right.id));
	const portals = attempt.portals
		.map((portal) => ({ ...portal, relationId: originalId(portal.relationId) }))
		.sort(
			(left, right) =>
				compareCanonicalStrings(left.relationId, right.relationId) ||
				compareCanonicalStrings(left.regionId, right.regionId) ||
				compareCanonicalStrings(left.endpointId, right.endpointId),
		);
	const regions = attempt.regions
		.map(({ localLayout, ...region }) => ({
			...region,
			localLayout: {
				...localLayout,
				relations: localLayout.relations
					.map(({ id, ...route }) => ({ ...route, id: originalId(id) }))
					.sort((left, right) => compareCanonicalStrings(left.id, right.id)),
			},
		}))
		.sort((left, right) => compareCanonicalStrings(left.id, right.id));
	const ownedRoutes = attempt.ownedRoutes
		.map((route) => ({ ...route, relationId: originalId(route.relationId) }))
		.sort(
			(left, right) =>
				compareCanonicalStrings(left.relationId, right.relationId) ||
				compareCanonicalStrings(left.regionId, right.regionId),
		);
	return {
		width: attempt.layout.width,
		height: attempt.layout.height,
		elements: attempt.layout.elements,
		relations,
		regions,
		portals,
		ownedRoutes,
	};
}

describe('nested region relation order', () => {
	it('keeps leaf ports and routes fixed when ids are permuted across local and crossing links', () => {
		const source = regionDocument();
		const document = {
			...source,
			layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
			relations: [
				{ id: 'inside-first', from: 'a-source', to: 'a-target' },
				{ id: 'across-tree', from: 'a-target', to: 'c' },
				{ id: 'across-tree-extra', from: 'a-source', to: 'c' },
			],
		};
		const renamedIdByOriginal = new Map([
			['inside-first', 'across-tree'],
			['across-tree', 'inside-first'],
			['across-tree-extra', 'across-tree-extra'],
		]);
		const originalIdByRenamed = new Map([
			['across-tree', 'inside-first'],
			['inside-first', 'across-tree'],
			['across-tree-extra', 'across-tree-extra'],
		]);
		const renamed = {
			...document,
			relations: document.relations.map((relation) => ({
				...relation,
				id: defined(renamedIdByOriginal.get(relation.id)),
			})),
		};
		const originalIds = new Map(document.relations.map(({ id }) => [id, id]));
		expect(geometry(renamed, originalIdByRenamed)).toEqual(geometry(document, originalIds));
	});
});
