import { defined } from '../../../src/lib/core/document/logic-document';
import { axesFor } from '../harnesses/visual-directions';
import type { VisualLayout } from '../harnesses/visual-layout';
import { AssertRoute } from './assert-route';
import { distinctCoordinates, equalMetric, extent, minimumMetric } from './routing-measurements';

export type PortRole = 'incoming' | 'outgoing';

interface PortAssertions {
	haveCountBetween(minimum: number, maximum: number): PortAssertions;
	haveCount(count: number): PortAssertions;
	areCentered(): PortAssertions;
	haveClearance(options: { readonly spacing: number; readonly inset: number }): PortAssertions;
}
export interface PortSizeOptions {
	readonly content: number;
	readonly incoming: number;
	readonly outgoing: number;
	readonly spacing: number;
	readonly inset: number;
}
interface PortSizeAssertions {
	matchesContentAndPorts(options: PortSizeOptions): void;
}

/** Observe physical anchors, not inferred allocator IDs: numbering remains a visual specification. */
export function AssertPorts(layout: VisualLayout, nodeId: string, role: PortRole): PortAssertions {
	const node = layout.getById(nodeId);
	const axis = axesFor(layout.direction).transverse;
	const routes = layout.relations.filter((route) => {
		if (role === 'incoming') return route.to === nodeId;
		return route.from === nodeId;
	});
	if (routes.length === 0) throw new Error(`Aucun port ${role} sur ${nodeId}.`);
	const anchors = routes.map((route) => {
		AssertRoute(route).isAttachedTo(layout.getById(route.from), layout.getById(route.to));
		if (role === 'incoming') return defined(route.points.at(-1));
		return defined(route.points.at(0));
	});
	const coordinates = distinctCoordinates(anchors.map((point) => point[axis]));
	const primary = axesFor(layout.direction).primary;
	const face = defined(anchors[0])[primary];
	equalMetric(
		`Face principale de ${nodeId}`,
		Math.min(
			Math.abs(face - node.bounds[primary]),
			Math.abs(face - node.bounds[primary] - extent(node.bounds, primary)),
		),
		0,
		{ boxes: [nodeId] },
	);
	for (const anchor of anchors)
		equalMetric(`Face des ports ${nodeId}/${role}`, anchor[primary], face, { boxes: [nodeId] });
	const start = node.bounds[axis];
	const size = extent(node.bounds, axis);
	const assertions = {
		haveCountBetween(minimum: number, maximum: number) {
			minimumMetric(`Nombre minimal de ports ${nodeId}/${role}`, coordinates.length, minimum, {
				boxes: [nodeId],
			});
			minimumMetric(`Nombre maximal de ports ${nodeId}/${role}`, maximum, coordinates.length, {
				boxes: [nodeId],
			});
			return assertions;
		},
		haveCount(count: number) {
			equalMetric(`Nombre de ports ${nodeId}/${role}`, coordinates.length, count, {
				boxes: [nodeId],
			});
			return assertions;
		},
		areCentered() {
			const center = (defined(coordinates[0]) + defined(coordinates.at(-1))) / 2;
			equalMetric(`Centre des ports ${nodeId}/${role}`, center, start + size / 2, {
				boxes: [nodeId],
			});
			return assertions;
		},
		haveClearance({ spacing, inset }: { readonly spacing: number; readonly inset: number }) {
			minimumMetric(`Marge initiale ${nodeId}/${role}`, defined(coordinates[0]) - start, inset, {
				boxes: [nodeId],
			});
			minimumMetric(
				`Marge finale ${nodeId}/${role}`,
				start + size - defined(coordinates.at(-1)),
				inset,
				{ boxes: [nodeId] },
			);
			for (let index = 1; index < coordinates.length; index += 1) {
				minimumMetric(
					`Espacement des ports ${nodeId}/${role}`,
					defined(coordinates[index]) - defined(coordinates[index - 1]),
					spacing,
					{ boxes: [nodeId] },
				);
			}
			return assertions;
		},
	};
	return assertions;
}

export function AssertPortSize(layout: VisualLayout, nodeId: string): PortSizeAssertions {
	return {
		matchesContentAndPorts({ content, incoming, outgoing, spacing, inset }: PortSizeOptions) {
			const count = Math.max(incoming, outgoing, 1);
			const required = 2 * inset + (count - 1) * spacing;
			const actual = extent(layout.getById(nodeId).bounds, axesFor(layout.direction).transverse);
			equalMetric(`Dimension transversale de ${nodeId}`, actual, Math.max(content, required), {
				boxes: [nodeId],
			});
		},
	};
}

/** Used anchors only; unused port capacity is not exposed by the engine. */
export function usedPortCount(layout: VisualLayout, nodeId: string, role: PortRole): number {
	const axis = axesFor(layout.direction).transverse;
	const coordinates: number[] = [];
	for (const route of layout.relations) {
		if (role === 'incoming' && route.to === nodeId)
			coordinates.push(defined(route.points.at(-1))[axis]);
		if (role === 'outgoing' && route.from === nodeId)
			coordinates.push(defined(route.points.at(0))[axis]);
	}
	return distinctCoordinates(coordinates).length;
}
