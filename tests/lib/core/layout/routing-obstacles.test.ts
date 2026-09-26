import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { scenario as junctionCrossingObstacle } from '../../../scenarios/visual/routing/junction-crossing-obstacle.scenario';
import { scenario as junctionObstacle } from '../../../scenarios/visual/routing/junction-obstacle.scenario';
import { scenario as wideGroupObstacle } from '../../../scenarios/visual/routing/wide-group-obstacle.scenario';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { routeSegments } from '../../../support/assertions/route-geometry';
import { extent } from '../../../support/assertions/routing-measurements';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import {
	junctionObstacle as junctionFixture,
	wideGroupObstacle as groupFixture,
} from '../../../support/fixtures/routing-obstacles';
import { layoutDocument } from '../../../support/harnesses/layout';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { layoutWideGroupObstacle } from '../../../support/harnesses/layout-wide-group-obstacle';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { VisualLayout } from '../../../support/harnesses/visual-layout';

const physicalSize = fc.record({
	width: fc.integer({ min: 80, max: 280 }),
	height: fc.integer({ min: 40, max: 180 }),
});

function keepsRowOrder(layout: VisualLayout): void {
	const axis = axesFor(layout.direction).transverse;
	let dimension: 'width' | 'height' = 'width';
	if (axis === 'y') dimension = 'height';
	for (const row of [
		['p', 'q', 's'],
		['u', 'v', 'w', 'g', 'x'],
	]) {
		for (let index = 1; index < row.length; index += 1) {
			const before = layout.getById(defined(row[index - 1])).bounds;
			const after = layout.getById(defined(row[index])).bounds;
			expect(after[axis] - before[axis] - before[dimension]).toBeGreaterThanOrEqual(36);
		}
	}
}

function keepsLocalBranches(layout: VisualLayout): void {
	const axis = axesFor(layout.direction).transverse;
	for (const [from, to] of [
		['u', 'p'],
		['v', 'p'],
	] as const)
		AssertLayout(layout)
			.route(`${from}-to-${to}`)
			.staysWithin(layout.envelopeOf([from, to]), { axis });
}

describe.each(LAYOUT_CONFIGURATIONS)(
	'foreign routing obstacles in $direction / $bias',
	({ direction, bias }) => {
		it.each([junctionObstacle, wideGroupObstacle, junctionCrossingObstacle])(
			'preserves the visual contract for $id',
			async (scenario) => {
				scenario.assert(await scenario.arrange(direction, bias));
			},
		);

		it('leaves the endpoint envelope when a wide intermediate box closes every local passage', async () => {
			const axes = axesFor(direction);
			let obstacleSize = { width: 360, height: 60 };
			if (axes.transverse === 'y') obstacleSize = { width: 60, height: 360 };
			const fixture = graphFixtures
				.routingNodes(['a'], direction)
				.nodes(['b'], obstacleSize)
				.nodes(['c', 'd'])
				.arrowsFrom('b', ['a'])
				.arrowsFrom('c', ['b', 'a'])
				.arrowsFrom('d', ['b'])
				.build();
			const layout = await layoutNodes({ ...fixture, direction, bias });
			const obstacle = layout.getById('b').bounds;
			const envelope = layout.envelopeOf(['a', 'c']).bounds;
			const farEdge = obstacle[axes.transverse] + extent(obstacle, axes.transverse);
			expect(obstacle[axes.transverse]).toBeLessThanOrEqual(envelope[axes.transverse]);
			expect(farEdge).toBeGreaterThanOrEqual(
				envelope[axes.transverse] + extent(envelope, axes.transverse),
			);
			const middle = obstacle[axes.primary] + extent(obstacle, axes.primary) / 2;
			const bypass = defined(layout.relations.find(({ id }) => id === 'c-to-a'));
			const passages = routeSegments(bypass).filter(
				(segment) =>
					segment.axis === axes.primary && segment.start < middle && segment.end > middle,
			);
			expect(passages.length).toBeGreaterThan(0);
			for (const passage of passages)
				expect(
					Math.max(obstacle[axes.transverse] - passage.fixed, passage.fixed - farEdge),
				).toBeGreaterThanOrEqual(24);
			AssertLayout(layout).routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
			AssertLayout(layout).obstacles().haveClearance(24);
		});
	},
);

it('keeps foreign routes clear of a physical junction with unequal neighboring node sizes', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.constantFrom(...LAYOUT_CONFIGURATIONS),
			fc.record({
				nodes: fc.record({
					p: physicalSize,
					q: physicalSize,
					s: physicalSize,
					u: physicalSize,
					v: physicalSize,
					w: physicalSize,
					g: physicalSize,
					x: physicalSize,
				}),
				junction: fc.record({
					width: fc.integer({ min: 20, max: 60 }),
					height: fc.integer({ min: 12, max: 40 }),
				}),
			}),
			async (configuration, measurements) => {
				const fixture = junctionFixture(configuration.direction, measurements);
				const original = structuredClone(fixture);
				const layout = await layoutNodes({ ...fixture, ...configuration });
				AssertLayout(layout).routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
				AssertLayout(layout).obstacles().haveClearance(24);
				keepsLocalBranches(layout);
				keepsRowOrder(layout);
				const reordered = await layoutNodes({
					...fixture,
					...configuration,
					relations: fixture.relations.toReversed(),
				});
				expect(reordered).toEqual(layout);
				expect(fixture).toEqual(original);
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('keeps foreign routes outside fixed physical group envelopes with unequal neighbors', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.constantFrom(...LAYOUT_CONFIGURATIONS),
			fc.record({
				nodes: fc.record({ s: physicalSize, w: physicalSize, x: physicalSize }),
				group: fc.record({
					minimumWidth: fc.integer({ min: 120, max: 320 }),
					minimumHeight: fc.integer({ min: 84, max: 220 }),
					headerHeight: fc.constant(36),
					padding: fc.constant(24),
				}),
			}),
			async (configuration, measurements) => {
				const fixture = groupFixture(configuration, measurements);
				const original = structuredClone(fixture);
				const layout = await layoutWideGroupObstacle(
					configuration.direction,
					configuration.bias,
					measurements,
				);
				wideGroupObstacle.assert(layout);
				keepsRowOrder(layout);
				const { layout: reordered } = await layoutDocument(
					{
						...fixture.document,
						nodes: fixture.document.nodes.toReversed(),
						relations: fixture.document.relations.toReversed(),
					},
					fixture.measurements,
				);
				expect(reordered.elements).toEqual(layout.elements);
				expect(reordered.relations).toEqual(layout.relations);
				expect([reordered.width, reordered.height]).toEqual([layout.width, layout.height]);
				expect(fixture).toEqual(original);
			},
		),
		PROPERTY_PARAMETERS,
	);
});
