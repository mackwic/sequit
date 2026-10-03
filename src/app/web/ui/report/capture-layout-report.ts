import { anonymizeDocument } from '../../../../lib/core/document/anonymize-document';
import type { LogicDocument } from '../../../../lib/core/document/logic-document';
import {
	LAYOUT_REPORT_SCHEMA,
	type LayoutReport,
	type LayoutReportCategory,
	type LayoutReportDisplay,
	type LayoutReportEnvironment,
	type LayoutReportZone,
	ReportedEntityKind,
	type ReportedLayout,
} from '../../../../lib/infrastructure/layout-report/layout-report';
import { serializeSequitToml } from '../../../../lib/infrastructure/toml/serialize-sequit-toml';
import type { LayoutMeasurements } from '../../projection/layout-graph';
import { createSharedCanvasProjection } from '../../projection/shared-canvas-projection';
import { EntityKind } from '../canvas/canvas-entity';
import {
	type CanvasMeasurementModel,
	type CanvasModel,
	createCanvasMeasurementModel,
} from '../canvas/canvas-model';
import {
	createRename,
	readRenderedLayout,
	type Rename,
	reportedLayout,
	reportedMeasurements,
} from './report-geometry';
import type { ReportZone } from './report-zones';

/** What a workspace hands its canvas while the reporter writes a layout report. */
export interface LayoutReportRequest {
	/** The complete source document, with its original texts and identifiers. */
	readonly read: () => LogicDocument;
	readonly close: () => void;
}

function unshown<T extends { readonly id: string }>(
	items: readonly T[],
	shown: readonly { readonly id: string }[],
): readonly T[] {
	const ids = new Set(shown.map(({ id }) => id));
	return items.filter(({ id }) => !ids.has(id));
}

/**
 * What the source document holds that the shown canvas does not measure: the members of folded
 * groups. A report measures them too, so that its document replays unfolded as well as folded.
 */
export function unshownMeasurementModel(
	document: LogicDocument,
	shown: CanvasMeasurementModel,
): CanvasMeasurementModel {
	const source = createCanvasMeasurementModel(document);
	return {
		nodes: unshown(source.nodes, shown.nodes),
		groups: unshown(source.groups, shown.groups),
		junctions: unshown(source.junctions, shown.junctions),
	};
}

/** The measurements the canvas was laid out with, completed with those it does not show. */
export function withUnshownMeasurements(
	shown: LayoutMeasurements,
	unshownMeasurements: LayoutMeasurements,
): LayoutMeasurements {
	return {
		nodes: new Map([...unshownMeasurements.nodes, ...shown.nodes]),
		junctions: new Map([...unshownMeasurements.junctions, ...shown.junctions]),
		groups: new Map([...unshownMeasurements.groups, ...shown.groups]),
	};
}

/** What the page holds when the reporter sends: original identifiers and texts. */
export interface LayoutReportCapture {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	/** The canvas shown; absent when the layout failed or is still measuring. */
	readonly canvas?: CanvasModel | undefined;
	/** The failure shown instead of a canvas. */
	readonly failure?: string | undefined;
	/** Where the canvas is drawn, to read back what the page displayed. */
	readonly viewport?: HTMLElement | undefined;
	readonly zones: readonly ReportZone[];
	readonly category: LayoutReportCategory;
	readonly comment: string;
	readonly environment: LayoutReportEnvironment;
}

const REPORTED_KIND: Readonly<Record<EntityKind, ReportedEntityKind>> = {
	[EntityKind.Node]: ReportedEntityKind.Node,
	[EntityKind.Group]: ReportedEntityKind.Group,
	[EntityKind.Junction]: ReportedEntityKind.Junction,
	[EntityKind.Relation]: ReportedEntityKind.Relation,
};

/** A layout from scratch, as a fresh projection of the document computes it. */
async function coldLayout(
	document: LogicDocument,
	measurements: LayoutMeasurements,
): Promise<CanvasModel | undefined> {
	try {
		return await createSharedCanvasProjection(document).createCanvasModel(measurements);
	} catch {
		return undefined;
	}
}

function renamedMeasurements(measurements: LayoutMeasurements, rename: Rename): LayoutMeasurements {
	const renamed = <T>(items: ReadonlyMap<string, T>) =>
		new Map([...items].map(([id, value]) => [rename(id), value]));
	return {
		nodes: renamed(measurements.nodes),
		junctions: renamed(measurements.junctions),
		groups: renamed(measurements.groups),
	};
}

function geometry(canvas: CanvasModel | undefined, rename: Rename): ReportedLayout | undefined {
	if (canvas === undefined) return undefined;
	return reportedLayout(canvas, rename);
}

function sameGeometry(left: ReportedLayout | undefined, right: ReportedLayout | undefined) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function zones(capture: LayoutReportCapture, rename: Rename): readonly LayoutReportZone[] {
	return capture.zones.map(({ bounds, entities }) => ({
		bounds,
		entities: entities.map(({ kind, id }) => ({ kind: REPORTED_KIND[kind], id: rename(id) })),
	}));
}

/** The optional parts: the canvas shown and what the page drew, or the failure shown instead. */
function shown(capture: LayoutReportCapture, rename: Rename): LayoutReportDisplay {
	if (capture.canvas === undefined) {
		if (capture.failure === undefined) return {};
		return { failure: capture.failure };
	}
	const layout = reportedLayout(capture.canvas, rename);
	if (capture.viewport === undefined) return { layout };
	const rendered = readRenderedLayout(capture.viewport, rename);
	if (rendered === undefined) return { layout };
	return { layout, rendered };
}

/**
 * Anonymizes the document and every identifier, then lays both documents out from scratch with
 * the same measurements. Different geometries mean the anonymization changed the layout; a
 * canvas unlike the cold layout means the live projection drifted from it.
 */
export async function captureLayoutReport(capture: LayoutReportCapture): Promise<LayoutReport> {
	const anonymized = anonymizeDocument(capture.document);
	const identity = new Map([...anonymized.identifiers.values()].map((token) => [token, token]));
	const rename = createRename(anonymized.identifiers);
	const [original, replayed] = await Promise.all([
		coldLayout(capture.document, capture.measurements),
		coldLayout(anonymized.document, renamedMeasurements(capture.measurements, rename)),
	]);
	const cold = geometry(original, createRename(anonymized.identifiers));
	const anonymizationDiverged = !sameGeometry(cold, geometry(replayed, createRename(identity)));
	const projectionDiverged =
		capture.canvas !== undefined &&
		!sameGeometry(geometry(capture.canvas, createRename(anonymized.identifiers)), cold);
	return {
		schemaVersion: LAYOUT_REPORT_SCHEMA,
		category: capture.category,
		comment: capture.comment,
		document: serializeSequitToml(anonymized.document),
		measurements: reportedMeasurements(capture.measurements, rename),
		...shown(capture, rename),
		zones: zones(capture, rename),
		checks: { anonymizationDiverged, projectionDiverged },
		environment: capture.environment,
	};
}

/** The browser and window the report was made in. */
export function browserEnvironment(): LayoutReportEnvironment {
	return {
		userAgent: navigator.userAgent,
		language: navigator.language,
		devicePixelRatio: window.devicePixelRatio,
		viewport: { width: window.innerWidth, height: window.innerHeight },
	};
}
