import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import {
	defined,
	LaneOrientation,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { makeSharedLaneFrame } from '../../../../src/lib/core/layout/lanes/shared-lane-frame';
import { prepareSharedLanes } from '../../../../src/lib/core/layout/lanes/shared-lane-model';
import { planSharedLanePorts } from '../../../../src/lib/core/layout/lanes/shared-lane-ports';
import {
	allocateParallelRoutes,
	ParallelRouteOrder,
	routeSharedLanes,
} from '../../../../src/lib/core/layout/lanes/shared-lane-routing';
import type { LayoutRelation } from '../../../../src/lib/core/layout/layout-types';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { configurations, documentFor } from './shared-lane-port-fixture';

function routesFor(document: LogicDocument): readonly LayoutRelation[] {
	const prepared = prepareLayoutDocument(document);
	const input = defined(
		prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
	);
	const ports = planSharedLanePorts(input);
	const frame = makeSharedLaneFrame(input, ports, false);
	return routeSharedLanes(
		input,
		frame,
		allocateParallelRoutes(frame),
		ParallelRouteOrder.Canonical,
	);
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

describe('shared lane cross-lane frame ordering', () => {
	it('keeps route tracks fixed when relation IDs reverse tied row-pair plans', () => {
		const document = documentFor(
			defined(configurations[0]),
			LaneOrientation.Parallel,
			[
				['a1', 'A'],
				['a2', 'A'],
				['b1', 'B'],
				['b2', 'B'],
			],
			[
				['a1', 'b1'],
				['a1', 'b2'],
				['a2', 'b1'],
				['a2', 'b2'],
			],
		);
		const renamed: LogicDocument = {
			...document,
			relations: document.relations.map((relation, index) => ({
				...relation,
				id: `route-${document.relations.length - index}`,
			})),
		};

		expect(routesWithoutIds(routesFor(renamed))).toEqual(routesWithoutIds(routesFor(document)));
	});
});
