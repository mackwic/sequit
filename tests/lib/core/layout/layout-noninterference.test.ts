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
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { acyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

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
	const alone = prepareLayoutDocument(ordinary);
	const together = prepareLayoutDocument(combined);
	for (const id of ordinaryIds)
		expect(together.ranks.byEndpointId.get(id)).toBe(alone.ranks.byEndpointId.get(id));
	const soloLayout = await layoutGraph(alone.graph, alone.ranks, alone.measurements);
	const combinedLayout = await layoutGraph(together.graph, together.ranks, together.measurements);
	const soloValidation = validateDedicatedCandidate({ ...alone, layout: soloLayout });
	const combinedValidation = validateDedicatedCandidate({ ...together, layout: combinedLayout });
	expect(soloValidation, JSON.stringify(soloValidation)).toMatchObject({ valid: true });
	expect(combinedValidation, JSON.stringify(combinedValidation)).toMatchObject({ valid: true });
	expect(
		relationSignature(combinedLayout, combined.layout.direction, ['relation-000', 'relation-002']),
	).toEqual(
		relationSignature(soloLayout, ordinary.layout.direction, ['relation-000', 'relation-002']),
	);
});
