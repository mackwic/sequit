import { expect, it } from 'vitest';

import { solveGridCellLayout } from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import { GridCellLayoutStatus } from '../../../../src/lib/core/layout/grids/grid-cell-types';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../src/lib/core/layout/layout-engine';
import {
	RegionCompositionDiagnosticCode,
	RegionCompositionStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/regions/recursive/nested-region-recursive-layout';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	forestOf,
	gridOf,
	independentNodes,
	rowOf,
	shallowForestOf,
} from '../../../support/performance/layout-resource-scenarios';

it('bounds work for a row of 100 independent children', () => {
	const { document, input } = rowOf(100);
	const prepared = prepareLayoutDocument(document);
	const result = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	expect(result.status).toBe(RegionCompositionStatus.Selected);
}, 120_000);

it('bounds candidate work for a 10 by 10 grid with 100 relations', () => {
	const { document, input } = gridOf(10, 10);
	const crossing = {
		...document,
		relations: [
			...document.nodes.slice(0, -1).map((node, index) => ({
				id: `edge-${index}`,
				from: node.id,
				to: `node-${index + 1}`,
			})),
			{ id: 'long-edge', from: 'node-0', to: 'node-99' },
		],
	};
	const prepared = prepareLayoutDocument(crossing);
	const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
	expect(result.status).toBe(GridCellLayoutStatus.Selected);
	if (result.status !== GridCellLayoutStatus.Selected) return;
	const explored = result.witness.phases.reduce((sum, phase) => sum + phase.exploredGeometries, 0);
	expect(explored).toBe(result.witness.attempted);
	expect(explored).toBeLessThanOrEqual(16 * crossing.relations.length);
}, 120_000);

it('bounds complete pipelines and validation work for 1,000 flat leaves', () => {
	const document = independentNodes(1_000);
	const prepared = prepareLayoutDocument(document);
	const { layout, witness } = layoutWithDedicatedEngineAndRankOrderWitness(
		prepared.graph,
		prepared.ranks,
		prepared.measurements,
	);
	expect(layout.elements).toHaveLength(document.nodes.length);
	expect(witness.work.completePipelines).toBeLessThanOrEqual(2 * document.nodes.length);
	expect(witness.work.validations).toBeLessThanOrEqual(2 * document.nodes.length);
	expect(witness.work.routeRunsInspected).toBeLessThanOrEqual(2 * document.nodes.length);
}, 120_000);

it('diagnoses stack depth 193 while selecting 265 shallow regions', () => {
	const deep = forestOf(1, 192);
	const preparedDeep = prepareLayoutDocument(deep.document);
	const unsupported = solveRecursiveNestedRegionLayout(
		preparedDeep.graph,
		preparedDeep.measurements,
		deep.input,
	);
	expect(unsupported).toMatchObject({
		status: RegionCompositionStatus.Unsupported,
		diagnostic: {
			code: RegionCompositionDiagnosticCode.StackDepthLimit,
			actual: 193,
			limit: 192,
		},
	});

	const shallow = shallowForestOf(192);
	const preparedShallow = prepareLayoutDocument(shallow.document);
	const selected = solveRecursiveNestedRegionLayout(
		preparedShallow.graph,
		preparedShallow.measurements,
		shallow.input,
	);
	expect(selected.status).toBe(RegionCompositionStatus.Selected);
}, 120_000);
