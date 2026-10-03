import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { GROUP_FRAME_CLEARANCE, ITEM_GAP } from '../../../../src/lib/core/layout/layout-settings';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import {
	type LayoutWitness,
	layoutWitness,
	measurement,
	placeWitness,
} from '../../../support/harnesses/layout-witness';
import { VisualLayout } from '../../../support/harnesses/visual-layout';

/** Shrunk counterexamples of rigid group blocks, placed without any later separation. */
const small = { width: 80, height: 40 };
const thin = measurement(100, 60, 8, 8);
const top = { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top } as const;

/** The witness as laid out, with the ranks and document its visual assertions read. */
function visualWitness(witness: LayoutWitness): VisualLayout {
	const placed = placeWitness(witness);
	return new VisualLayout(
		placed.layout,
		placed.ranks.byEndpointId,
		witness.layout.direction,
		undefined,
		placed.graph.document,
	);
}

describe('foreign junctions around block frames', () => {
	it('moves a junction out of a frame its rail runs within half a clearance of', () => {
		// j0's rail runs just before g2's header: j0 leaves g2's width, so r0 meets it where drawn.
		expect(
			layoutWitness({
				layout: top,
				nodes: [
					['n0', small],
					['n1', small, 'g2'],
				],
				junctions: [['j0']],
				groups: [
					['g0', thin],
					['g2', measurement(116, 149, 40, 20)],
				],
				relations: [
					['n1', 'j0'],
					['g0', 'g2'],
					['n0', 'g2'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('moves a junction out of a frame as it stands once its own junctions are clamped', () => {
		// j0 belongs to g1 and shares j1's rail: j1 leaves g1's frame as enclosing j0 makes it.
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
				nodes: [['n0', small, 'g1']],
				junctions: [['j0', 'g1'], ['j1']],
				groups: [['g1', thin]],
				relations: [['n0', 'j1']],
			}),
		).toMatchObject({ valid: true });
	});
});

describe('block walls', () => {
	it('walls a block in the rank between its member and its junction rail', () => {
		// g0 holds n0 and j0, whose rail lies beyond n2's rank: n2 stays out of g0's frame.
		expect(
			layoutWitness({
				layout: top,
				nodes: [
					['n0', small, 'g0'],
					['n2', small],
				],
				junctions: [['j0', 'g0']],
				groups: [['g0', thin]],
				relations: [
					['n0', 'n2'],
					['n2', 'j0'],
				],
			}),
		).toMatchObject({ valid: true });
	});
});

describe('frames around junction-only groups', () => {
	it('reserves the clearance before a frame whose only ranked member holds a junction', () => {
		// g2 is related but holds only j0: g0 starts on j0's rail, a clearance after g1's rank.
		const layout = visualWitness({
			layout: top,
			nodes: [
				['n0', small, 'g0'],
				['n1', small, 'g0'],
				['n2', small, 'g0'],
				['n3', small, 'g1'],
			],
			junctions: [
				['j0', 'g2'],
				['j1', 'g0'],
			],
			groups: [
				['g0', measurement(100, 60, 22, 27)],
				['g1', thin],
				['g2', thin, 'g0'],
			],
			relations: [
				['g0', 'g1'],
				['j1', 'g2'],
			],
		});
		AssertLayout(layout)
			.group('g0')
			.isClearOfForeignBoxes({ along: GROUP_FRAME_CLEARANCE, across: ITEM_GAP });
	});

	it('keeps a frame overflow out of the slot of the rail the frame holds', () => {
		// g0's minimum size overflows n0's rank, yet g0 goes on to j0's rail: it faces no slot there.
		const layout = visualWitness({
			layout: { direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
			nodes: [['n0', small, 'g0']],
			junctions: [['j0', 'g1']],
			groups: [
				['g0', thin],
				['g1', thin, 'g0'],
				['g2', thin],
			],
			relations: [['g0', 'g2']],
		});
		const member = layout.getById('n0').bounds;
		const frame = layout.getById('g1').bounds;
		expect(frame.x - member.x - member.width).toBe(GROUP_FRAME_CLEARANCE);
	});
});

describe('free groups', () => {
	it('reserves the rank gap a free group beside a block content outgrows it by', () => {
		// The empty g2 stands beside n0 in g1 and is longer: g1's frame stops a clearance before n1.
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.BottomToTop, bias: LayoutBias.Top },
				nodes: [
					['n0', small, 'g1'],
					['n1', small],
				],
				groups: [
					['g1', thin],
					['g2', measurement(104, 115, 30, 21), 'g1'],
				],
				relations: [['n0', 'n1']],
			}),
		).toMatchObject({ valid: true });
	});

	it('sizes the row slot of a related group around the free groups it holds', () => {
		// g0 holds only the empty g2: its slot, sized as its frame, keeps n0 out of it.
		expect(
			layoutWitness({
				layout: top,
				nodes: [['n0', small]],
				groups: [
					['g0', thin],
					['g2', thin, 'g0'],
				],
				relations: [['n0', 'g0']],
			}),
		).toMatchObject({ valid: true });
	});
});

describe('families beside a junction-only group', () => {
	it('keeps a parent centred on its only child once the frames are placed', () => {
		// g1 holds only j0 and outgrows its rail beside n1 and n3: no later pass moves them.
		const layout = visualWitness({
			layout: { direction: LayoutDirection.RightToLeft, bias: LayoutBias.Left },
			nodes: ['n0', 'n1', 'n2', 'n3'].map((id) => [id, small] as const),
			junctions: [['j0', 'g1']],
			groups: [['g1', thin]],
			relations: [
				['n0', 'n1'],
				['n2', 'n3'],
				['n2', 'g1'],
			],
		});
		AssertLayout(layout).envelope(['n0']).isCenteredOn('n1', { axis: 'transverse' });
	});
});
