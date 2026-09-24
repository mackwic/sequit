import { describe, expect, it } from 'vitest';

import {
	defined,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutPolicy,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { RegionCompositionStatus } from '../../../../src/lib/core/layout/region-composition-types';
import { RegionIncidentUnknownCode } from '../../../../src/lib/core/layout/region-incident-contract';
import { solveDedicatedRegionLeafWithIncidents } from '../../../../src/lib/core/layout/region-leaf-incident-solver';
import {
	InvalidRegionLeafGraphError,
	solveRegionLeafLayout,
	solveRegionLeafLayoutWithIncidents,
	UnsupportedRegionLeafLayoutError,
} from '../../../../src/lib/core/layout/region-leaf-layout';
import { regionLeafPolicy } from '../../../../src/lib/core/layout/region-leaf-policy';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/region-local-cache';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import { regionDocument } from './nested-region-fixture';

function laneLeafDocument() {
	const source = regionDocument();
	const node = defined(source.nodes.find(({ id }) => id === 'c'));
	const other = defined(source.nodes.find(({ id }) => id === 'b'));
	return {
		...source,
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		nodes: [
			{ ...node, laneId: 'L' },
			{ ...other, laneId: 'R' },
		],
		relations: [],
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.SharedLanes,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: [
				{ id: 'L', label: 'L', layoutOrder: orderKey('a0') },
				{ id: 'R', label: 'R', layoutOrder: orderKey('a1') },
			],
		},
	};
}

describe('incident-aware leaf dispatch', () => {
	it('rejects a dangling relation in a lane leaf before route search', () => {
		const valid = laneLeafDocument();
		const measurements = layoutMeasurementsFor(valid);
		const dangling = {
			...valid,
			relations: [{ id: 'dangling', from: 'missing', to: 'c' }],
		};
		expect(() =>
			solveRegionLeafLayoutWithIncidents({
				document: dangling,
				measurements,
				leafPolicy: LayoutPolicy.SharedLanes,
				contracts: [],
			}),
		).toThrow(InvalidRegionLeafGraphError);
	});

	it('rejects the same dangling relation in the raw and incident-aware dedicated leaf', () => {
		const source = regionDocument();
		const measurements = layoutMeasurementsFor(source);
		const dangling = {
			...source,
			relations: [...source.relations, { id: 'dangling', from: 'missing', to: 'c' }],
		};
		expect(() =>
			solveRegionLeafLayout({
				document: dangling,
				measurements,
				leafPolicy: LayoutPolicy.Layered,
			}),
		).toThrow(InvalidRegionLeafGraphError);
		expect(() =>
			solveDedicatedRegionLeafWithIncidents({ document: dangling, measurements, contracts: [] }),
		).toThrow(InvalidRegionLeafGraphError);
	});

	it('rejects an explicit policy and presentation mismatch before reading or filling the cache', () => {
		const dedicated = regionDocument();
		const lane = laneLeafDocument();
		const cache = new RegionLocalLayoutCache();
		for (const [document, leafPolicy] of [
			[dedicated, LayoutPolicy.SharedLanes],
			[lane, LayoutPolicy.Layered],
		] as const) {
			const measurements = layoutMeasurementsFor(document);
			const attempt = solveRegionLeafLayoutWithIncidents({
				document,
				measurements,
				leafPolicy,
				cache,
				contracts: [],
			});
			expect(attempt).toMatchObject({
				status: RegionCompositionStatus.Unknown,
				code: RegionIncidentUnknownCode.UnsupportedLeafPolicy,
				witness: { attempted: 0, exhaustive: true, rejectedAlternatives: [] },
			});
			expect(() => solveRegionLeafLayout({ document, measurements, leafPolicy, cache })).toThrow(
				UnsupportedRegionLeafLayoutError,
			);
		}
		expect(
			solveDedicatedRegionLeafWithIncidents({
				document: lane,
				measurements: layoutMeasurementsFor(lane),
				contracts: [],
				cache,
			}),
		).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionIncidentUnknownCode.UnsupportedLeafPolicy,
		});
		expect(cache.stats).toMatchObject({ entries: 0, hits: 0, misses: 0 });
	});

	it('shares a complete zero-incident cache entry between both leaf entrypoints', () => {
		for (const [document, leafPolicy] of [
			[regionDocument(), LayoutPolicy.Layered],
			[laneLeafDocument(), LayoutPolicy.SharedLanes],
		] as const) {
			const measurements = layoutMeasurementsFor(document);
			const cache = new RegionLocalLayoutCache();
			const raw = solveRegionLeafLayout({ document, measurements, leafPolicy, cache });
			const aware = solveRegionLeafLayoutWithIncidents({
				document,
				measurements,
				leafPolicy,
				cache,
				contracts: [],
			});
			expect(aware.status).toBe(RegionCompositionStatus.Selected);
			if (aware.status !== RegionCompositionStatus.Selected) throw new Error(aware.reason);
			expect(aware.layout).toEqual(raw.layout);
			expect(aware.ranks).toEqual(raw.ranks);
			expect(aware.incidents).toEqual([]);
			expect(cache.stats).toMatchObject({ entries: 1, misses: 1, hits: 1 });
		}
	});

	it('takes the explicit region policy before any legacy presentation fallback', () => {
		const lanePresentation = laneLeafDocument().presentation;
		expect(regionLeafPolicy({ lanePresentation })).toBe(LayoutPolicy.SharedLanes);
		expect(regionLeafPolicy({ policy: LayoutPolicy.Layered, lanePresentation })).toBe(
			LayoutPolicy.Layered,
		);
		expect(regionLeafPolicy({ policy: LayoutPolicy.SharedLanes })).toBe(LayoutPolicy.SharedLanes);
	});
});
