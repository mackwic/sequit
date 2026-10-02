import { isAnonymizedDocument } from '../../core/document/anonymize-document';
import type { GroupMeasurement, Size } from '../../core/layout/layout-types';
import { parseSequitToml } from '../toml/parse-sequit-toml';
import {
	LAYOUT_REPORT_CATEGORIES,
	LAYOUT_REPORT_MAX_BYTES,
	LAYOUT_REPORT_MAX_COMMENT_LENGTH,
	LAYOUT_REPORT_SCHEMA,
	type LayoutReport,
	type LayoutReportChecks,
	type LayoutReportContent,
	type LayoutReportDisplay,
	type LayoutReportEnvironment,
	type LayoutReportZone,
	type RenderedLayout,
	type RenderedRelation,
	REPORTED_ENTITY_KINDS,
	type ReportedEntity,
	type ReportedLayout,
	type ReportedMeasurements,
} from './layout-report';
import {
	bounds,
	box,
	entries,
	finite,
	identifier,
	lane,
	list,
	numbers,
	oneOf,
	type Parse,
	record,
	relation,
	text,
} from './parse-report-values';

const FAILURE_CODE = /^[a-z][a-z-]{0,63}$/;
const size: Parse<Size> = numbers(['width', 'height']);
const groupMeasurement: Parse<GroupMeasurement> = numbers([
	'minimumWidth',
	'minimumHeight',
	'headerHeight',
	'padding',
]);
const boxes = list(box);

function anonymizedDocument(value: unknown): string | undefined {
	const source = text(LAYOUT_REPORT_MAX_BYTES)(value);
	if (source === undefined) return undefined;
	const parsed = parseSequitToml(source);
	if (!parsed.ok || !isAnonymizedDocument(parsed.value)) return undefined;
	return source;
}

function measurements(value: unknown): ReportedMeasurements | undefined {
	const fields = record(value);
	const nodes = entries(size)(fields?.['nodes']);
	const junctions = entries(size)(fields?.['junctions']);
	const groups = entries(groupMeasurement)(fields?.['groups']);
	if (nodes === undefined || junctions === undefined) return undefined;
	if (groups === undefined) return undefined;
	return { nodes, junctions, groups };
}

function layout(value: unknown): ReportedLayout | undefined {
	const fields = record(value);
	const extent = size(fields);
	const [nodes, groups, junctions, regions] = ['nodes', 'groups', 'junctions', 'regions'].map(
		(key) => boxes(fields?.[key]),
	);
	const relations = list(relation)(fields?.['relations']);
	const lanes = list(lane)(fields?.['lanes']);
	if (extent === undefined || relations === undefined) return undefined;
	if (lanes === undefined) return undefined;
	if (nodes === undefined || groups === undefined) return undefined;
	if (junctions === undefined || regions === undefined) return undefined;
	return { ...extent, nodes, groups, junctions, relations, lanes, regions };
}

function renderedRelation(value: unknown): RenderedRelation | undefined {
	const fields = record(value);
	const id = identifier(fields?.['id']);
	const path = text(1_000_000)(fields?.['path']);
	if (id === undefined || path === undefined) return undefined;
	return { id, path };
}

function rendered(value: unknown): RenderedLayout | undefined {
	const fields = record(value);
	const frame = numbers(['width', 'height', 'zoom'])(fields);
	const [nodes, groups, junctions] = ['nodes', 'groups', 'junctions'].map((key) =>
		boxes(fields?.[key]),
	);
	const relations = list(renderedRelation)(fields?.['relations']);
	if (frame === undefined || relations === undefined) return undefined;
	if (nodes === undefined || groups === undefined) return undefined;
	if (junctions === undefined) return undefined;
	return { ...frame, nodes, groups, junctions, relations };
}

function entity(value: unknown): ReportedEntity | undefined {
	const fields = record(value);
	const kind = oneOf(REPORTED_ENTITY_KINDS)(fields?.['kind']);
	const id = identifier(fields?.['id']);
	if (kind === undefined || id === undefined) return undefined;
	return { kind, id };
}

function zone(value: unknown): LayoutReportZone | undefined {
	const fields = record(value);
	const area = bounds(fields?.['bounds']);
	const entities = list(entity)(fields?.['entities']);
	if (area === undefined || entities === undefined) return undefined;
	return { bounds: area, entities };
}

function checks(value: unknown): LayoutReportChecks | undefined {
	const fields = record(value);
	const anonymizationDiverged = fields?.['anonymizationDiverged'];
	const projectionDiverged = fields?.['projectionDiverged'];
	if (typeof anonymizationDiverged !== 'boolean') return undefined;
	if (typeof projectionDiverged !== 'boolean') return undefined;
	return { anonymizationDiverged, projectionDiverged };
}

function environment(value: unknown): LayoutReportEnvironment | undefined {
	const fields = record(value);
	const userAgent = text(1_024)(fields?.['userAgent']);
	const language = text(64)(fields?.['language']);
	const devicePixelRatio = finite(fields?.['devicePixelRatio']);
	const viewport = size(fields?.['viewport']);
	if (userAgent === undefined || language === undefined) return undefined;
	if (devicePixelRatio === undefined || viewport === undefined) return undefined;
	return { userAgent, language, devicePixelRatio, viewport };
}

function failure(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	if (!FAILURE_CODE.test(value)) return undefined;
	return value;
}

/** Absent stays absent; present but malformed is `null`. */
function optional<T>(parse: Parse<T>, value: unknown): T | undefined | null {
	if (value === undefined) return undefined;
	return parse(value) ?? null;
}

/** The parts of the display, each absent or well formed. */
function display(fields: Readonly<Record<string, unknown>>): LayoutReportDisplay | undefined {
	const parts: { layout?: ReportedLayout; failure?: string; rendered?: RenderedLayout } = {};
	const reportedLayout = optional(layout, fields['layout']);
	const reportedFailure = optional(failure, fields['failure']);
	const reportedRendering = optional(rendered, fields['rendered']);
	if (reportedLayout === null || reportedFailure === null) return undefined;
	if (reportedRendering === null) return undefined;
	if (reportedLayout !== undefined) parts.layout = reportedLayout;
	if (reportedFailure !== undefined) parts.failure = reportedFailure;
	if (reportedRendering !== undefined) parts.rendered = reportedRendering;
	return parts;
}

function content(fields: Readonly<Record<string, unknown>>): LayoutReportContent | undefined {
	const category = oneOf(LAYOUT_REPORT_CATEGORIES)(fields['category']);
	const comment = text(LAYOUT_REPORT_MAX_COMMENT_LENGTH)(fields['comment']);
	const document = anonymizedDocument(fields['document']);
	const measured = measurements(fields['measurements']);
	const zones = list(zone)(fields['zones']);
	const verified = checks(fields['checks']);
	const context = environment(fields['environment']);
	if (category === undefined || comment === undefined) return undefined;
	if (document === undefined || measured === undefined) return undefined;
	if (zones === undefined || verified === undefined) return undefined;
	if (context === undefined) return undefined;
	return {
		category,
		comment,
		document,
		measurements: measured,
		zones,
		checks: verified,
		environment: context,
	};
}

/**
 * A well-formed report whose document holds only `xxx` texts and anonymous identifiers, rebuilt
 * from its known fields; `undefined` otherwise. Only the comment is free text.
 */
export function parseLayoutReport(value: unknown): LayoutReport | undefined {
	const fields = record(value);
	if (fields?.['schemaVersion'] !== LAYOUT_REPORT_SCHEMA) return undefined;
	const reported = content(fields);
	const shown = display(fields);
	if (reported === undefined || shown === undefined) return undefined;
	return { schemaVersion: LAYOUT_REPORT_SCHEMA, ...reported, ...shown };
}
