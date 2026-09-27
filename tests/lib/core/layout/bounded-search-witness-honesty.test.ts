import { expect, it } from 'vitest';

import {
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutPolicy,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	GRID_CROSSING_BRIDGE_BUDGET,
	GRID_CROSSING_EXTRA_TRACK_BUDGET,
	GRID_CROSSING_REALLOCATION_BUDGET,
	GRID_CROSSING_ROW_GUTTER_BUDGET,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import { GridCellLayoutStatus } from '../../../../src/lib/core/layout/grids/grid-cell-types';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/lanes/shared-lane-layout';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../src/lib/core/layout/layout-engine';
import { solveDedicatedRegionLeafWithIncidents } from '../../../../src/lib/core/layout/regions/leaf/region-leaf-incident-solver';
import {
	RegionCompositionStatus,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	RegionIncidentRole,
	RegionIncidentUnknownCode,
} from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/regions/recursive/nested-region-recursive-layout';
import type { BoundedSearchWitness } from '../../../../src/lib/core/layout/search/bounded-search';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	gridOf,
	independentNodes,
	rowOf,
} from '../../../support/performance/layout-resource-scenarios';

function assertBoundedWitness(
	name: string,
	witness: BoundedSearchWitness<{
		readonly code?: string;
		readonly reason?: string;
		readonly relationId?: string;
		readonly phaseId?: string;
		readonly indices?: readonly number[];
	}>,
	budget: number,
): void {
	expect(witness.attempted, name).toBeGreaterThanOrEqual(0);
	expect(witness.attempted, name).toBeLessThanOrEqual(budget);
	expect(witness.rejectedAlternatives.length, name).toBeLessThanOrEqual(witness.attempted);
	for (const rejected of witness.rejectedAlternatives) {
		expect(rejected.code ?? rejected.reason, name).toBeTruthy();
		expect(rejected.relationId ?? rejected.phaseId ?? rejected.indices, name).toBeDefined();
	}
}

it('accounts for attempted work, truncation and provenance across grid, leaf, lanes, rank and composition', () => {
	const grid = gridOf(2, 2);
	const gridPrepared = prepareLayoutDocument(grid.document);
	const placed = solveGridCellLayout(gridPrepared.graph, gridPrepared.measurements, grid.input);
	expect(placed.status).toBe(GridCellLayoutStatus.Selected);
	if (placed.status !== GridCellLayoutStatus.Selected) return;
	const gridWitness = placed.witness;
	const phaseBudgets = {
		'row-gutter': GRID_CROSSING_ROW_GUTTER_BUDGET,
		reallocate: GRID_CROSSING_REALLOCATION_BUDGET,
		'extra-track': GRID_CROSSING_EXTRA_TRACK_BUDGET,
		bridge: GRID_CROSSING_BRIDGE_BUDGET,
	};
	assertBoundedWitness(
		'grid',
		gridWitness,
		Object.values(phaseBudgets).reduce((sum, limit) => sum + limit, 0),
	);
	expect(gridWitness.attempted).toBe(
		gridWitness.phases.reduce((sum, phase) => sum + phase.exploredGeometries, 0),
	);
	for (const phase of gridWitness.phases) {
		expect(phase.id).toBeTruthy();
		expect(phase.exploredGeometries).toBeLessThanOrEqual(phaseBudgets[phase.id]);
		if (phase.exhaustive) {
			expect(phase.totalGeometriesKind).toBe('exact');
			expect(BigInt(phase.exploredGeometries)).toBe(BigInt(phase.totalGeometries));
		}
		if (phase.truncated) expect(phase.exhaustive).toBe(false);
		if (!phase.attempted) expect(phase.exploredGeometries).toBe(0);
	}

	const single = independentNodes(1);
	const leafPrepared = prepareLayoutDocument(single);
	const leaf = solveDedicatedRegionLeafWithIncidents({
		document: single,
		measurements: leafPrepared.measurements,
		contracts: [
			{
				relation: { id: 'outside', from: 'node-0', to: 'external' },
				endpointId: 'node-0',
				role: RegionIncidentRole.Source,
				allowedSides: [RegionPortalSide.Top],
			},
		],
	});
	assertBoundedWitness('dedicated-leaf', leaf.witness, 8_192);
	if (
		leaf.status === RegionCompositionStatus.Unknown &&
		leaf.code === RegionIncidentUnknownCode.SearchBudgetExceeded
	)
		expect(leaf.witness.exhaustive).toBe(false);

	const laneBase = independentNodes(2);
	const laneDocument = {
		...laneBase,
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		nodes: laneBase.nodes.map((node, index) => ({
			...node,
			laneId: `lane-${index}`,
		})),
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: [0, 1].map((index) => ({
				id: `lane-${index}`,
				label: `Lane ${index}`,
				layoutOrder: orderKey(`a${index + 1}`),
			})),
		},
	};
	const lanePrepared = prepareLayoutDocument(laneDocument);
	const lane = solveSharedLaneLayout(
		lanePrepared.graph,
		lanePrepared.ranks,
		lanePrepared.measurements,
		{
			incidents: [
				{
					relation: { id: 'outside', from: 'node-0', to: 'external' },
					endpointId: 'node-0',
					role: RegionIncidentRole.Source,
					allowedSides: [RegionPortalSide.Right, RegionPortalSide.Left],
				},
			],
		},
	);
	if (lane.status === SharedLaneLayoutStatus.Unsupported) throw new Error(lane.reason);
	assertBoundedWitness('shared-lane', lane.witness, 256);
	for (const pass of lane.allocationWitness?.passes ?? []) {
		if (pass.exhaustive) expect(BigInt(pass.attempted)).toBe(BigInt(pass.total));
		if (pass.truncated) expect(pass.exhaustive).toBe(false);
		expect(pass.work).toBeLessThanOrEqual(pass.workBudget);
	}

	const rank = layoutWithDedicatedEngineAndRankOrderWitness(
		leafPrepared.graph,
		leafPrepared.ranks,
		leafPrepared.measurements,
	).witness;
	expect(rank.mode).toBeTruthy();
	expect(rank.stop).toBeTruthy();
	expect(rank.evaluated).toBeLessThanOrEqual(12);
	if (rank.truncated) expect(rank.exhaustive).toBe(false);

	const row = rowOf(2);
	const crossing = { ...row.document, relations: [{ id: 'across', from: 'node-0', to: 'node-1' }] };
	const rowPrepared = prepareLayoutDocument(crossing);
	const composition = solveRecursiveNestedRegionLayout(
		rowPrepared.graph,
		rowPrepared.measurements,
		row.input,
	);
	if (composition.status === RegionCompositionStatus.Unsupported)
		throw new Error(composition.reason);
	if (composition.searchWitness === undefined)
		throw new Error('Missing composition search witness');
	assertBoundedWitness('composition', composition.searchWitness, 64);
}, 120_000);
