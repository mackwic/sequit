import { describe, expect, it } from 'vitest';

import { defined, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { gridRoutingEdges } from '../../../../src/lib/core/layout/grids/grid-cell-crossing';
import { gridCellInheritedIncidentPaths } from '../../../../src/lib/core/layout/grids/grid-cell-inherited-incident';
import {
	GridCellLayoutStatus,
	type GridCellPlacement,
	type GridCellSelected,
} from '../../../../src/lib/core/layout/grids/grid-cell-types';
import type {
	RegionIncidentPath,
	SolvedRecursiveRegion,
} from '../../../../src/lib/core/layout/regions/composition/nested-region-recursive-geometry';
import type { RecursiveContext } from '../../../../src/lib/core/layout/regions/composition/nested-region-recursive-model-adapter';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { incidentEndpointPositions } from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { persistedNestedGridWithTwoOuterIncidentsDocument } from './nested-region-fixture';

const EMPTY_LAYOUT = { width: 160, height: 160, elements: [], relations: [] };
const EMPTY_RANKS = { byEndpointId: new Map<string, number>(), bands: [] };

function selectedGrid(): GridCellSelected {
	const positions = [
		{ id: 'a', row: 0, column: 0 },
		{ id: 'b', row: 0, column: 1 },
		{ id: 'c', row: 1, column: 0 },
		{ id: 'd', row: 1, column: 1 },
	] as const;
	const cells: GridCellPlacement[] = positions.map(({ id, row, column }) => {
		const x = 100 + column * 400;
		const y = 100 + row * 400;
		return {
			id,
			parentId: 'grid',
			row,
			column,
			bounds: { x, y, width: 200, height: 200 },
			translation: { x: x + 20, y: y + 20 },
			localLayout: EMPTY_LAYOUT,
			localRanks: EMPTY_RANKS,
		};
	});
	return {
		status: GridCellLayoutStatus.Selected,
		rootId: 'grid',
		layout: { width: 800, height: 800, elements: [], relations: [] },
		portals: [],
		cells,
		columnWidths: [200, 200],
		rowHeights: [200, 200],
	};
}

function contextFor(document: LogicDocument): RecursiveContext {
	const prepared = prepareLayoutDocument(document);
	const normalized = normalizeRegionCompositionModel(
		prepared.graph,
		nestedRegionInput(prepared.graph),
	);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error('Expected a normalized grid source.');
	return {
		graph: prepared.graph,
		model: normalized.model,
		measurements: prepared.measurements,
		cache: undefined,
		endpointPositions: incidentEndpointPositions(prepared.graph.document),
		ownershipByRelationId: new Map(
			normalized.model.relations.map((owned) => [owned.relation.id, owned]),
		),
	};
}

function childIncident(
	relationId: string,
	childId: string,
	endpointId: string,
): SolvedRecursiveRegion {
	const point = { x: 80, y: 0 };
	const portal = {
		relationId,
		endpointId,
		regionId: childId,
		side: RegionPortalSide.Top,
		point,
		localPoint: point,
	};
	const path: RegionIncidentPath = {
		relationId,
		endpointId,
		pieces: [{ relationId, regionId: childId, points: [{ x: 80, y: 40 }, point] }],
		portals: [portal],
	};
	return {
		layout: EMPTY_LAYOUT,
		ranks: EMPTY_RANKS,
		regions: [],
		portals: [portal],
		ownedRoutes: path.pieces,
		incidentPaths: new Map([[relationId, path]]),
	};
}

function inheritedPaths(
	document: LogicDocument,
	leftRelationId: string,
	rightRelationId: string,
): ReadonlyMap<string, RegionIncidentPath> {
	const selected = selectedGrid();
	return gridCellInheritedIncidentPaths({
		context: contextFor(document),
		regionId: 'grid',
		incidentSides: new Map([
			[leftRelationId, [RegionPortalSide.Top]],
			[rightRelationId, [RegionPortalSide.Top]],
		]),
		selected,
		edges: gridRoutingEdges(
			'grid',
			selected.columnWidths.map(() => []),
			0,
		),
		children: new Map([
			['a', childIncident(leftRelationId, 'a', 'a-target')],
			['b', childIncident(rightRelationId, 'b', 'b')],
		]),
	});
}

function inheritedGeometry(
	paths: ReadonlyMap<string, RegionIncidentPath>,
	originalIdByCurrent: ReadonlyMap<string, string>,
): readonly unknown[] {
	return [...paths].map(([id, path]) => ({
		relationId: defined(originalIdByCurrent.get(id)),
		pieces: path.pieces.map(({ regionId, points }) => ({ regionId, points })),
		portals: path.portals.map(({ regionId, side, point }) => ({ regionId, side, point })),
	}));
}

describe('inherited grid incident relation order', () => {
	it('preserves incident path geometry and order when relation ids change', () => {
		const original = persistedNestedGridWithTwoOuterIncidentsDocument();
		const renamed = {
			...original,
			relations: original.relations.map((relation) => {
				if (relation.id === 'z-left-exit') return { ...relation, id: 'a-left-exit' };
				if (relation.id === 'a-right-exit') return { ...relation, id: 'z-right-exit' };
				return relation;
			}),
		};
		const originalIdentity = new Map([
			['z-left-exit', 'z-left-exit'],
			['a-right-exit', 'a-right-exit'],
		]);
		const originalIdsByCurrent = new Map([
			['a-left-exit', 'z-left-exit'],
			['z-right-exit', 'a-right-exit'],
		]);
		const originalPaths = inheritedPaths(original, 'z-left-exit', 'a-right-exit');
		const renamedPaths = inheritedPaths(renamed, 'a-left-exit', 'z-right-exit');
		expect(inheritedGeometry(originalPaths, originalIdentity)).toEqual(
			inheritedGeometry(renamedPaths, originalIdsByCurrent),
		);
	});
});
