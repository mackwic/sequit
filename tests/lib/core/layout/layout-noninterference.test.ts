import fc from 'fast-check';
import { expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../src/lib/core/layout/layout-engine';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { acyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import {
	boundsFor,
	layoutDocument,
	prepareLayoutDocument,
} from '../../../support/harnesses/layout';
import { referenceRuns } from './bridge-oracle-reference';
import { deepShellSample } from './group-shell-deep-fixture';

const biasByDirection: Record<LayoutDirection, LayoutBias> = {
	[LayoutDirection.TopToBottom]: LayoutBias.Top,
	[LayoutDirection.BottomToTop]: LayoutBias.Bottom,
	[LayoutDirection.LeftToRight]: LayoutBias.Left,
	[LayoutDirection.RightToLeft]: LayoutBias.Right,
};

const independentLoad = fc.record({
	direction: fc.constantFrom(...Object.values(LayoutDirection)),
	spokes: fc.integer({ min: 1, max: 5 }),
	shortcut: fc.boolean(),
	group: fc.boolean(),
	junction: fc.boolean(),
});

function relationSignature(
	layout: LayoutResult,
	direction: LayoutDirection,
	relationIds: readonly string[],
) {
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	const cross = (point: { x: number; y: number }) => {
		if (vertical) return point.x;
		return point.y;
	};
	const bounds = new Map(layout.elements.map(({ id, bounds }) => [id, bounds]));
	return layout.relations
		.filter(({ id }) => relationIds.includes(id))
		.map(({ id, from, to, points }) => {
			const source = bounds.get(from);
			const target = bounds.get(to);
			const first = points[0];
			const last = points.at(-1);
			if (!source || !target || !first || !last) throw new Error(`Missing route ${id}`);
			return {
				id,
				sourcePort: { x: first.x - source.x, y: first.y - source.y },
				targetPort: { x: last.x - target.x, y: last.y - target.y },
				transverse: points.map((point) => cross(point) - cross(source)),
				segments: points.slice(1).map((point, index) => {
					const previous = points[index];
					if (!previous) throw new Error('Missing route segment');
					const delta = cross(point) - cross(previous);
					let advance = point.x - previous.x;
					if (vertical) advance = point.y - previous.y;
					if (delta === 0) return `main:${Math.sign(advance)}`;
					return `cross:${Math.sign(delta)}`;
				}),
			};
		});
}

function localSignature(layout: LayoutResult, direction: LayoutDirection) {
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	const cross = (point: { x: number; y: number }) => {
		if (vertical) return point.x;
		return point.y;
	};
	const bounds = new Map(layout.elements.map(({ id, bounds }) => [id, bounds]));
	const source = bounds.get('a');
	if (!source) throw new Error('Missing independent fork');
	return {
		order: [...['b', 'c']].sort((left, right) => {
			const a = bounds.get(left);
			const b = bounds.get(right);
			if (!a || !b) throw new Error('Missing fork target');
			return cross(a) - cross(b);
		}),
		routes: relationSignature(layout, direction, ['a-b', 'a-c']),
	};
}

// Reduced counterexample: A = a→b,a→c; independent B = q0→q1,q0→t,q1→t,t→J.
it('preserves ports, attachments, order and relative routes of A beside independent B', async () => {
	const failures: string[] = [];
	const scenarios = [
		{
			direction: LayoutDirection.TopToBottom,
			spokes: 2,
			shortcut: false,
			group: false,
			junction: true,
		},
		...fc.sample(independentLoad, { seed: 1_592_915_777, numRuns: 30 }),
	];
	for (const [index, { direction, spokes, shortcut, group, junction }] of scenarios.entries()) {
		const seed = validLogicDocument();
		const a: LogicDocument = {
			...seed,
			layout: defined(layoutConfiguration(direction, biasByDirection[direction])),
			groups: [],
			nodes: ['a', 'b', 'c'].map((id, index) => ({
				kind: EndpointKind.Node,
				id,
				layoutOrder: orderKey(`a${index + 1}`),
				natureId: 'goal',
				markdown: id,
			})),
			junctions: [],
			relations: [
				{ id: 'a-b', from: 'a', to: 'b' },
				{ id: 'a-c', from: 'a', to: 'c' },
			],
		};
		const bIds = Array.from({ length: spokes }, (_, index) => `q${index}`);
		const groups: LogicDocument['groups'][number][] = [];
		if (group)
			groups.push({ kind: EndpointKind.Group, id: 'G', layoutOrder: orderKey('a0'), label: 'G' });
		const junctions: LogicDocument['junctions'][number][] = [];
		if (junction)
			junctions.push({
				kind: EndpointKind.Junction,
				id: 'J',
				layoutOrder: orderKey('aB'),
				operator: JunctionOperator.Xor,
			});
		const relations: LogicDocument['relations'][number][] = [...a.relations];
		const root = bIds[0];
		if (root === undefined) throw new Error('Missing B root');
		for (const id of bIds) {
			if (group) relations.push({ id: `G-${id}`, from: 'G', to: id });
			else if (id !== root) relations.push({ id: `q-${id}`, from: root, to: id });
			relations.push({ id: `${id}-t`, from: id, to: 't' });
		}
		if (shortcut) {
			let from = root;
			if (group) from = 'G';
			relations.push({ id: 'q-t', from, to: 't' });
		}
		if (junction) relations.push({ id: 't-J', from: 't', to: 'J' });
		const combined: LogicDocument = {
			...a,
			groups,
			nodes: [
				...a.nodes,
				...bIds.map((id, index) => ({
					kind: EndpointKind.Node as const,
					id,
					layoutOrder: orderKey(`a${index + 4}`),
					natureId: 'goal',
					markdown: id,
				})),
				{
					kind: EndpointKind.Node,
					id: 't',
					layoutOrder: orderKey('aA'),
					natureId: 'goal',
					markdown: 't',
				},
			],
			junctions,
			relations,
		};
		const first = prepareLayoutDocument(a);
		const second = prepareLayoutDocument(combined);
		for (const id of ['a', 'b', 'c'])
			expect(second.ranks.byEndpointId.get(id)).toBe(first.ranks.byEndpointId.get(id));
		const solo = await layoutGraph(first.graph, first.ranks, first.measurements);
		const alongside = await layoutGraph(second.graph, second.ranks, second.measurements);
		const soloValidation = validateDedicatedCandidate({ ...first, layout: solo });
		const combinedValidation = validateDedicatedCandidate({ ...second, layout: alongside });
		expect(soloValidation, JSON.stringify(soloValidation)).toMatchObject({ valid: true });
		expect(combinedValidation, JSON.stringify(combinedValidation)).toMatchObject({ valid: true });
		if (
			JSON.stringify(localSignature(alongside, direction)) !==
			JSON.stringify(localSignature(solo, direction))
		)
			failures.push(
				`${index}: ${JSON.stringify({ direction, spokes, shortcut, group, junction })}`,
			);
	}
	expect(failures).toEqual([]);
}, 120_000);

it('keeps ordinary component rails clear of an independent long-edge component', async () => {
	const combined = fc.sample(
		acyclicLogicDocumentArbitrary({ minNodes: 3, maxNodes: 12, minEdges: 2, maxEdges: 16 }),
		{
			seed: 1_592_915_777,
			path: '9:3:0:0:0:0:0:0:0:0:11:30:6:15:24:27:24:20:21',
			numRuns: 1,
		},
	)[0];
	if (!combined) throw new Error('Missing seeded route-contact witness');
	const ordinaryIds = new Set(['node-00', 'node-02', 'node-08']);
	const ordinary: LogicDocument = {
		...combined,
		nodes: combined.nodes.filter(({ id }) => ordinaryIds.has(id)),
		relations: combined.relations.filter(
			({ from, to }) => ordinaryIds.has(from) && ordinaryIds.has(to),
		),
	};
	const aRelationIds = ordinary.relations.map(({ id }) => id);
	expect(aRelationIds).toEqual(['relation-000', 'relation-002']);
	expect(combined.junctions).toHaveLength(0);
	expect(
		combined.relations.every(({ from, to }) => ordinaryIds.has(from) === ordinaryIds.has(to)),
	).toBe(true);
	const alone = prepareLayoutDocument(ordinary);
	const together = prepareLayoutDocument(combined);
	const bIds = new Set(combined.nodes.map(({ id }) => id).filter((id) => !ordinaryIds.has(id)));
	expect(
		combined.relations.some(
			({ from, to }) =>
				bIds.has(from) &&
				bIds.has(to) &&
				defined(together.ranks.byEndpointId.get(from)) >
					defined(together.ranks.byEndpointId.get(to)) + 1,
		),
	).toBe(true);
	for (const id of ordinaryIds)
		expect(together.ranks.byEndpointId.get(id)).toBe(alone.ranks.byEndpointId.get(id));
	const soloLayout = await layoutGraph(alone.graph, alone.ranks, alone.measurements);
	const combinedLayout = await layoutGraph(together.graph, together.ranks, together.measurements);
	const soloValidation = validateDedicatedCandidate({ ...alone, layout: soloLayout });
	const combinedValidation = validateDedicatedCandidate({ ...together, layout: combinedLayout });
	expect(soloValidation, JSON.stringify(soloValidation)).toMatchObject({ valid: true });
	expect(combinedValidation, JSON.stringify(combinedValidation)).toMatchObject({ valid: true });
	expect(relationSignature(combinedLayout, combined.layout.direction, aRelationIds)).toEqual(
		relationSignature(soloLayout, ordinary.layout.direction, aRelationIds),
	);
});

interface IndependentComponent {
	readonly nodes: readonly string[];
	readonly junctions: readonly string[];
	readonly relations: readonly {
		readonly id: string;
		readonly from: string;
		readonly to: string;
	}[];
}

function componentDocument(
	direction: LayoutDirection,
	components: readonly IndependentComponent[],
	documentaryOrder: readonly string[],
): LogicDocument {
	const included = new Set(components.flatMap(({ nodes, junctions }) => [...nodes, ...junctions]));
	const order = new Map(
		documentaryOrder
			.filter((id) => included.has(id))
			.map((id, index) => [id, orderKey(`a${index.toString().padStart(2, '0')}1`)]),
	);
	return {
		...validLogicDocument(),
		layout: defined(layoutConfiguration(direction, biasByDirection[direction])),
		groups: [],
		nodes: components.flatMap(({ nodes }) =>
			nodes.map((id) => ({
				kind: EndpointKind.Node as const,
				id,
				layoutOrder: defined(order.get(id)),
				natureId: 'goal',
				markdown: id,
			})),
		),
		junctions: components.flatMap(({ junctions }) =>
			junctions.map((id) => ({
				kind: EndpointKind.Junction as const,
				id,
				layoutOrder: defined(order.get(id)),
				operator: JunctionOperator.Xor,
			})),
		),
		relations: components.flatMap(({ relations }) => relations),
	};
}

/** True when a route of `subject` runs strictly inside the transverse band of `other`'s boxes. */
function entersEnvelope(
	layout: LayoutResult,
	direction: LayoutDirection,
	subject: IndependentComponent,
	other: IndependentComponent,
): boolean {
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	const bounds = new Map(layout.elements.map(({ id, bounds: box }) => [id, box]));
	const boxes = [...other.nodes, ...other.junctions].map((id) => defined(bounds.get(id)));
	let start = Math.min(...boxes.map(({ y }) => y));
	let end = Math.max(...boxes.map(({ y, height }) => y + height));
	if (vertical) {
		start = Math.min(...boxes.map(({ x }) => x));
		end = Math.max(...boxes.map(({ x, width }) => x + width));
	}
	const relationIds = new Set(subject.relations.map(({ id }) => id));
	return layout.relations
		.filter(({ id }) => relationIds.has(id))
		.some(({ points }) =>
			points.some((point) => {
				let transverse = point.y;
				if (vertical) transverse = point.x;
				return transverse > start && transverse < end;
			}),
		);
}

const junctionBesideFork = fc.record({
	targets: fc.integer({ min: 2, max: 4 }),
	shortcuts: fc.array(fc.tuple(fc.nat(3), fc.nat(3)), { maxLength: 3 }),
	spokes: fc.integer({ min: 1, max: 4 }),
	chain: fc.boolean(),
	interleave: fc.array(fc.nat(), { minLength: 10, maxLength: 10 }),
});

type JunctionBesideFork = typeof junctionBesideFork extends fc.Arbitrary<infer T> ? T : never;

// A junction J feeds targets; shortcuts between targets make J skip a row, the D-01 shape.
function junctionAndFork(
	value: JunctionBesideFork,
): readonly [IndependentComponent, IndependentComponent, readonly string[]] {
	const targets = Array.from({ length: value.targets }, (_, index) => `t${index}`);
	const relations = targets.map((id) => ({ id: `J-${id}`, from: 'J', to: id }));
	for (const [first, second] of value.shortcuts) {
		const from = Math.max(first, second) % value.targets;
		const to = Math.min(first, second) % value.targets;
		if (from <= to || relations.some(({ id }) => id === `t${from}-t${to}`)) continue;
		relations.push({ id: `t${from}-t${to}`, from: `t${from}`, to: `t${to}` });
	}
	const spokes = Array.from({ length: value.spokes }, (_, index) => `q${index + 1}`);
	const forkRelations = spokes.map((id) => ({ id: `q0-${id}`, from: 'q0', to: id }));
	if (value.chain && value.spokes > 1) forkRelations.push({ id: 'q1-q2', from: 'q1', to: 'q2' });
	const ids = [...targets, 'J', 'q0', ...spokes];
	const interleaved = ids
		.map((id, index) => ({ id, key: value.interleave[index] ?? 0, index }))
		.toSorted((left, right) => left.key - right.key || left.index - right.index)
		.map(({ id }) => id);
	return [
		{ nodes: targets, junctions: ['J'], relations },
		{ nodes: ['q0', ...spokes], junctions: [], relations: forkRelations },
		interleaved,
	];
}

// Reduced witness M2-01: J's long arrival used to take a column beyond B, then run along B's trunk.
const junctionWitness: IndependentComponent = {
	nodes: ['n3', 'n4', 'n7'],
	junctions: ['j0'],
	relations: [
		{ id: 'j0-n3', from: 'j0', to: 'n3' },
		{ id: 'j0-n4', from: 'j0', to: 'n4' },
		{ id: 'j0-n7', from: 'j0', to: 'n7' },
		{ id: 'n3-n7', from: 'n3', to: 'n7' },
	],
};
const forkWitness: IndependentComponent = {
	nodes: ['n5', 'n6', 'x'],
	junctions: [],
	relations: [
		{ id: 'n6-n5', from: 'n6', to: 'n5' },
		{ id: 'n6-x', from: 'n6', to: 'x' },
	],
};

it('keeps a junction component and an ordinary fork out of each other in every documentary role', async () => {
	const scenarios = [
		[junctionWitness, forkWitness, ['n3', 'n4', 'n5', 'n6', 'n7', 'x', 'j0']] as const,
		// Both components skip a row: J's outer column used to land on the fork's exterior column.
		junctionAndFork({
			targets: 4,
			shortcuts: [
				[2, 0],
				[0, 3],
			],
			spokes: 2,
			chain: true,
			interleave: [
				244_431_020, 137_142_185, 2_417_445, 1_151_986_867, 1_780_458_079, 227_489_033, 116_771_775,
				1_163_926_708, 229_541_709, 1_863_083_920,
			],
		}),
		...fc.sample(junctionBesideFork, { seed: 1_592_915_777, numRuns: 30 }).map(junctionAndFork),
	];
	for (const [index, [junction, fork, interleaved]] of scenarios.entries()) {
		const junctionIds = [...junction.nodes, ...junction.junctions];
		const forkIds = [...fork.nodes, ...fork.junctions];
		const roles = [interleaved, [...junctionIds, ...forkIds], [...forkIds, ...junctionIds]];
		for (const direction of Object.values(LayoutDirection))
			for (const order of roles) {
				const label = `${index} ${direction} ${order.join(',')}`;
				const together = prepareLayoutDocument(
					componentDocument(direction, [junction, fork], order),
				);
				for (const component of [junction, fork]) {
					const alone = prepareLayoutDocument(componentDocument(direction, [component], order));
					for (const id of [...component.nodes, ...component.junctions])
						expect(together.ranks.byEndpointId.get(id), label).toBe(
							alone.ranks.byEndpointId.get(id),
						);
				}
				const layout = await layoutGraph(together.graph, together.ranks, together.measurements);
				const validation = validateDedicatedCandidate({ ...together, layout });
				expect(validation, `${label}: ${JSON.stringify(validation)}`).toMatchObject({
					valid: true,
				});
				expect(entersEnvelope(layout, direction, junction, fork), label).toBe(false);
				expect(entersEnvelope(layout, direction, fork, junction), label).toBe(false);
				// Separately searched components publish only after a whole-document validation.
				const { witness } = layoutWithDedicatedEngineAndRankOrderWitness(
					together.graph,
					together.ranks,
					together.measurements,
				);
				if ((witness.components?.length ?? 0) > 0)
					expect(witness, label).toMatchObject({ unverified: 0, finalValidation: { valid: true } });
				if (index === 0) expect(witness.work.globalValidations, label).toBe(1);
			}
	}
}, 120_000);

it.each(Object.values(LayoutDirection))(
	'keeps a nested group route independent of a distant frame in %s',
	async (direction) => {
		const { document, overrides } = deepShellSample(3, direction, 36);
		const combined: LogicDocument = {
			...document,
			nodes: [
				...document.nodes,
				...['p', 'q', 'r'].map((id, index) => ({
					kind: EndpointKind.Node as const,
					id,
					natureId: 'goal',
					markdown: id,
					layoutOrder: orderKey(`b8${index}`),
					...(index < 2 && { groupId: 'H' }),
				})),
			],
			groups: [
				...document.groups,
				{ kind: EndpointKind.Group, id: 'H', label: 'H', layoutOrder: orderKey('b89') },
			],
			relations: [
				...document.relations,
				{ id: 'q-p', from: 'q', to: 'p' },
				{ id: 'r-q', from: 'r', to: 'q' },
				{ id: 'r-p', from: 'r', to: 'p' },
			],
		};
		const alone = await layoutDocument(document, overrides);
		const together = await layoutDocument(combined, {
			...overrides,
			groups: {
				...overrides.groups,
				H: { minimumWidth: 160, minimumHeight: 72, headerHeight: 36, padding: 24 },
			},
		});
		const signature = (layout: LayoutResult) => {
			const origin = boundsFor(layout, 'g0');
			const local = ({ x, y }: { readonly x: number; readonly y: number }) => ({
				x: x - origin.x,
				y: y - origin.y,
			});
			return {
				elements: layout.elements
					.filter(({ id }) => id !== 'H' && !['p', 'q', 'r'].includes(id))
					.map(({ id, bounds }) => ({ id, ...bounds, ...local(bounds) })),
				routes: layout.relations
					.filter(({ id }) => document.relations.some((relation) => relation.id === id))
					.map((path) => ({
						id: path.id,
						runs: referenceRuns(path).map(({ start, end }) => ({
							start: local(start),
							end: local(end),
						})),
					})),
			};
		};
		expect(validateDedicatedCandidate(alone).valid).toBe(true);
		expect(validateDedicatedCandidate(together).valid).toBe(true);
		expect(signature(together.layout)).toEqual(signature(alone.layout));
	},
);
