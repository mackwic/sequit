import type { LayoutPolicy, LogicDocument } from '../document/logic-document';
import { createGraph } from '../graph/create-graph';
import { topologicallyRank } from '../graph/topological-ranks';
import { layoutWithDedicatedEngine } from './layout-engine';
import type { LayoutMeasurements } from './layout-types';
import type {
	NestedRegionLocalLayout,
	NestedRegionLocalLayoutCache,
} from './nested-region-local-cache';
import type { RegionGeometryDiagnosticCode } from './region-geometry-diagnostic';
import type {
	RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from './region-incident-contract';
import { SharedLaneLayoutStatus, solveSharedLaneLayout } from './shared-lane-layout';

export class InvalidRegionLeafGraphError extends Error {
	constructor() {
		super('A local child graph is invalid.');
		this.name = 'InvalidRegionLeafGraphError';
	}
}

export class UnsupportedRegionLeafLayoutError extends Error {
	constructor(readonly reason: string) {
		super(reason);
		this.name = 'UnsupportedRegionLeafLayoutError';
	}
}

export class UnknownRegionLeafLayoutError extends Error {
	constructor(
		readonly reason: string,
		readonly code?: RegionGeometryDiagnosticCode | RegionIncidentUnknownCode,
		readonly witness?: RegionIncidentSearchWitness,
		readonly regionId?: string,
	) {
		super(reason);
		this.name = 'UnknownRegionLeafLayoutError';
	}
}

interface LeafSolveInput {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly policy: LayoutPolicy | undefined;
	readonly cache: NestedRegionLocalLayoutCache | undefined;
}

function solveLeaf(input: LeafSolveInput): NestedRegionLocalLayout {
	const { document, measurements, policy, cache } = input;
	const compute = (): NestedRegionLocalLayout => {
		const graph = createGraph(document);
		if (!graph.ok) throw new InvalidRegionLeafGraphError();
		const ranks = topologicallyRank(graph.value);
		if (document.presentation !== undefined) {
			const attempt = solveSharedLaneLayout(graph.value, ranks, measurements, {
				incidents: [],
			});
			if (attempt.status === SharedLaneLayoutStatus.Unsupported)
				throw new UnsupportedRegionLeafLayoutError(attempt.reason);
			if (attempt.status === SharedLaneLayoutStatus.Unknown)
				throw new UnknownRegionLeafLayoutError(attempt.reason);
			return { layout: attempt.layout, ranks };
		}
		return {
			layout: layoutWithDedicatedEngine(graph.value, ranks, measurements),
			ranks,
		};
	};
	if (cache === undefined) return compute();
	return cache.getOrCompute(document, measurements, policy, compute);
}

/** The same local graph, rank, and layout calculation serves every leaf disposition. */
export function solveRegionLeafLayout(
	document: LogicDocument,
	measurements: LayoutMeasurements,
	policy?: LayoutPolicy,
	cache?: NestedRegionLocalLayoutCache,
): NestedRegionLocalLayout {
	return solveLeaf({ document, measurements, policy, cache });
}
