import { describe, expect, it } from 'vitest';

import {
	defined,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateNestedRegionGeometry } from '../../../../src/lib/core/layout/nested-region-geometry';
import { segmentEnters } from '../../../../src/lib/core/layout/nested-region-geometry-primitives';
import {
	solveNestedRegionLayout,
	solveNestedRegionLayoutForProjection,
} from '../../../../src/lib/core/layout/nested-region-layout';
import { validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/nested-region-leaf-incident-validation';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionLayoutSelected,
	type RegionOwnedRoute,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/region-composition-types';
import { validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/region-local-cache';
import { layoutDocument, prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	depthTwoRegionDocument,
	depthTwoRegionInput,
	nestedRegionInput,
	persistedDepthTwoRegionDocument,
	regionDocument,
	selectedNestedRegionLayout,
} from './nested-region-fixture';

function grandchildToRootSiblingDocument() {
	const source = depthTwoRegionDocument();
	return {
		...source,
		relations: [
			defined(source.relations.find(({ id }) => id === 'inside-a')),
			{ id: 'grandchild-to-right', from: 'c', to: 'd' },
		],
	};
}

function rootSiblingToGrandchildDocument() {
	const source = depthTwoRegionDocument();
	return {
		...source,
		relations: [
			defined(source.relations.find(({ id }) => id === 'inside-a')),
			{ id: 'right-to-grandchild', from: 'd', to: 'c' },
		],
	};
}

function selectedGrandchildToRootSibling() {
	const document = grandchildToRootSiblingDocument();
	const prepared = prepareLayoutDocument(document);
	const input = depthTwoRegionInput();
	const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	if (result.status !== RegionCompositionStatus.Selected)
		throw new Error(`Expected a composed grandchild route: ${result.reason}`);
	return { prepared, input, result };
}

function withGrandchildParentRoute(
	result: RegionLayoutSelected,
	points: RegionOwnedRoute['points'],
): RegionLayoutSelected {
	const relationId = 'grandchild-to-right';
	const ownedRoutes = result.ownedRoutes.map((piece) => {
		if (piece.relationId !== relationId || piece.regionId !== 'branch') return piece;
		return { ...piece, points };
	});
	const chain = ownedRoutes
		.filter((piece) => piece.relationId === relationId)
		.flatMap((piece, index) => {
			if (index === 0) return piece.points;
			return piece.points.slice(1);
		});
	return {
		...result,
		ownedRoutes,
		layout: {
			...result.layout,
			relations: result.layout.relations.map((relation) => {
				if (relation.id !== relationId) return relation;
				return { ...relation, points: chain };
			}),
		},
	};
}

describe('bounded nested-region composition', () => {
	it('selects every persisted grandchild through the production root dispatcher', async () => {
		const { layout } = await layoutDocument(persistedDepthTwoRegionDocument());
		expect(layout.regions?.map(({ id }) => id)).toEqual([
			'branch',
			'left',
			'middle',
			'branch-right',
			'right',
			'far-right',
		]);
		expect(layout.elements.map(({ id }) => id)).toEqual([
			'a-source',
			'a-target',
			'b',
			'c',
			'd',
			'e',
		]);
		expect(layout.relations.map(({ id }) => id)).toEqual(['at-root', 'inside-a', 'inside-branch']);
	});

	it('composes two levels with independent leaf ranks and routes at both least common ancestors', () => {
		const input = depthTwoRegionInput();
		const prepared = prepareLayoutDocument(depthTwoRegionDocument());
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		expect(result.regions.map(({ id }) => id)).toEqual([
			'branch',
			'left',
			'middle',
			'branch-right',
			'right',
			'far-right',
		]);
		const branch = defined(result.regions.find(({ id }) => id === 'branch'));
		const middle = defined(result.regions.find(({ id }) => id === 'middle'));
		expect(branch.localRanks.byEndpointId.size).toBe(0);
		expect([
			...defined(result.regions.find(({ id }) => id === 'left')).localRanks.byEndpointId,
		]).toEqual([
			['a-source', 1],
			['a-target', 0],
		]);
		expect(middle.bounds.x).toBeGreaterThan(branch.bounds.x);
		expect(middle.bounds.x + middle.bounds.width).toBeLessThan(
			branch.bounds.x + branch.bounds.width,
		);
		expect(
			result.ownedRoutes
				.filter(({ relationId }) => relationId === 'inside-branch')
				.map(({ regionId }) => regionId),
		).toEqual(['left', 'branch', 'branch-right']);
		expect(
			result.ownedRoutes
				.filter(({ relationId }) => relationId === 'at-root')
				.map(({ regionId }) => regionId),
		).toEqual(['right', '@root', 'far-right']);
		expect(result.portals.map(({ regionId }) => regionId)).toEqual([
			'right',
			'far-right',
			'left',
			'branch-right',
		]);
		expect(validateNestedRegionGeometry(prepared.graph, input, result)).toBeUndefined();
	});

	it('is deterministic across collection permutations in a two-level tree', () => {
		const document = depthTwoRegionDocument();
		const input = depthTwoRegionInput();
		const original = solveNestedRegionLayout(
			prepareLayoutDocument(document).graph,
			prepareLayoutDocument(document).measurements,
			input,
		);
		expect(original.status).toBe(RegionCompositionStatus.Selected);
		const permuted = {
			...document,
			nodes: [...document.nodes].reverse(),
			relations: [...document.relations].reverse(),
		};
		const prepared = prepareLayoutDocument(permuted);
		const repeated = solveNestedRegionLayout(prepared.graph, prepared.measurements, {
			regions: [...input.regions].reverse(),
			regionByEndpointId: new Map([...input.regionByEndpointId].reverse()),
		});
		expect(repeated).toEqual(original);
	});

	it('composes two independent nested parents without giving either a root-wide rank', () => {
		const input = depthTwoRegionInput();
		const regions = input.regions
			.filter(({ id }) => id !== 'far-right')
			.concat([
				{ id: 'right-left', parentId: 'right', layoutOrder: 'a' },
				{ id: 'far-right', parentId: 'right', layoutOrder: 'b' },
			]);
		const assignments = new Map(input.regionByEndpointId);
		assignments.set('d', 'right-left');
		const prepared = prepareLayoutDocument(depthTwoRegionDocument());
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, {
			regions,
			regionByEndpointId: assignments,
		});
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		expect(result.regions.map(({ id }) => id)).toEqual([
			'branch',
			'left',
			'middle',
			'branch-right',
			'right',
			'right-left',
			'far-right',
		]);
		expect(
			result.ownedRoutes
				.filter(({ relationId }) => relationId === 'at-root')
				.map(({ regionId }) => regionId),
		).toEqual(['right-left', 'right', 'far-right']);
		expect(result.regions.find(({ id }) => id === 'right')?.localRanks.byEndpointId.size).toBe(0);
	});

	it('retains a local relation in an unnested root child while composing another child', () => {
		const source = depthTwoRegionDocument();
		const rightNode = defined(source.nodes.find(({ id }) => id === 'd'));
		const document = {
			...source,
			nodes: [...source.nodes, { ...rightNode, id: 'd2', layoutOrder: orderKey('a6') }],
			relations: [
				defined(source.relations.find(({ id }) => id === 'inside-a')),
				defined(source.relations.find(({ id }) => id === 'inside-branch')),
				{ id: 'inside-right', from: 'd', to: 'd2' },
			],
		};
		const input = depthTwoRegionInput();
		const assignments = new Map(input.regionByEndpointId);
		assignments.set('d2', 'right');
		const nestedInput = { ...input, regionByEndpointId: assignments };
		const prepared = prepareLayoutDocument(document);
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, nestedInput);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		expect(
			result.ownedRoutes
				.filter(({ relationId }) => relationId === 'inside-right')
				.map(({ regionId }) => regionId),
		).toEqual(['right']);
		expect(
			result.regions.find(({ id }) => id === 'right')?.localLayout.relations.map(({ id }) => id),
		).toEqual(['inside-right']);
		expect(validateNestedRegionGeometry(prepared.graph, nestedInput, result)).toBeUndefined();
	});

	it('selects a grandchild-to-root sibling route through each boundary in the production pipeline', async () => {
		const source = grandchildToRootSiblingDocument();
		const persisted = persistedDepthTwoRegionDocument(source);
		const { layout } = await layoutDocument(persisted);
		const prepared = prepareLayoutDocument(persisted);
		const input = depthTwoRegionInput();
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		const relationId = 'grandchild-to-right';
		expect(layout.regions?.map(({ id }) => id)).toEqual(result.regions.map(({ id }) => id));
		expect(layout.relations.find(({ id }) => id === relationId)).toEqual(
			result.layout.relations.find(({ id }) => id === relationId),
		);
		expect(
			result.portals
				.filter(({ relationId: id }) => id === relationId)
				.map(({ regionId, endpointId }) => [regionId, endpointId]),
		).toEqual([
			['branch-right', 'c'],
			['branch', 'c'],
			['right', 'd'],
		]);
		expect(
			result.ownedRoutes
				.filter(({ relationId: id }) => id === relationId)
				.map(({ regionId }) => regionId),
		).toEqual(['branch-right', 'branch', '@root', 'right']);
		const middle = defined(result.regions.find(({ id }) => id === 'middle'));
		const parentCorridor = defined(
			result.ownedRoutes.find(
				({ relationId: id, regionId }) => id === relationId && regionId === 'branch',
			),
		);
		expect(segmentEnters(parentCorridor.points, middle.bounds)).toBe(false);
		expect(validateNestedRegionGeometry(prepared.graph, input, result)).toBeUndefined();

		const permuted = {
			...persisted,
			nodes: [...persisted.nodes].reverse(),
			relations: [...persisted.relations].reverse(),
		};
		const permutedPrepared = prepareLayoutDocument(permuted);
		const repeated = solveNestedRegionLayout(
			permutedPrepared.graph,
			permutedPrepared.measurements,
			{
				regions: [...input.regions].reverse(),
				regionByEndpointId: new Map([...input.regionByEndpointId].reverse()),
			},
		);
		expect(repeated).toEqual(result);
	});

	it('rejects a grandchild-to-root sibling route without its intermediate portal', () => {
		const persisted = persistedDepthTwoRegionDocument(grandchildToRootSiblingDocument());
		const prepared = prepareLayoutDocument(persisted);
		const input = depthTwoRegionInput();
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		const falsified = {
			...result,
			portals: result.portals.filter(
				({ relationId, regionId }) =>
					!(relationId === 'grandchild-to-right' && regionId === 'branch'),
			),
		};
		expect(validateNestedRegionGeometry(prepared.graph, input, falsified)).toContain('portal');
	});

	it('rejects a root-owned grandchild route without its composed layout relation', () => {
		const { prepared, input, result } = selectedGrandchildToRootSibling();
		const falsified = {
			...result,
			layout: {
				...result.layout,
				relations: result.layout.relations.filter(({ id }) => id !== 'grandchild-to-right'),
			},
		};
		expect(validateNestedRegionGeometry(prepared.graph, input, falsified)).toContain(
			'each relation exactly once',
		);
	});

	it('rejects a root-owned grandchild route with a missing owned segment', () => {
		const { prepared, input, result } = selectedGrandchildToRootSibling();
		const falsified = {
			...result,
			ownedRoutes: result.ownedRoutes.filter(
				({ relationId, regionId }) => relationId !== 'grandchild-to-right' || regionId !== 'branch',
			),
		};
		expect(validateNestedRegionGeometry(prepared.graph, input, falsified)).toContain(
			'missing or extra owned piece',
		);
	});

	it('rejects a composed grandchild route that differs from its owned segments', () => {
		const { prepared, input, result } = selectedGrandchildToRootSibling();
		const falsified = {
			...result,
			layout: {
				...result.layout,
				relations: result.layout.relations.map((relation) => {
					if (relation.id !== 'grandchild-to-right') return relation;
					return { ...relation, points: relation.points.slice(1) };
				}),
			},
		};
		expect(validateNestedRegionGeometry(prepared.graph, input, falsified)).toContain(
			'differs from its owned pieces',
		);
	});

	it('rejects a root-owned grandchild segment attributed to the wrong region', () => {
		const { prepared, input, result } = selectedGrandchildToRootSibling();
		const falsified = {
			...result,
			ownedRoutes: result.ownedRoutes.map((piece) => {
				if (piece.relationId !== 'grandchild-to-right' || piece.regionId !== 'branch') return piece;
				return { ...piece, regionId: 'right' };
			}),
		};
		expect(validateNestedRegionGeometry(prepared.graph, input, falsified)).toContain(
			'wrong boundary owner',
		);
	});

	it('rejects a non-orthogonal parent segment even when the composed route agrees', () => {
		const { prepared, input, result } = selectedGrandchildToRootSibling();
		const parent = defined(
			result.ownedRoutes.find(
				({ relationId, regionId }) => relationId === 'grandchild-to-right' && regionId === 'branch',
			),
		);
		const first = defined(parent.points[0]);
		const unsafe = withGrandchildParentRoute(result, [
			first,
			{ x: first.x + 1, y: first.y + 1 },
			...parent.points.slice(1),
		]);
		expect(validateNestedRegionGeometry(prepared.graph, input, unsafe)).toContain(
			'non-orthogonal owned piece',
		);
	});

	it('rejects a parent segment leaving its owning region', () => {
		const { prepared, input, result } = selectedGrandchildToRootSibling();
		const parent = defined(
			result.ownedRoutes.find(
				({ relationId, regionId }) => relationId === 'grandchild-to-right' && regionId === 'branch',
			),
		);
		const bounds = defined(result.regions.find(({ id }) => id === 'branch')).bounds;
		const first = defined(parent.points[0]);
		const last = defined(parent.points.at(-1));
		const unsafeY = bounds.y - 1;
		const unsafe = withGrandchildParentRoute(result, [
			first,
			{ x: first.x, y: unsafeY },
			{ x: last.x, y: unsafeY },
			last,
		]);
		expect(validateNestedRegionGeometry(prepared.graph, input, unsafe)).toContain(
			'leaves its owning region branch',
		);
	});

	it('rejects a parent corridor entering an opaque grandchild', () => {
		const { prepared, input, result } = selectedGrandchildToRootSibling();
		const parent = defined(
			result.ownedRoutes.find(
				({ relationId, regionId }) => relationId === 'grandchild-to-right' && regionId === 'branch',
			),
		);
		const middle = defined(result.regions.find(({ id }) => id === 'middle'));
		const first = defined(parent.points[0]);
		const last = defined(parent.points.at(-1));
		const throughX = middle.bounds.x + middle.bounds.width / 2;
		const throughY = middle.bounds.y + middle.bounds.height / 2;
		const unsafe = withGrandchildParentRoute(result, [
			first,
			{ x: first.x, y: throughY },
			{ x: throughX, y: throughY },
			{ x: throughX, y: last.y },
			last,
		]);
		expect(validateNestedRegionGeometry(prepared.graph, input, unsafe)).toContain(
			'enters opaque child middle from owner branch',
		);
	});

	it('rejects malformed intermediate portals at every declared boundary', () => {
		const { prepared, input, result } = selectedGrandchildToRootSibling();
		const branchPortal = defined(
			result.portals.find(
				({ relationId, regionId }) => relationId === 'grandchild-to-right' && regionId === 'branch',
			),
		);
		const branch = defined(result.regions.find(({ id }) => id === 'branch'));
		const corruptions = [
			{ ...branchPortal, regionId: 'middle' },
			{ ...branchPortal, endpointId: 'd' },
			{
				...branchPortal,
				point: { ...branchPortal.point, x: branch.bounds.x },
				localPoint: { ...branchPortal.localPoint, x: 0 },
			},
			{
				...branchPortal,
				point: { ...branchPortal.point, y: branchPortal.point.y + 1 },
			},
		];
		for (const replacement of corruptions) {
			const falsified = {
				...result,
				portals: result.portals.map((portal) => {
					if (portal !== branchPortal) return portal;
					return replacement;
				}),
			};
			expect(validateNestedRegionGeometry(prepared.graph, input, falsified)).toContain(
				'invalid boundary portal',
			);
		}
	});

	it('rejects a grandchild portal disconnected from adjacent owned segments', () => {
		const { prepared, input, result } = selectedGrandchildToRootSibling();
		const falsified = {
			...result,
			portals: result.portals.map((portal) => {
				if (portal.relationId !== 'grandchild-to-right' || portal.regionId !== 'branch')
					return portal;
				return {
					...portal,
					point: { ...portal.point, x: portal.point.x + 1 },
					localPoint: { ...portal.localPoint, x: portal.localPoint.x + 1 },
				};
			}),
		};
		expect(validateNestedRegionGeometry(prepared.graph, input, falsified)).toContain(
			'disconnected boundary portal',
		);
	});

	it('uses the lower boundary of the grandchild and parent in reverse flow', () => {
		const source = depthTwoRegionDocument();
		const document = {
			...source,
			layout: defined(layoutConfiguration(LayoutDirection.BottomToTop, LayoutBias.Bottom)),
			relations: [{ id: 'grandchild-to-right', from: 'c', to: 'd' }],
		};
		const prepared = prepareLayoutDocument(document);
		const input = depthTwoRegionInput();
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		expect(
			result.portals
				.filter(({ relationId }) => relationId === 'grandchild-to-right')
				.map(({ regionId, side }) => [regionId, side]),
		).toEqual([
			['branch-right', RegionPortalSide.Bottom],
			['branch', RegionPortalSide.Bottom],
			['right', RegionPortalSide.Bottom],
		]);
		expect(
			result.ownedRoutes
				.filter(({ relationId }) => relationId === 'grandchild-to-right')
				.map(({ regionId }) => regionId),
		).toEqual(['branch-right', 'branch', '@root', 'right']);
		expect(validateNestedRegionGeometry(prepared.graph, input, result)).toBeUndefined();
	});

	it('selects a root sibling-to-grandchild route through each target boundary', async () => {
		const persisted = persistedDepthTwoRegionDocument(rootSiblingToGrandchildDocument());
		const { layout } = await layoutDocument(persisted);
		const prepared = prepareLayoutDocument(persisted);
		const input = depthTwoRegionInput();
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		const relationId = 'right-to-grandchild';
		expect(layout.relations.find(({ id }) => id === relationId)).toEqual(
			result.layout.relations.find(({ id }) => id === relationId),
		);
		expect(
			result.portals
				.filter(({ relationId: id }) => id === relationId)
				.map(({ regionId, endpointId }) => [regionId, endpointId]),
		).toEqual([
			['right', 'd'],
			['branch', 'c'],
			['branch-right', 'c'],
		]);
		expect(
			result.ownedRoutes
				.filter(({ relationId: id }) => id === relationId)
				.map(({ regionId }) => regionId),
		).toEqual(['right', '@root', 'branch', 'branch-right']);
		const middle = defined(result.regions.find(({ id }) => id === 'middle'));
		const parentCorridor = defined(
			result.ownedRoutes.find(
				({ relationId: id, regionId }) => id === relationId && regionId === 'branch',
			),
		);
		expect(segmentEnters(parentCorridor.points, middle.bounds)).toBe(false);
		expect(validateNestedRegionGeometry(prepared.graph, input, result)).toBeUndefined();
	});

	it('routes two concurrent incidents through distinct leaf portals without a bridge', () => {
		const source = depthTwoRegionDocument();
		const document = {
			...source,
			relations: [
				...source.relations.filter(({ id }) => id !== 'at-root'),
				{ id: 'grandchild-to-right', from: 'c', to: 'd' },
			],
		};
		const prepared = prepareLayoutDocument(document);
		const input = depthTwoRegionInput();
		const attempt = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (attempt.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected selected dual incident: ${attempt.status}: ${attempt.reason}`);
		const incoming = defined(
			attempt.portals.find(
				({ regionId, relationId }) => regionId === 'branch-right' && relationId === 'inside-branch',
			),
		);
		const outgoing = defined(
			attempt.portals.find(
				({ regionId, relationId }) =>
					regionId === 'branch-right' && relationId === 'grandchild-to-right',
			),
		);
		expect(outgoing.point.x).toBeGreaterThan(incoming.point.x);
		expect(validateNestedRegionGeometry(prepared.graph, input, attempt)).toBeUndefined();
		const cache = new RegionLocalLayoutCache();
		const first = solveNestedRegionLayoutForProjection(
			prepared.graph,
			prepared.measurements,
			input,
			cache,
		);
		const second = solveNestedRegionLayoutForProjection(
			prepared.graph,
			prepared.measurements,
			input,
			cache,
		);
		expect(first).toEqual(attempt);
		expect(second).toEqual(attempt);
		expect(cache.stats.hits).toBeGreaterThan(0);
	});

	it('resolves a grandchild corridor through its nested parent', () => {
		const source = depthTwoRegionDocument();
		const document = {
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id !== 'inside-branch') return relation;
				return { ...relation, from: 'a-source' };
			}),
		};
		const prepared = prepareLayoutDocument(document);
		const attempt = solveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			depthTwoRegionInput(),
		);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		expect(
			attempt.ownedRoutes
				.filter(({ relationId }) => relationId === 'inside-branch')
				.map(({ regionId }) => regionId),
		).toEqual(['left', 'branch', 'branch-right']);
		expect(
			validateNestedRegionGeometry(prepared.graph, depthTwoRegionInput(), attempt),
		).toBeUndefined();
	});

	it('resolves the root corridor beside a valid nested child', () => {
		const source = depthTwoRegionDocument();
		const rightNode = defined(source.nodes.find(({ id }) => id === 'd'));
		const document = {
			...source,
			nodes: [
				...source.nodes,
				{
					...rightNode,
					id: 'd2',
					layoutOrder: orderKey('a6'),
				},
			],
			relations: [...source.relations, { id: 'inside-right', from: 'd', to: 'd2' }],
		};
		const input = depthTwoRegionInput();
		const assignments = new Map(input.regionByEndpointId);
		assignments.set('d2', 'right');
		const prepared = prepareLayoutDocument(document);
		const amendedInput = {
			...input,
			regionByEndpointId: assignments,
		};
		const attempt = solveNestedRegionLayout(prepared.graph, prepared.measurements, amendedInput);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		expect(
			attempt.ownedRoutes.some(
				({ relationId, regionId }) => relationId === 'inside-right' && regionId === 'right',
			),
		).toBe(true);
		expect(validateNestedRegionGeometry(prepared.graph, amendedInput, attempt)).toBeUndefined();
	});

	it('rejects a falsified grandchild route entering its opaque sibling', () => {
		const input = depthTwoRegionInput();
		const prepared = prepareLayoutDocument(depthTwoRegionDocument());
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (result.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected depth-two selection: ${result.status}: ${result.reason}`);
		const middle = defined(result.regions.find(({ id }) => id === 'middle'));
		const branch = defined(result.regions.find(({ id }) => id === 'branch'));
		const pieces = result.ownedRoutes.filter(({ relationId }) => relationId === 'inside-branch');
		const parent = defined(pieces.find(({ regionId }) => regionId === 'branch'));
		const first = defined(parent.points[0]);
		const last = defined(parent.points.at(-1));
		const unsafeY = middle.bounds.y + 2;
		const unsafeParent = [first, { x: first.x, y: unsafeY }, { x: last.x, y: unsafeY }, last];
		const unsafeRoute = [
			...defined(pieces[0]).points,
			...unsafeParent.slice(1),
			...defined(pieces[2]).points.slice(1),
		];
		const unsafe = {
			...result,
			regions: result.regions.map((region) => {
				if (region !== branch) return region;
				return {
					...region,
					localLayout: {
						...region.localLayout,
						relations: region.localLayout.relations.map((relation) => {
							if (relation.id !== 'inside-branch') return relation;
							return {
								...relation,
								points: unsafeRoute.map(({ x, y }) => ({
									x: x - branch.translation.x,
									y: y - branch.translation.y,
								})),
							};
						}),
					},
				};
			}),
			ownedRoutes: result.ownedRoutes.map((piece) => {
				if (piece !== parent) return piece;
				return { ...piece, points: unsafeParent };
			}),
			layout: {
				...result.layout,
				relations: result.layout.relations.map((relation) => {
					if (relation.id !== 'inside-branch') return relation;
					return { ...relation, points: unsafeRoute };
				}),
			},
		};
		expect(validateNestedRegionGeometry(prepared.graph, input, unsafe)).toContain('opaque child');
	});

	it('keeps child ranks and local geometry independent of a cross-region relation', () => {
		const { result } = selectedNestedRegionLayout();
		const left = result.regions.find(({ id }) => id === 'left');
		const right = result.regions.find(({ id }) => id === 'right');
		expect(left).toBeDefined();
		expect(right).toBeDefined();
		expect(left?.localLayout.relations.map(({ id }) => id)).toEqual(['inside-a']);
		expect(right?.localLayout.relations).toEqual([]);
		expect([...(left?.localRanks.byEndpointId ?? [])]).toEqual([
			['a-source', 1],
			['a-target', 0],
		]);
		const source = regionDocument();
		const withoutCross = { ...source, relations: source.relations.slice(0, 1) };
		const cold = selectedNestedRegionLayout(withoutCross).result;
		expect(cold.regions.find(({ id }) => id === 'left')?.localLayout).toEqual(left?.localLayout);
		expect(cold.regions.find(({ id }) => id === 'left')?.localRanks).toEqual(left?.localRanks);
	});

	it('owns the A-to-C route at the root and avoids the opaque middle child', () => {
		const { prepared, result } = selectedNestedRegionLayout();
		const middle = result.regions.find(({ id }) => id === 'middle');
		const parent = result.ownedRoutes.find(
			({ relationId, regionId }) => relationId === 'across-middle' && regionId === '@root',
		);
		expect(parent).toBeDefined();
		expect(parent?.points.slice(1, -1).every(({ y }) => y < (middle?.bounds.y ?? 0))).toBe(true);
		expect(result.portals.map(({ regionId }) => regionId)).toEqual(['left', 'right']);
		expect(
			result.ownedRoutes
				.filter(({ relationId }) => relationId === 'across-middle')
				.map(({ regionId }) => regionId),
		).toEqual(['left', '@root', 'right']);
		expect(
			validateNestedRegionGeometry(prepared.graph, nestedRegionInput(), result),
		).toBeUndefined();
	});

	it('uses lower incident portals when reverse flow puts a local node above the crossing source', () => {
		const document = {
			...regionDocument(),
			layout: defined(layoutConfiguration(LayoutDirection.BottomToTop, LayoutBias.Bottom)),
		};
		const prepared = prepareLayoutDocument(document, {
			nodes: {
				'a-source': { width: 80.25, height: 40.5 },
				'a-target': { width: 80.25, height: 40.5 },
				b: { width: 80.25, height: 40.5 },
				c: { width: 80.25, height: 40.5 },
			},
		});
		const input = nestedRegionInput();
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		expect(result.portals.map(({ side }) => side)).toEqual([
			RegionPortalSide.Bottom,
			RegionPortalSide.Bottom,
		]);
		const bottom = Math.max(...result.regions.map(({ bounds }) => bounds.y + bounds.height));
		const parent = result.ownedRoutes.find(({ regionId }) => regionId === result.rootId);
		expect(parent?.points.some(({ y }) => y > bottom)).toBe(true);
		expect(validateNestedRegionGeometry(prepared.graph, input, result)).toBeUndefined();
	});

	it('is invariant under input collection and assignment permutations', () => {
		const original = selectedNestedRegionLayout().result;
		const document = regionDocument();
		const permuted = {
			...document,
			nodes: [...document.nodes].reverse(),
			relations: [...document.relations].reverse(),
		};
		const assignment = nestedRegionInput();
		const regions = {
			regions: [...assignment.regions].reverse(),
			regionByEndpointId: new Map([...assignment.regionByEndpointId].reverse()),
		};
		const repeated = selectedNestedRegionLayout(permuted, regions).result;
		expect(repeated).toEqual(original);
	});

	it('rejects a parent route that enters any child interior', () => {
		const { prepared, result } = selectedNestedRegionLayout();
		const middle = result.regions.find(({ id }) => id === 'middle');
		const parent = result.ownedRoutes.find(({ regionId }) => regionId === '@root');
		if (middle === undefined || parent === undefined) throw new Error('Missing proof fixture');
		const first = parent.points[0];
		const last = parent.points.at(-1);
		if (first === undefined || last === undefined)
			throw new Error('Missing parent route endpoints');
		const unsafeY = middle.bounds.y + middle.bounds.height / 2;
		const unsafeParentPoints = [first, { x: first.x, y: unsafeY }, { x: last.x, y: unsafeY }, last];
		const unsafe = {
			...result,
			layout: {
				...result.layout,
				relations: result.layout.relations.map((route) => {
					if (route.id !== parent.relationId) return route;
					const sourcePort = route.points[0];
					const targetPort = route.points.at(-1);
					if (sourcePort === undefined || targetPort === undefined) return route;
					return {
						...route,
						points: [sourcePort, ...unsafeParentPoints, targetPort],
					};
				}),
			},
			ownedRoutes: result.ownedRoutes.map((route) => {
				if (route !== parent) return route;
				return { ...route, points: unsafeParentPoints };
			}),
		};
		expect(validateNestedRegionGeometry(prepared.graph, nestedRegionInput(), unsafe)).toContain(
			'opaque child',
		);
	});

	it('selects a valid incident corridor beside another local node', () => {
		const document = regionDocument('a-source');
		const prepared = prepareLayoutDocument(document);
		const input = nestedRegionInput();
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		expect(normalized.status).toBe(RegionCompositionModelStatus.Ready);
		if (normalized.status !== RegionCompositionModelStatus.Ready) return;
		expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, result)).toBeUndefined();
	});

	it('returns unknown for two LCA routes that cross without a bridge', () => {
		const source = regionDocument();
		const document = {
			...source,
			nodes: source.nodes.filter(({ id }) => id !== 'a-source'),
			relations: [
				{ id: 'across-middle', from: 'a-target', to: 'c' },
				{ id: 'b-to-a', from: 'b', to: 'a-target' },
			],
		};
		const base = nestedRegionInput();
		const regions = {
			...base,
			regionByEndpointId: new Map([...base.regionByEndpointId].filter(([id]) => id !== 'a-source')),
		};
		const prepared = prepareLayoutDocument(document);
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, regions);
		expect(result.status).toBe(RegionCompositionStatus.Unknown);
		if (result.status !== RegionCompositionStatus.Unknown) return;
		expect(result.reason).toContain('intersect without a bridge');
	});

	it('selects two LCA routes when their parent corridors are disjoint', () => {
		const source = regionDocument();
		const middle = source.nodes.find(({ id }) => id === 'b');
		if (middle === undefined) throw new Error('Missing middle fixture');
		const document = {
			...source,
			nodes: [
				...source.nodes.filter(({ id }) => id !== 'a-source'),
				{ ...middle, id: 'b2', layoutOrder: orderKey('a4') },
			],
			relations: [
				{ id: 'left-to-middle', from: 'a-target', to: 'b' },
				{ id: 'middle-to-right', from: 'b2', to: 'c' },
			],
		};
		const base = nestedRegionInput();
		const ownership = new Map(base.regionByEndpointId);
		ownership.delete('a-source');
		ownership.set('b2', 'middle');
		const regions = {
			...base,
			regionByEndpointId: ownership,
		};
		const prepared = prepareLayoutDocument(document);
		const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, regions);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
	});

	it('returns unsupported for invalid ownership and deeper hierarchy', () => {
		const prepared = prepareLayoutDocument(regionDocument());
		const invalidAssignment = nestedRegionInput();
		const noOwner = new Map(invalidAssignment.regionByEndpointId);
		noOwner.delete('b');
		expect(
			solveNestedRegionLayout(prepared.graph, prepared.measurements, {
				...invalidAssignment,
				regionByEndpointId: noOwner,
			}).status,
		).toBe(RegionCompositionStatus.Unsupported);
		const grandchild = nestedRegionInput();
		expect(
			solveNestedRegionLayout(prepared.graph, prepared.measurements, {
				...grandchild,
				regions: grandchild.regions.map((region) => {
					if (region.id !== 'right') return region;
					return { ...region, parentId: 'middle' };
				}),
			}).status,
		).toBe(RegionCompositionStatus.Unsupported);
	});
});
