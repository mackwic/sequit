import {
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../src/lib/document/logic-document';

export type LayoutContext = 'root' | 'group' | 'subgroup';

export const LAYOUT_CONFIGURATIONS = [
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Bottom },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Top },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Right },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Left },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
] as const satisfies readonly LayoutConfiguration[];

export const LONG_BRANCH = ['long-0', 'long-1', 'long-2', 'long-3'] as const;
export const SHORT_BRANCH = ['short-0', 'short-1'] as const;
export const ISOLATED_BRANCH = ['isolated'] as const;
export const LONG_BRANCH_RELATIONS = [
	['long-0', 'long-1'],
	['long-1', 'long-2'],
	['long-2', 'long-3'],
] as const;
export const SHORT_BRANCH_RELATIONS = [['short-0', 'short-1']] as const;

export const LAYOUT_CONTEXTS = [
	'root',
	'group',
	'subgroup',
] as const satisfies readonly LayoutContext[];

export function layoutBiasScenario(
	layout: LayoutConfiguration,
	context: LayoutContext,
): LogicDocument {
	let groups: LogicDocument['groups'] = [];
	let groupId: string | undefined;
	if (context === 'group') {
		groups = [{ id: 'container', label: 'Container' }];
		groupId = 'container';
	}
	if (context === 'subgroup') {
		groups = [
			{ id: 'container', label: 'Container' },
			{ id: 'nested-container', label: 'Nested container', groupId: 'container' },
		];
		groupId = 'nested-container';
	}
	const node = (id: string) => {
		const value: { id: string; natureId: string; groupId?: string; markdown: string } = {
			id,
			natureId: 'statement',
			markdown: `${id}\n`,
		};
		if (groupId !== undefined) value.groupId = groupId;
		return value;
	};

	return {
		id: `layout-bias-${context}`,
		title: `Layout bias in ${context}`,
		layout,
		natures: [{ id: 'statement', label: 'Statement', color: '#334455' }],
		groups,
		nodes: [...LONG_BRANCH, ...SHORT_BRANCH, ...ISOLATED_BRANCH].map(node),
		junctions: [],
		relations: [...LONG_BRANCH_RELATIONS, ...SHORT_BRANCH_RELATIONS].map(([from, to]) => ({
			id: `${from}-to-${to}`,
			from,
			to,
		})),
	};
}
