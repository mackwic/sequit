import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { PORT_INSET, PORT_SPACING } from '../layout-settings';
import type { LayoutMeasurements, Size } from '../layout-types';
import type { LayoutContractCandidate } from './layout-contract';
import type { CandidateFaceChoice } from './validate-candidate';

export interface AdjacentAxes {
	readonly crossSize: number;
	readonly flowSize: number;
}

function intrinsicAxes(size: Size, vertical: boolean): AdjacentAxes {
	if (vertical) return { crossSize: size.width, flowSize: size.height };
	return { crossSize: size.height, flowSize: size.width };
}

function outgoingCrossSize(
	graph: LogicGraph,
	id: string,
	intrinsic: number,
	demand: LayoutContractCandidate['sourceFaceDemands'][number] | undefined,
): number {
	if (demand !== undefined) return Math.max(intrinsic, demand.minimumCrossSize);
	const degree = graph.relations.filter(({ relation }) => relation.from === id).length;
	const faceInsets = 2 * PORT_INSET;
	const portSpan = (degree - 1) * PORT_SPACING;
	return Math.max(intrinsic, faceInsets + portSpan);
}

/** Apply published face demands without changing the intrinsic measurements. */
export function measuredAdjacentAxes(input: {
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
	readonly candidate: LayoutContractCandidate;
	readonly chosen: ReadonlyMap<string, CandidateFaceChoice>;
	readonly vertical: boolean;
}): ReadonlyMap<string, AdjacentAxes> | undefined {
	const { graph, measurements, candidate, chosen, vertical } = input;
	const axes = new Map<string, AdjacentAxes>();
	const sourceDemands = new Map(
		candidate.sourceFaceDemands.map((demand) => [demand.endpointId, demand]),
	);
	for (const id of [...candidate.sourceOrder, ...candidate.targetOrder]) {
		const intrinsic = measurements.nodes.get(id);
		if (intrinsic === undefined) return undefined;
		const measured = intrinsicAxes(intrinsic, vertical);
		let crossSize = measured.crossSize;
		if (candidate.sourceOrder.includes(id)) {
			const demand = sourceDemands.get(id);
			if (candidate.sourceFaceDemands.length > 0 && demand === undefined) return undefined;
			crossSize = outgoingCrossSize(graph, id, crossSize, demand);
		} else crossSize = Math.max(crossSize, defined(chosen.get(id)).metricDemand.minimumCrossSize);
		axes.set(id, { crossSize, flowSize: measured.flowSize });
	}
	return axes;
}
