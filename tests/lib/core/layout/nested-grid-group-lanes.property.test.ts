import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DocumentProjection } from '../../../../src/app/web/projection/document-projection';
import {
	defined,
	EndpointKind,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateGridCellLaneGeometry } from '../../../../src/lib/core/layout/grid-cell-lane-validation';
import { validateNestedRegionLeafIncidentsMessage as validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/nested-region-leaf-incident-validation';
import { NestedRegionLocalLayoutCache } from '../../../../src/lib/core/layout/nested-region-local-cache';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import { NestedRegionLayoutStatus } from '../../../../src/lib/core/layout/nested-region-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import type { LayoutMeasurementOverrides } from '../../../support/builders/layout-measurements';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { contains, prepareLayoutDocument } from '../../../support/harnesses/layout';
import { nestedGridGroupLanesDocument } from './nested-grid-group-lanes-fixture';

const fractional = (minimum: number, maximum: number) =>
	fc.integer({ min: minimum, max: maximum }).map((value) => value + 0.25);

const scenario = fc.record({
	groupWidth: fractional(220, 480),
	groupHeight: fractional(130, 310),
	memberWidth: fractional(90, 170),
	laneWidth: fractional(100, 220),
	trackGrowth: fractional(25, 150),
	permute: fc.boolean(),
});

interface Scenario {
	readonly groupWidth: number;
	readonly groupHeight: number;
	readonly memberWidth: number;
	readonly laneWidth: number;
	readonly trackGrowth: number;
	readonly permute: boolean;
}

function measurements(
	values: Scenario,
	growGroup: boolean,
	growLane: boolean,
): LayoutMeasurementOverrides {
	let groupWidth = values.groupWidth;
	if (growGroup) groupWidth += 40.5;
	let laneWidth = values.laneWidth;
	if (growLane) laneWidth += 28.5;
	return {
		nodes: {
			'a-target': { width: 132.5, height: 64.75 },
			b2: { width: laneWidth, height: 68.5 },
			c: { width: values.memberWidth, height: 64.25 },
		},
		groups: {
			'c-group': {
				minimumWidth: groupWidth,
				minimumHeight: values.groupHeight,
				headerHeight: 36.25,
				padding: 24.5,
			},
		},
	};
}

function withWiderTracks(document: LogicDocument, growth: number): LogicDocument {
	const presentation = defined(document.regionPresentation);
	return {
		...document,
		regionPresentation: {
			...presentation,
			regions: presentation.regions.map((region) => {
				if (region.id !== 'grid') return region;
				const grid = defined(region.grid);
				return {
					...region,
					grid: {
						...grid,
						minimumColumnWidths: [700 + growth, 100.5] as const,
						minimumRowHeights: [50.25, 300 + growth] as const,
					},
				};
			}),
		},
	};
}

function withLaneLabel(document: LogicDocument): LogicDocument {
	const presentation = defined(document.regionPresentation);
	return {
		...document,
		regionPresentation: {
			...presentation,
			regions: presentation.regions.map((region) => {
				if (region.id !== 'b') return region;
				const lanes = defined(region.lanePresentation);
				return {
					...region,
					lanePresentation: {
						...lanes,
						lanes: lanes.lanes.map((lane) => {
							if (lane.id !== 'right') return lane;
							return { ...lane, label: 'Right edited' };
						}),
					},
				};
			}),
		},
	};
}

function permute(document: LogicDocument): LogicDocument {
	const presentation = defined(document.regionPresentation);
	return {
		...document,
		groups: [...document.groups].reverse(),
		nodes: [...document.nodes].reverse(),
		relations: [...document.relations].reverse(),
		regionPresentation: {
			...presentation,
			regions: [...presentation.regions].reverse().map((region) => {
				if (region.grid === undefined) return region;
				return { ...region, grid: { ...region.grid, cells: [...region.grid.cells].reverse() } };
			}),
		},
	};
}

async function checkSelection(
	document: LogicDocument,
	overrides: LayoutMeasurementOverrides,
	cache: NestedRegionLocalLayoutCache,
	projection: DocumentProjection,
): Promise<void> {
	const prepared = prepareLayoutDocument(document, overrides);
	const input = nestedRegionInput(prepared.graph);
	const normalized = normalizeRegionCompositionModel(prepared.graph, input);
	expect(normalized.status).toBe(RegionCompositionModelStatus.Ready);
	if (normalized.status !== RegionCompositionModelStatus.Ready) return;
	expect(normalized.model.leafByEndpointId.get('c-group')).toBe('c');
	expect(normalized.model.leafByEndpointId.get('b2')).toBe('b');
	const incremental = solveRecursiveNestedRegionLayout(
		prepared.graph,
		prepared.measurements,
		input,
		cache,
	);
	if (incremental.status !== NestedRegionLayoutStatus.Selected)
		throw new Error(`Expected selected mixed grid: ${incremental.status}: ${incremental.reason}`);
	expect(validateRegionCompositionGeometry(normalized.model, incremental)).toBeUndefined();
	expect(validateNestedRegionLeafIncidents(normalized.model, incremental)).toBeUndefined();
	expect(
		incremental.ownedRoutes
			.filter(({ relationId }) => relationId === 'across-grid')
			.map(({ regionId }) => regionId),
	).toEqual(['a', 'grid', 'd']);
	expect(
		incremental.ownedRoutes
			.filter(({ relationId }) => relationId === 'inside-b')
			.map(({ regionId }) => regionId),
	).toEqual(['b']);
	const cellIds = new Set(['a', 'b', 'c', 'd']);
	const cells = incremental.regions.filter(({ id }) => cellIds.has(id));
	expect(validateGridCellLaneGeometry({ cells, layout: incremental.layout })).toBeUndefined();
	const groupedCell = defined(cells.find(({ id }) => id === 'c'));
	const group = defined(incremental.layout.elements.find(({ id }) => id === 'c-group'));
	const member = defined(incremental.layout.elements.find(({ id }) => id === 'c'));
	expect(contains(groupedCell.bounds, group.bounds)).toBe(true);
	expect(contains(group.bounds, member.bounds)).toBe(true);
	const laneCell = defined(cells.find(({ id }) => id === 'b'));
	expect(incremental.layout.lanes).toHaveLength(2);
	for (const lane of incremental.layout.lanes ?? []) {
		expect(lane.regionId).toBe('b');
		expect(contains(laneCell.bounds, lane.bounds)).toBe(true);
	}
	const cold = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	expect(incremental).toEqual(cold);
	const reordered = permute(document);
	const reorderedPrepared = prepareLayoutDocument(reordered, overrides);
	expect(
		solveRecursiveNestedRegionLayout(
			reorderedPrepared.graph,
			reorderedPrepared.measurements,
			nestedRegionInput(reorderedPrepared.graph),
		),
	).toEqual(cold);
	projection.update(document);
	const projected = await projection.createCanvasModel(prepared.measurements);
	const coldProjection = await new DocumentProjection(document).createCanvasModel(
		prepared.measurements,
	);
	expect(projected).toEqual(coldProjection);
}

describe('a grouped cell beside local lanes in a persisted nested grid', () => {
	it.each([0, 1])(
		'keeps every geometry selected and incremental equal to cold through fractional edits, batch %i',
		async (batch) => {
			const parameters = {
				...PROPERTY_PARAMETERS,
				numRuns: PROPERTY_PARAMETERS.numRuns / 2,
			};
			if (PROPERTY_PARAMETERS.seed !== undefined)
				parameters.seed = PROPERTY_PARAMETERS.seed + batch;
			await fc.assert(
				fc.asyncProperty(scenario, async (values) => {
					const base = nestedGridGroupLanesDocument();
					const widened = withWiderTracks(base, values.trackGrowth);
					const relabeled = withLaneLabel(widened);
					const cache = new NestedRegionLocalLayoutCache();
					const projection = new DocumentProjection(base);
					const states = [
						{ document: base, overrides: measurements(values, false, false) },
						{ document: base, overrides: measurements(values, true, false) },
						{ document: widened, overrides: measurements(values, true, false) },
						{ document: relabeled, overrides: measurements(values, true, true) },
					];
					for (const [index, state] of states.entries()) {
						let document = state.document;
						if (values.permute && index % 2 === 1) document = permute(document);
						await checkSelection(document, state.overrides, cache, projection);
					}
				}),
				parameters,
			);
		},
	);

	it('keeps a grouped member inside a lane cell explicitly unsupported', () => {
		const source = nestedGridGroupLanesDocument();
		const grouped: LogicDocument = {
			...source,
			groups: [
				...source.groups,
				{
					kind: EndpointKind.Group,
					id: 'b-group',
					label: 'Unsupported lane group',
					regionId: 'b',
					laneId: 'left',
					layoutOrder: orderKey('a8'),
				},
			],
			nodes: source.nodes.map((node) => {
				if (node.id !== 'b') return node;
				const member = { ...node, groupId: 'b-group' };
				delete member.regionId;
				delete member.laneId;
				return member;
			}),
		};
		const prepared = prepareLayoutDocument(grouped);
		const result = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			nestedRegionInput(prepared.graph),
		);
		expect(result).toEqual({
			status: NestedRegionLayoutStatus.Unsupported,
			reason: 'Groups with descendants are outside the first shared layout policy.',
		});
	});
});
