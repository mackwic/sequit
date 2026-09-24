import { compareCanonicalStrings } from '../canonical-string';

export function defined<T>(value: T | undefined, message = 'Expected value to be defined'): T {
	if (value === undefined) throw new Error(message);
	return value;
}

export const PERSISTENCE_FORMAT = 2 as const;
export const LANE_PERSISTENCE_FORMAT = 3 as const;
export const REGION_PERSISTENCE_FORMAT = 4 as const;
export const GRID_PERSISTENCE_FORMAT = 5 as const;
export const REGION_LANE_PERSISTENCE_FORMAT = 6 as const;
export const REGION_COMPOSITION_PERSISTENCE_FORMAT = 7 as const;
export const REGION_POLICY_PERSISTENCE_FORMAT = 8 as const;
export const LAYOUT_PRESENTATION_SCHEMA = 1 as const;
export const REGION_PRESENTATION_SCHEMA = 1 as const;
export const GRID_REGION_PRESENTATION_SCHEMA = 2 as const;
export const REGION_LANE_PRESENTATION_SCHEMA = 3 as const;
export const REGION_COMPOSITION_PRESENTATION_SCHEMA = 4 as const;
export const REGION_POLICY_PRESENTATION_SCHEMA = 5 as const;

export enum LayoutDirection {
	TopToBottom = 'top-to-bottom',
	BottomToTop = 'bottom-to-top',
	LeftToRight = 'left-to-right',
	RightToLeft = 'right-to-left',
}
export const LAYOUT_DIRECTIONS = Object.values(LayoutDirection);

export enum LayoutBias {
	Top = 'top',
	Bottom = 'bottom',
	Left = 'left',
	Right = 'right',
}
export const LAYOUT_BIASES = Object.values(LayoutBias);

interface VerticalLayoutConfiguration {
	readonly direction: LayoutDirection.TopToBottom | LayoutDirection.BottomToTop;
	readonly bias: LayoutBias.Top | LayoutBias.Bottom;
}
interface HorizontalLayoutConfiguration {
	readonly direction: LayoutDirection.LeftToRight | LayoutDirection.RightToLeft;
	readonly bias: LayoutBias.Left | LayoutBias.Right;
}
export type LayoutConfiguration = VerticalLayoutConfiguration | HorizontalLayoutConfiguration;

export enum LayoutPolicy {
	Layered = 'layered',
	SharedLanes = 'shared-lanes',
}

export enum LaneOrientation {
	Parallel = 'parallel',
	Transverse = 'transverse',
}

export enum LaneGrowth {
	Auto = 'auto',
}

export interface LayoutLane {
	readonly id: string;
	readonly label: string;
	readonly layoutOrder: OrderKey;
}

export interface LayoutRegionDefinition {
	readonly id: string;
	/** Omission denotes the virtual root. */
	readonly parentId?: string;
	readonly layoutOrder: OrderKey;
	readonly policy: LayoutPolicy;
	readonly lanePresentation?: RegionLanePresentation;
	/** An internal region may arrange exactly four direct children in a two by two grid. */
	readonly grid?: GridLayoutPresentation;
}

/** A leaf's lanes are scoped to that region; their ids need not be unique across leaves. */
export interface RegionLanePresentation {
	readonly laneOrientation: LaneOrientation;
	readonly growth: LaneGrowth.Auto;
	readonly lanes: readonly LayoutLane[];
}

export interface RootLayoutPresentation {
	readonly schemaVersion: typeof LAYOUT_PRESENTATION_SCHEMA;
	readonly policy: LayoutPolicy;
	readonly laneOrientation: LaneOrientation;
	readonly growth: LaneGrowth.Auto;
	readonly lanes: readonly LayoutLane[];
}

export interface GridLayoutCell {
	readonly regionId: string;
	readonly row: 0 | 1;
	readonly column: 0 | 1;
}

export enum GridMinimumField {
	ColumnWidths = 'minimumColumnWidths',
	RowHeights = 'minimumRowHeights',
}

export interface GridLayoutPresentation {
	readonly minimumColumnWidths: readonly [number, number];
	readonly minimumRowHeights: readonly [number, number];
	readonly cells: readonly GridLayoutCell[];
}

interface BaseRegionLayoutPresentation {
	readonly regions: readonly LayoutRegionDefinition[];
}

interface LegacyRegionLayoutPresentation extends BaseRegionLayoutPresentation {
	readonly schemaVersion: typeof REGION_PRESENTATION_SCHEMA;
	readonly grid?: never;
}

interface GridRegionLayoutPresentation extends BaseRegionLayoutPresentation {
	readonly schemaVersion: typeof GRID_REGION_PRESENTATION_SCHEMA;
	readonly grid: GridLayoutPresentation;
}

interface RegionLaneLayoutPresentation extends BaseRegionLayoutPresentation {
	readonly schemaVersion: typeof REGION_LANE_PRESENTATION_SCHEMA;
	readonly grid?: never;
}

interface RegionCompositionLayoutPresentation extends BaseRegionLayoutPresentation {
	readonly schemaVersion: typeof REGION_COMPOSITION_PRESENTATION_SCHEMA;
	readonly grid?: never;
}

interface RegionPolicyLayoutPresentation extends BaseRegionLayoutPresentation {
	readonly schemaVersion: typeof REGION_POLICY_PRESENTATION_SCHEMA;
	readonly grid?: never;
}

export type RegionLayoutPresentation =
	| LegacyRegionLayoutPresentation
	| GridRegionLayoutPresentation
	| RegionLaneLayoutPresentation
	| RegionCompositionLayoutPresentation
	| RegionPolicyLayoutPresentation;

export function layoutConfiguration(
	direction: LayoutDirection,
	bias: LayoutBias,
): LayoutConfiguration | undefined {
	const verticalDirection =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	const verticalBias = bias === LayoutBias.Top || bias === LayoutBias.Bottom;
	if (verticalDirection && verticalBias) {
		return { direction, bias };
	}
	const horizontalDirection =
		direction === LayoutDirection.LeftToRight || direction === LayoutDirection.RightToLeft;
	const horizontalBias = bias === LayoutBias.Left || bias === LayoutBias.Right;
	if (horizontalDirection && horizontalBias) {
		return { direction, bias };
	}
	return undefined;
}

export enum JunctionOperator {
	Xor = 'xor',
}
export const JUNCTION_OPERATORS = Object.values(JunctionOperator);
export enum EndpointKind {
	Node = 'node',
	Group = 'group',
	Junction = 'junction',
}

export type { OrderKey } from './order-key';
import type { OrderKey } from './order-key';

/** Presentation only. Missing properties inherit; `none` explicitly hides an icon.
 * Icon references are namespaced so documents are not tied to one provider. */
export interface ContentStyle {
	readonly color?: string;
	readonly icon?: string;
}

export function contentStyleFields(
	color: string | undefined,
	icon: string | undefined,
): ContentStyle {
	const style: { color?: string; icon?: string } = {};
	if (color !== undefined) style.color = color;
	if (icon !== undefined) style.icon = icon;
	return style;
}

export interface LogicNature extends ContentStyle {
	readonly id: string;
	readonly label: string;
	readonly color: string;
}

export enum GroupState {
	Expanded = 'expanded',
	Closed = 'closed',
}

export function groupStateFields(value: unknown): { readonly state?: GroupState } {
	if (value === undefined) return {};
	if (value === GroupState.Expanded || value === GroupState.Closed) return { state: value };
	throw new Error('Group state must be expanded or closed');
}

export interface LogicGroup {
	readonly state?: GroupState;
	readonly color?: string;
	readonly kind: EndpointKind.Group;
	readonly id: string;
	readonly label: string;
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
	readonly layoutOrder: OrderKey;
}

export interface LogicNode extends ContentStyle {
	readonly kind: EndpointKind.Node;
	readonly id: string;
	readonly natureId: string;
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
	readonly markdown: string;
	/** Longer Markdown explanation; excluded from the compact canvas body. */
	readonly description?: string;
	readonly layoutOrder: OrderKey;
}

export function nodeDescriptionFields(description: string | undefined): {
	readonly description?: string;
} {
	if (description === undefined || description === '') return {};
	return { description };
}

export interface NewLogicNode extends Omit<LogicNode, keyof NewLogicNodeExcludedFields> {
	readonly kind?: never;
	readonly layoutOrder?: never;
}

interface NewLogicNodeExcludedFields {
	readonly kind: unknown;
	readonly layoutOrder: unknown;
}

export interface LogicJunction {
	readonly kind: EndpointKind.Junction;
	readonly id: string;
	readonly operator: JunctionOperator;
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
	readonly layoutOrder: OrderKey;
}

export type LogicEndpoint = LogicNode | LogicGroup | LogicJunction;

export interface LogicRelation {
	readonly id: string;
	readonly from: string;
	readonly to: string;
}

/** Canonical duplicate IDs; a relation identity may occur only once in a document. */
export function duplicateRelationIds(relations: readonly LogicRelation[]): readonly string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const relation of relations) {
		if (seen.has(relation.id)) duplicates.add(relation.id);
		seen.add(relation.id);
	}
	return [...duplicates].sort(compareCanonicalStrings);
}

export function assertUniqueRelationIds(relations: readonly LogicRelation[]): void {
	if (duplicateRelationIds(relations).length > 0) throw new Error('Duplicate relation IDs');
}

export interface LogicDocument {
	readonly persistenceFormat:
		| typeof PERSISTENCE_FORMAT
		| typeof LANE_PERSISTENCE_FORMAT
		| typeof REGION_PERSISTENCE_FORMAT
		| typeof GRID_PERSISTENCE_FORMAT
		| typeof REGION_LANE_PERSISTENCE_FORMAT
		| typeof REGION_COMPOSITION_PERSISTENCE_FORMAT
		| typeof REGION_POLICY_PERSISTENCE_FORMAT;
	readonly id: string;
	readonly title: string;
	readonly layout: LayoutConfiguration;
	readonly presentation?: RootLayoutPresentation;
	readonly regionPresentation?: RegionLayoutPresentation;
	readonly natures: readonly LogicNature[];
	readonly groups: readonly LogicGroup[];
	readonly nodes: readonly LogicNode[];
	readonly junctions: readonly LogicJunction[];
	readonly relations: readonly LogicRelation[];
}

type DiagnosticPath = readonly string[];

export enum SequitDiagnosticCode {
	TomlSyntax = 'toml-syntax',
	UnsupportedPersistenceFormat = 'unsupported-persistence-format',
	InvalidType = 'invalid-type',
	MissingField = 'missing-field',
	InvalidValue = 'invalid-value',
	DuplicateEndpointId = 'duplicate-endpoint-id',
	DuplicateRelationId = 'duplicate-relation-id',
	UnknownNature = 'unknown-nature',
	UnknownGroup = 'unknown-group',
	GroupCycle = 'group-cycle',
	UnknownEndpoint = 'unknown-endpoint',
}

export interface SequitDiagnostic {
	readonly code: SequitDiagnosticCode;
	readonly message: string;
	readonly path: DiagnosticPath;
	readonly line?: number;
	readonly column?: number;
}

interface DocumentSuccess<T> {
	readonly ok: true;
	readonly value: T;
}

interface DocumentFailure {
	readonly ok: false;
	readonly diagnostics: readonly SequitDiagnostic[];
}

export type DocumentResult<T> = DocumentSuccess<T> | DocumentFailure;
