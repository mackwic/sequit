import { compareCanonicalStrings } from '../canonical-string';
import {
	defined,
	LaneGrowth,
	LaneOrientation,
	LayoutPolicy,
	type LayoutRegionDefinition,
	type LogicDocument,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_LANE_PRESENTATION_SCHEMA,
	REGION_POLICY_PERSISTENCE_FORMAT,
	REGION_POLICY_PRESENTATION_SCHEMA,
	type RegionLanePresentation,
} from './logic-document';
import { parseOrderKey } from './order-key';
import {
	type RegionPresentationIssue,
	RegionPresentationIssueCode,
} from './region-presentation-issues';

type Endpoint =
	| LogicDocument['groups'][number]
	| LogicDocument['nodes'][number]
	| LogicDocument['junctions'][number];

function nonEmptyString(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	return value.trim() !== '';
}

function validOrder(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	return parseOrderKey(value) !== undefined;
}

function isRecord(value: unknown): boolean {
	if (value === null) return false;
	return typeof value === 'object';
}

function laneIssue(
	code: RegionPresentationIssueCode,
	regionId: string,
	laneId: string,
	field?: string,
): RegionPresentationIssue {
	const issue: { code: RegionPresentationIssueCode; id: string; laneId: string; field?: string } = {
		code,
		id: regionId,
		laneId,
	};
	if (field !== undefined) issue.field = field;
	return issue;
}

function laneFieldIssues(
	regionId: string,
	presentation: RegionLanePresentation,
): readonly RegionPresentationIssue[] {
	const issues: RegionPresentationIssue[] = [];
	const ids = new Set<string>();
	for (const lane of presentation.lanes) {
		const rawLane: unknown = lane;
		if (!isRecord(rawLane)) {
			issues.push(laneIssue(RegionPresentationIssueCode.InvalidLane, regionId, '', 'id'));
			continue;
		}
		const id: unknown = lane.id;
		const label: unknown = lane.label;
		const layoutOrder: unknown = lane.layoutOrder;
		if (!nonEmptyString(id)) {
			issues.push(laneIssue(RegionPresentationIssueCode.InvalidLane, regionId, '', 'id'));
			continue;
		}
		if (ids.has(id))
			issues.push(laneIssue(RegionPresentationIssueCode.DuplicateLane, regionId, id));
		ids.add(id);
		if (!nonEmptyString(label))
			issues.push(laneIssue(RegionPresentationIssueCode.InvalidLane, regionId, id, 'label'));
		if (!validOrder(layoutOrder))
			issues.push(laneIssue(RegionPresentationIssueCode.InvalidLane, regionId, id, 'layoutOrder'));
	}
	return issues;
}

function contractIssues(
	definition: LayoutRegionDefinition,
	parentIds: ReadonlySet<string | undefined>,
): readonly RegionPresentationIssue[] {
	const presentation = definition.lanePresentation;
	if (presentation === undefined) return [];
	const raw: unknown = presentation;
	if (!isRecord(raw))
		return [{ code: RegionPresentationIssueCode.InvalidLanePresentation, id: definition.id }];
	const issues: RegionPresentationIssue[] = [];
	if (parentIds.has(definition.id))
		issues.push({ code: RegionPresentationIssueCode.NonLeafLanePresentation, id: definition.id });
	const orientation: unknown = presentation.laneOrientation;
	const validOrientation =
		orientation === LaneOrientation.Parallel || orientation === LaneOrientation.Transverse;
	if (!validOrientation)
		issues.push({ code: RegionPresentationIssueCode.InvalidLaneOrientation, id: definition.id });
	const growth: unknown = presentation.growth;
	if (growth !== LaneGrowth.Auto)
		issues.push({ code: RegionPresentationIssueCode.InvalidLaneGrowth, id: definition.id });
	const lanes: unknown = presentation.lanes;
	if (!Array.isArray(lanes) || lanes.length !== 2) {
		issues.push({ code: RegionPresentationIssueCode.InvalidLaneCount, id: definition.id });
		return issues;
	}
	issues.push(...laneFieldIssues(definition.id, presentation));
	return issues;
}

export function regionLeafLaneDefinitionIssues(
	definitions: readonly LayoutRegionDefinition[],
	onComparison?: (ownerId: string) => void,
): readonly RegionPresentationIssue[] {
	const parentIds = new Set(definitions.map(({ parentId }) => parentId));
	const issues: RegionPresentationIssue[] = [];
	for (const definition of [...definitions].sort((a, b) => {
		onComparison?.(a.id);
		return compareCanonicalStrings(a.id, b.id);
	}))
		issues.push(...contractIssues(definition, parentIds));
	return issues;
}

interface LaneAssignmentContext {
	readonly document: LogicDocument;
	readonly byRegionId: ReadonlyMap<string, LayoutRegionDefinition>;
	readonly ownership: ReadonlyMap<string, string>;
	readonly rootLaneIds: ReadonlySet<string>;
}

function localLaneIds(presentation: RegionLanePresentation): ReadonlySet<string> {
	const ids = new Set<string>();
	const rawLanes: unknown = presentation.lanes;
	if (!Array.isArray(rawLanes)) return ids;
	for (const lane of presentation.lanes) {
		const rawLane: unknown = lane;
		if (!isRecord(rawLane)) continue;
		const id: unknown = lane.id;
		if (typeof id === 'string') ids.add(id);
	}
	return ids;
}

function endpointLaneIssue(
	endpoint: Endpoint,
	context: LaneAssignmentContext,
): RegionPresentationIssue | undefined {
	if (endpoint.groupId !== undefined) {
		if (endpoint.laneId !== undefined)
			return { code: RegionPresentationIssueCode.InheritedLaneAssignment, id: endpoint.id };
		return undefined;
	}
	const regionId = defined(
		context.ownership.get(endpoint.id),
		'Endpoint region ownership is missing',
	);
	const local = context.byRegionId.get(regionId)?.lanePresentation;
	let laneIds = context.rootLaneIds;
	const rawLocal: unknown = local;
	if (local !== undefined && isRecord(rawLocal)) laneIds = localLaneIds(local);
	const configured = local !== undefined || context.document.presentation !== undefined;
	if (configured) {
		if (endpoint.laneId === undefined)
			return { code: RegionPresentationIssueCode.MissingLaneAssignment, id: endpoint.id };
		if (!laneIds.has(endpoint.laneId))
			return { code: RegionPresentationIssueCode.UnknownLaneAssignment, id: endpoint.id };
		return undefined;
	}
	if (endpoint.laneId !== undefined)
		return { code: RegionPresentationIssueCode.UnconfiguredLaneAssignment, id: endpoint.id };
	return undefined;
}

export function regionLeafLaneAssignmentIssues(
	document: LogicDocument,
	endpoints: readonly Endpoint[],
	byRegionId: ReadonlyMap<string, LayoutRegionDefinition>,
	ownership: ReadonlyMap<string, string>,
	onComparison?: (ownerId: string) => void,
): readonly RegionPresentationIssue[] {
	const format = document.persistenceFormat;
	const earlierRegionFormat =
		format === REGION_LANE_PERSISTENCE_FORMAT || format === REGION_COMPOSITION_PERSISTENCE_FORMAT;
	if (!earlierRegionFormat && format !== REGION_POLICY_PERSISTENCE_FORMAT) return [];
	const rootLaneIds = new Set(document.presentation?.lanes.map(({ id }) => id) ?? []);
	const context = { document, byRegionId, ownership, rootLaneIds };
	const issues: RegionPresentationIssue[] = [];
	for (const endpoint of [...endpoints].sort((a, b) => {
		onComparison?.(a.id);
		return compareCanonicalStrings(a.id, b.id);
	})) {
		const issue = endpointLaneIssue(endpoint, context);
		if (issue !== undefined) issues.push(issue);
	}
	return issues;
}

export function normalizedRegionLaneFields(
	definition: LayoutRegionDefinition,
	onComparison?: (ownerId: string) => void,
): {
	readonly lanePresentation?: RegionLanePresentation;
} {
	const presentation = definition.lanePresentation;
	if (presentation === undefined) return {};
	return {
		lanePresentation: {
			...presentation,
			lanes: [...presentation.lanes].sort((left, right) => {
				onComparison?.(definition.id);
				return (
					compareCanonicalStrings(left.layoutOrder, right.layoutOrder) ||
					compareCanonicalStrings(left.id, right.id)
				);
			}),
		},
	};
}

function hasExplicitRegionPolicy(document: LogicDocument): boolean {
	return (
		document.persistenceFormat === REGION_POLICY_PERSISTENCE_FORMAT ||
		document.regionPresentation?.schemaVersion === REGION_POLICY_PRESENTATION_SCHEMA
	);
}

/** Old region documents encoded the leaf policy through its effective lane presentation. */
export function migrateLegacyRegionDefinitions(
	document: LogicDocument,
	definitions: readonly LayoutRegionDefinition[],
	onVisit?: (ownerId: string) => void,
): readonly LayoutRegionDefinition[] {
	if (hasExplicitRegionPolicy(document)) return definitions;
	const parentIds = new Set(
		definitions.map(({ id, parentId }) => {
			onVisit?.(id);
			return parentId;
		}),
	);
	return definitions.map((definition) => {
		onVisit?.(definition.id);
		if (parentIds.has(definition.id)) return definition;
		if (definition.lanePresentation === undefined && document.presentation === undefined)
			return definition;
		return { ...definition, policy: LayoutPolicy.SharedLanes };
	});
}

/**
 * Materialize the old implicit choice once at the persistence boundary. Only the lane and the
 * composition formats carry the old implicit policy; the legacy region and grid formats do not.
 */
export function migrateLegacyRegionPolicyDocument(document: LogicDocument): LogicDocument {
	const presentation = document.regionPresentation;
	if (presentation === undefined || hasExplicitRegionPolicy(document)) return document;
	const schema = presentation.schemaVersion;
	if (
		schema !== REGION_LANE_PRESENTATION_SCHEMA &&
		schema !== REGION_COMPOSITION_PRESENTATION_SCHEMA
	)
		return document;
	const rootFields: { presentation?: NonNullable<LogicDocument['presentation']> } = {};
	if (document.presentation !== undefined)
		rootFields.presentation = { ...document.presentation, policy: LayoutPolicy.SharedLanes };
	return {
		...document,
		persistenceFormat: REGION_POLICY_PERSISTENCE_FORMAT,
		...rootFields,
		regionPresentation: {
			schemaVersion: REGION_POLICY_PRESENTATION_SCHEMA,
			regions: migrateLegacyRegionDefinitions(document, presentation.regions),
		},
	};
}
