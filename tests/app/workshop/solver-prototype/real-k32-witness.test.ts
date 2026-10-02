import { describe, expect, it } from 'vitest';

import {
	type K32TargetOrder,
	type K32Variant,
	realK32Fixture,
	runRealK32Witness,
} from '../../../../src/app/workshop/solver-prototype/real-k32-witness';
import {
	EndpointKind,
	GroupState,
	JunctionOperator,
	LAYOUT_DIRECTIONS,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { scenario } from '../../../scenarios/visual/routing/three-incoming-ports.scenario';
import { routeCrossings } from '../../../support/assertions/route-geometry';

function normalizedCrossings(
	crossings: readonly {
		readonly horizontalId: string;
		readonly verticalId: string;
		readonly x: number;
		readonly y: number;
	}[],
): readonly string[] {
	return crossings
		.map(({ horizontalId, verticalId, x, y }) =>
			JSON.stringify([[horizontalId, verticalId].sort(), x, y]),
		)
		.sort();
}

function expectedTargetOrder(order: K32TargetOrder): readonly string[] {
	if (order === 'd-e') return ['d', 'e'];
	return ['e', 'd'];
}

describe('real K3,2 pipeline witness', () => {
	it('defaults to the sparse d-e target order through the real pipeline', async () => {
		const direction = LayoutDirection.TopToBottom;
		const fixture = realK32Fixture(direction);
		expect(fixture.document.relations.map(({ id }) => id)).toEqual([
			'a-to-d',
			'a-to-e',
			'b-to-d',
			'c-to-d',
		]);
		const witness = await runRealK32Witness(direction);
		expect(witness.summary.targetOrder).toEqual(['d', 'e']);
		expect(witness.summary.variant).toBe('sparse');
		expect(witness.summary.sourceOrder).toEqual(['a', 'b', 'c']);
		expect(witness.summary.observedSourceOrder).toEqual(witness.summary.sourceOrder);
		expect(witness.summary.observedTargetOrder).toEqual(['e', 'd']);
		expect(witness.summary.conditionalConflicts?.inversions).toEqual([]);
		expect(witness.summary.crossings).toEqual([]);
		expect(witness.summary.assessment).toBe('confirmed');
	});

	it.each(LAYOUT_DIRECTIONS)('matches the complete visual scenario in %s', async (direction) => {
		const witness = await runRealK32Witness(direction, 'd-e', 'complete');
		const actualScenario = await scenario.arrange(direction);
		expect(witness.layout).toEqual({
			width: actualScenario.width,
			height: actualScenario.height,
			elements: actualScenario.elements,
			relations: actualScenario.relations,
			routingInspection: actualScenario.routingInspection,
		});
		expect(witness.summary.ranks).toEqual([
			{ id: 'a', rank: 1 },
			{ id: 'b', rank: 1 },
			{ id: 'c', rank: 1 },
			{ id: 'd', rank: 0 },
			{ id: 'e', rank: 0 },
		]);
		expect(witness.summary.sourceOrder).toEqual(['a', 'b', 'c']);
		expect(witness.summary.targetOrder).toEqual(['d', 'e']);
		expect(witness.summary.observedSourceOrder).toEqual(witness.summary.sourceOrder);
		expect(witness.summary.observedTargetOrder).toEqual(witness.summary.targetOrder);
		expect(witness.summary.assessment).toBe('confirmed');
		expect(witness.summary.diagnostics).toEqual([]);
		expect(witness.summary.conditionalConflicts?.requiredSeparations).toHaveLength(6);
		for (const target of witness.summary.targets) {
			expect(target.intrinsicCrossSize).toBe(80);
			expect(target.allocatedCrossSize).toBe(144);
			expect(target.incomingPorts).toHaveLength(3);
			expect(target.incomingPorts.every(({ relationIds }) => relationIds.length === 1)).toBe(true);
		}
		expect(witness.summary.crossings.length).toBeGreaterThan(0);
		expect(
			witness.summary.crossings
				.map(({ firstRelationId, secondRelationId, point }) =>
					JSON.stringify([[firstRelationId, secondRelationId].sort(), point.x, point.y]),
				)
				.sort(),
		).toEqual(normalizedCrossings(routeCrossings(witness.layout.relations)));
	});

	it.each(
		LAYOUT_DIRECTIONS.flatMap((direction) =>
			(['d-e', 'e-d'] as const).map((order) => ({ direction, order })),
		),
	)(
		'fixed sparse $direction, $order observes branch-meets-convergence separation without a fabricated position',
		async ({ direction, order }: { direction: LayoutDirection; order: K32TargetOrder }) => {
			const witness = await runRealK32Witness(
				direction,
				order,
				'sparse',
				realK32Fixture(direction, order),
				'documentary',
			);
			const d = witness.summary.targets.find(({ id }) => id === 'd');
			const e = witness.summary.targets.find(({ id }) => id === 'e');
			expect(witness.summary.assessment).toBe('confirmed');
			expect(witness.summary.sourceOrder).toEqual(['a', 'b', 'c']);
			expect(witness.summary.targetOrder).toEqual(expectedTargetOrder(order));
			expect(d?.intrinsicCrossSize).toBe(80);
			expect(e?.intrinsicCrossSize).toBe(80);
			expect(e?.incomingPorts).toHaveLength(1);
			if (order === 'd-e') {
				expect(d?.incomingPorts).toHaveLength(3);
				expect(d?.allocatedCrossSize).toBe(144);
				expect(witness.summary.conditionalConflicts?.requiredSeparations).toHaveLength(3);
				expect(witness.summary.crossings.length).toBeGreaterThan(0);
			} else {
				expect(d?.incomingPorts).toHaveLength(3);
				expect(d?.allocatedCrossSize).toBe(144);
				expect(witness.summary.conditionalConflicts?.requiredSeparations).toHaveLength(0);
				expect(witness.summary.crossings).toEqual([]);
			}
		},
	);

	it.each(
		LAYOUT_DIRECTIONS.flatMap((direction) =>
			(['d-e', 'e-d'] as const).flatMap((order) =>
				(['sparse', 'complete'] as const).map((variant) => ({ direction, order, variant })),
			),
		),
	)(
		'normalizes collection permutations for $direction, $order',
		async ({
			direction,
			order,
			variant,
		}: {
			direction: LayoutDirection;
			order: K32TargetOrder;
			variant: K32Variant;
		}) => {
			const fixture = realK32Fixture(direction, order, variant);
			const original = await runRealK32Witness(direction, order, variant, fixture);
			const permuted = await runRealK32Witness(direction, order, variant, {
				...fixture,
				document: {
					...fixture.document,
					nodes: fixture.document.nodes.toReversed(),
					relations: fixture.document.relations.toReversed(),
				},
			});
			expect(permuted.summary).toEqual(original.summary);
			expect(original.summary.targetOrder).toEqual(expectedTargetOrder(order));
			expect(original.summary.assessment).toBe('confirmed');
		},
	);

	it('keeps an incomplete topology unproven instead of asserting conflicts', async () => {
		const direction = LAYOUT_DIRECTIONS[0];
		if (direction === undefined) throw new Error('Missing layout direction');
		const fixture = realK32Fixture(direction);
		const witness = await runRealK32Witness(direction, 'd-e', 'sparse', {
			...fixture,
			document: { ...fixture.document, relations: fixture.document.relations.slice(1) },
		});
		expect(witness.summary.assessment).toBe('unproven');
		expect(witness.summary.conditionalConflicts).toBeUndefined();
		expect(witness.summary.diagnostics).toContain(
			'Le graphe ne forme pas la variante sparse attendue.',
		);
	});

	it('does not infer ranks or ports from an empty relation set', async () => {
		const direction = LayoutDirection.TopToBottom;
		const fixture = realK32Fixture(direction);
		const witness = await runRealK32Witness(direction, 'd-e', 'sparse', {
			...fixture,
			document: { ...fixture.document, relations: [] },
		});
		expect(witness.summary.sourceOrder).toEqual([]);
		expect(witness.summary.targetOrder).toEqual([]);
		expect(witness.summary.conditionalConflicts).toBeUndefined();
		expect(witness.summary.assessment).toBe('unproven');
		expect(witness.summary.diagnostics).toContain(
			'Les deux rangs source et cible ne sont pas adjacents.',
		);
	});

	it('keeps a valid but nonuniform rank graph unproven', async () => {
		const direction = LayoutDirection.TopToBottom;
		const fixture = realK32Fixture(direction);
		const relations = fixture.document.relations.map((relation) => {
			if (relation.id === 'c-to-d') return { ...relation, from: 'd', to: 'c' };
			return relation;
		});
		const witness = await runRealK32Witness(direction, 'd-e', 'sparse', {
			...fixture,
			document: { ...fixture.document, relations },
		});
		expect(witness.summary.assessment).toBe('unproven');
		expect(witness.summary.conditionalConflicts).toBeUndefined();
		expect(witness.summary.diagnostics).toContain(
			'Les deux rangs source et cible ne sont pas adjacents.',
		);
	});

	it('reports a requested direction different from the source document', async () => {
		const fixture = realK32Fixture(LayoutDirection.TopToBottom);
		const witness = await runRealK32Witness(LayoutDirection.BottomToTop, 'd-e', 'sparse', fixture);
		expect(witness.summary.assessment).toBe('unproven');
		expect(witness.summary.diagnostics).toContain('Direction du document différente.');
		expect(witness.summary.conditionalConflicts).toBeUndefined();
	});

	it('withholds the ordinary-corridor inference when a group joins the document', async () => {
		const direction = LayoutDirection.TopToBottom;
		const fixture = realK32Fixture(direction);
		const witness = await runRealK32Witness(direction, 'd-e', 'sparse', {
			document: {
				...fixture.document,
				groups: [
					{
						id: 'G',
						kind: EndpointKind.Group,
						label: 'G',
						state: GroupState.Expanded,
						layoutOrder: orderKey('a5'),
					},
				],
			},
			measurements: {
				...fixture.measurements,
				groups: new Map([
					['G', { minimumWidth: 120, minimumHeight: 90, headerHeight: 32, padding: 16 }],
				]),
			},
		});
		expect(witness.summary.assessment).toBe('unproven');
		expect(witness.summary.conditionalConflicts).toBeUndefined();
		expect(witness.summary.diagnostics).toContain(
			'Attaches de groupe ou de jonction hors du témoin K3,2.',
		);
	});

	it('withholds the ordinary-corridor inference when an isolated junction joins the document', async () => {
		const direction = LayoutDirection.TopToBottom;
		const fixture = realK32Fixture(direction);
		const witness = await runRealK32Witness(direction, 'd-e', 'sparse', {
			document: {
				...fixture.document,
				junctions: [
					{
						id: 'J',
						kind: EndpointKind.Junction,
						operator: JunctionOperator.Xor,
						layoutOrder: orderKey('a5'),
					},
				],
			},
			measurements: {
				...fixture.measurements,
				junctions: new Map([['J', { width: 12, height: 12 }]]),
			},
		});
		expect(witness.summary.assessment).toBe('unproven');
		expect(witness.summary.conditionalConflicts).toBeUndefined();
		expect(witness.summary.diagnostics).toContain(
			'Attaches de groupe ou de jonction hors du témoin K3,2.',
		);
	});

	it('rejects a cyclic source before attempting layout', async () => {
		const direction = LayoutDirection.TopToBottom;
		const fixture = realK32Fixture(direction);
		await expect(
			runRealK32Witness(direction, 'd-e', 'sparse', {
				...fixture,
				document: {
					...fixture.document,
					relations: [...fixture.document.relations, { id: 'd-to-a', from: 'd', to: 'a' }],
				},
			}),
		).rejects.toThrow();
	});
});
