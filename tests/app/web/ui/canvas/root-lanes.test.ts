import { describe, expect, it } from 'vitest';

import {
	laneOrientationLabel,
	rootLanes,
	unsupportedByRootLanes,
} from '../../../../../src/app/web/ui/canvas/root-lanes';
import {
	EndpointKind,
	JunctionOperator,
	LaneOrientation,
	LayoutDirection,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../../../support/builders/logic-document';

describe('rootLanes', () => {
	it('orders lanes by layout order, and is empty without explicit lanes', () => {
		const document = explicitLaneLogicDocument();
		const presentation = document.presentation;
		if (presentation === undefined) throw new Error('Expected lanes');
		const reversed = {
			...document,
			presentation: { ...presentation, lanes: [...presentation.lanes].reverse() },
		};
		expect(rootLanes(reversed).map(({ id }) => id)).toEqual(['left', 'right']);
		expect(rootLanes(validLogicDocument())).toEqual([]);
	});
});

describe('laneOrientationLabel', () => {
	it('names columns and bands from the reading direction', () => {
		expect(laneOrientationLabel(LaneOrientation.Parallel, LayoutDirection.TopToBottom)).toBe(
			'En colonnes',
		);
		expect(laneOrientationLabel(LaneOrientation.Transverse, LayoutDirection.BottomToTop)).toBe(
			'En bandes',
		);
		expect(laneOrientationLabel(LaneOrientation.Parallel, LayoutDirection.LeftToRight)).toBe(
			'En bandes',
		);
		expect(laneOrientationLabel(LaneOrientation.Transverse, LayoutDirection.RightToLeft)).toBe(
			'En colonnes',
		);
	});
});

describe('unsupportedByRootLanes', () => {
	it('flags junctions and groups with members, which the shared lane policy refuses', () => {
		const document = validLogicDocument();
		const flat = {
			...document,
			groups: [],
			junctions: [],
			nodes: document.nodes.filter(({ groupId }) => groupId === undefined),
			relations: [],
		};
		expect(unsupportedByRootLanes(flat)).toBe(false);
		expect(unsupportedByRootLanes(document)).toBe(true);
		expect(
			unsupportedByRootLanes({
				...flat,
				junctions: [
					{
						kind: EndpointKind.Junction,
						id: 'J',
						operator: JunctionOperator.Xor,
						layoutOrder: orderKey('a0'),
					},
				],
			}),
		).toBe(true);
	});
});
