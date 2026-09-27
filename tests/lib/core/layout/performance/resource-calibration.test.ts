import { expect, it } from 'vitest';

import { defined, EndpointKind } from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import { solveGridCellLayout } from '../../../../../src/lib/core/layout/grids/grid-cell-layout';
import { GridCellLayoutStatus } from '../../../../../src/lib/core/layout/grids/grid-cell-types';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../../src/lib/core/layout/layout-engine';
import type { LayoutMeasurements } from '../../../../../src/lib/core/layout/layout-types';
import { solveDedicatedRegionLeafWithIncidents } from '../../../../../src/lib/core/layout/regions/leaf/region-leaf-incident-solver';
import {
	RegionCompositionWork,
	regionCompositionWorkBudgets,
} from '../../../../../src/lib/core/layout/regions/model/region-composition-limits';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../../src/lib/core/layout/regions/model/region-composition-model';
import { RegionWorkPhase } from '../../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutAttempt,
	RegionPortalSide,
} from '../../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionIncidentRole } from '../../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { RegionLocalLayoutCache } from '../../../../../src/lib/core/layout/regions/model/region-local-cache';
import {
	solveRecursiveNestedRegionLayout,
	solveRecursiveNestedRegionLayoutWithWork,
} from '../../../../../src/lib/core/layout/regions/recursive/nested-region-recursive-layout';
import { solveRegionSubtreeAttempts } from '../../../../../src/lib/core/layout/regions/recursive/region-partial-composition';
import { validateRegionCompositionGeometry } from '../../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import {
	layoutWithRootRegion,
	nestedRegionInput,
} from '../../../../../src/lib/core/layout/root-region';
import { allocateChannelIntervals } from '../../../../../src/lib/core/layout/routing/channel-interval-allocation';
import { routeChannel } from '../../../../../src/lib/core/layout/routing/channel-routing';
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
	gridWithLocalRelations,
	independentNodes,
	nineIncidentNestedRegions,
	persistedRowOf,
	rowOf,
	shallowForestOf,
} from '../../../../support/performance/layout-resource-scenarios';
import {
	junctionNetworkDocument,
	multirankOne,
	railReuseDocument,
} from '../../../../support/scenarios/dedicated-channel-witnesses';
import { nxmThreeByTwoDocument, nxmThreeByTwoInput } from '../grid-cell-fixture';
import { depthTwoRegionDocument, depthTwoRegionInput } from '../nested-region-fixture';

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
			slotWork: attempt.witness.slotWork?.attempted ?? 0,
			slotExhausted: Number(attempt.witness.slotWork?.exhausted ?? false),
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
	const counter = new RegionCompositionWork(
		regionCompositionWorkBudgets(input.regions.length, prepared.graph.relations.length),
	);
	const attempt = solveRecursiveNestedRegionLayoutWithWork(prepared.graph, measurements, input, {
		cache,
		work: counter,
	});
	const work = {
		normalizationComparisons: counter.attempted(RegionWorkPhase.NormalizationComparisons),
		placements: counter.attempted(RegionWorkPhase.Placements),
		comparisons: counter.attempted(RegionWorkPhase.Comparisons),
		traversals: counter.attempted(RegionWorkPhase.Traversals),
	};
	if (attempt.status !== RegionCompositionStatus.Selected) return { status: attempt.status, work };
	const normalized = normalizeRegionCompositionModel(prepared.graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error('Selected tree must normalize without a limit');
	const failure = validateRegionCompositionGeometry(normalized.model, attempt);
	if (failure !== undefined) throw new Error(failure.message);
	return {
		status: attempt.status,
		work: {
			placementValidations: normalized.model.preorderIds.length - 1,
			...work,
		},
	};
}

function normalizedRegions(attempt: ReturnType<typeof normalizeRegionCompositionModel>): number {
	if (attempt.status !== RegionCompositionModelStatus.Ready) return 0;
	return attempt.model.preorderIds.length;
}

it('profiles cold and cached-mutation work under counted budgets', () => {
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

	const localGrid = gridWithLocalRelations();
	const localGridPrepared = prepareLayoutDocument(localGrid.document);
	results.push(
		profileResource('grid-21-local-relations', 'cold', () =>
			witnessSample(
				solveGridCellLayout(
					localGridPrepared.graph,
					localGridPrepared.measurements,
					localGrid.input,
				),
			),
		),
	);
	const largeMutatedNodes = new Map(largePrepared.measurements.nodes);
	const largeNode = largeMutatedNodes.get('node-0');
	if (largeNode === undefined) throw new Error('Missing large grid node measurement');
	largeMutatedNodes.set('node-0', { ...largeNode, width: largeNode.width + 1 });
	let largeCache = new RegionLocalLayoutCache();
	results.push(
		profileResource(
			'grid-3x7-21-endpoints',
			'incremental',
			() =>
				witnessSample(
					solveGridCellLayout(
						largePrepared.graph,
						{ ...largePrepared.measurements, nodes: largeMutatedNodes },
						largeGrid.input,
						{ cache: largeCache },
					),
				),
			2,
			7,
			() => {
				largeCache = new RegionLocalLayoutCache();
				solveGridCellLayout(largePrepared.graph, largePrepared.measurements, largeGrid.input, {
					cache: largeCache,
				});
			},
		),
	);
	const localMutatedNodes = new Map(localGridPrepared.measurements.nodes);
	const localNode = localMutatedNodes.get('local-node-0');
	if (localNode === undefined) throw new Error('Missing local grid node measurement');
	localMutatedNodes.set('local-node-0', { ...localNode, width: localNode.width + 1 });
	let localCache = new RegionLocalLayoutCache();
	results.push(
		profileResource(
			'grid-21-local-relations',
			'incremental',
			() =>
				witnessSample(
					solveGridCellLayout(
						localGridPrepared.graph,
						{ ...localGridPrepared.measurements, nodes: localMutatedNodes },
						localGrid.input,
						{ cache: localCache },
					),
				),
			2,
			7,
			() => {
				localCache = new RegionLocalLayoutCache();
				solveGridCellLayout(
					localGridPrepared.graph,
					localGridPrepared.measurements,
					localGrid.input,
					{
						cache: localCache,
					},
				);
			},
		),
	);

	const leafDocument = independentNodes(16);
	const contracts = leafDocument.nodes.map((node, index) => ({
		relation: { id: `outside-${index}`, from: node.id, to: 'foreign' },
		endpointId: node.id,
		role: RegionIncidentRole.Source,
		allowedSides: [RegionPortalSide.Top],
	}));
	for (const size of [8, 9, 12, 16]) {
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
	for (const size of [8, 9]) {
		const leaf = { ...leafDocument, nodes: leafDocument.nodes.slice(0, size) };
		const leafMetrics = prepareLayoutDocument(leaf).measurements;
		const mutatedLeafNodes = new Map(leafMetrics.nodes);
		const leafNode = mutatedLeafNodes.get('node-0');
		if (leafNode === undefined) throw new Error('Missing leaf measurement');
		mutatedLeafNodes.set('node-0', { ...leafNode, width: leafNode.width + 1 });
		let leafCache = new RegionLocalLayoutCache();
		results.push(
			profileResource(
				`leaf-${size}-incidents`,
				'incremental',
				() =>
					leafSample(
						solveDedicatedRegionLeafWithIncidents({
							document: leaf,
							measurements: { ...leafMetrics, nodes: mutatedLeafNodes },
							contracts: contracts.slice(0, size),
							cache: leafCache,
						}),
					),
				2,
				7,
				() => {
					leafCache = new RegionLocalLayoutCache();
					solveDedicatedRegionLeafWithIncidents({
						document: leaf,
						measurements: leafMetrics,
						contracts: contracts.slice(0, size),
						cache: leafCache,
					});
				},
			),
		);
		// A one-pixel edit after a cached baseline must stabilize to its cold result.
		expect(
			solveDedicatedRegionLeafWithIncidents({
				document: leaf,
				measurements: { ...leafMetrics, nodes: mutatedLeafNodes },
				contracts: contracts.slice(0, size),
				cache: leafCache,
			}),
		).toEqual(
			solveDedicatedRegionLeafWithIncidents({
				document: leaf,
				measurements: { ...leafMetrics, nodes: mutatedLeafNodes },
				contracts: contracts.slice(0, size),
			}),
		);
	}
	for (const size of [4, 5, 16]) {
		const nodes = leafDocument.nodes.slice(0, size);
		const document = {
			...leafDocument,
			nodes,
			relations: nodes.slice(1).map((node, index) => ({
				id: `local-${index}`,
				from: defined(nodes[index]).id,
				to: node.id,
			})),
		};
		const measurements = prepareLayoutDocument(document).measurements;
		const chainContracts = nodes.map((node, index) => {
			const allowedSides = [RegionPortalSide.Top];
			if (size === 16)
				allowedSides.push(RegionPortalSide.Bottom, RegionPortalSide.Left, RegionPortalSide.Right);
			else if (index > 0) allowedSides.push(RegionPortalSide.Bottom);
			return {
				relation: { id: `cross-${index}`, from: node.id, to: 'foreign' },
				endpointId: node.id,
				role: RegionIncidentRole.Source,
				allowedSides,
			};
		});
		results.push(
			profileResource(`leaf-chain-${size}`, 'cold', () =>
				leafSample(
					solveDedicatedRegionLeafWithIncidents({
						document,
						measurements,
						contracts: chainContracts,
					}),
				),
			),
		);
	}
	const nestedIncident = nineIncidentNestedRegions();
	for (const size of [2, 9]) {
		const nodes = [
			...nestedIncident.document.nodes.slice(0, size),
			...nestedIncident.document.nodes.slice(9, 9 + size),
		];
		const document = {
			...nestedIncident.document,
			nodes,
			relations: nestedIncident.document.relations.slice(0, size),
		};
		const ids = new Set(nodes.map(({ id }) => id));
		const input = {
			...nestedIncident.input,
			regionByEndpointId: new Map(
				[...nestedIncident.input.regionByEndpointId].filter(([id]) => ids.has(id)),
			),
		};
		const prepared = prepareLayoutDocument(document);
		const sample = (attempt: RegionLayoutAttempt): ResourceProfileSample => {
			let compositionAttempts = 0;
			let ownedRoutes = 0;
			if (attempt.status !== RegionCompositionStatus.Unsupported)
				compositionAttempts = attempt.searchWitness?.attempted ?? 0;
			if (attempt.status === RegionCompositionStatus.Selected)
				ownedRoutes = attempt.ownedRoutes.length;
			return { status: attempt.status, work: { compositionAttempts, ownedRoutes } };
		};
		results.push(
			profileResource(`nested-leaf-${size}-boundary`, 'cold', () =>
				sample(solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input)),
			),
		);
		const nodeMeasurements = new Map(prepared.measurements.nodes);
		const node = nodeMeasurements.get('node-0');
		if (node === undefined) throw new Error('Missing nested source measurement');
		nodeMeasurements.set('node-0', { ...node, width: node.width + 1 });
		const editedMeasurements = { ...prepared.measurements, nodes: nodeMeasurements };
		let cache = new RegionLocalLayoutCache();
		results.push(
			profileResource(
				`nested-leaf-${size}-boundary`,
				'incremental',
				() =>
					sample(
						solveRecursiveNestedRegionLayout(prepared.graph, editedMeasurements, input, cache),
					),
				2,
				7,
				() => {
					cache = new RegionLocalLayoutCache();
					solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input, cache);
				},
			),
		);
		expect(
			solveRecursiveNestedRegionLayout(prepared.graph, editedMeasurements, input, cache),
		).toEqual(solveRecursiveNestedRegionLayout(prepared.graph, editedMeasurements, input));
	}
	const nine = rowOf(9);
	const rowPrepared = prepareLayoutDocument(nine.document);
	results.push(
		profileResource('row-9-children', 'cold', () => regionSample(rowPrepared, nine.input)),
	);
	results.push(
		profileResource('row-9-children', 'normalization-only', () => {
			const model = normalizeRegionCompositionModel(rowPrepared.graph, nine.input);
			return {
				status: model.status,
				work: {
					normalizedRegions: normalizedRegions(model),
				},
			};
		}),
	);
	for (const count of [100, 600, 1000]) {
		const wideRow = rowOf(count);
		const preparedWideRow = prepareLayoutDocument(wideRow.document);
		results.push(
			profileResource(
				`row-${count}-children`,
				'cold',
				() => regionSample(preparedWideRow, wideRow.input),
				2,
				5,
			),
		);
	}
	const presentedWideRow = prepareLayoutDocument(persistedRowOf(1000));
	results.push(
		profileResource(
			'product-row-1000-children',
			'cold',
			() => {
				const layout = layoutWithRootRegion(
					presentedWideRow.graph,
					presentedWideRow.ranks,
					presentedWideRow.measurements,
				);
				return { status: 'selected', work: { regions: layout.regions?.length ?? 0 } };
			},
			2,
			5,
		),
	);
	results.push(
		profileResource(
			'presented-row-1000-shared-work',
			'cold',
			() => {
				const work = new RegionCompositionWork(regionCompositionWorkBudgets(1001, 0));
				const input = nestedRegionInput(presentedWideRow.graph, work);
				const attempt = solveRecursiveNestedRegionLayoutWithWork(
					presentedWideRow.graph,
					presentedWideRow.measurements,
					input,
					{ work },
				);
				return {
					status: attempt.status,
					work: {
						normalizationComparisons: work.attempted(RegionWorkPhase.NormalizationComparisons),
						placements: work.attempted(RegionWorkPhase.Placements),
						comparisons: work.attempted(RegionWorkPhase.Comparisons),
						traversals: work.attempted(RegionWorkPhase.Traversals),
					},
				};
			},
			2,
			5,
		),
	);
	results.push(
		profileResource(
			'partial-row-1000-shared-work',
			'cold',
			() => {
				const work = new RegionCompositionWork(regionCompositionWorkBudgets(1001, 0));
				const input = nestedRegionInput(presentedWideRow.graph, work);
				const presentationTraversals = work.attempted(RegionWorkPhase.Traversals);
				const attempts = solveRegionSubtreeAttempts({
					graph: presentedWideRow.graph,
					measurements: presentedWideRow.measurements,
					input,
					cache: new RegionLocalLayoutCache(),
					work,
				});
				const selected = attempts.filter(
					({ status }) => status === RegionCompositionStatus.Selected,
				).length;
				let status = 'selected';
				if (selected !== 1000) status = `partial:${selected}`;
				return {
					status,
					work: {
						attempts: attempts.length,
						selected,
						presentationTraversals,
						normalizationComparisons: work.attempted(RegionWorkPhase.NormalizationComparisons),
						placements: work.attempted(RegionWorkPhase.Placements),
						comparisons: work.attempted(RegionWorkPhase.Comparisons),
						traversals: work.attempted(RegionWorkPhase.Traversals),
					},
				};
			},
			2,
			5,
		),
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
			const attempt = normalizeRegionCompositionModel(widePrepared.graph, wide.input);
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
			const normalized = normalizeRegionCompositionModel(shallowPrepared.graph, shallow.input);
			return {
				status: normalized.status,
				work: { normalizedRegions: normalizedRegions(normalized) },
			};
		}),
	);
	const shallowNodes = new Map(shallowPrepared.measurements.nodes);
	const shallowNode = shallowNodes.get('node-0');
	if (shallowNode === undefined) throw new Error('Missing shallow forest measurement');
	shallowNodes.set('node-0', { ...shallowNode, width: shallowNode.width + 1 });
	const shallowMetrics = { ...shallowPrepared.measurements, nodes: shallowNodes };
	let shallowCache = new RegionLocalLayoutCache();
	results.push(
		profileResource(
			'region-265-depth-4',
			'incremental',
			() => regionSample(shallowPrepared, shallow.input, shallowMetrics, shallowCache),
			2,
			7,
			() => {
				shallowCache = new RegionLocalLayoutCache();
				solveRecursiveNestedRegionLayout(
					shallowPrepared.graph,
					shallowPrepared.measurements,
					shallow.input,
					shallowCache,
				);
			},
		),
	);
	expect(
		solveRecursiveNestedRegionLayout(
			shallowPrepared.graph,
			shallowMetrics,
			shallow.input,
			shallowCache,
		),
	).toEqual(solveRecursiveNestedRegionLayout(shallowPrepared.graph, shallowMetrics, shallow.input));
	const relations = independentNodes(34);
	const localRelations = {
		...relations,
		relations: Array.from({ length: 17 }, (_, index) => ({
			id: `local-${index}`,
			from: `node-${index * 2}`,
			to: `node-${index * 2 + 1}`,
		})),
	};
	const localPrepared = prepareLayoutDocument(localRelations);
	const localInput: RegionInput = {
		...rowOf(17).input,
		regionByEndpointId: new Map(
			relations.nodes.map((node, index) => [node.id, `child-${Math.floor(index / 2)}`]),
		),
	};
	results.push(
		profileResource('region-17-local-relations', 'cold', () =>
			regionSample(localPrepared, localInput),
		),
	);
	const crossingRow = rowOf(8);
	const crossingPrepared = prepareLayoutDocument({
		...crossingRow.document,
		relations: Array.from({ length: 4 }, (_, index) => ({
			id: `crossing-${index}`,
			from: `node-${index * 2}`,
			to: `node-${index * 2 + 1}`,
		})),
	});
	results.push(
		profileResource('region-four-traversals', 'cold', () =>
			regionSample(crossingPrepared, crossingRow.input),
		),
	);
	const nested = depthTwoRegionDocument();
	const nestedInput = depthTwoRegionInput();
	const nestedPrepared = prepareLayoutDocument(nested);
	const wider: RegionInput = {
		...nestedInput,
		regions: nestedInput.regions.map((region) => {
			if (region.id === 'right' || region.id === 'far-right')
				return { ...region, parentId: 'branch' };
			return region;
		}),
	};
	results.push(
		profileResource('region-retried-five-children', 'cold', () =>
			regionSample(nestedPrepared, wider),
		),
	);
	const grouped = prepareLayoutDocument({
		...nested,
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'group-left',
				label: 'Left group',
				layoutOrder: orderKey('a0'),
			},
		],
		nodes: nested.nodes.map((node) => {
			if (node.id !== 'a-source') return node;
			return { ...node, groupId: 'group-left' };
		}),
		relations: [...nested.relations, { id: 'group-crossing', from: 'group-left', to: 'c' }],
	});
	results.push(
		profileResource('region-group-crossing-retry', 'cold', () =>
			regionSample(grouped, {
				...nestedInput,
				regionByEndpointId: new Map([...nestedInput.regionByEndpointId, ['group-left', 'left']]),
			}),
		),
	);
	const adjacentWide = forestOf(8, 31); // 249 regions at depth 32.
	const adjacentWidePrepared = prepareLayoutDocument(adjacentWide.document);
	results.push(
		profileResource('region-249-depth-32', 'cold', () =>
			regionSample(adjacentWidePrepared, adjacentWide.input),
		),
	);
	for (const depth of [32, 64, 128, 191, 192, 193, 256, 257]) {
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
	for (const [name, wires] of [
		[
			'split',
			[
				{ id: 'a', source: 48, target: 96 },
				{ id: 'b', source: 96, target: 48 },
			],
		],
		[
			'shared',
			[
				{ id: 'a', source: 0, target: 48, sharedSource: 'common' },
				{ id: 'b', source: 0, target: 96, sharedSource: 'common' },
			],
		],
	] as const) {
		results.push(
			profileResource(`channel-${name}`, 'cold', () => {
				const channel = routeChannel(wires);
				return {
					status: 'allocated',
					work: {
						allocatedRuns: channel.trackByRunKey.size,
						railTracks: channel.railCount,
						splitWires: channel.wires.filter((wire) => wire.middle !== undefined).length,
					},
				};
			}),
		);
	}
	const equalIntervals = [
		{ key: 'z-last', start: 0, end: 40, rail: -1 },
		{ key: 'a-first', start: 0, end: 40, rail: -1 },
		{ key: 'short', start: 0, end: 20, rail: -1 },
		{ key: 'middle', start: 33, end: 35, rail: -1 },
		{ key: 'later', start: 60, end: 80, rail: -1 },
		{ key: 'latest', start: 61, end: 75, rail: -1 },
	];
	results.push(
		profileResource('channel-equal-intervals', 'cold', () => {
			const allocation = allocateChannelIntervals(
				{ ownerId: '@root/channel/ties', capacity: 6, spacing: 24 },
				equalIntervals,
				2,
			);
			return {
				status: 'allocated',
				work: {
					allocatedRuns: allocation.trackByRunKey.size,
					railTracks: allocation.trackCount,
				},
			};
		}),
	);
	expect(
		solveGridCellLayout(
			largePrepared.graph,
			{ ...largePrepared.measurements, nodes: largeMutatedNodes },
			largeGrid.input,
			{ cache: largeCache },
		),
	).toEqual(
		solveGridCellLayout(
			largePrepared.graph,
			{ ...largePrepared.measurements, nodes: largeMutatedNodes },
			largeGrid.input,
		),
	);
	expect(
		solveGridCellLayout(
			localPrepared.graph,
			{ ...localPrepared.measurements, nodes: localMutatedNodes },
			localGrid.input,
			{ cache: localCache },
		),
	).toEqual(
		solveGridCellLayout(
			localPrepared.graph,
			{ ...localPrepared.measurements, nodes: localMutatedNodes },
			localGrid.input,
		),
	);
	// A one-pixel metric edit after a cached baseline must stabilize to its cold result.
	expect(solveGridCellLayout(crossing.graph, alteredMeasurements, input, { cache })).toEqual(
		solveGridCellLayout(crossing.graph, alteredMeasurements, input),
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
	expect(results.find((entry) => entry.name === 'chain-depth-192')?.status).toBe('selected');
	expect(results.find((entry) => entry.name === 'chain-depth-193')?.status).toBe('unsupported');
	expect(results.find((entry) => entry.name === 'region-265-depth-4')?.status).toBe('selected');
	expect(results.find((entry) => entry.name === 'row-9-children')?.status).toBe('selected');
	expect(results.find((entry) => entry.name === 'channel-shared')?.work['allocatedRuns']).toBe(1);
	expect(
		results.find((entry) => entry.name === 'channel-equal-intervals')?.work['allocatedRuns'],
	).toBe(6);
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
	expect(results.find((entry) => entry.name === 'grid-3x7-21-endpoints')?.status).toBe('selected');
	expect(results.find((entry) => entry.name === 'grid-21-local-relations')?.status).toBe(
		'selected',
	);
	expect(results.find((entry) => entry.name === 'grid-3x7-21-endpoints')?.work['geometries']).toBe(
		1,
	);
	expect(
		results.find((entry) => entry.name === 'grid-21-local-relations')?.work['geometries'],
	).toBe(1);
	expect(
		results.find((entry) => entry.name === 'leaf-9-incidents' && entry.mode === 'cold')?.work[
			'attempts'
		],
	).toBe(9);
	expect(
		results.find(
			(entry) => entry.name === 'region-265-depth-34' && entry.mode === 'normalization-only',
		)?.work['normalizedRegions'],
	).toBe(265);
	printResourceProfiles(results);
}, 120_000);
