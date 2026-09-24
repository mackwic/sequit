import { describe, expect, it } from 'vitest';

import {
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_LANE_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { mapRegionPresentation } from '../../../../src/lib/infrastructure/toml/map-region-presentation';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';
import {
	regionLaneDocument,
	regionLaneDocumentWithRootLanes,
} from '../../../support/builders/region-lane-document';

function mappingPaths(value: unknown): readonly string[] {
	const diagnostics: Parameters<typeof mapRegionPresentation>[1]['diagnostics'] = [];
	mapRegionPresentation(value, { diagnostics }, REGION_LANE_PRESENTATION_SCHEMA);
	return diagnostics.map(({ path }) => path.join('.'));
}

describe('TOML region leaf lane presentation', () => {
	it('round trips format 6 with two scoped lanes and an ordinary sibling', () => {
		const source = regionLaneDocument();
		const serialized = serializeSequitToml(source);
		expect(serialized).toContain('persistenceFormat = 6');
		expect(serialized).toContain('[regionPresentation.regions.shared.lanePresentation]');
		expect(serialized).toContain(
			'[regionPresentation.regions.shared.lanePresentation.lanes.sales]',
		);
		const parsed = parseSequitToml(serialized);
		expect(parsed).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: REGION_LANE_PERSISTENCE_FORMAT,
				regionPresentation: {
					schemaVersion: REGION_LANE_PRESENTATION_SCHEMA,
					regions: [
						{ id: 'ordinary' },
						{
							id: 'shared',
							lanePresentation: {
								laneOrientation: 'parallel',
								growth: 'auto',
								lanes: [{ id: 'sales' }, { id: 'service' }],
							},
						},
					],
				},
			},
		});
		if (!parsed.ok) throw new Error('Expected region lanes to parse');
		expect(serializeSequitToml(parsed.value)).toBe(serialized);
	});

	it('round trips root lanes beside leaf-local lanes without merging their identities', () => {
		const source = regionLaneDocumentWithRootLanes();
		const serialized = serializeSequitToml(source);
		const parsed = parseSequitToml(serialized);
		expect(parsed).toMatchObject({
			ok: true,
			value: {
				presentation: { lanes: [{ id: 'root-left' }, { id: 'root-right' }] },
				regionPresentation: {
					regions: [
						{ id: 'ordinary' },
						{ id: 'shared', lanePresentation: { lanes: [{ id: 'sales' }, { id: 'service' }] } },
					],
				},
			},
		});
		if (!parsed.ok) throw new Error('Expected both lane scopes to parse');
		expect(serializeSequitToml(parsed.value)).toBe(serialized);
	});

	it('diagnoses malformed local lane fields at their TOML paths', () => {
		const valid = {
			schemaVersion: REGION_LANE_PRESENTATION_SCHEMA,
			regions: {
				shared: {
					layoutOrder: 'a0',
					policy: 'layered',
					lanePresentation: {
						laneOrientation: 'parallel',
						growth: 'auto',
						lanes: {
							sales: { label: 'Sales', layoutOrder: 'a0' },
							service: { label: 'Service', layoutOrder: 'a1' },
						},
					},
				},
			},
		};
		for (const { raw, path } of [
			{
				raw: { ...valid, regions: { shared: { ...valid.regions.shared, lanePresentation: [] } } },
				path: 'regionPresentation.regions.shared.lanePresentation',
			},
			{
				raw: {
					...valid,
					regions: {
						shared: {
							...valid.regions.shared,
							lanePresentation: {
								...valid.regions.shared.lanePresentation,
								laneOrientation: 'diagonal',
							},
						},
					},
				},
				path: 'regionPresentation.regions.shared.lanePresentation.laneOrientation',
			},
			{
				raw: {
					...valid,
					regions: {
						shared: {
							...valid.regions.shared,
							lanePresentation: { ...valid.regions.shared.lanePresentation, growth: 'fixed' },
						},
					},
				},
				path: 'regionPresentation.regions.shared.lanePresentation.growth',
			},
			{
				raw: {
					...valid,
					regions: {
						shared: {
							...valid.regions.shared,
							lanePresentation: {
								...valid.regions.shared.lanePresentation,
								lanes: { sales: { label: 'Sales', layoutOrder: 'bad!' } },
							},
						},
					},
				},
				path: 'regionPresentation.regions.shared.lanePresentation.lanes.sales.layoutOrder',
			},
			{
				raw: {
					...valid,
					regions: {
						shared: {
							...valid.regions.shared,
							lanePresentation: { ...valid.regions.shared.lanePresentation, extra: true },
						},
					},
				},
				path: 'regionPresentation.regions.shared.lanePresentation.extra',
			},
		])
			expect(mappingPaths(raw), path).toContain(path);
	});

	it('keeps old region schema strict about new leaf-local fields', () => {
		const region = {
			layoutOrder: 'a0',
			policy: 'layered',
			lanePresentation: {
				laneOrientation: 'parallel',
				growth: 'auto',
				lanes: {},
			},
		};
		expect(mappingPaths({ schemaVersion: 1, regions: { shared: region } })).toContain(
			'regionPresentation.regions.shared.lanePresentation',
		);
	});
});
