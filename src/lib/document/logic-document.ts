export const PERSISTENCE_FORMAT = 1 as const;

export const LAYOUT_DIRECTIONS = [
	'top-to-bottom',
	'bottom-to-top',
	'left-to-right',
	'right-to-left',
] as const;
export type LayoutDirection = (typeof LAYOUT_DIRECTIONS)[number];

export const LAYOUT_BIASES = ['top', 'bottom', 'left', 'right'] as const;
export type LayoutBias = (typeof LAYOUT_BIASES)[number];

export type LayoutConfiguration =
	| {
			readonly direction: 'top-to-bottom' | 'bottom-to-top';
			readonly bias: 'top' | 'bottom';
	  }
	| {
			readonly direction: 'left-to-right' | 'right-to-left';
			readonly bias: 'left' | 'right';
	  };

export function layoutConfiguration(
	direction: LayoutDirection,
	bias: LayoutBias,
): LayoutConfiguration | undefined {
	if (
		(direction === 'top-to-bottom' || direction === 'bottom-to-top') &&
		(bias === 'top' || bias === 'bottom')
	) {
		return { direction, bias };
	}
	if (
		(direction === 'left-to-right' || direction === 'right-to-left') &&
		(bias === 'left' || bias === 'right')
	) {
		return { direction, bias };
	}
	return undefined;
}

export type JunctionOperator = 'xor';

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
	readonly persistenceFormat: typeof PERSISTENCE_FORMAT;
	readonly id: string;
	readonly title: string;
	readonly layout: LayoutConfiguration;
	readonly natures: readonly LogicNature[];
	readonly groups: readonly LogicGroup[];
	readonly nodes: readonly LogicNode[];
	readonly junctions: readonly LogicJunction[];
	readonly relations: readonly LogicRelation[];
}

export type DiagnosticPath = readonly string[];

export interface SequitDiagnostic {
	readonly code:
		| 'toml-syntax'
		| 'unsupported-persistence-format'
		| 'invalid-type'
		| 'missing-field'
		| 'invalid-value'
		| 'duplicate-endpoint-id'
		| 'unknown-nature'
		| 'unknown-group'
		| 'group-cycle';
	readonly message: string;
	readonly path: DiagnosticPath;
	readonly line?: number;
	readonly column?: number;
}

export type DocumentResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly diagnostics: readonly SequitDiagnostic[] };
