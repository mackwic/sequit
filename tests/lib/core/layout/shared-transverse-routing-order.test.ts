import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import {
	defined,
	LaneOrientation,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { prepareSharedLanes } from '../../../../src/lib/core/layout/lanes/shared-lane-model';
import { planSharedLanePorts } from '../../../../src/lib/core/layout/lanes/shared-lane-ports';
import { makeTransverseLaneFrame } from '../../../../src/lib/core/layout/lanes/shared-transverse-frame';
import {
	allocateTransverseRoutes,
	routeTransverseLanes,
	TransverseRouteOrder,
} from '../../../../src/lib/core/layout/lanes/shared-transverse-routing';
import type { LayoutRelation } from '../../../../src/lib/core/layout/layout-types';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { configurations, documentFor } from './shared-lane-port-fixture';

function routesFor(document: LogicDocument): readonly LayoutRelation[] {
	const prepared = prepareLayoutDocument(document);
	const input = defined(
		prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
	);
	const ports = planSharedLanePorts(input);
	const frame = makeTransverseLaneFrame(input, ports);
	const allocation = allocateTransverseRoutes(input, frame, TransverseRouteOrder.Canonical);
	return routeTransverseLanes(input, frame, allocation, TransverseRouteOrder.Canonical);
}

function routesWithoutIds(routes: readonly LayoutRelation[]) {
	return routes
		.map(({ from, to, points }) => ({ from, to, points }))
		.toSorted(
			(left, right) =>
				compareCanonicalStrings(left.from, right.from) ||
				compareCanonicalStrings(left.to, right.to),
		);
}

describe('transverse shared lane routing order', () => {
	it('keeps canonical tracks fixed when two documentary route IDs are exchanged', () => {
		const base = documentFor(
			defined(configurations[0]),
			LaneOrientation.Transverse,
			[
				['a1', 'A'],
				['a2', 'A'],
				['b1', 'B'],
				['c1', 'C'],
			],
			[
				['a1', 'c1'],
				['a2', 'c1'],
			],
		);
		const document = {
			...base,
			relations: base.relations.map((relation, index) => {
				let id = 'a-route';
				if (index === 0) id = 'z-route';
				return { ...relation, id };
			}),
		};
		const renamed = {
			...document,
			relations: document.relations.map((relation, index) => {
				let id = 'z-route';
				if (index === 0) id = 'a-route';
				return { ...relation, id };
			}),
		};

		expect(routesWithoutIds(routesFor(renamed))).toEqual(routesWithoutIds(routesFor(document)));
	});
});
