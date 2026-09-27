import fc from 'fast-check';
import { expect, it } from 'vitest';

import type { LayoutRelation } from '../../../../../src/app/web/projection/layout-graph';
import { renderRelationPaths } from '../../../../../src/app/web/ui/canvas/render-relations';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../../../../../src/app/workshop/fixtures/layout-performance/scenarios';
import { layoutWithRootRegion } from '../../../../../src/lib/core/layout/root-region';
import { PROPERTY_PARAMETERS } from '../../../../support/builders/property-test-options';
import { prepareLayoutPerformanceScenario } from '../../../../support/scenarios/layout-performance/prepare-layout-performance-scenario';
import { referenceRenderRelationPaths } from './render-relations-reference';

/** Six-pixel steps put parallels exactly at, below and beyond the bulge and color distances. */
const coordinate = fc.integer({ min: 0, max: 20 }).map((step) => step * 6);

it('matches the exhaustive renderer on orthogonal routes, including homonymous relations', () => {
	const way = fc
		.tuple(coordinate, coordinate, coordinate, coordinate, coordinate)
		.map(([startX, startY, middleX, endY, endX]) => [
			{ x: startX, y: startY },
			{ x: middleX, y: startY },
			{ x: middleX, y: endY },
			{ x: endX, y: endY },
		]);
	fc.assert(
		fc.property(fc.boolean(), fc.array(way, { minLength: 2, maxLength: 12 }), (homonyms, ways) => {
			const relations: LayoutRelation[] = ways.map((points, index) => {
				let ordinal = index;
				if (homonyms) ordinal = Math.floor(index / 2);
				return { id: `relation-${ordinal}`, from: `from-${index}`, to: `to-${index}`, points };
			});
			expect(renderRelationPaths(relations)).toEqual(referenceRenderRelationPaths(relations));
		}),
		PROPERTY_PARAMETERS,
	);
});

it('matches the exhaustive renderer on every performance topology', { timeout: 30_000 }, () => {
	let bridged = 0;
	for (const scenario of LAYOUT_PERFORMANCE_SCENARIOS) {
		const { graph, ranks, measurements } = prepareLayoutPerformanceScenario(scenario, 50);
		const { relations } = layoutWithRootRegion(graph, ranks, measurements);
		const rendered = renderRelationPaths(relations);
		expect(rendered).toEqual(referenceRenderRelationPaths(relations));
		bridged += rendered.filter(({ path }) => path.includes(' A ')).length;
	}
	expect(bridged).toBeGreaterThan(0);
});
