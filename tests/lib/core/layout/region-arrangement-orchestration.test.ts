import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import type { SolvedRecursiveRegion } from '../../../../src/lib/core/layout/nested-region-recursive-geometry';
import type { RecursiveContext } from '../../../../src/lib/core/layout/nested-region-recursive-model-adapter';
import type { RegionArrangement } from '../../../../src/lib/core/layout/region-arrangement';
import { solveArrangedRegion } from '../../../../src/lib/core/layout/region-arrangement-orchestration';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';
import { RegionIncidentRole } from '../../../../src/lib/core/layout/region-incident-contract';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { persistedNestedGridWithTwoOuterIncidentsDocument } from './nested-region-fixture';

const EMPTY_CHILD: SolvedRecursiveRegion = {
	layout: { width: 100, height: 100, elements: [], relations: [] },
	ranks: { byEndpointId: new Map(), bands: [] },
	regions: [],
	portals: [],
	ownedRoutes: [],
	incidentPaths: new Map(),
};

function contextFor(side: RegionPortalSide): RecursiveContext {
	const prepared = prepareLayoutDocument(persistedNestedGridWithTwoOuterIncidentsDocument());
	const normalized = normalizeRegionCompositionModel(
		prepared.graph,
		nestedRegionInput(prepared.graph),
	);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error('Expected a normalized grid source.');
	return {
		graph: prepared.graph,
		model: normalized.model,
		measurements: prepared.measurements,
		cache: undefined,
		ownershipByRelationId: new Map(
			normalized.model.relations.map((owned) => [owned.relation.id, owned]),
		),
		dispositionSideByRegionId: new Map([['grid', side]]),
	};
}

describe('common region arrangement orchestration', () => {
	it.each([
		[RegionPortalSide.Left, RegionPortalSide.Left],
		[RegionPortalSide.Right, RegionPortalSide.Right],
	] as const)(
		'passes a %s preference and inherited contracts to the grid disposition',
		(side, expected) => {
			const requests: {
				readonly relationId: string;
				readonly role: RegionIncidentRole;
				readonly side: RegionPortalSide;
			}[] = [];
			const childRequests = new Map<string, ReadonlyMap<string, readonly RegionPortalSide[]>>();
			const arrangement: RegionArrangement<number> = {
				incidentSides(input) {
					requests.push({
						relationId: input.relation.id,
						role: input.role,
						side: input.preferredSide,
					});
					expect(input.inheritedSides).toBeDefined();
					return [input.preferredSide];
				},
				place(input) {
					expect(input.children.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
					expect(input.preferredSide).toBe(expected);
					return 42;
				},
				route(input) {
					expect(input.placement).toBe(42);
					expect(input.preferredSide).toBe(expected);
					return EMPTY_CHILD;
				},
			};
			const result = solveArrangedRegion({
				context: contextFor(side),
				regionId: 'grid',
				incidentSides: new Map([
					['z-left-exit', [RegionPortalSide.Top]],
					['a-right-exit', [RegionPortalSide.Bottom]],
				]),
				arrangement,
				solveChild(_context, childId, sides) {
					childRequests.set(childId, sides);
					return EMPTY_CHILD;
				},
			});
			expect(result).toBe(EMPTY_CHILD);
			expect(requests).toEqual([
				{ relationId: 'z-left-exit', role: RegionIncidentRole.Source, side: expected },
				{ relationId: 'a-right-exit', role: RegionIncidentRole.Source, side: expected },
			]);
			expect(defined(childRequests.get('a')).get('z-left-exit')).toEqual([expected]);
			expect(defined(childRequests.get('b')).get('a-right-exit')).toEqual([expected]);
			expect(defined(childRequests.get('c')).size).toBe(0);
			expect(defined(childRequests.get('d')).size).toBe(0);
		},
	);
});
