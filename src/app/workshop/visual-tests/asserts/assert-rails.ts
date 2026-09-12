import { defined } from '../../../../lib/core/document/logic-document';
import { axesFor } from '../directions';
import type { VisualLayout } from '../visual-layout';
import { routeSegments } from './route-geometry';
import { distinctCoordinates, equalMetric, extent, minimumMetric } from './routing-measurements';

interface RailRoom {
	readonly baseGap: number;
	readonly spacing: number;
	readonly inset: number;
}
interface RailAssertions {
	haveCount(count: number): RailAssertions;
	haveAtLeast(count: number): RailAssertions;
	haveRoom(options: RailRoom): RailAssertions;
}

export function rowGap(
	layout: VisualLayout,
	rows: readonly [readonly string[], readonly string[]],
): number {
	const axis = axesFor(layout.direction).primary;
	const a = layout.envelopeOf(rows[0]).bounds;
	const b = layout.envelopeOf(rows[1]).bounds;
	return (
		Math.max(a[axis], b[axis]) - Math.min(a[axis] + extent(a, axis), b[axis] + extent(b, axis))
	);
}

/** Rails are observed from nonzero transverse runs; straight routes allocate none here. */
export function AssertRails(
	layout: VisualLayout,
	rows: readonly [readonly string[], readonly string[]],
): RailAssertions {
	const [first, second] = rows.map((ids) => new Set(ids));
	const routes = layout.relations.filter(({ from, to }) => {
		const forward = defined(first).has(from) && defined(second).has(to);
		const backward = defined(second).has(from) && defined(first).has(to);
		return forward || backward;
	});
	if (routes.length === 0) throw new Error('Aucune route entre les rangées.');
	const axes = axesFor(layout.direction);
	const segments = routes
		.flatMap(routeSegments)
		.filter((segment) => segment.axis === axes.transverse);
	const rails = distinctCoordinates(segments.map((segment) => segment.fixed));
	const a = layout.envelopeOf(rows[0]).bounds;
	const b = layout.envelopeOf(rows[1]).bounds;
	const lower = Math.min(
		a[axes.primary] + extent(a, axes.primary),
		b[axes.primary] + extent(b, axes.primary),
	);
	const upper = Math.max(a[axes.primary], b[axes.primary]);
	const assertions = {
		haveCount(count: number) {
			equalMetric('Nombre de rails utilisés', rails.length, count, {
				routes: routes.map((route) => route.id),
			});
			return assertions;
		},
		haveAtLeast(count: number) {
			minimumMetric('Nombre de rails utilisés', rails.length, count, {
				routes: routes.map((route) => route.id),
			});
			return assertions;
		},
		haveRoom({
			baseGap,
			spacing,
			inset,
		}: {
			readonly baseGap: number;
			readonly spacing: number;
			readonly inset: number;
		}) {
			const required = baseGap + Math.max(0, rails.length - 1) * spacing;
			minimumMetric('Intervalle entre rangées', rowGap(layout, rows), required, {
				routes: routes.map((route) => route.id),
			});
			for (const [index, rail] of rails.entries()) {
				minimumMetric('Marge du rail à la rangée initiale', rail - lower, inset, {
					routes: routes.map((route) => route.id),
				});
				minimumMetric('Marge du rail à la rangée finale', upper - rail, inset, {
					routes: routes.map((route) => route.id),
				});
				if (index > 0)
					minimumMetric('Espacement entre rails', rail - defined(rails[index - 1]), spacing, {
						routes: routes.map((route) => route.id),
					});
			}
			return assertions;
		},
	};
	return assertions;
}
