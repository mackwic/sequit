export enum LayoutDirection {
	TopToBottom = 'top-to-bottom',
	BottomToTop = 'bottom-to-top',
	LeftToRight = 'left-to-right',
	RightToLeft = 'right-to-left',
}

export const LAYOUT_DIRECTIONS = [
	LayoutDirection.TopToBottom,
	LayoutDirection.BottomToTop,
	LayoutDirection.LeftToRight,
	LayoutDirection.RightToLeft,
] as const;

export enum LayoutBias {
	Top = 'top',
	Bottom = 'bottom',
	Left = 'left',
	Right = 'right',
}

export const LAYOUT_BIASES = [
	LayoutBias.Top,
	LayoutBias.Bottom,
	LayoutBias.Left,
	LayoutBias.Right,
] as const;

interface VerticalLayoutConfiguration {
	readonly direction: LayoutDirection.TopToBottom | LayoutDirection.BottomToTop;
	readonly bias: LayoutBias.Top | LayoutBias.Bottom;
}
interface HorizontalLayoutConfiguration {
	readonly direction: LayoutDirection.LeftToRight | LayoutDirection.RightToLeft;
	readonly bias: LayoutBias.Left | LayoutBias.Right;
}
export type LayoutConfiguration = VerticalLayoutConfiguration | HorizontalLayoutConfiguration;

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
export const JUNCTION_OPERATORS = [JunctionOperator.Xor] as const;

export interface LogicNature {
	readonly id: string;
	readonly label: string;
	readonly color: string;
}

export interface LogicGroup {
	readonly id: string;
	readonly label: string;
	readonly groupId?: string;
}

export interface LogicNode {
	readonly id: string;
	readonly natureId: string;
	readonly groupId?: string;
	readonly markdown: string;
}

export interface LogicJunction {
	readonly id: string;
	readonly operator: JunctionOperator;
	readonly groupId?: string;
}

export interface LogicRelation {
	readonly id: string;
	readonly from: string;
	readonly to: string;
}

export interface LogicDocument {
	readonly id: string;
	readonly title: string;
	readonly layout: LayoutConfiguration;
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
	UnknownNature = 'unknown-nature',
	UnknownGroup = 'unknown-group',
	GroupCycle = 'group-cycle',
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
