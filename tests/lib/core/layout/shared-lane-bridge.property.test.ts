import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	type LogicRelation,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { unbridgedContacts } from '../../../../src/lib/core/layout/bridges/bridge-contact';
import { validatedBridges } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { SHARED_LANE_CLEARANCE } from '../../../../src/lib/core/layout/lanes/shared-lane-frame';
import { validateSharedLaneGeometry } from '../../../../src/lib/core/layout/lanes/shared-lane-geometry';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/lanes/shared-lane-layout';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

const DIRECTIONS = [
	[LayoutDirection.TopToBottom, LayoutBias.Top],
	[LayoutDirection.BottomToTop, LayoutBias.Bottom],
	[LayoutDirection.LeftToRight, LayoutBias.Left],
	[LayoutDirection.RightToLeft, LayoutBias.Right],
] as const;

/** The declared relation pool: same-lane, adjacent-lane and outer-lane dependencies. */
const RELATION_POOL: LogicRelation[] = [
	{ id: 'within-a', from: 'a1', to: 'a2' },
	{ id: 'a1-to-b', from: 'a1', to: 'b1' },
	{ id: 'a2-to-b', from: 'a2', to: 'b1' },
	{ id: 'a1-to-c', from: 'a1', to: 'c1' },
	{ id: 'b1-to-c', from: 'b1', to: 'c1' },
];

function laneDocument(
	orientation: LaneOrientation,
	direction: LayoutDirection,
	bias: LayoutBias,
	relations: readonly LogicRelation[],
): LogicDocument {
	const node = (
		id: string,
		laneId: string,
		markdown: string,
		order: string,
	): LogicDocument['nodes'][number] => ({
		kind: EndpointKind.Node,
		id,
		natureId: 'task',
		laneId,
		markdown,
		layoutOrder: orderKey(order),
	});
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'shared-lane-bridge-property',
		title: 'Shared lane bridge property',
		layout: defined(layoutConfiguration(direction, bias)),
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: orientation,
			growth: LaneGrowth.Auto,
			lanes: ['A', 'B', 'C'].map((id, index) => ({
				id,
				label: id,
				layoutOrder: orderKey(`a${index}`),
			})),
		},
		natures: [{ id: 'task', label: 'Task', color: '#000000' }],
		groups: [],
		nodes: [
			node('a1', 'A', 'A1', 'a0'),
			node('a2', 'A', 'A2', 'a1'),
			node('b1', 'B', 'B1', 'a2'),
			node('c1', 'C', 'C1', 'a3'),
		],
		junctions: [],
		relations,
	};
}

const scenario = fc.record({
	orientation: fc.constantFrom(LaneOrientation.Parallel, LaneOrientation.Transverse),
	directionIndex: fc.integer({ min: 0, max: DIRECTIONS.length - 1 }),
	relations: fc.subarray(RELATION_POOL, { minLength: 0 }),
});

describe('a selected shared lane layout', () => {
	it('keeps every touching pair of routes carried by a validated bridge', () => {
		fc.assert(
			fc.property(scenario, ({ orientation, directionIndex, relations }) => {
				const [direction, bias] = defined(DIRECTIONS[directionIndex]);
				const prepared = prepareLayoutDocument(
					laneDocument(orientation, direction, bias, relations),
				);
				const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
				if (result.status !== SharedLaneLayoutStatus.Selected) return;
				// A selected candidate passes the bridged validator, so no contact of any pair is bare.
				expect(
					validateSharedLaneGeometry(prepared.graph, result.geometry, SHARED_LANE_CLEARANCE, true),
				).toBeUndefined();
				const bridges = validatedBridges(result.geometry.relations);
				for (const [index, route] of result.geometry.relations.entries())
					for (const other of result.geometry.relations.slice(index + 1))
						expect(unbridgedContacts(route, other, bridges)).toEqual([]);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
