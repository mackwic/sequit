import { describe, expect, it } from 'vitest';

import {
	GRID_PERSISTENCE_FORMAT,
	GRID_REGION_PRESENTATION_SCHEMA,
	type LayoutRegionDefinition,
	type LogicDocument,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_LANE_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	normalizeRegionPresentation,
	RegionPresentationStatus,
} from '../../../../src/lib/core/document/region-presentation';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { regionGridDocument } from '../../../support/builders/region-grid-document';

function regions(document: LogicDocument): readonly LayoutRegionDefinition[] {
	const presentation = document.regionPresentation;
	if (presentation?.schemaVersion !== REGION_COMPOSITION_PRESENTATION_SCHEMA)
		throw new Error('Expected region composition presentation');
	return presentation.regions;
}

function withRegions(
	document: LogicDocument,
	change: (regions: readonly LayoutRegionDefinition[]) => readonly LayoutRegionDefinition[],
): LogicDocument {
	const presentation = document.regionPresentation;
	if (presentation?.schemaVersion !== REGION_COMPOSITION_PRESENTATION_SCHEMA)
		throw new Error('Expected region composition presentation');
	return {
		...document,
		regionPresentation: { ...presentation, regions: change(presentation.regions) },
	};
}

function paths(document: LogicDocument): readonly string[] {
	const result = validateLogicDocument(document);
	if (result.ok) return [];
	return result.diagnostics.map(({ path }) => path.join('.'));
}

function changeBranch(
	document: LogicDocument,
	change: (branch: LayoutRegionDefinition) => LayoutRegionDefinition,
): LogicDocument {
	return withRegions(document, (definitions) =>
		definitions.map((region) => {
			if (region.id === 'branch') return change(region);
			return region;
		}),
	);
}

describe('internal grid region presentation', () => {
	it('normalizes a grid owner with four direct children beside an ordinary leaf and scoped lanes', () => {
		const document = regionGridDocument();
		expect(paths(document)).toEqual([]);
		const assignments = new Map<string, string>();
		for (const endpoint of [...document.groups, ...document.nodes, ...document.junctions])
			if (endpoint.regionId !== undefined) assignments.set(endpoint.id, endpoint.regionId);
		const normalized = normalizeRegionPresentation(document, regions(document), assignments);
		expect(normalized.status).toBe(RegionPresentationStatus.Ready);
		if (normalized.status !== RegionPresentationStatus.Ready) return;
		expect(normalized.value.regions.map(({ id }) => id)).toEqual([
			'@root',
			'branch',
			'a',
			'b',
			'c',
			'd',
			'ordinary',
		]);
		expect(normalized.value.regions[1]?.grid).toEqual(regions(document)[0]?.grid);
		expect(normalized.value.regions[2]?.lanePresentation?.lanes.map(({ id }) => id)).toEqual([
			'left',
			'right',
		]);
		expect(normalized.value.regionByEndpointId.get('source-a')).toBe('a');
		expect(normalized.value.regionByEndpointId.get('target')).toBe('d');
	});

	it('diagnoses invalid minima, duplicate slots and cells outside the owner', () => {
		const source = regionGridDocument();
		const branch = regions(source)[0];
		const grid = branch?.grid;
		if (grid === undefined) throw new Error('Expected grid owner');
		const minimum = changeBranch(source, (region) => ({
			...region,
			grid: { ...grid, minimumRowHeights: [50, -1] },
		}));
		expect(paths(minimum)).toContain('regionPresentation.regions.branch.grid.minimumRowHeights.1');
		const duplicateSlot = changeBranch(source, (region) => ({
			...region,
			grid: {
				...grid,
				cells: grid.cells.map((cell) => {
					if (cell.regionId === 'b') return { ...cell, column: 0 };
					return cell;
				}),
			},
		}));
		expect(paths(duplicateSlot)).toContain('regionPresentation.regions.branch.grid.cells.b');
		const nonChild = changeBranch(source, (region) => ({
			...region,
			grid: {
				...grid,
				cells: grid.cells.map((cell) => {
					if (cell.regionId === 'b') return { ...cell, regionId: 'ordinary' };
					return cell;
				}),
			},
		}));
		expect(paths(nonChild)).toEqual(
			expect.arrayContaining([
				'regionPresentation.regions.branch.grid.cells.ordinary.regionId',
				'regionPresentation.regions.b',
			]),
		);
	});

	it('rejects an unassigned fifth child, a leaf grid and lanes on a grid owner', () => {
		const source = regionGridDocument();
		const branch = regions(source)[0];
		const leaf = regions(source).find(({ id }) => id === 'a');
		const grid = branch?.grid;
		const branchPolicy = branch?.policy;
		const lanes = leaf?.lanePresentation;
		if (grid === undefined || branchPolicy === undefined || lanes === undefined)
			throw new Error('Expected grid and lane contracts');
		const fifth = withRegions(source, (definitions) => [
			...definitions,
			{
				id: 'e',
				parentId: 'branch',
				layoutOrder: orderKey('a4'),
				policy: branchPolicy,
			},
		]);
		expect(paths(fifth)).toContain('regionPresentation.regions.e');
		const leafGrid = withRegions(source, (definitions) =>
			definitions.map((region) => {
				if (region.id === 'b') return { ...region, grid };
				return region;
			}),
		);
		expect(paths(leafGrid)).toContain('regionPresentation.regions.b.grid.cells.a.regionId');
		const ownerWithLanes = changeBranch(source, (region) => ({
			...region,
			lanePresentation: lanes,
		}));
		expect(paths(ownerWithLanes)).toContain('regionPresentation.regions.branch.lanePresentation');
	});

	it('keeps internal grids unavailable to older region formats', () => {
		const source = regionGridDocument();
		const old: LogicDocument = {
			...source,
			persistenceFormat: REGION_LANE_PERSISTENCE_FORMAT,
			regionPresentation: {
				schemaVersion: REGION_LANE_PRESENTATION_SCHEMA,
				regions: regions(source),
			},
		};
		expect(paths(old)).toContain('regionPresentation.regions.branch.grid');
	});

	it('requires a root grid in format 5 and rejects a root grid in format 7', () => {
		const source = regionGridDocument();
		const presentation = source.regionPresentation;
		if (presentation?.schemaVersion !== REGION_COMPOSITION_PRESENTATION_SCHEMA)
			throw new Error('Expected composition presentation');
		const branchGrid = presentation.regions.find(({ id }) => id === 'branch')?.grid;
		if (branchGrid === undefined) throw new Error('Expected branch grid');
		const legacyPresentation = {
			schemaVersion: GRID_REGION_PRESENTATION_SCHEMA,
			regions: presentation.regions,
			grid: branchGrid,
		};
		Reflect.deleteProperty(legacyPresentation, 'grid');
		const legacyGrid: LogicDocument = {
			...source,
			persistenceFormat: GRID_PERSISTENCE_FORMAT,
			regionPresentation: legacyPresentation,
		};
		expect(paths(legacyGrid)).toContain('regionPresentation.grid');
		const invalidPresentation = { ...presentation };
		Reflect.set(invalidPresentation, 'grid', branchGrid);
		const invalidRoot: LogicDocument = {
			...source,
			regionPresentation: invalidPresentation,
		};
		expect(paths(invalidRoot)).toContain('regionPresentation.grid');
	});
});
