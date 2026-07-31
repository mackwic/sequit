import { prepareLayoutDocument } from '../../harnesses/layout';
import type {
	NamedLayoutPerformanceScenario,
	PreparedLayoutPerformanceScenario,
} from './scenario-types';

export function prepareLayoutPerformanceScenario(
	scenario: NamedLayoutPerformanceScenario,
	nodeCount: number,
): PreparedLayoutPerformanceScenario {
	const snapshot = scenario.createBuilder().buildSnapshot(nodeCount);
	const prepared = prepareLayoutDocument(snapshot.document);
	return {
		...snapshot,
		graph: prepared.graph,
		ranks: prepared.ranks,
		measurements: prepared.measurements,
	};
}
