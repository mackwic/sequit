import type { GroupMeasurement, Size } from '../../core/layout/layout-types';

export const LAYOUT_REPORT_SCHEMA = 1 as const;
/** A request body above this is refused before it is parsed. */
export const LAYOUT_REPORT_MAX_BYTES = 4_000_000;
export const LAYOUT_REPORT_MAX_COMMENT_LENGTH = 4_000;

export enum LayoutReportCategory {
	Overlap = 'overlap',
	Crossing = 'crossing',
	Route = 'route',
	Spacing = 'spacing',
	Order = 'order',
	Failure = 'failure',
	Other = 'other',
}
export const LAYOUT_REPORT_CATEGORIES = Object.values(LayoutReportCategory);

export enum ReportedEntityKind {
	Node = 'node',
	Group = 'group',
	Junction = 'junction',
	Relation = 'relation',
}
export const REPORTED_ENTITY_KINDS = Object.values(ReportedEntityKind);

export interface ReportedBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface ReportedPoint {
	readonly x: number;
	readonly y: number;
}

export interface ReportedBox {
	readonly id: string;
	readonly bounds: ReportedBounds;
}

export interface ReportedLane extends ReportedBox {
	readonly regionId?: string;
}

export interface ReportedRelation {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly points: readonly ReportedPoint[];
}

/** The geometry a layout produced, in canvas coordinates, without any text. */
export interface ReportedLayout {
	readonly width: number;
	readonly height: number;
	readonly nodes: readonly ReportedBox[];
	readonly groups: readonly ReportedBox[];
	readonly junctions: readonly ReportedBox[];
	readonly relations: readonly ReportedRelation[];
	readonly lanes: readonly ReportedLane[];
	readonly regions: readonly ReportedBox[];
}

export interface RenderedRelation {
	readonly id: string;
	/** The SVG path drawn on screen, in canvas coordinates. */
	readonly path: string;
}

/** What the page actually showed, read back from the DOM and brought to canvas coordinates. */
export interface RenderedLayout {
	readonly width: number;
	readonly height: number;
	readonly zoom: number;
	readonly nodes: readonly ReportedBox[];
	readonly groups: readonly ReportedBox[];
	readonly junctions: readonly ReportedBox[];
	readonly relations: readonly RenderedRelation[];
}

export interface ReportedEntity {
	readonly kind: ReportedEntityKind;
	readonly id: string;
}

/** An area pointed at by the reporter, with the entities it touches. */
export interface LayoutReportZone {
	readonly bounds: ReportedBounds;
	readonly entities: readonly ReportedEntity[];
}

/** Sorted by identifier, so that equal measurements serialize equally. */
export interface ReportedMeasurements {
	readonly nodes: readonly (readonly [string, Size])[];
	readonly junctions: readonly (readonly [string, Size])[];
	readonly groups: readonly (readonly [string, GroupMeasurement])[];
}

export interface LayoutReportChecks {
	/** The anonymized document, laid out with the same measurements, gave another geometry. */
	readonly anonymizationDiverged: boolean;
	/** The canvas shown differed from a cold layout of the same document and measurements. */
	readonly projectionDiverged: boolean;
}

export interface LayoutReportEnvironment {
	readonly userAgent: string;
	readonly language: string;
	readonly devicePixelRatio: number;
	readonly viewport: { readonly width: number; readonly height: number };
}

/** What the page showed: the canvas and what it drew, or the failure in its place. */
export interface LayoutReportDisplay {
	/** The canvas shown, absent when the layout failed. */
	readonly layout?: ReportedLayout;
	/** The failure shown instead of a canvas. */
	readonly failure?: string;
	readonly rendered?: RenderedLayout;
}

export interface LayoutReportContent {
	readonly category: LayoutReportCategory;
	readonly comment: string;
	/** The anonymized document, as Sequit TOML. */
	readonly document: string;
	readonly measurements: ReportedMeasurements;
	readonly zones: readonly LayoutReportZone[];
	readonly checks: LayoutReportChecks;
	readonly environment: LayoutReportEnvironment;
}

/** What the browser sends; every identifier in it is anonymous and every text is `xxx`. */
export interface LayoutReport extends LayoutReportContent, LayoutReportDisplay {
	readonly schemaVersion: typeof LAYOUT_REPORT_SCHEMA;
}
