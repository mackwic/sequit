import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LaneOrientation,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { makeSharedLaneFrame } from '../../../../src/lib/core/layout/shared-lane-frame';
import { validateSharedLaneGeometry } from '../../../../src/lib/core/layout/shared-lane-geometry';
import { interiorPassageTrack } from '../../../../src/lib/core/layout/shared-lane-interior-passage';
import { validateSharedLaneInteriorPassage } from '../../../../src/lib/core/layout/shared-lane-interior-validation';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/shared-lane-layout';
import { prepareSharedLanes } from '../../../../src/lib/core/layout/shared-lane-model';
import { planSharedLanePorts } from '../../../../src/lib/core/layout/shared-lane-ports';
import { routeSharedLanes } from '../../../../src/lib/core/layout/shared-lane-routing';
import type { SharedLaneGeometry } from '../../../../src/lib/core/layout/shared-lane-types';
import { makeTransverseLaneFrame } from '../../../../src/lib/core/layout/shared-transverse-frame';
import {
	routeTransverseLanes,
	TransverseRouteOrder,
} from '../../../../src/lib/core/layout/shared-transverse-routing';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { interiorPassageDocument } from './shared-lane-interior-fixture';

const BLOCK_MEASUREMENT = {
	groups: {
		'sd-block': {
			minimumWidth: 220,
			minimumHeight: 180,
			headerHeight: 36,
			padding: 24,
		},
	},
};

function preparedPassage(blocked: boolean) {
	return prepareLayoutDocument(interiorPassageDocument(blocked), BLOCK_MEASUREMENT);
}

function plannedPassage(document: LogicDocument) {
	const prepared = prepareLayoutDocument(document, BLOCK_MEASUREMENT);
	const input = defined(
		prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
	);
	const ports = planSharedLanePorts(input);
	const frame = makeSharedLaneFrame(input, ports);
	return { prepared, input, ports, frame };
}

function middleCrossingY(geometry: SharedLaneGeometry): number {
	const middle = defined(geometry.lanes.find(({ id }) => id === 'SD'));
	const route = defined(geometry.relations.find(({ id }) => id === 'request'));
	for (let index = 1; index < route.points.length; index += 1) {
		const before = defined(route.points[index - 1]);
		const after = defined(route.points[index]);
		if (before.y !== after.y) continue;
		if (
			Math.min(before.x, after.x) < middle.bounds.x &&
			Math.max(before.x, after.x) > middle.bounds.x + middle.bounds.width
		)
			return before.y;
	}
	throw new Error('Expected a horizontal crossing of the middle lane.');
}

describe('interior passage through S | SD | C', () => {
	it('moves the passage below a blocker while staying between source and target', () => {
		const free = preparedPassage(false);
		const blocked = preparedPassage(true);
		const freeResult = solveSharedLaneLayout(free.graph, free.ranks, free.measurements);
		const blockedResult = solveSharedLaneLayout(blocked.graph, blocked.ranks, blocked.measurements);
		if (
			freeResult.status !== SharedLaneLayoutStatus.Selected ||
			blockedResult.status !== SharedLaneLayoutStatus.Selected
		)
			throw new Error('Both passage alternatives must be selected.');
		const freeY = middleCrossingY(freeResult.geometry);
		const blockedY = middleCrossingY(blockedResult.geometry);
		expect(blockedY).toBeGreaterThan(freeY);
		expect(
			validateSharedLaneInteriorPassage(free.graph, freeResult.geometry, 'request'),
		).toBeUndefined();
		expect(
			validateSharedLaneInteriorPassage(blocked.graph, blockedResult.geometry, 'request'),
		).toBeUndefined();
	});

	it.each([false, true])('selects a monotone free passage with blocker=%s', (blocked) => {
		const prepared = preparedPassage(blocked);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(result.status, JSON.stringify(result)).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		expect(
			validateSharedLaneInteriorPassage(prepared.graph, result.geometry, 'request'),
		).toBeUndefined();
		const y = middleCrossingY(result.geometry);
		const route = defined(result.geometry.relations[0]);
		expect(y).toBeLessThan(defined(route.points[0]).y);
		expect(y).toBeGreaterThan(defined(route.points.at(-1)).y);
		if (!blocked) return;
		const group = defined(result.geometry.elements.find(({ id }) => id === 'sd-block'));
		expect(defined(route.points.at(-1)).y).toBeGreaterThanOrEqual(group.bounds.y);
		expect(defined(route.points.at(-1)).y).toBeLessThanOrEqual(
			group.bounds.y + group.bounds.height,
		);
		expect(y).toBeGreaterThan(group.bounds.y + group.bounds.height + 12);
	});

	it('prefers the validated interior candidate to a valid exterior detour', () => {
		const prepared = preparedPassage(true);
		const input = defined(
			prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
		);
		const ports = planSharedLanePorts(input);
		const frame = makeSharedLaneFrame(input, ports);
		expect(interiorPassageTrack(input, frame, ports)).toBeTypeOf('number');
		const exterior: SharedLaneGeometry = {
			width: frame.crossExtent,
			height: frame.longExtent,
			lanes: frame.lanes,
			elements: frame.elements,
			relations: routeSharedLanes(input, frame, ports),
		};
		expect(validateSharedLaneGeometry(prepared.graph, exterior)).toBeUndefined();
		expect(validateSharedLaneInteriorPassage(prepared.graph, exterior, 'request')).toContain(
			'does not progress monotonically',
		);
		const selected = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
		if (selected.status !== SharedLaneLayoutStatus.Selected) return;
		expect(selected.geometry.relations).not.toEqual(exterior.relations);
	});

	it('rejects obstacle contact, broken attachment, and escaped group confinement', () => {
		const prepared = preparedPassage(true);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		if (result.status !== SharedLaneLayoutStatus.Selected)
			throw new Error('Expected the bounded interior passage.');
		const route = defined(result.geometry.relations[0]);
		const group = defined(result.geometry.elements.find(({ id }) => id === 'sd-block'));
		const onGroup = route.points.map((point, index) => {
			if (index !== 2 && index !== 3) return point;
			return { ...point, y: group.bounds.y + group.bounds.height / 2 };
		});
		expect(
			validateSharedLaneInteriorPassage(
				prepared.graph,
				{ ...result.geometry, relations: [{ ...route, points: onGroup }] },
				'request',
			),
		).toContain('touches element sd-block');
		expect(
			validateSharedLaneInteriorPassage(
				prepared.graph,
				{
					...result.geometry,
					relations: [
						{
							...route,
							points: [{ ...defined(route.points[0]), x: 0 }, ...route.points.slice(1)],
						},
					],
				},
				'request',
			),
		).toContain('wrong source face');
		expect(
			validateSharedLaneInteriorPassage(
				prepared.graph,
				{
					...result.geometry,
					elements: result.geometry.elements.map((element) => {
						if (element.id !== 'sd-block') return element;
						return { ...element, bounds: { ...element.bounds, x: 0 } };
					}),
				},
				'request',
			),
		).toContain('escapes its lane');
	});

	it('rejects a geometrically clear middle-lane crossing beyond the source port', () => {
		const prepared = preparedPassage(true);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		if (result.status !== SharedLaneLayoutStatus.Selected)
			throw new Error('Expected the bounded interior passage.');
		const route = defined(result.geometry.relations[0]);
		const beyondSource = defined(route.points[0]).y + 12;
		const beyondPort = route.points.map((point, index) => {
			if (index === 2 || index === 3) return { ...point, y: beyondSource };
			return point;
		});
		const changed = {
			...result.geometry,
			relations: [{ ...route, points: beyondPort }],
		};
		expect(validateSharedLaneGeometry(prepared.graph, changed, 12)).toBeUndefined();
		expect(validateSharedLaneInteriorPassage(prepared.graph, changed, 'request')).toContain(
			'does not progress monotonically',
		);
	});

	it('is canonical under input permutations and leaves wider unproved cases on the old policy', () => {
		const source = interiorPassageDocument(true);
		const permuted = {
			...source,
			presentation: {
				...defined(source.presentation),
				lanes: [...defined(source.presentation).lanes].reverse(),
			},
			nodes: [...source.nodes].reverse(),
		};
		const first = preparedPassage(true);
		const second = prepareLayoutDocument(permuted, BLOCK_MEASUREMENT);
		expect(solveSharedLaneLayout(second.graph, second.ranks, second.measurements)).toEqual(
			solveSharedLaneLayout(first.graph, first.ranks, first.measurements),
		);
		const wider = {
			...source,
			relations: [...source.relations, { id: 'second', from: 'c-request', to: 's-receive' }],
		};
		const prepared = prepareLayoutDocument(wider, BLOCK_MEASUREMENT);
		const input = defined(
			prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
		);
		expect(
			interiorPassageTrack(
				input,
				makeSharedLaneFrame(input, planSharedLanePorts(input)),
				planSharedLanePorts(input),
			),
		).toBeUndefined();
	});

	it('leaves transverse lanes and a nonadjacent rank pair to the wider policy', () => {
		const source = interiorPassageDocument(false);
		const transverse = plannedPassage({
			...source,
			presentation: {
				...defined(source.presentation),
				laneOrientation: LaneOrientation.Transverse,
			},
		});
		expect(
			interiorPassageTrack(transverse.input, transverse.frame, transverse.ports),
		).toBeUndefined();

		const beforeSource = (id: string, order: string): LogicDocument['nodes'][number] => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'task',
			markdown: id,
			laneId: 'C',
			layoutOrder: orderKey(order),
		});
		const separated = plannedPassage({
			...source,
			nodes: [
				beforeSource('c-earlier-1', 'a0'),
				beforeSource('c-earlier-2', 'a1'),
				...source.nodes.map((node) => {
					if (node.id !== 'c-request') return node;
					return { ...node, layoutOrder: orderKey('a2') };
				}),
			],
		});
		const plan = defined(separated.input.plans[0]);
		const sourceRow = defined(separated.input.endpoints.get(plan.from)).row;
		const targetRow = defined(separated.input.endpoints.get(plan.to)).row;
		expect(sourceRow).toBeGreaterThan(targetRow + 1);
		expect(interiorPassageTrack(separated.input, separated.frame, separated.ports)).toBeUndefined();
	});

	it.each(['source', 'target'] as const)(
		'leaves a %s group attachment to the wider policy',
		(groupEnd) => {
			const source = interiorPassageDocument(true);
			const group = defined(source.groups[0]);
			let groupLane = 'S';
			let removedNode = 's-receive';
			let relationFrom = 'c-request';
			let relationTo = group.id;
			if (groupEnd === 'source') {
				groupLane = 'C';
				removedNode = 'c-request';
				relationFrom = group.id;
				relationTo = 's-receive';
			}
			const document: LogicDocument = {
				...source,
				groups: [{ ...group, laneId: groupLane }],
				nodes: source.nodes.filter(({ id }) => id !== removedNode),
				relations: [{ id: 'request', from: relationFrom, to: relationTo }],
			};
			const candidate = plannedPassage(document);
			expect(
				interiorPassageTrack(candidate.input, candidate.frame, candidate.ports),
			).toBeUndefined();
		},
	);

	it('does not place the crossing behind a blocker in the source rank', () => {
		const planned = plannedPassage(interiorPassageDocument(true));
		const blocker = defined(planned.input.endpoints.get('sd-block'));
		const target = defined(planned.input.endpoints.get('s-receive'));
		const shifted = {
			...planned.input,
			endpoints: new Map(planned.input.endpoints).set(blocker.id, {
				...blocker,
				row: target.row + 1,
			}),
		};
		const frame = makeSharedLaneFrame(shifted, planned.ports);
		const blockerBox = defined(frame.boxes.get(blocker.id));
		const targetBox = defined(frame.boxes.get(target.id));
		expect(blockerBox.longitudinal).toBeGreaterThan(
			targetBox.longitudinal + targetBox.longSize / 2,
		);
		expect(interiorPassageTrack(shifted, frame, planned.ports)).toBeUndefined();
	});

	it('requires one continuous crossing of the middle lane, even for a clear monotone route', () => {
		const prepared = preparedPassage(false);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		if (result.status !== SharedLaneLayoutStatus.Selected)
			throw new Error('Expected the free interior passage.');
		const route = defined(result.geometry.relations[0]);
		const start = defined(route.points[0]);
		const end = defined(route.points.at(-1));
		const middle = defined(result.geometry.lanes.find(({ id }) => id === 'SD')).bounds;
		const crossingX = middle.x + middle.width / 2;
		const split = {
			...result.geometry,
			relations: [
				{
					...route,
					points: [start, { x: crossingX, y: start.y }, { x: crossingX, y: end.y }, end],
				},
			],
		};
		expect(validateSharedLaneGeometry(prepared.graph, split)).toBeUndefined();
		expect(validateSharedLaneInteriorPassage(prepared.graph, split, 'request')).toContain(
			'no monotone interior middle-lane passage',
		);
		expect(validateSharedLaneInteriorPassage(prepared.graph, result.geometry, 'missing')).toContain(
			'has no middle-lane passage',
		);
	});

	it('checks monotonicity in bottom-to-top layouts as well', () => {
		const source = interiorPassageDocument(true);
		const prepared = prepareLayoutDocument(
			{
				...source,
				layout: {
					direction: LayoutDirection.BottomToTop,
					bias: LayoutBias.Bottom,
				},
			},
			BLOCK_MEASUREMENT,
		);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		if (result.status !== SharedLaneLayoutStatus.Selected)
			throw new Error('Expected a valid reverse-direction passage.');
		const route = defined(result.geometry.relations[0]);
		expect(defined(route.points[0]).y).toBeLessThan(defined(route.points.at(-1)).y);
		expect(validateSharedLaneInteriorPassage(prepared.graph, result.geometry, 'request')).toContain(
			'does not progress monotonically',
		);
	});

	it('keeps the right transverse exterior corridor available when both ports sit right of center', () => {
		const source = interiorPassageDocument(false);
		const extraNode = (id: string, laneId: string): LogicDocument['nodes'][number] => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'task',
			markdown: id,
			laneId,
			layoutOrder: orderKey('a0'),
		});
		const document: LogicDocument = {
			...source,
			presentation: {
				...defined(source.presentation),
				laneOrientation: LaneOrientation.Transverse,
			},
			nodes: [
				extraNode('c-earlier', 'C'),
				extraNode('s-earlier', 'S'),
				...source.nodes.map((node) => ({
					...node,
					layoutOrder: orderKey('a1'),
				})),
			],
		};
		const { prepared, input, ports } = plannedPassage(document);
		const frame = makeTransverseLaneFrame(input, ports);
		const canonical = routeTransverseLanes(input, frame, ports, TransverseRouteOrder.Canonical);
		const nested = routeTransverseLanes(input, frame, ports, TransverseRouteOrder.Nested);
		expect(routeTransverseLanes(input, frame, ports)).toEqual(canonical);
		const canonicalGutter = defined(defined(canonical[0]).points[2]).x;
		const nestedGutter = defined(defined(nested[0]).points[2]).x;
		expect(canonicalGutter).toBeLessThan(frame.crossStart);
		expect(nestedGutter).toBeGreaterThan(frame.crossStart + frame.crossSize);
		for (const relations of [canonical, nested]) {
			expect(
				validateSharedLaneGeometry(prepared.graph, {
					width: frame.crossExtent,
					height: frame.longExtent,
					lanes: frame.lanes,
					elements: frame.elements,
					relations,
				}),
			).toBeUndefined();
		}
	});

	it('resolves a centered transverse corridor tie from the source side', () => {
		const source = interiorPassageDocument(false);
		const document: LogicDocument = {
			...source,
			presentation: {
				...defined(source.presentation),
				laneOrientation: LaneOrientation.Transverse,
			},
		};
		const { prepared, input, ports } = plannedPassage(document);
		const frame = makeTransverseLaneFrame(input, ports);
		const plan = defined(input.plans[0]);
		const sourceBox = defined(frame.boxes.get(plan.from));
		const targetBox = defined(frame.boxes.get(plan.to));
		expect((sourceBox.cross + targetBox.cross) / 2 + sourceBox.crossSize / 2).toBe(
			frame.crossStart + frame.crossSize / 2,
		);
		const relations = routeTransverseLanes(input, frame, ports, TransverseRouteOrder.Nested);
		expect(defined(defined(relations[0]).points[2]).x).toBeLessThan(frame.crossStart);
		expect(
			validateSharedLaneGeometry(prepared.graph, {
				width: frame.crossExtent,
				height: frame.longExtent,
				lanes: frame.lanes,
				elements: frame.elements,
				relations,
			}),
		).toBeUndefined();
	});
});
