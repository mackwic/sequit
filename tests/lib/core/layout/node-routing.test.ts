import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import type { LayoutRelation, Size } from '../../../../src/lib/core/layout/layout-types';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { VisualLayout } from '../../../support/harnesses/visual-layout';

const pairs = [
	['a', 'c'],
	['a', 'd'],
	['b', 'c'],
	['b', 'd'],
] as const;
const relations = pairs.map(([from, to]) => ({ id: `${from}-${to}`, from, to }));
function verify(layout: VisualLayout): void {
	const check = AssertLayout(layout);
	check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
	check.renderedPaths().haveBridgeAtEveryCrossing();
}

describe.each(Object.values(LayoutDirection))('planned rails and ports in %s', (direction) => {
	it('keeps direct paths straight, separates diagonals and reserves the necessary space', async () => {
		const nodes = Object.fromEntries(
			['a', 'b', 'c', 'd'].map((id) => [id, { width: 80, height: 60 }]),
		);
		const original = structuredClone({ nodes, relations });
		const layout = await layoutNodes({ nodes, relations, direction });
		verify(layout);
		AssertLayout(layout).routes().haveNoOverlap();
		AssertLayout(layout).routes(['a-d', 'b-c']).haveCrossing();
		const second = await layoutNodes({ nodes, relations: [...relations].reverse(), direction });
		expect(second).toEqual(layout);
		expect({ nodes, relations }).toEqual(original);
	});
	it('retains shared central ports in simple forks and convergences', async () => {
		const nodes = Object.fromEntries(
			['a', 'b', 'c', 'd'].map((id) => [id, { width: 80, height: 60 }]),
		);
		for (const selected of [
			relations.filter(({ from }) => from === 'a'),
			relations.filter(({ to }) => to === 'c'),
		]) {
			const layout = await layoutNodes({ nodes, relations: selected, direction });
			verify(layout);
			AssertLayout(layout).routes().haveNoCrossing();
			expect(
				layout.elements.every(({ bounds }) => bounds.width === 80 && bounds.height === 60),
			).toBe(true);
		}
	});
	it('enlarges tiny content measurements before attaching the paths', async () => {
		const nodes = Object.fromEntries(
			['a', 'b', 'c', 'd'].map((id) => [id, { width: 8, height: 8 }]),
		);
		const layout = await layoutNodes({ nodes, relations, direction });
		verify(layout);
		for (const id of ['c', 'd'])
			AssertLayout(layout)
				.ports(id, { role: 'incoming' })
				.haveCount(2)
				.haveClearance({ spacing: 48, inset: 24 });
	});
	it('leaves an independent simple corridor compact', async () => {
		const nodes = Object.fromEntries(
			['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, { width: 80, height: 60 }]),
		);
		const layout = await layoutNodes({
			nodes,
			relations: [...relations, { id: 'e-f', from: 'e', to: 'f' }],
			direction,
		});
		verify(layout);
		expect(layout.getById('e').bounds).toMatchObject({ width: 80, height: 60 });
		const check = AssertLayout(layout);
		check.routes(['e-f']).haveNoCrossingWith(relations.map(({ id }) => id));
	});
	it('reuses the same rails across independent crossings with unequal row dimensions', async () => {
		const nodes = Object.fromEntries(
			['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, index) => [
				id,
				{ width: 80 + 40 * Math.floor(index / 4), height: 60 + 40 * Math.floor(index / 4) },
			]),
		);
		const layout = await layoutNodes({
			nodes,
			relations: [
				...relations,
				...['e', 'f'].flatMap((from) =>
					['g', 'h'].map((to) => ({ id: `${from}-${to}`, from, to })),
				),
			],
			direction,
		});
		verify(layout);
		const rows = [
			['a', 'b', 'e', 'f'],
			['c', 'd', 'g', 'h'],
		] as const;
		for (const between of [rows, [rows[1], rows[0]] as const])
			AssertLayout(layout)
				.rails({ between })
				.haveCount(3)
				.haveRoom({ baseGap: 72, spacing: 24, inset: 24 });
	});
});

it('keeps varied, dense bipartite corridors orthogonal, monotone, separated and bridgeable', async () => {
	const dimensions = fc.record({
		width: fc.integer({ min: 8, max: 300 }),
		height: fc.integer({ min: 8, max: 180 }),
	});
	await fc.assert(
		fc.asyncProperty(
			fc.array(dimensions, { minLength: 2, maxLength: 5 }),
			fc.array(dimensions, { minLength: 2, maxLength: 5 }),
			fc.constantFrom(...Object.values(LayoutDirection)),
			async (sources, targets, direction) => {
				const nodes: Record<string, Size> = {};
				const links: Omit<LayoutRelation, 'points'>[] = [];
				for (const [index, size] of sources.entries()) nodes[`s${index}`] = size;
				for (const [index, size] of targets.entries()) nodes[`t${index}`] = size;
				for (const [source] of sources.entries())
					for (const [target] of targets.entries())
						links.push({ id: `s${source}-t${target}`, from: `s${source}`, to: `t${target}` });
				const layout = await layoutNodes({ nodes, relations: links, direction });
				verify(layout);
				AssertLayout(layout).routes().haveNoOverlap().haveCrossing();
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('reserves ports for every relation incident to a crossing face, including parallel edges and rank skips', async () => {
	const direction = LayoutDirection.TopToBottom;
	const nodes = Object.fromEntries(
		['a', 'b', 'c', 'd', 'root'].map((id) => [id, { width: 80, height: 60 }]),
	);
	const links = [
		...relations,
		{ id: 'parallel', from: 'a', to: 'c' },
		{ id: 'c-root', from: 'c', to: 'root' },
		{ id: 'd-root', from: 'd', to: 'root' },
		{ id: 'a-root', from: 'a', to: 'root' },
	];
	const layout = await layoutNodes({ nodes, relations: links, direction });
	const check = AssertLayout(layout);
	check
		.ports('a', { role: 'outgoing' })
		.haveCount(4)
		.areCentered()
		.haveClearance({ spacing: 48, inset: 24 });
	check.node('a').hasSizeForUsedPorts({ content: 80, spacing: 48, inset: 24 });
	check.routes().followLayoutFlow();
	expect(layout.relations.map(({ id }) => id).sort()).toEqual(links.map(({ id }) => id).sort());
});
