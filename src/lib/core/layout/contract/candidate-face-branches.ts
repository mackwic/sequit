import { defined } from '../../document/logic-document';
import type { LayoutContractCandidate, PortAlternative } from './layout-contract';
import type { CandidateFaceChoice } from './validate-candidate';

export interface CandidateFaceBranch {
	readonly id: string;
	readonly candidate: LayoutContractCandidate;
	readonly choices: readonly CandidateFaceChoice[];
	readonly growth: number;
}

function faceChoices(
	face: LayoutContractCandidate['faces'][number],
): readonly CandidateFaceChoice[] {
	return face.alternatives.flatMap((alternative: PortAlternative) => {
		if (!alternative.respectsRequiredSeparations) return [];
		return alternative.physicalOrders.map((physicalPortGroups) => ({
			endpointId: face.endpointId,
			physicalPortGroups,
			metricDemand: alternative.metricDemand,
		}));
	});
}

/** Canonical branch identities and order are shared by both adjacent solvers. */
export function candidateFaceBranches(
	candidate: LayoutContractCandidate,
): readonly CandidateFaceBranch[] {
	const first = faceChoices(defined(candidate.faces[0]));
	const second = faceChoices(defined(candidate.faces[1]));
	return first.flatMap((a) =>
		second.map((b) => ({
			candidate,
			choices: [a, b],
			id: JSON.stringify([candidate.id, [a.physicalPortGroups, b.physicalPortGroups]]),
			growth: a.metricDemand.growth + b.metricDemand.growth,
		})),
	);
}
