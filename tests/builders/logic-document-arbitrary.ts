import fc from 'fast-check';

import type {
	LayoutConfiguration,
	LogicDocument,
	LogicRelation,
} from '../../src/lib/document/logic-document';

interface DocumentArbitraryOptions {
	readonly minNodes?: number;
	readonly maxNodes?: number;
	readonly minEdges?: number;
	readonly maxEdges?: number;
}

interface EdgeIndexes {
	readonly fromIndex: number;
	readonly toIndex: number;
}

const DEFAULT_LAYOUT = {
	direction: 'top-to-bottom',
	bias: 'top',
} as const satisfies LayoutConfiguration;
const LAYOUTS: readonly LayoutConfiguration[] = [
	DEFAULT_LAYOUT,
	{ direction: 'bottom-to-top', bias: 'bottom' },
	{ direction: 'left-to-right', bias: 'left' },
	{ direction: 'right-to-left', bias: 'right' },
];

export function nodeId(index: number): string {
	return `node-${index.toString().padStart(2, '0')}`;
}

export function documentWith(
	nodeMarkdown: readonly string[],
	relations: readonly LogicRelation[],
	layout: LayoutConfiguration = DEFAULT_LAYOUT,
	title = 'Generated document',
): LogicDocument {
	return {
		id: 'generated-document',
		title,
		layout,
		natures: [{ id: 'generated', label: 'Generated', color: '#000000' }],
		groups: [],
		nodes: nodeMarkdown.map((markdown, index) => ({
			id: nodeId(index),
			natureId: 'generated',
			markdown,
		})),
		junctions: [],
		relations,
	};
}

export function acyclicLogicDocumentArbitrary(
	options: DocumentArbitraryOptions = {},
): fc.Arbitrary<LogicDocument> {
	const minNodes = options.minNodes ?? 1;
	const maxNodes = options.maxNodes ?? 12;
	return fc.integer({ min: minNodes, max: maxNodes }).chain((nodeCount) => {
		const edgeArbitrary = fc
			.tuple(fc.integer({ min: 0, max: nodeCount - 1 }), fc.integer({ min: 0, max: nodeCount - 1 }))
			.filter(([left, right]) => left !== right)
			.map(([left, right]): EdgeIndexes => ({
				fromIndex: Math.min(left, right),
				toIndex: Math.max(left, right),
			}));
		const possibleEdges = (nodeCount * (nodeCount - 1)) / 2;
		const maximumEdges = Math.min(possibleEdges, options.maxEdges ?? 40);
		const minimumEdges = Math.min(maximumEdges, options.minEdges ?? 0);
		return fc
			.tuple(
				fc.constantFrom(...LAYOUTS),
				fc.string({ maxLength: 80, unit: 'grapheme' }),
				fc.array(fc.string({ maxLength: 160, unit: 'grapheme' }), {
					minLength: nodeCount,
					maxLength: nodeCount,
				}),
				fc.uniqueArray(edgeArbitrary, {
					minLength: minimumEdges,
					maxLength: maximumEdges,
					selector: ({ fromIndex, toIndex }) => `${fromIndex}:${toIndex}`,
				}),
			)
			.map(([layout, title, markdown, edges]) =>
				documentWith(
					markdown,
					edges.map(({ fromIndex, toIndex }, index) => ({
						id: `relation-${index.toString().padStart(3, '0')}`,
						from: nodeId(fromIndex),
						to: nodeId(toIndex),
					})),
					layout,
					title,
				),
			);
	});
}

export const cyclicLogicDocumentArbitrary: fc.Arbitrary<LogicDocument> = fc
	.integer({ min: 2, max: 20 })
	.map((nodeCount) =>
		documentWith(
			Array.from({ length: nodeCount }, (_, index) => `Node ${index}`),
			Array.from({ length: nodeCount }, (_, index) => ({
				id: `relation-${index.toString().padStart(3, '0')}`,
				from: nodeId(index),
				to: nodeId((index + 1) % nodeCount),
			})),
		),
	);
