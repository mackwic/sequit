import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { Bounds, GroupMeasurement, LayoutResult } from '../layout-types';
import { prepareGroupHierarchy } from '../structure/group-hierarchy';
import type { DedicatedCandidateValidationInput, RejectedDedicatedCandidate } from './types';
import { DedicatedCandidateRejectionCode, rejected } from './types';

export interface EndpointMinimumSize {
	readonly width: number;
	readonly height: number;
}

export function elementsById(
	input: DedicatedCandidateValidationInput,
): ReadonlyMap<string, LayoutResult['elements'][number]> | RejectedDedicatedCandidate {
	const expected = input.graph.endpointsById;
	if (input.layout.elements.length !== expected.size)
		return rejected(DedicatedCandidateRejectionCode.ElementInventory);
	const elements = new Map<string, LayoutResult['elements'][number]>();
	for (const element of input.layout.elements) {
		const endpoint = expected.get(element.id);
		if (endpoint === undefined)
			return rejected(DedicatedCandidateRejectionCode.ElementInventory, element.id);
		if (endpoint.kind !== element.kind || elements.has(element.id))
			return rejected(DedicatedCandidateRejectionCode.ElementInventory, element.id);
		elements.set(element.id, element);
	}
	return elements;
}

export function validateRelationInventory(
	input: DedicatedCandidateValidationInput,
): RejectedDedicatedCandidate | undefined {
	if (input.layout.relations.length !== input.graph.relations.length)
		return rejected(DedicatedCandidateRejectionCode.RelationInventory);
	const expected = new Map(input.graph.relations.map(({ relation }) => [relation.id, relation]));
	const actual = new Set<string>();
	for (const route of input.layout.relations) {
		const relation = expected.get(route.id);
		if (relation === undefined || actual.has(route.id))
			return rejected(DedicatedCandidateRejectionCode.RelationInventory, undefined, route.id);
		if (relation.from !== route.from || relation.to !== route.to)
			return rejected(DedicatedCandidateRejectionCode.RelationInventory, undefined, route.id);
		actual.add(route.id);
	}
	return undefined;
}

function validGroupMeasurement(measurement: GroupMeasurement): boolean {
	const values = [
		measurement.minimumWidth,
		measurement.minimumHeight,
		measurement.headerHeight,
		measurement.padding,
	];
	if (!values.every(Number.isFinite)) return false;
	const minimumsArePositive = measurement.minimumWidth > 0 && measurement.minimumHeight > 0;
	const insetsAreNonnegative = measurement.headerHeight >= 0 && measurement.padding >= 0;
	return minimumsArePositive && insetsAreNonnegative;
}

export function minimumElementSize(
	input: DedicatedCandidateValidationInput,
	endpointId: string,
	kind: EndpointKind,
): EndpointMinimumSize | undefined {
	if (kind === EndpointKind.Node) return input.measurements.nodes.get(endpointId);
	if (kind === EndpointKind.Junction) return input.measurements.junctions.get(endpointId);
	const measurement = input.measurements.groups.get(endpointId);
	if (measurement === undefined || !validGroupMeasurement(measurement)) return undefined;
	return {
		width: measurement.minimumWidth,
		height: Math.max(measurement.minimumHeight, measurement.headerHeight + 2 * measurement.padding),
	};
}

export function sameOwnerGroup(graph: LogicGraph, groupId: string, endpointId: string): boolean {
	let ownerId = graph.endpointsById.get(endpointId)?.entity.groupId;
	for (let depth = 0; ownerId !== undefined && depth < graph.endpointsById.size; depth += 1) {
		if (ownerId === groupId) return true;
		const parent = defined(graph.endpointsById.get(ownerId));
		ownerId = parent.entity.groupId;
	}
	return false;
}

function horizontalContentContains(
	groupBounds: Bounds,
	memberBounds: Bounds,
	padding: number,
): boolean {
	const memberLeft = memberBounds.x;
	const allowedLeft = groupBounds.x + padding;
	const memberRight = memberBounds.x + memberBounds.width;
	const allowedRight = groupBounds.x + groupBounds.width - padding;
	return memberLeft >= allowedLeft && memberRight <= allowedRight;
}

function verticalContentContains(
	groupBounds: Bounds,
	memberBounds: Bounds,
	measurement: GroupMeasurement,
): boolean {
	const memberTop = memberBounds.y;
	const allowedTop = groupBounds.y + measurement.headerHeight + measurement.padding;
	const memberBottom = memberBounds.y + memberBounds.height;
	const allowedBottom = groupBounds.y + groupBounds.height - measurement.padding;
	return memberTop >= allowedTop && memberBottom <= allowedBottom;
}

function insideGroupContent(
	groupBounds: Bounds,
	memberBounds: Bounds,
	measurement: GroupMeasurement,
): boolean {
	const insideHorizontally = horizontalContentContains(
		groupBounds,
		memberBounds,
		measurement.padding,
	);
	const insideVertically = verticalContentContains(groupBounds, memberBounds, measurement);
	return insideHorizontally && insideVertically;
}

export function validateGroupContainment(
	input: DedicatedCandidateValidationInput,
	elements: ReadonlyMap<string, LayoutResult['elements'][number]>,
): RejectedDedicatedCandidate | undefined {
	const hierarchy = prepareGroupHierarchy(input.graph.document);
	if (hierarchy === undefined) return undefined;
	for (const group of hierarchy.byId.values()) {
		const groupBox = defined(elements.get(group.id)).bounds;
		const measurement = defined(input.measurements.groups.get(group.id));
		for (const memberId of hierarchy.membersById.get(group.id) ?? []) {
			const member = elements.get(memberId);
			if (member === undefined || !insideGroupContent(groupBox, member.bounds, measurement))
				return rejected(DedicatedCandidateRejectionCode.GroupContainment, memberId);
		}
	}
	return undefined;
}
