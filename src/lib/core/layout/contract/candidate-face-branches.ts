import { defined } from '../../document/logic-document';
import type { LayoutContractCandidate, PortAlternative } from './layout-contract';
import type { CandidateFaceChoice } from './validate-candidate';

export interface CandidateFaceBranch {
	readonly id: string;
	readonly candidate: LayoutContractCandidate;
	readonly choices: readonly CandidateFaceChoice[];
	/** Total added endpoint extent, including shared source-face demands. */
	readonly totalGrowth: number;
	/** Target-face differential used to describe what changes between alternatives. */
	readonly differentialGrowth: number;
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
	const sourceGrowth = candidate.sourceFaceDemands.reduce(
		(total, demand) => total + demand.growth,
		0,
	);
	return first.flatMap((a) =>
		second.map((b) => ({
			candidate,
			choices: [a, b],
			id: JSON.stringify([candidate.id, [a.physicalPortGroups, b.physicalPortGroups]]),
			totalGrowth: sourceGrowth + a.metricDemand.growth + b.metricDemand.growth,
			differentialGrowth: a.metricDemand.growth + b.metricDemand.growth,
		})),
	);
}
