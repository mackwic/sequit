import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import type { RouteBridgeAnalysis } from '../bridge-oracle';
import type { LayoutMeasurements, LayoutResult, Point } from '../layout-types';

export enum DedicatedCandidateRejectionCode {
	ElementInventory = 'element-inventory',
	RelationInventory = 'relation-inventory',
	InvalidCanvas = 'invalid-canvas',
	InvalidBounds = 'invalid-bounds',
	MinimumSize = 'minimum-size',
	RankOrder = 'rank-order',
	GroupContainment = 'group-containment',
	ElementOverlap = 'element-overlap',
	Route = 'route',
	Attachment = 'attachment',
	Obstacle = 'obstacle',
	SelfContact = 'self-contact',
	RouteContact = 'route-contact',
	Ports = 'ports',
}

export interface DedicatedCandidateValidationInput {
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly measurements: LayoutMeasurements;
	readonly layout: LayoutResult;
}

export interface DedicatedRouteScore {
	readonly strictCrossings: number;
	readonly validatedBridges: number;
	readonly length: number;
	readonly bends: number;
}

interface ValidDedicatedCandidate {
	readonly valid: true;
	readonly score: DedicatedRouteScore;
	readonly analysis: RouteBridgeAnalysis;
}

export interface RejectedDedicatedCandidate {
	readonly valid: false;
	readonly code: DedicatedCandidateRejectionCode;
	readonly endpointId?: string;
	readonly relationId?: string;
	readonly otherEndpointId?: string;
	readonly otherRelationId?: string;
	readonly contact?: Point;
}

export type DedicatedCandidateValidation = ValidDedicatedCandidate | RejectedDedicatedCandidate;

export function rejected(
	code: DedicatedCandidateRejectionCode,
	endpointId?: string,
	relationId?: string,
): RejectedDedicatedCandidate {
	const rejection: {
		valid: false;
		code: DedicatedCandidateRejectionCode;
		endpointId?: string;
		relationId?: string;
	} = { valid: false, code };
	if (endpointId !== undefined) rejection.endpointId = endpointId;
	if (relationId !== undefined) rejection.relationId = relationId;
	return rejection;
}
