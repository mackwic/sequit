import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	type LayoutDirection,
	type LogicDocument,
	type LogicNode,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { validLogicDocument } from '../../../support/builders/logic-document';
import type { VisualGraphData } from '../../../support/builders/visual-graph-builder';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { mixedBranchAlignment } from '../../../support/fixtures/mixed-branch-alignment';
import { layoutDocument } from '../../../support/harnesses/layout';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import { VisualLayout } from '../../../support/harnesses/visual-layout';

function separatedRow(layout: VisualLayout, ids: readonly string[]): void {
	const axis = axesFor(layout.direction).transverse;
	let dimension: 'width' | 'height' = 'width';
	if (axis === 'y') dimension = 'height';
	for (const [index, id] of ids.entries()) {
		const previous = ids[index - 1];
		if (previous === undefined) continue;
		const left = layout.getById(previous).bounds;
		const right = layout.getById(id).bounds;
		expect(right[axis] - left[axis] - left[dimension]).toBeGreaterThanOrEqual(36);
	}
}

function safeGeometry(layout: VisualLayout): void {
	AssertLayout(layout).routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
	AssertLayout(layout).obstacles().haveClearance(0);
}

function withRelation(
	fixture: VisualGraphData,
	relation: LogicDocument['relations'][number],
): VisualGraphData {
	return { ...fixture, relations: [...fixture.relations, relation] };
}

function equalDistanceBranches(direction: LayoutDirection) {
	return graphFixtures
		.routingNodes(['r', 'p', 'q', 'u', 'v', 'w'], direction, 100)
		.arrowsFrom('p', ['r'])
		.arrowsFrom('q', ['r'])
		.arrowsFrom('u', ['p'])
		.arrowsFrom('v', ['p'])
		.arrowsFrom('w', ['q'])
		.build();
}

const constrainedRelations = [
	{ label: 'two different parents', relation: { id: 'v-to-q', from: 'v', to: 'q' } },
	{ label: 'parallel relations', relation: { id: 'parallel-v-to-p', from: 'v', to: 'p' } },
	{ label: 'a long incident relation', relation: { id: 'v-to-r', from: 'v', to: 'r' } },
];

describe.each(LAYOUT_CONFIGURATIONS)(
	'mixed branch boundaries in $direction / $bias',
	(configuration) => {
		it.each(constrainedRelations)(
			'keeps constrained branches and their neighbors separated with $label',
			async ({ relation }) => {
				const fixture = withRelation(mixedBranchAlignment(configuration.direction), relation);
				const layout = await layoutNodes({ ...fixture, ...configuration });
				safeGeometry(layout);
				separatedRow(layout, ['p', 'q', 's']);
				separatedRow(layout, ['u', 'v', 'w', 'g', 'x']);
				const reordered = await layoutNodes({
					...fixture,
					...configuration,
					relations: fixture.relations.toReversed(),
				});
				expect(reordered.elements).toEqual(layout.elements);
				expect(reordered.relations).toEqual(layout.relations);
			},
		);

		it('uses documentary order to choose between equally close siblings', async () => {
			const fixture = equalDistanceBranches(configuration.direction);
			const layout = await layoutNodes({ ...fixture, ...configuration });
			AssertLayout(layout)
				.route('u-to-p')
				.isStraightAlong(axesFor(configuration.direction).primary);
			AssertLayout(layout).routes().haveNoCrossing();
			separatedRow(layout, ['u', 'v', 'w']);
			safeGeometry(layout);
			const reordered = await layoutNodes({
				...fixture,
				...configuration,
				relations: fixture.relations.toReversed(),
			});
			expect(reordered.elements).toEqual(layout.elements);
			expect(reordered.relations).toEqual(layout.relations);
		});

		it('retains documentary order and box clearance when three straight anchors cannot fit', async () => {
			let size = { width: 200, height: 60 };
			if (axesFor(configuration.direction).transverse === 'y') size = { width: 60, height: 200 };
			const fixture = graphFixtures
				.routingNodes(['r', 'p', 'q', 's'], configuration.direction, 80)
				.nodes(['u', 'v', 'w'], size)
				.arrowsFrom('p', ['r'])
				.arrowsFrom('q', ['r'])
				.arrowsFrom('s', ['r'])
				.arrowsFrom('u', ['p'])
				.arrowsFrom('v', ['q'])
				.arrowsFrom('w', ['s'])
				.build();
			const layout = await layoutNodes({ ...fixture, ...configuration });
			separatedRow(layout, ['p', 'q', 's']);
			separatedRow(layout, ['u', 'v', 'w']);
			AssertLayout(layout).routes().haveNoCrossing();
			safeGeometry(layout);
		});

		it('aligns to the actual offset port when another branch crosses an ordinary row', async () => {
			const fixture = withRelation(mixedBranchAlignment(configuration.direction), {
				id: 'x-to-r',
				from: 'x',
				to: 'r',
			});
			const layout = await layoutNodes({ ...fixture, ...configuration });
			const route = defined(layout.relations.find(({ id }) => id === 'v-to-p'));
			const parent = layout.getById('p').bounds;
			const axis = axesFor(configuration.direction).transverse;
			let dimension: 'width' | 'height' = 'width';
			if (axis === 'y') dimension = 'height';
			expect(
				Math.abs(defined(route.points.at(-1))[axis] - parent[axis] - parent[dimension] / 2),
			).toBeGreaterThan(0);
			AssertLayout(layout).ports('p', { role: 'incoming' }).haveCount(2);
			AssertLayout(layout)
				.route('v-to-p')
				.isStraightAlong(axesFor(configuration.direction).primary);
			separatedRow(layout, ['u', 'v', 'w', 'g', 'x']);
			safeGeometry(layout);
		});

		it('keeps junction branches clear while aligning unrelated ordinary branches', async () => {
			const fixture = mixedBranchAlignment(configuration.direction);
			const withJunction = {
				...fixture,
				junctions: { j: { width: 28, height: 20 } },
				relations: [
					...fixture.relations.filter(({ to }) => to !== 's'),
					{ id: 'g-to-j', from: 'g', to: 'j' },
					{ id: 'x-to-j', from: 'x', to: 'j' },
					{ id: 'j-to-s', from: 'j', to: 's' },
				],
			};
			const layout = await layoutNodes({ ...withJunction, ...configuration });
			separatedRow(layout, ['p', 'q', 's']);
			separatedRow(layout, ['u', 'v', 'w', 'g', 'x']);
			safeGeometry(layout);
		});

		it('keeps an empty group separated from the moving ordinary branches', async () => {
			const fixture = mixedBranchAlignment(configuration.direction);
			const document: LogicDocument = {
				...validLogicDocument(),
				layout: configuration,
				groups: [
					{ kind: EndpointKind.Group, id: 'g', label: 'Group', layoutOrder: orderKey('a7') },
				],
				nodes: [
					...Object.keys(fixture.nodes)
						.map((id, index): LogicNode => ({
							kind: EndpointKind.Node,
							id,
							markdown: id,
							natureId: 'goal',
							layoutOrder: orderKey(`a${index}`),
						}))
						.filter(({ id }) => id !== 'g'),
				],
				junctions: [],
				relations: fixture.relations,
			};
			const groupSize = defined(fixture.nodes['g']);
			const result = await layoutDocument(document, {
				nodes: fixture.nodes,
				groups: {
					g: {
						minimumWidth: groupSize.width,
						minimumHeight: groupSize.height,
						headerHeight: 20,
						padding: 10,
					},
				},
			});
			const layout = new VisualLayout(
				result.layout,
				result.ranks.byEndpointId,
				configuration.direction,
			);
			separatedRow(layout, ['u', 'v', 'w', 'g', 'x']);
			safeGeometry(layout);
		});
	},
);
