import { describe, expect, it } from 'vitest';

import {
	type JointK32Input,
	solveJointK32Contract,
} from '../../../../src/app/workshop/solver-prototype/joint-k32-contract';
import {
	type K32TargetOrder,
	type K32Variant,
	realK32Fixture,
	runRealK32Witness,
} from '../../../../src/app/workshop/solver-prototype/real-k32-witness';
import {
	LAYOUT_DIRECTIONS,
	type LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { PORT_INSET, PORT_SPACING } from '../../../../src/lib/core/layout/layout-settings';

function candidateInput(
	direction: LayoutDirection,
	order: K32TargetOrder,
	variant: K32Variant,
	ranks: ReadonlyMap<string, number>,
): JointK32Input {
	const fixture = realK32Fixture(direction, order, variant);
	let targetOrder = ['d', 'e'];
	if (order === 'e-d') targetOrder = ['e', 'd'];
	const sourceRank = ranks.get('a');
	const targetRank = ranks.get('d');
	if (sourceRank === undefined || targetRank === undefined)
		throw new Error('The real witness must rank its sources and targets.');
	return {
		sourceIds: ['a', 'b', 'c'],
		targetIds: ['d', 'e'],
		relations: fixture.document.relations,
		faceMetrics: ['d', 'e'].map((endpointId) => ({
			endpointId,
			intrinsicCrossSize: 80,
			inset: PORT_INSET,
			spacing: PORT_SPACING,
		})),
		candidates: [
			{
				id: 'observed-order',
				sourceRank,
				targetRank,
				sourceOrder: ['a', 'b', 'c'],
				targetOrder,
				passage: 'monotone-adjacent-corridor',
			},
		],
	};
}

describe('joint symbolic contract versus real materialization', () => {
	it.each(
		LAYOUT_DIRECTIONS.flatMap((direction) =>
			(['d-e', 'e-d'] as const).flatMap((order) =>
				(['sparse', 'complete'] as const).map((variant) => ({
					direction,
					order,
					variant,
				})),
			),
		),
	)(
		'contains a branch realized by the real pipeline in $direction, $order, $variant',
		async ({ direction, order, variant }) => {
			const witness = await runRealK32Witness(direction, order, variant);
			expect(witness.summary.assessment).toBe('confirmed');
			const contract = solveJointK32Contract(
				candidateInput(direction, order, variant, witness.ranks),
			);
			expect(contract.searchStatus).toBe('complete');
			const realized = contract.branches.filter((branch) =>
				witness.summary.targets.every((target) => {
					const face = branch.faces.find(({ endpointId }) => endpointId === target.id);
					return (
						face !== undefined &&
						JSON.stringify(face.physicalPortGroups) ===
							JSON.stringify(target.incomingPorts.map(({ relationIds }) => relationIds)) &&
						face.minimumCrossSize === target.allocatedCrossSize
					);
				}),
			);
			expect(realized.length).toBeGreaterThan(0);
			expect(realized.map(({ id }) => id)).toContain(contract.incumbent?.id);
			expect(contract.globalStatus).toBe('undetermined');
		},
	);
});
