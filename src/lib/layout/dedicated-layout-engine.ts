import { LayoutBias, LayoutDirection } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { type ComponentLayout, layoutComponent } from './component-layout';
import {
	type DedicatedLayoutContext,
	layoutContext,
	validateGroupMeasurement,
} from './dedicated-layout-context';
import {
	componentContext,
	endpointLayoutContext,
	groupMemberIds,
	groupsByDescendingDepth as orderGroupsByDescendingDepth,
} from './group-layout-context';
import { centerDirectJunctions } from './junction-layout';
import type {
	Bounds,
	LayoutElement,
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
	Point,
} from './layout-types';

const OUTER_MARGIN = 40;

interface RankedComponent {
	readonly ids: readonly string[];
	readonly context: string;
	readonly layout: ComponentLayout;
}

function enqueueUnvisited(ids: readonly string[], visited: Set<string>, pending: string[]): void {
	for (const id of ids) {
		if (visited.has(id)) continue;
		visited.add(id);
		pending.push(id);
	}
}

function existingMemberBounds(
	memberIds: readonly string[] | undefined,
	bounds: ReadonlyMap<string, Bounds>,
): Bounds[] {
	const result: Bounds[] = [];
	for (const memberId of memberIds ?? []) {
		const value = bounds.get(memberId);
		if (value) result.push(value);
	}
	return result;
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
			enqueueUnvisited(graph.outgoingByEndpointId.get(id) ?? [], visited, pending);
			enqueueUnvisited(graph.predecessorsByEndpointId.get(id) ?? [], visited, pending);
		}
		component.sort((left, right) => left.localeCompare(right));
		result.push(component);
	}
	return result;
}

function translateBounds(bounds: Bounds, x: number, y: number): Bounds {
	return { ...bounds, x: bounds.x + x, y: bounds.y + y };
}

function routePoints(source: Bounds, target: Bounds, direction: LayoutDirection): readonly Point[] {
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop) {
		let sourceY = source.y;
		let targetY = target.y + target.height;
		if (direction === LayoutDirection.TopToBottom) {
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
	if (direction === LayoutDirection.LeftToRight) {
		sourceX = source.x + source.width;
		targetX = target.x;
	}
	const start = { x: sourceX, y: source.y + source.height / 2 };
	const end = { x: targetX, y: target.y + target.height / 2 };
	const middle = (start.x + end.x) / 2;
	return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
}

interface PositionedEndpoints {
	readonly bounds: Map<string, Bounds>;
	readonly maximumPrimaryLength: number;
	readonly nextCross: number;
}

function positionEndpoints(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	context: DedicatedLayoutContext,
): PositionedEndpoints {
	const { groupsById, sizes, layoutSizes, reservations, vertical, componentGap } = context;
	const junctionIds = new Set(graph.document.junctions.map(({ id }) => id));
	const layoutContextByEndpointId = new Map(
		graph.rankableEndpointIds.map((id) => [id, endpointLayoutContext(graph, id, groupsById)]),
	);
	const primaryBandSizes = ranks.bands.map((ids) => {
		let maximum = 1;
		for (const id of ids) {
			if (junctionIds.has(id)) continue;
			const size = layoutSizes.get(id);
			if (!size) throw new Error(`Missing measured size: ${id}`);
			maximum = Math.max(maximum, vertical ? size.height : size.width);
		}
		return maximum;
	});
	const components: RankedComponent[] = weaklyConnectedComponents(graph).map((ids) => {
		const orderedIds = [...ids].sort((left, right) => {
			const leftContext = layoutContextByEndpointId.get(left);
			const rightContext = layoutContextByEndpointId.get(right);
			if (leftContext === undefined || rightContext === undefined) {
				throw new Error(
					`Missing endpoint layout context: ${leftContext === undefined ? left : right}`,
				);
			}
			return leftContext.localeCompare(rightContext) || left.localeCompare(right);
		});
		return {
			ids: orderedIds,
			context: componentContext(graph, orderedIds, groupsById),
			layout: layoutComponent(
				orderedIds,
				ranks.byEndpointId,
				layoutSizes,
				graph.document.layout.direction,
				graph.document.layout.bias,
				primaryBandSizes,
				junctionIds,
			),
		};
	});
	components.sort(
		(left, right) =>
			left.context.localeCompare(right.context) ||
			(left.ids[0] ?? '').localeCompare(right.ids[0] ?? ''),
	);
	let maximumPrimaryLength = 0;
	const firstComponent = components[0];
	if (firstComponent !== undefined) {
		maximumPrimaryLength = firstComponent.layout.width;
		if (vertical) maximumPrimaryLength = firstComponent.layout.height;
	}
	const bounds = new Map<string, Bounds>();
	let cross = OUTER_MARGIN;
	for (const component of components) {
		let offsetX = OUTER_MARGIN;
		let offsetY = cross;
		if (vertical) {
			offsetX = cross;
			offsetY = OUTER_MARGIN;
		}
		for (const [id, value] of component.layout.boundsById) {
			const size = sizes.get(id);
			const reservation = reservations.get(id);
			if (!size || !reservation) throw new Error(`Missing endpoint reservation: ${id}`);
			bounds.set(id, {
				x: value.x + offsetX + reservation.offsetX,
				y: value.y + offsetY + reservation.offsetY,
				...size,
			});
		}
		let componentCrossLength = component.layout.height;
		if (vertical) componentCrossLength = component.layout.width;
		cross += componentCrossLength + componentGap;
	}
	centerDirectJunctions(graph, bounds, graph.document.layout.direction);
	return { bounds, maximumPrimaryLength, nextCross: cross };
}

export function layoutWithDedicatedEngine(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
): LayoutResult {
	const context = layoutContext(graph, ranks, measurements);
	const { groupsById, vertical, componentGap } = context;
	const { bounds, maximumPrimaryLength, nextCross } = positionEndpoints(graph, ranks, context);
	let cross = nextCross;

	const groupsByDescendingDepth = orderGroupsByDescendingDepth(graph.document.groups, groupsById);
	const memberIdsByGroupId = groupMemberIds(graph);
	for (const group of groupsByDescendingDepth) {
		const measurement = measurements.groups.get(group.id);
		if (!measurement) throw new Error(`Missing group measurement: ${group.id}`);
		const validated = validateGroupMeasurement(measurement, group.id);
		const memberIds = memberIdsByGroupId.get(group.id);
		const memberBounds = existingMemberBounds(memberIds, bounds);

		if (memberBounds.length === 0) {
			if (bounds.has(group.id)) continue;
			let primaryLength = validated.minimumWidth;
			if (vertical) primaryLength = validated.minimumHeight;
			const alignAtStart =
				graph.document.layout.bias === LayoutBias.Top ||
				graph.document.layout.bias === LayoutBias.Left;
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
			cross += groupCrossLength + componentGap;
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
