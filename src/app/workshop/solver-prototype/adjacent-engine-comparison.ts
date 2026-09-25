import {
	defined,
	LayoutDirection,
	type LogicDocument,
} from '../../../lib/core/document/logic-document';
import { createGraph, type LogicGraph } from '../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../lib/core/graph/topological-ranks';
import { routeBridgeAnalysis } from '../../../lib/core/layout/bridge-oracle';
import { candidateFaceBranches } from '../../../lib/core/layout/contract/candidate-face-branches';
import {
	type IndependentAdjacentComparison,
	type IndependentAdjacentGlobalStatus,
	IndependentAdjacentIssue,
	type IndependentAdjacentResolution,
	IndependentAdjacentStatus,
	resolveIndependentAdjacentContract,
} from '../../../lib/core/layout/contract/independent-adjacent-resolution';
import {
	buildAdjacentLayoutContract,
	LayoutContractBuildStatus,
} from '../../../lib/core/layout/contract/layout-contract';
import { validateContractCandidate } from '../../../lib/core/layout/contract/validate-candidate';
import type {
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
} from '../../../lib/core/layout/layout-types';
import { renderRelationPaths } from '../../web/ui/canvas/render-relations';
import { realK32Fixture, runRealK32Witness } from './real-k32-witness';

interface AdjacentComparisonMetrics {
	readonly area: number;
	/** Total allocated node extent beyond intrinsic measurements, including source-face growth. */
	readonly growth: number;
	readonly routeLength: number;
	readonly bends: number;
	readonly crossings: number;
	/** SVG arcs produced by the same renderer as the canvas. */
	readonly bridges: number;
}

interface AdjacentComparisonPanel {
	readonly layout: LayoutResult;
	readonly metrics: AdjacentComparisonMetrics;
	readonly targetOrder: string;
	readonly validation: 'valid';
}

interface IndependentComparisonPanel extends AdjacentComparisonPanel {
	readonly candidateId: string;
	readonly selectedIssue: IndependentAdjacentIssue;
	readonly comparison?: IndependentAdjacentComparison | undefined;
}

interface AdjacentTwoByTwoComparison {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly ranks: ReadonlyMap<string, number>;
	readonly frame: { readonly width: number; readonly height: number };
	readonly independent: IndependentComparisonPanel & {
		readonly comparison: IndependentAdjacentComparison;
	};
}

export interface AdjacentEngineComparison {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly ranks: ReadonlyMap<string, number>;
	readonly frame: { readonly width: number; readonly height: number };
	readonly dedicated: AdjacentComparisonPanel;
	readonly independent: IndependentComparisonPanel & {
		readonly globalStatus: IndependentAdjacentGlobalStatus.Undetermined;
	};
	readonly twoByTwo: AdjacentTwoByTwoComparison;
}

export function requireAdjacentGraph(document: LogicDocument, description: string): LogicGraph {
	const created = createGraph(document);
	if (!created.ok)
		throw new Error(
			`${description} could not be created: ${created.diagnostics.map(({ message }) => message).join('; ')}`,
		);
	return created.value;
}

export function requireSelectedAdjacentResolution(
	resolution: IndependentAdjacentResolution,
	description: string,
): Extract<IndependentAdjacentResolution, { status: IndependentAdjacentStatus.Selected }> {
	if (resolution.status !== IndependentAdjacentStatus.Selected)
		throw new Error(`${description} is ${resolution.status}.`);
	return resolution;
}

function assertBridgeMarkMatchesSelection(
	renderedBridgeCount: number,
	bridged: boolean,
	description: string,
): void {
	if (renderedBridgeCount > 0 !== bridged)
		throw new Error(`${description} bridge mark differs from the selected issue.`);
}

function routeMetrics(routes: readonly LayoutRelation[]): { routeLength: number; bends: number } {
	let routeLength = 0;
	let bends = 0;
	for (const route of routes) {
		let previousAxis: 'x' | 'y' | undefined;
		for (let index = 1; index < route.points.length; index += 1) {
			const before = defined(route.points[index - 1]);
			const after = defined(route.points[index]);
			const dx = Math.abs(after.x - before.x);
			const dy = Math.abs(after.y - before.y);
			routeLength += dx + dy;
			if (dx === 0 && dy === 0) continue;
			let axis: 'x' | 'y' = 'y';
			if (dx > 0) axis = 'x';
			if (previousAxis !== undefined && previousAxis !== axis) bends += 1;
			previousAxis = axis;
		}
	}
	return { routeLength, bends };
}

function growth(layout: LayoutResult, measurements: LayoutMeasurements): number {
	return layout.elements.reduce((total, element) => {
		const measured = defined(measurements.nodes.get(element.id));
		return (
			total +
			Math.max(0, element.bounds.width - measured.width) +
			Math.max(0, element.bounds.height - measured.height)
		);
	}, 0);
}

function renderedBridgeCount(layout: LayoutResult): number {
	return renderRelationPaths(layout.relations).reduce(
		(total, relation) => total + (relation.path.match(/\bA /g)?.length ?? 0),
		0,
	);
}

function targetOrder(layout: LayoutResult): string {
	const targets = ['d', 'e'].map((id) => {
		const bounds = defined(layout.elements.find((element) => element.id === id)).bounds;
		return { id, center: bounds.x + bounds.width / 2 };
	});
	return targets
		.toSorted((a, b) => a.center - b.center)
		.map(({ id }) => id)
		.join(' < ');
}

function panel(layout: LayoutResult, measurements: LayoutMeasurements): AdjacentComparisonPanel {
	return {
		layout,
		targetOrder: targetOrder(layout),
		validation: 'valid',
		metrics: {
			area: layout.width * layout.height,
			growth: growth(layout, measurements),
			...routeMetrics(layout.relations),
			crossings: routeBridgeAnalysis(layout.relations).crossings.length,
			bridges: renderedBridgeCount(layout),
		},
	};
}

function twoByTwoDocument(source: LogicDocument): LogicDocument {
	return {
		...source,
		id: 'adjacent-2+2-bridge-witness',
		title: 'Adjacent 2+2 bridge witness',
		relations: [
			{ id: 'a-to-d', from: 'a', to: 'd' },
			{ id: 'b-to-d', from: 'b', to: 'd' },
			{ id: 'a-to-e', from: 'a', to: 'e' },
			{ id: 'c-to-e', from: 'c', to: 'e' },
		],
	};
}

function uniformMeasurements(
	measurements: LayoutMeasurements,
	width: number,
	height: number,
): LayoutMeasurements {
	return {
		...measurements,
		nodes: new Map([...measurements.nodes.keys()].map((id) => [id, { width, height }])),
	};
}

function sameRanks(
	first: ReadonlyMap<string, number>,
	second: ReadonlyMap<string, number>,
): boolean {
	return first.size === second.size && [...first].every(([id, rank]) => second.get(id) === rank);
}

function geometricallyValidUnderAdjacentContract(
	graph: LogicGraph,
	ranks: ReturnType<typeof topologicallyRank>,
	measurements: LayoutMeasurements,
	layout: LayoutResult,
): boolean {
	const built = buildAdjacentLayoutContract(graph, ranks, measurements);
	if (built.status !== LayoutContractBuildStatus.Ready) return false;
	return built.contract.candidates.some((candidate) =>
		candidateFaceBranches(candidate).some(
			(branch) =>
				validateContractCandidate({
					graph,
					candidate,
					choices: branch.choices,
					measurements,
					layout,
				}).valid,
		),
	);
}

/** Compares the real 3+1 engine witness and an independent 2+2 bridge witness. */
export async function compareAdjacentBridgeAndDetour(): Promise<AdjacentEngineComparison> {
	const direction = LayoutDirection.TopToBottom;
	const fixture = realK32Fixture(direction, 'd-e', 'sparse');
	const graph = requireAdjacentGraph(fixture.document, 'The adjacent comparison document');
	const ranked = topologicallyRank(graph);
	const dedicated = await runRealK32Witness(direction, 'd-e', 'sparse', fixture);
	const resolution = resolveIndependentAdjacentContract(graph, ranked, fixture.measurements);
	const selectedResolution = requireSelectedAdjacentResolution(
		resolution,
		'Independent adjacent comparison',
	);
	if (dedicated.summary.assessment !== 'confirmed')
		throw new Error(
			`Dedicated adjacent witness is unproven: ${dedicated.summary.diagnostics.join('; ')}`,
		);
	if (!sameRanks(dedicated.ranks, ranked.byEndpointId))
		throw new Error('Dedicated and independent adjacent ranks differ.');
	if (
		!geometricallyValidUnderAdjacentContract(
			graph,
			ranked,
			fixture.measurements,
			dedicated.layout,
		) ||
		!geometricallyValidUnderAdjacentContract(
			graph,
			ranked,
			fixture.measurements,
			selectedResolution.selection.layout,
		)
	)
		throw new Error('An adjacent comparison layout failed its geometric contract.');
	const twoByTwoSource = twoByTwoDocument(fixture.document);
	const twoByTwoMeasurements = uniformMeasurements(fixture.measurements, 96, 400);
	const twoByTwoGraph = requireAdjacentGraph(
		twoByTwoSource,
		'The adjacent 2+2 comparison document',
	);
	const twoByTwoRanks = topologicallyRank(twoByTwoGraph);
	const twoByTwoResolution = requireSelectedAdjacentResolution(
		resolveIndependentAdjacentContract(twoByTwoGraph, twoByTwoRanks, twoByTwoMeasurements),
		'Independent adjacent 2+2 comparison',
	);
	const twoByTwoComparison = defined(
		twoByTwoResolution.comparison,
		'The adjacent 2+2 comparison did not produce both issue costs.',
	);
	const enginePanel = panel(dedicated.layout, fixture.measurements);
	const independentPanel = panel(selectedResolution.selection.layout, fixture.measurements);
	if (enginePanel.metrics.crossings === 0 || enginePanel.metrics.bridges === 0)
		throw new Error('The dedicated adjacent witness has no rendered bridge.');
	assertBridgeMarkMatchesSelection(
		independentPanel.metrics.bridges,
		selectedResolution.selection.bridged,
		'The independent adjacent',
	);
	const twoByTwoPanel = panel(twoByTwoResolution.selection.layout, twoByTwoMeasurements);
	assertBridgeMarkMatchesSelection(
		twoByTwoPanel.metrics.bridges,
		twoByTwoResolution.selection.bridged,
		'The adjacent 2+2',
	);
	let selectedIssue = IndependentAdjacentIssue.Detour;
	if (selectedResolution.selection.bridged) selectedIssue = IndependentAdjacentIssue.Bridge;
	return {
		document: fixture.document,
		measurements: fixture.measurements,
		ranks: ranked.byEndpointId,
		frame: {
			width: Math.max(enginePanel.layout.width, independentPanel.layout.width),
			height: Math.max(enginePanel.layout.height, independentPanel.layout.height),
		},
		dedicated: enginePanel,
		independent: {
			...independentPanel,
			candidateId: selectedResolution.selection.candidateId,
			globalStatus: selectedResolution.globalStatus,
			selectedIssue,
			comparison: selectedResolution.comparison,
		},
		twoByTwo: {
			document: twoByTwoSource,
			measurements: twoByTwoMeasurements,
			ranks: twoByTwoRanks.byEndpointId,
			frame: { width: twoByTwoPanel.layout.width, height: twoByTwoPanel.layout.height },
			independent: {
				...twoByTwoPanel,
				candidateId: twoByTwoResolution.selection.candidateId,
				selectedIssue: twoByTwoComparison.selected,
				comparison: twoByTwoComparison,
			},
		},
	};
}
