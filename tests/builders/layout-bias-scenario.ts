import type { LayoutConfiguration, LogicDocument } from '../../src/lib/document/logic-document';

export type LayoutContext = 'root' | 'group' | 'subgroup';

export const LAYOUT_CONFIGURATIONS = [
	{ direction: 'top-to-bottom', bias: 'top' },
	{ direction: 'top-to-bottom', bias: 'bottom' },
	{ direction: 'bottom-to-top', bias: 'top' },
	{ direction: 'bottom-to-top', bias: 'bottom' },
	{ direction: 'left-to-right', bias: 'left' },
	{ direction: 'left-to-right', bias: 'right' },
	{ direction: 'right-to-left', bias: 'left' },
	{ direction: 'right-to-left', bias: 'right' },
] as const satisfies readonly LayoutConfiguration[];

export const LONG_BRANCH = ['long-0', 'long-1', 'long-2', 'long-3'] as const;
export const SHORT_BRANCH = ['short-0', 'short-1'] as const;
export const ISOLATED_BRANCH = ['isolated'] as const;

export const LAYOUT_CONTEXTS = [
	'root',
	'group',
	'subgroup',
] as const satisfies readonly LayoutContext[];

export function layoutBiasScenario(
	layout: LayoutConfiguration,
	context: LayoutContext,
): LogicDocument {
	const groups =
		context === 'root'
			? []
			: context === 'group'
				? [{ id: 'container', label: 'Container' }]
				: [
						{ id: 'container', label: 'Container' },
						{ id: 'nested-container', label: 'Nested container', groupId: 'container' },
					];
	const groupId =
		context === 'root' ? undefined : context === 'group' ? 'container' : 'nested-container';
	const node = (id: string) => ({
		id,
		natureId: 'statement',
		...(groupId === undefined ? {} : { groupId }),
		markdown: `${id}\n`,
	});

	return {
		id: `layout-bias-${context}`,
		title: `Layout bias in ${context}`,
		layout,
		natures: [{ id: 'statement', label: 'Statement', color: '#334455' }],
		groups,
		nodes: [...LONG_BRANCH, ...SHORT_BRANCH, ...ISOLATED_BRANCH].map(node),
		junctions: [],
		relations: [
			{ id: 'long-0-to-long-1', from: 'long-0', to: 'long-1' },
			{ id: 'long-1-to-long-2', from: 'long-1', to: 'long-2' },
			{ id: 'long-2-to-long-3', from: 'long-2', to: 'long-3' },
			{ id: 'short-0-to-short-1', from: 'short-0', to: 'short-1' },
		],
	};
}
