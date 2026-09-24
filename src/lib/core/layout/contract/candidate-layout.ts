import { defined } from '../../document/logic-document';
import { orderKey } from '../../document/order-key';
import type { LogicGraph } from '../../graph/create-graph';
import { topologicallyRank } from '../../graph/topological-ranks';
import { layoutWithDedicatedEngine } from '../layout-engine';
import type { LayoutMeasurements, LayoutResult } from '../layout-types';
import type { LayoutContractCandidate } from './layout-contract';

/** Materialize an order candidate with the current engine while the contract owns the choices. */
export function materializeContractCandidate(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	candidate: LayoutContractCandidate,
): LayoutResult | undefined {
	const orderedIds = [...candidate.targetOrder, ...candidate.sourceOrder];
	const keyById = new Map(orderedIds.map((id, index) => [id, orderKey(`a${index}`)]));
	const document = {
		...graph.document,
		nodes: graph.document.nodes.map((node) => ({
			...node,
			layoutOrder: defined(keyById.get(node.id)),
		})),
	};
	const orderedGraph: LogicGraph = { ...graph, document };
	try {
		return layoutWithDedicatedEngine(orderedGraph, topologicallyRank(orderedGraph), measurements);
	} catch {
		return undefined;
	}
}
