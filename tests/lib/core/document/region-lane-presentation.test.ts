import { describe, expect, it } from 'vitest';

import {
	type LogicDocument,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import {
	normalizeRegionPresentation,
	RegionPresentationStatus,
} from '../../../../src/lib/core/document/region-presentation';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import {
	regionLaneDocument,
	regionLaneDocumentWithRootLanes,
} from '../../../support/builders/region-lane-document';

type Region = NonNullable<LogicDocument['regionPresentation']>['regions'][number];

function paths(document: LogicDocument): readonly string[] {
	const result = validateLogicDocument(document);
	if (result.ok) return [];
	return result.diagnostics.map(({ path }) => path.join('.'));
}

function normalized(document: LogicDocument) {
	const regions = document.regionPresentation?.regions ?? [];
	const assignments = new Map<string, string>();
	for (const endpoint of [...document.groups, ...document.nodes, ...document.junctions])
		if (endpoint.regionId !== undefined) assignments.set(endpoint.id, endpoint.regionId);
	return normalizeRegionPresentation(document, regions, assignments);
}

describe('persisted region leaf lanes', () => {
	it('normalizes local lane order and inherits region and lane through groups', () => {
		const source = regionLaneDocument();
		expect(paths(source)).toEqual([]);
		const result = normalized(source);
		expect(result.status).toBe(RegionPresentationStatus.Ready);
		if (result.status !== RegionPresentationStatus.Ready) return;
		expect(result.value.regions.map(({ id }) => id)).toEqual(['@root', 'shared', 'ordinary']);
		expect(result.value.regions[1]?.lanePresentation?.lanes.map(({ id }) => id)).toEqual([
			'sales',
			'service',
		]);
		for (const id of ['container', 'source-a', 'source-b', 'choice']) {
			expect(result.value.regionByEndpointId.get(id)).toBe('shared');
			expect(result.value.laneByEndpointId.get(id)).toBe('sales');
		}
		expect(result.value.laneByEndpointId.get('target')).toBe('service');
		expect(result.value.laneByEndpointId.get('isolated')).toBeUndefined();
		const presentation = source.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const permuted = normalized({
			...source,
			regionPresentation: {
				...presentation,
				regions: [...presentation.regions].reverse().map((region) => {
					if (region.lanePresentation === undefined) return region;
					return {
						...region,
						lanePresentation: {
							...region.lanePresentation,
							lanes: [...region.lanePresentation.lanes].reverse(),
						},
					};
				}),
			},
			groups: [...source.groups].reverse(),
			nodes: [...source.nodes].reverse(),
		});
		expect(permuted).toEqual(result);
		const sameOrder = normalized({
			...source,
			regionPresentation: {
				...presentation,
				regions: presentation.regions.map((region) => {
					if (region.lanePresentation === undefined) return region;
					return {
						...region,
						lanePresentation: {
							...region.lanePresentation,
							lanes: [...region.lanePresentation.lanes]
								.reverse()
								.map((lane) => ({ ...lane, layoutOrder: 'a0' })),
						},
					};
				}),
			},
		});
		expect(sameOrder.status).toBe(RegionPresentationStatus.Ready);
		if (sameOrder.status !== RegionPresentationStatus.Ready) return;
		expect(sameOrder.value.regions[1]?.lanePresentation?.lanes.map(({ id }) => id)).toEqual([
			'sales',
			'service',
		]);
	});

	it('keeps lane ids scoped to their own leaf and can also retain root lanes', () => {
		const source = regionLaneDocument();
		const presentation = source.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const shared = presentation.regions.find(({ id }) => id === 'shared');
		if (shared?.lanePresentation === undefined) throw new Error('Expected shared lanes');
		const sharedLanes = shared.lanePresentation;
		const secondLeaf: LogicDocument = {
			...source,
			regionPresentation: {
				...presentation,
				regions: presentation.regions.map((region) => {
					if (region.id !== 'ordinary') return region;
					return { ...region, lanePresentation: sharedLanes };
				}),
			},
			groups: source.groups.map((group) => {
				if (group.id === 'container') return group;
				return { ...group, laneId: 'sales' };
			}),
			nodes: source.nodes.map((node) => {
				if (node.id !== 'isolated') return node;
				return { ...node, laneId: 'service' };
			}),
		};
		expect(paths(secondLeaf)).toEqual([]);
		expect(paths(regionLaneDocumentWithRootLanes())).toEqual([]);
	});

	it('locates malformed contracts and assignments at their source paths', () => {
		const source = regionLaneDocument();
		const presentation = source.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const replaceShared = (change: (region: Region) => Region): LogicDocument => ({
			...source,
			regionPresentation: {
				...presentation,
				regions: presentation.regions.map((region) => {
					if (region.id !== 'shared') return region;
					return change(region);
				}),
			},
		});
		const shared = presentation.regions.find(({ id }) => id === 'shared');
		if (shared?.lanePresentation === undefined) throw new Error('Expected shared lanes');
		const local = shared.lanePresentation;
		const firstLane = local.lanes[0];
		if (firstLane === undefined) throw new Error('Expected first lane');
		const withInvalidLaneField = (field: string, value: unknown): LogicDocument => {
			const document = replaceShared((region) => ({
				...region,
				lanePresentation: { ...local },
			}));
			const changed = document.regionPresentation?.regions.find(({ id }) => id === 'shared');
			if (changed?.lanePresentation === undefined) throw new Error('Expected local lanes');
			Reflect.set(changed.lanePresentation, field, value);
			return document;
		};
		const withInvalidContract = (value: unknown): LogicDocument => {
			const document = replaceShared((region) => ({ ...region }));
			const changed = document.regionPresentation?.regions.find(({ id }) => id === 'shared');
			if (changed === undefined) throw new Error('Expected shared region');
			Reflect.set(changed, 'lanePresentation', value);
			return document;
		};
		const withInvalidLaneEntry = (field: string, value: unknown): LogicDocument => {
			const document = replaceShared((region) => ({
				...region,
				lanePresentation: { ...local, lanes: local.lanes.map((lane) => ({ ...lane })) },
			}));
			const changed = document.regionPresentation?.regions.find(({ id }) => id === 'shared');
			const lane = changed?.lanePresentation?.lanes.find(({ id }) => id === 'sales');
			if (lane === undefined) throw new Error('Expected sales lane');
			Reflect.set(lane, field, value);
			return document;
		};
		const cases = [
			{
				document: withInvalidContract(null),
				path: 'regionPresentation.regions.shared.lanePresentation',
			},
			{
				document: withInvalidContract(7),
				path: 'regionPresentation.regions.shared.lanePresentation',
			},
			{
				document: withInvalidLaneField('laneOrientation', 'diagonal'),
				path: 'regionPresentation.regions.shared.lanePresentation.laneOrientation',
			},
			{
				document: withInvalidLaneField('growth', 'fixed'),
				path: 'regionPresentation.regions.shared.lanePresentation.growth',
			},
			{
				document: replaceShared((region) => ({
					...region,
					lanePresentation: { ...local, lanes: local.lanes.slice(0, 1) },
				})),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes',
			},
			{
				document: withInvalidLaneField('lanes', 'invalid'),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes',
			},
			{
				document: withInvalidLaneField('lanes', [null, firstLane]),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes..id',
			},
			{
				document: withInvalidLaneEntry('id', 7),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes..id',
			},
			{
				document: withInvalidLaneEntry('label', 7),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes.sales.label',
			},
			{
				document: withInvalidLaneEntry('layoutOrder', 7),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes.sales.layoutOrder',
			},
			{
				document: replaceShared((region) => ({
					...region,
					lanePresentation: {
						...local,
						lanes: local.lanes.map((lane) => {
							if (lane.id === 'sales') return { ...lane, id: '' };
							return lane;
						}),
					},
				})),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes..id',
			},
			{
				document: replaceShared((region) => ({
					...region,
					lanePresentation: { ...local, lanes: [firstLane, firstLane] },
				})),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes.sales',
			},
			{
				document: replaceShared((region) => ({
					...region,
					lanePresentation: {
						...local,
						lanes: local.lanes.map((lane) => ({ ...lane, layoutOrder: 'bad!' })),
					},
				})),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes.sales.layoutOrder',
			},
			{
				document: replaceShared((region) => ({
					...region,
					lanePresentation: {
						...local,
						lanes: local.lanes.map((lane) => ({ ...lane, label: '' })),
					},
				})),
				path: 'regionPresentation.regions.shared.lanePresentation.lanes.sales.label',
			},
			{
				document: {
					...source,
					nodes: source.nodes.map((node) => {
						if (node.id !== 'target') return node;
						const result = { ...node };
						delete result.laneId;
						return result;
					}),
				},
				path: 'nodes.target.lane',
			},
			{
				document: {
					...source,
					nodes: source.nodes.map((node) => {
						if (node.id !== 'target') return node;
						return { ...node, laneId: 'missing' };
					}),
				},
				path: 'nodes.target.lane',
			},
			{
				document: {
					...source,
					nodes: source.nodes.map((node) => {
						if (node.id !== 'source-a') return node;
						return { ...node, laneId: 'sales' };
					}),
				},
				path: 'nodes.source-a.lane',
			},
			{
				document: {
					...source,
					nodes: source.nodes.map((node) => {
						if (node.id !== 'isolated') return node;
						return { ...node, laneId: 'sales' };
					}),
				},
				path: 'nodes.isolated.lane',
			},
			{
				document: {
					...source,
					regionPresentation: {
						...presentation,
						regions: presentation.regions.map((region) => {
							if (region.id !== 'ordinary') return region;
							return { ...region, parentId: 'shared' };
						}),
					},
				},
				path: 'regionPresentation.regions.shared.lanePresentation',
			},
		];
		for (const { document, path } of cases) expect(paths(document), path).toContain(path);
	});

	it('rejects local lanes hidden in old region format 4', () => {
		const source = regionLaneDocument();
		const regions = source.regionPresentation?.regions ?? [];
		const downgraded: LogicDocument = {
			...source,
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			regionPresentation: { schemaVersion: REGION_PRESENTATION_SCHEMA, regions },
		};
		expect(paths(downgraded)).toContain('regionPresentation.regions.shared.lanePresentation');
	});
});
