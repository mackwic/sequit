import { describe, expect, it } from 'vitest';

import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import type { Bounds, LayoutRelation, Point } from '../../../../src/lib/core/layout/layout-types';
import { validateNestedRegionGeometry } from '../../../../src/lib/core/layout/nested-region-geometry';
import { validateNestedRegionLeafIncidents as validateIncidentDiagnostic } from '../../../../src/lib/core/layout/nested-region-leaf-incident-validation';
import { validateNestedRegionLeafIncidentsMessage as validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/nested-region-leaf-incident-validation';
import {
	type NestedOwnedRoute,
	NestedPortalSide,
	type NestedRegionDefinition,
	type NestedRegionInput,
	NestedRegionLayoutStatus,
	type NestedRegionPlacement,
	type NestedRegionPortal,
	type NestedRegionSelected,
} from '../../../../src/lib/core/layout/nested-region-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/region-geometry-diagnostic';
import { regionDocument } from './nested-region-fixture';

const NODE_BOUNDS = new Map<string, Bounds>([
	['a-source', { x: 80, y: 80, width: 20, height: 20 }],
	['a-target', { x: 100, y: 150, width: 20, height: 20 }],
	['c', { x: 390, y: 140, width: 20, height: 20 }],
]);

const REGION_BOUNDS = new Map<string, Bounds>([
	['left', { x: 30, y: 30, width: 200, height: 200 }],
	['wrap-1', { x: 20, y: 20, width: 220, height: 220 }],
	['wrap-2', { x: 10, y: 10, width: 240, height: 240 }],
	['right', { x: 350, y: 30, width: 180, height: 200 }],
]);

const LOCAL_POINTS: readonly Point[] = [
	{ x: 90, y: 100 },
	{ x: 90, y: 120 },
	{ x: 110, y: 120 },
	{ x: 110, y: 150 },
];

function must<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing test fixture value.');
	return value;
}

function portal(
	regionId: string,
	endpointId: string,
	side: NestedPortalSide,
	point: Point,
): NestedRegionPortal {
	const bounds = must(REGION_BOUNDS.get(regionId));
	return {
		relationId: 'across-middle',
		endpointId,
		regionId,
		side,
		point,
		localPoint: { x: point.x - bounds.x, y: point.y - bounds.y },
	};
}

function regionDefinitions(depth: 1 | 2 | 3): readonly NestedRegionDefinition[] {
	const regions: NestedRegionDefinition[] = [{ id: '@root', layoutOrder: '0' }];
	let leftParent = '@root';
	if (depth === 3) {
		regions.push({ id: 'wrap-2', parentId: '@root', layoutOrder: 'a' });
		leftParent = 'wrap-2';
	}
	if (depth >= 2) {
		regions.push({ id: 'wrap-1', parentId: leftParent, layoutOrder: 'a' });
		leftParent = 'wrap-1';
	}
	regions.push({ id: 'left', parentId: leftParent, layoutOrder: 'a' });
	regions.push({ id: 'right', parentId: '@root', layoutOrder: 'b' });
	return regions;
}

function fixture(depth: 1 | 2 | 3) {
	const original = regionDocument();
	const document = { ...original, nodes: original.nodes.filter(({ id }) => id !== 'b') };
	const created = createGraph(document);
	if (!created.ok) throw new Error('Fixture graph must be valid.');
	const input: NestedRegionInput = {
		regions: regionDefinitions(depth),
		regionByEndpointId: new Map([
			['a-source', 'left'],
			['a-target', 'left'],
			['c', 'right'],
		]),
	};
	const normalized = normalizeRegionCompositionModel(created.value, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error(normalized.diagnostic.message);
	const model = normalized.model;
	const regions: NestedRegionPlacement[] = model.preorderIds
		.filter((id) => id !== model.rootId)
		.map((id) => {
			const bounds = must(REGION_BOUNDS.get(id));
			const translation = { x: bounds.x + 16, y: bounds.y + 16 };
			const localElements = document.nodes
				.filter((node) => model.leafByEndpointId.get(node.id) === id)
				.map((node) => {
					const global = must(NODE_BOUNDS.get(node.id));
					return {
						id: node.id,
						kind: node.kind,
						bounds: {
							...global,
							x: global.x - translation.x,
							y: global.y - translation.y,
						},
					};
				});
			const localRelations = (model.localRelationsByOwner.get(id) ?? []).map((relation) => ({
				id: relation.id,
				from: relation.from,
				to: relation.to,
				points: LOCAL_POINTS.map(({ x, y }) => ({ x: x - translation.x, y: y - translation.y })),
			}));
			return {
				id,
				parentId: must(model.regionsById.get(id)?.parentId),
				bounds,
				translation,
				localLayout: {
					width: bounds.width - 32,
					height: bounds.height - 32,
					elements: localElements,
					relations: localRelations,
				},
				localRanks: { byEndpointId: new Map(), bands: [] },
			};
		});
	const sourcePath = must(
		model.relations.find(({ relation }) => relation.id === 'across-middle'),
	).sourcePathToOwner;
	const sourcePortals = sourcePath.map((id) => {
		const bounds = must(REGION_BOUNDS.get(id));
		return portal(id, 'a-target', NestedPortalSide.Bottom, {
			x: 110,
			y: bounds.y + bounds.height,
		});
	});
	const targetPortal = portal('right', 'c', NestedPortalSide.Top, { x: 400, y: 30 });
	const sourcePieces: NestedOwnedRoute[] = [];
	let start: Point = { x: 110, y: 170 };
	for (const crossing of sourcePortals) {
		sourcePieces.push({
			relationId: 'across-middle',
			regionId: crossing.regionId,
			points: [start, crossing.point],
		});
		start = crossing.point;
	}
	const rootPiece: NestedOwnedRoute = {
		relationId: 'across-middle',
		regionId: '@root',
		points: [
			start,
			{ x: 110, y: 270 },
			{ x: 550, y: 270 },
			{ x: 550, y: 10 },
			{ x: 400, y: 10 },
			targetPortal.point,
		],
	};
	const targetPiece: NestedOwnedRoute = {
		relationId: 'across-middle',
		regionId: 'right',
		points: [targetPortal.point, { x: 400, y: 140 }],
	};
	const crossingPieces = [...sourcePieces, rootPiece, targetPiece];
	const crossingPoints: Point[] = [];
	for (const piece of crossingPieces)
		if (crossingPoints.length === 0) crossingPoints.push(...piece.points);
		else crossingPoints.push(...piece.points.slice(1));
	const relations: readonly LayoutRelation[] = [
		{ id: 'across-middle', from: 'a-target', to: 'c', points: crossingPoints },
		{ id: 'inside-a', from: 'a-source', to: 'a-target', points: LOCAL_POINTS },
	];
	const candidate: NestedRegionSelected = {
		status: NestedRegionLayoutStatus.Selected,
		rootId: '@root',
		regions,
		portals: [...sourcePortals, targetPortal],
		ownedRoutes: [
			...crossingPieces,
			{ relationId: 'inside-a', regionId: 'left', points: LOCAL_POINTS },
		],
		layout: {
			width: 600,
			height: 300,
			elements: document.nodes.map((node) => ({
				id: node.id,
				kind: node.kind,
				bounds: must(NODE_BOUNDS.get(node.id)),
			})),
			relations,
		},
	};
	return { graph: created.value, input, model, candidate };
}

function lateralFixture() {
	const { graph, input, model, candidate } = fixture(1);
	const sourcePortal = portal('left', 'a-target', NestedPortalSide.Right, { x: 230, y: 160 });
	const targetPortal = portal('right', 'c', NestedPortalSide.Left, { x: 350, y: 150 });
	const crossingPieces: readonly NestedOwnedRoute[] = [
		{
			relationId: 'across-middle',
			regionId: 'left',
			points: [{ x: 120, y: 160 }, sourcePortal.point],
		},
		{
			relationId: 'across-middle',
			regionId: '@root',
			points: [sourcePortal.point, { x: 270, y: 160 }, { x: 270, y: 150 }, targetPortal.point],
		},
		{
			relationId: 'across-middle',
			regionId: 'right',
			points: [targetPortal.point, { x: 390, y: 150 }],
		},
	];
	const crossingPoints = crossingPieces.flatMap(({ points }, index) => {
		if (index === 0) return [...points];
		return points.slice(1);
	});
	const lateral: NestedRegionSelected = {
		...candidate,
		portals: [sourcePortal, targetPortal],
		ownedRoutes: [
			...crossingPieces,
			{ relationId: 'inside-a', regionId: 'left', points: LOCAL_POINTS },
		],
		layout: {
			...candidate.layout,
			relations: candidate.layout.relations.map((relation) => {
				if (relation.id === 'across-middle') return { ...relation, points: crossingPoints };
				return relation;
			}),
		},
	};
	return { graph, input, model, candidate: lateral };
}

function replaceRoute(
	candidate: NestedRegionSelected,
	relationId: string,
	regionId: string,
	points: readonly Point[],
): NestedRegionSelected {
	const regions = candidate.regions.map((region) => {
		if (relationId !== 'inside-a' || region.id !== regionId) return region;
		return {
			...region,
			localLayout: {
				...region.localLayout,
				relations: region.localLayout.relations.map((route) => {
					if (route.id !== relationId) return route;
					return {
						...route,
						points: points.map(({ x, y }) => ({
							x: x - region.translation.x,
							y: y - region.translation.y,
						})),
					};
				}),
			},
		};
	});
	return {
		...candidate,
		regions,
		ownedRoutes: candidate.ownedRoutes.map((piece) => {
			if (piece.relationId === relationId && piece.regionId === regionId)
				return { ...piece, points };
			return piece;
		}),
		layout: {
			...candidate.layout,
			relations: candidate.layout.relations.map((route) => {
				if (route.id !== relationId) return route;
				if (relationId === 'inside-a') return { ...route, points };
				return { ...route, points: [must(points[0]), ...route.points.slice(1)] };
			}),
		},
	};
}

function replaceElementBounds(
	candidate: NestedRegionSelected,
	elementId: string,
	bounds: Bounds,
): NestedRegionSelected {
	return {
		...candidate,
		regions: candidate.regions.map((region) => ({
			...region,
			localLayout: {
				...region.localLayout,
				elements: region.localLayout.elements.map((element) => {
					if (element.id !== elementId) return element;
					return {
						...element,
						bounds: {
							...bounds,
							x: bounds.x - region.translation.x,
							y: bounds.y - region.translation.y,
						},
					};
				}),
			},
		})),
		layout: {
			...candidate.layout,
			elements: candidate.layout.elements.map((element) => {
				if (element.id === elementId) return { ...element, bounds };
				return element;
			}),
		},
	};
}

describe('recursive nested-region leaf incident validation', () => {
	it('accepts right and left node-face attachments on lateral portals', () => {
		const { graph, input, model, candidate } = lateralFixture();
		expect(validateRegionCompositionGeometry(model, candidate)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(model, candidate)).toBeUndefined();
		expect(validateNestedRegionGeometry(graph, input, candidate)).toBeUndefined();
	});

	it('rejects a lateral incident anchored inside a node or at its corner', () => {
		const { model, candidate } = lateralFixture();
		const inside = replaceRoute(candidate, 'across-middle', 'left', [
			{ x: 119, y: 160 },
			{ x: 230, y: 160 },
		]);
		expect(validateNestedRegionLeafIncidents(model, inside)).toContain(
			'does not attach to node a-target on its right face',
		);
		const corner = {
			...candidate,
			ownedRoutes: candidate.ownedRoutes.map((piece) => {
				if (piece.relationId !== 'across-middle' || piece.regionId !== 'right') return piece;
				return {
					...piece,
					points: [
						{ x: 350, y: 150 },
						{ x: 390, y: 150 },
						{ x: 390, y: 140 },
					],
				};
			}),
		};
		expect(validateNestedRegionLeafIncidents(model, corner)).toContain(
			'does not attach to node c on its left face',
		);
	});

	it('keeps foreign-node and local-route collision checks for lateral incidents', () => {
		const { model, candidate } = lateralFixture();
		const foreign = replaceElementBounds(candidate, 'a-source', {
			x: 160,
			y: 150,
			width: 20,
			height: 20,
		});
		expect(validateNestedRegionLeafIncidents(model, foreign)).toContain(
			'crosses foreign node a-source',
		);
		const local = replaceRoute(candidate, 'inside-a', 'left', [
			{ x: 90, y: 100 },
			{ x: 90, y: 160 },
			{ x: 160, y: 160 },
			{ x: 160, y: 150 },
			{ x: 110, y: 150 },
		]);
		expect(validateNestedRegionLeafIncidents(model, local)).toContain(
			'touches local relation inside-a in leaf left without a defined bridge',
		);
	});

	it.each([1, 2, 3] as const)('accepts a coherent depth-%i boundary chain', (depth) => {
		const { model, candidate } = fixture(depth);
		expect(validateRegionCompositionGeometry(model, candidate)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(model, candidate)).toBeUndefined();
	});

	it('rejects a depth-one incident attached inside its source node', () => {
		const { model, candidate } = fixture(1);
		const damaged = replaceRoute(candidate, 'across-middle', 'left', [
			{ x: 110, y: 171 },
			{ x: 110, y: 230 },
		]);
		expect(validateRegionCompositionGeometry(model, damaged)).toBeUndefined();
		expect(validateIncidentDiagnostic(model, damaged)).toMatchObject({
			code: RegionGeometryDiagnosticCode.IncidentWrongAttachment,
			relationId: 'across-middle',
			regionId: 'left',
			endpointId: 'a-target',
			role: 'source',
		});
		expect(validateNestedRegionLeafIncidents(model, damaged)).toContain(
			'does not attach to node a-target on its bottom face',
		);
	});

	it('rejects a depth-two incident crossing a foreign node in its leaf', () => {
		const { model, candidate } = fixture(2);
		const damaged = replaceElementBounds(candidate, 'a-source', {
			x: 100,
			y: 185,
			width: 20,
			height: 20,
		});
		expect(validateRegionCompositionGeometry(model, damaged)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(model, damaged)).toContain(
			'crosses foreign node a-source',
		);
	});

	it('rejects a depth-three incident crossing a local route without a bridge', () => {
		const { model, candidate } = fixture(3);
		const damaged = replaceRoute(candidate, 'inside-a', 'left', [
			{ x: 90, y: 100 },
			{ x: 90, y: 190 },
			{ x: 140, y: 190 },
			{ x: 140, y: 130 },
			{ x: 110, y: 130 },
			{ x: 110, y: 150 },
		]);
		expect(validateRegionCompositionGeometry(model, damaged)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(model, damaged)).toContain(
			'touches local relation inside-a in leaf left without a defined bridge',
		);
	});

	it('allows two routes to meet only at their shared node-face endpoint', () => {
		const { model, candidate } = fixture(1);
		const damaged = replaceRoute(candidate, 'inside-a', 'left', [
			{ x: 90, y: 100 },
			{ x: 90, y: 170 },
			{ x: 110, y: 170 },
		]);
		expect(validateRegionCompositionGeometry(model, damaged)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(model, damaged)).toBeUndefined();
	});

	it('requires exactly one declared portal and one owned incident piece per leaf', () => {
		const { model, candidate } = fixture(1);
		const sourcePortal = must(candidate.portals.find(({ regionId }) => regionId === 'left'));
		const sourcePiece = must(
			candidate.ownedRoutes.find(
				({ relationId, regionId }) => relationId === 'across-middle' && regionId === 'left',
			),
		);
		const missingPortal = {
			...candidate,
			portals: candidate.portals.filter((portal) => portal !== sourcePortal),
		};
		const duplicatePortal = { ...candidate, portals: [...candidate.portals, sourcePortal] };
		const missingPiece = {
			...candidate,
			ownedRoutes: candidate.ownedRoutes.filter((piece) => piece !== sourcePiece),
		};
		const duplicatePiece = {
			...candidate,
			ownedRoutes: [...candidate.ownedRoutes, sourcePiece],
		};
		expect(validateNestedRegionLeafIncidents(model, missingPortal)).toContain(
			'0 source portals on leaf left',
		);
		expect(validateNestedRegionLeafIncidents(model, duplicatePortal)).toContain(
			'2 source portals on leaf left',
		);
		expect(validateNestedRegionLeafIncidents(model, missingPiece)).toContain(
			'0 source incident pieces in leaf left',
		);
		expect(validateNestedRegionLeafIncidents(model, duplicatePiece)).toContain(
			'2 source incident pieces in leaf left',
		);
	});

	it('rejects an invalid source route and a missing target node', () => {
		const { model, candidate } = fixture(1);
		const nonOrthogonal = {
			...candidate,
			ownedRoutes: candidate.ownedRoutes.map((piece) => {
				if (piece.relationId !== 'across-middle' || piece.regionId !== 'left') return piece;
				return {
					...piece,
					points: [
						{ x: 110, y: 170 },
						{ x: 111, y: 230 },
					],
				};
			}),
		};
		expect(validateNestedRegionLeafIncidents(model, nonOrthogonal)).toContain(
			'non-orthogonal source incident',
		);
		const missingTarget = {
			...candidate,
			layout: {
				...candidate.layout,
				elements: candidate.layout.elements.filter(({ id }) => id !== 'c'),
			},
		};
		expect(validateNestedRegionLeafIncidents(model, missingTarget)).toContain('no target node c');
	});

	it('requires a valid local route when checking an incident for bridge contacts', () => {
		const { model, candidate } = fixture(1);
		const withoutLocal = {
			...candidate,
			ownedRoutes: candidate.ownedRoutes.filter(({ relationId }) => relationId !== 'inside-a'),
		};
		expect(validateNestedRegionLeafIncidents(model, withoutLocal)).toContain(
			'Local relation inside-a is missing from leaf left',
		);
		const nonOrthogonalLocal = replaceRoute(candidate, 'inside-a', 'left', [
			{ x: 90, y: 100 },
			{ x: 110, y: 150 },
		]);
		expect(validateNestedRegionLeafIncidents(model, nonOrthogonalLocal)).toContain(
			'non-orthogonal route in leaf left',
		);
	});

	it('rejects a portal assigned to another endpoint or region', () => {
		const { model, candidate } = fixture(2);
		const wrongEndpoint = {
			...candidate,
			portals: candidate.portals.map((portal) => {
				if (portal.regionId !== 'left') return portal;
				return { ...portal, endpointId: 'a-source' };
			}),
		};
		expect(validateNestedRegionLeafIncidents(model, wrongEndpoint)).toContain(
			'0 source portals on leaf left',
		);
		const wrongRegion = {
			...candidate,
			portals: candidate.portals.map((portal) => {
				if (portal.regionId !== 'left') return portal;
				return { ...portal, regionId: 'wrap-1' };
			}),
		};
		expect(validateNestedRegionLeafIncidents(model, wrongRegion)).toContain(
			'0 source portals on leaf left',
		);
	});

	it('rejects a node corner even when the incident is orthogonal', () => {
		const { model, candidate } = fixture(1);
		const corner = replaceRoute(candidate, 'across-middle', 'left', [
			{ x: 100, y: 170 },
			{ x: 100, y: 230 },
		]);
		expect(validateNestedRegionLeafIncidents(model, corner)).toContain(
			'does not attach to node a-target on its bottom face',
		);
	});

	it('permits a local route leaving the shared endpoint in a different direction', () => {
		const { model, candidate } = fixture(1);
		const local = must(model.localRelationsByOwner.get('left'));
		const swappedModel = {
			...model,
			localRelationsByOwner: new Map([
				...model.localRelationsByOwner,
				['left', local.map((relation) => ({ ...relation, from: 'a-target', to: 'a-source' }))],
			]),
		};
		const departing = replaceRoute(candidate, 'inside-a', 'left', [
			{ x: 110, y: 170 },
			{ x: 90, y: 170 },
			{ x: 90, y: 100 },
		]);
		expect(validateNestedRegionLeafIncidents(swappedModel, departing)).toBeUndefined();
	});
});
