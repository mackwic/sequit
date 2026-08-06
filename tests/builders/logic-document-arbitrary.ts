import fc from 'fast-check';

import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	type LogicGroup,
	type LogicJunction,
	type LogicNode,
	type LogicRelation,
	PERSISTENCE_FORMAT,
} from '../../src/lib/document/logic-document';
import { orderKey } from '../../src/lib/document/order-key';

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
	direction: LayoutDirection.TopToBottom,
	bias: LayoutBias.Top,
} as const satisfies LayoutConfiguration;
const LAYOUTS: readonly LayoutConfiguration[] = [
	DEFAULT_LAYOUT,
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
];

function generatedOrderKey(namespace: string, index: number): string {
	return orderKey(`a${namespace}${index.toString().padStart(4, '0')}1`);
}

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
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'generated-document',
		title,
		layout,
		natures: [{ id: 'generated', label: 'Generated', color: '#000000' }],
		groups: [],
		nodes: nodeMarkdown.map((markdown, index) => ({
			kind: EndpointKind.Node,
			layoutOrder: generatedOrderKey('N', index),
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

export function groupId(index: number): string {
	return `group-${index.toString().padStart(2, '0')}`;
}

export function junctionId(index: number): string {
	return `junction-${index.toString().padStart(2, '0')}`;
}

function requiredAt<T>(values: readonly T[], index: number, description: string): T {
	const value = values[index];
	if (value === undefined) throw new Error(`Missing generated ${description} at index ${index}`);
	return value;
}

interface RelationEndpoints {
	readonly from: string;
	readonly to: string;
}

function rankingPositionsByEndpoint(
	document: Omit<LogicDocument, 'relations'>,
	positionByEndpointId: ReadonlyMap<string, number>,
): ReadonlyMap<string, readonly number[]> {
	const groupsById = new Map(document.groups.map((group) => [group.id, group]));
	const memberIdsByGroup = new Map(document.groups.map(({ id }) => [id, [] as string[]]));
	for (const endpoint of [...document.groups, ...document.nodes, ...document.junctions]) {
		if (endpoint.groupId === undefined) continue;
		const members = memberIdsByGroup.get(endpoint.groupId);
		if (!members) throw new Error(`Missing generated parent group: ${endpoint.groupId}`);
		members.push(endpoint.id);
	}
	const cache = new Map<string, readonly number[]>();
	function positionsFor(id: string, visiting: ReadonlySet<string>): readonly number[] {
		const cached = cache.get(id);
		if (cached) return cached;
		const group = groupsById.get(id);
		if (!group) {
			const position = positionByEndpointId.get(id);
			if (position === undefined) throw new Error(`Missing generated endpoint position: ${id}`);
			const positions = [position];
			cache.set(id, positions);
			return positions;
		}
		if (visiting.has(id)) throw new Error(`Generated group containment cycle: ${id}`);
		const nextVisiting = new Set(visiting).add(id);
		const members = memberIdsByGroup.get(id) ?? [];
		let positions: readonly number[];
		if (members.length === 0) {
			const position = positionByEndpointId.get(id);
			if (position === undefined) throw new Error(`Missing generated empty group position: ${id}`);
			positions = [position];
		} else {
			positions = [
				...new Set(members.flatMap((memberId) => positionsFor(memberId, nextVisiting))),
			].sort((left, right) => left - right);
		}
		cache.set(id, positions);
		return positions;
	}
	for (const endpoint of [...document.groups, ...document.nodes, ...document.junctions]) {
		positionsFor(endpoint.id, new Set());
	}
	return cache;
}

function generatedRelations(
	document: Omit<LogicDocument, 'relations'>,
	positionByEndpointId: ReadonlyMap<string, number>,
	selectors: readonly number[],
	options: DocumentArbitraryOptions,
): readonly LogicRelation[] {
	const positionsByEndpoint = rankingPositionsByEndpoint(document, positionByEndpointId);
	const containerIds = new Set(
		[...document.groups, ...document.nodes, ...document.junctions]
			.map(({ groupId }) => groupId)
			.filter((id) => id !== undefined),
	);
	const endpointIds = [
		...document.groups
			.filter(({ id, groupId }) => groupId === undefined && !containerIds.has(id))
			.map(({ id }) => id),
		...document.nodes.filter(({ groupId }) => groupId === undefined).map(({ id }) => id),
		...document.junctions.filter(({ id }) => id === junctionId(0)).map(({ id }) => id),
	].sort((left, right) => left.localeCompare(right));
	const candidates: RelationEndpoints[] = [];
	for (const from of endpointIds) {
		const fromPositions = positionsByEndpoint.get(from) ?? [];
		for (const to of endpointIds) {
			const toPositions = positionsByEndpoint.get(to) ?? [];
			if (from !== to && Math.max(...fromPositions) < Math.min(...toPositions)) {
				candidates.push({ from, to });
			}
		}
	}
	const mandatory: readonly RelationEndpoints[] = [
		{ from: nodeId(0), to: junctionId(0) },
		{ from: junctionId(0), to: groupId(2) },
		{ from: groupId(2), to: nodeId(1) },
	];
	const maximumEdges = Math.max(
		mandatory.length,
		Math.min(candidates.length, options.maxEdges ?? 40),
	);
	const minimumEdges = Math.min(
		maximumEdges,
		Math.max(mandatory.length, options.minEdges ?? mandatory.length),
	);
	const selected = new Map<string, RelationEndpoints>();
	for (const relation of mandatory) selected.set(`${relation.from}:${relation.to}`, relation);
	for (const candidate of candidates) {
		if (selected.size >= minimumEdges) break;
		selected.set(`${candidate.from}:${candidate.to}`, candidate);
	}
	for (const selector of selectors) {
		if (selected.size >= maximumEdges || candidates.length === 0) break;
		const candidate = requiredAt(candidates, selector % candidates.length, 'relation candidate');
		selected.set(`${candidate.from}:${candidate.to}`, candidate);
	}
	return [...selected.values()]
		.sort((left, right) => {
			const leftPosition = Math.max(...(positionsByEndpoint.get(left.from) ?? []));
			const rightPosition = Math.max(...(positionsByEndpoint.get(right.from) ?? []));
			return (
				leftPosition - rightPosition ||
				left.from.localeCompare(right.from) ||
				left.to.localeCompare(right.to)
			);
		})
		.map(({ from, to }, index) => ({
			id: `relation-${index.toString().padStart(3, '0')}`,
			from,
			to,
		}));
}

function richDocumentArbitraryForCounts(
	nodeCount: number,
	junctionCount: number,
	natureCount: number,
	hierarchyDepth: number,
	options: DocumentArbitraryOptions,
): fc.Arbitrary<LogicDocument> {
	const hierarchyGroupIds = [
		groupId(0),
		groupId(1),
		...Array.from({ length: hierarchyDepth - 1 }, (_, index) => groupId(index + 4)),
	];
	const emptyHierarchyGroupIds = Array.from(
		{ length: hierarchyDepth },
		(_, index) => `empty-group-${index.toString().padStart(2, '0')}`,
	);
	return fc
		.tuple(
			fc.constantFrom(...LAYOUTS),
			fc.string({ maxLength: 80, unit: 'grapheme' }),
			fc.array(fc.string({ maxLength: 160, unit: 'grapheme' }), {
				minLength: nodeCount,
				maxLength: nodeCount,
			}),
			fc.array(fc.string({ minLength: 1, maxLength: 40, unit: 'grapheme' }), {
				minLength: natureCount,
				maxLength: natureCount,
			}),
			fc.array(fc.integer({ min: 0, max: natureCount - 1 }), {
				minLength: nodeCount,
				maxLength: nodeCount,
			}),
			fc.array(fc.integer({ min: -1, max: hierarchyGroupIds.length - 1 }), {
				minLength: nodeCount,
				maxLength: nodeCount,
			}),
			fc.array(fc.integer({ min: -1, max: hierarchyGroupIds.length - 1 }), {
				minLength: junctionCount,
				maxLength: junctionCount,
			}),
			fc.array(fc.integer({ min: 0, max: 10_000 }), {
				maxLength: options.maxEdges ?? 40,
			}),
		)
		.map(([layout, title, markdown, natureLabels, natureIndexes, , , relationSelectors]) => {
			const natures = natureLabels.map((label, index) => ({
				id: `nature-${index.toString().padStart(2, '0')}`,
				label,
				color: `#${(index + 1).toString(16).padStart(6, '0')}`,
			}));
			const hierarchyGroups = hierarchyGroupIds.map((id, index): LogicGroup => {
				if (index === 0)
					return {
						kind: EndpointKind.Group,
						id,
						label: 'Root group',
						layoutOrder: generatedOrderKey('H', index),
					};
				return {
					kind: EndpointKind.Group,
					layoutOrder: generatedOrderKey('H', index),
					id,
					label: `Nested group ${index}`,
					groupId: requiredAt(hierarchyGroupIds, index - 1, 'parent group'),
				};
			});
			const emptyHierarchyGroups = emptyHierarchyGroupIds.map((id, index): LogicGroup => {
				let parentGroupId = groupId(3);
				if (index > 0) {
					parentGroupId = requiredAt(emptyHierarchyGroupIds, index - 1, 'empty parent group');
				}
				return {
					kind: EndpointKind.Group,
					layoutOrder: generatedOrderKey('E', index),
					id,
					label: `Nested empty group ${index + 1}`,
					groupId: parentGroupId,
				};
			});
			const groups: readonly LogicGroup[] = [
				...hierarchyGroups,
				{
					kind: EndpointKind.Group,
					id: groupId(2),
					label: 'Empty endpoint group',
					layoutOrder: generatedOrderKey('G', 2),
				},
				{
					kind: EndpointKind.Group,
					id: groupId(3),
					label: 'Empty group root',
					layoutOrder: generatedOrderKey('G', 3),
				},
				...emptyHierarchyGroups,
			];
			const nodes: readonly LogicNode[] = markdown.map((value, index) => {
				const node: {
					kind: EndpointKind.Node;
					layoutOrder: string;
					id: string;
					natureId: string;
					markdown: string;
					groupId?: string;
				} = {
					kind: EndpointKind.Node,
					layoutOrder: generatedOrderKey('N', index),
					id: nodeId(index),
					natureId: requiredAt(natures, requiredAt(natureIndexes, index, 'nature'), 'nature').id,
					markdown: value,
				};
				if (index === 2) {
					node.groupId = requiredAt(
						hierarchyGroupIds,
						hierarchyGroupIds.length - 1,
						'deepest group',
					);
				}
				return node;
			});
			const junctions: readonly LogicJunction[] = Array.from(
				{ length: junctionCount },
				(_, index) => {
					const junction: LogicJunction & { groupId?: string } = {
						kind: EndpointKind.Junction,
						layoutOrder: generatedOrderKey('J', index),
						id: junctionId(index),
						operator: JunctionOperator.Xor,
					};
					return junction;
				},
			);
			const orderedEndpointIds = [
				nodeId(0),
				junctionId(0),
				groupId(2),
				groupId(3),
				...emptyHierarchyGroupIds,
				...nodes.slice(2).map(({ id }) => id),
				...junctions.slice(1).map(({ id }) => id),
				nodeId(1),
			];
			const positionByEndpointId = new Map(orderedEndpointIds.map((id, index) => [id, index]));
			const document = {
				persistenceFormat: PERSISTENCE_FORMAT,
				id: 'generated-rich-document',
				title,
				layout,
				natures,
				groups,
				nodes,
				junctions,
			};
			return {
				...document,
				relations: generatedRelations(document, positionByEndpointId, relationSelectors, options),
			};
		});
}

export function richAcyclicLogicDocumentArbitrary(
	options: DocumentArbitraryOptions = {},
): fc.Arbitrary<LogicDocument> {
	const minimumNodes = Math.max(3, options.minNodes ?? 3);
	const maximumNodes = Math.max(minimumNodes, options.maxNodes ?? 12);
	return fc
		.tuple(
			fc.integer({ min: minimumNodes, max: maximumNodes }),
			fc.integer({ min: 1, max: 3 }),
			fc.integer({ min: 1, max: 3 }),
			fc.integer({ min: 1, max: 4 }),
		)
		.chain(([nodeCount, junctionCount, natureCount, hierarchyDepth]) =>
			richDocumentArbitraryForCounts(
				nodeCount,
				junctionCount,
				natureCount,
				hierarchyDepth,
				options,
			),
		);
}

export const duplicateEndpointLogicDocumentArbitrary: fc.Arbitrary<LogicDocument> =
	richAcyclicLogicDocumentArbitrary().map((document) => {
		const firstGroup = requiredAt(document.groups, 0, 'group');
		const firstJunction = requiredAt(document.junctions, 0, 'junction');
		return {
			...document,
			junctions: [{ ...firstJunction, id: firstGroup.id }, ...document.junctions.slice(1)],
		};
	});

export const unknownNatureLogicDocumentArbitrary: fc.Arbitrary<LogicDocument> =
	richAcyclicLogicDocumentArbitrary().map((document) => ({
		...document,
		nodes: [
			{ ...requiredAt(document.nodes, 0, 'node'), natureId: 'missing-nature' },
			...document.nodes.slice(1),
		],
	}));

export const unknownGroupLogicDocumentArbitrary: fc.Arbitrary<LogicDocument> = fc
	.tuple(richAcyclicLogicDocumentArbitrary(), fc.constantFrom('group', 'node', 'junction'))
	.map(([document, owner]) => {
		if (owner === 'group') {
			return {
				...document,
				groups: [
					{ ...requiredAt(document.groups, 0, 'group'), groupId: 'missing-group' },
					...document.groups.slice(1),
				],
			};
		}
		if (owner === 'node') {
			return {
				...document,
				nodes: [
					{ ...requiredAt(document.nodes, 0, 'node'), groupId: 'missing-group' },
					...document.nodes.slice(1),
				],
			};
		}
		return {
			...document,
			junctions: [
				{ ...requiredAt(document.junctions, 0, 'junction'), groupId: 'missing-group' },
				...document.junctions.slice(1),
			],
		};
	});

export const cyclicGroupLogicDocumentArbitrary: fc.Arbitrary<LogicDocument> =
	richAcyclicLogicDocumentArbitrary().map((document) => {
		const first = requiredAt(document.groups, 0, 'group');
		const second = requiredAt(document.groups, 1, 'group');
		return {
			...document,
			groups: [
				{ ...first, groupId: second.id },
				{ ...second, groupId: first.id },
				...document.groups.slice(2),
			],
		};
	});
