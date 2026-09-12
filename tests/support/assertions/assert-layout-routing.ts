import { renderRelationPaths } from '../../../src/app/web/ui/canvas/render-relations';
import type { LayoutRelation } from '../../../src/lib/core/layout/layout-types';
import type { VisualLayout } from '../harnesses/visual-layout';
import { AssertQuays, type QuaySide } from './assert-quays';
import { AssertRails } from './assert-rails';
import { AssertRenderedPaths } from './assert-rendered-paths';
import { AssertRoute } from './assert-route';
import { AssertRoutes } from './assert-routes';
import { AssertTrunks } from './assert-trunks';
import { assertRouteFlow } from './route-flow';

type RouteSelection = readonly string[] | readonly LayoutRelation[];

function resolveRoute(layout: VisualLayout, id: string): LayoutRelation {
	const found = layout.relations.find((route) => route.id === id);
	if (found === undefined) throw new Error(`Missing layout route: ${id}`);
	return found;
}

function resolveRoutes(layout: VisualLayout, selection: RouteSelection): readonly LayoutRelation[] {
	return selection.map((route) => {
		if (typeof route !== 'string') return route;
		return resolveRoute(layout, route);
	});
}

/** Adds endpoint observations without changing the subject after a geometry assertion. */
class LayoutRoutes {
	private readonly geometry: ReturnType<typeof AssertRoutes>;
	constructor(
		private readonly layout: VisualLayout,
		private readonly routes: readonly LayoutRelation[],
	) {
		this.geometry = AssertRoutes(routes);
	}
	areOrthogonal(): this {
		for (const route of this.routes) AssertRoute(route).isOrthogonal();
		return this;
	}
	areAttachedToEndpoints(): this {
		for (const route of this.routes)
			AssertRoute(route).isAttachedTo(
				this.layout.getById(route.from),
				this.layout.getById(route.to),
			);
		return this;
	}
	followLayoutFlow(): this {
		for (const route of this.routes) assertRouteFlow(this.layout, route);
		return this;
	}
	haveOnlyAllowedSharedTrunks(): this {
		this.geometry.haveOnlyAllowedSharedTrunks(this.layout.relations);
		return this;
	}
	haveNoOverlap(): this {
		this.geometry.haveNoOverlap();
		return this;
	}
	haveNoCrossing(): this {
		this.geometry.haveNoCrossing();
		return this;
	}
	haveCrossing(): this {
		this.geometry.haveCrossing();
		return this;
	}
	haveNoOverlapWith(other: RouteSelection): this {
		this.geometry.haveNoOverlapWith(resolveRoutes(this.layout, other));
		return this;
	}
	haveNoCrossingWith(other: RouteSelection): this {
		this.geometry.haveNoCrossingWith(resolveRoutes(this.layout, other));
		return this;
	}
}

/** Routing observations share the layout context; rendered paths remain an explicit selection. */
export function layoutRoutingAssertions(layout: VisualLayout): {
	route(id: string): ReturnType<typeof AssertRoute>;
	routes(selection?: RouteSelection): LayoutRoutes;
	renderedPaths(selection?: RouteSelection): ReturnType<typeof AssertRenderedPaths>;
	quays(id: string, options: { readonly side: QuaySide }): ReturnType<typeof AssertQuays>;
	rails(options: {
		readonly between: readonly [readonly string[], readonly string[]];
	}): ReturnType<typeof AssertRails>;
	trunks(selection?: RouteSelection): ReturnType<typeof AssertTrunks>;
} {
	return {
		route(id) {
			return AssertRoute(resolveRoute(layout, id));
		},
		routes(selection = layout.relations) {
			return new LayoutRoutes(layout, resolveRoutes(layout, selection));
		},
		renderedPaths(selection = layout.relations) {
			return AssertRenderedPaths(renderRelationPaths(resolveRoutes(layout, selection)));
		},
		quays(id, { side }) {
			return AssertQuays(layout, id, side);
		},
		rails({ between }) {
			return AssertRails(layout, between);
		},
		trunks(selection = layout.relations) {
			return AssertTrunks(resolveRoutes(layout, selection));
		},
	};
}
