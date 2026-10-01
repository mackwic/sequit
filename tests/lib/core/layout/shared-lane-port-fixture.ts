import { expect } from 'vitest';

import {
	defined,
	EndpointKind,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import type { SharedLaneGeometry } from '../../../../src/lib/core/layout/lanes/shared-lane-geometry';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/lanes/shared-lane-layout';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

export const configurations = [
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
] as const;
export const orientations = [LaneOrientation.Parallel, LaneOrientation.Transverse];

export function documentFor(
	layout: LogicDocument['layout'],
	orientation: LaneOrientation,
	nodes: readonly (readonly [string, string])[],
	pairs: readonly (readonly [string, string])[],
): LogicDocument {
	const laneIds = [...new Set(nodes.map(([, lane]) => lane))];
	if (laneIds.length === 1) laneIds.push('L2');
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'ports',
		title: 'Ports',
		layout,
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: orientation,
			growth: LaneGrowth.Auto,
			lanes: laneIds.map((id, index) => ({ id, label: id, layoutOrder: orderKey(`a${index}`) })),
		},
		natures: [{ id: 'task', label: 'Task', color: '#000000' }],
		groups: [],
		junctions: [],
		nodes: nodes.map(([id, laneId], index) => ({
			id,
			laneId,
			kind: EndpointKind.Node,
			natureId: 'task',
			markdown: 'Task',
			layoutOrder: orderKey(`a${index}`),
		})),
		relations: pairs.map(([from, to], index) => ({ id: `r${index}`, from, to })),
	};
}

export function geometry(document: LogicDocument): SharedLaneGeometry {
	const prepared = prepareLayoutDocument(document);
	const outcome = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
	expect(outcome.status, JSON.stringify(outcome)).toBe(SharedLaneLayoutStatus.Selected);
	if (outcome.status !== SharedLaneLayoutStatus.Selected) throw new Error(outcome.reason);
	return outcome.geometry;
}

export function rename(document: LogicDocument, ids: ReadonlyMap<string, string>): LogicDocument {
	return {
		...document,
		nodes: document.nodes.map((node) => ({ ...node, id: ids.get(node.id) ?? node.id })),
		relations: document.relations.map((relation) => ({
			...relation,
			from: ids.get(relation.from) ?? relation.from,
			to: ids.get(relation.to) ?? relation.to,
		})),
	};
}

export function normalized(document: LogicDocument): SharedLaneGeometry {
	const result = geometry(document);
	const order = new Map(document.nodes.map(({ id }, index) => [id, index]));
	return {
		...result,
		elements: result.elements
			.map((element) => ({ ...element, id: `node-${defined(order.get(element.id))}` }))
			.sort((a, b) => a.id.localeCompare(b.id)),
		relations: result.relations.map((relation) => ({
			...relation,
			from: `node-${defined(order.get(relation.from))}`,
			to: `node-${defined(order.get(relation.to))}`,
		})),
	};
}
