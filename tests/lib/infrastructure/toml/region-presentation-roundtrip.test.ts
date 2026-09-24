import { describe, expect, it } from 'vitest';

import {
	LayoutPolicy,
	type LogicDocument,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { mapRegionPresentation } from '../../../../src/lib/infrastructure/toml/map-region-presentation';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../../support/builders/logic-document';

function regionDocument(): LogicDocument {
	const document = validLogicDocument();
	return {
		...document,
		persistenceFormat: REGION_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_PRESENTATION_SCHEMA,
			regions: [
				{ id: 'outer', layoutOrder: orderKey('a0'), policy: LayoutPolicy.Layered },
				{
					id: 'inner',
					parentId: 'outer',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
			],
		},
		groups: document.groups.map((group) => {
			if (group.id === 'container') return { ...group, regionId: 'inner' };
			return group;
		}),
		nodes: document.nodes.map((node) => {
			if (node.id === 'target') return { ...node, regionId: 'outer' };
			return node;
		}),
	};
}

function diagnosticPaths(document: LogicDocument): readonly string[] {
	const result = validateLogicDocument(document);
	if (result.ok) return [];
	return result.diagnostics.map(({ path }) => path.join('.'));
}

describe('TOML region presentation', () => {
	it('round trips nested region definitions and top-level endpoint ownership', () => {
		const source = regionDocument();
		const serialized = serializeSequitToml(source);
		expect(serialized).toContain('persistenceFormat = 4');
		expect(serialized).toContain('[regionPresentation.regions.inner]');
		expect(serialized).toContain('regionId = "inner"');
		const parsed = parseSequitToml(serialized);
		expect(parsed).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: REGION_PERSISTENCE_FORMAT,
				regionPresentation: { regions: [{ id: 'inner', parentId: 'outer' }, { id: 'outer' }] },
			},
		});
		if (!parsed.ok) throw new Error('Expected region source to parse');
		expect(serializeSequitToml(parsed.value)).toBe(serialized);
	});

	it('accepts an empty explicit region tree and keeps formats 2 and 3 unchanged', () => {
		const source = regionDocument();
		const empty: LogicDocument = {
			...source,
			regionPresentation: { schemaVersion: REGION_PRESENTATION_SCHEMA, regions: [] },
			groups: source.groups.map((group) => {
				const result = { ...group };
				delete result.regionId;
				return result;
			}),
			nodes: source.nodes.map((node) => {
				const result = { ...node };
				delete result.regionId;
				return result;
			}),
		};
		expect(parseSequitToml(serializeSequitToml(empty))).toMatchObject({ ok: true });
		expect(parseSequitToml(serializeSequitToml(validLogicDocument()))).toMatchObject({
			ok: true,
			value: { persistenceFormat: 2 },
		});
		expect(parseSequitToml(serializeSequitToml(explicitLaneLogicDocument()))).toMatchObject({
			ok: true,
			value: { persistenceFormat: 3 },
		});
	});

	it('persists lanes and regions as separate preferences in format 4', () => {
		const lanes = explicitLaneLogicDocument();
		const regions = regionDocument();
		if (regions.regionPresentation === undefined) throw new Error('Expected region presentation');
		const combined: LogicDocument = {
			...lanes,
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			regionPresentation: regions.regionPresentation,
		};
		const parsed = parseSequitToml(serializeSequitToml(combined));
		expect(parsed).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: REGION_PERSISTENCE_FORMAT,
				presentation: { lanes: [{ id: 'left' }, { id: 'right' }] },
				regionPresentation: { regions: [{ id: 'inner' }, { id: 'outer' }] },
			},
		});
	});

	it('diagnoses unknown parents, cycles, assignments and group inheritance', () => {
		const source = regionDocument();
		const presentation = source.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const unknownParent: LogicDocument = {
			...source,
			regionPresentation: {
				...presentation,
				regions: presentation.regions.map((region) => {
					if (region.id === 'inner') return { ...region, parentId: 'missing' };
					return region;
				}),
			},
		};
		const cycle: LogicDocument = {
			...source,
			regionPresentation: {
				...presentation,
				regions: presentation.regions.map((region) => {
					if (region.id === 'outer') return { ...region, parentId: 'inner' };
					return region;
				}),
			},
		};
		const unknownAssignment: LogicDocument = {
			...source,
			nodes: source.nodes.map((node) => {
				if (node.id === 'target') return { ...node, regionId: 'missing' };
				return node;
			}),
		};
		const inheritedAssignment: LogicDocument = {
			...source,
			nodes: source.nodes.map((node) => {
				if (node.id === 'source-a') return { ...node, regionId: 'outer' };
				return node;
			}),
		};
		for (const { document, path } of [
			{ document: unknownParent, path: 'regionPresentation.regions.inner.parentId' },
			{ document: cycle, path: 'regionPresentation.regions.outer.parentId' },
			{ document: unknownAssignment, path: 'nodes.target.regionId' },
			{ document: inheritedAssignment, path: 'nodes.source-a.regionId' },
		]) {
			expect(diagnosticPaths(document)).toContain(path);
			const parsed = parseSequitToml(serializeSequitToml(document));
			expect(parsed).toMatchObject({ ok: false });
			if (parsed.ok) throw new Error('Expected invalid region source');
			expect(parsed.diagnostics.map(({ path: parts }) => parts.join('.'))).toContain(path);
		}
	});

	it('rejects downgraded documents and malformed TOML at source paths', () => {
		const source = regionDocument();
		const serialized = serializeSequitToml(source);
		const downgraded = parseSequitToml(
			serialized.replace('persistenceFormat = 4', 'persistenceFormat = 2'),
		);
		expect(downgraded).toMatchObject({ ok: false });
		if (downgraded.ok) throw new Error('Expected downgrade to fail');
		expect(downgraded.diagnostics.map(({ path }) => path.join('.'))).toContain(
			'regionPresentation',
		);
		const invalidSchema = parseSequitToml(
			serialized.replace('schemaVersion = 1', 'schemaVersion = 2'),
		);
		expect(invalidSchema).toMatchObject({ ok: false });
		if (invalidSchema.ok) throw new Error('Expected future schema to fail');
		expect(invalidSchema.diagnostics.map(({ path }) => path.join('.'))).toContain(
			'regionPresentation.schemaVersion',
		);
	});

	it('diagnoses malformed direct model values and hidden region state in legacy documents', () => {
		const source = regionDocument();
		const presentation = source.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const missingPresentation: LogicDocument = { ...source };
		Reflect.deleteProperty(missingPresentation, 'regionPresentation');
		expect(diagnosticPaths(missingPresentation)).toContain('regionPresentation');
		const badSchema: LogicDocument = {
			...source,
			regionPresentation: { ...presentation },
		};
		if (badSchema.regionPresentation === undefined) throw new Error('Expected region presentation');
		Reflect.set(badSchema.regionPresentation, 'schemaVersion', 2);
		expect(diagnosticPaths(badSchema)).toContain('regionPresentation.schemaVersion');
		const badRegions: LogicDocument = {
			...source,
			regionPresentation: { ...presentation },
		};
		if (badRegions.regionPresentation === undefined)
			throw new Error('Expected region presentation');
		Reflect.set(badRegions.regionPresentation, 'regions', undefined);
		expect(diagnosticPaths(badRegions)).toContain('regionPresentation.regions');
		const outer = presentation.regions.find((region) => region.id === 'outer');
		if (outer === undefined) throw new Error('Expected outer region');
		expect(
			diagnosticPaths({
				...source,
				regionPresentation: {
					...presentation,
					regions: [...presentation.regions, outer],
				},
			}),
		).toContain('regionPresentation.regions.outer');
		expect(
			diagnosticPaths({
				...source,
				regionPresentation: {
					...presentation,
					regions: [
						...presentation.regions,
						{ id: '', layoutOrder: orderKey('a2'), policy: LayoutPolicy.Layered },
					],
				},
			}),
		).toContain('regionPresentation.regions.');
		expect(
			diagnosticPaths({
				...source,
				groups: source.groups.map((group) => {
					if (group.id === 'container') return { ...group, groupId: 'missing' };
					return group;
				}),
			}),
		).toContain('groups.container.group');
		const legacy = validLogicDocument();
		expect(
			diagnosticPaths({
				...legacy,
				regionPresentation: presentation,
				nodes: legacy.nodes.map((node) => {
					if (node.id === 'target') return { ...node, regionId: 'outer' };
					return node;
				}),
			}),
		).toEqual(expect.arrayContaining(['regionPresentation', 'nodes.target.regionId']));
	});

	it('diagnoses malformed region tables at their source paths', () => {
		const valid = {
			schemaVersion: 1,
			regions: { zone: { layoutOrder: 'a0', policy: 'layered' } },
		};
		for (const { raw, path } of [
			{ raw: [], path: 'regionPresentation' },
			{ raw: { ...valid, regions: { zone: [] } }, path: 'regionPresentation.regions.zone' },
			{
				raw: { ...valid, regions: { zone: { layoutOrder: 'a0', policy: 'force' } } },
				path: 'regionPresentation.regions.zone.policy',
			},
			{
				raw: { ...valid, regions: { zone: { layoutOrder: 'a0' } } },
				path: 'regionPresentation.regions.zone.policy',
			},
			{
				raw: { ...valid, regions: { zone: { layoutOrder: 'bad!', policy: 'layered' } } },
				path: 'regionPresentation.regions.zone.layoutOrder',
			},
			{
				raw: { ...valid, regions: { zone: { layoutOrder: 'a0', policy: 'layered', extra: true } } },
				path: 'regionPresentation.regions.zone.extra',
			},
		]) {
			const diagnostics: Parameters<typeof mapRegionPresentation>[1]['diagnostics'] = [];
			mapRegionPresentation(raw, { diagnostics });
			expect(diagnostics.map(({ path: parts }) => parts.join('.'))).toContain(path);
		}
	});
});
