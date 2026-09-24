import { describe, expect, it } from 'vitest';

import {
	composedFixture,
	composedSettings,
} from '../../../../src/app/workshop/solver-prototype/composed-fixtures';
import {
	type ComposedGeometry,
	type ComposedInput,
	solveComposedSlice,
	validateComposedGeometry,
} from '../../../../src/app/workshop/solver-prototype/composed-slice';

function choice(input: ComposedInput): ComposedGeometry {
	const solution = solveComposedSlice(input, composedSettings());
	const selected = solution.candidates.find(({ status }) => status === 'selected');
	if (selected?.geometry === undefined) throw new Error('Missing selected route witness.');
	return selected.geometry;
}

function replaceFirstPath(
	geometry: ComposedGeometry,
	change: (path: ComposedGeometry['paths'][number]) => ComposedGeometry['paths'][number],
): ComposedGeometry {
	const first = geometry.paths[0];
	if (first === undefined) throw new Error('Missing first path.');
	return { ...geometry, paths: [change(first), ...geometry.paths.slice(1)] };
}

function replaceFirstBox(
	geometry: ComposedGeometry,
	change: (box: ComposedGeometry['boxes'][number]) => ComposedGeometry['boxes'][number],
): ComposedGeometry {
	const first = geometry.boxes[0];
	if (first === undefined) throw new Error('Missing first box.');
	return { ...geometry, boxes: [change(first), ...geometry.boxes.slice(1)] };
}

describe('composed input boundary', () => {
	const base = composedFixture('free');
	const first = base.relations[0];
	const second = base.relations[1];
	const third = base.relations[2];
	if (first === undefined || second === undefined || third === undefined)
		throw new Error('Missing fixture relations.');
	const cases: readonly { name: string; input: ComposedInput; error: RegExp }[] = [
		{
			name: 'missing arrival',
			input: { ...base, relations: base.relations.slice(0, 2) },
			error: /three relations/,
		},
		{
			name: 'duplicate relation identity',
			input: { ...base, relations: [first, { ...second, id: first.id }, third] },
			error: /unique/,
		},
		{
			name: 'unknown target',
			input: { ...base, targetId: 'absent' },
			error: /target must be/,
		},
		{
			name: 'target in first lane',
			input: {
				...base,
				graph: {
					...base.graph,
					elements: base.graph.elements.map((element) => {
						if (element.id === 'target') return { ...element, laneId: 'S' };
						return element;
					}),
				},
			},
			error: /target must be/,
		},
		{
			name: 'arrival at another endpoint',
			input: { ...base, relations: [{ ...first, to: 'a' }, ...base.relations.slice(1)] },
			error: /first lane to the shared target/,
		},
		{
			name: 'source absent from first lane',
			input: { ...base, relations: [{ ...first, from: 'absent' }, ...base.relations.slice(1)] },
			error: /first lane to the shared target/,
		},
		{ name: 'zero port spacing', input: { ...base, portSpacing: 0 }, error: /Port spacing/ },
		{
			name: 'non-finite port spacing',
			input: { ...base, portSpacing: Number.NaN },
			error: /Port spacing/,
		},
		{ name: 'negative face inset', input: { ...base, faceInset: -1 }, error: /Face inset/ },
		{
			name: 'non-finite face inset',
			input: { ...base, faceInset: Number.POSITIVE_INFINITY },
			error: /Face inset/,
		},
	];
	it.each(cases)('rejects $name', ({ input, error }) => {
		expect(() => solveComposedSlice(input, composedSettings())).toThrow(error);
	});

	it('normalizes duplicate separations and accepts a missing optional list', () => {
		const duplicate = solveComposedSlice(
			{
				...base,
				requiredSeparations: [
					{ firstRelationId: first.id, secondRelationId: second.id },
					{ firstRelationId: second.id, secondRelationId: first.id },
				],
			},
			composedSettings(),
		);
		expect(duplicate.input.requiredSeparations).toHaveLength(1);
		const withoutList: ComposedInput = {
			graph: base.graph,
			relations: base.relations,
			targetId: base.targetId,
			faceInset: base.faceInset,
			portSpacing: base.portSpacing,
			crossingPolicy: base.crossingPolicy,
		};
		expect(solveComposedSlice(withoutList, composedSettings()).selectedId).toBeDefined();
	});

	it.each([
		composedSettings({ budget: -1 }),
		composedSettings({ budget: 1.5 }),
		composedSettings({ laneGap: 0 }),
		composedSettings({ rankGap: 0 }),
		composedSettings({ railSpacing: Number.NaN }),
		composedSettings({ clearance: -1 }),
	])('rejects invalid search or metric settings', (settings) => {
		expect(() => solveComposedSlice(base, settings)).toThrow();
	});
});

describe('materialized composed geometry boundary', () => {
	const input = composedFixture('free');
	const geometry = choice(input);
	const first = geometry.paths[0];
	const second = geometry.paths[1];
	if (first === undefined || second === undefined) throw new Error('Missing fixture routes.');
	const target = geometry.boxes.find(({ id }) => id === 'target');
	if (target === undefined) throw new Error('Missing fixture target.');
	const settings = composedSettings();
	const lastPoint = first.points.at(-1);
	const firstPoint = first.points[0];
	if (lastPoint === undefined || firstPoint === undefined)
		throw new Error('Missing route endpoint.');
	const cases: readonly { name: string; geometry: ComposedGeometry; reason: RegExp }[] = [
		{
			name: 'box beyond its lane',
			geometry: replaceFirstBox(geometry, (box) => ({ ...box, bounds: { ...box.bounds, x: -1 } })),
			reason: /déborde de sa lane/,
		},
		{
			name: 'target absent',
			geometry: { ...geometry, boxes: geometry.boxes.filter(({ id }) => id !== 'target') },
			reason: /cible est absente/,
		},
		{
			name: 'missing route',
			geometry: { ...geometry, paths: geometry.paths.slice(1) },
			reason: /nombre de routes/,
		},
		{
			name: 'wrong target face',
			geometry: { ...geometry, targetFace: 'top' },
			reason: /face cible/,
		},
		{
			name: 'duplicate route',
			geometry: {
				...geometry,
				paths: [first, { ...second, relationId: first.relationId }, ...geometry.paths.slice(2)],
			},
			reason: /dupliquée/,
		},
		{
			name: 'unknown route',
			geometry: replaceFirstPath(geometry, (path) => ({ ...path, relationId: 'absent' })),
			reason: /inconnue/,
		},
		{
			name: 'missing source',
			geometry: { ...geometry, boxes: geometry.boxes.filter(({ id }) => id !== 'a') },
			reason: /source a est absente/,
		},
		{
			name: 'empty route',
			geometry: replaceFirstPath(geometry, (path) => ({ ...path, points: [] })),
			reason: /route a-target est vide/,
		},
		{
			name: 'wrong source attachment',
			geometry: replaceFirstPath(geometry, (path) => ({
				...path,
				points: [{ ...firstPoint, x: firstPoint.x + 1 }, ...path.points.slice(1)],
			})),
			reason: /mauvaise face source/,
		},
		{
			name: 'target port off its face',
			geometry: replaceFirstPath(geometry, (path) => {
				const moved = { ...lastPoint, x: lastPoint.x + 1 };
				return { ...path, targetPort: moved, points: [...path.points.slice(0, -1), moved] };
			}),
			reason: /face entrante/,
		},
		{
			name: 'target port inside forbidden inset',
			geometry: replaceFirstPath(geometry, (path) => {
				const moved = { ...lastPoint, y: target.bounds.y + input.faceInset - 1 };
				return { ...path, targetPort: moved, points: [...path.points.slice(0, -1), moved] };
			}),
			reason: /viole l'inset/,
		},
		{
			name: 'diagonal route segment',
			geometry: replaceFirstPath(geometry, (path) => ({
				...path,
				points: [firstPoint, { x: firstPoint.x + 1, y: firstPoint.y + 1 }, ...path.points.slice(2)],
			})),
			reason: /segment oblique/,
		},
	];
	it.each(cases)('rejects $name', ({ geometry: invalid, reason }) => {
		expect(validateComposedGeometry(input, invalid, settings)).toMatch(reason);
	});

	it('rejects two distinct ports closer than their spacing', () => {
		const moved = { ...second.targetPort, y: first.targetPort.y + 10 };
		const terminalStart = second.points.at(-2);
		if (terminalStart === undefined) throw new Error('Missing terminal segment.');
		const altered: ComposedGeometry = {
			...geometry,
			paths: [
				first,
				{
					...second,
					targetPort: moved,
					points: [...second.points.slice(0, -2), { ...terminalStart, y: moved.y }, moved],
				},
				...geometry.paths.slice(2),
			],
		};
		expect(validateComposedGeometry(input, altered, settings)).toMatch(/trop proches/);
	});

	it('rejects two positions for one shared target port', () => {
		const sharingInput = { ...input, requiredSeparations: [] };
		const sharingGeometry = choice(sharingInput);
		const left = sharingGeometry.paths[0];
		const right = sharingGeometry.paths[1];
		const terminalStart = right?.points.at(-2);
		if (left === undefined || right === undefined || terminalStart === undefined)
			throw new Error('Missing shared terminal route.');
		expect(left.targetPortIndex).toBe(right.targetPortIndex);
		const shifted = { ...right.targetPort, y: right.targetPort.y + 1 };
		const altered: ComposedGeometry = {
			...sharingGeometry,
			paths: [
				left,
				{
					...right,
					targetPort: shifted,
					points: [...right.points.slice(0, -2), { ...terminalStart, y: shifted.y }, shifted],
				},
				...sharingGeometry.paths.slice(2),
			],
		};
		expect(validateComposedGeometry(sharingInput, altered, settings)).toMatch(/port partagé/);
	});

	it('rejects a route through a new middle-lane obstacle', () => {
		const lane = geometry.lanes.find(({ id }) => id === 'SD');
		const track = first.points[2];
		if (lane === undefined || track === undefined) throw new Error('Missing middle-lane route.');
		const obstacle = {
			id: 'obstacle',
			laneId: 'SD',
			kind: 'node' as const,
			bounds: { x: lane.bounds.x + 70, y: track.y - 5, width: 10, height: 10 },
		};
		expect(
			validateComposedGeometry(
				input,
				{ ...geometry, boxes: [...geometry.boxes, obstacle] },
				settings,
			),
		).toMatch(/touche la boîte obstacle/);
	});

	it('rejects a route through an indivisible middle-lane group', () => {
		const lane = geometry.lanes.find(({ id }) => id === 'SD');
		const track = first.points[2];
		if (lane === undefined || track === undefined) throw new Error('Missing middle-lane route.');
		const group = {
			id: 'new-group',
			laneId: 'SD',
			kind: 'group' as const,
			bounds: { x: lane.bounds.x + 70, y: track.y - 5, width: 10, height: 10 },
		};
		expect(
			validateComposedGeometry(input, { ...geometry, boxes: [...geometry.boxes, group] }, settings),
		).toMatch(/touche le groupe new-group/);
	});
});
