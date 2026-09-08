import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LayoutDirection, type LogicDocument } from '../../src/lib/document/logic-document';
import type {
	Bounds,
	GroupMeasurement,
	LayoutResult,
	Point,
	Size,
} from '../../src/lib/layout/layout-graph';
import { richAcyclicLogicDocumentArbitrary } from '../builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../builders/property-test-options';
import {
	boundsById,
	boundsFor,
	contains,
	layoutDocument,
	overlaps,
	progressesFromTo,
} from '../harnesses/layout';

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

function groupMeasurementFor(generated: LayoutCase, groupId: string): GroupMeasurement {
	const measurement = generated.groups[groupId];
	if (measurement === undefined) throw new Error(`Missing generated group measurement: ${groupId}`);
	return measurement;
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
			if (source) {
				return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };
			}
			return { x: bounds.x + bounds.width / 2, y: bounds.y };
		case LayoutDirection.BottomToTop:
			if (source) return { x: bounds.x + bounds.width / 2, y: bounds.y };
			return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };
		case LayoutDirection.LeftToRight:
			if (source) {
				return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 };
			}
			return { x: bounds.x, y: bounds.y + bounds.height / 2 };
		case LayoutDirection.RightToLeft:
			if (source) return { x: bounds.x, y: bounds.y + bounds.height / 2 };
			return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 };
		default:
			throw new Error(`Unsupported layout direction: ${String(direction)}`);
	}
}

function expectedRoutePoints(
	source: Bounds,
	target: Bounds,
	direction: LogicDocument['layout']['direction'],
): readonly Point[] {
	const start = expectedBoundaryPoint(source, direction, true);
	const end = expectedBoundaryPoint(target, direction, false);
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop) {
		const middle = (start.y + end.y) / 2;
		return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
	}
	const middle = (start.x + end.x) / 2;
	return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
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

	it('routes every relation orthogonally and keeps group attachments below their headers', async () => {
		await fc.assert(
			fc.asyncProperty(layoutCaseArbitrary, async (generated) => {
				const { document, layout } = await layoutDocument(
					generated.document,
					overridesFor(generated),
				);
				const groupsById = new Map(document.groups.map((group) => [group.id, group]));
				for (const relation of layout.relations) {
					const sourceBounds = boundsFor(layout, relation.from);
					const targetBounds = boundsFor(layout, relation.to);
					const sourceGroup = groupsById.get(relation.from);
					const targetGroup = groupsById.get(relation.to);
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
					if (sourceGroup !== undefined) {
						expect(first.y).toBeGreaterThan(
							sourceBounds.y + groupMeasurementFor(generated, sourceGroup.id).headerHeight,
						);
					}
					if (targetGroup !== undefined) {
						expect(last.y).toBeGreaterThan(
							targetBounds.y + groupMeasurementFor(generated, targetGroup.id).headerHeight,
						);
					}
					if (sourceGroup === undefined && targetGroup === undefined) {
						expect(relation.points).toEqual(
							expectedRoutePoints(sourceBounds, targetBounds, document.layout.direction),
						);
					}
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('progresses every relation strictly in the configured direction', async () => {
		await fc.assert(
			fc.asyncProperty(layoutCaseArbitrary, async (generated) => {
				const { document, layout } = await layoutDocument(
					generated.document,
					overridesFor(generated),
				);
				for (const relation of layout.relations) {
					expect(
						progressesFromTo(
							boundsFor(layout, relation.from),
							boundsFor(layout, relation.to),
							document.layout.direction,
						),
						`${relation.from} does not precede ${relation.to}`,
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

	it('preserves topology and scales measured endpoint dimensions uniformly', async () => {
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
					for (const endpoint of [...generated.document.nodes, ...generated.document.junctions]) {
						const before = originalBounds.get(endpoint.id);
						const after = boundsFor(scaled.layout, endpoint.id);
						expect(before).toBeDefined();
						if (!before) throw new Error(`Missing original endpoint bounds: ${endpoint.id}`);
						expect(after.width).toBe(before.width * factor);
						expect(after.height).toBe(before.height * factor);
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
						expect(after.width).toBe(before.width * factor);
						expect(after.height).toBe(before.height * factor);
					}
					for (const relation of scaled.layout.relations) {
						expect(
							progressesFromTo(
								boundsFor(scaled.layout, relation.from),
								boundsFor(scaled.layout, relation.to),
								generated.document.layout.direction,
							),
							`${relation.from} does not precede ${relation.to} after scaling`,
						).toBe(true);
					}
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
});
