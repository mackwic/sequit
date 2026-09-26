import { defined, EndpointKind, LayoutDirection } from '../../document/logic-document';
import { sharedAtEndpoint } from '../bridge-contact-shared';
import {
	JUNCTION_PORT_INSET,
	JUNCTION_PORT_SPACING,
	PORT_INSET,
	PORT_SPACING,
} from '../layout-settings';
import type { LayoutRelation, LayoutResult, Point } from '../layout-types';
import type { DedicatedCandidateValidationInput, RejectedDedicatedCandidate } from './types';
import { DedicatedCandidateRejectionCode, rejected } from './types';

interface PortUse {
	readonly endpointId: string;
	readonly from: boolean;
	readonly route: LayoutRelation;
	readonly point: Point;
}

interface PortRules {
	readonly vertical: boolean;
	readonly inset: number;
	readonly spacing: number;
}

function portKey(endpointId: string, from: boolean): string {
	return JSON.stringify([endpointId, from]);
}

function collectPortUses(routes: readonly LayoutRelation[]): Map<string, PortUse[]> {
	const uses = new Map<string, PortUse[]>();
	for (const route of routes) {
		const endpoints = [
			{ endpointId: route.from, from: true, point: defined(route.points[0]) },
			{ endpointId: route.to, from: false, point: defined(route.points.at(-1)) },
		] as const;
		for (const use of endpoints) {
			const key = portKey(use.endpointId, use.from);
			const endpointUses = uses.get(key) ?? [];
			endpointUses.push({ ...use, route });
			uses.set(key, endpointUses);
		}
	}
	return uses;
}

function rulesFor(input: DedicatedCandidateValidationInput, use: PortUse): PortRules {
	const direction = input.graph.document.layout.direction;
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	const endpoint = defined(input.graph.endpointsById.get(use.endpointId));
	if (endpoint.kind === EndpointKind.Junction)
		return { vertical, inset: JUNCTION_PORT_INSET, spacing: JUNCTION_PORT_SPACING };
	return { vertical, inset: PORT_INSET, spacing: PORT_SPACING };
}

function coordinate(point: Point, vertical: boolean): number {
	if (vertical) return point.x;
	return point.y;
}

function portStart(box: LayoutResult['elements'][number]['bounds'], vertical: boolean): number {
	if (vertical) return box.x;
	return box.y;
}

function portSize(box: LayoutResult['elements'][number]['bounds'], vertical: boolean): number {
	if (vertical) return box.width;
	return box.height;
}

function validatePortInsets(
	uses: readonly PortUse[],
	box: LayoutResult['elements'][number]['bounds'],
	rules: PortRules,
): RejectedDedicatedCandidate | undefined {
	const start = portStart(box, rules.vertical);
	const size = portSize(box, rules.vertical);
	for (const use of uses) {
		const offset = coordinate(use.point, rules.vertical) - start;
		const tooCloseToStart = offset < rules.inset;
		const tooCloseToEnd = size - offset < rules.inset;
		if (tooCloseToStart || tooCloseToEnd)
			return rejected(DedicatedCandidateRejectionCode.Ports, use.endpointId, use.route.id);
	}
	return undefined;
}

function sharedPortUse(previous: PortUse, current: PortUse): boolean {
	return sharedAtEndpoint(previous.route, current.route, current.point, current.from);
}

function validatePortSpacing(
	uses: readonly PortUse[],
	rules: PortRules,
): RejectedDedicatedCandidate | undefined {
	const ordered = [...uses].sort(
		(left, right) =>
			coordinate(left.point, rules.vertical) - coordinate(right.point, rules.vertical),
	);
	for (let index = 1; index < ordered.length; index += 1) {
		const previous = defined(ordered[index - 1]);
		const current = defined(ordered[index]);
		const currentCoordinate = coordinate(current.point, rules.vertical);
		const previousCoordinate = coordinate(previous.point, rules.vertical);
		const separation = currentCoordinate - previousCoordinate;
		const enoughSpace = separation >= rules.spacing;
		if (enoughSpace) continue;
		const samePosition = separation === 0;
		if (samePosition && sharedPortUse(previous, current)) continue;
		return rejected(DedicatedCandidateRejectionCode.Ports, current.endpointId, current.route.id);
	}
	return undefined;
}

function validateEndpointPorts(
	input: DedicatedCandidateValidationInput,
	elements: ReadonlyMap<string, LayoutResult['elements'][number]>,
	uses: readonly PortUse[],
): RejectedDedicatedCandidate | undefined {
	const first = defined(uses[0]);
	const box = defined(elements.get(first.endpointId)).bounds;
	const rules = rulesFor(input, first);
	const insetFailure = validatePortInsets(uses, box, rules);
	if (insetFailure !== undefined) return insetFailure;
	return validatePortSpacing(uses, rules);
}

export function validatePorts(
	input: DedicatedCandidateValidationInput,
	elements: ReadonlyMap<string, LayoutResult['elements'][number]>,
	routes: readonly LayoutRelation[],
): RejectedDedicatedCandidate | undefined {
	const usesByEndpoint = collectPortUses(routes);
	for (const uses of usesByEndpoint.values()) {
		const failure = validateEndpointPorts(input, elements, uses);
		if (failure !== undefined) return failure;
	}
	return undefined;
}
