import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	JunctionOperator,
	LayoutDirection,
	type LogicDocument,
	type LogicNode,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { createLayoutFrame } from '../../../../src/lib/core/layout/geometry/layout-frame';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import { layerPassages } from '../../../../src/lib/core/layout/routing/layer-passages';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { defaultBiasFor } from '../../../support/harnesses/visual-directions';

const firstRelation = { id: 'first', from: 'source', to: 'target' };
const secondRelation = {
	id: 'second',
	from: 'other-source',
	to: 'other-target',
};
const document: LogicDocument = {
	...validLogicDocument(),
	nodes: ['source', 'target', 'other-source', 'other-target', 'ordinary'].map((id, index) => ({
		kind: EndpointKind.Node,
		id,
		natureId: 'goal',
		markdown: id,
		layoutOrder: orderKey(`a${index}`),
	})),
	groups: [
		{
			kind: EndpointKind.Group,
			id: 'group',
			label: 'Group',
			layoutOrder: orderKey('b00'),
		},
	],
	junctions: ['junction', 'next-junction'].map((id, index) => ({
		kind: EndpointKind.Junction,
		id,
		operator: JunctionOperator.Xor,
		layoutOrder: orderKey(`b0${index + 1}`),
	})),
	relations: [firstRelation, secondRelation],
};
const graphResult = createGraph(document);
if (!graphResult.ok) throw new Error('The passage fixture must have valid endpoints.');
const graph = graphResult.value;
const chainGraphResult = createGraph({
	...document,
	relations: [
		firstRelation,
		{ id: 'source-to-middle', from: 'source', to: 'other-target' },
		{ id: 'middle-to-target', from: 'other-target', to: 'target' },
	],
});
if (!chainGraphResult.ok) throw new Error('The middle-component fixture must be valid.');
const chainGraph = chainGraphResult.value;
const groupedGraphResult = createGraph({
	...document,
	nodes: document.nodes.map((node) => ({ ...node, groupId: 'group' })),
	junctions: [],
	relations: [firstRelation],
});
if (!groupedGraphResult.ok)
	throw new Error('The grouped passage fixture must have valid endpoints.');
const groupedGraph = groupedGraphResult.value;

describe.each(Object.values(LayoutDirection))('local layer passages in %s', (direction) => {
	const frame = createLayoutFrame(direction, defaultBiasFor(direction));
	function box(center: number, main: number, breadth = 80): Bounds {
		let primary = main;
		if (!frame.forward) primary = -main - 40;
		if (frame.vertical)
			return {
				x: center - breadth / 2,
				y: primary,
				width: breadth,
				height: 40,
			};
		return {
			x: primary,
			y: center - breadth / 2,
			width: 40,
			height: breadth,
		};
	}
	function input(
		rows: readonly (readonly string[])[],
		boxes: Readonly<Record<string, Bounds>>,
		inputGraph = graph,
	) {
		return {
			graph: inputGraph,
			layers: {
				rows,
				byId: new Map(rows.flatMap((row, index) => row.map((id) => [id, index] as const))),
				intervals: [],
			},
			bounds: new Map(Object.entries(boxes)),
			vertical: frame.vertical,
		};
	}
	function oneInterval(junctionCenter = 300, sourceCenter = 0, targetCenter = 0) {
		return input([['target'], ['junction'], ['source']], {
			target: box(targetCenter, 0),
			junction: box(junctionCenter, 120, 28),
			source: box(sourceCenter, 240),
		});
	}

	it('prefers the effective source port and falls back to the effective target port', () => {
		const offsets = {
			sourceOffsets: new Map([['first', 12]]),
			targetOffsets: new Map([['first', -12]]),
		};
		const free = layerPassages({ ...oneInterval(300, 0, 100), ...offsets });
		expect(free(firstRelation)).toBe(12);
		const blockedSource = layerPassages({
			...oneInterval(12, 0, 100),
			...offsets,
		});
		expect(blockedSource(firstRelation)).toBe(88);
	});

	it.each([
		{ gap: 24, expected: 0 },
		{ gap: 23, expected: undefined },
	])('keeps $gap px between a local column and a junction', ({ gap, expected }) => {
		const reserve = layerPassages(oneInterval(gap + 14));
		expect(reserve(firstRelation)).toBe(expected);
	});

	it.each([
		{ offset: 24, expected: 24 },
		{ offset: 23, expected: undefined },
		{ offset: -24, expected: -24 },
		{ offset: -23, expected: undefined },
	])(
		'separates unrelated reserved columns by 24 px (candidate=$offset)',
		({ offset, expected }) => {
			const reserve = layerPassages(
				input([['target', 'other-target'], ['junction'], ['source', 'other-source']], {
					target: box(0, 0),
					'other-target': box(offset, 0),
					junction: box(300, 120, 28),
					source: box(0, 240),
					'other-source': box(offset, 240),
				}),
			);
			expect(reserve(firstRelation)).toBe(0);
			expect(reserve(secondRelation)).toBe(expected);
		},
	);

	it('tries the target column when the source column is already reserved', () => {
		const reserve = layerPassages(
			input([['target', 'other-target'], ['junction'], ['source', 'other-source']], {
				target: box(0, 0),
				'other-target': box(80, 0),
				junction: box(300, 120, 28),
				source: box(0, 240),
				'other-source': box(0, 240),
			}),
		);
		expect(reserve(firstRelation)).toBe(0);
		expect(reserve(secondRelation)).toBe(80);
	});

	it('reuses a column in a disjoint interval between ordinary rows', () => {
		const reserve = layerPassages(
			input(
				[['target'], ['junction'], ['source', 'other-target'], ['next-junction'], ['other-source']],
				{
					target: box(0, 0),
					junction: box(300, 120, 28),
					source: box(0, 240),
					'other-target': box(0, 240),
					'next-junction': box(300, 360, 28),
					'other-source': box(0, 480),
				},
			),
		);
		expect(reserve(firstRelation)).toBe(0);
		expect(reserve(secondRelation)).toBe(0);
	});

	it('reserves two distinct local exterior tracks for concurrent long relations', () => {
		const reserve = layerPassages({
			...input([['target', 'other-target'], ['ordinary'], ['source', 'other-source']], {
				target: box(0, 0),
				'other-target': box(0, 0),
				ordinary: box(-200, 120),
				source: box(0, 240),
				'other-source': box(0, 240),
			}),
			componentByEndpointId: new Map([
				['target', 1],
				['other-target', 1],
				['source', 1],
				['other-source', 1],
				['ordinary', 0],
			]),
		});
		expect(reserve(firstRelation)).toBe(64);
		expect(reserve(secondRelation)).toBe(88);
	});

	it.each([
		{ left: 200, right: 700, expected: 464 },
		{ left: 100, right: 600, expected: 336 },
	])(
		'chooses the freer side of a middle component (left=$left, right=$right)',
		({ left, right, expected }) => {
			const reserve = layerPassages({
				...input(
					[['target'], ['ordinary', 'other-target', 'junction'], ['source']],
					{
						target: box(400, 0),
						ordinary: box(left, 120),
						'other-target': box(400, 120),
						junction: box(right, 120),
						source: box(400, 240),
					},
					chainGraph,
				),
				componentByEndpointId: new Map([
					['ordinary', 0],
					['target', 1],
					['other-target', 1],
					['source', 1],
					['junction', 2],
				]),
			});
			expect(reserve(firstRelation)).toBe(expected);
		},
	);

	it('uses the free source column before a side too narrow for concurrent shortcuts', () => {
		const shortcuts = ['a', 'b', 'c'].map((id) => ({
			id: `bounded-${id}`,
			from: 'source',
			to: 'target',
		}));
		const created = createGraph({ ...document, groups: [], junctions: [], relations: shortcuts });
		if (!created.ok) throw new Error('The bounded neighboring components must be valid');
		const reserve = layerPassages({
			...input(
				[['target'], ['ordinary', 'other-source'], ['source']],
				{
					target: box(400, 0),
					ordinary: box(280, 120),
					'other-source': box(560, 120),
					source: box(400, 240),
				},
				created.value,
			),
			componentByEndpointId: new Map([
				['ordinary', 0],
				['source', 1],
				['target', 1],
				['other-source', 2],
			]),
		});
		// The freer 80px side cannot hold three 24px rails and neighbor clearance.
		expect(shortcuts.map((relation) => reserve(relation))).toEqual([400, 464, 488]);
	});

	it('chooses a clear leading side when its tracks fit before a right-side neighbor', () => {
		const reserve = layerPassages({
			...input(
				[
					['target', 'other-target'],
					['ordinary', 'junction'],
					['source', 'other-source'],
				],
				{
					target: box(480, 0),
					'other-target': box(480, 0),
					ordinary: box(400, 120),
					junction: box(600, 120),
					source: box(400, 240),
					'other-source': box(400, 240),
				},
			),
			componentByEndpointId: new Map([
				['target', 1],
				['other-target', 1],
				['ordinary', 1],
				['source', 1],
				['other-source', 1],
				['junction', 2],
			]),
		});
		expect(reserve(firstRelation)).toBe(336);
	});

	it('rejects a foreign group frame across the positive column and chooses a clear fallback', () => {
		const reserve = layerPassages(
			input([['target'], [], ['source']], {
				target: box(200, 0),
				source: box(300, 240),
				group: box(312, 120),
			}),
		);
		expect(reserve(firstRelation)).toBe(200);
	});

	it('uses a clear endpoint column across ordinary intermediate boxes', () => {
		const reserve = layerPassages(
			input([['target'], ['junction', 'ordinary'], ['source']], {
				target: box(0, 0),
				junction: box(300, 120, 28),
				ordinary: box(500, 120),
				source: box(0, 240),
			}),
		);
		expect(reserve(firstRelation)).toBe(0);
	});

	it('uses a clear endpoint column across an empty intermediate row', () => {
		const reserve = layerPassages(
			input([['target'], [], ['source']], {
				target: box(0, 0),
				source: box(0, 240),
			}),
		);
		expect(reserve(firstRelation)).toBe(0);
	});

	it('uses the nearest corridor between ordinary obstacle clusters', () => {
		const reserve = layerPassages(
			input([['target'], ['ordinary', 'other-target'], ['source']], {
				target: box(0, 0),
				ordinary: box(0, 120),
				'other-target': box(160, 120),
				source: box(0, 240),
			}),
		);
		expect(reserve(firstRelation)).toBe(64);
	});

	it('uses common group padding before the global exterior', () => {
		const reserve = layerPassages(
			input(
				[['target'], ['ordinary'], ['source']],
				{
					group: box(0, 120, 200),
					target: box(0, 0),
					ordinary: box(0, 120),
					source: box(0, 240),
				},
				groupedGraph,
			),
		);
		expect(reserve(firstRelation)).toBe(-64);
	});

	it('reserves separated tracks in a saturated shared group frame', () => {
		const shortcuts = ['a', 'b', 'c'].map((id) => ({
			id: `shortcut-${id}`,
			from: 'source',
			to: 'target',
		}));
		const groupedDocument: LogicDocument = {
			...document,
			nodes: document.nodes.map((node) => ({ ...node, groupId: 'group' })),
			junctions: [],
			relations: [
				...shortcuts,
				{ id: 'side-first', from: 'other-source', to: 'ordinary' },
				{ id: 'side-second', from: 'ordinary', to: 'other-target' },
			],
		};
		const groupedResult = createGraph(groupedDocument);
		if (!groupedResult.ok)
			throw new Error('The grouped shortcut fixture must have valid endpoints.');
		const bounds = new Map<string, Bounds>([
			['group', { x: 0, y: 0, width: 400, height: 400 }],
			['target', box(200, 0, 32)],
			['ordinary', box(200, 120, 80)],
			['source', box(200, 240, 32)],
			['other-target', box(350, 0, 32)],
			['other-source', box(350, 240, 32)],
		]);
		const reserve = layerPassages({
			graph: groupedResult.value,
			layers: {
				rows: [['target', 'other-target'], ['ordinary'], ['source', 'other-source']],
				byId: new Map([
					['target', 0],
					['other-target', 0],
					['ordinary', 1],
					['source', 2],
					['other-source', 2],
				]),
				intervals: [],
			},
			bounds,
			vertical: frame.vertical,
			componentByEndpointId: new Map([
				['source', 1],
				['target', 1],
				['ordinary', 2],
				['other-source', 2],
				['other-target', 2],
			]),
		});
		const passages = shortcuts.map((relation) => reserve(relation));
		expect(passages).toEqual([136, 264, 112]);
		for (const passage of passages) expect(passage).toBeGreaterThanOrEqual(0);
		for (const passage of passages) expect(passage).toBeLessThanOrEqual(400);
	});

	it.each([
		{ start: 0, end: 400, capacity: 17 },
		{ start: 0, end: 350, capacity: 15 },
		{ start: 50, end: 400, capacity: 15 },
	])(
		'reserves empty-row group tracks until frame $start..$end is full',
		({ start, end, capacity }) => {
			const shortcuts = Array.from({ length: capacity + 1 }, (_, index) => ({
				id: `empty-${index}`,
				from: 'source',
				to: 'target',
			}));
			const groupedResult = createGraph({
				...document,
				nodes: document.nodes.map((node) => ({ ...node, groupId: 'group' })),
				junctions: [],
				relations: shortcuts,
			});
			if (!groupedResult.ok)
				throw new Error('The isolated group fixture must have valid endpoints.');
			let groupBounds: Bounds = { x: start, y: 0, width: end - start, height: 400 };
			if (!frame.vertical) groupBounds = { x: 0, y: start, width: 400, height: end - start };
			const reserve = layerPassages(
				input(
					[['target'], [], ['source']],
					{ group: groupBounds, target: box(200, 0, 32), source: box(200, 240, 32) },
					groupedResult.value,
				),
			);
			const passages = shortcuts.map((relation) => reserve(relation));
			expect(passages.slice(0, 3)).toEqual([200, 176, 224]);
			const allocated: number[] = [];
			for (const passage of passages.slice(0, -1)) {
				if (passage === undefined) throw new Error('A free group track was not reserved');
				expect(passage).toBeGreaterThanOrEqual(start);
				expect(passage).toBeLessThanOrEqual(end);
				for (const prior of allocated) expect(Math.abs(passage - prior)).toBeGreaterThanOrEqual(24);
				allocated.push(passage);
			}
			expect(passages.at(-1)).toBeUndefined();
		},
	);

	it('uses in-frame component exterior tracks after group candidates saturate', () => {
		const shortcuts = ['a', 'b', 'c'].map((id) => ({
			id: `exterior-${id}`,
			from: 'source',
			to: 'target',
		}));
		const nodes = [
			'source',
			'middle',
			'target',
			'neighbor-source',
			'neighbor-obstacle',
			'neighbor-target',
		].map((id, index): LogicNode => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'goal',
			markdown: id,
			layoutOrder: orderKey(`a${index}`),
			groupId: 'group',
		}));
		const groupedResult = createGraph({
			...document,
			nodes,
			junctions: [],
			relations: [
				{ id: 'source-middle', from: 'source', to: 'middle' },
				{ id: 'middle-target', from: 'middle', to: 'target' },
				...shortcuts,
				{ id: 'neighbor-first', from: 'neighbor-source', to: 'neighbor-obstacle' },
				{ id: 'neighbor-second', from: 'neighbor-obstacle', to: 'neighbor-target' },
			],
		});
		if (!groupedResult.ok)
			throw new Error('The connected grouped fixture must have valid endpoints.');
		let groupBounds: Bounds;
		let groupStart: number;
		let groupEnd: number;
		if (frame.vertical) {
			groupBounds = { x: 150, y: 0, width: 300, height: 300 };
			groupStart = groupBounds.x;
			groupEnd = groupStart + groupBounds.width;
		} else {
			groupBounds = { x: 0, y: 150, width: 300, height: 300 };
			groupStart = groupBounds.y;
			groupEnd = groupStart + groupBounds.height;
		}
		const reserve = layerPassages({
			...input(
				[
					['target', 'neighbor-target'],
					['middle', 'neighbor-obstacle'],
					['source', 'neighbor-source'],
				],
				{
					group: groupBounds,
					target: box(200, 0),
					middle: box(200, 120),
					source: box(200, 240),
					'neighbor-target': box(400, 0),
					'neighbor-obstacle': box(400, 120),
					'neighbor-source': box(400, 240),
				},
				groupedResult.value,
			),
			componentByEndpointId: new Map([
				['source', 1],
				['middle', 1],
				['target', 1],
				['neighbor-source', 2],
				['neighbor-obstacle', 2],
				['neighbor-target', 2],
			]),
		});
		const passages = shortcuts.map((relation) => reserve(relation));
		expect(passages).toEqual([264, 288, 312]);
		for (const passage of passages) {
			expect(passage).toBeGreaterThanOrEqual(groupStart);
			expect(passage).toBeLessThanOrEqual(groupEnd);
		}
	});

	it('rejects an offset endpoint column outside the common group', () => {
		const grouped = input(
			[['target'], ['ordinary'], ['source']],
			{
				group: box(0, 120, 200),
				target: box(0, 0),
				ordinary: box(0, 120),
				source: box(0, 240),
			},
			groupedGraph,
		);
		const reserve = layerPassages({
			...grouped,
			sourceOffsets: new Map([['first', 200]]),
		});
		expect(reserve(firstRelation)).toBe(100);
	});

	it.each([
		{ side: 'source', sourceId: 'group', targetId: 'target' },
		{ side: 'target', sourceId: 'source', targetId: 'group' },
	])('reserves a passage when the group is the $side endpoint', ({ side, sourceId, targetId }) => {
		const relation = { id: `group-${side}`, from: sourceId, to: targetId };
		const incidentGraphResult = createGraph({
			...document,
			relations: [
				{ id: 'into-junction', from: sourceId, to: 'junction' },
				{ id: 'out-of-junction', from: 'junction', to: targetId },
				relation,
			],
		});
		if (!incidentGraphResult.ok) throw new Error('The group passage fixture must be valid.');
		const reserve = layerPassages(
			input(
				[[targetId], ['junction'], [sourceId]],
				{
					[sourceId]: box(0, 240, 160),
					[targetId]: box(0, 0, 160),
					junction: box(300, 120, 28),
				},
				incidentGraphResult.value,
			),
		);
		expect(reserve(relation)).toBe(0);
	});

	it.each([
		{ side: 'source', sourceId: 'next-junction', targetId: 'target' },
		{ side: 'target', sourceId: 'source', targetId: 'next-junction' },
	])('reserves a passage for a long $side junction incidence', ({ side, sourceId, targetId }) => {
		const relation = { id: `junction-${side}`, from: sourceId, to: targetId };
		const incidentGraphResult = createGraph({
			...document,
			relations: [
				{ id: 'into-junction', from: sourceId, to: 'junction' },
				{ id: 'out-of-junction', from: 'junction', to: targetId },
				relation,
			],
		});
		if (!incidentGraphResult.ok) throw new Error('The junction passage fixture must be valid.');
		let sourceBreadth = 80;
		let targetBreadth = 80;
		if (side === 'source') sourceBreadth = 28;
		else targetBreadth = 28;
		const reserve = layerPassages(
			input(
				[[targetId], ['junction'], [sourceId]],
				{
					[sourceId]: box(0, 240, sourceBreadth),
					[targetId]: box(0, 0, targetBreadth),
					junction: box(300, 120, 28),
				},
				incidentGraphResult.value,
			),
		);
		expect(reserve(relation)).toBe(0);
	});

	it('does not allocate a passage to an adjacent or reversed relation', () => {
		const adjacent = layerPassages(
			input([['target'], ['source']], {
				target: box(0, 0),
				source: box(0, 240),
			}),
		);
		expect(adjacent(firstRelation)).toBeUndefined();
		expect(
			layerPassages(oneInterval())({
				id: 'reverse',
				from: 'target',
				to: 'source',
			}),
		).toBeUndefined();
	});

	it('uses a corridor when a later junction layer blocks both endpoint columns', () => {
		const reserve = layerPassages(
			input([['target'], ['junction'], ['next-junction'], ['source']], {
				target: box(0, 0),
				junction: box(300, 120, 28),
				'next-junction': box(0, 240, 28),
				source: box(0, 360),
			}),
		);
		expect(reserve(firstRelation)).toBe(38);
	});

	it('rebuilds obstacles and reservations for the next geometry phase without mutating bounds', () => {
		const phase = oneInterval();
		const original = structuredClone(phase.bounds);
		expect(layerPassages(phase)(firstRelation)).toBe(0);
		expect(phase.bounds).toEqual(original);
		phase.bounds.set('junction', box(0, 120, 28));
		const changed = structuredClone(phase.bounds);
		expect(layerPassages(phase)(firstRelation)).toBeUndefined();
		expect(phase.bounds).toEqual(changed);
		phase.bounds.set('junction', box(300, 120, 28));
		expect(layerPassages(phase)(firstRelation)).toBe(0);
		expect(phase.bounds).toEqual(original);
	});
});
