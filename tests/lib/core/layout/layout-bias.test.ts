import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	JunctionOperator,
	type LayoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { projectRelationAddition } from '../../../../src/lib/core/document/topology-edits';
import { fractionalOrderKeySpace } from '../../../../src/lib/core/ordering/order-key-space';
import { crossingAwareDirectionScenario } from '../../../support/builders/crossing-aware-direction-scenario';
import {
	ISOLATED_BRANCH,
	LAYOUT_CONFIGURATIONS,
	LAYOUT_CONTEXTS,
	layoutBiasScenario,
	LONG_BRANCH,
	LONG_BRANCH_RELATIONS,
	SHORT_BRANCH,
	SHORT_BRANCH_RELATIONS,
} from '../../../support/builders/layout-bias-scenario';
import { validLogicDocument } from '../../../support/builders/logic-document';
import {
	boundsFor,
	contains,
	coordinateAt,
	envelopeFor,
	layoutDocument,
	overlaps,
	progressesFromTo,
} from '../../../support/harnesses/layout';

const ALL_NODES = [...LONG_BRANCH, ...SHORT_BRANCH, ...ISOLATED_BRANCH] as const;

function crossAxisCoordinate(
	direction: LayoutConfiguration['direction'],
	bounds: { readonly x: number; readonly y: number },
): number {
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop)
		return bounds.x;
	return bounds.y;
}

function touchesBoundary(
	point: { readonly x: number; readonly y: number },
	bounds: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	},
): boolean {
	const withinX = point.x >= bounds.x && point.x <= bounds.x + bounds.width;
	const withinY = point.y >= bounds.y && point.y <= bounds.y + bounds.height;
	return (
		(withinX && (point.y === bounds.y || point.y === bounds.y + bounds.height)) ||
		(withinY && (point.x === bounds.x || point.x === bounds.x + bounds.width))
	);
}

function terminalJunctionScenario(layout: LayoutConfiguration): LogicDocument {
	return {
		persistenceFormat: 2,
		id: 'terminal-junction',
		title: 'Terminal junction',
		layout,
		natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
		groups: [],
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'source',
				natureId: 'goal',
				markdown: 'Source',
				layoutOrder: orderKey('a0'),
			},
		],
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'terminal-junction',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a1'),
			},
		],
		relations: [{ id: 'source-to-terminal-junction', from: 'source', to: 'terminal-junction' }],
	};
}

function crossingAwareJunctionScenario(layout: LayoutConfiguration): LogicDocument {
	const keyFor = (id: string) =>
		orderKey(
			(
				{
					'source-a': 'a0',
					'source-b': 'a1',
					'source-c': 'a2',
					'junction-c': 'a3',
					'junction-a': 'a4',
					'junction-b': 'a5',
					successor: 'a6',
				} as const
			)[id] ?? 'a7',
		);
	return {
		persistenceFormat: 2,
		id: 'crossing-aware-junctions',
		title: 'Crossing-aware junctions',
		layout,
		natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
		groups: [],
		nodes: ['source-a', 'source-b', 'source-c', 'successor'].map((id) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'goal',
			markdown: id,
			layoutOrder: keyFor(id),
		})),
		junctions: ['junction-a', 'junction-b', 'junction-c'].map((id) => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: keyFor(id),
		})),
		relations: [
			{ id: 'a', from: 'source-a', to: 'junction-a' },
			{ id: 'b', from: 'source-b', to: 'junction-b' },
			{ id: 'a-out', from: 'junction-a', to: 'successor' },
			{ id: 'b-out', from: 'junction-b', to: 'successor' },
			{ id: 'c-out', from: 'junction-c', to: 'successor' },
		],
	};
}

describe.each(LAYOUT_CONFIGURATIONS)(
	'cross-axis order with $direction and $bias bias',
	(layout) => {
		it('keeps append order and applies only the qualifying target move', async () => {
			const projected = projectRelationAddition(
				crossingAwareDirectionScenario(layout),
				{
					id: 'source-a-to-target-b',
					from: 'source-a',
					to: 'target-b',
				},
				fractionalOrderKeySpace,
			);
			expect(projected.ok).toBe(true);
			if (!projected.ok) throw new Error('Expected a valid relation projection');

			const { layout: result } = await layoutDocument(projected.value.document);
			const coordinate = (id: string) =>
				crossAxisCoordinate(layout.direction, boundsFor(result, id));

			expect(coordinate('target-b')).toBeLessThan(coordinate('target-a'));
			expect(coordinate('established-isolated')).toBeLessThan(coordinate('zz-added-first'));
			expect(coordinate('zz-added-first')).toBeLessThan(coordinate('aa-added-second'));
		});

		it('renders a same-rank junction target in its crossing-aware order', async () => {
			const projected = projectRelationAddition(
				crossingAwareJunctionScenario(layout),
				{ id: 'c', from: 'source-c', to: 'junction-c' },
				fractionalOrderKeySpace,
			);
			expect(projected.ok).toBe(true);
			if (!projected.ok) throw new Error('Expected junction projection to succeed');
			expect(projected.value.moved).toBe(true);

			const { layout: result } = await layoutDocument(projected.value.document);
			const coordinate = (id: string) =>
				crossAxisCoordinate(layout.direction, boundsFor(result, id));
			expect(coordinate('junction-a')).toBeLessThan(coordinate('junction-b'));
			expect(coordinate('junction-b')).toBeLessThan(coordinate('junction-c'));
		});
	},
);

describe.each(LAYOUT_CONFIGURATIONS)(
	'rank-band edge alignment with $direction and $bias bias',
	(configuration) => {
		it('aligns different-sized ordinary nodes to the selected physical edge', async () => {
			const document = crossingAwareDirectionScenario(configuration);
			const { layout } = await layoutDocument(document, {
				nodes: {
					'source-b': { width: 140, height: 60 },
					'target-b': { width: 260, height: 140 },
				},
			});
			const sourceB = boundsFor(layout, 'source-b');
			const targetB = boundsFor(layout, 'target-b');

			expect(coordinateAt(sourceB, configuration.bias)).toBe(
				coordinateAt(targetB, configuration.bias),
			);
		});
	},
);

describe.each(LAYOUT_CONFIGURATIONS)(
	'terminal junction integration with $direction and $bias bias',
	(configuration) => {
		it('keeps an oversized terminal junction disjoint and routes forward', async () => {
			const { layout } = await layoutDocument(terminalJunctionScenario(configuration), {
				nodes: { source: { width: 80, height: 40 } },
				junctions: { 'terminal-junction': { width: 108, height: 108 } },
			});
			const source = boundsFor(layout, 'source');
			const junction = boundsFor(layout, 'terminal-junction');
			const relation = layout.relations.find(({ id }) => id === 'source-to-terminal-junction');
			if (!relation) throw new Error('Expected terminal junction relation');

			expect(overlaps(source, junction)).toBe(false);
			expect(progressesFromTo(source, junction, configuration.direction)).toBe(true);
			expect(relation.points).toHaveLength(4);
			expect(
				relation.points.slice(1).every((point, index) => {
					const previous = relation.points[index];
					if (previous === undefined) throw new Error(`Missing routed point ${index}`);
					return previous.x === point.x || previous.y === point.y;
				}),
			).toBe(true);
			const firstPoint = relation.points[0];
			const lastPoint = relation.points.at(-1);
			if (firstPoint === undefined || lastPoint === undefined)
				throw new Error('Missing boundary points');
			expect(touchesBoundary(firstPoint, source)).toBe(true);
			expect(touchesBoundary(lastPoint, junction)).toBe(true);
		});
	},
);

describe.each(LAYOUT_CONFIGURATIONS)(
	'aligns variable-size boxes within a rank toward $bias with $direction orientation',
	(configuration) => {
		it('uses the biased edge instead of centering boxes in the rank band', async () => {
			const base = validLogicDocument();
			const document = { ...base, layout: configuration };
			const layout = (
				await layoutDocument(document, {
					nodes: {
						'source-a': { width: 140, height: 52 },
						'source-b': { width: 220, height: 116 },
					},
				})
			).layout;

			expect(coordinateAt(boundsFor(layout, 'source-a'), configuration.bias)).toBe(
				coordinateAt(boundsFor(layout, 'source-b'), configuration.bias),
			);
		});
	},
);

describe.each(LAYOUT_CONTEXTS)('layout bias in %s', (context) => {
	it.each(LAYOUT_CONFIGURATIONS)(
		'aligns global ranks toward $bias with $direction orientation',
		async (configuration) => {
			const fixture = await layoutDocument(layoutBiasScenario(configuration, context));
			const { layout } = fixture;

			for (const [sourceId, targetId] of [...LONG_BRANCH_RELATIONS, ...SHORT_BRANCH_RELATIONS]) {
				expect
					.soft(
						progressesFromTo(
							boundsFor(layout, sourceId),
							boundsFor(layout, targetId),
							configuration.direction,
						),
						`${sourceId} -> ${targetId} must progress ${configuration.direction}`,
					)
					.toBe(true);
			}

			for (const ids of [
				['long-0', 'short-0', 'isolated'],
				['long-1', 'short-1'],
			]) {
				const biasedCoordinate = coordinateAt(boundsFor(layout, ids[0] ?? ''), configuration.bias);
				expect(ids.map((id) => coordinateAt(boundsFor(layout, id), configuration.bias))).toEqual(
					ids.map(() => biasedCoordinate),
				);
			}

			for (let leftIndex = 0; leftIndex < ALL_NODES.length; leftIndex += 1) {
				for (let rightIndex = leftIndex + 1; rightIndex < ALL_NODES.length; rightIndex += 1) {
					const leftId = ALL_NODES[leftIndex];
					const rightId = ALL_NODES[rightIndex];
					if (leftId === undefined || rightId === undefined) throw new Error('Missing node id');
					expect
						.soft(
							overlaps(boundsFor(layout, leftId), boundsFor(layout, rightId)),
							`${leftId} and ${rightId} must not overlap`,
						)
						.toBe(false);
				}
			}

			const nodesEnvelope = envelopeFor(layout, ALL_NODES);
			if (context === 'root') {
				expect
					.soft(contains({ x: 0, y: 0, width: layout.width, height: layout.height }, nodesEnvelope))
					.toBe(true);
				return;
			}

			let immediateContainerId = 'nested-container';
			if (context === 'group') immediateContainerId = 'container';
			const immediateContainer = boundsFor(layout, immediateContainerId);
			expect.soft(contains(immediateContainer, nodesEnvelope)).toBe(true);
			if (context === 'subgroup') {
				expect.soft(contains(boundsFor(layout, 'container'), immediateContainer)).toBe(true);
			}
		},
	);
});
