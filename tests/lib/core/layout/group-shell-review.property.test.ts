import { expect, it } from 'vitest';

import { defined, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { GROUP_SHELL_CLEARANCE } from '../../../../src/lib/core/layout/layout-settings';
import { boundsFor, layoutDocument, type LayoutFixture } from '../../../support/harnesses/layout';
import { referenceGroupShellViolations } from './bridge-oracle-reference';
import { reviewedShellSample } from './group-shell-review-fixture';

function assertShellInvariants(prepared: LayoutFixture): void {
	const { document, layout, measurements } = prepared;
	const parents = new Map(
		[...document.nodes, ...document.groups].map(({ id, groupId }) => [id, groupId]),
	);
	const owns = (endpoint: string, group: string) => {
		for (let parent = parents.get(endpoint); parent !== undefined; parent = parents.get(parent))
			if (parent === group) return true;
		return false;
	};
	const clearance = new Map<string, number>();
	for (const group of document.groups) {
		let gap = defined(measurements.groups.get(group.id)).padding;
		if (group.groupId !== undefined)
			gap = Math.min(gap, defined(measurements.groups.get(group.groupId)).padding);
		clearance.set(group.id, Math.min(GROUP_SHELL_CLEARANCE, gap / 2));
		const box = boundsFor(layout, group.id);
		const escaped = layout.relations.filter(
			(route) =>
				owns(route.from, group.id) &&
				owns(route.to, group.id) &&
				route.points.some(
					(point) =>
						point.x < box.x ||
						point.x > box.x + box.width ||
						point.y < box.y ||
						point.y > box.y + box.height,
				),
		);
		expect(escaped.map(({ id }) => id)).toEqual([]);
	}
	expect(
		referenceGroupShellViolations(
			layout.relations,
			document.groups.map(({ id }) => ({ id, bounds: boundsFor(layout, id) })),
			clearance,
		),
	).toEqual([]);
	expect(validateDedicatedCandidate(prepared).valid).toBe(true);
}

it.each([undefined, 36])(
	'keeps the reviewed 600-document corpus valid and confined at padding %s',
	async (padding) => {
		for (let seed = 1; seed <= 600; seed += 1)
			for (const direction of Object.values(LayoutDirection)) {
				const { document, overrides } = reviewedShellSample(seed, direction, padding);
				const prepared = await layoutDocument(document, overrides);
				assertShellInvariants(prepared);
			}
	},
	60_000,
);
