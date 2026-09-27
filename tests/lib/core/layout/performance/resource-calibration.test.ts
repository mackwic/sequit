import { expect, it } from 'vitest';

import { solveGridCellLayout } from '../../../../../src/lib/core/layout/grids/grid-cell-layout';
import { GridCellLayoutStatus } from '../../../../../src/lib/core/layout/grids/grid-cell-types';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../../src/lib/core/layout/layout-engine';
import type { LayoutMeasurements } from '../../../../../src/lib/core/layout/layout-types';
import { solveDedicatedRegionLeafWithIncidents } from '../../../../../src/lib/core/layout/regions/leaf/region-leaf-incident-solver';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../../src/lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
	RegionPortalSide,
} from '../../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionIncidentRole } from '../../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { RegionLocalLayoutCache } from '../../../../../src/lib/core/layout/regions/model/region-local-cache';
import { solveRecursiveNestedRegionLayout } from '../../../../../src/lib/core/layout/regions/recursive/nested-region-recursive-layout';
import { validateRegionCompositionGeometry } from '../../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import {
	type PreparedLayoutDocument,
	prepareLayoutDocument,
} from '../../../../support/harnesses/layout';
import {
	printResourceProfiles,
	profileResource,
	type ResourceProfileSample,
} from '../../../../support/performance/layout-resource-profiles';
import {
	forestOf,
	gridOf,
	gridRegionInput,
	independentNodes,
	rowOf,
	shallowForestOf,
} from '../../../../support/performance/layout-resource-scenarios';
import {
	junctionNetworkDocument,
	multirankOne,
	railReuseDocument,
} from '../../../../support/scenarios/dedicated-channel-witnesses';
import { nxmThreeByTwoDocument, nxmThreeByTwoInput } from '../grid-cell-fixture';

function witnessSample(attempt: ReturnType<typeof solveGridCellLayout>): ResourceProfileSample {
	if (attempt.status === GridCellLayoutStatus.Unsupported)
		return { status: `unsupported:${attempt.reason}`, work: { geometries: 0, rejected: 0 } };
	const witness = attempt.witness;
	if (witness === undefined)
		return { status: attempt.status, work: { geometries: 0, rejected: 0 } };
	const phases = witness.phases;
	return {
		status: attempt.status,
		work: {
			geometries: phases.reduce((sum, phase) => sum + phase.exploredGeometries, 0),
			rejected: witness.rejectedAlternatives.length,
			...Object.fromEntries(phases.map((phase) => [phase.id, phase.exploredGeometries])),
		},
	};
}

function leafSample(
	attempt: ReturnType<typeof solveDedicatedRegionLeafWithIncidents>,
): ResourceProfileSample {
	let status: string = attempt.status;
	if (attempt.status === RegionCompositionStatus.Unknown)
		status = `${attempt.status}:${attempt.code}`;
	return {
		status,
		work: {
			attempts: attempt.witness.attempted,
			rejected: attempt.witness.rejectedAlternatives.length,
		},
	};
}

/** Counts only operations the independent geometry validator actually visits on a full success. */
function regionSample(
	prepared: PreparedLayoutDocument,
	input: RegionInput,
	measurements: LayoutMeasurements = prepared.measurements,
	cache?: RegionLocalLayoutCache,
): ResourceProfileSample {
	const attempt = solveRecursiveNestedRegionLayout(prepared.graph, measurements, input, cache);
	if (attempt.status !== RegionCompositionStatus.Selected)
		return { status: attempt.status, work: { placementValidations: 0, siblingComparisons: 0 } };
	const normalized = normalizeRegionCompositionModel(prepared.graph, input, {});
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error('Selected tree must normalize without a limit');
	const failure = validateRegionCompositionGeometry(normalized.model, attempt);
	if (failure !== undefined) throw new Error(failure.message);
	let siblingComparisons = 0;
	for (const region of normalized.model.regionsById.values()) {
		const children = region.childIds.length;
		siblingComparisons += (children * (children - 1)) / 2;
	}
	return {
		status: attempt.status,
		work: {
			placementValidations: normalized.model.preorderIds.length - 1,
			siblingComparisons,
		},
	};
}

function normalizedRegions(attempt: ReturnType<typeof normalizeRegionCompositionModel>): number {
	if (attempt.status !== RegionCompositionModelStatus.Ready) return 0;
	return attempt.model.preorderIds.length;
}

it('profiles cold and cached-mutation work beside structural refusals (no production limits bypassed)', () => {
	const results = [];
	const grid = nxmThreeByTwoDocument();
	const crossingGrid = {
		...grid,
		relations: [...grid.relations, { id: 'd-to-f', from: 'd', to: 'f' }],
	};
	const input = nxmThreeByTwoInput();
	const crossing = prepareLayoutDocument(crossingGrid);
	results.push(
		profileResource('grid-3x2-four-crossings', 'cold', () =>
			witnessSample(solveGridCellLayout(crossing.graph, crossing.measurements, input)),
		),
	);
	let cache = new RegionLocalLayoutCache();
	const alteredNodes = new Map(crossing.measurements.nodes);
	const original = alteredNodes.get('a');
	if (original === undefined) throw new Error('Missing grid node measurement');
	alteredNodes.set('a', { ...original, width: original.width + 1 });
	const alteredMeasurements = { ...crossing.measurements, nodes: alteredNodes };
	results.push(
		profileResource(
			'grid-3x2-four-crossings',
			'incremental',
			() =>
				witnessSample(solveGridCellLayout(crossing.graph, alteredMeasurements, input, { cache })),
			2,
			7,
			() => {
				cache = new RegionLocalLayoutCache();
				solveGridCellLayout(crossing.graph, crossing.measurements, input, { cache });
			},
		),
	);
	const largeGrid = gridOf(3, 7);
	const largePrepared = prepareLayoutDocument(largeGrid.document);
	results.push(
		profileResource('grid-3x7-21-endpoints', 'cold', () =>
			witnessSample(
				solveGridCellLayout(largePrepared.graph, largePrepared.measurements, largeGrid.input),
			),
		),
	);
	results.push(
		profileResource('grid-3x7-21-endpoints', 'normalization-only', () => {
			const model = normalizeRegionCompositionModel(
				largePrepared.graph,
				gridRegionInput(largeGrid.input),
				{},
			);
			return {
				status: model.status,
				work: {
					normalizedRegions: normalizedRegions(model),
				},
			};
		}),
	);
	const adjacentGrid = gridOf(3, 6);
	const adjacentPrepared = prepareLayoutDocument(adjacentGrid.document);
	results.push(
		profileResource('grid-3x6-18-endpoints', 'cold', () =>
			witnessSample(
				solveGridCellLayout(
					adjacentPrepared.graph,
					adjacentPrepared.measurements,
					adjacentGrid.input,
				),
			),
		),
	);

	const leafDocument = independentNodes(9);
	const contracts = leafDocument.nodes.map((node, index) => ({
		relation: { id: `outside-${index}`, from: node.id, to: 'foreign' },
		endpointId: node.id,
		role: RegionIncidentRole.Source,
		allowedSides: [RegionPortalSide.Top],
	}));
	for (const size of [8, 9]) {
		const preparedLeaf = prepareLayoutDocument({
			...leafDocument,
			nodes: leafDocument.nodes.slice(0, size),
		});
		results.push(
			profileResource(`leaf-${size}-incidents`, 'cold', () => {
				const attempt = solveDedicatedRegionLeafWithIncidents({
					document: { ...leafDocument, nodes: leafDocument.nodes.slice(0, size) },
					measurements: preparedLeaf.measurements,
					contracts: contracts.slice(0, size),
				});
				return leafSample(attempt);
			}),
		);
	}
	const eightLeaf = { ...leafDocument, nodes: leafDocument.nodes.slice(0, 8) };
	const leafMetrics = prepareLayoutDocument(eightLeaf).measurements;
	const mutatedLeafNodes = new Map(leafMetrics.nodes);
	const leafNode = mutatedLeafNodes.get('node-0');
	if (leafNode === undefined) throw new Error('Missing leaf measurement');
	mutatedLeafNodes.set('node-0', { ...leafNode, width: leafNode.width + 1 });
	let leafCache = new RegionLocalLayoutCache();
	results.push(
		profileResource(
			'leaf-8-incidents',
			'incremental',
			() => {
				const attempt = solveDedicatedRegionLeafWithIncidents({
					document: eightLeaf,
					measurements: { ...leafMetrics, nodes: mutatedLeafNodes },
					contracts: contracts.slice(0, 8),
					cache: leafCache,
				});
				return leafSample(attempt);
			},
			2,
			7,
			() => {
				leafCache = new RegionLocalLayoutCache();
				solveDedicatedRegionLeafWithIncidents({
					document: eightLeaf,
					measurements: leafMetrics,
					contracts: contracts.slice(0, 8),
					cache: leafCache,
				});
			},
		),
	);
	const nine = rowOf(9);
	const rowPrepared = prepareLayoutDocument(nine.document);
	results.push(
		profileResource('row-9-children', 'cold', () => regionSample(rowPrepared, nine.input)),
	);
	results.push(
		profileResource('row-9-children', 'normalization-only', () => {
			const model = normalizeRegionCompositionModel(rowPrepared.graph, nine.input, {});
			return {
				status: model.status,
				work: {
					normalizedRegions: normalizedRegions(model),
				},
			};
		}),
	);
	const eight = rowOf(8);
	const eightPrepared = prepareLayoutDocument(eight.document);
	results.push(
		profileResource('row-8-children', 'cold', () => regionSample(eightPrepared, eight.input)),
	);
	let rowCache = new RegionLocalLayoutCache();
	const rowAltered = new Map(eightPrepared.measurements.nodes);
	const firstNode = rowAltered.get('node-0');
	if (firstNode === undefined) throw new Error('Missing row measurement');
	rowAltered.set('node-0', { ...firstNode, width: firstNode.width + 1 });
	results.push(
		profileResource(
			'row-8-children',
			'incremental',
			() =>
				regionSample(
					eightPrepared,
					eight.input,
					{ ...eightPrepared.measurements, nodes: rowAltered },
					rowCache,
				),
			2,
			7,
			() => {
				rowCache = new RegionLocalLayoutCache();
				solveRecursiveNestedRegionLayout(
					eightPrepared.graph,
					eightPrepared.measurements,
					eight.input,
					rowCache,
				);
			},
		),
	);
	const wide = forestOf(8, 33); // 265 regions, depth 34; distinct from a deep single chain.
	const widePrepared = prepareLayoutDocument(wide.document);
	results.push(
		profileResource('region-265-depth-34', 'cold', () => regionSample(widePrepared, wide.input)),
	);
	results.push(
		profileResource('region-265-depth-34', 'normalization-only', () => {
			const attempt = normalizeRegionCompositionModel(widePrepared.graph, wide.input, {});
			return {
				status: attempt.status,
				work: {
					normalizedRegions: normalizedRegions(attempt),
				},
			};
		}),
	);
	const shallow = shallowForestOf(192);
	const shallowPrepared = prepareLayoutDocument(shallow.document);
	results.push(
		profileResource('region-265-depth-4', 'cold', () =>
			regionSample(shallowPrepared, shallow.input),
		),
	);
	results.push(
		profileResource('region-265-depth-4', 'normalization-only', () => {
			const normalized = normalizeRegionCompositionModel(shallowPrepared.graph, shallow.input, {});
			return {
				status: normalized.status,
				work: { normalizedRegions: normalizedRegions(normalized) },
			};
		}),
	);
	const adjacentWide = forestOf(8, 31); // 249 regions at depth 32.
	const adjacentWidePrepared = prepareLayoutDocument(adjacentWide.document);
	results.push(
		profileResource('region-249-depth-32', 'cold', () =>
			regionSample(adjacentWidePrepared, adjacentWide.input),
		),
	);
	for (const depth of [32, 64, 128, 256, 257]) {
		const chain = forestOf(1, depth - 1);
		const prepared = prepareLayoutDocument(chain.document);
		results.push(
			profileResource(`chain-depth-${depth}`, 'cold', () => regionSample(prepared, chain.input)),
		);
	}
	const chain = forestOf(1, 63);
	const chainPrepared = prepareLayoutDocument(chain.document);
	const chainNodes = new Map(chainPrepared.measurements.nodes);
	const chainNode = chainNodes.get('node-0');
	if (chainNode === undefined) throw new Error('Missing chain measurement');
	chainNodes.set('node-0', { ...chainNode, width: chainNode.width + 1 });
	let chainCache = new RegionLocalLayoutCache();
	results.push(
		profileResource(
			'chain-depth-64',
			'incremental',
			() =>
				regionSample(
					chainPrepared,
					chain.input,
					{ ...chainPrepared.measurements, nodes: chainNodes },
					chainCache,
				),
			2,
			7,
			() => {
				chainCache = new RegionLocalLayoutCache();
				solveRecursiveNestedRegionLayout(
					chainPrepared.graph,
					chainPrepared.measurements,
					chain.input,
					chainCache,
				);
			},
		),
	);
	for (const [name, document] of [
		['junction-network', junctionNetworkDocument('channel-work')],
		['multirank-shared', multirankOne],
		['rail-reuse', railReuseDocument()],
	] as const) {
		const dedicated = prepareLayoutDocument(document);
		results.push(
			profileResource(`dedicated-${name}`, 'cold', () => {
				const attempt = layoutWithDedicatedEngineAndRankOrderWitness(
					dedicated.graph,
					dedicated.ranks,
					dedicated.measurements,
				);
				return { status: 'selected', work: { ...attempt.witness.work } };
			}),
		);
	}
	// A one-pixel metric edit after a cached baseline must stabilize to its cold result.
	expect(solveGridCellLayout(crossing.graph, alteredMeasurements, input, { cache })).toEqual(
		solveGridCellLayout(crossing.graph, alteredMeasurements, input),
	);
	expect(
		solveDedicatedRegionLeafWithIncidents({
			document: eightLeaf,
			measurements: { ...leafMetrics, nodes: mutatedLeafNodes },
			contracts: contracts.slice(0, 8),
			cache: leafCache,
		}),
	).toEqual(
		solveDedicatedRegionLeafWithIncidents({
			document: eightLeaf,
			measurements: { ...leafMetrics, nodes: mutatedLeafNodes },
			contracts: contracts.slice(0, 8),
		}),
	);
	expect(
		solveRecursiveNestedRegionLayout(
			eightPrepared.graph,
			{ ...eightPrepared.measurements, nodes: rowAltered },
			eight.input,
			rowCache,
		),
	).toEqual(
		solveRecursiveNestedRegionLayout(
			eightPrepared.graph,
			{ ...eightPrepared.measurements, nodes: rowAltered },
			eight.input,
		),
	);
	expect(
		solveRecursiveNestedRegionLayout(
			chainPrepared.graph,
			{ ...chainPrepared.measurements, nodes: chainNodes },
			chain.input,
			chainCache,
		),
	).toEqual(
		solveRecursiveNestedRegionLayout(
			chainPrepared.graph,
			{ ...chainPrepared.measurements, nodes: chainNodes },
			chain.input,
		),
	);
	expect(results.find((entry) => entry.name === 'grid-3x2-four-crossings')?.status).toBe(
		'selected',
	);
	expect(results.find((entry) => entry.name === 'grid-3x6-18-endpoints')?.status).toBe('selected');
	expect(results.find((entry) => entry.name === 'row-8-children')?.status).toBe('selected');
	expect(results.find((entry) => entry.name === 'region-249-depth-32')?.status).toBe('selected');
	expect(results.find((entry) => entry.name === 'chain-depth-256')?.status).toBe('selected');
	expect(
		results.find(
			(entry) => entry.name === 'region-265-depth-4' && entry.mode === 'normalization-only',
		)?.work['normalizedRegions'],
	).toBe(265);
	expect(results.find((entry) => entry.name === 'chain-depth-257')?.status).toBe('unsupported');
	expect(
		results.find(
			(entry) => entry.name === 'grid-3x7-21-endpoints' && entry.mode === 'normalization-only',
		)?.work['normalizedRegions'],
	).toBe(22);
	expect(
		results.find((entry) => entry.name === 'row-9-children' && entry.mode === 'normalization-only')
			?.work['normalizedRegions'],
	).toBe(10);
	expect(results.find((entry) => entry.name === 'grid-3x7-21-endpoints')?.work['geometries']).toBe(
		0,
	);
	expect(results.find((entry) => entry.name === 'leaf-9-incidents')?.work['attempts']).toBe(0);
	expect(
		results.find(
			(entry) => entry.name === 'region-265-depth-34' && entry.mode === 'normalization-only',
		)?.work['normalizedRegions'],
	).toBe(265);
	printResourceProfiles(results);
}, 120_000);
