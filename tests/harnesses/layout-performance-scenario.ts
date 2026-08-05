import { validateLogicDocument } from '../../src/lib/document/validate-logic-document';
import { layoutGraph, type LayoutResult } from '../../src/lib/layout/layout-graph';
import { prepareLayoutPerformanceScenario } from '../scenarios/layout-performance/prepare-layout-performance-scenario';
import type {
	NamedLayoutPerformanceScenario,
	PreparedLayoutPerformanceScenario,
} from '../scenarios/layout-performance/scenario-types';

export function buildPreparedScenarioTwice(
	scenario: NamedLayoutPerformanceScenario,
	nodeCount: number,
): readonly [PreparedLayoutPerformanceScenario, PreparedLayoutPerformanceScenario] {
	return [
		prepareLayoutPerformanceScenario(scenario, nodeCount),
		prepareLayoutPerformanceScenario(scenario, nodeCount),
	];
}

export function scenarioDocumentIsValid(prepared: PreparedLayoutPerformanceScenario): boolean {
	return validateLogicDocument(prepared.document).ok;
}

export async function layoutPreparedScenario(
	prepared: PreparedLayoutPerformanceScenario,
): Promise<LayoutResult> {
	return layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
}
