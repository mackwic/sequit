import { renderRelationPaths } from '../../../src/app/web/ui/canvas/render-relations';
import type { VisualLayout } from '../harnesses/visual-layout';
import { AssertQuays, AssertQuaySize, type QuaySide } from './assert-quays';
import { AssertRenderedPaths } from './assert-rendered-paths';
import { AssertRoute } from './assert-route';
import { AssertRoutes } from './assert-routes';

/** Notebook proposals, not engine settings. Keep their values visible in the accompanying SVX. */
const quayPolicy = { spacing: 48, inset: 24 };
export const railPolicy = { baseGap: 72, spacing: 24, inset: 12 };
const narrowContent = 80;
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
