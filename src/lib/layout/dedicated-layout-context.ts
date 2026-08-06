import { EndpointKind, type LogicGroup } from '../document/logic-document';
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

interface GroupReservation {
	readonly widthIncrease: number;
	readonly heightIncrease: number;
	readonly minimumWidth: number;
	readonly minimumHeight: number;
	readonly offsetX: number;
	readonly offsetY: number;
}
interface GroupReservationPath {
	readonly groups: readonly LogicGroup[];
	readonly parent: GroupReservation;
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

const EMPTY_GROUP_RESERVATION: GroupReservation = {
	widthIncrease: 0,
	heightIncrease: 0,
	minimumWidth: 0,
	minimumHeight: 0,
	offsetX: 0,
	offsetY: 0,
};

function combineGroupReservation(
	group: LogicGroup,
	parent: GroupReservation,
	measurements: LayoutMeasurements,
): GroupReservation {
	const measurement = measurements.groups.get(group.id);
	if (!measurement) throw new Error(`Missing group measurement: ${group.id}`);
	const validated = validateGroupMeasurement(measurement, group.id);
	return {
		widthIncrease: validated.padding * 2 + parent.widthIncrease,
		heightIncrease: validated.headerHeight + validated.padding * 2 + parent.heightIncrease,
		minimumWidth: Math.max(parent.minimumWidth, validated.minimumWidth + parent.widthIncrease),
		minimumHeight: Math.max(parent.minimumHeight, validated.minimumHeight + parent.heightIncrease),
		offsetX: validated.padding + parent.offsetX,
		offsetY: validated.headerHeight + validated.padding + parent.offsetY,
	};
}

function groupReservationPath(
	start: LogicGroup,
	groupsById: ReadonlyMap<string, LogicGroup>,
	cached: ReadonlyMap<string, GroupReservation>,
): GroupReservationPath {
	const groups: LogicGroup[] = [];
	const groupIds = new Set<string>();
	let current: LogicGroup | undefined = start;
	while (current !== undefined && !cached.has(current.id)) {
		if (groupIds.has(current.id)) throw new Error(`Group containment cycle at: ${current.id}`);
		groupIds.add(current.id);
		groups.push(current);
		const parentId = current.groupId;
		if (parentId === undefined) {
			current = undefined;
			continue;
		}
		const parent = groupsById.get(parentId);
		if (!parent) throw new Error(`Missing group: ${parentId}`);
		current = parent;
	}
	if (current === undefined) return { groups, parent: EMPTY_GROUP_RESERVATION };
	const parent = cached.get(current.id);
	if (!parent) throw new Error(`Missing group reservation: ${current.id}`);
	return { groups, parent };
}

function cacheGroupReservationPath(
	path: GroupReservationPath,
	measurements: LayoutMeasurements,
	result: Map<string, GroupReservation>,
): void {
	let parent = path.parent;
	for (let index = path.groups.length - 1; index >= 0; index -= 1) {
		const group = path.groups[index];
		if (!group) throw new Error(`Missing group reservation path at: ${index}`);
		parent = combineGroupReservation(group, parent, measurements);
		result.set(group.id, parent);
	}
}

function groupReservations(
	groupsById: ReadonlyMap<string, LogicGroup>,
	measurements: LayoutMeasurements,
): ReadonlyMap<string, GroupReservation> {
	const result = new Map<string, GroupReservation>();
	for (const group of groupsById.values()) {
		if (result.has(group.id)) continue;
		const path = groupReservationPath(group, groupsById, result);
		cacheGroupReservationPath(path, measurements, result);
	}
	return result;
}

function endpointReservation(
	graph: LogicGraph,
	reservationsByGroupId: ReadonlyMap<string, GroupReservation>,
	endpointId: string,
	size: Size,
): EndpointReservation {
	const endpoint = graph.endpointsById.get(endpointId);
	if (!endpoint) throw new Error(`Missing graph endpoint: ${endpointId}`);
	const groupId = endpoint.entity.groupId;
	if (groupId === undefined) return { size, offsetX: 0, offsetY: 0 };
	const reservation = reservationsByGroupId.get(groupId);
	if (!reservation) throw new Error(`Missing group reservation: ${groupId}`);
	return {
		size: {
			width: Math.max(reservation.minimumWidth, size.width + reservation.widthIncrease),
			height: Math.max(reservation.minimumHeight, size.height + reservation.heightIncrease),
		},
		offsetX: reservation.offsetX,
		offsetY: reservation.offsetY,
	};
}

function rankCount(ranks: TopologicalRanks): number {
	let count = ranks.bands.length;
	for (const rank of ranks.byEndpointId.values()) count = Math.max(count, rank + 1);
	return count;
}

function maximumGroupCrossOverhead(
	reservationsByGroupId: ReadonlyMap<string, GroupReservation>,
	vertical: boolean,
): number {
	let maximum = 0;
	for (const reservation of reservationsByGroupId.values()) {
		let overhead = reservation.heightIncrease;
		if (vertical) overhead = reservation.widthIncrease;
		maximum = Math.max(maximum, overhead);
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
	if (context.graph.endpointsById.get(endpointId)?.kind !== EndpointKind.Junction) {
		return reservation;
	}
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
	const groupReservationsById = groupReservations(groupsById, measurements);
	const vertical = isVerticalDirection(graph.document.layout.direction);
	const sizes = new Map<string, Size>();
	const marginsByRank = Array.from({ length: rankCount(ranks) }, (): ReservationMargins => ({
		left: 0,
		right: 0,
		top: 0,
		bottom: 0,
	}));
	for (const id of graph.rankableEndpointIds) {
		const size = endpointSize(graph, measurements, id);
		const reservation = endpointReservation(graph, groupReservationsById, id, size);
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
	const componentGap = COMPONENT_GAP + maximumGroupCrossOverhead(groupReservationsById, vertical);
	return { groupsById, sizes, layoutSizes, reservations, vertical, componentGap };
}
