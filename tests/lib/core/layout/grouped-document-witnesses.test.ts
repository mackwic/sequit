import { describe, expect, it } from 'vitest';

import {
	defined,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import type { DedicatedCandidateValidationInput } from '../../../../src/lib/core/layout/dedicated-candidate-validation/types';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { GROUP_FRAME_CLEARANCE } from '../../../../src/lib/core/layout/layout-settings';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import {
	type LayoutWitness,
	layoutWitness,
	measurement,
	placeWitness,
} from '../../../support/harnesses/layout-witness';

/** Shrunk counterexamples of the grouped document property; every size is a plain default. */
const node = { width: 100, height: 60 };
const group = measurement(100, 60, 20, 16);

describe('junction rails', () => {
	it('places a junction without ordinary children after the junction it feeds', () => {
		// j1 sits just before n0, two ranks down; j0 feeds only j1, so its own rank cannot hold it.
		expect(
			layoutWitness({
				layout: {
					direction: LayoutDirection.BottomToTop,
					bias: LayoutBias.Top,
				},
				nodes: [
					['n0', node],
					['n1', node],
					['n2', node],
				],
				junctions: [['j0'], ['j1']],
				groups: [],
				relations: [
					['n0', 'n1'],
					['j0', 'j1'],
					['n1', 'n2'],
					['n0', 'j1'],
				],
			}),
		).toMatchObject({ valid: true });
	});
});

describe('junction channel frame shells', () => {
	it('keeps a frame ending on a junction rail clear of the frame starting on the next rank', () => {
		// g2 ends on j0's rail; g1 starts on the next rank, and its header faces that rail's slot.
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Bottom },
				nodes: [
					['n0', node, 'g1'],
					['n2', node],
					['n3', node],
					['n4', { width: 100, height: 40 }, 'g2'],
				],
				junctions: [['j0', 'g2']],
				groups: [
					['g1', measurement(254, 155, 34, 16)],
					['g2', measurement(183, 145, 15, 18)],
				],
				relations: [
					['g1', 'g2'],
					['n2', 'n4'],
					['n3', 'g2'],
				],
			}),
		).toMatchObject({ valid: true });
	});
});

describe('channel rail constraints', () => {
	it('breaks a cycle through a column that two unrelated relations reach', () => {
		// r1 and r2 arrive at one column of the root channel, from which r0 leaves.
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
				nodes: [
					['n1', node, 'g0'],
					['n2', node, 'g1'],
					['n4', node, 'g1'],
					['n5', node],
					['n6', node, 'g0'],
				],
				groups: [
					['g0', group],
					['g1', group],
				],
				relations: [
					['n5', 'g1'],
					['n2', 'g0'],
					['n1', 'n4'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('orders no straight relations sharing a column with converging arrivals', () => {
		// j0 reaches g0 and g1 straight down one column, where n4's relations to both arrive.
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
				nodes: [
					['n3', node, 'g1'],
					['n4', node],
				],
				junctions: [['j0']],
				groups: [
					['g0', group],
					['g1', group, 'g0'],
				],
				relations: [
					['n4', 'g0'],
					['j0', 'g0'],
					['j0', 'g1'],
					['n4', 'g1'],
				],
			}),
		).toMatchObject({ valid: true });
	});
});

/** Frames of rigid blocks and their junction rails, placed without any later separation. */
describe('group frames around junction rails', () => {
	const small = { width: 80, height: 40 };
	const thin = measurement(100, 60, 8, 8);
	const top = { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top } as const;

	it('keeps a junction-only frame clear of a one-rank frame overflowing toward its rail', () => {
		// g2 grows to 113 below n1; g1 holds only j0 and starts on the rail g2 faces.
		expect(
			layoutWitness({
				layout: top,
				nodes: [
					['n0', small, 'g0'],
					['n1', small, 'g2'],
				],
				junctions: [['j0', 'g1']],
				groups: [
					['g0', thin],
					['g1', thin, 'g0'],
					['g2', measurement(100, 113, 8, 8), 'g0'],
				],
				relations: [['g1', 'g2']],
			}),
		).toMatchObject({ valid: true });
	});

	it('starts a frame on its rail when its only ranked member is a junction-only group', () => {
		// g2 is related but holds only j0: g0's header belongs to j0's rail slot, not to rank 0.
		expect(
			layoutWitness({
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
			}),
		).toMatchObject({ valid: true });
	});

	it('places the free groups of a junction-only frame beside its junction', () => {
		// g1 holds nothing ranked; g0 holds it beside j0 instead of after every component.
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.BottomToTop, bias: LayoutBias.Top },
				nodes: [
					['n0', small],
					['n1', small],
					['n2', small],
					['n3', small],
				],
				junctions: [['j0', 'g0']],
				groups: [
					['g0', thin],
					['g1', thin, 'g0'],
				],
				relations: [['n0', 'g0']],
			}),
		).toMatchObject({ valid: true });
	});

	it('walls a block in the rank its frame crosses to reach a junction rail', () => {
		// g0 holds g2 on rank 0 and j0, j1 on the rail after rank 1, where g1 stands.
		expect(
			layoutWitness({
				layout: top,
				nodes: [
					['n0', small],
					['n1', small],
					['n2', small, 'g1'],
					['n3', small],
					['n4', small],
				],
				junctions: [
					['j0', 'g0'],
					['j1', 'g0'],
				],
				groups: [
					['g0', thin],
					['g1', thin],
					['g2', thin, 'g0'],
				],
				relations: [
					['n2', 'g2'],
					['g0', 'g1'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('keeps a related group holding only a related group out of the blocks', () => {
		// g1's relations end on g1 itself, so it keeps a row slot around g2, inside block g0.
		expect(
			layoutWitness({
				layout: top,
				nodes: ['n0', 'n1', 'n2', 'n3', 'n4'].map((id) => [id, small, 'g0'] as const),
				junctions: [['j0', 'g0']],
				groups: [
					['g0', thin],
					['g1', thin, 'g0'],
					['g2', thin, 'g1'],
				],
				relations: [
					['n0', 'g1'],
					['n0', 'g2'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('searches a component with the blocks of the whole document', () => {
		// g0's own relation lies in another component: locally g0 would become a block.
		expect(
			layoutWitness({
				layout: top,
				nodes: [
					['n0', small, 'g1'],
					['n1', small],
					['n2', small, 'g1'],
					['n3', small],
					['n4', small],
					['n5', small],
				],
				groups: [
					['g0', thin],
					['g1', thin],
					['g2', thin, 'g0'],
				],
				relations: [
					['n4', 'g0'],
					['n0', 'n1'],
					['n2', 'n5'],
					['n5', 'g2'],
				],
			}),
		).toMatchObject({ valid: true });
	});
});

/** Bounds of one placed element of a witness layout. */
function boxOf(input: DedicatedCandidateValidationInput, id: string): Bounds {
	const element = input.layout.elements.find((candidate) => candidate.id === id);
	if (element === undefined) throw new Error(`Expected ${id} to be placed`);
	return element.bounds;
}

describe('minimum size of a frame holding only a junction rail', () => {
	it('keeps the next rank clear of the frame where they overlap transversally', () => {
		// g0 grows to 200px below j0's rail; a, feeding j0, lies right under it.
		const placed = placeWitness({
			layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			nodes: [
				['a', node],
				['b', node],
			],
			junctions: [['j0', 'g0']],
			groups: [['g0', measurement(100, 200, 8, 8)]],
			relations: [
				['a', 'j0'],
				['j0', 'b'],
			],
		});
		const frame = boxOf(placed, 'g0');
		expect(boxOf(placed, 'a').y).toBeGreaterThanOrEqual(
			frame.y + frame.height + GROUP_FRAME_CLEARANCE,
		);
		expect(validateDedicatedCandidate(placed)).toMatchObject({ valid: true });
	});

	it('does not space the ranks for a frame overlapping nothing transversally', () => {
		// g2 grows down past j0's rail, beside n0 and n1: the rank stays where it would be.
		const placed = placeWitness({
			layout: { direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
			nodes: [
				['n0', { width: 102, height: 157 }],
				['n1', { width: 290, height: 141 }],
			],
			junctions: [['j0', 'g2']],
			groups: [['g2', measurement(100, 156, 28, 26)]],
			relations: [],
		});
		const frame = boxOf(placed, 'g2');
		expect(boxOf(placed, 'n0').y).toBeLessThan(frame.y + frame.height);
		expect(validateDedicatedCandidate(placed)).toMatchObject({ valid: true });
	});
});

const plain = { width: 220, height: 116 };
const framed = measurement(160, 72, 36, 24);

/** Reduced documents of the rich generated corpus (seed 1592915777), at default sizes. */
const richWitnesses: readonly {
	readonly name: string;
	readonly witness: Omit<LayoutWitness, 'layout'>;
}[] = [
	{
		name: 'reserves the frame of a related group holding a related empty group in its slot (rich/101)',
		witness: {
			nodes: [['n02', plain, 'g00']],
			junctions: [['j00', 'g00']],
			groups: [
				['e00', framed, 'g03'],
				['g03', framed],
				['g00', framed],
			],
			relations: [
				['j00', 'g03'],
				['e00', 'n02'],
				['g03', 'n02'],
			],
		},
	},
	{
		name: 'reserves the frames of related empty groups nested in each other (rich/68)',
		witness: {
			nodes: [
				['n01', plain],
				['n02', plain],
			],
			groups: [
				['e00', framed],
				['e01', framed, 'e00'],
				['e02', framed, 'e01'],
				['g02', framed],
			],
			relations: [
				['g02', 'n01'],
				['e01', 'n01'],
				['e02', 'n02'],
			],
		},
	},
	{
		name: 'draws the frame of a single junction in a block around the rows it holds (rich/7)',
		witness: {
			nodes: [
				['n01', plain, 'g01'],
				['n02', plain],
				['n03', plain, 'g01'],
				['n04', plain],
				['n05', plain, 'g00'],
			],
			junctions: [['j00', 'g04']],
			groups: [
				['e00', framed],
				['g02', framed],
				['g00', framed],
				['g01', framed, 'g00'],
				['g04', framed, 'g01'],
			],
			relations: [
				['j00', 'g02'],
				['g02', 'e00'],
				['e00', 'n02'],
				['n03', 'n04'],
			],
		},
	},
	{
		name: 'keeps room in a block for its junction past a nested frame crossing its rail (rich/155)',
		witness: {
			nodes: [['n05', plain, 'g00']],
			junctions: [
				['j00', 'g00'],
				['j01', 'g04'],
			],
			groups: [
				['g02', framed],
				['g00', framed],
				['g04', framed, 'g00'],
				['g05', framed, 'g04'],
				['g06', framed, 'g05'],
			],
			relations: [['j00', 'g02']],
		},
	},
	{
		name: 'moves the junctions of a block on one rail together out of foreign frames (rich/164)',
		witness: {
			nodes: [
				['n00', plain, 'g01'],
				['n01', plain],
				['n02', plain, 'g01'],
				['n03', plain, 'g01'],
				['n04', plain],
				['n05', plain],
			],
			junctions: [
				['j01', 'g00'],
				['j02', 'g00'],
			],
			groups: [
				['e00', framed],
				['g00', framed],
				['g01', framed, 'g00'],
			],
			relations: [
				['e00', 'n02'],
				['n03', 'n01'],
				['n04', 'j01'],
				['n05', 'j01'],
			],
		},
	},
	{
		name: 'keeps a foreign junction out of a block of junctions on one rail (rich/191)',
		witness: {
			nodes: [
				['n00', plain],
				['n05', plain, 'g00'],
			],
			junctions: [
				['j00', 'g01'],
				['j01', 'g00'],
				['j02', 'g01'],
			],
			groups: [
				['g00', framed],
				['g01', framed, 'g00'],
			],
			relations: [['n00', 'j01']],
		},
	},
	{
		name: 'grows an inner block around its junction before an outer junction leaves it (rich/95)',
		witness: {
			nodes: [
				['n06', plain, 'g05'],
				['n07', plain, 'g06'],
				['n08', plain, 'g05'],
				['n10', plain, 'g05'],
			],
			junctions: [
				['j01', 'g01'],
				['j02', 'g00'],
			],
			groups: [
				['g00', framed],
				['g01', framed, 'g00'],
				['g05', framed, 'g01'],
				['g06', framed, 'g05'],
			],
			relations: [],
		},
	},
	{
		name: 'keeps the junctions of a block clear of frames outside it through its own room (rich/36)',
		witness: {
			nodes: [
				['n00', plain],
				['n01', plain, 'g04'],
				['n02', plain, 'g00'],
				['n03', plain, 'g04'],
			],
			junctions: [
				['j00', 'g05'],
				['j01', 'g01'],
				['j02', 'g01'],
			],
			groups: [
				['e00', framed, 'g03'],
				['e01', framed, 'e00'],
				['e02', framed, 'e01'],
				['g02', framed],
				['g03', framed],
				['g00', framed],
				['g01', framed, 'g00'],
				['g04', framed, 'g01'],
				['g05', framed, 'g04'],
			],
			relations: [
				['n00', 'j00'],
				['n00', 'n02'],
				['g05', 'g03'],
				['j00', 'g02'],
				['g02', 'e02'],
				['g02', 'n01'],
				['e01', 'j01'],
			],
		},
	},
	{
		name: 'unites the components of a group holding two junctions in one block (rich/129)',
		witness: {
			nodes: [
				['n04', plain],
				['n05', plain],
			],
			junctions: [
				['j00', 'g06'],
				['j01', 'g06'],
			],
			groups: [
				['g02', framed],
				['g06', framed],
			],
			relations: [
				['j00', 'g02'],
				['g02', 'n05'],
				['n04', 'j01'],
			],
		},
	},
	{
		// Counterexample of the generated rich property (seed 1592915777), reduced.
		name: 'keeps a junction outside every frame clear of the nested frames facing its rail',
		witness: {
			nodes: [],
			junctions: [['j01']],
			groups: [
				['e00', framed, 'g03'],
				['e01', framed, 'e00'],
				['g03', framed],
				['g01', framed],
				['g04', framed],
			],
			relations: [
				['e00', 'g04'],
				['e01', 'j01'],
				['g03', 'g01'],
				['j01', 'g01'],
			],
		},
	},
];

describe.each(richWitnesses)('rigid blocks: $name', ({ witness }) => {
	it.each(Object.values(LayoutDirection))('lays the witness out validly in %s', (direction) => {
		const layout = defined(
			layoutConfiguration(direction, LayoutBias.Top) ??
				layoutConfiguration(direction, LayoutBias.Left),
		);
		const validation = layoutWitness({ ...witness, layout });
		expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
	});
});
