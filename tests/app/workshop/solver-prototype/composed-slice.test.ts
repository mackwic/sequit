import { describe, expect, it } from 'vitest';

import {
	composedFixture,
	composedSettings,
} from '../../../../src/app/workshop/solver-prototype/composed-fixtures';
import {
	type ComposedCandidate,
	type ComposedGeometry,
	type ComposedInput,
	solveComposedSlice,
	validateComposedGeometry,
} from '../../../../src/app/workshop/solver-prototype/composed-slice';

function selected(candidates: readonly ComposedCandidate[]): ComposedCandidate {
	const candidate = candidates.find(({ status }) => status === 'selected');
	if (candidate === undefined) throw new Error('Missing selected composed candidate.');
	return candidate;
}

function segmentTouchesBox(
	start: { x: number; y: number },
	end: { x: number; y: number },
	box: { x: number; y: number; width: number; height: number },
	clearance: number,
): boolean {
	const left = box.x - clearance;
	const right = box.x + box.width + clearance;
	const top = box.y - clearance;
	const bottom = box.y + box.height + clearance;
	if (start.x === end.x)
		return (
			start.x > left &&
			start.x < right &&
			Math.max(start.y, end.y) > top &&
			Math.min(start.y, end.y) < bottom
		);
	return (
		start.y > top &&
		start.y < bottom &&
		Math.max(start.x, end.x) > left &&
		Math.min(start.x, end.x) < right
	);
}

/** Checks only materialized rectangles, ports and paths, without reading the solver's scores. */
function expectObservableGeometry(
	input: ComposedInput,
	geometry: ComposedGeometry,
	clearance: number,
): void {
	expect(geometry.paths).toHaveLength(3);
	let expectedFace = 'top';
	if (input.graph.orientation === 'vertical') expectedFace = 'left';
	expect(geometry.targetFace).toBe(expectedFace);
	const target = geometry.boxes.find(({ id }) => id === input.targetId);
	expect(target).toBeDefined();
	if (target === undefined) return;
	const distinctPorts = new Set(geometry.paths.map(({ targetPortIndex }) => targetPortIndex));
	expect(distinctPorts.size).toBeGreaterThan(0);
	for (const path of geometry.paths) {
		const relation = input.relations.find(({ id }) => id === path.relationId);
		expect(relation).toBeDefined();
		if (relation === undefined) continue;
		expect(path.points.at(-1)).toEqual(path.targetPort);
		if (input.graph.orientation === 'vertical') {
			expect(path.targetPort.x).toBe(target.bounds.x);
			expect(path.targetPort.y).toBeGreaterThanOrEqual(target.bounds.y + input.faceInset);
			expect(path.targetPort.y).toBeLessThanOrEqual(
				target.bounds.y + target.bounds.height - input.faceInset,
			);
		} else {
			expect(path.targetPort.y).toBe(target.bounds.y);
			expect(path.targetPort.x).toBeGreaterThanOrEqual(target.bounds.x + input.faceInset);
			expect(path.targetPort.x).toBeLessThanOrEqual(
				target.bounds.x + target.bounds.width - input.faceInset,
			);
		}
		for (let index = 1; index < path.points.length; index += 1) {
			const start = path.points[index - 1];
			const end = path.points[index];
			expect(start).toBeDefined();
			expect(end).toBeDefined();
			if (start === undefined || end === undefined) continue;
			expect(start.x === end.x || start.y === end.y).toBe(true);
			for (const box of geometry.boxes) {
				if (box.id === relation.from && index === 1) continue;
				if (box.id === relation.to && index === path.points.length - 1) continue;
				expect(
					segmentTouchesBox(start, end, box.bounds, clearance),
					`${relation.id} touches ${box.id} on segment ${index}`,
				).toBe(false);
			}
		}
	}
}

describe.each(['vertical', 'horizontal'] as const)(
	'composed symbolic witness (%s)',
	(orientation) => {
		it.each(['free', 'blocking'] as const)(
			'selects clear geometry with a %s middle group',
			(kind) => {
				const input = composedFixture(kind, orientation);
				const solution = solveComposedSlice(input, composedSettings());
				expect(solution.outcome).toBe('selected');
				expect(solution.truncated).toBe(false);
				expect(solution.faceContract.alternatives).toHaveLength(5);
				expect(solution.candidates).toHaveLength(solution.passageContract.alternatives.length * 13);
				const choice = selected(solution.candidates);
				expect(choice.portGroups).toHaveLength(3);
				expect(choice.demands.targetFaceLongitudinalSize).toBe(144);
				expect(choice.geometry?.targetLongitudinalSize).toBe(144);
				expect(choice.geometry?.allocatedLaneGap).toBeGreaterThanOrEqual(72);
				expect(choice.geometry?.allocatedRankGap).toBeGreaterThanOrEqual(72);
				if (kind === 'free') expect(choice.passageKind).toBe('existing-slot');
				if (kind === 'blocking') expect(choice.passageKind).toBe('exterior');
				if (choice.geometry !== undefined) {
					for (const sourceId of ['a', 'b', 'c']) {
						const source = choice.geometry.boxes.find(({ id }) => id === sourceId);
						expect(source).toBeDefined();
						if (source === undefined) continue;
						if (orientation === 'vertical') expect(source.bounds.height).toBe(36);
						if (orientation === 'horizontal') expect(source.bounds.width).toBe(36);
					}
					expect(
						new Set(choice.geometry.paths.map(({ targetPortIndex }) => targetPortIndex)).size,
					).toBe(3);
					expectObservableGeometry(input, choice.geometry, 12);
				}
			},
		);

		it('grows route clearance and the target independently', () => {
			const input = composedFixture('free', orientation);
			const solution = solveComposedSlice(input, composedSettings({ clearance: 80 }));
			const choice = selected(solution.candidates);
			expect(choice.demands.targetFaceLongitudinalSize).toBe(144);
			expect(choice.geometry?.allocatedLaneGap).toBe(208);
			expect(choice.geometry?.allocatedRankGap).toBe(208);
			if (choice.geometry !== undefined) expectObservableGeometry(input, choice.geometry, 80);
		});

		it('keeps the group indivisible even though a three-track rank gap can grow', () => {
			const solution = solveComposedSlice(
				composedFixture('blocking', orientation),
				composedSettings(),
			);
			const interior = solution.candidates.filter(({ passageKind }) => passageKind !== 'exterior');
			expect(interior.every(({ status }) => status === 'rejected')).toBe(true);
			expect(interior.some(({ reason }) => reason?.includes('groupe sd-work') === true)).toBe(true);
		});
	},
);

it('shows that the target demand depends on supplied sharing constraints', () => {
	const full = composedFixture('free');
	const unrestricted = solveComposedSlice({ ...full, requiredSeparations: [] }, composedSettings());
	const onePair = solveComposedSlice(
		{
			...full,
			requiredSeparations: [full.requiredSeparations?.[0]].filter((item) => item !== undefined),
		},
		composedSettings(),
	);
	const threePairs = solveComposedSlice(full, composedSettings());
	expect(selected(unrestricted.candidates).demands.targetFaceLongitudinalSize).toBe(80);
	expect(selected(onePair.candidates).demands.targetFaceLongitudinalSize).toBe(96);
	expect(selected(threePairs.candidates).demands.targetFaceLongitudinalSize).toBe(144);
	expect(
		unrestricted.candidates.some(
			({ rejectionPhase, reason }) =>
				rejectionPhase === 'geometry' &&
				reason?.includes('se croisent hors du tronc partagé') === true,
		),
	).toBe(true);
});

it('rejects a route that misses its materialized target port', () => {
	const input = composedFixture('free');
	const solution = solveComposedSlice(input, composedSettings());
	const geometry = selected(solution.candidates).geometry;
	if (geometry === undefined) throw new Error('Missing selected geometry.');
	const first = geometry.paths[0];
	if (first === undefined) throw new Error('Missing route.');
	const broken: ComposedGeometry = {
		...geometry,
		paths: [
			{ ...first, targetPort: { ...first.targetPort, y: first.targetPort.y + 1 } },
			...geometry.paths.slice(1),
		],
	};
	expect(validateComposedGeometry(input, broken, composedSettings())).toMatch(
		/manque son port cible/,
	);
});

it('normalizes element, relation and separation order', () => {
	const input = composedFixture('free');
	const original = solveComposedSlice(input, composedSettings());
	const permuted = solveComposedSlice(
		{
			...input,
			graph: { ...input.graph, elements: input.graph.elements.toReversed() },
			relations: input.relations.toReversed(),
			requiredSeparations: (input.requiredSeparations ?? []).toReversed().map((pair) => ({
				firstRelationId: pair.secondRelationId,
				secondRelationId: pair.firstRelationId,
			})),
		},
		composedSettings(),
	);
	expect(permuted).toEqual(original);
});

it('chooses physical port order b,c,a after source ranks change', () => {
	const input = composedFixture('free');
	const reordered: ComposedInput = {
		...input,
		graph: {
			...input.graph,
			elements: input.graph.elements.map((element) => {
				let rank = element.preferredSpan.first;
				if (element.id === 'a') rank = 2;
				if (element.id === 'b') rank = 0;
				if (element.id === 'c') rank = 1;
				if (!['a', 'b', 'c'].includes(element.id)) return element;
				return { ...element, preferredSpan: { first: rank, last: rank } };
			}),
		},
	};
	const solution = solveComposedSlice(reordered, composedSettings());
	expect(solution.outcome).toBe('selected');
	expect(selected(solution.candidates).portGroups).toEqual([
		['b-target'],
		['c-target'],
		['a-target'],
	]);
	expect(solution.candidates.some(({ portOrderIndex }) => portOrderIndex > 0)).toBe(true);
});

it('reports unresolved peer order instead of accepting overlapping source boxes', () => {
	const input = composedFixture('free');
	const collision: ComposedInput = {
		...input,
		graph: {
			...input.graph,
			elements: input.graph.elements.map((element) => {
				if (element.id !== 'b') return element;
				return { ...element, preferredSpan: { first: 0, last: 0 } };
			}),
		},
	};
	const solution = solveComposedSlice(collision, composedSettings());
	expect(solution.outcome).toBe('infeasible');
	expect(
		solution.candidates.some(({ reason }) => reason?.includes('se chevauchent') === true),
	).toBe(true);
});

it('does not mistake a budget-limited incumbent for an optimum', () => {
	const input = composedFixture('free');
	const solution = solveComposedSlice(input, composedSettings({ budget: 5 }));
	expect(solution.outcome).toBe('budget-exhausted');
	expect(solution.truncated).toBe(true);
	expect(solution.explored).toBe(5);
	expect(solution.candidates.slice(5).every(({ status }) => status === 'not-explored')).toBe(true);
	const incumbent = solveComposedSlice(input, composedSettings({ budget: 64 }));
	expect(incumbent.selectedId).toBeDefined();
	expect(incumbent.outcome).toBe('budget-exhausted');
	expect(
		incumbent.candidates.find(({ status }) => status === 'selected')?.geometry?.paths,
	).toHaveLength(3);
	const zero = solveComposedSlice(input, composedSettings({ budget: 0 }));
	expect(zero.selectedId).toBeUndefined();
	expect(zero.outcome).toBe('budget-exhausted');
});

it('keeps the combined contracts coordinate-free until a branch is materialized', () => {
	const solution = solveComposedSlice(composedFixture('free'), composedSettings({ budget: 0 }));
	const contract = JSON.stringify({
		input: solution.input,
		layering: solution.layering,
		passage: solution.passageContract,
		face: solution.faceContract,
	});
	expect(contract).not.toMatch(/"(bounds|path|x|y|crossStart|longStart|extent)"/);
	expect(solution.candidates.every(({ geometry }) => geometry === undefined)).toBe(true);
});

it('rejects a hard lane-gap ceiling instead of calling it budget exhaustion', () => {
	const solution = solveComposedSlice(
		composedFixture('free'),
		composedSettings({ maximumLaneGap: 50 }),
	);
	expect(solution.outcome).toBe('infeasible');
	expect(solution.truncated).toBe(false);
	expect(solution.candidates.every(({ status }) => status === 'rejected')).toBe(true);
});

it('scores flush face attachments with zero-length terminal segments', () => {
	const input = composedFixture('free');
	const flush: ComposedInput = {
		...input,
		graph: {
			...input.graph,
			lanes: input.graph.lanes.map((lane) => {
				if (lane.id === 'S') return { ...lane, minimumCrossSize: 96 };
				if (lane.id === 'C') return { ...lane, minimumCrossSize: 112 };
				return lane;
			}),
		},
	};
	const solution = solveComposedSlice(flush, composedSettings({ clearance: 0 }));
	const candidate = selected(solution.candidates);
	expect(
		candidate.geometry?.paths.some(({ points }) =>
			points.some(
				(point, index) =>
					index > 0 && point.x === points[index - 1]?.x && point.y === points[index - 1]?.y,
			),
		),
	).toBe(true);
	expect(candidate.score?.[1]).toBeGreaterThanOrEqual(0);
});
