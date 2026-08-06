import type { LogicGroup } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { isVerticalDirection } from './component-layout';
import type { GroupMeasurement, LayoutMeasurements, Size } from './layout-types';

const COMPONENT_GAP = 96;

export interface EndpointReservation {
	readonly size: Size;
	readonly offsetX: number;
	readonly offsetY: number;
}

interface ReservationMargins {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

interface ReservationContext {
	readonly graph: LogicGraph;
	readonly groupsById: ReadonlyMap<string, LogicGroup>;
	readonly measurements: LayoutMeasurements;
}

interface NormalizationContext {
	readonly graph: LogicGraph;
	readonly vertical: boolean;
}

export interface DedicatedLayoutContext {
	readonly groupsById: ReadonlyMap<string, LogicGroup>;
	readonly sizes: ReadonlyMap<string, Size>;
	readonly layoutSizes: ReadonlyMap<string, Size>;
	readonly reservations: ReadonlyMap<string, EndpointReservation>;
	readonly vertical: boolean;
	readonly componentGap: number;
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

export function validateGroupMeasurement(
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

function endpointReservation(
	context: ReservationContext,
	endpointId: string,
	size: Size,
): EndpointReservation {
	const endpoint = context.graph.endpointsById.get(endpointId);
	if (!endpoint) throw new Error(`Missing graph endpoint: ${endpointId}`);
	let groupId = endpoint.entity.groupId;
	let width = size.width;
	let height = size.height;
	let offsetX = 0;
	let offsetY = 0;
	const visited = new Set<string>();
	while (groupId !== undefined) {
		if (visited.has(groupId)) throw new Error(`Group containment cycle at: ${groupId}`);
		visited.add(groupId);
		const group = context.groupsById.get(groupId);
		if (!group) throw new Error(`Missing group: ${groupId}`);
		const measurement = context.measurements.groups.get(groupId);
		if (!measurement) throw new Error(`Missing group measurement: ${groupId}`);
		const validated = validateGroupMeasurement(measurement, groupId);
		offsetX += validated.padding;
		offsetY += validated.headerHeight + validated.padding;
		width = Math.max(validated.minimumWidth, width + validated.padding * 2);
		height = Math.max(
			validated.minimumHeight,
			height + validated.headerHeight + validated.padding * 2,
		);
		groupId = group.groupId;
	}
	return { size: { width, height }, offsetX, offsetY };
}

function rankCount(ranks: TopologicalRanks): number {
	let count = ranks.bands.length;
	for (const rank of ranks.byEndpointId.values()) count = Math.max(count, rank + 1);
	return count;
}

function maximumGroupCrossOverhead(
	groups: readonly LogicGroup[],
	measurements: LayoutMeasurements,
	vertical: boolean,
): number {
	const groupsById = new Map(groups.map((group) => [group.id, group]));
	let maximum = 0;
	for (const group of groups) {
		let overhead = 0;
		let current: LogicGroup | undefined = group;
		const visited = new Set<string>();
		while (current !== undefined) {
			if (visited.has(current.id)) throw new Error(`Group containment cycle at: ${current.id}`);
			visited.add(current.id);
			const measurement = measurements.groups.get(current.id);
			if (!measurement) throw new Error(`Missing group measurement: ${current.id}`);
			const validated = validateGroupMeasurement(measurement, current.id);
			if (vertical) {
				overhead += validated.padding * 2;
			} else {
				overhead += validated.headerHeight + validated.padding * 2;
			}
			maximum = Math.max(maximum, overhead);
			current = groupsById.get(current.groupId ?? '');
		}
	}
	return maximum;
}
function normalizeReservation(
	context: NormalizationContext,
	size: Size,
	margins: ReservationMargins,
	endpointId: string,
): EndpointReservation {
	const reservation = {
		size: {
			width: margins.left + size.width + margins.right,
			height: margins.top + size.height + margins.bottom,
		},
		offsetX: margins.left,
		offsetY: margins.top,
	};
	if (context.graph.endpointsById.get(endpointId)?.kind !== 'junction') return reservation;
	if (context.vertical) {
		const margin = Math.max(margins.top, margins.bottom);
		reservation.size.height = size.height + margin * 2;
		reservation.offsetY = margin;
	} else {
		const margin = Math.max(margins.left, margins.right);
		reservation.size.width = size.width + margin * 2;
		reservation.offsetX = margin;
	}
	return reservation;
}

export function layoutContext(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
): DedicatedLayoutContext {
	const groupsById = new Map(graph.document.groups.map((group) => [group.id, group]));
	const vertical = isVerticalDirection(graph.document.layout.direction);
	const sizes = new Map<string, Size>();
	const marginsByRank = Array.from({ length: rankCount(ranks) }, (): ReservationMargins => ({
		left: 0,
		right: 0,
		top: 0,
		bottom: 0,
	}));
	const context = { graph, groupsById, measurements };
	for (const id of graph.rankableEndpointIds) {
		const size = endpointSize(graph, measurements, id);
		const reservation = endpointReservation(context, id, size);
		const rank = ranks.byEndpointId.get(id) ?? 0;
		const margins = marginsByRank[rank];
		if (!margins) throw new Error(`Missing reservation margins for rank: ${rank}`);
		margins.left = Math.max(margins.left, reservation.offsetX);
		margins.right = Math.max(
			margins.right,
			reservation.size.width - reservation.offsetX - size.width,
		);
		margins.top = Math.max(margins.top, reservation.offsetY);
		margins.bottom = Math.max(
			margins.bottom,
			reservation.size.height - reservation.offsetY - size.height,
		);
		sizes.set(id, size);
	}
	const layoutSizes = new Map<string, Size>();
	const reservations = new Map<string, EndpointReservation>();
	for (const id of graph.rankableEndpointIds) {
		const rank = ranks.byEndpointId.get(id) ?? 0;
		const margins = marginsByRank[rank];
		const size = sizes.get(id);
		if (!margins || !size) throw new Error(`Missing normalized reservation: ${id}`);
		const reservation = normalizeReservation({ graph, vertical }, size, margins, id);
		layoutSizes.set(id, reservation.size);
		reservations.set(id, reservation);
	}
	const componentGap =
		COMPONENT_GAP + maximumGroupCrossOverhead(graph.document.groups, measurements, vertical);
	return { groupsById, sizes, layoutSizes, reservations, vertical, componentGap };
}
