import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
/* eslint-disable max-lines */
import {
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicGroup,
} from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { deriveEndpointRows, orderEndpoints } from '../ordering/endpoint-order';
import { type ComponentLayout, isVerticalDirection, layoutComponent } from './component-layout';
import {
	assertRelationBoundsAreDisjoint,
	routePointsWithGroupHeaders,
	translateBounds,
} from './dedicated-layout-geometry';
import type {
	Bounds,
	GroupMeasurement,
	LayoutElement,
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
	Size,
} from './layout-types';

const OUTER_MARGIN = 40;
const COMPONENT_GAP = 96;
const DEFAULT_RANK_GAP = 72;

interface RankedComponent {
	readonly ids: readonly string[];
	readonly context: string;
	readonly effectiveOrder: number;
	readonly layout: ComponentLayout;
}

function assertPositive(value: number, name: string): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a finite positive number`);
	}
}

function assertNonNegative(value: number, name: string): void {
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`${name} must be a finite non-negative number`);
	}
}

function validateSize(size: Size, name: string): Size {
	assertPositive(size.width, `${name}.width`);
	assertPositive(size.height, `${name}.height`);
	return size;
}

function validateGroupMeasurement(
	measurement: GroupMeasurement,
	groupId: string,
): GroupMeasurement {
	assertPositive(measurement.minimumWidth, `groups.${groupId}.minimumWidth`);
	assertPositive(measurement.minimumHeight, `groups.${groupId}.minimumHeight`);
	assertNonNegative(measurement.headerHeight, `groups.${groupId}.headerHeight`);
	assertNonNegative(measurement.padding, `groups.${groupId}.padding`);
	return {
		...measurement,
		minimumHeight: Math.max(
			measurement.minimumHeight,
			measurement.headerHeight + measurement.padding * 2,
		),
	};
}

function endpointSize(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	endpointId: string,
): Size {
	const endpoint = defined(graph.endpointsById.get(endpointId));
	if (endpoint.kind === EndpointKind.Node) {
		const size = measurements.nodes.get(endpointId);
		if (!size) throw new Error(`Missing node measurement: ${endpointId}`);
		return validateSize(size, `nodes.${endpointId}`);
	}
	if (endpoint.kind === EndpointKind.Junction) {
		const size = measurements.junctions.get(endpointId);
		if (!size) throw new Error(`Missing junction measurement: ${endpointId}`);
		return validateSize(size, `junctions.${endpointId}`);
	}
	const measurement = measurements.groups.get(endpointId);
	if (!measurement) throw new Error(`Missing group measurement: ${endpointId}`);
	const validated = validateGroupMeasurement(measurement, endpointId);
	return { width: validated.minimumWidth, height: validated.minimumHeight };
}

function enqueueUnvisited(ids: Iterable<string>, visited: Set<string>, pending: string[]): void {
	for (const id of ids) {
		if (visited.has(id)) continue;
		visited.add(id);
		pending.push(id);
	}
}

function weaklyConnectedComponents(graph: LogicGraph): readonly (readonly string[])[] {
	const visited = new Set<string>();
	const result: string[][] = [];
	for (const start of graph.rankableEndpointIds) {
		if (visited.has(start)) continue;
		const pending = [start];
		const component: string[] = [];
		visited.add(start);
		while (pending.length > 0) {
			const id = defined(pending.pop());
			component.push(id);
			const adjacent = [
				...defined(graph.outgoingByEndpointId.get(id)),
				...defined(graph.predecessorsByEndpointId.get(id)),
			].sort((left, right) => compareCanonicalStrings(right, left));
			enqueueUnvisited(adjacent, visited, pending);
		}
		component.sort(compareCanonicalStrings);
		result.push(component);
	}
	return result;
}

function topLevelGroupId(groupId: string, groupsById: ReadonlyMap<string, LogicGroup>): string {
	let current = groupId;
	for (;;) {
		const parent = groupsById.get(current)?.groupId;
		if (parent === undefined) return current;
		current = parent;
	}
}

function componentContext(
	graph: LogicGraph,
	ids: readonly string[],
	groupsById: ReadonlyMap<string, LogicGroup>,
): string {
	const contexts = new Set<string>();
	for (const id of ids) {
		const groupId = graph.endpointsById.get(id)?.entity.groupId;
		contexts.add(groupId === undefined ? '~root' : topLevelGroupId(groupId, groupsById));
	}
	return [...contexts].sort(compareCanonicalStrings).join('|');
}

function groupDepth(group: LogicGroup, groupsById: ReadonlyMap<string, LogicGroup>): number {
	let depth = 0;
	let parentId = group.groupId;
	while (parentId !== undefined) {
		depth += 1;
		parentId = groupsById.get(parentId)?.groupId;
	}
	return depth;
}

function relationGroupRankGap(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	groupsById: ReadonlyMap<string, LogicGroup>,
	vertical: boolean,
): number {
	const groupShellExtents = new Map<string, number>();
	const groupShellExtent = (groupId: string, forwardLeading: boolean): number => {
		const key = `${forwardLeading ? 'leading' : 'trailing'}:${groupId}`;
		const cached = groupShellExtents.get(key);
		if (cached !== undefined) return cached;
		const measurement = measurements.groups.get(groupId);
		if (!measurement) throw new Error(`Missing group measurement: ${groupId}`);
		const validated = validateGroupMeasurement(measurement, groupId);
		const parentId = groupsById.get(groupId)?.groupId;
		const headerExtent = vertical && forwardLeading ? validated.headerHeight : 0;
		const parentExtent = parentId === undefined ? 0 : groupShellExtent(parentId, forwardLeading);
		const extent = validated.padding + headerExtent + parentExtent;
		groupShellExtents.set(key, extent);
		return extent;
	};
	const shellExtent = (endpointId: string, forwardLeading: boolean): number => {
		const groupId = graph.endpointsById.get(endpointId)?.entity.groupId;
		return groupId === undefined ? 0 : groupShellExtent(groupId, forwardLeading);
	};
	const forwardIsPhysicalStart =
		graph.document.layout.direction === LayoutDirection.TopToBottom ||
		graph.document.layout.direction === LayoutDirection.LeftToRight;
	let rankGap = DEFAULT_RANK_GAP;
	for (const relation of graph.effectiveRelations) {
		const sourceExtent = Math.max(
			0,
			...relation.sourceIds.map((id) => shellExtent(id, !forwardIsPhysicalStart)),
		);
		const targetExtent = Math.max(
			0,
			...relation.targetIds.map((id) => shellExtent(id, forwardIsPhysicalStart)),
		);
		rankGap = Math.max(rankGap, sourceExtent + targetExtent);
	}
	return rankGap;
}

function createLayoutResult(
	graph: LogicGraph,
	bounds: Map<string, Bounds>,
	measurements: LayoutMeasurements,
): LayoutResult {
	const relations: LayoutRelation[] = graph.relations.map(({ relation }) => {
		const source = defined(bounds.get(relation.from));
		const target = defined(bounds.get(relation.to));
		assertRelationBoundsAreDisjoint({
			relationId: relation.id,
			from: relation.from,
			to: relation.to,
			source,
			target,
		});
		const sourceEndpoint = defined(graph.endpointsById.get(relation.from));
		const targetEndpoint = defined(graph.endpointsById.get(relation.to));
		return {
			id: relation.id,
			from: relation.from,
			to: relation.to,
			points: routePointsWithGroupHeaders({
				source,
				target,
				direction: graph.document.layout.direction,
				sourceGroup:
					sourceEndpoint.kind === EndpointKind.Group
						? measurements.groups.get(relation.from)
						: undefined,
				targetGroup:
					targetEndpoint.kind === EndpointKind.Group
						? measurements.groups.get(relation.to)
						: undefined,
			}),
		};
	});
	const elements: LayoutElement[] = [];
	let width = OUTER_MARGIN * 2;
	let height = OUTER_MARGIN * 2;
	for (const [id, value] of bounds) {
		const endpoint = defined(graph.endpointsById.get(id));
		elements.push({ id, kind: endpoint.kind, bounds: value });
		width = Math.max(width, value.x + value.width + OUTER_MARGIN);
		height = Math.max(height, value.y + value.height + OUTER_MARGIN);
	}
	elements.sort((left, right) => compareCanonicalStrings(left.id, right.id));
	relations.sort((left, right) => compareCanonicalStrings(left.id, right.id));
	return { width, height, elements, relations };
}

function groupMemberBounds(
	graph: LogicGraph,
	groupId: string,
	bounds: ReadonlyMap<string, Bounds>,
): readonly Bounds[] {
	const result: Bounds[] = [];
	const members = [...graph.document.nodes, ...graph.document.junctions, ...graph.document.groups];
	for (const member of members) {
		if (member.groupId !== groupId) continue;
		result.push(defined(bounds.get(member.id)));
	}
	return result;
}

function repackContainmentComponents(
	graph: LogicGraph,
	bounds: Map<string, Bounds>,
	vertical: boolean,
) {
	const adjacency = new Map<string, Set<string>>();
	const connect = (left: string, right: string): void => {
		if (!adjacency.has(left)) adjacency.set(left, new Set());
		if (!adjacency.has(right)) adjacency.set(right, new Set());
		defined(adjacency.get(left)).add(right);
		defined(adjacency.get(right)).add(left);
	};
	for (const { relation } of graph.relations) connect(relation.from, relation.to);
	for (const endpoint of graph.endpointsById.values()) {
		if (endpoint.entity.groupId !== undefined) connect(endpoint.entity.id, endpoint.entity.groupId);
	}
	// Rankable bounds were inserted in packing order before group insets expanded them.
	const pendingIds = [...bounds.keys()];
	const visited = new Set<string>();
	const components: string[][] = [];
	for (const start of pendingIds) {
		if (visited.has(start)) continue;
		const ids: string[] = [];
		const pending = [start];
		visited.add(start);
		while (pending.length > 0) {
			const id = defined(pending.pop());
			ids.push(id);
			enqueueUnvisited(adjacency.get(id) ?? [], visited, pending);
		}
		components.push(ids);
	}
	const crossExtent = (ids: readonly string[]) => {
		const values = ids.map((id) => bounds.get(id)).filter((value) => value !== undefined);
		return {
			minimum: Math.min(...values.map((value) => (vertical ? value.x : value.y))),
			maximum: Math.max(
				...values.map((value) => (vertical ? value.x + value.width : value.y + value.height)),
			),
		};
	};
	let cross = OUTER_MARGIN;
	for (const ids of components) {
		const extent = crossExtent(ids);
		const shift = cross - extent.minimum;
		for (const id of ids) {
			const value = defined(bounds.get(id));
			bounds.set(id, translateBounds(value, vertical ? shift : 0, vertical ? 0 : shift));
		}
		cross += extent.maximum - extent.minimum + COMPONENT_GAP;
	}
}

export function layoutWithDedicatedEngine(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
): LayoutResult {
	const sizes = new Map<string, Size>();
	for (const id of graph.rankableEndpointIds) {
		sizes.set(id, endpointSize(graph, measurements, id));
	}
	const groupsById = new Map(graph.document.groups.map((group) => [group.id, group]));
	const vertical = isVerticalDirection(graph.document.layout.direction);
	const maximumRank = Math.max(0, ...ranks.byEndpointId.values());
	const junctionIds = new Set(graph.document.junctions.map(({ id }) => id));
	const primaryBandSizes = Array.from({ length: maximumRank + 1 }, () => 1);
	for (const id of graph.rankableEndpointIds) {
		if (junctionIds.has(id)) continue;
		const rank = defined(ranks.byEndpointId.get(id));
		const size = defined(sizes.get(id));
		primaryBandSizes[rank] = Math.max(
			defined(primaryBandSizes[rank]),
			vertical ? size.height : size.width,
		);
	}
	const effectiveEndpointOrder = orderEndpoints([
		...graph.document.groups,
		...graph.document.nodes,
		...graph.document.junctions,
	]);
	const effectiveOrderById = new Map(effectiveEndpointOrder.map((id, index) => [id, index]));
	const rankGap = relationGroupRankGap(graph, measurements, groupsById, vertical);
	// FIXME: A target-local key move can change a component's minimum ordinal and swap the
	// entire component with an unrelated disconnected component. Component packing needs a
	// stable intent distinct from mutable within-row endpoint keys.
	const components: RankedComponent[] = weaklyConnectedComponents(graph).map((ids) => {
		return {
			ids,
			context: componentContext(graph, ids, groupsById),
			effectiveOrder: Math.min(
				...ids
					.filter((id) => ranks.byEndpointId.get(id) === 0)
					.map((id) => defined(effectiveOrderById.get(id))),
			),
			layout: layoutComponent(
				deriveEndpointRows({
					effectiveEndpointOrder,
					componentIds: ids,
					ranks: ranks.byEndpointId,
					junctionIds,
					maximumRank,
				}),
				sizes,
				graph.document.layout.direction,
				graph.document.layout.bias,
				primaryBandSizes,
				rankGap,
			),
		};
	});
	components.sort((left, right) => {
		const contextOrder = compareCanonicalStrings(left.context, right.context);
		const effectiveOrder = left.effectiveOrder - right.effectiveOrder;
		return contextOrder || effectiveOrder;
	});
	let maximumPrimaryLength = 0;
	for (const component of components) {
		maximumPrimaryLength = Math.max(
			maximumPrimaryLength,
			vertical ? component.layout.height : component.layout.width,
		);
	}

	const bounds = new Map<string, Bounds>();
	let cross = OUTER_MARGIN;
	for (const component of components) {
		const primaryLength = vertical ? component.layout.height : component.layout.width;
		const alignAtStart =
			graph.document.layout.bias === LayoutBias.Top ||
			graph.document.layout.bias === LayoutBias.Left;
		const primary = OUTER_MARGIN + (alignAtStart ? 0 : maximumPrimaryLength - primaryLength);
		const offsetX = vertical ? cross : primary;
		const offsetY = vertical ? primary : cross;
		for (const [id, value] of component.layout.boundsById) {
			bounds.set(id, translateBounds(value, offsetX, offsetY));
		}
		cross += (vertical ? component.layout.width : component.layout.height) + COMPONENT_GAP;
	}

	const groupsByDescendingDepth = [...graph.document.groups].sort(
		(left, right) =>
			groupDepth(right, groupsById) - groupDepth(left, groupsById) ||
			compareCanonicalStrings(left.id, right.id),
	);
	for (const group of groupsByDescendingDepth) {
		const measurement = measurements.groups.get(group.id);
		if (!measurement) throw new Error(`Missing group measurement: ${group.id}`);
		const validated = validateGroupMeasurement(measurement, group.id);
		const memberBounds = groupMemberBounds(graph, group.id, bounds);
		if (memberBounds.length === 0) {
			if (bounds.has(group.id)) continue;
			const primaryLength = vertical ? validated.minimumHeight : validated.minimumWidth;
			const alignAtStart =
				graph.document.layout.bias === LayoutBias.Top ||
				graph.document.layout.bias === LayoutBias.Left;
			const primary = OUTER_MARGIN + (alignAtStart ? 0 : maximumPrimaryLength - primaryLength);
			bounds.set(group.id, {
				x: vertical ? cross : primary,
				y: vertical ? primary : cross,
				width: validated.minimumWidth,
				height: validated.minimumHeight,
			});
			cross += (vertical ? validated.minimumWidth : validated.minimumHeight) + COMPONENT_GAP;
			continue;
		}

		let left = Number.POSITIVE_INFINITY;
		let top = Number.POSITIVE_INFINITY;
		let right = Number.NEGATIVE_INFINITY;
		let bottom = Number.NEGATIVE_INFINITY;
		for (const member of memberBounds) {
			left = Math.min(left, member.x);
			top = Math.min(top, member.y);
			right = Math.max(right, member.x + member.width);
			bottom = Math.max(bottom, member.y + member.height);
		}
		const x = left - validated.padding;
		const y = top - validated.headerHeight - validated.padding;
		bounds.set(group.id, {
			x,
			y,
			width: Math.max(validated.minimumWidth, right - x + validated.padding),
			height: Math.max(validated.minimumHeight, bottom - y + validated.padding),
		});
	}
	repackContainmentComponents(graph, bounds, vertical);

	let minimumX = 0;
	let minimumY = 0;
	for (const value of bounds.values()) {
		minimumX = Math.min(minimumX, value.x);
		minimumY = Math.min(minimumY, value.y);
	}
	const shiftX = Math.max(0, OUTER_MARGIN - minimumX);
	const shiftY = Math.max(0, OUTER_MARGIN - minimumY);
	for (const [id, value] of bounds) {
		bounds.set(id, translateBounds(value, shiftX, shiftY));
	}

	return createLayoutResult(graph, bounds, measurements);
}
