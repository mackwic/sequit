import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type {
	Bounds,
	GroupMeasurement,
	LayoutResult,
	Point,
	Size,
} from '../../../../src/app/web/projection/layout-graph';
import {
	EndpointKind,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import {
	PORT_INSET,
	PORT_SPACING,
	RAIL_SPACING,
} from '../../../../src/lib/core/layout/layout-settings';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import {
	boundsById,
	boundsFor,
	contains,
	layoutDocument,
	overlaps,
	progressesFromTo,
} from '../../../support/harnesses/layout';

interface LayoutCase {
	readonly document: LogicDocument;
	readonly nodes: Readonly<Record<string, Size>>;
	readonly junctions: Readonly<Record<string, Size>>;
	readonly groups: Readonly<Record<string, GroupMeasurement>>;
}

const sizeArbitrary: fc.Arbitrary<Size> = fc.record({
	width: fc.integer({ min: 1, max: 600 }),
	height: fc.integer({ min: 1, max: 300 }),
});
const groupMeasurementArbitrary: fc.Arbitrary<GroupMeasurement> = fc.record({
	minimumWidth: fc.integer({ min: 40, max: 400 }),
	minimumHeight: fc.integer({ min: 40, max: 240 }),
	headerHeight: fc.integer({ min: 1, max: 80 }),
	padding: fc.integer({ min: 1, max: 60 }),
});

function requiredAt<T>(values: readonly T[], index: number, description: string): T {
	const value = values[index];
	if (value === undefined) throw new Error(`Missing generated ${description} at index ${index}`);
	return value;
}

const layoutCaseArbitrary: fc.Arbitrary<LayoutCase> = richAcyclicLogicDocumentArbitrary({
	minNodes: 3,
	maxNodes: 12,
}).chain((document) =>
	fc
		.tuple(
			fc.array(sizeArbitrary, {
				minLength: document.nodes.length,
				maxLength: document.nodes.length,
			}),
			fc.array(sizeArbitrary, {
				minLength: document.junctions.length,
				maxLength: document.junctions.length,
			}),
			fc.array(groupMeasurementArbitrary, {
				minLength: document.groups.length,
				maxLength: document.groups.length,
			}),
		)
		.map(([nodeSizes, junctionSizes, groupMeasurements]) => ({
			document,
			nodes: Object.fromEntries(
				document.nodes.map(({ id }, index) => [id, requiredAt(nodeSizes, index, 'node size')]),
			),
			junctions: Object.fromEntries(
				document.junctions.map(({ id }, index) => [
					id,
					requiredAt(junctionSizes, index, 'junction size'),
				]),
			),
			groups: Object.fromEntries(
				document.groups.map(({ id }, index) => [
					id,
					requiredAt(groupMeasurements, index, 'group measurement'),
				]),
			),
		})),
);

function overridesFor(generated: LayoutCase) {
	return {
		nodes: generated.nodes,
		junctions: generated.junctions,
		groups: generated.groups,
	};
}

function expectFinite(value: number): void {
	expect(Number.isFinite(value)).toBe(true);
}

function parentGroupByEndpoint(document: LogicDocument): ReadonlyMap<string, string | undefined> {
	return new Map(
		[...document.groups, ...document.nodes, ...document.junctions].map(({ id, groupId }) => [
			id,
			groupId,
		]),
	);
}

function isGroupAncestor(
	parents: ReadonlyMap<string, string | undefined>,
	ancestorId: string,
	endpointId: string,
): boolean {
	let parentId = parents.get(endpointId);
	while (parentId !== undefined) {
		if (parentId === ancestorId) return true;
		parentId = parents.get(parentId);
	}
	return false;
}

function expectedBoundaryPoint(
	bounds: Bounds,
	direction: LogicDocument['layout']['direction'],
	source: boolean,
): Point {
	switch (direction) {
		case LayoutDirection.TopToBottom:
			if (!source) {
				return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };
			}
			return { x: bounds.x + bounds.width / 2, y: bounds.y };
		case LayoutDirection.BottomToTop:
			if (!source) return { x: bounds.x + bounds.width / 2, y: bounds.y };
			return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };
		case LayoutDirection.LeftToRight:
			if (!source) {
				return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 };
			}
			return { x: bounds.x, y: bounds.y + bounds.height / 2 };
		case LayoutDirection.RightToLeft:
			if (!source) return { x: bounds.x, y: bounds.y + bounds.height / 2 };
			return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 };
		default:
			throw new Error(`Unsupported layout direction: ${String(direction)}`);
	}
}

function isOnBoundary(point: Point, bounds: Bounds): boolean {
	const withinX = point.x >= bounds.x && point.x <= bounds.x + bounds.width;
	const withinY = point.y >= bounds.y && point.y <= bounds.y + bounds.height;
	const onVertical = point.x === bounds.x || point.x === bounds.x + bounds.width;
	const onHorizontal = point.y === bounds.y || point.y === bounds.y + bounds.height;
	return (withinY && onVertical) || (withinX && onHorizontal);
}

function reversedCollections(document: LogicDocument): LogicDocument {
	return {
		...document,
		natures: [...document.natures].reverse(),
		groups: [...document.groups].reverse(),
		nodes: [...document.nodes].reverse(),
		junctions: [...document.junctions].reverse(),
		relations: [...document.relations].reverse(),
	};
}

function scaledRecord<T extends Size>(
	values: Readonly<Record<string, T>>,
	factor: number,
): Readonly<Record<string, T>> {
	return Object.fromEntries(
		Object.entries(values).map(([id, value]) => [
			id,
			{ ...value, width: value.width * factor, height: value.height * factor },
		]),
	);
}

function scaledGroupRecord(
	values: Readonly<Record<string, GroupMeasurement>>,
	factor: number,
): Readonly<Record<string, GroupMeasurement>> {
	return Object.fromEntries(
		Object.entries(values).map(([id, value]) => [
			id,
			{
				minimumWidth: value.minimumWidth * factor,
				minimumHeight: value.minimumHeight * factor,
				headerHeight: value.headerHeight * factor,
				padding: value.padding * factor,
			},
		]),
	);
}

function canonicalIds(layout: LayoutResult): object {
	return {
		elements: layout.elements.map(({ id, kind }) => ({ id, kind })),
		relations: layout.relations.map(({ id, from, to }) => ({ id, from, to })),
	};
}

function bypassedCorridorEndpoints(document: LogicDocument): ReadonlySet<string> {
	const groupById = new Map(document.nodes.map(({ id, groupId }) => [id, groupId] as const));
	const outgoing = new Map<string, string[]>();
	for (const { from, to } of document.relations) {
		const targets = outgoing.get(from) ?? [];
		targets.push(to);
		outgoing.set(from, targets);
	}

	const endpoints = new Set<string>();
	for (const bypass of document.relations) {
		if (!groupById.has(bypass.from) || !groupById.has(bypass.to)) continue;
		const path = [bypass.from];
		const visited = new Set(path);
		let current = bypass.from;
		let validChain = true;
		while (current !== bypass.to) {
			const targets = outgoing.get(current) ?? [];
			let next: string | undefined;
			if (current === bypass.from) {
				if (targets.length !== 2) {
					validChain = false;
					break;
				}
				next = targets.find((id) => id !== bypass.to);
			} else {
				if (targets.length !== 1) {
					validChain = false;
					break;
				}
				next = targets[0];
			}
			if (next === undefined || visited.has(next)) {
				validChain = false;
				break;
			}
			path.push(next);
			visited.add(next);
			current = next;
		}
		if (!validChain || path.length < 3 || (outgoing.get(bypass.to)?.length ?? 0) !== 0) continue;

		const pathIds = new Set(path);
		if (path.some((id) => !groupById.has(id))) continue;
		const first = path[0];
		if (first === undefined) continue;
		const groupId = groupById.get(first);
		if (path.some((id) => groupById.get(id) !== groupId)) continue;
		const connectedRelations = document.relations.filter(
			({ from, to }) => pathIds.has(from) || pathIds.has(to),
		);
		if (
			connectedRelations.length !== path.length ||
			connectedRelations.some(({ from, to }) => !pathIds.has(from) || !pathIds.has(to))
		)
			continue;
		endpoints.add(bypass.from);
		endpoints.add(bypass.to);
	}
	return endpoints;
}

function expectMeasuredNode(
	layout: LayoutResult,
	id: string,
	measured: Size,
	direction: LayoutDirection,
	bypassed: boolean,
): void {
	const box = boundsFor(layout, id);
	const vertical = [LayoutDirection.TopToBottom, LayoutDirection.BottomToTop].includes(direction);
	const coordinate = (point: Point): number => {
		if (vertical) return point.x;
		return point.y;
	};
	const incoming = new Set<number>();
	const outgoing = new Set<number>();
	for (const route of layout.relations) {
		const start = route.points.at(0);
		const end = route.points.at(-1);
		if (route.from === id && start !== undefined) outgoing.add(coordinate(start));
		if (route.to === id && end !== undefined) incoming.add(coordinate(end));
	}
	const count = Math.max(incoming.size, outgoing.size, 1);
	let content = measured.height;
	let actual = box.height;
	if (vertical) {
		content = measured.width;
		actual = box.width;
	}
	let required = count * 48;
	if (
		layout.elements.some((element) => element.id === id && element.kind === EndpointKind.Junction)
	)
		required = 16 + (count - 1) * 12;
	const reserved = Math.max(content, required);
	if (vertical) expect(box.height).toBe(measured.height);
	else expect(box.width).toBe(measured.width);
	if (count === 1) expect([content, reserved]).toContain(actual);
	else {
		const corridorExtent = 2 * (PORT_SPACING + RAIL_SPACING + PORT_INSET);
		let expected = reserved;
		if (bypassed) expected = Math.max(reserved, corridorExtent);
		expect(actual, 'Measured node dimensions must match required clearance').toBe(expected);
	}
}

describe('generated layouts', () => {
	it('produces only finite coordinates and dimensions for every generated rich DAG', async () => {
		await fc.assert(
			fc.asyncProperty(layoutCaseArbitrary, async (generated) => {
				const { layout } = await layoutDocument(generated.document, overridesFor(generated));
				expectFinite(layout.width);
				expectFinite(layout.height);
				for (const { bounds } of layout.elements) {
					expectFinite(bounds.x);
					expectFinite(bounds.y);
					expectFinite(bounds.width);
					expectFinite(bounds.height);
				}
				for (const relation of layout.relations) {
					for (const point of relation.points) {
						expectFinite(point.x);
						expectFinite(point.y);
					}
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('never overlaps layout elements unless one is the group ancestor of the other', async () => {
		await fc.assert(
			fc.asyncProperty(layoutCaseArbitrary, async (generated) => {
				const { layout } = await layoutDocument(generated.document, overridesFor(generated));
				const parents = parentGroupByEndpoint(generated.document);
				for (const [index, left] of layout.elements.entries()) {
					for (const right of layout.elements.slice(index + 1)) {
						if (
							isGroupAncestor(parents, left.id, right.id) ||
							isGroupAncestor(parents, right.id, left.id)
						) {
							continue;
						}
						expect(overlaps(left.bounds, right.bounds), `${left.id} overlaps ${right.id}`).toBe(
							false,
						);
					}
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('places every direct group member strictly inside its group bounds', async () => {
		await fc.assert(
			fc.asyncProperty(layoutCaseArbitrary, async (generated) => {
				const { layout } = await layoutDocument(generated.document, overridesFor(generated));
				for (const member of [
					...generated.document.groups,
					...generated.document.nodes,
					...generated.document.junctions,
				]) {
					if (member.groupId === undefined) continue;
					expect(
						contains(boundsFor(layout, member.groupId), boundsFor(layout, member.id)),
						`${member.groupId} does not contain ${member.id}`,
					).toBe(true);
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('keeps the global layout envelope around every element', async () => {
		await fc.assert(
			fc.asyncProperty(layoutCaseArbitrary, async (generated) => {
				const { layout } = await layoutDocument(generated.document, overridesFor(generated));
				for (const { bounds } of layout.elements) {
					expect(bounds.x).toBeGreaterThanOrEqual(0);
					expect(bounds.y).toBeGreaterThanOrEqual(0);
					expect(bounds.x + bounds.width).toBeLessThanOrEqual(layout.width);
					expect(bounds.y + bounds.height).toBeLessThanOrEqual(layout.height);
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('routes every relation through principal faces, including group sources and targets', async () => {
		await fc.assert(
			fc.asyncProperty(layoutCaseArbitrary, async (generated) => {
				const { document, layout } = await layoutDocument(
					generated.document,
					overridesFor(generated),
				);
				for (const relation of layout.relations) {
					const sourceBounds = boundsFor(layout, relation.from);
					const targetBounds = boundsFor(layout, relation.to);
					const first = relation.points[0];
					const last = relation.points.at(-1);
					expect(first).toBeDefined();
					expect(last).toBeDefined();
					if (first === undefined || last === undefined) continue;
					expect(isOnBoundary(first, sourceBounds)).toBe(true);
					expect(isOnBoundary(last, targetBounds)).toBe(true);
					expect(
						relation.points.slice(1).every((point, index) => {
							const previous = relation.points[index];
							return previous !== undefined && (previous.x === point.x || previous.y === point.y);
						}),
					).toBe(true);
					// Crossing separation may offset ports transversely and choose a noncentral lane.
					// Both ports must still face the parent/child corridor, and no leg may backtrack.
					const direction = document.layout.direction;
					let axis: 'x' | 'y' = 'x';
					if (
						direction === LayoutDirection.TopToBottom ||
						direction === LayoutDirection.BottomToTop
					)
						axis = 'y';
					expect(first[axis]).toBe(expectedBoundaryPoint(sourceBounds, direction, true)[axis]);
					expect(last[axis]).toBe(expectedBoundaryPoint(targetBounds, direction, false)[axis]);
					let transverse: 'x' | 'y' = 'y';
					if (axis === 'y') transverse = 'x';
					const departure = relation.points.find(
						(point) => point.x !== first.x || point.y !== first.y,
					);
					const arrival = relation.points.findLast(
						(point) => point.x !== last.x || point.y !== last.y,
					);
					expect(departure?.[transverse]).toBe(first[transverse]);
					expect(arrival?.[transverse]).toBe(last[transverse]);
					const sign = Math.sign(last[axis] - first[axis]);
					for (const [index, point] of relation.points.slice(1).entries()) {
						const previous = requiredAt(relation.points, index, 'route point');
						expect((point[axis] - previous[axis]) * sign).toBeGreaterThanOrEqual(0);
					}
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('places every child after its parent in the configured direction', async () => {
		await fc.assert(
			fc.asyncProperty(layoutCaseArbitrary, async (generated) => {
				const { document, layout } = await layoutDocument(
					generated.document,
					overridesFor(generated),
				);
				for (const relation of layout.relations) {
					expect(
						progressesFromTo(
							boundsFor(layout, relation.to),
							boundsFor(layout, relation.from),
							document.layout.direction,
						),
						`${relation.to} does not precede its child ${relation.from}`,
					).toBe(true);
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('is invariant to permutations of every document collection', async () => {
		await fc.assert(
			fc.asyncProperty(layoutCaseArbitrary, async (generated) => {
				const original = await layoutDocument(generated.document, overridesFor(generated));
				const permuted = await layoutDocument(
					reversedCollections(generated.document),
					overridesFor(generated),
				);
				expect(permuted.layout).toEqual(original.layout);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('scales content while preserving topology and required port clearances', async () => {
		await fc.assert(
			fc.asyncProperty(
				layoutCaseArbitrary,
				fc.integer({ min: 2, max: 4 }),
				async (generated, factor) => {
					const original = await layoutDocument(generated.document, overridesFor(generated));
					const scaled = await layoutDocument(generated.document, {
						nodes: scaledRecord(generated.nodes, factor),
						junctions: scaledRecord(generated.junctions, factor),
						groups: scaledGroupRecord(generated.groups, factor),
					});
					expect(canonicalIds(scaled.layout)).toEqual(canonicalIds(original.layout));
					const originalBounds = boundsById(original.layout);
					const bypassedEndpoints = bypassedCorridorEndpoints(generated.document);
					for (const node of [...generated.document.nodes, ...generated.document.junctions]) {
						const measured = generated.nodes[node.id] ?? generated.junctions[node.id];
						if (measured === undefined) throw new Error(`Missing node measurement: ${node.id}`);
						expectMeasuredNode(
							original.layout,
							node.id,
							measured,
							generated.document.layout.direction,
							bypassedEndpoints.has(node.id),
						);
						expectMeasuredNode(
							scaled.layout,
							node.id,
							{ width: measured.width * factor, height: measured.height * factor },
							generated.document.layout.direction,
							bypassedEndpoints.has(node.id),
						);
					}
					const parentGroupIds = new Set(
						[
							...generated.document.groups,
							...generated.document.nodes,
							...generated.document.junctions,
						].flatMap(({ groupId: parentId }) => {
							if (parentId === undefined) return [];
							return [parentId];
						}),
					);
					for (const group of generated.document.groups) {
						if (parentGroupIds.has(group.id)) continue;
						const before = originalBounds.get(group.id);
						const after = boundsFor(scaled.layout, group.id);
						expect(before).toBeDefined();
						if (!before) throw new Error(`Missing original empty group bounds: ${group.id}`);
						const measured = generated.groups[group.id];
						if (measured === undefined) throw new Error(`Missing group measurement: ${group.id}`);
						expect(after.width).toBeGreaterThanOrEqual(measured.minimumWidth * factor);
						expect(after.height).toBeGreaterThanOrEqual(measured.minimumHeight * factor);
						expect(after.width).toBeLessThanOrEqual(before.width * factor);
						expect(after.height).toBeLessThanOrEqual(before.height * factor);
					}
					for (const relation of scaled.layout.relations) {
						expect(
							progressesFromTo(
								boundsFor(scaled.layout, relation.to),
								boundsFor(scaled.layout, relation.from),
								generated.document.layout.direction,
							),
							`${relation.to} does not precede its child ${relation.from} after scaling`,
						).toBe(true);
					}
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
});
