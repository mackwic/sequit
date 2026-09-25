import { LayoutPolicy, type LogicDocument } from '../document/logic-document';
import { createGraph } from '../graph/create-graph';
import { topologicallyRank } from '../graph/topological-ranks';
import type { BoundedSearchWitness } from './bounded-search';
import { layoutWithDedicatedEngine } from './layout-engine';
import type { LayoutMeasurements } from './layout-types';
import type { RegionGeometryDiagnosticCode } from './region-geometry-diagnostic';
import type { RegionIncidentUnknownCode } from './region-incident-contract';
import { regionLeafPolicyFailure } from './region-leaf-policy';
import type { RegionLocalLayout, RegionLocalLayoutCache } from './region-local-cache';
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
		readonly witness?: BoundedSearchWitness<unknown>,
		readonly regionId?: string,
	) {
		super(reason);
		this.name = 'UnknownRegionLeafLayoutError';
	}
}

export interface RegionLeafLayoutInput {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly leafPolicy: LayoutPolicy;
	readonly cache?: RegionLocalLayoutCache | undefined;
}

function solveLeaf(input: RegionLeafLayoutInput): RegionLocalLayout {
	const { document, measurements, leafPolicy, cache } = input;
	const policyFailure = regionLeafPolicyFailure(leafPolicy, document);
	if (policyFailure !== undefined) throw new UnsupportedRegionLeafLayoutError(policyFailure);
	const compute = (): RegionLocalLayout => {
		const graph = createGraph(document);
		if (!graph.ok) throw new InvalidRegionLeafGraphError();
		const ranks = topologicallyRank(graph.value);
		if (leafPolicy === LayoutPolicy.SharedLanes) {
			const attempt = solveSharedLaneLayout(graph.value, ranks, measurements, {
				incidents: [],
			});
			if (attempt.status === SharedLaneLayoutStatus.Unsupported)
				throw new UnsupportedRegionLeafLayoutError(attempt.reason);
			if (attempt.status === SharedLaneLayoutStatus.Unknown)
				throw new UnknownRegionLeafLayoutError(attempt.reason, attempt.code, attempt.witness);
			return {
				layout: attempt.layout,
				ranks,
				incidents: attempt.incidents,
				witness: attempt.witness,
			};
		}
		return {
			layout: layoutWithDedicatedEngine(graph.value, ranks, measurements),
			ranks,
			incidents: [],
			witness: { attempted: 0, exhaustive: true, rejectedAlternatives: [] },
		};
	};
	if (cache === undefined) return compute();
	return cache.getOrCompute(document, measurements, leafPolicy, compute);
}

/** The same local graph, rank, and layout calculation serves every leaf disposition. */
export function solveRegionLeafLayout(input: RegionLeafLayoutInput): RegionLocalLayout {
	return solveLeaf(input);
}
