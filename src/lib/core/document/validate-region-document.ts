import {
	GRID_PERSISTENCE_FORMAT,
	GRID_REGION_PRESENTATION_SCHEMA,
	type LogicDocument,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_LANE_PRESENTATION_SCHEMA,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
	type SequitDiagnostic,
	SequitDiagnosticCode,
} from './logic-document';
import {
	normalizeRegionPresentation,
	RegionPresentationIssueCode,
	RegionPresentationStatus,
} from './region-presentation';
import { validateGridPresentation } from './validate-grid-presentation';

enum EndpointCollection {
	Groups = 'groups',
	Nodes = 'nodes',
	Junctions = 'junctions',
}

interface EndpointEntry {
	readonly collection: EndpointCollection;
	readonly id: string;
	readonly regionId: string | undefined;
}

function endpointEntries(document: LogicDocument): readonly EndpointEntry[] {
	return [
		...document.groups.map(({ id, regionId }) => ({
			collection: EndpointCollection.Groups,
			id,
			regionId,
		})),
		...document.nodes.map(({ id, regionId }) => ({
			collection: EndpointCollection.Nodes,
			id,
			regionId,
		})),
		...document.junctions.map(({ id, regionId }) => ({
			collection: EndpointCollection.Junctions,
			id,
			regionId,
		})),
	];
}

function invalid(diagnostics: SequitDiagnostic[], message: string, path: readonly string[]): void {
	diagnostics.push({ code: SequitDiagnosticCode.InvalidValue, message, path });
}

interface PresentationIssue {
	readonly code: RegionPresentationIssueCode;
	readonly id: string;
	readonly laneId?: string;
	readonly field?: string;
}

const laneDefinitionCodes = new Set<RegionPresentationIssueCode>([
	RegionPresentationIssueCode.NonLeafLanePresentation,
	RegionPresentationIssueCode.InvalidLaneOrientation,
	RegionPresentationIssueCode.InvalidLaneGrowth,
	RegionPresentationIssueCode.InvalidLaneCount,
	RegionPresentationIssueCode.InvalidLanePresentation,
	RegionPresentationIssueCode.InvalidLane,
	RegionPresentationIssueCode.DuplicateLane,
]);

const laneAssignmentCodes = new Set<RegionPresentationIssueCode>([
	RegionPresentationIssueCode.MissingLaneAssignment,
	RegionPresentationIssueCode.UnknownLaneAssignment,
	RegionPresentationIssueCode.InheritedLaneAssignment,
	RegionPresentationIssueCode.UnconfiguredLaneAssignment,
]);

function laneDefinitionPath(issue: PresentationIssue): readonly string[] | undefined {
	if (!laneDefinitionCodes.has(issue.code)) return undefined;
	const prefix = ['regionPresentation', 'regions', issue.id, 'lanePresentation'];
	if (issue.code === RegionPresentationIssueCode.InvalidLaneOrientation)
		return [...prefix, 'laneOrientation'];
	if (issue.code === RegionPresentationIssueCode.InvalidLaneGrowth) return [...prefix, 'growth'];
	if (issue.code === RegionPresentationIssueCode.InvalidLaneCount) return [...prefix, 'lanes'];
	if (
		issue.code === RegionPresentationIssueCode.InvalidLane ||
		issue.code === RegionPresentationIssueCode.DuplicateLane
	) {
		const path = [...prefix, 'lanes', issue.laneId ?? ''];
		if (issue.field !== undefined) path.push(issue.field);
		return path;
	}
	return prefix;
}

function issuePath(
	endpoints: readonly EndpointEntry[],
	issue: PresentationIssue,
): readonly string[] {
	const { code, id } = issue;
	if (
		code === RegionPresentationIssueCode.InvalidRegion ||
		code === RegionPresentationIssueCode.DuplicateRegion
	)
		return ['regionPresentation', 'regions', id];
	if (
		code === RegionPresentationIssueCode.UnknownParent ||
		code === RegionPresentationIssueCode.RegionCycle
	)
		return ['regionPresentation', 'regions', id, 'parentId'];
	const lanePath = laneDefinitionPath(issue);
	if (lanePath !== undefined) return lanePath;
	const endpoint = endpoints.find((entry) => entry.id === id);
	if (endpoint === undefined) return ['regionPresentation', 'assignments', id];
	if (code === RegionPresentationIssueCode.InvalidGroupParent)
		return [endpoint.collection, id, 'group'];
	if (laneAssignmentCodes.has(code)) return [endpoint.collection, id, 'lane'];
	return [endpoint.collection, id, 'regionId'];
}

function validateLegacyRegionFields(
	document: LogicDocument,
	endpoints: readonly EndpointEntry[],
	diagnostics: SequitDiagnostic[],
): void {
	if (document.regionPresentation !== undefined)
		invalid(diagnostics, 'This format cannot persist explicit regions', ['regionPresentation']);
	for (const endpoint of endpoints)
		if (endpoint.regionId !== undefined)
			invalid(diagnostics, 'This format cannot assign regions', [
				endpoint.collection,
				endpoint.id,
				'regionId',
			]);
}

function hasRegionPresentation(document: LogicDocument): boolean {
	if (document.persistenceFormat === REGION_PERSISTENCE_FORMAT) return true;
	if (document.persistenceFormat === GRID_PERSISTENCE_FORMAT) return true;
	if (document.persistenceFormat === REGION_LANE_PERSISTENCE_FORMAT) return true;
	return document.persistenceFormat === REGION_COMPOSITION_PERSISTENCE_FORMAT;
}

function expectedSchema(document: LogicDocument): number {
	if (document.persistenceFormat === GRID_PERSISTENCE_FORMAT)
		return GRID_REGION_PRESENTATION_SCHEMA;
	if (document.persistenceFormat === REGION_LANE_PERSISTENCE_FORMAT)
		return REGION_LANE_PRESENTATION_SCHEMA;
	if (document.persistenceFormat === REGION_COMPOSITION_PERSISTENCE_FORMAT)
		return REGION_COMPOSITION_PRESENTATION_SCHEMA;
	return REGION_PRESENTATION_SCHEMA;
}

function validateRegionFields(
	document: LogicDocument,
	presentation: NonNullable<LogicDocument['regionPresentation']>,
	diagnostics: SequitDiagnostic[],
): void {
	for (const region of presentation.regions) {
		const path = ['regionPresentation', 'regions', region.id];
		const localLanesAllowed =
			document.persistenceFormat === REGION_LANE_PERSISTENCE_FORMAT ||
			document.persistenceFormat === REGION_COMPOSITION_PERSISTENCE_FORMAT;
		if (region.lanePresentation !== undefined && !localLanesAllowed)
			invalid(diagnostics, 'This region format cannot persist leaf lanes', [
				...path,
				'lanePresentation',
			]);
		if (region.grid === undefined) continue;
		if (document.persistenceFormat !== REGION_COMPOSITION_PERSISTENCE_FORMAT)
			invalid(diagnostics, 'This region format cannot persist an internal grid', [...path, 'grid']);
		else
			validateGridPresentation(region.grid, presentation.regions, diagnostics, {
				path: [...path, 'grid'],
				parentId: region.id,
			});
	}
	if (document.persistenceFormat === GRID_PERSISTENCE_FORMAT) {
		if (presentation.grid === undefined)
			invalid(diagnostics, 'Grid documents require grid presentation preferences', [
				'regionPresentation',
				'grid',
			]);
		else validateGridPresentation(presentation.grid, presentation.regions, diagnostics);
		return;
	}
	if (presentation.grid !== undefined)
		invalid(diagnostics, 'This format cannot persist a grid presentation', [
			'regionPresentation',
			'grid',
		]);
}

export function validateRegionDocument(
	document: LogicDocument,
	diagnostics: SequitDiagnostic[],
): void {
	const endpoints = endpointEntries(document);
	if (!hasRegionPresentation(document)) {
		validateLegacyRegionFields(document, endpoints, diagnostics);
		return;
	}
	const presentation = document.regionPresentation;
	if (presentation === undefined) {
		invalid(diagnostics, 'Region documents require region presentation preferences', [
			'regionPresentation',
		]);
		return;
	}
	const schemaVersion: unknown = presentation.schemaVersion;
	if (schemaVersion !== expectedSchema(document))
		invalid(diagnostics, 'Unsupported region presentation schema', [
			'regionPresentation',
			'schemaVersion',
		]);
	const rawRegions: unknown = presentation.regions;
	if (!Array.isArray(rawRegions)) {
		invalid(diagnostics, 'Regions must be a list', ['regionPresentation', 'regions']);
		return;
	}
	validateRegionFields(document, presentation, diagnostics);
	const assignments = new Map<string, string>();
	for (const endpoint of endpoints)
		if (endpoint.regionId !== undefined) assignments.set(endpoint.id, endpoint.regionId);
	const result = normalizeRegionPresentation(document, presentation.regions, assignments);
	if (result.status === RegionPresentationStatus.Ready) return;
	for (const issue of result.issues)
		invalid(
			diagnostics,
			`Invalid region presentation: ${issue.code} (${issue.id})`,
			issuePath(endpoints, issue),
		);
}
