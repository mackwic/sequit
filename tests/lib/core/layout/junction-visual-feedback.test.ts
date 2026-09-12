import { expect, it } from 'vitest';

import { renderRelationPaths } from '../../../../src/app/web/ui/canvas/render-relations';
import { defined, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { routeSegments } from '../../../support/assertions/route-geometry';
import { junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';

it.each(Object.values(LayoutDirection))(
	'reserves arrow clearance and uniform ink around simple junctions in %s',
	async (direction) => {
		for (const fixture of [
			junctionFixtures.chain(direction),
			junctionFixtures.chain(direction, ['j1', 'j2']),
			junctionFixtures.parallel(direction),
		]) {
			const layout = await layoutNodes({ ...fixture.build(), direction });
			for (const relation of layout.relations) {
				const segments = routeSegments(relation);
				for (const segment of [defined(segments.at(0)), defined(segments.at(-1))])
					expect(segment.end - segment.start).toBeGreaterThanOrEqual(24);
			}
			expect(new Set(renderRelationPaths(layout.relations).map(({ color }) => color)).size).toBe(1);
		}
	},
);

it.each(Object.values(LayoutDirection))(
	'joins long arrivals horizontally into one maximal passage in %s',
	async (direction) => {
		const layout = await layoutNodes({
			...junctionFixtures.differentDepths(direction).build(),
			direction,
		});
		const axis = axesFor(direction).primary;
		const passages = ['c', 'd'].map((from) => {
			const relation = defined(
				layout.relations.find((relation) => relation.from === from && relation.to === 'j'),
			);
			return defined(
				routeSegments(relation)
					.filter((segment) => segment.axis === axis)
					.sort((a, b) => b.end - b.start - (a.end - a.start))[0],
			);
		});
		const [near, far] = passages.map((segment) => defined(segment));
		expect(defined(near).fixed).toBe(defined(far).fixed);
		expect(
			Math.min(defined(near).end, defined(far).end) -
				Math.max(defined(near).start, defined(far).start),
		).toBe(defined(near).end - defined(near).start);
	},
);
