import { type LayoutBias, LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { renderRelationPaths } from '../../../../web/ui/canvas/render-relations';
import { AssertQuays, AssertQuaySize, type QuaySide } from '../../assert-quays';
import { AssertRenderedPaths } from '../../assert-rendered-paths';
import { AssertRoute } from '../../assert-route';
import { AssertRoutes } from '../../assert-routes';
import { axesFor } from '../../directions';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';
import type { VisualLayout } from '../../visual-layout';

/** Notebook proposals, not engine settings. Keep their values visible in the accompanying SVX. */
const quayPolicy = { spacing: 48, inset: 24 };
export const railPolicy = { baseGap: 72, spacing: 24, inset: 12 };
const narrowContent = 80;
export const wideContent = 200;
export const completePairs = [
	['a', 'c'],
	['a', 'd'],
	['b', 'c'],
	['b', 'd'],
] as const;
export type Link = readonly [string, string];

export function routingLayout(
	ids: readonly string[],
	links: readonly Link[],
	content: number,
	direction: LayoutDirection,
	bias?: LayoutBias,
): Promise<VisualLayout> {
	let size = { width: content, height: 60 };
	if (axesFor(direction).transverse === 'y') size = { width: 60, height: content };
	return layoutNodes({
		direction,
		bias,
		nodes: Object.fromEntries(ids.map((id) => [id, size])),
		relations: links.map(([from, to]) => ({ id: `${from}-to-${to}`, from, to })),
	});
}

export function routingScenario(
	metadata: Pick<LayoutScenario, 'id' | 'label' | 'order'>,
	fixture: {
		readonly ids: readonly string[];
		readonly links: readonly Link[];
		readonly content?: number;
	},
	assert: LayoutScenario['assert'],
): LayoutScenario {
	return {
		...metadata,
		group: 'Rails et quais',
		arrange(direction = LayoutDirection.TopToBottom, bias) {
			return routingLayout(
				fixture.ids,
				fixture.links,
				fixture.content ?? narrowContent,
				direction,
				bias,
			);
		},
		assert,
	};
}

export function checkQuays(layout: VisualLayout, id: string, side: QuaySide, count: number): void {
	AssertQuays(layout, id, side)
		.haveCount(count)
		.areCentered()
		.haveClearance(quayPolicy.spacing, quayPolicy.inset);
}

export function checkSize(
	layout: VisualLayout,
	id: string,
	counts: readonly [number, number],
	content = narrowContent,
): void {
	AssertQuaySize(layout, id).matchesContentAndQuays({
		content,
		incoming: counts[0],
		outgoing: counts[1],
		...quayPolicy,
	});
}

export function checkDistinctPaths(layout: VisualLayout, routes = layout.relations): void {
	for (const route of routes) {
		AssertRoute(route)
			.isOrthogonal()
			.isAttachedTo(layout.getById(route.from), layout.getById(route.to));
	}
	AssertRoutes(routes).haveNoOverlap();
	AssertRenderedPaths(renderRelationPaths(routes)).haveBridgeAtEveryCrossing();
}

export function checkCompleteQuays(layout: VisualLayout, content = narrowContent): void {
	for (const id of ['a', 'b']) {
		checkQuays(layout, id, 'outgoing', 2);
		checkSize(layout, id, [0, 2], content);
	}
	for (const id of ['c', 'd']) {
		checkQuays(layout, id, 'incoming', 2);
		checkSize(layout, id, [2, 0], content);
	}
}
