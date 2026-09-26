import { describe, expect, it } from 'vitest';

import {
	defined,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import {
	entersInterior,
	finiteBounds,
	inside,
	orthogonal,
	overlaps,
	segmentEnters,
	within,
} from '../../../../src/lib/core/layout/geometry/nested-region-geometry-primitives';
import type { LayoutRelation, LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import type {
	RegionChildPlacement,
	RegionLayoutSelected,
	RegionOwnedRoute,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { validateNestedRegionGeometry } from '../../../../src/lib/core/layout/regions/validation/nested-region-geometry';
import {
	nestedRegionInput,
	regionDocument,
	selectedNestedRegionLayout,
} from './nested-region-fixture';

type Mutable<T> =
	T extends ReadonlyMap<infer K, infer V>
		? Map<K, Mutable<V>>
		: T extends readonly (infer U)[]
			? Mutable<U>[]
			: T extends object
				? { -readonly [P in keyof T]: Mutable<T[P]> }
				: T;

type Candidate = Mutable<RegionLayoutSelected>;

function region(candidate: Candidate, id: string): Mutable<RegionChildPlacement> {
	const found = candidate.regions.find((value) => value.id === id);
	if (found === undefined) throw new Error(`Missing region ${id}`);
	return found;
}

function route(candidate: Candidate, id: string): Mutable<LayoutRelation> {
	const found = candidate.layout.relations.find((value) => value.id === id);
	if (found === undefined) throw new Error(`Missing route ${id}`);
	return found;
}

function owner(
	candidate: Candidate,
	relationId: string,
	regionId: string,
): Mutable<RegionOwnedRoute> {
	const found = candidate.ownedRoutes.find(
		(value) => value.relationId === relationId && value.regionId === regionId,
	);
	if (found === undefined) throw new Error(`Missing owner ${regionId}`);
	return found;
}

function cloneLayout(layout: LayoutResult): Mutable<LayoutResult> {
	return {
		width: layout.width,
		height: layout.height,
		elements: layout.elements.map((element) => ({ ...element, bounds: { ...element.bounds } })),
		relations: layout.relations.map((relation) => ({
			...relation,
			points: relation.points.map((point) => ({ ...point })),
		})),
	};
}

function cloneCandidate(result: RegionLayoutSelected): Candidate {
	return {
		status: result.status,
		rootId: result.rootId,
		layout: cloneLayout(result.layout),
		regions: result.regions.map((value) => ({
			id: value.id,
			parentId: value.parentId,
			bounds: { ...value.bounds },
			translation: { ...value.translation },
			localLayout: cloneLayout(value.localLayout),
			localRanks: {
				byEndpointId: new Map(value.localRanks.byEndpointId),
				bands: value.localRanks.bands.map((band) => [...band]),
			},
		})),
		portals: result.portals.map((portal) => ({
			...portal,
			point: { ...portal.point },
			localPoint: { ...portal.localPoint },
		})),
		ownedRoutes: result.ownedRoutes.map((part) => ({
			...part,
			points: part.points.map((point) => ({ ...point })),
		})),
	};
}

function rejected(mutate: (candidate: Candidate) => void): string | undefined {
	const { prepared, result } = selectedNestedRegionLayout();
	const candidate = cloneCandidate(result);
	mutate(candidate);
	return validateNestedRegionGeometry(prepared.graph, nestedRegionInput(), candidate);
}

describe('nested region geometry oracle', () => {
	it('rejects a lower portal mislabeled as an upper boundary', () => {
		const document = {
			...regionDocument(),
			layout: defined(layoutConfiguration(LayoutDirection.BottomToTop, LayoutBias.Bottom)),
		};
		const { prepared, result } = selectedNestedRegionLayout(document);
		const candidate = cloneCandidate(result);
		defined(candidate.portals[0]).side = RegionPortalSide.Top;
		expect(validateNestedRegionGeometry(prepared.graph, nestedRegionInput(), candidate)).toContain(
			'portal outside',
		);
	});

	it('distinguishes strict region interiors from portal boundary contact', () => {
		const box = { x: 10, y: 20, width: 40, height: 30 };
		expect(finiteBounds(box)).toBe(true);
		expect(finiteBounds({ ...box, x: NaN })).toBe(false);
		expect(finiteBounds({ ...box, width: 0 })).toBe(false);
		expect(finiteBounds({ ...box, height: Infinity })).toBe(false);
		expect(within(box, { x: 10, y: 20 })).toBe(true);
		expect(within(box, { x: 51, y: 20 })).toBe(false);
		expect(within(box, { x: 20, y: 51 })).toBe(false);
		expect(inside(box, { x: 11, y: 21, width: 38, height: 28 })).toBe(true);
		expect(inside(box, { x: 10, y: 21, width: 38, height: 28 })).toBe(false);
		expect(overlaps(box, { x: 50, y: 20, width: 10, height: 10 })).toBe(false);
		expect(overlaps(box, { x: 49, y: 20, width: 10, height: 10 })).toBe(true);
		expect(entersInterior({ x: 20, y: 0 }, { x: 20, y: 20 }, box)).toBe(false);
		expect(entersInterior({ x: 20, y: 0 }, { x: 20, y: 30 }, box)).toBe(true);
		expect(entersInterior({ x: 0, y: 25 }, { x: 30, y: 25 }, box)).toBe(true);
		expect(entersInterior({ x: 0, y: 20 }, { x: 30, y: 20 }, box)).toBe(false);
		expect(entersInterior({ x: 0, y: 0 }, { x: 20, y: 25 }, box)).toBe(true);
		expect(
			segmentEnters(
				[
					{ x: 20, y: 0 },
					{ x: 20, y: 30 },
				],
				box,
			),
		).toBe(true);
		expect(
			orthogonal([
				{ x: 0, y: 0 },
				{ x: 0, y: 10 },
				{ x: 10, y: 10 },
			]),
		).toBe(true);
		expect(
			orthogonal([
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			]),
		).toBe(false);
		expect(orthogonal([{ x: 0, y: 0 }])).toBe(false);
		expect(
			orthogonal([
				{ x: 0, y: 0 },
				{ x: NaN, y: 0 },
			]),
		).toBe(false);
		expect(
			segmentEnters(
				[
					{ x: 0, y: 0 },
					{ x: 0, y: 10 },
				],
				box,
			),
		).toBe(false);
		const sparse: { x: number; y: number }[] = [];
		sparse.length = 2;
		expect(orthogonal(sparse)).toBe(false);
		expect(segmentEnters(sparse, box)).toBe(true);
	});

	it.each([
		[
			'invalid root dimensions',
			(candidate: Candidate) => {
				candidate.layout.width = NaN;
			},
			'root canvas',
		],
		[
			'duplicate element identity',
			(candidate: Candidate) => {
				candidate.layout.elements.push({ ...defined(candidate.layout.elements[0]) });
			},
			'repeats an element identity',
		],
		[
			'duplicate relation identity',
			(candidate: Candidate) => {
				candidate.layout.relations.push({ ...defined(candidate.layout.relations[0]) });
			},
			'repeats a relation identity',
		],
		[
			'child outside root',
			(candidate: Candidate) => {
				region(candidate, 'left').bounds.x = -1;
			},
			'outside the root',
		],
		[
			'child canvas touching its boundary',
			(candidate: Candidate) => {
				const left = region(candidate, 'left');
				left.translation.x = left.bounds.x;
			},
			'local canvas',
		],
		[
			'nonfinite translation',
			(candidate: Candidate) => {
				region(candidate, 'left').translation.y = Infinity;
			},
			'local canvas',
		],
		[
			'child canvas overflowing right edge',
			(candidate: Candidate) => {
				const left = region(candidate, 'left');
				left.translation.x = left.bounds.x + left.bounds.width;
			},
			'local canvas',
		],
		[
			'child canvas overflowing bottom edge',
			(candidate: Candidate) => {
				const left = region(candidate, 'left');
				left.translation.y = left.bounds.y + left.bounds.height;
			},
			'local canvas',
		],
		[
			'missing composed element',
			(candidate: Candidate) => {
				candidate.layout.elements = candidate.layout.elements.filter(({ id }) => id !== 'b');
			},
			'not confined',
		],
		[
			'element changed after child translation',
			(candidate: Candidate) => {
				const element = candidate.layout.elements.find(({ id }) => id === 'b');
				if (element !== undefined) element.bounds.x += 1;
			},
			'not confined',
		],
		[
			'element vertical offset changed',
			(candidate: Candidate) => {
				const global = candidate.layout.elements.find(({ id }) => id === 'b');
				if (global !== undefined) global.bounds.y += 1;
			},
			'not confined',
		],
		[
			'element width changed',
			(candidate: Candidate) => {
				const global = candidate.layout.elements.find(({ id }) => id === 'b');
				if (global !== undefined) global.bounds.width += 1;
			},
			'not confined',
		],
		[
			'element height changed',
			(candidate: Candidate) => {
				const global = candidate.layout.elements.find(({ id }) => id === 'b');
				if (global !== undefined) global.bounds.height += 1;
			},
			'not confined',
		],
		[
			'element overflowing its region',
			(candidate: Candidate) => {
				const middle = region(candidate, 'middle');
				const local = middle.localLayout.elements.find(({ id }) => id === 'b');
				const global = candidate.layout.elements.find(({ id }) => id === 'b');
				if (local === undefined || global === undefined) return;
				local.bounds.x = middle.localLayout.width + 40;
				global.bounds.x = middle.translation.x + local.bounds.x;
			},
			'not confined',
		],
		[
			'overlapping siblings',
			(candidate: Candidate) => {
				const middle = region(candidate, 'middle');
				middle.bounds.x -= 120;
				middle.translation.x -= 120;
				const global = candidate.layout.elements.find(({ id }) => id === 'b');
				if (global !== undefined) global.bounds.x -= 120;
			},
			'overlap',
		],
	] as const)('rejects %s', (_, mutate, expected) => {
		expect(rejected(mutate)).toContain(expected);
	});

	it.each([
		[
			'portal outside boundary',
			(candidate: Candidate) => {
				defined(candidate.portals[0]).point.y += 1;
			},
			'portal outside',
		],
		[
			'portal on left corner',
			(candidate: Candidate) => {
				defined(candidate.portals[0]).point.x = region(candidate, 'left').bounds.x;
			},
			'portal outside',
		],
		[
			'portal on right corner',
			(candidate: Candidate) => {
				const left = region(candidate, 'left').bounds;
				defined(candidate.portals[0]).point.x = left.x + left.width;
			},
			'portal outside',
		],
		[
			'portal for wrong endpoint',
			(candidate: Candidate) => {
				defined(candidate.portals[0]).endpointId = 'b';
			},
			'wrong endpoint',
		],
		[
			'portal for wrong region',
			(candidate: Candidate) => {
				defined(candidate.portals[0]).regionId = 'middle';
			},
			'portal outside',
		],
		[
			'portal with wrong local coordinate',
			(candidate: Candidate) => {
				defined(candidate.portals[0]).localPoint.x += 1;
			},
			'portal outside',
		],
		[
			'portal with wrong local height',
			(candidate: Candidate) => {
				defined(candidate.portals[0]).localPoint.y = 1;
			},
			'portal outside',
		],
		[
			'missing incident portal',
			(candidate: Candidate) => {
				candidate.portals.pop();
			},
			'missing incident portal',
		],
		[
			'root route owned by child',
			(candidate: Candidate) => {
				owner(candidate, 'across-middle', '@root').regionId = 'left';
			},
			'least common ancestor',
		],
		[
			'source route owned by root',
			(candidate: Candidate) => {
				owner(candidate, 'across-middle', 'left').regionId = '@root';
			},
			'incident child owner',
		],
		[
			'disconnected source portal',
			(candidate: Candidate) => {
				const part = owner(candidate, 'across-middle', 'left');
				const last = part.points.length - 1;
				const point = defined(part.points[last]);
				part.points[last] = { ...point, x: point.x + 1 };
			},
			'disconnected source portal',
		],
		[
			'disconnected parent portal',
			(candidate: Candidate) => {
				const part = owner(candidate, 'across-middle', '@root');
				const point = defined(part.points[0]);
				part.points[0] = { ...point, x: point.x + 1 };
			},
			'disconnected parent route',
		],
		[
			'disconnected target portal',
			(candidate: Candidate) => {
				const part = owner(candidate, 'across-middle', '@root');
				const last = part.points.length - 1;
				const point = defined(part.points[last]);
				part.points[last] = { ...point, x: point.x + 1 };
			},
			'disconnected target portal',
		],
		[
			'disconnected target route',
			(candidate: Candidate) => {
				const part = owner(candidate, 'across-middle', 'right');
				const point = defined(part.points[0]);
				part.points[0] = { ...point, x: point.x + 1 };
			},
			'disconnected target route',
		],
		[
			'missing parent route owner',
			(candidate: Candidate) => {
				candidate.ownedRoutes = candidate.ownedRoutes.filter(
					({ regionId }) => regionId !== '@root',
				);
			},
			'no composed route',
		],
		[
			'wrong local relation owner',
			(candidate: Candidate) => {
				owner(candidate, 'inside-a', 'left').regionId = 'middle';
			},
			'wrong owner',
		],
		[
			'missing local child route',
			(candidate: Candidate) => {
				region(candidate, 'left').localLayout.relations = [];
			},
			'absent from its child layout',
		],
		[
			'local route with an unapproved extra bend',
			(candidate: Candidate) => {
				const local = owner(candidate, 'inside-a', 'left');
				const global = route(candidate, 'inside-a');
				const repeated = { ...defined(local.points[0]) };
				local.points.splice(1, 0, repeated);
				global.points.splice(1, 0, { ...repeated });
			},
			'changed during composition',
		],
		[
			'child route leaving its footprint',
			(candidate: Candidate) => {
				const local = owner(candidate, 'across-middle', 'left');
				const global = route(candidate, 'across-middle');
				const portal = defined(local.points.at(-1));
				const outside = { x: portal.x, y: portal.y - 1 };
				local.points.splice(1, 0, outside);
				global.points.splice(1, 0, { ...outside });
			},
			'leaves its owning child',
		],
		[
			'cross relation using a shifted source port',
			(candidate: Candidate) => {
				const local = owner(candidate, 'across-middle', 'left');
				const global = route(candidate, 'across-middle');
				const oldPort = defined(local.points[0]);
				const portal = defined(local.points.at(-1));
				const newPort = { x: oldPort.x + 5, y: oldPort.y };
				const bend = { x: newPort.x, y: portal.y };
				local.points = [newPort, bend, portal];
				global.points = [newPort, bend, ...global.points.slice(1)];
			},
			'source port',
		],
		[
			'cross relation using a shifted target port',
			(candidate: Candidate) => {
				const local = owner(candidate, 'across-middle', 'right');
				const global = route(candidate, 'across-middle');
				const oldPort = defined(local.points.at(-1));
				const portal = defined(local.points[0]);
				const newPort = { x: oldPort.x + 5, y: oldPort.y };
				const bend = { x: newPort.x, y: portal.y };
				local.points = [portal, bend, newPort];
				global.points = [...global.points.slice(0, -1), bend, newPort];
			},
			'target port',
		],
		[
			'missing composed relation',
			(candidate: Candidate) => {
				candidate.layout.relations = candidate.layout.relations.filter(
					({ id }) => id !== 'inside-a',
				);
			},
			'each source relation',
		],
		[
			'route differing from owned pieces',
			(candidate: Candidate) => {
				const crossing = route(candidate, 'across-middle');
				const first = defined(crossing.points[2]);
				const second = defined(crossing.points[3]);
				crossing.points[2] = { ...first, y: first.y + 1 };
				crossing.points[3] = { ...second, y: second.y + 1 };
			},
			'differs from its owned route pieces',
		],
		[
			'local child route altered by parent',
			(candidate: Candidate) => {
				const local = region(candidate, 'left').localLayout.relations[0];
				if (local === undefined) return;
				const point = defined(local.points[0]);
				local.points[0] = { ...point, x: point.x + 1 };
			},
			'changed during composition',
		],
		[
			'nonorthogonal parent route',
			(candidate: Candidate) => {
				const crossing = route(candidate, 'across-middle');
				const point = defined(crossing.points[2]);
				crossing.points[2] = { ...point, x: point.x + 1 };
			},
			'orthogonal route',
		],
	] as const)('rejects %s', (_, mutate, expected) => {
		expect(rejected(mutate)).toContain(expected);
	});

	it('rejects incomplete route ownership before accepting a composed result', () => {
		expect(
			rejected((candidate) => {
				candidate.regions = candidate.regions.filter(({ id }) => id !== 'right');
			}),
		).toContain('missing incident portal');
		expect(
			rejected((candidate) => {
				owner(candidate, 'across-middle', 'left').points = [];
			}),
		).toContain('disconnected source portal');
		expect(
			rejected((candidate) => {
				owner(candidate, 'across-middle', '@root').points = [];
			}),
		).toContain('disconnected parent route');
		expect(
			rejected((candidate) => {
				owner(candidate, 'across-middle', 'right').points = [];
			}),
		).toContain('disconnected target route');
		expect(
			rejected((candidate) => {
				owner(candidate, 'across-middle', '@root').points.splice(1, 1);
			}),
		).toContain('differs from its owned route pieces');
		expect(
			rejected((candidate) => {
				const element = defined(candidate.layout.elements[0]);
				candidate.layout.elements.push({ ...element, id: 'ghost' });
			}),
		).toContain('each source node');
	});
});
