import { expect, it } from 'vitest';

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { boundsFor, layoutDocument } from '../../../support/harnesses/layout';
import {
	referenceEscapedRoutes,
	referencePassagePitch,
	referenceShellBandViolations,
} from './group-shell-band-oracle';
import { deepShellSample } from './group-shell-deep-fixture';
import { reviewedShellSample } from './group-shell-review-fixture';

it.each(Object.values(LayoutDirection))(
	'renders the deeply nested saturated strip without escaping in %s',
	async (direction) => {
		const { document, overrides } = deepShellSample(89, direction, 24);
		const prepared = await layoutDocument(document, overrides);
		const frame = boundsFor(prepared.layout, 'g0');
		const route = prepared.layout.relations.find(({ id }) => id === 'n9-n1');
		if (route === undefined) throw new Error('Missing saturated passage');
		expect(
			route.points.filter(
				({ x, y }) =>
					x < frame.x || x > frame.x + frame.width || y < frame.y || y > frame.y + frame.height,
			),
		).toEqual([]);
		expect(validateDedicatedCandidate(prepared).valid).toBe(true);
		expect(
			referenceShellBandViolations(
				prepared.layout.relations,
				prepared.layout.elements,
				new Set(document.groups.map(({ id }) => id)),
			),
		).toEqual([]);
	},
);

it.each(Object.values(LayoutDirection))(
	'keeps outside clearance independent of inside padding in %s',
	async (direction) => {
		for (const seed of [83, 202, 224]) {
			const { document, overrides } = reviewedShellSample(seed, direction);
			const prepared = await layoutDocument(document, overrides);
			expect(validateDedicatedCandidate(prepared).valid).toBe(true);
			expect(
				referenceShellBandViolations(
					prepared.layout.relations,
					prepared.layout.elements,
					new Set(document.groups.map(({ id }) => id)),
				),
			).toEqual([]);
		}
	},
);

it.each(Object.values(LayoutDirection))(
	'does not compress saturated passages below a readable pitch in %s',
	async (direction) => {
		const { document, overrides } = deepShellSample(17, direction, 36);
		const prepared = await layoutDocument(document, overrides);
		const vertical =
			direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
		expect(validateDedicatedCandidate(prepared).valid).toBe(true);
		expect(referencePassagePitch(prepared.layout.relations, vertical)).toBeGreaterThanOrEqual(6);
	},
);

it('measures the actual outside strip rather than borrowing the inside padding', () => {
	const frame = { id: 'frame', bounds: { x: 0, y: 0, width: 100, height: 100 } };
	const path = {
		id: 'outside',
		points: [
			{ x: -4, y: 20 },
			{ x: -4, y: 80 },
		],
	};
	const groups = new Set(['frame']);
	expect(referenceShellBandViolations([path], [frame], groups)).toEqual([
		{ pathId: 'outside', frameId: 'frame', distance: 4, minimum: 12, passages: 1 },
	]);
	const neighbour = { id: 'node', bounds: { x: -40, y: 0, width: 32, height: 100 } };
	expect(referenceShellBandViolations([path], [frame, neighbour], groups)).toEqual([]);
});

it('shares the same strip on both frame sides according to its actual passage count', () => {
	const frames = [
		{ id: 'parent', bounds: { x: 0, y: 0, width: 100, height: 100 } },
		{ id: 'child', bounds: { x: 24, y: 0, width: 52, height: 100 } },
	];
	const groups = new Set(['parent', 'child']);
	const paths = (columns: readonly number[]) =>
		columns.map((x, index) => ({
			id: `route${index}`,
			points: [
				{ x, y: 20 },
				{ x, y: 80 },
			],
		}));
	expect(referenceShellBandViolations(paths([8]), frames, groups)).toEqual([
		{ pathId: 'route0', frameId: 'parent', distance: 8, minimum: 12, passages: 1 },
	]);
	expect(referenceShellBandViolations(paths([8, 16]), frames, groups)).toEqual([]);
	expect(referenceShellBandViolations(paths([6, 12]), frames, groups)).toEqual([
		{ pathId: 'route0', frameId: 'parent', distance: 6, minimum: 8, passages: 2 },
	]);
	expect(referenceShellBandViolations(paths([6, 12, 18]), frames, groups)).toEqual([]);
});

it.each(Object.values(LayoutDirection))(
	'does not worsen historical confinement when the strip cannot hold a readable pitch in %s',
	async (direction) => {
		const { document, overrides } = reviewedShellSample(435, direction);
		const prepared = await layoutDocument(document, overrides);
		const frame = boundsFor(prepared.layout, 'g1');
		const members = new Set(
			document.nodes.filter(({ groupId }) => groupId === 'g1').map(({ id }) => id),
		);
		const escaped = prepared.layout.relations.filter(
			({ from, to, points }) =>
				members.has(from) &&
				members.has(to) &&
				points.some(
					({ x, y }) =>
						x < frame.x || x > frame.x + frame.width || y < frame.y || y > frame.y + frame.height,
				),
		);
		let maximum = 0;
		if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop)
			maximum = 3;
		expect(escaped.length).toBeLessThanOrEqual(maximum);
		expect(validateDedicatedCandidate(prepared).valid).toBe(true);
	},
);

it.each(Object.values(LayoutDirection))(
	'keeps the exterior cursor outside the scene after an internal saturation fallback in %s',
	async (direction) => {
		const vertical =
			direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
		for (const { seed, main, transverse } of [
			{ seed: 89, main: 3, transverse: 0 },
			{ seed: 210, main: 1, transverse: 0 },
			{ seed: 839, main: 2, transverse: 0 },
			{ seed: 849, main: 3, transverse: 1 },
			{ seed: 875, main: 0, transverse: 0 },
		]) {
			const { document, overrides } = deepShellSample(seed, direction, 12);
			const prepared = await layoutDocument(document, overrides);
			let maximum = transverse;
			if (vertical) maximum = main;
			expect(referenceEscapedRoutes(prepared).length, `seed ${seed}`).toBeLessThanOrEqual(maximum);
			expect(validateDedicatedCandidate(prepared).valid, `seed ${seed}`).toBe(true);
			expect(
				referencePassagePitch(prepared.layout.relations, vertical, false),
			).toBeGreaterThanOrEqual(6);
		}
	},
);
