import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	entersInterior,
	within,
} from '../../../../src/lib/core/layout/grid-cell-geometry-primitives';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grid-cell-layout';
import {
	GridCellLayoutStatus,
	type GridCellPlacement,
	type GridCellSelected,
} from '../../../../src/lib/core/layout/grid-cell-types';
import {
	validateGridCellGeometry,
	validateGridCellGeometryDiagnostic,
} from '../../../../src/lib/core/layout/grid-cell-validation';
import type {
	Bounds,
	LayoutElement,
	LayoutRelation,
} from '../../../../src/lib/core/layout/layout-types';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/region-geometry-diagnostic';
import { gridDocument, gridInput, prepareGrid } from './grid-cell-fixture';

function fixture(): {
	readonly selected: GridCellSelected;
	readonly prepared: ReturnType<typeof prepareGrid>;
} {
	const prepared = prepareGrid();
	const result = solveGridCellLayout(prepared.graph, prepared.measurements, gridInput());
	if (result.status !== GridCellLayoutStatus.Selected)
		throw new Error('Expected selected grid fixture');
	return { selected: result, prepared };
}

function cellFor(selected: GridCellSelected, id: string): GridCellPlacement {
	return defined(selected.cells.find((cell) => cell.id === id));
}

function elementFor(selected: GridCellSelected, id: string): LayoutElement {
	return defined(selected.layout.elements.find((element) => element.id === id));
}

function withCell(
	selected: GridCellSelected,
	id: string,
	change: (cell: GridCellPlacement) => GridCellPlacement,
): GridCellSelected {
	return {
		...selected,
		cells: selected.cells.map((cell) => {
			if (cell.id !== id) return cell;
			return change(cell);
		}),
	};
}

function withRoute(
	selected: GridCellSelected,
	id: string,
	change: (route: LayoutRelation) => LayoutRelation,
): GridCellSelected {
	return {
		...selected,
		layout: {
			...selected.layout,
			relations: selected.layout.relations.map((route) => {
				if (route.id !== id) return route;
				return change(route);
			}),
		},
	};
}

function withElement(
	selected: GridCellSelected,
	id: string,
	change: (element: LayoutElement) => LayoutElement,
): GridCellSelected {
	return {
		...selected,
		layout: {
			...selected.layout,
			elements: selected.layout.elements.map((element) => {
				if (element.id !== id) return element;
				return change(element);
			}),
		},
	};
}

function withPublishedRegion(
	selected: GridCellSelected,
	id: string,
	change: (bounds: Bounds) => Bounds,
): GridCellSelected {
	return {
		...selected,
		layout: {
			...selected.layout,
			regions: defined(selected.layout.regions).map((region) => {
				if (region.id !== id) return region;
				return { ...region, bounds: change(region.bounds) };
			}),
		},
	};
}

interface DamagedCase {
	readonly name: string;
	readonly reason: string;
	readonly damage: (selected: GridCellSelected) => GridCellSelected;
}

const FRAME_CASES: readonly DamagedCase[] = [
	{
		name: 'missing published cells',
		reason: 'must publish four cells',
		damage: (selected) => ({ ...selected, layout: { ...selected.layout, regions: [] } }),
	},
	{
		name: 'column below minimum',
		reason: 'below its minimum',
		damage: (selected) => ({ ...selected, columnWidths: [699, selected.columnWidths[1]] }),
	},
	{
		name: 'row below minimum',
		reason: 'below its minimum',
		damage: (selected) => ({ ...selected, rowHeights: [selected.rowHeights[0], 299] }),
	},
	{
		name: 'invalid root extent',
		reason: 'invalid extent',
		damage: (selected) => ({ ...selected, layout: { ...selected.layout, width: 0 } }),
	},
	{
		name: 'cell outside root',
		reason: 'leaves the root',
		damage: (selected) =>
			withCell(selected, 'a', (cell) => ({ ...cell, bounds: { ...cell.bounds, x: -1 } })),
	},
	{
		name: 'wrong parent',
		reason: 'invalid ownership',
		damage: (selected) => withCell(selected, 'a', (cell) => ({ ...cell, parentId: 'foreign' })),
	},
	{
		name: 'track width mismatch',
		reason: 'fill its grid tracks',
		damage: (selected) =>
			withCell(selected, 'a', (cell) => ({
				...cell,
				bounds: { ...cell.bounds, width: cell.bounds.width + 1 },
			})),
	},
	{
		name: 'published frame mismatch',
		reason: 'different published frame',
		damage: (selected) =>
			withPublishedRegion(selected, 'a', (bounds) => ({ ...bounds, x: bounds.x + 1 })),
	},
	{
		name: 'clipped child canvas',
		reason: 'clips its independent layout',
		damage: (selected) =>
			withCell(selected, 'a', (cell) => ({
				...cell,
				translation: { ...cell.translation, x: cell.bounds.x + cell.bounds.width },
			})),
	},
	{
		name: 'misaligned tracks',
		reason: 'misaligned or overlap',
		damage: (selected) => {
			const shifted = withCell(selected, 'b', (cell) => ({
				...cell,
				bounds: { ...cell.bounds, x: cell.bounds.x + 1 },
			}));
			return withPublishedRegion(shifted, 'b', (bounds) => ({ ...bounds, x: bounds.x + 1 }));
		},
	},
];

const ELEMENT_CASES: readonly DamagedCase[] = [
	{
		name: 'missing element',
		reason: 'each endpoint exactly once',
		damage: (selected) => ({
			...selected,
			layout: {
				...selected.layout,
				elements: selected.layout.elements.filter(({ id }) => id !== 'c'),
			},
		}),
	},
	{
		name: 'duplicate element',
		reason: 'each endpoint exactly once',
		damage: (selected) => ({
			...selected,
			layout: {
				...selected.layout,
				elements: [...selected.layout.elements, elementFor(selected, 'c')],
			},
		}),
	},
	{
		name: 'wrong element identity',
		reason: 'missing geometry',
		damage: (selected) => withElement(selected, 'c', (element) => ({ ...element, id: 'foreign' })),
	},
	{
		name: 'missing local element',
		reason: 'missing geometry',
		damage: (selected) =>
			withCell(selected, 'c', (cell) => ({
				...cell,
				localLayout: {
					...cell.localLayout,
					elements: cell.localLayout.elements.filter(({ id }) => id !== 'c'),
				},
			})),
	},
	{
		name: 'nonfinite element',
		reason: 'missing geometry',
		damage: (selected) =>
			withElement(selected, 'c', (element) => ({
				...element,
				bounds: { ...element.bounds, x: NaN },
			})),
	},
	{
		name: 'moved element',
		reason: 'disagrees with its cell layout',
		damage: (selected) =>
			withElement(selected, 'c', (element) => ({
				...element,
				bounds: { ...element.bounds, x: element.bounds.x + 1 },
			})),
	},
];

const ROUTE_CASES: readonly DamagedCase[] = [
	{
		name: 'missing relation',
		reason: 'each relation exactly once',
		damage: (selected) => ({
			...selected,
			layout: {
				...selected.layout,
				relations: selected.layout.relations.filter(({ id }) => id !== 'across-grid'),
			},
		}),
	},
	{
		name: 'wrong relation identity',
		reason: 'invalid path',
		damage: (selected) =>
			withRoute(selected, 'across-grid', (route) => ({ ...route, id: 'foreign' })),
	},
	{
		name: 'wrong relation endpoint',
		reason: 'invalid path',
		damage: (selected) => withRoute(selected, 'across-grid', (route) => ({ ...route, from: 'c' })),
	},
	{
		name: 'one point route',
		reason: 'invalid path',
		damage: (selected) =>
			withRoute(selected, 'across-grid', (route) => ({
				...route,
				points: route.points.slice(0, 1),
			})),
	},
	{
		name: 'nonfinite route point',
		reason: 'invalid path',
		damage: (selected) =>
			withRoute(selected, 'across-grid', (route) => ({
				...route,
				points: route.points.map((point, index) => {
					if (index !== 1) return point;
					return { ...point, x: Infinity };
				}),
			})),
	},
	{
		name: 'diagonal route segment',
		reason: 'invalid path',
		damage: (selected) =>
			withRoute(selected, 'across-grid', (route) => ({
				...route,
				points: route.points.map((point, index) => {
					if (index !== 1) return point;
					return { x: point.x + 1, y: point.y + 1 };
				}),
			})),
	},
	{
		name: 'shifted local route',
		reason: 'disagrees with its child layout',
		damage: (selected) =>
			withRoute(selected, 'inside-a', (route) => ({
				...route,
				points: route.points.map((point) => ({ x: point.x + 1, y: point.y })),
			})),
	},
	{
		name: 'extra local route point',
		reason: 'disagrees with its child layout',
		damage: (selected) =>
			withRoute(selected, 'inside-a', (route) => ({
				...route,
				points: [...route.points, defined(route.points.at(-1))],
			})),
	},
	{
		name: 'shifted source port',
		reason: 'invalid endpoint ports',
		damage: (selected) =>
			withRoute(selected, 'across-grid', (route) => ({
				...route,
				points: route.points.map((point, index) => {
					if (index !== 0) return point;
					return { ...point, x: point.x + 1 };
				}),
			})),
	},
	{
		name: 'missing portals',
		reason: 'invalid portals',
		damage: (selected) => ({ ...selected, portals: [] }),
	},
	{
		name: 'wrong portal owner',
		reason: 'invalid portals',
		damage: (selected) => ({
			...selected,
			portals: selected.portals.map((portal, index) => {
				if (index !== 0) return portal;
				return { ...portal, cellId: 'c' };
			}),
		}),
	},
	{
		name: 'wrong portal region identity',
		reason: 'invalid portals',
		damage: (selected) => ({
			...selected,
			portals: selected.portals.map((portal, index) => {
				if (index !== 0) return portal;
				return { ...portal, regionId: 'c' };
			}),
		}),
	},
	{
		name: 'wrong portal local point',
		reason: 'invalid portals',
		damage: (selected) => ({
			...selected,
			portals: selected.portals.map((portal, index) => {
				if (index !== 0) return portal;
				return { ...portal, localPoint: { ...portal.localPoint, y: portal.localPoint.y + 1 } };
			}),
		}),
	},
	{
		name: 'wrong portal local side',
		reason: 'invalid portals',
		damage: (selected) => ({
			...selected,
			portals: selected.portals.map((portal, index) => {
				if (index !== 0) return portal;
				return { ...portal, localPoint: { ...portal.localPoint, x: portal.localPoint.x + 1 } };
			}),
		}),
	},
	{
		name: 'portal beyond the vertical extent of its cell',
		reason: 'invalid portals',
		damage: (selected) => ({
			...selected,
			portals: selected.portals.map((portal, index) => {
				if (index !== 0) return portal;
				const cell = cellFor(selected, portal.cellId);
				return {
					...portal,
					localPoint: { ...portal.localPoint, y: cell.bounds.height + 1 },
					point: { ...portal.point, y: cell.bounds.y + cell.bounds.height + 1 },
				};
			}),
		}),
	},
	{
		name: 'wrong portal endpoint',
		reason: 'invalid portals',
		damage: (selected) => ({
			...selected,
			portals: selected.portals.map((portal, index) => {
				if (index !== 0) return portal;
				return { ...portal, endpointId: 'c' };
			}),
		}),
	},
	{
		name: 'wrong portal side',
		reason: 'invalid portals',
		damage: (selected) => ({
			...selected,
			portals: selected.portals.map((portal, index) => {
				if (index !== 0) return portal;
				return { ...portal, side: RegionPortalSide.Right };
			}),
		}),
	},
	{
		name: 'portal outside its boundary',
		reason: 'invalid portals',
		damage: (selected) => ({
			...selected,
			portals: selected.portals.map((portal, index) => {
				if (index !== 0) return portal;
				return { ...portal, point: { ...portal.point, x: portal.point.x + 1 } };
			}),
		}),
	},
	{
		name: 'portal absent from route',
		reason: 'invalid portals',
		damage: (selected) => ({
			...selected,
			portals: selected.portals.map((portal, index) => {
				if (index !== 0) return portal;
				return { ...portal, point: { ...portal.point, y: portal.point.y + 1 } };
			}),
		}),
	},
	{
		name: 'target stub that passes its declared portal before attaching',
		reason: 'invalid portals',
		damage: (selected) =>
			withRoute(selected, 'across-grid', (route) => {
				const targetPortal = defined(route.points.at(-2));
				return {
					...route,
					points: [
						...route.points.slice(0, -1),
						{ x: targetPortal.x + 1, y: targetPortal.y },
						defined(route.points.at(-1)),
					],
				};
			}),
	},
	{
		name: 'source that leaves by an undeclared side before visiting its portal',
		reason: 'invalid portals',
		damage: (selected) =>
			withRoute(selected, 'across-grid', (route) => {
				const port = defined(route.points[0]);
				const portal = defined(route.points[1]);
				const cell = cellFor(selected, 'a');
				const bottom = cell.bounds.y + cell.bounds.height;
				return {
					...route,
					points: [
						port,
						{ x: port.x, y: bottom },
						{ x: portal.x, y: bottom },
						...route.points.slice(1),
					],
				};
			}),
	},
];

describe('independent grid geometry validation', () => {
	const { selected, prepared } = fixture();
	it.each([...FRAME_CASES, ...ELEMENT_CASES, ...ROUTE_CASES])(
		'rejects $name',
		({ damage, reason }) => {
			const candidate = damage(selected);
			expect(validateGridCellGeometry(candidate, prepared.graph, gridInput())).toContain(reason);
		},
	);

	it('rejects a crossing stub that runs through a sibling element in its own cell', () => {
		const source = elementFor(selected, 'a-bottom');
		const sibling = elementFor(selected, 'a-top');
		const cell = cellFor(selected, 'a');
		const stubX = (source.bounds.x + cell.bounds.x) / 2;
		const globalBounds = {
			...sibling.bounds,
			x: stubX - 10,
			y: source.bounds.y + source.bounds.height / 2 - 10,
			width: 20,
			height: 20,
		};
		const localBounds = {
			...globalBounds,
			x: globalBounds.x - cell.translation.x,
			y: globalBounds.y - cell.translation.y,
		};
		const changedCell = withCell(selected, 'a', (value) => ({
			...value,
			localLayout: {
				...value.localLayout,
				elements: value.localLayout.elements.map((element) => {
					if (element.id !== 'a-top') return element;
					return { ...element, bounds: localBounds };
				}),
			},
		}));
		const candidate = withElement(changedCell, 'a-top', (element) => ({
			...element,
			bounds: globalBounds,
		}));
		expect(validateGridCellGeometry(candidate, prepared.graph, gridInput())).toContain(
			'enters element a-top',
		);
		expect(
			validateGridCellGeometryDiagnostic(candidate, prepared.graph, gridInput()),
		).toMatchObject({
			code: RegionGeometryDiagnosticCode.GridCrossingEntersElement,
			relationId: 'across-grid',
			endpointId: 'a-top',
		});
	});

	it('still validates the untouched selected result', () => {
		expect(validateGridCellGeometry(selected, prepared.graph, gridInput())).toBeUndefined();
	});

	it('rejects a second crossing that reuses an exterior rail segment', () => {
		const base = gridDocument();
		const pair = prepareGrid({
			...base,
			relations: [...base.relations, { id: 'second-crossing', from: 'a-bottom', to: 'c' }],
		});
		const input = gridInput();
		const result = solveGridCellLayout(pair.graph, pair.measurements, input);
		if (result.status !== GridCellLayoutStatus.Selected)
			throw new Error('Expected two valid crossing routes');
		const first = defined(result.layout.relations.find(({ id }) => id === 'across-grid'));
		const second = defined(result.layout.relations.find(({ id }) => id === 'second-crossing'));
		const firstRailX = defined(first.points[2]).x;
		const firstBusY = defined(first.points[3]).y;
		const secondRail = defined(second.points[2]);
		const damaged = withRoute(result, second.id, (route) => ({
			...route,
			points: [
				...route.points.slice(0, 3),
				{ x: firstRailX, y: secondRail.y },
				{ x: firstRailX, y: firstBusY },
				{ x: secondRail.x, y: firstBusY },
				...route.points.slice(-3),
			],
		}));
		expect(validateGridCellGeometry(damaged, pair.graph, input)).toContain('overlap');
	});

	it('rejects an owner mapping to an absent cell', () => {
		const input = gridInput();
		const assignment = new Map(input.cellByEndpointId);
		assignment.set('c', 'foreign');
		expect(
			validateGridCellGeometry(selected, prepared.graph, {
				...input,
				cellByEndpointId: assignment,
			}),
		).toContain('Endpoint c has missing geometry');
	});

	it('treats vertical escape and diagonal intrusion as geometric violations', () => {
		const cell = cellFor(selected, 'c');
		const escaped = { ...cell.bounds, y: -1 };
		expect(
			within({ x: 0, y: 0, width: selected.layout.width, height: selected.layout.height }, escaped),
		).toBe(false);
		expect(
			entersInterior(
				{ x: cell.bounds.x - 10, y: cell.bounds.y - 10 },
				{ x: cell.bounds.x + 10, y: cell.bounds.y + 10 },
				cell.bounds,
			),
		).toBe(true);
	});
});
