import { describe, expect, it } from 'vitest';

import { defined, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { gridCellInheritedIncidentPaths } from '../../../../src/lib/core/layout/grid-cell-inherited-incident';
import { gridCellArrangement } from '../../../../src/lib/core/layout/grid-cell-recursive-region';
import {
	GridCellLayoutStatus,
	type GridCellPlacement,
	type GridCellSelected,
} from '../../../../src/lib/core/layout/grid-cell-types';
import type { Point } from '../../../../src/lib/core/layout/layout-types';
import type {
	RegionIncidentPath,
	SolvedRecursiveRegion,
} from '../../../../src/lib/core/layout/nested-region-recursive-geometry';
import type { RecursiveContext } from '../../../../src/lib/core/layout/nested-region-recursive-model-adapter';
import { NestedPortalSide } from '../../../../src/lib/core/layout/nested-region-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';
import { RegionIncidentRole } from '../../../../src/lib/core/layout/region-incident-contract';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { persistedNestedGridWithTwoOuterIncidentsDocument } from './nested-region-fixture';

const EMPTY_LAYOUT = { width: 160, height: 160, elements: [], relations: [] };
const EMPTY_RANKS = { byEndpointId: new Map<string, number>(), bands: [] };

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
		ownershipByRelationId: new Map(
			normalized.model.relations.map((owned) => [owned.relation.id, owned]),
		),
	};
}

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

function localPortal(side: NestedPortalSide): { readonly anchor: Point; readonly point: Point } {
	switch (side) {
		case NestedPortalSide.Top:
			return { anchor: { x: 80, y: 40 }, point: { x: 80, y: 0 } };
		case NestedPortalSide.Right:
			return { anchor: { x: 120, y: 80 }, point: { x: 160, y: 80 } };
		case NestedPortalSide.Bottom:
			return { anchor: { x: 80, y: 120 }, point: { x: 80, y: 160 } };
		case NestedPortalSide.Left:
			return { anchor: { x: 40, y: 80 }, point: { x: 0, y: 80 } };
		default:
			throw new Error('Unknown test portal side.');
	}
}

function childWithIncident(input: {
	readonly childId: string;
	readonly endpointId: string;
	readonly relationId: string;
	readonly side: NestedPortalSide;
	readonly role: RegionIncidentRole;
}): SolvedRecursiveRegion {
	const { anchor, point } = localPortal(input.side);
	const portal = {
		relationId: input.relationId,
		endpointId: input.endpointId,
		regionId: input.childId,
		side: input.side,
		point,
		localPoint: point,
	};
	let points = [anchor, point];
	if (input.role === RegionIncidentRole.Target) points = [point, anchor];
	const path: RegionIncidentPath = {
		relationId: input.relationId,
		endpointId: input.endpointId,
		pieces: [{ relationId: input.relationId, regionId: input.childId, points }],
		portals: [portal],
	};
	return {
		layout: EMPTY_LAYOUT,
		ranks: EMPTY_RANKS,
		regions: [],
		portals: [portal],
		ownedRoutes: path.pieces,
		incidentPaths: new Map([[input.relationId, path]]),
	};
}

function inheritedPath(input: {
	readonly context: RecursiveContext;
	readonly relationId: string;
	readonly childId: string;
	readonly endpointId: string;
	readonly childSide: NestedPortalSide;
	readonly outerSide: RegionPortalSide;
	readonly role?: RegionIncidentRole;
}): RegionIncidentPath {
	const child = childWithIncident({
		childId: input.childId,
		endpointId: input.endpointId,
		relationId: input.relationId,
		side: input.childSide,
		role: input.role ?? RegionIncidentRole.Source,
	});
	const paths = gridCellInheritedIncidentPaths({
		context: input.context,
		regionId: 'grid',
		incidentSides: new Map([[input.relationId, [input.outerSide]]]),
		selected: selectedGrid(),
		children: new Map([[input.childId, child]]),
	});
	return defined(paths.get(input.relationId));
}

describe('inherited grid incident continuation', () => {
	const source = persistedNestedGridWithTwoOuterIncidentsDocument();
	const context = contextFor(source);

	it.each([
		[NestedPortalSide.Top, RegionPortalSide.Top],
		[NestedPortalSide.Right, RegionPortalSide.Right],
		[NestedPortalSide.Bottom, RegionPortalSide.Bottom],
		[NestedPortalSide.Left, RegionPortalSide.Left],
	] as const)(
		'extends a child %s portal to the cell frame and grid %s frame',
		(childSide, outerSide) => {
			const path = inheritedPath({
				context,
				relationId: 'z-left-exit',
				childId: 'a',
				endpointId: 'a-target',
				childSide,
				outerSide,
			});
			expect(path.pieces.map(({ regionId }) => regionId)).toEqual(['a', 'grid']);
			expect(path.portals.map(({ regionId }) => regionId)).toEqual(['a', 'grid']);
			const childPortal = defined(path.portals[0]);
			const outerPortal = defined(path.portals[1]);
			const cell = defined(selectedGrid().cells.find(({ id }) => id === 'a'));
			if (childSide === NestedPortalSide.Top) expect(childPortal.point.y).toBe(cell.bounds.y);
			if (childSide === NestedPortalSide.Bottom)
				expect(childPortal.point.y).toBe(cell.bounds.y + cell.bounds.height);
			if (childSide === NestedPortalSide.Left) expect(childPortal.point.x).toBe(cell.bounds.x);
			if (childSide === NestedPortalSide.Right)
				expect(childPortal.point.x).toBe(cell.bounds.x + cell.bounds.width);
			if (outerSide === RegionPortalSide.Top) expect(outerPortal.point.y).toBe(-32);
			if (outerSide === RegionPortalSide.Bottom) expect(outerPortal.point.y).toBe(832);
			if (outerSide === RegionPortalSide.Left) expect(outerPortal.point.x).toBe(-32);
			if (outerSide === RegionPortalSide.Right) expect(outerPortal.point.x).toBe(832);
			for (const piece of path.pieces)
				for (let index = 1; index < piece.points.length; index += 1) {
					const previous = defined(piece.points[index - 1]);
					const current = defined(piece.points[index]);
					expect(previous.x === current.x || previous.y === current.y).toBe(true);
				}
		},
	);

	it('detours from the inner face of the right column and across to the opposite grid side', () => {
		const path = inheritedPath({
			context,
			relationId: 'a-right-exit',
			childId: 'b',
			endpointId: 'b',
			childSide: NestedPortalSide.Left,
			outerSide: RegionPortalSide.Left,
		});
		const gridPiece = defined(path.pieces[1]);
		expect(gridPiece.points).toContainEqual({ x: 476, y: 76 });
		expect(defined(path.portals[1]).point).toEqual({ x: -32, y: 50 });
	});

	it('routes a lower-row inner-face incident below its cell before reaching the grid rail', () => {
		const lowerSource = {
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id !== 'z-left-exit') return relation;
				return { ...relation, from: 'c' };
			}),
		};
		const path = inheritedPath({
			context: contextFor(lowerSource),
			relationId: 'z-left-exit',
			childId: 'c',
			endpointId: 'c',
			childSide: NestedPortalSide.Right,
			outerSide: RegionPortalSide.Left,
		});
		const gridPiece = defined(path.pieces[1]);
		expect(gridPiece.points).toContainEqual({ x: 324, y: 724 });
		expect(defined(path.portals[1]).point).toEqual({ x: -32, y: 724 });
	});

	it('reverses the composition order for a target incident while retaining physical portal continuation', () => {
		const reversed = {
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id !== 'z-left-exit') return relation;
				return { ...relation, from: 'outside', to: 'a-target' };
			}),
		};
		const path = inheritedPath({
			context: contextFor(reversed),
			relationId: 'z-left-exit',
			childId: 'a',
			endpointId: 'a-target',
			childSide: NestedPortalSide.Top,
			outerSide: RegionPortalSide.Left,
			role: RegionIncidentRole.Target,
		});
		expect(path.pieces.map(({ regionId }) => regionId)).toEqual(['grid', 'a']);
		expect(path.portals.map(({ regionId }) => regionId)).toEqual(['grid', 'a']);
		expect(defined(path.pieces[0]).points[0]).toEqual(defined(path.portals[0]).point);
	});

	it('admits inherited lateral faces without a cell-shape predicate', () => {
		const relation = defined(source.relations.find(({ id }) => id === 'z-left-exit'));
		const sides = gridCellArrangement.incidentSides({
			context,
			regionId: 'grid',
			childId: 'a',
			relation,
			role: RegionIncidentRole.Source,
			inheritedSides: [RegionPortalSide.Right, RegionPortalSide.Left],
			preferredSide: RegionPortalSide.Top,
		});
		expect(sides).toEqual([
			RegionPortalSide.Left,
			RegionPortalSide.Right,
			RegionPortalSide.Top,
			RegionPortalSide.Bottom,
		]);
	});
});
