import { describe, expect, it } from 'vitest';

import {
	symbolicBlockingGroupFixture,
	symbolicFreeGapFixture,
	symbolicSettings,
} from '../../../../src/app/workshop/solver-prototype/symbolic-lane-fixtures';
import {
	buildLayeringIR,
	buildLayoutContract,
	type CandidateGeometry,
	type CandidateTrace,
	type LaneOrientation,
	type PassageLayoutGraph,
	solveSymbolicLaneSlice,
} from '../../../../src/app/workshop/solver-prototype/symbolic-lane-slice';

function selected(candidates: readonly CandidateTrace[]): CandidateTrace {
	const choice = candidates.find(({ status }) => status === 'selected');
	if (choice === undefined) throw new Error('Missing selected candidate');
	return choice;
}

/** An independent observable oracle, expressed on the final rectangles and line segments. */
function expectClearGeometry(
	graph: PassageLayoutGraph,
	geometry: CandidateGeometry,
	clearance: number,
): void {
	const boxes = new Map(geometry.boxes.map((box) => [box.id, box]));
	for (const box of geometry.boxes) {
		const lane = geometry.lanes.find(({ id }) => id === box.laneId);
		expect(lane).toBeDefined();
		if (lane === undefined) continue;
		expect(box.bounds.x).toBeGreaterThanOrEqual(lane.bounds.x);
		expect(box.bounds.y).toBeGreaterThanOrEqual(lane.bounds.y);
		expect(box.bounds.x + box.bounds.width).toBeLessThanOrEqual(lane.bounds.x + lane.bounds.width);
		expect(box.bounds.y + box.bounds.height).toBeLessThanOrEqual(
			lane.bounds.y + lane.bounds.height,
		);
	}
	const source = boxes.get(graph.relation.from);
	const target = boxes.get(graph.relation.to);
	expect(source).toBeDefined();
	expect(target).toBeDefined();
	if (source === undefined || target === undefined) return;
	const first = geometry.path[0];
	const last = geometry.path.at(-1);
	expect(first).toBeDefined();
	expect(last).toBeDefined();
	if (first === undefined || last === undefined) return;
	expect(
		first.x === source.bounds.x ||
			first.x === source.bounds.x + source.bounds.width ||
			first.y === source.bounds.y ||
			first.y === source.bounds.y + source.bounds.height,
	).toBe(true);
	expect(
		last.x === target.bounds.x ||
			last.x === target.bounds.x + target.bounds.width ||
			last.y === target.bounds.y ||
			last.y === target.bounds.y + target.bounds.height,
	).toBe(true);
	for (let index = 1; index < geometry.path.length; index += 1) {
		const from = geometry.path[index - 1];
		const to = geometry.path[index];
		expect(from).toBeDefined();
		expect(to).toBeDefined();
		if (from === undefined || to === undefined) continue;
		expect(Number.isFinite(from.x) && Number.isFinite(from.y)).toBe(true);
		expect((from.x === to.x) !== (from.y === to.y)).toBe(true);
		const minX = Math.min(from.x, to.x);
		const maxX = Math.max(from.x, to.x);
		const minY = Math.min(from.y, to.y);
		const maxY = Math.max(from.y, to.y);
		for (const box of geometry.boxes) {
			if (index === 1 && box.id === graph.relation.from) continue;
			if (index === geometry.path.length - 1 && box.id === graph.relation.to) continue;
			const separated =
				maxX <= box.bounds.x - clearance ||
				minX >= box.bounds.x + box.bounds.width + clearance ||
				maxY <= box.bounds.y - clearance ||
				minY >= box.bounds.y + box.bounds.height + clearance;
			expect(separated, `${box.id} touched by segment ${index}`).toBe(true);
		}
	}
}

describe.each<LaneOrientation>(['vertical', 'horizontal'])('%s symbolic lanes', (orientation) => {
	it('uses an existing symbolic rank slot when the middle lane has room', () => {
		const result = solveSymbolicLaneSlice(symbolicFreeGapFixture(orientation), symbolicSettings());
		expect(result.outcome).toBe('selected');
		expect(selected(result.candidates).kind).toBe('existing-slot');
		expect(result.contract.alternatives.map(({ kind }) => kind)).toEqual([
			'existing-slot',
			'insert-rank',
			'exterior',
		]);
		expect(selected(result.candidates).geometry?.path).toHaveLength(6);
		const insertion = result.contract.alternatives.find(({ kind }) => kind === 'insert-rank');
		expect(insertion?.demands).toContainEqual({ kind: 'min-empty-rank-size', minimum: 48 });
	});

	it('rejects cuts through a spanning group and routes around its exterior', () => {
		const result = solveSymbolicLaneSlice(
			symbolicBlockingGroupFixture(orientation),
			symbolicSettings(),
		);
		expect(result.outcome).toBe('selected');
		expect(selected(result.candidates).kind).toBe('exterior');
		expect(result.candidates.filter(({ status }) => status === 'rejected')).toHaveLength(4);
		expect(
			result.candidates
				.slice(0, 4)
				.every(({ reason }) => reason?.includes('groupe sd-work') === true),
		).toBe(true);
		expect(result.layering.rankAlternatives[1]?.cutsGroups).toEqual(['sd-work']);
	});

	it('grows the lane and rank gaps when clearance is 80', () => {
		const result = solveSymbolicLaneSlice(
			symbolicFreeGapFixture(orientation),
			symbolicSettings({ clearance: 80 }),
		);
		const choice = selected(result.candidates);
		expect(choice.kind).toBe('existing-slot');
		expect(choice.geometry?.allocatedLaneGap).toBe(184);
		expect(choice.geometry?.allocatedRankGap).toBe(184);
		expect(choice.demands).toContainEqual({ kind: 'min-lane-gap', minimum: 184 });
		expect(choice.demands).toContainEqual({ kind: 'min-rank-gap', minimum: 184 });
	});

	it('reverses the route while preserving the same symbolic passage', () => {
		const graph = symbolicFreeGapFixture(orientation);
		const forward = solveSymbolicLaneSlice(graph, symbolicSettings());
		const reverse = solveSymbolicLaneSlice(
			{
				...graph,
				relation: { ...graph.relation, from: graph.relation.to, to: graph.relation.from },
			},
			symbolicSettings(),
		);
		expect(selected(reverse.candidates).kind).toBe('existing-slot');
		expect(selected(reverse.candidates).geometry?.path).toEqual(
			selected(forward.candidates).geometry?.path.toReversed(),
		);
	});

	it('passes an independent clearance and confinement oracle', () => {
		for (const graph of [
			symbolicFreeGapFixture(orientation),
			symbolicBlockingGroupFixture(orientation),
		]) {
			for (const clearance of [12, 80]) {
				const result = solveSymbolicLaneSlice(graph, symbolicSettings({ clearance }));
				const geometry = selected(result.candidates).geometry;
				expect(geometry).toBeDefined();
				if (geometry !== undefined) expectClearGeometry(graph, geometry, clearance);
			}
		}
	});
});

it('keeps every symbolic input and contract serializable without positions', () => {
	const graph = symbolicBlockingGroupFixture();
	const layering = buildLayeringIR(graph);
	const contract = buildLayoutContract(graph, layering, symbolicSettings());
	const json = JSON.stringify({ graph, layering, contract });
	expect(JSON.parse(json)).toEqual({ graph, layering, contract });
	expect(json).not.toMatch(/"(crossStart|longStart|extent|bounds|path|x|y)"/);
	expect(layering.rankAlternatives[1]?.spans.find(({ id }) => id === 'request')?.span).toEqual({
		first: 2,
		last: 2,
	});
});

it('is invariant to element collection order', () => {
	for (const graph of [symbolicFreeGapFixture(), symbolicBlockingGroupFixture()]) {
		const original = solveSymbolicLaneSlice(graph, symbolicSettings());
		const permuted = solveSymbolicLaneSlice(
			{ ...graph, elements: graph.elements.toReversed() },
			symbolicSettings(),
		);
		expect(permuted.layering).toEqual(original.layering);
		expect(permuted.contract).toEqual(original.contract);
		expect(permuted.candidates).toEqual(original.candidates);
		expect(permuted.selectedId).toBe(original.selectedId);
		expect(permuted).toEqual(original);
	}
});

it('reports an unresolved order collision instead of drawing overlapping peers', () => {
	const graph = symbolicFreeGapFixture();
	const result = solveSymbolicLaneSlice(
		{
			...graph,
			elements: [
				...graph.elements,
				{
					id: 'duplicate-rank',
					kind: 'node',
					laneId: 'S',
					preferredSpan: { first: 1, last: 1 },
					intrinsicSize: { cross: 112, longitudinal: 36 },
				},
			],
		},
		symbolicSettings(),
	);
	expect(result.outcome).toBe('infeasible');
	expect(
		result.candidates.every(({ reason }) => reason?.includes("l'ordre n'est pas résolu") === true),
	).toBe(true);
});

it('keeps two elements in one lane when their rank envelopes are disjoint', () => {
	const graph = symbolicFreeGapFixture();
	const result = solveSymbolicLaneSlice(
		{
			...graph,
			elements: [
				...graph.elements,
				{
					id: 'earlier-task',
					kind: 'node',
					laneId: 'S',
					preferredSpan: { first: 0, last: 0 },
					intrinsicSize: { cross: 80, longitudinal: 24 },
				},
			],
		},
		symbolicSettings(),
	);
	expect(result.outcome).toBe('selected');
	expect(selected(result.candidates).kind).toBe('existing-slot');
});

it('distinguishes a branch budget from an infeasible metric ceiling', () => {
	const graph = symbolicBlockingGroupFixture();
	const limited = solveSymbolicLaneSlice(graph, symbolicSettings({ budget: 1 }));
	expect(limited.outcome).toBe('budget-exhausted');
	expect(limited.selectedId).toBeUndefined();
	expect(limited.candidates.map(({ status }) => status)).toEqual([
		'rejected',
		'not-explored',
		'not-explored',
		'not-explored',
		'not-explored',
	]);
	const infeasible = solveSymbolicLaneSlice(
		graph,
		symbolicSettings({ clearance: 80, maximumLaneGap: 100 }),
	);
	expect(infeasible.outcome).toBe('infeasible');
	expect(infeasible.truncated).toBe(false);
	expect(infeasible.candidates.every(({ status }) => status === 'rejected')).toBe(true);
});

it('labels a selected incumbent as incomplete when later branches were not explored', () => {
	const result = solveSymbolicLaneSlice(symbolicFreeGapFixture(), symbolicSettings({ budget: 1 }));
	expect(result.selectedId).toBe('existing-slot-0');
	expect(result.candidates[0]?.status).toBe('selected');
	expect(result.outcome).toBe('budget-exhausted');
	expect(result.truncated).toBe(true);
});

it('rejects malformed lane graphs at the symbolic boundary', () => {
	const graph = symbolicFreeGapFixture();
	const first = graph.elements[0];
	if (first === undefined) throw new Error('Missing fixture element');
	const cases: readonly [PassageLayoutGraph, RegExp][] = [
		[{ ...graph, lanes: graph.lanes.slice(0, 2) }, /exactly three lanes/],
		[
			{
				...graph,
				lanes: graph.lanes.map((lane, index) => {
					if (index === 1) return { ...lane, id: 'S' };
					return lane;
				}),
			},
			/Duplicate lane/,
		],
		[{ ...graph, elements: [...graph.elements, first] }, /Duplicate lane or element/],
		[{ ...graph, relation: { ...graph.relation, from: 'unknown' } }, /Unknown relation endpoint/],
		[{ ...graph, relation: { ...graph.relation, to: 'unknown' } }, /Unknown relation endpoint/],
		[
			{
				...graph,
				elements: graph.elements.map((element) => {
					if (element.id === 'sd-work') return { ...element, laneId: 'missing' };
					return element;
				}),
			},
			/Unknown lane missing/,
		],
		[
			{
				...graph,
				elements: [{ ...first, preferredSpan: { first: -1, last: 1 } }, ...graph.elements.slice(1)],
			},
			/Invalid preferred span/,
		],
		[
			{
				...graph,
				elements: [
					{ ...first, preferredSpan: { first: 0.5, last: 1 } },
					...graph.elements.slice(1),
				],
			},
			/Invalid preferred span/,
		],
		[
			{
				...graph,
				elements: [{ ...first, preferredSpan: { first: 2, last: 1 } }, ...graph.elements.slice(1)],
			},
			/Invalid preferred span/,
		],
		[
			{
				...graph,
				elements: [
					{ ...first, intrinsicSize: { cross: 0, longitudinal: 36 } },
					...graph.elements.slice(1),
				],
			},
			/Invalid intrinsic size/,
		],
		[
			{
				...graph,
				elements: [
					{ ...first, intrinsicSize: { cross: 112, longitudinal: 0 } },
					...graph.elements.slice(1),
				],
			},
			/Invalid intrinsic size/,
		],
		[
			{
				...graph,
				lanes: graph.lanes.map((lane, index) => {
					if (index === 1) return { ...lane, minimumCrossSize: 0 };
					return lane;
				}),
			},
			/Invalid lane minimum/,
		],
		[{ ...graph, relation: { ...graph.relation, to: 'request' } }, /outer lanes/],
		[{ ...graph, relation: { ...graph.relation, to: 'sd-work' } }, /outer lanes/],
	];
	for (const [invalid, message] of cases) expect(() => buildLayeringIR(invalid)).toThrow(message);
});

it('rejects malformed metric settings and distinguishes zero budget', () => {
	const graph = symbolicFreeGapFixture();
	for (const settings of [
		symbolicSettings({ budget: -1 }),
		symbolicSettings({ budget: 0.5 }),
		symbolicSettings({ laneGap: 0 }),
		symbolicSettings({ rankGap: 0 }),
		symbolicSettings({ railSpacing: 0 }),
		symbolicSettings({ clearance: -1 }),
	])
		expect(() => solveSymbolicLaneSlice(graph, settings)).toThrow();
	const zero = solveSymbolicLaneSlice(graph, symbolicSettings({ budget: 0 }));
	expect(zero.outcome).toBe('budget-exhausted');
	expect(zero.explored).toBe(0);
	expect(zero.candidates.every(({ status }) => status === 'not-explored')).toBe(true);
});

it('rejects non-finite graph measurements before generating ranks', () => {
	const graph = symbolicFreeGapFixture();
	const first = graph.elements[0];
	if (first === undefined) throw new Error('Missing fixture element');
	for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
		for (const dimension of ['cross', 'longitudinal'] as const) {
			const malformed: PassageLayoutGraph = {
				...graph,
				elements: [
					{ ...first, intrinsicSize: { ...first.intrinsicSize, [dimension]: invalid } },
					...graph.elements.slice(1),
				],
			};
			expect(() => buildLayeringIR(malformed)).toThrow(/Invalid intrinsic size/);
		}
		const malformed: PassageLayoutGraph = {
			...graph,
			lanes: graph.lanes.map((lane, index) => {
				if (index === 1) return { ...lane, minimumCrossSize: invalid };
				return lane;
			}),
		};
		expect(() => buildLayeringIR(malformed)).toThrow(/Invalid lane minimum/);
	}
});

it('rejects non-finite settings before generating the layout contract', () => {
	const graph = symbolicFreeGapFixture();
	const layering = buildLayeringIR(graph);
	for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
		for (const key of [
			'laneGap',
			'rankGap',
			'railSpacing',
			'clearance',
			'maximumLaneGap',
		] as const) {
			const settings = symbolicSettings({ [key]: invalid });
			expect(() => buildLayoutContract(graph, layering, settings)).toThrow(
				/Invalid metric settings/,
			);
			expect(() => solveSymbolicLaneSlice(graph, settings)).toThrow(/Invalid metric settings/);
		}
		const settings = symbolicSettings({ budget: invalid });
		expect(() => buildLayoutContract(graph, layering, settings)).toThrow(/Budget/);
		expect(() => solveSymbolicLaneSlice(graph, settings)).toThrow(/Budget/);
	}
	const malformedGraph: PassageLayoutGraph = { ...graph, lanes: [] };
	expect(() =>
		solveSymbolicLaneSlice(malformedGraph, symbolicSettings({ laneGap: Number.NaN })),
	).toThrow(/Invalid metric settings/);
});

it('rejects malformed rank alternatives before choosing a passage', () => {
	const graph = symbolicFreeGapFixture();
	const settings = symbolicSettings();
	const layering = buildLayeringIR(graph);
	expect(() => buildLayoutContract(graph, { ...layering, rankAlternatives: [] }, settings)).toThrow(
		/Missing preferred rank alternative/,
	);
	expect(() =>
		buildLayoutContract(
			graph,
			{ ...layering, rankAlternatives: layering.rankAlternatives.slice(0, 1) },
			settings,
		),
	).toThrow(/Missing rank alternative/);
	const preferred = layering.rankAlternatives[0];
	if (preferred === undefined) throw new Error('Missing fixture rank alternative');
	expect(() =>
		buildLayoutContract(
			graph,
			{
				...layering,
				rankAlternatives: [
					{ ...preferred, spans: preferred.spans.filter(({ id }) => id !== 'sd-work') },
					...layering.rankAlternatives.slice(1),
				],
			},
			settings,
		),
	).toThrow(/Missing rank span for sd-work/);
});

it('keeps an external passage for a single visual rank and expands a narrow lane', () => {
	const graph = symbolicFreeGapFixture();
	const oneRank: PassageLayoutGraph = {
		...graph,
		elements: graph.elements.map((element) => {
			let intrinsicSize = { cross: 220, longitudinal: element.intrinsicSize.longitudinal };
			if (element.id === 'sd-work') intrinsicSize = element.intrinsicSize;
			return { ...element, preferredSpan: { first: 0, last: 0 }, intrinsicSize };
		}),
	};
	const result = solveSymbolicLaneSlice(oneRank, symbolicSettings());
	expect(result.contract.alternatives.map(({ kind }) => kind)).toEqual(['exterior']);
	expect(result.outcome).toBe('selected');
	expect(selected(result.candidates).geometry?.lanes[0]?.bounds.width).toBe(220);
});

it('rejects a route through a multi-rank middle node while retaining an exterior alternative', () => {
	const graph = symbolicFreeGapFixture();
	const blocked: PassageLayoutGraph = {
		...graph,
		elements: graph.elements.map((element) => {
			if (element.id !== 'sd-work') return element;
			return {
				...element,
				kind: 'node',
				preferredSpan: { first: 0, last: 1 },
				intrinsicSize: { cross: 160, longitudinal: 120 },
			};
		}),
	};
	const result = solveSymbolicLaneSlice(blocked, symbolicSettings());
	expect(result.candidates[0]?.status).toBe('rejected');
	expect(result.candidates[0]?.reason).toMatch(/la boîte sd-work/);
	expect(selected(result.candidates).kind).toBe('exterior');
});

it('scores a straight route with zero bends despite duplicate intermediate points', () => {
	const graph = symbolicFreeGapFixture();
	const aligned: PassageLayoutGraph = {
		...graph,
		elements: graph.elements.map((element) => {
			if (element.id === 'sd-work')
				return { ...element, intrinsicSize: { ...element.intrinsicSize, longitudinal: 24 } };
			return { ...element, preferredSpan: { first: 0, last: 1 } };
		}),
	};
	const result = solveSymbolicLaneSlice(aligned, symbolicSettings());
	const choice = selected(result.candidates);
	expect(choice.kind).toBe('existing-slot');
	expect(choice.score?.[1]).toBe(0);
});

it('uses the canonical ID to break equal scores for symmetric rank slots', () => {
	const graph = symbolicFreeGapFixture();
	const symmetric: PassageLayoutGraph = {
		...graph,
		elements: graph.elements.map((element) => {
			if (element.id === 'sd-work')
				return {
					...element,
					kind: 'node',
					preferredSpan: { first: 2, last: 2 },
					intrinsicSize: { cross: 136, longitudinal: 24 },
				};
			return element;
		}),
	};
	const result = solveSymbolicLaneSlice(symmetric, symbolicSettings());
	const first = result.candidates.find(({ id }) => id === 'existing-slot-0');
	const second = result.candidates.find(({ id }) => id === 'existing-slot-1');
	expect(first?.score).toEqual(second?.score);
	expect(result.selectedId).toBe('existing-slot-0');
});

it('accepts a metric ceiling when the required lane gap fits beneath it', () => {
	const result = solveSymbolicLaneSlice(
		symbolicFreeGapFixture(),
		symbolicSettings({ clearance: 80, maximumLaneGap: 200 }),
	);
	expect(result.outcome).toBe('selected');
	expect(selected(result.candidates).geometry?.allocatedLaneGap).toBe(184);
});
