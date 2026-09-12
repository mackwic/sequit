import {
	defined,
	EndpointKind,
	LayoutDirection,
} from '../../../src/lib/core/document/logic-document';
import type { Bounds } from '../../../src/lib/core/layout/layout-types';
import { axesFor } from '../harnesses/visual-directions';
import type { VisualLayout } from '../harnesses/visual-layout';
import { AssertBox } from './assert-box';
import { AssertQuaySize, type QuaySizeOptions, usedQuayCount } from './assert-quays';
import { routeSegments } from './route-geometry';
import { equalMetric, extent, minimumMetric } from './routing-measurements';

function center(bounds: Bounds, axis: 'x' | 'y'): number {
	return bounds[axis] + extent(bounds, axis) / 2;
}

/** Observe junction rectangles and actual routes, without inventing allocator rail IDs. */
export class JunctionAssertions {
	constructor(
		private readonly layout: VisualLayout,
		private readonly ids: readonly string[],
	) {
		if (ids.length === 0 || new Set(ids).size !== ids.length)
			throw new Error('Expected a nonempty selection of distinct junctions.');
		for (const id of ids)
			if (layout.getById(id).kind !== EndpointKind.Junction)
				throw new Error(`Expected a junction: ${id}`);
	}

	areBetween(before: readonly string[], after: readonly string[], clearance: number): this {
		const axis = axesFor(this.layout.direction).primary;
		const first = this.layout.envelopeOf(before);
		const last = this.layout.envelopeOf(after);
		for (const id of this.ids) {
			const junction = this.layout.getById(id);
			AssertBox(junction).isAfter(first, { direction: this.layout.direction });
			AssertBox(last).isAfter(junction, { direction: this.layout.direction });
			for (const boundary of [first, last]) {
				const a = junction.bounds;
				const b = boundary.bounds;
				const gap =
					Math.max(a[axis], b[axis]) -
					Math.min(a[axis] + extent(a, axis), b[axis] + extent(b, axis));
				minimumMetric('Dégagement de la jonction aux rangées', gap, clearance, {
					boxes: [id],
					referenceBoxes: boundary.identity?.ids ?? [],
				});
			}
		}
		return this;
	}

	areImmediatelyBefore(neighbor: string, candidates: readonly string[], clearance: number): this {
		const axis = axesFor(this.layout.direction).primary;
		let sign = 1;
		if ([LayoutDirection.BottomToTop, LayoutDirection.RightToLeft].includes(this.layout.direction))
			sign = -1;
		const target = center(this.layout.getById(neighbor).bounds, axis) * sign;
		const preceding = candidates
			.map((id) => ({ id, position: center(this.layout.getById(id).bounds, axis) * sign }))
			.filter(({ position }) => position < target - 0.001)
			.sort((a, b) => b.position - a.position);
		const previous = defined(preceding[0], 'A preceding node row is required.');
		return this.areBetween([previous.id], [neighbor], clearance);
	}

	areOnSameRail(): this {
		const axis = axesFor(this.layout.direction).primary;
		const reference = center(this.layout.getById(defined(this.ids[0])).bounds, axis);
		for (const id of this.ids)
			equalMetric(
				'Centres des jonctions sur un même rail',
				center(this.layout.getById(id).bounds, axis),
				reference,
				{ boxes: [id] },
			);
		return this;
	}

	areOnSeparateProgressiveRails(clearance: number): this {
		for (let index = 1; index < this.ids.length; index += 1) {
			const previous = this.layout.getById(defined(this.ids[index - 1]));
			const next = this.layout.getById(defined(this.ids[index]));
			AssertBox(next).isAfter(previous, { direction: this.layout.direction });
			const axis = axesFor(this.layout.direction).primary;
			const separation = Math.abs(center(next.bounds, axis) - center(previous.bounds, axis));
			minimumMetric(
				'Épaisseur des rails de jonctions successifs',
				separation,
				(extent(next.bounds, axis) + extent(previous.bounds, axis)) / 2 + clearance,
				{ boxes: [previous.id, next.id] },
			);
		}
		return this;
	}

	areOnBaseRail(before: readonly string[], after: readonly string[]): this {
		const axis = axesFor(this.layout.direction).primary;
		const a = this.layout.envelopeOf(before).bounds;
		const b = this.layout.envelopeOf(after).bounds;
		const midpoint =
			(Math.min(a[axis] + extent(a, axis), b[axis] + extent(b, axis)) +
				Math.max(a[axis], b[axis])) /
			2;
		for (const id of this.ids)
			equalMetric(
				'Centre de la jonction sur le rail de base',
				center(this.layout.getById(id).bounds, axis),
				midpoint,
				{ boxes: [id] },
			);
		return this;
	}

	areOnRailOfRoute(routeId: string): this {
		const route = defined(this.layout.relations.find(({ id }) => id === routeId));
		const { primary, transverse } = axesFor(this.layout.direction);
		const traverses = routeSegments(route).filter(({ axis }) => axis === transverse);
		for (const id of this.ids) {
			const coordinate = center(this.layout.getById(id).bounds, primary);
			equalMetric(
				'Jonction et traverse sur le même rail',
				Math.min(...traverses.map(({ fixed }) => Math.abs(fixed - coordinate))),
				0,
				{ boxes: [id], routes: [routeId] },
			);
		}
		return this;
	}

	haveSizeForUsedQuays(options: Omit<QuaySizeOptions, 'incoming' | 'outgoing'>): this {
		for (const id of this.ids)
			AssertQuaySize(this.layout, id).matchesContentAndQuays({
				...options,
				incoming: usedQuayCount(this.layout, id, 'incoming'),
				outgoing: usedQuayCount(this.layout, id, 'outgoing'),
			});
		return this;
	}
}
