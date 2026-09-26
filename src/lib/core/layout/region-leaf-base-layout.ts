import { LayoutPolicy, type LogicDocument } from '../document/logic-document';
import { createGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { topologicallyRank } from '../graph/topological-ranks';
import { evaluateDedicatedLayout } from './layout-engine';
import type { LayoutMeasurements, LayoutResult } from './layout-types';
import { selectDedicatedRankLayout } from './rank/rank-order-selection';
import { regionLeafPolicyFailure } from './region-leaf-policy';
import type { RegionLocalLayout, RegionLocalLayoutCache } from './region-local-cache';
import { type RegionSearchEvidence, RegionSearchProvenance } from './region-search-evidence';
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
		readonly evidence: RegionSearchEvidence,
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
	readonly admitDedicatedLayout?:
		((layout: LayoutResult, ranks: TopologicalRanks) => boolean) | undefined;
}

function solveLeaf(input: RegionLeafLayoutInput): RegionLocalLayout {
	const { document, measurements, leafPolicy, cache, admitDedicatedLayout } = input;
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
				throw new UnknownRegionLeafLayoutError(attempt.reason, {
					provenance: RegionSearchProvenance.Incident,
					code: attempt.code,
					witness: attempt.witness,
				});
			return {
				layout: attempt.layout,
				ranks,
				incidents: attempt.incidents,
				witness: attempt.witness,
			};
		}
		return {
			layout: selectDedicatedRankLayout(graph.value, ranks, measurements, {
				options: {},
				evaluate: evaluateDedicatedLayout,
				admit: admitDedicatedLayout,
			}).layout,
			ranks,
			incidents: [],
			witness: { attempted: 0, exhaustive: true, rejectedAlternatives: [] },
		};
	};
	if (cache === undefined || admitDedicatedLayout !== undefined) return compute();
	return cache.getOrCompute(document, measurements, leafPolicy, compute);
}

/** The same local graph, rank, and layout calculation serves every leaf disposition. */
export function solveRegionLeafLayout(input: RegionLeafLayoutInput): RegionLocalLayout {
	return solveLeaf(input);
}
