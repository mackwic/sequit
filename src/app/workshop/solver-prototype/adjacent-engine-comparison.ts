import {
	defined,
	LayoutDirection,
	type LogicDocument,
} from '../../../lib/core/document/logic-document';
import { createGraph } from '../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../lib/core/graph/topological-ranks';
import { candidateFaceBranches } from '../../../lib/core/layout/contract/candidate-face-branches';
import {
	type IndependentAdjacentGlobalStatus,
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
	/** Sum of node width and height added beyond the shared intrinsic measurements. */
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

export interface AdjacentEngineComparison {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly ranks: ReadonlyMap<string, number>;
	readonly frame: { readonly width: number; readonly height: number };
	readonly dedicated: AdjacentComparisonPanel;
	readonly independent: AdjacentComparisonPanel & {
		readonly candidateId: string;
		readonly globalStatus: IndependentAdjacentGlobalStatus.Undetermined;
	};
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

function panel(
	layout: LayoutResult,
	measurements: LayoutMeasurements,
	crossings: number,
): AdjacentComparisonPanel {
	return {
		layout,
		targetOrder: targetOrder(layout),
		validation: 'valid',
		metrics: {
			area: layout.width * layout.height,
			growth: growth(layout, measurements),
			...routeMetrics(layout.relations),
			crossings,
			bridges: renderedBridgeCount(layout),
		},
	};
}

function sameRanks(
	first: ReadonlyMap<string, number>,
	second: ReadonlyMap<string, number>,
): boolean {
	return first.size === second.size && [...first].every(([id, rank]) => second.get(id) === rank);
}

function geometricallyValidUnderAdjacentContract(
	graph: ReturnType<typeof createGraph> & { ok: true },
	ranks: ReturnType<typeof topologicallyRank>,
	measurements: LayoutMeasurements,
	layout: LayoutResult,
): boolean {
	const built = buildAdjacentLayoutContract(graph.value, ranks, measurements);
	if (built.status !== LayoutContractBuildStatus.Ready) return false;
	return built.contract.candidates.some((candidate) =>
		candidateFaceBranches(candidate).some(
			(branch) =>
				validateContractCandidate({
					graph: graph.value,
					candidate,
					choices: branch.choices,
					measurements,
					layout,
				}).valid,
		),
	);
}

/** Compares one real 3+1 document through the current engine and independent materializer. */
export async function compareAdjacentBridgeAndDetour(): Promise<AdjacentEngineComparison> {
	const direction = LayoutDirection.TopToBottom;
	const fixture = realK32Fixture(direction, 'd-e', 'sparse');
	const created = createGraph(fixture.document);
	if (!created.ok) throw new Error('The adjacent comparison document did not create a graph.');
	const ranked = topologicallyRank(created.value);
	const dedicated = await runRealK32Witness(direction, 'd-e', 'sparse', fixture);
	const resolution = resolveIndependentAdjacentContract(
		created.value,
		ranked,
		fixture.measurements,
	);
	if (resolution.status !== IndependentAdjacentStatus.Selected)
		throw new Error(`Independent adjacent comparison is ${resolution.status}.`);
	if (dedicated.summary.assessment !== 'confirmed')
		throw new Error(
			`Dedicated adjacent witness is unproven: ${dedicated.summary.diagnostics.join('; ')}`,
		);
	if (!sameRanks(dedicated.ranks, ranked.byEndpointId))
		throw new Error('Dedicated and independent adjacent ranks differ.');
	if (
		!geometricallyValidUnderAdjacentContract(
			created,
			ranked,
			fixture.measurements,
			dedicated.layout,
		) ||
		!geometricallyValidUnderAdjacentContract(
			created,
			ranked,
			fixture.measurements,
			resolution.selection.layout,
		)
	)
		throw new Error('An adjacent comparison layout failed its geometric contract.');
	const enginePanel = panel(
		dedicated.layout,
		fixture.measurements,
		dedicated.summary.crossings.length,
	);
	const independentPanel = panel(resolution.selection.layout, fixture.measurements, 0);
	if (enginePanel.metrics.crossings === 0 || enginePanel.metrics.bridges === 0)
		throw new Error('The dedicated adjacent witness has no rendered bridge.');
	if (independentPanel.metrics.bridges !== 0)
		throw new Error('The independent adjacent witness unexpectedly renders a bridge.');
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
			candidateId: resolution.selection.candidateId,
			globalStatus: resolution.globalStatus,
		},
	};
}
