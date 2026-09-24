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
import { solveDedicatedRegionLeafWithIncidents } from '../../../../src/lib/core/layout/region-leaf-incident-solver';
import {
	InvalidRegionLeafGraphError,
	solveRegionLeafLayout,
	solveRegionLeafLayoutWithIncidents,
} from '../../../../src/lib/core/layout/region-leaf-layout';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import { regionDocument } from './nested-region-fixture';

describe('incident-aware leaf dispatch', () => {
	it('rejects a dangling relation in a lane leaf before route search', () => {
		const source = regionDocument();
		const node = defined(source.nodes.find(({ id }) => id === 'c'));
		const valid = {
			...source,
			persistenceFormat: LANE_PERSISTENCE_FORMAT,
			nodes: [{ ...node, laneId: 'L' }],
			relations: [],
			presentation: {
				schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
				policy: LayoutPolicy.Layered,
				laneOrientation: LaneOrientation.Parallel,
				growth: LaneGrowth.Auto,
				lanes: [{ id: 'L', label: 'L', layoutOrder: orderKey('a0') }],
			},
		};
		const measurements = layoutMeasurementsFor(valid);
		const dangling = {
			...valid,
			relations: [{ id: 'dangling', from: 'missing', to: 'c' }],
		};
		expect(() =>
			solveRegionLeafLayoutWithIncidents({
				document: dangling,
				measurements,
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
		expect(() => solveRegionLeafLayout(dangling, measurements)).toThrow(
			InvalidRegionLeafGraphError,
		);
		expect(() =>
			solveDedicatedRegionLeafWithIncidents({ document: dangling, measurements, contracts: [] }),
		).toThrow(InvalidRegionLeafGraphError);
	});
});
