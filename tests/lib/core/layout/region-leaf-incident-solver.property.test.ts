import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { disallowedRouteContacts } from '../../../../src/lib/core/layout/bridges/bridge-contact';
import { solveDedicatedRegionLeafWithIncidents } from '../../../../src/lib/core/layout/regions/leaf/region-leaf-incident-solver';
import {
	RegionCompositionStatus,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	type RegionIncidentContract,
	RegionIncidentRole,
} from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { independentNodes } from '../../../support/performance/layout-resource-scenarios';
import { depthTwoRegionDocument } from './nested-region-fixture';

const sample = fc.record({
	side: fc.constantFrom(...Object.values(RegionPortalSide)),
	count: fc.integer({ min: 1, max: 4 }),
	roleMask: fc.integer({ min: 0, max: 15 }),
	width: fc.integer({ min: 40, max: 300 }),
	height: fc.integer({ min: 40, max: 200 }),
});

describe('dedicated leaf incident invariants', () => {
	it('keeps all declared incident routes separate across sides, roles and metric edits', () => {
		fc.assert(
			fc.property(sample, ({ side, count, roleMask, width, height }) => {
				const source = depthTwoRegionDocument();
				const document = {
					...source,
					nodes: source.nodes.filter(({ id }) => id === 'c'),
					relations: [],
				};
				const base = prepareLayoutDocument(document).measurements;
				const measurements = {
					...base,
					nodes: new Map([['c', { width, height }]]),
				};
				const contracts: RegionIncidentContract[] = Array.from({ length: count }, (_, index) => {
					const id = `cross-${index}`;
					let role = RegionIncidentRole.Target;
					if ((roleMask & (1 << index)) !== 0) role = RegionIncidentRole.Source;
					let relation = { id, from: `outside-${index}`, to: 'c' };
					if (role === RegionIncidentRole.Source)
						relation = { id, from: 'c', to: `outside-${index}` };
					return { relation, endpointId: 'c', role, allowedSides: [side] };
				});
				const input = { document, measurements, contracts };
				const cold = solveDedicatedRegionLeafWithIncidents(input);
				const cache = new RegionLocalLayoutCache();
				const first = solveDedicatedRegionLeafWithIncidents({ ...input, cache });
				const repeat = solveDedicatedRegionLeafWithIncidents({
					...input,
					contracts: contracts.toReversed(),
					cache,
				});
				expect(first).toEqual(cold);
				expect(repeat).toEqual(cold);
				const editedMeasurements = {
					...measurements,
					nodes: new Map([['c', { width: width + 1, height }]]),
				};
				const editedInput = { ...input, measurements: editedMeasurements };
				expect(solveDedicatedRegionLeafWithIncidents({ ...editedInput, cache })).toEqual(
					solveDedicatedRegionLeafWithIncidents(editedInput),
				);
				expect(solveDedicatedRegionLeafWithIncidents({ ...input, cache })).toEqual(cold);
				if (cold.status !== RegionCompositionStatus.Selected) throw new Error(cold.reason);
				expect(cold.incidents).toHaveLength(count);
				for (const [index, path] of cold.incidents.entries()) {
					expect(path.side).toBe(side);
					expect(path.points[0]).toEqual(path.anchor);
					expect(path.points.at(-1)).toEqual(path.portal);
					for (const other of cold.incidents.slice(index + 1))
						expect(
							disallowedRouteContacts(
								{ id: path.relationId, points: path.points },
								{ id: other.relationId, points: other.points },
								[],
							).length > 0,
						).toBe(false);
				}
				expect(defined(cold.layout.elements[0]).id).toBe('c');
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('selects complete nine-plus incident leaves independently of contract permutation', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 9, max: 12 }),
				fc.constantFrom(RegionPortalSide.Top, RegionPortalSide.Bottom),
				(count, side) => {
					const document = independentNodes(count);
					const measurements = prepareLayoutDocument(document).measurements;
					const contracts: RegionIncidentContract[] = document.nodes.map((node, index) => ({
						relation: { id: `outside-${index}`, from: node.id, to: 'foreign' },
						endpointId: node.id,
						role: RegionIncidentRole.Source,
						allowedSides: [side],
					}));
					const input = { document, measurements, contracts };
					const cold = solveDedicatedRegionLeafWithIncidents(input);
					const cache = new RegionLocalLayoutCache();
					expect(solveDedicatedRegionLeafWithIncidents({ ...input, cache })).toEqual(cold);
					expect(
						solveDedicatedRegionLeafWithIncidents({
							...input,
							contracts: contracts.toReversed(),
							cache,
						}),
					).toEqual(cold);
					if (cold.status !== RegionCompositionStatus.Selected) throw new Error(cold.reason);
					expect(cold.incidents).toHaveLength(count);
					expect(cold.witness.attempted).toBeGreaterThanOrEqual(count);
					for (const [index, route] of cold.incidents.entries())
						for (const other of cold.incidents.slice(index + 1))
							expect(
								disallowedRouteContacts(
									{ id: route.relationId, points: route.points },
									{ id: other.relationId, points: other.points },
									[],
								),
							).toEqual([]);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
});
