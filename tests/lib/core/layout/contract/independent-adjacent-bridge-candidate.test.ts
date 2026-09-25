import { describe, expect, it } from 'vitest';

import { realK32Fixture } from '../../../../../src/app/workshop/solver-prototype/real-k32-witness';
import { LayoutDirection } from '../../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../../src/lib/core/graph/topological-ranks';
import { unbridgedCrossings } from '../../../../../src/lib/core/layout/bridge-contact';
import { routeBridgeAnalysis } from '../../../../../src/lib/core/layout/bridge-oracle';
import { candidateFaceBranches } from '../../../../../src/lib/core/layout/contract/candidate-face-branches';
import { materializeIndependentAdjacentBridgeGeometry } from '../../../../../src/lib/core/layout/contract/independent-adjacent-geometry';
import {
	IndependentAdjacentBranchStatus,
	IndependentAdjacentStatus,
	resolveIndependentAdjacentContract,
} from '../../../../../src/lib/core/layout/contract/independent-adjacent-resolution';
import { validateContractCandidate } from '../../../../../src/lib/core/layout/contract/validate-candidate';

describe('independent adjacent compact bridge candidate', () => {
	it('materializes a real 3+1 bridge branch accepted by the contract and its oracle', () => {
		const fixture = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'sparse');
		const graph = createGraph(fixture.document);
		if (!graph.ok) throw new Error('Expected the real 3+1 fixture graph');
		const ranks = topologicallyRank(graph.value);
		const result = resolveIndependentAdjacentContract(graph.value, ranks, fixture.measurements);
		expect(result.status).toBe(IndependentAdjacentStatus.Selected);
		if (result.status !== IndependentAdjacentStatus.Selected) return;
		const acceptedBridge = result.evaluations.find(
			({ branchId, status }) =>
				branchId.endsWith(':bridge') && status === IndependentAdjacentBranchStatus.Accepted,
		);
		if (acceptedBridge === undefined) throw new Error('Expected an accepted compact bridge branch');
		const branch = result.contract.candidates
			.flatMap(candidateFaceBranches)
			.find(({ id }) => `${id}:bridge` === acceptedBridge.branchId);
		if (branch === undefined) throw new Error('Expected the accepted branch geometry');
		const layout = materializeIndependentAdjacentBridgeGeometry(
			graph.value,
			fixture.measurements,
			branch.candidate,
			branch.choices,
		);
		if (layout === undefined) throw new Error('Expected compact bridge geometry');
		expect(
			validateContractCandidate({
				graph: graph.value,
				measurements: fixture.measurements,
				candidate: branch.candidate,
				choices: branch.choices,
				layout,
			}),
		).toEqual({ valid: true });
		const analysis = routeBridgeAnalysis(layout.relations);
		expect(analysis.crossings.length).toBeGreaterThan(0);
		expect(unbridgedCrossings(analysis)).toEqual([]);
	});
});
