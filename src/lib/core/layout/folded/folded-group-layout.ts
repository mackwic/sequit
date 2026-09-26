import { compareCanonicalStrings } from '../../canonical-string';
import {
	defined,
	EndpointKind,
	GroupState,
	type LogicDocument,
} from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import type {
	GroupMeasurement,
	LayoutMeasurements,
	LayoutResult,
	Point,
	Size,
} from '../layout-types';
import {
	type FoldedGeometry,
	type FoldedSideFace,
	geometryFromMeasurements,
} from './folded-group-geometry';
import {
	type NormalizedVisibleOwnership,
	normalizeVisibleOwnership,
	type VisibleSourceRelation,
} from './visible-ownership';

export { FoldedSideFace } from './folded-group-geometry';

export enum FoldedGroupLayoutKind {
	Supported = 'supported',
	Unknown = 'unknown',
}

export enum FoldedGroupUnknownReason {
	UnsupportedPresentation = 'unsupported-presentation',
	UnsupportedSourceShape = 'unsupported-source-shape',
	UnsupportedRanks = 'unsupported-ranks',
	MissingVisibleMeasurements = 'missing-visible-measurements',
	InvalidVisibleMeasurements = 'invalid-visible-measurements',
}

export enum FoldedAttachmentRole {
	Source = 'source',
	Target = 'target',
}

interface FoldedRouteAttachment {
	readonly relationId: string;
	readonly role: FoldedAttachmentRole;
	readonly sourceEndpointId: string;
	readonly visibleOwnerId: string;
	readonly face: FoldedSideFace;
	readonly point: Point;
}

interface FoldedRelationProvenance {
	readonly relationId: string;
	readonly sourceRelationIds: readonly string[];
}

interface SupportedFoldedGroupLayout {
	readonly kind: FoldedGroupLayoutKind.Supported;
	readonly layout: LayoutResult;
	readonly ownership: NormalizedVisibleOwnership;
	readonly attachments: readonly FoldedRouteAttachment[];
	readonly relationProvenance: readonly FoldedRelationProvenance[];
}

interface UnknownFoldedGroupLayout {
	readonly kind: FoldedGroupLayoutKind.Unknown;
	readonly reason: FoldedGroupUnknownReason;
	readonly ownership: NormalizedVisibleOwnership;
}

export type FoldedGroupLayoutAttempt = SupportedFoldedGroupLayout | UnknownFoldedGroupLayout;

interface FoldedWitness {
	readonly groupId: string;
	readonly externalId: string;
	readonly outward: VisibleSourceRelation;
	readonly inward: VisibleSourceRelation;
}

function positive(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

function nonNegative(value: number): boolean {
	return Number.isFinite(value) && value >= 0;
}

function validSize(size: Size): boolean {
	if (!positive(size.width)) return false;
	return positive(size.height);
}

function validGroupMeasurement(measurement: GroupMeasurement): boolean {
	if (!positive(measurement.minimumWidth)) return false;
	if (!positive(measurement.minimumHeight)) return false;
	if (!nonNegative(measurement.headerHeight)) return false;
	return nonNegative(measurement.padding);
}

function hasWitnessSourceShape(
	document: LogicDocument,
	ownership: NormalizedVisibleOwnership,
	collapsedGroupIds: readonly string[],
): boolean {
	if (collapsedGroupIds.length !== 1) return false;
	if (document.groups.length !== 1 || document.nodes.length !== 3) return false;
	if (document.junctions.length !== 0) return false;
	if (ownership.visibleOwners.length !== 2 || ownership.relations.length !== 2) return false;
	const group = defined(document.groups[0]);
	if (group.state !== GroupState.Closed || group.groupId !== undefined) return false;
	if (group.laneId !== undefined) return false;
	if (document.nodes.some(({ laneId }) => laneId !== undefined)) return false;
	return true;
}

function findFoldedWitness(
	document: LogicDocument,
	ownership: NormalizedVisibleOwnership,
	collapsedGroupIds: readonly string[],
): FoldedWitness | undefined {
	if (!hasWitnessSourceShape(document, ownership, collapsedGroupIds)) return undefined;
	const groupId = defined(collapsedGroupIds[0]);
	const outward = ownership.relations.find(
		({ from, to }) => from.visibleOwnerId === groupId && to.visibleOwnerId !== groupId,
	);
	const inward = ownership.relations.find(
		({ from, to }) => from.visibleOwnerId !== groupId && to.visibleOwnerId === groupId,
	);
	if (outward === undefined || inward === undefined) return undefined;
	const externalId = outward.to.visibleOwnerId;
	// One validated group, three nodes and exactly G/x visible imply direct A/B members and x.
	// Reusing one member in both incidences would have been rejected as a source cycle.
	return { groupId, externalId, outward, inward };
}

function supportedLayout(
	ownership: NormalizedVisibleOwnership,
	witness: FoldedWitness,
	geometry: FoldedGeometry,
): SupportedFoldedGroupLayout {
	const { groupId, externalId, outward, inward } = witness;
	const {
		groupBounds,
		externalBounds,
		groupFace,
		externalFace,
		groupB,
		groupA,
		externalSource,
		externalTarget,
	} = geometry;
	const attachments: FoldedRouteAttachment[] = [
		{
			relationId: outward.id,
			role: FoldedAttachmentRole.Source,
			sourceEndpointId: outward.from.endpointId,
			visibleOwnerId: groupId,
			face: groupFace,
			point: groupB,
		},
		{
			relationId: outward.id,
			role: FoldedAttachmentRole.Target,
			sourceEndpointId: outward.to.endpointId,
			visibleOwnerId: externalId,
			face: externalFace,
			point: externalTarget,
		},
		{
			relationId: inward.id,
			role: FoldedAttachmentRole.Source,
			sourceEndpointId: inward.from.endpointId,
			visibleOwnerId: externalId,
			face: externalFace,
			point: externalSource,
		},
		{
			relationId: inward.id,
			role: FoldedAttachmentRole.Target,
			sourceEndpointId: inward.to.endpointId,
			visibleOwnerId: groupId,
			face: groupFace,
			point: groupA,
		},
	].sort(
		(a, b) =>
			compareCanonicalStrings(a.relationId, b.relationId) ||
			compareCanonicalStrings(a.role, b.role),
	);
	const relations = [
		{
			id: outward.id,
			from: groupId,
			to: externalId,
			points: [groupB, geometry.leavingRailStart, geometry.leavingRailEnd, externalTarget],
		},
		{
			id: inward.id,
			from: externalId,
			to: groupId,
			points: [externalSource, geometry.returningRailStart, geometry.returningRailEnd, groupA],
		},
	].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	const elements = [
		{ id: groupId, kind: EndpointKind.Group, bounds: groupBounds },
		{ id: externalId, kind: EndpointKind.Node, bounds: externalBounds },
	].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	return {
		kind: FoldedGroupLayoutKind.Supported,
		layout: {
			width: geometry.width,
			height: geometry.height,
			elements,
			relations,
		},
		ownership,
		attachments,
		relationProvenance: relations.map(({ id }) => ({
			relationId: id,
			sourceRelationIds: [id],
		})),
	};
}

/** A bounded policy for the source-valid, visibly cyclic G={A,B}, B→x→A motif. */
export function tryLayoutFoldedGroup(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	visibleMeasurements: LayoutMeasurements,
	collapsedGroupIds: readonly string[],
): FoldedGroupLayoutAttempt {
	const ownership = normalizeVisibleOwnership(graph, collapsedGroupIds);
	const unknown = (reason: FoldedGroupUnknownReason): UnknownFoldedGroupLayout => ({
		kind: FoldedGroupLayoutKind.Unknown,
		reason,
		ownership,
	});
	const document = graph.document;
	if (document.presentation !== undefined)
		return unknown(FoldedGroupUnknownReason.UnsupportedPresentation);
	const witness = findFoldedWitness(document, ownership, collapsedGroupIds);
	if (witness === undefined) return unknown(FoldedGroupUnknownReason.UnsupportedSourceShape);
	const { groupId, externalId, outward, inward } = witness;
	if (ranks.byEndpointId.get(inward.to.endpointId) !== 0)
		return unknown(FoldedGroupUnknownReason.UnsupportedRanks);
	if (ranks.byEndpointId.get(externalId) !== 1)
		return unknown(FoldedGroupUnknownReason.UnsupportedRanks);
	if (ranks.byEndpointId.get(outward.from.endpointId) !== 2)
		return unknown(FoldedGroupUnknownReason.UnsupportedRanks);
	const measuredGroup = visibleMeasurements.groups.get(groupId);
	const measuredExternal = visibleMeasurements.nodes.get(externalId);
	if (measuredGroup === undefined || measuredExternal === undefined)
		return unknown(FoldedGroupUnknownReason.MissingVisibleMeasurements);
	if (!validGroupMeasurement(measuredGroup) || !validSize(measuredExternal))
		return unknown(FoldedGroupUnknownReason.InvalidVisibleMeasurements);
	const geometry = geometryFromMeasurements(
		document.layout.direction,
		measuredGroup,
		measuredExternal,
	);
	if (geometry === undefined) return unknown(FoldedGroupUnknownReason.InvalidVisibleMeasurements);
	return supportedLayout(ownership, witness, geometry);
}
