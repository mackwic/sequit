import { describe, expect, it } from 'vitest';

import {
	type RegionLaneLeafCandidate,
	runRegionLaneLeafWitness,
	validateRegionLaneLeafWitness,
} from '../../../../src/app/workshop/visual-tests/solver-prototype/region-lane-leaf-witness';
import { defined, LaneOrientation } from '../../../../src/lib/core/document/logic-document';
import type { Point } from '../../../../src/lib/core/layout/layout-types';

function readyCandidate(): RegionLaneLeafCandidate {
	const witness = runRegionLaneLeafWitness();
	if (witness.candidate === undefined) throw new Error(witness.reason ?? 'Missing lane witness');
	return witness.candidate;
}

function withLocalRoutePoints(
	candidate: RegionLaneLeafCandidate,
	points: readonly Point[],
): RegionLaneLeafCandidate {
	const shared = defined(candidate.selected.regions[0]);
	const route = { ...defined(shared.localLayout.relations[0]), points };
	return {
		...candidate,
		selected: {
			...candidate.selected,
			regions: [
				{ ...shared, localLayout: { ...shared.localLayout, relations: [route] } },
				...candidate.selected.regions.slice(1),
			],
			layout: {
				...candidate.selected.layout,
				relations: [
					{
						...route,
						points: points.map(({ x, y }) => ({
							x: x + shared.translation.x,
							y: y + shared.translation.y,
						})),
					},
				],
			},
		},
	};
}

describe('observable shared lanes inside a region leaf', () => {
	it.each([LaneOrientation.Parallel, LaneOrientation.Transverse])(
		'composes two real lane frames next to an ordinary leaf in %s orientation',
		(orientation) => {
			const witness = runRegionLaneLeafWitness(orientation);
			expect(witness.reason).toBeUndefined();
			expect(witness.compositionIssue).toBeUndefined();
			expect(witness.independentIssue).toBeUndefined();
			const candidate = witness.candidate;
			expect(candidate).toBeDefined();
			if (candidate === undefined) return;
			expect(candidate.selected.regions.map(({ id }) => id)).toEqual(['shared', 'ordinary']);
			expect(candidate.lanes.map(({ localId }) => localId)).toEqual(['sales', 'service']);
			expect(
				candidate.selected.layout.lanes?.map(({ id, regionId, label }) => ({
					id,
					regionId,
					label,
				})),
			).toEqual([
				{ id: 'sales', regionId: 'shared', label: 'Vente' },
				{ id: 'service', regionId: 'shared', label: 'Service' },
			]);
			expect(candidate.selected.layout.relations.map(({ id }) => id)).toEqual(['handoff']);
			expect(candidate.selected.ownedRoutes.map(({ regionId }) => regionId)).toEqual(['shared']);
			expect(candidate.localRanks.get('request')).toBe(1);
			expect(candidate.localRanks.get('delivery')).toBe(0);
			expect(candidate.localRanks.get('neighbor')).toBe(0);
		},
	);

	it('keeps the lane leaf identical when the neighboring leaf changes width', () => {
		const first = runRegionLaneLeafWitness(LaneOrientation.Parallel, 120.5).candidate;
		const second = runRegionLaneLeafWitness(LaneOrientation.Parallel, 210.75).candidate;
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		if (first === undefined || second === undefined) return;
		expect(second.selected.regions[0]).toEqual(first.selected.regions[0]);
		expect(second.lanes).toEqual(first.lanes);
		expect(second.selected.layout.width).toBeGreaterThan(first.selected.layout.width);
		expect(second.selected.regions[1]?.bounds.width).toBeGreaterThan(
			first.selected.regions[1]?.bounds.width ?? 0,
		);
	});

	it('rejects a lane frame whose published translation is falsified', () => {
		const candidate = runRegionLaneLeafWitness().candidate;
		expect(candidate).toBeDefined();
		if (candidate === undefined) return;
		const firstLane = candidate.lanes[0];
		expect(firstLane).toBeDefined();
		if (firstLane === undefined) return;
		const falsified = {
			...candidate,
			lanes: [
				{ ...firstLane, bounds: { ...firstLane.bounds, x: firstLane.bounds.x + 1 } },
				...candidate.lanes.slice(1),
			],
		};
		expect(validateRegionLaneLeafWitness(falsified)).toContain('translated leaf');
	});

	it('rejects a node assignment outside its lane even when translation is intact', () => {
		const candidate = runRegionLaneLeafWitness().candidate;
		expect(candidate).toBeDefined();
		if (candidate === undefined) return;
		const falsified = {
			...candidate,
			laneByEndpointId: new Map([
				['request', 'service'],
				['delivery', 'service'],
			]),
		};
		expect(validateRegionLaneLeafWitness(falsified)).toBe('Element request leaves lane service.');
	});

	it('rejects a local route whose published points are falsified', () => {
		const candidate = runRegionLaneLeafWitness().candidate;
		expect(candidate).toBeDefined();
		if (candidate === undefined) return;
		const route = candidate.selected.layout.relations[0];
		expect(route).toBeDefined();
		if (route === undefined) return;
		const firstPoint = route.points[0];
		expect(firstPoint).toBeDefined();
		if (firstPoint === undefined) return;
		const falsified = {
			...candidate,
			selected: {
				...candidate.selected,
				layout: {
					...candidate.selected.layout,
					relations: [
						{
							...route,
							points: [{ ...firstPoint, x: firstPoint.x + 1 }, ...route.points.slice(1)],
						},
					],
				},
			},
		};
		expect(validateRegionLaneLeafWitness(falsified)).toContain('translated leaf');
	});

	it('rejects missing, overlapping, and off-canvas region frames', () => {
		const candidate = readyCandidate();
		const shared = defined(candidate.selected.regions[0]);
		const ordinary = defined(candidate.selected.regions[1]);
		for (const regions of [[shared], [shared, { ...ordinary, bounds: shared.bounds }]]) {
			expect(
				validateRegionLaneLeafWitness({
					...candidate,
					selected: { ...candidate.selected, regions },
				}),
			).toBe('The two region frames overlap or are missing.');
		}
		const offCanvas = {
			...candidate,
			selected: {
				...candidate.selected,
				regions: [
					shared,
					{
						...ordinary,
						bounds: { ...ordinary.bounds, x: candidate.selected.layout.width + 1 },
					},
				],
			},
		};
		expect(validateRegionLaneLeafWitness(offCanvas)).toBe('Region ordinary leaves the canvas.');
	});

	it('rejects an element that leaves its region while retaining its local translation', () => {
		const candidate = readyCandidate();
		const ordinary = defined(candidate.selected.regions[1]);
		const local = defined(ordinary.localLayout.elements[0]);
		const outside = {
			...local,
			bounds: { ...local.bounds, x: ordinary.bounds.width + 1 },
		};
		const falsified = {
			...candidate,
			selected: {
				...candidate.selected,
				regions: [
					defined(candidate.selected.regions[0]),
					{ ...ordinary, localLayout: { ...ordinary.localLayout, elements: [outside] } },
				],
				layout: {
					...candidate.selected.layout,
					elements: candidate.selected.layout.elements.map((element) => {
						if (element.id !== outside.id) return element;
						return {
							...outside,
							bounds: {
								...outside.bounds,
								x: outside.bounds.x + ordinary.translation.x,
								y: outside.bounds.y + ordinary.translation.y,
							},
						};
					}),
				},
			},
		};
		expect(validateRegionLaneLeafWitness(falsified)).toBe('Element neighbor leaves its region.');
	});

	it('rejects a missing element in the assembled canvas', () => {
		const candidate = readyCandidate();
		const falsified = {
			...candidate,
			selected: {
				...candidate.selected,
				layout: {
					...candidate.selected.layout,
					elements: candidate.selected.layout.elements.filter(({ id }) => id !== 'neighbor'),
				},
			},
		};
		expect(validateRegionLaneLeafWitness(falsified)).toBe(
			'Element neighbor disagrees with its translated leaf.',
		);
	});

	it('rejects a route that exits its region or contains a diagonal segment', () => {
		const candidate = readyCandidate();
		const shared = defined(candidate.selected.regions[0]);
		const points = defined(shared.localLayout.relations[0]).points;
		const outside = withLocalRoutePoints(candidate, [
			{ x: shared.bounds.width + 1, y: defined(points[0]).y },
			...points.slice(1),
		]);
		expect(validateRegionLaneLeafWitness(outside)).toBe('Relation handoff leaves its region.');
		const first = defined(points[0]);
		const diagonal = withLocalRoutePoints(candidate, [
			first,
			{ x: first.x + 1, y: first.y + 1 },
			...points.slice(2),
		]);
		expect(validateRegionLaneLeafWitness(diagonal)).toBe('Relation handoff is not orthogonal.');
	});

	it('requires exactly two published lanes with a shared-region owner', () => {
		const candidate = readyCandidate();
		const first = defined(candidate.lanes[0]);
		expect(validateRegionLaneLeafWitness({ ...candidate, lanes: [first] })).toBe(
			'The shared leaf must publish two lanes.',
		);
		expect(
			validateRegionLaneLeafWitness({
				...candidate,
				lanes: [{ ...first, regionId: 'ordinary' }, defined(candidate.lanes[1])],
			}),
		).toBe(`Lane ${first.id} is missing or has the wrong owner.`);
	});

	it('rejects absent lane identity and overlapping lane frames', () => {
		const candidate = readyCandidate();
		const first = defined(candidate.lanes[0]);
		const second = defined(candidate.lanes[1]);
		expect(
			validateRegionLaneLeafWitness({
				...candidate,
				lanes: [{ ...first, localId: 'missing' }, second],
			}),
		).toBe(`Lane ${first.id} is missing or has the wrong owner.`);
		const shared = defined(candidate.selected.regions[0]);
		const localFirst = defined(shared.localLayout.lanes?.[0]);
		const localSecond = defined(shared.localLayout.lanes?.[1]);
		const publishedSecond = defined(candidate.selected.layout.lanes?.[1]);
		const overlapping = {
			...candidate,
			lanes: [first, { ...second, bounds: first.bounds }],
			selected: {
				...candidate.selected,
				regions: [
					{
						...shared,
						localLayout: {
							...shared.localLayout,
							lanes: [localFirst, { ...localSecond, bounds: localFirst.bounds }],
						},
					},
					...candidate.selected.regions.slice(1),
				],
				layout: {
					...candidate.selected.layout,
					lanes: [
						defined(candidate.selected.layout.lanes?.[0]),
						{
							...publishedSecond,
							bounds: first.bounds,
						},
					],
				},
			},
		};
		expect(validateRegionLaneLeafWitness(overlapping)).toBe('The two lanes overlap.');
	});

	it('rejects a shared leaf that loses its local lanes', () => {
		const candidate = readyCandidate();
		const shared = defined(candidate.selected.regions[0]);
		const localLayout = {
			width: shared.localLayout.width,
			height: shared.localLayout.height,
			elements: shared.localLayout.elements,
			relations: shared.localLayout.relations,
		};
		const falsified = {
			...candidate,
			selected: {
				...candidate.selected,
				regions: [{ ...shared, localLayout }, ...candidate.selected.regions.slice(1)],
			},
		};
		expect(validateRegionLaneLeafWitness(falsified)).toBe(
			'Lane shared/sales is missing or has the wrong owner.',
		);
	});

	it('rejects a published lane outside its owner even when translations agree', () => {
		const candidate = readyCandidate();
		const shared = defined(candidate.selected.regions[0]);
		const first = defined(candidate.lanes[0]);
		const local = defined(shared.localLayout.lanes?.[0]);
		const localBounds = { ...local.bounds, x: shared.bounds.width + 1 };
		const bounds = {
			...localBounds,
			x: localBounds.x + shared.translation.x,
			y: localBounds.y + shared.translation.y,
		};
		const falsified = {
			...candidate,
			lanes: [{ ...first, bounds }, ...candidate.lanes.slice(1)],
			selected: {
				...candidate.selected,
				regions: [
					{
						...shared,
						localLayout: {
							...shared.localLayout,
							lanes: [
								{ ...local, bounds: localBounds },
								...defined(shared.localLayout.lanes).slice(1),
							],
						},
					},
					...candidate.selected.regions.slice(1),
				],
				layout: {
					...candidate.selected.layout,
					lanes: defined(candidate.selected.layout.lanes).map((lane) => {
						if (lane.id !== first.localId) return lane;
						return { ...lane, bounds };
					}),
				},
			},
		};
		expect(validateRegionLaneLeafWitness(falsified)).toBe('Lane shared/sales leaves its region.');
	});

	it('rejects an assignment to a missing lane or a missing endpoint', () => {
		const candidate = readyCandidate();
		for (const [endpointId, laneId] of [
			['request', 'missing'],
			['unknown-endpoint', 'sales'],
		] as const) {
			const assignments = new Map(candidate.laneByEndpointId);
			assignments.set(endpointId, laneId);
			expect(
				validateRegionLaneLeafWitness({
					...candidate,
					laneByEndpointId: assignments,
				}),
			).toBe(`Element ${endpointId} leaves lane ${laneId}.`);
		}
	});
});
