import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import type { Bounds, Point } from '../../../../src/lib/core/layout/layout-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import type { RegionInput } from '../../../../src/lib/core/layout/region-composition-types';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';
import {
	type RegionCompositionGeometryCandidate,
	validateRegionCompositionGeometry as validateCompositionDiagnostic,
	validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry,
} from '../../../../src/lib/core/layout/region-composition-validation';
import { validateParentRouteContacts } from '../../../../src/lib/core/layout/region-composition-validation-detail';
import {
	depthTwoRegionDocument,
	depthTwoRegionInput,
	nestedRegionInput,
	regionDocument,
	selectedNestedRegionLayout,
} from './nested-region-fixture';

const CENTER_Y = 200;
const SOURCE_BOUNDS = { x: 160, y: 190, width: 40, height: 20 };
const TARGET_BOUNDS = { x: 800, y: 190, width: 40, height: 20 };
const SOURCE_REGIONS: readonly Bounds[] = [
	{ x: 40, y: 40, width: 500, height: 320 },
	{ x: 80, y: 80, width: 400, height: 240 },
	{ x: 120, y: 120, width: 300, height: 160 },
];
const TARGET_REGION = { x: 700, y: 40, width: 240, height: 320 };
const FOREIGN_REGION = { x: 580, y: 40, width: 70, height: 80 };
const INNER_FOREIGN_REGION = { x: 490, y: 100, width: 40, height: 40 };

function point(x: number): Point {
	return { x, y: CENTER_Y };
}

function parentId(sourceIds: readonly string[], index: number): string {
	if (index === 0) return '@root';
	return defined(sourceIds[index - 1]);
}

function changedAt<T>(items: readonly T[], target: number, change: (item: T) => T): T[] {
	return items.map((item, index) => {
		if (index === target) return change(item);
		return item;
	});
}

function oneLevelFixture() {
	const { prepared, result } = selectedNestedRegionLayout();
	const normalized = normalizeRegionCompositionModel(prepared.graph, nestedRegionInput());
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error(normalized.diagnostic.message);
	return { model: normalized.model, candidate: result };
}

function groupedLeafFixture(innerBounds: Bounds = { x: 60, y: 60, width: 100, height: 100 }) {
	const source = regionDocument();
	const document: LogicDocument = {
		...source,
		groups: [
			{ kind: EndpointKind.Group, id: 'outer', label: 'Outer', layoutOrder: orderKey('a0') },
			{
				kind: EndpointKind.Group,
				id: 'inner',
				label: 'Inner',
				groupId: 'outer',
				layoutOrder: orderKey('a1'),
			},
		],
		nodes: [
			{
				...defined(source.nodes[0]),
				id: 'member',
				groupId: 'inner',
				layoutOrder: orderKey('a2'),
			},
		],
		relations: [],
	};
	const graph = createGraph(document);
	if (!graph.ok) throw new Error('Grouped region fixture graph must be valid.');
	const input: RegionInput = {
		regions: [
			{ id: '@root', layoutOrder: '0' },
			{ id: 'left', parentId: '@root', layoutOrder: 'a' },
		],
		regionByEndpointId: new Map([
			['outer', 'left'],
			['inner', 'left'],
			['member', 'left'],
		]),
	};
	const normalized = normalizeRegionCompositionModel(graph.value, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error(normalized.diagnostic.message);
	const translation = { x: 30, y: 30 };
	const elements = [
		{
			id: 'outer',
			kind: EndpointKind.Group,
			bounds: { x: 50, y: 50, width: 140, height: 140 },
		},
		{ id: 'inner', kind: EndpointKind.Group, bounds: innerBounds },
		{ id: 'member', kind: EndpointKind.Node, bounds: { x: 80, y: 90, width: 40, height: 20 } },
	];
	const candidate: RegionCompositionGeometryCandidate = {
		rootId: '@root',
		layout: { width: 300, height: 260, elements, relations: [] },
		regions: [
			{
				id: 'left',
				parentId: '@root',
				bounds: { x: 20, y: 20, width: 220, height: 220 },
				translation,
				localLayout: {
					width: 180,
					height: 180,
					elements: elements.map((element) => ({
						...element,
						bounds: {
							...element.bounds,
							x: element.bounds.x - translation.x,
							y: element.bounds.y - translation.y,
						},
					})),
					relations: [],
				},
			},
		],
		portals: [],
		ownedRoutes: [],
	};
	return { model: normalized.model, candidate };
}

function changedRegion(
	candidate: RegionCompositionGeometryCandidate,
	id: string,
	change: (
		region: RegionCompositionGeometryCandidate['regions'][number],
	) => RegionCompositionGeometryCandidate['regions'][number],
): RegionCompositionGeometryCandidate {
	return {
		...candidate,
		regions: candidate.regions.map((region) => {
			if (region.id === id) return change(region);
			return region;
		}),
	};
}

function fixture(
	depth: 1 | 2 | 3,
	reverse = false,
): {
	readonly model: Extract<
		ReturnType<typeof normalizeRegionCompositionModel>,
		{ status: 'ready' }
	>['model'];
	readonly candidate: RegionCompositionGeometryCandidate;
} {
	const document = regionDocument();
	let from = 'a-source';
	let to = 'c';
	if (reverse) {
		from = 'c';
		to = 'a-source';
	}
	const graph = createGraph({
		...document,
		nodes: document.nodes.filter(({ id }) => id === 'a-source' || id === 'c'),
		relations: [{ id: 'cross', from, to }],
	});
	if (!graph.ok) throw new Error('The composition fixture has an invalid source graph.');
	const sourceIds = Array.from({ length: depth }, (_, index) => `source-${index + 1}`);
	const innerForeignDefinitions: RegionInput['regions'][number][] = [];
	if (depth > 1)
		innerForeignDefinitions.push({
			id: 'foreign-inner',
			parentId: 'source-1',
			layoutOrder: 'b',
		});
	const input: RegionInput = {
		regions: [
			{ id: '@root', layoutOrder: '0' },
			...sourceIds.map((id, index) => ({
				id,
				parentId: parentId(sourceIds, index),
				layoutOrder: 'a',
			})),
			...innerForeignDefinitions,
			{ id: 'foreign', parentId: '@root', layoutOrder: 'b' },
			{ id: 'target', parentId: '@root', layoutOrder: 'c' },
		],
		regionByEndpointId: new Map([
			['a-source', defined(sourceIds.at(-1))],
			['c', 'target'],
		]),
	};
	const normalized = normalizeRegionCompositionModel(graph.value, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error(normalized.diagnostic.message);
	const regions: RegionCompositionGeometryCandidate['regions'][number][] = [
		...sourceIds.map((id, index) => ({
			id,
			parentId: parentId(sourceIds, index),
			bounds: defined(SOURCE_REGIONS[index]),
		})),
		...innerForeignDefinitions.map(({ id }) => ({
			id,
			parentId: 'source-1',
			bounds: INNER_FOREIGN_REGION,
		})),
		{ id: 'foreign', parentId: '@root', bounds: FOREIGN_REGION },
		{ id: 'target', parentId: '@root', bounds: TARGET_REGION },
	];
	const placedRegions = regions.map((region) => {
		const translation = { x: region.bounds.x, y: region.bounds.y };
		const globalElements = [];
		if (region.id === defined(sourceIds.at(-1)))
			globalElements.push({
				id: 'a-source',
				kind: EndpointKind.Node,
				bounds: SOURCE_BOUNDS,
			});
		if (region.id === 'target')
			globalElements.push({
				id: 'c',
				kind: EndpointKind.Node,
				bounds: TARGET_BOUNDS,
			});
		return {
			...region,
			translation,
			localLayout: {
				width: region.bounds.width,
				height: region.bounds.height,
				elements: globalElements.map((element) => ({
					...element,
					bounds: {
						...element.bounds,
						x: element.bounds.x - translation.x,
						y: element.bounds.y - translation.y,
					},
				})),
				relations: [],
			},
		};
	});
	const byId = new Map(regions.map((region) => [region.id, region]));
	const sourcePath = [...sourceIds].reverse();
	const ownedRoutes: RegionCompositionGeometryCandidate['ownedRoutes'][number][] = [];
	const portals: RegionCompositionGeometryCandidate['portals'][number][] = [];
	let previous = SOURCE_BOUNDS.x + SOURCE_BOUNDS.width;
	for (const id of sourcePath) {
		const bounds = defined(byId.get(id)).bounds;
		const right = bounds.x + bounds.width;
		ownedRoutes.push({
			relationId: 'cross',
			regionId: id,
			points: [point(previous), point(right)],
		});
		portals.push({
			relationId: 'cross',
			endpointId: 'a-source',
			regionId: id,
			side: RegionPortalSide.Right,
			point: point(right),
			localPoint: { x: bounds.width, y: CENTER_Y - bounds.y },
		});
		previous = right;
	}
	ownedRoutes.push({
		relationId: 'cross',
		regionId: '@root',
		points: [point(previous), point(TARGET_REGION.x)],
	});
	portals.push({
		relationId: 'cross',
		endpointId: 'c',
		regionId: 'target',
		side: RegionPortalSide.Left,
		point: point(TARGET_REGION.x),
		localPoint: { x: 0, y: CENTER_Y - TARGET_REGION.y },
	});
	ownedRoutes.push({
		relationId: 'cross',
		regionId: 'target',
		points: [point(TARGET_REGION.x), point(TARGET_BOUNDS.x)],
	});
	let routePoints = [
		point(SOURCE_BOUNDS.x + SOURCE_BOUNDS.width),
		...sourcePath.map((id) => {
			const bounds = defined(byId.get(id)).bounds;
			return point(bounds.x + bounds.width);
		}),
		point(TARGET_REGION.x),
		point(TARGET_BOUNDS.x),
	];
	let orderedPieces = ownedRoutes;
	let orderedPortals = portals;
	if (reverse) {
		routePoints = routePoints.toReversed();
		orderedPieces = ownedRoutes.toReversed().map((piece) => ({
			...piece,
			points: piece.points.toReversed(),
		}));
		orderedPortals = portals.toReversed();
	}
	return {
		model: normalized.model,
		candidate: {
			rootId: '@root',
			layout: {
				width: 1000,
				height: 400,
				elements: [
					{ id: 'a-source', kind: EndpointKind.Node, bounds: SOURCE_BOUNDS },
					{ id: 'c', kind: EndpointKind.Node, bounds: TARGET_BOUNDS },
				],
				relations: [{ id: 'cross', from, to, points: routePoints }],
			},
			regions: placedRegions,
			portals: orderedPortals,
			ownedRoutes: orderedPieces,
		},
	};
}

describe('generic region composition geometry', () => {
	it('keeps every nested group and its member inside the owning group bounds', () => {
		const valid = groupedLeafFixture();
		expect(validateRegionCompositionGeometry(valid.model, valid.candidate)).toBeUndefined();
		const escapedMember = groupedLeafFixture({ x: 60, y: 60, width: 35, height: 100 });
		expect(validateRegionCompositionGeometry(escapedMember.model, escapedMember.candidate)).toBe(
			'Element member leaves its parent group inner in leaf region left.',
		);
		const escapedInner = groupedLeafFixture({ x: 45, y: 60, width: 100, height: 100 });
		expect(validateRegionCompositionGeometry(escapedInner.model, escapedInner.candidate)).toBe(
			'Element inner leaves its parent group outer in leaf region left.',
		);
	});

	it('keeps a local relation in its leaf without inventing portals', () => {
		const document = regionDocument();
		const graph = createGraph({
			...document,
			nodes: document.nodes.filter(({ id }) => id === 'a-source' || id === 'a-target'),
			relations: [{ id: 'inside', from: 'a-source', to: 'a-target' }],
		});
		if (!graph.ok) throw new Error('The local relation fixture has an invalid graph.');
		const input: RegionInput = {
			regions: [
				{ id: '@root', layoutOrder: '0' },
				{ id: 'leaf', parentId: '@root', layoutOrder: 'a' },
			],
			regionByEndpointId: new Map([
				['a-source', 'leaf'],
				['a-target', 'leaf'],
			]),
		};
		const normalized = normalizeRegionCompositionModel(graph.value, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		const points = [point(200), point(300)];
		const elements = [
			{ id: 'a-source', kind: EndpointKind.Node, bounds: SOURCE_BOUNDS },
			{
				id: 'a-target',
				kind: EndpointKind.Node,
				bounds: { x: 300, y: 190, width: 40, height: 20 },
			},
		];
		const route = { id: 'inside', from: 'a-source', to: 'a-target', points };
		const leafBounds = defined(SOURCE_REGIONS[0]);
		const translation = { x: leafBounds.x, y: leafBounds.y };
		const candidate: RegionCompositionGeometryCandidate = {
			rootId: '@root',
			layout: {
				width: 600,
				height: 400,
				elements,
				relations: [route],
			},
			regions: [
				{
					id: 'leaf',
					parentId: '@root',
					bounds: leafBounds,
					translation,
					localLayout: {
						width: leafBounds.width,
						height: leafBounds.height,
						elements: elements.map((element) => ({
							...element,
							bounds: {
								...element.bounds,
								x: element.bounds.x - translation.x,
								y: element.bounds.y - translation.y,
							},
						})),
						relations: [
							{
								...route,
								points: points.map(({ x, y }) => ({
									x: x - translation.x,
									y: y - translation.y,
								})),
							},
						],
					},
				},
			],
			portals: [],
			ownedRoutes: [{ relationId: 'inside', regionId: 'leaf', points }],
		};
		expect(validateRegionCompositionGeometry(normalized.model, candidate)).toBeUndefined();
	});

	it('accepts the current one-level production composition', () => {
		const { prepared, result } = selectedNestedRegionLayout();
		const normalized = normalizeRegionCompositionModel(prepared.graph, nestedRegionInput());
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
	});
	it('accepts the current two-level production composition', () => {
		const input = depthTwoRegionInput();
		const { prepared, result } = selectedNestedRegionLayout(depthTwoRegionDocument(), input);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
	});

	it('requires every source element exactly once in its translated leaf layout', () => {
		const { prepared, result } = selectedNestedRegionLayout();
		const normalized = normalizeRegionCompositionModel(prepared.graph, nestedRegionInput());
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		const model = normalized.model;
		const source = defined(result.layout.elements.find(({ id }) => id === 'a-source'));
		expect(
			validateRegionCompositionGeometry(model, {
				...result,
				layout: {
					...result.layout,
					elements: [...result.layout.elements, source],
				},
			}),
		).toContain('each element exactly once');
		expect(
			validateRegionCompositionGeometry(model, {
				...result,
				layout: {
					...result.layout,
					elements: result.layout.elements.filter(({ id }) => id !== 'a-source'),
				},
			}),
		).toContain('each element exactly once');
		expect(
			validateRegionCompositionGeometry(model, {
				...result,
				regions: result.regions.map((region) => {
					if (region.id !== 'left') return region;
					return {
						...region,
						localLayout: {
							...region.localLayout,
							elements: region.localLayout.elements.filter(({ id }) => id !== 'a-source'),
						},
					};
				}),
			}),
		).toContain('each local element exactly once');
	});

	it('rejects altered translations and elements outside their owning leaf', () => {
		const { prepared, result } = selectedNestedRegionLayout();
		const normalized = normalizeRegionCompositionModel(prepared.graph, nestedRegionInput());
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		const model = normalized.model;
		expect(
			validateRegionCompositionGeometry(model, {
				...result,
				regions: result.regions.map((region) => {
					if (region.id !== 'middle') return region;
					return {
						...region,
						translation: { ...region.translation, x: region.translation.x + 1 },
					};
				}),
			}),
		).toContain('differs from its translated leaf layout');
		const middle = defined(result.regions.find(({ id }) => id === 'middle'));
		const escaped = {
			...defined(result.layout.elements.find(({ id }) => id === 'b')),
			bounds: {
				...defined(result.layout.elements.find(({ id }) => id === 'b')).bounds,
				x: middle.bounds.x - 1,
			},
		};
		expect(
			validateRegionCompositionGeometry(model, {
				...result,
				layout: {
					...result.layout,
					elements: result.layout.elements.map((element) => {
						if (element.id === 'b') return escaped;
						return element;
					}),
				},
				regions: result.regions.map((region) => {
					if (region.id !== 'middle') return region;
					return {
						...region,
						localLayout: {
							...region.localLayout,
							elements: region.localLayout.elements.map((element) => {
								if (element.id !== 'b') return element;
								return {
									...element,
									bounds: {
										...element.bounds,
										x: escaped.bounds.x - region.translation.x,
									},
								};
							}),
						},
					};
				}),
			}),
		).toContain('leaves its leaf region middle');
	});

	it('requires local relations exactly once and identical after translation', () => {
		const { prepared, result } = selectedNestedRegionLayout();
		const normalized = normalizeRegionCompositionModel(prepared.graph, nestedRegionInput());
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		const model = normalized.model;
		const original = defined(
			defined(result.regions.find(({ id }) => id === 'left')).localLayout.relations.find(
				({ id }) => id === 'inside-a',
			),
		);
		expect(
			validateRegionCompositionGeometry(model, {
				...result,
				regions: result.regions.map((region) => {
					if (region.id !== 'left') return region;
					return {
						...region,
						localLayout: {
							...region.localLayout,
							relations: [...region.localLayout.relations, original],
						},
					};
				}),
			}),
		).toContain('each local relation exactly once');
		expect(
			validateRegionCompositionGeometry(model, {
				...result,
				regions: result.regions.map((region) => {
					if (region.id !== 'left') return region;
					return {
						...region,
						localLayout: {
							...region.localLayout,
							relations: [{ ...original, points: [...original.points, { x: 0, y: 0 }] }],
						},
					};
				}),
			}),
		).toContain('differs from its translated leaf layout');
	});

	it('rejects contact between two routes owned by the same intermediate parent', () => {
		const input = depthTwoRegionInput();
		const document = depthTwoRegionDocument();
		const graph = createGraph({
			...document,
			relations: [...document.relations, { id: 'parallel-branch', from: 'a-target', to: 'c' }],
		});
		if (!graph.ok) throw new Error('The parallel relation fixture has an invalid graph.');
		const normalized = normalizeRegionCompositionModel(graph.value, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error(normalized.diagnostic.message);
		const { result } = selectedNestedRegionLayout(document, input);
		const original = defined(result.layout.relations.find(({ id }) => id === 'inside-branch'));
		const candidate = {
			...result,
			layout: {
				...result.layout,
				relations: [...result.layout.relations, { ...original, id: 'parallel-branch' }],
			},
			portals: [
				...result.portals,
				...result.portals
					.filter(({ relationId }) => relationId === 'inside-branch')
					.map((portal) => ({ ...portal, relationId: 'parallel-branch' })),
			],
			ownedRoutes: [
				...result.ownedRoutes,
				...result.ownedRoutes
					.filter(({ relationId }) => relationId === 'inside-branch')
					.map((route) => ({ ...route, relationId: 'parallel-branch' })),
			],
		};
		expect(validateRegionCompositionGeometry(normalized.model, candidate)).toContain(
			'intersect without a bridge',
		);
		expect(validateCompositionDiagnostic(normalized.model, candidate)).toMatchObject({
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
			regionId: 'branch',
			relationId: 'inside-branch',
			relatedRelationId: 'parallel-branch',
		});
		expect(
			validateParentRouteContacts(normalized.model, [
				{ relationId: 'inside-branch', regionId: 'branch', points: [point(100), point(200)] },
				{
					relationId: 'parallel-branch',
					regionId: 'branch',
					points: [
						{ x: 100, y: 300 },
						{ x: 200, y: 300 },
					],
				},
			]),
		).toBeUndefined();
	});

	it.each([1, 2, 3] as const)('accepts every boundary at source depth %i', (depth) => {
		const { model, candidate } = fixture(depth);
		expect(validateRegionCompositionGeometry(model, candidate)).toBeUndefined();
	});
	it.each([1, 2, 3] as const)('accepts every boundary at target depth %i', (depth) => {
		const { model, candidate } = fixture(depth, true);
		expect(validateRegionCompositionGeometry(model, candidate)).toBeUndefined();
	});

	it.each([1, 2, 3] as const)('requires every portal at source depth %i', (depth) => {
		const { model, candidate } = fixture(depth);
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				portals: candidate.portals.slice(1),
			}),
		).toContain('missing or extra boundary portal');
	});

	it.each([1, 2, 3] as const)('requires every owned piece at source depth %i', (depth) => {
		const { model, candidate } = fixture(depth);
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				ownedRoutes: candidate.ownedRoutes.slice(1),
			}),
		).toContain('missing or extra owned piece');
	});

	it('rejects an intermediate owner and a portal attributed to the wrong endpoint', () => {
		const { model, candidate } = fixture(3);
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				ownedRoutes: changedAt(candidate.ownedRoutes, 1, (piece) => ({
					...piece,
					regionId: '@root',
				})),
			}),
		).toContain('wrong boundary owner');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				portals: changedAt(candidate.portals, 1, (portal) => ({
					...portal,
					endpointId: 'c',
				})),
			}),
		).toContain('invalid boundary portal');
		const reordered = [...candidate.portals];
		reordered[0] = defined(candidate.portals[1]);
		reordered[1] = defined(candidate.portals[0]);
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				portals: reordered,
			}),
		).toContain('invalid boundary portal');
	});

	it('rejects disconnected and misplaced intermediate portals', () => {
		const { model, candidate } = fixture(3);
		const shifted = changedAt(candidate.portals, 1, (portal) => ({
			...portal,
			point: { ...portal.point, y: portal.point.y + 1 },
			localPoint: { ...portal.localPoint, y: portal.localPoint.y + 1 },
		}));
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				portals: shifted,
			}),
		).toContain('disconnected boundary portal');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				portals: changedAt(candidate.portals, 1, (portal) => ({
					...portal,
					localPoint: { x: 0, y: 0 },
				})),
			}),
		).toContain('invalid boundary portal');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				portals: changedAt(candidate.portals, 1, (portal) => ({
					...portal,
					localPoint: { ...portal.localPoint, y: portal.localPoint.y + 1 },
				})),
			}),
		).toContain('invalid boundary portal');
	});

	it('rejects a piece leaving its owner and one entering an opaque foreign child', () => {
		const { model, candidate } = fixture(3);
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				ownedRoutes: changedAt(candidate.ownedRoutes, 0, (piece) => ({
					...piece,
					points: [defined(piece.points[0]), { x: 300, y: 201 }],
				})),
			}),
		).toContain('non-orthogonal owned piece');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				ownedRoutes: changedAt(candidate.ownedRoutes, 0, (piece) => ({
					...piece,
					points: [point(200), point(430), point(420)],
				})),
			}),
		).toContain('leaves its owning region');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				regions: candidate.regions.map((region) => {
					if (region.id === 'foreign') return { ...region, bounds: { ...region.bounds, y: 160 } };
					return region;
				}),
			}),
		).toContain('enters opaque child foreign');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				regions: candidate.regions.map((region) => {
					if (region.id === 'foreign-inner')
						return { ...region, bounds: { ...region.bounds, y: 180 } };
					return region;
				}),
			}),
		).toContain('enters opaque child foreign-inner');
	});

	it('rejects a flat route that differs from its continuous owned pieces', () => {
		const { model, candidate } = fixture(2);
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				layout: {
					...candidate.layout,
					relations: candidate.layout.relations.map((route) => ({
						...route,
						points: [...route.points, point(900)],
					})),
				},
			}),
		).toContain('differs from its owned pieces');
	});

	it('rejects an invalid root and malformed child region inventory', () => {
		const { model, candidate } = fixture(2);
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				rootId: 'other',
			}),
		).toContain('wrong root region');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				layout: { ...candidate.layout, width: 0 },
			}),
		).toContain('root canvas has invalid dimensions');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				regions: candidate.regions.slice(1),
			}),
		).toContain('each child region exactly once');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				regions: changedAt(candidate.regions, 0, (region) => ({
					...region,
					id: 'ghost',
				})),
			}),
		).toContain('is not in the region model');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				regions: changedAt(candidate.regions, 1, (region) => ({
					...region,
					id: 'source-1',
				})),
			}),
		).toContain('repeats a child region identity');
	});

	it('rejects misplaced, invalid, and overlapping child frames', () => {
		const { model, candidate } = fixture(2);
		expect(
			validateRegionCompositionGeometry(
				model,
				changedRegion(candidate, 'source-2', (region) => ({
					...region,
					parentId: '@root',
				})),
			),
		).toContain('wrong parent');
		expect(
			validateRegionCompositionGeometry(
				model,
				changedRegion(candidate, 'source-2', (region) => ({
					...region,
					bounds: { ...region.bounds, width: 0 },
				})),
			),
		).toContain('outside its parent');
		expect(
			validateRegionCompositionGeometry(
				model,
				changedRegion(candidate, 'source-2', (region) => ({
					...region,
					bounds: { ...region.bounds, x: 500 },
				})),
			),
		).toContain('outside its parent');
		expect(
			validateRegionCompositionGeometry(
				model,
				changedRegion(candidate, 'foreign', (region) => ({
					...region,
					bounds: { ...region.bounds, x: 400 },
				})),
			),
		).toContain('Children of region @root overlap');
	});

	it('rejects unknown relation identities and malformed composed routes', () => {
		const { model, candidate } = fixture(2);
		const route = defined(candidate.layout.relations[0]);
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				layout: { ...candidate.layout, relations: [route, route] },
			}),
		).toContain('each relation exactly once');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				layout: { ...candidate.layout, relations: [{ ...route, id: 'ghost' }] },
			}),
		).toContain('unknown relation');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				ownedRoutes: [
					...candidate.ownedRoutes,
					{ ...defined(candidate.ownedRoutes[0]), relationId: 'ghost' },
				],
			}),
		).toContain('owned route has an unknown relation');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				portals: [...candidate.portals, { ...defined(candidate.portals[0]), relationId: 'ghost' }],
			}),
		).toContain('boundary portal has an unknown relation');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				layout: { ...candidate.layout, relations: [{ ...route, from: 'c' }] },
			}),
		).toContain('no valid composed route');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				layout: {
					...candidate.layout,
					relations: [
						{
							...route,
							points: changedAt(route.points, 1, (point) => ({
								...point,
								y: point.y + 1,
							})),
						},
					],
				},
			}),
		).toContain('no valid composed route');
		expect(
			validateRegionCompositionGeometry(model, {
				...candidate,
				layout: {
					...candidate.layout,
					relations: [
						{
							...route,
							points: changedAt(route.points, 1, (point) => ({
								...point,
								x: point.x + 1,
							})),
						},
					],
				},
			}),
		).toContain('differs from its owned pieces');
	});

	it('rejects altered leaf identities, bounds, kinds, and local route data', () => {
		const { model, candidate } = oneLevelFixture();
		const source = defined(candidate.layout.elements.find(({ id }) => id === 'a-source'));
		const local = defined(candidate.regions.find(({ id }) => id === 'left'));
		const localSource = defined(local.localLayout.elements.find(({ id }) => id === 'a-source'));
		const localRoute = defined(local.localLayout.relations.find(({ id }) => id === 'inside-a'));
		const replaceSource = (change: (element: typeof source) => typeof source) => ({
			...candidate,
			layout: {
				...candidate.layout,
				elements: candidate.layout.elements.map((element) => {
					if (element.id === 'a-source') return change(element);
					return element;
				}),
			},
		});
		expect(
			validateRegionCompositionGeometry(
				model,
				replaceSource((element) => ({
					...element,
					id: 'ghost',
				})),
			),
		).toContain('unknown element');
		expect(
			validateRegionCompositionGeometry(
				model,
				replaceSource((element) => ({
					...element,
					kind: EndpointKind.Junction,
				})),
			),
		).toContain('differs from its translated leaf layout');
		expect(
			validateRegionCompositionGeometry(
				model,
				replaceSource((element) => ({
					...element,
					bounds: { ...element.bounds, y: element.bounds.y + 1 },
				})),
			),
		).toContain('differs from its translated leaf layout');
		expect(
			validateRegionCompositionGeometry(
				model,
				replaceSource((element) => ({
					...element,
					bounds: { ...element.bounds, width: element.bounds.width + 1 },
				})),
			),
		).toContain('differs from its translated leaf layout');
		expect(
			validateRegionCompositionGeometry(
				model,
				changedRegion(candidate, 'left', (region) => {
					const missing = { ...region };
					delete missing.localLayout;
					return missing;
				}),
			),
		).toContain('has no local layout or translation');
		expect(
			validateRegionCompositionGeometry(
				model,
				changedRegion(candidate, 'left', (region) => ({
					...region,
					localLayout: {
						...defined(region.localLayout),
						elements: [
							{ ...localSource, id: 'ghost' },
							...defined(region.localLayout).elements.slice(1),
						],
					},
				})),
			),
		).toContain('each local element exactly once');
		expect(
			validateRegionCompositionGeometry(
				model,
				changedRegion(candidate, 'left', (region) => ({
					...region,
					localLayout: {
						...defined(region.localLayout),
						relations: [{ ...localRoute, id: 'ghost' }],
					},
				})),
			),
		).toContain('each local relation exactly once');
		expect(
			validateRegionCompositionGeometry(
				model,
				changedRegion(candidate, 'left', (region) => ({
					...region,
					localLayout: {
						...defined(region.localLayout),
						relations: [{ ...localRoute, from: 'a-target' }],
					},
				})),
			),
		).toContain('differs from its translated leaf layout');
		expect(
			validateRegionCompositionGeometry(
				model,
				changedRegion(candidate, 'left', (region) => ({
					...region,
					localLayout: {
						...defined(region.localLayout),
						relations: [
							{
								...localRoute,
								points: changedAt(localRoute.points, 0, (point) => ({
									...point,
									x: point.x + 1,
								})),
							},
						],
					},
				})),
			),
		).toContain('differs from its translated leaf layout');
	});

	it('requires the independent layout and translation of every leaf', () => {
		const { model, candidate } = oneLevelFixture();
		const withoutLayout = changedRegion(candidate, 'left', (region) => ({
			id: region.id,
			parentId: region.parentId,
			bounds: region.bounds,
			translation: defined(region.translation),
		}));
		expect(validateRegionCompositionGeometry(model, withoutLayout)).toBe(
			'Leaf region left has no local layout or translation.',
		);
		const withoutTranslation = changedRegion(candidate, 'left', (region) => ({
			id: region.id,
			parentId: region.parentId,
			bounds: region.bounds,
			localLayout: defined(region.localLayout),
		}));
		expect(validateRegionCompositionGeometry(model, withoutTranslation)).toBe(
			'Leaf region left has no local layout or translation.',
		);
	});

	it('rejects a nonfinite element even when local and global translations agree', () => {
		const { model, candidate } = oneLevelFixture();
		const global = {
			...candidate,
			layout: {
				...candidate.layout,
				elements: candidate.layout.elements.map((element) => {
					if (element.id !== 'a-source') return element;
					return { ...element, bounds: { ...element.bounds, x: Infinity } };
				}),
			},
		};
		const invalid = changedRegion(global, 'left', (region) => ({
			...region,
			localLayout: {
				...defined(region.localLayout),
				elements: defined(region.localLayout).elements.map((element) => {
					if (element.id !== 'a-source') return element;
					return { ...element, bounds: { ...element.bounds, x: Infinity } };
				}),
			},
		}));
		expect(validateRegionCompositionGeometry(model, invalid)).toBe(
			'Element a-source leaves its leaf region left.',
		);
	});

	it('checks source and target identities of a translated local relation', () => {
		const { model, candidate } = oneLevelFixture();
		const invalid: RegionCompositionGeometryCandidate = {
			...candidate,
			layout: {
				...candidate.layout,
				relations: candidate.layout.relations.map((route) => {
					if (route.id !== 'inside-a') return route;
					return { ...route, to: 'a-source' };
				}),
			},
		};
		expect(validateRegionCompositionGeometry(model, invalid)).toBe(
			'Relation inside-a differs from its translated leaf layout.',
		);
	});
});
