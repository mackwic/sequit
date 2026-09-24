import { describe, expect, it } from 'vitest';

import { defined, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { ROOT_LAYOUT_REGION_ID } from '../../../../src/lib/core/document/region-presentation';
import { validateGridCellLaneGeometry } from '../../../../src/lib/core/layout/grid-cell-lane-validation';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import {
	type NestedRegionInput,
	NestedRegionLayoutStatus,
	type NestedRegionSelected,
} from '../../../../src/lib/core/layout/nested-region-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { persistedNestedGridWithLaneCellDocument } from './nested-region-fixture';

type PublishedLane = NonNullable<LayoutResult['lanes']>[number];

function regionInput(document: LogicDocument): NestedRegionInput {
	const presentation = defined(document.regionPresentation);
	return {
		regions: [
			{ id: ROOT_LAYOUT_REGION_ID, layoutOrder: 'a0' },
			...presentation.regions.map((region) => {
				if (region.parentId !== undefined) return region;
				return { ...region, parentId: ROOT_LAYOUT_REGION_ID };
			}),
		],
		regionByEndpointId: new Map(
			[...document.nodes, ...document.groups, ...document.junctions].map(({ id, regionId }) => [
				id,
				defined(regionId),
			]),
		),
	};
}

function selectedLaneFixture() {
	const document = persistedNestedGridWithLaneCellDocument();
	const prepared = prepareLayoutDocument(document);
	const input = regionInput(document);
	const selected = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	if (selected.status !== NestedRegionLayoutStatus.Selected)
		throw new Error(`Expected a selected lane cell: ${selected.status}: ${selected.reason}`);
	const normalized = normalizeRegionCompositionModel(prepared.graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error('Expected a normalized region composition.');
	const cells = selected.regions
		.filter(({ parentId }) => parentId === 'grid')
		.map((cell) => ({
			id: cell.id,
			bounds: cell.bounds,
			translation: defined(cell.translation),
			localLayout: defined(cell.localLayout),
		}));
	return { selected, model: normalized.model, cells };
}

function withFirstGlobalLane(
	selected: NestedRegionSelected,
	change: (lane: PublishedLane) => PublishedLane,
): NestedRegionSelected {
	const lanes = defined(selected.layout.lanes);
	return {
		...selected,
		layout: {
			...selected.layout,
			lanes: lanes.map((lane, index) => {
				if (index === 0) return change(lane);
				return lane;
			}),
		},
	};
}

describe('selected grid lane geometry falsifications', () => {
	it('rejects a wrong owner in either the cell layout or the composed grid', () => {
		const { selected, cells } = selectedLaneFixture();
		expect(validateGridCellLaneGeometry({ cells, layout: selected.layout })).toBeUndefined();
		const localOwner = cells.map((cell) => {
			if (cell.id !== 'b') return cell;
			const lanes = defined(cell.localLayout.lanes);
			return {
				...cell,
				localLayout: {
					...cell.localLayout,
					lanes: lanes.map((lane, index) => {
						if (index === 0) return { ...lane, regionId: 'a' };
						return lane;
					}),
				},
			};
		});
		expect(validateGridCellLaneGeometry({ cells: localOwner, layout: selected.layout })).toBe(
			'Lane left has the wrong cell owner.',
		);
		const wrongPublishedOwner = withFirstGlobalLane(selected, (lane) => ({
			...lane,
			regionId: 'a',
		}));
		expect(validateGridCellLaneGeometry({ cells, layout: wrongPublishedOwner.layout })).toBe(
			'Lane left has the wrong cell owner.',
		);
	});

	it('rejects changed lane identity, label, and translated bounds', () => {
		const { selected, cells } = selectedLaneFixture();
		for (const changed of [
			withFirstGlobalLane(selected, (lane) => ({ ...lane, id: 'renamed' })),
			withFirstGlobalLane(selected, (lane) => ({ ...lane, label: 'Renamed' })),
			withFirstGlobalLane(selected, (lane) => ({
				...lane,
				bounds: { ...lane.bounds, x: lane.bounds.x + 1 },
			})),
			withFirstGlobalLane(selected, (lane) => ({
				...lane,
				bounds: { ...lane.bounds, x: Number.NaN },
			})),
		])
			expect(validateGridCellLaneGeometry({ cells, layout: changed.layout })).toBe(
				'Lane left differs from its cell layout.',
			);
	});
});

describe('selected region lane geometry falsifications', () => {
	it('rejects a leaf lane with a foreign owner or changed published identity', () => {
		const { selected, model } = selectedLaneFixture();
		expect(validateRegionCompositionGeometry(model, selected)).toBeUndefined();
		const invalidLocalOwner: NestedRegionSelected = {
			...selected,
			regions: selected.regions.map((region) => {
				if (region.id !== 'b') return region;
				const localLayout = defined(region.localLayout);
				return {
					...region,
					localLayout: {
						...localLayout,
						lanes: defined(localLayout.lanes).map((lane, index) => {
							if (index === 0) return { ...lane, regionId: 'a' };
							return lane;
						}),
					},
				};
			}),
		};
		expect(validateRegionCompositionGeometry(model, invalidLocalOwner)).toBe(
			'Lane left differs from its leaf layout.',
		);
		for (const changed of [
			withFirstGlobalLane(selected, (lane) => ({ ...lane, id: 'renamed' })),
			withFirstGlobalLane(selected, (lane) => ({ ...lane, label: 'Renamed' })),
		])
			expect(validateRegionCompositionGeometry(model, changed)).toBe(
				'Lane left differs from its leaf layout.',
			);
	});

	it('rejects a lane moved within its leaf and a lane with non-finite bounds', () => {
		const { selected, model } = selectedLaneFixture();
		const shifted = withFirstGlobalLane(selected, (lane) => ({
			...lane,
			bounds: { ...lane.bounds, x: lane.bounds.x + 1 },
		}));
		expect(validateRegionCompositionGeometry(model, shifted)).toBe(
			'Lane left differs from its translated leaf layout.',
		);
		const nonFinite = withFirstGlobalLane(selected, (lane) => ({
			...lane,
			bounds: { ...lane.bounds, x: Number.NaN },
		}));
		expect(validateRegionCompositionGeometry(model, nonFinite)).toBe(
			'Lane left leaves its leaf region b.',
		);
	});

	it('rejects missing and spurious global lanes independently', () => {
		const { selected, model } = selectedLaneFixture();
		const lanes = defined(selected.layout.lanes);
		const missing: NestedRegionSelected = {
			...selected,
			layout: { ...selected.layout, lanes: lanes.slice(1) },
		};
		expect(validateRegionCompositionGeometry(model, missing)).toBe(
			'Leaf region b does not publish each local lane exactly once.',
		);
		const unknown: NestedRegionSelected = {
			...selected,
			layout: {
				...selected.layout,
				lanes: [...lanes, { ...defined(lanes[0]), id: 'unknown', regionId: 'outside-grid' }],
			},
		};
		expect(validateRegionCompositionGeometry(model, unknown)).toBe(
			'The composed canvas has an unknown or duplicate lane.',
		);
	});
});
