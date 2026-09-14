import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	JunctionOperator,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { createLayoutFrame } from '../../../../src/lib/core/layout/geometry/layout-frame';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import { junctionPassages } from '../../../../src/lib/core/layout/routing/junction-passages';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { defaultBiasFor } from '../../../support/harnesses/visual-directions';

const firstRelation = { id: 'first', from: 'source', to: 'target' };
const secondRelation = { id: 'second', from: 'other-source', to: 'other-target' };
const document: LogicDocument = {
	...validLogicDocument(),
	nodes: ['source', 'target', 'other-source', 'other-target', 'ordinary'].map((id, index) => ({
		kind: EndpointKind.Node,
		id,
		natureId: 'goal',
		markdown: id,
		layoutOrder: orderKey(`a${index}`),
	})),
	groups: [{ kind: EndpointKind.Group, id: 'group', label: 'Group', layoutOrder: orderKey('b00') }],
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

describe.each(Object.values(LayoutDirection))('local junction passages in %s', (direction) => {
	const frame = createLayoutFrame(direction, defaultBiasFor(direction));
	function box(center: number, main: number, breadth = 80): Bounds {
		let primary = main;
		if (!frame.forward) primary = -main - 40;
		if (frame.vertical) return { x: center - breadth / 2, y: primary, width: breadth, height: 40 };
		return { x: primary, y: center - breadth / 2, width: 40, height: breadth };
	}
	function input(rows: readonly (readonly string[])[], boxes: Readonly<Record<string, Bounds>>) {
		return {
			graph,
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

	it('prefers the effective source quay and falls back to the effective target quay', () => {
		const offsets = {
			sourceOffsets: new Map([['first', 12]]),
			targetOffsets: new Map([['first', -12]]),
		};
		const free = junctionPassages({ ...oneInterval(300, 0, 100), ...offsets });
		expect(free(firstRelation)).toBe(12);
		const blockedSource = junctionPassages({ ...oneInterval(12, 0, 100), ...offsets });
		expect(blockedSource(firstRelation)).toBe(88);
	});

	it.each([
		{ gap: 24, expected: 0 },
		{ gap: 23, expected: undefined },
	])('keeps $gap px between a local column and a junction', ({ gap, expected }) => {
		const reserve = junctionPassages(oneInterval(gap + 14));
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
			const reserve = junctionPassages(
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
		const reserve = junctionPassages(
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
		const reserve = junctionPassages(
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

	it('rejects ordinary intermediate boxes even when their columns are clear', () => {
		const reserve = junctionPassages(
			input([['target'], ['junction', 'ordinary'], ['source']], {
				target: box(0, 0),
				junction: box(300, 120, 28),
				ordinary: box(500, 120),
				source: box(0, 240),
			}),
		);
		expect(reserve(firstRelation)).toBeUndefined();
	});

	it.each(['junction', 'group'])('leaves %s endpoints to their dedicated routing policy', (id) => {
		const reserve = junctionPassages(oneInterval());
		expect(reserve({ id: 'from-special', from: id, to: 'target' })).toBeUndefined();
		expect(reserve({ id: 'to-special', from: 'source', to: id })).toBeUndefined();
	});

	it('does not allocate a passage to an adjacent or reversed relation', () => {
		const adjacent = junctionPassages(
			input([['target'], ['source']], { target: box(0, 0), source: box(0, 240) }),
		);
		expect(adjacent(firstRelation)).toBeUndefined();
		expect(
			junctionPassages(oneInterval())({ id: 'reverse', from: 'target', to: 'source' }),
		).toBeUndefined();
	});

	it('checks every junction layer instead of stopping after the first free layer', () => {
		const reserve = junctionPassages(
			input([['target'], ['junction'], ['next-junction'], ['source']], {
				target: box(0, 0),
				junction: box(300, 120, 28),
				'next-junction': box(0, 240, 28),
				source: box(0, 360),
			}),
		);
		expect(reserve(firstRelation)).toBeUndefined();
	});

	it('rebuilds obstacles and reservations for the next geometry phase without mutating bounds', () => {
		const phase = oneInterval();
		const original = structuredClone(phase.bounds);
		expect(junctionPassages(phase)(firstRelation)).toBe(0);
		expect(phase.bounds).toEqual(original);
		phase.bounds.set('junction', box(0, 120, 28));
		const changed = structuredClone(phase.bounds);
		expect(junctionPassages(phase)(firstRelation)).toBeUndefined();
		expect(phase.bounds).toEqual(changed);
		phase.bounds.set('junction', box(300, 120, 28));
		expect(junctionPassages(phase)(firstRelation)).toBe(0);
		expect(phase.bounds).toEqual(original);
	});
});
