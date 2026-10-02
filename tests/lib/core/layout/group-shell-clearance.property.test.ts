import fc from 'fast-check';
import { expect, it } from 'vitest';

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { RAIL_SPACING } from '../../../../src/lib/core/layout/layout-settings';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { boundsFor, layoutDocument } from '../../../support/harnesses/layout';
import { referenceGroupShellViolations } from './bridge-oracle-reference';
import { shellDocument } from './group-shell-fixture';

const shape = fc.record({
	count: fc.integer({ min: 4, max: 9 }),
	groups: fc.integer({ min: 1, max: 2 }),
	nested: fc.boolean(),
	edges: fc.array(fc.tuple(fc.nat(8), fc.nat(8)), { maxLength: 15 }),
	headerHeight: fc.integer({ min: 36, max: 90 }),
	padding: fc.integer({ min: 24, max: 48 }),
});

it('keeps every rail at least half a rail spacing from one or two random shells in all directions', async () => {
	await fc.assert(
		fc.asyncProperty(shape, async (sample) => {
			for (const direction of Object.values(LayoutDirection)) {
				const document = shellDocument(sample, direction);
				const groups = Object.fromEntries(
					document.groups.map(({ id }) => [
						id,
						{
							minimumWidth: 160,
							minimumHeight: 72,
							headerHeight: sample.headerHeight,
							padding: sample.padding,
						},
					]),
				);
				const { layout } = await layoutDocument(document, { groups });
				expect(
					referenceGroupShellViolations(
						layout.relations,
						document.groups.map(({ id }) => ({ id, bounds: boundsFor(layout, id) })),
						RAIL_SPACING / 2,
					),
				).toEqual([]);
			}
		}),
		{ ...PROPERTY_PARAMETERS, numRuns: 400 },
	);
}, 20_000);

it('has no collinear frame segments in 1200 random one-group layouts', async () => {
	await fc.assert(
		fc.asyncProperty(shape, async (sample) => {
			for (const direction of Object.values(LayoutDirection)) {
				const document = shellDocument({ ...sample, groups: 1 }, direction);
				const { layout } = await layoutDocument(document);
				expect(
					referenceGroupShellViolations(
						layout.relations,
						[{ id: 'g0', bounds: boundsFor(layout, 'g0') }],
						RAIL_SPACING / 2,
					),
				).toEqual([]);
			}
		}),
		{ ...PROPERTY_PARAMETERS, numRuns: 300 },
	);
}, 20_000);

it('keeps an internal bypass inside its owning shells while clearing their sides', async () => {
	await fc.assert(
		fc.asyncProperty(shape, async (sample) => {
			for (const direction of Object.values(LayoutDirection)) {
				const document = shellDocument(
					{ ...sample, count: Math.max(5, sample.count), edges: [[sample.count - 2, 1]] },
					direction,
				);
				const { layout } = await layoutDocument(document);
				const parents = new Map(
					[...document.nodes, ...document.groups].map(({ id, groupId }) => [id, groupId]),
				);
				const ancestors = (id: string) => {
					const result = new Set<string>();
					for (let group = parents.get(id); group !== undefined; group = parents.get(group))
						result.add(group);
					return result;
				};
				for (const route of layout.relations) {
					const source = ancestors(route.from);
					for (const group of ancestors(route.to)) {
						if (!source.has(group)) continue;
						const box = boundsFor(layout, group);
						for (const point of route.points) {
							expect(point.x).toBeGreaterThanOrEqual(box.x);
							expect(point.x).toBeLessThanOrEqual(box.x + box.width);
							expect(point.y).toBeGreaterThanOrEqual(box.y);
							expect(point.y).toBeLessThanOrEqual(box.y + box.height);
						}
					}
				}
				expect(
					referenceGroupShellViolations(
						layout.relations,
						document.groups.map(({ id }) => ({ id, bounds: boundsFor(layout, id) })),
						RAIL_SPACING / 2,
					),
				).toEqual([]);
			}
		}),
		{ ...PROPERTY_PARAMETERS, numRuns: 400 },
	);
}, 20_000);
