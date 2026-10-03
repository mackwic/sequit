import { expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { createLayoutFrame } from '../../../../src/lib/core/layout/geometry/layout-frame';
import { GROUP_FRAME_CLEARANCE } from '../../../../src/lib/core/layout/layout-settings';
import { prepareMeasurements } from '../../../../src/lib/core/layout/placement/prepare-measurements';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { measurement, placeWitness } from '../../../support/harnesses/layout-witness';

const parentPadding = 12;
const junctionFramePadding = 12;
const junctionFrameHeader = 20;

function junctionGap(groupedMember: 'a' | 'c', slot: number): number | undefined {
	const baseNodes = [
		['a', { width: 80, height: 40 }],
		['b', { width: 80, height: 40 }],
		['c', { width: 80, height: 40 }],
	] as const;
	const nodes = baseNodes.map(([id, size]) => {
		if (id === groupedMember) return [id, size, 'outer'] as const;
		return [id, size] as const;
	});
	const prepared = placeWitness({
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		nodes,
		junctions: [['j', 'inner']],
		groups: [
			['outer', measurement(220, 120, junctionFrameHeader, parentPadding)],
			['inner', measurement(120, 90, junctionFrameHeader, junctionFramePadding), 'outer'],
		],
		relations: [
			['a', 'j'],
			['b', 'j'],
			['j', 'c'],
		],
	});
	const structure = prepareLayout(prepared.graph, prepared.ranks);
	const frame = createLayoutFrame(LayoutDirection.TopToBottom, LayoutBias.Top);
	return prepareMeasurements(structure, prepared.measurements, frame).junctionShellGaps.get(0)?.[
		slot
	];
}

it('does not count a frame starting on the rank beyond its junction rail', () => {
	expect(junctionGap('a', 1)).toBe(GROUP_FRAME_CLEARANCE + junctionFramePadding);
});

it('does not count a frame ending on the rank before its junction rail', () => {
	expect(junctionGap('c', 0)).toBe(
		GROUP_FRAME_CLEARANCE + junctionFramePadding + junctionFrameHeader,
	);
});
