import { describe, expect, it } from 'vitest';

import {
	LayoutPolicy,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_POLICY_PERSISTENCE_FORMAT,
	REGION_POLICY_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { mapRegionPresentation } from '../../../../src/lib/infrastructure/toml/map-region-presentation';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';
import { regionGridDocument } from '../../../support/builders/region-grid-document';
import { regionLaneDocument } from '../../../support/builders/region-lane-document';
import { persistedGridDocument } from '../../core/layout/grid-cell-fixture';

function mappingPaths(value: unknown): readonly string[] {
	const diagnostics: Parameters<typeof mapRegionPresentation>[1]['diagnostics'] = [];
	mapRegionPresentation(value, { diagnostics }, REGION_COMPOSITION_PRESENTATION_SCHEMA);
	return diagnostics.map(({ path }) => path.join('.'));
}

describe('TOML internal grid presentation', () => {
	it('migrates format 7 nested grid and local lanes to explicit format 8 policies', () => {
		const source = regionGridDocument();
		const serialized = serializeSequitToml(source);
		expect(serialized).toContain('persistenceFormat = 7');
		expect(serialized).toContain('[regionPresentation.regions.branch.grid]');
		expect(serialized).toContain('[regionPresentation.regions.branch.grid.cells.a]');
		expect(serialized).toContain('[regionPresentation.regions.a.lanePresentation]');
		const parsed = parseSequitToml(serialized);
		expect(parsed).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: REGION_POLICY_PERSISTENCE_FORMAT,
				regionPresentation: { schemaVersion: REGION_POLICY_PRESENTATION_SCHEMA },
			},
		});
		if (!parsed.ok) throw new Error('Expected internal grid document to parse');
		const parsedRegions = parsed.value.regionPresentation?.regions ?? [];
		expect(parsedRegions.find(({ id }) => id === 'branch')?.grid).toEqual({
			minimumColumnWidths: [700, 100],
			minimumRowHeights: [50, 300],
			cells: [
				{ regionId: 'a', row: 0, column: 0 },
				{ regionId: 'b', row: 0, column: 1 },
				{ regionId: 'c', row: 1, column: 0 },
				{ regionId: 'd', row: 1, column: 1 },
			],
		});
		expect(
			parsedRegions.find(({ id }) => id === 'a')?.lanePresentation?.lanes.map(({ id }) => id),
		).toEqual(['left', 'right']);
		expect(parsedRegions.find(({ id }) => id === 'a')?.policy).toBe('shared-lanes');
		expect(parsedRegions.find(({ id }) => id === 'branch')?.policy).toBe('layered');
		const upgraded = serializeSequitToml(parsed.value);
		expect(upgraded).toContain('persistenceFormat = 8');
		expect(upgraded).toContain('schemaVersion = 5');
		expect(parseSequitToml(upgraded)).toEqual(parsed);
	});

	it('rejects a format 8 leaf policy that contradicts its local lanes', () => {
		const legacy = parseSequitToml(serializeSequitToml(regionGridDocument()));
		if (!legacy.ok) throw new Error('Expected the legacy grid to migrate.');
		const presentation = legacy.value.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation.');
		const conflicting = {
			...legacy.value,
			regionPresentation: {
				...presentation,
				regions: presentation.regions.map((region) => {
					if (region.id !== 'a') return region;
					return { ...region, policy: LayoutPolicy.Layered };
				}),
			},
		};
		const parsed = parseSequitToml(serializeSequitToml(conflicting));
		expect(parsed).toMatchObject({ ok: false });
		if (parsed.ok) return;
		expect(parsed.diagnostics.map(({ path }) => path.join('.'))).toContain(
			'regionPresentation.regions.a.policy',
		);
	});

	it('reports malformed internal grid tables at their nested TOML paths', () => {
		const grid = {
			minimumColumnWidths: [700, 100],
			minimumRowHeights: [50, 300],
			cells: { a: { row: 0, column: 0 } },
		};
		const region = { layoutOrder: 'a0', policy: 'layered', grid };
		const raw = {
			schemaVersion: REGION_COMPOSITION_PRESENTATION_SCHEMA,
			regions: { branch: region },
		};
		for (const { value, path } of [
			{
				value: { ...raw, regions: { branch: { ...region, grid: [] } } },
				path: 'regionPresentation.regions.branch.grid',
			},
			{
				value: {
					...raw,
					regions: { branch: { ...region, grid: { ...grid, minimumRowHeights: [50, -1] } } },
				},
				path: 'regionPresentation.regions.branch.grid.minimumRowHeights.1',
			},
			{
				value: {
					...raw,
					regions: {
						branch: { ...region, grid: { ...grid, cells: { a: { row: 0, column: 2 } } } },
					},
				},
				path: 'regionPresentation.regions.branch.grid.cells.a.column',
			},
			{
				value: { ...raw, regions: { branch: { ...region, grid: { ...grid, extra: true } } } },
				path: 'regionPresentation.regions.branch.grid.extra',
			},
		])
			expect(mappingPaths(value), path).toContain(path);
	});

	it('keeps old root grids and leaf lanes readable and rejects nested grids in their schemas', () => {
		for (const source of [persistedGridDocument(), regionLaneDocument()]) {
			const serialized = serializeSequitToml(source);
			const parsed = parseSequitToml(serialized);
			expect(parsed).toMatchObject({ ok: true });
			if (!parsed.ok) throw new Error('Expected previous format to parse');
			const replayed = serializeSequitToml(parsed.value);
			if (source.persistenceFormat === REGION_LANE_PERSISTENCE_FORMAT)
				expect(replayed).toContain('persistenceFormat = 8');
			else expect(replayed).toBe(serialized);
			expect(parseSequitToml(replayed)).toEqual(parsed);
		}
		const source = regionGridDocument();
		const serialized = serializeSequitToml(source);
		const oldFormat = serialized
			.replace('persistenceFormat = 7', 'persistenceFormat = 6')
			.replace('schemaVersion = 4', 'schemaVersion = 3');
		const parsed = parseSequitToml(oldFormat);
		expect(parsed).toMatchObject({ ok: false });
		if (parsed.ok) return;
		expect(parsed.diagnostics.map(({ path }) => path.join('.'))).toContain(
			'regionPresentation.regions.branch.grid',
		);
	});
});
