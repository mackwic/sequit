import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	EndpointKind,
	JunctionOperator,
	LaneOrientation,
	LayoutPolicy,
	type LogicDocument,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
	REGION_LANE_PRESENTATION_SCHEMA,
	REGION_PERSISTENCE_FORMAT,
	REGION_POLICY_PERSISTENCE_FORMAT,
	REGION_POLICY_PRESENTATION_SCHEMA,
	REGION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { reconcileSharedDocument } from '../../../../src/lib/infrastructure/collaboration/reconcile-shared-document';
import { readSharedCommand } from '../../../../src/lib/infrastructure/collaboration/shared-command-codec';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import {
	importLogicDocument,
	readLogicDocument,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YJS_REGION_POLICY_DOCUMENT_FORMAT,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsDocumentRepository } from '../../../../src/lib/infrastructure/collaboration/yjs-document-repository';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { SharedCommandKind } from '../../../../src/lib/infrastructure/document/shared-document-command';
import { validLogicDocument } from '../../../support/builders/logic-document';
import {
	regionLaneDocument,
	regionLaneDocumentWithRootLanes,
} from '../../../support/builders/region-lane-document';
import { persistedRegionDocument } from '../../core/layout/nested-region-fixture';

function restored(source: LogicDocument = regionLaneDocument()): Y.Doc {
	const original = new Y.Doc();
	importLogicDocument(original, source);
	const replica = new Y.Doc();
	Y.applyUpdate(replica, Y.encodeStateAsUpdate(original));
	original.destroy();
	return replica;
}

function regionLaneMap(document: Y.Doc, regionId = 'shared'): Y.Map<Y.Map<unknown>> {
	const regionLanes = document
		.getMap<Y.Map<Y.Map<unknown>>>(YjsCollection.RegionLanes)
		.get(regionId);
	if (!(regionLanes instanceof Y.Map)) throw new Error(`Expected region lanes for ${regionId}`);
	return regionLanes;
}

function paths(document: Y.Doc): readonly string[] {
	const result = readLogicDocument(document);
	if (result.ok) return [];
	return result.diagnostics.map(({ path }) => path.join('.'));
}

describe('Yjs region lane presentation', () => {
	it('decodes and executes a new local node with an explicit region and lane', () => {
		const document = restored();
		try {
			const command = readSharedCommand({
				op: 'create',
				target: { kind: 'node', id: 'new-local' },
				properties: {
					natureId: 'goal',
					markdown: 'New local node',
					regionId: 'shared',
					laneId: 'sales',
				},
			});
			const result = executeSharedCommands(document, [
				command,
				readSharedCommand({
					op: 'create',
					target: { kind: 'group', id: 'new-local-group' },
					properties: { label: 'Local group', regionId: 'shared', laneId: 'sales' },
				}),
				readSharedCommand({
					op: 'create',
					target: { kind: 'junction', id: 'new-local-junction' },
					properties: { operator: 'xor', regionId: 'shared', laneId: 'sales' },
				}),
			]);
			expect(result.nodes.find(({ id }) => id === 'new-local')).toMatchObject({
				regionId: 'shared',
				laneId: 'sales',
			});
			expect(result.groups.find(({ id }) => id === 'new-local-group')).toMatchObject({
				regionId: 'shared',
				laneId: 'sales',
			});
			expect(result.junctions.find(({ id }) => id === 'new-local-junction')).toMatchObject({
				regionId: 'shared',
				laneId: 'sales',
			});
			expect(readLogicDocument(document)).toMatchObject({ ok: true });
			expect(() =>
				readSharedCommand({
					op: 'create',
					target: { kind: 'node', id: 'invalid-local' },
					properties: {
						natureId: 'goal',
						markdown: 'Invalid local node',
						regionId: '',
						laneId: 'sales',
					},
				}),
			).toThrow('ID must contain 1 to 128 bytes');
		} finally {
			document.destroy();
		}
	});

	it('keeps the local lane on a newly grouped endpoint and rejects cross-lane grouping', () => {
		const document = restored();
		const grouped = executeSharedCommands(document, [
			{ op: SharedCommandKind.Group, id: 'service-group', label: 'Service', members: ['target'] },
		]);
		expect(grouped.groups.find(({ id }) => id === 'service-group')).toMatchObject({
			regionId: 'shared',
			laneId: 'service',
		});
		expect(grouped.nodes.find(({ id }) => id === 'target')).not.toHaveProperty('laneId');
		const crossing = restored();
		expect(() =>
			executeSharedCommands(crossing, [
				{
					op: SharedCommandKind.Group,
					id: 'cross-local-lanes',
					label: 'Cross lanes',
					members: ['target', 'container'],
				},
			]),
		).toThrow('même voie');
		crossing.destroy();
		document.destroy();
	});

	it('groups root-owned elements in the earlier region format without an invented region id', () => {
		const previous: LogicDocument = {
			...validLogicDocument(),
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			regionPresentation: { schemaVersion: REGION_PRESENTATION_SCHEMA, regions: [] },
		};
		const document = restored(previous);
		try {
			expect(readLogicDocument(document)).toMatchObject({ ok: true });
			const result = executeSharedCommands(document, [
				{
					op: SharedCommandKind.Group,
					id: 'root-group',
					label: 'Root group',
					members: ['orphan-group', 'isolated'],
				},
			]);
			expect(result.groups.find(({ id }) => id === 'root-group')).toMatchObject({
				id: 'root-group',
				label: 'Root group',
			});
			expect(result.groups.find(({ id }) => id === 'root-group')).not.toHaveProperty('regionId');
			expect(readLogicDocument(document)).toMatchObject({ ok: true });
		} finally {
			document.destroy();
		}
	});

	it('migrates format 6 local lanes after live format 7 binary restoration', () => {
		const document = restored();
		const meta = document.getMap(YjsCollection.Meta);
		expect(meta.get('yjsLiveDocumentFormat')).toBe(YJS_REGION_LANE_DOCUMENT_FORMAT);
		expect(meta.get('regionPresentationSchema')).toBe(REGION_LANE_PRESENTATION_SCHEMA);
		expect(document.getMap(YjsCollection.RegionLanes).size).toBe(1);
		expect(regionLaneMap(document).size).toBe(2);
		expect(regionLaneMap(document).get('sales')?.get('label')).toBeInstanceOf(Y.Text);
		const result = readLogicDocument(document);
		expect(result).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: REGION_POLICY_PERSISTENCE_FORMAT,
				regionPresentation: { schemaVersion: REGION_POLICY_PRESENTATION_SCHEMA },
			},
		});
		if (!result.ok) throw new Error('Expected valid region lane document');
		const shared = result.value.regionPresentation?.regions.find(({ id }) => id === 'shared');
		expect(shared?.policy).toBe(LayoutPolicy.SharedLanes);
		expect(shared?.lanePresentation).toMatchObject({
			laneOrientation: LaneOrientation.Parallel,
			lanes: [
				{ id: 'sales', label: 'Sales' },
				{ id: 'service', label: 'Service' },
			],
		});
		const ordinary = result.value.regionPresentation?.regions.find(({ id }) => id === 'ordinary');
		expect(ordinary?.policy).toBe(LayoutPolicy.Layered);
		expect(ordinary).not.toHaveProperty('lanePresentation');
		expect(result.value.groups.find(({ id }) => id === 'container')).toMatchObject({
			regionId: 'shared',
			laneId: 'sales',
		});
		document.destroy();
	});

	it('migrates format 7 root lanes and local lanes to explicit leaf policies', () => {
		const source = regionLaneDocumentWithRootLanes();
		const presentation = source.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const previous: LogicDocument = {
			...source,
			persistenceFormat: REGION_COMPOSITION_PERSISTENCE_FORMAT,
			regionPresentation: {
				schemaVersion: REGION_COMPOSITION_PRESENTATION_SCHEMA,
				regions: presentation.regions,
			},
		};
		const document = restored(previous);
		try {
			const meta = document.getMap(YjsCollection.Meta);
			expect(meta.get('yjsLiveDocumentFormat')).toBe(YJS_REGION_COMPOSITION_DOCUMENT_FORMAT);
			const result = readLogicDocument(document);
			expect(result).toMatchObject({
				ok: true,
				value: {
					persistenceFormat: REGION_POLICY_PERSISTENCE_FORMAT,
					presentation: { policy: LayoutPolicy.SharedLanes },
					regionPresentation: { schemaVersion: REGION_POLICY_PRESENTATION_SCHEMA },
				},
			});
			if (!result.ok) throw new Error('Expected migrated composition document');
			const regions = result.value.regionPresentation?.regions;
			expect(regions?.find(({ id }) => id === 'shared')?.policy).toBe(LayoutPolicy.SharedLanes);
			expect(regions?.find(({ id }) => id === 'ordinary')?.policy).toBe(LayoutPolicy.SharedLanes);
		} finally {
			document.destroy();
		}
	});

	it('round trips a new explicit region policy through live format 9 and binary restoration', () => {
		const previous = regionLaneDocument();
		const presentation = previous.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const source: LogicDocument = {
			...previous,
			persistenceFormat: REGION_POLICY_PERSISTENCE_FORMAT,
			regionPresentation: {
				schemaVersion: REGION_POLICY_PRESENTATION_SCHEMA,
				regions: presentation.regions.map((region) => {
					if (region.id === 'shared') return { ...region, policy: LayoutPolicy.SharedLanes };
					return region;
				}),
			},
		};
		const document = restored(source);
		try {
			const meta = document.getMap(YjsCollection.Meta);
			expect(meta.get('yjsLiveDocumentFormat')).toBe(YJS_REGION_POLICY_DOCUMENT_FORMAT);
			expect(meta.get('persistenceFormat')).toBe(REGION_POLICY_PERSISTENCE_FORMAT);
			expect(meta.get('regionPresentationSchema')).toBe(REGION_POLICY_PRESENTATION_SCHEMA);
			expect(
				document.getMap<Y.Map<unknown>>(YjsCollection.Regions).get('shared')?.get('policy'),
			).toBe(LayoutPolicy.SharedLanes);
			const result = readLogicDocument(document);
			expect(result).toMatchObject({
				ok: true,
				value: {
					persistenceFormat: REGION_POLICY_PERSISTENCE_FORMAT,
					regionPresentation: {
						schemaVersion: REGION_POLICY_PRESENTATION_SCHEMA,
						regions: [
							{ id: 'ordinary', policy: LayoutPolicy.Layered },
							{ id: 'shared', policy: LayoutPolicy.SharedLanes },
						],
					},
				},
			});
			if (!result.ok) throw new Error('Expected valid explicit region policy document');
			const second = restored(result.value);
			try {
				expect(readLogicDocument(second)).toEqual(result);
			} finally {
				second.destroy();
			}
		} finally {
			document.destroy();
		}
	});

	it('keeps lane identifiers scoped to their leaf after binary restoration', () => {
		const source = regionLaneDocument();
		const presentation = source.regionPresentation;
		const shared = presentation?.regions.find(({ id }) => id === 'shared');
		if (presentation === undefined || shared?.lanePresentation === undefined)
			throw new Error('Expected shared lanes');
		const sharedLanes = shared.lanePresentation;
		const withTwoLaneLeaves: LogicDocument = {
			...source,
			regionPresentation: {
				schemaVersion: REGION_LANE_PRESENTATION_SCHEMA,
				regions: presentation.regions.map((region) => {
					if (region.id === 'ordinary') return { ...region, lanePresentation: sharedLanes };
					return region;
				}),
			},
			groups: source.groups.map((group) => {
				if (group.regionId === 'ordinary') return { ...group, laneId: 'sales' };
				return group;
			}),
			nodes: source.nodes.map((node) => {
				if (node.regionId === 'ordinary') return { ...node, laneId: 'service' };
				return node;
			}),
		};
		const document = restored(withTwoLaneLeaves);
		expect(regionLaneMap(document, 'shared').has('sales')).toBe(true);
		expect(regionLaneMap(document, 'ordinary').has('sales')).toBe(true);
		expect(paths(document)).toEqual([]);
		document.destroy();
	});

	it('restores root and leaf-local lane collections independently', () => {
		const document = restored(regionLaneDocumentWithRootLanes());
		expect(document.getMap(YjsCollection.Lanes).size).toBe(2);
		expect(regionLaneMap(document).size).toBe(2);
		const result = readLogicDocument(document);
		expect(result).toMatchObject({
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
		document.destroy();
	});

	it('preserves local Y.Text identity while reconciling and clears local data on downgrade', () => {
		const document = restored();
		const title = document.getMap(YjsCollection.Meta).get('title');
		const lanes = regionLaneMap(document);
		const sales = lanes.get('sales');
		const label = sales?.get('label');
		const source = regionLaneDocument();
		const presentation = source.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const next = {
			...source,
			regionPresentation: {
				schemaVersion: REGION_LANE_PRESENTATION_SCHEMA,
				regions: presentation.regions.map((region) => {
					if (region.id !== 'shared' || region.lanePresentation === undefined) return region;
					return {
						...region,
						lanePresentation: {
							...region.lanePresentation,
							laneOrientation: LaneOrientation.Transverse,
							lanes: region.lanePresentation.lanes.map((lane) => {
								if (lane.id === 'sales') return { ...lane, label: 'Commercial' };
								return lane;
							}),
						},
					};
				}),
			},
		};
		reconcileSharedDocument(document, next, 'edit');
		expect(document.getMap(YjsCollection.Meta).get('title')).toBe(title);
		expect(regionLaneMap(document)).toBe(lanes);
		expect(regionLaneMap(document).get('sales')).toBe(sales);
		expect(regionLaneMap(document).get('sales')?.get('label')).toBe(label);
		if (!(label instanceof Y.Text)) throw new Error('Expected shared lane label');
		expect(label.toJSON()).toBe('Commercial');
		expect(paths(document)).toEqual([]);
		reconcileSharedDocument(document, validLogicDocument(), 'downgrade');
		expect(document.getMap(YjsCollection.RegionLanes).size).toBe(0);
		expect(document.getMap(YjsCollection.Regions).size).toBe(0);
		expect(document.getMap(YjsCollection.Meta).has('regionPresentationSchema')).toBe(false);
		expect(paths(document)).toEqual([]);
		document.destroy();
	});

	it('reconciles a lane replacement and repairs malformed local Yjs maps in place', () => {
		const source = regionLaneDocument();
		const presentation = source.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const next: LogicDocument = {
			...source,
			regionPresentation: {
				schemaVersion: REGION_LANE_PRESENTATION_SCHEMA,
				regions: presentation.regions.map((region) => {
					if (region.id !== 'shared' || region.lanePresentation === undefined) return region;
					return {
						...region,
						lanePresentation: {
							...region.lanePresentation,
							lanes: region.lanePresentation.lanes.map((lane) => {
								if (lane.id !== 'service') return lane;
								return { ...lane, id: 'support', label: 'Support' };
							}),
						},
					};
				}),
			},
			nodes: source.nodes.map((node) => {
				if (node.laneId !== 'service') return node;
				return { ...node, laneId: 'support' };
			}),
		};
		const document = restored(source);
		const lanes = regionLaneMap(document);
		const sales = lanes.get('sales');
		const salesLabel = sales?.get('label');
		reconcileSharedDocument(document, next, 'replace lane');
		expect(regionLaneMap(document)).toBe(lanes);
		expect(regionLaneMap(document).get('sales')).toBe(sales);
		expect(regionLaneMap(document).get('sales')?.get('label')).toBe(salesLabel);
		expect(regionLaneMap(document).has('service')).toBe(false);
		expect(regionLaneMap(document).has('support')).toBe(true);
		expect(paths(document)).toEqual([]);
		document.destroy();

		for (const malformed of ['lane', 'region collection'] as const) {
			const corrupted = restored(source);
			const collection = corrupted.getMap<unknown>(YjsCollection.RegionLanes);
			if (malformed === 'lane') {
				const local = collection.get('shared');
				if (!(local instanceof Y.Map)) throw new Error('Expected local lanes');
				local.set('service', 'broken');
			} else collection.set('shared', 'broken');
			reconcileSharedDocument(corrupted, source, 'repair lanes');
			expect(regionLaneMap(corrupted).get('service')).toBeInstanceOf(Y.Map);
			expect(paths(corrupted), malformed).toEqual([]);
			corrupted.destroy();
		}
	});

	it('round trips a region-local junction and persists a new node in its lane', async () => {
		const source = regionLaneDocument();
		const withJunction: LogicDocument = {
			...source,
			junctions: [
				...source.junctions,
				{
					kind: EndpointKind.Junction,
					id: 'decision',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a9'),
					regionId: 'shared',
					laneId: 'sales',
				},
			],
		};
		const document = restored(withJunction);
		const shared = document.getMap<Y.Map<unknown>>(YjsCollection.Junctions).get('decision');
		expect(shared?.get('regionId')).toBe('shared');
		expect(shared?.get('laneId')).toBe('sales');
		const repository = new YjsDocumentRepository(document);
		try {
			const before = repository.read();
			if (!before.ok) throw new Error(before.diagnostics.map(({ message }) => message).join('; '));
			expect(before.value.junctions.find(({ id }) => id === 'decision')).toMatchObject({
				regionId: 'shared',
				laneId: 'sales',
			});
			const result = await repository.persist({
				nodeAdditions: [
					{
						kind: EndpointKind.Node,
						id: 'new-sales',
						natureId: 'goal',
						markdown: 'New sales task',
						layoutOrder: orderKey('a8'),
						regionId: 'shared',
						laneId: 'sales',
					},
				],
				groupAdditions: [],
				relationAdditions: [],
				endpointOrderChanges: [],
				nodeMarkdownReplacements: [],
			});
			expect(result).toMatchObject({ ok: true });
			const updated = repository.read();
			expect(updated).toMatchObject({ ok: true });
			if (!updated.ok) throw new Error('Expected updated lane document');
			expect(updated.value.nodes.find(({ id }) => id === 'new-sales')).toMatchObject({
				regionId: 'shared',
				laneId: 'sales',
			});
		} finally {
			repository.destroy();
			document.destroy();
		}
	});

	it('diagnoses malformed local lane fields at their own paths', () => {
		const cases: readonly {
			readonly name: string;
			readonly mutate: (document: Y.Doc) => void;
			readonly path: string;
		}[] = [
			{
				name: 'unsupported orientation',
				mutate: (document) =>
					document
						.getMap<Y.Map<unknown>>(YjsCollection.Regions)
						.get('shared')
						?.set('laneOrientation', 'diagonal'),
				path: 'regionPresentation.regions.shared.lanePresentation.laneOrientation',
			},
			{
				name: 'missing growth',
				mutate: (document) =>
					document
						.getMap<Y.Map<unknown>>(YjsCollection.Regions)
						.get('shared')
						?.delete('laneGrowth'),
				path: 'regionPresentation.regions.shared.lanePresentation.growth',
			},
			{
				name: 'missing label',
				mutate: (document) => regionLaneMap(document).get('sales')?.delete('label'),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes.sales.label',
			},
			{
				name: 'malformed lane map',
				mutate: (document) => {
					const malformed = new Y.Map<unknown>();
					malformed.set('sales', 'broken');
					document.getMap(YjsCollection.RegionLanes).set('shared', malformed);
				},
				path: 'regionPresentation.regions.shared.lanePresentation.lanes.sales',
			},
			{
				name: 'malformed region lane collection',
				mutate: (document) => document.getMap(YjsCollection.RegionLanes).set('shared', 'broken'),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes',
			},
			{
				name: 'unsupported growth',
				mutate: (document) =>
					document
						.getMap<Y.Map<unknown>>(YjsCollection.Regions)
						.get('shared')
						?.set('laneGrowth', 'rigid'),
				path: 'regionPresentation.regions.shared.lanePresentation.growth',
			},
			{
				name: 'wrong composition schema',
				mutate: (document) =>
					document.getMap(YjsCollection.Meta).set('regionPresentationSchema', 4),
				path: 'regionPresentation.schemaVersion',
			},
			{
				name: 'orphan region lanes',
				mutate: (document) =>
					document.getMap(YjsCollection.RegionLanes).set('missing', new Y.Map()),
				path: 'regionPresentation.regions.missing.lanePresentation',
			},
			{
				name: 'grid fields in lane region format',
				mutate: (document) =>
					document.getMap(YjsCollection.Meta).set('gridMinimumColumnWidths', [10, 10]),
				path: 'regionPresentation.grid',
			},
		];
		for (const testCase of cases) {
			const document = restored();
			testCase.mutate(document);
			expect(paths(document), testCase.name).toContain(testCase.path);
			document.destroy();
		}
	});

	it('rejects local lane data in the earlier region format', () => {
		const previous = {
			...validLogicDocument(),
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			regionPresentation: { schemaVersion: REGION_PRESENTATION_SCHEMA, regions: [] },
		};
		const document = new Y.Doc();
		importLogicDocument(document, previous);
		document.getMap(YjsCollection.RegionLanes).set('orphan', new Y.Map());
		expect(paths(document)).toContain('regionPresentation.regions.orphan.lanePresentation');
		document.destroy();

		const inline = restored(persistedRegionDocument());
		inline
			.getMap<Y.Map<unknown>>(YjsCollection.Regions)
			.get('left')
			?.set('laneOrientation', LaneOrientation.Parallel);
		expect(paths(inline)).toContain('regionPresentation.regions.left.lanePresentation');
		inline.destroy();
	});
});
