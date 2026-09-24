import { expect, it } from 'vitest';

import {
	composedFixture,
	composedSettings,
} from '../../../../src/app/workshop/solver-prototype/composed-fixtures';
import {
	solveComposedSlice,
	validateComposedGeometry,
} from '../../../../src/app/workshop/solver-prototype/composed-slice';

function blockingWitness() {
	const input = composedFixture('blocking');
	const settings = composedSettings();
	const solution = solveComposedSlice(input, settings);
	const selected = solution.candidates.find(({ status }) => status === 'selected');
	if (selected?.geometry === undefined) throw new Error('Expected selected blocking geometry');
	return { input, settings, geometry: selected.geometry };
}

it('rejects missing or falsely owned obstacles instead of accepting a stripped group', () => {
	const { input, settings, geometry } = blockingWitness();
	const withoutGroup = {
		...geometry,
		boxes: geometry.boxes.filter(({ id }) => id !== 'sd-work'),
	};
	expect(validateComposedGeometry(input, withoutGroup, settings)).toMatch(/sd-work.*absente/);
	const wrongOwner = {
		...geometry,
		boxes: geometry.boxes.map((box) => {
			if (box.id !== 'sd-work') return box;
			return { ...box, laneId: 'S' };
		}),
	};
	expect(validateComposedGeometry(input, wrongOwner, settings)).toMatch(/sd-work.*mauvaise lane/);
	const withoutMiddleLane = {
		...geometry,
		lanes: geometry.lanes.filter(({ id }) => id !== 'SD'),
	};
	expect(validateComposedGeometry(input, withoutMiddleLane, settings)).toMatch(/lane SD.*absente/);
});

it('rejects a route that crosses itself while remaining outside the boxes', () => {
	const { input, settings, geometry } = blockingWitness();
	const altered = {
		...geometry,
		paths: geometry.paths.map((path) => {
			if (path.relationId !== 'a-target') return path;
			const first = path.points[0];
			if (first === undefined) throw new Error('Expected source attachment');
			return {
				...path,
				points: [
					first,
					{ x: 204, y: 30 },
					{ x: 204, y: 60 },
					{ x: 180, y: 60 },
					{ x: 180, y: 120 },
					{ x: 210, y: 120 },
					{ x: 210, y: 80 },
					{ x: 170, y: 80 },
					{ x: 170, y: 140 },
					{ x: 204, y: 140 },
					...path.points.slice(2),
				],
			};
		}),
	};
	expect(validateComposedGeometry(input, altered, settings)).toMatch(
		/a-target.*se croise elle-même/,
	);
});

it('permits a collinear split and the adjacent bend it shares', () => {
	const { input, settings, geometry } = blockingWitness();
	const split = {
		...geometry,
		paths: geometry.paths.map((path) => {
			if (path.relationId !== 'a-target') return path;
			const first = path.points[0];
			const second = path.points[1];
			if (first === undefined || second === undefined)
				throw new Error('Expected the first straight segment');
			const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
			return { ...path, points: [first, midpoint, ...path.points.slice(1)] };
		}),
	};
	expect(validateComposedGeometry(input, split, settings)).toBeUndefined();
});

it('rejects a route that doubles back along a vertical segment', () => {
	const { input, settings, geometry } = blockingWitness();
	const altered = {
		...geometry,
		paths: geometry.paths.map((path) => {
			if (path.relationId !== 'a-target') return path;
			const index = path.points.findIndex((start, index) => {
				const end = path.points[index + 1];
				return start.x === end?.x && start.y !== end.y;
			});
			if (index < 0) throw new Error('Expected a vertical segment in the routed witness');
			const start = path.points[index];
			const end = path.points[index + 1];
			if (start === undefined || end === undefined) throw new Error('Expected segment endpoints');
			const third = (end.y - start.y) / 3;
			const firstTurn = { x: start.x, y: start.y + third };
			const secondTurn = { x: start.x, y: start.y + 2 * third };
			const backwardTurn = { x: start.x, y: start.y + third / 2 };
			return {
				...path,
				points: [
					...path.points.slice(0, index + 1),
					firstTurn,
					secondTurn,
					backwardTurn,
					...path.points.slice(index + 1),
				],
			};
		}),
	};
	expect(validateComposedGeometry(input, altered, settings)).toMatch(
		/a-target.*se croise elle-même/,
	);
});

it('rejects duplicate and unknown lane identities before interpreting box ownership', () => {
	const { input, settings, geometry } = blockingWitness();
	const firstLane = geometry.lanes[0];
	if (firstLane === undefined) throw new Error('Expected first lane');
	expect(
		validateComposedGeometry(
			input,
			{ ...geometry, lanes: [...geometry.lanes, firstLane] },
			settings,
		),
	).toMatch(/lane S est dupliquée/);
	expect(
		validateComposedGeometry(
			input,
			{ ...geometry, lanes: [...geometry.lanes, { ...firstLane, id: 'unknown-lane' }] },
			settings,
		),
	).toMatch(/lane unknown-lane est inconnue/);
});

it('rejects a false box kind, a duplicate identity and an unowned extra box', () => {
	const { input, settings, geometry } = blockingWitness();
	const group = geometry.boxes.find(({ id }) => id === 'sd-work');
	if (group === undefined) throw new Error('Expected group box');
	const wrongKind = {
		...geometry,
		boxes: geometry.boxes.map((box) => {
			if (box.id !== group.id) return box;
			return { ...box, kind: 'node' as const };
		}),
	};
	expect(validateComposedGeometry(input, wrongKind, settings)).toMatch(/sd-work.*mauvais type/);
	const corner = { x: 0, y: 0, width: 1, height: 1 };
	const duplicate = {
		...geometry,
		boxes: [...geometry.boxes, { id: 'a', laneId: 'S', kind: 'node' as const, bounds: corner }],
	};
	expect(validateComposedGeometry(input, duplicate, settings)).toMatch(/boîte a est dupliquée/);
	const unknown = {
		...geometry,
		boxes: [...geometry.boxes, { id: 'ghost', laneId: 'S', kind: 'node' as const, bounds: corner }],
	};
	expect(validateComposedGeometry(input, unknown, settings)).toMatch(/boîte ghost est inconnue/);
});

it('enforces the explicitly reversed outer-lane relation direction', () => {
	const input = composedFixture('free', 'vertical', { direction: 'reverse' });
	const misplacedTarget = {
		...input,
		graph: {
			...input.graph,
			elements: input.graph.elements.map((element) => {
				if (element.id === 'target') return { ...element, laneId: 'C' };
				return element;
			}),
		},
	};
	expect(() => solveComposedSlice(misplacedTarget, composedSettings())).toThrow(
		'target must be a node in the first lane',
	);
	const misplacedSource = {
		...input,
		graph: {
			...input.graph,
			elements: input.graph.elements.map((element) => {
				if (element.id === 'a') return { ...element, laneId: 'S' };
				return element;
			}),
		},
	};
	expect(() => solveComposedSlice(misplacedSource, composedSettings())).toThrow(
		'last lane to the shared target',
	);
});

it('defaults a custom three-lane fixture to the forward relation direction', () => {
	const input = composedFixture('free', 'horizontal', { laneIds: ['A', 'B', 'C'] });
	expect(input.graph.id).toBe('composed-free-horizontal-A-B-C-forward');
	expect(input.direction).toBeUndefined();
	expect(input.graph.elements.find(({ id }) => id === 'a')?.laneId).toBe('A');
	expect(input.graph.elements.find(({ id }) => id === 'target')?.laneId).toBe('C');
	expect(solveComposedSlice(input, composedSettings()).candidates).toContainEqual(
		expect.objectContaining({ status: 'selected' }),
	);
});
