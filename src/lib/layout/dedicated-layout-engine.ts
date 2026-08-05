import type { LayoutDirection, LogicGroup } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { type ComponentLayout, isVerticalDirection, layoutComponent } from './component-layout';
import type {
	Bounds,
	GroupMeasurement,
	LayoutElement,
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
	Point,
	Size,
} from './layout-types';

const OUTER_MARGIN = 40;
const COMPONENT_GAP = 96;

interface RankedComponent {
	readonly ids: readonly string[];
	readonly context: string;
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
	return measurement;
}

function endpointSize(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	endpointId: string,
): Size {
	const endpoint = graph.endpointsById.get(endpointId);
	if (!endpoint) throw new Error(`Missing graph endpoint: ${endpointId}`);
	if (endpoint.kind === 'node') {
		const size = measurements.nodes.get(endpointId);
		if (!size) throw new Error(`Missing node measurement: ${endpointId}`);
		return validateSize(size, `nodes.${endpointId}`);
	}
	if (endpoint.kind === 'junction') {
		const size = measurements.junctions.get(endpointId);
		if (!size) throw new Error(`Missing junction measurement: ${endpointId}`);
		return validateSize(size, `junctions.${endpointId}`);
	}
	const measurement = measurements.groups.get(endpointId);
	if (!measurement) throw new Error(`Missing group measurement: ${endpointId}`);
	const validated = validateGroupMeasurement(measurement, endpointId);
	return { width: validated.minimumWidth, height: validated.minimumHeight };
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
			const id = pending.pop();
			if (id === undefined) break;
			component.push(id);
			const adjacent = [
				...(graph.outgoingByEndpointId.get(id) ?? []),
				...(graph.predecessorsByEndpointId.get(id) ?? []),
			].sort((left, right) => right.localeCompare(left));
			for (const next of adjacent) {
				if (visited.has(next)) continue;
				visited.add(next);
				pending.push(next);
			}
		}
		component.sort((left, right) => left.localeCompare(right));
		result.push(component);
	}
	return result;
}

function endpointGroupId(graph: LogicGraph, endpointId: string): string | undefined {
	return graph.endpointsById.get(endpointId)?.entity.groupId;
}

function topLevelGroupId(groupId: string, groupsById: ReadonlyMap<string, LogicGroup>): string {
	let current = groupId;
	const visited = new Set<string>();
	for (;;) {
		if (visited.has(current)) throw new Error(`Group containment cycle at: ${current}`);
		visited.add(current);
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
		const groupId = endpointGroupId(graph, id);
		if (groupId === undefined) contexts.add('~root');
		else contexts.add(topLevelGroupId(groupId, groupsById));
	}
	return [...contexts].sort((left, right) => left.localeCompare(right)).join('|');
}

function translateBounds(bounds: Bounds, x: number, y: number): Bounds {
	return { ...bounds, x: bounds.x + x, y: bounds.y + y };
}

function groupDepth(group: LogicGroup, groupsById: ReadonlyMap<string, LogicGroup>): number {
	let depth = 0;
	let parentId = group.groupId;
	const visited = new Set([group.id]);
	while (parentId !== undefined) {
		if (visited.has(parentId)) throw new Error(`Group containment cycle at: ${parentId}`);
		visited.add(parentId);
		depth += 1;
		parentId = groupsById.get(parentId)?.groupId;
	}
	return depth;
}

function routePoints(source: Bounds, target: Bounds, direction: LayoutDirection): readonly Point[] {
	if (direction === 'top-to-bottom' || direction === 'bottom-to-top') {
		let sourceY = source.y;
		let targetY = target.y + target.height;
		if (direction === 'top-to-bottom') {
			sourceY = source.y + source.height;
			targetY = target.y;
		}
		const start = { x: source.x + source.width / 2, y: sourceY };
		const end = { x: target.x + target.width / 2, y: targetY };
		const middle = (start.y + end.y) / 2;
		return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
	}
	let sourceX = source.x;
	let targetX = target.x + target.width;
	if (direction === 'left-to-right') {
		sourceX = source.x + source.width;
		targetX = target.x;
	}
	const start = { x: sourceX, y: source.y + source.height / 2 };
	const end = { x: targetX, y: target.y + target.height / 2 };
	const middle = (start.x + end.x) / 2;
	return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
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
	const junctionIds = new Set(graph.document.junctions.map(({ id }) => id));
	const primaryBandSizes = ranks.bands.map((ids) => {
		let maximum = 1;
		for (const id of ids) {
			if (junctionIds.has(id)) continue;
			const size = sizes.get(id);
			if (!size) throw new Error(`Missing measured size: ${id}`);
			maximum = Math.max(maximum, vertical ? size.height : size.width);
		}
		return maximum;
	});
	const components: RankedComponent[] = weaklyConnectedComponents(graph).map((ids) => ({
		ids,
		context: componentContext(graph, ids, groupsById),
		layout: layoutComponent(
			ids,
			ranks.byEndpointId,
			sizes,
			graph.document.layout.direction,
			graph.document.layout.bias,
			primaryBandSizes,
			junctionIds,
		),
	}));
	components.sort(
		(left, right) =>
			left.context.localeCompare(right.context) ||
			(left.ids[0] ?? '').localeCompare(right.ids[0] ?? ''),
	);
	let maximumPrimaryLength = 0;
	for (const component of components) {
		let componentPrimaryLength = component.layout.width;
		if (vertical) componentPrimaryLength = component.layout.height;
		maximumPrimaryLength = Math.max(maximumPrimaryLength, componentPrimaryLength);
	}

	const bounds = new Map<string, Bounds>();
	let cross = OUTER_MARGIN;
	for (const component of components) {
		let primaryLength = component.layout.width;
		if (vertical) primaryLength = component.layout.height;
		const alignAtStart =
			graph.document.layout.bias === 'top' || graph.document.layout.bias === 'left';
		let primary = OUTER_MARGIN + maximumPrimaryLength - primaryLength;
		if (alignAtStart) primary = OUTER_MARGIN;
		let offsetX = primary;
		let offsetY = cross;
		if (vertical) {
			offsetX = cross;
			offsetY = primary;
		}
		for (const [id, value] of component.layout.boundsById) {
			bounds.set(id, translateBounds(value, offsetX, offsetY));
		}
		let componentCrossLength = component.layout.height;
		if (vertical) componentCrossLength = component.layout.width;
		cross += componentCrossLength + COMPONENT_GAP;
	}

	const groupsByDescendingDepth = [...graph.document.groups].sort(
		(left, right) =>
			groupDepth(right, groupsById) - groupDepth(left, groupsById) ||
			left.id.localeCompare(right.id),
	);
	for (const group of groupsByDescendingDepth) {
		const measurement = measurements.groups.get(group.id);
		if (!measurement) throw new Error(`Missing group measurement: ${group.id}`);
		const validated = validateGroupMeasurement(measurement, group.id);
		const memberBounds: Bounds[] = [];
		for (const node of graph.document.nodes) {
			if (node.groupId === group.id) {
				const value = bounds.get(node.id);
				if (value) memberBounds.push(value);
			}
		}
		for (const junction of graph.document.junctions) {
			if (junction.groupId === group.id) {
				const value = bounds.get(junction.id);
				if (value) memberBounds.push(value);
			}
		}
		for (const child of graph.document.groups) {
			if (child.groupId === group.id) {
				const value = bounds.get(child.id);
				if (value) memberBounds.push(value);
			}
		}

		if (memberBounds.length === 0) {
			if (bounds.has(group.id)) continue;
			let primaryLength = validated.minimumWidth;
			if (vertical) primaryLength = validated.minimumHeight;
			const alignAtStart =
				graph.document.layout.bias === 'top' || graph.document.layout.bias === 'left';
			let primary = OUTER_MARGIN + maximumPrimaryLength - primaryLength;
			if (alignAtStart) primary = OUTER_MARGIN;
			let x = primary;
			let y = cross;
			let groupCrossLength = validated.minimumHeight;
			if (vertical) {
				x = cross;
				y = primary;
				groupCrossLength = validated.minimumWidth;
			}
			bounds.set(group.id, {
				x,
				y,
				width: validated.minimumWidth,
				height: validated.minimumHeight,
			});
			cross += groupCrossLength + COMPONENT_GAP;
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

	const relations: LayoutRelation[] = graph.relations.map(({ relation }) => {
		const source = bounds.get(relation.from);
		const target = bounds.get(relation.to);
		if (!source || !target) throw new Error(`Missing relation bounds: ${relation.id}`);
		return {
			id: relation.id,
			from: relation.from,
			to: relation.to,
			points: routePoints(source, target, graph.document.layout.direction),
		};
	});

	const elements: LayoutElement[] = [];
	let width = OUTER_MARGIN * 2;
	let height = OUTER_MARGIN * 2;
	for (const [id, value] of bounds) {
		const endpoint = graph.endpointsById.get(id);
		if (!endpoint) throw new Error(`Missing graph endpoint: ${id}`);
		elements.push({ id, kind: endpoint.kind, bounds: value });
		width = Math.max(width, value.x + value.width + OUTER_MARGIN);
		height = Math.max(height, value.y + value.height + OUTER_MARGIN);
	}
	elements.sort((left, right) => left.id.localeCompare(right.id));
	relations.sort((left, right) => left.id.localeCompare(right.id));
	return { width, height, elements, relations };
}
